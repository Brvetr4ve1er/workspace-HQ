// The gate's invented data: it builds a store, has what the scenarios need, holds no real name, and gates-core hands the file to both Electron steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateData, writeGateData } from './gate-data.mjs';
import { createStore } from '../src/live/store.js';
import { runStep, buildCatalog } from '../../tools/gates-core.mjs';

test('the fixture builds a store with what the scenarios need', () => {
  const D = gateData();
  assert.ok(D.scans.length >= 3);
  const st = createStore(D, null);
  const M = st.model;
  assert.equal(M.N, D.scans.length);
  assert.ok(M.P0.length >= 3);
  assert.ok(M.P0.some((p) => p.git !== false && p.dev), 'a git project');
  assert.ok(M.at(0).P0.some((p) => (p.secrets || p.sec || 0) || JSON.stringify(p).includes('secret')), 'a project with a secret');
  assert.ok(M.AUTOS.some((a) => !a.destructive), 'a non-destructive automation');
  assert.ok(M.AUTOS.some((a) => a.destructive), 'a destructive one');
  assert.ok(M.INTERACTIVE.length >= 1, 'an interactive claude automation');
  assert.ok(M.T0.length >= 2, 'open tasks which Home reads');
  assert.ok(M.T0.some((t) => t.project || t.proj || t.pid), 'an open task that belongs to a project');
  assert.ok(D.weeklyRecap && D.weeklyRecap.stats, 'a weekly recap');
  assert.deepEqual(D.latest.changes_since_prev, []);
  assert.deepEqual(D.scans.map((s) => s.scan.id), [...D.scans.map((s) => s.scan.id)].sort());
});

test('placeholder convention only: no real path or name', () => {
  const text = JSON.stringify(gateData());
  assert.ok(!/Users[\/]|Documents[\/]|AppData/i.test(text));
  for (const m of text.matchAll(/"path":"([^"]*)"/g)) assert.match(m[1], /^C:\/dev\/[a-z]$/);
  for (const m of text.matchAll(/"name":"(Project [^"]*)"/g)) assert.match(m[1], /^Project [A-Z]$/);
});

test('writeGateData writes a loadable window.DATA file', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gd-')), 'gate-data.js');
  try {
    writeGateData(f);
    const win = {}; new Function('window', fs.readFileSync(f, 'utf8'))(win);
    assert.equal(win.DATA.scans.length, gateData().scans.length);
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

test('gates-core gives the file to both Electron steps through HQ_V5_DATA_FILE', async () => {
  const seen = { run: [], start: [], data: [] };
  const io = {
    now: () => 0, log() {},
    async run(spec) { seen.run.push(spec); return { code: 0, out: '[selftest] {"combos":1,"errors":0,"unresolved":0,"failures":0}\n[cdp-gate] 1/1 passed\nPASS boot (1 ms)\n', timedOut: false, ms: 1 }; },
    async start(spec) { seen.start.push(spec); return { pid: 1, stop: async () => {}, output: () => '' }; },
    async freePort() { return 9999; },
    uniqueProfile: (t) => 'hq-gates-' + t + '-1',
    async cleanupProfile() {},
    async countFiles() { return 1; },
    gateDataFile(profile) { seen.data.push(profile); return '/tmp/' + profile + '/gate-data.js'; },
  };
  const cat = buildCatalog();
  await runStep(cat.find((s) => s.id === 'selftest'), io);
  await runStep(cat.find((s) => s.id === 'cdp'), io);
  assert.equal(seen.run[0].env.HQ_V5_DATA_FILE, '/tmp/hq-gates-selftest-1/gate-data.js');
  assert.equal(seen.start[0].env.HQ_V5_DATA_FILE, '/tmp/hq-gates-cdp-1/gate-data.js');
  assert.deepEqual(seen.data, ['hq-gates-selftest-1', 'hq-gates-cdp-1']);
});

test('dev-main redirects only with the variable set, and the boot scenario proves the fixture took', () => {
  const dev = fs.readFileSync(new URL('../dev-main.js', import.meta.url), 'utf8');
  assert.match(dev, /if \(!file\) return;/, 'unset means the real file, as before');
  assert.match(dev, /HQ_V5_DATA_FILE/);
  assert.match(dev, /gatedata = '1'/);
  const gate = fs.readFileSync(new URL('./cdp-gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /gate_fixture === true/);
  assert.equal(gateData().gate_fixture, true);
});

test('cdp-gate.mjs and dev-main.js still parse', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const f of ['./cdp-gate.mjs', '../dev-main.js']) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(f, import.meta.url))], { stdio: 'pipe' });
});
