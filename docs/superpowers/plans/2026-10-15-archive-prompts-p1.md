# Prompt library (phase P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude › Prompts shows the owner's vault prompt notes (`VEEMO CORTEX/40_Resources/Prompts/*.md`) as a Library — title, tags, variables, usage count and last use (real counts from `prompt_use`), search, "Open in Obsidian" (contained `obsidian://open` link) with an "Open file" fallback, and a Run button that P3 wires — plus a project-page "Run a prompt" shortcut; the §6.1 note format (frontmatter, `{{variables}}`, slug file names, never overwrite) exists as a tested module for P2's Promote.

**Architecture:** Note format = a NEW pure CommonJS module `dashboard/claude-prompt-note.js` (slug, clash names, variables, note text, prompt doc id), shared by the Electron main (`require`) and the Hub (ESM default-import of a CJS module). Hub side (system Node): H6's `store.listDocuments` rows additionally carry `meta` (parsed) and, for prompt rows, `variables`; a read-only `store.promptStats()` / Hub op `promptStats` over the H6 `prompt_use` table; host IPC `hq:claude-hub:prompt-stats`. Main side: a NEW `dashboard/claude-prompts.js` (spec §6.4 file) with `writePromptNote` (atomic, no-overwrite, contained — consumed by P2) and the IPC `hq:claude-prompts:status` / `hq:claude-prompts:open`; `open` never takes a path from the renderer or the index — it re-derives the file by scanning the Prompts folder for the file whose H6 `docId` equals the asked id. v5: a `live.prompts` slot + `refreshPrompts`/`searchPrompts` in the store, adapter rows, a `promptsLogic` mixin, `vals/prompts.js`, a `{{ isPrompts }}` block in `tpl/claude.tpl.js`, a "Run a prompt" button on the project page; selftest rows, golden scenarios, CDP scenarios.

**Tech Stack:** Node ≥ 22.13 `node:sqlite` (Hub), `node:test`, Electron 32 main (CommonJS; `shell.openExternal`, `shell.openPath`, `app.getApplicationNameForProtocol`), vanilla v5 renderer (template runtime `src/dc/runtime.js`), fake preload + CDP gate.

**Spec:** `docs/superpowers/specs/2026-10-15-archive-and-prompt-library-design.md` — §2 (vault path, external links, honesty, quota), §6.1 (note format), §6.3 (Library, project page), §6.4 (`claude-prompts.js`), §7 (`promptStats`, `claudePrompts` namespace), §8 (empty state, Obsidian fallback), §9 (open-link whitelist tests), §10 row P1. Hub base spec `docs/superpowers/specs/2026-10-13-claude-hub-design.md`. H6 plan (lands before this phase; its interfaces are relied on): `docs/superpowers/plans/2026-10-15-archive-prompts-h6.md` — `listDocuments`/`getDocument`, `docId(source, file) = source + ':' + sha1(path.resolve(file).toLowerCase())`, `PROMPTS_REL`, `makeDocsHome` fixture (builds `vault/40_Resources/Prompts/review-a-pr.md`), `changed.documents`, schema 2 `prompt_use`. Exact live names: `.superpowers/sdd/2026-10-16-code-map-archive.md` (HEAD 4c8da80; H6 shifts `main.js` lines — anchor by text, never by number).

**Written deviations from the spec (the spec is the authority; each has its reason):**
1. **Two `claudePrompts` channels not in §7:** `claudePrompts.status()` (`hq:claude-prompts:status`) and `claudePrompts.open(id, how)` (`hq:claude-prompts:open`). Reason: §6.3 needs "Open in Obsidian"/"Open file" and §8 needs "No prompts folder yet" and "Obsidian not installed → Open file"; the renderer can know neither without main. Both are additive rows.
2. **`listDocuments` rows gain `meta` (all sources) and `variables` (prompt rows).** Reason: the Library shows tags and variables for every row; one `getDocument` per row would be N round trips. Additive to the H6 row.
3. **`promptStats` lands in P1, not P3** (§10 puts "stats on the Library" in P3). Reason: the P1 Library shows usage and last use (§6.3); the H6 table `prompt_use` exists and is empty until P3 writes it, so the counts are real zeros ("not run yet"), never a placeholder number. P3 adds only the writer (`promptUse`).
4. **Note format + `writePromptNote` land without a Promote UI or IPC.** Reason: §10 gives the note format to P1 and Promote to P2; P2's `promote` consumes `writePromptNote` as is. Clash: `writePromptNote` returns `{error, exists:true, next:'<slug>-2.md'}` and writes nothing; P2's confirm then calls it again with the offered name ("a clash becomes `<slug>-2.md` after a confirm", §6.1).
5. **The project-page "Run a prompt" shortcut opens the Library with a project context chip, not a filtered list.** Reason: prompt notes have `project_id: null` (H6) and §6.1 has no project field, so "filtered to the project" has nothing to filter on; the chip ("for <project> — the Run step will fill {{project}} and {{cwd}} from it") is the run context P3's modal defaults to. Rows that use `{{project}}`/`{{cwd}}` are sorted first and marked "uses this project".
6. **The Prompts block lives inside `tpl/claude.tpl.js`, not a new `tpl/prompts-*.js` fragment** (§3 names `{logic,vals,tpl}/prompts-*.js`). Reason: `app.tpl.js` joins contiguous fragments and the sub-tab block must sit inside the `{{ v.claude }}` root of `claude.tpl.js`. Logic and vals are new files `logic/prompts.js`, `vals/prompts.js`.
7. **§8's empty-state text drops "or promote a candidate" until P2 lands Promote.** Reason: honesty — no button for it exists in P1. P2 restores the clause.
8. **"Run" in P1 is a visible button that says it lands with the run step** (`notWired`-style info toast, label "Run · uses your Claude quota"). Reason: §6.3 lists Run on the Library; the run modal is P3.

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

Phase-local facts: H6 ships store `SCHEMA_VERSION = 2` with `prompt_use` and `document`; **P1 changes no schema and no index shape** (no `SCHEMA_VERSION` or `INDEX_VERSION` bump: `meta`/`variables` are read-time columns of rows H6 already stores). `main.js`: exactly ONE new line, placed directly after the line containing `require('./claude-imports').init(` (H6) inside `app.whenReady` — find it with `grep -n "claude-imports').init" dashboard/main.js`. `VAULT` is the existing vault constant in `main.js` (`grep -n "^const VAULT" dashboard/main.js`). The owner's real vault has NO `40_Resources/Prompts` folder today (`40_Resources` holds `Clippings/ Libraries/ Research/ docs/ pkos-docs.md`), so the "No prompts folder yet" empty state is what the owner will see first.

## Review Focus

1. **A prompt note the owner wrote by hand in Obsidian with odd or missing frontmatter** (no `---` block, `tags: review` as a bare string, `variables` absent while the body uses `{{file}}`, a `title` with `: #[]`): the owner expects it listed with a sensible title and its real variables, never dropped or crashing the list. Pinned in Task 2 test `variablesOf: body tokens ∪ frontmatter, junk ignored` and Task 4 test `prompt rows carry parsed meta and variables; bad meta JSON is null, never a throw`.
2. **"Open in Obsidian" / "Open file" asked with an id that is not a prompt note in the folder** — a memory or CLAUDE.md id, a note deleted since the last sweep, a subfolder note, a junction leading out of the vault, or a crafted id: the owner expects a refusal with the reason and nothing opened; only `obsidian://open?vault=<basename>&file=40_Resources%2FPrompts%2F<name>` or that exact contained file is ever opened. Pinned in Task 5 test `open refuses everything but a contained prompt note; only the two allowed targets are opened`.
3. **Obsidian not installed (no `obsidian://` handler)**: the owner expects no "Open in Obsidian" button and a working "Open file", never a Windows "get an app" dialog. Pinned in Task 5 test `no obsidian handler → status says so and open(how:'obsidian') is refused with fallback 'file'` and Task 8 golden `claude.prompts-no-obsidian`.
4. **Four different "nothing to show" situations** — no bridge, Hub error, Prompts folder missing, folder exists but empty, plus a search with no hits: the owner expects each to say why, never a blank panel and never "0 prompts" for a Hub failure. Pinned in Task 6 test `promptsView: the empty states are distinct and a Hub error is never an empty list` and Task 9 selftest rows `prompts-*`.
5. **A title that slugifies to nothing or to a Windows-reserved name, and a clash with an existing note** (`CON`, `???`, `Review: PR #1`, 200 chars, an existing `review-a-pr.md`): P2's Promote will write through this module, so the owner expects a safe, readable file name and NEVER an overwrite of an existing note — even when the file appears between the check and the write. Pinned in Task 2 test `slugify: reserved, empty, long, punctuation` and Task 3 test `never overwrites: clash and a file appearing mid-write both refuse`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `docs/sync/IPC-CONTRACT.md` | modify (append P1 section before `## Rules`) | Rows for `claudeHub.documents` (+`meta`, `variables`), `claudeHub.promptStats()`, `claudePrompts.status()`, `claudePrompts.open(id, how)` |
| `docs/sync/CONTRACT.md` | modify (new entry after the H5 vault-note entry) | `VEEMO CORTEX/40_Resources/Prompts/<slug>.md` prompt note format (§6.1), who writes it (P2 Promote only, new files only) |
| `dashboard/claude-prompt-note.js` | create | Pure CJS: `PROMPTS_REL`, `slugify`, `noteName`, `variablesOf`, `promptNoteText`, `promptDocId`, `VAR_RE` |
| `dashboard/claude-prompt-note.test.mjs` | create | Format tests |
| `dashboard/claude-prompts.js` | create | Main: `promptsDir`, `writePromptNote`, `findPromptFile`, `obsidianUrl`, `createPrompts({…}) -> {status, open}`, `init` |
| `dashboard/claude-prompts.test.mjs` | create | Write/containment/open-whitelist tests (temp dirs, injected openers) |
| `dashboard/claude-hub/store.mjs` | modify | `listDocuments` rows + `meta`/`variables`; `promptStats()` |
| `dashboard/claude-hub/store.test.mjs` | modify | Row-shape + stats tests |
| `dashboard/claude-hub/hub.mjs` | modify | op `promptStats` |
| `dashboard/claude-hub/hub.test.mjs` | modify | spawned-Hub `promptStats` test |
| `dashboard/claude-hub-host.js` | modify | IPC `hq:claude-hub:prompt-stats` in `registerIpc` |
| `dashboard/claude-hub-host.test.mjs` | modify | handler test |
| `dashboard/preload.js` | modify | `claudeHub.promptStats`, `claudePrompts.{status, open}` |
| `dashboard/main.js` | modify (+1 line after the `claude-imports` init line) | `require('./claude-prompts').init({ ipcMain, app, shell, vaultDir: VAULT });` |
| `dashboard-v5/tools/fake-preload.js` | modify | SPEC rows for the 3 new methods (fake-parity) |
| `dashboard-v5/src/live/adapter.mjs` (+ `adapter.test.mjs`) | modify | `promptRow`, `promptsView` |
| `dashboard-v5/src/live/store.js` (+ `store.test.mjs`) | modify | `live.prompts`, `refreshPrompts`, `searchPrompts`, `openPrompt`; `changed.documents` routing |
| `dashboard-v5/src/live/catalog.mjs` | modify | `SUBS.claude` gains `['prompts','Prompts']` (after `chats`) |
| `dashboard-v5/src/logic/prompts.js` (+ `prompts.test.mjs`) | create | `promptsLogic` mixin: `prLoad, onPrQuery, prSearch, prClear, prOpen, prRun, prForProject, prClearProject` |
| `dashboard-v5/src/app.js` | modify | import + `Object.assign` the mixin; `initState` gains `prompts` |
| `dashboard-v5/src/vals/prompts.js` | create | `promptsVals` (keys `isPrompts`, `pr*`, `ppRunPrompt`) |
| `dashboard-v5/src/vals/index.js` | modify | append `promptsVals` to `SURFACES` |
| `dashboard-v5/src/tpl/claude.tpl.js` | modify | `{{ isPrompts }}` block (`<!-- v5: -->` marked) |
| `dashboard-v5/src/tpl/project-page.tpl.js` | modify | "Run a prompt" button beside New chat |
| `dashboard-v5/src/tpl.hash.test.mjs` | modify | re-record SHA256/LENGTH/UTF8_BYTES + dated comment |
| `dashboard-v5/src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json` | modify | new `claude.prompts-*` scenarios; attributed re-record |
| `dashboard-v5/src/selftest.js` | modify | `prompts-*` STATES rows, `CLEAR` gains nothing new (no overlay) |
| `dashboard-v5/tools/cdp-gate.mjs` | modify | scenarios `prompts-library-open`, `prompts-project-shortcut` |
| `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | modify | docs + handoff (last task) |

---

### Task 1: Contract rows first (IPC-CONTRACT P1 section + CONTRACT prompt-note entry)

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (new section directly before `## Rules`, after the H6 section)
- Modify: `docs/sync/CONTRACT.md` (new entry directly after the `VEEMO CORTEX/30_Areas/Claude/…` H5 entry)

**Interfaces:**
- Consumes: the H6 IPC section (rows `claudeHub.documents`, `claudeHub.document`) and the H6 CONTRACT schema-2 paragraph — must already be in the files (`grep -n "phase H6 (rows written" docs/sync/IPC-CONTRACT.md` prints one line; if not, STOP: H6 has not landed).
- Produces: the names every later task uses, exactly: Hub op `promptStats()`; store `promptStats()`; preload `claudeHub.promptStats()`, `claudePrompts.status()`, `claudePrompts.open(id, how)`; channels `hq:claude-hub:prompt-stats`, `hq:claude-prompts:status`, `hq:claude-prompts:open`; row fields `meta`, `variables`.

- [ ] **Step 1: Write the IPC-CONTRACT section.** Insert verbatim before `## Rules`:

````markdown
## 2026-10-25 — Prompt library, phase P1 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.1, §6.3, §6.4, §7, §8. Main-side code: the NEW file
`dashboard/claude-prompts.js` (one new hook line in `main.js`, after the `claude-imports` line); the Hub handler is added to
`dashboard/claude-hub-host.js` (`registerIpc`). P1 writes nothing to the vault.

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.documents(opts?)` (H6, extended) | `hq:claude-hub:documents` | every row gains `meta` (the stored frontmatter / meta JSON parsed, or `null`; masked like the text); `source:'prompt'` rows also gain `variables: [name]` = the frontmatter `variables` list ∪ the `{{name}}` tokens of the body, in first-seen order, names matching `[A-Za-z_][A-Za-z0-9_-]{0,39}`, at most 20. Other fields and the order are unchanged |
| `claudeHub.promptStats()` | `hq:claude-hub:prompt-stats` (invoke) | → `[{prompt_id, uses, last_at}]` (one row per prompt id that has at least one `prompt_use` row; `uses` = real count, `last_at` = ISO of the newest) \| `{error}`. Nothing writes `prompt_use` before phase P3, so the list is `[]` until then. Readers allowed |
| `claudePrompts.status()` | `hq:claude-prompts:status` (invoke) | → `{vault:<basename of the configured vault root>, rel:'40_Resources/Prompts', folder:{exists:boolean}, obsidian:boolean}` — `obsidian` = an `obsidian://` handler is registered on this PC (`app.getApplicationNameForProtocol`). Never a path. Never throws |
| `claudePrompts.open(id, how)` | `hq:claude-prompts:open` (invoke) | in: a prompt document id (`prompt:<sha1>`, string ≤ 300) and `how` ∈ `'obsidian'\|'file'` → `{ok:true, how}` \| `{error}` \| `{error, fallback:'file'}` (Obsidian not installed). Main finds the file itself: it lists `<vault>/40_Resources/Prompts/*.md` (top level only) and takes the one whose H6 `docId` equals `id`; the realpaths of the folder and the file must stay inside the vault (junctions out refused). `obsidian` opens exactly `obsidian://open?vault=<encodeURIComponent(vault basename)>&file=<encodeURIComponent('40_Resources/Prompts/<file name without .md>')>`; `file` calls `shell.openPath` on that file. No path or URL is ever taken from the renderer, the index or note text. `HQ_DRY_LAUNCH=1` logs `[dry-open] obsidian\|file <name>`, opens nothing and answers `{ok:true, how, dry:true}` (gates) |
````

- [ ] **Step 2: Write the CONTRACT entry.** Insert after the H5 `30_Areas/Claude` entry:

