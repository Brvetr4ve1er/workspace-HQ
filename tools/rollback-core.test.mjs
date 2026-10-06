// node --test tools/rollback-core.test.mjs
// The process shapes below are real Win32_Process command lines from a dev machine
// (main app, its Chromium children, a test instance, the trailer renderer), with
// the user folder anonymised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validVersion, splitArgs, matchOwnerApp, planRollback, appPaths } from './rollback-core.mjs';

const REPO = 'C:\\Users\\me\\Documents\\workspace hq';
const EXE = `${REPO}\\dashboard\\node_modules\\electron\\dist\\electron.exe`;
const proc = (pid, ppid, commandLine, extra = {}) => ({ ProcessId: pid, ParentProcessId: ppid, Name: 'electron.exe', ExecutablePath: EXE, CommandLine: commandLine, ...extra });

const OWNER = proc(38980, 4680, `"${EXE}"  .`);
const OWNER_GPU = proc(8060, 38980, `"${EXE}" --type=gpu-process --user-data-dir="C:\\Users\\me\\AppData\\Roaming\\workspacehq" --gpu-preferences=UAAAAAAAAADgAAAMAAAAAAAA`);
const OWNER_RENDERER = proc(31964, 38980, `"${EXE}" --type=renderer --user-data-dir="C:\\Users\\me\\AppData\\Roaming\\workspacehq" --app-path="${REPO}\\dashboard" --enable-sandbox --lang=en-US`);
const OWNER_NET = proc(17728, 38980, `"${EXE}" --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none --user-data-dir="C:\\Users\\me\\AppData\\Roaming\\workspacehq"`);
const TRAILER = proc(10776, 28596, `"${EXE}" tools\\trailer\\render-main.js --trailer 2 --src C:\\Users\\me\\AppData\\Local\\Temp\\work`);
const TRAILER_GPU = proc(8624, 10776, `"${EXE}" --type=gpu-process --user-data-dir="${REPO}\\tools\\trailer\\.work\\electron-profile-10776"`);
const TEST_INSTANCE = proc(5000, 4999, `"${EXE}" . --hidden --user-data-dir=C:\\Users\\me\\AppData\\Local\\Temp\\hq-test-1 --remote-debugging-port=9333`);
const HIDDEN_LAUNCH = proc(6000, 1, `"${EXE}" . --hidden`);

test('validVersion: v2..v5 only, case and whitespace forgiven', () => {
  for (const v of ['v2', 'v3', 'v4', 'v5']) assert.equal(validVersion(v), v);
  assert.equal(validVersion(' V3 '), 'v3');
  for (const bad of ['', 'v1', 'v6', '3', 'v3x', 'legacy', null, undefined, 'v 3']) assert.equal(validVersion(bad), null, String(bad));
});

test('splitArgs follows CommandLineToArgvW quoting', () => {
  assert.deepEqual(splitArgs(`"${EXE}"  .`), [EXE, '.']);
  assert.deepEqual(splitArgs('a --user-data-dir="C:\\a b\\c" --x'), ['a', '--user-data-dir=C:\\a b\\c', '--x']);
  assert.deepEqual(splitArgs('a "b\\"c" d'), ['a', 'b"c', 'd']);
  assert.deepEqual(splitArgs('a "C:\\dir\\\\" b'), ['a', 'C:\\dir\\', 'b']);
  assert.deepEqual(splitArgs('a C:\\x\\y b'), ['a', 'C:\\x\\y', 'b']);
  assert.deepEqual(splitArgs('a "" b'), ['a', '', 'b']);
  assert.deepEqual(splitArgs(''), []);
  assert.deepEqual(splitArgs(null), []);
});

test('matchOwnerApp: the main app process (".", with or without --hidden) matches', () => {
  assert.equal(matchOwnerApp(OWNER, REPO), true);
  assert.equal(matchOwnerApp(HIDDEN_LAUNCH, REPO), true);
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" "${REPO}\\dashboard"`), REPO), true, 'absolute dashboard path');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" "${REPO}\\dashboard\\main.js" --hidden`), REPO), true, 'absolute main.js');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE.toUpperCase()}" .`, { ExecutablePath: EXE.toUpperCase() }), REPO.toLowerCase()), true, 'case-insensitive paths');
});

test('matchOwnerApp: Chromium children never match (they carry --type= and the profile dir)', () => {
  for (const p of [OWNER_GPU, OWNER_RENDERER, OWNER_NET, TRAILER_GPU]) assert.equal(matchOwnerApp(p, REPO), false, p.CommandLine);
});

