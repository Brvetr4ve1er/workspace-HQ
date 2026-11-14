import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  parseDays, collect, buildReport, formatReport, run, surfaceList, actionList,
  LINE_NO_DIR, LINE_NO_MARKS, LINE_BAD_DAYS,
} from './use-report.mjs';

const require = createRequire(import.meta.url);
const useLog = require('../dashboard/use-log.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'use-report.mjs');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date(2026, 10, 14, 12, 0, 0); // 2026-11-14 local, a fixed clock for the pure tests
const daysAgo = (n, base = NOW) => ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() - n));

const FAKE_NAME = 'Example Placeholder Project';
const FAKE_PATH = 'C:\\Example\\placeholder\\repo';

const use = (surface, action) => JSON.stringify({ t: '2026-11-10T10:00:00.000+00:00', event: 'use', surface, action });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'use-report-'));
function day(dir, date, lines) {
  fs.writeFileSync(path.join(dir, `app-${date}.log`), lines.join('\n') + '\n');
}
const bytes = (dir) => fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]);

test('parseDays: default, lists, and refusal of anything else', () => {
  assert.deepEqual(parseDays(undefined), [7, 14]);
  assert.deepEqual(parseDays('14,7,7'), [7, 14]);
  assert.deepEqual(parseDays('3'), [3]);
  for (const bad of ['', 'x', '0', '7;14', '-1', '7,', '1000', '1,2,3,4,5', '7 14']) assert.equal(parseDays(bad), null, bad);
  assert.equal(parseDays(7), null);
});

test('counts opens and acts per surface for 7 and 14 days; a file outside the window is ignored', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [use('brief-panel', 'open'), use('brief-panel', 'act'), use('brief-panel', 'act'), use('cosmos', 'open')]);
  day(dir, daysAgo(6), [use('brief-panel', 'act')]);        // inside 7 (today and 6 days before)
  day(dir, daysAgo(7), [use('cosmos', 'open'), use('cosmos', 'resume')]); // outside 7, inside 14
  day(dir, daysAgo(13), [use('security', 'open')]);        // last day of 14
  day(dir, daysAgo(14), [use('security', 'open'), use('security', 'act')]); // outside both
  const rep = buildReport(collect({ dir, now: () => NOW }), [7, 14]);
  const [w7, w14] = rep.windows;
  assert.deepEqual(w7.rows, [
    { surface: 'brief-panel', open: 1, act: 3, other: 0 },
    { surface: 'cosmos', open: 1, act: 0, other: 0 },
  ]);
  assert.equal(w7.marks, 5);
  assert.equal(w7.from, daysAgo(6));
  assert.deepEqual(w14.rows, [
    { surface: 'brief-panel', open: 1, act: 3, other: 0 },
    { surface: 'cosmos', open: 2, act: 0, other: 1 },
    { surface: 'security', open: 1, act: 0, other: 0 },
  ]);
  assert.equal(w14.marks, 8);
  assert.equal(w14.from, daysAgo(13));
});

test('garbage lines, other events, unknown surfaces and unknown actions are ignored', () => {
  const dir = tmp();
  day(dir, daysAgo(1), [
    'not json at all',
    '{"event":"use","surface":"cosmos"',                          // truncated
    JSON.stringify({ event: 'use', surface: FAKE_NAME, action: 'open' }),
    JSON.stringify({ event: 'use', surface: 'cosmos', action: 'delete-everything' }),
    JSON.stringify({ event: 'use', surface: 'cosmos' }),           // no action: not a mark
    JSON.stringify({ event: 'click', surface: 'cosmos', action: 'open' }),
    JSON.stringify({ event: 'use', surface: 7, action: 'open' }),
    JSON.stringify(['use', 'cosmos', 'open']),
    JSON.stringify({ event: 'use', surface: 'cosmos', action: 'open', path: FAKE_PATH, text: FAKE_NAME }),
    use('cosmos', 'act'),
  ]);
  const rep = buildReport(collect({ dir, now: () => NOW }), [7]);
  assert.deepEqual(rep.windows[0].rows, [{ surface: 'cosmos', open: 1, act: 1, other: 0 }]);
  assert.equal(rep.totalMarks, 2);
});

