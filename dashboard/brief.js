// Operator Brief, main side (spec docs/superpowers/specs/2026-11-05-operator-design.md; IPC-CONTRACT 2026-11-05).
// Gathers what the pure engine (brief-core.mjs) needs — latest.json, pc-health.json, the money view + money/meta.json,
// Claude Hub health, the scan run — computes the brief, writes data/brief.json atomically (MCP hq_brief reads it),
// serves hq:brief:read / hq:brief:dismiss, and pushes hq:brief to the windows when the facts moved.
// Never throws at a caller: a source that can't be read becomes an `errors` entry and the brief goes on without it.
//
// create({ dataDir, money, hub, liveState, getSessionBoard?, decorate?, now }) → { compute(), dismiss(key), buildInputs(), current(), sources() }   (pure-ish, for tests)
//   getSessionBoard() → the sessions board main already builds (the session-waiting rule's input; absent = that rule is silent)
//   decorate(brief) → brief  (async ok) — brief-act.js adds the additive acted:{verb,at} marker to rows the owner acted on, before the write and push
//   current() → the last computed brief | null;  sources() → the live records the act-in-place rules were built from (brief-act.js rebuilds keys from them)
// init({ ipcMain, dataDir, money, hub, liveState, notify, getWins, onBrief?, getSessionBoard?, decorate?, intervalMs?, watch?, now? }) → { recompute(), recomputeNow(), onBoard(board), dismissKey(key), current(), sources(), stop() }
//   dismissKey(key) → { changed, brief }: hq:brief:dismiss's own path for a caller that is not a window (the session door, dashboard/intent-inbox.js)
//   onBoard(board): the sessions board pushed; the brief re-runs only when the set of waiting sessions it could name has changed
//   onBrief(brief, firstSeen) is called after each change (and every 10 min otherwise, so the tray's age stays true);
//   firstSeen = brief-state.json's { key: {first, last} } — it survives the toast bookkeeping (settle merges it back in).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'brief-core.mjs')).href));
const RECOMPUTE_MS = 15 * 60e3, DEBOUNCE_MS = 1500, KEY_MAX = 200, DISMISSED_MAX = 200;
const FIRSTSEEN_MAX = 200, FIRSTSEEN_KEEP_MS = 7 * 24 * 3600e3, ONBRIEF_REFRESH_MS = 10 * 60e3;
const FIRSTSEEN_GAP_MS = 3600e3;   // a key off the brief this long (while the app was computing) starts a new clock when it returns

