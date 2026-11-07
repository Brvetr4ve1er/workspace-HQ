// /pair and /assist/* on the local bridge, through the REAL startBridge (Host check, CORS, then the mounted route) on a
// throwaway free port in a temp data folder — never 47821 (the owner's running app holds it), never the repo's data/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { startBridge } = require('./browser-bridge.js');
const routes = require('./assist-bridge-routes.js');

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const OTHER = 'chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk';
const TOKEN = 'a1'.repeat(32);
const BRIDGE = { 'x-hq-bridge': '1' };

let dataDir, bridge, port;
const audits = [];
const opened = [];
let dialogAnswer = 1;

// a fixture brief whose item text, keys and actions carry names an outside surface must never see
const fixtureBrief = {
  v: 1, generatedAt: '2026-11-07T14:05:00.000Z', more: 1, errors: [],
  items: [
    { key: 'secrets:alpha-site:3', rule: 'secrets', severity: 'high', text: '3 secrets in alpha-site', why: 'Rotate the alpha-site key', source: 'scan', age: 'scan 2 h ago', action: { kind: 'go', tab: 'projects', projectId: 'alpha-site-id' } },
    { key: 'scan-stale:-:2', rule: 'scan-stale', severity: 'med', text: 'The scan is 2 days old', why: 'x', source: 'scan', age: 'scan 2 d ago', action: { kind: 'scan' } },
    { key: 'money-late:Rent Alpha:5', rule: 'money-late', severity: 'high', text: 'Rent Alpha is 5 days late', why: 'y', source: 'money', age: 'live', action: { kind: 'go', tab: 'money', sub: 'runway' } },
  ],
  overflow: [{ key: 'dirty:beta-site:12', rule: 'dirty', severity: 'low', text: 'beta-site has 12 uncommitted files', why: 'z', source: 'scan', age: 'x', action: { kind: 'go', tab: 'projects', projectId: 'beta-site' } }],
};
const SECRET_BITS = ['alpha-site', 'beta-site', 'Rent Alpha', 'alpha-site-id', 'Rotate the', 'C:/work'];
const WORDING = { secrets: 'Secrets found in a project', 'scan-stale': 'The scan is out of date', 'money-late': 'A bill is late', dirty: 'A project has uncommitted files' };

const fakeLib = {
  projectBrief(brief, { now, firstSeen }) {
    assert.equal(typeof now, 'number');
    assert.deepEqual(firstSeen, {});
    const one = (i) => ({ ref: routes.refOf(i.key), rule: i.rule, severity: i.severity, sevWord: i.severity === 'high' ? 'Act now' : 'Soon', text: WORDING[i.rule], count: 0, isNew: false, age: i.age, nav: { kind: i.action.kind, tab: i.action.tab || 'home', sub: i.action.sub } });
    return { v: 1, generatedAt: brief.generatedAt, ageMinutes: 12, stale: false, counts: { high: 2, med: 1, low: 0 }, items: brief.items.map(one), overflow: brief.overflow.map(one), overflowLine: '1 more behind these', more: 1, errorSources: [] };
  },
};

