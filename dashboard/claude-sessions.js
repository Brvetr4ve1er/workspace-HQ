// The Familiar's leash (MA deliverable 1) — one registry for every Claude CLI
// process the app runs: spawn (NEVER sync), stream, time out, kill, list.
// Pure Node (no Electron requires) so it unit-tests under plain `node`;
// main.js injects the window push via setOnChange. Mirrors castRegistry's
// lifecycle: entry -> stream -> finish exactly once -> brief lingering
// visibility (the list is presence, not history — the acted-on ledger and
// spell telemetry own history).
const { spawn, spawnSync } = require('node:child_process');

let cachedClaude;                  // probed once per app run (was per-call)
function findClaude() {
  if (cachedClaude !== undefined) return cachedClaude;
  const cands = ['C:/Users/ROG STRIX/AppData/Roaming/npm/claude.cmd', 'claude'];
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      if (!r.error && r.status === 0) { cachedClaude = c; return c; }
    } catch { /* try next candidate */ }
  }
  cachedClaude = null;
  return null;
}

const sessions = new Map();        // jobId -> entry
let seq = 0;
let onChange = () => {};
const LINGER_MS = 60000;
const TAIL = 800, BUF_MAX = 64000;

function setOnChange(fn) { onChange = typeof fn === 'function' ? fn : () => {}; }
function emit() { try { onChange(list()); } catch { /* consumer's problem */ } }

function publicView(e) {
  return {
    jobId: e.jobId, label: e.label, status: e.status,
    startedAt: e.startedAt, endedAt: e.endedAt || null,
    exitCode: e.exitCode ?? null, tail: e.buf.slice(-TAIL),
  };
}
function list() { return [...sessions.values()].map(publicView); }

// command override exists for tests only; production always resolves claude
function start({ label = 'claude', args = ['-p'], input = null, cwd = undefined, timeoutMs = 120000, onOutput = null, onDone = null, command = null }) {
  const exe = command || findClaude();
  if (!exe) return { error: 'claude CLI not found on PATH' };
  const jobId = 'cs-' + Date.now().toString(36) + '-' + (++seq);
  let proc;
  try { proc = spawn(exe, args, { cwd, windowsHide: true }); }
  catch (e) { return { error: 'spawn failed: ' + (e.message || e) }; }
  const entry = { jobId, label, status: 'running', startedAt: new Date().toISOString(), buf: '', proc, timer: null };
  sessions.set(jobId, entry);
  emit();

  const push = (chunk) => {
    entry.buf = (entry.buf + chunk).slice(-BUF_MAX);
    if (onOutput) try { onOutput(chunk); } catch { /* listener's problem */ }
  };
  proc.stdout?.on('data', (b) => push(String(b)));
  proc.stderr?.on('data', (b) => push(String(b)));

  const finish = (status, code) => {
    if (entry.status !== 'running') return;      // exactly once
    if (entry.timer) clearTimeout(entry.timer);
    entry.status = status; entry.exitCode = code;
    entry.endedAt = new Date().toISOString(); entry.proc = null;
    emit();
    if (onDone) try { onDone({ status, code, output: entry.buf }); } catch { /* listener's problem */ }
    const t = setTimeout(() => { sessions.delete(jobId); emit(); }, LINGER_MS);
    if (t.unref) t.unref();
  };
  proc.on('close', (code) => finish(code === 0 ? 'done' : 'failed', code));
  proc.on('error', (err) => { push(String(err.message || err)); finish('failed', -1); });

  if (input != null) { try { proc.stdin.write(input); proc.stdin.end(); } catch { /* proc died first; close fires */ } }
  entry.timer = setTimeout(() => { entry.buf += '\n[timeout]'; kill(jobId); }, timeoutMs);
  if (entry.timer.unref) entry.timer.unref();
  return { jobId };
}

// Promise face over start() — for handlers that just want the final output
// (draft-commit). Resolves, never rejects: {status, code, output, error?}.
function run(opts) {
  return new Promise((resolve) => {
    const r = start({ ...opts, onDone: resolve });
    if (r.error) resolve({ status: 'failed', code: null, output: '', error: r.error });
  });
}

function kill(jobId) {
  const e = sessions.get(jobId);
  if (!e || e.status !== 'running' || !e.proc?.pid) return false;
  try { spawnSync('taskkill', ['/pid', String(e.proc.pid), '/f', '/t'], { windowsHide: true }); } catch { /* close handler settles it */ }
  return true;
}

module.exports = { findClaude, start, run, list, kill, setOnChange };
