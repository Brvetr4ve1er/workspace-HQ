// Operator Brief senses (dashboard/brief-senses.mjs): a fires/silent table per rule. Placeholder data only (public repo).
//   node --test dashboard/brief-senses.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENSE_RULES, SENSE_FNS, sidecarState, sidecarError, sessionCandidates, sessionDirtyProjectIds, DIRTY_MIN } from './brief-senses.mjs';

const H = 3600e3, D = 24 * H;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const fresh = iso(NOW - 3 * H);
const run = (rule, ctx) => SENSE_FNS[rule]({ now: NOW, ...ctx });

test('the six rules are registered, in order, each with a function', () => {
  assert.deepEqual(SENSE_RULES, ['prod-deploy-error', 'ci-red', 'session-left-dirty', 'review-waiting', 'reboot-pending', 'money-empty']);
  for (const r of SENSE_RULES) assert.equal(typeof SENSE_FNS[r], 'function');
});

// ---- prod-deploy-error -----------------------------------------------------------------------------------------------
const vercel = (projects, o = {}) => ({ state: 'ok', at: fresh, partial: false, projects, ...o });
const vp = (name, state, at = '2026-11-06T10:00:00Z', extra = {}) => ({ name, prod: { state, at }, deploys: [], ...extra });

test('prod-deploy-error: a prod.state of error fires, high, with the sidecar age and the Vercel & Supabase action', () => {
  const it = run('prod-deploy-error', { vercel: vercel([vp('alpha-site', 'ready'), vp('beta-site', 'error', '2026-11-06T10:00:00Z')]) });
  assert.equal(it.key, 'prod-deploy-error:beta-site:2026-11-06T10:00:00Z');
  assert.equal(it.severity, 'high');
  assert.match(it.text, /beta-site/);
  assert.equal(it.age, 'accounts.json 3 h ago');
  assert.deepEqual(it.action, { kind: 'go', tab: 'projects', sub: 'accounts' });
  assert.equal(it.others, 0);
});
test('prod-deploy-error: an error that lives only in deploys[] stays silent; a blank or missing state is skipped', () => {
  assert.equal(run('prod-deploy-error', { vercel: vercel([vp('alpha-site', 'ready', undefined, { deploys: [{ state: 'error' }] })]) }), null);
  assert.equal(run('prod-deploy-error', { vercel: vercel([vp('alpha-site', ''), vp('beta-site', undefined), { name: 'gamma-site' }]) }), null);
});
test('prod-deploy-error: several failures say "and N more", the newest failure is named', () => {
  const it = run('prod-deploy-error', { vercel: vercel([vp('alpha-site', 'error', '2026-11-01T00:00:00Z'), vp('beta-site', 'error', '2026-11-05T00:00:00Z'), vp('gamma-site', 'error', '2026-11-03T00:00:00Z')]) });
  assert.match(it.text, /^beta-site .* and 2 more projects$/);
  assert.equal(it.others, 2);
});

// ---- ci-red ----------------------------------------------------------------------------------------------------------
const repo = (full, o = {}) => ({ full: 'owner/' + full, name: full, ci: 'failure', archived: false, fork: false, pushedAt: iso(NOW - 2 * D), ...o });
const github = (repos, o = {}) => ({ state: 'ok', at: fresh, partial: false, repos, waiting: [], ...o });

