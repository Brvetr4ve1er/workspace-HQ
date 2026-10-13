# Claude Hub: every Claude project and chat inside WorkspaceHQ (design)

**Date:** 2026-10-13 · **Status:** approved in conversation, awaiting spec review · **Lane:** frontend (`dashboard/`, `dashboard-v5/`, `browser-bridge/`) + shared (`data/claude/` shape, docs)

## 1. Intent

The owner wants WorkspaceHQ to receive **all** of their Claude activity, meaning every project and every chat, and to work with it. There are two sources:

- **Claude Code**: the CLI and the desktop app's Code tab. Every session is a JSONL transcript on disk under `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Today that is 32 project folders and about 3.9 GB, and the largest single file is 630 MB.
- **claude.ai**: chats and Projects in the web app and the desktop Chat tab. These live on Anthropic's servers.

What the owner wants to do with that data:

1. **Browse and search** every project and chat, linked to the matching WorkspaceHQ project.
2. **Activity and timeline**: per day and per project, sessions, chats, active time, and tokens or cost where recorded.
3. **Chat with Claude inside WorkspaceHQ.** The engine is the owner's logged-in Claude Code: no API key, and the chat runs in a project folder.
4. **Ground Ask** (the local model) in their chat history, staying 100% local.
5. **Save to the VEEMO CORTEX vault**: summaries and decisions, each with the owner's confirmation.

The owner made these decisions on 2026-10-13: both sources; claude.ai comes in through the official export for backfill plus the WorkspaceHQ Bridge extension for live sync; the chat engine is Claude Code; approach A (a local index process).

**Success:** within about a minute of a chat happening anywhere (a terminal, the desktop app, claude.ai while the extension is running), the owner can find it, search it, ask about it, and continue it from WorkspaceHQ. Nothing leaves the machine except the claude.ai fetches made by their own browser session, and the Claude Code calls they start themselves.

### Non-goals

- Writing to claude.ai. No posting, no editing, no deleting.
- Resuming a claude.ai conversation in place. There is no API for that, so "Continue in Claude Code" starts a new Code session seeded with the chat's text.
- Any cloud sync, upload, or sharing of the index.
- Bypassing Claude Code's permission system. `bypassPermissions` and `--dangerously-skip-permissions` are never used.

## 2. Constraints

- **Public repo.** Imported data, indexes and logs live only under `data/claude/`, which is gitignored. Test fixtures use placeholder text only.
- **Runtime.** The Electron main process runs Node 20.18 and has no `node:sqlite`. The system Node (v25.6.1, SQLite 3.51.2) has `node:sqlite` with FTS5; this was verified on 2026-10-13. The index therefore runs in a separate process on system Node 22.13 or later (the first 22.x line where `node:sqlite` needs no `--experimental-sqlite` flag).
- **Lanes.** New main-side code goes in new files with one-line hooks in `main.js`. Every new channel gets an `IPC-CONTRACT.md` row before its handler is written. The `data/claude/` shape gets a `CONTRACT.md` entry. `collector/` is not touched (struct lane).
- **v5 conventions.** Template additions carry `<!-- v5: reason -->` markers. Goldens are re-recorded only after every changed scenario has been attributed. Honesty rules apply: no invented numbers, and estimates are labelled. CSP stays `default-src 'self'`.
- **Owner's app.** It stays usable between phases. Each phase ships separately.

## 3. Architecture

```
 ~/.claude/projects/**.jsonl ──watch──┐
 claude.ai export ZIP ──import────────┤        ┌───────────────────────┐
 extension (claude.ai, logged-in) ────┼──────▶ │  Claude Hub process   │──▶ data/claude/hub.sqlite (FTS5)
   POST /claude/* on the local bridge │        │  (system Node ≥ 22.13) │
                                      │        └──────────┬────────────┘
                                      │      JSON lines over stdio (request/response + events)
                                      │                   │
                              dashboard/main.js ── claude-hub-host.js (spawn, supervise, route)
                                      │                   │
                                 preload hq.claudeHub.*   │  claude-chat.js (Claude Code engine, per-turn)
                                      │                   │
                              dashboard-v5 (Claude tab, project page, History, Ask, vault)
```

