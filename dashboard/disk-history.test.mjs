// node --test dashboard/disk-history.test.mjs
// The daily folder-size copy behind "what filled the disk". Real files in a temp directory, placeholder folder names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DH = require('./disk-history.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'disk-history-'));
const put = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
const get = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const exists = (dir, name) => fs.existsSync(path.join(dir, name));
const snap = (at, items, partial = false) => ({ at, partial, items: items.map(([label, gb]) => ({ path: 'C:\\placeholder\\' + label, label, gb })) });
// a local-time instant as the clock `now`
const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();
const iso = (y, m, d, h = 12) => new Date(local(y, m, d, h)).toISOString();
const run = (dir, nowMs) => DH.create({ dataDir: dir, now: () => nowMs }).tick();

test('writes nothing at all when pc-health-disk.json is absent', () => {
  const dir = tmp();
  assert.deepEqual(run(dir, local(2026, 11, 11)), { wrote: false, reason: 'no-source' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the first tick writes one row: day, at, partial, labels and GB only — never a path', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 12.345], ['beta', 3]]));
  const r = run(dir, local(2026, 11, 10, 13));
  assert.deepEqual(r, { wrote: true, day: '2026-11-10', rows: 1 });
  const file = get(dir, 'disk-history.json');
  assert.equal(file.v, 1);
  assert.deepEqual(file.rows, [{ day: '2026-11-10', at: iso(2026, 11, 10), partial: false, items: [{ label: 'alpha', gb: 12.35 }, { label: 'beta', gb: 3 }] }]);
  const text = fs.readFileSync(path.join(dir, 'disk-history.json'), 'utf8');
  assert.ok(!/placeholder\\|C:\\|\\\\|"path"/.test(text), 'no path in the file');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['disk-history.json', 'pc-health-disk.json'], 'no temp file left behind');
});

test('one row per local day: a later snapshot the same day replaces it, a new day adds a row, rows stay in day order', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 9), [['alpha', 10]]));
  run(dir, local(2026, 11, 10, 9));
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 15), [['alpha', 11]]));
  assert.equal(run(dir, local(2026, 11, 10, 15)).rows, 1);
  assert.deepEqual(get(dir, 'disk-history.json').rows.map((r) => r.items[0].gb), [11]);
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 9, 15), [['alpha', 9]]));   // an older day arrives later: it is added before, not after
  assert.equal(run(dir, local(2026, 11, 11)).rows, 2);
  assert.deepEqual(get(dir, 'disk-history.json').rows.map((r) => r.day), ['2026-11-09', '2026-11-10']);
});

test('the same snapshot twice writes once (nothing changed, nothing written)', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  assert.equal(run(dir, local(2026, 11, 10)).wrote, true);
  const before = fs.statSync(path.join(dir, 'disk-history.json')).mtimeMs;
  assert.deepEqual(run(dir, local(2026, 11, 10, 20)), { wrote: false, reason: 'unchanged' });
  assert.equal(fs.statSync(path.join(dir, 'disk-history.json')).mtimeMs, before);
});

test('an older snapshot never replaces a newer one of the same day, and a partial one never replaces a complete one', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 15), [['alpha', 11]]));
  run(dir, local(2026, 11, 10, 15));
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 9), [['alpha', 5]]));
  assert.equal(run(dir, local(2026, 11, 10, 16)).reason, 'unchanged');
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 18), [['alpha', 12]], true));
  assert.equal(run(dir, local(2026, 11, 10, 19)).reason, 'unchanged');
  const row = get(dir, 'disk-history.json').rows[0];
  assert.equal(row.items[0].gb, 11);
  assert.equal(row.partial, false);
});

test('at most 120 days are kept: the oldest fall off', () => {
  const dir = tmp();
  const rows = Array.from({ length: 125 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return { day: d.toISOString().slice(0, 10), at: d.toISOString(), partial: false, items: [{ label: 'alpha', gb: i }] };
  });
  put(dir, 'disk-history.json', { v: 1, rows });
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 11), [['alpha', 1]]));
  const r = run(dir, local(2026, 11, 11));
  assert.equal(r.rows, 120);
  const out = get(dir, 'disk-history.json').rows;
  assert.equal(out.length, 120);
  assert.equal(out[out.length - 1].day, '2026-11-11');
  assert.ok(out[0].day > '2026-01-06', 'the oldest days were dropped');
});

