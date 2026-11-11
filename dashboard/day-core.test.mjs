// Today ribbon day model (dashboard/day-core.mjs): caption wording, power boundaries (a suspend with no resume, a resume with no
// suspend, a hard kill), local-day edges with a nonzero zone offset, a bucket on midnight, no data at all, browser events older than
// 3 days, and that no domain survives into the model. Placeholder ids only (public repo).
//   node --test dashboard/day-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDay, parsePowerLines, powerSegments, captionFromCounts, formatDuration, mergeRanges, dayBounds, localDayKey, shiftDayKey, cleanCounts,
  ALIVE_GAP_MS, BROWSER_KEPT_DAYS, MAX_CLAUDE_LANES,
} from './day-core.mjs';

const T = (s) => Date.parse(s);
const DAY = '2026-11-10';
const AFTER = T('2026-11-11T08:00:00.000Z');   // "now" for a finished day (UTC zone)
const ev = (iso, event) => ({ t: T(iso), event });
const bucket = (iso, project = 'p1', messages = 1) => ({ project_id: project, start_ms: T(iso), messages });
const run = (o = {}) => buildDay({ dayKey: DAY, tzOffsetMin: 0, now: AFTER, ...o });
const lane = (m, id) => m.lanes.find((l) => l.id === id);
const spansOf = (m, id) => m.spans.filter((s) => s.lane === id);

test('the caption counts blocks, projects, commits and sleep in the spec’s wording', () => {
  const buckets = [];
  for (let i = 0; i < 30; i++) buckets.push(bucket(new Date(T('2026-11-10T06:00:00Z') + i * 300000).toISOString(), 'alpha'));
  for (let i = 0; i < 15; i++) buckets.push(bucket(new Date(T('2026-11-10T09:00:00Z') + i * 600000).toISOString(), 'beta'));
  for (let i = 0; i < 5; i++) buckets.push(bucket(new Date(T('2026-11-10T20:00:00Z') + i * 300000).toISOString(), 'gamma'));
  const commits = [0, 1, 2, 3, 4, 5].map((i) => T('2026-11-10T10:00:00Z') + i * 3600000);
  const power = [ev('2026-11-10T11:45:00Z', 'start'), ev('2026-11-10T12:00:00Z', 'suspend'), ev('2026-11-10T14:30:00Z', 'resume'), ev('2026-11-10T14:40:00Z', 'quit')];
  const m = run({ claudeBuckets: { buckets }, commitTimes: commits, powerEvents: power, browserEvents: [] });
  assert.equal(m.caption, '50 five-minute blocks with Claude across 3 projects, 6 commits, PC asleep 2 h 30 m');
  assert.deepEqual(m.counts, { claudeBlocks: 50, claudeProjects: 3, commits: 6, asleepMinutes: 150, browserMinutes: 0 });
  assert.doesNotMatch(m.caption, /hours? (worked|of work)|productive/i);
});

test('the caption’s singular forms and its "none seen" forms', () => {
  assert.equal(captionFromCounts({ claudeBlocks: 1, claudeProjects: 1, commits: 1, asleepMinutes: 0 }), '1 five-minute block with Claude in 1 project, 1 commit, no PC sleep seen');
  assert.equal(captionFromCounts({ claudeBlocks: 12, claudeProjects: 1, commits: 0, asleepMinutes: 45 }), '12 five-minute blocks with Claude in 1 project, 0 commits, PC asleep 45 m');
  assert.equal(captionFromCounts({ claudeBlocks: 0, claudeProjects: 0, commits: 2, asleepMinutes: 120 }), '0 five-minute blocks with Claude, 2 commits, PC asleep 2 h');
  assert.equal(captionFromCounts({}), 'Claude blocks unavailable, commits unavailable, PC sleep unknown');
  assert.equal(captionFromCounts(null), 'Claude blocks unavailable, commits unavailable, PC sleep unknown');
  assert.deepEqual([0, 5, 59, 60, 61, 150, 1440].map(formatDuration), ['0 m', '5 m', '59 m', '1 h', '1 h 1 m', '2 h 30 m', '24 h']);
});

