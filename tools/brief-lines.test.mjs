import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'brief-lines.mjs');
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();

const FAKE_NAME = 'Example Placeholder Project';
const FAKE_PATH = 'C:\\Example\\placeholder\\repo';
const FAKE_AMOUNT = '$1234.56';
const item = (n, rule, severity, extra = {}) => ({
  key: 'key-' + rule + ':' + FAKE_NAME + ':' + n, rule, severity, count: 0,
  text: FAKE_NAME + ' at ' + FAKE_PATH + ' owes ' + FAKE_AMOUNT, why: FAKE_PATH,
  action: { kind: 'go', tab: 'projects', sub: 'repos' }, ...extra,
});
const brief = (over = {}) => ({
  generatedAt: ago(2),
  items: [item(1, 'ci-red', 'high'), item(2, 'quest-red', 'med', { count: 2 }), item(3, 'review-waiting', 'low')],
  overflow: [], more: 0, ...over,
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'brief-lines-')); }
function run(dir) {
  const r = spawnSync(process.execPath, [CLI, '--data', dir], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function withBrief(obj, raw) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'brief.json'), raw !== undefined ? raw : JSON.stringify(obj));
  return dir;
}
const lines = (out) => out.split('\n').filter(Boolean);

test('items print as the projection wording and nothing raw leaks', () => {
  const dir = withBrief(brief({ overflow: [item(4, 'ci-red', 'med')], more: 1 }));
  const r = run(dir);
  assert.equal(r.code, 0);
  const l = lines(r.out);
  assert.equal(l.length, 4);
  assert.equal(l[0], 'urgent: CI is failing on a repo');
  assert.equal(l[1], 'soon: 3 critical quests are open');
  assert.equal(l[2], 'when you can: A pull request is waiting on you');
  assert.match(l[3], /^\+1 more/);
  for (const bad of [FAKE_NAME, 'placeholder', FAKE_PATH, '1234', 'key-', 'ci-red', 'quest-red', 'review-waiting', 'projects', 'repos/', 'http']) {
    assert.ok(!r.out.includes(bad), 'leaked ' + bad);
  }
  assert.ok(r.out.length < 600);
});

test('a fresh brief with 5 items prints 3 item lines and the overflow line with the right count', () => {
  const b = brief({
    items: [item(1, 'secrets', 'high'), item(2, 'ci-red', 'high'), item(3, 'unpushed', 'med')],
    overflow: [item(4, 'dirty', 'low'), item(5, 'reboot-pending', 'low')], more: 2,
  });
  const r = run(withBrief(b));
  const l = lines(r.out);
  assert.equal(l.length, 4);
  assert.ok(l[3].startsWith('+2 more'));
  assert.equal(r.code, 0);
});

test('more items than three in the file still print three', () => {
  const b = brief({ items: ['secrets', 'ci-red', 'unpushed', 'dirty', 'reboot-pending'].map((r, i) => item(i, r, 'med')) });
  assert.equal(lines(run(withBrief(b)).out).length, 3);
});

test('a valid empty brief says nothing needs you', () => {
  const r = run(withBrief(brief({ items: [] })));
  assert.equal(r.out, 'Brief: nothing needs you\n');
  assert.equal(r.code, 0);
});

test('missing file, invalid JSON, an array and an empty object print the one not-available line and exit 0', () => {
  const want = 'Brief: not available yet (WorkspaceHQ has not written one)\n';
  const missing = run(tmp());
  assert.equal(missing.out, want); assert.equal(missing.code, 0);
  for (const raw of ['{ not json', '[]', '{}', '', 'null', '"text"', '42']) {
    const r = run(withBrief(null, raw));
    assert.equal(r.out, want, 'raw: ' + raw); assert.equal(r.code, 0);
  }
});

test('a brief 45 min old prints one out-of-date line and no items, even with high-severity ones', () => {
  const r = run(withBrief(brief({ generatedAt: ago(45) })));
  assert.equal(r.out, 'Brief: out of date, last updated 45 min ago (the app may be closed)\n');
  assert.equal(r.code, 0);
});

test('large ages read in hours and days; no generatedAt reads time unknown', () => {
  assert.match(run(withBrief(brief({ generatedAt: ago(300) }))).out, /last updated 5 h ago/);
  assert.match(run(withBrief(brief({ generatedAt: ago(60 * 24 * 3) }))).out, /last updated 3 days ago/);
  const r = run(withBrief(brief({ generatedAt: undefined })));
  assert.equal(r.out, 'Brief: out of date, last updated time unknown (the app may be closed)\n');
  assert.equal(lines(r.out).length, 1);
});

test('a nonexistent or unusable --data dir exits 0 and creates nothing', () => {
  const base = tmp();
  const ghost = path.join(base, 'no', 'such');
  const before = fs.readdirSync(base);
  const r = run(ghost);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'Brief: not available yet (WorkspaceHQ has not written one)\n');
  assert.deepEqual(fs.readdirSync(base), before);
  const dirIsFile = path.join(base, 'afile');
  fs.writeFileSync(dirIsFile, 'x');
  assert.equal(run(dirIsFile).code, 0);
});

test('the tool never creates or modifies a file in the data dir', () => {
  const dir = withBrief(brief());
  const stat = () => fs.readdirSync(dir).map((f) => f + ':' + fs.statSync(path.join(dir, f)).mtimeMs + ':' + fs.statSync(path.join(dir, f)).size);
  const before = stat();
  run(dir);
  assert.deepEqual(stat(), before);
});

test('unknown rule ids fall back to fixed wording, never the raw text', () => {
  const r = run(withBrief(brief({ items: [item(1, 'made-up-rule-zz', 'high')] })));
  assert.equal(r.out, 'urgent: Something needs you\n');
  assert.ok(!r.out.includes('made-up'));
});

test('the 600-character cap and a hostile file', async () => {
  const mod = await import('./brief-lines.mjs');
  assert.ok(mod.clip(['x'.repeat(2000)]).length <= 601);
  const hostile = { generatedAt: ago(1), items: 'nope', overflow: 5, more: 'many' };
  const r = run(withBrief(hostile));
  assert.ok(r.out.length < 600);
  assert.equal(r.code, 0);
});

test('it reads only brief.json and the source never writes, spawns or fetches', () => {
  const dir = withBrief(brief());
  fs.writeFileSync(path.join(dir, 'brief-state.json'), '{"secret":"do not print"}');
  assert.ok(!run(dir).out.includes('secret'));
  const src = fs.readFileSync(CLI, 'utf8');
  assert.ok(!/writeFile|appendFile|mkdir|child_process|fetch\(|node:http|node:net/.test(src));
});
