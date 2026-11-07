// Sessions board, main side (Claude › Sessions, the Home strip). Spec: every Claude Code session of the last 24 hours, where
// each one stopped, this week's limit stops, one-click Resume. No new data file: it reads the Claude Hub index (which watches
// ~/.claude/projects) and, for the Codex lane, ~/.codex/session_index.jsonl (titles and times only, no transcripts).
//
//   create({ hub, now?, env?, fsApi?, claudeHome?, codexHome? }) → { poll(), read(), openTarget(id), stop() }
//   init({ ipcMain, app, hub, getWins, shell, appLog?, repoRoot, intervalMs?, now?, env?, spawn? }) → the same + { resumer }
//     IPC: hq:sessions-board:read → { board } | { error }
//          hq:sessions-board:resume (id, { say? }) → { ok } | { error }    (dashboard/claude-resume.js owns every refusal)
//          hq:sessions-board:open-folder (id) → { ok } | { error }        (only the cwd of a session that is on the board)
//          push hq:sessions-board ← the board, only when its signature changed
//
// Every 30 s: listConversations({source:'code', since: now − 7 d, limit: 40}) and listProjects once; getConversation(limit 8) only
// for rows whose last_at changed (cached by id and last_at). The classification (dashboard/sessions-core.mjs, pure) is redone
// on every tick from the cached turns, so a session that went quiet since the last Hub change is noticed without a Hub call.
// A Hub error never blanks the board: it keeps the last sessions, marks them read-only and says when they are from.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let coreP = null, redactP = null;
const core = () => coreP || (coreP = import(pathToFileURL(path.join(__dirname, 'sessions-core.mjs')).href));
const redact = () => redactP || (redactP = import(pathToFileURL(path.join(__dirname, 'claude-hub', 'redact.mjs')).href));

const POLL_MS = 30e3, LIST_LIMIT = 40, HUB_TIMEOUT = 8000, CODEX_MAX_BYTES = 8 * 1024 * 1024, CODEX_RECENT = 3;
const STARTING = /not open|starting|not ready|booting|initiali[sz]ing/i;
const msg = (e) => String((e && e.message) || e).slice(0, 200);
const isoOf = (v) => {
  if (v == null || v === '') return null;
  let ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) { const n = Number(v); ms = n < 1e12 ? n * 1000 : n; }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