function call({ method = 'GET', path = '/assist/brief', host = `127.0.0.1:${port}`, origin = EXT, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...(origin ? { origin } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let obj = null; try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* none */ } resolve({ code: res.statusCode, obj, raw: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const authed = (extra = {}) => ({ ...BRIDGE, 'x-hq-token': TOKEN, ...extra });
const json = (o) => ({ 'content-type': 'application/json', body: JSON.stringify(o) });
const settle = () => new Promise((r) => setTimeout(r, 25));

function setUp() {
  routes.setDeps({
    dataDir,
    dialog: { showMessageBox: async () => ({ response: dialogAnswer }) },
    openAt: (r) => { opened.push(r); return true; },
    loadProject: async () => fakeLib,
    loadAudit: async () => ({ record: (dir, e) => { assert.equal(dir, dataDir); audits.push(e); } }),
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hq-assist-test-'));
  writeFileSync(join(dataDir, 'brief.json'), JSON.stringify(fixtureBrief));
  setUp();
  // a free port: bind 0, read it, release it, hand it to startBridge (which takes a port, not a listener)
  port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  bridge = startBridge({ dataDir, port });
  for (let i = 0; i < 100; i++) {
    try { if ((await call({ path: '/health' })).code === 200) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('bridge never came up on ' + port);
});
after(() => { try { bridge.stop(); } catch { /* already down */ } rmSync(dataDir, { recursive: true, force: true }); });

test('unpaired: every /assist route is 401 pair first (they fail closed)', async () => {
  assert.equal(existsSync(join(dataDir, '.bridge-token')), false);
  const a = await call({ headers: BRIDGE });
  assert.equal(a.code, 401); assert.equal(a.obj.error, 'pair first');
  const b = await call({ method: 'POST', path: '/assist/open', headers: BRIDGE, ...json({ ref: '0'.repeat(12) }) });
  assert.equal(b.code, 401);
});

test('the bridge header is required first, on /pair and /assist alike', async () => {
  assert.equal((await call({})).code, 403);
  assert.equal((await call({ method: 'POST', path: '/pair', ...json({ code: '1234', token: TOKEN }) })).code, 403);
});

test('/pair from a web page origin is refused; from an extension, Deny is 403 and writes nothing', async () => {
  assert.equal((await call({ method: 'POST', path: '/pair', origin: 'https://example.com', headers: BRIDGE, ...json({ code: '1234', token: TOKEN }) })).code, 403);
  dialogAnswer = 0;
  const denied = await call({ method: 'POST', path: '/pair', headers: BRIDGE, ...json({ code: '1234', token: TOKEN }) });
  assert.equal(denied.code, 403);
  assert.equal(existsSync(join(dataDir, '.bridge-token')), false);
});

test('Allow pairs; the answer carries no token; the new token is required on the very next request', async () => {
  dialogAnswer = 1;
  const r = await call({ method: 'POST', path: '/pair', headers: BRIDGE, ...json({ code: '5678', token: TOKEN }) });
  assert.equal(r.code, 200); assert.deepEqual(r.obj, { ok: true });
  assert.ok(!r.raw.includes(TOKEN));
  assert.equal(readFileSync(join(dataDir, '.bridge-token'), 'utf8').trim(), TOKEN);
  assert.equal((await call({ headers: BRIDGE })).code, 401, 'no token header');
  assert.equal((await call({ headers: authed({ 'x-hq-token': 'f'.repeat(64) }) })).code, 401, 'wrong token');
  assert.equal((await call({ headers: authed() })).code, 200);
});

test('wrong origin is 403 even with the right token', async () => {
  const r = await call({ origin: OTHER, headers: authed() });
  assert.equal(r.code, 403); assert.equal(r.obj.error, 'wrong origin');
  assert.equal((await call({ origin: 'https://example.com', headers: authed() })).code, 403);
  assert.equal((await call({ origin: '', headers: authed() })).code, 403);
});

test('GET /assist/brief: the projection, and nothing of the brief behind it', async () => {
  const r = await call({ headers: authed() });
  assert.equal(r.code, 200); assert.equal(r.obj.ok, true);
  const p = r.obj.brief;
  assert.equal(p.items.length, 3); assert.equal(p.overflow.length, 1);
  assert.equal(p.items[0].text, 'Secrets found in a project');
  for (const bit of SECRET_BITS) assert.ok(!r.raw.includes(bit), `leaked ${bit}`);
  for (const k of ['key', 'why', 'projectId', 'source', 'action']) assert.ok(!r.raw.includes(`"${k}"`), `field ${k}`);
  for (const it of p.items) assert.deepEqual(Object.keys(it.nav).sort().filter((k) => !['kind', 'tab', 'sub'].includes(k)), []);
  assert.deepEqual(r.obj.brief.items.map((i) => i.ref), fixtureBrief.items.map((i) => routes.refOf(i.key)));
});

test('cleanProjection drops every field the allowlist does not name', () => {
  const dirty = {
    v: 1, generatedAt: 'g', ageMinutes: 3, stale: false, counts: { high: 1, med: 0, low: 0, extra: 9 },
    items: [{ ref: 'abcdef012345', rule: 'secrets', severity: 'high', sevWord: 'Act now', text: 't', count: 2, isNew: true, age: 'a', nav: { kind: 'go', tab: 'projects', sub: 'runway', projectId: 'alpha-site-id', path: 'C:/work/alpha-site' }, why: 'WHY-LEAK', key: 'KEY-LEAK', projectId: 'PID-LEAK' }, { ref: 'not-a-ref', text: 'bad' }],
    overflow: [], overflowLine: 'o', more: 0, errorSources: ['github', 7], leak: 'SECRET-LEAK',
  };
  const out = routes.cleanProjection(dirty);
  const s = JSON.stringify(out);
  for (const bit of ['alpha-site', 'WHY-LEAK', 'KEY-LEAK', 'PID-LEAK', 'projectId', 'SECRET-LEAK', 'extra', 'not-a-ref', 'C:/work']) assert.ok(!s.includes(bit), bit);
  assert.deepEqual(out.items[0].nav, { kind: 'go', tab: 'projects', sub: 'runway' });
  assert.deepEqual(out.errorSources, ['github']);
  assert.equal(routes.cleanProjection(null), null);
});

test('POST /assist/open: a ref maps back to its item\'s full action for openAt; a scan only opens Home and says so', async () => {
  const open = (ref) => call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref }) });
  opened.length = 0;
  const [secrets, scan, money, over] = [0, 1, 2].map((i) => routes.refOf(fixtureBrief.items[i].key)).concat(routes.refOf(fixtureBrief.overflow[0].key)).map((x) => x);
  let r = await open(secrets); assert.equal(r.code, 200);
  assert.deepEqual(opened.at(-1), { tab: 'projects', projectId: 'alpha-site-id' });
  r = await open(money); assert.equal(r.code, 200);
  assert.deepEqual(opened.at(-1), { tab: 'money', sub: 'runway' });
  r = await open(over); assert.equal(r.code, 200);
  assert.deepEqual(opened.at(-1), { tab: 'projects', projectId: 'beta-site' });
  r = await open(scan); assert.equal(r.code, 200);
  assert.deepEqual(opened.at(-1), { tab: 'home' });
  assert.match(r.obj.note, /start scans in the app/);
  assert.equal(opened.length, 4);
});

test('POST /assist/open: an unknown or malformed ref is 404 and opens nothing', async () => {
  opened.length = 0;
  for (const ref of ['0'.repeat(12), 'zz', '', null, 5, { a: 1 }]) {
    const r = await call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref }) });
    assert.equal(r.code, 404, String(ref));
  }
  assert.equal(opened.length, 0);
});

