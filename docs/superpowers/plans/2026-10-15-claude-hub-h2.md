# Claude Hub H2 (Library + activity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can browse, filter and search every indexed Claude Code session inside WorkspaceHQ (Claude tab: Chats with a paged thread view and Forget, Projects with link chips), sees each project's last chats on its project page, a "Claude activity" strip on History, and a Reindex button on System, while H1's ten deferred housekeeping gaps are closed.

**Architecture:** The Hub process (`dashboard/claude-hub/hub.mjs`, system Node ≥ 22.13) gains the ops `stats` and `link` and a pure linker (`link.mjs`) that auto-matches Claude Code project folders to WorkspaceHQ projects from `data/latest.json` (read-only). `claude-hub-host.js` bridges the spec §7 channels (`projects/conversations/conversation/search/stats/link/forget`, plus a new `reindex`) to IPC; Hub results cross IPC unchanged (snake_case rows, as H5 consumes them) and v5 maps them in `live/adapter.mjs`. v5 keeps all fetched library data in `store.live.claudeLib` (store-owned refresh on `changed` events) and only UI selections in component state.

**Tech Stack:**
- Node 25 (system) with `node:sqlite` (FTS5, window functions) for the Hub.
- Electron 32 main (CommonJS) for the host.
- The v5 renderer (vanilla ESM, dc-lite templates, no build step).
- `node --test`, the v5 selftest and `dashboard-v5/tools/cdp-gate.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md` — this phase covers §6 `stats`/`link` + `link.mjs` auto-match; §7 `claudeHub.projects/conversations/conversation/search/stats/link/forget`; §9 Claude tab Chats + Projects, project-page "Claude" section, History "Claude activity" strip, System Reindex; §11 CDP scenarios `claude-library-search`, `claude-thread-open`; plus the H1 deferred housekeeping list. The H1 plan (`docs/superpowers/plans/2026-10-13-claude-hub.md`) holds the outline this plan details.

## Global Constraints

Binding, from the spec and the H1 plan:
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

H2-specific (decided here):
- Commit trailer for this plan: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — an executor on another model writes its own model name.
- Hub op results stay snake_case rows exactly as H1 returns them (H5's plan consumes `getConversation`/`listProjects` that way); every new Hub argument is optional and additive. Mapping to view models happens only in `dashboard-v5/src/live/adapter.mjs`.
- Snippet highlights (`\u0002…\u0003`) are rendered by splitting into text parts bound as text (`{{ }}` → textContent); no HTML string is ever built from Hub text.
- `INDEX_VERSION` goes 1 → 2 in Task 3 (surrogate-safe cuts + masked cwd change what is indexed): the owner's app rebuilds its index once after the restart the controller does at the end.

## Review Focus

1. **Many lines share one timestamp.** Claude Code writes one line per content block with the same `timestamp`, so dozens of messages (and sometimes conversations) tie on `at` at a page boundary. "Load earlier" must neither skip nor repeat a message, and the Chats list must neither skip nor repeat a chat. *Pinned in Task 1 (store tests with 7 tied messages, page size 3) and Task 9 (thread "Load earlier" uses the `{before, beforeId}` cursor).*
2. **Hostile or broken snippets.** Indexed text can contain `<img src=x onerror=…>` or `<script>`, FTS can cut a snippet so a `\u0002` has no `\u0003` (or the reverse), and a query of only punctuation has no terms. Hits render as text, never as markup; unbalanced markers never swallow text; a no-term query shows why instead of "0 results". *Pinned in Task 8 (`snippetParts` tests) and Task 11 (`claude-library-search` asserts no `img`/`script` element exists in the hit list).*
3. **A forked or resumed session copies its parent's API responses** (same `api_id` in two conversations). Activity tokens count each response once, and the per-project rows add up to the total. *Pinned in Task 2 (store `stats` test with a copied response across two conversations).*
4. **Work after local midnight.** The owner is in UTC+1/+2; a session at 00:30 local is 22:30 UTC the previous day. Activity days are bucketed in the owner's local day (`tzOffsetMin`), not UTC. *Pinned in Task 2 (store test at 23:30Z with +120 min) and Task 8 (store passes `-new Date().getTimezoneOffset()`).*
5. **The owner unlinks an auto-matched project, then a new scan lands.** An unlinked (`rejected`) or `confirmed` link is never overwritten by auto-matching; only `none`/`auto` rows are (re)matched, and a reindex keeps every link (projects survive `resetCode`). *Pinned in Task 4 (`autoLink` tests) and Task 5 (Hub test: link → reindex → link kept).*

---

## File structure (H2)

| File | Responsibility |
|---|---|
| `dashboard/claude-hub/store.mjs` (+ `store.test.mjs`) | (at, id) paging cursors; list filters `q`/`since`/`hqProjectId`; `stats`; `setLink`/`linkRows`; `secure_delete`; `optimize()`; `indexVersion` stamp on a new db |
| `dashboard/claude-hub/parse-code.mjs`, `redact.mjs`, `ingest-code.mjs` (+ tests) | surrogate-safe `cutText`; masked cwd; `INDEX_VERSION = 2`; `ingestTracked` (last_error cleared on success, timestamped); `titled` flag |
| `dashboard/claude-hub/link.mjs` (+ `link.test.mjs`) — new | pure `matchProject(cwd, hqProjects)`, `readHqProjects(file)`, `autoLink(store, hqProjects)` |
| `dashboard/claude-hub/hub.mjs` (+ `hub.test.mjs`) | ops `stats`, `link`; `--latest` auto-link; `changed` on titles + max-wait; optimize after a forced rebuild; `lastErrorAt`; lock-owner node name + alive re-check; reader retry/upgrade |
| `dashboard/claude-hub-host.js` (+ `.test.mjs`) | IPC handlers for the §7 channels + `reindex`; `--latest` passed to the Hub |
| `dashboard/preload.js` | `hq.claudeHub.{projects,conversations,conversation,search,stats,link,forget,reindex}` (additive) |
| `dashboard-v5/tools/fake-preload.js` (+ test) | canned placeholder answers for every new method |
| `dashboard-v5/src/live/adapter.mjs`, `live/store.js` (+ tests) | view-model normalisers (`snippetParts`, …); `live.claudeLib` + load/refresh functions |
| `dashboard-v5/src/live/catalog.mjs`, `src/app.js` | `SUBS.claude` gains Chats (default) and Projects; state keys; tab-change refresh; mixin wiring |
| `dashboard-v5/src/logic/claude-lib.js` — new | actions: filters, search, open thread, load earlier, expand tool row, forget, link, reindex |
| `dashboard-v5/src/vals/claude-lib.js` — new | render values for Chats, thread, Projects, project-page Claude section, History strip, System reindex |
| `dashboard-v5/src/tpl/claude.tpl.js`, `project-page.tpl.js`, `history.tpl.js`, `system.tpl.js` | marked markup additions |
| `dashboard-v5/src/selftest.js`, `src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json`, `src/tpl.hash.test.mjs` | combos + scenarios + re-records |
| `dashboard-v5/tools/cdp-gate.mjs` | scenarios `claude-library-search`, `claude-thread-open` |
| `docs/sync/IPC-CONTRACT.md`, `docs/sync/CONTRACT.md`, `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | rows before handlers, data shape notes, test commands, handoff |

Deviations from the spec, decided here (each with its reason):
- **`reindex` gets an IPC channel** (`claudeHub.reindex()` → `hq:claude-hub:reindex`), which §7 does not list: §9 puts a Reindex button on System, and the renderer can only reach the Hub through IPC.
- **`stats` tokens are per project, not per day.** §6 says "per-day counts, active_ms, tokens", but the `usage` table (H1 deviation) has no timestamp per API response, and §9's History strip asks for "tokens per project where recorded". Per-day series carry counts and active time; tokens come per project, deduplicated by `api_id`, over the chats active in the range. Adding a per-response timestamp would be a schema change with no screen that needs it.
- **New optional list arguments** `q` (title substring; §6 already names `q?`), `since` (date filter, §9 "date filters"), `hqProjectId` (project-page section, §9) and the cursor tiebreak `beforeId` (ruling: paging by (at, id)).
- **The thread view's "Continue" (composer) and "Save to vault" are not in H2**: §12 rollout puts the composer in H3 and the vault preview in H5; H2 ships "Open in terminal" and "Forget" from §9's thread actions. claude.ai rows and Projects arrive with H4 (the `claude.ai` source chip simply matches nothing until then).
- **"New chat" on the project page opens Claude in a terminal** (the existing `hq.claudeQuest` path, labelled "uses your Claude quota") until H3's composer exists; H3 replaces the handler, not the markup.

---

### Task 1: Store paging tiebreak (at, id) and list filters (`store.mjs`)

H1 deferred item 1. Closes Review Focus 1.

**Files:**
- Modify: `dashboard/claude-hub/store.mjs` (`listConversations` :201, `getConversation` :210)
- Test: `dashboard/claude-hub/store.test.mjs` (append)

**Interfaces:**
- Consumes: `openStore(file)`, `upsertProject`, `ensureConversation`, `addMessages`, `setTitle` (H1, unchanged).
- Produces (additive; every new argument optional, old calls behave as before):
  - `listConversations({ projectId?, source?, q?, since?, hqProjectId?, before?, beforeId?, limit=100 }) -> rows` — order `c.last_at DESC, c.id DESC`; cursor = the last row's `{ before: row.last_at, beforeId: row.id }`; `before` alone keeps H1's strict `<` meaning; `q` = title substring (LIKE with `%`, `_`, `\` escaped, compared on `lower()`); `since` = ISO instant, `c.last_at >= since`; `hqProjectId` = `p.hq_project_id = ?` (a `rejected` link always has `hq_project_id = NULL`, Task 2, so no link_state clause is needed).
  - `getConversation({ id, limit=200, before?, beforeId? }) -> {conversation, messages, hasMore} | null` — within one `at`, messages keep FILE order (`rowid`), because one assistant response is several lines with the same timestamp and their order is the reading order. Cursor = the first (oldest) returned message's `{ before: m.at, beforeId: m.id }`; the store resolves `beforeId` to its rowid. Deviation from "tiebreak by id" (reason): a message id is `code:<session>:<uuid>`, and uuid order would shuffle the blocks of one response; rowid keeps reading order and is still a total order. Conversations do tiebreak by `id`.

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-hub/store.test.mjs
const seedTies = (s) => {
  s.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'project-a', path: 'C:\\placeholder\\project-a' });
  const at = '2026-10-01T10:00:00.000Z';
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    s.ensureConversation({ id: 'code:' + n, source: 'code', projectId: 'code:p', nativeId: n });
    s.addMessages('code:' + n, [{ id: 'code:' + n + ':m', role: 'user', at, text: 'hello ' + n }]);
  }
  s.ensureConversation({ id: 'code:t', source: 'code', projectId: 'code:p', nativeId: 't' });
  // 7 lines sharing one timestamp, ids deliberately NOT in file order
  s.addMessages('code:t', ['z', 'b', 'y', 'a', 'x', 'c', 'w'].map((u, i) => ({ id: 'code:t:' + u, role: 'assistant', at, text: 'block ' + i })));
};

test('conversation list pages by (last_at, id): no chat skipped or repeated on a tie', () => {
  const s = openStore(tmpDb()); seedTies(s);
  const seen = []; let cur = {};
  for (;;) {
    const rows = s.listConversations({ limit: 2, ...cur });
    if (!rows.length) break;
    seen.push(...rows.map((r) => r.id));
    const last = rows[rows.length - 1]; cur = { before: last.last_at, beforeId: last.id };
  }
  assert.deepEqual(seen, ['code:t', 'code:c5', 'code:c4', 'code:c3', 'code:c2', 'code:c1']);
  s.close();
});

test('thread pages keep file order inside one timestamp and never skip or repeat', () => {
  const s = openStore(tmpDb()); seedTies(s);
  let page = s.getConversation({ id: 'code:t', limit: 3 });
  const got = [page.messages.map((m) => m.text)];
  while (page.hasMore) {
    const first = page.messages[0];
    page = s.getConversation({ id: 'code:t', limit: 3, before: first.at, beforeId: first.id });
    got.unshift(page.messages.map((m) => m.text));
  }
  assert.deepEqual(got.flat(), ['block 0', 'block 1', 'block 2', 'block 3', 'block 4', 'block 5', 'block 6']);
  assert.equal('_r' in page.messages[0], false);   // rowid never leaves the store
  s.close();
});

test('list filters: q (title, escaped), since, hqProjectId', () => {
  const s = openStore(tmpDb()); seedTies(s);
  s.setTitle('code:c1', 'Fix 100% of the café_bug', 'custom');
  assert.deepEqual(s.listConversations({ q: '100%' }).map((r) => r.id), ['code:c1']);
  assert.deepEqual(s.listConversations({ q: 'FIX 100' }).map((r) => r.id), ['code:c1']);
  assert.equal(s.listConversations({ q: '%' }).length, 1);            // a literal %, not "everything"
  assert.equal(s.listConversations({ q: '_' }).length, 1);            // a literal _, not "any char"
  assert.equal(s.listConversations({ since: '2026-10-02T00:00:00Z' }).length, 0);
  assert.equal(s.listConversations({ hqProjectId: 'project-a' }).length, 0);
  s.db.prepare("UPDATE project SET hq_project_id = 'project-a', link_state = 'confirmed' WHERE id = 'code:p'").run();
  assert.equal(s.listConversations({ hqProjectId: 'project-a' }).length, 6);
  s.close();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL — the list test skips c1–c4 after the first page (strict `last_at <` on a tie), the thread test returns 3 blocks then stops (`before` excludes every tied line), `q`/`hqProjectId` are ignored (6 rows instead of 1/0).

- [ ] **Step 3: Implement** — replace `listConversations` and `getConversation` in `store.mjs`:

```js
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
      const cols = 'id, conversation_id, native_id, parent_id, role, at, text, tool_name, is_sidechain, rowid AS _r';
      const ref = before && beforeId ? q('SELECT rowid AS r FROM message WHERE id = ? AND conversation_id = ?').get(beforeId, id) : null;
      let rows;
      if (ref) rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? AND (at < ? OR (at = ? AND rowid < ?)) ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, before, before, ref.r, lim + 1);
      else if (before) rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? AND at < ? ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, before, lim + 1);
      else rows = q(`SELECT ${cols} FROM message WHERE conversation_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`).all(id, lim + 1);
      const hasMore = rows.length > lim;
      return { conversation: c, messages: rows.slice(0, lim).reverse().map(({ _r, ...m }) => m), hasMore };
    },
```

(`q(sql)` is H1's cached-prepare helper inside `api(db)`; if the executor finds it named differently, use that helper — `grep -n "const q" dashboard/claude-hub/store.mjs`.)

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS (H1 tests still green: `before` alone keeps its meaning).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs
git commit -m "fe: Claude Hub H2 — store pages by (at, id) without skips; list filters q/since/hqProjectId

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Store `stats`, links, `secure_delete`, `optimize`, index-version stamp (`store.mjs`)

H1 deferred items 3 and 8. Closes Review Focus 3 and 4 (store side).

**Files:**
- Modify: `dashboard/claude-hub/store.mjs`
- Test: `dashboard/claude-hub/store.test.mjs` (append)

**Interfaces:**
- Produces (new store methods; spec §6 `stats`/`link` are served from these in Task 5):
  - `stats({ from, to, projectId?, tzOffsetMin = 0 }) -> { from, to, tzOffsetMin, days: [{ day: 'YYYY-MM-DD', chats, messages, active_ms }], projects: [{ project_id, name, chats, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write }], totals: { chats, active_ms, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write } }`. `from`/`to` are LOCAL days (`'YYYY-MM-DD'`, inclusive); `tzOffsetMin` (NEW argument, not in §6) = minutes east of UTC (`-new Date().getTimezoneOffset()`), so a message at 23:30Z counts on the next local day at +120. `chats` per day = distinct conversations with a message that local day. `active_ms` per day = gaps < 5 min between consecutive messages of one conversation (`LAG(at) OVER (PARTITION BY conversation_id ORDER BY at, rowid)`), credited to the later message's local day — the same rule as `conversation.active_ms`, labelled *estimate* in the UI. Tokens: per project, deduplicated by `(project_id, api_id)` (a forked/resumed session copies its parent's API responses into another conversation of the same folder), over conversations with a message in range; `totals.tokens_*` = the sum of the project rows, so the rows always add up. Throws `'stats: from/to must be YYYY-MM-DD'` on bad dates; range capped at 400 days.
  - `setLink({ projectId, hqProjectId, state }) -> boolean` — `state ∈ 'auto'|'confirmed'|'none'|'rejected'`, else throws `'link: bad state'`; `rejected` and `none` store `hq_project_id = NULL`; `auto`/`confirmed` need a non-empty `hqProjectId` (else throws `'link: hqProjectId required'`); false for an unknown project; sets `updated_at`.
  - `linkRows() -> [{ id, path, hq_project_id, link_state }]` — every `source='code'` project (Task 4's auto-linker input).
  - `optimize()` — `INSERT INTO message_fts(message_fts) VALUES('optimize')`.
  - `openStore(file, { readOnly = false, indexVersion = null } = {})` — a writer opening a BRAND-NEW db (no `meta` table before `migrate`) stamps `meta.index_version = indexVersion` when it is given; the writer connection sets `PRAGMA secure_delete = ON` (forgotten text is zeroed on disk, not left in free pages).

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-hub/store.test.mjs
const seedStats = (s) => {
  s.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'project-a', path: 'C:\\placeholder\\project-a' });
  s.upsertProject({ id: 'code:q', source: 'code', key: 'q', name: 'project-b', path: 'C:\\placeholder\\project-b' });
  for (const [id, pid] of [['code:a', 'code:p'], ['code:fork', 'code:p'], ['code:b', 'code:q']]) s.ensureConversation({ id, source: 'code', projectId: pid, nativeId: id });
  // 23:30Z on 1 Oct = 01:30 on 2 Oct at UTC+2; gaps 2 min (counted) and 10 min (not)
  s.addMessages('code:a', [
    { id: 'code:a:1', role: 'user', at: '2026-10-01T23:30:00.000Z', text: 'one' },
    { id: 'code:a:2', role: 'assistant', at: '2026-10-01T23:32:00.000Z', text: 'two' },
    { id: 'code:a:3', role: 'user', at: '2026-10-01T23:42:00.000Z', text: 'three' },
  ]);
  s.addMessages('code:fork', [{ id: 'code:fork:1', role: 'user', at: '2026-10-02T08:00:00.000Z', text: 'fork' }]);
  s.addMessages('code:b', [{ id: 'code:b:1', role: 'user', at: '2026-10-02T09:00:00.000Z', text: 'bee' }]);
  s.addUsage('code:a', 'msg_1', { in: 10, out: 100, cacheRead: 0, cacheWrite: 0 });
  s.addUsage('code:fork', 'msg_1', { in: 10, out: 100, cacheRead: 0, cacheWrite: 0 });   // copied response
  s.addUsage('code:fork', 'msg_2', { in: 1, out: 5, cacheRead: 0, cacheWrite: 0 });
  s.addUsage('code:b', 'msg_3', { in: 2, out: 7, cacheRead: 0, cacheWrite: 0 });
};

test('stats buckets by local day, estimates active time, counts a copied response once', () => {
  const s = openStore(tmpDb()); seedStats(s);
  const r = s.stats({ from: '2026-10-01', to: '2026-10-02', tzOffsetMin: 120 });
  assert.deepEqual(r.days, [{ day: '2026-10-02', chats: 3, messages: 5, active_ms: 120000 }]);
  const p = Object.fromEntries(r.projects.map((x) => [x.project_id, x]));
  assert.equal(p['code:p'].tokens_out, 105);   // msg_1 once + msg_2
  assert.equal(p['code:q'].tokens_out, 7);
  assert.equal(r.totals.tokens_out, r.projects.reduce((n, x) => n + x.tokens_out, 0));
  assert.equal(r.totals.chats, 3);
  const utc = s.stats({ from: '2026-10-01', to: '2026-10-01', tzOffsetMin: 0 });
  assert.deepEqual(utc.days.map((d) => d.day), ['2026-10-01']);
  assert.equal(s.stats({ from: '2026-10-01', to: '2026-10-02', projectId: 'code:q' }).totals.chats, 1);
  assert.throws(() => s.stats({ from: 'yesterday', to: '2026-10-02' }), /YYYY-MM-DD/);
  s.close();
});

test('setLink: states, rejected clears the hq id, unknown project is false', () => {
  const s = openStore(tmpDb()); seedStats(s);
  assert.equal(s.setLink({ projectId: 'code:p', hqProjectId: 'project-a', state: 'auto' }), true);
  assert.deepEqual(s.linkRows().find((r) => r.id === 'code:p'), { id: 'code:p', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a', link_state: 'auto' });
  s.setLink({ projectId: 'code:p', hqProjectId: 'project-a', state: 'rejected' });
  assert.equal(s.linkRows().find((r) => r.id === 'code:p').hq_project_id, null);
  assert.equal(s.setLink({ projectId: 'code:none', hqProjectId: 'x', state: 'confirmed' }), false);
  assert.throws(() => s.setLink({ projectId: 'code:p', hqProjectId: 'x', state: 'bogus' }), /bad state/);
  assert.throws(() => s.setLink({ projectId: 'code:p', hqProjectId: '', state: 'confirmed' }), /required/);
  s.close();
});

test('a brand-new db is stamped with the index version; an existing one is not; secure_delete is on', () => {
  const f = tmpDb();
  const s = openStore(f, { indexVersion: 7 });
  assert.equal(s.getMeta('index_version'), '7');
  assert.equal(s.db.prepare('PRAGMA secure_delete').get().secure_delete, 1);
  s.setMeta('index_version', '1'); s.close();
  const again = openStore(f, { indexVersion: 7 });
  assert.equal(again.getMeta('index_version'), '1');   // not fresh: the Hub's rebuild rule decides
  again.optimize();                                    // runs on a populated or empty FTS table
  again.close();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test dashboard/claude-hub/store.test.mjs`
