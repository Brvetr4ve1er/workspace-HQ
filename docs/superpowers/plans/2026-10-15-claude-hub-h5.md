# Claude Hub H5 — Ask grounding + vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask can answer from the owner's past Claude chats (a seventh source chip, **Claude history**, grounded through the Hub's `contextFor` and cited as "chat <title>, <date>"), and any indexed chat can become one VEEMO CORTEX note: drafted by the local model, edited and confirmed by the owner in v5, written atomically under `30_Areas/Claude/`.

**Architecture:** The Hub process gains a read-only op `contextFor({query, budgetChars})` (new `dashboard/claude-hub/context.mjs` plus `store.contextHits`). It turns an Ask question into cited snippets that fit a character budget. `dashboard/llm-context.js` gains a `claude` section that asks for them through the main-side Hub host, inside the existing 4 000 / 12 000 budgets (3 000 chars are reserved for it when it is ticked). A new main-side module, `dashboard/claude-vault.js`, drafts a note with the local model (`llm-local.js`) from the Hub's copy of a chat (`preview`, which writes nothing). It writes a note only when v5 sends `save` after the owner presses Save, or Replace for a note that is already there. v5 adds the chip (`ask-store.mjs`), the "Save to vault" dialog (`extras.tpl.js`, `logic/claude-vault.js`, `vals/claude-vault.js`) and a "Save to vault" button in H2's thread view.

**Tech Stack:**
- System Node ≥ 22.13 for the Hub (`node:sqlite`, FTS5).
- Electron 32 main process (CommonJS, Node 20).
- The v5 renderer (vanilla ESM, dc templates).
- `node --test`.
- The CDP gate (`dashboard-v5/tools/cdp-gate.mjs`).
- The local model through `dashboard/llm-local.js` (Ollama or LM Studio).

**Spec:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md`. This phase covers §6 `contextFor`, §7 `claudeVault.preview/save`, §9 Ask + Vault and the §11 scenarios `ask-claude-chip` and `vault-preview-confirm`. The H1 plan (`docs/superpowers/plans/2026-10-13-claude-hub.md`) holds the H2–H5 outline this plan details.

## Global Constraints

- Hub runtime: system Node ≥ 22.13. The Electron main process (Node 20) never imports node:sqlite; everything that touches hub.sqlite runs inside dashboard/claude-hub/hub.mjs.
- All imported data, indexes, temp files and logs live under data/claude/ (gitignored). Nothing leaves the machine except the owner's own claude.ai session requests (H4) and the owner's own Claude Code calls (H3).
- Fixtures: placeholder text only (project-a, example.org…); secret-shaped test strings are built at runtime, never committed literally.
- Never read a transcript whole; stream with byte cursors. The owner's ~/.claude is read-only, always.
- Test overrides: HQ_CLAUDE_HOME (a folder containing projects/), HQ_CLAUDE_DB (the db file), HQ_HUB_NODE, HQ_STUDIO_ROOT, HQ_APP_LOG_DIR, HQ_DRY_LAUNCH=1. EVERY test, harness, second instance and gate sets HQ_CLAUDE_DB + HQ_CLAUDE_HOME to temp/fixture paths — never the owner's real index (data/claude/hub.sqlite is live and owned by the owner's running app).
- IPC: every new channel/field gets a docs/sync/IPC-CONTRACT.md row BEFORE its handler (additive only); main-side code goes in new files with one-line hooks in dashboard/main.js; list every touched main.js line in the report.
- v5 renderer: template additions carry <!-- v5: reason --> markers; follow the Claude Design visual language (tokens, existing classes); goldens (src/vals.golden.test.mjs, src/__golden__/, src/tpl.hash.test.mjs) are re-recorded only after every changed scenario is attributed; src/selftest.js gets combos for every new state/overlay; dashboard-v5/tools/fake-preload.js mirrors every new preload method (fake-parity test); CSP unchanged (default-src 'self', no eval, no remote).
- Honesty: no invented numbers; "active time" is labelled estimate; empty states say why; estimates labelled; every in-app Claude send is labelled "uses your Claude quota".
- Chat engine (H3): never pass --dangerously-skip-permissions or --permission-mode bypassPermissions (a unit test pins this); read-only = plan, edits = acceptEdits; --permission-prompts none; one running turn per conversation, 3 total, 10-min cap; tests and gates use a fake `claude` shim on PATH (see dashboard/claude-launch.test.mjs for the pattern) — never spend real quota in tests.
- Extension (H4): read-only GETs to claude.ai, ≤ 1 request / 2 s, exponential backoff, shape-change pause with a visible status, optional host permission granted on the owner's click; never writes to claude.ai. A manual extension reload is an owner action — say so.
- Vault (H5): never writes without the owner's confirmation in the UI; atomic writes; never overwrites without an explicit replace confirm; only under VEEMO CORTEX/30_Areas/Claude/.
- Commits: explicit pathspecs (never git add -A), fe: / meta: prefixes, end with a truthful "Co-Authored-By: Claude <your model name> <noreply@anthropic.com>". Never amend, rebase, reset, stash, checkout or rewrite history on this shared tree. Never touch collector/, schema/, run-pipeline.ps1, run-scan.ps1, spellbook/, data/quest-overrides.json, collector/collector.config.json, legacy/.
- Processes: the owner's app (electron.exe . --hidden WITHOUT --user-data-dir, and its Hub child node … hub.mjs on data/claude/hub.sqlite) is never stopped; stop only PIDs you start (PowerShell Stop-Process -Id). Second instances: from dashboard/: node_modules\electron\dist\electron.exe . --hidden --user-data-dir=%TEMP%\<unique> --remote-debugging-port=<your port> with the env overrides above. Remove temp folders by literal path.
- Suites: node --test dashboard/claude-hub/*.test.mjs ; node --test dashboard/*.test.mjs ; v5: node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs ; v5 selftest from dashboard-v5: set HQ_V5_PROFILE=<unique>; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest (exit 0, errors/unresolved/failures 0); CDP scenarios: node dashboard-v5/tools/cdp-gate.mjs --scenario all against a --preload=fake harness.

Standing controller rulings from H1 (binding):
- Store/Hub errors surface (never swallowed into empty results); meta.last_error + the 'error' event carry them.
- The Hub lock is {pid, db} JSON; a live owner is a node process running hub.mjs on the same db.
- meta.index_version forces a one-off rebuild when the parser changes what it indexes — bump it when you change parse-code.mjs or redact.mjs semantics.
- Secrets are masked on the FULL text before any cut; every new text path into the index goes through maskSecrets BEFORE any length limit.
- Message ids are per conversation ('code:<session>:<uuid>'); usage is per API response (api_id) — never double count.
- Paging must tiebreak by (at, id) — H1's strict < cursor is a known gap for H2 to fix.
- Claude.ai export fields are undocumented: parse defensively, import what is understood, report counts only.
- Plans may deviate from the spec only with a reason written in the plan; the spec is the authority.

### Phase definitions and deviations (H5)

The spec leaves the following open. Each is a definition unless it is marked as a deviation.

- **New env override `HQ_VAULT_DIR`.** Only `dashboard/claude-vault.js` reads it, as the VEEMO CORTEX folder that Save to vault writes into. The real second-instance gate (Task 8) sets it to a temp vault. Node tests pass a temp `vaultDir` directly. The selftest and the `--preload=fake` harness have no vault writer at all. No test or gate ever writes the owner's real vault (`main.js` `VAULT`).
- **Deviation (additive).** Spec §7 gives `preview → {path, markdown}` and `save({path, markdown}) → true/{error}`.
  - H5 adds `rel`, `exists`, `model` and `basis` to the preview answer.
  - It adds `replace?: boolean` to the save request, and `exists: true` to save's `{error}`.
  - Reason: §9 requires "never overwrites without a 'replace' confirm". That needs a signal that a note is already there, and a flag that only the Replace button sends. `model` and `basis` carry the honesty label ("drafted by the local model from N chat messages").
- **Deviation.** A note for a *different* chat that already has the same `<YYYY-MM-DD> <title>.md` is never offered for replacement. The new note takes ` (2)` … ` (9)` instead. Reason: replacing another chat's note would be silent data loss. "Replace" in §9 means this chat's own earlier note, matched by its `conversation:` frontmatter.
- **The date in the note's name** is the chat's start day in local time. It falls back to the last activity, then to today. `created` is the day the draft was made.
- **The project link.** `project: "[[…]]"` links the linked WorkspaceHQ project's note (`30_Areas/Projects/<name>.md`, named by `main.js` `safeFile`). Otherwise it links the Claude project's own name.
- **No local model.** When it is not running, preview answers `{error}` (spec §7), worded like Ask's offline box. Nothing is drafted without the model, and preview never writes.
- **No index change.** `contextFor` changes no parsing or masking, so `INDEX_VERSION` stays 1.
- **Hub rows as consumed.** `claude-vault.js` consumes the Hub ops `getConversation` / `listProjects` as H1's store returns them: snake_case rows (`project_id`, `started_at`, `message_count`, `is_sidechain`). The WorkspaceHQ link `hq_project_id` is read from the `listProjects` row (H1's `getConversation` returns `SELECT * FROM conversation`, which has no such column); a conversation-level `hq_project_id` is honoured too if a later phase adds one. It does not consume H2's renderer-side IPC mapping.
- **Commit attribution.** The commit commands below end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. An executor running on another model writes its own model name there.

## Review Focus

These are the five input classes the spec implies that are most likely to bite the owner. Each is pinned to a test in the task that owns the code.

1. **A question phrased the way people ask.** This covers stop words ("what did I decide about the release plan?"), French with accents ("qu'avons-nous décidé pour le café ?"), and FTS syntax typed by accident (`"`, `*`, `NEAR(`, `OR`, `-`).
   - Expected: the chat that holds the words is found (keywords are ORed, not ANDed), nothing throws, and "no searchable keywords" / "no past chats matched" is said when that is the case.
   - *Pinned in Task 1* (`context.test.mjs` keyword, OR and hostile-query tests; `hub.test.mjs` protocol test).
2. **Claude history ticked next to the default chips on a big workspace.**
   - Expected: the Claude section still gets about 3 000 chars, and the whole context stays ≤ 12 000. With the chip unticked, the context is byte-for-byte what it was before H5.
   - *Pinned in Task 2* (`llm-context.test.mjs` "Review Focus 2" and "unticked" tests).
3. **The Hub is missing, down, starting, a reader still waiting for its index, broken, or slow (timeout) while the owner asks.**
   - Expected: the answer still runs on the other sources, and the meta line says why Claude history is missing ("Claude history: Claude Hub is not running", or the Hub's own reason).
   - *Pinned in Task 2* ("Review Focus 3" test) and *Task 1* (a store-less reader and a broken index answer errors, not empty results).
4. **Names and paths that are hostile to Windows or Obsidian.**
   - The inputs:
     - Chat titles and project names containing `: / \ ? * " < > |`, `[[ ]] # ^`, `CON` / `NUL`, trailing dots, a leading dot, 300-char or emoji titles.
     - Two different chats with the same title on the same day.
     - Crafted save paths: `..`, forward slashes, other vault folders, a junction leading out of the vault.
   - Expected: a safe and idempotent name; another chat's note is never offered for replacement (it gets " (2)"); anything outside `30_Areas/Claude/<Project>/` is refused.
   - *Pinned in Task 4* (`safeSegment`, `planNote`, `choosePath`, `resolveSavePath` tests) and *Task 5* ("another chat's note" and "save refuses" tests).
5. **A note that is already there, is locked by another program (EBUSY), or appears between preview and save.**
   - Expected: it is never overwritten without Replace. No half-written note, no `.tmp` litter, and the existing note is byte-identical after a refusal or a failed replace.
   - *Pinned in Task 4* (`writeNoteAtomic` tests), *Task 5* ("preview → save → exists" test) and *Task 6* (the dialog's Replace question, and a save answering `exists`).

---

## File structure (H5)

| File | Responsibility |
|---|---|
| `dashboard/claude-hub/context.mjs` (new) | `keywords`, `contextMatch`, `localDay`, `formatContext`, `contextFor(store, args)`: turn a question into cited snippets inside a budget (pure apart from `store.contextHits`) |
| `dashboard/claude-hub/store.mjs` | + `contextHits({match, limit})`: the FTS read behind `contextFor` |
| `dashboard/claude-hub/hub.mjs` | + op `contextFor` (one import, one op) |
| `dashboard/claude-hub/context.test.mjs` (new), `hub.test.mjs` | unit + stdio protocol tests |
| `dashboard/llm-context.js` | + the `claude` section (7th `SECTION_IDS` entry, `CLAUDE_RESERVE`, `claudeSection`, `assemble({claudeHub})`) |
| `dashboard/llm-context.test.mjs` (new) | the section, the reserve, Hub-down notes |
| `dashboard/llm-persona.md` | + "Claude history" in the source list, the cite form "from chat <title>, <date>" |
| `dashboard/claude-vault.js` (new) | main side of Save to vault: names, paths, draft prompt, note text, atomic write, `createVault({hub, llm, dataDir, vaultDir})` → `{preview, save}`, `init(...)` → IPC `hq:claude-vault:*` |
| `dashboard/claude-vault.test.mjs` (new) | everything above on mkdtemp vaults, fake Hub, fake local model |
| `dashboard/main.js` | 2 one-line hooks: `claudeHub,` in the `hq:llm:chat` `assemble({...})` call (Task 2); `require('./claude-vault').init(...)` after the Hub init in `whenReady` (Task 5) |
| `dashboard/preload.js` | + `hq.claudeVault.{preview,save}` |
| `dashboard-v5/tools/fake-preload.js` (+ `.test.mjs`) | + `claudeVault.*` rows; `llm.chat` answers a Claude history section when `include.claude` |
| `dashboard-v5/src/logic/ask-store.mjs` | + the 7th source `claude` (default off), meta line names the cited chats |
| `dashboard-v5/src/tpl/ov-ask.tpl.js` | chip placeholder count 7 (marker updated) |
| `dashboard-v5/src/logic/claude-vault.js` (new) | `claudeVaultLogic` mixin: `openVaultPreview(id)`, `onVaultEdit`, `saveVault(replace)`, `keepVault`, `retryVault`, `closeVault`, `vaultApi` |
| `dashboard-v5/src/vals/claude-vault.js` (new) | `claudeVaultVals`, `basisNote(model, basis)` |
| `dashboard-v5/src/tpl/extras.tpl.js` | + the "Save to vault" dialog |
| `dashboard-v5/src/app.js`, `src/vals/index.js` | wiring: mixin, `vault: null` state, `closeTop`, `onKey` guard, the vals surface |
| H2's thread-view fragment (`dashboard-v5/src/tpl/claude.tpl.js` unless H2 split it) | + one marked "Save to vault" button |
| `dashboard-v5/src/logic/claude-vault.test.mjs` (new) | dialog states, the save gate, the thread-view button |
| `dashboard-v5/tools/golden-diff.mjs` (new) | attributes a golden change (per changed value path) before a re-record |
| `dashboard-v5/src/selftest.js`, `src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json`, `src/tpl.hash.test.mjs` | combos, scenarios, re-records |
| `dashboard-v5/tools/cdp-gate.mjs` | + scenarios `ask-claude-chip`, `vault-preview-confirm`; existing Ask scenarios learn the 7th key; `fresh()` resets `vault` |
| tests touched for the 7th key | `logic/ask-store.test.mjs`, `logic/ask.test.mjs`, `logic/review-p3.test.mjs` |
| `docs/sync/IPC-CONTRACT.md`, `docs/sync/CONTRACT.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | rows (before the handlers), facts, handoff. `README.md` needs no change: the new test files match its existing globs. |

**`main.js` lines touched (report these):**
- **Task 2:** one added line `claudeHub,` inside the `llmContext.assemble({ … })` call in the `hq:llm:chat` handler (around line 840).
- **Task 5:** one added line `require('./claude-vault').init({ … });` right after `claudeHub = require('./claude-hub-host').init(…)` in `app.whenReady()` (around line 1594).

Nothing else in `main.js` changes; `cleanChatReq` already builds `include` from `llmContext.SECTION_IDS`.

**PowerShell vs Git Bash.** Commands that set environment variables (`GOLDEN_DUMP`, `UPDATE_GOLDEN`, `HQ_V5_PROFILE`, the gate's overrides) are written for PowerShell, because Node does not understand Git Bash's `/tmp` paths. Plain `node --test` and `git` commands work in either shell. Run everything from the repo root (`C:\Users\ROG STRIX\Documents\workspace hq`) unless a step says otherwise.

---

### Task 1: The Hub op `contextFor` (`context.mjs`, `store.contextHits`, `hub.mjs`)

**Files:**
- Create: `dashboard/claude-hub/context.mjs`
- Modify: `dashboard/claude-hub/store.mjs` (one method in the object `api(db)` returns, right after `search(...)`)
- Modify: `dashboard/claude-hub/hub.mjs` (one import line; one entry in `ops`)
- Test: `dashboard/claude-hub/context.test.mjs` (new); `dashboard/claude-hub/hub.test.mjs` (two tests appended)

**Interfaces:**
- Consumes:
  - H1 `openStore(file, { readOnly? })` and its methods `upsertProject`, `ensureConversation`, `setTitle`, `addMessages`, `forget`.
  - The tables `message`, `message_fts` (FTS5, `unicode61 remove_diacritics 2`), `conversation` and `project`.
  - `MASK(name)` from `redact.mjs` (tests only).
  - hub.mjs's `ops` map. An op that throws is answered `{id, ok:false, error}`.
- Produces (all new):
  - `store.contextHits({ match: string, limit?: number = 60 }) → Array<{ conversationId: string, role: 'user'|'assistant', at: string, snippet: string, rank: number, title: string|null, startedAt: string|null, lastAt: string|null, source: 'code'|'web', projectName: string|null }>`.
    - Rows come best first.
    - Only user and assistant, non-sidechain messages of chats that are not forgotten.
    - `snippet` is FTS5 `snippet()` with empty markers, ≤ 32 tokens.
    - A failure throws; it is never an empty result.
  - From `dashboard/claude-hub/context.mjs`:
    - `keywords(q: string) → string[]` (≤ 8, lower-case, ≥ 3 characters, no stop words).
    - `contextMatch(words: string[]) → string|null`.
    - `localDay(iso) → 'YYYY-MM-DD' | 'unknown date'`.
    - `formatContext(rows, { words, budgetChars }) → ContextResult`.
    - `contextFor(store, { query, budgetChars }) → ContextResult`.
    - Constants `CONTEXT_MAX = 8000`, `MAX_CHATS = 6`, `PER_CHAT = 2`, `HITS = 60`, `HEADER`.
  - `ContextResult = { text: string, chars: number, cites: string[], hits: Array<{ conversationId, title, date, project, source }>, words: string[], note?: 'no searchable keywords' | 'no past chats matched' | 'no room in the context budget' }`.
    - `text.length ≤ min(budgetChars, 8000)`.
    - Each cite reads `chat <title>, <date>`.
  - Hub op `contextFor({ query, budgetChars }) → ContextResult`. A Hub with no open index (a reader still waiting) answers `{ ok:false, error:'the index is not open yet' }`.

- [ ] **Step 1: Write the failing unit tests**

```js
// dashboard/claude-hub/context.test.mjs
// Ask grounding from the Hub index (Claude Hub H5, spec 2026-10-13 §6 contextFor, §9 Ask). In-memory stores with
// placeholder chats only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, SNIP_START, SNIP_END } from './store.mjs';
import { MASK } from './redact.mjs';
import { keywords, contextMatch, formatContext, contextFor, localDay, HEADER, CONTEXT_MAX, MAX_CHATS, PER_CHAT } from './context.mjs';

process.env.TZ = 'UTC';   // localDay → the UTC day in these tests

let n = 0;
const m = (text, at, role = 'user', extra = {}) => ({ id: 'm' + (++n), nativeId: 'n' + n, parentId: null, role, at, text, toolName: null, isSidechain: false, ...extra });
const conv = (s, id, { title, source = 'code', project = 'code:p-a', projectName = 'project-a' }) => {
  s.upsertProject({ id: project, source, key: project, name: projectName, path: source === 'code' ? 'C:\\placeholder\\' + projectName : null });
  s.ensureConversation({ id, source, projectId: project, nativeId: id.split(':').pop() });
  if (title) s.setTitle(id, title, 'custom');
};
function seeded() {
  const s = openStore(':memory:');
  conv(s, 'code:rel', { title: 'Release planning' });
  s.addMessages('code:rel', [
    m('Plan the placeholder release for project-a', '2026-10-01T10:00:00.000Z'),
    m('Here is the release plan: freeze, test, tag', '2026-10-01T10:01:00.000Z', 'assistant'),
    m('Move the release to Friday', '2026-10-01T10:02:00.000Z'),
    m('Release moved to Friday', '2026-10-01T10:03:00.000Z', 'assistant'),
    m('[tool: Read release-notes.md]', '2026-10-01T10:04:00.000Z', 'tool'),
  ]);
  conv(s, 'web:cafe', { title: 'Café menu', source: 'web', project: 'web:proj-b', projectName: 'Kitchen: B' });
  s.addMessages('web:cafe', [m('Draft the café menu with a release date', '2026-09-20T08:00:00.000Z')]);
  conv(s, 'code:gone', { title: 'Forgotten release chat' });
  s.addMessages('code:gone', [m('release notes from a forgotten chat', '2026-09-01T08:00:00.000Z')]);
  s.forget({ conversationId: 'code:gone' });
  conv(s, 'code:side', { title: 'Sidechain only' });
  s.addMessages('code:side', [m('release from a subagent', '2026-09-02T08:00:00.000Z', 'assistant', { isSidechain: true })]);
  conv(s, 'code:key', { title: 'Key rotation' });
  s.addMessages('code:key', [m('rotate the release key ' + MASK('stripe-key') + ' today', '2026-09-03T08:00:00.000Z')]);
  return s;
}
const blocks = (text) => text.split('\n- chat ').slice(1);   // one block per chat: '"<title>", <date> · …\n  · you: …'

test('keywords: a question becomes its searchable words; stop words, short words and punctuation go (Review Focus 1)', () => {
  assert.deepEqual(keywords('What did I decide about the release plan?'), ['decide', 'release', 'plan']);
  assert.deepEqual(keywords('Qu’avons-nous décidé pour le café ?'), ['avons', 'décidé', 'café']);
  assert.deepEqual(keywords('NEAR("x" OR y*) -- AND release_plan'), ['near', 'release', 'plan']);
  assert.deepEqual(keywords('what did the chat say?'), []);
  assert.deepEqual(keywords(undefined), []);
  assert.equal(keywords('alpha bravo charlie delta echo foxtrot golf hotel india juliet').length, 8);
});

test('contextMatch: quoted prefix terms joined by OR; nothing to search → null', () => {
  assert.equal(contextMatch(['release', 'plan']), '"release"* OR "plan"*');
  assert.equal(contextMatch([]), null);
  assert.equal(contextMatch(undefined), null);
});

test('localDay: the local calendar day, or "unknown date"', () => {
  assert.equal(localDay('2026-10-01T23:30:00.000Z'), '2026-10-01');
  assert.equal(localDay('not a date'), 'unknown date');
  assert.equal(localDay(null), 'unknown date');
});

test('contextFor: a question finds its chat (OR, not AND) and cites "chat <title>, <date>"; ≤ PER_CHAT snippets a chat (Review Focus 1)', () => {
  const s = seeded();
  const r = contextFor(s, { query: 'What did I decide about the release plan?', budgetChars: 3000 });
  assert.equal(r.hits[0].conversationId, 'code:rel');
  assert.deepEqual(r.hits.map((h) => h.conversationId).sort(), ['code:key', 'code:rel', 'web:cafe']);
  assert.deepEqual(r.cites, r.hits.map((h) => 'chat ' + h.title + ', ' + h.date));
  assert.ok(r.cites.includes('chat Release planning, 2026-10-01'));
  assert.ok(r.text.startsWith(HEADER + '\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n  · '));
  const rel = blocks(r.text).find((b) => b.startsWith('"Release planning"'));
  assert.equal(rel.split('\n').filter((l) => l.startsWith('  · ')).length, PER_CHAT, 'a chatty chat cannot fill the block');
  assert.ok(r.text.length <= 3000);
  assert.equal(r.chars, r.text.length);
  assert.deepEqual(r.words, ['decide', 'release', 'plan']);
  assert.equal(r.note, undefined);
});

test('contextFor: only your and Claude’s words in chats that still exist — tool rows, subagent turns and forgotten chats never appear', () => {
  const r = contextFor(seeded(), { query: 'release', budgetChars: 8000 });
  assert.deepEqual(r.hits.map((h) => h.conversationId).sort(), ['code:key', 'code:rel', 'web:cafe']);
  assert.doesNotMatch(r.text, /release-notes\.md|subagent|forgotten chat/);
});

test('contextFor: diacritics fold both ways; the source and project read right', () => {
  const s = seeded();
  for (const q of ['cafe menu', 'café menu', 'CAFÉ']) assert.equal(contextFor(s, { query: q, budgetChars: 3000 }).hits[0].conversationId, 'web:cafe', q);
  assert.match(contextFor(s, { query: 'café', budgetChars: 3000 }).text, /\n- chat "Café menu", 2026-09-20 · Kitchen: B · claude\.ai\n {2}· you: /);
});

test('contextFor: FTS syntax typed into a question never reaches MATCH raw (Review Focus 1)', () => {
  const s = seeded();
  for (const q of ['NEAR("release" plan', 'release OR', '"unbalanced', 'release*', '-release', 'col:release', ')(*&^%$#@!', 'AND OR NOT']) {
    assert.doesNotThrow(() => contextFor(s, { query: q, budgetChars: 2000 }), q);
  }
});

test('contextFor: the budget is never exceeded; a chat comes in with at least one snippet or not at all', () => {
  const s = seeded();
  for (const b of [0, 50, HEADER.length + 59, HEADER.length + 60, 400, 700, 1500, 8000, 20000]) {
    const r = contextFor(s, { query: 'release plan', budgetChars: b });
    assert.ok(r.text.length <= Math.min(b, CONTEXT_MAX), b + ': ' + r.text.length);
    for (const blk of blocks(r.text)) assert.match(blk, /\n {2}· (you|Claude): /, b + ': every chat has a snippet');
    assert.equal(r.cites.length, r.hits.length);
  }
  assert.deepEqual(contextFor(s, { query: 'release', budgetChars: 100 }), { text: '', chars: 0, cites: [], hits: [], words: ['release'], note: 'no room in the context budget' });
});

test('contextFor: no keywords and no match say so, honestly', () => {
  const s = seeded();
  const none = contextFor(s, { query: 'what did the chat say?', budgetChars: 2000 });
  assert.equal(none.note, 'no searchable keywords');
  assert.equal(none.text, HEADER + '\n- the question has no searchable keywords');
  const miss = contextFor(s, { query: 'zebra quantum', budgetChars: 2000 });
  assert.equal(miss.note, 'no past chats matched');
  assert.equal(miss.text, HEADER + '\n- no past chats matched: zebra, quantum');
  assert.deepEqual(miss.cites, []);
});

test('contextFor: no snippet marker or control character reaches the model; masked secrets stay masked', () => {
  const r = contextFor(seeded(), { query: 'rotate key', budgetChars: 3000 });
  assert.ok(!r.text.includes(SNIP_START) && !r.text.includes(SNIP_END));
  assert.doesNotMatch(r.text, /[\u0000-\u0009\u000b-\u001f]/);
  assert.ok(r.text.includes(MASK('stripe-key')), r.text);
});

test('formatContext: at most MAX_CHATS chats, in rank order', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ conversationId: 'c' + i, role: 'user', snippet: 'release ' + i, title: 'Chat ' + i, startedAt: '2026-10-0' + (i + 1) + 'T08:00:00.000Z', source: 'code', projectName: 'project-a' }));
  const r = formatContext(rows, { words: ['release'], budgetChars: 8000 });
  assert.deepEqual(r.hits.map((h) => h.conversationId), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].slice(0, MAX_CHATS));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test dashboard/claude-hub/context.test.mjs`
Expected: FAIL, `Cannot find module …/claude-hub/context.mjs`.

- [ ] **Step 3: Write `context.mjs` and `store.contextHits`**

```js
// dashboard/claude-hub/context.mjs
// Ask grounding from the Claude Hub index (spec 2026-10-13 §6 contextFor, §9 Ask; phase H5).
// An Ask question → a block of snippets from past chats that fits a character budget, for the LOCAL model only.
// Pure apart from store.contextHits(). The index holds only masked text (redact.mjs runs before anything is
// stored) and the FTS snippet() call uses empty markers, so no control marker and no unmasked secret reaches a prompt.
export const CONTEXT_MAX = 8000;   // ceiling on budgetChars
export const MAX_CHATS = 6;        // chats per block
export const PER_CHAT = 2;         // snippets per chat: one long session can't fill the block
export const HITS = 60;            // FTS rows read before grouping
export const HEADER = 'CLAUDE HISTORY (snippets of your past Claude chats from the local index: what was said then, not proof it is still true. Cite a chat you use as "from chat <title>, <date>".)';
const STOP = new Set((
  'the and for with that this what which when where from have has had does did done about into your you are was were will would should could '
  + 'there their them then than just only also more most some such very whats how why who whom can not any all our out get got '
  + 'claude chat chats conversation conversations session sessions said say tell told talk talked '
  + 'dans les des une est pour que qui avec sur pas plus sont mais quoi comment pourquoi quel quelle quels quelles ces cette mes tes ses nous vous ils elles').split(/\s+/));
