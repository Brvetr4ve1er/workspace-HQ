// Phase 3 · P6 Automations + P7 Projects: the Runnable list's filters (kind,
// source, category, search, Show more), Rescan, interactive items through the
// confirm-first run, the Activity history's exit-code wording, and the Projects
// grid's search + status chips.
//
// Built like src/logic/actions.test.mjs: a store over synthetic DATA, a Component
// that is never mounted (setState is synchronous then), a FAKE window.hq that
// records every call, and toasts recorded instead of shown. Only this package's
// surfaces are rendered (vals/automations.js, vals/runs.js, vals/projects.js).
//
//   node --test dashboard-v5/src/logic/library.test.mjs
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { makeCtx } from '../vals/ctx.js';
import { automationsVals } from '../vals/automations.js';
import { runsVals, runMeta } from '../vals/runs.js';
import { projectsVals, projMatches } from '../vals/projects.js';
import { homeVals } from '../vals/home.js';
import { libFilters, libView, libCountText, libKindOf, LIB_PAGE, LIB_MORE } from './library.js';
import { proj, scan, spell, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

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

const tick = () => new Promise((res) => setImmediate(res));

// 3 background automations + 4 interactive (channeled) ones, over 4 sources and 3 categories
const SPELLS = () => [
  spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire', school: 'divination', desc: 'Scan every project' }),
  spell('script:backup', { name: 'Backup notes', source: 'script', school: 'restoration' }),
  spell('npm:a:build', { name: 'a · build', source: 'npm', school: 'transmutation' }),
  spell('skill:review', { name: 'Code review', source: 'skill', kind: 'channeled', school: 'divination', desc: 'Review the diff', command: 'claude', args: ['/review'] }),
  spell('skill:plan', { name: 'Write a plan', source: 'skill', kind: 'channeled', school: 'divination' }),
  spell('command:deploy', { name: 'Deploy', source: 'command', kind: 'channeled', school: 'transmutation' }),
  spell('npm:a:dev', { name: 'a · dev', source: 'npm', kind: 'channeled', school: 'transmutation' }),
  spell('plugin:lore', { name: 'Lore book', source: 'plugin', kind: 'tome' }),   // reference only: never in the list
];
const PROJECTS = () => [
  proj('a', { secrets: 1 }),                                  // at risk
  proj('b', { dirty: 30 }),                                   // needs care
  proj('c', { state: 'dormant', days: 90 }),                  // idle
  proj('d'),                                                  // healthy
  Object.assign(proj('e'), { stack: ['Python', 'FastAPI'] }), // healthy, another stack
];
const DATA = (o = {}) => ({
  scans: o.twoScans ? [scan('2026-10-05', PROJECTS()), scan('2026-10-04', PROJECTS())] : [scan('2026-10-05', PROJECTS())],
  spellbook: spellbook(SPELLS(), { total: 9 }),
  telemetry: telemetry(o.casts || []),
});

// A recording fake of window.hq; `over` replaces a method's answer
function fakeHq(over = {}, log = []) {
  const calls = [];
  const rec = (name, dflt) => (...args) => { calls.push([name, ...args]); log.push('call:' + name); return (over[name] || dflt || (() => true))(...args); };
  const hq = {
    castSpell: rec('castSpell', () => ({ castId: 'c-1' })), cancelCast: rec('cancelCast'),
    rescanSpellbook: rec('rescanSpellbook', () => ({ ok: true })),
  };
  for (const k of Object.keys(over)) if (over[k] === null) delete hq[k];
  return { hq, calls, called: (n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1)) };
}

function make(over, o = {}) {
  localStorage.clear(); sessionStorage.clear();
  const log = [];
  const f = fakeHq(over, log);
  const store = createStore(DATA(o), o.noBridge ? null : f.hq);
  const c = new Component({ store, previewState: o.noBridge ? 'nobridge' : 'live', startTab: 'automations', theme: 'dark', pet: false });
  const toasts = [];
  c.toast = (kind, text, opt) => { toasts.push(Object.assign({ kind, text }, opt || {})); log.push('toast:' + kind); return 'k' + toasts.length; };
  const vals = () => { const ctx = makeCtx.call(c); return Object.assign({}, automationsVals.call(c, ctx), runsVals.call(c, ctx), projectsVals.call(c, ctx)); };
  return { c, store, f, toasts, log, vals, last: () => toasts[toasts.length - 1] || {} };
}
const names = (v) => v.autos.map((a) => a.name);
const chip = (list, label) => list.find((x) => x.label.startsWith(label + ' · '));

