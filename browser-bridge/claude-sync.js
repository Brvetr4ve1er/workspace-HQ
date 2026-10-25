// CLAUDE SYNC (extension 0.4.0) — importScripts'd by background.js (classic SW); also require()d by node tests.
// Reads the owner's OWN claude.ai session with read-only GETs (claude.ai's page requests: observed, undocumented — they
// can change without notice), at most one request per 2 s, exponential backoff on 429/5xx, and a pause with a visible
// status when a response does not look as expected. Never writes to claude.ai. Results go to the local WorkspaceHQ
// bridge (POST /claude/sync). Every top-level name is claude-prefixed: this file shares one global scope with
// background.js and social.js.
const CLAUDE_ORIGIN = 'https://claude.ai';
const CLAUDE_SYNC_ALARM = 'claude-sync';
const CLAUDE_SYNC_PERIOD_MIN = 5;
const CLAUDE_MIN_GAP_MS = 2000;
const CLAUDE_BATCH = 20;
const CLAUDE_MAX_PUSH_BYTES = 4 * 1024 * 1024;
const CLAUDE_RETRIES = 4;
const CLAUDE_MAX_INLINE_WAIT_MS = 30000;
const CLAUDE_BACKOFF_MAX_MS = 600000;
const CLAUDE_UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
const claudeIsId = (x) => typeof x === 'string' && CLAUDE_UUID_RE.test(x);
const CLAUDE_SHAPES = {
  orgs: (j) => Array.isArray(j) && j.length > 0 && j.every((o) => o && claudeIsId(o.uuid)),
  projects: (j) => Array.isArray(j) && j.every((p) => p && claudeIsId(p.uuid)),
  list: (j) => Array.isArray(j) && j.every((c) => c && claudeIsId(c.uuid) && typeof c.updated_at === 'string'),
  conv: (j) => !!j && typeof j === 'object' && claudeIsId(j.uuid) && Array.isArray(j.chat_messages),
};

function claudeSyncErr(kind, message, retryIn = 0) { const e = new Error(message); e.kind = kind; e.retryIn = retryIn; return e; }

function claudeBackoffMs(attempt, retryAfter) {
  const ra = Number(retryAfter);
  if (retryAfter != null && Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, CLAUDE_BACKOFF_MAX_MS);
  return Math.min(CLAUDE_MIN_GAP_MS * 2 ** (attempt + 1), CLAUDE_BACKOFF_MAX_MS);
}

// state.last is the time of the last paced request. The service worker passes ONE module-scope state, so alarm ticks,
// popup clicks and back-to-back runs in a worker's lifetime share the 2 s gap (runs never overlap: see claudeInflight).
function claudeCreatePacer({ now, sleep, gapMs = CLAUDE_MIN_GAP_MS, state = { last: -Infinity } }) {
  return async function claudePace() { const wait = state.last + gapMs - now(); if (wait > 0) await sleep(wait); state.last = now(); };
}

async function claudeGet(d, path, shape) {
  for (let attempt = 0; ; attempt++) {
    await d.pace();
    let r;
    try { r = await d.fetch(CLAUDE_ORIGIN + path, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }); }
    catch (e) { throw claudeSyncErr('offline', 'claude.ai did not answer (' + String((e && e.message) || e).slice(0, 80) + ')', claudeBackoffMs(attempt)); }
    if (r.status === 401 || r.status === 403) throw claudeSyncErr('signed-out', 'Log in to claude.ai in this browser, then press Sync claude.ai.');
    if (r.status === 429 || r.status >= 500) {
      const wait = claudeBackoffMs(attempt, r.headers.get('retry-after'));
      if (attempt >= CLAUDE_RETRIES - 1 || wait > CLAUDE_MAX_INLINE_WAIT_MS) {
        throw claudeSyncErr('backoff', 'claude.ai is limiting requests (HTTP ' + r.status + ') — trying again later.', wait);
      }
      await d.sleep(wait);
      continue;
    }
    if (r.status === 404 && shape === 'conv') return null;
    if (!r.ok) throw claudeSyncErr('paused', 'claude.ai changed, sync paused (HTTP ' + r.status + ' for ' + shape + ')');
    let j;
    try { j = await r.json(); } catch { throw claudeSyncErr('paused', 'claude.ai changed, sync paused (' + shape + ' is not JSON)'); }
    if (!CLAUDE_SHAPES[shape](j)) throw claudeSyncErr('paused', 'claude.ai changed, sync paused (' + shape + ' looks different)');
    return j;
  }
}

function claudeIsNewer(remote, local, known) {
  if (!known || local == null) return true;
  const a = Date.parse(remote), b = Date.parse(local);
  return Number.isNaN(a) || Number.isNaN(b) || a > b;
}

const claudeBytes = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : Buffer.byteLength(s, 'utf8'));

