// node --test dashboard/git-actions.test.mjs — async git/robocopy runners for
// the tray quick actions. The contract under test: nothing here ever blocks or
// hangs its caller (a stalled push ends as an honest per-repo failure, never a
// frozen app), and batch results carry each failure's name + reason for the
// completion notification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { run, gitEach, snapshotProject } = require('./git-actions.js');

const win32 = process.platform === 'win32';
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-git-actions-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
  return d;
}

// ---------------------------------------------------------------------- run
test('run: resolves with the child exit status', async () => {
  const r = await run(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(r.status, 3);
  assert.equal(r.timedOut, false);
  assert.equal(r.error, undefined);
});

test('run: captures a stderr tail for the failure report', async () => {
  const r = await run(process.execPath, ['-e', 'console.error("placeholder-stderr"); process.exit(1)']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /placeholder-stderr/);
});

test('run: a spawn failure resolves with error, never rejects', async () => {
  const r = await run('hq-definitely-not-a-command-xyz', []);
  assert.ok(r.error, 'spawn error surfaced');
  assert.equal(r.status, null);
});

test('run: deadline stops a hung process and resolves timedOut (never a frozen caller)', async () => {
  const t0 = Date.now();
  const r = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 400 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 15000, 'resolved well inside the backstop');
});

// ------------------------------------------------------------------ gitEach
// the runner is injected so the test never spawns git — gitEach's own job is
// the serial loop, the counting and the per-repo failure reasons
test('gitEach: counts ok, reports each failure with name + reason, skips bad paths without spawning', async () => {
  const calls = [];
  const runner = async (cmd, args, opts) => {
    calls.push([cmd, ...args, opts.timeoutMs]);
    return args.includes('C:/good') ? { status: 0, timedOut: false, stderr: '' } : { status: 128, timedOut: false, stderr: 'fatal: no remote configured\n' };
  };
  const projects = [{ name: 'Good', path: 'good' }, { name: 'Bad', path: 'bad' }, { name: 'Gone', path: 'gone' }];
  const resolvePath = (p) => (p === 'gone' ? null : 'C:/' + p);
  const { ok, failed } = await gitEach(projects, ['push'], { resolvePath, runner, timeoutMs: 5000 });
  assert.equal(ok, 1);
  assert.deepEqual(failed.map((f) => f.name), ['Bad', 'Gone']);
  assert.match(failed[0].reason, /exit 128/);
  assert.match(failed[0].reason, /no remote configured/);
  assert.equal(failed[1].reason, 'bad path');
  assert.equal(calls.length, 2, 'the unresolvable path never reached the runner');
  assert.deepEqual(calls[0], ['git', '-C', 'C:/good', 'push', 5000]);
});

test('gitEach: a timed-out push is reported as such (the tray-freeze failure scenario, now an honest result)', async () => {
  const runner = async () => ({ status: null, timedOut: true, stderr: '' });
  const { ok, failed } = await gitEach([{ name: 'Stuck', path: 'x' }], ['push'], { resolvePath: () => 'C:/x', runner, timeoutMs: 60000 });
  assert.equal(ok, 0);
  assert.deepEqual(failed, [{ name: 'Stuck', reason: 'timed out after 60s' }]);
});

test('gitEach: runs serially, in order', async () => {
  const order = [];
  let inFlight = 0;
  const runner = async (_c, args) => {
    inFlight++;
    assert.equal(inFlight, 1, 'never two pushes at once');
    order.push(args[1]);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return { status: 0, timedOut: false, stderr: '' };
  };
  const projects = [{ name: 'A', path: 'a' }, { name: 'B', path: 'b' }];
  const { ok } = await gitEach(projects, ['push'], { resolvePath: (p) => p, runner });
  assert.equal(ok, 2);
  assert.deepEqual(order, ['a', 'b']);
});

// ----------------------------------------------------------- snapshotProject
test('snapshotProject: filtered copy keeps source files, drops excluded dirs', { skip: !win32 }, async (t) => {
  const src = tmp(t);
  fs.writeFileSync(path.join(src, 'keep.txt'), 'placeholder');
  fs.mkdirSync(path.join(src, 'node_modules'));
  fs.writeFileSync(path.join(src, 'node_modules', 'x.js'), '1');
  const backups = tmp(t);
  const dest = await snapshotProject(src, 'My: Proj?', { backupsDir: backups, excludeDirs: ['node_modules'] });
  assert.ok(dest, 'snapshot landed');
  assert.ok(dest.startsWith(backups));
  assert.ok(!path.basename(dest).includes(':') && !path.basename(dest).includes('?'), 'name sanitized');
  assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'placeholder');
  assert.ok(!fs.existsSync(path.join(dest, 'node_modules')), 'excluded dir dropped');
});

test('snapshotProject: a real robocopy error returns null and removes the dest', { skip: !win32 }, async (t) => {
  const backups = tmp(t);
  const dest = await snapshotProject(path.join(backups, 'does-not-exist-src'), 'Gone', { backupsDir: backups });
  assert.equal(dest, null);
  assert.deepEqual(fs.readdirSync(backups), [], 'failed dest cleaned up');
});

test('snapshotProject: a timeout counts as failure and cleans up (injected runner)', async (t) => {
  const backups = tmp(t);
  const runner = async () => ({ status: null, timedOut: true, stderr: '' });
  const dest = await snapshotProject('C:/anything', 'Slow', { backupsDir: backups, runner });
  assert.equal(dest, null);
  assert.deepEqual(fs.readdirSync(backups), []);
});
