// Projects > Shelf render values (batch 7, dish "cartridge-shelf"): ONE top-level key, shfv (the 1015 ceiling), everything nested under it.
// The cartridges, the rows, the paging and the wording are logic/shelf.mjs; this module only reads the state and shapes it for
// tpl/shelf.tpl.js.
//
// renderVals runs every surface on every machine push, so anything that is not "Projects grid, Console layer on" returns a frozen
// constant: nothing is sorted, parsed or drawn. With the layer off the constant says `listOn: true` (the list's card grid is
// wrapped in sc-if shfv.listOn) and carries no toggle, so Projects renders exactly as before. SHF_OFF defines EVERY key the template
// binds (the test pins it), so the runtime's unresolved-path counter stays 0.
//
// Reads, defensively (the console layer and the shared next action are other dishes): state.consoleLayer ({ on, shelf } booleans),
// ctx.dec.next.proj (the project of the shared next action; absent = the first worst-first row), state.shelfMore ({ key, pages }),
// state.projSort / projSearch / projStatus and state.reduceMotion (the list's own), the OS reduced-motion query.
import { PROJ_STATUSES, projMatches } from './projects.js';
import { shelfFlags, shelfLayout, sortProjects, shelfRowOf, shelfKey, shelfPages, motionAllowed } from '../logic/shelf.mjs';

export const SHF_LIST_LABEL = 'Projects on the shelf';

export const SHF_OFF = Object.freeze({
  on: false, listOn: true, shelfOn: false, toggle: Object.freeze([]), lift: true,
  rows: Object.freeze([]), hasInserted: false, insertedList: Object.freeze([]),
  countLine: '', empty: false, emptyLine: '', hasMore: false, moreLabel: '', more: () => {}, listLabel: SHF_LIST_LABEL,
});

/** The content width the rows are cut for: the window minus the side rail and gutters, clamped. The row wraps on its own if this is too wide. */
export function shelfWidth(win) {
  const w = win && Number.isFinite(win.innerWidth) ? win.innerWidth : 0;
  return w > 0 ? Math.max(320, Math.min(1600, w - 300)) : 960;
}

export function shelfVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const flags = shelfFlags(S.consoleLayer);
  if (!flags.on || S.tab !== 'projects' || !ctx || ctx.sub !== 'grid' || ctx.onPage) return { shfv: SHF_OFF };

  const tabStyle = ctx.tabStyle;
  const toggle = [['list', 'List'], ['shelf', 'Shelf']].map(([id, label]) => {
    const on = (id === 'shelf') === flags.shelf;
    return { id, label, on, go: () => (typeof this.shelfSet === 'function' ? this.shelfSet(id === 'shelf') : null), style: typeof tabStyle === 'function' ? tabStyle(on) : {} };
  });
  if (!flags.shelf) return { shfv: { ...SHF_OFF, on: true, toggle } };

  const { H, projects, rows } = ctx;
  const ST = H && H.ST;
  const q = S.projSearch || '', st = PROJ_STATUSES.includes(S.projStatus) ? S.projStatus : 'all';
  const sort = S.projSort;
  // the SAME filter and sorters as the list (projMatches is the list's; sortProjects mirrors its sorters, parity is pinned by the tests)
  const items = sortProjects((projects || []).filter((p) => projMatches(p, q, st)), sort, ST).map((p) => shelfRowOf(p, ST, (id) => this.openProject(id)));
  // the console holds the project of the shared next action; failing that, the first worst-first row. Not narrowed by the search.
  const curId = ctx.dec && ctx.dec.next && ctx.dec.next.proj != null ? ctx.dec.next.proj : null;
  const cur = (curId != null && (projects || []).find((p) => String(p.id) === String(curId))) || (rows && rows[0]) || null;
  const win = typeof window !== 'undefined' ? window : null;
  const key = shelfKey(sort, q, st), pages = shelfPages(S.shelfMore, key);
  const L = shelfLayout(items, {
    width: shelfWidth(win), page: pages, currentId: cur ? cur.id : null,
    all: cur ? [shelfRowOf(cur, ST, (id) => this.openProject(id))] : [], allCount: (projects || []).length,
  });
  const lift = motionAllowed({ reduceMotion: !!S.reduceMotion, matchMedia: win && typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : null });
  return {
    shfv: {
      on: true, listOn: false, shelfOn: true, toggle, lift,
      rows: L.rows, hasInserted: !!L.inserted, insertedList: L.inserted ? [L.inserted] : [],
      countLine: L.countLine, empty: L.empty, emptyLine: L.emptyLine,
      hasMore: L.hasMore, moreLabel: L.moreLabel, more: () => (typeof this.shelfMore === 'function' ? this.shelfMore(key, pages) : null), listLabel: SHF_LIST_LABEL,
    },
  };
}