Expected: FAIL — `s.stats is not a function`, `s.setLink is not a function`, `index_version` is `null`.

- [ ] **Step 3: Implement** in `store.mjs`:

In `openStore`, change the signature and the writer branch:

```js
export function openStore(file, { readOnly = false, indexVersion = null } = {}) {
  ...
    } else {
      if (file !== ':memory:') { db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA synchronous = NORMAL'); }
      db.exec('PRAGMA secure_delete = ON');   // forget/reset zero the freed pages: forgotten text does not linger in the file
      const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
      migrate(db);
      if (fresh && indexVersion !== null) db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('index_version', ?)").run(String(indexVersion));
    }
```

Add to the object returned by `api(db)`:

```js
    setLink({ projectId, hqProjectId, state }) {
      if (!['auto', 'confirmed', 'none', 'rejected'].includes(state)) throw new Error('link: bad state');
      const keep = state === 'auto' || state === 'confirmed';
      if (keep && !(typeof hqProjectId === 'string' && hqProjectId)) throw new Error('link: hqProjectId required');
      const r = q('UPDATE project SET hq_project_id = ?, link_state = ?, updated_at = ? WHERE id = ?')
        .run(keep ? hqProjectId : null, state, new Date().toISOString(), projectId);
      return r.changes > 0;
    },
    linkRows: () => q("SELECT id, path, hq_project_id, link_state FROM project WHERE source = 'code' ORDER BY id").all(),
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
        FROM m GROUP BY day ORDER BY day`).all(lo, hi, ...pa, mod);
      const projects = q(`WITH act AS (SELECT DISTINCT m.conversation_id AS cid FROM message m JOIN conversation c ON c.id = m.conversation_id
            WHERE c.forgotten = 0 AND m.at >= ? AND m.at < ? ${pw}),
          ux AS (SELECT c.project_id AS pid, u.api_id, MAX(u.tin) tin, MAX(u.tout) tout, MAX(u.tcr) tcr, MAX(u.tcw) tcw
            FROM usage u JOIN act ON act.cid = u.conversation_id JOIN conversation c ON c.id = u.conversation_id GROUP BY c.project_id, u.api_id),
          ch AS (SELECT c.project_id AS pid, COUNT(*) AS chats FROM act JOIN conversation c ON c.id = act.cid GROUP BY c.project_id)
        SELECT ch.pid AS project_id, p.name, ch.chats, COALESCE(SUM(ux.tin), 0) AS tokens_in, COALESCE(SUM(ux.tout), 0) AS tokens_out,
          COALESCE(SUM(ux.tcr), 0) AS tokens_cache_read, COALESCE(SUM(ux.tcw), 0) AS tokens_cache_write
        FROM ch LEFT JOIN project p ON p.id = ch.pid LEFT JOIN ux ON ux.pid = ch.pid
        GROUP BY ch.pid ORDER BY tokens_out DESC, ch.pid`).all(lo, hi, ...pa);
      const sum = (k) => projects.reduce((n, x) => n + Number(x[k] || 0), 0);
      return { from, to, tzOffsetMin: tz, days, projects,
        totals: { chats: sum('chats'), active_ms: days.reduce((n, d) => n + d.active_ms, 0), tokens_in: sum('tokens_in'), tokens_out: sum('tokens_out'), tokens_cache_read: sum('tokens_cache_read'), tokens_cache_write: sum('tokens_cache_write') } };
    },
```

Notes for the executor: the `usage` columns are `tin, tout, tcr, tcw` (store.mjs:36); SQLite's `date(x, '120 minutes')` accepts the ISO `…Z` timestamps H1 stores; a `LAG` over only the in-range messages means the first message of a range has no gap credit (an under-estimate, never an over-count).

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs
git commit -m "fe: Claude Hub H2 — store stats (local days, api_id dedupe), links, secure_delete, FTS optimize, index-version stamp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Surrogate-safe cuts, masked cwd and titles, `INDEX_VERSION = 2`, tracked ingest (`parse-code.mjs`, `redact.mjs`, `ingest-code.mjs`)

H1 deferred items 2, 4, 5 (the `titled` half) and 9.

**Files:**
- Modify: `dashboard/claude-hub/parse-code.mjs` (`cut` :24, `titleText` :27, message `cwd` :89), `dashboard/claude-hub/redact.mjs` (comment :8-10), `dashboard/claude-hub/ingest-code.mjs` (`INDEX_VERSION` :18, `firstLine(...).slice(0, 80)` :94, `recordError` :153, `ingestFile` result, `backfill`, `sweep`)
- Test: `dashboard/claude-hub/parse-code.test.mjs`, `dashboard/claude-hub/ingest-code.test.mjs` (append)

**Interfaces:**
- Produces:
  - `cutText(s: string, max: number): string` (exported from `parse-code.mjs`, NEW) — at most `max` UTF-16 units before the `'…'`, never ending on a lone high surrogate (`0xD800–0xDBFF`); unchanged when `s.length <= max`.
  - `parseCodeLine` — `title` keeps H1's mask-then-cut order (`safe()` masks) but is cut with `cutText` (the test pins the order as a regression guard); message `cwd` is `maskSecrets(cwd).text` (the username stays, secret shapes go — H1 stored it raw).
  - `ingestFile(...) -> { added, bad, skippedLong, reset, titled, missing?, tombstoned? }` — `titled: true` when any `setTitle` call this run returned `true`.
  - `ingestTracked(store, root, file, rel) -> Promise<result>` (NEW export) — `ingestFile` + error bookkeeping: on a throw it writes `meta.last_error = '<rel>: <msg≤300>'`, `meta.last_error_at = <ISO>`, `meta.last_error_file = <rel>` and rethrows; on success, when `meta.last_error_file === rel`, it clears all three. `backfill`, `sweep` and the Hub's watch path (Task 5) all use it.
  - `INDEX_VERSION = 2` — titles/cwd masking and surrogate-safe cuts change what is indexed (ruling: bump on semantic change). CONTRACT row in Task 7.

- [ ] **Step 1: Write the failing tests**

```js
// append to dashboard/claude-hub/parse-code.test.mjs
import { cutText } from './parse-code.mjs';
test('cutText never leaves a lone high surrogate', () => {
  const s = 'ab' + '🚀'.repeat(5);                 // each rocket is 2 UTF-16 units
  for (let max = 1; max < s.length; max++) {
    const out = cutText(s, max);
    const body = out.slice(0, -1);
    assert.ok(out.endsWith('…'));
    assert.ok(body.length <= max);
    const last = body.charCodeAt(body.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'lone high surrogate at max=' + max);
    assert.doesNotThrow(() => encodeURIComponent(body));   // a lone surrogate would throw URIError
  }
  assert.equal(cutText('short', 10), 'short');
});
test('titles are masked before their cut, cwd is masked', () => {
  const key = 'sk-' + 'ant-' + 'A'.repeat(40);
  const long = 'x'.repeat(190) + ' ' + key;        // the cut at 200 would split the key: masked first
  const t = parseCodeLine(JSON.stringify({ type: 'custom-title', sessionId: 's', customTitle: long }));
  assert.ok(!t.title.includes('sk-' + 'ant-'));
  const m = parseCodeLine(JSON.stringify({ type: 'user', sessionId: 's', uuid: 'u', timestamp: '2026-10-01T00:00:00Z',
    cwd: 'C:\\placeholder\\' + key, message: { role: 'user', content: 'hi' } }));
  assert.ok(m.cwd.startsWith('C:\\placeholder\\'));
  assert.ok(!m.cwd.includes('sk-' + 'ant-'));
});
```

```js
// append to dashboard/claude-hub/ingest-code.test.mjs
import { ingestTracked, INDEX_VERSION } from './ingest-code.mjs';
test('INDEX_VERSION is 2', () => assert.equal(INDEX_VERSION, 2));
test('a title-only append reports titled; last_error is timestamped and clears when that file ingests', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const store = openStore(':memory:');
  await backfill(store, root);
  fs.appendFileSync(files.b1, titleLine({ sessionId: 'sess-b1', title: 'Renamed chat' }));
  const rel = path.relative(root, files.b1);
  const r = await ingestTracked(store, root, files.b1, rel);
  assert.equal(r.added, 0); assert.equal(r.titled, true);
  // a failing ingest of that file: a store whose addMessages throws once
  const boom = Object.create(store); boom.tx = () => { throw new Error('disk full'); };
  fs.appendFileSync(files.b1, userLine({ uuid: 'u-x', sessionId: 'sess-b1', at: '2026-10-02T00:00:00Z', text: 'more' }));
  await assert.rejects(ingestTracked(boom, root, files.b1, rel), /disk full/);
  assert.match(store.getMeta('last_error'), /disk full/);
  assert.ok(Date.parse(store.getMeta('last_error_at')) > 0);
  assert.equal(store.getMeta('last_error_file'), rel);
  await ingestTracked(store, root, files.b1, rel);   // the same file now ingests cleanly
  assert.equal(store.getMeta('last_error') || '', '');
  assert.equal(store.getMeta('last_error_file') || '', '');
  store.close();
});
```

(`makeClaudeHome`, `titleLine`, `userLine` come from `__fixtures__/make-fixture.mjs`; add them, `fs` and `path` to the test's imports if absent. `Object.create(store)` works because the store API is a plain object of closures; if `ingestFile` calls `store.tx` through a destructured reference, the executor makes the failing seam `addMessages` instead — the assertion is the bookkeeping, not the seam.)

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test dashboard/claude-hub/parse-code.test.mjs dashboard/claude-hub/ingest-code.test.mjs`
Expected: FAIL — `cutText` is not exported, `cwd` unmasked, `INDEX_VERSION` is 1, `ingestTracked` is not exported.

- [ ] **Step 3: Implement**

`parse-code.mjs`:

```js
// a cut never splits a surrogate pair: a lone high surrogate breaks JSON consumers and encodeURIComponent
export const cutText = (s, max) => {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end) + '…';
};
const cut = cutText;
...
const titleText = (s) => { const t = safe(s).trim(); return t.length > 200 ? cutText(t, 199) : t; };   // safe() masks first
...
    cwd: str(j.cwd) && maskSecrets(str(j.cwd)).text,   // keep the username (it is the path), mask secret shapes; null stays null
```

(`str` and `safe` are the file's existing helpers; keep `str(j.cwd)` returning `null` for a missing cwd as before.)

`redact.mjs` — replace the comment at :8-10 with:

```js
  // A block with no END line: a transcript can hold an unterminated BEGIN (a pasted half key, a log cut by its
  // writer). Everything after it is masked to the end of the text (conservative: never leak the tail). Masking runs
  // on the full text before any cut, so this is not about our own truncation. Runs after the terminated rule so a
  // complete block keeps its context.
```

`ingest-code.mjs`:

```js
import { cutText } from './parse-code.mjs';
export const INDEX_VERSION = 2;   // 2: titles masked before their cut, cwd masked, surrogate-safe cuts
...
// in ingestFile: `let titled = false;` beside `added`, then
    // keep H1's defence-in-depth mask (the parser already masked on the full text; masking is idempotent)
    if (p.kind === 'title') { if (store.setTitle(convId, maskSecrets(p.title).text, p.source)) titled = true; return; }
...
    if (p.role === 'user' && !p.isSidechain && store.setTitle(convId, cutText(firstLine(text), 80), 'first-prompt')) titled = true;
...
  return { added, bad, skippedLong, reset, titled };

const recordError = (store, rel, e) => {
  store.setMeta('last_error', rel + ': ' + String(e && e.message || e).slice(0, 300));
  store.setMeta('last_error_at', new Date().toISOString());
  store.setMeta('last_error_file', rel);
};
export async function ingestTracked(store, root, file, rel = path.relative(root, file)) {
  let r;
  try { r = await ingestFile(store, root, file); }
  catch (e) { recordError(store, rel, e); throw e; }
  if (store.getMeta('last_error_file') === rel) { store.setMeta('last_error', ''); store.setMeta('last_error_at', ''); store.setMeta('last_error_file', ''); }
  return r;
}
```

In `backfill`: `try { await ingestTracked(store, root, f.file, f.rel); } catch { /* recorded */ }`. In `sweep`: `try { r = await ingestTracked(store, root, f.file, f.rel); } catch { continue; }` and `if (r.added > 0 || r.reset || r.titled) changed.push(...)`. In `listReporting`, the `NO_ROOT` writes also set `last_error_at` (call `recordError`-like: `store.setMeta('last_error_at', new Date().toISOString())` next to the NO_ROOT set, and clear it where the NO_ROOT note is cleared).

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS. A hub.test that pins `INDEX_VERSION`-driven rebuild still passes (it reads the constant).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/parse-code.mjs dashboard/claude-hub/redact.mjs dashboard/claude-hub/ingest-code.mjs dashboard/claude-hub/parse-code.test.mjs dashboard/claude-hub/ingest-code.test.mjs
git commit -m "fe: Claude Hub H2 — surrogate-safe cuts, titles/cwd masked before storage, INDEX_VERSION 2, tracked last_error

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The linker (`link.mjs`, new)

Spec §3.1 Linker + §6 auto-match. Closes Review Focus 5 (pure side).

**Files:**
- Create: `dashboard/claude-hub/link.mjs`
- Test: `dashboard/claude-hub/link.test.mjs`

**Interfaces:**
- Consumes: Task 2 `store.linkRows()`, `store.setLink()`; the ranking rules of `dashboard-v5/src/live/adapter.mjs` `projectForCwd(cwd, projects)` (absolute path match beats relative; among relative matches the one closest to the drive wins; then the deepest root). The Hub cannot import renderer code at runtime, so the rules are re-implemented here and a parity test pins them to the renderer's.
- Produces (all NEW):
  - `matchProject(cwd: string, hqProjects: [{id, path}]) -> string|null` — same answer as `projectForCwd` for every input.
  - `readHqProjects(file: string) -> [{id, path}]` — `projects` + `archived_projects` of `data/latest.json` (read-only); `[]` when the file does not exist (no scan yet); throws on unreadable/invalid JSON (errors surface, ruling).
  - `autoLink(store, hqProjects) -> { linked: number, cleared: number }` — for `link_state` `none` or `auto` only: a match → `setLink({state:'auto', hqProjectId})` when it differs; an `auto` row with no match any more → `setLink({state:'none'})`. `confirmed` and `rejected` rows are never touched.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-hub/link.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchProject, readHqProjects, autoLink } from './link.mjs';
import { projectForCwd } from '../../dashboard-v5/src/live/adapter.mjs';
import { openStore } from './store.mjs';

const P = [
  { id: 'project-a', path: 'project-a' },
  { id: 'project-b', path: 'project-b' },
  { id: 'nested', path: 'project-b/vendor/project-a' },
  { id: 'abs', path: 'C:\\placeholder\\abs-project' },
  { id: 'dot', path: '.' }, { id: 'up', path: '../x' }, { id: 'empty', path: '' },
];
const CWDS = ['C:\\placeholder\\project-a', 'C:/placeholder/project-a/src', 'C:\\placeholder\\project-b\\vendor\\project-a',
  'C:\\PLACEHOLDER\\ABS-PROJECT\\x', 'C:\\placeholder\\project-ab', 'C:\\placeholder\\other', '', null];

test('matchProject agrees with the renderer projectForCwd on every case', () => {
  for (const cwd of CWDS) assert.equal(matchProject(cwd, P), projectForCwd(cwd, P), String(cwd));
  assert.equal(matchProject('C:\\placeholder\\project-a', P), 'project-a');
  assert.equal(matchProject('C:\\placeholder\\project-ab', P), null);
});

test('readHqProjects: projects + archived, [] without a scan, throws on broken JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-link-'));
  const f = path.join(dir, 'latest.json');
  assert.deepEqual(readHqProjects(f), []);
  fs.writeFileSync(f, JSON.stringify({ projects: [{ id: 'project-a', path: 'project-a', name: 'x' }], archived_projects: [{ id: 'old', path: 'old' }] }));
  assert.deepEqual(readHqProjects(f), [{ id: 'project-a', path: 'project-a' }, { id: 'old', path: 'old' }]);
  fs.writeFileSync(f, '{ not json');
  assert.throws(() => readHqProjects(f));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autoLink touches only none/auto rows and clears a stale auto link', () => {
  const s = openStore(':memory:');
  for (const [id, p] of [['code:a', 'C:\\placeholder\\project-a'], ['code:b', 'C:\\placeholder\\project-b'], ['code:c', 'C:\\placeholder\\other'], ['code:r', 'C:\\placeholder\\project-a\\sub']])
    s.upsertProject({ id, source: 'code', key: id.slice(5), name: id, path: p });
  s.setLink({ projectId: 'code:b', hqProjectId: 'project-a', state: 'confirmed' });   // owner's choice wins over the path
  s.setLink({ projectId: 'code:r', hqProjectId: 'x', state: 'rejected' });           // owner unlinked it
  s.setLink({ projectId: 'code:c', hqProjectId: 'gone', state: 'auto' });            // matched a project that no longer exists
  const r = autoLink(s, P);
  const by = Object.fromEntries(s.linkRows().map((x) => [x.id, x]));
  assert.deepEqual([by['code:a'].link_state, by['code:a'].hq_project_id], ['auto', 'project-a']);
  assert.deepEqual([by['code:b'].link_state, by['code:b'].hq_project_id], ['confirmed', 'project-a']);
  assert.deepEqual([by['code:r'].link_state, by['code:r'].hq_project_id], ['rejected', null]);
  assert.deepEqual([by['code:c'].link_state, by['code:c'].hq_project_id], ['none', null]);
  assert.deepEqual(r, { linked: 1, cleared: 1 });
  assert.deepEqual(autoLink(s, P), { linked: 0, cleared: 0 });   // idempotent
  s.close();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test dashboard/claude-hub/link.test.mjs`
Expected: FAIL — `Cannot find module './link.mjs'`.

- [ ] **Step 3: Implement**

```js
// dashboard/claude-hub/link.mjs
// Claude Code folders -> WorkspaceHQ projects (spec 2026-10-13 §3.1 Linker). Pure except readHqProjects (one
// read-only read of data/latest.json). The ranking mirrors dashboard-v5/src/live/adapter.mjs projectForCwd; the
// parity test in link.test.mjs keeps them identical.
import fs from 'node:fs';

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isAbsPath = (n) => /^[a-z]:(\/|$)/.test(n) || n.startsWith('/');
function segmentAt(c, root) {
  for (let i = c.indexOf(root); i >= 0; i = c.indexOf(root, i + 1)) {
    const end = i + root.length;
    if ((i === 0 || c[i - 1] === '/') && (end === c.length || c[end] === '/')) return i;
  }
  return -1;
}
export function matchProject(cwd, hqProjects) {
  const c = normPath(cwd);
  if (!c) return null;
  let best = null, rank = null;
  for (const p of Array.isArray(hqProjects) ? hqProjects : []) {
    const root = normPath(p && p.path).replace(/^(\.\/)+/, '');
    if (!root || root === '.' || root === '..' || root.startsWith('../')) continue;
    const at = isAbsPath(root) ? (c === root || c.startsWith(root + '/') ? 0 : -1) : segmentAt(c, root);
    if (at < 0) continue;
    const r = [isAbsPath(root) ? 0 : 1, at, -root.length];
    if (!rank || (r[0] - rank[0] || r[1] - rank[1] || r[2] - rank[2]) < 0) { best = String(p.id); rank = r; }
  }
  return best;
}

