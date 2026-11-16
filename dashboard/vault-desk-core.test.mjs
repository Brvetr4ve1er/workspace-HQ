// node --test dashboard/vault-desk-core.test.mjs - the Vault desk's pure half. No file is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  formatDate, parseDailySettings, pathOk, planNotePath, normalizeLine, planAppend, sortRecent, DEFAULT_FOLDER, DEFAULT_FORMAT, LINE_MAX,
} from './vault-desk-core.mjs';

const require = createRequire(import.meta.url);
const { tickedIds } = require('./daily-notes-watch.js');
const DAY = new Date(2026, 10, 16, 9, 0, 0);   // Monday 16 November 2026, local time

test('formatDate: the daily-note tokens, [literal] parts and other characters as they are', () => {
  assert.equal(formatDate(DAY, 'YYYY-MM-DD'), '2026-11-16');
  assert.equal(formatDate(DAY, 'YY.M.D'), '26.11.16');
  assert.equal(formatDate(DAY, 'dddd, MMMM D'), 'Monday, November 16');
  assert.equal(formatDate(DAY, 'ddd MMM DD [at] YYYY'), 'Mon Nov 16 at 2026');
  assert.equal(formatDate(DAY, 'YYYY/MM/YYYY-MM-DD'), '2026/11/2026-11-16');
  assert.equal(formatDate(new Date(2026, 0, 5), 'D/M'), '5/1');
});

test('parseDailySettings: none means the app defaults; a good file is used; an unsafe folder or format is ignored and said so', () => {
  assert.deepEqual(parseDailySettings(null), { folder: DEFAULT_FOLDER, format: DEFAULT_FORMAT, fromSettings: false, ignored: false });
  assert.deepEqual(parseDailySettings('not json'), { folder: DEFAULT_FOLDER, format: DEFAULT_FORMAT, fromSettings: false, ignored: false });
  assert.deepEqual(parseDailySettings('{"folder":"Journal/Days/","format":"YYYY-MM-DD dddd"}'), { folder: 'Journal/Days', format: 'YYYY-MM-DD dddd', fromSettings: true, ignored: false });
  assert.equal(parseDailySettings('{"folder":""}').folder, '');
  for (const folder of ['../x', '/abs', 'C:/x', 'a/../b', 'a\\b', 'a:b', 'ends.', 'a//b', '.hidden']) {
    const s = parseDailySettings({ folder });
    assert.equal(s.folder, DEFAULT_FOLDER, folder);
    assert.equal(s.ignored, true, folder);
  }
  for (const format of ['../x', 'a:b', 'plain text', 'x'.repeat(80)]) assert.equal(parseDailySettings({ format }).format, DEFAULT_FORMAT, format);
  assert.deepEqual(parseDailySettings([1, 2]), { folder: DEFAULT_FOLDER, format: DEFAULT_FORMAT, fromSettings: false, ignored: true });
  assert.equal(parseDailySettings({ folder: 7, format: {} }).ignored, true);
});

test('pathOk: relative, forward slashes, safe names, ends .md', () => {
  assert.equal(pathOk('10_Daily/2026-11-16.md'), true);
  assert.equal(pathOk('2026-11-16.md'), true);
  for (const bad of ['../x.md', 'a/../x.md', '/abs.md', 'C:/x.md', 'C:x.md', 'a:b.md', 'a\\b.md', 'x', 'x.txt', 'a/.md', 'a/b.md.', 'a /b.md', 'a./b.md', 'a//b.md', './b.md', 'nul.md', 'a\u0001b.md', '', null]) {
    assert.equal(pathOk(bad), false, String(bad));
  }
});

