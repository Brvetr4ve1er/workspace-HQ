// Quick-run palette, the two extra modes (Ctrl+Alt+X): "Needs you" rows on top of the spell list and "Go" (jump anywhere).
// UMD and PURE, like cast.js: cast.html loads it with <script src="./cast-modes.js"> before cast.js (CSP script-src 'self'; the
// page cannot import an ES module) and node tests require() it. No DOM, no IPC, no clock, no fs. Never throws on any input.
//
// goTable is a static COPY of dashboard-v5/src/live/catalog.mjs NAV and SUBS (ids and labels).
// dashboard/quick-targets-parity.test.mjs reads catalog.mjs and fails on drift, so a sub-view added there cannot be missed here.
//
// Exports (also on window.CastModes in a page):
//   MODES = ['run', 'go']            nextMode(mode) → the other one (anything unknown → 'run')
//   MODE_LABELS, HINTS               the chip words and the footer hint line for each mode
//   goTable                          frozen flat list: { kind:'space'|'sub', tab, sub|null, label, own, words }
//   filterGo(query, projects?, table?) → unranked matches [{ ...target, score }]; an empty query = the ten spaces only; projects only
//                                       after at least one typed character
//   rankGo(rows, query)              → sorted copy: score, then spaces before sub-views before projects, then TIE_BREAK, then table order
//   goRows(query, projects?, limit?) → rankGo(filterGo(...)).slice(0, limit)   (what the palette draws in Go mode)
//   briefRows(view)                  → { rows:[{ kind:'brief', ref, label, scan }] (≤ 3), note: string|null } from hq.quick.read()'s answer
//   stateNote(mode, ctx)             → the one honest line for a state with nothing to draw (or a caveat), else null
//   tieBreak(query, a, b)            → negative / 0 / positive for two equal-score rows, from the fixed TIE_BREAK table
//   TIE_BREAK                        { query: ['money/runway', 'automations/runnable'] }  earlier = first; key = tab/sub
//
// A Go row NEVER runs anything: it carries a route { tab, sub?, projectId? } and the page asks main to navigate. Main re-validates it.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.CastModes = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MODES = Object.freeze(['run', 'go']);
  const MODE_LABELS = Object.freeze({ run: 'Run', go: 'Go' });
  const HINTS = Object.freeze({
    run: 'up/down choose · enter run · tab go · esc close',
    go: 'up/down choose · enter open · tab run · esc close',
  });
  const BRIEF_MAX = 3, LABEL_MAX = 64, NAME_MAX = 80, QUERY_MAX = 80, GO_MAX = 8, PROJECTS_SCAN_MAX = 2000;
  const REF_RE = /^[0-9a-f]{12}$/;

  // ---- the static copy of catalog.mjs NAV + SUBS (the parity test pins it) ----
  const SPACES = [['home', 'Home'], ['projects', 'Projects'], ['tasks', 'Tasks'], ['automations', 'Automations'], ['claude', 'Claude'], ['history', 'History'], ['system', 'System'], ['life', 'Life'], ['money', 'Money'], ['cosmos', 'Cosmos'], ['security', 'Security']];
  const SUBS = {
    projects: [['grid', 'Grid'], ['map', 'Map'], ['archived', 'Archived'], ['github', 'GitHub'], ['accounts', 'Vercel & Supabase'], ['clients', 'Clients']],
    tasks: [['ranked', 'Ranked'], ['byproject', 'By project'], ['ideas', 'Ideas & risks']],
    automations: [['runnable', 'Runnable'], ['library', 'Library'], ['scheduled', 'Scheduled']],
    claude: [['chats', 'Chats'], ['projects', 'Projects'], ['sessions', 'Sessions']],
    history: [['trends', 'Trends'], ['timeline', 'Timeline'], ['milestones', 'Milestones']],
    system: [['machine', 'Machine'], ['clutter', 'Workspace clutter']],
    life: [['screen', 'Screen time'], ['notes', 'Notes']],
    money: [['today', 'Today'], ['runway', 'Runway'], ['jars', 'Jars'], ['inbox', 'Inbox']],
    cosmos: [['feed', 'Feed']],
    security: [['map', 'Map'], ['health', 'Health'], ['setup', 'Setup'], ['generate', 'Generator']],
  };

  const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const wordsOf = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const clip = (s, n) => { const c = Array.from(String(s)); return c.length <= n ? c.join('') : c.slice(0, n - 1).join('') + '…'; };

  const goTable = [];
  for (const [tab, label] of SPACES) {
    goTable.push(Object.freeze({ kind: 'space', tab, sub: null, label, own: norm(label), words: Object.freeze(wordsOf(label).concat([tab])) }));
    for (const [sub, subLabel] of SUBS[tab] || []) {
      goTable.push(Object.freeze({
        kind: 'sub', tab, sub, label: label + ' › ' + subLabel, own: norm(subLabel),
        words: Object.freeze(wordsOf(label).concat(wordsOf(subLabel), [tab, sub])),
      }));
    }
  }
  Object.freeze(goTable);

  // when two rows tie on score, a typed query listed here puts these targets first, in this order (key = tab/sub).
  // 'run' is the owner's: Money > Runway before Automations > Runnable. Only the use log should ever change this table.
  const TIE_BREAK = Object.freeze({
    ru: Object.freeze(['money/runway', 'automations/runnable']),
    run: Object.freeze(['money/runway', 'automations/runnable']),
  });

  function nextMode(mode) {
    const i = MODES.indexOf(mode);
    return i === 0 ? 'go' : 'run';   // run → go → run; anything unknown starts over at run
  }

  const cleanQuery = (q) => (typeof q === 'string' ? norm(q).trim().replace(/\s+/g, ' ').slice(0, QUERY_MAX) : '');
  const keyOf = (r) => (r.kind === 'project' ? 'project/' + (r.route && r.route.projectId) : r.tab + '/' + (r.sub || ''));
  const KIND_ORDER = { space: 0, sub: 1, project: 2 };

  // -1 = no match. 0 own name equals the query · 1 own name starts with it · 2 every typed word starts a word of the own name ·
  // 3 every typed word starts a word of the whole path ("money run" → Money › Runway; "money" → every sub-view of Money).
  function scoreOf(ownName, ownWords, allWords, q, tokens) {
    if (ownName === q) return 0;
    if (ownName.startsWith(q)) return 1;
    const hit = (words) => tokens.every((t) => words.some((w) => w.startsWith(t)));
    if (hit(ownWords)) return 2;
    if (hit(allWords)) return 3;
    return -1;
  }

  function filterGo(query, projects, table) {
    const q = cleanQuery(query);
    const base = Array.isArray(table) ? table : goTable;
    if (!q) return base.filter((t) => t && t.kind === 'space').map((t) => Object.assign({}, t, { score: 4 }));   // nothing typed: the spaces only
    const tokens = q.split(' ');
    const out = [];
    for (const t of base) {
      if (!t || typeof t.own !== 'string' || !Array.isArray(t.words)) continue;
      const s = scoreOf(t.own, wordsOf(t.own), t.words, q, tokens);
      if (s >= 0) out.push(Object.assign({}, t, { score: s }));
    }
    // projects by name, only after a character is typed; a list of any size is read up to a cap and never throws
    const list = Array.isArray(projects) ? projects : [];
    const n = Math.min(list.length, PROJECTS_SCAN_MAX);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (!isObj(p) || typeof p.id !== 'string' || !p.id) continue;
      const name = typeof p.name === 'string' && p.name ? p.name : p.id;
      const own = norm(name);
      const nw = wordsOf(name).concat(wordsOf(p.id));
      const s = scoreOf(own, wordsOf(name), nw, q, tokens);
      if (s < 0 || s > 2) continue;   // a project is matched by its own name (or id) only, never "through a parent"
      out.push({ kind: 'project', tab: 'projects', sub: null, label: clip(name, NAME_MAX), own, words: nw, score: s, route: { tab: 'projects', projectId: p.id } });
    }
    return out;
  }

  function tieBreak(query, a, b) {
    const order = TIE_BREAK[cleanQuery(query)];
    if (!order || !a || !b) return 0;
    const ia = order.indexOf(keyOf(a)), ib = order.indexOf(keyOf(b));
    if (ia === ib) return 0;
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  }

  function rankGo(rows, query) {
    const list = Array.isArray(rows) ? rows.filter(isObj) : [];
    return list.map((r, i) => [r, i]).sort((x, y) => {
      const a = x[0], b = y[0];
      return ((a.score ?? 9) - (b.score ?? 9))
        || ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
        || tieBreak(query, a, b)
        || (x[1] - y[1]);
    }).map((x) => x[0]);
  }

  // what the palette draws: label + the route to ask main for. A space/sub route is { tab, sub? }; a project's is { tab, projectId }.
  function goRows(query, projects, limit) {
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : GO_MAX;
    const slice = rankGo(filterGo(query, projects), query).slice(0, max);
    return slice.map((r) => ({
      kind: r.kind,
      label: r.label,
      hint: r.kind === 'project' ? 'Project' : r.kind === 'space' ? 'Space' : 'View',
      route: r.route ? { tab: r.route.tab, projectId: r.route.projectId } : r.sub ? { tab: r.tab, sub: r.sub } : { tab: r.tab },
    }));
  }

  // hq.quick.read()'s answer → the rows of the Needs-you block. ONLY a 12-hex ref, the projection label and the scan flag are
  // taken from a row: any other field a row happens to carry (a reason, an amount, a path) is dropped here too.
  function briefRows(view) {
    const v = isObj(view) ? view : {};
    const src = Array.isArray(v.brief) ? v.brief.slice(0, 50) : [];
    const rows = [];
    for (const r of src) {
      if (rows.length >= BRIEF_MAX) break;
      if (!isObj(r) || typeof r.ref !== 'string' || !REF_RE.test(r.ref) || typeof r.label !== 'string' || !r.label.trim()) continue;
      rows.push({ kind: 'brief', ref: r.ref, label: clip(r.label.trim(), LABEL_MAX), scan: r.scan === true });
    }
    let note = null;
    if (!rows.length) note = v.status === 'empty' ? 'nothing needs you' : v.status === 'incomplete' ? 'brief incomplete' : 'brief not ready yet';
    return { rows, note };
  }

  // ctx: { bridge: bool (hq.quick exists), view (the read answer), query, count (rows drawn) }
  function stateNote(mode, ctx) {
    const c = isObj(ctx) ? ctx : {};
    if (c.bridge === false) return 'this window has no navigation bridge';
    if (mode === 'go') {
      const q = cleanQuery(c.query);
      const v = isObj(c.view) ? c.view : null;
      const noProjects = !!q && !!v && v.projects == null;   // latest.json is absent: names cannot be searched
      if (q && !c.count) return noProjects ? 'nothing matches · no projects loaded' : 'nothing matches';
      if (noProjects) return 'no projects loaded';
      return null;
    }
    return briefRows(c.view).note;
  }

  return { MODES, MODE_LABELS, HINTS, goTable, filterGo, rankGo, goRows, briefRows, stateNote, nextMode, tieBreak, TIE_BREAK };
});