```markdown
### `VEEMO CORTEX/40_Resources/Prompts/<slug>.md` — prompt notes (frontend lane, owner's vault; prompt library P1 format, P2 writes)

The owner's prompt library; the vault is the source of truth (spec 2026-10-15 §6.1). The Hub only reads the folder (top level,
`*.md`, H6 `ingest-docs.mjs`). WorkspaceHQ writes only NEW notes the owner confirmed (Promote, from phase P2), through
`writePromptNote` in `dashboard/claude-prompts.js`: atomic (temp + hard link), never an overwrite — a clash is refused and
offers `<slug>-2.md`…`<slug>-9.md`. File name = `slugify(title)` (`dashboard/claude-prompt-note.js`: NFKD, ASCII letters/digits,
`-` separators, ≤ 60 chars, Windows device names prefixed `prompt-`, empty → `prompt`). Frontmatter (YAML; strings
JSON-quoted): `title`, `tags: [a, b]`, `variables: [a, b]`, `version: 1`, `created` (ISO), `source: { kind, conversation, at }`
(harvested only), `hq: { id: "prompt:<sha1 of the lowercased absolute path>" }` (harmless if removed). Body = the prompt;
variables are `{{name}}` tokens (`{{project}}` / `{{cwd}}` filled from the chosen project at run time). Bodies written by
WorkspaceHQ are masked (`maskSecrets`). The structure lane never writes here.
```

- [ ] **Step 3: Check the rows.**

Run (Git Bash): `sed -n '/phase P1 (rows written/,/^## Rules/p' docs/sync/IPC-CONTRACT.md | grep -c '^| .claude'`
Expected: `4`

- [ ] **Step 4: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: P1 prompt library — IPC-CONTRACT rows (documents meta/variables, promptStats, claudePrompts.status/open) and CONTRACT prompt-note format, before any handler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prompt note format — `dashboard/claude-prompt-note.js` (slug, clash names, variables, note text, doc id)

**Files:**
- Create: `dashboard/claude-prompt-note.js`
- Create: `dashboard/claude-prompt-note.test.mjs`

**Interfaces:**
- Consumes: H6 `dashboard/claude-hub/ingest-docs.mjs` exports `parseFrontmatter(src) -> {data, body, has}` and `docId(source, file)` (tests only — they pin that what this module writes is what H6 reads, and that the ids agree).
- Produces (CommonJS, no Electron import, no I/O):
  - `PROMPTS_REL = ['40_Resources', 'Prompts']`, `SLUG_MAX = 60`, `VARS_MAX = 20`, `VAR_RE` (global regex of `{{ name }}`).
  - `slugify(title) -> string` (never empty; never a Windows device name).
  - `noteName(slug, n = 1) -> '<slug>.md' | '<slug>-<n>.md'`.
  - `variablesOf(meta, body) -> string[]` (frontmatter `variables` list or comma string ∪ body tokens; valid names only; first-seen order; ≤ 20).
  - `promptNoteText({title, tags, variables, created, source, id, body}) -> string` (§6.1 layout; parses back with H6 `parseFrontmatter`).
  - `promptDocId(file) -> 'prompt:<sha1 of path.resolve(file).toLowerCase()>'` (= H6 `docId('prompt', file)`).

- [ ] **Step 1: Write the failing test** `dashboard/claude-prompt-note.test.mjs`:

```js
// Prompt note format (spec 2026-10-15 §6.1, phase P1). Pure; no vault is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import note from './claude-prompt-note.js';
import { parseFrontmatter, docId } from './claude-hub/ingest-docs.mjs';

const { slugify, noteName, variablesOf, promptNoteText, promptDocId, PROMPTS_REL, SLUG_MAX } = note;

test('slugify: reserved, empty, long, punctuation', () => {
  assert.equal(slugify('Review a PR like a staff engineer'), 'review-a-pr-like-a-staff-engineer');
  assert.equal(slugify('Review: PR #1 [draft]'), 'review-pr-1-draft');
  assert.equal(slugify('Café crème — brûlée'), 'cafe-creme-brulee');
  for (const t of ['', '???', null, undefined, '日本語', '   ']) assert.equal(slugify(t), 'prompt', String(t));
  assert.equal(slugify('CON'), 'prompt-con');
  assert.equal(slugify('com1'), 'prompt-com1');
  assert.equal(slugify('lpt9'), 'prompt-lpt9');
  assert.equal(slugify('console'), 'console');
  assert.equal(slugify('a'.repeat(200)).length, SLUG_MAX);
  const long = slugify('word '.repeat(30));
  assert.ok(long.length <= SLUG_MAX && !long.endsWith('-') && !long.startsWith('-'), long);
  assert.match(slugify('../../etc/passwd'), /^[a-z0-9-]+$/);
});

test('noteName: first name, then -2 … for clashes', () => {
  assert.equal(noteName('review-a-pr'), 'review-a-pr.md');
  assert.equal(noteName('review-a-pr', 1), 'review-a-pr.md');
  assert.equal(noteName('review-a-pr', 2), 'review-a-pr-2.md');
  assert.deepEqual(PROMPTS_REL, ['40_Resources', 'Prompts']);
});

test('variablesOf: body tokens ∪ frontmatter, junk ignored', () => {
  assert.deepEqual(variablesOf({ variables: ['project', 'file'] }, 'Use {{file}} and {{ extra }} and {{bad name}} {{1x}} {{}}'), ['project', 'file', 'extra']);
  assert.deepEqual(variablesOf({ variables: 'a, b' }, ''), ['a', 'b']);   // a bare string in hand-written frontmatter
  assert.deepEqual(variablesOf(null, '{{x}}{{x}} {{ x }}'), ['x']);
  assert.deepEqual(variablesOf({ variables: [1, {}, 'ok', 'has space'] }, null), ['ok']);
  assert.deepEqual(variablesOf({}, 'no variables here {single}'), []);
  const many = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(' ');
  assert.equal(variablesOf(null, many).length, 20);
});

test('promptNoteText: §6.1 layout that H6 parseFrontmatter reads back', () => {
  const file = path.join(os.tmpdir(), 'vault', ...PROMPTS_REL, 'review-a-pr.md');
  const id = promptDocId(file);
  const text = promptNoteText({
    title: 'Review: a PR\nlike staff #1', tags: ['review', 'code', 'bad tag!', ''], variables: ['project', 'file'],
    created: '2026-10-15T10:00:00Z', source: { kind: 'code', conversation: 'code:s1', at: '2026-09-02T14:03:00Z' }, id,
    body: 'You are reviewing {{file}} in {{project}}. Placeholder body.',
  });
  assert.ok(text.startsWith('---\ntitle: '));
  assert.ok(text.endsWith('Placeholder body.\n'));
  const fm = parseFrontmatter(text);
  assert.equal(fm.has, true);
  assert.equal(fm.data.title, 'Review: a PR like staff #1');
  assert.deepEqual(fm.data.tags, ['review', 'code', 'badtag']);
  assert.deepEqual(fm.data.variables, ['project', 'file']);
  assert.equal(fm.data.version, 1);
  assert.deepEqual(fm.data.source, { kind: 'code', conversation: 'code:s1', at: '2026-09-02T14:03:00Z' });
  assert.deepEqual(fm.data.hq, { id });
  assert.equal(fm.body, 'You are reviewing {{file}} in {{project}}. Placeholder body.\n');
  const bare = parseFrontmatter(promptNoteText({ title: 'T', body: 'B', created: '2026-10-15T10:00:00Z' }));
  assert.equal(bare.data.source, undefined, 'source only when harvested');
  assert.deepEqual(bare.data.tags, []);
});

test('promptDocId equals the H6 document id of the same file (any case)', () => {
  const file = path.join(os.tmpdir(), 'Vault', '40_Resources', 'Prompts', 'Review-A-PR.md');
  assert.equal(promptDocId(file), docId('prompt', file));
  assert.equal(promptDocId(file.toUpperCase()), docId('prompt', file));
  assert.match(promptDocId(file), /^prompt:[0-9a-f]{40}$/);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --test dashboard/claude-prompt-note.test.mjs`
Expected: FAIL — `Cannot find module '…/dashboard/claude-prompt-note.js'`.

- [ ] **Step 3: Implement** `dashboard/claude-prompt-note.js`:

```js
'use strict';
// Prompt note format (spec 2026-10-15-archive-and-prompt-library-design.md §6.1, phase P1) — pure, no I/O.
// Shared by the Electron main (require) and the Claude Hub (ESM default import of this CommonJS module).
const crypto = require('node:crypto');
const path = require('node:path');

const PROMPTS_REL = ['40_Resources', 'Prompts'];
const SLUG_MAX = 60;
const VARS_MAX = 20;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]{0,39})\s*\}\}/g;
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function slugify(title) {
  // strip combining marks — written as \u escapes so no raw combining character sits in the source file
  const s = String(title == null ? '' : title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');
  if (!s) return 'prompt';
  return DEVICE_RE.test(s) ? 'prompt-' + s : s;
}

const noteName = (slug, n = 1) => (n > 1 ? `${slug}-${n}.md` : `${slug}.md`);

function variablesOf(meta, body) {
  const out = [];
  const add = (v) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (NAME_RE.test(t) && !out.includes(t) && out.length < VARS_MAX) out.push(t);
  };
  const fm = meta && typeof meta === 'object' ? meta.variables : null;
  if (Array.isArray(fm)) fm.forEach(add);
  else if (typeof fm === 'string') fm.split(',').forEach(add);
  for (const m of String(body == null ? '' : body).matchAll(VAR_RE)) add(m[1]);
  return out;
}

// control characters (C0 + DEL) become spaces; the regex is built from code points so no raw control char sits in this file
const CTRL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']+', 'g');
const oneLine = (s, max) => String(s == null ? '' : s).replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const tagOf = (t) => String(t == null ? '' : t).replace(/[^A-Za-z0-9_/-]/g, '').slice(0, 40);
const list = (xs) => '[' + xs.join(', ') + ']';

function promptNoteText({ title, tags = [], variables = [], created, source = null, id = null, body = '' }) {
  const lines = ['---', 'title: ' + JSON.stringify(oneLine(title, 200) || 'Untitled prompt'),
    'tags: ' + list((Array.isArray(tags) ? tags : []).map(tagOf).filter(Boolean)),
    'variables: ' + list(variablesOf({ variables }, '')),
    'version: 1',
    'created: ' + oneLine(created, 40)];
  if (source && typeof source === 'object') {
    const kind = /^[a-z.]{1,20}$/.test(String(source.kind)) ? source.kind : 'unknown';
    lines.push(`source: { kind: ${kind}, conversation: ${JSON.stringify(oneLine(source.conversation, 300))}, at: ${JSON.stringify(oneLine(source.at, 40))} }`);
  }
  if (id) lines.push(`hq: { id: ${JSON.stringify(oneLine(id, 60))} }`);
  lines.push('---');
  const b = String(body == null ? '' : body).replace(/\r\n/g, '\n');
  return lines.join('\n') + '\n' + (b.endsWith('\n') ? b : b + '\n');
}

const promptDocId = (file) => 'prompt:' + crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex');

module.exports = { PROMPTS_REL, SLUG_MAX, VARS_MAX, VAR_RE, slugify, noteName, variablesOf, promptNoteText, promptDocId };
```

If `promptDocId` disagrees with H6 `docId` (the test says so), copy H6's exact hashing (`grep -n "export const docId" dashboard/claude-hub/ingest-docs.mjs`) — H6 is the authority for ids. If H6 `parseFrontmatter` reads a quoted `title` or an inline map differently from what this test expects, change THIS module's output (it is what P2 will write), never H6's parser; keep the test's intent (round trip).

- [ ] **Step 4: Run it to see it pass.**

Run: `node --test dashboard/claude-prompt-note.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompt-note.js dashboard/claude-prompt-note.test.mjs
git commit -m "fe: P1.2 — prompt note format (slug, clash names, {{variables}}, §6.1 frontmatter the H6 parser reads back, doc id = H6 docId)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `writePromptNote` — atomic, contained, never overwrites (`dashboard/claude-prompts.js`, part 1)

**Files:**
- Create: `dashboard/claude-prompts.js`
- Create: `dashboard/claude-prompts.test.mjs`

**Interfaces:**
- Consumes: Task 2 `PROMPTS_REL`, `slugify`, `noteName`, `promptNoteText`; `dashboard/claude-vault.js` export `writeNoteAtomic(file, text, {replace, ops})` (H5: temp file + hard link; a clash throws an Error with `.exists = true`; the temp file never survives).
- Produces (CommonJS; no Electron import at top level):
  - `NOTE_TEXT_MAX = 200000`.
  - `resolvePromptsDir(vaultDir, {create = false} = {}) -> Promise<string|null>` — the realpath of `<vault>/40_Resources/Prompts`, `null` when it does not exist (and `create` is false); throws `Error` (message without paths) when the vault is missing or the folder's realpath leaves the vault.
  - `writePromptNote(vaultDir, {name, text}, {ops} = {}) -> Promise<{path, name} | {error} | {error, exists:true, next:string|null}>` — P2's Promote calls it; P1 has no IPC for it. Never throws.

- [ ] **Step 1: Write the failing test** `dashboard/claude-prompts.test.mjs`:

```js
// Prompt library main side (spec 2026-10-15 §6.4, phase P1): note writing + (Task 5) open whitelist. Temp dirs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import prompts from './claude-prompts.js';
import note from './claude-prompt-note.js';

const { writePromptNote, resolvePromptsDir } = prompts;
const WIN = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p1-'));
const TEXT = note.promptNoteText({ title: 'Review a PR', tags: ['review'], created: '2026-10-15T10:00:00Z', body: 'Placeholder {{file}}' });
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));

test('writes a new note, creating the Prompts folder inside the vault', async () => {
  const vault = tmp();
  assert.equal(await resolvePromptsDir(vault), null, 'missing folder is null, not an error');
  const r = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  const dir = path.join(vault, '40_Resources', 'Prompts');
  assert.equal(r.name, 'review-a-pr.md');
  // .native = the same resolver as fsp.realpath: it expands 8.3 TEMP names (C:\Users\ROGSTR~1\…); the JS fs.realpathSync does not
  assert.equal(path.dirname(r.path).toLowerCase(), fs.realpathSync.native(dir).toLowerCase());
  assert.equal(fs.readFileSync(r.path, 'utf8'), TEXT);
  assert.deepEqual(leftovers(dir), []);
});

test('never overwrites: clash and a file appearing mid-write both refuse', async () => {
  const vault = tmp();
  const dir = path.join(vault, '40_Resources', 'Prompts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review-a-pr.md'), 'OWNER NOTE');
  const a = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  assert.deepEqual(a, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-2.md' });
  fs.writeFileSync(path.join(dir, 'review-a-pr-2.md'), 'OWNER NOTE 2');
  assert.equal((await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT })).next, 'review-a-pr-3.md');
  for (let n = 3; n <= 9; n++) fs.writeFileSync(path.join(dir, `review-a-pr-${n}.md`), 'x');
  const full = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  assert.equal(full.exists, true); assert.equal(full.next, null);
  // a file that appears between the check and the link (Obsidian saving the same name): EEXIST → refused, theirs kept
  const race = { link: async (from, to) => { fs.writeFileSync(to, 'APPEARED'); return fsp.link(from, to); }, rename: fsp.rename };
  const b = await writePromptNote(vault, { name: 'fresh.md', text: TEXT }, { ops: race });
  assert.equal(b.exists, true);
  assert.equal(fs.readFileSync(path.join(dir, 'fresh.md'), 'utf8'), 'APPEARED');
  assert.equal(fs.readFileSync(path.join(dir, 'review-a-pr.md'), 'utf8'), 'OWNER NOTE');
  assert.deepEqual(leftovers(dir), []);
});

test('refuses names, texts and folders it does not make', async () => {
  const vault = tmp();
  for (const name of ['../x.md', 'a/b.md', 'a\\b.md', 'X.md', 'con.md', 'x.txt', '', '.md', 'a'.repeat(70) + '.md', null]) {
    const r = await writePromptNote(vault, { name, text: TEXT });
    assert.ok(r.error && !r.exists, String(name));
  }
  assert.ok((await writePromptNote(vault, { name: 'ok.md', text: 'no frontmatter' })).error);
  assert.ok((await writePromptNote(vault, { name: 'ok.md', text: '---\n' + 'x'.repeat(200001) })).error);
  assert.ok((await writePromptNote(path.join(vault, 'nope'), { name: 'ok.md', text: TEXT })).error, 'missing vault');
  assert.ok((await writePromptNote(null, { name: 'ok.md', text: TEXT })).error, 'no vault configured');
  assert.equal(fs.existsSync(path.join(vault, '40_Resources', 'Prompts', 'ok.md')), false);
});

