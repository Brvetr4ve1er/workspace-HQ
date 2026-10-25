// WorkspaceHQ Bridge — MV3 service worker.
//
// Tracks which tab you're actually looking at and for how long, then streams
// that to the local WorkspaceHQ app (127.0.0.1). The app turns it into the
// "Working On Now" insight and leaves a data/browser-activity.json artifact
// that Claude can read for context on what you're building.
//
// MV3 service workers are ephemeral: every event wakes us, we read/patch state
// in chrome.storage, and go back to sleep. All durable state lives in storage,
// never in module-scope variables (those die when the worker is unloaded).

importScripts('social.js');   // SOCIAL BINDING: socialTick (read) + socialSend (approved write)
importScripts('claude-sync.js');   // CLAUDE SYNC (0.4.0): paced read-only claude.ai -> /claude/sync

const DEFAULTS = { endpoint: 'http://127.0.0.1:47821', paused: false, token: '' };
const IDLE_SECONDS = 60;      // no interaction for this long => stop counting focus
const MIN_FOCUS_MS = 1500;    // ignore sub-1.5s tab flickers (alt-tabbing through)
const FLUSH_MINUTES = 0.5;    // push to the app twice a minute (Chrome floors at ~30s)

// ---- storage helpers (the only source of truth) ----------------------------
async function getState() {
  const { hq_state } = await chrome.storage.local.get('hq_state');
  return hq_state || {};
}
async function setState(patch) {
  const s = await getState();
  await chrome.storage.local.set({ hq_state: { ...s, ...patch } });
}
async function getCfg() {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  return { ...DEFAULTS, ...(hq_cfg || {}) };
}

function parseUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return null;
    return { domain: u.hostname || 'file', host: u.host || u.hostname, port: u.port || '', path: u.pathname || '/' };
  } catch { return null; }
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch { return null; }
}

// Close out the running session (if long enough) and open a new one for `tab`.
// Pass null to just close out (browser blurred / went idle).
async function transition(tab) {
  const now = Date.now();
  const s = await getState();
  const cfg = await getCfg();
  const queue = s.queue || [];

  if (s.current && s.current.start) {
    const focusMs = now - s.current.start;
    if (focusMs >= MIN_FOCUS_MS && !cfg.paused) {
      const { start, ...rest } = s.current;
      queue.push({ ...rest, ts: start, focus_ms: focusMs });
      if (queue.length > 500) queue.splice(0, queue.length - 500); // bound if app offline
    }
  }

  let current = null;
  if (tab && tab.url) {
    const p = parseUrl(tab.url);
    if (p) current = { url: tab.url, domain: p.domain, host: p.host, port: p.port, path: p.path, title: tab.title || '', start: now };
  }
  await setState({ current, queue });
}

// ---- event wiring ----------------------------------------------------------
chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);
async function bootstrap() {
  try { chrome.idle.setDetectionInterval(IDLE_SECONDS); } catch { /* ignore */ }
  chrome.alarms.create('flush', { periodInMinutes: FLUSH_MINUTES });
  chrome.alarms.create(SOCIAL_ALARM, { periodInMinutes: SOCIAL_PERIOD_MIN });   // periodic read-only social scrape
  await transition(await activeTab());
  flush();
  socialTick().catch(() => {});
  claudeEnsureAlarm().catch(() => {});
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { await transition(await chrome.tabs.get(tabId)); flush(); } catch { /* tab gone */ }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url) { await transition(tab); flush(); return; }
  if (changeInfo.title) {
    // same page, title resolved late — patch it in place, don't reset the timer
    const s = await getState();
    if (s.current && s.current.url === tab.url) await setState({ current: { ...s.current, title: changeInfo.title } });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) { await transition(null); flush(); return; }
  await transition(await activeTab());
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') await transition(await activeTab());
  else { await transition(null); flush(); }
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') flush();
  else if (a.name === SOCIAL_ALARM) socialTick().catch(() => {});
  else if (a.name === CLAUDE_SYNC_ALARM) claudeSyncTick().catch(() => {});
});

// Popup-driven social actions. 'social:send' is the ONLY publish path and it is
// only ever sent by a human clicking Approve & Send in the popup — Claude has no
// channel to reach it. 'social:sync' forces an immediate read-only scrape.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'social:send' && msg.action) { socialSend(msg.action).then(reply); return true; }
  if (msg && msg.type === 'social:sync') { socialTick().then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  // popup "check again": deliver queued focus sessions now instead of on the next alarm
  if (msg && msg.type === 'bridge:flush') { flush().then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg && msg.type === 'claude:set') { claudeSetOn(!!msg.on).then(reply).catch((e) => reply({ status: 'app', message: String(e) })); return true; }
  return false;
});

// ---- flush to the app ------------------------------------------------------
async function flush() {
  const cfg = await getCfg();
  const s = await getState();
  const now = Date.now();
  const events = (s.queue || []).slice();
  // snapshot the running session so the app shows "now" without waiting for close-out
  const live = (s.current && s.current.start && !cfg.paused)
    ? { url: s.current.url, domain: s.current.domain, host: s.current.host, port: s.current.port, path: s.current.path, title: s.current.title, ts: s.current.start, focus_ms: now - s.current.start }
    : null;

  if (cfg.paused) { await setState({ queue: [] }); return; }
  if (!events.length && !live) return;

  try {
    const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HQ-Bridge': '1',
        ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}),
      },
      body: JSON.stringify({ v: 1, sent_at: now, events, live }),
    });
    if (res.ok) await setState({ queue: [], lastOk: now, lastError: '' });
    else await setState({ lastError: 'HTTP ' + res.status });
  } catch (e) {
    await setState({ lastError: String((e && e.message) || e) });
  }
}
