// node --test dashboard/data-refresh.test.mjs — the shared assemble→bake→reload
// runner. The contracts under test: one quest completion = ONE bake and ONE
// reload (bursts coalesce, the latest.json watcher never echoes a self-write),
// exit codes are honored (a failed step is surfaced, never a reload of stale
// data), and the external scheduled scan still refreshes the always-open UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { init, selfWriteMarker, createLatestWatcher } = require('./data-refresh.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-data-refresh-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
  return d;
}

// scripted deps: `calls` records every runNode/marker/guard/outcome event in order
function deps(over = {}) {
  const calls = [];
  const d = {
    runNode: (script, args) => { calls.push([path.basename(script), ...(args || [])]); return Promise.resolve(); },
    assembleScript: 'ASM', buildScript: 'BAKE',
    latest: () => ({ scan: { id: '2026-01-01' } }),
    scanBegin: () => { calls.push(['begin']); return true; },
    scanEnd: (code) => calls.push(['end', code]),
    marker: { note: () => calls.push(['note']), matches: () => false },
    onDone: () => calls.push(['done']),
    onError: (e) => calls.push(['error', e && e.message]),
    ...over,
  };
  return { d, calls };
}

// ------------------------------------------------------------------- refresh
test('refresh: assemble --date then bake, guard paired, marker noted, ONE reload', async () => {
  const { d, calls } = deps();
  const r = init(d);
  assert.equal(await r.refresh(), 'done');
  assert.deepEqual(calls, [['begin'], ['ASM', '--date', '2026-01-01'], ['BAKE'], ['note'], ['end', 0], ['done']]);
  assert.equal(r.lastFailed(), false);
});

test('refresh: no scan yet — bake only, still succeeds', async () => {
  const { d, calls } = deps({ latest: () => null });
  assert.equal(await init(d).refresh(), 'done');
  assert.deepEqual(calls, [['begin'], ['BAKE'], ['note'], ['end', 0], ['done']]);
});

test('refresh: a running scan owns the write — nothing runs, guard untouched', async () => {
  const { d, calls } = deps({ scanBegin: () => false });
  assert.equal(await init(d).refresh(), 'scan-running');
  assert.deepEqual(calls, [], 'no assemble, no bake, no scanEnd');
});

test('refresh: a burst coalesces — two DONE clicks = re-assembled, but ONE reload and ONE guard pair', async () => {
  let release;
  const gate = new Promise((res) => (release = res));
  let nRun = 0;
  const { d, calls } = deps({
    runNode: (script, args) => { calls.push([path.basename(script), ...(args || [])]); return ++nRun === 1 ? gate : Promise.resolve(); },
  });
  const r = init(d);
  const p1 = r.refresh();
  assert.equal(await r.refresh(), 'queued', 'second click folds into the in-flight run');
  release();
  assert.equal(await p1, 'done');
  const asm = calls.filter((c) => c[0] === 'ASM');
  assert.equal(asm.length, 2, 're-assembled so the second write is read');
  assert.equal(calls.filter((c) => c[0] === 'done').length, 1, 'ONE reload');
  assert.deepEqual(calls.filter((c) => c[0] === 'begin' || c[0] === 'end'), [['begin'], ['end', 0]], 'ONE guard pair');
});

test('refresh: a failed assemble is surfaced — no reload, no self-write marker, exit code reaches scanEnd', async () => {
  const boom = Object.assign(new Error('assemble.mjs exit 3'), { exitCode: 3 });
  const { d, calls } = deps({ runNode: (s) => (s === 'ASM' ? Promise.reject(boom) : Promise.resolve()) });
  const r = init(d);
  assert.equal(await r.refresh(), 'failed');
  assert.ok(calls.some((c) => c[0] === 'error'), 'onError surfaced it');
  assert.ok(!calls.some((c) => c[0] === 'done'), 'the window is NOT reloaded as if it worked');
  assert.ok(!calls.some((c) => c[0] === 'note'), 'no marker — the watcher fallback stays armed');
  assert.ok(calls.some((c) => c[0] === 'end' && c[1] === 3), 'honest exit code');
  assert.equal(r.lastFailed(), true, 'applyDone can retry a stuck quest');
});