export function readHqProjects(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const j = JSON.parse(raw.replace(/^\uFEFF/, ''));   // a BOM (Windows PowerShell's utf8) is not a broken scan
  const pick = (xs) => (Array.isArray(xs) ? xs : []).filter((p) => p && p.id).map((p) => ({ id: String(p.id), path: String(p.path || '') }));
  return pick(j.projects).concat(pick(j.archived_projects));
}

export function autoLink(store, hqProjects) {
  let linked = 0, cleared = 0;
  for (const row of store.linkRows()) {
    if (row.link_state !== 'none' && row.link_state !== 'auto') continue;   // confirmed/rejected are the owner's
    const m = matchProject(row.path, hqProjects);
    if (m && !(row.link_state === 'auto' && row.hq_project_id === m)) { store.setLink({ projectId: row.id, hqProjectId: m, state: 'auto' }); linked++; }
    else if (!m && row.link_state === 'auto') { store.setLink({ projectId: row.id, hqProjectId: null, state: 'none' }); cleared++; }
  }
  return { linked, cleared };
}
```

If `adapter.mjs` cannot be imported under plain Node (it imports only `./catalog.mjs`, which is pure — expected to work), the executor copies its case table into the test with the expected ids written out instead; the parity intent stays.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/link.mjs dashboard/claude-hub/link.test.mjs
git commit -m "fe: Claude Hub H2 — link.mjs: auto-match Claude Code folders to WorkspaceHQ projects (owner choices never overwritten)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hub ops `stats` + `link`, auto-link on scans, `changed` on titles with a max wait, optimize after a rebuild (`hub.mjs`)

Spec §6 `stats`, `link`; H1 deferred items 4 (health side), 5, 8 (Hub side). Closes Review Focus 5 (Hub side).

**Files:**
- Modify: `dashboard/claude-hub/hub.mjs` (imports :14-15; `main()` open block :180-190; `markChanged` :212-216; `startWatching` :230-243; `runIndex` :248-258; `ops` :262-276)
- Test: `dashboard/claude-hub/hub.test.mjs` (append; uses its local `startHub`, `tmp`)

**Interfaces:**
- Consumes: Task 2 `openStore(file, {indexVersion})`, `store.stats`, `store.setLink`, `store.optimize`; Task 3 `ingestTracked`, `titled`; Task 4 `readHqProjects`, `autoLink`.
- Produces:
  - Hub arg `--latest <file>` (NEW; env fallback `HQ_HUB_LATEST`, NEW) — the WorkspaceHQ scan file the linker reads. Absent → auto-link is off (links can still be set by hand).
  - op `stats(args) -> store.stats(args)` (reader allowed; `{from,to,tzOffsetMin,days:[],projects:[],totals:{…zeros}}` without a store).
  - op `link({ projectId, hqProjectId, state }) -> Promise<boolean>` — writer only (`notOwner()` otherwise), through `serial()`; accepts only `state ∈ 'confirmed'|'rejected'|'none'` from callers (`auto` is the linker's), else throws `'link: state must be confirmed, rejected or none'`; emits `changed {ids:[], projects:[projectId]}`.
  - `changed` event gains an optional `projects: [projectId]` (additive); it fires for title-only appends (`r.titled`) and at most 2 s after the first mark of a burst (`CHANGED_MAX_WAIT_MS = 2000`) even while marks keep arriving every < 300 ms.
  - `health()` gains `lastErrorAt: string|null` (from `meta.last_error_at`, additive).
  - After a forced rebuild (reindex or `index_version` bump) completes, `store.optimize()` runs once in the queue.
  - Auto-link runs in the queue after every backfill and on each sweep tick when `latest.json`'s mtime changed; its failures go to `lastError` (`fail`), never swallowed.

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-hub/hub.test.mjs
import { titleLine } from './__fixtures__/make-fixture.mjs';   // merge into the existing fixture import
// R() resolves the whole response line {id, ok, result|error}: unwrap it, a refused op becomes a rejection
const call = (h) => async (op, args) => { const r = await h.req(op, args); if (!r.ok) throw new Error(r.error); return r.result; };

test('stats and link ops; auto-link from latest.json; a manual unlink survives reindex', async () => {
  const dir = tmp('hub-h2-');
  const { home } = makeClaudeHome(dir);
  const latest = path.join(dir, 'latest.json');
  fs.writeFileSync(latest, JSON.stringify({ projects: [{ id: 'project-a', path: 'project-a' }, { id: 'project-b', path: 'project-b' }] }));
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '300', HQ_HUB_LATEST: latest }, path.join(dir, 'hub.sqlite'));
  await h.healthy(15000);
  const R = call(h);
  // length first: [].every() is true, and listProjects is [] until the first backfill has run
  assert.ok(await h.until(async () => { const xs = await R('listProjects'); return xs.length === 2 && xs.every((p) => p.link_state === 'auto'); }, 8000), 'both folders auto-linked');
  const ps = await R('listProjects');
  assert.deepEqual(ps.map((p) => p.hq_project_id).sort(), ['project-a', 'project-b']);
  const st = await R('stats', { from: '2026-09-01', to: '2026-12-31', tzOffsetMin: 0 });
  assert.equal(st.totals.chats, 3);
  assert.ok(st.projects.some((p) => p.tokens_out >= 40));
  const a = ps.find((p) => p.hq_project_id === 'project-a').id;
  assert.equal(await R('link', { projectId: a, hqProjectId: null, state: 'rejected' }), true);
  await assert.rejects(R('link', { projectId: a, hqProjectId: 'project-a', state: 'auto' }), /confirmed, rejected or none/);
  await R('reindex');
  await h.until(async () => (await R('health')).state === 'ready' && (await R('health')).counts.conversations === 3, 15000);
  await new Promise((r) => setTimeout(r, 700));   // two sweep ticks: auto-link ran again
  const after = (await R('listProjects')).find((p) => p.id === a);
  assert.deepEqual([after.link_state, after.hq_project_id], ['rejected', null]);
  await h.stop();
});

test('changed fires for a title-only append and within the max wait during a burst', async () => {
  const dir = tmp('hub-h2c-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '150' }, path.join(dir, 'hub.sqlite'));
  await h.healthy(15000);
  const R = call(h);
  const n0 = h.events.filter((e) => e.event === 'changed').length;
  fs.appendFileSync(files.b1, titleLine({ sessionId: 'sess-b1', title: 'Renamed chat' }));
  await h.until(() => h.events.filter((e) => e.event === 'changed').length > n0, 5000);
  const n1 = h.events.filter((e) => e.event === 'changed').length;
  const t0 = Date.now();
  let k = 0;
  const burst = setInterval(() => fs.appendFileSync(files.b1, userLine({ uuid: 'burst-' + k++, sessionId: 'sess-b1', at: new Date().toISOString(), text: 'tick' })), 100);
  try { await h.until(() => h.events.filter((e) => e.event === 'changed').length > n1, 3500); }
  finally { clearInterval(burst); }
  assert.ok(Date.now() - t0 < 3500, 'a changed event arrived while the burst was still running');
  assert.equal((await R('health')).lastErrorAt ?? null, null);
  await h.stop();
});
```

(`h.until` already awaits async predicates, hub.test.mjs:72; `h.stop()` is the helper's own stop.)

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: FAIL — `unknown op` for `stats`/`link`, no project ever reaches `auto`, and the burst test times out (the 300 ms trailing debounce never fires while lines arrive every 100 ms).

- [ ] **Step 3: Implement** in `hub.mjs`:

```js
import { backfill, ingestTracked, sweep, watchRoot, INDEX_VERSION } from './ingest-code.mjs';
import { readHqProjects, autoLink } from './link.mjs';
const CHANGED_MAX_WAIT_MS = 2000;
```

In `main()`:

```js
  const latestFile = arg('--latest') || process.env.HQ_HUB_LATEST || null;
  ...
    try { store = openStore(dbFile, { indexVersion: INDEX_VERSION }); }   // a brand-new index needs no rebuild
  ...
  // ---- changes: one `changed` per burst, but never later than CHANGED_MAX_WAIT_MS after the burst's first change
  const changedIds = new Set(), changedProjects = new Set();
  let changedFirst = 0;
  const flushChanged = () => {
    clearTimeout(changedTimer); changedTimer = null; changedFirst = 0;
    const data = { ids: [...changedIds] };
    if (changedProjects.size) data.projects = [...changedProjects];
    changedIds.clear(); changedProjects.clear();
    emit('changed', data);
  };
  const markChanged = (ids, projects = []) => {
    for (const id of ids) changedIds.add(id);
    for (const p of projects) changedProjects.add(p);
    const now = Date.now();
    if (!changedFirst) changedFirst = now;
    clearTimeout(changedTimer);
    changedTimer = setTimeout(flushChanged, Math.max(0, Math.min(300, changedFirst + CHANGED_MAX_WAIT_MS - now)));
  };

  // ---- links: auto-match against the latest scan; only none/auto rows move (link.mjs)
  let latestMtime = -1;
  const relink = (force = false) => {
    if (!latestFile || !store || !writer) return Promise.resolve();
    let m = 0;
    try { m = fs.statSync(latestFile).mtimeMs; } catch { m = 0; }
    if (!force && m === latestMtime) return Promise.resolve();
    latestMtime = m;
    return serial(() => autoLink(store, readHqProjects(latestFile)))
      .then((r) => { if (r.linked || r.cleared) markChanged([], ['*']); }, fail);
  };
```

In `startWatching`, the watch path uses `ingestTracked` and `titled`:

```js
    watcher = watchRoot(root, (file) => {
      serial(() => ingestTracked(store, root, file))
        .then((r) => { if (r.added || r.reset || r.titled) markChanged(['code:' + path.basename(file, '.jsonl')]); }, fail);
    });
```

and the sweep tick calls `relink()` after its `serial(() => sweep(...))` (`.finally(() => { sweeping = false; relink(); })`).

In `runIndex`, remember a reset and optimize + relink once the run settles:

```js
    let didReset = false;
    serial(async () => {
      do {
        if (resetNext) { resetNext = false; didReset = true; store.resetCode(); store.setMeta('index_version', INDEX_VERSION); progress = { done: 0, total: 0 }; }
        await backfill(store, root, { shouldStop: () => stopping || resetNext, onProgress });
      } while (resetNext && !stopping);
      if (didReset && !stopping) store.optimize();   // a full rebuild leaves many FTS segments: merge them once
    }).then(() => { lastError = null; }, fail)
      .finally(() => { running = false; state = 'ready'; startWatching(); relink(true); });
```

`ops` additions:

```js
    health: () => ({ state, role: writer ? 'writer' : 'reader', node: process.version, backfill: progress,
      counts: store ? store.counts() : { projects: 0, conversations: 0, messages: 0 }, dbBytes: dbBytes(),
      lastError: lastError || readerNote || (store && store.getMeta('last_error')) || null,
      lastErrorAt: (store && store.getMeta('last_error_at')) || null }),   // H1's fields unchanged + lastErrorAt
    stats: (a) => (store ? store.stats(a) : { from: a.from, to: a.to, tzOffsetMin: 0, days: [], projects: [],
      totals: { chats: 0, active_ms: 0, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 } }),
    link: (a) => {
      if (!writer) notOwner();
      if (!['confirmed', 'rejected', 'none'].includes(a.state)) throw new Error('link: state must be confirmed, rejected or none');
      return serial(() => store.setLink(a)).then((ok) => { if (ok) markChanged([], [a.projectId]); return ok; });
    },
```

The `exit` handler's `clearTimeout(changedTimer)` stays. `forget` also marks the change so open lists refresh: `.then((ok) => { if (ok) markChanged(a.conversationId ? [a.conversationId] : [], a.projectId ? [a.projectId] : []); return ok; })`.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS (H1 hub tests untouched: `changed` keeps `{ids}`; `projects` appears only when set).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: Claude Hub H2 — Hub ops stats/link, auto-link from latest.json, changed on titles with a 2 s max wait, FTS optimize after rebuild

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lock-owner check by the real node binary, alive re-check, reader retry and upgrade (`hub.mjs`)

H1 deferred items 6 and 7.

**Files:**
- Modify: `dashboard/claude-hub/hub.mjs` (`lockOwner` :103-115, `acquireLock` :119-140, reader branch of `main()` :190-201, `exit` handler :169-175)
- Test: `dashboard/claude-hub/hub.test.mjs` (append)

**Interfaces:**
- Produces:
  - `acquireLock(lockFile, { dbFile, inspect, note, nodeName = path.basename(process.execPath) })` — `nodeName` (NEW option) is the file name of the binary this Hub runs on, i.e. the resolved `HQ_HUB_NODE` (the host spawns the Hub with that binary). A live owner is a process named `node`, `node.exe` or `nodeName` (case-insensitive) running `hub.mjs` on the same db. An owner whose name is e.g. `node22.exe` is no longer reclaimed as "another program".
  - When the process query answers "no such process" (`inspect(pid) === null`) but `alive(pid)` is still true, the lock is kept (`{owner: true, note: 'pid N is alive but the process query did not see it, assumed it owns the index lock'}`); only a pid that is gone on the re-check is reclaimed.
  - Reader upgrade: env `HQ_HUB_READER_UPGRADE_MS` (NEW, default 30000, min 100). A reader re-tries every interval: it takes the lock when it is free (then it closes its read-only handle, opens as writer, emits `ready {role:'writer'}` and runs the index exactly like a writer start), else, if it gave up opening the index, it tries the read-only open again (clearing the gave-up note on success).

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-hub/hub.test.mjs
test('lock owner: the Hub binary may have any name; a pid the query missed but that is alive is kept', () => {
  const dir = tmp('hub-lock2-');
  const db = path.join(dir, 'hub.sqlite'), lock = db + '.lock';
  const live = otherProgram();   // a real live pid
  fs.writeFileSync(lock, JSON.stringify({ pid: live.pid, db }));
  const notes = [];
  const custom = () => ({ name: 'node22.exe', commandLine: '"C:\\tools\\node22.exe" --no-warnings "C:\\x\\hub.mjs" --db "' + db + '"' });
  assert.equal(acquireLock(lock, { dbFile: db, inspect: custom, nodeName: 'node22.exe', note: (t) => notes.push(t) }), false);
  assert.equal(acquireLock(lock, { dbFile: db, inspect: () => null, note: (t) => notes.push(t) }), false);
  assert.ok(notes.some((t) => /alive but the process query did not see it/.test(t)));
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, live.pid);   // never reclaimed
});

