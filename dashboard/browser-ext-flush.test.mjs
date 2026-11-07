// background.js flush(): a success must remove only the events THAT flush sent.
// The old `queue: []` wipe erased focus sessions transition() appended while the
// POST was in flight (slow app, AV EPERM retry in writeAtomic) — silently, with
// lastOk set. background.js is a classic MV3 service-worker script, so it runs
// here in a vm with a fake chrome, like popup-approval.test.mjs does for popup.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHmac } from 'node:crypto';

const SRC = new URL('../browser-bridge/background.js', import.meta.url);
const EXT_FILE = (name) => new URL('../browser-bridge/' + name, import.meta.url);

function loadBackground({ store, fetchImpl }) {
  const listener = () => ({ addListener() {} });
  const chrome = {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; } } },
    runtime: { onInstalled: listener(), onStartup: listener(), onMessage: listener() },
    tabs: { onActivated: listener(), onUpdated: listener(), query: async () => [] },
    windows: { onFocusChanged: listener(), WINDOW_ID_NONE: -1 },
    idle: { onStateChanged: listener(), setDetectionInterval() {} },
    alarms: { onAlarm: listener(), create() {}, clear: async () => {} },
  };
  // importScripts runs the named extension scripts in this context, as the worker does. social.js / claude-sync.js are a
  // no-op (their globals are only touched by handlers this test never fires); the 0.7.0 scripts are real, because flush()
  // goes through HQGuard and the top level calls HQGrab.install().
  const ctx = vm.createContext({ chrome, fetch: fetchImpl, URL, console, setTimeout, clearTimeout, AbortController, TextEncoder, Uint8Array, Uint32Array, crypto: webcrypto });
  ctx.globalThis = ctx;
  ctx.importScripts = (...names) => { for (const n of names) if (!/^(social|claude-sync)\.js$/.test(n)) vm.runInContext(fs.readFileSync(EXT_FILE(n), 'utf8'), ctx, { filename: n }); };
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'background.js' });
  return ctx;
}

const sess = (n) => ({ url: `https://example.org/${n}`, domain: 'example.org', host: 'example.org', port: '', path: `/${n}`, title: 'placeholder ' + n, ts: 1000 + n, focus_ms: 2000 + n });
const tick = () => new Promise((r) => setImmediate(r));

test('a session queued during the in-flight POST survives the flush', async () => {
  const A = sess(1), B = sess(2), C = sess(3);
  const store = { hq_state: { queue: [A, B], current: null } };
  const bodies = [];
  const ctx = loadBackground({
    store,
    fetchImpl: async (url, o) => {
      bodies.push(JSON.parse(o.body));
      // transition() closes out a tab switch while the POST is still in flight
      store.hq_state = { ...store.hq_state, queue: [...store.hq_state.queue, C] };
      return { ok: true, status: 200 };
    },
  });
  await ctx.flush();
  assert.deepEqual(bodies[0].events, [A, B], 'the flush sent its snapshot');
  assert.deepEqual(store.hq_state.queue, [C], 'C queued mid-flight is kept, A and B are gone');
  assert.ok(store.hq_state.lastOk > 0); assert.equal(store.hq_state.lastError, '');
});

test('overlapping flushes: an event appended between snapshots is never dropped, already-sent ones never resurrect', async () => {
  const A = sess(1), B = sess(2), C = sess(3), D = sess(4);
  const store = { hq_state: { queue: [A, B], current: null } };
  const pending = [];
  const ctx = loadBackground({ store, fetchImpl: (url, o) => new Promise((resolve) => pending.push({ body: JSON.parse(o.body), resolve })) });

  const f1 = ctx.flush();                 // snapshots [A,B]
  await tick(); await tick();
  store.hq_state = { ...store.hq_state, queue: [...store.hq_state.queue, C] };
  const f2 = ctx.flush();                 // snapshots [A,B,C]
  await tick(); await tick();
  store.hq_state = { ...store.hq_state, queue: [...store.hq_state.queue, D] };   // D is in neither snapshot

  assert.equal(pending.length, 2);
  assert.deepEqual(pending[0].body.events, [A, B]);
  assert.deepEqual(pending[1].body.events, [A, B, C]);
  pending[1].resolve({ ok: true, status: 200 }); await f2;
  pending[0].resolve({ ok: true, status: 200 }); await f1;   // the count-based slice dropped D here
  assert.deepEqual(store.hq_state.queue, [D], 'D was never sent, so it stays queued');
});

test('a failed POST keeps the whole queue and records the error', async () => {
  const A = sess(1);
  const store = { hq_state: { queue: [A], current: null } };
  const ctx = loadBackground({ store, fetchImpl: async () => ({ ok: false, status: 500 }) });
  await ctx.flush();
  assert.deepEqual(store.hq_state.queue, [A]);
  assert.equal(store.hq_state.lastError, 'HTTP 500');
});

