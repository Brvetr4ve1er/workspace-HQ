// Operator Brief senses, main side (dashboard/brief-sources.js): temp data dirs and fake hubs only; placeholder data.
//   node --test dashboard/brief-sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { gather } = require('./brief-sources.js');

const H = 3600e3;
const NOW = new Date('2026-11-07T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const fresh = iso(NOW.getTime() - 3 * H);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brief-src-'));
const put = (dir, file, v) => fs.writeFileSync(path.join(dir, file), typeof v === 'string' ? v : JSON.stringify(v));
const GH = { state: 'ok', at: fresh, partial: false, repos: [{ full: 'owner/alpha-site', ci: 'failure' }], waiting: [] };
const AC = { vercel: { state: 'ok', at: fresh, partial: false, projects: [{ name: 'alpha-site', prod: { state: 'ready' } }] }, supabase: {} };
const PC = { scanned_at: fresh, detail: { rebootPending: true } };
const proj = (id, dirty, p) => ({ id, name: id, path: p, metrics: { git_safety: { dirty } } });
const SCAN = { scan: { date: iso(NOW.getTime() - 1 * H) }, projects: [proj('alpha-site', 14, 'alpha-site'), proj('beta-site', 3, 'beta-site'), proj('gamma-site', 5, 'gamma-site'), proj('delta-site', 2, 'delta-site'), proj('eps-site', 1, 'eps-site')] };
const conv = (id, folder, o = {}) => ({ id, project_id: 'hub-' + folder, hq_project_id: null, cwd: 'C:/work/' + folder + '/src', last_at: iso(NOW.getTime() - 3 * H), title: 'Private title ' + id, ...o });
const opts = (dir, hub, extra = {}) => ({ dataDir: dir, hub, now: NOW, scan: SCAN, docsRoot: 'C:/work', timeoutMs: 60, ...extra });

function fakeHub(convs, o = {}) {
  const calls = [];
  const hub = {
    calls,
    request: async (op, args) => {
      calls.push({ op, args });
      if (o.hang === op) return new Promise(() => {});
      if (o.fail === op) throw new Error('hub exploded');
      if (o.errorReply === op) return { error: 'db locked' };
      if (op === 'listConversations') return convs;
      if (op === 'listProjects') return convs.map((c) => ({ id: c.project_id, path: c.cwd, hq_project_id: null, link_state: 'none' }));
      if (op === 'getConversation') return { conversation: {}, messages: [{ tool_name: 'Read' }, { tool_name: o.edit ? 'Edit' : null }] };
      return null;
    },
  };
  return hub;
}

test('each sidecar ok: github, the vercel section and the pc-health detail come back; no errors', async () => {
  const dir = tmp(); put(dir, 'github.json', GH); put(dir, 'accounts.json', AC); put(dir, 'pc-health.json', PC);
  const r = await gather(opts(dir, fakeHub([])));
  assert.equal(r.github.repos[0].full, 'owner/alpha-site');
  assert.equal(r.vercel.projects[0].name, 'alpha-site');
  assert.deepEqual(r.pcDetail, { scannedAt: fresh, rebootPending: true });
  assert.deepEqual(r.errors, []);
});

test('each sidecar absent: nothing, silently', async () => {
  const r = await gather(opts(tmp(), fakeHub([])));
  assert.equal(r.github, null); assert.equal(r.vercel, null); assert.equal(r.pcDetail, null);
  assert.deepEqual(r.errors, []);
});

test('unreadable, partial, not-ok and stale sidecars: null plus one named error each', async () => {
  const dir = tmp();
  put(dir, 'github.json', '{ nope');
  put(dir, 'accounts.json', { vercel: { ...AC.vercel, partial: true } });
  put(dir, 'pc-health.json', { scanned_at: iso(NOW.getTime() - 80 * H), detail: { rebootPending: true } });
  const r = await gather(opts(dir, fakeHub([])));
  assert.equal(r.github, null); assert.equal(r.vercel, null); assert.equal(r.pcDetail, null);
  assert.deepEqual(r.errors.map((e) => e.source).sort(), ['github', 'pc-health', 'vercel']);
  assert.match(r.errors.find((e) => e.source === 'github').error, /unreadable/);
  assert.match(r.errors.find((e) => e.source === 'vercel').error, /partial/);
  assert.match(r.errors.find((e) => e.source === 'pc-health').error, /older than 72 h/);

  const dir2 = tmp(); put(dir2, 'github.json', { ...GH, state: 'error' }); put(dir2, 'accounts.json', { vercel: { ...AC.vercel, at: iso(NOW.getTime() - 100 * H) } });
  const r2 = await gather(opts(dir2, fakeHub([])));
  assert.deepEqual(r2.errors.map((e) => e.source).sort(), ['github', 'vercel']);
  assert.match(r2.errors[0].error, /not in state ok|older than 72 h/);
});

test('one listConversations (source code, last 24 h, limit 30) and one listProjects; sessions carry no title', async () => {
  const hub = fakeHub([conv('s1', 'alpha-site')]);
  const r = await gather(opts(tmp(), hub));
  const lc = hub.calls.filter((c) => c.op === 'listConversations'), lp = hub.calls.filter((c) => c.op === 'listProjects');
  assert.equal(lc.length, 1); assert.equal(lp.length, 1);
  assert.deepEqual(lc[0].args, { source: 'code', since: iso(NOW.getTime() - 24 * H), limit: 30 });
  assert.equal(r.sessions.length, 1);
  assert.deepEqual(Object.keys(r.sessions[0]).sort(), ['cwd', 'hqProjectId', 'id', 'lastAt', 'projectId']);
  assert.ok(!JSON.stringify(r).includes('Private title'));
  assert.deepEqual(Object.keys(r.hubProjects[0]).sort(), ['hqProjectId', 'id', 'linkState', 'path']);
});

