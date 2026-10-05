// Shared UI prefs helpers (src/logic/shared.js): the one-time seed between v5's
// own prefs, v3's leftovers and main's shared prefs, the v3 theme mirror and the
// data-hq-reduce flag.   node --test dashboard-v5/src/logic/shared.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { planUiSeed, readV3Prefs, mirrorV3Theme, fromV3Theme, setReduceFlag, placeSnapId, restoreSnapOffset } from './shared.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear() };
}
// Node 25 ships localStorage as an accessor global: define, don't assign
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
beforeEach(() => { define('localStorage', memStorage()); define('document', { documentElement: { dataset: {} } }); });

const DEF = { theme: 'dark', reduceMotion: false };
const NO_V3 = { theme: null, sound: null, ambientPref: null };

test('main on its defaults + v5 saved prefs → v5’s choice is pushed to main', () => {
  const r = planUiSeed({ themePref: 'light', reduceMotion: true, sound: false }, DEF, { theme: 'dark', sound: true, ambientPref: false });
  assert.deepEqual(r.push, { theme: 'light', reduceMotion: true });
  // v5 saved sound, so v3's isn't used; v5 never saved ambientPref, so v3's fills it in
  assert.deepEqual(r.state, { themePref: 'light', reduceMotion: true, ambientPref: false });
});

test('main on its defaults + v5 saved the same defaults → nothing to push', () => {
  const r = planUiSeed({ themePref: 'dark', reduceMotion: false, sound: true, ambientPref: true }, DEF, { theme: 'light', sound: false, ambientPref: false });
  assert.equal(r.push, null);
  assert.deepEqual(r.state, { themePref: 'dark', reduceMotion: false });
});

test('main on its defaults + nothing saved in v5 → v3’s theme, sound and status rail', () => {
  const r = planUiSeed({}, DEF, { theme: 'light', sound: true, ambientPref: false });
  assert.deepEqual(r.push, { theme: 'light' });
  assert.deepEqual(r.state, { themePref: 'light', reduceMotion: false, sound: true, ambientPref: false });
});

test('nothing anywhere → no push, nothing changes', () => {
  const r = planUiSeed({}, DEF, NO_V3);
  assert.equal(r.push, null);
  assert.deepEqual(r.state, { reduceMotion: false });
});

test('main already holds a choice → it is adopted, v5’s own is not pushed', () => {
  const r = planUiSeed({ themePref: 'dark', reduceMotion: false }, { theme: 'os', reduceMotion: true }, { theme: 'light', sound: null, ambientPref: null });
  assert.equal(r.push, null);
  assert.deepEqual(r.state, { themePref: 'os', reduceMotion: true });
});

test('an invalid saved theme falls back to v3’s', () => {
  const r = planUiSeed({ themePref: 'neon' }, DEF, { theme: 'light', sound: null, ambientPref: null });
  assert.deepEqual(r.push, { theme: 'light' });
});

test('readV3Prefs maps v3’s keys; absent keys stay null', () => {
  assert.deepEqual(readV3Prefs(), NO_V3);
  localStorage.setItem('hq-theme', 'daylight'); localStorage.setItem('hq-sfx', '0'); localStorage.setItem('hq-ambient', 'closed');
  assert.deepEqual(readV3Prefs(), { theme: 'light', sound: false, ambientPref: false });
  localStorage.setItem('hq-theme', 'arcade'); localStorage.setItem('hq-sfx', '1'); localStorage.setItem('hq-ambient', 'open');
  assert.deepEqual(readV3Prefs(), { theme: 'dark', sound: true, ambientPref: true });
  assert.equal(fromV3Theme('nexus'), 'dark');
});

test('readV3Prefs survives a storage that throws', () => {
  define('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.deepEqual(readV3Prefs(), NO_V3);
  assert.doesNotThrow(() => mirrorV3Theme('light'));
});

test('mirrorV3Theme: light → daylight, dark → nexus, a v3 dark theme survives, os leaves it', () => {
  mirrorV3Theme('light');
  assert.equal(localStorage.getItem('hq-theme'), 'daylight');
  assert.equal(localStorage.getItem('hq-theme-migrated'), '1');   // or v3's first-boot migration resets it
  mirrorV3Theme('dark');
  assert.equal(localStorage.getItem('hq-theme'), 'nexus');
  localStorage.setItem('hq-theme', 'arcade');
  mirrorV3Theme('dark');
  assert.equal(localStorage.getItem('hq-theme'), 'arcade');
  mirrorV3Theme('os');
  assert.equal(localStorage.getItem('hq-theme'), 'arcade');
  localStorage.removeItem('hq-theme');
  mirrorV3Theme('dark');
  assert.equal(localStorage.getItem('hq-theme'), 'nexus');
});

test('setReduceFlag sets and removes data-hq-reduce', () => {
  setReduceFlag(true);
  assert.equal(document.documentElement.dataset.hqReduce, '1');
  setReduceFlag(false);
  assert.equal('hqReduce' in document.documentElement.dataset, false);
});

// ---- restore place by scan id (R2 regression: live must stay live) ----------------------------
// ids newest first, like store.model.at(offset)
const model = (...ids) => ({ maxOff: ids.length - 1, at: (o) => ({ id: ids[o] }) });

test('placeSnapId: live (offset 0) is stored without an id, a past scan with its id', () => {
  const M = model('s3', 's2', 's1');
  assert.equal(placeSnapId(M, 0), null);
  assert.equal(placeSnapId(M, 2), 's1');
});

test('live stays live after a scan lands (the window reloads when a scan finishes)', () => {
  const before = model('s2', 's1');
  const saved = { snapOffset: 0, snapId: placeSnapId(before, 0) };
  assert.equal(restoreSnapOffset(saved, model('s3', 's2', 's1')), 0);
  // an entry written by the pre-fix build carried the latest id at offset 0: still live
  assert.equal(restoreSnapOffset({ snapOffset: 0, snapId: 's2' }, model('s3', 's2', 's1')), 0);
});

test('a past scan is found by id after a scan lands; gone → live; no id → clamped offset', () => {
  const after = model('s3', 's2', 's1');
  assert.equal(restoreSnapOffset({ snapOffset: 1, snapId: 's1' }, after), 2);
  assert.equal(restoreSnapOffset({ snapOffset: 1, snapId: 'gone' }, after), 0);
  assert.equal(restoreSnapOffset({ snapOffset: 9 }, after), 2);
  assert.equal(restoreSnapOffset({}, after), 0);
  assert.equal(restoreSnapOffset(null, after), 0);
});