test('a Prompts junction that leads out of the vault is refused', { skip: !WIN && 'junctions are Windows-only' }, async () => {
  const vault = tmp(), outside = tmp();
  fs.mkdirSync(path.join(vault, '40_Resources'), { recursive: true });
  fs.symlinkSync(outside, path.join(vault, '40_Resources', 'Prompts'), 'junction');
  const r = await writePromptNote(vault, { name: 'ok.md', text: TEXT });
  assert.match(r.error, /outside the vault/);
  assert.deepEqual(fs.readdirSync(outside), []);
  await assert.rejects(resolvePromptsDir(vault), /outside the vault/);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `Cannot find module '…/dashboard/claude-prompts.js'`.

- [ ] **Step 3: Implement** `dashboard/claude-prompts.js` (part 1; Task 5 appends `status`/`open`/`init` to this file):

```js
'use strict';
// Prompt library, main side (spec 2026-10-15-archive-and-prompt-library-design.md §6.4). Phase P1: writePromptNote
// (consumed by P2's Promote) and the Library's status/open channels (Task 5). The vault's other notes are read-only:
// this module writes only NEW files directly inside <vault>/40_Resources/Prompts, never an overwrite.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { PROMPTS_REL, slugify, noteName } = require('./claude-prompt-note');
const { writeNoteAtomic } = require('./claude-vault');

const NOTE_TEXT_MAX = 200000;
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

async function resolvePromptsDir(vaultDir, { create = false } = {}) {
  if (!vaultDir || typeof vaultDir !== 'string') throw new Error('no vault folder is configured');
  let realVault;
  try { realVault = await fsp.realpath(vaultDir); } catch { throw new Error('the vault folder was not found'); }
  const dir = path.join(path.resolve(vaultDir), ...PROMPTS_REL);
  if (create) await fsp.mkdir(dir, { recursive: true });
  let realDir;
  try { realDir = await fsp.realpath(dir); } catch { return null; }
  if (!same(realDir, path.join(realVault, ...PROMPTS_REL))) throw new Error('40_Resources/Prompts leads outside the vault — refusing');
  return realDir;
}

// a name this module would make: <slug>.md or <slug>-<2..9>.md, slug = slugify(slug)
function validName(name) {
  if (typeof name !== 'string' || !/\.md$/.test(name)) return false;
  const stem = name.slice(0, -3);
  if (!stem || slugify(stem) !== stem) return false;
  return true;
}

const exists = (f) => { try { fs.lstatSync(f); return true; } catch { return false; } };

function clash(dir, name) {
  const base = name.slice(0, -3).replace(/-[2-9]$/, '');
  let next = null;
  for (let n = 2; n <= 9 && !next; n++) if (!exists(path.join(dir, noteName(base, n)))) next = noteName(base, n);
  return { error: next ? 'a prompt note with this name is already there' : 'a prompt note with this name is already there (and -2 … -9 too)', exists: true, next };
}

async function writePromptNote(vaultDir, { name, text } = {}, { ops } = {}) {
  try {
    if (!validName(name)) return { error: 'that file name is not one the prompt library makes' };
    if (typeof text !== 'string' || !text.startsWith('---\n') || text.length > NOTE_TEXT_MAX) return { error: 'that is not a prompt note' };
    const dir = await resolvePromptsDir(vaultDir, { create: true });   // §8: Promote creates the folder
    const file = path.join(dir, name);
    if (exists(file)) return clash(dir, name);
    try { await writeNoteAtomic(file, text, { replace: false, ...(ops ? { ops } : {}) }); }
    catch (e) { if (e && e.exists) return clash(dir, name); throw e; }
    return { path: file, name };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

module.exports = { NOTE_TEXT_MAX, resolvePromptsDir, writePromptNote };
```

Note for P2 (not this task): the body handed to `promptNoteText` must already be `maskSecrets`-masked (Global Constraints) — `writePromptNote` writes the text it is given.

- [ ] **Step 4: Run it to see it pass.**

Run: `node --test dashboard/claude-prompts.test.mjs dashboard/claude-prompt-note.test.mjs dashboard/claude-vault.test.mjs`
Expected: PASS (the junction test skips off Windows). `claude-vault.test.mjs` is unchanged and still green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs
git commit -m "fe: P1.3 — writePromptNote: new notes only, inside 40_Resources/Prompts (junction-safe), atomic hard-link write, clash offers -2…-9 and never overwrites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hub — prompt rows carry `meta` + `variables`; `promptStats` (store, op, host IPC)

**Files:**
- Modify: `dashboard/claude-hub/store.mjs` (H6 `listDocuments`; new `promptStats`)
- Modify: `dashboard/claude-hub/store.test.mjs` (append)
- Modify: `dashboard/claude-hub/hub.mjs` (`const ops` gains `promptStats`)
- Modify: `dashboard/claude-hub/hub.test.mjs` (append)
- Modify: `dashboard/claude-hub-host.js` (`registerIpc` gains one handler)
- Modify: `dashboard/claude-hub-host.test.mjs` (channel list + append)

**Interfaces:**
- Consumes: Task 2 `variablesOf(meta, body)` (imported into the Hub as `import promptNote from '../claude-prompt-note.js'`); H6 store `upsertDocument`, `listDocuments`, table `prompt_use(prompt_id, at, target, project_id, conversation_id)`; H6 fixture `makeDocsHome(dir) -> {home, vault, prompts, files}` (`__fixtures__/make-docs.mjs`); hub.test.mjs helpers `startHub(env, db)` / `tmp(prefix)` (hub.test.mjs:50 / :19 at HEAD; H6 uses them too).
- Produces:
  - `store.listDocuments(...)` rows: `+ meta` (parsed object or `null`) for every source; `+ variables: string[]` for `source:'prompt'` rows only. No `text` column leaks into rows.
  - `store.promptStats() -> [{prompt_id, uses, last_at}]` ordered `last_at DESC, prompt_id`.
  - Hub op `promptStats() -> rows` (readers allowed; no open store → throws `'the index is not open yet'` — errors surface, never `[]`).
  - IPC `hq:claude-hub:prompt-stats` → `host.request('promptStats', {})`.

- [ ] **Step 1: Write the failing store tests.** Append to `dashboard/claude-hub/store.test.mjs`:

```js
test('P1: prompt rows carry parsed meta and variables; bad meta JSON is null, never a throw', () => {
  const s = openStore(':memory:');
  s.upsertDocument({ id: 'prompt:a', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\a.md', title: 'A', text: 'Use {{file}} in {{project}}', mtimeMs: 2, size: 1, meta: { title: 'A', tags: ['review'], variables: ['project'] } });
  s.upsertDocument({ id: 'prompt:b', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\b.md', title: 'B', text: 'no vars here', mtimeMs: 1, size: 1, meta: { title: 'B' } });
  s.upsertDocument({ id: 'memory:m', source: 'memory', path: 'C:\\placeholder\\m.md', title: 'M', text: '{{not_a_prompt}}', mtimeMs: 3, size: 1, meta: { name: 'M' } });
  s.db.prepare("UPDATE document SET meta = '{bad' WHERE id = 'prompt:b'").run();
  const rows = s.listDocuments({ source: 'prompt' });
  assert.deepEqual(rows.map((r) => r.id), ['prompt:a', 'prompt:b']);
  assert.deepEqual(rows[0].meta, { title: 'A', tags: ['review'], variables: ['project'] });
  assert.deepEqual(rows[0].variables, ['project', 'file']);
  assert.equal(rows[1].meta, null);
  assert.equal(rows[1].origin, null, 'json_valid guards the H6 origin column');
  assert.deepEqual(rows[1].variables, []);
  for (const k of ['text', 'meta_json', 'prompt_text']) assert.equal(k in rows[0], false, k + ' must not reach the renderer');
  const mem = s.listDocuments({}).find((r) => r.id === 'memory:m');
  assert.deepEqual(mem.meta, { name: 'M' });
  assert.equal('variables' in mem, false);
  const hit = s.listDocuments({ source: 'prompt', q: 'file' });
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].variables, ['project', 'file']);
  assert.ok(typeof hit[0].snippet === 'string');
});

test('P1: promptStats counts prompt_use rows per prompt (real counts; empty before P3 writes any)', () => {
  const s = openStore(':memory:');
  assert.deepEqual(s.promptStats(), []);
  const ins = s.db.prepare('INSERT INTO prompt_use(prompt_id, at, target) VALUES (?, ?, ?)');
  ins.run('prompt:a', '2026-10-20T10:00:00.000Z', 'chat');
  ins.run('prompt:a', '2026-10-22T10:00:00.000Z', 'terminal');
  ins.run('prompt:b', '2026-10-21T10:00:00.000Z', 'claude.ai');
  assert.deepEqual(s.promptStats(), [
    { prompt_id: 'prompt:a', uses: 2, last_at: '2026-10-22T10:00:00.000Z' },
    { prompt_id: 'prompt:b', uses: 1, last_at: '2026-10-21T10:00:00.000Z' },
  ]);
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL — `rows[0].meta` is `undefined`, and `s.promptStats is not a function`.

- [ ] **Step 3: Implement in `store.mjs`.** Add at the imports: `import promptNote from '../claude-prompt-note.js';` and `const { variablesOf } = promptNote;`. In H6's `listDocuments`, replace H6's `json_extract(d.meta, '$.origin') AS origin` with `CASE WHEN json_valid(d.meta) THEN json_extract(d.meta, '$.origin') END AS origin` (SQLite's `json_extract` RAISES "malformed JSON" on a non-JSON value, so one bad `meta` would fail the whole list — the test's `'{bad'` row pins it), extend `cols` with `, d.meta AS meta_json, CASE WHEN d.source = 'prompt' THEN d.text END AS prompt_text` and pass every result through `docRow` (both the FTS and the plain query: `.all(...).map(docRow)`). Add above `api(db)` (module scope) and inside the API object:

```js
// P1: list rows carry the parsed meta (all sources) and, for prompt notes, their {{variables}}; the text itself stays out
function docRow(r) {
  const { meta_json: mj, prompt_text: pt, ...rest } = r;
  let meta = null;
  try { meta = mj ? JSON.parse(mj) : null; } catch { meta = null; }
  const out = { ...rest, meta };
  if (rest.source === 'prompt') out.variables = variablesOf(meta, pt);
  return out;
}
```

```js
    promptStats: () => q(`SELECT prompt_id, COUNT(*) AS uses, MAX(at) AS last_at FROM prompt_use
      GROUP BY prompt_id ORDER BY last_at DESC, prompt_id`).all().map((r) => ({ prompt_id: r.prompt_id, uses: Number(r.uses), last_at: r.last_at })),
```

- [ ] **Step 4: Run them to see them pass.**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: PASS (all store tests, incl. H6's document tests — the added keys do not break their assertions; if an H6 test `deepEqual`s a whole list row, add `meta: …` to its expectation and say so in the commit body).

- [ ] **Step 5: Write the failing Hub + host tests.** Append to `dashboard/claude-hub/hub.test.mjs` (H6 Task 7 already imports `makeDocsHome` from `./__fixtures__/make-docs.mjs` at the top of this file — check with `grep -n "make-docs" dashboard/claude-hub/hub.test.mjs`; do NOT import it a second time, a duplicate import binding is a SyntaxError that kills the whole suite; `tmp(prefix)`, `startHub(env, db)`, `h.until`, `h.req`, `h.stop` are the file's helpers at HEAD :19/:50-80):

```js
test('P1: prompt rows from HQ_VAULT_DIR carry tags/variables; promptStats is real (empty) and readers may ask', async () => {
  const dir = tmp('hub-p1-');
  const fx = makeDocsHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: fx.home, HQ_VAULT_DIR: fx.vault, HQ_HUB_SWEEP_MS: '500' }, db);
  try {
    assert.ok(await h.until(async () => (await h.req('listDocuments', { source: 'prompt' })).result.length === 1, 15000));
    const [p] = (await h.req('listDocuments', { source: 'prompt' })).result;
    assert.deepEqual(p.meta.tags, ['review', 'code']);
    assert.deepEqual(p.variables, ['project', 'file']);
    assert.deepEqual((await h.req('promptStats')).result, []);
  } finally { await h.stop(); }
});
```

In `dashboard/claude-hub-host.test.mjs`, add `'hq:claude-hub:prompt-stats'` to the sorted channel list of the `registerIpc maps every channel…` test, and append:

```js
test('P1: prompt-stats reaches the Hub op promptStats', async () => {
  const h = {}, calls = [];
  registerIpc({ handle: (ch, fn) => { h[ch] = fn; } }, { health: async () => ({}), request: async (op, args) => { calls.push([op, args]); return []; } });
  assert.deepEqual(await h['hq:claude-hub:prompt-stats']({}, 'junk'), []);
  assert.deepEqual(calls.at(-1), ['promptStats', {}]);
});
```

Run: `node --test dashboard/claude-hub/hub.test.mjs dashboard/claude-hub-host.test.mjs`
Expected: FAIL — `unknown op` for `promptStats`; no handler `hq:claude-hub:prompt-stats`; the channel-list test differs.

- [ ] **Step 6: Implement the op and the handler.** In `hub.mjs` `const ops`, beside `listDocuments`:

```js
    promptStats: () => { if (!store) throw new Error('the index is not open yet'); return store.promptStats(); },
```

In `claude-hub-host.js` `registerIpc`, after the H6 `document` handler:

```js
  h('prompt-stats', () => host.request('promptStats', {}));   // P1: usage per prompt id (prompt_use, written from P3)
