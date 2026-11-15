// Memory card, pure half (dashboard/memory-card-core.mjs). Invented names only - the repo is public.
//   node --test dashboard/memory-card-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { KINDS, TABLE, LIMITS, SNAPSHOT_MAX, SNAPSHOT_NAME_RE, COULD_NOT_LOOK, classify, summarise, snapshotSummary, humanBytes, humanAge } from './memory-card-core.mjs';

const require = createRequire(import.meta.url);
const H = 3600e3, NOW = Date.parse('2026-11-14T12:00:00Z');

test('the kinds are the ten the card draws, in order, each with a label', () => {
  assert.deepEqual(KINDS.map((k) => k.id), ['scans', 'brief', 'money', 'cosmos', 'security', 'delivery', 'chat-index', 'logs', 'today-drift', 'other']);
  assert.ok(KINDS.every((k) => typeof k.label === 'string' && k.label.length > 2 && k.label.length <= 26), 'labels fit a block');
  assert.ok(Object.isFrozen(KINDS) && Object.isFrozen(TABLE) && Object.isFrozen(LIMITS));
  assert.deepEqual({ ...LIMITS }, { depth: 3, entries: 5000, ms: 2000 });
});

test('every generic top-level name in the table maps to its kind, case and separators aside', () => {
  let n = 0;
  for (const [kind, names] of Object.entries(TABLE)) {
    assert.ok(KINDS.some((k) => k.id === kind), kind + ' is a kind');
    for (const name of names) {
      assert.equal(classify(name), kind, name);
      assert.equal(classify(name.toUpperCase()), kind, name + ' upper-cased');
      assert.equal(classify('./' + name + '/inner/deep.bin'), kind, name + ' as a folder');
      assert.equal(classify(name + '\\inner\\deep.bin'), kind, name + ' with backslashes');
      n += 1;
    }
  }
  assert.ok(n >= 30, 'the table has its names');
  const all = Object.values(TABLE).flat();
  assert.equal(new Set(all).size, all.length, 'no name is in two kinds');
});

