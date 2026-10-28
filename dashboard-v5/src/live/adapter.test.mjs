// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, toTask, toIdea, snapshot, metric, weeks, automations, exitLabel, machine, clutter, sites, gapsOf, GAPS, devPort, dayOf, fmtD, sessions, fileUrl, normPath, projectForCwd, riskFlags } from './adapter.mjs';
import { proj, scan, spell, spellbook, telemetry } from './__fixtures__/synthetic.mjs';

test('toProject maps git, risk, activity and keeps estimates as-is', () => {
  const p = toProject(proj('a', { dirty: 12, ahead: 2, secrets: 1, branch: 'dev', dev: 'npm run dev -- --port 5173', pct: 62 }));
  assert.equal(p.dirty, 12); assert.equal(p.ahead, 2); assert.equal(p.secrets, 1); assert.equal(p.secretWhere, '.env:3');
  assert.equal(p.branch, 'dev'); assert.equal(p.canonical, 'main'); assert.equal(p.port, 5173); assert.equal(p.pct, 62);
  assert.equal(p.tests, '3 test files (not run)');
});

test('a project without git reports unknown dirt, not zero', () => {
  const p = toProject(proj('c', { git: false, dirty: 0 }));
  assert.equal(p.hasGit, false); assert.equal(p.dirty, null); assert.equal(p.branch, '—');
});

test('devPort reads the last 4–5 digit number, else null', () => {
  assert.equal(devPort('python -m http.server 5500 --directory site'), 5500);
  assert.equal(devPort('npm run dev'), null);
  assert.equal(devPort(null), null);
});

test('tasks: done quests leave the board; commit quests are flagged', () => {
  const s = snapshot(scan('2026-10-03', [proj('a')], { quests: [
    { id: 'q-a-commit-dirty', status: 'open', tier: 'red', title: 'Commit A', xp: 100, project_id: 'a', age_days: 3, insight: '12 files at risk' },
    { id: 'q-a-push', status: 'done', tier: 'orange', title: 'Push A', xp: 60, project_id: 'a' },
  ] }));
  assert.equal(s.T0.length, 1);
  assert.deepEqual(s.T0[0], { id: 'q-a-commit-dirty', tier: 'red', title: 'Commit A', why: '12 files at risk', proj: 'a', age: 3, xp: 100, commitTask: true, inProgress: false });
  assert.equal(s.doneTasks.length, 1);
});

test('ideas keep the AI flag and purge size; done/dismissed drop out', () => {
  const s = snapshot(scan('2026-10-03', [proj('a')], { side: [
    { id: 's1', kind: 'risk', title: 'Rotate', source: 'deterministic', project_id: 'a' },
    { id: 's2', kind: 'idea', title: 'Split', source: 'llm', project_id: 'a' },
    { id: 's3', kind: 'idea', title: 'Purge', source: 'deterministic', project_id: 'a', reclaim_bytes: 1.2e9 },
    { id: 's4', kind: 'idea', title: 'Old', done: true },
  ] }));
  assert.deepEqual(s.IDEAS.map((i) => [i.id, i.ai, i.purge]), [['s1', false, null], ['s2', true, null], ['s3', false, '1.2 GB']]);
  assert.equal(s.IDEAS[0].projName, 'Project A');
  assert.equal(toIdea({ id: 'x', source: 'capture' }).projName, 'Inbox');
});

test('milestones always list the full catalog, merged with scan progress', () => {
  const s = snapshot(scan('2026-10-03', [], { ach: [{ id: 'liftoff', unlocked: true }, { id: 'scribe', progress: { have: 3, need: 30 } }] }));
  assert.equal(s.ACH.length, 22);
  assert.equal(s.ACH.find((a) => a.id === 'liftoff').unlocked, true);
  assert.deepEqual([s.ACH.find((a) => a.id === 'scribe').have, s.ACH.find((a) => a.id === 'scribe').need], [3, 30]);
});

test('metrics: commits per scan is a delta of commit counts, never negative', () => {
  const a = snapshot(scan('2026-10-02', [proj('a', { commits: 10, dirty: 3 }), proj('b', { commits: 5 })]));
  const b = snapshot(scan('2026-10-03', [proj('a', { commits: 13, dirty: 1 }), proj('b', { commits: 4 })]));
  assert.equal(metric(b, 'commits', a), 3);
  assert.equal(metric(b, 'commits', null), 0);
  assert.equal(metric(b, 'unc'), 1);
});

test('weeks group changes Monday-first, newest week first, with quiet scans counted', () => {
  const s1 = snapshot(scan('2026-09-29', [], { xp: 100, changes: [{ type: 'quest_completed', detail: 'Did X', project_id: 'a' }] }));
  const s2 = snapshot(scan('2026-09-30', [], { xp: 160 }));
  const s3 = snapshot(scan('2026-10-06', [], { xp: 200, changes: [{ type: 'new_achievement', name: 'Liftoff' }] }));
  const w = weeks([s1, s2, s3]);
  assert.equal(w.length, 2);
  assert.equal(w[0].w, 'Oct 5 – 11');   // Oct 6 2026 is a Tuesday
  assert.match(w[1].stats, /\+60 xp · 1 task/);
  assert.equal(w[1].quiet, 1);
});

test('automations: castable + chain only, last run from telemetry, library counts', () => {
  const sb = { counts: { total: 3, by_source: { skill: 1, grimoire: 1, npm: 1 }, familiars: 2 }, spells: [
    { id: 'skill:x', name: 'X', kind: 'channeled', source: 'skill' },
    { id: 'grimoire:scan', name: 'Deep scan', kind: 'castable', source: 'grimoire', command: 'node', args: ['scan.mjs'], school: 'divination', confirm: true, content_hash: 'h1' },
    { id: 'npm:test', name: 'test', kind: 'castable', source: 'npm', command: 'npm', args: ['test'], school: 'restoration' },
  ] };
  const tel = { casts: [{ cast_id: 'c1', spell_id: 'grimoire:scan', started_at: '2026-10-03T10:00:00Z', outcome: 'fizzled', exit_code: 1, duration_ms: 5000 }] };
  const r = automations(sb, tel, Date.parse('2026-10-03T12:00:00Z'));
  assert.deepEqual(r.AUTOS.map((a) => a.id), ['grimoire:scan', 'npm:test']);
  assert.deepEqual(r.AUTOS[0].last, { ok: false, ago: '2h ago', err: 'exit 1' });
  assert.equal(r.AUTOS[0].cat, 'Analyze'); assert.equal(r.AUTOS[0].destructive, true); assert.equal(r.AUTOS[0].cmd, 'node scan.mjs');
  assert.deepEqual(r.LIBRARY.find((l) => l[0] === 'Claude skills'), ['Claude skills', 1, 0]);
  assert.deepEqual(r.LIBRARY.at(-1), ['MCP servers', 2, 0]);
  assert.equal(r.RUNS[0].status, 'failed');
});

