// v4 SPINE B3 — session IPC over the claude-sessions seam (IPC-CONTRACT.md:
// hq:session-start / hq:session-kill / hq:session-diff + hq:session-output push).
// Main-process logic lives HERE, not in main.js (program invariant: new
// main-side features go in NEW files; main.js gets one init() hook line).
//
// Security posture:
// - The renderer NEVER chooses the executable or argv. IPC accepts only
//   {cwd, task, label}; the argv is the FIXED main-side constant
//   SESSION_ARGS (headless print mode + stream-json output — v4.1 Phase 3),
//   and the task travels via stdin (`input`).
//
// Live token streaming (v4.1 Phase 3, IPC-CONTRACT.md hq:session-output
// note): stdout arrives as stream-json lines; each onOutput chunk runs
// through the pure parser in stream-parse.js before pushing, so the renderer
// sees assistant text + one-line [tool: ...] notices, never raw JSON.
//
// The same parsed text is recorded in session-tails.js (v4.1 D2). The
// claude-sessions registry still buffers RAW output — it is READ-ONLY by
// program constraint — and its stream-json `tail` is NOT merely cosmetic, as
// this comment previously claimed: the WORK agent pane and the AUTOMATE
// session list DISPLAY `tail` verbatim whenever the renderer's own live buffer
// is empty, which is exactly what capture-save/scan produce when they reload
// the window mid-linger. main.js swaps the parsed tail in on the way out of
// hq:sessions-list / hq:claude-sessions so those panes never show JSON.
// - cwd is containment-checked under DOCS_ROOT with the exact same rule as
//   main.js resolveProjectPath (re-implemented locally on purpose — main.js is
//   not edited/exported for it; keep the two in sync by NOT "improving" this).
// - Git probe is spawnSync with shell:false; nothing renderer-supplied is
//   interpreted by a shell.
//
// Attribution honesty: hq:session-start snapshots the cwd's dirty file set
// BEFORE spawning and keys it by jobId; hq:session-diff returns it as
// `baseline` so the CHANGES panel can subtract pre-existing dirt instead of
// billing the whole working tree to the agent (see IPC-CONTRACT.md).
// - Every invoke handler settles ({error} for start/diff, false for kill) —
//   never throws across the IPC boundary.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseChunk } = require('./stream-parse');
const sessionTails = require('./session-tails');

const DOCS_ROOT = 'C:\\Users\\ROG STRIX\\Documents';   // mirror of main.js:28
const TASK_MAX = 2000;                                 // plan-mandated task cap
const LABEL_MAX = 60;
// Fixed argv (renderer has no say): headless print mode emitting line-delimited
// stream-json; --verbose is required by the CLI for stream-json with -p.
const SESSION_ARGS = ['-p', '--output-format', 'stream-json', '--verbose'];
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;             // main-side constant (contract row); seam default 120s kills real runs
const GIT_MAX_BUFFER = 10 * 1024 * 1024;               // big diffs exceed the 1MB spawnSync default
const BASELINE_MAX = 100;                              // dispatch-time snapshots retained (FIFO); presence-sized, never persisted

// Same acceptance rule as main.js resolveProjectPath (the shared dashboard/project-paths.js):
// absolute paths pass through, legacy relative paths join DOCS_ROOT, anything resolving
// outside DOCS_ROOT is rejected → null — unless it is exactly a tracked project's path in
// the current data/latest.json (an own repo the scan found on the Desktop).
const containCwd = require('./project-paths').createResolver({ docsRoot: DOCS_ROOT, readLatest: require('./project-paths').readLatestFrom(path.join(__dirname, '..', 'data')) });

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

