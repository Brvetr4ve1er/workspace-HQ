// Phase 3 package P3-SYSPROJ: System (Re-examine, fixed issues, Note for cleanup) and
// the project page (Next = tasks + side quests + suggestions without repeats, every
// risk flag, git risk, "Add to ideas" for missing basics, ⚡ terminal). The Component
// is built like src/logic/surfaces.test.mjs builds it — a store over synthetic DATA
// plus a recording fake of window.hq — and componentDidMount is never called.
//
//   node --test dashboard-v5/src/logic/sysproj.test.mjs
//
// Synthetic fixtures only (placeholder names, paths and hosts) — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { systemLogic, CAPTURE_OFF, SCAN_TIP, SCAN_OFF } from './system.js';
import { sheetLogic } from './sheet.js';
import { projectLogic } from './project.js';
import { proj, scan, organ, pcHealth } from '../live/__fixtures__/synthetic.mjs';
import systemTpl from '../tpl/system.tpl.js';
import pageTpl from '../tpl/project-page.tpl.js';

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
const Q = (id, tier, title, o = {}) => ({ id, tier, title, insight: '', project_id: o.proj, age_days: 2, xp: 10, status: 'open' });
const SQ = (id, title, o = {}) => ({ id, project_id: o.proj || 'a', kind: o.kind || 'idea', title, detail: o.detail ?? '', source: o.source || 'deterministic', effort: 'S', impact: 'medium', ...(o.done ? { done: true } : {}), ...(o.dismissed ? { dismissed: true } : {}) });
const CLONES = Array.from({ length: 14 }, (_, i) => ({ name: 'ref-lib-' + i, origin: 'example.org/ref-lib-' + i, diverged: i === 0 }));
function DATA(o = {}) {
  const a = proj('a', {
    gitRisk: 'high', gitFlags: ['no-remote'],
    riskFlags: [{ type: 'uncommitted_work', severity: 'medium', detail: 'Many dirty files for days', location: 'project-a/' }, { type: 'hardcoded_secret', severity: 'high', detail: 'Token in source', location: 'src/x.js:4' }],
    signals: { has_tests: false, has_ci: false, has_readme: false, has_license: false },
    suggestions: [
      { kind: 'urgent', text: 'Commit the dirty files today.', effort: 'S', impact: 'high' },   // copied into a side quest below (trailing dot differs)
      { kind: 'idea', text: 'Split the router', effort: 'M', impact: 'medium' },                // not copied: shows as a suggestion row
      { kind: '', text: 'Add a changelog', effort: 'S', impact: 'low' },                         // a done side quest has it: never comes back
      { kind: 'idea', text: 'split the  router', effort: 'M', impact: 'medium' },               // same text again: once
    ],
    side: [
      SQ('sq-a-readme', 'Write a README', { detail: 'No README — capture what this is and how to run it.' }),
      SQ('sq-a-llm-sug-0', 'Commit the dirty files today', { kind: 'urgent', source: 'llm' }),
      SQ('sq-a-llm-uncommitted', 'Many dirty files for days', { kind: 'risk', source: 'llm', detail: 'at project-a/' }),
      SQ('sq-a-llm-sug-2', 'Add a changelog', { source: 'llm', done: true }),
    ],
  });
  const b = proj('b', { signals: { has_tests: true } });
  const quests = [Q('q-a-1', 'orange', 'Write the docs for Project A', { proj: 'a' })];
  // the global feed: the projects' side quests plus a captured note routed to Project A
  const feed = [
    { ...SQ('sq-capture-1', 'Project A: set up CI'), source: 'capture', detail: 'captured', project_name: 'Project A' },
    { ...SQ('sq-a-readme', 'Write a README'), project_name: 'Project A' },
  ];
  const inv = { clones: CLONES, empty: ['old-folder'], duplicates: [{ type: 'twin', detail: 'Folder "x-copy" mirrors "x"', severity: 'warning' }] };
  return {
    scans: [scan('2026-10-04', [a, b], { quests, side: feed, inv }), scan('2026-10-05', [a, b], { quests, side: feed, inv })],
    pcHealth: pcHealth([organ('cpu'), organ('disk', { label: 'Storage', status: 'ember', diagnosis: 'Disk filling up', teaching: 'Low space slows builds', fixes: [{ title: 'Clean temp', command: 'Clear-Temp', danger: 'safe' }] }), organ('ram', { status: 'blood', diagnosis: 'RAM pressure', fixes: [{ title: 'Close apps', command: 'close-apps', danger: 'caution' }] })]),
    ...o,
  };
}

