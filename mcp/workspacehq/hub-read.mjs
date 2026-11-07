// mcp/workspacehq/hub-read.mjs
// Recall from past Claude chats for the workspacehq MCP server (recall dish, commit 3). Reads the Claude Hub index
// (data/claude/hub.sqlite) READ-ONLY, under the node that runs the MCP server, opens it per call and closes it after.
// It never writes the index and works with the app closed. Errors are errors, never empty lists.
//
// Two reads, both answered from user and assistant text only (tool rows, subagent turns and forgotten chats never
// come back; Instagram / Facebook never):
//   hubRecall({ q, scope?, project?, source?, limit? })   ranked snippets
//   hubChatRead({ id, scope?, limit? })                    the last turns of one chat
// 'here' (default) keeps chats whose working folder is inside the session's own folder (ctx.cwd, which Claude Code
// sets to the session's folder for the MCP server); 'all' reads every folder.
//
// Every string returned is masked again on the way out (old index rows can hold what the rules of their day missed).
// Caveat the tool descriptions repeat: raw text stays in the index's full-text table, so searching for a secret
// string can still find its row, and a secret written in plain prose with no label can still slip through.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSecrets } from '../../dashboard/claude-hub/redact.mjs';
import { maskSnippet, maskText } from '../../dashboard/claude-hub/redact-more.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const SNIPPET_MAX = 240;
export const TURN_MAX = 1500;
export const TURNS_TOTAL_MAX = 24000;
const PER_CHAT = 2;          // hits per chat: one long session can't fill the answer
const PAGE = 200;            // FTS rows per page; pages are read until the scope / project filter has `limit` hits or the ranking runs dry
const MAX_PAGES = 50;        // a hard stop (10,000 matching rows); a search that reaches it says so in its note
const SOURCES = ['code', 'web'];

export class HubReadError extends Error {}   // a clean refusal; the server turns it into an isError answer

// ---- masking (both rule sets; redact.mjs may or may not carry EXTRA_RULES yet, masking twice is harmless) --------------
const mask = (s) => maskText(s, (t) => maskSecrets(t));
const maskSnip = (s) => maskSnippet(s, (t) => maskSecrets(t));
// one line, no control characters (snippet markers included), ≤ n code points
function flat(s, n) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cps = [...t];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : t;
}
// turn text keeps its line breaks; control characters other than \n and \t go
function block(s, n) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g, ' ').trim();
  const cps = [...t];
  return cps.length > n ? { text: cps.slice(0, n - 1).join('') + '…', cut: true } : { text: t, cut: false };
}

// ---- scope: is a chat's working folder inside the session's folder? ----------------------------------------------------
const norm = (p, ci) => {
  let s = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (s.length > 1) s = s.replace(/\/$/, '');
  return ci ? s.toLowerCase() : s;
};
export function insideFolder(cwd, folder, ci = process.platform === 'win32') {
  if (!cwd || !folder) return false;
  const c = norm(cwd, ci), f = norm(folder, ci);
  return c === f || c.startsWith(f.endsWith('/') ? f : f + '/');
}
// The index holds chats recorded under 8.3 short paths (C:\Users\ROGSTR~1\...) and long ones. When the strings say "outside",
// both sides are resolved to their real long form (fs.realpathSync.native, a path that no longer exists stays as written)
// and compared again. ctx.realpath is a test seam.
export function makeInScope(ctx = {}) {
  const folder = ctx.cwd || process.cwd();
  const ci = ctx.caseInsensitive == null ? process.platform === 'win32' : !!ctx.caseInsensitive;
  const real = ctx.realpath || ((p) => fs.realpathSync.native(p));
  const cache = new Map();
  const resolve = (p) => {
    if (!p) return p;
    if (!cache.has(p)) { let r = p; try { r = real(p) || p; } catch { /* gone or unreadable: keep as written */ } cache.set(p, r); }
    return cache.get(p);
  };
  return (cwd) => {
    if (!cwd) return false;
    if (insideFolder(cwd, folder, ci)) return true;
    return insideFolder(resolve(cwd), resolve(folder), ci);
  };
}

