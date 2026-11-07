// Sessions board geometry: lane count, clamping, active fraction, end-cap, now line, memo key. Pure. Placeholder data only.
//   node --test dashboard-v5/src/live/sessions-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from './sessions-view.mjs';

process.env.TZ = 'UTC';
const GEN = Date.parse('2026-11-05T12:00:00.000Z');
const H = 3600e3, MIN = 60e3;
const iso = (ms) => new Date(ms).toISOString();
const sess = (n, o = {}) => ({ id: 'id' + n, title: 'Session ' + n, project: { id: null, name: 'alpha-site', matched: 'folder' }, startedAt: iso(GEN - 3 * H), lastAt: iso(GEN - 10 * MIN),
  activeMin: 60, state: 'finished', sentence: 'finished its turn 10 min ago', ...o });
const board = (sessions, o = {}) => ({ v: 1, generatedAt: iso(GEN), state: 'ok', sessions, nightly: { count: 0, lastAt: null }, codex: null, ...o });

test.beforeEach(() => V.resetMemo());

test('at most 12 session lanes, newest first; the rest are counted, not drawn', () => {
  const many = Array.from({ length: 15 }, (_, i) => sess(i, { lastAt: iso(GEN - (i + 1) * 5 * MIN), startedAt: iso(GEN - 5 * H) }));
  const t = V.timeline(board(many));
  assert.equal(t.lanes.filter((l) => l.kind === 'session').length, 12);
  assert.deepEqual(t.lanes.slice(0, 3).map((l) => l.key), ['id0', 'id1', 'id2']);
  assert.equal(t.moreSessions, 3);
  assert.ok(t.height >= V.TOP + 12 * V.LANE_H);
});

test('bars are clamped to the 24 h window and never pass the plot', () => {
  const t = V.timeline(board([sess(1, { startedAt: iso(GEN - 30 * H), lastAt: iso(GEN - 1 * MIN), activeMin: 2000 })]));
  const l = t.lanes[0];
  assert.equal(l.x1, t.plotX, 'a session older than the window starts at its left edge');
  assert.ok(l.x2 <= t.plotX + t.plotW);
  assert.ok(l.ax2 <= l.x2 && l.ax2 >= l.x1);
});

test('a session that ended before the window still gets a visible stub on the left edge', () => {
  const t = V.timeline(board([sess(1, { startedAt: iso(GEN - 40 * H), lastAt: iso(GEN - 30 * H) })]));
  assert.equal(t.lanes[0].x1, t.plotX);
  assert.ok(t.lanes[0].x2 - t.lanes[0].x1 >= V.MIN_BAR);
});

test('a one-turn session is at least MIN_BAR wide', () => {
  const t = V.timeline(board([sess(1, { startedAt: iso(GEN - 20 * MIN), lastAt: iso(GEN - 20 * MIN), activeMin: 0 })]));
  assert.ok(t.lanes[0].x2 - t.lanes[0].x1 >= V.MIN_BAR);
  assert.equal(t.lanes[0].ax2, t.lanes[0].x1, 'no active time lights nothing');
});

test('active fraction is at most 1 of the bar, and proportional below that', () => {
  const full = V.timeline(board([sess(1, { startedAt: iso(GEN - 2 * H), lastAt: iso(GEN - 1 * H), activeMin: 5000 })])).lanes[0];
  assert.equal(full.ax2, full.x2);
  V.resetMemo();
  const half = V.timeline(board([sess(1, { startedAt: iso(GEN - 4 * H), lastAt: iso(GEN - 2 * H), activeMin: 60 })])).lanes[0];
  assert.ok(Math.abs((half.ax2 - half.x1) - (half.x2 - half.x1) / 2) < 0.2);
});

test('end-cap and pulse only on a running session', () => {
  const t = V.timeline(board([sess(1, { state: 'running' }), sess(2, { state: 'waiting-tool' }), sess(3)]));
  const [a, b, c] = t.lanes;
  assert.equal(a.pulse, true);
  assert.deepEqual(a.cap, { cx: a.x2, cy: a.y + V.LANE_H / 2 });
  assert.equal(b.cap, null);
  assert.equal(c.pulse, false);
});

