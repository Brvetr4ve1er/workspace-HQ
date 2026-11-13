// node --test dashboard/cast-modes.test.mjs — the pure half of the quick-run palette's Needs-you rows and Go mode (cast-modes.js).
// Placeholder names and ids only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('./cast-modes.js');

const labels = (rows) => rows.map((r) => r.label);
const PROJECTS = [
  { id: 'sample-app', name: 'Sample App' },
  { id: 'demo-site', name: 'Demo Site' },
  { id: 'runner-kit', name: 'Runner Kit' },
];

test('loads in plain node and as a browser global (window.CastModes), same API', () => {
  const src = readFileSync(new URL('./cast-modes.js', import.meta.url), 'utf8');
  const win = {};
  vm.runInNewContext(src, { window: win });   // no module, no document: the page case
  assert.equal(typeof win.CastModes, 'object');
  assert.deepEqual([...Object.keys(win.CastModes)].sort(), Object.keys(M).sort());
  assert.equal(JSON.stringify(win.CastModes.goRows('run')), JSON.stringify(M.goRows('run')));
});

test('nextMode cycles Run -> Go -> Run, and anything unknown starts at run', () => {
  assert.deepEqual([...M.MODES], ['run', 'go']);
  assert.equal(M.nextMode('run'), 'go');
  assert.equal(M.nextMode('go'), 'run');
  for (const x of [undefined, null, '', 'GO', 7, {}, []]) assert.equal(M.nextMode(x), 'run');
  assert.match(M.HINTS.run, /tab go/);
  assert.match(M.HINTS.go, /tab run/);
});

test('goTable: the eleven spaces first-class, sub-views after their space, every entry frozen and addressable', () => {
  const spaces = M.goTable.filter((t) => t.kind === 'space');
  assert.equal(spaces.length, 11);
  assert.ok(Object.isFrozen(M.goTable));
  assert.ok(M.goTable.some((t) => t.tab === 'money' && t.sub === 'runway' && t.label === 'Money › Runway'));
  assert.ok(M.goTable.some((t) => t.tab === 'projects' && t.sub === 'clients'));
  assert.ok(M.goTable.some((t) => t.tab === 'claude' && t.sub === 'sessions'));
  for (const t of M.goTable) assert.match(t.tab, /^[a-z]{2,16}$/);
  for (const t of M.goTable.filter((x) => x.sub)) assert.match(t.sub, /^[a-z]{2,16}$/);
});

test('filterGo: an empty query is the eleven spaces and no projects; projects appear only once a character is typed', () => {
  for (const q of ['', '   ', undefined, null]) {
    const r = M.filterGo(q, PROJECTS);
    assert.equal(r.length, 11);
    assert.ok(r.every((x) => x.kind === 'space'));
    assert.equal(M.goRows(q, PROJECTS).length, 8, 'the palette caps what it draws');
  }
  const typed = M.filterGo('s', PROJECTS);
  assert.ok(typed.some((x) => x.kind === 'project' && x.label === 'Sample App'));
});

test('filterGo: prefix and word-start matching on the label, the path and ids', () => {
  assert.deepEqual(labels(M.goRows('runw')), ['Money › Runway']);
  assert.ok(labels(M.goRows('sup')).includes('Projects › Vercel & Supabase'), 'a word start inside a label');
  assert.ok(labels(M.goRows('risks')).includes('Tasks › Ideas & risks'));
  assert.deepEqual(labels(M.goRows('money run')), ['Money › Runway'], 'two words: space then sub-view');
  assert.equal(M.goRows('money')[0].label, 'Money', 'the space before its own sub-views');
  assert.equal(M.goRows('money').length, 5);   // Money + its four views
  assert.deepEqual(M.goRows('zzzz'), []);
  assert.deepEqual(labels(M.goRows('MONEY RUN')), ['Money › Runway'], 'case does not matter');
  assert.deepEqual(labels(M.goRows('  money   run  ')), ['Money › Runway'], 'spaces collapse');
  assert.deepEqual(labels(M.goRows('mid')), [], 'a middle of a word is not a match');
  assert.equal(M.goRows('mönéy')[0].label, 'Money', 'accents fold');
});

