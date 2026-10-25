import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SRC = new URL('../browser-bridge/claude-sync.js', import.meta.url);
const X = require('../browser-bridge/claude-sync.js');

const resp = ({ status = 200, json, headers = {} } = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => { if (json === undefined) throw new Error('not json'); return json; } });
const ORG = [{ uuid: 'org-1' }];
const chat = (uuid, updated) => ({ uuid, name: 'Chat ' + uuid, updated_at: updated });
const full = (uuid) => ({ uuid, name: 'Chat ' + uuid, updated_at: '2026-10-05T09:00:00Z', chat_messages: [{ uuid: uuid + '-m', sender: 'human', text: 'placeholder' }] });

function rig({ list, projects = [], state = { conversations: {}, projects: {}, forgotten: [] }, override = () => null, skip, batch, maxPushBytes }) {
  let t = 0; const reqs = [], sleeps = [], pushes = [];
  const now = () => t;
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const fetch = async (url, o = {}) => {
    reqs.push({ url, method: o.method, body: o.body, credentials: o.credentials, at: t });
    t += 10;
    const forced = override(url, reqs.length); if (forced) return resp(forced);
    const p = new URL(url).pathname;
    if (p === '/api/organizations') return resp({ json: ORG });
    if (p.endsWith('/projects')) return resp({ json: projects });
    if (p.endsWith('/chat_conversations')) return resp({ json: list });
    const id = p.split('/').pop();
    return resp({ json: full(id) });
  };
  const app = { state: async () => state, push: async (body) => { pushes.push(JSON.parse(body)); return { ok: true }; } };
  const d = { fetch, sleep, pace: X.claudeCreatePacer({ now, sleep }), app, skip, batch, maxPushBytes };
  return { d, reqs, sleeps, pushes };
}

test('paced, GET-only, newest first; forgotten and unchanged chats are not fetched', async () => {
  const r = rig({ list: [chat('a', '2026-10-01T00:00:00Z'), chat('b', '2026-10-03T00:00:00Z'), chat('gone', '2026-10-04T00:00:00Z'), chat('same', '2026-10-02T00:00:00Z')],
    projects: [{ uuid: 'p1', name: 'project-a', updated_at: '2026-10-01T00:00:00Z' }],
    state: { conversations: { same: '2026-10-02T00:00:00.000Z' }, projects: {}, forgotten: ['gone'] } });
  const out = await X.claudeSyncRun(r.d);
  assert.deepEqual(out, { pushed: 2, projects: 1, left: 0, tooBig: 0, tooBigIds: {} });
  const claude = r.reqs.filter((q) => q.url.startsWith('https://claude.ai/'));
  assert.ok(claude.every((q) => q.method === 'GET' && q.body === undefined && q.credentials === 'include' && q.url.startsWith('https://claude.ai/api/')));
  assert.deepEqual(claude.map((q) => new URL(q.url).pathname.split('/').pop()), ['organizations', 'projects', 'chat_conversations', 'b', 'a']);
  for (let i = 1; i < claude.length; i++) assert.ok(claude[i].at - claude[i - 1].at >= 2000, 'at most one claude.ai request per 2 s');
  assert.deepEqual(r.pushes.map((p) => p.items.map((it) => it.kind + ':' + it.data.uuid)), [['project:p1'], ['conversation:b'], ['conversation:a']]);
  assert.ok(r.pushes.every((p) => p.v === 1));
});

test('429 honours Retry-After; 5xx backs off exponentially, then gives up with retryIn; long Retry-After is not slept inline', async () => {
  let n = 0;
  const a = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') && n++ === 0 ? { status: 429, headers: { 'retry-after': '5' } } : null) });
  await X.claudeSyncRun(a.d);
  assert.ok(a.sleeps.includes(5000));
  const b = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') ? { status: 503 } : null) });
  await assert.rejects(X.claudeSyncRun(b.d), (e) => e.kind === 'backoff' && e.retryIn === 32000);
  assert.deepEqual(b.sleeps.filter((s) => s >= 4000), [4000, 8000, 16000]);
  assert.equal(b.reqs.filter((q) => q.url.endsWith('/chat_conversations')).length, 4);
  const c = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') ? { status: 429, headers: { 'retry-after': '3600' } } : null) });
  await assert.rejects(X.claudeSyncRun(c.d), (e) => e.kind === 'backoff' && e.retryIn === 600000);
  assert.ok(!c.sleeps.some((s) => s > 30000), 'never sleeps minutes inside a service worker');
});

test('a shape change pauses with a visible message and pushes nothing', async () => {
  const r = rig({ list: { conversations: [] } });
  await assert.rejects(X.claudeSyncRun(r.d), (e) => e.kind === 'paused' && /claude\.ai changed, sync paused/.test(e.message));
  assert.equal(r.pushes.length, 0);
  const s = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], override: (u) => (u.includes('/chat_conversations/a') ? { json: { uuid: 'a', chat_messages: 'nope' } } : null) });
  await assert.rejects(X.claudeSyncRun(s.d), (e) => e.kind === 'paused');
  const t = rig({ list: [], override: (u) => (u.endsWith('/api/organizations') ? { status: 200 } : null) });   // not JSON
  await assert.rejects(X.claudeSyncRun(t.d), (e) => e.kind === 'paused');
});

