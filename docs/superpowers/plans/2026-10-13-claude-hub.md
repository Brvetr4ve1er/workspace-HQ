# Claude Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkspaceHQ receives every Claude Code session and every claude.ai chat and Project, and lets the owner browse, search, chat, ask and save them. This plan details phase **H1** (the Hub process, its host, the store, Claude Code ingest and System health) and outlines H2–H5.

**Architecture:** A separate **Claude Hub** process runs on system Node ≥ 22.5 (`node:sqlite` + FTS5) and owns `data/claude/hub.sqlite`. It ingests `~/.claude/projects/**.jsonl` incrementally and answers JSON-line requests over stdio. `dashboard/claude-hub-host.js` in the Electron main process (Node 20, which has no sqlite) finds Node, spawns and supervises the Hub, and bridges it to IPC. v5 shows the Hub's health on System.

**Tech Stack:**
- Node 25 (system) with `node:sqlite`.
- Electron 32 main (CommonJS).
- The v5 renderer (vanilla ESM, dc templates).
- `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md`

## Global Constraints

- **Hub runtime:** system Node **≥ 22.5**. The Electron main process never imports `node:sqlite`.
- **Storage:** all imported data, indexes and logs live under **`data/claude/`**, which is gitignored before any data is written.
- **Fixtures:** placeholder text only. Secret-shaped test strings are built at runtime (e.g. `'sk_' + 'live_' + 'A'.repeat(24)`), never committed literally.
- **Large files:** never read a transcript whole. Stream with a byte cursor (one file is 630 MB, and `readFileSync` on it throws `ERR_STRING_TOO_LONG`).
- **The owner's `~/.claude` is read-only.** It is never written, moved or deleted.
- **Test overrides:** `HQ_CLAUDE_HOME` (a folder containing `projects/`) and `HQ_CLAUDE_DB` (the db file) point gates and tests at fixtures. Gates never use the owner's real index.
- **IPC:** every new channel gets a `docs/sync/IPC-CONTRACT.md` row **before** its handler. Main-side code goes in new files with one-line hooks in `main.js`.
- **v5 templates:** every addition carries `<!-- v5: reason -->`. Goldens are re-recorded only after every changed scenario has been attributed. CSP stays unchanged.
- **Honesty:** no invented numbers. "active time" is labelled *estimate*. Empty states say why.
- **Git:** commits use explicit pathspecs with `fe:` / `meta:` prefixes plus `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never touch `collector/`, `schema/`, `run-pipeline.ps1`, `run-scan.ps1`, `spellbook/`, `data/quest-overrides.json`, `collector/collector.config.json` or `legacy/`.
- **Processes:** the owner's app (`electron.exe . --hidden` without `--user-data-dir`) is never stopped by tests. Stop only PIDs you start.
- **No network in H1.**

## Review Focus

1. **A huge transcript, or one line of tens of MB** (a giant tool output). Memory stays bounded, the oversized line is skipped and counted, later lines still ingest, and the cursor is exact. *Pinned in Task 4.*
2. **Two Hubs on the same database** (the owner's app plus a test instance, or a restart overlapping). The second becomes a read-only reader and never writes. *Pinned in Task 5.*
3. **Claude Code writes one API response as several lines** (one per content block), each repeating `usage`. Tokens are counted once per response, not once per line. *Pinned in Tasks 2 and 4.*
4. **CRLF line endings, a UTF-8 BOM, and multi-byte characters split across read chunks.** Text arrives intact and offsets stay byte-exact. *Pinned in Task 4.*
5. **A transcript truncated or replaced, lines with no `uuid`, and invalid timestamps.** No crash, no duplicates, and a replaced file is re-ingested from 0. *Pinned in Tasks 3 and 4.*

---

## File structure (H1)

| File | Responsibility |
|---|---|
| `dashboard/claude-hub/redact.mjs` | `maskSecrets(text)`: pure secret masking |
| `dashboard/claude-hub/parse-code.mjs` | `parseCodeLine(line)`: one transcript line → message / title / meta / bad (pure) |
| `dashboard/claude-hub/store.mjs` | `openStore(file, opts)`: schema, migrations, upserts, usage, cursors, queries, FTS, forget |
| `dashboard/claude-hub/ingest-code.mjs` | `ingestFile`, `listTranscripts`, `backfill`, `sweep`, `watchRoot` |
| `dashboard/claude-hub/hub.mjs` | the stdio JSON-line server: lock, ops, events (system Node) |
| `dashboard/claude-hub/__fixtures__/make-fixture.mjs` | builds a placeholder `~/.claude` in a temp dir for tests and gates |
| `dashboard/claude-hub/*.test.mjs` | unit and protocol tests (run with `node --test dashboard/claude-hub/*.test.mjs`) |
| `dashboard/claude-hub-host.js` (+ `.test.mjs`) | main side: find Node, spawn, route, restart, IPC `hq:claude-hub:health` + push |
| `dashboard/main.js` | 2 one-line hooks (init in `whenReady`, stop in `before-quit`) |
| `dashboard/preload.js` | `hq.claudeHub.{health,on}` (additive) |
| `dashboard-v5/src/live/store.js`, `src/vals/system.js`, `src/tpl/system.tpl.js`, `tools/fake-preload.js`, `src/selftest.js`, goldens | the System "Claude Hub" card |
| `.gitignore`, `docs/sync/IPC-CONTRACT.md`, `docs/sync/CONTRACT.md`, `CLAUDE.md`, `README.md`, `docs/sync/HANDOFF.md` | ignore rule, contracts, test command, handoff |

Deviation from spec §4, decided here: token usage is stored per API response in a `usage` table (`conversation_id`, `api_id`), and conversation totals are sums over it. The reason is that Claude Code writes one line per content block and each line repeats the response's `usage`, so summing per line would double count. The `ingest_cursor` table also gains a `head` column (a hash of the first 256 bytes) to detect a replaced file.

---

### Task 1: Secret masking (`redact.mjs`)

**Files:**
- Create: `dashboard/claude-hub/redact.mjs`
- Test: `dashboard/claude-hub/redact.test.mjs`

**Interfaces:**
- Produces: `maskSecrets(text: string): { text: string, hits: number }` and `MASK(name: string): string` (`'••• secret (' + name + ')'`).

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub/redact.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, MASK } from './redact.mjs';

// secret-shaped strings are assembled at runtime so no literal key is ever committed
const k = (prefix, n, ch = 'A') => prefix + ch.repeat(n);

test('masks each known secret shape and counts hits', () => {
  const cases = [
    ['anthropic-key', k('sk-' + 'ant-', 30)],
    ['stripe-key', k('sk_' + 'live_', 24)],
    ['github-token', k('gh' + 'p_', 36)],
    ['aws-key', 'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['slack-token', k('xo' + 'xb-', 20, '1')],
    ['google-key', k('AI' + 'za', 35)],
    ['jwt', 'eyJ' + 'a'.repeat(12) + '.eyJ' + 'b'.repeat(12) + '.' + 'c'.repeat(12)],
  ];
  for (const [name, secret] of cases) {
    const { text, hits } = maskSecrets('before ' + secret + ' after');
    assert.equal(text, 'before ' + MASK(name) + ' after', name);
    assert.equal(hits, 1, name);
  }
});

test('private key blocks and bearer headers keep their context', () => {
  const pem = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIabc\n-----END ' + 'PRIVATE KEY-----';
  assert.equal(maskSecrets('x ' + pem + ' y').text, 'x ' + MASK('private-key') + ' y');
  const r = maskSecrets('Authorization: Bearer ' + 'z'.repeat(20));
  assert.equal(r.text, 'Authorization: Bearer ' + MASK('bearer'));
});

test('ordinary text, short tokens and non-strings are untouched; masking is idempotent', () => {
  assert.deepEqual(maskSecrets('rotate the key in project-a'), { text: 'rotate the key in project-a', hits: 0 });
  assert.deepEqual(maskSecrets('sk-short'), { text: 'sk-short', hits: 0 });
  assert.deepEqual(maskSecrets(undefined), { text: '', hits: 0 });
  const once = maskSecrets('k=' + k('sk_' + 'test_', 20)).text;
  assert.deepEqual(maskSecrets(once), { text: once, hits: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub/redact.test.mjs`
Expected: FAIL, `Cannot find module …/redact.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// dashboard/claude-hub/redact.mjs
// Secret masking for the Claude Hub index (spec §4). Pure, no deps, never throws.
// The original transcripts on disk are never modified; only indexed text is masked.
export const MASK = (name) => `••• secret (${name})`;

// order matters: specific shapes before generic ones (sk-ant- before sk-)
const RULES = [
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'stripe-key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer', re: /(\bAuthorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, keep: 1 },
];

export function maskSecrets(input) {
  let text = typeof input === 'string' ? input : '';
  let hits = 0;
  for (const r of RULES) {
    text = text.replace(r.re, (...m) => { hits++; return (r.keep ? m[r.keep] : '') + MASK(r.name); });
  }
  return { text, hits };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard/claude-hub/redact.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/redact.mjs dashboard/claude-hub/redact.test.mjs
git commit -m "fe: Claude Hub H1.1 — secret masking for indexed text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The store (`store.mjs`)

**Files:**
- Create: `dashboard/claude-hub/store.mjs`
- Test: `dashboard/claude-hub/store.test.mjs`

**Interfaces:**
- Consumes: nothing (`node:sqlite` only).
- Produces: `openStore(file: string, { readOnly?: boolean }) → Store`, with:
  - `tx(fn)`
  - `upsertProject({ id, source, key, name, path })`
  - `ensureConversation({ id, source, projectId, nativeId, cwd?, gitBranch?, model? })`
  - `setTitle(id, title, source: 'custom'|'web'|'ai'|'first-prompt') → boolean`
  - `addMessages(conversationId, msgs[]) → insertedCount`, where msg = `{ id, nativeId, parentId, role, at, text, toolName, isSidechain }`
  - `addUsage(conversationId, apiId, { in, out, cacheRead, cacheWrite })`
  - `refreshTokens(conversationId)`
  - `resetConversation(id)`, `resetCode()`
  - `getCursor(file) → row|undefined`, `setCursor({ file, size, mtimeMs, offset, head, sessionId })`, `deleteCursor(file)`
  - `isTombstoned(kind, nativeId) → boolean`
  - `forget({ conversationId } | { projectId }) → boolean`
  - `counts() → { projects, conversations, messages }`
  - `listProjects({ source? })`, `listConversations({ projectId?, source?, before?, limit? })`
  - `getConversation({ id, limit?, before? }) → { conversation, messages, hasMore } | null`
  - `search({ q, projectId?, source?, limit? }) → hits[]`
  - `getMeta(key)`, `setMeta(key, value)`, `close()`
- Also exported: `SCHEMA_VERSION = 1`, `ftsQuery(q) → string|null`, `SNIP_START = '\u0002'`, `SNIP_END = '\u0003'`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, ftsQuery, SNIP_START, SNIP_END, SCHEMA_VERSION } from './store.mjs';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-store-')), 'hub.sqlite');
const seed = (s) => {
  s.upsertProject({ id: 'code:C--p-a', source: 'code', key: 'C--p-a', name: 'C--p-a', path: null });
  s.ensureConversation({ id: 'code:s1', source: 'code', projectId: 'code:C--p-a', nativeId: 's1' });
};
const msg = (n, at, text, role = 'user') => ({ id: 'code:u' + n, nativeId: 'u' + n, parentId: null, role, at, text, toolName: null, isSidechain: false });

test('schema version is recorded and a newer schema is refused', () => {
  const f = tmpDb(); const s = openStore(f);
  assert.equal(s.getMeta('schema_version'), String(SCHEMA_VERSION));
  s.setMeta('schema_version', '99'); s.close();
  assert.throws(() => openStore(f), /newer WorkspaceHQ/);
});

test('addMessages is idempotent and maintains counts, span and active time', () => {
  const s = openStore(':memory:'); seed(s);
  const batch = [msg(1, '2026-10-01T10:00:00.000Z', 'hello'), msg(2, '2026-10-01T10:02:00.000Z', 'reply', 'assistant'), msg(3, '2026-10-01T11:00:00.000Z', 'later')];
  assert.equal(s.addMessages('code:s1', batch), 3);
  assert.equal(s.addMessages('code:s1', batch), 0, 'replay inserts nothing');
  const c = s.getConversation({ id: 'code:s1' }).conversation;
  assert.equal(c.message_count, 3);
  assert.equal(c.started_at, '2026-10-01T10:00:00.000Z');
  assert.equal(c.last_at, '2026-10-01T11:00:00.000Z');
  assert.equal(c.active_ms, 120000, 'only the 2-minute gap counts; the 58-minute gap is idle');
});

test('usage counts once per API response even when repeated on several lines (Review Focus 3)', () => {
  const s = openStore(':memory:'); seed(s);
  s.addUsage('code:s1', 'msg_A', { in: 6, out: 10, cacheRead: 100, cacheWrite: 50 });
  s.addUsage('code:s1', 'msg_A', { in: 6, out: 917, cacheRead: 100, cacheWrite: 50 });   // same response, later block
  s.addUsage('code:s1', 'msg_B', { in: 4, out: 20, cacheRead: 0, cacheWrite: 0 });
  s.refreshTokens('code:s1');
  const c = s.getConversation({ id: 'code:s1' }).conversation;
  assert.deepEqual([c.tokens_in, c.tokens_out, c.tokens_cache_read, c.tokens_cache_write], [10, 937, 100, 50]);
});

test('titles follow custom > ai > first-prompt', () => {
  const s = openStore(':memory:'); seed(s);
  assert.equal(s.setTitle('code:s1', 'first words', 'first-prompt'), true);
  assert.equal(s.setTitle('code:s1', 'other words', 'first-prompt'), false, 'first prompt never replaces a title');
  assert.equal(s.setTitle('code:s1', 'AI title', 'ai'), true);
  assert.equal(s.setTitle('code:s1', 'My title', 'custom'), true);
  assert.equal(s.setTitle('code:s1', 'AI again', 'ai'), false);
  assert.equal(s.getConversation({ id: 'code:s1' }).conversation.title, 'My title');
});

test('search: prefix + diacritics, snippet markers, filters; junk queries return []', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'We decided to rotate the café key')]);
  const hits = s.search({ q: 'rotat cafe' });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].snippet.includes(SNIP_START) && hits[0].snippet.includes(SNIP_END));
  assert.equal(hits[0].conversationId, 'code:s1');
  assert.deepEqual(s.search({ q: '"); DROP TABLE message; --' }), []);
  assert.deepEqual(s.search({ q: '' }), []);
  assert.equal(s.search({ q: 'rotate', source: 'web' }).length, 0);
  assert.equal(ftsQuery('a b'), '"a"* "b"*');
});

test('forget deletes rows + FTS entries and tombstones; reset clears a conversation', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'secret plan')]);
  assert.equal(s.forget({ conversationId: 'code:s1' }), true);
  assert.equal(s.search({ q: 'secret' }).length, 0);
  assert.equal(s.isTombstoned('conversation', 'code:s1'), true);
  assert.equal(s.getConversation({ id: 'code:s1' }), null);
  assert.equal(s.forget({ conversationId: 'code:nope' }), false);
});

test('listConversations hides empty and forgotten chats, newest first, with counts', () => {
  const s = openStore(':memory:'); seed(s);
  s.ensureConversation({ id: 'code:s2', source: 'code', projectId: 'code:C--p-a', nativeId: 's2' });
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'old')]);
  s.ensureConversation({ id: 'code:s3', source: 'code', projectId: 'code:C--p-a', nativeId: 's3' });
  s.addMessages('code:s3', [msg(9, '2026-10-02T10:00:00.000Z', 'new')]);
  assert.deepEqual(s.listConversations({}).map((c) => c.id), ['code:s3', 'code:s1']);
  assert.deepEqual(s.counts(), { projects: 1, conversations: 2, messages: 2 });
  assert.equal(s.listProjects({})[0].conversations, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL, `Cannot find module …/store.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// dashboard/claude-hub/store.mjs
// Claude Hub store (spec §4): one SQLite file with FTS5, owned by the Hub process
// on system Node ≥ 22.5. The Electron main process never opens it.
// node:sqlite binds numbers/strings/null only — booleans become 0/1, undefined → null.
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;
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
`;

export function ftsQuery(q) {
  const terms = String(q || '').normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) || [];
  if (!terms.length) return null;
  return terms.slice(0, 8).map((t) => '"' + t + '"*').join(' ');   // every term prefix-matches
}

function migrate(db) {
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(row.value) > SCHEMA_VERSION) throw new Error('hub.sqlite is from a newer WorkspaceHQ (schema ' + row.value + ')');
}

export function openStore(file, { readOnly = false } = {}) {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  db.exec('PRAGMA busy_timeout = 5000');
  if (readOnly) {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (row && Number(row.value) > SCHEMA_VERSION) throw new Error('hub.sqlite is from a newer WorkspaceHQ (schema ' + row.value + ')');
  } else {
    if (file !== ':memory:') { db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA synchronous = NORMAL'); }
    migrate(db);
  }
  return api(db);
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
    isTombstoned: (kind, nativeId) => !!st.isTomb.get(kind, nativeId),
    forget(target) {
      return tx(() => {
        const now = new Date().toISOString();
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
    counts: () => ({ projects: st.countP.get().c, conversations: st.countC.get().c, messages: st.countM.get().c }),
    listProjects({ source } = {}) {
      const where = source ? 'WHERE p.source = ?' : '';
      return q(`SELECT p.*, COUNT(c.id) AS conversations, MAX(c.last_at) AS last_at FROM project p
        LEFT JOIN conversation c ON c.project_id = p.id AND c.forgotten = 0 AND c.message_count > 0
        ${where} GROUP BY p.id ORDER BY last_at DESC`).all(...(source ? [source] : []));
    },
    listConversations({ projectId, source, before, limit = 100 } = {}) {
      const w = ['c.forgotten = 0', 'c.message_count > 0'], a = [];
      if (projectId) { w.push('c.project_id = ?'); a.push(projectId); }
      if (source) { w.push('c.source = ?'); a.push(source); }
      if (before) { w.push('c.last_at < ?'); a.push(before); }
      a.push(Math.max(1, Math.min(200, Number(limit) || 100)));
      return q(`SELECT c.*, p.name AS project_name, p.hq_project_id FROM conversation c LEFT JOIN project p ON p.id = c.project_id
        WHERE ${w.join(' AND ')} ORDER BY c.last_at DESC LIMIT ?`).all(...a);
    },
    getConversation({ id, limit = 200, before } = {}) {
      const c = st.getConv.get(id);
      if (!c || c.forgotten) return null;
      const lim = Math.max(1, Math.min(500, Number(limit) || 200));
      const rows = before
        ? q('SELECT * FROM message WHERE conversation_id = ? AND at < ? ORDER BY at DESC LIMIT ?').all(id, before, lim + 1)
        : q('SELECT * FROM message WHERE conversation_id = ? ORDER BY at DESC LIMIT ?').all(id, lim + 1);
      const hasMore = rows.length > lim;
      return { conversation: c, messages: rows.slice(0, lim).reverse(), hasMore };
    },
    search({ q: query, projectId, source, limit = 30 } = {}) {
      const m = ftsQuery(query);
      if (!m) return [];
      const w = ['message_fts MATCH ?', 'c.forgotten = 0'], a = [m];
      if (projectId) { w.push('c.project_id = ?'); a.push(projectId); }
      if (source) { w.push('c.source = ?'); a.push(source); }
      a.push(Math.max(1, Math.min(50, Number(limit) || 30)));
      try {
        return q(`SELECT m.id AS messageId, m.conversation_id AS conversationId, m.at, m.role, c.title, c.source, c.project_id AS projectId,
          snippet(message_fts, 0, '${SNIP_START}', '${SNIP_END}', '…', 12) AS snippet, bm25(message_fts) AS rank
          FROM message_fts JOIN message m ON m.rowid = message_fts.rowid JOIN conversation c ON c.id = m.conversation_id
          WHERE ${w.join(' AND ')} ORDER BY rank LIMIT ?`).all(...a);
      } catch { return []; }   // a malformed MATCH can never reach here via ftsQuery, but never throw on a query
    },
    getMeta: (key) => { const r = st.getMeta.get(key); return r ? r.value : null; },
    setMeta: (key, value) => st.setMeta.run(key, String(value)),
    close: () => db.close(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: PASS (7 tests). If `node:sqlite` prints an ExperimentalWarning, that's fine.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs
git commit -m "fe: Claude Hub H1.2 — SQLite/FTS5 store (idempotent upserts, per-response usage, titles, search, forget)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Claude Code line parser (`parse-code.mjs`)

**Files:**
- Create: `dashboard/claude-hub/parse-code.mjs`
- Test: `dashboard/claude-hub/parse-code.test.mjs`

**Interfaces:**
- Produces: `parseCodeLine(line: string) → null | { kind:'bad' } | { kind:'meta', type } | { kind:'title', sessionId, title, source:'custom'|'ai' } | { kind:'message', sessionId, uuid, parentUuid, at, cwd, gitBranch, isSidechain, role:'user'|'assistant'|'tool'|'system', text, toolName, model, apiId, usage:{in,out,cacheRead,cacheWrite}|null }`. Also `TOOL_RESULT_MAX = 2048`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub/parse-code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeLine, TOOL_RESULT_MAX } from './parse-code.mjs';

const L = (o) => JSON.stringify(o);
const base = { sessionId: 's1', uuid: 'u1', parentUuid: null, timestamp: '2026-10-01T10:00:00.000Z', cwd: 'C:\\placeholder\\project-a', gitBranch: 'main' };

test('user text, assistant text + tool_use, tool_result trimmed, thinking dropped', () => {
  const u = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: 'hello there' } }));
  assert.equal(u.kind, 'message'); assert.equal(u.role, 'user'); assert.equal(u.text, 'hello there'); assert.equal(u.cwd, base.cwd);
  const a = parseCodeLine(L({ ...base, uuid: 'u2', type: 'assistant', message: { id: 'msg_1', model: 'claude-x', role: 'assistant',
    content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Reading it' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\p\\a.js' } }],
    usage: { input_tokens: 6, output_tokens: 9, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } } }));
  assert.equal(a.role, 'assistant'); assert.equal(a.text, 'Reading it\n[tool: Read C:\\p\\a.js]'); assert.equal(a.toolName, 'Read');
  assert.equal(a.apiId, 'msg_1'); assert.deepEqual(a.usage, { in: 6, out: 9, cacheRead: 100, cacheWrite: 50 });
  const big = 'x'.repeat(TOOL_RESULT_MAX + 500);
  const t = parseCodeLine(L({ ...base, uuid: 'u3', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } }));
  assert.equal(t.role, 'tool'); assert.equal(t.text.length, TOOL_RESULT_MAX + 1); assert.ok(t.text.endsWith('…'));
  const th = parseCodeLine(L({ ...base, uuid: 'u4', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }], usage: { output_tokens: 917 } } }));
  assert.equal(th.text, ''); assert.equal(th.usage.out, 917, 'usage kept even when no text');
});

test('titles, command echoes and meta lines', () => {
  assert.deepEqual(parseCodeLine(L({ type: 'custom-title', customTitle: ' My chat ', sessionId: 's1' })), { kind: 'title', sessionId: 's1', title: 'My chat', source: 'custom' });
  assert.deepEqual(parseCodeLine(L({ type: 'ai-title', aiTitle: 'List files', sessionId: 's1' })), { kind: 'title', sessionId: 's1', title: 'List files', source: 'ai' });
  const echo = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } }));
  assert.equal(echo.role, 'system');
  const meta = parseCodeLine(L({ ...base, type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: …' } }));
  assert.equal(meta.role, 'system');
  const compact = parseCodeLine(L({ ...base, type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } }));
  assert.equal(compact.role, 'system');
  assert.deepEqual(parseCodeLine(L({ type: 'file-history-snapshot', messageId: 'x' })), { kind: 'meta', type: 'file-history-snapshot' });
});

test('robust input: BOM, CRLF, blank, broken JSON, missing uuid, bad timestamp (Review Focus 4, 5)', () => {
  const withBom = '\ufeff' + L({ ...base, type: 'user', message: { role: 'user', content: 'café 🚀' } }) + '\r';
  assert.equal(parseCodeLine(withBom).text, 'café 🚀');
  assert.equal(parseCodeLine(''), null);
  assert.equal(parseCodeLine('   '), null);
  assert.deepEqual(parseCodeLine('{"type":"user",'), { kind: 'bad' });
  assert.deepEqual(parseCodeLine('42'), { kind: 'bad' });
  const noId = parseCodeLine(L({ type: 'user', sessionId: 's1', timestamp: 'not a date', message: { role: 'user', content: 'hi' } }));
  assert.equal(noId.uuid, null); assert.equal(noId.at, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub/parse-code.test.mjs`
Expected: FAIL, `Cannot find module …/parse-code.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// dashboard/claude-hub/parse-code.mjs
// One Claude Code transcript line (~/.claude/projects/<folder>/<sessionId>.jsonl) → a
// message, a title, a meta marker or 'bad' (spec §5.1). Pure, never throws.
// Only `type`, message.role/content/usage/id/model and the line's own uuid,
// parentUuid, timestamp, cwd, gitBranch, sessionId, isSidechain, isMeta,
// isCompactSummary are relied on; every other field and line type is ignored.
export const TOOL_RESULT_MAX = 2048;
const COMMAND_ECHO = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;
const str = (v) => (typeof v === 'string' && v ? v : null);
const clean = (s, max) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const iso = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const cut = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s);

function toolHint(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
    if (typeof input[k] === 'string' && input[k]) return ' ' + cut(input[k].replace(/\s+/g, ' '), 80);
  }
  return '';
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
  return '';
}

function toText(content, type, systemish) {
  if (typeof content === 'string') {
    const role = type === 'assistant' ? 'assistant' : systemish || COMMAND_ECHO.test(content) ? 'system' : 'user';
    return { role, text: clean(content, role === 'system' ? 500 : 200000), toolName: null };
  }
  if (!Array.isArray(content)) return { role: type === 'assistant' ? 'assistant' : 'user', text: '', toolName: null };
  const parts = []; let toolName = null, onlyResults = content.length > 0;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type !== 'tool_result') onlyResults = false;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_use') { toolName = toolName || str(b.name); parts.push('[tool: ' + (str(b.name) || 'tool') + toolHint(b.input) + ']'); }
    else if (b.type === 'tool_result') parts.push(cut(resultText(b.content), TOOL_RESULT_MAX));
    else if (b.type === 'image') parts.push('[image]');
    else if (b.type === 'document') parts.push('[document]');
    // thinking / redacted_thinking / anything else: dropped
  }
  const role = onlyResults ? 'tool' : type === 'assistant' ? 'assistant' : systemish ? 'system' : 'user';
  const joined = parts.join('\n');
  return { role, text: role === 'tool' ? joined : clean(joined, 200000), toolName };
}

function normUsage(u) {
  const v = (x) => (Number.isFinite(x) ? x : 0);
  return { in: v(u.input_tokens), out: v(u.output_tokens), cacheRead: v(u.cache_read_input_tokens), cacheWrite: v(u.cache_creation_input_tokens) };
}

export function parseCodeLine(line) {
  if (typeof line !== 'string') return null;
  const s = (line.charCodeAt(0) === 0xfeff ? line.slice(1) : line).trim();
  if (!s) return null;
  let j;
  try { j = JSON.parse(s); } catch { return { kind: 'bad' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { kind: 'bad' };
  const sessionId = str(j.sessionId) || str(j.session_id);
  if (j.type === 'custom-title' && typeof j.customTitle === 'string') return { kind: 'title', sessionId, title: clean(j.customTitle, 200), source: 'custom' };
  if (j.type === 'ai-title' && typeof j.aiTitle === 'string') return { kind: 'title', sessionId, title: clean(j.aiTitle, 200), source: 'ai' };
  if (j.type !== 'user' && j.type !== 'assistant') return { kind: 'meta', type: String(j.type || 'unknown') };
  const msg = j.message && typeof j.message === 'object' ? j.message : null;
  if (!msg) return { kind: 'meta', type: j.type };
  const systemish = j.type === 'user' && (!!j.isMeta || !!j.isCompactSummary);
  const { role, text, toolName } = toText(msg.content, j.type, systemish);
  return {
    kind: 'message', sessionId, uuid: str(j.uuid), parentUuid: str(j.parentUuid), at: iso(j.timestamp),
    cwd: str(j.cwd), gitBranch: str(j.gitBranch), isSidechain: !!j.isSidechain, role, text, toolName,
    model: j.type === 'assistant' ? str(msg.model) : null, apiId: j.type === 'assistant' ? str(msg.id) : null,
    usage: j.type === 'assistant' && msg.usage && typeof msg.usage === 'object' ? normUsage(msg.usage) : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard/claude-hub/parse-code.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/parse-code.mjs dashboard/claude-hub/parse-code.test.mjs
git commit -m "fe: Claude Hub H1.3 — Claude Code transcript line parser (messages, titles, tool trimming, robust input)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Incremental ingest + fixtures (`ingest-code.mjs`)

**Files:**
- Create: `dashboard/claude-hub/__fixtures__/make-fixture.mjs`
- Create: `dashboard/claude-hub/ingest-code.mjs`
- Test: `dashboard/claude-hub/ingest-code.test.mjs`

**Interfaces:**
- Consumes:
  - `openStore` and the Store methods from Task 2;
  - `parseCodeLine` from Task 3;
  - `maskSecrets` from Task 1.
- Produces:
  - `ingestFile(store, root, file, { chunkSize?, maxLine? }) → Promise<{ added, bad, skippedLong, reset, tombstoned?, missing? }>`
  - `listTranscripts(root) → Promise<{ file, rel, size, mtimeMs }[]>`, newest first; only `<root>/<folder>/<session>.jsonl`
  - `backfill(store, root, { onProgress?, shouldStop? }) → Promise<{ done, total }>`
  - `sweep(store, root) → Promise<string[]>`: conversation ids that changed
  - `watchRoot(root, onFile: (file) => void, { debounceMs? }) → { close() }`
  - fixtures: `makeClaudeHome(dir) → { home, root, files }`, `userLine(o)`, `assistantLines(o)`, `titleLine(o)`

- [ ] **Step 1: Write the fixture builder**

```js
// dashboard/claude-hub/__fixtures__/make-fixture.mjs
// A placeholder ~/.claude for tests and gates. Placeholder text only — never real data.
import fs from 'node:fs';
import path from 'node:path';

export const userLine = ({ uuid, sessionId, at, cwd = 'C:\\placeholder\\project-a', text, isMeta = false, parentUuid = null }) =>
  JSON.stringify({ type: 'user', uuid, parentUuid, sessionId, timestamp: at, cwd, gitBranch: 'main', isSidechain: false, isMeta,
    message: { role: 'user', content: text } }) + '\n';

// one API response written as one line per content block, each repeating usage (as Claude Code does)
export const assistantLines = ({ apiId, uuids, sessionId, at, cwd = 'C:\\placeholder\\project-a', blocks, usage, model = 'claude-placeholder' }) =>
  blocks.map((b, i) => JSON.stringify({ type: 'assistant', uuid: uuids[i], parentUuid: null, sessionId, timestamp: at, cwd, gitBranch: 'main',
    isSidechain: false, message: { id: apiId, model, role: 'assistant', content: [b], usage } }) + '\n').join('');

export const titleLine = ({ sessionId, title, ai = false }) =>
  JSON.stringify(ai ? { type: 'ai-title', aiTitle: title, sessionId } : { type: 'custom-title', customTitle: title, sessionId }) + '\n';

export function makeClaudeHome(dir) {
  const home = path.join(dir, '.claude'), root = path.join(home, 'projects');
  const a = path.join(root, 'C--placeholder-project-a'), b = path.join(root, 'C--placeholder-project-b');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  fs.mkdirSync(path.join(a, 'sess-a1', 'subagents'), { recursive: true });   // nested folders are ignored in H1
  const usage = { input_tokens: 6, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 };
  const a1 = path.join(a, 'sess-a1.jsonl');
  fs.writeFileSync(a1,
    JSON.stringify({ type: 'file-history-snapshot', messageId: 'x' }) + '\n' +
    userLine({ uuid: 'a1-u1', sessionId: 'sess-a1', at: '2026-10-01T10:00:00.000Z', text: 'Plan the placeholder release' }) +
    assistantLines({ apiId: 'msg_a1', uuids: ['a1-a1', 'a1-a2'], sessionId: 'sess-a1', at: '2026-10-01T10:01:00.000Z',
      blocks: [{ type: 'text', text: 'Here is the plan' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }], usage }) +
    titleLine({ sessionId: 'sess-a1', title: 'Release planning', ai: true }));
  const a2 = path.join(a, 'sess-a2.jsonl');
  fs.writeFileSync(a2, userLine({ uuid: 'a2-u1', sessionId: 'sess-a2', at: '2026-10-02T09:00:00.000Z', text: 'Fix the café bug 🚀' }));
  const b1 = path.join(b, 'sess-b1.jsonl');
  fs.writeFileSync(b1, userLine({ uuid: 'b1-u1', sessionId: 'sess-b1', at: '2026-09-30T08:00:00.000Z', cwd: 'C:\\placeholder\\project-b', text: 'Hello project b' }));
  fs.utimesSync(b1, new Date('2026-09-30T08:00:00Z'), new Date('2026-09-30T08:00:00Z'));
  fs.writeFileSync(path.join(a, 'sess-a1', 'subagents', 'agent-x.jsonl'), userLine({ uuid: 'sub-1', sessionId: 'sess-a1', at: '2026-10-01T10:05:00.000Z', text: 'sub' }));
  return { home, root, files: { a1, a2, b1 } };
}
```

- [ ] **Step 2: Write the failing test**

```js
// dashboard/claude-hub/ingest-code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { ingestFile, listTranscripts, backfill, sweep } from './ingest-code.mjs';
import { makeClaudeHome, userLine, assistantLines } from './__fixtures__/make-fixture.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ingest-'));

test('backfill: newest first, projects named from cwd, titles, tokens once per response, nested folders ignored', async () => {
  const { root } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  const seen = [];
  const r = await backfill(s, root, { onProgress: (p) => seen.push(p) });
  assert.deepEqual(r, { done: 3, total: 3 });
  assert.deepEqual(seen.at(-1), { done: 3, total: 3 });
  const order = (await listTranscripts(root)).map((f) => path.basename(f.file));
  assert.equal(order.at(-1), 'sess-b1.jsonl', 'oldest mtime last');
  assert.deepEqual(order.slice().sort(), ['sess-a1.jsonl', 'sess-a2.jsonl', 'sess-b1.jsonl']);
  const a1 = s.getConversation({ id: 'code:sess-a1' });
  assert.equal(a1.conversation.title, 'Release planning');
  assert.equal(a1.messages.length, 3);
  assert.deepEqual([a1.conversation.tokens_in, a1.conversation.tokens_out], [6, 40], 'two lines, one response → counted once');
  assert.equal(s.listProjects({}).find((p) => p.id === 'code:C--placeholder-project-a').name, 'project-a');
  assert.equal(s.counts().conversations, 3);
  assert.equal(s.search({ q: 'cafe' }).length, 1, 'diacritics folded; the emoji line ingested intact');
});

test('incremental: appends ingest only the new bytes; partial last line waits (Review Focus 5)', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  await ingestFile(s, root, files.a2);
  const extra = userLine({ uuid: 'a2-u2', sessionId: 'sess-a2', at: '2026-10-02T09:01:00.000Z', text: 'second message' });
  fs.appendFileSync(files.a2, extra.slice(0, 20));                      // half a line
  assert.equal((await ingestFile(s, root, files.a2)).added, 0);
  fs.appendFileSync(files.a2, extra.slice(20));
  assert.equal((await ingestFile(s, root, files.a2)).added, 1);
  assert.equal((await ingestFile(s, root, files.a2)).added, 0, 'nothing new → nothing added');
  assert.equal(s.getConversation({ id: 'code:sess-a2' }).messages.length, 2);
});

test('replaced or truncated file is re-ingested from 0 without duplicates (Review Focus 5)', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  await ingestFile(s, root, files.a1);
  fs.writeFileSync(files.a1, userLine({ uuid: 'new-1', sessionId: 'sess-a1', at: '2026-10-03T10:00:00.000Z', text: 'rewritten' }));
  const r = await ingestFile(s, root, files.a1);
  assert.equal(r.reset, true);
  assert.deepEqual(s.getConversation({ id: 'code:sess-a1' }).messages.map((m) => m.text), ['rewritten']);
});

test('CRLF, BOM and multi-byte characters split across tiny chunks (Review Focus 4)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-x');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-x.jsonl');
  const l1 = userLine({ uuid: 'x1', sessionId: 'sess-x', at: '2026-10-01T10:00:00.000Z', text: 'naïve 日本語 🚀' }).replace('\n', '\r\n');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(l1, 'utf8')]));
  const s = openStore(':memory:');
  const r = await ingestFile(s, root, f, { chunkSize: 7 });
  assert.equal(r.added, 1);
  assert.equal(s.getConversation({ id: 'code:sess-x' }).messages[0].text, 'naïve 日本語 🚀');
  assert.equal(s.getCursor(path.relative(root, f)).offset, fs.statSync(f).size, 'byte-exact offset');
});

test('an oversized line is skipped and counted; later lines still ingest; memory bounded (Review Focus 1)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-y');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-y.jsonl');
  const huge = userLine({ uuid: 'y0', sessionId: 'sess-y', at: '2026-10-01T09:00:00.000Z', text: 'z'.repeat(5000) });
  const ok = userLine({ uuid: 'y1', sessionId: 'sess-y', at: '2026-10-01T10:00:00.000Z', text: 'after the giant line' });
  fs.writeFileSync(f, huge + ok);
  const s = openStore(':memory:');
  const r = await ingestFile(s, root, f, { chunkSize: 256, maxLine: 1024 });
  assert.equal(r.skippedLong, 1);
  assert.equal(r.added, 1);
  assert.equal(s.getCursor(path.relative(root, f)).offset, fs.statSync(f).size);
});

test('masked secrets, tombstones respected, sweep reports changed conversations', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  fs.appendFileSync(files.a2, userLine({ uuid: 'a2-s', sessionId: 'sess-a2', at: '2026-10-02T09:05:00.000Z', text: 'key ' + 'sk_' + 'live_' + 'Q'.repeat(24) }));
  await backfill(s, root);
  assert.ok(s.getConversation({ id: 'code:sess-a2' }).messages.some((m) => m.text.includes('••• secret (stripe-key)')));
  s.forget({ conversationId: 'code:sess-b1' });
  fs.appendFileSync(files.b1, userLine({ uuid: 'b1-u2', sessionId: 'sess-b1', at: '2026-10-04T08:00:00.000Z', text: 'more' }));
  fs.appendFileSync(files.a1, userLine({ uuid: 'a1-u9', sessionId: 'sess-a1', at: '2026-10-04T08:00:00.000Z', text: 'more' }));
  const changed = await sweep(s, root);
  assert.deepEqual(changed, ['code:sess-a1']);
  assert.equal(s.getConversation({ id: 'code:sess-b1' }), null, 'forgotten stays forgotten');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub/ingest-code.test.mjs`
Expected: FAIL, `Cannot find module …/ingest-code.mjs`.

- [ ] **Step 4: Write the implementation**

```js
// dashboard/claude-hub/ingest-code.mjs
// Incremental Claude Code ingest (spec §5.1). Streams each transcript from a stored
// byte cursor (never the whole file — one is 630 MB), keeps a partial last line for
// the next run, detects truncated/replaced files by size + a hash of the first bytes,
// and batches inserts in transactions so queries keep flowing during backfill.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCodeLine } from './parse-code.mjs';
import { maskSecrets } from './redact.mjs';

export const HEAD_BYTES = 256;
const BATCH = 500;
const NL = 0x0a;

// '<bytes>:<sha1>' of the first min(HEAD_BYTES, size) bytes. A later check hashes the SAME number
// of bytes, so an append to a short file (< HEAD_BYTES) is not mistaken for a replacement.
async function readHead(file, len = HEAD_BYTES) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return bytesRead + ':' + crypto.createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex');
  } finally { await fh.close(); }
}

const firstLine = (t) => String(t).split('\n').find((l) => l.trim()) || '';

export async function ingestFile(store, root, file, { chunkSize = 1 << 20, maxLine = 64 * 1024 * 1024 } = {}) {
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || !st.isFile()) return { added: 0, bad: 0, skippedLong: 0, reset: false, missing: true };
  const rel = path.relative(root, file);
  const folder = rel.split(path.sep)[0];
  const sessionId = path.basename(file, '.jsonl');
  const projectId = 'code:' + folder, convId = 'code:' + sessionId;
  if (store.isTombstoned('conversation', convId) || store.isTombstoned('project', projectId)) {
    store.setCursor({ file: rel, size: st.size, mtimeMs: st.mtimeMs, offset: st.size, head: null, sessionId });
    return { added: 0, bad: 0, skippedLong: 0, reset: false, tombstoned: true };
  }
  let cur = store.getCursor(rel), reset = false;
  const prevLen = cur && cur.head ? Number(String(cur.head).split(':')[0]) || 0 : 0;
  const headNow = prevLen ? await readHead(file, prevLen) : null;
  if (cur && (st.size < cur.offset || (cur.head && headNow !== cur.head))) {
    store.tx(() => { store.resetConversation(convId); store.deleteCursor(rel); });
    cur = null; reset = true;
  }
  const start = cur ? cur.offset : 0;
  if (start >= st.size) return { added: 0, bad: 0, skippedLong: 0, reset };
  const head = await readHead(file);   // recorded with the cursor (covers min(HEAD_BYTES, size) bytes)

  store.tx(() => {
    store.upsertProject({ id: projectId, source: 'code', key: folder, name: folder, path: null });
    store.ensureConversation({ id: convId, source: 'code', projectId, nativeId: sessionId });
  });

  let offset = start, pending = [], pendingLen = 0, skipping = false;
  let added = 0, bad = 0, skippedLong = 0, batch = [];
  const flush = () => {
    store.tx(() => {
      if (batch.length) added += store.addMessages(convId, batch);
      store.refreshTokens(convId);
      store.setCursor({ file: rel, size: st.size, mtimeMs: st.mtimeMs, offset, head, sessionId });
    });
    batch = [];
  };
  const handle = (lineBuf) => {
    const p = parseCodeLine(lineBuf.toString('utf8'));
    if (!p) return;
    if (p.kind === 'bad') { bad++; return; }
    if (p.kind === 'title') { store.setTitle(convId, p.title, p.source); return; }
    if (p.kind !== 'message') return;
    if (p.cwd) store.upsertProject({ id: projectId, source: 'code', key: folder, name: path.win32.basename(p.cwd) || folder, path: p.cwd });
    store.ensureConversation({ id: convId, source: 'code', projectId, nativeId: sessionId, cwd: p.cwd, gitBranch: p.gitBranch, model: p.model });
    if (p.usage && p.apiId) store.addUsage(convId, p.apiId, p.usage);
    if (!p.text) return;
    const text = maskSecrets(p.text).text;
    const id = 'code:' + (p.uuid || sessionId + '@' + offset);
    batch.push({ id, nativeId: p.uuid, parentId: p.parentUuid, role: p.role, at: p.at, text, toolName: p.toolName, isSidechain: p.isSidechain });
    if (p.role === 'user' && !p.isSidechain) store.setTitle(convId, firstLine(text).slice(0, 80), 'first-prompt');
  };

  const stream = fs.createReadStream(file, { start, end: st.size - 1, highWaterMark: chunkSize });
  for await (const chunk of stream) {
    let from = 0;
    for (;;) {
      const nl = chunk.indexOf(NL, from);
      if (nl === -1) {
        const rest = chunk.subarray(from);
        if (skipping) { offset += rest.length; break; }
        pending.push(rest); pendingLen += rest.length;
        if (pendingLen > maxLine) { skipping = true; skippedLong++; offset += pendingLen; pending = []; pendingLen = 0; }
        break;
      }
      const piece = chunk.subarray(from, nl + 1);
      if (skipping) { offset += piece.length; skipping = false; }
      else {
        const lineBuf = pendingLen ? Buffer.concat([...pending, piece]) : piece;
        pending = []; pendingLen = 0;
        offset += lineBuf.length;
        if (lineBuf.length - 1 > maxLine) skippedLong++; else handle(lineBuf.subarray(0, lineBuf.length - 1));
        if (batch.length >= BATCH) { flush(); await new Promise((r) => setImmediate(r)); }
      }
      from = nl + 1;
    }
  }
  flush();   // the offset excludes a partial last line, which is re-read next time
  return { added, bad, skippedLong, reset };
}

export async function listTranscripts(root) {
  const out = [];
  const dirs = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const files = await fs.promises.readdir(path.join(root, d.name), { withFileTypes: true }).catch(() => []);
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const file = path.join(root, d.name, f.name);
      const st = await fs.promises.stat(file).catch(() => null);
      if (st) out.push({ file, rel: path.relative(root, file), size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function backfill(store, root, { onProgress = () => {}, shouldStop = () => false } = {}) {
  const files = await listTranscripts(root);
  let done = 0;
  onProgress({ done, total: files.length });
  for (const f of files) {
    if (shouldStop()) break;
    try { await ingestFile(store, root, f.file); }
    catch (e) { store.setMeta('last_error', f.rel + ': ' + String(e && e.message || e).slice(0, 300)); }
    done++;
    onProgress({ done, total: files.length });
    await new Promise((r) => setImmediate(r));
  }
  store.setMeta('backfill_done_at', new Date().toISOString());
  return { done, total: files.length };
}

export async function sweep(store, root) {
  const changed = [];
  for (const f of await listTranscripts(root)) {
    const cur = store.getCursor(f.rel);
    if (cur && cur.size === f.size && Math.floor(cur.mtime_ms) === Math.floor(f.mtimeMs)) continue;
    const r = await ingestFile(store, root, f.file).catch(() => null);
    if (r && (r.added > 0 || r.reset)) changed.push('code:' + path.basename(f.file, '.jsonl'));
  }
  return changed;
}

export function watchRoot(root, onFile, { debounceMs = 1000 } = {}) {
  const timers = new Map();
  let w = null;
  try {
    w = fs.watch(root, { recursive: true }, (_evt, name) => {
      if (!name || !String(name).endsWith('.jsonl')) return;
      const parts = String(name).split(/[\\/]/);
      if (parts.length !== 2) return;   // only <folder>/<session>.jsonl
      const file = path.join(root, String(name));
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => { timers.delete(file); onFile(file); }, debounceMs));
    });
  } catch { w = null; }   // a missing root: sweep() still runs on its timer
  return { close() { for (const t of timers.values()) clearTimeout(t); timers.clear(); try { w && w.close(); } catch { /* closed */ } } };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test dashboard/claude-hub/ingest-code.test.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/parse-code.test.mjs dashboard/claude-hub/redact.test.mjs`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add -- dashboard/claude-hub/ingest-code.mjs dashboard/claude-hub/ingest-code.test.mjs dashboard/claude-hub/__fixtures__/make-fixture.mjs
git commit -m "fe: Claude Hub H1.4 — incremental Claude Code ingest (byte cursor, partial lines, replace detection, newest-first backfill, sweep, watch)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Hub process (`hub.mjs`)

**Files:**
- Create: `dashboard/claude-hub/hub.mjs`
- Test: `dashboard/claude-hub/hub.test.mjs`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces:
  - **CLI:** `node --no-warnings dashboard/claude-hub/hub.mjs --db <file>`. Env `HQ_CLAUDE_HOME` overrides `~/.claude`. Env `HQ_HUB_SWEEP_MS` overrides the sweep interval (default 60000).
  - **Protocol:** stdin lines `{id, op, args}`. stdout lines are either `{id, ok:true, result}` / `{id, ok:false, error}`, or `{event, data}` with events `ready`, `progress`, `changed`, `error`.
  - **Ops:**
    - `health → { state: 'indexing'|'ready', role: 'writer'|'reader', node, backfill:{done,total}, counts, dbBytes, lastError }`
    - `listProjects`, `listConversations`, `getConversation`, `search` (args as in Task 2)
    - `reindex → {started:true}` (writer only)
    - `forget → boolean` (writer only)
  - **Lock:** `<db>.lock` holds the writer's pid. A live lock makes this process a **reader**: read-only store, no ingest, no watch.
  - Exported for tests: `resolveClaudeRoot(env)`, `acquireLock(lockFile) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub/hub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeClaudeHome, userLine } from './__fixtures__/make-fixture.mjs';

const HUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.mjs');

function startHub(env, db) {
  const p = spawn(process.execPath, ['--no-warnings', HUB, '--db', db], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0;
  const waiters = new Map(), events = [];
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = JSON.parse(line);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } else if (m.event) events.push(m);
    }
  });
  const req = (op, args = {}) => new Promise((res) => { const n = ++id; waiters.set(n, res); p.stdin.write(JSON.stringify({ id: n, op, args }) + '\n'); });
  const until = async (pred, ms = 15000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 50))) if (pred()) return true; return false; };
  return { p, req, events, until, stop: () => new Promise((r) => { p.on('exit', r); p.stdin.end(); }) };
}

test('protocol: backfill progress, health, list/search, live append → changed (writer)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-proc-'));
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '500' }, path.join(dir, 'hub.sqlite'));
  try {
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.done === e.data.total && e.data.total === 3)));
    let health;
    for (let i = 0; i < 100; i++) { health = (await h.req('health')).result; if (health.state === 'ready') break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(health.role, 'writer'); assert.equal(health.state, 'ready'); assert.equal(health.counts.conversations, 3);
    assert.equal((await h.req('listConversations', { limit: 10 })).result.length, 3);
    assert.equal((await h.req('search', { q: 'placeholder release' })).result[0].conversationId, 'code:sess-a1');
    assert.equal((await h.req('nope')).ok, false);
    fs.appendFileSync(files.a2, userLine({ uuid: 'a2-live', sessionId: 'sess-a2', at: '2026-10-05T10:00:00.000Z', text: 'live line' }));
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('code:sess-a2'))));
    assert.equal((await h.req('search', { q: 'live line' })).result.length, 1);
  } finally { await h.stop(); }
});