test('labels only: a path-shaped label is cut to its last segment; no label, a repeated label or a bad size makes the row partial', () => {
  assert.equal(DH.cleanLabel('C:\\placeholder\\Users\\alpha'), 'alpha');
  assert.equal(DH.cleanLabel('/placeholder/beta/'), 'beta');
  assert.equal(DH.cleanLabel('C:'), '');
  assert.equal(DH.cleanLabel(42), '');
  assert.equal(DH.cleanLabel('  .cache  '), '.cache');
  const dir = tmp();
  put(dir, 'pc-health-disk.json', { at: iso(2026, 11, 10), partial: false, items: [
    { path: 'C:\\placeholder\\a', label: 'alpha', gb: 4 }, { path: 'C:\\placeholder\\b', gb: 5 },            // no label: never falls back to the path
    { label: 'dup', gb: 1 }, { label: 'dup', gb: 2 }, { label: 'gamma', gb: 'big' }, { label: 'delta', gb: 2 },
  ] });
  run(dir, local(2026, 11, 10));
  const row = get(dir, 'disk-history.json').rows[0];
  assert.deepEqual(row.items, [{ label: 'alpha', gb: 4 }, { label: 'delta', gb: 2 }]);
  assert.equal(row.partial, true);
  assert.ok(!/C:|placeholder\\/.test(JSON.stringify(row)));
});

test('a snapshot that says partial:true makes a partial row', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]], true));
  run(dir, local(2026, 11, 10));
  assert.equal(get(dir, 'disk-history.json').rows[0].partial, true);
});

test('a source with no usable time falls back to the clock for its day; a source that is not a snapshot writes nothing', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', { items: [{ label: 'alpha', gb: 1 }] });
  assert.equal(run(dir, local(2026, 11, 12)).day, '2026-11-12');
  const d2 = tmp();
  for (const bad of [{ at: iso(2026, 11, 10) }, [], 'nope', '{ not json']) {
    put(d2, 'pc-health-disk.json', typeof bad === 'string' ? bad : bad);
    const r = run(d2, local(2026, 11, 10));
    assert.equal(r.wrote, false);
    assert.ok(['source-shape', 'source-unreadable'].includes(r.reason), r.reason);
  }
  assert.ok(!exists(d2, 'disk-history.json'));
});

test('an oversize source is refused before it is read', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'pc-health-disk.json'), 'x'.repeat(DH.SOURCE_MAX_BYTES + 1));
  assert.deepEqual(run(dir, local(2026, 11, 10)), { wrote: false, reason: 'source-too-big' });
  assert.ok(!exists(dir, 'disk-history.json'));
});

test('a corrupt store is moved aside, not emptied; the new row starts a fresh file; a second corruption keeps the first copy', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  put(dir, 'disk-history.json', '{ half a file');
  const log = console.error; console.error = () => {};
  try {
    const r = run(dir, local(2026, 11, 10));
    assert.equal(r.wrote, true);
    assert.equal(fs.readFileSync(path.join(dir, 'disk-history.json.corrupt'), 'utf8'), '{ half a file', 'the damaged bytes are kept');
    assert.equal(get(dir, 'disk-history.json').rows.length, 1);
    put(dir, 'disk-history.json', '[1,2,3]');
    put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 11), [['alpha', 11]]));
    run(dir, local(2026, 11, 11));
    assert.equal(fs.readFileSync(path.join(dir, 'disk-history.json.corrupt'), 'utf8'), '{ half a file');
    assert.equal(fs.readFileSync(path.join(dir, 'disk-history.json.corrupt-2'), 'utf8'), '[1,2,3]');
  } finally { console.error = log; }
});

test('a store written by a newer version, or an oversize one, is left alone and never overwritten', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  put(dir, 'disk-history.json', { v: 2, rows: [], future: true });
  assert.deepEqual(run(dir, local(2026, 11, 10)), { wrote: false, reason: 'newer-version' });
  assert.equal(get(dir, 'disk-history.json').future, true);
  const big = tmp();
  put(big, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  fs.writeFileSync(path.join(big, 'disk-history.json'), ' '.repeat(DH.STORE_MAX_BYTES + 1));
  assert.deepEqual(run(big, local(2026, 11, 10)), { wrote: false, reason: 'store-too-big' });
  assert.equal(fs.statSync(path.join(big, 'disk-history.json')).size, DH.STORE_MAX_BYTES + 1);
});

