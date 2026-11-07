// The one Resume helper (Claude › Sessions, the Home strip and Claude › Chats' terminal button).
//
//   create({ hub, app?, repoRoot, env?, spawn?, platform?, log?, helper?, fsApi?, tmpdir? })
//     → { resume(id, { say? }), plan(id, { say? }), buildArgs({ id, say, mcpConfig }), cleanup(), _inflight }
//   init({ ipcMain?, hub, app, repoRoot, ... }) = create(...) + the quit hook (the board registers the IPC channel)
//
//   resume(id, { say }) → { ok: true } | { error }
//     id   — any indexed Code conversation id, bare session UUID or the Hub's 'code:<uuid>'. Main reads the folder from the
//            Hub (never from the renderer) and refuses anything claude-chat's cwdRefusal refuses, a quoted folder, and a
//            transcript Claude Code has already deleted (<HQ_CLAUDE_HOME>/projects/<folder>/<id>.jsonl must exist).
//     say  — undefined, or the fixed word 'continue' (HQ_RESUME_PROMPT); never free text.
//
// How it launches mirrors claude-launch.js: `cmd /d /v:off /c start "" cmd /d /v:off /k "<dashboard>\claude-resume.cmd"`
// in the session's own folder, with the id travelling ONLY as env HQ_RESUME_ID — no id or path is ever on a command line.
// The permission mode is always explicit (`default`): the owner's global default is auto, and a .cmd with no flag inherits
// it. auto, dontAsk, bypassPermissions and every FORBIDDEN_ARGS flag are refused by buildArgs; claude-resume.test.mjs pins
// that claude-resume.cmd carries exactly the flags buildArgs produces.
// Outside this repo (whose .mcp.json already binds the workspacehq server) the session gets the server through
// --mcp-config: one config folder per app run (fs.mkdtempSync), its mcp.json path travels as env HQ_MCP_CONFIG, and the
// quit hook removes it — never right after the spawn, which would race the new process reading it.
// HQ_DRY_LAUNCH=1 only logs. Pure Node, no Electron require.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { isSessionId, cwdRefusal, FORBIDDEN_ARGS } = require('./claude-chat');