test('an oversize body is drained, then answered 413, and the next request is served (open and pair)', async () => {
  const big = Buffer.alloc(8 * 1024 + 10, 0x20);
  const r = await call({ method: 'POST', path: '/assist/open', headers: { ...authed(), 'content-type': 'application/json' }, body: big });
  assert.equal(r.code, 413);
  const p = await call({ method: 'POST', path: '/pair', headers: { ...BRIDGE, 'content-type': 'application/json' }, body: big });
  assert.equal(p.code, 413);
  assert.equal((await call({ headers: authed() })).code, 200);
  assert.equal((await call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref: '0'.repeat(12) }) })).code, 404);
});

test('bad JSON is 400', async () => {
  const r = await call({ method: 'POST', path: '/assist/open', headers: { ...authed(), 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(r.code, 400);
});

test('a missing brief.json is an honest empty answer, not an error', async () => {
  const f = join(dataDir, 'brief.json');
  const keep = readFileSync(f, 'utf8');
  rmSync(f);
  const r = await call({ headers: authed() });
  assert.equal(r.code, 200); assert.equal(r.obj.brief, null); assert.equal(r.obj.reason, 'no brief yet');
  writeFileSync(f, keep);
});

test('a projection module that is not there yet is 503, not a crash', async () => {
  routes.setDeps({ dataDir, dialog: { showMessageBox: async () => ({ response: 0 }) }, openAt: () => true, loadProject: async () => { throw new Error('nope'); }, loadAudit: async () => ({ record() {} }) });
  const r = await call({ headers: authed() });
  assert.equal(r.code, 503);
  setUp();
});

test('each call makes exactly one audit record with door browser', async () => {
  audits.length = 0;
  await call({ headers: authed() });
  await call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref: '0'.repeat(12) }) });
  await call({ origin: OTHER, headers: authed() });
  await call({ headers: BRIDGE });
  await settle();
  assert.equal(audits.length, 4);
  assert.deepEqual(audits.map((a) => [a.tool, a.ok]), [['assist.brief', true], ['assist.open', false], ['assist.brief', false], ['assist.brief', false]]);
  for (const a of audits) {
    assert.equal(a.door, 'browser');
    assert.deepEqual(Object.keys(a).sort(), ['at', 'door', 'ms', 'ok', 'pid', 'tier', 'tool']);
    assert.ok(Number.isFinite(a.ms));
    assert.ok(['read', 'note', 'run', 'stage'].includes(a.tier));
  }
  assert.ok(!JSON.stringify(audits).includes(TOKEN));
});