test('machine: organs become vitals; only warn/bad organs become issues', () => {
  const m = machine({ organs: [
    { id: 'cpu', label: 'CPU', value: 18, unit: '%', status: 'grace' },
    { id: 'disk', label: 'Storage', value: 9, unit: 'GB free', status: 'blood', diagnosis: 'C: nearly full', fixes: [{ title: 'Clean temp', command: 'cleanmgr', danger: 'safe' }] },
  ] });
  assert.deepEqual(m.VITALS, [['CPU', '18 %', 'ok'], ['Storage', '9 GB free', 'bad']]);
  assert.equal(m.ISSUES.length, 1); assert.equal(m.ISSUES[0].safe, true); assert.equal(m.ISSUES[0].sev, 'red');
  const { DETAIL, ...rest } = machine(null);
  assert.deepEqual(rest, { VITALS: [], ISSUES: [], scannedAt: null, host: {} });
  assert.deepEqual(DETAIL.ram, []); // an absent sidecar still yields empty panels
});

test('clutter and sites degrade to empty on missing blocks', () => {
  assert.deepEqual(clutter({}), []);
  assert.equal(clutter({ empty: ['x', 'y'] })[0].detail, '2 empty folders · x, y');
  assert.deepEqual(sites(null), []);
  assert.deepEqual(sites({ by_domain: [{ domain: 'a.dev', focus_ms: 120000 }, { domain: 'b.com', focus_ms: 60000 }], by_project: [{ domains: ['a.dev'] }] }), [['a.dev', 2, 'Project'], ['b.com', 1, 'Other']]);
});

test('dates: scan ids are local days; sessions map cleanly', () => {
  assert.equal(fmtD(dayOf('2026-10-03')), 'Oct 3');
  assert.equal(sessions([{ jobId: 'j', label: 'Fix', status: 'ended', exitCode: 1, startedAt: 0, tail: 'a\nb' }])[0].status, 'failed');
});

// ---- clean pass F7: new fields ----------------------------------------------------

test('tasks: in-progress quests stay on the board, flagged; done/dismissed do not', () => {
  const s = snapshot(scan('2026-10-03', [proj('a')], { quests: [
    { id: 'q-a-open', status: 'open', tier: 'orange', title: 'Open', project_id: 'a' },
    { id: 'q-a-wip', status: 'in_progress', tier: 'red', title: 'Doing', project_id: 'a' },
    { id: 'q-a-done', status: 'done', title: 'Done', project_id: 'a' },
    { id: 'q-a-gone', status: 'dismissed', title: 'Gone', project_id: 'a' },
  ] }));
  assert.deepEqual(s.T0.map((t) => [t.id, t.inProgress]), [['q-a-open', false], ['q-a-wip', true]]);
  assert.deepEqual(s.doneTasks.map((t) => t.id), ['q-a-done']);
  assert.equal(metric(s, 'tasks'), 2);
  assert.equal(toTask({ id: 'x' }).inProgress, false);
});

test('toProject: suggestions keep kind/effort/impact; untexted ones drop; unknown kind is blank', () => {
  const p = toProject(proj('a', { suggestions: [
    { text: 'Add a README', kind: 'quick_win', effort: 'S', impact: 'medium', linked_quest_id: null },
    { text: 'Split the router', effort: 'L', impact: 'high' },
    { kind: 'hygiene', effort: 'S', impact: 'low' },
  ] }));
  assert.deepEqual(p.suggestions, [
    { kind: 'quick_win', text: 'Add a README', effort: 'S', impact: 'medium' },
    { kind: '', text: 'Split the router', effort: 'L', impact: 'high' },
  ]);
  assert.deepEqual(toProject(proj('b')).suggestions, []);
});

test('toProject: riskFlags lists every security flag plus git flags as info', () => {
  const p = toProject(proj('a', {
    riskFlags: [
      { type: 'hardcoded_secret', severity: 'high', detail: 'Token in source', location: 'src/x.js:4' },
      { type: 'missing_auth', severity: 'medium', detail: 'Admin route has no auth' },
    ],
    gitFlags: ['no-remote', 'many-dirty', 'odd_new-flag'],
  }));
  assert.deepEqual(p.riskFlags, [
    { type: 'hardcoded_secret', severity: 'high', detail: 'Token in source', location: 'src/x.js:4' },
    { type: 'missing_auth', severity: 'medium', detail: 'Admin route has no auth', location: '' },
    { type: 'no-remote', severity: 'info', detail: 'No remote, so nothing is backed up', location: '' },
    { type: 'many-dirty', severity: 'info', detail: 'Many uncommitted files', location: '' },
    { type: 'odd_new-flag', severity: 'info', detail: 'odd new flag', location: '' },
  ]);
  // the secret flag is listed too, and still feeds secretWhere
  const b = toProject(proj('b', { secrets: 1 }));
  assert.deepEqual([b.riskFlags[0].type, b.secretWhere], ['secret', '.env:3']);
  assert.deepEqual(riskFlags(null), []);
  assert.deepEqual(riskFlags({ risk_security: { flags: [null, 'x', {}] }, git_safety: { flags: [null, 3, ''] } }), []);
});

test('toProject: own side quests via toIdea (open only, project filled in) and gitRisk', () => {
  const p = toProject(proj('a', { gitRisk: 'high', side: [
    { id: 'sq1', kind: 'risk', title: 'Rotate key', source: 'deterministic', effort: 'S', impact: 'high' },
    { id: 'sq2', kind: 'idea', title: 'Add tests', source: 'llm', project_id: 'a', project_name: 'Project A' },
    { id: 'sq3', kind: 'idea', title: 'Old', done: true },
    { id: 'sq4', kind: 'idea', title: 'Nope', dismissed: true },
  ] }));
  assert.deepEqual(p.sideQuests.map((i) => [i.id, i.kind, i.proj, i.projName, i.ai]), [['sq1', 'risk', 'a', 'Project A', false], ['sq2', 'idea', 'a', 'Project A', true]]);
  assert.equal(p.sideQuests[0].effort, 'S');
  assert.equal(p.gitRisk, 'high');
  assert.equal(toProject(proj('b')).gitRisk, null);
  assert.equal(toProject(proj('c', { gitRisk: 'extreme' })).gitRisk, null);
  assert.deepEqual(toProject(proj('d')).sideQuests, []);
  // archived projects go through toProject too
  assert.equal(snapshot(scan('2026-10-03', [], { archived: [proj('z', { gitRisk: 'low' })] })).archived[0].gitRisk, 'low');
});