const msg = (e) => String((e && e.message) || e).slice(0, 200);
// { value } | { value: null, error } — an absent file is reported with `absent` so each source can phrase it
function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { value: null, absent: e.code === 'ENOENT', error: e.code === 'ENOENT' ? null : msg(e) }; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { value: null, error: 'unreadable (' + msg(e) + ')' }; }
}
// { key: {first, last, gone?} } with ISO strings (gone = when a computation first found the key off the brief); anything else is dropped, at most FIRSTSEEN_MAX entries (the newest `last`)
function cleanFirstSeen(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  const rows = [];
  for (const [k, v] of Object.entries(x)) {
    if (typeof k !== 'string' || !k || k.length > KEY_MAX || !v || typeof v !== 'object') continue;
    const f = Date.parse(v.first), l = Date.parse(v.last);
    if (!(Number.isFinite(f) && Number.isFinite(l))) continue;
    const row = { first: new Date(f).toISOString(), last: new Date(l).toISOString() };
    const g = typeof v.gone === 'string' ? Date.parse(v.gone) : NaN;
    if (Number.isFinite(g)) row.gone = new Date(g).toISOString();
    rows.push([k, row, l]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  for (const [k, v] of rows.slice(0, FIRSTSEEN_MAX)) out[k] = v;
  return out;
}
function writeAtomic(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

function create({ dataDir, money, hub, liveState, getSessionBoard, decorate, now = () => new Date() }) {
  const briefFile = path.join(dataDir, 'brief.json'), stateFile = path.join(dataDir, 'brief-state.json');
  let last = null, lastSig = null, lastInputs = null;

  function loadState() {
    const r = readJson(stateFile).value;
    return { dismissed: Array.isArray(r && r.dismissed) ? r.dismissed.filter((k) => typeof k === 'string').slice(-DISMISSED_MAX) : [],
      toasted: r && r.toasted && typeof r.toasted === 'object' && !Array.isArray(r.toasted) ? r.toasted : {},
      lastTop: r && typeof r.lastTop === 'string' ? r.lastTop : null,   // change-only toasts: the top key last seen outside quiet hours
      firstSeen: cleanFirstSeen(r && r.firstSeen) };   // when each live key was first / last on the brief (the tray's "new")
  }
  function saveState(st) { try { writeAtomic(stateFile, st); } catch { /* the brief still works; it just forgets */ } }

  async function buildInputs() {
    const errors = [];
    const scanR = readJson(path.join(dataDir, 'latest.json'));
    if (scanR.absent) errors.push({ source: 'scan', error: 'no scan yet (data/latest.json is missing)' });
    else if (scanR.error) errors.push({ source: 'scan', error: 'data/latest.json ' + scanR.error });
    const pcR = readJson(path.join(dataDir, 'pc-health.json'));
    if (pcR.absent) errors.push({ source: 'pc-health', error: 'no PC health check yet' });
    else if (pcR.error) errors.push({ source: 'pc-health', error: 'data/pc-health.json ' + pcR.error });
    let moneyView = null;
    if (money && typeof money.read === 'function') {
      try { const r = await money.read(); if (r && r.error) errors.push({ source: 'money', error: String(r.error) }); else moneyView = (r && r.view) || null; }
      catch (e) { errors.push({ source: 'money', error: msg(e) }); }
    }
    const moneyMeta = readJson(path.join(dataDir, 'money', 'meta.json')).value;   // absent = never exported, which is itself a fact
    let hubH = null;
    if (!hub || typeof hub.request !== 'function') errors.push({ source: 'claude', error: 'Claude Hub is not running' });
    else {
      try {
        const r = await hub.request('health', {}, { timeout: 5000 });
        if (r && typeof r.error === 'string') errors.push({ source: 'claude', error: r.error }); else hubH = r ? { webCount: r.webCount, lastSyncAt: r.lastSyncAt } : null;
      } catch (e) { errors.push({ source: 'claude', error: msg(e) }); }
    }
    let liveScan = null;
    try { liveScan = liveState && typeof liveState.snapshot === 'function' ? liveState.snapshot().scan : null; } catch { liveScan = null; }
    // the senses' sources (github.json, accounts.json, pc-health detail, the Hub's recent sessions): never throws, a failure is an errors[] entry
    let s = {};
    try { s = await require('./brief-sources').gather({ dataDir, hub, now: now(), scan: scanR.value }); }
    catch (e) { s = { errors: [{ source: 'brief-senses', error: msg(e) }] }; }
    let sessionBoard = null;
    try { sessionBoard = typeof getSessionBoard === 'function' ? getSessionBoard() || null : null; } catch { sessionBoard = null; }
    return { scan: scanR.value, liveScan, pc: pcR.value, money: moneyView, moneyMeta, hub: hubH, sessionBoard,
      github: s.github, vercel: s.vercel, pcDetail: s.pcDetail, sessions: s.sessions, hubProjects: s.hubProjects, sessionTurns: s.sessionTurns, docsRoot: s.docsRoot,
      errors: errors.concat(Array.isArray(s.errors) ? s.errors : []) };
  }

  async function compute() {
    const L = await lib();
    const st = loadState();
    const inputs = await buildInputs();
    const t = now();
    // firstSeen: before the engine reads it, forget keys not live for 7 days, and keys a computation found OFF the brief an hour or more ago
    // (a key that left and came back starts a fresh clock; a closed app leaves no `gone` mark, so it is not a gap)
    const iso = t.toISOString(), firstSeen = {};
    for (const [k, v] of Object.entries(st.firstSeen)) {
      if (t.getTime() - Date.parse(v.last) >= FIRSTSEEN_KEEP_MS) continue;
      if (v.gone && t.getTime() - Date.parse(v.gone) >= FIRSTSEEN_GAP_MS) continue;
      firstSeen[k] = v;
    }
    const seen = Object.assign({}, firstSeen);
    // standing items (unchanged for 72 h) step aside inside the engine, from firstSeen's first time for the exact key
    let brief = L.computeBrief(inputs, { now: t, dismissed: st.dismissed, firstSeen });
    lastInputs = { inputs, at: t.getTime() };
    // then stamp `first` on a key seen for the first time and `last` on every live key (standing ones too, or their clock would be pruned)
    const liveKeys = new Set();
    for (const it of brief.items.concat(brief.overflow || [], brief.standing || [])) { liveKeys.add(it.key); firstSeen[it.key] = { first: firstSeen[it.key] ? firstSeen[it.key].first : iso, last: iso }; }
    // a remembered key that is not on this brief: mark when it was first found missing (cleared the moment it is live again)
    for (const [k, v] of Object.entries(seen)) if (!liveKeys.has(k)) firstSeen[k] = { first: v.first, last: v.last, gone: v.gone || iso };
    st.firstSeen = cleanFirstSeen(firstSeen);
    // acted:{verb,at} on rows the owner acted on (brief-act.js, in memory) — added outside the engine, so the engine's output is unchanged
    if (typeof decorate === 'function') { try { const d = await decorate(brief); if (d && typeof d === 'object') brief = d; } catch { /* a marker is a courtesy: the brief goes on without it */ } }
    try { writeAtomic(briefFile, brief); } catch (e) { brief.errors.push({ source: 'brief', error: 'data/brief.json not written — ' + msg(e) }); }
    const sig = JSON.stringify([brief.items, brief.more, brief.overflow, brief.standing, brief.errors]);   // generatedAt alone is not a change
    const changed = sig !== lastSig;
    lastSig = sig; last = brief;
    return { brief, changed, state: st, firstSeen: st.firstSeen };
  }

  async function dismiss(key) {
    if (!last) await compute();
    // only a key the owner can currently see is dismissable — a forged or stale key is a no-op, never a write
    if (typeof key !== 'string' || !key || key.length > KEY_MAX || !last.items.some((i) => i.key === key)) return { brief: last, changed: false };
    const st = loadState();
    if (!st.dismissed.includes(key)) st.dismissed = st.dismissed.concat([key]).slice(-DISMISSED_MAX);
    saveState(st);
    return compute();
  }

  // the live records the three record-backed rules were built from, taken from the SAME inputs the last compute used, so an act and the rule can
  // never disagree: red quests (the quest-red rule's list), accounts flagged stale, the board's cards that have waited 15 min to 2 h
  async function sources() {
    if (!lastInputs) return null;
    const i = lastInputs.inputs, isO = (x) => !!x && typeof x === 'object' && !Array.isArray(x), a = (x) => (Array.isArray(x) ? x : []);
    let waitingSessions = [];
    try { const W = await import(pathToFileURL(path.join(__dirname, 'brief-session-waiting.mjs')).href); waitingSessions = W.waitingCards(i.sessionBoard, lastInputs.at).map((c) => ({ id: c.id, lastAt: c.lastAt })); } catch { waitingSessions = []; }
    return {
      redQuests: a(isO(i.scan) && i.scan.quests).filter((q) => isO(q) && q.tier === 'red' && q.status !== 'done').map((q) => ({ id: q.id })),
      staleAccounts: a(isO(i.money) && i.money.accounts).filter((x) => isO(x) && x.stale === true).map((x) => ({ id: x.id, anchorAt: x.anchorAt })),
      waitingSessions,
    };
  }

  return { compute, dismiss, buildInputs, loadState, saveState, current: () => last, sources, files: { briefFile, stateFile } };
}

function init({ ipcMain, dataDir, money, hub, liveState, notify, getWins, onBrief, getSessionBoard, decorate, intervalMs = RECOMPUTE_MS, watch = true, now }) {
  const b = create({ dataDir, money, hub, liveState, getSessionBoard, decorate, now });
  const push = (brief) => {
    for (const w of (getWins ? getWins() : [])) { try { if (w && !w.isDestroyed()) w.webContents.send('hq:brief', brief); } catch { /* a window mid-teardown */ } }
  };
  const SEV_WORD = { high: 'urgent', med: 'soon', low: 'when you can' };
  // P2: after every compute, the change-only toast decision (brief-core shouldToast: top item, high only, once per key per
  // 24 h, quiet 23:00–08:00 local). Its history lives in brief-state.json so a restart never re-toasts the same thing.
  let notifiedAt = 0;
  async function settle(r) {
    if (r.changed) push(r.brief);
    // the tray (and any later surface) hears about a change, and every 10 minutes otherwise; a throwing listener never fails the brief
    const t = (now ? now() : new Date()).getTime();
    if (typeof onBrief === 'function' && (r.changed || t - notifiedAt >= ONBRIEF_REFRESH_MS)) { notifiedAt = t; try { onBrief(r.brief, r.firstSeen); } catch { /* a menu refresh is a courtesy */ } }
    try {
      const L = await lib();
      const d = L.shouldToast(r.brief, b.loadState(), now ? now() : new Date());
      b.saveState({ ...d.state, firstSeen: r.firstSeen || b.loadState().firstSeen });   // shouldToast rebuilds the state without it
      if (d.toast && typeof notify === 'function') notify('WorkspaceHQ · ' + (SEV_WORD[d.toast.severity] || d.toast.severity), d.toast.text);
    } catch { /* a toast is a courtesy: it never fails the brief */ }
    return r;
  }
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { b.compute().then(settle).catch(() => {}); }, DEBOUNCE_MS); if (timer.unref) timer.unref(); };

  ipcMain.handle('hq:brief:read', async () => ({ brief: (await settle(await b.compute())).brief }));
  ipcMain.handle('hq:brief:dismiss', async (_e, key) => ({ brief: (await settle(await b.dismiss(key))).brief }));

  const watchers = [];
  const offs = [];
  if (watch) {
    // the facts the brief reads change on disk (scan, PC health, money); its own brief.json writes are ignored, or it would loop
    const watchDir = (dir, names) => { try { const w = fs.watch(dir, (_ev, f) => { if (!f || names.includes(String(f))) schedule(); }); watchers.push(w); return true; } catch { return false; } };
    watchDir(dataDir, ['latest.json', 'pc-health.json', 'github.json', 'accounts.json', 'money']);
    const moneyDir = path.join(dataDir, 'money');
    if (!watchDir(moneyDir, ['state.json', 'meta.json'])) {
      // data/money/ appears on the first money write: attach then
      const w = fs.watch(dataDir, (_ev, f) => { if (String(f) === 'money' && watchDir(moneyDir, ['state.json', 'meta.json'])) w.close(); });
      watchers.push(w);
    }
  }
  if (liveState && typeof liveState.onChange === 'function') offs.push(liveState.onChange((p) => { if (p && (p.state === 'done' || p.state === 'failed')) schedule(); }));
  const tick = intervalMs > 0 ? setInterval(schedule, intervalMs) : null;
  if (tick && tick.unref) tick.unref();
  schedule();   // one compute at startup, so data/brief.json (and MCP hq_brief) is fresh before any window asks

  // the sessions board pushed: re-run only when the waiting sessions the rule could name are not the ones the last run saw (a card crossing 15 min, or leaving)
  let waitSig = '';
  async function onBoard(board) {
    try {
      const W = await import(pathToFileURL(path.join(__dirname, 'brief-session-waiting.mjs')).href);
      const sig = W.waitingCards(board, (now ? now() : new Date()).getTime()).map((c) => c.id + '@' + c.lastAt).join('|');
      if (sig !== waitSig) { waitSig = sig; schedule(); }
    } catch { /* the board is a courtesy input */ }
  }
  // the session door (intent-inbox.js): the SAME path as hq:brief:dismiss, settled the same way, answering the real changed flag so a dismissal that did nothing is never reported as done
  const dismissKey = async (key) => { const r = await settle(await b.dismiss(key)); return { changed: r.changed === true, brief: r.brief }; };
  const recomputeNow = () => b.compute().then(settle).catch(() => null);   // after an act: the row's done line should not wait out the debounce

  return {
    recompute: schedule, recomputeNow, onBoard, dismissKey, current: b.current, sources: b.sources,
    stop() { clearTimeout(timer); if (tick) clearInterval(tick); for (const w of watchers) { try { w.close(); } catch { /* closed */ } } for (const off of offs) { try { off(); } catch { /* gone */ } } },
    _brief: b, _notify: notify,
  };
}

module.exports = { create, init };
