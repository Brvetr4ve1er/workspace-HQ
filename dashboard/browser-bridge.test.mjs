// Bridge server hardening: the Host allowlist (DNS-rebinding guard — a page on
// attacker.com re-resolving to 127.0.0.1 reaches the bind SAME-ORIGIN, so the
// header gate alone never fires) and the bounded body buffering (an oversize
// POST is drained, never held in RAM, and answered 413 from 'end').
// Binds a throwaway port in a temp dataDir — never 47821 (the owner's running
// app holds it) and never the repo's data/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startBridge, isLocalHost } = require('./browser-bridge.js');

const PORT = 48100 + Math.floor(Math.random() * 800);
let dataDir, bridge;

// raw http.request so the Host header can be forged (fetch always sends the real one)
function call({ method = 'GET', path = '/health', host = `127.0.0.1:${PORT}`, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let obj = null;
        try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* OPTIONS has no body */ }
        resolve({ code: res.statusCode, obj });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hq-bridge-test-'));
  bridge = startBridge({ dataDir, port: PORT });
  // startBridge returns before listen lands — poll /health briefly
  for (let i = 0; i < 100; i++) {
    try { if ((await call()).code === 200) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('bridge never came up on ' + PORT);
});
after(() => {
  try { bridge.stop(); } catch { /* already down */ }
  rmSync(dataDir, { recursive: true, force: true });
});

test('isLocalHost: the three loopback spellings pass, bare or with the server port; anything else fails', () => {
  for (const ok of ['127.0.0.1', 'localhost', 'LOCALHOST', '[::1]', '127.0.0.1:47821', 'localhost:47821', '[::1]:47821']) {
    assert.ok(isLocalHost(ok, 47821), ok);
  }
  for (const bad of ['', undefined, 'attacker.com', 'attacker.com:47821', '127.0.0.1:9999', 'localhost:1', 'localhost.evil.com', '127.0.0.1.evil.com', '::1', 'evil127.0.0.1']) {
    assert.ok(!isLocalHost(bad, 47821), String(bad));
  }
});

test('a foreign Host is 403 before any route — health, ingest, social, claude, even an extension preflight', async () => {
  const evil = `attacker.example:${PORT}`;
  assert.equal((await call({ host: evil })).code, 403);
  const ing = await call({ method: 'POST', path: '/ingest', host: evil, headers: { 'x-hq-bridge': '1', 'content-type': 'application/json' }, body: '{"v":1,"events":[]}' });
  assert.equal(ing.code, 403); assert.equal(ing.obj.error, 'bad host');
  assert.equal((await call({ method: 'GET', path: '/social/outbox', host: evil, headers: { 'x-hq-bridge': '1' } })).code, 403);
  assert.equal((await call({ method: 'GET', path: '/claude/sync-state', host: evil, headers: { 'x-hq-bridge': '1' } })).code, 403);
  assert.equal((await call({ method: 'OPTIONS', path: '/ingest', host: evil, headers: { origin: 'chrome-extension://abcdefgh' } })).code, 403);
});

test('loopback Hosts pass, with or without the port (the extension targets http://127.0.0.1:47821)', async () => {
  for (const h of [`127.0.0.1:${PORT}`, '127.0.0.1', `localhost:${PORT}`, 'localhost', `[::1]:${PORT}`, '[::1]']) {
    const r = await call({ host: h });
    assert.equal(r.code, 200, h);
    assert.equal(r.obj.app, 'workspacehq');
  }
});

test('an oversize ingest body is drained and answered 413, and the next normal ingest still lands', async () => {
  const H = { 'x-hq-bridge': '1', 'content-type': 'application/json' };
  const big = Buffer.alloc(512 * 1024 + 10, 0x20);   // MAX_BODY + 10
  assert.equal((await call({ method: 'POST', path: '/ingest', headers: H, body: big })).code, 413);
  // the queue is not wedged: a small payload right after is stored
  const ev = { ts: Date.now(), domain: 'example.org', host: 'example.org', path: '/', url: 'https://example.org/', title: 'placeholder', focus_ms: 2000 };
  const ok = await call({ method: 'POST', path: '/ingest', headers: H, body: JSON.stringify({ v: 1, events: [ev] }) });
  assert.equal(ok.code, 200); assert.equal(ok.obj.stored, 1);
  const doc = JSON.parse(readFileSync(join(dataDir, 'browser-activity.json'), 'utf8'));
  assert.equal(doc.events.length, 1); assert.equal(doc.events[0].domain, 'example.org');
});

test('auth still gates ingest after the Host check: missing bridge header is 403', async () => {
  const r = await call({ method: 'POST', path: '/ingest', headers: { 'content-type': 'application/json' }, body: '{"v":1,"events":[]}' });
  assert.equal(r.code, 403); assert.equal(r.obj.error, 'missing bridge header');
});