test('sessions: cwd maps to a project by normalized, case-insensitive path; deepest wins', () => {
  const P = [
    { id: 'a', path: 'C:\\dev\\project-a' },
    { id: 'a-web', path: 'C:/dev/project-a/web/' },
    { id: 'ab', path: 'C:/dev/project-ab' },
    { id: 'none', path: '' },
  ];
  const map = (cwd, extra = {}) => sessions([{ jobId: 'j', label: 'x', status: 'running', startedAt: 0, cwd, ...extra }], P)[0].proj;
  assert.equal(map('C:\\dev\\project-a'), 'a');                 // equal
  assert.equal(map('c:/DEV/Project-A/'), 'a');                  // case + trailing slash
  assert.equal(map('C:\\dev\\project-a\\src\\lib'), 'a');       // inside
  assert.equal(map('C:\\dev\\project-a\\web\\pages'), 'a-web'); // nested project wins
  assert.equal(map('C:\\dev\\project-ab\\x'), 'ab');            // a sibling prefix is not "inside"
  assert.equal(map('C:\\dev\\project-abc'), null);
  assert.equal(map('D:\\elsewhere'), null);
  assert.equal(map(undefined), null);
  assert.equal(map('C:\\dev\\project-a', { projectId: 'explicit' }), 'explicit');
  assert.equal(sessions([{ jobId: 'j', cwd: 'C:\\dev\\project-a' }], P)[0].cwd, 'C:\\dev\\project-a');
  // projects omitted: everything else still maps, proj just stays null
  const s = sessions([{ jobId: 'j', label: 'Fix', status: 'running', startedAt: 0, cwd: 'C:\\dev\\project-a' }]);
  assert.deepEqual([s[0].proj, s[0].status, s[0].title], [null, 'running', 'Fix']);
  assert.equal(normPath('C:\\A\\b\\\\'), 'c:/a/b');
  assert.equal(projectForCwd('C:/dev/project-a/x', null), null);
});

// Regression (review): newer scans store project paths relative to the scan root
// ("project-a", "work/project-c") while session cwds stay absolute, so the
// absolute-only containment check mapped every real session to "Workspace".
test('sessions: relative project paths (newer scans) match an absolute cwd as whole trailing segments', () => {
  const P = [
    { id: 'a', path: 'project-a' },
    { id: 'a-web', path: 'project-a/web' },
    { id: 'ab', path: 'Project-AB\\' },
    { id: 'c', path: 'work\\project-c' },
    { id: 'b', path: './project-b' },
    { id: 'dot', path: '.' },
    { id: 'up', path: '../outside' },
  ];
  const map = (cwd) => projectForCwd(cwd, P);
  assert.equal(map('C:\\Users\\me\\Docs\\project-a'), 'a');              // the folder itself
  assert.equal(map('c:/users/me/docs/PROJECT-A/src/lib/'), 'a');         // inside, any case, trailing slash
  assert.equal(map('C:\\Users\\me\\Docs\\project-a\\web\\pages'), 'a-web'); // nested project: deepest wins
  assert.equal(map('C:\\Users\\me\\Docs\\project-ab'), 'ab');            // whole segments only…
  assert.equal(map('C:\\Users\\me\\Docs\\project-abc'), null);           // …never a name prefix
  assert.equal(map('C:\\Users\\me\\Docs\\my-project-a'), null);          // …nor a name suffix
  assert.equal(map('C:\\Users\\me\\Docs\\work\\project-c\\x'), 'c');      // multi-segment relative root
  assert.equal(map('C:\\Users\\me\\Docs\\project-c'), null);             // needs the whole relative path
  assert.equal(map('C:\\Users\\me\\Docs\\project-b'), 'b');              // ./ prefix ignored
  assert.equal(map('C:\\Users\\me\\Docs\\project-b\\vendor\\project-a'), 'b');   // the outer project, not a copy inside it
  assert.equal(map('project-a'), 'a');                                    // a relative cwd still matches
  assert.equal(map('C:\\Users\\me\\Docs'), null);                         // '.' and '../' roots never match
  // an absolute root beats a relative one when a list mixes both (old + new scans)
  assert.equal(projectForCwd('C:/dev/project-a/x', [{ id: 'rel', path: 'project-a' }, { id: 'abs', path: 'C:\\dev\\project-a' }]), 'abs');
  assert.equal(sessions([{ jobId: 'j', cwd: 'C:\\Users\\me\\Docs\\project-a\\src' }], snapshot(scan('2026-10-05', [proj('a', { path: 'project-a' })])).P0)[0].proj, 'a');
});

test('sessions: the snapshot P0 shape (toProject output) is accepted as projects', () => {
  const s = snapshot(scan('2026-10-03', [proj('a', { path: 'C:\\dev\\project-a' })]));
  assert.equal(sessions([{ jobId: 'j', cwd: 'c:/dev/project-a/sub' }], s.P0)[0].proj, 'a');
});

test('automations: AUTOS unchanged; channeled spells become INTERACTIVE terminal rows with counts', () => {
  const sb = spellbook([
    spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'], cwd: 'C:/dev/a', school: 'divination', desc: 'Reviews the diff', hash: 'hs' }),
    spell('npm:a:dev', { name: 'Project A · dev', kind: 'channeled', source: 'npm', command: 'cmd', args: ['/c', 'npm', 'run', 'dev'] }),
    spell('skill:broken', { kind: 'channeled', source: 'skill', invalid: true }),
    spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire', school: 'divination' }),
    spell('npm:a:test', { name: 'Project A · test', source: 'npm', command: 'npm', args: ['test'] }),
    spell('tome:x', { kind: 'tome', source: 'plugin' }),
  ], { bySource: { skill: 2, npm: 2, grimoire: 1, plugin: 1 } });
  const tel = telemetry([
    { cast_id: 'c1', spell_id: 'skill:review', started_at: '2026-10-03T11:00:00Z', outcome: 'channeled' },
    { cast_id: 'c2', spell_id: 'npm:a:dev', started_at: '2026-10-03T09:00:00Z', outcome: 'fizzled', exit_code: 2 },
  ]);
  const r = automations(sb, tel, Date.parse('2026-10-03T12:00:00Z'));
  assert.deepEqual(r.AUTOS.map((a) => a.id), ['grimoire:scan', 'npm:a:test']);
  assert.deepEqual(r.AUTOS[0], { id: 'grimoire:scan', icon: '▶', name: 'Deep scan', source: 'grimoire', kind: 'grimoire', mode: 'bg', cmd: 'node', dir: 'C:/dev/a', last: null, desc: '', cat: 'Analyze', steps: undefined, destructive: false, hash: 'h-grimoire:scan', favorite: false });
  assert.deepEqual(r.INTERACTIVE.map((a) => a.id), ['npm:a:dev', 'skill:review']);   // same source order as AUTOS
  assert.deepEqual(r.INTERACTIVE[1], {
    id: 'skill:review', icon: '›_', name: 'Review', source: 'skill', kind: 'interactive', mode: 'terminal',
    // honesty-2: a channeled cast only opened a terminal (no exit code comes back): opened, never "finished"
    cmd: 'claude /review', dir: 'C:/dev/a', last: { ok: true, opened: true, ago: '1h ago', err: '' }, desc: 'Reviews the diff', cat: 'Analyze', hash: 'hs',
  });
  assert.deepEqual(r.INTERACTIVE[0].last, { ok: false, opened: false, ago: '3h ago', err: 'exit 2' });
  assert.equal(r.INTERACTIVE[0].cmd, 'cmd /c npm run dev');
  assert.deepEqual(r.counts, { runnable: 2, interactive: 2, bySource: { grimoire: { runnable: 1, interactive: 0 }, npm: { runnable: 1, interactive: 1 }, skill: { runnable: 0, interactive: 1 } } });
  // LIBRARY's runnable column still counts castable + chain only (UI unchanged until C7)
  assert.deepEqual(r.LIBRARY.find((l) => l[0] === 'Claude skills'), ['Claude skills', 2, 0]);
  assert.deepEqual(r.LIBRARY.find((l) => l[0] === 'npm scripts'), ['npm scripts', 2, 1]);
  assert.deepEqual(automations(null, null).INTERACTIVE, []);
  assert.deepEqual(automations(null, null).counts, { runnable: 0, interactive: 0, bySource: {} });
});