### 3.1 Units

| Unit | File(s) | Job | Depends on |
|---|---|---|---|
| Hub host | `dashboard/claude-hub-host.js` (new; main process) | Find system Node ≥ 22.13; spawn the Hub with `windowsHide`; restart it with backoff if it crashes; route requests by id with timeouts; turn Hub events into window pushes; report health | `child_process` |
| Hub process | `dashboard/claude-hub/hub.mjs` (new; system Node) | Own `hub.sqlite`; handle the query and ingest API; run the watchers | `node:sqlite`, `fs.watch` |
| Code ingest | `dashboard/claude-hub/ingest-code.mjs` | Parse Claude Code transcripts incrementally by byte offset per file, with resumable backfill | pure parser + db |
| Web ingest | `dashboard/claude-hub/ingest-web.mjs` | Import the claude.ai export ZIP; accept extension pushes; de-duplicate | pure parser + db |
| Store | `dashboard/claude-hub/store.mjs` | Schema, migrations, FTS queries, stats | `node:sqlite` |
| Linker | `dashboard/claude-hub/link.mjs` | Map Claude projects to WorkspaceHQ projects | `data/latest.json` (read-only) |
| Chat engine | `dashboard/claude-chat.js` (new; main) | Run Claude Code turns (`-p … stream-json`), stream them, cancel them, enforce the permission mode | `claude-sessions.js` findClaude (read-only use), `stream-parse.js` |
| Bridge routes | `dashboard/browser-bridge.js` (route hook) + `dashboard/claude-bridge-routes.js` (new) | `POST /claude/sync` (extension pushes) and `GET /claude/sync-state` | Hub host |
| Extension | `browser-bridge/claude-sync.js` (new) | Read-only, rate-limited sync from claude.ai | optional host permission `https://claude.ai/*` |
| v5 surfaces | `dashboard-v5/src/{logic,vals,tpl}/claude-*.js`, `live/adapter.mjs` and `store.js` additions | Chats, Projects, thread view, composer, activity, Ask chip, vault preview | `hq.claudeHub.*`, `hq.claudeChat.*` |
| Vault writer | `dashboard/claude-vault.js` (new; main) | Write one confirmed note into VEEMO CORTEX | `fs` (atomic write) |

Each unit has one job and a narrow interface. The parsers are pure functions over strings and objects so they can be unit-tested without the database or Electron.

## 4. Data model (`data/claude/hub.sqlite`)

```sql
source(id TEXT PRIMARY KEY)                              -- 'code' | 'web'
project(id TEXT PRIMARY KEY, source TEXT, key TEXT,      -- code: encoded cwd folder; web: project uuid
        name TEXT, path TEXT, hq_project_id TEXT,        -- path for code; hq link (nullable)
        link_state TEXT,                                 -- 'auto' | 'confirmed' | 'none' | 'rejected'
        created_at TEXT, updated_at TEXT)
conversation(id TEXT PRIMARY KEY, source TEXT, project_id TEXT,
        native_id TEXT,                                  -- sessionId / chat uuid
        title TEXT, title_source TEXT,                   -- 'custom' | 'ai' | 'first-prompt' | 'web'
        started_at TEXT, last_at TEXT, message_count INT,
        cwd TEXT, git_branch TEXT, model TEXT,
        tokens_in INT, tokens_out INT, tokens_cache_read INT, tokens_cache_write INT,   -- code only, sums of recorded usage; NULL when unknown
        active_ms INT,                                   -- sum of gaps < 5 min between messages; labelled as an estimate in the UI
        forgotten INT DEFAULT 0)
message(id TEXT PRIMARY KEY, conversation_id TEXT, native_id TEXT, parent_id TEXT,
        role TEXT,                                       -- 'user' | 'assistant' | 'tool' | 'system'
        at TEXT, text TEXT,                              -- display text (tool output trimmed to 2 KB, thinking omitted)
        tool_name TEXT, is_sidechain INT, tokens_in INT, tokens_out INT)
message_fts USING fts5(text, content='message', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')
ingest_cursor(file TEXT PRIMARY KEY, size INT, mtime_ms INT, offset INT, session_id TEXT)   -- incremental Code ingest
web_sync(kind TEXT, native_id TEXT, updated_at TEXT, PRIMARY KEY(kind, native_id))           -- extension/export de-dup
meta(key TEXT PRIMARY KEY, value TEXT)                   -- schema_version, backfill progress, last errors
```

