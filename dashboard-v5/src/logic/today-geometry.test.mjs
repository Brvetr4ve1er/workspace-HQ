// Today ribbon geometry (src/logic/today-geometry.mjs): minute-of-day to x, lane stacking, block merging, the 24 h axis, phone width,
// RTL, and a model with nothing in it. Invented lane ids only (public repo).
//   node --test dashboard-v5/src/logic/today-geometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, minuteToX, spanRect, mergeBlocks, axisMarks, isPhone, viewWidth, DAY_MIN, MIN_RECT_W, PHONE_VIEW_WIDTH, WIDE_VIEW_WIDTH } from './today-geometry.mjs';

const MODEL = {
  nowMin: 600,
  lanes: [
    { id: 'claude-1', kind: 'claude', ref: 'p1', state: 'ok', blocks: 3 },
    { id: 'claude-2', kind: 'claude', ref: 'p2', state: 'ok', blocks: 1 },
    { id: 'browser', kind: 'browser', state: 'not-kept', note: 'browser lane is kept for 3 days' },
    { id: 'power', kind: 'power', state: 'ok' },
    { id: 'commits', kind: 'commits', state: 'ok' },
  ],
  spans: [
    { lane: 'claude-1', kind: 'block', startMin: 100, endMin: 105 }, { lane: 'claude-1', kind: 'block', startMin: 105, endMin: 110 }, { lane: 'claude-1', kind: 'block', startMin: 300, endMin: 305 },
    { lane: 'claude-2', kind: 'block', startMin: 0, endMin: 5 },
    { lane: 'power', kind: 'awake', startMin: 0, endMin: 300 }, { lane: 'power', kind: 'asleep', startMin: 300, endMin: 450 }, { lane: 'power', kind: 'unknown', startMin: 450, endMin: 600 },
  ],
  ticks: [{ lane: 'commits', min: 200, count: 1 }, { lane: 'commits', min: 1439, count: 2 }],
};
const finite = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '<<NaN>>' : v)).includes('<<NaN>>') === false;

test('minuteToX: the ends, the middle, clamping, and RTL mirroring', () => {
  assert.equal(minuteToX(0, 100, 800), 100);
  assert.equal(minuteToX(DAY_MIN, 100, 800), 900);
  assert.equal(minuteToX(720, 100, 800), 500);
  assert.equal(minuteToX(-50, 100, 800), 100);
  assert.equal(minuteToX(99999, 100, 800), 900);
  assert.equal(minuteToX(NaN, 100, 800), 100);
  assert.equal(minuteToX(0, 100, 800, true), 900);
  assert.equal(minuteToX(DAY_MIN, 100, 800, true), 100);
  assert.equal(minuteToX(360, 100, 800, true), 700);
});

test('spanRect: a 5-minute block is never thinner than the minimum; nothing passes the plot’s edges; rtl spans keep their width', () => {
  const r = spanRect(100, 105, 0, 960);
  assert.ok(r.w >= MIN_RECT_W);
  assert.deepEqual(spanRect(0, 0.1, 10, 960), { x: 10, w: MIN_RECT_W });
  const edge = spanRect(1439.9, 1440, 10, 960);
  assert.ok(edge.x + edge.w <= 970 + 1e-9 && edge.x >= 10);
  const a = spanRect(60, 180, 0, 1440), b = spanRect(60, 180, 0, 1440, true);
  assert.equal(a.w, b.w);
  assert.deepEqual([a.x, b.x], [60, 1440 - 180]);
});

test('mergeBlocks joins touching and overlapping spans of one kind and keeps different kinds apart', () => {
  assert.deepEqual(mergeBlocks([
    { lane: 'l', kind: 'block', startMin: 10, endMin: 15 }, { lane: 'l', kind: 'block', startMin: 15, endMin: 20 }, { lane: 'l', kind: 'block', startMin: 40, endMin: 45 }, { lane: 'l', kind: 'block', startMin: 18, endMin: 22 },
  ]).map((s) => [s.startMin, s.endMin]), [[10, 22], [40, 45]]);
  assert.deepEqual(mergeBlocks([{ kind: 'a', startMin: 0, endMin: 10 }, { kind: 'b', startMin: 10, endMin: 20 }]).length, 2);
  assert.deepEqual(mergeBlocks([{ kind: 'a', startMin: 0, endMin: 10 }, { kind: 'a', startMin: 12, endMin: 20 }], 2).length, 1);
  assert.deepEqual(mergeBlocks([{ kind: 'a', startMin: 5, endMin: 5 }, null, { kind: 'a', startMin: NaN, endMin: 3 }, { startMin: 0, endMin: 1 }]), []);
  const input = [{ kind: 'a', startMin: 9, endMin: 10 }, { kind: 'a', startMin: 0, endMin: 9 }];
  mergeBlocks(input);
  assert.equal(input[0].startMin, 9, 'the input is not changed');
});