// ---- pure filter math ---------------------------------------------------------------------
test('libFilters: an undefined / unknown state key falls back to its default', () => {
  assert.deepEqual(libFilters({}), { kind: 'all', source: '', school: '', q: '', limit: LIB_PAGE });
  assert.deepEqual(libFilters({ libKind: 'bogus', libSource: 'all', libSchool: 'all', autoQuery: '  Review ', libShow: -3 }), { kind: 'all', source: '', school: '', q: 'review', limit: LIB_PAGE });
  assert.deepEqual(libFilters({ libKind: 'interactive', libSource: 'skill', libSchool: 'Analyze', libShow: 160 }), { kind: 'interactive', source: 'skill', school: 'Analyze', q: '', limit: 160 });
});

test('libView: kind, source, category and search compose; chip counts are what each chip would show', () => {
  const { c } = make();
  const pool = c.M.AUTOS.concat(c.M.INTERACTIVE);
  assert.equal(pool.length, 7, 'the tome is not runnable: never in the pool');
  assert.deepEqual(pool.map(libKindOf), ['runnable', 'runnable', 'runnable', 'interactive', 'interactive', 'interactive', 'interactive']);

  const all = libView(pool, libFilters({}));
  assert.equal(all.matches, 7); assert.equal(all.total, 7); assert.equal(all.filtered, false);
  assert.deepEqual(all.kinds.map((k) => [k.id, k.n]), [['all', 7], ['runnable', 3], ['interactive', 4]]);

  const v = libView(pool, libFilters({ libKind: 'interactive', libSchool: 'Analyze' }));
  assert.deepEqual(v.list.map((a) => a.id).sort(), ['skill:plan', 'skill:review']);
  assert.equal(libCountText(v), '2 of 7');
  // kind chips keep the category filter: Analyze has 1 background + 2 interactive
  assert.deepEqual(v.kinds.map((k) => [k.id, k.n, k.on]), [['all', 3, false], ['runnable', 1, false], ['interactive', 2, true]]);
  // source chips keep kind + category: only skills are interactive and Analyze
  assert.deepEqual(v.sources.map((s) => [s.id, s.label, s.n]), [['skill', 'Claude skills', 2]]);
  // category chips keep kind: interactive = 2 Analyze + 2 Build
  assert.deepEqual(v.schools.map((s) => [s.label, s.n, s.on]), [['Analyze', 2, true], ['Build', 2, false]]);

  const q = libView(pool, libFilters({ libKind: 'interactive', autoQuery: 'REVIEW' }));
  assert.deepEqual(q.list.map((a) => a.id), ['skill:review'], 'the search composes with the chips, case-insensitive');
  const none = libView(pool, libFilters({ libSource: 'command', libSchool: 'Analyze' }));
  assert.equal(none.matches, 0);
  assert.ok(none.sources.some((s) => s.id === 'command' && s.n === 0 && s.on), 'the selected chip stays visible at 0');
});

test('libView: the row cap and Show more; the count says how many are on screen', () => {
  const pool = Array.from({ length: 130 }, (_, i) => ({ id: 'skill:s' + i, name: 'S' + i, source: 'skill', kind: 'interactive', mode: 'terminal', cat: 'Analyze' }));
  const v = libView(pool, libFilters({}));
  assert.equal(v.list.length, LIB_PAGE);
  assert.equal(libCountText(v), '130 of 130 · showing ' + LIB_PAGE);
  const more = libView(pool, libFilters({ libShow: LIB_PAGE + LIB_MORE }));
  assert.equal(more.list.length, 130);
  assert.equal(libCountText(more), '130 of 130');
});

