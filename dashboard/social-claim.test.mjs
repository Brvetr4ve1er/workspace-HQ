// Claim before publish (docs/sync/CONTRACT.md, 2026-10-07 amendment).
//
//   POST /social/outbox/claim    staged -> sending, atomically, before any adapter runs
//   POST /social/outbox/cancel   refuses a 'sending' post (409 'already publishing')
//   POST /social/outbox/result   settles sending -> sent | failed
//   POST /social/outbox/release  owner-only escape hatch: a claim older than
//                                CLAIM_STALE_MIN with no result -> staged (never publishes)
//
// The relay is driven through handleRoute with a fake req/res (no port is bound —
// the owner's app holds the bridge port) and every outbox lives in a temp dir. The
// extension half (browser-bridge/social.js) runs in a vm whose fetch is wired to
// that same real relay, so the claim/cancel races below are end to end.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const social = require('./social-bridge.js');

const MIN = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const STALE = social.CLAIM_STALE_MIN * MIN;

// Placeholder content only (public repo).
function seed() {
  const base = { staged_at: '2026-01-01T00:00:00.000Z', by: 'claude' };
  return {
    updated: '2026-01-01T00:00:00.000Z',
    actions: [
      { ...base, id: 'act-staged-1', platform: 'bluesky', op: 'post', text: 'Shipped a calmer dashboard for project-a. https://example.org/a', status: 'staged' },
      { ...base, id: 'act-staged-2', platform: 'reddit', op: 'post', target: 'example', title: 'project-a notes', text: 'second staged — ünïcødé ✓ 🚀', status: 'staged' },
      { ...base, id: 'act-sending-fresh', platform: 'mastodon', op: 'post', text: 'in flight', status: 'sending', claimed_at: ago(1 * MIN) },
      { ...base, id: 'act-sending-stale', platform: 'bluesky', op: 'reply', reply_to: 'at://example/post/1', text: 'stuck', status: 'sending', claimed_at: ago(STALE + 1 * MIN) },
      { ...base, id: 'act-sending-noclaim', platform: 'bluesky', op: 'post', text: 'hand-edited claim', status: 'sending' },
      { ...base, id: 'act-sent', platform: 'mastodon', op: 'post', text: 'already out', status: 'sent', sent_at: '2026-01-01T00:05:00.000Z', result: { url: 'https://example.org/p/1', uri: '' } },
      { ...base, id: 'act-failed', platform: 'x', op: 'post', text: 'did not go', status: 'failed', error: 'send failed' },
      { ...base, id: 'act-canceled', platform: 'bluesky', op: 'post', text: 'nope', status: 'canceled' },
    ],
  };
}

let dataDir, outboxFile, SEED;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'hq-social-claim-'));
  mkdirSync(join(dataDir, 'social'), { recursive: true });
  outboxFile = join(dataDir, 'social', 'outbox.json');
  SEED = seed();
  writeFileSync(outboxFile, JSON.stringify(SEED, null, 2));
});
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

const readOutbox = () => JSON.parse(readFileSync(outboxFile, 'utf8'));
const raw = () => readFileSync(outboxFile, 'utf8');
const byId = (d, id) => d.actions.find((a) => a.id === id);
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