test('the 24 h axis: every 6 h on a phone, every 3 h elsewhere, edge labels anchored to the plot, mirrored in rtl', () => {
  assert.deepEqual(axisMarks(0, 960, { phone: true }).map((m) => m.label), ['00', '06', '12', '18', '24']);
  assert.deepEqual(axisMarks(0, 960).map((m) => m.label), ['00', '03', '06', '09', '12', '15', '18', '21', '24']);
  const m = axisMarks(10, 800);
  assert.deepEqual([m[0].anchor, m[1].anchor, m.at(-1).anchor], ['start', 'middle', 'end']);
  assert.deepEqual([m[0].x, m.at(-1).x], [10, 810]);
  const rtl = axisMarks(10, 800, { rtl: true });
  assert.deepEqual([rtl[0].x, rtl.at(-1).x, rtl[0].anchor, rtl.at(-1).anchor], [810, 10, 'end', 'start']);
});

test('phone width: below 520 px it lays out at 360 with labels above the bars and the whole width for time', () => {
  assert.deepEqual([isPhone(375), isPhone(519), isPhone(520), isPhone(1280), isPhone(undefined)], [true, true, false, false, false]);
  assert.deepEqual([viewWidth(375), viewWidth(1280)], [PHONE_VIEW_WIDTH, WIDE_VIEW_WIDTH]);
  const p = layout(MODEL, { width: PHONE_VIEW_WIDTH });
  const w = layout(MODEL, { width: WIDE_VIEW_WIDTH });
  assert.equal(p.phone, true);
  assert.equal(w.phone, false);
  assert.ok(p.plotW > PHONE_VIEW_WIDTH - 20, 'no side label column on a phone');
  assert.ok(w.plotX >= 100, 'a side label column elsewhere');
  const r0 = p.rows[0];
  assert.ok(r0.labelY < r0.y, 'the label sits above its bar');
  assert.ok(w.rows[0].labelY > w.rows[0].y, 'the label sits beside (level with) its bar');
  assert.deepEqual(p.axis.map((m) => m.label), ['00', '06', '12', '18', '24']);
});

test('lane stacking: rows in the model’s order, strictly increasing, no overlap, and the height holds them all', () => {
  const L = layout(MODEL, { width: WIDE_VIEW_WIDTH });
  assert.deepEqual(L.rows.map((r) => r.id), ['claude-1', 'claude-2', 'browser', 'power', 'commits']);
  for (let i = 1; i < L.rows.length; i++) assert.ok(L.rows[i].y >= L.rows[i - 1].y + L.rows[i - 1].h, 'rows overlap at ' + i);
  assert.ok(L.rows.at(-1).y + L.rows.at(-1).h <= L.height);
  assert.ok(L.rows[0].y >= L.axisH);
  assert.equal(L.viewBox, '0 0 ' + L.width + ' ' + L.height);
  // every rect and tick sits on its own row and inside the plot
  for (const r of L.rects) {
    const row = L.rows.find((x) => x.id === r.lane);
    assert.equal(r.y, row.y);
    assert.ok(r.x >= L.plotX - 1e-9 && r.x + r.w <= L.plotX + L.plotW + 1e-9, 'rect outside the plot');
  }
  for (const t of L.ticks) assert.ok(t.x >= L.plotX && t.x <= L.plotX + L.plotW);
});

test('adjacent blocks of a lane are merged into one rect; a lane with no source draws no rect and keeps its note', () => {
  const L = layout(MODEL);
  assert.deepEqual(L.rects.filter((r) => r.lane === 'claude-1').map((r) => [r.startMin, r.endMin]), [[100, 110], [300, 305]]);
  assert.equal(L.rects.filter((r) => r.lane === 'browser').length, 0);
  assert.deepEqual(L.noteRows, [{ id: 'browser', text: 'browser lane is kept for 3 days' }]);
  assert.equal(L.rows.find((r) => r.id === 'browser').note, 'browser lane is kept for 3 days');
  assert.equal(L.rows.find((r) => r.id === 'claude-1').note, '', 'a lane with data carries no note');
  assert.deepEqual(L.rects.filter((r) => r.lane === 'power').map((r) => r.kind), ['awake', 'asleep', 'unknown']);
});