// a recording fake of the bits of window.hq these surfaces call; `log` is shared with
// the toast spy so the order "toast, then the reloading call" can be checked
function fakeHq(o = {}, log = []) {
  const calls = [];
  const or = (k, d) => (k in o ? o[k] : d);
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); log.push('call:' + name); return Promise.resolve().then(() => (typeof ret === 'function' ? ret(...args) : ret)); };
  return {
    calls, log,
    healthScan: rec('healthScan', or('healthScan', null)),
    healthFix: rec('healthFix', or('healthFix', { ok: true, output: 'done\n' })),
    captureSave: rec('captureSave', or('captureSave', true)),
    claudeQuest: rec('claudeQuest', or('claudeQuest', true)),
    archiveProject: rec('archiveProject', true),
    openRepo: rec('openRepo', ''),
    markQuestDone: rec('markQuestDone', true),
  };
}
function make(hq, state, data) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore(data || DATA(), hq === undefined ? fakeHq() : hq);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  if (hq && hq.log) { const toast = c.toast.bind(c); c.toast = (kind, text, opt) => { hq.log.push('toast:' + kind); return toast(kind, text, opt); }; }
  if (state) Object.assign(c.state, typeof state === 'function' ? state(c, store.model) : state);
  return c;
}
const sys = (sub) => ({ tab: 'system', sub: { system: sub } });
const page = (id) => ({ tab: 'projects', route: { type: 'project', id }, diagTab: 'git' });
const toasts = (c) => c.state.toasts.map((t) => t.kind + ' · ' + t.text);
const timers = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
const tick = () => new Promise((r) => setImmediate(r));
// fix the sub map: initState merges defaults, so set the one key the test needs
const vals = (c) => c.renderVals();
function at(c, patch) { c.state = { ...c.state, ...patch, sub: { ...c.state.sub, ...(patch.sub || {}) } }; return c; }

// ---- wiring ----------------------------------------------------------------------------------
test('the System/project mixins are on the Component; the fix sheet override wins over sheet.js', () => {
  for (const k of Object.keys(systemLogic)) assert.equal(Component.prototype[k], systemLogic[k], k);
  for (const k of Object.keys(projectLogic)) assert.equal(Component.prototype[k], projectLogic[k], k);
  // systemLogic.sheetOk only works when it is mixed in after sheetLogic (app.js)
  assert.equal(Component.prototype.sheetOk, systemLogic.sheetOk);
  assert.notEqual(Component.prototype.sheetOk, sheetLogic.sheetOk);
});

test('every added template element is marked for the designer', () => {
  for (const [tpl, needles] of [[systemTpl, ['{{ sysScanLabel }}', '{{ fixedNote }}', '{{ c.hasItems }}']], [pageTpl, ['{{ n.canDo }}', '{{ n.term }}', '{{ pg.hasGaps }}']]]) {
    for (const n of needles) {
      const i = tpl.indexOf(n);
      assert.ok(i > 0, n + ' bound');
      const before = tpl.slice(0, i), mark = before.lastIndexOf('<!-- v5:');
      assert.ok(mark >= 0 && before.slice(mark).split('\n').length <= 2, n + ' has a <!-- v5: --> right before its element');
    }
  }
});