// ---------------------------------------------------------------- baseline
// WHY: `git status --porcelain` run after a session ends reports the WHOLE
// working tree, not the session's work. Without a dispatch-time reference a
// CHANGES panel attributes the user's own pre-existing edits to the agent —
// a control claiming an outcome it never verified. So we snapshot the dirty
// set BEFORE spawning (never after: the process can write between the two
// calls) and hand it back on hq:session-diff for the renderer to subtract.
//
// Honest failure: when the probe cannot run (not a repo, git absent) we keep
// {ok:false} rather than an empty path list, because "nothing was dirty" and
// "we never looked" must not render the same.
function captureBaseline(dir) {
  try {
    const st = git(['status', '--porcelain'], dir);
    if (st.error) return { ok: false, error: 'git not available: ' + String(st.error.message || st.error) };
    if (st.status !== 0) return { ok: false, error: String(st.stderr || 'git status failed').trim() };
    return { ok: true, paths: parsePorcelain(st.stdout).map((f) => f.path) };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// Insertion-ordered FIFO, capped: the session registry itself is presence
// (finished jobs linger ~60s then drop), so this only has to outlive the
// panel's probe, not the app.
function rememberBaseline(map, jobId, rec) {
  map.set(jobId, rec);
  while (map.size > BASELINE_MAX) map.delete(map.keys().next().value);
}

// Contract shape for the wire (IPC-CONTRACT.md): captured | unavailable | none.
function baselineFor(map, jobId) {
  const id = typeof jobId === 'string' ? jobId : '';
  const rec = id ? map.get(id) : null;
  if (!rec) return { state: 'none' };
  return rec.ok ? { state: 'captured', paths: rec.paths } : { state: 'unavailable', error: rec.error };
}

// init({ ipcMain, claudeSessions, send }) — main.js calls this once.
// Returns the handler map so a plain-node harness can drive the same functions
// through a fake ipcMain/claudeSessions (used by the B3 seam smoke).
function init({ ipcMain, claudeSessions, send }) {
  const push = (channel, payload) => { try { send(channel, payload); } catch { /* window closing */ } };
  const baselines = new Map();   // jobId -> {ok:true, paths} | {ok:false, error}

  const handlers = {
    'hq:session-start': (_e, opts) => {
      try {
        const { cwd, task, label } = opts || {};
        const dir = containCwd(cwd);
        if (!dir) return { error: 'cwd outside the Documents root' };
        const prompt = String(task || '').slice(0, TASK_MAX);
        if (!prompt.trim()) return { error: 'task is empty' };
        let jobId = null;   // assigned before any stdout tick can fire (data events are async)
        let sbuf = '';      // per-job stream-json line buffer (partial lines wait here)
        // BEFORE the spawn, so nothing the session writes can leak into its own
        // baseline. Discarded below if start() refuses.
        const baseline = captureBaseline(dir);
        const r = claudeSessions.start({
          label: String(label || '').trim().slice(0, LABEL_MAX) || defaultLabel(prompt),
          cwd: dir,
          args: SESSION_ARGS,
          input: prompt,                    // headless print mode reads the task from stdin
          timeoutMs: SESSION_TIMEOUT_MS,
          onOutput: (chunk) => {
            const out = parseChunk(sbuf, String(chunk));
            sbuf = out.rest;
            // ONE parse, TWO consumers: the live push (this window, now) and
            // the parsed tail (any window, after a reload). Record first — the
            // tail must be right even if the window is already gone.
            if (jobId && out.text) {
              sessionTails.record(jobId, out.text);
              push('hq:session-output', { jobId, chunk: out.text });
            }
          },
          onDone: () => {
            // Flush a trailing line that never got its newline (a killed
            // process or stderr tail) — feed the buffer a bare '\n' so it
            // parses as a complete line (JSON if valid, raw otherwise).
            if (!sbuf.trim()) { sbuf = ''; return; }
            const out = parseChunk(sbuf, '\n');
            sbuf = '';
            if (jobId && out.text) {
              sessionTails.record(jobId, out.text);   // the last line matters most on a killed run
              push('hq:session-output', { jobId, chunk: out.text });
            }
          },
        });
        if (r.error) return { error: r.error };   // nothing spawned -> the snapshot is dropped
        jobId = r.jobId;
        sessionTails.setCwd(jobId, dir);
        // CLAIM the jobId even before a line completes: this session's raw
        // registry tail is stream-json, so an empty parsed tail (which renders
        // the panes' honest "nothing reached this window" state) is the right
        // answer from tick zero, not a JSON wall.
        sessionTails.record(jobId, '');
        rememberBaseline(baselines, jobId, baseline);
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
        // `stat` is deliberately whole-tree (it is `git diff --stat`, unsplit);
        // `baseline` is what lets a caller separate this job's work from dirt
        // that predates it. Absent jobId -> {state:'none'}, never a fake empty.
        return {
          files: parsePorcelain(st.stdout),
          stat: df.status === 0 ? String(df.stdout || '').trimEnd() : '',
          baseline: baselineFor(baselines, opts?.jobId),
        };
      } catch (e) { return { error: String(e?.message || e) }; }
    },
  };

  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn);
  return handlers;
}

module.exports = { init };
