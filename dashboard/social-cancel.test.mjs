// POST /social/outbox/cancel — the popup's "Skip". The write-gate promise this
// pins (docs/sync/CONTRACT.md): cancel flips ONE staged action to 'canceled'
// and nothing else; it never publishes, never marks anything sent, and refuses
// (409, file untouched) for anything that is not staged.
//
// handleRoute is driven directly with a fake req/res — no port is bound (the
// owner's app holds the bridge port) and every outbox lives in a temp dir.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const social = require('./social-bridge.js');

const SEED = {
  updated: '2026-01-01T00:00:00.000Z',
  actions: [
    { id: 'act-staged-1', platform: 'bluesky', op: 'post', text: 'Shipped a calmer dashboard for project-a. https://example.org/a', status: 'staged', staged_at: '2026-01-01T00:00:00.000Z', by: 'claude' },
    { id: 'act-staged-2', platform: 'reddit', op: 'post', target: 'example', title: 'project-a notes', text: 'second staged', status: 'staged', staged_at: '2026-01-01T00:01:00.000Z', by: 'claude' },
    { id: 'act-sent', platform: 'mastodon', op: 'post', text: 'already out', status: 'sent', staged_at: '2026-01-01T00:00:00.000Z', sent_at: '2026-01-01T00:05:00.000Z', result: { url: 'https://example.org/p/1', uri: '' }, by: 'claude' },
    { id: 'act-failed', platform: 'x', op: 'post', text: 'did not go', status: 'failed', error: 'send failed', staged_at: '2026-01-01T00:00:00.000Z', by: 'claude' },
    { id: 'act-canceled', platform: 'bluesky', op: 'reply', reply_to: 'at://example/post/1', text: 'nope', status: 'canceled', staged_at: '2026-01-01T00:00:00.000Z', by: 'claude' },
  ],
};

let dataDir, outboxFile;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'hq-social-cancel-'));
  mkdirSync(join(dataDir, 'social'), { recursive: true });
  outboxFile = join(dataDir, 'social', 'outbox.json');
  writeFileSync(outboxFile, JSON.stringify(SEED, null, 2));
});
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

const readOutbox = () => JSON.parse(readFileSync(outboxFile, 'utf8'));
const byId = (d, id) => d.actions.find((a) => a.id === id);

// Fake request: headers + a body streamed on the next tick (handleRoute
// attaches its listeners synchronously). Resolves with the first send().
function call({ method = 'POST', url = '/social/outbox/cancel', headers = { 'x-hq-bridge': '1' }, body, raw, token = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.headers = headers;
    const res = {};
    let consumed;
    const send = (code, obj) => resolve({ code, body: obj, consumed });
    try { consumed = social.handleRoute(req, res, { url, send, token, dataDir }); } catch (e) { reject(e); return; }
    if (!consumed) { resolve({ code: null, body: null, consumed }); return; }
    setImmediate(() => {
      const text = raw !== undefined ? raw : (body === undefined ? '' : JSON.stringify(body));
      if (text) req.emit('data', Buffer.from(text, 'utf8'));
      req.emit('end');
    });
  });
}

test('a staged action flips to canceled — and nothing else in the outbox changes', async () => {
  const r = await call({ body: { id: 'act-staged-1' } });
  assert.equal(r.consumed, true);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, id: 'act-staged-1', status: 'canceled' });

  const d = readOutbox();
  const a = byId(d, 'act-staged-1');
  assert.equal(a.status, 'canceled');
  assert.match(a.canceled_at, /^\d{4}-\d\d-\d\dT/);
  // never published: no send bookkeeping appears on the canceled entry
  assert.equal(a.sent_at, undefined);
  assert.equal(a.result, undefined);
  assert.equal(a.text, SEED.actions[0].text);
  // every other action is exactly as seeded
  for (const seeded of SEED.actions.slice(1)) assert.deepEqual(byId(d, seeded.id), seeded, seeded.id);
  assert.equal(d.actions.length, SEED.actions.length);
  // the only 'sent' entry is the one that was already sent
  assert.deepEqual(d.actions.filter((x) => x.status === 'sent').map((x) => x.id), ['act-sent']);
});