// Fake request: headers + a body streamed on the next tick (handleRoute attaches
// its listeners synchronously). Resolves with the first send(). Two calls started
// back to back deliver their bodies — and so run their 'end' handlers — in order.
function call({ method = 'POST', url = '/social/outbox/claim', headers = { 'x-hq-bridge': '1' }, body, raw: rawBody, token = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.headers = headers;
    let consumed;
    // GET answers synchronously inside handleRoute, before `consumed` is assigned:
    // resolve a microtask later so it carries handleRoute's return value.
    const send = (code, obj) => queueMicrotask(() => resolve({ code, body: obj, consumed }));
    try { consumed = social.handleRoute(req, {}, { url, send, token, dataDir }); } catch (e) { reject(e); return; }
    if (!consumed) { resolve({ code: null, body: null, consumed }); return; }
    setImmediate(() => {
      const text = rawBody !== undefined ? rawBody : (body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)));
      if (text) req.emit('data', Buffer.from(text, 'utf8'));
      req.emit('end');
    });
  });
}
const claim = (id, extra = {}) => call({ body: { id, ...extra } });
const cancel = (id) => call({ url: '/social/outbox/cancel', body: { id } });
const result = (body) => call({ url: '/social/outbox/result', body });
const release = (id) => call({ url: '/social/outbox/release', body: { id } });
const listed = async () => (await call({ method: 'GET', url: '/social/outbox' })).body.actions.map((a) => a.id);

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------
test('claim: a staged action flips to sending (claimed_at), the app copy comes back, nothing else changes', async () => {
  const r = await claim('act-staged-1');
  assert.equal(r.consumed, true);
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.id, 'act-staged-1');
  assert.equal(r.body.status, 'sending');
  assert.match(r.body.claimed_at, ISO);
  const seeded = byId(SEED, 'act-staged-1');
  assert.deepEqual(r.body.action, { ...seeded, status: 'sending', claimed_at: r.body.claimed_at });

  const d = readOutbox();
  const a = byId(d, 'act-staged-1');
  assert.equal(a.status, 'sending');
  assert.equal(a.claimed_at, r.body.claimed_at);
  assert.equal(a.sent_at, undefined, 'a claim publishes nothing');
  assert.equal(a.result, undefined);
  for (const s of SEED.actions.filter((x) => x.id !== 'act-staged-1')) assert.deepEqual(byId(d, s.id), s, s.id);
  assert.equal(d.updated, a.claimed_at);
});

test('claim: a claimed post leaves GET /social/outbox (off the approval card)', async () => {
  assert.deepEqual(await listed(), ['act-staged-1', 'act-staged-2']);
  await claim('act-staged-1');
  assert.deepEqual(await listed(), ['act-staged-2']);
});

test('claim: the same post twice → 200 then 409 (status sending), file untouched by the loser', async () => {
  assert.equal((await claim('act-staged-2')).code, 200);
  const before = raw();
  const again = await claim('act-staged-2');
  assert.equal(again.code, 409);
  assert.deepEqual(again.body, { ok: false, error: 'not staged', id: 'act-staged-2', status: 'sending' });
  assert.equal(raw(), before);
});

for (const id of ['act-sending-fresh', 'act-sending-stale', 'act-sent', 'act-failed', 'act-canceled']) {
  test(`claim: not staged (${id}) → 409 with its status, file byte-identical`, async () => {
    const before = raw();
    const r = await claim(id);
    assert.equal(r.code, 409);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, 'not staged');
    assert.equal(r.body.status, byId(SEED, id).status);
    assert.equal(raw(), before);
  });
}

test('claim: matching content_hash → 200 (upper-case hex too); a different payload → 409 content changed, untouched', async () => {
  const h1 = social.contentHash(byId(SEED, 'act-staged-1'));
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal((await claim('act-staged-1', { content_hash: h1 })).code, 200);

  const h2 = social.contentHash(byId(SEED, 'act-staged-2'));
  assert.equal((await claim('act-staged-2', { content_hash: h2.toUpperCase() })).code, 200);

  writeFileSync(outboxFile, JSON.stringify(seed(), null, 2));   // fresh: both staged again
  const before = raw();
  const shownOld = { ...byId(SEED, 'act-staged-1'), text: 'what the human saw before an edit' };
  const r = await claim('act-staged-1', { content_hash: social.contentHash(shownOld) });
  assert.equal(r.code, 409);
  assert.deepEqual(r.body, { ok: false, error: 'content changed', id: 'act-staged-1', status: 'staged' });
  assert.equal(raw(), before);
});