async function claudeSyncRun(d) {
  const batch = d.batch ?? CLAUDE_BATCH, maxPush = d.maxPushBytes ?? CLAUDE_MAX_PUSH_BYTES, skip = d.skip || {};
  const st = await d.app.state();
  const known = { c: st.conversations || {}, p: st.projects || {} };
  const forgotten = new Set(st.forgotten || []);
  const org = (await claudeGet(d, '/api/organizations', 'orgs'))[0].uuid;
  const base = '/api/organizations/' + org;
  const projects = (await claudeGet(d, base + '/projects', 'projects')).filter((p) => claudeIsNewer(p.updated_at, known.p[p.uuid], p.uuid in known.p));
  for (let i = 0; i < projects.length; i += 25) await d.app.push(JSON.stringify({ v: 1, items: projects.slice(i, i + 25).map((p) => ({ kind: 'project', data: p })) }));
  const list = await claudeGet(d, base + '/chat_conversations', 'list');
  const todo = list.filter((c) => !forgotten.has(c.uuid) && skip[c.uuid] !== c.updated_at && claudeIsNewer(c.updated_at, known.c[c.uuid], c.uuid in known.c))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const run = todo.slice(0, batch);
  const out = { pushed: 0, projects: projects.length, left: todo.length - run.length, tooBig: 0, tooBigIds: {} };
  for (const c of run) {
    const conv = await claudeGet(d, base + '/chat_conversations/' + c.uuid + '?tree=True&rendering_mode=messages&render_all_tools=true', 'conv');
    if (!conv) continue;
    const body = JSON.stringify({ v: 1, items: [{ kind: 'conversation', data: conv }] });
    if (claudeBytes(body) > maxPush) { out.tooBig++; out.tooBigIds[c.uuid] = c.updated_at; continue; }
    await d.app.push(body);
    out.pushed++;
  }
  return out;
}

function claudeAppClient(cfg, fetchFn) {
  const headers = { 'Content-Type': 'application/json', 'X-HQ-Bridge': '1', ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}) };
  const call = async (path, opts) => {
    let r;
    try { r = await fetchFn(cfg.endpoint + path, { ...opts, headers }); }
    catch (e) { throw claudeSyncErr('app', 'WorkspaceHQ is not reachable (' + String((e && e.message) || e).slice(0, 60) + ') — open the app.'); }
    if (r.status === 409) throw claudeSyncErr('app', 'Another WorkspaceHQ window owns the Claude index — sync from that one.');
    if (!r.ok) throw claudeSyncErr('app', 'WorkspaceHQ is not reachable (HTTP ' + r.status + ') — open the app.');
    return r.json();
  };
  return { state: () => call('/claude/sync-state', { method: 'GET' }), push: (body) => call('/claude/sync', { method: 'POST', body }) };
}

function claudeSummary(r) {
  const parts = [];
  if (r.pushed) parts.push('Synced ' + r.pushed + ' chat' + (r.pushed === 1 ? '' : 's'));
  if (r.projects) parts.push(r.projects + ' project' + (r.projects === 1 ? '' : 's') + ' updated');
  if (r.left) parts.push(r.left + ' left — next batch in ' + CLAUDE_SYNC_PERIOD_MIN + ' min');
  if (r.tooBig) parts.push(r.tooBig + ' too large for live sync — use the export');
  return parts.length ? parts.join(' · ') : 'Up to date';
}

