// Phase 3 · P6 Automations: the "Everything runnable" list's filters (kind,
// source, category; composed with the existing search), Show more, and Rescan.
//
// The pure helpers are exported for src/logic/library.test.mjs. libraryLogic is
// mixed into Component.prototype (app.js): same `this` as the class methods.
//
// State keys (K-4: app.js declares initial state; an undefined key means its
// default here): libKind 'all' | 'runnable' | 'interactive', libSource (a
// spellbook source id or 'all'), libSchool (a category label or 'all'),
// libShow (rows shown, LIB_PAGE), libRescanning (bool). autoQuery is the
// existing search box.
import { SCHOOL } from '../live/catalog.mjs';

export const LIB_PAGE = 40;    // rows shown at first (v3 showed 24); 800+ Claude skills would be a long render
export const LIB_MORE = 120;   // "Show more" adds this many (v3's step)

// [id, chip label, tooltip]
export const LIB_KINDS = [
  ['all', 'All', 'Everything this app can run'],
  ['runnable', 'Runnable', 'Runs in the background · tracked in Activity'],
  ['interactive', 'Interactive', 'Opens a terminal · output stays there'],
];
// one vocabulary with the Library bars (adapter.mjs LIB, vals/automations.js)
export const SOURCE_LABEL = { grimoire: 'WorkspaceHQ', script: 'Scripts', npm: 'npm scripts', task: 'Scheduled tasks', skill: 'Claude skills', command: 'Claude commands', agent: 'Claude agents', plugin: 'Plugins', other: 'Other' };
const SOURCE_RANK = ['grimoire', 'script', 'npm', 'task', 'skill', 'command', 'agent', 'plugin'];
// category chips in the spellbook's school order (catalog.mjs SCHOOL, plain words), then Other
const SCHOOL_RANK = Object.values(SCHOOL).concat(['Other']);
const KIND_IDS = LIB_KINDS.map((k) => k[0]);

// a channeled spell (adapter INTERACTIVE) opens a terminal; everything else runs in the background
export const libKindOf = (a) => (a && (a.kind === 'interactive' || a.mode === 'terminal') ? 'interactive' : 'runnable');
// A run that starts the Claude CLI uses Claude quota: every Claude skill, command and
// agent is `claude /<name>` (collector/spellbook.mjs), and a background script can call
// it too. Read off the command itself, so the "quota" chip / "Uses Claude quota" in the
// confirm is never a guess. (Reviewer fix: the interactive rows all said quota:false.)
export const usesQuota = (a) => !!a && /^claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(String(a.cmd || '').trim());
const sourceOf = (a) => (a && a.source ? String(a.source) : 'other');
const schoolOf = (a) => (a && a.cat ? String(a.cat) : 'Other');
const hay = (a) => [a.name, a.desc, a.cat, a.cmd, a.id].filter(Boolean).join(' ').toLowerCase();

// the filters as the state holds them, normalised (undefined / unknown → the default)
export function libFilters(S) {
  const s = S || {};
  const kind = KIND_IDS.includes(s.libKind) ? s.libKind : 'all';
  const source = s.libSource && s.libSource !== 'all' ? String(s.libSource) : '';
  const school = s.libSchool && s.libSchool !== 'all' ? String(s.libSchool) : '';
  const q = String(s.autoQuery || '').trim().toLowerCase();
  const n = Number(s.libShow);
  const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : LIB_PAGE;
  return { kind, source, school, q, limit };
}

// does `a` pass every filter except `skip` (for the faceted chip counts)?
function keep(a, f, skip) {
  if (skip !== 'kind' && f.kind !== 'all' && libKindOf(a) !== f.kind) return false;
  if (skip !== 'source' && f.source && sourceOf(a) !== f.source) return false;
  if (skip !== 'school' && f.school && schoolOf(a) !== f.school) return false;
  if (f.q && !hay(a).includes(f.q)) return false;
  return true;
}
const byRank = (rank, label) => (x, y) => {
  const rx = rank.indexOf(x), ry = rank.indexOf(y);
  return (rx < 0 ? rank.length : rx) - (ry < 0 ? rank.length : ry) || label(x).localeCompare(label(y));
};

