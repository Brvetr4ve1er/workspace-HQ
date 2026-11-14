// node --test dashboard-v5/src/live/visibility-gate.test.mjs
// A fake document with a visibilityState and a listener set; nothing here touches a real DOM or a timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisibilityGate } from './visibility-gate.mjs';

function fakeDoc(state = 'visible') {
  const ls = new Set();
  const doc = {
    visibilityState: state,
    addEventListener: (t, f) => { if (t === 'visibilitychange') ls.add(f); },
    removeEventListener: (t, f) => { if (t === 'visibilitychange') ls.delete(f); },
    set(next) { doc.visibilityState = next; [...ls].forEach((f) => f()); },
    listeners: () => ls.size,
  };
  return doc;
}
// a store-shaped rig: the machine handler stores the sample, then ticks the gate
function rig(state) {
  const doc = fakeDoc(state), live = { machine: null }, emits = [];
  const gate = createVisibilityGate({ emit: () => emits.push(live.machine && live.machine.n), doc });
  const onMachine = (m) => { live.machine = m || null; gate.tick(); };
  return { doc, live, emits, gate, onMachine };
}

test('visible: one emit per sample, as before', () => {
  const r = rig('visible');
  r.onMachine({ n: 1 }); r.onMachine({ n: 2 }); r.onMachine({ n: 3 });
  assert.deepEqual(r.emits, [1, 2, 3]);
  assert.equal(r.gate.pending(), false);
});

test('hidden: samples are stored, nothing emits', () => {
  const r = rig('hidden');
  for (let n = 1; n <= 5; n++) r.onMachine({ n });
  assert.equal(r.emits.length, 0);
  assert.equal(r.live.machine.n, 5, 'the latest sample is stored');
  assert.equal(r.gate.pending(), true);
});

test('two samples while hidden, then show: exactly one emit carrying the latest', () => {
  const r = rig('hidden');
  r.onMachine({ n: 1 }); r.onMachine({ n: 2 });
  r.doc.set('visible');
  assert.deepEqual(r.emits, [2]);
  assert.equal(r.gate.pending(), false);
  r.doc.set('hidden'); r.doc.set('visible');
  assert.deepEqual(r.emits, [2], 'nothing owed, no second emit');
});

test('hidden with no sample at all: showing emits nothing', () => {
  const r = rig('hidden');
  r.doc.set('visible');
  assert.equal(r.emits.length, 0);
});

test('shown without the event yet, then a sample: a normal emit that clears what was owed', () => {
  const r = rig('hidden');
  r.onMachine({ n: 1 });
  r.doc.visibilityState = 'visible';
  r.onMachine({ n: 2 });
  assert.deepEqual(r.emits, [2]);
  assert.equal(r.gate.pending(), false);
  r.doc.set('visible');
  assert.deepEqual(r.emits, [2], 'the late event finds nothing owed');
});

test('still not visible after a change event (e.g. prerender): no emit, the debt stays', () => {
  const r = rig('hidden');
  r.onMachine({ n: 1 });
  r.doc.set('prerender');
  assert.equal(r.emits.length, 0);
  assert.equal(r.gate.pending(), true);
});

test('one listener only, removed on dispose; nothing emits afterwards', () => {
  const r = rig('hidden');
  assert.equal(r.doc.listeners(), 1);
  r.onMachine({ n: 1 });
  r.gate.dispose();
  assert.equal(r.doc.listeners(), 0);
  r.doc.set('visible');
  r.onMachine({ n: 2 });
  assert.equal(r.emits.length, 0);
  assert.doesNotThrow(() => r.gate.dispose(), 'dispose twice is harmless');
});

test('a missing document counts as visible (test rigs); so does one without a visibilityState', () => {
  const e1 = [], g1 = createVisibilityGate({ emit: () => e1.push(1), doc: null });
  g1.tick(); g1.tick();
  assert.equal(e1.length, 2);
  assert.doesNotThrow(() => g1.dispose());
  const e2 = [], g2 = createVisibilityGate({ emit: () => e2.push(1), doc: {} });
  g2.tick();
  assert.equal(e2.length, 1);
  assert.equal(g2.visible(), true);
});

test('with no doc key the global document is used, and plain Node has none: visible', () => {
  const e = [];
  const g = createVisibilityGate({ emit: () => e.push(1) });
  g.tick();
  assert.equal(e.length, 1);
  g.dispose();
});

test('an emit that throws never breaks the tick or the listener', () => {
  const doc = fakeDoc('hidden');
  const orig = console.error; console.error = () => {};
  try {
    const g = createVisibilityGate({ emit: () => { throw new Error('boom'); }, doc });
    assert.doesNotThrow(() => g.tick());
    assert.doesNotThrow(() => doc.set('visible'));
  } finally { console.error = orig; }
});

test('the gate holds a flag, never a sample list: 1000 hidden samples leave only the latest in the store', () => {
  const r = rig('hidden');
  for (let n = 0; n < 1000; n++) r.onMachine({ n });
  assert.equal(Object.keys(r.gate).sort().join(','), 'dispose,pending,tick,visible');
  assert.equal(r.live.machine.n, 999);
});