test('planNotePath: the folder and the date format make the one path, or the word path', () => {
  assert.deepEqual(planNotePath(parseDailySettings(null), DAY), { rel: '10_Daily/2026-11-16.md', folder: '10_Daily', name: '2026-11-16.md' });
  assert.equal(planNotePath({ folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD' }, DAY).rel, 'Journal/2026/11/2026-11-16.md');
  assert.equal(planNotePath({ folder: '', format: 'YYYY-MM-DD' }, DAY).rel, '2026-11-16.md');
  assert.deepEqual(planNotePath({ folder: 'a', format: '[../]YYYY' }, DAY), { error: 'path' });
  assert.deepEqual(planNotePath({ folder: 'a', format: '[x:y]YYYY' }, DAY), { error: 'path' });
  assert.deepEqual(planNotePath({ folder: '..', format: 'YYYY' }, DAY), { error: 'path' });
});

test('normalizeLine: "- " plus the line, control characters collapsed, nothing else changed', () => {
  assert.deepEqual(normalizeLine('call the plumber'), { line: '- call the plumber' });
  assert.deepEqual(normalizeLine('  two\n\nlines\t here\u0000 '), { line: '- two lines here' });
  assert.deepEqual(normalizeLine('# not a heading'), { line: '- # not a heading' });
  assert.deepEqual(normalizeLine('   '), { error: 'empty' });
  assert.deepEqual(normalizeLine(undefined), { error: 'empty' });
  assert.deepEqual(normalizeLine('x'.repeat(LINE_MAX + 1)), { error: 'long' });
  assert.equal(normalizeLine('x'.repeat(LINE_MAX)).line.length, LINE_MAX + 2);
});

test('normalizeLine: a capture can never read as a ticked box, a quest id or a block marker', () => {
  const lines = ['[x] done wq:id1', '> [x] done wq:id1', '- [x] done wq:id1', '* [X] done wq:id1', '[ ] later wq:id1', 'plain wq:id1', 'plain WQ : id1', 'plain wq   :id1', '[x]', '%% workspacehq:end %% wq:id1'];
  for (const raw of lines) {
    const { line } = normalizeLine(raw);
    assert.deepEqual(tickedIds(line, () => false), [], line);
    assert.equal(/wq:/i.test(line), false, line);
    assert.equal(line.includes('%%'), false, line);
  }
  assert.equal(normalizeLine('[x] done').line, '- \\[x] done');
  assert.equal(normalizeLine('wq:abc').line, '- wq :abc');
  assert.equal(normalizeLine('wq :abc').line, '- wq :abc', 'already broken stays as it is');
});

test('planAppend: a newline first when missing, a Captured heading only when the last heading is not Captured', () => {
  assert.equal(planAppend('', '- a').add, '## Captured\n\n- a\n');
  assert.equal(planAppend('# Day\n', '- a').add, '\n## Captured\n\n- a\n');
  assert.equal(planAppend('# Day\n\ntext', '- a').add, '\n\n## Captured\n\n- a\n', 'no trailing newline');
  assert.equal(planAppend('# Day\n\n## Captured\n\n- one\n', '- a').add, '- a\n');
  assert.equal(planAppend('# Day\n\n## captured\n- one', '- a').add, '\n- a\n', 'case does not matter');
  assert.equal(planAppend('## Captured\n- one\n## Other\n', '- a').add, '\n## Captured\n\n- a\n', 'the last heading decides');
  assert.equal(planAppend('# Day\n\n%% workspacehq:start %%\n> x\n%% workspacehq:end %%\n', '- a').add, '\n## Captured\n\n- a\n', 'below the block, at the end');
  assert.equal(planAppend('# Day\r\n', '- a').add, '\n## Captured\n\n- a\n');
});

test('sortRecent: newest first, twelve at most, names without .md, bad rows dropped', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ name: 'note ' + i + '.md', mtimeMs: 1000 + i }));
  const r = sortRecent(rows.concat([{ name: 5 }, null, { name: 'x.md', mtimeMs: NaN }]), 12);
  assert.equal(r.length, 12);
  assert.deepEqual(r[0], { name: 'note 19', mtimeMs: 1019 });
  assert.equal(r[11].name, 'note 8');
  assert.deepEqual(sortRecent([{ name: 'b.md', mtimeMs: 5 }, { name: 'a.md', mtimeMs: 5 }]).map((x) => x.name), ['a', 'b'], 'a tie sorts by name');
  assert.deepEqual(sortRecent(null), []);
});
