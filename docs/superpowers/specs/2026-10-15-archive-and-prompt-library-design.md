# AI archive sources + prompt library (design)

**Date:** 2026-10-15 · **Status:** approved in conversation (owner answers 2026-10-15) · **Lane:** frontend (`dashboard/`, `dashboard-v5/`, `browser-bridge/`) + shared (`data/claude/` shape, docs) · **Builds on:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md` (the Claude Hub; H1 live, H2–H5 in flight)

## 1. Intent

The owner wants **WorkspaceHQ to hold all the AI context they made this year in one searchable place**, and a **prompt library on top of it**. Already indexed: every Claude Code session (H1). Being added by the Hub fleet: claude.ai chats + Projects (H4). This spec adds:

1. **The ChatGPT data export** as a third conversation source.
2. **Local Claude context about them**: the Claude Code memory notes (`~/.claude/projects/<proj>/memory/*.md` — 106 notes, 442 KB, across 24 projects today), the `CLAUDE.md` files of their projects (16 today) and `~/.claude/CLAUDE.md`, and `~/.claude/history.jsonl` (every prompt typed into Claude Code — 555 lines today; `{display, pastedContents, timestamp, project, sessionId}`).
3. **A prompt library** with four jobs the owner chose: harvest their best prompts from all of the above; author and organize; run with one click; import/export packs.

**Owner decisions (2026-10-15):** all four library jobs; the vault is the primary home of prompts ("both, vault is primary": vault notes are the source of truth, the Hub keeps the index and usage stats, and WorkspaceHQ writes back only new harvested prompts the owner promotes, with confirmation); the spellbook (`spellbook/`, struct lane) is not used for prompts.

**Success:** a ChatGPT export dropped in `Documents\WorkspaceHQ Imports\` appears in the library and in search within a minute; memory notes and CLAUDE.md files are searchable; the Candidates view shows the owner's own best prompts with their origin; promoting one creates a vault note; running one starts an in-app chat (or opens a terminal / copies for claude.ai) and is counted.

### Non-goals

- Writing to ChatGPT, claude.ai, `~/.claude`, or the owner's existing vault notes. The only vault writes are **new** prompt notes the owner confirms, and the already-spec'd H5 chat notes.
- Any cloud sync. Everything stays under `data/claude/` and the vault.
- Rebuilding the spellbook: prompts are not spells.

## 2. Constraints (in addition to the Hub spec §2)

- **Vault path:** `VEEMO CORTEX/40_Resources/Prompts/` (the vault root is `C:\Users\ROG STRIX\Documents\VEEMO CORTEX`; env `HQ_VAULT_DIR` overrides it for tests and gates, which never touch the real vault).
- **Imports drop folder:** `C:\Users\ROG STRIX\Documents\WorkspaceHQ Imports\` (env `HQ_IMPORTS_DIR` override). Watched for `*.zip`; an import still asks the owner once in the UI before it runs. The H4 file dialog stays.
- **Obsidian-first:** prompt notes are plain Obsidian Markdown with YAML frontmatter and wikilinks; the owner can edit them in Obsidian and the Hub picks the change up.
- **Honesty:** harvest scores are shown with their reasons ("reused 3×", "started a 40-turn session"); usage counts are real counts; nothing claims a prompt is "good".
- **Quota:** every run through the chat engine or a terminal is labelled "uses your Claude quota".
- **Secrets:** every new text path into the index (ChatGPT text, memory notes, history lines, prompt bodies) goes through `maskSecrets` before any cut, per the H1 ruling. A promoted prompt is written **masked**; the owner sees the mask in the preview.
- **External links:** the only things ever opened outside the app are the two fixed URLs `https://claude.ai/new` and `https://chatgpt.com/`, and `obsidian://open?vault=<vault folder name>&file=<path>` where the vault name is the basename of the configured vault root and `file` is a note path inside `40_Resources/Prompts/` that was verified to exist (path-contained; never a URL or path taken from note text). Nothing else, never a URL from data.
- **Lanes:** `spellbook/` and `collector/` are never touched. New main-side code lives in new files with one-line hooks.

## 3. Architecture (additions to the Hub)

```
 ChatGPT export ZIP (drop folder / dialog) ──► ingest-chatgpt.mjs ─┐
 ~/.claude/projects/*/memory/*.md, CLAUDE.md files ──► ingest-docs.mjs ─┤──► hub.sqlite: conversation(source 'chatgpt'), document, prompt_use
 ~/.claude/history.jsonl (byte cursor) ──► ingest-docs.mjs ─────────────┤
 VEEMO CORTEX/40_Resources/Prompts/*.md (watch) ──► ingest-docs.mjs ───┘
                                                         ▲
 v5 Claude › Prompts (Library | Candidates), run modal ───┤ hq.claudeHub.* / hq.claudePrompts.*
 dashboard/claude-prompts.js (main): promote → vault note, run → H3 chat / claudeQuest / clipboard+open, packs
```

| Unit | File(s) | Job |
|---|---|---|
| ChatGPT ingest | `dashboard/claude-hub/ingest-chatgpt.mjs` (+ test, fixture) | Parse `conversations.json` from the export ZIP; current-branch walk; upsert conversations/messages with `source:'chatgpt'` |
| Docs ingest | `dashboard/claude-hub/ingest-docs.mjs` (+ test) | Index memory notes, CLAUDE.md files, prompt notes (frontmatter-aware) and `history.jsonl` lines into `document`; incremental by mtime/size (notes) and byte cursor (history) |
| Harvest | `dashboard/claude-hub/harvest.mjs` (+ test) | Pure scoring of prompt candidates over user messages + history lines |
| Store additions | `dashboard/claude-hub/store.mjs` | `document` + `document_fts`, `prompt_use`, `SCHEMA_VERSION` bumped by one from the version the Hub fleet (H2–H5) leaves, with an in-place migration |
| Hub ops | `dashboard/claude-hub/hub.mjs` | `importChatGPT`, `listDocuments`, `getDocument`, `promptCandidates`, `promptUse`, `promptStats`, watchers for the three doc roots |
| Imports watcher | `dashboard/claude-imports.js` (main, new) | Watches the drop folder; detects export kind by ZIP contents (`conversations.json` + `user.json` ⇒ ChatGPT; `conversations.json` + `projects.json` ⇒ claude.ai); asks once in the UI; routes to the right import |
| Prompts (main) | `dashboard/claude-prompts.js` (main, new) | `promote` (write a new vault note atomically, never overwrite), `run` (chat / terminal / clipboard+open), `importPack`, `exportPack` |
| v5 surfaces | `dashboard-v5/src/{logic,vals,tpl}/prompts-*.js`, `live/adapter.mjs`, `store.js` | Prompts sub-tab (Library, Candidates), run modal with variables, documents in search, project-page "Run a prompt" |

## 4. Data model (additions; `SCHEMA_VERSION` bumped by one from whatever the Hub fleet leaves — H1 shipped 1, H2–H5 may bump it — migrated in place)

```sql
-- conversation.source gains 'chatgpt'; native_id = the export's conversation id
document(id TEXT PRIMARY KEY,                -- 'memory:<sha1 of path>' | 'claude-md:<sha1>' | 'prompt:<sha1>' | 'history:<sessionId>:<offset>'
         source TEXT NOT NULL,                -- 'memory' | 'claude-md' | 'prompt' | 'history'
         path TEXT, title TEXT, text TEXT NOT NULL DEFAULT '',   -- text is masked
         project_id TEXT, project_path TEXT,  -- memory/claude-md: the project folder; history: the typed-in project
         mtime_ms INTEGER, size INTEGER, meta TEXT)             -- meta JSON: frontmatter (prompt), {sessionId, pasted} (history)
document_fts USING fts5(title, text, content='document', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')
prompt_use(prompt_id TEXT NOT NULL, at TEXT NOT NULL, target TEXT NOT NULL,   -- 'chat' | 'terminal' | 'claude.ai' | 'chatgpt'
           project_id TEXT, conversation_id TEXT)
ingest_cursor also tracks history.jsonl (file 'history.jsonl', byte offset)
```

Rules: idempotent upserts keyed on `id`; `forget` works on documents too; tombstones apply; `index_version` bumps when any parser's indexed shape changes.

## 5. Ingest

### 5.1 ChatGPT export
- **Input:** the owner's export ZIP (OpenAI emails it). Expected `conversations.json`: an array of conversations, each with `title`, `create_time`, `update_time`, `conversation_id`/`id`, `current_node`, and `mapping` (node id → `{ message, parent, children }`; `message` has `author.role` ∈ user/assistant/system/tool, `create_time`, `content.content_type` ('text', 'code', 'multimodal_text', …) and `content.parts` (strings, or objects for images/attachments)).
- **Branch walk:** from `current_node` up `parent` links to the root; that is the conversation the owner last saw. Other branches are skipped (counted in the report).
- **Mapping:** user/assistant text parts → messages (`role` as is; `tool` → `'tool'`; `system` → `'system'`, hidden by default); non-string parts → `[image]` / `[attachment]`; `code` content → fenced text. Timestamps from `create_time` (epoch seconds). Title from `title` (`title_source 'web'`). No token usage (ChatGPT exports carry none; `tokens_*` stay NULL).
- **Other files** (`user.json`, `message_feedback.json`, `shared_conversations.json`, `model_comparisons.json`): not imported; counted in the report. If a file with a recognizable "memory" shape exists, it is imported as `document` rows with `source 'memory'` and `meta.origin 'chatgpt'`; otherwise skipped and said so.
- **Defensive:** unknown fields ignored; a conversation with no readable messages is skipped and counted; the report is counts only. Streaming unzip into `data/claude/tmp/`, deleted after.
- **De-dup:** `web_sync(kind 'chatgpt', native_id, updated_at)`; re-importing a newer export updates changed conversations and never duplicates.

### 5.2 Local Claude context (`ingest-docs.mjs`)
- **Memory notes:** `~/.claude/projects/*/memory/*.md` (root from `HQ_CLAUDE_HOME`). Frontmatter `name/description/type` → `title`/`meta`. `project_path` decoded from the folder's first `cwd` seen in its transcripts (already in `project.path`), else the encoded folder name.
- **CLAUDE.md files:** `~/.claude/CLAUDE.md` plus `<project path>/CLAUDE.md` for every project the Hub knows (code projects' `path`) — read-only, incremental by mtime/size. Never any other repo file.
- **history.jsonl:** byte-cursor ingest like transcripts; each line → `document(source 'history', text = display, meta {sessionId, project, pasted: !!keys(pastedContents).length})`. Lines are the harvest pool; they are not shown as chats.
- **Prompt notes:** `HQ_VAULT_DIR/40_Resources/Prompts/*.md` → `document(source 'prompt')` with the full frontmatter in `meta`. Watched live; a note deleted in Obsidian disappears from the library on the next sweep.

## 6. Prompt library

### 6.1 Note format (vault, source of truth)
```markdown
---
title: Review a PR like a staff engineer
tags: [review, code]
variables: [project, file]
version: 1
created: 2026-10-15T10:00:00Z
source: { kind: code, conversation: "code:<sessionId>", at: "2026-09-02T14:03:00Z" }   # present when harvested
hq: { id: "prompt:<sha1 of path>" }   # written by WorkspaceHQ; harmless if removed
---
You are reviewing {{file}} in {{project}}. …
```
Variables are `{{name}}` tokens; `{{project}}` and `{{cwd}}` are filled from the chosen project, everything else is asked in the run modal. Body is the prompt. The file name is the slugified title; WorkspaceHQ never overwrites an existing file (a clash becomes `<slug>-2.md` after a confirm).

### 6.2 Harvest (`harvest.mjs`, pure, tested)
- **Pool:** user-role messages from sources code/web/chatgpt + `history` documents.
- **Normalize:** trim, collapse whitespace, lowercase for grouping; keep the original text for display.
- **Exclude:** < 120 chars; starts with `/` (slash commands); contains a mask marker or `<local-command`; `pasted` history lines (mostly a paste); system/tool roles.
- **Score** (each term shown as a reason): `reuse × 3` (identical normalized text across ≥ 2 sessions), `productivity` = min(assistant turns that followed in that session, 20) / 4, `length` bonus 1 for ≥ 300 chars, `−5` if it already exists as a prompt note (same normalized text).
- **Output:** top N candidates `{ text, score, reasons[], sources: [{kind, conversationId|documentId, at, project}] }` — never a judgment word.

### 6.3 Surfaces (v5, `<!-- v5: -->` marked)
- **Claude › Prompts** sub-tab with **Library** (prompt notes: title, tags, usage count, last used, variables; search; "Run", "Open in Obsidian" via the contained `obsidian://open` link (§2), "Open file") and **Candidates** (harvest list with reasons and origin; "Promote" single or multi-select with one confirm; "Hide" = a tombstone so it never comes back).
- **Run modal:** project picker (defaults to the current page's project), variable fields, target: **Chat** (H3 engine, read-only mode default, quota label) · **Terminal** (`claudeQuest(projectPath, text)`) · **Copy for claude.ai** (clipboard + `shell.openExternal('https://claude.ai/new')`) · **Copy for ChatGPT** (clipboard + `https://chatgpt.com/`). Each run logs `prompt_use`.
- **Project page:** "Run a prompt" shortcut.
- **Search:** results include documents with a source badge (memory / CLAUDE.md / prompt) and open in place.
- **Imports:** a drop in the drop folder shows a one-time confirm card ("Import ChatGPT export (412 chats)?"); progress and the counts-only report appear on System.
- **Packs:** "Import pack" (a folder or ZIP of `.md` notes → copied into the Prompts folder after a confirm, never overwriting) and "Export pack" (ZIP of the folder to a path the owner picks).

### 6.4 Main-side (`claude-prompts.js`)
- `promote({ text, title, tags[], variables[], source })` → writes the note atomically under the Prompts folder only (path containment), returns `{ path }` or `{ error }`.
- `run({ promptId, projectId, vars, target })` → fills variables, then: `chat` → `claudeChat.send` (H3), `terminal` → the existing `launchClaudeTerminal`, `claude.ai`/`chatgpt` → clipboard + `shell.openExternal` of the fixed URL only; logs `promptUse` through the Hub.
- `importPack({ path })`, `exportPack({ to })`: Prompts folder only; ZIP via streaming; never overwrite.

## 7. Hub ops and IPC (rows go into IPC-CONTRACT before handlers)

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.importExport(kind?)` (H4, extended) | `hq:claude-hub:import` | `kind` ∈ `'auto'|'claude'|'chatgpt'`; file dialog unless `path` given by the drop watcher; progress push |
| `claudeHub.documents(opts)` | `hq:claude-hub:documents` | `{ source?, projectId?, q?, limit }` → document list |
| `claudeHub.document(id)` | `hq:claude-hub:document` | one document (text masked) |
| `claudeHub.promptCandidates(opts)` | `hq:claude-hub:prompt-candidates` | top N with reasons |
| `claudeHub.promptStats()` | `hq:claude-hub:prompt-stats` | usage per prompt id |
| `claudePrompts.promote(p)` | `hq:claude-prompts:promote` | `{ path }` / `{ error }` |
| `claudePrompts.run(r)` | `hq:claude-prompts:run` | `{ ok, turnId? }` / `{ error }` |
| `claudePrompts.importPack(path)` / `exportPack(to)` | `hq:claude-prompts:import-pack` / `export-pack` | counts / `{ error }` |
| `claudeImports.on(cb)` | push `hq:claude-imports:event` | `{ event:'found'|'progress'|'done'|'error', data }` |

Hub ops: `importChatGPT({zipPath})`, `listDocuments`, `getDocument`, `promptCandidates`, `promptUse`, `promptStats`, `hideCandidate` (tombstone).

## 8. Errors, privacy, honesty
- An export ZIP that isn't recognized: "Not a ChatGPT or claude.ai export (looked for conversations.json)". Nothing imported, nothing deleted.
- The vault folder missing: the Library says "No prompts folder yet — create VEEMO CORTEX/40_Resources/Prompts or promote a candidate" and Promote creates it.
- Obsidian not installed: "Open in Obsidian" falls back to "Open file".
- All document text is masked before indexing; previews show masks; promoted notes are written masked.
- Hidden candidates and forgotten chats never resurface (tombstones).
- Logs carry counts and messages, never conversation or prompt text.

## 9. Testing
- Pure parsers with placeholder fixtures: a tiny ChatGPT export (two branches, an image part, a `code` part, a tool node), memory notes with and without frontmatter, history lines, prompt notes with every frontmatter field.
- Harvest scoring: reuse, productivity, exclusions, the "already a prompt" penalty.
- Store migration from the Hub fleet's final schema version, on a populated db of that version; document FTS; prompt_use.
- Main: promote path containment (`..`, absolute, slug clash), pack import never overwrites, run target whitelist and the open-link whitelist (only the two fixed URLs and a contained `obsidian://open` link can be opened; a `file` outside the Prompts folder or a URL from note text is refused).
- v5: fake-preload parity; goldens and selftest combos for Library (empty / filled), Candidates, the run modal, the import confirm card; CDP scenarios `prompts-promote-confirm`, `prompts-run-chat`, `imports-drop-confirm`, `search-documents`.
- Real second instance with `HQ_VAULT_DIR`, `HQ_IMPORTS_DIR`, `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB` pointed at fixtures; the fake `claude` shim; never the owner's vault or index.

## 10. Rollout (second fleet, after the Hub fleet finishes H5)

| Phase | Delivers |
|---|---|
| **H6 Sources** | store schema 2 (+ migration), `ingest-chatgpt.mjs`, `ingest-docs.mjs` (memory, CLAUDE.md, history, prompt notes), Hub ops, drop-folder watcher + confirm card, documents in search, System report |
| **P1 Library** | note format, Library sub-tab, Open in Obsidian/file, project-page shortcut |
| **P2 Harvest** | `harvest.mjs`, Candidates sub-tab, Promote (single/multi, confirm), Hide |
| **P3 Run + packs** | run modal (variables, targets, quota label), `prompt_use` + stats on the Library, import/export packs |

## 11. Risks
- **ChatGPT export format drift** → defensive parser, counts-only report, and "not recognized" instead of a half-import.
- **Vault edits racing the index** → the Hub only reads the Prompts folder; writes are atomic new files; the sweep reconciles.
- **Harvest noise** → scores show reasons; Hide is one click and permanent; no auto-promote.
- **Opening external URLs** → only the two fixed URLs and the contained `obsidian://open` link (§2), never a URL from data.
