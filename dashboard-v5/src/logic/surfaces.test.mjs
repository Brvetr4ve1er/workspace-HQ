// Behaviour of the Phase 2 surface fixes (package P-C): Home / Tasks / project page,
// Automations, Studio. The Component is built the way src/vals.golden.test.mjs builds
// it — a store over synthetic DATA plus a recording fake of window.hq — and
// componentDidMount is never called (no timers, FX or store subscriptions).
//
//   node --test dashboard-v5/src/logic/surfaces.test.mjs
//
// Synthetic fixtures only (placeholder names and paths) — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan, spell, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';
import tasksTpl from '../tpl/tasks.tpl.js';
import homeTpl from '../tpl/home.tpl.js';
import pageTpl from '../tpl/project-page.tpl.js';
import autoTpl from '../tpl/automations.tpl.js';

process.env.TZ = 'UTC';
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();

// ---- browser globals initState / renderVals touch (same as the golden test) ----------------
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

// ---- synthetic DATA ------------------------------------------------------------------------
const Q = (id, tier, title, o = {}) => ({ id, tier, title, insight: o.why || '', ...(o.proj ? { project_id: o.proj } : {}), age_days: 2, xp: o.xp ?? 10, status: o.status || 'open' });
const SPELLS = [];
for (let i = 0; i < 10; i++) SPELLS.push(spell('script:s' + i, { name: 'Script ' + i, source: 'script' }));
SPELLS.push(spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'] }));
SPELLS.push(spell('agent:helper', { name: 'Helper', kind: 'channeled', source: 'agent', command: 'claude', args: ['/helper'] }));
SPELLS.push(spell('plugin:ref', { name: 'Reference only', kind: 'reference', source: 'plugin' }));
function DATA() {
  const projects = [
    proj('a', { dev: 'npm run dev -- --port 5173', dirty: 0, days: 0 }),   // clean at scan time, has git and a dev command
    proj('b', { git: false }),                                            // no git
  ];
  const quests = [
    Q('q-a-started', 'red', 'Rotate the key in Project A', { proj: 'a', xp: 40, status: 'in_progress' }),
    Q('q-a-open', 'orange', 'Write the README for Project A', { proj: 'a', xp: 20 }),
    Q('q-b-open', 'yellow', 'Put Project B under git', { proj: 'b', xp: 10 }),
  ];
  return {
    scans: [scan('2026-10-04', projects, { quests }), scan('2026-10-05', projects, { quests })],
    spellbook: spellbook(SPELLS, { total: 40, bySource: { script: 10, skill: 12, agent: 3, plugin: 15 } }),
    telemetry: telemetry([]),
    projectNotes: { a: [
      { id: '1', text: 'A plain note', date: '2026-10-01T10:00:00Z', completed: false },
      { id: '2', text: 'Use the plugin approach', date: '2026-10-04T10:00:00Z', completed: false, kind: 'decision' },
    ] },
  };
}

// a recording fake of the bits of window.hq these surfaces call
function fakeHq(o = {}) {
  const calls = [];
  const or = (k, d) => (k in o ? o[k] : d);   // an explicit null/false answer is kept
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return Promise.resolve(typeof ret === 'function' ? ret(...args) : ret); };
  const hq = {
    calls,
    actedOn: rec('actedOn', true),
    markQuestDone: rec('markQuestDone', true),
    devStart: rec('devStart', or('devStart', true)),
    devStop: rec('devStop', true),
    openRepo: rec('openRepo', or('openRepo', '')),
    openFile: rec('openFile', ''),
    saveNote: rec('saveNote', true),
    logDecision: rec('logDecision', or('logDecision', true)),
    learn: rec('learn', true),
  };
  return hq;
}
function make(hq, state) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore(DATA(), hq === undefined ? fakeHq() : hq);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  if (state) Object.assign(c.state, typeof state === 'function' ? state(c, store.model) : state);
  return c;
}
const page = (id) => ({ tab: 'projects', route: { type: 'project', id }, diagTab: 'git' });
const toasts = (c) => c.state.toasts.map((t) => t.kind + ' · ' + t.text);
const hasToast = (c, kind, text) => c.state.toasts.some((t) => t.kind === kind && t.text.includes(text));
const timers = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });

// ---- C6: in-progress chip ----------------------------------------------------------------------
test('in-progress quests carry a chip on Tasks rows, the Home next action and the project page Next list', (t) => {
  timers(t);
  const tasks = make(undefined, { tab: 'tasks' }).renderVals();
  const rows = tasks.taskRows.filter((r) => r.isTask);
  assert.equal(rows.find((r) => r.title === 'Rotate the key in Project A').inProgress, true);
  assert.equal(rows.find((r) => r.title === 'Write the README for Project A').inProgress, false);
  for (const r of rows) assert.equal(typeof r.inProgress, 'boolean');   // defined on every row: an undefined binding fails the selftest

  const home = make(undefined, { tab: 'home' }).renderVals().home;
  assert.equal(home.next.title, 'Rotate the key in Project A');
  assert.equal(home.next.inProgress, true);

  const pg = make(undefined, page('a')).renderVals().pg;
  assert.equal(pg.next.find((n) => n.title === 'Rotate the key in Project A').inProgress, true);
  assert.equal(pg.next.find((n) => n.title === 'Write the README for Project A').inProgress, false);
  for (const n of pg.next) assert.equal(typeof n.inProgress, 'boolean');

  // the markup binds it, each change marked for the designer
  assert.match(tasksTpl, /<!-- v5:[^>]*--><sc-if value="\{\{ t\.inProgress \}\}"[^>]*><span[^>]*>in progress<\/span><\/sc-if>/);
  assert.match(homeTpl, /<!-- v5:[^>]*--><sc-if value="\{\{ home\.next\.inProgress \}\}"[^>]*><span[^>]*>in progress<\/span><\/sc-if>/);
  assert.match(pageTpl, /<!-- v5:[^>]*--><sc-if value="\{\{ n\.inProgress \}\}"[^>]*><span[^>]*>in progress<\/span><\/sc-if>/);
});

test('with nothing open, Home’s next action still defines inProgress (no unresolved binding)', (t) => {
  timers(t);
  const c = make(undefined, (cc, M) => ({ tab: 'home', completed: M.T0.map((x) => x.id) }));
  const home = c.renderVals().home;
  assert.equal(home.hasNext, false);
  assert.equal(home.next.inProgress, false);
});

// ---- C6: focus time on completion ----------------------------------------------------------------
test('completing the task Focus mode is on logs the focus seconds with via:focus', (t) => {
  timers(t);
  const hq = fakeHq();
  const c = make(hq, { focus: { taskId: 'q-a-started', start: NOW - 125000 }, now: NOW });
  c.completeTask('q-a-started');
  assert.equal(c.state.focus, null, 'focus mode ends');
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'actedOn'), [], 'the write waits for the Undo window');
  c.flushPending();
  const acted = hq.calls.filter((x) => x[0] === 'actedOn').map((x) => x[1]);
  assert.equal(acted.length, 1, 'one entry, not a second unresolved focus entry');
  assert.deepEqual(acted[0], { kind: 'quest', action_id: 'q-a-started', project_id: 'a', resolved: true, marked_done: true, via: 'focus', seconds: 125 });
  assert.ok(hq.calls.some((x) => x[0] === 'markQuestDone' && x[1] === 'q-a-started'));
});

test('completing a task that is not the focused one logs via:board and leaves focus alone', (t) => {
  timers(t);
  const hq = fakeHq();
  const focus = { taskId: 'q-a-open', start: NOW - 60000 };
  const c = make(hq, { focus, now: NOW });
  c.completeTask('q-b-open');
  assert.deepEqual(c.state.focus, focus);
  c.flushPending();
  const acted = hq.calls.filter((x) => x[0] === 'actedOn').map((x) => x[1]);
  assert.deepEqual(acted, [{ kind: 'quest', action_id: 'q-b-open', project_id: 'b', resolved: true, marked_done: true, via: 'board', seconds: 0 }]);
});

test('Undo after a focused completion cancels the done write but keeps the focus time (unresolved)', (t) => {
  timers(t);
  const hq = fakeHq();
  const c = make(hq, { focus: { taskId: 'q-a-started', start: NOW - 90000 }, now: NOW });
  c.completeTask('q-a-started');
  c.undoTask('q-a-started');
  c.flushPending();
  const acted = hq.calls.filter((x) => x[0] === 'actedOn').map((x) => x[1]);
  assert.deepEqual(acted, [{ kind: 'quest', action_id: 'q-a-started', project_id: 'a', seconds: 90, resolved: false, via: 'focus' }]);
  assert.ok(!hq.calls.some((x) => x[0] === 'markQuestDone'), 'nothing marked done');
});

// ---- C6: journal decisions ---------------------------------------------------------------------
test('project notes with kind:decision show as Decision (blue), plain notes as Note', (t) => {
  timers(t);
  const pg = make(undefined, page('a')).renderVals().pg;
  const dec = pg.journal.find((j) => j.text === 'Use the plugin approach');
  const note = pg.journal.find((j) => j.text === 'A plain note');
  assert.deepEqual([dec.kind, dec.color], ['Decision', 'var(--blue)']);
  assert.deepEqual([note.kind, note.color], ['Note', 'var(--muted)']);
});

test('a journal write main refuses (false) says it wasn’t saved', async (t) => {
  timers(t);
  const hq = fakeHq({ logDecision: false });
  const c = make(hq, { ...page('a'), journalKind: 'decision', journalDraft: 'Ship it' });
  await c.addJournal();
  assert.ok(hasToast(c, 'error', 'Not saved'), toasts(c).join('\n'));
  assert.ok(!hasToast(c, 'success', 'Decision logged'), 'no success claim');
  assert.equal(c.state.journalDraft, 'Ship it', 'the draft is kept');
  assert.deepEqual(c.state.journalAdds, {});
});