// ---- opening the index -------------------------------------------------------------------------------------------------
const emsg = (e) => String((e && e.message) || e).slice(0, 240);
async function loadStoreModule(ctx) {
  if (ctx.storeModule) return ctx.storeModule;
  try { return await (ctx.importStore ? ctx.importStore() : import('../../dashboard/claude-hub/store.mjs')); }
  catch (e) {
    if (e && (e.code === 'ERR_UNKNOWN_BUILTIN_MODULE' || /node:sqlite/.test(emsg(e)))) {
      throw new HubReadError('this Node (' + process.version + ') has no node:sqlite — the chat index needs Node 22.13 or newer on PATH');
    }
    throw new HubReadError('could not load the chat index reader: ' + emsg(e));
  }
}

function dbFileOf(ctx) {
  const env = ctx.env || process.env;
  return ctx.dbFile || env.HQ_CLAUDE_DB || path.join(ROOT, 'data', 'claude', 'hub.sqlite');
}

// an assistant row's tool-call stub lines ('[tool: Name hint]', one per line); the words around them stay
const stripStubs = (t) => String(t == null ? '' : t).split('\n').filter((l) => !l.startsWith('[tool:')).join('\n');

const NO_INDEX = 'no chat index yet — open WorkspaceHQ once, it builds the index';

// opens read-only, runs fn(store), closes in every case. Any failure is a HubReadError that says what to do.
async function withStore(ctx, fn) {
  const file = dbFileOf(ctx);
  if (!fs.existsSync(file)) throw new HubReadError(NO_INDEX);
  const mod = await loadStoreModule(ctx);
  let store;
  try { store = mod.openStore(file, { readOnly: true }); }
  catch (e) {
    const m = emsg(e);
    if (/newer WorkspaceHQ/.test(m)) throw new HubReadError('the chat index was written by a newer WorkspaceHQ — update this MCP server: ' + m);
    if (/locked|busy/i.test(m)) throw new HubReadError('the chat index is locked by another process — try again in a moment');
    throw new HubReadError('could not open the chat index: ' + m);
  }
  try { return await fn(store, mod); }
  catch (e) {
    if (e instanceof HubReadError) throw e;
    const m = emsg(e);
    if (/locked|busy/i.test(m)) throw new HubReadError('the chat index is locked by another process — try again in a moment');
    throw new HubReadError('the chat index could not be read: ' + m);
  } finally { try { store.close(); } catch { /* already closed */ } }
}

// ---- argument checks ---------------------------------------------------------------------------------------------------
function scopeOf(a) {
  const s = a.scope == null ? 'here' : a.scope;
  if (s !== 'here' && s !== 'all') throw new HubReadError("scope must be 'here' or 'all'");
  return s;
}
const limitOf = (v, dflt, max) => {
  if (v == null) return dflt;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) throw new HubReadError('limit must be a whole number from 1 to ' + max);
  return Math.min(max, n);
};

// conversation id -> { cwd } for a set of ids (chunked: SQLite caps the number of bound parameters)
function cwdsOf(store, ids) {
  const out = new Map();
  const all = [...ids];
  for (let i = 0; i < all.length; i += 100) {
    const part = all.slice(i, i + 100);
    for (const r of store.db.prepare('SELECT id, cwd FROM conversation WHERE id IN (' + part.map(() => '?').join(',') + ')').all(...part)) out.set(r.id, r.cwd);
  }
  return out;
}