test('exitLabel: a number reads "exit N"; null / missing / not a number reads "exit code unknown"', () => {
  assert.equal(exitLabel(0), 'exit 0');
  assert.equal(exitLabel(2), 'exit 2');
  assert.equal(exitLabel(-1), 'exit -1');
  for (const x of [null, undefined, NaN, '1', Infinity]) assert.equal(exitLabel(x), 'exit code unknown', String(x));
});

test('automations: a failed cast with no exit code or duration never reads "exit ?" or starts with " · "', () => {
  const sb = spellbook([
    spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire' }),
    spell('script:chain', { name: 'Chain', source: 'script', kind: 'chain' }),
    spell('npm:a:dev', { name: 'a · dev', kind: 'channeled', source: 'npm' }),
  ]);
  const tel = telemetry([
    { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: '2026-10-03T10:00:00Z', outcome: 'fizzled' },                                      // older telemetry: no code, no duration
    { cast_id: 'c2', spell_id: 'script:chain', started_at: '2026-10-03T10:30:00Z', outcome: 'fizzled', exit_code: null, duration_ms: 4000 },   // a chain: main records null
    { cast_id: 'c3', spell_id: 'npm:a:dev', started_at: '2026-10-03T11:00:00Z', outcome: 'fizzled', exit_code: null },
    { cast_id: 'c4', spell_id: 'grimoire:scan', started_at: '2026-10-03T11:30:00Z', outcome: 'fizzled', exit_code: 1, duration_ms: 2000 },
    { cast_id: 'c5', spell_id: 'npm:a:dev', started_at: '2026-10-03T11:45:00Z', outcome: 'channeled' },
  ]);
  const r = automations(sb, tel, Date.parse('2026-10-03T12:00:00Z'));
  assert.equal(r.AUTOS.find((a) => a.id === 'script:chain').last.err, 'exit code unknown');
  assert.equal(r.AUTOS.find((a) => a.id === 'grimoire:scan').last.err, 'exit 1');   // the newest cast wins
  const t3 = automations(sb, telemetry([tel.casts[2]]), Date.parse('2026-10-03T12:00:00Z'));
  assert.equal(t3.INTERACTIVE[0].last.err, 'exit code unknown');
  assert.deepEqual(r.RUNS.map((x) => [x.id, x.meta]), [['c5', 'Opened in a terminal'], ['c4', '2s · exit 1'], ['c3', 'exit code unknown'], ['c2', '4s · exit code unknown'], ['c1', 'exit code unknown']]);
  for (const x of r.RUNS) assert.doesNotMatch(x.meta, /^\s*·|exit (\?|null|undefined)/, x.id);
});

test('fileUrl: drive kept, segments encoded, UNC and POSIX handled, relative refused', () => {
  assert.equal(fileUrl('C:\\Users\\x\\a b.png'), 'file:///C:/Users/x/a%20b.png');
  assert.equal(fileUrl('C:/Users/x/a b.png'), 'file:///C:/Users/x/a%20b.png');
  assert.equal(fileUrl('d:\\shots\\#1 50%?.png'), 'file:///d:/shots/%231%2050%25%3F.png');
  assert.equal(fileUrl('C:\\dev\\project-a\\\\deep\\'), 'file:///C:/dev/project-a/deep');
  assert.equal(fileUrl('C:\\'), 'file:///C:/');
  assert.equal(fileUrl('\\\\host\\share\\a b.mp4'), 'file://host/share/a%20b.mp4');
  assert.equal(fileUrl('/home/user/a b.png'), 'file:///home/user/a%20b.png');
  assert.equal(fileUrl('relative\\a.png'), '');
  assert.equal(fileUrl('C:relative.png'), '');
  assert.equal(fileUrl(''), '');
  assert.equal(fileUrl(null), '');
});

// ---- clean pass Phase 3 (P3-SYSPROJ): signals, gaps, clutter rows, canvas boards, recovered ----

test('toProject keeps the scan signals (primitives only) and the closed side-quest titles', () => {
  const p = toProject(proj('a', {
    signals: { has_tests: false, has_ci: true, has_readme: false, test_files: 0, build_script: null, nested: { x: 1 } },
    side: [{ id: 'sq1', title: 'Open one' }, { id: 'sq2', title: 'Done one', done: true }, { id: 'sq3', title: 'Gone one', dismissed: true }, { id: 'sq4', done: true }],
  }));
  assert.deepEqual(p.signals, { has_tests: false, has_ci: true, has_readme: false, test_files: 0, build_script: null });
  assert.deepEqual(p.closedSideQuests, ['Done one', 'Gone one']);
  assert.deepEqual(toProject(proj('b')).signals, {});
  assert.deepEqual(toProject(proj('b')).closedSideQuests, []);
  assert.deepEqual(toProject({ signals: 'junk' }).signals, {});
});

