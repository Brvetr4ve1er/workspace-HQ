// node --test dashboard-v5/src/vals/palette-theme.test.mjs
// The Ctrl K verb "theme dark|light|os" is a base-theme entry point like the Appearance chips and toggleTheme(): it must leave the Console skin,
// or the owner types "theme light" and nothing visible happens. Placeholder fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

function comp(state) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore({ scans: [scan('2026-10-02', [proj('a')])] }, null);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  c.setState = function (p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; };
  Object.assign(c.state, state);
  return c;
}
const themeItem = (c, word) => {
  Object.assign(c.state, { paletteOpen: true, paletteMode: 'go', paletteQuery: 'theme ' + word });
  const doGroup = c.paletteItems().groups.find((g) => g.name === 'Do');
  return doGroup.items.find((i) => i.label === 'Theme · ' + word);
};

test('palette "theme light|dark|os" leaves the Console skin and sets the base theme', () => {
  for (const [word, pref] of [['light', 'light'], ['dark', 'dark'], ['os', 'os']]) {
    const c = comp({ themePref: 'dark', consoleLayer: { on: true, skin: true, scan: true } });
    const it = themeItem(c, word);
    assert.ok(it, 'the Theme · ' + word + ' item exists');
    it.run();
    assert.equal(c.state.themePref, pref);
    assert.equal(c.state.consoleLayer.skin, false, 'the skin is cleared: ' + word);
    assert.equal(c.state.consoleLayer.on, true, 'the layer itself stays on');
    assert.equal(c.state.consoleLayer.scan, true);
  }
});

test('palette "theme light" with no skin leaves the layer pref object untouched', () => {
  const c = comp({ themePref: 'dark', consoleLayer: { on: true, skin: false } });
  const before = c.state.consoleLayer;
  themeItem(c, 'light').run();
  assert.equal(c.state.themePref, 'light');
  assert.equal(c.state.consoleLayer, before);
});

// batch 8: the Workbench look is left the same way, and the owner's red accent choice is kept
test('palette "theme light|dark|os" leaves the Workbench look and sets the base theme; the layer and the red accent stay', () => {
  for (const [word, pref] of [['light', 'light'], ['dark', 'dark'], ['os', 'os']]) {
    const c = comp({ themePref: 'dark', consoleLayer: { on: true, skin: false, look: 'workbench', palette: 'signal' } });
    const it = themeItem(c, word);
    assert.ok(it, 'the Theme · ' + word + ' item exists');
    it.run();
    assert.equal(c.state.themePref, pref);
    assert.equal(c.state.consoleLayer.look, '', 'the look is cleared: ' + word);
    assert.equal(c.state.consoleLayer.on, true, 'the layer itself stays on');
    assert.equal(c.state.consoleLayer.palette, 'signal', 'the accent choice is kept');
  }
});

test('toggleTheme (the shell button and "Toggle light / dark") leaves the Workbench look too', () => {
  const c = comp({ themePref: 'dark', consoleLayer: { on: true, look: 'workbench' } });
  c.toggleTheme();
  assert.equal(c.state.themePref, 'light');
  assert.equal(c.state.consoleLayer.look, '');
  assert.equal(c.state.consoleLayer.on, true);
});