// ---- the Automations screen ---------------------------------------------------------------
test('automations vals: background and interactive items in one list, chips, N of M, Clear filters', () => {
  const { c, vals } = make();
  let v = vals();
  assert.deepEqual(names(v).slice(0, 3), ['Deep scan', 'Backup notes', 'a · build'], 'background first, as before');
  assert.equal(v.autos.length, 7);
  assert.equal(v.autos.find((a) => a.name === 'Code review').mode, 'Terminal');
  assert.equal(v.autos.find((a) => a.name === 'Deep scan').mode, 'Background');
  assert.equal(v.libCount, '7 of 7');
  assert.equal(v.libFiltered, false);
  assert.deepEqual(v.libKinds.map((k) => [k.label, k.on]), [['All · 7', true], ['Runnable · 3', false], ['Interactive · 4', false]]);
  assert.equal(chip(v.libSources, 'All').on, true);
  assert.deepEqual(v.libSchools.map((s) => s.label), ['All · 7', 'Analyze · 3', 'Build · 3', 'Fix · 1']);

  chip(v.libKinds, 'Interactive').go();
  assert.equal(c.state.libKind, 'interactive');
  v = vals();
  chip(v.libSources, 'Claude skills').go();
  v = vals();
  assert.deepEqual(names(v).sort(), ['Code review', 'Write a plan']);
  assert.equal(v.libCount, '2 of 7');
  assert.equal(v.libFiltered, true);
  v.onAutoQuery({ target: { value: 'plan' } });
  v = vals();
  assert.deepEqual(names(v), ['Write a plan']);
  assert.equal(v.libCount, '1 of 7');
  chip(v.libSources, 'Claude skills').go();   // the selected chip again → All
  assert.equal(c.state.libSource, 'all');
  vals().clearLibFilters();
  v = vals();
  assert.equal(v.libCount, '7 of 7');
  assert.equal(v.autoQuery, '');
  assert.equal(v.libFiltered, false);
});

test('automations vals: Show more appears only when rows are hidden, and adds the next rows', () => {
  const { c, vals } = make();
  c.setState({ libShow: 2 });
  let v = vals();
  assert.equal(v.autos.length, 2);
  assert.equal(v.libMore, true);
  assert.equal(v.libMoreLabel, 'Show 5 more');
  assert.equal(v.libCount, '7 of 7 · showing 2');
  v.libShowMore();
  v = vals();
  assert.equal(v.autos.length, 7);
  assert.equal(v.libMore, false);
  chip(v.libKinds, 'Runnable').go();
  assert.equal(c.state.libShow, LIB_PAGE, 'a filter change goes back to the first page');
});

test('automations vals: a pinned interactive item sits on the shelf', () => {
  const { c, vals } = make();
  c.setState({ pinned: ['skill:review'] });
  assert.deepEqual(vals().shelf.map((a) => a.name), ['Code review']);
});

// ---- interactive items run through the same confirm ----------------------------------------
test('interactive: auto() finds it; the confirm says it opens a terminal; {channeled} → the terminal toast', async () => {
  const { c, f, vals, last } = make({ castSpell: () => ({ channeled: true }) });
  const a = c.auto('skill:review');
  assert.ok(a, 'auto() searches the interactive list too');
  assert.equal(c.auto('grimoire:scan').name, 'Deep scan', 'background items still resolve');
  assert.equal(c.auto('plugin:lore'), null, 'a tome is never runnable');
  c.askRun(a);
  assert.equal(c.state.confirm, 'skill:review');
  const v = vals();
  assert.equal(v.hasConfirm, true);
  assert.match(v.confirm.kind, /opens a terminal/i);
  assert.equal(v.confirm.kindTone, 'blue');
  assert.equal(v.confirm.cmd, 'claude /review');
  await c.confirmRun();
  assert.deepEqual(f.called('castSpell'), [['skill:review', 'h-skill:review']]);
  assert.equal(last().text, 'Opened in a terminal — output stays there');
  assert.equal(c.state.localRuns[0].status, 'opened');
});

