import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createOpener, listedUrls, HOST_OK } = createRequire(import.meta.url)('./accounts-view.js');

const DASH = 'https://vercel.com/octo-team/site-a', PROD = 'https://site-a.vercel.app', DEP = 'https://site-a-x1.vercel.app';
const SB = 'https://supabase.com/dashboard/project/abc';
const acc = { v: 1,
  vercel: { state: 'ok', projects: [{ dashboard: DASH, prod: { url: PROD }, latest: { url: 'https://evil.example/x' } }, null], deploys: [{ url: DEP }, { url: 'http://site-a.vercel.app' }] },
  supabase: { state: 'ok', projects: [{ dashboard: SB }] } };
const make = (a = acc) => { const opened = []; return { opened, open: createOpener({ readAccounts: () => a, openExternal: async (u) => { opened.push(u); } }) }; };

test('opens Vercel / Supabase links listed in the current snapshot', async () => {
  const { open, opened } = make();
  for (const u of [DASH, PROD, DEP, SB]) assert.equal(await open(u), true, u);
  assert.deepEqual(opened, [DASH, PROD, DEP, SB]);
});

test('refuses unlisted links, other hosts and plain http — even when listed', async () => {
  const { open, opened } = make();
  assert.match((await open('https://vercel.com/octo-team/other')).error, /not in the current accounts snapshot/);
  assert.match((await open('https://evil.example/x')).error, /only Vercel and Supabase/);
  assert.match((await open('http://site-a.vercel.app')).error, /only Vercel and Supabase/);
  assert.deepEqual(opened, []);
  const { open: none } = make(null);
  assert.match((await none(DASH)).error, /not in the current accounts snapshot/);
  for (const bad of [null, 1, '', 'x'.repeat(3000)]) assert.ok((await open(bad)).error);
});

test('hosts', () => {
  assert.ok(HOST_OK('vercel.com') && HOST_OK('supabase.com') && HOST_OK('a-b.vercel.app'));
  assert.ok(!HOST_OK('vercel.app') && !HOST_OK('x.vercel.com') && !HOST_OK('a.b.vercel.app') && !HOST_OK('supabase.co'));
  assert.equal(listedUrls(acc).size, 6);
  assert.equal(listedUrls(null).size, 0);
});
