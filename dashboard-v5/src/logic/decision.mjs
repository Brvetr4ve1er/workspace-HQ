// Home as one decision (batch 7, dish home-one-decision). PURE: no DOM, no clock, no storage, no IO.
//
// Home reads the Brief first, then ONE next action. This module is the single place that picks that action, so the Home card, its two
// alternatives, the Status rail's "Do now", the prompt hints and the Tasks ranked list all read ONE ordering (vals/ctx.js builds it once per render).
//
//   decide({ briefItems, open, doneIds }) -> { mode, lead, next, order, briefOrder }
//
//     briefItems  LIVE.brief.brief.items: the Brief's rows, already in main's order (brief-core). Anything that is not an array reads as none.
//     open        the ranker's open tasks IN THE RANKER'S OWN ORDER (never re-sorted here: a tie keeps the ranker's order, which is what "stable" means)
//     doneIds     task ids to leave out (an array or a Set); tasks done a moment ago but still on the board
//
//     lead        briefItems[0] when it is an object, else null
//     next        the task the card shows, or null
//     mode        'follows-brief'  the lead row names a project (action.projectId) that has an open task: next = that project's top-ranked open task
//                 'ranker'         everything else with at least one open task: next = open[0]. This is also the all-clear fallback, so Home is
//                                  never hero-less: an empty Brief, a lead that names no project, a group row, or a project with no open task
//                 'rest'           no open task at all: next = null (Home shows the All clear card)
//     order       next first, then the remaining open tasks in ranker order; no duplicates
//     briefOrder  the Brief rows' keys in Brief order (an identity over the keys; it exists so the Ctrl+Alt+X palette parity test has ONE function
//                 to compare against the tray projection)
//
// The mapping is explicit. A quest task carries its project as task.proj (live/adapter.mjs); a Brief row names a project as item.action.projectId.
// They match when String(task.proj) === String(item.action.projectId). A collapsed GROUP row ("X and N more") opens a list, not a project: its
// action comes from group.listAction (the same rule vals/brief.js uses for its main button), which has no projectId, so it never matches and the
// card falls back to the ranker. A malformed row (no action, no key, not an object) never throws and never matches.

export const MODES = Object.freeze({ FOLLOWS: 'follows-brief', RANKER: 'ranker', REST: 'rest' });

// What the grey span on the card prints (vals/home.js: home.next.source). The ranker wording is the card's existing words, unchanged
// (U+00B7 middle dot, as the template printed it); 'rest' shows no card, so it has no source.
export const SOURCE_WORDS = Object.freeze({
  'follows-brief': 'Follows the top Brief row',
  ranker: 'picked by fixed rules · not AI',
  rest: '',
});
export const sourceOf = (mode) => (Object.prototype.hasOwnProperty.call(SOURCE_WORDS, mode) ? SOURCE_WORDS[mode] : SOURCE_WORDS.ranker);

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);

/** The action a Brief row opens: its collapsed group's list when main named one, else its own (the rule vals/brief.js applies). */
function effectiveAction(item) {
  if (!isObj(item)) return null;
  const g = isObj(item.group) ? item.group : null;
  if (g && isObj(g.listAction)) return g.listAction;
  return isObj(item.action) ? item.action : null;
}

/** The project id a Brief row names, as a non-empty string, or null (a number id is accepted, anything else names nothing). */
export function projectOf(item) {
  const a = effectiveAction(item);
  if (!a) return null;
  const p = a.projectId;
  if (typeof p !== 'string' && typeof p !== 'number') return null;
  const s = String(p);
  return s === '' ? null : s;
}

const hasProj = (t) => isObj(t) && (typeof t.proj === 'string' || typeof t.proj === 'number') && String(t.proj) !== '';

export function decide({ briefItems, open, doneIds } = {}) {
  const items = arr(briefItems);
  const done = doneIds instanceof Set ? doneIds : new Set(arr(doneIds));
  // the ranker's list, minus what is done, minus anything that is not a task, minus duplicates (by id, or by identity when there is no id)
  const seenId = new Set(), seenObj = new Set(), tasks = [];
  for (const t of arr(open)) {
    if (!isObj(t) || seenObj.has(t)) continue;
    if (t.id !== undefined && t.id !== null) { if (done.has(t.id) || seenId.has(t.id)) continue; seenId.add(t.id); }
    seenObj.add(t);
    tasks.push(t);
  }

  const lead = isObj(items[0]) ? items[0] : null;
  const briefOrder = items.filter((it) => isObj(it) && typeof it.key === 'string' && it.key !== '').map((it) => it.key);

  if (!tasks.length) return { mode: MODES.REST, lead, next: null, order: [], briefOrder };

  const pid = lead ? projectOf(lead) : null;
  const followed = pid === null ? null : tasks.find((t) => hasProj(t) && String(t.proj) === pid) || null;
  const next = followed || tasks[0];
  const order = [next].concat(tasks.filter((t) => t !== next));
  return { mode: followed ? MODES.FOLLOWS : MODES.RANKER, lead, next, order, briefOrder };
}
