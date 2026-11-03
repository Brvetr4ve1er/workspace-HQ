// The "Status · live" rail's Screen time card: gate and minutes must agree — both come
// from the LATEST scan (H.SITES pins to at(0)), not the time-machine-viewed snapshot.
//   node --test dashboard-v5/src/vals/shell.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- browser globals renderVals / initState touch (same shim as vals.golden.test.mjs) ----
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {} });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const { Component } = await import('../app.js');
const { createStore } = await import('../live/store.js');
const { proj, scan } = await import('../live/__fixtures__/synthetic.mjs');

const BROWSER = { by_domain: [{ domain: 'docs.example.org', focus_ms: 90 * 60000 }] };
function railCard(scans, snapOffset) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore({ scans }, null);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  Object.assign(c.state, { snapOffset });
  return c.renderVals().amb.find((a) => a.label === 'Screen time');
}

test('viewing an old scan with no browser block still shows the latest minutes', () => {
  // the older scan predates the extension (no browser block); the latest has 90 min
  const scans = [scan('2026-10-01', [proj('a')]), scan('2026-10-02', [proj('a')], { browser: BROWSER })];
  const card = railCard(scans, 1);
  assert.equal(card.title, '1h 30m', 'the live rail shows the latest scan, not "No data yet"');
  assert.match(card.sub, /browser focus/);
});

test('no browser block on the latest scan means "No data yet", whatever is viewed', () => {
  // reversed: the OLD scan has browser data, the latest does not — the live card must not claim it
  const scans = [scan('2026-10-01', [proj('a')], { browser: BROWSER }), scan('2026-10-02', [proj('a')])];
  const card = railCard(scans, 1);
  assert.equal(card.title, 'No data yet');
  assert.match(card.sub, /connect the browser extension/);
});
