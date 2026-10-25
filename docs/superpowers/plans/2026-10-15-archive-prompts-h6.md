# AI archive sources (phase H6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Claude Hub also indexes ChatGPT exports, Claude memory notes, CLAUDE.md files, `~/.claude/history.jsonl` lines and vault prompt notes; a drop folder offers each new export ZIP once in v5; documents appear in Claude › Chats search with a source badge; System shows the counts-only import report.

**Architecture:** Hub-side (system Node, `dashboard/claude-hub/`): store schema 1 → 2 in place (`document` + `document_fts`, `prompt_use`), a pure ChatGPT parser + importer (`ingest-chatgpt.mjs`, re-using `unzip.mjs`/`streamJsonArray`), a docs ingester (`ingest-docs.mjs`: notes by mtime/size, history by byte cursor), and the ops `importChatGPT`, `listDocuments`, `getDocument` (+ `forget({documentId})`) in `hub.mjs`. Main-side (Electron, CommonJS): `claude-hub-host.js` gains two IPC handlers and passes `--vault`; the H4 `claude-import.js` handler takes `kind` and a watcher-issued `dropId`; a NEW `dashboard/claude-imports.js` watches the drop folder, detects the export kind from ZIP entry names, and announces it once. v5: the live store reads documents into search and a document view, keeps a `claudeImports` slot, and the templates add a drop confirm card, an "Import ChatGPT export" button, document hits and the System report.

**Tech Stack:** Node ≥ 22.13 `node:sqlite` (FTS5), `node:test`, Electron 32 main (CommonJS), vanilla v5 renderer (template runtime `src/dc/runtime.js`), fake preload + CDP gate.

**Spec:** `docs/superpowers/specs/2026-10-15-archive-and-prompt-library-design.md` (§3 units ChatGPT ingest / Docs ingest / Store additions / Hub ops / Imports watcher; §4; §5.1; §5.2; §6.3 Search + Imports; §7 importChatGPT / listDocuments / getDocument + IPC `importExport(kind)` / `documents` / `document` / `claudeImports.on`; §8; §9). Hub base spec: `docs/superpowers/specs/2026-10-13-claude-hub-design.md`. Exact live names: `.superpowers/sdd/2026-10-16-code-map-archive.md` (HEAD 4c8da80).

**Written deviations from the spec (the spec is the authority; each has its reason):**
1. `claudeImports` gains `pending()` and `dismiss(dropId)` beside `on(cb)`. Reason: a push alone is lost when it fires before the window subscribes and on every reload (main reloads the window after scans), so "asks once" needs a read and an answer channel. Both are additive rows.
2. Import `progress` / `done` / `failed` stay on the H4 channel `hq:claude-hub:event` (`progress{kind:'import', source}`) for both dialog and drop imports; `hq:claude-imports:event` carries `found` and `error` (watcher-side). Reason: one source of truth for import progress; the H4 strip and store routing already consume it.
3. The confirm card shows the file name and size, not a chat count ("Import ChatGPT export (412 chats)?" in §6.3). Reason: counting means unpacking and parsing the whole export before the owner said yes; honesty forbids an estimate.
4. `claudeHub.importExport()` with no `kind` keeps the H4 meaning (`'claude'`, dialog). `importExport(kind, {dropId})` replaces "path given by the drop watcher": the renderer never sends a path; main maps the opaque `dropId` to the file it found.
5. Search shows `memory` / `claude-md` / `prompt` documents only; `listDocuments` leaves `history` rows out unless `source:'history'` is asked. Reason: §5.2 "they are not shown as chats" — history lines are the harvest pool (P2).
6. No `index_version` bump: the code parser's indexed shape does not change in H6; documents are a new table filled from scratch by the first schema-2 writer.
7. The drop folder is never created by the app (it is outside `data/claude/`); when it is missing the System card says so and how to create it.

## Global Constraints