// ---- P2 Re-examine -----------------------------------------------------------------------------
test('Re-examine: fresh report → store refreshed, fixed set cleared, truthful toast; "Scanning…" while it runs', async (t) => {
  timers(t);
  const report = pcHealth([organ('gpu', { status: 'ember', diagnosis: 'GPU hot', fixes: [] })], { at: '2026-10-05T09:00:00Z' });
  let release; const hq = fakeHq({ healthScan: () => new Promise((r) => { release = () => r(report); }) });
  const c = at(make(hq), { ...sys('machine'), fixed: ['organ-disk'] });
  let v = vals(c);
  assert.deepEqual([v.sysScanLabel, v.sysScanOff, v.sysScanTip], ['Re-examine', false, SCAN_TIP]);
  const run = v.sysScan();
  await tick();
  v = vals(c);
  assert.deepEqual([v.sysScanLabel, v.sysScanOff], ['Scanning…', true]);
  await c.reexamine();   // a second click while scanning does nothing
  assert.equal(hq.calls.filter((x) => x[0] === 'healthScan').length, 1);
  release(); await run;
  assert.equal(c.state.sysExamining, false);
  assert.deepEqual(c.state.fixed, []);
  assert.deepEqual(c.M.ISSUES.map((i) => i.id), ['organ-gpu']);
  assert.equal(c.LIVE.pcHealth, report);
  v = vals(c);
  assert.deepEqual(v.issues.map((i) => i.title), ['GPU hot']);
  assert.match(v.verdictSub, /^Re-examined /);
  assert.deepEqual(toasts(c), ['success · Re-examined · 1 issue to look at']);
});

test('Re-examine with a clean report that has no scanned_at: checked, not "Not checked yet"', async (t) => {
  timers(t);
  const c = at(make(fakeHq({ healthScan: { organs: [organ('cpu')] } })), sys('machine'));
  await c.reexamine();
  const v = vals(c);
  assert.deepEqual(toasts(c), ['success · Re-examined · nothing flagged']);
  assert.equal(v.verdict, 'Machine OK');
  assert.equal(v.verdictSub, 'Re-examined this session · drag the monitor to spin it');
  // with no report at all (no baked sidecar, no Re-examine) it stays unknown
  const none = at(make(fakeHq(), null, DATA({ pcHealth: undefined })), sys('machine'));
  assert.deepEqual([vals(none).verdict, vals(none).verdictSub], ['Not checked yet', 'No machine check yet · drag the monitor to spin it']);
});

test('Re-examine: {error}, null and a throw are reported; the baked report and the fixed set stay', async (t) => {
  timers(t);
  for (const [answer, text] of [[{ error: 'pc-health.mjs exited 1' }, 'pc-health.mjs exited 1'], [null, 'the scan returned no report'], [{ scanned_at: 'x' }, 'the scan returned no report'], [() => { throw new Error('no handler'); }, 'no handler']]) {
    const hq = fakeHq({ healthScan: answer });
    const c = at(make(hq), { ...sys('machine'), fixed: ['organ-disk'] });
    await c.reexamine();
    assert.deepEqual(toasts(c), ['error · Re-examine failed · ' + text]);
    assert.equal(c.LIVE.pcHealth, null, 'never refreshMachine(null) — that would silently fall back');
    assert.deepEqual(c.state.fixed, ['organ-disk']);
    assert.equal(c.state.sysExamining, false);
  }
});

test('Re-examine without the bridge: disabled with a reason, and a call is denied', async (t) => {
  timers(t);
  for (const c of [make(null, sys('machine')), make({ captureSave() {} }, sys('machine'))]) {
    at(c, sys('machine'));
    const v = vals(c);
    assert.deepEqual([v.sysScanOff, v.sysScanTip], [true, SCAN_OFF]);
    await c.reexamine();
    assert.ok(toasts(c).some((x) => x.startsWith('error · ' + SCAN_OFF)));
  }
});