test('file names that are not day logs, and future-dated files, are not read', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.txt'), use('cosmos', 'open') + '\n');
  fs.writeFileSync(path.join(dir, 'app-2026-11-13.log.bak'), use('cosmos', 'open') + '\n');
  day(dir, daysAgo(-3), [use('cosmos', 'open')]);
  day(dir, daysAgo(2), [use('security', 'open')]);
  const col = collect({ dir, now: () => NOW });
  assert.equal(col.files.length, 1);
  assert.deepEqual(buildReport(col, [14]).windows[0].rows, [{ surface: 'security', open: 1, act: 0, other: 0 }]);
});

test('never-used list is exactly the allowlist minus the surfaces seen in that window', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [use('brief-panel', 'open')]);
  day(dir, daysAgo(10), [use('cosmos', 'act')]);
  const rep = buildReport(collect({ dir, now: () => NOW }), [7, 14]);
  const all = [...useLog.SURFACES];
  assert.deepEqual(rep.windows[0].never, all.filter((s) => s !== 'brief-panel'));
  assert.deepEqual(rep.windows[1].never, all.filter((s) => s !== 'brief-panel' && s !== 'cosmos'));
  assert.deepEqual(surfaceList(), all);
  assert.deepEqual(actionList(), [...useLog.ACTIONS]);
});

test('first use is the earliest retained day file per surface and action; the text says how many files were kept', () => {
  const dir = tmp();
  day(dir, daysAgo(20), [use('cosmos', 'open')]);                        // outside both windows, still the first day seen
  day(dir, daysAgo(9), [use('cosmos', 'act'), use('cosmos', 'open')]);
  day(dir, daysAgo(2), [use('brief-panel', 'open'), use('cosmos', 'act')]);
  day(dir, daysAgo(1), [use('brief-panel', 'act'), use('brief-panel', 'resume')]);
  const rep = buildReport(collect({ dir, now: () => NOW }), [7, 14]);
  assert.deepEqual(rep.first, [
    { surface: 'brief-panel', open: daysAgo(2), act: daysAgo(1) },
    { surface: 'cosmos', open: daysAgo(20), act: daysAgo(9) },
  ]);
  assert.deepEqual(rep.retained, { files: 4, from: daysAgo(20), to: daysAgo(1) });
  const text = formatReport(rep);
  assert.match(text, /Day logs retained: 4 \(2026-10-25 to 2026-11-13\)/);
  assert.match(text, /not first ever/);
  assert.match(text, /brief-panel\s+open 2026-11-12\s+act 2026-11-13/);
  assert.match(text, /cosmos\s+open 2026-10-25\s+act 2026-11-05/);
});

test('a surface that was only opened prints a dash for its first act', () => {
  const dir = tmp();
  day(dir, daysAgo(1), [use('security', 'open')]);
  const text = formatReport(buildReport(collect({ dir, now: () => NOW }), [7]));
  assert.match(text, /security\s+open 2026-11-13\s+act -/);
});

test('output holds only allowlisted surface ids, action words, numbers and dates (never names, paths or text)', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [
    use('brief-panel', 'open'), use('brief-panel', 'act'),
    JSON.stringify({ event: 'use', surface: FAKE_NAME, action: 'open', path: FAKE_PATH }),
    JSON.stringify({ event: 'use', surface: 'cosmos', action: 'open', name: FAKE_NAME, path: FAKE_PATH, text: 'secret words' }),
  ]);
  const text = formatReport(buildReport(collect({ dir, now: () => NOW }), [7, 14]));
  assert.ok(!text.includes(FAKE_NAME) && !text.includes('Example') && !text.includes(FAKE_PATH) && !text.includes('secret'));
  const fixed = new Set(['WorkspaceHQ', 'use', 'report', 'counts', 'only', 'Day', 'logs', 'retained', 'to', 'First', 'below', 'means', 'first', 'in', 'these',
    'files', 'not', 'ever', 'Last', 'day', 'days', 'mark', 'marks', 'surface', 'open', 'act', 'other', 'never', 'seen', 'none', 'no', 'this', 'window',
    'the', 'retained', 'Use', 'day', 'files']);
  const ids = new Set(surfaceList());
  for (const word of text.split(/[\s(),.":]+/).filter(Boolean)) {
    const ok = ids.has(word) || fixed.has(word) || /^\d+$/.test(word) || /^\d{4}-\d{2}-\d{2}$/.test(word) || word === '-' || word === ':';
    assert.ok(ok, `unexpected word in report: ${word}`);
  }
});