test('"run" ranks Money > Runway before Automations > Runnable (the fixed tie-break table), and the table is what decides it', () => {
  assert.deepEqual(labels(M.goRows('run')), ['Money › Runway', 'Automations › Runnable']);
  assert.deepEqual(labels(M.goRows('ru')).slice(0, 2), ['Money › Runway', 'Automations › Runnable']);
  // without the table the two tie and the table order (Automations before Money) would put Runnable first
  const raw = M.rankGo(M.filterGo('run'), 'something else');
  assert.deepEqual(labels(raw), ['Automations › Runnable', 'Money › Runway']);
  assert.deepEqual(M.TIE_BREAK.run, ['money/runway', 'automations/runnable']);
  assert.ok(M.tieBreak('run', { kind: 'sub', tab: 'money', sub: 'runway' }, { kind: 'sub', tab: 'automations', sub: 'runnable' }) < 0);
  assert.ok(M.tieBreak('run', { kind: 'sub', tab: 'automations', sub: 'runnable' }, { kind: 'sub', tab: 'money', sub: 'runway' }) > 0);
  assert.equal(M.tieBreak('go', { kind: 'sub', tab: 'money', sub: 'runway' }, { kind: 'sub', tab: 'automations', sub: 'runnable' }), 0);
  assert.equal(M.tieBreak('run', null, undefined), 0);
});

test('"projects": the space first, then the Claude view; a better score always beats the tie-break', () => {
  const r = M.goRows('projects');
  assert.equal(r[0].label, 'Projects');
  assert.equal(r[0].kind, 'space');
  assert.equal(r[1].label, 'Claude › Projects');
  // an exact name outranks a prefix match: "money" is the space, never a sub-view
  assert.equal(M.goRows('money')[0].kind, 'space');
});

test('a project row opens the project; a space or view row carries only its place', () => {
  const r = M.goRows('sample', PROJECTS);
  const p = r.find((x) => x.kind === 'project');
  assert.deepEqual(p.route, { tab: 'projects', projectId: 'sample-app' });
  assert.equal(p.hint, 'Project');
  assert.deepEqual(M.goRows('runway')[0].route, { tab: 'money', sub: 'runway' });
  assert.deepEqual(M.goRows('')[0].route, { tab: 'home' });
  for (const x of M.goRows('s', PROJECTS)) assert.deepEqual(Object.keys(x).sort(), ['hint', 'kind', 'label', 'route']);
});

test('projects: matched by their own name only, never "through a parent", skipped when malformed', () => {
  const odd = [null, 7, 'x', {}, { id: '' }, { id: 5 }, { id: 'ok-1' }, { id: 'ok-2', name: 7 }, { id: 'ok-3', name: '' }];
  const r = M.goRows('ok', odd);
  assert.deepEqual(r.filter((x) => x.kind === 'project').map((x) => x.route.projectId), ['ok-1', 'ok-2', 'ok-3'], 'a missing name falls back to the id');
  assert.deepEqual(M.goRows('money', [{ id: 'abc', name: 'Other' }]).filter((x) => x.kind === 'project'), []);
});

test('briefRows: projection rows only, capped at 3, nothing but ref + label + scan survives', () => {
  const view = {
    status: 'ok',
    brief: [
      { ref: 'abcdef012345', label: 'high · A project has secrets in plain sight', scan: false, why: 'in /placeholder/path', amount: 424242, key: 'secret:x' },
      { ref: '0123456789ab', label: 'A bill is late', scan: false },
      { ref: 'fedcba123456', label: 'Scan is old', scan: true },
      { ref: '111111111111', label: 'a fourth row' },
    ],
  };
  const { rows, note } = M.briefRows(view);
  assert.equal(rows.length, 3);
  assert.equal(note, null);
  assert.deepEqual(rows[0], { kind: 'brief', ref: 'abcdef012345', label: 'high · A project has secrets in plain sight', scan: false });
  assert.equal(rows[2].scan, true);
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['kind', 'label', 'ref', 'scan']);
  assert.ok(!JSON.stringify(rows).includes('placeholder'));
  assert.ok(!JSON.stringify(rows).includes('424242'));
});

