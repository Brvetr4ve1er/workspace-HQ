// The Brief in the tray (spec: "what the owner sees in the tray"). Holds the latest brief and turns it into what the tray
// menu shows: a status line, up to 3 rows, one "+N more" line, and a tooltip. Everything it SHOWS comes from the screen-safe
// projection (brief-project.mjs: fixed wording, counts, no names); a row's click maps its ref back to the item's full
// action in the CURRENT brief (never through the projection) and opens the main window there.
//
// It never pops up, blinks or notifies: set() only stores, view() only reads. Toasts stay change-only (brief-core shouldToast).
//
// create({ log, now?, onChange? }) → {
//   set(brief, firstSeen?)   store the newest brief (brief.js onBrief). firstSeen = brief-state.json's { key: {first,last} };
//                            without it the tray stamps keys itself, so "new" then means "new since the app started".
//   view()  → { status:'not-ready'|'ok'|'empty'|'incomplete', statusLine, noteLine|null, fromLine|null ('from HH:MM' when the brief is older than 30 min), showLevel, total, newCount,
//               standingLine|null ('2 standing since 5 Nov': a count and a date), rows:[{ ref, label, scan }], overflow: { label } | null }      (always an object: never throws)
//   tooltip() → string (≤ 127 chars) | null (null = use the caller's own tooltip)
//   open(ref, showMainAt) → 'go' | 'scan' | 'none'   ('scan': the caller runs its existing "Scan now" path)
//   ready → Promise that resolves when the projection module is loaded }
//   log(fields) is called once per row click with { surface:'tray-brief', rule } — rule ids only, never names.
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

let proj = null;
const lib = () => proj || (proj = import(pathToFileURL(path.join(__dirname, 'brief-project.mjs')).href));

const LABEL_MAX = 64, TOOLTIP_MAX = 127, ROWS_MAX = 3, FIRSTSEEN_MAX = 200;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const refOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
const clip = (s, n) => { const c = [...String(s)]; return c.length <= n ? c.join('') : c.slice(0, n - 1).join('') + '…'; };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : null; };
const SEG = /^[a-z]{2,16}$/, ID = /^[\w.-]{1,80}$/;

// a brief action → the route showMainAt takes ({tab, sub?, projectId?}); null when it names nothing openable
function routeOf(action) {
  if (!isObj(action) || action.kind !== 'go' || typeof action.tab !== 'string' || !SEG.test(action.tab)) return null;
  const r = { tab: action.tab };
  if (typeof action.sub === 'string' && SEG.test(action.sub)) r.sub = action.sub;
  if (typeof action.projectId === 'string' && ID.test(action.projectId)) r.projectId = action.projectId;
  return r;
}