// honesty-2: an interactive run only opened a terminal and no exit code ever comes back, so the
// row and the confirm must not say "✓" / "finished" (the quick-run palette says "↗ terminal")
test('interactive last run reads "↗ terminal <ago>" / "Last opened in a terminal", never ✓ or "finished"', () => {
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const casts = [
    { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: at(3), outcome: 'resolved', duration_ms: 4000, exit_code: 0 },
    { cast_id: 'c2', spell_id: 'skill:review', started_at: at(2), outcome: 'channeled', exit_code: null },
    { cast_id: 'c3', spell_id: 'skill:plan', started_at: at(1), outcome: 'fizzled', exit_code: 1 },
  ];
  const { c, vals } = make({}, { casts });
  const row = (name) => vals().autos.find((a) => a.name === name);
  assert.deepEqual([row('Code review').last, row('Code review').lastColor], ['↗ terminal 2h ago', 'var(--muted)']);
  assert.deepEqual([row('Deep scan').last, row('Deep scan').lastColor], ['✓ 3h ago', 'var(--green)'], 'a background run that resolved keeps ✓');
  assert.deepEqual([row('Write a plan').last, row('Write a plan').lastColor], ['✗ failed 1h ago', 'var(--red)']);
  c.askRun(c.auto('skill:review'));
  assert.deepEqual([vals().confirm.last, vals().confirm.lastColor], ['Last opened in a terminal 2h ago', 'var(--muted)']);
  c.setState({ confirm: null });
  c.askRun(c.auto('grimoire:scan'));
  assert.equal(vals().confirm.last, 'Last run 3h ago · finished');
});

// honesty-1: Home's "Worth a re-run" prints the automation's LATEST run ("Failed <ago> · <exit>").
// It used to pick the newest failed run in the history and then show that automation's latest
// run, which had succeeded since: "Failed 19h ago ·" (empty exit) for a run that worked.
test('Home "Worth a re-run" suggests only an automation whose latest run failed, with that run’s exit', () => {
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const home = (casts) => { const { c } = make({}, { casts }); return homeVals.call(c, makeCtx.call(c)).home; };
  // Deep scan failed 2 days ago, then ran fine 3h ago: nothing to suggest
  let h = home([
    { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: at(48), outcome: 'fizzled', exit_code: 1, duration_ms: 52000 },
    { cast_id: 'c2', spell_id: 'grimoire:scan', started_at: at(3), outcome: 'resolved', exit_code: 0, duration_ms: 4000 },
  ]);
  assert.deepEqual([h.hasSuggest, h.suggest], [false, {}]);
  // ...and Backup notes' own latest run failed 1h ago (after an older failure of Deep scan): that one
  h = home([
    { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: at(48), outcome: 'fizzled', exit_code: 1, duration_ms: 52000 },
    { cast_id: 'c2', spell_id: 'grimoire:scan', started_at: at(3), outcome: 'resolved', exit_code: 0, duration_ms: 4000 },
    { cast_id: 'c3', spell_id: 'script:backup', started_at: at(1), outcome: 'fizzled', exit_code: 2, duration_ms: 1000 },
  ]);
  assert.equal(h.hasSuggest, true);
  assert.deepEqual([h.suggest.name, h.suggest.last.ok, h.suggest.last.ago, h.suggest.last.err], ['Backup notes', false, '1h ago', 'exit 2']);
});

test('interactive: main asking to confirm again (changed command) reopens the same dialog with main’s hash', async () => {
  let n = 0;
  const { c, f } = make({ castSpell: () => (n++ === 0 ? { confirm_required: true, preview: { content_hash: 'h-new', command: 'claude', args: ['/review', '--x'], cwd: 'C:/dev/a' } } : { channeled: true }) });
  c.askRun(c.auto('skill:review'));
  await c.confirmRun();
  assert.equal(c.state.confirm, 'skill:review');
  assert.equal(c.state.confirmHash, 'h-new');
  await c.confirmRun();
  assert.deepEqual(f.called('castSpell'), [['skill:review', 'h-skill:review'], ['skill:review', 'h-new']]);
});

test('the background confirm copy is unchanged', () => {
  const { c, vals } = make();
  c.askRun(c.auto('grimoire:scan'));
  const v = vals();
  assert.equal(v.confirm.kind, 'Runs in the background · tracked in Activity');
  assert.equal(v.confirm.kindTone, 'green');
});

