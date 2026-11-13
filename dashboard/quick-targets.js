// Quick-jump, main side (Ctrl+Alt+X palette: "Needs you" rows + Go mode). Three IPC channels the palette calls:
//   hq:quick:read ()                 → { brief:[{ ref, label, scan }], status, projects:[{ id, name }] | null, use:{ marks, byTarget } | null } | { error }
//   hq:quick:open-brief (ref)        → 'go' | 'scan' | 'none' | { error }      (the palette closes itself after)
//   hq:quick:open-go (route)         → { ok: true } | { error }                (route = { tab, sub?, projectId? }, validated again here)
//
// The cast window loads the SAME shared preload as the main window, so it receives every hq.* group; a new preload group narrows
// nothing and this module does not pretend it does. Instead EVERY handler checks the sender: isCastSender(e) must say the event came
// from the cast window's own webContents, otherwise the answer is { error } and nothing happens. A missing isCastSender fails closed.
//
// What leaves main is only what the palette may draw: the Brief rows are the tray's screen-safe projection (tray-brief.view().rows:
// a 12-hex ref, the fixed-wording label, a scan flag; never the reason, an amount, a path or a name), and the project list is
// latest.json's { id, name } and nothing else. A Brief row's click goes back through trayBrief.open(ref, showMainAt), which maps the
// ref to the item's full action in the CURRENT brief; it never travels through the projection. A scan row runs runScan() (the tray's
// "Scan now" path; false = not started, said honestly). A Go route is checked against the same table the palette draws from
// (cast-modes.js goTable), nav-bridge's cleanRoute (SEG_RE / ID_RE), and, for a project, latest.json.
//
// `use` is COUNTS ONLY from the last 14 days of use marks (use-counts.js: { marks, byTarget:{ 'tab/sub': n } }); null when the counter throws.
// The palette breaks ties of a typed query with it, once it holds 10 counted opens (cast-modes.js).
// create({ latest, trayBrief, showMainAt, runScan, log, isCastSender, cleanRoute?, useCounts? }) → { read(e), openBrief(e, ref), openGo(e, route) }
//   latest()            the parsed latest.json or null (main's latest())
//   trayBrief           tray-brief.create() instance (view(), open(ref, showMainAt))
//   showMainAt(route)   main's showMainAt (the nav-bridge openAt path)
//   runScan()           main's runScan → boolean (false = a scan did not start)
//   log({ surface, action })   one use mark per success, e.g. (f) => useLog.mark(f.surface, f.action); never names; a throw never blocks
//   isCastSender(e)     (e) => !!castWin && e.sender === castWin.webContents
//   useCounts           { read() } test seam; default is use-counts.create(), built lazily on the first read (follows app-log's folder rule, main.js needs no edit)
// init({ ipcMain, ...deps }) → the same object; registers the three channels. Handlers answer { error } instead of throwing.
const { cleanRoute: navCleanRoute } = require('./nav-bridge');
const modes = require('./cast-modes.js');

const REF_RE = /^[0-9a-f]{12}$/;
const STATUSES = ['ok', 'empty', 'incomplete', 'not-ready'];
const PROJECTS_MAX = 2000, NAME_MAX = 80, LABEL_MAX = 64, ROWS_MAX = 3;
const NOT_HERE = 'not available from this window';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clip = (s, n) => { const c = Array.from(String(s)); return c.length <= n ? c.join('') : c.slice(0, n - 1).join('') + '…'; };
const msg = (e) => String((e && e.message) || e || 'unknown error').slice(0, 200);

// the one table of valid (tab, sub) pairs: the palette's own
const TABS = new Set(modes.goTable.filter((t) => t.kind === 'space').map((t) => t.tab));
const SUBS = new Set(modes.goTable.filter((t) => t.kind === 'sub').map((t) => t.tab + '/' + t.sub));
// every key a counts object may carry (a space is 'tab/', a sub-view 'tab/sub'); anything else a counter returns is dropped
const GO_KEYS = new Set(modes.goTable.map((t) => t.tab + '/' + (t.sub || '')));

