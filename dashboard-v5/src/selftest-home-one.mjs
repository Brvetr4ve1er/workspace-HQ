// Home as one decision: the states the selftest walks (selftest.js loops them beside the Brief's own rows, in both themes).
//
//   homeOneStates({ projectId? }) -> { name, tab, sub, brief, state }[]
//     name    the combo label, always 'ho1-...'
//     tab/sub always Home (sub null)
//     brief   a LIVE.brief value ({ brief, error, loaded }): the Brief on screen
//     state   the app state this row sets: { homeMore } (the disclosure open or closed). The caller spreads it into setState AFTER its own CLEAR/base
//             patch, so a row never inherits the previous row's disclosure
//   projectId  the id of a project that has an open task in the page data. With it the "follows" rows name that project in their lead row (the
//              Next action card then follows the Brief); without it they name an invented id and the card falls back to the fixed rules, which is
//              still a state worth walking. Invented ids only: the module carries no real project name (the repo is public).
//   HOME_ONE_STORAGE_KEYS  the localStorage key the rows touch (the selftest's LOCAL_KEYS must list it so it is snapshotted and restored)
//
// Placeholder text only. No IO: the module only shapes data.

export const HOME_ONE_STORAGE_KEYS = Object.freeze(['hq.homeMore']);

const GEN = '2026-11-14T09:00:00.000Z';
const item = (key, severity, text, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 }, extra || {});
const briefOf = (items, extra) => ({ brief: Object.assign({ v: 1, generatedAt: GEN, items, more: 0, overflow: [], standing: [], errors: [], quiet: null }, extra || {}), error: '', loaded: true });

export function homeOneStates({ projectId } = {}) {
  const pid = typeof projectId === 'string' && projectId ? projectId : 'placeholder-project-a';
  const follows = [item('secrets:' + pid + ':2', 'high', 'Project A has 2 secrets in plain sight', { kind: 'go', tab: 'projects', projectId: pid })];
  const scanRow = [item('scan-stale:2026-11-12', 'med', 'Scan data is 2 days old', { kind: 'scan' })];
  const group = [item('dirty:' + pid + ':12', 'low', 'Project A has 12 uncommitted files and 2 more projects', { kind: 'go', tab: 'projects', projectId: pid },
    { count: 2, group: { n: 3, sinceAt: GEN, listAction: { kind: 'go', tab: 'projects', sub: 'grid' } } })];
  const row = (name, brief, homeMore) => ({ name, tab: 'home', sub: null, brief, state: { homeMore } });
  return [
    row('ho1-follows-closed', briefOf(follows), false),
    row('ho1-follows-open', briefOf(follows), true),
    row('ho1-ranker-scan-lead-closed', briefOf(scanRow), false),
    row('ho1-ranker-scan-lead-open', briefOf(scanRow), true),
    row('ho1-group-lead-closed', briefOf(group), false),
    row('ho1-allclear-brief-closed', briefOf([]), false),
    row('ho1-allclear-brief-open', briefOf([]), true),
  ];
}