test('a broken audit module never breaks a route', async () => {
  routes.setDeps({ dataDir, dialog: { showMessageBox: async () => ({ response: 0 }) }, openAt: () => true, loadProject: async () => fakeLib, loadAudit: async () => ({ record() { throw new Error('disk full'); } }) });
  assert.equal((await call({ headers: authed() })).code, 200);
  await settle();
  setUp();
});

test('hourly caps: 120 briefs and 60 opens, then 429', async () => {
  setUp();   // fresh counters
  let last;
  for (let i = 0; i < 120; i++) { last = await call({ headers: authed() }); assert.equal(last.code, 200, 'brief ' + i); }
  assert.equal((await call({ headers: authed() })).code, 429);
  for (let i = 0; i < 60; i++) { last = await call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref: '0'.repeat(12) }) }); assert.equal(last.code, 404); }
  assert.equal((await call({ method: 'POST', path: '/assist/open', headers: authed(), ...json({ ref: '0'.repeat(12) }) })).code, 429);
  setUp();
});

test('anything else under /assist/ is 404, and a foreign Host never reaches the routes', async () => {
  assert.equal((await call({ path: '/assist/nope', headers: authed() })).code, 404);
  assert.equal((await call({ method: 'POST', path: '/assist/brief', headers: authed(), ...json({}) })).code, 404);
  assert.equal((await call({ host: `attacker.example:${port}`, headers: authed() })).code, 403);
  assert.equal((await call({ host: `attacker.example:${port}`, method: 'POST', path: '/pair', headers: BRIDGE, ...json({ code: '1234', token: TOKEN }) })).code, 403);
});

test('exported helpers for browser-bridge.js: token getter, pairing, proof, CORS', () => {
  assert.equal(routes.tokenGetter(), TOKEN);
  assert.equal(routes.pairing().origin, EXT);
  const nonce = '0f'.repeat(16);
  assert.equal(routes.proofFor(nonce), require('node:crypto').createHmac('sha256', TOKEN).update(nonce).digest('hex'));
  assert.equal(routes.corsAllowed(EXT, '/assist/brief'), true);
  assert.equal(routes.corsAllowed(OTHER, '/assist/brief'), false);
});

// Pass-time check: once brief-senses-tray has landed, the real projection must hold no fixture name either.
const realProject = resolve(HERE, 'brief-project.mjs');
test('the real brief-project.mjs leaks no fixture name through the route', { skip: !existsSync(realProject) && 'brief-project.mjs has not landed yet' }, async () => {
  const lib = await import(pathToFileURL(realProject).href);
  routes.setDeps({ dataDir, dialog: { showMessageBox: async () => ({ response: 0 }) }, openAt: () => true, loadProject: async () => lib, loadAudit: async () => ({ record() {} }) });
  const r = await call({ headers: authed() });
  assert.equal(r.code, 200);
  for (const bit of SECRET_BITS) assert.ok(!r.raw.includes(bit), `real projection leaked ${bit}`);
  setUp();
});