test('no data at all: every lane says why, every count is null, nothing is drawn, and nothing is a zero', () => {
  const m = run();
  assert.deepEqual(m.lanes.map((l) => [l.id, l.state]), [['claude', 'unavailable'], ['browser', 'unavailable'], ['power', 'unavailable'], ['commits', 'unavailable']]);
  assert.deepEqual(m.counts, { claudeBlocks: null, claudeProjects: null, commits: null, asleepMinutes: null, browserMinutes: null });
  assert.deepEqual([m.spans, m.ticks], [[], []]);
  assert.equal(m.caption, 'Claude blocks unavailable, commits unavailable, PC sleep unknown');
  for (const l of m.lanes) assert.ok(l.note, l.id + ' has no reason');
  assert.ok(m.notes.length >= 4);
});

test('a source that answered with nothing is "empty", not "unavailable", and its count is a real zero', () => {
  const m = run({ claudeBuckets: { buckets: [] }, commitTimes: [], browserEvents: [] });
  assert.equal(lane(m, 'claude').state, 'empty');
  assert.equal(lane(m, 'commits').state, 'empty');
  assert.equal(lane(m, 'browser').state, 'empty');
  assert.deepEqual([m.counts.claudeBlocks, m.counts.claudeProjects, m.counts.commits, m.counts.browserMinutes], [0, 0, 0, 0]);
});

test('Claude blocks: merged per project, counted per block, projects in order of blocks, a null project kept as null', () => {
  const m = run({ claudeBuckets: { buckets: [
    bucket('2026-11-10T10:00:00Z', 'a'), bucket('2026-11-10T10:05:00Z', 'a'), bucket('2026-11-10T10:10:00Z', 'a'), bucket('2026-11-10T11:00:00Z', 'a'),
    bucket('2026-11-10T10:00:00Z', 'b'), bucket('2026-11-10T10:00:00Z', null),
    bucket('2026-11-10T10:00:00Z', 'a'),   // an exact repeat is one block
  ] } });
  assert.deepEqual(m.lanes.filter((l) => l.kind === 'claude').map((l) => [l.id, l.ref, l.blocks]), [['claude-1', 'a', 4], ['claude-2', 'b', 1], ['claude-3', null, 1]]);
  assert.deepEqual(spansOf(m, 'claude-1'), [
    { lane: 'claude-1', kind: 'block', startMin: 600, endMin: 615 },
    { lane: 'claude-1', kind: 'block', startMin: 660, endMin: 665 },
  ]);
  assert.deepEqual([m.counts.claudeBlocks, m.counts.claudeProjects], [6, 3]);
});

test('more than 8 projects fold into one "more" lane whose blocks are still all counted', () => {
  const buckets = [];
  for (let p = 0; p < MAX_CLAUDE_LANES + 3; p++) buckets.push(bucket('2026-11-10T10:00:00Z', 'p' + String(p).padStart(2, '0'), 1));
  const m = run({ claudeBuckets: { buckets } });
  const claude = m.lanes.filter((l) => l.kind === 'claude');
  assert.equal(claude.length, MAX_CLAUDE_LANES + 1);
  assert.deepEqual([claude.at(-1).id, claude.at(-1).more, claude.at(-1).blocks], ['claude-more', 3, 3]);
  assert.deepEqual([m.counts.claudeBlocks, m.counts.claudeProjects], [MAX_CLAUDE_LANES + 3, MAX_CLAUDE_LANES + 3]);
  assert.equal(spansOf(m, 'claude-more').length, 1, 'the folded projects share one merged stretch');
});

test('a Hub that does not know the op gives a lane note, never an empty lane; other Hub errors are said too', () => {
  const old = run({ claudeBuckets: { error: 'unknown op' } });
  assert.equal(lane(old, 'claude').state, 'unavailable');
  assert.match(lane(old, 'claude').note, /update the Hub/);
  assert.equal(old.counts.claudeBlocks, null);
  assert.match(run({ claudeBuckets: { error: 'the index is not open yet' } }).lanes[0].note, /the index is not open yet/);
  assert.match(run({ claudeBuckets: { nope: 1 } }).lanes[0].note, /shape/);
  assert.match(run({ claudeBuckets: null }).lanes[0].note, /not running/);
});

