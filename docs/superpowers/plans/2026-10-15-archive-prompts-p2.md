# Prompt harvest + Promote (phase P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude › Prompts gains a **Candidates** view: the owner's own reusable prompts harvested from every indexed source (Claude Code / claude.ai / ChatGPT user messages + `history.jsonl` lines), each with its score shown as plain reasons ("used in 3 sessions +9", "followed by 12 assistant messages +3") and its origin; **Promote** (one candidate or several, always behind one confirm) writes a NEW masked prompt note into `<vault>/40_Resources/Prompts/` (a name clash asks once more and offers `<slug>-2.md`); **Hide** tombstones a candidate so it never comes back.

**Architecture:** Hub side (system Node): a NEW pure module `dashboard/claude-hub/harvest.mjs` (normalize → exclude → group by normalized text → score with reasons → top N); `store.mjs` gains read helpers `harvestPool({limit})`, `promptBodies()`, `hiddenCandidates()` and the writer `hideCandidate(key)` (a row in the EXISTING `tombstone` table, kind `candidate` — no schema change); `hub.mjs` gains ops `promptCandidates` (readers allowed) and `hideCandidate` (writer, serialized); `claude-hub-host.js` `registerIpc` gains `hq:claude-hub:prompt-candidates` and `hq:claude-hub:hide-candidate`. Main side: `dashboard/claude-prompts.js` (P1 file) gains `promote(p)` (mask with the Hub's `maskSecrets` through dynamic `import()`, build the §6.1 note with P1's `promptNoteText`, write through P1's `writePromptNote` — atomic, contained, never overwriting) and the handler `hq:claude-prompts:promote` inside P1's `init` (no `main.js` line changes). v5: store slot `live.candidates` + `refreshCandidates`, adapter `candidateTitle` / `candidateRow` / `candidatesView`, a `candidatesLogic` mixin (`hc*`), a Library | Candidates toggle inside P1's `{{ isPrompts }}` block, a Promote confirm dialog in `extras.tpl.js`, selftest rows, goldens, CDP `prompts-promote-confirm` and `prompts-candidates-hide`.

**Tech Stack:** Node ≥ 22.13 `node:sqlite` (Hub; SQLite JSON1 `json_extract`), `node:crypto` sha1, `node:test`, Electron 32 main (CommonJS; ESM reached by `import(pathToFileURL(...))`), vanilla v5 renderer (template runtime `src/dc/runtime.js`), fake preload + CDP gate.

**Spec:** `docs/superpowers/specs/2026-10-15-archive-and-prompt-library-design.md` — §2 (vault path, honesty, secrets: "A promoted prompt is written masked"), §6.1 (note format, clash → `<slug>-2.md` after a confirm), §6.2 (harvest), §6.3 (Candidates: reasons, origin, Promote single/multi with one confirm, Hide = tombstone), §6.4 (`promote`), §7 (`promptCandidates`, `claudePrompts.promote`, Hub op `hideCandidate`), §8 (folder missing → Promote creates it; hidden candidates never resurface; logs carry counts only), §9 (harvest scoring tests, promote containment tests, CDP `prompts-promote-confirm`), §10 row P2. Hub base spec `docs/superpowers/specs/2026-10-13-claude-hub-design.md`. Earlier phases this plan builds on (they land first; their interfaces are relied on exactly): H6 `docs/superpowers/plans/2026-10-15-archive-prompts-h6.md` (schema 2 `document`, `listDocuments`, history documents `history:<sessionId>:<offset>` with `meta = {sessionId, project, pasted, at}`, prompt documents whose `text` is the masked note body, `changed.documents`, fixtures `makeDocsHome` / `historyLine`, the `pathToFileURL` dynamic-import pattern in `claude-imports.js`), P1 `docs/superpowers/plans/2026-10-15-archive-prompts-p1.md` (`claude-prompt-note.js`: `PROMPTS_REL`, `slugify`, `noteName`, `variablesOf`, `promptNoteText`, `promptDocId`; `claude-prompts.js`: `resolvePromptsDir`, `writePromptNote` → `{path,name}|{error}|{error,exists:true,next}`, `createPrompts`, `init`; v5 `live.prompts`, `promptsView`, `promptsLogic` `pr*`, `data-pr=*`, the `{{ isPrompts }}` block in `tpl/claude.tpl.js`). Exact live names at HEAD 4c8da80: `.superpowers/sdd/2026-10-16-code-map-archive.md` (H6 and P1 shift line numbers — anchor by text, never by number).

**Written deviations from the spec (the spec is the authority; each has its reason):**
1. **`claudeHub.hideCandidate(key)` / `hq:claude-hub:hide-candidate` is an IPC row §7 does not list** (§7 lists `hideCandidate` only as a Hub op). Reason: §6.3's Hide button lives in the renderer; the Hub is reachable only through main. Additive row.
2. **`promote` answers `{path, name, id}` where `path` is vault-relative (`40_Resources/Prompts/<name>`), not absolute** (§6.4 says `{ path }`). Reason: the renderer only shows it; P1 already keeps absolute paths out of the renderer (`status`, `open`). `id` lets the UI point at the new Library row.
3. **`promote` accepts an optional `name`, only when it equals `noteName(slugify(title), n)` for n ∈ 2…9.** Reason: §6.1 "a clash becomes `<slug>-2.md` after a confirm" needs a second call that says which name the owner confirmed; any other name (a path, `..`, another slug) is refused, so the renderer can never choose where the note goes.
4. **Multi-select Promote writes the non-clashing ones after the one confirm and reports each clashing one as "not written — a note with that name is there; promote it alone to save it as <slug>-2.md".** Reason: §6.3 "one confirm" for the batch and §6.1 "a clash becomes -2 after a confirm" would otherwise need a confirm per clash inside a batch; writing a `-2` name nobody confirmed would break §6.1. Single Promote does the full clash confirm.
5. **Two extra exclusions beyond §6.2's list: `<command-name>` / `<command-message>` openers, and messages from a sidechain (`is_sidechain = 1`) or carrying a `tool_name`.** Reason: in Claude Code transcripts these are the expansion of a slash command (§6.2 already excludes `/…`) and tool/sub-agent traffic (§6.2 already excludes tool roles) — the same exclusions, in the shapes the H1 parser stores them.
6. **The harvest pool is bounded: the newest 20 000 qualifying user messages and the newest 20 000 history lines.** Reason: the Candidates view must answer in seconds on the owner's whole index; the bound is shown in the view ("looked at the newest 20 000 …") whenever it was reached — never a silent cut.
7. **No `SCHEMA_VERSION` or `INDEX_VERSION` bump.** Reason: Hide is a row in the existing `tombstone(kind, native_id, at)` table (`kind` is free text; new kind `candidate`), and harvest reads rows H1–H6 already store; no table, column or parser shape changes. The CONTRACT entry still records the new tombstone kind.
8. **The default title of a promoted candidate is its first non-empty line, cut at a word boundary to ≤ 60 characters (`candidateTitle`), editable in the single-Promote confirm; multi-Promote uses the defaults.** Reason: candidates have no title and §6.4 `promote` requires one.

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
- Commits: explicit pathspecs (never git add -A), fe: / meta: prefixes, a truthful "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; never amend/rebase/reset/stash/checkout; on an index.lock error wait 5 s and retry (up to 5×). Never touch collector/, schema/, run-pipeline.ps1, run-scan.ps1, spellbook/, data/quest-overrides.json, collector/collector.config.json, legacy/.
- Processes: the owner's app (electron.exe . --hidden WITHOUT --user-data-dir and its Hub child) is never stopped; stop only PIDs you start (Stop-Process -Id). Second instances: from dashboard/: node_modules\electron\dist\electron.exe . --hidden --user-data-dir=%TEMP%\<unique> --remote-debugging-port=<your port> with the env overrides. Remove temp folders by literal path.
- Suites: node --test dashboard/claude-hub/*.test.mjs ; node --test dashboard/*.test.mjs ; v5: node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs ; selftest from dashboard-v5: HQ_V5_PROFILE=<unique> ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest (exit 0, 0/0/0); CDP: node dashboard-v5/tools/cdp-gate.mjs --scenario all against a --preload=fake harness.

Standing rulings (binding): Hub errors surface (never swallowed into empty results); the lock is {pid, db} JSON (live owner = node running hub.mjs on the same db); maskSecrets before any cut; message ids per conversation, usage per api_id; paging tiebreaks by (at, id); the spec is the authority and a plan may deviate only with a written reason; the spellbook/ directory is another lane — prompts are NOT spells.

Phase-local facts: after H6 the store is `SCHEMA_VERSION = 2` (`grep -n "SCHEMA_VERSION =" dashboard/claude-hub/store.mjs` must print `2`; if it prints `1`, STOP — H6 has not landed); **P2 changes no schema and no index shape** (deviation 7). The `tombstone` table and its prepared statements `st.tomb` / `st.isTomb` exist since H1 (store.mjs `tomb: q('INSERT OR IGNORE INTO tombstone…')`). Conversation tombstones use `native_id = <conversation id>` (e.g. `code:<sessionId>`). **`dashboard/main.js`: no line is touched in this phase** — P1's line `require('./claude-prompts').init({ ipcMain, app, shell, vaultDir: VAULT });` already wires `claude-prompts.js`; the new handler is registered inside its `init` (check: `grep -n "claude-prompts').init" dashboard/main.js` prints one line; if not, STOP — P1 has not landed). The owner's real vault has no `40_Resources/Prompts` folder today (`40_Resources` holds `Clippings/ Libraries/ Research/ docs/ pkos-docs.md`): the first Promote creates it (P1 `writePromptNote` → `resolvePromptsDir(…, {create:true})`). Vals keys of this phase start with `hc` (P1 took `pr*`, H6 `cd*`/`di*`) plus `isPrLib` / `isPrCand`; DOM hooks are `data-hc="…"`; the overlay state key is `promote`.

## Review Focus

1. **The same prompt typed into Claude Code shows up twice — once as a `history.jsonl` line and once as the transcript's user message of the same session — and the owner also pasted a long log into a prompt.** The owner expects it counted as ONE session (not "used in 2 sessions"), and the paste never offered. Pinned in Task 2 test `a history line and its transcript message are one session; pasted lines never pool` and Task 3 test `harvestPool: history rows carry sessionKey code:<sessionId> and pasted`.
2. **A candidate whose text holds a secret, or an owner who edits the title in the confirm to include one.** The owner expects the note on disk to carry `••• secret (…)`, never the secret, and the confirm to show the text as it will be written. Pinned in Task 5 test `promote masks the body and the title before writing`.
3. **Promote with a crafted or clashing name** — `name: '../x.md'`, `name: 'C:\\x.md'`, a name for another slug, `review-a-pr.md` already in the folder, the folder missing. The owner expects a refusal or a `-2` offer, never an overwrite, never a write outside `40_Resources/Prompts`. Pinned in Task 5 test `promote: name must be the title's slug or slug-2…-9; never overwrites; creates the folder`.
4. **Hide, then a new session repeats the same prompt (or the Hub re-indexes)** — and a Hide asked of a read-only second instance. The owner expects the hidden candidate never to come back, and the reader to say "another WorkspaceHQ owns the index", not pretend. Pinned in Task 3 test `hidden candidates survive resetCode and new rows` and Task 4 test `hideCandidate on a reader is refused with the reason`.
5. **A score shown without its reasons, a judgment word, or a Hub failure shown as "no candidates".** The owner expects every row to show each scored term with its points, zero-signal rows to say "seen in 1 session", and a Hub error to read as an error. Pinned in Task 2 test `reasons carry every term with its points and never a judgment word` and Task 6 test `candidatesView: a Hub error is never an empty list`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `docs/sync/IPC-CONTRACT.md` | modify (append P2 section before `## Rules`) | Rows `claudeHub.promptCandidates`, `claudeHub.hideCandidate`, `claudePrompts.promote` |
| `docs/sync/CONTRACT.md` | modify (`data/claude/` entry + P1 prompt-note entry) | Tombstone kind `candidate`; Promote writes new notes; `source.kind` values |
| `dashboard/claude-hub/harvest.mjs` | create | Pure: `HARVEST_MIN_CHARS`, `HARVEST_LIMIT_MAX`, `normalize`, `candidateKey`, `excludeReason`, `harvest(pool, {promptBodies, hidden, limit})` |
| `dashboard/claude-hub/harvest.test.mjs` | create | Scoring, exclusions, grouping, penalty, hidden, wording |
| `dashboard/claude-hub/store.mjs` | modify | `HARVEST_POOL_MAX`, `harvestPool`, `promptBodies`, `hiddenCandidates`, `hideCandidate` |
| `dashboard/claude-hub/store.test.mjs` | modify | Pool shape, forgotten sessions out, tombstone kind `candidate` |
| `dashboard/claude-hub/hub.mjs` | modify | Ops `promptCandidates`, `hideCandidate` |
| `dashboard/claude-hub/hub.test.mjs` | modify | Spawned-Hub op tests (writer + reader) |
| `dashboard/claude-hub-host.js` (+ `claude-hub-host.test.mjs`) | modify | IPC `prompt-candidates` (15 s), `hide-candidate` |
| `dashboard/claude-prompts.js` (+ `claude-prompts.test.mjs`) | modify | `PROMOTE_TEXT_MAX`, `createPrompts().promote`, handler `hq:claude-prompts:promote` in `init` |
| `dashboard/preload.js` | modify | `claudeHub.promptCandidates`, `claudeHub.hideCandidate`, `claudePrompts.promote` |
| `dashboard-v5/tools/fake-preload.js` | modify | 3 SPEC rows + `FAKE_CANDIDATES` |
| `dashboard-v5/src/live/adapter.mjs` (+ `adapter.test.mjs`) | modify | `candidateTitle`, `reasonText`, `candidateRow`, `candidatesView`; `promptsView` nofolder text gains "or promote a candidate" |
| `dashboard-v5/src/live/store.js` (+ `store.test.mjs`) | modify | `live.candidates`, `refreshCandidates`; `changed.documents` also refreshes candidates once loaded |
| `dashboard-v5/src/logic/prompt-candidates.js` (+ `.test.mjs`) | create | `candidatesLogic`: `hcView, hcLoad, hcToggle, hcAsk, hcTitle, hcGo, hcSaveAs, hcCancel, hcHide` |
| `dashboard-v5/src/app.js` | modify | mixin wiring; `initState` keys `prView`, `hcSel`, `promote`; `closeTop` order |
| `dashboard-v5/src/vals/prompt-candidates.js` | create | `candidatesVals` (`isPrLib`, `isPrCand`, `hc*`) |
| `dashboard-v5/src/vals/index.js` | modify | append `candidatesVals` to `SURFACES` |
| `dashboard-v5/src/tpl/claude.tpl.js` | modify | Library \| Candidates toggle + Candidates list inside `{{ isPrompts }}` |
| `dashboard-v5/src/tpl/extras.tpl.js` | modify | Promote confirm dialog `{{ hcOpen }}` |
| `dashboard-v5/src/tpl.hash.test.mjs` | modify | re-record SHA256/LENGTH/UTF8_BYTES + dated comment |
| `dashboard-v5/src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json` | modify | `claude.candidates-*` scenarios; attributed re-record |
| `dashboard-v5/src/selftest.js` | modify | `cand-*` STATES rows; `CLEAR` gains `prView`, `hcSel`, `promote`; `savedLive` gains `candidates` |
| `dashboard-v5/tools/cdp-gate.mjs` | modify | `prompts-promote-confirm`, `prompts-candidates-hide` |
| `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | modify | docs + handoff (last task) |

`dashboard/main.js`: **no line touched** (see Phase-local facts).

---

### Task 1: Contract rows first (IPC-CONTRACT P2 section + CONTRACT amendments)

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (new section directly before `## Rules`, after the P1 section)
- Modify: `docs/sync/CONTRACT.md` (the `data/claude/` entry and the P1 `40_Resources/Prompts/<slug>.md` entry)

**Interfaces:**
- Consumes: the P1 IPC section (`grep -n "phase P1 (rows written" docs/sync/IPC-CONTRACT.md` prints one line; if not, STOP: P1 has not landed) and P1's CONTRACT prompt-note entry (`grep -n "40_Resources/Prompts/<slug>.md" docs/sync/CONTRACT.md`).
- Produces: the names every later task uses, exactly: Hub ops `promptCandidates({limit?})`, `hideCandidate({key})`; store `harvestPool({limit})`, `promptBodies()`, `hiddenCandidates()`, `hideCandidate(key)`; preload `claudeHub.promptCandidates(opts)`, `claudeHub.hideCandidate(key)`, `claudePrompts.promote(p)`; channels `hq:claude-hub:prompt-candidates`, `hq:claude-hub:hide-candidate`, `hq:claude-prompts:promote`; candidate key format `cand:<40 hex>`; tombstone kind `candidate`.

- [ ] **Step 1: Write the IPC-CONTRACT section.** Insert verbatim before `## Rules`:

````markdown
## 2026-10-25 — Prompt library, phase P2 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.2, §6.3, §6.4, §7, §8. Hub ops in
`dashboard/claude-hub/hub.mjs` (`harvest.mjs` scores); host handlers in `dashboard/claude-hub-host.js` (`registerIpc`);
`promote` in `dashboard/claude-prompts.js` (P1 file; registered by its `init` — no `main.js` line changes).

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.promptCandidates(opts?)` | `hq:claude-hub:prompt-candidates` (invoke, 15 s) | `opts = {limit?}` (default 50, cap 200) → `{candidates:[{key, text, chars, score, reasons:[{key:'reuse'\|'turns'\|'length'\|'library', points, text}], sources:[{kind:'code'\|'web'\|'chatgpt'\|'history', conversationId?, documentId?, at, project}], sessions, lastAt}], pooled:{messages, history}, capped:{messages:boolean, history:boolean}, hidden}` \| `{error}`. `key` = `cand:<sha1 of the normalized text>`; `text` = the newest occurrence, trimmed, masked as indexed; `score` = the sum of the `reasons[].points` (2 decimals); order `score DESC, lastAt DESC, key`. Pool: user-role messages of `code`/`web`/`chatgpt` chats (no sidechain, no tool name) + `history` documents; at most the newest 20 000 of each (`capped` says when the bound was reached). Excluded: < 120 characters, starts with `/` or `<command-`, holds `••• secret (` or `<local-command`, pasted history lines. Readers allowed; no open index → `{error:'the index is not open yet'}` (never `[]`) |
| `claudeHub.hideCandidate(key)` | `hq:claude-hub:hide-candidate` (invoke) | in: `cand:<40 hex>` → `true` \| `{error}` (`'not a candidate key'`, `'read-only hub (another WorkspaceHQ owns the index)'`). Writes a `tombstone(kind 'candidate', native_id key)`; that text never comes back as a candidate, through re-index and new sessions alike. (§7 lists `hideCandidate` as a Hub op only; this row exists because the Hide button lives in the renderer — P2 deviation 1) |
| `claudePrompts.promote(p)` | `hq:claude-prompts:promote` (invoke) | `p = {text, title, tags?, source?:{kind:'code'\|'web'\|'chatgpt'\|'history', conversation, at}, name?}` → `{path:'40_Resources/Prompts/<name>', name, id:'prompt:<sha1>', masked:<number of masks applied now>}` \| `{error}` \| `{error, exists:true, next:'<slug>-2.md'\|null}` (a note of that name is there; nothing written). `text` ≤ 100 000 chars and `title` are masked (`maskSecrets`) BEFORE the note is built; the note is the §6.1 layout (P1 `promptNoteText`: `title`, `tags` (default `[harvested]`), `variables` (from `{{name}}` tokens), `version: 1`, `created`, `source`, `hq.id`). `name` is accepted only when it equals `<slugify(title)>-<n>.md`, n ∈ 2…9 (the name a clash answer offered and the owner confirmed); every other name is refused. Written only under `<vault>/40_Resources/Prompts/` (created when missing), atomically, never overwriting (P1 `writePromptNote`). `HQ_VAULT_DIR` overrides the vault (tests, gates). Logs carry the file name only, never prompt text. Never throws |
````

- [ ] **Step 2: Amend CONTRACT.md.** (a) In the `data/claude/` entry, append after the latest `(…, additive)` paragraph:

```markdown
(2026-10-25, P2, additive) `tombstone` gains kind `candidate` (`native_id` = `cand:<sha1 of the normalized prompt text>`,
written by the Hide button through the Hub op `hideCandidate`): that text is never offered as a prompt candidate again.
No schema or index-version change (`SCHEMA_VERSION` stays 2).
```

(b) In the P1 entry `### VEEMO CORTEX/40_Resources/Prompts/<slug>.md — prompt notes …`, append at the end of its paragraph:

```markdown
(2026-10-25, P2) The writer is Promote (`claudePrompts.promote`, Claude › Prompts › Candidates), one note per owner-confirmed
candidate; `source.kind` ∈ `code` | `web` | `chatgpt` | `history`, `source.conversation` = the Hub id the text came from
(`code:<sessionId>`, `web:<uuid>`, `chatgpt:<id>` or `history:<sessionId>:<offset>`), `tags: [harvested]` by default.
```

- [ ] **Step 3: Check the rows.**

Run (Git Bash): `sed -n '/phase P2 (rows written/,/^## Rules/p' docs/sync/IPC-CONTRACT.md | grep -c '^| .claude'`
Expected: `3`
Run: `grep -c "kind \`candidate\`" docs/sync/CONTRACT.md`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: P2 prompt harvest — IPC-CONTRACT rows (promptCandidates, hideCandidate, claudePrompts.promote) and CONTRACT tombstone kind candidate, before any handler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 1 -->

### Task 2: `harvest.mjs` — pure pool → scored candidates with reasons

**Files:**
- Create: `dashboard/claude-hub/harvest.mjs`
- Test: `dashboard/claude-hub/harvest.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; `node:crypto` only). The mask marker text is the H1 `MASK(name)` prefix `'••• secret ('` (redact.mjs:3) — imported as `MASK` from `./redact.mjs` so the two never drift.
- Produces (Task 3 builds rows of exactly this shape; Task 4 calls `harvest`):
  - Pool row: `{kind:'code'|'web'|'chatgpt'|'history', role:'user'|…, text, at:ISO|null, sessionKey:string, conversationId:string|null, documentId:string|null, project:string|null, turnsAfter:number (0…21; 21 = "more than 20"), pasted:boolean}`.
  - `HARVEST_MIN_CHARS = 120`, `HARVEST_LIMIT_MAX = 200`, `HARVEST_LIMIT = 50`, `LONG_CHARS = 300`, `TURNS_CAP = 20`, `MASK_MARK`.
  - `normalize(text) -> string` (NFKC, trim, whitespace collapsed to one space, lower-case).
  - `candidateKey(norm) -> 'cand:<sha1 hex>'`.
  - `excludeReason(row) -> null | 'source'|'role'|'pasted'|'short'|'slash'|'secret'|'local-command'`.
  - `harvest(pool, {promptBodies = [], hidden = new Set(), limit = 50} = {}) -> {candidates:[{key, text, chars, score, reasons:[{key, points, text}], sources:[{kind, conversationId?, documentId?, at, project}], sessions, lastAt}], hidden:number}` — sources ≤ 5, newest first.

- [ ] **Step 1: Write the failing test** `dashboard/claude-hub/harvest.test.mjs`:

```js
// Prompt harvest scoring (spec 2026-10-15 §6.2, phase P2). Pure; placeholder text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harvest, normalize, candidateKey, excludeReason, HARVEST_MIN_CHARS, HARVEST_LIMIT_MAX } from './harvest.mjs';
import { MASK } from './redact.mjs';

const long = (s, n = 130) => { let t = s; while (t.length < n) t += ' placeholder words'; return t; };
const A = long('Placeholder prompt alpha: review the placeholder module');
const B = long('Placeholder prompt beta: draft a placeholder plan');
let seq = 0;
const row = (o) => ({ kind: 'code', role: 'user', text: A, at: `2026-09-0${1 + (seq++ % 9)}T10:00:00Z`, sessionKey: 'code:s1',
  conversationId: 'code:s1', documentId: null, project: 'project-a', turnsAfter: 0, pasted: false, ...o });
const JUDGE = /\b(good|great|best|better|excellent|strong|quality|top|useful|recommended|valuable|effective|smart)\b/i;

test('normalize: NFKC, trim, collapsed whitespace, lower-case; key is cand:<sha1>', () => {
  assert.equal(normalize('  Hello\n\n  WORLD\t '), 'hello world');
  assert.equal(normalize('ﬁle'), 'file');
  assert.match(candidateKey('hello world'), /^cand:[0-9a-f]{40}$/);
  assert.equal(candidateKey('x'), candidateKey('x'));
});

test('excludeReason: every exclusion of §6.2 (+ slash-command expansions)', () => {
  assert.equal(excludeReason(row({})), null);
  assert.equal(excludeReason(row({ kind: 'memory' })), 'source');
  assert.equal(excludeReason(row({ role: 'assistant' })), 'role');
  assert.equal(excludeReason(row({ role: 'tool' })), 'role');
  assert.equal(excludeReason(row({ role: 'system' })), 'role');
  assert.equal(excludeReason(row({ kind: 'history', role: undefined, pasted: true })), 'pasted');
  assert.equal(excludeReason(row({ text: 'x'.repeat(HARVEST_MIN_CHARS - 1) })), 'short');
  assert.equal(excludeReason(row({ text: '   ' + 'x'.repeat(HARVEST_MIN_CHARS - 1) + '   ' })), 'short');
  assert.equal(excludeReason(row({ text: 'x'.repeat(HARVEST_MIN_CHARS) })), null);
  assert.equal(excludeReason(row({ text: '/review ' + A })), 'slash');
  assert.equal(excludeReason(row({ text: '<command-name>/review</command-name> ' + A })), 'slash');
  assert.equal(excludeReason(row({ text: A + ' ' + MASK('github-token') })), 'secret');
  assert.equal(excludeReason(row({ text: '<local-command-stdout>' + A })), 'local-command');
  assert.equal(excludeReason(row({ kind: 'history', role: undefined })), null);   // history lines have no role
});

test('a history line and its transcript message are one session; pasted lines never pool', () => {
  const r = harvest([
    row({ kind: 'history', role: undefined, documentId: 'history:s1:0', conversationId: null, sessionKey: 'code:s1' }),
    row({ conversationId: 'code:s1', sessionKey: 'code:s1' }),
    row({ kind: 'history', role: undefined, documentId: 'history:s2:0', conversationId: null, sessionKey: 'code:s2', text: B, pasted: true }),
  ]);
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.equal(c.sessions, 1);
  assert.deepEqual(c.reasons.find((x) => x.key === 'reuse'), { key: 'reuse', points: 0, text: 'seen in 1 session' });
  assert.equal(c.sources.length, 2);
});

test('reuse ×3 across ≥ 2 sessions; text differences of case and whitespace group together', () => {
  const r = harvest([
    row({ sessionKey: 'code:s1' }),
    row({ sessionKey: 'web:w1', kind: 'web', conversationId: 'web:w1', text: '  ' + A.toUpperCase().replace(/ /g, '\n ') }),
    row({ sessionKey: 'chatgpt:c1', kind: 'chatgpt', conversationId: 'chatgpt:c1' }),
  ]);
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0].reasons[0], { key: 'reuse', points: 9, text: 'used in 3 sessions' });
  assert.equal(r.candidates[0].score, 9);
});

test('productivity = min(turns after, 20) / 4, with the real count said', () => {
  const r = harvest([row({ turnsAfter: 12 }), row({ text: B, sessionKey: 'code:s9', turnsAfter: 21 }), row({ text: long('Placeholder gamma'), sessionKey: 'code:s8' })]);
  const by = (t) => r.candidates.find((c) => c.text === t.trim());
  assert.deepEqual(by(A).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 3, text: 'followed by 12 assistant messages' });
  assert.deepEqual(by(B).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 5, text: 'followed by more than 20 assistant messages (counted as 20)' });
  assert.deepEqual(by(long('Placeholder gamma')).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 0, text: 'no assistant message followed it' });
  // two occurrences: the larger follow-up counts
  const r2 = harvest([row({ turnsAfter: 2 }), row({ turnsAfter: 7, sessionKey: 'code:s2' })]);
  assert.equal(r2.candidates[0].reasons.find((x) => x.key === 'turns').points, 1.75);
});

test('length bonus 1 for ≥ 300 characters; already a prompt note −5 (normalized match)', () => {
  const L = long('Placeholder long prompt', 300);
  const r = harvest([row({ text: L }), row({ text: B, sessionKey: 'code:s2' })], { promptBodies: ['  ' + B.toUpperCase() + '\n'] });
  const l = r.candidates.find((c) => c.text === L), b = r.candidates.find((c) => c.text === B);
  assert.deepEqual(l.reasons.find((x) => x.key === 'length'), { key: 'length', points: 1, text: '300+ characters' });
  assert.equal(b.reasons.find((x) => x.key === 'length'), undefined);
  assert.deepEqual(b.reasons.find((x) => x.key === 'library'), { key: 'library', points: -5, text: 'already a prompt note' });
  assert.equal(b.score, -5);
});

test('hidden keys never come back and are counted', () => {
  const key = candidateKey(normalize(A));
  const r = harvest([row({}), row({ text: B, sessionKey: 'code:s2' })], { hidden: new Set([key]) });
  assert.deepEqual(r.candidates.map((c) => c.text), [B]);
  assert.equal(r.hidden, 1);
});

test('reasons carry every term with its points and never a judgment word; score = sum of points', () => {
  const r = harvest([row({ turnsAfter: 30, text: long('Placeholder delta', 320) }), row({ turnsAfter: 30, text: long('Placeholder delta', 320), sessionKey: 'code:s2' })],
    { promptBodies: [long('Placeholder delta', 320)] });
  const c = r.candidates[0];
  assert.deepEqual(c.reasons.map((x) => x.key), ['reuse', 'turns', 'length', 'library']);
  assert.equal(c.score, c.reasons.reduce((s, x) => s + x.points, 0));
  for (const x of c.reasons) { assert.equal(typeof x.points, 'number'); assert.doesNotMatch(x.text, JUDGE); }
});

test('order score DESC, lastAt DESC, key; limit default 50, cap 200; sources ≤ 5 newest first', () => {
  const pool = [];
  for (let i = 0; i < 260; i++) pool.push(row({ text: long('Placeholder prompt number ' + i), sessionKey: 'code:x' + i, at: `2026-09-01T10:${String(i % 60).padStart(2, '0')}:00Z` }));
  assert.equal(harvest(pool).candidates.length, 50);
  assert.equal(harvest(pool, { limit: 999 }).candidates.length, HARVEST_LIMIT_MAX);
  const many = [];
  for (let i = 0; i < 8; i++) many.push(row({ sessionKey: 'code:m' + i, at: `2026-09-0${1 + i}T10:00:00Z` }));
  many.push(row({ text: B, sessionKey: 'code:z', at: '2026-10-01T00:00:00Z' }));
  const c = harvest(many).candidates;
  assert.equal(c[0].text, A.trim());
  assert.equal(c[0].sources.length, 5);
  assert.equal(c[0].sources[0].at, '2026-09-08T10:00:00Z');
  assert.equal(c[0].lastAt, '2026-09-08T10:00:00Z');
  const tie = harvest([row({ text: B, sessionKey: 'code:q', at: '2026-01-01T00:00:00Z' }), row({ sessionKey: 'code:r', at: '2026-02-01T00:00:00Z' })]).candidates;
  assert.deepEqual(tie.map((x) => x.text), [A.trim(), B.trim()]);   // same score → newer first
  assert.equal(harvest(null).candidates.length, 0);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --test dashboard/claude-hub/harvest.test.mjs`
Expected: FAIL — `Cannot find module '…/harvest.mjs'`.

- [ ] **Step 3: Implement** `dashboard/claude-hub/harvest.mjs`:

```js
// Prompt harvest (spec 2026-10-15 §6.2, phase P2). Pure: no I/O, no store. Every scored term is returned as a
// reason {key, points, text}; the texts state facts (counts), never a judgment of the prompt.
import crypto from 'node:crypto';
import { MASK } from './redact.mjs';

export const HARVEST_MIN_CHARS = 120;
export const HARVEST_LIMIT = 50;
export const HARVEST_LIMIT_MAX = 200;
export const LONG_CHARS = 300;
export const TURNS_CAP = 20;
export const MASK_MARK = MASK('').slice(0, MASK('').indexOf('(') + 1);   // '••• secret ('
const KINDS = new Set(['code', 'web', 'chatgpt', 'history']);
const MAX_SOURCES = 5;
const pts = (n) => Math.round(n * 100) / 100;
const chars = (s) => [...s].length;

export function normalize(text) {
  return String(text == null ? '' : text).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export const candidateKey = (norm) => 'cand:' + crypto.createHash('sha1').update(String(norm)).digest('hex');

export function excludeReason(row) {
  const r = row && typeof row === 'object' ? row : {};
  if (!KINDS.has(r.kind)) return 'source';
  if (r.kind !== 'history' && r.role !== 'user') return 'role';
  if (r.pasted) return 'pasted';
  const t = String(r.text == null ? '' : r.text).trim();
  if (chars(normalize(t)) < HARVEST_MIN_CHARS) return 'short';
  if (t.startsWith('/') || /^<command-(name|message)>/.test(t)) return 'slash';
  if (t.includes(MASK_MARK)) return 'secret';
  if (t.includes('<local-command')) return 'local-command';
  return null;
}

const newer = (a, b) => String(b || '').localeCompare(String(a || ''));   // ISO strings; null/'' sort last

function reasonsOf(g, inLibrary) {
  const out = [];
  const s = g.sessions.size;
  out.push(s >= 2 ? { key: 'reuse', points: 3 * s, text: `used in ${s} sessions` } : { key: 'reuse', points: 0, text: 'seen in 1 session' });
  const t = g.turns;
  out.push(t > TURNS_CAP ? { key: 'turns', points: pts(TURNS_CAP / 4), text: `followed by more than ${TURNS_CAP} assistant messages (counted as ${TURNS_CAP})` }
    : t > 0 ? { key: 'turns', points: pts(t / 4), text: `followed by ${t} assistant message${t === 1 ? '' : 's'}` }
      : { key: 'turns', points: 0, text: 'no assistant message followed it' });
  if (g.chars >= LONG_CHARS) out.push({ key: 'length', points: 1, text: `${LONG_CHARS}+ characters` });
  if (inLibrary) out.push({ key: 'library', points: -5, text: 'already a prompt note' });
  return out;
}

export function harvest(pool, { promptBodies = [], hidden = new Set(), limit = HARVEST_LIMIT } = {}) {
  const lib = new Set((Array.isArray(promptBodies) ? promptBodies : []).map(normalize));
  const groups = new Map();
  let hiddenCount = 0;
  const hiddenSeen = new Set();
  for (const r of Array.isArray(pool) ? pool : []) {
    if (excludeReason(r)) continue;
    const norm = normalize(r.text);
    const key = candidateKey(norm);
    if (hidden.has(key)) { if (!hiddenSeen.has(key)) { hiddenSeen.add(key); hiddenCount++; } continue; }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, norm, occ: [], sessions: new Set(), turns: 0, chars: 0 }));
    g.occ.push(r);
    g.sessions.add(String(r.sessionKey || r.conversationId || r.documentId || ''));
    g.turns = Math.max(g.turns, Math.max(0, Math.min(Number(r.turnsAfter) || 0, TURNS_CAP + 1)));
  }
  const out = [];
  for (const g of groups.values()) {
    g.occ.sort((a, b) => newer(a.at, b.at));
    const text = String(g.occ[0].text).trim();
    g.chars = chars(text);
    const reasons = reasonsOf(g, lib.has(g.norm));
    out.push({
      key: g.key, text, chars: g.chars, score: pts(reasons.reduce((s, x) => s + x.points, 0)), reasons,
      sources: g.occ.slice(0, MAX_SOURCES).map((r) => ({ kind: r.kind, ...(r.conversationId ? { conversationId: r.conversationId } : {}),
        ...(r.documentId ? { documentId: r.documentId } : {}), at: r.at || null, project: r.project || null })),
      sessions: g.sessions.size, lastAt: g.occ[0].at || null,
    });
  }
  out.sort((a, b) => b.score - a.score || newer(a.lastAt, b.lastAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const n = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : HARVEST_LIMIT, HARVEST_LIMIT_MAX));
  return { candidates: out.slice(0, n), hidden: hiddenCount };
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `node --test dashboard/claude-hub/harvest.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/harvest.mjs dashboard/claude-hub/harvest.test.mjs
git commit -m "fe: P2 prompt harvest — pure harvest.mjs (normalize, exclusions, reuse/turns/length/library terms as reasons, hidden keys)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 2 -->

### Task 3: Store — `harvestPool`, `promptBodies`, `hiddenCandidates`, `hideCandidate` (no schema change)

**Files:**
- Modify: `dashboard/claude-hub/store.mjs`
- Test: `dashboard/claude-hub/store.test.mjs`

**Interfaces:**
- Consumes: H1 store internals `q(sql)` (prepared-statement helper inside `api(db)`), the `st` statement object (`st.tomb`), `ensureConversation`, `addMessages`, `upsertProject`, `forget`, `resetCode`; H6 `upsertDocument({id, source, path, title, text, projectId, projectPath, mtimeMs, size, meta})` and the `document` table (history `meta = {sessionId, project, pasted, at}` stored as JSON text); tables `message`, `conversation`, `project`, `tombstone`.
- Produces:
  - `export const HARVEST_POOL_MAX = 20000;`
  - `store.harvestPool({limit = HARVEST_POOL_MAX} = {}) -> {rows:[pool row of Task 2], pooled:{messages, history}, capped:{messages:boolean, history:boolean}}` — messages: `role = 'user'`, `is_sidechain = 0`, `tool_name IS NULL`, `length(text) >= 120`, conversation `source IN ('code','web','chatgpt')`, newest `limit` by `(at, id)`; `turnsAfter` = assistant messages after it in the same conversation by `(at, id)`, counted up to 21. History: `document.source = 'history'`, `length(text) >= 120`, valid `meta`, its session `code:<sessionId>` not tombstoned; `sessionKey = 'code:<sessionId>'` (or the document id when the line has no session); `turnsAfter` from the messages of `code:<sessionId>` after `meta.at`.
  - `store.promptBodies() -> string[]` (the masked body text of every `source = 'prompt'` document).
  - `store.hiddenCandidates() -> Set<string>`.
  - `store.hideCandidate(key) -> true` — throws `Error('not a candidate key')` unless `key` matches `^cand:[0-9a-f]{40}$`.

- [ ] **Step 1: Write the failing tests.** Append to `dashboard/claude-hub/store.test.mjs` (add `HARVEST_POOL_MAX` to its import from `./store.mjs`):

```js
// ---- P2 prompt harvest pool (spec 2026-10-15 §6.2); placeholder text only
const P2_LONG = (s) => { let t = s; while (t.length < 130) t += ' placeholder words'; return t; };
function p2Store() {
  const s = openStore(':memory:');
  s.upsertProject({ id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'project-a', path: 'C:\\placeholder\\project-a' });
  const conv = (id, source, projectId) => s.ensureConversation({ id, source, projectId, nativeId: id.split(':')[1] });
  conv('code:s1', 'code', 'code:C--placeholder-project-a');
  conv('code:s2', 'code', 'code:C--placeholder-project-a');
  conv('chatgpt:g1', 'chatgpt', null);
  const m = (cid, id, role, at, text, o = {}) => ({ id: `${cid}:${id}`, nativeId: id, parentId: null, role, at, text, toolName: null, isSidechain: false, ...o });
  s.addMessages('code:s1', [
    m('code:s1', 'u1', 'user', '2026-09-01T10:00:00Z', P2_LONG('Placeholder prompt alpha')),
    m('code:s1', 'a1', 'assistant', '2026-09-01T10:00:01Z', 'ok'),
    m('code:s1', 'a2', 'assistant', '2026-09-01T10:00:02Z', 'ok'),
    m('code:s1', 'u2', 'user', '2026-09-01T10:01:00Z', 'short'),
    m('code:s1', 'u3', 'user', '2026-09-01T10:02:00Z', P2_LONG('Placeholder tool result'), { toolName: 'Read' }),
    m('code:s1', 'u4', 'user', '2026-09-01T10:03:00Z', P2_LONG('Placeholder sidechain'), { isSidechain: true }),
  ]);
  s.addMessages('code:s2', [m('code:s2', 'u1', 'user', '2026-09-02T10:00:00Z', P2_LONG('Placeholder prompt in a chat to forget'))]);
  s.addMessages('chatgpt:g1', [m('chatgpt:g1', 'u1', 'user', '2026-09-03T10:00:00Z', P2_LONG('Placeholder prompt alpha'))]);
  const hist = (sid, off, text, pasted, at) => s.upsertDocument({ id: `history:${sid}:${off}`, source: 'history', path: null, title: null, text,
    projectId: null, projectPath: 'C:\\placeholder\\project-a', mtimeMs: null, size: null, meta: { sessionId: sid, project: 'C:\\placeholder\\project-a', pasted, at } });
  hist('s1', 0, P2_LONG('Placeholder prompt alpha'), false, '2026-09-01T09:59:59Z');
  hist('s1', 400, P2_LONG('Placeholder pasted log'), true, '2026-09-01T10:05:00Z');
  hist('s2', 0, P2_LONG('Placeholder prompt in a chat to forget'), false, '2026-09-02T09:59:59Z');
  s.upsertDocument({ id: 'prompt:p1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\a.md', title: 'A', text: 'Placeholder body', projectId: null, projectPath: null, mtimeMs: 1, size: 1, meta: { title: 'A' } });
  return s;
}

test('harvestPool: user messages only (no tool, no sidechain, ≥ 120 chars), turns after by (at, id), project name', () => {
  const s = p2Store();
  const { rows, pooled, capped } = s.harvestPool();
  const msgs = rows.filter((r) => r.kind !== 'history');
  assert.deepEqual(msgs.map((r) => r.conversationId).sort(), ['chatgpt:g1', 'code:s1', 'code:s2']);
  const a = msgs.find((r) => r.conversationId === 'code:s1');
  assert.equal(a.role, 'user');
  assert.equal(a.turnsAfter, 2);
  assert.equal(a.project, 'project-a');
  assert.equal(a.sessionKey, 'code:s1');
  assert.equal(a.documentId, null);
  assert.equal(a.pasted, false);
  assert.deepEqual(pooled, { messages: 3, history: 3 });
  assert.deepEqual(capped, { messages: false, history: false });
  assert.equal(HARVEST_POOL_MAX, 20000);
  s.close();
});

test('harvestPool: history rows carry sessionKey code:<sessionId> and pasted', () => {
  const s = p2Store();
  const h = s.harvestPool().rows.filter((r) => r.kind === 'history');
  const first = h.find((r) => r.documentId === 'history:s1:0');
  assert.equal(first.sessionKey, 'code:s1');
  assert.equal(first.conversationId, null);
  assert.equal(first.turnsAfter, 2);         // the two assistant messages after 09:59:59 in code:s1
  assert.equal(first.at, '2026-09-01T09:59:59Z');
  assert.equal(first.project, 'project-a');  // basename of the typed-in project path
  assert.equal(h.find((r) => r.documentId === 'history:s1:400').pasted, true);
  s.close();
});

test('harvestPool: a forgotten chat and its history lines leave the pool', () => {
  const s = p2Store();
  assert.equal(s.forget({ conversationId: 'code:s2' }), true);
  const rows = s.harvestPool().rows;
  assert.equal(rows.some((r) => r.conversationId === 'code:s2' || r.sessionKey === 'code:s2'), false);
  s.close();
});

test('harvestPool: the bound is applied newest-first and reported', () => {
  const s = p2Store();
  const r = s.harvestPool({ limit: 2 });
  assert.deepEqual(r.rows.filter((x) => x.kind !== 'history').map((x) => x.conversationId), ['chatgpt:g1', 'code:s2']);
  assert.deepEqual(r.capped, { messages: true, history: true });
  assert.deepEqual(r.pooled, { messages: 2, history: 2 });
  s.close();
});

test('promptBodies lists prompt-note bodies only', () => {
  const s = p2Store();
  assert.deepEqual(s.promptBodies(), ['Placeholder body']);
  s.close();
});

test('hidden candidates survive resetCode and new rows; only cand:<sha1> keys are accepted', () => {
  const s = p2Store();
  const key = 'cand:' + 'a'.repeat(40);
  assert.equal(s.hideCandidate(key), true);
  assert.equal(s.hideCandidate(key), true);   // idempotent
  for (const bad of ['', 'cand:xyz', 'conversation:code:s1', 'cand:' + 'A'.repeat(40), null]) assert.throws(() => s.hideCandidate(bad), /not a candidate key/);
  s.resetCode();   // drops every code conversation (code:s1 included); tombstones stay
  s.ensureConversation({ id: 'code:s1', source: 'code', projectId: null, nativeId: 's1' });
  s.addMessages('code:s1', [{ id: 'code:s1:u9', nativeId: 'u9', parentId: null, role: 'user', at: '2026-09-09T10:00:00Z', text: P2_LONG('Placeholder new row'), toolName: null, isSidechain: false }]);
  assert.deepEqual([...s.hiddenCandidates()], [key]);
  assert.equal(s.isTombstoned('candidate', key), true);
  s.close();
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL — `HARVEST_POOL_MAX` is not exported / `s.harvestPool is not a function`.

- [ ] **Step 3: Implement.** In `dashboard/claude-hub/store.mjs`:

(a) Under `export const SCHEMA_VERSION = …;` add:

```js
export const HARVEST_POOL_MAX = 20000;   // P2: newest user messages / history lines the harvest looks at (each)
```

(b) In the `st` statement object (the block that holds `tomb: q('INSERT OR IGNORE INTO tombstone…')`), add:

```js
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
```

(c) In the returned API object, next to `isTombstoned`, add:

```js
    harvestPool({ limit = HARVEST_POOL_MAX } = {}) {
      const n = Math.max(1, Math.min(Math.floor(Number(limit)) || HARVEST_POOL_MAX, HARVEST_POOL_MAX));
      const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || null : null);
      const msgs = st.poolMsgs.all(n + 1), hist = st.poolHist.all(n + 1);
      const rows = msgs.slice(0, n).map((r) => ({ kind: r.source, role: 'user', text: r.text, at: r.at || null, sessionKey: r.cid,
        conversationId: r.cid, documentId: null, project: r.project || null, turnsAfter: Number(r.turns) || 0, pasted: false }))
        .concat(hist.slice(0, n).map((r) => ({ kind: 'history', role: null, text: r.text, at: r.at || null,
          sessionKey: r.sid ? 'code:' + r.sid : r.id, conversationId: null, documentId: r.id,
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
```

- [ ] **Step 4: Run them to see them pass.**

Run: `node --test dashboard/claude-hub/store.test.mjs dashboard/claude-hub/harvest.test.mjs`
Expected: PASS. Then the whole Hub suite: `node --test dashboard/claude-hub/*.test.mjs` → PASS (no schema or index change: the H6 migration test and `index_version` tests are untouched).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs
git commit -m "fe: P2 prompt harvest — store harvestPool (bounded, turns after, history sessions), promptBodies, hideCandidate tombstones (no schema change)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 3 -->

### Task 4: Hub ops `promptCandidates` / `hideCandidate` + host IPC `prompt-candidates` / `hide-candidate`

**Files:**
- Modify: `dashboard/claude-hub/hub.mjs` (import + two entries in `const ops = {…}`)
- Modify: `dashboard/claude-hub-host.js` (`registerIpc`)
- Test: `dashboard/claude-hub/hub.test.mjs`, `dashboard/claude-hub-host.test.mjs`

**Interfaces:**
- Consumes: Task 2 `harvest(pool, {promptBodies, hidden, limit})`; Task 3 `store.harvestPool()`, `store.promptBodies()`, `store.hiddenCandidates()`, `store.hideCandidate(key)`; hub.mjs internals `store`, `writer`, `notOwner()` (throws `read-only hub (another WorkspaceHQ owns the index)`), `serial(fn)`; hub.test.mjs helpers `startHub(env, db)` → `{req(op,args) -> {ok, result|error}, until, ready, stop}`, `tmp(prefix)`, fixture `makeClaudeHome(dir)`; host `registerIpc` locals `h(ch, fn)`, `bool(r, why)`, `obj(o)`.
- Produces:
  - Op `promptCandidates({limit?}) -> {candidates, pooled, capped, hidden}` (readers allowed; no store → throws `'the index is not open yet'`).
  - Op `hideCandidate({key}) -> true` (writer only, serialized; bad key → `'not a candidate key'`).
  - IPC `hq:claude-hub:prompt-candidates (o)` → `host.request('promptCandidates', {limit: o.limit}, {timeout: 15000})`; `hq:claude-hub:hide-candidate (key)` → `bool(await host.request('hideCandidate', {key: String(key || '').slice(0, 60)}), 'nothing to hide')`.

- [ ] **Step 1: Write the failing tests.** (a) Append to `dashboard/claude-hub/hub.test.mjs` (add `import { openStore } from './store.mjs';` if the file does not import it yet):

```js
// ---- P2 prompt harvest ops. A chatgpt chat is seeded straight into the db: the Hub's code-index rebuild (resetCode) never touches it.
function seedHarvest(db) {
  const s = openStore(db);
  s.ensureConversation({ id: 'chatgpt:g1', source: 'chatgpt', projectId: null, nativeId: 'g1' });
  let text = 'Placeholder harvested prompt for the hub test'; while (text.length < 130) text += ' placeholder words';
  s.addMessages('chatgpt:g1', [{ id: 'chatgpt:g1:u1', nativeId: 'u1', parentId: null, role: 'user', at: '2026-09-03T10:00:00Z', text, toolName: null, isSidechain: false },
    { id: 'chatgpt:g1:a1', nativeId: 'a1', parentId: 'u1', role: 'assistant', at: '2026-09-03T10:00:05Z', text: 'ok', toolName: null, isSidechain: false }]);
  s.close();
  return text;
}

test('promptCandidates scores the pool with reasons; hideCandidate tombstones it for good', async () => {
  const dir = tmp('hub-harvest-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const text = seedHarvest(db);
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await a.until(() => a.events.some((e) => e.event === 'ready')));
    const r = (await a.req('promptCandidates', {})).result;
    const c = r.candidates.find((x) => x.text === text);
    assert.ok(c, 'the seeded chatgpt prompt is a candidate');
    assert.match(c.key, /^cand:[0-9a-f]{40}$/);
    assert.deepEqual(c.reasons.map((x) => x.key), ['reuse', 'turns']);
    assert.equal(c.reasons[1].text, 'followed by 1 assistant message');
    assert.equal(c.sources[0].conversationId, 'chatgpt:g1');
    assert.equal(r.capped.messages, false);
    assert.equal(typeof r.pooled.messages, 'number');
    const bad = await a.req('hideCandidate', { key: 'nope' });
    assert.equal(bad.ok, false); assert.match(bad.error, /not a candidate key/);
    assert.equal((await a.req('hideCandidate', { key: c.key })).result, true);
    const after = (await a.req('promptCandidates', {})).result;
    assert.equal(after.candidates.some((x) => x.key === c.key), false);
    assert.equal(after.hidden, 1);
    await a.req('reindex');
    assert.equal((await a.req('promptCandidates', {})).result.candidates.some((x) => x.key === c.key), false);
  } finally { await a.stop(); }
});

test('hideCandidate on a reader is refused with the reason; promptCandidates still answers', async () => {
  const dir = tmp('hub-harvest-two-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  seedHarvest(db);
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await a.until(() => a.events.some((e) => e.event === 'ready')));
    const b = startHub({ HQ_CLAUDE_HOME: home }, db);
    try {
      assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready')));
      assert.equal((await b.req('health')).result.role, 'reader');
      const r = await b.req('promptCandidates', { limit: 5 });
      assert.equal(r.ok, true); assert.ok(r.result.candidates.length >= 1);
      const hide = await b.req('hideCandidate', { key: r.result.candidates[0].key });
      assert.equal(hide.ok, false); assert.match(hide.error, /read-only hub \(another WorkspaceHQ owns the index\)/);
    } finally { await b.stop(); }
  } finally { await a.stop(); }
});
```

(b) In `dashboard/claude-hub-host.test.mjs`, test `registerIpc maps every channel…`: add `'hq:claude-hub:hide-candidate'` and `'hq:claude-hub:prompt-candidates'` to the sorted key list (keep every key H6/P1 added), and append:

```js
test('registerIpc: prompt-candidates (15 s, only limit passes) and hide-candidate (false → {error})', async () => {
  const h = {}, calls = [];
  const host = { health: async () => ({}), request: async (op, args, o) => { calls.push([op, args, o]); return op === 'hideCandidate' ? false : { candidates: [] }; } };
  registerIpc({ handle: (ch, fn) => { h[ch] = fn; } }, host);
  await h['hq:claude-hub:prompt-candidates']({}, { limit: 7, sql: 'x' });
  assert.deepEqual(calls.at(-1), ['promptCandidates', { limit: 7 }, { timeout: 15000 }]);
  await h['hq:claude-hub:prompt-candidates']({}, 'junk');
  assert.deepEqual(calls.at(-1).slice(0, 2), ['promptCandidates', { limit: undefined }]);
  assert.deepEqual(await h['hq:claude-hub:hide-candidate']({}, 'cand:' + 'a'.repeat(40)), { error: 'nothing to hide' });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['hideCandidate', { key: 'cand:' + 'a'.repeat(40) }]);
  await h['hq:claude-hub:hide-candidate']({}, 'x'.repeat(500));
  assert.equal(calls.at(-1)[1].key.length, 60);
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test dashboard/claude-hub/hub.test.mjs dashboard/claude-hub-host.test.mjs`
Expected: FAIL — `unknown op` for `promptCandidates`; the host key list lacks the two channels.

- [ ] **Step 3: Implement.** (a) `dashboard/claude-hub/hub.mjs`: add `import { harvest } from './harvest.mjs';` beside the other local imports, and inside `const ops = {` directly after the `contextFor:` entry:

```js
    // P2 prompt harvest (spec 2026-10-15 §6.2). Read-only: readers answer it too. No open index is an error, never [].
    promptCandidates: (a) => {
      if (!store) throw new Error('the index is not open yet');
      const pool = store.harvestPool();
      const r = harvest(pool.rows, { promptBodies: store.promptBodies(), hidden: store.hiddenCandidates(), limit: a && a.limit });
      return { candidates: r.candidates, pooled: pool.pooled, capped: pool.capped, hidden: r.hidden };
    },
    // Hide = a tombstone (kind 'candidate'); writes, so it takes its turn in the queue like forget.
    hideCandidate: (a) => { if (!writer) notOwner(); return serial(() => store.hideCandidate(a && a.key)); },
```

(b) `dashboard/claude-hub-host.js`, in `registerIpc` after the `forget` handler line:

```js
  // P2 prompt harvest: the whole pool is scored per ask (≤ 2 × 20 000 rows), hence the longer timeout
  h('prompt-candidates', (_e, o) => host.request('promptCandidates', { limit: obj(o).limit }, { timeout: 15000 }));
  h('hide-candidate', async (_e, key) => bool(await host.request('hideCandidate', { key: String(key || '').slice(0, 60) }), 'nothing to hide'));
```

- [ ] **Step 4: Run them to see them pass.**

Run: `node --test dashboard/claude-hub/*.test.mjs` then `node --test dashboard/claude-hub-host.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs dashboard/claude-hub-host.js dashboard/claude-hub-host.test.mjs
git commit -m "fe: P2 prompt harvest — Hub ops promptCandidates (readers too) and hideCandidate (writer, queued), IPC prompt-candidates / hide-candidate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 4 -->

### Task 5: Main — `claudePrompts.promote` (masked, contained, never overwriting) + preload + fake-preload parity

**Files:**
- Modify: `dashboard/claude-prompts.js` (requires, `PROMOTE_TEXT_MAX`, `maskText`, `sourceOf`, `createPrompts(...).promote`, one handler in `init`, exports)
- Modify: `dashboard/preload.js` (`claudeHub` block + P1 `claudePrompts` block)
- Modify: `dashboard-v5/tools/fake-preload.js` (`FAKE_CANDIDATES` + 3 SPEC rows)
- Test: `dashboard/claude-prompts.test.mjs`; parity is checked by the existing `dashboard-v5/tools/fake-preload.test.mjs`

**Interfaces:**
- Consumes: P1 `claude-prompt-note.js` `PROMPTS_REL`, `slugify`, `noteName`, `variablesOf`, `promptNoteText`, `promptDocId`; P1 `writePromptNote(vaultDir, {name, text}) -> {path, name}|{error}|{error, exists:true, next}`; P1 `createPrompts({vaultDir, openExternal, openPath, protocolName, env, log})` and `init({ipcMain, app, shell, vaultDir, env, log})`; Hub `dashboard/claude-hub/redact.mjs` `maskSecrets(s) -> {text, hits}` and `MASK(name)` (ESM — reached with `import(pathToFileURL(...).href)`, the H6 `claude-imports.js` pattern; Electron 32's Node cannot `require()` ESM).
- Produces:
  - `PROMOTE_TEXT_MAX = 100000`; `SOURCE_KINDS = ['code', 'web', 'chatgpt', 'history']`; `sourceOf(s) -> {kind, conversation, at}|null`.
  - `createPrompts({…, now = () => new Date()})` gains `promote(p) -> Promise<{path:'40_Resources/Prompts/<name>', name, id, masked}|{error}|{error, exists:true, next}>` — never throws.
  - IPC `hq:claude-prompts:promote (p)` (registered in P1's `init`; non-object `p` → `{}`).
  - Preload `claudeHub.promptCandidates(opts)`, `claudeHub.hideCandidate(key)`, `claudePrompts.promote(p)`.
  - Fake: `FAKE_CANDIDATES` (3 rows, keys `cand:111…`, `cand:222…`, `cand:333…`), canned `promptCandidates` answer `{candidates: FAKE_CANDIDATES, pooled:{messages:42, history:17}, capped:{messages:false, history:false}, hidden:0}`, `hideCandidate` WRITE, `promote` → `{path, name:'<fake slug>.md', id:'prompt:' + 'c'.repeat(40), masked:0}`.

- [ ] **Step 1: Write the failing tests.** Append to `dashboard/claude-prompts.test.mjs` (it already imports `test`, `assert`, `fs`, `os`, `path` and the module as `prompts` from P1; add those that are missing):

```js
// ---- P2 Promote (spec 2026-10-15 §6.1, §6.4, §8). Temp vaults only; the secret is built at runtime.
const SECRET = () => 'gh' + 'p_' + 'A'.repeat(36);
function p2Vault() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p2-vault-')); }
function p2Make(vaultDir, o = {}) {
  const logs = [];
  const p = prompts.createPrompts({ vaultDir, openExternal: async () => {}, openPath: async () => '', protocolName: () => '', env: {},
    log: (s) => logs.push(s), now: () => new Date('2026-10-25T10:00:00Z'), ...o });
  return { p, logs };
}
const PDIR = (v) => path.join(v, '40_Resources', 'Prompts');

test('promote masks the body and the title before writing; creates the folder; §6.1 layout', async () => {
  const v = p2Vault(); const { p, logs } = p2Make(v);
  const r = await p.promote({ text: 'Review {{file}} with the placeholder token ' + SECRET() + ' and list changes.', title: 'Placeholder review ' + SECRET(),
    source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-09-01T10:00:00Z' } });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.match(r.name, /^placeholder-review-.*\.md$/);
  assert.equal(r.path, '40_Resources/Prompts/' + r.name);
  assert.match(r.id, /^prompt:[0-9a-f]{40}$/);
  assert.equal(r.masked, 2);
  const file = path.join(PDIR(v), r.name), src = fs.readFileSync(file, 'utf8');
  assert.equal(src.includes(SECRET()), false);
  assert.match(src, /••• secret \(github-token\)/);
  assert.match(src, /^---\ntitle: "Placeholder review ••• secret \(github-token\)"\ntags: \[harvested\]\nvariables: \[file\]\nversion: 1\ncreated: 2026-10-25T10:00:00.000Z\n/);
  assert.match(src, /\nsource: \{ kind: code, conversation: "code:sess-a1", at: "2026-09-01T10:00:00Z" \}\n/);
  assert.ok(src.includes(`hq: { id: "${r.id}" }`));
  assert.equal(r.id, note.promptDocId(path.join(path.resolve(v), '40_Resources', 'Prompts', r.name)));
  assert.equal(logs.some((l) => l.includes('placeholder token')), false);   // logs carry the file name only
});

test("promote: name must be the title's slug or slug-2…-9; never overwrites; creates the folder", async () => {
  const v = p2Vault(); const { p } = p2Make(v);
  const base = { text: 'Placeholder prompt body for the clash test.', title: 'Review a PR' };
  fs.mkdirSync(PDIR(v), { recursive: true });
  fs.writeFileSync(path.join(PDIR(v), 'review-a-pr.md'), 'OWNER NOTE');
  const c1 = await p.promote(base);
  assert.deepEqual(c1, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-2.md' });
  assert.equal(fs.readFileSync(path.join(PDIR(v), 'review-a-pr.md'), 'utf8'), 'OWNER NOTE');
  for (const name of ['../x.md', 'C:\\x.md', '..\\review-a-pr-2.md', 'other-2.md', 'review-a-pr-10.md', 'review-a-pr.md', 'review-a-pr-2.txt', 'sub/review-a-pr-2.md', 7]) {
    const r = await p.promote({ ...base, name });
    assert.match(String(r.error), /not one this title can take/, 'refused: ' + name);
  }
  const ok = await p.promote({ ...base, name: 'review-a-pr-2.md' });
  assert.equal(ok.name, 'review-a-pr-2.md');
  assert.deepEqual(fs.readdirSync(PDIR(v)).sort(), ['review-a-pr-2.md', 'review-a-pr.md']);
  assert.equal(fs.readdirSync(v).join(','), '40_Resources');
  const again = await p.promote({ ...base, name: 'review-a-pr-2.md' });
  assert.deepEqual(again, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-3.md' });
});

test('promote refuses empty / oversized / non-object input and a missing vault; drops a forged source', async () => {
  const v = p2Vault(); const { p } = p2Make(v);
  assert.match((await p.promote(null)).error, /prompt text is empty/);
  assert.match((await p.promote({ text: '   ' })).error, /prompt text is empty/);
  assert.match((await p.promote({ text: 'x'.repeat(100001), title: 't' })).error, /over 100 000 characters/);
  assert.match((await p2Make(null).p.promote({ text: 'Placeholder', title: 't' })).error, /no vault folder is configured/);
  assert.match((await p2Make(path.join(v, 'missing')).p.promote({ text: 'Placeholder', title: 't' })).error, /vault folder was not found/);
  const r = await p.promote({ text: 'Placeholder prompt without a title line', source: { kind: 'evil', conversation: 'javascript:alert(1)', at: 'x' } });
  assert.equal(r.name, 'placeholder-prompt-without-a-title-line.md');   // title defaults to the first non-empty line
  const src = fs.readFileSync(path.join(PDIR(v), r.name), 'utf8');
  assert.equal(/\nsource:/.test(src), false);
  const r2 = await p.promote({ text: 'Placeholder second', title: 'Second', source: { kind: 'web', conversation: 'javascript:alert(1)', at: 'not a date' } });
  assert.match(fs.readFileSync(path.join(PDIR(v), r2.name), 'utf8'), /\nsource: \{ kind: web, conversation: "", at: "" \}\n/);
});

test('init registers hq:claude-prompts:promote; junk input becomes {} and answers {error}', async () => {
  const v = p2Vault(); const h = {};
  prompts.init({ ipcMain: { handle: (ch, fn) => { h[ch] = fn; } }, app: { getApplicationNameForProtocol: () => '' }, shell: {}, vaultDir: v, env: {}, log: () => {} });
  assert.ok(h['hq:claude-prompts:promote']);
  assert.match((await h['hq:claude-prompts:promote']({}, 'junk')).error, /prompt text is empty/);
  const ok = await h['hq:claude-prompts:promote']({}, { text: 'Placeholder via ipc', title: 'Via IPC' });
  assert.equal(ok.name, 'via-ipc.md');
});
```

`note` is P1's existing default import of `./claude-prompt-note.js` in this test file (`import note from './claude-prompt-note.js';`, P1 Task 3); no new import is needed.

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `p.promote is not a function`.

- [ ] **Step 3: Implement** in `dashboard/claude-prompts.js`.

(a) Requires (merge with the existing ones): `const { pathToFileURL } = require('url');` and extend the note-module destructure to `const { PROMPTS_REL, slugify, noteName, variablesOf, promptNoteText, promptDocId } = require('./claude-prompt-note');`.

(b) Above `createPrompts`:

```js
// ---- P2 Promote (spec 2026-10-15 §6.1, §6.4). The Hub's masker is ESM: reached through import() (Electron 32 cannot require ESM).
const PROMOTE_TEXT_MAX = 100000;
const SOURCE_KINDS = ['code', 'web', 'chatgpt', 'history'];
let redactMod = null;
async function maskText(s) {
  if (!redactMod) redactMod = await import(pathToFileURL(path.join(__dirname, 'claude-hub', 'redact.mjs')).href);
  return redactMod.maskSecrets(String(s));
}
// A harvested note's provenance: only these kinds, an id-shaped conversation and an ISO time survive; anything else is blanked.
function sourceOf(s) {
  if (!s || typeof s !== 'object' || !SOURCE_KINDS.includes(s.kind)) return null;
  const conversation = typeof s.conversation === 'string' && /^(code|web|chatgpt|history):[A-Za-z0-9:._-]{1,280}$/.test(s.conversation) ? s.conversation : '';
  const at = typeof s.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z?$/.test(s.at) ? s.at : '';
  return { kind: s.kind, conversation, at };
}
```

(c) Change the `createPrompts` parameter list to `({ vaultDir, openExternal, openPath, protocolName, env = {}, log = () => {}, now = () => new Date() })` and add this method to the returned object (after `open`):

```js
    // Writes ONE new note the owner confirmed. Masks body + title first; the file name is the title's slug, or the
    // slug-2…-9 name a clash answer offered (and the owner confirmed) — never a name of the renderer's choosing.
    async promote(p) {
      try {
        const o = p && typeof p === 'object' ? p : {};
        if (typeof o.text !== 'string' || !o.text.trim()) return { error: 'nothing to promote — the prompt text is empty' };
        if (o.text.length > PROMOTE_TEXT_MAX) return { error: 'that prompt is over 100 000 characters' };
        if (!vaultDir) return { error: 'no vault folder is configured' };
        const body = await maskText(o.text.replace(/\r\n/g, '\n').trim());
        const first = o.text.split('\n').find((l) => l.trim()) || '';
        const title = await maskText((typeof o.title === 'string' && o.title.trim() ? o.title : first).slice(0, 400));
        const t = title.text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled prompt';
        const slug = slugify(t);
        let name = noteName(slug);
        if (o.name !== undefined) {
          const offered = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => noteName(slug, n));
          if (!offered.includes(o.name)) return { error: 'that file name is not one this title can take — promote again to get the offered name' };
          name = o.name;
        }
        const tags = Array.isArray(o.tags) && o.tags.length ? o.tags.slice(0, 10) : ['harvested'];
        const id = promptDocId(path.join(path.resolve(vaultDir), ...PROMPTS_REL, name));
        const text = promptNoteText({ title: t, tags, variables: variablesOf({}, body.text), created: now().toISOString(),
          source: sourceOf(o.source), id, body: body.text });
        const r = await writePromptNote(vaultDir, { name, text });
        if (r.error) return r;
        log('[prompts] promoted ' + r.name);
        return { path: PROMPTS_REL.join('/') + '/' + r.name, name: r.name, id, masked: body.hits + title.hits };
      } catch (e) { return { error: why(e) }; }
    },
```

(d) In `init`, after the `hq:claude-prompts:open` handler (P1's `init` names the `createPrompts` result `p`): `ipcMain.handle('hq:claude-prompts:promote', (_e, req) => p.promote(req && typeof req === 'object' && !Array.isArray(req) ? req : {}));`

(e) Extend `module.exports` with `PROMOTE_TEXT_MAX, SOURCE_KINDS, sourceOf`.

(f) `dashboard/preload.js`: in the `claudeHub: {` block after `reindex:` add

```js
    // Prompt library P2: harvest candidates (scored, with reasons) and Hide (a tombstone)
    promptCandidates: (opts) => ipcRenderer.invoke('hq:claude-hub:prompt-candidates', opts),
    hideCandidate: (key) => ipcRenderer.invoke('hq:claude-hub:hide-candidate', key),
```

and in P1's `claudePrompts: {` block add `promote: (p) => ipcRenderer.invoke('hq:claude-prompts:promote', p),`.

(g) `dashboard-v5/tools/fake-preload.js`: above `SPEC` add

```js
// P2 harvest candidates (placeholder text; reasons are the Hub's own wording)
const FAKE_CANDIDATES = [
  { key: 'cand:' + '1'.repeat(40), text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file, with the reason for each change, in plain words.',
    chars: 139, score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
    sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' },
      { kind: 'history', documentId: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z', project: 'project-a' }] },
  { key: 'cand:' + '2'.repeat(40), text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks, then point out every step that has no check yet.',
    chars: 127, score: 3.25, sessions: 1, lastAt: '2026-09-15T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 3.25, text: 'followed by 13 assistant messages' }],
    sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-15T10:00:00Z', project: null }] },
  { key: 'cand:' + '3'.repeat(40), text: 'Placeholder prompt three: ' + 'summarize the placeholder notes into a short list of decisions and open questions. '.repeat(4).trim(),
    chars: 360, score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 0, text: 'no assistant message followed it' },
      { key: 'length', points: 1, text: '300+ characters' }, { key: 'library', points: -5, text: 'already a prompt note' }],
    sources: [{ kind: 'web', conversationId: 'web:placeholder-web-1', at: '2026-09-01T10:00:00Z', project: 'claude.ai chats' }] },
];
const fakeSlug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'prompt';
```

and in `SPEC` beside the other `claudeHub.*` rows:

```js
    ['claudeHub.promptCandidates', () => ({ candidates: FAKE_CANDIDATES, pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0 })],
    ['claudeHub.hideCandidate', WRITE],
    ['claudePrompts.promote', (p) => { const name = (p && p.name) || fakeSlug(p && p.title) + '.md'; return { path: '40_Resources/Prompts/' + name, name, id: 'prompt:' + 'c'.repeat(40), masked: 0 }; }],
```

Fix the `chars` numbers to the real `[...text].length` of each fake text before committing (`node -e` over the three strings) — the fake must not carry an invented count.

- [ ] **Step 4: Run them to see them pass.**

Run: `node --test dashboard/claude-prompts.test.mjs dashboard-v5/tools/fake-preload.test.mjs` then `node --test dashboard/*.test.mjs`
Expected: PASS (the fake-parity test sees the 3 new preload methods on both sides).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs dashboard/preload.js dashboard-v5/tools/fake-preload.js
git commit -m "fe: P2 Promote — claudePrompts.promote (masked body+title, slug or confirmed slug-N only, atomic, never overwrites); preload promptCandidates/hideCandidate/promote + fake parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 5 -->

### Task 6: v5 data layer — adapter `candidateTitle` / `candidateRow` / `candidatesView`, store slot `live.candidates`

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (+ `adapter.test.mjs`)
- Modify: `dashboard-v5/src/live/store.js` (+ `store.test.mjs`)

**Interfaces:**
- Consumes: preload `claudeHub.promptCandidates({limit})` (Task 4 shape); adapter private helpers `obj`, `arr`, `num`, `whenOf(iso, now)` (adapter.mjs:12-14, :482) and H6's `SOURCE_LABEL = {code:'Code', web:'claude.ai', chatgpt:'ChatGPT'}`; P1 `promptsView` (its `nofolder` text); store internals `live`, `emit`, `askHq(f)`, `isObj(x)` (P1), the Hub `changed` branch P1 extended with `e.data.documents`; store.test.mjs helpers `libHq(overrides) -> {hq, fire}` (P1/H2), `DATA()`.
- Produces:
  - adapter `CAND_TITLE_MAX = 60`; `candidateTitle(text) -> string` (first non-empty line, whitespace collapsed, cut at the last space inside 60 chars when that space is past char 30, else at 60; trailing punctuation dropped; `'Untitled prompt'` when empty); `reasonText(r) -> 'used in 3 sessions +9'` (`−` U+2212 for negatives); `ORIGIN_LABEL = {code:'Claude Code', web:'claude.ai', chatgpt:'ChatGPT', history:'Claude Code prompt history'}`; `candidateRow(c, {selected = [], now}) -> {key, text, title, score, scoreText, reasons:[{key, text}], why, origin, more, sessions, selected, inLibrary, source}` (`source` = the `{kind, conversation, at}` Promote writes: newest source, `conversation` = its `conversationId || documentId`); `candidatesView(C, {hasBridge, selected, now}) -> {state:'nobridge'|'loading'|'error'|'empty'|'list', text, rows, count, poolNote}`.
  - `promptsView` `nofolder` text becomes `No prompts folder yet — create <vault>/40_Resources/Prompts and add notes there, or promote a candidate (Promote creates the folder); edits you make in Obsidian show up here.` (restores spec §8's clause; P1 deviation 7 said P2 would).
  - store `live.candidates = {rows:null, pooled:null, capped:null, hidden:0, error:null, busy:false, loaded:false}`; `refreshCandidates() -> Promise`; the Hub `changed` branch re-asks when `live.candidates.loaded` and a `prompt:` document changed (the −5 "already a prompt note" term lands after the Hub indexes a promoted note).

- [ ] **Step 1: Write the failing adapter tests.** Append to `dashboard-v5/src/live/adapter.test.mjs` (add `candidateTitle, reasonText, candidateRow, candidatesView, promptsView` to its import from `./adapter.mjs` — `promptsView` may already be there):

```js
// ---- P2 harvest candidates (spec 2026-10-15 §6.2/§6.3)
const NOW = Date.parse('2026-10-25T12:00:00Z');
const CAND = { key: 'cand:' + '1'.repeat(40), text: 'Placeholder prompt one: review the module\nand list changes', chars: 60, score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
  reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
  sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' }, { kind: 'history', documentId: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z', project: 'project-a' }] };
const JUDGE = /\b(good|great|best|better|excellent|strong|quality|top|useful|recommended|valuable|effective|smart)\b/i;

test('candidateTitle: first line, word-boundary cut ≤ 60, never empty', () => {
  assert.equal(candidateTitle('\n\n  Review   the module \nsecond line'), 'Review the module');
  const t = candidateTitle('Placeholder words that keep going and going until the line is far longer than sixty characters in all');
  assert.ok([...t].length <= 60); assert.ok(!/[\s,.;:-]$/.test(t)); assert.ok('Placeholder words that keep going and going until the line'.startsWith(t));
  assert.equal(candidateTitle('x'.repeat(80)), 'x'.repeat(60));
  assert.equal(candidateTitle('   '), 'Untitled prompt');
  assert.equal(candidateTitle(null), 'Untitled prompt');
});

test('candidateRow: reasons with points, origin, provenance for Promote; no judgment word', () => {
  const r = candidateRow(CAND, { selected: [CAND.key], now: NOW });
  assert.equal(r.title, 'Placeholder prompt one: review the module');
  assert.equal(r.scoreText, 'score 11');
  assert.deepEqual(r.reasons.map((x) => x.text), ['used in 3 sessions +9', 'followed by 8 assistant messages +2']);
  assert.equal(r.why, 'used in 3 sessions +9 · followed by 8 assistant messages +2');
  assert.match(r.origin, /^Claude Code · project-a · /);
  assert.equal(r.more, '+1 more place');
  assert.equal(r.selected, true);
  assert.equal(r.inLibrary, false);
  assert.deepEqual(r.source, { kind: 'code', conversation: 'code:sess-a1', at: '2026-10-01T10:00:00Z' });
  assert.equal(reasonText({ points: -5, text: 'already a prompt note' }), 'already a prompt note −5');
  assert.equal(reasonText({ points: 0, text: 'seen in 1 session' }), 'seen in 1 session +0');
  const h = candidateRow({ ...CAND, sources: [CAND.sources[1]], reasons: [...CAND.reasons, { key: 'library', points: -5, text: 'already a prompt note' }] }, { now: NOW });
  assert.match(h.origin, /^Claude Code prompt history · project-a/);
  assert.equal(h.more, ''); assert.equal(h.inLibrary, true); assert.equal(h.selected, false);
  assert.deepEqual(h.source, { kind: 'history', conversation: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z' });
  for (const x of [r.why, r.origin, h.why, h.origin, r.scoreText]) assert.doesNotMatch(x, JUDGE);
});

test('candidatesView: a Hub error is never an empty list; empty states say why; the pool bound is said', () => {
  assert.equal(candidatesView({}, { hasBridge: false }).state, 'nobridge');
  const err = candidatesView({ rows: [], error: 'Claude Hub: timeout' }, { now: NOW });
  assert.equal(err.state, 'error'); assert.match(err.text, /^Claude Hub: timeout — /); assert.equal(err.rows.length, 0);
  assert.equal(candidatesView({ rows: null }, { now: NOW }).state, 'loading');
  const none = candidatesView({ rows: [], pooled: { messages: 0, history: 0 } }, { now: NOW });
  assert.equal(none.state, 'empty'); assert.match(none.text, /no user message or history line of 120\+ characters/);
  const all = candidatesView({ rows: [], pooled: { messages: 12, history: 3 }, hidden: 2 }, { now: NOW });
  assert.equal(all.state, 'empty'); assert.match(all.text, /^None of the 15 prompts looked at qualify/);
  const list = candidatesView({ rows: [CAND], pooled: { messages: 42, history: 17 }, capped: { messages: true, history: false }, hidden: 1 }, { now: NOW });
  assert.equal(list.state, 'list'); assert.equal(list.count, 1);
  assert.equal(list.poolNote, 'Looked at 42 chat messages and 17 prompt-history lines (the newest 20 000 chat messages only — older ones were not looked at) · 1 hidden · scores are counts, not a rating.');
  assert.equal(candidatesView({ rows: [CAND], pooled: { messages: 1, history: 0 }, capped: { messages: false, history: false } }, { now: NOW }).poolNote,
    'Looked at 1 chat message and 0 prompt-history lines · scores are counts, not a rating.');
});

test('promptsView nofolder text offers Promote again (spec §8)', () => {
  const v = promptsView({ rows: [], status: { vault: 'VEEMO CORTEX', folder: { exists: false } } }, {});
  assert.equal(v.text, 'No prompts folder yet — create VEEMO CORTEX/40_Resources/Prompts and add notes there, or promote a candidate (Promote creates the folder); edits you make in Obsidian show up here.');
});
```

- [ ] **Step 2: Write the failing store test.** Append to `dashboard-v5/src/live/store.test.mjs`:

```js
test('P2 candidates: nothing until asked; loads; errors say why; a prompt-note change re-scores', async () => {
  let fail = false, asked = 0;
  const { hq, fire } = libHq({ promptCandidates: (o) => (asked++, Promise.resolve(fail ? { error: 'timeout' }
    : { candidates: [{ key: 'cand:' + '1'.repeat(40), text: 'x', reasons: [], sources: [] }], pooled: { messages: 1, history: 0 }, capped: { messages: false, history: false }, hidden: 0 })) });
  const st = createStore(DATA(), hq); await st.start();
  assert.equal(st.live.candidates.rows, null); assert.equal(asked, 0);
  await st.refreshCandidates();
  assert.equal(st.live.candidates.rows.length, 1); assert.equal(st.live.candidates.loaded, true); assert.equal(st.live.candidates.error, null);
  fail = true; await st.refreshCandidates();
  assert.equal(st.live.candidates.error, 'Claude Hub: timeout');
  assert.equal(st.live.candidates.rows.length, 1, 'an error keeps the last rows but the view shows the error');
  fail = false;
  fire({ event: 'changed', data: { ids: [], documents: ['prompt:abc'] } });
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 3);
  fire({ event: 'changed', data: { ids: [], documents: ['memory:abc'] } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 3, 'only prompt documents move the −5 term');
});

test('P2 candidates: no bridge → refreshCandidates is a no-op', async () => {
  const st = createStore(DATA(), null);
  await st.refreshCandidates();
  assert.equal(st.live.candidates.rows, null);
});
```

(`libHq(over)` is the H2 helper in this file (`function libHq(over = {})`): it spreads `...over` into `hq.claudeHub`, so `promptCandidates` passes straight through — no helper change. `fire(e)` (from `hubHq`) pushes one `hq:claude-hub:event` payload; `askHq` is P1's store helper.)

- [ ] **Step 3: Run them to see them fail.**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `candidateTitle` is not exported; `st.refreshCandidates is not a function`; the nofolder text differs.

- [ ] **Step 4: Implement.** (a) `dashboard-v5/src/live/adapter.mjs`, after P1's `promptsView`:

```js
// ---- P2 harvest candidates (spec 2026-10-15 §6.2/§6.3). Scores are shown as their terms; the wording states counts only.
export const CAND_TITLE_MAX = 60;
export const ORIGIN_LABEL = { code: 'Claude Code', web: 'claude.ai', chatgpt: 'ChatGPT', history: 'Claude Code prompt history' };
export function candidateTitle(text) {
  const one = (String(text == null ? '' : text).split('\n').map((l) => l.trim()).find(Boolean) || '').replace(/\s+/g, ' ');
  const cps = [...one];
  if (!cps.length) return 'Untitled prompt';
  if (cps.length <= CAND_TITLE_MAX) return one;
  const cut = cps.slice(0, CAND_TITLE_MAX).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '') || 'Untitled prompt';
}
export const reasonText = (r) => { const p = num(obj(r).points); return `${obj(r).text || ''} ${p < 0 ? '−' + Math.abs(p) : '+' + p}`; };
export function candidateRow(c, { selected = [], now = Date.now() } = {}) {
  const x = obj(c), src = arr(x.sources).map(obj), first = src[0] || {};
  const reasons = arr(x.reasons).map((r) => ({ key: obj(r).key, text: reasonText(r) }));
  const when = whenOf(first.at, now);
  const origin = [ORIGIN_LABEL[first.kind] || 'unknown source', first.project || '', when].filter(Boolean).join(' · ');
  const n = src.length - 1;
  return {
    key: x.key, text: String(x.text || ''), title: candidateTitle(x.text), score: num(x.score), scoreText: `score ${num(x.score)}`,
    reasons, why: reasons.map((r) => r.text).join(' · '), origin, more: n > 0 ? `+${n} more place${n === 1 ? '' : 's'}` : '',
    sessions: num(x.sessions), selected: arr(selected).includes(x.key), inLibrary: arr(x.reasons).some((r) => obj(r).key === 'library'),
    source: first.kind ? { kind: first.kind, conversation: first.conversationId || first.documentId || '', at: first.at || '' } : null,
  };
}
export function candidatesView(C, { hasBridge = true, selected = [], now = Date.now() } = {}) {
  const c = obj(C), pooled = obj(c.pooled), capped = obj(c.capped);
  const out = (state, text, rows = []) => ({ state, text, rows, count: rows.length, poolNote: '' });
  if (!hasBridge) return out('nobridge', 'Prompt candidates need the WorkspaceHQ app — this preview has no bridge to the Claude Hub.');
  if (c.error) return out('error', `${c.error} — candidates cannot be scored until the Claude Hub answers.`);
  if (!Array.isArray(c.rows)) return out('loading', 'Scoring your prompts…');
  const m = num(pooled.messages), h = num(pooled.history);
  if (!c.rows.length) {
    if (m + h === 0) return out('empty', 'No prompts to look at yet — the Claude Hub has no user message or history line of 120+ characters.');
    return out('empty', `None of the ${m + h} prompts looked at qualify (each is under 120 characters, a slash command, a paste, holds a masked secret, or was hidden).`);
  }
  const v = out('list', '', c.rows.map((r) => candidateRow(r, { selected, now })));
  const cap = [capped.messages ? 'chat messages' : '', capped.history ? 'prompt-history lines' : ''].filter(Boolean);
  v.poolNote = `Looked at ${m} chat message${m === 1 ? '' : 's'} and ${h} prompt-history line${h === 1 ? '' : 's'}`
    + (cap.length ? ` (the newest 20 000 ${cap.join(' and ')} only — older ones were not looked at)` : '')
    + (num(c.hidden) ? ` · ${num(c.hidden)} hidden` : '') + ' · scores are counts, not a rating.';
  return v;
}
```

In P1's `promptsView`, replace the `nofolder` text with: `` `No prompts folder yet — create ${where} and add notes there, or promote a candidate (Promote creates the folder); edits you make in Obsidian show up here.` ``

(b) `dashboard-v5/src/live/store.js`: add `candidates: { rows: null, pooled: null, capped: null, hidden: 0, error: null, busy: false, loaded: false },` to the `live` object (after P1's `prompts`), and after P1's `openPrompt`:

```js
  // Prompt library P2 — harvest candidates are scored by the Hub on ask (never polled)
  let candSeq = 0;
  function refreshCandidates() {
    const C = live.candidates;
    if (!hq || !hq.claudeHub || !hq.claudeHub.promptCandidates) return Promise.resolve();
    const my = ++candSeq;
    C.busy = true; C.loaded = true; emit();
    return askHq(() => hq.claudeHub.promptCandidates({ limit: 50 })).then((r) => {
      if (my !== candSeq) return;
      C.busy = false;
      if (!isObj(r) || r.error) C.error = 'Claude Hub: ' + ((isObj(r) && r.error) || 'no answer');
      else { C.error = null; C.rows = Array.isArray(r.candidates) ? r.candidates : []; C.pooled = r.pooled || null; C.capped = r.capped || null; C.hidden = Number(r.hidden) || 0; }
      emit();
    });
  }
```

In the `changed` branch, next to P1's prompt line, add:

```js
        if (live.candidates.loaded && Array.isArray(e.data && e.data.documents) && e.data.documents.some((d) => String(d).startsWith('prompt:'))) refreshCandidates();
```

Add `refreshCandidates` to the returned store object.

- [ ] **Step 5: Run them to see them pass.**

Run: `node --test dashboard-v5/src/live/*.test.mjs`
Expected: PASS (P1's `promptsView` tests still pass: they match the text's start only).

- [ ] **Step 6: Commit**

```bash
git add dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs
git commit -m "fe: P2 v5 data — candidate rows/view (reasons with points, origin, pool bound said), live.candidates + refreshCandidates; nofolder text offers Promote again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 6 -->

### Task 7: v5 actions — `candidatesLogic` mixin (view toggle, select, one-confirm Promote with the clash step, Hide) + app.js wiring

**Files:**
- Create: `dashboard-v5/src/logic/prompt-candidates.js`
- Test: `dashboard-v5/src/logic/prompt-candidates.test.mjs`
- Modify: `dashboard-v5/src/app.js` (import, `Object.assign` list, `initState`, `closeTop`)

**Interfaces:**
- Consumes: Task 6 `candidateRow`, store `refreshCandidates()`, `live.candidates`; P1 store `refreshPrompts()`; preload `claudePrompts.promote(p)`, `claudeHub.hideCandidate(key)`; Component helpers `state`, `setState(patch|fn)`, `toast(kind, text)`, `canWrite()`, `writeReason()`, `denied(why)`, `call(fn, label)` (null = already toasted), `forceUpdate()`, getters `store`, `hq`, `LIVE`.
- Produces: `candidatesLogic = { hcView(view), hcLoad(), hcToggle(key), hcAsk(key?), hcTitle(e), hcGo(), hcSaveAs(), hcDone(P, results) (internal: never bound in a template), hcCancel(), hcHide(key) }`; exported `NOT_WRITTEN(next)` text; state keys `prView: 'library'|'candidates'` (default `'library'`), `hcSel: string[]`, `promote: null | {seq, keys, items:[{key, title, text, source}], phase:'ask'|'saving'|'clash'|'done', clash:{next}|null, results:[{title, ok, name?, error?}], error:null}` — none persisted (no storage key). `closeTop` closes `promote` right after `vault`.

- [ ] **Step 1: Write the failing test** `dashboard-v5/src/logic/prompt-candidates.test.mjs`:

```js
// Candidates actions (spec 2026-10-15 §6.3, phase P2). A plain object stands in for the Component.
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesLogic, NOT_WRITTEN } from './prompt-candidates.js';

const K1 = 'cand:' + '1'.repeat(40), K2 = 'cand:' + '2'.repeat(40);
const ROWS = [
  { key: K1, text: 'Placeholder one\nmore', reasons: [], sources: [{ kind: 'code', conversationId: 'code:s1', at: '2026-10-01T10:00:00Z', project: 'p' }] },
  { key: K2, text: 'Placeholder two', reasons: [], sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:g1', at: '2026-09-01T10:00:00Z', project: null }] },
];
function rig({ promote, hide, canWrite = true } = {}) {
  const c = Object.assign(Object.create(candidatesLogic), {
    state: { prView: 'library', hcSel: [], promote: null }, toasts: [], promoted: [], refreshed: { cand: 0, prompts: 0 },
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    toast(kind, text) { this.toasts.push([kind, text]); },
    canWrite: () => canWrite, writeReason: () => 'read-only preview', denied(why) { this.toasts.push(['denied', why]); },
    forceUpdate() {},
    async call(fn) { try { const r = await fn(); if (r && r.error) { this.toasts.push(['error', r.error]); return null; } return r; } catch (e) { this.toasts.push(['error', String(e)]); return null; } },
  });
  c.store = { live: { candidates: { rows: ROWS.slice(), loaded: false, hidden: 0 } },
    refreshCandidates() { c.refreshed.cand++; this.live.candidates.loaded = true; return Promise.resolve(); },
    refreshPrompts() { c.refreshed.prompts++; return Promise.resolve(); } };
  c.hq = { claudePrompts: { promote: async (p) => { c.promoted.push(p); return promote ? promote(p, c.promoted.length) : { path: '40_Resources/Prompts/x.md', name: 'x.md', id: 'prompt:x', masked: 0 }; } },
    claudeHub: { hideCandidate: async (k) => (hide ? hide(k) : true) } };
  return c;
}

test('hcView switches and loads candidates once', async () => {
  const c = rig();
  c.hcView('candidates');
  assert.equal(c.state.prView, 'candidates'); assert.equal(c.refreshed.cand, 1);
  c.hcView('library'); c.hcView('candidates');
  assert.equal(c.refreshed.cand, 1, 'already loaded: no second ask');
  c.hcView('junk'); assert.equal(c.state.prView, 'candidates');
});

test('hcToggle selects; hcAsk opens ONE confirm for the selection; nothing is written before hcGo', () => {
  const c = rig();
  c.hcAsk(); assert.deepEqual(c.toasts.at(-1), ['info', 'Tick one or more candidates first.']);
  c.hcToggle(K1); c.hcToggle(K2); c.hcToggle(K2); c.hcToggle(K2);
  assert.deepEqual(c.state.hcSel, [K1, K2]);
  c.hcAsk();
  assert.equal(c.state.promote.phase, 'ask');
  assert.deepEqual(c.state.promote.items.map((i) => i.title), ['Placeholder one', 'Placeholder two']);
  assert.deepEqual(c.state.promote.items[0].source, { kind: 'code', conversation: 'code:s1', at: '2026-10-01T10:00:00Z' });
  assert.equal(c.promoted.length, 0);
});

test('single Promote: editable title, written, Library + candidates re-read', async () => {
  const c = rig();
  c.hcAsk(K1);
  c.hcTitle({ target: { value: '  My title  ' } });
  assert.equal(c.state.promote.items[0].title, '  My title  ');   // kept as typed: onChange fires per keystroke (runtime maps it to 'input'), so a trim here would eat every space typed
  await c.hcGo();
  assert.deepEqual(c.promoted[0], { text: 'Placeholder one\nmore', title: 'My title', tags: ['harvested'], source: { kind: 'code', conversation: 'code:s1', at: '2026-10-01T10:00:00Z' } });
  assert.equal(c.state.promote.phase, 'done');
  assert.deepEqual(c.state.promote.results, [{ title: 'My title', ok: true, name: 'x.md' }]);
  assert.deepEqual(c.state.hcSel, []);
  assert.deepEqual(c.refreshed, { cand: 1, prompts: 1 });
  assert.equal(c.toasts.at(-1)[0], 'success');
});

test('single Promote clash: asks once more and saves as the offered name only after hcSaveAs', async () => {
  const c = rig({ promote: (p, n) => (n === 1 ? { error: 'a prompt note with this name is already there', exists: true, next: 'placeholder-one-2.md' }
    : { path: '40_Resources/Prompts/' + p.name, name: p.name, id: 'prompt:y', masked: 0 }) });
  c.hcAsk(K1); await c.hcGo();
  assert.equal(c.state.promote.phase, 'clash'); assert.deepEqual(c.state.promote.clash, { next: 'placeholder-one-2.md' });
  assert.equal(c.promoted.length, 1);
  await c.hcSaveAs();
  assert.equal(c.promoted[1].name, 'placeholder-one-2.md');
  assert.equal(c.state.promote.phase, 'done');
  assert.equal(c.state.promote.results[0].name, 'placeholder-one-2.md');
});

test('multi Promote: one confirm; a clash inside a batch is reported, never saved under a new name', async () => {
  const c = rig({ promote: (p) => (p.title === 'Placeholder two' ? { error: 'a prompt note with this name is already there', exists: true, next: 'placeholder-two-2.md' }
    : { path: '40_Resources/Prompts/placeholder-one.md', name: 'placeholder-one.md', id: 'prompt:z', masked: 0 }) });
  c.hcToggle(K1); c.hcToggle(K2); c.hcAsk(); await c.hcGo();
  assert.equal(c.promoted.length, 2);
  assert.equal(c.promoted.some((p) => p.name), false, 'a batch never sends a name');
  assert.deepEqual(c.state.promote.results, [{ title: 'Placeholder one', ok: true, name: 'placeholder-one.md' },
    { title: 'Placeholder two', ok: false, error: NOT_WRITTEN('placeholder-two-2.md') }]);
  assert.equal(NOT_WRITTEN('placeholder-two-2.md'), 'not written — a note with that name is there; promote it alone to save it as placeholder-two-2.md');
  assert.equal(c.toasts.at(-1)[1], 'Promoted 1 of 2 — see the list for the one not written.');
});

test('a read-only preview cannot Promote or Hide; Cancel writes nothing; Hide removes the row and says it is permanent', async () => {
  const ro = rig({ canWrite: false });
  ro.hcAsk(K1); assert.equal(ro.state.promote, null); assert.deepEqual(ro.toasts.at(-1), ['denied', 'read-only preview']);
  await ro.hcHide(K1); assert.deepEqual(ro.toasts.at(-1), ['denied', 'read-only preview']);
  const c = rig();
  c.hcAsk(K1); c.hcCancel(); assert.equal(c.state.promote, null); assert.equal(c.promoted.length, 0);
  await c.hcHide(K1);
  assert.deepEqual(c.store.live.candidates.rows.map((r) => r.key), [K2]);
  assert.equal(c.store.live.candidates.hidden, 1);
  assert.deepEqual(c.toasts.at(-1), ['info', 'Hidden — this prompt will not be offered again.']);
  const bad = rig({ hide: () => ({ error: 'read-only hub (another WorkspaceHQ owns the index)' }) });
  await bad.hcHide(K1);
  assert.equal(bad.store.live.candidates.rows.length, 2);
  assert.match(bad.toasts.at(-1)[1], /read-only hub/);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --test dashboard-v5/src/logic/prompt-candidates.test.mjs`
Expected: FAIL — `Cannot find module …/prompt-candidates.js`.

- [ ] **Step 3: Implement** `dashboard-v5/src/logic/prompt-candidates.js`:

```js
// Claude › Prompts › Candidates actions (spec 2026-10-15 §6.3, phase P2). Promote always passes ONE confirm (single or
// multi); a clash in a single Promote asks once more for the offered -2 name; a batch never invents a name. Hide = tombstone.
import { candidateRow } from '../live/adapter.mjs';

export const NOT_WRITTEN = (next) => `not written — a note with that name is there; promote it alone to save it as ${next || 'another name'}`;
const TITLE_MAX = 200;
let seq = 0;

export const candidatesLogic = {
  hcView(view) {
    if (view !== 'library' && view !== 'candidates') return;
    this.setState({ prView: view });
    if (view === 'candidates' && !this.store.live.candidates.loaded) this.hcLoad();
  },
  hcLoad() { if (this.store.refreshCandidates) return this.store.refreshCandidates(); return undefined; },
  hcToggle(key) {
    this.setState((s) => ({ hcSel: s.hcSel.includes(key) ? s.hcSel.filter((k) => k !== key) : s.hcSel.concat([key]) }));
  },
  hcAsk(key) {
    const keys = key ? [key] : this.state.hcSel.slice();
    if (!keys.length) { this.toast('info', 'Tick one or more candidates first.'); return; }
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const rows = (this.store.live.candidates.rows || []).filter((r) => keys.includes(r.key)).map((r) => candidateRow(r));
    const items = rows.map((r) => ({ key: r.key, title: r.title, text: r.text, source: r.source }));
    if (!items.length) { this.toast('info', 'Those candidates are no longer listed — refresh the list.'); return; }
    this.setState({ promote: { seq: ++seq, keys, items, phase: 'ask', clash: null, results: [], error: null } });
  },
  hcTitle(e) {
    const P = this.state.promote;
    if (!P || P.items.length !== 1 || P.phase !== 'ask') return;
    // not trimmed here: the runtime fires onChange per keystroke ('input'); hcGo / hcSaveAs trim what they send
    const title = String((e && e.target && e.target.value) || '').slice(0, TITLE_MAX);
    this.setState({ promote: { ...P, items: [{ ...P.items[0], title }] } });
  },
  async hcGo() {
    const P = this.state.promote;
    if (!P || P.phase !== 'ask' || !this.hq || !this.hq.claudePrompts || !this.hq.claudePrompts.promote) return;
    this.setState({ promote: { ...P, phase: 'saving' } });
    const results = [];
    for (const it of P.items) {
      const title = String(it.title || '').trim();   // empty → main defaults to the text's first line
      let r;
      try { r = await this.hq.claudePrompts.promote({ text: it.text, title, tags: ['harvested'], source: it.source }); }
      catch (e) { r = { error: String((e && e.message) || e) }; }
      if (!this.state.promote || this.state.promote.seq !== P.seq) return;   // closed meanwhile: say nothing more
      if (r && r.exists && P.items.length === 1) { this.setState({ promote: { ...this.state.promote, phase: 'clash', clash: { next: r.next || null } } }); return; }
      if (r && r.exists) results.push({ title, ok: false, error: NOT_WRITTEN(r.next) });
      else if (!r || r.error) results.push({ title, ok: false, error: String((r && r.error) || 'no answer') });
      else results.push({ title, ok: true, name: r.name });
    }
    this.hcDone(P, results);
  },
  async hcSaveAs() {
    const P = this.state.promote;
    if (!P || P.phase !== 'clash' || !P.clash || !P.clash.next) return;
    const it = P.items[0], title = String(it.title || '').trim();
    this.setState({ promote: { ...P, phase: 'saving' } });
    let r;
    try { r = await this.hq.claudePrompts.promote({ text: it.text, title, tags: ['harvested'], source: it.source, name: P.clash.next }); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!this.state.promote || this.state.promote.seq !== P.seq) return;
    if (r && r.exists) { this.setState({ promote: { ...this.state.promote, phase: 'clash', clash: { next: r.next || null } } }); return; }
    this.hcDone(P, [r && !r.error ? { title, ok: true, name: r.name } : { title, ok: false, error: String((r && r.error) || 'no answer') }]);
  },
  hcDone(P, results) {
    const ok = results.filter((x) => x.ok).length;
    this.setState({ promote: { ...this.state.promote, phase: 'done', results }, hcSel: [] });
    if (ok === results.length) this.toast('success', ok === 1 ? `Promoted to ${results[0].name}.` : `Promoted ${ok} prompts.`);
    else this.toast(ok ? 'info' : 'error', `Promoted ${ok} of ${results.length} — see the list for the one${results.length - ok === 1 ? '' : 's'} not written.`);
    if (this.store.refreshPrompts) this.store.refreshPrompts();
    if (this.store.refreshCandidates) this.store.refreshCandidates();
  },
  hcCancel() { this.setState({ promote: null }); },
  async hcHide(key) {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    if (!this.hq || !this.hq.claudeHub || !this.hq.claudeHub.hideCandidate) return;
    const r = await this.call(() => this.hq.claudeHub.hideCandidate(key), 'Hide');
    if (r === null) return;
    const C = this.store.live.candidates;
    if (Array.isArray(C.rows)) C.rows = C.rows.filter((x) => x.key !== key);
    C.hidden = (Number(C.hidden) || 0) + 1;
    this.setState((s) => ({ hcSel: s.hcSel.filter((k) => k !== key) }));
    this.toast('info', 'Hidden — this prompt will not be offered again.');
    this.forceUpdate();
  },
};
```

- [ ] **Step 4: Wire it into `dashboard-v5/src/app.js`.** (a) `import { candidatesLogic } from './logic/prompt-candidates.js';` beside the other logic imports; append `candidatesLogic` to the `Object.assign(Component.prototype, …)` list (after P1's `promptsLogic`). (b) In `initState()` add `prView: 'library', hcSel: [], promote: null,` next to P1's `prQuery`/`prSearched`/`prFor`. (c) In `closeTop()` change the two lists: `order` gets `'promote'` right after `'vault'`, and the "closes to null" list `['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard', 'vault']` gets `'promote'` appended.

- [ ] **Step 5: Run it to see it pass.**

Run: `node --test dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/*.test.mjs`
Expected: PASS (`selftest-keys.test.mjs` unchanged: no storage key added).

- [ ] **Step 6: Commit**

```bash
git add dashboard-v5/src/logic/prompt-candidates.js dashboard-v5/src/logic/prompt-candidates.test.mjs dashboard-v5/src/app.js
git commit -m "fe: P2 v5 actions — candidatesLogic (Library|Candidates, select, one-confirm Promote, clash -> offered -2 name, batch clashes reported, Hide)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 7 -->

### Task 8: v5 surfaces — Library | Candidates toggle, Candidates list, Promote confirm dialog; `vals/prompt-candidates.js`; tpl hash + attributed goldens

**Files:**
- Create: `dashboard-v5/src/vals/prompt-candidates.js`
- Modify: `dashboard-v5/src/vals/index.js` (append `candidatesVals` to `SURFACES`)
- Modify: `dashboard-v5/src/tpl/claude.tpl.js` (inside P1's `{{ isPrompts }}` block)
- Modify: `dashboard-v5/src/tpl/extras.tpl.js` (dialog after the Save-to-vault dialog)
- Modify: `dashboard-v5/src/tpl.hash.test.mjs`, `dashboard-v5/src/vals.golden.test.mjs`, `dashboard-v5/src/__golden__/vals.hashes.json`

**Interfaces:**
- Consumes: Task 6 `candidatesView`; Task 7 `hcView, hcLoad, hcToggle, hcAsk, hcTitle, hcGo, hcSaveAs, hcCancel, hcHide`, state `prView`, `hcSel`, `promote`; Component `state`, `store` (`store.bridge`, `store.live.candidates`), `canWrite()`, `writeReason()`; vals ctx (`ctx.cantWrite`, `ctx.writeReason` — vals/ctx.js); golden helpers `add(name, {hq, live, state})`, `tabSub(tab, sub)`.
- Produces: vals keys (disjoint from every surface; `hc*` + `isPrLib`, `isPrCand`): `isPrLib, isPrCand, hcTabLib, hcTabCand, hcLibStyle, hcCandStyle, hcState, hcText, hcHasText, hcTextStyle, hcRows, hcHasRows, hcPoolNote, hcHasPool, hcSelText, hcHasSel, hcPromoteSel, hcRefresh, hcBusy, hcCant, hcCantTip, hcOpen, hcHead, hcWhere, hcSingle, hcTitleVal, hcOnTitle, hcItems, hcAskPhase, hcSaving, hcClashPhase, hcDonePhase, hcGo, hcGoText, hcClashText, hcCanSaveAs, hcSaveAs, hcCancel, hcResults, hcStop`; row fields `r.key, r.title, r.text, r.why, r.origin, r.more, r.scoreText, r.selected, r.checkMark, r.inLibrary, r.toggle, r.promote, r.hide`; DOM hooks `data-hc="tabs|lib-tab|cand-tab|list|row|check|promote|hide|promote-sel|empty|pool|dialog|title|go|save-as|clash|results|cancel"`.

- [ ] **Step 0: Record the "before" golden dump (before ANY edit in this task).**

Run (Git Bash, repo root): `B="$(mktemp -d)"; echo "$B"; GOLDEN_DUMP="$B" node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: PASS; note the printed folder (`$B`) for Step 6.

- [ ] **Step 1: Add the failing golden scenarios.** In `dashboard-v5/src/vals.golden.test.mjs`, after P1's `claude.prompts-*` scenarios (reuse the `hq` value those scenarios pass):

```js
// P2 harvest candidates + Promote dialog (placeholder text)
const HC1 = 'cand:' + '1'.repeat(40), HC2 = 'cand:' + '2'.repeat(40);
const HC_ROWS = () => [
  { key: HC1, text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file.', score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
    sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' }, { kind: 'history', documentId: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z', project: 'project-a' }] },
  { key: HC2, text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks for each step.', score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 0, text: 'no assistant message followed it' }, { key: 'length', points: 1, text: '300+ characters' }, { key: 'library', points: -5, text: 'already a prompt note' }],
    sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-01T10:00:00Z', project: null }] },
];
const HC_LIVE = (o = {}) => (L) => { L.candidates = { rows: HC_ROWS(), pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0, error: null, busy: false, loaded: true, ...o }; };
const HC_ITEM = (t) => ({ key: HC1, title: t, text: 'Placeholder prompt one: review the placeholder module.', source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-10-01T10:00:00Z' } });
add('claude.candidates-list', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', hcSel: [HC1] }) });
add('claude.candidates-capped', { hq: HC_HQ, live: HC_LIVE({ capped: { messages: true, history: true }, hidden: 3 }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-loading', { hq: HC_HQ, live: HC_LIVE({ rows: null, busy: true }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-empty', { hq: HC_HQ, live: HC_LIVE({ rows: [], pooled: { messages: 12, history: 3 } }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-error', { hq: HC_HQ, live: HC_LIVE({ error: 'Claude Hub: timeout' }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-nobridge', { live: HC_LIVE(), state: HC_AT({ prView: 'candidates' }) });
add('claude.promote-ask-single', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM('Placeholder prompt one')], phase: 'ask', clash: null, results: [], error: null } }) });
add('claude.promote-ask-multi', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', hcSel: [HC1, HC2], promote: { seq: 1, keys: [HC1, HC2], items: [HC_ITEM('Placeholder prompt one'), { ...HC_ITEM('Placeholder prompt two'), key: HC2 }], phase: 'ask', clash: null, results: [], error: null } }) });
add('claude.promote-clash', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM('Placeholder prompt one')], phase: 'clash', clash: { next: 'placeholder-prompt-one-2.md' }, results: [], error: null } }) });
add('claude.promote-done', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1, HC2], items: [HC_ITEM('Placeholder prompt one'), { ...HC_ITEM('Placeholder prompt two'), key: HC2 }], phase: 'done', clash: null,
  results: [{ title: 'Placeholder prompt one', ok: true, name: 'placeholder-prompt-one.md' }, { title: 'Placeholder prompt two', ok: false, error: 'not written — a note with that name is there; promote it alone to save it as placeholder-prompt-two-2.md' }], error: null } }) });
```

Put these lines directly above `const HC1 = …` (`HC_HQ` extends P1's `PR_HQ` stub with the three P2 methods so the bridge is "there"; `HC_AT` builds the `state` patch on P1's `PR_AT = tabSub('claude', 'prompts')`, which is a `(c) => patch` FUNCTION — `render` does `Object.assign(c.state, sc.state(c, model))`, so spreading `tabSub(…)` itself would spread a function (nothing) and every scenario would render Home):

```js
const HC_HQ = { ...PR_HQ, claudeHub: { ...PR_HQ.claudeHub, promptCandidates() {}, hideCandidate() {} }, claudePrompts: { ...PR_HQ.claudePrompts, promote() {} } };
const HC_AT = (o) => (c) => ({ ...PR_AT(c), ...o });
```

Run: `node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: FAIL — 10 new scenarios have no recorded hash.

- [ ] **Step 2: Write `dashboard-v5/src/vals/prompt-candidates.js`:**

```js
// Claude › Prompts › Candidates + the Promote dialog (spec 2026-10-15 §6.3, phase P2). Keys: hc*, isPrLib, isPrCand.
import { candidatesView } from '../live/adapter.mjs';

const TAB_ON = 'height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab,var(--purple) 14%,transparent);color:var(--text);cursor:pointer;font-size:12px';
const TAB_OFF = 'height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px';
const NOTE = 'font-size:13px;color:var(--muted);border:1px dashed var(--frame);border-radius:10px;padding:12px 14px';
const ERR = 'font-size:13px;color:var(--tone-red);border:1px solid color-mix(in oklab,var(--tone-red) 45%,transparent);border-radius:10px;padding:12px 14px';

export function candidatesVals(ctx) {
  const S = this.state, cand = S.prView === 'candidates';
  const v = candidatesView(this.store.live.candidates, { hasBridge: !!this.store.bridge, selected: S.hcSel });
  const cant = !!ctx.cantWrite;
  const rows = v.rows.map((r) => ({ ...r, checkMark: r.selected ? '☑' : '☐',
    toggle: () => this.hcToggle(r.key), promote: () => this.hcAsk(r.key), hide: () => this.hcHide(r.key) }));
  const P = S.promote, single = !!P && P.items.length === 1, n = P ? P.items.length : 0;
  return {
    isPrLib: !cand, isPrCand: cand,
    hcTabLib: () => this.hcView('library'), hcTabCand: () => this.hcView('candidates'),
    hcLibStyle: cand ? TAB_OFF : TAB_ON, hcCandStyle: cand ? TAB_ON : TAB_OFF,
    hcState: v.state, hcText: v.text, hcHasText: !!v.text, hcTextStyle: v.state === 'error' ? ERR : NOTE,
    hcRows: rows, hcHasRows: rows.length > 0, hcPoolNote: v.poolNote, hcHasPool: !!v.poolNote,
    hcSelText: S.hcSel.length ? `${S.hcSel.length} ticked` : 'Tick candidates to promote several at once',
    hcHasSel: S.hcSel.length > 0, hcPromoteSel: () => this.hcAsk(), hcRefresh: () => this.hcLoad(),
    hcBusy: !!this.store.live.candidates.busy, hcCant: cant, hcCantTip: cant ? ctx.writeReason : '',
    hcOpen: !!P, hcSingle: single,
    hcHead: n === 1 ? 'Promote 1 prompt to your vault' : `Promote ${n} prompts to your vault`,
    hcWhere: 'Each becomes a NEW note in 40_Resources/Prompts, written exactly as shown (secrets already masked) — never over an existing note.',
    hcTitleVal: single ? P.items[0].title : '', hcOnTitle: (e) => this.hcTitle(e),
    hcItems: P ? P.items.map((i) => ({ title: i.title, text: i.text })) : [],
    hcAskPhase: !!P && P.phase === 'ask', hcSaving: !!P && P.phase === 'saving',
    hcClashPhase: !!P && P.phase === 'clash', hcDonePhase: !!P && P.phase === 'done',
    hcGo: () => this.hcGo(), hcGoText: n > 1 ? `Promote ${n}` : 'Promote',
    hcClashText: P && P.clash ? (P.clash.next
      ? `A note with this title's file name is already in the Prompts folder. Save this one as ${P.clash.next}? The existing note is not touched.`
      : 'A note with this name is already there, and -2 … -9 too. Cancel and change the title.') : '',
    hcCanSaveAs: !!(P && P.clash && P.clash.next), hcSaveAs: () => this.hcSaveAs(), hcCancel: () => this.hcCancel(),
    hcResults: P ? P.results.map((r) => ({ text: r.ok ? `${r.title} → ${r.name}` : `${r.title}: ${r.error}`, color: r.ok ? 'var(--green)' : 'var(--tone-red)' })) : [],
    hcStop: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
  };
}
```

In `vals/index.js`: `import { candidatesVals } from './prompt-candidates.js';` and append `candidatesVals` to the end of `SURFACES` (after P1's `promptsVals`).

- [ ] **Step 3: The Candidates markup.** In `tpl/claude.tpl.js`, inside P1's block: (a) wrap P1's `<div data-pr="lib" …>` … its matching `</div>` in `<sc-if value="{{ isPrLib }}" hint-placeholder-val="{{ true }}">` … `</sc-if>`; (b) directly after the line `            <sc-if value="{{ isPrompts }}" hint-placeholder-val="{{ false }}">` insert:

```html
              <!-- v5: Prompt library P2 (spec 2026-10-15 §6.3) — Library | Candidates. Candidates = the owner's own prompts harvested from every indexed source; each score is shown as its terms (counts, never a judgment); Promote (one confirm, single or several) writes NEW vault notes; Hide is a permanent tombstone -->
              <div data-hc="tabs" role="tablist" style="display:flex;gap:8px;margin-bottom:12px"><button type="button" role="tab" data-hc="lib-tab" onClick="{{ hcTabLib }}" style="{{ hcLibStyle }}">Library</button><button type="button" role="tab" data-hc="cand-tab" onClick="{{ hcTabCand }}" style="{{ hcCandStyle }}">Candidates</button></div>
              <sc-if value="{{ isPrCand }}" hint-placeholder-val="{{ false }}">
                <div data-hc="list" style="display:flex;flex-direction:column;gap:16px">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <span style="flex:1;font-size:12px;color:var(--muted)">{{ hcSelText }}</span>
                    <button type="button" data-hc="promote-sel" onClick="{{ hcPromoteSel }}" disabled="{{ hcCant }}" title="{{ hcCantTip }}" style="height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--gold);background:transparent;color:var(--text);cursor:pointer;font-size:12px">Promote ticked…</button>
                    <button type="button" onClick="{{ hcRefresh }}" disabled="{{ hcBusy }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px">Score again</button>
                  </section>
                  <sc-if value="{{ hcHasText }}" hint-placeholder-val="{{ false }}"><div data-hc="empty" role="status" style="{{ hcTextStyle }}">{{ hcText }}</div></sc-if>
                  <sc-if value="{{ hcHasRows }}" hint-placeholder-val="{{ true }}">
                    <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:8px 12px">
                      <sc-for list="{{ hcRows }}" as="r" hint-placeholder-count="3"><div data-hc="row" style="padding:10px 0;border-bottom:1px dashed var(--frame);display:flex;gap:10px;align-items:flex-start">
                        <button type="button" data-hc="check" onClick="{{ r.toggle }}" aria-pressed="{{ r.selected }}" aria-label="Tick this candidate" style="height:24px;width:24px;border:0;background:transparent;color:var(--purple);cursor:pointer;font-size:16px;line-height:1">{{ r.checkMark }}</button>
                        <div style="flex:1;min-width:0">
                          <div style="font-size:14px">{{ r.title }}</div>
                          <div style="font-family:var(--term);font-size:12px;color:var(--muted);margin-top:4px;white-space:pre-wrap;max-height:4.5em;overflow:hidden">{{ r.text }}</div>
                          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:6px"><span style="color:var(--gold)">{{ r.scoreText }}</span><span style="color:var(--muted)">{{ r.why }}</span></div>
                          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:2px;color:var(--faint)"><span>{{ r.origin }}</span><span>{{ r.more }}</span></div>
                        </div>
                        <button type="button" data-hc="promote" onClick="{{ r.promote }}" disabled="{{ hcCant }}" title="Asks first, then writes a new note in 40_Resources/Prompts" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--gold);background:transparent;cursor:pointer;color:var(--text)">Promote…</button>
                        <button type="button" data-hc="hide" onClick="{{ r.hide }}" disabled="{{ hcCant }}" title="Never offer this prompt again" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;cursor:pointer;color:var(--muted)">Hide</button>
                      </div></sc-for>
                    </section>
                  </sc-if>
                  <sc-if value="{{ hcHasPool }}" hint-placeholder-val="{{ false }}"><div data-hc="pool" style="font-size:11px;color:var(--faint)">{{ hcPoolNote }}</div></sc-if>
                </div>
              </sc-if>
```

In `tpl/extras.tpl.js`, directly after the Save-to-vault dialog's closing `</sc-if>`:

```html
  <!-- v5: Prompt library P2 — the ONE confirm before Promote writes (spec §6.3), and the clash step (§6.1: a clash becomes <slug>-2.md only after a confirm). Shows the text exactly as it will be written (masked) -->
  <sc-if value="{{ hcOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ hcCancel }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div data-hc="dialog" onClick="{{ hcStop }}" role="dialog" aria-label="Promote to vault" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this writes</div>
        <div style="font-size:19px;margin-top:8px">{{ hcHead }}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">{{ hcWhere }}</div>
        <sc-if value="{{ hcSingle }}" hint-placeholder-val="{{ false }}"><label style="display:flex;flex-direction:column;gap:4px;margin-top:12px;font-size:11px;color:var(--faint)">Title (the file name comes from it)<input data-hc="title" value="{{ hcTitleVal }}" onChange="{{ hcOnTitle }}" disabled="{{ hcClashPhase }}" style="height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px"></label></sc-if>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px"><sc-for list="{{ hcItems }}" as="i" hint-placeholder-count="2"><div style="border:1px dashed var(--frame);border-radius:8px;padding:8px 10px"><div style="font-size:13px">{{ i.title }}</div><div style="font-family:var(--term);font-size:12px;color:var(--muted);white-space:pre-wrap;margin-top:4px;max-height:9em;overflow:auto">{{ i.text }}</div></div></sc-for></div>
        <sc-if value="{{ hcClashPhase }}" hint-placeholder-val="{{ false }}"><div data-hc="clash" role="status" style="margin-top:12px;font-size:13px;color:var(--gold)">{{ hcClashText }}</div></sc-if>
        <sc-if value="{{ hcDonePhase }}" hint-placeholder-val="{{ false }}"><div data-hc="results" role="status" style="margin-top:12px;display:flex;flex-direction:column;gap:4px"><sc-for list="{{ hcResults }}" as="x" hint-placeholder-count="2"><div style="font-size:12px;color:{{ x.color }}">{{ x.text }}</div></sc-for></div></sc-if>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button type="button" data-hc="cancel" onClick="{{ hcCancel }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <sc-if value="{{ hcAskPhase }}" hint-placeholder-val="{{ true }}"><button type="button" data-hc="go" onClick="{{ hcGo }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ hcGoText }}</button></sc-if>
          <sc-if value="{{ hcSaving }}" hint-placeholder-val="{{ false }}"><span style="align-self:center;font-size:12px;color:var(--muted)">Writing…</span></sc-if>
          <sc-if value="{{ hcCanSaveAs }}" hint-placeholder-val="{{ false }}"><sc-if value="{{ hcClashPhase }}" hint-placeholder-val="{{ false }}"><button type="button" data-hc="save-as" onClick="{{ hcSaveAs }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">Save as the new name</button></sc-if></sc-if>
        </div>
      </div>
    </div>
  </sc-if>
```

- [ ] **Step 4: Re-record the template hash (deliberate).**

Run: `node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import c from 'node:crypto'; console.log(c.createHash('sha256').update(t).digest('hex'), t.length, Buffer.byteLength(t, 'utf8'))"`
Put the three printed values into `SHA256`, `LENGTH`, `UTF8_BYTES` of `dashboard-v5/src/tpl.hash.test.mjs` and add above them `// 2026-10-25 P2 prompt harvest: Library|Candidates toggle + Candidates list (claude.tpl.js) + Promote dialog (extras.tpl.js) (+<Δchars> chars / +<Δbytes> bytes)` with the real deltas against the constants P1 left (read them before editing).
Run: `node --test dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/honesty.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the vals tests.**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/live/*.test.mjs`
Expected: everything PASSES except `vals.golden.test.mjs` (hashes not recorded yet).

- [ ] **Step 6: Attribute every golden change, then re-record.** Expected changes: (1) every scenario gains the new `hc*` / `isPrLib` / `isPrCand` keys; (2) `claude.prompts-nofolder` `prEmpty` (the Task 6 text); (3) the 10 new scenarios. Nothing else may change.

Run: `A="$(mktemp -d)"; GOLDEN_DUMP="$A" node --test dashboard-v5/src/vals.golden.test.mjs || true; node dashboard-v5/tools/golden-diff.mjs "$B" "$A" --allow '^(hc[A-Z][A-Za-z]*|isPrLib|isPrCand|prEmpty)\b'` (P1's path format: the vals key at the start).
Expected: exit 0, and the printed list shows `prEmpty` changed in `claude.prompts-nofolder` only. If another path changed (or `prEmpty` in another scenario), find its cause and fix it — do not widen `--allow`.
Then: `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs` and `node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard-v5/src/vals/prompt-candidates.js dashboard-v5/src/vals/index.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/extras.tpl.js dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: P2 v5 surfaces — Library|Candidates, candidate rows (score terms, origin, Promote/Hide), one-confirm Promote dialog with the clash step; tpl hash + attributed goldens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 8 -->

### Task 9: Selftest rows for every Candidates state + the dialog; CDP `prompts-promote-confirm`, `prompts-candidates-hide`

**Files:**
- Modify: `dashboard-v5/src/selftest.js`
- Modify: `dashboard-v5/tools/cdp-gate.mjs`

**Interfaces:**
- Consumes: Task 8 DOM hooks `data-hc="tabs|lib-tab|cand-tab|list|row|check|promote|hide|promote-sel|empty|pool|dialog|title|go|save-as|clash|results|cancel"`; Task 5 fake `FAKE_CANDIDATES` (3 rows, keys `cand:111…`, `cand:222…`, `cand:333…`), fake `claudePrompts.promote`, `claudeHub.hideCandidate`; `hqFake.calls(method) -> [{args}]`, `hqFake.set(method, value|fn)` (in-page only: `{persist:true}` throws for a function, and `fresh()` runs `hqFake.reset(true)` so nothing leaks between scenarios); cdp `fresh(t)`, `t.evaluate`, `t.waitFor`, `t.press`, `t.errors()`; selftest `at(tab, sub, project)`, `LV`, `savedLive`, `CLEAR`.
- Produces: selftest combos `cand-list`, `cand-loading`, `cand-empty`, `cand-error`, `cand-capped`, `promote-ask-single`, `promote-ask-multi`, `promote-saving`, `promote-clash`, `promote-done`; CDP scenarios `prompts-promote-confirm`, `prompts-candidates-hide` (both in `--scenario all`).

- [ ] **Step 1: Selftest rows.** In `dashboard-v5/src/selftest.js`: add `prView: 'library', hcSel: [], promote: null,` to `CLEAR` (so no combo inherits a dialog or the Candidates view; `RESTORE` picks them up from `CLEAR`); add `candidates: LV.candidates` to the `savedLive = { … }` object (keep every key earlier phases put there — without it the last row's candidates leak into later combos and into the app after the run). Near P1's prompts helper add:

```js
// P2 harvest candidates (placeholder text)
const HC1 = 'cand:' + '1'.repeat(40), HC2 = 'cand:' + '2'.repeat(40);
const HC_ROWS = [
  { key: HC1, text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file.', score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
    sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' }] },
  { key: HC2, text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks for each step.', score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'library', points: -5, text: 'already a prompt note' }],
    sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-01T10:00:00Z', project: null }] },
];
const hcLive = (o = {}) => () => { LV.candidates = { rows: HC_ROWS.slice(), pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0, error: null, busy: false, loaded: true, ...o }; };
const HC_ITEM = (key, title) => ({ key, title, text: 'Placeholder prompt text.', source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-10-01T10:00:00Z' } });
const hcDlg = (phase, o = {}) => ({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM(HC1, 'Placeholder prompt one')], phase, clash: null, results: [], error: null, ...o } });
```

and append to `STATES` (after P1's `prompts-*` rows):

```js
  ['cand-list', at('claude', 'prompts'), { prView: 'candidates', hcSel: [HC1] }, hcLive()],
  ['cand-loading', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ rows: null, busy: true })],
  ['cand-empty', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ rows: [], pooled: { messages: 12, history: 3 } })],
  ['cand-error', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ error: 'Claude Hub: timeout' })],
  ['cand-capped', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ capped: { messages: true, history: true }, hidden: 3 })],
  ['promote-ask-single', at('claude', 'prompts'), hcDlg('ask'), hcLive()],
  ['promote-ask-multi', at('claude', 'prompts'), hcDlg('ask', { keys: [HC1, HC2], items: [HC_ITEM(HC1, 'Placeholder prompt one'), HC_ITEM(HC2, 'Placeholder prompt two')] }), hcLive()],
  ['promote-saving', at('claude', 'prompts'), hcDlg('saving'), hcLive()],
  ['promote-clash', at('claude', 'prompts'), hcDlg('clash', { clash: { next: 'placeholder-prompt-one-2.md' } }), hcLive()],
  ['promote-done', at('claude', 'prompts'), hcDlg('done', { results: [{ title: 'Placeholder prompt one', ok: true, name: 'placeholder-prompt-one.md' }, { title: 'Placeholder prompt two', ok: false, error: 'not written — a note with that name is there; promote it alone to save it as placeholder-prompt-two-2.md' }] }), hcLive()],
```

Run (PowerShell, from `dashboard-v5`): `$env:HQ_V5_PROFILE = "p2-selftest-$PID"; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --selftest; $LASTEXITCODE`
Expected: exit `0`; the verdict line shows 0 errors / 0 unresolved / 0 failures and the combo count grew by 10 × (themes × offsets × overlays) of P1's run.

- [ ] **Step 2: CDP scenarios.** In `dashboard-v5/tools/cdp-gate.mjs`: (a) in `fresh(t)`'s `L.setState({...})` reset add `prView: 'library', hcSel: [], promote: null`, and after it reset `L.store.live.candidates = { rows: null, pooled: null, capped: null, hidden: 0, error: null, busy: false, loaded: false }`; (b) add the two names to the header list; (c) add to `SCENARIOS`:

```js
  async 'prompts-promote-confirm'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const out = [];
    const calls = async () => JSON.parse(await t.evaluate(`JSON.stringify(hqFake.calls('claudePrompts.promote').map((c) => c.args[0]))`));
    await t.evaluate(`WHQ.app.logic.go('claude','prompts')`);
    await t.evaluate(`document.querySelector('[data-hc="cand-tab"]').click()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-hc="row"]').length === 3`)) out.push('the 3 fake candidates are not listed');
    const why = await t.evaluate(`document.querySelector('[data-hc="row"]').textContent`);
    if (!/used in 3 sessions \+9/.test(why) || !/Claude Code · project-a/.test(why)) out.push('row lacks its reasons/origin: ' + why.slice(0, 200));
    // single: the confirm comes first; nothing is written before it
    await t.evaluate(`document.querySelector('[data-hc="promote"]').click()`);
    if (!await t.waitFor(`!!document.querySelector('[data-hc="dialog"]')`)) out.push('no confirm dialog');
    if ((await calls()).length !== 0) out.push('promote ran before the confirm');
    // a clash asks once more; only "Save as the new name" sends the offered name
    await t.evaluate(`hqFake.set('claudePrompts.promote', (p) => p && p.name ? { path: '40_Resources/Prompts/' + p.name, name: p.name, id: 'prompt:' + 'c'.repeat(40), masked: 0 }
      : { error: 'a prompt note with this name is already there', exists: true, next: 'placeholder-clash-2.md' })`);
    await t.evaluate(`document.querySelector('[data-hc="go"]').click()`);
    if (!await t.waitFor(`!!document.querySelector('[data-hc="clash"]')`)) out.push('no clash step');
    if ((await calls()).length !== 1) out.push('clash: expected exactly one promote call so far');
    await t.evaluate(`document.querySelector('[data-hc="save-as"]').click()`);
    if (!await t.waitFor(`(document.querySelector('[data-hc="results"]') || {}).textContent?.includes('placeholder-clash-2.md')`)) out.push('no result after Save as');
    const c2 = await calls();
    if (c2.length !== 2 || c2[1].name !== 'placeholder-clash-2.md' || c2[0].name !== undefined) out.push('calls: ' + JSON.stringify(c2).slice(0, 300));
    if (!c2[0] || c2[0].source?.kind !== 'code' || c2[0].tags?.[0] !== 'harvested') out.push('promote lacks provenance/tags');
    await t.press('Escape');
    if (!await t.waitFor(`!document.querySelector('[data-hc="dialog"]')`)) out.push('Escape did not close the dialog');
    // multi: tick two, ONE confirm, a batch clash is reported and never sent with a name
    await t.evaluate(`hqFake.set('claudePrompts.promote', (p) => /two/i.test(p.title) ? { error: 'a prompt note with this name is already there', exists: true, next: 'two-2.md' }
      : { path: '40_Resources/Prompts/one.md', name: 'one.md', id: 'prompt:' + 'd'.repeat(40), masked: 0 })`);
    await t.evaluate(`[...document.querySelectorAll('[data-hc="check"]')].slice(0, 2).forEach((b) => b.click())`);
    await t.evaluate(`document.querySelector('[data-hc="promote-sel"]').click()`);
    if (!await t.waitFor(`!!document.querySelector('[data-hc="dialog"]')`)) out.push('multi: no confirm dialog');
    await t.evaluate(`document.querySelector('[data-hc="go"]').click()`);
    if (!await t.waitFor(`(document.querySelector('[data-hc="results"]') || {}).textContent?.includes('not written')`)) out.push('multi: clash not reported');
    const c3 = (await calls()).slice(2);
    if (c3.length !== 2 || c3.some((p) => p.name !== undefined)) out.push('multi calls: ' + JSON.stringify(c3).slice(0, 300));
    await t.evaluate(`document.querySelector('[data-hc="cancel"]').click()`);
    return out.concat(t.errors());
  },
  async 'prompts-candidates-hide'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const out = [];
    await t.evaluate(`WHQ.app.logic.go('claude','prompts')`);
    await t.evaluate(`document.querySelector('[data-hc="cand-tab"]').click()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-hc="row"]').length === 3`)) out.push('candidates not listed');
    await t.evaluate(`document.querySelector('[data-hc="hide"]').click()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-hc="row"]').length === 2`)) out.push('hidden row still listed');
    const k = await t.evaluate(`hqFake.calls('claudeHub.hideCandidate').map((c) => c.args[0]).join(',')`);
    if (k !== 'cand:' + '1'.repeat(40)) out.push('hideCandidate args: ' + k);
    if (!await t.waitFor(`document.body.textContent.includes('will not be offered again')`)) out.push('no permanent-hide toast');
    await t.evaluate(`hqFake.set('claudeHub.hideCandidate', { error: 'read-only hub (another WorkspaceHQ owns the index)' })`);
    await t.evaluate(`document.querySelector('[data-hc="hide"]').click()`);
    if (!await t.waitFor(`document.body.textContent.includes('read-only hub')`)) out.push('reader refusal not shown');
    if (await t.evaluate(`document.querySelectorAll('[data-hc="row"]').length`) !== 2) out.push('a refused hide removed the row');
    // a Hub error is an error, never "no candidates"
    await t.evaluate(`hqFake.set('claudeHub.promptCandidates', { error: 'timeout' }); WHQ.app.logic.hcLoad()`);
    if (!await t.waitFor(`(document.querySelector('[data-hc="empty"]') || {}).textContent?.startsWith('Claude Hub: timeout — ')`)) out.push('Hub error not shown as an error');
    return out.concat(t.errors());
  },
```

Run (PowerShell, from `dashboard-v5`; port 9346 is this task's own): `$p = Start-Process -PassThru -WindowStyle Hidden ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9346'` (with `$env:HQ_V5_PROFILE = "p2-cdp-$PID"` set first), then `node tools/cdp-gate.mjs --port 9346 --scenario prompts-promote-confirm,prompts-candidates-hide`, then `node tools/cdp-gate.mjs --port 9346 --scenario all`, then `Stop-Process -Id $p.Id` (only that PID).
Expected: `PASS prompts-promote-confirm`, `PASS prompts-candidates-hide`, and every other scenario `PASS`; exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard-v5/src/selftest.js dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: P2 selftest rows (candidates states, Promote dialog phases) + CDP prompts-promote-confirm / prompts-candidates-hide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
<!-- end task 9 -->

### Task 10: P2 gate on a real second instance (fixtures only), docs, HANDOFF — the owner's app is NOT restarted

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` (and `docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` only if Step 4 finds a row that differs from the landed code)
- Temporary (never committed, removed at the end): `%TEMP%\hq-p2-gate-<pid>\` (fixtures, db, vault, profile, logs, `gate-p2.mjs`)

**Interfaces:**
- Consumes: everything above, through the real preload (`window.hq`) of a second Electron instance; fixtures `makeClaudeHome(dir)` (`dashboard/claude-hub/__fixtures__/make-fixture.mjs`), H6 `makeDocsHome(dir, {secret})` + `historyLine({display, sessionId, project, pasted, timestamp})` (`__fixtures__/make-docs.mjs`); store `openStore` (to seed one ChatGPT chat before launch).
- Produces: a PASS/FAIL JSON report (counts, file names and fixture titles only) pasted into the HANDOFF entry.

- [ ] **Step 1: All suites green on the final tree.**

Run: `node --test dashboard/claude-hub/*.test.mjs` ; `node --test dashboard/*.test.mjs` ; `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs` ; the selftest (Task 9 Step 1 command, a new unique `HQ_V5_PROFILE`) and the CDP gate `--scenario all` (Task 9 Step 2, own port, stop only your PID).
Expected: everything PASSES; selftest exit 0 with 0/0/0; every CDP scenario `PASS`.

- [ ] **Step 2: Build the fixtures and start a second instance** (PowerShell, repo root). Record the owner's state first:

```powershell
$g = Join-Path $env:TEMP "hq-p2-gate-$PID"; New-Item -ItemType Directory -Path $g | Out-Null
$ownerPrompts = 'C:\Users\ROG STRIX\Documents\VEEMO CORTEX\40_Resources'
$snap = { param($d) (Get-ChildItem -LiteralPath $d -Force -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2) }
$promptsBefore = & $snap $ownerPrompts
$dataBefore = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
New-Item -ItemType Directory -Path (Join-Path $g 'db') | Out-Null
$seed = @'
import fs from 'node:fs'; import path from 'node:path';
import { makeClaudeHome } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs';
import { makeDocsHome, historyLine } from './dashboard/claude-hub/__fixtures__/make-docs.mjs';
import { openStore } from './dashboard/claude-hub/store.mjs';
const g = process.argv[2];
const { home } = makeClaudeHome(g);
const docs = makeDocsHome(g, { secret: 'gh' + 'p_' + 'B'.repeat(36) });
const long = (s) => { let t = s; while (t.length < 160) t += ' placeholder words'; return t; };
const A = long('Gate placeholder prompt alpha from a ChatGPT chat'), B = long('Gate placeholder prompt beta typed twice');
const hist = path.join(home, 'history.jsonl');
const line = (o) => { const l = historyLine(o); return l.endsWith('\n') ? l : l + '\n'; };
fs.appendFileSync(hist, line({ display: B, sessionId: 'gate-s1', project: 'C:\\placeholder\\project-a', pasted: false, timestamp: Date.parse('2026-10-20T10:00:00Z') })
  + line({ display: B, sessionId: 'gate-s2', project: 'C:\\placeholder\\project-a', pasted: false, timestamp: Date.parse('2026-10-21T10:00:00Z') })
  + line({ display: long('Gate placeholder pasted log'), sessionId: 'gate-s3', project: 'C:\\placeholder\\project-a', pasted: true, timestamp: Date.parse('2026-10-22T10:00:00Z') }));
const s = openStore(path.join(g, 'db', 'hub.sqlite'));
s.ensureConversation({ id: 'chatgpt:gate-g1', source: 'chatgpt', projectId: null, nativeId: 'gate-g1' });
s.addMessages('chatgpt:gate-g1', [{ id: 'chatgpt:gate-g1:u1', nativeId: 'u1', parentId: null, role: 'user', at: '2026-10-19T10:00:00Z', text: A, toolName: null, isSidechain: false },
  { id: 'chatgpt:gate-g1:a1', nativeId: 'a1', parentId: 'u1', role: 'assistant', at: '2026-10-19T10:00:05Z', text: 'ok', toolName: null, isSidechain: false }]);
s.close();
fs.writeFileSync(path.join(g, 'texts.json'), JSON.stringify({ A, B }));
console.log(JSON.stringify({ home, vault: docs.vault }));
'@
Set-Content -LiteralPath (Join-Path $g 'seed.mjs') -Value $seed -Encoding utf8
Copy-Item -LiteralPath (Join-Path $g 'seed.mjs') -Destination '.\p2-gate-seed.tmp.mjs'   # imports resolve from the repo root
node .\p2-gate-seed.tmp.mjs $g
Remove-Item -LiteralPath '.\p2-gate-seed.tmp.mjs'
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'db\hub.sqlite'
$env:HQ_VAULT_DIR   = Join-Path $g 'vault'
$env:HQ_IMPORTS_DIR = Join-Path $g 'WorkspaceHQ Imports'; New-Item -ItemType Directory -Path $env:HQ_IMPORTS_DIR | Out-Null
$env:HQ_STUDIO_ROOT = Join-Path $g 'studio'; New-Item -ItemType Directory -Path $env:HQ_STUDIO_ROOT | Out-Null
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9499' -RedirectStandardOutput (Join-Path $g 'main.out') -RedirectStandardError (Join-Path $g 'main.err')
$p.Id   # the ONLY electron pid this task may stop
```

If the printed `home`/`vault` are not `$g\.claude` / `$g\vault`, set the two env vars to them **before** `Start-Process`. (`p2-gate-seed.tmp.mjs` sits in the repo root for one command only and is removed by literal path; never stage it.)

Write `$g\gate-p2.mjs` (same CDP driver as the H5/H6/P1 gates: `connect()`, `ev(expr)`, `until(expr, ms)` — copy those three functions verbatim from `docs/superpowers/plans/2026-10-15-claude-hub-h5.md` Task 8 Step 2), then these checks:

```js
// gate-p2.mjs <port> <gateDir> — prompt harvest + Promote real-instance gate (fixtures only). Never run against the owner's app.
import fs from 'node:fs';
import path from 'node:path';
const [port, g] = [Number(process.argv[2]), process.argv[3]];
/* connect(), ev(), until() — verbatim from the H5 gate */
const fails = [], report = {};
const { A, B } = JSON.parse(fs.readFileSync(path.join(g, 'texts.json'), 'utf8'));
const dir = path.join(g, 'vault', '40_Resources', 'Prompts');
await connect(port);
if (!await until(`window.hq.claudeHub.health().then((h) => h.state === 'ready')`, 60000)) fails.push('hub never ready');
const cands = async () => ev(`window.hq.claudeHub.promptCandidates({ limit: 50 })`);
let c = await cands();
const find = (r, t) => (r.candidates || []).find((x) => x.text === t.trim());
if (!find(c, A)) fails.push('the seeded ChatGPT prompt is not a candidate');
const b = find(c, B);
if (!b || b.reasons[0].text !== 'used in 2 sessions') fails.push('history reuse not counted: ' + JSON.stringify(b && b.reasons));
if ((c.candidates || []).some((x) => x.text.includes('pasted log'))) fails.push('a pasted history line was offered');
report.pooled = c.pooled; report.candidates = (c.candidates || []).length;
const r1 = await ev(`window.hq.claudePrompts.promote(${JSON.stringify({ text: A, title: 'Gate promoted prompt', source: { kind: 'chatgpt', conversation: 'chatgpt:gate-g1', at: '2026-10-19T10:00:00Z' } })})`);
if (r1.name !== 'gate-promoted-prompt.md' || !fs.existsSync(path.join(dir, r1.name))) fails.push('promote: ' + JSON.stringify(r1));
const r2 = await ev(`window.hq.claudePrompts.promote(${JSON.stringify({ text: A, title: 'Gate promoted prompt' })})`);
if (!r2.exists || r2.next !== 'gate-promoted-prompt-2.md') fails.push('clash: ' + JSON.stringify(r2));
const r3 = await ev(`window.hq.claudePrompts.promote(${JSON.stringify({ text: A, title: 'Gate promoted prompt', name: 'gate-promoted-prompt-2.md' })})`);
if (r3.name !== 'gate-promoted-prompt-2.md') fails.push('save as -2: ' + JSON.stringify(r3));
const r4 = await ev(`window.hq.claudePrompts.promote({ text: 'Gate secret ' + 'gh' + 'p_' + 'C'.repeat(36) + ' placeholder', title: 'Gate masked' })`);
const masked = r4.name ? fs.readFileSync(path.join(dir, r4.name), 'utf8') : '';
if (!masked.includes('••• secret (github-token)') || masked.includes('p_' + 'C'.repeat(36))) fails.push('promoted note is not masked');
const r5 = await ev(`window.hq.claudePrompts.promote({ text: 'Gate escape', title: 'Gate escape', name: '../escape.md' })`);
if (!r5.error || fs.existsSync(path.join(g, 'vault', '40_Resources', 'escape.md'))) fails.push('a crafted name was accepted');
report.promptFiles = fs.readdirSync(dir).sort();
if (!await until(`window.hq.claudeHub.documents({ source: 'prompt', limit: 200 }).then((rows) => Array.isArray(rows) && rows.some((r) => r.id === ${JSON.stringify(r1.id)}))`, 20000)) fails.push('the promoted note never reached the index');
if (!await until(`window.hq.claudeHub.promptCandidates({ limit: 50 }).then((r) => (r.candidates || []).some((x) => x.text === ${JSON.stringify(A.trim())} && x.reasons.some((y) => y.key === 'library')))`, 20000)) fails.push('no "already a prompt note" term after Promote');
const hid = await ev(`window.hq.claudeHub.hideCandidate(${JSON.stringify(b ? b.key : '')})`);
c = await cands();
if (hid !== true || find(c, B) || !(c.hidden >= 1)) fails.push('hide: ' + JSON.stringify({ hid, hidden: c.hidden }));
report.hidden = c.hidden;
console.log(JSON.stringify({ fails, report }, null, 1));
process.exit(fails.length ? 1 : 0);
```

Run: `node "$g\gate-p2.mjs" 9499 $g ; $gateCode = $LASTEXITCODE`
Expected: `{"fails": [], …}` and `$gateCode` = 0; `report.promptFiles` = `["gate-masked.md", "gate-promoted-prompt-2.md", "gate-promoted-prompt.md", "review-a-pr.md"]` (the last one is the H6 fixture's own note).

- [ ] **Step 3: The owner's things are untouched; stop only your instance; clean up.**

```powershell
if ((& $snap $ownerPrompts) -ne $promptsBefore) { 'FAIL: the owner vault 40_Resources changed' }
$dataAfter = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
if ($dataAfter -ne $dataBefore) { 'FAIL: data\claude changed' }
Select-String -Path (Join-Path $g 'logs\*.log'), (Join-Path $g 'main.out') -Pattern 'Gate placeholder prompt', 'Gate secret' -SimpleMatch -Quiet   # must print False: logs carry file names, never prompt text
Stop-Process -Id $p.Id
Get-Process -Id $p.Id -ErrorAction SilentlyContinue   # nothing
Remove-Item -LiteralPath $g -Recurse -Force
Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_VAULT_DIR, Env:HQ_IMPORTS_DIR, Env:HQ_STUDIO_ROOT, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION
```
Expected: no `FAIL:` line; `False` from Select-String; the owner's `electron.exe . --hidden` (no `--user-data-dir`) and its Hub child are still running (check `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine` — do NOT stop or restart it). Never run `tools\rollback.ps1` in this phase.

- [ ] **Step 4: Docs.**

`README.md` — in the Claude Hub section, after P1's prompt-library paragraph add: "Claude › Prompts › Candidates lists prompts you typed more than once or that started long sessions — harvested from your Claude Code, claude.ai and ChatGPT chats and your Claude Code prompt history. Each score is shown as its parts (\"used in 3 sessions +9\", \"followed by 12 assistant messages +3\", \"already a prompt note −5\"), never as a rating. Promote (one or several, after one confirm) writes a new note into `40_Resources/Prompts` — masked, never over an existing note; a name clash asks before saving as `-2`. Hide removes a candidate for good." In its test-commands list add `node --test dashboard/claude-hub/harvest.test.mjs` and the CDP scenarios `prompts-promote-confirm`, `prompts-candidates-hide`.

`CLAUDE.md` — append one bullet to "Facts that save you time": "- Prompt harvest (P2): `dashboard/claude-hub/harvest.mjs` (pure) scores Hub op `promptCandidates` (pool = newest 20 000 user messages + 20 000 history lines; reasons, never a judgment); Hide = `tombstone(kind 'candidate')` via `hideCandidate`; Promote = `claudePrompts.promote` in `dashboard/claude-prompts.js` (masked, `writePromptNote`, name only the title's slug or a confirmed `-2…-9`). No schema change (still 2)."

`docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` — re-read the P2 section against the landed code (`git diff <Task 1 commit>^ -- dashboard/preload.js dashboard/claude-hub-host.js dashboard/claude-prompts.js dashboard/claude-hub/hub.mjs dashboard/claude-hub/store.mjs`); fix any row that differs (additive wording only) and list the fixes in the commit body; if none, say "rows unchanged".

- [ ] **Step 5: HANDOFF entry.** Insert at the top of `docs/sync/HANDOFF.md` (below the format block and its `---`), with the real short sha (`git log -1 --format=%h` before this commit) and the local time in the heading:

```
## 2026-10-25 HH:MM · FROM frontend · main @ <short sha>
DONE: Prompt harvest + Promote P2 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p2.md), commits P2.2–P2.9 + this meta commit:
  harvest.mjs (pure: exclusions, reuse/turns/length/library terms as reasons), store harvestPool (bounded 20 000 + 20 000, history
  sessions = their Code session), Hub ops promptCandidates (readers too) / hideCandidate (tombstone kind candidate, writer);
  claudePrompts.promote (masked, slug or confirmed slug-2…-9 only, atomic, never overwrites, creates the Prompts folder);
  v5 Claude › Prompts › Candidates (score terms, origin, one-confirm Promote single/multi, clash step, Hide).
  Real second-instance gate on fixtures: PASS (<paste the gate report>).
