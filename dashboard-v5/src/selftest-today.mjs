// Today ribbon — the states the selftest walks (selftest.js loops them beside Money's and Cosmos's, in both themes).
//
//   todayStates() -> [name, 'home', todayLive, tdyState, extra][]            (the Cosmos row shape, selftest-cosmos.mjs)
//     todayLive  a LIVE.today slice, put straight into the store (LV.today = row[2]); the arrival read is held by the caller, so a row
//                never replaces its own slice with the fake preload's answer
//     tdyState   the tdy* component state this row sets (todayInitState() spread first by the caller: a row never inherits the previous
//                row's day)
//     extra      any other state patch (none today)
//
//   TODAY_OFFLINE_ROWS  rows that need hq.today hidden for one combo (the store's hq, never window.hq), like cosmos-offline
//   placeholderDay(dayOffset, over?)  an invented day in exactly the shape main answers (dashboard/day-core.mjs buildDay + ok/dayOffset),
//                                     for the fake preload's hq.today.read and these rows; invented project ids only (public repo)
//
// Import-light on purpose (only the slice's emptyToday) and no IO: the test drives it in plain Node.
import { emptyToday } from './live/today-slice.mjs';

export const TODAY_OFFLINE_ROWS = Object.freeze(['today-offline']);
export const todayInitState = () => ({ tdyOffset: 0, tdyNamesAt: 0 });

const DAYS = ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04'];

const claudeLane = (i, ref, blocks) => ({ id: 'claude-' + i, kind: 'claude', ref, state: 'ok', blocks });
const blocks = (lane, list) => list.map(([a, b]) => ({ lane, kind: 'block', startMin: a, endMin: b }));

/** The invented busy day: three projects, a browser lane, a sleep in the middle, commits. offset > 0 is a finished day. */
export function placeholderDay(dayOffset = 0, over = {}) {
  const day = DAYS[dayOffset] || DAYS[0];
  const today = dayOffset === 0;
  const m = {
    ok: true, dayOffset, day, isToday: today, nowMin: today ? 14 * 60 + 20 : null, tzOffsetMin: 0, generatedAt: day + 'T14:20:00.000Z',
    lanes: [
      claudeLane(1, 'code:alpha-site', 22), claudeLane(2, 'code:beta-app', 11), claudeLane(3, 'code:gamma-notes', 4),
      { id: 'browser', kind: 'browser', ref: null, state: 'ok' },
      { id: 'power', kind: 'power', ref: null, state: 'ok' },
      { id: 'commits', kind: 'commits', ref: null, state: 'ok' },
    ],
    spans: [
      ...blocks('claude-1', [[540, 580], [600, 640], [760, 790]]), ...blocks('claude-2', [[620, 660], [800, 830]]), ...blocks('claude-3', [[840, 860]]),
      { lane: 'browser', kind: 'focus', startMin: 530, endMin: 560 }, { lane: 'browser', kind: 'focus', startMin: 700, endMin: 735 },
      { lane: 'power', kind: 'awake', startMin: 480, endMin: 690 }, { lane: 'power', kind: 'asleep', startMin: 690, endMin: 750 }, { lane: 'power', kind: 'awake', startMin: 750, endMin: today ? 860 : 1080 },
      { lane: 'power', kind: 'unknown', startMin: 0, endMin: 480 },
    ],
    ticks: [{ lane: 'commits', min: 585, count: 1 }, { lane: 'commits', min: 655, count: 2 }, { lane: 'commits', min: 805, count: 1 }],
    caption: '37 five-minute blocks with Claude across 3 projects, 4 commits, PC asleep 1 h',
    counts: { claudeBlocks: 37, claudeProjects: 3, commits: 4, asleepMinutes: 60, browserMinutes: 65 },
    notes: ['PC lane: stretches with no app log line are shown as unknown, never as asleep'],
  };
  return { ...m, ...over };
}

// ---- LIVE.today builders ----------------------------------------------------------------------------------------
const liveOf = (days, errors = {}) => {
  const t = emptyToday();
  t.loaded = true;
  t.revision = 1;
  for (const [k, model] of Object.entries(days)) t.days[k] = { model, at: Date.now() };
  t.errors = { ...errors };
  return t;
};
const lane = (id, kind, state, note) => ({ id, kind, ref: null, state, ...(note ? { note } : {}) });

