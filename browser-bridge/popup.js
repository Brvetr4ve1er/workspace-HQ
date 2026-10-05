// WorkspaceHQ Bridge popup — connection state, "working on now", and the
// approval card: the ONLY place a staged social post can be sent.
//
// Write gate (docs/sync/CONTRACT.md): "approve & send" asks the service worker
// to send (social:send → socialSend, which re-checks with the app that the post
// is still staged and unchanged); "skip" POSTs /social/outbox/cancel, which only
// flips a staged post to 'canceled' and never publishes. While either is in
// flight the card is locked and the poll never swaps or re-enables it, so a
// second click can't send twice or act on a different post.

const DEFAULTS = { endpoint: 'http://127.0.0.1:47821', paused: false, token: '' };
const POLL_MS = 2500;
const FETCH_TIMEOUT_MS = 2500;
const $ = (id) => document.getElementById(id);

const ui = {
  conn: 'checking',   // 'checking' | 'on' | 'off' | 'foreign'
  connErr: '',
  needsToken: false,
  outbox: null,       // null (not loaded) | { actions } | { refused: true } | { error }
  curId: null,        // the staged post selected (kept while it stays staged)
  curIdx: 0,
  shown: null,        // the post actually rendered in the card — what the buttons act on
  renderedSig: '',
  cfg: { ...DEFAULTS },
  busy: null,         // { id, kind: 'send' | 'skip' } — card locked while set
  flash: null,        // { text, tone, until }
  refreshing: false,
  again: false,
};

