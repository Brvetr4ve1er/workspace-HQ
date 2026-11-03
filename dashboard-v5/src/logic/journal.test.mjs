// addJournal's double-submit guard: Enter (or Add) re-fired while the save's IPC
// round-trip is pending must write ONE note/decision/learning to the vault, and the
// guard must release on failure so a retry works.
//
// Built like logic/actions.test.mjs: a store over synthetic DATA, a Component that is
// never mounted (setState is synchronous then), and a recording fake of window.hq.
//
//   node --test dashboard-v5/src/logic/journal.test.mjs
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
  scans: [scan('2026-10-05', [proj('a')])],
  spellbook: spellbook([]),
  telemetry: telemetry([]),
});

function fakeHq(over = {}) {
  const calls = [];
  const rec = (name, dflt) => (...args) => { calls.push([name, ...args]); return (over[name] || dflt || (() => Promise.resolve(true)))(...args); };
  const hq = { saveNote: rec('saveNote'), logDecision: rec('logDecision'), learn: rec('learn') };
  return { hq, calls, called: (n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1)) };
}

function make(over, state) {
  localStorage.clear(); sessionStorage.clear();
  const f = fakeHq(over);
  const store = createStore(DATA(), f.hq);
  const c = new Component({ store, previewState: 'live', startTab: 'projects', theme: 'dark', pet: false });
  Object.assign(c.state, { route: { type: 'project', id: 'a' }, journalKind: 'note', journalDraft: '' }, state || {});
  const toasts = [];
  c.toast = (kind, text, o) => { toasts.push(Object.assign({ kind, text }, o || {})); return 'k' + toasts.length; };
  return { c, f, toasts, last: () => toasts[toasts.length - 1] || {} };
}

// race (finding): the draft clears only after main answers, so Enter during the
// round-trip used to pass the txt check and append the same text to the vault again
test('Enter twice while the save is in flight: one write, one optimistic row, one draft clear', async () => {
  let release;
  const { c, f } = make({ saveNote: () => new Promise((r) => { release = r; }) }, { journalDraft: 'A note' });
  const first = c.addJournal();
  const second = c.addJournal();   // Enter re-fired (or Add clicked) while pending
  assert.equal(f.called('saveNote').length, 1, 'the second call is a no-op');
  release(true);
  await Promise.all([first, second]);
  assert.equal(c.state.journalDraft, '', 'cleared once');
  assert.deepEqual(c.state.journalAdds.a.map((j) => [j.k, j.t]), [['note', 'A note']], 'one row, not duplicates');
  assert.equal(c._journalBusy, false, 'guard released');
});

test('a refused (false) or thrown save releases the guard; the next Add tries again', async () => {
  const { c, f, last } = make({ logDecision: () => Promise.resolve(false) }, { journalKind: 'decision', journalDraft: 'Ship it' });
  await c.addJournal();
  assert.equal(last().kind, 'error');
  assert.equal(c.state.journalDraft, 'Ship it', 'the draft is kept');
  assert.equal(c._journalBusy, false, 'released after a refusal');
  await c.addJournal();
  assert.equal(f.called('logDecision').length, 2);

  const boom = make({ learn: () => Promise.reject(new Error('vault locked')) }, { journalKind: 'learning', journalDraft: 'Lesson' });
  await boom.c.addJournal();
  assert.match(boom.last().text, /vault locked/);
  assert.equal(boom.c._journalBusy, false, 'released after a throw');
  await boom.c.addJournal();
  assert.equal(boom.f.called('learn').length, 2);
});

test('the pre-checks still answer before the guard: empty text never arms it', async () => {
  const { c, f, last } = make(undefined, { journalDraft: '   ' });
  await c.addJournal();
  assert.equal(last().text, 'Write something first');
  assert.deepEqual(f.called('saveNote'), []);
  c.state.journalDraft = 'Now a note';
  await c.addJournal();
  assert.equal(f.called('saveNote').length, 1, 'the guard was never left armed');
});
