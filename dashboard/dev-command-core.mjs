// The dev command as an argument list (batch 9, dish "dev command as an argv array"). PURE: no file, no process, no clock.
//
// A scan records a dev command as text (`projects[].dev_cmd`, for example "npm run dev"). That text is a suggestion and is NEVER handed
// to a shell. This file turns it into a list of words, one runner at a time, and refuses everything it does not know:
//
//   npm run <name> | npm start | pnpm run <name> | pnpm dev | yarn <name> | bun run <name> | node <relative file>
//
// <name> is lower case letters, digits, colon, underscore and dash, never starting with a dash. The only suffix is `--port <digits>`
// (with `--` in front of it as written, which npm needs). A node file is relative, uses forward slashes, has no `..`, no drive letter,
// no leading slash and ends in .js .mjs or .cjs. There is no generic character filter: a word either fits its runner's shape or the
// whole line is refused.
//
//   parseDevCommand(text)  -> { ok:true, runner, words, scripts, port? } | { ok:false, why }   (why is one of WHY, a fixed word)
//   devKey(parts)          -> 64 hex chars: what an owner's "Allow" is bound to (folder, the scripts involved, the runner config files)
//   hashShown(text)        -> 8 hex chars: the hash of the command text the owner was shown (mirrored by dashboard-v5/src/logic/dev-allow.mjs)
//   ENV_ALLOW              -> the environment variable names a dev server child may inherit
import { createHash } from 'node:crypto';

export const WORDS = Object.freeze({ started: 'started', running: 'running', unconfirmed: 'unconfirmed', refused: 'refused', busy: 'busy' });
export const ALLOW_WORDS = Object.freeze({ allowed: 'allowed', changed: 'changed', refused: 'refused', busy: 'busy' });
export const FORGET_WORDS = Object.freeze({ removed: 'removed', none: 'none', refused: 'refused', busy: 'busy' });
export const WHY = Object.freeze({ empty: 'empty', long: 'long', control: 'control', runner: 'runner', shape: 'shape', option: 'option', name: 'name', file: 'file', suffix: 'suffix' });

export const MAX_LINE = 200;
export const MAX_WORDS = 8;
export const ID_RE = /^[a-z0-9._-]{1,64}$/;
const NAME_RE = /^[a-z0-9:_-]+$/;
const DIGITS_RE = /^[0-9]{1,5}$/;
const FILE_RE = /^[A-Za-z0-9._/-]+$/;
// words that start something other than "run this project's own script"
const REFUSED_WORDS = new Set(['npx', 'bunx', 'exec', 'dlx', 'init', 'install']);
const REFUSED_OPTIONS = ['-e', '-p', '--eval', '--print', '--require', '-r', '--import', '--loader', '--experimental-loader', '--script-shell', '--shell'];
// yarn's own commands: `yarn <name>` must be a script, never one of these
const YARN_BUILTINS = new Set(['add', 'remove', 'up', 'upgrade', 'upgrade-interactive', 'link', 'unlink', 'publish', 'config', 'cache', 'global', 'set', 'create', 'node', 'plugin', 'patch', 'rebuild', 'npm', 'workspace', 'workspaces', 'bin', 'why', 'run', 'version', 'import', 'pack', 'dedupe', 'info', 'login', 'logout', 'owner', 'tag', 'team', 'access', 'audit', 'autoclean', 'check', 'generate-lock-entry', 'licenses', 'list', 'outdated', 'policies', 'unplug', 'constraints', 'stage', 'start', 'test', 'help']);

export const ENV_ALLOW = Object.freeze([
  'PATH', 'PATHEXT', 'SystemRoot', 'windir', 'COMSPEC', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'ALLUSERSPROFILE',
  'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'COMPUTERNAME', 'LANG', 'PNPM_HOME', 'NVM_HOME', 'NVM_SYMLINK', 'VOLTA_HOME', 'FNM_MULTISHELL_PATH',
]);

const fail = (why) => ({ ok: false, why });

function portSuffix(rest) {
  // rest: the words after the base command. [] | ['--port', N] | ['--', '--port', N]
  if (!rest.length) return { ok: true };
  const r = rest[0] === '--' ? rest.slice(1) : rest;
  if (r.length === 2 && r[0] === '--port' && DIGITS_RE.test(r[1])) {
    const n = Number(r[1]);
    if (n >= 1 && n <= 65535) return { ok: true, port: n };
  }
  return { ok: false };
}