- Hub runtime: system Node ≥ 22.13; the Electron main process never imports node:sqlite; everything that touches hub.sqlite runs in dashboard/claude-hub/hub.mjs.
- All imported data, indexes, temp files and logs live under data/claude/ (gitignored). Nothing leaves the machine.
- Vault: prompt notes live ONLY under <vault>/40_Resources/Prompts/ (vault root C:\Users\ROG STRIX\Documents\VEEMO CORTEX; env HQ_VAULT_DIR overrides for tests/gates — tests NEVER touch the real vault); WorkspaceHQ writes only NEW notes the owner confirmed, atomically, never overwriting; the owner's other notes are read-only.
- Imports drop folder: C:\Users\ROG STRIX\Documents\WorkspaceHQ Imports\ (env HQ_IMPORTS_DIR); an import always asks once in the UI first; unknown ZIPs are refused with the reason.
- ~/.claude is read-only (HQ_CLAUDE_HOME override); history.jsonl is byte-cursor ingested, never rewritten.
- Fixtures: placeholder text only; secret-shaped strings built at runtime. Every new text path into the index goes through maskSecrets BEFORE any cut (H1 ruling); promoted prompts are written masked.
- Test overrides for EVERY test, harness, second instance and gate: HQ_CLAUDE_DB, HQ_CLAUDE_HOME, HQ_VAULT_DIR, HQ_IMPORTS_DIR, HQ_STUDIO_ROOT, HQ_APP_LOG_DIR, HQ_DRY_LAUNCH=1 — never the owner's real index (data/claude/hub.sqlite is live under the owner's running app), vault, imports folder or ~/.claude.
- IPC: every new channel/field gets a docs/sync/IPC-CONTRACT.md row BEFORE its handler (additive only); main-side code in new files with one-line hooks in dashboard/main.js; list every touched main.js line.
- v5: template additions carry <!-- v5: reason --> and follow the Claude Design visual language; goldens re-recorded only after attributing every changed scenario; src/selftest.js covers every new state/overlay; dashboard-v5/tools/fake-preload.js mirrors every new preload method (fake-parity test); CSP unchanged (no eval, no remote).
- Honesty: no invented numbers; harvest scores show their reasons and never a judgment word; usage counts are real; every Claude/terminal run is labelled "uses your Claude quota"; empty states say why.
- Runs: chat target uses the H3 engine exactly as landed (read-only default, never bypass); terminal target uses the existing launchClaudeTerminal; clipboard-only otherwise.
- External links (spec §2): the only things ever opened outside the app are the two fixed URLs https://claude.ai/new and https://chatgpt.com/, and obsidian://open?vault=<basename of the configured vault root>&file=<note path inside 40_Resources/Prompts/ verified to exist, path-contained>; never a URL or path taken from note text or any other data.
- Store schema changes migrate in place: bump SCHEMA_VERSION by one from the version the Hub fleet left (H1 shipped 1; H2–H5 may have bumped it — read store.mjs), with a migration test on a populated db of that previous version; forget/tombstones apply to documents and candidates; bump index_version when a parser's indexed shape changes.
- Commits: explicit pathspecs (never git add -A), fe: / meta: prefixes, a truthful "Co-Authored-By: Claude <your model name> <noreply@anthropic.com>"; never amend/rebase/reset/stash/checkout; on an index.lock error wait 5 s and retry (up to 5×). Never touch collector/, schema/, run-pipeline.ps1, run-scan.ps1, spellbook/, data/quest-overrides.json, collector/collector.config.json, legacy/.
- Processes: the owner's app (electron.exe . --hidden WITHOUT --user-data-dir and its Hub child) is never stopped; stop only PIDs you start (Stop-Process -Id). Second instances: from dashboard/: node_modules\electron\dist\electron.exe . --hidden --user-data-dir=%TEMP%\<unique> --remote-debugging-port=<your port> with the env overrides. Remove temp folders by literal path.
- Suites: node --test dashboard/claude-hub/*.test.mjs ; node --test dashboard/*.test.mjs ; v5: node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs ; selftest from dashboard-v5: HQ_V5_PROFILE=<unique> ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest (exit 0, 0/0/0); CDP: node dashboard-v5/tools/cdp-gate.mjs --scenario all against a --preload=fake harness.

Standing rulings (binding): Hub errors surface (never swallowed into empty results); the lock is {pid, db} JSON (live owner = node running hub.mjs on the same db); maskSecrets before any cut; message ids per conversation, usage per api_id; paging tiebreaks by (at, id); the spec is the authority and a plan may deviate only with a written reason; the spellbook/ directory is another lane — prompts are NOT spells.

Phase-local facts (from the code map, HEAD 4c8da80): `SCHEMA_VERSION = 1` (store.mjs:7) → this phase ships **2**. `INDEX_VERSION = 2` (ingest-code.mjs:19) stays. Hook lines in `dashboard/main.js`: :1595 (host init — this phase appends `vaultDir: VAULT`), :1598 (claude-import init — unchanged), and ONE new line after :1598 (`claude-imports` init). No other main.js line is touched. `VAULT` is main.js:35.

## Review Focus

1. **A ZIP still being written into the drop folder** (browser download in progress, a 400 MB copy): the owner expects no card until the file is complete, and never a "not a zip" error for a half-copied file. Pinned in Task 8 test `waits for a stable, readable ZIP before announcing`.
2. **A ChatGPT conversation whose `current_node` is missing, dangling, or whose `parent` links loop**: the owner expects that chat skipped and counted (or walked from the newest leaf), never a hang or a crash of the whole import. Pinned in Task 3 test `parent cycle and dangling current_node never hang`.
3. **Re-importing the same (or a newer) ChatGPT export, and importing after a Forget**: no duplicate chats, changed chats replaced, forgotten chats never come back. Pinned in Task 4 test `re-import is idempotent, newer replaces, forgotten stays gone`.
4. **`history.jsonl` growing while the Hub reads it, a partial last line, and the file being rotated/truncated by Claude Code**: no lost or doubled lines, no half-line document, and a truncation re-reads from 0 instead of skipping. Pinned in Task 6 test `partial last line waits; truncation resets; append continues`.
5. **The owner's real paths and secrets leaking into the index or the renderer via a memory note / CLAUDE.md / prompt note containing a token**: the stored text and title are masked before any cut, and the masked form is what search snippets and `getDocument` return. Pinned in Task 5 test `memory and CLAUDE.md text are masked before the cut`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `docs/sync/IPC-CONTRACT.md` | modify (append H6 section) | Rows for `claudeHub.importExport(kind, opts)`, `claudeHub.documents`, `claudeHub.document`, `claudeHub.forget({documentId})`, `claudeImports.on/pending/dismiss`, `progress.source`, `changed.documents`, `health().counts.documents` |
| `docs/sync/CONTRACT.md` | modify (append to `data/claude/` entry) | Schema 2 tables, `web_sync` kind `chatgpt`, `conversation.source='chatgpt'`, `data/claude/imports-seen.json` |
| `dashboard/claude-hub/store.mjs` | modify | `SCHEMA_VERSION = 2`; DDL for `document`, `document_fts` (+ triggers), `prompt_use`; migration 1→2; `upsertDocument`, `removeDocument`, `documentStamps`, `listDocuments`, `getDocument`, `forget({documentId})`, `counts().documents` |
| `dashboard/claude-hub/__fixtures__/make-v1-db.mjs` | create | Builds a populated schema-1 db from the verbatim v1 DDL (migration test input) |
| `dashboard/claude-hub/store.test.mjs` | modify | Migration + document tests |
| `dashboard/claude-hub/ingest-chatgpt.mjs` | create | `parseChatGPTConversation`, `newChatGPTReport`, `ingestChatGPTConversation`, `importChatGPTFile` |
| `dashboard/claude-hub/__fixtures__/make-chatgpt-export.mjs` | create | Placeholder ChatGPT export (two branches, image part, code part, tool node, bad rows) + ZIP writer re-use |
| `dashboard/claude-hub/ingest-chatgpt.test.mjs` | create | Parser + importer tests |
| `dashboard/claude-hub/ingest-docs.mjs` | create | `parseFrontmatter`, `docId`, `listDocSources`, `syncNotes`, `ingestHistory`, `syncDocs`, `watchDocs` |
| `dashboard/claude-hub/__fixtures__/make-docs.mjs` | create | Fixture `~/.claude` memory notes, CLAUDE.md, history.jsonl and a vault Prompts folder |
| `dashboard/claude-hub/ingest-docs.test.mjs` | create | Notes / history tests |
| `dashboard/claude-hub/hub.mjs` | modify | `--vault` arg; ops `importChatGPT`, `listDocuments`, `getDocument`, `forget` documentId; docs sync on start + sweep + `watchDocs`; `changed.documents`; `progress.source` |
| `dashboard/claude-hub/hub.test.mjs` | modify | Spawned-Hub tests for the new ops |
| `dashboard/claude-hub-host.js` | modify | `vaultDir` → `--vault`; IPC `hq:claude-hub:documents`, `hq:claude-hub:document` |
| `dashboard/claude-hub-host.test.mjs` | modify | Spawn args + handler tests |
| `dashboard/claude-import.js` | modify | `hq:claude-hub:import (kind, opts)`: kind routing, `dropId` lookup |
| `dashboard/claude-import.test.mjs` | modify | Kind routing + dropId tests |
| `dashboard/claude-imports.js` | create | Drop-folder watcher: stable-file check, `detectExportKind`, seen file, `found`/`error` push, `pending`/`dismiss` IPC, `takeDrop(dropId)` |
| `dashboard/claude-imports.test.mjs` | create | Watcher tests (temp dirs, fake clock-free polling) |
| `dashboard/preload.js` | modify | `claudeHub.importExport(kind, opts)`, `claudeHub.documents`, `claudeHub.document`, `claudeImports.{on,pending,dismiss}` |
| `dashboard/main.js` | modify :1595 + one new line after :1598 | hooks |
| `dashboard-v5/src/live/adapter.mjs` (+ test) | modify | `DOC_BADGE`, `hubDocHit`, `hubDocument`, `dropCard`, `importReportLines` chatgpt lines |
| `dashboard-v5/src/live/store.js` (+ test) | modify | `claudeLib.docHits/doc`, `openClaudeDocument`, `closeClaudeDocument`, `live.claudeImports`, `refreshClaudeImports` |
| `dashboard-v5/tools/fake-preload.js` | modify | SPEC entries for the new methods |
| `dashboard-v5/src/logic/claude-imports.js` | create | `ciDropConfirm`, `ciDropDismiss`, `clImportChatGPT`, `clOpenDoc`, `clCloseDoc` |
| `dashboard-v5/src/vals/claude-imports.js` | create | `claudeImportsVals` (keys `di*`, `cd*`) |
| `dashboard-v5/src/tpl/claude.tpl.js`, `tpl/extras.tpl.js`, `tpl/system.tpl.js` | modify | Document hits + document view, drop confirm card, ChatGPT button, System report |
| `dashboard-v5/src/app.js`, `src/vals/index.js` | modify | mixin + surface wiring (the System report lines come from `vals/claude-imports.js`) |
| `dashboard-v5/src/selftest.js`, `src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json`, `src/tpl.hash.test.mjs`, `tools/cdp-gate.mjs` | modify | combos, goldens, hash re-record, CDP `imports-drop-confirm`, `search-documents` |
| `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | modify | test commands, facts, handoff entry |

---

### Task 1: Contract rows first (IPC-CONTRACT H6 section + CONTRACT `data/claude/` schema 2)

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (insert a new section immediately BEFORE the `## Rules` heading, after the H5 section)
- Modify: `docs/sync/CONTRACT.md` (append one paragraph at the end of the `data/claude/` — Claude Hub index entry, right after the `(2026-10-16, H4, additive)` paragraph; append one parenthesis to the H5 vault-note entry)

**Interfaces:**
- Consumes: nothing.
- Produces: the names every later task uses, exactly: Hub ops `importChatGPT({zipPath})`, `listDocuments({source?, projectId?, q?, limit?})`, `getDocument({id})`, `forget({documentId})`; preload `claudeHub.importExport(kind?, opts?)`, `claudeHub.documents(opts)`, `claudeHub.document(id)`, `claudeImports.on(cb)`, `claudeImports.pending()`, `claudeImports.dismiss(dropId)`; channels `hq:claude-hub:documents`, `hq:claude-hub:document`, `hq:claude-imports:event`, `hq:claude-imports:pending`, `hq:claude-imports:dismiss`.

- [ ] **Step 1: Write the IPC-CONTRACT section.** Insert this block verbatim before `## Rules`:

````markdown
## 2026-10-25 — AI archive sources, phase H6 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §5, §6.3, §7. Main-side code: handlers added to
`dashboard/claude-hub-host.js` (`registerIpc`) and `dashboard/claude-import.js`; the drop watcher is the NEW file
`dashboard/claude-imports.js` (one new hook line in `main.js`; the host hook line gains `vaultDir: VAULT`).

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.importExport(kind?, opts?)` (H4, extended) | `hq:claude-hub:import` (invoke) | `kind` ∈ `'auto'\|'claude'\|'chatgpt'`; absent = `'claude'` (H4 unchanged). `opts = {dropId?}`: a `dropId` from a `claudeImports` `found` event imports that dropped file with no dialog; no `dropId` = the `.zip` dialog (its title names the kind). `'auto'` detects by ZIP entry names: `conversations.json` + `user.json` ⇒ ChatGPT; `conversations.json` + (`projects.json` or `users.json`) ⇒ claude.ai; no `conversations.json` ⇒ `{error:'Not a ChatGPT or claude.ai export (looked for conversations.json)'}`; `conversations.json` alone ⇒ `{error}` naming the two explicit buttons. A picked/dropped file whose kind differs from an explicit `kind` is refused with both names. → `{started:true, file:<basename>, kind:'claude'\|'chatgpt'}` \| `{canceled:true}` \| `{error}` (`'unknown import kind'`, `'that dropped file is gone or was already handled'`, H4 errors). Never a path from the renderer |
| `claudeHub.documents(opts?)` | `hq:claude-hub:documents` (invoke) | `opts = {source?:'memory'\|'claude-md'\|'prompt'\|'history', projectId?, q?, limit?≤200 (default 50)}` → `[{id, source, path, title, project_id, project_path, mtime_ms, size, origin, snippet?, rank?}]`; without `source`, `history` rows are left out (they are the harvest pool, not chats); with `q`: FTS over title + text, `snippet` uses the U+0002/U+0003 markers of `search` (render as text), order `rank`; without `q`: order `mtime_ms DESC, id DESC`; `[]` when `q` has no letters/digits; `{error}` when the Hub fails (never an empty list for a failure) |
| `claudeHub.document(id)` | `hq:claude-hub:document` (invoke) | in: document id (string ≤ 300) → `{id, source, path, title, text, project_id, project_path, mtime_ms, size, meta}` (`text` masked; `meta` parsed JSON or `null`) \| `null` (unknown or forgotten) \| `{error}` |
| `claudeHub.forget(target)` (H2, extended) | `hq:claude-hub:forget` | gains `{documentId}` → `true` \| `{error:'nothing to forget'}`; removes the row and writes tombstone `('document', id)`; the file on disk is untouched; a forgotten document is never re-indexed |
| `claudeHub.health()` | `hq:claude-hub:health` | `counts` gains `documents` (all sources); `lastImport` gains `source:'claude'\|'chatgpt'` |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | `progress{kind:'import'}` gains `source:'claude'\|'chatgpt'` (absent = claude); a ChatGPT `report` = `{source:'chatgpt', files:{conversations, user, other:[name]}, conversations:{seen, imported, unchanged, forgotten, skipped}, messages:{imported, skipped, empty}, branches:{skipped}, memory:{found, imported}, unknownFields, truncated}` (counts and file/field names only); `changed` may carry `documents:[documentId]` (indexed, updated or removed documents) |
| `claudeImports.on(cb)` | push `hq:claude-imports:event` | `{event:'found', data:{dropId, file:<basename>, bytes, kind:'claude'\|'chatgpt'}}` (a new, complete ZIP in the drop folder, announced once) \| `{event:'error', data:{file, error}}` (a ZIP that is not an export, or unreadable — refused with the reason, nothing imported, nothing deleted) \| `{event:'gone', data:{dropId}}` (answered or the file vanished). Import progress stays on `hq:claude-hub:event` |
| `claudeImports.pending()` | `hq:claude-imports:pending` (invoke) | → `{folder:{exists:boolean, name:'WorkspaceHQ Imports'}, found:[{dropId, file, bytes, kind}], refused:[{file, error}]}` — what the watcher holds now (reloads and late subscribers read it) |
| `claudeImports.dismiss(dropId)` | `hq:claude-imports:dismiss` (invoke) | → `true` \| `false` (unknown id); "Not now": that file (name + size + mtime) is never announced again |

Seen state: `imports-seen.json` next to the Hub db (`data/claude/imports-seen.json`; `HQ_CLAUDE_DB` moves it) `{"<name>|<size>|<mtimeMs>": "imported"|"dismissed"}` — written by main, never in the drop folder.
The app never creates, moves or deletes anything in the drop folder (`HQ_IMPORTS_DIR` overrides it for gates).
Rows from ChatGPT appear in every existing list/search/thread channel with `source:'chatgpt'`, ids `chatgpt:<conversation id>`,
project `chatgpt:chats` ("ChatGPT chats"), `title_source:'web'`, no `cwd`/`git_branch`/tokens (null). Continue on a ChatGPT
chat behaves like a claude.ai chat (a new, seeded Claude Code chat); Save to vault writes `source: chatgpt`.
````

- [ ] **Step 2: Write the CONTRACT paragraph.** Append after the `(2026-10-16, H4, additive)` paragraph of the `data/claude/` entry:

```markdown
(2026-10-25, H6, schema 2 — migrated in place by the first schema-2 writer; an older app refuses the db) New tables:
`document(id PK, source NOT NULL 'memory'|'claude-md'|'prompt'|'history', path, title, text NOT NULL DEFAULT '' (masked),
project_id, project_path, mtime_ms, size, meta JSON)` with FTS5 `document_fts(title, text)` (external content, same tokenizer
as `message_fts`); `prompt_use(prompt_id NOT NULL, at NOT NULL, target NOT NULL, project_id, conversation_id)` (written from
phase P3 on). Ids: `memory:<sha1 of path>`, `memory:chatgpt:<sha1 of text>`, `claude-md:<sha1 of path>`, `prompt:<sha1 of
path>`, `history:<sessionId>:<byte offset>`. `ingest_cursor` row `file='history.jsonl'` = the byte cursor of
`~/.claude/history.jsonl` (never rewritten). `conversation.source` gains `'chatgpt'` (ids `chatgpt:<id>`, project
`chatgpt:chats`); `web_sync` kind `'chatgpt'` de-dups re-imports; tombstone kind `'document'`. `index_version` unchanged.
`data/claude/imports-seen.json` = which dropped ZIPs were answered (main-written).
```

In the H5 vault-note entry, change "`source` (`claude-code` | `claude.ai`)" to "`source` (`claude-code` | `claude.ai` | `chatgpt` — H6, additive)".

- [ ] **Step 3: Check the section has its nine rows.**

Run (Git Bash): `sed -n '/phase H6 (rows written/,/^## Rules/p' docs/sync/IPC-CONTRACT.md | grep -c '^| .claude'`
Expected: `9`

- [ ] **Step 4: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: H6 archive sources — IPC-CONTRACT rows (documents, document, importExport(kind), claudeImports) and CONTRACT schema 2, before any handler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Store schema 2 — `document` + `document_fts`, `prompt_use`, in-place 1→2 migration

**Files:**
- Create: `dashboard/claude-hub/__fixtures__/make-v1-db.mjs`
- Modify: `dashboard/claude-hub/store.mjs` (:7 `SCHEMA_VERSION`, `SCHEMA` :14-43, `migrate` :51-56, `api(db)` :79-319: `forget` :191, `counts` :208, new methods after `getMeta/setMeta`)
- Test: `dashboard/claude-hub/store.test.mjs` (append)

**Interfaces:**
- Consumes: the H1 store as at HEAD (`openStore`, `api(db)` helpers `q(sql)`, `tx(fn)`, `st.tomb`, `st.isTomb`, `ftsQuery`, `SNIP_START`, `SNIP_END`).
- Produces (later tasks call exactly these):
  - `SCHEMA_VERSION = 2`.
  - `store.upsertDocument({id, source, path, title, text, projectId, projectPath, mtimeMs, size, meta}) -> 'added'|'updated'|'unchanged'|'forgotten'` — `meta` is an object or null (stored as JSON); `text`/`title` MUST already be masked by the caller; `'unchanged'` = same path/title/text/meta/project (stamps refreshed only, no FTS write).
  - `store.removeDocument(id) -> boolean` (no tombstone — a vanished file).
  - `store.removeDocuments({source, idPrefix}) -> number` (no tombstone — history reset).
  - `store.documentStamps(source) -> Map<id, {path, mtime_ms, size}>`.
  - `store.listDocuments({source, projectId, q, limit=50}) -> rows` (shape in the IPC row; cap 200).
  - `store.getDocument({id}) -> {id, source, path, title, text, project_id, project_path, mtime_ms, size, meta}|null` (`meta` parsed).
  - `store.forget({documentId}) -> boolean` (tombstone kind `'document'`, native_id = the full id).
  - `store.counts() -> {projects, conversations, messages, documents}`.

- [ ] **Step 1: Write the v1 fixture.** Create `dashboard/claude-hub/__fixtures__/make-v1-db.mjs`. `V1_SCHEMA` is the `SCHEMA` constant of `store.mjs` at HEAD 4c8da80, verbatim (check with `git show 4c8da80:dashboard/claude-hub/store.mjs | sed -n 14,43p` and paste if it differs from the text below):

```js
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
```

- [ ] **Step 2: Write the failing tests.** Append to `dashboard/claude-hub/store.test.mjs` (add ONLY `import { makeV1Db } from './__fixtures__/make-v1-db.mjs';` to the imports — `test`, `assert`, `fs`, `os`, `path`, `DatabaseSync` and `openStore, ftsQuery, SNIP_START, SNIP_END, SCHEMA_VERSION` are already imported at store.test.mjs:2-8 and a second import of the same name is a SyntaxError; the file's own `tmpDb()` helper (store.test.mjs:10) is reused, never redeclared):

```js
// tmpDb() is store.test.mjs:10 — not redeclared here.

test('a populated schema-1 db migrates in place to 2; every v1 row, cursor, tombstone and FTS hit survives', () => {
  const file = makeV1Db(tmpDb());
  const s = openStore(file);
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(s.getMeta('schema_version'), '2');
  assert.equal(s.getMeta('index_version'), '2', 'the code index is not rebuilt by the schema bump');
  assert.deepEqual(s.counts(), { projects: 1, conversations: 1, messages: 2, documents: 0 });
  assert.equal(s.search({ q: 'lanterns' }).length, 1, 'message_fts still answers');
  assert.equal(s.getCursor('C--placeholder-project-a\\s1.jsonl').offset, 123);
  assert.equal(s.isTombstoned('conversation', 'code:gone'), true);
  assert.equal(s.getSync('conversation', 'web-uuid-1').updated_at, '2026-10-01T00:00:00Z');
  assert.equal(s.listProjects({})[0].link_state, 'confirmed');
  s.close();
  const again = openStore(file);   // a second open is a no-op
  assert.equal(again.getMeta('schema_version'), '2');
  assert.deepEqual(again.counts(), { projects: 1, conversations: 1, messages: 2, documents: 0 });
  again.close();
});

test('a db stamped newer than this app is refused BEFORE any DDL runs on it', () => {
  const file = makeV1Db(tmpDb(), { schemaVersion: '3' });
  assert.throws(() => openStore(file), /newer WorkspaceHQ \(schema 3\)/);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'document'").get(), undefined, 'nothing was created');
  db.close();
});

test('documents: upsert is idempotent, FTS + snippet, history hidden unless asked, forget tombstones', () => {
  const s = openStore(':memory:');
  const d = { id: 'memory:aa', source: 'memory', path: 'C:\\h\\.claude\\projects\\p\\memory\\a.md', title: 'Placeholder lantern note',
    text: 'the lantern keeper placeholder', projectId: 'code:p', projectPath: 'C:\\placeholder\\p', mtimeMs: 1, size: 10, meta: { type: 'user' } };
  assert.equal(s.upsertDocument(d), 'added');
  assert.equal(s.upsertDocument({ ...d, mtimeMs: 2 }), 'unchanged', 'stamps only');
  assert.equal(s.upsertDocument({ ...d, text: 'the lantern keeper placeholder, edited', mtimeMs: 3 }), 'updated');
  assert.equal(s.upsertDocument({ id: 'history:s1:0', source: 'history', path: null, title: null, text: 'lantern from history',
    projectId: null, projectPath: 'C:\\placeholder\\p', mtimeMs: null, size: null, meta: { sessionId: 's1', pasted: false } }), 'added');
  const hits = s.listDocuments({ q: 'lantern' });
  assert.deepEqual(hits.map((r) => r.id), ['memory:aa'], 'history rows are the harvest pool, not search results');
  assert.ok(hits[0].snippet.includes(SNIP_START) && hits[0].snippet.includes(SNIP_END));
  assert.equal(s.listDocuments({ q: 'lantern', source: 'history' }).length, 1);
  assert.deepEqual(s.listDocuments({ q: '!!!' }), []);
  assert.equal(s.listDocuments({ q: 'edited' }).length, 1, 'the update reached the FTS index');
  assert.equal(s.listDocuments({ q: 'keeper placeholder' }).length, 1);
  const got = s.getDocument({ id: 'memory:aa' });
  assert.deepEqual(got.meta, { type: 'user' });
  assert.equal(got.text, 'the lantern keeper placeholder, edited');
  assert.equal(s.documentStamps('memory').get('memory:aa').mtime_ms, 3);
  assert.equal(s.counts().documents, 2);
  assert.equal(s.forget({ documentId: 'memory:aa' }), true);
  assert.equal(s.forget({ documentId: 'memory:aa' }), false);
  assert.equal(s.getDocument({ id: 'memory:aa' }), null);
  assert.equal(s.listDocuments({ q: 'edited' }).length, 0, 'FTS row gone too');
  assert.equal(s.upsertDocument(d), 'forgotten', 'a forgotten document is never re-indexed');
  assert.equal(s.removeDocuments({ source: 'history', idPrefix: 'history:' }), 1);
  assert.equal(s.counts().documents, 0);
  s.close();
});
```

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL — `SCHEMA_VERSION` is 1, `counts()` lacks `documents`, `s.upsertDocument is not a function`.

- [ ] **Step 4: Implement.** In `store.mjs`:

(a) `export const SCHEMA_VERSION = 2;`

(b) Append to the `SCHEMA` template string, after the `tombstone` line (an UPSERT, never `INSERT OR REPLACE`: REPLACE deletes without firing `document_ad` — recursive_triggers is off — and would leave stale FTS rows):

```sql
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
```

(c) Replace `migrate(db)`:

```js
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
```

(d) In `api(db)`: `forget(target)` — add as the FIRST branch inside its `tx`:

```js
        if (target && typeof target.documentId === 'string' && target.documentId) {
          const r = q('DELETE FROM document WHERE id = ?').run(target.documentId);
          if (!r.changes) return false;
          st.tomb.run('document', target.documentId, now);
          return true;
        }
```

`counts`: `counts: () => ({ projects: st.countP.get().c, conversations: st.countC.get().c, messages: st.countM.get().c, documents: q('SELECT COUNT(*) AS c FROM document').get().c }),`

New methods (add after `setMeta`):

```js
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
      const cols = "d.id, d.source, d.path, d.title, d.project_id, d.project_path, d.mtime_ms, d.size, json_extract(d.meta, '$.origin') AS origin";
      const w = [], a = [];
      if (source) { w.push('d.source = ?'); a.push(source); } else w.push("d.source <> 'history'");
      if (projectId) { w.push('d.project_id = ?'); a.push(projectId); }
      if (query !== undefined && query !== null && String(query).trim() !== '') {
        const m = ftsQuery(query);
        if (!m) return [];
        // errors surface (same reasoning as search): a failing MATCH must not look like "no documents"
        return q(`SELECT ${cols}, snippet(document_fts, 1, '${SNIP_START}', '${SNIP_END}', '…', 12) AS snippet, bm25(document_fts) AS rank
          FROM document_fts JOIN document d ON d.rowid = document_fts.rowid WHERE document_fts MATCH ? AND ${w.join(' AND ')} ORDER BY rank LIMIT ?`).all(m, ...a, lim);
      }
      return q(`SELECT ${cols} FROM document d WHERE ${w.join(' AND ')} ORDER BY d.mtime_ms DESC, d.id DESC LIMIT ?`).all(...a, lim);
    },
    getDocument({ id } = {}) {
      const r = typeof id === 'string' ? q('SELECT id, source, path, title, text, project_id, project_path, mtime_ms, size, meta FROM document WHERE id = ?').get(id) : null;
      if (!r) return null;
      let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }
      return { ...r, meta };
    },
```

If the `snippet` of a title-only hit comes back empty, that is accepted (column 1 = text); the v5 hit shows the title.

- [ ] **Step 5: Run the Hub suite.**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS (all; `hub.mjs`'s no-store `counts` fallback is untouched until Task 7, which updates it and its test together).

- [ ] **Step 6: Commit**

```bash
git add dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/__fixtures__/make-v1-db.mjs
git commit -m "fe: H6.2 — Hub store schema 2 (document + document_fts, prompt_use), in-place 1→2 migration tested on a populated v1 db, document forget tombstones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: ChatGPT conversation parser (branch walk, parts mapping, masking) + placeholder export fixture

**Files:**
- Create: `dashboard/claude-hub/__fixtures__/make-chatgpt-export.mjs`
- Create: `dashboard/claude-hub/ingest-chatgpt.mjs` (parser half; Task 4 adds the importer to the same file)
- Test: `dashboard/claude-hub/ingest-chatgpt.test.mjs`

**Interfaces:**
- Consumes: `maskSecrets(s) -> {text,hits}` (redact.mjs:24); `cutText(s,max)`, `TEXT_MAX`, `TOOL_RESULT_MAX` (parse-code.mjs); `UUID_RE`, `newReport()` (parse-web.mjs:8, :28); `zipFiles(file, files)` (`__fixtures__/make-export.mjs:5`).
- Produces:
  - `parseChatGPTConversation(raw) -> {ok:false, reason} | {ok:true, conv:{id, title, createdAt, updatedAt, model, messages:[{nodeId, parentId, role, at, text, toolName}]}, branches, skipped, empty, unknown:[fieldName]}` — `role` ∈ `user|assistant|system|tool`; `branches` = leaf nodes not on the walked path; `skipped` = nodes with a message that were not mapped (hidden, unknown role); `empty` = mapped nodes with no text.
  - `epochIso(v) -> string|null`.
  - Fixture: `chatgptFixture({secret}) -> {conversations:[...], user:{...}}`, `writeChatGPTZip(file, {conversations, user, extra:[{name,data}]} = {}) -> file`, `CG_IDS = {a, b, loop, dangling}`.

- [ ] **Step 1: Write the fixture.** Create `dashboard/claude-hub/__fixtures__/make-chatgpt-export.mjs`:

```js
// Placeholder ChatGPT data export for tests and gates (spec 2026-10-15 §5.1, §9). Placeholder text only; the secret-shaped
// string is built at runtime by the caller; ZIPs are written at runtime.
import { zipFiles } from './make-export.mjs';

export const CG_IDS = { a: 'cg-0001-aaaa', b: 'cg-0002-bbbb', loop: 'cg-0003-loop', dangling: 'cg-0004-dang', empty: 'cg-0005-empt' };
const m = (id, role, t, content, { name = null, hidden = false } = {}) =>
  ({ id, author: { role, name, metadata: {} }, create_time: t, content, status: 'finished_successfully',
    metadata: hidden ? { is_visually_hidden_from_conversation: true } : {} });
const text = (...parts) => ({ content_type: 'text', parts });
const node = (id, parent, children, message = null) => ({ id, message, parent, children });

export function chatgptFixture({ secret = 'sk-' + 'proj-' + 'Q'.repeat(40) } = {}) {
  const T = 1759320000;   // 2025-10-01T12:00:00Z
  const a = {
    title: 'Placeholder lantern festival', create_time: T, update_time: T + 600, conversation_id: CG_IDS.a, id: CG_IDS.a,
    current_node: 'n6', default_model_slug: 'placeholder-model', some_future_field: 1,
    mapping: {
      n0: node('n0', null, ['n1']),
      n1: node('n1', 'n0', ['n2'], m('n1', 'system', T, text(''), { hidden: true })),
      n2: node('n2', 'n1', ['n3a', 'n3b'], m('n2', 'user', T + 10, text('Placeholder: plan the lantern festival'))),
      n3a: node('n3a', 'n2', [], m('n3a', 'assistant', T + 20, text('an older branch answer'))),
      n3b: node('n3b', 'n2', ['n4'], m('n3b', 'assistant', T + 30, { content_type: 'multimodal_text', parts: ['Here is a sketch', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://placeholder' }] })),
      n4: node('n4', 'n3b', ['n5'], m('n4', 'assistant', T + 40, { content_type: 'code', language: 'python', text: 'print(1)' })),
      n5: node('n5', 'n4', ['n6'], m('n5', 'tool', T + 50, { content_type: 'execution_output', text: '1' }, { name: 'python' })),
      n6: node('n6', 'n5', [], m('n6', 'assistant', T + 60, text('Done — the token is ' + secret))),
    },
  };
  const b = { title: 'Placeholder second chat', create_time: T + 1000, update_time: T + 1100, conversation_id: CG_IDS.b, current_node: 'b2',
    mapping: { b1: node('b1', null, ['b2'], m('b1', 'user', T + 1000, text('placeholder hello'))), b2: node('b2', 'b1', [], m('b2', 'assistant', T + 1100, text('placeholder hi'))) } };
  const loop = { title: 'Placeholder loop', create_time: T, update_time: T, conversation_id: CG_IDS.loop, current_node: 'l2',
    mapping: { l1: node('l1', 'l2', ['l2'], m('l1', 'user', T, text('placeholder loop one'))), l2: node('l2', 'l1', ['l1'], m('l2', 'assistant', T + 1, text('placeholder loop two'))) } };
  const dangling = { title: 'Placeholder dangling', create_time: T, update_time: T, conversation_id: CG_IDS.dangling, current_node: 'missing-node',
    mapping: { d1: node('d1', null, ['d2', 'd3']), d2: node('d2', 'd1', [], m('d2', 'user', T + 5, text('placeholder older leaf'))), d3: node('d3', 'd1', [], m('d3', 'user', T + 9, text('placeholder newest leaf'))) } };
  const empty = { title: 'Placeholder empty', create_time: T, update_time: T, conversation_id: CG_IDS.empty, current_node: 'e1',
    mapping: { e1: node('e1', null, [], m('e1', 'system', T, text(''))) } };
  return { conversations: [a, b, loop, dangling, empty, { title: 'no id', mapping: {} }, 'not an object'], user: { id: 'user-placeholder', chatgpt_plus_user: false } };
}

export function writeChatGPTZip(file, { conversations, user, extra = [] } = {}) {
  const f = chatgptFixture();
  zipFiles(file, [
    { name: 'conversations.json', data: JSON.stringify(conversations ?? f.conversations) },
    { name: 'user.json', data: JSON.stringify(user ?? f.user) },
    { name: 'message_feedback.json', data: '[]' },
    { name: 'chat.html', data: '<html>placeholder</html>' },
    ...extra,
  ]);
  return file;   // zipFiles writes the file and returns nothing
}
```

- [ ] **Step 2: Write the failing tests.** Create `dashboard/claude-hub/ingest-chatgpt.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation, epochIso } from './ingest-chatgpt.mjs';
import { chatgptFixture, CG_IDS } from './__fixtures__/make-chatgpt-export.mjs';

const SECRET = 'sk-' + 'proj-' + 'Q'.repeat(40);
const conv = (id) => chatgptFixture({ secret: SECRET }).conversations.find((c) => c && c.conversation_id === id);

test('the current branch is walked root → current_node; the other branch is counted, not imported', () => {
  const r = parseChatGPTConversation(conv(CG_IDS.a));
  assert.equal(r.ok, true);
  assert.equal(r.conv.id, CG_IDS.a);
  assert.equal(r.conv.title, 'Placeholder lantern festival');
  assert.equal(r.conv.model, 'placeholder-model');
  assert.equal(r.conv.createdAt, '2025-10-01T12:00:00.000Z');
  assert.deepEqual(r.conv.messages.map((x) => [x.nodeId, x.role]), [['n2', 'user'], ['n3b', 'assistant'], ['n4', 'assistant'], ['n5', 'tool'], ['n6', 'assistant']]);
  assert.equal(r.branches, 1, 'n3a is another leaf');
  assert.equal(r.skipped, 1, 'the hidden system node');
  assert.deepEqual(r.unknown, ['some_future_field']);
});

test('parts mapping: image → [image], code → fenced, tool output, parents chain along the walk', () => {
  const { conv: c } = parseChatGPTConversation(conv(CG_IDS.a));
  assert.equal(c.messages[1].text, 'Here is a sketch\n[image]');
  assert.equal(c.messages[2].text, '```python\nprint(1)\n```');
  assert.equal(c.messages[3].text, '1'); assert.equal(c.messages[3].toolName, 'python');
  assert.equal(c.messages[0].parentId, null);
  assert.equal(c.messages[1].parentId, 'n2');
  assert.equal(c.messages[0].at, '2025-10-01T12:00:10.000Z');
});

test('secrets are masked before any cut', () => {
  const { conv: c } = parseChatGPTConversation(conv(CG_IDS.a));
  const last = c.messages[c.messages.length - 1].text;
  assert.ok(!last.includes(SECRET));
  assert.match(last, /••• secret \(openai-key\)/);
  const long = chatgptFixture({ secret: SECRET }).conversations[0];
  // the space keeps redact.mjs's `\bsk-` word boundary (an 'x' run glued to 'sk-' is not a secret shape at all); the secret
  // starts at 199991, so a cut-before-mask would keep 'sk-proj-Q' (9 chars) at the end of the 200000-char cut
  long.mapping.n6.message.content.parts = ['x'.repeat(199990) + ' ' + SECRET];
  const t = parseChatGPTConversation(long).conv.messages.at(-1).text;
  assert.ok(!t.includes('sk-proj-'), 'a secret straddling the cut is masked, not half-kept');
});

test('parent cycle and dangling current_node never hang', () => {
  const loop = parseChatGPTConversation(conv(CG_IDS.loop));
  assert.equal(loop.ok, true);
  assert.equal(loop.conv.messages.length, 2);
  const d = parseChatGPTConversation(conv(CG_IDS.dangling));
  assert.equal(d.ok, true);
  assert.deepEqual(d.conv.messages.map((x) => x.text), ['placeholder newest leaf'], 'walks from the newest leaf');
  assert.equal(d.branches, 1);
});

test('bad rows are refused with a reason; an empty chat parses with no messages', () => {
  assert.deepEqual(parseChatGPTConversation('not an object'), { ok: false, reason: 'not an object' });
  assert.equal(parseChatGPTConversation({ title: 'no id', mapping: {} }).reason, 'no conversation id');
  assert.equal(parseChatGPTConversation({ conversation_id: 'x-1' }).reason, 'no mapping');
  const e = parseChatGPTConversation(conv(CG_IDS.empty));
  assert.equal(e.ok, true); assert.equal(e.conv.messages.length, 0);
  assert.equal(epochIso('soon'), null); assert.equal(epochIso(0), null); assert.equal(epochIso(1e20), null); assert.equal(epochIso('1e13'), null);
});
```

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard/claude-hub/ingest-chatgpt.test.mjs`
Expected: FAIL — `Cannot find module './ingest-chatgpt.mjs'`.

- [ ] **Step 4: Implement the parser.** Create `dashboard/claude-hub/ingest-chatgpt.mjs`:

```js
// ChatGPT data export (spec 2026-10-15 §5.1). Pure parser here; the importer (Task 4) below it. Ids: conversation
// 'chatgpt:<id>', message 'chatgpt:<id>:<node id|@index>', project CHATGPT_CHATS. maskSecrets on the FULL text before any cut.
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX, TOOL_RESULT_MAX } from './parse-code.mjs';
import { UUID_RE } from './parse-web.mjs';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(String(s))).text;
const ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const KNOWN_CONV = new Set(['title', 'create_time', 'update_time', 'mapping', 'current_node', 'conversation_id', 'id', 'default_model_slug',
  'moderation_results', 'plugin_ids', 'gizmo_id', 'gizmo_type', 'is_archived', 'safe_urls', 'blocked_urls', 'conversation_template_id',
  'voice', 'async_status', 'disabled_tool_ids', 'is_do_not_remember', 'memory_scope', 'conversation_origin', 'is_starred', 'is_read_only',
  'sugar_item_id', 'sugar_item_visible', 'owner', 'context_scopes', 'pinned_time', 'is_study_mode']);

export function epochIso(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!(Number.isFinite(n) && n > 0)) return null;
  const d = new Date(Math.round(n * 1000));   // out-of-range epochs (> 8.64e15 ms) make an Invalid Date, never a throw
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function partText(p) {
  if (typeof p === 'string') return p;
  if (isObj(p)) return /image/i.test(str(p.content_type)) ? '[image]' : '[attachment]';
  return '';
}

function contentText(c) {
  if (!isObj(c)) return '';
  const type = str(c.content_type);
  if (type === 'code') return '```' + str(c.language).replace(/[^\w+-]/g, '').slice(0, 20) + '\n' + str(c.text) + '\n```';
  if (type === 'execution_output') return str(c.text);
  if (Array.isArray(c.parts)) return c.parts.map(partText).filter((s) => s !== '').join('\n');
  if (typeof c.text === 'string') return c.text;
  if (typeof c.result === 'string') return c.result;
  return '';
}

// root → leaf ids of the branch the owner last saw. The walk is bounded (seen set): a parent cycle ends it.
function walk(mapping, current) {
  let leaf = typeof current === 'string' && isObj(mapping[current]) ? current : null;
  const leaves = Object.keys(mapping).filter((k) => isObj(mapping[k]) && !(Array.isArray(mapping[k].children) && mapping[k].children.length));
  if (!leaf) {   // dangling or missing current_node: the newest leaf (create_time, then id) is the best guess
    const t = (k) => (isObj(mapping[k].message) && Number(mapping[k].message.create_time)) || 0;
    leaf = leaves.slice().sort((x, y) => t(y) - t(x) || (x < y ? -1 : 1))[0] || null;
  }
  const path = [], seen = new Set();
  for (let id = leaf; typeof id === 'string' && isObj(mapping[id]) && !seen.has(id); id = mapping[id].parent) { seen.add(id); path.push(id); }
  return { path: path.reverse(), branches: Math.max(0, leaves.filter((k) => k !== leaf).length) };
}

export function parseChatGPTConversation(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  const id = str(raw.conversation_id) || str(raw.id);
  if (!UUID_RE.test(id)) return { ok: false, reason: 'no conversation id' };
  if (!isObj(raw.mapping)) return { ok: false, reason: 'no mapping' };
  const unknown = Object.keys(raw).filter((k) => !KNOWN_CONV.has(k));
  const createdAt = epochIso(raw.create_time), updatedAt = epochIso(raw.update_time) || createdAt;
  const { path, branches } = walk(raw.mapping, raw.current_node);
  const messages = [];
  let skipped = 0, empty = 0, prev = null;
  path.forEach((nodeId, i) => {
    const msg = raw.mapping[nodeId].message;
    if (!isObj(msg)) return;   // structural root
    const role = isObj(msg.author) ? str(msg.author.role) : '';
    if (!ROLES.has(role) || (isObj(msg.metadata) && msg.metadata.is_visually_hidden_from_conversation)) { skipped++; return; }
    const body = safe(contentText(msg.content)).trim();
    if (!body) { empty++; return; }
    const text = cutText(body, role === 'tool' ? TOOL_RESULT_MAX : TEXT_MAX);
    const nid = UUID_RE.test(nodeId) ? nodeId : '@' + i;
    messages.push({ nodeId: nid, parentId: prev, role, at: epochIso(msg.create_time) || updatedAt, text,
      toolName: role === 'tool' ? cutText(safe(str(msg.author.name) || 'tool'), 80) : null });
    prev = nid;
  });
  const title = cutText(safe(str(raw.title)).trim(), 200) || null;
  const model = str(raw.default_model_slug) ? cutText(safe(raw.default_model_slug), 80) : null;
  return { ok: true, conv: { id, title, createdAt, updatedAt, model, messages }, branches, skipped, empty, unknown };
}
```

Note the empty system node `n1` in fixture conversation a is hidden → `skipped`; the empty system root of `empty` is not hidden → `empty`.

- [ ] **Step 5: Run to verify they pass.**

Run: `node --test dashboard/claude-hub/ingest-chatgpt.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard/claude-hub/ingest-chatgpt.mjs dashboard/claude-hub/ingest-chatgpt.test.mjs dashboard/claude-hub/__fixtures__/make-chatgpt-export.mjs
git commit -m "fe: H6.3 — ChatGPT export parser (current-branch walk, cycle-safe, image/code/tool parts, masked before the cut) + placeholder export fixture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: ChatGPT importer (streaming unzip into data/claude/tmp, web_sync de-dup, tombstones, counts-only report, memory file)

**Files:**
- Modify: `dashboard/claude-hub/ingest-chatgpt.mjs` (append the importer)
- Test: `dashboard/claude-hub/ingest-chatgpt.test.mjs` (append)

**Interfaces:**
- Consumes: Task 3 `parseChatGPTConversation`; Task 2 `store.upsertDocument`, `store.listDocuments`; store H1/H4 API `tx, isTombstoned, getSync, setSync, upsertProject, resetConversation, ensureConversation, setTitle, addMessages, forget, listConversations, getConversation, search`; `extractEntries(file, wanted, outDir, {maxBytes})`, `readZipIndex(file) -> {size, entries:[{name}]}`, `baseName(n)` (unzip.mjs); `streamJsonArray(file, onItem) -> {items, bad, truncated}`, `noteUnknown(report, names)` (parse-web.mjs).
- Produces:
  - `CHATGPT_CHATS = 'chatgpt:chats'`.
  - `newChatGPTReport() -> {source:'chatgpt', files:{conversations, user, other:[name]}, conversations:{seen, imported, unchanged, forgotten, skipped}, messages:{imported, skipped, empty}, branches:{skipped}, memory:{found, imported}, unknownFields:{}, truncated}`.
  - `ingestChatGPTConversation(store, conv, report) -> 'imported'|'unchanged'|'forgotten'|'empty'`.
  - `importChatGPTFile(store, zipPath, {tmpRoot, onProgress, onImported, maxBytes}) -> Promise<report>`; rejects (nothing imported) with `'Not a ChatGPT or claude.ai export (looked for conversations.json)'` or `'This looks like a claude.ai export (projects.json / users.json, no user.json) — use Import claude.ai export'`. `onProgress({phase:'unzip'|'conversations', done, total:0})`, `onImported(ids)` every 200 chats and at the end.

- [ ] **Step 1: Write the failing tests.** Append to `dashboard/claude-hub/ingest-chatgpt.test.mjs` (extend imports: `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { openStore } from './store.mjs'; import { importChatGPTFile, CHATGPT_CHATS } from './ingest-chatgpt.mjs'; import { writeChatGPTZip } from './__fixtures__/make-chatgpt-export.mjs'; import { zipFiles } from './__fixtures__/make-export.mjs';`):

```js
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cg-'));

test('import: counts only, current branches, ChatGPT project, searchable, tmp cleaned', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), zip = writeChatGPTZip(path.join(dir, 'export.zip'));
  const s = openStore(':memory:');
  const phases = [], announced = [];
  const r = await importChatGPTFile(s, zip, { tmpRoot, onProgress: (p) => phases.push(p.phase), onImported: (ids) => announced.push(...ids) });
  assert.deepEqual(r.conversations, { seen: 7, imported: 4, unchanged: 0, forgotten: 0, skipped: 3 });
  assert.equal(r.messages.imported, 10);
  assert.equal(r.branches.skipped, 2);
  assert.deepEqual(r.files, { conversations: true, user: true, other: ['chat.html', 'message_feedback.json'] });
  assert.deepEqual(r.memory, { found: false, imported: 0 });
  assert.deepEqual(r.unknownFields, { some_future_field: 1 });
  assert.ok(!JSON.stringify(r).includes('lantern'), 'the report never holds chat text');
  assert.ok(phases.includes('unzip') && phases.includes('conversations'));
  assert.equal(announced.length, 4);
  assert.equal(s.listConversations({ source: 'chatgpt' }).length, 4);
  assert.equal(s.listProjects({}).find((p) => p.id === CHATGPT_CHATS).name, 'ChatGPT chats');
  const th = s.getConversation({ id: 'chatgpt:cg-0001-aaaa' });
  assert.equal(th.conversation.title_source, 'web'); assert.equal(th.conversation.tokens_in, null);
  assert.equal(th.messages.length, 5);
  assert.equal(s.search({ q: 'lantern', source: 'chatgpt' }).length >= 1, true);
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the extracted files are gone');
});

test('re-import is idempotent, newer replaces, forgotten stays gone', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), s = openStore(':memory:');
  await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'a.zip')), { tmpRoot });
  const again = await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'b.zip')), { tmpRoot });
  assert.deepEqual(again.conversations, { seen: 7, imported: 0, unchanged: 5, forgotten: 0, skipped: 2 });
  assert.equal(s.counts().conversations, 4, 'no duplicates');
  const f = (await import('./__fixtures__/make-chatgpt-export.mjs')).chatgptFixture();
  const b = f.conversations[1];
  b.update_time += 100; b.mapping.b2.message.content.parts = ['placeholder hi, edited'];
  assert.equal(s.forget({ conversationId: 'chatgpt:cg-0001-aaaa' }), true);
  const third = await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'c.zip'), { conversations: f.conversations }), { tmpRoot });
  assert.equal(third.conversations.imported, 1);
  assert.equal(third.conversations.forgotten, 1);
  assert.equal(s.getConversation({ id: 'chatgpt:cg-0001-aaaa' }), null, 'a forgotten chat never comes back');
  const msgs = s.getConversation({ id: 'chatgpt:cg-0002-bbbb' }).messages.map((m) => m.text);
  assert.deepEqual(msgs, ['placeholder hello', 'placeholder hi, edited'], 'replaced, not appended');
});

test('a claude.ai export and an unknown ZIP are refused with the reason; nothing imported', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), s = openStore(':memory:');
  const claude = path.join(dir, 'claude.zip');
  zipFiles(claude, [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }, { name: 'users.json', data: '[]' }]);
  await assert.rejects(importChatGPTFile(s, claude, { tmpRoot }), /looks like a claude\.ai export/);
  const other = path.join(dir, 'other.zip');
  zipFiles(other, [{ name: 'photos/a.txt', data: 'placeholder' }]);
  await assert.rejects(importChatGPTFile(s, other, { tmpRoot }), /Not a ChatGPT or claude\.ai export \(looked for conversations\.json\)/);
  assert.equal(s.counts().conversations, 0);
  // both refusals happen on the ZIP index, before tmpRoot is created — nothing was extracted anywhere
  assert.equal(fs.existsSync(tmpRoot) ? fs.readdirSync(tmpRoot).length : 0, 0);
});

test('a recognizable memory file becomes masked memory documents with origin chatgpt', async () => {
  const dir = tmp(), s = openStore(':memory:');
  const secret = 'ghp_' + 'Z'.repeat(36);
  const zip = writeChatGPTZip(path.join(dir, 'm.zip'), { extra: [{ name: 'memories.json', data: JSON.stringify([{ content: 'placeholder memory about tea ' + secret }, { nope: 1 }, 'placeholder plain memory']) }] });
  const r = await importChatGPTFile(s, zip, { tmpRoot: path.join(dir, 'tmp') });
  assert.deepEqual(r.memory, { found: true, imported: 2 });
  const docs = s.listDocuments({ source: 'memory' });
  assert.equal(docs.length, 2); assert.ok(docs.every((d) => d.origin === 'chatgpt'));
  const one = s.getDocument({ id: docs.find((d) => /tea/.test(d.title)).id });
  assert.ok(!one.text.includes(secret)); assert.match(one.text, /github-token/);
});
```

- [ ] **Step 2: Run to verify they fail.**

Run: `node --test dashboard/claude-hub/ingest-chatgpt.test.mjs`
Expected: FAIL — `importChatGPTFile` is not exported.

- [ ] **Step 3: Implement.** Append to `dashboard/claude-hub/ingest-chatgpt.mjs` (move the new `import` lines to the top of the file):

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractEntries, readZipIndex, baseName } from './unzip.mjs';
import { streamJsonArray, noteUnknown } from './parse-web.mjs';

export const CHATGPT_CHATS = 'chatgpt:chats';
const ANNOUNCE_EVERY = 200;
const MEMORY_MAX_BYTES = 16 * 1024 * 1024;
const KNOWN_FILES = new Set(['conversations.json', 'user.json', 'memory.json', 'memories.json']);
const tick = () => new Promise((r) => setImmediate(r));
const notNewer = (prev, at) => !!prev && (!at || (!!prev.updated_at && prev.updated_at >= at));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

export function newChatGPTReport() {
  return { source: 'chatgpt', files: { conversations: false, user: false, other: [] },
    conversations: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 }, messages: { imported: 0, skipped: 0, empty: 0 },
    branches: { skipped: 0 }, memory: { found: false, imported: 0 }, unknownFields: {}, truncated: false };
}

export function ingestChatGPTConversation(store, conv, report) {
  const id = 'chatgpt:' + conv.id;
  if (store.isTombstoned('conversation', id) || store.isTombstoned('project', CHATGPT_CHATS)) { report.conversations.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('chatgpt', conv.id), conv.updatedAt)) { report.conversations.unchanged++; return 'unchanged'; }
  if (!conv.messages.length) { store.setSync('chatgpt', conv.id, conv.updatedAt); report.conversations.skipped++; return 'empty'; }
  const msgs = conv.messages.map((m) => ({ id: id + ':' + m.nodeId, nativeId: m.nodeId, parentId: m.parentId ? id + ':' + m.parentId : null,
    role: m.role, at: m.at, text: m.text, toolName: m.toolName, isSidechain: false }));
  let added = 0;
  store.tx(() => {
    store.upsertProject({ id: CHATGPT_CHATS, source: 'chatgpt', key: 'chats', name: 'ChatGPT chats', path: null });
    store.resetConversation(id);   // replace: an edited/regenerated chat rewrites its current branch
    store.ensureConversation({ id, source: 'chatgpt', projectId: CHATGPT_CHATS, nativeId: conv.id, cwd: null, gitBranch: null, model: conv.model });
    if (conv.title) store.setTitle(id, conv.title, 'web');
    added = store.addMessages(id, msgs);
    store.setSync('chatgpt', conv.id, conv.updatedAt);
  });
  report.conversations.imported++;
  report.messages.imported += added;
  report.messages.skipped += msgs.length - added;
  return 'imported';
}

// A memory file in a ChatGPT export has no documented shape: accept an array of strings or of objects with a string
// content/text/memory; anything else is "not recognized" (memory.found stays true, imported 0).
function importMemory(store, file, report) {
  report.memory.found = true;
  if (fs.statSync(file).size > MEMORY_MAX_BYTES) return;
  let rows; try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const raw = typeof r === 'string' ? r : r && typeof r === 'object' ? [r.content, r.text, r.memory].find((v) => typeof v === 'string') : null;
    if (!raw || !raw.trim()) continue;
    const text = cutText(safe(raw).trim(), TEXT_MAX);
    const title = cutText(text.split('\n')[0], 120);
    const res = store.upsertDocument({ id: 'memory:chatgpt:' + sha1(text), source: 'memory', path: null, title, text, meta: { origin: 'chatgpt' } });
    if (res === 'added' || res === 'updated') report.memory.imported++;
  }
}

export async function importChatGPTFile(store, zipPath, { tmpRoot, onProgress = () => {}, onImported = () => {}, maxBytes } = {}) {
  const report = newChatGPTReport();
  const names = (await readZipIndex(zipPath)).entries.filter((e) => !e.name.endsWith('/')).map((e) => baseName(e.name).toLowerCase());
  const has = (n) => names.includes(n);
  // re-verified here, never trusted from main's detection (spec §8 wording)
  if (!has('conversations.json')) throw new Error('Not a ChatGPT or claude.ai export (looked for conversations.json)');
  if (!has('user.json') && (has('projects.json') || has('users.json'))) throw new Error('This looks like a claude.ai export (projects.json / users.json, no user.json) — use Import claude.ai export');
  if (!has('user.json') && !has('chat.html')) throw new Error('Not a ChatGPT or claude.ai export (looked for conversations.json)');
  report.files.other = [...new Set(names.filter((n) => !KNOWN_FILES.has(n)))].sort().slice(0, 20).map((n) => n.slice(0, 80));
  fs.mkdirSync(tmpRoot, { recursive: true });
  const job = fs.mkdtempSync(path.join(tmpRoot, 'import-'));
  try {
    onProgress({ phase: 'unzip', done: 0, total: 0 });
    const got = await extractEntries(zipPath, ['conversations.json', 'user.json', 'memory.json', 'memories.json'], job, maxBytes ? { maxBytes } : {});
    report.files.conversations = !!got['conversations.json']; report.files.user = !!got['user.json'];
    const mem = got['memories.json'] || got['memory.json'];
    if (mem) importMemory(store, mem, report);
    let fresh = [];
    const announce = () => { if (fresh.length) { const ids = fresh; fresh = []; onImported(ids); } };
    let r;
    try {
      r = await streamJsonArray(got['conversations.json'], async (raw) => {
        report.conversations.seen++;
        const c = parseChatGPTConversation(raw);
        if (!c.ok) { report.conversations.skipped++; return; }
        noteUnknown(report, c.unknown);
        report.branches.skipped += c.branches; report.messages.skipped += c.skipped; report.messages.empty += c.empty;
        if (ingestChatGPTConversation(store, c.conv, report) === 'imported') fresh.push('chatgpt:' + c.conv.id);
        onProgress({ phase: 'conversations', done: report.conversations.seen, total: 0 });
        if (report.conversations.seen % ANNOUNCE_EVERY === 0) { announce(); await tick(); }
      });
    } finally { announce(); }
    report.conversations.skipped += r.bad; if (r.truncated) report.truncated = true;
    return report;
  } finally {
    fs.rmSync(job, { recursive: true, force: true });
  }
}
```

Check the counts in Step 1 against this code before running: `seen 7` (5 objects + no-id + string), `imported 4`, `skipped 3` (empty chat, no id, not an object); on the identical re-import the empty chat is `unchanged` (its `web_sync` row was written) → `unchanged 5, skipped 2`. `streamJsonArray` JSON-parses each array element and hands strings to `onItem` too (parse-web.mjs:123 counts only unparsable text as `bad`), so the `'not an object'` row is `seen` and then `skipped` by the parser — keep `seen: 7`. `noteUnknown` (parse-web.mjs:36) keys counts by field name, so `unknownFields` is `{ some_future_field: 1 }`.

- [ ] **Step 4: Run to verify they pass.**

Run: `node --test dashboard/claude-hub/ingest-chatgpt.test.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/ingest-web.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/ingest-chatgpt.mjs dashboard/claude-hub/ingest-chatgpt.test.mjs
git commit -m "fe: H6.4 — ChatGPT importer: streaming unzip into data/claude/tmp, web_sync kind chatgpt de-dup, tombstones win, counts-only report, memory file as masked documents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Docs ingest, notes half — frontmatter, memory notes, CLAUDE.md files, prompt notes (incremental by mtime/size)

**Files:**
- Create: `dashboard/claude-hub/__fixtures__/make-docs.mjs`
- Create: `dashboard/claude-hub/ingest-docs.mjs` (notes half; Task 6 adds history + watchers)
- Test: `dashboard/claude-hub/ingest-docs.test.mjs`

**Interfaces:**
- Consumes: Task 2 `store.upsertDocument`, `store.removeDocument`, `store.documentStamps`, `store.getDocument`, `store.forget({documentId})`; store `listProjects({source:'code'})` rows `{id, path}`; `maskSecrets`; `cutText`, `TEXT_MAX`.
- Produces:
  - `parseFrontmatter(src) -> {data:object, body:string, has:boolean}` (YAML subset: `key: value`, `[a, b]` lists, flat `{a: b}` maps, quoted strings, numbers, booleans; never throws).
  - `docId(source, file) -> '<source>:<sha1 of resolved lower-cased path>'`.
  - `PROMPTS_REL = path.join('40_Resources', 'Prompts')`, `NOTE_MAX_BYTES = 2 * 1024 * 1024`.
  - `listNoteFiles(store, {home, vaultDir}) -> [{source:'memory'|'claude-md'|'prompt', file, projectId, projectPath}]`.
  - `syncNotes(store, {home, vaultDir}) -> Promise<{changed:[id], removed:[id], skipped:number}>`.
  - Fixture `makeDocsHome(dir, {secret}) -> {home, vault, prompts, projectDir, files:{memIndex, memTea, homeMd, projMd, prompt}}`.

- [ ] **Step 1: Write the fixture.** Create `dashboard/claude-hub/__fixtures__/make-docs.mjs`:

```js
// Placeholder ~/.claude (memory notes, CLAUDE.md, history.jsonl) and a placeholder vault Prompts folder (spec 2026-10-15
// §5.2, §6.1, §9). Placeholder text only; the secret-shaped string is passed in, built at runtime by the test.
import fs from 'node:fs';
import path from 'node:path';

const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); return f; };
export const FOLDER = 'C--placeholder-project-a';

export function makeDocsHome(dir, { secret = '' } = {}) {
  const home = path.join(dir, '.claude'), vault = path.join(dir, 'vault'), prompts = path.join(vault, '40_Resources', 'Prompts');
  const projectDir = path.join(dir, 'work', 'project-a');
  const mem = path.join(home, 'projects', FOLDER, 'memory');
  const files = {
    memIndex: w(path.join(mem, 'MEMORY.md'), '# Memory index\n\n- [Tea](feedback_tea.md) — placeholder\n'),
    memTea: w(path.join(mem, 'feedback_tea.md'), '---\nname: Placeholder tea rule\ndescription: always offer tea\ntype: feedback\n---\nOffer placeholder tea first. ' + secret + '\n'),
    homeMd: w(path.join(home, 'CLAUDE.md'), '# Placeholder global rules\nBe kind to lanterns.\n'),
    projMd: w(path.join(projectDir, 'CLAUDE.md'), '# Project A rules\nPlaceholder build steps.\n'),
    prompt: w(path.join(prompts, 'review-a-pr.md'), [
      '---', 'title: Review a PR like a staff engineer', 'tags: [review, code]', 'variables: [project, file]', 'version: 1',
      'created: 2026-10-15T10:00:00Z', 'source: { kind: code, conversation: "code:s1", at: "2026-09-02T14:03:00Z" }',
      'hq: { id: "prompt:placeholder" }', '---', 'You are reviewing {{file}} in {{project}}. Placeholder body.', ''].join('\n')),
  };
  w(path.join(prompts, 'notes.txt'), 'not a note');
  w(path.join(prompts, 'drafts', 'nested.md'), '# nested is not indexed');
  w(path.join(home, 'projects', FOLDER, 's1.jsonl'), '');   // the project folder exists like a real one
  return { home, vault, prompts, projectDir, files };
}

export function historyLine({ display, sessionId = 'sess-1', project = 'C:\\placeholder\\project-a', pasted = false, timestamp = 1759320000000 }) {
  return JSON.stringify({ display, pastedContents: pasted ? { 1: { id: 1, type: 'text', content: 'placeholder paste' } } : {}, timestamp, project, sessionId }) + '\n';
}
```

- [ ] **Step 2: Write the failing tests.** Create `dashboard/claude-hub/ingest-docs.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { parseFrontmatter, docId, syncNotes, listNoteFiles } from './ingest-docs.mjs';
import { makeDocsHome, FOLDER } from './__fixtures__/make-docs.mjs';

const SECRET = 'sk-' + 'ant-' + 'A'.repeat(30);
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-docs-'));
  const fx = makeDocsHome(dir, { secret: SECRET });
  const s = openStore(':memory:');
  s.upsertProject({ id: 'code:' + FOLDER, source: 'code', key: FOLDER, name: 'project-a', path: fx.projectDir });
  return { dir, fx, s, opts: { home: fx.home, vaultDir: fx.vault } };
};

test('parseFrontmatter: lists, inline maps, quotes, numbers, CRLF, none, unterminated', () => {
  const p = parseFrontmatter('---\r\ntitle: "A: quoted"\r\ntags: [review, code]\r\nversion: 1\r\nok: true\r\nsource: { kind: code, conversation: "code:s1" }\r\n---\r\nBody {{x}}\r\n');
  assert.equal(p.has, true);
  assert.deepEqual(p.data, { title: 'A: quoted', tags: ['review', 'code'], version: 1, ok: true, source: { kind: 'code', conversation: 'code:s1' } });
  assert.equal(p.body, 'Body {{x}}\r\n');
  assert.deepEqual(parseFrontmatter('# no frontmatter\n'), { data: {}, body: '# no frontmatter\n', has: false });
  assert.deepEqual(parseFrontmatter('---\ntitle: never closed\n'), { data: {}, body: '---\ntitle: never closed\n', has: false });
});

test('syncNotes indexes memory notes, both CLAUDE.md files and top-level prompt notes only', async () => {
  const { fx, s, opts } = setup();
  const files = listNoteFiles(s, opts).map((f) => [f.source, path.basename(f.file)]).sort();
  assert.deepEqual(files, [['claude-md', 'CLAUDE.md'], ['claude-md', 'CLAUDE.md'], ['memory', 'MEMORY.md'], ['memory', 'feedback_tea.md'], ['prompt', 'review-a-pr.md']]);
  const r = await syncNotes(s, opts);
  assert.equal(r.changed.length, 5); assert.deepEqual(r.removed, []);
  const tea = s.getDocument({ id: docId('memory', fx.files.memTea) });
  assert.equal(tea.title, 'Placeholder tea rule');
  assert.deepEqual(tea.meta, { name: 'Placeholder tea rule', description: 'always offer tea', type: 'feedback' });
  assert.equal(tea.project_id, 'code:' + FOLDER); assert.equal(tea.project_path, fx.projectDir);
  assert.equal(s.getDocument({ id: docId('memory', fx.files.memIndex) }).title, 'Memory index');
  const pm = s.getDocument({ id: docId('prompt', fx.files.prompt) });
  assert.equal(pm.title, 'Review a PR like a staff engineer');
  assert.deepEqual(pm.meta.variables, ['project', 'file']);
  assert.equal(pm.text.trim(), 'You are reviewing {{file}} in {{project}}. Placeholder body.');
  assert.equal(s.getDocument({ id: docId('claude-md', fx.files.projMd) }).project_id, 'code:' + FOLDER);
  assert.equal(s.getDocument({ id: docId('claude-md', fx.files.homeMd) }).project_id, null);
});

test('memory and CLAUDE.md text are masked before the cut', async () => {
  const { fx, s, opts } = setup();
  // the space keeps redact.mjs's `\bsk-ant-` word boundary; the secret starts at 199991, so a cut-before-mask would keep
  // 'sk-ant-AA' at the end of the 200000-char cut and this assertion would catch it
  fs.writeFileSync(fx.files.homeMd, 'x'.repeat(199990) + ' ' + SECRET + ' tail');
  await syncNotes(s, opts);
  const md = s.getDocument({ id: docId('claude-md', fx.files.homeMd) }).text;
  assert.ok(!md.includes('sk-ant-'), 'a secret straddling the cut is masked, not half-kept');
  const tea = s.getDocument({ id: docId('memory', fx.files.memTea) });
  assert.ok(!tea.text.includes(SECRET)); assert.match(tea.text, /anthropic-key/);
  assert.equal(s.listDocuments({ q: 'sk-ant' }).length, 0, 'the raw secret is not in the FTS index either');
});

test('incremental: unchanged files are skipped, an edit re-indexes, a deleted file leaves, a forgotten one stays gone', async () => {
  const { fx, s, opts } = setup();
  await syncNotes(s, opts);
  assert.deepEqual((await syncNotes(s, opts)).changed, []);
  fs.writeFileSync(fx.files.prompt, fs.readFileSync(fx.files.prompt, 'utf8').replace('Placeholder body.', 'Edited body.'));
  fs.utimesSync(fx.files.prompt, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual((await syncNotes(s, opts)).changed, [docId('prompt', fx.files.prompt)]);
  fs.rmSync(fx.files.memIndex);
  const r = await syncNotes(s, opts);
  assert.deepEqual(r.removed, [docId('memory', fx.files.memIndex)]);
  assert.equal(s.getDocument({ id: docId('memory', fx.files.memIndex) }), null);
  assert.equal(s.forget({ documentId: docId('prompt', fx.files.prompt) }), true);
  fs.utimesSync(fx.files.prompt, new Date(), new Date(Date.now() + 9000));
  assert.deepEqual((await syncNotes(s, opts)).changed, []);
  assert.equal(s.getDocument({ id: docId('prompt', fx.files.prompt) }), null);
});

test('missing roots are not errors; ChatGPT memory rows (no path) are never removed by a sweep', async () => {
  const s = openStore(':memory:');
  s.upsertDocument({ id: 'memory:chatgpt:aa', source: 'memory', path: null, title: 't', text: 'placeholder', meta: { origin: 'chatgpt' } });
  const r = await syncNotes(s, { home: path.join(os.tmpdir(), 'no-such-home-h6'), vaultDir: path.join(os.tmpdir(), 'no-such-vault-h6') });
  assert.deepEqual(r, { changed: [], removed: [], skipped: 0 });
  assert.ok(s.getDocument({ id: 'memory:chatgpt:aa' }));
});
```

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard/claude-hub/ingest-docs.test.mjs`
Expected: FAIL — `Cannot find module './ingest-docs.mjs'`.

- [ ] **Step 4: Implement.** Create `dashboard/claude-hub/ingest-docs.mjs`:

```js
// Local Claude context + vault prompt notes → `document` rows (spec 2026-10-15 §5.2). Read-only on every source: ~/.claude
// (HQ_CLAUDE_HOME), project CLAUDE.md files, <vault>/40_Resources/Prompts (HQ_VAULT_DIR). Text and titles are masked on
// the whole string before any cut. Symlinked files are not followed (Dirent.isFile() is false for them).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX } from './parse-code.mjs';

export const PROMPTS_REL = path.join('40_Resources', 'Prompts');
export const NOTE_MAX_BYTES = 2 * 1024 * 1024;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(s)).text;
const MASKED = /•••/;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const docId = (source, file) => source + ':' + sha1(path.resolve(file).toLowerCase());
const mdFiles = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => path.join(dir, d.name)); } catch { return []; } };
const isFile = (f) => { try { return fs.lstatSync(f).isFile(); } catch { return false; } };

function scalar(v) {
  const t = v.trim();
  if (/^".*"$/.test(t)) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null' || t === '~' || t === '') return null;
  return t;
}
// split on commas outside quotes
const items = (s) => { const out = []; let cur = '', q = null; for (const ch of s) { if (q) { if (ch === q) q = null; cur += ch; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim() !== '') out.push(cur); return out; };
function value(v) {
  const t = v.trim();
  if (t.startsWith('[') && t.endsWith(']')) return items(t.slice(1, -1)).map(scalar).filter((x) => x !== null);
  if (t.startsWith('{') && t.endsWith('}')) {
    const o = {};
    for (const it of items(t.slice(1, -1))) { const i = it.indexOf(':'); if (i > 0) o[it.slice(0, i).trim()] = scalar(it.slice(i + 1)); }
    return o;
  }
  return scalar(t);
}
export function parseFrontmatter(src) {
  const s = String(src);
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  if (!m) return { data: {}, body: s, has: false };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);   // top-level keys only; indented/continuation lines are ignored
    if (k) data[k[1]] = value(k[2]);
  }
  return { data, body: s.slice(m[0].length), has: true };
}
const maskDeep = (v) => (typeof v === 'string' ? cutText(safe(v), 2000) : Array.isArray(v) ? v.map(maskDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) : v);

export function listNoteFiles(store, { home, vaultDir }) {
  const out = [], seen = new Set();
  const add = (o) => { const k = path.resolve(o.file).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(o); } };
  const code = new Map(store.listProjects({ source: 'code' }).map((p) => [p.id, p.path]));
  const projPath = (id, folder) => { const p = code.get(id); return p && path.isAbsolute(p) && !MASKED.test(p) ? p : folder; };
  if (home) {
    const root = path.join(home, 'projects');
    let folders = []; try { folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* no projects yet */ }
    for (const folder of folders) for (const file of mdFiles(path.join(root, folder, 'memory'))) add({ source: 'memory', file, projectId: 'code:' + folder, projectPath: projPath('code:' + folder, folder) });
    const g = path.join(home, 'CLAUDE.md');
    if (isFile(g)) add({ source: 'claude-md', file: g, projectId: null, projectPath: null });
  }
  for (const [id, p] of code) {   // only the project folders the Hub knows; never any other repo file
    if (!p || !path.isAbsolute(p) || MASKED.test(p)) continue;
    const f = path.join(p, 'CLAUDE.md');
    if (isFile(f)) add({ source: 'claude-md', file: f, projectId: id, projectPath: p });
  }
  if (vaultDir) for (const file of mdFiles(path.join(vaultDir, PROMPTS_REL))) add({ source: 'prompt', file, projectId: null, projectPath: null });
  return out;
}

