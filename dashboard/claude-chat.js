'use strict';
// Claude Hub H3 (spec 2026-10-13 §8) — the in-app chat engine. One `claude -p … stream-json`
// process per turn, prompt on stdin, in a folder this file resolves itself. Pure core first
// (argv, deny list, seed); target resolution, the runner and init() follow (Tasks 3, 4, 6).
// Never bypass: only `plan` and `acceptEdits` exist here; claude-chat.test.mjs pins it.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const cp = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { parseEvents } = require('./stream-parse');

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

// --- Task 4: the runner. One process per turn; exactly one end event per turn.
const EVENT = 'hq:claude-chat:event';
const NOT_FOUND = 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)';
const UNSAFE = /["%!^&|<>]/;
function resolveClaudeBin(env = process.env, { exists = fs.existsSync } = {}) {
  const pick = (p) => (UNSAFE.test(p) ? { error: 'unsafe Claude Code path' } : { cmd: p, viaCmd: /\.(cmd|bat)$/i.test(p) });
  const forced = env.HQ_CLAUDE_BIN;
  if (forced) return path.isAbsolute(forced) && exists(forced) ? pick(forced) : { error: NOT_FOUND };
  for (const dir of String(env.PATH || env.Path || '').split(';')) {
    if (!dir.trim()) continue;
    for (const name of ['claude.exe', 'claude.cmd']) {
      const p = path.join(dir.trim(), name);
      if (exists(p)) return pick(p);
    }
  }
  return { error: NOT_FOUND };
}

// Launcher-safe tree stop (main.js stopGitTree's rule): children of the launcher first, then the root's tree.
function killTree(pid, { spawnSync = cp.spawnSync, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } return; }
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }`],
    { windowsHide: true, timeout: 15000 });
  } catch { /* best effort */ }
  try { spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, timeout: 15000 }); } catch { /* best effort */ }
}

function createChat({ resolve, bin, spawnFn = cp.spawn, kill = killTree, send = () => {}, log = null, env = process.env,
  turnMs = TURN_MS, maxTurns = MAX_TURNS, graceMs = 5000 } = {}) {
  const turns = new Map();   // turnId -> turn
  let seq = 0;
  const FULL = `${maxTurns} Claude turns are already running — wait for one or press Stop`;
  const BUSY = 'this chat already has a turn running — wait for it or press Stop';
  const push = (d) => { try { send(EVENT, d); } catch { /* window gone */ } };
  const keyBusy = (key) => key != null && [...turns.values()].some((t) => t.key === key);

  function end(t, payload) {
    if (t.ended) return;
    t.ended = true;
    clearTimeout(t.timer); clearTimeout(t.grace);
    turns.delete(t.id);
    if (payload.kind === 'error' && log) try { log.error('claude-chat', payload.error); } catch { /* logging never breaks a turn */ }
    push({ turnId: t.id, ...payload });
  }
  function stop(t) {
    if (t.killed) return;
    t.killed = true;
    kill(t.proc.pid);
    t.grace = setTimeout(() => finish(t, null), graceMs);
    if (t.grace.unref) t.grace.unref();
  }
  function finish(t, code) {
    if (t.ended) return;
    if (t.timedOut) return end(t, { kind: 'error', error: `stopped after ${Math.max(1, Math.round(turnMs / 60000))} min` });
    if (t.spawnError) return end(t, { kind: 'error', error: 'could not start Claude Code: ' + t.spawnError });
    const r = t.result;
    if (r || t.stopped) {
      if (r && !r.isError && !t.sawDelta && r.result) push({ turnId: t.id, kind: 'delta', text: r.result });
      return end(t, { kind: 'done', sessionId: (r && r.sessionId) || t.sessionId || null, mode: t.mode, usage: r ? r.usage : null,
        isError: !!(r && r.isError), subtype: r ? r.subtype : '', result: r && r.isError ? r.result : '', stopped: !!t.stopped });
    }
    const last = t.err.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
    end(t, { kind: 'error', error: `Claude Code exited with code ${code}` + (last ? ': ' + last.slice(0, 300) : '') });
  }
  function onEvents(t, events) {
    for (const e of events) {
      if (t.ended) return;
      if (e.kind === 'session') { t.sessionId = e.sessionId; push({ turnId: t.id, kind: 'session', sessionId: e.sessionId, mode: t.mode }); }
      else if (e.kind === 'delta') { t.sawDelta = true; push({ turnId: t.id, kind: 'delta', text: e.text }); }
      else if (e.kind === 'raw') push({ turnId: t.id, kind: 'delta', text: e.text + '\n' });
      else if (e.kind === 'tool') push({ turnId: t.id, kind: 'tool', name: e.name, hint: e.hint });
      else if (e.kind === 'result') t.result = e;
    }
  }

  async function sendTurn(req) {
    if (turns.size >= maxTurns) return { error: FULL };
    const target = await resolve(req);
    if (!target || target.error) return { error: (target && target.error) || 'no target' };
    const b = bin();
    if (!b || b.error) return { error: (b && b.error) || NOT_FOUND };
    if (keyBusy(target.key)) return { error: BUSY };
    if (turns.size >= maxTurns) return { error: FULL };
    const args = buildArgs({ mode: req.mode, sessionId: target.sessionId });
    const opts = { cwd: target.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    const id = 'ct-' + Date.now().toString(36) + '-' + (++seq);
    const t = { id, key: target.key, mode: req.mode, sessionId: target.sessionId || null, proc: null, buf: '', err: '',
      dec: new StringDecoder('utf8'), decErr: new StringDecoder('utf8'), sawDelta: false, result: null, stopped: false, killed: false, timedOut: false, spawnError: null, ended: false, timer: null, grace: null };
    try {
      t.proc = b.viaCmd
        ? spawnFn(env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `""${b.cmd}" ${args.join(' ')}"`], { ...opts, windowsVerbatimArguments: true })
        : spawnFn(b.cmd, args, opts);
    } catch (e) { return { error: 'could not start Claude Code: ' + String((e && e.message) || e) }; }
    turns.set(id, t);
    t.proc.stdout.on('data', (chunk) => { const r = parseEvents(t.buf, t.dec.write(chunk)); t.buf = r.rest; onEvents(t, r.events); });
    t.proc.stderr.on('data', (chunk) => { t.err = (t.err + t.decErr.write(chunk)).slice(-2000); });
    t.proc.on('error', (e) => { t.spawnError = String((e && e.message) || e); finish(t, -1); });
    t.proc.on('close', (code) => {
      if (t.buf.trim()) { const r = parseEvents(t.buf, '\n'); t.buf = ''; onEvents(t, r.events); }
      finish(t, code);
    });
    t.proc.stdin.on('error', () => { /* the process died first; close reports it */ });
    try { t.proc.stdin.write(target.prompt); t.proc.stdin.end(); } catch { /* close reports it */ }
    t.timer = setTimeout(() => { t.timedOut = true; stop(t); }, turnMs);
    if (t.timer.unref) t.timer.unref();
    const out = { turnId: id };
    if (target.sessionId) out.sessionId = target.sessionId;
    if (target.seeded) out.seeded = target.seeded;
    return out;
  }

  return {
    send: sendTurn,
    cancel(turnId) {
      const t = turns.get(turnId);
      if (!t || t.ended) return false;
      t.stopped = true;
      stop(t);
      return true;
    },
    stopAll() { for (const t of [...turns.values()]) { t.stopped = true; stop(t); } },
    running: () => turns.size,
  };
}

module.exports = { EVENT, resolveClaudeBin, killTree, createChat, MODES, FORBIDDEN_ARGS, PROMPT_MAX, SEED_MAX, TURN_MS, MAX_TURNS, isSessionId, buildArgs, cwdRefusal, seedPrompt, resolveTarget };