// ---- hq_recall ---------------------------------------------------------------------------------------------------------
export async function hubRecall(args, ctx = {}) {
  const a = args && typeof args === 'object' ? args : {};
  if (typeof a.q !== 'string' || !a.q.trim()) throw new HubReadError('q is required: the words to look for in past chats');
  const scope = scopeOf(a);
  const source = a.source == null ? 'code' : a.source;
  if (!SOURCES.includes(source)) throw new HubReadError("source must be 'code' (Claude Code chats, the default) or 'web' (claude.ai chats)");
  const project = a.project == null ? '' : String(a.project).trim().toLowerCase();
  const limit = limitOf(a.limit, DEFAULT_LIMIT, MAX_LIMIT);

  return withStore(ctx, (store, mod) => {
    const match = mod.ftsQuery(a.q);
    if (!match) throw new HubReadError('q has no searchable words (letters or digits)');
    const c = store.db.prepare("SELECT COUNT(*) AS n, MAX(last_at) AS lastAt FROM conversation WHERE source = ? AND forgotten = 0").get(source);
    const indexed = { source, conversations: c.n, lastAt: c.lastAt || null };
    // claude.ai chats carry no working folder, so the folder scope can never match one: say so instead of scanning for nothing
    if (source === 'web' && scope === 'here') {
      return { hits: [], scope, indexed, note: 'claude.ai chats carry no working folder, so scope "here" never matches them — retry with scope "all".' };
    }
    const inScope = makeInScope(ctx);
    const inProject = (r) => !project || String(r.projectName || '').toLowerCase().includes(project);

    // The scope and project filters apply AFTER the ranking, so read the ranking page by page until `limit` hits are kept or it
    // runs dry (a single top-200 read would lose in-folder chats ranked below 200 chats from other folders).
    const seen = new Map(), hits = [], elsewhere = new Set();
    let exhausted = false, pages = 0;
    scan: while (pages < MAX_PAGES) {
      const page = store.contextHits({ match, limit: PAGE, offset: pages * PAGE, sources: [source], skipToolStubs: true });
      pages++;
      if (page.length < PAGE) exhausted = true;
      const rows = page.filter((r) => r.role === 'user' || r.role === 'assistant');   // contextHits also admits 'other' (people in the social rows)
      const cwds = scope === 'all' ? null : cwdsOf(store, new Set(rows.map((r) => r.conversationId)));
      for (const r of rows) {
        if (!inProject(r)) continue;
        if (cwds && !inScope(cwds.get(r.conversationId))) { elsewhere.add(r.conversationId); continue; }
        const n = seen.get(r.conversationId) || 0;
        if (n >= PER_CHAT) continue;
        seen.set(r.conversationId, n + 1);
        hits.push({
          conversationId: r.conversationId, title: flat(mask(r.title || ''), 120) || '(untitled)', project: flat(mask(r.projectName || ''), 120),
          at: r.at || null, role: r.role, snippet: flat(maskSnip(r.snippet), SNIPPET_MAX),
        });
        if (hits.length >= limit) break scan;
      }
      if (exhausted) break;
    }

    let note = null;
    if (!hits.length) {
      const partial = exhausted ? '' : ' Only the best ' + (pages * PAGE) + ' matching lines were searched; narrow q.';
      if (!c.n) note = 'The index holds no ' + (source === 'web' ? 'claude.ai' : 'Claude Code') + ' chats yet.';
      else if (scope === 'here' && elsewhere.size) note = 'No match in chats from this folder; ' + elsewhere.size + (exhausted ? '' : '+') + ' chat(s) elsewhere match — retry with scope "all".' + partial;
      else if (scope === 'here' && !project) note = 'No match in chats from this folder. Retry with scope "all" to search every folder.' + partial;
      else note = 'No match.' + partial;
    }
    return { hits, scope, indexed, note };
  });
}

// ---- hq_chat_read ------------------------------------------------------------------------------------------------------
export async function hubChatRead(args, ctx = {}) {
  const a = args && typeof args === 'object' ? args : {};
  if (typeof a.id !== 'string' || !a.id.trim() || a.id.length > 200) throw new HubReadError('id is required: a conversationId from hq_recall');
  const scope = scopeOf(a);
  const limit = limitOf(a.limit, DEFAULT_LIMIT, MAX_LIMIT);

  return withStore(ctx, (store) => {
    const got = store.getConversation({ id: a.id.trim(), limit: 500 });
    const c = got && got.conversation;
    if (!c || !SOURCES.includes(c.source)) throw new HubReadError('no such chat in the index: ' + flat(a.id, 80));
    if (scope === 'here' && !makeInScope(ctx)(c.cwd)) {
      throw new HubReadError(c.source === 'web' ? "claude.ai chats carry no working folder — pass scope 'all' to read it" : "that chat is from another folder — pass scope 'all' to read it");
    }
    // newest first: take turns until the count or the character budget runs out
    // tool-call stubs ('[tool: Bash ...]') are commands, not talk: their lines go, and a turn left with no words is skipped
    const mine = got.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.is_sidechain)
      .map((m) => ({ ...m, text: m.tool_name ? stripStubs(m.text) : m.text })).filter((m) => String(m.text == null ? '' : m.text).trim());
    const picked = [];
    let used = 0, more = got.hasMore || false;
    for (let i = mine.length - 1; i >= 0; i--) {
      if (picked.length >= limit) { more = true; break; }
      const b = block(mask(mine[i].text), TURN_MAX);
      if (used + b.text.length > TURNS_TOTAL_MAX) { more = true; break; }
      if (b.cut) more = true;
      used += b.text.length;
      picked.push({ role: mine[i].role, at: mine[i].at || null, text: b.text });
    }
    return { id: c.id, title: flat(mask(c.title || ''), 160) || '(untitled)', turns: picked.reverse(), more };
  });
}