function shape(f, raw) {
  const base = path.basename(f.file).replace(/\.md$/i, '');
  if (f.source === 'claude-md') return { title: 'CLAUDE.md — ' + (f.projectPath ? path.win32.basename(f.projectPath) : '~/.claude'), text: raw, meta: null };
  const fm = parseFrontmatter(raw);
  const heading = (/^#\s+(.+)$/m.exec(fm.body) || [])[1];
  if (f.source === 'memory') {
    const meta = fm.has ? maskDeep({ name: fm.data.name ?? null, description: fm.data.description ?? null, type: fm.data.type ?? null }) : null;
    return { title: (typeof fm.data.name === 'string' && fm.data.name) || heading || base, text: fm.body, meta };
  }
  return { title: (typeof fm.data.title === 'string' && fm.data.title) || heading || base, text: fm.body, meta: maskDeep(fm.data) };   // prompt
}

export async function syncNotes(store, { home, vaultDir }) {
  const changed = [], removed = [];
  let skipped = 0;
  const files = listNoteFiles(store, { home, vaultDir });
  const live = new Set();
  for (const f of files) {
    const id = docId(f.source, f.file);
    live.add(id);
    let st; try { st = await fs.promises.stat(f.file); } catch { continue; }
    if (st.size > NOTE_MAX_BYTES) { skipped++; continue; }
    const prev = store.documentStamps(f.source).get(id);
    if (prev && prev.size === st.size && Math.floor(prev.mtime_ms) === Math.floor(st.mtimeMs)) continue;
    if (store.isTombstoned('document', id)) continue;
    let raw; try { raw = await fs.promises.readFile(f.file, 'utf8'); } catch { continue; }
    const s = shape(f, raw);
    const res = store.upsertDocument({ id, source: f.source, path: f.file, title: cutText(safe(s.title).trim(), 200) || null,
      text: cutText(safe(s.text), TEXT_MAX), projectId: f.projectId, projectPath: f.projectPath, mtimeMs: Math.floor(st.mtimeMs), size: st.size, meta: s.meta });
    if (res === 'added' || res === 'updated') changed.push(id);
  }
  for (const source of ['memory', 'claude-md', 'prompt']) {
    for (const [id, stamp] of store.documentStamps(source)) {
      if (stamp.path && !live.has(id) && store.removeDocument(id)) removed.push(id);   // path-less rows (ChatGPT memory) are not files
    }
  }
  return { changed, removed, skipped };
}
```

(`documentStamps` is read per file for clarity; if the suite is slow on a large home, hoist one `Map` per source before the loop — same behaviour.)

- [ ] **Step 5: Run to verify they pass.**

Run: `node --test dashboard/claude-hub/ingest-docs.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard/claude-hub/ingest-docs.mjs dashboard/claude-hub/ingest-docs.test.mjs dashboard/claude-hub/__fixtures__/make-docs.mjs
git commit -m "fe: H6.5 — docs ingest: memory notes, CLAUDE.md files, vault prompt notes (frontmatter-aware, masked before the cut, incremental, removals, tombstones)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Docs ingest, history half — `history.jsonl` by byte cursor, `syncDocs`, live `watchDocs`

**Files:**
- Modify: `dashboard/claude-hub/ingest-docs.mjs` (append)
- Test: `dashboard/claude-hub/ingest-docs.test.mjs` (append)

**Interfaces:**
- Consumes: Task 5 `syncNotes`, `safe`/`cutText` helpers in the same file; store `getCursor(file)`, `setCursor({file,size,mtimeMs,offset,head,sessionId})`, `deleteCursor(file)`, `tx(fn)`, Task 2 `upsertDocument`, `removeDocuments({source, idPrefix})`; fixture `historyLine({display, sessionId, project, pasted, timestamp})` (Task 5).
- Produces:
  - `HISTORY_CURSOR = 'history.jsonl'` (the `ingest_cursor.file` key).
  - `ingestHistory(store, home, {chunkSize = 1 << 20, maxLine = 8 << 20} = {}) -> Promise<{added, bad, reset, ids:[id], missing?}>` — document ids `history:<sessionId>:<byte offset of the line>`; `meta = {sessionId, project, pasted, at}`; only complete (`\n`-terminated) lines are consumed; size < cursor or a changed first-256-bytes head = reset (history documents removed, re-read from 0).
  - `syncDocs(store, {home, vaultDir}) -> Promise<{changed:[id], removed:[id]}>` (notes + history).
  - `watchDocs({home, vaultDir}, onChange, {debounceMs = 1000} = {}) -> {close()}` — one debounced `onChange()` for `history.jsonl` / `CLAUDE.md` in `home`, `projects/<folder>/memory/*.md`, and `<vault>/40_Resources/Prompts/*.md`; missing folders are skipped (the Hub's sweep covers them).

- [ ] **Step 1: Write the failing tests.** Append to `dashboard/claude-hub/ingest-docs.test.mjs` (extend imports: `import { ingestHistory, syncDocs, watchDocs, HISTORY_CURSOR } from './ingest-docs.mjs'; import { historyLine } from './__fixtures__/make-docs.mjs';`):

```js
const histSetup = () => {
  const { dir, fx, s, opts } = setup();
  const file = path.join(fx.home, 'history.jsonl');
  return { dir, fx, s, opts, file };
};

test('history: each complete line is a document keyed by its byte offset, meta carries session/project/pasted', async () => {
  const { s, fx, file } = histSetup();
  const l1 = historyLine({ display: 'placeholder fix the lantern bug' });
  const l2 = historyLine({ display: 'placeholder paste this ' + SECRET, pasted: true, sessionId: 'sess-2' });
  fs.writeFileSync(file, l1 + 'not json\n' + l2);
  const r = await ingestHistory(s, fx.home);
  assert.equal(r.added, 2); assert.equal(r.bad, 1);
  const off2 = Buffer.byteLength(l1 + 'not json\n');
  assert.deepEqual(r.ids, ['history:sess-1:0', 'history:sess-2:' + off2]);
  const d2 = s.getDocument({ id: 'history:sess-2:' + off2 });
  assert.equal(d2.source, 'history');
  assert.deepEqual(d2.meta, { sessionId: 'sess-2', project: 'C:\\placeholder\\project-a', pasted: true, at: '2025-10-01T12:00:00.000Z' });
  assert.ok(!d2.text.includes(SECRET), 'masked');
  assert.equal(s.getCursor(HISTORY_CURSOR).offset, Buffer.byteLength(l1 + 'not json\n' + l2));
  assert.equal(s.listDocuments({ q: 'lantern' }).length, 0, 'history is not in default search');
  assert.equal(s.listDocuments({ q: 'lantern', source: 'history' }).length, 1);
});

test('partial last line waits; truncation resets; append continues', async () => {
  const { s, fx, file } = histSetup();
  const a = historyLine({ display: 'placeholder one' }), b = historyLine({ display: 'placeholder two' });
  fs.writeFileSync(file, a + b.slice(0, 20));   // a writer is mid-line
  assert.equal((await ingestHistory(s, fx.home)).added, 1);
  assert.equal(s.getCursor(HISTORY_CURSOR).offset, Buffer.byteLength(a), 'the cursor stops before the half line');
  fs.appendFileSync(file, b.slice(20));
  const r2 = await ingestHistory(s, fx.home);
  assert.deepEqual(r2.ids, ['history:sess-1:' + Buffer.byteLength(a)], 'the finished line, once');
  assert.equal((await ingestHistory(s, fx.home)).added, 0, 'nothing doubles');
  const c = historyLine({ display: 'placeholder rotated' });
  fs.writeFileSync(file, c);   // Claude Code rewrote/rotated the file: shorter than the cursor
  const r3 = await ingestHistory(s, fx.home);
  assert.equal(r3.reset, true);
  assert.deepEqual(s.listDocuments({ source: 'history' }).map((d) => d.id), ['history:sess-1:0']);
  assert.match(s.getDocument({ id: 'history:sess-1:0' }).text, /rotated/);
  const same = historyLine({ display: 'placeholder XXXXXXX' });   // same length, different head: also a reset
  fs.writeFileSync(file, same.replace('XXXXXXX', 'rotated'.toUpperCase()) + historyLine({ display: 'placeholder more' }));
  assert.equal((await ingestHistory(s, fx.home)).reset, true);
});

test('history.jsonl is never written; a missing file is not an error', async () => {
  const { s, fx, file } = histSetup();
  assert.equal((await ingestHistory(s, fx.home)).missing, true);
  fs.writeFileSync(file, historyLine({ display: 'placeholder keep' }));
  const before = fs.statSync(file), bytes = fs.readFileSync(file);
  await ingestHistory(s, fx.home); await ingestHistory(s, fx.home);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('syncDocs = notes + history; watchDocs fires once per burst and stops on close', async () => {
  const { s, fx, opts, file } = histSetup();
  fs.writeFileSync(file, historyLine({ display: 'placeholder via sync' }));
  const r = await syncDocs(s, opts);
  assert.equal(r.changed.length, 6, '5 notes + 1 history line');
  let calls = 0;
  const w = watchDocs(opts, () => { calls++; }, { debounceMs: 200 });
  try {
    fs.writeFileSync(path.join(fx.prompts, 'new-prompt.md'), '---\ntitle: New placeholder\n---\nBody');
    fs.appendFileSync(file, historyLine({ display: 'placeholder live' }));
    const until = Date.now() + 4000;
    while (!calls && Date.now() < until) await new Promise((res) => setTimeout(res, 50));
    assert.ok(calls >= 1, 'a change was noticed');
  } finally { w.close(); }
  const n = calls;
  fs.writeFileSync(path.join(fx.prompts, 'after-close.md'), 'x');
  await new Promise((res) => setTimeout(res, 600));
  assert.equal(calls, n, 'closed watchers stay quiet');
});
```

- [ ] **Step 2: Run to verify they fail.**

Run: `node --test dashboard/claude-hub/ingest-docs.test.mjs`
Expected: FAIL — `ingestHistory` is not exported.

- [ ] **Step 3: Implement.** Append to `dashboard/claude-hub/ingest-docs.mjs`:

```js
export const HISTORY_CURSOR = 'history.jsonl';
const HEAD_BYTES = 256;
const SID_RE = /^[A-Za-z0-9-]{1,80}$/;
async function headOf(file, size) {
  const len = Math.min(HEAD_BYTES, size);
  const fh = await fs.promises.open(file, 'r');
  try { const b = Buffer.alloc(len); await fh.read(b, 0, len, 0); return len + ':' + sha1(b); } finally { await fh.close(); }
}

// Byte-cursor ingest of ~/.claude/history.jsonl (spec §5.2). Read-only: the file is opened 'r' and never written.
export async function ingestHistory(store, home, { chunkSize = 1 << 20, maxLine = 8 << 20 } = {}) {
  const file = path.join(home, 'history.jsonl');
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || !st.isFile()) return { added: 0, bad: 0, reset: false, ids: [], missing: true };
  let cur = store.getCursor(HISTORY_CURSOR), reset = false;
  if (cur) {
    const prevLen = cur.head ? Number(String(cur.head).split(':')[0]) || 0 : 0;
    const headNow = prevLen && st.size >= prevLen ? await headOf(file, prevLen) : null;
    if (st.size < cur.offset || (cur.head && headNow !== cur.head)) {
      store.tx(() => { store.removeDocuments({ source: 'history', idPrefix: 'history:' }); store.deleteCursor(HISTORY_CURSOR); });
      cur = null; reset = true;
    }
  }
  const start = cur ? cur.offset : 0;
  if (start >= st.size) return { added: 0, bad: 0, reset, ids: [] };
  const head = await headOf(file, st.size);
  const ids = [];
  let added = 0, bad = 0, offset = start, pending = Buffer.alloc(0), pendingAt = start, skipping = false;
  const handle = (buf, at) => {
    let o; try { o = JSON.parse(buf.toString('utf8')); } catch { bad++; return; }
    const display = o && typeof o.display === 'string' ? o.display : '';
    if (!display.trim()) { bad++; return; }
    const sessionId = typeof o.sessionId === 'string' && SID_RE.test(o.sessionId) ? o.sessionId : 'nosession';
    const project = typeof o.project === 'string' ? cutText(safe(o.project), 500) : null;
    const at2 = typeof o.timestamp === 'number' && Number.isFinite(o.timestamp) ? new Date(o.timestamp).toISOString() : null;
    const pasted = !!(o.pastedContents && typeof o.pastedContents === 'object' && Object.keys(o.pastedContents).length);
    const id = 'history:' + sessionId + ':' + at;
    const res = store.upsertDocument({ id, source: 'history', path: null, title: null, text: cutText(safe(display), TEXT_MAX),
      projectId: null, projectPath: project, mtimeMs: null, size: buf.length, meta: { sessionId, project, pasted, at: at2 } });
    if (res === 'added' || res === 'updated') { added++; ids.push(id); }
  };
  const fh = await fs.promises.open(file, 'r');
  try {
    let pos = start;
    while (pos < st.size) {
      const len = Math.min(chunkSize, st.size - pos), chunk = Buffer.alloc(len);
      const { bytesRead } = await fh.read(chunk, 0, len, pos);
      if (!bytesRead) break;
      let from = 0;
      store.tx(() => {
        for (let i = 0; i < bytesRead; i++) {
          if (chunk[i] !== 0x0a) continue;
          const piece = chunk.subarray(from, i), lineAt = pendingAt;
          const line = pending.length ? Buffer.concat([pending, piece]) : piece;
          const body = line.length && line[line.length - 1] === 0x0d ? line.subarray(0, line.length - 1) : line;   // CRLF-safe
          if (!skipping && body.length) handle(body, lineAt);
          pending = Buffer.alloc(0); skipping = false;
          from = i + 1; pendingAt = pos + from; offset = pos + from;
        }
        store.setCursor({ file: HISTORY_CURSOR, size: st.size, mtimeMs: st.mtimeMs, offset, head, sessionId: null });
      });
      const rest = chunk.subarray(from, bytesRead);
      if (!skipping) { pending = Buffer.concat([pending, rest]); if (pending.length > maxLine) { pending = Buffer.alloc(0); skipping = true; bad++; } }
      pos += bytesRead;
    }
  } finally { await fh.close(); }
  return { added, bad, reset, ids };   // a trailing half line stays unread: the cursor sits at its start
}

export async function syncDocs(store, { home, vaultDir }) {
  const n = await syncNotes(store, { home, vaultDir });
  const h = home ? await ingestHistory(store, home) : { ids: [] };
  return { changed: [...n.changed, ...h.ids], removed: n.removed };
}

export function watchDocs({ home, vaultDir }, onChange, { debounceMs = 1000 } = {}) {
  const ws = [];
  let timer = null, closed = false;
  const kick = () => { if (closed) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; if (!closed) onChange(); }, debounceMs); };
  const watch = (dir, opts, ok) => {
    try {
      const w = fs.watch(dir, opts, (_e, name) => { if (name && ok(String(name))) kick(); });
      w.on('error', () => { try { w.close(); } catch { /* closed */ } });   // a dead watch falls back to the Hub's sweep
      ws.push(w);
    } catch { /* missing folder: the sweep covers it */ }
  };
  if (home) {
    watch(home, {}, (n) => n === 'history.jsonl' || n === 'CLAUDE.md');
    watch(path.join(home, 'projects'), { recursive: true }, (n) => /^[^\\/]+[\\/]memory[\\/][^\\/]+\.md$/i.test(n));
  }
  if (vaultDir) watch(path.join(vaultDir, PROMPTS_REL), {}, (n) => /\.md$/i.test(n));
  return { close() { closed = true; clearTimeout(timer); for (const w of ws) { try { w.close(); } catch { /* closed */ } } } };
}
```

Note `resetCode()` (Hub reindex) deletes every `ingest_cursor` row, including this one: the next sweep re-reads history from 0 and every id comes back `'unchanged'` (ids are offsets), so nothing doubles.

- [ ] **Step 4: Run to verify they pass.**

Run: `node --test dashboard/claude-hub/ingest-docs.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/ingest-docs.mjs dashboard/claude-hub/ingest-docs.test.mjs
git commit -m "fe: H6.6 — history.jsonl byte-cursor ingest (complete lines only, truncation/rotation reset, never written), syncDocs, live watchDocs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Hub ops `importChatGPT`, `listDocuments`, `getDocument`, `forget({documentId})`, docs sync + watchers; host `--vault` + IPC `documents` / `document`; main.js :1595

**Files:**
- Modify: `dashboard/claude-hub/hub.mjs` (`main()` args :160-165; state :178; stop :183-184; `markChanged`/`flushChanged` :253-268; `runImport` :277-300; `startWatching` :347-361; `ops` :382-421)
- Modify: `dashboard/claude-hub/hub.test.mjs` (:387 counts fallback; append tests)
- Modify: `dashboard/claude-hub-host.js` (`create` :31 + spawn args :58; `registerIpc` :140-151; `init` :153-160; exports)
- Modify: `dashboard/claude-hub-host.test.mjs` (registerIpc key list :238-239; append tests)
- Modify: `dashboard/main.js:1595` (the ONLY main.js line this task touches)

**Interfaces:**
- Consumes: Task 4 `importChatGPTFile(store, zipPath, {tmpRoot, onProgress, onImported})`; Task 6 `syncDocs(store, {home, vaultDir})`, `watchDocs({home, vaultDir}, onChange)`; Task 2 store methods; H4 `importExportFile`.
- Produces:
  - Hub CLI: `--vault <dir>`; vault resolution `process.env.HQ_VAULT_DIR || arg('--vault') || null` (env first: a gate's override always wins over main's default).
  - Ops: `importChatGPT({zipPath}) -> {started:true}` (writer; same checks/one-at-a-time as `importExport`); `listDocuments(opts) -> rows`, `getDocument({id}) -> doc|null` (readers allowed; no open store = throws `'the index is not open yet'`); `forget({documentId})`.
  - Events: `progress{kind:'import', source:'claude'|'chatgpt', …}`; `changed{ids, projects?, documents?}`; `health().counts.documents`, `health().lastImport.source`.
  - Host: `create({…, vaultDir = null})`, `hubVaultDir(env, vaultDir) -> string|null`, IPC `hq:claude-hub:documents (o)` → `listDocuments {...o}`, `hq:claude-hub:document (id)` → `getDocument {id: String(id).slice(0, 300)}`.

- [ ] **Step 1: Write the failing host tests.** In `dashboard/claude-hub-host.test.mjs`, change the key list in `registerIpc maps every channel…` to include `'hq:claude-hub:document', 'hq:claude-hub:documents'` (sorted position after `conversations`), and append:

```js
test('H6: documents/document channels reach listDocuments/getDocument; junk is reduced', async () => {
  const h = {}, calls = [];
  registerIpc({ handle: (ch, fn) => { h[ch] = fn; } }, { health: async () => ({}), request: async (op, args) => { calls.push([op, args]); return op === 'getDocument' ? null : []; } });
  await h['hq:claude-hub:documents']({}, { q: 'tea', source: 'memory', limit: 5 });
  assert.deepEqual(calls.at(-1), ['listDocuments', { q: 'tea', source: 'memory', limit: 5 }]);
  await h['hq:claude-hub:documents']({}, 'junk');
  assert.deepEqual(calls.at(-1), ['listDocuments', {}]);
  assert.equal(await h['hq:claude-hub:document']({}, 'x'.repeat(400)), null);
  assert.equal(calls.at(-1)[1].id.length, 300);
});
test('H6: the Hub gets --vault, and HQ_VAULT_DIR wins over main\'s default', () => {
  const { hubVaultDir } = require('./claude-hub-host.js');
  assert.equal(hubVaultDir({ HQ_VAULT_DIR: 'C:\\gate\\vault' }, 'C:\\real\\VEEMO CORTEX'), 'C:\\gate\\vault');
  assert.equal(hubVaultDir({}, 'C:\\real\\VEEMO CORTEX'), 'C:\\real\\VEEMO CORTEX');
  assert.equal(hubVaultDir({}, undefined), null);
  const seen = [];
  const host = create({ hubScript: 'hub.mjs', dbFile: 'x.sqlite', vaultDir: 'C:\\gate\\vault', findNodeFn: () => thisNode(),
    spawnFn: (cmd, args) => { seen.push(args); throw new Error('stop here'); } });
  host.start();
  const i = seen[0].indexOf('--vault');
  assert.ok(i > 0); assert.equal(seen[0][i + 1], 'C:\\gate\\vault');
});
```

- [ ] **Step 2: Write the failing Hub tests.** In `dashboard/claude-hub/hub.test.mjs` add `documents: 0` to EVERY existing exact `counts` assertion — `store.counts()` (Task 2) and the no-store fallback (Step 4g) both gain the key, so a `deepEqual` without it fails. `grep -n "counts, {" dashboard/claude-hub/hub.test.mjs` shows four at HEAD: ~387 `{ projects: 0, conversations: 0, messages: 0, documents: 0 }` (`last.counts`), ~534 `{ projects: 0, conversations: 0, messages: 0, documents: 0 }` (`health.counts`), ~582 `{ projects: 3, conversations: 153, messages: 155, documents: 0 }`, ~678 `{ projects: 1, conversations: 1, messages: 1, documents: 0 }`. Their fixture homes hold no memory notes, CLAUDE.md or history.jsonl, their cwds `C:\placeholder\…` do not exist and they pass no `HQ_VAULT_DIR`/`--vault`, so `documents` is 0. The reader-without-store expectations right below ~387 do not call the new ops. Append (add imports `import { makeDocsHome, historyLine } from './__fixtures__/make-docs.mjs';` and `import { writeChatGPTZip } from './__fixtures__/make-chatgpt-export.mjs';` — `zipFiles` is ALREADY imported at hub.test.mjs:12, do not import it twice):

```js
test('H6 documents: the Hub indexes HQ_CLAUDE_HOME notes/history + HQ_VAULT_DIR prompts, lists, gets, forgets, and sees a new prompt live', async () => {
  const dir = tmp('hub-h6-docs-');
  const fx = makeDocsHome(dir);
  fs.writeFileSync(path.join(fx.home, 'history.jsonl'), historyLine({ display: 'placeholder typed prompt' }));
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: fx.home, HQ_VAULT_DIR: fx.vault, HQ_HUB_SWEEP_MS: '500' }, db);
  try {
    assert.ok(await h.until(async () => ((await h.req('health')).result.counts || {}).documents === 5, 15000), 'memory 2 + CLAUDE.md 1 (home; the fixture project has no Hub path yet) + prompt 1 + history 1');
    const list = (await h.req('listDocuments', {})).result;
    assert.ok(list.every((d) => d.source !== 'history'));
    const prompt = list.find((d) => d.source === 'prompt');
    assert.equal(prompt.title, 'Review a PR like a staff engineer');
    const doc = (await h.req('getDocument', { id: prompt.id })).result;
    assert.match(doc.text, /You are reviewing/);
    assert.equal((await h.req('getDocument', { id: 'prompt:nope' })).result, null);
    fs.writeFileSync(path.join(fx.prompts, 'second.md'), '---\ntitle: Second placeholder prompt\n---\nBody');
    assert.ok(await h.until(async () => (await h.req('listDocuments', { source: 'prompt' })).result.length === 2, 8000), 'a new prompt note is picked up live');
    assert.ok(h.events.some((e) => e.event === 'changed' && Array.isArray(e.data.documents) && e.data.documents.length), 'changed carries documents');
    assert.equal((await h.req('forget', { documentId: prompt.id })).result, true);
    assert.equal((await h.req('getDocument', { id: prompt.id })).result, null);
    assert.equal((await h.req('listDocuments', { q: 'reviewing' })).result.length, 0);
  } finally { await h.stop(); }
});