test('the write is atomic: a failed rename leaves the old file intact and no temp file behind', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  run(dir, local(2026, 11, 10));
  const before = fs.readFileSync(path.join(dir, 'disk-history.json'), 'utf8');
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 11), [['alpha', 12]]));
  const bad = { ...fs, renameSync: () => { throw new Error('disk full'); } };
  const r = DH.create({ dataDir: dir, now: () => local(2026, 11, 11), fsMod: bad }).tick();
  assert.equal(r.wrote, false);
  assert.equal(r.reason, 'error');
  assert.match(r.error, /disk full/);
  assert.equal(fs.readFileSync(path.join(dir, 'disk-history.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['disk-history.json', 'pc-health-disk.json']);
});

test('the temp file is named <file>.<pid>.tmp (the name the repo’s owner-data pin lists)', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  const seen = [];
  const spy = { ...fs, writeFileSync: (p, ...a) => { seen.push(path.basename(p)); return fs.writeFileSync(p, ...a); } };
  DH.create({ dataDir: dir, now: () => local(2026, 11, 10), fsMod: spy }).tick();
  assert.deepEqual(seen, ['disk-history.json.' + process.pid + '.tmp']);
});

// ---------------------------------------------------------------------------------------------------------- diskLines
const R = (day, items, partial = false) => ({ day, at: day + 'T12:00:00.000Z', partial, items: Object.entries(items).map(([label, gb]) => ({ label, gb })) });

test('diskLines: "needs two days of readings" with none, one, or two readings on the same day', () => {
  for (const rows of [[], [R('2026-11-10', { a: 1 })], [R('2026-11-10', { a: 1 }), R('2026-11-10', { a: 2 })]]) {
    assert.deepEqual(DH.diskLines(rows), { lines: [], note: 'needs two days of readings' });
  }
  assert.deepEqual(DH.diskLines(null), { lines: [], note: 'needs two days of readings' });
});

test('diskLines: a partial row never produces a delta', () => {
  const both = DH.diskLines([R('2026-11-03', { a: 1 }, true), R('2026-11-10', { a: 9 }, true)]);
  assert.deepEqual(both.lines, []);
  assert.match(both.note, /partial/);
  assert.match(both.note, /needs two days of readings/);
  const one = DH.diskLines([R('2026-11-03', { a: 1 }), R('2026-11-10', { a: 9 }, true)]);
  assert.deepEqual(one.lines, [], 'a complete older row and a partial newer one is still no comparison');
  assert.match(one.note, /needs two days of readings/);
});

test('diskLines: the newest complete reading against the complete one nearest 7 days earlier, folders in both only, biggest growth first', () => {
  const rows = [
    R('2026-11-01', { alpha: 10, beta: 5 }), R('2026-11-04', { alpha: 11, beta: 5, gamma: 2 }), R('2026-11-09', { alpha: 99 }, true),
    R('2026-11-11', { alpha: 14.5, beta: 4, gamma: 7, fresh: 3, small: 1.05 }),
  ];
  const r = DH.diskLines(rows);
  assert.equal(r.note, '');
  assert.deepEqual(r.lines, [{ label: 'gamma', deltaGB: 5, days: 7 }, { label: 'alpha', deltaGB: 3.5, days: 7 }]);
  assert.ok(!r.lines.some((l) => l.label === 'fresh'), 'a folder measured in only one reading is never compared');
  assert.ok(!r.lines.some((l) => l.label === 'beta'), 'a folder that shrank is not "what grew"');
});

test('diskLines: says so when nothing grew, caps at five lines, and uses the real gap in days', () => {
  const none = DH.diskLines([R('2026-11-08', { a: 5 }), R('2026-11-10', { a: 5 })]);
  assert.deepEqual(none, { lines: [], note: 'no folder grew by 0.1 GB or more in 2 days' });
  const many = {}, more = {};
  for (let i = 0; i < 8; i++) { many['f' + i] = 1; more['f' + i] = 2 + i; }
  const r = DH.diskLines([R('2026-11-09', many), R('2026-11-10', more)]);
  assert.equal(r.lines.length, 5);
  assert.deepEqual(r.lines.map((l) => l.days), [1, 1, 1, 1, 1]);
  assert.equal(r.lines[0].label, 'f7');
});