test('anything unmatched is other: unknown names, dotfiles, empty input, parent paths, prototype names', () => {
  for (const rel of ['mystery.bin', '.ui-version', '.refresh.lock', 'social', 'client-zeta', '', '   ', null, undefined, '..', '../latest.json', '/', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(classify(rel), 'other', JSON.stringify(rel));
  }
});

test('a top-level .log file is a log, whatever its name; only the TOP-level segment decides', () => {
  assert.equal(classify('pipeline-run.LOG'), 'logs');
  assert.equal(classify('alpha-site/notes.log'), 'other', 'a log inside an unknown folder stays with that folder');
  assert.equal(classify('cosmos/library.json'), 'cosmos');
  assert.equal(classify('latest.json/cosmos'), 'scans');
});

test('summarise: sizes, counts and the newest write are exact, per kind, in KINDS order', () => {
  const slots = summarise([
    { rel: 'latest.json', size: 1000, mtimeMs: NOW - 5 * H },
    { rel: 'shards.json', size: 24, mtimeMs: NOW - 2 * H },
    { rel: 'cosmos/library.json', size: 4096, mtimeMs: NOW - 9 * H },
    { rel: 'cosmos/thumbs/a.bin', size: 1, mtimeMs: NOW - 30e3 },
    { kind: 'logs', size: 7, mtimeMs: NOW - 70e3 },
    { rel: 'odd.bin', size: 0, mtimeMs: NOW - 3 * H },
  ]);
  assert.deepEqual(slots.map((s) => s.kind), KINDS.map((k) => k.id));
  const by = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.deepEqual(by.scans, { kind: 'scans', label: 'Scans and history', files: 2, bytes: 1024, newestMs: NOW - 2 * H, partial: false });
  assert.deepEqual(by.cosmos, { kind: 'cosmos', label: 'Cosmos library', files: 2, bytes: 4097, newestMs: NOW - 30e3, partial: false });
  assert.deepEqual(by.logs, { kind: 'logs', label: 'Logs', files: 1, bytes: 7, newestMs: NOW - 70e3, partial: false });
  assert.deepEqual(by.other, { kind: 'other', label: 'Other', files: 1, bytes: 0, newestMs: NOW - 3 * H, partial: false });
  assert.deepEqual(by.brief, { kind: 'brief', label: 'Brief', files: 0, bytes: 0, newestMs: null, partial: false }, 'a kind with nothing is an honest zero (it WAS looked at)');
});

test('summarise: a cut-off slot is "at least" (partial); an unreadable one is null all through; neither is ever a zero', () => {
  const slots = summarise([
    { rel: 'cosmos/a.bin', size: 10, mtimeMs: 5 },
    { rel: 'cosmos', partial: true },
    { rel: 'security/x', unreadable: true },
    { rel: 'security/y', size: 99, mtimeMs: 9 },
    { kind: 'money', partial: true },
  ]);
  const by = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.deepEqual([by.cosmos.files, by.cosmos.bytes, by.cosmos.newestMs, by.cosmos.partial], [1, 10, 5, true]);
  assert.deepEqual([by.security.files, by.security.bytes, by.security.newestMs, by.security.partial], [null, null, null, false], 'one unreadable part voids the slot');
  assert.deepEqual([by.money.files, by.money.bytes, by.money.partial], [0, 0, true]);
});

test('summarise: malformed entries are skipped or void their slot, never counted as something', () => {
  const slots = summarise([null, 7, 'x', {}, { rel: 'latest.json', size: -1, mtimeMs: 1 }, { rel: 'brief.json', size: 5 }, { rel: 'money/a', size: NaN, mtimeMs: 1 }, { kind: 'nonsense', size: 3, mtimeMs: 3 }]);
  const by = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.equal(by.scans.files, null);
  assert.equal(by.brief.files, null);
  assert.equal(by.money.files, null);
  assert.equal(by.other.files, null, 'an unknown kind falls back to classify(rel) = other, where the empty entry has no size: that slot cannot answer');
  assert.deepEqual(summarise(undefined).map((s) => s.files), Array(10).fill(0));
});

test('snapshotSummary: only hub-YYYY-MM-DD.sqlite names count; none is 0 kept and no newest', () => {
  assert.deepEqual(snapshotSummary([]), { newestMs: null, kept: 0 });
  assert.deepEqual(snapshotSummary(undefined), { newestMs: null, kept: 0 });
  const r = snapshotSummary([
    { name: 'hub-2026-11-12.sqlite', mtimeMs: 100 }, { name: 'hub-2026-11-13.sqlite', mtimeMs: 300 }, { name: 'hub-2026-11-14.sqlite', mtimeMs: 200 },
    { name: 'notes.txt', mtimeMs: 999 }, { name: 'hub-2026-11-14.sqlite-wal', mtimeMs: 999 }, { name: 'hub-26-1-1.sqlite', mtimeMs: 999 }, null,
  ]);
  assert.deepEqual(r, { newestMs: 300, kept: 3 });
});

test('the snapshot name rule and the keep count match the real snapshot code', async () => {
  const snap = await import('./claude-hub/snapshot.mjs');
  assert.equal(SNAPSHOT_NAME_RE.source, snap.NAME_RE.source);
  assert.equal(SNAPSHOT_MAX, snap.KEEP_DEFAULT);
  assert.equal(SNAPSHOT_MAX, require('./hub-snapshot.js').KEEP);
});

test('humanBytes: exact words at the edges, one decimal under ten, none above, a bad size says it could not look', () => {
  const cases = [[0, '0 B'], [1, '1 B'], [1023, '1023 B'], [1024, '1 KB'], [1536, '1.5 KB'], [10 * 1024, '10 KB'], [12400000, '12 MB'], [9800, '9.6 KB'],
    [1048576, '1 MB'], [5100000000, '4.7 GB'], [1024 ** 3, '1 GB'], [1024 ** 4, '1 TB'], [1024 ** 5, '1024 TB'], [1048575, '1 MB']];
  for (const [n, want] of cases) assert.equal(humanBytes(n), want, String(n));
  for (const bad of [null, undefined, -1, NaN, Infinity, '12', {}]) assert.equal(humanBytes(bad), COULD_NOT_LOOK, String(bad));
});

test('humanAge: just now, minutes, hours, days; a clock ahead reads just now; no time reads unknown', () => {
  const cases = [[0, 'just now'], [59e3, 'just now'], [60e3, '1 min ago'], [20 * 60e3, '20 min ago'], [59 * 60e3 + 59e3, '59 min ago'], [3600e3, '1 h ago'], [3 * H, '3 h ago'],
    [90 * 60e3, '1 h ago'], [23 * H + 59 * 60e3, '23 h ago'], [24 * H, '1 d ago'], [26 * H, '1 d ago'], [10 * 24 * H, '10 d ago'], [-5 * H, 'just now']];
  for (const [ago, want] of cases) assert.equal(humanAge(NOW - ago, NOW), want, String(ago));
  for (const bad of [null, undefined, NaN, -1]) assert.equal(humanAge(bad, NOW), 'unknown');
  assert.equal(humanAge(NOW, null), 'unknown');
});

test('the renderer carries the same two words: vals/memory-card.js agrees on a table of sizes and ages', async () => {
  const v = await import('../dashboard-v5/src/vals/memory-card.js');
  for (const n of [0, 7, 1023, 1024, 1500, 9999, 10240, 12400000, 1048575, 5100000000, 1024 ** 4]) assert.equal(v.humanBytes(n), humanBytes(n), String(n));
  for (const ago of [0, 59e3, 60e3, 3 * H, 90 * 60e3, 24 * H, 26 * H, 400 * 24 * H, -H]) assert.equal(v.humanAge(NOW - ago, NOW), humanAge(NOW - ago, NOW), String(ago));
  assert.equal(v.humanBytes(null), humanBytes(null));
  assert.equal(v.humanAge(null, NOW), humanAge(null, NOW));
});

test('the module is pure: no fs, no network, no process, no clock', () => {
  const src = fs.readFileSync(new URL('./memory-card-core.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const re of [/\bimport\b/, /\brequire\(/, /\bprocess\b/, /Date\.now|new Date\(/, /\bfetch\(/, /\bfs\b/]) assert.ok(!re.test(src), 'source mentions ' + re);
});