test('claim: every payload field is in the hash; status/ids/timestamps are not', () => {
  const a = byId(SEED, 'act-staged-2');
  const h = social.contentHash(a);
  for (const [k, v] of [['platform', 'bluesky'], ['op', 'reply'], ['text', 'other'], ['reply_to', 't3_x'], ['target', 'other'], ['title', 'other']]) {
    assert.notEqual(social.contentHash({ ...a, [k]: v }), h, k);
  }
  assert.equal(social.contentHash({ ...a, status: 'sending', id: 'x', staged_at: 'y', claimed_at: 'z', by: 'q' }), h);
  // null and missing are the same ('')
  const b = byId(SEED, 'act-staged-1');
  assert.equal(social.contentHash({ ...b, reply_to: null, target: null, title: null }), social.contentHash(b));
});

test('claim: a malformed content_hash → 400, file byte-identical; null/empty means "no hash"', async () => {
  const before = raw();
  for (const content_hash of ['abc', 'z'.repeat(64), 42, { h: 1 }, ['a'], true]) {
    const r = await claim('act-staged-1', { content_hash });
    assert.equal(r.code, 400, JSON.stringify(content_hash));
    assert.equal(r.body.ok, false);
  }
  assert.equal(raw(), before);
  assert.equal((await claim('act-staged-1', { content_hash: null })).code, 200);
  assert.equal((await claim('act-staged-2', { content_hash: '' })).code, 200);
});

test('claim guards: auth 403, non-object / bad json / missing id 400, unknown 404, oversized 413 — nothing written', async () => {
  const before = raw();
  assert.equal((await call({ headers: {}, body: { id: 'act-staged-1' } })).code, 403);
  assert.equal((await call({ token: 's3cret', body: { id: 'act-staged-1' } })).code, 403);
  assert.equal((await call({ headers: { 'x-hq-bridge': '1', 'x-hq-token': 'nope' }, token: 's3cret', body: { id: 'act-staged-1' } })).code, 403);
  for (const r of ['null', '[]', '"act-staged-1"', '42', 'true', '{not json']) assert.equal((await call({ raw: r })).code, 400, r);
  assert.equal((await call({ body: {} })).code, 400);
  assert.equal((await call({ body: { id: '' } })).code, 400);
  assert.equal((await claim('no-such-action')).code, 404);
  assert.equal((await call({ raw: JSON.stringify({ id: 'act-staged-1', pad: 'x'.repeat(70 * 1024) }) })).code, 413);
  assert.equal(raw(), before);
  const ok = await call({ headers: { 'x-hq-bridge': '1', 'x-hq-token': 's3cret' }, token: 's3cret', body: { id: 'act-staged-1' } });
  assert.equal(ok.code, 200);
});

test('claim: no outbox file → 404 and no file is created; GET on the claim path falls through', async () => {
  rmSync(outboxFile);
  assert.equal((await claim('act-staged-1')).code, 404);
  assert.equal(existsSync(outboxFile), false);
  assert.equal((await call({ method: 'GET' })).consumed, false);
  assert.equal((await call({ method: 'GET', url: '/social/outbox/release' })).consumed, false);
});

test('claim + release: the atomic write leaves no temp files behind', async () => {
  await claim('act-staged-1');
  await release('act-sending-stale');
  assert.deepEqual(readdirSync(join(dataDir, 'social')).sort(), ['outbox.json']);
});

// ---------------------------------------------------------------------------
// cancel vs claim — the race the claim exists to close
// ---------------------------------------------------------------------------
test('cancel: a sending post → 409 already publishing, file byte-identical (fresh and stale claims alike)', async () => {
  for (const id of ['act-sending-fresh', 'act-sending-stale', 'act-sending-noclaim']) {
    const before = raw();
    const r = await cancel(id);
    assert.equal(r.code, 409, id);
    assert.deepEqual(r.body, { ok: false, error: 'already publishing', id, status: 'sending' });
    assert.equal(raw(), before, id);
  }
});

