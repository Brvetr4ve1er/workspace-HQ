import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shape, failed, normRemote, searchQuery, REPOS_QUERY } from './github.mjs';

const NOW = Date.parse('2026-03-02T18:00:00Z');
const repo = (name, extra = {}) => ({
  nameWithOwner: 'octo-owner/' + name, name, url: 'https://github.com/octo-owner/' + name, isPrivate: false, isFork: false, isArchived: false,
  pushedAt: '2026-03-01T10:00:00Z', stargazerCount: 2, forkCount: 0, description: 'placeholder', primaryLanguage: { name: 'JavaScript' },
  issues: { totalCount: 1 }, pullRequests: { totalCount: 2 },
  defaultBranchRef: { name: 'main', target: { committedDate: '2026-03-01T09:00:00Z', messageHeadline: 'placeholder commit', statusCheckRollup: { state: 'SUCCESS' } } },
  ...extra,
});
const viewer = {
  login: 'octo-owner',
  repositories: { totalCount: 3, nodes: [
    repo('alpha'),
    repo('beta', { isPrivate: true, defaultBranchRef: { name: 'main', target: { committedDate: 'x', messageHeadline: 'y', statusCheckRollup: { state: 'FAILURE' } } } }),
    repo('gamma', { isArchived: true, defaultBranchRef: null, pullRequests: { totalCount: 5 } }),
  ] },
};
const prNode = (n, repoName, updatedAt, extra = {}) => ({ number: n, title: 'placeholder pr ' + n, url: `https://github.com/${repoName}/pull/${n}`, updatedAt,
  isDraft: false, repository: { nameWithOwner: repoName }, author: { login: 'someone' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] }, ...extra });

test('repos: CI, counts, private/archived, local clone by remote', () => {
  const out = shape({ viewer, search: {}, nowMs: NOW, clones: [{ path: 'C:/work/alpha', remote: 'git@github.com:Octo-Owner/alpha.git' }, { path: 'C:/x', remote: 'https://gitlab.com/a/b' }] });
  assert.equal(out.state, 'ok');
  assert.equal(out.login, 'octo-owner');
  assert.equal(out.at, '2026-03-02T18:00:00.000Z');
  const [a, b, g] = out.repos;
  assert.equal(a.ci, 'success'); assert.equal(a.local, 'C:/work/alpha'); assert.equal(a.lastCommit.title, 'placeholder commit');
  assert.equal(b.ci, 'failure'); assert.equal(b.private, true); assert.equal(b.local, null);
  assert.equal(g.ci, null); assert.equal(g.lastCommit, null); assert.equal(g.archived, true);
  // archived repos don't count toward open work
  assert.deepEqual(out.totals, { repos: 3, private: 1, archived: 1, stars: 6, openPrs: 4, openIssues: 2, ciFailing: 1, cloned: 1, waiting: 0 });
});

test('waiting: review > assigned > on-your-repo, deduped, newest first; mine and issues', () => {
  const search = {
    review: { nodes: [prNode(1, 'other/x', '2026-03-01T00:00:00Z')] },
    assigned: { nodes: [prNode(1, 'other/x', '2026-03-01T00:00:00Z'), prNode(2, 'other/y', '2026-03-02T00:00:00Z', { isDraft: true })] },
    onMine: { nodes: [prNode(7, 'octo-owner/alpha', '2026-02-01T00:00:00Z', { author: { login: 'dependabot' } }), null] },
    authored: { nodes: [prNode(3, 'octo-owner/alpha', '2026-02-20T00:00:00Z', { commits: { nodes: [] } }), prNode(1, 'other/x', '2026-03-01T00:00:00Z')] },
    issues: { nodes: [{ number: 9, title: 'placeholder issue', url: 'https://github.com/other/x/issues/9', updatedAt: '2026-03-01T00:00:00Z', repository: { nameWithOwner: 'other/x' }, author: null }] },
  };
  const out = shape({ viewer, search, nowMs: NOW });
  assert.deepEqual(out.waiting.map((p) => [p.kind, p.number]), [['assigned', 2], ['review', 1], ['on-your-repo', 7]]);
  assert.equal(out.waiting[0].draft, true);
  assert.equal(out.waiting[1].ci, 'pending');
  assert.equal(out.waiting[2].author, 'dependabot');
  assert.equal(out.mine[0].ci, null);
  assert.deepEqual(out.mine.map((p) => p.number), [3]);   // #1 already waits on the owner — not listed twice
  assert.equal(out.issues[0].author, '');
  assert.equal(out.totals.waiting, 3);
  assert.equal(out.partial, false);
});

test('a failed search call is partial, not empty-and-fine', () => {
  const out = shape({ viewer, search: null, nowMs: NOW, errors: ['search: rate limit'] });
  assert.equal(out.partial, true);
  assert.equal(out.totals.waiting, null);
  assert.deepEqual(out.errors, ['search: rate limit']);
  assert.equal(out.repos.length, 3);
});

test('junk in, empty lists out', () => {
  const out = shape({ viewer: { repositories: { nodes: [null, 3] } }, search: { review: 'x' }, clones: 'nope', nowMs: NOW });
  assert.deepEqual([out.repos, out.waiting, out.mine, out.issues], [[], [], [], []]);
  assert.equal(out.login, '');
});

test('normRemote', () => {
  assert.equal(normRemote('https://github.com/A/b.git'), 'a/b');
  assert.equal(normRemote('https://token@github.com/a/b/'), 'a/b');
  assert.equal(normRemote('ssh://git@github.com/a/b'), 'a/b');
  assert.equal(normRemote('git@github.com:a/b.c.git'), 'a/b.c');
  assert.equal(normRemote('https://gitlab.com/a/b'), null);
  assert.equal(normRemote('https://github.com/a'), null);
  assert.equal(normRemote(undefined), null);
});

test('failed: clean state, or the last good snapshot marked stale', () => {
  assert.deepEqual(failed('signed-out', 'run gh auth login', NOW, null), { v: 1, state: 'signed-out', at: '2026-03-02T18:00:00.000Z', error: 'run gh auth login' });
  const prev = shape({ viewer, search: {}, nowMs: NOW - 3600e3 });
  const out = failed('error', 'network', NOW, prev);
  assert.equal(out.state, 'ok'); assert.equal(out.stale, true); assert.equal(out.staleReason, 'network');
  assert.equal(out.at, prev.at); assert.equal(out.checkedAt, '2026-03-02T18:00:00.000Z');
});

test('queries are scoped to the login passed in, nothing hard-coded', () => {
  const q = searchQuery('octo-owner');
  assert.match(q, /review-requested:octo-owner/);
  assert.match(q, /user:octo-owner -author:octo-owner/);
  // every login qualifier names the login passed in; the repo query names none (it asks for the viewer)
  for (const m of q.matchAll(/(?:review-requested|assignee|user|author):([\w-]+)/g)) assert.equal(m[1], 'octo-owner');
  assert.doesNotMatch(REPOS_QUERY, /(?:user|owner|login):/);
  assert.match(REPOS_QUERY, /ownerAffiliations:OWNER/);
});