// pool = every item the list can show (AUTOS then INTERACTIVE). Returns the rows to
// render plus honest counts: matches (pass every filter), total (the pool), shown
// (after the row cap). Each chip's count is what that chip would show with the
// other filters and the search kept as they are; a chip with nothing behind it is
// left out unless it is the one selected.
export function libView(pool, f) {
  const items = (Array.isArray(pool) ? pool : []).filter(Boolean);
  const matches = items.filter((a) => keep(a, f));
  const tally = (skip, key) => { const m = new Map(); for (const a of items) if (keep(a, f, skip)) m.set(key(a), (m.get(key(a)) || 0) + 1); return m; };
  const kindN = tally('kind', libKindOf);
  const kinds = LIB_KINDS.map(([id, label, title]) => ({ id, label, title, n: id === 'all' ? (kindN.get('runnable') || 0) + (kindN.get('interactive') || 0) : kindN.get(id) || 0, on: f.kind === id }));
  const srcN = tally('source', sourceOf);
  if (f.source && !srcN.has(f.source)) srcN.set(f.source, 0);
  const srcLabel = (id) => SOURCE_LABEL[id] || id;
  const sources = [...srcN.keys()].sort(byRank(SOURCE_RANK, srcLabel)).map((id) => ({ id, label: srcLabel(id), n: srcN.get(id), on: f.source === id }));
  const schN = tally('school', schoolOf);
  if (f.school && !schN.has(f.school)) schN.set(f.school, 0);
  const schools = [...schN.keys()].sort(byRank(SCHOOL_RANK, (x) => x)).map((id) => ({ id, label: id, n: schN.get(id), on: f.school === id }));
  const shown = Math.min(f.limit, matches.length);
  return {
    list: matches.slice(0, shown), matches: matches.length, total: items.length, shown,
    kinds, sources, schools, filtered: f.kind !== 'all' || !!f.source || !!f.school || !!f.q,
  };
}
// "N of M", plus how many rows are on screen when the cap hides some
export const libCountText = (v) => v.matches + ' of ' + v.total + (v.shown < v.matches ? ' · showing ' + v.shown : '');

export const libraryLogic = {
  // a chip click: picks that value; clicking the selected chip again goes back to All
  setLibFilter(key, val) {
    const k = { kind: 'libKind', source: 'libSource', school: 'libSchool' }[key];
    if (!k) return;
    this.setState((s) => ({ [k]: s[k] === val && val !== 'all' ? 'all' : val, libShow: LIB_PAGE }));
  },
  clearLibFilters() { this.setState({ libKind: 'all', libSource: 'all', libSchool: 'all', autoQuery: '', libShow: LIB_PAGE }); },
  libShowMore() { this.setState((s) => ({ libShow: libFilters(s).limit + LIB_MORE })); },
  // Rescan only the spellbook (skills, scripts, tasks — no pipeline). Main answers
  // {ok:true} after it has already reloaded this window, or {error}: the toast goes
  // up BEFORE the call and nothing after a success relies on this window's state.
  async rescanLib() {
    if (!this.canWrite()) return this.denied();
    if (!this.hq || typeof this.hq.rescanSpellbook !== 'function') return this.denied('This window can’t rescan the library');
    if (this._libRescan) return;   // one rescan at a time (main runs it synchronously)
    this._libRescan = true;
    this.setState({ libRescanning: true });
    this.toast('progress', 'Rescanning skills, scripts and tasks — the window reloads', { rescan: true });
    let r;
    try { r = await this.hq.rescanSpellbook(); }
    catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (r && !r.error) return;   // main rebuilt the data and is reloading the window
    this._libRescan = false;
    this.setState((s) => ({ libRescanning: false, toasts: (s.toasts || []).filter((t) => !t.rescan) }));
    this.toast('error', 'Rescan failed · ' + ((r && r.error) || 'no answer from the app'));
  },
};
