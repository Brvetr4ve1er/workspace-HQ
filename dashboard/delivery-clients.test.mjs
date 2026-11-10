// Clients list, main side (dashboard/delivery-clients.js): only marked projects, honest not-in-scan rows, counts and words only,
// the cap, read-only, one accounts.json read per list, no candidate walk, the 20 s cache, and the linkState mapping pinned
// against the engine's own buildView output. Temp dirs and invented names only — the repo is public.
//   node --test dashboard/delivery-clients.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './delivery-core.mjs';

const require = createRequire(import.meta.url);
const clients = require('./delivery-clients.js');
const delivery = require('./delivery.js');
const NOW = new Date('2026-11-10T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cls-'));
const entry = (o = {}) => ({ client: true, scopeFile: null, items: [], lastCopy: null, ...o });

// alpha: half-done SCOPE.md + a ready production deploy · beta: finished SCOPE.md + only a ready preview · gamma: client with no scope,
// no remote · delta-gone: marked but not in the latest scan · plain: in the scan, not marked
function make(o = {}) {
  const dataDir = tmp(), roots = {};
  for (const [id, text] of Object.entries({ alpha: '## One\n- [x] item a1\n- [ ] item a2\n## Two\n- [ ] item a3\n- [ ] item a4\n', beta: '## Only\n- [x] item b1\n- [x] item b2\n' })) {
    roots[id] = tmp();
    fs.writeFileSync(path.join(roots[id], 'SCOPE.md'), text);
  }
  roots.gamma = tmp(); roots.plain = tmp();
  const proj = (id, remote) => ({ id: id + '-site', name: id[0].toUpperCase() + id.slice(1) + ' Site', path: 'C:/work/' + id, metrics: { git_safety: remote ? { remote } : {} } });
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(o.latest || { projects: [proj('alpha', 'github.com/org-a/alpha'), proj('beta', 'github.com/org-b/beta'), proj('gamma'), proj('plain', 'github.com/org-p/plain')] }));
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify(o.accounts || { vercel: { projects: [{ name: 'alpha-site', repo: 'org-a/alpha' }, { name: 'beta-site', repo: 'org-b/beta' }], deploys: [
    { project: 'alpha-site', target: 'production', state: 'ready', at: '2026-11-09T08:00:00Z', url: 'https://alpha-site.example', branch: 'main' },
    { project: 'beta-site', target: 'preview', state: 'ready', at: '2026-11-09T08:00:00Z', url: 'https://beta-site-abc.example', branch: 'feat' },
  ] } }));
  const projects = o.state || { 'alpha-site': entry(), 'beta-site': entry({ lastCopy: { at: '2026-11-07T10:00:00Z', doneHashes: [] } }), 'gamma-site': entry(), 'delta-gone': entry(), 'plain-site': entry({ client: false, scopeFile: 'SCOPE.md' }) };
  if (o.state !== null) fs.writeFileSync(path.join(dataDir, 'delivery.json'), JSON.stringify({ v: 1, projects }));
  const resolve = (p) => { const m = /^C:\/work\/(\w+)$/.exec(p); return m && roots[m[1]] ? roots[m[1]] : null; };
  return { dataDir, roots, resolve };
}
const snap = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
// a counting seam over the real fs: which files were read, how many directories were listed
function seam() {
  const reads = [], dirs = [];
  const fsMod = Object.assign({}, fs, {
    readFileSync: (p, ...a) => { reads.push(path.basename(String(p))); return fs.readFileSync(p, ...a); },
    readdirSync: (p, ...a) => { dirs.push(String(p)); return fs.readdirSync(p, ...a); },
  });
  return { fsMod, reads, dirs, count: (name) => reads.filter((r) => r === name).length };
}
const mk = (m, extra = {}) => clients.create({ dataDir: m.dataDir, resolveProjectPath: m.resolve, now: () => NOW, ...extra });
const byId = (r) => Object.fromEntries(r.clients.map((c) => [c.id, c]));

