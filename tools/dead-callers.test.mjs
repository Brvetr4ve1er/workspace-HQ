// node --test tools/dead-callers.test.mjs
// A temp tree with INVENTED symbols (public repo): nothing here names a real project, file or method of the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyLine, isTestFile, scan, verdicts, formatReport, run, ROOTS, USAGE } from './dead-callers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'dead-callers.mjs');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-callers-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

const FILES = {
  'dashboard/store-a.mjs': [
    'export function build() {',
    '  return {',
    '    oldWidgetPool({ limit = 5 } = {}) {',
    '      return [];',
    '    },',
    '    oldWidgetStats: () => [],',
    '    liveWidget(x) {',
    '      return x;',
    '    },',
    '  };',
    '}',
  ].join('\n'),
  'dashboard/store-a.test.mjs': 'import { build } from "./store-a.mjs";\nbuild().oldWidgetPool();\nbuild().oldWidgetStats();\nbuild().liveWidget(1);\n',
  'dashboard/use-b.js': 'const s = require("./store-a.mjs");\nmodule.exports = (x) => s.build().liveWidget(x);\n',
  'dashboard-v5/src/view.mjs': '// oldWidgetPool used to feed this view\nexport const label = "n";\n',
  'tools/helper.mjs': 'export const oldWidgetPoolNow = 1;\nexport function neverCalled() { return 1; }\n',
  'node_modules/dep/index.js': 'liveWidget(1); deepSecretSymbol();\n',
  'data/not-scanned.js': 'liveWidget(2);\n',
};

test('a symbol called only from a .test file is dead, one called from source is live', () => {
  const root = tree(FILES);
  const r = scan({ root, symbols: ['oldWidgetPool', 'oldWidgetStats', 'liveWidget'] });
  const v = verdicts(r);
  assert.equal(v.oldWidgetPool, 'dead');
  assert.equal(v.oldWidgetStats, 'dead');
  assert.equal(v.liveWidget, 'live');
  assert.equal(r.symbols.oldWidgetPool.tests, 1, 'the test reference is counted');
  assert.deepEqual(r.symbols.oldWidgetPool.hits.map((h) => [h.file, h.line, h.kind]), [['dashboard/store-a.mjs', 3, 'definition'], ['dashboard-v5/src/view.mjs', 1, 'comment']]);
  const calls = r.symbols.liveWidget.hits.filter((h) => h.kind === 'call');
  assert.deepEqual(calls.map((h) => h.file), ['dashboard/use-b.js']);
});

