// node --test dashboard/use-counts.test.mjs — the use-counts reader (dashboard/use-counts.js): counts the owner's marks from the last
// 14 days of day logs into per-destination numbers. Invented day files in a temp folder; placeholder values only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV, SUBS } from '../dashboard-v5/src/live/catalog.mjs';
const require = createRequire(import.meta.url);
const U = require('./use-counts.js');
const useLog = require('./use-log.js');

const NOW = new Date(2026, 10, 13, 12, 0, 0);   // local noon, 2026-11-13
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-use-counts-'));
const use = (surface, action = 'open') => JSON.stringify({ ts: '2026-11-13T09:00:00.000+00:00', event: 'use', pid: 1, surface, action });
const day = (dir, name, lines) => fs.writeFileSync(path.join(dir, `app-${name}.log`), lines.join('\n') + '\n');
const make = (dir, extra = {}) => U.create({ logDir: dir, now: () => NOW.getTime(), ...extra });
const rep = (s, n) => Array.from({ length: n }, () => use(s));

test('only day files inside 14 days count: today and the 13 before; older and future files do not', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-cosmos')]);          // today
  day(d, '2026-10-31', [use('space-cosmos')]);          // 13 days back: the oldest day inside
  day(d, '2026-10-30', [use('space-cosmos'), use('space-cosmos')]);   // 14 days back: out
  day(d, '2026-11-14', [use('space-cosmos')]);          // future: out
  fs.writeFileSync(path.join(d, 'notes.log'), use('space-cosmos') + '\n');   // not a day file
  const r = make(d).read();
  assert.deepEqual(r, { marks: 2, byTarget: { 'cosmos/': 2 } });
});

test('non-use events, garbage lines and a use line with an unknown or non-string surface are ignored', () => {
  const d = mk();
  day(d, '2026-11-12', [
    JSON.stringify({ event: 'start', pid: 1, surface: 'space-money' }),
    'not json at all {"event":"use"}',
    '{"event":"use","surface":"space-money"',            // torn line
    use('space-nowhere'), use('constructor'), use('__proto__'),
    JSON.stringify({ event: 'use', surface: 7 }),
    JSON.stringify({ event: 'use' }),
    '',
    use('space-money'),
  ]);
  assert.deepEqual(make(d).read(), { marks: 1, byTarget: { 'money/': 1 } });
});

test('SURFACE_TARGETS: the seven older surfaces map to the documented sub-views, and only those', () => {
  assert.deepEqual({ ...U.SURFACE_TARGETS }, {
    'sessions-board': 'claude/sessions', 'clients-list': 'projects/clients',
    'machine-drift': 'system/machine', 'brief-history': 'history/timeline',
    'money-start': 'money/today', 'money-quick': 'money/today', 'money-access': 'money/today',
  });
  const d = mk();
  day(d, '2026-11-13', ['sessions-board', 'sessions-strip', 'clients-list', 'machine-drift', 'brief-history', 'money-start', 'money-quick', 'money-access'].map((s) => use(s)));
  assert.deepEqual(make(d).read(), {
    marks: 8,
    byTarget: { 'claude/sessions': 1, 'history/timeline': 1, 'money/today': 3, 'projects/clients': 1, 'system/machine': 1 },
  });
});

test('every SURFACE_TARGETS target and every space id exists in the app catalog (NAV / SUBS)', () => {
  const keys = new Set();
  for (const n of NAV) { keys.add(n.id + '/'); for (const [id] of SUBS[n.id] || []) keys.add(n.id + '/' + id); }
  for (const t of Object.values(U.SURFACE_TARGETS)) assert.ok(keys.has(t), t + ' is not in catalog.mjs');
  assert.deepEqual([...U.SPACE_IDS], NAV.map((n) => n.id));
});

test('the other known surfaces map to NO target: marks count, byTarget stays empty', () => {
  const d = mk();
  const none = ['sessions-strip', 'brief-panel', 'today-ribbon', 'brief-act', 'cosmos', 'security', 'security-refresh', 'delivery-card', 'delivery-check', 'quick-jump', 'reach', 'palette-money-line'];
  day(d, '2026-11-13', none.map((s) => use(s)));
  assert.deepEqual(make(d).read(), { marks: none.length, byTarget: {} });
});

test('one arrival writing space-cosmos AND cosmos counts cosmos/ once; a Home arrival counts once', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-cosmos'), use('cosmos'), use('space-home'), use('brief-panel'), use('today-ribbon')]);
  const r = make(d).read();
  assert.deepEqual(r.byTarget, { 'cosmos/': 1, 'home/': 1 });
  assert.equal(r.marks, 5);
});

test('every space id from the catalog counts at space level from its own space-<id> mark', () => {
  const d = mk();
  day(d, '2026-11-13', NAV.map((n) => use('space-' + n.id)));
  const r = make(d).read();
  assert.deepEqual(Object.keys(r.byTarget).sort(), NAV.map((n) => n.id + '/').sort());
  assert.ok(Object.values(r.byTarget).every((n) => n === 1));
});