test('a reader takes over as writer once the writer exits', async () => {
  const dir = tmp('hub-up-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const env = { HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '500', HQ_HUB_READER_UPGRADE_MS: '300' };
  const a = startHub(env, db);
  await a.healthy(15000);
  const b = startHub(env, db);
  await b.healthy(15000);
  assert.equal((await b.req('health')).result.role, 'reader');
  await a.stop();
  assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready' && e.data.role === 'writer'), 5000), 'reader upgraded');
  const h = await b.healthy(15000);
  assert.equal(h.role, 'writer');
  assert.equal(h.counts.conversations, 3);
  assert.equal((await b.req('reindex')).ok, true);   // writer-only ops work now
  await b.stop();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: FAIL — the first `acquireLock` reclaims (`node22.exe` is not `node(.exe)`), the `null` query reclaims a live pid, and the reader never emits a writer `ready`.

- [ ] **Step 3: Implement** in `hub.mjs`:

```js
function lockOwner(pid, dbFile, inspect, nodeName) {
  let info;
  try { info = inspect(pid); }
  catch (e) { return { owner: true, note: 'could not check the index lock owner (pid ' + pid + ': ' + msg(e) + '), assumed live' }; }
  if (!info) {
    // the query saw nothing: either it exited between the checks (stale) or the query missed it — ask once more
    if (alive(pid)) return { owner: true, note: 'pid ' + pid + ' is alive but the process query did not see it, assumed it owns the index lock' };
    return { owner: false, note: null };
  }
  const names = new Set(['node', 'node.exe', String(nodeName || '').toLowerCase()]);
  if (!names.has(String(info.name || '').toLowerCase())) return { owner: false, note: 'reclaimed a stale index lock (pid ' + pid + ' was ' + (info.name || 'another program') + ')' };
  ... (rest unchanged)
}
export function acquireLock(lockFile, { dbFile = lockFile.replace(/\.lock$/i, ''), inspect = inspectProcess, note = () => {}, nodeName = path.basename(process.execPath) } = {}) {
  ... const o = lockOwner(pid, dbFile, inspect, nodeName); ...
}
```

In `main()`, factor the writer open into one function used at start and on upgrade, and add the upgrade timer:

```js
  const READER_UPGRADE_MS = Math.max(100, Number(process.env.HQ_HUB_READER_UPGRADE_MS) || 30000);
  let upgradeTimer = null;
  function openWriter() {
    try { store = openStore(dbFile, { indexVersion: INDEX_VERSION }); }
    catch (e) { fatal('cannot open the index: ' + msg(e)); return false; }
    const v = store.getMeta('index_version');
    rebuild = v === null || !(Number(v) >= INDEX_VERSION);
    return true;
  }
  ...
  if (writer) { lastError = lockNotes.join('; ') || null; if (!openWriter()) return; }
  else {
    ... H1 attempt() loop unchanged ...
    upgradeTimer = setInterval(() => {
      if (stopping || writer) return;
      if (acquireLock(lockFile, { dbFile, note: diag })) {
        clearInterval(upgradeTimer); clearTimeout(readerTimer);
        try { store && store.close(); } catch { /* reopening as writer */ }
        store = null; writer = true; readerNote = null; lastError = null;
        if (!openWriter()) return;
        emit('ready', { role: 'writer' });
        if (rebuild) resetNext = true;
        runIndex();
        return;
      }
      if (!store) { try { store = openStore(dbFile, { readOnly: true }); lastError = null; } catch { /* still unavailable: the gave-up note stays */ } }
    }, READER_UPGRADE_MS);
  }
```

The `exit` handler adds `clearInterval(upgradeTimer);` and still releases the lock only when `writer` is true (it reads the reassigned `let`). `runIndex`/`startWatching` are function declarations or consts initialised before the first timer tick fires, so the upgrade path can call them.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test dashboard/claude-hub/*.test.mjs`
Expected: PASS. One H1 assertion changes ON PURPOSE (this is the deferred item, not a regression): `hub.test.mjs` ~:226 asserted that `inspect: () => null` on a LIVE sleeper pid reclaims the lock ("gone by the time it is asked"). With the alive re-check that pid is kept. Replace that line and the `assert.deepEqual(notes, [])` after it with:

```js
    assert.equal(acquireLock(lock, { inspect: () => null, note }), false, 'the query missed a pid that is still alive: kept');
    assert.match(notes.pop(), /is alive but the process query did not see it/);
    assert.equal(fs.readFileSync(lock, 'utf8'), held, 'still left alone');
```

Every other H1 lock test stays as is (a non-node live pid is still reclaimed, a plain-pid lock is still read). Stage `hub.test.mjs` with the change.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: Claude Hub H2 — lock owner checked against the real node binary, alive re-check, reader retries and takes over a freed lock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: IPC — contract rows first, then host handlers, preload, fake preload

Spec §7 `claudeHub.projects/conversations/conversation/search/stats/link/forget` (+ `reindex`, deviation above).

**Files:**
- Modify (first, own commit): `docs/sync/IPC-CONTRACT.md` (new section after the H1 Claude Hub section), `docs/sync/CONTRACT.md` (`data/claude/` entry, additive paragraph)
- Modify: `dashboard/claude-hub-host.js`, `dashboard/claude-hub-host.test.mjs`, `dashboard/preload.js` (the `claudeHub` block :40-47), `dashboard-v5/tools/fake-preload.js` (SPEC :111-112), `dashboard-v5/tools/fake-preload.test.mjs`
- `dashboard/main.js`: **no line changes** — `init()` already receives `dataDir`, which now also yields the `--latest` path.

**Interfaces:**
- Consumes: Hub ops `listProjects`, `listConversations`, `getConversation`, `search`, `stats`, `link`, `forget`, `reindex` (H1 + Tasks 1, 2, 5).
- Produces (preload → channel → Hub op; every handler resolves, never rejects; failures are `{error}`):
  - `claudeHub.projects(opts?)` → `hq:claude-hub:projects` → `listProjects({source})` → `[{id, source, key, name, path, hq_project_id, link_state, created_at, updated_at, conversations, last_at}]`
  - `claudeHub.conversations(opts?)` → `hq:claude-hub:conversations` → `listConversations({projectId, source, q, since, hqProjectId, before, beforeId, limit})` → rows (H1 columns + `project_name`, `hq_project_id`)
  - `claudeHub.conversation(id, opts?)` → `hq:claude-hub:conversation` → `getConversation({id, limit, before, beforeId})` → `{conversation, messages, hasMore}` | `null`
  - `claudeHub.search(q, opts?)` → `hq:claude-hub:search` → `search({q, projectId, source, limit})` → `[{messageId, conversationId, at, role, title, source, projectId, snippet, rank}]`, snippet marked with `\u0002…\u0003`
  - `claudeHub.stats(opts)` → `hq:claude-hub:stats` (15 s timeout) → `stats({from, to, projectId, tzOffsetMin})` → Task 2 shape
  - `claudeHub.link(id, hqId, state)` → `hq:claude-hub:link` → `link({projectId:id, hqProjectId:hqId, state})` → `true` | `{error}` (`false` from the Hub becomes `{error:'unknown project'}`)
  - `claudeHub.forget(target)` → `hq:claude-hub:forget` → `forget({conversationId}|{projectId})` → `true` | `{error}` (`false` → `{error:'nothing to forget'}`; 60 s timeout: it waits for its queue slot)
  - `claudeHub.reindex()` → `hq:claude-hub:reindex` → `reindex()` → `{started:true}` | `{error}`
  - `registerIpc(ipcMain, host)` (NEW export of `claude-hub-host.js`) — registers all nine handlers (H1's `health` included), so the mapping is testable without spawning a Hub.
  - `create({..., latestFile})` (NEW option) appends `--latest <latestFile>` to the Hub's argv; `init()` passes `process.env.HQ_HUB_LATEST || path.join(dataDir, 'latest.json')` (`HQ_HUB_LATEST` is a NEW test override, like `HQ_CLAUDE_DB`; README lists it in Task 12).

- [ ] **Step 1: Write the contract rows and commit them before any handler**

Append to `docs/sync/IPC-CONTRACT.md`:

```markdown
## 2026-10-16 — Claude Hub, phase H2 (rows written before the handler lands)

Additive only. Handlers live in `dashboard/claude-hub-host.js` (`registerIpc`); no `main.js` line changes. Rows are the
Hub's own snake_case rows, passed through unchanged. Every handler resolves; failures are `{error}`.

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.projects(opts?)` | `hq:claude-hub:projects` (invoke) | `opts = {source?}` → `[{id, source, key, name, path, hq_project_id, link_state:'auto'\|'confirmed'\|'none'\|'rejected', conversations, last_at, …}]` |
| `claudeHub.conversations(opts?)` | `hq:claude-hub:conversations` (invoke) | `opts = {projectId?, source?, q?, since?, hqProjectId?, before?, beforeId?, limit?≤200}`; order `last_at DESC, id DESC`; next page = the last row's `{before:last_at, beforeId:id}`; `q` = title substring (ASCII case-insensitive) → rows |
| `claudeHub.conversation(id, opts?)` | `hq:claude-hub:conversation` (invoke) | `opts = {limit?≤500, before?, beforeId?}` → `{conversation, messages:[{id, role, at, text, tool_name, is_sidechain, …}] (oldest first), hasMore}` \| `null` (unknown or forgotten); earlier page = the first message's `{before:at, beforeId:id}` |
| `claudeHub.search(q, opts?)` | `hq:claude-hub:search` (invoke) | `opts = {projectId?, source?, limit?≤50}` → `[{messageId, conversationId, at, role, title, source, projectId, snippet, rank}]`; `snippet` is plain text with hits between U+0002 and U+0003 — render as text, never as HTML; `[]` when the query has no letters/digits |
| `claudeHub.stats(opts)` | `hq:claude-hub:stats` (invoke, 15 s) | `opts = {from:'YYYY-MM-DD', to:'YYYY-MM-DD', projectId?, tzOffsetMin?}` → `{days:[{day, chats, messages, active_ms}], projects:[{project_id, name, chats, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write}], totals}`; `active_ms` is an estimate (gaps < 5 min); tokens deduplicated per API response |
| `claudeHub.link(id, hqId, state)` | `hq:claude-hub:link` (invoke) | `state:'confirmed'\|'rejected'\|'none'` → `true` \| `{error}`; `rejected`/`none` clear `hq_project_id`; the Hub's auto-matcher never overwrites `confirmed`/`rejected` |
| `claudeHub.forget(target)` | `hq:claude-hub:forget` (invoke, 60 s) | `{conversationId}` \| `{projectId}` → `true` \| `{error}`; removes the index rows + tombstone; the transcript on disk is untouched |
| `claudeHub.reindex()` | `hq:claude-hub:reindex` (invoke) | → `{started:true}` \| `{error}` (a read-only Hub refuses); links and tombstones survive |
| `claudeHub.on(cb)` (H1) | push `hq:claude-hub:event` | additive: `changed` may carry `projects:[projectId]` (`'*'` = links re-matched); `health()` gains `lastErrorAt` |
```

Append to the `data/claude/` entry of `docs/sync/CONTRACT.md`:

```markdown
(2026-10-16, additive, H2) `INDEX_VERSION` 2: cwd masked, surrogate-safe cuts — the next writer rebuilds once.
`project.hq_project_id`/`link_state` are now written (auto-match from `data/latest.json`, read-only; owner choices
`confirmed`/`rejected` are never overwritten). `meta.last_error_at` / `meta.last_error_file` timestamp the last ingest
error and clear when that file ingests cleanly. Writer connections use `secure_delete`.
```

```bash
git add -- docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: Claude Hub H2 — IPC-CONTRACT rows (projects/conversations/conversation/search/stats/link/forget/reindex) + CONTRACT note, before the handlers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing tests**

```js
// append to dashboard/claude-hub-host.test.mjs
const { registerIpc } = require('./claude-hub-host.js');   // or the file's existing import form
test('registerIpc maps every channel to its Hub op and shapes false into {error}', async () => {
  const h = {}, calls = [];
  const host = { health: async () => ({ state: 'ready' }), request: async (op, args, o) => { calls.push([op, args, o]); return op === 'link' ? false : op === 'forget' ? true : { op }; } };
  registerIpc({ handle: (ch, fn) => { h[ch] = fn; } }, host);
  assert.deepEqual(Object.keys(h).sort(), ['hq:claude-hub:conversation', 'hq:claude-hub:conversations', 'hq:claude-hub:forget', 'hq:claude-hub:health',
    'hq:claude-hub:link', 'hq:claude-hub:projects', 'hq:claude-hub:reindex', 'hq:claude-hub:search', 'hq:claude-hub:stats']);
  await h['hq:claude-hub:conversation']({}, 'code:s', { limit: 5, before: 'x', beforeId: 'y' });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['getConversation', { limit: 5, before: 'x', beforeId: 'y', id: 'code:s' }]);
  await h['hq:claude-hub:search']({}, 'release', { limit: 5 });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['search', { limit: 5, q: 'release' }]);
  assert.deepEqual(await h['hq:claude-hub:link']({}, 'code:p', 'project-a', 'confirmed'), { error: 'unknown project' });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['link', { projectId: 'code:p', hqProjectId: 'project-a', state: 'confirmed' }]);
  assert.equal(await h['hq:claude-hub:forget']({}, { conversationId: 'code:s' }), true);
  assert.equal(calls.at(-1)[2].timeout, 60000);
  await h['hq:claude-hub:stats']({}, { from: '2026-10-01', to: '2026-10-02' });
  assert.equal(calls.at(-1)[2].timeout, 15000);
  await h['hq:claude-hub:conversations']({}, 'not-an-object');
  assert.deepEqual(calls.at(-1).slice(0, 2), ['listConversations', {}]);   // junk args never reach the Hub
});
test('create passes --latest to the Hub when given', () => {
  const seen = [];
  const host = create({ hubScript: 'hub.mjs', dbFile: 'x.sqlite', latestFile: 'C:\\placeholder\\latest.json', findNodeFn: () => thisNode(),
    spawnFn: (cmd, args) => { seen.push(args); throw new Error('stop here'); } });
  host.start();
  assert.deepEqual(seen[0].slice(-2), ['--latest', 'C:\\placeholder\\latest.json']);
});
```

```js
// append to dashboard-v5/tools/fake-preload.test.mjs
test('the fake Claude library answers placeholder rows, incl. a hostile snippet for the render-as-text gate', async () => {
  const { hq } = createFake();
  const hits = await hq.claudeHub.search('release');
  assert.ok(hits.some((x) => x.snippet.includes('<img') && x.snippet.includes('\u0002')));
  assert.equal((await hq.claudeHub.conversation('code:sess-a1')).messages.some((m) => m.role === 'tool'), true);
  assert.equal(await hq.claudeHub.link('code:C--placeholder-project-a', 'project-a', 'confirmed'), true);
  assert.deepEqual(await hq.claudeHub.reindex(), { started: true });
});
```

Run: `node --test dashboard/claude-hub-host.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: FAIL — `registerIpc is not a function`, `--latest` absent, `hq.claudeHub.search` undefined.

- [ ] **Step 3: Implement**

`dashboard/claude-hub-host.js`:

```js
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
function registerIpc(ipcMain, host) {
  const h = (ch, fn) => ipcMain.handle('hq:claude-hub:' + ch, fn);
  const bool = (r, why) => (r === true ? true : r === false ? { error: why } : r);
  h('health', () => host.health());
  h('projects', (_e, o) => host.request('listProjects', { source: obj(o).source }));
  h('conversations', (_e, o) => host.request('listConversations', { ...obj(o) }));
  h('conversation', (_e, id, o) => host.request('getConversation', { ...obj(o), id: String(id || '') }));
  h('search', (_e, q, o) => host.request('search', { ...obj(o), q: String(q || '') }));
  h('stats', (_e, o) => host.request('stats', { ...obj(o) }, { timeout: 15000 }));
  h('link', async (_e, id, hqId, state) => bool(await host.request('link', { projectId: String(id || ''), hqProjectId: hqId == null ? null : String(hqId), state: String(state || '') }), 'unknown project'));
  h('forget', async (_e, t) => bool(await host.request('forget', { ...obj(t) }, { timeout: 60000 }), 'nothing to forget'));
  h('reindex', () => host.request('reindex'));
}
```

`create` takes `latestFile = null` and spawns with `['--no-warnings', hubScript, '--db', dbFile, ...(latestFile ? ['--latest', latestFile] : [])]`. `init` passes `latestFile: process.env.HQ_HUB_LATEST || path.join(dataDir, 'latest.json')` (the same env-first rule as `HQ_CLAUDE_DB` two lines above it: a gate or second instance points the linker at a fixture scan instead of the owner's live `data/latest.json`; the Hub gives `--latest` precedence over its own env, so the override must be applied here) and replaces its single `ipcMain.handle('hq:claude-hub:health', …)` with `registerIpc(ipcMain, host)`. Export `registerIpc`. (`{ projects: … source: undefined }` serialises without the key — fine.)

`dashboard/preload.js`, inside `claudeHub: { … }` after `health`:

```js
    projects: (opts) => ipcRenderer.invoke('hq:claude-hub:projects', opts),
    conversations: (opts) => ipcRenderer.invoke('hq:claude-hub:conversations', opts),
    conversation: (id, opts) => ipcRenderer.invoke('hq:claude-hub:conversation', id, opts),
    search: (q, opts) => ipcRenderer.invoke('hq:claude-hub:search', q, opts),
    stats: (opts) => ipcRenderer.invoke('hq:claude-hub:stats', opts),
    link: (id, hqId, state) => ipcRenderer.invoke('hq:claude-hub:link', id, hqId, state),
    forget: (target) => ipcRenderer.invoke('hq:claude-hub:forget', target),
    reindex: () => ipcRenderer.invoke('hq:claude-hub:reindex'),
```

`dashboard-v5/tools/fake-preload.js` — placeholder data near the top of `createFake`, rows in SPEC after `claudeHub.health`:

```js
  const HUB_AT = '2026-10-04T09:00:00.000Z';
  const HUB_PROJECTS = [
    { id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'project-a', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a', link_state: 'auto', conversations: 2, last_at: HUB_AT },
    { id: 'code:C--placeholder-project-b', source: 'code', key: 'C--placeholder-project-b', name: 'project-b', path: 'C:\\placeholder\\project-b', hq_project_id: null, link_state: 'none', conversations: 1, last_at: '2026-09-30T08:00:00.000Z' },
  ];
  const HUB_CONVS = [
    { id: 'code:sess-a1', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a1', title: 'Release planning', title_source: 'ai', started_at: '2026-10-04T08:40:00.000Z', last_at: HUB_AT, message_count: 4, cwd: 'C:\\placeholder\\project-a', git_branch: 'main', model: 'claude-placeholder', tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10, active_ms: 120000, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
    { id: 'code:sess-a2', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a2', title: 'Fix the café bug 🚀', title_source: 'first-prompt', started_at: '2026-10-03T10:00:00.000Z', last_at: '2026-10-03T10:05:00.000Z', message_count: 2, cwd: 'C:\\placeholder\\project-a', git_branch: null, model: null, tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_write: null, active_ms: 0, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
  ];
  const hubThread = (id) => {
    const c = HUB_CONVS.find((x) => x.id === id);
    if (!c) return null;
    return { conversation: c, hasMore: false, messages: [
      { id: id + ':u1', conversation_id: id, role: 'user', at: c.started_at, text: 'Plan the release for project-a', tool_name: null, is_sidechain: 0 },
      { id: id + ':a1', conversation_id: id, role: 'assistant', at: c.last_at, text: '[tool: Read README.md]', tool_name: 'Read', is_sidechain: 0 },
      { id: id + ':t1', conversation_id: id, role: 'tool', at: c.last_at, text: '# project-a\nplaceholder readme', tool_name: null, is_sidechain: 0 },
      { id: id + ':a2', conversation_id: id, role: 'assistant', at: c.last_at, text: 'Here is a release plan.', tool_name: null, is_sidechain: 0 },
    ] };
  };
  const HUB_HITS = [
    { messageId: 'code:sess-a1:a2', conversationId: 'code:sess-a1', at: HUB_AT, role: 'assistant', title: 'Release planning', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: 'Here is a \u0002release\u0003 plan.', rank: -2 },
    { messageId: 'code:sess-a2:u1', conversationId: 'code:sess-a2', at: '2026-10-03T10:00:00.000Z', role: 'user', title: 'Fix the café bug 🚀', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: '…pasted \u0002<img src=x onerror=alert(1)>\u0003 <script>release()</script> and \u0002release', rank: -1 },
  ];
  ...
    ['claudeHub.projects', () => HUB_PROJECTS],
    ['claudeHub.conversations', () => HUB_CONVS],
    ['claudeHub.conversation', (id) => hubThread(id)],
    ['claudeHub.search', () => HUB_HITS],
    ['claudeHub.stats', () => ({ from: '2026-09-06', to: '2026-10-05', tzOffsetMin: 0, days: [{ day: '2026-10-03', chats: 1, messages: 2, active_ms: 0 }, { day: '2026-10-04', chats: 1, messages: 4, active_ms: 120000 }],
      projects: [{ project_id: HUB_PROJECTS[0].id, name: 'project-a', chats: 2, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 }],
      totals: { chats: 2, active_ms: 120000, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 } })],
    ['claudeHub.link', WRITE], ['claudeHub.forget', WRITE], ['claudeHub.reindex', () => ({ started: true })],
```

(The second hit deliberately ends with an unbalanced `\u0002` — Review Focus 2.)

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test dashboard/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS, including fake-preload parity ('the fake exposes exactly the real preload method paths').

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-hub-host.js dashboard/claude-hub-host.test.mjs dashboard/preload.js dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs
git commit -m "fe: Claude Hub H2 — IPC handlers + preload claudeHub.projects/conversations/conversation/search/stats/link/forget/reindex, fake parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: v5 live data — Hub view models (`adapter.mjs`) and `live.claudeLib` (`store.js`)

Closes Review Focus 2 (`snippetParts`) and 4 (renderer side: the local offset is sent).

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (new exports at the end), `dashboard-v5/src/live/store.js` (`live` :40-50, Hub wiring :174-186, returned object :197-201)
- Test: `dashboard-v5/src/live/adapter.test.mjs`, `dashboard-v5/src/live/store.test.mjs` (append; extend the local `hubHq` with the new methods)

**Interfaces:**
- Consumes: Task 7 `hq.claudeHub.*` shapes (snake_case rows).
- Produces (adapter, all pure, NEW):
  - `snippetParts(s) -> [{ text, hit }]` — splits on U+0002/U+0003, strips the markers, keeps every other character; an unclosed U+0002 marks the rest as hit, a stray U+0003 is dropped; adjacent parts of one kind are merged; empty parts removed. Text is bound with `{{ }}` (textContent), never as HTML.
  - `fmtTokens(n) -> string|null` — `null` for null/undefined (unknown is not zero), `'950'`, `'12.3k'`, `'4.1M'`.
  - `hubConv(row, now) -> { id, title, project, projectId, hqProjectId, source, sourceLabel, when, count, tokens, cursor:{before, beforeId} }` — `title` falls back to `'Untitled chat'`; `tokens` = `fmtTokens(tokens_in + tokens_out + cache)` or `null`.
  - `hubThread(r, now) -> null | { id, title, project, model, branch, tokens, activeEst, messages:[{ id, role, who, time, day, text, tool, toolName, collapsed }], hasMore, cursor }` — `tool: true` for `role === 'tool'` or a `[tool: …]` line; `collapsed` defaults to `tool`; `activeEst` = `'~N min (estimate)'`; `cursor` = the first message's `{ before: at, beforeId: id }`.
  - `hubProject(row, now) -> { id, name, path, count, when, hqProjectId, linkState }`.
  - `hubHit(h, now) -> { conversationId, messageId, title, when, parts }`.
  - `hubStats(r) -> { days:[{ day, chats, activeMin }], projects:[{ id, name, chats, tokens }], totals:{ chats, activeMin, tokens } }`.
- Produces (store, NEW): `live.claudeLib = { projects, convs, convsMore, filters, q, hits, thread, stats, error, busy }` (all `null`/empty until asked) and functions on the store object:
  - `refreshClaudeLib(filters = live.claudeLib.filters) -> Promise` — projects + first page of conversations (`limit: 50`).
  - `moreClaudeConvs() -> Promise` — next page with the last row's `{before, beforeId}`.
  - `searchClaude(q) -> Promise` — `hits = null` when `q` has no letter/digit (`noTerms: true`, the UI says why), else `hq.claudeHub.search(q, {limit: 50})`.
  - `openClaudeThread(id) -> Promise`, `earlierClaudeThread() -> Promise` (prepends the earlier page), `closeClaudeThread()`.
  - `refreshClaudeStats(days = 30) -> Promise` — `from`/`to` = local days, `tzOffsetMin: -new Date().getTimezoneOffset()`.
  - A `changed` event re-runs `refreshClaudeLib()` when the library was loaded, `refreshClaudeStats()` when stats were loaded, and re-opens the open thread when its id is in `ids`.
  - Any `{error}` answer or a throw sets `live.claudeLib.error = 'Claude Hub: <text>'` and keeps the last loaded data (spec §10 "lists show the last loaded data"), never an empty list.

- [ ] **Step 1: Write the failing tests**

```js
// append to dashboard-v5/src/live/adapter.test.mjs
import { snippetParts, fmtTokens, hubConv, hubThread, hubHit, hubStats } from './adapter.mjs';
test('snippetParts: markers stripped, unbalanced markers never swallow text, markup stays text', () => {
  assert.deepEqual(snippetParts('a \u0002rel\u0003 b'), [{ text: 'a ', hit: false }, { text: 'rel', hit: true }, { text: ' b', hit: false }]);
  assert.deepEqual(snippetParts('x \u0002open to the end'), [{ text: 'x ', hit: false }, { text: 'open to the end', hit: true }]);
  assert.deepEqual(snippetParts('stray\u0003 close'), [{ text: 'stray close', hit: false }]);
  const evil = snippetParts('\u0002<img src=x onerror=alert(1)>\u0003<script>');
  assert.equal(evil.map((p) => p.text).join(''), '<img src=x onerror=alert(1)><script>');
  assert.deepEqual(snippetParts(''), []); assert.deepEqual(snippetParts(null), []);
});
test('fmtTokens: unknown is null, not zero', () => {
  assert.equal(fmtTokens(null), null); assert.equal(fmtTokens(0), '0'); assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(12345), '12.3k'); assert.equal(fmtTokens(4100000), '4.1M');
});
test('hubConv / hubThread / hubHit / hubStats map the Hub rows', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const row = { id: 'code:s', source: 'code', title: null, project_name: 'project-a', project_id: 'code:p', hq_project_id: 'project-a', last_at: '2026-10-04T10:00:00.000Z', message_count: 3, tokens_in: 10, tokens_out: 20, tokens_cache_read: null, tokens_cache_write: null };
  const c = hubConv(row, now);
  assert.equal(c.title, 'Untitled chat'); assert.equal(c.tokens, '30'); assert.deepEqual(c.cursor, { before: row.last_at, beforeId: 'code:s' });
  assert.equal(hubConv({ ...row, tokens_in: null, tokens_out: null }, now).tokens, null);
  const t = hubThread({ conversation: { ...row, model: 'claude-placeholder', git_branch: 'main', active_ms: 125000 }, hasMore: true,
    messages: [{ id: 'm1', role: 'user', at: '2026-10-04T09:58:00.000Z', text: 'hi' }, { id: 'm2', role: 'tool', at: '2026-10-04T09:59:00.000Z', text: 'out' }, { id: 'm3', role: 'assistant', at: '2026-10-04T09:59:00.000Z', text: '[tool: Read a.md]' }] }, now);
  assert.deepEqual(t.messages.map((m) => [m.tool, m.collapsed]), [[false, false], [true, true], [true, true]]);
  assert.deepEqual(t.cursor, { before: '2026-10-04T09:58:00.000Z', beforeId: 'm1' });
  assert.match(t.activeEst, /estimate/);
  assert.equal(hubThread(null, now), null);
  assert.equal(hubHit({ conversationId: 'code:s', messageId: 'm', title: 'T', at: row.last_at, snippet: '\u0002a\u0003' }, now).parts[0].hit, true);
  const s = hubStats({ days: [{ day: '2026-10-04', chats: 2, messages: 5, active_ms: 120000 }], projects: [{ project_id: 'code:p', name: 'project-a', chats: 2, tokens_in: 1, tokens_out: 2, tokens_cache_read: 0, tokens_cache_write: 0 }], totals: { chats: 2, active_ms: 120000, tokens_in: 1, tokens_out: 2, tokens_cache_read: 0, tokens_cache_write: 0 } });
  assert.deepEqual(s.days, [{ day: '2026-10-04', chats: 2, activeMin: 2 }]);
  assert.equal(s.totals.tokens, '3');
});
```

```js
// append to dashboard-v5/src/live/store.test.mjs
function libHq(over = {}) {
  const h = hubHq({ state: 'ready' }), calls = [];
  const rec = (name, val) => (...a) => { calls.push([name, a]); return Promise.resolve(typeof val === 'function' ? val(...a) : val); };
  Object.assign(h.hq.claudeHub, {
    projects: rec('projects', [{ id: 'code:p', name: 'project-a', conversations: 1, last_at: '2026-10-04T10:00:00Z', hq_project_id: null, link_state: 'none' }]),
    conversations: rec('conversations', (o) => (o && o.beforeId ? [] : [{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }])),
    conversation: rec('conversation', (id) => ({ conversation: { id, title: 'T' }, hasMore: false, messages: [] })),
    search: rec('search', []), stats: rec('stats', { days: [], projects: [], totals: {} }), ...over,
  });
  return { ...h, calls };
}
test('claudeLib: loads on demand, pages with the (before, beforeId) cursor, sends the local offset', async () => {
  const { hq, calls, fire } = libHq();
  const st = createStore(DATA(), hq); await st.start();
  assert.equal(st.live.claudeLib.convs, null);                       // nothing fetched until a screen asks
  await st.refreshClaudeLib({ source: 'code' });
  assert.equal(st.live.claudeLib.convs.length, 1);
  await st.moreClaudeConvs();
  assert.deepEqual(calls.at(-1), ['conversations', [{ source: 'code', limit: 50, before: '2026-10-04T10:00:00Z', beforeId: 'code:s' }]]);
  assert.equal(st.live.claudeLib.convsMore, false);
  await st.refreshClaudeStats(30);
  assert.equal(calls.at(-1)[1][0].tzOffsetMin, -new Date().getTimezoneOffset());
  await st.openClaudeThread('code:s');
  const before = calls.length;
  fire({ event: 'changed', data: { ids: ['code:s'] } }); await settle(); await settle();
  assert.ok(calls.slice(before).some(([n]) => n === 'conversation'), 'open thread re-read on change');
  assert.ok(calls.slice(before).some(([n]) => n === 'conversations'), 'list re-read on change');
  st.stop();
});
test('claudeLib: an {error} keeps the last data and says why; a no-term search says so', async () => {
  let fail = false;
  const { hq } = libHq({ conversations: () => Promise.resolve(fail ? { error: 'timeout' } : [{ id: 'code:s', title: 'T', last_at: 'x', message_count: 1 }]) });
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeLib({}); fail = true; await st.refreshClaudeLib({});
  assert.equal(st.live.claudeLib.convs.length, 1);
  assert.equal(st.live.claudeLib.error, 'Claude Hub: timeout');
  await st.searchClaude('!!! ...');
  assert.equal(st.live.claudeLib.hits, null); assert.equal(st.live.claudeLib.noTerms, true);
  st.stop();
});
```

Run: `node --test dashboard-v5/src/live/*.test.mjs`
Expected: FAIL — the new adapter exports and store functions do not exist.

- [ ] **Step 2: Implement the adapter** (append to `adapter.mjs`; `ago(ms, now)`, `arr`, `obj`, `num` are its existing helpers):

```js
// ---- Claude Hub library (spec 2026-10-13 §9). Hub rows arrive snake_case, exactly as the Hub returns them.
export function snippetParts(s) {
  const out = []; let hit = false, buf = '';
  const push = () => { if (!buf) return; const last = out[out.length - 1]; if (last && last.hit === hit) last.text += buf; else out.push({ text: buf, hit }); buf = ''; };
  for (const ch of String(s == null ? '' : s)) {
    if (ch === '\u0002') { if (!hit) { push(); hit = true; } }
    else if (ch === '\u0003') { if (hit) { push(); hit = false; } }
    else buf += ch;
  }
  push();
  return out;
}
export function fmtTokens(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v));
}
const tokSum = (r) => { const ks = ['tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write']; return ks.every((k) => r[k] == null) ? null : ks.reduce((n, k) => n + num(r[k], 0), 0); };
const at2ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
const whenOf = (s, now) => { const t = at2ms(s); return t === null ? '' : ago(t, now); };
const hhmmOf = (s) => { const t = at2ms(s); if (t === null) return ''; const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const TOOL_LINE = /^\[tool: /;
export function hubConv(row, now = Date.now()) {
  const r = obj(row);
  return { id: String(r.id || ''), title: r.title ? String(r.title) : 'Untitled chat', project: String(r.project_name || ''), projectId: String(r.project_id || ''),
    hqProjectId: r.hq_project_id ? String(r.hq_project_id) : null, source: String(r.source || 'code'), sourceLabel: r.source === 'web' ? 'claude.ai' : 'Code',
    when: whenOf(r.last_at, now), count: num(r.message_count, 0), tokens: fmtTokens(tokSum(r)), cursor: { before: r.last_at || null, beforeId: String(r.id || '') } };
}
export function hubThread(res, now = Date.now()) {
  if (!res || typeof res !== 'object' || !res.conversation) return null;
  const c = obj(res.conversation), ms = arr(res.messages);
  const messages = ms.map((m) => { const tool = m.role === 'tool' || TOOL_LINE.test(String(m.text || ''));
    return { id: String(m.id), role: String(m.role || ''), who: m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Claude' : m.role === 'tool' ? 'Tool output' : 'System',
      time: hhmmOf(m.at), day: String(m.at || '').slice(0, 10), text: String(m.text || ''), tool, toolName: m.tool_name ? String(m.tool_name) : null, collapsed: tool }; });
  const mins = Math.round(num(c.active_ms, 0) / 60000);
  return { id: String(c.id || ''), title: c.title ? String(c.title) : 'Untitled chat', project: String(c.project_name || ''), model: c.model || null, branch: c.git_branch || null,
    tokens: fmtTokens(tokSum(c)), activeEst: '~' + mins + ' min (estimate)', messages, hasMore: !!res.hasMore,
    cursor: ms.length ? { before: ms[0].at || null, beforeId: String(ms[0].id) } : null };
}
export function hubProject(row, now = Date.now()) {
  const r = obj(row);
  return { id: String(r.id || ''), name: String(r.name || r.key || ''), path: String(r.path || ''), count: num(r.conversations, 0), when: whenOf(r.last_at, now),
    hqProjectId: r.hq_project_id ? String(r.hq_project_id) : null, linkState: ['auto', 'confirmed', 'rejected'].includes(r.link_state) ? r.link_state : 'none' };
}
export function hubHit(h, now = Date.now()) {
  const r = obj(h);
  return { conversationId: String(r.conversationId || ''), messageId: String(r.messageId || ''), title: r.title ? String(r.title) : 'Untitled chat', when: whenOf(r.at, now), parts: snippetParts(r.snippet) };
}
export function hubStats(res) {
  const r = obj(res), t = obj(r.totals);
  return { days: arr(r.days).map((d) => ({ day: String(d.day), chats: num(d.chats, 0), activeMin: Math.round(num(d.active_ms, 0) / 60000) })),
    projects: arr(r.projects).map((p) => ({ id: String(p.project_id), name: String(p.name || p.project_id), chats: num(p.chats, 0), tokens: fmtTokens(tokSum(p)) })),
    totals: { chats: num(t.chats, 0), activeMin: Math.round(num(t.active_ms, 0) / 60000), tokens: fmtTokens(tokSum(t)) } };
}
```

- [ ] **Step 3: Implement the store** (`store.js`): add `claudeLib: { projects: null, convs: null, convsMore: false, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false },` to `live` with the comment `// Claude library (H2): Hub rows, raw; vals map them via adapter hub*()`, then:

```js
  // Place this block inside createStore, before its returned object (the consts are read only at call time).
  const lib = () => live.claudeLib;
  // One error slot for the whole library: each ENTRY function clears it before it asks (fresh action, fresh verdict);
  // a success never clears it, so two parallel calls cannot erase each other's failure. busy counts calls in flight.
  let libPending = 0;
  const hubCall = (fn, ok) => {
    if (!hq || !hq.claudeHub) return Promise.resolve();
    libPending++; lib().busy = true;
    return Promise.resolve().then(fn).then((r) => {
      if (r && typeof r === 'object' && !Array.isArray(r) && r.error) { lib().error = 'Claude Hub: ' + r.error; return; }
      ok(r);
    }).catch((e) => { lib().error = 'Claude Hub: ' + ((e && e.message) || e); })
      .finally(() => { libPending--; lib().busy = libPending > 0; emit(); });
  };
  const fresh = () => { lib().error = null; };
  const PAGE = 50;
  function refreshClaudeLib(filters = lib().filters) {
    lib().filters = { ...filters }; fresh();
    return Promise.all([
      hubCall(() => hq.claudeHub.projects({}), (r) => { lib().projects = Array.isArray(r) ? r : []; }),
      hubCall(() => hq.claudeHub.conversations({ ...lib().filters, limit: PAGE }), (r) => { const rows = Array.isArray(r) ? r : []; lib().convs = rows; lib().convsMore = rows.length === PAGE; }),
    ]);
  }
  function moreClaudeConvs() {
    const rows = lib().convs || [], last = rows[rows.length - 1];
    if (!last) return Promise.resolve();
    fresh();
    return hubCall(() => hq.claudeHub.conversations({ ...lib().filters, limit: PAGE, before: last.last_at, beforeId: last.id }),
      (r) => { const more = Array.isArray(r) ? r : []; lib().convs = rows.concat(more); lib().convsMore = more.length === PAGE; });
  }
  function searchClaude(q) {
    lib().q = String(q || '');
    if (!/[\p{L}\p{N}]/u.test(lib().q)) { fresh(); lib().hits = null; lib().noTerms = lib().q.trim() !== ''; emit(); return Promise.resolve(); }
    lib().noTerms = false; fresh();
    return hubCall(() => hq.claudeHub.search(lib().q, { limit: 50 }), (r) => { lib().hits = Array.isArray(r) ? r : []; });
  }
  function openClaudeThread(id) { fresh(); return hubCall(() => hq.claudeHub.conversation(id, { limit: 200 }), (r) => { lib().thread = r && r.conversation ? r : { missing: id }; }); }
  function earlierClaudeThread() {
    const t = lib().thread, first = t && t.messages && t.messages[0];
    if (!first || !t.hasMore) return Promise.resolve();
    fresh();
    return hubCall(() => hq.claudeHub.conversation(t.conversation.id, { limit: 200, before: first.at, beforeId: first.id }),
      (r) => { if (r && r.conversation) lib().thread = { ...r, messages: r.messages.concat(t.messages) }; });
  }
  function closeClaudeThread() { lib().thread = null; emit(); }
  const localDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function refreshClaudeStats(days = 30) {
    const to = new Date(), from = new Date(to.getTime() - (days - 1) * 86400000);
    fresh();
    return hubCall(() => hq.claudeHub.stats({ from: localDay(from), to: localDay(to), tzOffsetMin: -new Date().getTimezoneOffset() }), (r) => { lib().stats = r; });
  }
```

In the existing `hq.claudeHub.on` handler (store.js ~:184), the `changed` branch is today a one-line
`else if (e.event === 'changed' && hq.claudeHub.health) pull(...)`. Turn it into a block so the new lines run even
without `health`: `else if (e.event === 'changed') { if (hq.claudeHub.health) pull(...as before...); <the lines below> }`:

```js
        if (lib().convs) refreshClaudeLib();
        if (lib().stats) refreshClaudeStats();
        const t = lib().thread;
        if (t && t.conversation && Array.isArray(e.data && e.data.ids) && e.data.ids.includes(t.conversation.id)) openClaudeThread(t.conversation.id);
```

Export `refreshClaudeLib, moreClaudeConvs, searchClaude, openClaudeThread, earlierClaudeThread, closeClaudeThread, refreshClaudeStats` in the returned object. Thread refresh on `changed` re-reads the newest page (the owner sees new lines); earlier pages already loaded are dropped then — acceptable, the "Load earlier" button returns.

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test dashboard-v5/src/live/*.test.mjs`
Expected: PASS (the shared `fakeHq` subscription counts are unchanged: no new `on*` method).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs
git commit -m "fe: v5 Claude library data — Hub view models (safe snippet parts), live.claudeLib with cursor paging, local-day stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Claude tab › Chats — list, filters, search, thread view, Forget

Spec §9 Chats. Closes Review Focus 1 (UI side: "Load earlier" uses the cursor) and 2 (render side).

**Files:**
- Create: `dashboard-v5/src/logic/claude-lib.js` (mixin `claudeLibLogic` + pure `chatsView`), `dashboard-v5/src/logic/claude-lib.test.mjs`, `dashboard-v5/src/vals/claude-lib.js` (`claudeLibVals`)
- Modify: `dashboard-v5/src/live/catalog.mjs` (`SUBS.claude` :36), `dashboard-v5/src/app.js` (`initState` :56 + new keys, `componentDidUpdate` :143-144, imports :17-31, `Object.assign` :375), `dashboard-v5/src/vals/index.js` (`SURFACES`), `dashboard-v5/src/tpl/claude.tpl.js` (new `<sc-if value="{{ isChats }}">` block before `isSessions`), `dashboard-v5/src/tpl.hash.test.mjs` (re-record by hand), `dashboard-v5/src/__golden__/vals.hashes.json` (re-record)

**Interfaces:**
- Consumes: Task 8 store functions and `adapter` `hubConv/hubThread/hubHit/hubProject`; `LIVE.claudeHub` (H1 health) for the "why empty" text; `this.call(fn)` (app.js:261), `this.toast`, `this.claudeTerminal(path, prompt)` (logic/project.js).
- Produces:
  - `SUBS.claude = [['chats','Chats'], ['projects','Projects'], ['sessions','Sessions'], ['canvas','Canvas']]`; default `sub.claude = 'chats'` (spec: "Chats (new default)").
  - State keys (initState, comment `// Claude library (H2, logic/claude-lib.js)`): `clSrc: 'all'`, `clProj: ''`, `clSince: 'all'`, `clQuery: ''`, `clSearched: false`, `clOpen: false`, `clExpanded: {}`, `clForgetAsk: false`, `clLinkPick: ''`. Filters `clSrc/clProj/clSince` persist in `localStorage['hq-claude-lib']` (`CL_PREFS_KEY`, try/catch on every access).
  - `chatsView(lib, hub, S, hasBridge, now) -> { rows, hasRows, more, emptyText, hits, hasHits, hitsText, thread, error, busy }` (pure, exported for tests) — `emptyText` says WHY (no app bridge / Hub needs Node 22.13 / Hub down / still indexing / filters match nothing / nothing indexed yet), never a bare zero.
  - Mixin `claudeLibLogic`: `clFilters()`, `clLoad()`, `clSetFilter(key, value)`, `onClQuery(e)`, `clSearch()`, `clClearSearch()`, `clOpenChat(id)`, `clCloseChat()`, `clEarlier()`, `clToggleTool(id)`, `clForget()`, `clTermAt(dir, noDir)`, `clTerminal()`.
  - Vals keys (all from `claudeLibVals`): `isChats, clSrcChips, clSinceChips, clProjChips, clQuery, onClQuery, clSearch, clClearSearch, clSearchKey, clSearched, clRows, clHasRows, clMore, clLoadMore, clEmptyText, clShowEmpty, clHits, clHasHits, clHitsText, clThread, clHasThread, clThreadMsgs, clThreadMore, clEarlier, clCloseChat, clForgetAsk, clForgetStart, clForgetCancel, clForget, clTerminal, clError, clHasError, clBusy`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard-v5/src/logic/claude-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatsView, CL_PREFS_KEY } from './claude-lib.js';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const LIB = (o = {}) => ({ projects: null, convs: null, convsMore: false, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false, ...o });
const S = { clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clExpanded: {} };

test('empty states say why', () => {
  assert.match(chatsView(LIB(), null, S, false, NOW).emptyText, /WorkspaceHQ app/);
  assert.match(chatsView(LIB(), { state: 'no-node', node: 'v20.0.0' }, S, true, NOW).emptyText, /Node 22\.13 or newer \(found: v20\.0\.0\)/);
  assert.match(chatsView(LIB(), { state: 'down', error: 'x' }, S, true, NOW).emptyText, /not running/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'indexing', backfill: { done: 1, total: 4 } }, S, true, NOW).emptyText, /still reading/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'ready' }, { ...S, clSrc: 'code' }, true, NOW).emptyText, /No chats match/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'ready' }, S, true, NOW).emptyText, /No Claude Code sessions indexed yet/);
  assert.equal(chatsView(LIB({ convs: [{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }] }), { state: 'ready' }, S, true, NOW).hasRows, true);
});

test('search: hits keep markup as text parts; a no-term query explains itself', () => {
  const hits = [{ conversationId: 'code:s', messageId: 'm', title: 'T', at: '2026-10-04T10:00:00Z', snippet: '\u0002<img src=x onerror=alert(1)>\u0003' }];
  const v = chatsView(LIB({ hits, q: 'img' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW);
  assert.equal(v.hits[0].parts[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(v.hits[0].parts[0].hit, true);
  assert.match(chatsView(LIB({ noTerms: true, q: '!!!' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW).hitsText, /letters or digits/);
  assert.match(chatsView(LIB({ hits: [], q: 'zzz' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW).hitsText, /No messages contain/);
});

test('thread: tool rows collapsed unless expanded; missing chat says so', () => {
  const thread = { conversation: { id: 'code:s', title: 'T' }, hasMore: true, messages: [{ id: 'm1', role: 'tool', at: '2026-10-04T10:00:00Z', text: 'out' }] };
  assert.equal(chatsView(LIB({ thread }), { state: 'ready' }, S, true, NOW).thread.messages[0].collapsed, true);
  assert.equal(chatsView(LIB({ thread }), { state: 'ready' }, { ...S, clExpanded: { m1: true } }, true, NOW).thread.messages[0].collapsed, false);
  assert.match(chatsView(LIB({ thread: { missing: 'code:x' } }), { state: 'ready' }, S, true, NOW).thread.gone, /forgotten or no longer indexed/);
  assert.equal(CL_PREFS_KEY, 'hq-claude-lib');
});
```

Run: `node --test dashboard-v5/src/logic/claude-lib.test.mjs`
Expected: FAIL — `Cannot find module './claude-lib.js'`.

Before Step 2 (nothing renderer-side changed yet), take the golden BASE dump that Step 5 diffs against: `GOLDEN_DUMP="$TEMP/golden-h2-base" node --test dashboard-v5/src/vals.golden.test.mjs` (it passes; the dump is the before-picture).

- [ ] **Step 2: Implement `logic/claude-lib.js`**

```js
// Claude library (spec 2026-10-13 §9 Chats/Projects; H2). Pure view helpers + the Component mixin.
import { hubConv, hubThread, hubHit } from '../live/adapter.mjs';

export const CL_PREFS_KEY = 'hq-claude-lib';
const SINCE_DAYS = { '7': 7, '30': 30 };

export function hubWhy(hub, hasBridge) {
  if (!hasBridge) return 'Chats live in the WorkspaceHQ app — this preview has no app bridge.';
  if (!hub) return 'Asking the Claude Hub…';
  if (hub.state === 'no-node') return 'Claude Hub needs Node 22.13 or newer (found: ' + (hub.node || 'none') + ').';
  if (hub.state === 'down' || hub.state === 'starting') return 'The Claude Hub is not running' + (hub.error ? ' (' + hub.error + ')' : '') + ' — lists show the last loaded data.';
  return null;
}

export function chatsView(lib, hub, S, hasBridge, now = Date.now()) {
  const L = lib || {};
  const filtered = S.clSrc !== 'all' || !!S.clProj || S.clSince !== 'all';
  const rows = (L.convs || []).map((r) => hubConv(r, now));
  let emptyText = hubWhy(hub, hasBridge);
  if (!emptyText) {
    if (L.convs === null) emptyText = 'Loading chats…';
    else if (!rows.length && hub && hub.state === 'indexing') emptyText = 'The Hub is still reading your transcripts (' + ((hub.backfill && hub.backfill.done) || 0) + ' of ' + ((hub.backfill && hub.backfill.total) || '?') + ' files).';
    else if (!rows.length && filtered) emptyText = 'No chats match these filters.';
    else if (!rows.length) emptyText = 'No Claude Code sessions indexed yet — the Hub reads ~/.claude/projects.';
  }
  const hits = (L.hits || []).map((h) => hubHit(h, now));
  const hitsText = !S.clSearched ? '' : L.noTerms ? 'Search needs letters or digits — punctuation alone matches nothing.'
    : L.hits && !hits.length ? 'No messages contain “' + L.q + '”.' : L.hits ? hits.length + ' message' + (hits.length === 1 ? '' : 's') + ' (best matches first)' : '';
  let thread = null;
  if (L.thread && L.thread.missing) thread = { gone: 'This chat was forgotten or no longer indexed.', messages: [] };
  else if (L.thread) {
    const t = hubThread(L.thread, now);
    thread = t && { ...t, gone: '', messages: t.messages.map((m) => ({ ...m, collapsed: m.tool && !(S.clExpanded || {})[m.id] })) };
  }
  return { rows, hasRows: rows.length > 0, more: !!L.convsMore, emptyText: rows.length ? '' : emptyText || '', hits, hasHits: hits.length > 0, hitsText, thread, error: L.error || '', busy: !!L.busy };
}

const readPrefs = () => { try { return JSON.parse(localStorage.getItem(CL_PREFS_KEY) || '{}') || {}; } catch { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(CL_PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked: filters just do not persist */ } };
export const clPrefs = () => { const p = readPrefs(); return { clSrc: ['all', 'code', 'web'].includes(p.clSrc) ? p.clSrc : 'all', clProj: typeof p.clProj === 'string' ? p.clProj : '', clSince: ['all', '7', '30'].includes(p.clSince) ? p.clSince : 'all' }; };

export const claudeLibLogic = {
  clFilters(S = this.state) {
    const f = {};
    if (S.clSrc !== 'all') f.source = S.clSrc;
    if (S.clProj) f.projectId = S.clProj;
    if (SINCE_DAYS[S.clSince]) f.since = new Date(Date.now() - SINCE_DAYS[S.clSince] * 86400000).toISOString();
    return f;
  },
  clLoad() { if (this.store.refreshClaudeLib) this.store.refreshClaudeLib(this.clFilters()); },
  clSetFilter(key, value) {
    this.setState({ [key]: value }, () => { const S = this.state; writePrefs({ clSrc: S.clSrc, clProj: S.clProj, clSince: S.clSince }); this.clLoad(); });
  },
  onClQuery(e) { this.setState({ clQuery: e && e.target ? e.target.value : '' }); },
  clSearch() { this.setState({ clSearched: true }); return this.store.searchClaude && this.store.searchClaude(this.state.clQuery); },
  clClearSearch() { this.setState({ clQuery: '', clSearched: false }); return this.store.searchClaude && this.store.searchClaude(''); },
  clOpenChat(id) { this.setState({ clOpen: true, clExpanded: {}, clForgetAsk: false }); return this.store.openClaudeThread && this.store.openClaudeThread(id); },
  clCloseChat() { this.setState({ clOpen: false, clForgetAsk: false }); if (this.store.closeClaudeThread) this.store.closeClaudeThread(); },
  clEarlier() { return this.store.earlierClaudeThread && this.store.earlierClaudeThread(); },
  clToggleTool(id) { this.setState((s) => ({ clExpanded: { ...s.clExpanded, [id]: !s.clExpanded[id] } })); },
  async clForget() {
    const t = this.LIVE.claudeLib.thread, id = t && t.conversation && t.conversation.id;
    if (!this.canWrite()) return this.denied();   // same write gate as every other action (time machine / no bridge)
    if (!id || !this.hq || !this.hq.claudeHub) return;
    const ok = await this.call(() => this.hq.claudeHub.forget({ conversationId: id }));
    if (ok === null) return;   // call() already toasted the reason
    this.toast('success', 'Forgotten — removed from the index; the transcript on disk is untouched');
    this.clCloseChat(); this.clLoad();
  },
  // "Open in terminal" (spec §9: the existing path): same guards as questTerminal (logic/project.js) — a click never
  // leaves an unhandled rejection, a refusal says why. Empty prompt: claude opens idle in the chat's folder.
  // One guarded path for every terminal this library opens (Task 10's clNewChat uses it too).
  async clTermAt(dir, noDir) {
    if (!this.canWrite()) return this.denied();
    if (!dir) return this.denied(noDir);
    if (!this.hq || !this.hq.claudeQuest) return this.denied('This window can’t open a terminal');
    let ok;
    try { ok = await this.claudeTerminal(dir, ''); }
    catch (e) { this.toast('error', 'Couldn’t open a terminal · ' + String((e && e.message) || e)); return; }
    if (ok === TERM_SKIPPED) return;
    if (ok === false) this.toast('error', 'Couldn’t open a terminal · the folder wasn’t accepted (main opens only folders under Documents)');
  },
  clTerminal() {
    const t = this.LIVE.claudeLib.thread, c = t && t.conversation;
    return this.clTermAt(c && c.cwd, 'This chat has no recorded folder');
  },
};
```

Add `import { TERM_SKIPPED } from './project.js';` at the top of `claude-lib.js` (project.js exports it; it imports only `./shared.js`, so the plain-Node unit test still loads). (`this.call` returns `null` on `{error}`/throw and toasts — app.js:261. `claudeTerminal(path, prompt)` is the de-duplicating `hq.claudeQuest` wrapper in logic/project.js; main's `hq:claude-quest` passes the path through `resolveProjectPath` and accepts an empty prompt (`sanitizePrompt('')`).)

`app.js`: `import { claudeLibLogic, clPrefs } from './logic/claude-lib.js';`; add `claudeLibLogic` to the `Object.assign(Component.prototype, …)`; in `initState` set `claude: 'chats'` in the `sub` defaults and add `clSrc, clProj, clSince` from `clPrefs()` plus `clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: ''`. In `componentDidUpdate` beside the studio/life refreshes:

```js
    if (moved && S.tab === 'claude' && (S.sub.claude === 'chats' || S.sub.claude === 'projects')) this.clLoad();
```

and in `componentDidMount`, after `this.store.start()` (there is no `moved` there; `S` is `this.state`):

```js
    { const S = this.state; if (S.tab === 'claude' && !S.route && (S.sub.claude === 'chats' || S.sub.claude === 'projects')) this.clLoad(); }   // a cold start on Chats/Projects loads too
```

`catalog.mjs` :36: `claude: [['chats', 'Chats'], ['projects', 'Projects'], ['sessions', 'Sessions'], ['canvas', 'Canvas']],`.

- [ ] **Step 3: Implement `vals/claude-lib.js`** (Chats keys; Task 10 adds the rest to the same file) and register `claudeLibVals` in `SURFACES` right after `claudeVals`:

```js
// Claude library render values (H2): Chats (+ Projects, project page, History, System in Task 10).
import { chatsView } from '../logic/claude-lib.js';

export function claudeLibVals(ctx) {
  const { S, LIVE, sub, tabStyle } = ctx;
  const chip = (active, go, label) => ({ label, go, style: Object.assign(tabStyle(active), { height: 28, padding: '0 8px', fontSize: 12 }) });
  const L = LIVE.claudeLib, cv = chatsView(L, LIVE.claudeHub, S, !!this.hq);
  const projs = (L.projects || []).filter((p) => p.conversations > 0);
  const t = cv.thread;
  return {
    isChats: sub === 'chats',
    clSrcChips: [['all', 'All'], ['code', 'Code'], ['web', 'claude.ai']].map(([k, l]) => chip(S.clSrc === k, () => this.clSetFilter('clSrc', k), l)),
    clSinceChips: [['all', 'Any time'], ['7', '7 days'], ['30', '30 days']].map(([k, l]) => chip(S.clSince === k, () => this.clSetFilter('clSince', k), l)),
    clProjChips: [chip(!S.clProj, () => this.clSetFilter('clProj', ''), 'All projects')].concat(projs.map((p) => chip(S.clProj === p.id, () => this.clSetFilter('clProj', p.id), p.name || p.key))),
    clQuery: S.clQuery, onClQuery: (e) => this.onClQuery(e), clSearch: () => this.clSearch(), clClearSearch: () => this.clClearSearch(),
    clSearchKey: (e) => { if (e && e.key === 'Enter') this.clSearch(); },
    clSearched: !!S.clSearched,
    clRows: cv.rows.map((r) => ({ ...r, hasTokens: !!r.tokens, open: () => this.clOpenChat(r.id), sel: !!(t && t.id === r.id) })),
    clHasRows: cv.hasRows, clMore: cv.more, clLoadMore: () => this.store.moreClaudeConvs && this.store.moreClaudeConvs(),
    clEmptyText: cv.emptyText, clShowEmpty: !cv.hasRows,
    clHits: cv.hits.map((h) => ({ ...h, open: () => this.clOpenChat(h.conversationId) })), clHasHits: cv.hasHits, clHitsText: cv.hitsText,
    clHasThread: !!(S.clOpen && t), clThread: t || { title: '', gone: '', project: '', model: null, branch: null, tokens: null, activeEst: '' },
    clThreadMsgs: t ? t.messages.map((m) => ({ ...m, toggle: () => this.clToggleTool(m.id), open: !m.collapsed, showTool: m.tool && !m.collapsed, arrow: m.collapsed ? '▸' : '▾' })) : [],
    clThreadMore: !!(t && t.hasMore), clEarlier: () => this.clEarlier(), clCloseChat: () => this.clCloseChat(),
    clForgetAsk: !!S.clForgetAsk, clForgetStart: () => this.setState({ clForgetAsk: true }), clForgetCancel: () => this.setState({ clForgetAsk: false }),
    clForget: () => this.clForget(), clTerminal: () => this.clTerminal(),
    clError: cv.error, clHasError: !!cv.error, clBusy: cv.busy,
  };
}
```

- [ ] **Step 4: Markup** — in `tpl/claude.tpl.js`, insert as the first child of the `<div>` at :5 (before `<sc-if value="{{ isSessions }}">`):

```html
            <!-- v5: Claude › Chats (spec 2026-10-13 §9, H2) — every indexed Claude Code chat: filters, FTS search (hits rendered as text parts, never HTML), paged thread view, Forget -->
            <sc-if value="{{ isChats }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:16px">
                <sc-if value="{{ clHasError }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--orange)">{{ clError }}</div></sc-if>
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
                  <div style="display:flex;gap:8px;align-items:center"><input value="{{ clQuery }}" onChange="{{ onClQuery }}" onKeyDown="{{ clSearchKey }}" aria-label="Search all chats" placeholder="Search every message…" style="flex:1;height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px"><button type="button" onClick="{{ clSearch }}" style="height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer" style-hover="background:var(--frame)">Search</button><sc-if value="{{ clSearched }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ clClearSearch }}" style="height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Clear</button></sc-if></div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap"><sc-for list="{{ clSrcChips }}" as="c" hint-placeholder-count="3"><button type="button" onClick="{{ c.go }}" style="{{ c.style }}">{{ c.label }}</button></sc-for><span style="width:10px"></span><sc-for list="{{ clSinceChips }}" as="c" hint-placeholder-count="3"><button type="button" onClick="{{ c.go }}" style="{{ c.style }}">{{ c.label }}</button></sc-for></div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap"><sc-for list="{{ clProjChips }}" as="c" hint-placeholder-count="4"><button type="button" onClick="{{ c.go }}" style="{{ c.style }}">{{ c.label }}</button></sc-for></div>
                </section>
                <sc-if value="{{ clSearched }}" hint-placeholder-val="{{ false }}">
                  <section data-cl="hits" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">{{ clHitsText }}</div>
                    <sc-for list="{{ clHits }}" as="h" hint-placeholder-count="3"><button type="button" data-cl="hit" onClick="{{ h.open }}" style="display:block;width:100%;text-align:left;padding:8px 0;border:0;border-bottom:1px dashed var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)"><div style="font-size:13px">{{ h.title }} <span style="font-size:11px;color:var(--faint)">{{ h.when }}</span></div><div style="font-size:12px;color:var(--muted);margin-top:2px"><sc-for list="{{ h.parts }}" as="p" hint-placeholder-count="3"><sc-if value="{{ p.hit }}" hint-placeholder-val="{{ false }}"><mark style="background:transparent;color:var(--gold);font-weight:600">{{ p.text }}</mark></sc-if><sc-if value="{{ !p.hit }}" hint-placeholder-val="{{ true }}"><span>{{ p.text }}</span></sc-if></sc-for></div></button></sc-for>
                  </section>
                </sc-if>
                <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
                  <section data-cl="list" style="flex:1 1 320px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:8px">
                    <sc-if value="{{ clShowEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:12px">{{ clEmptyText }}</div></sc-if>
                    <sc-for list="{{ clRows }}" as="r" hint-placeholder-count="6"><button type="button" data-cl="row" onClick="{{ r.open }}" style="display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)"><span style="font-size:13px"><span style="font-size:10px;color:var(--purple);border:1px solid var(--purple);border-radius:4px;padding:0 4px;margin-right:6px">{{ r.sourceLabel }}</span>{{ r.title }}</span><span style="font-size:11px;color:var(--faint)">{{ r.project }} · {{ r.when }} · {{ r.count }} messages<sc-if value="{{ r.hasTokens }}" hint-placeholder-val="{{ false }}"> · {{ r.tokens }} tokens</sc-if></span></button></sc-for>
                    <sc-if value="{{ clMore }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ clLoadMore }}" style="width:100%;height:32px;margin-top:6px;border:1px dashed var(--frame);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer">Load more chats</button></sc-if>
                  </section>
                  <sc-if value="{{ clHasThread }}" hint-placeholder-val="{{ false }}">
                    <section data-cl="thread" aria-label="Chat thread" style="flex:2 1 420px;min-width:0;background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px">
                      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:15px;flex:1">{{ clThread.title }}</span><button type="button" onClick="{{ clTerminal }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Open in terminal</button><button type="button" onClick="{{ clForgetStart }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--orange);cursor:pointer">Forget</button><button type="button" onClick="{{ clCloseChat }}" aria-label="Close thread" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">✕</button></div>
                      <div style="font-size:11px;color:var(--faint);margin-top:4px">{{ clThread.project }} · {{ clThread.model }} · {{ clThread.branch }} · {{ clThread.tokens }} tokens · {{ clThread.activeEst }}</div>
                      <sc-if value="{{ clForgetAsk }}" hint-placeholder-val="{{ false }}"><div role="alertdialog" aria-label="Forget this chat" style="margin-top:10px;padding:10px 12px;border:1px solid var(--orange);border-radius:8px;font-size:13px">Forget this chat? It leaves the index and will not be re-read; the transcript on disk is untouched. <button type="button" data-cl="forget-yes" onClick="{{ clForget }}" style="margin-left:8px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--orange);background:transparent;color:var(--orange);cursor:pointer">Forget</button><button type="button" onClick="{{ clForgetCancel }}" style="margin-left:6px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Cancel</button></div></sc-if>
                      <sc-if value="{{ clThread.gone }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);margin-top:10px">{{ clThread.gone }}</div></sc-if>
                      <sc-if value="{{ clThreadMore }}" hint-placeholder-val="{{ false }}"><button type="button" data-cl="earlier" onClick="{{ clEarlier }}" style="width:100%;height:28px;margin-top:10px;border:1px dashed var(--frame);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer">Load earlier messages</button></sc-if>
                      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;max-height:60vh;overflow:auto">
                        <sc-for list="{{ clThreadMsgs }}" as="m" hint-placeholder-count="6"><div data-cl="msg" style="font-size:13px;border-left:2px solid var(--frame);padding-left:10px"><div style="font-size:11px;color:var(--faint)">{{ m.who }} · {{ m.time }}</div><sc-if value="{{ m.tool }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ m.toggle }}" aria-expanded="{{ m.open }}" style="border:0;background:transparent;color:var(--muted);cursor:pointer;font-family:var(--term);font-size:12px;padding:0">{{ m.arrow }} tool</button></sc-if><sc-if value="{{ m.showTool }}" hint-placeholder-val="{{ false }}"><div style="white-space:pre-wrap;word-break:break-word">{{ m.text }}</div></sc-if><sc-if value="{{ !m.tool }}" hint-placeholder-val="{{ true }}"><div style="white-space:pre-wrap;word-break:break-word">{{ m.text }}</div></sc-if></div></sc-for>
                      </div>
                    </section>
                  </sc-if>
                </div>
              </div>
            </sc-if>
```

Bindings are plain dotted paths (no ternaries): the arrow and the tool-text visibility come from vals (`arrow`, `showTool`); a non-tool message renders through the `!m.tool` branch only. `onKeyDown` is an existing handler attribute (used 3× in `src/tpl`).

- [ ] **Step 5: Run the unit tests, then re-record template hash and goldens with attribution**

Run: `node --test dashboard-v5/src/logic/claude-lib.test.mjs` → PASS.
Run: `node --test dashboard-v5/src/tpl.hash.test.mjs` → FAIL (deliberate markup change). Re-record by hand: compute length/bytes/sha256 of the joined template (`node -e "import('./dashboard-v5/src/app.tpl.js').then(m=>{const t=m.default;console.log(t.length,Buffer.byteLength(t,'utf8'),require('crypto').createHash('sha256').update(t).digest('hex'))})"`), update `SHA256/LENGTH/UTF8_BYTES`, add the history line `2026-10-16 H2 Claude › Chats (+<n> chars / +<m> bytes)`.
Run: `GOLDEN_DUMP="$TEMP/golden-h2-chats" node --test dashboard-v5/src/vals.golden.test.mjs` → every scenario changes (new `cl*`/`isChats` keys are in every `renderVals()` object), plus new scenarios `tab.claude.chats`, `tab.claude.projects` "not in the hashes file". Attribute: diff two dumps (before = `git stash`-free: dump from HEAD by running the same command before Step 2 into `"$TEMP/golden-h2-base"`), confirm the only differences are the added keys and the `tab.claude` default sub. Then `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`.
Run the full v5 suite (Global Constraints › Suites) → PASS; `honesty.test.mjs` included (no deny-listed sample strings in the new files).

- [ ] **Step 6: Commit**

```bash
git add -- dashboard-v5/src/logic/claude-lib.js dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/vals/claude-lib.js dashboard-v5/src/vals/index.js dashboard-v5/src/live/catalog.mjs dashboard-v5/src/app.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: v5 Claude › Chats — filters, FTS search with text-only highlights, paged thread with collapsed tool rows, Forget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Claude › Projects (link chips), project-page "Claude" section, History "Claude activity", System Reindex

Spec §9 Projects, Project page, History, System. Closes Review Focus 5 (UI side).

**Files:**
- Modify: `dashboard-v5/src/logic/claude-lib.js` (+ pure `projectsView`, `activityView`, `pageChats`; mixin `clLink`, `clPick`, `clReindex`, `clNewChat`), `dashboard-v5/src/logic/claude-lib.test.mjs`, `dashboard-v5/src/live/store.js` (+ `refreshClaudeForProject`), `dashboard-v5/src/live/store.test.mjs`, `dashboard-v5/src/vals/claude-lib.js`, `dashboard-v5/src/app.js` (`componentDidUpdate`), `dashboard-v5/src/tpl/claude.tpl.js`, `dashboard-v5/src/tpl/project-page.tpl.js`, `dashboard-v5/src/tpl/history.tpl.js`, `dashboard-v5/src/tpl/system.tpl.js`, `dashboard-v5/src/tpl.hash.test.mjs`, `dashboard-v5/src/__golden__/vals.hashes.json`

**Interfaces:**
- Consumes: Task 7 `hq.claudeHub.link/reindex/conversations`; Task 8 `live.claudeLib.projects/stats`, `refreshClaudeStats`, `hubProject`, `hubStats`; `ctx.projects` (WorkspaceHQ projects `{id, name, path}`); `this.claudeTerminal(path, prompt)`.
- Produces:
  - store `refreshClaudeForProject(hqProjectId) -> Promise` (NEW) — `conversations({hqProjectId, limit: 5})` into `live.claudeLib.byHq[hqProjectId]` (`byHq: {}` added to `live.claudeLib`); `changed` re-runs it for every loaded key.
  - `projectsView(lib, hqProjects, S) -> { rows: [{ id, name, path, count, when, linkState, hqName, chipText, canConfirm, canChange, canUnlink, canLink, picking }], emptyText }` — `chipText`: `auto` → `'Matched by path: <name>'`, `confirmed` → `'Linked: <name>'`, `rejected` → `'Unlinked'`, `none` → `'Not linked'`; a link to an id no longer in the scan reads `'<id> (not in the latest scan)'`.
  - `activityView(stats, hub, hasBridge) -> { show, bars: [{ day, chats, activeMin, h }], chatsText, activeText, projects: [{ name, chats, tokens, hasTokens }], emptyText }` — `activeText` always ends `(estimate)`; tokens only where recorded (`null` → row shows no token figure, never `0`).
  - `pageChats(rows, now) -> [{ id, title, when, open }]` (≤ 5).
  - Mixin: `clLink(projectId, hqId, state)` (`this.call(() => this.hq.claudeHub.link(...))`, toast on success, then `this.clLoad()`), `clPick(projectId)` (toggles `clLinkPick`), `clReindex()` (`this.call(() => this.hq.claudeHub.reindex())`; success toast "Reindexing — links and forgotten chats are kept"), `clNewChat(project)` (`this.clTermAt(project.path, …)` — Task 9's guarded terminal path; opens Claude in a terminal; the button is labelled "uses your Claude quota").
  - Vals keys: `isClProjects, clProjRows, clProjEmpty, clHqPick, clPageChats, clPageHasChats, clPageEmpty, clNewChat, clAct, clReindex, clCanReindex, clReindexTip`.

- [ ] **Step 1: Write the failing tests**

```js
// append to dashboard-v5/src/logic/claude-lib.test.mjs
import { projectsView, activityView, pageChats } from './claude-lib.js';
const HQP = [{ id: 'project-a', name: 'Project A', path: 'project-a' }];
test('projectsView: chip text and actions per link state', () => {
  const lib = { projects: [
    { id: 'code:a', name: 'project-a', conversations: 2, hq_project_id: 'project-a', link_state: 'auto' },
    { id: 'code:b', name: 'project-b', conversations: 1, hq_project_id: null, link_state: 'rejected' },
    { id: 'code:c', name: 'project-c', conversations: 1, hq_project_id: 'gone', link_state: 'confirmed' },
  ] };
  const v = projectsView(lib, HQP, { clLinkPick: 'code:b' });
  const [a, b, c] = v.rows;
  assert.deepEqual([a.chipText, a.canConfirm, a.canChange, a.canUnlink], ['Matched by path: Project A', true, true, true]);
  assert.deepEqual([b.chipText, b.canConfirm, b.canLink, b.picking], ['Unlinked', false, true, true]);
  assert.equal(c.chipText, 'Linked: gone (not in the latest scan)');
  assert.match(projectsView({ projects: [] }, HQP, {}).emptyText, /No Claude Code project folders/);
});
test('activityView: estimate label, tokens only where recorded, empty says why', () => {
  const st = { days: [{ day: '2026-10-04', chats: 2, messages: 5, active_ms: 120000 }], projects: [{ project_id: 'code:a', name: 'project-a', chats: 2, tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_write: null }],
    totals: { chats: 2, active_ms: 120000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 } };
  const v = activityView(st, { state: 'ready' }, true);
  assert.equal(v.show, true); assert.match(v.activeText, /\(estimate\)$/);
  assert.equal(v.projects[0].hasTokens, false);
  assert.match(activityView({ days: [], projects: [], totals: { chats: 0, active_ms: 0 } }, { state: 'ready' }, true).emptyText, /No Claude chats in the last 30 days/);
  assert.match(activityView(null, { state: 'no-node', node: 'v20.1.0' }, true).emptyText, /Node 22\.13/);
});
test('pageChats keeps at most 5', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: 'code:' + i, title: 'T' + i, last_at: '2026-10-04T10:00:00Z' }));
  assert.equal(pageChats(rows, Date.parse('2026-10-05T10:00:00Z')).length, 5);
});
```

```js
// append to dashboard-v5/src/live/store.test.mjs
test('claudeLib: a project page asks only its linked chats', async () => {
  const { hq, calls } = libHq();
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeForProject('project-a');
  assert.deepEqual(calls.at(-1), ['conversations', [{ hqProjectId: 'project-a', limit: 5 }]]);
  assert.equal(st.live.claudeLib.byHq['project-a'].length, 1);
  st.stop();
});
```

Run: `node --test dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `projectsView`, `activityView`, `pageChats`, `refreshClaudeForProject` do not exist.

- [ ] **Step 2: Implement the pure helpers and mixin methods** (append to `logic/claude-lib.js`; `hubProject`, `hubStats`, `hubConv` from `../live/adapter.mjs`):

```js
export function projectsView(lib, hqProjects, S) {
  const names = new Map((hqProjects || []).map((p) => [p.id, p.name]));
  const nameOf = (id) => (names.has(id) ? names.get(id) : id + ' (not in the latest scan)');
  const rows = ((lib && lib.projects) || []).map((r) => hubProject(r)).map((p) => {
    const hq = p.hqProjectId, st = p.linkState;
    const chipText = st === 'auto' ? 'Matched by path: ' + nameOf(hq) : st === 'confirmed' ? 'Linked: ' + nameOf(hq) : st === 'rejected' ? 'Unlinked' : 'Not linked';
    return { ...p, hqName: hq ? nameOf(hq) : '', chipText, canConfirm: st === 'auto', canChange: st === 'auto' || st === 'confirmed', canUnlink: st === 'auto' || st === 'confirmed', canLink: st === 'none' || st === 'rejected', picking: (S && S.clLinkPick) === p.id };
  });
  const emptyText = lib && lib.projects === null ? 'Loading projects…' : rows.length ? '' : 'No Claude Code project folders indexed yet.';
  return { rows, emptyText };
}
export function activityView(stats, hub, hasBridge) {
  const why = hubWhy(hub, hasBridge);
  if (!stats) return { show: false, bars: [], chatsText: '', activeText: '', projects: [], emptyText: why || 'Loading Claude activity…' };
  const s = hubStats(stats), max = Math.max(1, ...s.days.map((d) => d.chats));
  const empty = !s.days.length;
  return { show: !empty, bars: s.days.map((d) => ({ ...d, h: Math.max(4, Math.round((d.chats / max) * 48)) + 'px', tip: d.day + ' · ' + d.chats + ' chats · ~' + d.activeMin + ' min' })),
    chatsText: s.totals.chats + ' chat' + (s.totals.chats === 1 ? '' : 's') + ' in 30 days', activeText: '~' + s.totals.activeMin + ' min active (estimate)',
    projects: s.projects.map((p) => ({ name: p.name, chats: p.chats, tokens: p.tokens || '', hasTokens: !!p.tokens })),
    emptyText: empty ? why || 'No Claude chats in the last 30 days.' : '' };
}
export function pageChats(rows, now = Date.now()) { return (rows || []).slice(0, 5).map((r) => hubConv(r, now)); }
```

Mixin additions:

```js
  async clLink(projectId, hqId, state) {
    if (!this.canWrite()) return this.denied();
    if (!this.hq || !this.hq.claudeHub) return;
    const ok = await this.call(() => this.hq.claudeHub.link(projectId, hqId, state));
    if (ok === null) return;
    this.setState({ clLinkPick: '' });
    this.toast('success', state === 'rejected' ? 'Unlinked — automatic matching will leave it alone' : 'Linked');
    this.clLoad();
  },
  clPick(projectId) { this.setState((s) => ({ clLinkPick: s.clLinkPick === projectId ? '' : projectId })); },
  async clReindex() {
    if (!this.canWrite()) return this.denied();
    if (!this.hq || !this.hq.claudeHub) return;
    const r = await this.call(() => this.hq.claudeHub.reindex());
    if (r !== null) this.toast('info', 'Reindexing — links and forgotten chats are kept');
  },
  clNewChat(project) { return this.clTermAt(project && project.path, 'This project has no folder'); },   // guarded (Task 9 clTermAt)
```

store.js: `byHq: {}` in `live.claudeLib`; 

```js
  function refreshClaudeForProject(hqProjectId) {
    if (!hqProjectId) return Promise.resolve();
    return hubCall(() => hq.claudeHub.conversations({ hqProjectId, limit: 5 }), (r) => { lib().byHq = { ...lib().byHq, [hqProjectId]: Array.isArray(r) ? r : [] }; });
  }
```

In the `changed` branch: `for (const k of Object.keys(lib().byHq)) refreshClaudeForProject(k);`. Export it.

app.js `componentDidUpdate` (beside Task 9's line):

```js
    if (moved && S.route && S.route.id) this.store.refreshClaudeForProject && this.store.refreshClaudeForProject(S.route.id);
    if (moved && S.tab === 'history' && !S.route) this.store.refreshClaudeStats && this.store.refreshClaudeStats(30);
```

- [ ] **Step 3: Vals** (append to the object returned by `claudeLibVals`; add `projects`, `onPage` to the `ctx` destructure):

```js
    isClProjects: sub === 'projects',
    clProjRows: pv.rows.map((p) => ({ ...p,
      confirm: () => this.clLink(p.id, p.hqProjectId, 'confirmed'), unlink: () => this.clLink(p.id, null, 'rejected'), pick: () => this.clPick(p.id),
      choices: projects.map((h) => ({ label: h.name, go: () => this.clLink(p.id, h.id, 'confirmed'), style: Object.assign(tabStyle(p.hqProjectId === h.id), { height: 26, padding: '0 8px', fontSize: 12 }) })) })),
    clProjEmpty: pv.emptyText,
    clPageChats: pageRows.map((c) => ({ ...c, open: () => { this.go('claude', 'chats'); this.clOpenChat(c.id); } })),
    clPageHasChats: pageRows.length > 0,
    clPageEmpty: !pageId ? '' : L.byHq[pageId] === undefined ? (hubWhy(LIVE.claudeHub, !!this.hq) || 'Loading Claude chats…') : pageRows.length ? '' : 'No Claude chats linked to this project yet — link its folder under Claude › Projects.',
    clNewChat: () => this.clNewChat(pageProj),
    clAct: activityView(L.stats, LIVE.claudeHub, !!this.hq),
    clReindex: () => this.clReindex(), clCanReindex: !!(LIVE.claudeHub && LIVE.claudeHub.role === 'writer' && LIVE.claudeHub.state === 'ready'),
    clReindexTip: LIVE.claudeHub && LIVE.claudeHub.role === 'reader' ? 'Another WorkspaceHQ owns the index (read-only here)' : 'Re-read every transcript from scratch',
```

with, before the `return`: `const pv = projectsView(L, projects, S); const pageId = onPage && S.route ? S.route.id : ''; const pageProj = projects.find((p) => p.id === pageId) || null; const pageRows = pageId ? pageChats(L.byHq[pageId]) : [];` (import `projectsView, activityView, pageChats, hubWhy`).

- [ ] **Step 4: Markup** (each block is preceded by its `<!-- v5: -->` marker)

`tpl/claude.tpl.js`, after the Chats block:

```html
            <!-- v5: Claude › Projects (spec 2026-10-13 §9, H2) — Claude Code folders with link chips to WorkspaceHQ projects; auto matches offer confirm / change / unlink -->
            <sc-if value="{{ isClProjects }}" hint-placeholder-val="{{ false }}">
              <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:8px 12px">
                <sc-if value="{{ clProjEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:12px 4px">{{ clProjEmpty }}</div></sc-if>
                <sc-for list="{{ clProjRows }}" as="p" hint-placeholder-count="4"><div data-cl="proj" style="padding:10px 0;border-bottom:1px dashed var(--frame)">
                  <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;flex:1">{{ p.name }} <span style="font-size:11px;color:var(--faint)">{{ p.count }} chats · {{ p.when }}</span></span><span data-cl="chip" style="font-size:11px;border:1px solid var(--purple);border-radius:10px;padding:1px 8px;color:var(--text)">{{ p.chipText }}</span>
                    <sc-if value="{{ p.canConfirm }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ p.confirm }}" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer">Confirm</button></sc-if>
                    <sc-if value="{{ p.canChange }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ p.pick }}" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Change</button></sc-if>
                    <sc-if value="{{ p.canLink }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ p.pick }}" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Link…</button></sc-if>
                    <sc-if value="{{ p.canUnlink }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ p.unlink }}" style="height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--orange);cursor:pointer">Unlink</button></sc-if></div>
                  <div style="font-size:11px;color:var(--faint);margin-top:2px">{{ p.path }}</div>
                  <sc-if value="{{ p.picking }}" hint-placeholder-val="{{ false }}"><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px"><sc-for list="{{ p.choices }}" as="c" hint-placeholder-count="4"><button type="button" onClick="{{ c.go }}" style="{{ c.style }}">{{ c.label }}</button></sc-for></div></sc-if>
                </div></sc-for>
              </section>
            </sc-if>
```

`tpl/project-page.tpl.js`, as the last section inside the page column (before the closing `</sc-if>` at :110; place it after the journal/details sections so the design's order is kept):

```html
            <!-- v5: project page › Claude (spec 2026-10-13 §9, H2) — this project's last 5 linked chats + New chat (a terminal session until H3's composer) -->
            <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;margin-top:20px">
              <div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);flex:1">Claude</span><button type="button" onClick="{{ clNewChat }}" title="Opens Claude Code in a terminal in this project" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer">New chat <span style="font-size:11px;color:var(--faint)">uses your Claude quota</span></button></div>
              <sc-if value="{{ clPageEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:8px 0">{{ clPageEmpty }}</div></sc-if>
              <sc-for list="{{ clPageChats }}" as="c" hint-placeholder-count="5"><button type="button" onClick="{{ c.open }}" style="display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:8px 0;border:0;border-bottom:1px dashed var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term);font-size:13px"><span>{{ c.title }}</span><span style="font-size:11px;color:var(--faint)">{{ c.when }}</span></button></sc-for>
            </section>
```

`tpl/history.tpl.js`, at the end of the `isTrends` block (before its closing `</sc-if>` near :20):

```html
              <!-- v5: History › Claude activity (spec 2026-10-13 §9, H2) — chats per local day, active time labelled estimate, tokens per project where recorded -->
              <section data-cl="activity" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;margin-top:20px">
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Claude activity</div>
                <sc-if value="{{ clAct.emptyText }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);margin-top:8px">{{ clAct.emptyText }}</div></sc-if>
                <sc-if value="{{ clAct.show }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-top:6px"><span>{{ clAct.chatsText }}</span><span style="color:var(--muted)">{{ clAct.activeText }}</span></div>
                  <div style="display:flex;align-items:flex-end;gap:2px;height:52px;margin-top:10px"><sc-for list="{{ clAct.bars }}" as="b" hint-placeholder-count="10"><div title="{{ b.tip }}" style="flex:1;min-width:3px;height:{{ b.h }};background:var(--purple);border-radius:2px"></div></sc-for></div>
                  <sc-for list="{{ clAct.projects }}" as="p" hint-placeholder-count="3"><div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--frame)"><span>{{ p.name }} · {{ p.chats }} chats</span><sc-if value="{{ p.hasTokens }}" hint-placeholder-val="{{ false }}"><span style="color:var(--faint)">{{ p.tokens }} tokens</span></sc-if></div></sc-for>
                </sc-if>
              </section>