test('ci-red: a failing repo pushed inside 14 days fires (med) and keys on its pushedAt', () => {
  const r = repo('alpha-site');
  const it = run('ci-red', { github: github([r]) });
  assert.equal(it.key, 'ci-red:owner/alpha-site:' + r.pushedAt);
  assert.equal(it.severity, 'med');
  assert.equal(it.text, 'CI is failing on alpha-site');
  assert.deepEqual(it.action, { kind: 'go', tab: 'projects', sub: 'github' });
  assert.equal(it.age, 'github.json 3 h ago');
});
test('ci-red: silent at 125 days, for ci null, passing, archived and forks', () => {
  for (const r of [repo('a', { pushedAt: iso(NOW - 125 * D) }), repo('b', { ci: null }), repo('c', { ci: 'success' }), repo('d', { archived: true }), repo('e', { fork: true }), repo('f', { pushedAt: 'nope' })]) {
    assert.equal(run('ci-red', { github: github([r]) }), null, r.name);
  }
});
test('ci-red: a new push re-keys it; several repos name the newest and count the rest', () => {
  const a = run('ci-red', { github: github([repo('alpha-site')]) });
  const b = run('ci-red', { github: github([repo('alpha-site', { pushedAt: iso(NOW - D) })]) });
  assert.notEqual(a.key, b.key);
  const many = run('ci-red', { github: github([repo('alpha-site', { pushedAt: iso(NOW - 5 * D) }), repo('beta-site', { pushedAt: iso(NOW - D) }), repo('gamma-site'), repo('delta-site', { ci: null })]) });
  assert.equal(many.text, 'CI is failing on beta-site and 2 more repos');
  assert.equal(many.others, 2);
});
test('ci-red: exactly 14 days is still recent; just over is not', () => {
  assert.ok(run('ci-red', { github: github([repo('a', { pushedAt: iso(NOW - 14 * D) })]) }));
  assert.equal(run('ci-red', { github: github([repo('a', { pushedAt: iso(NOW - 14 * D - 1000) })]) }), null);
});

// ---- review-waiting --------------------------------------------------------------------------------------------------
test('review-waiting: drafts are excluded, the count is in the text, titles never are', () => {
  const w = (n, o = {}) => ({ repo: 'owner/alpha-site', number: n, title: 'Secret title ' + n, updatedAt: iso(NOW - n * D), draft: false, ...o });
  const it = run('review-waiting', { github: github([], { waiting: [w(1), w(2), w(3, { draft: true })] }) });
  assert.equal(it.text, '2 pull requests are waiting on you');
  assert.equal(it.severity, 'low');
  assert.equal(it.key, 'review-waiting:' + iso(NOW - D));
  assert.equal(it.others, 1);
  assert.ok(!JSON.stringify(it).includes('Secret title'));
  assert.equal(run('review-waiting', { github: github([], { waiting: [w(1)] }) }).text, 'A pull request is waiting on you');
  assert.equal(run('review-waiting', { github: github([], { waiting: [w(1, { draft: true })] }) }), null);
  assert.equal(run('review-waiting', { github: github([], { waiting: [] }) }), null);
});

// ---- reboot-pending --------------------------------------------------------------------------------------------------
test('reboot-pending: true fires once per scanned day; false and absent are silent', () => {
  const it = run('reboot-pending', { pcDetail: { scannedAt: '2026-11-07T09:00:00Z', rebootPending: true } });
  assert.equal(it.key, 'reboot-pending:2026-11-07');
  assert.equal(it.severity, 'low');
  assert.deepEqual(it.action, { kind: 'go', tab: 'system', sub: 'machine' });
  assert.equal(run('reboot-pending', { pcDetail: { scannedAt: '2026-11-07T09:00:00Z', rebootPending: false } }), null);
  assert.equal(run('reboot-pending', { pcDetail: { scannedAt: '2026-11-07T09:00:00Z' } }), null);
  assert.equal(run('reboot-pending', {}), null);
  assert.equal(run('reboot-pending', { pcDetail: { scannedAt: iso(NOW - 80 * H), rebootPending: true } }), null);   // stale
});

// ---- money-empty -----------------------------------------------------------------------------------------------------
test('money-empty: only when the view loaded and has no accounts; one dismiss holds for good', () => {
  const it = run('money-empty', { money: { hasAccounts: false, accounts: [] } });
  assert.equal(it.key, 'money-empty:never');
  assert.equal(it.severity, 'low');
  assert.deepEqual(it.action, { kind: 'go', tab: 'money', sub: 'today' });
  assert.equal(run('money-empty', { money: null }), null);
  assert.equal(run('money-empty', {}), null);
  assert.equal(run('money-empty', { money: { hasAccounts: true, accounts: [{ id: 'a' }] } }), null);
  assert.equal(run('money-empty', { money: { accounts: [] } }), null);   // unknown is not "empty"
});