test('a second Hub on the same db becomes a read-only reader (Review Focus 2)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-two-'));
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await a.until(() => a.events.some((e) => e.event === 'ready')));
    const b = startHub({ HQ_CLAUDE_HOME: home }, db);
    try {
      assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready')));
      const hb = (await b.req('health')).result;
      assert.equal(hb.role, 'reader');
      assert.equal((await b.req('reindex')).ok, false);
      assert.equal((await b.req('forget', { conversationId: 'code:sess-a1' })).ok, false);
    } finally { await b.stop(); }
  } finally { await a.stop(); }
  assert.equal(fs.existsSync(db + '.lock'), false, 'writer removes its lock on exit');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: FAIL. The spawned process exits because `hub.mjs` is missing, so the `until` waits time out.

- [ ] **Step 3: Write the implementation**

```js
// dashboard/claude-hub/hub.mjs
// Claude Hub process (spec §6). Spawned by dashboard/claude-hub-host.js on system Node ≥ 22.5.
// stdin: one JSON request per line → stdout: one JSON response/event per line. stderr: diagnostics.
// One writer per database (a <db>.lock holding the pid); any other Hub on the same db is a
// read-only reader (e.g. a test instance of the app while the owner's app runs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { backfill, ingestFile, sweep, watchRoot } from './ingest-code.mjs';

export const resolveClaudeRoot = (env = process.env) => path.join(env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude'), 'projects');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(lockFile) {
  for (let i = 0; i < 2; i++) {
    try { const fd = fs.openSync(lockFile, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
    catch (e) {
      if (e.code !== 'EEXIST') return false;
      const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
      if (pid && pid !== process.pid && alive(pid)) return false;
      try { fs.unlinkSync(lockFile); } catch { return false; }   // stale lock from a dead writer
    }
  }
  return false;
}

function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dbFile = arg('--db') || process.env.HQ_CLAUDE_DB;
  if (!dbFile) { process.stderr.write('hub: --db <file> is required\n'); process.exit(2); }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const root = resolveClaudeRoot();
  const lockFile = dbFile + '.lock';
  const writer = acquireLock(lockFile);
  const out = (o) => { try { process.stdout.write(JSON.stringify(o) + '\n'); } catch { /* parent gone */ } };
  const emit = (event, data) => out({ event, data });

  let store;
  try { store = writer ? openStore(dbFile) : (fs.existsSync(dbFile) ? openStore(dbFile, { readOnly: true }) : null); }
  catch (e) { emit('error', { message: String(e.message || e) }); if (writer) try { fs.unlinkSync(lockFile); } catch {} process.exit(3); }

  let state = writer ? 'indexing' : 'ready', progress = { done: 0, total: 0 }, lastError = null, stopping = false;
  let lastProgressAt = 0, watcher = null, sweepTimer = null;
  const changedIds = new Set(); let changedTimer = null;
  const markChanged = (ids) => { for (const id of ids) changedIds.add(id); clearTimeout(changedTimer);
    changedTimer = setTimeout(() => { emit('changed', { ids: [...changedIds] }); changedIds.clear(); }, 300); };
  const dbBytes = () => { let n = 0; for (const f of [dbFile, dbFile + '-wal']) { try { n += fs.statSync(f).size; } catch { /* absent */ } } return n; };

  const ops = {
    health: () => ({ state, role: writer ? 'writer' : 'reader', node: process.version, backfill: progress,
      counts: store ? store.counts() : { projects: 0, conversations: 0, messages: 0 }, dbBytes: dbBytes(), lastError: lastError || (store && store.getMeta && writer ? store.getMeta('last_error') : null) }),
    listProjects: (a) => (store ? store.listProjects(a) : []),
    listConversations: (a) => (store ? store.listConversations(a) : []),
    getConversation: (a) => (store ? store.getConversation(a) : null),
    search: (a) => (store ? store.search(a) : []),
    reindex: () => { if (!writer) throw new Error('read-only hub (another WorkspaceHQ owns the index)'); store.resetCode(); runBackfill(); return { started: true }; },
    forget: (a) => { if (!writer) throw new Error('read-only hub (another WorkspaceHQ owns the index)'); return store.forget(a); },
  };

  async function runBackfill() {
    state = 'indexing';
    await backfill(store, root, { shouldStop: () => stopping, onProgress: (p) => {
      progress = p; const now = Date.now();
      if (p.done === p.total || now - lastProgressAt > 500) { lastProgressAt = now; emit('progress', p); }
    } });
    state = 'ready';
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (!req || typeof req.id !== 'number') return;
    const fn = Object.prototype.hasOwnProperty.call(ops, req.op) ? ops[req.op] : null;
    if (!fn) { out({ id: req.id, ok: false, error: 'unknown op' }); return; }
    try { out({ id: req.id, ok: true, result: fn(req.args || {}) }); }
    catch (e) { out({ id: req.id, ok: false, error: String(e && e.message || e).slice(0, 300) }); }
  });
  const shutdown = () => {
    if (stopping) return; stopping = true;
    clearInterval(sweepTimer); if (watcher) watcher.close();
    try { store && store.close(); } catch { /* closing */ }
    if (writer) try { fs.unlinkSync(lockFile); } catch { /* gone */ }
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGTERM', shutdown);

  emit('ready', { role: writer ? 'writer' : 'reader' });
  if (!writer) return;
  runBackfill().then(() => {
    watcher = watchRoot(root, (file) => ingestFile(store, root, file).then((r) => { if (r.added || r.reset) markChanged(['code:' + path.basename(file, '.jsonl')]); })
      .catch((e) => { lastError = String(e.message || e); emit('error', { message: lastError }); }));
    sweepTimer = setInterval(() => { sweep(store, root).then((ids) => ids.length && markChanged(ids)).catch(() => {}); },
      Number(process.env.HQ_HUB_SWEEP_MS) || 60000);
  }).catch((e) => { lastError = String(e.message || e); state = 'ready'; emit('error', { message: lastError }); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: Claude Hub H1.5 — the Hub process (stdio JSON lines, single writer + read-only readers, watch + sweep)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Main-side host, IPC, contracts, `.gitignore`

**Files:**
- Create: `dashboard/claude-hub-host.js`, `dashboard/claude-hub-host.test.mjs`
- Modify:
  - `dashboard/main.js`: two one-line hooks, in `whenReady` after `require('./ui-prefs').init(…)` (~line 1592) and in `before-quit` (~line 1629)
  - `dashboard/preload.js`: add `claudeHub` next to `uiPrefs`
  - `.gitignore`: add `data/claude/`
  - `docs/sync/IPC-CONTRACT.md`: new rows
  - `docs/sync/CONTRACT.md`: a `data/claude/` entry
  - `dashboard-v5/tools/fake-preload.js` (+ its parity test): mirror `claudeHub`

**Interfaces:**
- Consumes: the Hub CLI and protocol from Task 5.
- Produces:
  - `create({ hubScript, dbFile, env?, spawnFn?, findNodeFn?, send?, log?, backoff? }) → { start(), stop(), request(op, args, { timeout }), health(), state }`
  - `init({ ipcMain, send, dataDir, appLog }) → host`; registers `hq:claude-hub:health` and pushes `hq:claude-hub:event`
  - `findNode({ env, run }) → { cmd, version, ok } | null`, `nodeOk(version) → boolean`
  - preload: `hq.claudeHub.health() → Promise<health>` and `hq.claudeHub.on(cb) → unsubscribe`
  - The renderer's health shape is the Hub's `health` plus host states `'no-node' | 'starting' | 'down'` with `{ node, error }`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub-host.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { create, nodeOk, findNode } = require('./claude-hub-host.js');

const fakeHub = (dir, body) => { const f = path.join(dir, 'fake-hub.mjs'); fs.writeFileSync(f, body); return f; };
const ECHO = `import readline from 'node:readline';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ event: 'ready', data: { role: 'writer' } });
readline.createInterface({ input: process.stdin }).on('line', (l) => { const r = JSON.parse(l);
  if (r.op === 'health') out({ id: r.id, ok: true, result: { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 2, messages: 3 } } });
  else if (r.op === 'slow') {} else out({ id: r.id, ok: false, error: 'unknown op' }); });`;

test('nodeOk / findNode: version floor 22.5 and missing node', () => {
  assert.equal(nodeOk('v22.5.0'), true); assert.equal(nodeOk('v22.4.9'), false); assert.equal(nodeOk('v25.6.1'), true); assert.equal(nodeOk('garbage'), false);
  assert.deepEqual(findNode({ env: {}, run: () => ({ status: 0, stdout: 'v20.18.1\n' }) }), { cmd: 'node', version: 'v20.18.1', ok: false });
  assert.equal(findNode({ env: {}, run: () => { throw new Error('ENOENT'); } }), null);
});

test('no Node ≥ 22.5 → state no-node, health says so, requests answer honestly', async () => {
  const sent = [];
  const h = create({ hubScript: 'x', dbFile: 'y', findNodeFn: () => ({ cmd: 'node', version: 'v20.1.0', ok: false }), send: (c, d) => sent.push([c, d]) });
  h.start();
  assert.deepEqual(await h.health(), { state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.5 or newer (found v20.1.0)' });
  assert.deepEqual(await h.request('health'), { error: 'hub not running' });
  assert.equal(sent.at(-1)[0], 'hq:claude-hub:event');
});

test('spawns the hub, routes requests, times out, forwards events, restarts after a crash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-host-'));
  const script = fakeHub(dir, ECHO);
  const sent = [];
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: () => ({ cmd: process.execPath, version: process.version, ok: true }),
    send: (c, d) => sent.push([c, d]), backoff: [50, 50] });
  h.start();
  try {
    const hl = await h.health();
    assert.equal(hl.state, 'ready'); assert.equal(hl.counts.conversations, 2);
    assert.deepEqual(await h.request('slow', {}, { timeout: 100 }), { error: 'timeout' });
    assert.ok(sent.some(([c, d]) => c === 'hq:claude-hub:event' && d.event === 'ready'));
    h._child().kill();
    for (let i = 0; i < 40 && !(h.state === 'running' && h._restarts() > 0); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(h._restarts() > 0, true);
    assert.equal((await h.health()).state, 'ready');
  } finally { h.stop(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/claude-hub-host.test.mjs`