// ---- helpers ---------------------------------------------------------------
async function getCfg() {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  return { ...DEFAULTS, ...(hq_cfg || {}) };
}
const baseUrl = (cfg) => String(cfg.endpoint || DEFAULTS.endpoint).trim().replace(/\/+$/, '');
function appHeaders(cfg, post) {
  return { ...(post ? { 'Content-Type': 'application/json' } : {}), 'X-HQ-Bridge': '1', ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}) };
}
async function fetchJson(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    let body = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, body };
  } catch (e) {
    const error = e && e.name === 'AbortError' ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s` : String((e && e.message) || e);
    return { status: 0, body: null, error };
  } finally { clearTimeout(t); }
}
function fmtDur(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return '<1m';
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
// What a person would call characters (emoji / combined marks count once).
function countChars(s) {
  s = String(s || '');
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      let n = 0;
      for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n++;   // eslint-disable-line no-unused-vars
      return n;
    }
  } catch { /* fall through */ }
  return [...s].length;
}
const countLinks = (s) => (String(s || '').match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) || []).length;
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const sigOf = (a) => JSON.stringify([a.id, a.platform, a.op, a.text, a.title, a.target, a.reply_to]);

function flash(text, tone = '', ms = 6000) { ui.flash = { text, tone, until: Date.now() + ms }; renderFlash(); }
function renderFlash() {
  const el = $('c-status');
  const f = ui.flash && ui.flash.until > Date.now() ? ui.flash : null;
  el.textContent = f ? f.text : '';
  el.dataset.tone = f ? f.tone : '';
}

// ---- data ------------------------------------------------------------------
async function probe(cfg) {
  const r = await fetchJson(baseUrl(cfg) + '/health');
  if (r.status === 200 && r.body && r.body.app === 'workspacehq') {
    ui.conn = 'on'; ui.connErr = ''; ui.needsToken = !!r.body.needsToken;
  } else if (r.status === 0) {
    ui.conn = 'off'; ui.connErr = r.error || 'unreachable';
  } else {
    ui.conn = 'foreign'; ui.connErr = `HTTP ${r.status} — not a workspace-hq answer`;
  }
}
async function loadOutbox(cfg) {
  if (ui.conn !== 'on') { ui.outbox = null; return; }
  const r = await fetchJson(baseUrl(cfg) + '/social/outbox', { headers: appHeaders(cfg, false) });
  if (r.status === 200 && r.body && Array.isArray(r.body.actions)) {
    ui.outbox = { actions: r.body.actions.filter((a) => a && a.id && a.status === 'staged') };
  } else if (r.status === 401 || r.status === 403) ui.outbox = { refused: true };
  else ui.outbox = { error: r.error || (r.body && r.body.error) || `HTTP ${r.status}` };
}
const stagedList = () => (ui.outbox && ui.outbox.actions) || [];
// The buttons act on what the human is looking at, never on a selection the
// card hasn't rendered yet.
const shownAction = () => (ui.shown && !$('card').hidden ? ui.shown : null);

// ---- render ----------------------------------------------------------------
async function renderLocal() {
  const { hq_state } = await chrome.storage.local.get('hq_state');
  const cfg = await getCfg();
  const s = hq_state || {};
  const cur = !cfg.paused ? s.current : null;
  $('now-host').textContent = cfg.paused ? 'capture paused' : (cur ? (cur.host || cur.domain) : '— idle —');
  $('now-dur').textContent = cur && cur.start ? fmtDur(Date.now() - cur.start) : '';
  $('now-title').textContent = cur ? (cur.title || '') : '';
  const queued = (s.queue || []).length;
  $('cap').textContent = `${plural(queued, 'focus session', 'focus sessions')} queued · `
    + (s.lastOk ? `last delivered ${fmtDur(Date.now() - s.lastOk)} ago` : 'nothing delivered yet');
  const fresh = s.lastOk && (Date.now() - s.lastOk < 90_000);
  $('err').textContent = (!fresh && s.lastError) ? `last delivery failed: ${s.lastError}` : '';
}

function renderConn(cfg) {
  const el = $('conn');
  const refused = ui.conn === 'on' && ui.outbox && ui.outbox.refused;
  if (ui.conn === 'checking') { el.dataset.state = 'checking'; el.textContent = '◌ checking…'; }
  else if (refused) { el.dataset.state = 'warn'; el.textContent = '● token refused'; }
  else if (ui.conn === 'on') { el.dataset.state = 'on'; el.textContent = '● connected'; }
  else { el.dataset.state = 'off'; el.textContent = '○ not connected'; }

  const off = ui.conn === 'off' || ui.conn === 'foreign';
  $('offline').hidden = !off;
  if (off) {
    $('off-title').textContent = ui.conn === 'foreign' ? 'Something else is answering' : 'Not connected';
    $('off-msg').textContent = ui.conn === 'foreign'
      ? 'The endpoint answered, but not as workspace-hq. Check the endpoint in settings.'
      : 'Open workspace-hq on this PC, then check again. Data stays on this machine.';
    $('off-err').textContent = `${baseUrl(cfg)} · ${ui.connErr}`;
  }
}

function fillCard(a) {
  const target = a.target ? 'to ' + (a.platform === 'reddit' ? 'r/' + String(a.target).replace(/^\/?r\//i, '') : a.target) : '';
  $('c-who').textContent = [a.platform || '?', a.op || 'post', target].filter(Boolean).join(' · ');
  $('c-reply').hidden = !a.reply_to;
  $('c-reply').textContent = a.reply_to ? `reply to ${a.reply_to}` : '';
  $('c-title').hidden = !a.title;
  $('c-title').textContent = a.title || '';           // textContent — never render post text as HTML
  $('c-text').textContent = a.text || '(no text)';
  $('c-text').scrollTop = 0;
  const links = countLinks(a.text) + countLinks(a.title);
  const parts = ['full payload shown', plural(countChars(a.text), 'char', 'chars')];
  if (a.title) parts.push(`title ${plural(countChars(a.title), 'char', 'chars')}`);
  parts.push(links ? plural(links, 'link', 'links') : 'no links');
  const staged = Date.parse(a.staged_at || '');
  if (Number.isFinite(staged)) parts.push(`staged ${fmtDur(Date.now() - staged)} ago`);
  $('c-meta').textContent = parts.join(' · ');
  ui.shown = a;
}

function lockCard(locked) {
  for (const id of ['approve', 'skip', 'prev', 'next']) $(id).disabled = locked;
}

function renderApproval() {
  const cfg = ui.cfg;
  $('appr').hidden = ui.conn !== 'on';
  renderFlash();
  if (ui.conn !== 'on' || ui.busy) return;   // never swap or unlock the card mid-send/skip

  const ob = ui.outbox;
  const actions = stagedList();
  let empty = '';
  if (!ob) empty = 'loading…';
  else if (ob.refused) empty = ui.needsToken && !cfg.token
    ? 'The app is locked with a token — paste the value from its data/.bridge-token into settings.'
    : 'The app refused this extension — check the token in settings.';
  else if (ob.error) empty = `could not read the outbox: ${ob.error}`;
  else if (!actions.length) empty = 'nothing staged';

  if (empty) {
    $('appr-k').textContent = 'awaiting approval';
    $('appr-empty').textContent = empty;
    $('appr-empty').hidden = false;
    $('card').hidden = true;
    $('prev').hidden = $('next').hidden = true;
    ui.curId = null; ui.renderedSig = ''; ui.shown = null;
    return;
  }

  // Keep the same post on screen while it is still staged; otherwise show the
  // one that moved into its position (the next one after a send / skip).
  let idx = actions.findIndex((a) => a.id === ui.curId);
  if (idx === -1) idx = Math.min(ui.curIdx, actions.length - 1);
  const a = actions[idx];
  ui.curIdx = idx; ui.curId = a.id;

  $('appr-k').textContent = `awaiting approval · ${idx + 1} of ${actions.length}`;
  $('appr-empty').hidden = true;
  $('card').hidden = false;
  const many = actions.length > 1;
  $('prev').hidden = $('next').hidden = !many;
  const sig = sigOf(a);
  if (sig !== ui.renderedSig) { fillCard(a); ui.renderedSig = sig; }
  lockCard(false);
  $('prev').disabled = idx === 0;
  $('next').disabled = idx === actions.length - 1;
}

async function refresh() {
  if (ui.refreshing) { ui.again = true; return; }
  ui.refreshing = true;
  try {
    do {
      ui.again = false;
      const cfg = await getCfg();
      ui.cfg = cfg;
      await probe(cfg);
      await loadOutbox(cfg);
      renderConn(cfg);
      renderApproval();
      await renderLocal();
    } while (ui.again);
  } catch (e) {
    $('err').textContent = String((e && e.message) || e);
  } finally { ui.refreshing = false; }
}

// After a send/skip: give the app a beat to write, then unlock and re-read.
async function settle() {
  await new Promise((r) => setTimeout(r, 700));
  ui.busy = null;
  ui.renderedSig = '';
  await refresh();
}

// ---- approval actions ------------------------------------------------------
$('approve').addEventListener('click', async () => {
  const a = shownAction();
  if (!a || ui.busy) return;
  ui.busy = { id: a.id, kind: 'send' };
  lockCard(true);
  flash('sending…', '', 60_000);
  let res;
  try { res = await chrome.runtime.sendMessage({ type: 'social:send', action: a }); }
  catch (e) { res = { ok: false, error: 'the extension did not answer: ' + String((e && e.message) || e) }; }
  if (res && res.ok) flash('sent ✓' + (res.url ? ` · ${res.url}` : ''), 'ok', 8000);
  else flash('not sent — ' + ((res && res.error) || 'no result from the extension'), 'bad', 10_000);
  await settle();
});

$('skip').addEventListener('click', async () => {
  const a = shownAction();
  if (!a || ui.busy) return;
  ui.busy = { id: a.id, kind: 'skip' };
  lockCard(true);
  flash('skipping…', '', 60_000);
  const cfg = await getCfg();
  const r = await fetchJson(baseUrl(cfg) + '/social/outbox/cancel', {
    method: 'POST', headers: appHeaders(cfg, true), body: JSON.stringify({ id: a.id }),
  });
  const err = r.body && r.body.error;
  if (r.status === 200) flash('skipped — canceled, never sent', 'ok');
  else if (r.status === 409) flash(`not skipped — it is already ${(r.body && r.body.status) || 'handled'}`, 'bad', 8000);
  else if (r.status === 404 && err === 'unknown action id') flash('not skipped — it is no longer in the outbox', 'bad', 8000);
  else if (r.status === 404) flash('not skipped — this app version has no skip route yet; restart workspace-hq', 'bad', 10_000);
  else if (r.status === 401 || r.status === 403) flash('not skipped — the app refused this extension (check the token in settings)', 'bad', 10_000);
  else flash('not skipped — ' + (r.error || err || `HTTP ${r.status}`), 'bad', 10_000);
  await settle();
});

function step(delta) {
  if (ui.busy) return;
  const actions = stagedList();
  const i = actions.findIndex((a) => a.id === ui.curId);
  const j = Math.max(0, Math.min(actions.length - 1, (i === -1 ? 0 : i) + delta));
  if (!actions[j]) return;
  ui.curId = actions[j].id; ui.curIdx = j;
  renderApproval();   // synchronous: the card shows the new post before any further click
}
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));

$('social-sync').addEventListener('click', async () => {
  const b = $('social-sync'); b.disabled = true; b.textContent = '…';
  try { await chrome.runtime.sendMessage({ type: 'social:sync' }); } catch { /* service worker asleep */ }
  setTimeout(() => { b.disabled = false; b.textContent = 'sync'; refresh(); }, 1600);
});

// "check again": re-probe now; when the app answers, push queued focus sessions.
$('retry').addEventListener('click', async () => {
  ui.conn = 'checking';
  renderConn(await getCfg());
  await refresh();
  if (ui.conn === 'on') { try { await chrome.runtime.sendMessage({ type: 'bridge:flush' }); } catch { /* ignore */ } renderLocal(); }
});

// ---- capture + settings ----------------------------------------------------
async function patchCfg(patch) {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  await chrome.storage.local.set({ hq_cfg: { ...DEFAULTS, ...(hq_cfg || {}), ...patch } });
}

$('paused').addEventListener('change', async (e) => { await patchCfg({ paused: e.target.checked }); renderLocal(); });

$('save').addEventListener('click', async () => {
  const endpoint = ($('endpoint').value || DEFAULTS.endpoint).trim();
  let ok = false;
  try { ok = /^https?:$/.test(new URL(endpoint).protocol); } catch { /* invalid */ }
  if (!ok) { $('saved').textContent = 'endpoint must be an http:// URL'; return; }
  await patchCfg({ endpoint, token: $('token').value.trim() });
  $('saved').textContent = 'saved ✓';
  setTimeout(() => ($('saved').textContent = ''), 1500);
  ui.conn = 'checking';
  refresh();
});

// Mastodon is federated — grant host permission for the user's specific instance
// so chrome.scripting can inject the adapter there, then remember the host.
$('masto-connect').addEventListener('click', async () => {
  const raw = ($('masto').value || '').trim();
  if (!raw) { $('masto-status').textContent = 'enter your instance URL'; return; }
  let origin;
  try { origin = new URL(raw).origin; } catch { $('masto-status').textContent = 'invalid URL'; return; }
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted) { $('masto-status').textContent = 'permission denied'; return; }
  await patchCfg({ mastodonHost: origin });
  $('masto-status').textContent = 'connected ✓ ' + origin;
});

// Settings fields are filled once — the poll never overwrites what you're typing.
getCfg().then((cfg) => {
  $('paused').checked = !!cfg.paused;
  $('endpoint').value = cfg.endpoint;
  $('token').value = cfg.token || '';
  $('masto').value = cfg.mastodonHost || '';
});

refresh();
setInterval(refresh, POLL_MS);