// ---- P2 fixed issues ---------------------------------------------------------------------------
test('a safe fix that answers ok:true hides its issue until Re-examine; ok:false does not', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = at(make(hq), sys('machine'));
  let v = vals(c);
  assert.deepEqual(v.issues.map((i) => i.title), ['Disk filling up', 'RAM pressure']);
  assert.equal(v.hasFixed, false);
  await v.issues[0].run();
  assert.equal(c.state.sheet.issueId, 'organ-disk');
  assert.equal(c.state.sheet.act, 'fix');
  await c.sheetOk();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'healthFix'), [['healthFix', 'Clear-Temp']]);
  assert.deepEqual(c.state.fixed, ['organ-disk']);
  v = vals(c);
  assert.deepEqual(v.issues.map((i) => i.title), ['RAM pressure']);
  assert.deepEqual([v.hasFixed, v.fixedNote], [true, '1 fixed this session · Re-examine to confirm']);
  assert.ok(toasts(c).includes('success · Ran · done'));

  // a fix main refuses stays listed
  const hq2 = fakeHq({ healthFix: { ok: false, output: 'refused: not a whitelisted read-only fix' } });
  const c2 = at(make(hq2), sys('machine'));
  await vals(c2).issues[0].run();
  await c2.sheetOk();
  assert.deepEqual(c2.state.fixed || [], []);
  assert.ok(toasts(c2).includes('error · Didn’t run · refused: not a whitelisted read-only fix'));
});

test('with every issue fixed the verdict says it isn’t re-checked, not "Machine OK"', (t) => {
  timers(t);
  const c = at(make(fakeHq()), { ...sys('machine'), fixed: ['organ-disk', 'organ-ram'] });
  const v = vals(c);
  assert.equal(v.hasIssues, false);
  assert.equal(v.verdict, 'Fixes ran · not re-checked yet');
  assert.equal(v.fixedNote, '2 fixed this session · Re-examine to confirm');
  // a clutter id in the set (older state) is not counted as a fixed issue
  const c2 = at(make(fakeHq()), { ...sys('machine'), fixed: ['dup'] });
  assert.deepEqual([vals(c2).hasFixed, vals(c2).verdict], [false, '2 issues to look at']);
});

test('other sheets still go through sheet.js unchanged', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = make(hq);
  c.sheet({ act: 'archive', id: 'a', title: 'Archive?', body: '', ok: 'Archive', danger: true });
  await c.sheetOk();
  assert.equal(c.state.sheet, null);
  assert.ok(toasts(c).some((x) => x.startsWith('success · Archiving Project A')));
  // a fix sheet without an issue id (not from System) is sheet.js's too
  c.sheet({ act: 'fix', cmd: 'Clear-Temp', fixTitle: 'Clean temp', title: 'x', body: '', ok: 'Run fix' });
  await c.sheetOk();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'healthFix'), [['healthFix', 'Clear-Temp']]);
  assert.deepEqual(c.state.fixed || [], []);
});

// ---- P2 Note for cleanup ------------------------------------------------------------------------
test('clutter: one row per item, capped with a count; Note for cleanup toasts first, then captureSave', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = at(make(hq), sys('clutter'));
  let v = vals(c);
  const clones = v.clutter.find((g) => g.title === 'Reference clones');
  assert.equal(clones.items.length, 12);
  assert.deepEqual([clones.hasMore, clones.more], [true, '+2 more not listed']);
  assert.deepEqual([clones.items[0].label, clones.items[0].hasNote, clones.items[0].note], ['ref-lib-0', true, 'diverged from upstream']);
  assert.equal(clones.items[1].hasNote, false);
  const dup = v.clutter.find((g) => g.title === 'Duplicate folders');
  assert.deepEqual(dup.items.map((i) => [i.label, i.btn, i.off]), [['Folder "x-copy" mirrors "x"', 'Note for cleanup', false]]);
  for (const g of v.clutter) for (const it of g.items) assert.deepEqual([typeof it.hasNote, typeof it.off], ['boolean', 'boolean']);

  await dup.items[0].save();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'captureSave'), [['captureSave', 'Clean up: Folder "x-copy" mirrors "x"']]);
  assert.deepEqual(hq.log.slice(0, 2), ['toast:info', 'call:captureSave'], 'the toast goes out before the reloading call');
  assert.match(toasts(c)[0], /^info · Noting for cleanup · “Clean up: Folder "x-copy" mirrors "x"” · the window will refresh$/);
  v = vals(c);
  const after = v.clutter.find((g) => g.title === 'Duplicate folders').items[0];
  assert.deepEqual([after.btn, after.off], ['Noted', true]);
  await after.save();   // no second write
  assert.equal(hq.calls.filter((x) => x[0] === 'captureSave').length, 1);
});

