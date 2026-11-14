// Home as one decision, on the real Component: ONE ordering feeds the Home card, its two alternatives, the Status rail's "Do now" and the Tasks list;
// the grey source span says which rule picked the card; the XP Done path is untouched; the More on Home flag nests under the existing `home` object.
//   node --test dashboard-v5/src/vals/home.test.mjs
// Invented project and task names only (the repo is public).
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

const RANKER_WORDS = 'picked by fixed rules · not AI';
const Q = (id, tier, project, xp = 10) => ({ id, tier, title: 'Task ' + id, insight: 'Placeholder reason.', project_id: project, status: 'open', age_days: 3, xp });
// ranker order (tier, then xp): q1 (red, Project A), q2 (orange, Project B), q3 (orange, Project B), q4 (yellow, Project C)
const QUESTS = [Q('q1', 'red', 'a', 50), Q('q2', 'orange', 'b', 40), Q('q3', 'orange', 'b', 30), Q('q4', 'yellow', 'c', 10)];
const SCANS = () => [scan('2026-11-13', [proj('a'), proj('b'), proj('c')], { quests: QUESTS })];
const row = (key, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity: 'high', text: 'Placeholder row', why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 }, extra || {});
const briefOf = (items) => ({ brief: { v: 1, generatedAt: '2026-11-14T09:00:00.000Z', items, more: 0, overflow: [], standing: [], errors: [], quiet: null }, error: '', loaded: true });

function mount({ items = [], state = {}, scans = SCANS() } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore({ scans }, null);
  store.live.brief = briefOf(items);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  Object.assign(c.state, state);
  c.setState = function (p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); };
  const done = [];
  c.completeTask = (id) => { done.push(id); };
  return { c, done, vals: () => c.renderVals() };
}
const goProject = (pid) => row('secrets:' + pid + ':1', { kind: 'go', tab: 'projects', projectId: pid });

test('Brief empty: the card is the ranker top and says so; the alternatives are the next two in ranker order', () => {
  const { vals } = mount();
  const h = vals().home;
  assert.equal(h.next.title, 'Task q1');
  assert.equal(h.next.source, RANKER_WORDS);
  assert.deepEqual(h.alts.map((a) => a.title), ['Task q2', 'Task q3']);
  assert.equal(h.hasAlts, true);
  assert.equal(h.isRest, false);
});

test('the lead Brief row names Project B: the card is that project top task, says it follows the Brief, and the alternatives come from the same ordering', () => {
  const { vals } = mount({ items: [goProject('b'), row('scan-stale:x', { kind: 'scan' }, { severity: 'med' })] });
  const h = vals().home;
  assert.equal(h.next.title, 'Task q2');
  assert.equal(h.next.source, 'Follows the top Brief row');
  assert.deepEqual(h.alts.map((a) => a.title), ['Task q1', 'Task q3'], 'the rest keep the ranker order, the card task is not repeated');
});

test('a later row naming a project does not move the card (only the lead row is followed)', () => {
  const { vals } = mount({ items: [row('scan-stale:x', { kind: 'scan' }, { severity: 'med' }), goProject('b')] });
  assert.equal(vals().home.next.title, 'Task q1');
  assert.equal(vals().home.next.source, RANKER_WORDS);
});

test('a project with no open task, and a group row, fall back to the ranker', () => {
  assert.equal(mount({ items: [goProject('zzz')] }).vals().home.next.title, 'Task q1');
  const group = row('dirty:b:12', { kind: 'go', tab: 'projects', projectId: 'b' }, { count: 2, group: { n: 3, sinceAt: '2026-11-13T09:00:00.000Z', listAction: { kind: 'go', tab: 'projects', sub: 'grid' } } });
  const h = mount({ items: [group] }).vals().home;
  assert.equal(h.next.title, 'Task q1');
  assert.equal(h.next.source, RANKER_WORDS);
});

