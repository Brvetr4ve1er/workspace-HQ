// node --test dashboard-v5/src/logic/home-more.test.mjs
// The "More on Home" flag: one per-viewer boolean, storage injected, every access guarded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, write, label, browserStorage, KEY } from './home-more.mjs';

const memory = (seed) => {
  const m = new Map(Object.entries(seed || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
};
const throwing = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } });

test('the key is hq.homeMore', () => {
  assert.equal(KEY, 'hq.homeMore');
});

test('default closed: an empty storage reads false', () => {
  assert.equal(read(memory()), false);
});

test('round trip: open is remembered, closed is remembered, and only the one key is touched', () => {
  const s = memory({ other: 'keep' });
  assert.equal(write(s, true), true);
  assert.equal(s.getItem('hq.homeMore'), '1');
  assert.equal(read(s), true);
  assert.equal(write(s, false), true);
  assert.equal(read(s), false);
  assert.deepEqual([...s._m.keys()].sort(), ['hq.homeMore', 'other']);
  assert.equal(s.getItem('other'), 'keep');
});

test('a throwing storage reads closed, writes report false, nothing escapes', () => {
  const s = throwing();
  assert.equal(read(s), false);
  assert.equal(write(s, true), false);
  assert.equal(write(s, false), false);
});

test('absent storage (null, a number, an object with no methods) reads closed and cannot be written', () => {
  for (const s of [null, 0, 'x', {}, { getItem: 'no' }]) {
    assert.equal(read(s), false);
    assert.equal(write(s, true), false);
  }
});

test('a garbage value reads closed: only the exact "1" opens it', () => {
  for (const v of ['', '0', 'true', 'TRUE', 'yes', '2', '11', ' 1', '1 ', 'null', 'undefined', '{"open":true}', 'open']) {
    assert.equal(read(memory({ 'hq.homeMore': v })), false, JSON.stringify(v));
  }
  assert.equal(read(memory({ 'hq.homeMore': '1' })), true);
});

test('only the boolean true writes open; anything else writes closed', () => {
  const s = memory();
  for (const v of [false, 0, '', null, undefined, 'true', 1, {}]) { write(s, v); assert.equal(read(s), false, String(v)); }
  write(s, true);
  assert.equal(read(s), true);
});

test('the label names the action: open reads Less, closed reads More', () => {
  assert.equal(label(false), 'More on Home');
  assert.equal(label(true), 'Less on Home');
  assert.equal(label(undefined), 'More on Home');
  assert.equal(label('1'), 'More on Home');
});

test('with no storage argument the page storage is used, and its absence (plain Node, or a getter that throws) is survived', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    delete globalThis.localStorage;
    assert.equal(browserStorage(), null);
    assert.equal(read(), false);
    assert.equal(write(undefined, true), false);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    assert.equal(browserStorage(), null);
    assert.equal(read(), false);
    assert.equal(write(undefined, true), false);
    const s = memory();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: s });
    assert.equal(write(undefined, true), true);
    assert.equal(read(), true);
    assert.equal(read(null), false, 'null still means no storage, not the page default');
  } finally {
    delete globalThis.localStorage;
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
  }
});