test('signed out, deleted chat, batch cap, too-big chats remembered', async () => {
  const so = rig({ list: [], override: (u) => (u.endsWith('/api/organizations') ? { status: 401 } : null) });
  await assert.rejects(X.claudeSyncRun(so.d), (e) => e.kind === 'signed-out');
  const del = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], override: (u) => (u.includes('/chat_conversations/a') ? { status: 404 } : null) });
  assert.equal((await X.claudeSyncRun(del.d)).pushed, 0);
  const many = rig({ list: Array.from({ length: 25 }, (_, i) => chat('c' + i, '2026-10-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z')) });
  const out = await X.claudeSyncRun(many.d);
  assert.equal(out.pushed, 20); assert.equal(out.left, 5);
  assert.equal(many.pushes[0].items[0].data.uuid, 'c24', 'newest first');
  const big = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], maxPushBytes: 50 });
  const ob = await X.claudeSyncRun(big.d);
  assert.deepEqual([ob.pushed, ob.tooBig, ob.tooBigIds], [0, 1, { a: '2026-10-01T00:00:00Z' }]);
  const again = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], maxPushBytes: 50, skip: ob.tooBigIds });
  await X.claudeSyncRun(again.d);
  assert.ok(!again.reqs.some((q) => q.url.includes('/chat_conversations/a')), 'a known too-big chat is not refetched until it changes');
  assert.match(X.claudeSummary({ pushed: 3, projects: 0, left: 5, tooBig: 1 }), /^Synced 3 chats · 5 left — next batch in 5 min · 1 too large for live sync — use the export$/);
  assert.equal(X.claudeSummary({ pushed: 0, projects: 0, left: 0, tooBig: 0 }), 'Up to date');
});

test('app client: bridge headers, token, 409 and offline are app errors', async () => {
  const seen = [];
  const f = async (url, o = {}) => { seen.push([url, o]); return url.endsWith('/claude/sync') ? resp({ status: 409, json: { ok: false } }) : resp({ json: { ok: true, conversations: {}, projects: {}, forgotten: [] } }); };
  const app = X.claudeAppClient({ endpoint: 'http://127.0.0.1:47821', token: 'tok' }, f);
  assert.deepEqual((await app.state()).forgotten, []);
  assert.equal(seen[0][1].headers['X-HQ-Bridge'], '1'); assert.equal(seen[0][1].headers['X-HQ-Token'], 'tok');
  await assert.rejects(app.push('{}'), (e) => e.kind === 'app' && /owns the Claude index/.test(e.message));
  const off = X.claudeAppClient({ endpoint: 'http://127.0.0.1:1', token: '' }, async () => { throw new Error('refused'); });
  await assert.rejects(off.state(), (e) => e.kind === 'app' && /not reachable/.test(e.message));
});

test('every top-level name is claude-prefixed (shared classic-script global scope)', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const names = [...src.matchAll(/^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.length > 5);
  for (const n of names) assert.match(n, /^(claude|CLAUDE_)/, n);
  assert.ok(!/\bmethod:\s*'(POST|PUT|PATCH|DELETE)'[^\n]*claude\.ai/i.test(src));
});

import vm from 'node:vm';

function chromeFake({ on = true, granted = true, tabs = 1, state = {} } = {}) {
  const store = { hq_claude: { on, status: on ? 'idle' : 'off', ...state } }, alarms = new Map();
  return { store, alarms, chrome: {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } },
    alarms: { create: (n, o) => alarms.set(n, o), clear: async (n) => alarms.delete(n) },
    permissions: { contains: async () => granted },
    tabs: { query: async () => Array.from({ length: tabs }, () => ({ url: 'https://claude.ai/new' })) },
  } };
}
function loadTick(fake, fetchImpl) {
  const ctx = vm.createContext({ chrome: fake.chrome, fetch: fetchImpl, getCfg: async () => ({ endpoint: 'http://127.0.0.1:47821', token: '' }), setTimeout, TextEncoder, URL, console });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);
  return ctx;
}
const fastSleep = async () => {};
function fakeFetch(calls, { list = [] } = {}) {
  return async (url, o = {}) => {
    calls.push(url);
    const p = new URL(url).pathname;
    if (p === '/claude/sync-state') return resp({ json: { ok: true, conversations: {}, projects: {}, forgotten: [] } });
    if (p === '/claude/sync') return resp({ json: { ok: true, report: {} } });
    if (p === '/api/organizations') return resp({ json: ORG });
    if (p.endsWith('/projects')) return resp({ json: [] });
    if (p.endsWith('/chat_conversations')) return resp({ json: list });
    return resp({ json: full(p.split('/').pop()) });
  };
}

