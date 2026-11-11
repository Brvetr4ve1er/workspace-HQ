// node --test dashboard/machine-history.test.mjs
// hq:machine-history:read — the read path for System › Machine › "How the PC changed". Real files in a temp directory, placeholder values.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MH = require('./machine-history.js');
const DH = require('./disk-history.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'machine-history-'));
const put = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
const row = (i, o = {}) => ({ at: '2026-10-' + String(10 + i).padStart(2, '0') + 'T10:00:00', cpu: 20 + i, ram: 60, diskFreeGB: 80 - i, startup: 10, temp: 3.1, pingMs: 12, updateDays: 4, ...o });
const read = (dir) => MH.create({ dataDir: dir }).read();

test('absent files give an honest empty answer, not an error', () => {
  const r = read(tmp());
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.disk, { lines: [], note: 'needs two days of readings' });
  assert.deepEqual(r.counts, { rows: 0, dropped: 0, diskDays: 0 });
});

test('the rows come back with exactly the eight fields, in the file order, `at` untouched', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0), row(1), row(2)]);
  const r = read(dir);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['at', 'cpu', 'diskFreeGB', 'pingMs', 'ram', 'startup', 'temp', 'updateDays']);
  assert.equal(r.rows[1].at, '2026-10-11T10:00:00', 'a zone-less local string is passed through, not converted');
  assert.equal(r.rows[2].diskFreeGB, 78);
  assert.deepEqual(r.counts, { rows: 3, dropped: 0, diskDays: 0 });
});

test('the answer never carries gpuDriverDays, gpuTempC, battery or a path', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0, { gpuDriverDays: 15, gpuTempC: 44.1, battery: 85, path: 'C:\\placeholder\\x', note: 'C:\\placeholder\\y' }), row(1, { gpuDriverDays: 0, gpuTempC: null, battery: null })]);
  put(dir, 'disk-history.json', { v: 1, rows: [
    { day: '2026-10-01', at: '2026-10-01T10:00:00.000Z', partial: false, items: [{ label: 'C:\\placeholder\\alpha', gb: 1 }] },
    { day: '2026-10-08', at: '2026-10-08T10:00:00.000Z', partial: false, items: [{ label: 'C:\\placeholder\\alpha', gb: 6 }] },
  ] });
  const r = read(dir);
  const text = JSON.stringify(r);
  for (const bad of ['gpuDriverDays', 'gpuTempC', 'battery', 'placeholder', 'C:', '\\\\']) assert.ok(!text.includes(bad), bad);
  assert.deepEqual(r.disk.lines, [{ label: 'alpha', deltaGB: 5, days: 7 }]);
  assert.deepEqual(r.counts, { rows: 2, dropped: 0, diskDays: 2 });
});

test('a value that is not a finite number becomes null, a row without a usable `at` is dropped and counted', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0, { cpu: '55', ram: null, temp: 'x' }), { at: 'later', cpu: 1 }, { cpu: 2 }, null, 'text', row(1)]);
  const r = read(dir);
  assert.equal(r.rows.length, 2);
  assert.equal(r.counts.dropped, 4);
  assert.equal(r.rows[0].cpu, null);
  assert.equal(r.rows[0].ram, null);
  assert.equal(r.rows[0].temp, null);
  assert.equal(r.rows[0].pingMs, 12, 'a 0 ping is passed as the collector wrote it; the renderer decides it is a gap');
});

test('a 0 ping and 0 update days are passed through unchanged (the renderer turns them into gaps)', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0, { pingMs: 0, updateDays: 0 })]);
  const r = read(dir);
  assert.equal(r.rows[0].pingMs, 0);
  assert.equal(r.rows[0].updateDays, 0);
});

test('an oversize history file is refused, not half-read', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'pc-health-history.json'), '[' + ' '.repeat(MH.MAX_BYTES + 1) + ']');
  const r = read(dir);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /not read/);
  assert.ok(!('rows' in r));
});

test('a history file that is not a list, or not JSON, is an error in words; it is never rewritten or moved', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', { rows: [] });
  assert.match(read(dir).error, /not a list/);
  put(dir, 'pc-health-history.json', '{ nope');
  assert.match(read(dir).error, /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'pc-health-history.json'), 'utf8'), '{ nope');
  assert.deepEqual(fs.readdirSync(dir), ['pc-health-history.json']);
});

test('only the newest MAX_ROWS rows are considered', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', Array.from({ length: MH.MAX_ROWS + 30 }, (_, i) => ({ at: '2026-01-01T00:00:' + String(i % 60).padStart(2, '0'), cpu: i })));
  const r = read(dir);
  assert.equal(r.rows.length, MH.MAX_ROWS);
  assert.equal(r.rows[0].cpu, 30);
});

test('a damaged or oversize disk history degrades only the disk note; the charts rows still come back and the file is not touched', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0)]);
  put(dir, 'disk-history.json', '{ half');
  let r = read(dir);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.match(r.disk.note, /could not be read/);
  assert.deepEqual(r.disk.lines, []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['disk-history.json', 'pc-health-history.json'], 'read-only: nothing quarantined');
  fs.writeFileSync(path.join(dir, 'disk-history.json'), ' '.repeat(DH.STORE_MAX_BYTES + 1));
  r = read(dir);
  assert.match(r.disk.note, /too large/);
  put(dir, 'disk-history.json', { v: 9, rows: [] });
  assert.match(read(dir).disk.note, /newer version/);
});

test('a disk history with only partial readings says so in words instead of guessing', () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', []);
  put(dir, 'disk-history.json', { v: 1, rows: [{ day: '2026-11-11', at: '2026-11-11T09:00:00.000Z', partial: true, items: [{ label: 'alpha', gb: 5 }] }] });
  const r = read(dir);
  assert.deepEqual(r.disk.lines, []);
  assert.match(r.disk.note, /partial/);
  assert.equal(r.counts.diskDays, 1);
});

test('init registers hq:machine-history:read, starts disk history once, and the handler answers a plain object', async () => {
  const dir = tmp();
  put(dir, 'pc-health-history.json', [row(0)]);
  const handlers = {};
  const started = [];
  const diskHistory = { ...DH, init: (o) => { started.push(o.dataDir); return { stop() {} }; } };
  const h = MH.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dataDir: dir, diskHistory });
  assert.deepEqual(Object.keys(handlers), ['hq:machine-history:read']);
  assert.deepEqual(started, [dir]);
  assert.ok(h.disk);
  const r = await handlers['hq:machine-history:read']({});
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  const off = MH.init({ ipcMain: { handle() {} }, dataDir: dir, diskHistory, startDisk: false });
  assert.equal(off.disk, null);
  assert.equal(started.length, 1);
});

test('init survives a disk history that will not start, and a read never throws', () => {
  const dir = tmp();
  const log = console.error; console.error = () => {};
  try {
    const h = MH.init({ ipcMain: { handle() {} }, dataDir: dir, diskHistory: { ...DH, init: () => { throw new Error('boom'); } } });
    assert.equal(h.disk, null);
    const bad = MH.create({ dataDir: dir, fsMod: { ...fs, statSync: () => { throw new Error('denied'); } } }).read();
    assert.match(bad.error, /could not read the machine history/);
  } finally { console.error = log; }
});