```

`tpl/system.tpl.js`, inside the Hub card `<section>` after the progress bar line (:41):

```html
                    <!-- v5: Reindex (spec 2026-10-13 §9 System, H2) — writer only; a reader says why -->
                    <div style="margin-top:10px"><button type="button" onClick="{{ clReindex }}" disabled="{{ !clCanReindex }}" title="{{ clReindexTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Reindex</button></div>
```

- [ ] **Step 5: Tests, template hash, goldens** — `node --test dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/live/store.test.mjs` → PASS. Re-record `tpl.hash.test.mjs` by hand (history line `2026-10-16 H2 Claude › Projects, project-page Claude, History Claude activity, System Reindex (+<n> chars / +<m> bytes)`). Dump goldens to `"$TEMP/golden-h2-rest"` and attribute: every scenario gains the new `cl*` keys; `system.hub-*` scenarios gain `clCanReindex`/`clReindexTip` values that follow their hub state; project-page scenarios gain `clPageEmpty`. Then `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`; run the full v5 suite → PASS.

- [ ] **Step 6: Commit**

```bash
git add -- dashboard-v5/src/logic/claude-lib.js dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs dashboard-v5/src/vals/claude-lib.js dashboard-v5/src/app.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/project-page.tpl.js dashboard-v5/src/tpl/history.tpl.js dashboard-v5/src/tpl/system.tpl.js dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: v5 Claude › Projects link chips, project-page Claude section, History Claude activity (estimate), System Reindex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Selftest combos, storage keys, golden scenarios, CDP scenarios `claude-library-search` + `claude-thread-open`

