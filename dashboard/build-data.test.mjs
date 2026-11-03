// node --test dashboard/build-data.test.mjs — the sidecar cache (first test
// coverage for the baker). Contracts: output is byte-identical to an uncached
// bake (minus built_at); unchanged NON-newest sidecars come from the cache and
// are never re-parsed; the newest sidecar (rewritten by every scan) is always
// parsed fresh and never cached, so a steady-state bake rewrites only data.js.
// Placeholder sidecars only — never real scan data (public repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, 'build-data.mjs');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-build-data-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
  return d;
}
const sidecar = (dir, day, extra = {}) =>
  fs.writeFileSync(path.join(dir, `Workspace Status ${day}.json`), JSON.stringify({ scan: { id: day }, account: { level: 1 }, ...extra }));
function bake(reportsDir, out) {
  const r = spawnSync(process.execPath, [BUILD, reportsDir], { encoding: 'utf8', env: { ...process.env, HQ_DATA_OUT: out } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const read = (out) => fs.readFileSync(out, 'utf8');
const parse = (out) => JSON.parse(read(out).replace(/^window\.DATA = /, '').replace(/;\s*$/, ''));
const stripStamp = (s) => s.replace(/"built_at":"[^"]*"/, '"built_at":""');
const cachePath = (out) => path.join(path.dirname(out), '_data-cache.js');

test('cold bake: every scan lands, latest is the newest, nothing cached yet', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01', { note: 'old' });
  sidecar(reports, '2026-01-02', { note: 'new' });
  const stdout = bake(reports, out);
  assert.match(stdout, /2 scan\(s\), 0 from cache/);
  const d = parse(out);
  assert.equal(d.scans.length, 2);
  assert.deepEqual(d.scans.map((s) => s.scan.id), ['2026-01-01', '2026-01-02']);
  assert.equal(d.latest.scan.id, '2026-01-02');
  assert.ok(typeof d.built_at === 'string' && d.built_at);
  assert.ok(fs.existsSync(cachePath(out)), 'cache written beside data.js');
});

test('warm bake: non-newest history comes from the cache, output byte-identical minus built_at', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01');
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  const cold = stripStamp(read(out));
  const cacheBefore = fs.statSync(cachePath(out)).mtimeMs;
  const stdout = bake(reports, out);
  assert.match(stdout, /2 scan\(s\), 1 from cache/, 'only the non-newest sidecar is cached; the newest is parsed fresh');
  assert.equal(stripStamp(read(out)), cold, 'byte-identical bake');
  assert.equal(fs.statSync(cachePath(out)).mtimeMs, cacheBefore, 'an all-hit bake rewrites nothing but data.js');
});

test('the cached string really is what lands in data.js (no silent re-parse)', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01');
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  const cache = JSON.parse(fs.readFileSync(cachePath(out), 'utf8'));
  cache.entries['Workspace Status 2026-01-01.json'].json = '{"scan":{"id":"SENTINEL-FROM-CACHE"}}';
  fs.writeFileSync(cachePath(out), JSON.stringify(cache));
  bake(reports, out);
  assert.equal(parse(out).scans[0].scan.id, 'SENTINEL-FROM-CACHE');
});

test('a changed history sidecar misses the cache and is re-read', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01', { note: 'v1' });
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  sidecar(reports, '2026-01-01', { note: 'v2-rewritten' });
  const f = path.join(reports, 'Workspace Status 2026-01-01.json');
  fs.utimesSync(f, new Date(), new Date(Date.now() + 2000));
  const stdout = bake(reports, out);
  assert.match(stdout, /0 from cache/);
  assert.equal(parse(out).scans[0].note, 'v2-rewritten');
});

test('a new scan day: yesterday rolls into the cache, the new newest stays out of it', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01');
  bake(reports, out);
  assert.ok(!fs.existsSync(cachePath(out)), 'a single (newest) sidecar caches nothing');
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  const cache = JSON.parse(fs.readFileSync(cachePath(out), 'utf8'));
  assert.deepEqual(Object.keys(cache.entries), ['Workspace Status 2026-01-01.json']);
  assert.equal(parse(out).latest.scan.id, '2026-01-02');
});

test('every file the bake writes stays inside the dashboard/_*.js ignore pattern (tmp included)', (t) => {
  const reports = tmp(t), dir = tmp(t), out = path.join(dir, 'data.js');
  sidecar(reports, '2026-01-01');
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['_data-cache.js', 'data.js'], 'no stray temp (a 9 MB personal-data file in a PUBLIC repo) left behind');
});

test('a corrupt cache file degrades to a full parse, never a failed bake', (t) => {
  const reports = tmp(t), out = path.join(tmp(t), 'data.js');
  sidecar(reports, '2026-01-01');
  sidecar(reports, '2026-01-02');
  bake(reports, out);
  fs.writeFileSync(cachePath(out), 'garbage not json');
  const stdout = bake(reports, out);
  assert.match(stdout, /2 scan\(s\), 0 from cache/);
  assert.equal(parse(out).scans.length, 2);
});

test('empty or missing reports dir still bakes a valid bundle', (t) => {
  const out = path.join(tmp(t), 'data.js');
  const stdout = bake(tmp(t), out);
  assert.match(stdout, /0 scan\(s\)/);
  const d = parse(out);
  assert.deepEqual(d.scans, []);
  assert.equal(d.latest, null);
});