test('a canceled action disappears from GET /social/outbox (the popup never sees it again)', async () => {
  await call({ body: { id: 'act-staged-1' } });
  const r = await call({ method: 'GET', url: '/social/outbox' });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.actions.map((a) => a.id), ['act-staged-2']);
});

test('a late send report for a canceled action is ignored — it can never become sent', async () => {
  await call({ body: { id: 'act-staged-1' } });
  const r = await call({ url: '/social/outbox/result', body: { id: 'act-staged-1', ok: true, url: 'https://example.org/x' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.ignored, true);
  assert.equal(byId(readOutbox(), 'act-staged-1').status, 'canceled');
});

for (const id of ['act-sent', 'act-failed', 'act-canceled']) {
  test(`not staged (${id}) → 409, file byte-identical`, async () => {
    const before = readFileSync(outboxFile, 'utf8');
    const r = await call({ body: { id } });
    assert.equal(r.code, 409);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.status, byId(SEED, id).status);
    assert.equal(readFileSync(outboxFile, 'utf8'), before);
  });
}

test('cancelling the same action twice: 200 then 409', async () => {
  assert.equal((await call({ body: { id: 'act-staged-2' } })).code, 200);
  const again = await call({ body: { id: 'act-staged-2' } });
  assert.equal(again.code, 409);
  assert.equal(again.body.status, 'canceled');
});

test('unknown id → 404, missing id → 400, bad json → 400; the file is untouched', async () => {
  const before = readFileSync(outboxFile, 'utf8');
  assert.equal((await call({ body: { id: 'no-such-action' } })).code, 404);
  assert.equal((await call({ body: {} })).code, 400);
  assert.equal((await call({ body: { id: '' } })).code, 400);
  assert.equal((await call({ raw: 'null' })).code, 400);
  assert.equal((await call({ raw: '{not json' })).code, 400);
  assert.equal(readFileSync(outboxFile, 'utf8'), before);
});

test('auth: no bridge header → 403; token set and missing/wrong → 403; right token → 200', async () => {
  const before = readFileSync(outboxFile, 'utf8');
  assert.equal((await call({ headers: {}, body: { id: 'act-staged-1' } })).code, 403);
  assert.equal((await call({ headers: { 'x-hq-bridge': '1' }, token: 's3cret', body: { id: 'act-staged-1' } })).code, 403);
  assert.equal((await call({ headers: { 'x-hq-bridge': '1', 'x-hq-token': 'nope' }, token: 's3cret', body: { id: 'act-staged-1' } })).code, 403);
  assert.equal(readFileSync(outboxFile, 'utf8'), before);
  const ok = await call({ headers: { 'x-hq-bridge': '1', 'x-hq-token': 's3cret' }, token: 's3cret', body: { id: 'act-staged-1' } });
  assert.equal(ok.code, 200);
});

test('oversized body → 413, nothing written', async () => {
  const before = readFileSync(outboxFile, 'utf8');
  const r = await call({ raw: JSON.stringify({ id: 'act-staged-1', pad: 'x'.repeat(70 * 1024) }) });
  assert.equal(r.code, 413);
  assert.equal(readFileSync(outboxFile, 'utf8'), before);
});

test('no outbox file yet → 404 and no file is created', async () => {
  rmSync(outboxFile);
  const r = await call({ body: { id: 'act-staged-1' } });
  assert.equal(r.code, 404);
  assert.equal(existsSync(outboxFile), false);
});

test('GET on the cancel path is not consumed (falls through to the caller)', async () => {
  const r = await call({ method: 'GET' });
  assert.equal(r.consumed, false);
});

test('the atomic write leaves no temp files behind', async () => {
  await call({ body: { id: 'act-staged-1' } });
  assert.deepEqual(readdirSync(join(dataDir, 'social')).sort(), ['outbox.json']);
});

// ---------------------------------------------------------------------------
// Extension half: socialSend (browser-bridge/social.js) re-checks with the app
// before publishing. A post that was skipped/canceled while the popup still
// showed it, a post whose payload changed, or an app that can't be reached
// must never reach the in-tab send. social.js is a classic service-worker
// script, so it runs in a vm context with a fake chrome + fetch.
// ---------------------------------------------------------------------------
const SOCIAL_JS = readFileSync(fileURLToPath(new URL('../browser-bridge/social.js', import.meta.url)), 'utf8');

function loadExtension({ outbox, outboxThrows = false } = {}) {
  const calls = { inject: [], results: [], gets: 0 };
  const chrome = {
    storage: { local: { get: async () => ({ hq_cfg: { endpoint: 'http://127.0.0.1:1', token: '' } }) } },
    tabs: { query: async () => [{ id: 7, url: 'https://bsky.app/profile/example' }, { id: 8, url: 'https://www.reddit.com/r/example/' }] },
    scripting: {
      executeScript: async (opts) => { calls.inject.push(opts); return [{ result: { ok: true, url: 'https://example.org/p/1' } }]; },
    },
  };
  const fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    if (path === '/social/outbox' && (!opts.method || opts.method === 'GET')) {
      calls.gets++;
      if (outboxThrows) throw new TypeError('Failed to fetch');
      return { json: async () => outbox };
    }
    if (path === '/social/outbox/result') { calls.results.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    throw new Error('unexpected fetch ' + url);
  };
  const ctx = vm.createContext({ chrome, fetch, URL, console, setTimeout, clearTimeout });
  vm.runInContext(SOCIAL_JS, ctx, { filename: 'social.js' });
  const socialSend = vm.runInContext('socialSend', ctx);
  return { socialSend, calls };
}

const SHOWN = { id: 'act-staged-1', platform: 'bluesky', op: 'post', text: 'Shipped a calmer dashboard for project-a.', status: 'staged' };
const staged = (over = {}) => ({ ok: true, actions: [{ ...SHOWN, staged_at: '2026-01-01T00:00:00.000Z', by: 'claude', ...over }] });

test('extension: a still-staged, unchanged post is sent once — with the app\'s copy', async () => {
  const { socialSend, calls } = loadExtension({ outbox: staged() });
  const res = await socialSend({ ...SHOWN });
  assert.equal(res.ok, true);
  assert.equal(calls.inject.length, 1);
  assert.equal(calls.inject[0].args[0].id, SHOWN.id);
  assert.equal(calls.inject[0].args[0].text, SHOWN.text);
  assert.deepEqual(calls.results.map((r) => [r.id, r.ok]), [[SHOWN.id, true]]);
});

test('extension: a post skipped/canceled after the popup rendered it is never sent', async () => {
  const { socialSend, calls } = loadExtension({ outbox: { ok: true, actions: [] } });   // GET lists staged only
  const res = await socialSend({ ...SHOWN });
  assert.equal(res.ok, false);
  assert.match(res.error, /no longer staged/);
  assert.equal(calls.inject.length, 0);
  assert.equal(calls.results.length, 0, 'nothing attempted, nothing reported');
});

test('extension: a payload that changed since it was shown is never sent', async () => {
  for (const over of [{ text: 'a different text' }, { platform: 'reddit' }, { reply_to: 'at://example/post/9' }, { title: 'new title' }, { target: 'example' }]) {
    const { socialSend, calls } = loadExtension({ outbox: staged(over) });
    const res = await socialSend({ ...SHOWN });
    assert.equal(res.ok, false, JSON.stringify(over));
    assert.match(res.error, /changed/);
    assert.equal(calls.inject.length, 0, JSON.stringify(over));
  }
});

test('extension: app unreachable or refusing → refused, never sent', async () => {
  const off = loadExtension({ outboxThrows: true });
  const r1 = await off.socialSend({ ...SHOWN });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /can't confirm/);
  assert.equal(off.calls.inject.length, 0);

  const refused = loadExtension({ outbox: { ok: false, error: 'forbidden' } });
  const r2 = await refused.socialSend({ ...SHOWN });
  assert.equal(r2.ok, false);
  assert.equal(refused.calls.inject.length, 0);
});

test('extension: no id → refused without asking the app', async () => {
  const { socialSend, calls } = loadExtension({ outbox: staged() });
  assert.equal((await socialSend({ platform: 'bluesky', text: 'x' })).ok, false);
  assert.equal(calls.gets, 0);
  assert.equal(calls.inject.length, 0);
});