const SOURCE = { code: 'Claude Code', web: 'claude.ai' };

// the searchable words of a question: runs of letters/digits, lower-cased, ≥ 3 characters, not a stop word, ≤ 8 unique
export function keywords(q) {
  const words = String(q == null ? '' : q).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.filter((w) => [...w].length >= 3 && !STOP.has(w)))].slice(0, 8);
}
// OR, not AND: a question is a sentence ("what did I decide about the release plan"), and ANDing every word finds
// nothing. bm25 sums the per-term scores, so a message that holds more of the words still ranks first. Each term is
// quoted and holds only letters and digits, so the MATCH string is always valid FTS5: no NEAR / OR / * / - from the
// question survives as syntax.
export const contextMatch = (words) => (Array.isArray(words) && words.length ? words.map((w) => '"' + w + '"*').join(' OR ') : null);
// YYYY-MM-DD in local time (the day the owner saw), or 'unknown date'
export const localDay = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-CA') : 'unknown date'; };
// one line: control characters (snippet markers included) and runs of whitespace become one space; ≤ n code points
const flat = (s, n) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cps = [...t];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : t;
};

// rows (store.contextHits, best first) → { text, chars, cites, hits, words, note? }; text.length ≤ the budget, always
export function formatContext(rows, { words = [], budgetChars = 0 } = {}) {
  const budget = Math.max(0, Math.min(CONTEXT_MAX, Math.floor(Number(budgetChars) || 0)));
  const base = { text: '', chars: 0, cites: [], hits: [], words };
  if (budget < HEADER.length + 60) return { ...base, note: 'no room in the context budget' };
  let text = HEADER;
  const push = (line) => { if (text.length + 1 + line.length > budget) return false; text += '\n' + line; return true; };
  const done = (extra) => ({ ...base, ...extra, text, chars: text.length });
  if (!words.length) { push('- the question has no searchable keywords'); return done({ note: 'no searchable keywords' }); }
  const chats = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.conversationId) continue;
    let c = chats.get(r.conversationId);
    if (!c) { if (chats.size >= MAX_CHATS) continue; c = { r, snips: [] }; chats.set(r.conversationId, c); }
    if (c.snips.length < PER_CHAT && flat(r.snippet, 400)) c.snips.push(r);
  }
  const cites = [], hits = [];
  for (const [id, c] of chats) {
    if (!c.snips.length) continue;
    const title = flat(c.r.title, 80) || 'untitled chat';
    const date = localDay(c.r.startedAt || c.r.lastAt || c.r.at);
    const head = '- chat "' + title + '", ' + date + ' · ' + (flat(c.r.projectName, 60) || 'no project') + ' · ' + (SOURCE[c.r.source] || 'Claude');
    const lines = c.snips.map((s) => '  · ' + (s.role === 'user' ? 'you' : 'Claude') + ': ' + flat(s.snippet, 400));
    if (text.length + 1 + head.length + 1 + lines[0].length > budget) break;   // a chat goes in with at least one snippet, or not at all
    push(head);
    for (const l of lines) if (!push(l)) break;
    cites.push('chat ' + title + ', ' + date);
    hits.push({ conversationId: id, title, date, project: c.r.projectName || null, source: c.r.source || null });
  }
  if (!hits.length) {
    if (!chats.size) { push('- no past chats matched: ' + words.join(', ')); return done({ note: 'no past chats matched' }); }
    return done({ note: 'no room in the context budget' });
  }
  return done({ cites, hits });
}

export function contextFor(store, { query = '', budgetChars = 0 } = {}) {
  const words = keywords(query);
  const match = contextMatch(words);
  return formatContext(match ? store.contextHits({ match, limit: HITS }) : [], { words, budgetChars });
}
```

In `dashboard/claude-hub/store.mjs`, inside the object returned by `api(db)`, add this method right after the `search({ q: query, projectId, source, limit = 30 } = {}) { … },` method:

```js
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
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `node --test dashboard/claude-hub/context.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 5: Write the failing protocol tests** (append to `dashboard/claude-hub/hub.test.mjs`; `tmp`, `startHub`, `standInHub`, `makeClaudeHome` and `openStore` are already imported or defined at the top of that file)

```js
test('contextFor over stdio: a question gets cited snippets inside its budget; FTS-hostile text is fine (H5, Review Focus 1)', async () => {
  const dir = tmp('hub-ctx-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, TZ: 'UTC' }, path.join(dir, 'hub.sqlite'));
  try {
    assert.equal((await h.healthy()).counts.conversations, 3);
    const r = await h.req('contextFor', { query: 'What was the placeholder release plan?', budgetChars: 3000 });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.cites.includes('chat Release planning, 2026-10-01'), JSON.stringify(r.result.cites));
    assert.ok(r.result.text.length <= 3000);
    assert.match(r.result.text, /\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n {2}· you: Plan the placeholder release/);
    for (const q of ['NEAR("release" OR *', '"', 'release*)', '']) {
      const x = await h.req('contextFor', { query: q, budgetChars: 3000 });
      assert.equal(x.ok, true, q + ': ' + x.error);
    }
  } finally { await h.stop(); }
});

