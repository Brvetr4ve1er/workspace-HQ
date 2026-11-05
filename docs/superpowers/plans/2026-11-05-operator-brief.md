# Operator Brief (P1–P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one deterministic engine ranks the 1–3 things that need the owner now. It is shown at the top of Home, readable by any Claude session through MCP, and toasted only when a new high-severity item takes the top spot.

**Architecture:**
- A pure ESM engine (`dashboard/brief-core.mjs`, no IO) turns plain inputs into a brief.
- A CJS main module (`dashboard/brief.js`) gathers the inputs, recomputes on events, writes `data/brief.json` atomically, serves IPC, pushes changes and decides toasts.
- The renderer and MCP only *read* that result.

**Tech stack:** Electron 32 main (CJS), Node ≥ 22 ESM, vanilla dc-lite renderer, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-05-operator-design.md` (the rules table, the interfaces and the UI states live there).

## Global Constraints

- Frontend lane only: `dashboard/`, `dashboard-v5/`, `mcp/workspacehq/`; `docs/sync/*` as `meta:`. Never `collector/`, `schema/`, `spellbook/`, `run-pipeline.ps1`.
- **Contract before code:**
  - IPC-CONTRACT rows for `hq:brief:read`, `hq:brief:dismiss` and push `hq:brief`;
  - CONTRACT rows for `data/brief.json`, `data/brief-state.json` and `data/money/meta.json`.
- New main logic goes in new files with a one-line `main.js` hook.
- Every renderer call feature-detects `window.hq.brief`.
- All copy is plain and honest. Every item names its source and age.
- **Cap:** 3 items, then `more`.
- **Quiet hours:** 23:00–08:00 local, no toast.
- **Toast:** once per key per 24 h, high severity only.
- Public repo: placeholder fixtures only.
- **Gates, run sequentially with output kept:**
  - main-side suites;
  - `dashboard/money/*.test.mjs`;
  - renderer suites;
  - Electron selftest (0/0/0);
  - `cdp-gate --scenario all`;
  - every golden move attributed.

## Review Focus

1. **Missing or broken inputs.** No `latest.json`, no `pc-health.json`, a corrupt money file, the Hub not ready. Expected: the brief still computes from what exists and lists each failed source in `errors`, never throwing (Task 2 test `computeBrief tolerates every missing input`; Task 3 test `buildInputs survives absent files`).
2. **Stale data shown as current.** A scan two days old must not present its findings as now. Expected: the scan-stale item outranks, and every scan-derived item's `age` reads e.g. "scan 2 d ago" (Task 2 test `ages are stated per source`).
3. **Dismissal semantics.** A dismissed "8 uncommitted files" item must stay hidden while it's still 8, and come back as 12 (Task 2 test `a worse value is a new key`).
4. **Toast spam.** A 15-minute recompute with the same top item, or two items flapping, must toast at most once per key per 24 h, and never in quiet hours (Task 6 test `shouldToast table`).
5. **Owner-typed names in copy.** A project or account name containing `<b>` or a newline must render as text. The template only binds text nodes, so the engine cuts each name to 60 characters on one line (Task 2 test `names are one line, at most 60 chars`).

---

### Task 1: Contract rows

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (a dated section above `## Rules`)
- Modify: `docs/sync/CONTRACT.md` (table rows after `data/money/state.json`, plus a `### data/brief.json` section)

- [x] **Step 1:** Write the three IPC rows with their exact shapes, from the spec's *Interfaces* section, and the three file rows and sections from the same place.
- [x] **Step 2:** Commit: `meta: Operator Brief — IPC-CONTRACT + CONTRACT rows (contract before code)`.

### Task 2: Pure engine `dashboard/brief-core.mjs`

**Files:**
- Create: `dashboard/brief-core.mjs`
- Create: `dashboard/brief-core.test.mjs`

**Interfaces:**
- **Produces:** `computeBrief(inputs, { now: Date, dismissed: string[] }) → { v:1, generatedAt, items, more, errors }`.
- **`inputs`:**
  - `scan`: `latest.json` or `null`;
  - `liveScan`: `{state, endedAt, code}` or `null`;
  - `pc`: `pc-health.json` or `null`;
  - `money`: the Money view or `null`;
  - `moneyMeta`: `{lastExportAt}` or `null`;
  - `hub`: `{webCount, lastSyncAt}` or `null`;
  - `errors`: `[{source, error}]`.
- **Each item:** `{ key, rule, severity:'high'|'med'|'low', text, why, source, age, action }`.
  - `action` is `{kind:'go', tab, sub?, projectId?}` or `{kind:'scan'}`.
  - `key` is `rule + ':' + subject + ':' + value`, for example `dirty:p1:8` or `scan-stale:2026-11-03`.
- **Also exports:** `RULES` (the ordered rule ids) and `SEV_RANK`.

- [x] **Step 1: Write the failing tests** in `brief-core.test.mjs`, with synthetic placeholder inputs:
  - `each rule fires on its condition and only then`: one case per rule in the spec table, asserting `rule`, `severity` and `action`;
  - `ranking: severity first, then rule order`, and `cap: 3 items, rest counted in more`;
  - `a worse value is a new key`: `dirty:p1:8` dismissed is hidden, while `dirty:p1:12` shows;
  - `several matches name the worst one and add "and N more"`;
  - `ages are stated per source`: a scan 2 d old gives `age === 'scan 2 d ago'`, and scan-stale is present;
  - `computeBrief tolerates every missing input`: all `null` gives `{ items: [], errors: [] }`, plus a corrupt-shape `scan` case;
  - `names are one line, at most 60 chars`;
  - `deterministic`: the same inputs and `now` give a deep-equal result.
- [x] **Step 2:** Run `node --test dashboard/brief-core.test.mjs`. Expected: FAIL (module missing).
- [x] **Step 3:** Implement `computeBrief`. Each rule is a small function `(inputs, now) → item | null`, evaluated in `RULES` order, then stable-sorted by `SEV_RANK`, filtered by `dismissed`, and capped at 3.
- [x] **Step 4:** Run the tests. Expected: PASS.
- [x] **Step 5:** Commit: `fe: Operator Brief engine (brief-core.mjs, pure, 12 rules, cap 3)`.

### Task 3: Main module `dashboard/brief.js`, plus the inputs it needs

**Files:**
- Create: `dashboard/brief.js`
- Create: `dashboard/brief.test.mjs`
- Modify: `dashboard/money.js`
  - `exportFile` writes `money/meta.json {lastExportAt}` on success;
  - export `viewNow()` (the read path's view, with no IO error thrown).
- Modify: `dashboard/claude-hub/hub.mjs`: `health` adds `lastSyncAt` (meta `last_sync_at`) and `webCount` (count of `source='web'` conversations).
- Modify: `dashboard/main.js` (one hook line after the money hook)
- Modify: `dashboard/preload.js`: a `brief: { read, dismiss, onBrief }` group.

**Interfaces:**
- **Consumes:** `computeBrief` (Task 2).
- **Produces:** `init({ ipcMain, dataDir, money, hub, liveState, notify, getWins })` returns `{ recompute(reason) }`.
  - **Recompute triggers:**
    - IPC read;
    - `latest.json` change (the existing data-refresh/self-write hook);
    - a Money apply or import;
    - live-state `scanEnd`;
    - a 15-minute timer.
  - **Writes:** `data/brief.json` atomically (tmp + rename).
  - **Pushes:** `hq:brief` to every window when `items` or `errors` changed.

- [x] **Step 1: Write the failing tests** in `brief.test.mjs`, with a temp `dataDir`, fake `money`/`hub`/`liveState`/`notify`, and a fake `ipcMain` like `money.test.mjs`:
  - `registers exactly hq:brief:read and hq:brief:dismiss`;
  - `buildInputs survives absent files`: no `latest.json` or `pc-health.json`, and the hub rejecting, gives a brief with `errors` naming each;
  - `dismiss(key) persists to brief-state.json and hides the item; an unknown key is a no-op`;
  - `writes brief.json atomically and pushes only on change`;
  - in `money.test.mjs`: `export writes meta.json lastExportAt; a cancelled export does not`.
- [x] **Step 2:** Run `node --test dashboard/brief.test.mjs dashboard/money.test.mjs`. Expected: FAIL.
- [x] **Step 3:** Implement. Hub health is read through `hub.request('health', {}, { timeout: 5000 })`; a failure becomes an `errors` entry. Main's `trayNotify(title, body)` is passed in as `notify`.
- [x] **Step 4:** Run the tests plus `node --test dashboard/claude-hub/hub.test.mjs`. Expected: PASS. (Add one hub test: `health carries lastSyncAt and webCount`.)
- [x] **Step 5:** Commit: `fe: Operator Brief main side (brief.js, hq:brief:*, data/brief.json; money meta lastExportAt; hub health lastSyncAt/webCount)`.

### Task 4: The renderer Brief panel

**Files:**
- Create: `dashboard-v5/src/tpl/brief.tpl.js`, `src/vals/brief.js`, `src/logic/brief.js`, `src/logic/brief.test.mjs`
- Modify:
  - `src/tpl/home.tpl.js` (join the brief fragment right after the `v.home` sc-if opens, with a `<!-- v5: -->` marker);
  - `src/app.tpl.js`;
  - `src/vals/index.js`;
  - `src/app.js` (mixin, plus `brfBusy:false` in initial state);
  - `src/live/store.js` (`live.brief`, `refreshBrief`, `dismissBrief`, `onBrief` subscription in `start()`);
  - `dashboard-v5/tools/fake-preload.js` (three rows and a placeholder brief);
  - `src/selftest.js`.

**Interfaces:**
- **Consumes:** the `window.hq.brief` group (Task 3).
- **Produces:** vals keys:
  - `brfOffline`, `brfError`, `brfLoading`, `brfEmpty`, `brfEmptyText`;
  - `brfItems: [{ sevLabel, sevStyle, text, why, meta, actLabel, act, dismiss }]`;
  - `brfMore`, `brfHasMore`.

- [ ] **Step 1: Write the failing tests** in `src/logic/brief.test.mjs`, using the `logic/money.test.mjs` rig style:
  - `load states are honest and exclusive`;
  - `empty says "Nothing needs you right now · from the HH:MM brief"`;
  - `act on a go action navigates (tab, sub, project); on scan calls runScan`;
  - `dismiss sends the key once (busy guard) and releases on failure`;
  - `severity is in words, not colour only`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the panel per the spec's *UI* section, with `role="list"` and real buttons.
- [ ] **Step 4:** Run the full renderer suite. Then dump goldens before and after (`GOLDEN_DUMP`), attribute every move (expected: the `brf*` keys only, in every scenario), re-record (`UPDATE_GOLDEN=1`) and update the tpl hash with a dated comment.
- [ ] **Step 5:** Selftest states: empty, error, loading, 1, 2 and 3 items, each severity, and `more > 0`. Then run the selftest. Expected: 0/0/0.
- [ ] **Step 6:** cdp scenarios:
  - `brief-render`: Home shows the fake brief's items in order;
  - `brief-act`: the first item's button routes to its tab;
  - `brief-dismiss`: sends `hq.brief.dismiss` with that key.

  Run `--scenario all`. Expected: all pass.
- [ ] **Step 7:** Commit: `fe: Operator Brief panel heading Home (brf* vals, selftest states, 3 cdp scenarios, goldens attributed)`.

### Task 5: MCP tool `hq_brief`

**Files:**
- Modify: `mcp/workspacehq/server.mjs`, `mcp/workspacehq/server.test.mjs`, `mcp/workspacehq/README.md`

**Interfaces:**
- **Produces:** `hq_brief()` returns `{ ...brief, ageMinutes }`, or `{ error: 'no brief yet — the WorkspaceHQ app writes data/brief.json when it runs' }`.

- [ ] **Step 1: Write the failing tests:**
  - `hq_brief returns the file plus ageMinutes`;
  - `hq_brief without the file says why`.
- [ ] **Step 2:** Run `node --test mcp/workspacehq/server.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement it by reading through the existing `confined()` path helper.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `fe: MCP hq_brief — any Claude session can ask what needs the owner`.

### Task 6: P2, a change-only toast

**Files:**
- Modify: `dashboard/brief-core.mjs` (export `shouldToast`), `dashboard/brief.js`, and both test files

**Interfaces:**
- **Produces:** `shouldToast(brief, state, now) → { toast: item | null, state }`.
  - It toasts only the top item, only when it's `high`, only if its key wasn't toasted in the last 24 h, and only outside 23:00–08:00 local.
  - It prunes `toasted` entries older than 24 h.

- [ ] **Step 1: Write the failing test** `shouldToast table`:
  - a new high item toasts;
  - the same key within 24 h doesn't;
  - after 24 h it does;
  - a med item doesn't;
  - 23:30 and 07:59 don't, 08:00 does;
  - two items flapping toast once each.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, and call it from `recompute`. A toast is `notify('WorkspaceHQ · ' + sevLabel, text)`, and `toasted` persists in `brief-state.json`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `fe: Operator Brief P2 — change-only toast (high only, once per key per 24 h, quiet 23–08)`.

### Task 7: Gates, the live app, handoff

- [ ] **Step 1:** Run every gate in the Global Constraints, sequentially.
- [ ] **Step 2:** Restart the live app (`tools\rollback.ps1 v5`), then check `data/brief.json` exists and the log is clean.
- [ ] **Step 3:** Update the CLAUDE.md facts line and the HANDOFF entry (DONE / BREAKS / ASKS). Push with `git push origin main`.