test('gapsOf: one row per explicitly-false signal, v3 capture text, the collector’s quest id', () => {
  const p = toProject(proj('a', { signals: { has_tests: false, has_ci: false, has_readme: false, has_license: false } }));
  assert.deepEqual(gapsOf(p).map((g) => [g.label, g.text, g.quest]), [
    ['No tests', 'Project A: add a test suite', 'sq-a-tests'],
    ['No CI', 'Project A: set up CI', 'sq-a-ci'],
    ['No README', 'Project A: write a README', 'sq-a-readme'],
    ['No license', 'Project A: add a LICENSE', 'sq-a-license'],
  ]);
  // a missing or non-false signal is not a gap
  assert.deepEqual(gapsOf(toProject(proj('b', { signals: { has_tests: true, has_ci: null, has_readme: 0 } }))), []);
  assert.deepEqual(gapsOf(toProject(proj('c'))), []);
  assert.deepEqual(gapsOf(null), []);
  assert.deepEqual(GAPS.map((g) => g.flag), ['has_tests', 'has_ci', 'has_readme', 'has_license']);
});

test('clutter rows: one labelled row per item, named the way v3 named them', () => {
  const c = clutter({
    duplicates: [{ type: 'twin', detail: 'Folder "x-copy" mirrors "x"', severity: 'warning' }, { type: 'twin' }],
    empty: ['old-folder', { name: 'named-empty' }, '  '],
    clones: [{ name: 'some-lib', origin: 'example.org/some-lib', diverged: true }, { origin: 'example.org/other' }],
    trivial: [{ name: 'scratch', note: '2 files' }],
  });
  const rows = Object.fromEntries(c.map((g) => [g.id, g.rows.map((r) => [r.label, r.note])]));
  assert.deepEqual(rows.dup, [['Folder "x-copy" mirrors "x"', '']]);
  assert.deepEqual(rows.empty, [['old-folder', ''], ['named-empty', '']]);
  assert.deepEqual(rows.clones, [['some-lib', 'diverged from upstream'], ['example.org/other', '']]);
  assert.deepEqual(rows.trivial, [['scratch', '2 files']]);
  // row ids are unique and stable per position; the group summary is unchanged
  assert.deepEqual(c.find((g) => g.id === 'empty').rows.map((r) => r.id), ['empty:0', 'empty:1']);
  assert.equal(c.find((g) => g.id === 'empty').detail, '3 empty folders · old-folder, named-empty, ?');
});

// append to dashboard-v5/src/live/adapter.test.mjs
import { snippetParts, fmtTokens, hubConv, hubThread, hubHit, hubStats } from './adapter.mjs';
test('snippetParts: markers stripped, unbalanced markers never swallow text, markup stays text', () => {
  assert.deepEqual(snippetParts('a \u0002rel\u0003 b'), [{ text: 'a ', hit: false }, { text: 'rel', hit: true }, { text: ' b', hit: false }]);
  assert.deepEqual(snippetParts('x \u0002open to the end'), [{ text: 'x ', hit: false }, { text: 'open to the end', hit: true }]);
  assert.deepEqual(snippetParts('stray\u0003 close'), [{ text: 'stray close', hit: false }]);
  const evil = snippetParts('\u0002<img src=x onerror=alert(1)>\u0003<script>');
  assert.equal(evil.map((p) => p.text).join(''), '<img src=x onerror=alert(1)><script>');
  assert.deepEqual(snippetParts(''), []); assert.deepEqual(snippetParts(null), []);
});
test('fmtTokens: unknown is null, not zero', () => {
  assert.equal(fmtTokens(null), null); assert.equal(fmtTokens(0), '0'); assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(12345), '12.3k'); assert.equal(fmtTokens(4100000), '4.1M');
});
test('hubConv / hubThread / hubHit / hubStats map the Hub rows', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const row = { id: 'code:s', source: 'code', title: null, project_name: 'project-a', project_id: 'code:p', hq_project_id: 'project-a', last_at: '2026-10-04T10:00:00.000Z', message_count: 3, tokens_in: 10, tokens_out: 20, tokens_cache_read: null, tokens_cache_write: null };
  const c = hubConv(row, now);
  assert.equal(c.title, 'Untitled chat'); assert.equal(c.tokens, '30'); assert.deepEqual(c.cursor, { before: row.last_at, beforeId: 'code:s' });
  assert.equal(hubConv({ ...row, tokens_in: null, tokens_out: null }, now).tokens, null);
  const t = hubThread({ conversation: { ...row, model: 'claude-placeholder', git_branch: 'main', active_ms: 125000 }, hasMore: true,
    messages: [{ id: 'm1', role: 'user', at: '2026-10-04T09:58:00.000Z', text: 'hi' }, { id: 'm2', role: 'tool', at: '2026-10-04T09:59:00.000Z', text: 'out' }, { id: 'm3', role: 'assistant', at: '2026-10-04T09:59:00.000Z', text: '[tool: Read a.md]' }] }, now);
  assert.deepEqual(t.messages.map((m) => [m.tool, m.collapsed]), [[false, false], [true, true], [true, true]]);
  assert.deepEqual(t.cursor, { before: '2026-10-04T09:58:00.000Z', beforeId: 'm1' });
  assert.match(t.activeEst, /estimate/);
  assert.equal(hubThread(null, now), null);
  assert.equal(hubHit({ conversationId: 'code:s', messageId: 'm', title: 'T', at: row.last_at, snippet: '\u0002a\u0003' }, now).parts[0].hit, true);
  const s = hubStats({ days: [{ day: '2026-10-04', chats: 2, messages: 5, active_ms: 120000 }], projects: [{ project_id: 'code:p', name: 'project-a', chats: 2, tokens_in: 1, tokens_out: 2, tokens_cache_read: 0, tokens_cache_write: 0 }], totals: { chats: 2, active_ms: 120000, tokens_in: 1, tokens_out: 2, tokens_cache_read: 0, tokens_cache_write: 0 } });
  assert.deepEqual(s.days, [{ day: '2026-10-04', chats: 2, activeMin: 2 }]);
  assert.equal(s.totals.tokens, '3');
});
test('hubThread day is the LOCAL day of the timestamp, the same clock as time', () => {
  const at = new Date(2026, 9, 4, 0, 30).toISOString();   // local 00:30 on Oct 4, whatever the zone
  const t = hubThread({ conversation: { id: 'code:s' }, messages: [{ id: 'm1', role: 'user', at, text: 'hi' }, { id: 'm2', role: 'user', at: 'nope', text: 'x' }] });
  assert.deepEqual([t.messages[0].time, t.messages[0].day], ['00:30', '2026-10-04']);
  assert.equal(t.messages[1].day, '');
});