test('the report never writes: every day file is byte-for-byte unchanged and no file appears', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [use('brief-panel', 'open'), use('cosmos', 'act')]);
  day(dir, daysAgo(3), [use('security', 'open'), 'garbage']);
  const before = bytes(dir);
  run({ argv: ['--dir', dir], now: () => NOW });
  assert.deepEqual(bytes(dir), before);
});

test('an empty or missing log folder prints one honest line', () => {
  const dir = tmp();
  assert.equal(run({ argv: ['--dir', dir], now: () => NOW }), LINE_NO_DIR + '\n');
  assert.equal(run({ argv: ['--dir', path.join(dir, 'absent')], now: () => NOW }), LINE_NO_DIR + '\n');
  assert.equal(run({ argv: [], env: {}, appRoot: undefined, now: () => NOW }), LINE_NO_DIR + '\n');
  assert.equal(LINE_NO_DIR.split('\n').length, 1);
});

test('day files with no use marks print one honest line that says how many files were seen', () => {
  const dir = tmp();
  day(dir, daysAgo(1), [JSON.stringify({ event: 'start' }), 'plain text']);
  day(dir, daysAgo(2), ['']);
  assert.equal(run({ argv: ['--dir', dir], now: () => NOW }), LINE_NO_MARKS(2) + '\n');
  assert.equal(LINE_NO_MARKS(1), 'Use report: 1 day log found, but no use marks in them yet (nothing to count).');
});

test('a bad --days says so in one line instead of guessing', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [use('cosmos', 'open')]);
  assert.equal(run({ argv: ['--dir', dir, '--days', 'abc'], now: () => NOW }), LINE_BAD_DAYS + '\n');
});

test('an injected fs that throws never throws out of run()', () => {
  const boom = new Proxy({}, { get() { return () => { throw new Error('disk gone'); }; } });
  assert.equal(run({ argv: ['--dir', 'x'], fs: boom, now: () => NOW }), LINE_NO_DIR + '\n');
  const flaky = {
    readdirSync: () => ['app-2026-11-13.log'],
    openSync: () => { throw new Error('locked'); },
  };
  assert.equal(run({ argv: ['--dir', 'x'], fs: flaky, now: () => NOW }), LINE_NO_DIR + '\n');
});

test('HQ_APP_LOG_DIR is honoured when absolute and ignored when relative (same rule as use-counts)', () => {
  const dir = tmp();
  day(dir, daysAgo(0), [use('cosmos', 'open')]);
  const via = run({ argv: ['--days', '7'], env: { HQ_APP_LOG_DIR: dir }, appRoot: path.join(dir, 'no-such-root'), now: () => NOW });
  assert.match(via, /cosmos\s+1\s+0\s+0/);
  const rel = run({ argv: [], env: { HQ_APP_LOG_DIR: 'relative/dir' }, appRoot: path.join(dir, 'no-such-root'), now: () => NOW });
  assert.equal(rel, LINE_NO_DIR + '\n');
});

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}
const today0 = () => ymd(new Date());
const agoReal = (n) => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)); };

test('cli: prints the report for a temp folder and exits 0', () => {
  const dir = tmp();
  day(dir, today0(), [use('brief-panel', 'open'), use('brief-panel', 'act')]);
  day(dir, agoReal(9), [use('cosmos', 'open')]);
  const r = cli(['--dir', dir]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /WorkspaceHQ use report \(counts only\)/);
  assert.match(r.stdout, /Last 7 days/);
  assert.match(r.stdout, /Last 14 days/);
  assert.match(r.stdout, /brief-panel\s+1\s+1\s+0/);
  assert.ok(!r.stdout.includes(dir));
});

test('cli: --days 3 prints one window; HQ_APP_LOG_DIR works; an empty folder and a bad --days still exit 0', () => {
  const dir = tmp();
  day(dir, today0(), [use('security', 'act')]);
  const one = cli(['--days', '3'], { HQ_APP_LOG_DIR: dir });
  assert.equal(one.status, 0);
  assert.match(one.stdout, /Last 3 days/);
  assert.ok(!/Last 7 days/.test(one.stdout));
  const empty = cli(['--dir', tmp()]);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, LINE_NO_DIR + '\n');
  const bad = cli(['--dir', dir, '--days', 'x']);
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, LINE_BAD_DAYS + '\n');
});
