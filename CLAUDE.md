# WorkspaceHQ — session contract

Two Claude sessions work this repo in parallel. **Read `docs/sync/HANDOFF.md` before
editing anything; append an entry there when you finish a work block.**

## Lanes (directory ownership)

| Lane | Owns | Commit prefix |
|---|---|---|
| **frontend** | `dashboard/` (all of it: main.js, preload, satellites *.html/*.js), `dashboard-v5/` (the renderer — the Claude Design build), `mcp/workspacehq/` (the `workspacehq` MCP server, `.mcp.json`), `browser-bridge/` (extension) | `fe:` |
| **structure** | `collector/`, `schema/`, `run-pipeline.ps1`, `scan-prompt.md`, `spellbook/` (curated spell defs) | `struct:` |
| shared (either, announce in handoff first) | `data/` shapes, `docs/`, `.gitignore`, `tools/`, `.mcp.json` | `meta:` |

**NEXUS v3 program is active** — charter: `docs/superpowers/specs/2026-07-21-nexus-v3-program.md`.
Program invariants: contract changes additive-only (the v2–v4 renderers were removed 2026-10-28 —
restore from tag `cleanup-base-2026-10-28`; the cleanup's removed channels are listed in IPC-CONTRACT);
economy changes = struct-lane asks with CONTRACT entry + golden re-baseline; main-process
edits gated on in-flight work landing (new main-side features go in NEW files).

- Never edit the other lane's files. If you must, write the ask in HANDOFF.md instead.
- The seam between lanes is the **data contract** — `docs/sync/CONTRACT.md`. Breaking
  changes to `latest.json` / sidecar shapes are announced there BEFORE code changes.
  `collector/lib/__fixtures__` golden tests enforce it; don't "fix" a golden diff
  without a CONTRACT.md entry explaining it.

## Ritual (both sessions, every time)

1. Start: `git log --oneline -5` + read `docs/sync/HANDOFF.md` (top entry).
2. Work in your lane; commit small and often with your prefix.
3. End of a work block: append a HANDOFF.md entry (format is at the top of that file).
4. One shared working tree = one branch. Don't switch branches without a handoff entry;
   the other session's uncommitted work dies with a careless checkout.

## Facts that save you time

- Electron 32 (Chromium 128). App entry: `dashboard/main.js`. Renderer is vanilla JS,
  no framework, no build step — edit and reload.
- Restart app: `tools\rollback.ps1 v5` (writes the flag, stops only the app's own
  `electron.exe .` — never a `--user-data-dir` test instance — and relaunches it hidden;
  `-DryRun` prints the plan). By hand: stop that process, relaunch
  `node_modules\electron\dist\electron.exe . --hidden` from `dashboard/` (PowerShell, not cmd).
- Rebuild renderer data after pipeline changes: `node dashboard/build-data.mjs`.
- Test a scan without the LLM: `node collector/collector.mjs && node collector/assemble.mjs`.
- Claude Hub: `dashboard/claude-hub/` (system Node ≥ 22.13, `node:sqlite`) indexes `~/.claude/projects` into gitignored `data/claude/hub.sqlite`; tests `node --test dashboard/claude-hub/*.test.mjs`; overrides `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB`, `HQ_HUB_NODE`; library IPC `hq:claude-hub:{projects,conversations,conversation,search,stats,link,forget,reindex}`; Hub env `HQ_HUB_LATEST` (scan file for auto-link), `HQ_HUB_READER_UPGRADE_MS`; in-app chat (H3): dashboard/claude-chat.js runs one claude -p stream-json turn per send (plan / acceptEdits only, never bypass; 1 per chat, 3 total, 10 min), IPC hq:claude-chat:{send,cancel,event}; tests/gates set HQ_CLAUDE_BIN to the fake shim (dashboard/__fixtures__/make-fake-claude.mjs); claude.ai live sync (H4, restored 2026-10-29): extension 0.6.0 popup "Sync claude.ai" → bridge `GET /claude/sync-state` + `POST /claude/sync` (`dashboard/claude-bridge-routes.js`) → Hub ops `syncState`/`syncPush` (`ingest-web.mjs`, `parse-web.mjs`); rows `web:<uuid>`, tests `node --test dashboard/claude-bridge-routes.test.mjs dashboard/claude-sync-ext.test.mjs dashboard/claude-hub/ingest-web.test.mjs`. The claude.ai ZIP export import stays removed (tag `cleanup-base-2026-10-28`).
- Claude Hub H5: Ask's 7th chip "Claude history" (`hq-oracle-include.claude`, written only while on) asks the Hub op `contextFor` through `llm-context.js` (3 000-char reserve). "Save to vault" (`dashboard/claude-vault.js`, IPC `hq:claude-vault:preview|save`) drafts with the LOCAL model and writes one note only on the owner's Save, under `VEEMO CORTEX/30_Areas/Claude/<Project>/`; Replace only for that chat's own note. Gates override the vault with `HQ_VAULT_DIR`; tests `node --test dashboard/claude-vault.test.mjs dashboard/llm-context.test.mjs`.
- Instagram / Facebook import (2026-10-27): removed 2026-10-28 with every importer (ChatGPT, claude.ai, drop folder) — restore from tag `cleanup-base-2026-10-28`. Rows already indexed (sources `instagram`/`facebook`, documents `social`) still render; Ask's 8th chip was removed with the Social tab.
- Operator Brief (2026-11-05, spec `docs/superpowers/specs/2026-11-05-operator-design.md`): the app's core idea is now "say what needs the owner, where they are". `dashboard/brief-core.mjs` (PURE, no LLM: 12 rules, cap 3, keys `rule:subject:value`, `shouldToast` change-only) + `dashboard/brief.js` (gathers latest.json / pc-health.json / money view + money/meta.json / Hub health / live-state scan; writes gitignored `data/brief.json` + `brief-state.json`; IPC `hq:brief:read|dismiss`, push `hq:brief`; recompute on startup, file changes, scan end, 15 min) → the Brief panel heading Home (`src/{tpl,vals,logic}/brief*`, `brf*` keys) and MCP `hq_brief`. Toast: high only, when an item NEWLY takes the top, once per key per 24 h, never 23:00–08:00. Tests `node --test dashboard/brief-core.test.mjs dashboard/brief.test.mjs dashboard-v5/src/logic/brief.test.mjs`; cdp `brief-render,brief-act,brief-dismiss`.
- Kitchen batch 1 (2026-11-07/08; spec `docs/superpowers/specs/2026-11-07-personal-roadmap-design.md`, cook specs `docs/superpowers/plans/2026-11-07-kitchen-batch1.md`): "one assistant where the owner already is". Rulebook: `dashboard/assist-core.mjs` + `assist-audit.mjs` + `mcp/workspacehq/guard.mjs` (every MCP tool has a tier read/note/run/stage, hourly limits, one names-only `data/assistant-audit.jsonl`; untiered = refused), `dashboard/use-log.js` (`hq:use` marks into the day log), `reach.js` (Settings › Reach: which doors are open), `refresh-lock.js` (`data/.refresh.lock`, shared by Scan, the post-commit rescan and `hq_scan_trigger`; the nightly `run-pipeline.ps1` does not take it yet — struct ask). Recall: MCP `hq_recall` / `hq_chat_read` (`mcp/workspacehq/hub-read.mjs`, hub.sqlite read-only, masked on read, current folder by default); `claude-hub/index-guard.mjs` refuses every reset while index-only chats exist. Brief: six senses (`brief-senses.mjs`, `brief-sources.js`), `overflow`, a 72 h `standing` list (secrets exempt), and `brief-project.mjs` = the ONLY text allowed off the main window (rule wording, counts, opaque refs; no names, ids, paths, amounts) → `tray-brief.js` tray rows and the Bridge badge. Sessions board: `sessions-core.mjs` + `sessions-board.js` (Claude › Sessions, Home strip), `claude-resume.js` always `--permission-mode default`, MCP `hq_sessions`. Bridge 0.7.0: pair once (`bridge-pair.js`, `data/.bridge-pairing.json`; once paired the token is live on every route), `browser-bridge/endpoint-guard.js` on every token-carrying call, `/assist/*` routes (`assist-bridge-routes.js`), Find the best version + Save one file per click into `Downloads/WorkspaceHQ/grabs/<host>/` (no grab-all; `BLOCKED_SITES` empty). Money: start card (`money/start.mjs`) + quick spend line (`money/quicklog.mjs`, intents `start`, `log-line`; year rule kept in parity with `cast.js`). Client delivery: `delivery-core.mjs` + `delivery.js` (`data/delivery.json`; scope only from an owner-picked checklist / SCOPE.md / in-app list; the link is the newest READY deploy of the production branch), MCP `hq_delivery`. Cosmos step one: `dashboard/cosmos/*.mjs` (pure: infer, types, sticky ids, image sizes; tests `node --test dashboard/cosmos/*.test.mjs`); the space itself (key 0) is batch 2.
- Cosmos, key 0 (batch 2, 2026-11-09; plan `docs/superpowers/plans/2026-11-08-cosmos-batch2.md`): the owner's picture library as a Feed (search grammar, sort/group/density, favourites and hidden, lightbox, index overlay, import report). Main side: `dashboard/cosmos.js` is the ONLY writer of `data/cosmos` (engine in `dashboard/cosmos/*.mjs`, native thumbnails `cosmos-electron.js` + `cosmos/decode.mjs`, real-Electron check `dashboard/cosmos-native.check.js`, see README gates); IPC `hq:cosmos:*` (nine invoke channels + the index-progress push; `pathForFile` is a preload-only helper). Renderer: `src/live/cosmos-slice.mjs` (reads once per arrival, never at boot), `src/logic/cosmos*.mjs` (one search grammar `cosmos-search.mjs` shared with MCP `hq_cosmos_search`), `src/vals/cosmos.js`, `src/tpl/cosmos*.tpl.js`; the Feed pages at `FEED_PAGE = 250` (`cosmos-view.mjs`; a 1,000-card page missed the render budget unpaged: first render 1.6 s). Gates: the invented library is `dashboard-v5/tools/cosmos-fixture.mjs` (never owner data; its `fakeCosmos` is PASTED into `fake-preload.js` between BEGIN/END markers by `node tools/cosmos-fixture-paste.mjs --write`, a test fails on drift; sessionStorage `hqFake:cosmosCount` sets the size, default 40), selftest states `src/selftest-cosmos.mjs`, cdp scenarios `tools/cdp-cosmos.mjs` (`cosmos-*`, incl. the named render budget). A video original cannot be a data: URI (page CSP `media-src 'self' file:`).
- Hotkeys already claimed: `Ctrl+Alt+X` (quick-run). Retired: `Ctrl+Alt+Space` 2026-09-15; `Ctrl+Alt+G` (summon) and
  Studio's `Ctrl+Alt+S` / `Ctrl+Alt+Shift+S` / `Ctrl+Alt+R` / `Ctrl+Alt+Shift+R` / `Ctrl+Alt+L` 2026-10-28.
- Renderer: v5 is the only one — `dashboard-v5/` (template renderer `src/dc/runtime.js`, data
  `src/live/`). The v2–v4 renderers (`legacy/`) were removed 2026-10-28: a `data/.ui-version` or
  `HQ_UI_VERSION` still naming one loads v5 and logs `ui-legacy-removed`; `tools\rollback.ps1 v3` refuses
  with the restore command (`git checkout cleanup-base-2026-10-28 -- legacy …`).
  The rule lives in `dashboard/ui-version.js` (pure, `ui-version.test.mjs`).
- Theme system invariants: never override `position` on `#tabs`/`.timemachine`;
  new themes must remap `--active`/`--active-arrow`/`--divider`/`--mono`.
- Archive sources (H6): hub.sqlite schema 2 (`document`/`document_fts`, `prompt_use`; migrated in place — an older app refuses it; the tables stay though their writers are gone); docs ingest reads `HQ_CLAUDE_HOME` memory/CLAUDE.md/history.jsonl and `HQ_VAULT_DIR/40_Resources/Prompts` (prompt notes stay searchable in Chats; `dashboard/claude-prompt-note.js` parses them for the Hub store). The ChatGPT import and the drop folder were removed 2026-10-28.
- Prompt library, harvest, runs and packs (P1–P3): removed 2026-10-28 (Claude › Prompts, harvest.mjs, claude-prompts.js, claude-prompt-pack.js, Hub ops promptUse/promptStats/promptCandidates/hideCandidate) — restore from tag `cleanup-base-2026-10-28`. store.mjs keeps its harvestPool / prompt_use / candidate-tombstone methods (dead, still tested) so the schema stays 2.
- Social tab: removed 2026-10-28 (Accounts / Inbox / Archive / Vault, dashboard/social-tab.js, hq:social-read / -vault:* / -open-site / -cancel, Hub op socialSummary, Ask's Instagram & Facebook chip, MCP hq_social_status/feed/mentions/metrics) — restore from tag `cleanup-base-2026-10-28`. KEPT: the outbox approval gate — dashboard/social-bridge.js (stage → claim → the owner approves in the extension popup → publish; cancelStaged), browser-bridge/social.js (its send half publishes; its read-only scrape still writes data/social/*.json, which nothing in the app reads now), MCP hq_social_post/reply/outbox/cancel. Tests: node --test dashboard/social-cancel.test.mjs dashboard/social-claim.test.mjs dashboard/popup-approval.test.mjs.