```

- [ ] **Step 7: Run everything Hub-side.**

Run: `node --test dashboard/claude-hub/*.test.mjs` ; `node --test dashboard/claude-hub-host.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs dashboard/claude-hub-host.js dashboard/claude-hub-host.test.mjs
git commit -m "fe: P1.4 — Hub: prompt rows carry parsed meta + {{variables}}; read-only promptStats op (prompt_use, real counts) + IPC hq:claude-hub:prompt-stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Main — `claudePrompts.status` / `claudePrompts.open` (contained Open in Obsidian / Open file), preload, fake-preload parity, one main.js line

**Files:**
- Modify: `dashboard/claude-prompts.js` (append `obsidianUrl`, `findPromptFile`, `createPrompts`, `init`; extend `module.exports`)
- Modify: `dashboard/claude-prompts.test.mjs` (append)
- Modify: `dashboard/preload.js` (`claudeHub.promptStats`; new `claudePrompts` block after `claudeVault`)
- Modify: `dashboard/main.js` (+1 line, directly after the line containing `require('./claude-imports').init(`)
- Modify: `dashboard-v5/tools/fake-preload.js` (SPEC rows; prompt rows from the fake `claudeHub.documents`)

**Interfaces:**
- Consumes: Task 2 `PROMPTS_REL`, `promptDocId`; Task 3 `resolvePromptsDir`; Electron `shell.openExternal(url) -> Promise`, `shell.openPath(file) -> Promise<string>` ('' = ok), `app.getApplicationNameForProtocol(url) -> string` ('' = no handler); H6 fixture `makeDocsHome(dir)` (vault with `40_Resources/Prompts/review-a-pr.md`, plus `notes.txt` and `drafts/nested.md` that are NOT prompt notes).
- Produces:
  - `obsidianUrl(vaultName, fileName) -> 'obsidian://open?vault=<enc>&file=<enc 40_Resources/Prompts/<stem>>'`.
  - `findPromptFile(vaultDir, realDir, id) -> {name, file}|null` — top-level `*.md` regular files only; match = `promptDocId(path.join(path.resolve(vaultDir), ...PROMPTS_REL, name)) === id` (the Hub's id of that file); `file` = `path.join(realDir, name)`.
  - `createPrompts({vaultDir, openExternal, openPath, protocolName, env, log}) -> {status() -> Promise<{vault, rel, folder:{exists, error?}, obsidian}>, open(id, how) -> Promise<{ok:true, how}|{error}|{error, fallback:'file'}>}` — never throws.
  - `init({ipcMain, app, shell, vaultDir, env = process.env, log = console.log}) -> prompts` — `HQ_VAULT_DIR` wins over `vaultDir`; handlers `hq:claude-prompts:status`, `hq:claude-prompts:open (id, how)`.
  - preload `hq.claudeHub.promptStats()`, `hq.claudePrompts.status()`, `hq.claudePrompts.open(id, how)`.

- [ ] **Step 1: Amend the Task 1 row (additive) before the handler.** In `docs/sync/IPC-CONTRACT.md`, P1 section, row `claudePrompts.status()`: replace `folder:{exists:boolean}` with `folder:{exists:boolean, error?}` and append to that row's text ` — \`folder.error\` = why a folder that is there cannot be used (vault missing, or 40_Resources/Prompts leads outside the vault); the Library then shows that reason instead of "No prompts folder yet"`.

- [ ] **Step 2: Write the failing tests.** Append to `dashboard/claude-prompts.test.mjs`:

```js
import { makeDocsHome } from './claude-hub/__fixtures__/make-docs.mjs';

const { createPrompts, obsidianUrl, init } = prompts;
function rig(o = {}) {
  const fx = makeDocsHome(tmp());
  const ext = [], opened = [], logs = [];
  const p = createPrompts({ vaultDir: fx.vault, openExternal: async (u) => { ext.push(u); }, openPath: async (f) => { opened.push(f); return ''; },
    protocolName: () => (o.noObsidian ? '' : 'Obsidian'), env: o.env || {}, log: (l) => logs.push(l), ...o.over });
  const idOf = (...rel) => note.promptDocId(path.join(path.resolve(fx.vault), '40_Resources', 'Prompts', ...rel));
  return { fx, p, ext, opened, logs, idOf };
}

test('status says folder/obsidian and the vault basename; never a path', async () => {
  const { p } = rig();
  const s = await p.status();
  assert.deepEqual(s, { vault: 'vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true });
  const none = createPrompts({ vaultDir: tmp(), openExternal: async () => {}, openPath: async () => '', protocolName: () => '', env: {}, log: () => {} });
  assert.deepEqual((await none.status()).folder, { exists: false });
  assert.equal((await none.status()).obsidian, false);
});

test('open refuses everything but a contained prompt note; only the two allowed targets are opened', async () => {
  const { fx, p, ext, opened, idOf } = rig();
  const good = idOf('review-a-pr.md');
  assert.deepEqual(await p.open(good, 'obsidian'), { ok: true, how: 'obsidian' });
  assert.deepEqual(ext, ['obsidian://open?vault=vault&file=40_Resources%2FPrompts%2Freview-a-pr']);
  assert.deepEqual(await p.open(good, 'file'), { ok: true, how: 'file' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].toLowerCase(), path.join(fs.realpathSync.native(fx.prompts), 'review-a-pr.md').toLowerCase());   // .native: see Task 3 (8.3 TEMP names)
  const refused = [
    [idOf('drafts', 'nested.md'), 'obsidian'],          // a subfolder note is not a Library note
    [idOf('notes.txt'), 'file'],                          // not a .md note
    ['memory:' + 'a'.repeat(40), 'file'],                 // another document kind
    ['prompt:' + 'f'.repeat(40), 'obsidian'],             // no such note
    ['prompt:../../x', 'file'], ['C:\\Windows\\notepad.exe', 'file'], ['https://example.invalid/', 'obsidian'], [null, 'file'], [{}, 'file'],
    [good, 'url'], [good, undefined],                    // only 'obsidian' | 'file'
  ];
  for (const [id, how] of refused) assert.ok((await p.open(id, how)).error, JSON.stringify([id, how]));
  fs.unlinkSync(path.join(fx.prompts, 'review-a-pr.md'));   // deleted in Obsidian since the last sweep
  assert.match((await p.open(good, 'obsidian')).error, /not in the Prompts folder/);
  assert.equal(ext.length, 1, 'nothing else was ever opened externally');
  assert.equal(opened.length, 1, 'nothing else was ever opened as a file');
});

test('the obsidian link encodes the vault basename (HQ_VAULT_DIR override) and the note name', () => {
  assert.equal(obsidianUrl('My Vault #1', 'a & b.md'), 'obsidian://open?vault=My%20Vault%20%231&file=40_Resources%2FPrompts%2Fa%20%26%20b');
  assert.throws(() => obsidianUrl('v', '../x.md'));
  assert.throws(() => obsidianUrl('v', 'a/b.md'));
});

test('no obsidian handler → status says so and open(how:obsidian) is refused with fallback file', async () => {
  const { p, ext, idOf } = rig({ noObsidian: true });
  assert.equal((await p.status()).obsidian, false);
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'obsidian'), { error: 'Obsidian is not installed — use Open file', fallback: 'file' });
  assert.deepEqual(ext, []);
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'file'), { ok: true, how: 'file' });
});

test('HQ_DRY_LAUNCH=1 opens nothing and logs only the file name', async () => {
  const { p, ext, opened, logs, idOf } = rig({ env: { HQ_DRY_LAUNCH: '1' } });
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'obsidian'), { ok: true, how: 'obsidian', dry: true });
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'file'), { ok: true, how: 'file', dry: true });
  assert.deepEqual([ext, opened], [[], []]);
  assert.deepEqual(logs, ['[dry-open] obsidian review-a-pr.md', '[dry-open] file review-a-pr.md']);
});

test('a Prompts junction out of the vault: status explains, open refuses', { skip: !WIN && 'junctions are Windows-only' }, async () => {
  const vault = tmp(), outside = tmp();
  fs.mkdirSync(path.join(vault, '40_Resources'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'x.md'), '---\ntitle: x\n---\n');
  fs.symlinkSync(outside, path.join(vault, '40_Resources', 'Prompts'), 'junction');
  const ext = [];
  const p = createPrompts({ vaultDir: vault, openExternal: async (u) => { ext.push(u); }, openPath: async () => '', protocolName: () => 'Obsidian', env: {}, log: () => {} });
  const s = await p.status();
  assert.equal(s.folder.exists, false); assert.match(s.folder.error, /outside the vault/);
  const id = note.promptDocId(path.join(path.resolve(vault), '40_Resources', 'Prompts', 'x.md'));
  assert.match((await p.open(id, 'obsidian')).error, /outside the vault/);
  assert.deepEqual(ext, []);
});

test('init: HQ_VAULT_DIR wins; handlers answer, ids are capped', async () => {
  const fx = makeDocsHome(tmp());
  const h = {};
  init({ ipcMain: { handle: (ch, fn) => { h[ch] = fn; } }, app: { getApplicationNameForProtocol: () => '' }, shell: { openExternal: async () => {}, openPath: async () => '' },
    vaultDir: path.join(os.tmpdir(), 'never-the-owner-vault'), env: { HQ_VAULT_DIR: fx.vault, HQ_DRY_LAUNCH: '1' }, log: () => {} });
  assert.deepEqual(Object.keys(h).sort(), ['hq:claude-prompts:open', 'hq:claude-prompts:status']);
  assert.equal((await h['hq:claude-prompts:status']({})).folder.exists, true);
  assert.ok((await h['hq:claude-prompts:open']({}, 'prompt:' + 'a'.repeat(400), 'file')).error);
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `node --test dashboard/claude-prompts.test.mjs`
Expected: FAIL — `createPrompts is not a function` (Task 3's tests still pass).

- [ ] **Step 4: Implement.** Append to `dashboard/claude-prompts.js` (before `module.exports`), add `const { promptDocId } = require('./claude-prompt-note');` to the requires (merge with the existing destructure), and extend the exports to `{ NOTE_TEXT_MAX, resolvePromptsDir, writePromptNote, obsidianUrl, findPromptFile, createPrompts, init }`:

```js
// spec §2: the only obsidian:// link ever opened — vault = basename of the configured vault root, file = a note directly
// inside 40_Resources/Prompts that findPromptFile just found on disk. Never a URL or path from the renderer, index or note text.
function obsidianUrl(vaultName, fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || /[\\/]/.test(fileName) || !/\.md$/i.test(fileName)) throw new Error('not a prompt note name');
  return 'obsidian://open?vault=' + encodeURIComponent(String(vaultName)) + '&file=' + encodeURIComponent([...PROMPTS_REL, fileName.replace(/\.md$/i, '')].join('/'));
}

function findPromptFile(vaultDir, realDir, id) {
  if (typeof id !== 'string' || !/^prompt:[0-9a-f]{40}$/.test(id)) return null;
  let names = [];
  try { names = fs.readdirSync(realDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name); } catch { return null; }
  const base = path.join(path.resolve(vaultDir), ...PROMPTS_REL);   // the Hub ids the file by this path (H6 docId)
  for (const name of names) if (promptDocId(path.join(base, name)) === id) return { name, file: path.join(realDir, name) };
  return null;
}

function createPrompts({ vaultDir, openExternal, openPath, protocolName, env = {}, log = () => {} }) {
  const vaultName = vaultDir ? path.basename(path.resolve(vaultDir)) : null;
  const dry = () => env.HQ_DRY_LAUNCH === '1';
  const hasObsidian = () => { try { return !!protocolName('obsidian://'); } catch { return false; } };
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  return {
    async status() {
      const folder = { exists: false };
      try { folder.exists = !!(await resolvePromptsDir(vaultDir)); } catch (e) { folder.error = why(e); }
      return { vault: vaultName, rel: PROMPTS_REL.join('/'), folder, obsidian: hasObsidian() };
    },
    async open(id, how) {
      try {
        if (how !== 'obsidian' && how !== 'file') return { error: 'a prompt note opens only in Obsidian or as a file' };
        const realDir = await resolvePromptsDir(vaultDir);
        if (!realDir) return { error: `No prompts folder yet — create ${vaultName}/${PROMPTS_REL.join('/')}` };
        const hit = findPromptFile(vaultDir, realDir, id);
        if (!hit) return { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' };
        const real = await fsp.realpath(hit.file);
        if (!same(path.dirname(real), realDir)) return { error: 'that note leads outside the Prompts folder — refusing' };
        if (how === 'obsidian') {
          if (!hasObsidian()) return { error: 'Obsidian is not installed — use Open file', fallback: 'file' };
          const url = obsidianUrl(vaultName, hit.name);
          if (dry()) { log('[dry-open] obsidian ' + hit.name); return { ok: true, how, dry: true }; }
          await openExternal(url);
          return { ok: true, how };
        }
        if (dry()) { log('[dry-open] file ' + hit.name); return { ok: true, how, dry: true }; }
        const err = await openPath(real);
        return err ? { error: 'Windows could not open the note: ' + String(err).slice(0, 200) } : { ok: true, how };
      } catch (e) { return { error: why(e) }; }
    },
  };
}

function init({ ipcMain, app, shell, vaultDir, env = process.env, log = console.log }) {
  const p = createPrompts({ vaultDir: env.HQ_VAULT_DIR || vaultDir, env, log,
    openExternal: (u) => shell.openExternal(u), openPath: (f) => shell.openPath(f),
    protocolName: (u) => (app && app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : '') });
  ipcMain.handle('hq:claude-prompts:status', () => p.status());
  ipcMain.handle('hq:claude-prompts:open', (_e, id, how) => p.open(typeof id === 'string' && id.length <= 300 ? id : '', how));
  return p;
}
```

- [ ] **Step 5: Preload, main.js, fake.** In `dashboard/preload.js`, inside `claudeHub: {…}` after the H6 `document` line add `    promptStats: () => ipcRenderer.invoke('hq:claude-hub:prompt-stats'),` and after the `claudeVault` block add:

```js
  // Prompt library P1: status (folder there? Obsidian installed?) + open a prompt note (main finds the file itself)
  claudePrompts: {
    status: () => ipcRenderer.invoke('hq:claude-prompts:status'),
    open: (id, how) => ipcRenderer.invoke('hq:claude-prompts:open', id, how),
  },
```

In `dashboard/main.js`, find `grep -n "claude-imports').init" dashboard/main.js` and insert directly below that line (same indentation):

```js
    require('./claude-prompts').init({ ipcMain, app, shell, vaultDir: VAULT });   // Prompt library P1 (spec 2026-10-15 §6.4): status + contained Open in Obsidian / Open file
```

`shell` and `app` are already destructured from `require('electron')` at main.js:10; `VAULT` is the existing constant. No other main.js line changes.

In `dashboard-v5/tools/fake-preload.js`, add near the H6 `claudeHub.documents` row a constant and SPEC rows:

```js
const FAKE_PROMPTS = [
  { id: 'prompt:' + 'a'.repeat(40), source: 'prompt', path: 'C:\\fake-vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Review a PR like a staff engineer', project_id: null, project_path: null,
    mtime_ms: Date.parse('2026-10-15T10:00:00Z'), size: 220, origin: null, meta: { title: 'Review a PR like a staff engineer', tags: ['review', 'code'], variables: ['project', 'file'] }, variables: ['project', 'file'] },
  { id: 'prompt:' + 'b'.repeat(40), source: 'prompt', path: 'C:\\fake-vault\\40_Resources\\Prompts\\weekly-notes.md', title: 'Weekly notes digest', project_id: null, project_path: null,
    mtime_ms: Date.parse('2026-10-10T08:00:00Z'), size: 140, origin: null, meta: { title: 'Weekly notes digest', tags: ['notes'] }, variables: [] },
];
```

```js
    ['claudeHub.promptStats', () => [{ prompt_id: 'prompt:' + 'a'.repeat(40), uses: 3, last_at: '2026-10-20T09:00:00.000Z' }]],
    ['claudePrompts.status', () => ({ vault: 'fake-vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true })],
    ['claudePrompts.open', (id, how) => (how === 'obsidian' || how === 'file' ? { ok: true, how } : { error: 'a prompt note opens only in Obsidian or as a file' })],
```

and make the H6 `claudeHub.documents` canned answer return `FAKE_PROMPTS` (filtered by `q` on title, case-insensitive, when `q` is given) when `opts && opts.source === 'prompt'`, its existing rows otherwise. The fake's "3 uses" are a fixture for the harness only — the real Hub answers `[]` until P3.

- [ ] **Step 6: Run to see everything pass.**

Run: `node --test dashboard/claude-prompts.test.mjs dashboard/claude-prompt-note.test.mjs` ; `node --test dashboard/*.test.mjs` ; `node --test dashboard-v5/tools/*.test.mjs`
Expected: PASS — incl. `fake-preload.test.mjs` (the fake's method set equals the real preload's: `claudeHub.promptStats`, `claudePrompts.status`, `claudePrompts.open` on both sides).

- [ ] **Step 7: Commit**

```bash
git add dashboard/claude-prompts.js dashboard/claude-prompts.test.mjs dashboard/preload.js dashboard/main.js dashboard-v5/tools/fake-preload.js docs/sync/IPC-CONTRACT.md
git commit -m "fe: P1.5 — claudePrompts.status/open: main finds the note by its Hub id in 40_Resources/Prompts (junction-safe); only obsidian://open?vault=<basename>&file=<contained> or that file is opened; Obsidian-absent fallback; HQ_DRY_LAUNCH; preload + fake parity; main.js +1 line after the claude-imports init

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: v5 data layer — adapter `promptRow` / `promptsView`, store slot `live.prompts` (+ `changed.documents` routing)

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (append exports)
- Modify: `dashboard-v5/src/live/adapter.test.mjs` (append; add the names to its import)
- Modify: `dashboard-v5/src/live/store.js` (slot, three functions, routing, return object)
- Modify: `dashboard-v5/src/live/store.test.mjs` (append)

No template or vals change in this task: the golden hashes and `tpl.hash.test.mjs` stay green here (Step 7 checks).

**Interfaces:**
- Consumes: preload `claudeHub.documents({source:'prompt', q?, limit})` (rows of Task 4: `meta`, `variables`), `claudeHub.promptStats()`, `claudePrompts.status()`, `claudePrompts.open(id, how)`; adapter private helpers `obj`, `arr`, `num`, `whenOf` (adapter.mjs:12-14, :482); store `emit`, `sub`, the H6 `changed.documents` field.
- Produces:
  - adapter `promptRow(row, statsById, now) -> {id, title, name, tags, tagText, hasTags, vars, varText, hasVars, uses, usesText, lastUsed, usesProject}`.
  - adapter `promptsView(P, {hasBridge, q, forProject, now}) -> {state, text, rows, count, statsNote}` — `state` ∈ `'nobridge'|'loading'|'error'|'folder-error'|'nofolder'|'empty'|'nohits'|'list'`.
  - store `live.prompts = {rows:null, stats:null, status:null, q:'', hits:null, error:null, statsErr:null, busy:false}`; methods `refreshPrompts() -> Promise`, `searchPrompts(q) -> Promise`, `openPrompt(id, how) -> Promise<{ok,how}|{error}|{error,fallback}>`.

- [ ] **Step 1: Write the failing adapter tests.** Append to `dashboard-v5/src/live/adapter.test.mjs`:

```js
const PR_A = { id: 'prompt:a', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Review a PR', mtime_ms: 1,
  meta: { tags: ['review', 'code'], variables: ['project', 'file'] }, variables: ['project', 'file'] };
const PR_B = { id: 'prompt:b', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\weekly.md', title: 'Weekly digest', mtime_ms: 2, meta: { tags: 'notes, weekly' }, variables: [] };
const NOW = Date.parse('2026-10-25T12:00:00Z');

test('P1: promptRow shows real usage, tags, variables and the file name only', () => {
  const a = promptRow(PR_A, { 'prompt:a': { uses: 3, last_at: '2026-10-24T12:00:00Z' } }, NOW);
  assert.equal(a.title, 'Review a PR'); assert.equal(a.name, 'review-a-pr.md');
  assert.deepEqual(a.tags, ['review', 'code']); assert.equal(a.tagText, '#review #code'); assert.equal(a.hasTags, true);
  assert.deepEqual(a.vars, ['project', 'file']); assert.equal(a.varText, '{{project}} {{file}}'); assert.equal(a.hasVars, true);
  assert.equal(a.uses, 3); assert.equal(a.usesText, 'used 3×'); assert.match(a.lastUsed, /^last used /);
  assert.equal(a.usesProject, true);
  const b = promptRow(PR_B, {}, NOW);
  assert.deepEqual(b.tags, ['notes', 'weekly']);
  assert.equal(b.uses, 0); assert.equal(b.usesText, 'not run yet'); assert.equal(b.lastUsed, '');
  assert.equal(b.hasVars, false); assert.equal(b.usesProject, false);
  const junk = promptRow({ id: 'prompt:c', meta: 'not an object', variables: 'x' }, null, NOW);
  assert.equal(junk.title, 'Untitled prompt'); assert.deepEqual(junk.tags, []); assert.equal(junk.hasTags, false); assert.deepEqual(junk.vars, []);
});

test('P1: promptsView: the empty states are distinct and a Hub error is never an empty list', () => {
  const base = { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false };
  const st = (P, o = {}) => promptsView({ ...base, ...P }, { hasBridge: true, now: NOW, ...o });
  const folder = (exists, error) => ({ vault: 'VEEMO CORTEX', rel: '40_Resources/Prompts', folder: error ? { exists, error } : { exists }, obsidian: true });
  const cases = [
    [st({}, { hasBridge: false }), 'nobridge'],
    [st({}), 'loading'],
    [st({ error: 'Claude Hub: hub not running', rows: [PR_A] }), 'error'],
    [st({ rows: [], status: folder(false, '40_Resources/Prompts leads outside the vault — refusing') }), 'folder-error'],
    [st({ rows: [], status: folder(false) }), 'nofolder'],
    [st({ rows: [], status: folder(true) }), 'empty'],
    [st({ rows: [PR_A], q: 'zzz', hits: [], status: folder(true) }), 'nohits'],
    [st({ rows: [PR_A, PR_B], status: folder(true) }), 'list'],
  ];
  const texts = new Set();
  for (const [v, want] of cases) { assert.equal(v.state, want); if (want !== 'list') { assert.ok(v.text, want); texts.add(v.text); } }
  assert.equal(texts.size, cases.length - 1, 'every state says something different');
  assert.deepEqual(cases[2][0].rows, [], 'an error shows the error, not the stale rows as if fine');
  assert.match(cases[4][0].text, /^No prompts folder yet — create VEEMO CORTEX\/40_Resources\/Prompts/);
  assert.doesNotMatch(cases[4][0].text, /promote/i, 'Promote lands in P2');
  assert.match(cases[3][0].text, /outside the vault/);
});

test('P1: promptsView search = Hub FTS hits ∪ title/tag matches; project context sorts {{project}} prompts first', () => {
  const P = { rows: [PR_B, PR_A], stats: [], status: { vault: 'v', folder: { exists: true }, obsidian: true }, q: 'weekly', hits: [], error: null, statsErr: null };
  assert.deepEqual(promptsView(P, { hasBridge: true, now: NOW }).rows.map((r) => r.id), ['prompt:b'], 'tag match without an FTS hit');
  const viaFts = promptsView({ ...P, q: 'staff', hits: [{ id: 'prompt:a' }] }, { hasBridge: true, now: NOW });
  assert.deepEqual(viaFts.rows.map((r) => r.id), ['prompt:a']);
  const all = promptsView({ ...P, q: '' }, { hasBridge: true, now: NOW, forProject: 'project-a' });
  assert.deepEqual(all.rows.map((r) => r.id), ['prompt:a', 'prompt:b']);
  assert.equal(all.count, 2);
  assert.equal(all.statsNote, 'Usage is counted from the Run step on — nothing has run yet.');
  assert.equal(promptsView({ ...P, q: '', stats: null, statsErr: 'Claude Hub: timeout' }, { hasBridge: true, now: NOW }).statsNote, 'Usage unknown — Claude Hub: timeout');
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs`
Expected: FAIL — `promptRow` / `promptsView` are not exported.

- [ ] **Step 3: Implement in `adapter.mjs`** (append; `obj`, `arr`, `num`, `whenOf` are the file's existing helpers):

```js
// Prompt library P1 (spec 2026-10-15 §6.3): Library rows from the Hub's prompt documents + prompt_use stats.
// Counts are the Hub's; nothing here estimates. Text is bound as text by the template runtime, never HTML.
const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
const baseName = (p) => String(p || '').split(/[\\/]/).pop();
export function promptRow(row, statsById, now = Date.now()) {
  const r = obj(row), meta = obj(r.meta), s = obj(obj(statsById)[r.id]);
  const tags = strList(meta.tags).map((t) => t.replace(/^#/, '')).slice(0, 12);
  const vars = arr(r.variables).filter((v) => typeof v === 'string');
  const uses = num(s.uses, 0);
  return { id: String(r.id || ''), title: r.title ? String(r.title) : 'Untitled prompt', name: baseName(r.path),
    tags, tagText: tags.map((t) => '#' + t).join(' '), hasTags: tags.length > 0, vars, varText: vars.map((v) => '{{' + v + '}}').join(' '), hasVars: vars.length > 0,
    uses, usesText: uses > 0 ? `used ${uses}×` : 'not run yet', lastUsed: uses > 0 && s.last_at ? 'last used ' + whenOf(s.last_at, now) : '',
    usesProject: vars.includes('project') || vars.includes('cwd') };
}
export function promptsView(P, { hasBridge = true, q = null, forProject = null, now = Date.now() } = {}) {
  const p = obj(P), st = obj(p.status), folder = obj(st.folder), vault = st.vault || 'your vault';
  const where = `${vault}/40_Resources/Prompts`;
  const out = (state, text, rows = []) => ({ state, text, rows, count: rows.length, statsNote: '' });
  if (!hasBridge) return out('nobridge', 'The prompt library needs the WorkspaceHQ app — this preview has no bridge to the Claude Hub.');
  if (p.error) return out('error', `${p.error} — your prompt notes cannot be listed until the Claude Hub answers.`);
  if (!Array.isArray(p.rows)) return out('loading', 'Reading your prompt notes…');
  const statsById = Object.fromEntries(arr(p.stats).map((s) => [s.prompt_id, s]));
  if (p.rows.length === 0) {
    if (folder.error) return out('folder-error', `${where}: ${folder.error}`);
    if (p.status && folder.exists === false) return out('nofolder', `No prompts folder yet — create ${where} and add notes there; edits you make in Obsidian show up here.`);
    return out('empty', `${where} has no prompt notes yet — add a .md note there in Obsidian (top level of the folder).`);
  }
  const term = String(q == null ? p.q || '' : q).trim().toLowerCase();
  let rows = p.rows.map((r) => promptRow(r, statsById, now));
  if (term) {
    const hit = new Set(arr(p.hits).map((h) => h && h.id));
    rows = rows.filter((r) => hit.has(r.id) || r.title.toLowerCase().includes(term) || r.tags.some((t) => t.toLowerCase().includes(term)));
    if (!rows.length) return out('nohits', `No prompt note matches “${String(q == null ? p.q : q).trim()}”.`);
  }
  if (forProject) rows = rows.slice().sort((a, b) => Number(b.usesProject) - Number(a.usesProject));
  const v = out('list', '', rows);
  v.statsNote = p.statsErr ? 'Usage unknown — ' + p.statsErr : arr(p.stats).length === 0 ? 'Usage is counted from the Run step on — nothing has run yet.' : '';
  return v;
}
```

- [ ] **Step 4: Write the failing store test.** Append to `dashboard-v5/src/live/store.test.mjs`:

```js
test('P1 prompts: loads notes + stats + status, searches, re-reads on a prompt change, errors say why', async () => {
  let fail = false;
  const seen = [];   // libHq records only its own methods; these overrides record here
  const { hq, fire } = libHq({
    documents: (o) => (seen.push(['documents', [o]]), Promise.resolve(fail ? { error: 'timeout' } : o && o.q ? [{ id: 'prompt:a' }] : [{ id: 'prompt:a', source: 'prompt', title: 'A', variables: [] }])),
    promptStats: () => Promise.resolve([]),
  });
  hq.claudePrompts = { status: () => Promise.resolve({ vault: 'v', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: false }),
    open: (id, how) => Promise.resolve({ ok: true, how }) };
  const st = createStore(DATA(), hq); await st.start();
  assert.equal(st.live.prompts.rows, null, 'nothing fetched until the Library asks');
  await st.refreshPrompts();
  assert.equal(st.live.prompts.rows.length, 1);
  assert.deepEqual(st.live.prompts.stats, []);
  assert.equal(st.live.prompts.status.obsidian, false);
  assert.ok(seen.some(([n, a]) => n === 'documents' && a[0].source === 'prompt' && a[0].limit === 200));
  await st.searchPrompts('staff');
  assert.deepEqual(st.live.prompts.hits, [{ id: 'prompt:a' }]);
  const before = seen.length;
  fire({ event: 'changed', data: { ids: [], documents: ['memory:x'] } }); await settle(); await settle();
  assert.ok(!seen.slice(before).some(([n]) => n === 'documents'), 'a memory note change does not re-read the Library');
  fire({ event: 'changed', data: { ids: [], documents: ['prompt:a'] } }); await settle(); await settle();
  assert.ok(seen.slice(before).some(([n]) => n === 'documents'), 'a prompt note edited in Obsidian re-reads the Library');
  fail = true; await st.refreshPrompts();
  assert.equal(st.live.prompts.error, 'Claude Hub: timeout');
  assert.deepEqual(await st.openPrompt('prompt:a', 'file'), { ok: true, how: 'file' });
  st.stop();
});

test('P1 prompts: no bridge → refreshPrompts is a no-op, openPrompt says why', async () => {
  const st = createStore(DATA(), null);
  await st.refreshPrompts();
  assert.equal(st.live.prompts.rows, null);
  assert.match((await st.openPrompt('prompt:a', 'file')).error, /WorkspaceHQ app/);
});
```

Run: `node --test dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `st.refreshPrompts is not a function`.

- [ ] **Step 5: Implement in `store.js`.** In `live` (after the H6 `claudeImports` slot) add:

```js
    prompts: { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false },   // Prompt library P1: Library (vault prompt notes via the Hub)
```

Add beside `refreshClaudeStats`:

```js
  // Prompt library P1 — the Library reads the Hub's prompt documents, their prompt_use stats and main's folder/Obsidian status
  let promptSeq = 0, promptSearchSeq = 0;
  const askHq = (f) => Promise.resolve().then(f).catch((e) => ({ error: String((e && e.message) || e).slice(0, 300) }));
  function refreshPrompts() {
    const P = live.prompts;
    if (!hq || !hq.claudeHub || !hq.claudeHub.documents) return Promise.resolve();
    const my = ++promptSeq;
    P.busy = true; emit();
    return Promise.all([
      askHq(() => hq.claudeHub.documents({ source: 'prompt', limit: 200 })),
      hq.claudeHub.promptStats ? askHq(() => hq.claudeHub.promptStats()) : Promise.resolve(null),
      hq.claudePrompts && hq.claudePrompts.status ? askHq(() => hq.claudePrompts.status()) : Promise.resolve(null),
    ]).then(([rows, stats, status]) => {
      if (my !== promptSeq) return undefined;
      P.busy = false;
      if (isObj(rows) && rows.error) P.error = 'Claude Hub: ' + rows.error; else { P.error = null; P.rows = Array.isArray(rows) ? rows : []; }
      if (isObj(stats) && stats.error) P.statsErr = 'Claude Hub: ' + stats.error; else { P.statsErr = null; P.stats = Array.isArray(stats) ? stats : null; }
      if (isObj(status) && !status.error) P.status = status;
      if (P.q) return searchPrompts(P.q);
      emit(); return undefined;
    });
  }
  function searchPrompts(q) {
    const P = live.prompts;
    P.q = String(q || '').trim().slice(0, 200);
    if (!P.q || !hq || !hq.claudeHub || !hq.claudeHub.documents) { P.hits = null; emit(); return Promise.resolve(); }
    const my = ++promptSearchSeq;
    return askHq(() => hq.claudeHub.documents({ source: 'prompt', q: P.q, limit: 200 })).then((r) => {
      if (my !== promptSearchSeq) return;
      if (isObj(r) && r.error) P.error = 'Claude Hub: ' + r.error; else P.hits = Array.isArray(r) ? r : [];
      emit();
    });
  }
  function openPrompt(id, how) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.open) return Promise.resolve({ error: 'Opening a prompt note needs the WorkspaceHQ app' });
    return askHq(() => hq.claudePrompts.open(id, how)).then((r) => (isObj(r) ? r : { error: 'no answer' }));
  }
```

In the `changed` branch of the Hub subscription add:

```js
        if (live.prompts.rows && Array.isArray(e.data && e.data.documents) && e.data.documents.some((d) => String(d).startsWith('prompt:'))) refreshPrompts();
```

and in the `ready` branch's callback (the `e.event === 'ready'` line, store.js:220 at HEAD: `pull(() => hq.claudeHub.health(), (h) => { …; retryLibLoad(); })`), after that `retryLibLoad();`, add `if (live.prompts.error) refreshPrompts();`. Add `refreshPrompts, searchPrompts, openPrompt` to the returned object.

- [ ] **Step 6: Run to see them pass.**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: PASS.

- [ ] **Step 7: Nothing visible changed yet.**

Run: `node --test dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/honesty.test.mjs`
Expected: PASS unchanged (no vals or markup yet).

- [ ] **Step 8: Commit**

```bash
git add dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs
git commit -m "fe: P1.6 — v5 prompt Library data: promptRow/promptsView (real usage, distinct empty states, FTS ∪ tag search, project context sort) and live.prompts with refresh/search/open + changed.documents routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: v5 actions — `promptsLogic` mixin (load, search, Open in Obsidian / Open file with fallback, Run placeholder, project shortcut) + app.js wiring

**Files:**
- Create: `dashboard-v5/src/logic/prompts.js`
- Create: `dashboard-v5/src/logic/prompts.test.mjs`
- Modify: `dashboard-v5/src/app.js` (import; `Object.assign` list; `initState` keys; the two "load Claude on arrival" lines :117 and :156)

**Interfaces:**
- Consumes: Task 6 store `refreshPrompts()`, `searchPrompts(q)`, `openPrompt(id, how)`; Component helpers `toast(kind, text)`, `go(tab, sub)`, `setState(patch)`, `state`; catalog sub id `'prompts'` (Task 8 adds it to `SUBS`; `go('claude','prompts')` already sets `state.sub.claude`).
- Produces: `promptsLogic = { prLoad, onPrQuery, prSearch, prClear, prOpen(id, how), prRun(id), prForProject(project), prClearProject }`; exported `RUN_LATER` (the Run placeholder text); state keys `prQuery: ''`, `prSearched: false`, `prFor: null` (an HQ project id) — none persisted (no storage key).

- [ ] **Step 1: Write the failing test** `dashboard-v5/src/logic/prompts.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsLogic, RUN_LATER } from './prompts.js';

function rig(answers = {}) {
  const toasts = [], calls = [], went = [];
  const self = {
    ...promptsLogic,
    state: { prQuery: 'staff', prSearched: false, prFor: null },
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    toast: (kind, text) => toasts.push([kind, text]),
    go: (tab, sub) => went.push([tab, sub]),
    store: {
      refreshPrompts: () => { calls.push(['refresh']); return Promise.resolve(); },
      searchPrompts: (q) => { calls.push(['search', q]); return Promise.resolve(); },
      openPrompt: (id, how) => { calls.push(['open', id, how]); const a = answers[how]; return Promise.resolve(typeof a === 'function' ? a() : a || { ok: true, how }); },
    },
  };
  return { self, toasts, calls, went };
}

test('prSearch / prClear drive the store search', async () => {
  const r = rig();
  await r.self.prSearch();
  assert.deepEqual(r.calls.at(-1), ['search', 'staff']); assert.equal(r.self.state.prSearched, true);
  await r.self.prClear();
  assert.deepEqual(r.calls.at(-1), ['search', '']); assert.deepEqual([r.self.state.prQuery, r.self.state.prSearched], ['', false]);
  r.self.onPrQuery({ target: { value: 'x' } }); assert.equal(r.self.state.prQuery, 'x');
});

test('prOpen: Obsidian → toast; Obsidian missing → falls back to Open file once; errors say why', async () => {
  const ok = rig(); await ok.self.prOpen('prompt:a', 'obsidian');
  assert.deepEqual(ok.calls, [['open', 'prompt:a', 'obsidian']]);
  assert.deepEqual(ok.toasts, [['info', 'Opened in Obsidian']]);
  const fb = rig({ obsidian: { error: 'Obsidian is not installed — use Open file', fallback: 'file' } });
  await fb.self.prOpen('prompt:a', 'obsidian');
  assert.deepEqual(fb.calls.map((c) => c[2]), ['obsidian', 'file']);
  assert.deepEqual(fb.toasts, [['info', 'Obsidian is not installed — opened the note file instead']]);
  const loop = rig({ obsidian: { error: 'x', fallback: 'file' }, file: { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' } });
  await loop.self.prOpen('prompt:a', 'obsidian');
  assert.equal(loop.calls.length, 2, 'never more than one fallback');
  assert.deepEqual(loop.toasts.at(-1), ['error', 'Open failed · that prompt note is not in the Prompts folder (moved, renamed or deleted?)']);
});

test('prRun is a labelled placeholder until the run step; it opens and sends nothing', () => {
  const r = rig(); r.self.prRun('prompt:a');
  assert.deepEqual(r.toasts, [['info', RUN_LATER]]);
  assert.match(RUN_LATER, /uses your Claude quota/);
  assert.deepEqual(r.calls, []);
});

test('prForProject: the Library opens with the project as run context; ✕ clears it', async () => {
  const r = rig();
  await r.self.prForProject({ id: 'project-a', name: 'Project A' });
  assert.deepEqual(r.went, [['claude', 'prompts']]);
  assert.equal(r.self.state.prFor, 'project-a');
  assert.deepEqual([r.self.state.prQuery, r.self.state.prSearched], ['', false]);
  assert.ok(r.calls.some((c) => c[0] === 'refresh'));
  r.self.prClearProject(); assert.equal(r.self.state.prFor, null);
  await r.self.prForProject(null); assert.equal(r.self.state.prFor, null);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --test dashboard-v5/src/logic/prompts.test.mjs`
Expected: FAIL — `Cannot find module …/logic/prompts.js`.

- [ ] **Step 3: Implement** `dashboard-v5/src/logic/prompts.js`:

```js
// Prompt library P1 (spec 2026-10-15 §6.3) — Claude › Prompts › Library actions. Main opens notes (contained, §2);
// the renderer only ever sends a document id and 'obsidian' | 'file'. Run is wired by the run step (P3).
export const RUN_LATER = 'Run arrives with the run step (fill the variables, then Chat, Terminal or copy for claude.ai / ChatGPT) — it uses your Claude quota. For now, open the note and copy the prompt.';

export const promptsLogic = {
  prLoad() { return this.store.refreshPrompts && this.store.refreshPrompts(); },
  onPrQuery(e) { this.setState({ prQuery: e && e.target ? e.target.value : '' }); },
  prSearch() { this.setState({ prSearched: true }); return this.store.searchPrompts && this.store.searchPrompts(this.state.prQuery); },
  prClear() { this.setState({ prQuery: '', prSearched: false }); return this.store.searchPrompts && this.store.searchPrompts(''); },
  async prOpen(id, how, fellBack = false) {
    const r = this.store.openPrompt ? await this.store.openPrompt(id, how) : { error: 'Opening a prompt note needs the WorkspaceHQ app' };
    if (r && r.ok) { this.toast('info', fellBack ? 'Obsidian is not installed — opened the note file instead' : how === 'obsidian' ? 'Opened in Obsidian' : 'Opened the note file'); return r; }
    if (r && r.fallback === 'file' && !fellBack) return this.prOpen(id, 'file', true);
    this.toast('error', 'Open failed · ' + ((r && r.error) || 'no answer'));
    return r;
  },
  prRun() { this.toast('info', RUN_LATER); },
  prForProject(project) {
    this.setState({ prFor: project && project.id ? String(project.id) : null, prQuery: '', prSearched: false });
    if (this.store.searchPrompts) this.store.searchPrompts('');
    this.go('claude', 'prompts');
    return this.prLoad();
  },
  prClearProject() { this.setState({ prFor: null }); },
};
```

- [ ] **Step 4: Wire it in `app.js`.** Add `import { promptsLogic } from './logic/prompts.js';` beside the other logic imports; append `promptsLogic` to the `Object.assign(Component.prototype, …)` list (after `claudeVaultLogic`); in `initState()` add `prQuery: '', prSearched: false, prFor: null,` on the line that holds `clQuery: '', clSearched: false` (app.js:88); in the cold-start line (app.js:117) and the route-change line (app.js:156) add, after the existing Chats/Projects condition, a sibling statement:

```js
    if (S.tab === 'claude' && !S.route && S.sub.claude === 'prompts') this.prLoad();   // P1: the Library loads on arrival
```

(at :117 the line is a block `{ const S = this.state; if (…) this.clLoad(); }` — put the new `if` INSIDE those braces, right before the closing `}`, because `S` is block-scoped there; for :156 the condition starts with `moved && `, like its neighbours).

- [ ] **Step 5: Run to see them pass.**

Run: `node --test dashboard-v5/src/logic/*.test.mjs` ; `node --test dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/selftest-keys.test.mjs`
Expected: PASS. If a golden scenario hashes `state` and changes only because of the three new keys, attribute it now (Task 8 Step 0 + Step 5 procedure, `--allow '^(prQuery|prSearched|prFor)$'`) and fold the re-record into Task 8's commit instead — do not re-record in this task.

- [ ] **Step 6: Commit**

```bash
git add dashboard-v5/src/logic/prompts.js dashboard-v5/src/logic/prompts.test.mjs dashboard-v5/src/app.js
git commit -m "fe: P1.7 — promptsLogic: Library load/search, Open in Obsidian with one Open-file fallback, labelled Run placeholder (quota), project-page shortcut sets the run context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: v5 surfaces — Prompts sub-tab, `vals/prompts.js`, Library block in `claude.tpl.js`, project-page "Run a prompt"; tpl hash + attributed goldens

**Files:**
- Modify: `dashboard-v5/src/live/catalog.mjs` (`SUBS.claude`)
- Create: `dashboard-v5/src/vals/prompts.js`
- Modify: `dashboard-v5/src/vals/index.js` (import + append `promptsVals` to `SURFACES`)
- Modify: `dashboard-v5/src/tpl/claude.tpl.js` (new block directly before `<sc-if value="{{ isClProjects }}"`)
- Modify: `dashboard-v5/src/tpl/project-page.tpl.js` (one button in the Claude section's title row, after the New chat button)
- Modify: `dashboard-v5/src/tpl.hash.test.mjs` (three constants + one dated comment line)
- Modify: `dashboard-v5/src/vals.golden.test.mjs`, `dashboard-v5/src/__golden__/vals.hashes.json`

**Interfaces:**
- Consumes: Task 6 `promptsView`; Task 7 `prOpen`, `prRun`, `prSearch`, `prClear`, `onPrQuery`, `prForProject`, `prClearProject`, state `prQuery`, `prSearched`, `prFor`; ctx `S`, `LIVE`, `sub`, `projects`, `onPage` (vals/ctx.js).
- Produces: sub-tab id `'prompts'` (label "Prompts", after "Chats"); vals keys (disjoint from every other surface — all start with `pr` except `isPrompts`, `ppRunPrompt`): `isPrompts, prState, prRows, prHasRows, prEmpty, prEmptyStyle, prQuery, prOnQuery, prSearchKey, prDoSearch, prDoClear, prSearched, prCount, prStatsNote, prHasStatsNote, prNoObsidian, prNoObsidianNote, prHasFor, prForText, prClearFor, ppRunPrompt`; row fields `r.title, r.name, r.usesText, r.lastUsed, r.hasLast, r.tagText, r.hasTags, r.varText, r.hasVars, r.forHere, r.canObsidian, r.openObsidian, r.openFile, r.run`; DOM hooks `data-pr="lib|for|q|search|empty|row|obsidian|file|run|no-obsidian|page-run"` (CDP, Task 9).

- [ ] **Step 0: Record the "before" golden dump (before ANY edit in this task).**

Run (Git Bash, repo root): `B="$(mktemp -d)"; echo "$B"; GOLDEN_DUMP="$B" node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: PASS (Task 7 left the goldens green); one `<scenario>.json` per scenario in `$B` (outside the repo). Keep the printed path for Step 5.

- [ ] **Step 1: Write the failing golden scenarios.** In `dashboard-v5/src/vals.golden.test.mjs`, after the last `add('claude.…')` line, append (use the file's `add` and `tabSub` helpers; `PR_HQ` gives the scenarios a bridge — without it they would all render the no-bridge text):

```js
// Prompt library P1 — Claude › Prompts › Library (spec 2026-10-15 §6.3)
const PR_HQ = { claudeHub: { documents() {}, promptStats() {} }, claudePrompts: { status() {}, open() {} } };
const PR_ROWS = [
  { id: 'prompt:g1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Golden review prompt', mtime_ms: 1, meta: { tags: ['review', 'code'] }, variables: ['project', 'file'] },
  { id: 'prompt:g2', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\weekly.md', title: 'Golden weekly digest', mtime_ms: 2, meta: { tags: 'notes' }, variables: [] },
];
const PR_STATUS = (o = {}) => ({ vault: 'VEEMO CORTEX', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true, ...o });
const prLive = (P) => (L) => { L.prompts = { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false, ...P }; };
const PR_AT = tabSub('claude', 'prompts');   // tabSub returns a (c) => patch function: pass it as `state` itself, or call it with c
add('claude.prompts-list', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [{ prompt_id: 'prompt:g1', uses: 2, last_at: '2026-10-01T10:00:00Z' }], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-not-run', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-no-obsidian', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS({ obsidian: false }) }), state: PR_AT });
add('claude.prompts-nofolder', { hq: PR_HQ, live: prLive({ rows: [], stats: [], status: PR_STATUS({ folder: { exists: false } }) }), state: PR_AT });
add('claude.prompts-empty', { hq: PR_HQ, live: prLive({ rows: [], stats: [], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-error', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, error: 'Claude Hub: hub not running', status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-nobridge', { live: prLive({}), state: PR_AT });   // no `hq` → render() passes null (vals.golden.test.mjs render: `sc.hq === undefined ? null`)
add('claude.prompts-nohits', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS(), q: 'zzz', hits: [] }), state: (c) => ({ ...PR_AT(c), prQuery: 'zzz', prSearched: true }) });
add('claude.prompts-for-project', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS() }), state: (c) => ({ ...PR_AT(c), prFor: 'a' }) });   // 'a' = the base DATA project the `project.a.*` scenarios open
```

Each scenario = one state of the table in Task 6's `promptsView` test, plus the project context. The harness (`render(sc)`, vals.golden.test.mjs) does `Object.assign(c.state, typeof sc.state === 'function' ? sc.state(c, store.model) : sc.state)`, so `state: () => tabSub(…)` would assign a function and silently render the Home tab — never write it that way.

Run: `node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: FAIL — the 9 new `claude.prompts-*` scenarios have no recorded hash. (Once Step 2 adds `['prompts','Prompts']` to `SUBS.claude`, the file's `every tab × each of its subs` loop also adds a 10th new scenario, `tab.claude.prompts` — no `hq`, so it renders the no-bridge text.)

- [ ] **Step 2: Catalog + vals.** In `catalog.mjs` change `claude: [['chats','Chats'],['projects','Projects'],…]` to insert `['prompts','Prompts']` right after `['chats','Chats']` (keep the rest as is). Create `dashboard-v5/src/vals/prompts.js`:

```js
// Prompt library P1 — Claude › Prompts › Library (spec 2026-10-15 §6.3) and the project-page "Run a prompt" button.
// Keys start with pr (ppRunPrompt on the project page). Text is bound as text; nothing here invents a number.
import { promptsView } from '../live/adapter.mjs';

export function promptsVals(ctx) {
  const { S, LIVE, sub, projects, onPage } = ctx;
  const P = LIVE.prompts || {};
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.documents);
  const forProj = S.prFor ? (projects.find((p) => p.id === S.prFor) || { id: S.prFor, name: S.prFor }) : null;
  const pageProj = onPage && S.route ? projects.find((p) => p.id === S.route.id) || null : null;
  const v = promptsView(P, { hasBridge, forProject: forProj && forProj.id });
  const obsidian = !!(P.status && P.status.obsidian);
  const isErr = v.state === 'error' || v.state === 'folder-error';
  const prRows = v.rows.map((r) => ({ ...r, hasLast: !!r.lastUsed, forHere: !!forProj && r.usesProject, canObsidian: obsidian,
    openObsidian: () => this.prOpen(r.id, 'obsidian'), openFile: () => this.prOpen(r.id, 'file'), run: () => this.prRun(r.id) }));
  const where = ((P.status && P.status.vault) || 'vault') + '/40_Resources/Prompts';
  return {
    isPrompts: S.tab === 'claude' && sub === 'prompts',
    prState: v.state, prRows, prHasRows: prRows.length > 0,
    prEmpty: v.state === 'list' ? '' : v.text,
    prEmptyStyle: { fontSize: '13px', padding: '12px 4px', color: isErr ? 'var(--orange)' : 'var(--muted)' },
    prQuery: S.prQuery || '', prOnQuery: (e) => this.onPrQuery(e), prSearchKey: (e) => { if (e && e.key === 'Enter') this.prSearch(); },
    prDoSearch: () => this.prSearch(), prDoClear: () => this.prClear(), prSearched: !!S.prSearched,
    prCount: v.state === 'list' ? `${v.count} prompt note${v.count === 1 ? '' : 's'} · ${where}` : '',
    prStatsNote: v.statsNote, prHasStatsNote: !!v.statsNote,
    prNoObsidian: !!P.status && !obsidian, prNoObsidianNote: 'Obsidian is not installed on this PC — notes open as files.',
    prHasFor: !!forProj,
    prForText: forProj ? `For ${forProj.name} — prompts that use {{project}} or {{cwd}} come first; the run step fills them from this project.` : '',
    prClearFor: () => this.prClearProject(),
    ppRunPrompt: () => this.prForProject(pageProj),
  };
}
```

In `vals/index.js`: `import { promptsVals } from './prompts.js';` and append `promptsVals` to the end of `SURFACES` (after `claudeVaultVals`).

- [ ] **Step 3: The Library block.** In `tpl/claude.tpl.js`, insert directly before the line `            <sc-if value="{{ isClProjects }}" hint-placeholder-val="{{ false }}">` (same indentation, Claude Design language: card sections, dashed row rules, `var(--term)` for code-ish text, purple chip borders, 26 px ghost buttons):

```html
            <!-- v5: Claude › Prompts (spec 2026-10-15 §6.3, P1) — Library of the vault's prompt notes (40_Resources/Prompts): title, tags, {{variables}}, real usage from prompt_use, search; Open in Obsidian (contained obsidian://open link, §2) or Open file; Run lands with the run step and is labelled with the quota -->
            <sc-if value="{{ isPrompts }}" hint-placeholder-val="{{ false }}">
              <div data-pr="lib" style="display:flex;flex-direction:column;gap:16px">
                <sc-if value="{{ prHasFor }}" hint-placeholder-val="{{ false }}"><div data-pr="for" role="status" style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text);border:1px solid var(--purple);border-radius:10px;padding:6px 10px"><span style="flex:1">{{ prForText }}</span><button type="button" onClick="{{ prClearFor }}" aria-label="Clear the project context" style="height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">✕</button></div></sc-if>
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
                  <div style="display:flex;gap:8px;align-items:center"><input data-pr="q" value="{{ prQuery }}" onChange="{{ prOnQuery }}" onKeyDown="{{ prSearchKey }}" aria-label="Search prompt notes" placeholder="Search titles, tags and prompt text…" style="flex:1;height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px"><button type="button" data-pr="search" onClick="{{ prDoSearch }}" style="height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Search</button><sc-if value="{{ prSearched }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ prDoClear }}" style="height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Clear</button></sc-if></div>
                  <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--faint)"><span>{{ prCount }}</span><sc-if value="{{ prHasStatsNote }}" hint-placeholder-val="{{ false }}"><span>{{ prStatsNote }}</span></sc-if><sc-if value="{{ prNoObsidian }}" hint-placeholder-val="{{ false }}"><span data-pr="no-obsidian">{{ prNoObsidianNote }}</span></sc-if></div>
                </section>
                <sc-if value="{{ prEmpty }}" hint-placeholder-val="{{ false }}"><div data-pr="empty" role="status" style="{{ prEmptyStyle }}">{{ prEmpty }}</div></sc-if>
                <sc-if value="{{ prHasRows }}" hint-placeholder-val="{{ true }}">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:8px 12px">
                    <sc-for list="{{ prRows }}" as="r" hint-placeholder-count="3"><div data-pr="row" style="padding:10px 0;border-bottom:1px dashed var(--frame)">
                      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;flex:1">{{ r.title }} <span style="font-size:11px;color:var(--faint)">{{ r.name }}</span></span><span style="font-size:11px;color:var(--muted)">{{ r.usesText }}</span><sc-if value="{{ r.hasLast }}" hint-placeholder-val="{{ false }}"><span style="font-size:11px;color:var(--faint)">{{ r.lastUsed }}</span></sc-if>
                        <sc-if value="{{ r.canObsidian }}" hint-placeholder-val="{{ true }}"><button type="button" data-pr="obsidian" onClick="{{ r.openObsidian }}" title="Opens this note in Obsidian" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--purple);background:transparent;cursor:pointer;color:var(--text)">Open in Obsidian</button></sc-if>
                        <button type="button" data-pr="file" onClick="{{ r.openFile }}" title="Opens the .md file with your default app" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;cursor:pointer;color:var(--text)">Open file</button>
                        <button type="button" data-pr="run" onClick="{{ r.run }}" title="Run lands with the run step · uses your Claude quota" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;cursor:pointer;color:var(--muted)">Run <span style="font-size:10px;color:var(--faint)">uses your Claude quota</span></button></div>
                      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:4px"><sc-if value="{{ r.hasTags }}" hint-placeholder-val="{{ true }}"><span style="color:var(--purple)">{{ r.tagText }}</span></sc-if><sc-if value="{{ r.hasVars }}" hint-placeholder-val="{{ true }}"><span style="color:var(--faint);font-family:var(--term)">{{ r.varText }}</span></sc-if><sc-if value="{{ r.forHere }}" hint-placeholder-val="{{ false }}"><span style="color:var(--green)">uses this project</span></sc-if></div>
                    </div></sc-for>
                  </section>
                </sc-if>
              </div>
            </sc-if>
```

In `tpl/project-page.tpl.js`, in the Claude section's title row (the line holding `onClick="{{ clNewChat }}"`), insert right after that New chat `</button>`:

```html
<!-- v5: Prompt library P1 — Run a prompt opens Claude › Prompts with this project as the run context (the run modal lands in P3) --><button type="button" data-pr="page-run" onClick="{{ ppRunPrompt }}" title="Opens Claude › Prompts for this project" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Run a prompt</button>
```

- [ ] **Step 4: Re-record the template hash (deliberate).**

Run: `node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import c from 'node:crypto'; console.log(c.createHash('sha256').update(t).digest('hex'), t.length, Buffer.byteLength(t, 'utf8'))"`
Put the three printed values into `SHA256`, `LENGTH`, `UTF8_BYTES` of `dashboard-v5/src/tpl.hash.test.mjs` and add above them the line `// 2026-10-25 P1 prompt library: Claude › Prompts Library block (claude.tpl.js) + project-page "Run a prompt" (+<Δchars> chars / +<Δbytes> bytes)` with the real deltas (new − old: old = 232355 / 232774 at HEAD 4c8da80, or whatever H6 left — read the constants before editing).
Run: `node --test dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/honesty.test.mjs`
Expected: PASS. (`honesty.test.mjs` must stay green: no judgment word, quota label present.)

- [ ] **Step 5: Attribute every golden change, then re-record.** The new sub-tab changes `subTabs` in every Claude-tab scenario, and the new vals keys appear in every scenario; nothing else may change.

Run: `A="$(mktemp -d)"; GOLDEN_DUMP="$A" node --test dashboard-v5/src/vals.golden.test.mjs || true` (the "after" dump; `$B` is the "before" dump from Step 0).

Run: `node dashboard-v5/tools/golden-diff.mjs "$B" "$A" --allow '^(subTabs|isPrompts|pr[A-Z][A-Za-z]*|ppRunPrompt)\b'`
Expected: exit 0 — every changed path is `subTabs…` (the Prompts tab) or a new P1 key; 10 scenarios are listed as added (the 9 `claude.prompts-*` plus the loop's `tab.claude.prompts`); none removed. Any other changed path = STOP and fix the cause (do not widen the regex).
Then: `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs` and `node --test dashboard-v5/src/vals.golden.test.mjs` → PASS. Remove the two dump folders by literal path (`rm -rf` with the two printed paths).

- [ ] **Step 6: The v5 suites.**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard-v5/src/live/catalog.mjs dashboard-v5/src/vals/prompts.js dashboard-v5/src/vals/index.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/project-page.tpl.js dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: P1.8 — Claude › Prompts Library (tags, {{variables}}, real usage, search, Open in Obsidian / Open file, quota-labelled Run placeholder, distinct empty states) + project-page Run a prompt; tpl hash re-recorded; goldens: +9 prompts scenarios (+ the loop's tab.claude.prompts), every other change attributed to subTabs / new P1 keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Selftest rows for every Library state + CDP scenarios `prompts-library-open`, `prompts-empty-states`, `prompts-project-shortcut`

**Files:**
- Modify: `dashboard-v5/src/selftest.js` (`CLEAR` gains the three P1 state keys; `STATES` gains `prompts-*` rows)
- Modify: `dashboard-v5/tools/cdp-gate.mjs` (three scenarios + three header lines)

**Interfaces:**
- Consumes: Task 8 DOM hooks `data-pr="lib|for|q|search|empty|row|obsidian|file|run|no-obsidian|page-run"`; Task 5 fake `FAKE_PROMPTS` (2 rows, ids `prompt:aaaa…`/`prompt:bbbb…`), fake `claudeHub.promptStats` (3 uses on the first), `claudePrompts.status` (obsidian true), `claudePrompts.open`; `hqFake.calls(method) -> [{args}]`, `hqFake.set(method, value|fn)`; cdp `fresh(t)`, `t.evaluate`, `t.waitFor`, `t.errors()`; selftest `at(tab, sub, project)`, `LV` (= `W.store.live`), `M` (model), `savedLive` restore.
- Produces: selftest combos `prompts-list`, `prompts-no-obsidian`, `prompts-nofolder`, `prompts-folder-error`, `prompts-empty`, `prompts-error`, `prompts-nohits`, `prompts-for-project`, `project-run-a-prompt`; CDP scenarios (names above) in `node dashboard-v5/tools/cdp-gate.mjs --scenario all`.

- [ ] **Step 1: Selftest rows.** In `selftest.js`, add `prQuery: '', prSearched: false, prFor: null,` to `CLEAR` (so no combo inherits a search or project context — `RESTORE` picks them up from `CLEAR`), and add `prompts: LV.prompts` to the `savedLive = { … }` object (selftest.js:131 at HEAD; H6 may have extended it — add the key, keep the others): the `prompts-*` rows replace `LV.prompts`, and `Object.assign(LV, savedLive)` restores only the keys listed there, so without it the last row's Library state leaks into every later combo and into the app after the run. Near the `clLib` helper add:

```js
// Prompt library P1 — Library states (live.prompts as the store leaves it)
const PR_ROWS = [
  { id: 'prompt:st1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Selftest review prompt', mtime_ms: 1, meta: { tags: ['review'] }, variables: ['project', 'file'] },
  { id: 'prompt:st2', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\weekly.md', title: 'Selftest weekly digest', mtime_ms: 2, meta: {}, variables: [] },
];
const PR_ST = (o = {}) => ({ vault: 'VEEMO CORTEX', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true, ...o });
const prLib = (P) => () => { LV.prompts = { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false, ...P }; };
```

and in `STATES` (after the `cl-*` rows):

```js
        ['prompts-list', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, stats: [{ prompt_id: 'prompt:st1', uses: 2, last_at: '2026-10-01T10:00:00Z' }], status: PR_ST() })],
        ['prompts-no-obsidian', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, stats: [], status: PR_ST({ obsidian: false }) })],
        ['prompts-nofolder', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST({ folder: { exists: false } }) })],
        ['prompts-folder-error', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST({ folder: { exists: false, error: '40_Resources/Prompts leads outside the vault — refusing' } }) })],
        ['prompts-empty', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST() })],
        ['prompts-error', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, error: 'Claude Hub: hub not running', status: PR_ST() })],
        ['prompts-nohits', at('claude', 'prompts'), { prQuery: 'zzz', prSearched: true }, prLib({ rows: PR_ROWS, stats: [], status: PR_ST(), q: 'zzz', hits: [] })],
        ['prompts-for-project', at('claude', 'prompts'), { prFor: (M.P0[0] || {}).id || null }, prLib({ rows: PR_ROWS, stats: [], status: PR_ST() })],
        ['project-run-a-prompt', at('projects', 'grid', (M.P0[0] || {}).id), {}, prLib({ rows: PR_ROWS, stats: [], status: PR_ST() })],
```

(`M.P0` is what the neighbouring project rows use, e.g. `project-security` and `cl-page-chats`.)

Run (PowerShell, from `dashboard-v5`): `$env:HQ_V5_PROFILE = 'p1-selftest-' + [guid]::NewGuid().ToString('N').Substring(0,6); ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --selftest; $LASTEXITCODE`
Expected: exit `0`, verdict `errors 0 / unresolved 0 / failures 0`; the printed combo count is higher than before this task (9 new STATES rows, plus whatever the selftest's own tab × sub walk adds for the new `claude › prompts` sub — note both numbers in the commit body). Unresolved bindings here mean a key from Task 8's list is misspelled in the template — fix the template, not the selftest.

- [ ] **Step 2: Write the CDP scenarios.** In `cdp-gate.mjs` add three header lines to the scenario list comment (`prompts-library-open — Library lists the fake notes; Open in Obsidian → claudePrompts.open(id,'obsidian'); Obsidian missing → one Open-file fallback; Run sends nothing`, `prompts-empty-states — no folder / empty folder / Hub error each say why`, `prompts-project-shortcut — project page "Run a prompt" opens Claude › Prompts with the project chip; ✕ clears it`) and these keys in `SCENARIOS`:

```js
  async 'prompts-library-open'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const opens = () => t.evaluate(`hqFake.calls('claudePrompts.open').map((c) => c.args)`);
    const click = (sel) => t.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
    await t.evaluate(`(() => { WHQ.app.logic.go('claude', 'prompts'); return true; })()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-pr="row"]').length === 2`, 8000)) return ['the Library did not list the 2 fake prompt notes'];
    const text = await t.evaluate(`document.querySelector('[data-pr="lib"]').textContent`);
    for (const want of ['Review a PR like a staff engineer', 'review-a-pr.md', '#review #code', '{{project}} {{file}}', 'used 3×', 'not run yet', 'uses your Claude quota', '2 prompt notes · fake-vault/40_Resources/Prompts'])
      if (!text.includes(want)) out.push('Library text lacks: ' + want);
    if (!await click('[data-pr="obsidian"]')) out.push('no Open in Obsidian button');
    else if (!await t.waitFor(`hqFake.calls('claudePrompts.open').length === 1`)) out.push('Open in Obsidian did not reach main');
    else if (JSON.stringify((await opens())[0]) !== JSON.stringify(['prompt:' + 'a'.repeat(40), 'obsidian'])) out.push('open args: ' + JSON.stringify(await opens()));
    // Obsidian missing: main answers with fallback 'file' → exactly one Open-file retry
    await t.evaluate(`(() => { hqFake.set('claudePrompts.open', (id, how) => (how === 'obsidian' ? { error: 'Obsidian is not installed — use Open file', fallback: 'file' } : { ok: true, how })); return true; })()`);
    await click('[data-pr="obsidian"]');
    if (!await t.waitFor(`hqFake.calls('claudePrompts.open').length === 3`)) out.push('no Open-file fallback after "Obsidian is not installed"');
    else if ((await opens())[2][1] !== 'file') out.push('the fallback was not Open file: ' + JSON.stringify(await opens()));
    // main says Obsidian is absent → no Obsidian buttons, the note says why, Open file stays
    await t.evaluate(`(() => { hqFake.set('claudePrompts.status', { vault: 'fake-vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: false }); WHQ.app.logic.prLoad(); return true; })()`);
    if (!await t.waitFor(`!document.querySelector('[data-pr="obsidian"]') && !!document.querySelector('[data-pr="no-obsidian"]') && !!document.querySelector('[data-pr="file"]')`)) out.push('Obsidian-absent state not shown');
    // Run is a labelled placeholder: nothing is sent, launched or copied
    await click('[data-pr="run"]');
    await t.sleep(300);
    for (const m of ['claudeChat.send', 'claudeQuest']) if ((await t.evaluate(`hqFake.calls(${JSON.stringify(m)}).length`)) !== 0) out.push('Run called ' + m);
    if (!await t.waitFor(`document.body.textContent.includes('Run arrives with the run step')`)) out.push('Run did not explain itself');
    // search: FTS hits ∪ tag/title matches
    await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ prQuery: 'weekly' }); L.prSearch(); return true; })()`);
    if (!await t.waitFor(`document.querySelectorAll('[data-pr="row"]').length === 1 && document.querySelector('[data-pr="row"]').textContent.includes('Weekly notes digest')`)) out.push('search did not narrow to the weekly note');
    return out.concat(t.errors());
  },

  async 'prompts-empty-states'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const empty = () => t.evaluate(`(() => { const e = document.querySelector('[data-pr="empty"]'); return e ? e.textContent : ''; })()`);
    await t.evaluate(`(() => { hqFake.set('claudeHub.documents', []); hqFake.set('claudePrompts.status', { vault: 'fake-vault', rel: '40_Resources/Prompts', folder: { exists: false }, obsidian: true }); WHQ.app.logic.go('claude', 'prompts'); WHQ.app.logic.prLoad(); return true; })()`);
    if (!await t.waitFor(`(document.querySelector('[data-pr="empty"]') || {}).textContent?.startsWith('No prompts folder yet — create fake-vault/40_Resources/Prompts')`)) out.push('no-folder text: ' + await empty());
    await t.evaluate(`(() => { hqFake.set('claudePrompts.status', { vault: 'fake-vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true }); WHQ.app.logic.prLoad(); return true; })()`);
    if (!await t.waitFor(`(document.querySelector('[data-pr="empty"]') || {}).textContent?.includes('has no prompt notes yet')`)) out.push('empty-folder text: ' + await empty());
    await t.evaluate(`(() => { hqFake.set('claudeHub.documents', { error: 'hub not running' }); WHQ.app.logic.prLoad(); return true; })()`);
    if (!await t.waitFor(`(document.querySelector('[data-pr="empty"]') || {}).textContent?.startsWith('Claude Hub: hub not running')`)) out.push('Hub-error text: ' + await empty());
    if (await t.evaluate(`document.querySelectorAll('[data-pr="row"]').length`) !== 0) out.push('rows shown under a Hub error');
    return out.concat(t.errors());
  },

  async 'prompts-project-shortcut'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const p = await t.evaluate(`(() => { const L = WHQ.app.logic; const p = L.M.P0[0]; L.go('projects', 'grid'); L.openProject(p.id); return { id: p.id, name: p.name }; })()`);   // same route as the gaps scenario (cdp-gate.mjs: M.P0 + go + openProject)
    if (!await t.waitFor(`!!document.querySelector('[data-pr="page-run"]')`)) return ['the project page has no "Run a prompt" button'];
    await t.evaluate(`(() => { document.querySelector('[data-pr="page-run"]').click(); return true; })()`);
    if (!await t.waitFor(`WHQ.app.logic.state.tab === 'claude' && WHQ.app.logic.state.sub.claude === 'prompts' && !!document.querySelector('[data-pr="for"]')`)) return out.concat(['Run a prompt did not open Claude › Prompts with the project chip']);
    const chip = await t.evaluate(`document.querySelector('[data-pr="for"]').textContent`);
    if (!chip.includes('For ' + p.name)) out.push('chip text: ' + chip);
    if (await t.evaluate(`WHQ.app.logic.state.prFor`) !== p.id) out.push('prFor is not the project id');
    if (!await t.waitFor(`document.querySelectorAll('[data-pr="row"]').length === 2 && document.querySelector('[data-pr="row"]').textContent.includes('uses this project')`)) out.push('the {{project}} prompt is not first / not marked');
    await t.evaluate(`(() => { document.querySelector('[data-pr="for"] button').click(); return true; })()`);
    if (!await t.waitFor(`!document.querySelector('[data-pr="for"]')`)) out.push('✕ did not clear the project context');
    return out.concat(t.errors());
  },
```

(`WHQ.app.logic.M.P0` and `WHQ.app.logic.openProject(id)` are the live names — cdp-gate.mjs uses both at HEAD to open a project page.)

- [ ] **Step 3: Run the CDP gate against a fake-preload harness (own port; stop only your PID).**

```powershell
$prof = 'p1-cdp-' + [guid]::NewGuid().ToString('N').Substring(0,6); $env:HQ_V5_PROFILE = $prof
$h = Start-Process -PassThru -WorkingDirectory dashboard-v5 -FilePath '..\dashboard\node_modules\electron\dist\electron.exe' -ArgumentList 'dev-main.js', '--preload=fake', '--hidden', '--remote-debugging-port=9361'
node dashboard-v5/tools/cdp-gate.mjs --port 9361 --scenario all; $code = $LASTEXITCODE
Stop-Process -Id $h.Id
$code
```
Expected: every scenario `PASS` (incl. the three new ones and `fake-parity`), `$code` = 0. A failure in an older scenario caused by this phase (e.g. sub-tab count assumptions) is fixed in the code, not by editing the old scenario's expectation — unless that expectation counted the Claude sub-tabs, in which case update the count and say so in the commit body.

- [ ] **Step 4: Commit**

```bash
git add dashboard-v5/src/selftest.js dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: P1.9 — selftest covers every prompt Library state + the project shortcut; CDP scenarios prompts-library-open, prompts-empty-states, prompts-project-shortcut

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: P1 gate on a real second instance (fixtures only), docs, HANDOFF — the owner's app is NOT restarted

**Files:**
- Create (temp, outside the repo, deleted at the end): `$g\gate-p1.mjs`
- Modify: `README.md` (Claude Hub section + test-command block), `CLAUDE.md` ("Facts that save you time": one bullet), `docs/sync/IPC-CONTRACT.md` / `docs/sync/CONTRACT.md` (only if something landed differently from Task 1/Task 5 Step 1 — say what in the commit), `docs/sync/HANDOFF.md` (new top entry)

**Interfaces:**
- Consumes: everything above, through the real preload (`window.hq`) of a second Electron instance; H6 fixtures `makeClaudeHome`, `makeDocsHome`.
- Produces: a PASS/FAIL JSON report (counts and fixture titles only) pasted into the HANDOFF entry.

- [ ] **Step 1: All suites green on the final tree.**

Run: `node --test dashboard/claude-hub/*.test.mjs` ; `node --test dashboard/*.test.mjs` ; `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs` ; the selftest (Task 9 Step 1 command, a new unique `HQ_V5_PROFILE`) and the CDP gate (Task 9 Step 3, own port, stop only your PID).
Expected: everything PASSES; selftest exit 0 with 0/0/0; every CDP scenario `PASS`.

- [ ] **Step 2: A real second instance on fixtures (PowerShell, repo root).** Every `HQ_*` override is set; own profile and port; main's stdout goes to a gate file so the dry-open lines can be checked; nothing points at the owner's index, vault, imports folder or `~/.claude`.

```powershell
$g = Join-Path $env:TEMP ('hq-p1-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory -Path $g | Out-Null
node --input-type=module -e "import { makeClaudeHome } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs'; import { makeDocsHome } from './dashboard/claude-hub/__fixtures__/make-docs.mjs'; const d = process.argv[1]; makeClaudeHome(d); const fx = makeDocsHome(d); console.log(fx.home, fx.vault)" $g
$ownerPrompts = Join-Path $env:USERPROFILE 'Documents\VEEMO CORTEX\40_Resources'
$snap = { param($p) if (Test-Path -LiteralPath $p) { Get-ChildItem -LiteralPath $p -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2 } else { 'absent' } }
$promptsBefore = & $snap $ownerPrompts
$dataBefore = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'db\hub.sqlite'; New-Item -ItemType Directory -Path (Join-Path $g 'db') | Out-Null
$env:HQ_VAULT_DIR   = Join-Path $g 'vault'
$env:HQ_IMPORTS_DIR = Join-Path $g 'WorkspaceHQ Imports'; New-Item -ItemType Directory -Path $env:HQ_IMPORTS_DIR | Out-Null
$env:HQ_STUDIO_ROOT = Join-Path $g 'studio'; New-Item -ItemType Directory -Path $env:HQ_STUDIO_ROOT | Out-Null
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9498' -RedirectStandardOutput (Join-Path $g 'main.out') -RedirectStandardError (Join-Path $g 'main.err')
$p.Id   # the ONLY electron pid this task may stop
```

If the printed home/vault are not `$g\.claude` / `$g\vault`, set the two env vars to them **before** `Start-Process`.

Write `$g\gate-p1.mjs` (same CDP driver as the H5/H6 gates: `connect()`, `ev(expr)`, `until(expr, ms)` — copy those three functions verbatim from `docs/superpowers/plans/2026-10-15-claude-hub-h5.md` Task 8 Step 2), then these checks:

```js
// gate-p1.mjs <port> <gateDir> — prompt library P1 real-instance gate (fixtures only). Never run against the owner's app.
import fs from 'node:fs';
import path from 'node:path';
const [port, g] = [Number(process.argv[2]), process.argv[3]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* connect(), ev(), until() — verbatim from the H5 gate */
const fails = [], report = {};
await connect();
if (!await until(`!!(window.WHQ && WHQ.app && WHQ.app.logic && window.hq && hq.claudePrompts)`, 30000)) { console.log(JSON.stringify({ fails: ['the app never mounted (or no hq.claudePrompts)'] })); process.exit(1); }
// 1. the fixture prompt note is indexed with its tags and variables; stats are real (empty)
if (!await until(`hq.claudeHub.documents({ source: 'prompt' }).then((r) => Array.isArray(r) && r.length === 1)`, 45000)) fails.push('prompt note never indexed: ' + JSON.stringify(await ev(`hq.claudeHub.documents({ source: 'prompt' })`)));
const [row] = (await ev(`hq.claudeHub.documents({ source: 'prompt' })`)) || [];
report.title = row && row.title;
if (!row || JSON.stringify(row.variables) !== '["project","file"]' || JSON.stringify(row.meta && row.meta.tags) !== '["review","code"]') fails.push('row shape: ' + JSON.stringify(row));
if (JSON.stringify(await ev(`hq.claudeHub.promptStats()`)) !== '[]') fails.push('promptStats is not [] before P3');
// 2. main status: the GATE vault's basename, folder there; never a path
const st = await ev(`hq.claudePrompts.status()`);
report.obsidianInstalled = !!(st && st.obsidian);
if (!st || st.vault !== 'vault' || st.rel !== '40_Resources/Prompts' || !st.folder || st.folder.exists !== true) fails.push('status: ' + JSON.stringify(st));
if (JSON.stringify(st).includes('\\\\')) fails.push('status carries a path');
// 3. open: contained note only; dry-launch opens nothing and logs only the file name
if (row) {
  const f = await ev(`hq.claudePrompts.open(${JSON.stringify(row.id)}, 'file')`);
  if (!f || f.ok !== true || f.dry !== true) fails.push('open file (must be a dry open): ' + JSON.stringify(f));
  const o = await ev(`hq.claudePrompts.open(${JSON.stringify(row.id)}, 'obsidian')`);
  if (st && st.obsidian ? !(o && o.ok && o.dry === true) : !(o && o.fallback === 'file')) fails.push('open obsidian: ' + JSON.stringify(o));
}
for (const [id, how] of [['memory:' + 'a'.repeat(40), 'file'], ['prompt:' + 'f'.repeat(40), 'obsidian'], [row ? row.id : 'x', 'url'], ['C:\\\\Windows\\\\notepad.exe', 'file']]) {
  const r = await ev(`hq.claudePrompts.open(${JSON.stringify(id)}, ${JSON.stringify(how)})`);
  if (!r || !r.error) fails.push('not refused: ' + JSON.stringify([id, how, r]));
}
// 4. the Library in v5: one row, real usage text, quota label; an Obsidian edit shows up live
await ev(`(() => { WHQ.app.logic.go('claude', 'prompts'); return true; })()`);
if (!await until(`document.querySelectorAll('[data-pr="row"]').length === 1`, 15000)) fails.push('the Library did not show the fixture note');
else {
  const text = await ev(`document.querySelector('[data-pr="lib"]').textContent`);
  for (const want of ['Review a PR like a staff engineer', 'not run yet', '{{project}} {{file}}', 'uses your Claude quota']) if (!text.includes(want)) fails.push('Library lacks: ' + want);
}
fs.writeFileSync(path.join(g, 'vault', '40_Resources', 'Prompts', 'second-placeholder.md'), '---\ntitle: Second placeholder prompt\ntags: [gate]\n---\nPlaceholder {{topic}}\n');
if (!await until(`document.querySelectorAll('[data-pr="row"]').length === 2`, 20000)) fails.push('a note added in the vault did not reach the Library live');
// 5. the dry opens are proven by `dry: true` above; main's stdout (when Electron's stdout reaches the redirect) is a bonus check
await sleep(500);
const out = fs.existsSync(path.join(g, 'main.out')) ? fs.readFileSync(path.join(g, 'main.out'), 'utf8') : '';
report.dryOpenLines = (out.match(/\[dry-open\] (obsidian|file) [^\r\n]+/g) || []).length;   // 0 is fine if stdout was not captured
if (/\[dry-open\][^\r\n]*[\\/]/.test(out)) fails.push('a dry-open line carries a path');
console.log(JSON.stringify({ fails, report }, null, 2));
process.exit(fails.length ? 1 : 0);
```

Run: `node "$g\gate-p1.mjs" 9498 $g ; $gateCode = $LASTEXITCODE`
Expected: `{"fails": [], …}` and `$gateCode` = 0. (If this PC has Obsidian installed, `report.obsidianInstalled` is `true` and the dry-run logs one `obsidian` line too; Obsidian itself is never launched because `HQ_DRY_LAUNCH=1`.)

- [ ] **Step 3: The owner's things are untouched; stop only your instance; clean up.**

```powershell
if ((& $snap $ownerPrompts) -ne $promptsBefore) { 'FAIL: the owner vault 40_Resources changed' }
$dataAfter = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
if ($dataAfter -ne $dataBefore) { 'FAIL: data\claude changed' }
Select-String -Path (Join-Path $g 'logs\*.log'), (Join-Path $g 'main.out') -Pattern 'You are reviewing', 'Placeholder body' -SimpleMatch -Quiet   # must print False: logs carry names and reasons, never prompt text
Stop-Process -Id $p.Id
Get-Process -Id $p.Id -ErrorAction SilentlyContinue   # nothing
Remove-Item -LiteralPath $g -Recurse -Force
Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_VAULT_DIR, Env:HQ_IMPORTS_DIR, Env:HQ_STUDIO_ROOT, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION
```
Expected: no `FAIL:` line; `False` from Select-String; the owner's `electron.exe . --hidden` (no `--user-data-dir`) and its Hub child are still running (check `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine` — do NOT stop or restart it). Never run `tools\rollback.ps1` in this phase.

- [ ] **Step 4: Docs.**

`README.md` — in the Claude Hub section add one short paragraph: "Claude › Prompts is your prompt library: the notes in `VEEMO CORTEX/40_Resources/Prompts` (the vault is the source of truth — edit them in Obsidian), with tags, `{{variables}}`, how often each was run and when, search, and Open in Obsidian / Open file. Run arrives with the run step; the project page's Run a prompt opens the Library for that project. Until you create the folder the Library says so." In the test-command block add after the existing globs: `# P1 prompt library only: node --test dashboard/claude-prompt-note.test.mjs dashboard/claude-prompts.test.mjs dashboard-v5/src/logic/prompts.test.mjs`.