Expected: FAIL, `Cannot find module './claude-hub-host.js'`.

- [ ] **Step 3: Write the implementation**

```js
// dashboard/claude-hub-host.js
// Main-process side of the Claude Hub (spec §3.1, §6). Electron's Node 20 has no node:sqlite,
// so the index runs in dashboard/claude-hub/hub.mjs on the system Node (≥ 22.5). This module
// finds that Node, spawns the Hub, routes JSON-line requests with timeouts, restarts it with
// backoff, and forwards its events to the windows. It never lets a Hub failure throw into main.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const MIN = [22, 5];
function nodeOk(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]);
}
function findNode({ env = process.env, run = spawnSync } = {}) {
  for (const cmd of [env.HQ_HUB_NODE, 'node'].filter(Boolean)) {
    try {
      const r = run(cmd, ['-p', 'process.version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const v = String((r && r.stdout) || '').trim();
      if (r && r.status === 0 && /^v\d/.test(v)) return { cmd, version: v, ok: nodeOk(v) };
    } catch { /* try the next candidate */ }
  }
  return null;
}

function create({ hubScript, dbFile, env = process.env, spawnFn = spawn, findNodeFn = () => findNode({ env }), send = () => {}, log = null, backoff = [1000, 5000, 30000] } = {}) {
  let child = null, state = 'idle', node = null, error = null, attempt = 0, restarts = 0, stopping = false, seq = 0, timer = null;
  const pending = new Map();
  const push = (event, data) => { try { send('hq:claude-hub:event', { event, data }); } catch { /* window gone */ } };
  const failAll = (msg) => { for (const [, p] of pending) { clearTimeout(p.t); p.resolve({ error: msg }); } pending.clear(); };

  function start() {
    stopping = false;
    node = findNodeFn();
    if (!node || !node.ok) {
      state = 'no-node';
      error = 'Claude Hub needs Node 22.5 or newer (found ' + (node ? node.version : 'none') + ')';
      push('health', { state, node: node ? node.version : null, error });
      return;
    }
    state = 'starting';
    try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch { /* exists or unwritable: the hub reports it */ }
    child = spawnFn(node.cmd, ['--no-warnings', hubScript, '--db', dbFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m && typeof m.id === 'number' && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t);
        p.resolve(m.ok ? m.result : { error: m.error || 'hub error' });
        return;
      }
      if (m && m.event) {
        if (m.event === 'ready') { state = 'running'; attempt = 0; error = null; }
        if (m.event === 'error' && m.data) error = String(m.data.message || '').slice(0, 300);
        push(m.event, m.data);
      }
    });
    child.stderr.on('data', (d) => { if (log) try { log.event('claude-hub-stderr', { text: String(d).slice(0, 300) }); } catch { /* logging only */ } });
    child.on('error', (e) => { error = String(e.message || e); });
    child.on('exit', (code) => {
      child = null; failAll('hub stopped');
      if (stopping) { state = 'idle'; return; }
      if (attempt >= backoff.length) { state = 'down'; error = error || 'Claude Hub exited (' + code + ')'; push('health', { state, node: node.version, error }); return; }
      state = 'starting';
      timer = setTimeout(() => { restarts++; start(); }, backoff[attempt++]);
    });
  }

  function request(op, args = {}, { timeout = 5000 } = {}) {
    if (!child || state !== 'running') return Promise.resolve({ error: 'hub not running' });
    const id = ++seq;
    return new Promise((resolve) => {
      const t = timeout ? setTimeout(() => { pending.delete(id); resolve({ error: 'timeout' }); }, timeout) : null;
      pending.set(id, { resolve, t });
      try { child.stdin.write(JSON.stringify({ id, op, args }) + '\n'); } catch { clearTimeout(t); pending.delete(id); resolve({ error: 'hub not running' }); }
    });
  }

  async function health() {
    if (state === 'no-node' || state === 'down') return { state, node: node ? node.version : null, error };
    for (let i = 0; i < 40 && state === 'starting'; i++) await new Promise((r) => setTimeout(r, 50));
    if (state !== 'running') return { state: state === 'idle' ? 'down' : state, node: node ? node.version : null, error };
    const h = await request('health');
    return h && !h.error ? { ...h, node: h.node || node.version } : { state: 'down', node: node.version, error: h && h.error };
  }

  function stop() {
    stopping = true; clearTimeout(timer);
    if (child) { const c = child; try { c.stdin.end(); } catch { /* closed */ } setTimeout(() => { try { c.kill(); } catch { /* exited */ } }, 2000).unref(); }
  }

  return { start, stop, request, health, get state() { return state; }, _child: () => child, _restarts: () => restarts };
}

function init({ ipcMain, send, dataDir, appLog } = {}) {
  const host = create({
    hubScript: path.join(__dirname, 'claude-hub', 'hub.mjs'),
    dbFile: process.env.HQ_CLAUDE_DB || path.join(dataDir, 'claude', 'hub.sqlite'),
    send, log: appLog || null,
  });
  ipcMain.handle('hq:claude-hub:health', () => host.health());
  host.start();
  return host;
}

module.exports = { create, init, findNode, nodeOk };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard/claude-hub-host.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the contract rows *before* wiring the handler into the app.** Append to `docs/sync/IPC-CONTRACT.md`, in the live v5 section:

```markdown
### Claude Hub (spec 2026-10-13-claude-hub-design.md, phase H1)

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.health()` | `hq:claude-hub:health` (invoke) | `{state:'ready'\|'indexing'\|'no-node'\|'starting'\|'down', role?:'writer'\|'reader', node, backfill?:{done,total}, counts?:{projects,conversations,messages}, dbBytes?, error?/lastError?}` — never throws; `no-node` = system Node < 22.5 or missing |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | `{event:'ready'\|'progress'\|'changed'\|'error'\|'health', data}`; `progress` = `{done,total}` (≤ 2/s), `changed` = `{ids:[conversationId]}` |

Main side: `dashboard/claude-hub-host.js` spawns `dashboard/claude-hub/hub.mjs` on the system Node
(`HQ_HUB_NODE` overrides the binary; `HQ_CLAUDE_DB` the db file; `HQ_CLAUDE_HOME` the `~/.claude`
folder read). One writer per db (`<db>.lock`); a second app instance gets a read-only reader.
```