test('concurrent: claim lands first, then the Skip → claim 200, Skip 409 already publishing; the post stays sending', async () => {
  const [c, k] = await Promise.all([claim('act-staged-1'), cancel('act-staged-1')]);
  assert.equal(c.code, 200);
  assert.equal(k.code, 409);
  assert.equal(k.body.error, 'already publishing');
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'sending');
  assert.equal(a.canceled_at, undefined, 'the losing Skip wrote nothing');
});

test('concurrent: Skip lands first, then the claim → Skip 200, claim 409 (canceled); nothing to publish', async () => {
  const [k, c] = await Promise.all([cancel('act-staged-1'), claim('act-staged-1')]);
  assert.equal(k.code, 200);
  assert.equal(c.code, 409);
  assert.deepEqual(c.body, { ok: false, error: 'not staged', id: 'act-staged-1', status: 'canceled' });
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'canceled');
  assert.equal(a.claimed_at, undefined, 'the losing claim wrote nothing');
});

test('concurrent storm: 8 claims + 8 Skips on one post → exactly one 200 overall, the file agrees with the winner', async () => {
  for (const claimFirst of [true, false]) {
    writeFileSync(outboxFile, JSON.stringify(seed(), null, 2));
    const reqs = [];
    for (let i = 0; i < 8; i++) {
      if (claimFirst) { reqs.push(['claim', claim('act-staged-2')]); reqs.push(['cancel', cancel('act-staged-2')]); }
      else { reqs.push(['cancel', cancel('act-staged-2')]); reqs.push(['claim', claim('act-staged-2')]); }
    }
    const done = await Promise.all(reqs.map(async ([kind, p]) => [kind, await p]));
    const winners = done.filter(([, r]) => r.code === 200);
    assert.equal(winners.length, 1, 'exactly one request wins');
    assert.ok(done.every(([, r]) => r.code === 200 || r.code === 409));
    const a = byId(readOutbox(), 'act-staged-2');
    assert.equal(a.status, winners[0][0] === 'claim' ? 'sending' : 'canceled');
    assert.equal(winners[0][0], claimFirst ? 'claim' : 'cancel');
  }
});

// ---------------------------------------------------------------------------
// result
// ---------------------------------------------------------------------------
test('result: sending + ok → sent (sent_at, result), claimed_at kept', async () => {
  const c = await claim('act-staged-1');
  const r = await result({ id: 'act-staged-1', ok: true, url: 'https://example.org/x', uri: 'at://example/post/x' });
  assert.deepEqual(r.body, { ok: true, id: 'act-staged-1', status: 'sent' });
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'sent');
  assert.match(a.sent_at, ISO);
  assert.deepEqual(a.result, { url: 'https://example.org/x', uri: 'at://example/post/x' });
  assert.equal(a.claimed_at, c.body.claimed_at);
});

test('result: sending + failure → failed (error), and a repeat report is ignored with the file untouched', async () => {
  await claim('act-staged-1');
  const r = await result({ id: 'act-staged-1', ok: false, error: 'adapter error' });
  assert.deepEqual(r.body, { ok: true, id: 'act-staged-1', status: 'failed' });
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'failed');
  assert.equal(a.error, 'adapter error');
  assert.equal(a.sent_at, undefined);
  const before = raw();
  const again = await result({ id: 'act-staged-1', ok: true, url: 'https://example.org/late' });
  assert.equal(again.body.ignored, true);
  assert.equal(raw(), before);
});

test('result: a staged post still settles (a 0.2.0 extension that was not reloaded publishes without claiming)', async () => {
  const r = await result({ id: 'act-staged-2', ok: true, url: 'https://example.org/old-ext' });
  assert.deepEqual(r.body, { ok: true, id: 'act-staged-2', status: 'sent' });
  const a = byId(readOutbox(), 'act-staged-2');
  assert.equal(a.status, 'sent');
  assert.equal(a.claimed_at, undefined);
});

// ---------------------------------------------------------------------------
// release — owner-only, never automatic, never publishes
// ---------------------------------------------------------------------------
test('release: the stale window is 10 minutes', () => {
  assert.equal(social.CLAIM_STALE_MIN, 10);
});

