// MAPS HQ bridge routes and projection (CONTRACT "Local bridge routes — the map (/world/*)"). Invented data only.
//   node --test dashboard/world-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { projectWorld, cleanPins, refOf } = require('./world-project.js');
const routes = require('./world-routes.js');

const NOW = Date.parse('2026-11-25T12:00:00Z');
const LATEST = {
  scan: { id: '2026-11-25', date: '2026-11-25T09:00:00Z' },
  account: { level: 7, title: 'Artificer', xp: 4200, xp_into_level: 300, xp_to_next: 700, streak: { scan_days: 4 },
    daily_top3: [{ kind: 'quick', label: 'Push the lamp shop', reason: '2 ahead', project_id: 'lamp-shop', quest_id: null }] },
  projects: [
    { id: 'lamp-shop', name: 'Lamp Shop', path: 'C:/secret/path/lamp', stack: ['next', 'ts'], completion: { pct: 60 }, level: 3,
      activity: { state: 'active', days_since_commit: 1 },
      metrics: { code_health: { build: 'red', build_note: 'tsc broke in src/x.ts' },
        git_safety: { has_git: true, has_remote: true, remote: 'git@example.invalid:o/lamp.git', branch: 'feat/x', dirty: 23, ahead: 2, unpushed: true, last_commit_subject: 'wip secret thing' },
        risk_security: { secrets_found: 3 } },
      insights: ['an insight that must not leave'] },
    { id: 'old-thing', name: 'Old Thing', activity: { state: 'dormant', days_since_commit: 300 }, metrics: {} },
    { id: '../bad id', name: 'Bad' },
  ],
  quests: [
    { id: 'q-lamp-shop-build', title: 'Fix Lamp Shop build', tier: 'red', project_id: 'lamp-shop', status: 'open', age_days: 2 },
    { id: 'q-lamp-shop-push', title: 'Push Lamp Shop (2 ahead)', tier: 'orange', project_id: 'lamp-shop', status: 'open' },
    { id: 'q-old-thing-done', title: 'Done one', tier: 'yellow', project_id: 'old-thing', completed: true },
    { id: 'q-gone-x', title: 'Orphan', tier: 'red', project_id: 'not-here', status: 'open' },
  ],
};
const BRIEF = {
  items: [
    { key: 'dirty:lamp-shop:23', rule: 'dirty', severity: 'med', text: 'Commit 23 files in Lamp Shop', why: 'Uncommitted work', source: 'scan', action: { kind: 'go', tab: 'projects', projectId: 'lamp-shop' } },
    { key: 'money-late:b1:x', rule: 'money-late', severity: 'high', text: 'Rent is late (40 000 DA)', source: 'money', action: { kind: 'go', tab: 'money' } },
    { key: 'secrets:lamp-shop:3', rule: 'secrets', severity: 'high', text: '3 secrets in .env.local of Lamp Shop', source: 'scan', action: { kind: 'go', tab: 'projects', projectId: 'lamp-shop' } },
  ],
  overflow: [{ key: 'passwords-reused:a:2', rule: 'passwords-reused', severity: 'med', text: 'bank.example reuses a password', source: 'security', action: { kind: 'go', tab: 'security' } }],
};
const DELIVERY = { v: 1, projects: { 'lamp-shop': { client: true, items: [{ id: 'i1', text: 'Contact form', done: false }, { id: 'i2', text: 'Logo', done: true }] }, 'not-here': { client: true, items: [] } } };
const PINS = { v: 1, hq: { lng: 3.05, lat: 36.75, label: 'Studio' }, districts: [
  { id: 'lamp-co', name: 'Lamp Co', kind: 'client', fixer: { lng: 3.06, lat: 36.76 }, projects: ['lamp-shop', '../x'] },
  { id: 'BAD ID', name: 'x' }, { id: 'lamp-co', name: 'dupe' }, { id: 'atelier', name: 'Atelier', kind: 'weird' },
] };