`CLAUDE.md` — append one bullet to "Facts that save you time": "- Prompt library (P1): Claude › Prompts lists `HQ_VAULT_DIR/40_Resources/Prompts/*.md` (Hub `listDocuments({source:'prompt'})` rows carry `meta` + `variables`; usage = Hub `promptStats` over `prompt_use`, written from P3). Note format + no-overwrite writer: `dashboard/claude-prompt-note.js`, `dashboard/claude-prompts.js` (`writePromptNote`); Open in Obsidian = `hq:claude-prompts:open` (main finds the file by its Hub id; only `obsidian://open?vault=<basename>&file=40_Resources/Prompts/<name>` or that file; `HQ_DRY_LAUNCH=1` logs `[dry-open]`)."

`docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` — re-read the P1 section against the landed code (`git diff <Task 1 commit>^ -- dashboard/preload.js dashboard/claude-hub-host.js dashboard/claude-prompts.js dashboard/claude-hub/store.mjs`); fix any row that differs (additive wording only) and list the fixes in the commit body; if none, say "rows unchanged".

- [ ] **Step 5: HANDOFF entry.** Insert at the top of `docs/sync/HANDOFF.md` (below the format block and its `---`), replacing `<sha>` with `git log -1 --format=%h` before this commit and `<HH:MM>` with the local time:

```
## 2026-10-25 <HH:MM> · FROM frontend · main @ <sha>
DONE: Prompt library P1 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p1.md), commits P1.2–P1.9 + this meta commit:
  note format claude-prompt-note.js (slug, -2…-9 clashes, {{variables}}, §6.1 frontmatter = H6 parser round trip, doc id = H6 docId);
  writePromptNote (new files only, contained, atomic — for P2 Promote); Hub rows meta + variables, read-only promptStats;
  claudePrompts.status/open (contained obsidian:// link or the file, Obsidian-absent fallback, HQ_DRY_LAUNCH); v5 Claude › Prompts
  Library + project-page Run a prompt (run context chip). Real second-instance gate on fixtures: PASS (<paste report>).
IN-FLIGHT: none. Run is a labelled placeholder until P3. The owner's vault has no 40_Resources/Prompts yet → the Library says so.
  The owner's app was NOT restarted; it picks this up on its next restart (no schema change in P1).
ASKS: none (no structure-lane file touched).
BREAKS: main.js +1 line after the claude-imports init (claude-prompts). New IPC hq:claude-hub:prompt-stats, hq:claude-prompts:status|open;
  hq:claude-hub:documents rows gain meta (+ variables on prompt rows). CONTRACT.md: 40_Resources/Prompts note format entry.
```

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: prompt library P1 done — real second-instance gate on fixtures (PASS), README/CLAUDE.md facts, contract rows checked, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `docs/sync/IPC-CONTRACT.md` / `CONTRACT.md` only if Step 4 changed them; `git add` of an unchanged file is harmless. Never stage the other lane's four files.)