test('node_modules and folders outside the five roots are not scanned, and a whole-identifier match only', () => {
  const root = tree(FILES);
  const r = scan({ root, symbols: ['liveWidget', 'deepSecretSymbol', 'oldWidgetPool'] });
  assert.equal(r.symbols.deepSecretSymbol.hits.length, 0);
  assert.ok(!r.symbols.liveWidget.hits.some((h) => /node_modules|^data\//.test(h.file)));
  assert.ok(!r.symbols.oldWidgetPool.hits.some((h) => h.file === 'tools/helper.mjs'), 'oldWidgetPoolNow is another name');
  assert.deepEqual([...ROOTS], ['dashboard', 'dashboard-v5', 'mcp', 'browser-bridge', 'tools']);
});

test('a symbol found nowhere is reported as absent, and the report says so', () => {
  const root = tree(FILES);
  const r = scan({ root, symbols: ['typoedName'] });
  assert.equal(verdicts(r).typoedName, 'absent');
  assert.match(formatReport(r), /typoedName: NOT FOUND anywhere/);
});

test('classifyLine: the definition shapes, comments, and a doubtful line stays a call', () => {
  const c = (line) => classifyLine(line, 'thing');
  assert.equal(c('    thing({ a = 1 } = {}) {'), 'definition');
  assert.equal(c('  thing: () => x,'), 'definition');
  assert.equal(c('  thing: async (a) => x,'), 'definition');
  assert.equal(c('  thing: function () {'), 'definition');
  assert.equal(c('function thing(a) {'), 'definition');
  assert.equal(c('export async function thing() {'), 'definition');
  assert.equal(c('const thing = 4;'), 'definition');
  assert.equal(c('  thing: q("SELECT 1"),'), 'definition');
  assert.equal(c('  async thing(x) {'), 'definition');
  assert.equal(c('// thing is gone'), 'comment');
  assert.equal(c('  * thing: a doc line'), 'comment');
  assert.equal(c('run(); // thing again'), 'comment');
  assert.equal(c('thing(1);'), 'call', 'a statement call is not a definition');
  assert.equal(c('  thing(function () {'), 'call', 'a call that opens a callback is not a definition');
  assert.equal(c('x.thing(1) {'), 'call');
  assert.equal(c('module.exports = { thing };'), 'call', 'an export counts as a caller');
  assert.equal(c('fetch("http://x.example/a"); thing();'), 'call', 'a url is not a comment');
  assert.equal(c('const other = 1;'), null);
  assert.equal(c('thingy()'), null);
  assert.equal(c('$thing()'), null);
});

test('isTestFile', () => {
  for (const n of ['a.test.mjs', 'a.test.js', 'a.test.cjs']) assert.equal(isTestFile(n), true, n);
  for (const n of ['a.mjs', 'test.mjs', 'a.tests.mjs', 'a.test.json', 'atest.js']) assert.equal(isTestFile(n), false, n);
});

test('exit codes: 0 when every symbol is dead, 1 when one has a caller, 2 on bad usage', () => {
  const root = tree(FILES);
  const dead = run({ argv: ['oldWidgetPool', 'oldWidgetStats'], root });
  assert.equal(dead.code, 0);
  assert.match(dead.text, /oldWidgetPool: DEAD/);
  assert.match(dead.text, /2 of 2 symbols with no non-test caller\./);
  const mixed = run({ argv: ['oldWidgetPool', 'liveWidget'], root });
  assert.equal(mixed.code, 1);
  assert.match(mixed.text, /liveWidget: LIVE, 1 non-test caller/);
  const absent = run({ argv: ['typoedName'], root });
  assert.equal(absent.code, 0);
  assert.equal(run({ argv: [], root }).code, 2);
  assert.equal(run({ argv: ['--nope', 'x'], root }).code, 2);
  assert.equal(run({ argv: ['not a symbol'], root }).code, 2);
  assert.equal(run({ argv: ['1abc'], root }).code, 2);
  assert.equal(run({ argv: ['x', '--root'], root }).code, 2);
  assert.equal(run({ argv: Array.from({ length: 51 }, (_, i) => 's' + i), root }).code, 2);
  assert.equal(run({ argv: [], root }).text, USAGE + '\n');
});

test('--json prints the verdicts, and --root points at another tree', () => {
  const root = tree(FILES);
  const j = run({ argv: ['--json', 'liveWidget', 'oldWidgetPool', '--root', root], root: '/nonexistent' });
  assert.equal(j.code, 1);
  const parsed = JSON.parse(j.text);
  assert.deepEqual(parsed.verdicts, { liveWidget: 'live', oldWidgetPool: 'dead' });
  assert.ok(parsed.files >= 4);
});

test('it reads only: the tree is byte-identical afterwards, and a repeated symbol is scanned once', () => {
  const root = tree(FILES);
  const snap = () => fs.readdirSync(path.join(root, 'dashboard')).map((n) => n + fs.readFileSync(path.join(root, 'dashboard', n), 'utf8'));
  const before = snap();
  const r = run({ argv: ['liveWidget', 'liveWidget'], root });
  assert.equal(r.text.match(/^liveWidget: LIVE/gm).length, 1);
  assert.deepEqual(snap(), before);
});

test('an unreadable root is handled: no throw, nothing found', () => {
  const r = run({ argv: ['anything'], root: path.join(os.tmpdir(), 'dead-callers-no-such-folder-' + process.pid) });
  assert.equal(r.code, 0);
  assert.match(r.text, /anything: NOT FOUND anywhere/);
});

test('the CLI exits with those codes and prints to the right stream', () => {
  const root = tree(FILES);
  const ok = spawnSync(process.execPath, [CLI, 'oldWidgetPool', '--root', root], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /DEAD/);
  const live = spawnSync(process.execPath, [CLI, 'liveWidget', '--root', root], { encoding: 'utf8' });
  assert.equal(live.status, 1);
  const bad = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: node tools\/dead-callers\.mjs/);
  assert.equal(bad.stdout, '');
});