Add this to `docs/sync/CONTRACT.md`:

```markdown
### `data/claude/` — Claude Hub index (frontend lane, local only, gitignored)

`data/claude/hub.sqlite` (+ `-wal`, `.lock`): SQLite schema v1 (`dashboard/claude-hub/store.mjs`).
Written only by the Hub process; never read by `collector/` or committed. Shape changes bump
`SCHEMA_VERSION`; an older app refuses a newer db instead of corrupting it.
```

Add this to `.gitignore`:

```gitignore
# Claude Hub index — every Claude Code session + claude.ai chat (local, private; never commit)
data/claude/
```

- [ ] **Step 6: Wire the preload, main and fake preload.** Add this to `dashboard/preload.js` inside the exposed object, after `uiPrefs`:

```js
  claudeHub: {
    health: () => ipcRenderer.invoke('hq:claude-hub:health'),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:claude-hub:event', handler);
      return () => ipcRenderer.removeListener('hq:claude-hub:event', handler);
    },
  },
```

In `dashboard/main.js`, add after `require('./ui-prefs').init({ ipcMain, app, nativeTheme, BrowserWindow });`:

```js
    claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog });   // Claude Hub (spec 2026-10-13): index of every Claude Code session
```

Next to the other top-level `let` state near `castSend`, add:

```js
let claudeHub = null;   // Claude Hub host (claude-hub-host.js), set in whenReady
```

Inside `app.on('before-quit', …)`, add:

```js
    try { claudeHub && claudeHub.stop(); } catch {}   // the Hub releases its db lock on stdin close
```

In `dashboard-v5/tools/fake-preload.js`, add a `claudeHub` entry with `health` and `on` using the same patterns as `uiPrefs`. `health` answers `{ state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 3, total: 3 }, counts: { projects: 2, conversations: 3, messages: 5 }, dbBytes: 1048576 }`, and `on` registers for `hqFake.emit('hq:claude-hub:event', …)`. Then run the parity test:

Run: `node --test dashboard-v5/tools/fake-preload.test.mjs dashboard/*.test.mjs`
Expected: PASS (fake-parity included).

- [ ] **Step 7: Smoke-test in a second real instance with fixtures**

```powershell
$fx = node -e "import('./dashboard/claude-hub/__fixtures__/make-fixture.mjs').then(m=>{const d=require('fs').mkdtempSync(require('os').tmpdir()+'/hubfx-');console.log(m.makeClaudeHome(d).home)})"
$env:HQ_CLAUDE_HOME=$fx; $env:HQ_CLAUDE_DB="$env:TEMP\hq-h1-gate\hub.sqlite"
Set-Location dashboard; $p = Start-Process node_modules\electron\dist\electron.exe -ArgumentList ".","--hidden","--user-data-dir=$env:TEMP\hq-h1-gate\profile","--remote-debugging-port=9491" -PassThru
```