// ---- the palette runs interactive items too, through the same confirm ------------------------
test('palette: "run <name>" finds interactive items (hint "opens a terminal") and opens the same confirm', () => {
  const { c, f } = make();
  const pal = (query) => { c.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: query, paletteSel: 0 }); return c.paletteItems(); };
  const doGroup = (P) => (P.groups.find((g) => g.name === 'Do') || { items: [] }).items;
  let items = doGroup(pal('run review'));
  assert.deepEqual(items.map((i) => [i.label, i.hint]), [['Run Code review', 'opens a terminal']]);
  items[0].run();
  assert.equal(c.state.confirm, 'skill:review', 'the confirm-first dialog, not a direct run');
  assert.equal(c.state.paletteOpen, false);
  assert.equal(f.called('castSpell').length, 0, 'nothing runs before the confirm');
  // a background item keeps its hint; "run a" lists both kinds (background first)
  assert.deepEqual(doGroup(pal('run deep')).map((i) => [i.label, i.hint]), [['Run Deep scan', 'confirm first']]);
  assert.deepEqual(doGroup(pal('run a ·')).map((i) => [i.label, i.hint]), [['Run a · build', 'confirm first'], ['Run a · dev', 'opens a terminal']]);
});

test('palette: the Automations group lists interactive items after the background ones', () => {
  const { c } = make();
  const group = (query) => { c.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: query, paletteSel: 0 }); return (c.paletteItems().groups.find((g) => g.name === 'Automations') || { items: [] }).items.map((i) => [i.label, i.hint]); };
  // the hint is searchable: "terminal" lists every interactive item, "background" the rest (adapter order)
  assert.deepEqual(group('terminal'), [['Run a · dev', 'opens a terminal'], ['Run Code review', 'opens a terminal'], ['Run Deploy', 'opens a terminal'], ['Run Write a plan', 'opens a terminal']]);
  assert.deepEqual(group('background'), [['Run Deep scan', 'background'], ['Run Backup notes', 'background'], ['Run a · build', 'background']]);
  assert.deepEqual(group(''), [['Run Deep scan', 'background'], ['Run Backup notes', 'background'], ['Run a · build', 'background'], ['Run a · dev', 'opens a terminal']], 'no query: the first four, background first');
  c.setState({ paletteQuery: 'write a plan' });
  c.paletteItems().groups.find((g) => g.name === 'Automations').items[0].run();
  assert.equal(c.state.confirm, 'skill:plan', 'same confirm-first askRun');
});

test('Automations header counts what opens a terminal as well as what runs in the background', () => {
  const { c } = make();
  c.setState({ tab: 'automations' });
  assert.equal(c.renderVals().screenSub, '9 catalogued · 3 run in the background · 4 open a terminal');
});

// ---- Rescan --------------------------------------------------------------------------------
test('rescan: the toast goes up before the call; {ok} leaves the reload to main', async () => {
  const { c, f, toasts, log, vals } = make();
  assert.equal(vals().rescanOff, false);
  await c.rescanLib();
  assert.deepEqual(log.slice(0, 2), ['toast:progress', 'call:rescanSpellbook'], 'toast first, then the call');
  assert.equal(toasts[0].text, 'Rescanning skills, scripts and tasks — the window reloads');
  assert.equal(f.called('rescanSpellbook').length, 1);
  assert.equal(toasts.length, 1, 'no second toast after a success (the window is reloading)');
  assert.equal(c.state.libRescanning, true);
  assert.equal(vals().rescanOff, true);
  await c.rescanLib();
  assert.equal(f.called('rescanSpellbook').length, 1, 'one rescan at a time');
});

test('rescan: {error} and a rejection become an error toast and the button comes back', async () => {
  const { c, toasts, vals } = make({ rescanSpellbook: () => ({ error: 'scanner failed' }) });
  await c.rescanLib();
  assert.deepEqual(toasts.map((t) => [t.kind, t.text]), [['progress', 'Rescanning skills, scripts and tasks — the window reloads'], ['error', 'Rescan failed · scanner failed']]);
  assert.equal(c.state.libRescanning, false);
  assert.equal(vals().rescanOff, false);
  const r = make({ rescanSpellbook: () => Promise.reject(new Error('ipc gone')) });
  await r.c.rescanLib();
  assert.equal(r.last().text, 'Rescan failed · ipc gone');
  await r.c.rescanLib();
  assert.equal(r.f.called('rescanSpellbook').length, 2, 'after a failure a retry is allowed');
});