Spec §11 v5 tests; H1 deferred item 10. Closes Review Focus 2 (end to end).

**Files:**
- Modify: `dashboard-v5/src/selftest.js` (`LOCAL_KEYS` :17, `CLEAR` :19-22, `savedLive` :124, `STATES` :144), `dashboard-v5/src/vals.golden.test.mjs` (Hub scenarios :364-372), `dashboard-v5/src/__golden__/vals.hashes.json`, `dashboard-v5/tools/cdp-gate.mjs` (`fresh()` :111-116, `SCENARIOS` before :969, header comment :17-24)
- Create: `dashboard-v5/src/selftest-keys.test.mjs`

**Interfaces:**
- Consumes: Task 9/10 state keys and vals; Task 7 fake answers (`hqFake.set/emit/calls`); Task 8 `live.claudeLib`.
- Produces: selftest STATES `cl-chats-empty`, `cl-chats-rows`, `cl-chats-hits-hostile`, `cl-thread-open`, `cl-thread-forget-ask`, `cl-projects`, `cl-history-activity`, `cl-page-chats`; golden scenarios `claude.chats-rows`, `claude.chats-hits`, `claude.thread`, `claude.projects`, `history.claude-activity`; CDP scenarios `claude-library-search`, `claude-thread-open`.

- [ ] **Step 1: Write the failing storage-key test**

