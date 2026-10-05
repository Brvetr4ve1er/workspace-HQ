// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, toTask, toIdea, snapshot, metric, weeks, automations, machine, clutter, sites, canvasWidgets, devPort, dayOf, fmtD, captures, sessions, social, fileUrl, normPath, projectForCwd, riskFlags } from './adapter.mjs';
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
  assert.deepEqual(machine(null), { VITALS: [], ISSUES: [], scannedAt: null, host: {} });
});

test('clutter, sites and canvas degrade to empty on missing blocks', () => {
  assert.deepEqual(clutter({}), []);
  assert.equal(clutter({ empty: ['x', 'y'] })[0].detail, '2 empty folders · x, y');
  assert.deepEqual(sites(null), []);
  assert.deepEqual(sites({ by_domain: [{ domain: 'a.dev', focus_ms: 120000 }, { domain: 'b.com', focus_ms: 60000 }], by_project: [{ domains: ['a.dev'] }] }), [['a.dev', 2, 'Project'], ['b.com', 1, 'Other']]);
  assert.deepEqual(canvasWidgets([{ name: 'b', nodes: [{ id: 'n', text: '# Plan\n- one\n- two' }] }])[0].items, ['one', 'two']);
});

test('dates: scan ids are local days; captures, sessions and social map cleanly', () => {
  assert.equal(fmtD(dayOf('2026-10-03')), 'Oct 3');
  const now = new Date(2026, 9, 3, 15);
  const c = captures([{ kind: 'shot', path: 'p1', name: 'a.png', size: 2048, mtimeMs: new Date(2026, 9, 3, 9, 5).getTime(), thumbDataUrl: 'javascript:x' }], now);
  assert.deepEqual([c[0].day, c[0].time, c[0].size, c[0].kind, c[0].thumb], ['Today', '09:05', '2 KB', 'snip', null]);
  assert.equal(sessions([{ jobId: 'j', label: 'Fix', status: 'ended', exitCode: 1, startedAt: 0, tail: 'a\nb' }])[0].status, 'failed');
  const so = social({ accounts: { accounts: [{ platform: 'bluesky', handle: 'me' }] }, outbox: { actions: [{ id: 'o1', platform: 'bluesky', text: 'hi', status: 'staged' }, { id: 'o2', status: 'sent' }] } });
  assert.deepEqual([so.POSTS.length, so.POSTS[0].handle, so.connected], [1, '@me', true]);
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
    cmd: 'claude /review', dir: 'C:/dev/a', last: { ok: true, ago: '1h ago', err: '' }, desc: 'Reviews the diff', cat: 'Analyze', hash: 'hs',
  });
  assert.deepEqual(r.INTERACTIVE[0].last, { ok: false, ago: '3h ago', err: 'exit 2' });
  assert.equal(r.INTERACTIVE[0].cmd, 'cmd /c npm run dev');
  assert.deepEqual(r.counts, { runnable: 2, interactive: 2, bySource: { grimoire: { runnable: 1, interactive: 0 }, npm: { runnable: 1, interactive: 1 }, skill: { runnable: 0, interactive: 1 } } });
  // LIBRARY's runnable column still counts castable + chain only (UI unchanged until C7)
  assert.deepEqual(r.LIBRARY.find((l) => l[0] === 'Claude skills'), ['Claude skills', 2, 0]);
  assert.deepEqual(r.LIBRARY.find((l) => l[0] === 'npm scripts'), ['npm scripts', 2, 1]);
  assert.deepEqual(automations(null, null).INTERACTIVE, []);
  assert.deepEqual(automations(null, null).counts, { runnable: 0, interactive: 0, bySource: {} });
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
