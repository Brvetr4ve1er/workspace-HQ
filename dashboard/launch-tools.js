// What a quest / project launch carries: the workspacehq tools and an explicit permission mode.
//
//   create({ repoRoot, tmpdir?, fsApi?, env?, log?, now?, platform? })
//     → { prepare(cwd, { dry? }), buildArgs({ prompt, mcpConfig, mode? }), cleanup(), sweepStale(), _files() }
//
//   prepare(cwd) → { mcpConfig: <path to mcp.json> | null }
//     null when cwd is inside repoRoot (the repo's own .mcp.json already binds the server; a second server of the same
//     name would double-register), when mcp/workspacehq/server.mjs is missing, when the temp path holds a quote or a
//     control character, or when the folder could not be written. Otherwise ONE fresh fs.mkdtempSync(<tmp>/hq-launch-mcp-)
//     folder PER LAUNCH holding mcp.json { mcpServers: { workspacehq: { command: 'node', args: [<absolute server path>] } } }.
//     { dry: true } (or env.HQ_DRY_LAUNCH === '1') answers the same question and writes NOTHING: the returned path is where
//     a real launch would have put its file.
//   buildArgs({ prompt, mcpConfig, mode }) → [prompt, '--permission-mode', mode, ('--mcp-config', file)]
//     the argv claude receives (claude-launch-tools.cmd mirrors it). The prompt is first, --mcp-config is LAST (it is
//     variadic and would swallow a positional that came after it). Throws on any argument holding a FORBIDDEN_ARGS entry,
//     on the modes auto / dontAsk / bypassPermissions and on any mode but default / acceptEdits / plan. The sanitizing of
//     the prompt stays claude-launch.js's; the helper .cmd is pinned to LAUNCH_MODE ('default') until the owner answers
//     the open question about wider modes.
//   dryLine(cwd, prompt, args) → '[dry-launch] <cwd> :: <prompt> :: --permission-mode default [--mcp-config <tmp>]'
//   cleanup() / sweepStale() both remove ONLY hq-launch-mcp-* folders older than 24 h (cleanup runs from before-quit,
//     sweepStale at startup). A folder is never removed right after the spawn, nor at quit just because this run made it:
//     a launched claude terminal can outlive the app and re-read its config when it reconnects its server.
//
// Neither ~/.claude nor ~/.claude.json is touched: the config is per launch and travels as --mcp-config.
// Pure Node, injected IO, no Electron require.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FORBIDDEN_ARGS } = require('./claude-chat');

const HELPER = path.join(__dirname, 'claude-launch-tools.cmd');
const PREFIX = 'hq-launch-mcp-';
const FOLDER_RE = /^hq-launch-mcp-[A-Za-z0-9_-]+$/;
const STALE_MS = 24 * 3600e3;
const LAUNCH_MODE = 'default';
const ALLOWED_MODES = Object.freeze(['default', 'acceptEdits', 'plan']);
const BAD_MODES = Object.freeze(['auto', 'dontAsk', 'bypassPermissions']);
const UNSAFE_PATH = /["\x00-\x1f\x7f]/;

function create({ repoRoot, tmpdir = os.tmpdir(), fsApi = fs, env = process.env, log = () => {}, now = () => Date.now(), platform = process.platform } = {}) {
  const win = platform === 'win32';
  const pathApi = win ? path.win32 : path.posix;
  const created = [];

  const norm = (p) => {
    let s = pathApi.resolve(String(p));
    if (s.length > pathApi.parse(s).root.length) s = s.replace(/[\\/]+$/, '');
    return win ? s.toLowerCase() : s;
  };
  const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(pathApi.sep) ? parent : parent + pathApi.sep);

  function inRepo(cwd) {
    if (!repoRoot) return false;
    try { return within(norm(cwd), norm(repoRoot)); } catch { return false; }
  }

  function prepare(cwd, opts = {}) {
    const none = { mcpConfig: null };
    if (typeof cwd !== 'string' || !cwd) return none;
    if (inRepo(cwd)) return none;
    if (!repoRoot) return none;
    const server = path.join(repoRoot, 'mcp', 'workspacehq', 'server.mjs');
    try { if (!fsApi.existsSync(server)) return none; } catch { return none; }
    if (UNSAFE_PATH.test(String(tmpdir)) || UNSAFE_PATH.test(server)) return none;
    const dry = opts.dry === true || (env && env.HQ_DRY_LAUNCH === '1');
    if (dry) return { mcpConfig: path.join(tmpdir, PREFIX + 'dry', 'mcp.json') };
    let dir;
    try {
      dir = fsApi.mkdtempSync(path.join(tmpdir, PREFIX));
      const file = path.join(dir, 'mcp.json');
      if (UNSAFE_PATH.test(file)) { try { fsApi.rmSync(dir, { recursive: true, force: true }); } catch { /* swept later */ } return none; }
      fsApi.writeFileSync(file, JSON.stringify({ mcpServers: { workspacehq: { command: 'node', args: [server] } } }, null, 1));
      created.push(file);
      return { mcpConfig: file };
    } catch (e) {
      log('[launch-tools] could not write an MCP config · ' + String((e && e.message) || e).slice(0, 160));
      if (dir) { try { fsApi.rmSync(dir, { recursive: true, force: true }); } catch { /* swept later */ } }
      return none;
    }
  }

  function buildArgs({ prompt, mcpConfig, mode = LAUNCH_MODE } = {}) {
    if (BAD_MODES.includes(mode)) throw new Error('refused: permission mode ' + mode);
    if (!ALLOWED_MODES.includes(mode)) throw new Error('refused: permission mode ' + String(mode));
    if (mcpConfig && (typeof mcpConfig !== 'string' || UNSAFE_PATH.test(mcpConfig))) throw new Error('refused: bad MCP config path');
    const args = [String(prompt == null ? '' : prompt), '--permission-mode', mode];
    if (mcpConfig) args.push('--mcp-config', mcpConfig);
    for (const a of args) for (const f of FORBIDDEN_ARGS) if (a.includes(f)) throw new Error('refused: ' + f);
    return args;
  }

  function dryLine(cwd, prompt, args) {
    const a = Array.isArray(args) ? args : [];
    const rest = a.slice(1).map((x) => String(x));   // everything after the prompt
    return `[dry-launch] ${cwd} :: ${prompt} :: ${rest.join(' ')}`;
  }

  // removes hq-launch-mcp-* folders older than 24 h, nothing else; returns how many went
  function sweepStale() {
    let removed = 0;
    let names;
    try { names = fsApi.readdirSync(tmpdir); } catch { return 0; }
    const t = now();
    for (const name of names) {
      if (!FOLDER_RE.test(name)) continue;
      const full = path.join(tmpdir, name);
      try {
        const st = fsApi.lstatSync(full);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        if (!(t - st.mtimeMs > STALE_MS)) continue;
        fsApi.rmSync(full, { recursive: true, force: true });
        removed++;
      } catch { /* the OS temp cleaner gets it */ }
    }
    return removed;
  }

  return { prepare, buildArgs, dryLine, cleanup: sweepStale, sweepStale, _files: () => created.slice() };
}

module.exports = { create, HELPER, PREFIX, STALE_MS, LAUNCH_MODE, ALLOWED_MODES, BAD_MODES };
