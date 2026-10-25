# Prompt library — Run + usage + packs (phase P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prompt note in Claude › Prompts can be **run**: a run modal (project picker defaulting to the page's project, one field per `{{variable}}`, targets **Chat** / **Terminal** / **Copy for claude.ai** / **Copy for ChatGPT**, every Claude target labelled "uses your Claude quota") fills the variables main-side and sends the prompt through the H3 chat engine exactly as landed, the existing `launchClaudeTerminal`, or the clipboard plus one of the two fixed URLs; every successful run writes one real `prompt_use` row through the Hub so the Library's usage count and last use (P1 `promptStats`) move; and the owner can **import a pack** (a folder or ZIP of `.md` notes, one confirm, never overwriting) and **export a pack** (a ZIP of the Prompts folder, streamed, never overwriting).

**Architecture:** Pure helpers join P1's CommonJS note module `dashboard/claude-prompt-note.js` (`bodyOf`, `fillVariables`, `RESERVED_VARS`). Hub side (system Node): `store.mjs` gains the writer `addPromptUse(row)` over the H6 table `prompt_use` (no schema change, no index change); `hub.mjs` gains the writer op `promptUse` (serialized, readers refuse). Main side: P1's `dashboard/claude-prompts.js` gains `run(req, {sender})` (body read from the note file on disk — the vault is the source of truth — via P1 `findPromptFile`; project path resolved main-side from `getProjects`; chat → the H3 `chat.send(req, {alive})` with the same `watchSender` wiring as the H3 handler; terminal → `launchClaudeTerminal`; copy targets → `clipboard.writeText` + `shell.openExternal` of a literal constant), then `hub.request('promptUse', …)`; a NEW `dashboard/claude-prompt-pack.js` holds the streaming ZIP writer and `importPack` (two-step: plan → confirm) / `exportPack`. `main.js`: the H3 chat init line captures its return value, and P1's `claude-prompts` init line passes the new dependencies — two touched lines, no new line. v5: store `adoptClaudeTurn` (the post-IPC half of `sendClaudeChat`, so a chat run's streamed events reach the composer) plus `runPrompt`/`packImport`/`packExport`; adapter `runView`/`packView`; a `runLogic` mixin (`rn*`) replacing P1's `prRun` placeholder; a run modal and a pack confirm dialog in `tpl/extras.tpl.js`; Import pack / Export pack buttons in the Library header; selftest rows, attributed goldens, CDP `prompts-run-chat`, `prompts-run-copy`, `prompts-pack-import`.

**Tech Stack:** Node ≥ 22.13 `node:sqlite` (Hub), `node:test`, Electron 32 main (CommonJS; `clipboard`, `shell.openExternal`, `dialog`; dynamic `import()` of the Hub's ESM `unzip.mjs`/`redact.mjs`, the P2 pattern), `node:zlib` (`deflateRawSync` per entry; CRC-32 by table — Electron 32's Node 20 has no `zlib.crc32`), vanilla v5 renderer (`src/dc/runtime.js` templates), fake preload + CDP gate.

**Spec:** `docs/superpowers/specs/2026-10-15-archive-and-prompt-library-design.md` — §2 (quota label, external links, secrets, vault path), §4 (`prompt_use`), §6.3 (run modal, packs), §6.4 (`run`, `importPack`, `exportPack`), §7 (`claudePrompts.run/importPack/exportPack`, `promptStats`, Hub op `promptUse`), §8 (honesty, logs), §9 (run target whitelist, open-link whitelist, pack never overwrites; CDP `prompts-run-chat`), §10 row P3. Hub base spec `docs/superpowers/specs/2026-10-13-claude-hub-design.md` (§8 chat engine). Earlier plans whose interfaces are relied on (they land before this phase): H6 `docs/superpowers/plans/2026-10-15-archive-prompts-h6.md` (schema 2 `prompt_use`, `docId`, `makeDocsHome`), P1 `…-p1.md` (`claude-prompt-note.js` `PROMPTS_REL`/`VAR_RE`/`slugify`/`variablesOf`/`promptDocId`; `claude-prompts.js` `NOTE_TEXT_MAX`, `resolvePromptsDir`, `writePromptNote`, `findPromptFile`, `createPrompts`, `init`; `promptStats`; store `live.prompts` + `refreshPrompts`; `promptsLogic.prRun` placeholder + `RUN_LATER`; vals `pr*`; DOM `data-pr`), P2 `…-p2.md` (`createPrompts({…, now})`, `promote`, `maskText` via dynamic import of `redact.mjs`; vals `hc*`; overlay state `promote`). Exact live names at HEAD 4c8da80: `.superpowers/sdd/2026-10-16-code-map-archive.md`.

**Written deviations from the spec (the spec is the authority; each has its reason):**
1. **`importPack` / `exportPack` take no path from the renderer.** §7 writes `importPack(path)` / `exportPack(to)`; the H3/H4 rows say no path ever crosses IPC (the renderer is the least-trusted side). Main opens the dialog itself (H4 `claude-import.js` precedent); env `HQ_PACK_IMPORT=<abs folder or .zip>` / `HQ_PACK_EXPORT=<abs .zip>` replace the dialogs for gates and second instances only (H4 `HQ_CLAUDE_IMPORT_ZIP` precedent).
2. **`importPack` is two calls: `importPack({})` → a plan (counts, names, clashes; writes nothing), `importPack({planId})` → writes.** Reason: §6.3 "copied into the Prompts folder after a confirm" — the owner must see what will be copied before anything is written, and the confirm must refer to exactly the scanned files (a plan id held main-side for 10 minutes), not to a path the renderer re-sends. A name that already exists is skipped and counted (`skipped.exists`), never renamed — §6.1's "`-2` after a confirm" is a per-note Promote step; a pack's one confirm covers "copy the new ones".
3. **`run` answers more than `{ok, turnId?}`:** `{ok:true, target, title, turnId?, sessionId?, seeded?, usage:'recorded'|'not recorded: <reason>', dry?}`. Reason: honesty — a read-only Hub (second instance) cannot write `prompt_use`; the run still happened, and the owner is told the count did not move instead of a silent miss. Additive to §7.
4. **The body is read from the note file on disk, not from the Hub.** Reason: the vault is the source of truth (§6.1) and the Hub's copy is masked and may lag a just-saved edit; P1's `findPromptFile` already re-derives the file from the id with containment. The renderer never sends prompt text.
5. **`{{cwd}}` and `{{project}}` are filled main-side from `projectId`** (an HQ project id from the picker) via `getProjects` (`studioProjects`); the renderer never sends or receives a path. The chat turn row in the renderer shows `Prompt · <title>`, not the filled text (it may carry a path).
6. **Usage refresh is renderer-driven.** `prompt_use` writes do not emit the Hub's `changed` event (it means "chats/documents moved"); after a successful run the store re-asks `promptStats` through P1's `refreshPrompts`.
7. **Pack notes are masked before they are written** (`maskSecrets`), like promoted prompts (§2 "promoted prompts are written masked"). Reason: a pack comes from outside the vault; the import report says how many masks were applied.
8. **`promptStats` and its IPC landed in P1** (P1 deviation 3); P3 only adds the writer `promptUse` and the Library's refresh. **No `SCHEMA_VERSION` or `INDEX_VERSION` bump** — `prompt_use` exists since H6 schema 2.
9. **A Terminal run refuses a filled prompt over 500 characters.** Reason: the existing `launchClaudeTerminal` (spec: "the existing launchClaudeTerminal") passes the seed on one `cmd` line and silently cuts it at its `PROMPT_MAX = 500` (newlines flattened); a silent cut would run a different prompt than the note while counting it as a run (honesty). The answer names Chat / the copy targets instead.
10. **Pack notes without frontmatter are given a minimal one** (`title`, `tags: [imported]`) and CRLF is normalized to LF before writing. Reason: P1 `writePromptNote` accepts only text that starts with `---\n` (a §6.1 note); plain `.md` files are what most packs hold.

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

Phase-local facts and STOP checks (run before Task 1; any miss = STOP, the earlier phase has not landed):
- `grep -n "SCHEMA_VERSION =" dashboard/claude-hub/store.mjs` prints `2` (H6). **P3 changes no schema and no index shape.**
- `grep -n "prompt_use" dashboard/claude-hub/store.mjs` prints the H6 DDL and P1's `promptStats` query.
- `grep -n "claude-prompts').init" dashboard/main.js` prints exactly one line (P1).
- `grep -n "async promote" dashboard/claude-prompts.js` prints one line (P2).
- `grep -n "RUN_LATER" dashboard-v5/src/logic/prompts.js` prints the P1 placeholder (P3 Task 9 replaces it).
- `grep -rn "\brn[A-Z]" dashboard-v5/src/vals/ dashboard-v5/src/logic/` prints nothing (the `rn` prefix is free; P1 took `pr*`, P2 `hc*`, H6 `cd*`/`di*`).
- `dashboard/main.js` lines touched by this phase (anchor by text, never by number — H6/P1 shifted them): (a) the H3 line containing `require('./claude-chat').init(` gains the prefix `const claudeChatEngine = `; (b) P1's line containing `require('./claude-prompts').init(` gains the arguments `hub`, `chat`, `getProjects`, `launch`, `clipboard`, `dialog`, `getWin`. No line is added or removed.
- The owner's real vault has no `40_Resources/Prompts` folder today; Export pack on a missing folder answers "No prompts folder yet — nothing to export"; Import pack creates it (P1 `resolvePromptsDir(…, {create:true})`).

## Review Focus

1. **A chat run whose streamed answer never appears.** Main sends the turn, but the renderer only renders turns it registered through `sendClaudeChat`; events for an unknown `turnId` wait in `pendingChat`. The owner expects the composer area of Claude › Chats to show the run streaming and its Stop button to work. Pinned in Task 8 test `adoptClaudeTurn registers the run's turn and replays events that arrived first` and Task 10 CDP `prompts-run-chat`.
2. **A variable value or a note body that tries to escape:** a value holding `{{cwd}}` (must not be re-expanded), a 10 000-char value, a variable name the body does not use, a missing value, a body with `{{project}}` but no project picked. The owner expects exactly one substitution pass, a refusal that names the missing fields, and nothing sent. Pinned in Task 2 test `fillVariables: one pass, reserved names, missing and unknown listed, caps`.
3. **Something other than the two fixed URLs opened, or a copy target touching the owner's clipboard during a gate.** A target string like `'https://evil.example'`, `'claude.ai '`, `'CHAT'`, or `HQ_DRY_LAUNCH=1`. The owner expects only `https://claude.ai/new` / `https://chatgpt.com/` (literal constants), a refusal for every other target, and in dry mode a `[dry-copy]` log line with nothing written to the clipboard or opened. Pinned in Task 4 test `run target whitelist: only four targets; only the two literal URLs; dry mode writes no clipboard`.
4. **Usage counts that lie:** a run counted when the send failed, a failed run counted, a read-only Hub silently dropping the row, a usage row with a forged prompt id or target. The owner expects one `prompt_use` row per successful run only, `usage: 'not recorded: …'` when the Hub cannot write, and the Hub refusing malformed rows. Pinned in Task 3 test `promptUse validates and writes one row; readers refuse` and Task 4 test `usage is recorded only after the target succeeded; a reader hub says not recorded`.
5. **A pack that overwrites or escapes:** a ZIP with `../../evil.md`, `sub/dir/a.md`, a name equal to an existing note, a 30 MB entry, a non-`.md` file, a junction folder; an export to an existing `.zip`. The owner expects existing notes untouched (`skipped.exists`), traversal names reduced to a contained slug, oversize/non-md entries skipped with the reason, and an export that refuses an existing target. Pinned in Task 6 tests `importPack never overwrites and never escapes` and `exportPack streams a readable ZIP and never overwrites`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `docs/sync/IPC-CONTRACT.md` | modify (append P3 section before `## Rules`) | Rows `claudePrompts.run`, `claudePrompts.importPack`, `claudePrompts.exportPack`; Hub op `promptUse` (protocol note); `claudeHub.promptStats` now moves |
| `docs/sync/CONTRACT.md` | modify (amend the H6 `data/claude/` schema-2 paragraph and the P1 prompt-note entry) | `prompt_use` written from P3 (one row per successful run); pack import writes new notes only |
| `dashboard/claude-prompt-note.js` (+ `claude-prompt-note.test.mjs`) | modify | `bodyOf(src)`, `RESERVED_VARS`, `VALUE_MAX`, `fillVariables(body, vars, ctx)` |
| `dashboard/claude-hub/store.mjs` (+ `store.test.mjs`) | modify | `PROMPT_TARGETS`, `addPromptUse(row)` |
| `dashboard/claude-hub/hub.mjs` (+ `hub.test.mjs`) | modify | writer op `promptUse` (serialized) |
| `dashboard/claude-prompts.js` (+ `claude-prompts.test.mjs`) | modify | `RUN_TARGETS`, `OPEN_URLS`, `createPrompts(...).run(req, {sender})`; `init` registers `run`, `import-pack`, `export-pack` |
| `dashboard/claude-prompt-pack.js` (+ `claude-prompt-pack.test.mjs`) | create | `crc32`, `writeZip(file, entries)` (streaming, `wx`), `createPacks({...}) -> {importPack, exportPack}` |
| `dashboard/main.js` | modify (2 lines, see Phase-local facts) | capture the chat engine; pass deps to the prompts init |
| `dashboard/preload.js` | modify | `claudePrompts.run`, `.importPack`, `.exportPack` |
| `dashboard-v5/tools/fake-preload.js` | modify | SPEC rows for the 3 methods (`run` with target chat streams like `claudeChat.send`) |
| `dashboard-v5/src/live/adapter.mjs` (+ `adapter.test.mjs`) | modify | `RUN_TARGETS_UI`, `runView`, `packView` |
| `dashboard-v5/src/live/store.js` (+ `store.test.mjs`) | modify | `adoptClaudeTurn`, `runPrompt`, `packImport`, `packExport` |
| `dashboard-v5/src/logic/run.js` (+ `run.test.mjs`) | create | `runLogic` mixin: `rnOpen, rnClose, rnSetProject, rnSetVar, rnSetTarget, rnSetMode, rnGo, rnPackImport, rnPackConfirm, rnPackCancel, rnPackExport` |
| `dashboard-v5/src/logic/prompts.js` (+ `prompts.test.mjs`) | modify | `prRun(id)` opens the run modal (`RUN_LATER` removed) |
| `dashboard-v5/src/app.js` | modify | import + `Object.assign` `runLogic`; `initState` gains `run: null`, `pack: null`; `closeTop` ladder |
| `dashboard-v5/src/vals/run.js` + `vals/index.js` | create / modify | `runVals` (keys `rn*`) appended to `SURFACES` |
| `dashboard-v5/src/tpl/extras.tpl.js` | modify | run modal + pack confirm dialog (`<!-- v5: -->` marked) |
| `dashboard-v5/src/tpl/claude.tpl.js` | modify | Import pack / Export pack buttons in the P1 Library header |
| `dashboard-v5/src/tpl.hash.test.mjs`, `src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json` | modify | re-record + new `claude.run-*`, `claude.pack-*` scenarios, attributed |
| `dashboard-v5/src/selftest.js` | modify | `run-*`, `pack-*` STATES rows; `CLEAR` gains `run`, `pack` |
| `dashboard-v5/tools/cdp-gate.mjs` | modify | `prompts-run-chat`, `prompts-run-copy`, `prompts-pack-import` |
| `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | modify | docs + handoff (last task) |

---

### Task 1: Contract rows first (IPC-CONTRACT P3 section + CONTRACT amendments)

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (new section directly before `## Rules`, after the P2 section)
- Modify: `docs/sync/CONTRACT.md` (two dated additive sentences)

**Interfaces:**
- Consumes: the P1 and P2 IPC sections (`grep -n "phase P2 (rows written" docs/sync/IPC-CONTRACT.md` prints one line; if not, STOP).
- Produces: the names every later task uses, exactly: Hub op `promptUse({promptId, target, projectId?, conversationId?})`; store `addPromptUse({promptId, at, target, projectId, conversationId})`, `PROMPT_TARGETS`; preload `claudePrompts.run(req)`, `claudePrompts.importPack(req?)`, `claudePrompts.exportPack()`; channels `hq:claude-prompts:run`, `hq:claude-prompts:import-pack`, `hq:claude-prompts:export-pack`; targets `'chat'|'terminal'|'claude.ai'|'chatgpt'`; env `HQ_PACK_IMPORT`, `HQ_PACK_EXPORT`.

- [ ] **Step 1: Write the IPC-CONTRACT section.** Insert verbatim before `## Rules`:

````markdown
## 2026-10-25 — Prompt library, phase P3 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.3, §6.4, §7. Handlers are registered inside P1's
`dashboard/claude-prompts.js` `init` (pack work in the NEW file `dashboard/claude-prompt-pack.js`). `main.js`: the H3 line
`require('./claude-chat').init(` now keeps its result (`const claudeChatEngine = …`) and P1's `claude-prompts` init line
passes `hub, chat, getProjects, launch, clipboard, dialog, getWin`; no line added. No path or prompt text is sent by the renderer.

