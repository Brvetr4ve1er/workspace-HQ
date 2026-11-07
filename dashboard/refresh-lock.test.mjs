// data/.refresh.lock (dashboard/refresh-lock.js): the app's Scan and a session's raw pass exclude each other.
// Temp folders and fake clocks/pids only. Placeholder data — the repo is public.
//   node --test dashboard/refresh-lock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { create, refusalText, LOCK_NAME, STALE_MS } = require('./refresh-lock.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-lock-'));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
const T0 = Date.parse('2026-11-07T10:00:00Z');
function rig(d, o = {}) {
  const clock = { t: T0 };
  const alive = new Set(o.alive || [1111, 2222, 3333]);
  const make = (pid) => create({ dataDir: d, now: () => clock.t, pid, isAlive: (p) => alive.has(p) });
  return { clock, alive, make };
}

test('the app and a session exclude each other, in both directions, with the documented file shape', () => {
  const d = tmp();
  try {
    const { make } = rig(d);
    const app = make(1111), mcp = make(2222);
    assert.equal(LOCK_NAME, '.refresh.lock');
    assert.equal(app.take('app'), true);
    const rec = JSON.parse(fs.readFileSync(path.join(d, '.refresh.lock'), 'utf8'));
    assert.deepEqual(Object.keys(rec), ['pid', 'by', 'startedAt']);
    assert.equal(rec.by, 'app'); assert.equal(rec.pid, 1111);
    assert.equal(mcp.take('mcp'), false, 'the session is refused while the app holds it');
    assert.equal(mcp.held().by, 'app');
    assert.equal(app.release('app'), true);
    assert.equal(mcp.take('mcp'), true);
    assert.equal(app.take('app'), false, 'and the app is refused while a session holds it');
    assert.equal(app.held().by, 'mcp');
    assert.equal(mcp.take('mcp'), false, 'not re-entrant: a second pass from a session is refused too');
    assert.equal(app.take('nobody'), false, 'unknown holder names are refused');
  } finally { rm(d); }
});

test('stale by a dead pid and by 15 minutes; a fresh live holder is never reclaimed', () => {
  const d = tmp();
  try {
    const { clock, alive, make } = rig(d);
    const mcp = make(2222), app = make(1111);
    assert.equal(mcp.take('mcp'), true);
    clock.t += 60e3;
    assert.equal(app.take('app'), false);
    alive.delete(2222);                                        // the pid is gone
    assert.equal(app.held(), null, 'a dead holder is no holder');
    assert.equal(app.take('app'), true, 'reclaimed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, '.refresh.lock'), 'utf8')).by, 'app');
    clock.t += STALE_MS - 1000;                                // still alive, just under the ceiling
    assert.equal(mcp.take('mcp'), false);
    clock.t += 2000;                                           // pid reuse ceiling
    assert.equal(STALE_MS, 15 * 60e3);
    assert.equal(mcp.held(), null);
    assert.equal(mcp.take('mcp'), true, 'a live pid does not keep a 15-minute-old lock');
  } finally { rm(d); }
});

test('only the holder releases; setPid re-points the lock at the child that does the work', () => {
  const d = tmp();
  try {
    const { alive, make } = rig(d);
    const mcp = make(2222), app = make(1111);
    mcp.take('mcp');
    assert.equal(app.release('app'), false, 'the app is not the holder');
    assert.equal(mcp.release('app'), false);
    assert.equal(app.setPid('app', 3333), false, 'only the holder can re-point it');
    assert.equal(mcp.setPid('mcp', 3333), true);
    assert.equal(mcp.held().pid, 3333);
    assert.equal(fs.readdirSync(d).filter((n) => n.includes('.tmp-')).length, 0, 'no temp file left behind');
    alive.delete(2222);                                        // the session closes; the child lives on
    assert.equal(app.take('app'), false, 'the lock follows the child, not the closed session');
    assert.equal(mcp.release('mcp', { pid: 9999 }), false, 'a different pid cannot release it');
    assert.equal(mcp.release('mcp', { pid: 3333 }), true);
    assert.equal(mcp.held(), null);
    assert.equal(mcp.release('mcp'), false, 'nothing left to release');
  } finally { rm(d); }
});

test('an empty or half-written lock blocks briefly, then counts as stale', () => {
  const d = tmp();
  try {
    const { clock, make } = rig(d);
    const app = make(1111);
    const file = path.join(d, '.refresh.lock');
    fs.writeFileSync(file, '');
    const m = fs.statSync(file).mtimeMs;
    clock.t = m + 1000;
    assert.equal(app.take('app'), false, 'another process is between its create and its write');
    clock.t = m + 60e3;
    assert.equal(app.take('app'), true);
    fs.writeFileSync(file, '{not json');
    clock.t = fs.statSync(file).mtimeMs + 60e3;
    assert.equal(app.take('app'), true);
  } finally { rm(d); }
});

test('it never throws on a missing or impossible data folder (and fails open, because the lock is only a belt)', () => {
  const d = tmp();
  try {
    const missing = create({ dataDir: path.join(d, 'not', 'yet') });
    assert.equal(missing.held(), null);
    assert.equal(missing.release('app'), false);
    assert.equal(missing.setPid('app', 5), false);
    assert.equal(missing.take('app'), true, 'the folder is created');
    assert.equal(missing.release('app'), true);
    const blocker = path.join(d, 'a-file');
    fs.writeFileSync(blocker, 'x');
    const impossible = create({ dataDir: path.join(blocker, 'data') });
    assert.equal(impossible.take('app'), true);
    assert.equal(impossible.held(), null);
    assert.equal(impossible.release('app'), false);
    const noDir = create({});
    assert.equal(noDir.take('app'), true);
    assert.equal(noDir.held(), null);
    assert.equal(noDir.release('app'), false);
    assert.equal(noDir.setPid('app', 5), false);
  } finally { rm(d); }
});

test('the default liveness check sees this very process as alive and a bogus pid as dead', () => {
  const d = tmp();
  try {
    const a = create({ dataDir: d, pid: process.pid });
    assert.equal(a.take('mcp'), true);
    assert.equal(create({ dataDir: d, pid: 1 }).take('app'), false, 'a live holder (this test process) keeps it');
    const b = create({ dataDir: d, pid: process.pid });
    b.release('mcp');
    fs.writeFileSync(path.join(d, '.refresh.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, by: 'mcp', startedAt: new Date().toISOString() }));
    assert.equal(create({ dataDir: d }).held(), null, 'a pid that is not running is no holder');
  } finally { rm(d); }
});

test('refusal wording: the tray sentence for a session pass, a plain one for the app', () => {
  assert.equal(refusalText({ by: 'mcp' }), 'a raw pass started from a Claude session is still running — try again in a minute');
  assert.match(refusalText({ by: 'app' }), /scan is already running/);
  assert.ok(refusalText(null));
});