test('H6 importChatGPT: progress carries source chatgpt, lastImport records it, chats are listed; a claude.ai ZIP fails with the reason', async () => {
  const dir = tmp('hub-h6-cg-');
  const home = path.join(dir, '.claude'); fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_VAULT_DIR: path.join(dir, 'vault') }, db);
  try {
    await h.healthy();
    assert.equal((await h.req('importChatGPT', { zipPath: 'relative.zip' })).ok, false);
    const zip = writeChatGPTZip(path.join(dir, 'chatgpt.zip'));
    assert.deepEqual((await h.req('importChatGPT', { zipPath: zip })).result, { started: true });
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.kind === 'import' && e.data.phase === 'done' && e.data.source === 'chatgpt')));
    const health = (await h.req('health')).result;
    assert.equal(health.lastImport.ok, true); assert.equal(health.lastImport.source, 'chatgpt');
    assert.equal(health.lastImport.report.conversations.imported, 4);
    assert.equal((await h.req('listConversations', { source: 'chatgpt' })).result.length, 4);
    const claude = path.join(dir, 'claude.zip');
    zipFiles(claude, [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }]);
    assert.deepEqual((await h.req('importChatGPT', { zipPath: claude })).result, { started: true });
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.phase === 'failed' && /claude\.ai export/.test(e.data.error))));
    assert.equal((await h.req('health')).result.lastImport.ok, false);
  } finally { await h.stop(); }
});
```

(If the file's `startHub` result has no `stop()` returning a promise, use the same teardown the neighbouring tests use.)

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard/claude-hub-host.test.mjs dashboard/claude-hub/hub.test.mjs`
Expected: FAIL — unknown channel `hq:claude-hub:documents`, `hubVaultDir` not exported, `unknown op` for `listDocuments`/`importChatGPT`, `counts.documents` undefined.

