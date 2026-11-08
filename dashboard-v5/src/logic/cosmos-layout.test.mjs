// Cosmos masonry maths. Behaviour ported from Cosmos Local's masonryLayout.test.ts; invented works only.
//   node --test dashboard-v5/src/logic/cosmos-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMasonry, layoutGroups, ratioOf, colsFor, DENSITY_COLS, MOBILE_COLS, MOBILE_BREAK, FALLBACK_RATIO, HEADER_H, SECTION_PAD,
} from './cosmos-layout.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const w = (id, width, height) => ({ id, title: id, width, height });

test('constants match the density table, mobile grid and fallback ratio', () => {
  assert.deepEqual({ ...DENSITY_COLS.compact }, { col: 176, gap: 12 });
  assert.deepEqual({ ...DENSITY_COLS.cozy }, { col: 244, gap: 16 });
  assert.deepEqual({ ...DENSITY_COLS.roomy }, { col: 330, gap: 20 });
  assert.deepEqual({ ...MOBILE_COLS }, { col: 168, gap: 10 });
  assert.equal(MOBILE_BREAK, 860);
  assert.equal(FALLBACK_RATIO, 3 / 4);
});

test('no items gives an empty layout; width never drops below one column', () => {
  const e = computeMasonry([], 1000, 200, 10);
  assert.deepEqual(e.rects, []);
  assert.equal(e.height, 0);
  assert.equal(computeMasonry([1], 50, 200, 10).columns, 1);
  assert.equal(computeMasonry([], 1000, 200, 10).columns, 4, '(1000+10)/(200+10) = 4.8');
});

test('columns and gaps exactly fill the container; items take the column width and their ratio', () => {
  const m = computeMasonry([1, 2, 0.5], 1000, 200, 10);
  assert.equal(m.columns, 4);
  near(m.colWidth * 4 + 10 * 3, 1000);
  near(m.rects[0].w, m.colWidth);
  near(m.rects[0].h, m.colWidth / 1);
  near(m.rects[1].h, m.colWidth / 2);
  near(m.rects[2].h, m.colWidth / 0.5);
});

test('the first row fills left to right (ties go leftmost); then each item drops into the shortest column', () => {
  const m = computeMasonry([1, 1, 1, 1, 1], 1000, 200, 10);
  near(m.rects[0].x, 0);
  near(m.rects[1].x, m.colWidth + 10);
  near(m.rects[3].x, 3 * (m.colWidth + 10));
  near(m.rects[4].x, 0, 1e-9);
  near(m.rects[4].y, m.rects[0].h + 10);
  // a tall first item pushes the next row away from column 0
  const t = computeMasonry([0.25, 1, 1, 1, 1], 1000, 200, 10);
  assert.notEqual(t.rects[4].x, 0, 'column 0 is the tallest, so the fifth item goes elsewhere');
  near(t.rects[4].x, t.colWidth + 10);
});

test('the height is the tallest column without a trailing gap', () => {
  const m = computeMasonry([1], 300, 200, 10);
  assert.equal(m.columns, 1);
  near(m.height, m.colWidth);
  const two = computeMasonry([1, 1], 300, 200, 10);
  near(two.height, two.colWidth * 2 + 10);
});

test('zero, negative and non-numeric ratios use the fallback ratio', () => {
  const m = computeMasonry([0, -2, NaN, undefined], 1000, 200, 10);
  for (const r of m.rects) near(r.h, m.colWidth / FALLBACK_RATIO);
  near(ratioOf({ width: 400, height: 200 }), 2);
  assert.equal(ratioOf({}), FALLBACK_RATIO);
  assert.equal(ratioOf({ width: 0, height: 5 }), FALLBACK_RATIO);
  assert.equal(ratioOf({ width: 'x', height: 5 }), FALLBACK_RATIO);
  assert.equal(ratioOf(null), FALLBACK_RATIO);
  assert.equal(ratioOf({ width: 100, height: 100 }), 1);
});

test('a narrow width collapses to the mobile columns whatever the density', () => {
  assert.deepEqual({ ...colsFor(MOBILE_BREAK - 1, 'roomy') }, { col: 168, gap: 10 });
  assert.deepEqual({ ...colsFor(MOBILE_BREAK, 'roomy') }, { col: 330, gap: 20 });
  assert.deepEqual({ ...colsFor(1200, 'nonsense') }, { col: 244, gap: 16 }, 'an unknown density is cozy');
  const narrow = layoutGroups([{ key: 'all', label: '', works: [w('a', 1, 1), w('b', 1, 1), w('c', 1, 1)] }], { width: 400, density: 'roomy' });
  assert.equal(narrow.columns, Math.floor((400 + 10) / (168 + 10)));
  const wide = layoutGroups([{ key: 'all', label: '', works: [w('a', 1, 1)] }], { width: 1040, density: 'roomy' });
  assert.equal(wide.columns, Math.floor((1040 + 20) / (330 + 20)));
});