Over CDP on 9491, `await hq.claudeHub.health()` must return `role:'writer'` (or `'reader'` if the owner's app already owns the real db; it doesn't here, because `HQ_CLAUDE_DB` points elsewhere) with `counts.conversations === 3`. Stop with `Stop-Process -Id $p.Id` and remove `$env:TEMP\hq-h1-gate` by literal path.

- [ ] **Step 8: Commit**

```bash
git add -- dashboard/claude-hub-host.js dashboard/claude-hub-host.test.mjs dashboard/main.js dashboard/preload.js .gitignore docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs
git commit -m "fe+meta: Claude Hub H1.6 — main-side host (find Node ≥22.5, spawn, route, restart), hq:claude-hub IPC, data/claude gitignored + contracts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The v5 System "Claude Hub" card

**Files:**
- Modify:
  - `dashboard-v5/src/live/store.js`: `live.claudeHub` hydration + push
  - `dashboard-v5/src/vals/system.js`: hub values
  - `dashboard-v5/src/tpl/system.tpl.js`: card markup (marked)
  - `dashboard-v5/src/selftest.js`: combos for each hub state
  - `dashboard-v5/src/vals.golden.test.mjs` + `__golden__/vals.hashes.json` + `tpl.hash.test.mjs`: new scenarios, re-recorded after attribution
- Test: `dashboard-v5/src/logic/claude-hub-card.test.mjs`

**Interfaces:**
- Consumes: `hq.claudeHub.health()` / `.on()` from Task 6.
- Produces:
  - render keys: `hubShow`, `hubState`, `hubColor`, `hubDetail`, `hubSize`, `hubBar`, `hubBarW`
  - pure helper `hubCard(h: health|null, hasBridge: boolean) → { show, state, color, detail, size, bar, barW }` in `dashboard-v5/src/logic/claude-hub.js`, consumed by `vals/system.js`

- [ ] **Step 1: Write the failing test**

```js
// dashboard-v5/src/logic/claude-hub-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubCard } from './claude-hub.js';

