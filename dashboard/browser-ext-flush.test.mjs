// background.js flush(): a success must remove only the events THAT flush sent.
// The old `queue: []` wipe erased focus sessions transition() appended while the
// POST was in flight (slow app, AV EPERM retry in writeAtomic) — silently, with
// lastOk set. background.js is a classic MV3 service-worker script, so it runs
// here in a vm with a fake chrome, like popup-approval.test.mjs does for popup.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = new URL('../browser-bridge/background.js', import.meta.url);

function loadBackground({ store, fetchImpl }) {
  const listener = () => ({ addListener() {} });
  const chrome = {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } },
    runtime: { onInstalled: listener(), onStartup: listener(), onMessage: listener() },
    tabs: { onActivated: listener(), onUpdated: listener(), query: async () => [] },
    windows: { onFocusChanged: listener(), WINDOW_ID_NONE: -1 },
    idle: { onStateChanged: listener(), setDetectionInterval() {} },
    alarms: { onAlarm: listener(), create() {}, clear: async () => {} },
  };
  // importScripts no-op: social.js / claude-sync.js globals are only touched by
  // handlers this test never fires.
  const ctx = vm.createContext({ chrome, fetch: fetchImpl, importScripts: () => {}, URL, console, setTimeout });
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
