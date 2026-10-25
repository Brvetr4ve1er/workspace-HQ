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

// --- Task 3: where a turn runs (spec §8 cwd rule). Ids are only ever compared with === against
// Hub / scan rows; a path is never built from an id. cwdRefusal runs on recorded paths too.
const SEED_SPEAKER = { user: 'Owner', assistant: 'Claude' };
async function resolveTarget(req, { hub, getProjects, isDir, env = process.env } = {}) {
  const r = req && typeof req === 'object' ? req : {};
  const text = typeof r.text === 'string' ? r.text : '';
  if (!text.trim()) return { error: 'empty message' };
  if (text.length > PROMPT_MAX) return { error: `message is over ${PROMPT_MAX} characters` };
  if (typeof r.mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, r.mode)) return { error: 'unknown mode' };
  const convId = typeof r.conversationId === 'string' && r.conversationId ? r.conversationId : null;
  const projId = typeof r.projectId === 'string' && r.projectId ? r.projectId : null;
  if (!convId && !projId) return { error: 'pick a project or a chat' };
  const hubErr = (x) => (x && typeof x === 'object' && !Array.isArray(x) && x.error ? { error: 'Claude Hub: ' + x.error } : null);
  const place = (cwd, rest) => {
    const why = cwdRefusal(cwd, env);
    if (why) return { error: `refused folder (${why})` };
    if (!isDir(cwd)) return { error: 'the folder no longer exists' };
    return { cwd, ...rest };
  };
  const hqPath = (id) => { const p = (getProjects() || []).find((x) => x && x.id === id); return p ? p.path : null; };
  const projectCwd = async (id) => {
    if (id.startsWith('code:')) {
      const rows = await hub('listProjects', { source: 'code' });
      if (hubErr(rows)) return hubErr(rows);
      const p = (Array.isArray(rows) ? rows : []).find((x) => x && x.id === id);
      return p && p.path ? { path: p.path } : { error: 'unknown Claude Code project' };
    }
    const p = hqPath(id);
    return p ? { path: p } : { error: 'unknown WorkspaceHQ project, or its folder is outside Documents' };
  };

  if (convId) {
    const got = await hub('getConversation', { id: convId, limit: 1 });
    if (hubErr(got)) return hubErr(got);
    const c = got && got.conversation;
    if (!c || c.id !== convId) return { error: 'that chat is not in the index (forgotten, or not indexed yet)' };
    if (c.source === 'code') {
      if (!isSessionId(c.native_id)) return { error: 'this chat has no resumable Claude Code session id' };
      return place(c.cwd, { sessionId: c.native_id, key: c.id, prompt: text, seeded: null });
    }
    // claude.ai (H4 rows): a NEW Code chat, seeded with the chat's text (spec §8)
    let dest;
    if (projId) dest = await projectCwd(projId);
    else {
      const rows = await hub('listProjects', {});
      if (hubErr(rows)) return hubErr(rows);
      const p = (Array.isArray(rows) ? rows : []).find((x) => x && x.id === c.project_id);
      const path0 = p && p.hq_project_id ? hqPath(p.hq_project_id) : null;
      dest = path0 ? { path: path0 } : { error: 'link this claude.ai project to a WorkspaceHQ project first (Claude › Projects)' };
    }
    if (dest.error) return dest;
    const full = await hub('getConversation', { id: convId, limit: 500 });
    if (hubErr(full)) return hubErr(full);
    const body = (full && Array.isArray(full.messages) ? full.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text)
      .map((m) => `${SEED_SPEAKER[m.role]}: ${m.text}`).join('\n\n');
    const s = seedPrompt({ title: c.title, text: body, message: text });
    return place(dest.path, { sessionId: null, key: c.id, prompt: s.prompt, seeded: { chars: s.chars, trimmed: s.trimmed } });
  }
  const dest = await projectCwd(projId);
  if (dest.error) return dest;
  return place(dest.path, { sessionId: null, key: null, prompt: text, seeded: null });
}

module.exports = { MODES, FORBIDDEN_ARGS, PROMPT_MAX, SEED_MAX, TURN_MS, MAX_TURNS, isSessionId, buildArgs, cwdRefusal, seedPrompt, resolveTarget };