Rules:

- **Idempotent.** Every ingest is an upsert keyed on `(source, native_id)`. Re-running the backfill or re-importing an export never creates duplicates.
- **Trimming.** Message `text` keeps user and assistant prose in full. Tool calls become one line (`[tool: Read path]`). Tool results keep their first 2 KB. Thinking blocks and binary content are dropped. A 630 MB transcript reduces to a few MB of indexed text.
- **Secret masking.** Strings matching known secret shapes (provider keys, `sk_live_`-style tokens, PEM blocks, `Authorization:` headers) are masked as `••• secret (type)` before indexing. The mask is shown in previews and search results. The original transcript on disk is never modified.
- **Forget.** "Forget this chat/project" deletes the rows plus their FTS entries, and records a tombstone so ingest skips that item from then on. The original file or claude.ai item is untouched, and the UI says so.

## 5. Ingest

### 5.1 Claude Code

- **Root.** `~/.claude/projects`. The env override `HQ_CLAUDE_HOME` points at a fixture copy for tests and gates.
- **Files.** One file is one session (`<sessionId>.jsonl`). The project folder name encodes the cwd. The authoritative cwd is read from the entries' own `cwd` field, not decoded from the folder name.
- **Entry handling.** `user` and `assistant` are messages: text plus tool blocks, with usage from `message.usage`. `custom-title` and `ai-title` set the title. `summary`, `attachment`, `queue-operation`, `file-history-*`, `progress`, `mode`, `permission-mode` and other kinds are skipped or used only for metadata. Unknown types are counted in `meta` and ignored. They never fail the file.
- **Backfill.** Files are processed newest first, so recent work appears first. They stream line by line with a byte cursor (never a whole file in memory). Progress goes to `meta` and is pushed as `hq:claude-hub:progress`. The work yields regularly so the Hub keeps answering queries during backfill.
- **Live.** `fs.watch` (recursive) on the root, debounced 1 s per file. On a change, the parser reads from the stored offset to EOF. A truncated or replaced file (size below the offset, or a different first line) is re-ingested from 0.
- **Malformed lines** are skipped and counted. A partial last line waits for the next change.

### 5.2 claude.ai export (backfill)

- **Starting an import.** "Import claude.ai export" in Settings and in the Claude tab opens a file dialog (main, `dialog.showOpenDialog`, `.zip` only). Main passes the path to the Hub, which unzips in a streaming way into a temp folder under `data/claude/tmp` and deletes it afterwards.
- **Expected content.** `conversations.json` (conversations with `chat_messages`, `sender`, `text`/`content`, timestamps, project uuid where present) and `projects.json` (name, description, docs).
- **Defensive parsing.** The format is not formally documented. The parser accepts known field variants, records unknown shapes in an import report (counts only, no content) and imports what it understands. A ZIP with neither file gives an honest error.

### 5.3 claude.ai live sync (extension)