```js
// dashboard-v5/src/selftest-keys.test.mjs — every storage key the renderer writes is snapshotted and restored by the selftest
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const files = ['logic', 'live', 'vals'].flatMap((d) => fs.readdirSync(path.join(SRC, d)).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f)).map((f) => path.join(SRC, d, f)));
test('selftest LOCAL_KEYS/SESSION_KEYS cover every storage key in the renderer', () => {
  const self = fs.readFileSync(path.join(SRC, 'selftest.js'), 'utf8');
  const listed = new Set([...self.matchAll(/(?:LOCAL_KEYS|SESSION_KEYS) = \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])));
  const used = new Set();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/_KEY\s*=\s*'((?:hq|whq3)-[a-z0-9-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('hq-claude-lib'));
  const missing = [...used].filter((k) => !listed.has(k));
  assert.deepEqual(missing, [], 'add to selftest.js LOCAL_KEYS/SESSION_KEYS: ' + missing.join(', '));
});
```

Run: `node --test dashboard-v5/src/selftest-keys.test.mjs`
Expected: FAIL — `missing` lists `hq-claude-lib` (and any pre-existing key the scan finds unlisted; add those too — they are storage keys the selftest must restore, item 10).

- [ ] **Step 2: Selftest declarations** (`selftest.js`):
  - `LOCAL_KEYS` gains `'hq-claude-lib'` (plus any key Step 1 reported).
  - `CLEAR` gains `clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: ''` (filters `clSrc/clProj/clSince` too: `clSrc: 'all', clProj: '', clSince: 'all'`).
  - `savedLive` gains `claudeLib: LV.claudeLib` (restored with the others).
  - Placeholder library for injection, next to `HUB`:

