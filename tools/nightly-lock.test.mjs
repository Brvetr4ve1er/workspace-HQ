// node --test tools/nightly-lock.test.mjs
// The nightly run-pipeline.ps1 takes data/.refresh.lock (tools/nightly-lock.ps1) the way dashboard/refresh-lock.js does.
// Every case runs real Windows PowerShell 5.1 (the one the app spawns) against a temp data folder, through a tiny harness that
// mirrors the lines run-pipeline.ps1 gains: take, exit 0 on 'skipped', try { steps + heartbeat } finally { release }.
// The whole file is skipped when powershell.exe is absent. Placeholder names only; no owner data is read.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(here, 'nightly-lock.ps1');
const require = createRequire(import.meta.url);
const refreshLock = require('../dashboard/refresh-lock.js');

const HAVE_PS = process.platform === 'win32'
  && spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;
const SKIP = HAVE_PS ? false : 'powershell.exe is not available on this machine';

// The harness text. LOGFN is swapped for the PowerShell function-drive syntax so the template literal never sees a dollar-brace.
const LOGFN = '$' + '{function:Log}';
const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
. $env:HQ_T_LIB
# the same Log shape run-pipeline.ps1 uses (a Tee-Object into the script-scope $log path; the lowercase name matters: a -Log parameter once shadowed it)
$log = $env:HQ_T_LOG
function Log($msg) { "[$(Get-Date -Format o)] $msg" | Tee-Object -FilePath $log -Append }
$lockFile = Join-Path $env:HQ_T_DATA '.refresh.lock'
function RawLock { if (Test-Path -LiteralPath $lockFile) { [IO.File]::ReadAllText($lockFile) } else { '<none>' } }
$state = Take-NightlyLock -DataDir $env:HQ_T_DATA -Log @@LOGFN@@
Write-Host "STATE=$state"
Write-Host "PID=$PID"
if ($state -eq 'skipped') { exit 0 }
try {
  Write-Host 'RUNNING'
  if ($env:HQ_T_SHOW) { Write-Host ('LOCK=' + (RawLock)) }
  if ($env:HQ_T_MODE -eq 'heartbeat') {
    $before = RawLock
    Start-Sleep -Milliseconds 1100
    Heartbeat-NightlyLock
    Write-Host ('CHANGED=' + ($before -ne (RawLock)))
    $foreign = '{"pid":' + $env:HQ_T_FOREIGN_PID + ',"by":"mcp","startedAt":"' + [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") + '"}'
    [IO.File]::WriteAllText($lockFile, $foreign)
    Heartbeat-NightlyLock
    Write-Host ('FOREIGN_UNTOUCHED=' + ($foreign -eq (RawLock)))
    Release-NightlyLock
    Write-Host ('FOREIGN_SURVIVED=' + (Test-Path -LiteralPath $lockFile))
    Remove-Item -LiteralPath $lockFile -Force
  } else {
    if ($env:HQ_T_HOLD_MS) { Start-Sleep -Milliseconds ([int]$env:HQ_T_HOLD_MS) }
    Heartbeat-NightlyLock
    if ($env:HQ_T_EXIT) { exit ([int]$env:HQ_T_EXIT) }
  }
} finally { Release-NightlyLock }
`.split('@@LOGFN@@').join(LOGFN);

const cleanup = [];
const sleepers = [];
after(() => {
  for (const s of sleepers) { try { s.kill(); } catch { /* gone */ } }
  for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-lock-'));
  cleanup.push(dir);
  const data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  const script = path.join(dir, 'harness.ps1');
  fs.writeFileSync(script, HARNESS);
  return { dir, data, script, lock: path.join(data, '.refresh.lock'), log: path.join(dir, 'pipeline.log') };
}

function sleeper() {                      // a live process that is NOT an ancestor of the harness
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true });
  sleepers.push(child);
  return child.pid;
}
function deadPid() {
  return spawnSync(process.execPath, ['-e', '0'], { windowsHide: true }).pid;
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const writeLock = (sb, rec) => fs.writeFileSync(sb.lock, typeof rec === 'string' ? rec : JSON.stringify(rec));

// Starts the harness; resolves { code, stdout, lines, get(key) } on exit. `onOutput` sees stdout as it grows.
function runHarness(sb, env = {}, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sb.script], {
      windowsHide: true,
      env: { ...process.env, HQ_T_LIB: LIB, HQ_T_DATA: sb.data, HQ_T_LOG: sb.log, HQ_NIGHTLY_LOCK_WAIT_S: '1', HQ_NIGHTLY_LOCK_POLL_S: '0.2', ...env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b; if (onOutput) onOutput(stdout); });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      const get = (key) => { const l = lines.find((x) => x.startsWith(key + '=')); return l ? l.slice(key.length + 1) : undefined; };
      resolve({ code, stdout, stderr, lines, get });
    });
  });
}

test('a free folder: the run takes the lock in the refresh-lock.js shape and releases it at the end', { skip: SKIP }, async () => {
  const sb = sandbox();
  const r = await runHarness(sb, { HQ_T_SHOW: '1' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.get('STATE'), 'taken');
  const rec = JSON.parse(r.get('LOCK'));
  assert.deepEqual(Object.keys(rec).sort(), ['by', 'pid', 'startedAt']);
  assert.equal(rec.by, 'nightly');
  assert.equal(rec.pid, Number(r.get('PID')));
  assert.match(rec.startedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(rec.startedAt) - Date.now()) < 30e3);
  assert.equal(fs.existsSync(sb.lock), false, 'released at the end of the run');
});

test('CHILD-OF-HOLDER: the app\'s own fresh lock + this PowerShell as its child = inherited (writes, heartbeats and releases nothing)', { skip: SKIP }, async () => {
  const sb = sandbox();
  writeLock(sb, { pid: process.pid, by: 'app', startedAt: iso() });
  const before = fs.readFileSync(sb.lock);
  const r = await runHarness(sb, { HQ_T_HOLD_MS: '200' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.get('STATE'), 'inherited');
  assert.ok(r.lines.includes('RUNNING'), 'the run proceeds');
  assert.equal(r.lines.some((l) => l.includes('skipped:')), false);
  assert.ok(fs.existsSync(sb.lock), 'the app owns and releases that lock; the run never removes it');
  assert.ok(before.equals(fs.readFileSync(sb.lock)), 'the app lock file is byte-identical afterwards');
});

test('an app lock with a DIFFERENT live pid is a collision: one skipped line, exit 0, the lock untouched', { skip: SKIP }, async () => {
  const sb = sandbox();
  const startedAt = iso(-60e3);
  writeLock(sb, { pid: sleeper(), by: 'app', startedAt });
  const before = fs.readFileSync(sb.lock);
  const r = await runHarness(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.get('STATE'), 'skipped');
  const skipped = r.lines.filter((l) => l.includes('skipped: refresh lock held by'));
  assert.equal(skipped.length, 1, 'exactly one skipped line');
  assert.ok(skipped[0].includes('held by app since ' + startedAt), skipped[0]);
  assert.equal(r.lines.includes('RUNNING'), false);
  assert.equal(fs.readFileSync(sb.log, 'utf16le').split(/\r?\n/).filter((l) => l.includes('skipped:')).length, 1, 'the log file carries the same single line (Tee-Object writes UTF-16 on Windows PowerShell 5.1)');
  assert.ok(before.equals(fs.readFileSync(sb.lock)));
});

test('a fresh mcp lock is a collision too, and so is a fresh nightly lock from another run', { skip: SKIP }, async () => {
  for (const by of ['mcp', 'nightly']) {
    const sb = sandbox();
    writeLock(sb, { pid: sleeper(), by, startedAt: iso(-5e3) });
    const r = await runHarness(sb);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.get('STATE'), 'skipped', by);
    assert.ok(r.lines.some((l) => l.includes('held by ' + by)), by);
  }
});

test('a lock released inside the wait lets the run proceed', { skip: SKIP }, async () => {
  const sb = sandbox();
  writeLock(sb, { pid: sleeper(), by: 'mcp', startedAt: iso() });
  const timer = setTimeout(() => { try { fs.unlinkSync(sb.lock); } catch { /* gone */ } }, 1200);
  try {
    const r = await runHarness(sb, { HQ_NIGHTLY_LOCK_WAIT_S: '30', HQ_T_SHOW: '1' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.get('STATE'), 'taken');
    assert.ok(r.lines.includes('RUNNING'));
    assert.equal(JSON.parse(r.get('LOCK')).by, 'nightly');
    assert.equal(r.lines.some((l) => l.includes('skipped:')), false);
  } finally { clearTimeout(timer); }
});

test('stale locks are reclaimed: a dead pid, 16 minutes old, more than 60 s in the future, torn for over 5 s', { skip: SKIP }, async () => {
  const cases = {
    'dead pid': () => ({ pid: deadPid(), by: 'app', startedAt: iso() }),
    '16 minutes old (live pid)': () => ({ pid: sleeper(), by: 'mcp', startedAt: iso(-16 * 60e3) }),
    'startedAt 5 minutes in the future': () => ({ pid: sleeper(), by: 'app', startedAt: iso(5 * 60e3) }),
    'torn file older than 5 s': () => '',
  };
  for (const [name, make] of Object.entries(cases)) {
    const sb = sandbox();
    writeLock(sb, make());
    if (name.startsWith('torn')) { const old = new Date(Date.now() - 30e3); fs.utimesSync(sb.lock, old, old); }
    const r = await runHarness(sb, { HQ_T_SHOW: '1' });
    assert.equal(r.code, 0, name + ': ' + r.stderr);
    assert.equal(r.get('STATE'), 'taken', name);
    assert.equal(JSON.parse(r.get('LOCK')).by, 'nightly', name);
    assert.equal(fs.existsSync(sb.lock), false, name + ': released');
    assert.equal(fs.existsSync(sb.lock + '.reclaim'), false, name + ': the reclaim gate is gone');
  }
});

test('a torn file younger than 5 s is fresh (the run skips), and a 14 minute old lock with a live pid is still fresh', { skip: SKIP }, async () => {
  const sbTorn = sandbox();
  writeLock(sbTorn, '');
  const a = await runHarness(sbTorn, { HQ_NIGHTLY_LOCK_WAIT_S: '0' });
  assert.equal(a.get('STATE'), 'skipped');
  const sbOld = sandbox();
  writeLock(sbOld, { pid: sleeper(), by: 'mcp', startedAt: iso(-14 * 60e3) });
  const b = await runHarness(sbOld);
  assert.equal(b.get('STATE'), 'skipped');
});

test('two concurrent takers: exactly one wins', { skip: SKIP }, async () => {
  const sb = sandbox();
  const env = { HQ_NIGHTLY_LOCK_WAIT_S: '0', HQ_T_HOLD_MS: '4000' };
  const [x, y] = await Promise.all([runHarness(sb, env), runHarness(sb, env)]);
  assert.deepEqual([x.get('STATE'), y.get('STATE')].sort(), ['skipped', 'taken'], x.stderr + y.stderr);
  assert.equal(fs.existsSync(sb.lock), false, 'the winner released');
});

test('heartbeat rewrites startedAt only for its own lock; release removes only its own lock', { skip: SKIP }, async () => {
  const sb = sandbox();
  const r = await runHarness(sb, { HQ_T_MODE: 'heartbeat', HQ_T_FOREIGN_PID: String(sleeper()) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.get('STATE'), 'taken');
  assert.equal(r.get('CHANGED'), 'True', 'startedAt moved on the heartbeat');
  assert.equal(r.get('FOREIGN_UNTOUCHED'), 'True', 'a lock that is no longer ours is never rewritten');
  assert.equal(r.get('FOREIGN_SURVIVED'), 'True', 'and never released');
});

test('release also runs on a non-zero exit path (exit 3 inside try/finally)', { skip: SKIP }, async () => {
  const sb = sandbox();
  const r = await runHarness(sb, { HQ_T_EXIT: '3', HQ_T_SHOW: '1' });
  assert.equal(r.code, 3, 'the exit code is kept');
  assert.equal(r.get('STATE'), 'taken');
  assert.equal(JSON.parse(r.get('LOCK')).by, 'nightly');
  assert.equal(fs.existsSync(sb.lock), false, 'finally ran on the exit path');
});

test('a lock path the disk cannot take (a folder squatting on the name) never throws and never stops the run from ending cleanly', { skip: SKIP }, async () => {
  const sb = sandbox();
  fs.mkdirSync(sb.lock);
  const r = await runHarness(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(['open', 'skipped'].includes(r.get('STATE')), String(r.get('STATE')));
  assert.ok(fs.statSync(sb.lock).isDirectory(), 'the squatting folder is left alone');
});

test('parity: a JS lock is held for PowerShell; a PowerShell lock is read as held() by refresh-lock.js', { skip: SKIP }, async (t) => {
  // JS -> PowerShell (works with today's refresh-lock.js holders)
  for (const by of ['app', 'mcp']) {
    const sb = sandbox();
    const js = refreshLock.create({ dataDir: sb.data, pid: sleeper() });
    assert.equal(js.take(by), true, 'the JS side takes as ' + by);
    const r = await runHarness(sb);
    assert.equal(r.get('STATE'), 'skipped', 'PowerShell sees the JS ' + by + ' lock as held');
    assert.ok(r.lines.some((l) => l.includes('held by ' + by)));
    assert.equal(js.held().by, by, 'and the JS side still holds it');
  }
  // PowerShell -> JS: needs the fe: commit that adds 'nightly' to refresh-lock.js HOLDERS
  const probe = sandbox();
  if (refreshLock.create({ dataDir: probe.data }).take('nightly') !== true) {
    t.todo('refresh-lock.js HOLDERS does not name "nightly" yet (the fe: commit): a nightly lock reads as torn there and is never held()');
    return;
  }
  const sb = sandbox();
  let seen = null;
  const r = await runHarness(sb, { HQ_T_HOLD_MS: '3000' }, (out) => {
    if (!seen && out.includes('RUNNING')) seen = refreshLock.create({ dataDir: sb.data }).held();
  });
  assert.equal(r.get('STATE'), 'taken', r.stderr);
  assert.ok(seen, 'refresh-lock.js held() sees the PowerShell lock');
  assert.equal(seen.by, 'nightly');
  assert.equal(seen.pid, Number(r.get('PID')));
});