function create({ latest, trayBrief, showMainAt, runScan, log, isCastSender, cleanRoute = navCleanRoute, useCounts } = {}) {
  let counter = useCounts || null;
  const fromCast = (e) => { try { return typeof isCastSender === 'function' && isCastSender(e) === true; } catch { return false; } };
  const mark = () => { try { if (typeof log === 'function') log({ surface: 'quick-jump', action: 'open' }); } catch { /* a usage mark never blocks a jump */ } };

  // latest.json's { id, name } for ids a route can carry (ID_RE); null = latest.json is absent or unreadable
  function projects() {
    let L = null;
    try { L = typeof latest === 'function' ? latest() : null; } catch { L = null; }
    if (!isObj(L) || !Array.isArray(L.projects)) return null;
    const out = [];
    for (const p of L.projects) {
      if (out.length >= PROJECTS_MAX) break;
      if (!isObj(p) || typeof p.id !== 'string' || !cleanRoute({ tab: 'projects', projectId: p.id })) continue;
      out.push({ id: p.id, name: clip(typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id, NAME_MAX) });
    }
    return out;
  }

  // { marks, byTarget } of plain numbers, or null; a counter that throws, or answers anything else, is null and never an error
  function use() {
    try {
      if (!counter) counter = require('./use-counts.js').create();
      const u = counter.read();
      if (!isObj(u) || !isObj(u.byTarget) || !Number.isFinite(u.marks)) return null;
      const byTarget = {};
      for (const k of Object.keys(u.byTarget)) { const n = u.byTarget[k]; if (GO_KEYS.has(k) && Number.isFinite(n) && n > 0) byTarget[k] = Math.floor(n); }
      return { marks: Math.max(0, Math.floor(u.marks)), byTarget };
    } catch { return null; }
  }

  function read(e) {
    if (!fromCast(e)) return { error: NOT_HERE };
    try {
      let v = null;
      try { v = trayBrief && typeof trayBrief.view === 'function' ? trayBrief.view() : null; } catch { v = null; }
      const rows = isObj(v) && Array.isArray(v.rows) ? v.rows : [];
      const brief = [];
      for (const r of rows) {
        if (brief.length >= ROWS_MAX) break;
        if (!isObj(r) || typeof r.ref !== 'string' || !REF_RE.test(r.ref) || typeof r.label !== 'string' || !r.label.trim()) continue;
        brief.push({ ref: r.ref, label: clip(r.label.trim(), LABEL_MAX), scan: r.scan === true });
      }
      return { brief, status: isObj(v) && STATUSES.includes(v.status) ? v.status : 'not-ready', projects: projects(), use: use() };
    } catch (err) { return { error: msg(err) }; }
  }

  function openBrief(e, ref) {
    if (!fromCast(e)) return { error: NOT_HERE };
    try {
      if (typeof ref !== 'string' || !REF_RE.test(ref) || !trayBrief || typeof trayBrief.open !== 'function') return 'none';
      const r = trayBrief.open(ref, showMainAt);
      if (r === 'scan') {
        if (typeof runScan !== 'function') return { error: 'a scan cannot be started from here' };
        if (runScan() === false) return { error: 'the scan did not start (one may already be running)' };
        mark();
        return 'scan';
      }
      if (r === 'go') { mark(); return 'go'; }
      return 'none';
    } catch (err) { return { error: msg(err) }; }
  }

  function openGo(e, route) {
    if (!fromCast(e)) return { error: NOT_HERE };
    try {
      const c = cleanRoute(route);
      if (!c || !TABS.has(c.tab)) return { error: 'not a place in the app' };
      const want = { tab: c.tab };
      if (c.sub != null) {
        if (!SUBS.has(c.tab + '/' + c.sub) || c.projectId != null) return { error: 'not a place in the app' };
        want.sub = c.sub;
      }
      if (c.projectId != null) {
        if (c.tab !== 'projects') return { error: 'not a place in the app' };
        const list = projects();
        if (!list) return { error: 'no projects loaded' };
        if (!list.some((p) => p.id === c.projectId)) return { error: 'that project is not in the latest scan' };
        want.projectId = c.projectId;
      }
      if (typeof showMainAt !== 'function') return { error: 'the app window cannot be opened from here' };
      showMainAt(want);
      mark();
      return { ok: true };
    } catch (err) { return { error: msg(err) }; }
  }

  return { read, openBrief, openGo };
}

function init({ ipcMain, ...deps } = {}) {
  const q = create(deps);
  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle('hq:quick:read', (e) => q.read(e));
    ipcMain.handle('hq:quick:open-brief', (e, ref) => q.openBrief(e, ref));
    ipcMain.handle('hq:quick:open-go', (e, route) => q.openGo(e, route));
  }
  return q;
}

module.exports = { create, init, NOT_HERE };