test('local-day edges with a nonzero zone offset: east and west of UTC', () => {
  // UTC+2: the local day 2026-11-10 is 2026-11-09T22:00Z .. 2026-11-10T22:00Z
  const east = buildDay({ dayKey: DAY, tzOffsetMin: 120, now: T('2026-11-11T08:00:00Z'), claudeBuckets: { buckets: [
    bucket('2026-11-09T21:55:00Z'),   // the day before (local 23:55 on the 9th)
    bucket('2026-11-09T22:00:00Z'),   // local midnight: minute 0
    bucket('2026-11-10T21:55:00Z'),   // local 23:55: minute 1435
    bucket('2026-11-10T22:00:00Z'),   // the day after
  ] } });
  assert.deepEqual(spansOf(east, 'claude-1').map((s) => [s.startMin, s.endMin]), [[0, 5], [1435, 1440]]);
  assert.equal(east.counts.claudeBlocks, 2);
  // UTC-5 (west): the local day is 2026-11-10T05:00Z .. 2026-11-11T05:00Z
  const west = buildDay({ dayKey: DAY, tzOffsetMin: -300, now: T('2026-11-12T00:00:00Z'), claudeBuckets: { buckets: [bucket('2026-11-10T04:55:00Z'), bucket('2026-11-10T05:00:00Z'), bucket('2026-11-11T04:55:00Z'), bucket('2026-11-11T05:00:00Z')] } });
  assert.deepEqual(spansOf(west, 'claude-1').map((s) => [s.startMin, s.endMin]), [[0, 5], [1435, 1440]]);
  assert.deepEqual(dayBounds(DAY, 120), { startMs: T('2026-11-09T22:00:00Z'), endMs: T('2026-11-10T22:00:00Z'), tz: 120 });
  assert.equal(localDayKey(T('2026-11-09T22:30:00Z'), 120), DAY);
  assert.equal(localDayKey(T('2026-11-09T21:30:00Z'), 120), '2026-11-09');
  assert.equal(localDayKey(T('2026-11-10T04:30:00Z'), -300), '2026-11-09');
});

test('a bucket on midnight belongs to the new day; a longer bucket that straddles the edge is drawn clipped to the day', () => {
  const m = run({ claudeBuckets: { buckets: [bucket('2026-11-10T00:00:00Z'), bucket('2026-11-11T00:00:00Z')] } });
  assert.deepEqual(spansOf(m, 'claude-1').map((s) => [s.startMin, s.endMin]), [[0, 5]]);
  assert.equal(m.counts.claudeBlocks, 1);
  const s = run({ claudeBuckets: { bucketMin: 10, buckets: [{ project_id: 'p', start_ms: T('2026-11-09T23:55:00Z'), messages: 1 }] } });
  assert.deepEqual(spansOf(s, 'claude-1').map((x) => [x.startMin, x.endMin]), [[0, 5]]);
});

test('a day that has not finished: now is shown, nothing is drawn after it, a bucket in the future is dropped', () => {
  const now = T('2026-11-10T10:30:00Z');
  const m = buildDay({ dayKey: DAY, tzOffsetMin: 0, now, claudeBuckets: { buckets: [bucket('2026-11-10T10:25:00Z'), bucket('2026-11-10T14:00:00Z')] },
    powerEvents: [ev('2026-11-10T09:00:00Z', 'start'), ev('2026-11-10T10:15:00Z', 'alive')], commitTimes: [T('2026-11-10T10:00:00Z'), T('2026-11-10T11:00:00Z')] });
  assert.deepEqual([m.isToday, m.nowMin], [true, 630]);
  assert.equal(m.counts.claudeBlocks, 1);
  assert.equal(m.counts.commits, 1);
  assert.ok(m.spans.every((s) => s.endMin <= 630), 'nothing past now');
  assert.deepEqual(spansOf(m, 'power').at(-1), { lane: 'power', kind: 'awake', startMin: 615, endMin: 630 });
  assert.deepEqual([run().isToday, run().nowMin], [false, null]);
  assert.match(buildDay({ dayKey: DAY, tzOffsetMin: 0, now: T('2026-11-09T12:00:00Z') }).error, /not started/);
  assert.match(buildDay({ dayKey: '2026-02-30', now }).error, /real date/);
  assert.match(buildDay({ dayKey: 'today', now }).error, /real date/);
});