test('rescan: no bridge, a bridge without the call, or a past snapshot is refused without calling main', async () => {
  const nb = make(undefined, { noBridge: true });
  assert.equal(nb.vals().rescanOff, true);
  await nb.c.rescanLib();
  assert.equal(nb.f.called('rescanSpellbook').length, 0);
  assert.equal(nb.last().kind, 'error');
  const old = make({ rescanSpellbook: null });
  assert.equal(old.vals().rescanOff, true, 'a bridge without rescanSpellbook disables the button');
  await old.c.rescanLib();
  assert.equal(old.last().text, 'This window can’t rescan the library');
  const past = make(undefined, { twoScans: true });
  past.c.setState({ snapOffset: 1 });
  assert.equal(past.vals().rescanOff, true, 'a past snapshot is read-only');
  await past.c.rescanLib();
  assert.equal(past.f.called('rescanSpellbook').length, 0);
  assert.equal(past.last().kind, 'error');
});

// ---- Activity history: exit code wording -----------------------------------------------------
test('runMeta: an unknown exit code reads "exit code unknown", never " · exit ?"', () => {
  assert.equal(runMeta('5s · exit 1'), '5s · exit 1');
  assert.equal(runMeta(' · exit ?'), 'exit code unknown');
  assert.equal(runMeta(' · exit 1'), 'exit 1');
  assert.equal(runMeta('5s'), '5s');
  assert.equal(runMeta('5s · exit ?'), '5s · exit code unknown');
  assert.equal(runMeta('2s · exit undefined'), '2s · exit code unknown');
  assert.equal(runMeta(undefined), '');
});

test('runs vals: a history cast with no duration and no exit code', () => {
  const { vals } = make(undefined, { casts: [
    { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: '2026-10-04T10:00:00Z', outcome: 'fizzled' },
    { cast_id: 'c2', spell_id: 'script:backup', started_at: '2026-10-04T11:00:00Z', outcome: 'fizzled', exit_code: 2, duration_ms: 3000 },
  ] });
  const runs = vals().runs;
  assert.equal(runs.find((r) => r.name === 'Deep scan').meta, 'exit code unknown');
  assert.equal(runs.find((r) => r.name === 'Backup notes').meta, '3s · exit 2');
});

// ---- Projects: search + status chips ---------------------------------------------------------
test('projMatches: name or stack, case-insensitive; status', () => {
  const p = { name: 'Project E', stack: ['Python', 'FastAPI'], st: 'ok' };
  assert.equal(projMatches(p, 'fastapi', 'all'), true);
  assert.equal(projMatches(p, 'PROJECT e', 'all'), true);
  assert.equal(projMatches(p, 'rust', 'all'), false);
  assert.equal(projMatches(p, '', 'ok'), true);
  assert.equal(projMatches(p, '', 'risk'), false);
  assert.equal(projMatches(p, '  ', undefined), true);
});

test('projects vals: status chips with counts, search, shown / total, empty state, Clear', () => {
  const { c, vals } = make();
  c.go('projects', 'grid');
  let v = vals();
  assert.equal(v.projCards.length, 5);
  assert.equal(v.projCount, '5 / 5 projects');
  assert.deepEqual(v.projStatuses.map((s) => [s.label, s.on]), [['All · 5', true], ['At risk · 1', false], ['Needs care · 1', false], ['Idle · 1', false], ['Healthy · 2', false]]);
  assert.equal(v.noProjMatch, false);

  v.projStatuses.find((s) => s.label.startsWith('Healthy')).go();
  v = vals();
  assert.deepEqual(v.projCards.map((p) => p.name).sort(), ['Project D', 'Project E']);
  assert.equal(v.projCount, '2 / 5 projects');
  v.onProjSearch({ target: { value: 'python' } });
  v = vals();
  assert.deepEqual(v.projCards.map((p) => p.name), ['Project E'], 'search by stack, composed with the chip');
  assert.equal(v.projCount, '1 / 5 projects');
  assert.deepEqual(v.projStatuses.map((s) => s.label), ['All · 1', 'At risk · 0', 'Needs care · 0', 'Idle · 0', 'Healthy · 1'], 'chip counts follow the search');
  v.projStatuses.find((s) => s.label.startsWith('At risk')).go();
  v = vals();
  assert.equal(v.projCards.length, 0);
  assert.equal(v.noProjMatch, true);
  v.clearProjFilters();
  v = vals();
  assert.equal(v.projCards.length, 5);
  assert.equal(v.projSearch, '');
  assert.equal(c.state.projStatus, 'all');
  assert.equal(v.noProjMatch, false);
});