test('clutter surfaces everything the scan does not score: anomalies, untracked, ignored, loose files', () => {
  const c = clutter({
    anomalies: [{ type: 'missing_path', detail: 'Configured product "x" not found', severity: 'warning' }],
    unclassified: [{ name: 'artcv', kind: 'project-like', stack: ['Node', 'Vite'], has_git: true, dirty: 3, unpushed: false, remote: null, files: 120, days_since_modified: 4 }, { name: 'ChatGPT', kind: 'other', files: 9 }],
    ignored: [{ name: 'Codex', kind: 'other', files: 62, days_since_modified: 0 }],
    loose_files: [{ name: 'big.zip', bytes: 80750569219, days_since_modified: 120 }],
  });
  const by = Object.fromEntries(c.map((g) => [g.id, g]));
  assert.equal(by.anomalies.rows[0].label, 'Configured product "x" not found');
  assert.match(by.unclassified.detail, /2 folders .* 1 look like projects/);
  assert.equal(by.unclassified.rows[0].note, 'project-like · Node+Vite · git · 3 dirty · no remote · 120 files · 4d ago');
  assert.equal(by.ignored.rows[0].label, 'Codex');
  assert.match(by.loose.detail, /1 file · .*GB/);
  assert.deepEqual(clutter({ unclassified: [], ignored: [] }), []);   // nothing flagged -> no empty groups
});

import { chatTurnNew, chatReduce, chatTurnView, liveTurns, CHAT_TEXT_MAX } from './adapter.mjs';
const SIDX = '00000000-0000-4000-8000-000000000001';
test('chatReduce: text grows, tools become their own rows, one end, nothing after it', () => {
  let t = chatTurnNew({ turnId: 't1', convId: null, projectId: 'project-a', prompt: 'Say hi', mode: 'read-only', sessionId: null, seeded: null, now: 1000 });
  t = chatReduce(t, { kind: 'session', sessionId: SIDX }, 1001);
  assert.equal(t.convId, 'code:' + SIDX); assert.equal(t.status, 'running');
  for (const ev of [{ kind: 'delta', text: 'Hel' }, { kind: 'delta', text: 'lo' }, { kind: 'tool', name: 'Read', hint: 'README.md' }, { kind: 'delta', text: 'Done.' }]) t = chatReduce(t, ev, 1002);
  assert.deepEqual(t.items, [{ type: 'text', text: 'Hello' }, { type: 'tool', name: 'Read', hint: 'README.md' }, { type: 'text', text: 'Done.' }]);
  const done = chatReduce(t, { kind: 'done', sessionId: SIDX, usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, isError: false, stopped: false }, 2000);
  assert.equal(done.status, 'done'); assert.equal(done.endedAt, 2000);
  assert.deepEqual(chatReduce(done, { kind: 'delta', text: 'late' }, 2001), done);
  assert.equal(t.items.length, 3, 'the input turn was not mutated');
  const stopped = chatReduce(t, { kind: 'done', stopped: true, usage: null }, 3000);
  assert.equal(stopped.status, 'stopped');
  const failed = chatReduce(t, { kind: 'done', isError: true, subtype: 'error_max_turns', result: '' }, 3000);
  assert.equal(failed.status, 'error'); assert.equal(failed.error, 'error_max_turns');
  assert.equal(chatReduce(t, { kind: 'error', error: 'stopped after 10 min' }, 3000).error, 'stopped after 10 min');
  let big = chatTurnNew({ turnId: 't2', prompt: 'x', mode: 'edits', now: 0 });
  big = chatReduce(big, { kind: 'delta', text: 'a'.repeat(CHAT_TEXT_MAX) }, 1); big = chatReduce(big, { kind: 'delta', text: 'END' }, 2);
  assert.equal(big.items[0].text.length, CHAT_TEXT_MAX); assert.ok(big.items[0].text.endsWith('END'));
});
test('chatTurnView: mode on every turn, honest status, unknown tokens are null, trim note', () => {
  const t = chatTurnNew({ turnId: 't1', convId: 'code:' + SIDX, prompt: 'x', mode: 'edits', seeded: { chars: 30000, trimmed: true }, now: 0 });
  const v = chatTurnView(t);
  assert.equal(v.modeText, 'Allow edits'); assert.equal(v.statusText, 'Starting Claude Code…'); assert.equal(v.running, true);
  assert.equal(v.tokens, null); assert.equal(v.hasTokens, false);
  assert.equal(v.seededNote, 'Copied the last 30000 characters of the claude.ai chat (trimmed)');
  const d = chatTurnView(chatReduce(t, { kind: 'done', usage: { in: 600, out: 12000, cacheRead: 5, cacheWrite: 0 } }, 1));
  assert.equal(d.tokens, '12.6k'); assert.equal(d.running, false); assert.equal(d.modeText, 'Allow edits');
  assert.equal(chatTurnView(chatTurnNew({ turnId: 'x', prompt: 'p', mode: 'read-only', now: 0 })).modeText, 'Read-only');
});
test('liveTurns: a finished turn disappears once the thread shows its prompt; running turns stay', () => {
  const base = { convId: 'code:' + SIDX, mode: 'read-only' };
  const a = { ...chatTurnNew({ turnId: 'a', prompt: 'Explain   the release plan please', now: Date.parse('2026-10-05T10:00:00Z'), ...base }), status: 'done' };
  const b = { ...chatTurnNew({ turnId: 'b', prompt: 'And the risks?', now: Date.parse('2026-10-05T10:01:00Z'), ...base }), status: 'running' };
  const other = chatTurnNew({ turnId: 'c', convId: 'code:other', prompt: 'x', mode: 'read-only', now: 0 });
  const thread = { messages: [{ role: 'user', at: '2026-10-05T10:00:01Z', text: 'Explain the release plan please' }, { role: 'user', at: '2026-10-05T10:01:01Z', text: 'And the risks?' }] };
  assert.deepEqual(liveTurns([a, b, other], 'code:' + SIDX, null).map((t) => t.turnId), ['a', 'b']);
  assert.deepEqual(liveTurns([a, b, other], 'code:' + SIDX, thread).map((t) => t.turnId), ['b']);
  const old = { messages: [{ role: 'user', at: '2026-09-01T00:00:00Z', text: 'Explain the release plan please' }] };
  assert.deepEqual(liveTurns([a], 'code:' + SIDX, old).map((t) => t.turnId), ['a'], 'an older identical prompt is not this turn');
});