// ---- power ------------------------------------------------------------------------------------------------------------------
test('a suspend and its resume are asleep; awake is only where the app’s own lines bracket it; the rest is unknown', () => {
  const segs = powerSegments([
    ev('2026-11-10T08:00:00Z', 'start'), ev('2026-11-10T08:15:00Z', 'alive'), ev('2026-11-10T08:30:00Z', 'suspend'),
    ev('2026-11-10T10:00:00Z', 'resume'), ev('2026-11-10T10:15:00Z', 'alive'),
  ], T('2026-11-10T00:00:00Z'), T('2026-11-10T11:00:00Z'));
  assert.deepEqual(segs.map((s) => [s.kind, new Date(s.a).toISOString().slice(11, 16), new Date(s.b).toISOString().slice(11, 16)]), [
    ['unknown', '00:00', '08:00'], ['awake', '08:00', '08:30'], ['asleep', '08:30', '10:00'], ['awake', '10:00', '10:15'], ['unknown', '10:15', '11:00'],
  ]);
});

test('a day with only a suspend: nothing known, so never "asleep" and no count', () => {
  const m = run({ powerEvents: [ev('2026-11-10T12:00:00Z', 'suspend')] });
  assert.equal(lane(m, 'power').state, 'unavailable');
  assert.equal(m.counts.asleepMinutes, null);
  assert.ok(spansOf(m, 'power').every((s) => s.kind === 'unknown'));
  assert.match(m.caption, /PC sleep unknown$/);
});

test('a suspend before midnight and its resume after: the neighbouring days’ lines carry the sleep across both edges', () => {
  const m = run({ powerEvents: [
    ev('2026-11-09T22:50:00Z', 'alive'), ev('2026-11-09T23:00:00Z', 'suspend'), ev('2026-11-10T06:00:00Z', 'resume'), ev('2026-11-10T06:10:00Z', 'alive'),
    ev('2026-11-10T23:40:00Z', 'alive'), ev('2026-11-10T23:50:00Z', 'suspend'), ev('2026-11-11T07:00:00Z', 'resume'),
  ] });
  // asleep 00:00-06:00 (360) and 23:50-24:00 (10)
  assert.equal(m.counts.asleepMinutes, 370);
  assert.deepEqual(spansOf(m, 'power')[0], { lane: 'power', kind: 'asleep', startMin: 0, endMin: 360 });
  assert.deepEqual(spansOf(m, 'power').at(-1), { lane: 'power', kind: 'asleep', startMin: 1430, endMin: 1440 });
});

test('a resume with no suspend is not sleep: close to the last line it is awake, after a long silence it is unknown', () => {
  const near = powerSegments([ev('2026-11-10T10:00:00Z', 'alive'), ev('2026-11-10T10:05:00Z', 'resume'), ev('2026-11-10T10:10:00Z', 'alive')], T('2026-11-10T10:00:00Z'), T('2026-11-10T10:10:00Z'));
  assert.deepEqual(near.map((s) => s.kind), ['awake']);
  const far = powerSegments([ev('2026-11-10T10:00:00Z', 'alive'), ev('2026-11-10T13:00:00Z', 'resume'), ev('2026-11-10T13:05:00Z', 'alive')], T('2026-11-10T10:00:00Z'), T('2026-11-10T13:05:00Z'));
  assert.deepEqual(far.map((s) => s.kind), ['unknown', 'awake']);
});