test('only projects marked as a client job are listed; a marked one gone from the scan is inScan:false, not a service error', async () => {
  const m = make();
  const r = await mk(m).read();
  assert.equal(r.error, undefined);
  assert.deepEqual(r.clients.map((c) => c.id), ['alpha-site', 'beta-site', 'delta-gone', 'gamma-site']);
  assert.equal(r.omitted, 0);
  assert.equal(r.generatedAt, NOW.toISOString());
  const c = byId(r);
  assert.deepEqual(c['delta-gone'], { id: 'delta-gone', name: 'delta-gone', mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: false });
  assert.deepEqual([c['alpha-site'].name, c['alpha-site'].inScan, c['alpha-site'].mode, c['alpha-site'].done, c['alpha-site'].total], ['Alpha Site', true, 'client', 1, 4]);
  assert.deepEqual([c['beta-site'].done, c['beta-site'].total, c['beta-site'].lastCopyAt], [2, 2, '2026-11-07T10:00:00Z']);
  assert.deepEqual([c['gamma-site'].total, c['gamma-site'].linkState, c['gamma-site'].fileState], [0, 'none', null], 'a client with no scope: zero items, no file problem');
});

test('no client marked yet, and no delivery.json at all, are an empty list, not an error (and the scan is not even needed)', async () => {
  const m = make({ state: { 'plain-site': entry({ client: false }) } });
  assert.deepEqual((await mk(m).read()).clients, []);
  const none = make({ state: null, latest: { projects: [] } });
  fs.rmSync(path.join(none.dataDir, 'latest.json'));
  const r = await mk(none).read();
  assert.deepEqual([r.error, r.clients, r.omitted], [undefined, [], 0]);
});

test('a row carries ids, counts and words only: no item text, no milestone name, no update, no file content', async () => {
  const m = make();
  const r = await mk(m).read();
  const json = JSON.stringify(r);
  for (const leak of ['item a1', 'item a2', 'item b1', 'One', 'Only', 'milestone', 'update', 'Still to do', 'https://', 'SCOPE']) assert.ok(!json.includes(leak), 'leaked: ' + leak);
  for (const c of r.clients) assert.deepEqual(Object.keys(c).sort(), ['done', 'fileState', 'id', 'inScan', 'lastCopyAt', 'linkState', 'mode', 'name', 'total']);
});

test('51 marked clients are capped at 50 (sorted by id) and the one left out is counted', async () => {
  const state = {}, projects = [];
  for (let i = 0; i < 51; i++) { const id = 'c' + String(i).padStart(2, '0'); state[id] = entry(); projects.push({ id, name: 'Client ' + i, path: 'C:/work/none', metrics: { git_safety: {} } }); }
  const m = make({ state, latest: { projects } });
  const r = await mk(m).read();
  assert.equal(r.clients.length, 50);
  assert.equal(r.omitted, 1);
  assert.equal(r.clients[49].id, 'c49');
  assert.ok(!r.clients.some((c) => c.id === 'c50'));
});

test('a scope file that vanished reports its fileState without throwing', async () => {
  const m = make({ state: { 'alpha-site': entry({ scopeFile: 'docs/gone.md' }), 'beta-site': entry({ scopeFile: '../outside.md' }) } });
  const r = await mk(m).read();
  assert.equal(r.error, undefined);
  const c = byId(r);
  assert.deepEqual([c['alpha-site'].fileState, c['alpha-site'].total, c['alpha-site'].inScan], ['missing', 0, true]);
  // sanitizeState drops an escaping path, so the engine falls back to the root SCOPE.md instead of reading outside
  assert.equal(c['beta-site'].fileState, 'ok');
  assert.equal(c['beta-site'].total, 2);
  const m2 = make({ state: { 'alpha-site': entry() } });
  fs.rmSync(path.join(m2.roots.alpha, 'SCOPE.md'));
  const row = (await mk(m2).read()).clients[0];
  assert.deepEqual([row.fileState, row.total], [null, 0], 'no SCOPE.md at the root and no pick: no scope yet');
});

