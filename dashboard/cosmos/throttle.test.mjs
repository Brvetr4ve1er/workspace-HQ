// Cosmos space — the progress throttle (dashboard/cosmos/throttle.mjs). A fake clock, no timers.
//   node --test dashboard/cosmos/throttle.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeThrottle } from './throttle.mjs';

function rig(opts = {}) {
  const clock = { t: 10_000 };
  const out = [];
  const th = makeThrottle({ now: () => clock.t, emit: (p) => out.push({ at: clock.t, p }), sleep: async (ms) => { clock.t += ms; }, ...opts });
  return { clock, out, th };
}

/** the most events in ANY closed 1000 ms window */
function maxInWindow(out) {
  let max = 0;
  for (const a of out) max = Math.max(max, out.filter((b) => b.at >= a.at && b.at <= a.at + 1000).length);
  return max;
}

describe('makeThrottle', () => {
  it('100 pushes in one second deliver at most 4, and the last value wins', async () => {
    const { clock, out, th } = rig();
    for (let i = 1; i <= 100; i += 1) {
      th.push({ phase: 'thumbs', done: i, total: 100 });
      clock.t += 10;
    }
    assert.ok(out.length <= 4, `delivered ${out.length}`);
    assert.equal(out[0].p.done, 1);                     // a quiet start delivers at once
    await th.drain();
    assert.equal(out.at(-1).p.done, 100);               // the last value was never lost
    assert.ok(maxInWindow(out) <= 4);
    // coalescing: far fewer than 100 deliveries
    assert.ok(out.length <= 6);
  });

  it('never delivers closer than minGapMs', async () => {
    const { clock, out, th } = rig();
    for (let i = 0; i < 40; i += 1) { th.push({ done: i }); clock.t += 7; }
    await th.drain();
    for (let i = 1; i < out.length; i += 1) assert.ok(out[i].at - out[i - 1].at >= 250, `gap ${out[i].at - out[i - 1].at}`);
  });

  it('done_all is never dropped, never early, and the 4-per-second rule holds with it', async () => {
    const { clock, out, th } = rig();
    for (let i = 1; i <= 10; i += 1) { th.push({ phase: 'dupes', done: i, total: 10 }); clock.t += 30; }
    th.push({ phase: 'dupes', done: 10, total: 10, done_all: true });
    const before = out.length;
    assert.ok(before <= 4);
    const lastAt = out.at(-1).at;
    await th.drain();
    const fin = out.at(-1);
    assert.equal(fin.p.done_all, true);
    assert.ok(fin.at >= lastAt + 250, 'trailing edge: not before the next free slot');
    assert.ok(maxInWindow(out) <= 4, `window max ${maxInWindow(out)}`);
    assert.equal(th.pending(), 0);
  });

  it('a done_all pending behind a full window is delivered at the slot, not before', () => {
    const { clock, out, th } = rig();
    th.push({ n: 1 });               // t0
    clock.t += 250; th.push({ n: 2 });
    clock.t += 250; th.push({ n: 3 });
    clock.t += 250; th.push({ n: 4 });
    assert.equal(out.length, 4);
    clock.t += 250;                  // 1000 ms after the first: the window still holds 4
    th.push({ n: 5, done_all: true });
    assert.equal(out.length, 4);
    assert.equal(th.flush(), 1);
    clock.t += 1;                    // strictly more than 1000 ms after the first
    assert.equal(th.flush(), 0);
    assert.equal(out.length, 5);
    assert.equal(out[4].p.done_all, true);
    assert.ok(maxInWindow(out) <= 4);
  });

  it('a done_all is not overwritten by a later push; a later push queues behind it', async () => {
    const { clock, out, th } = rig();
    th.push({ n: 1 });
    clock.t += 10;
    th.push({ n: 2, done_all: true });
    th.push({ n: 3 });
    th.push({ n: 4 });
    await th.drain();
    assert.deepEqual(out.map((o) => o.p.n), [1, 2, 4]);
  });

  it('flush() delivers pending state once its slot is free and reports what is left', () => {
    const { clock, out, th } = rig();
    th.push({ n: 1 });
    th.push({ n: 2 });
    assert.equal(out.length, 1);
    assert.equal(th.flush(), 1);
    clock.t += 250;
    assert.equal(th.flush(), 0);
    assert.deepEqual(out.map((o) => o.p.n), [1, 2]);
    assert.equal(th.flush(), 0);
  });

  it('a long quiet gap delivers immediately', () => {
    const { clock, out, th } = rig();
    th.push({ n: 1 });
    th.push({ n: 2 });
    clock.t += 60_000;
    th.push({ n: 3 });
    assert.deepEqual(out.map((o) => o.p.n), [1, 3]);        // 2 was coalesced into 3
    assert.equal(out[1].at, clock.t);
  });

  it('two consecutive runs do not leak state', async () => {
    const { clock, out, th } = rig();
    for (let i = 1; i <= 5; i += 1) { th.push({ run: 1, done: i }); clock.t += 20; }
    th.push({ run: 1, done: 5, done_all: true });
    await th.drain();
    const firstRun = out.length;
    assert.equal(out.at(-1).p.done_all, true);
    clock.t += 5000;
    for (let i = 1; i <= 5; i += 1) { th.push({ run: 2, done: i }); clock.t += 20; }
    th.push({ run: 2, done: 5, done_all: true });
    await th.drain();
    const second = out.slice(firstRun);
    assert.ok(second.length >= 2);
    assert.ok(second.every((o) => o.p.run === 2));
    assert.equal(second[0].p.done, 1);                      // delivered at once: no carried-over window
    assert.equal(second.at(-1).p.done_all, true);
    assert.ok(maxInWindow(out) <= 4);
  });

  it('survives a clock that jumps backwards', () => {
    const { clock, out, th } = rig();
    th.push({ n: 1 });
    clock.t -= 5000;
    th.push({ n: 2 });
    assert.deepEqual(out.map((o) => o.p.n), [1, 2]);
  });

  it('drain needs a sleep, and reset() clears everything', async () => {
    const { out, th } = rig({ sleep: undefined });
    th.push({ n: 1 });
    th.push({ n: 2 });
    await assert.rejects(() => th.drain(), TypeError);
    th.reset();
    assert.equal(th.pending(), 0);
    assert.equal(out.length, 1);
  });

  it('rejects missing now/emit', () => {
    assert.throws(() => makeThrottle({ emit() {} }), TypeError);
    assert.throws(() => makeThrottle({ now: () => 0 }), TypeError);
  });
});
