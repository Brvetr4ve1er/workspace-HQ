// The Undo-during-coin-animation race: completeTask defers the XP gain behind the
// coin animation (~700ms) while the Undo toast lives longer (WRITE_DELAY 1600ms).
// Undo before the coin lands must not subtract XP that was never granted, and the
// landed coin must not gain XP (or celebrate a level) for an undone task.
//
// Built like logic/actions.test.mjs, plus a window.HQFx whose coinFly resolves only
// when the test says so (the shared.js fallback stub resolves at once and hides the race).
//
//   node --test dashboard-v5/src/logic/tasks.test.mjs
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();

// ---- browser globals the Component touches (same approach as actions.test.mjs) ----
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, activeElement: null });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const tick = () => new Promise((res) => setImmediate(res));

const Q = (id, tier, title, o = {}) => ({ id, tier, title, insight: '', ...(o.proj ? { project_id: o.proj } : {}), age_days: 2, xp: o.xp ?? 10, status: o.status || 'open' });
const DATA = () => ({
  scans: [scan('2026-10-05', [proj('a')], { quests: [Q('q-a', 'red', 'Rotate the key in Project A', { proj: 'a', xp: 40 })] })],
  spellbook: spellbook([]),
  telemetry: telemetry([]),
});

function fakeHq() {
  const calls = [];
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return Promise.resolve(ret); };
  return { calls, actedOn: rec('actedOn', true), markQuestDone: rec('markQuestDone', true) };
}

// window.HQFx with a coinFly the test lands by hand; everything else is inert
function make() {
  localStorage.clear(); sessionStorage.clear();
  const lands = [];
  window.HQFx = { sfx() {}, burst() {}, event() {}, say() {}, set() {}, init() {}, destroy() {}, floatText() {}, asciiBurst() {}, coinFly: () => new Promise((r) => { lands.push(r); }) };
  const hq = fakeHq();
  const store = createStore(DATA(), hq);
  const c = new Component({ store, previewState: 'live', startTab: 'tasks', theme: 'dark', pet: false });
  const toasts = [];
  c.toast = (kind, text, o) => { toasts.push(Object.assign({ kind, text }, o || {})); return 'k' + toasts.length; };
  const gains = [];
  const realGain = c.gainXp.bind(c);
  c.gainXp = (n) => { gains.push(n); return realGain(n); };
  return { c, hq, lands, gains, toasts };
}
const timers = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });

// race (finding): Undo inside the ~700ms coin flight used to subtract 40 XP that was
// never granted (counter visibly wrong, negative near zero), then the landed coin
// gained it anyway and could celebrate a level the user already had
test('Undo while the coin is in flight: nothing subtracted, and the landed coin gains nothing', async (t) => {
  timers(t);
  const { c, hq, lands, gains } = make();
  const xp0 = c.state.xp;
  c.completeTask('q-a');
  c.undoTask('q-a');
  assert.equal(c.state.xp, xp0, 'no XP subtracted: the gain never happened');
  assert.equal(c.state.displayXp, xp0);
  lands[0](); await tick();
  assert.deepEqual(gains, [], 'the coin landed on an undone task: no gain');
  assert.equal(c.state.xp, xp0);
  t.mock.timers.tick(500);
  assert.equal(c.state.levelUp, null, 'no bogus level-up celebration');
  t.mock.timers.tick(2000);   // past WRITE_DELAY: the cancelled write stays cancelled
  assert.ok(!hq.calls.some((x) => x[0] === 'markQuestDone'), 'nothing marked done');
});

test('coin lands, then Undo: the gain is applied and the undo takes exactly it back', async (t) => {
  timers(t);
  const { c, lands, gains } = make();
  const xp0 = c.state.xp;
  c.completeTask('q-a');
  lands[0](); await tick();
  assert.deepEqual(gains, [40]);
  assert.equal(c.state.xp, xp0 + 40);
  c.undoTask('q-a');
  assert.equal(c.state.xp, xp0, 'the granted XP — and only it — is subtracted');
  assert.equal(c.state.displayXp, xp0);
});

test('undo then re-complete inside the window: only the second completion gains', async (t) => {
  timers(t);
  const { c, lands, gains } = make();
  const xp0 = c.state.xp;
  c.completeTask('q-a');
  c.undoTask('q-a');
  c.completeTask('q-a');
  lands[0](); await tick();   // the first (undone) completion's coin
  assert.deepEqual(gains, [], 'the stale coin gains nothing');
  lands[1](); await tick();   // the live completion's coin
  assert.deepEqual(gains, [40]);
  assert.equal(c.state.xp, xp0 + 40);
});

test('a write that already fired still gains when the coin lands late (slow/hidden window)', async (t) => {
  timers(t);
  const { c, hq, lands, gains } = make();
  const xp0 = c.state.xp;
  c.completeTask('q-a');
  t.mock.timers.tick(1700);   // WRITE_DELAY passed: the deferred markQuestDone fired
  await tick();
  assert.ok(hq.calls.some((x) => x[0] === 'markQuestDone' && x[1] === 'q-a'));
  lands[0](); await tick();
  assert.deepEqual(gains, [40], 'a genuinely completed task is not robbed of its XP');
  assert.equal(c.state.xp, xp0 + 40);
});