test('nothing is written: data/ and the project folders are byte-identical after a read (a damaged file is not set aside either)', async () => {
  const m = make();
  const before = [snap(m.dataDir), ...Object.values(m.roots).map(snap)];
  await mk(m).read();
  assert.deepEqual([snap(m.dataDir), ...Object.values(m.roots).map(snap)], before);
  fs.writeFileSync(path.join(m.dataDir, 'delivery.json'), '{ not json');
  const dam = snap(m.dataDir);
  const r = await mk(m).read();
  assert.match(r.error, /damaged/);
  assert.deepEqual(snap(m.dataDir), dam, 'no .corrupt file appears, the file is left as it is');
  fs.writeFileSync(path.join(m.dataDir, 'delivery.json'), JSON.stringify({ v: 1, projects: [] }));
  assert.match((await mk(m).read()).error, /damaged/);
});

test('accounts.json and latest.json are read once for N clients, and the candidate walk is never started', async () => {
  const m = make();
  const s = seam();
  const r = await mk(m, { fsMod: s.fsMod }).read();
  assert.equal(r.clients.length, 4);
  assert.equal(s.count('accounts.json'), 1);
  assert.equal(s.count('latest.json'), 1);
  assert.equal(s.dirs.length, 0, 'readdir is only the candidate walk: it never ran');
  // the engine's own read() does walk (guard that the seam can see a walk at all)
  const d2 = seam();
  const dl = delivery.create({ dataDir: m.dataDir, resolveProjectPath: m.resolve, now: () => NOW, fsMod: d2.fsMod });
  await dl.read('alpha-site');
  assert.ok(d2.dirs.length > 0);
});

test('the 20 s cache holds, is bypassed by a delivery write and by invalidate(), and expires', async () => {
  const m = make();
  const s = seam();
  let t = NOW.getTime();
  const c = mk(m, { fsMod: s.fsMod, now: () => new Date(t) });
  const first = await c.read();
  t += 5e3;
  assert.equal(await c.read(), first, 'inside 20 s, the same answer without another read');
  assert.equal(s.count('latest.json'), 1);
  // a delivery write (the file changes size): the next read is a new one
  const raw = JSON.parse(fs.readFileSync(path.join(m.dataDir, 'delivery.json'), 'utf8'));
  raw.projects['gamma-site'].items.push({ id: 'i-1', text: 'a new item', milestone: '', done: false, doneAt: null });
  fs.writeFileSync(path.join(m.dataDir, 'delivery.json'), JSON.stringify(raw));
  const second = await c.read();
  assert.notEqual(second, first);
  assert.equal(s.count('latest.json'), 2);
  assert.equal(byId(second)['gamma-site'].total, 1);
  c.invalidate();
  await c.read();
  assert.equal(s.count('latest.json'), 3);
  t += 21e3;
  await c.read();
  assert.equal(s.count('latest.json'), 4);
});

test('callers that arrive while a read is running share one build; an error is not cached', async () => {
  const m = make();
  let calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  const c = mk(m, { summaries: async (ids) => { calls++; await gate; return ids.map((id) => ({ id, name: id, mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: true })); } });
  const a = c.read(), b = c.read();
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.deepEqual(ra, rb);
  const bad = mk(m, { summaries: async () => { throw new Error('boom'); } });
  assert.deepEqual(await bad.read(), { error: 'boom' });
  assert.deepEqual(await bad.read(), { error: 'boom' }, 'asked again, not served from a cache');
});

test('a marked client while the latest scan is unreadable is a service error, not a list of "not in scan" rows', async () => {
  const m = make();
  fs.rmSync(path.join(m.dataDir, 'latest.json'));
  const r = await mk(m).read();
  assert.match(r.error, /latest scan/);
  assert.equal(r.clients, undefined);
});

test('summariesFor drops an id that is no longer marked and dedupes', () => {
  const m = make();
  const rows = clients.summariesFor({ L, dataDir: m.dataDir, resolveProjectPath: m.resolve, now: () => NOW, ids: ['alpha-site', 'alpha-site', 'plain-site', 'nobody'] });
  assert.deepEqual(rows.map((r) => r.id), ['alpha-site']);
});