```js
      const CL_AT = '2026-10-04T09:00:00.000Z';
      const CL_CONVS = [{ id: 'code:st-1', source: 'code', project_id: 'code:st-p', title: 'Selftest chat', last_at: CL_AT, message_count: 3, tokens_in: 5, tokens_out: 9, project_name: 'project-a', hq_project_id: null }];
      const CL_THREAD = { conversation: { ...CL_CONVS[0], model: 'claude-placeholder', git_branch: 'main', active_ms: 60000 }, hasMore: true, messages: [
        { id: 'code:st-1:u', role: 'user', at: CL_AT, text: 'hello' }, { id: 'code:st-1:t', role: 'tool', at: CL_AT, text: 'tool output' }, { id: 'code:st-1:a', role: 'assistant', at: CL_AT, text: 'reply' }] };
      const CL = (o) => () => { LV.claudeHub = { state: 'ready', role: 'writer', counts: HUB_COUNTS }; LV.claudeLib = { projects: [], convs: [], convsMore: false, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false, byHq: {}, ...o }; };
```

  - `STATES` gains:

```js
        ['cl-chats-empty', at('claude', 'chats'), {}, CL({})],
        ['cl-chats-rows', at('claude', 'chats'), {}, CL({ convs: CL_CONVS, convsMore: true })],
        ['cl-chats-hits-hostile', at('claude', 'chats'), { clSearched: true, clQuery: 'img' }, CL({ convs: CL_CONVS, q: 'img', hits: [{ conversationId: 'code:st-1', messageId: 'm', title: 'Selftest chat', at: CL_AT, snippet: '\u0002<img src=x onerror=alert(1)>\u0003 tail \u0002open' }] })],
        ['cl-thread-open', at('claude', 'chats'), { clOpen: true }, CL({ convs: CL_CONVS, thread: CL_THREAD })],
        ['cl-thread-forget-ask', at('claude', 'chats'), { clOpen: true, clForgetAsk: true, clExpanded: { 'code:st-1:t': true } }, CL({ convs: CL_CONVS, thread: CL_THREAD })],
        ['cl-projects', at('claude', 'projects'), { clLinkPick: 'code:st-p' }, CL({ projects: [{ id: 'code:st-p', name: 'project-a', path: 'C:\\placeholder\\project-a', conversations: 1, last_at: CL_AT, hq_project_id: 'project-a', link_state: 'auto' }] })],
        ['cl-history-activity', at('history', 'trends'), {}, CL({ stats: { days: [{ day: '2026-10-04', chats: 1, messages: 3, active_ms: 60000 }], projects: [{ project_id: 'code:st-p', name: 'project-a', chats: 1, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 }], totals: { chats: 1, active_ms: 60000, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 } } })],
```

  For a project page: `['cl-page-chats', at('projects', 'grid', M.P0[0] && M.P0[0].id), {}, () => { CL({})(); if (M.P0[0]) LV.claudeLib.byHq[M.P0[0].id] = CL_CONVS; }]` (`at(tab, sub, project)` opens the page when `project` is given — the existing third argument).

- [ ] **Step 3: Golden scenarios** (`vals.golden.test.mjs`, after the Hub scenarios). The new scenarios get their own inert bridge `CL_HQ` (`P3_HQ` itself is NOT changed, so no existing scenario moves). `state` must be a FUNCTION here: `tabSub(tab, sub)` returns `(c) => ({…})` (the runner calls a function `sc.state(c, M)`; spreading the function itself would yield `{}` and every scenario would render Home):

```js
const CL_AT = '2026-10-04T09:00:00.000Z';
const CL_CONV = { id: 'code:g-1', source: 'code', project_id: 'code:g-p', title: 'Golden chat', last_at: CL_AT, message_count: 3, tokens_in: 5, tokens_out: 9, project_name: 'project-a', hq_project_id: null };
const CL_HQ = { ...P3_HQ, claudeHub: { link() {}, forget() {}, reindex() {} } };
const clAt = (lib, tab, sub, state = {}) => ({ hq: CL_HQ, live: (L) => { L.claudeHub = { state: 'ready', role: 'writer', counts: HUB_COUNTS }; Object.assign(L.claudeLib, lib); }, state: (c) => ({ ...tabSub(tab, sub)(c), ...state }) });
add('claude.chats-rows', clAt({ projects: [], convs: [CL_CONV], convsMore: true }, 'claude', 'chats'));
add('claude.chats-hits', clAt({ convs: [CL_CONV], q: 'img', hits: [{ conversationId: 'code:g-1', messageId: 'm', title: 'Golden chat', at: CL_AT, snippet: '\u0002<img src=x>\u0003 tail' }] }, 'claude', 'chats', { clSearched: true }));
add('claude.thread', clAt({ convs: [CL_CONV], thread: { conversation: CL_CONV, hasMore: true, messages: [{ id: 'm1', role: 'tool', at: CL_AT, text: 'out' }, { id: 'm2', role: 'assistant', at: CL_AT, text: 'reply' }] } }, 'claude', 'chats', { clOpen: true }));
add('claude.projects', clAt({ projects: [{ id: 'code:g-p', name: 'project-a', path: 'C:\\placeholder\\project-a', conversations: 1, last_at: CL_AT, hq_project_id: 'project-a', link_state: 'auto' }] }, 'claude', 'projects'));
add('history.claude-activity', clAt({ stats: { days: [{ day: '2026-10-04', chats: 1, messages: 3, active_ms: 60000 }], projects: [], totals: { chats: 1, active_ms: 60000 } } }, 'history', 'trends'));
```

Run `node --test dashboard-v5/src/vals.golden.test.mjs` → the 5 new names are "not in the hashes file" (and nothing else changes — Tasks 9/10 already re-recorded); record them with `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`, then confirm with `git diff dashboard-v5/src/__golden__/vals.hashes.json` that exactly 5 lines were added and none changed (`P3_HQ` is untouched, so no existing scenario may move; if one does, attribute it before recording).

- [ ] **Step 4: CDP scenarios** — `fresh()` gains in its `L.setState({...})`: `clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: ''`. Add before the closing `};` of `SCENARIOS`:

```js
  async 'claude-library-search'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      if (!await t.waitFor(`document.querySelectorAll('[data-cl="row"]').length === 2`, 5000)) fails.push('the fake chats never listed (2 rows)');
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ clQuery: 'release' }); return L.clSearch(); })()`);
      if (!await t.waitFor(`document.querySelectorAll('[data-cl="hit"]').length === 2`, 5000)) fails.push('search hits never rendered (2)');
      const probe = await t.evaluate(`(() => { const box = document.querySelector('[data-cl="hits"]');
        return { img: box.querySelectorAll('img').length, script: box.querySelectorAll('script').length, marks: box.querySelectorAll('mark').length,
          text: box.textContent.includes('<img src=x onerror=alert(1)>'), raw: /[\\u0002\\u0003]/.test(box.textContent),
          called: hqFake.calls('claudeHub.search').map((c) => c.args[0]) }; })()`);
      if (probe.img || probe.script) fails.push('hit markup was parsed as HTML (img ' + probe.img + ', script ' + probe.script + ')');
      if (!probe.text) fails.push('the hostile snippet is not shown as literal text');
      if (probe.raw) fails.push('a U+0002/U+0003 marker reached the page');
      if (probe.marks < 2) fails.push('highlights missing (' + probe.marks + ' <mark>)');
      if (probe.called[probe.called.length - 1] !== 'release') fails.push('search was not asked for "release"');
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ clQuery: '!!! ...' }); return L.clSearch(); })()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="hits"]').textContent.includes('letters or digits')`, 3000)) fails.push('a punctuation-only query does not say why it found nothing');
    } finally { await t.evaluate(`(() => { hqFake.reset(true); WHQ.app.logic.setState({ clQuery: '', clSearched: false }); return true; })()`); }
    return fails.concat(t.errors());
  },
  async 'claude-thread-open'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`hqFake.set('claudeHub.conversation', (id, o) => o && o.beforeId
        ? { conversation: { id, title: 'Release planning' }, hasMore: false, messages: [{ id: id + ':old', role: 'user', at: '2026-10-04T08:00:00.000Z', text: 'earliest line' }] }
        : { conversation: { id, title: 'Release planning', model: 'claude-placeholder', git_branch: 'main', active_ms: 60000 }, hasMore: true,
            messages: [{ id: id + ':u1', role: 'user', at: '2026-10-04T09:00:00.000Z', text: 'Plan the release' }, { id: id + ':t1', role: 'tool', at: '2026-10-04T09:00:00.000Z', text: 'TOOL BODY' }] })`);
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      await t.waitFor(`document.querySelectorAll('[data-cl="row"]').length > 0`, 5000);
      await t.evaluate(`document.querySelector('[data-cl="row"]').click()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="thread"]')`, 5000)) fails.push('the thread view never opened');
      const s1 = await t.evaluate(`document.querySelector('[data-cl="thread"]').textContent`);
      if (s1.includes('TOOL BODY')) fails.push('a tool row is not collapsed by default');
      await t.evaluate(`[...document.querySelectorAll('[data-cl="thread"] button[aria-expanded]')][0].click()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="thread"]').textContent.includes('TOOL BODY')`, 3000)) fails.push('expanding the tool row did not show it');
      await t.evaluate(`document.querySelector('[data-cl="earlier"]').click()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="thread"]').textContent.includes('earliest line')`, 3000)) fails.push('"Load earlier" did not prepend the earlier page');
      const args = await t.evaluate(`hqFake.calls('claudeHub.conversation').map((c) => c.args[1] || {})`);
      const last = args[args.length - 1];
      if (!(last.before === '2026-10-04T09:00:00.000Z' && /:u1$/.test(last.beforeId))) fails.push('"Load earlier" did not send the (before, beforeId) cursor: ' + JSON.stringify(last));
      await t.evaluate(`[...document.querySelectorAll('[data-cl="thread"] button')].find((b) => b.textContent.trim() === 'Forget').click()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="forget-yes"]')`, 3000)) fails.push('Forget does not ask first');
      if (!/transcript on disk is untouched/.test(await t.evaluate(`document.querySelector('[aria-label="Forget this chat"]').textContent`))) fails.push('the Forget prompt does not say the file stays');
      await t.evaluate(`document.querySelector('[data-cl="forget-yes"]').click()`);
      if (!await t.waitFor(`hqFake.calls('claudeHub.forget').length === 1 && !document.querySelector('[data-cl="thread"]')`, 3000)) fails.push('Forget did not call the Hub and close the thread');
    } finally { await t.evaluate(`(() => { hqFake.reset(true); WHQ.app.logic.setState({ clOpen: false, clForgetAsk: false, clExpanded: {} }); return true; })()`); }
    return fails.concat(t.errors());
  },
```

Add both names to the header comment lists (:17-24).

- [ ] **Step 5: Run everything v5**

- Unit: the v5 suite (Global Constraints › Suites) → PASS.
- Selftest: from `dashboard-v5`, `set HQ_V5_PROFILE=h2-selftest-<random>` then `..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest` → exit 0, `errors 0, unresolved 0, failures 0`; remove `%TEMP%\` profile folder by literal path if dev-main leaves one.
- CDP: from `dashboard-v5`, start `..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --remote-debugging-port=9351` (note its PID), then `node tools/cdp-gate.mjs --port 9351 --scenario all` → every scenario PASS, including `claude-library-search`, `claude-thread-open`, `fake-parity`; stop only that PID (`Stop-Process -Id <pid>`).

- [ ] **Step 6: Commit**

```bash
git add -- dashboard-v5/src/selftest.js dashboard-v5/src/selftest-keys.test.mjs dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: v5 Claude library tests — selftest combos + storage-key guard, golden scenarios, CDP claude-library-search / claude-thread-open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: H2 gate on a real second instance (fixtures), docs, HANDOFF

Spec §11 "Real second instance". **This task never restarts or stops the owner's app** (`electron.exe . --hidden` without `--user-data-dir`, or its Hub child on `data/claude/hub.sqlite`); the controller restarts it after the plan lands, which also triggers the one-off `INDEX_VERSION` 2 rebuild of the owner's index.

**Files:**
- Modify: `README.md` (test commands), `CLAUDE.md` (one fact line), `docs/sync/HANDOFF.md` (entry on top)
- No code changes. If the gate finds a bug, fix it in the task that owns the file (new commit with that task's prefix) and re-run this gate.

**Interfaces:**
- Consumes: everything above. Produces: the gate result and the docs.

- [ ] **Step 1: Run every suite** (Global Constraints › Suites): `node --test dashboard/claude-hub/*.test.mjs`; `node --test dashboard/*.test.mjs`; the v5 suite; the v5 selftest (own `HQ_V5_PROFILE`); the CDP scenarios against a `--preload=fake` harness on port 9351 (Task 11 Step 5). All PASS / exit 0.

- [ ] **Step 2: Real second instance on fixtures** (PowerShell; port 9493 — H1 used 9492):

```powershell
$g = Join-Path $env:TEMP ('hq-h2-gate-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $g | Out-Null
node -e "import('./dashboard/claude-hub/__fixtures__/make-fixture.mjs').then(m => console.log(JSON.stringify(m.makeClaudeHome(process.argv[1]))))" $g
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'hub.sqlite'
# the linker reads a FIXTURE scan, never the owner's data/latest.json (Task 7: init() honours HQ_HUB_LATEST)
$env:HQ_HUB_LATEST  = Join-Path $g 'latest.json'
$env:HQ_HUB_SWEEP_MS = '1000'   # re-match + sweep every second, so step 5's "two sweep ticks" is ~2 s
Set-Content -LiteralPath $env:HQ_HUB_LATEST -Encoding utf8 -Value '{"projects":[{"id":"project-a","name":"project-a","path":"project-a"}],"archived_projects":[]}'
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9493'
$p.Id   # the ONLY electron pid this task may stop
```

The Hub auto-links against the fixture scan (`project-a` matches the fixture folder `C:\placeholder\project-a` by path segment; `project-b` matches nothing). The renderer's own project list still comes from the repo's scan, so the matched id is shown honestly as `project-a (not in the latest scan)`. Over CDP on port 9493 (a short `node` script using `cdp-gate.mjs`'s driver pattern, or `node dashboard-v5/tools/cdp-gate.mjs --port 9493 --scenario boot` first to confirm the page is up), check, in order:
  1. Claude tab opens on **Chats**: 3 rows (`[data-cl="row"]`), titles `Release planning`, `Fix the café bug 🚀`, `Hello project b`.
  2. Search `release` (set `clQuery`, call `clSearch()`): ≥ 1 hit, `<mark>` present, no `img`/`script` inside `[data-cl="hits"]`.
  3. Open `Release planning`: the thread shows the tool row collapsed (`[tool: Read …]`), header shows `claude-placeholder` and `(estimate)`.
  4. Append a title line to the fixture's `sess-a2.jsonl` (`titleLine({sessionId:'sess-a2', title:'Renamed by gate'})`) → within 3 s the Chats list shows `Renamed by gate` (the `changed`-on-title fix, end to end).
  5. Claude › Projects: 2 rows; project-a's chip reads `Matched by path: project-a (not in the latest scan)` (auto-link end to end), project-b's `Not linked`. Click `Unlink` on project-a → `Unlinked`; click `Link…` on project-b, pick the first WorkspaceHQ project → `Linked: <name>`. System › Machine › Reindex → toast, the card returns to "Indexed"; wait for two sweep ticks; project-a is still `Unlinked` and project-b still `Linked: <name>` (owner choices survive reindex + re-matching — Review Focus 5 end to end).
  6. History › Trends shows the "Claude activity" section with "(estimate)".
  7. Forget `Fix the café bug` → confirm prompt → row disappears; the fixture file `sess-a2.jsonl` still exists with its size unchanged.
  8. `logs/` under `$g` holds the app log; no line contains fixture message text (`Select-String -Path "$g\logs\*" -Pattern 'Plan the release','café'` → no match).
  9. The repo's `data/claude/` is untouched by the gate (it is gitignored, so `git status` proves nothing): before Step 2 record `Get-ChildItem -LiteralPath data\claude -File | Select-Object Name, Length, LastWriteTime` into `$before`; after the checks, the gate instance's own files must all be under `$g`, and no file in `data\claude` other than the owner's live `hub.sqlite`/`-wal`/`-shm` (which the owner's running app may legitimately write) changed or appeared — compare against `$before`. Also confirm the gate Hub's command line names `$g\hub.sqlite` (`Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)"`).

Stop only your PIDs: `Stop-Process -Id $p.Id` (its Hub child exits when stdin closes; if `Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)"` still lists a `node.exe … hub.mjs … $g\hub.sqlite`, stop that PID too — never a Hub whose `--db` is the repo's `data\claude\hub.sqlite`). Remove `$g` by its literal path: `Remove-Item -LiteralPath $g -Recurse -Force`.

- [ ] **Step 3: Docs**
  - `README.md` test section: add `node --test dashboard/claude-hub/*.test.mjs` (if absent) and `node dashboard-v5/tools/cdp-gate.mjs --port <port> --scenario claude-library-search,claude-thread-open` (against `dev-main.js --preload=fake`).
  - `CLAUDE.md` "Facts": extend the Claude Hub line with `; library IPC hq:claude-hub:{projects,conversations,conversation,search,stats,link,forget,reindex}; Hub env HQ_HUB_LATEST (scan file for auto-link), HQ_HUB_READER_UPGRADE_MS`.
  - IPC-CONTRACT / CONTRACT rows were written in Task 7 — re-read them against the shipped behaviour and fix any drift in this commit.
  - `docs/sync/HANDOFF.md`, new entry on top:

```markdown
## 2026-10-16 · FROM frontend (Claude Hub H2 — library + activity) · main @ <short-sha>
DONE: Claude tab › Chats (filters, FTS search with text-only highlights, paged thread, Forget) + Projects (link chips),
  project-page "Claude" (last 5 + New chat via terminal), History "Claude activity" (estimate), System Reindex.
  Hub ops stats/link + link.mjs auto-match from data/latest.json (read-only); H1 deferred items 1–10 closed.
  Commits: <list the fe:/meta: shas of Tasks 1–12>.
IN-FLIGHT: none. The owner's app still runs the H1 code until the controller restarts it (tools\rollback.ps1 v5);
  that restart rebuilds the index once (INDEX_VERSION 1 → 2).
ASKS: none.
BREAKS: none for the struct lane. data/latest.json is now READ by the Hub (never written) — a shape change to
  projects[].path / archived_projects[].path should be announced in CONTRACT.md as before. main.js lines touched: none.
```

- [ ] **Step 4: Commit**

```bash
git add -- README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md
git commit -m "meta: Claude Hub H2 done — gate on a fixture second instance, docs, HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `IPC-CONTRACT.md`/`CONTRACT.md` only if Step 3 changed them; `git add` of an unchanged file is a no-op.)

---

## Self-review (done while writing)

- **Spec coverage:** §6 `stats` (Task 2, 5), `link` (Task 2, 5), `link.mjs` auto-match (Task 4, 5); §7 `projects/conversations/conversation/search/stats/link/forget` (Task 7) + `reindex` (deviation, Task 7); §9 Chats list/filters/search/thread/Forget (Task 9), Projects chips (Task 10), project-page Claude (Task 10), History strip with estimate label (Task 10), System Reindex (Task 10); §11 `claude-library-search`, `claude-thread-open` (Task 11). Not in H2 by design: "Continue" (H3 composer), "Save to vault" (H5), claude.ai rows (H4 — the `web` source chip already filters them).
- **H1 deferred items:** 1 → Task 1; 2 → Task 3; 3 → Task 2; 4 → Task 3 (+ `lastErrorAt` in Task 5); 5 → Task 3 (`titled`) + Task 5 (emit + max wait); 6 → Task 6; 7 → Task 6; 8 → Task 2 (+ optimize call in Task 5); 9 → Task 3; 10 → Task 11.
- **Type consistency:** Hub rows stay snake_case end to end until `adapter.mjs` `hub*()`; cursor is always `{before, beforeId}` (store, IPC, live store, CDP assertion); `link` states: store accepts four, the Hub op and IPC accept `confirmed|rejected|none`; `stats` arg `tzOffsetMin` = minutes east of UTC everywhere.
- **Review Focus pins:** 1 → Task 1 tests + Task 11 `claude-thread-open` cursor assertion; 2 → Task 8 `snippetParts` tests + Task 11 `claude-library-search`; 3 → Task 2 stats test; 4 → Task 2 (23:30Z at +120) + Task 8 (offset sent); 5 → Task 4 `autoLink` test + Task 5 hub test (unlink → reindex → kept).

<!-- plan complete: 12 tasks -->
