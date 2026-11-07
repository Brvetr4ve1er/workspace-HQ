// browser-bridge/endpoint-guard.js: the two checks every token-bearing fetch passes first. A classic extension script,
// run here in a vm context with WebCrypto and a fake fetch — no browser, no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webcrypto, createHmac } from 'node:crypto';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '..', 'browser-bridge', 'endpoint-guard.js'), 'utf8');
const TOKEN = 'a1'.repeat(32);

function load() {
  const ctx = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto, console });
  ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx);
  return ctx.HQGuard;
}
const G = load();

// a fake app on 127.0.0.1:47821: answers /health with the right proof when it holds `token`
function fakeEnv({ token = TOKEN, answer = 'app', now = { t: 1_000_000 } } = {}) {
  const calls = [];
  const store = new Map();
  return {
    calls, now,
    env: {
      now: () => now.t,
      crypto: webcrypto,
      storage: { get: async (k) => (store.has(k) ? { [k]: store.get(k) } : {}), set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); } },
      fetch: async (url, opts = {}) => {
        calls.push({ url, headers: { ...(opts.headers || {}) }, method: opts.method || 'GET' });
        if (answer === 'down') throw new TypeError('Failed to fetch');
        const u = new URL(url);
        if (u.pathname === '/health') {
          const nonce = u.searchParams.get('nonce');
          if (answer === 'old') return { ok: true, status: 200, json: async () => ({ ok: true, app: 'workspacehq', needsToken: true }) };
          if (answer === 'impostor') return { ok: true, status: 200, json: async () => ({ ok: true, app: 'workspacehq', proof: createHmac('sha256', 'f'.repeat(64)).update(nonce).digest('hex') }) };
          if (answer === 'echo') return { ok: true, status: 200, json: async () => ({ ok: true, app: 'workspacehq', proof: nonce }) };
          return { ok: true, status: 200, json: async () => ({ ok: true, app: 'workspacehq', needsToken: true, proof: createHmac('sha256', token).update(nonce).digest('hex') }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    },
  };
}
const real = (calls) => calls.filter((c) => !c.url.includes('/health'));

test('checkEndpoint: 127.0.0.1 and localhost on any port are allowed', () => {
  for (const e of ['http://127.0.0.1:47821', 'http://localhost:47821', 'http://127.0.0.1:47821/', 'http://127.0.0.1', 'http://localhost:9', ' http://127.0.0.1:47821 ']) {
    const r = G.checkEndpoint(e);
    assert.equal(r.ok, true, e);
  }
  assert.equal(G.checkEndpoint('http://127.0.0.1:47821').base, 'http://127.0.0.1:47821');
});

test('checkEndpoint: everything else is refused, with the PC-only message', () => {
  const bad = ['http://[::1]:47821', 'http://127.0.0.1.evil.com', 'http://localhost@evil.com', 'http://evil.com#127.0.0.1', 'http://evil.com/?127.0.0.1',
    'https://example.com', 'https://127.0.0.1:47821', 'javascript:alert(1)', 'http://127.0.0.1@evil.com:47821', 'http://user:pw@127.0.0.1:47821', 'http://127.0.0.1:47821/evil',
    'http://0.0.0.0:47821', 'http://localhost.evil.com', 'ftp://127.0.0.1', '', null, undefined, '//127.0.0.1', 'file:///C:/x', 'not a url'];
  for (const e of bad) {
    const r = G.checkEndpoint(e);
    assert.equal(r.ok, false, String(e));
    assert.equal(r.reason, 'endpoint is not on this PC — not sent');
  }
});

test('the WebCrypto proof matches Node\'s HMAC, and sameHex accepts only equal strings', async () => {
  const nonce = '0123456789abcdef0123456789abcdef';
  const want = createHmac('sha256', TOKEN).update(nonce).digest('hex');
  assert.equal(await G.hmacHex(TOKEN, nonce, { crypto: webcrypto }), want);
  assert.notEqual(await G.hmacHex('b'.repeat(64), nonce, { crypto: webcrypto }), want);
  assert.equal(G.sameHex(want, want), true);
  assert.equal(G.sameHex(want, want.slice(0, -1) + (want.endsWith('0') ? '1' : '0')), false);
  assert.equal(G.sameHex(want, ''), false);
  assert.equal(G.sameHex(want, undefined), false);
  assert.match(G.randomHex(16, { crypto: webcrypto }), /^[0-9a-f]{32}$/);
  assert.match(G.randomHex(32, { crypto: webcrypto }), /^[0-9a-f]{64}$/);
});

test('verifyApp: the real app\'s proof is accepted; the probe carries a fresh nonce and never the token', async () => {
  const f = fakeEnv();
  const r = await G.verifyApp('http://127.0.0.1:47821', TOKEN, f.env);
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /^http:\/\/127\.0\.0\.1:47821\/health\?nonce=[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(f.calls).includes(TOKEN));
  assert.equal(f.calls[0].headers['X-HQ-Token'], undefined);
  await G.verifyApp('http://127.0.0.1:47821', TOKEN, { ...f.env, storage: undefined, now: () => 9 });
  const nonces = f.calls.map((c) => new URL(c.url).searchParams.get('nonce'));
  assert.notEqual(nonces[0], nonces[1]);
});

test('verifyApp: a wrong proof, an echoed nonce, an old app with no proof, and a dead port are all refused', async () => {
  for (const [answer, code] of [['impostor', 'impostor'], ['echo', 'impostor'], ['old', 'impostor'], ['down', 'unreachable']]) {
    const f = fakeEnv({ answer });
    const r = await G.verifyApp('http://127.0.0.1:47821', TOKEN, f.env);
    assert.equal(r.ok, false, answer);
    assert.equal(r.code, code, answer);
    if (code === 'impostor') assert.equal(r.reason, 'something else is answering on port 47821 — not sent');
  }
});

test('guardedFetch: nothing leaves for a non-loopback endpoint — not even a probe', async () => {
  const f = fakeEnv();
  for (const endpoint of ['https://example.com', 'http://127.0.0.1.evil.com:47821', 'http://localhost@evil.com']) {
    await assert.rejects(G.guardedFetch({ endpoint, token: TOKEN }, '/ingest', { method: 'POST', body: '{}' }, f.env), (e) => e.code === 'not-on-pc' && e.message === 'endpoint is not on this PC — not sent');
  }
  assert.equal(f.calls.length, 0);
});

test('guardedFetch: a wrong proof means the token is never sent anywhere', async () => {
  const f = fakeEnv({ answer: 'impostor' });
  await assert.rejects(G.guardedFetch({ endpoint: 'http://127.0.0.1:47821', token: TOKEN }, '/social/outbox', {}, f.env),
    (e) => e.code === 'impostor' && /something else is answering on port 47821/.test(e.message));
  assert.equal(real(f.calls).length, 0);
  assert.ok(!JSON.stringify(f.calls).includes(TOKEN));
});

test('guardedFetch: the genuine app gets the request with the token; the proof is cached 60 s and expires', async () => {
  const f = fakeEnv();
  const cfg = { endpoint: 'http://127.0.0.1:47821/', token: TOKEN };
  await G.guardedFetch(cfg, '/assist/brief', { method: 'GET' }, f.env);
  await G.guardedFetch(cfg, '/assist/brief', { method: 'GET' }, f.env);
  assert.equal(f.calls.filter((c) => c.url.includes('/health')).length, 1, 'second call rides the cache');
  const sent = real(f.calls);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'http://127.0.0.1:47821/assist/brief');
  assert.equal(sent[0].headers['X-HQ-Token'], TOKEN);
  assert.equal(sent[0].headers['X-HQ-Bridge'], '1');
  f.now.t += 59_000;
  await G.guardedFetch(cfg, '/assist/brief', {}, f.env);
  assert.equal(f.calls.filter((c) => c.url.includes('/health')).length, 1);
  f.now.t += 2_000;
  await G.guardedFetch(cfg, '/assist/brief', {}, f.env);
  assert.equal(f.calls.filter((c) => c.url.includes('/health')).length, 2, 'expired, probed again');
});

test('guardedFetch: the cache does not carry over to a different token or endpoint', async () => {
  const f = fakeEnv();
  await G.guardedFetch({ endpoint: 'http://127.0.0.1:47821', token: TOKEN }, '/a', {}, f.env);
  await assert.rejects(G.guardedFetch({ endpoint: 'http://127.0.0.1:47821', token: 'b'.repeat(64) }, '/a', {}, f.env), (e) => e.code === 'impostor');
  await G.guardedFetch({ endpoint: 'http://localhost:47821', token: TOKEN }, '/a', {}, f.env);
  assert.equal(f.calls.filter((c) => c.url.includes('/health')).length, 3);
});

test('guardedFetch: with no token there is no secret to protect, so only the loopback check applies', async () => {
  const f = fakeEnv();
  await G.guardedFetch({ endpoint: 'http://127.0.0.1:47821', token: '' }, '/ingest', { method: 'POST', body: '{}' }, f.env);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers['X-HQ-Token'], undefined);
  assert.equal(f.calls[0].headers['X-HQ-Bridge'], '1');
});

test('guardedFetch: an app that is down is reported as unreachable, not as an impostor', async () => {
  const f = fakeEnv({ answer: 'down' });
  await assert.rejects(G.guardedFetch({ endpoint: 'http://127.0.0.1:47821', token: TOKEN }, '/a', {}, f.env), (e) => e.code === 'unreachable' && /not reachable/.test(e.message));
});
