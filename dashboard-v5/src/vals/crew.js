// Claude > Crew render values. EVERY value rides under ONE top-level key, crwv (renderVals stays one key higher, not a block of crw*
// keys); the template reads {{ crwv.on }} and friends. The roster arrives finished from main (dashboard/crew.js -> hq:crew:read:
// id, name, description, role, plugin, canStart; never a body or a path); logic/crew.js reads it on arrival and this module only
// searches, groups and shapes it (logic/crew-view.mjs does the pure part).
//
// renderVals runs every surface on every machine push, so while the owner is on another screen this returns a frozen constant: nothing is
// searched or grouped. The key set of crwv is the same in every state, so the template never meets an undefined. Honest states: no bridge
// - loading - error with no roster held (Retry) - an empty crew - ready - ready with a later error (the last roster stays, the error is
// said above it) - a search with no match.
import { crwView, CRW_OFF } from '../logic/crew-view.mjs';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

const BLANK = Object.freeze({
  on: false, offline: false, offlineText: '', loading: false, error: false, errorText: '', empty: false, emptyText: '',
  ready: false, summary: '', note: '', query: '', onQuery: null, hasQuery: false, clear: null,
  searching: false, groups: [], flat: [], hasFlat: false, flatMore: false, flatMoreText: '', loadMore: null,
  noMatch: false, noMatchText: '', refresh: null, refreshLabel: 'Refresh', refreshOff: true,
});
const OFF_V = Object.freeze({ crwv: BLANK });

export const CRW_NOTE = 'Start opens a terminal session in this app’s folder with the skill’s name in the first line. It asks before it changes anything.';

export function crewVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!(S.tab === 'claude' && !S.route && S.sub && S.sub.claude === 'crew')) return OFF_V;
  const can = typeof this.crwCan === 'function' ? this.crwCan() : false;
  const C = S.crw || {};
  const held = Array.isArray(C.rows) ? C.rows : null;
  const busy = !!C.busy, err = typeof C.error === 'string' ? C.error : '';
  const refresh = () => (typeof this.crwRead === 'function' ? this.crwRead() : null);
  const refreshLabel = busy ? 'Reading…' : err && !held ? 'Retry' : 'Refresh';
  const base = { ...BLANK, on: true, note: CRW_NOTE, refresh, refreshLabel, refreshOff: busy };
  if (!can) return { crwv: { ...base, offline: true, offlineText: CRW_OFF + ' — skills are read by the app, not this window.', refreshOff: true } };
  if (!held) return { crwv: { ...base, loading: !err, error: !!err, errorText: err } };

  const roles = Array.isArray(C.roles) ? C.roles : [];
  const q = typeof C.q === 'string' ? C.q : '';
  const view = crwView({ rows: held, roles, q, page: C.page || 1, open: C.open || {} });
  const startingNow = new Set(Array.isArray(S.crwBusy) ? S.crwBusy : []);
  const rowOf = (r, i) => {
    const starting = r.canStart && startingNow.has(r.id);
    return {
      key: (r.id || 'x') + '|' + i, name: r.name, plugin: r.plugin, hasPlugin: !!r.plugin, description: r.description, hasDesc: !!r.description,
      canStart: r.canStart, noStartText: 'No Start: the folder name has unusual characters', startLabel: starting ? 'Starting…' : 'Start', startOff: starting,
      startTip: 'Open a terminal session that starts with the ' + r.name + ' skill', start: () => (typeof this.crwStart === 'function' ? this.crwStart(r) : null),
    };
  };
  const common = {
    ...base, query: q, onQuery: (e) => this.crwQuery(e), hasQuery: q.trim().length > 0, clear: () => this.crwClear(),
    searching: view.searching,
  };
  if (!held.length) return { crwv: { ...common, empty: true, emptyText: 'No skills are installed. Skills live in the Claude folder’s skills folder, or come with a plugin.', summary: '' } };

  const plugins = new Set(held.filter((r) => r.plugin).map((r) => r.plugin)).size;
  const summary = plural(held.length, 'skill') + (plugins ? ' · ' + plural(plugins, 'plugin') : '') + (view.searching ? ' · ' + plural(view.matches, 'match', 'matches') : '');
  const out = { ...common, ready: true, summary, error: !!err, errorText: err };
  if (view.searching) {
    out.flat = view.flat.map(rowOf); out.hasFlat = out.flat.length > 0;
    out.flatMore = view.flatMore > 0; out.flatMoreText = 'Show ' + Math.min(60, view.flatMore) + ' more of ' + view.flatMore + ' not shown';
    out.loadMore = () => this.crwMorePage();
    out.noMatch = view.matches === 0; out.noMatchText = 'No skill matches “' + q.trim() + '”.';
    return { crwv: out };
  }
  out.groups = view.groups.map((g) => ({
    key: g.role, label: g.label, countText: plural(g.count, 'skill'), rows: g.rows.map(rowOf),
    hasMore: g.more > 0, canCollapse: g.canCollapse, canToggle: g.more > 0 || g.canCollapse,
    toggleLabel: g.expanded ? 'Show fewer' : 'Show ' + g.more + ' more', toggle: () => this.crwToggleRole(g.role),
  }));
  return { crwv: out };
}