// ---- chrome wrapper (service worker only; node tests run it in a vm with a fake chrome) -------------------------
const CLAUDE_PERM = { origins: ['https://claude.ai/*'] };
const CLAUDE_OFF_MSG = 'Off — nothing is read from claude.ai.';
const claudeSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claudeGetState() {
  const { hq_claude } = await chrome.storage.local.get('hq_claude');
  return { on: false, status: 'off', message: CLAUDE_OFF_MSG, lastSyncAt: 0, last: null, skip: {}, nextAt: 0, running: 0, ...(hq_claude || {}) };
}
async function claudeSetState(patch) {
  const s = { ...(await claudeGetState()), ...patch };
  await chrome.storage.local.set({ hq_claude: s });
  return s;
}
async function claudeEnsureAlarm() {
  const s = await claudeGetState();
  if (s.on) chrome.alarms.create(CLAUDE_SYNC_ALARM, { periodInMinutes: CLAUDE_SYNC_PERIOD_MIN });
  else await chrome.alarms.clear(CLAUDE_SYNC_ALARM);
}
// One run at a time per worker: claudeInflight is set synchronously (before the first await), so two ticks started in
// the same turn cannot both pass; an alarm tick skips while a run is in flight, a manual one (popup click, off→on) waits
// for it. storage 'running' still covers a worker restart. claudeGen is bumped by every off switch: a run started under
// an older generation stops at its next paced request and never writes the status again.
let claudeInflight = null;
let claudeGen = 0;
const claudePaceState = { last: -Infinity };
async function claudeSetOn(on, opts = {}) {
  if (!on) {
    claudeGen++;
    await chrome.alarms.clear(CLAUDE_SYNC_ALARM);
    return claudeSetState({ on: false, status: 'off', message: CLAUDE_OFF_MSG, running: 0, nextAt: 0 });
  }
  await claudeSetState({ on: true, status: 'idle', message: 'On — reading claude.ai…' });
  chrome.alarms.create(CLAUDE_SYNC_ALARM, { periodInMinutes: CLAUDE_SYNC_PERIOD_MIN });
  return claudeSyncTick({ ...opts, manual: true });
}
async function claudeSyncTick(opts = {}) {
  if (claudeInflight && !opts.manual) return claudeGetState();
  while (claudeInflight) { const prev = claudeInflight; await prev.catch(() => {}); if (claudeInflight === prev) claudeInflight = null; }
  const p = claudeSyncTickBody(opts);
  claudeInflight = p;
  try { return await p; } finally { if (claudeInflight === p) claudeInflight = null; }
}
async function claudeSyncTickBody({ manual = false, sleep = claudeSleep, now = Date.now } = {}) {
  const gen = claudeGen, stale = () => gen !== claudeGen;
  const s = await claudeGetState();
  if (!s.on) return s;
  if (s.status === 'paused' && !manual) return s;                          // a shape change waits for the owner
  if (!manual && s.nextAt && now() < s.nextAt) return s;                    // backoff window
  if (s.running && now() - s.running < 10 * 60 * 1000) return s;           // a run is in flight in an earlier worker life
  if (!(await chrome.permissions.contains(CLAUDE_PERM))) return claudeSetState({ status: 'no-permission', message: 'Press "Sync claude.ai" to allow reading claude.ai.' });
  if (!(await chrome.tabs.query({ url: 'https://claude.ai/*' })).length) return claudeSetState({ status: 'no-tab', message: 'Open claude.ai in a tab (logged in) — sync runs only then.' });
  if (stale()) return claudeGetState();                                     // switched off during the checks above
  await claudeSetState({ status: 'syncing', running: now(), message: 'Reading claude.ai…' });
  try {
    const cfg = await getCfg();
    // Off-switch: check the generation and re-read the stored flag around EVERY paced GET, so unticking "on" stops the
    // run at the next request — also when it was ticked on again in between (that is a new run; this one ends).
    const pacer = claudeCreatePacer({ now, sleep, state: claudePaceState });
    const off = async () => stale() || !(await claudeGetState()).on;
    const pace = async () => { if (await off()) throw claudeSyncErr('off', CLAUDE_OFF_MSG); await pacer(); if (await off()) throw claudeSyncErr('off', CLAUDE_OFF_MSG); };
    const r = await claudeSyncRun({ fetch: (u, o) => fetch(u, o), sleep, pace, app: claudeAppClient(cfg, (u, o) => fetch(u, o)), skip: s.skip || {} });
    const done = { lastSyncAt: now(), last: r, skip: { ...(s.skip || {}), ...r.tooBigIds } };
    if (stale()) return claudeSetState(done);                               // superseded: the off switch owns the status
    // The owner may have switched sync off while the run was reading: never overwrite the off status.
    if (!(await claudeGetState()).on) return claudeSetState({ ...done, running: 0, nextAt: 0, status: 'off', message: CLAUDE_OFF_MSG });
    return claudeSetState({ ...done, running: 0, nextAt: 0, status: 'ok', message: claudeSummary(r) });
  } catch (e) {
    if (stale()) return claudeGetState();                                    // claudeSetOn(false) already wrote the status
    if ((e && e.kind === 'off') || !(await claudeGetState()).on) return claudeSetState({ running: 0, nextAt: 0, status: 'off', message: CLAUDE_OFF_MSG });
    const kind = (e && e.kind) || 'app';
    return claudeSetState({ status: kind, running: 0, message: String((e && e.message) || e).slice(0, 200), nextAt: e && e.retryIn ? now() + e.retryIn : 0 });
  }
}


if (typeof module === 'object' && module && module.exports) {
  module.exports = { CLAUDE_ORIGIN, CLAUDE_SYNC_ALARM, CLAUDE_SYNC_PERIOD_MIN, CLAUDE_MIN_GAP_MS, CLAUDE_BATCH, CLAUDE_MAX_PUSH_BYTES, CLAUDE_RETRIES,
    CLAUDE_SHAPES, claudeSyncErr, claudeBackoffMs, claudeCreatePacer, claudeGet, claudeIsNewer, claudeSyncRun, claudeAppClient, claudeSummary };
}
