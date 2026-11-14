// Foldable surfaces on the real Component (batch 7, subtraction): the Settings "Show everything" row, the rail, the More list, the bottom nav, the sub bar and the
// use marks. The shipped measured-zero list is empty, so a fold is set through the viewer pref foldIds (component state), exactly as app.js keeps it.
//   node --test dashboard-v5/src/vals/fold.test.mjs
// Invented project names only (the repo is public).
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
const { MEASURED_ZERO_14D } = await import('../live/foldable.mjs');

function mount({ state = {}, tab = 'home', sub = null } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const marks = [];
  const store = createStore({ scans: [scan('2026-11-13', [proj('a'), proj('b')], { quests: [] })] }, { use: (s, a) => { marks.push([s, a]); return { ok: true }; } });
  const c = new Component({ store, previewState: 'live', startTab: tab, theme: 'dark', pet: false });
  Object.assign(c.state, state);
  if (sub) c.state.sub = Object.assign({}, c.state.sub, { [tab]: sub });
  c.setState = function (p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); };
  return { c, marks, vals: () => c.renderVals() };
}
const rowOf = (v) => v.settings.find((s) => s.label === 'Show everything') || null;

test('nothing is measured yet: the shipped list is empty, Settings has no Show everything row, the rail is whole', () => {
  assert.deepEqual([...MEASURED_ZERO_14D], []);
  const v = mount().vals();
  assert.equal(rowOf(v), null);
  assert.equal(v.nav.length, 11);
  assert.ok(v.nav.some((n) => n.id === 'life'));
});

test('a folded space leaves the rail and the More list; every other space keeps its own digit and title', () => {
  const whole = mount().vals();
  const folded = mount({ state: { foldIds: ['life'] } }).vals();
  assert.ok(!folded.nav.some((n) => n.id === 'life'));
  assert.ok(!folded.moreNav.some((n) => n.id === 'life'));
  assert.equal(folded.nav.length, whole.nav.length - 1);
  for (const n of folded.nav) {
    const same = whole.nav.find((x) => x.id === n.id);
    assert.equal(n.digit, same.digit, n.id + ' keeps its digit');
    assert.equal(n.title, same.title, n.id + ' keeps its title');
  }
  assert.equal(folded.nav.find((n) => n.id === 'money').digit, whole.nav.find((n) => n.id === 'money').digit, 'the space after the folded one did not move up');
});

test('the bottom nav is the original first four with a folded one dropped, then More', () => {
  const whole = mount().vals();
  assert.deepEqual(whole.bottomNav.map((b) => b.icon), ['home', 'projects', 'tasks', 'automations', 'status']);
  const folded = mount({ state: { foldIds: ['life'] } }).vals();
  assert.deepEqual(folded.bottomNav.map((b) => b.icon), ['home', 'projects', 'tasks', 'automations', 'status'], 'Life is not in the first four: the bar is unchanged');
});

test('a folded sub leaves the sub bar; the sub is still reachable and still drawn when it is the current one', () => {
  const whole = mount({ tab: 'projects', sub: 'grid' }).vals();
  assert.ok(whole.subTabs.some((t) => t.label === 'Archived'));
  const folded = mount({ tab: 'projects', sub: 'grid', state: { foldIds: ['projects/archived'] } }).vals();
  assert.ok(!folded.subTabs.some((t) => t.label === 'Archived'));
  assert.equal(folded.subTabs.length, whole.subTabs.length - 1);
  const reached = mount({ tab: 'projects', sub: 'archived', state: { foldIds: ['projects/archived'] } }).vals();
  assert.equal(reached.isArchived, true, 'a deep link still lands on it');
});

test('Settings shows Show everything with the folded names while something is folded; switching it on brings everything back and the row stays', () => {
  const { c, vals } = mount({ state: { foldIds: ['projects/archived', 'life'] } });
  let r = rowOf(vals());
  assert.ok(r, 'the row is there');
  assert.equal(r.state, 'Off');
  assert.match(r.desc, /Projects › Archived/);
  assert.match(r.desc, /Life/);
  assert.match(r.desc, /Hidden by you\./);
  r.toggle();
  assert.equal(c.state.showEverything, true);
  const v = vals();
  assert.ok(v.nav.some((n) => n.id === 'life'), 'Life is back');
  r = rowOf(v);
  assert.ok(r && r.state === 'On', 'the row stays so it can be turned off');
  r.toggle();
  assert.equal(c.state.showEverything, false);
  assert.ok(!vals().nav.some((n) => n.id === 'life'));
});

test('an id the app does not know is ignored: no row, nothing hidden', () => {
  const v = mount({ state: { foldIds: ['nope', 'projects'] } }).vals();
  assert.equal(rowOf(v), null);
  assert.equal(v.nav.length, 11);
});

test('use marks: Archived and Library are marked once while shown, never while folded; a different screen marks none of the three', () => {
  const a = mount({ tab: 'projects', sub: 'archived' });
  a.vals(); a.vals();
  assert.deepEqual(a.marks.filter((m) => m[0] === 'projects-archived'), [['projects-archived', 'open']], 'once per arrival');
  const f = mount({ tab: 'projects', sub: 'archived', state: { foldIds: ['projects/archived'] } });
  f.vals();
  assert.deepEqual(f.marks.filter((m) => m[0] === 'projects-archived'), [], 'folded: no mark');
  const l = mount({ tab: 'automations', sub: 'library' });
  l.vals();
  assert.deepEqual(l.marks.filter((m) => m[0] === 'automations-library'), [['automations-library', 'open']]);
  const lf = mount({ tab: 'automations', sub: 'library', state: { foldIds: ['automations/library'] } });
  lf.vals();
  assert.deepEqual(lf.marks.filter((m) => m[0] === 'automations-library'), []);
  const h = mount({ tab: 'projects', sub: 'grid' });
  h.vals();
  assert.deepEqual(h.marks.filter((m) => /archived|library|hub-panel/.test(m[0])), []);
});

test('the two fold prefs start from the saved prefs and are cleaned', () => {
  localStorage.clear();
  localStorage.setItem('whq3-prefs', JSON.stringify({ foldIds: ['life', 'bogus'], showEverything: true }));
  const store = createStore({ scans: [scan('2026-11-13', [proj('a')], { quests: [] })] }, null);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  assert.deepEqual(c.state.foldIds, ['life']);
  assert.equal(c.state.showEverything, true);
});