test('Note for cleanup: false or a throw shows "✗ Not saved — retry" and can be retried', async (t) => {
  timers(t);
  for (const answer of [false, () => { throw new Error('disk full'); }]) {
    const hq = fakeHq({ captureSave: answer });
    const c = at(make(hq), sys('clutter'));
    const row = () => vals(c).clutter.find((g) => g.title === 'Empty folders').items[0];
    await row().save();
    assert.deepEqual([row().btn, row().off], ['✗ Not saved — retry', false]);
    assert.ok(toasts(c).some((x) => x.startsWith('error · Not saved · ' + (answer === false ? 'the note was refused' : 'disk full'))));
    await row().save();
    assert.equal(hq.calls.filter((x) => x[0] === 'captureSave').length, 2, 'retry sends again');
  }
});

test('Note for cleanup without the bridge or in the past is disabled with the reason', async (t) => {
  timers(t);
  const c = at(make(null), sys('clutter'));
  const it = vals(c).clutter[0].items[0];
  assert.deepEqual([it.off, it.tip], [true, CAPTURE_OFF]);
  const past = at(make(fakeHq()), { ...sys('clutter'), snapOffset: 1 });
  const p = vals(past).clutter[0].items[0];
  assert.equal(p.off, true);
  assert.match(p.tip, /^Read-only · viewing /);
});

// ---- P3 project page -----------------------------------------------------------------------------
test('Next: tasks, then the project’s own side quests and captured notes, then the suggestions no side quest has — each text once', (t) => {
  timers(t);
  const pg = vals(at(make(fakeHq()), page('a'))).pg;
  assert.deepEqual(pg.next.map((n) => [n.kind, n.title, n.ai, n.canDo, n.terminal]), [
    ['Important', 'Write the docs for Project A', false, true, false],
    ['Idea', 'Write a README', false, true, true],
    ['Urgent', 'Commit the dirty files today', true, true, true],
    ['Risk', 'Many dirty files for days', true, true, true],
    ['Idea', 'Project A: set up CI', false, true, true],
    ['Idea', 'Split the router', true, false, true],
  ]);
  assert.equal(pg.nextCount, 6);
  const by = (title) => pg.next.find((n) => n.title === title);
  assert.equal(by('Split the router').why, 'effort M · impact medium · suggested at scan time · unverified');
  assert.equal(by('Many dirty files for days').why, 'at project-a/ · effort S · impact medium · suggested by AI, unverified');
  assert.equal(by('Write a README').why, 'No README — capture what this is and how to run it. · effort S · impact medium · from scan rules');
  assert.equal(by('Project A: set up CI').why, 'effort S · impact medium · your captured note');
  for (const n of pg.next) for (const k of ['ai', 'inProgress', 'canDo', 'terminal', 'canDismiss']) assert.equal(typeof n[k], 'boolean', k);
});

test('Next: a dismissed or completed side quest drops out, and its suggestion text does not come back', (t) => {
  timers(t);
  const pg = vals(at(make(fakeHq()), { ...page('a'), dismissed: ['sq-a-llm-sug-0'], completed: ['sq-a-readme'] })).pg;
  const titles = pg.next.map((n) => n.title);
  assert.ok(!titles.includes('Commit the dirty files today'));
  assert.ok(!titles.includes('Commit the dirty files today.'), 'the suggestion copy stays hidden');
  assert.ok(!titles.includes('Write a README'));
});