test('refresh: recovers after a failure — the retry consumes lastFailed, it never re-arms on its own', async () => {
  let fail = true, begin = true;
  const { d } = deps({
    runNode: () => (fail ? Promise.reject(Object.assign(new Error('x'), { exitCode: 1 })) : Promise.resolve()),
    scanBegin: () => begin,
  });
  const r = init(d);
  assert.equal(await r.refresh(), 'failed');
  assert.equal(r.lastFailed(), true);
  fail = false;
  assert.equal(await r.refresh(), 'done');
  assert.equal(r.lastFailed(), false);
  begin = false;   // a refused run (scan running) must not resurrect the retry flag
  assert.equal(await r.refresh(), 'scan-running');
  assert.equal(r.lastFailed(), false);
});

test('refresh: a refused run (scan holds the guard) keeps a pending retry armed', async () => {
  const boom = Object.assign(new Error('x'), { exitCode: 1 });
  let fail = true, begin = true;
  const { d } = deps({ runNode: () => (fail ? Promise.reject(boom) : Promise.resolve()), scanBegin: () => begin });
  const r = init(d);
  assert.equal(await r.refresh(), 'failed');
  begin = false;
  assert.equal(await r.refresh(), 'scan-running');
  assert.equal(r.lastFailed(), true, 'still armed — the retry was never attempted');
});

// ----------------------------------------------------------- selfWriteMarker
test('selfWriteMarker: matches exactly the noted write, not a later one', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'latest.json');
  const m = selfWriteMarker(f);
  assert.equal(m.matches(), false, 'nothing noted yet');
  fs.writeFileSync(f, '{"scan":1}');
  m.note();
  assert.equal(m.matches(), true, 'the self-write is recognized');
  fs.writeFileSync(f, '{"scan":2,"other":true}');
  fs.utimesSync(f, new Date(), new Date(Date.now() + 2000));
  assert.equal(m.matches(), false, 'an external write no longer matches');
});

test('selfWriteMarker: a missing file never matches and never throws', (t) => {
  const m = selfWriteMarker(path.join(tmp(t), 'nope.json'));
  m.note();
  assert.equal(m.matches(), false);
});

// -------------------------------------------------------- createLatestWatcher
const mk = (over = {}) => {
  const state = { running: false, matches: false, fired: 0 };
  const w = createLatestWatcher({
    isScanRunning: () => state.running,
    marker: { matches: () => state.matches },
    onExternal: () => state.fired++,
    debounceMs: 20, recheckMs: 20,
    ...over,
  });
  return { state, w };
};

test('watcher: an external latest.json write bakes + reloads once (events debounced)', async () => {
  const { state, w } = mk();
  w.onEvent('latest.json');
  w.onEvent('latest.json');   // assemble writes can fire several fs events
  await sleep(80);
  assert.equal(state.fired, 1);
  w.close();
});

test('watcher: other files are ignored', async () => {
  const { state, w } = mk();
  w.onEvent('quest-overrides.json');
  await sleep(50);
  assert.equal(state.fired, 0);
  w.close();
});

test('watcher: the app\'s own write is skipped — no second bake + reload (the echo failure scenario)', async () => {
  const { state, w } = mk();
  state.matches = true;   // the refresh runner noted this write
  w.onEvent('latest.json');
  await sleep(80);
  assert.equal(state.fired, 0);
  w.close();
});

test('watcher: defers while a scan holds the guard, then skips the scan\'s own marked write', async () => {
  const { state, w } = mk();
  state.running = true;
  w.onEvent('latest.json');
  await sleep(50);
  assert.equal(state.fired, 0, 'deferred, not fired, while the scan runs');
  state.running = false; state.matches = true;   // the scan ended 0 and noted its write
  await sleep(80);
  assert.equal(state.fired, 0, 'the scan already baked + reloaded');
  w.close();
});

test('watcher: a scan that FAILED after writing latest.json still gets the fallback bake', async () => {
  const { state, w } = mk();
  state.running = true;
  w.onEvent('latest.json');
  await sleep(50);
  state.running = false;   // scan ended non-zero: close handler did NOT bake or note
  await sleep(80);
  assert.equal(state.fired, 1, 'fallback refresh keeps the window honest');
  w.close();
});

test('watcher: close() drops the pending timer (no bake mid-quit)', async () => {
  const { state, w } = mk();
  w.onEvent('latest.json');
  w.close();
  await sleep(60);
  assert.equal(state.fired, 0);
});