- [ ] **Step 4: Implement the Hub.** In `dashboard/claude-hub/hub.mjs`:

(a) imports at the top: `import { importChatGPTFile } from './ingest-chatgpt.mjs';` and `import { syncDocs, watchDocs } from './ingest-docs.mjs';`

(b) in `main()` after `latestFile`: 
```js
  const vaultDir = process.env.HQ_VAULT_DIR || arg('--vault') || null;   // env first: tests and gates never reach the real vault
  const claudeHome = path.dirname(root);                                  // root = <HQ_CLAUDE_HOME>/projects
```

(c) state line :178: add `docWatcher = null, docsRunning = false`. In the stop path next to `watcher && watcher.close()` add `try { docWatcher && docWatcher.close(); } catch { /* closing */ }`.

(d) changes: add `const changedDocs = new Set();`; in `flushChanged` after the projects line `if (changedDocs.size) data.documents = [...changedDocs];` and `changedDocs.clear();`; change the signature to `const markChanged = (ids, projects = [], documents = []) => {` with `for (const d of documents) changedDocs.add(d);`.

(e) imports — generalise `runImport`:
```js
  function runImport(zipPath, source = 'claude') {
    importing = true;
    const tmpRoot = path.join(path.dirname(path.resolve(dbFile)), 'tmp');
    const run = source === 'chatgpt' ? importChatGPTFile : importExportFile;
    const ev = (p, force) => emitImport({ ...p, source }, force);
    run(store, zipPath, { tmpRoot, onProgress: (p) => ev(p), onImported: (ids) => markChanged(ids) })
      .then((report) => {
        store.setMeta('last_import', JSON.stringify({ at: new Date().toISOString(), ok: true, source, report }));
        ev({ phase: 'done', done: report.conversations.seen, total: report.conversations.seen, report }, true);
        markChanged([]);
      })
      .catch((e) => {
        const error = msg(e);
        try { store.setMeta('last_import', JSON.stringify({ at: new Date().toISOString(), ok: false, source, error })); } catch { /* the event still carries it */ }
        try { ev({ phase: 'failed', done: 0, total: 0, error }, true); } catch { /* never an unhandled rejection */ }
        lastError = error;
      })
      .finally(() => { importing = false; });
  }
```
(ChatGPT memory documents written by an import are announced by the next `runDocs()`'s caller only if they are files; for path-less ones add `markChanged([], [], [])` — no: the import's final `markChanged([])` already tells the renderer to re-ask counts. Leave it.)

(f) docs sync, after `relink` and before `startWatching`:
```js
  // Docs (H6): notes by mtime/size + history by byte cursor, in the write queue (forget({documentId}) queues behind it).
  function runDocs() {
    if (!writer || !store || docsRunning || stopping) return;
    docsRunning = true;
    serial(() => syncDocs(store, { home: claudeHome, vaultDir }))
      .then((r) => { const d = [...r.changed, ...r.removed]; if (d.length) markChanged([], [], d); }, fail)
      .finally(() => { docsRunning = false; });
  }
```
In `startWatching()`, after `watcher = watchRoot(...)`: `docWatcher = watchDocs({ home: claudeHome, vaultDir }, runDocs); runDocs();` and in the sweep interval's `.finally(...)` add `runDocs();` beside `relink();`.

(g) ops — health: `counts: store ? store.counts() : { projects: 0, conversations: 0, messages: 0, documents: 0 }`. Add:
```js
    importChatGPT: (a) => {
      if (!writer) notOwner();
      const zipPath = a && typeof a.zipPath === 'string' ? a.zipPath : '';
      if (!zipPath || !path.isAbsolute(zipPath) || !/\.zip$/i.test(zipPath)) throw new Error('importChatGPT needs an absolute .zip path');
      if (!fs.existsSync(zipPath)) throw new Error('no such file: ' + path.basename(zipPath));
      if (importing) throw new Error('an import is already running');
      runImport(zipPath, 'chatgpt');
      return { started: true };
    },
    // readers answer these too; no open index is an error, never an empty list (Hub errors surface)
    listDocuments: (a) => { if (!store) throw new Error('the index is not open yet'); return store.listDocuments(a || {}); },
    getDocument: (a) => { if (!store) throw new Error('the index is not open yet'); return store.getDocument(a || {}); },
```
and change `importExport`'s `runImport(zipPath)` to `runImport(zipPath, 'claude')`. In `forget`'s `.then`, pass documents: `markChanged(a.conversationId ? [a.conversationId] : [], a.projectId ? [a.projectId] : [], a.documentId ? [a.documentId] : [])`.

- [ ] **Step 5: Implement the host + main hook.** In `dashboard/claude-hub-host.js`:
```js
const hubVaultDir = (env, vaultDir) => (env && env.HQ_VAULT_DIR) || vaultDir || null;
```
`create({ …, vaultDir = null, … })`; spawn args become `['--no-warnings', hubScript, '--db', dbFile, ...(latestFile ? ['--latest', latestFile] : []), ...(vaultDir ? ['--vault', vaultDir] : [])]`. In `registerIpc` add:
```js
  h('documents', (_e, o) => host.request('listDocuments', { ...obj(o) }));
  h('document', (_e, id) => host.request('getDocument', { id: String(id || '').slice(0, 300) }));
```
`init({ ipcMain, send, dataDir, appLog, vaultDir } = {})` passes `vaultDir: hubVaultDir(process.env, vaultDir)` to `create`. Export `hubVaultDir`.

`dashboard/main.js:1595` becomes exactly:
```js
    claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog, vaultDir: VAULT });   // Claude Hub (spec 2026-10-13): index of every Claude Code session
```

- [ ] **Step 6: Run the suites.**

Run: `node --test dashboard/claude-hub/*.test.mjs` then `node --test dashboard/*.test.mjs`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs dashboard/claude-hub-host.js dashboard/claude-hub-host.test.mjs dashboard/main.js
git commit -m "fe: H6.7 — Hub ops importChatGPT / listDocuments / getDocument / forget(documentId), docs sync + live watchers, --vault (HQ_VAULT_DIR wins); IPC documents/document; main.js:1595 passes vaultDir

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Drop-folder watcher `dashboard/claude-imports.js`, `importExport(kind, {dropId})` routing, preload + fake-preload parity, one new main.js line

**Files:**
- Create: `dashboard/claude-imports.js`
- Create: `dashboard/claude-imports.test.mjs`
- Modify: `dashboard/claude-import.js` (handler :6-16, `dialogPicker` :18-26, `init` :28-33)
- Modify: `dashboard/claude-import.test.mjs` (the `{ started: true, file }` expectations gain `kind: 'claude'`; append tests)
- Modify: `dashboard/preload.js` (`claudeHub` block :40-56; new `claudeImports` block after `claudeVault`)
- Modify: `dashboard-v5/tools/fake-preload.js` (SPEC :166-180) — same task so the fake-parity test never goes red
- Modify: `dashboard/main.js` — ONE new line directly after :1598 (the `claude-import` line); no other line

**Interfaces:**
- Consumes: `readZipIndex`, `baseName` from `dashboard/claude-hub/unzip.mjs` via dynamic `import()` (ESM; Electron 32's Node 20 cannot `require()` it); Hub ops `importExport({zipPath})`, `importChatGPT({zipPath})` (Task 7) through `host.request`; fixtures `writeChatGPTZip` (Task 3), `zipFiles` (make-export.mjs).
- Produces:
  - `claude-imports.js` exports `{ EVENT, FOLDER_NAME, importsDir(env), detectExportKind(names), readEntryNames(file), createWatcher(o), init(o), current() }`.
  - `detectExportKind(names:string[]) -> {kind:'chatgpt'|'claude'|null, reason:string|null}` (names = lower-cased basenames).
  - `createWatcher({dir, seenFile, send, readNames = readEntryNames, pollMs = 5000, stableMs = 2000, refuseAfterMs = 30000}) -> {start(), stop(), scan() -> Promise, pending() -> {folder:{exists, name}, found:[{dropId, file, bytes, kind}], refused:[{file, error}]}, dismiss(dropId) -> boolean, take(dropId) -> {file, kind, key}|null, markImported(key)}` — `file` in `found`/`refused` is the basename; `take()` returns the absolute path (main-side only).
  - `claude-import.js` `registerImport(ipcMain, host, {pickZip, readNames, getWatcher})`; IPC `hq:claude-hub:import (kind?, opts?)` → `{started, file, kind}|{canceled}|{error}`.
  - Preload: `claudeHub.importExport(kind, opts)`, `claudeHub.documents(opts)`, `claudeHub.document(id)`, `claudeImports.{pending(), dismiss(dropId), on(cb)}`.

- [ ] **Step 1: Write the failing watcher tests.** Create `dashboard/claude-imports.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeChatGPTZip } from './claude-hub/__fixtures__/make-chatgpt-export.mjs';
import { zipFiles } from './claude-hub/__fixtures__/make-export.mjs';
const require = createRequire(import.meta.url);
const { detectExportKind, createWatcher, importsDir, EVENT } = require('./claude-imports.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rig = (o = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-imports-'));
  const dir = path.join(root, 'WorkspaceHQ Imports'); fs.mkdirSync(dir);
  const sent = [];
  const w = createWatcher({ dir, seenFile: path.join(root, 'claude', 'imports-seen.json'), send: (ch, d) => sent.push([ch, d]), stableMs: 100, refuseAfterMs: 400, pollMs: 60000, ...o });
  return { root, dir, sent, w, found: () => sent.filter(([, d]) => d.event === 'found').map(([, d]) => d.data) };
};
const settle = async (w, n = 3) => { for (let i = 0; i < n; i++) { await w.scan(); await sleep(130); } await w.scan(); };

test('detectExportKind: ChatGPT, claude.ai, and the refusal wording', () => {
  assert.deepEqual(detectExportKind(['conversations.json', 'user.json', 'chat.html']), { kind: 'chatgpt', reason: null });
  assert.deepEqual(detectExportKind(['conversations.json', 'projects.json', 'users.json']), { kind: 'claude', reason: null });
  assert.deepEqual(detectExportKind(['conversations.json', 'users.json']), { kind: 'claude', reason: null });
  assert.equal(detectExportKind(['photos.json']).reason, 'Not a ChatGPT or claude.ai export (looked for conversations.json)');
  assert.equal(detectExportKind(['conversations.json']).kind, null);
  assert.equal(importsDir({ HQ_IMPORTS_DIR: 'C:\\gate\\imports' }), 'C:\\gate\\imports');
  assert.match(importsDir({}), /Documents[\\/]WorkspaceHQ Imports$/);
});

test('waits for a stable, readable ZIP before announcing', async () => {
  const { dir, w, sent, found, root } = rig();
  const full = fs.readFileSync(writeChatGPTZip(path.join(root, 'src.zip')));
  const target = path.join(dir, 'chatgpt-export.zip');
  fs.writeFileSync(target, full.subarray(0, 64));   // a copy in progress: no central directory yet
  await w.scan(); await sleep(130); await w.scan();
  assert.deepEqual(sent, [], 'a half-written ZIP is neither announced nor refused (yet)');
  fs.writeFileSync(target, full);                   // the copy finished
  await settle(w);
  assert.deepEqual(found().map((f) => [f.file, f.kind, f.bytes]), [['chatgpt-export.zip', 'chatgpt', full.length]]);
  assert.equal(sent[0][0], EVENT);
  assert.equal(found().length, 1, 'announced once');
  assert.deepEqual(w.pending().found.map((f) => f.file), ['chatgpt-export.zip']);
  assert.equal(w.pending().folder.exists, true); assert.equal(w.pending().folder.name, 'WorkspaceHQ Imports');
});

test('a ZIP that stays unreadable is refused only after it stopped changing for refuseAfterMs; a non-export ZIP is refused with the reason', async () => {
  const { dir, w, sent } = rig();
  fs.writeFileSync(path.join(dir, 'broken.zip'), 'not a zip at all');
  zipFiles(path.join(dir, 'photos.zip'), [{ name: 'a.txt', data: 'placeholder' }]);
  await settle(w, 2);
  const errs = () => sent.filter(([, d]) => d.event === 'error').map(([, d]) => d.data);
  assert.deepEqual(errs().map((e) => e.file), ['photos.zip']);
  assert.equal(errs()[0].error, 'Not a ChatGPT or claude.ai export (looked for conversations.json)');
  await sleep(450); await w.scan();
  assert.deepEqual(errs().map((e) => e.file).sort(), ['broken.zip', 'photos.zip']);
  assert.match(errs().find((e) => e.file === 'broken.zip').error, /not a readable ZIP/);
});

test('dismiss and import are remembered across restarts; a vanished file is gone; the drop folder is never written', async () => {
  const r = rig();
  const a = writeChatGPTZip(path.join(r.dir, 'a.zip'));
  zipFiles(path.join(r.dir, 'b.zip'), [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }]);
  const before = fs.readdirSync(r.dir).sort();
  await settle(r.w);
  const [fa, fb] = ['a.zip', 'b.zip'].map((n) => r.found().find((f) => f.file === n));
  assert.equal(fb.kind, 'claude');
  assert.equal(r.w.dismiss(fb.dropId), true); assert.equal(r.w.dismiss('nope'), false);
  const t = r.w.take(fa.dropId);
  assert.equal(t.file, a); assert.equal(t.kind, 'chatgpt');
  r.w.markImported(t.key);
  assert.deepEqual(r.w.pending().found, []);
  assert.ok(r.sent.some(([, d]) => d.event === 'gone' && d.data.dropId === fb.dropId));
  const seen = JSON.parse(fs.readFileSync(path.join(r.root, 'claude', 'imports-seen.json'), 'utf8'));
  assert.deepEqual(Object.values(seen).sort(), ['dismissed', 'imported']);
  const again = createWatcher({ dir: r.dir, seenFile: path.join(r.root, 'claude', 'imports-seen.json'), send: () => {}, stableMs: 100, pollMs: 60000 });
  await settle(again);
  assert.deepEqual(again.pending().found, [], 'answered files are never announced again');
  assert.deepEqual(fs.readdirSync(r.dir).sort(), before, 'nothing created, moved or deleted in the drop folder');
  const c = writeChatGPTZip(path.join(r.dir, 'c.zip'));
  await settle(r.w);
  const fc = r.found().find((f) => f.file === 'c.zip');
  fs.rmSync(c);
  await r.w.scan();
  assert.ok(r.sent.some(([, d]) => d.event === 'gone' && d.data.dropId === fc.dropId));
  assert.equal(r.w.take(fc.dropId), null);
});

test('a missing drop folder is reported, not created', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-imports-none-'));
  const dir = path.join(root, 'WorkspaceHQ Imports');
  const w = createWatcher({ dir, seenFile: path.join(root, 'seen.json'), send: () => {}, pollMs: 60000 });
  await w.scan();
  assert.deepEqual(w.pending(), { folder: { exists: false, name: 'WorkspaceHQ Imports' }, found: [], refused: [] });
  assert.equal(fs.existsSync(dir), false);
});
```

- [ ] **Step 2: Write the failing routing tests.** In `dashboard/claude-import.test.mjs`: every `{ started: true, file: '…' }` expectation gains `kind: 'claude'`. Extend `rig` to `function rig(pick, answer = { started: true }, extra = {})` passing `{ pickZip: pick, ...extra }` to `registerImport`, and `run: (...a) => handlers.get('hq:claude-hub:import')({}, ...a)`. Append:

```js
test('H6: kind routing — chatgpt goes to importChatGPT, auto detects, a mismatch and an unknown kind are refused', async () => {
  const names = { 'C:\\p\\cg.zip': ['conversations.json', 'user.json'], 'C:\\p\\cl.zip': ['conversations.json', 'projects.json'], 'C:\\p\\x.zip': ['a.txt'] };
  const readNames = async (f) => names[f];
  let r = rig(async () => 'C:\\p\\cg.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('chatgpt'), { started: true, file: 'cg.zip', kind: 'chatgpt' });
  assert.equal(r.calls[0][0], 'importChatGPT');
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('auto'), { started: true, file: 'cl.zip', kind: 'claude' });
  assert.equal(r.calls[0][0], 'importExport');
  r = rig(async () => 'C:\\p\\x.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('auto'), { error: 'Not a ChatGPT or claude.ai export (looked for conversations.json)' });
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('chatgpt'), { error: 'That is a claude.ai export, not a ChatGPT export' }, 'an explicit kind is checked, not trusted');
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cg.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('claude'), { error: 'That is a ChatGPT export, not a claude.ai export' });
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('nope'), { error: 'unknown import kind' });
  assert.equal(r.calls.length, 0);
});

test('H6: a dropId imports the watcher\'s file with no dialog and marks it imported; an unknown dropId is refused', async () => {
  const marked = [];
  const w = { take: (id) => (id === 'd1' ? { file: 'C:\\drop\\cg.zip', kind: 'chatgpt', key: 'cg.zip|1|1' } : null), markImported: (k) => marked.push(k) };
  const r = rig(async () => { throw new Error('the dialog must not open'); }, { started: true }, { getWatcher: () => w });
  assert.deepEqual(await r.run('auto', { dropId: 'd1' }), { started: true, file: 'cg.zip', kind: 'chatgpt' });
  assert.deepEqual(r.calls[0].slice(0, 2), ['importChatGPT', { zipPath: 'C:\\drop\\cg.zip' }]);
  assert.deepEqual(marked, ['cg.zip|1|1']);
  assert.deepEqual(await r.run('auto', { dropId: 'zz' }), { error: 'that dropped file is gone or was already handled' });
  const bad = rig(async () => null, { error: 'an import is already running' }, { getWatcher: () => w });
  assert.deepEqual(await bad.run('auto', { dropId: 'd1' }), { error: 'an import is already running' });
});
```

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard/claude-imports.test.mjs dashboard/claude-import.test.mjs`
Expected: FAIL — `Cannot find module './claude-imports.js'`; `kind` missing from answers.

- [ ] **Step 4: Implement the watcher.** Create `dashboard/claude-imports.js`:

```js
// AI archive H6 — the imports drop folder (spec 2026-10-15 §2, §3, §6.3). Main side, new file, one hook line in main.js.
// Read-only on the folder: it is listed and ZIP central directories are read; nothing is created, moved or deleted there.
// A file is announced once (a `found` push + pending()) and imported only after the owner confirms in v5.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const EVENT = 'hq:claude-imports:event';
const FOLDER_NAME = 'WorkspaceHQ Imports';
const NOT_EXPORT = 'Not a ChatGPT or claude.ai export (looked for conversations.json)';
const importsDir = (env = process.env) => env.HQ_IMPORTS_DIR || path.join(os.homedir(), 'Documents', FOLDER_NAME);

function detectExportKind(names) {
  const has = (n) => names.includes(n);
  if (!has('conversations.json')) return { kind: null, reason: NOT_EXPORT };
  if (has('user.json')) return { kind: 'chatgpt', reason: null };
  if (has('projects.json') || has('users.json')) return { kind: 'claude', reason: null };
  return { kind: null, reason: 'This ZIP has conversations.json but neither user.json (ChatGPT) nor projects.json / users.json (claude.ai) — use Import ChatGPT export or Import claude.ai export' };
}

let unzipMod = null;   // ESM: Electron 32's Node cannot require() it
async function readEntryNames(file) {
  if (!unzipMod) unzipMod = await import(pathToFileURL(path.join(__dirname, 'claude-hub', 'unzip.mjs')).href);
  const { entries } = await unzipMod.readZipIndex(file);
  return entries.filter((e) => !e.name.endsWith('/')).map((e) => unzipMod.baseName(e.name).toLowerCase());
}

function createWatcher({ dir, seenFile, send = () => {}, readNames = readEntryNames, pollMs = 5000, stableMs = 2000, refuseAfterMs = 30000 }) {
  let seen = {};
  try { const s = JSON.parse(fs.readFileSync(seenFile, 'utf8')); if (s && typeof s === 'object') seen = s; } catch { /* first run */ }
  const cand = new Map();      // name -> {size, mtimeMs, since}
  const found = new Map();     // dropId -> {dropId, name, file, bytes, kind, key}
  const refused = new Map();   // key -> {file, error}
  let exists = false, timer = null, fsw = null, debounce = null, scanning = null;
  const push = (event, data) => { try { send(EVENT, { event, data }); } catch { /* a closed window */ } };
  const saveSeen = () => {
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    const tmp = seenFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seen)); fs.renameSync(tmp, seenFile);
  };
  const drop = (d) => { found.delete(d.dropId); push('gone', { dropId: d.dropId }); };

  async function scanOnce() {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); exists = true; } catch { exists = false; ents = []; }
    const now = Date.now(), live = new Map();
    for (const e of ents) {
      if (!e.isFile() || !/\.zip$/i.test(e.name)) continue;
      let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
      live.set(e.name, { size: st.size, mtimeMs: Math.floor(st.mtimeMs), key: e.name + '|' + st.size + '|' + Math.floor(st.mtimeMs) });
    }
    for (const d of [...found.values()]) { const l = live.get(d.name); if (!l || l.key !== d.key) drop(d); }   // vanished or replaced
    for (const [name, l] of live) {
      if (seen[l.key] || refused.has(l.key) || [...found.values()].some((d) => d.key === l.key)) continue;
      const c = cand.get(name);
      if (!c || c.size !== l.size || c.mtimeMs !== l.mtimeMs) { cand.set(name, { size: l.size, mtimeMs: l.mtimeMs, since: now }); continue; }
      if (now - c.since < stableMs) continue;
      let names;
      try { names = await readNames(path.join(dir, name)); }
      catch (err) {   // still being written, locked, or not a ZIP: refuse only once it has been still for refuseAfterMs
        if (now - c.since >= refuseAfterMs) { cand.delete(name); refused.set(l.key, { file: name, error: 'not a readable ZIP (' + String((err && err.message) || err).slice(0, 120) + ')' }); push('error', refused.get(l.key)); }
        continue;
      }
      cand.delete(name);
      const k = detectExportKind(names);
      if (!k.kind) { refused.set(l.key, { file: name, error: k.reason }); push('error', refused.get(l.key)); continue; }
      const d = { dropId: crypto.randomBytes(8).toString('hex'), name, file: path.join(dir, name), bytes: l.size, kind: k.kind, key: l.key };
      found.set(d.dropId, d);
      push('found', { dropId: d.dropId, file: name, bytes: d.bytes, kind: d.kind });
    }
    for (const name of [...cand.keys()]) if (!live.has(name)) cand.delete(name);
  }
  const scan = () => { if (!scanning) scanning = scanOnce().finally(() => { scanning = null; }); return scanning; };
  const arm = () => {
    if (fsw) return;
    try {
      fsw = fs.watch(dir, () => { clearTimeout(debounce); debounce = setTimeout(scan, 500); });
      fsw.on('error', () => { try { fsw.close(); } catch { /* closed */ } fsw = null; });
    } catch { fsw = null; }   // missing folder: the poll re-arms once it exists
  };
  return {
    start() { scan().then(arm, () => {}); timer = setInterval(() => { scan().then(arm, () => {}); }, pollMs); },
    stop() { clearInterval(timer); clearTimeout(debounce); try { fsw && fsw.close(); } catch { /* closed */ } fsw = null; },
    scan,
    pending: () => ({ folder: { exists, name: path.basename(dir) },
      found: [...found.values()].map(({ dropId, name, bytes, kind }) => ({ dropId, file: name, bytes, kind })),
      refused: [...refused.values()] }),
    dismiss(dropId) { const d = found.get(dropId); if (!d) return false; seen[d.key] = 'dismissed'; saveSeen(); drop(d); return true; },
    take(dropId) { const d = found.get(dropId); return d ? { file: d.file, kind: d.kind, key: d.key } : null; },
    markImported(key) { seen[key] = 'imported'; saveSeen(); for (const d of [...found.values()]) if (d.key === key) drop(d); },
  };
}