/** @returns {Array<[string, string, object, object, object]>} */
export function todayStates() {
  const row = (name, live, ts, extra) => [name, 'home', live, ts || {}, extra || {}];
  const full = () => placeholderDay(0);
  const zero = placeholderDay(0, {
    lanes: [lane('claude', 'claude', 'empty', 'No Claude turns on this day'), lane('browser', 'browser', 'empty', 'No browser focus recorded for this day'), lane('power', 'power', 'ok'), lane('commits', 'commits', 'empty', 'No commits on this day')],
    spans: [{ lane: 'power', kind: 'awake', startMin: 480, endMin: 860 }, { lane: 'power', kind: 'unknown', startMin: 0, endMin: 480 }], ticks: [],
    caption: '0 five-minute blocks with Claude, 0 commits, no PC sleep seen', counts: { claudeBlocks: 0, claudeProjects: 0, commits: 0, asleepMinutes: 0, browserMinutes: 0 },
    notes: ['PC lane: stretches with no app log line are shown as unknown, never as asleep'],
  });
  const partial = placeholderDay(4, {
    lanes: [lane('claude', 'claude', 'unavailable', 'Claude lane: update the Hub (this one does not know the day query yet)'), lane('browser', 'browser', 'not-kept', 'browser lane is kept for 3 days'),
      lane('power', 'power', 'unavailable', 'PC lane: no app log for this day (the app was not running, or the log is older than 30 days)'), lane('commits', 'commits', 'ok')],
    spans: [], ticks: [{ lane: 'commits', min: 700, count: 2 }],
    caption: 'Claude blocks unavailable, 2 commits, PC sleep unknown', counts: { claudeBlocks: null, claudeProjects: null, commits: 2, asleepMinutes: null, browserMinutes: null },
    notes: ['Claude lane: update the Hub (this one does not know the day query yet)', 'browser lane is kept for 3 days', 'PC lane: no app log for this day (the app was not running, or the log is older than 30 days)'],
  });
  const many = placeholderDay(0, {
    lanes: [...Array.from({ length: 8 }, (_, i) => claudeLane(i + 1, 'code:placeholder-' + (i + 1), 8 - i)), { ...claudeLane(9, null, 6), id: 'claude-more', more: 5 }, lane('browser', 'browser', 'empty', 'No browser focus recorded for this day'), lane('power', 'power', 'ok'), lane('commits', 'commits', 'empty', 'No commits on this day')],
    spans: [...Array.from({ length: 8 }, (_, i) => blocks('claude-' + (i + 1), [[480 + i * 40, 520 + i * 40]])).flat(), ...blocks('claude-more', [[900, 960]]), { lane: 'power', kind: 'awake', startMin: 480, endMin: 860 }], ticks: [],
    caption: '58 five-minute blocks with Claude across 13 projects, 0 commits, no PC sleep seen', counts: { claudeBlocks: 58, claudeProjects: 13, commits: 0, asleepMinutes: 0, browserMinutes: 0 }, notes: [],
  });

  return [
    row('today-offline', emptyToday()),
    row('today-loading', emptyToday()),
    row('today-error', Object.assign(emptyToday(), { loaded: true, errors: { 0: 'selftest: synthetic read error' } })),
    row('today-ready', liveOf({ 0: full() })),
    row('today-ready-stale-error', liveOf({ 0: full() }, { 0: 'selftest: synthetic refresh error' })),
    row('today-zero', liveOf({ 0: zero })),
    row('today-many-projects', liveOf({ 0: many })),
    row('today-yesterday', liveOf({ 0: full(), 1: placeholderDay(1) }), { tdyOffset: 1 }),
    row('today-partial', liveOf({ 0: full(), 4: partial }), { tdyOffset: 4 }),
    row('today-oldest-day', liveOf({ 0: full(), 6: placeholderDay(6) }), { tdyOffset: 6 }),
  ];
}
