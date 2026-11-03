// node --test dashboard/bake-freshness.test.mjs — the launch-only bake skip.
// Contract: skip (true) ONLY when data.js is strictly newer than every input
// build-data.mjs reads — sidecars, data/*.json stores, and the bake script
// itself; any doubt means bake (false).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dataJsFresh, DATA_INPUTS } = require('./bake-freshness.js');

const T0 = Date.now() - 60 * 60000;   // an hour ago — leaves room to stamp before/after
const at = (file, ms) => fs.utimesSync(file, new Date(ms), new Date(ms));

function world(t, { bakedAt = T0 + 30000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-fresh-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  const reportsDir = path.join(root, 'reports');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(reportsDir); fs.mkdirSync(dataDir);
  const dataJs = path.join(root, 'data.js');
  const bakeScript = path.join(root, 'build-data.mjs');
  fs.writeFileSync(dataJs, 'window.DATA = {};\n');
  fs.writeFileSync(bakeScript, '// placeholder');
  const sidecar = path.join(reportsDir, 'Workspace Status 2026-01-01.json');
  fs.writeFileSync(sidecar, '{"scan":{"id":"2026-01-01"}}');
  const store = path.join(dataDir, DATA_INPUTS[0]);
  fs.writeFileSync(store, '{}');
  for (const f of [sidecar, store, bakeScript]) at(f, T0);
  at(dataJs, bakedAt);
  return { reportsDir, dataDir, dataJs, bakeScript, sidecar, store };
}

test('fresh: data.js newer than every input → skip the launch bake', (t) => {
  const w = world(t);
  assert.equal(dataJsFresh(w), true);
});

test('a newer sidecar forces the bake', (t) => {
  const w = world(t);
  at(w.sidecar, T0 + 60000);
  assert.equal(dataJsFresh(w), false);
});

test('a newer data/*.json store forces the bake', (t) => {
  const w = world(t);
  at(w.store, T0 + 60000);
  assert.equal(dataJsFresh(w), false);
});

test('an edited build-data.mjs forces the bake (edit-and-reload repo)', (t) => {
  const w = world(t);
  at(w.bakeScript, T0 + 60000);
  assert.equal(dataJsFresh(w), false);
});

test('an input stamped the same ms as the bundle is NOT trusted — bake', (t) => {
  const w = world(t, { bakedAt: T0 + 30000 });
  at(w.sidecar, T0 + 30000);
  assert.equal(dataJsFresh(w), false);
});

test('missing data.js → bake', (t) => {
  const w = world(t);
  fs.rmSync(w.dataJs);
  assert.equal(dataJsFresh(w), false);
});

test('unreadable sidecar dir → bake, never guess', (t) => {
  const w = world(t);
  fs.rmSync(w.reportsDir, { recursive: true, force: true });
  assert.equal(dataJsFresh(w), false);
});

test('non-sidecar files in the reports dir (Quest Board.md) do not force a bake', (t) => {
  const w = world(t);
  const qb = path.join(w.reportsDir, 'Quest Board.md');
  fs.writeFileSync(qb, '# board');
  at(qb, T0 + 60000);
  assert.equal(dataJsFresh(w), true);
});

test('missing optional data/*.json inputs never force a bake', (t) => {
  const w = world(t);
  fs.rmSync(w.store);
  assert.equal(dataJsFresh(w), true);
});