function create({ log, now = () => new Date(), onChange } = {}) {
  let brief = null, ext = null;      // the newest brief; the firstSeen map the caller handed over
  const own = {};                     // fallback first-seen stamps (this process only)
  let P = null;                       // the loaded projection module
  const ready = lib().then((m) => { P = m; if (brief && typeof onChange === 'function') { try { onChange(); } catch { /* a menu refresh is a courtesy */ } } }, () => {});

  function set(b, firstSeen) {
    brief = isObj(b) ? b : null;
    ext = isObj(firstSeen) ? firstSeen : null;
    if (!ext && brief) {   // stamp what we see, prune what we no longer do
      const t = now().toISOString(), live = new Set();
      for (const it of arr(brief.items).concat(arr(brief.overflow))) if (isObj(it) && typeof it.key === 'string') { live.add(it.key); if (!own[it.key]) own[it.key] = { first: t, last: t }; else own[it.key].last = t; }
      for (const k of Object.keys(own)) if (!live.has(k)) delete own[k];
      if (Object.keys(own).length > FIRSTSEEN_MAX) for (const k of Object.keys(own).slice(FIRSTSEEN_MAX)) delete own[k];
    }
  }
  const projected = () => (brief && P ? P.projectBrief(brief, { now: now(), firstSeen: ext || own }) : null);

  function view() {
    try {
      const p = projected();
      if (!p) return { status: 'not-ready', statusLine: 'Brief not ready yet', noteLine: null, showLevel: true, total: 0, newCount: 0, rows: [], overflow: null };
      const total = p.items.length + p.more;
      const newCount = p.items.concat(p.overflow).filter((x) => x.isNew).length;
      const t = p.generatedAt ? hhmm(p.generatedAt) : null;
      const from = 'from the ' + (t || 'earlier') + ' brief';
      const srcs = p.errorSources;
      const incomplete = "Brief incomplete · couldn't read " + srcs.slice(0, 2).join(', ') + (srcs.length > 2 ? ' and ' + (srcs.length - 2) + ' more' : '');
      let status, statusLine, noteLine = null;
      if (total > 0) {
        status = srcs.length ? 'incomplete' : 'ok';
        statusLine = ['Needs you', total].concat(newCount ? [newCount + ' new'] : [], [p.stale || !t ? from : t]).join(' · ');
        if (srcs.length) noteLine = incomplete;
      } else if (srcs.length) { status = 'incomplete'; statusLine = incomplete; }
      else { status = 'empty'; statusLine = (p.standing ? 'Nothing new' : 'Nothing needs you') + ' · ' + from; }   // standing items are still there: never claim nothing needs the owner
      const rows = p.items.slice(0, ROWS_MAX).map((x) => ({ ref: x.ref, scan: x.nav.kind === 'scan', label: clip([x.sevWord].concat(x.isNew ? ['new'] : [], [x.text]).join(' · '), LABEL_MAX) }));
      return { status, statusLine, noteLine, standingLine: p.standing ? p.standing.line : null, fromLine: p.stale || !t ? 'from ' + (t || 'earlier') : null, showLevel: false, total, newCount, rows, overflow: p.overflowLine ? { label: clip(p.overflowLine, LABEL_MAX) } : null };
    } catch {
      return { status: 'not-ready', statusLine: 'Brief not ready yet', noteLine: null, showLevel: true, total: 0, newCount: 0, rows: [], overflow: null };
    }
  }

  function tooltip() {
    const v = view();
    if (v.status === 'not-ready') return null;
    let s;
    if (v.total > 0) s = 'WorkspaceHQ — ' + v.total + (v.total === 1 ? ' needs you' : ' need you') + (v.newCount ? ' · ' + v.newCount + ' new' : '');
    else s = v.status === 'incomplete' ? 'WorkspaceHQ — brief incomplete' : v.standingLine ? 'WorkspaceHQ — nothing new · ' + v.standingLine : 'WorkspaceHQ — nothing needs you';
    // honest state: an old brief says whose time it is, a partial one says so (the menu header says both too)
    if (v.fromLine) s += ' · ' + v.fromLine;
    if (v.status === 'incomplete' && v.total > 0) s += ' · incomplete';
    return clip(s, TOOLTIP_MAX);
  }

  // The row's ref → the item in the current brief → its full action. Nothing else decides where a click goes.
  function open(ref, showMainAt) {
    if (typeof ref !== 'string' || !/^[0-9a-f]{12}$/.test(ref) || !brief) return 'none';
    const item = arr(brief.items).concat(arr(brief.overflow)).find((it) => isObj(it) && typeof it.key === 'string' && refOf(it.key) === ref);
    if (!item) return 'none';
    const rule = typeof item.rule === 'string' && /^[a-z-]{1,40}$/.test(item.rule) ? item.rule : 'unknown';
    try { if (typeof log === 'function') log({ surface: 'tray-brief', rule }); } catch { /* logging never blocks a click */ }
    if (isObj(item.action) && item.action.kind === 'scan') return 'scan';
    const route = routeOf(item.action);
    if (!route) return 'none';
    if (typeof showMainAt === 'function') showMainAt(route);
    return 'go';
  }

  return { set, view, tooltip, open, ready };
}

module.exports = { create, routeOf, refOf };