test('projection keeps names and facts, drops paths, remotes, subjects, insights, money and security rows', () => {
  const w = projectWorld({ latest: LATEST, brief: BRIEF, delivery: DELIVERY, pins: PINS, now: NOW });
  const s = JSON.stringify(w);
  for (const bad of ['C:/secret', 'example.invalid', 'feat/x', 'wip secret', 'an insight', 'tsc broke', 'Rent', '40 000', 'bank.example', '.env.local', 'money-late', 'passwords-reused', 'bad id']) {
    assert.ok(!s.includes(bad), `leaked ${bad}`);
  }
  assert.equal(w.v, 1);
  assert.equal(w.scanAgeHours, 3);
  assert.deepEqual(w.rank, { level: 7, title: 'Artificer', xp: 4200, xpIntoLevel: 300, xpToNext: 700, streakDays: 4 });
  assert.deepEqual(w.projects.map((p) => p.id), ['lamp-shop', 'old-thing']);
  const lamp = w.projects[0];
  assert.equal(lamp.build, 'red'); assert.equal(lamp.dirty, 23); assert.equal(lamp.secrets, true); assert.equal(lamp.stack, 'next, ts');
  assert.deepEqual(w.quests.map((q) => q.id), ['q-lamp-shop-build', 'q-lamp-shop-push']);
  assert.deepEqual(w.brief.map((b) => b.rule), ['dirty', 'secrets']);
  assert.equal(w.brief[0].ref, refOf('dirty:lamp-shop:23'));
  assert.equal(w.brief[0].projectId, 'lamp-shop');
  assert.equal(w.brief[1].text, 'Secrets sit in plain text in this repo');
  assert.equal(w.brief[1].why, '');
  assert.deepEqual(w.scope, [{ projectId: 'lamp-shop', done: 1, total: 2, open: [{ id: 'i1', text: 'Contact form' }] }]);
  assert.equal(w.top3[0].projectId, 'lamp-shop');
  assert.deepEqual(w.pins.districts.map((d) => [d.id, d.kind, d.projects]), [['lamp-co', 'client', ['lamp-shop']], ['atelier', 'client', []]]);
});

test('pins: wrong version, bad coordinates and empty names are refused', () => {
  assert.equal(cleanPins({ v: 2 }), null);
  const p = cleanPins({ v: 1, hq: { lng: 500, lat: 1 }, districts: [{ id: 'a', name: '   ' }, { id: 'b', name: 'B', fixer: { lng: 1, lat: 99 } }] });
  assert.equal(p.hq, null);
  assert.deepEqual(p.districts, [{ id: 'b', name: 'B', kind: 'client', projects: [] }]);
});

test('empty inputs give an empty world, never a throw', () => {
  const w = projectWorld({ now: NOW });
  assert.deepEqual([w.projects, w.quests, w.brief, w.top3, w.scope, w.rank, w.pins], [[], [], [], [], [], null, null]);
});

// ---- the routes over a real server -------------------------------------------------------------------------------
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-'));
  const dataDir = path.join(dir, 'data');
  const worldRoot = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dataDir, 'world'), { recursive: true });
  fs.mkdirSync(path.join(worldRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(worldRoot, 'index.html'), '<!doctype html><title>map</title>');
  fs.writeFileSync(path.join(worldRoot, 'assets', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(worldRoot, '.hidden.js'), 'x');
  fs.writeFileSync(path.join(dir, 'outside.js'), 'outside');
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(LATEST));
  fs.writeFileSync(path.join(dataDir, 'brief.json'), JSON.stringify(BRIEF));
  fs.writeFileSync(path.join(dataDir, 'world', 'pins.json'), JSON.stringify(PINS));
  const opened = [];
  routes.setDeps({ dataDir, worldRoot, openAt: (r) => { opened.push(r); return true; }, now: () => NOW });
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!routes.handleRoute(req, res, { url, send })) send(404, { ok: false, error: 'not mine' });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ dir, dataDir, server, opened, port: server.address().port })));
}
function call(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* static */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

test('the key: created once, 64 hex, mode 0600, in the URL fragment only; a damaged key file is never replaced', async () => {
  const s = await setup();
  try {
    const url = routes.worldUrl();
    const m = /^http:\/\/127\.0\.0\.1:47821\/world\/#k=([0-9a-f]{64})$/.exec(url);
    assert.ok(m, url);
    assert.equal(routes.worldUrl(), url);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.dataDir, '.world-key')).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(s.dataDir, '.world-key'), 'damaged');
    assert.equal(routes.worldUrl(), null);
    const r = await call(s.port, 'GET', '/world/state', { headers: { 'x-hq-world': m[1] } });
    assert.equal(r.status, 503);
    assert.equal(fs.readFileSync(path.join(s.dataDir, '.world-key'), 'utf8'), 'damaged');
  } finally { s.server.close(); }
});

