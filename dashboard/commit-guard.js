// The commit guard. hq:do-commit runs `git add -A`, so whatever is in the change
// set is committed. Plain `git status --porcelain` collapses an untracked folder
// to `dir/`, which let `dir/.env` through the old renderer-side check. Here the
// change set is listed file by file:
//   git status --porcelain -z -uall --no-renames   ∪   git diff --cached --name-only -z
// and any .env-style path is refused (.env.example / .sample / .template allowed).
// IPC-CONTRACT "Pending — v5 clean pass": hq:commit-preview(projPath) →
//   { files:[{path, status, env}], stat, envHits:[path], branch } | { error }
// Do NOT change session-api.js captureBaseline: its plain --porcelain is what the
// session-attribution baseline relies on.
//
// init({ ipcMain, resolveProjectPath }) ; exports envHits(cwd, opts?) and
// unstageAll(cwd, opts?) for hq:do-commit (before / after its `git add -A`).
//
// Paths are repo-root-relative with forward slashes, exactly as git prints them
// (porcelain ignores status.relativePaths; diff is root-relative by default) —
// which is also the scope `git add -A` stages, even when cwd is a subfolder.
// Ignored files never appear: `add -A` skips them too, so a .gitignore'd .env is
// not in the change set and is (correctly) not refused.
//
// FAIL CLOSED. envHits(cwd) returns ['<git error>'] when git cannot list the
// change set (not a repo, git missing, output over maxBuffer, …). An empty array
// there would read as "no .env found" and let do-commit's `add -A` run blind —
// the exact bypass this module exists to close. do-commit refuses on any hit.
// TIMEOUT. spawnSync blocks the whole main process, so one changeSet() shares a
// GIT_TIMEOUT_MS budget (15 s) across all its git calls; a hung git (index.lock
// wait, AV scan, network drive) ends as { error: 'git … timed out' } and envHits
// answers ['<git error>'] — the fail-closed answer, never a blind "no .env".
// opts.timeoutMs overrides the budget (tests). A spent budget skips the cosmetic
// calls (branch, stat → '') rather than blocking past it.
// Pure Node (child_process only), no Electron requires — commit-guard.test.mjs.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const GIT_MAX_BUFFER = 10 * 1024 * 1024;   // same cap as session-api.js; a monorepo's -uall list can be large
const GIT_ERROR_HIT = '<git error>';
const GIT_TIMEOUT_MS = 15000;              // whole-changeSet budget, see the header

// Two steps: ENV_RE says "env-shaped", ENV_TEMPLATE_RE takes the templates back out.
//   true : .env, .env.local, sub/.env.production, prod.env, .ENV, .env.example.local
//          (a suffix AFTER an allowed one is a real env file again), and the copies
//          people actually make of a .env — `.env - Copy` (Explorer), `.env copy`,
//          `.env (1)` (downloads), `.env~` (editors), `.env-local`, `.env_prod`,
//          `prod.env~`: after `.env`, ANY non-alphanumeric char counts, not only '.'.
//   false: .env.example/.sample/.template/.dist/.defaults (also `-`/`_` separated:
//          .env-example, .env_sample), .envrc, .environment, envoy.yaml, docs/env.md,
//          src/environment.ts, config.env.js (the `*.env` form never takes a '.'
//          suffix, so source files named x.env.ts don't block commits).
// Basename only: files inside a folder named `.env/` (a Python venv) are not hits.
const ENV_RE = /(^|\/)(\.env([^a-z0-9/][^/]*)?|[^/]+\.env([^a-z0-9./][^/]*)?)$/i;
const ENV_TEMPLATE_RE = /(^|\/)\.env[._-](example|sample|template|dist|defaults)$/i;

function isEnvPath(p) {
  if (typeof p !== 'string' || !p) return false;
  const s = p.replace(/\\/g, '/');
  return ENV_RE.test(s) && !ENV_TEMPLATE_RE.test(s);
}