- **Permission.** The extension requests the optional host permission `https://claude.ai/*` at runtime, on the owner's click in the popup ("Sync claude.ai").
- **What it reads.** While a claude.ai tab is open and the owner is logged in, the background script makes **read-only GET** requests that send the claude.ai session cookie: the conversation list, and then each changed conversation. Changed means `updated_at` is newer than the app's `web_sync` state, which comes from `GET /claude/sync-state` on the local bridge.
- **Pacing.** At most one request every 2 s. Back off exponentially on 429/5xx. Stop and show "claude.ai changed, sync paused" when responses don't match the expected shape. Never retry in a tight loop.
- **Delivery.** Results go to the local bridge as `POST /claude/sync` (same token rule as the other routes, JSON body capped at 4 MB per request, chunked by conversation).
- **Risks, stated plainly.** These are claude.ai's own page requests, not a public API. They may change without notice, and automated reads may be rate-limited. The popup states this. The export path keeps working regardless.

## 6. Hub protocol (main ↔ Hub, JSON lines over stdio)

- **Request:** `{"id": n, "op": "<name>", "args": {...}}`. **Response:** `{"id": n, "ok": true, "result": ...}` or `{"id": n, "ok": false, "error": "..."}`. **Event:** `{"event": "<name>", "data": {...}}`.
- **Ops:**
  - `health`
  - `listProjects({source?})`
  - `listConversations({projectId?, source?, q?, before?, limit≤200})`
  - `getConversation({id, limit?, before?})`, paged
  - `search({q, projectId?, source?, limit≤50})`: FTS, returns snippet, rank and conversation id
  - `stats({from, to, projectId?})`: per-day counts, active_ms, tokens
  - `contextFor({query, budgetChars})`: for Ask
  - `importExport({zipPath})`
  - `syncState()`
  - `syncPush({items})`
  - `link({projectId, hqProjectId|null, state})`
  - `forget({conversationId|projectId})`
  - `reindex()`
- **Events:**
  - `progress` (backfill and import)
  - `changed` (conversation ids; debounced)
  - `error` (message only)
- **Main-side wrapper (`claude-hub-host.js`).**
  - Times out each request (5 s for queries, none for imports, which use progress events).
  - Restarts the Hub process with backoff (1 s, 5 s, 30 s, then gives up and reports).
  - Never lets a Hub failure throw into main.

## 7. IPC (preload `hq.claudeHub.*`, `hq.claudeChat.*`)