test('an app killed hard: an unmatched start after a long silence is "unknown", not "asleep"', () => {
  const m = run({ powerEvents: [ev('2026-11-10T09:00:00Z', 'start'), ev('2026-11-10T09:15:00Z', 'alive'), ev('2026-11-10T13:00:00Z', 'start'), ev('2026-11-10T13:15:00Z', 'alive')] });
  assert.equal(m.counts.asleepMinutes, 0);
  const gap = spansOf(m, 'power').find((s) => s.startMin === 555);
  assert.deepEqual([gap.kind, gap.endMin], ['unknown', 780]);
  assert.ok(m.notes.some((n) => /never as asleep/.test(n)));
  // a clean quit then a later start is the same: the app was not running
  const q = powerSegments([ev('2026-11-10T09:00:00Z', 'start'), ev('2026-11-10T09:05:00Z', 'quit'), ev('2026-11-10T12:00:00Z', 'start'), ev('2026-11-10T12:10:00Z', 'alive')], T('2026-11-10T09:00:00Z'), T('2026-11-10T12:10:00Z'));
  assert.deepEqual(q.map((s) => s.kind), ['awake', 'unknown', 'awake']);
});

test('a suspend that is followed by anything but a resume or a start is not asleep; a start after a suspend closes the sleep', () => {
  assert.deepEqual(powerSegments([ev('2026-11-10T09:00:00Z', 'suspend'), ev('2026-11-10T09:30:00Z', 'alive')], T('2026-11-10T09:00:00Z'), T('2026-11-10T09:30:00Z')).map((s) => s.kind), ['unknown']);
  assert.deepEqual(powerSegments([ev('2026-11-10T09:00:00Z', 'suspend'), ev('2026-11-10T11:00:00Z', 'start')], T('2026-11-10T09:00:00Z'), T('2026-11-10T11:00:00Z')).map((s) => s.kind), ['asleep']);
  assert.ok(ALIVE_GAP_MS > 15 * 60000, 'a 15-minute heartbeat must fit inside the bracket');
});

test('parsePowerLines: ts offsets are honoured, junk and other events are skipped, a second launch’s lines are dropped', () => {
  const text = [
    '{"ts":"2026-11-10T09:00:00.000+02:00","event":"start","pid":11}',
    'not json at all',
    '{"ts":"2026-11-10T09:15:00.000+02:00","event":"alive","pid":11,"rssMb":120}',
    '{"ts":"2026-11-10T09:20:00.000+02:00","event":"page-load","pid":11}',
    '{"ts":"2026-11-10T09:21:00.000+02:00","event":"start","pid":12,"secondary":true}',
    '{"ts":"2026-11-10T09:21:05.000+02:00","event":"quit","pid":12,"reason":"second-launch"}',
    '{"ts":"garbage","event":"alive","pid":11}',
    '{"event":"alive","pid":11}',
    '{"ts":"2026-11-10T09:30:00.000+02:00","event":"suspend","pid":11}',
    '',
  ].join('\n');
  const rows = parsePowerLines(text);
  assert.deepEqual(rows.map((r) => [new Date(r.t).toISOString().slice(11, 16), r.event]), [['07:00', 'start'], ['07:15', 'alive'], ['07:30', 'suspend']]);
  assert.deepEqual(parsePowerLines(null), []);
  assert.deepEqual(parsePowerLines('[1,2]\n{"a":1}'), []);
});

// ---- browser --------------------------------------------------------------------------------------------------------------
test('browser focus is merged into stretches and counted in minutes; a domain, host, url or title never survives into the model', () => {
  const events = [
    { domain: 'secret.example', host: 'secret.example', url: 'https://secret.example/a?token=abc', title: 'a secret title', path: '/a', ts: T('2026-11-10T10:00:00Z'), focus_ms: 120000 },
    { domain: 'other.example', host: 'other.example', url: 'https://other.example/', title: 'other', ts: T('2026-11-10T10:02:10Z'), focus_ms: 60000 },
    { domain: 'x.example', ts: T('2026-11-10T15:00:00Z'), focus_ms: 0 },
    { domain: 'x.example', ts: 'soon', focus_ms: 5 },
  ];
  const m = buildDay({ dayKey: DAY, tzOffsetMin: 0, now: T('2026-11-11T08:00:00Z'), browserEvents: events });
  assert.deepEqual(spansOf(m, 'browser'), [{ lane: 'browser', kind: 'focus', startMin: 600, endMin: 603.17 }]);
  assert.equal(m.counts.browserMinutes, 3);
  assert.equal(lane(m, 'browser').state, 'ok');
  const all = JSON.stringify(m);
  for (const s of ['secret', 'example', 'token', 'title', 'https:', '.com']) assert.ok(!all.includes(s), 'the model leaked ' + s);
});