test('briefRows: a bad ref or label is dropped, a long label is clipped, a truthy non-true scan is not a scan', () => {
  const view = { brief: [
    { ref: 'ABCDEF012345', label: 'upper-case hex is not a ref' }, { ref: 'abc', label: 'short' }, { ref: 7, label: 'num' },
    { ref: 'abcdef012345', label: '   ' }, { ref: 'abcdef012345' }, null, 'x',
    { ref: 'abcdef012345', label: 'x'.repeat(300), scan: 'yes' },
  ] };
  const { rows } = M.briefRows(view);
  assert.equal(rows.length, 1);
  assert.ok(Array.from(rows[0].label).length <= 64);
  assert.equal(rows[0].scan, false);
});

test('honest empty states: nothing needs you, not ready yet, incomplete, no bridge, no projects, nothing matches', () => {
  assert.equal(M.briefRows({ status: 'empty', brief: [] }).note, 'nothing needs you');
  assert.equal(M.briefRows({ status: 'not-ready', brief: [] }).note, 'brief not ready yet');
  assert.equal(M.briefRows({ status: 'incomplete', brief: [] }).note, 'brief incomplete');
  assert.equal(M.briefRows(undefined).note, 'brief not ready yet');
  assert.equal(M.stateNote('run', { view: { status: 'empty', brief: [] } }), 'nothing needs you');
  assert.equal(M.stateNote('run', { view: { status: 'ok', brief: [{ ref: 'abcdef012345', label: 'x' }] } }), null);
  assert.equal(M.stateNote('run', { bridge: false }), 'this window has no navigation bridge');
  assert.equal(M.stateNote('go', { bridge: false, query: 'x' }), 'this window has no navigation bridge');
  assert.equal(M.stateNote('go', { query: 'zzzz', count: 0, view: { projects: [] } }), 'nothing matches');
  assert.equal(M.stateNote('go', { query: 'run', count: 2, view: { projects: null } }), 'no projects loaded');
  assert.equal(M.stateNote('go', { query: 'zzzz', count: 0, view: { projects: null } }), 'nothing matches · no projects loaded');
  assert.equal(M.stateNote('go', { query: '', count: 10, view: { projects: null } }), null, 'nothing typed: no project caveat');
  assert.equal(M.stateNote('go', { query: 'run', count: 2, view: { projects: [] } }), null);
});

test('unknown inputs never throw: null, a string, numbers, objects, a 10,000-entry list, a huge query', () => {
  const junk = [undefined, null, '', 'str', 0, NaN, 7, true, {}, [], [null], { brief: 'x' }, { brief: [null] }, () => 1, Symbol.iterator];
  for (const j of junk) {
    assert.doesNotThrow(() => M.filterGo(j, j));
    assert.doesNotThrow(() => M.rankGo(j, j));
    assert.doesNotThrow(() => M.goRows(j, j, j));
    assert.doesNotThrow(() => M.briefRows(j));
    assert.doesNotThrow(() => M.stateNote(j, j));
    assert.doesNotThrow(() => M.nextMode(j));
    assert.doesNotThrow(() => M.tieBreak(j, j, j));
  }
  const big = Array.from({ length: 10000 }, (_, i) => ({ id: 'p' + i, name: 'Project ' + i }));
  const t0 = Date.now();
  const r = M.goRows('project 9', big, 8);
  assert.ok(r.length <= 8);
  assert.ok(Date.now() - t0 < 1500, 'a huge list stays fast');
  assert.doesNotThrow(() => M.goRows('x'.repeat(100000), big));
  assert.deepEqual(M.briefRows({ brief: Array.from({ length: 10000 }, () => ({ ref: 'abcdef012345', label: 'row' })) }).rows.length, 3);
  assert.equal(M.goRows('run', PROJECTS, 1).length, 1);
  assert.equal(M.goRows('run', [], -5).length, 2, 'a bad limit falls back to the default');
});