// ---- session-left-dirty ----------------------------------------------------------------------------------------------
const scanMs = NOW - 1 * H;
const sp = (id, name, dirty, path) => ({ id, name, path, metrics: { git_safety: { dirty } } });
const PROJECTS = [sp('alpha-site', 'Alpha Site', 14, 'alpha-site'), sp('beta-site', 'Beta Site', 3, 'C:/work/beta-site')];
const sess = (id, o = {}) => ({ id, projectId: 'hub-1', hqProjectId: null, cwd: 'C:/work/alpha-site/src', lastAt: iso(NOW - 3 * H), ...o });
const base = (o = {}) => ({ now: NOW, scanMs, docsRoot: 'C:/work', projects: PROJECTS, sessions: [sess('s1')], hubProjects: [], sessionTurns: {}, ...o });

test('session-left-dirty: matched by cwd prefix (relative scan path + docsRoot), 14 files, fires with the spec wording and no chat title', () => {
  const it = SENSE_FNS['session-left-dirty'](base({ sessions: [sess('s1', { title: 'Private chat title' })] }));
  assert.equal(it.severity, 'med');
  assert.equal(it.text, 'Alpha Site: your Claude session there ended 3 h ago; the scan after it saw 14 uncommitted files');
  assert.equal(it.key, 'session-left-dirty:alpha-site:' + sess('s1').lastAt);
  assert.deepEqual(it.action, { kind: 'go', tab: 'projects', projectId: 'alpha-site' });
  assert.ok(!JSON.stringify(it).includes('Private chat title'));
});
test('session-left-dirty: boundary rows — 9 files with no edit call silent, 1 file with an Edit fires, 10 files fire', () => {
  const at = (dirty, turns) => base({ projects: [sp('alpha-site', 'Alpha Site', dirty, 'alpha-site')], sessionTurns: turns ? { s1: turns } : {} });
  const f = SENSE_FNS['session-left-dirty'];
  assert.equal(DIRTY_MIN, 10);
  assert.equal(f(at(9, [{ toolName: 'Read' }, { toolName: null }])), null);
  assert.ok(f(at(1, [{ toolName: 'Read' }, { toolName: 'Edit' }])));
  assert.ok(f(at(9, [{ toolName: 'NotebookEdit' }])));
  assert.ok(f(at(10)));
  assert.equal(f(at(0, [{ toolName: 'Edit' }])), null);
});
test('session-left-dirty: needs a scan after the session; a session still running is silent', () => {
  const f = SENSE_FNS['session-left-dirty'];
  assert.equal(f(base({ scanMs: NOW - 4 * H })), null);                                  // session ended after the scan
  assert.equal(f(base({ scanMs: null })), null);
  assert.equal(f(base({ sessions: [sess('s1', { lastAt: iso(NOW - 2 * 60e3) })], scanMs: NOW + 1000 })), null);   // active 2 min ago
  assert.ok(f(base({ sessions: [sess('s1', { lastAt: iso(NOW - 4 * 60e3) })], scanMs: NOW - 1000 })));            // ended 4 min ago
  // a newer running session in the same project silences the older ended one
  assert.equal(f(base({ sessions: [sess('s1'), sess('s2', { lastAt: iso(NOW - 60e3) })] })), null);
});
test('session-left-dirty: the Hub link counts only when confirmed or auto; none/rejected fall back to cwd', () => {
  const f = SENSE_FNS['session-left-dirty'];
  const linked = (linkState) => base({ sessions: [sess('s1', { cwd: 'C:/elsewhere/x', hqProjectId: 'alpha-site' })], hubProjects: [{ id: 'hub-1', path: 'C:/elsewhere/x', hqProjectId: 'alpha-site', linkState }] });
  assert.ok(f(linked('confirmed')));
  assert.ok(f(linked('auto')));
  assert.equal(f(linked('none')), null);
  assert.equal(f(linked('rejected')), null);
});
test('session-left-dirty: an ambiguous cwd (nested projects) or an unmatched one is silent; matching is case-insensitive', () => {
  const f = SENSE_FNS['session-left-dirty'];
  const nested = [sp('alpha-site', 'Alpha Site', 14, 'alpha-site'), sp('alpha-inner', 'Alpha Inner', 14, 'alpha-site/src')];
  assert.equal(f(base({ projects: nested })), null);
  assert.equal(f(base({ sessions: [sess('s1', { cwd: 'C:/work/unrelated' })] })), null);
  assert.equal(f(base({ sessions: [sess('s1', { cwd: 'c:\\WORK\\Alpha-Site\\src' })] })).action.projectId, 'alpha-site');
  assert.equal(f(base({ sessions: [sess('s1', { cwd: 'C:/work/alpha-site-two' })] })), null);   // a sibling prefix is not a match
  assert.equal(f(base({ docsRoot: undefined })), null);                                          // relative path, no root: unresolved
});
test('session-left-dirty: several projects name the dirtiest and count the rest; sessionDirtyProjectIds names them for the dirty rule', () => {
  const projects = [sp('alpha-site', 'Alpha Site', 14, 'alpha-site'), sp('beta-site', 'Beta Site', 22, 'beta-site')];
  const sessions = [sess('s1'), sess('s2', { cwd: 'C:/work/beta-site', lastAt: iso(NOW - 5 * H) })];
  const ctx = base({ projects, sessions });
  const it = SENSE_FNS['session-left-dirty'](ctx);
  assert.match(it.text, /^Beta Site: .* and 1 more project$/);
  assert.equal(it.others, 1);
  assert.deepEqual([...sessionDirtyProjectIds(ctx)].sort(), ['alpha-site', 'beta-site']);
  assert.deepEqual([...sessionDirtyProjectIds({})], []);
});
test('sessionCandidates marks only the 1..9 file rows as needing turns', () => {
  const projects = [sp('alpha-site', 'Alpha Site', 14, 'alpha-site'), sp('beta-site', 'Beta Site', 3, 'beta-site'), sp('gamma-site', 'Gamma Site', 0, 'gamma-site')];
  const sessions = [sess('s1'), sess('s2', { cwd: 'C:/work/beta-site' }), sess('s3', { cwd: 'C:/work/gamma-site' })];
  const c = sessionCandidates(base({ projects, sessions }));
  assert.deepEqual(c.map((x) => [x.session.id, x.need]).sort(), [['s1', false], ['s2', true]]);
});