test('commit ticks sit mid-minute and carry their counts; the last minute of the day is on the plot', () => {
  const L = layout(MODEL);
  assert.equal(L.ticks.length, 2);
  assert.equal(L.ticks[1].count, 2);
  assert.ok(L.ticks[1].x < L.plotX + L.plotW && L.ticks[1].x > L.plotX + L.plotW - 2);
});

test('today: a now marker and a shaded future; a finished day has neither', () => {
  const L = layout(MODEL);
  assert.equal(L.nowX, minuteToX(600, L.plotX, L.plotW));
  assert.equal(L.future.x, L.nowX);
  assert.ok(Math.abs(L.future.x + L.future.w - (L.plotX + L.plotW)) < 0.2);
  const done = layout({ ...MODEL, nowMin: null });
  assert.deepEqual([done.nowX, done.future], [null, null]);
  assert.equal(layout({ ...MODEL, nowMin: DAY_MIN }).future, null);
});

test('RTL: time runs right to left, side labels move to the right, and nothing leaves the plot', () => {
  const a = layout(MODEL, { width: WIDE_VIEW_WIDTH }), b = layout(MODEL, { width: WIDE_VIEW_WIDTH, rtl: true });
  const ra = a.rects.find((r) => r.lane === 'claude-1'), rb = b.rects.find((r) => r.lane === 'claude-1');
  assert.ok(rb.x > ra.x - 1 && rb.x + rb.w !== ra.x + ra.w);
  assert.equal(minuteToX(0, b.plotX, b.plotW, true), b.plotX + b.plotW);
  assert.deepEqual([a.rows[0].labelAnchor, b.rows[0].labelAnchor], ['start', 'end']);
  assert.ok(b.rows[0].labelX > b.plotX + b.plotW - 1, 'the label sits right of the plot');
  assert.ok(b.plotX < a.plotX, 'the plot moves left to leave room on the right');
  for (const r of b.rects) assert.ok(r.x >= b.plotX - 1e-9 && r.x + r.w <= b.plotX + b.plotW + 1e-9);
  assert.ok(b.nowX < b.plotX + b.plotW);
  assert.equal(b.future.x, b.plotX, 'the future is the left part');
});

test('a label function names the rows; the default is the lane kind', () => {
  assert.equal(layout(MODEL).rows[0].label, 'claude');
  assert.deepEqual(layout(MODEL, { labelOf: (l) => 'name of ' + l.id }).rows.map((r) => r.label).slice(0, 2), ['name of claude-1', 'name of claude-2']);
});

test('nothing in the model: a ribbon with its axis, no rows, no rects, no NaN', () => {
  for (const m of [null, undefined, {}, { lanes: [], spans: [], ticks: [] }, { lanes: 'x', spans: 3, ticks: {} }, { lanes: [null, { id: 5 }, {}] }]) {
    const L = layout(m);
    assert.deepEqual([L.rows, L.rects, L.ticks], [[], [], []]);
    assert.ok(L.height > 0 && finite(L), JSON.stringify(m));
    assert.equal(L.axis.length, 9);
  }
  const bad = layout({ nowMin: 'x', lanes: [{ id: 'a', kind: 'claude', state: 'ok' }], spans: [{ lane: 'a', kind: 'block', startMin: 'x', endMin: 4 }], ticks: [{ lane: 'a', min: NaN }] });
  assert.ok(finite(bad));
  assert.deepEqual([bad.rects.length, bad.ticks.length, bad.nowX], [0, 0, null]);
  assert.ok(finite(layout(MODEL, { width: NaN })));
  assert.ok(layout(MODEL, { width: 10 }).width >= 240, 'a silly width is raised to a usable one');
});

test('the layout is deterministic and does not change the model', () => {
  const copy = JSON.stringify(MODEL);
  assert.deepEqual(layout(MODEL), layout(MODEL));
  assert.equal(JSON.stringify(MODEL), copy);
});
