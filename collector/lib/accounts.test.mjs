import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeVercel, shapeSupabase, failedAccount, sidecar } from './accounts.mjs';

const NOW = Date.parse('2026-03-02T18:00:00Z');
const t = (iso) => Date.parse(iso);

test('vercel: projects with production + latest deploy, repo link, dashboard, totals', () => {
  const out = shapeVercel({
    user: { username: 'octo-owner' }, nowMs: NOW,
    projects: [
      { name: 'site-a', framework: 'nextjs', updatedAt: t('2026-03-01T00:00:00Z'), link: { type: 'github', org: 'octo-owner', repo: 'site-a' },
        latestDeployments: [{ readyState: 'READY', target: 'production', url: 'site-a.vercel.app', createdAt: t('2026-02-28T00:00:00Z') },
          { readyState: 'BUILDING', target: null, url: 'site-a-git-x.vercel.app', createdAt: t('2026-03-01T00:00:00Z'), meta: { githubCommitMessage: 'placeholder\nbody', githubCommitRef: 'feat' } }] },
      { name: 'site b', updatedAt: t('2026-03-02T00:00:00Z'), latestDeployments: [{ readyState: 'BLOCKED', target: 'production', url: 'https://b.vercel.app', createdAt: t('2026-03-02T00:00:00Z') }] },
      null,
    ],
    deployments: [{ name: 'site-a', state: 'ERROR', url: 'x.vercel.app', created: t('2026-03-01T12:00:00Z') }, { name: 'site b', state: 'weird', created: t('2026-03-02T00:00:00Z') }],
  });
  assert.equal(out.state, 'ok'); assert.equal(out.user, 'octo-owner');
  assert.deepEqual(out.projects.map((p) => p.name), ['site b', 'site-a']);
  const a = out.projects[1];
  assert.equal(a.repo, 'octo-owner/site-a'); assert.equal(a.dashboard, 'https://vercel.com/octo-owner/site-a');
  assert.deepEqual([a.prod.state, a.prod.url, a.latest.state, a.latest.target, a.latest.commit, a.latest.branch], ['ready', 'https://site-a.vercel.app', 'building', 'preview', 'placeholder', 'feat']);
  assert.equal(out.projects[0].dashboard, 'https://vercel.com/octo-owner/site%20b');
  const teamed = shapeVercel({ user: { username: 'octo-owner' }, teams: [{ id: 't1', slug: 'octo-team' }], projects: [{ name: 'p', accountId: 't1' }], nowMs: NOW });
  assert.equal(teamed.projects[0].dashboard, 'https://vercel.com/octo-team/p');
  assert.equal(out.projects[0].repo, null);
  assert.deepEqual(out.totals, { projects: 2, prodFailing: 1, building: 1 });
  assert.deepEqual(out.deploys.map((d) => [d.project, d.state]), [['site b', 'unknown'], ['site-a', 'error']]);
  assert.equal(out.partial, false);
});

test('vercel: junk in, empty out; errors make it partial', () => {
  const out = shapeVercel({ user: null, projects: 'x', deployments: [3], nowMs: NOW, errors: ['deployments: timeout'] });
  assert.deepEqual([out.projects, out.deploys, out.user, out.partial], [[], [], '', true]);
});

test('supabase: projects, dashboard link, unhealthy count', () => {
  const out = shapeSupabase({ nowMs: NOW, list: [{ id: 'abc', name: 'db-a', region: 'eu-west-1', status: 'ACTIVE_HEALTHY', created_at: '2026-01-01' }, { id: 'def', name: 'db-b', status: 'INACTIVE' }, null] });
  assert.deepEqual(out.projects.map((p) => [p.name, p.status, p.dashboard]), [['db-a', 'active_healthy', 'https://supabase.com/dashboard/project/abc'], ['db-b', 'inactive', 'https://supabase.com/dashboard/project/def']]);
  assert.deepEqual(out.totals, { projects: 2, unhealthy: 1 });
});

test('failedAccount keeps the last good snapshot, marked stale', () => {
  assert.deepEqual(failedAccount('no-cli', 'install it', NOW, null), { state: 'no-cli', at: '2026-03-02T18:00:00.000Z', error: 'install it' });
  const prev = shapeSupabase({ list: [], nowMs: NOW - 1000 });
  const out = failedAccount('error', 'network', NOW, prev);
  assert.deepEqual([out.state, out.stale, out.staleReason], ['ok', true, 'network']);
  assert.deepEqual(sidecar(1, 2), { v: 1, vercel: 1, supabase: 2 });
});
