// Bridge 0.7.0 end to end: the REAL startBridge and routes on a throwaway port and temp data folder, driven by the REAL
// extension scripts (endpoint-guard.js, assist.js) in a vm with a fake chrome. Only the native dialog is faked.
//
// Pins the two promises that make pairing safe to ship:
//  1. Before any pairing exists, today's unpaired extension keeps working (no lockout): ingest and the outbox answer
//     without a token, and the Brief is simply "not paired".
//  2. Pairing ends with the extension holding exactly the token the app stored — even when the answer to /pair is lost
//     (the popup closed, the worker slept): the pending token is adopted once GET /health?nonce proves the app holds it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..', 'browser-bridge');
const { startBridge } = require('./browser-bridge.js');
const routes = require('./assist-bridge-routes.js');

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let dataDir, bridge, port;
let dialogAnswer = 1;       // 1 = Allow, 0 = Deny
const dialogLog = [];       // the messages the owner would have seen
const wire = { loseAnswerFor: null, requests: [] };   // wire.requests: [method, path] the extension sent

function rawRequest(method, urlStr, { headers = {}, body = null } = {}) {
  const u = new URL(urlStr);
  return new Promise((resolveReq, reject) => {
    const req = http.request({ host: '127.0.0.1', port: u.port, method, path: u.pathname + u.search, headers: { origin: EXT_ORIGIN, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveReq({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: res.headers, text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// the extension's fetch: real HTTP to the real bridge, with the extension's Origin
async function extFetch(url, init = {}) {
  const u = new URL(url);
  wire.requests.push([init.method || 'GET', u.pathname]);
  const res = await rawRequest(init.method || 'GET', url, { headers: init.headers || {}, body: init.body == null ? null : init.body });
  if (wire.loseAnswerFor && u.pathname === wire.loseAnswerFor) throw new TypeError('network error: the answer never arrived');
  return res;
}

function extension(initialCfg) {
  const local = new Map([['hq_cfg', { ...initialCfg }]]);
  const session = new Map();
  const area = (m) => ({
    get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (m.has(x)) o[x] = structuredClone(m.get(x)); return o; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    remove: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); },
  });
  const badge = { text: '' };
  const chrome = { storage: { local: area(local), session: area(session) }, action: { setBadgeText: async ({ text }) => { badge.text = text; }, setBadgeBackgroundColor: async () => {} } };
  const ctx = vm.createContext({ chrome, fetch: extFetch, URL, TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto, console, Uint8Array, Uint32Array, Date });
  ctx.globalThis = ctx;
  for (const f of ['endpoint-guard.js', 'assist.js']) vm.runInContext(readFileSync(join(EXT_DIR, f), 'utf8'), ctx, { filename: f });
  return { ctx, local, session, badge, cfg: () => local.get('hq_cfg'), HQAssist: ctx.HQAssist, HQGuard: ctx.HQGuard };
}

const tokenOnDisk = () => (existsSync(join(dataDir, '.bridge-token')) ? readFileSync(join(dataDir, '.bridge-token'), 'utf8').trim() : null);
const pairingOnDisk = () => (existsSync(join(dataDir, '.bridge-pairing.json')) ? JSON.parse(readFileSync(join(dataDir, '.bridge-pairing.json'), 'utf8')) : null);
const endpoint = () => `http://127.0.0.1:${port}`;
const EVENT = { ts: Date.now(), domain: 'example.org', host: 'example.org', path: '/', url: 'https://example.org/', title: 'placeholder', focus_ms: 2000 };

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hq-pair-e2e-'));
  port = await new Promise((res, rej) => { const p = net.createServer(); p.once('error', rej); p.listen(0, '127.0.0.1', () => { const n = p.address().port; p.close(() => res(n)); }); });
  routes.setDeps({
    dataDir,
    dialog: { showMessageBox: async (opts) => { dialogLog.push(opts); await new Promise((r) => setTimeout(r, 20)); return { response: dialogAnswer }; } },
    openAt: () => true,
  });
  bridge = startBridge({ dataDir, port });
  for (let i = 0; i < 100; i++) {
    try { if ((await rawRequest('GET', `${endpoint()}/health`)).status === 200) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('bridge never came up on ' + port);
});
after(() => { try { bridge.stop(); } catch { /* already down */ } rmSync(dataDir, { recursive: true, force: true }); });

test('before any pairing exists, today\'s unpaired extension keeps working: ingest and the outbox answer without a token, no lockout', async () => {
  const x = extension({ endpoint: endpoint(), token: '' });
  assert.equal(tokenOnDisk(), null); assert.equal(pairingOnDisk(), null);

  // the stock extension sends only the bridge header — through the guard, as the 0.7.0 worker does
  const ing = await x.HQGuard.guardedFetch(x.cfg(), '/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, events: [EVENT], live: null }) });
  assert.equal(ing.status, 200); assert.equal((await ing.json()).stored, 1);
  const outbox = await x.HQGuard.guardedFetch(x.cfg(), '/social/outbox', {});
  assert.equal(outbox.status, 200);
  // an old extension that never heard of the guard (bridge header only) is let in too
  const old = await rawRequest('POST', `${endpoint()}/ingest`, { headers: { 'x-hq-bridge': '1', 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, events: [], live: null }) });
  assert.equal(old.status, 200);
  // a web page still can't: no extension origin → no CORS, and no bridge header → 403
  assert.equal((await rawRequest('POST', `${endpoint()}/ingest`, { headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' })).status, 403);

  // the Brief says "not paired" and never asks the app for it
  wire.requests.length = 0;
  const t = await x.HQAssist.tick();
  assert.equal(t.state, 'unpaired');
  assert.ok(!wire.requests.some(([, p]) => p.startsWith('/assist/')), 'no /assist request before a pairing');
  assert.equal(x.badge.text, '');
  // and the routes fail closed for anyone who tries anyway
  assert.equal((await rawRequest('GET', `${endpoint()}/assist/brief`, { headers: { 'x-hq-bridge': '1' } })).status, 401);
});

test('Allow with the answer lost (the popup closed mid-pair): the extension ends up holding exactly the token the app stored', async () => {
  const x = extension({ endpoint: endpoint(), token: '' });
  dialogAnswer = 1; dialogLog.length = 0;
  wire.loseAnswerFor = '/pair';
  const r = await x.HQAssist.startPair();   // the worker runs this; nothing in it touches a popup
  wire.loseAnswerFor = null;
  assert.equal(r.status, 'unreachable', 'the worker never saw the 200');

  // the owner's dialog was parentless, named the code, and Deny is the default
  assert.equal(dialogLog.length, 1);
  const d = dialogLog[0];
  assert.equal(d.parent, undefined); assert.deepEqual(d.buttons, ['Deny', 'Allow']); assert.equal(d.defaultId, 0); assert.equal(d.cancelId, 0);
  const pending = x.local.get('hq_pair_pending');
  assert.ok(pending && /^[0-9a-f]{64}$/.test(pending.token));
  assert.ok(d.message.includes(pending.code));
  assert.ok(!JSON.stringify(d).includes(pending.token), 'the token is never shown');

  // the app stored what the extension proposed; the extension has not adopted it yet and still sends no token
  assert.equal(tokenOnDisk(), pending.token);
  assert.equal(x.cfg().token, '');
  assert.equal(pairingOnDisk().origin, EXT_ORIGIN);

  // the next popup open / alarm: promote() verifies the proof and adopts the pending token
  const p = await x.HQAssist.promote();
  assert.equal(p.state, 'paired');
  assert.equal(x.cfg().token, tokenOnDisk(), 'exactly the token the app stored');
  assert.equal(x.local.has('hq_pair_pending'), false); assert.equal(x.session.has('hq_pair_code'), false);

  // the token is live at once on every route, with no restart
  const withTok = await x.HQGuard.guardedFetch(x.cfg(), '/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, events: [], live: null }) });
  assert.equal(withTok.status, 200);
  const noTok = await rawRequest('POST', `${endpoint()}/ingest`, { headers: { 'x-hq-bridge': '1', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noTok.status, 401);
  const brief = await x.HQAssist.tick();
  assert.ok(['ok', 'nobrief'].includes(brief.state), brief.state);   // no data/brief.json in the temp folder: "no brief yet"
  // the temp files an atomic write leaves are gone
  assert.deepEqual(readdirSync(dataDir).filter((f) => /\.tmp$/.test(f)), []);
});

test('Deny leaves the existing pairing and the extension\'s token exactly as they were', async () => {
  const x = extension({ endpoint: endpoint(), token: tokenOnDisk() });
  const before = { token: tokenOnDisk(), pairing: pairingOnDisk() };
  dialogAnswer = 0;
  const r = await x.HQAssist.startPair();
  assert.equal(r.status, 'denied');
  assert.equal(tokenOnDisk(), before.token); assert.deepEqual(pairingOnDisk(), before.pairing);
  assert.equal(x.cfg().token, before.token);
  assert.equal(x.local.has('hq_pair_pending'), false, 'a denied proposal is dropped');
  assert.equal(x.badge.text, '', 'the code leaves the badge');
});

test('re-pairing goes through the dialog (which says it replaces) and ends with the new token on both sides', async () => {
  const x = extension({ endpoint: endpoint(), token: tokenOnDisk() });
  const old = tokenOnDisk();
  dialogAnswer = 1; dialogLog.length = 0;
  const r = await x.HQAssist.startPair();
  assert.equal(r.status, 'paired');
  assert.match(dialogLog[0].detail, /replaces the existing pairing/);
  assert.notEqual(tokenOnDisk(), old);
  assert.equal(x.cfg().token, tokenOnDisk());
});

test('the popup does not own the pairing: it only asks the worker (bridge:pair) and never POSTs /pair itself', () => {
  const popup = readFileSync(join(EXT_DIR, 'popup.js'), 'utf8');
  assert.match(popup, /type: 'bridge:pair'/);
  assert.doesNotMatch(popup, /['"`]\/pair['"`]/);
});