test('the result has no key other than tab/sub strings, and only counts', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-money'), use('money-quick'), use('sessions-board'), JSON.stringify({ event: 'use', surface: 'space-tasks', note: 'free text', path: 'C:/x/y' })]);
  const r = make(d).read();
  assert.deepEqual(Object.keys(r).sort(), ['byTarget', 'marks']);
  const ok = new Set(['money/', 'money/today', 'claude/sessions', 'tasks/']);
  for (const [k, v] of Object.entries(r.byTarget)) { assert.ok(ok.has(k), k); assert.equal(typeof v, 'number'); }
  assert.ok(!/free text|C:/.test(JSON.stringify(r)));
});

test('a missing folder, an unreadable file and a folder that is a file answer zeros, never an error', () => {
  assert.deepEqual(make(path.join(os.tmpdir(), 'hq-use-counts-absent-' + process.pid)).read(), { marks: 0, byTarget: {} });
  const d = mk();
  day(d, '2026-11-13', [use('space-home')]);
  const badFs = { ...fs, openSync() { throw new Error('locked'); } };
  assert.deepEqual(make(d, { fs: badFs }).read(), { marks: 0, byTarget: {} });
  const throwingDir = { ...fs, readdirSync() { throw new Error('nope'); } };
  assert.deepEqual(make(d, { fs: throwingDir }).read(), { marks: 0, byTarget: {} });
  assert.deepEqual(make(path.join(d, 'app-2026-11-13.log')).read(), { marks: 0, byTarget: {} }, 'a file where a folder should be');
});

test('a 5 MiB day file is read from its tail only and still answers', () => {
  const d = mk();
  const filler = JSON.stringify({ ts: 'x', event: 'alive', pid: 1, pad: 'p'.repeat(400) });
  const lines = [use('space-life')];   // the head: beyond the bounded tail
  const target = 5 * 1024 * 1024;
  let bytes = 0;
  while (bytes < target) { lines.push(filler); bytes += filler.length + 1; }
  lines.push(use('space-money'), use('space-money'));
  day(d, '2026-11-13', lines);
  assert.ok(fs.statSync(path.join(d, 'app-2026-11-13.log')).size > U.MAX_READ);
  const r = make(d).read();
  assert.equal(r.byTarget['money/'], 2);
  assert.equal(r.byTarget['life/'], undefined);
});

test('the answer is cached 60 s on a fake clock, then read again', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-home')]);
  let t = NOW.getTime();
  const c = U.create({ logDir: d, now: () => t });
  assert.equal(c.read().byTarget['home/'], 1);
  fs.appendFileSync(path.join(d, 'app-2026-11-13.log'), use('space-home') + '\n');
  t += 59e3;
  assert.equal(c.read().byTarget['home/'], 1, 'inside 60 s: cached');
  t += 1e3;
  assert.equal(c.read().byTarget['home/'], 2, 'at 60 s: read again');
});

test('a caller changing the answer does not poison the cache', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-home')]);
  const c = make(d);
  const a = c.read();
  a.byTarget['home/'] = 99; a.marks = 99;
  assert.deepEqual(c.read(), { marks: 1, byTarget: { 'home/': 1 } });
});

test('the activation rule: the SUM of byTarget >= 10; quick-jump or reach marks alone never activate', () => {
  assert.equal(U.ACTIVE_MIN, 10);
  assert.equal(U.isActive({ marks: 9, byTarget: { 'money/': 9 } }), false);
  assert.equal(U.isActive({ marks: 10, byTarget: { 'money/': 4, 'automations/': 6 } }), true);
  assert.equal(U.isActive(null), false);
  assert.equal(U.isActive({}), false);
  const d = mk();
  day(d, '2026-11-13', [...rep('quick-jump', 6), ...rep('reach', 6), ...rep('brief-panel', 6)]);
  const r = make(d).read();
  assert.equal(r.marks, 18);
  assert.equal(U.isActive(r), false);
});

test('space marks count whether or not use-log.js lists them yet (the shared edit adds all eleven together)', () => {
  const missing = NAV.map((n) => 'space-' + n.id).filter((s) => !useLog.SURFACES.includes(s));
  if (missing.length) assert.equal(missing.length, NAV.length, 'use-log.js must gain all eleven space ids together, not some: ' + missing.join(','));
  const d = mk();
  day(d, '2026-11-13', [use('space-projects')]);
  assert.deepEqual(make(d).read().byTarget, { 'projects/': 1 });
});

test('the default folder follows app-log: HQ_APP_LOG_DIR when absolute', () => {
  const d = mk();
  day(d, '2026-11-13', [use('space-tasks')]);
  const c = U.create({ env: { HQ_APP_LOG_DIR: d }, now: () => NOW.getTime() });
  assert.deepEqual(c.read(), { marks: 1, byTarget: { 'tasks/': 1 } });
});