test('contextFor: no open index → an error, never an empty answer; a broken index → its own error (H5, Review Focus 3)', async () => {
  // a reader still waiting for the owner to create and migrate the index
  const dir = tmp('hub-ctx-noidx-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.writeFileSync(db, '');
  const holder = standInHub(dir, db);
  fs.writeFileSync(db + '.lock', JSON.stringify({ pid: holder.pid, db }));
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await h.ready());
    const r = await h.req('contextFor', { query: 'release', budgetChars: 2000 });
    assert.equal(r.ok, false); assert.match(r.error, /the index is not open yet/);
  } finally { await h.stop(); holder.kill('SIGKILL'); }
  // a writer whose FTS table disappears underneath it
  const dir2 = tmp('hub-ctx-broken-');
  const { home: home2 } = makeClaudeHome(dir2);
  const db2 = path.join(dir2, 'hub.sqlite');
  const w = startHub({ HQ_CLAUDE_HOME: home2 }, db2);
  try {
    assert.equal((await w.healthy()).counts.conversations, 3);
    const other = openStore(db2); other.db.exec('DROP TABLE message_fts'); other.close();
    const r = await w.req('contextFor', { query: 'release', budgetChars: 2000 });
    assert.equal(r.ok, false); assert.match(r.error, /message_fts/);
  } finally { await w.stop(); }
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `node --test --test-name-pattern="contextFor" dashboard/claude-hub/hub.test.mjs`
Expected: FAIL. Both tests get `ok:false, error:'unknown op'`.

- [ ] **Step 7: Add the op to `hub.mjs`**

Add the import after `import { openStore } from './store.mjs';`:

```js
import { contextFor } from './context.mjs';
```

In `const ops = { … }`, add this entry after `search: (a) => (store ? store.search(a) : []),`:

```js
    // H5 Ask grounding (read-only: readers answer it too). No open index is an error, never an empty answer.
    contextFor: (a) => { if (!store) throw new Error('the index is not open yet'); return contextFor(store, a); },
```

`INDEX_VERSION` stays 1: nothing that parses or masks changed.

- [ ] **Step 8: Run the Hub suite to verify everything passes**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS (the H1 tests plus 13 new ones).

- [ ] **Step 9: Commit**

```bash
git add -- dashboard/claude-hub/context.mjs dashboard/claude-hub/context.test.mjs dashboard/claude-hub/store.mjs dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: Claude Hub H5.1 — Hub op contextFor (Ask snippets cited by chat and date, inside a budget; OR of keywords, user/Claude text only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `claude` section in `llm-context.js` (+ the one `main.js` hook, the persona)

**Files:**
- Modify: `dashboard/llm-context.js` (7th `SECTION_IDS` entry, `LABEL.claude`, `CLAUDE_RESERVE`, `claudeSection`, `assemble({claudeHub})`)
- Modify: `dashboard/main.js` (one added line in the `hq:llm:chat` handler's `llmContext.assemble({ … })` call)
- Modify: `dashboard/llm-persona.md` (source list + cite form)
- Modify: `docs/sync/IPC-CONTRACT.md` (row first: `hq:llm:chat` `include.claude`, `sections[].cites`)
- Test: `dashboard/llm-context.test.mjs` (new)

**Interfaces:**
- Consumes:
  - Task 1's Hub op through the host: `claudeHub.request('contextFor', { query, budgetChars }, { timeout: 4000 }) → Promise<ContextResult | { error: 'hub not running' | 'timeout' | 'hub stopped' | string }>` (H1 `claude-hub-host.js` `create().request`, which never rejects).
  - `main.js`'s module variable `claudeHub` (null until `whenReady`, or when the host was never created).
  - `cleanChatReq` already builds `include` from `llmContext.SECTION_IDS` (main.js:811), so `include.claude` arrives with no `main.js` change beyond the hook.
- Produces:
  - `SECTION_IDS = ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude']`. Claude is last, so it is assembled last and its reserve holds.
  - `CLAUDE_RESERVE = 3000` (new, exported). It applies only when `include.claude === true`: every other section then sees `TOTAL_MAX - CLAUDE_RESERVE` as its ceiling.
  - `claudeSection(claudeHub, query, budgetChars) → Promise<{ text: string, cites: string[], note?: string }>` (new, exported). It never throws. Hub notes: `'Claude Hub is not running'` (no host, or `hub not running`), `'Claude Hub stopped while answering'`, `'Claude Hub did not answer within 4 s'`, `'the Claude Hub answered in an unknown shape'`, else the Hub's own error text (≤ 80 chars). A ContextResult `note` passes through (`'no past chats matched'` …).
  - `assemble({ …, claudeHub = null })`. The claude entry of `sections` is `{ id:'claude', label:'Claude history', chars, clipped, cites: string[], note? }`. `cites` is new and additive; the renderer's meta line reads it (Task 3).
  - With `include.claude` not `true`, `assemble` output is byte-identical to the pre-H5 module and the Hub is never asked.

- [ ] **Step 1: Add the IPC-CONTRACT row (before any handler change)**

In `docs/sync/IPC-CONTRACT.md`, insert a new H5 section immediately BEFORE the `## Rules` heading (after the H1 Claude Hub section's prose, and after any H2–H4 sections those phases added there). Write it exactly like this — Task 5 appends its two rows to the second table:

```
## 2026-10-16 — Claude Hub, phase H5 (rows written before the handler lands)

Additive only. Main-side code lives in NEW files (`dashboard/claude-vault.js`) with one-line hooks in `main.js` (rule 2).

### Changed channels (H5)

| Channel | Addition |
|---|---|
| `hq:llm:chat` | (Claude Hub H5) `req.include` gains the 7th key `claude` (boolean, default off). When it is `true`, main asks the Claude Hub op `contextFor({query, budgetChars ≤ 3000})` (4 s timeout) and the answer's `sections` gains `{id:'claude', label:'Claude history', chars, clipped, cites:['chat <title>, <date>', …], note?}`; the other sections then share 9 000 of the 12 000-char budget. A Hub that is missing, down or slow only adds a `note` ("Claude Hub is not running" …); the answer still runs. Unticked = byte-identical context to before |

### Claude Hub — Save to vault (spec 2026-10-13-claude-hub-design.md §7/§9, phase H5)

| Preload | Channel | Shape |
|---|---|---|
```

(The second table's header is written now, empty; Task 5 adds its rows before its handler lands.)

- [ ] **Step 2: Write the failing tests**

```js
// dashboard/llm-context.test.mjs
// The Ask context assembler's Claude history section (Claude Hub H5, spec 2026-10-13 §9 Ask). Temp data dirs and
// temp vaults with placeholder text; the Hub is a recording fake — no real Hub, no real index, no real vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ctx = require('./llm-context.js');
const NOW = new Date('2026-10-05T10:00:00.000Z');

// The module as it was before H5 (commit 49025ed), compiled in memory under a name in dashboard/ so its
// relative require('./browser-bridge') resolves. Nothing is written to disk.
function preH5() {
  const src = execFileSync('git', ['show', '49025ed:dashboard/llm-context.js'], { cwd: HERE, encoding: 'utf8' });
  const file = path.join(HERE, '__pre_h5_llm_context__.js');
  const m = new Module(file, null);
  m.filename = file; m.paths = Module._nodeModulePaths(HERE);
  m._compile(src, file);
  return m.exports;
}
function workspace({ big = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-llmctx-'));
  const n = big ? 200 : 3;
  const S = {
    account: { level: 3, xp: 10, xp_to_next: 5, totals: {} }, scan: { id: 'scan-placeholder' },
    projects: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'project-' + i, activity: { state: 'active', last_commit: '2026-10-01', days_since_commit: i }, metrics: { git_safety: { has_git: true, branch: 'main', dirty: 1 } }, signals: {} })),
    quests: Array.from({ length: n }, (_, i) => ({ id: 'q' + i, status: 'open', tier: 'orange', title: 'Placeholder task ' + i + ' about the release plan', project_id: 'p' + i, age_days: i })),
  };
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(S));
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(path.join(vault, '20_Notes'), { recursive: true });
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(vault, '20_Notes', 'release-' + i + '.md'), 'release plan placeholder '.repeat(200));
  return { dataDir: dir, vaultDir: vault, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// a recording fake of claude-hub-host's request(): answer(args) → the Hub result or {error}
function fakeHub(answer) {
  const calls = [];
  return { calls, request: (op, args, opts) => { calls.push({ op, args, opts }); return Promise.resolve(typeof answer === 'function' ? answer(args) : answer); } };
}
const fill = (args) => {
  const text = ('CLAUDE HISTORY (placeholder)\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n  · you: ' + 'release plan '.repeat(400)).slice(0, args.budgetChars);
  return { text, chars: text.length, cites: ['chat Release planning, 2026-10-01'], hits: [{ conversationId: 'code:rel' }], words: ['release', 'plan'] };
};
const ALL = { scan: true, tasks: true, projects: true, health: false, browser: false, vault: true };

test('SECTION_IDS gains claude as the 7th, last entry; CLAUDE_RESERVE is 3000', () => {
  assert.deepEqual(ctx.SECTION_IDS, ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude']);
  assert.equal(ctx.CLAUDE_RESERVE, 3000);
});

test('unticked: the context is byte-for-byte what it was before H5, and the Hub is never asked (Review Focus 2)', async () => {
  const w = workspace({ big: true });
  try {
    const hub = fakeHub(fill);
    const args = { dataDir: w.dataDir, vaultDir: w.vaultDir, include: ALL, query: 'what is the release plan?', now: NOW };
    const before = await preH5().assemble(args);
    const after = await ctx.assemble({ ...args, include: { ...ALL, claude: false }, claudeHub: hub });
    assert.deepEqual(after, before);
    assert.equal(hub.calls.length, 0);
  } finally { w.cleanup(); }
});

test('ticked on a big workspace: Claude history still gets its 3000 chars and the whole context stays ≤ 12000 (Review Focus 2)', async () => {
  const w = workspace({ big: true });
  try {
    const hub = fakeHub(fill);
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { ...ALL, claude: true }, query: 'what is the release plan?', now: NOW, claudeHub: hub });
    assert.equal(hub.calls.length, 1);
    assert.equal(hub.calls[0].op, 'contextFor');
    assert.deepEqual(hub.calls[0].args, { query: 'what is the release plan?', budgetChars: 3000 });
    assert.deepEqual(hub.calls[0].opts, { timeout: 4000 });
    const c = r.sections.find((s) => s.id === 'claude');
    assert.equal(c.label, 'Claude history');
    assert.equal(c.chars, 3000);
    assert.deepEqual(c.cites, ['chat Release planning, 2026-10-01']);
    assert.ok(r.text.includes('CLAUDE HISTORY (placeholder)'));
    assert.ok(r.chars <= 12000, String(r.chars));
    const others = r.sections.filter((s) => s.id !== 'claude').reduce((a, s) => a + s.chars, 0);
    assert.ok(others > 8000, 'the fixture really is big: ' + others);
    assert.ok(others <= 12000 - 3000, String(others));
  } finally { w.cleanup(); }
});

test('the Hub missing, down, stopped, slow or broken: the answer still runs on the other sources and the note says why (Review Focus 3)', async () => {
  const w = workspace();
  const cases = [
    [null, 'Claude Hub is not running'],
    [fakeHub({ error: 'hub not running' }), 'Claude Hub is not running'],
    [fakeHub({ error: 'hub stopped' }), 'Claude Hub stopped while answering'],
    [fakeHub({ error: 'timeout' }), 'Claude Hub did not answer within 4 s'],
    [fakeHub({ error: 'the index is not open yet' }), 'the index is not open yet'],
    [fakeHub({ error: 'no such table: message_fts' }), 'no such table: message_fts'],
    [{ request: () => Promise.reject(new Error('boom')) }, 'boom'],
  ];
  try {
    for (const [hub, note] of cases) {
      const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { scan: true, tasks: true, claude: true }, query: 'release plan', now: NOW, claudeHub: hub });
      const c = r.sections.find((s) => s.id === 'claude');
      assert.deepEqual(c, { id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note }, note);
      assert.ok(r.sections.find((s) => s.id === 'tasks').chars > 0, note + ': the other sources still answer');
      assert.doesNotMatch(r.text, /CLAUDE HISTORY/);
    }
  } finally { w.cleanup(); }
});

test('the Hub found nothing: its own text goes in (the model hears "no past chats matched") and the note says so', async () => {
  const w = workspace();
  try {
    const text = 'CLAUDE HISTORY (placeholder)\n- no past chats matched: zebra';
    const hub = fakeHub({ text, chars: text.length, cites: [], hits: [], words: ['zebra'], note: 'no past chats matched' });
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { claude: true }, query: 'zebra', now: NOW, claudeHub: hub });
    const c = r.sections.find((s) => s.id === 'claude');
    assert.deepEqual(c, { id: 'claude', label: 'Claude history', chars: text.length, clipped: false, cites: [], note: 'no past chats matched' });
    assert.ok(r.text.endsWith(text));
  } finally { w.cleanup(); }
});

test('claudeSection: never throws; a malformed Hub answer is an honest note, not an empty success', async () => {
  for (const bad of [undefined, null, 42, { text: 7 }, { cites: 'x' }]) {
    const r = await ctx.claudeSection(fakeHub(bad), 'release', 3000);
    assert.equal(r.text, '');
    assert.deepEqual(r.cites, []);
    assert.equal(r.note, 'the Claude Hub answered in an unknown shape');
  }
  const ok = await ctx.claudeSection(fakeHub(fill), 'release', 500);
  assert.equal(ok.text.length, 500);
  assert.deepEqual(ok.cites, ['chat Release planning, 2026-10-01']);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test dashboard/llm-context.test.mjs`
Expected: FAIL. `SECTION_IDS` has 6 entries, `CLAUDE_RESERVE` and `claudeSection` are undefined, and the ticked tests find no `claude` section.

- [ ] **Step 4: Implement the section**

In `dashboard/llm-context.js`:

1. Replace the header comment's last two lines (`// Budgets keep the whole prompt inside …` and `// 4 KB per section, 12 KB total …`) with:

```js
// Budgets keep the whole prompt inside the 8k-token window llm-local asks for:
// 4 KB per section, 12 KB total (~3k tokens) + persona + chat history. When
// "Claude history" is ticked (Claude Hub H5) it is assembled last with
// CLAUDE_RESERVE chars held back for it, so the other sections share 9 KB.
```

2. Replace the `SECTION_IDS` and `LABEL` lines with:

```js
const CLAUDE_RESERVE = 3000;
const CLAUDE_TIMEOUT_MS = 4000;
const SECTION_IDS = ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude'];
const LABEL = { scan: 'scan', tasks: 'tasks', projects: 'projects', health: 'PC health', browser: 'browser', vault: 'vault', claude: 'Claude history' };
```

3. Add, right before the `// ---------------------------------------------------------------- assemble` line:

```js
// Claude history (Claude Hub H5): cited snippets of past chats from the Hub's contextFor op. The Hub runs on system
// Node with node:sqlite; this main process only asks it through claude-hub-host's request(), which never rejects.
// A missing, stopped or slow Hub is a NOTE (shown in Ask's meta line), never an exception and never an empty success.
const HUB_NOTE = {
  'hub not running': 'Claude Hub is not running',
  'hub stopped': 'Claude Hub stopped while answering',
  timeout: 'Claude Hub did not answer within 4 s',
};
async function claudeSection(claudeHub, query, budgetChars) {
  if (!claudeHub || typeof claudeHub.request !== 'function') return { text: '', cites: [], note: HUB_NOTE['hub not running'] };
  let r;
  try { r = await claudeHub.request('contextFor', { query: String(query || ''), budgetChars }, { timeout: CLAUDE_TIMEOUT_MS }); }
  catch (e) { return { text: '', cites: [], note: line(e?.message || e, 80) }; }
  if (r && typeof r.error === 'string') return { text: '', cites: [], note: HUB_NOTE[r.error] || line(r.error, 80) };
  if (!r || typeof r !== 'object' || typeof r.text !== 'string' || !Array.isArray(r.cites)) return { text: '', cites: [], note: 'the Claude Hub answered in an unknown shape' };
  const out = { text: r.text.slice(0, Math.max(0, budgetChars)), cites: r.cites.filter((c) => typeof c === 'string').map((c) => line(c, 120)) };
  if (typeof r.note === 'string' && r.note) out.note = r.note;
  return out;
}

```

4. In `assemble`, change the signature line to:

```js
async function assemble({ dataDir, vaultDir, include = {}, query = '', activity = null, now = new Date(), claudeHub = null } = {}) {
```

5. In `assemble`, replace the whole `const add = (id, body) => { … };` arrow with:

```js
  // Ticking Claude history holds CLAUDE_RESERVE back from every other section (claude is assembled last).
  const reserve = include.claude === true ? CLAUDE_RESERVE : 0;
  const add = (id, body, extra) => {
    let text = body, clipped = false;
    if (text.length > SECTION_MAX) { text = text.slice(0, SECTION_MAX - 16) + '\n…[trimmed]'; clipped = true; }
    const room = TOTAL_MAX - used - (id === 'claude' ? 0 : reserve);
    if (room < 200) { sections.push({ id, label: LABEL[id], chars: 0, clipped: true, note: 'dropped — context budget full', ...(extra ? { cites: [] } : {}) }); return; }
    if (text.length > room) { text = text.slice(0, room - 16) + '\n…[trimmed]'; clipped = true; }
    parts.push(text);
    used += text.length + 2;
    sections.push({ id, label: LABEL[id], chars: text.length, clipped, ...(extra || {}) });
  };
```

6. In the `for (const id of SECTION_IDS)` loop, add as the first statement inside `try {`:

```js
      if (id === 'claude') {
        const c = await claudeSection(claudeHub, query, Math.min(CLAUDE_RESERVE, TOTAL_MAX - used - 2));
        if (!c.text) sections.push({ id, label: LABEL[id], chars: 0, clipped: false, cites: [], ...(c.note ? { note: c.note } : {}) });
        else add(id, c.text, { cites: c.cites, ...(c.note ? { note: c.note } : {}) });
        continue;
      }
```

7. Change the export line to:

```js
module.exports = { assemble, claudeSection, SECTION_IDS, CLAUDE_RESERVE };
```

With `include.claude` unticked, `reserve` is 0, `extra` is never passed and the loop never takes the claude branch, so the output is exactly the pre-H5 output; the byte-for-byte test pins this. The loop's existing `catch` still reports a throw as `failed: …`. `claudeSection` never throws, so for the claude section that catch is only a backstop.

- [ ] **Step 5: Hook `main.js` (one added line) and the persona**

In `dashboard/main.js`, in the `hq:llm:chat` handler, the `llmContext.assemble({` call (around line 839) gains one line after `activity: bridge ? bridge.readActivity() : null,`:

```js
      claudeHub,   // Claude Hub H5: the 'claude' section asks the Hub's contextFor (null-safe)
```

In `dashboard/llm-persona.md`:
- Line 10: change `the sources are Scan, Tasks, Projects, PC health, Browser and Vault` to `the sources are Scan, Tasks, Projects, PC health, Browser, Vault and Claude history`.
- Line 12: change `*"from your vault note <name>"*.` to `*"from your vault note <name>"*, *"from chat <title>, <date>"* (Claude history: what was said in a past chat, not proof it is still true).`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test dashboard/llm-context.test.mjs`
Expected: PASS (6 tests).

Run: `node --check dashboard/main.js`
Expected: no output, exit 0.

Run: `node --test dashboard/*.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- docs/sync/IPC-CONTRACT.md dashboard/llm-context.js dashboard/llm-context.test.mjs dashboard/llm-persona.md dashboard/main.js
git commit -m "fe: Claude Hub H5.2 — Ask context gains the Claude history section (Hub contextFor, 3000-char reserve, Hub-down notes; unticked = unchanged)

main.js: +1 line (claudeHub passed to llmContext.assemble in hq:llm:chat).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: v5 Ask — the seventh chip "Claude history", cited chats in the meta line, `golden-diff.mjs`, scenario `ask-claude-chip`

**Files:**
- Create: `dashboard-v5/tools/golden-diff.mjs`, `dashboard-v5/tools/golden-diff.test.mjs`
- Modify: `dashboard-v5/src/logic/ask-store.mjs` (`SOURCES`, `DEFAULT_INCLUDE`, `V3_SOURCES`, `saveInclude`, `metaLine`, header comment)
- Modify: `dashboard-v5/src/tpl/ov-ask.tpl.js` (chip placeholder count 6 → 7, marker text)
- Modify: `dashboard-v5/tools/fake-preload.js` (`chat` answers a Claude history section when `include.claude`)
- Modify (expectations for the 7th key): `dashboard-v5/src/logic/ask-store.test.mjs`, `src/logic/ask.test.mjs`, `src/logic/review-p3.test.mjs`, `tools/fake-preload.test.mjs`, `tools/cdp-gate.mjs` (`ask-history-v3-compat` expectations + the new scenario `ask-claude-chip`)
- Modify: `dashboard-v5/src/selftest.js` (state `ask-claude`), `src/vals.golden.test.mjs` (scenario `overlay.ask-claude`), `src/__golden__/vals.hashes.json` (re-record), `src/tpl.hash.test.mjs` (re-record by hand)

**Interfaces:**
- Consumes: Task 2's `sections[]` entry `{ id:'claude', label:'Claude history', chars, clipped, cites, note? }` inside `hq.llm.chat`'s answer. `logic/ask.js` already copies `r.sections` into `meta.sections` as they are (ask.js:98), so it needs no change.
- Produces:
  - `SOURCES[6] = { id: 'claude', label: 'Claude history', tip: 'Snippets of your past Claude chats from the local Claude Hub index (read-only)' }`.
  - `DEFAULT_INCLUDE.claude = false`.
  - `V3_SOURCES = ['scan', 'tasks', 'projects', 'health', 'browser', 'vault']` (new export).
  - `normInclude(o) → {7 booleans}` (unchanged code; it now covers 7 keys).
  - `saveInclude(storage, include) → {7 booleans}`. It **writes** v3's six keys in v3's order, plus `"claude":true` only when the chip is on. So with the chip off, the stored string is byte-identical to v3's. A v3 rollback rewrites the object without `claude`, and v5 then reads it as off (spec §9).
  - `metaLine(meta)` gains one part after the section notes: `'from ' + cites.slice(0, 3).join('; ') + (n > 3 ? ' (+' + (n - 3) + ' more)' : '')`. The cites come from the `claude` section when its `chars > 0`.
  - `dashboard-v5/tools/golden-diff.mjs` (new):
    - `diffPaths(a, b) → string[]`, with paths like `askSources[6]` or `asks[0].meta`.
    - `compareDirs(beforeDir, afterDir, allow: RegExp[]) → { changed: {[scenario]: string[]}, added: string[], removed: string[], unexplained: {[scenario]: string[]} }`.
    - CLI: `node dashboard-v5/tools/golden-diff.mjs <before> <after> --allow <regex> …`. It exits 0 only when nothing is unexplained or removed.
  - Fake `llm.chat`: when `req.include.claude === true`, its final answer is `'Fake answer from the fake model, from chat Fake release planning, 2026-10-01.'`, and its `sections` gains `{ id:'claude', label:'Claude history', chars: 420, clipped:false, cites:['chat Fake release planning, 2026-10-01'] }`.
  - CDP scenario `ask-claude-chip` (spec §11).

- [ ] **Step 1: Dump the goldens BEFORE any change (PowerShell)**

```powershell
$B = Join-Path $env:TEMP 'hq-h5-golden-before-t3'; Remove-Item -LiteralPath $B -Recurse -Force -ErrorAction SilentlyContinue
$env:GOLDEN_DUMP = $B; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
```

Expected: PASS, and `$B` holds one `<scenario>.json` per scenario.

- [ ] **Step 2: Write the failing tests**

`dashboard-v5/tools/golden-diff.test.mjs` (new):

```js
// golden-diff: a golden re-record is allowed only when every changed value path is attributed (Claude Hub H5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffPaths, compareDirs } from './golden-diff.mjs';

test('diffPaths: names every changed leaf, added and removed keys and array slots', () => {
  assert.deepEqual(diffPaths({ a: 1, b: [1, 2], c: { d: 'x' } }, { a: 1, b: [1, 2, 3], c: { d: 'y' }, e: true }), ['b[2]', 'c.d', 'e']);
  assert.deepEqual(diffPaths([1], { 0: 1 }), ['(root)']);
  assert.deepEqual(diffPaths({ a: null }, { a: {} }), ['a']);
  assert.deepEqual(diffPaths({ x: [{ y: 1 }] }, { x: [{ y: 1 }] }), []);
});

test('compareDirs: unexplained paths, added and removed scenarios', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gdiff-'));
  try {
    const b = path.join(root, 'b'), a = path.join(root, 'a');
    fs.mkdirSync(b); fs.mkdirSync(a);
    const w = (d, n, v) => fs.writeFileSync(path.join(d, n + '.json'), JSON.stringify(v));
    w(b, 's1', { askSources: [1] }); w(a, 's1', { askSources: [1, 2] });
    w(b, 's2', { x: 1 }); w(a, 's2', { x: 2 });
    w(b, 'gone', {}); w(a, 'new', {});
    const r = compareDirs(b, a, [/^askSources\[\d+\]$/]);
    assert.deepEqual(r.changed, { s1: ['askSources[1]'], s2: ['x'] });
    assert.deepEqual(r.unexplained, { s2: ['x'] });
    assert.deepEqual(r.added, ['new']);
    assert.deepEqual(r.removed, ['gone']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
```

In `dashboard-v5/src/logic/ask-store.test.mjs`, replace the body of `test('sources: v3 format, defaults for anything that is not a boolean', …)` with:

```js
  assert.deepEqual(AS.loadInclude(memStorage()), AS.DEFAULT_INCLUDE);
  const st = memStorage({ [AS.LS_INCLUDE]: JSON.stringify({ scan: false, tasks: 'yes', vault: true, extra: true }) });
  assert.deepEqual(AS.loadInclude(st), { scan: false, tasks: true, projects: true, health: false, browser: false, vault: true, claude: false });
  assert.deepEqual(AS.loadInclude(memStorage({ [AS.LS_INCLUDE]: '[1,2]' })), AS.DEFAULT_INCLUDE);
  AS.saveInclude(st, { scan: true, health: true });
  // v3 writes the object loadInclude built: every v3 source, in SOURCES order — Claude history off adds nothing
  assert.equal(st.getItem(AS.LS_INCLUDE), '{"scan":true,"tasks":true,"projects":true,"health":true,"browser":false,"vault":false}');
  assert.deepEqual(AS.SOURCES.map((s) => s.id), ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude']);
  assert.deepEqual(AS.V3_SOURCES, ['scan', 'tasks', 'projects', 'health', 'browser', 'vault']);
  assert.equal(AS.SOURCES.find((s) => s.id === 'health').tip, 'The SYSTEM tab\'s vitals');
```

and append:

```js
test('Claude history: the 7th chip is off by default, stored as the extra key claude only when on; a v3 rewrite turns it off (spec §9)', () => {
  assert.equal(AS.DEFAULT_INCLUDE.claude, false);
  assert.deepEqual(AS.SOURCES[6], { id: 'claude', label: 'Claude history', tip: 'Snippets of your past Claude chats from the local Claude Hub index (read-only)' });
  const st = memStorage();
  const on = AS.saveInclude(st, { ...AS.DEFAULT_INCLUDE, claude: true });
  assert.equal(on.claude, true);
  assert.equal(st.getItem(AS.LS_INCLUDE), '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false,"claude":true}');
  assert.equal(AS.loadInclude(st).claude, true);
  // what v3 writes after a rollback: its six keys only
  st.setItem(AS.LS_INCLUDE, '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false}');
  assert.equal(AS.loadInclude(st).claude, false);
  assert.equal(AS.loadInclude(memStorage({ [AS.LS_INCLUDE]: '{"claude":"yes"}' })).claude, false);
});

test('meta line names the chats Claude history drew from (≤ 3, then "+N more"); a Hub note shows like any note', () => {
  const cites = ['chat Release planning, 2026-10-01', 'chat Café menu, 2026-09-20', 'chat Key rotation, 2026-09-03', 'chat Old, 2026-01-01'];
  const sec = (extra) => [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }, { id: 'claude', label: 'Claude history', chars: 2400, clipped: false, cites: cites.slice(0, 2), ...extra }];
  assert.equal(AS.metaLine({ status: 'done', sections: sec(), ms: 1400 }), 'grounded in Scan · Claude history · from chat Release planning, 2026-10-01; chat Café menu, 2026-09-20 · 1.4s');
  assert.equal(AS.metaLine({ status: 'done', sections: sec({ cites }), ms: 1400 }), 'grounded in Scan · Claude history · from chat Release planning, 2026-10-01; chat Café menu, 2026-09-20; chat Key rotation, 2026-09-03 (+1 more) · 1.4s');
  assert.equal(AS.metaLine({ status: 'done', sections: [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }, { id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note: 'Claude Hub is not running' }], ms: 1400 }),
    'grounded in Scan · Claude history: Claude Hub is not running · 1.4s');
  assert.equal(AS.metaLine({ status: 'done', sections: [{ id: 'claude', label: 'Claude history', chars: 0, cites: 'bad' }], ms: 100 }), 'no sources ticked · 0.1s');
});
```

In `dashboard-v5/src/logic/ask.test.mjs`:
- In `test('meta line follows v3 metaNode', …)`, change the expected `s.askInclude` to `{ scan: false, tasks: true, projects: true, health: true, browser: false, vault: false, claude: false }`.
- In `test('source chips toggle, …')`, change the first expectation to `[['Scan', true], ['Tasks', true], ['Projects', true], ['PC health', false], ['Browser', false], ['Vault', false], ['Claude history', false]]`.
- In the same test, the `f.called('llm.chat')[0][0].include` expectation (ask.test.mjs:97) becomes `{ scan: false, tasks: true, projects: true, health: false, browser: false, vault: true, claude: false }`. The chip is sent as a boolean, even when off.

In `dashboard-v5/src/logic/review-p3.test.mjs` (`K-1 / K-3` test): change the expected `c.state.askInclude` to `{ scan: false, tasks: true, projects: true, health: true, browser: false, vault: false, claude: false }`.

In `dashboard-v5/tools/fake-preload.test.mjs`, append:

```js
test('llm.chat: with include.claude the fake answers a Claude history section and a cited chat (H5)', async () => {
  const { hq } = createFake();
  const plain = await hq.llm.chat({ jobId: 'or-a', messages: [{ role: 'user', content: 'q' }], include: { scan: true } });
  assert.equal(plain.output, 'Fake answer from the fake model.');
  assert.equal(plain.sections.some((s) => s.id === 'claude'), false);
  const r = await hq.llm.chat({ jobId: 'or-b', messages: [{ role: 'user', content: 'q' }], include: { scan: true, claude: true } });
  assert.equal(r.output, 'Fake answer from the fake model, from chat Fake release planning, 2026-10-01.');
  assert.deepEqual(r.sections.find((s) => s.id === 'claude'), { id: 'claude', label: 'Claude history', chars: 420, clipped: false, cites: ['chat Fake release planning, 2026-10-01'] });
});
```

(`createFake` is already imported at the top of that file.)

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test dashboard-v5/tools/golden-diff.test.mjs dashboard-v5/src/logic/ask-store.test.mjs dashboard-v5/src/logic/ask.test.mjs dashboard-v5/src/logic/review-p3.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: FAIL. `golden-diff.mjs` is not found, `SOURCES` has 6 entries, `V3_SOURCES` is undefined, there is no `from chat …` part in the meta line, and the fake has no claude section.

- [ ] **Step 4: Implement**

`dashboard-v5/tools/golden-diff.mjs`:

```js
// dashboard-v5/tools/golden-diff.mjs — attribute a golden change before re-recording it (Claude Hub H5).
//   node dashboard-v5/tools/golden-diff.mjs <beforeDir> <afterDir> [--allow <regex>]…
// The dirs are two GOLDEN_DUMP runs of src/vals.golden.test.mjs (one <scenario>.json each, outside the repo).
// Prints every changed value path per scenario, plus added and removed scenarios. Exit 0 only when every changed
// path matches an --allow regex and no scenario was removed; 1 otherwise; 2 on bad usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
export function diffPaths(a, b, at = '', out = []) {
  const ka = kind(a), kb = kind(b);
  if (ka !== kb || (ka !== 'object' && ka !== 'array')) { if (a !== b) out.push(at || '(root)'); return out; }
  if (ka === 'array') {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = at + '[' + i + ']';
      if (i >= a.length || i >= b.length) out.push(p); else diffPaths(a[i], b[i], p, out);
    }
    return out;
  }
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const p = at ? at + '.' + k : k;
    if (!(k in a) || !(k in b)) out.push(p); else diffPaths(a[k], b[k], p, out);
  }
  return out;
}
const names = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const load = (dir, n) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
export function compareDirs(before, after, allow = []) {
  const b = names(before), a = names(after);
  const changed = {}, unexplained = {};
  for (const n of b.filter((x) => a.includes(x))) {
    const ps = diffPaths(load(before, n), load(after, n));
    if (!ps.length) continue;
    changed[n] = ps;
    const bad = ps.filter((p) => !allow.some((re) => re.test(p)));
    if (bad.length) unexplained[n] = bad;
  }
  return { changed, unexplained, added: a.filter((x) => !b.includes(x)), removed: b.filter((x) => !a.includes(x)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), allow = [], dirs = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--allow') allow.push(new RegExp(args[++i])); else dirs.push(args[i]); }
  if (dirs.length !== 2) { console.error('usage: golden-diff.mjs <beforeDir> <afterDir> [--allow <regex>]…'); process.exit(2); }
  const r = compareDirs(dirs[0], dirs[1], allow);
  for (const [n, ps] of Object.entries(r.changed)) console.log((r.unexplained[n] ? 'UNEXPLAINED ' : 'changed     ') + n + ': ' + ps.slice(0, 12).join(', ') + (ps.length > 12 ? ' …(+' + (ps.length - 12) + ')' : ''));
  for (const n of r.added) console.log('added       ' + n);
  for (const n of r.removed) console.log('REMOVED     ' + n);
  const ok = !Object.keys(r.unexplained).length && !r.removed.length;
  console.log(ok ? 'golden-diff: every change is attributed' : 'golden-diff: unattributed changes — do NOT re-record');
  process.exit(ok ? 0 : 1);
}
```

In `dashboard-v5/src/logic/ask-store.mjs`:

1. In the header comment, replace the `hq-oracle-include` line pair with:

```js
//   hq-oracle-include  {"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false}
//                      a value that isn't a boolean falls back to its default. Claude Hub H5 adds the 7th chip
//                      as the extra key "claude", written ONLY while it is on: off, the string is v3's byte for
//                      byte; v3 rewrites the object with its six keys on its next save, which v5 reads as off.
```

2. Replace `SOURCES` and `DEFAULT_INCLUDE` with:

```js
// v3's chips, in v3's order, with v3's tooltips — then v5's Claude history (Claude Hub H5, spec 2026-10-13 §9)
export const SOURCES = [
  { id: 'scan', label: 'Scan', tip: 'Level, XP, health index and today\'s suggested picks' },
  { id: 'tasks', label: 'Tasks', tip: 'Open tasks and flagged risks' },
  { id: 'projects', label: 'Projects', tip: 'Git, build, tests and activity for each project' },
  { id: 'health', label: 'PC health', tip: 'The SYSTEM tab\'s vitals' },
  { id: 'browser', label: 'Browser', tip: 'Focus time by site, from the Bridge extension' },
  { id: 'vault', label: 'Vault', tip: 'Keyword search of your VEEMO CORTEX notes (read-only)' },
  { id: 'claude', label: 'Claude history', tip: 'Snippets of your past Claude chats from the local Claude Hub index (read-only)' },
];
export const V3_SOURCES = ['scan', 'tasks', 'projects', 'health', 'browser', 'vault'];
export const DEFAULT_INCLUDE = { scan: true, tasks: true, projects: true, health: false, browser: false, vault: false, claude: false };
```

3. Replace `saveInclude` with:

```js
// writes v3's six keys in v3's order; "claude" only while it is on (see the header)
export function saveInclude(storage, include) {
  const out = normInclude(include);
  const stored = {};
  for (const id of V3_SOURCES) stored[id] = out[id];
  if (out.claude) stored.claude = true;
  write(storage, LS_INCLUDE, stored);
  return out;
}
```

4. In `metaLine`, add after the `const notes = …` line:

```js
  // Claude history (H5): name the chats the answer could draw from, as the model was told to cite them
  const claude = (secs || []).find((s) => s.id === 'claude' && s.chars > 0 && Array.isArray(s.cites));
  const cites = claude ? claude.cites.filter((c) => typeof c === 'string' && c) : [];
```

and, after `if (notes.length) parts.push(notes.join('; '));`:

```js
  if (cites.length) parts.push('from ' + cites.slice(0, 3).join('; ') + (cites.length > 3 ? ' (+' + (cites.length - 3) + ' more)' : ''));
```

In `dashboard-v5/src/tpl/ov-ask.tpl.js`, change the marker and the count on the chips line:
- `<!-- v5: v3's "Answer from" source chips (stored in hq-oracle-include, sent with every question) -->` → `<!-- v5: v3's "Answer from" source chips (stored in hq-oracle-include, sent with every question) + H5's 7th chip, Claude history -->`
- `hint-placeholder-count="6"` → `hint-placeholder-count="7"` (on the `askSources` `sc-for` only).

In `dashboard-v5/tools/fake-preload.js`, in `const chat = (req) => …`, replace the `parts` declaration and the `resolve(…)` line:

```js
    const claude = !!(req && req.include && req.include.claude === true);   // H5: a Claude history section, cited
    const jobId = req && req.jobId, parts = ['Fake', 'Fake answer', claude ? 'Fake answer from the fake model, from chat Fake release planning, 2026-10-01.' : 'Fake answer from the fake model.'];
```

```js
        const sections = [{ label: 'Scan', chars: 10 }].concat(claude ? [{ id: 'claude', label: 'Claude history', chars: 420, clipped: false, cites: ['chat Fake release planning, 2026-10-01'] }] : []);
        resolve({ status: 'done', output: text, sections, model: 'fake-model', ms: 300 });
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `node --test dashboard-v5/tools/golden-diff.test.mjs dashboard-v5/src/logic/ask-store.test.mjs dashboard-v5/src/logic/ask.test.mjs dashboard-v5/src/logic/review-p3.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: PASS.

- [ ] **Step 6: Selftest state, golden scenario, CDP scenario**

In `dashboard-v5/src/selftest.js`, after the `ASK_SEC` line, add:

```js
// H5: an answer grounded in Claude history (cited chats in the meta line) and one where the Hub was down
const ASK_CLAUDE = [
  { q: 'selftest claude', id: 'selftest-claude', a: { text: 'From chat Selftest planning, 2026-10-01: ship on Friday.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 1800, clipped: false, cites: ['chat Selftest planning, 2026-10-01'] }]), ms: 1400, model: 'selftest-model' }, est: true } },
  { q: 'selftest claude down', id: 'selftest-claude-down', a: { text: 'Not in what I can see.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note: 'Claude Hub is not running' }]), ms: 900, model: 'selftest-model' }, est: true } },
];
```

and in `STATES`, after the `ask-offline-checking` row:

```js
        ['ask-claude', at('home'), { askOpen: true, askHistory: ASK_CLAUDE }],   // askInclude is not a CLEAR key: leave the chips alone
```

In `dashboard-v5/src/vals.golden.test.mjs`, after the `add('overlay.ask-no-chat-model', …)` line:

```js
// Claude Hub H5: the 7th chip on, an answer citing a chat, and a Hub-down note
const ASK_CLAUDE = [
  { q: 'What did we decide about the release?', id: 'c1', a: { text: 'From chat Release planning, 2026-10-01: Friday.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 2400, clipped: false, cites: ['chat Release planning, 2026-10-01', 'chat Café menu, 2026-09-20'] }]), ms: 1500, model: 'placeholder-model' }, est: true } },
  { q: 'And the menu?', id: 'c2', a: { text: 'Not in what I can see.', status: 'done', meta: { status: 'done', sections: [{ id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note: 'Claude Hub is not running' }], ms: 700, model: 'placeholder-model' }, est: true } },
];
add('overlay.ask-claude', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: 'placeholder-model' }; }, state: { askOpen: true, askHistory: ASK_CLAUDE, askInclude: { scan: true, tasks: true, projects: true, health: false, browser: false, vault: false, claude: true } } });
```

In `dashboard-v5/tools/cdp-gate.mjs`:
- In `ask-history-v3-compat`:
  - The `s.inc` expectation becomes `'{"scan":false,"tasks":true,"projects":true,"health":true,"browser":false,"vault":false,"claude":false}'`.
  - The chips expectation becomes `'false,true,true,true,false,false,false'`, in both the `if` and its message.
  - The `hq-oracle-include` write check after the double toggle stays as it is: with the chip off, v5 writes v3's string.
- Add `ask-claude-chip` to the header comment's scenario list. Then add this scenario before the closing `};` of `SCENARIOS`:

```js
  // H5 (spec §9 Ask, §11 ask-claude-chip): the 7th chip is off by default, is sent as include.claude, persists as the
  // extra key "claude" only while on, and the answer's meta line names the chat it drew from.
  async 'ask-claude-chip'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    try {
      await t.evaluate(`(() => { localStorage.removeItem('hq-oracle-include'); localStorage.removeItem('hq-oracle-chat');
        WHQ.app.logic.setState({ askInclude: null, askHistory: [], askOpen: true }); return true; })()`);
      await t.sleep(150);
      const chips = () => t.evaluate(`(() => { const a = document.querySelector('aside[aria-label="Ask"]'); if (!a) return null;
        return [...a.querySelectorAll('[aria-label="Context sources"] button')].map((b) => b.textContent.trim() + '=' + b.getAttribute('aria-pressed')); })()`);
      const c0 = await chips();
      if (!c0) return ['the Ask panel did not open'];
      if (c0.length !== 7 || c0[6] !== 'Claude history=false') out.push('chips ' + JSON.stringify(c0) + ', want 7 with "Claude history" off last');
      await t.evaluate(`(() => { const a = document.querySelector('aside[aria-label="Ask"]'); [...a.querySelectorAll('[aria-label="Context sources"] button')][6].click(); return true; })()`);
      await t.sleep(100);
      const inc = await t.evaluate(`localStorage.getItem('hq-oracle-include')`);
      if (inc !== '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false,"claude":true}') out.push('stored include ' + inc);
      if ((await chips())[6] !== 'Claude history=true') out.push('the chip did not show as on');
      await t.evaluate(`(() => { WHQ.app.logic.submitAsk('What did we decide about the placeholder release?'); return true; })()`);
      if (!await t.waitFor(`(() => { const h = WHQ.app.logic.state.askHistory; return h.length && h[h.length - 1].a.status === 'done'; })()`, 5000)) out.push('the answer never settled');
      const sent = await t.evaluate(`hqFake.calls('llm.chat').map((c) => c.args[0].include)`);
      if (!sent.length || sent[sent.length - 1].claude !== true) out.push('llm.chat was not sent include.claude: ' + JSON.stringify(sent));
      await t.sleep(150);
      const spans = await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Ask"] span')].map((x) => x.textContent.trim())`);
      if (!spans.some((x) => x.includes('Claude history · from chat Fake release planning, 2026-10-01'))) out.push('no meta line naming "chat Fake release planning, 2026-10-01": ' + JSON.stringify(spans.filter((x) => x.includes('grounded'))));
      // off again: the stored string is v3's own, byte for byte
      await t.evaluate(`(() => { WHQ.app.logic.toggleAskSource('claude'); return true; })()`);
      const off = await t.evaluate(`localStorage.getItem('hq-oracle-include')`);
      if (off !== '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false}') out.push('chip off stored ' + off + ', want v3’s six keys');
    } finally {
      await t.evaluate(`(() => { localStorage.removeItem('hq-oracle-include'); localStorage.removeItem('hq-oracle-chat'); WHQ.app.logic.setState({ askOpen: false, askHistory: [], askInclude: null }); return true; })()`).catch(() => {});
    }
    return out.concat(t.errors());
  },
```

- [ ] **Step 7: Attribute the golden change, then re-record (PowerShell)**

```powershell
$B = Join-Path $env:TEMP 'hq-h5-golden-before-t3'; $A = Join-Path $env:TEMP 'hq-h5-golden-after-t3'; Remove-Item -LiteralPath $A -Recurse -Force -ErrorAction SilentlyContinue
$env:GOLDEN_DUMP = $A; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
node dashboard-v5/tools/golden-diff.mjs $B $A --allow '^askSources\[6\]$'
```

Expected:
- The golden run FAILS: every scenario's hash changed, and `overlay.ask-claude` is not in the hashes file.
- golden-diff prints `changed … : askSources[6]` for every scenario, then `added overlay.ask-claude`, then `golden-diff: every change is attributed`, and exits 0.
- If it prints `UNEXPLAINED`, stop and fix the code. Do not widen `--allow`.

Then re-record:

```powershell
$env:UPDATE_GOLDEN = '1'; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:UPDATE_GOLDEN
node --test dashboard-v5/src/vals.golden.test.mjs
Remove-Item -LiteralPath $B, $A -Recurse -Force
```

Expected: the second run PASSES.

Re-record `src/tpl.hash.test.mjs` by hand. Print the new numbers:

```powershell
node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import { createHash } from 'node:crypto'; console.log(t.length, Buffer.byteLength(t, 'utf8'), createHash('sha256').update(t).digest('hex'))"
```

Put the three printed values in `LENGTH`, `UTF8_BYTES` and `SHA256`. Then append a history line to the comment block: `// 2026-10-16 H5 Ask: chip placeholder count 6 → 7 + marker text (+<Δ> chars / +<Δ> bytes)`, with the two deltas computed from the old and new constants.

Run: `node --test dashboard-v5/src/tpl.hash.test.mjs`
Expected: PASS.

- [ ] **Step 8: Full v5 suites, selftest, CDP gate (PowerShell, from the repo root)**

```powershell
node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs
Push-Location dashboard-v5; $env:HQ_V5_PROFILE = 'h5-t3-selftest'; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest; "exit $LASTEXITCODE"; Remove-Item Env:HQ_V5_PROFILE; Pop-Location
```

Expected: every suite PASSES. The selftest prints `[selftest] {…}` with `errors: 0, unresolved: 0, failures: 0`, then `exit 0`.

The CDP gate runs against the fake harness on port 9351:

```powershell
Push-Location dashboard-v5; $env:HQ_V5_PROFILE = 'h5-t3-gate'
$p = Start-Process -PassThru -FilePath ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9351'
node tools/cdp-gate.mjs --port 9351 --scenario ask-claude-chip,ask-history-v3-compat,ask-stream,ask-stop-retry,fake-parity,boot; "exit $LASTEXITCODE"
Stop-Process -Id $p.Id; Remove-Item Env:HQ_V5_PROFILE; Pop-Location
```

Expected: `PASS` for each scenario, and `exit 0`. Stop only `$p.Id`, the harness this step started.

- [ ] **Step 9: Commit**

```bash
git add -- dashboard-v5/tools/golden-diff.mjs dashboard-v5/tools/golden-diff.test.mjs dashboard-v5/src/logic/ask-store.mjs dashboard-v5/src/logic/ask-store.test.mjs dashboard-v5/src/logic/ask.test.mjs dashboard-v5/src/logic/review-p3.test.mjs dashboard-v5/src/tpl/ov-ask.tpl.js dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs dashboard-v5/tools/cdp-gate.mjs dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/src/tpl.hash.test.mjs
git commit -m "fe: Claude Hub H5.3 — Ask's 7th chip Claude history (extra key claude, written only while on), cited chats in the meta line, golden-diff, scenario ask-claude-chip

Goldens re-recorded: every scenario changed only at askSources[6] (golden-diff, attributed); overlay.ask-claude added. tpl hash: chip count 6 -> 7 + marker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `claude-vault.js`, part 1: names, paths, the draft prompt, the note text, the atomic write

**Files:**
- Create: `dashboard/claude-vault.js` (CommonJS, main process, Node 20; no `node:sqlite`)
- Test: `dashboard/claude-vault.test.mjs` (new)

**Interfaces:**
- Consumes:
  - H1 Hub row shapes, as `getConversation` returns them. The conversation is `{ id, source: 'code'|'web', title, started_at, last_at, project_id }` (`SELECT * FROM conversation`; no `hq_project_id` — that is on the `listProjects` row). Messages are `[{ role, text, is_sidechain, at }]`.
  - `main.js`'s project-note naming rule `safeFile` (main.js:80), copied here as `projectNoteName` so the link matches the note that `main.js` writes.
- Produces (all new; `module.exports`):
  - `CLAUDE_DIR = ['30_Areas', 'Claude']`, `NAME_MAX = 60`, `NOTE_MAX = 200000`.
  - `safeSegment(name, fallback = 'untitled') → string`. The result is safe as a Windows file or folder name and inside an Obsidian `[[link]]`, ≤ 60 code points, and idempotent.
  - `projectNoteName(name) → string`, the same rule as `main.js` `safeFile`.
  - `noteDay(conversation, now = new Date()) → 'YYYY-MM-DD'`: the local day of `started_at`, else of `last_at`, else of `now`.
  - `planNote({ conversation, projectName, hqProjectName = null, now }) → { folder, title, day, link, rel }`, where `rel` is `'30_Areas/Claude/<folder>/<day> <title>.md'`.
  - `frontConversation(text) → string|null`: the `conversation:` value in a note's frontmatter.
  - `noteConversation(file) → Promise<string|null|undefined>`: `undefined` when there is no file. It reads only the first 4 KiB.
  - `choosePath(vaultDir, rel, conversationId) → Promise<{ rel, exists }>`. It returns this chat's own note (`exists: true`), else the first free name of `rel`, ` (2)` … ` (9)`. It throws when all nine belong to other chats.
  - `resolveSavePath(vaultDir, p) → Promise<string>`. `p` may be absolute or vault-relative, with `\` or `/`. The answer is the real absolute path of `<vault>/30_Areas/Claude/<folder>/<file>.md`, and the folder is created if needed. It throws for anything else: `..`, another folder, a deeper or shallower path, a name `safeSegment` would change, not `.md`, a junction or symlink leading out, or a missing vault.
  - `writeNoteAtomic(file, text, { replace = false, ops = { link, rename }, waits = [100, 300, 900] }) → Promise<void>`.
    - It writes and fsyncs a temp file in the same folder.
    - New note: it hard-links the temp file into place. The link fails with `EEXIST` if a note appeared meanwhile, so it never overwrites; it then throws an `Error` with `.exists = true`.
    - Replace: it renames over the note, retrying EBUSY / EPERM / EACCES at the given waits. If the last try fails, it throws an `Error` with `.busy = true`.
    - The temp file is always removed. A failed write leaves the existing note byte-identical.
  - `DRAFT_SYSTEM: string` and `draftPrompt(conversation, messages, { maxChars = 12000 }) → { system, prompt, basis }`.
    - Only user and assistant text from non-sidechain messages goes in.
    - It keeps the first 2 messages and as many of the last as fit, with a `[… N messages left out …]` marker between them.
    - `basis` is the number of messages it kept.
  - `noteText({ conversation, plan, draft, model, basis, created }) → string`.
    - The frontmatter holds `source`, `conversation`, `project: "[[<link>]]"`, `created`, `chat_date`, `title`, `drafted_by` and `tags`.
    - The body is `# <title>`, a project wikilink line, then the draft, with any frontmatter the model wrote removed.

- [ ] **Step 1: Write the failing tests**

```js
// dashboard/claude-vault.test.mjs
// Save to vault (Claude Hub H5, spec 2026-10-13 §7 claudeVault, §9 Vault). Every test writes into a fresh mkdtemp
// "vault"; the owner's VEEMO CORTEX is never touched. Placeholder titles and projects only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.TZ = 'UTC';
const require = createRequire(import.meta.url);
const V = require('./claude-vault.js');
const tmpVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vault-'));
const tmps = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
const conv = (extra = {}) => ({ id: 'code:s-1', source: 'code', title: 'Release planning', started_at: '2026-10-01T23:30:00.000Z', last_at: '2026-10-02T09:00:00.000Z', project_id: 'code:p-a', ...extra });
const put = (vault, rel, text) => { const f = path.join(vault, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const noteFor = (id) => '---\nsource: claude-code\nconversation: ' + JSON.stringify(id) + '\n---\n# x\n';

test('safeSegment: names hostile to Windows or Obsidian become safe, short and stable (Review Focus 4)', () => {
  const cases = [
    ['Plan: v2 / v3?', 'Plan- v2 - v3-'],
    ['a\\b*c"d<e>f|g', 'a-b-c-d-e-f-g'],
    ['[[link]] #tag ^block', '--link-- -tag -block'],
    ['CON', '_CON'], ['nul.txt', '_nul.txt'], ['com1', '_com1'],
    ['trailing dots...', 'trailing dots'], ['.hidden', 'hidden'], ['  spaced\tout\n', 'spaced out'],
    ['', 'untitled'], [null, 'untitled'], ['...', 'untitled'],
    ['Café ☕ menu 🚀', 'Café ☕ menu 🚀'],
  ];
  for (const [inp, want] of cases) assert.equal(V.safeSegment(inp), want, JSON.stringify(inp));
  const long = V.safeSegment('x'.repeat(300));
  assert.equal([...long].length, V.NAME_MAX);
  const emoji = V.safeSegment('🚀'.repeat(100));
  assert.equal([...emoji].length, V.NAME_MAX); assert.ok(emoji.endsWith('🚀'), 'cut on a code point: no broken surrogate');
  for (const [inp] of cases) assert.equal(V.safeSegment(V.safeSegment(inp)), V.safeSegment(inp), 'idempotent: ' + JSON.stringify(inp));
  assert.equal(V.safeSegment('', 'No project'), 'No project');
});

test('projectNoteName matches main.js safeFile', () => {
  assert.equal(V.projectNoteName('Kitchen: B'), 'Kitchen- B');
  assert.equal(V.projectNoteName(''), 'project');
});

test('planNote: 30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md, the chat’s start day, the project link', () => {
  const p = V.planNote({ conversation: conv(), projectName: 'project-a', now: new Date('2026-10-16T10:00:00Z') });
  assert.deepEqual(p, { folder: 'project-a', title: 'Release planning', day: '2026-10-01', link: 'project-a', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md' });
  assert.equal(V.planNote({ conversation: conv({ started_at: null }), projectName: 'project-a' }).day, '2026-10-02');
  assert.equal(V.planNote({ conversation: conv({ started_at: 'x', last_at: null }), projectName: null, now: new Date('2026-10-16T10:00:00Z') }).day, '2026-10-16');
  const hostile = V.planNote({ conversation: conv({ title: 'What: next? [[x]]' }), projectName: 'Kitchen: B', hqProjectName: 'Kitchen: B' });
  assert.equal(hostile.rel, '30_Areas/Claude/Kitchen- B/2026-10-01 What- next- --x--.md');
  assert.equal(hostile.link, 'Kitchen- B');
  assert.equal(V.planNote({ conversation: conv({ title: null }), projectName: null }).rel, '30_Areas/Claude/No project/2026-10-01 Untitled chat.md');
});

test('choosePath: this chat’s own note is offered for Replace; another chat’s note is never — it gets " (2)" (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const rel = '30_Areas/Claude/project-a/2026-10-01 Release planning.md';
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-1'), { rel, exists: false });
    put(vault, rel, noteFor('code:s-1'));
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-1'), { rel, exists: true });
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-2'), { rel: rel.replace('.md', ' (2).md'), exists: false });
    put(vault, rel.replace('.md', ' (2).md'), noteFor('code:s-2'));
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-2'), { rel: rel.replace('.md', ' (2).md'), exists: true });
    put(vault, '30_Areas/Claude/project-a/2026-10-01 Hand.md', '# a note the owner wrote, no frontmatter\n');
    assert.deepEqual(await V.choosePath(vault, '30_Areas/Claude/project-a/2026-10-01 Hand.md', 'code:s-1'), { rel: '30_Areas/Claude/project-a/2026-10-01 Hand (2).md', exists: false });
    for (let i = 3; i <= 9; i++) put(vault, rel.replace('.md', ' (' + i + ').md'), noteFor('code:other-' + i));
    await assert.rejects(V.choosePath(vault, rel, 'code:s-9'), /nine notes with this name/);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('frontConversation: reads the quoted or bare value; nothing else', () => {
  assert.equal(V.frontConversation(noteFor('code:a "b"')), 'code:a "b"');
  assert.equal(V.frontConversation('---\nconversation: web:x\n---\n'), 'web:x');
  assert.equal(V.frontConversation('# no frontmatter\nconversation: code:x\n'), null);
});

test('resolveSavePath: only <vault>/30_Areas/Claude/<Project>/<note>.md; crafted paths are refused (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const want = path.join(fs.realpathSync.native(vault), '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md');
    // .native: fsp.realpath (what resolveSavePath uses) expands 8.3 short names (TEMP here is C:\Users\ROGSTR~1\…); the JS fs.realpathSync does not
    assert.equal(await V.resolveSavePath(vault, '30_Areas/Claude/project-a/2026-10-01 Release planning.md'), want);
    assert.equal(await V.resolveSavePath(vault, path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md')), want);
    assert.ok(fs.statSync(path.dirname(want)).isDirectory(), 'the project folder is created');
    const refused = [
      '30_Areas/Claude/../Projects/x.md', '30_Areas/Projects/x.md', '30_Areas/Claude/x.md', '30_Areas/Claude/a/b/x.md',
      '30_Areas/Claude/project-a/x.txt', '30_Areas/Claude/project-a/CON.md', '30_Areas/Claude/pro:ject/x.md',
      '30_Areas/Claude/project-a/..', path.join(os.tmpdir(), 'x.md'), 'C:\\Windows\\x.md', '', null, 42,
    ];
    for (const p of refused) await assert.rejects(V.resolveSavePath(vault, p), Error, String(p));
    await assert.rejects(V.resolveSavePath(path.join(vault, 'missing'), '30_Areas/Claude/p/x.md'), /vault folder was not found/);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('resolveSavePath: a junction that leads out of the vault is refused (Review Focus 4)', { skip: process.platform !== 'win32' && 'junctions are Windows-only' }, async () => {
  const vault = tmpVault(), outside = tmpVault();
  try {
    fs.mkdirSync(path.join(vault, '30_Areas', 'Claude'), { recursive: true });
    fs.symlinkSync(outside, path.join(vault, '30_Areas', 'Claude', 'escape'), 'junction');
    await assert.rejects(V.resolveSavePath(vault, '30_Areas/Claude/escape/x.md'), /outside/);
    const v2 = tmpVault();
    try {
      fs.mkdirSync(path.join(v2, '30_Areas'), { recursive: true });
      fs.symlinkSync(outside, path.join(v2, '30_Areas', 'Claude'), 'junction');
      await assert.rejects(V.resolveSavePath(v2, '30_Areas/Claude/p/x.md'), /outside/);
    } finally { fs.rmSync(v2, { recursive: true, force: true }); }
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was created outside the vault');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('writeNoteAtomic: creates; never overwrites without replace; replace swaps whole; no .tmp litter (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    await V.writeNoteAtomic(f, 'one');
    assert.equal(fs.readFileSync(f, 'utf8'), 'one');
    await assert.rejects(V.writeNoteAtomic(f, 'two'), (e) => e.exists === true && /already there/.test(e.message));
    assert.equal(fs.readFileSync(f, 'utf8'), 'one', 'byte-identical after a refusal');
    await V.writeNoteAtomic(f, 'three', { replace: true });
    assert.equal(fs.readFileSync(f, 'utf8'), 'three');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeNoteAtomic: a note that appears between preview and save is not overwritten (the link refuses) (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    const ops = { link: async (a, b) => { fs.writeFileSync(f, 'written by someone else'); return fs.promises.link(a, b); }, rename: fs.promises.rename };
    await assert.rejects(V.writeNoteAtomic(f, 'mine', { ops }), (e) => e.exists === true);
    assert.equal(fs.readFileSync(f, 'utf8'), 'written by someone else');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeNoteAtomic: a locked note (EBUSY) is retried, then refused with the note untouched (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    fs.writeFileSync(f, 'original');
    let tries = 0;
    const busy = async () => { tries++; const e = new Error('EBUSY: resource busy or locked'); e.code = 'EBUSY'; throw e; };
    await assert.rejects(V.writeNoteAtomic(f, 'new', { replace: true, ops: { link: fs.promises.link, rename: busy }, waits: [1, 1] }), (e) => e.busy === true && /open or locked by another program/.test(e.message));
    assert.equal(tries, 3);
    assert.equal(fs.readFileSync(f, 'utf8'), 'original');
    assert.deepEqual(tmps(dir), []);
    let n = 0;
    const flaky = async (a, b) => { if (++n < 2) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return fs.promises.rename(a, b); };
    await V.writeNoteAtomic(f, 'new', { replace: true, ops: { link: fs.promises.link, rename: flaky }, waits: [1, 1] });
    assert.equal(fs.readFileSync(f, 'utf8'), 'new');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('draftPrompt: only your and Claude’s words; the opening and the end are kept; basis counts what went in', () => {
  const msgs = [
    { role: 'user', text: 'Plan the placeholder release', is_sidechain: 0 },
    { role: 'assistant', text: 'Plan: freeze, test, tag', is_sidechain: 0 },
    { role: 'tool', text: '[tool: Read notes.md]', is_sidechain: 0 },
    { role: 'assistant', text: 'subagent chatter', is_sidechain: 1 },
    ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'middle message ' + i + ' ' + 'x'.repeat(300), is_sidechain: 0 })),
    { role: 'user', text: 'Decision: ship Friday', is_sidechain: 0 },
  ];
  const d = V.draftPrompt(conv(), msgs, { maxChars: 3000 });
  assert.equal(d.system, V.DRAFT_SYSTEM);
  assert.match(d.system, /## Summary[\s\S]*## Decisions[\s\S]*## To-dos[\s\S]*## Links/);
  assert.ok(d.prompt.startsWith('Chat title: Release planning\n\nOwner: Plan the placeholder release\nClaude: Plan: freeze, test, tag\n[… '));
  assert.ok(d.prompt.endsWith('Owner: Decision: ship Friday'));
  assert.doesNotMatch(d.prompt, /tool: Read|subagent chatter/);
  assert.ok(d.prompt.length <= 3000 + 200);
  assert.equal(d.basis, d.prompt.split('\n').filter((l) => /^(Owner|Claude): /.test(l)).length);
  const left = Number(d.prompt.match(/\[… (\d+) messages left out …\]/)[1]);
  assert.equal(left + d.basis, 43);
  const all = V.draftPrompt(conv(), msgs.slice(0, 2));
  assert.equal(all.basis, 2); assert.doesNotMatch(all.prompt, /left out/);
});

test('noteText: frontmatter (source, conversation, project wikilink, created) + title + project link + the draft; the model’s own frontmatter is dropped', () => {
  const plan = V.planNote({ conversation: conv({ title: 'Say "hi": now' }), projectName: 'project-a' });
  const md = V.noteText({ conversation: conv({ title: 'Say "hi": now' }), plan, draft: '---\nfoo: bar\n---\n## Summary\nShipped.\n', model: 'placeholder-model', basis: 12, created: '2026-10-16' });
  assert.equal(md, [
    '---', 'source: claude-code', 'conversation: "code:s-1"', 'project: "[[project-a]]"', 'created: 2026-10-16', 'chat_date: 2026-10-01',
    'title: "Say \\"hi\\": now"', 'drafted_by: "local model placeholder-model, from 12 chat messages"', 'tags: [claude]', '---', '',
    '# Say -hi-- now', '', 'Project: [[project-a]] · chat of 2026-10-01', '', '## Summary\nShipped.', '',
  ].join('\n'));
  assert.equal(V.frontConversation(md), 'code:s-1');
  assert.match(V.noteText({ conversation: conv({ source: 'web', id: 'web:w-1' }), plan, draft: 'x', model: null, basis: 1, created: '2026-10-16' }), /^---\nsource: claude\.ai\nconversation: "web:w-1"\n/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test dashboard/claude-vault.test.mjs`
Expected: FAIL, `Cannot find module …/dashboard/claude-vault.js`.

- [ ] **Step 3: Implement part 1 of `dashboard/claude-vault.js`**

```js
// dashboard/claude-vault.js — "Save to vault" (Claude Hub H5; spec 2026-10-13 §7 claudeVault.preview/save, §9 Vault).
// Main process (Electron 32 / Node 20, CommonJS). It never touches hub.sqlite: chats come from the Hub process
// through claude-hub-host's request(). It writes ONE note, ONLY after the owner pressed Save (or Replace) in v5,
// ONLY under <vault>/30_Areas/Claude/<Project>/, atomically, and never over a note without replace:true.
// Env HQ_VAULT_DIR overrides the vault folder (second-instance gates); tests pass vaultDir directly.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const CLAUDE_DIR = ['30_Areas', 'Claude'];
const NAME_MAX = 60;          // a note path stays well under Windows' 260 even in a deep vault
const NOTE_MAX = 200000;      // characters a note may have
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

// one file or folder name: no Windows-illegal characters, nothing that breaks an Obsidian [[link]] (# ^ [ ] |),
// no control characters, no leading dot, no trailing dot or space, not a DOS device name, ≤ NAME_MAX code points
function safeSegment(name, fallback = 'untitled') {
  let s = String(name == null ? '' : name).normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[[\]#^]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[.\s]+/, '');
  const cps = [...s];
  if (cps.length > NAME_MAX) s = cps.slice(0, NAME_MAX).join('');
  s = s.replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = '_' + s;
  return s;
}
// main.js safeFile (the WorkspaceHQ project note's name), copied so the wikilink matches the note main writes
const projectNoteName = (name) => String(name || 'project').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'project';

function noteDay(c, now = new Date()) {
  for (const v of [c && c.started_at, c && c.last_at]) {
    const t = Date.parse(v || '');
    if (Number.isFinite(t)) return new Date(t).toLocaleDateString('en-CA');
  }
  return now.toLocaleDateString('en-CA');
}
function planNote({ conversation: c, projectName, hqProjectName = null, now = new Date() }) {
  const folder = safeSegment(projectName, 'No project');
  const title = safeSegment(c && c.title, 'Untitled chat');
  const day = noteDay(c, now);
  const link = hqProjectName ? projectNoteName(hqProjectName) : folder;
  return { folder, title, day, link, rel: [...CLAUDE_DIR, folder, day + ' ' + title + '.md'].join('/') };
}

function frontConversation(text) {
  const fm = (String(text || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/) || [])[1];
  if (fm == null) return null;
  const m = fm.match(/^conversation:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return null;
  if (!m[1].startsWith('"')) return m[1];
  try { return JSON.parse(m[1]); } catch { return null; }
}
async function noteConversation(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return frontConversation(buf.toString('utf8', 0, bytesRead));
  } catch (e) {
    if (e && e.code === 'ENOENT') return undefined;
    throw e;
  } finally { if (fh) await fh.close().catch(() => {}); }
}
// this chat's own earlier note → offered for Replace; a name another chat (or the owner) uses → the next " (n)"
async function choosePath(vaultDir, rel, conversationId) {
  const base = rel.replace(/\.md$/i, '');
  for (let i = 1; i <= 9; i++) {
    const r = i === 1 ? rel : base + ' (' + i + ').md';
    const owner = await noteConversation(path.join(vaultDir, ...r.split('/')));
    if (owner === undefined) return { rel: r, exists: false };
    if (owner === conversationId) return { rel: r, exists: true };
  }
  throw new Error('nine notes with this name already exist for other chats — rename one in Obsidian first');
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
async function resolveSavePath(vaultDir, p) {
  if (typeof p !== 'string' || !p || p.length > 1024) throw new Error('no note path');
  let realVault;
  try { realVault = await fsp.realpath(vaultDir); } catch { throw new Error('the vault folder was not found: ' + vaultDir); }
  const root = path.join(path.resolve(vaultDir), ...CLAUDE_DIR);
  const rel = path.relative(root, path.resolve(vaultDir, p));
  const parts = rel.split(path.sep);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || parts.length !== 2) throw new Error('notes are saved only as 30_Areas/Claude/<Project>/<note>.md');
  const [folder, file] = parts;
  const stem = file.replace(/\.md$/i, '');
  if (!/\.md$/i.test(file) || safeSegment(folder) !== folder || safeSegment(stem) !== stem) throw new Error('that note name is not one Save to vault makes');
  await fsp.mkdir(root, { recursive: true });
  const realRoot = await fsp.realpath(root);
  if (!same(realRoot, path.join(realVault, ...CLAUDE_DIR))) throw new Error('30_Areas/Claude leads outside the vault — refusing to write');
  await fsp.mkdir(path.join(realRoot, folder), { recursive: true });
  const realDir = await fsp.realpath(path.join(realRoot, folder));
  if (!same(realDir, path.join(realRoot, folder))) throw new Error('the project folder leads outside the vault — refusing to write');
  return path.join(realDir, file);
}

// temp file in the same folder (fsynced) → hard link (new note: EEXIST if one appeared, so never an overwrite)
// or rename over (Replace: atomic; EBUSY/EPERM/EACCES retried). The temp file never survives.
async function writeNoteAtomic(file, text, { replace = false, ops = { link: fsp.link, rename: fsp.rename }, waits = [100, 300, 900] } = {}) {
  const tmp = file + '.' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.tmp';
  const fh = await fsp.open(tmp, 'wx');
  try { await fh.writeFile(text, 'utf8'); await fh.sync(); } finally { await fh.close(); }
  try {
    if (!replace) {
      try { await ops.link(tmp, file); }
      catch (e) {
        if (e && e.code === 'EEXIST') { const err = new Error('a note with this name is already there'); err.exists = true; throw err; }
        throw e;
      }
      return;
    }
    for (let i = 0; ; i++) {
      try { await ops.rename(tmp, file); return; }
      catch (e) {
        const busy = e && ['EBUSY', 'EPERM', 'EACCES'].includes(e.code);
        if (busy && i < waits.length) { await new Promise((r) => setTimeout(r, waits[i])); continue; }
        if (!busy) throw e;
        const err = new Error('the note is open or locked by another program (' + e.code + ') — close it and press Replace again');
        err.busy = true; throw err;
      }
    }
  } finally { await fsp.unlink(tmp).catch(() => {}); }
}

const DRAFT_SYSTEM = 'You turn one past chat between the owner and Claude into an Obsidian note. Write Markdown with exactly these four sections, in this order: "## Summary" (3 to 6 sentences), "## Decisions" (bullets; "- none recorded" if there are none), "## To-dos" (bullets as "- [ ] …"; "- [ ] none recorded" if there are none), "## Links" (bullets of URLs or file paths that appear in the chat; "- none" if there are none). Use only what the chat says: never invent decisions, dates, names or numbers. No front matter, no title line, no preamble.';
const oneLine = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function draftPrompt(c, messages, { maxChars = 12000 } = {}) {
  const lines = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && !m.is_sidechain && String(m.text || '').trim())
    .map((m) => (m.role === 'user' ? 'Owner' : 'Claude') + ': ' + oneLine(m.text, 1200));
  const head = lines.slice(0, 2), tail = [];
  let used = head.join('\n').length;
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (used + 1 + lines[i].length > maxChars) break;
    tail.unshift(lines[i]); used += 1 + lines[i].length;
  }
  const left = lines.length - head.length - tail.length;
  const kept = head.concat(left > 0 ? ['[… ' + left + ' messages left out …]'] : [], tail);
  return { system: DRAFT_SYSTEM, prompt: 'Chat title: ' + oneLine((c && c.title) || 'Untitled chat', 200) + '\n\n' + kept.join('\n'), basis: head.length + tail.length };
}

function noteText({ conversation: c, plan, draft, model, basis, created }) {
  const body = String(draft || '').replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();
  return [
    '---',
    'source: ' + (c.source === 'web' ? 'claude.ai' : 'claude-code'),
    'conversation: ' + JSON.stringify(String(c.id)),
    'project: ' + JSON.stringify('[[' + plan.link + ']]'),
    'created: ' + created,
    'chat_date: ' + plan.day,
    'title: ' + JSON.stringify(String(c.title || 'Untitled chat')),
    'drafted_by: ' + JSON.stringify('local model ' + (model || 'unknown') + ', from ' + basis + ' chat messages'),
    'tags: [claude]',
    '---', '',
    '# ' + plan.title, '',
    'Project: [[' + plan.link + ']] · chat of ' + plan.day, '',
    body, '',
  ].join('\n');
}

module.exports = {
  CLAUDE_DIR, NAME_MAX, NOTE_MAX, DRAFT_SYSTEM,
  safeSegment, projectNoteName, noteDay, planNote, frontConversation, noteConversation, choosePath,
  resolveSavePath, writeNoteAtomic, draftPrompt, noteText,
};
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test dashboard/claude-vault.test.mjs`
Expected: PASS (12 tests; on a non-Windows machine the junction test is skipped).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-vault.js dashboard/claude-vault.test.mjs
git commit -m "fe: Claude Hub H5.4 — claude-vault part 1 (safe note names, 30_Areas/Claude path guard incl. junctions, own-note vs other-chat naming, atomic no-overwrite write, draft prompt, note text)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `claude-vault.js`, part 2: `preview` / `save`, the IPC, preload, the fake, the `main.js` hook

**Files:**
- Modify: `dashboard/claude-vault.js` (add `hqProjectName`, `createVault`, `init`)
- Modify: `dashboard/claude-vault.test.mjs` (append)
- Modify: `docs/sync/IPC-CONTRACT.md` (2 rows, written FIRST)
- Modify: `dashboard/preload.js` (`hq.claudeVault.{preview,save}`)
- Modify: `dashboard-v5/tools/fake-preload.js` (+ 2 `SPEC` rows), `dashboard-v5/tools/fake-preload.test.mjs` (+1 test)
- Modify: `dashboard/main.js` (one added line after the Hub host init in `app.whenReady()`)

**Interfaces:**
- Consumes:
  - Task 4's functions.
  - The H1 host `hub.request(op, args, { timeout }) → Promise<result | { error }>`, which never rejects.
  - Its Hub ops: `getConversation({ id, limit: 500 }) → { conversation, messages, hasMore } | null` and `listProjects({}) → rows[{ id, name, … }]` (snake_case).
  - `llm-local.js` `run({ system, prompt, timeoutMs }) → { status: 'done', output, model } | { status: 'unavailable' | 'error', reason }`.
  - `<dataDir>/latest.json` `projects[{ id, name }]` (read-only), for the WorkspaceHQ project note's name.
- Produces:
  - `hqProjectName(dataDir, hqProjectId) → string|null` (new).
  - `createVault({ hub, llm, vaultDir, dataDir, now = () => new Date() }) → { preview, save }` (new).
    - `preview(conversationId) → Promise<{ path, rel, markdown, exists, model, basis } | { error }>`. It writes nothing. `path` is absolute, `rel` is vault-relative, and `exists: true` means this chat's own note is already there.
    - `save({ path, markdown, replace? }) → Promise<true | { error } | { error, exists: true }>`.
      - It writes one note only, and only after `resolveSavePath` accepts the path.
      - The markdown must carry a `conversation:` frontmatter line.
      - `replace` must be `true` to overwrite, and then only a note whose `conversation:` matches.
  - `init({ ipcMain, hub, dataDir, vaultDir, llm = require('./llm-local') }) → { preview, save }`.
    - It registers `hq:claude-vault:preview` and `hq:claude-vault:save`; neither handler ever throws.
    - `vaultDir = process.env.HQ_VAULT_DIR || vaultDir`.
  - Preload (spec §7, additive fields per the Phase definitions): `hq.claudeVault.preview(conversationId)` → `hq:claude-vault:preview`; `hq.claudeVault.save({ path, markdown, replace? })` → `hq:claude-vault:save`.

- [ ] **Step 1: IPC-CONTRACT rows (before the handlers)**

In `docs/sync/IPC-CONTRACT.md`, append these two rows to the table under `### Claude Hub — Save to vault (spec 2026-10-13-claude-hub-design.md §7/§9, phase H5)` that Task 2 created (three cells per row: Preload | Channel | Shape — the same columns as H1's Claude Hub table):

```
| `claudeVault.preview(conversationId)` | `hq:claude-vault:preview` (invoke) | in: conversation id (string ≤ 300) → `{path, rel, markdown, exists, model, basis}` \| `{error}` — the LOCAL model drafts Summary / Decisions / To-dos / Links from the Hub's copy of the chat (≤ 500 newest messages; user + assistant text only). Writes nothing. `path` is absolute under `VEEMO CORTEX/30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md`; `exists:true` = this chat's own earlier note is there (the UI then asks Replace). Another chat's note of the same name is never offered: the name takes ` (2)`…` (9)`. `{error}` when the Hub, the chat or the local model is missing (H5; additive to spec §7: `rel`, `exists`, `model`, `basis`); never throws |
| `claudeVault.save({path, markdown, replace?})` | `hq:claude-vault:save` (invoke) | in: `path` from preview, the edited `markdown` (≤ 200 000 chars, must keep its `conversation:` frontmatter line), `replace` only from the Replace button → `true` \| `{error}` \| `{error, exists:true}` (a note is there and `replace` was not sent). Only `30_Areas/Claude/<Project>/<note>.md` inside the vault (junctions out refused); atomic (temp + link/rename); `replace:true` overwrites only a note whose `conversation:` matches; never automatic, never bulk. Env `HQ_VAULT_DIR` overrides the vault folder for gates (H5); never throws |
```

- [ ] **Step 2: Write the failing tests**

Append to `dashboard/claude-vault.test.mjs`:

```js
// ---- part 2: preview / save / init (fake Hub, fake local model, temp vault) ----
const MSGS = [
  { role: 'user', text: 'Plan the placeholder release for project-a', is_sidechain: 0, at: '2026-10-01T23:30:00.000Z' },
  { role: 'assistant', text: 'Plan: freeze, test, tag. See https://example.org/release', is_sidechain: 0, at: '2026-10-01T23:31:00.000Z' },
  { role: 'user', text: 'Decision: ship Friday', is_sidechain: 0, at: '2026-10-01T23:32:00.000Z' },
];
function hubFor(convs, { projects = [{ id: 'code:p-a', name: 'project-a' }], fail = {} } = {}) {
  const calls = [];
  return { calls, request: async (op, args, opts) => {
    calls.push({ op, args, opts });
    if (fail[op]) return { error: fail[op] };
    if (op === 'getConversation') { const c = convs[args.id]; return c ? { conversation: c, messages: MSGS, hasMore: false } : null; }
    if (op === 'listProjects') return projects;
    return { error: 'unknown op' };
  } };
}
const DRAFT = '## Summary\nThe placeholder release ships Friday.\n\n## Decisions\n- ship Friday\n\n## To-dos\n- [ ] tag\n\n## Links\n- https://example.org/release\n';
function llmFake(answer = { status: 'done', output: DRAFT, model: 'placeholder-model' }) {
  const calls = [];
  return { calls, run: async (a) => { calls.push(a); return answer; } };
}
const NOW = () => new Date('2026-10-16T10:00:00.000Z');
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

test('preview: the local model drafts a note from the Hub’s copy of the chat; nothing is written', async () => {
  const vault = tmpVault();
  try {
    const llm = llmFake();
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm, vaultDir: vault, dataDir: vault, now: NOW });
    const before = tree(vault);
    const p = await v.preview('code:s-1');
    assert.equal(p.error, undefined, p.error);
    assert.equal(p.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning.md');
    assert.equal(p.path, path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md'));
    assert.equal(p.exists, false);
    assert.equal(p.model, 'placeholder-model');
    assert.equal(p.basis, 3);
    assert.ok(p.markdown.startsWith('---\nsource: claude-code\nconversation: "code:s-1"\nproject: "[[project-a]]"\ncreated: 2026-10-16\n'));
    assert.ok(p.markdown.includes('## Decisions\n- ship Friday'));
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].system, V.DRAFT_SYSTEM);
    assert.match(llm.calls[0].prompt, /Owner: Decision: ship Friday$/);
    assert.deepEqual(tree(vault), before, 'preview writes nothing');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('preview → save → preview says exists → save without Replace is refused, the note untouched → Replace overwrites (Review Focus 5)', async () => {
  const vault = tmpVault();
  try {
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const p = await v.preview('code:s-1');
    assert.equal(await v.save({ path: p.path, markdown: p.markdown + '\nmy edit\n' }), true);
    const file = path.join(vault, ...p.rel.split('/'));
    assert.ok(fs.readFileSync(file, 'utf8').endsWith('my edit\n'), 'the owner’s edit is what lands');
    const again = await v.preview('code:s-1');
    assert.equal(again.rel, p.rel); assert.equal(again.exists, true);
    const first = fs.readFileSync(file);
    assert.deepEqual(await v.save({ path: again.path, markdown: again.markdown }), { error: 'a note with this name is already there', exists: true });
    assert.deepEqual(fs.readFileSync(file), first, 'byte-identical after the refusal');
    assert.equal(await v.save({ path: again.path, markdown: again.markdown, replace: true }), true);
    assert.equal(fs.readFileSync(file, 'utf8'), again.markdown);
    assert.deepEqual(tmps(path.dirname(file)), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('another chat’s note of the same name: preview takes " (2)"; Replace aimed at it is refused (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const hub = hubFor({ 'code:s-1': conv(), 'code:s-2': conv({ id: 'code:s-2' }) });
    const v = V.createVault({ hub, llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const a = await v.preview('code:s-1');
    assert.equal(await v.save({ path: a.path, markdown: a.markdown }), true);
    const b = await v.preview('code:s-2');
    assert.equal(b.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning (2).md');
    assert.equal(b.exists, false);
    const aBytes = fs.readFileSync(a.path);
    const r = await v.save({ path: a.path, markdown: b.markdown, replace: true });
    assert.match(r.error, /belongs to another chat/);
    assert.deepEqual(fs.readFileSync(a.path), aBytes);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('save refuses: paths outside 30_Areas/Claude, a note without its conversation line, too big, not text (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const v = V.createVault({ hub: hubFor({}), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const md = noteFor('code:s-1');
    for (const p of ['30_Areas/Projects/x.md', '30_Areas/Claude/../../x.md', path.join(os.tmpdir(), 'x.md'), '30_Areas/Claude/a/b/x.md']) {
      const r = await v.save({ path: p, markdown: md });
      assert.ok(r && typeof r.error === 'string', p);
    }
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: '# no frontmatter' })).error, /conversation/);
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: md + 'x'.repeat(V.NOTE_MAX) })).error, /too long/);
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: 42 })).error, /no note text/);
    assert.match((await v.save(null)).error, /no note/);
    assert.deepEqual(tree(vault).filter((f) => f.endsWith('.md')), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('preview errors say why and write nothing: Hub down, chat gone, Hub error, model offline, model failed', async () => {
  const vault = tmpVault();
  try {
    const mk = (hub, llm = llmFake()) => V.createVault({ hub, llm, vaultDir: vault, dataDir: vault, now: NOW });
    assert.match((await mk(null).preview('code:s-1')).error, /Claude Hub is not running/);
    assert.match((await mk(hubFor({}, { fail: { getConversation: 'hub not running' } })).preview('code:s-1')).error, /Claude Hub is not running/);
    assert.match((await mk(hubFor({})).preview('code:s-1')).error, /not in the Claude Hub index/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }, { fail: { listProjects: 'no such table: project' } })).preview('code:s-1')).error, /no such table: project/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }), llmFake({ status: 'unavailable', reason: 'no local LLM runtime up on :11434 or :1234' })).preview('code:s-1')).error, /local model isn’t running.*11434/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }), llmFake({ status: 'error', reason: 'empty response from model' })).preview('code:s-1')).error, /local model failed: empty response/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() })).preview('')).error, /no chat/);
    const gone = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm: llmFake(), vaultDir: path.join(vault, 'missing'), dataDir: vault, now: NOW });
    assert.match((await gone.preview('code:s-1')).error, /vault folder was not found/);
    assert.deepEqual(tree(vault), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('a chat linked to a WorkspaceHQ project links that project’s note', async () => {
  const vault = tmpVault();
  try {
    fs.writeFileSync(path.join(vault, 'latest.json'), JSON.stringify({ projects: [{ id: 'hq-1', name: 'Kitchen: B' }] }));
    assert.equal(V.hqProjectName(vault, 'hq-1'), 'Kitchen: B');
    assert.equal(V.hqProjectName(vault, 'nope'), null);
    assert.equal(V.hqProjectName(path.join(vault, 'missing'), 'hq-1'), null);
    // the link is on the PROJECT row (listProjects p.hq_project_id); H1's getConversation row has no hq_project_id column
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }, { projects: [{ id: 'code:p-a', name: 'project-a', hq_project_id: 'hq-1' }] }), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const p = await v.preview('code:s-1');
    assert.match(p.markdown, /\nproject: "\[\[Kitchen- B\]\]"\n/);
    assert.equal(p.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning.md', 'the folder stays the Claude project');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('init: exactly two channels; HQ_VAULT_DIR wins; handlers never throw', async () => {
  const vault = tmpVault();
  const saved = process.env.HQ_VAULT_DIR;
  try {
    process.env.HQ_VAULT_DIR = vault;
    const handlers = {};
    V.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, hub: hubFor({ 'code:s-1': conv() }), dataDir: vault, vaultDir: path.join(vault, 'NOT-THIS-ONE'), llm: llmFake() });
    assert.deepEqual(Object.keys(handlers).sort(), ['hq:claude-vault:preview', 'hq:claude-vault:save']);
    const p = await handlers['hq:claude-vault:preview']({}, 'code:s-1');
    assert.ok(p.path.startsWith(vault), p.path);
    assert.equal(await handlers['hq:claude-vault:save']({}, { path: p.path, markdown: p.markdown }), true);
    assert.ok(fs.existsSync(path.join(vault, ...p.rel.split('/'))));
    assert.ok(typeof (await handlers['hq:claude-vault:save']({}, undefined)).error === 'string');
    assert.ok(typeof (await handlers['hq:claude-vault:preview']({}, { not: 'a string' })).error === 'string');
  } finally {
    if (saved === undefined) delete process.env.HQ_VAULT_DIR; else process.env.HQ_VAULT_DIR = saved;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
```

Append to `dashboard-v5/tools/fake-preload.test.mjs`:

```js
test('claudeVault: the fake drafts a canned note and records a save (H5)', async () => {
  const { hq, control } = createFake();
  const p = await hq.claudeVault.preview('code:fake-1');
  assert.equal(p.rel, '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md');
  assert.equal(p.exists, false);
  assert.match(p.markdown, /^---\nsource: claude-code\nconversation: "code:fake-1"\n/);
  assert.equal(await hq.claudeVault.save({ path: p.path, markdown: p.markdown }), true);
  assert.equal(control.calls('claudeVault.save').length, 1);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test dashboard/claude-vault.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: FAIL. `V.createVault`, `V.hqProjectName` and `V.init` are not functions. `hq.claudeVault` is undefined in the fake.

- [ ] **Step 4: Implement**

In `dashboard/claude-vault.js`, add `const fs = require('node:fs');` under `'use strict';`. Then add before `module.exports`:

```js
// the WorkspaceHQ project's name from the latest scan (read-only), for the project note's wikilink
function hqProjectName(dataDir, hqProjectId) {
  if (!hqProjectId) return null;
  try {
    const S = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8'));
    const p = (S.projects || []).find((x) => x && x.id === hqProjectId);
    return p && p.name ? String(p.name) : null;
  } catch { return null; }
}
const HUB_DOWN = { 'hub not running': 'Claude Hub is not running', 'hub stopped': 'Claude Hub stopped while answering', timeout: 'Claude Hub did not answer in time' };
const hubError = (r) => (r && typeof r.error === 'string' ? 'Claude Hub: ' + (HUB_DOWN[r.error] || r.error) : null);

function createVault({ hub, llm, vaultDir, dataDir, now = () => new Date() }) {
  async function preview(conversationId) {
    if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 300) return { error: 'no chat to save' };
    if (!hub || typeof hub.request !== 'function') return { error: 'Claude Hub is not running — Save to vault reads the chat from it' };
    if (!fs.existsSync(vaultDir)) return { error: 'the vault folder was not found: ' + vaultDir };
    const got = await hub.request('getConversation', { id: conversationId, limit: 500 }, { timeout: 10000 });
    if (hubError(got)) return { error: hubError(got) };
    if (!got || !got.conversation) return { error: 'that chat is not in the Claude Hub index (forgotten, or not indexed yet)' };
    const projects = await hub.request('listProjects', {}, { timeout: 10000 });
    if (hubError(projects)) return { error: hubError(projects) };
    const c = got.conversation;
    const proj = (Array.isArray(projects) ? projects : []).find((p) => p && p.id === c.project_id);
    const d = draftPrompt(c, got.messages);
    if (!d.basis) return { error: 'that chat has no messages from you or Claude to summarise' };
    const r = await llm.run({ system: d.system, prompt: d.prompt, timeoutMs: 120000 });
    if (!r || r.status !== 'done') {
      return { error: r && r.status === 'unavailable'
        ? 'the local model isn’t running — start Ollama or LM Studio and try again (' + (r.reason || 'no runtime') + ')'
        : 'the local model failed: ' + ((r && r.reason) || 'no answer') };
    }
    const at = now();
    // getConversation's row is `SELECT * FROM conversation` (no hq_project_id column); the link lives on the project row
    // (listProjects p.*). c.hq_project_id is read too, in case a later phase adds it to the conversation row.
    const hqId = c.hq_project_id || (proj && proj.hq_project_id) || null;
    const plan = planNote({ conversation: c, projectName: proj ? proj.name : null, hqProjectName: hqProjectName(dataDir, hqId), now: at });
    let chosen;
    try { chosen = await choosePath(vaultDir, plan.rel, c.id); } catch (e) { return { error: String(e.message || e) }; }
    const markdown = noteText({ conversation: c, plan, draft: r.output, model: r.model, basis: d.basis, created: at.toLocaleDateString('en-CA') });
    return { path: path.join(vaultDir, ...chosen.rel.split('/')), rel: chosen.rel, markdown, exists: chosen.exists, model: r.model || null, basis: d.basis };
  }

  async function save(req) {
    if (!req || typeof req !== 'object') return { error: 'no note to save' };
    const { path: p, markdown, replace } = req;
    if (typeof markdown !== 'string' || !markdown.trim()) return { error: 'no note text to save' };
    if (markdown.length > NOTE_MAX) return { error: 'the note is too long (over ' + NOTE_MAX + ' characters)' };
    const id = frontConversation(markdown);
    if (!id) return { error: 'the note lost its "conversation:" frontmatter line — keep the frontmatter block' };
    let file;
    try { file = await resolveSavePath(vaultDir, p); } catch (e) { return { error: String(e.message || e) }; }
    let overwrite = false;
    if (replace === true) {
      const owner = await noteConversation(file).catch((e) => e);
      if (owner instanceof Error) return { error: String(owner.message || owner) };
      if (owner !== undefined && owner !== id) return { error: 'that note belongs to another chat — it is never replaced' };
      overwrite = owner !== undefined;
    }
    try { await writeNoteAtomic(file, markdown, { replace: overwrite }); }
    catch (e) { return e && e.exists ? { error: e.message, exists: true } : { error: String((e && e.message) || e) }; }
    return true;
  }
  return { preview, save };
}

// main.js: one line after the Hub host is created. Two invoke channels; neither ever throws.
function init({ ipcMain, hub, dataDir, vaultDir, llm = require('./llm-local') }) {
  const vault = createVault({ hub, llm, dataDir, vaultDir: process.env.HQ_VAULT_DIR || vaultDir });
  const safe = (fn) => async (_e, arg) => { try { return await fn(arg); } catch (e) { return { error: String((e && e.message) || e).slice(0, 300) }; } };
  ipcMain.handle('hq:claude-vault:preview', safe((id) => vault.preview(id)));
  ipcMain.handle('hq:claude-vault:save', safe((req) => vault.save(req)));
  return vault;
}
```

Add `hqProjectName, createVault, init` to `module.exports`.

In `dashboard/preload.js`, right after the `claudeHub: { … },` block:

```js
  // Claude Hub H5: Save to vault — preview drafts (writes nothing); save writes one confirmed note
  claudeVault: {
    preview: (conversationId) => ipcRenderer.invoke('hq:claude-vault:preview', conversationId),
    save: (req) => ipcRenderer.invoke('hq:claude-vault:save', req),
  },
```

In `dashboard-v5/tools/fake-preload.js`, add after the `['claudeHub.on', 'on:hq:claude-hub:event'],` row:

```js
    // Claude Hub H5: Save to vault (canned draft; save resolves true and is recorded)
    ['claudeVault.preview', (id) => ({ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', exists: false, model: 'fake-model', basis: 4,
      markdown: '---\nsource: claude-code\nconversation: ' + JSON.stringify(String(id)) + '\nproject: "[[project-a]]"\ncreated: 2026-10-16\nchat_date: 2026-10-01\ntitle: "Fake release planning"\ndrafted_by: "local model fake-model, from 4 chat messages"\ntags: [claude]\n---\n\n# Fake release planning\n\nProject: [[project-a]] · chat of 2026-10-01\n\n## Summary\nThe fake release ships Friday.\n\n## Decisions\n- ship Friday\n\n## To-dos\n- [ ] tag\n\n## Links\n- none\n' })],
    ['claudeVault.save', WRITE],
```

In `dashboard/main.js`, right after the line `claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog });   // Claude Hub (spec 2026-10-13)` (around line 1594), add:

```js
  require('./claude-vault').init({ ipcMain, hub: claudeHub, dataDir: DATA, vaultDir: VAULT });   // Claude Hub H5: Save to vault (writes only on the owner's Save)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test dashboard/claude-vault.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: PASS. The fake-parity test ("the fake exposes exactly the real preload method paths") passes, since `claudeVault.preview` and `claudeVault.save` now exist on both sides.

Run: `node --check dashboard/main.js; node --check dashboard/preload.js; node --test dashboard/*.test.mjs`
Expected: exit 0, PASS.

- [ ] **Step 6: Commit**

```bash
git add -- docs/sync/IPC-CONTRACT.md dashboard/claude-vault.js dashboard/claude-vault.test.mjs dashboard/preload.js dashboard/main.js dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs
git commit -m "fe: Claude Hub H5.5 — Save to vault IPC (preview drafts with the local model and writes nothing; save writes one confirmed note, Replace only for this chat's own note)

main.js: +1 line (require('./claude-vault').init after the Claude Hub host init).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: v5 "Save to vault": the dialog, its logic and vals, the thread-view button

**Files:**
- Create: `dashboard-v5/src/logic/claude-vault.js` (mixin `claudeVaultLogic`)
- Create: `dashboard-v5/src/vals/claude-vault.js` (`claudeVaultVals`, `basisNote`)
- Create: `dashboard-v5/src/logic/claude-vault.test.mjs`
- Modify: `dashboard-v5/src/app.js` (import + `Object.assign`, `initState` `vault: null`, `closeTop` order, the overlay guard at app.js:362)
- Modify: `dashboard-v5/src/vals/index.js` (import + `SURFACES` entry)
- Modify: `dashboard-v5/src/tpl/extras.tpl.js` (the dialog)
- Modify: H2's thread header. That is `dashboard-v5/src/tpl/claude.tpl.js`, unless H2 split the Chats markup into another `tpl/claude-*.tpl.js`; find it with `grep -rn 'onClick="{{ clTerminal }}"' dashboard-v5/src/tpl`. One marked button goes there.
- Modify: `dashboard-v5/src/__golden__/vals.hashes.json`, `dashboard-v5/src/tpl.hash.test.mjs` (re-records)

**Interfaces:**
- Consumes:
  - Task 5's preload `hq.claudeVault.preview(id) → { path, rel, markdown, exists, model, basis } | { error }` and `hq.claudeVault.save({ path, markdown, replace? }) → true | { error } | { error, exists: true }`.
  - H2's live thread `this.LIVE.claudeLib.thread`, the result of `hq.claudeHub.conversation(id)` stored by `store.openClaudeThread` (H2 plan, Task 8). Its `.conversation.id` is the chat id.
  - App helpers `canWrite()`, `writeReason()`, `denied(why)`, `notWired(what)`, `toast(kind, text)`, `closeTop()`.
- Produces:
  - State `vault: null | { id, phase: 'drafting'|'ready'|'saving'|'saved'|'error', path?, rel?, draft?, exists?, model?, basis?, askReplace?, saveError?, error? }`.
  - Mixin `claudeVaultLogic`:
    - `vaultApi() → hq.claudeVault | null`
    - `openVaultPreview(id) → Promise<void>`
    - `onVaultEdit(e)`
    - `saveVault(replace = false) → Promise<void>`
    - `keepVault()`
    - `retryVault() → Promise<void>`
    - `closeVault()`
  - `basisNote(model, basis) → string`.
  - Vals keys (all from `claudeVaultVals`):
    - Thread button: `clVault`, `clVaultOff`, `clVaultTip`.
    - Dialog state: `vaultOpen`, `vaultDrafting`, `vaultReady`, `vaultSaving`, `vaultSaved`, `vaultFailed`.
    - Text and edits: `vaultError`, `vaultRel`, `vaultDraft`, `onVaultEdit`, `vaultBasis`, `vaultExistsNote`, `vaultHasExists`.
    - Replace and errors: `vaultAskReplace`, `vaultSaveError`, `vaultHasSaveError`.
    - Save button: `vaultSaveOff`, `vaultSaveLabel`.
    - Actions: `vaultSave`, `vaultReplace`, `vaultKeep`, `vaultRetry`, `vaultClose`.
  - The save gate:
    - A write happens only from `vaultSave` / `vaultReplace`, which are only reachable by the owner pressing a button.
    - `replace: true` is sent only by `vaultReplace`, which shows only after the dialog asked.
    - A save answered `{exists: true}` goes back to the Replace question and never retries on its own.

- [ ] **Step 1: Dump the goldens before the change (PowerShell)**

```powershell
$B = Join-Path $env:TEMP 'hq-h5-golden-before-t6'; Remove-Item -LiteralPath $B -Recurse -Force -ErrorAction SilentlyContinue
$env:GOLDEN_DUMP = $B; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
```

Expected: PASS.

- [ ] **Step 2: Write the failing tests**

```js
// dashboard-v5/src/logic/claude-vault.test.mjs
// Save to vault in v5 (Claude Hub H5, spec 2026-10-13 §9 Vault). A store over synthetic DATA, a Component that is
// never mounted (setState is synchronous then), and a FAKE window.hq whose claudeVault answers only when the test
// says so. Synthetic fixtures only.
//   node --test dashboard-v5/src/logic/claude-vault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { basisNote } from '../vals/claude-vault.js';
import extrasTpl from '../tpl/extras.tpl.js';
import { proj, scan, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, activeElement: null });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const tick = () => new Promise((res) => setImmediate(res));
// two scans (newest first): the "past snapshot" test sets snapOffset 1, which needs an older scan to exist
// (writeReason formats that scan's day — library.test.mjs uses the same twoScans shape)
const DATA = () => ({ scans: [scan('2026-10-05', [proj('a'), proj('b')]), scan('2026-10-04', [proj('a'), proj('b')])], spellbook: spellbook([]), telemetry: telemetry([]) });
const DRAFT = { path: 'C:\\placeholder-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md', markdown: '---\nconversation: "code:s-1"\n---\n# Release planning\n', exists: false, model: 'placeholder-model', basis: 12 };

// claudeVault.preview/save stay pending until answerPreview(r) / answerSave(r)
function make({ withVault = true, thread = true } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const calls = [];
  let pv = null, sv = null;
  const hq = { probeLlm: () => ({ available: true }) };
  if (withVault) hq.claudeVault = {
    preview: (id) => { calls.push(['preview', id]); return new Promise((r) => { pv = r; }); },
    save: (req) => { calls.push(['save', req]); return new Promise((r) => { sv = r; }); },
  };
  const store = createStore(DATA(), hq);
  if (thread) store.live.claudeLib = { thread: { conversation: { id: 'code:s-1', title: 'Release planning' }, messages: [], hasMore: false } };
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  const toasts = [], said = [];
  c.toast = (kind, text) => { toasts.push({ kind, text }); return 'k'; };
  c.notWired = (what) => { said.push(['notWired', what]); };
  c.denied = (why) => { said.push(['denied', why]); };
  return { c, store, calls, toasts, said, answerPreview: async (r) => { pv(r); await tick(); }, answerSave: async (r) => { sv(r); await tick(); } };
}
const saves = (calls) => calls.filter((x) => x[0] === 'save').map((x) => x[1]);

test('the thread view’s button: on for an open chat, it asks for a draft; nothing is written by opening (spec §9)', async () => {
  const t = make();
  const v = t.c.renderVals();
  assert.equal(v.clVaultOff, false);
  assert.match(v.clVaultTip, /nothing is written until you press Save/);
  v.clVault();
  assert.deepEqual(t.calls, [['preview', 'code:s-1']]);
  assert.equal(t.c.renderVals().vaultDrafting, true);
  await t.answerPreview(DRAFT);
  const r = t.c.renderVals();
  assert.equal(r.vaultReady, true);
  assert.equal(r.vaultRel, DRAFT.rel);
  assert.equal(r.vaultDraft, DRAFT.markdown);
  assert.equal(r.vaultBasis, basisNote('placeholder-model', 12));
  assert.deepEqual(saves(t.calls), [], 'a preview never saves');
  assert.equal(make({ thread: false }).c.renderVals().clVaultOff, true);
});

test('Save sends the owner’s edited text, without replace; a saved note toasts its path', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().onVaultEdit({ target: { value: DRAFT.markdown + 'my edit\n' } });
  t.c.renderVals().vaultSave();
  assert.deepEqual(saves(t.calls), [{ path: DRAFT.path, markdown: DRAFT.markdown + 'my edit\n' }]);
  assert.equal(t.c.renderVals().vaultSaving, true);
  assert.equal(t.c.renderVals().vaultSaveOff, true, 'no second save while one runs');
  await t.answerSave(true);
  assert.equal(t.c.renderVals().vaultSaved, true);
  assert.deepEqual(t.toasts.at(-1), { kind: 'success', text: 'Saved to vault: ' + DRAFT.rel });
});

test('a note that is already there: Save only asks; Keep it writes nothing; Replace sends replace:true (Review Focus 5)', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview({ ...DRAFT, exists: true });
  let v = t.c.renderVals();
  assert.equal(v.vaultHasExists, true);
  assert.match(v.vaultExistsNote, /already in the vault/);
  v.vaultSave();
  assert.equal(t.c.renderVals().vaultAskReplace, true);
  assert.deepEqual(saves(t.calls), [], 'asking is not saving');
  t.c.renderVals().vaultKeep();
  assert.equal(t.c.renderVals().vaultAskReplace, false);
  assert.deepEqual(saves(t.calls), []);
  t.c.renderVals().vaultSave();
  t.c.renderVals().vaultReplace();
  assert.deepEqual(saves(t.calls), [{ path: DRAFT.path, markdown: DRAFT.markdown, replace: true }]);
  await t.answerSave(true);
  assert.equal(t.c.renderVals().vaultSaved, true);
});

test('a save answered "exists" (a note appeared after the preview) goes back to the question — never an automatic retry (Review Focus 5)', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().vaultSave();
  await t.answerSave({ error: 'a note with this name is already there', exists: true });
  const v = t.c.renderVals();
  assert.equal(v.vaultReady, true);
  assert.equal(v.vaultAskReplace, true);
  assert.equal(v.vaultHasExists, true);
  assert.match(v.vaultSaveError, /appeared/);
  assert.equal(saves(t.calls).length, 1, 'no automatic second save');
});

test('a save error keeps the draft and says why', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().vaultSave();
  await t.answerSave({ error: 'the note is open or locked by another program (EBUSY) — close it and press Replace again' });
  const v = t.c.renderVals();
  assert.equal(v.vaultReady, true); assert.equal(v.vaultDraft, DRAFT.markdown);
  assert.equal(v.vaultHasSaveError, true); assert.match(v.vaultSaveError, /EBUSY/);
});

test('a preview error says why, and Try again asks again', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview({ error: 'the local model isn’t running — start Ollama or LM Studio and try again (no runtime)' });
  const v = t.c.renderVals();
  assert.equal(v.vaultFailed, true); assert.match(v.vaultError, /local model isn’t running/);
  v.vaultRetry();
  assert.deepEqual(t.calls.map((x) => x[0]), ['preview', 'preview']);
  assert.equal(t.c.renderVals().vaultDrafting, true);
});

test('closing while the draft is coming drops the late answer; Escape (closeTop) closes the dialog', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1');
  t.c.renderVals().vaultClose();
  await t.answerPreview(DRAFT);
  assert.equal(t.c.state.vault, null);
  assert.equal(t.c.renderVals().vaultOpen, false);
  t.c.openVaultPreview('code:s-1');
  t.c.closeTop();
  assert.equal(t.c.state.vault, null);
});

test('no bridge → "not wired"; a past snapshot → denied; neither asks for a draft', () => {
  const a = make({ withVault: false });
  a.c.openVaultPreview('code:s-1');
  assert.deepEqual(a.said, [['notWired', 'Save to vault']]);
  assert.equal(a.c.renderVals().clVaultOff, true);
  const b = make();
  b.c.setState({ snapOffset: 1 });
  b.c.openVaultPreview('code:s-1');
  assert.equal(b.said[0][0], 'denied');
  assert.deepEqual(b.calls, []);
});

test('an empty draft cannot be saved', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().onVaultEdit({ target: { value: '   ' } });
  assert.equal(t.c.renderVals().vaultSaveOff, true);
});

test('basisNote and the dialog markup say what the model did and that nothing is written before Save', () => {
  assert.equal(basisNote('placeholder-model', 12), 'Drafted by the local model (placeholder-model) from 12 chat messages. Check and edit it — nothing is written until you press Save.');
  assert.equal(basisNote(null, 1), 'Drafted by the local model (unknown model) from 1 chat message. Check and edit it — nothing is written until you press Save.');
  assert.match(extrasTpl, /<!-- v5: Save to vault \(Claude Hub H5/);
  assert.match(extrasTpl, /role="dialog" aria-label="Save to vault"/);
  assert.match(extrasTpl, /data-vault="save"/);
  assert.match(extrasTpl, /data-vault="replace"/);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test dashboard-v5/src/logic/claude-vault.test.mjs`
Expected: FAIL, `Cannot find module …/vals/claude-vault.js`.

- [ ] **Step 4: Implement the logic, the vals and the wiring**

`dashboard-v5/src/logic/claude-vault.js`:

```js
// Save to vault (Claude Hub H5; spec 2026-10-13 §9 Vault). The local model drafts (preview writes nothing), the owner
// edits, and ONLY the Save / Replace buttons write. Replace is sent only after the dialog asked; a save answered
// {exists:true} returns to that question — never an automatic second write. State: this.state.vault (app.js).
export const claudeVaultLogic = {
  vaultApi() {
    const v = this.hq && this.hq.claudeVault;
    return v && typeof v.preview === 'function' && typeof v.save === 'function' ? v : null;
  },
  async openVaultPreview(id) {
    const api = this.vaultApi();
    if (!api) { this.notWired('Save to vault'); return; }
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    if (typeof id !== 'string' || !id) return;
    const ticket = (this._vaultTicket = (this._vaultTicket || 0) + 1);
    this.setState({ vault: { id, phase: 'drafting' } });
    let r;
    try { r = await api.preview(id); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (ticket !== this._vaultTicket || !this.state.vault) return;   // closed or reopened while drafting
    if (!r || typeof r !== 'object' || r.error || typeof r.markdown !== 'string') {
      this.setState({ vault: { id, phase: 'error', error: (r && r.error) || 'no draft came back' } });
      return;
    }
    this.setState({ vault: { id, phase: 'ready', path: r.path, rel: r.rel, draft: r.markdown, exists: !!r.exists, model: r.model || null, basis: Number(r.basis) || 0, askReplace: false, saveError: null } });
  },
  onVaultEdit(e) {
    const v = this.state.vault;
    if (!v || v.phase !== 'ready') return;
    this.setState({ vault: Object.assign({}, v, { draft: String(e && e.target ? e.target.value : '') }) });
  },
  async saveVault(replace = false) {
    const v = this.state.vault, api = this.vaultApi();
    if (!v || v.phase !== 'ready' || !api || !String(v.draft || '').trim()) return;
    if (v.exists && replace !== true) { this.setState({ vault: Object.assign({}, v, { askReplace: true }) }); return; }
    const ticket = this._vaultTicket;
    this.setState({ vault: Object.assign({}, v, { phase: 'saving', askReplace: false, saveError: null }) });
    let r;
    try { r = await api.save(replace === true ? { path: v.path, markdown: v.draft, replace: true } : { path: v.path, markdown: v.draft }); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    if (r === true) this.toast('success', 'Saved to vault: ' + v.rel);
    if (ticket !== this._vaultTicket || !this.state.vault) return;   // closed meanwhile: the toast said what happened
    if (r === true) { this.setState({ vault: Object.assign({}, v, { phase: 'saved', askReplace: false }) }); return; }
    if (r && r.exists) { this.setState({ vault: Object.assign({}, v, { phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' }) }); return; }
    this.setState({ vault: Object.assign({}, v, { phase: 'ready', saveError: (r && r.error) || 'the note was not saved' }) });
  },
  keepVault() { const v = this.state.vault; if (v) this.setState({ vault: Object.assign({}, v, { askReplace: false }) }); },
  retryVault() { const v = this.state.vault; return v ? this.openVaultPreview(v.id) : Promise.resolve(); },
  closeVault() { this._vaultTicket = (this._vaultTicket || 0) + 1; this.setState({ vault: null }); },
};
```

`dashboard-v5/src/vals/claude-vault.js`:

```js
// Render values for Save to vault (Claude Hub H5): the thread view's button and the dialog (tpl/extras.tpl.js).
export const basisNote = (model, basis) => 'Drafted by the local model (' + (model || 'unknown model') + ') from ' + basis + ' chat message' + (basis === 1 ? '' : 's') + '. Check and edit it — nothing is written until you press Save.';

export function claudeVaultVals(ctx) {
  const { S, LIVE } = ctx;
  const v = S.vault || null, phase = v ? v.phase : null;
  const lib = LIVE && LIVE.claudeLib, conv = lib && lib.thread && lib.thread.conversation;
  const api = !!this.vaultApi(), can = this.canWrite();
  return {
    clVault: () => (conv && conv.id ? this.openVaultPreview(conv.id) : undefined),
    clVaultOff: !api || !conv || !conv.id || !can,
    clVaultTip: !api ? 'Save to vault is not wired in this window' : !can ? this.writeReason() : 'Draft a vault note from this chat with the local model — nothing is written until you press Save',
    vaultOpen: !!v,
    vaultDrafting: phase === 'drafting', vaultReady: phase === 'ready' || phase === 'saving', vaultSaving: phase === 'saving',
    vaultSaved: phase === 'saved', vaultFailed: phase === 'error',
    vaultError: (v && v.error) || '', vaultRel: (v && v.rel) || '', vaultDraft: (v && v.draft) || '',
    onVaultEdit: (e) => this.onVaultEdit(e),
    vaultBasis: v && (phase === 'ready' || phase === 'saving' || phase === 'saved') ? basisNote(v.model, v.basis) : '',
    vaultHasExists: !!(v && v.exists),
    vaultExistsNote: v && v.exists ? 'A note for this chat is already in the vault at this path. Saving asks before it replaces anything.' : '',
    vaultAskReplace: !!(v && v.askReplace),
    vaultSaveError: (v && v.saveError) || '', vaultHasSaveError: !!(v && v.saveError),
    vaultSaveOff: phase !== 'ready' || !String((v && v.draft) || '').trim(),
    vaultSaveLabel: phase === 'saving' ? 'Saving…' : 'Save',
    vaultSave: () => this.saveVault(false), vaultReplace: () => this.saveVault(true), vaultKeep: () => this.keepVault(),
    vaultRetry: () => this.retryVault(), vaultClose: () => this.closeVault(),
  };
}
```

`dashboard-v5/src/app.js`:
- Add `import { claudeVaultLogic } from './logic/claude-vault.js';` with the other logic imports.
- Append `claudeVaultLogic` to the `Object.assign(Component.prototype, …)` list.
- In `initState`'s returned object, add `vault: null,   // Save to vault dialog (Claude Hub H5, logic/claude-vault.js)`.
- In `closeTop`, the `order` array gets `'vault'` right after `'onboard'`, and the null-reset list `['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard']` gets `'vault'` too. Then `setState({ vault: null })` runs, and a late preview answer is dropped by the `!this.state.vault` check.
- In the overlay guard at app.js:362 (`if (S.levelUp || S.sheet || … || S.whatsNewOpen) return;`), add `|| S.vault`, so the app's single-key shortcuts never act behind the dialog.

`dashboard-v5/src/vals/index.js`: add `import { claudeVaultVals } from './claude-vault.js';` and append `claudeVaultVals` as the last `SURFACES` entry (after `extrasVals`).

- [ ] **Step 5: The markup**

Append to the `String.raw` template of `dashboard-v5/src/tpl/extras.tpl.js`, after the What's-new block's closing `</sc-if>` and before the closing backtick. Also add the line `// H5 adds the Save to vault dialog (z-index 1100: a dialog).` to the file's header comment.

```html
  <!-- v5: Save to vault (Claude Hub H5, spec 2026-10-13 §9 Vault): the local model's draft, editable; nothing is written until Save (or Replace, after it asked) -->
  <sc-if value="{{ vaultOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: scrim; only Close, Cancel or Escape dismiss it, so a stray click never drops an edited draft -->
    <div style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: the card, Settings' frame -->
      <div ref="{{ popIn }}" role="dialog" aria-label="Save to vault" style="width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:10px">
        <!-- v5: title row (Ask's "Local model" badge: the draft is the local model's) -->
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ Local model</span><span style="font-size:20px;flex:1">Save to vault</span><button type="button" onClick="{{ vaultClose }}" aria-label="Close" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <!-- v5: drafting -->
        <sc-if value="{{ vaultDrafting }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--muted)">The local model is drafting a summary, decisions, to-dos and links from this chat… Nothing is written yet.</div></sc-if>
        <!-- v5: the draft could not be made: why, and try again -->
        <sc-if value="{{ vaultFailed }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--orange)">{{ vaultError }}</div><div><button type="button" onClick="{{ vaultRetry }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Try again</button></div></sc-if>
        <!-- v5: the editable draft, where it will go, who drafted it -->
        <sc-if value="{{ vaultReady }}" hint-placeholder-val="{{ true }}">
          <div style="font-family:var(--term);font-size:12px;color:var(--text);word-break:break-all">VEEMO CORTEX / {{ vaultRel }}</div>
          <div style="font-size:12px;color:var(--muted)">{{ vaultBasis }}</div>
          <sc-if value="{{ vaultHasExists }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ vaultExistsNote }}</div></sc-if>
          <textarea aria-label="Note text" value="{{ vaultDraft }}" onChange="{{ onVaultEdit }}" disabled="{{ vaultSaving }}" spellcheck="false" style="min-height:320px;resize:vertical;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;line-height:1.5;padding:10px 12px"></textarea>
          <sc-if value="{{ vaultHasSaveError }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--orange)">{{ vaultSaveError }}</div></sc-if>
          <!-- v5: the replace question: only this chat's own note is ever offered, and only these buttons answer it -->
          <sc-if value="{{ vaultAskReplace }}" hint-placeholder-val="{{ false }}"><div role="alertdialog" aria-label="Replace the note" style="padding:10px 12px;border:1px solid var(--orange);border-radius:8px;font-size:13px">Replace the note that is already there? Its current text is overwritten with this draft. <button type="button" data-vault="replace" onClick="{{ vaultReplace }}" style="margin-left:8px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--orange);background:transparent;color:var(--orange);cursor:pointer">Replace</button><button type="button" onClick="{{ vaultKeep }}" style="margin-left:6px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Keep it</button></div></sc-if>
          <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" onClick="{{ vaultClose }}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Cancel</button><button type="button" data-vault="save" onClick="{{ vaultSave }}" disabled="{{ vaultSaveOff }}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab, var(--purple) 16%, transparent);color:var(--text);cursor:pointer">{{ vaultSaveLabel }}</button></div>
        </sc-if>
        <!-- v5: saved -->
        <sc-if value="{{ vaultSaved }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--text)">Saved to VEEMO CORTEX / {{ vaultRel }}.</div><div><button type="button" onClick="{{ vaultClose }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Close</button></div></sc-if>
      </div>
    </div>
  </sc-if>
```

In H2's thread header (the file found with the grep in **Files**), insert immediately before `<button type="button" onClick="{{ clTerminal }}"`:

```html
<!-- v5: Save to vault (Claude Hub H5) — the local model drafts, the owner edits and confirms; nothing is written before Save --><button type="button" data-cl="vault" onClick="{{ clVault }}" disabled="{{ clVaultOff }}" title="{{ clVaultTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer">Save to vault</button>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test dashboard-v5/src/logic/claude-vault.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 7: Attribute the golden change, re-record, and re-record the template hash (PowerShell)**

```powershell
$B = Join-Path $env:TEMP 'hq-h5-golden-before-t6'; $A = Join-Path $env:TEMP 'hq-h5-golden-after-t6'; Remove-Item -LiteralPath $A -Recurse -Force -ErrorAction SilentlyContinue
$env:GOLDEN_DUMP = $A; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
node dashboard-v5/tools/golden-diff.mjs $B $A --allow '^(clVault|clVaultOff|clVaultTip|onVaultEdit|vault[A-Z][A-Za-z]*)$'
```

Expected: every scenario is listed as `changed` with only the new top-level `vault*` / `clVault*` / `onVaultEdit` keys, no `UNEXPLAINED`, exit 0. Then:

```powershell
$env:UPDATE_GOLDEN = '1'; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:UPDATE_GOLDEN
node --test dashboard-v5/src/vals.golden.test.mjs
Remove-Item -LiteralPath $B, $A -Recurse -Force
node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import { createHash } from 'node:crypto'; console.log(t.length, Buffer.byteLength(t, 'utf8'), createHash('sha256').update(t).digest('hex'))"
```

Put the printed values in `src/tpl.hash.test.mjs` (`LENGTH`, `UTF8_BYTES`, `SHA256`). Add the history line `// 2026-10-16 H5 Save to vault: extras dialog + thread-view button (+<Δ> chars / +<Δ> bytes)`.

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS. This includes `honesty.test.mjs`: none of the new strings is on its deny-list of sample strings. If it flags one, reword that string; do not edit the deny-list.

- [ ] **Step 8: Commit**

```bash
git add -- dashboard-v5/src/logic/claude-vault.js dashboard-v5/src/logic/claude-vault.test.mjs dashboard-v5/src/vals/claude-vault.js dashboard-v5/src/vals/index.js dashboard-v5/src/app.js dashboard-v5/src/tpl/extras.tpl.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/src/tpl.hash.test.mjs
git commit -m "fe: Claude Hub H5.6 — v5 Save to vault dialog (local-model draft, editable, Save / Replace-after-asking only) + thread-view button

Goldens re-recorded: every scenario changed only by the new vault*/clVault*/onVaultEdit keys (golden-diff, attributed).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the grep in **Files** found the thread header in another `tpl/claude-*.tpl.js`, stage that file instead of `dashboard-v5/src/tpl/claude.tpl.js`.

---

### Task 7: Vault states in the selftest and goldens; CDP scenario `vault-preview-confirm`

**Files:**
- Modify: `dashboard-v5/src/selftest.js` (`CLEAR` gains `vault: null`; 4 `STATES` rows)
- Modify: `dashboard-v5/src/vals.golden.test.mjs` (5 scenarios) and `dashboard-v5/src/__golden__/vals.hashes.json` (re-record: additions only)
- Modify: `dashboard-v5/tools/cdp-gate.mjs` (`fresh()` resets `vault: null`; scenario `vault-preview-confirm`; header list)

**Interfaces:**
- Consumes:
  - Task 6's state `vault`, the vals keys, and the markup hooks (`role="dialog" aria-label="Save to vault"`, `data-vault="save"`, `data-vault="replace"`, `role="alertdialog" aria-label="Replace the note"`, `data-cl="vault"`).
  - Task 5's fake rows `claudeVault.preview` / `claudeVault.save`.
  - The `hqFake` control API: `set`, `calls`, `reset`.
  - H2's live `claudeLib.thread` and state `clOpen`, which render the thread view.
- Produces:
  - Selftest combos `vault-drafting`, `vault-ready-replace`, `vault-error` and `vault-saved`.
  - Golden scenarios `overlay.vault-drafting`, `overlay.vault-ready`, `overlay.vault-replace`, `overlay.vault-error` and `overlay.vault-saved`.
  - CDP scenario `vault-preview-confirm` (spec §11).

- [ ] **Step 1: Selftest**

In `dashboard-v5/src/selftest.js`:
- Add `vault: null` to the `CLEAR` object (a new overlay key: every combo starts with the dialog closed, and `RESTORE` picks it up from `Object.keys(CLEAR)`).
- After the `ASK_CLAUDE` declaration (Task 3), add:

```js
// H5 Save to vault: one draft in each dialog phase (synthetic path and text)
const VAULT_DRAFT = { id: 'code:selftest', path: 'C:\\selftest-vault\\30_Areas\\Claude\\selftest\\2026-10-01 Selftest chat.md', rel: '30_Areas/Claude/selftest/2026-10-01 Selftest chat.md', draft: '---\nconversation: "code:selftest"\n---\n# Selftest chat\n\n## Summary\nSynthetic.\n', model: 'selftest-model', basis: 4 };
```

- In `STATES`, after the `ask-claude` row:

```js
        ['vault-drafting', at('home'), { vault: { id: 'code:selftest', phase: 'drafting' } }],
        ['vault-ready-replace', at('home'), { vault: Object.assign({}, VAULT_DRAFT, { phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' }) }],
        ['vault-error', at('home'), { vault: { id: 'code:selftest', phase: 'error', error: 'selftest: the local model isn’t running' } }],
        ['vault-saved', at('home'), { vault: Object.assign({}, VAULT_DRAFT, { phase: 'saved', exists: false }) }],
```

- [ ] **Step 2: Golden scenarios (dump first, then edit, then attribute)**

First dump the goldens as they are now (PowerShell):

```powershell
$B = Join-Path $env:TEMP 'hq-h5-golden-before-t7'; $A = Join-Path $env:TEMP 'hq-h5-golden-after-t7'
Remove-Item -LiteralPath $B, $A -Recurse -Force -ErrorAction SilentlyContinue
$env:GOLDEN_DUMP = $B; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
```

Expected: PASS. The Step 1 selftest edit does not touch `renderVals()`.

Then, in `dashboard-v5/src/vals.golden.test.mjs`, after the `overlay.ask-claude` scenario (Task 3), add:

```js
// Claude Hub H5: the Save to vault dialog in each phase (an inert claudeVault bridge, so the button and actions are "wired")
const VAULT_HQ = { claudeVault: { preview() {}, save() {} } };
const VAULT_DRAFT = { id: 'code:s-1', path: 'C:\\placeholder-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md', draft: '---\nconversation: "code:s-1"\n---\n# Release planning\n\n## Summary\nPlaceholder.\n', model: 'placeholder-model', basis: 12 };
add('overlay.vault-drafting', { hq: VAULT_HQ, state: { vault: { id: 'code:s-1', phase: 'drafting' } } });
add('overlay.vault-ready', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'ready', exists: false, askReplace: false, saveError: null } } });
add('overlay.vault-replace', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' } } });
add('overlay.vault-error', { hq: VAULT_HQ, state: { vault: { id: 'code:s-1', phase: 'error', error: 'the local model isn’t running — start Ollama or LM Studio and try again (no runtime)' } } });
add('overlay.vault-saved', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'saved', exists: false } } });
```

Then dump again, attribute and record:

```powershell
$env:GOLDEN_DUMP = $A; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:GOLDEN_DUMP
node dashboard-v5/tools/golden-diff.mjs $B $A
```

Expected:
- The golden run FAILS only because the five new scenarios are not in the hashes file.
- golden-diff prints exactly five `added overlay.vault-*` lines, no `changed` line, and `every change is attributed` (exit 0).

Then:

```powershell
$env:UPDATE_GOLDEN = '1'; node --test dashboard-v5/src/vals.golden.test.mjs; Remove-Item Env:UPDATE_GOLDEN
node --test dashboard-v5/src/vals.golden.test.mjs
Remove-Item -LiteralPath $B, $A -Recurse -Force
```

Expected: the last run PASSES.

- [ ] **Step 3: CDP scenario**

In `dashboard-v5/tools/cdp-gate.mjs`:
- In `fresh(t)`'s `L.setState({ … })` list, add `vault: null,` next to `whatsNewOpen: false`.
- Add `vault-preview-confirm` to the header comment's scenario list.
- Add before the closing `};` of `SCENARIOS`:

```js
  // H5 (spec §9 Vault, §11 vault-preview-confirm): the thread view's "Save to vault" drafts (nothing written), the
  // owner's edit is what Save sends, a note that is there is replaced only through the Replace question, a save that
  // answers "exists" returns to that question without a second write, and Escape closes the dialog.
  async 'vault-preview-confirm'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const DIALOG = `document.querySelector('[role="dialog"][aria-label="Save to vault"]')`;
    const saves = () => t.evaluate(`hqFake.calls('claudeVault.save').map((c) => c.args[0])`);
    const click = (sel) => t.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
    const exists = (id) => ({ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', exists: true, model: 'fake-model', basis: 4,
      markdown: '---\nsource: claude-code\nconversation: "' + id + '"\n---\n# Fake release planning\n' });
    try {
      // a chat open in the thread view (H2), through the live store as the Chats tab leaves it
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.store.live.claudeLib = Object.assign({}, L.store.live.claudeLib, { thread: { conversation: { id: 'code:fake-1', title: 'Fake release planning', source: 'code' }, messages: [], hasMore: false } });
        L.go('claude', 'chats'); L.setState({ clOpen: true }); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="vault"]')`, 5000)) return ['the thread view has no "Save to vault" button'];
      if (!await click('[data-cl="vault"]')) return ['"Save to vault" was disabled for an open chat'];
      if (!await t.waitFor(`!!${DIALOG} && !!${DIALOG}.querySelector('textarea')`, 5000)) return ['the draft never showed'];
      const d = await t.evaluate(`(() => { const d = ${DIALOG}; return { text: d.textContent, draft: d.querySelector('textarea').value }; })()`);
      if (!d.draft.startsWith('---\nsource: claude-code\nconversation: "code:fake-1"')) out.push('the draft is not the preview’s markdown: ' + JSON.stringify(d.draft.slice(0, 80)));
      if (!d.text.includes('Drafted by the local model (fake-model) from 4 chat messages')) out.push('no "Drafted by the local model (fake-model) from 4 chat messages" note');
      if (!d.text.includes('VEEMO CORTEX / 30_Areas/Claude/project-a/2026-10-01 Fake release planning.md')) out.push('the destination path is not shown');
      if ((await saves()).length) out.push('something was saved before Save was pressed');
      // the owner's edit is what lands
      await t.evaluate(`(() => { const a = ${DIALOG}.querySelector('textarea'); a.focus(); a.setSelectionRange(a.value.length, a.value.length); return true; })()`);
      await t.type('my edit');
      await t.evaluate(`(() => { document.activeElement && document.activeElement.blur(); return true; })()`);
      await t.sleep(100);
      if (!await click('[data-vault="save"]')) out.push('Save was disabled');
      if (!await t.waitFor(`!!${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`, 5000)) out.push('no "Saved to" confirmation');
      let s = await saves();
      if (s.length !== 1 || !String(s[0].markdown).endsWith('my edit') || 'replace' in s[0]) out.push('save sent ' + JSON.stringify(s).slice(0, 300) + ', want one save of the edited text without replace');
      // a note that is already there: Save asks; Keep it writes nothing; Replace sends replace:true
      await t.evaluate(`(() => { hqFake.set('claudeVault.preview', ${exists.toString()}); WHQ.app.logic.closeVault(); WHQ.app.logic.openVaultPreview('code:fake-1'); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-vault="save"]')`, 5000)) out.push('the second draft never showed');
      await click('[data-vault="save"]');
      if (!await t.waitFor(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`, 3000)) out.push('Save on an existing note did not ask to replace it');
      if ((await saves()).length !== 1) out.push('asking to replace wrote something');
      await t.evaluate(`(() => { [...document.querySelectorAll('[role="alertdialog"][aria-label="Replace the note"] button')].find((b) => b.textContent.trim() === 'Keep it').click(); return true; })()`);
      await t.sleep(100);
      if (await t.evaluate(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`)) out.push('Keep it did not close the question');
      if ((await saves()).length !== 1) out.push('Keep it wrote something');
      await click('[data-vault="save"]');
      await t.waitFor(`!!document.querySelector('[data-vault="replace"]')`, 3000);
      await click('[data-vault="replace"]');
      await t.waitFor(`${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`, 5000);
      s = await saves();
      if (s.length !== 2 || s[1].replace !== true) out.push('Replace sent ' + JSON.stringify(s[1] || null).slice(0, 200) + ', want replace:true');
      // a save that answers "exists" goes back to the question, no second write
      await t.evaluate(`(() => { hqFake.set('claudeVault.preview', undefined); hqFake.set('claudeVault.save', { error: 'a note with this name is already there', exists: true }); WHQ.app.logic.closeVault(); WHQ.app.logic.openVaultPreview('code:fake-1'); return true; })()`);
      await t.waitFor(`!!document.querySelector('[data-vault="save"]')`, 5000);
      await click('[data-vault="save"]');
      if (!await t.waitFor(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`, 3000)) out.push('a save answering "exists" did not return to the Replace question');
      await t.sleep(300);
      if ((await saves()).length !== 3) out.push('a save answering "exists" was retried on its own (' + (await saves()).length + ' saves)');
      // Escape closes the dialog
      await t.press('Escape');
      await t.sleep(100);
      if (await t.evaluate(`!!${DIALOG}`)) out.push('Escape did not close the dialog');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.closeVault(); L.setState({ clOpen: false }); if (L.store.live.claudeLib) L.store.live.claudeLib.thread = null; return true; })()`).catch(() => {});
    }
    return out.concat(t.errors());
  },