test('every hub state reads honestly', () => {
  assert.deepEqual(hubCard(null, false), { show: false, state: '', color: 'var(--muted)', detail: '', size: '', bar: false, barW: '0%' });
  assert.equal(hubCard(null, true).state, 'Starting…');
  const idx = hubCard({ state: 'indexing', backfill: { done: 8, total: 32 }, counts: { projects: 3, conversations: 40, messages: 900 }, dbBytes: 5 * 1048576 }, true);
  assert.equal(idx.state, 'Indexing 8 of 32 sessions'); assert.equal(idx.bar, true); assert.equal(idx.barW, '25%'); assert.equal(idx.size, '5.0 MB');
  const ok = hubCard({ state: 'ready', role: 'writer', counts: { projects: 3, conversations: 40, messages: 900 }, dbBytes: 2048 }, true);
  assert.equal(ok.state, 'Indexed'); assert.equal(ok.detail, '40 chats · 3 projects · 900 messages'); assert.equal(ok.color, 'var(--green)');
  assert.equal(hubCard({ state: 'ready', role: 'reader', counts: { projects: 0, conversations: 0, messages: 0 } }, true).detail,
    'Read-only — another WorkspaceHQ window owns the index · nothing indexed yet');
  assert.equal(hubCard({ state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.5 or newer (found v20.1.0)' }, true).state, 'Needs Node 22.5 or newer (found v20.1.0)');
  assert.equal(hubCard({ state: 'down', error: 'Claude Hub exited (1)' }, true).detail, 'Claude Hub exited (1)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard-v5/src/logic/claude-hub-card.test.mjs`
Expected: FAIL, `Cannot find module './claude-hub.js'`.

- [ ] **Step 3: Write the helper and wire it in**

```js
// dashboard-v5/src/logic/claude-hub.js
// The System card's view of the Claude Hub (spec 2026-10-13 §9 System). Pure; never invents numbers.
const MB = 1048576;
const size = (b) => (Number.isFinite(b) && b > 0 ? (b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB') : '');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function hubCard(h, hasBridge) {
  const none = { show: false, state: '', color: 'var(--muted)', detail: '', size: '', bar: false, barW: '0%' };
  if (!hasBridge) return none;
  if (!h) return { ...none, show: true, state: 'Starting…' };
  const c = h.counts || {};
  const counted = (c.conversations || 0) + (c.projects || 0) > 0
    ? plural(c.conversations || 0, 'chat', 'chats') + ' · ' + plural(c.projects || 0, 'project', 'projects') + ' · ' + plural(c.messages || 0, 'message', 'messages')
    : 'nothing indexed yet';
  if (h.state === 'no-node') return { ...none, show: true, state: 'Needs Node 22.5 or newer (found ' + (h.node || 'none') + ')', color: 'var(--orange)', detail: 'Install Node 22.5+ and restart WorkspaceHQ — nothing else is affected' };
  if (h.state === 'down') return { ...none, show: true, state: 'Not running', color: 'var(--red)', detail: h.error || 'The Claude Hub stopped' };
  if (h.state === 'starting') return { ...none, show: true, state: 'Starting…' };
  if (h.state === 'indexing') {
    const b = h.backfill || {}, total = b.total || 0, done = Math.min(b.done || 0, total);
    return { show: true, state: total ? 'Indexing ' + done + ' of ' + total + ' sessions' : 'Indexing…', color: 'var(--blue)', detail: counted,
      size: size(h.dbBytes), bar: total > 0, barW: (total ? Math.round(done / total * 100) : 0) + '%' };
  }
  const reader = h.role === 'reader' ? 'Read-only — another WorkspaceHQ window owns the index · ' : '';
  return { show: true, state: 'Indexed', color: 'var(--green)', detail: reader + counted + (h.lastError ? ' · last error: ' + String(h.lastError).slice(0, 120) : ''), size: size(h.dbBytes), bar: false, barW: '0%' };
}
```

In `dashboard-v5/src/live/store.js`:
- Add `claudeHub: null,` to the `live` object.
- Inside `start()`, next to the other reads and subscriptions, add the code below. When a progress event reaches `done === total`, re-pull health so the card switches to "Indexed" with fresh counts.

```js
    if (hq.claudeHub && hq.claudeHub.health) reads.push(pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : null; }));
    if (hq.claudeHub && hq.claudeHub.on) sub(() => hq.claudeHub.on((e) => {
      if (!isObj(e)) return;
      if (e.event === 'progress' && isObj(e.data)) {
        live.claudeHub = { ...(live.claudeHub || {}), state: e.data.done >= e.data.total ? 'ready' : 'indexing', backfill: e.data };
        if (e.data.done >= e.data.total) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
      } else if (e.event === 'health' && isObj(e.data)) live.claudeHub = e.data;
      emit();
    }));
```

In `dashboard-v5/src/vals/system.js`, import `hubCard` and add these keys to the returned object:

```js
import { hubCard } from '../logic/claude-hub.js';
// … inside systemVals, before `return {`:
  const hub = hubCard(LIVE.claudeHub, !!this.hq);
// … in the returned object:
    hubShow: hub.show, hubState: hub.state, hubColor: hub.color, hubDetail: hub.detail, hubSize: hub.size, hubHasSize: !!hub.size, hubBar: hub.bar, hubBarW: hub.barW,
```

In `dashboard-v5/src/tpl/system.tpl.js`, insert right after the Vitals `</section>` and before the Machine block's closing `</div>`:

```html
                <!-- v5: Claude Hub (spec 2026-10-13 §9 System) — the local index of every Claude Code session; honest states incl. no Node / read-only -->
                <sc-if value="{{ hubShow }}" hint-placeholder-val="{{ true }}">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:8px">Claude Hub</div>
                    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline"><span style="font-size:16px;color:{{ hubColor }}">{{ hubState }}</span><sc-if value="{{ hubHasSize }}" hint-placeholder-val="{{ true }}"><span style="font-size:12px;color:var(--faint)">{{ hubSize }}</span></sc-if></div>
                    <div style="font-size:13px;color:var(--muted);margin-top:4px">{{ hubDetail }}</div>
                    <sc-if value="{{ hubBar }}" hint-placeholder-val="{{ false }}"><div style="height:4px;background:var(--frame);border-radius:2px;margin-top:10px;overflow:hidden"><div style="height:100%;width:{{ hubBarW }};background:var(--blue)"></div></div></sc-if>
                  </section>
                </sc-if>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard-v5/src/logic/claude-hub-card.test.mjs`
Expected: PASS.

- [ ] **Step 5: Selftest combos, golden scenarios and re-record (with attribution)**
- In `dashboard-v5/src/selftest.js`, add System/machine combos that inject `store.live.claudeHub` into each of: `null`; indexing `{done:8,total:32}`; ready writer; ready reader; `no-node`; `down`. Restore the saved value afterwards, the same way the existing `captures` / `llm` injections are restored.
- In `vals.golden.test.mjs`, add the scenarios `system.hub-indexing`, `system.hub-ready`, `system.hub-reader`, `system.hub-no-node` and `system.hub-down` (each with `live: (L) => { L.claudeHub = … }`, plus `state: tabSub('system','machine')`).
- Run `node --test dashboard-v5/src/vals.golden.test.mjs` without updating, and list every changed scenario. All of them should change only by the new `hub*` keys (renderVals is one flat object). Then re-record with `UPDATE_GOLDEN=1`. Recompute `SHA256` / `LENGTH` / `UTF8_BYTES` in `tpl.hash.test.mjs` with a comment line ("H1 Claude Hub card").
- Run the selftest from `dashboard-v5`:

```powershell
$env:HQ_V5_PROFILE="hq-h1-selftest"; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest
```

Expected: exit 0, `{"errors":0,"unresolved":0,"failures":0}`. Remove `%TEMP%\hq-h1-selftest`.

- [ ] **Step 6: Run the full suites**

Run:
```bash
node --test dashboard/claude-hub/*.test.mjs
node --test dashboard/*.test.mjs
node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -- dashboard-v5/src/logic/claude-hub.js dashboard-v5/src/logic/claude-hub-card.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/vals/system.js dashboard-v5/src/tpl/system.tpl.js dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/src/tpl.hash.test.mjs
git commit -m "fe: Claude Hub H1.7 — System card (indexing progress, counts, read-only, no-Node and down states)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: H1 gate, docs and handoff

**Files:**
- Modify: `CLAUDE.md` (facts: the Hub, test command, env overrides), `README.md` (test command), `docs/sync/HANDOFF.md` (entry).

- [ ] **Step 1: Run the real-instance gate against fixtures.** Use `HQ_CLAUDE_HOME=<fixture>`, `HQ_CLAUDE_DB=<temp>` and `HQ_UI_VERSION=v5` on a second instance with its own `--user-data-dir` and port 9492. Then:
  - Over CDP, open System › Machine and read the card. Expect "Indexed · 3 chats · 2 projects · 5 messages".
  - Append a fixture line and expect the counts to change within 3 s.
  - Kill the Hub child process (only the PID that instance spawned, found via `Get-CimInstance Win32_Process` filtered by its parent PID) and expect the card to show "Starting…" and then "Indexed" again.
  - Confirm `data/claude/` under the repo is untouched (it doesn't exist, or is unchanged).
  - Stop only your PIDs and remove temp folders by literal path.
- [ ] **Step 2: Restart the owner's app** with `tools\rollback.ps1 v5` so the real Hub starts, then confirm `logs/app-*.log` shows the start line. The System card on the owner's machine will show real backfill progress, which is their own data and never committed.
- [ ] **Step 3: Docs.**
  - CLAUDE.md "Facts": add a line "Claude Hub: `dashboard/claude-hub/` (system Node ≥ 22.5, `node:sqlite`) indexes `~/.claude/projects` into gitignored `data/claude/hub.sqlite`; tests `node --test dashboard/claude-hub/*.test.mjs`; overrides `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB`, `HQ_HUB_NODE`."
  - README: add the test command.
  - HANDOFF: an entry with DONE (commits), BREAKS (main.js lines, the new preload, `data/claude/` ignored) and ASKS (none).
- [ ] **Step 4: Commit**

```bash
git add -- CLAUDE.md README.md docs/sync/HANDOFF.md
git commit -m "meta: Claude Hub H1 done — docs, test command, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phases H2–H5 (outline — each gets its own detailed plan before execution)

**H2 Library + activity.**
- **Hub ops:** `stats`, `link`, plus project-link auto-matching by path against `data/latest.json` projects (`link.mjs`).
- **IPC:** `claudeHub.projects/conversations/conversation/search/stats/link/forget`.
- **v5 Claude tab sub-tabs:**
  - Chats: list, filters, FTS search with `\u0002…\u0003` highlights rendered safely, thread view (paged, collapsed tool rows), Forget.
  - Projects: with link chips.
- **Other screens:** the project-page "Claude" section, the History "Claude activity" strip (with active time labelled *estimate*).
- **Tests:** CDP scenarios `claude-library-search`, `claude-thread-open`.

**H3 Chat.**
- `dashboard/claude-chat.js` runs `claude -p --output-format stream-json --verbose --include-partial-messages --permission-prompts none --permission-mode plan|acceptEdits [--resume id]` with prompts on stdin.
- **cwd rule:** a WorkspaceHQ project path, or a Hub-recorded session cwd; never a drive root, system folder or the profile root.
- **Process rules:** a launcher-safe tree stop on Stop; one turn per conversation and 3 in total; a 10-min cap; a unit test pins "never bypass".
- **UI:** a v5 composer with a mode switch and the quota label.
- **Tests:** a fake `claude` shim, and scenarios `claude-chat-stream-stop` and `claude-chat-mode-readonly`.

**H4 claude.ai.**
- **Export import:** `importExport` (main file dialog, streaming unzip into `data/claude/tmp`, a defensive parser plus a counts-only report).
- **Bridge routes:** `GET /claude/sync-state` and `POST /claude/sync` (token, 4 MB cap, schema checks).
- **Extension 0.4.0:** `browser-bridge/claude-sync.js` with the optional `https://claude.ai/*` permission. Read-only GETs, ≤ 1 request / 2 s, backoff, and a shape-change pause. Popup status.
- **UI:** "Continue in Claude Code" seeding (30 000 chars, with a header).
- **Tests:** scenario `claude-import-progress`.

**H5 Ask + vault.**
- **Hub op:** `contextFor({query, budgetChars})`.
- **Ask:** an `llm-context.js` "claude" section, and the v5 Ask chip **Claude history** (`hq-oracle-include.claude`), with answers citing chat and date.
- **Vault:** `dashboard/claude-vault.js` (local-model draft → preview → confirm → atomic write to `VEEMO CORTEX/30_Areas/Claude/<Project>/<date> <title>.md`, never overwriting without confirmation).
- **Tests:** scenarios `ask-claude-chip` and `vault-preview-confirm`.