test('release: a fresh claim → 409 claim still fresh (with release_after), file byte-identical', async () => {
  const before = raw();
  const r = await release('act-sending-fresh');
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'claim still fresh');
  assert.equal(r.body.status, 'sending');
  const seeded = byId(SEED, 'act-sending-fresh');
  assert.equal(r.body.claimed_at, seeded.claimed_at);
  assert.equal(r.body.release_after, new Date(Date.parse(seeded.claimed_at) + STALE).toISOString());
  assert.equal(raw(), before);
  // a claim taken just now is fresh too
  await claim('act-staged-1');
  const before2 = raw();
  assert.equal((await release('act-staged-1')).code, 409);
  assert.equal(raw(), before2);
});

test('release: a stale claim → staged again (released_at, claimed_at removed), back on the card, and nothing published', async () => {
  const r = await release('act-sending-stale');
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.status, 'staged');
  assert.match(r.body.released_at, ISO);
  const d = readOutbox();
  const a = byId(d, 'act-sending-stale');
  assert.equal(a.status, 'staged');
  assert.equal(a.released_at, r.body.released_at);
  assert.equal('claimed_at' in a, false);
  assert.equal(a.sent_at, undefined, 'a release publishes nothing');
  assert.equal(a.result, undefined);
  for (const s of SEED.actions.filter((x) => x.id !== 'act-sending-stale')) assert.deepEqual(byId(d, s.id), s, s.id);
  assert.deepEqual(await listed(), ['act-staged-1', 'act-staged-2', 'act-sending-stale']);
  // it needs a fresh human-approved claim to go anywhere
  assert.equal((await claim('act-sending-stale')).code, 200);
});

test('release: a sending entry with no readable claimed_at (hand edit) can be released at once', async () => {
  const r = await release('act-sending-noclaim');
  assert.equal(r.code, 200);
  assert.equal(byId(readOutbox(), 'act-sending-noclaim').status, 'staged');
});

for (const id of ['act-staged-1', 'act-sent', 'act-failed', 'act-canceled']) {
  test(`release: not sending (${id}) → 409 not sending, file byte-identical`, async () => {
    const before = raw();
    const r = await release(id);
    assert.equal(r.code, 409);
    assert.deepEqual(r.body, { ok: false, error: 'not sending', id, status: byId(SEED, id).status });
    assert.equal(raw(), before);
  });
}

test('release guards: auth 403, non-object 400, missing id 400, unknown 404, oversized 413 — nothing written', async () => {
  const before = raw();
  assert.equal((await call({ url: '/social/outbox/release', headers: {}, body: { id: 'act-sending-stale' } })).code, 403);
  assert.equal((await call({ url: '/social/outbox/release', token: 's3cret', body: { id: 'act-sending-stale' } })).code, 403);
  for (const r of ['null', '[]', '7', '{not json']) assert.equal((await call({ url: '/social/outbox/release', raw: r })).code, 400, r);
  assert.equal((await call({ url: '/social/outbox/release', body: {} })).code, 400);
  assert.equal((await release('no-such-action')).code, 404);
  assert.equal((await call({ url: '/social/outbox/release', raw: JSON.stringify({ id: 'act-sending-stale', pad: 'x'.repeat(70 * 1024) }) })).code, 413);
  assert.equal(raw(), before);
});

test('release then a late success from the stuck send → sent (off the card, so it is not re-approved)', async () => {
  await release('act-sending-stale');
  const r = await result({ id: 'act-sending-stale', ok: true, url: 'https://example.org/late' });
  assert.equal(r.body.status, 'sent');
  assert.equal(byId(readOutbox(), 'act-sending-stale').status, 'sent');
  assert.deepEqual(await listed(), ['act-staged-1', 'act-staged-2']);
});

test('the claim/release routes never touch accounts or the inbox', async () => {
  await claim('act-staged-1');
  await release('act-sending-stale');
  assert.equal(existsSync(join(dataDir, 'social', 'accounts.json')), false);
  assert.equal(existsSync(join(dataDir, 'social', 'inbox.json')), false);
});