// ---- C6: Commit button ---------------------------------------------------------------------------
test('Commit is enabled whenever live + git, even when the scan counted 0 dirty files', (t) => {
  timers(t);
  assert.equal(make(undefined, page('a')).renderVals().pg.cantCommit, false, 'clean at scan time, has git');
  assert.equal(make(undefined, page('b')).renderVals().pg.cantCommit, true, 'no git');
  assert.equal(make(undefined, { ...page('a'), snapOffset: 1 }).renderVals().pg.cantCommit, true, 'past snapshot');
  assert.equal(make(null, page('a')).renderVals().pg.cantCommit, true, 'no bridge');
});

// ---- C6: dev button + Resume ----------------------------------------------------------------------
test('Start dev: devStart false → honest toast; true → "starting"', async (t) => {
  timers(t);
  let c = make(fakeHq({ devStart: false }), page('a'));
  await c.renderVals().pg.dev();
  assert.ok(hasToast(c, 'error', 'Dev server didn’t start — it may already be running'), toasts(c).join('\n'));
  assert.ok(!hasToast(c, 'success', 'Dev server starting'));

  c = make(fakeHq({ devStart: true }), page('a'));
  await c.renderVals().pg.dev();
  assert.ok(hasToast(c, 'success', 'Dev server starting · npm run dev -- --port 5173'), toasts(c).join('\n'));
});

test('Stop dev goes through stopDev when the hydrated LIVE.dev says it runs', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = make(hq, page('a'));
  c.LIVE.dev = { a: { since: NOW - 60000 } };
  const stopped = [];
  c.stopDev = (id) => { stopped.push(id); };
  const pg = c.renderVals().pg;
  assert.match(pg.devLabel, /Stop/);
  await pg.dev();
  assert.deepEqual(stopped, ['a']);
  assert.ok(!hq.calls.some((x) => x[0] === 'devStart'));
});

test('Resume reports what really happened: dev server not started is not claimed', async (t) => {
  timers(t);
  const hq = fakeHq({ devStart: false });
  const c = make(hq, page('a'));
  await c.renderVals().pg.resume();
  assert.ok(hq.calls.some((x) => x[0] === 'devStart' && x[1] === 'a'));
  const text = toasts(c).join('\n');
  assert.match(text, /Opened the folder/);
  assert.match(text, /Dev server didn’t start — it may already be running/i);
  assert.doesNotMatch(text, /started npm run dev/);

  const ok = make(fakeHq({ devStart: true }), page('a'));
  await ok.renderVals().pg.resume();
  assert.ok(hasToast(ok, 'success', 'Opened the folder · started npm run dev -- --port 5173'), toasts(ok).join('\n'));

  const refused = make(fakeHq({ openRepo: false, devStart: true }), page('a'));
  await refused.renderVals().pg.resume();
  assert.doesNotMatch(toasts(refused).join('\n'), /Opened the folder/);
  assert.match(toasts(refused).join('\n'), /couldn’t open the folder/i);
});

// ---- C7: automations -------------------------------------------------------------------------------
test('the Library intro uses the spellbook counts, not fixed numbers', (t) => {
  timers(t);
  const c = make(undefined, (cc) => ({ tab: 'automations', sub: { ...cc.state.sub, automations: 'library' } }));
  const v = c.renderVals(), M = c.M;
  assert.equal(M.autoTotal, 40);
  assert.equal(M.AUTOS.length, 10);
  assert.equal(M.INTERACTIVE.length, 2);
  assert.equal(v.libIntro, '40 things are catalogued. 10 run here in the background and 2 open in a terminal; the rest are reference only, so they have no Run button here.');
  assert.match(autoTpl, /<!-- v5:[^>]*-->\s*<div[^>]*>\{\{ libIntro \}\}<\/div>/);
  assert.doesNotMatch(autoTpl, /980 things|Only 29/);
  const skills = v.lib.find((l) => l.name === 'Claude skills');
  assert.equal(skills.why, '1 open in a terminal');
  assert.equal(v.lib.find((l) => l.name === 'Plugins').why, 'reference only · can’t run from the app');
});

test('pin refuses a 9th with a toast; unpinning and pinning under the cap still work', (t) => {
  timers(t);
  const c = make(undefined, (cc, M) => ({ tab: 'automations', pinned: M.AUTOS.slice(0, 8).map((a) => a.id) }));
  const ninth = c.M.AUTOS[8];
  const row = (id) => c.renderVals().autos.find((r) => r.name === c.M.AUTOS.find((a) => a.id === id).name);
  row(ninth.id).pin();
  assert.equal(c.state.pinned.length, 8);
  assert.ok(!c.state.pinned.includes(ninth.id));
  assert.ok(hasToast(c, 'info', 'Pin up to 8 — unpin one first'), toasts(c).join('\n'));

  row(c.M.AUTOS[0].id).pin();   // unpin one
  assert.equal(c.state.pinned.length, 7);
  row(ninth.id).pin();          // now there is room
  assert.equal(c.state.pinned.length, 8);
  assert.ok(c.state.pinned.includes(ninth.id));
});