// `git status --porcelain -z` output → [{path, status}]. Records are
// NUL-terminated 'XY path' with no quoting (-z). status = XY trimmed, matching
// session-api.js parsePorcelain ('??', 'M', 'A', 'MM', …). We pass --no-renames,
// so there are no two-field rename records; if one shows up anyway (R/C in XY)
// the following record is its ORIGINAL path and is consumed, not listed.
function parsePorcelainZ(out) {
  const recs = String(out || '').split('\0');
  const files = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.length < 4 || r[2] !== ' ') continue;   // trailing '' after the last NUL, or junk
    const xy = r.slice(0, 2);
    files.push({ path: r.slice(3), status: xy.trim() });
    if (/[RC]/.test(xy)) i++;                      // skip the rename/copy source path
  }
  return files;
}

function git(args, cwd, timeoutMs) {
  // timeout must stay > 0: spawnSync reads 0 as "no timeout"
  return spawnSync('git', args, { cwd, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, timeout: Math.max(1, Math.ceil(timeoutMs)) });
}
// A synthetic spawnSync-shaped timeout result for a call the budget no longer covers.
const timedOut = () => ({ error: Object.assign(new Error('git timed out'), { code: 'ETIMEDOUT' }), status: null, stdout: '', stderr: '' });
function gitFailed(r) { return !!r.error || r.status !== 0; }
function gitErr(r, what) {
  if (r.error && r.error.code === 'ETIMEDOUT') return what + ' timed out';
  if (r.error) return what + ': ' + String(r.error.message || r.error);
  return String(r.stderr || '').trim().split(/\r?\n/).filter((l) => /^(fatal|error):/i.test(l))[0] || (what + ' failed');
}

// The whole change set `git add -A` would stage, file by file. Only `.error` or
// a non-zero exit counts as failure — git writes warnings (CRLF etc.) to stderr
// on success. Returns { error } instead of throwing.
function changeSet(cwd, opts) {
  try {
    const budget = opts && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : GIT_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    const run = (args) => { const left = deadline - Date.now(); return left > 0 ? git(args, cwd, left) : timedOut(); };
    // A missing path OR a file: spawnSync's ENOENT would otherwise read as "git missing".
    let isDir = false;
    try { isDir = !!cwd && fs.statSync(cwd).isDirectory(); } catch { /* missing */ }
    if (!isDir) return { error: 'project folder not found' };
    const st = run(['status', '--porcelain', '-z', '-uall', '--no-renames']);
    if (gitFailed(st)) return { error: gitErr(st, 'git status') };
    // diff.relative=true in a repo's config would make diff print cwd-relative paths
    // (and only the cwd's subtree) — the union below needs root-relative ones.
    const cached = run(['-c', 'diff.relative=false', 'diff', '--cached', '--name-only', '-z']);   // works on an unborn HEAD too
    if (gitFailed(cached)) return { error: gitErr(cached, 'git diff --cached') };

    // Union by path. status already shows staged entries (X column); the cached
    // list is belt-and-braces, so a cached-only name is labelled plainly.
    const byPath = new Map();
    for (const f of parsePorcelainZ(st.stdout)) if (!byPath.has(f.path)) byPath.set(f.path, f.status);
    for (const p of String(cached.stdout || '').split('\0')) if (p && !byPath.has(p)) byPath.set(p, 'staged');
    const files = [...byPath].map(([path, status]) => ({ path, status, env: isEnvPath(path) }));

    // Branch: rev-parse fails (exit 128) on an unborn HEAD; symbolic-ref still
    // names the branch there. Detached HEAD → 'HEAD'. Unknown → ''.
    let branch = '';
    const rp = run(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!gitFailed(rp)) branch = String(rp.stdout || '').trim();
    else {
      const sr = run(['symbolic-ref', '--short', '-q', 'HEAD']);
      if (!gitFailed(sr)) branch = String(sr.stdout || '').trim();
    }

    // Tracked changes vs HEAD; fails on a repo with no commits yet → ''.
    const df = run(['-c', 'diff.relative=false', 'diff', 'HEAD', '--stat']);
    const stat = gitFailed(df) ? '' : String(df.stdout || '').trimEnd();

    return { files, stat, envHits: files.filter((f) => f.env).map((f) => f.path), branch };
  } catch (e) { return { error: String(e?.message || e) }; }
}