test('seeded turn is refiled under the new Code chat and deduped by the prompt suffix', () => {
  let t = chatTurnNew({ turnId: 's1', convId: 'claude-ai-1', prompt: 'Summarise the plan please', mode: 'read-only', seeded: { chars: 10, trimmed: false }, now: 1000 });
  t = chatReduce(t, { kind: 'session', sessionId: 'sess-new' }, 1001);
  assert.equal(t.convId, 'code:sess-new');
  assert.equal(t.originConvId, 'claude-ai-1');
  t = chatReduce(t, { kind: 'done', sessionId: 'sess-new', usage: null }, 2000);
  assert.equal(t.convId, 'code:sess-new');
  assert.deepEqual(liveTurns([t], 'claude-ai-1', null), []);
  assert.deepEqual(liveTurns([t], 'code:sess-new', null).map((x) => x.turnId), ['s1']);
  const thread = { messages: [{ role: 'user', at: new Date(1500).toISOString(), text: 'Context: a claude.ai conversation titled "X"\n\nbody\n\n---\n\nSummarise the plan please' }] };
  assert.deepEqual(liveTurns([t], 'code:sess-new', thread), []);
  const plain = chatReduce(chatTurnNew({ turnId: 'p', convId: 'code:abc', prompt: 'x', now: 0 }), { kind: 'session', sessionId: 'zzz' }, 1);
  assert.equal(plain.convId, 'code:abc');
});

import { hubDocHit, hubDocument } from './adapter.mjs';

