// Brief history: the states the selftest walks (selftest.js loops them beside the Brief's own rows, in both themes).
//
//   briefHistoryStates() -> { name, tab, sub, brief, hist }[]
//     name    the combo label, always 'bhs-...'
//     tab/sub where the row is shown: Home (the footer line and the all-clear card sit in the Brief panel) or History > Timeline (the Operator section)
//     brief   a LIVE.brief value ({ brief, error, loaded }): the Brief on screen. The all-clear card needs it empty at 0/0/0
//     hist    the bhs* component state this row sets { bhsLoaded, bhsData, bhsErr, bhsBusy }; bhsData is the NORMALIZED answer (normalizeAnswer), as the real read leaves it.
//             The caller also sets logic._bhsHold = true so the fake preload's own answer does not replace the row's state
//   BHS_OFFLINE_ROWS  rows that need hq.briefHistory hidden for one combo (the store's hq, never window.hq), the way rch-offline hides hq.reach
//
// Placeholder text only (rule wording comes from the same table main uses). No IO: the module only shapes data.
import { normalizeAnswer } from './logic/brief-history.js';

export const BHS_OFFLINE_ROWS = Object.freeze(['bhs-operator-offline']);

const GEN = '2026-11-10T09:00:00.000Z';
const iso = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();   // local time, so the weekday words are stable on any machine

const item = (key, severity, text, extra) => Object.assign({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action: { kind: 'scan' }, count: 0 }, extra || {});
const BI = [
  item('secrets:placeholder-a:2', 'high', 'Project A has 2 secrets in plain sight'),
  item('unpushed:placeholder-b:3', 'med', 'Project B has 3 commits not pushed'),
];
const briefOf = (items, o) => ({ brief: Object.assign({ v: 1, generatedAt: GEN, items, more: 0, overflow: [], standing: [], errors: [] }, o || {}), error: '', loaded: true });

const ENTRIES = [
  { text: 'A bill is late', rule: 'money-late', severity: 'high', first: iso(2026, 11, 10, 7, 30), ended: null, how: 'open', after: '1 h' },
  { text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: iso(2026, 11, 3, 9, 12), ended: iso(2026, 11, 5, 9, 40), how: 'resolved', after: '2 d' },
  { text: 'A production deploy failed', rule: 'prod-deploy-error', severity: 'high', first: iso(2026, 11, 4, 14, 0), ended: iso(2026, 11, 4, 16, 20), how: 'acted', after: '2 h' },
  { text: 'Secrets in plain sight', rule: 'secrets', severity: 'high', first: iso(2026, 11, 2, 8, 0), ended: iso(2026, 11, 6, 8, 5), how: 'dismissed', after: '4 d' },
  { text: 'CI failing on 3 repos', rule: 'ci-red', severity: 'med', first: iso(2026, 11, 5, 11, 0), ended: iso(2026, 11, 6, 12, 0), how: 'changed', after: '1 d' },
  { text: 'An account needs confirming', rule: 'money-stale', severity: 'med', first: iso(2026, 11, 1, 10, 0), ended: iso(2026, 11, 3, 10, 0), how: 'silent', after: '2 d' },
];

const answer = (o) => normalizeAnswer(Object.assign({ entries: [], clearedThisWeek: 0, dismissedThisWeek: 0, allClear: null, notice: '' }, o || {}));
const CLEAR = { since: iso(2026, 11, 10, 8, 50), resolved: [
  { text: 'Work not pushed', after: '2 d', how: 'resolved', ended: iso(2026, 11, 10, 8, 50) },
  { text: 'A bill is late', after: '5 h', how: 'acted', ended: iso(2026, 11, 10, 8, 50) },
] };

const ready = (data, o) => Object.assign({ bhsLoaded: true, bhsErr: '', bhsBusy: false, bhsData: data }, o || {});

export function briefHistoryStates() {
  const op = (name, hist) => ({ name, tab: 'history', sub: 'timeline', brief: briefOf(BI), hist });
  const home = (name, brief, hist) => ({ name, tab: 'home', sub: null, brief, hist });
  return [
    op('bhs-operator-entries', ready(answer({ entries: ENTRIES, clearedThisWeek: 2, dismissedThisWeek: 1 }))),
    op('bhs-operator-empty', ready(answer())),
    op('bhs-operator-loading', { bhsLoaded: false, bhsErr: '', bhsBusy: false, bhsData: null }),
    op('bhs-operator-error', { bhsLoaded: true, bhsErr: 'selftest: synthetic history error', bhsBusy: false, bhsData: null }),
    op('bhs-operator-notice', ready(answer({ entries: ENTRIES.slice(0, 2), notice: 'The Brief history file was unreadable and was set aside as brief-ledger.json.corrupt; a new one was started.' }))),
    op('bhs-operator-offline', { bhsLoaded: false, bhsErr: '', bhsBusy: false, bhsData: null }),
    home('bhs-footer', briefOf(BI), ready(answer({ clearedThisWeek: 3, dismissedThisWeek: 1 }))),
    home('bhs-footer-dismissed-only', briefOf(BI.slice(0, 1)), ready(answer({ clearedThisWeek: 0, dismissedThisWeek: 2 }))),
    home('bhs-all-clear', briefOf([]), ready(answer({ clearedThisWeek: 2, allClear: CLEAR }))),
    home('bhs-all-clear-busy', briefOf([]), ready(answer({ clearedThisWeek: 2, allClear: CLEAR }), { bhsBusy: true })),
    home('bhs-clear-no-card', briefOf([]), ready(answer({ clearedThisWeek: 0, dismissedThisWeek: 1 }))),
    home('bhs-clear-with-standing', briefOf([], { standing: [Object.assign({}, BI[0], { since: '2026-11-05T09:00:00.000Z' })] }), ready(answer({ allClear: CLEAR }))),
    home('bhs-clear-source-error', briefOf([], { errors: [{ source: 'pc-health', error: 'unreadable (selftest)' }] }), ready(answer({ allClear: CLEAR }))),
    home('bhs-card-stale-guard', briefOf(BI), ready(answer({ allClear: CLEAR }))),
  ];
}

export const BHS_STATE_KEYS = Object.freeze(['bhsLoaded', 'bhsData', 'bhsErr', 'bhsBusy']);
