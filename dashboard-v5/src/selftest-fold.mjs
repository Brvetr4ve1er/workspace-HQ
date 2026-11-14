// Foldable surfaces (batch 7, subtraction) — the states the selftest walks (selftest.js loops them in both themes, beside the Cosmos, Today and
// Machine-drift rows), and the two renderer prefs that make a surface fold.
//
//   foldStates() -> [name, tab, sub, foldState, extra][]
//     tab, sub    where the row is drawn (sub is null for a space with no sub bar worth naming)
//     foldState   { foldIds, showEverything }: the two renderer prefs (src/live/foldable.mjs), exactly as app.js keeps them in state
//     extra       any other state patch: { settingsOpen: true } for the rows that show the Settings row
//   FOLD_RESET    the state the caller puts back after the rows: nothing folded, Show everything off, Settings closed
//
// The caller (selftest.js) sets the state with L.setState(Object.assign({}, CLEAR, base, FOLD_RESET, { themePref: theme }, foldState, extra)), and
// afterwards restores the two prefs it saved (the selftest snapshots whq3-prefs through LOCAL_KEYS already: no new storage key is written here).
// Invented ids only: every id is one of src/live/foldable.mjs FOLDABLE, nothing comes from owner data. No IO, no clock.
import { FOLDABLE } from './live/foldable.mjs';

export const FOLD_RESET = Object.freeze({ foldIds: [], showEverything: false, settingsOpen: false });

const ALL = FOLDABLE.map((f) => f.id);

/** @returns {Array<[string, string, string|null, {foldIds:string[], showEverything:boolean}, object]>} */
export function foldStates() {
  const row = (name, tab, sub, foldIds, showEverything, extra) => [name, tab, sub, { foldIds, showEverything }, extra || {}];
  return [
    row('fold-none', 'home', null, [], false),
    row('fold-none-settings', 'home', null, [], false, { settingsOpen: true }),
    row('fold-sub-hidden', 'projects', 'grid', ['projects/archived'], false),
    row('fold-sub-reached', 'projects', 'archived', ['projects/archived'], false),
    row('fold-library-hidden', 'automations', 'runnable', ['automations/library'], false),
    row('fold-space-hidden', 'home', null, ['life'], false),
    row('fold-space-reached', 'life', 'screen', ['life'], false),
    row('fold-panel-hidden', 'system', 'machine', ['system/hub-panel'], false),
    row('fold-settings-row', 'home', null, ['projects/archived', 'life'], false, { settingsOpen: true }),
    row('fold-settings-showing', 'home', null, ['projects/archived', 'life'], true, { settingsOpen: true }),
    row('fold-all', 'home', null, ALL, false, { settingsOpen: true }),
    row('fold-all-showing', 'projects', 'archived', ALL, true),
  ];
}