// ---- freshness: any rule ---------------------------------------------------------------------------------------------
test('a stale, partial or not-ok sidecar is silent for its rules and yields an errors entry; an absent one is silent with none', () => {
  const sets = {
    stale: { at: iso(NOW - 80 * H) }, partial: { partial: true }, 'not ok': { state: 'error' }, 'no time': { at: undefined },
  };
  for (const [label, patch] of Object.entries(sets)) {
    const gh = github([repo('alpha-site')], { waiting: [{ updatedAt: fresh, draft: false }], ...patch });
    const vc = vercel([vp('beta-site', 'error')], patch);
    assert.equal(run('ci-red', { github: gh }), null, label);
    assert.equal(run('review-waiting', { github: gh }), null, label);
    assert.equal(run('prod-deploy-error', { vercel: vc }), null, label);
    const e = sidecarError('github', 'data/github.json', gh, NOW);
    assert.equal(e.source, 'github', label);
    assert.match(e.error, /^data\/github\.json .* — its checks were skipped$/, label);
    assert.ok(sidecarError('vercel', 'data/accounts.json', vc, NOW), label);
  }
  assert.equal(sidecarError('github', 'data/github.json', null, NOW), null);
  assert.equal(sidecarError('github', 'data/github.json', github([]), NOW), null);
  assert.match(sidecarError('github', 'data/github.json', 'garbage', NOW).error, /unreadable/);
  assert.equal(sidecarState(undefined, NOW).problem, null);
  assert.equal(sidecarState(github([], { at: iso(NOW - 72 * H) }), NOW).ok, true);   // exactly 72 h is still fresh
});
test('every rule survives garbage context without throwing', () => {
  for (const r of SENSE_RULES) for (const ctx of [{}, { now: NOW, github: 5, vercel: 'x', pcDetail: [], money: 7, projects: 'no', sessions: {}, hubProjects: null }]) {
    assert.doesNotThrow(() => SENSE_FNS[r](ctx), r);
  }
});
