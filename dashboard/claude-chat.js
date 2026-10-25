'use strict';
// Claude Hub H3 (spec 2026-10-13 §8) — the in-app chat engine. One `claude -p … stream-json`
// process per turn, prompt on stdin, in a folder this file resolves itself. Pure core first
// (argv, deny list, seed); target resolution, the runner and init() follow (Tasks 3, 4, 6).
// Never bypass: only `plan` and `acceptEdits` exist here; claude-chat.test.mjs pins it.
const path = require('node:path');
const os = require('node:os');

const MODES = Object.freeze({ 'read-only': 'plan', edits: 'acceptEdits' });
const FORBIDDEN_ARGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions'];
const PROMPT_MAX = 100000;      // stdin cap (plan deviation: a pasted log must not become megabytes of quota)
const SEED_MAX = 30000;         // spec §8: claude.ai seed
const TURN_MS = 10 * 60 * 1000; // spec §8: hard cap per turn
const MAX_TURNS = 3;            // spec §8: at most 3 at once
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSessionId(s) { return typeof s === 'string' && SESSION_RE.test(s); }

function buildArgs({ mode, sessionId = null } = {}) {
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, mode)) throw new Error('unknown mode');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-prompts', 'none', '--permission-mode', MODES[mode]];
  if (sessionId != null) {
    if (!isSessionId(sessionId)) throw new Error('bad session id');
    args.push('--resume', sessionId);
  }
  for (const a of args) for (const f of FORBIDDEN_ARGS) if (a.includes(f)) throw new Error('refused: ' + f);
  return args;
}

const WIN = process.platform === 'win32';
function norm(p) {
  let s = path.resolve(p);
  if (s.length > path.parse(s).root.length) s = s.replace(/[\\/]+$/, '');
  return WIN ? s.toLowerCase() : s;
}
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function cwdRefusal(dir, env = process.env) {
  if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir) || /^[a-z]:$/i.test(dir)) return 'not an absolute folder';
  if (/^[\\/]{2}/.test(dir)) return 'a network or device path';
  const d = norm(dir);
  if (d === norm(path.parse(path.resolve(dir)).root)) return 'a drive root';
  if (within(d, norm(env.SystemRoot || env.windir || 'C:\\Windows'))) return 'the Windows folder';
  for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]) if (pf && within(d, norm(pf))) return 'Program Files';
  const home = env.USERPROFILE || os.homedir();
  if (home && d === norm(home)) return 'your user folder itself';
  return null;
}

function seedPrompt({ title, text, message } = {}) {
  let body = String(text == null ? '' : text);
  const trimmed = body.length > SEED_MAX;
  if (trimmed) {
    body = body.slice(body.length - SEED_MAX);
    if (/^[\uDC00-\uDFFF]/.test(body)) body = body.slice(1);   // never start on half a surrogate pair
  }
  const name = String(title || '').trim() || 'Untitled chat';
  const head = `Context: a claude.ai conversation titled "${name}", copied into Claude Code by WorkspaceHQ`
    + (trimmed ? ` (trimmed to its last ${SEED_MAX} characters)` : '');
  return { prompt: `${head}\n\n${body}\n\n---\n\n${String(message == null ? '' : message)}`, chars: body.length, trimmed };
}

module.exports = { MODES, FORBIDDEN_ARGS, PROMPT_MAX, SEED_MAX, TURN_MS, MAX_TURNS, isSessionId, buildArgs, cwdRefusal, seedPrompt };