test('GET /world/state needs the key and answers the projection', async () => {
  const s = await setup();
  try {
    const key = routes.ensureKey();
    assert.equal((await call(s.port, 'GET', '/world/state')).status, 401);
    assert.equal((await call(s.port, 'GET', '/world/state', { headers: { 'x-hq-world': 'f'.repeat(64) } })).status, 401);
    const r = await call(s.port, 'GET', '/world/state', { headers: { 'x-hq-world': key } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.json.world.projects[0].id, 'lamp-shop');
    assert.equal(r.json.world.pins.hq.label, 'Studio');
    assert.ok(!r.text.includes('Rent'));
    fs.unlinkSync(path.join(s.dataDir, 'latest.json'));
    const empty = await call(s.port, 'GET', '/world/state', { headers: { 'x-hq-world': key } });
    assert.deepEqual(empty.json, { ok: true, world: null, reason: 'no scan yet' });
  } finally { s.server.close(); }
});

test('POST /world/open opens only what main finds again in its own files', async () => {
  const s = await setup();
  try {
    const h = { 'x-hq-world': routes.ensureKey(), 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
    const ok = await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'brief', ref: refOf('dirty:lamp-shop:23') } } });
    assert.equal(ok.status, 200);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'project', id: 'old-thing' } } })).status, 200);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'quest', id: 'q-lamp-shop-build' } } })).status, 200);
    assert.deepEqual(s.opened, [{ tab: 'projects', projectId: 'lamp-shop' }, { tab: 'projects', projectId: 'old-thing' }, { tab: 'tasks' }]);
    // a money row and a security row are never opened from the map, even by their real ref
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'brief', ref: refOf('money-late:b1:x') } } })).status, 404);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'brief', ref: refOf('passwords-reused:a:2') } } })).status, 404);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'project', id: 'nope' } } })).status, 404);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: 'not json' })).status, 400);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: h, body: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: { ...h, 'sec-fetch-site': 'cross-site' }, body: { target: { kind: 'project', id: 'old-thing' } } })).status, 403);
    assert.equal((await call(s.port, 'POST', '/world/open', { headers: { 'x-hq-world': h['x-hq-world'], origin: 'https://evil.example' }, body: {} })).status, 403);
    assert.equal((await call(s.port, 'GET', '/world/open', { headers: h })).status, 404);
    assert.equal(s.opened.length, 3);
  } finally { s.server.close(); }
});

test('static: the built map with a CSP; no dotfiles, no escapes, no unknown types', async () => {
  const s = await setup();
  try {
    const idx = await call(s.port, 'GET', '/world/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers['content-security-policy'], /default-src 'self'/);
    assert.match(idx.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(idx.headers['x-content-type-options'], 'nosniff');
    assert.equal((await call(s.port, 'GET', '/world')).status, 301);
    assert.equal((await call(s.port, 'GET', '/world/assets/a.js')).text, 'console.log(1)');
    for (const p of ['/world/.hidden.js', '/world/../outside.js', '/world/%2e%2e/outside.js', '/world/assets/..%2f..%2foutside.js', '/world/nope.exe', '/world/assets/missing.js']) {
      const r = await call(s.port, 'GET', p);
      assert.notEqual(r.status, 200, p);
      assert.ok(!r.text.includes('outside'), p);
    }
    assert.equal((await call(s.port, 'POST', '/world/index.html')).status, 404);
  } finally { s.server.close(); }
});

test('caps: state 600 an hour, open 60 an hour', async () => {
  const s = await setup();
  try {
    const key = routes.ensureKey();
    assert.equal(routes.CAPS.state, 600);
    assert.equal(routes.CAPS.open, 60);
    const h = { 'x-hq-world': key, 'sec-fetch-site': 'same-origin' };
    let last;
    for (let i = 0; i < 61; i++) last = await call(s.port, 'POST', '/world/open', { headers: h, body: { target: { kind: 'project', id: 'old-thing' } } });
    assert.equal(last.status, 429);
  } finally { s.server.close(); }
});