const HELPER = path.join(__dirname, 'claude-resume.cmd');
const UNSAFE_HELPER_PATH = /["%!&|<>^()]/;
const BAD_MODES = ['auto', 'dontAsk', 'bypassPermissions', 'acceptEdits', 'plan'];
const CONTINUE_WORD = 'continue';
const LIVE_MS = 2 * 60e3;   // a chat whose last row is younger than this is still being written by a running claude
const TRANSCRIPT_GONE = 'Claude Code deleted this transcript (older than 30 days) — read it in Claude › Chats';
const WIN = process.platform === 'win32';

const norm = (p) => { let s = path.resolve(p); if (s.length > path.parse(s).root.length) s = s.replace(/[\\/]+$/, ''); return WIN ? s.toLowerCase() : s; };
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const bareId = (id) => (typeof id === 'string' ? id.replace(/^code:/, '') : id);

/** <claudeHome>/projects/<folder>/<id>.jsonl, or null when the folder name is not one plain path segment. */
function transcriptPath(claudeHome, projectId, sessionId) {
  const folder = typeof projectId === 'string' ? projectId.replace(/^code:/, '') : '';
  if (!folder || folder === '.' || folder === '..' || /[\\/\0]/.test(folder) || !isSessionId(sessionId)) return null;
  return path.join(claudeHome, 'projects', folder, sessionId + '.jsonl');
}

/** The argv claude receives (claude-resume.cmd mirrors it). Throws on anything that is not a plain, default-mode resume. */
function buildArgs({ id, say, mcpConfig } = {}) {
  if (!isSessionId(id)) throw new Error('bad session id');
  if (say !== undefined && say !== null && say !== CONTINUE_WORD) throw new Error('refused: only the word "continue" can be sent');
  const args = ['--resume', id, '--permission-mode', 'default'];
  if (say === CONTINUE_WORD) args.push(CONTINUE_WORD);
  if (mcpConfig) args.push('--mcp-config', String(mcpConfig));
  for (const a of args) {
    for (const f of FORBIDDEN_ARGS) if (a.includes(f)) throw new Error('refused: ' + f);
    if (BAD_MODES.includes(a)) throw new Error('refused: permission mode ' + a);
  }
  return args;
}

function create({ hub, app, repoRoot, env = process.env, spawn = childProcess.spawn, log = (l) => console.log(l), helper = HELPER, fsApi = fs, tmpdir = os.tmpdir(), now = () => Date.now() } = {}) {
  const inflight = new Set();
  let mcpDir = null, mcpFile = null;
  const claudeHome = () => env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude');

  function ensureMcpConfig() {
    if (mcpFile) return mcpFile;
    const server = repoRoot ? path.join(repoRoot, 'mcp', 'workspacehq', 'server.mjs') : null;
    if (!server || !fsApi.existsSync(server)) return null;
    const dir = fsApi.mkdtempSync(path.join(tmpdir, 'hq-resume-mcp-'));
    const file = path.join(dir, 'mcp.json');
    fsApi.writeFileSync(file, JSON.stringify({ mcpServers: { workspacehq: { command: 'node', args: [server] } } }, null, 1));
    mcpDir = dir; mcpFile = file;
    return file;
  }
  function cleanup() {
    const dir = mcpDir; mcpDir = null; mcpFile = null;
    if (dir) { try { fsApi.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS temp cleaner gets it */ } }
  }

  // everything resume checks before it spawns, with nothing started: { id, cwd, transcript } | { error }
  async function plan(idIn, opts = {}) {
    const id = bareId(idIn);
    if (!isSessionId(id)) return { error: 'refused: not a Claude Code session id' };
    if (opts.say !== undefined && opts.say !== null && opts.say !== CONTINUE_WORD) return { error: 'refused: only the word "continue" can be sent' };
    if (!hub || typeof hub.request !== 'function') return { error: 'Claude Hub isn’t running — nothing to resume from' };
    let r;
    try { r = await hub.request('getConversation', { id: 'code:' + id, limit: 1 }); }
    catch (e) { return { error: 'Claude Hub couldn’t answer · ' + String((e && e.message) || e).slice(0, 160) }; }
    const c = r && r.conversation;
    if (!c || c.source !== 'code') return { error: 'refused: that is not an indexed Claude Code chat' };
    // A chat that wrote a row a moment ago is open in a live terminal: a second claude on the same transcript would interleave into it.
    // (The board offers Resume only after 30 quiet minutes; the Chats button has no such gate, so main enforces the floor.)
    const lastMs = Date.parse(c.last_at);
    if (Number.isFinite(lastMs) && now() - lastMs < LIVE_MS) return { error: 'refused: that chat was active a moment ago — close its window first, then try again' };
    const cwd = c.cwd;
    const why = cwdRefusal(cwd, env);
    if (why) return { error: 'refused: the folder is ' + why };
    if (/["\x00-\x1f\x7f]/.test(cwd)) return { error: 'refused: the folder path has a quote or control character' };
    try { if (!fsApi.statSync(cwd).isDirectory()) return { error: 'that folder is not a folder any more' }; }
    catch { return { error: 'that folder no longer exists' }; }
    const transcript = transcriptPath(claudeHome(), c.project_id, id);
    if (!transcript || !fsApi.existsSync(transcript)) return { error: TRANSCRIPT_GONE };
    return { id, cwd, transcript };
  }

  async function resume(idIn, opts = {}) {
    const key = bareId(idIn);
    if (inflight.has(key)) return { error: 'a resume of this session is already starting' };
    inflight.add(key);
    try {
      const p = await plan(idIn, opts);
      if (p.error) return { error: p.error };
      if (UNSAFE_HELPER_PATH.test(helper) || !fsApi.existsSync(helper)) return { error: 'the resume helper is missing or at an unsafe path — not launching' };
      let mcp = null;
      if (!(repoRoot && within(norm(p.cwd), norm(repoRoot)))) {
        try { mcp = ensureMcpConfig(); } catch (e) { log('[claude-resume] mcp config skipped: ' + String((e && e.message) || e)); }
        if (mcp && /["\x00-\x1f]/.test(mcp)) mcp = null;
      }
      const say = opts.say === CONTINUE_WORD ? CONTINUE_WORD : undefined;
      let args;
      try { args = buildArgs({ id: p.id, say, mcpConfig: mcp }); } catch (e) { return { error: String((e && e.message) || e) }; }
      if (env.HQ_DRY_LAUNCH === '1') { log('[dry-resume] ' + p.cwd + ' :: claude ' + args.join(' ')); return { ok: true, dry: true }; }
      const childEnv = { ...env, HQ_RESUME_ID: p.id };
      delete childEnv.HQ_RESUME_PROMPT; delete childEnv.HQ_MCP_CONFIG;
      if (say) childEnv.HQ_RESUME_PROMPT = CONTINUE_WORD;
      if (mcp) childEnv.HQ_MCP_CONFIG = mcp;
      try {
        const child = spawn('cmd.exe', ['/d /v:off /c start "" cmd /d /v:off /k "' + helper + '"'],
          { cwd: p.cwd, env: childEnv, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
        if (typeof child.unref === 'function') child.unref();
      } catch (e) { return { error: 'Couldn’t open a terminal · ' + String((e && e.message) || e).slice(0, 160) }; }
      return { ok: true };
    } finally { inflight.delete(key); }
  }

  return { resume, plan, buildArgs, cleanup, _inflight: inflight, _mcpFile: () => mcpFile };
}

function init(opts = {}) {
  const r = create(opts);
  const { app } = opts;
  if (app && typeof app.on === 'function') { app.on('before-quit', r.cleanup); app.on('will-quit', r.cleanup); }
  return r;
}

module.exports = { create, init, buildArgs, transcriptPath, HELPER, TRANSCRIPT_GONE, CONTINUE_WORD };