## Self-review (done while writing; kept for the executor)

- Spec coverage: §6.1 note format → Tasks 2–3; §6.3 Library (title, tags, usage, last used, variables, search, Run placeholder, Open in Obsidian / Open file) → Tasks 4–8; project-page shortcut → Tasks 7–8; §7 `promptStats`, `claudePrompts.*` → Tasks 1, 4, 5; §8 empty state + Obsidian fallback → Tasks 5–6, 8–9; §9 open-link whitelist, path containment, slug clash → Tasks 3, 5; selftest/goldens/CDP → Tasks 8–9; real second-instance gate + docs + HANDOFF → Task 10. Candidates/Promote/Hide (P2) and run modal/packs/prompt_use writes (P3) are out of scope.
- Names used across tasks: `promptStats` (store, op, IPC `prompt-stats`, preload), `claudePrompts.status/open`, `writePromptNote`, `resolvePromptsDir`, `findPromptFile`, `obsidianUrl`, `promptRow`, `promptsView`, `refreshPrompts`/`searchPrompts`/`openPrompt`, `promptsLogic` (`prLoad, onPrQuery, prSearch, prClear, prOpen, prRun, prForProject, prClearProject`), state `prQuery/prSearched/prFor`, vals keys of Task 8 — consistent.
- No schema/index-version change (read-time columns only); main.js: exactly one line; every new channel has a contract row written before its handler (Task 1, amended additively in Task 5 Step 1 before the handler).

<!-- plan complete: 10 tasks -->
