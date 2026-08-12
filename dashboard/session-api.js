// v4 SPINE B3 — session IPC over the claude-sessions seam (IPC-CONTRACT.md:
// hq:session-start / hq:session-kill / hq:session-diff + hq:session-output push).
// Main-process logic lives HERE, not in main.js (program invariant: new
// main-side features go in NEW files; main.js gets one init() hook line).
//
// Security posture:
// - The renderer NEVER chooses the executable or argv. IPC accepts only
//   {cwd, task, label}; claude-sessions' default args ['-p'] (headless print
//   mode) stay, and the task travels via stdin (`input`).
// - cwd is containment-checked under DOCS_ROOT with the exact same rule as
//   main.js resolveProjectPath (re-implemented locally on purpose — main.js is
//   not edited/exported for it; keep the two in sync by NOT "improving" this).
// - Git probe is spawnSync with shell:false; nothing renderer-supplied is
//   interpreted by a shell.
// - Every invoke handler settles ({error} for start/diff, false for kill) —
//   never throws across the IPC boundary.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCS_ROOT = 'C:\\Users\\ROG STRIX\\Documents';   // mirror of main.js:28
const TASK_MAX = 2000;                                 // plan-mandated task cap
const LABEL_MAX = 60;
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;             // main-side constant (contract row); seam default 120s kills real runs
const GIT_MAX_BUFFER = 10 * 1024 * 1024;               // big diffs exceed the 1MB spawnSync default

// Same acceptance rule as main.js resolveProjectPath: absolute paths pass
// through, legacy relative paths join DOCS_ROOT, anything resolving outside
// DOCS_ROOT (or not to it) is rejected → null.
function containCwd(p) {
  const s = String(p || '');
  if (!s) return null;
  const abs = path.resolve(path.isAbsolute(s) ? s : path.join(DOCS_ROOT, s.replace(/\//g, path.sep)));
  const root = path.resolve(DOCS_ROOT);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

function defaultLabel(task) {
  const oneLine = String(task || '').replace(/\s+/g, ' ').trim();
  return (oneLine.slice(0, LABEL_MAX) || 'claude session');
}

// `git status --porcelain` line → {path, status}. Status is the two-char XY
// code trimmed; git may double-quote paths with special characters — strip
// defensively. Rename lines keep their "old -> new" form (display-friendly).
function parsePorcelain(out) {
  return String(out || '').split(/\r?\n/).filter((l) => l.length > 3).map((l) => {
    let p = l.slice(3);
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    return { path: p, status: l.slice(0, 2).trim() };
  });
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
}

// init({ ipcMain, claudeSessions, send }) — main.js calls this once.
// Returns the handler map so a plain-node harness can drive the same functions
// through a fake ipcMain/claudeSessions (used by the B3 seam smoke).
function init({ ipcMain, claudeSessions, send }) {
  const push = (channel, payload) => { try { send(channel, payload); } catch { /* window closing */ } };

  const handlers = {
    'hq:session-start': (_e, opts) => {
      try {
        const { cwd, task, label } = opts || {};
        const dir = containCwd(cwd);
        if (!dir) return { error: 'cwd outside the Documents root' };
        const prompt = String(task || '').slice(0, TASK_MAX);
        if (!prompt.trim()) return { error: 'task is empty' };
        let jobId = null;   // assigned before any stdout tick can fire (data events are async)
        const r = claudeSessions.start({
          label: String(label || '').trim().slice(0, LABEL_MAX) || defaultLabel(prompt),
          cwd: dir,
          input: prompt,                    // headless print mode reads the task from stdin
          timeoutMs: SESSION_TIMEOUT_MS,
          onOutput: (chunk) => { if (jobId) push('hq:session-output', { jobId, chunk: String(chunk) }); },
        });
        if (r.error) return { error: r.error };
        jobId = r.jobId;
        return { jobId };
      } catch (e) { return { error: String(e?.message || e) }; }
    },

    'hq:session-kill': (_e, jobId) => {
      try { return claudeSessions.kill(String(jobId || '')) === true; }
      catch { return false; }
    },

    'hq:session-diff': (_e, opts) => {
      try {
        const dir = containCwd(opts?.cwd);
        if (!dir) return { error: 'cwd outside the Documents root' };
        const st = git(['status', '--porcelain'], dir);
        if (st.error) return { error: 'git not available: ' + String(st.error.message || st.error) };
        if (st.status !== 0) return { error: String(st.stderr || 'git status failed').trim() };
        const df = git(['diff', '--stat'], dir);
        return { files: parsePorcelain(st.stdout), stat: df.status === 0 ? String(df.stdout || '').trimEnd() : '' };
      } catch (e) { return { error: String(e?.message || e) }; }
    },
  };

  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn);
  return handlers;
}

module.exports = { init };