// For hq:do-commit, BEFORE `add -A`: any non-empty result means refuse.
// Fails closed — see the header (a timeout is a failure too).
function envHits(cwd, opts) {
  try {
    const cs = changeSet(cwd, opts);
    if (!cs || cs.error || !Array.isArray(cs.envHits)) return [GIT_ERROR_HIT];
    return cs.envHits;
  } catch { return [GIT_ERROR_HIT]; }
}

// For hq:do-commit, AFTER `add -A`, when the re-check refuses (an .env got staged in
// the window between envHits() and the add, or git couldn't list the index): put the
// index back to HEAD so the refusal really "stages nothing" (IPC-CONTRACT).
// A FULL `git reset -q`, not `reset -- <hits>`: the hits are repo-root-relative but a
// reset pathspec is cwd-relative, so from a subfolder project (`apps/web` → `apps/web/.env`)
// the partial reset matched nothing, exited 0 and left the secret staged. The full
// reset also drops any partial staging the user made before clicking Commit — `add -A`
// had already folded it into "everything", so nothing recoverable is lost. Mixed reset:
// the working tree (the .env file itself included) is untouched. Works on an unborn HEAD
// (the index is emptied).
// Then it re-lists the index and reports what is still staged:
//   { ok: true,  remaining: [] }                  index matches HEAD
//   { ok: false, remaining: [paths], error? }     reset failed, or something is still staged
// remaining = ['<git error>'] when the re-list itself failed. A fresh GIT_TIMEOUT_MS
// budget (opts.timeoutMs overrides): this is the safety action, it must not inherit
// a budget the checks before it spent.
function unstageAll(cwd, opts) {
  try {
    const budget = opts && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : GIT_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    const run = (args) => { const left = deadline - Date.now(); return left > 0 ? git(args, cwd, left) : timedOut(); };
    let isDir = false;
    try { isDir = !!cwd && fs.statSync(cwd).isDirectory(); } catch { /* missing */ }
    if (!isDir) return { ok: false, remaining: [GIT_ERROR_HIT], error: 'project folder not found' };
    const rs = run(['reset', '-q']);
    const ls = run(['-c', 'diff.relative=false', 'diff', '--cached', '--name-only', '-z']);
    const remaining = gitFailed(ls) ? [GIT_ERROR_HIT] : String(ls.stdout || '').split('\0').filter(Boolean);
    const out = { ok: !gitFailed(rs) && remaining.length === 0, remaining };
    if (gitFailed(rs)) out.error = gitErr(rs, 'git reset');
    else if (gitFailed(ls)) out.error = gitErr(ls, 'git diff --cached');
    return out;
  } catch (e) { return { ok: false, remaining: [GIT_ERROR_HIT], error: String(e?.message || e) }; }
}

function init({ ipcMain, resolveProjectPath }) {
  ipcMain.handle('hq:commit-preview', (_e, projPath) => {
    try {
      const cwd = resolveProjectPath(projPath);
      if (!cwd) return { error: 'path outside the workspace' };
      return changeSet(cwd);
    } catch (e) { return { error: String(e?.message || e) }; }   // never throws across IPC
  });
}

module.exports = { init, isEnvPath, envHits, changeSet, unstageAll, parsePorcelainZ, ENV_RE, ENV_TEMPLATE_RE, GIT_ERROR_HIT, GIT_TIMEOUT_MS };