test('tick: off / no permission / no claude.ai tab never touch claude.ai', async () => {
  for (const [opts, status] of [[{ on: false }, 'off'], [{ granted: false }, 'no-permission'], [{ tabs: 0 }, 'no-tab']]) {
    const calls = [], fake = chromeFake(opts), ctx = loadTick(fake, fakeFetch(calls));
    const s = await ctx.claudeSyncTick({ sleep: fastSleep });
    assert.equal(s.status, status); assert.equal(calls.length, 0, status);
  }
});

test('tick: a good run records ok + summary + lastSyncAt; paused waits for a manual click; backoff window respected', async () => {
  const calls = [], fake = chromeFake(), ctx = loadTick(fake, fakeFetch(calls, { list: [chat('a', '2026-10-01T00:00:00Z')] }));
  const s = await ctx.claudeSyncTick({ sleep: fastSleep });
  assert.equal(s.status, 'ok'); assert.equal(s.message, 'Synced 1 chat'); assert.ok(s.lastSyncAt > 0); assert.equal(s.running, 0);
  const p = chromeFake({ state: { status: 'paused', message: 'claude.ai changed, sync paused (list looks different)' } }), pc = [];
  const pctx = loadTick(p, fakeFetch(pc));
  assert.equal((await pctx.claudeSyncTick({ sleep: fastSleep })).status, 'paused'); assert.equal(pc.length, 0);
  assert.equal((await pctx.claudeSyncTick({ manual: true, sleep: fastSleep })).status, 'ok');
  const b = chromeFake({ state: { status: 'backoff', nextAt: Date.now() + 60000 } }), bc = [];
  const bctx = loadTick(b, fakeFetch(bc));
  await bctx.claudeSyncTick({ sleep: fastSleep }); assert.equal(bc.length, 0);
});

test('tick: a shape change becomes a visible paused status', async () => {
  const calls = [], fake = chromeFake();
  const ctx = loadTick(fake, async (url) => { calls.push(url); return new URL(url).pathname === '/claude/sync-state' ? resp({ json: { conversations: {}, projects: {}, forgotten: [] } }) : resp({ json: { not: 'an array' } }); });
  const s = await ctx.claudeSyncTick({ sleep: fastSleep });
  assert.equal(s.status, 'paused'); assert.match(s.message, /claude\.ai changed, sync paused/);
});

test('claudeSetOn: alarm on/off', async () => {
  const fake = chromeFake({ on: false }), ctx = loadTick(fake, fakeFetch([]));
  await ctx.claudeSetOn(true, { sleep: fastSleep });
  assert.deepEqual({ ...fake.alarms.get('claude-sync') }, { periodInMinutes: 5 });  // spread: vm-realm object
  const off = await ctx.claudeSetOn(false);
  assert.equal(off.status, 'off'); assert.equal(fake.alarms.has('claude-sync'), false);
});

test('tick: unticking "on" mid-run stops the reads and the status stays off', async () => {
  const list = ['a', 'b', 'c', 'd'].map((id, i) => chat(id, '2026-10-0' + (i + 1) + 'T00:00:00Z')), calls = [], fake = chromeFake();
  const base = fakeFetch(calls, { list });
  const ctx = loadTick(fake, async (url, o) => {
    const r = await base(url, o);
    if (url.includes('/chat_conversations/d?')) fake.store.hq_claude = { ...fake.store.hq_claude, on: false, status: 'off', message: 'Off — nothing is read from claude.ai.', running: 0 };
    return r;
  });
  const s = await ctx.claudeSyncTick({ sleep: fastSleep });
  assert.equal(s.status, 'off'); assert.equal(s.on, false); assert.match(s.message, /^Off/);
  assert.equal(calls.filter((u) => /chat_conversations\/[a-d]\?/.test(u)).length, 1, 'no GET after the switch went off');
  assert.equal(fake.store.hq_claude.status, 'off');
});

test('manifest 0.4.0, background wiring, popup controls and the risk note', () => {
  const read = (f) => fs.readFileSync(new URL('../browser-bridge/' + f, import.meta.url), 'utf8');
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.version, '0.4.0'); assert.ok(m.optional_host_permissions.includes('https://claude.ai/*'));
  assert.ok(!m.host_permissions.some((h) => h.includes('claude.ai')), 'claude.ai stays optional, granted on the owner\'s click');
  const bg = read('background.js');
  assert.match(bg, /importScripts\('claude-sync\.js'\)/);
  assert.match(bg, /a\.name === CLAUDE_SYNC_ALARM\) claudeSyncTick\(\)/);
  assert.match(bg, /msg\.type === 'claude:set'/);
  const html = read('popup.html');
  for (const id of ['claude-on', 'claude-sync', 'claude-status', 'claude-last']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /not a public API/); assert.match(html, /export/);
  const pj = read('popup.js');
  assert.match(pj, /chrome\.permissions\.request\(\{ origins: \['https:\/\/claude\.ai\/\*'\] \}\)/);
});