test('Next actions: Do it marks the side quest done, ⚡ opens Claude in a terminal with "title — detail"', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = at(make(hq), page('a'));
  const by = (title) => vals(c).pg.next.find((n) => n.title === title);
  await by('Many dirty files for days').term();
  await by('Project A: set up CI').term();
  await by('Split the router').term();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'claudeQuest'), [
    ['claudeQuest', 'C:/dev/a', 'Many dirty files for days — at project-a/'],
    ['claudeQuest', 'C:/dev/a', 'Project A: set up CI'],
    ['claudeQuest', 'C:/dev/a', 'Split the router'],
  ]);
  assert.ok(toasts(c).includes('info · Opened interactive Claude in a terminal · Project A · uses Claude quota'));
  by('Write a README').doIt();
  c.flushPending();
  assert.ok(hq.calls.some((x) => x[0] === 'markQuestDone' && x[1] === 'sq-a-readme'));

  const refused = make(fakeHq({ claudeQuest: false }));
  await refused.questTerminal({ title: 'X' }, refused.proj('a'));
  assert.deepEqual(toasts(refused), ['error · Couldn’t open a terminal · Project A’s folder wasn’t accepted']);
});

test('Add to ideas: one row per missing basic no side quest or captured note already proposes', async (t) => {
  timers(t);
  const hq = fakeHq();
  const c = at(make(hq), page('a'));
  let pg = vals(c).pg;
  // README: the collector's sq-a-readme proposes it · CI: the captured note has the same text
  assert.deepEqual(pg.gaps.map((g) => [g.label, g.text, g.btn, g.off]), [['No tests', 'Project A: add a test suite', 'Add to ideas', false], ['No license', 'Project A: add a LICENSE', 'Add to ideas', false]]);
  assert.equal(pg.hasGaps, true);
  await pg.gaps[1].add();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'captureSave'), [['captureSave', 'Project A: add a LICENSE']]);
  assert.deepEqual(hq.log.slice(0, 2), ['toast:info', 'call:captureSave']);
  pg = vals(c).pg;
  assert.deepEqual([pg.gaps[1].btn, pg.gaps[1].off], ['Noted', true]);
  // no explicit false → no rows
  const b = vals(at(make(fakeHq()), page('b'))).pg;
  assert.deepEqual([b.gaps, b.hasGaps], [[], false]);
  // in the past: listed, disabled
  const past = vals(at(make(fakeHq()), { ...page('a'), snapOffset: 1 })).pg;
  assert.ok(past.gaps.length > 0 && past.gaps.every((g) => g.off));
});

test('Diagnostics: git risk level in Git; every risk flag (type · detail · location) in Security', (t) => {
  timers(t);
  const c = at(make(fakeHq()), page('a'));
  const git = vals(c).pg.diag;
  assert.deepEqual(git[git.length - 1], { k: 'Git risk', v: 'high · from scan rules', color: 'var(--red)', est: false });
  c.state.diagTab = 'security';
  const sec = vals(c).pg.diag.map((d) => [d.k, d.v, d.color]);
  assert.deepEqual(sec.slice(3), [
    ['Uncommitted work', 'Many dirty files for days · project-a/', 'var(--orange)'],
    ['Hardcoded secret', 'Token in source · src/x.js:4', 'var(--red)'],
    ['No remote', 'No remote, so nothing is backed up', 'var(--text)'],
    ['Flags', 'security flags: AI review at scan time, unverified · git flags: scan rules', 'var(--faint)'],
  ]);
  const bc = at(make(fakeHq()), { ...page('b'), diagTab: 'security' });
  assert.deepEqual(vals(bc).pg.diag.slice(-1).map((d) => [d.k, d.v]), [['Flags', 'none in this snapshot']]);
  bc.state.diagTab = 'git';
  assert.deepEqual(vals(bc).pg.diag.slice(-1).map((d) => [d.k, d.v, d.color]), [['Git risk', 'not rated in this snapshot', 'var(--muted)']]);
});