// ---- linkState: the view has no such field; the mapping is pinned against buildView's own link ----
const dep = (o) => ({ project: 'p-site', target: 'production', state: 'ready', at: '2026-11-09T08:00:00Z', url: 'https://p-site.example', branch: 'main', ...o });
const viewFor = (deploys, remote = 'org/p') => L.buildView({ projectId: 'p-site', name: 'P', entry: entry(), scope: { source: 'none', scopeFile: null, fileState: null, fileDetail: null, parsed: null, candidates: [], walkTruncated: false, walkError: null },
  accounts: deploys === null ? null : { vercel: { projects: [{ name: 'p-site', repo: 'org/p' }], deploys } }, remote, now: NOW, tzOffsetMin: 0 }).view;

test('linkStateOf is pinned against buildView: production ready, preview ready, building, none, no snapshot, no remote', () => {
  const cases = [
    [[dep()], 'ready-production'],
    [[dep({ target: 'preview', branch: 'feat' })], 'ready-preview'],
    [[dep({ state: 'building' })], 'none'],                    // nothing ready: the card says why, there is no link
    [[], 'none'],
    [null, 'none'],
  ];
  for (const [deploys, want] of cases) {
    const v = viewFor(deploys);
    assert.equal(clients.linkStateOf(v.link), want, JSON.stringify(deploys));
    if (want === 'none') assert.equal(v.link, null);
  }
  assert.equal(clients.linkStateOf(viewFor([dep()], null).link), 'none', 'no remote, so no match');
  assert.equal(clients.linkStateOf({ kind: 'production', url: 'https://x.example', state: 'error' }), 'not-ready', 'guard: a link that is not ready');
  assert.equal(clients.linkStateOf({ kind: 'weird', url: 'https://x.example', state: 'ready' }), 'not-ready');
  assert.equal(clients.linkStateOf(null), 'none');
  assert.equal(clients.linkStateOf({ kind: 'preview', state: 'ready' }), 'none', 'a link with no url is no link');
  assert.deepEqual([...clients.LINK_STATES], ['ready-production', 'ready-preview', 'not-ready', 'none']);
});

test('the list matches the engine\'s own card (delivery.js read) on done, total, lastCopyAt and the link, for the same state', async () => {
  const m = make({ state: {} });
  let n = 0;
  const dl = delivery.create({ dataDir: m.dataDir, resolveProjectPath: m.resolve, now: () => NOW, newId: () => 'n' + ++n });
  for (const id of ['alpha-site', 'beta-site', 'gamma-site']) await dl.apply({ type: 'mark-client', projectId: id, on: true });
  await dl.apply({ type: 'copied', projectId: 'beta-site' });
  await dl.apply({ type: 'item-add', projectId: 'gamma-site', text: 'kept in the app', milestone: 'M' });
  const r = await mk(m).read();
  assert.equal(r.clients.length, 3);
  for (const c of r.clients) {
    const v = await dl.read(c.id);
    assert.deepEqual([c.done, c.total, c.lastCopyAt, c.mode, c.fileState, clients.linkStateOf(v.link)], [v.done, v.total, v.lastCopyAt, v.mode, v.fileState, c.linkState], c.id);
  }
  assert.deepEqual(r.clients.map((c) => [c.id, c.linkState]), [['alpha-site', 'ready-production'], ['beta-site', 'ready-preview'], ['gamma-site', 'none']]);
  assert.equal(byId(r)['gamma-site'].total, 1, 'a checklist kept in the app counts');
  assert.equal(byId(r)['beta-site'].lastCopyAt, NOW.toISOString());
});

test('init registers hq:delivery:clients and the handler answers like read(); it never throws at the renderer', async () => {
  const m = make();
  const handlers = {};
  const c = clients.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dataDir: m.dataDir, resolveProjectPath: m.resolve });
  assert.deepEqual(Object.keys(handlers), ['hq:delivery:clients']);
  const r = await handlers['hq:delivery:clients']({}, 'ignored');
  assert.equal(r.clients.length, 4);
  assert.equal(typeof c.invalidate, 'function');
  fs.writeFileSync(path.join(m.dataDir, 'delivery.json'), 'garbage');
  assert.match((await handlers['hq:delivery:clients']({})).error, /damaged/);
});