test('rankGo does not mutate its input', () => {
  const rows = M.filterGo('run');
  const before = rows.map((r) => r.label);
  M.rankGo(rows, 'run');
  assert.deepEqual(rows.map((r) => r.label), before);
});

// ---- ordered by measured use (batch 5): only typed-query ties, only once 10 opens are counted ----
const useOf = (byTarget) => ({ marks: Object.values(byTarget).reduce((a, n) => a + n, 0), byTarget });

test('SPACE_IDS and SURFACE_TARGETS: the eleven spaces, the eight older surfaces and only real targets', () => {
  assert.deepEqual([...M.SPACE_IDS], M.goTable.filter((t) => t.kind === 'space').map((t) => t.tab));
  assert.equal(M.SPACE_IDS.length, 11);
  assert.ok(Object.isFrozen(M.SPACE_IDS) && Object.isFrozen(M.SURFACE_TARGETS));
  assert.deepEqual({ ...M.SURFACE_TARGETS }, {
    'sessions-board': 'claude/sessions', 'sessions-strip': 'claude/sessions', 'clients-list': 'projects/clients', 'machine-drift': 'system/machine',
    'brief-history': 'history/timeline', 'money-start': 'money/today', 'money-quick': 'money/today', 'money-access': 'money/today',
  });
  const keys = new Set(M.goTable.map((t) => t.tab + '/' + (t.sub || '')));
  for (const t of Object.values(M.SURFACE_TARGETS)) assert.ok(keys.has(t), t);
});

test('useActive: the counts must add up to 10; junk is never active', () => {
  assert.equal(M.USE_ACTIVE_MIN, 10);
  assert.equal(M.useActive(useOf({ 'money/': 9 })), false);
  assert.equal(M.useActive(useOf({ 'money/': 9, 'tasks/': 1 })), true);
  for (const bad of [null, undefined, 3, 'x', [], {}, { byTarget: null }, { byTarget: { 'money/': 'ten' } }, { byTarget: { 'money/': NaN } }, { byTarget: { 'money/': -50, 'tasks/': 9 } }]) {
    assert.equal(M.useActive(bad), false, JSON.stringify(bad));
  }
  assert.equal(M.useActive({ byTarget: { 'money/': -50, 'tasks/': 99 } }), true, 'a negative count is ignored, not subtracted');
});

test('below activation rankGo equals the old order for every case, with or without a use object', () => {
  const few = useOf({ 'automations/': 4, 'automations/runnable': 3 });   // 7 opens: not active
  for (const q of ['run', 'ru', 'money', 'projects', 'go', 'a', 'sample', 'view', '']) {
    const old = JSON.stringify(M.rankGo(M.filterGo(q, PROJECTS), q));
    assert.equal(JSON.stringify(M.rankGo(M.filterGo(q, PROJECTS), q, few)), old, q);
    assert.equal(JSON.stringify(M.rankGo(M.filterGo(q, PROJECTS), q, null)), old, q);
    assert.equal(JSON.stringify(M.goRows(q, PROJECTS, undefined, few)), JSON.stringify(M.goRows(q, PROJECTS)), q);
  }
  assert.deepEqual(labels(M.goRows('run', null, undefined, few)), ['Money › Runway', 'Automations › Runnable']);
});

test('with 12 counted opens a typed query breaks its ties by count: "run" lists Automations > Runnable first, two tied spaces list the busier one', () => {
  const use = useOf({ 'automations/runnable': 8, 'money/runway': 2, 'automations/': 2 });
  assert.deepEqual(labels(M.goRows('run', null, undefined, use)), ['Automations › Runnable', 'Money › Runway']);
  // "s" ties Security and System (own name starts with it); table order puts System first, the counts decide
  const spaces = (use2) => labels(M.goRows('s', null, 20, use2).filter((r) => r.kind === 'space'));
  const plain = spaces(null);
  assert.ok(plain.indexOf('System') < plain.indexOf('Security'), plain.join(','));
  const busy = spaces(useOf({ 'security/': 11, 'system/': 1 }));
  assert.ok(busy.indexOf('Security') < busy.indexOf('System'), busy.join(','));
  const busy2 = spaces(useOf({ 'security/': 1, 'system/': 11 }));
  assert.ok(busy2.indexOf('System') < busy2.indexOf('Security'), busy2.join(','));
});

