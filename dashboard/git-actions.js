// Async git / robocopy runners for the tray quick actions and hq:snapshot.
// The old main.js versions ran spawnSync on the Electron main process: one
// `git push` stalled on a credential prompt (spawnSync's stdin pipe is never
// fed) or one multi-GB robocopy froze the whole app — window, tray, every IPC
// handler — with no in-app way to cancel. Each run here is spawn + promise +
// deadline. On a timeout the launcher's CHILDREN are stopped first, then the
// root: Git for Windows puts a cmd\git.exe launcher on PATH, and killing only
// it leaves the real git (and its hooks) running — the same pairing main.js
// stopGitTree documents for hq:do-commit.
// Program invariant: new main-side logic lives in a NEW file; main.js wires it.
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

const GIT_MS = 120000;        // a push over a slow uplink; matches COMMIT_GIT_MS.commit
const ROBOCOPY_MS = 600000;   // a big working-tree copy — bounded, and async so nothing freezes

// mirror of main.js safeFile — backup folder names
function safeFile(name) { return String(name || 'project').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'project'; }

// timeout path only (sync like main.js stopGitTree, ~0.6s): children first, then the root
function stopTree(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid)) return;
  try { spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }`], { windowsHide: true, timeout: 15000 }); } catch { /* best effort */ }
  try { spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, timeout: 15000 }); } catch { /* best effort */ }
}

// spawn and resolve { status, timedOut, error, stderr } — never rejects, never
// blocks main. stdin is closed so a credential/terminal prompt fails fast
// instead of hanging forever; stderr's tail is kept for the failure report.
// stdoutMax > 0 keeps stdout up to that many chars (hq:draft-commit reads a diff); env overrides the child's environment
// (hq:spellbook-rescan runs a collector script as Node via ELECTRON_RUN_AS_NODE).
function run(command, args, { timeoutMs = 0, cwd, stdoutMax = 0, env } = {}) {
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', stdoutMax > 0 ? 'pipe' : 'ignore', 'pipe'] }); }
    catch (e) { return resolve({ status: null, timedOut: false, error: e, stderr: '', stdout: '' }); }
    let stderr = '', stdout = '', timedOut = false, timer = null, backstop = null, done = false;
    const settle = (status, error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (backstop) clearTimeout(backstop);
      resolve({ status, timedOut, error, stderr: stderr.slice(-400), stdout: stdout.slice(0, stdoutMax) });
    };
    // keep reading past the cap (a full pipe would stall the child), just stop keeping it
    proc.stdout?.on('data', (b) => { if (stdout.length < stdoutMax) stdout += String(b); });
    proc.stderr?.on('data', (b) => { if (stderr.length < 4096) stderr += String(b); });
    proc.on('error', (e) => settle(null, e));
    proc.on('close', (code) => settle(code));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        stopTree(proc.pid);
        // if the kill could not land, still settle — callers must never hang
        backstop = setTimeout(() => settle(null, new Error('timed out — process not confirmed stopped')), 10000);
        if (backstop.unref) backstop.unref();
      }, timeoutMs);
    }
  });
}

// run `git <args>` in each project's working tree, SERIALLY (parallel pushes
// stack credential prompts; the old sync loop was serial too). Returns
// { ok, failed: [{ name, reason }] } for the completion notification.
async function gitEach(projects, args, { resolvePath, timeoutMs = GIT_MS, runner = run } = {}) {
  let ok = 0;
  const failed = [];
  for (const p of projects || []) {
    const name = (p && (p.name || p.path)) || '?';
    const cwd = resolvePath ? resolvePath(p && p.path) : p && p.path;
    if (!cwd) { failed.push({ name, reason: 'bad path' }); continue; }
    const r = await runner('git', ['-C', cwd, ...args], { timeoutMs });
    if (r.status === 0) { ok++; continue; }
    const tail = (r.stderr || '').trim().split(/\r?\n/).pop();
    failed.push({ name, reason: r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : r.error ? String(r.error.message || r.error) : `exit ${r.status}${tail ? ' — ' + tail : ''}` });
  }
  return { ok, failed };
}

// Filtered working-tree copy via robocopy (built into Windows): keeps .git +
// source, drops the heavy regenerable dirs. Non-disruptive, reversible.
// Resolves the dest path, or null on any real error (dest is cleaned up).
async function snapshotProject(absPath, name, { backupsDir, excludeDirs = [], timeoutMs = ROBOCOPY_MS, runner = run } = {}) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const dest = path.join(backupsDir, `${safeFile(name)}-${stamp}`);
  try { fs.mkdirSync(dest, { recursive: true }); } catch { return null; }
  const xd = excludeDirs.flatMap((d) => ['/XD', d]);
  const r = await runner('robocopy', [absPath, dest, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...xd], { timeoutMs });
  // robocopy exit codes 0-7 = success; >=8 (or a timeout / spawn error) = real error
  if (r.timedOut || r.error || (r.status ?? 16) >= 8) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} return null; }
  return dest;
}

module.exports = { run, gitEach, snapshotProject, GIT_MS, ROBOCOPY_MS };