test('H6: ChatGPT rows are labelled ChatGPT; document hits carry a badge and text parts', () => {
  assert.equal(hubConv({ id: 'chatgpt:x', source: 'chatgpt', title: 't' }).sourceLabel, 'ChatGPT');
  assert.equal(hubConv({ id: 'web:x', source: 'web' }).sourceLabel, 'claude.ai');
  const h = hubDocHit({ id: 'claude-md:1', source: 'claude-md', title: 'CLAUDE.md — p', mtime_ms: Date.parse('2026-10-01T00:00:00Z'), snippet: 'fake \u0002tea\u0003 rules', origin: null }, Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(h.badge, 'CLAUDE.md'); assert.equal(h.title, 'CLAUDE.md — p');
  assert.deepEqual(h.parts.map((p) => [p.text, !!p.hit]), [['fake ', false], ['tea', true], [' rules', false]]);
  assert.equal(hubDocHit({ id: 'memory:chatgpt:1', source: 'memory', origin: 'chatgpt', title: null }).badge, 'memory (ChatGPT)');
  assert.equal(hubDocHit({ id: 'x', source: 'other' }).badge, 'document');
});

test('H6: hubDocument shows masked text as plain lines; null and junk are null', () => {
  const d = hubDocument({ id: 'memory:1', source: 'memory', title: 'Tea', text: 'line one\nline two', project_path: 'C:\fake\p', mtime_ms: 1 }, 2);
  assert.equal(d.badge, 'memory'); assert.equal(d.project, 'C:\fake\p');
  assert.deepEqual(d.lines.map((l) => l.text), ['line one', 'line two']);
  assert.equal(hubDocument(null), null); assert.equal(hubDocument({ error: 'x' }), null);
});

// ---- System › Machine detail panels (PC health 2026-10-26) ----
import { machineDetail } from './adapter.mjs';

test('machineDetail: an older sidecar (no detail/trends) gives empty panels, never throws', () => {
  for (const x of [undefined, null, {}, { organs: [] }, { detail: 'junk', trends: 5 }]) {
    const d = machineDetail(x);
    for (const k of ['ram', 'cpu', 'disk', 'gpus', 'live', 'facts', 'storage', 'trends', 'startup', 'unreadable']) assert.deepEqual(d[k], [], k);
  }
});

test('machineDetail: rows carry readable values and bars relative to the biggest', () => {
  const d = machineDetail({ detail: {
    topRam: [{ name: 'a', count: 3, mb: 3072 }, { name: 'b', count: 1, mb: 512 }, { name: 'bad' }],
    topCpu: [{ name: 'a', pct: 10 }, { name: 'idle', pct: 0 }],
    hogs: { at: '2026-10-05T09:00:00Z', partial: true, items: [{ path: 'C:/x/Big', label: 'Big', gb: 50 }, { path: 'C:/x/Small', label: 'Small', gb: 0.5 }] },
  } });
  assert.deepEqual(d.ram.map((r) => [r.name, r.val, r.sub, r.w]), [['a', '3.0 GB', '3 processes', '100%'], ['b', '512 MB', '1 process', '17%']]);
  assert.deepEqual(d.cpu.map((r) => r.name), ['a']); // a 0% row is not a finding
  assert.deepEqual(d.disk.map((r) => [r.name, r.val, r.w, r.path]), [['Big', '50 GB', '100%', 'C:/x/Big'], ['Small', '0.5 GB', '2%', 'C:/x/Small']]);
  assert.equal(d.diskPartial, true);
});

test('machineDetail: GPUs say where VRAM came from; live stats flag heat; facts flag what needs action', () => {
  const d = machineDetail({ detail: {
    gpus: [{ name: 'dGPU', vramGB: 8, vramSource: 'registry', driverDate: '2026-07-02', driverDays: 100 }, { name: 'old', vramGB: 4, vramSource: 'wmi' }],
    gpuLive: { tempC: 90, loadPct: 5, memUsedMB: 1024, memTotalMB: 8192, powerW: 12.75, clockMHz: 210, pstate: 'P8' },
    battery: { pct: 15, plugged: false, runtimeMin: 75 }, power: { plan: 'Balanced' },
    displays: [{ width: 1920, height: 1080, hz: 300 }], network: { wireless: false, linkMbps: 1000 }, uptimeHrs: 400, rebootPending: true,
  } });
  assert.equal(d.gpus[0].sub, 'VRAM · driver 2026-07-02 · 100 days old');
  assert.match(d.gpus[1].sub, /4 GB-capped/);
  assert.deepEqual(d.live.map((c) => c.k + '=' + c.v), ['Temp=90 °C', 'Load=5%', 'VRAM in use=1.0 GB of 8.0 GB', 'Power=12.8 W', 'Clock=210 MHz', 'State=P8 (idle)']);
  assert.equal(d.live[0].warn, true);
  const facts = Object.fromEntries(d.facts.map((f) => [f.k, f]));
  assert.equal(facts.Battery.v, '15% · on battery · ~1 h 15 min left');
  assert.equal(facts.Battery.warn, true);
  assert.equal(facts.Display.v, '1920×1080 · 300 Hz');
  assert.equal(facts.Network.v, 'Wired · 1000 Mbps link');
  assert.equal(facts['Up for'].v, '17 days');
  assert.equal(facts['Up for'].warn, true);
  assert.equal(facts.Restart.warn, true);
});

test('machineDetail: trends get arrows; storage health is Healthy or flagged', () => {
  const d = machineDetail({ detail: { storage: [{ name: 's', media: 'SSD', bus: 'NVMe', health: 'Healthy', sizeGB: 477 }, { name: 'h', health: 'Warning' }] },
    trends: [{ dir: 'down', bad: true, text: 'fell' }, { dir: 'flat', text: 'held' }, { text: '' }] });
  assert.deepEqual(d.trends.map((t) => t.arrow + t.text), ['↓fell', '→held']);
  assert.deepEqual(d.storage.map((s) => [s.sub, s.ok]), [['SSD · NVMe · 477 GB', true], ['', false]]);
});

test('machine() exposes the panels as DETAIL', () => {
  assert.deepEqual(machine({ organs: [] }).DETAIL.ram, []);
});

// ---- GitHub view (data/github.json, CONTRACT 2026-10-26) ----
import { github as ghView } from './adapter.mjs';
const GH_NOW = Date.parse('2026-03-02T12:00:00Z');
const GH_RAW = { v: 1, state: 'ok', at: '2026-03-02T11:00:00Z', login: 'octo-owner', partial: false,
  totals: { repos: 2, private: 1, archived: 0, stars: 1, openPrs: 1, openIssues: 0, ciFailing: 1, cloned: 1, waiting: 1 },
  repos: [{ full: 'octo-owner/alpha', name: 'alpha', url: 'https://github.com/octo-owner/alpha', private: true, openPrs: 1, openIssues: 0, stars: 1, ci: 'failure', pushedAt: '2026-03-01T12:00:00Z', lastCommit: { title: 'placeholder' }, local: 'C:/dev/alpha' },
    { name: 'no-url' }, null],
  waiting: [{ kind: 'review', repo: 'other/x', number: 4, title: 'Placeholder', url: 'https://github.com/other/x/pull/4', updatedAt: '2026-03-02T09:00:00Z', author: 'someone', draft: true, ci: 'expected' }, { title: 'no url' }],
  mine: 'junk', issues: [{ repo: 'other/x', number: 9, title: 'Issue', url: 'https://github.com/other/x/issues/9', updatedAt: '2026-03-01T12:00:00Z' }] };

test('github view: rows keep only linkable entries, CI labels, clone place, ages', () => {
  const v = ghView(GH_RAW, GH_NOW);
  assert.equal(v.state, 'ok'); assert.equal(v.when, '1h ago'); assert.equal(v.login, 'octo-owner');
  assert.equal(v.repos.length, 1);
  assert.deepEqual([v.repos[0].ci, v.repos[0].ciBad, v.repos[0].cloned, v.repos[0].pushed, v.repos[0].prs], ['CI failing', true, true, '1d ago', 1]);
  assert.equal(v.waiting.length, 1);
  assert.deepEqual([v.waiting[0].num, v.waiting[0].kind, v.waiting[0].when, v.waiting[0].ci, v.waiting[0].draft], ['#4', 'review requested', '3h ago', '', true]);
  assert.deepEqual(v.mine, []);
  assert.equal(v.issues[0].kind, 'issue');
  assert.equal(v.totals.waiting, 1);
});

test('github view: missing, junk and failure states are honest', () => {
  assert.equal(ghView(null).state, 'none');
  assert.equal(ghView({ state: 'weird' }).state, 'none');
  const s = ghView({ v: 1, state: 'signed-out', at: '2026-03-02T11:00:00Z', error: 'run gh auth login' }, GH_NOW);
  assert.deepEqual([s.state, s.error, s.repos.length, s.totals.repos, s.totals.waiting], ['signed-out', 'run gh auth login', 0, 0, null]);
  const p = ghView({ ...GH_RAW, stale: true, staleReason: 'network', partial: true, totals: { ...GH_RAW.totals, waiting: null } }, GH_NOW);
  assert.deepEqual([p.stale, p.staleReason, p.partial, p.totals.waiting], [true, 'network', true, null]);
});

// ---- freshness (data overhaul Front A2) ----
import { freshness, STALE_DAYS } from './adapter.mjs';
test('freshness: today, stale after STALE_DAYS, estimate age, unknown', () => {
  const now = Date.parse('2026-03-10T12:00:00Z');
  assert.deepEqual(freshness('2026-03-10T02:00:00Z', 0, now), { days: 0, stale: false, estAge: 0, badge: '', note: 'Data from today’s scan' });
  const old = freshness('2026-03-06T02:00:00Z', 3, now);
  assert.deepEqual([old.days, old.stale, old.badge], [4, true, '4 days old']);
  assert.equal(old.note, 'Data from a scan 4 days ago · completion %, insights and roadmap are estimates from 3 days before that scan');
  assert.equal(freshness('2026-03-09T02:00:00Z', null, now).stale, STALE_DAYS <= 1);
  assert.deepEqual([freshness(null, 1, now).days, freshness(null, 1, now).stale], [null, false]);
});

test('toProject: discovered is one of the known reasons, else null (data overhaul Front B)', () => {
  assert.equal(toProject({ id: 'a', discovered: 'owner' }).discovered, 'owner');
  assert.equal(toProject({ id: 'a', discovered: 'no-remote' }).discovered, 'no-remote');
  assert.equal(toProject({ id: 'a', discovered: 'weird' }).discovered, null);
  assert.equal(toProject({ id: 'a' }).discovered, null);
});

// ---- connected accounts (data/accounts.json, CONTRACT 2026-10-26) ----
import { accounts as acView } from './adapter.mjs';
test('accounts view: vercel deploy rows, states, supabase status; junk and missing are honest', () => {
  const now = Date.parse('2026-03-02T12:00:00Z');
  const v = acView({ v: 1,
    vercel: { state: 'ok', at: '2026-03-02T11:00:00Z', user: 'octo-owner', totals: { projects: 1, prodFailing: 1, building: 0 },
      projects: [{ name: 'a', repo: 'o/a', dashboard: 'https://vercel.com/t/a', prod: { state: 'blocked', target: 'production', url: 'https://a.vercel.app', at: '2026-03-01T12:00:00Z' }, latest: null }, { name: '' }],
      deploys: [{ state: 'weird', url: 'https://a2.vercel.app' }, {}] },
    supabase: { state: 'ok', projects: [{ name: 'db', status: 'ACTIVE_HEALTHY' }] } }, now);
  assert.deepEqual([v.vercel.state, v.vercel.when, v.vercel.projects.length], ['ok', '1h ago', 1]);
  assert.deepEqual([v.vercel.projects[0].prod.state, v.vercel.projects[0].prod.bad, v.vercel.projects[0].prod.when, v.vercel.projects[0].latest], ['Blocked', true, '1d ago', null]);
  assert.deepEqual(v.vercel.deploys.map((d) => [d.state, d.target]), [['Unknown', 'preview']]);
  assert.deepEqual([v.supabase.projects[0].status, v.supabase.projects[0].ok], ['active healthy', true]);
  const none = acView(null);
  assert.deepEqual([none.vercel.state, none.supabase.state, none.vercel.projects.length], ['none', 'none', 0]);
  assert.equal(acView({ vercel: { state: 'no-cli', error: 'x' } }).vercel.error, 'x');
});
