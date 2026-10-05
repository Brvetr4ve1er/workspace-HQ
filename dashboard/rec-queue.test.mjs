// node --test dashboard/rec-queue.test.mjs — the ordered recording chunk queue.
// The defect class it closes: the panel numbered chunks from 1 while main waited
// for 0 (nothing ever written), stop() never drained the parked tail, and paused
// time was billed as recording time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQueue, MAX_AHEAD } = require('./rec-queue.js');

function sink() {
  const out = [];
  return { out, q: createQueue({ write: (buf) => out.push(buf) }) };
}

test('in order from 0: every chunk is written immediately', () => {
  const { out, q } = sink();
  assert.equal(q.push(0, 'a'), 1);
  assert.equal(q.push(1, 'b'), 1);
  assert.equal(q.push(2, 'c'), 1);
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.deepEqual(q.stop(), { written: 3, gaps: [], parked: 0 });
});

test('numbering from 1 writes nothing until stop() drains it (the empty-file bug, surfaced)', () => {
  const { out, q } = sink();
  assert.equal(q.push(1, 'a'), 0);
  assert.equal(q.push(2, 'b'), 0);
  assert.deepEqual(out, [], 'seq 0 never came: nothing is written early');
  assert.deepEqual(q.stop(), { written: 2, gaps: [0], parked: 0 });
  assert.deepEqual(out, ['a', 'b'], 'stop drains instead of dropping');
});

test('out of order: later chunks park, then flush when the hole fills', () => {
  const { out, q } = sink();
  assert.equal(q.push(2, 'c'), 0);
  assert.equal(q.push(1, 'b'), 0);
  assert.deepEqual(out, []);
  assert.equal(q.push(0, 'a'), 3, 'seq 0 releases 1 and 2 in the same call');
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.equal(q.push(4, 'e'), 0);
  assert.equal(q.push(3, 'd'), 2);
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
});

test('duplicate seq is ignored — written or parked', () => {
  const { out, q } = sink();
  q.push(0, 'a');
  assert.equal(q.push(0, 'a-again'), 0, 'already written');
  q.push(2, 'c');
  assert.equal(q.push(2, 'c-again'), 0, 'already parked');
  q.push(1, 'b');
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.deepEqual(q.stop(), { written: 3, gaps: [], parked: 0 });
});

test('invalid seqs are ignored', () => {
  const { out, q } = sink();
  for (const bad of [-1, 0.5, NaN, '0', null, undefined, Infinity]) assert.equal(q.push(bad, 'x'), 0);
  assert.deepEqual(out, []);
  assert.deepEqual(q.stop(), { written: 0, gaps: [], parked: 0 });
});

test('gaps are reported on stop and the tail is written in ascending order across them', () => {
  const { out, q } = sink();
  q.push(0, 'a');
  q.push(5, 'f');
  q.push(2, 'c');
  q.push(3, 'd');
  assert.deepEqual(out, ['a']);
  assert.deepEqual(q.stop(), { written: 4, gaps: [1, 4], parked: 0 });
  assert.deepEqual(out, ['a', 'c', 'd', 'f']);
});

test('stop is idempotent and closes the queue', () => {
  const { out, q } = sink();
  q.push(0, 'a');
  const first = q.stop();
  assert.equal(q.push(1, 'late'), 0, 'nothing after stop');
  assert.deepEqual(q.stop(), first);
  assert.deepEqual(out, ['a']);
});

test('a throwing write propagates; stop retries the parked chunk without duplicating gaps', () => {
  const out = [];
  let fail = true;
  const q = createQueue({ write: (buf) => { if (buf === 'd' && fail) throw new Error('disk full'); out.push(buf); } });
  q.push(0, 'a');
  q.push(3, 'd');
  assert.throws(() => q.stop(), /disk full/);
  fail = false;
  assert.deepEqual(q.stop(), { written: 2, gaps: [1, 2], parked: 0 });
  assert.deepEqual(out, ['a', 'd']);
});

