// A populated schema-1 hub.sqlite, built from the VERBATIM schema-1 DDL (store.mjs at 4c8da80), so the 1→2 migration is
// tested against the real previous shape and never against whatever store.mjs creates today. Placeholder text only.
import { DatabaseSync } from 'node:sqlite';

export const V1_SCHEMA = `
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
`;

export function makeV1Db(file, { schemaVersion = '1' } = {}) {
  const db = new DatabaseSync(file);
  db.exec(V1_SCHEMA);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  run("INSERT INTO meta(key, value) VALUES ('schema_version', ?)", schemaVersion);
  run("INSERT INTO meta(key, value) VALUES ('index_version', '2')");
  run("INSERT INTO project(id, source, key, name, path, link_state) VALUES ('code:C--placeholder-project-a', 'code', 'C--placeholder-project-a', 'project-a', 'C:\\placeholder\\project-a', 'confirmed')");
  run("INSERT INTO conversation(id, source, project_id, native_id, title, title_source, started_at, last_at, message_count) VALUES ('code:s1', 'code', 'code:C--placeholder-project-a', 's1', 'Placeholder planning', 'custom', '2026-10-01T10:00:00.000Z', '2026-10-01T10:01:00.000Z', 2)");
  run("INSERT INTO message(id, conversation_id, role, at, text) VALUES ('code:s1:u1', 'code:s1', 'user', '2026-10-01T10:00:00.000Z', 'placeholder question about lanterns')");
  run("INSERT INTO message(id, conversation_id, role, at, text) VALUES ('code:s1:a1', 'code:s1', 'assistant', '2026-10-01T10:01:00.000Z', 'placeholder answer')");
  run("INSERT INTO usage(conversation_id, api_id, tin, tout) VALUES ('code:s1', 'msg_1', 10, 20)");
  run("INSERT INTO ingest_cursor(file, size, mtime_ms, offset, head, session_id) VALUES ('C--placeholder-project-a\\s1.jsonl', 123, 1, 123, '5:abcde', 's1')");
  run("INSERT INTO web_sync(kind, native_id, updated_at) VALUES ('conversation', 'web-uuid-1', '2026-10-01T00:00:00Z')");
  run("INSERT INTO tombstone(kind, native_id, at) VALUES ('conversation', 'code:gone', '2026-10-02T00:00:00Z')");
  db.close();
  return file;
}
