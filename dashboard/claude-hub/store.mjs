// dashboard/claude-hub/store.mjs
// Claude Hub store (spec §4): one SQLite file with FTS5, owned by the Hub process
// on system Node ≥ 22.5. The Electron main process never opens it.
// node:sqlite binds numbers/strings/null only — booleans become 0/1, undefined → null.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import promptNote from '../claude-prompt-note.js';
const { variablesOf } = promptNote;

// Stable identity of a history.jsonl line (session + timestamp + indexed text): survives rotation/truncation, unlike the byte-offset id.
export const historyLineKey = (sessionId, at, text) => crypto.createHash('sha1').update([String(sessionId), String(at ?? ''), String(text)].join('|')).digest('hex');

export const SCHEMA_VERSION = 2;
export const HARVEST_POOL_MAX = 20000;   // P2: newest user messages / history lines the harvest looks at (each)
export const SNIP_START = '\u0002';
export const SNIP_END = '\u0003';
const ACTIVE_GAP_MS = 5 * 60 * 1000;
const TITLE_RANK = { custom: 4, web: 4, ai: 3, 'first-prompt': 1 };
const n = (v) => (v === undefined ? null : v);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS project(id TEXT PRIMARY KEY, source TEXT NOT NULL, key TEXT NOT NULL, name TEXT, path TEXT,
  hq_project_id TEXT, link_state TEXT NOT NULL DEFAULT 'none', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS conversation(id TEXT PRIMARY KEY, source TEXT NOT NULL, project_id TEXT, native_id TEXT NOT NULL,
  title TEXT, title_source TEXT, started_at TEXT, last_at TEXT, message_count INTEGER NOT NULL DEFAULT 0,
  cwd TEXT, git_branch TEXT, model TEXT, tokens_in INTEGER, tokens_out INTEGER, tokens_cache_read INTEGER,
  tokens_cache_write INTEGER, active_ms INTEGER NOT NULL DEFAULT 0, forgotten INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS conversation_project ON conversation(project_id, last_at);
CREATE INDEX IF NOT EXISTS conversation_last ON conversation(last_at);
CREATE TABLE IF NOT EXISTS message(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, native_id TEXT, parent_id TEXT,
  role TEXT NOT NULL, at TEXT, text TEXT NOT NULL DEFAULT '', tool_name TEXT, is_sidechain INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS message_conv ON message(conversation_id, at);
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(text, content='message', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS message_ai AFTER INSERT ON message BEGIN
  INSERT INTO message_fts(rowid, text) VALUES (new.rowid, new.text); END;
CREATE TRIGGER IF NOT EXISTS message_ad AFTER DELETE ON message BEGIN
  INSERT INTO message_fts(message_fts, rowid, text) VALUES ('delete', old.rowid, old.text); END;
CREATE TRIGGER IF NOT EXISTS message_au AFTER UPDATE OF text ON message BEGIN
  INSERT INTO message_fts(message_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO message_fts(rowid, text) VALUES (new.rowid, new.text); END;
CREATE TABLE IF NOT EXISTS usage(conversation_id TEXT NOT NULL, api_id TEXT NOT NULL, tin INTEGER NOT NULL DEFAULT 0,
  tout INTEGER NOT NULL DEFAULT 0, tcr INTEGER NOT NULL DEFAULT 0, tcw INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id, api_id));
CREATE TABLE IF NOT EXISTS ingest_cursor(file TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
  offset INTEGER NOT NULL, head TEXT, session_id TEXT);
CREATE TABLE IF NOT EXISTS web_sync(kind TEXT NOT NULL, native_id TEXT NOT NULL, updated_at TEXT, PRIMARY KEY(kind, native_id));
CREATE TABLE IF NOT EXISTS tombstone(kind TEXT NOT NULL, native_id TEXT NOT NULL, at TEXT, PRIMARY KEY(kind, native_id));
CREATE TABLE IF NOT EXISTS document(id TEXT PRIMARY KEY, source TEXT NOT NULL, path TEXT, title TEXT, text TEXT NOT NULL DEFAULT '',
  project_id TEXT, project_path TEXT, mtime_ms INTEGER, size INTEGER, meta TEXT);
CREATE INDEX IF NOT EXISTS document_source ON document(source, mtime_ms);
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(title, text, content='document', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS document_ai AFTER INSERT ON document BEGIN
  INSERT INTO document_fts(rowid, title, text) VALUES (new.rowid, coalesce(new.title, ''), new.text); END;
CREATE TRIGGER IF NOT EXISTS document_ad AFTER DELETE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, text) VALUES ('delete', old.rowid, coalesce(old.title, ''), old.text); END;
CREATE TRIGGER IF NOT EXISTS document_au AFTER UPDATE OF title, text ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, text) VALUES ('delete', old.rowid, coalesce(old.title, ''), old.text);
  INSERT INTO document_fts(rowid, title, text) VALUES (new.rowid, coalesce(new.title, ''), new.text); END;
CREATE TABLE IF NOT EXISTS prompt_use(prompt_id TEXT NOT NULL, at TEXT NOT NULL, target TEXT NOT NULL, project_id TEXT, conversation_id TEXT);
CREATE INDEX IF NOT EXISTS prompt_use_prompt ON prompt_use(prompt_id, at);
`;

export function ftsQuery(q) {
  const terms = String(q || '').normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) || [];
  if (!terms.length) return null;
  return terms.slice(0, 8).map((t) => '"' + t + '"*').join(' ');   // every term prefix-matches
}

// Schema 1 → 2 is purely additive (new tables), so the migration is the CREATE IF NOT EXISTS script plus the stamp, in one
// transaction. The version is read FIRST: a newer db is refused before any DDL touches it.
function migrate(db) {
  const hasMeta = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  const row = hasMeta ? db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() : undefined;
  if (row && Number(row.value) > SCHEMA_VERSION) throw new Error('hub.sqlite is from a newer WorkspaceHQ (schema ' + row.value + ')');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA);
    if (!row) db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    else if (Number(row.value) < SCHEMA_VERSION) db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ } throw e; }
}

export function openStore(file, { readOnly = false, indexVersion = null } = {}) {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (readOnly) {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
      if (row && Number(row.value) > SCHEMA_VERSION) throw new Error('hub.sqlite is from a newer WorkspaceHQ (schema ' + row.value + ')');
    } else {
      if (file !== ':memory:') { db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA synchronous = NORMAL'); }
      db.exec('PRAGMA secure_delete = ON');   // forget/reset zero the freed pages: forgotten text does not linger in the file
      const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
      migrate(db);
      if (fresh && indexVersion !== null) db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('index_version', ?)").run(String(indexVersion));
    }
    return api(db);
  } catch (e) {
    try { db.close(); } catch { /* already closed */ }   // a refused open must not leave the file locked
    throw e;
  }
}

// P1: list rows carry the parsed meta (all sources) and, for prompt notes, their {{variables}}; the text itself stays out
function docRow(r) {
  const { meta_json: mj, prompt_text: pt, ...rest } = r;
  let meta = null;
  try { meta = mj ? JSON.parse(mj) : null; } catch { meta = null; }
  const out = { ...rest, meta };
  if (rest.source === 'prompt') out.variables = variablesOf(meta, pt);
  return out;
}

function api(db) {
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
  };
  const st = {
    getConv: q('SELECT * FROM conversation WHERE id = ?'),
    upProject: q(`INSERT INTO project(id, source, key, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET path = COALESCE(excluded.path, project.path),
      name = CASE WHEN excluded.path IS NOT NULL THEN excluded.name ELSE project.name END, updated_at = excluded.updated_at`),
    upConv: q(`INSERT INTO conversation(id, source, project_id, native_id, cwd, git_branch, model) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project_id = COALESCE(conversation.project_id, excluded.project_id),
      cwd = COALESCE(conversation.cwd, excluded.cwd), git_branch = COALESCE(excluded.git_branch, conversation.git_branch),
      model = COALESCE(excluded.model, conversation.model)`),
    setTitle: q('UPDATE conversation SET title = ?, title_source = ? WHERE id = ?'),
    insMsg: q(`INSERT OR IGNORE INTO message(id, conversation_id, native_id, parent_id, role, at, text, tool_name, is_sidechain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updAgg: q('UPDATE conversation SET message_count = message_count + ?, started_at = ?, last_at = ?, active_ms = ? WHERE id = ?'),
    upUsage: q(`INSERT INTO usage(conversation_id, api_id, tin, tout, tcr, tcw) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, api_id) DO UPDATE SET tin = MAX(usage.tin, excluded.tin), tout = MAX(usage.tout, excluded.tout),
      tcr = MAX(usage.tcr, excluded.tcr), tcw = MAX(usage.tcw, excluded.tcw)`),
    sumUsage: q('SELECT COUNT(*) AS n, SUM(tin) AS tin, SUM(tout) AS tout, SUM(tcr) AS tcr, SUM(tcw) AS tcw FROM usage WHERE conversation_id = ?'),
    setTokens: q('UPDATE conversation SET tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ? WHERE id = ?'),
    delMsgs: q('DELETE FROM message WHERE conversation_id = ?'),
    delUsage: q('DELETE FROM usage WHERE conversation_id = ?'),
    delConv: q('DELETE FROM conversation WHERE id = ?'),
    getCursor: q('SELECT * FROM ingest_cursor WHERE file = ?'),
    setCursor: q(`INSERT INTO ingest_cursor(file, size, mtime_ms, offset, head, session_id) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, offset = excluded.offset,
      head = excluded.head, session_id = excluded.session_id`),
    delCursor: q('DELETE FROM ingest_cursor WHERE file = ?'),
    // P2 harvest pool. turns = assistant messages after the prompt in the same chat by (at, id), counted up to 21 ("more than 20").
    poolMsgs: q(`SELECT m.id, m.conversation_id AS cid, m.at, m.text, c.source, p.name AS project,
        (SELECT COUNT(*) FROM (SELECT 1 FROM message a WHERE a.conversation_id = m.conversation_id AND a.role = 'assistant'
          AND (a.at > m.at OR (a.at = m.at AND a.id > m.id)) LIMIT 21)) AS turns
      FROM message m JOIN conversation c ON c.id = m.conversation_id LEFT JOIN project p ON p.id = c.project_id
      WHERE m.role = 'user' AND m.is_sidechain = 0 AND m.tool_name IS NULL AND c.forgotten = 0
        AND c.source IN ('code', 'web', 'chatgpt') AND length(m.text) >= 120
      ORDER BY m.at DESC, m.id DESC LIMIT ?`),
    poolHist: q(`SELECT d.id, d.text, d.project_path, json_extract(d.meta, '$.sessionId') AS sid, json_extract(d.meta, '$.at') AS at,
        json_extract(d.meta, '$.pasted') AS pasted, json_extract(d.meta, '$.project') AS proj,
        (SELECT COUNT(*) FROM (SELECT 1 FROM message a WHERE a.conversation_id = 'code:' || json_extract(d.meta, '$.sessionId')
          AND a.role = 'assistant' AND a.at > json_extract(d.meta, '$.at') LIMIT 21)) AS turns
      FROM document d
      WHERE d.source = 'history' AND length(d.text) >= 120 AND json_valid(d.meta)
        AND NOT EXISTS (SELECT 1 FROM tombstone t WHERE t.kind = 'conversation' AND t.native_id = 'code:' || json_extract(d.meta, '$.sessionId'))
      ORDER BY at DESC, d.id DESC LIMIT ?`),
    promptBodies: q("SELECT text FROM document WHERE source = 'prompt' ORDER BY id"),
    hiddenCands: q("SELECT native_id FROM tombstone WHERE kind = 'candidate' ORDER BY native_id"),
    tomb: q('INSERT OR IGNORE INTO tombstone(kind, native_id, at) VALUES (?, ?, ?)'),
    isTomb: q('SELECT 1 AS x FROM tombstone WHERE kind = ? AND native_id = ?'),
    getMeta: q('SELECT value FROM meta WHERE key = ?'),
    setMeta: q('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    countP: q('SELECT COUNT(*) AS c FROM project'),
    countC: q('SELECT COUNT(*) AS c FROM conversation WHERE forgotten = 0 AND message_count > 0'),
    countM: q('SELECT COUNT(*) AS c FROM message'),
    convsOfProject: q('SELECT id FROM conversation WHERE project_id = ?'),
    delProject: q('DELETE FROM project WHERE id = ?'),
  };

  const removeConversation = (c) => { st.delMsgs.run(c.id); st.delUsage.run(c.id); st.delConv.run(c.id); };

  return {
    db, tx,
    upsertProject(p) {
      const now = new Date().toISOString();
      st.upProject.run(p.id, p.source, p.key, n(p.name), n(p.path), now, now);
    },
    ensureConversation(c) {
      st.upConv.run(c.id, c.source, n(c.projectId), c.nativeId, n(c.cwd), n(c.gitBranch), n(c.model));
    },
    setTitle(id, title, source) {
      const cur = st.getConv.get(id);
      const t = String(title || '').trim();
      if (!cur || !t) return false;
      if (source === 'first-prompt' && cur.title) return false;
      if ((TITLE_RANK[source] || 0) < (TITLE_RANK[cur.title_source] || 0)) return false;
      st.setTitle.run(t, source, id);
      return true;
    },
    addMessages(conversationId, msgs) {
      const conv = st.getConv.get(conversationId);
      if (!conv) throw new Error('unknown conversation ' + conversationId);
      let inserted = 0, first = conv.started_at, last = conv.last_at, active = conv.active_ms;
      const sorted = [...msgs].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      for (const m of sorted) {
        const r = st.insMsg.run(m.id, conversationId, n(m.nativeId), n(m.parentId), m.role, n(m.at), String(m.text || ''), n(m.toolName), m.isSidechain ? 1 : 0);
        if (!r.changes) continue;
        inserted++;
        const t = m.at ? Date.parse(m.at) : NaN;
        if (Number.isFinite(t)) {
          if (last) { const gap = t - Date.parse(last); if (gap > 0 && gap < ACTIVE_GAP_MS) active += gap; }
          if (!first || m.at < first) first = m.at;
          if (!last || m.at > last) last = m.at;
        }
      }
      if (inserted) st.updAgg.run(inserted, n(first), n(last), active, conversationId);
      return inserted;
    },
    addUsage(conversationId, apiId, u) {
      if (!apiId || !u) return;
      const v = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
      st.upUsage.run(conversationId, apiId, v(u.in), v(u.out), v(u.cacheRead), v(u.cacheWrite));
    },
    refreshTokens(conversationId) {
      const s = st.sumUsage.get(conversationId);
      if (s && s.n > 0) st.setTokens.run(s.tin, s.tout, s.tcr, s.tcw, conversationId);
    },
    resetConversation(id) { const c = st.getConv.get(id); if (c) removeConversation(c); },
    resetCode() {
      tx(() => { db.exec("DELETE FROM message WHERE conversation_id LIKE 'code:%'"); db.exec("DELETE FROM usage WHERE conversation_id LIKE 'code:%'");
        db.exec("DELETE FROM conversation WHERE source = 'code'"); db.exec('DELETE FROM ingest_cursor'); });
    },
    getCursor: (file) => st.getCursor.get(file),
    setCursor: (c) => st.setCursor.run(c.file, c.size, Math.floor(c.mtimeMs), c.offset, n(c.head), n(c.sessionId)),
    deleteCursor: (file) => st.delCursor.run(file),
    getSync(kind, nativeId) {
      const r = q('SELECT updated_at FROM web_sync WHERE kind = ? AND native_id = ?').get(kind, nativeId);
      return r ? { updated_at: r.updated_at } : undefined;   // plain object (node:sqlite rows are null-prototype)
    },
    setSync: (kind, nativeId, updatedAt) => q(`INSERT INTO web_sync(kind, native_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(kind, native_id) DO UPDATE SET updated_at = excluded.updated_at`).run(kind, nativeId, n(updatedAt)),
    setProjectName: (id, name) => q('UPDATE project SET name = ?, updated_at = ? WHERE id = ?').run(String(name), new Date().toISOString(), id),
    syncState() {
      const map = (kind) => Object.fromEntries(q('SELECT native_id, updated_at FROM web_sync WHERE kind = ? ORDER BY native_id').all(kind).map((r) => [r.native_id, r.updated_at ?? null]));
      const forgotten = q("SELECT native_id FROM tombstone WHERE kind = 'conversation' AND native_id LIKE 'web:%' ORDER BY native_id").all().map((r) => r.native_id.slice(4));
      return { conversations: map('conversation'), projects: map('project'), forgotten };
    },
    dropTombstones: (kind, prefix) => q('DELETE FROM tombstone WHERE kind = ? AND substr(native_id, 1, length(?)) = ?').run(kind, prefix, prefix).changes,
    isTombstoned: (kind, nativeId) => !!st.isTomb.get(kind, nativeId),
    harvestPool({ limit = HARVEST_POOL_MAX } = {}) {
      const n = Math.max(1, Math.min(Math.floor(Number(limit)) || HARVEST_POOL_MAX, HARVEST_POOL_MAX));
      const realSid = (v) => typeof v === 'string' && v !== 'nosession' && /^[A-Za-z0-9-]{1,80}$/.test(v); // ingest's placeholder is not a session
      const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || null : null);
      const msgs = st.poolMsgs.all(n + 1), hist = st.poolHist.all(n + 1);
      const rows = msgs.slice(0, n).map((r) => ({ kind: r.source, role: 'user', text: r.text, at: r.at || null, sessionKey: r.cid,
        conversationId: r.cid, documentId: null, project: r.project || null, turnsAfter: Number(r.turns) || 0, pasted: false }))
        .concat(hist.slice(0, n).map((r) => ({ kind: 'history', role: null, text: r.text, at: r.at || null,
          sessionKey: realSid(r.sid) ? 'code:' + r.sid : r.id, conversationId: null, documentId: r.id,
          project: base(r.proj || r.project_path), turnsAfter: Number(r.turns) || 0, pasted: !!r.pasted })));
      return { rows, pooled: { messages: Math.min(msgs.length, n), history: Math.min(hist.length, n) },
        capped: { messages: msgs.length > n, history: hist.length > n } };
    },
    promptBodies: () => st.promptBodies.all().map((r) => r.text),
    hiddenCandidates: () => new Set(st.hiddenCands.all().map((r) => r.native_id)),
    hideCandidate(key) {
      if (typeof key !== 'string' || !/^cand:[0-9a-f]{40}$/.test(key)) throw new Error('not a candidate key');
      st.tomb.run('candidate', key, new Date().toISOString());
      return true;
    },
    forget(target) {
      return tx(() => {
        const now = new Date().toISOString();
        if (target && typeof target.documentId === 'string' && target.documentId) {
          const prev = q('SELECT source, text, meta FROM document WHERE id = ?').get(target.documentId);
          const r = q('DELETE FROM document WHERE id = ?').run(target.documentId);
          if (!r.changes) return false;
          st.tomb.run('document', target.documentId, now);
          if (prev && prev.source === 'history') {   // offset ids go stale on rotation: also remember the line by content
            let m = null; try { m = JSON.parse(prev.meta); } catch { /* no meta */ }
            if (m && m.sessionId) st.tomb.run('history-line', historyLineKey(m.sessionId, m.at, prev.text), now);
          }
          return true;
        }
        if (target && target.conversationId) {
          const c = st.getConv.get(target.conversationId);
          if (!c) return false;
          removeConversation(c); st.tomb.run('conversation', c.id, now);
          return true;
        }
        if (target && target.projectId) {
          const ids = st.convsOfProject.all(target.projectId).map((r) => r.id);
          for (const id of ids) { const c = st.getConv.get(id); if (c) { removeConversation(c); st.tomb.run('conversation', c.id, now); } }
          const r = st.delProject.run(target.projectId); st.tomb.run('project', target.projectId, now);
          return r.changes > 0 || ids.length > 0;
        }
        return false;
      });
    },
    counts: () => ({ projects: st.countP.get().c, conversations: st.countC.get().c, messages: st.countM.get().c, documents: q('SELECT COUNT(*) AS c FROM document').get().c }),
    listProjects({ source } = {}) {
      const where = source ? 'WHERE p.source = ?' : '';
      return q(`SELECT p.*, COUNT(c.id) AS conversations, MAX(c.last_at) AS last_at FROM project p
        LEFT JOIN conversation c ON c.project_id = p.id AND c.forgotten = 0 AND c.message_count > 0
        ${where} GROUP BY p.id ORDER BY last_at DESC`).all(...(source ? [source] : []));
    },
    listConversations({ projectId, source, q: title, since, hqProjectId, before, beforeId, limit = 100 } = {}) {
      const w = ['c.forgotten = 0', 'c.message_count > 0'], a = [];
      if (projectId) { w.push('c.project_id = ?'); a.push(projectId); }
      if (source) { w.push('c.source = ?'); a.push(source); }
      if (hqProjectId) { w.push('p.hq_project_id = ?'); a.push(hqProjectId); }
      if (since) { w.push('c.last_at >= ?'); a.push(since); }
      if (typeof title === 'string' && title.trim()) {
        // SQLite lower()/LIKE fold ASCII only; non-ASCII letters match in their stored case (IPC row says so)
        w.push("lower(c.title) LIKE ? ESCAPE '\\'");
        a.push('%' + title.trim().toLowerCase().replace(/[\\%_]/g, (ch) => '\\' + ch) + '%');
      }
      if (before && beforeId) { w.push('(c.last_at < ? OR (c.last_at = ? AND c.id < ?))'); a.push(before, before, beforeId); }
      else if (before) { w.push('c.last_at < ?'); a.push(before); }
      a.push(Math.max(1, Math.min(200, Number(limit) || 100)));
      return q(`SELECT c.*, p.name AS project_name, p.hq_project_id FROM conversation c LEFT JOIN project p ON p.id = c.project_id
        WHERE ${w.join(' AND ')} ORDER BY c.last_at DESC, c.id DESC LIMIT ?`).all(...a);
    },
    getConversation({ id, limit = 200, before, beforeId } = {}) {
      const c = st.getConv.get(id);
      if (!c || c.forgotten) return null;
      const lim = Math.max(1, Math.min(500, Number(limit) || 200));
      const cols = '*, rowid AS _r';
      const ref = before && beforeId ? q('SELECT rowid AS r FROM message WHERE id = ? AND conversation_id = ?').get(beforeId, id) : null;
      let rows;
      if (ref) rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? AND (at < ? OR (at = ? AND rowid < ?)) ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, before, before, ref.r, lim + 1);
      else if (before) rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? AND at < ? ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, before, lim + 1);
      else rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, lim + 1);
      const hasMore = rows.length > lim;
      return { conversation: c, messages: rows.slice(0, lim).reverse().map(({ _r, ...m }) => m), hasMore };
    },
    search({ q: query, projectId, source, limit = 30 } = {}) {
      const m = ftsQuery(query);
      if (!m) return [];
      const w = ['message_fts MATCH ?', 'c.forgotten = 0'], a = [m];
      if (projectId) { w.push('c.project_id = ?'); a.push(projectId); }
      if (source) { w.push('c.source = ?'); a.push(source); }
      a.push(Math.max(1, Math.min(50, Number(limit) || 30)));
      // No try/catch on purpose: ftsQuery() only emits quoted prefix terms, so a malformed MATCH is unreachable, and
      // anything that does throw here (locked db after busy_timeout, corrupt db, closed handle) must surface as an
      // error rather than masquerade as "no matches" (empty states say why).
      return q(`SELECT m.id AS messageId, m.conversation_id AS conversationId, m.at, m.role, c.title, c.source, c.project_id AS projectId,
        snippet(message_fts, 0, '${SNIP_START}', '${SNIP_END}', '…', 12) AS snippet, bm25(message_fts) AS rank
        FROM message_fts JOIN message m ON m.rowid = message_fts.rowid JOIN conversation c ON c.id = m.conversation_id
        WHERE ${w.join(' AND ')} ORDER BY rank LIMIT ?`).all(...a);
    },
    // H5 contextFor (context.mjs): the best FTS rows for an OR-of-keywords MATCH, user/assistant text only, no subagent
    // turns, no forgotten chat. Empty snippet markers: the text goes to a model, not to a highlighter. Errors surface.
    contextHits({ match, limit = 60 } = {}) {
      if (!match) return [];
      return q(`SELECT m.conversation_id AS conversationId, m.role, m.at,
        snippet(message_fts, 0, '', '', '…', 32) AS snippet, bm25(message_fts) AS rank,
        c.title, c.started_at AS startedAt, c.last_at AS lastAt, c.source, p.name AS projectName
        FROM message_fts JOIN message m ON m.rowid = message_fts.rowid JOIN conversation c ON c.id = m.conversation_id
        LEFT JOIN project p ON p.id = c.project_id
        WHERE message_fts MATCH ? AND c.forgotten = 0 AND m.role IN ('user', 'assistant') AND m.is_sidechain = 0
        ORDER BY rank LIMIT ?`).all(match, Math.max(1, Math.min(200, Number(limit) || 60)));
    },
    getMeta: (key) => { const r = st.getMeta.get(key); return r ? r.value : null; },
    setMeta: (key, value) => st.setMeta.run(key, String(value)),
    upsertDocument({ id, source, path: p = null, title = null, text = '', projectId = null, projectPath = null, mtimeMs = null, size = null, meta = null }) {
      if (st.isTomb.get('document', id)) return 'forgotten';
      const m = meta == null ? null : JSON.stringify(meta);
      const prev = q('SELECT path, title, text, project_id, project_path, meta FROM document WHERE id = ?').get(id);
      if (prev && prev.path === n(p) && prev.title === n(title) && prev.text === String(text) && prev.project_id === n(projectId)
        && prev.project_path === n(projectPath) && prev.meta === m) {
        q('UPDATE document SET mtime_ms = ?, size = ? WHERE id = ?').run(n(mtimeMs), n(size), id);
        return 'unchanged';
      }
      q(`INSERT INTO document(id, source, path, title, text, project_id, project_path, mtime_ms, size, meta) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET source = excluded.source, path = excluded.path, title = excluded.title, text = excluded.text,
        project_id = excluded.project_id, project_path = excluded.project_path, mtime_ms = excluded.mtime_ms, size = excluded.size, meta = excluded.meta`)
        .run(id, source, n(p), n(title), String(text), n(projectId), n(projectPath), n(mtimeMs), n(size), m);
      return prev ? 'updated' : 'added';
    },
    removeDocument: (id) => q('DELETE FROM document WHERE id = ?').run(id).changes > 0,
    removeDocuments: ({ source, idPrefix }) => q("DELETE FROM document WHERE source = ? AND substr(id, 1, length(?)) = ?").run(source, idPrefix, idPrefix).changes,
    documentStamps: (source) => new Map(q('SELECT id, path, mtime_ms, size FROM document WHERE source = ?').all(source).map((r) => [r.id, { path: r.path, mtime_ms: r.mtime_ms, size: r.size }])),
    listDocuments({ source, projectId, q: query, limit = 50 } = {}) {
      const lim = Math.max(1, Math.min(200, Number(limit) || 50));
      const cols = "d.id, d.source, d.path, d.title, d.project_id, d.project_path, d.mtime_ms, d.size, CASE WHEN json_valid(d.meta) THEN json_extract(d.meta, '$.origin') END AS origin, d.meta AS meta_json, CASE WHEN d.source = 'prompt' THEN d.text END AS prompt_text";
      const w = [], a = [];
      if (source) { w.push('d.source = ?'); a.push(source); } else w.push("d.source <> 'history'");
      if (projectId) { w.push('d.project_id = ?'); a.push(projectId); }
      if (query !== undefined && query !== null && String(query).trim() !== '') {
        const m = ftsQuery(query);
        if (!m) return [];
        // errors surface (same reasoning as search): a failing MATCH must not look like "no documents"
        return q(`SELECT ${cols}, snippet(document_fts, 1, '${SNIP_START}', '${SNIP_END}', '…', 12) AS snippet, bm25(document_fts) AS rank
          FROM document_fts JOIN document d ON d.rowid = document_fts.rowid WHERE document_fts MATCH ? AND ${w.join(' AND ')} ORDER BY rank LIMIT ?`).all(m, ...a, lim).map(docRow);
      }
      return q(`SELECT ${cols} FROM document d WHERE ${w.join(' AND ')} ORDER BY d.mtime_ms DESC, d.id DESC LIMIT ?`).all(...a, lim).map(docRow);
    },
    promptStats: () => q(`SELECT prompt_id, COUNT(*) AS uses, MAX(at) AS last_at FROM prompt_use
      GROUP BY prompt_id ORDER BY last_at DESC, prompt_id`).all().map((r) => ({ prompt_id: r.prompt_id, uses: Number(r.uses), last_at: r.last_at })),
    getDocument({ id } = {}) {
      const r = typeof id === 'string' ? q('SELECT id, source, path, title, text, project_id, project_path, mtime_ms, size, meta FROM document WHERE id = ?').get(id) : null;
      if (!r) return null;
      let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }
      return { ...r, meta };
    },
    setLink({ projectId, hqProjectId, state }) {
      if (!['auto', 'confirmed', 'none', 'rejected'].includes(state)) throw new Error('link: bad state');
      const keep = state === 'auto' || state === 'confirmed';
      if (keep && !(typeof hqProjectId === 'string' && hqProjectId)) throw new Error('link: hqProjectId required');
      const r = q('UPDATE project SET hq_project_id = ?, link_state = ?, updated_at = ? WHERE id = ?')
        .run(keep ? hqProjectId : null, state, new Date().toISOString(), projectId);
      return r.changes > 0;
    },
    linkRows: () => q("SELECT id, path, hq_project_id, link_state FROM project WHERE source = 'code' ORDER BY id").all().map((r) => ({ ...r })),
    optimize: () => { db.exec("INSERT INTO message_fts(message_fts) VALUES('optimize')"); },
    stats({ from, to, projectId, tzOffsetMin = 0 } = {}) {
      const DAY = /^\d{4}-\d{2}-\d{2}$/;
      if (!DAY.test(String(from)) || !DAY.test(String(to))) throw new Error('stats: from/to must be YYYY-MM-DD');
      const tz = Math.max(-840, Math.min(840, Math.trunc(Number(tzOffsetMin) || 0)));
      const t0 = Date.parse(from + 'T00:00:00Z') - tz * 60000;
      let t1 = Date.parse(to + 'T00:00:00Z') + 86400000 - tz * 60000;
      if (!(t1 > t0)) throw new Error('stats: from/to must be YYYY-MM-DD');
      t1 = Math.min(t1, t0 + 400 * 86400000);
      const lo = new Date(t0).toISOString(), hi = new Date(t1).toISOString(), mod = tz + ' minutes';
      const pw = projectId ? 'AND c.project_id = ?' : '', pa = projectId ? [projectId] : [];
      const days = q(`WITH m AS (
          SELECT m.conversation_id AS cid, m.at,
            (julianday(m.at) - julianday(LAG(m.at) OVER (PARTITION BY m.conversation_id ORDER BY m.at, m.rowid))) * 86400000.0 AS gap
          FROM message m JOIN conversation c ON c.id = m.conversation_id
          WHERE c.forgotten = 0 AND m.at >= ? AND m.at < ? ${pw})
        SELECT date(at, ?) AS day, COUNT(DISTINCT cid) AS chats, COUNT(*) AS messages,
          CAST(ROUND(SUM(CASE WHEN gap > 0 AND gap < 300000 THEN gap ELSE 0 END)) AS INTEGER) AS active_ms
        FROM m GROUP BY day ORDER BY day`).all(lo, hi, ...pa, mod).map((r) => ({ ...r }));
      // Token scope: usage rows carry no timestamp, so tokens_* are the WHOLE totals of the chats active in
      // [from, to), not only tokens spent inside it (IPC-CONTRACT stats row; History labels them "whole chat").
      const projects = q(`WITH act AS (SELECT DISTINCT m.conversation_id AS cid FROM message m JOIN conversation c ON c.id = m.conversation_id
            WHERE c.forgotten = 0 AND m.at >= ? AND m.at < ? ${pw}),
          ux AS (SELECT c.project_id AS pid, u.api_id, MAX(u.tin) tin, MAX(u.tout) tout, MAX(u.tcr) tcr, MAX(u.tcw) tcw
            FROM usage u JOIN act ON act.cid = u.conversation_id JOIN conversation c ON c.id = u.conversation_id GROUP BY c.project_id, u.api_id),
          ch AS (SELECT c.project_id AS pid, COUNT(*) AS chats FROM act JOIN conversation c ON c.id = act.cid GROUP BY c.project_id)
        SELECT ch.pid AS project_id, p.name, ch.chats, COALESCE(SUM(ux.tin), 0) AS tokens_in, COALESCE(SUM(ux.tout), 0) AS tokens_out,
          COALESCE(SUM(ux.tcr), 0) AS tokens_cache_read, COALESCE(SUM(ux.tcw), 0) AS tokens_cache_write
        FROM ch LEFT JOIN project p ON p.id = ch.pid LEFT JOIN ux ON ux.pid = ch.pid
        GROUP BY ch.pid ORDER BY tokens_out DESC, ch.pid`).all(lo, hi, ...pa).map((r) => ({ ...r }));
      const sum = (k) => projects.reduce((n, x) => n + Number(x[k] || 0), 0);
      return { from, to, tzOffsetMin: tz, days, projects,
        totals: { chats: sum('chats'), active_ms: days.reduce((n, d) => n + d.active_ms, 0), tokens_in: sum('tokens_in'), tokens_out: sum('tokens_out'), tokens_cache_read: sum('tokens_cache_read'), tokens_cache_write: sum('tokens_cache_write') } };
    },
    close: () => db.close(),
  };
}
