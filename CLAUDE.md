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
- Claude Hub: `dashboard/claude-hub/` (system Node ≥ 22.13, `node:sqlite`) indexes `~/.claude/projects` into gitignored `data/claude/hub.sqlite`; tests `node --test dashboard/claude-hub/*.test.mjs`; overrides `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB`, `HQ_HUB_NODE`; library IPC `hq:claude-hub:{projects,conversations,conversation,search,stats,link,forget,reindex}`; Hub env `HQ_HUB_LATEST` (scan file for auto-link), `HQ_HUB_READER_UPGRADE_MS`; in-app chat (H3): dashboard/claude-chat.js runs one claude -p stream-json turn per send (plan / acceptEdits only, never bypass; 1 per chat, 3 total, 10 min), IPC hq:claude-chat:{send,cancel,event}; tests/gates set HQ_CLAUDE_BIN to the fake shim (dashboard/__fixtures__/make-fake-claude.mjs); the claude.ai import + extension live sync (H4) were removed 2026-10-28 (restore from tag `cleanup-base-2026-10-28`); web rows already indexed (web:<uuid>) still list and Continue.
- Claude Hub H5: Ask's 7th chip "Claude history" (`hq-oracle-include.claude`, written only while on) asks the Hub op `contextFor` through `llm-context.js` (3 000-char reserve). "Save to vault" (`dashboard/claude-vault.js`, IPC `hq:claude-vault:preview|save`) drafts with the LOCAL model and writes one note only on the owner's Save, under `VEEMO CORTEX/30_Areas/Claude/<Project>/`; Replace only for that chat's own note. Gates override the vault with `HQ_VAULT_DIR`; tests `node --test dashboard/claude-vault.test.mjs dashboard/llm-context.test.mjs`.
- Instagram / Facebook import (2026-10-27): removed 2026-10-28 with every importer (ChatGPT, claude.ai, drop folder) — restore from tag `cleanup-base-2026-10-28`. Rows already indexed (sources `instagram`/`facebook`, documents `social`) still render; Ask's 8th chip goes with the Social cut.
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
- Social tab (2026-10-27): 9th destination since Studio was cut 2026-10-28 (key 9). Subs Accounts (9 platforms of browser-bridge/social.js via the extension snapshot hq:social-read; Open <site> = hq:social-open-site, fixed URLs in dashboard/social-tab.js), Inbox (was Life › Social; deep link life/social → social/inbox), Archive (Hub op socialSummary + documents {origin, kind}), Vault = VEEMO CORTEX: hq:social-vault:list/open/save over 30_Areas/Social/ + 00_Inbox/Social *.md (save writes one new note on the owner's Save, never over one). Tests: node --test dashboard/social-tab.test.mjs dashboard-v5/src/logic/social.test.mjs.
