// node --test dashboard/commit-guard.test.mjs — the .env commit guard.
// The defect it closes: plain `git status --porcelain` lists an untracked folder
// as `sub/`, so `sub/.env` slipped past the old check and `git add -A` committed
// it. The integration test builds that exact shape in a throwaway repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const guard = require('./commit-guard.js');

// ---------------------------------------------------------------- isEnvPath
const ENV_TABLE = [
  ['.env', true],
  ['.env.local', true],
  ['sub/.env', true],
  ['sub\\.env.production', true],          // Windows separators normalized
  ['prod.env', true],
  ['deep/nested/dir/.ENV', true],          // case-insensitive
  ['.env.example.local', true],            // a suffix after an allowed one is real again
  // Review regressions: copies of a .env carry the same secrets, and `git add -A`
  // stages them — every separator after `.env` counts, not only '.'.
  ['cfg/.env - Copy', true],               // Windows Explorer duplicate
  ['.env copy', true],                     // macOS Finder duplicate
  ['.env (1)', true],                      // browser download duplicate
  ['.env~', true],                         // editor backup
  ['.env-local', true],
  ['.env_prod', true],
  ['.env.', true],
  ['prod.env~', true],
  ['prod - Copy.env', true],
  ['.env-example', false],                 // template, dash/underscore separated
  ['.env_sample', false],
  ['foo/.env.EXAMPLE', false],
  ['.environment', false],                 // a letter after .env → a different name
  ['config.env.js', false],                // *.env never takes a '.' suffix: source files stay committable
  ['src/vite-env.d.ts', false],
  ['venv/.env/lib/site.py', false],        // a folder named .env (Python venv) — basename rule
  ['.env.example', false],
  ['.env.sample', false],
  ['.env.template', false],
  ['config/.env.dist', false],
  ['.env.defaults', false],
  ['envoy.yaml', false],
  ['docs/env.md', false],
  ['.envrc', false],
  ['src/environment.ts', false],
  ['sub/', false],
  ['', false],
];
for (const [p, want] of ENV_TABLE) {
  test(`isEnvPath(${JSON.stringify(p)}) → ${want}`, () => assert.equal(guard.isEnvPath(p), want));
}
test('isEnvPath tolerates non-strings', () => {
  assert.equal(guard.isEnvPath(null), false);
  assert.equal(guard.isEnvPath(undefined), false);
  assert.equal(guard.isEnvPath(42), false);
});

// ---------------------------------------------------------------- parsePorcelainZ
test('parsePorcelainZ: NUL-separated XY records, status trimmed', () => {
  const out = '?? sub/.env\0?? sub/app.js\0 M README.md\0A  lib/new.js\0MM both.js\0';
  assert.deepEqual(guard.parsePorcelainZ(out), [
    { path: 'sub/.env', status: '??' },
    { path: 'sub/app.js', status: '??' },
    { path: 'README.md', status: 'M' },
    { path: 'lib/new.js', status: 'A' },
    { path: 'both.js', status: 'MM' },
  ]);
});
test('parsePorcelainZ: spaces and quotes in paths survive (-z never quotes)', () => {
  assert.deepEqual(guard.parsePorcelainZ('?? my dir/a "b".txt\0'), [{ path: 'my dir/a "b".txt', status: '??' }]);
});
test('parsePorcelainZ: a stray rename record consumes its source path', () => {
  assert.deepEqual(guard.parsePorcelainZ('R  new.js\0old.js\0 M x.js\0'), [
    { path: 'new.js', status: 'R' },
    { path: 'x.js', status: 'M' },
  ]);
});
test('parsePorcelainZ: empty / junk input → []', () => {
  assert.deepEqual(guard.parsePorcelainZ(''), []);
  assert.deepEqual(guard.parsePorcelainZ(null), []);
  assert.deepEqual(guard.parsePorcelainZ('\0\0'), []);
  assert.deepEqual(guard.parsePorcelainZ('xx\0'), []);
});

// ---------------------------------------------------------------- integration
const tmpDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
function initRepo(dir) {
  git(dir, 'init', '-q', '-b', 'main');   // explicit branch: not hostage to init.defaultBranch
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'core.autocrlf', 'false');
}
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });   // .git objects are read-only on Windows
});

test('changeSet lists files inside an untracked folder individually and flags sub/.env', () => {
  const dir = mkTmp('hq-commit-guard-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project A\n');
  git(dir, 'add', 'README.md');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');   // throwaway fixture repo

  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', '.env'), 'PLACEHOLDER=1\n');
  fs.writeFileSync(path.join(dir, 'sub', 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'PLACEHOLDER=\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project A\nchanged\n');

  const cs = guard.changeSet(dir);
  assert.ok(!cs.error, cs.error);
  const byPath = Object.fromEntries(cs.files.map((f) => [f.path, f]));
  assert.ok(!byPath['sub/'], 'the untracked folder is NOT collapsed to sub/');
  assert.deepEqual(byPath['sub/.env'], { path: 'sub/.env', status: '??', env: true });
  assert.deepEqual(byPath['sub/app.js'], { path: 'sub/app.js', status: '??', env: false });
  assert.deepEqual(byPath['.env.example'], { path: '.env.example', status: '??', env: false });
  assert.equal(byPath['README.md'].status, 'M');
  assert.deepEqual(cs.envHits, ['sub/.env']);
  assert.equal(cs.branch, 'main');
  assert.match(cs.stat, /README\.md/, 'diff HEAD --stat covers tracked changes');
  assert.deepEqual(guard.envHits(dir), ['sub/.env']);

  // Staged files are in the set too (union with diff --cached), once each.
  git(dir, 'add', 'sub/app.js');
  const cs2 = guard.changeSet(dir);
  assert.equal(cs2.files.filter((f) => f.path === 'sub/app.js').length, 1, 'no duplicates from the union');
  assert.equal(cs2.files.find((f) => f.path === 'sub/app.js').status, 'A');

  // Without the .env the guard lets the commit through.
  fs.rmSync(path.join(dir, 'sub', '.env'));
  assert.deepEqual(guard.envHits(dir), []);
});

test('changeSet from a subfolder still reports the whole repo (what add -A stages)', () => {
  const dir = mkTmp('hq-commit-guard-sub-');
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'index.js'), '1\n');
  fs.writeFileSync(path.join(dir, '.env.local'), 'PLACEHOLDER=1\n');
  const cs = guard.changeSet(path.join(dir, 'pkg'));
  assert.ok(!cs.error, cs.error);
  assert.deepEqual(cs.envHits, ['.env.local']);
});