test('a FINAL in-order chunk whose write threw is reported as a gap (review regression)', () => {
  const out = [];
  let fail = false;
  const q = createQueue({ write: (buf) => { if (fail) throw new Error('EBUSY'); out.push(buf); } });
  q.push(0, 'a');
  q.push(1, 'b');
  fail = true;
  assert.throws(() => q.push(2, 'c'), /EBUSY/);
  fail = false;
  // before the fix: { written: 2, gaps: [], parked: 0 } — a lost tail reported as clean
  assert.deepEqual(q.stop(), { written: 2, gaps: [2], parked: 0 });
  assert.deepEqual(out, ['a', 'b']);
});

test('a failed in-order write can be retried by re-pushing the same seq', () => {
  const out = [];
  let fail = true;
  const q = createQueue({ write: (buf) => { if (fail) throw new Error('EBUSY'); out.push(buf); } });
  assert.throws(() => q.push(0, 'a'), /EBUSY/);
  fail = false;
  assert.equal(q.push(0, 'a'), 1);
  assert.deepEqual(q.stop(), { written: 1, gaps: [], parked: 0 });
});

test('a junk seq far ahead is ignored, so stop() stays bounded (review regression)', () => {
  const { out, q } = sink();
  q.push(0, 'a');
  // before the fix this parked, and stop() walked ~2^31 gap entries: a frozen main
  // process for seconds, then RangeError: Invalid array length — on every retry
  assert.equal(q.push(2 ** 31 - 1, 'junk'), 0);
  assert.equal(q.push(1 + MAX_AHEAD + 1, 'junk'), 0, 'one past the window');
  assert.equal(q.push(1 + MAX_AHEAD, 'edge'), 0, 'the window edge still parks');
  const t0 = Date.now();
  const r = q.stop();
  assert.ok(Date.now() - t0 < 2000, 'stop() returns promptly');
  assert.equal(r.written, 2);
  assert.equal(r.gaps.length, MAX_AHEAD);
  assert.deepEqual(out, ['a', 'edge']);
});

test('bad timestamps mean "now", never epoch 0; a non-numeric startedAt reads 0 (review regression)', () => {
  let q = createQueue({ write() {} });
  const t0 = Date.now();
  q.pause(null);                       // before the fix: pausedAt = 0 → elapsed pinned at 0 forever
  q.resume(t0 + 60_000);
  assert.ok(q.elapsed(t0 + 120_000, t0) >= 60_000 - 5_000, 'the pause started ~now, not at 1970');
  q = createQueue({ write() {} });
  q.pause(5000);
  q.resume('oops');                    // before the fix: resume at 0 → the paused span vanished
  const e = q.elapsed(Date.now(), 0);
  assert.ok(e >= 5000 && e <= 6000, `only the 5 s before the pause count — the span closes at ~now (got ${e})`);
  q = createQueue({ write() {} });
  assert.equal(q.elapsed(Date.now(), new Date().toISOString()), 0, 'NaN never leaks into rec-status');
});

test('createQueue requires a write function', () => {
  assert.throws(() => createQueue(), TypeError);
  assert.throws(() => createQueue({}), TypeError);
});

test('pause accounting: paused spans are excluded from elapsed time', () => {
  const { q } = sink();
  const t0 = 10_000;
  assert.equal(q.elapsed(t0 + 1000, t0), 1000);
  q.pause(t0 + 1000);
  assert.equal(q.paused, true);
  assert.equal(q.elapsed(t0 + 2000, t0), 1000, 'the open pause is excluded too');
  q.resume(t0 + 3000);
  assert.equal(q.paused, false);
  assert.equal(q.elapsed(t0 + 5000, t0), 3000);
  // second span
  q.pause(t0 + 6000);
  q.resume(t0 + 6500);
  assert.equal(q.elapsed(t0 + 8000, t0), 5500);
});

test('double pause and double resume are no-ops', () => {
  const { q } = sink();
  q.pause(1000);
  q.pause(1500);                       // must not move the pause start
  q.resume(2000);
  q.resume(2500);                      // must not add another span
  assert.equal(q.elapsed(4000, 0), 3000);
  q.resume(5000);                      // resume while running: nothing
  assert.equal(q.elapsed(6000, 0), 5000);
});

test('elapsed never goes negative', () => {
  const { q } = sink();
  assert.equal(q.elapsed(0, 1000), 0);
  q.pause(0);
  assert.equal(q.elapsed(100, 50), 0);
});