let current_ = null;
function init({ ipcMain, send, dataDir, env = process.env }) {
  // next to the Hub's db (HQ_CLAUDE_DB moves both): a gate's second instance never writes the owner's data/claude
  const db = env.HQ_CLAUDE_DB || path.join(dataDir, 'claude', 'hub.sqlite');
  current_ = createWatcher({ dir: importsDir(env), seenFile: path.join(path.dirname(db), 'imports-seen.json'), send });
  ipcMain.handle('hq:claude-imports:pending', () => current_.pending());
  ipcMain.handle('hq:claude-imports:dismiss', (_e, id) => current_.dismiss(String(id || '')));
  current_.start();
  return current_;
}
const current = () => current_;

module.exports = { EVENT, FOLDER_NAME, importsDir, detectExportKind, readEntryNames, createWatcher, init, current };
```

- [ ] **Step 5: Implement the routing.** Replace `registerImport` and `dialogPicker` in `dashboard/claude-import.js`:

```js
const imports = require('./claude-imports');
const KINDS = ['auto', 'claude', 'chatgpt'];
const LABEL = { claude: 'claude.ai', chatgpt: 'ChatGPT' };

function registerImport(ipcMain, host, { pickZip, readNames = imports.readEntryNames, getWatcher = imports.current }) {
  ipcMain.handle('hq:claude-hub:import', async (_e, kind, opts) => {
    const k = kind === undefined || kind === null ? 'claude' : kind;   // no kind = H4, unchanged
    if (!KINDS.includes(k)) return { error: 'unknown import kind' };
    const dropId = opts && typeof opts === 'object' && typeof opts.dropId === 'string' ? opts.dropId : null;
    let file, detected = null, key = null;
    if (dropId) {
      const w = getWatcher(), d = w && w.take(dropId);
      if (!d) return { error: 'that dropped file is gone or was already handled' };
      ({ file, kind: detected, key } = d);
    } else {
      try { file = await pickZip(k); } catch { return { error: 'could not open the file dialog' }; }
      if (!file) return { canceled: true };
      if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.zip$/i.test(file)) return { error: 'pick a .zip file' };
    }
    let use = k;
    // An explicit kind (the v5 buttons, a drop) is checked against the ZIP's entry names, so a claude.ai ZIP picked under
    // "Import ChatGPT export" (or the reverse) is refused here with both names instead of "succeeding" with every row
    // skipped (IPC-CONTRACT H6 row). No kind at all = the H4 call, unchanged (no extra read).
    const explicit = kind !== undefined && kind !== null;
    if (explicit || dropId) {
      if (!detected) {
        let names; try { names = await readNames(file); } catch (e) { return { error: 'could not read that ZIP: ' + String((e && e.message) || e).slice(0, 120) }; }
        const d = imports.detectExportKind(names);
        if (!d.kind) return { error: d.reason };
        detected = d.kind;
      }
      if (k !== 'auto' && k !== detected) return { error: 'That is a ' + LABEL[detected] + ' export, not a ' + LABEL[k] + ' export' };
      use = detected;
    }
    const r = await host.request(use === 'chatgpt' ? 'importChatGPT' : 'importExport', { zipPath: file });
    if (r && typeof r.error === 'string') return { error: r.error };
    if (key) { const w = getWatcher(); if (w) w.markImported(key); }
    return { started: true, file: path.basename(file), kind: use };
  });
}

function dialogPicker(getWin) {
  return async (kind) => {
    const { dialog } = require('electron');
    const what = kind === 'chatgpt' ? 'ChatGPT export' : kind === 'auto' ? 'ChatGPT or claude.ai export' : 'claude.ai export';
    const opts = { title: 'Import ' + what, properties: ['openFile'], filters: [{ name: what + ' (.zip)', extensions: ['zip'] }] };
    const win = getWin && getWin();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r && !r.canceled && r.filePaths && r.filePaths[0] ? r.filePaths[0] : null;
  };
}
```
(`init` is unchanged; its `pickZip` for the gate env still ignores the kind.)

The stable-file rule depends on `readZipIndex` THROWING for a file with no end-of-central-directory record (unzip.mjs:30 `throw new Error('not a zip file')`, also for files shorter than 22 bytes) and for a truncated central directory (`'truncated zip'`): that throw is what keeps a half-copied file a candidate instead of a refusal. If that ever changes, the fix belongs in `readEntryNames` (throw when the index has no entries AND the file is still changing), never in `detectExportKind`.

- [ ] **Step 6: Preload, fake preload, main.** In `dashboard/preload.js` `claudeHub` block replace the `importExport` line and add two lines after it:
```js
    importExport: (kind, opts) => ipcRenderer.invoke('hq:claude-hub:import', kind, opts),
    documents: (opts) => ipcRenderer.invoke('hq:claude-hub:documents', opts),
    document: (id) => ipcRenderer.invoke('hq:claude-hub:document', id),
```
After the `claudeVault` block add:
```js
  // AI archive H6: the imports drop folder — announced once, imported only after the owner confirms
  claudeImports: {
    pending: () => ipcRenderer.invoke('hq:claude-imports:pending'),
    dismiss: (dropId) => ipcRenderer.invoke('hq:claude-imports:dismiss', dropId),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:claude-imports:event', handler);
      return () => ipcRenderer.removeListener('hq:claude-imports:event', handler);
    },
  },
```
In `dashboard-v5/tools/fake-preload.js` add near the other fixtures `const HUB_DOCS = [{ id: 'memory:fake1', source: 'memory', path: 'C:\\fake\\.claude\\projects\\p\\memory\\tea.md', title: 'Fake tea rule', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 40, origin: null, snippet: 'offer fake \u0002tea\u0003 first', rank: -1 }, { id: 'claude-md:fake2', source: 'claude-md', path: 'C:\\fake\\p\\CLAUDE.md', title: 'CLAUDE.md — p', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 30, origin: null, snippet: 'fake \u0002tea\u0003 rules', rank: -0.5 }];` and SPEC entries:
```js
    ['claudeHub.importExport', (kind) => ({ started: true, file: kind === 'chatgpt' ? 'chatgpt-export.zip' : 'claude-export.zip', kind: kind === 'chatgpt' ? 'chatgpt' : 'claude' })],
    ['claudeHub.documents', () => HUB_DOCS],
    ['claudeHub.document', (id) => { const d = HUB_DOCS.find((x) => x.id === id); return d ? { ...d, text: 'Offer fake tea first.\nFake second line.', meta: null } : null; }],
    ['claudeImports.pending', () => ({ folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [], refused: [] })],
    ['claudeImports.dismiss', WRITE],
    ['claudeImports.on', 'on:hq:claude-imports:event'],
```
(the first three replace the existing `claudeHub.importExport` entry at that spot; the three `claudeImports.*` rows go right after `['claudeVault.save', WRITE],`, mirroring preload.js top to bottom as the SPEC header asks — parity itself is set-based in `fake-preload.test.mjs` and CDP `fake-parity`). In `dashboard/main.js` insert directly after line 1598 (`require('./claude-import').init(...)`):
```js
    require('./claude-imports').init({ ipcMain, send: castSend, dataDir: DATA });   // AI archive H6: imports drop folder watcher (asks once in v5; never writes the folder)