| Preload | Channel | Shape |
|---|---|---|
| `claudePrompts.run(req)` | `hq:claude-prompts:run` (invoke) | `req = {promptId:'prompt:<40 hex>', target:'chat'\|'terminal'\|'claude.ai'\|'chatgpt', projectId?:<HQ project id>, vars?:{name:string}, mode?:'read-only'\|'edits'}` (`mode` only for `chat`, default `read-only`; other fields ignored). Main reads the note from `<vault>/40_Resources/Prompts/` (P1 `findPromptFile`, contained), strips the frontmatter, fills `{{project}}` (project name) and `{{cwd}}` (project path) from `projectId` and every other `{{name}}` from `vars` in ONE pass (values ≤ 4 000 chars, never re-expanded). `chat` → the H3 engine's `send({projectId, text, mode}, {alive})` bound to the asking window exactly like `hq:claude-chat:send` (needs a project); `terminal` → `launchClaudeTerminal(<project path>, text)` (needs a project; a filled prompt over 500 characters — claude-launch.js `PROMPT_MAX`, one command line — is refused with the reason, never cut); `claude.ai` / `chatgpt` → `clipboard.writeText(text)` then `shell.openExternal` of the literal `https://claude.ai/new` / `https://chatgpt.com/`. → `{ok:true, target, title, turnId?, sessionId?, seeded?, usage:'recorded'\|'not recorded: <reason>', dry?:true}` \| `{error}` \| `{error, missing:[name]}` (fields to fill; nothing sent). After the target succeeded, and only then, one Hub `promptUse` row is written; a read-only or stopped Hub does not fail the run (`usage` says why). `HQ_DRY_LAUNCH=1`: copy targets log `[dry-copy] <target> <chars> chars` and write/open nothing; terminal: claude-launch.js's existing `[dry-launch] <cwd> :: <prompt>` stdout line (dry mode only — gates and second instances run fixture text). The app log (`[prompts] run …`) carries target, prompt file name and counts, never prompt text. Never throws |
| `claudePrompts.importPack(req?)` | `hq:claude-prompts:import-pack` (invoke) | step 1 `importPack({from?:'zip'\|'folder'})` (default `'zip'`; Windows dialogs pick a file OR a folder, not both): main opens a `.zip` file dialog or a folder dialog (env **`HQ_PACK_IMPORT=<abs folder\|.zip>`** replaces it — gates only), scans top-level `.md` files (a folder) or every `.md` entry (a ZIP, ≤ 50 MB, entries ≤ 200 000 bytes, ≤ 200 notes) and answers `{planId, source:<basename>, notes:[{name, title, exists}], total, skipped:{notMd, tooBig, tooMany, duplicate, unreadable}}` \| `{canceled:true}` \| `{error}` — writes nothing. Step 2 `importPack({planId})` (a plan id is random, held main-side, used once, ≤ 10 min): writes every note whose name is free, masked (`maskSecrets`; a note without frontmatter gets `title` + `tags: [imported]`, CRLF → LF), atomically, never overwriting → `{imported, masked, skipped:{exists, failed}}` \| `{error}`. Names = `slugify(<entry base name>) + '.md'`; no entry path is used. Never throws |
| `claudePrompts.exportPack()` | `hq:claude-prompts:export-pack` (invoke) | main opens a save dialog (`.zip`; env **`HQ_PACK_EXPORT=<abs .zip>`** replaces it) and streams a ZIP of the top-level `*.md` notes of the Prompts folder, one entry at a time, opened with `wx` (an existing file is refused, never replaced) → `{file:<basename>, notes}` \| `{canceled:true}` \| `{error}` ("No prompts folder yet — nothing to export"). Never throws |
| `claudeHub.promptStats()` (P1) | `hq:claude-hub:prompt-stats` | unchanged shape; from P3 on the counts move (one `prompt_use` row per successful run). The renderer re-asks after each run (the Hub's `changed` event does not fire for usage) |

Hub op (protocol, not IPC; main-only, the renderer cannot write usage): `promptUse({promptId, target, projectId?, conversationId?})` →
`true`; writer only (a reader throws `read-only hub (another WorkspaceHQ owns the index)`); `promptId` must match `prompt:<40 hex>`,
`target` one of the four, `projectId`/`conversationId` strings ≤ 200 or absent; `at` is the Hub's clock (ISO).
````

- [ ] **Step 2: Amend CONTRACT.md.** Append to the H6 `data/claude/` schema-2 paragraph (after its last sentence):

```markdown
(2026-10-25, P3, additive) `prompt_use` is now written: one row `{prompt_id, at, target, project_id, conversation_id:null}` per
successful prompt run (`chat` | `terminal` | `claude.ai` | `chatgpt`), by the Hub op `promptUse` only. No schema or index change.
```

and to the P1 `40_Resources/Prompts/<slug>.md` entry:

```markdown
(2026-10-25, P3) Import pack also writes here: new notes only (an existing name is skipped and counted), names `slugify(<entry
base name>).md`, bodies masked, a note without frontmatter given `title` + `tags: [imported]`, atomic through `writePromptNote`. Export pack only reads the folder.
```

- [ ] **Step 3: Check the rows.**

Run (Git Bash): `sed -n '/phase P3 (rows written/,/^## Rules/p' docs/sync/IPC-CONTRACT.md | grep -c '^| .claude'`
Expected: `4`

- [ ] **Step 4: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: P3 prompt library — IPC-CONTRACT rows (claudePrompts.run/importPack/exportPack, Hub op promptUse) and CONTRACT prompt_use/pack amendments, before any handler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure fill — `bodyOf`, `fillVariables` in `dashboard/claude-prompt-note.js`

**Files:**
- Modify: `dashboard/claude-prompt-note.js` (new constants + 2 functions; extend `module.exports`)
- Test: `dashboard/claude-prompt-note.test.mjs` (append; it already imports `test`, `assert`, `note` and H6 `parseFrontmatter`)

**Interfaces:**
- Consumes: P1 `VAR_RE` (`/\{\{\s*([A-Za-z_][A-Za-z0-9_-]{0,39})\s*\}\}/g`), `variablesOf(meta, body)`; H6 `parseFrontmatter(src) -> {data, body, has}` (test parity only).
- Produces:
  - `RESERVED_VARS = ['project', 'cwd']`; `VALUE_MAX = 4000`; `FILLED_MAX = 100000` (= H3 `PROMPT_MAX`).
  - `bodyOf(src) -> string` — the note without its leading YAML frontmatter block (same block rule as H6 `parseFrontmatter`; a leading BOM is dropped first).
  - `fillVariables(body, vars, {project, cwd}) -> {text, missing:[name], unknown:[name]} | {error}` — ONE pass over `VAR_RE`; `{{project}}`/`{{cwd}}` come only from the context (a `vars.project`/`vars.cwd` is ignored and listed in `unknown`); other names from `vars` (own string properties, trimmed-empty = missing); values are never re-scanned; `unknown` = names in `vars` the body does not use (ignored, reported); `missing` non-empty → `text` is `''`; a value over `VALUE_MAX` or a filled text over `FILLED_MAX` → `{error}`.

- [ ] **Step 1: Write the failing tests.** Append:

```js
// ---- P3 run fill (spec 2026-10-15 §6.1 variables, §6.4 run). Placeholder text only.
const { bodyOf, fillVariables, RESERVED_VARS, VALUE_MAX, FILLED_MAX } = note;

test('bodyOf strips exactly the frontmatter block H6 parseFrontmatter strips', () => {
  const cases = [
    '---\ntitle: "A"\nvariables: [file]\n---\nReview {{file}}.\n',
    '---\r\ntitle: A\r\n---\r\nBody {{x}}\r\n',
    '# no frontmatter\n',
    '---\ntitle: never closed\n',
    '---\n---\nEmpty block body',
  ];
  for (const c of cases) assert.equal(bodyOf(c), parseFrontmatter(c).body, JSON.stringify(c));
  assert.equal(bodyOf('\uFEFF---\ntitle: A\n---\nBOM body'), 'BOM body');
  assert.equal(bodyOf(null), '');
});

test('fillVariables: one pass, reserved names, missing and unknown listed, caps', () => {
  assert.deepEqual(RESERVED_VARS, ['project', 'cwd']);
  const ctx = { project: 'Placeholder project', cwd: 'C:\\placeholder\\proj' };
  // happy path, spacing inside braces, a name used twice
  assert.deepEqual(fillVariables('Review {{ file }} in {{project}} at {{cwd}}; again {{file}}.', { file: 'a.js' }, ctx),
    { text: 'Review a.js in Placeholder project at C:\\placeholder\\proj; again a.js.', missing: [], unknown: [] });
  // a value that looks like a variable is NOT re-expanded
  assert.equal(fillVariables('X={{a}} Y={{b}}', { a: '{{b}}', b: '{{cwd}}' }, ctx).text, 'X={{b}} Y={{cwd}}');
  // project/cwd only from the context; vars.project is ignored and reported
  const r = fillVariables('In {{project}}', { project: 'evil', extra: 'x' }, ctx);
  assert.equal(r.text, 'In Placeholder project'); assert.deepEqual(r.unknown, ['project', 'extra']);
  // missing: no value, empty value, and project/cwd without a picked project
  const m = fillVariables('{{file}} {{line}} {{project}} {{cwd}}', { file: '  ' }, {});
  assert.deepEqual(m, { text: '', missing: ['file', 'line', 'project', 'cwd'], unknown: [] });
  // junk vars object, non-string values
  assert.deepEqual(fillVariables('{{a}}', null, ctx).missing, ['a']);
  assert.deepEqual(fillVariables('{{a}}', { a: 7 }, ctx).missing, ['a']);
  assert.deepEqual(fillVariables('{{a}}', Object.create({ a: 'inherited' }), ctx).missing, ['a']);
  // caps
  assert.match(fillVariables('{{a}}', { a: 'x'.repeat(VALUE_MAX + 1) }, ctx).error, /over 4 000 characters/);
  assert.equal(fillVariables('{{a}}{{a}}', { a: 'x'.repeat(VALUE_MAX) }, ctx).text.length, 2 * VALUE_MAX, 'a value at the cap is fine');
  assert.match(fillVariables('y'.repeat(FILLED_MAX) + '{{a}}', { a: 'z' }, ctx).error, /over 100 000 characters/);
  // no variables at all
  assert.deepEqual(fillVariables('Plain placeholder prompt', {}, {}), { text: 'Plain placeholder prompt', missing: [], unknown: [] });
});
```

- [ ] **Step 2: Run to see it fail.**

Run: `node --test dashboard/claude-prompt-note.test.mjs`
Expected: FAIL — `bodyOf is not a function` (destructured `undefined`).

- [ ] **Step 3: Implement.** In `dashboard/claude-prompt-note.js`, before `module.exports`, add:

```js
// ---- P3 run fill (spec 2026-10-15 §6.1, §6.4). {{project}} and {{cwd}} come only from the project main resolved.
const RESERVED_VARS = ['project', 'cwd'];
const VALUE_MAX = 4000;
const FILLED_MAX = 100000;   // = the H3 chat engine's PROMPT_MAX
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;   // the H6 parseFrontmatter block rule

function bodyOf(src) {
  const s = String(src == null ? '' : src).replace(/^\uFEFF/, '');
  const m = FM_RE.exec(s);
  return m ? s.slice(m[0].length) : s;
}

function fillVariables(body, vars, ctx) {
  const b = String(body == null ? '' : body);
  const v = vars && typeof vars === 'object' && !Array.isArray(vars) ? vars : {};
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const own = (k) => Object.prototype.hasOwnProperty.call(v, k);
  const valueOf = (name) => {
    if (RESERVED_VARS.includes(name)) return typeof c[name] === 'string' && c[name].trim() ? c[name] : null;
    return own(name) && typeof v[name] === 'string' && v[name].trim() ? v[name] : null;
  };
  const used = [], missing = [];
  for (const m of b.matchAll(VAR_RE)) {
    const name = m[1];
    if (used.includes(name)) continue;
    used.push(name);
    const val = valueOf(name);
    if (val == null) missing.push(name);
    else if (val.length > VALUE_MAX) return { error: `the value for {{${name}}} is over 4 000 characters` };
  }
  const unknown = Object.keys(v).filter((k) => RESERVED_VARS.includes(k) || !used.includes(k));
  if (missing.length) return { text: '', missing, unknown };
  const text = b.replace(VAR_RE, (_all, name) => valueOf(name));   // one pass: replacement text is never re-scanned
  if (text.length > FILLED_MAX) return { error: 'the filled prompt is over 100 000 characters' };
  return { text, missing: [], unknown };
}
```

and extend the exports to `{ PROMPTS_REL, SLUG_MAX, VARS_MAX, VAR_RE, slugify, noteName, variablesOf, promptNoteText, promptDocId, RESERVED_VARS, VALUE_MAX, FILLED_MAX, bodyOf, fillVariables }` (keep every name P1/P2 exported; add the five). `VAR_RE` is a `g` regex: `matchAll` and `replace` both reset it, so no `lastIndex` state leaks.

- [ ] **Step 4: Run to see it pass.**

Run: `node --test dashboard/claude-prompt-note.test.mjs`
Expected: PASS (all P1 tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompt-note.js dashboard/claude-prompt-note.test.mjs
git commit -m "fe: P3.2 — prompt note: bodyOf (H6 frontmatter rule) + fillVariables (one pass, project/cwd from context only, missing/unknown listed, caps)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hub — `store.addPromptUse` + writer op `promptUse` (no schema change)

**Files:**
- Modify: `dashboard/claude-hub/store.mjs` (export `PROMPT_TARGETS`; api gains `addPromptUse`)
- Modify: `dashboard/claude-hub/store.test.mjs` (append)
- Modify: `dashboard/claude-hub/hub.mjs` (`const ops` gains `promptUse`; validation lives in the store)
- Modify: `dashboard/claude-hub/hub.test.mjs` (append)

**Interfaces:**
- Consumes: H6 table `prompt_use(prompt_id TEXT NOT NULL, at TEXT NOT NULL, target TEXT NOT NULL, project_id TEXT, conversation_id TEXT)` + index `prompt_use_prompt`; P1 `store.promptStats() -> [{prompt_id, uses, last_at}]`; hub.mjs `serial(fn)`, `notOwner()`, `writer`, `store`; hub.test.mjs `startHub(env, db)` (`{req, until, events, healthy, stop}`), `tmp(prefix)`, `makeClaudeHome(dir)`.
- Produces:
  - `export const PROMPT_TARGETS = ['chat', 'terminal', 'claude.ai', 'chatgpt'];`
  - `store.addPromptUse({promptId, at, target, projectId = null, conversationId = null}) -> true` — throws `promptUse: <reason>` on a bad row (id not `prompt:<40 hex>`, unknown target, `at` not an ISO time, `projectId`/`conversationId` not a string ≤ 200 or null).
  - Hub op `promptUse({promptId, target, projectId?, conversationId?}) -> Promise<true>` — writer only (`notOwner()`), no open store → `the index is not open yet`; `at = new Date().toISOString()` (the Hub's clock); queued through `serial` like every write. No `changed` event (deviation 6).

- [ ] **Step 1: Write the failing store test.** Append to `dashboard/claude-hub/store.test.mjs` (it imports `openStore`; add `PROMPT_TARGETS` to that import):

```js
test('P3: addPromptUse validates and writes one row per call; promptStats counts them', () => {
  const s = openStore(':memory:');
  const A = 'prompt:' + 'a'.repeat(40), B = 'prompt:' + 'b'.repeat(40);
  assert.deepEqual(PROMPT_TARGETS, ['chat', 'terminal', 'claude.ai', 'chatgpt']);
  assert.equal(s.addPromptUse({ promptId: A, at: '2026-10-25T09:00:00.000Z', target: 'chat', projectId: 'project-a' }), true);
  s.addPromptUse({ promptId: A, at: '2026-10-25T10:00:00.000Z', target: 'claude.ai' });
  s.addPromptUse({ promptId: B, at: '2026-10-24T08:00:00.000Z', target: 'terminal', projectId: 'project-b', conversationId: null });
  assert.deepEqual(s.promptStats(), [
    { prompt_id: A, uses: 2, last_at: '2026-10-25T10:00:00.000Z' },
    { prompt_id: B, uses: 1, last_at: '2026-10-24T08:00:00.000Z' },
  ]);
  const row = s.db.prepare("SELECT * FROM prompt_use WHERE target = 'chat'").get();
  assert.equal(row.project_id, 'project-a'); assert.equal(row.conversation_id, null);
  const bad = [
    { promptId: 'memory:' + 'a'.repeat(40), at: '2026-10-25T09:00:00Z', target: 'chat' },
    { promptId: 'prompt:' + 'A'.repeat(40), at: '2026-10-25T09:00:00Z', target: 'chat' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'https://evil.example' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'CHAT' },
    { promptId: A, at: 'yesterday', target: 'chat' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'chat', projectId: 'x'.repeat(201) },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'chat', conversationId: 42 },
  ];
  for (const b of bad) assert.throws(() => s.addPromptUse(b), /^Error: promptUse: /, JSON.stringify(b));
  assert.throws(() => s.addPromptUse(null), /promptUse: /);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS c FROM prompt_use').get().c, 3, 'a refused row writes nothing');
});
```

- [ ] **Step 2: Write the failing Hub test.** Append to `dashboard/claude-hub/hub.test.mjs`:

```js
test('P3: promptUse writes one row (writer, Hub clock); readers refuse; promptStats moves', async () => {
  const dir = tmp('hub-p3-');
  const { home } = makeClaudeHome(dir);
  const env = { HQ_CLAUDE_HOME: home, HQ_VAULT_DIR: path.join(dir, 'vault') };
  const db = path.join(dir, 'hub.sqlite');
  const A = 'prompt:' + 'c'.repeat(40);
  const a = startHub(env, db);
  try {
    await a.healthy();
    const t0 = Date.now();
    const w = await a.req('promptUse', { promptId: A, target: 'terminal', projectId: 'project-a' });
    assert.equal(w.ok, true, w.error); assert.equal(w.result, true);
    const st = (await a.req('promptStats')).result;
    assert.equal(st.length, 1); assert.equal(st[0].prompt_id, A); assert.equal(st[0].uses, 1);
    assert.ok(Date.parse(st[0].last_at) >= t0 - 1000, 'at is the Hub clock, not a caller value');
    const junk = await a.req('promptUse', { promptId: A, target: 'https://evil.example' });
    assert.equal(junk.ok, false); assert.match(junk.error, /promptUse: /);
    assert.equal((await a.req('promptStats')).result[0].uses, 1);
    assert.equal(a.events.filter((e) => e.event === 'changed' && JSON.stringify(e.data).includes(A)).length, 0, 'usage is not a changed event');
    const b = startHub(env, db);
    try {
      assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready')));
      const r = await b.req('promptUse', { promptId: A, target: 'chat' });
      assert.equal(r.ok, false); assert.match(r.error, /read-only hub/);
      assert.equal((await b.req('promptStats')).result[0].uses, 1, 'readers may read the count');
    } finally { await b.stop(); }
  } finally { await a.stop(); }
});
```

- [ ] **Step 3: Run to see them fail.**

Run: `node --test dashboard/claude-hub/store.test.mjs dashboard/claude-hub/hub.test.mjs`
Expected: FAIL — `PROMPT_TARGETS` is not exported (SyntaxError on import); after adding only the export: `s.addPromptUse is not a function`; Hub: `unknown op`.

- [ ] **Step 4: Implement the store.** In `dashboard/claude-hub/store.mjs` after `SCHEMA_VERSION` (keep it `2`):

```js
// P3 (spec 2026-10-15 §4, §6.4): prompt_use targets — the only four ways a prompt is run.
export const PROMPT_TARGETS = ['chat', 'terminal', 'claude.ai', 'chatgpt'];
const PROMPT_ID_RE = /^prompt:[0-9a-f]{40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const optId = (v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 200);
```

and in the object returned by `api(db)`, next to P1's `promptStats`:

```js
    addPromptUse(row) {
      const r = row && typeof row === 'object' ? row : {};
      const bad = (why) => { throw new Error('promptUse: ' + why); };
      if (typeof r.promptId !== 'string' || !PROMPT_ID_RE.test(r.promptId)) bad('not a prompt id');
      if (!PROMPT_TARGETS.includes(r.target)) bad('unknown target');
      if (typeof r.at !== 'string' || !ISO_RE.test(r.at) || Number.isNaN(Date.parse(r.at))) bad('at must be an ISO time');
      if (!optId(r.projectId) || !optId(r.conversationId)) bad('project/conversation ids must be short strings');
      db.prepare('INSERT INTO prompt_use(prompt_id, at, target, project_id, conversation_id) VALUES (?, ?, ?, ?, ?)')
        .run(r.promptId, r.at, r.target, n(r.projectId), n(r.conversationId));
      return true;
    },
```

(`n(v)` is the store's existing undefined→null helper.)

- [ ] **Step 5: Implement the op.** In `dashboard/claude-hub/hub.mjs` `const ops`, after P1's `promptStats`:

```js
    // P3: one usage row per successful prompt run (main only — no IPC channel reaches it). Writer + queue, like forget.
    promptUse: (a) => {
      if (!writer) notOwner();
      if (!store) throw new Error('the index is not open yet');
      const r = a && typeof a === 'object' ? a : {};
      const row = { promptId: r.promptId, target: r.target, projectId: r.projectId, conversationId: r.conversationId, at: new Date().toISOString() };
      return serial(() => store.addPromptUse(row));
    },
```

- [ ] **Step 6: Run to see them pass.**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS (all Hub suites; the H6 migration test still sees `SCHEMA_VERSION` 2).

- [ ] **Step 7: Commit**

```bash
git add dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: P3.3 — Hub: prompt_use writer (store.addPromptUse validates id/target/at; op promptUse writer-only, queued, Hub clock); no schema change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Main — `run` for Terminal / Copy for claude.ai / Copy for ChatGPT, usage after success (`dashboard/claude-prompts.js`)

**Files:**
- Modify: `dashboard/claude-prompts.js` (requires, `RUN_TARGETS`, `RUN_MODES`, `OPEN_URLS`, `titleOf`, `createPrompts(...)` gains deps + `run`; exports)
- Test: `dashboard/claude-prompts.test.mjs` (append; it already imports `test`, `assert`, `fs`, `os`, `path`, `prompts`, `note`)

**Interfaces:**
- Consumes: Task 2 `bodyOf`, `fillVariables`; P1 `PROMPTS_REL`, `promptDocId(file)`, `NOTE_TEXT_MAX`, `resolvePromptsDir(vaultDir)`, `findPromptFile(vaultDir, realDir, id) -> {name, file}|null`, the private `same(a, b)` path compare and `why(e)` inside `createPrompts`; P2 `createPrompts({vaultDir, openExternal, openPath, protocolName, env, log, now})`; Task 3 Hub op `promptUse` reached as `hub.request('promptUse', args, {timeout}) -> true|{error}` (claude-hub-host `request` never rejects); `claude-launch.js` `launchClaudeTerminal(cwd, prompt) -> bool` (honours `HQ_DRY_LAUNCH`); main's `studioProjects() -> [{id, name, path}]`.
- Produces:
  - `RUN_TARGETS = ['chat', 'terminal', 'claude.ai', 'chatgpt']`, `RUN_MODES = ['read-only', 'edits']`, `OPEN_URLS = Object.freeze({'claude.ai': 'https://claude.ai/new', chatgpt: 'https://chatgpt.com/'})`, `titleOf(src, fileName) -> string`.
  - `createPrompts({…, hub = null, chat = null, getProjects = () => [], launch = () => false, clipboard = null, watch = () => () => {}, turnPollMs = 5000})` gains `run(req, {sender} = {}) -> Promise<{ok:true, target, title, usage, dry?, turnId?, sessionId?, seeded?}|{error}|{error, missing}>` — never throws. (Task 5 fills the `chat` branch; in this task `chat` answers `{error: 'the chat engine is not running'}` when `chat` is null.)

- [ ] **Step 1: Write the failing tests.** Append to `dashboard/claude-prompts.test.mjs`:

```js
// ---- P3 run (spec 2026-10-15 §6.3, §6.4, §2 external links). Temp vaults only; placeholder text only.
function p3Vault(body = 'Review {{file}} in {{project}} at {{cwd}}.') {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p3-vault-'));
  const dir = path.join(v, '40_Resources', 'Prompts'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'review-a-pr.md');
  fs.writeFileSync(file, ['---', 'title: "Review a PR: placeholder"', 'variables: [file]', '---', body, ''].join('\n'));
  return { v, dir, file, id: note.promptDocId(file) };
}
const P3_PROJ = (root) => [{ id: 'project-a', name: 'Placeholder project', path: root }];
function p3Make(vaultDir, o = {}) {
  const logs = [], ext = [], clip = [], launches = [], uses = [];
  const hub = { request: async (op, args) => { uses.push([op, args]); return o.hubAnswer !== undefined ? o.hubAnswer : true; } };
  const p = prompts.createPrompts({ vaultDir, env: o.env || {}, log: (s) => logs.push(s), now: () => new Date('2026-10-25T10:00:00Z'),
    openExternal: async (u) => { if (o.openFails) throw new Error('no browser'); ext.push(u); }, openPath: async () => '', protocolName: () => '',
    hub: o.noHub ? null : hub, getProjects: () => P3_PROJ(o.projRoot || vaultDir),
    launch: (cwd, text) => { launches.push([cwd, text]); return o.launchOk !== false; },
    clipboard: { writeText: (t) => clip.push(t) }, ...(o.extra || {}) });
  return { p, logs, ext, clip, launches, uses };
}

test('run target whitelist: only four targets; only the two literal URLs; dry mode writes no clipboard', async () => {
  const fx = p3Vault();
  const m = p3Make(fx.v);
  for (const target of ['https://evil.example', 'claude.ai ', 'CHAT', 'obsidian', '', null, 42])
    assert.match((await m.p.run({ promptId: fx.id, target, vars: { file: 'a.js' }, projectId: 'project-a' })).error, /runs only in Chat, a Terminal/);
  const a = await m.p.run({ promptId: fx.id, target: 'claude.ai', vars: { file: 'a.js' }, projectId: 'project-a', url: 'https://evil.example' });
  assert.equal(a.ok, true); assert.equal(a.target, 'claude.ai'); assert.equal(a.title, 'Review a PR: placeholder');
  const b = await m.p.run({ promptId: fx.id, target: 'chatgpt', vars: { file: 'b.js' }, projectId: 'project-a' });
  assert.equal(b.ok, true);
  assert.deepEqual(m.ext, ['https://claude.ai/new', 'https://chatgpt.com/'], 'only the literal constants are ever opened');
  assert.deepEqual(m.clip, [`Review a.js in Placeholder project at ${fx.v}.`, `Review b.js in Placeholder project at ${fx.v}.`]);
  assert.ok(Object.isFrozen(prompts.OPEN_URLS));
  // dry mode: nothing copied, nothing opened, a log line without the text
  const d = p3Make(fx.v, { env: { HQ_DRY_LAUNCH: '1' } });
  const r = await d.p.run({ promptId: fx.id, target: 'chatgpt', vars: { file: 'secret-ish.js' }, projectId: 'project-a' });
  assert.equal(r.ok, true); assert.equal(r.dry, true);
  assert.deepEqual(d.clip, []); assert.deepEqual(d.ext, []);
  assert.ok(d.logs.some((l) => /^\[dry-copy\] chatgpt \d+ chars$/.test(l)), d.logs.join('\n'));
  assert.ok(!d.logs.join('\n').includes('secret-ish'), 'logs never carry prompt text');
});

test('usage is recorded only after the target succeeded; a reader hub says not recorded', async () => {
  const fx = p3Vault();
  const ok = p3Make(fx.v);
  const r = await ok.p.run({ promptId: fx.id, target: 'terminal', vars: { file: 'a.js' }, projectId: 'project-a' });
  assert.equal(r.ok, true); assert.equal(r.usage, 'recorded');
  assert.deepEqual(ok.launches, [[fx.v, `Review a.js in Placeholder project at ${fx.v}.`]]);
  assert.deepEqual(ok.uses, [['promptUse', { promptId: fx.id, target: 'terminal', projectId: 'project-a' }]]);
  // failed targets write no usage
  const noTerm = p3Make(fx.v, { launchOk: false });
  assert.match((await noTerm.p.run({ promptId: fx.id, target: 'terminal', vars: { file: 'a' }, projectId: 'project-a' })).error, /terminal did not start/);
  const noBrowser = p3Make(fx.v, { openFails: true });
  assert.match((await noBrowser.p.run({ promptId: fx.id, target: 'claude.ai', vars: { file: 'a' }, projectId: 'project-a' })).error, /copied, but the browser did not open/);
  assert.deepEqual([...noTerm.uses, ...noBrowser.uses], []);
  // the launcher cuts at 500 chars on one line — a longer filled prompt is refused, never silently cut
  const long = await ok.p.run({ promptId: fx.id, target: 'terminal', vars: { file: 'f'.repeat(600) }, projectId: 'project-a' });
  assert.match(long.error, /a Terminal run takes at most 500/);
  assert.equal(ok.launches.length, 1, 'nothing launched for the long prompt'); assert.equal(ok.uses.length, 1);
  // a reader / stopped hub never fails the run, and says so
  const reader = p3Make(fx.v, { hubAnswer: { error: 'read-only hub (another WorkspaceHQ owns the index)' } });
  const rr = await reader.p.run({ promptId: fx.id, target: 'claude.ai', vars: { file: 'a' }, projectId: 'project-a' });
  assert.equal(rr.ok, true); assert.equal(rr.usage, 'not recorded: read-only hub (another WorkspaceHQ owns the index)');
  const none = p3Make(fx.v, { noHub: true });
  assert.equal((await none.p.run({ promptId: fx.id, target: 'claude.ai', vars: { file: 'a' }, projectId: 'project-a' })).usage, 'not recorded: Claude Hub is not running');
});

test('run refuses unknown notes, missing fields and missing projects before anything is sent', async () => {
  const fx = p3Vault();
  const m = p3Make(fx.v);
  const base = { promptId: fx.id, target: 'claude.ai', vars: { file: 'a.js' }, projectId: 'project-a' };
  assert.match((await m.p.run({ ...base, promptId: 'prompt:' + 'f'.repeat(40) })).error, /not in the Prompts folder/);
  assert.match((await m.p.run({ ...base, promptId: '..\\..\\x' })).error, /not in the Prompts folder/);
  const miss = await m.p.run({ ...base, vars: {} });
  assert.deepEqual(miss.missing, ['file']); assert.match(miss.error, /fill in \{\{file\}\}/);
  assert.deepEqual((await m.p.run({ ...base, projectId: undefined })).missing, ['project', 'cwd']);
  assert.match((await m.p.run({ ...base, projectId: 'nope' })).error, /unknown project/);
  assert.match((await m.p.run({ ...base, target: 'terminal', projectId: undefined, vars: { file: 'a' } })).error, /pick a project/);
  assert.match((await m.p.run({ ...base, vars: { file: 'x'.repeat(4001) } })).error, /over 4 000 characters/);
  assert.match((await p3Make(path.join(fx.v, 'missing')).p.run(base)).error, /No prompts folder yet|vault folder was not found/);
  assert.deepEqual([m.clip, m.ext, m.launches, m.uses], [[], [], [], []], 'nothing was sent');
  // a body without variables needs no project for the copy targets
  const plain = p3Vault('Plain placeholder prompt.');
  const pm = p3Make(plain.v);
  assert.equal((await pm.p.run({ promptId: plain.id, target: 'chatgpt' })).ok, true);
  assert.deepEqual(pm.uses[0][1], { promptId: plain.id, target: 'chatgpt', projectId: null });
  // the title falls back to the file name
  assert.equal(prompts.titleOf('no frontmatter', 'weekly-notes.md'), 'weekly-notes');
  assert.equal(prompts.titleOf("---\ntitle: 'Quoted'\n---\nx", 'a.md'), 'Quoted');
});
```

- [ ] **Step 2: Run to see it fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `m.p.run is not a function`; `prompts.OPEN_URLS` undefined.

- [ ] **Step 3: Implement.** In `dashboard/claude-prompts.js`: extend the `claude-prompt-note` destructure with `bodyOf, fillVariables`; add `const { PROMPT_MAX: LAUNCH_MAX } = require('./claude-launch');` (pure Node, no Electron require; `PROMPT_MAX = 500` at claude-launch.js:34); add before `createPrompts`:

```js
// ---- P3 run (spec 2026-10-15 §6.3, §6.4). The only URLs a run ever opens are these two literals (spec §2).
const RUN_TARGETS = ['chat', 'terminal', 'claude.ai', 'chatgpt'];
const RUN_MODES = ['read-only', 'edits'];
const OPEN_URLS = Object.freeze({ 'claude.ai': 'https://claude.ai/new', chatgpt: 'https://chatgpt.com/' });

function titleOf(src, fileName) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(src == null ? '' : src).replace(/^\uFEFF/, ''));
  const t = m && /^title:[ \t]*(.+)$/m.exec(m[1]);
  let s = t ? t[1].trim() : '';
  if (/^".*"$/.test(s)) { try { s = JSON.parse(s); } catch { s = s.slice(1, -1); } } else if (/^'.*'$/.test(s)) s = s.slice(1, -1);
  return (String(s).trim() || String(fileName).replace(/\.md$/i, '')).slice(0, 200);
}
```

Change the `createPrompts` parameter list to `({ vaultDir, openExternal, openPath, protocolName, env = {}, log = () => {}, now = () => new Date(), hub = null, chat = null, getProjects = () => [], launch = () => false, clipboard = null, watch = () => () => {}, turnPollMs = 5000 })` (keep P2's `now`), and add inside it, before `return {`:

```js
  async function recordUse(promptId, target, projectId) {
    if (!hub || typeof hub.request !== 'function') return 'not recorded: Claude Hub is not running';
    try {
      const u = await hub.request('promptUse', { promptId, target, projectId: projectId || null }, { timeout: 5000 });
      return u === true ? 'recorded' : 'not recorded: ' + String((u && u.error) || 'no answer from the Hub').slice(0, 200);
    } catch (e) { return 'not recorded: ' + why(e); }
  }
  async function loadPrompt(id) {
    const realDir = await resolvePromptsDir(vaultDir);
    if (!realDir) return { error: `No prompts folder yet — create ${vaultName}/${PROMPTS_REL.join('/')}` };
    const hit = findPromptFile(vaultDir, realDir, id);
    if (!hit) return { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' };
    const real = await fsp.realpath(hit.file);
    if (!same(path.dirname(real), realDir)) return { error: 'that note leads outside the Prompts folder — refusing' };
    const st = await fsp.stat(real);
    if (st.size > NOTE_TEXT_MAX * 4) return { error: 'that prompt note is too large to run' };
    const src = await fsp.readFile(real, 'utf8');
    return { name: hit.name, src, title: titleOf(src, hit.name) };
  }
```

and add the method to the returned object (after P2's `promote`):

```js
    async run(req, { sender = null } = {}) {
      try {
        const r = req && typeof req === 'object' && !Array.isArray(req) ? req : {};
        const target = r.target;
        if (typeof target !== 'string' || !RUN_TARGETS.includes(target)) return { error: 'a prompt runs only in Chat, a Terminal, or as a copy for claude.ai / ChatGPT' };
        const mode = r.mode === undefined || r.mode === null ? 'read-only' : r.mode;
        if (target === 'chat' && !RUN_MODES.includes(mode)) return { error: 'unknown chat mode (read-only or edits)' };
        const note = await loadPrompt(r.promptId);
        if (note.error) return note;
        let proj = null;
        if (r.projectId !== undefined && r.projectId !== null) {
          proj = (getProjects() || []).find((p) => p && p.id === r.projectId) || null;
          if (!proj) return { error: 'unknown project — pick one from the list' };
        }
        if ((target === 'chat' || target === 'terminal') && !proj) return { error: 'pick a project — a Chat or Terminal run starts in its folder' };
        const f = fillVariables(bodyOf(note.src), r.vars, proj ? { project: proj.name, cwd: proj.path } : {});
        if (f.error) return { error: f.error };
        if (f.missing.length) return { error: 'fill in ' + f.missing.map((n) => '{{' + n + '}}').join(', '), missing: f.missing };
        if (!f.text.trim()) return { error: 'that prompt note has no text' };
        const out = { ok: true, target, title: note.title };
        if (target === 'chat') {
          const sent = await sendChat({ projectId: proj.id, text: f.text, mode }, sender);
          if (sent.error) return { error: sent.error };
          Object.assign(out, sent);
        } else if (target === 'terminal') {
          // claude-launch.js passes the seed on ONE cmd line: it flattens newlines and cuts at its PROMPT_MAX (500).
          // A silent cut would run a different prompt than the note — refuse instead and say where it fits.
          if (f.text.length > LAUNCH_MAX) return { error: `this prompt is ${f.text.length} characters — a Terminal run takes at most ${LAUNCH_MAX} (one command line); use Chat or a copy target` };
          if (!launch(proj.path, f.text)) return { error: 'the terminal did not start (folder gone, or the Claude launcher is missing)' };
          if (dry()) out.dry = true;
        } else if (dry()) {
          log(`[dry-copy] ${target} ${f.text.length} chars`);
          out.dry = true;
        } else {
          if (!clipboard || typeof clipboard.writeText !== 'function') return { error: 'no clipboard in this window' };
          clipboard.writeText(f.text);
          try { await openExternal(OPEN_URLS[target]); } catch (e) { return { error: 'copied, but the browser did not open: ' + why(e) }; }
        }
        out.usage = await recordUse(r.promptId, target, proj ? proj.id : null);
        log(`[prompts] run ${target} ${note.name} ${f.text.length} chars, usage ${out.usage === 'recorded' ? 'recorded' : 'not recorded'}`);
        return out;
      } catch (e) { return { error: why(e) }; }
    },
```

with this helper (also before `return {`) — the chat branch is completed in Task 5:

```js
  async function sendChat(req, sender) {   // Task 5 binds the turn to the asking window
    if (!chat || typeof chat.send !== 'function') return { error: 'the chat engine is not running' };
    return { error: 'chat runs land in the next step' };
  }
```

Extend the exports with `RUN_TARGETS, RUN_MODES, OPEN_URLS, titleOf`. (`dry`, `why`, `same`, `vaultName` are P1's names inside `createPrompts`/the module; reuse them, do not redefine.)

- [ ] **Step 4: Run to see it pass.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: PASS (P1, P2 and the 3 new P3 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs
git commit -m "fe: P3.4 — claudePrompts.run (main): body from the contained note on disk, one-pass fill, Terminal + Copy for claude.ai/ChatGPT (two literal URLs, dry-copy), usage recorded only after success

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Main — Chat runs through the H3 engine (window-bound), IPC `run`, the two main.js lines, preload + fake parity

**Files:**
- Modify: `dashboard/claude-prompts.js` (`sendChat`, `init` deps + `run` handler)
- Modify: `dashboard/claude-prompts.test.mjs` (append)
- Modify: `dashboard/main.js` (2 lines — see Phase-local facts)
- Modify: `dashboard/preload.js` (`claudePrompts.run`)
- Modify: `dashboard-v5/tools/fake-preload.js` (`promptRun` + SPEC row)

**Interfaces:**
- Consumes: H3 `dashboard/claude-chat.js` exports `watchSender(sender, onGone) -> detach` and the engine object returned by `init` (= `createChat` result: `send(req, {alive}) -> Promise<{turnId, sessionId?, seeded?}|{error}>`, `cancel(turnId) -> bool`, `has(turnId) -> bool`); Task 4 `createPrompts` deps `chat`, `watch`, `turnPollMs` and the `sendChat` stub; fake-preload `chatTurn(req)` (streams `session`/`delta`/`tool`/`done` on `hq:claude-chat:event`), `FAKE_PROMPTS` (P1).
- Produces:
  - `sendChat({projectId, text, mode}, sender) -> Promise<{turnId, sessionId?, seeded?}|{error}>` — exactly the H3 `hq:claude-chat:send` handler's binding: `watch(sender, onGone)` before the send, `alive: () => !gone`, cancel on reload, listeners detached when `chat.has(turnId)` turns false (polled every `turnPollMs`, timer `unref`'d).
  - `init({ipcMain, app, shell, vaultDir, env, log, hub, chat, getProjects, launch, clipboard, dialog, getWin})` registers `hq:claude-prompts:run` → `p.run(req, {sender: e.sender})` (non-object `req` → `{}`); `dialog`, `getWin` are used by Task 7.
  - Preload `hq.claudePrompts.run(req)`. Fake `claudePrompts.run` (chat target streams through the same `chatTurn`).
  - main.js: `const claudeChatEngine = require('./claude-chat').init({ … unchanged … });` and P1's prompts line with the new deps.

- [ ] **Step 1: Write the failing test.** Append to `dashboard/claude-prompts.test.mjs`:

```js
test('chat runs go through the H3 engine bound to the asking window; modes are read-only or edits only', async () => {
  const { EventEmitter } = await import('node:events');
  const { watchSender } = (await import('./claude-chat.js')).default;
  const fx = p3Vault();
  const sent = [], live = new Set(), cancelled = [];
  let next = 0, answer = null;
  const chat = {
    send: async (req, { alive }) => { sent.push([req, alive()]); if (answer) return answer; const id = 't' + (++next); live.add(id); return { turnId: id }; },
    has: (id) => live.has(id), cancel: (id) => { cancelled.push(id); return live.delete(id); },
  };
  const sender = new EventEmitter(); sender.isDestroyed = () => false;
  const m = p3Make(fx.v, { extra: { chat, watch: watchSender, turnPollMs: 20 } });
  const run = (o) => m.p.run({ promptId: fx.id, target: 'chat', vars: { file: 'a.js' }, projectId: 'project-a', ...o }, { sender });
  const r = await run({ conversationId: 'code:forged', cwd: 'C:\\Windows' });
  assert.deepEqual(r, { ok: true, target: 'chat', title: 'Review a PR: placeholder', turnId: 't1', usage: 'recorded' });
  assert.deepEqual(sent[0], [{ projectId: 'project-a', text: `Review a.js in Placeholder project at ${fx.v}.`, mode: 'read-only' }, true],
    'only projectId/text/mode reach the engine — no conversation, cwd or argument from the renderer');
  assert.equal(sender.listenerCount('did-start-navigation'), 1);
  sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });   // the window reloads mid-turn
  assert.deepEqual(cancelled, ['t1'], 'the turn dies with the window, exactly like hq:claude-chat:send');
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(sender.listenerCount('did-start-navigation'), 0, 'listeners detach once the turn ended');
  assert.equal((await run({ mode: 'edits' })).ok, true); assert.equal(sent[1][0].mode, 'edits');
  for (const mode of ['bypassPermissions', 'plan', 'acceptEdits', 'EDITS'])
    assert.match((await run({ mode })).error, /unknown chat mode/);
  assert.match((await run({ projectId: undefined })).error, /pick a project/);
  answer = { error: '3 turns in total' };
  const busy = await run({});
  assert.deepEqual(busy, { error: '3 turns in total' }, 'engine refusals surface verbatim');
  assert.equal(m.uses.length, 2, 'usage only for the two turns that started');
  assert.match((await p3Make(fx.v).p.run({ promptId: fx.id, target: 'chat', vars: { file: 'a' }, projectId: 'project-a' })).error, /chat engine is not running/);
});

test('init registers hq:claude-prompts:run with the asking window as sender', async () => {
  const fx = p3Vault();
  const handlers = new Map();
  prompts.init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, app: { getApplicationNameForProtocol: () => '' },
    shell: { openExternal: async () => {}, openPath: async () => '' }, vaultDir: fx.v, env: { HQ_DRY_LAUNCH: '1' }, log: () => {},
    hub: { request: async () => true }, getProjects: () => P3_PROJ(fx.v), clipboard: { writeText: () => { throw new Error('dry mode must not copy'); } } });
  assert.ok(handlers.has('hq:claude-prompts:run'));
  const r = await handlers.get('hq:claude-prompts:run')({ sender: null }, { promptId: fx.id, target: 'claude.ai', vars: { file: 'a' }, projectId: 'project-a' });
  assert.equal(r.ok, true); assert.equal(r.dry, true); assert.equal(r.usage, 'recorded');
  assert.match((await handlers.get('hq:claude-prompts:run')({}, 'junk')).error, /runs only in Chat/);
});
```

- [ ] **Step 2: Run to see it fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `chat runs land in the next step`; no handler `hq:claude-prompts:run`.

- [ ] **Step 3: Implement `sendChat`.** Replace the Task 4 stub in `dashboard/claude-prompts.js`:

```js
  // Same binding as the H3 hq:claude-chat:send handler (claude-chat.js init): the turn belongs to the window that asked;
  // a reload/crash/close of that window stops it. The engine itself is untouched (read-only default, no bypass flag).
  async function sendChat(req, sender) {
    if (!chat || typeof chat.send !== 'function') return { error: 'the chat engine is not running' };
    let gone = false, turnId = null;
    const detach = watch(sender, () => { gone = true; if (turnId) chat.cancel(turnId); });
    let out;
    try { out = await chat.send({ projectId: req.projectId, text: req.text, mode: req.mode }, { alive: () => !gone }); }
    catch (e) { detach(); return { error: why(e) }; }
    if (!out || typeof out !== 'object' || out.error || typeof out.turnId !== 'string') { detach(); return { error: String((out && out.error) || 'the chat engine did not start a turn') }; }
    if (chat.has(out.turnId)) {
      turnId = out.turnId;
      if (gone) chat.cancel(turnId);
      const t = setInterval(() => { if (!chat.has(turnId)) { clearInterval(t); detach(); } }, turnPollMs);
      if (t.unref) t.unref();
    } else detach();
    const res = { turnId: out.turnId };
    if (out.sessionId) res.sessionId = out.sessionId;
    if (out.seeded) res.seeded = out.seeded;
    return res;
  }
```

- [ ] **Step 4: Extend `init`.** Add `const { watchSender } = require('./claude-chat');` to the requires and change P1's `init` to:

```js
function init({ ipcMain, app, shell, vaultDir, env = process.env, log = console.log, hub = null, chat = null, getProjects = () => [],
  launch = () => false, clipboard = null, dialog = null, getWin = () => null }) {
  const p = createPrompts({ vaultDir: env.HQ_VAULT_DIR || vaultDir, env, log,
    openExternal: (u) => shell.openExternal(u), openPath: (f) => shell.openPath(f),
    protocolName: (u) => (app && app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : ''),
    hub, chat, getProjects, launch, clipboard, watch: watchSender });
  ipcMain.handle('hq:claude-prompts:status', () => p.status());
  ipcMain.handle('hq:claude-prompts:open', (_e, id, how) => p.open(typeof id === 'string' && id.length <= 300 ? id : '', how));
  ipcMain.handle('hq:claude-prompts:promote', (_e, req) => p.promote(req && typeof req === 'object' && !Array.isArray(req) ? req : {}));
  ipcMain.handle('hq:claude-prompts:run', (e, req) => p.run(req && typeof req === 'object' && !Array.isArray(req) ? req : {}, { sender: e && e.sender }));   // P3
  return p;
}
```

(the `status`/`open`/`promote` lines are P1/P2's, unchanged; `dialog`, `getWin` are wired in Task 7).

- [ ] **Step 5: main.js (the two lines).** Find each by text:
  - `grep -n "require('./claude-chat').init(" dashboard/main.js` → prefix that line's statement with `const claudeChatEngine = ` (the rest of the line, including its comment, unchanged).
  - `grep -n "require('./claude-prompts').init(" dashboard/main.js` → replace the call's argument object so the line reads:

```js
    require('./claude-prompts').init({ ipcMain, app, shell, vaultDir: VAULT, hub: claudeHub, chat: claudeChatEngine, getProjects: studioProjects, launch: launchClaudeTerminal, clipboard: require('electron').clipboard, dialog, getWin: () => win });   // Prompt library P1–P3 (spec 2026-10-15 §6.4): status, open, promote, run, packs
```

`dialog`, `shell`, `app` are destructured at main.js:10; `launchClaudeTerminal` is required at main.js:20; `studioProjects`, `claudeHub`, `DATA`, `win` exist (the H4 import line uses `getWin: () => win`). Check: `node -e "require('node:child_process')"` is irrelevant — instead run `node --check dashboard/main.js` (expected: no output, exit 0).

- [ ] **Step 6: Preload + fake.** In `dashboard/preload.js` inside the `claudePrompts` block add `    run: (req) => ipcRenderer.invoke('hq:claude-prompts:run', req),   // P3: main reads + fills the note; chat streams on hq:claude-chat:event`. In `dashboard-v5/tools/fake-preload.js`, after `cancelTurn`:

```js
  // Prompt library P3 — like main's claudePrompts.run: whitelist, missing fields, chat streams through the same fake turn.
  const promptRun = (req) => {
    const r = req && typeof req === 'object' ? req : {};
    if (!['chat', 'terminal', 'claude.ai', 'chatgpt'].includes(r.target)) return { error: 'a prompt runs only in Chat, a Terminal, or as a copy for claude.ai / ChatGPT' };
    const row = FAKE_PROMPTS.find((p) => p.id === r.promptId);
    if (!row) return { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' };
    const own = row.variables.filter((v) => v !== 'project' && v !== 'cwd');
    const missing = [...own.filter((v) => !(r.vars && typeof r.vars[v] === 'string' && r.vars[v].trim())),
      ...(r.projectId ? [] : row.variables.filter((v) => v === 'project' || v === 'cwd'))];
    if (missing.length) return { error: 'fill in ' + missing.map((n) => '{{' + n + '}}').join(', '), missing };
    if ((r.target === 'chat' || r.target === 'terminal') && !r.projectId) return { error: 'pick a project — a Chat or Terminal run starts in its folder' };
    const base = { ok: true, target: r.target, title: row.title, usage: 'recorded' };
    if (r.target !== 'chat') return base;
    const t = chatTurn({ text: 'Prompt · ' + row.title, mode: r.mode });
    return t.error ? t : { ...base, ...t };
  };
```

and the SPEC row `['claudePrompts.run', promptRun],` next to P1's `claudePrompts.open`.

- [ ] **Step 7: Run to see it pass.**

Run: `node --test dashboard/claude-prompts.test.mjs dashboard/claude-chat.test.mjs dashboard-v5/tools/fake-preload.test.mjs && node --check dashboard/main.js`
Expected: PASS (fake-parity sees `claudePrompts.run` on both sides; H3 chat tests unchanged).

- [ ] **Step 8: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs dashboard/main.js dashboard/preload.js dashboard-v5/tools/fake-preload.js
git commit -m "fe: P3.5 — Chat runs through the H3 engine bound to the asking window (watchSender, read-only default); IPC hq:claude-prompts:run; main.js: keep the chat engine + pass run deps to the prompts init (2 lines); preload + fake parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Packs — `dashboard/claude-prompt-pack.js` (streaming ZIP writer, `importPack` plan → confirm, `exportPack`)

**Files:**
- Create: `dashboard/claude-prompt-pack.js`
- Create: `dashboard/claude-prompt-pack.test.mjs`

**Interfaces:**
- Consumes: P1 `claude-prompts.js` `resolvePromptsDir(vaultDir, {create})` (throws when the vault folder is missing; `null` when the Prompts folder is), `writePromptNote(vaultDir, {name, text}) -> {path, name}|{error}|{error, exists:true, next}`; Task 4 `titleOf(src, fileName)`; P1 `slugify(title)`; Hub ESM modules reached with `import(pathToFileURL(…).href)` (P2 pattern): `claude-hub/unzip.mjs` `readZipIndex(file) -> {size, entries:[{name, method, crc, csize, usize, offset, encrypted}]}` (it does NOT use `zlib.crc32`, so it runs on Electron 32's Node 20) and `claude-hub/redact.mjs` `maskSecrets(s) -> {text, hits}`. The Hub's `extractEntries` is NOT used in main: it calls `zlib.crc32`, which Electron 32's Node 20 lacks — this module carries its own table CRC-32. Test-only: `claude-hub/__fixtures__/make-export.mjs` `zipFiles(file, files)`.
- Produces:
  - `PACK_ZIP_MAX = 50 * 1024 * 1024`, `PACK_NOTE_MAX = 200000` (bytes), `PACK_NOTES_MAX = 200`, `PLAN_TTL_MS = 10 * 60 * 1000`.
  - `crc32(buf, crc = 0) -> uint32`; `writeZip(file, entries:[{name, file}]) -> Promise<void>` — one entry read, deflated and written at a time into `<file>.partial-<hex>` opened `wx`, then hard-linked to `file` (fails if `file` exists — never replaces) and the partial removed; any failure removes the partial.
  - `readEntry(zipFile, entry, max) -> Promise<Buffer>` (stored/deflate, `maxOutputLength`, size + CRC checked).
  - `createPacks({vaultDir, pick, save, env, log, now}) -> {importPack(req), exportPack()}` — `pick(from:'zip'|'folder') -> Promise<abs path|null>`, `save(defaultName) -> Promise<abs .zip|null>`; answers exactly the IPC-CONTRACT shapes of Task 1 (`importPack({from})` → plan; `importPack({planId})` → `{imported, masked, skipped:{exists, failed}}`; `exportPack()` → `{file, notes}`); never throws.

- [ ] **Step 1: Write the failing tests.** Create `dashboard/claude-prompt-pack.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import pack from './claude-prompt-pack.js';
import { zipFiles } from './claude-hub/__fixtures__/make-export.mjs';
import { readZipIndex } from './claude-hub/unzip.mjs';

// Placeholder text only; the secret is built at runtime. Temp folders only — never the owner's vault.
const SECRET = () => 'gh' + 'p_' + 'B'.repeat(36);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function vaultWithNote() {
  const v = tmp('hq-pack-vault-');
  const dir = path.join(v, '40_Resources', 'Prompts'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review-a-pr.md'), '---\ntitle: "Review a PR"\n---\nOwner text, untouched.\n');
  return { v, dir };
}
function make(vaultDir, o = {}) {
  const logs = [];
  const p = pack.createPacks({ vaultDir, env: {}, log: (s) => logs.push(s), now: o.now || (() => Date.now()),
    pick: async () => (o.pick === undefined ? null : o.pick), save: async () => (o.save === undefined ? null : o.save) });
  return { p, logs };
}
const listAll = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();

test('crc32 matches zlib.crc32 (Electron 32 main has no zlib.crc32)', () => {
  for (const s of ['', 'a', 'Placeholder prompt text', 'é🚀'.repeat(100)]) assert.equal(pack.crc32(Buffer.from(s)), zlib.crc32(Buffer.from(s)), s);
  const big = Buffer.alloc(70000, 7); assert.equal(pack.crc32(big), zlib.crc32(big));
});

test('exportPack streams a readable ZIP and never overwrites', async () => {
  const { v, dir } = vaultWithNote();
  fs.writeFileSync(path.join(dir, 'standup.md'), '---\ntitle: Standup\n---\nPlaceholder standup {{day}}\n');
  fs.mkdirSync(path.join(dir, 'sub')); fs.writeFileSync(path.join(dir, 'sub', 'nested.md'), 'not exported');
  fs.writeFileSync(path.join(dir, 'image.png'), 'not a note');
  const out = path.join(tmp('hq-pack-out-'), 'pack.zip');
  const r = await make(v, { save: out }).p.exportPack();
  assert.deepEqual(r, { file: 'pack.zip', notes: 2 });
  const { entries } = await readZipIndex(out);
  assert.deepEqual(entries.map((e) => e.name), ['review-a-pr.md', 'standup.md']);
  const back = await pack.readEntry(out, entries[1], pack.PACK_NOTE_MAX);
  assert.equal(back.toString('utf8'), fs.readFileSync(path.join(dir, 'standup.md'), 'utf8'));
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['pack.zip'], 'no partial file left');
  const before = fs.readFileSync(out);
  assert.match((await make(v, { save: out }).p.exportPack()).error, /already there .*nothing is ever replaced/);
  assert.deepEqual(fs.readFileSync(out), before);
  assert.deepEqual(await make(v, { save: null }).p.exportPack(), { canceled: true });
  assert.match((await make(v, { save: path.join(path.dirname(out), 'x.txt') }).p.exportPack()).error, /pick a \.zip/);
  assert.match((await make(tmp('hq-pack-empty-'), { save: out + '2.zip' }).p.exportPack()).error, /No prompts folder yet — nothing to export/);
});

test('importPack never overwrites and never escapes (ZIP): plan first, then one confirm', async () => {
  const { v, dir } = vaultWithNote();
  const src = tmp('hq-pack-src-');
  const zip = path.join(src, 'placeholder-pack.zip');
  zipFiles(zip, [
    { name: '../../evil.md', data: '---\ntitle: Evil\n---\nPlaceholder escape attempt' },
    { name: 'sub/dir/Daily Notes.md', data: 'Placeholder daily {{day}} with ' + SECRET() },
    { name: 'review-a-pr.md', data: 'Would overwrite the owner note' },
    { name: 'notes.txt', data: 'not markdown' },
    { name: 'big.md', data: 'x'.repeat(pack.PACK_NOTE_MAX + 1) },
    { name: 'folder/', data: '' },
  ]);
  const { p } = make(v, { pick: zip });
  const plan = await p.importPack({ from: 'zip' });
  assert.match(plan.planId, /^pack-[0-9a-f]{16}$/);
  assert.equal(plan.source, 'placeholder-pack.zip');
  assert.deepEqual(plan.notes, [
    { name: 'evil.md', title: 'Evil', exists: false },
    { name: 'daily-notes.md', title: 'daily-notes', exists: false },
    { name: 'review-a-pr.md', title: 'review-a-pr', exists: true },
  ]);
  assert.equal(plan.total, 3);
  assert.deepEqual(plan.skipped, { notMd: 1, tooBig: 1, tooMany: 0, duplicate: 0, unreadable: 0 });
  assert.deepEqual(listAll(dir), ['review-a-pr.md'], 'the plan writes nothing');
  const done = await p.importPack({ planId: plan.planId });
  assert.deepEqual(done, { imported: 2, masked: 1, skipped: { exists: 1, failed: 0 } });
  assert.deepEqual(listAll(dir), ['daily-notes.md', 'evil.md', 'review-a-pr.md']);
  assert.equal(fs.readFileSync(path.join(dir, 'review-a-pr.md'), 'utf8'), '---\ntitle: "Review a PR"\n---\nOwner text, untouched.\n');
  const daily = fs.readFileSync(path.join(dir, 'daily-notes.md'), 'utf8');
  assert.ok(!daily.includes(SECRET()), 'pack notes are written masked');
  assert.ok(daily.startsWith('---\ntitle: "daily-notes"\ntags: [imported]\n---\nPlaceholder daily {{day}} with '), 'a plain .md gets a minimal frontmatter; the body is kept');
  assert.equal(fs.readFileSync(path.join(dir, 'evil.md'), 'utf8'), '---\ntitle: Evil\n---\nPlaceholder escape attempt', 'a note with frontmatter is copied as is');
  assert.deepEqual(listAll(v), ['40_Resources', '40_Resources\\Prompts', '40_Resources\\Prompts\\daily-notes.md', '40_Resources\\Prompts\\evil.md', '40_Resources\\Prompts\\review-a-pr.md'].map((s) => s.split('\\').join(path.sep)).sort(), 'nothing outside the Prompts folder');
  assert.match((await p.importPack({ planId: plan.planId })).error, /expired — pick the pack again/, 'a plan is used once');
  assert.match((await p.importPack({ planId: 'pack-forged' })).error, /expired/);
  assert.deepEqual(await make(v, { pick: null }).p.importPack({}), { canceled: true });
});

test('importPack: folder = top-level .md only; plans expire; oversize ZIP and too many notes are refused or counted', async () => {
  const { v, dir } = vaultWithNote();
  const src = tmp('hq-pack-folder-');
  fs.writeFileSync(path.join(src, 'One.md'), 'Placeholder one'); fs.writeFileSync(path.join(src, 'one.md.txt'), 'x');
  fs.mkdirSync(path.join(src, 'deep')); fs.writeFileSync(path.join(src, 'deep', 'two.md'), 'Placeholder two');
  let t = 1000;
  const { p } = make(v, { pick: src, now: () => t });
  const plan = await p.importPack({ from: 'folder' });
  assert.deepEqual(plan.notes, [{ name: 'one.md', title: 'one', exists: false }], 'no frontmatter title → the slugged file name');
  assert.equal(plan.skipped.notMd, 1);
  t += pack.PLAN_TTL_MS + 1;
  assert.match((await p.importPack({ planId: plan.planId })).error, /expired/);
  assert.deepEqual(listAll(dir), ['review-a-pr.md']);
  const many = path.join(src, 'many.zip');
  zipFiles(many, Array.from({ length: pack.PACK_NOTES_MAX + 3 }, (_, i) => ({ name: `n${i}.md`, data: 'Placeholder ' + i })));
  const mp = await make(v, { pick: many }).p.importPack({ from: 'zip' });
  assert.equal(mp.total, pack.PACK_NOTES_MAX); assert.equal(mp.skipped.tooMany, 3);
  const dup = path.join(src, 'dup.zip');
  zipFiles(dup, [{ name: 'a/Same.md', data: 'one' }, { name: 'b/same.md', data: 'two' }]);
  assert.equal((await make(v, { pick: dup }).p.importPack({ from: 'zip' })).skipped.duplicate, 1);
  const notZip = path.join(src, 'fake.zip'); fs.writeFileSync(notZip, 'not a zip at all');
  assert.match((await make(v, { pick: notZip }).p.importPack({ from: 'zip' })).error, /not a readable ZIP/);
});
```

- [ ] **Step 2: Run to see it fail.**

Run: `node --test dashboard/claude-prompt-pack.test.mjs`
Expected: FAIL — `Cannot find module './claude-prompt-pack.js'`.

- [ ] **Step 3: Implement.** Create `dashboard/claude-prompt-pack.js`:

```js
'use strict';
// Prompt library P3 (spec 2026-10-15 §6.3 Packs, §6.4 importPack/exportPack): the Prompts folder only; new notes only;
// ZIPs streamed one entry at a time. Electron 32's Node 20 has no zlib.crc32, so the CRC is a table here.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { slugify } = require('./claude-prompt-note');
const { resolvePromptsDir, writePromptNote, titleOf } = require('./claude-prompts');

const PACK_ZIP_MAX = 50 * 1024 * 1024;
const PACK_NOTE_MAX = 200000;
const PACK_NOTES_MAX = 200;
const PLAN_TTL_MS = 10 * 60 * 1000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

async function writeZip(file, entries) {
  const partial = file + '.partial-' + crypto.randomBytes(4).toString('hex');
  const fh = await fsp.open(partial, 'wx');
  let ok = false;
  try {
    const cen = [];
    let off = 0;
    for (const e of entries) {   // one entry in memory at a time
      const name = Buffer.from(e.name, 'utf8'), raw = await fsp.readFile(e.file), body = zlib.deflateRawSync(raw), crc = crc32(raw);
      const loc = Buffer.alloc(30);
      loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(8, 8);
      loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
      await fh.write(Buffer.concat([loc, name, body]));
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
      cen.push(c, name);
      off += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(cen), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    await fh.write(Buffer.concat([cd, end]));
    await fh.close();
    await fsp.link(partial, file);   // EEXIST when a file of that name appeared — never replaced
    ok = true;
  } finally {
    if (!ok) { try { await fh.close(); } catch { /* closed */ } }
    await fsp.rm(partial, { force: true });
  }
}

async function readEntry(zipFile, e, max) {
  if (e.encrypted) throw new Error('encrypted entry');
  if (e.method !== 0 && e.method !== 8) throw new Error('unsupported compression');
  if (e.usize > max || e.csize > max + 1024) throw new Error('entry too big');
  const fh = await fsp.open(zipFile, 'r');
  try {
    const loc = Buffer.alloc(30);
    await fh.read(loc, 0, 30, e.offset);
    if (loc.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
    const start = e.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
    const body = Buffer.alloc(e.csize);
    if (e.csize) await fh.read(body, 0, e.csize, start);
    const raw = e.method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: max }) : body;
    if (raw.length !== e.usize || crc32(raw) !== e.crc) throw new Error('checksum mismatch');
    return raw;
  } finally { await fh.close(); }
}

const hub = (f) => import(pathToFileURL(path.join(__dirname, 'claude-hub', f)).href);

// P1 writePromptNote takes only a §6.1 note (text starting with '---\n'). A plain .md from a pack gets a minimal
// frontmatter (deviation 10); CRLF → LF and a BOM dropped so a '---\r\n' note is recognised too. The body is unchanged.
function asNote(text, title) {
  const s = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.test(s)) return s;
  return '---\ntitle: ' + JSON.stringify(String(title)) + '\ntags: [imported]\n---\n' + s;
}

function createPacks({ vaultDir, pick, save, env = {}, log = () => {}, now = () => Date.now() }) {
  const plans = new Map();
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  const day = () => new Date(now()).toISOString().slice(0, 10);

  async function scan(from, src) {
    const skipped = { notMd: 0, tooBig: 0, tooMany: 0, duplicate: 0, unreadable: 0 };
    const items = [], seen = new Set();
    const add = (base, text) => {
      if (items.length >= PACK_NOTES_MAX) { skipped.tooMany++; return; }
      const name = slugify(base.replace(/\.md$/i, '')) + '.md';
      if (seen.has(name)) { skipped.duplicate++; return; }
      seen.add(name);
      items.push({ name, title: titleOf(text, name), text });
    };
    if (from === 'folder') {
      const ds = fs.readdirSync(src, { withFileTypes: true }).filter((d) => d.isFile()).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const d of ds) {
        if (!/\.md$/i.test(d.name)) { skipped.notMd++; continue; }
        const f = path.join(src, d.name);
        if (fs.statSync(f).size > PACK_NOTE_MAX) { skipped.tooBig++; continue; }
        try { add(d.name, fs.readFileSync(f, 'utf8')); } catch { skipped.unreadable++; }
      }
    } else {
      if (fs.statSync(src).size > PACK_ZIP_MAX) throw new Error('that ZIP is over 50 MB');
      const { readZipIndex } = await hub('unzip.mjs');
      let entries;
      try { ({ entries } = await readZipIndex(src)); } catch (e) { throw new Error('not a readable ZIP (' + why(e) + ')'); }
      for (const e of entries) {
        if (e.name.endsWith('/')) continue;
        const base = e.name.split(/[\\/]/).pop();   // the entry's path is never used — only its base name, slugified
        if (!/\.md$/i.test(base)) { skipped.notMd++; continue; }
        if (e.usize > PACK_NOTE_MAX) { skipped.tooBig++; continue; }
        if (items.length >= PACK_NOTES_MAX) { skipped.tooMany++; continue; }
        try { add(base, (await readEntry(src, e, PACK_NOTE_MAX)).toString('utf8')); } catch { skipped.unreadable++; }
      }
    }
    return { items, skipped };
  }

  async function commit(planId) {
    const plan = typeof planId === 'string' ? plans.get(planId) : null;
    if (plan) plans.delete(planId);   // a plan is used once
    if (!plan || now() - plan.at > PLAN_TTL_MS) return { error: 'that import plan has expired — pick the pack again' };
    const { maskSecrets } = await hub('redact.mjs');
    let imported = 0, masked = 0;
    const skipped = { exists: 0, failed: 0 };
    for (const it of plan.items) {
      const m = maskSecrets(it.text);
      const w = await writePromptNote(vaultDir, { name: it.name, text: asNote(m.text, it.title) });
      if (w && w.exists) skipped.exists++;
      else if (!w || w.error) { skipped.failed++; log('[prompts] pack note not written: ' + it.name + ' — ' + String((w && w.error) || '').slice(0, 120)); }
      else { imported++; masked += Array.isArray(m.hits) ? m.hits.length : Number(m.hits) || 0; }
    }
    log(`[prompts] pack import: ${imported} imported, ${skipped.exists} already there, ${skipped.failed} failed`);
    return { imported, masked, skipped };
  }

  return {
    async importPack(req) {
      try {
        const r = req && typeof req === 'object' && !Array.isArray(req) ? req : {};
        if (r.planId !== undefined) return await commit(r.planId);
        const from = r.from === 'folder' ? 'folder' : 'zip';
        const src = await pick(from);
        if (!src) return { canceled: true };
        if (!path.isAbsolute(src)) return { error: 'pick a folder or a .zip file' };
        if (from === 'zip' && !/\.zip$/i.test(src)) return { error: 'pick a .zip file' };
        const { items, skipped } = await scan(from, src);
        let realDir = null;
        try { realDir = await resolvePromptsDir(vaultDir); } catch (e) { return { error: why(e) }; }
        const notes = items.map((it) => ({ name: it.name, title: it.title, exists: !!realDir && fs.existsSync(path.join(realDir, it.name)) }));
        for (const k of [...plans.keys()]) if (now() - plans.get(k).at > PLAN_TTL_MS) plans.delete(k);
        const planId = 'pack-' + crypto.randomBytes(8).toString('hex');
        plans.set(planId, { at: now(), items });
        log(`[prompts] pack plan: ${items.length} notes from a ${from}`);
        return { planId, source: path.basename(src), notes, total: items.length, skipped };
      } catch (e) { return { error: why(e) }; }
    },
    async exportPack() {
      try {
        const realDir = await resolvePromptsDir(vaultDir);
        if (!realDir) return { error: 'No prompts folder yet — nothing to export' };
        const names = fs.readdirSync(realDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name).sort();
        if (!names.length) return { error: 'The Prompts folder has no notes — nothing to export' };
        const to = await save('prompts-pack-' + day() + '.zip');
        if (!to) return { canceled: true };
        if (!path.isAbsolute(to) || !/\.zip$/i.test(to)) return { error: 'pick a .zip file name' };
        if (fs.existsSync(to)) return { error: 'a file of that name is already there — pick a new name (nothing is ever replaced)' };
        await writeZip(to, names.map((n) => ({ name: n, file: path.join(realDir, n) })));
        log(`[prompts] pack export: ${names.length} notes`);
        return { file: path.basename(to), notes: names.length };
      } catch (e) {
        if (e && e.code === 'EEXIST') return { error: 'a file of that name is already there — pick a new name (nothing is ever replaced)' };
        return { error: why(e) };
      }
    },
  };
}

module.exports = { PACK_ZIP_MAX, PACK_NOTE_MAX, PACK_NOTES_MAX, PLAN_TTL_MS, crc32, writeZip, readEntry, createPacks };
```

Note: the export test's missing-vault case passes a temp folder with no `40_Resources/Prompts` → `resolvePromptsDir` answers `null` → "No prompts folder yet". The `listAll` paths in the ZIP test are built with `path.sep` so the assertion holds on Windows (the only supported OS).

- [ ] **Step 4: Run to see it pass.**

Run: `node --test dashboard/claude-prompt-pack.test.mjs dashboard/claude-prompts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompt-pack.js dashboard/claude-prompt-pack.test.mjs
git commit -m "fe: P3.6 — prompt packs: streaming ZIP writer (table CRC-32, wx partial + hard link, never replaces), importPack plan → one confirm (top-level/base names only, slugified, masked, new notes only), exportPack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pack IPC — dialogs in main (env overrides for gates), `import-pack` / `export-pack` handlers, preload + fake parity

**Files:**
- Modify: `dashboard/claude-prompts.js` (`init` builds `createPacks` with dialog pickers; 2 handlers)
- Modify: `dashboard/claude-prompts.test.mjs` (append)
- Modify: `dashboard/preload.js` (`claudePrompts.importPack`, `.exportPack`)
- Modify: `dashboard-v5/tools/fake-preload.js` (2 SPEC rows)

**Interfaces:**
- Consumes: Task 6 `createPacks({vaultDir, pick, save, env, log})`; Electron `dialog.showOpenDialog([win,] opts) -> {canceled, filePaths}`, `dialog.showSaveDialog([win,] opts) -> {canceled, filePath}`; Task 5 `init` params `dialog`, `getWin`.
- Produces: IPC `hq:claude-prompts:import-pack (req)` (non-object → `{}`), `hq:claude-prompts:export-pack ()`; env `HQ_PACK_IMPORT` / `HQ_PACK_EXPORT` (absolute paths; gates and second instances only) replace the dialogs; preload `hq.claudePrompts.importPack(req)`, `hq.claudePrompts.exportPack()`; fake answers (a 3-note plan with one clash, `{imported:2, masked:0, skipped:{exists:1, failed:0}}`, `{file:'prompts-pack-2026-10-25.zip', notes:2}`).

- [ ] **Step 1: Write the failing test.** Append to `dashboard/claude-prompts.test.mjs`:

```js
test('init: pack handlers use main-side dialogs (window-parented), env overrides for gates, never a renderer path', async () => {
  const fx = p3Vault();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p3-out-')), 'pack.zip');
  const dialogs = [];
  const dialog = {
    showOpenDialog: async (...a) => { dialogs.push(['open', a.length, a.at(-1).properties]); return { canceled: true, filePaths: [] }; },
    showSaveDialog: async (...a) => { dialogs.push(['save', a.length, a.at(-1).defaultPath]); return { canceled: false, filePath: out }; },
  };
  const reg = (env) => { const hs = new Map(); prompts.init({ ipcMain: { handle: (ch, fn) => hs.set(ch, fn) }, app: null, shell: {}, vaultDir: fx.v, env, log: () => {}, dialog, getWin: () => ({ id: 1 }) }); return hs; };
  const hs = reg({});
  assert.deepEqual(await hs.get('hq:claude-prompts:import-pack')({}, { from: 'folder', path: 'C:\\Windows' }), { canceled: true });
  assert.deepEqual(dialogs[0], ['open', 2, ['openDirectory']], 'a folder dialog parented to the window; the renderer path is ignored');
  await hs.get('hq:claude-prompts:import-pack')({}, 'junk');
  assert.deepEqual(dialogs[1], ['open', 2, ['openFile']]);
  const ex = await hs.get('hq:claude-prompts:export-pack')({}, 'C:\\evil.zip');
  assert.deepEqual(ex, { file: 'pack.zip', notes: 1 });
  assert.match(dialogs[2][2], /^prompts-pack-\d{4}-\d{2}-\d{2}\.zip$/);
  // gates: env replaces the dialogs
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p3-src-')); fs.writeFileSync(path.join(src, 'Gate note.md'), 'Placeholder gate note');
  const gate = reg({ HQ_PACK_IMPORT: src, HQ_PACK_EXPORT: out + '.again.zip' });
  const plan = await gate.get('hq:claude-prompts:import-pack')({}, { from: 'folder' });
  assert.deepEqual(plan.notes, [{ name: 'gate-note.md', title: 'gate-note', exists: false }]);
  assert.equal((await gate.get('hq:claude-prompts:import-pack')({}, { planId: plan.planId })).imported, 1);
  assert.deepEqual(await gate.get('hq:claude-prompts:export-pack')({}), { file: 'pack.zip.again.zip', notes: 2 });
  assert.equal(dialogs.length, 3, 'no dialog when the env names the path');
});
```

- [ ] **Step 2: Run to see it fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `hs.get(...)` is not a function (no `hq:claude-prompts:import-pack` handler).

- [ ] **Step 3: Implement.** In `dashboard/claude-prompts.js` `init`, before `return p;`:

```js
  // P3 packs (spec §6.3/§6.4; deviation 1): main picks the path itself — the renderer never sends one.
  const win = () => { try { return getWin ? getWin() : null; } catch { return null; } };
  const ask = (fn, opts) => { const w = win(); return w ? dialog[fn](w, opts) : dialog[fn](opts); };
  const packs = require('./claude-prompt-pack').createPacks({ vaultDir: env.HQ_VAULT_DIR || vaultDir, env, log,
    pick: async (from) => {
      if (env.HQ_PACK_IMPORT) return env.HQ_PACK_IMPORT;   // gates / second instances only
      if (!dialog) return null;
      const r = await ask('showOpenDialog', from === 'folder'
        ? { title: 'Import a folder of prompt notes', properties: ['openDirectory'] }
        : { title: 'Import a prompt pack', properties: ['openFile'], filters: [{ name: 'Prompt pack', extensions: ['zip'] }] });
      return r && !r.canceled && Array.isArray(r.filePaths) && r.filePaths[0] ? r.filePaths[0] : null;
    },
    save: async (name) => {
      if (env.HQ_PACK_EXPORT) return env.HQ_PACK_EXPORT;
      if (!dialog) return null;
      const r = await ask('showSaveDialog', { title: 'Export the prompt pack', defaultPath: name, filters: [{ name: 'Prompt pack', extensions: ['zip'] }] });
      return r && !r.canceled && r.filePath ? r.filePath : null;
    } });
  ipcMain.handle('hq:claude-prompts:import-pack', (_e, req) => packs.importPack(req && typeof req === 'object' && !Array.isArray(req) ? { from: req.from, planId: req.planId } : {}));
  ipcMain.handle('hq:claude-prompts:export-pack', () => packs.exportPack());
```

(`require` inside `init`: `claude-prompt-pack.js` requires this module at its top, so it is loaded only after this module finished loading — no circular-require hole.)

- [ ] **Step 4: Preload + fake.** In `dashboard/preload.js` `claudePrompts` block add:

```js
    importPack: (req) => ipcRenderer.invoke('hq:claude-prompts:import-pack', req),   // P3: {from} → plan (writes nothing); {planId} → writes new notes only
    exportPack: () => ipcRenderer.invoke('hq:claude-prompts:export-pack'),
```

In `dashboard-v5/tools/fake-preload.js` SPEC, after `claudePrompts.run`:

```js
    ['claudePrompts.importPack', (req) => (req && req.planId
      ? { imported: 2, masked: 0, skipped: { exists: 1, failed: 0 } }
      : { planId: 'pack-' + '0'.repeat(16), source: 'placeholder-pack.zip', total: 3, skipped: { notMd: 1, tooBig: 0, tooMany: 0, duplicate: 0, unreadable: 0 },
          notes: [{ name: 'review-a-pr.md', title: 'Review a PR like a staff engineer', exists: true }, { name: 'standup-notes.md', title: 'Standup notes', exists: false }, { name: 'bug-triage.md', title: 'Bug triage', exists: false }] })],
    ['claudePrompts.exportPack', () => ({ file: 'prompts-pack-2026-10-25.zip', notes: 2 })],
```

- [ ] **Step 5: Run to see it pass.**

Run: `node --test dashboard/claude-prompts.test.mjs dashboard/claude-prompt-pack.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: PASS (fake-parity: `claudePrompts.importPack`, `claudePrompts.exportPack` on both sides).

- [ ] **Step 6: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs dashboard/preload.js dashboard-v5/tools/fake-preload.js
git commit -m "fe: P3.7 — pack IPC: main-side folder/.zip/save dialogs (HQ_PACK_IMPORT/HQ_PACK_EXPORT for gates), hq:claude-prompts:import-pack/export-pack; preload + fake parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: v5 data layer — store `adoptClaudeTurn` / `runPrompt` / `packImport` / `packExport`; adapter `runView` / `packView`

**Files:**
- Modify: `dashboard-v5/src/live/store.js` (+ `store.test.mjs`)
- Modify: `dashboard-v5/src/live/adapter.mjs` (+ `adapter.test.mjs`)

**Interfaces:**
- Consumes: store internals `live.claudeChat.turns`, `pendingChat`, `applyChat(e)`, `emit()`, `A.chatTurnNew({turnId, convId, projectId, prompt, mode, sessionId, seeded, now})`, P1 `refreshPrompts()`, P1 `askHq(f)`; preload `claudePrompts.run/importPack/exportPack` (Tasks 5, 7); P1 prompt rows `{id, title, variables}`; store.test.mjs `DATA()` fixture.
- Produces:
  - store `adoptClaudeTurn({turnId, convId?, projectId?, prompt, mode, sessionId?, seeded?}) -> bool` — the post-IPC half of `sendClaudeChat` (which now calls it; behaviour unchanged); `runPrompt(req) -> Promise<result|{error}>` (chat results adopt the turn with prompt `Prompt · <title>`; a `usage:'recorded'` result re-asks `refreshPrompts()`); `packImport(req) -> Promise`, `packExport() -> Promise` (a write of ≥ 1 note re-asks `refreshPrompts()`). All four in the store's returned object.
  - adapter `RUN_TARGETS_UI` (4 rows `{id, label, quota, note}`), `runView(run, {prompt, projects, hasBridge}) -> {title, fields, usesProject, projectNeeded, projects, targets, note, goLabel, canGo, busy, status, showMode, modeEdits}`; `packView(pack) -> {phase, title, rows, newCount, existCount, skippedText, canConfirm, confirmLabel, doneText, error}`.
  - Run state shape (Task 9 holds it in component state): `run = {id, projectId, vars:{}, target:'chat'|'terminal'|'claude.ai'|'chatgpt', mode:'read-only'|'edits', phase:'edit'|'running'|'done'|'error', error, missing:[], result}`; pack state `pack = {phase:'picking'|'plan'|'writing'|'done'|'error', plan, result, error}`.

- [ ] **Step 1: Write the failing adapter tests.** Append to `dashboard-v5/src/live/adapter.test.mjs` (add `runView, packView, RUN_TARGETS_UI` to its adapter import):

```js
test('runView: fields per own variable, project needed for chat/terminal or {{project}}/{{cwd}}, quota labels, honest status', () => {
  const prompt = { id: 'prompt:a', title: 'Review a PR', variables: ['project', 'file', 'line'] };
  const projects = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }];
  const base = { id: 'prompt:a', projectId: null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null };
  const v = runView(base, { prompt, projects, hasBridge: true });
  assert.equal(v.title, 'Review a PR');
  assert.deepEqual(v.fields.map((f) => f.name), ['file', 'line'], '{{project}}/{{cwd}} are never asked — they come from the project');
  assert.equal(v.usesProject, true); assert.equal(v.projectNeeded, true); assert.equal(v.canGo, false);
  assert.deepEqual(RUN_TARGETS_UI.map((t) => t.id), ['chat', 'terminal', 'claude.ai', 'chatgpt']);
  assert.deepEqual(v.targets.map((t) => [t.id, t.selected]), [['chat', true], ['terminal', false], ['claude.ai', false], ['chatgpt', false]]);
  assert.equal(v.goLabel, 'Run in Chat · uses your Claude quota'); assert.equal(v.showMode, true);
  const ready = runView({ ...base, projectId: 'p2', vars: { file: 'a.js', line: '3' } }, { prompt, projects, hasBridge: true });
  assert.equal(ready.canGo, true); assert.deepEqual(ready.projects.map((p) => p.selected), [false, true]);
  assert.equal(runView({ ...base, target: 'terminal' }, { prompt, projects }).goLabel, 'Open a Terminal · uses your Claude quota');
  const cp = runView({ ...base, target: 'claude.ai', vars: { file: 'a', line: '1' } }, { prompt: { ...prompt, variables: ['file', 'line'] }, projects, hasBridge: true });
  assert.equal(cp.projectNeeded, false); assert.equal(cp.canGo, true); assert.equal(cp.showMode, false);
  assert.match(cp.note, /uses your Claude quota/, 'pasting into claude.ai also spends the quota — said, not hidden');
  assert.doesNotMatch(runView({ ...base, target: 'chatgpt' }, { prompt, projects }).note, /Claude quota/);
  assert.equal(runView({ ...base, projectId: 'p1', vars: { file: ' ', line: '1' } }, { prompt, projects, hasBridge: true }).canGo, false, 'blank is missing');
  assert.equal(runView({ ...base, projectId: 'p1', vars: { file: 'a', line: '1' } }, { prompt, projects, hasBridge: false }).canGo, false);
  const miss = runView({ ...base, phase: 'error', error: 'fill in {{line}}', missing: ['line'] }, { prompt, projects });
  assert.deepEqual(miss.fields.map((f) => f.missing), [false, true]); assert.deepEqual(miss.status, { tone: 'error', text: 'fill in {{line}}' });
  assert.deepEqual(runView({ ...base, phase: 'done', result: { ok: true, target: 'chat', usage: 'recorded' } }, { prompt, projects }).status,
    { tone: 'success', text: 'Started in Claude › Chats · counted in the Library' });
  assert.deepEqual(runView({ ...base, target: 'claude.ai', phase: 'done', result: { ok: true, target: 'claude.ai', usage: 'not recorded: read-only hub (another WorkspaceHQ owns the index)' } }, { prompt, projects }).status,
    { tone: 'info', text: 'Copied — paste it in the claude.ai tab that opened · not counted: read-only hub (another WorkspaceHQ owns the index)' });
  assert.match(runView({ ...base, target: 'terminal', phase: 'done', result: { ok: true, target: 'terminal', usage: 'recorded', dry: true } }, { prompt, projects }).status.text, /dry run — nothing was opened/);
  assert.equal(runView({ ...base, phase: 'running' }, { prompt, projects }).busy, true);
  assert.equal(runView(base, { prompt: null, projects }).title, 'Prompt not found', 'a prompt that vanished says so');
});

test('packView: plan rows, counts, skipped reasons, one confirm; done and error texts', () => {
  const plan = { planId: 'pack-x', source: 'p.zip', total: 3, skipped: { notMd: 1, tooBig: 0, tooMany: 2, duplicate: 0, unreadable: 0 },
    notes: [{ name: 'a.md', title: 'A', exists: true }, { name: 'b.md', title: 'B', exists: false }, { name: 'c.md', title: 'C', exists: false }] };
  const v = packView({ phase: 'plan', plan });
  assert.equal(v.title, 'Import 2 new prompt notes from p.zip?');
  assert.deepEqual(v.rows.map((r) => [r.name, r.tag]), [['a.md', 'already there — kept'], ['b.md', 'new'], ['c.md', 'new']]);
  assert.equal(v.newCount, 2); assert.equal(v.existCount, 1);
  assert.equal(v.skippedText, 'Skipped: 1 not a .md file · 2 over the 200-note limit');
  assert.equal(v.canConfirm, true); assert.equal(v.confirmLabel, 'Copy 2 notes into Prompts');
  const none = packView({ phase: 'plan', plan: { ...plan, notes: [plan.notes[0]], total: 1 } });
  assert.equal(none.canConfirm, false); assert.equal(none.title, 'Nothing new to import from p.zip');
  assert.equal(packView({ phase: 'done', result: { imported: 2, masked: 1, skipped: { exists: 1, failed: 0 } } }).doneText,
    'Imported 2 notes · 1 already there (kept) · 1 secret masked');
  assert.equal(packView({ phase: 'error', error: 'that ZIP is over 50 MB' }).error, 'that ZIP is over 50 MB');
  assert.equal(packView(null).phase, 'closed');
});
```

- [ ] **Step 2: Write the failing store test.** Append to `dashboard-v5/src/live/store.test.mjs`:

```js
test('adoptClaudeTurn registers the run\'s turn and replays events that arrived first; runPrompt refreshes usage', async () => {
  let chatCb = null, statsAsked = 0, packs = 0;
  const hq = {
    claudeChat: { on: (cb) => { chatCb = cb; return () => {}; }, send: async () => ({ error: 'unused' }), cancel: async () => false },
    claudeHub: { health: async () => ({ state: 'ready' }), on: () => () => {}, documents: async () => [], promptStats: async () => { statsAsked++; return []; } },
    claudePrompts: {
      status: async () => ({ folder: { exists: true } }),
      run: async (req) => {
        chatCb({ turnId: 'ct-run-1', kind: 'session', sessionId: '00000000-0000-4000-8000-000000000009', mode: 'read-only' });   // beats the answer
        chatCb({ turnId: 'ct-run-1', kind: 'delta', text: 'Placeholder' });
        return req.target === 'chat' ? { ok: true, target: 'chat', title: 'Review a PR', turnId: 'ct-run-1', usage: 'recorded' } : { error: 'fill in {{file}}', missing: ['file'] };
      },
      importPack: async (req) => { packs++; return req.planId ? { imported: 1, masked: 0, skipped: { exists: 0, failed: 0 } } : { planId: 'pack-1', notes: [] }; },
      exportPack: async () => ({ file: 'x.zip', notes: 1 }),
    },
  };
  const st = createStore(DATA(), hq);
  await st.start();
  const before = statsAsked;
  const r = await st.runPrompt({ promptId: 'prompt:a', target: 'chat', projectId: 'p1' });
  assert.equal(r.turnId, 'ct-run-1');
  const t = st.live.claudeChat.turns.find((x) => x.turnId === 'ct-run-1');
  assert.ok(t, 'the run\'s turn is in the composer list');
  assert.equal(t.prompt, 'Prompt · Review a PR'); assert.equal(t.mode, 'read-only'); assert.equal(t.projectId, 'p1');
  assert.match(JSON.stringify(t), /Placeholder/, 'the delta that arrived before the answer was replayed');
  await new Promise((res) => setTimeout(res, 0));
  assert.ok(statsAsked > before, 'a recorded run re-asks promptStats');
  assert.equal(st.adoptClaudeTurn({ turnId: 'ct-run-1', prompt: 'again' }), false, 'a turn is adopted once');
  assert.deepEqual(await st.runPrompt({ promptId: 'prompt:a', target: 'terminal' }), { error: 'fill in {{file}}', missing: ['file'] });
  assert.equal(st.live.claudeChat.turns.length, 1);
  assert.equal((await st.packImport({ from: 'zip' })).planId, 'pack-1');
  const s2 = statsAsked;
  assert.equal((await st.packImport({ planId: 'pack-1' })).imported, 1);
  await new Promise((res) => setTimeout(res, 0));
  assert.ok(statsAsked > s2, 'an import that wrote notes refreshes the Library');
  assert.deepEqual(await st.packExport(), { file: 'x.zip', notes: 1 });
  assert.equal(packs, 2);
  assert.deepEqual(await createStore(DATA(), null).runPrompt({}), { error: 'This window has no app bridge' });
});
```

(`t.prompt` / `t.mode` / `t.projectId` are the fields `A.chatTurnNew` stores — check `grep -n "export function chatTurnNew" -A8 dashboard-v5/src/live/adapter.mjs`; if the field for the prompt is named differently there, assert that field instead and keep the test's intent.)

- [ ] **Step 3: Run to see them fail.**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `runView is not a function` (import), `st.runPrompt is not a function`.

- [ ] **Step 4: Implement the adapter.** Append to `dashboard-v5/src/live/adapter.mjs`:

```js
// ---- Prompt library P3: run modal + pack confirm (pure). Quota is said on every Claude target; counts are real.
export const RUN_TARGETS_UI = [
  { id: 'chat', label: 'Chat', quota: true, note: 'Runs in Claude › Chats (read-only unless you allow edits) — uses your Claude quota' },
  { id: 'terminal', label: 'Terminal', quota: true, note: 'Opens Claude Code in a terminal in the project folder (one line, up to 500 characters) — uses your Claude quota' },
  { id: 'claude.ai', label: 'Copy for claude.ai', quota: false, note: 'Copies the prompt and opens claude.ai/new — sending it there uses your Claude quota' },
  { id: 'chatgpt', label: 'Copy for ChatGPT', quota: false, note: 'Copies the prompt and opens chatgpt.com' },
];
const RUN_GO = { chat: 'Run in Chat · uses your Claude quota', terminal: 'Open a Terminal · uses your Claude quota', 'claude.ai': 'Copy + open claude.ai', chatgpt: 'Copy + open ChatGPT' };
const RUN_DONE = { chat: 'Started in Claude › Chats', terminal: 'Terminal opened', 'claude.ai': 'Copied — paste it in the claude.ai tab that opened', chatgpt: 'Copied — paste it in the ChatGPT tab that opened' };
const RESERVED = ['project', 'cwd'];

export function runView(run, { prompt = null, projects = [], hasBridge = true } = {}) {
  const R = obj(run);
  const target = RUN_TARGETS_UI.some((t) => t.id === R.target) ? R.target : 'chat';
  const vars = obj(R.vars), missing = arr(R.missing);
  const all = prompt && Array.isArray(prompt.variables) ? prompt.variables : [];
  const fields = all.filter((n) => !RESERVED.includes(n)).map((name) => ({ name, value: typeof vars[name] === 'string' ? vars[name] : '', missing: missing.includes(name) }));
  const usesProject = all.some((n) => RESERVED.includes(n));
  const projectNeeded = usesProject || target === 'chat' || target === 'terminal';
  const busy = R.phase === 'running';
  const filled = fields.every((f) => f.value.trim());
  let status = null;
  if (R.phase === 'error' && R.error) status = { tone: 'error', text: String(R.error) };
  if (R.phase === 'done' && R.result) {
    const u = String(R.result.usage || '');
    const counted = u === 'recorded' ? 'counted in the Library' : u ? u.replace(/^not recorded/, 'not counted') : 'not counted';
    status = { tone: u === 'recorded' ? 'success' : 'info', text: RUN_DONE[target] + ' · ' + counted + (R.result.dry ? ' · dry run — nothing was opened' : '') };
  }
  return {
    title: prompt ? String(prompt.title || 'Untitled prompt') : 'Prompt not found',
    fields, usesProject, projectNeeded,
    projects: arr(projects).map((p) => ({ id: p.id, name: String(p.name || p.id), selected: p.id === R.projectId })),
    targets: RUN_TARGETS_UI.map((t) => ({ ...t, selected: t.id === target })),
    note: RUN_TARGETS_UI.find((t) => t.id === target).note,
    goLabel: RUN_GO[target], busy, status,
    canGo: !!prompt && hasBridge && !busy && filled && (!projectNeeded || !!R.projectId),
    showMode: target === 'chat', modeEdits: R.mode === 'edits',
  };
}

const SKIP_TEXT = [['notMd', 'not a .md file'], ['tooBig', 'over 200 KB'], ['tooMany', 'over the 200-note limit'], ['duplicate', 'duplicate name'], ['unreadable', 'unreadable']];
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function packView(pack) {
  if (!pack || typeof pack !== 'object') return { phase: 'closed', title: '', rows: [], newCount: 0, existCount: 0, skippedText: '', canConfirm: false, confirmLabel: '', doneText: '', error: null };
  const plan = obj(pack.plan), notes = arr(plan.notes), sk = obj(plan.skipped);
  const newCount = notes.filter((n) => !n.exists).length, existCount = notes.length - newCount;
  const parts = SKIP_TEXT.filter(([k]) => num(sk[k]) > 0).map(([k, t]) => num(sk[k]) + ' ' + t);
  const res = obj(pack.result), rs = obj(res.skipped);
  const done = pack.phase === 'done' ? [num(res.imported) === 1 ? 'Imported 1 note' : 'Imported ' + num(res.imported) + ' notes',
    num(rs.exists) ? num(rs.exists) + ' already there (kept)' : '', num(rs.failed) ? num(rs.failed) + ' not written' : '',
    num(res.masked) ? plural(num(res.masked), 'secret masked', 'secrets masked') : ''].filter(Boolean).join(' · ') : '';
  return {
    phase: String(pack.phase || 'plan'),
    title: newCount ? `Import ${plural(newCount, 'new prompt note', 'new prompt notes')} from ${plan.source || 'the pack'}?` : `Nothing new to import from ${plan.source || 'the pack'}`,
    rows: notes.map((n) => ({ name: String(n.name), title: String(n.title || n.name), exists: !!n.exists, tag: n.exists ? 'already there — kept' : 'new' })),
    newCount, existCount,
    skippedText: parts.length ? 'Skipped: ' + parts.join(' · ') : '',
    canConfirm: pack.phase === 'plan' && newCount > 0,
    confirmLabel: newCount ? `Copy ${plural(newCount, 'note', 'notes')} into Prompts` : '',
    doneText: done, error: pack.phase === 'error' ? String(pack.error || 'the pack could not be read') : null,
  };
}
```

(`obj`, `arr`, `num` are the adapter's private helpers, adapter.mjs:12-14.)
- [ ] **Step 5: Implement the store.** In `dashboard-v5/src/live/store.js`, replace the tail of `sendClaudeChat` (from `const turns = live.claudeChat.turns;` through its final `return r;` — five lines at HEAD, store.js:110-115) with these two lines, which call a new function, and add it plus the run/pack methods after `cancelClaudeChat`:

```js
    adoptClaudeTurn({ turnId: r.turnId, convId: req.conversationId || null, projectId: req.projectId || null, prompt: req.text, mode: req.mode, sessionId: r.sessionId || null, seeded: r.seeded || null });
    return r;
```

```js
  // Prompt library P3 — a chat run's turn is started by main (claudePrompts.run), so the store adopts it the way
  // sendClaudeChat does after its answer: push the row, replay events that beat the answer, emit.
  function adoptClaudeTurn({ turnId, convId = null, projectId = null, prompt = '', mode = 'read-only', sessionId = null, seeded = null } = {}) {
    if (typeof turnId !== 'string' || !turnId) return false;
    const turns = live.claudeChat.turns;
    if (turns.some((t) => t.turnId === turnId)) return false;
    turns.push(A.chatTurnNew({ turnId, convId, projectId, prompt, mode, sessionId, seeded, now: Date.now() }));
    if (turns.length > 20) turns.splice(0, turns.length - 20);
    for (const e of pendingChat.splice(0).filter((x) => { if (x.turnId === turnId) return true; pendingChat.push(x); return false; })) applyChat(e);
    emit();
    return true;
  }
  async function runPrompt(req = {}) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.run) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.run(req));
    if (!r || typeof r !== 'object') return { error: 'no answer from the app' };
    if (r.error) return r;
    if (r.target === 'chat' && typeof r.turnId === 'string')
      adoptClaudeTurn({ turnId: r.turnId, projectId: req.projectId || null, prompt: 'Prompt · ' + (r.title || 'untitled'), mode: req.mode || 'read-only', sessionId: r.sessionId || null, seeded: r.seeded || null });
    if (r.usage === 'recorded') refreshPrompts();   // deviation 6: prompt_use rows emit no Hub changed event
    return r;
  }
  async function packImport(req = {}) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.importPack) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.importPack(req));
    if (r && typeof r.imported === 'number' && r.imported > 0) refreshPrompts();
    return r && typeof r === 'object' ? r : { error: 'no answer from the app' };
  }
  async function packExport() {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.exportPack) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.exportPack());
    return r && typeof r === 'object' ? r : { error: 'no answer from the app' };
  }
```

and add `adoptClaudeTurn, runPrompt, packImport, packExport` to the store's returned object (next to `sendClaudeChat, cancelClaudeChat`). `askHq` is P1's helper (declared with `const` before `refreshPrompts`); the new functions are called only after `createStore` returned, so its position is fine — if it is declared below these functions, move these four functions after it.

- [ ] **Step 6: Run to see them pass.**

Run: `node --test dashboard-v5/src/live/*.test.mjs`
Expected: PASS (H3 chat tests in `store.test.mjs`/`adapter.test.mjs` unchanged: `sendClaudeChat` behaves the same).

- [ ] **Step 7: Commit**

```bash
git add dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs
git commit -m "fe: P3.8 — v5 data: adoptClaudeTurn (shared with sendClaudeChat) so a chat run streams into the composer, runPrompt/packImport/packExport refresh real usage; adapter runView/packView (quota labels, honest status)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: v5 actions — `runLogic` mixin (run modal + packs), `prRun` opens the modal, app.js wiring

**Files:**
- Create: `dashboard-v5/src/logic/run.js`
- Create: `dashboard-v5/src/logic/run.test.mjs`
- Modify: `dashboard-v5/src/logic/prompts.js` (`prRun`; drop `RUN_LATER`) + `logic/prompts.test.mjs` (replace the P1 placeholder test)
- Modify: `dashboard-v5/src/app.js` (import, `Object.assign`, `initState`, `closeTop`)

**Interfaces:**
- Consumes: Task 8 store `runPrompt(req)`, `packImport(req)`, `packExport()`; H3 `claudeChatLogic.ccNew(projectId)` and state keys `ccTurn`, `ccMode`; P1 state `prFor` (HQ project id or null); app helpers `canWrite()`, `writeReason()`, `denied(why)`, `toast(kind, text)`, `setState`, `go(tab, sub)`.
- Produces: `runLogic = { rnOpen(id, projectId?), rnClose, rnSetProject(id), rnSetVar(name, value), rnSetTarget(t), rnSetMode(m), rnGo, rnPackImport(from), rnPackConfirm, rnPackCancel, rnPackExport }`; `RUN_TARGET_IDS`; state keys `run` (shape of Task 8) and `pack` — both `null` when closed, never persisted (no storage key).

- [ ] **Step 1: Write the failing tests.** Create `dashboard-v5/src/logic/run.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLogic, RUN_TARGET_IDS } from './run.js';

function rig(o = {}) {
  const calls = [], toasts = [], went = [];
  const self = Object.assign(Object.create(runLogic), {
    state: { run: null, pack: null, prFor: o.prFor || null, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    canWrite: () => o.canWrite !== false, writeReason: () => 'read-only window', denied(why) { toasts.push(['denied', why]); },
    toast: (k, t) => toasts.push([k, t]), go: (tab, sub) => went.push([tab, sub]),
    ccNew(pid) { this.state = { ...this.state, ccOpen: true, ccProj: pid, ccMode: 'read-only', ccTurn: null }; },
    store: {
      runPrompt: async (req) => { calls.push(['run', req]); return o.run ? o.run(req) : { ok: true, target: req.target, title: 'T', usage: 'recorded' }; },
      packImport: async (req) => { calls.push(['import', req]); return o.pack ? o.pack(req) : (req.planId ? { imported: 1, masked: 0, skipped: { exists: 0, failed: 0 } } : { planId: 'pack-1', source: 'p.zip', notes: [], total: 0, skipped: {} }); },
      packExport: async () => { calls.push(['export']); return o.exp || { file: 'x.zip', notes: 2 }; },
    },
  });
  return { self, calls, toasts, went };
}

test('rnOpen defaults to the Library project context; setters keep the shape; only known targets and modes', () => {
  const { self } = rig({ prFor: 'p1' });
  self.rnOpen('prompt:a');
  assert.deepEqual(self.state.run, { id: 'prompt:a', projectId: 'p1', vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null });
  self.rnSetVar('file', 'a.js'); self.rnSetProject('p2'); self.rnSetTarget('terminal'); self.rnSetMode('edits');
  assert.deepEqual([self.state.run.vars, self.state.run.projectId, self.state.run.target, self.state.run.mode], [{ file: 'a.js' }, 'p2', 'terminal', 'edits']);
  self.rnSetTarget('https://evil.example'); self.rnSetMode('bypassPermissions'); self.rnSetVar('__proto__', 'x');
  assert.equal(self.state.run.target, 'terminal'); assert.equal(self.state.run.mode, 'edits');
  assert.equal(Object.keys(self.state.run.vars).length, 1);
  assert.deepEqual(RUN_TARGET_IDS, ['chat', 'terminal', 'claude.ai', 'chatgpt']);
  self.rnClose(); assert.equal(self.state.run, null);
});

test('rnGo sends only ids, target, vars (and mode for chat); a chat run opens its turn in Claude › Chats', async () => {
  const { self, calls, toasts, went } = rig({ run: (req) => ({ ok: true, target: 'chat', title: 'T', turnId: 'ct-9', usage: 'recorded' }) });
  self.rnOpen('prompt:a', 'p1'); self.rnSetVar('file', 'a.js');
  await self.rnGo();
  assert.deepEqual(calls, [['run', { promptId: 'prompt:a', target: 'chat', projectId: 'p1', vars: { file: 'a.js' }, mode: 'read-only' }]]);
  assert.equal(self.state.run, null, 'the modal closes on a started chat');
  assert.equal(self.state.ccTurn, 'ct-9'); assert.equal(self.state.ccOpen, true); assert.equal(self.state.ccProj, 'p1');
  assert.deepEqual(went, [['claude', 'chats']], 'a started chat run shows Claude › Chats, where its turn streams');
  assert.ok(toasts.some(([k, t]) => k === 'success' && /uses your Claude quota/.test(t)));
  const c = rig(); c.self.rnOpen('prompt:a'); c.self.rnSetTarget('claude.ai');
  await c.self.rnGo();
  assert.deepEqual(c.calls[0][1], { promptId: 'prompt:a', target: 'claude.ai', vars: {} }, 'no mode, no projectId when none is picked');
  assert.equal(c.self.state.run.phase, 'done'); assert.equal(c.went.length, 0);
});

test('rnGo: errors keep the modal with the missing fields; read-only windows are refused; no double send', async () => {
  const e = rig({ run: () => ({ error: 'fill in {{file}}', missing: ['file'] }) });
  e.self.rnOpen('prompt:a', 'p1');
  await e.self.rnGo();
  assert.deepEqual([e.self.state.run.phase, e.self.state.run.error, e.self.state.run.missing], ['error', 'fill in {{file}}', ['file']]);
  const ro = rig({ canWrite: false }); ro.self.rnOpen('prompt:a', 'p1');
  await ro.self.rnGo();
  assert.deepEqual(ro.calls, []); assert.deepEqual(ro.toasts[0], ['denied', 'read-only window']);
  let release; const slow = rig({ run: () => new Promise((r) => { release = r; }) });
  slow.self.rnOpen('prompt:a', 'p1'); slow.self.rnSetTarget('chatgpt');
  const p = slow.self.rnGo(); slow.self.rnGo(); slow.self.rnClose();
  assert.equal(slow.calls.length, 1); assert.equal(slow.self.state.run.phase, 'running', 'cannot close while running');
  release({ ok: true, target: 'chatgpt', title: 'T', usage: 'recorded' }); await p;
  assert.equal(slow.self.state.run.phase, 'done');
});

test('packs: pick → plan → one confirm → done; cancel and errors; export toasts', async () => {
  const { self, calls, toasts } = rig();
  await self.rnPackImport('folder');
  assert.deepEqual(calls[0], ['import', { from: 'folder' }]); assert.equal(self.state.pack.phase, 'plan');
  await self.rnPackConfirm();
  assert.deepEqual(calls[1], ['import', { planId: 'pack-1' }]); assert.equal(self.state.pack.phase, 'done');
  self.rnPackCancel(); assert.equal(self.state.pack, null);
  const cx = rig({ pack: () => ({ canceled: true }) }); await cx.self.rnPackImport('zip'); assert.equal(cx.self.state.pack, null);
  const er = rig({ pack: () => ({ error: 'that ZIP is over 50 MB' }) }); await er.self.rnPackImport('zip');
  assert.deepEqual([er.self.state.pack.phase, er.self.state.pack.error], ['error', 'that ZIP is over 50 MB']);
  await self.rnPackExport(); assert.deepEqual(toasts.at(-1), ['success', 'Exported 2 prompt notes to x.zip']);
  const ex = rig({ exp: { error: 'No prompts folder yet — nothing to export' } }); await ex.self.rnPackExport();
  assert.deepEqual(ex.toasts.at(-1), ['error', 'Export pack · No prompts folder yet — nothing to export']);
  const ro = rig({ canWrite: false }); await ro.self.rnPackImport('zip'); await ro.self.rnPackExport();
  assert.deepEqual(ro.calls, []);
});
```

In `dashboard-v5/src/logic/prompts.test.mjs`, replace P1's test `prRun is a labelled placeholder until the run step; it opens and sends nothing` with:

```js
test('prRun opens the run modal for that prompt (P3)', () => {
  const r = rig(); let opened = null;
  r.self.rnOpen = (id) => { opened = id; };
  r.self.prRun('prompt:a');
  assert.equal(opened, 'prompt:a');
});
```

(and drop `RUN_LATER` from that file's import).

- [ ] **Step 2: Run to see them fail.**

Run: `node --test dashboard-v5/src/logic/run.test.mjs dashboard-v5/src/logic/prompts.test.mjs`
Expected: FAIL — `Cannot find module './run.js'`; `opened` is `null` (prRun still toasts `RUN_LATER`).

- [ ] **Step 3: Implement.** Create `dashboard-v5/src/logic/run.js`:

```js
// dashboard-v5/src/logic/run.js — Prompt library P3: run modal + packs (spec 2026-10-15 §6.3).
// Main reads and fills the note; this sends only ids, the target, the owner's values and (chat) the mode.
export const RUN_TARGET_IDS = ['chat', 'terminal', 'claude.ai', 'chatgpt'];
const MODES = ['read-only', 'edits'];
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const fresh = (id, projectId) => ({ id, projectId: projectId || null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null });

export const runLogic = {
  rnOpen(id, projectId = null) {
    if (typeof id !== 'string' || !id) return;
    this.setState({ run: fresh(id, projectId || this.state.prFor || null) });
  },
  rnPatch(p) { const R = this.state.run; if (R && R.phase !== 'running') this.setState({ run: { ...R, ...p, phase: R.phase === 'done' ? 'edit' : R.phase, result: null } }); },
  rnClose() { const R = this.state.run; if (R && R.phase === 'running') return; this.setState({ run: null }); },
  rnSetProject(id) { this.rnPatch({ projectId: typeof id === 'string' && id ? id : null }); },
  rnSetVar(name, value) {
    const R = this.state.run;
    if (!R || !NAME_RE.test(String(name)) || ['__proto__', 'constructor', 'prototype'].includes(name)) return;   // NAME_RE alone admits __proto__
    this.rnPatch({ vars: { ...R.vars, [name]: String(value == null ? '' : value).slice(0, 4000) }, missing: R.missing.filter((m) => m !== name) });
  },
  rnSetTarget(t) { if (RUN_TARGET_IDS.includes(t)) this.rnPatch({ target: t }); },
  rnSetMode(m) { if (MODES.includes(m)) this.rnPatch({ mode: m }); },
  async rnGo() {
    const R = this.state.run;
    if (!R || R.phase === 'running') return;
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const req = { promptId: R.id, target: R.target, ...(R.projectId ? { projectId: R.projectId } : {}), vars: { ...R.vars }, ...(R.target === 'chat' ? { mode: R.mode } : {}) };
    this.setState({ run: { ...R, phase: 'running', error: null, missing: [], result: null } });
    const r = await this.store.runPrompt(req);
    const cur = this.state.run;
    if (!cur || cur.id !== R.id) return;
    if (!r || r.error) { this.setState({ run: { ...cur, phase: 'error', error: String((r && r.error) || 'no answer from the app'), missing: Array.isArray(r && r.missing) ? r.missing : [] } }); return; }
    if (r.target === 'chat' && r.turnId) {
      this.setState({ run: null });
      this.go('claude', 'chats');   // the composer (data-cc="bar") lives in the Chats sub-tab; the run streams there
      this.ccNew(R.projectId || '');
      this.setState({ ccTurn: r.turnId, ccMode: R.mode });
      this.toast('success', 'Prompt started in Claude › Chats — uses your Claude quota');
      return;
    }
    this.setState({ run: { ...cur, phase: 'done', result: r } });
  },
  async rnPackImport(from = 'zip') {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    this.setState({ pack: { phase: 'picking', plan: null, result: null, error: null } });
    const r = await this.store.packImport({ from: from === 'folder' ? 'folder' : 'zip' });
    if (!this.state.pack) return;
    if (r && r.canceled) { this.setState({ pack: null }); return; }
    if (!r || r.error) { this.setState({ pack: { phase: 'error', plan: null, result: null, error: String((r && r.error) || 'no answer from the app') } }); return; }
    this.setState({ pack: { phase: 'plan', plan: r, result: null, error: null } });
  },
  async rnPackConfirm() {
    const P = this.state.pack;
    if (!P || P.phase !== 'plan' || !P.plan || !P.plan.planId) return;
    this.setState({ pack: { ...P, phase: 'writing' } });
    const r = await this.store.packImport({ planId: P.plan.planId });
    if (!r || r.error) { this.setState({ pack: { ...P, phase: 'error', error: String((r && r.error) || 'no answer from the app') } }); return; }
    this.setState({ pack: { ...P, phase: 'done', result: r } });
  },
  rnPackCancel() { const P = this.state.pack; if (P && (P.phase === 'writing' || P.phase === 'picking')) return; this.setState({ pack: null }); },
  async rnPackExport() {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const r = await this.store.packExport();
    if (!r || r.canceled) return;
    if (r.error) { this.toast('error', 'Export pack · ' + r.error); return; }
    this.toast('success', `Exported ${r.notes} prompt note${r.notes === 1 ? '' : 's'} to ${r.file}`);
  },
};
```

Note `rnPackCancel` during `picking` returns: the dialog is modal in main; the `pack` overlay shows "Choosing…" until it answers. The test's cancel happens in `done`.

In `dashboard-v5/src/logic/prompts.js`: replace `prRun() { this.toast('info', RUN_LATER); },` with `prRun(id) { this.rnOpen(id); },` and delete the `RUN_LATER` export.

In `dashboard-v5/src/app.js`: `import { runLogic } from './logic/run.js';` beside the other logic imports; append `runLogic` to the `Object.assign(Component.prototype, …)` list; in `initState()` add `run: null, pack: null,`; in `closeTop()` (Escape ladder; at HEAD app.js:348-357 it is ONE `order` array walked by one `for` line, and P2 put `'promote'` right after `'vault'` in that array and in the "closes to null" list): (a) in `order` insert `'pack', 'run'` directly after `'promote'`; (b) do NOT add them to the "closes to null" list — instead change the loop body from `if (k === 'focus') this.endFocus(false); else this.setState(…)` to `if (k === 'focus') this.endFocus(false); else if (k === 'pack') this.rnPackCancel(); else if (k === 'run') this.rnClose(); else this.setState(…)` (the `setState(…)` part unchanged). Reason: `rnPackCancel` / `rnClose` refuse to close while a pack is being picked/written or a run is in flight; a bare `setState({run:null})` would drop an in-flight run's answer.

- [ ] **Step 4: Run to see them pass.**

Run: `node --test dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/*.test.mjs`
Expected: PASS except `tpl.hash`/goldens untouched (no markup yet) — they PASS too; `honesty.test.mjs` PASS (no new number text).

- [ ] **Step 5: Commit**

```bash
git add dashboard-v5/src/logic/run.js dashboard-v5/src/logic/run.test.mjs dashboard-v5/src/logic/prompts.js dashboard-v5/src/logic/prompts.test.mjs dashboard-v5/src/app.js
git commit -m "fe: P3.9 — v5 runLogic: run modal state (ids/target/vars/mode only), chat runs open their turn in Claude › Chats, pack pick → plan → one confirm, export; Library Run opens the modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: v5 surfaces — run modal + pack dialog (`extras.tpl.js`), Import/Export pack buttons (Library), `vals/run.js`; tpl hash + attributed goldens

**Files:**
- Create: `dashboard-v5/src/vals/run.js`
- Modify: `dashboard-v5/src/vals/index.js` (append `runVals` to `SURFACES`)
- Modify: `dashboard-v5/src/tpl/extras.tpl.js` (two overlays after P2's Promote dialog)
- Modify: `dashboard-v5/src/tpl/claude.tpl.js` (pack buttons in P1's Library)
- Modify: `dashboard-v5/src/tpl.hash.test.mjs`, `dashboard-v5/src/vals.golden.test.mjs`, `dashboard-v5/src/__golden__/vals.hashes.json`

**Interfaces:**
- Consumes: Task 8 `runView`, `packView`; Task 9 `rnSetVar, rnSetProject, rnSetTarget, rnSetMode, rnGo, rnClose, rnPackImport, rnPackConfirm, rnPackCancel, rnPackExport`, state `run`, `pack`; P1 `live.prompts.rows`; ctx `projects` (HQ projects `{id, name}`), `cantWrite`, `writeReason` (vals/ctx.js); P2 dialog idiom (scrim `z-index:1100`, `role="dialog"`, `data-*` hooks, `Close · Esc`).
- Produces: vals keys (all `rn*`, disjoint from every surface — none equals a `runLogic` method name): `rnShow, rnTitle, rnFields, rnHasFields, rnProjects, rnHasProjects, rnNoProjects, rnProjectNote, rnTargets, rnNote, rnGoLabel, rnCantGo, rnDoGo, rnBusy, rnShowMode, rnModeText, rnFlipMode, rnHasStatus, rnStatusText, rnStatusStyle, rnDoClose, rnStopClick, rnPackShow, rnPackTitle, rnPackRows, rnPackHasSkipped, rnPackSkipped, rnPackPicking, rnPackIsPlan, rnPackWriting, rnPackIsDone, rnPackDoneText, rnPackHasError, rnPackError, rnPackCantConfirm, rnPackConfirmLabel, rnPackDoConfirm, rnPackDoCancel, rnImportZip, rnImportFolder, rnExportPack, rnPackCant, rnPackCantTip`; DOM hooks `data-rn="dialog|field|project|target|mode|go|status|close"`, `data-rp="dialog|row|skipped|confirm|done|error|close"`, `data-pk="import-zip|import-folder|export"` (CDP, Task 11).

- [ ] **Step 1: Record the "before" golden dump** (attribution baseline, outside the repo).

Run (Git Bash): `B="$(mktemp -d)"; GOLDEN_DUMP="$B" node --test dashboard-v5/src/vals.golden.test.mjs; echo "$B"`
Expected: PASS; keep the printed folder for Step 7.

- [ ] **Step 2: Write `dashboard-v5/src/vals/run.js`:**

```js
// Prompt library P3 — the run modal and the pack dialog (spec 2026-10-15 §6.3). Keys: rn*. Text is bound as text.
import { runView, packView } from '../live/adapter.mjs';

const CHIP_ON = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab,var(--purple) 14%,transparent);color:var(--text);cursor:pointer;font-size:12px';
const CHIP_OFF = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px';
const FIELD = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px';
const FIELD_BAD = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--tone-red);border-radius:8px;color:var(--text);font-size:13px';
const TONE = { success: 'var(--green)', info: 'var(--gold)', error: 'var(--tone-red)' };

export function runVals(ctx) {
  const S = this.state, L = this.store.live;
  const rows = (L.prompts && Array.isArray(L.prompts.rows)) ? L.prompts.rows : [];
  const R = S.run;
  const prompt = R ? rows.find((p) => p && p.id === R.id) || null : null;
  const v = runView(R, { prompt, projects: (ctx.projects || []).map((p) => ({ id: p.id, name: p.name })), hasBridge: !!this.store.bridge });
  const P = packView(S.pack), ph = S.pack ? S.pack.phase : null;
  const cant = !!ctx.cantWrite;
  return {
    rnShow: !!R, rnTitle: v.title,
    rnFields: v.fields.map((f) => ({ name: f.name, label: '{{' + f.name + '}}', value: f.value, style: f.missing ? FIELD_BAD : FIELD,
      onChange: (e) => this.rnSetVar(f.name, e && e.target ? e.target.value : '') })),
    rnHasFields: v.fields.length > 0,
    rnProjects: v.projects.map((p) => ({ name: p.name, pressed: p.selected, style: p.selected ? CHIP_ON : CHIP_OFF, pick: () => this.rnSetProject(p.id) })),
    rnHasProjects: v.projects.length > 0, rnNoProjects: v.projects.length === 0,
    rnProjectNote: v.usesProject ? 'This prompt uses {{project}} / {{cwd}} — they are filled from the project you pick'
      : v.projectNeeded ? 'Chat and Terminal start in the project folder' : 'A project is optional for a copy',
    rnTargets: v.targets.map((t) => ({ label: t.label, pressed: t.selected, style: t.selected ? CHIP_ON : CHIP_OFF, pick: () => this.rnSetTarget(t.id) })),
    rnNote: v.note, rnGoLabel: v.busy ? 'Working…' : v.goLabel, rnCantGo: !v.canGo || cant, rnDoGo: () => this.rnGo(), rnBusy: v.busy,
    rnShowMode: v.showMode, rnModeText: v.modeEdits ? 'Mode: allow edits (click for read-only)' : 'Mode: read-only (click to allow edits)',
    rnFlipMode: () => this.rnSetMode(v.modeEdits ? 'read-only' : 'edits'),
    rnHasStatus: !!v.status, rnStatusText: v.status ? v.status.text : '',
    rnStatusStyle: 'margin-top:12px;font-size:13px;color:' + (v.status ? TONE[v.status.tone] : 'var(--muted)'),
    rnDoClose: () => this.rnClose(), rnStopClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
    rnPackShow: P.phase !== 'closed', rnPackTitle: ph === 'picking' ? 'Choosing a pack…' : ph === 'error' ? 'The pack was not imported' : ph === 'done' ? 'Pack imported' : P.title,
    rnPackRows: P.rows, rnPackHasSkipped: !!P.skippedText, rnPackSkipped: P.skippedText,
    rnPackPicking: ph === 'picking', rnPackIsPlan: ph === 'plan', rnPackWriting: ph === 'writing', rnPackIsDone: ph === 'done', rnPackDoneText: P.doneText,
    rnPackHasError: !!P.error, rnPackError: P.error || '',
    rnPackCantConfirm: !P.canConfirm, rnPackConfirmLabel: P.confirmLabel || 'Nothing to copy',
    rnPackDoConfirm: () => this.rnPackConfirm(), rnPackDoCancel: () => this.rnPackCancel(),
    rnImportZip: () => this.rnPackImport('zip'), rnImportFolder: () => this.rnPackImport('folder'), rnExportPack: () => this.rnPackExport(),
    rnPackCant: cant, rnPackCantTip: cant ? ctx.writeReason : 'Asks first; copies new notes only — an existing note is never replaced',
  };
}
```

In `vals/index.js`: `import { runVals } from './run.js';` and append `runVals` at the end of `SURFACES`.

- [ ] **Step 3: The pack buttons.** In `tpl/claude.tpl.js`, inside P1's Library block, find the element carrying `data-pr="search"` (`grep -n 'data-pr="search"' dashboard-v5/src/tpl/claude.tpl.js`) and insert directly after the `</section>` that closes its search section:

```html
                  <!-- v5: Prompt library P3 (spec 2026-10-15 §6.3 Packs) — import a folder or ZIP of .md notes (asks first, copies new notes only) or export the Prompts folder as a ZIP -->
                  <div data-pk="bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span style="font-size:11px;color:var(--faint);margin-right:auto">Packs</span><button type="button" data-pk="import-zip" onClick="{{ rnImportZip }}" disabled="{{ rnPackCant }}" title="{{ rnPackCantTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-size:12px">Import pack (.zip)…</button><button type="button" data-pk="import-folder" onClick="{{ rnImportFolder }}" disabled="{{ rnPackCant }}" title="{{ rnPackCantTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-size:12px">Import folder…</button><button type="button" data-pk="export" onClick="{{ rnExportPack }}" disabled="{{ rnPackCant }}" title="Saves a ZIP of the Prompts folder — never over an existing file" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px">Export pack…</button></div>
```

- [ ] **Step 4: The two overlays.** In `tpl/extras.tpl.js`, directly after P2's Promote dialog closing `</sc-if>`:

```html
  <!-- v5: Prompt library P3 — run modal (spec §6.3): project picker, one field per {{variable}}, four targets; every Claude target says it uses the Claude quota; main fills and sends — the page never sends prompt text -->
  <sc-if value="{{ rnShow }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ rnDoClose }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div data-rn="dialog" onClick="{{ rnStopClick }}" role="dialog" aria-label="Run a prompt" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--purple);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Run a prompt</div>
        <div style="font-size:19px;margin-top:8px">{{ rnTitle }}</div>
        <div style="margin-top:14px;font-size:11px;color:var(--faint)">Project · {{ rnProjectNote }}</div>
        <sc-if value="{{ rnHasProjects }}" hint-placeholder-val="{{ true }}"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><sc-for list="{{ rnProjects }}" as="p" hint-placeholder-count="3"><button type="button" data-rn="project" onClick="{{ p.pick }}" aria-pressed="{{ p.pressed }}" style="{{ p.style }}">{{ p.name }}</button></sc-for></div></sc-if>
        <sc-if value="{{ rnNoProjects }}" hint-placeholder-val="{{ false }}"><div style="margin-top:6px;font-size:12px;color:var(--muted)">No WorkspaceHQ projects yet — Chat and Terminal need one; the copy targets work without.</div></sc-if>
        <sc-if value="{{ rnHasFields }}" hint-placeholder-val="{{ true }}"><div style="display:flex;flex-direction:column;gap:8px;margin-top:14px"><sc-for list="{{ rnFields }}" as="f" hint-placeholder-count="2"><label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--faint);font-family:var(--term)">{{ f.label }}<input data-rn="field" value="{{ f.value }}" onChange="{{ f.onChange }}" style="{{ f.style }}"></label></sc-for></div></sc-if>
        <div style="margin-top:14px;font-size:11px;color:var(--faint)">Where</div>
        <div role="radiogroup" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><sc-for list="{{ rnTargets }}" as="t" hint-placeholder-count="4"><button type="button" role="radio" data-rn="target" onClick="{{ t.pick }}" aria-checked="{{ t.pressed }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">{{ rnNote }}</div>
        <sc-if value="{{ rnShowMode }}" hint-placeholder-val="{{ true }}"><button type="button" data-rn="mode" onClick="{{ rnFlipMode }}" style="margin-top:8px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-size:12px">{{ rnModeText }}</button></sc-if>
        <sc-if value="{{ rnHasStatus }}" hint-placeholder-val="{{ false }}"><div data-rn="status" role="status" style="{{ rnStatusStyle }}">{{ rnStatusText }}</div></sc-if>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button type="button" data-rn="close" onClick="{{ rnDoClose }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <button type="button" data-rn="go" onClick="{{ rnDoGo }}" disabled="{{ rnCantGo }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--purple);color:var(--text);border:1px solid var(--purple);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ rnGoLabel }}</button>
        </div>
      </div>
    </div>
  </sc-if>
  <!-- v5: Prompt library P3 — the ONE confirm before a pack is copied into 40_Resources/Prompts (spec §6.3): lists every note, marks the ones already there (kept, never replaced), says what was skipped and why -->
  <sc-if value="{{ rnPackShow }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ rnPackDoCancel }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div data-rp="dialog" onClick="{{ rnStopClick }}" role="dialog" aria-label="Import a prompt pack" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this writes</div>
        <div style="font-size:19px;margin-top:8px">{{ rnPackTitle }}</div>
        <sc-if value="{{ rnPackIsPlan }}" hint-placeholder-val="{{ false }}"><div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;max-height:40vh;overflow:auto"><sc-for list="{{ rnPackRows }}" as="r" hint-placeholder-count="3"><div data-rp="row" style="display:flex;gap:10px;font-size:13px;border-bottom:1px dashed var(--frame);padding:4px 0"><span style="flex:1;min-width:0">{{ r.title }}</span><span style="font-family:var(--term);font-size:11px;color:var(--faint)">{{ r.name }}</span><span style="font-size:11px;color:var(--muted)">{{ r.tag }}</span></div></sc-for></div></sc-if>
        <sc-if value="{{ rnPackHasSkipped }}" hint-placeholder-val="{{ false }}"><div data-rp="skipped" style="margin-top:8px;font-size:12px;color:var(--muted)">{{ rnPackSkipped }}</div></sc-if>
        <sc-if value="{{ rnPackIsDone }}" hint-placeholder-val="{{ false }}"><div data-rp="done" role="status" style="margin-top:12px;font-size:13px;color:var(--green)">{{ rnPackDoneText }}</div></sc-if>
        <sc-if value="{{ rnPackHasError }}" hint-placeholder-val="{{ false }}"><div data-rp="error" role="status" style="margin-top:12px;font-size:13px;color:var(--tone-red)">{{ rnPackError }}</div></sc-if>
        <sc-if value="{{ rnPackWriting }}" hint-placeholder-val="{{ false }}"><div style="margin-top:12px;font-size:12px;color:var(--muted)">Writing…</div></sc-if>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button type="button" data-rp="close" onClick="{{ rnPackDoCancel }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <sc-if value="{{ rnPackIsPlan }}" hint-placeholder-val="{{ true }}"><button type="button" data-rp="confirm" onClick="{{ rnPackDoConfirm }}" disabled="{{ rnPackCantConfirm }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ rnPackConfirmLabel }}</button></sc-if>
        </div>
      </div>
    </div>
  </sc-if>
```

- [ ] **Step 5: Re-record the template hash (deliberate).**

Run: `node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import c from 'node:crypto'; console.log(c.createHash('sha256').update(t).digest('hex'), t.length, Buffer.byteLength(t, 'utf8'))"`
Put the three values into `SHA256`, `LENGTH`, `UTF8_BYTES` of `dashboard-v5/src/tpl.hash.test.mjs` and add above them `// 2026-10-25 P3 prompt runs + packs: run modal + pack dialog (extras.tpl.js), pack buttons (claude.tpl.js) (+<Δchars> chars / +<Δbytes> bytes)` with the real deltas against the constants P2 left (read them before editing).
Run: `node --test dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/honesty.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add golden scenarios.** In `dashboard-v5/src/vals.golden.test.mjs`, next to P1's `claude.prompts-*` scenarios, copy P1's Library scenario (`grep -n "add('claude.prompts-" dashboard-v5/src/vals.golden.test.mjs` — use the one with filled rows and its `live`/`state` form) and add these 8, each = that scenario plus the state patch shown (prompt id = the first fixture row's id, variables `['project', 'file']`; one HQ project id from that scenario's model, written `<P>` here):
  - `claude.run-chat-edit` — `run: { id, projectId: null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null }`
  - `claude.run-chat-ready` — same with `projectId: '<P>', vars: { file: 'a.js' }`
  - `claude.run-missing` — `phase: 'error', error: 'fill in {{file}}', missing: ['file']`, `projectId: '<P>'`
  - `claude.run-copy-done` — `target: 'claude.ai', phase: 'done', result: { ok: true, target: 'claude.ai', title: 'x', usage: 'recorded' }`
  - `claude.run-not-counted` — `target: 'chatgpt', phase: 'done', result: { ok: true, target: 'chatgpt', title: 'x', usage: 'not recorded: read-only hub (another WorkspaceHQ owns the index)' }`
  - `claude.pack-plan` — `pack: { phase: 'plan', plan: <the fake importPack plan of Task 7>, result: null, error: null }`
  - `claude.pack-done` — `pack: { phase: 'done', plan: <same>, result: { imported: 2, masked: 0, skipped: { exists: 1, failed: 0 } }, error: null }`
  - `claude.pack-error` — `pack: { phase: 'error', plan: null, result: null, error: 'that ZIP is over 50 MB' }`

- [ ] **Step 7: Attribute every golden change, then re-record.** Expected changes: (1) every scenario gains the new `rn*` keys; (2) the 8 new scenarios. P1's `claude.prompts-*` scenarios change only by the `rn*` keys (the Library row `r.run` handler is a function — not hashed). Nothing else may change.

Run: `A="$(mktemp -d)"; GOLDEN_DUMP="$A" node --test dashboard-v5/src/vals.golden.test.mjs || true; node dashboard-v5/tools/golden-diff.mjs "$B" "$A" --allow '^rn[A-Z][A-Za-z]*\b'`
Expected: exit 0. If another path changed, find its cause and fix it — do not widen `--allow`.
Then: `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs` and `node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: PASS.

- [ ] **Step 8: Run the renderer suites.**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add dashboard-v5/src/vals/run.js dashboard-v5/src/vals/index.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/extras.tpl.js dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: P3.10 — v5 run modal (project, {{variables}}, Chat/Terminal/Copy targets, quota labels, honest status) + pack confirm dialog + Import/Export pack buttons; tpl hash + attributed goldens (8 new scenarios)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Selftest rows for the run modal and the pack dialog; CDP `prompts-run-chat`, `prompts-run-copy`, `prompts-pack-import`

**Files:**
- Modify: `dashboard-v5/src/selftest.js`
- Modify: `dashboard-v5/tools/cdp-gate.mjs`

**Interfaces:**
- Consumes: Task 10 DOM hooks `data-rn="dialog|field|project|target|mode|go|status|close"`, `data-rp="dialog|row|skipped|confirm|done|error|close"`, `data-pk="import-zip|import-folder|export"`; P1 hook `data-pr="run"` (Library row Run button); Task 5/7 fake `claudePrompts.run` (chat streams via `chatTurn`), `claudePrompts.importPack`, `claudePrompts.exportPack`; P1 `FAKE_PROMPTS` (first row variables `['project', 'file']`); `hqFake.calls(method) -> [{args}]`, `hqFake.set(method, value|fn)`; cdp `fresh(t)`, `t.evaluate`, `t.waitFor`, `t.press`, `t.errors()`; selftest `at(tab, sub, project)`, `CLEAR`, `STATES`, `LV`.
- Produces: selftest combos `run-chat-edit`, `run-chat-ready`, `run-missing`, `run-copy-done`, `run-not-counted`, `run-running`, `pack-picking`, `pack-plan`, `pack-writing`, `pack-done`, `pack-error`; CDP scenarios `prompts-run-chat`, `prompts-run-copy`, `prompts-pack-import` (in `--scenario all`, and listed in the header comment).

- [ ] **Step 1: Selftest rows.** In `dashboard-v5/src/selftest.js`: add `run: null, pack: null,` to `CLEAR` (`RESTORE` picks them up). Near P2's `HC_ROWS` add, then append the rows to `STATES` (same `[name, view, statePatch]` form as P1's `prompts-*` rows; P1's rows already fill `LV.prompts` with two rows through their `liveFn` — reuse that `liveFn` for every row below so the modal finds its prompt):

```js
// P3 run modal + pack dialog (placeholder text). PR_A = the first P1 prompt row's id used by the prompts-* rows.
const RUN0 = (o = {}) => ({ run: { id: PR_A, projectId: null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null, ...o } });
const PACK_PLAN = { planId: 'pack-' + '0'.repeat(16), source: 'placeholder-pack.zip', total: 3, skipped: { notMd: 1, tooBig: 0, tooMany: 0, duplicate: 0, unreadable: 0 },
  notes: [{ name: 'review-a-pr.md', title: 'Review a PR', exists: true }, { name: 'standup-notes.md', title: 'Standup notes', exists: false }, { name: 'bug-triage.md', title: 'Bug triage', exists: false }] };
```

```js
  ['run-chat-edit', at('claude', 'prompts'), RUN0(), PROMPTS_LIVE],
  ['run-chat-ready', at('claude', 'prompts'), RUN0({ projectId: FIRST_PROJECT_ID, vars: { file: 'placeholder.js' }, mode: 'edits' }), PROMPTS_LIVE],
  ['run-missing', at('claude', 'prompts'), RUN0({ phase: 'error', error: 'fill in {{file}}', missing: ['file'] }), PROMPTS_LIVE],
  ['run-running', at('claude', 'prompts'), RUN0({ target: 'terminal', phase: 'running' }), PROMPTS_LIVE],
  ['run-copy-done', at('claude', 'prompts'), RUN0({ target: 'claude.ai', phase: 'done', result: { ok: true, target: 'claude.ai', title: 'x', usage: 'recorded' } }), PROMPTS_LIVE],
  ['run-not-counted', at('claude', 'prompts'), RUN0({ target: 'chatgpt', phase: 'done', result: { ok: true, target: 'chatgpt', title: 'x', usage: 'not recorded: read-only hub (another WorkspaceHQ owns the index)', dry: true } }), PROMPTS_LIVE],
  ['pack-picking', at('claude', 'prompts'), { pack: { phase: 'picking', plan: null, result: null, error: null } }, PROMPTS_LIVE],
  ['pack-plan', at('claude', 'prompts'), { pack: { phase: 'plan', plan: PACK_PLAN, result: null, error: null } }, PROMPTS_LIVE],
  ['pack-writing', at('claude', 'prompts'), { pack: { phase: 'writing', plan: PACK_PLAN, result: null, error: null } }, PROMPTS_LIVE],
  ['pack-done', at('claude', 'prompts'), { pack: { phase: 'done', plan: PACK_PLAN, result: { imported: 2, masked: 1, skipped: { exists: 1, failed: 0 } }, error: null } }, PROMPTS_LIVE],
  ['pack-error', at('claude', 'prompts'), { pack: { phase: 'error', plan: null, result: null, error: 'that ZIP is over 50 MB' } }, PROMPTS_LIVE],
```

`PR_A`, `PROMPTS_LIVE` and `FIRST_PROJECT_ID` are the names to give (or reuse, if P1 already named them) to: the first prompt row id P1's selftest fixture uses, the `liveFn` P1's `prompts-list` row passes, and `M.projects[0].id` of the selftest model. Read P1's `prompts-*` rows (`grep -n "'prompts-" dashboard-v5/src/selftest.js`) and bind these three names to what is there; do not invent new fixture data.

- [ ] **Step 2: Run the selftest.**

Run (PowerShell, from `dashboard-v5`): `$env:HQ_V5_PROFILE = "p3-selftest-$PID"; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --selftest; $LASTEXITCODE`
Expected: `0`, verdict `0/0/0` (no errors, unresolved bindings or failures) with the combo count grown by 11 × the theme/offset/overlay multiplier.

- [ ] **Step 3: CDP scenarios.** In `dashboard-v5/tools/cdp-gate.mjs` add to `SCENARIOS` (and their names to the header list):

```js
  async 'prompts-run-chat'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const out = [];
    const runCalls = async () => JSON.parse(await t.evaluate(`JSON.stringify(hqFake.calls('claudePrompts.run').map((c) => c.args[0]))`));
    await t.evaluate(`WHQ.app.logic.go('claude','prompts')`);
    if (!await t.waitFor(`document.querySelectorAll('[data-pr="run"]').length >= 1`)) return out.concat('no Run button on the Library rows');
    await t.evaluate(`document.querySelector('[data-pr="run"]').click()`);
    if (!await t.waitFor(`!!document.querySelector('[data-rn="dialog"]')`)) return out.concat('no run modal');
    const go = await t.evaluate(`document.querySelector('[data-rn="go"]').textContent`);
    if (!/uses your Claude quota/.test(go)) out.push('Chat target lacks the quota label: ' + go);
    if (!await t.evaluate(`document.querySelector('[data-rn="go"]').disabled`)) out.push('Run is enabled before a project and {{file}} are given');
    if (await t.evaluate(`[...document.querySelectorAll('[data-rn="field"]')].length`) !== 1) out.push('expected exactly one field ({{file}}; {{project}} comes from the project)');
    await t.evaluate(`document.querySelector('[data-rn="project"]').click()`);
    await t.evaluate(`(() => { const i = document.querySelector('[data-rn="field"]'); i.value = 'placeholder.js'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    if (!await t.waitFor(`!document.querySelector('[data-rn="go"]').disabled`)) out.push('Run still disabled after filling');
    if ((await runCalls()).length !== 0) out.push('run was sent before the click');
    await t.evaluate(`document.querySelector('[data-rn="go"]').click()`);
    if (!await t.waitFor(`!document.querySelector('[data-rn="dialog"]')`)) out.push('the modal did not close on a started chat');
    const req = (await runCalls())[0] || null;
    if (!req || req.target !== 'chat' || req.mode !== 'read-only' || !req.vars || req.vars.file !== 'placeholder.js' || 'text' in req || !req.projectId) out.push('run request: ' + JSON.stringify(req));
    if (await t.evaluate(`hqFake.calls('claudeChat.send').length`) !== 0) out.push('the page sent the chat itself — main must');
    if (!await t.waitFor(`WHQ.app.logic.store.live.claudeChat.turns.some((x) => x.prompt.startsWith('Prompt · ') && x.status === 'done')`, 8000)) out.push('the run\'s turn did not stream to done');
    if (!await t.waitFor(`document.body.textContent.includes('answer from the fake claude')`)) out.push('the streamed answer is not visible in Claude › Chats');
    return out.concat(t.errors());
  },
  async 'prompts-run-copy'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const out = [];
    await t.evaluate(`WHQ.app.logic.go('claude','prompts')`);
    if (!await t.waitFor(`document.querySelectorAll('[data-pr="run"]').length >= 2`)) return out.concat('Library rows missing');
    await t.evaluate(`document.querySelectorAll('[data-pr="run"]')[1].click()`);   // the fixture prompt without variables
    if (!await t.waitFor(`!!document.querySelector('[data-rn="dialog"]')`)) return out.concat('no run modal');
    await t.evaluate(`[...document.querySelectorAll('[data-rn="target"]')].find((b) => /claude\\.ai/.test(b.textContent)).click()`);
    const note = await t.evaluate(`document.querySelector('[data-rn="dialog"]').textContent`);
    if (!/uses your Claude quota/.test(note)) out.push('Copy for claude.ai does not say pasting spends the quota');
    if (await t.evaluate(`!!document.querySelector('[data-rn="mode"]')`)) out.push('mode toggle shown for a copy target');
    await t.evaluate(`document.querySelector('[data-rn="go"]').click()`);
    if (!await t.waitFor(`/Copied — paste it in the claude\\.ai tab that opened · counted in the Library/.test((document.querySelector('[data-rn="status"]') || {}).textContent || '')`)) out.push('no honest done status');
    await t.evaluate(`hqFake.set('claudePrompts.run', (r) => ({ ok: true, target: r.target, title: 'x', usage: 'not recorded: read-only hub (another WorkspaceHQ owns the index)' }))`);
    await t.evaluate(`[...document.querySelectorAll('[data-rn="target"]')].find((b) => /ChatGPT/.test(b.textContent)).click()`);
    await t.evaluate(`document.querySelector('[data-rn="go"]').click()`);
    if (!await t.waitFor(`/not counted: read-only hub/.test((document.querySelector('[data-rn="status"]') || {}).textContent || '')`)) out.push('a usage miss is not said');
    const reqs = JSON.parse(await t.evaluate(`JSON.stringify(hqFake.calls('claudePrompts.run').map((c) => c.args[0].target))`));
    if (JSON.stringify(reqs) !== '["claude.ai","chatgpt"]') out.push('targets sent: ' + JSON.stringify(reqs));
    await t.press('Escape');
    if (!await t.waitFor(`!document.querySelector('[data-rn="dialog"]')`)) out.push('Escape did not close the run modal');
    return out.concat(t.errors());
  },
  async 'prompts-pack-import'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const out = [];
    await t.evaluate(`WHQ.app.logic.go('claude','prompts')`);
    if (!await t.waitFor(`!!document.querySelector('[data-pk="import-zip"]')`)) return out.concat('no Import pack button');
    await t.evaluate(`document.querySelector('[data-pk="import-zip"]').click()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-rp="row"]').length === 3`)) return out.concat('the plan rows are not listed');
    const txt = await t.evaluate(`document.querySelector('[data-rp="dialog"]').textContent`);
    if (!/already there — kept/.test(txt) || !/Skipped: 1 not a \\.md file/.test(txt)) out.push('plan lacks the kept/skipped lines: ' + txt.slice(0, 300));
    const label = await t.evaluate(`document.querySelector('[data-rp="confirm"]').textContent`);
    if (label.trim() !== 'Copy 2 notes into Prompts') out.push('confirm label: ' + label);
    if (await t.evaluate(`hqFake.calls('claudePrompts.importPack').length`) !== 1) out.push('more than the plan call before the confirm');
    await t.evaluate(`document.querySelector('[data-rp="confirm"]').click()`);
    if (!await t.waitFor(`/Imported 2 notes · 1 already there \\(kept\\)/.test((document.querySelector('[data-rp="done"]') || {}).textContent || '')`)) out.push('no done report');
    const args = JSON.parse(await t.evaluate(`JSON.stringify(hqFake.calls('claudePrompts.importPack').map((c) => c.args[0]))`));
    if (JSON.stringify(args) !== JSON.stringify([{ from: 'zip' }, { planId: 'pack-' + '0'.repeat(16) }])) out.push('importPack calls: ' + JSON.stringify(args));
    await t.press('Escape');
    if (!await t.waitFor(`!document.querySelector('[data-rp="dialog"]')`)) out.push('Escape did not close the pack dialog');
    await t.evaluate(`document.querySelector('[data-pk="export"]').click()`);
    if (!await t.waitFor(`document.body.textContent.includes('Exported 2 prompt notes to prompts-pack-2026-10-25.zip')`)) out.push('no export toast');
    return out.concat(t.errors());
  },
```

(The prompts-run-copy scenario opens the second fake row, `Weekly notes digest`, which has no variables — so no project is required for a copy target.)

- [ ] **Step 4: Run the CDP gate against a fake-preload harness.**

Run (PowerShell, from `dashboard-v5`): `$p = Start-Process -PassThru -WindowStyle Hidden ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9353'; node tools/cdp-gate.mjs --port 9353 --scenario all; $code = $LASTEXITCODE; Stop-Process -Id $p.Id; $code`
Expected: every scenario `PASS` (incl. `fake-parity`, P1/P2's `prompts-*` and the 3 new ones), exit `0`. Only the PID started here is stopped.

- [ ] **Step 5: Commit**

```bash
git add dashboard-v5/src/selftest.js dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: P3.11 — selftest rows for the run modal and pack dialog; CDP prompts-run-chat (main sends, turn streams in Chats), prompts-run-copy (quota note, honest usage), prompts-pack-import (plan → one confirm)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: P3 gate on a real second instance (fixtures only), docs, HANDOFF — the owner's app is NOT restarted

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` (and `docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` only if Step 4 finds a row that differs from the landed code)
- Temporary (never committed, removed at the end): `%TEMP%\hq-p3-gate-<pid>\` (fixtures, db, vault, pack source, export folder, profile, logs, fake claude, `gate-p3.mjs`)

**Interfaces:**
- Consumes: everything above through the real preload (`window.hq`) of a second Electron instance; fixtures `makeClaudeHome(dir)` (`dashboard/claude-hub/__fixtures__/make-fixture.mjs`), H6 `makeDocsHome(dir)` (builds `vault/40_Resources/Prompts/review-a-pr.md`, variables `project`, `file`), H3 `makeFakeClaude(dir) -> {bin, binDir, log, env}` (`dashboard/__fixtures__/make-fake-claude.mjs`); the CDP driver `connect()`, `ev(expr)`, `until(expr, ms)` from `docs/superpowers/plans/2026-10-15-claude-hub-h5.md` Task 8 Step 2.
- Produces: a PASS/FAIL JSON report (counts, file names, fixture titles only) pasted into the HANDOFF entry.

- [ ] **Step 1: All suites green on the final tree.**

Run: `node --test dashboard/claude-hub/*.test.mjs` ; `node --test dashboard/*.test.mjs` ; `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs` ; the selftest (Task 11 Step 2, a new unique `HQ_V5_PROFILE`) and the CDP gate `--scenario all` (Task 11 Step 4, own port, stop only your PID).
Expected: everything PASSES; selftest exit 0 with 0/0/0; every CDP scenario `PASS`.

- [ ] **Step 2: Build the fixtures and start a second instance** (PowerShell, repo root). Record the owner's state first:

```powershell
$g = Join-Path $env:TEMP "hq-p3-gate-$PID"; New-Item -ItemType Directory -Path $g | Out-Null
$ownerRes = 'C:\Users\ROG STRIX\Documents\VEEMO CORTEX\40_Resources'
$snap = { param($d) (Get-ChildItem -LiteralPath $d -Force -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2) }
$resBefore = & $snap $ownerRes
$dataBefore = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
$clipBefore = Get-Clipboard -Raw
New-Item -ItemType Directory -Path (Join-Path $g 'db'), (Join-Path $g 'pack-src'), (Join-Path $g 'out') | Out-Null
$seed = @'
import fs from 'node:fs'; import path from 'node:path';
import { makeClaudeHome } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs';
import { makeDocsHome } from './dashboard/claude-hub/__fixtures__/make-docs.mjs';
import { makeFakeClaude } from './dashboard/__fixtures__/make-fake-claude.mjs';
const g = process.argv[2];
const { home } = makeClaudeHome(g);
const docs = makeDocsHome(g);
const fake = makeFakeClaude(path.join(g, 'fake-claude'));
fs.writeFileSync(path.join(g, 'pack-src', 'Gate pack note.md'), '---\ntitle: "Gate pack note"\n---\nGate placeholder pack body {{topic}}\n');
fs.writeFileSync(path.join(g, 'pack-src', 'review-a-pr.md'), 'Gate placeholder: must NOT replace the fixture note');
console.log(JSON.stringify({ home, vault: docs.vault, bin: fake.bin, fakeLog: fake.log }));   // fake.env is a FUNCTION (a restricted PATH etc. for unit tests) — never applied to this shell
'@
Set-Content -LiteralPath (Join-Path $g 'seed.mjs') -Value $seed -Encoding utf8
Copy-Item -LiteralPath (Join-Path $g 'seed.mjs') -Destination '.\p3-gate-seed.tmp.mjs'   # imports resolve from the repo root
$fx = node .\p3-gate-seed.tmp.mjs $g | ConvertFrom-Json
Remove-Item -LiteralPath '.\p3-gate-seed.tmp.mjs'
$env:HQ_CLAUDE_HOME = $fx.home
$env:HQ_CLAUDE_DB   = Join-Path $g 'db\hub.sqlite'
$env:HQ_VAULT_DIR   = $fx.vault
$env:HQ_IMPORTS_DIR = Join-Path $g 'WorkspaceHQ Imports'; New-Item -ItemType Directory -Path $env:HQ_IMPORTS_DIR | Out-Null
$env:HQ_STUDIO_ROOT = Join-Path $g 'studio'; New-Item -ItemType Directory -Path $env:HQ_STUDIO_ROOT | Out-Null
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$env:HQ_CLAUDE_BIN  = $fx.bin
$env:FAKE_CLAUDE_LOG = $fx.fakeLog   # the shim's only setting (mode defaults to 'ok'); PATH is NOT touched — the instance's Hub needs the system node on PATH, and claude.cmd calls node by absolute path
$env:HQ_PACK_IMPORT = Join-Path $g 'pack-src'
$env:HQ_PACK_EXPORT = Join-Path $g 'out\gate-pack.zip'
$fixtureNoteHash = (Get-FileHash -LiteralPath (Join-Path $fx.vault '40_Resources\Prompts\review-a-pr.md')).Hash
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9511' -RedirectStandardOutput (Join-Path $g 'main.out') -RedirectStandardError (Join-Path $g 'main.err')
$p.Id   # the ONLY electron pid this task may stop
```

(`p3-gate-seed.tmp.mjs` sits in the repo root for one command only and is removed by literal path; never stage it. The chat run below uses the fake `claude` shim in read-only mode in the cwd of the first WorkspaceHQ project the instance lists — the shim reads nothing and writes only its log inside `$g`.)

Write `$g\gate-p3.mjs` (copy `connect()`, `ev()`, `until()` verbatim from the H5 gate), then these checks:

```js
// gate-p3.mjs <port> <gateDir> — prompt run + usage + packs real-instance gate (fixtures only). Never run against the owner's app.
import fs from 'node:fs';
import path from 'node:path';
const [port, g] = [Number(process.argv[2]), process.argv[3]];
/* connect(), ev(), until() — verbatim from the H5 gate */
const fails = [], report = {};
await connect(port);
if (!await until(`window.hq.claudeHub.health().then((h) => h.state === 'ready' && h.role === 'writer')`, 60000)) fails.push('hub never ready as the writer of the gate db');
if (!await until(`window.hq.claudeHub.documents({ source: 'prompt', limit: 50 }).then((r) => Array.isArray(r) && r.some((x) => /review-a-pr/.test(x.path)))`, 30000)) fails.push('fixture prompt not indexed');
const rows = await ev(`window.hq.claudeHub.documents({ source: 'prompt', limit: 50 })`);
const pr = rows.find((x) => /review-a-pr/.test(x.path));
const id = pr && pr.id;
const projId = await ev(`((window.WHQ && WHQ.app && WHQ.app.logic && WHQ.app.logic.M && WHQ.app.logic.M.P0) || []).filter((p) => p && p.id && p.path).map((p) => p.id)[0] || null`);   // the model's project list is M.P0 (store.js:67; cdp-gate uses WHQ.app.logic.M.P0) — there is no M.projects; main resolves the id through studioProjects (needs a path)
if (!projId) fails.push('no WorkspaceHQ project listed in the instance');
const run = (r) => ev(`window.hq.claudePrompts.run(${JSON.stringify(r)})`);
// refusals first: nothing may be counted for them
const bad = await run({ promptId: id, target: 'https://evil.example', vars: { file: 'a' }, projectId: projId });
if (!/runs only in Chat/.test(bad.error || '')) fails.push('bad target accepted: ' + JSON.stringify(bad));
const miss = await run({ promptId: id, target: 'claude.ai', vars: {} });
if (JSON.stringify((miss.missing || []).slice().sort()) !== '["file","project"]') fails.push('missing fields: ' + JSON.stringify(miss));
// the three real targets (dry mode for copy/terminal; the fake shim for chat)
await ev(`(window.__p3ev = [], window.hq.claudeChat.on((e) => window.__p3ev.push(e)), true)`);
const cp = await run({ promptId: id, target: 'claude.ai', vars: { file: 'gate.js' }, projectId: projId });
if (!cp.ok || !cp.dry || cp.usage !== 'recorded') fails.push('copy: ' + JSON.stringify(cp));
const tm = await run({ promptId: id, target: 'terminal', vars: { file: 'gate.js' }, projectId: projId });
if (!tm.ok || tm.usage !== 'recorded') fails.push('terminal: ' + JSON.stringify(tm));
const ch = await run({ promptId: id, target: 'chat', vars: { file: 'gate.js' }, projectId: projId });
if (!ch.ok || typeof ch.turnId !== 'string' || ch.usage !== 'recorded') fails.push('chat: ' + JSON.stringify(ch));
if (!await until(`window.__p3ev.some((e) => e.turnId === ${JSON.stringify(ch.turnId || '')} && (e.kind === 'done' || e.kind === 'error'))`, 60000)) fails.push('the chat turn never ended');
report.chatEnd = await ev(`(window.__p3ev.filter((e) => e.turnId === ${JSON.stringify(ch.turnId || '')}).pop() || {}).kind`);
// usage is real: exactly the three successful runs
const st = await ev(`window.hq.claudeHub.promptStats()`);
const mine = (Array.isArray(st) ? st : []).find((x) => x.prompt_id === id);
if (!mine || mine.uses !== 3) fails.push('promptStats: ' + JSON.stringify(st));
report.uses = mine && mine.uses;
// packs: plan → confirm; the fixture note is kept; export never replaces
const plan = await ev(`window.hq.claudePrompts.importPack({ from: 'folder' })`);
const names = (plan.notes || []).map((n) => n.name + (n.exists ? ':exists' : '')).sort();
if (JSON.stringify(names) !== '["gate-pack-note.md","review-a-pr.md:exists"]') fails.push('plan: ' + JSON.stringify(plan));
const done = await ev(`window.hq.claudePrompts.importPack({ planId: ${JSON.stringify(plan.planId || '')} })`);
if (done.imported !== 1 || !done.skipped || done.skipped.exists !== 1) fails.push('import: ' + JSON.stringify(done));
const again = await ev(`window.hq.claudePrompts.importPack({ planId: ${JSON.stringify(plan.planId || '')} })`);
if (!/expired/.test(again.error || '')) fails.push('a plan was usable twice');
const ex1 = await ev(`window.hq.claudePrompts.exportPack()`);
if (ex1.file !== 'gate-pack.zip' || ex1.notes !== 2) fails.push('export: ' + JSON.stringify(ex1));
const ex2 = await ev(`window.hq.claudePrompts.exportPack()`);
if (!/already there/.test(ex2.error || '')) fails.push('export replaced a file: ' + JSON.stringify(ex2));
report.promptFiles = fs.readdirSync(path.join(process.env.HQ_VAULT_DIR, '40_Resources', 'Prompts')).sort();
report.exportBytes = fs.statSync(path.join(g, 'out', 'gate-pack.zip')).size;
console.log(JSON.stringify({ fails, report }, null, 1));
process.exit(fails.length ? 1 : 0);
```

Run: `node "$g\gate-p3.mjs" 9511 $g ; $gateCode = $LASTEXITCODE`
Expected: `{"fails": [], …}`, `$gateCode` = 0; `report.uses` = 3; `report.promptFiles` = `["gate-pack-note.md", "review-a-pr.md"]`; `report.chatEnd` = `"done"`.

- [ ] **Step 3: The owner's things are untouched; stop only your instance; clean up.**

```powershell
if ((Get-FileHash -LiteralPath (Join-Path $fx.vault '40_Resources\Prompts\review-a-pr.md')).Hash -ne $fixtureNoteHash) { 'FAIL: a pack replaced an existing note' }
if ((& $snap $ownerRes) -ne $resBefore) { 'FAIL: the owner vault 40_Resources changed' }
$dataAfter = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
if ($dataAfter -ne $dataBefore) { 'FAIL: data\claude changed' }
if ((Get-Clipboard -Raw) -ne $clipBefore) { 'FAIL: the clipboard changed in dry mode' }
Select-String -Path (Join-Path $g 'logs\*.log') -Pattern 'gate.js', 'Gate placeholder' -SimpleMatch -Quiet   # must print False: app logs carry target, file name and counts, never prompt text
Stop-Process -Id $p.Id
Get-Process -Id $p.Id -ErrorAction SilentlyContinue   # nothing
Remove-Item -LiteralPath $g -Recurse -Force
Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_VAULT_DIR, Env:HQ_IMPORTS_DIR, Env:HQ_STUDIO_ROOT, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION, Env:HQ_CLAUDE_BIN, Env:HQ_PACK_IMPORT, Env:HQ_PACK_EXPORT, Env:FAKE_CLAUDE_LOG
```
Expected: no `FAIL:` line; `False` from Select-String (`main.out` is not checked for text: the existing `[dry-launch] <cwd> :: <prompt>` echo of `claude-launch.js` prints there by design); the owner's `electron.exe . --hidden` (no `--user-data-dir`) and its Hub child are still running (check `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine` — do NOT stop or restart it). Never run `tools\rollback.ps1` in this phase.

- [ ] **Step 4: Docs.**

`README.md` — in the Claude Hub section, after P2's harvest paragraph add: "Run a prompt: Claude › Prompts › Run (or a project page's \"Run a prompt\") opens a run box — pick the project (it fills `{{project}}` and `{{cwd}}`), fill the other `{{fields}}`, then choose **Chat** (in-app Claude Code chat, read-only unless you allow edits — uses your Claude quota), **Terminal** (opens Claude Code in the project folder — uses your Claude quota), **Copy for claude.ai** or **Copy for ChatGPT** (copies the prompt and opens claude.ai/new or chatgpt.com — nothing else is ever opened). Each successful run adds one to that prompt's usage count in the Library. **Import pack** (a ZIP or a folder of `.md` notes) shows what it will copy and asks once — notes already in the Prompts folder are kept, never replaced; **Export pack** saves the Prompts folder as a ZIP and never overwrites a file." In its test-commands list add `node --test dashboard/claude-prompt-pack.test.mjs` and the CDP scenarios `prompts-run-chat`, `prompts-run-copy`, `prompts-pack-import`.

`CLAUDE.md` — append one bullet to "Facts that save you time": "- Prompt runs + packs (P3): `claudePrompts.run` (main, `dashboard/claude-prompts.js`) reads the note from `HQ_VAULT_DIR/40_Resources/Prompts`, fills `{{vars}}` once (`{{project}}`/`{{cwd}}` from the picked project), then Chat = the H3 engine (`claudeChatEngine` in main.js, bound to the asking window), Terminal = `launchClaudeTerminal`, copy = clipboard + `https://claude.ai/new` / `https://chatgpt.com/` only; usage = Hub op `promptUse` (writer only; a reader says \"not recorded\"). Packs: `dashboard/claude-prompt-pack.js` (own CRC-32 — Electron 32's Node has no `zlib.crc32`); `HQ_PACK_IMPORT` / `HQ_PACK_EXPORT` replace the dialogs for gates; `HQ_DRY_LAUNCH=1` also stops the copy targets (`[dry-copy]`). No schema change (still 2)."

`docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` — re-read the P3 section against the landed code (`git diff <Task 1 commit>^ -- dashboard/preload.js dashboard/claude-prompts.js dashboard/claude-prompt-pack.js dashboard/claude-hub/hub.mjs dashboard/claude-hub/store.mjs dashboard/main.js`); fix any row that differs (additive wording only) and list the fixes in the commit body; if none, say "rows unchanged".

- [ ] **Step 5: HANDOFF entry.** Insert at the top of `docs/sync/HANDOFF.md` (below the format block and its `---`), with the real short sha (`git log -1 --format=%h` before this commit) and the local time in the heading:

```
## 2026-10-25 HH:MM · FROM frontend · main @ <short sha>
DONE: Prompt runs + usage + packs P3 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p3.md), commits P3.2–P3.11 + this meta commit:
  fillVariables (one pass; {{project}}/{{cwd}} from the picked project), Hub op promptUse (writer, queued; prompt_use now written),
  claudePrompts.run (note read from the vault, Chat via the H3 engine bound to the asking window, Terminal via launchClaudeTerminal,
  Copy for claude.ai/ChatGPT = clipboard + the two fixed URLs; usage only after success, "not recorded" said), packs (import plan →
  one confirm, new notes only, masked; export streamed, never replaces); v5 run modal with quota labels, pack dialog, Library refresh.
  Real second-instance gate on fixtures: PASS (<paste the gate report>).
IN-FLIGHT: none. The "AI archive sources + prompt library" program (H6, P1–P3) is complete.
  The owner's app was NOT restarted; it picks this up on its next restart (main.js changed: 2 lines; no schema change).
ASKS: none (no structure-lane file touched).
BREAKS: none. New IPC hq:claude-prompts:run|import-pack|export-pack (additive); Hub op promptUse (main only).
  main.js: the claude-chat init line now keeps its result (claudeChatEngine); the claude-prompts init line passes run/pack deps.
```

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: prompt runs + packs P3 done — real second-instance gate on fixtures (PASS), README/CLAUDE.md facts, contract rows checked, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` only if Step 4 changed them; `git add` of an unchanged file is harmless. Never stage the other lane's four files: `collector/collector.config.json`, `data/quest-overrides.json`, `run-scan.ps1`, `schema/workspace-scan.schema.json`.)

## Self-review (done while writing; kept for the executor)

- Spec coverage: §6.3 run modal (project picker defaulting to the page's project via P1 `prFor`, variable fields, Chat / Terminal / Copy for claude.ai / Copy for ChatGPT, quota label) → Tasks 8–11; §6.4 `run` (fill, chat → H3 `send` bound like `hq:claude-chat:send`, terminal → `launchClaudeTerminal`, the two fixed URLs only, `promptUse` logged) → Tasks 2, 4, 5; `importPack` / `exportPack` (Prompts folder only, streaming ZIP, never overwrite) → Tasks 6–7, 10; Hub ops `promptUse` / `promptStats` + `prompt_use` → Task 3 (+ P1's `promptStats`); usage on the Library → Task 8 (`refreshPrompts` after a recorded run) on P1's columns; §7 IPC `claudePrompts.run/importPack/exportPack` + `claudeHub.promptStats` → Tasks 1, 5, 7; §9 run target whitelist, open-link whitelist, pack never overwrites, CDP `prompts-run-chat` → Tasks 4, 6, 11; owner docs + HANDOFF + real gate → Task 12.
- Deviations are written at the top with reasons (paths never cross IPC; two-step pack import; richer `run` answer; body from disk; main-side `{{cwd}}`; renderer-driven usage refresh; masked packs; `promptStats` already in P1 / no schema bump).
- Names used across tasks: `bodyOf`, `fillVariables`, `RESERVED_VARS`, `VALUE_MAX`, `FILLED_MAX`; `PROMPT_TARGETS`, `addPromptUse`, op `promptUse`; `RUN_TARGETS`, `RUN_MODES`, `OPEN_URLS`, `titleOf`, `run(req, {sender})`, `sendChat`, `recordUse`, `loadPrompt`; `crc32`, `writeZip`, `readEntry`, `createPacks`, `importPack`, `exportPack`, `PACK_*`, `PLAN_TTL_MS`; channels `hq:claude-prompts:run|import-pack|export-pack`; env `HQ_PACK_IMPORT`, `HQ_PACK_EXPORT`; store `adoptClaudeTurn`, `runPrompt`, `packImport`, `packExport`; adapter `RUN_TARGETS_UI`, `runView`, `packView`; `runLogic` (`rnOpen … rnPackExport`), state `run`, `pack`; vals `rn*`; DOM `data-rn`, `data-rp`, `data-pk` — consistent across Tasks 1–12.
- Risky seams called out in-task: the H3 turn must be adopted by the renderer (Task 8 test + CDP); Electron 32 lacks `zlib.crc32` (Task 6 does not use the Hub's `extractEntries`); a reader Hub must not fail a run (Tasks 3–4); dry mode must not touch the clipboard (Tasks 4, 12).
- Executor checks that depend on earlier phases' exact markup/fixtures are anchored by `grep` (P1 search section, P1 selftest fixture names, P2 `closeTop` branch, P1 gate accessor) rather than guessed line numbers. The run modal's text input uses `onChange` (critic-verified: every text input in `claude.tpl.js` and P1's `data-pr="q"` use `onChange`, and `src/dc/runtime.js` `evType` maps `onChange` on a text `<input>` to the `input` event, so it fires per keystroke; the CDP scenario dispatches both `input` and `change`).

<!-- plan complete: 12 tasks -->