test('turns are fetched only for sessions that matched a project with 1-9 uncommitted files, at most 3', async () => {
  // alpha 14 files (verdict needs no turns), beta 3, gamma 5, delta 2, eps 1, zeta unmatched
  const convs = ['alpha-site', 'beta-site', 'gamma-site', 'delta-site', 'eps-site', 'zeta-site'].map((f, i) => conv('s' + i, f));
  const hub = fakeHub(convs, { edit: true });
  const r = await gather(opts(tmp(), hub));
  const got = hub.calls.filter((c) => c.op === 'getConversation');
  assert.equal(got.length, 3);
  assert.ok(got.every((c) => c.args.limit === 8));
  assert.deepEqual(got.map((c) => c.args.id).sort(), ['s1', 's2', 's3']);
  assert.deepEqual(Object.keys(r.sessionTurns).sort(), ['s1', 's2', 's3']);
  assert.deepEqual(r.sessionTurns.s1, [{ toolName: 'Read' }, { toolName: null }].map((t, i) => (i === 1 ? { toolName: 'Edit' } : t)));
});

test('no turns at all when no scan is known, or when the sessions ended after it', async () => {
  const hub = fakeHub([conv('s1', 'beta-site')]);
  await gather({ ...opts(tmp(), hub), scan: null });
  assert.equal(hub.calls.filter((c) => c.op === 'getConversation').length, 0);
  const hub2 = fakeHub([conv('s1', 'beta-site', { last_at: iso(NOW.getTime() - 10 * 60e3) })]);   // after the scan an hour ago
  await gather(opts(tmp(), hub2));
  assert.equal(hub2.calls.filter((c) => c.op === 'getConversation').length, 0);
});

test('the scan is read from the data dir when not passed', async () => {
  const dir = tmp(); put(dir, 'latest.json', SCAN);
  const hub = fakeHub([conv('s1', 'beta-site')]);
  await gather({ dataDir: dir, hub, now: NOW, docsRoot: 'C:/work', timeoutMs: 60 });
  assert.equal(hub.calls.filter((c) => c.op === 'getConversation').length, 1);
});

test('a hub that hangs, throws or answers an error lands in errors[] (source claude-code) and never throws', async () => {
  for (const o of [{ hang: 'listConversations' }, { fail: 'listProjects' }, { errorReply: 'listConversations' }]) {
    const r = await gather(opts(tmp(), fakeHub([conv('s1', 'beta-site')], o)));
    assert.ok(r.errors.some((e) => e.source === 'claude-code'), JSON.stringify(o));
    assert.ok(Array.isArray(r.sessions) && Array.isArray(r.hubProjects));
  }
  const hung = await gather(opts(tmp(), fakeHub([conv('s1', 'beta-site')], { hang: 'listConversations' })));
  assert.match(hung.errors.find((e) => e.source === 'claude-code').error, /timed out/);
  assert.deepEqual(hung.sessions, []);
});

test('a failing turns fetch is one error; the other sense inputs survive', async () => {
  const hub = fakeHub([conv('s1', 'beta-site')], { hang: 'getConversation' });
  const dir = tmp(); put(dir, 'github.json', GH);
  const r = await gather(opts(dir, hub));
  assert.ok(r.github);
  assert.equal(r.sessions.length, 1);
  assert.deepEqual(r.sessionTurns, {});
  assert.equal(r.errors.filter((e) => e.source === 'claude-code').length, 1);
});

test('security: status.json is read directly, so a 40-day-old footprint still arrives; absent is null without an error; corrupt is one named error', async () => {
  const dir = tmp();
  assert.equal((await gather(opts(dir, fakeHub([])))).security, null, 'absent');
  assert.deepEqual((await gather(opts(dir, fakeHub([])))).errors.filter((e) => e.source === 'security'), []);
  fs.mkdirSync(path.join(dir, 'security'));
  put(path.join(dir, 'security'), 'status.json', { v: 1, at: iso(NOW.getTime() - 40 * 24 * H), refreshedAt: iso(NOW.getTime() - 40 * 24 * H), exportsFound: 2, counts: { breached: 1, reused: 3, planted: 9 }, planted: 'x' });
  let r = await gather(opts(dir, fakeHub([])));
  assert.equal(r.security.exportsFound, 2);
  assert.deepEqual(r.security.counts, { breached: 1, reused: 3 }, 'only the numbers the rules read');
  assert.ok(!('planted' in r.security));
  assert.deepEqual(r.errors.filter((e) => e.source === 'security'), [], 'the 72 h sidecar rule does not apply to it');
  put(path.join(dir, 'security'), 'status.json', { v: 1 });
  r = await gather(opts(dir, fakeHub([])));
  assert.ok(r.security && r.security.at === null, 'a scan write without at: usable, age unknown');
  put(path.join(dir, 'security'), 'status.json', '{ nope');
  r = await gather(opts(dir, fakeHub([])));
  assert.equal(r.security, null);
  assert.equal(r.errors.filter((e) => e.source === 'security').length, 1);
});

test('no hub, a garbage hub, or no arguments: an empty result, never a throw', async () => {
  const dir = tmp();
  for (const a of [{ dataDir: dir, now: NOW }, { dataDir: dir, hub: {}, now: NOW }, { dataDir: dir, hub: { request: 'x' }, now: NOW }, undefined]) {
    const r = await gather(a);
    assert.deepEqual(r.sessions, []);
    assert.ok(Array.isArray(r.errors));
  }
  const r = await gather({ dataDir: path.join(dir, 'missing'), hub: fakeHub([]), now: () => NOW, scan: SCAN, timeoutMs: 60 });
  assert.equal(r.github, null);
});