```

- [ ] **Step 7: Run the suites.**

Run: `node --test dashboard/*.test.mjs` then `node --test dashboard-v5/tools/*.test.mjs`
Expected: PASS (incl. `fake-preload.test.mjs` parity).

- [ ] **Step 8: Commit**

```bash
git add dashboard/claude-imports.js dashboard/claude-imports.test.mjs dashboard/claude-import.js dashboard/claude-import.test.mjs dashboard/preload.js dashboard/main.js dashboard-v5/tools/fake-preload.js
git commit -m "fe: H6.8 — imports drop-folder watcher (stable-file check, kind by ZIP entry names, asked once, seen file, never writes the folder), importExport(kind, {dropId}) routing, preload + fake parity; main.js: one new hook line after :1598

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: v5 data layer — adapter (document hits, document view, drop cards, ChatGPT report/labels) and live store (documents in search, `claudeImports` slot)

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (`hubConv` :486; after `hubHit` :508; `importReportLines` :586; `importView` :601)
- Modify: `dashboard-v5/src/live/adapter.test.mjs` (append)
- Modify: `dashboard-v5/src/live/store.js` (`live.claudeLib` :49, new `live.claudeImports` after :51; `searchClaude` :303; new `openClaudeDocument` / `closeClaudeDocument` / `refreshClaudeImports`; `start()` :205-230; return :355-366)
- Modify: `dashboard-v5/src/live/store.test.mjs` (append)

No template or vals change in this task: the 149 golden hashes and `tpl.hash.test.mjs` must stay green here (verify in Step 5).

**Interfaces:**
- Consumes: preload `claudeHub.search`, `claudeHub.documents(opts)`, `claudeHub.document(id)`, `claudeImports.pending()`, `claudeImports.on(cb)` (Task 8; fake-preload has them); adapter `snippetParts`, `whenOf`, `fmtBytes`, `obj`, `num`, `arr` (existing private/exported helpers in adapter.mjs — use whatever names the file already has for these).
- Produces:
  - adapter: `SOURCE_LABEL = {code:'Code', web:'claude.ai', chatgpt:'ChatGPT'}`; `hubConv(...).sourceLabel` uses it; `DOC_BADGE = {memory:'memory', 'claude-md':'CLAUDE.md', prompt:'prompt', history:'history'}`; `hubDocHit(row, now) -> {id, badge, title, when, parts, origin}`; `hubDocument(res, now) -> {id, badge, title, project, when, text, lines:[{key, text}]}|null`; `dropCards(imports) -> [{dropId, kind, text, sub}]`; `importReportLines(r)` handles `r.source === 'chatgpt'`; `importView(...).text` names ChatGPT for a ChatGPT import.
  - store: `live.claudeLib.docHits` (`null` | rows), `live.claudeLib.doc` (`null` | `{loading:true, id}` | document | `{error, id}`); `live.claudeImports = {folder:null|{exists,name}, found:[], refused:[], error:null}`; methods `openClaudeDocument(id)`, `closeClaudeDocument()`, `refreshClaudeImports()`.

- [ ] **Step 1: Write the failing adapter tests.** Append to `dashboard-v5/src/live/adapter.test.mjs` (add the new names to its import from `./adapter.mjs`):

```js
test('H6: ChatGPT rows are labelled ChatGPT; document hits carry a badge and text parts', () => {
  assert.equal(hubConv({ id: 'chatgpt:x', source: 'chatgpt', title: 't' }).sourceLabel, 'ChatGPT');
  assert.equal(hubConv({ id: 'web:x', source: 'web' }).sourceLabel, 'claude.ai');
  const h = hubDocHit({ id: 'claude-md:1', source: 'claude-md', title: 'CLAUDE.md — p', mtime_ms: Date.parse('2026-10-01T00:00:00Z'), snippet: 'fake \u0002tea\u0003 rules', origin: null }, Date.parse('2026-10-02T00:00:00Z'));
  assert.equal(h.badge, 'CLAUDE.md'); assert.equal(h.title, 'CLAUDE.md — p');
  assert.deepEqual(h.parts.map((p) => [p.text, !!p.hit]), [['fake ', false], ['tea', true], [' rules', false]]);
  assert.equal(hubDocHit({ id: 'memory:chatgpt:1', source: 'memory', origin: 'chatgpt', title: null }).badge, 'memory (ChatGPT)');
  assert.equal(hubDocHit({ id: 'x', source: 'other' }).badge, 'document');
});

test('H6: hubDocument shows masked text as plain lines; null and junk are null', () => {
  const d = hubDocument({ id: 'memory:1', source: 'memory', title: 'Tea', text: 'line one\nline two', project_path: 'C:\\fake\\p', mtime_ms: 1 }, 2);
  assert.equal(d.badge, 'memory'); assert.equal(d.project, 'C:\\fake\\p');
  assert.deepEqual(d.lines.map((l) => l.text), ['line one', 'line two']);
  assert.equal(hubDocument(null), null); assert.equal(hubDocument({ error: 'x' }), null);
});

test('H6: dropCards say what and how big, never a guessed chat count', () => {
  const cards = dropCards({ found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 38 * 1000 * 1000, kind: 'chatgpt' }, { dropId: 'd2', file: 'c.zip', bytes: 1000, kind: 'claude' }] });
  assert.equal(cards[0].text, 'Import ChatGPT export (chatgpt-export.zip, 38 MB)?');
  assert.equal(cards[1].text.startsWith('Import claude.ai export (c.zip, '), true);
  assert.ok(cards.every((c) => !/chats\)/.test(c.text)));
  assert.match(cards[0].sub, /read on this PC only/);
  assert.deepEqual(dropCards(null), []);
});

test('H6: a ChatGPT import report is counts only and names branches and other files', () => {
  const lines = importReportLines({ source: 'chatgpt', conversations: { imported: 4, unchanged: 1, forgotten: 0, skipped: 2 }, messages: { imported: 10, skipped: 1, empty: 0 },
    branches: { skipped: 2 }, files: { other: ['chat.html', 'message_feedback.json'] }, memory: { found: true, imported: 2 }, unknownFields: {}, truncated: false });
  assert.deepEqual(lines, [
    'Chats: 4 imported · 1 unchanged · 0 forgotten · 2 skipped',
    'Messages: 10 imported · 1 skipped · 0 empty',
    'Other branches of edited chats: 2 (not imported — the version you last saw is)',
    'Memory: 2 saved as memory documents',
    'Not imported (counted): chat.html, message_feedback.json',
  ]);
  const v = importView({ kind: 'import', source: 'chatgpt', phase: 'done', report: { source: 'chatgpt', conversations: { imported: 4 } } }, { state: 'ready', role: 'writer' }, { hasBridge: true, canWrite: true });
  assert.equal(v.text, 'Imported 4 ChatGPT chats');
});
```

(`fmtBytes` (adapter.mjs:16) is decimal: `Math.round(b / 1e6) + ' MB'`, so 38 000 000 bytes is exactly "38 MB"; the card text must use that same helper.)

- [ ] **Step 2: Write the failing store tests.** Append to `dashboard-v5/src/live/store.test.mjs`:

```js
function h6Hq() {
  let pushImports = null;
  const calls = [];
  const hq = {
    claudeHub: {
      health: async () => ({ state: 'ready', role: 'writer' }), on: () => () => {},
      search: async (q) => { calls.push(['search', q]); return [{ messageId: 'm', conversationId: 'code:s', title: 't', snippet: 'a \u0002tea\u0003', at: '2026-10-01T00:00:00Z' }]; },
      documents: async (o) => { calls.push(['documents', o]); return [{ id: 'memory:1', source: 'memory', title: 'Tea', snippet: '\u0002tea\u0003', mtime_ms: 1 }]; },
      document: async (id) => { calls.push(['document', id]); return id === 'memory:1' ? { id, source: 'memory', title: 'Tea', text: 'masked text' } : null; },
    },
    claudeImports: {
      pending: async () => ({ folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd0', file: 'old.zip', bytes: 1, kind: 'claude' }], refused: [] }),
      on: (cb) => { pushImports = cb; return () => { pushImports = null; }; }, dismiss: async () => true,
    },
  };
  return { hq, calls, push: (e) => pushImports && pushImports(e) };
}

test('H6: search asks messages and documents together under one staleness token; documents exclude nothing client-side', async () => {
  const { hq, calls } = h6Hq();
  const st = createStore(DATA(), hq);
  await st.searchClaude('tea');
  assert.deepEqual(calls.filter((c) => c[0] !== 'document').map((c) => c[0]).sort(), ['documents', 'search']);
  assert.deepEqual(calls.find((c) => c[0] === 'documents')[1], { q: 'tea', limit: 20 });
  assert.equal(st.live.claudeLib.hits.length, 1); assert.equal(st.live.claudeLib.docHits.length, 1);
  await st.searchClaude('   ');
  assert.equal(st.live.claudeLib.docHits, null);
});

test('H6: openClaudeDocument loads in place; an unknown id says so; close clears', async () => {
  const { hq } = h6Hq();
  const st = createStore(DATA(), hq);
  await st.openClaudeDocument('memory:1');
  assert.equal(st.live.claudeLib.doc.text, 'masked text');
  await st.openClaudeDocument('memory:gone');
  assert.deepEqual(st.live.claudeLib.doc, { id: 'memory:gone', error: 'That document is no longer in the index (its file was removed or it was forgotten).' });
  st.closeClaudeDocument();
  assert.equal(st.live.claudeLib.doc, null);
});

test('H6: claudeImports — pending on start, found/gone/error pushes', async () => {
  const { hq, push } = h6Hq();
  const st = createStore(DATA(), hq);
  st.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(st.live.claudeImports.found.map((f) => f.dropId), ['d0']);
  push({ event: 'found', data: { dropId: 'd1', file: 'cg.zip', bytes: 5, kind: 'chatgpt' } });
  push({ event: 'found', data: { dropId: 'd1', file: 'cg.zip', bytes: 5, kind: 'chatgpt' } });   // a replay never doubles
  assert.deepEqual(st.live.claudeImports.found.map((f) => f.dropId), ['d0', 'd1']);
  push({ event: 'gone', data: { dropId: 'd0' } });
  push({ event: 'error', data: { file: 'x.zip', error: 'Not a ChatGPT or claude.ai export (looked for conversations.json)' } });
  assert.deepEqual(st.live.claudeImports.found.map((f) => f.dropId), ['d1']);
  assert.equal(st.live.claudeImports.refused[0].file, 'x.zip');
  st.stop();
});
```

- [ ] **Step 3: Run to verify they fail.**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `hubDocHit is not exported`, `st.openClaudeDocument is not a function`, `live.claudeImports` undefined.

- [ ] **Step 4: Implement.** In `adapter.mjs`:

```js
export const SOURCE_LABEL = { code: 'Code', web: 'claude.ai', chatgpt: 'ChatGPT' };
// in hubConv: sourceLabel: SOURCE_LABEL[r.source] || 'Code',
export const DOC_BADGE = { memory: 'memory', 'claude-md': 'CLAUDE.md', prompt: 'prompt', history: 'history' };
const docBadge = (r) => (DOC_BADGE[r.source] || 'document') + (r.origin === 'chatgpt' ? ' (ChatGPT)' : '');
const docWhen = (ms, now) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? whenOf(new Date(Number(ms)).toISOString(), now) : '');
export function hubDocHit(h, now = Date.now()) {
  const r = obj(h);
  return { id: String(r.id || ''), badge: docBadge(r), title: r.title ? String(r.title) : 'Untitled document', when: docWhen(r.mtime_ms, now), parts: snippetParts(r.snippet), origin: r.origin || null };
}
export function hubDocument(res, now = Date.now()) {
  if (!res || typeof res !== 'object' || res.error || !res.id) return null;
  const r = obj(res), text = String(r.text || '');
  return { id: String(r.id), badge: docBadge(r), title: r.title ? String(r.title) : 'Untitled document', project: String(r.project_path || ''),
    when: docWhen(r.mtime_ms, now), text, lines: text.split('\n').map((t, i) => ({ key: 'l' + i, text: t })) };
}
const KIND_LABEL = { chatgpt: 'ChatGPT', claude: 'claude.ai' };
export function dropCards(imp) {
  return arr(obj(imp).found).map((f) => ({ dropId: String(f.dropId || ''), kind: f.kind === 'chatgpt' ? 'chatgpt' : 'claude',
    text: `Import ${KIND_LABEL[f.kind] || 'claude.ai'} export (${String(f.file || 'export.zip')}, ${fmtBytes(num(f.bytes, 0))})?`,
    sub: 'Found in your WorkspaceHQ Imports folder. It is read on this PC only; nothing is uploaded, and the file is left where it is.' }));
}
```

`importReportLines(r)`: when `r.source === 'chatgpt'`, return the Chats and Messages lines (same wording as today), then `Other branches of edited chats: N (not imported — the version you last saw is)` when `branches.skipped > 0`, then `Memory: N saved as memory documents` when `memory.imported > 0` (or `Memory file found but not recognized — nothing imported` when `memory.found && !memory.imported`), then `Not imported (counted): <files.other joined ', '>` when non-empty, then the existing unknown-fields and truncated lines; the claude.ai branch is unchanged (it keeps its Projects line). `importView`: when the current import or `hub.lastImport` has `source === 'chatgpt'`, the done text is `Imported N ChatGPT chat(s)` / `Nothing new — N ChatGPT chat(s) …` (same structure as today, with `ChatGPT ` inserted before `chat`). Existing H4 outputs must not change — the adapter tests for H4 stay as they are.

In `store.js`:
- `claudeLib` initial value gains `docHits: null, doc: null`; add `claudeImports: { folder: null, found: [], refused: [], error: null },   // AI archive H6: drop-folder offers (main's watcher), raw` to `live`.
- `searchClaude(q)`: in the no-terms branch also set `lib().docHits = null;`. Replace the final `return hubCall(...)` with:
```js
    const docs = hq.claudeHub.documents
      ? hubCall(() => hq.claudeHub.documents({ q: lib().q, limit: 20 }), (r) => { lib().docHits = Array.isArray(r) ? r : []; }, stale)
      : Promise.resolve();
    return Promise.all([hubCall(() => hq.claudeHub.search(lib().q, { limit: 50 }), (r) => { lib().hits = Array.isArray(r) ? r : []; }, stale), docs]);
```
- new functions:
```js
  const DOC_GONE = 'That document is no longer in the index (its file was removed or it was forgotten).';
  function openClaudeDocument(id) {
    if (!hq || !hq.claudeHub || !hq.claudeHub.document) return Promise.resolve();
    const my = ++seq.doc, stale = () => my !== seq.doc;
    lib().doc = { id: String(id), loading: true }; emit();
    return hubCall(() => hq.claudeHub.document(String(id)), (r) => { lib().doc = r && r.id ? r : { id: String(id), error: DOC_GONE }; }, stale,
      (m) => { lib().doc = { id: String(id), error: m }; });
  }
  function closeClaudeDocument() { ++seq.doc; lib().doc = null; emit(); }
  const imp = () => live.claudeImports;
  function refreshClaudeImports() {
    if (!hq || !hq.claudeImports || !hq.claudeImports.pending) return Promise.resolve();
    return Promise.resolve().then(() => hq.claudeImports.pending()).then((p) => {
      if (isObj(p)) { imp().folder = isObj(p.folder) ? p.folder : null; imp().found = Array.isArray(p.found) ? p.found : []; imp().refused = Array.isArray(p.refused) ? p.refused : []; imp().error = null; }
    }, (e) => { imp().error = 'Imports folder: ' + ((e && e.message) || e); }).finally(emit);
  }
  function applyImports(e) {
    if (!isObj(e) || !isObj(e.data)) return;
    const d = e.data;
    if (e.event === 'found' && d.dropId && !imp().found.some((f) => f.dropId === d.dropId)) imp().found = [...imp().found, d];
    else if (e.event === 'gone') imp().found = imp().found.filter((f) => f.dropId !== d.dropId);
    else if (e.event === 'error' && d.file) imp().refused = [...imp().refused.filter((x) => x.file !== d.file), d].slice(-10);
    emit();
  }
```
  and `seq` becomes `{ filters: 0, thread: 0, search: 0, doc: 0 }`.
- `start()`: after the `claudeHub.on` subscription add `if (hq.claudeImports && hq.claudeImports.on) sub(() => hq.claudeImports.on(applyImports));` and `if (hq.claudeImports && hq.claudeImports.pending) reads.push(refreshClaudeImports());`. In the `changed` branch add: `if (Array.isArray(e.data && e.data.documents) && e.data.documents.length && lib().q && /[\p{L}\p{N}]/u.test(lib().q)) searchClaude(lib().q);` and, when `lib().doc && lib().doc.id` is in `e.data.documents`, `openClaudeDocument(lib().doc.id)`.
- return object: add `openClaudeDocument, closeClaudeDocument, refreshClaudeImports`.

- [ ] **Step 5: Run the v5 suites (goldens must NOT move).**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS, including `vals.golden.test.mjs` (149 unchanged) and `tpl.hash.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs
git commit -m "fe: H6.9 — v5 data layer: document hits (badge, text parts) and in-place document view, drop-folder offers slot, ChatGPT labels and counts-only report lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: v5 surfaces — document hits + in-place document view, drop confirm card, "Import ChatGPT export", System report, ChatGPT source chip/Continue; selftest, goldens, tpl hash, CDP

ALL template edits of this phase are in this one task, so `tpl.hash.test.mjs` is re-recorded once.

**Files:**
- Create: `dashboard-v5/src/logic/claude-imports.js` (`claudeImportsLogic`)
- Create: `dashboard-v5/src/logic/claude-imports.test.mjs`
- Create: `dashboard-v5/src/vals/claude-imports.js` (`claudeImportsVals`; every key starts with `di` or `cd`)
- Modify: `dashboard-v5/src/app.js` (imports :17-37; `Object.assign` list :388-390 — append `claudeImportsLogic`)
- Modify: `dashboard-v5/src/vals/index.js` (`SURFACES` :32-35 — append `claudeImportsVals`)
- Modify: `dashboard-v5/src/vals/claude-lib.js:15` (`clSrcChips` gains `['chatgpt', 'ChatGPT']`), `dashboard-v5/src/logic/claude-lib.js:24,67` (empty text + prefs accept `chatgpt`), `dashboard-v5/src/logic/claude-chat.js:38` and `dashboard-v5/src/vals/claude-chat.js:25` (a ChatGPT chat continues like a claude.ai chat)
- Modify: `dashboard/claude-vault.js:153` (`source: chatgpt`) + `dashboard/claude-vault.test.mjs` (one assertion)
- Modify: `dashboard-v5/src/tpl/claude.tpl.js` (import strip :39-43, hits :44-49, thread row :50-70), `dashboard-v5/src/tpl/extras.tpl.js` (new card before the What's-new block :10), `dashboard-v5/src/tpl/system.tpl.js` (Hub card :35-41)
- Modify: `dashboard-v5/src/selftest.js` (STATES), `dashboard-v5/src/vals.golden.test.mjs` (+ `src/__golden__/vals.hashes.json`), `dashboard-v5/src/tpl.hash.test.mjs` (:34-36 + dated comment), `dashboard-v5/tools/cdp-gate.mjs` (2 scenarios + header list :21-30)

**Interfaces:**
- Consumes: Task 9 `hubDocHit`, `hubDocument`, `dropCards`, `importView`, `importReportLines`, store `openClaudeDocument(id)`, `closeClaudeDocument()`, `live.claudeLib.docHits/doc`, `live.claudeImports`; preload `claudeHub.importExport(kind, opts)`, `claudeImports.dismiss(dropId)`; app helpers `canWrite()`, `writeReason()`, `denied(why)`, `call(fn, label)`, `toast(kind, text)`, `forceUpdate()`.
- Produces (template bindings): `diImportChatGPT`, `diChatGPTTip`, `diShow`, `diCard {text, sub, kind}`, `diMore` (text: `"+ N more waiting"` or `''`), `diConfirm`, `diDismiss`, `diCant`, `diCantTip`, `diHasReport`, `diReport [{key,text}]`, `diFolderText`, `diHasRefused`, `diRefused [{key,text}]`, `cdHasHits`, `cdHits [{id, badge, title, when, parts, open}]`, `cdHitsText`, `cdOpen`, `cdLoading`, `cdError`, `cdHasError`, `cdDoc {title, badge, project, when, lines}`, `cdClose`. DOM hooks: `data-di="card|confirm|dismiss|chatgpt|report|folder"`, `data-cd="hit|doc|close"`.

- [ ] **Step 0: Golden BEFORE dump (first, before any edit in this task).** Git Bash: `GOLDEN_DUMP="$TEMP/h6-golden-before" node --test dashboard-v5/src/vals.golden.test.mjs` → PASS (149 scenarios dumped).

- [ ] **Step 1: Write the failing logic/vals tests.** Create `dashboard-v5/src/logic/claude-imports.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeImportsLogic } from './claude-imports.js';
import { claudeImportsVals } from '../vals/claude-imports.js';

function comp({ found = [], hub = { state: 'ready', role: 'writer' }, answer = { started: true, file: 'cg.zip', kind: 'chatgpt' }, canWrite = true } = {}) {
  const calls = [], toasts = [];
  const live = { claudeImports: { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found, refused: [], error: null }, claudeHub: hub, claudeImport: null, claudeLib: { docHits: null, doc: null } };
  const c = {
    LIVE: live, hq: { claudeHub: { importExport: async (...a) => { calls.push(['importExport', ...a]); return answer; } }, claudeImports: { dismiss: async (id) => { calls.push(['dismiss', id]); return true; } } },
    store: { openClaudeDocument: async (id) => calls.push(['open', id]), closeClaudeDocument: () => calls.push(['close']) },
    canWrite: () => canWrite, writeReason: () => 'Read-only right now', denied: (w) => toasts.push(['denied', w]),
    call: async (fn) => { const r = await fn(); return r && r.error ? (toasts.push(['error', r.error]), null) : r; },
    toast: (k, t) => toasts.push([k, t]), forceUpdate: () => {}, clOpenChat: () => {},
    ...claudeImportsLogic,
  };
  return { c, calls, toasts, live };
}
const card = { dropId: 'd1', file: 'chatgpt-export.zip', bytes: 1024, kind: 'chatgpt' };

test('confirm imports the first offered file by dropId with kind auto; nothing else is sent', async () => {
  const { c, calls, live } = comp({ found: [card] });
  await c.diConfirm();
  assert.deepEqual(calls, [['importExport', 'auto', { dropId: 'd1' }]]);
  assert.equal(live.claudeImport.phase, 'unzip'); assert.equal(live.claudeImport.source, 'chatgpt');
  assert.deepEqual(live.claudeImports.found, [], 'the card goes away at once');
});

test('Not now dismisses for good; a read-only window cannot confirm and says why', async () => {
  let r = comp({ found: [card] });
  await r.c.diDismiss();
  assert.deepEqual(r.calls, [['dismiss', 'd1']]); assert.deepEqual(r.live.claudeImports.found, []);
  r = comp({ found: [card], hub: { state: 'ready', role: 'reader' } });
  await r.c.diConfirm();
  assert.equal(r.calls.length, 0); assert.match(r.toasts[0][1], /Another WorkspaceHQ window owns the Claude index/);
});

test('Import ChatGPT export uses the dialog with kind chatgpt', async () => {
  const { c, calls } = comp();
  await c.diImportChatGPT();
  assert.deepEqual(calls, [['importExport', 'chatgpt']]);
});

test('vals: the card text, the folder line, document hits and the open document', () => {
  const { c, live } = comp({ found: [card, { ...card, dropId: 'd2' }] });
  live.claudeLib.docHits = [{ id: 'memory:1', source: 'memory', title: 'Tea', snippet: '\u0002tea\u0003', mtime_ms: 1 }];
  live.claudeLib.doc = { id: 'memory:1', source: 'memory', title: 'Tea', text: 'a\nb', mtime_ms: 1 };
  const v = claudeImportsVals.call(c, { LIVE: live, cantWrite: false, writeReason: '' });
  assert.equal(v.diShow, true);
  assert.match(v.diCard.text, /^Import ChatGPT export \(chatgpt-export\.zip, /);
  assert.equal(v.diMore, '+ 1 more waiting');
  assert.match(v.diFolderText, /WorkspaceHQ Imports/);
  assert.equal(v.cdHasHits, true); assert.equal(v.cdHits[0].badge, 'memory');
  assert.equal(v.cdOpen, true); assert.deepEqual(v.cdDoc.lines.map((l) => l.text), ['a', 'b']);
  assert.ok(Object.keys(v).every((k) => /^(di|cd)[A-Z]/.test(k)), 'surface keys are disjoint from every other surface');
  live.claudeImports.folder = { exists: false, name: 'WorkspaceHQ Imports' };
  assert.match(claudeImportsVals.call(c, { LIVE: live, cantWrite: false, writeReason: '' }).diFolderText, /not created yet/);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `node --test dashboard-v5/src/logic/claude-imports.test.mjs`
Expected: FAIL — `Cannot find module './claude-imports.js'`.

- [ ] **Step 3: Implement logic + vals.** Create `dashboard-v5/src/logic/claude-imports.js`:

```js
// AI archive H6 — drop-folder confirm card, "Import ChatGPT export", documents opened in place (spec 2026-10-15 §6.3).
import { importView } from '../live/adapter.mjs';

const gate = (c) => importView(c.LIVE.claudeImport, c.LIVE.claudeHub, { hasBridge: !!(c.hq && c.hq.claudeHub && c.hq.claudeHub.importExport), canWrite: c.canWrite(), writeReason: c.writeReason() });
const started = (c, r) => {
  c.LIVE.claudeImport = { kind: 'import', source: r.kind === 'chatgpt' ? 'chatgpt' : 'claude', phase: 'unzip', done: 0, total: 0 };
  c.toast('info', 'Importing ' + (r.file || 'the export') + ' — the counter shows progress; chats are listed when the import finishes.');
};

export const claudeImportsLogic = {
  async diImportChatGPT() {
    const v = gate(this);
    if (!v.canImport) { this.denied(v.why); return; }
    const r = await this.call(() => this.hq.claudeHub.importExport('chatgpt'), 'Import failed');
    if (r && r.started) { started(this, r); this.forceUpdate(); }
  },
  async diConfirm() {
    const imp = this.LIVE.claudeImports, first = imp && imp.found && imp.found[0];
    if (!first) return;
    const v = gate(this);
    if (!v.canImport) { this.denied(v.why); return; }
    imp.found = imp.found.filter((f) => f.dropId !== first.dropId);   // answered: the watcher's `gone` follows
    const r = await this.call(() => this.hq.claudeHub.importExport('auto', { dropId: first.dropId }), 'Import failed');
    if (r && r.started) started(this, r);
    this.forceUpdate();
  },
  async diDismiss() {
    const imp = this.LIVE.claudeImports, first = imp && imp.found && imp.found[0];
    if (!first || !this.hq || !this.hq.claudeImports) return;
    imp.found = imp.found.filter((f) => f.dropId !== first.dropId);
    await this.call(() => this.hq.claudeImports.dismiss(first.dropId), 'Could not dismiss');
    this.toast('info', 'Not imported — ' + first.file + ' will not be offered again. Import it any time with the buttons on Claude › Chats.');
    this.forceUpdate();
  },
  cdOpenDoc(id) { if (this.store && this.store.openClaudeDocument) this.store.openClaudeDocument(id); },
  cdCloseDoc() { if (this.store && this.store.closeClaudeDocument) this.store.closeClaudeDocument(); },
};
```

Create `dashboard-v5/src/vals/claude-imports.js`:

```js
// AI archive H6 — drop card, ChatGPT import button, System report, document hits + view. Every key starts with di or cd.
import { dropCards, hubDocHit, hubDocument, importReportLines, importView } from '../live/adapter.mjs';

export function claudeImportsVals(ctx) {
  const { LIVE, cantWrite, writeReason } = ctx;
  const imp = LIVE.claudeImports || { folder: null, found: [], refused: [] };
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
  const v = importView(LIVE.claudeImport, LIVE.claudeHub, { hasBridge, canWrite: !cantWrite, writeReason });
  const cards = dropCards(imp), lib = LIVE.claudeLib || {};
  const last = LIVE.claudeHub && LIVE.claudeHub.lastImport;
  const report = last && last.ok ? importReportLines(last.report) : [];
  const folder = imp.folder;
  const doc = lib.doc || null, d = doc && !doc.loading && !doc.error ? hubDocument(doc) : null;
  const hits = Array.isArray(lib.docHits) ? lib.docHits.map((h) => hubDocHit(h)) : [];
  return {
    diImportChatGPT: () => this.diImportChatGPT(), diChatGPTTip: v.why || 'Pick your ChatGPT data export (.zip) — it is read on this PC only; nothing is uploaded',
    diShow: cards.length > 0, diCard: cards[0] || { text: '', sub: '', kind: '' }, diMore: cards.length > 1 ? '+ ' + (cards.length - 1) + ' more waiting' : '',
    diConfirm: () => this.diConfirm(), diDismiss: () => this.diDismiss(), diCant: !v.canImport, diCantTip: v.why || 'Import this export now',
    diHasReport: report.length > 0, diReport: report.map((text, i) => ({ key: 'r' + i, text })),
    diFolderText: !folder ? '' : folder.exists ? 'Drop folder: Documents\\' + folder.name + ' — new exports dropped there are offered once'
      : 'Drop folder: not created yet — create Documents\\' + folder.name + ' to drop exports there (WorkspaceHQ never creates it)',
    diHasRefused: (imp.refused || []).length > 0, diRefused: (imp.refused || []).map((r, i) => ({ key: 'x' + i, text: r.file + ': ' + r.error })),
    cdHasHits: hits.length > 0, cdHits: hits.map((h) => ({ ...h, open: () => this.cdOpenDoc(h.id) })),
    cdHitsText: hits.length === 1 ? '1 note or document matches' : hits.length + ' notes and documents match',
    cdOpen: !!doc, cdLoading: !!(doc && doc.loading), cdHasError: !!(doc && doc.error), cdError: doc && doc.error ? String(doc.error) : '',
    cdDoc: d || { title: '', badge: '', project: '', when: '', lines: [] }, cdClose: () => this.cdCloseDoc(),
  };
}
```

Wire: `app.js` — `import { claudeImportsLogic } from './logic/claude-imports.js';` and append `claudeImportsLogic` to the `Object.assign` list; `vals/index.js` — import and append `claudeImportsVals` to `SURFACES`.

ChatGPT source bits: `vals/claude-lib.js:15` chips become `[['all', 'All'], ['code', 'Code'], ['web', 'claude.ai'], ['chatgpt', 'ChatGPT']]`; `logic/claude-lib.js:67` accepts `'chatgpt'` in the `clSrc` list; `logic/claude-lib.js:24` gains `else if (!rows.length && S.clSrc === 'chatgpt' && !S.clProj && S.clSince === 'all') emptyText = 'No ChatGPT chats yet — import your ChatGPT data export (button above) or drop it in Documents\\WorkspaceHQ Imports.';`; `logic/claude-chat.js:38` becomes `const isWeb = !!(conv && (conv.source === 'web' || conv.source === 'chatgpt'));   // H4/H6: a claude.ai or ChatGPT chat continues as a NEW Claude Code chat`; `vals/claude-chat.js:25` uses the same `(source === 'web' || source === 'chatgpt')` test. `dashboard/claude-vault.js:153` becomes `'source: ' + (c.source === 'web' ? 'claude.ai' : c.source === 'chatgpt' ? 'chatgpt' : 'claude-code'),` and `dashboard/claude-vault.test.mjs` gains one assertion that a `source:'chatgpt'` conversation's `noteText` contains `source: chatgpt` (copy the nearest existing `noteText` test's arguments). Also read `seedPrompt` in `dashboard/claude-chat.js:55`: if its wording names "claude.ai", make it say "ChatGPT" for a `chatgpt:` conversation (one-line ternary on the conversation source) and add the matching assertion to `dashboard/claude-chat.test.mjs`; if it does not name the source, change nothing there.

- [ ] **Step 4: Templates.** Every new element carries a `<!-- v5: … -->` comment; Claude Design language: `var(--card)` panels, `var(--frame)` borders, `var(--purple)` accent, `var(--term)` font, 8 px radius buttons, the same 28 px button style as `data-ci="go"`.

(a) `tpl/claude.tpl.js`, import strip line 41 — right after the `Import claude.ai export</button>`:
```html
<!-- v5: AI archive H6 (spec 2026-10-15 §6.3/§7) — ChatGPT export through the same dialog path; kind chatgpt --><button type="button" data-di="chatgpt" onClick="{{ diImportChatGPT }}" disabled="{{ ciCant }}" title="{{ diChatGPTTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)">Import ChatGPT export</button>
```
(b) inside `<section data-cl="hits">`, after the `clHits` `sc-for`:
```html
<!-- v5: AI archive H6 (spec §6.3 Search) — memory notes, CLAUDE.md files and prompt notes that match, with a source badge; text parts, never HTML -->
<sc-if value="{{ cdHasHits }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted);margin:12px 0 6px">{{ cdHitsText }}</div><sc-for list="{{ cdHits }}" as="h" hint-placeholder-count="2"><button type="button" data-cd="hit" onClick="{{ h.open }}" style="display:block;width:100%;text-align:left;padding:8px 0;border:0;border-bottom:1px dashed var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)"><div style="font-size:13px"><span data-cd="badge" style="font-size:10px;padding:1px 6px;border:1px solid var(--purple);border-radius:6px;color:var(--purple);margin-right:6px">{{ h.badge }}</span>{{ h.title }} <span style="font-size:11px;color:var(--faint)">{{ h.when }}</span></div><div style="font-size:12px;color:var(--muted);margin-top:2px"><sc-for list="{{ h.parts }}" as="p" hint-placeholder-count="3"><sc-if value="{{ p.hit }}" hint-placeholder-val="{{ false }}"><mark style="background:transparent;color:var(--gold);font-weight:600">{{ p.text }}</mark></sc-if><sc-if value="{{ !p.hit }}" hint-placeholder-val="{{ true }}"><span>{{ p.text }}</span></sc-if></sc-for></div></button></sc-for></sc-if>
```
(c) after the `clHasThread` `sc-if` block (same flex row):
```html
<!-- v5: AI archive H6 (spec §6.3 "open in place") — one document, masked text as plain lines; read-only -->
<sc-if value="{{ cdOpen }}" hint-placeholder-val="{{ false }}"><section data-cd="doc" aria-label="Document" style="flex:2 1 420px;min-width:0;background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px"><div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:10px;padding:1px 6px;border:1px solid var(--purple);border-radius:6px;color:var(--purple)">{{ cdDoc.badge }}</span><span style="font-size:15px;flex:1">{{ cdDoc.title }}</span><button type="button" data-cd="close" onClick="{{ cdClose }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)">Close</button></div><div style="font-size:11px;color:var(--faint);margin-top:4px">{{ cdDoc.project }} · {{ cdDoc.when }} · secrets are masked</div><sc-if value="{{ cdLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);margin-top:10px">Loading…</div></sc-if><sc-if value="{{ cdHasError }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--orange);margin-top:10px">{{ cdError }}</div></sc-if><div style="display:flex;flex-direction:column;margin-top:10px;max-height:60vh;overflow:auto;font-size:13px;white-space:pre-wrap"><sc-for list="{{ cdDoc.lines }}" as="l" hint-placeholder-count="6"><span>{{ l.text }}</span></sc-for></div></section></sc-if>
```
(d) `tpl/extras.tpl.js`, before the What's-new block — a non-modal card (no scrim; it never blocks the app), z-index 1050 (under the Save-to-vault dialog's 1100):
```html
  <!-- v5: AI archive H6 (spec §2/§6.3) — a ZIP dropped in Documents\WorkspaceHQ Imports is offered ONCE; nothing runs until Import -->
  <sc-if value="{{ diShow }}" hint-placeholder-val="{{ false }}"><div data-di="card" role="dialog" aria-label="Import a dropped export" style="position:fixed;right:16px;bottom:16px;z-index:1050;max-width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:var(--term)"><div style="font-size:14px;color:var(--text)">{{ diCard.text }}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">{{ diCard.sub }}</div><div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><button type="button" data-di="confirm" onClick="{{ diConfirm }}" disabled="{{ diCant }}" title="{{ diCantTip }}" style="height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:var(--purple);color:var(--bg);cursor:pointer;font-family:var(--term)">Import</button><button type="button" data-di="dismiss" onClick="{{ diDismiss }}" style="height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)">Not now</button><span style="font-size:11px;color:var(--faint)">{{ diMore }}</span></div></div></sc-if>
```
(e) `tpl/system.tpl.js`, inside the Hub card after the `hubDetail` line:
```html
<!-- v5: AI archive H6 (spec §6.3 Imports) — drop folder status, refused ZIPs with the reason, and the last import's counts-only report -->
<div data-di="folder" style="font-size:12px;color:var(--faint);margin-top:6px">{{ diFolderText }}</div><sc-if value="{{ diHasRefused }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange);margin-top:4px;display:flex;flex-direction:column;gap:2px"><sc-for list="{{ diRefused }}" as="r" hint-placeholder-count="1"><span>{{ r.text }}</span></sc-for></div></sc-if><sc-if value="{{ diHasReport }}" hint-placeholder-val="{{ false }}"><div data-di="report" style="font-size:11px;color:var(--faint);margin-top:6px;display:flex;flex-direction:column;gap:2px"><sc-for list="{{ diReport }}" as="l" hint-placeholder-count="3"><span>{{ l.text }}</span></sc-for></div></sc-if>
```
If `--bg` is not a defined token, use the token the existing primary buttons use for text on purple (grep `background:var(--purple)` in `tpl/`).

- [ ] **Step 5: Selftest combos.** In `src/selftest.js` STATES add (using the existing `at(...)`, `clLib(o)` helpers and `LV`):
```js
['h6-doc-hits', at('claude', 'chats'), {}, clLib({ q: 'tea', hits: [], docHits: [{ id: 'memory:1', source: 'memory', title: 'Tea rule', snippet: 'offer \u0002tea\u0003', mtime_ms: 1759320000000 }, { id: 'claude-md:2', source: 'claude-md', title: 'CLAUDE.md — p', snippet: '\u0002tea\u0003', mtime_ms: 1759320000000 }] })],
['h6-doc-open', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', source: 'memory', title: 'Tea rule', text: 'line one\nline two', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000 } })],
['h6-doc-loading', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', loading: true } })],
['h6-doc-error', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', error: 'That document is no longer in the index (its file was removed or it was forgotten).' } })],
['h6-drop-card', at('claude', 'chats'), {}, () => { LV.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 39845888, kind: 'chatgpt' }, { dropId: 'd2', file: 'claude.zip', bytes: 1000, kind: 'claude' }], refused: [], error: null }; }],
['h6-drop-card-reader', at('home'), {}, () => { LV.claudeHub = { ...(LV.claudeHub || {}), state: 'ready', role: 'reader' }; LV.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 1, kind: 'chatgpt' }], refused: [], error: null }; }],
['h6-system-report', at('system', 'machine'), {}, () => { LV.claudeHub = { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 4, messages: 10, documents: 5 }, lastImport: { at: '2026-10-25T10:00:00Z', ok: true, source: 'chatgpt', report: { source: 'chatgpt', conversations: { imported: 4, unchanged: 0, forgotten: 0, skipped: 3 }, messages: { imported: 10, skipped: 0, empty: 1 }, branches: { skipped: 2 }, files: { other: ['chat.html'] }, memory: { found: false, imported: 0 } } } }; LV.claudeImports = { folder: { exists: false, name: 'WorkspaceHQ Imports' }, found: [], refused: [{ file: 'photos.zip', error: 'Not a ChatGPT or claude.ai export (looked for conversations.json)' }], error: null }; }],
['h6-chatgpt-filter', at('claude', 'chats'), { clSrc: 'chatgpt' }, clLib({ convs: [] })],
```
`clLib(o)` (selftest.js:162) RETURNS the live thunk (`const clLib = (o) => () => { LV.claudeHub = CL_READY; LV.claudeLib = {…, ...o}; }`), so it is passed as the 4th tuple element itself — wrapping it as `() => { clLib(o); }` would build the thunk and never run it, and the combo would render the default library. The rows that set `LV.claudeImports`/`LV.claudeHub` directly are hand-written thunks. Read selftest.js:133-200 for the exact STATES tuple; the live mutations are restored by `savedLive`.

- [ ] **Step 6: Goldens — attribute, then re-record.** Add scenarios to `src/vals.golden.test.mjs` next to the `claude.import-*` ones (same helpers `add`, `tabSub`, `CI_HQ`):
```js
const H6_DOCS = [{ id: 'memory:1', source: 'memory', title: 'Tea rule', snippet: 'offer \u0002tea\u0003', mtime_ms: 1759320000000 }];
add('claude.h6-doc-hits', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, q: 'tea', hits: [], docHits: H6_DOCS }; }, state: tabSub('claude', 'chats') });
add('claude.h6-doc-open', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, doc: { id: 'memory:1', source: 'memory', title: 'Tea rule', text: 'a\nb', mtime_ms: 1759320000000 } }; }, state: tabSub('claude', 'chats') });
add('claude.h6-drop-card', { hq: CI_HQ, live: (L) => { L.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 39845888, kind: 'chatgpt' }], refused: [], error: null }; }, state: tabSub('claude', 'chats') });
add('system.h6-chatgpt-report', { hq: CI_HQ, live: (L) => { L.claudeHub = { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 4, messages: 10, documents: 5 }, lastImport: { at: '2026-10-25T10:00:00Z', ok: true, source: 'chatgpt', report: { source: 'chatgpt', conversations: { imported: 4 }, messages: { imported: 10 }, branches: { skipped: 2 }, files: { other: [] }, memory: { found: false, imported: 0 } } } }; }, state: tabSub('system', 'machine') });
add('claude.h6-chatgpt-filter', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, convs: [] }; }, state: (c) => ({ ...tabSub('claude', 'chats')(c), clSrc: 'chatgpt' }) });
```
(Match `state`'s real form in the file: if `tabSub` returns a patch object rather than a function, merge accordingly.)

Attribution (dump folders OUTSIDE the repo; no stash, no worktree, no checkout), in Git Bash: (1) the BEFORE dump is taken in Step 0, before any vals/tpl edit; (2) after the edits, `GOLDEN_DUMP="$TEMP/h6-golden-after" node --test dashboard-v5/src/vals.golden.test.mjs` (fails on hashes — expected); (3) `node dashboard-v5/tools/golden-diff.mjs "$TEMP/h6-golden-before" "$TEMP/h6-golden-after" --allow '^(di|cd)[A-Z]' --allow '^clSrcChips'` must exit 0 (the only changed paths are the new `di*`/`cd*` keys present in every scenario and the fourth source chip; the new scenarios are listed as added); (4) `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`; (5) `rm -rf "$TEMP/h6-golden-before" "$TEMP/h6-golden-after"`. Any other changed path is a regression to fix, never to allow.

- [ ] **Step 7: Re-record the template hash.** Run `node --test dashboard-v5/src/tpl.hash.test.mjs` — it prints the new SHA256 / LENGTH / UTF8_BYTES. Update the three constants at :34-36 and add the dated header comment line: `// 2026-10-25 H6 archive sources: + ChatGPT import button, document hits + view, drop confirm card, System imports report (+<added UTF-16 units> units)`.

- [ ] **Step 8: CDP scenarios.** Add to `SCENARIOS` in `dashboard-v5/tools/cdp-gate.mjs` (and their names to the header list):
```js
  async 'imports-drop-confirm'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    const found = (id, file, kind) => `hqFake.emit('hq:claude-imports:event', { event: 'found', data: { dropId: '${id}', file: '${file}', bytes: 39845888, kind: '${kind}' } })`;
    try {
      await t.evaluate(`WHQ.app.logic.go('home')`);
      await t.evaluate(found('d1', 'chatgpt-export.zip', 'chatgpt'));
      if (!(await t.waitFor(`!!document.querySelector('[data-di="card"]')`, 3000))) return ['the drop card never rendered'];
      const text = await t.evaluate(`document.querySelector('[data-di="card"]').textContent`);
      if (!/Import ChatGPT export \(chatgpt-export\.zip, /.test(text)) fails.push('card text: ' + text);
      if (/chats\)/.test(text)) fails.push('the card guessed a chat count');
      await t.evaluate(`document.querySelector('[data-di="confirm"]').click()`);
      if (!(await t.waitFor(`hqFake.calls('claudeHub.importExport').length === 1`, 3000))) fails.push('importExport was not called');
      const c = await t.evaluate(`JSON.stringify(hqFake.calls('claudeHub.importExport'))`);
      if (!c.includes('"auto"') || !c.includes('"dropId":"d1"')) fails.push('wrong importExport args: ' + c);
      if (!(await t.waitFor(`!document.querySelector('[data-di="card"]')`, 3000))) fails.push('the card stayed after Import');
      await t.evaluate(found('d2', 'claude.zip', 'claude'));
      if (!(await t.waitFor(`!!document.querySelector('[data-di="dismiss"]')`, 3000))) fails.push('second card missing');
      await t.evaluate(`document.querySelector('[data-di="dismiss"]').click()`);
      if (!(await t.waitFor(`hqFake.calls('claudeImports.dismiss').length === 1`, 3000))) fails.push('dismiss was not called');
      if (!(await t.waitFor(`!document.querySelector('[data-di="card"]')`, 3000))) fails.push('the card stayed after Not now');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; if (L.store && L.store.live) { L.store.live.claudeImport = null; L.store.live.claudeImports = { folder: null, found: [], refused: [], error: null }; } L.setState({}); })()`);
    }
    return fails.concat(t.errors());
  },

  async 'search-documents'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      await t.evaluate(`WHQ.app.logic.store.searchClaude('tea')`);
      if (!(await t.waitFor(`!!document.querySelector('[data-cd="hit"]')`, 4000))) return ['no document hits rendered'];
      const badges = await t.evaluate(`[...document.querySelectorAll('[data-cd="badge"]')].map((b) => b.textContent)`);
      if (badges.join('|') !== 'memory|CLAUDE.md') fails.push('badges: ' + badges.join('|'));
      if (await t.evaluate(`/[\u0002\u0003]/.test(document.querySelector('[data-cd="hit"]').textContent)`)) fails.push('snippet markers leaked into the text');
      await t.evaluate(`document.querySelector('[data-cd="hit"]').click()`);
      if (!(await t.waitFor(`!!document.querySelector('[data-cd="doc"]') && document.querySelector('[data-cd="doc"]').textContent.includes('Offer fake tea first.')`, 3000))) fails.push('the document did not open in place');
      if ((await t.evaluate(`hqFake.calls('claudeHub.document').length`)) !== 1) fails.push('document() not called once');
      await t.evaluate(`document.querySelector('[data-cd="close"]').click()`);
      if (!(await t.waitFor(`!document.querySelector('[data-cd="doc"]')`, 3000))) fails.push('Close did not close');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.store.searchClaude(''); L.store.closeClaudeDocument(); L.setState({}); })()`);
    }
    return fails.concat(t.errors());
  },
```

- [ ] **Step 9: Run every v5 suite, the selftest and the CDP gate (fake harness, own profile/port).**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs` and `node --test dashboard/*.test.mjs`
Expected: PASS.

Selftest (PowerShell, from `dashboard-v5`): `$env:HQ_V5_PROFILE="h6-selftest-$PID"; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --selftest; $LASTEXITCODE`
Expected: exit `0`, verdict `0 errors / 0 unresolved / 0 failures`.

CDP (PowerShell, from `dashboard-v5`): `$p = Start-Process -PassThru ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9366'; node tools/cdp-gate.mjs --port 9366 --scenario all; $code=$LASTEXITCODE; Stop-Process -Id $p.Id; $code`
Expected: every scenario `PASS`, exit `0`. Stop only `$p.Id`.

- [ ] **Step 10: Commit** (two commits: renderer, then the main-side vault one-liner)

```bash
git add dashboard-v5/src/logic/claude-imports.js dashboard-v5/src/logic/claude-imports.test.mjs dashboard-v5/src/vals/claude-imports.js dashboard-v5/src/app.js dashboard-v5/src/vals/index.js dashboard-v5/src/vals/claude-lib.js dashboard-v5/src/logic/claude-lib.js dashboard-v5/src/logic/claude-chat.js dashboard-v5/src/vals/claude-chat.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/extras.tpl.js dashboard-v5/src/tpl/system.tpl.js dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: H6.10 — v5: document hits with source badge + in-place view, drop-folder confirm card (asked once), Import ChatGPT export, System imports report, ChatGPT chip/Continue; selftest, goldens (attributed), tpl hash, CDP imports-drop-confirm + search-documents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add dashboard/claude-vault.js dashboard/claude-vault.test.mjs
git commit -m "fe: H6.10b — Save to vault writes source: chatgpt for an imported ChatGPT chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(If `seedPrompt` was changed in Step 3, add `dashboard/claude-chat.js dashboard/claude-chat.test.mjs` to the second commit.)

### Task 11: H6 gate on a real second instance (fixtures only), docs, HANDOFF — the owner's app is NOT restarted

**Files:**
- Create (temp, outside the repo, deleted at the end): `$g\gate-h6.mjs`
- Modify: `README.md` (Claude Hub section + the test-command block :88-91), `CLAUDE.md` ("Facts that save you time": one Claude Hub bullet), `docs/sync/IPC-CONTRACT.md` / `docs/sync/CONTRACT.md` (only if anything landed differently from Task 1's rows — say what in the commit), `docs/sync/HANDOFF.md` (new top entry)

**Interfaces:**
- Consumes: everything above, through the real preload (`window.hq`) of a second Electron instance.
- Produces: a PASS/FAIL JSON report pasted (counts only) into the HANDOFF entry.

- [ ] **Step 1: All suites green on the final tree.**

Run: `node --test dashboard/claude-hub/*.test.mjs` ; `node --test dashboard/*.test.mjs` ; `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs` ; the selftest and the CDP gate exactly as in Task 10 Step 9 (own `HQ_V5_PROFILE`, own port, stop only your PID).
Expected: everything PASSES; selftest exit 0 with 0/0/0; every CDP scenario `PASS` (incl. `imports-drop-confirm`, `search-documents`).

- [ ] **Step 2: A real second instance on fixtures (PowerShell, repo root).** Every `HQ_*` override is set; own profile and port; nothing points at the owner's index, vault, imports folder or `~/.claude`.

```powershell
$g = Join-Path $env:TEMP ('hq-h6-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory -Path $g | Out-Null
node --input-type=module -e "import { makeClaudeHome } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs'; import { makeDocsHome, historyLine } from './dashboard/claude-hub/__fixtures__/make-docs.mjs'; import { writeChatGPTZip } from './dashboard/claude-hub/__fixtures__/make-chatgpt-export.mjs'; import { zipFiles } from './dashboard/claude-hub/__fixtures__/make-export.mjs'; import fs from 'node:fs'; import path from 'node:path'; const d = process.argv[1]; makeClaudeHome(d); const fx = makeDocsHome(d, { secret: 'sk-' + 'ant-' + 'A'.repeat(30) }); fs.writeFileSync(path.join(fx.home, 'history.jsonl'), historyLine({ display: 'placeholder typed prompt' })); writeChatGPTZip(path.join(d, 'chatgpt-export.zip')); zipFiles(path.join(d, 'photos.zip'), [{ name: 'a.txt', data: 'placeholder' }]); console.log(fx.home)" $g
$ownerPrompts = Join-Path $env:USERPROFILE 'Documents\VEEMO CORTEX\40_Resources'
$ownerImports = Join-Path $env:USERPROFILE 'Documents\WorkspaceHQ Imports'
$snap = { param($p) if (Test-Path -LiteralPath $p) { Get-ChildItem -LiteralPath $p -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2 } else { 'absent' } }
$promptsBefore = & $snap $ownerPrompts; $importsBefore = & $snap $ownerImports
$dataBefore = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'db\hub.sqlite'; New-Item -ItemType Directory -Path (Join-Path $g 'db') | Out-Null
$env:HQ_VAULT_DIR   = Join-Path $g 'vault'
$env:HQ_IMPORTS_DIR = Join-Path $g 'WorkspaceHQ Imports'; New-Item -ItemType Directory -Path $env:HQ_IMPORTS_DIR | Out-Null
$env:HQ_STUDIO_ROOT = Join-Path $g 'studio'; New-Item -ItemType Directory -Path $env:HQ_STUDIO_ROOT | Out-Null
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9497'
$p.Id   # the ONLY electron pid this task may stop
```

If the printed home is not `$g\.claude`, set `$env:HQ_CLAUDE_HOME` to it **before** `Start-Process`.

Write `$g\gate-h6.mjs` (same CDP driver as the H5 gate: `connect()`, `ev(expr)`, `until(expr, ms)` — copy those three functions verbatim from `docs/superpowers/plans/2026-10-15-claude-hub-h5.md` Task 8 Step 2), then these checks:

```js
// gate-h6.mjs <port> <gateDir> — AI archive H6 real-instance gate (fixtures only). Never run against the owner's app.
import fs from 'node:fs';
import path from 'node:path';
const [port, g] = [Number(process.argv[2]), process.argv[3]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* connect(), ev(), until() — verbatim from the H5 gate */
const fails = [], report = {};
await connect();
if (!await until(`!!(window.WHQ && WHQ.app && WHQ.app.logic && window.hq)`, 30000)) { console.log(JSON.stringify({ fails: ['the app never mounted'] })); process.exit(1); }
// 1. schema 2 + documents indexed from HQ_CLAUDE_HOME and HQ_VAULT_DIR
if (!await until(`hq.claudeHub.health().then((h) => h.state === 'ready' && h.counts.conversations >= 3 && h.counts.documents >= 5)`, 45000)) fails.push('documents never indexed: ' + JSON.stringify(await ev(`hq.claudeHub.health()`)));
const prompts = await ev(`hq.claudeHub.documents({ source: 'prompt' })`);
report.prompts = (prompts || []).length;
if (!Array.isArray(prompts) || prompts.length !== 1 || prompts[0].title !== 'Review a PR like a staff engineer') fails.push('prompt notes: ' + JSON.stringify(prompts));
const tea = await ev(`hq.claudeHub.documents({ q: 'tea' })`);
if (!Array.isArray(tea) || !tea.some((d) => d.source === 'memory')) fails.push('memory note not searchable');
// 'tea' also matches MEMORY.md ("[Tea](feedback_tea.md)", no secret) and bm25 decides the order: pick the tea note by title
const teaRow = Array.isArray(tea) ? tea.find((d) => d.title === 'Placeholder tea rule') : null;
if (!teaRow) fails.push('the tea memory note is not among the hits: ' + JSON.stringify((tea || []).map((d) => d.title)));
const teaDoc = teaRow ? await ev(`hq.claudeHub.document(${JSON.stringify(teaRow.id)})`) : null;
if (!teaDoc || /sk-ant-A{10}/.test(teaDoc.text) || !/anthropic-key/.test(teaDoc.text)) fails.push('the memory note is not masked');
if ((await ev(`hq.claudeHub.documents({ q: 'typed' })`)).length !== 0) fails.push('history lines leaked into default search');
// 2. documents in v5 search, opened in place
await ev(`(() => { WHQ.app.logic.go('claude', 'chats'); return WHQ.app.logic.store.searchClaude('tea').then(() => true); })()`);
if (!await until(`!!document.querySelector('[data-cd="hit"]')`)) fails.push('no document hit in Claude › Chats search');
else {
  // click the tea note's hit, not whichever ranks first (MEMORY.md also matches 'tea' and holds no secret)
  await ev(`(() => { const b = [...document.querySelectorAll('[data-cd="hit"]')].find((x) => x.textContent.includes('Placeholder tea rule')); if (b) b.click(); return !!b; })()`);
  if (!await until(`!!document.querySelector('[data-cd="doc"]') && document.querySelector('[data-cd="doc"]').textContent.includes('secret (anthropic-key)')`)) fails.push('the document did not open in place, masked');
}
// 3. drop folder: a ChatGPT export is offered once, imported on confirm; an unknown ZIP is refused with the reason
fs.copyFileSync(path.join(g, 'chatgpt-export.zip'), path.join(g, 'WorkspaceHQ Imports', 'chatgpt-export.zip'));
fs.copyFileSync(path.join(g, 'photos.zip'), path.join(g, 'WorkspaceHQ Imports', 'photos.zip'));
if (!await until(`!!document.querySelector('[data-di="card"]')`, 30000)) fails.push('no drop card for the ChatGPT export');
else {
  const text = await ev(`document.querySelector('[data-di="card"]').textContent`);
  report.card = text;
  if (!/Import ChatGPT export \(chatgpt-export\.zip, /.test(text)) fails.push('card text: ' + text);
  await ev(`(() => { document.querySelector('[data-di="confirm"]').click(); return true; })()`);
  if (!await until(`hq.claudeHub.health().then((h) => !!h.lastImport && h.lastImport.ok && h.lastImport.source === 'chatgpt')`, 30000)) fails.push('the ChatGPT import did not finish ok');
  const cg = await ev(`hq.claudeHub.conversations({ source: 'chatgpt' })`);
  report.chatgptChats = (cg || []).length;
  if (!Array.isArray(cg) || cg.length !== 4) fails.push('ChatGPT chats listed: ' + JSON.stringify(cg && cg.length));
  if (!await until(`!document.querySelector('[data-di="card"]')`)) fails.push('the card stayed after Import');
}
if (!await until(`hq.claudeImports.pending().then((p) => p.refused.some((r) => r.file === 'photos.zip' && /looked for conversations\\.json/.test(r.error)))`, 30000)) fails.push('photos.zip was not refused with the reason');
// 4. asked once: a fresh renderer (reload) is not offered the imported file again
await ev(`(() => { location.reload(); return true; })()`).catch(() => {});
await sleep(3000); await connect();
await until(`!!(window.WHQ && WHQ.app && WHQ.app.logic && window.hq)`, 30000);
await sleep(2000);
if (await ev(`!!document.querySelector('[data-di="card"]')`)) fails.push('the imported file was offered again after a reload');
// 5. System shows the counts-only report and the folder line
await ev(`(() => { WHQ.app.logic.go('system', 'machine'); return true; })()`);
if (!await until(`!!document.querySelector('[data-di="report"]') && /Chats: 4 imported/.test(document.querySelector('[data-di="report"]').textContent)`)) fails.push('System has no ChatGPT import report');
if (!await until(`!!document.querySelector('[data-di="folder"]') && /WorkspaceHQ Imports/.test(document.querySelector('[data-di="folder"]').textContent)`)) fails.push('System has no drop-folder line');
// 6. the seen file is next to the GATE db, and the drop folder was not written
if (!fs.existsSync(path.join(g, 'db', 'imports-seen.json'))) fails.push('imports-seen.json is not next to HQ_CLAUDE_DB');
const dropNow = fs.readdirSync(path.join(g, 'WorkspaceHQ Imports')).sort();
if (dropNow.join('|') !== 'chatgpt-export.zip|photos.zip') fails.push('the drop folder changed: ' + dropNow.join('|'));
console.log(JSON.stringify({ fails, report }, null, 2));
process.exit(fails.length ? 1 : 0);
```

Run: `node "$g\gate-h6.mjs" 9497 $g ; $gateCode = $LASTEXITCODE`
Expected: `{"fails": [], …}` and `$gateCode` = 0. (`connect()` after the reload re-attaches to the page's new target; if the H5 driver's `connect` keeps the old socket, close it first: `try { ws.close(); } catch {}` then reset `ws = null`.)

- [ ] **Step 3: The owner's things are untouched; stop only your instance; clean up.**

```powershell
if ((& $snap $ownerPrompts) -ne $promptsBefore) { 'FAIL: the owner vault 40_Resources changed' }
if ((& $snap $ownerImports) -ne $importsBefore) { 'FAIL: the owner imports folder changed' }
$dataAfter = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
if ($dataAfter -ne $dataBefore) { 'FAIL: data\claude changed (imports-seen.json or tmp\ leaked into the owner data dir)' }
Select-String -Path (Join-Path $g 'logs\*.log') -Pattern 'lantern|tea first|typed prompt' -SimpleMatch -Quiet   # must print False: logs carry counts and reasons, never text
Stop-Process -Id $p.Id
Get-Process -Id $p.Id -ErrorAction SilentlyContinue   # nothing
Remove-Item -LiteralPath $g -Recurse -Force
Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_VAULT_DIR, Env:HQ_IMPORTS_DIR, Env:HQ_STUDIO_ROOT, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION
```
Expected: no `FAIL:` line; `False` from Select-String; the owner's `electron.exe . --hidden` (no `--user-data-dir`) and its Hub child are still running (check `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine` — do NOT stop or restart it). Never run `tools\rollback.ps1` in this phase.

- [ ] **Step 4: Docs.**

`README.md` — in the Claude Hub section add (one short paragraph): "The Hub also indexes ChatGPT data exports (Claude › Chats › Import ChatGPT export, or drop the ZIP in `Documents\WorkspaceHQ Imports` and confirm the card once), your Claude memory notes, CLAUDE.md files, `~/.claude/history.jsonl` and the prompt notes in `VEEMO CORTEX/40_Resources/Prompts` — all on this PC, masked, read-only on every source. Search shows matching notes with a source badge." In the test-command block keep the four globs (they already cover `claude-imports.test.mjs`, `ingest-chatgpt.test.mjs`, `ingest-docs.test.mjs`); add after them `# H6 archive sources only: node --test dashboard/claude-hub/ingest-chatgpt.test.mjs dashboard/claude-hub/ingest-docs.test.mjs dashboard/claude-imports.test.mjs dashboard/claude-import.test.mjs`.

`CLAUDE.md` — append one bullet to "Facts that save you time": "- Archive sources (H6): hub.sqlite schema 2 (`document`/`document_fts`, `prompt_use`; migrated in place — an older app refuses it); ChatGPT chats are `source:'chatgpt'` (`chatgpt:<id>`); docs ingest reads `HQ_CLAUDE_HOME` memory/CLAUDE.md/history.jsonl and `HQ_VAULT_DIR/40_Resources/Prompts`; drop folder `Documents\WorkspaceHQ Imports` (`HQ_IMPORTS_DIR`), watcher `dashboard/claude-imports.js`, answered files in `imports-seen.json` next to the db."

`docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` — re-read the Task 1 section against the landed code (`git diff 4c8da80 -- dashboard/preload.js dashboard/claude-hub-host.js dashboard/claude-import.js dashboard/claude-imports.js`); fix any row that differs (additive wording only) and list the fixes in the commit body; if none, say "rows unchanged".

- [ ] **Step 5: HANDOFF entry.** Insert at the top of `docs/sync/HANDOFF.md` (below the format block and its `---`), replacing `<sha>` with `git log -1 --format=%h` before this commit:

```
## 2026-10-25 <HH:MM> · FROM frontend · main @ <sha>
DONE: AI archive sources H6 (plan docs/superpowers/plans/2026-10-15-archive-prompts-h6.md), commits H6.2–H6.10b + this meta commit:
  hub.sqlite schema 2 (document + document_fts, prompt_use; in-place 1→2, tested on a populated v1 db); ingest-chatgpt.mjs
  (current-branch walk, masked, counts-only report, web_sync kind chatgpt); ingest-docs.mjs (memory notes, CLAUDE.md,
  vault prompt notes, history.jsonl by byte cursor, live watchers); Hub ops importChatGPT/listDocuments/getDocument +
  forget({documentId}); drop-folder watcher claude-imports.js (asked once); v5 document hits + view, drop card, System report.
  Real second-instance gate on fixtures: PASS (<paste the report counts: prompts, chatgptChats, card text>).
IN-FLIGHT: none. The owner's app was NOT restarted: its Hub still runs schema 1 code; the first restart on this code
  migrates data/claude/hub.sqlite to schema 2 (a later rollback of the Hub code below H6 then refuses that db — "newer WorkspaceHQ").
ASKS: none (no structure-lane file touched).
BREAKS: main.js :1595 gains `vaultDir: VAULT`; +1 line after :1598 (claude-imports init). New IPC hq:claude-hub:documents|document,
  hq:claude-imports:pending|dismiss|event; hq:claude-hub:import takes (kind, {dropId}); preload hq.claudeImports. New env HQ_IMPORTS_DIR.
  CONTRACT.md: data/claude schema 2 + imports-seen.json; vault notes may carry source: chatgpt.
```

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: H6 archive sources done — real second-instance gate on fixtures (PASS), README/CLAUDE.md facts, contract rows checked, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Stage only the files that actually changed; never `git add -A`; the other lane's four uncommitted files stay unstaged.)

<!-- plan complete: 11 tasks -->