```

`exists.toString()` puts the function's source into the page, where `hqFake.set` calls it with the preview's arguments. This works because it uses no outer variable.

- [ ] **Step 4: Run the suites, the selftest and the gate (PowerShell, repo root)**

```powershell
node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs
Push-Location dashboard-v5; $env:HQ_V5_PROFILE = 'h5-t7-selftest'; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest; "exit $LASTEXITCODE"; Remove-Item Env:HQ_V5_PROFILE; Pop-Location
Push-Location dashboard-v5; $env:HQ_V5_PROFILE = 'h5-t7-gate'
$p = Start-Process -PassThru -FilePath ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9352'
node tools/cdp-gate.mjs --port 9352 --scenario all; "exit $LASTEXITCODE"
Stop-Process -Id $p.Id; Remove-Item Env:HQ_V5_PROFILE; Pop-Location
```

Expected:
- The suites PASS.
- The selftest exits 0 with `errors: 0, unresolved: 0, failures: 0`, including the four `vault-*` combos.
- Every CDP scenario prints `PASS`, including `ask-claude-chip`, `vault-preview-confirm` and H2's `claude-thread-open`, and the gate exits 0.
- Stop only `$p.Id`.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: Claude Hub H5.7 — Save to vault in the selftest (4 combos), goldens (5 scenarios, additions only) and CDP scenario vault-preview-confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: H5 gate on a real second instance (fixtures), docs, HANDOFF

The owner's app is **not** restarted here: the controller does that after the phase lands.

**Files:**
- Modify: `CLAUDE.md` ("Facts that save you time": one line), `docs/sync/CONTRACT.md` (the vault-note entry), `docs/sync/HANDOFF.md` (entry on top)
- `README.md`: no change. Its test section already runs `dashboard/*.test.mjs`, `dashboard/claude-hub/*.test.mjs` and the v5 globs, which pick up every new H5 test file. Step 4 checks this.
- Temp only (never committed): `$g\gate-h5.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
  - The real preload: `hq.llm.chat`, `hq.probeLlm`, `hq.claudeVault.*`.
  - H2's `clOpenChat(id)` and Chats tab.
  - H1's `makeClaudeHome(dir) → { home }` fixture (chat `code:sess-a1`, "Release planning", 2026-10-01).
  - The env overrides `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB`, `HQ_VAULT_DIR`, `HQ_APP_LOG_DIR`, `HQ_DRY_LAUNCH`, `HQ_UI_VERSION`.
- Produces: no code. A gate report (in the HANDOFF entry), docs and contract rows.

- [ ] **Step 1: Every suite, the selftest, the fake-harness gate**

Run the Global Constraints' suites. The commands:
- `node --test dashboard/claude-hub/*.test.mjs`
- `node --test dashboard/*.test.mjs`
- the v5 suite
- the v5 selftest (`HQ_V5_PROFILE='h5-final-selftest'`)
- `node dashboard-v5/tools/cdp-gate.mjs --scenario all` against a `--preload=fake` harness on port 9353, stopping only that harness's PID afterwards

Expected: everything PASSES, the selftest exits 0 with errors/unresolved/failures 0, and every CDP scenario prints `PASS`.

- [ ] **Step 2: A real second instance on fixtures (PowerShell, repo root)**

```powershell
$g = Join-Path $env:TEMP ('hq-h5-gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory -Path $g | Out-Null
node --input-type=module -e "import { makeClaudeHome } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs'; console.log(makeClaudeHome(process.argv[1]).home)" $g
$ownerVault = Join-Path $env:USERPROFILE 'Documents\VEEMO CORTEX\30_Areas\Claude'
$vaultBefore = if (Test-Path -LiteralPath $ownerVault) { Get-ChildItem -LiteralPath $ownerVault -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2 } else { 'absent' }
$dataBefore = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'      # the folder makeClaudeHome printed
$env:HQ_CLAUDE_DB   = Join-Path $g 'hub.sqlite'
$env:HQ_VAULT_DIR   = Join-Path $g 'vault'; New-Item -ItemType Directory -Path (Join-Path $env:HQ_VAULT_DIR '30_Areas') -Force | Out-Null
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9496'
$p.Id   # the ONLY electron pid this task may stop
```

If `makeClaudeHome` printed a home other than `$g\.claude`, set `$env:HQ_CLAUDE_HOME` to the printed path **before** `Start-Process`.

Write `$g\gate-h5.mjs`. It holds a short CDP driver and the checks; every check pushes a failure string, and the script prints JSON and exits 1 on any failure:

```js
// gate-h5.mjs <port> <vaultDir> — Claude Hub H5 real-instance gate (fixtures only). Never run against the owner's app.
import fs from 'node:fs';
import path from 'node:path';
const [port, vault] = [Number(process.argv[2]), process.argv[3]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const waiting = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = list.find((x) => x.type === 'page' && /index\.html/.test(x.url)); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch {}
    await sleep(500);
  }
  if (!ws) throw new Error('no page on port ' + port);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
}
async function ev(expr) {
  const id = ++seq; ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  const d = await new Promise((r) => waiting.set(id, r));
  if (d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'evaluate failed');
  return d.result.result.value;
}
async function until(expr, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; }
const fails = [], report = {};
await connect();
if (!await until(`!!(window.WHQ && WHQ.app && WHQ.app.logic && window.hq)`, 30000)) { console.log(JSON.stringify({ fails: ['the app never mounted'] })); process.exit(1); }
// 1. the Hub indexed the fixture
if (!await until(`hq.claudeHub.health().then((h) => h.state === 'ready' && h.counts.conversations >= 3)`, 30000)) fails.push('the Hub never indexed the fixture');
// 2. Ask with Claude history: the section is there and cites the fixture chat (the local model may be offline: sections come first)
const ask = (inc) => `hq.llm.chat({ jobId: 'or-' + Date.now().toString(36) + '-gate1', messages: [{ role: 'user', content: 'What was the placeholder release plan?' }], include: ${JSON.stringify(inc)} })`;
const r1 = await ev(ask({ claude: true }));
const c1 = (r1.sections || []).find((s) => s.id === 'claude');
report.ask = { status: r1.status, claude: c1 };
if (!c1 || !c1.chars || !(c1.cites || []).includes('chat Release planning, 2026-10-01')) fails.push('Ask: no Claude history section citing "chat Release planning, 2026-10-01": ' + JSON.stringify(c1));
const r0 = await ev(ask({ scan: true }));
if ((r0.sections || []).some((s) => s.id === 'claude')) fails.push('Ask unticked still asked the Hub');
// 3. the chip in the panel
await ev(`(() => { WHQ.app.logic.setState({ askOpen: true }); return true; })()`); await sleep(300);
const chips = await ev(`[...document.querySelectorAll('aside[aria-label="Ask"] [aria-label="Context sources"] button')].map((b) => b.textContent.trim())`);
if (chips.length !== 7 || chips[6] !== 'Claude history') fails.push('chips: ' + JSON.stringify(chips));
await ev(`(() => { WHQ.app.logic.setState({ askOpen: false }); return true; })()`);
// 4. Save to vault from the thread view
await ev(`(() => { const L = WHQ.app.logic; L.go('claude', 'chats'); return L.clOpenChat('code:sess-a1').then(() => true); })()`);
if (!await until(`!!document.querySelector('[data-cl="vault"]') && !document.querySelector('[data-cl="vault"]').disabled`)) fails.push('no enabled "Save to vault" button on the open chat');
const model = await ev(`hq.probeLlm({ force: true }).then((p) => (p && p.available && p.chatModel) || null)`);
report.localModel = model;
await ev(`(() => { document.querySelector('[data-cl="vault"]').click(); return true; })()`);
const DIALOG = `document.querySelector('[role="dialog"][aria-label="Save to vault"]')`;
const rel = '30_Areas/Claude/project-a/2026-10-01 Release planning.md';
const file = path.join(vault, ...rel.split('/'));
if (model) {
  if (!await until(`!!${DIALOG} && !!${DIALOG}.querySelector('textarea')`, 150000)) fails.push('the local model never produced a draft');
  if (fs.existsSync(file)) fails.push('the note exists before Save was pressed');
  await ev(`(() => { document.querySelector('[data-vault="save"]').click(); return true; })()`);
  if (!await until(`${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`)) fails.push('no "Saved to" after Save');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!/^---\nsource: claude-code\nconversation: "code:sess-a1"\nproject: "\[\[project-a\]\]"\ncreated: \d{4}-\d{2}-\d{2}\n/.test(text)) fails.push('the saved note’s frontmatter is wrong: ' + JSON.stringify(text.slice(0, 200)));
  // a second Save asks before replacing
  await ev(`(() => { const L = WHQ.app.logic; L.closeVault(); L.openVaultPreview('code:sess-a1'); return true; })()`);
  if (!await until(`!!document.querySelector('[data-vault="save"]')`, 150000)) fails.push('the second draft never came');
  await ev(`(() => { document.querySelector('[data-vault="save"]').click(); return true; })()`);
  if (!await until(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`, 5000)) fails.push('saving over this chat’s own note did not ask to replace it');
  if (fs.readFileSync(file, 'utf8') !== text) fails.push('the note changed before Replace');
  await ev(`(() => { WHQ.app.logic.closeVault(); return true; })()`);
} else {
  if (!await until(`!!${DIALOG} && /local model isn’t running/.test(${DIALOG}.textContent)`, 20000)) fails.push('no "local model isn’t running" message without a model');
  await ev(`(() => { WHQ.app.logic.closeVault(); return true; })()`);
  // the real save path, driven directly: write, refuse without replace, replace
  const md = '---\nsource: claude-code\nconversation: "code:sess-a1"\nproject: "[[project-a]]"\ncreated: 2026-10-16\n---\n# Release planning\n\n## Summary\nGate.\n';
  const s1 = await ev(`hq.claudeVault.save({ path: ${JSON.stringify(rel)}, markdown: ${JSON.stringify(md)} })`);
  const s2 = await ev(`hq.claudeVault.save({ path: ${JSON.stringify(rel)}, markdown: ${JSON.stringify(md + 'two\n')} })`);
  const s3 = await ev(`hq.claudeVault.save({ path: ${JSON.stringify(rel)}, markdown: ${JSON.stringify(md + 'three\n')}, replace: true })`);
  report.save = { s1, s2, s3 };
  if (s1 !== true || !(s2 && s2.exists === true) || s3 !== true || fs.readFileSync(file, 'utf8') !== md + 'three\n') fails.push('save / refuse / replace: ' + JSON.stringify(report.save));
}
const out = await ev(`hq.claudeVault.save({ path: '30_Areas/Projects/x.md', markdown: '---\\nconversation: "code:sess-a1"\\n---\\n' })`);
if (!out || !out.error) fails.push('a save outside 30_Areas/Claude was not refused');
const tmpLeft = fs.readdirSync(vault, { recursive: true }).map(String).filter((f) => f.endsWith('.tmp'));
if (tmpLeft.length) fails.push('temp files left in the vault: ' + tmpLeft.join(', '));
console.log(JSON.stringify({ fails, report }, null, 2));
process.exit(fails.length ? 1 : 0);
```

Run: `node $g\gate-h5.mjs 9496 $env:HQ_VAULT_DIR`
Expected: `"fails": []`, exit 0. `report.localModel` says which branch ran: the model's id, or `null` when no local model is up. Put it in the HANDOFF entry.

Then check the Hub-down path on this instance. Stop only the Hub child of `$p`, then ask once while it restarts:

```powershell
$hub = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id) AND Name='node.exe'" | Where-Object { $_.CommandLine -like "*hub.mjs*" -and $_.CommandLine -like "*$g*" }
$hub.ProcessId   # must be exactly one, and its command line must name $g\hub.sqlite — never data\claude\hub.sqlite
Stop-Process -Id $hub.ProcessId
```

Then run immediately (inside the 1 s restart backoff):

```powershell
node --input-type=module -e "const l=await (await fetch('http://127.0.0.1:9496/json')).json();const ws=new WebSocket(l.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`hq.llm.chat({jobId:'or-'+Date.now().toString(36)+'-gate2',messages:[{role:'user',content:'release plan'}],include:{scan:true,claude:true}}).then(r=>JSON.stringify(r.sections))`,awaitPromise:true,returnByValue:true}}));ws.onmessage=(m)=>{console.log(JSON.parse(m.data).result.result.value);process.exit(0)}"
```

Expected: the printed sections hold `{"id":"claude",…,"chars":0,…,"note":"Claude Hub …"}`. The note is "Claude Hub is not running" or "Claude Hub stopped while answering", or, if the Hub already came back, a normal section with cites. Record which one you saw. The scan section is present either way. Within 10 s, `hq.claudeHub.health()` reports `ready` again (re-run the gate's check 1 if in doubt).

- [ ] **Step 3: Nothing of the owner's was touched; stop only your PIDs**

```powershell
$vaultAfter = if (Test-Path -LiteralPath $ownerVault) { Get-ChildItem -LiteralPath $ownerVault -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2 } else { 'absent' }
$dataAfter = Get-ChildItem -LiteralPath data\claude -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^hub\.sqlite' } | Select-Object Name, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 2
"vault same: $($vaultBefore -eq $vaultAfter)  data/claude same: $($dataBefore -eq $dataAfter)"
Select-String -Path "$g\logs\*" -Pattern 'placeholder release','Release planning' -SimpleMatch
git status --short
Stop-Process -Id $p.Id
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$g*" } | ForEach-Object { Stop-Process -Id $_.ProcessId }
Remove-Item -LiteralPath $g -Recurse -Force
Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_VAULT_DIR, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION
```

Expected:
- `vault same: True  data/claude same: True`. The owner's own `hub.sqlite*` files are excluded, because the owner's running app writes them.
- `Select-String` prints nothing: no chat text in the logs.
- `git status --short` shows only the other lane's four known files, plus this plan file if the controller has not committed it yet (nothing else: this task's docs are not edited yet, and `.superpowers/` is gitignored).
- The node cleanup only matches processes whose command line names `$g`.
- Never stop the owner's `electron.exe . --hidden` or its Hub on `data\claude\hub.sqlite`, and do **not** restart the owner's app.

- [ ] **Step 4: Docs**

`CLAUDE.md`, under "Facts that save you time", after the Claude Hub line:

```
- Claude Hub H5: Ask's 7th chip "Claude history" (`hq-oracle-include.claude`, written only while on) asks the Hub op `contextFor` through `llm-context.js` (3 000-char reserve). "Save to vault" (`dashboard/claude-vault.js`, IPC `hq:claude-vault:preview|save`) drafts with the LOCAL model and writes one note only on the owner's Save, under `VEEMO CORTEX/30_Areas/Claude/<Project>/`; Replace only for that chat's own note. Gates override the vault with `HQ_VAULT_DIR`; tests `node --test dashboard/claude-vault.test.mjs dashboard/llm-context.test.mjs`.
```

`docs/sync/CONTRACT.md`: after the `data/claude/` entry, add:

```
### `VEEMO CORTEX/30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md` — Claude chat notes (frontend lane, owner's vault, Claude Hub H5)

Written only by `dashboard/claude-vault.js`, one note per owner-confirmed Save. Names: `safeSegment` (no `\/:*?"<>|[]#^`, no control chars, no leading dot / trailing dot or space, DOS device names prefixed `_`, ≤ 60 code points); a name used by another chat takes ` (2)`…` (9)`. Frontmatter (YAML; strings JSON-quoted): `source` (`claude-code` | `claude.ai`), `conversation` (Hub id — how a later Save recognises "this chat's own note"), `project` (`"[[<WorkspaceHQ project note or Claude project name>]]"`), `created` (YYYY-MM-DD), `chat_date`, `title`, `drafted_by` ("local model <id>, from N chat messages"), `tags: [claude]`. Body: `# <title>`, a `Project: [[…]]` line, then the owner-edited Summary / Decisions / To-dos / Links. The structure lane's pipeline never writes here; Ask's Vault source reads these notes like any other (they carry no `generated_by: workspacehq-pipeline`).
```

`README.md`: confirm that lines 88–90 still list `node --test dashboard/*.test.mjs`, `node --test dashboard/claude-hub/*.test.mjs` and the v5 globs. Those cover `llm-context.test.mjs`, `claude-vault.test.mjs`, `claude-hub/context.test.mjs`, `logic/claude-vault.test.mjs` and `tools/golden-diff.test.mjs`. No edit.

`docs/sync/HANDOFF.md`, new entry on top (fill in the real short sha and times; keep it under ~15 lines):

```
## 2026-10-16 <hh:mm> · FROM frontend · main @ <short-sha>
DONE: Claude Hub H5 (plan docs/superpowers/plans/2026-10-15-claude-hub-h5.md), commits H5.1–H5.7 + this meta commit: Hub op contextFor
  (context.mjs; OR-of-keywords FTS, cited "chat <title>, <date>", inside a budget); llm-context.js 'claude' section
  (3 000-char reserve, Hub-down notes; unticked = byte-identical); Ask's 7th chip "Claude history"; Save to vault
  (claude-vault.js: local-model draft → editable v5 dialog → atomic write under VEEMO CORTEX/30_Areas/Claude/, Replace
  only for the chat's own note); golden-diff.mjs; CDP ask-claude-chip, vault-preview-confirm. Real-instance gate on
  fixtures: PASS (local model: <id | none → offline branch>; Hub-down note seen: "<…>").
IN-FLIGHT: none. The owner's app was NOT restarted (controller's step); the extension is unchanged.
ASKS: none.
BREAKS: main.js +2 lines (claudeHub passed to llmContext.assemble in hq:llm:chat; require('./claude-vault').init after
  the Hub host init). New IPC hq:claude-vault:preview|save + preload hq.claudeVault; hq:llm:chat include.claude +
  sections[].cites (IPC-CONTRACT rows). hq-oracle-include gains "claude" only while on (v3 rollback drops it — spec).
  New env HQ_VAULT_DIR (gates). CONTRACT.md: the vault-note shape.
```

- [ ] **Step 5: Commit**

```bash
git add -- CLAUDE.md docs/sync/CONTRACT.md docs/sync/HANDOFF.md
git commit -m "meta: Claude Hub H5 done — real-instance gate on fixtures, facts, vault-note contract, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (run by the planner)

- **Spec coverage:**
  - §6 `contextFor({query, budgetChars})`: Task 1.
  - §9 Ask, the `llm-context.js` "claude" section inside the existing budgets through the main-side Hub host: Task 2.
  - The seventh chip, stored as the extra key `claude` in `hq-oracle-include` and dropped by a v3 rollback, with answers citing "chat <title>, <date>": Tasks 2 (persona + cites) and 3.
  - §9 Vault preview → editable preview in v5 → confirm → atomic write: Tasks 4, 5 and 6.
    - The path rule (`30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md`), the frontmatter (`source`, `conversation`, `project: [[…]]`, `created`) and the project wikilink are in Task 4.
    - "Never overwrite without a replace confirm" is enforced in Tasks 4, 5 and 6.
    - "Never automatic or bulk": one path per save, owner's button only (Tasks 5 and 6).
  - §7 `claudeVault.preview/save`: Task 5.
  - §11 scenarios `ask-claude-chip` (Task 3) and `vault-preview-confirm` (Task 7).
  - Additive deviations are written under "Phase definitions and deviations".
- **Placeholder scan:** no "TBD" or "similar to Task N". Two values are written during execution:
  - The tpl-hash constants are computed by the given command.
  - The H2 thread-header file is located by the given grep.
- **Type consistency:**
  - `ContextResult` (Task 1) is consumed by `claudeSection` (Task 2) through `text` / `cites` / `note`.
  - `sections[].cites` (Task 2) is read by `metaLine` (Task 3).
  - The preview answer `{path, rel, markdown, exists, model, basis}` and the save request `{path, markdown, replace?}` are the same in Tasks 5, 6 and 7 and in the fake.
  - The state `vault.phase` values are the same in the logic, vals, selftest, goldens and the gate.
- **Review Focus pins:**
  1. Task 1's keyword, OR and hostile-query tests.
  2. Task 2's "Review Focus 2" tests.
  3. Task 2's "Review Focus 3" test, plus Task 1's no-index and broken-index tests.
  4. Task 4's `safeSegment` / `planNote` / `choosePath` / `resolveSavePath` (incl. junction) tests and Task 5's "another chat’s note" and "save refuses" tests.
  5. Task 4's `writeNoteAtomic` tests, Task 5's "preview → save → exists" test, and Task 6's Replace and "exists" tests.

<!-- plan complete: 8 tasks -->