test('a repo with no commits: branch still named, stat empty, .env flagged', () => {
  const dir = mkTmp('hq-commit-guard-unborn-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, '.env'), 'PLACEHOLDER=1\n');
  const cs = guard.changeSet(dir);
  assert.ok(!cs.error, cs.error);
  assert.equal(cs.branch, 'main', 'symbolic-ref fallback names the unborn branch');
  assert.equal(cs.stat, '');
  assert.deepEqual(cs.envHits, ['.env']);
});

test('copies of a .env that add -A would stage are hits (review regression)', () => {
  const dir = mkTmp('hq-commit-guard-copies-');
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'cfg'));
  fs.writeFileSync(path.join(dir, 'cfg', '.env - Copy'), 'PLACEHOLDER=1\n');   // Explorer duplicate, inside an untracked folder
  fs.writeFileSync(path.join(dir, '.env~'), 'PLACEHOLDER=1\n');                // editor backup
  fs.writeFileSync(path.join(dir, '.env-example'), 'PLACEHOLDER=\n');          // a template stays allowed
  // ground truth: these are exactly what `git add -A` would stage
  const dry = spawnSync('git', ['add', '-A', '--dry-run'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /cfg\/\.env - Copy/);
  assert.match(dry.stdout, /\.env~/);
  assert.deepEqual(guard.envHits(dir).sort(), ['.env~', 'cfg/.env - Copy']);
});

test('diff.relative=true from a subfolder: no cwd-relative phantom paths (review regression)', () => {
  const dir = mkTmp('hq-commit-guard-rel-');
  initRepo(dir);
  git(dir, 'config', 'diff.relative', 'true');
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'x.js'), '1\n');
  git(dir, 'add', 'pkg/x.js');
  const cs = guard.changeSet(path.join(dir, 'pkg'));
  assert.ok(!cs.error, cs.error);
  assert.deepEqual(cs.files.map((f) => f.path), ['pkg/x.js'], 'root-relative, listed once');
});

test('envHits FAILS CLOSED: missing folder → [<git error>]', () => {
  const missing = path.join(os.tmpdir(), 'hq-commit-guard-does-not-exist-' + process.pid);
  assert.deepEqual(guard.changeSet(missing), { error: 'project folder not found' });
  assert.deepEqual(guard.envHits(missing), ['<git error>']);
  assert.deepEqual(guard.envHits(''), ['<git error>']);
});

test('a FILE path is "project folder not found", not a misleading git ENOENT (review regression)', () => {
  const dir = mkTmp('hq-commit-guard-file-');
  const file = path.join(dir, 'README.md');
  fs.writeFileSync(file, '# Project A\n');
  assert.deepEqual(guard.changeSet(file), { error: 'project folder not found' });
  assert.deepEqual(guard.envHits(file), [guard.GIT_ERROR_HIT]);
});

test('envHits FAILS CLOSED: a folder that is not a git repo → [<git error>]', (t) => {
  const notRepo = mkTmp('hq-commit-guard-norepo-');
  // A repo somewhere above os.tmpdir() would make this a work tree; say so instead of passing silently.
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: notRepo, encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) { t.skip('os.tmpdir() is inside a git work tree on this machine'); return; }
  assert.ok(guard.changeSet(notRepo).error, 'changeSet reports the error');
  assert.deepEqual(guard.envHits(notRepo), [guard.GIT_ERROR_HIT]);
});

// ---------------------------------------------------------------- IPC handler
function fakeIpc() {
  const handlers = {};
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } };
}

test("init registers hq:commit-preview; a path outside the workspace is refused", () => {
  const { handlers, ipcMain } = fakeIpc();
  guard.init({ ipcMain, resolveProjectPath: () => null });
  assert.equal(typeof handlers['hq:commit-preview'], 'function');
  assert.deepEqual(handlers['hq:commit-preview']({}, 'C:\\elsewhere'), { error: 'path outside the workspace' });
});

test('hq:commit-preview returns the change set for a resolved path, and never throws', () => {
  const dir = mkTmp('hq-commit-guard-ipc-');
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'prod.env'), 'PLACEHOLDER=1\n');
  const { handlers, ipcMain } = fakeIpc();
  guard.init({ ipcMain, resolveProjectPath: (p) => (p === '~/dev/project-a' ? dir : null) });
  const r = handlers['hq:commit-preview']({}, '~/dev/project-a');
  assert.deepEqual(r.envHits, ['prod.env']);
  assert.deepEqual(Object.keys(r).sort(), ['branch', 'envHits', 'files', 'stat']);

  const boom = fakeIpc();
  guard.init({ ipcMain: boom.ipcMain, resolveProjectPath: () => { throw new Error('resolver broke'); } });
  assert.deepEqual(boom.handlers['hq:commit-preview']({}, 'x'), { error: 'resolver broke' });
});