test('diskLines never returns a path, even from a hand-edited store', () => {
  const r = DH.diskLines([R('2026-11-03', { 'C:\\placeholder\\alpha': 1 }), R('2026-11-10', { 'C:\\placeholder\\alpha': 6 })]);
  assert.deepEqual(r.lines, [{ label: 'alpha', deltaGB: 5, days: 7 }]);
});

// ------------------------------------------------------------------------------------------------------------ readStoreFile
test('readStoreFile: absent, ok, corrupt (read-only mode leaves it where it is)', () => {
  const dir = tmp();
  const f = path.join(dir, 'disk-history.json');
  assert.deepEqual(DH.readStoreFile(fs, f), { rows: [], state: 'absent' });
  put(dir, 'disk-history.json', '{ nope');
  assert.deepEqual(DH.readStoreFile(fs, f), { rows: [], state: 'corrupt' });
  assert.ok(exists(dir, 'disk-history.json'), 'a reader never moves the file');
  put(dir, 'disk-history.json', { v: 1, rows: [R('2026-11-10', { a: 1 }), { day: 'bad' }] });
  const ok = DH.readStoreFile(fs, f);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.rows.length, 1);
});

// ------------------------------------------------------------------------------------------------------------------ init
test('init ticks soon after start, every 6 hours, and shortly after pc-health-disk.json changes (and ignores other files)', () => {
  const dir = tmp();
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10), [['alpha', 10]]));
  const timeouts = [], intervals = [], cleared = [];
  let listener = null, closed = 0;
  const timers = {
    setTimeout: (fn, ms) => { const h = { fn, ms }; timeouts.push(h); return h; }, clearTimeout: (h) => cleared.push(h),
    setInterval: (fn, ms) => { const h = { fn, ms }; intervals.push(h); return h; }, clearInterval: (h) => cleared.push(h),
  };
  const fsMod = { ...fs, watch: (d, o, cb) => { listener = cb; return { close: () => { closed++; }, on() {} }; } };
  const h = DH.init({ dataDir: dir, now: () => local(2026, 11, 10), fsMod, timers });
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].ms, DH.STARTUP_MS);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, DH.SIX_HOURS);
  assert.ok(!exists(dir, 'disk-history.json'), 'nothing is read or written before the startup timer fires');
  timeouts[0].fn();
  assert.equal(get(dir, 'disk-history.json').rows.length, 1);
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 10, 20), [['alpha', 15]]));
  listener('change', 'something-else.json');
  assert.equal(timeouts.length, 1, 'another file changing does nothing');
  listener('change', 'pc-health-disk.json');
  listener('change', 'pc-health-disk.json');
  assert.equal(timeouts.length, 3, 'a second change re-arms the debounce');
  assert.equal(cleared.length, 1);
  assert.equal(timeouts[2].ms, DH.DEBOUNCE_MS);
  timeouts[2].fn();
  assert.equal(get(dir, 'disk-history.json').rows[0].items[0].gb, 15);
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 11), [['alpha', 16]]));
  intervals[0].fn();
  assert.equal(get(dir, 'disk-history.json').rows.length, 2);
  h.stop();
  assert.equal(closed, 1);
  put(dir, 'pc-health-disk.json', snap(iso(2026, 11, 12), [['alpha', 17]]));
  intervals[0].fn();
  assert.equal(get(dir, 'disk-history.json').rows.length, 2, 'stopped means stopped');
});

test('init survives a directory that cannot be watched', () => {
  const dir = tmp();
  const fsMod = { ...fs, watch: () => { throw new Error('no watch here'); } };
  const timers = { setTimeout: () => ({}), clearTimeout() {}, setInterval: () => ({}), clearInterval() {} };
  const h = DH.init({ dataDir: dir, fsMod, timers });
  assert.equal(typeof h.tick, 'function');
  assert.doesNotThrow(() => h.stop());
});