// ---------------------------------------------------------------------------
// Extension half: browser-bridge/social.js socialSend, its fetch wired to the
// real relay above (handleRoute + the temp outbox).
// ---------------------------------------------------------------------------
const SOCIAL_JS = readFileSync(fileURLToPath(new URL('../browser-bridge/social.js', import.meta.url)), 'utf8');

function loadExtension({ hooks = {}, tabs = null, send } = {}) {
  const calls = { inject: [], log: [] };
  const chrome = {
    storage: { local: { get: async () => ({ hq_cfg: { endpoint: 'http://127.0.0.1:1', token: '' } }) } },
    tabs: { query: async () => tabs || [{ id: 7, url: 'https://bsky.app/profile/example' }, { id: 8, url: 'https://www.reddit.com/r/example/' }] },
    scripting: {
      executeScript: async (opts) => {
        calls.inject.push(opts);
        const out = send ? await send(opts.args[0]) : { ok: true, url: 'https://example.org/p/1', uri: 'at://example/post/1' };
        return [{ result: out }];
      },
    },
  };
  const fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    const method = opts.method || 'GET';
    calls.log.push(method + ' ' + path);
    if (hooks.before) await hooks.before(method, path);
    if (hooks.down && hooks.down(method, path)) throw new TypeError('Failed to fetch');
    if (hooks.noRoute && hooks.noRoute(method, path)) return { status: 404, ok: false, json: async () => ({ ok: false, error: 'not found' }) };   // an app without the route
    const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    const r = await call({ method, url: path, headers, raw: opts.body === undefined ? '' : opts.body });
    if (!r.consumed) return { status: 404, ok: false, json: async () => ({ ok: false, error: 'not found' }) };
    return { status: r.code, ok: r.code >= 200 && r.code < 300, json: async () => r.body };
  };
  const ctx = vm.createContext({ chrome, fetch, URL, console, setTimeout, clearTimeout, crypto: globalThis.crypto, TextEncoder });
  vm.runInContext(SOCIAL_JS, ctx, { filename: 'social.js' });
  return { socialSend: vm.runInContext('socialSend', ctx), socialContentHash: vm.runInContext('socialContentHash', ctx), calls };
}

// What the popup rendered (GET /social/outbox copy).
const shown = (id) => ({ ...byId(SEED, id) });

test('extension: content hash matches the relay byte for byte (unicode, emoji, null vs missing)', async () => {
  const { socialContentHash } = loadExtension();
  const samples = [
    ...SEED.actions,
    { platform: 'bluesky', op: 'post', text: 'e\u0301 vs é · 👩‍💻 · "quotes" \\ back\nslash', reply_to: null },
    { platform: 'reddit', op: 'post', text: '', target: 'r/example', title: 'T' },
  ];
  for (const a of samples) assert.equal(await socialContentHash(a), social.contentHash(a), JSON.stringify(a));
});

test('extension: approve → pre-check, claim, publish once, result → sent; order is GET, claim, result', async () => {
  const { socialSend, calls } = loadExtension();
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, true);
  assert.equal(res.reported, true);
  assert.equal(calls.inject.length, 1);
  assert.equal(calls.inject[0].args[0].text, byId(SEED, 'act-staged-1').text);
  assert.deepEqual(calls.log, ['GET /social/outbox', 'POST /social/outbox/claim', 'POST /social/outbox/result']);
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'sent');
  assert.match(a.claimed_at, ISO);
  assert.deepEqual(a.result, { url: 'https://example.org/p/1', uri: 'at://example/post/1' });
});