function checkName(name) {
  if (!name || name.startsWith('-') || !NAME_RE.test(name)) return false;
  return true;
}

export function checkNodeFile(file) {
  if (typeof file !== 'string' || !file || file.startsWith('-') || file.startsWith('/') || file.startsWith('\\') || file.includes(':') || file.includes('\\')) return false;
  if (!FILE_RE.test(file)) return false;
  const segs = file.split('/');
  if (segs.some((s) => !s || s === '.' || s === '..')) return false;
  return /\.(c|m)?js$/.test(file);
}

export function parseDevCommand(text) {
  if (typeof text !== 'string') return fail(WHY.empty);
  if (/[\u0000-\u001f\u007f]/.test(text)) return fail(WHY.control);
  const line = text.trim();
  if (!line) return fail(WHY.empty);
  if (line.length > MAX_LINE) return fail(WHY.long);
  const words = line.split(/ +/);
  if (words.length > MAX_WORDS) return fail(WHY.shape);
  for (const w of words) {
    const lw = w.toLowerCase();
    if (REFUSED_WORDS.has(lw)) return fail(WHY.runner);
    if (REFUSED_OPTIONS.some((o) => lw === o || lw.startsWith(o + '='))) return fail(WHY.option);
  }
  const [runner, a, b] = words;
  let scripts = null, base = 0, nodeFile = null;
  if (runner === 'npm') {
    if (a === 'run') { if (!checkName(b)) return fail(WHY.name); scripts = b; base = 3; }
    else if (a === 'start') { scripts = 'start'; base = 2; }
    else return fail(WHY.shape);
  } else if (runner === 'pnpm') {
    if (a === 'run') { if (!checkName(b)) return fail(WHY.name); scripts = b; base = 3; }
    else if (a === 'dev') { scripts = 'dev'; base = 2; }
    else return fail(WHY.shape);
  } else if (runner === 'yarn') {
    if (!checkName(a) || YARN_BUILTINS.has(a)) return fail(WHY.name);
    scripts = a; base = 2;
  } else if (runner === 'bun') {
    if (a !== 'run') return fail(WHY.shape);
    if (!checkName(b)) return fail(WHY.name);
    scripts = b; base = 3;
  } else if (runner === 'node') {
    if (!checkNodeFile(a)) return fail(WHY.file);
    nodeFile = a; base = 2;
  } else return fail(WHY.runner);
  const suffix = portSuffix(words.slice(base));
  if (!suffix.ok) return fail(WHY.suffix);
  const out = { ok: true, runner, words, scripts: scripts ? [scripts, 'pre' + scripts, 'post' + scripts] : [] };
  if (nodeFile) out.file = nodeFile;
  if (suffix.port) out.port = suffix.port;
  return out;
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// parts: { folder, words, scripts: { name: string|null }, rc: { file: string|null } }. Key order is fixed so the same inputs hash the same.
export function devKey(parts) {
  const p = parts || {};
  const sortedObj = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k] == null ? null : String(o[k])]);
  return sha256(JSON.stringify({ v: 1, folder: String(p.folder || ''), words: Array.isArray(p.words) ? p.words.map(String) : [], scripts: sortedObj(p.scripts), rc: sortedObj(p.rc) }));
}

// FNV-1a over the UTF-16 code units, 8 hex chars. The renderer computes the same thing from the text it shows (src/logic/dev-allow.mjs).
export function hashShown(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// A store entry read from disk: only a well-formed one survives.
export function cleanEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (!Array.isArray(e.words) || e.words.length < 1 || e.words.length > MAX_WORDS || !e.words.every((w) => typeof w === 'string' && w.length <= MAX_LINE)) return null;
  if (typeof e.key !== 'string' || !/^[0-9a-f]{64}$/.test(e.key)) return null;
  const at = typeof e.confirmedAt === 'string' && Number.isFinite(Date.parse(e.confirmedAt)) ? e.confirmedAt : null;
  if (!at) return null;
  return { words: e.words.slice(), key: e.key, confirmedAt: at };
}