// ---- 0.7.0: flush goes through the endpoint guard (loopback only; a configured token needs the app's proof) ----
const proofFor = (token, url) => createHmac('sha256', token).update(new URL(url).searchParams.get('nonce')).digest('hex');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a non-loopback endpoint receives nothing: no fetch at all, the queue is kept, lastError says why', async () => {
  const A = sess(1);
  for (const endpoint of ['https://example.com', 'http://evil.example:47821', 'http://localhost@evil.example', 'http://[::1]:47821']) {
    const store = { hq_cfg: { endpoint, token: 'tok', paused: false }, hq_state: { queue: [A], current: null } };
    const urls = [];
    const ctx = loadBackground({ store, fetchImpl: async (url) => { urls.push(url); return reply(200, {}); } });
    await ctx.flush();
    assert.deepEqual(urls, [], endpoint);
    assert.deepEqual(store.hq_state.queue, [A], endpoint);
    assert.equal(store.hq_state.lastError, 'endpoint is not on this PC — not sent', endpoint);
  }
});

test('with a token, the app must prove it holds it first; an impostor on the port never sees the token or the sessions', async () => {
  const A = sess(1);
  const store = { hq_cfg: { endpoint: 'http://127.0.0.1:47821', token: 'tok', paused: false }, hq_state: { queue: [A], current: null } };
  const sent = [];
  const ctx = loadBackground({ store, fetchImpl: async (url, o = {}) => { sent.push({ url, headers: o.headers || {}, body: o.body }); return reply(200, { ok: true, app: 'workspacehq', proof: 'f'.repeat(64) }); } });
  await ctx.flush();
  assert.match(store.hq_state.lastError, /^something else is answering on port 47821 — not sent$/);
  assert.deepEqual(store.hq_state.queue, [A]);
  assert.ok(sent.every((s) => !s.headers['X-HQ-Token'] && s.body === undefined), 'only the token-less proof probe left');
});

test('with a token and a real proof the sessions are delivered, with the token and the bridge header', async () => {
  const A = sess(1);
  const store = { hq_cfg: { endpoint: 'http://127.0.0.1:47821', token: 'tok', paused: false }, hq_state: { queue: [A], current: null } };
  const posts = [];
  const ctx = loadBackground({ store, fetchImpl: async (url, o = {}) => {
    if (new URL(url).pathname === '/health') return reply(200, { ok: true, app: 'workspacehq', proof: proofFor('tok', url) });
    posts.push({ url, headers: o.headers, body: JSON.parse(o.body) });
    return reply(200, { ok: true });
  } });
  await ctx.flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'http://127.0.0.1:47821/ingest');
  assert.equal(posts[0].headers['X-HQ-Token'], 'tok'); assert.equal(posts[0].headers['X-HQ-Bridge'], '1');
  assert.deepEqual(posts[0].body.events, [A]);
  assert.deepEqual(store.hq_state.queue, []);
});

test('unpaired (no token): today\'s extension keeps working — loopback only, no proof needed, no lockout', async () => {
  const A = sess(1);
  const store = { hq_state: { queue: [A], current: null } };   // no hq_cfg at all: the stock endpoint, no token
  const seen = [];
  const ctx = loadBackground({ store, fetchImpl: async (url, o = {}) => { seen.push({ url, headers: o.headers || {} }); return reply(200, { ok: true }); } });
  await ctx.flush();
  assert.deepEqual(seen.map((s) => s.url), ['http://127.0.0.1:47821/ingest'], 'one POST, no /health probe');
  assert.equal(seen[0].headers['X-HQ-Bridge'], '1'); assert.equal(seen[0].headers['X-HQ-Token'], undefined);
  assert.deepEqual(store.hq_state.queue, []);
});

test('a pending pairing whose answer was lost is adopted by the next flush once the app proves it holds the token', async () => {
  const A = sess(1), TOK = 'ab'.repeat(32);
  const store = { hq_cfg: { endpoint: 'http://127.0.0.1:47821', token: '', paused: false }, hq_pair_pending: { token: TOK, code: '4821', startedAt: Date.now() }, hq_state: { queue: [A], current: null } };
  const posts = [];
  const ctx = loadBackground({ store, fetchImpl: async (url, o = {}) => {
    if (new URL(url).pathname === '/health') return reply(200, { ok: true, app: 'workspacehq', proof: proofFor(TOK, url) });
    posts.push({ headers: o.headers });
    return reply(200, { ok: true });
  } });
  await ctx.flush();
  assert.equal(store.hq_cfg.token, TOK, 'the pending token became the token');
  assert.equal(store.hq_pair_pending, undefined);
  assert.equal(posts.length, 1); assert.equal(posts[0].headers['X-HQ-Token'], TOK);
  assert.deepEqual(store.hq_state.queue, []);
});

test('a pending token the app cannot prove is not adopted, and delivery carries on without it', async () => {
  const A = sess(1), TOK = 'cd'.repeat(32);
  const store = { hq_cfg: { endpoint: 'http://127.0.0.1:47821', token: '', paused: false }, hq_pair_pending: { token: TOK, code: '4821', startedAt: Date.now() }, hq_state: { queue: [A], current: null } };
  const ctx = loadBackground({ store, fetchImpl: async (url) => (new URL(url).pathname === '/health' ? reply(200, { ok: true, app: 'workspacehq' }) : reply(200, { ok: true })) });
  await ctx.flush();
  assert.equal(store.hq_cfg.token, '');
  assert.ok(store.hq_pair_pending, 'still pending until it expires');
});