New rows go into `docs/sync/IPC-CONTRACT.md` before any handler.

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.health()` | `hq:claude-hub:health` | `{state:'ready'\|'indexing'\|'no-node'\|'down', node, backfill:{done,total}, counts}` |
| `claudeHub.projects(opts)` | `hq:claude-hub:projects` | list of projects (with `hqProjectId`, `linkState`) |
| `claudeHub.conversations(opts)` | `hq:claude-hub:conversations` | paged list |
| `claudeHub.conversation(id, opts)` | `hq:claude-hub:conversation` | header + paged messages |
| `claudeHub.search(q, opts)` | `hq:claude-hub:search` | hits with snippets |
| `claudeHub.stats(opts)` | `hq:claude-hub:stats` | per-day series |
| `claudeHub.importExport()` | `hq:claude-hub:import` | opens the file dialog in main; `{started}` or `{canceled}`; progress via push |
| `claudeHub.link(id, hqId, state)` | `hq:claude-hub:link` | `true`/`{error}` |
| `claudeHub.forget(target)` | `hq:claude-hub:forget` | `true`/`{error}` |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | `{event, data}` |
| `claudeChat.send({conversationId?, projectId?, text, mode})` | `hq:claude-chat:send` | `{turnId, sessionId?}` or `{error}`; `mode` ∈ `read-only` \| `edits` |
| `claudeChat.cancel(turnId)` | `hq:claude-chat:cancel` | `true/false` |
| `claudeChat.on(cb)` | push `hq:claude-chat:event` | `{turnId, kind:'delta'\|'tool'\|'done'\|'error', …}` |
| `claudeVault.preview(conversationId)` | `hq:claude-vault:preview` | `{path, markdown}` drafted by the local model, or `{error}` |
| `claudeVault.save({path, markdown})` | `hq:claude-vault:save` | `true`/`{error}`; the path must be inside `VEEMO CORTEX/30_Areas/Claude/` |

## 8. Chat engine (`claude-chat.js`)

- **One process per turn.** Command: `claude -p --output-format stream-json --verbose --include-partial-messages --permission-prompts none --permission-mode <plan|acceptEdits> [--resume <sessionId>]`. The prompt goes on stdin. The cwd is the linked WorkspaceHQ project path or the conversation's own `cwd`. **cwd rule:** it must be an existing directory that is either a WorkspaceHQ project path (`resolveProjectPath`) or a cwd that a Claude Code session in the Hub has already recorded, so the owner already ran Claude there. Some projects live outside Documents (e.g. on the Desktop), which is why `resolveProjectPath` alone is not enough. The drive root, `C:\Windows`, `Program Files` and the user-profile root itself are always refused.
  - **New chat:** no `--resume`. The `sessionId` is taken from the stream's init event and returned to the renderer.
  - **Continue:** `--resume <sessionId>` for any Claude Code session, including ones started in a terminal or the desktop app.
- **Modes.**
  - `read-only` maps to `plan`. Claude can read and answer but not edit or run commands.
  - `edits` maps to `acceptEdits`. File edits are allowed; commands still need a prompt, which `--permission-prompts none` denies.
  - The UI shows the mode on every turn. `bypassPermissions` and `--dangerously-skip-permissions` are never passed; a unit test pins this.
- **Streaming.** stdout goes through a stream-json parser (extending `stream-parse.js`'s rules). Partial-message deltas become `delta` events, tool_use blocks become `tool` events, and the `result` event becomes `done` with usage. The renderer shows text growing live and tool calls as collapsed rows. Stop calls `cancel`, which kills the process tree with the same launcher-safe tree stop as do-commit.
- **Limits.** One running turn per conversation and at most 3 at once. A turn hard-times out after 10 min.
- **Continue a claude.ai chat in Code.** This starts a new chat in the linked project. Its first prompt is the claude.ai chat text, trimmed to 30 000 chars, under a clear header ("Context: a claude.ai conversation titled …"), followed by the owner's message. The UI shows the trimming.
- **Quota.** Every send shows "uses your Claude quota". The chat appears in the library automatically, because it is a normal Claude Code session.

## 9. v5 surfaces

- **Claude tab sub-tabs:**
  - **Chats** (new default). A list of conversations: source badge, title, project, last activity, message count, and tokens for Code chats. It has source, project and date filters and a search box (FTS with highlighted snippets). Selecting a chat opens the **thread view**: paged messages, collapsed tool rows, timestamps, and the session's model, branch and tokens. It also offers "Continue" (composer), "Open in terminal" (existing), "Save to vault" and "Forget".
  - **Projects** (new). Claude Code folders and claude.ai Projects, with link chips to WorkspaceHQ projects: auto-matched links show "confirm / change / unlink".
  - **Sessions.** Live runs, kept as today.
  - **Canvas.** Kept.
- **Composer.** Project picker, mode switch (Read-only / Allow edits), Send / Stop, and the quota label. It streams into the thread view.
- **Project page.** A "Claude" section with this project's last 5 chats and "New chat".
- **History.** A "Claude activity" strip: chats and sessions per day, active time (labelled *estimate*), and tokens per project where recorded.
- **System.** Hub health: Node version, index size, backfill progress, last error, and a Reindex button.
- **Ask.** A seventh source chip, **Claude history**. It is stored in v3's `hq-oracle-include` as the extra key `claude`. v3 reads only its six keys and rewrites the object with those six on its next save, so a v3 rollback quietly drops the chip. v5 then treats it as off. Rollback stays safe. The snippets come from `contextFor` through `llm-context.js`'s budget, and answers cite "chat <title>, <date>".
- **Vault.** "Save to vault" calls `preview`: the local model drafts a summary, decisions, to-dos and links. The owner sees an editable preview, and `save` writes `VEEMO CORTEX/30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md` with frontmatter (`source`, `conversation`, `project: [[<project note>]]`, `created`). The write is atomic, never overwrites without a "replace" confirm, and is never automatic or bulk.
- **Template markup.** All template additions follow the Claude Design visual language with `<!-- v5: -->` markers.

## 10. Errors, privacy, honesty

- **No Node 22.13+ on the system.** Hub state `no-node`. The Claude tab shows "Claude Hub needs Node 22.13 or newer (found: …)" and links to install instructions. Nothing else breaks.
- **Hub down or restarting.** Lists show the last loaded data with a "reconnecting" note. Search is disabled with the reason shown.
- **Empty states** say why: no sessions yet, or the export not imported. They never show zero as if it were data.
- **Logging.** Errors go to the existing app log, `logs/app-*.log`, as messages only, with no conversation text.
- **Extension.** It reads claude.ai only after the owner grants the permission, shows its last sync time and status, and can be turned off from the popup.
- **Placeholder data.** Placeholder fixtures only in the repo. `data/claude/` is added to `.gitignore` in phase H1, before any data is written.

## 11. Testing

- **Pure parsers.** Code transcript lines (each known type, malformed lines, partial lines, truncation and replacement) and the export JSON (known variants, unknown fields), using placeholder fixtures.
- **Store.** Upsert idempotency, FTS queries (prefix, phrase, diacritics), forget plus tombstones, stats math, and secret masking.
- **Hub protocol.** Spawn the Hub against a temp DB and `HQ_CLAUDE_HOME` fixture: backfill, live append, restart and resume, timeouts.
- **Chat engine.** Argument construction (never bypass), mode mapping, stream parsing, cancel, and the cwd containment, with a fake `claude` shim on PATH as in `claude-launch.test.mjs`.
- **Bridge routes.** Token, size caps, schema checks, and de-duplication.
- **v5.**
  - fake-preload parity for the new methods.
  - Goldens and selftest combos for each new state.
  - CDP scenarios: `claude-library-search`, `claude-thread-open`, `claude-chat-stream-stop`, `claude-chat-mode-readonly`, `claude-import-progress`, `ask-claude-chip`, `vault-preview-confirm`.
- **Real second instance.** Run with `HQ_CLAUDE_HOME=<fixture copy>` and `HQ_APP_LOG_DIR`. The chat gate uses a fake `claude` shim, so no real quota is spent in gates.

## 12. Rollout

Each phase gets its own plan, build and adversarial review cycle, and ships on its own.

| Phase | Delivers | Owner-visible result |
|---|---|---|
| **H1 Hub + Code ingest** | Hub process, host, store, Code ingest, health; `.gitignore` + CONTRACT entry | System shows the Hub indexing; counts appear |
| **H2 Library + activity** | Chats/Projects tabs, thread view, search, links, project-page section, History strip | Browse and search every Claude Code session |
| **H3 Chat** | Chat engine + composer | Chat with Claude in any project from WorkspaceHQ |
| **H4 claude.ai** | Export import + extension sync (extension 0.4.0) | claude.ai chats and Projects in the same library |
| **H5 Ask + vault** | Claude history chip + vault preview and save | Ask answers from chat history; chats can become vault notes |

## 13. Risks

- **claude.ai's internal requests change.** Mitigation: shape checks, sync pauses with a clear message, and the export path keeps working.
- **Index size and backfill time** on 3.9 GB of transcripts. Mitigation: trimming, a streaming parser, newest first, and progress shown. Target: an index under 400 MB and the first 30 days indexed within minutes.
- **Claude Code transcript format changes** (new entry types appear often; 17 types were seen in a sample). Mitigation: unknown types are counted and ignored, and message parsing only relies on `type`, `message.role`, `message.content` and `message.usage`.
- **Quota use from in-app chat.** Mitigation: an explicit label on every send, one turn at a time, and no background or automatic turns.
- **Privacy of a local index of everything.** Mitigation: gitignored, local only, masked secrets, Forget, and nothing is sent to any model except what the owner explicitly asks (Ask uses the local model; chat uses the owner's own Claude Code).