test('extension: a Skip that lands while the adapter publishes is refused (409 already publishing); the post ends sent, not canceled', async () => {
  let skip;
  const { socialSend } = loadExtension({ send: async (action) => { skip = await cancel(action.id); return { ok: true, url: 'https://example.org/p/2' }; } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, true);
  assert.equal(skip.code, 409);
  assert.equal(skip.body.error, 'already publishing');
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'sent');
  assert.equal(a.canceled_at, undefined);
  assert.equal(a.sent_after_cancel, undefined, 'no after-the-fact record needed any more');
});

test('extension: a Skip between the pre-check and the claim wins → claim refused, never published, nothing reported', async () => {
  const { socialSend, calls } = loadExtension({ hooks: { before: async (m, p) => { if (p === '/social/outbox/claim') await cancel('act-staged-1'); } } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, false);
  assert.match(res.error, /no longer staged \(canceled\)/);
  assert.equal(calls.inject.length, 0);
  assert.ok(!calls.log.includes('POST /social/outbox/result'));
  assert.equal(byId(readOutbox(), 'act-staged-1').status, 'canceled');
});

test('extension: two approves at once (double click, second profile) → exactly one publish', async () => {
  const a = loadExtension();
  const b = loadExtension();
  const [r1, r2] = await Promise.all([a.socialSend(shown('act-staged-1')), b.socialSend(shown('act-staged-1'))]);
  assert.equal(a.calls.inject.length + b.calls.inject.length, 1);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  const loser = r1.ok ? r2 : r1;
  // both pre-checks saw it staged; the claim is what stopped the second publish
  assert.match(loser.error, /already being published/);
  assert.deepEqual([...a.calls.log, ...b.calls.log].filter((x) => x === 'POST /social/outbox/claim').length, 2);
  assert.equal(byId(readOutbox(), 'act-staged-1').status, 'sent');
});

test('extension: the post was edited between the pre-check and the claim → content changed, never published', async () => {
  const edit = () => { const d = readOutbox(); byId(d, 'act-staged-1').text = 'edited after the human read it'; writeFileSync(outboxFile, JSON.stringify(d, null, 2)); };
  const { socialSend, calls } = loadExtension({ hooks: { before: async (m, p) => { if (p === '/social/outbox/claim') edit(); } } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, false);
  assert.match(res.error, /changed/);
  assert.equal(calls.inject.length, 0);
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'staged', 'not claimed');
  assert.equal(a.claimed_at, undefined);
});

test('extension: an app without the claim route (not restarted) → refused, never published, file untouched', async () => {
  const before = raw();
  const { socialSend, calls } = loadExtension({ hooks: { noRoute: (m, p) => p === '/social/outbox/claim' } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, false);
  assert.match(res.error, /restart workspace-hq/);
  assert.equal(calls.inject.length, 0);
  assert.equal(raw(), before);
});

test('extension: the claim request fails (app went away) → refused, never published', async () => {
  const before = raw();
  const { socialSend, calls } = loadExtension({ hooks: { down: (m, p) => p === '/social/outbox/claim' } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, false);
  assert.match(res.error, /couldn't claim/);
  assert.equal(calls.inject.length, 0);
  assert.equal(raw(), before);
});

test('extension: no logged-in tab → refused BEFORE claiming (the post stays staged, file untouched)', async () => {
  const before = raw();
  const { socialSend, calls } = loadExtension({ tabs: [{ id: 9, url: 'https://example.org/' }] });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, false);
  assert.match(res.error, /open a logged-in bluesky tab/);
  assert.ok(!calls.log.includes('POST /social/outbox/claim'));
  assert.equal(raw(), before);
});

test('extension: the adapter throws after the claim → the failure is still reported (failed, not stuck sending)', async () => {
  const { socialSend, calls } = loadExtension({ send: async () => { throw new Error('tab crashed'); } });
  const res = await socialSend(shown('act-staged-2'));
  assert.equal(res.ok, false);
  assert.equal(calls.inject.length, 1);
  const a = byId(readOutbox(), 'act-staged-2');
  assert.equal(a.status, 'failed');
  assert.match(a.error, /tab crashed/);
  assert.match(a.claimed_at, ISO);
});

test('extension: published but the result never reaches the app → ok with reported:false; the post stays sending until the owner releases it', async () => {
  const { socialSend } = loadExtension({ hooks: { down: (m, p) => p === '/social/outbox/result' } });
  const res = await socialSend(shown('act-staged-1'));
  assert.equal(res.ok, true);
  assert.equal(res.reported, false);
  const a = byId(readOutbox(), 'act-staged-1');
  assert.equal(a.status, 'sending');
  // not cancelable, not re-claimable, not releasable yet
  assert.equal((await cancel('act-staged-1')).code, 409);
  assert.equal((await claim('act-staged-1')).code, 409);
  assert.equal((await release('act-staged-1')).body.error, 'claim still fresh');
});

// ---------------------------------------------------------------------------
// MCP read side (mcp/workspacehq/server.mjs): 'sending' is reported, and the
// MCP cancel refuses it. The server resolves its root as <its folder>/../.., so it
// is copied into that shape under a temp root (as server.test.mjs does).
// ---------------------------------------------------------------------------
const SERVER = fileURLToPath(new URL('../mcp/workspacehq/server.mjs', import.meta.url));

function mcp(root, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'mcp', 'workspacehq', 'server.mjs')], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server timed out: ' + out)); }, 10000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      const byReq = {};
      for (const line of out.split('\n').filter(Boolean)) { const m = JSON.parse(line); byReq[m.id] = m; }
      resolve(byReq);
    });
    child.stdin.end(requests.map((r) => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n');
  });
}
const toolOut = (m) => JSON.parse(m.result.content[0].text);