function create({ hub, now = () => Date.now(), env = process.env, fsApi = fs, claudeHome, codexHome } = {}) {
  const home = () => claudeHome || env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude');
  const cHome = () => codexHome || env.HQ_CODEX_HOME || path.join(os.homedir(), '.codex');
  const turnCache = new Map();        // conversation id -> { lastAt, turns }
  let lastBoard = null, lastGood = null, polling = null;
  let cwds = new Map();               // session uuid -> cwd (private: never in the board)
  const stats = { listCalls: 0, projectCalls: 0, convCalls: 0, codexReads: 0 };
  let codexCache = { mtimeMs: null, size: null, value: null };

  // Codex: titles and times only. A missing, unreadable or oversized index is no lane — never an error.
  async function readCodex() {
    const file = path.join(cHome(), 'session_index.jsonl');
    let st;
    try { st = fsApi.statSync(file); } catch { codexCache = { mtimeMs: null, size: null, value: null }; return null; }
    if (!st.isFile() || st.size > CODEX_MAX_BYTES) return null;
    if (codexCache.mtimeMs === st.mtimeMs && codexCache.size === st.size) return codexCache.value;
    let text;
    try { text = fsApi.readFileSync(file, 'utf8'); } catch { return null; }
    stats.codexReads++;
    const threads = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (!j || typeof j !== 'object') continue;
      const at = isoOf(j.updated_at);
      threads.push({ title: typeof j.thread_name === 'string' ? j.thread_name : '', updatedAt: at });
    }
    let value = null;
    if (threads.length) {
      const { maskSecrets } = await redact();
      threads.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      const dated = threads.filter((t) => t.updatedAt);
      value = { count: threads.length, lastAt: dated.length ? dated[0].updatedAt : null,
        recent: threads.slice(0, CODEX_RECENT).map((t) => ({ title: maskSecrets(t.title).text.slice(0, 120) || '(untitled thread)', updatedAt: t.updatedAt })) };
    }
    codexCache = { mtimeMs: st.mtimeMs, size: st.size, value };
    return value;
  }

  const readOnly = (board, why) => {
    for (const s of board.sessions) { s.canResume = false; s.why = why; }
    return board;
  };

  async function compute() {
    const L = await core();
    const nowMs = now();
    const ask = (op, args) => hub.request(op, args, { timeout: HUB_TIMEOUT });
    let rows, projArr;
    try {
      if (!hub || typeof hub.request !== 'function') throw new Error('Claude Hub is not running');
      stats.listCalls++;
      rows = await ask('listConversations', { source: 'code', since: new Date(nowMs - L.WEEK_MS).toISOString(), limit: LIST_LIMIT });
      stats.projectCalls++;
      projArr = await ask('listProjects', { source: 'code' });
      if (!Array.isArray(rows) || !Array.isArray(projArr)) throw new Error('Claude Hub answered with something unexpected');
    } catch (e) {
      const error = msg(e);
      if (lastGood) return readOnly({ ...lastGood, sessions: lastGood.sessions.map((s) => ({ ...s })), state: STARTING.test(error) ? 'starting' : 'hub-down', error }, 'Claude Hub isn’t running');
      return { ...L.buildBoard({ rows: [], now: nowMs, state: STARTING.test(error) ? 'starting' : 'hub-down', error }), codex: await readCodex().catch(() => null) };
    }
    const projects = {};
    for (const p of projArr) if (p && p.id) projects[p.id] = p;
    const details = {};
    const seen = new Set();
    for (const r of rows) {
      if (!r || !r.id) continue;
      seen.add(r.id);
      const c = turnCache.get(r.id);
      if (!c || c.lastAt !== r.last_at) {
        try {
          stats.convCalls++;
          const got = await ask('getConversation', { id: r.id, limit: L.TURN_LIMIT });
          turnCache.set(r.id, { lastAt: r.last_at, turns: got && Array.isArray(got.messages) ? got.messages : [] });
        } catch { if (!c) turnCache.set(r.id, { lastAt: null, turns: [] }); }   // one unreadable session never fails the board; retried next tick
      }
      details[r.id] = (turnCache.get(r.id) || {}).turns || [];
    }
    for (const id of [...turnCache.keys()]) if (!seen.has(id)) turnCache.delete(id);
    const codex = await readCodex().catch(() => null);
    const board = L.buildBoard({ rows, details, projects, now: nowMs, codex });
    // the transcript Resume reads may be gone (Claude Code keeps 30 days): say so on the card instead of failing on click
    const { transcriptPath, TRANSCRIPT_GONE } = require('./claude-resume');
    const byId = new Map(rows.map((r) => [r.native_id || String(r.id).replace(/^code:/, ''), r]));
    const nextCwds = new Map();
    for (const s of board.sessions) {
      const r = byId.get(s.id);
      if (r && r.cwd) nextCwds.set(s.id, r.cwd);
      if (s.canResume) {
        const t = r && transcriptPath(home(), r.project_id, s.id);
        if (!t || !fsApi.existsSync(t)) { s.canResume = false; s.why = TRANSCRIPT_GONE; }
      }
    }
    cwds = nextCwds;
    lastGood = board;
    return board;
  }

  function poll() {
    if (polling) return polling;
    polling = compute().then((b) => { lastBoard = b; return b; }).finally(() => { polling = null; });
    return polling;
  }
  async function read() {
    try { return { board: lastBoard || (await poll()) }; } catch (e) { return { error: msg(e) }; }
  }

  // the cwd of a session that is on the board — nothing else can be opened
  function openTarget(id) {
    const cwd = typeof id === 'string' ? cwds.get(id) : undefined;
    if (!cwd || !lastBoard || !lastBoard.sessions.some((s) => s.id === id)) return { error: 'refused: that session is not on the board' };
    if (!path.isAbsolute(cwd)) return { error: 'refused: not an absolute path' };
    try {
      if (fsApi.lstatSync(cwd).isSymbolicLink()) return { error: 'refused: that folder is a link' };
      if (!fsApi.statSync(cwd).isDirectory()) return { error: 'that is not a folder any more' };
    } catch { return { error: 'that folder no longer exists' }; }
    return { cwd };
  }

  return { poll, read, openTarget, stats, _board: () => lastBoard, stop() { turnCache.clear(); } };
}

function init({ ipcMain, app, hub, getWins, shell, appLog, repoRoot, intervalMs = POLL_MS, now, env = process.env, spawn } = {}) {
  const board = create({ hub, now, env });
  const log = (line) => { try { if (typeof appLog === 'function') appLog(line); } catch { /* logging never fails a handler */ } };
  const resumer = require('./claude-resume').init({ hub, app, repoRoot, env, ...(spawn ? { spawn } : {}), log });
  let sig = null;
  const tick = async () => {
    try {
      const L = await core();
      const b = await board.poll();
      const s = L.boardSignature(b);
      if (s !== sig) {
        sig = s;
        for (const w of (getWins ? getWins() : [])) { try { if (w && !w.isDestroyed()) w.webContents.send('hq:sessions-board', b); } catch { /* a window mid-teardown */ } }
      }
    } catch (e) { log('[sessions-board] poll failed · ' + msg(e)); }
  };
  ipcMain.handle('hq:sessions-board:read', () => board.read());
  ipcMain.handle('hq:sessions-board:resume', async (_e, id, opts) => {
    try { return await resumer.resume(id, { say: opts && typeof opts === 'object' ? opts.say : undefined }); }
    catch (e) { return { error: msg(e) }; }
  });
  ipcMain.handle('hq:sessions-board:open-folder', async (_e, id) => {
    const t = board.openTarget(id);
    if (t.error) return t;
    try { const r = await shell.openPath(t.cwd); return r ? { error: String(r) } : { ok: true }; }   // shell.openPath never runs anything
    catch (e) { return { error: msg(e) }; }
  });
  const timer = intervalMs > 0 ? setInterval(tick, intervalMs) : null;
  if (timer && timer.unref) timer.unref();
  tick();
  return { ...board, resumer, tick, stop() { if (timer) clearInterval(timer); board.stop(); } };
}

module.exports = { create, init, POLL_MS };
