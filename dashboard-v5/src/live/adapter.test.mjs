// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, toTask, toIdea, snapshot, metric, weeks, automations, machine, clutter, sites, canvasWidgets, devPort, dayOf, fmtD, captures, sessions, social } from './adapter.mjs';

const proj = (id, o = {}) => ({
  id, name: 'Project ' + id.toUpperCase(), path: 'C:/dev/' + id, stack: ['Node'], dev_cmd: o.dev ?? null, canonical_branch: 'main',
  completion: { pct: o.pct ?? 50, basis: 'heuristic' }, level: 2, xp: 200,
  activity: { state: o.state ?? 'active', days_since_commit: o.days ?? 2 },
  metrics: {
    git_safety: { has_git: o.git ?? true, has_remote: true, remote: 'github.com/x/' + id, branch: o.branch ?? 'main', commits: o.commits ?? 10, dirty: o.dirty ?? 0, ahead: o.ahead ?? 0, behind: 0, last_commit_subject: 'feat: thing' },
    code_health: { build: 'unknown', tests: { present: true, count: 3 }, files: 20, loc: 900, recent_files: ['a.js'] },
    risk_security: { secrets_found: o.secrets ?? 0, flags: o.secrets ? [{ type: 'secret', location: '.env:3' }] : [] },
  },
  disk: { reclaimable_bytes: o.reclaim ?? 0 },
});
const scan = (id, projects, o = {}) => ({
  scan: { id, date: id + 'T03:00:00Z' }, projects,
  account: { level: 3, title: 'Builder', xp: o.xp ?? 400, health_index: 50, streak: { scan_days: 2 } },
  quests: o.quests || [], side_quests: o.side || [], achievements: o.ach || [], changes_since_prev: o.changes || [], archived_projects: [], recent_learnings: [],
  inventory: o.inv || {}, browser: o.browser,
});

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

test('tasks: only open quests; commit quests are flagged', () => {
  const s = snapshot(scan('2026-10-03', [proj('a')], { quests: [
    { id: 'q-a-commit-dirty', status: 'open', tier: 'red', title: 'Commit A', xp: 100, project_id: 'a', age_days: 3, insight: '12 files at risk' },
    { id: 'q-a-push', status: 'done', tier: 'orange', title: 'Push A', xp: 60, project_id: 'a' },
  ] }));
  assert.equal(s.T0.length, 1);
  assert.deepEqual(s.T0[0], { id: 'q-a-commit-dirty', tier: 'red', title: 'Commit A', why: '12 files at risk', proj: 'a', age: 3, xp: 100, commitTask: true });
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