test('state colours are tokens only', () => {
  assert.equal(V.toneOf('running'), 'var(--gold)');
  assert.equal(V.toneOf('waiting-tool'), 'var(--orange)');
  for (const s of ['stopped-mid-tool', 'limit', 'api-error', 'no-reply']) assert.equal(V.toneOf(s), 'var(--red)');
  assert.equal(V.toneOf('finished'), 'var(--green)');
  assert.equal(V.toneOf('quiet'), 'var(--muted)');
  assert.equal(V.toneOf('???'), 'var(--muted)');
  const t = V.timeline(board([sess(1)], { nightly: { count: 2, lastAt: iso(GEN - 2 * H) }, codex: { count: 3, lastAt: iso(GEN - 3 * H) } }));
  for (const l of t.lanes) assert.match(l.color, /^var\(--[a-z]+\)$/);
});

test('the now line sits at the right edge of the plot, which moves with width', () => {
  const t = V.timeline(board([sess(1)]), 960);
  assert.equal(t.nowX, t.plotX + t.plotW);
  const narrow = V.timeline(board([sess(1)]), 400);
  assert.ok(narrow.nowX < t.nowX);
  assert.ok(narrow.plotX < t.plotX, 'a narrow picture gives the label column less room');
  assert.equal(V.timeline(board([]), 5).width, 320, 'width is clamped');
});

test('a session started 6 h ago is a quarter of the way in from the left', () => {
  const t = V.timeline(board([sess(1, { startedAt: iso(GEN - 18 * H), lastAt: iso(GEN - 6 * H) })]), 960);
  const l = t.lanes[0];
  assert.ok(Math.abs(l.x1 - (t.plotX + t.plotW * 0.25)) < 0.2);
  assert.ok(Math.abs(l.x2 - (t.plotX + t.plotW * 0.75)) < 0.2);
});

test('folded lanes: nightly and Codex, with their counts, after the session lanes, never with a cap', () => {
  const t = V.timeline(board([sess(1)], { nightly: { count: 17, lastAt: iso(GEN - 2 * H) }, codex: { count: 20, lastAt: iso(GEN - 3 * 24 * H) } }));
  assert.deepEqual(t.lanes.map((l) => l.kind), ['session', 'nightly', 'codex']);
  assert.equal(t.lanes[1].label, 'nightly scan runs (17)');
  assert.equal(t.lanes[1].marker, true);
  assert.equal(t.lanes[2].label, 'Codex (20 threads · last 3 d ago)');
  assert.equal(t.lanes[2].marker, false, 'last run is outside the 24 h window: label only, no tick');
  assert.ok(t.lanes.slice(1).every((l) => l.cap === null && l.pulse === false));
  V.resetMemo();
  const none = V.timeline(board([sess(1)]));
  assert.deepEqual(none.lanes.map((l) => l.kind), ['session']);
});

test('gridlines every 6 hours on the local clock', () => {
  const t = V.timeline(board([sess(1)]));
  assert.deepEqual(t.ticks.map((x) => x.label), ['12:00', '18:00', '00:00', '06:00', '12:00']);
  assert.ok(t.ticks.every((x) => x.x >= t.plotX && x.x <= t.plotX + t.plotW));
});

test('memoized on generatedAt and width', () => {
  const b = board([sess(1)]);
  const a1 = V.timeline(b, 960);
  assert.equal(V.timeline(b, 960), a1, 'same board, same width: the same object');
  assert.equal(V.timeline({ ...b }, 960), a1, 'a fresh object with the same generatedAt reuses it');
  assert.notEqual(V.timeline(b, 800), a1);
  assert.notEqual(V.timeline(board([sess(1)], { generatedAt: iso(GEN + 30e3) }), 800), a1);
  assert.equal(V.memoKey(b, 960), iso(GEN) + '|960');
  const again = V.timeline(b, 800);
  assert.equal(again.key, iso(GEN) + '|800');
});

test('missing or broken boards do not throw', () => {
  for (const b of [null, undefined, {}, { sessions: 'x' }, { generatedAt: 'nope', sessions: [sess(1)] }]) {
    V.resetMemo();
    const t = V.timeline(b);
    assert.deepEqual(t.lanes, []);
    assert.ok(t.height > 0);
  }
});
