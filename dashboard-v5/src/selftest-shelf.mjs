// Projects > Shelf (batch 7) -- the states the selftest walks (selftest.js loops them beside the Cosmos states, in both themes).
//
//   shelfStates(opts)       -> [name, count, statePatch][]     opts.counts overrides the three sizes ([3, 48, 83])
//     name        the combo label suffix ('shelf-83', ...)
//     count       how many INVENTED projects the model holds for this row (tools/console-fixture.mjs fakeShelfProjects)
//     statePatch  the state this row sets: the Console layer pref and the Projects filters. The caller spreads shelfInitState() first
//                 (CLEAR does not know shelfMore or consoleLayer), and puts consoleLayer back to what it was when the walk is over.
//   shelfInitState()        -> the shelf's own session state back to its default ({ shelfMore: null })
//   swapProjects(P0, raws, toProject) -> restore()   put the invented projects into the model's own array and give a function that puts the
//                 real ones back. The selftest runs on window.DATA (the owner's real scan, baked by build-data.mjs), so the sizes 3, 48 and 83
//                 cannot come from the data: the model's `at(0).P0` array is emptied and refilled IN PLACE (every reader goes through it:
//                 projectsAt, proj, pname, the project page), then restored in a finally.
// Import-light on purpose (no imports) and no IO: shelf.test.mjs drives it in plain Node. The caller passes adapter.mjs toProject.

/** The three sizes the dish asks for: one row, exactly one page, a page and a part. */
export const SHELF_COUNTS = Object.freeze([3, 48, 83]);

/** The pref the rows set (every sub-flag spelled out, so a row never inherits another's). */
const layer = (o) => ({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false, ...(o || {}) });
const filters = { projSearch: '', projStatus: 'all', projSort: 'worst' };

/** The shelf's own session state at its default. */
export const shelfInitState = () => ({ shelfMore: null });

export function shelfStates(opts) {
  const counts = opts && Array.isArray(opts.counts) && opts.counts.length === 3 ? opts.counts : SHELF_COUNTS;
  const [small, page, big] = counts;
  const on = (extra) => ({ consoleLayer: layer({ on: true, shelf: true }), ...filters, ...(extra || {}) });
  return [
    ['shelf-' + small, small, on()],
    ['shelf-' + page, page, on()],
    ['shelf-' + big, big, on()],
    // a page and a part, with the second page asked for: the key is the filters' own, so it counts
    ['shelf-' + big + '-more', big, on({ shelfMore: { key: 'worst||all', pages: 2 } })],
    ['shelf-' + big + '-sorted-name', big, on({ projSort: 'name' })],
    ['shelf-' + big + '-risk-only', big, on({ projStatus: 'risk' })],
    ['shelf-' + big + '-no-match', big, on({ projSearch: 'zzzz-no-such-project' })],
    ['shelf-' + big + '-reduced-motion', big, on({ reduceMotion: true })],
    // List chosen with the layer on: the toggle is there, the Shelf is not
    ['shelf-' + big + '-list-chosen', big, { consoleLayer: layer({ on: true, shelf: false }), ...filters }],
    // layer off with the sub-flag left over from before: no toggle, no Shelf, the list as it always was
    ['shelf-' + big + '-layer-off', big, { consoleLayer: layer({ on: false, shelf: true }), ...filters }],
    ['shelf-0-empty', 0, on()],
  ];
}

/** Rows whose label says what they must show, for the caller's own assertions: [name, { shelf, toggle, empty }]. */
export const SHELF_EXPECT = Object.freeze({
  'shelf-3': { shelf: true, toggle: true }, 'shelf-48': { shelf: true, toggle: true }, 'shelf-83': { shelf: true, toggle: true },
  'shelf-83-list-chosen': { shelf: false, toggle: true }, 'shelf-83-layer-off': { shelf: false, toggle: false },
  'shelf-83-no-match': { shelf: true, toggle: true, empty: true }, 'shelf-0-empty': { shelf: true, toggle: true, empty: true },
});

/**
 * Put `raws` (scan-shaped invented projects) into `P0` in place, through `toProject` (adapter.mjs). Returns restore(): the saved rows go
 * back in the same array (once: a second call to restore does nothing). Swapping twice without restoring in between would save the
 * invented rows, so the caller restores before the next swap (selftest.js does it in a finally).
 */
export function swapProjects(P0, raws, toProject) {
  if (!Array.isArray(P0)) throw new Error('swapProjects: P0 is not an array');
  if (typeof toProject !== 'function') throw new Error('swapProjects: toProject is missing');
  const saved = P0.slice();
  P0.splice(0, P0.length, ...(Array.isArray(raws) ? raws : []).map((r) => toProject(r)));
  let done = false;
  return function restore() {
    if (done) return;
    done = true;
    P0.splice(0, P0.length, ...saved);
  };
}