test('matchOwnerApp: test instances (--user-data-dir) never match', () => {
  assert.equal(matchOwnerApp(TEST_INSTANCE, REPO), false);
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" . --user-data-dir "C:\\tmp\\x"`), REPO), false, 'space-separated flag value');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" --USER-DATA-DIR=C:\\tmp\\x .`), REPO), false, 'flag case');
});

test('matchOwnerApp: other Electron programs and other installs never match', () => {
  assert.equal(matchOwnerApp(TRAILER, REPO), false, 'trailer renderer: app arg is a script');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" dev-main.js`), REPO), false, 'legacy dev harness');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}"`), REPO), false, 'no app argument');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" C:\\elsewhere\\app`), REPO), false, 'another app folder');
  const otherExe = 'C:\\other\\project\\node_modules\\electron\\dist\\electron.exe';
  assert.equal(matchOwnerApp(proc(1, 1, `"${otherExe}" .`, { ExecutablePath: otherExe }), REPO), false, 'another repo\'s electron');
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" .`, { Name: 'node.exe' }), REPO), false, 'not electron.exe');
  assert.equal(matchOwnerApp(proc(1, 1, null), REPO), false, 'no command line (access denied)');
  assert.equal(matchOwnerApp(null, REPO), false);
});

test('matchOwnerApp falls back to argv[0] when ExecutablePath is missing', () => {
  assert.equal(matchOwnerApp(proc(1, 1, `"${EXE}" .`, { ExecutablePath: null }), REPO), true);
  assert.equal(matchOwnerApp(proc(1, 1, '"C:\\x\\electron.exe" .', { ExecutablePath: null }), REPO), false);
});

test('planRollback: stops only the owner app (+ its children), relaunches hidden from dashboard\\', () => {
  const all = [OWNER, OWNER_GPU, OWNER_RENDERER, OWNER_NET, TRAILER, TRAILER_GPU, TEST_INSTANCE,
    { ProcessId: 77, ParentProcessId: 5000, Name: 'electron.exe', ExecutablePath: EXE, CommandLine: `"${EXE}" --type=renderer --user-data-dir=C:\\Users\\me\\AppData\\Local\\Temp\\hq-test-1` }];
  const plan = planRollback({ version: 'V3', procs: all, repoRoot: REPO });
  assert.equal(plan.version, 'v3');
  assert.equal(plan.target, 'legacy/dashboard-v3/index.html');
  assert.equal(plan.uiVersionFile, `${REPO}\\data\\.ui-version`);
  assert.deepEqual(plan.stop.map((s) => s.pid), [38980]);
  assert.deepEqual(plan.children.sort(), [8060, 17728, 31964].sort());
  assert.deepEqual(plan.launch, { exe: EXE, args: ['.', '--hidden'], cwd: `${REPO}\\dashboard` });
});

test('planRollback: v5 targets dashboard-v5; nothing running → nothing to stop; bad input throws', () => {
  const plan = planRollback({ version: 'v5', procs: [TRAILER, TEST_INSTANCE], repoRoot: REPO });
  assert.equal(plan.target, 'dashboard-v5/index.html');
  assert.deepEqual(plan.stop, []);
  assert.deepEqual(plan.children, []);
  assert.deepEqual(planRollback({ version: 'v4', procs: OWNER, repoRoot: REPO }).stop.map((s) => s.pid), [38980], 'single object (ConvertTo-Json of one process)');
  assert.deepEqual(planRollback({ version: 'v2', procs: null, repoRoot: REPO }).stop, []);
  assert.throws(() => planRollback({ version: 'v6', procs: [], repoRoot: REPO }), /unknown renderer "v6"/);
  assert.throws(() => planRollback({ version: 'v3', procs: [], repoRoot: '' }), /repo root/);
});

test('appPaths are built from the repo root (no machine paths baked in)', () => {
  assert.deepEqual(appPaths('D:\\src\\hq'), {
    dashboard: 'D:\\src\\hq\\dashboard',
    electron: 'D:\\src\\hq\\dashboard\\node_modules\\electron\\dist\\electron.exe',
    uiVersionFile: 'D:\\src\\hq\\data\\.ui-version',
  });
});

test('CLI: plan reads processes on stdin and prints the plan; a bad version exits 2', () => {
  const cli = fileURLToPath(new URL('./rollback-core.mjs', import.meta.url));
  const ok = spawnSync(process.execPath, [cli, 'plan', '--version', 'v3', '--repo', REPO], { input: '\uFEFF' + JSON.stringify([OWNER, OWNER_GPU, TRAILER]), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const plan = JSON.parse(ok.stdout);
  assert.deepEqual(plan.stop.map((s) => s.pid), [38980]);
  assert.deepEqual(plan.children, [8060]);
  const empty = spawnSync(process.execPath, [cli, 'plan', '--version', 'v5', '--repo', REPO], { input: '', encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).stop, []);
  const bad = spawnSync(process.execPath, [cli, 'plan', '--version', 'v9', '--repo', REPO], { input: '[]', encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown renderer "v9"/);
  const usage = spawnSync(process.execPath, [cli], { input: '', encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
