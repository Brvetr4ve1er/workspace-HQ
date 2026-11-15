// node --test dashboard-v5/src/logic/debug-ring.test.mjs
// The timing ring behind the debug overlay: p50 / p95 over a ring of 30, wraparound, an empty ring says null, negative or NaN samples are
// dropped, the per-minute count follows the caller's clock, and the words (fmtMs, fmtAge) never print a fake number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRing, percentile, fmtMs, fmtAge, RING_SIZE, RATE_CAP } from './debug-ring.mjs';

test('an empty ring says null, never zero', () => {
  const r = createRing();
  assert.deepEqual(r.stats(1000), { count: 0, last: null, p50: null, p95: null, perMin: 0 });
  assert.equal(r.size, RING_SIZE);
  assert.equal(RING_SIZE, 30);
});

test('nearest-rank percentiles over exactly the samples held', () => {
  const r = createRing();
  for (let i = 1; i <= 30; i++) assert.equal(r.push(i, 1000), true);
  const s = r.stats(1000);
  assert.equal(s.count, 30);
  assert.equal(s.last, 30);
  assert.equal(s.p50, 15);   // ceil(.5 * 30) = rank 15
  assert.equal(s.p95, 29);   // ceil(.95 * 30) = rank 29
  assert.equal(percentile([5], 50), 5);
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
});

test('order does not matter: the same samples pushed in another order give the same answer', () => {
  const a = createRing(), b = createRing();
  const xs = [9, 1, 5, 3, 7, 2, 8, 4, 6, 10];
  for (const x of xs) a.push(x, 1);
  for (const x of xs.slice().reverse()) b.push(x, 1);
  const sa = a.stats(1), sb = b.stats(1);
  assert.equal(sa.p50, sb.p50);
  assert.equal(sa.p95, sb.p95);
  assert.equal(sa.p50, 5);
  assert.equal(sa.p95, 10);
});

test('wraparound: 40 pushes keep the last 30, the oldest ten fall off', () => {
  const r = createRing();
  for (let i = 1; i <= 40; i++) r.push(i, 1000);
  const s = r.stats(1000);
  assert.equal(s.count, 30);
  assert.equal(s.last, 40);
  assert.equal(s.p50, 25);   // samples 11..40, rank 15 of 30
  assert.equal(s.p95, 39);
});

test('negative, NaN, infinite and non-number samples are dropped and change nothing', () => {
  const r = createRing();
  r.push(4, 10);
  for (const bad of [-1, NaN, Infinity, -Infinity, undefined, null, '5', {}, []]) assert.equal(r.push(bad, 20), false, String(bad));
  const s = r.stats(30);
  assert.equal(s.count, 1);
  assert.equal(s.last, 4);
  assert.equal(s.perMin, 1);
  assert.equal(r.push(0, 30), true, 'zero is a real (very fast) render');
});

test('per minute counts what the caller clock says happened in the last 60 s, and is bounded', () => {
  const r = createRing();
  r.push(1, 0); r.push(1, 30000); r.push(1, 61000);
  assert.equal(r.stats(61000).perMin, 2, 'the render at t=0 is older than a minute');
  assert.equal(r.stats(100000).perMin, 1);
  assert.equal(r.stats(200000).perMin, 0);
  const big = createRing();
  for (let i = 0; i < RATE_CAP + 200; i++) big.push(1, 5000);
  assert.ok(big.stats(5000).perMin <= RATE_CAP);
  assert.equal(big.stats(5000).count, 30);
});

test('a push without a time still counts as a sample, not as a render in the minute', () => {
  const r = createRing();
  r.push(2);
  assert.equal(r.stats(1000).count, 1);
  assert.equal(r.stats(1000).perMin, 0);
});

test('clear empties everything; a bad size falls back to 30', () => {
  const r = createRing(3);
  for (const x of [1, 2, 3, 4]) r.push(x, 1);
  assert.equal(r.stats(1).count, 3);
  r.clear();
  assert.deepEqual(r.stats(1), { count: 0, last: null, p50: null, p95: null, perMin: 0 });
  for (const bad of [0, -2, 1.5, NaN, 'x']) assert.equal(createRing(bad).size, 30);
});

test('the words: a dash for none, one decimal under ten, whole above; ages in seconds then minutes', () => {
  assert.equal(fmtMs(null), '–');
  assert.equal(fmtMs(NaN), '–');
  assert.equal(fmtMs(-1), '–');
  assert.equal(fmtMs(0), '0.0 ms');
  assert.equal(fmtMs(3.456), '3.5 ms');
  assert.equal(fmtMs(12.6), '13 ms');
  assert.equal(fmtAge(null, 5), 'none yet');
  assert.equal(fmtAge(100, 50), 'none yet');
  assert.equal(fmtAge(1000, 4000), '3 s ago');
  assert.equal(fmtAge(0, 600000), '10 min ago');
});

test('the module is pure: no timer, no listener, no frame, no DOM word in its code', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('./debug-ring.mjs', import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /setTimeout|setInterval|requestAnimationFrame|addEventListener|document\.|window\.|performance\./);
});