test('the Status rail Do now, the prompt hint and the Tasks list read the same ordering as the card', () => {
  const m = mount({ items: [goProject('b')] });
  const v = m.vals();
  const doNow = v.amb.find((a) => a.label === 'Do now');
  assert.equal(doNow.title, 'Task q2');
  assert.match(v.promptHints, /focus task q2/);
  m.c.state.tab = 'tasks'; m.c.state.sub = Object.assign({}, m.c.state.sub, { tasks: 'ranked' });
  assert.deepEqual(m.vals().taskRows.map((r) => r.title), ['Task q2', 'Task q1', 'Task q3', 'Task q4']);
});

test('F (toggleFocus) focuses the task the card shows, not a second ranker', () => {
  const m = mount({ items: [goProject('b')] });
  const started = [];
  m.c.startFocus = (id) => { started.push(id); };
  m.c.toggleFocus();
  assert.deepEqual(started, ['q2']);
});

test('a snapshot (a past day) ignores the Brief: the card is the ranker top as it stood', () => {
  const scans = [scan('2026-11-12', [proj('a'), proj('b'), proj('c')], { quests: QUESTS }), scan('2026-11-13', [proj('a'), proj('b'), proj('c')], { quests: QUESTS })];
  const { vals } = mount({ items: [goProject('b')], state: { snapOffset: 1 }, scans });
  assert.equal(vals().home.next.title, 'Task q1');
});

test('no open task: the All clear card (isRest), no next card, no source words', () => {
  const { vals } = mount({ scans: [scan('2026-11-13', [proj('a')], { quests: [] })] });
  const h = vals().home;
  assert.equal(h.isRest, true);
  assert.equal(h.hasNext, false);
  assert.equal(h.next.source, '');
});

test('Mark done on the card is the unchanged XP path: completeTask is called with the id of the task the card shows', () => {
  const m = mount({ items: [goProject('b')] });
  const h = m.vals().home;
  h.next.done({ type: 'click' });
  assert.deepEqual(m.done, ['q2']);
  h.alts[0].done({ type: 'click' });
  assert.deepEqual(m.done, ['q2', 'q1']);
});

test('the More on Home values nest under home: closed by default, open when the state says so, no new top-level key', () => {
  const closed = mount().vals();
  assert.equal(closed.home.moreOpen, false);
  assert.equal(closed.home.moreExpanded, 'false');
  assert.equal(closed.home.moreLabel, 'More on Home');
  assert.equal(typeof closed.home.toggleMore, 'function');
  const open = mount({ state: { homeMore: true } }).vals();
  assert.equal(open.home.moreOpen, true);
  assert.equal(open.home.moreExpanded, 'true');
  assert.equal(open.home.moreLabel, 'Less on Home');
  for (const k of ['moreLabel', 'moreExpanded', 'toggleMore']) assert.equal(k in open, false, k + ' is not a top-level vals key');
});

test('toggling writes the flag, marks home-more on opening only, and a throwing storage still toggles in memory', () => {
  const m = mount();
  const marks = [];
  m.c.useMark = (id, a) => { marks.push([id, a]); };
  m.c.toggleHomeMore();
  assert.equal(m.c.state.homeMore, true);
  assert.equal(localStorage.getItem('hq.homeMore'), '1');
  assert.deepEqual(marks, [['home-more', undefined]]);
  m.c.toggleHomeMore();
  assert.equal(m.c.state.homeMore, false);
  assert.equal(localStorage.getItem('hq.homeMore'), '0');
  assert.equal(marks.length, 1, 'closing marks nothing');
  const real = globalThis.localStorage;
  define('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
  try {
    assert.doesNotThrow(() => m.c.toggleHomeMore());
    assert.equal(m.c.state.homeMore, true, 'still toggles in memory');
  } finally { define('localStorage', real); }
});

test('the app reads the flag once at mount: a stored 1 opens it, anything else is closed', () => {
  const fresh = () => new Component({ store: createStore({ scans: SCANS() }, null), previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  localStorage.clear(); localStorage.setItem('hq.homeMore', '1');
  assert.equal(fresh().state.homeMore, true);
  localStorage.setItem('hq.homeMore', 'yes');
  assert.equal(fresh().state.homeMore, false);
  localStorage.clear();
  assert.equal(fresh().state.homeMore, false);
});
