import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createOpener, createRefresher, listedUrls } = createRequire(import.meta.url)('./github-view.js');

const REPO = 'https://github.com/octo-owner/alpha';
const PR = 'https://github.com/other/x/pull/1';
const gh = { state: 'ok', repos: [{ url: REPO }, { url: 'https://evil.example/octo-owner/alpha' }, { url: 'http://github.com/octo-owner/beta' }], waiting: [{ url: PR }], mine: [null], issues: [{ url: 7 }] };

const make = (data = gh) => {
  const opened = [];
  return { opened, open: createOpener({ readGithub: () => data, openExternal: async (u) => { opened.push(u); } }) };
};

test('opens a github.com link listed in the current snapshot', async () => {
  const { open, opened } = make();
  assert.equal(await open(REPO), true);
  assert.equal(await open(PR), true);
  assert.deepEqual(opened, [REPO, PR]);
});

test('refuses unlisted links, near-misses, other hosts and plain http — even when listed', async () => {
  const { open, opened } = make();
  for (const u of ['https://github.com/octo-owner/other', REPO + '/', REPO.toUpperCase(), 'https://claude.ai/new']) assert.match((await open(u)).error, /not in the current GitHub snapshot/);
  assert.match((await open('https://evil.example/octo-owner/alpha')).error, /only github\.com/);
  assert.match((await open('http://github.com/octo-owner/beta')).error, /only github\.com/);
  assert.deepEqual(opened, []);
});

test('bad input and a missing snapshot are refused', async () => {
  const { open } = make(null);
  assert.match((await open(REPO)).error, /not in the current GitHub snapshot/);
  const { open: o2 } = make();
  for (const bad of [null, 42, '', {}, 'x'.repeat(3000)]) assert.ok((await o2(bad)).error);
});

test('an openExternal failure comes back as an error', async () => {
  const open = createOpener({ readGithub: () => gh, openExternal: async () => { throw new Error('no handler'); } });
  assert.deepEqual(await open(REPO), { error: 'no handler' });
});

test('refresh: one run at a time, rebuilds after success, answers the sidecar', async () => {
  let runs = 0, rebuilt = 0, release;
  const gate = new Promise((r) => { release = r; });
  const refresh = createRefresher({ run: async () => { runs++; await gate; }, readGithub: () => ({ state: 'ok' }), rebuild: () => { rebuilt++; } });
  const a = refresh(), b = refresh();
  assert.equal(a, b);
  release();
  assert.deepEqual(await a, { state: 'ok' });
  assert.equal(runs, 1); assert.equal(rebuilt, 1);
  await refresh();
  assert.equal(runs, 2);
});

test('refresh: a failed run answers the last snapshot, or the error when there is none', async () => {
  const boom = async () => { throw new Error('github.mjs exit 1'); };
  let rebuilt = 0;
  assert.deepEqual(await createRefresher({ run: boom, readGithub: () => ({ state: 'ok', stale: true }), rebuild: () => { rebuilt++; } })(), { state: 'ok', stale: true });
  assert.equal(rebuilt, 0);
  assert.deepEqual(await createRefresher({ run: boom, readGithub: () => null })(), { error: 'github.mjs exit 1' });
});

test('listedUrls tolerates junk', () => {
  assert.equal(listedUrls(gh).size, 4);
  assert.equal(listedUrls('x').size, 0);
});