test('MCP: hq_social_status counts sending; hq_social_outbox lists claimed_at/released_at and filters sending; hq_social_cancel refuses sending', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-mcp-claim-'));
  try {
    mkdirSync(join(root, 'mcp', 'workspacehq'), { recursive: true });
    copyFileSync(SERVER, join(root, 'mcp', 'workspacehq', 'server.mjs'));
    mkdirSync(join(root, 'data', 'social'), { recursive: true });
    const d = seed();
    byId(d, 'act-staged-2').released_at = '2026-01-01T00:20:00.000Z';
    const file = join(root, 'data', 'social', 'outbox.json');
    writeFileSync(file, JSON.stringify(d, null, 2));
    const before = readFileSync(file, 'utf8');

    const r = await mcp(root, [
      { id: 1, method: 'tools/call', params: { name: 'hq_social_status' } },
      { id: 2, method: 'tools/call', params: { name: 'hq_social_outbox', arguments: { status: 'sending' } } },
      { id: 3, method: 'tools/call', params: { name: 'hq_social_outbox' } },
      { id: 4, method: 'tools/call', params: { name: 'hq_social_cancel', arguments: { id: 'act-sending-fresh' } } },
      { id: 5, method: 'tools/list' },
    ]);
    assert.deepEqual(toolOut(r[1]).outbox, { staged: 2, sending: 3, sent: 1, failed: 1 });
    const sending = toolOut(r[2]);
    assert.deepEqual(sending.actions.map((a) => a.id), ['act-sending-fresh', 'act-sending-stale', 'act-sending-noclaim']);
    assert.equal(sending.actions[0].claimed_at, byId(d, 'act-sending-fresh').claimed_at);
    assert.equal(sending.actions[2].claimed_at, null);
    const all = toolOut(r[3]).actions;
    assert.equal(all.find((a) => a.id === 'act-staged-2').released_at, '2026-01-01T00:20:00.000Z');
    assert.equal(all.find((a) => a.id === 'act-staged-1').released_at, null);
    assert.equal(toolOut(r[4]).ok, false);
    assert.match(toolOut(r[4]).reason, /sending/);
    assert.equal(readFileSync(file, 'utf8'), before, 'the MCP cancel wrote nothing');
    const desc = r[5].result.tools.find((t) => t.name === 'hq_social_outbox');
    assert.match(desc.description, /sending/);
    assert.match(desc.inputSchema.properties.status.description, /sending/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