IN-FLIGHT: none. Next phase P3 (run modal + packs). The owner's vault still has no 40_Resources/Prompts; the first Promote creates it.
  The owner's app was NOT restarted; it picks this up on its next restart (no schema change in P2).
ASKS: none (no structure-lane file touched).
BREAKS: none. New IPC hq:claude-hub:prompt-candidates|hide-candidate, hq:claude-prompts:promote (additive). main.js: no line touched.
  CONTRACT.md: tombstone kind candidate; Promote is the writer of new prompt notes.
```

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: prompt harvest P2 done — real second-instance gate on fixtures (PASS), README/CLAUDE.md facts, contract rows checked, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` only if Step 4 changed them; `git add` of an unchanged file is harmless. Never stage the other lane's four files: `collector/collector.config.json`, `data/quest-overrides.json`, `run-scan.ps1`, `schema/workspace-scan.schema.json`.)

## Self-review (done while writing; kept for the executor)

- Spec coverage: §6.2 pool / normalize / exclusions / scoring with reasons / −5 penalty → Tasks 2–3; Hub ops `promptCandidates` + `hideCandidate` (tombstone) → Tasks 3–4; §6.3 Candidates (reasons, origin, Promote single/multi with one confirm, Hide) → Tasks 6–9; §6.4 `promote` (atomic, Prompts folder only, containment, slug clash → confirm -2, masked) → Task 5 (on P1's `writePromptNote`); §7 rows → Task 1; §8 (Promote creates the folder, hidden never resurfaces, logs carry names only, "or promote a candidate" restored) → Tasks 5, 6, 10; §9 harvest scoring tests, promote containment tests, CDP `prompts-promote-confirm` → Tasks 2, 5, 9; real second instance → Task 10.
- Names used across tasks: `harvest`, `normalize`, `candidateKey`, `excludeReason` (Task 2) → `harvestPool`, `promptBodies`, `hiddenCandidates`, `hideCandidate` (Task 3) → ops `promptCandidates` / `hideCandidate`, channels `prompt-candidates` / `hide-candidate` (Task 4) → preload `claudeHub.promptCandidates` / `hideCandidate`, `claudePrompts.promote` (Task 5) → `candidateRow` / `candidatesView` / `refreshCandidates` (Task 6) → `candidatesLogic` `hc*` + state `prView`, `hcSel`, `promote` (Task 7; `hcDone` is an internal helper of the mixin) → vals `hc*`, `isPrLib`, `isPrCand`, DOM `data-hc=*` (Task 8) → selftest/CDP (Task 9) → gate (Task 10). Pool row shape fixed in Task 2 and produced by Task 3.
- No schema/index-version change (deviation 7); main.js: no line touched; every new channel has a contract row (Task 1) before its handler (Tasks 4–5).
- Commit trailer: write the executing model's real name in `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` (e.g. `Claude Opus 5.5`) — never a name you are not.

<!-- plan complete: 10 tasks -->
