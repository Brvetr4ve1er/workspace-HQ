// startSession's in-flight guard: a double-click on Run (both clicks pass the checks
// while the hq:session-start round-trip is pending) must start ONE quota-spending
// session, and the guard must release on failure so a retry works.
//
// Built like logic/actions.test.mjs: a store over synthetic DATA, a Component that is
// never mounted (setState is synchronous then), and a recording fake of window.hq.
//
//   node --test dashboard-v5/src/logic/claude.test.mjs
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';

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

const DATA = () => ({
  scans: [scan('2026-10-05', [proj('a'), proj('b')])],
  spellbook: spellbook([]),
  telemetry: telemetry([]),
});

function fakeHq(over = {}) {
  const calls = [];
  const rec = (name, dflt) => (...args) => { calls.push([name, ...args]); return (over[name] || dflt || (() => true))(...args); };
  const hq = { sessionStart: rec('sessionStart', () => ({ jobId: 'j-new' })) };
  return { hq, calls, called: (n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1)) };
}

function make(over) {
  localStorage.clear(); sessionStorage.clear();
  const f = fakeHq(over);
  const store = createStore(DATA(), f.hq);
  const c = new Component({ store, previewState: 'live', startTab: 'claude', theme: 'dark', pet: false });
  const toasts = [];
  c.toast = (kind, text, o) => { toasts.push(Object.assign({ kind, text }, o || {})); return 'k' + toasts.length; };
  return { c, f, toasts, last: () => toasts[toasts.length - 1] || {} };
}

// race (finding): two Runs during one hq:session-start round-trip used to spawn two
// identical Claude CLI sessions, each spending quota
test('Run double-clicked while the start is in flight: one session, not two; the guard releases', async () => {
  let release;
  const { c, f } = make({ sessionStart: () => new Promise((r) => { release = r; }) });
  c.setState({ composer: 'Fix the build', composerProj: 'a' });
  const first = c.startSession();
  const second = c.startSession();   // double-click: the composer still holds the text
  assert.equal(f.called('sessionStart').length, 1, 'the second click is a no-op');
  release({ jobId: 'j-1' });
  await Promise.all([first, second]);
  assert.equal(c.state.composer, '', 'cleared once, by the answered call');
  assert.equal(c.state.sessionSel, 'j-1');
  assert.equal(c._sessionStarting, false, 'guard released');
  c.setState({ composer: 'Write the docs' });
  const third = c.startSession();
  release({ jobId: 'j-2' });
  await third;
  assert.equal(f.called('sessionStart').length, 2, 'a later Run starts a new session');
});

test('a rejected or refused start releases the guard so the next Run tries again', async () => {
  let n = 0;
  const { c, f, last } = make({ sessionStart: () => { n++; return n === 1 ? Promise.reject(new Error('spawn failed')) : Promise.resolve({ error: 'busy' }); } });
  c.setState({ composer: 'Fix the build', composerProj: 'a' });
  await c.startSession();
  assert.equal(last().kind, 'error');
  assert.equal(c._sessionStarting, false, 'released after a throw');
  assert.equal(c.state.composer, 'Fix the build', 'the draft is kept on failure');
  await c.startSession();   // {error} answer path
  assert.equal(c._sessionStarting, false, 'released after an {error} answer');
  assert.equal(f.called('sessionStart').length, 2);
});

test('the pre-checks still answer before the guard: no project / no text never arms it', async () => {
  const { c, f, last } = make();
  c.setState({ composer: '', composerProj: 'a' });
  await c.startSession();
  assert.equal(last().text, 'Write what Claude should do first');
  c.setState({ composer: 'Task', composerProj: null });
  await c.startSession();
  assert.equal(last().text, 'Pick a project first');
  assert.deepEqual(f.called('sessionStart'), []);
  c.setState({ composerProj: 'a' });
  await c.startSession();
  assert.equal(f.called('sessionStart').length, 1, 'the guard was never left armed');
});