test('layoutGroups: card boxes are dc-lite style maps of plain numbers', () => {
  const out = layoutGroups([{ key: 'all', label: '', works: [w('a', 400, 300), w('b', 300, 400)] }], { width: 1040, density: 'cozy' });
  assert.equal(out.cards.length, 2);
  assert.equal(out.headers.length, 0, 'an unlabelled group has no header');
  for (const c of out.cards) {
    assert.deepEqual(Object.keys(c).sort(), ['box', 'id']);
    assert.deepEqual(Object.keys(c.box).sort(), ['height', 'left', 'position', 'top', 'width']);
    assert.equal(c.box.position, 'absolute');
    for (const k of ['left', 'top', 'width', 'height']) assert.equal(typeof c.box[k], 'number');
  }
  assert.equal(out.cards[0].box.left, 0);
  assert.equal(out.cards[0].box.top, 0);
  assert.equal(out.shown, 2);
  assert.equal(out.total, 2);
});

test('layoutGroups: header offsets, section pad, flat order, no trailing pad', () => {
  const g1 = { key: 'a', label: 'Alpha', works: [w('a1', 1, 1), w('a2', 1, 1)] };
  const g2 = { key: 'b', label: 'Beta', works: [w('b1', 1, 1)] };
  const out = layoutGroups([g1, g2], { width: 1040, density: 'cozy' });
  const { colWidth } = out;
  assert.deepEqual(out.cards.map((c) => c.id), ['a1', 'a2', 'b1']);
  assert.deepEqual(out.headers.map((h) => [h.key, h.label, h.count]), [['a', 'Alpha', 2], ['b', 'Beta', 1]]);
  assert.equal(out.headers[0].box.top, 0);
  assert.equal(out.headers[0].box.height, HEADER_H);
  assert.equal(out.headers[0].box.width, 1040);
  assert.equal(out.cards[0].box.top, HEADER_H, 'cards start under the header slot');
  const firstGroupBottom = HEADER_H + colWidth; // two squares side by side in one row
  near(out.headers[1].box.top, firstGroupBottom + SECTION_PAD, 0.02);
  near(out.cards[2].box.top, out.headers[1].box.top + HEADER_H, 0.02);
  near(out.height, out.cards[2].box.top + out.cards[2].box.height, 0.02, 'the page ends at the last card');
  // one group matches the plain layout
  const single = layoutGroups([{ key: 'all', label: '', works: [w('a', 4, 3), w('b', 3, 4), w('c', 1, 1)] }], { width: 1040, density: 'cozy' });
  const plain = computeMasonry([4 / 3, 3 / 4, 1], 1040, 244, 16);
  near(single.height, plain.height, 0.01);
  near(single.cards[1].box.left, plain.rects[1].x, 0.01);
});

test('layoutGroups: limit lays out the first N cards across groups; headers keep the full count; empty groups vanish', () => {
  const g1 = { key: 'a', label: 'Alpha', works: [w('a1', 1, 1), w('a2', 1, 1)] };
  const g2 = { key: 'b', label: 'Beta', works: [w('b1', 1, 1), w('b2', 1, 1), w('b3', 1, 1)] };
  const g3 = { key: 'c', label: 'Gamma', works: [w('c1', 1, 1)] };
  const out = layoutGroups([g1, g2, g3], { width: 1040, density: 'cozy', limit: 3 });
  assert.deepEqual(out.cards.map((c) => c.id), ['a1', 'a2', 'b1']);
  assert.deepEqual(out.headers.map((h) => [h.key, h.count]), [['a', 2], ['b', 3]], 'Beta shows its full size, Gamma is not reached');
  assert.equal(out.shown, 3);
  assert.equal(out.total, 6);
  const none = layoutGroups([g1], { width: 1040, density: 'cozy', limit: 0 });
  assert.deepEqual([none.cards.length, none.headers.length, none.height, none.total], [0, 0, 0, 2]);
  assert.deepEqual(layoutGroups([], { width: 1040 }).cards, []);
  assert.equal(layoutGroups([{ key: 'x', label: 'X', works: [] }], { width: 1040 }).headers.length, 0);
});

test('layoutGroups survives a missing or silly width', () => {
  for (const width of [undefined, 0, -5, NaN]) {
    const out = layoutGroups([{ key: 'all', label: '', works: [w('a', 1, 1)] }], { width });
    assert.equal(out.cards.length, 1);
    assert.ok(Number.isFinite(out.height));
  }
});

test('1,000 items lay out fast (generous budget; the number is reported)', () => {
  const works = Array.from({ length: 1000 }, (_, i) => w(`w${i}`, 200 + (i * 37) % 400, 200 + (i * 53) % 400));
  const groups = [{ key: 'all', label: '', works }];
  layoutGroups(groups, { width: 1040, density: 'cozy' }); // warm up
  const t0 = process.hrtime.bigint();
  const out = layoutGroups(groups, { width: 1040, density: 'cozy' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`# 1,000 cards laid out in ${ms.toFixed(2)} ms`);
  assert.equal(out.cards.length, 1000);
  assert.ok(ms < 10, `took ${ms.toFixed(2)} ms`);
});