test('browser events older than 3 days give the "not kept" note, never zeros; a day half inside the window says it covers only part', () => {
  const now = T('2026-11-11T08:00:00Z');
  const old = buildDay({ dayKey: '2026-11-07', tzOffsetMin: 0, now, browserEvents: [{ ts: T('2026-11-07T10:00:00Z'), focus_ms: 60000 }] });
  assert.equal(lane(old, 'browser').state, 'not-kept');
  assert.equal(lane(old, 'browser').note, 'browser lane is kept for 3 days');
  assert.equal(old.counts.browserMinutes, null);
  assert.deepEqual(spansOf(old, 'browser'), []);
  assert.ok(old.notes.includes('browser lane is kept for 3 days'));
  assert.equal(BROWSER_KEPT_DAYS, 3);
  const part = buildDay({ dayKey: '2026-11-08', tzOffsetMin: 0, now, browserEvents: [{ ts: T('2026-11-08T12:00:00Z'), focus_ms: 600000 }] });
  assert.equal(lane(part, 'browser').state, 'ok');
  assert.match(lane(part, 'browser').note, /only part of this day/);
  assert.equal(part.counts.browserMinutes, 10);
  const full = buildDay({ dayKey: '2026-11-10', tzOffsetMin: 0, now, browserEvents: [] });
  assert.equal(lane(full, 'browser').state, 'empty');
  assert.equal(buildDay({ dayKey: '2026-11-10', tzOffsetMin: 0, now, browserEvents: null }).counts.browserMinutes, null);
});

// ---- commits ----------------------------------------------------------------------------------------------------------------
test('commit ticks: grouped by minute, the day’s own commits only, and never a subject or an author', () => {
  const m = run({ commitTimes: { times: [T('2026-11-10T10:00:10Z'), T('2026-11-10T10:00:50Z'), T('2026-11-10T11:30:00Z'), T('2026-11-09T23:59:59Z'), T('2026-11-11T00:00:00Z'), 'x', NaN], capped: true, failed: 2, repos: 5, subject: 'wip', author: 'someone' } });
  assert.deepEqual(m.ticks, [{ lane: 'commits', min: 600, count: 2 }, { lane: 'commits', min: 690, count: 1 }]);
  assert.equal(m.counts.commits, 3);
  assert.ok(m.notes.some((n) => /200-commit cap/.test(n)));
  assert.ok(m.notes.some((n) => /2 repositories could not be read/.test(n)));
  assert.ok(!JSON.stringify(m).includes('someone') && !JSON.stringify(m).includes('wip'));
  assert.equal(lane(run({ commitTimes: [] }), 'commits').state, 'empty');
});

test('mergeRanges, shiftDayKey and cleanCounts', () => {
  assert.deepEqual(mergeRanges([[5, 9], [1, 3], [3, 4], [9, 9]]), [[1, 4], [5, 9]]);
  assert.deepEqual(mergeRanges([[1, 2], [3, 4]], 1), [[1, 4]]);
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDayKey('nope', 1), null);
  assert.deepEqual(cleanCounts({ claudeBlocks: 3.4, claudeProjects: '2', commits: -1, asleepMinutes: NaN, browserMinutes: null, project: 'alpha', domain: 'x' }),
    { claudeBlocks: 3, claudeProjects: null, commits: null, asleepMinutes: null, browserMinutes: null });
  assert.deepEqual(Object.keys(cleanCounts(null)), ['claudeBlocks', 'claudeProjects', 'commits', 'asleepMinutes', 'browserMinutes']);
});

test('buildDay does not change its inputs and answers the same twice', () => {
  const input = { claudeBuckets: { buckets: [bucket('2026-11-10T10:00:00Z', 'a')] }, powerEvents: [ev('2026-11-10T09:00:00Z', 'start')], browserEvents: [{ ts: T('2026-11-10T10:00:00Z'), focus_ms: 1000, domain: 'd' }], commitTimes: [T('2026-11-10T10:00:00Z')] };
  const copy = JSON.stringify(input);
  const a = run(input), b = run(input);
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(a, b);
});