test('12 quick-jump or reach marks alone leave an empty byTarget: not active, the order and the hint stay as they were', () => {
  // use-counts.js gives those surfaces no target, so byTarget stays empty while marks (informational) is 12
  const none = { marks: 12, byTarget: {} };
  assert.equal(M.useActive(none), false);
  assert.equal(JSON.stringify(M.goRows('run', null, undefined, none)), JSON.stringify(M.goRows('run')));
  assert.equal(M.hintFor('go', none), M.HINTS.go);
});

test('the empty query stays in nav order even with active use', () => {
  const use = useOf({ 'security/': 30, 'money/': 20, 'cosmos/': 10 });
  assert.equal(JSON.stringify(M.goRows('', null, undefined, use)), JSON.stringify(M.goRows('')));
  assert.deepEqual(labels(M.goRows('', null, undefined, use)), ['Home', 'Projects', 'Tasks', 'Automations', 'Claude', 'History', 'System', 'Life']);
  assert.equal(JSON.stringify(M.goRows('', PROJECTS, 20, use)), JSON.stringify(M.goRows('', PROJECTS, 20)));
});

test('equal counts fall back to TIE_BREAK, then table order', () => {
  const same = useOf({ 'automations/runnable': 6, 'money/runway': 6 });
  assert.deepEqual(labels(M.goRows('run', null, undefined, same)), ['Money › Runway', 'Automations › Runnable']);
  const none = useOf({ 'tasks/': 12 });   // active, but neither run target has a count
  assert.deepEqual(labels(M.goRows('run', null, undefined, none)), ['Money › Runway', 'Automations › Runnable']);
  // a query with no table entry falls to table order (Automations before Money)
  const raw = M.rankGo(M.filterGo('run'), 'something else', none);
  assert.deepEqual(labels(raw), ['Automations › Runnable', 'Money › Runway']);
});

test('a project never outranks a space or a view, whatever the counts; a better score still beats use', () => {
  const use = useOf({ 'money/': 40, 'money/runway': 40, 'cosmos/': 12 });
  const pr = [{ id: 'money-app', name: 'Money App' }];
  const rows = M.goRows('money', pr, 20, use);
  const firstProject = rows.findIndex((r) => r.kind === 'project');
  assert.ok(firstProject > 0 && rows.slice(0, firstProject).every((r) => r.kind !== 'project'));
  assert.equal(rows[0].label, 'Money');
  // an exact name (score 0) beats a heavily used prefix match (score 1)
  const exact = M.goRows('system', null, undefined, useOf({ 'system/machine': 50 }));
  assert.equal(exact[0].label, 'System');
});

test('hintFor says "ties ordered by what you use" only in Go mode while use ordering is active', () => {
  const on = useOf({ 'money/': 10 });
  assert.equal(M.hintFor('go', on), M.HINTS.go + ' · ties ordered by what you use');
  assert.equal(M.hintFor('run', on), M.HINTS.run);
  assert.equal(M.hintFor('go', useOf({ 'money/': 9 })), M.HINTS.go);
  assert.equal(M.hintFor('go'), M.HINTS.go);
  assert.equal(M.hintFor('nonsense', on), M.HINTS.run);
});

test('rankGo with use does not mutate its inputs and never throws on junk', () => {
  const use = useOf({ 'money/': 12 });
  const rows = M.filterGo('m');
  const before = JSON.stringify(rows), ub = JSON.stringify(use);
  M.rankGo(rows, 'm', use);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(JSON.stringify(use), ub);
  for (const bad of [null, 5, 'x', [], { byTarget: 7 }, { byTarget: [] }]) assert.doesNotThrow(() => M.rankGo(rows, 'm', bad));
  assert.doesNotThrow(() => M.rankGo(rows, undefined, use));
});
