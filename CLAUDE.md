# WorkspaceHQ — session contract

Two Claude sessions work this repo in parallel. **Read `docs/sync/HANDOFF.md` before
editing anything; append an entry there when you finish a work block.**

## Lanes (directory ownership)

| Lane | Owns | Commit prefix |
|---|---|---|
| **frontend** | `dashboard/` (all of it: main.js, preload, satellites *.html/*.js), `dashboard-v5/` (the renderer — the Claude Design build), `legacy/` (quarantined renderers v2–v4 in `legacy/dashboard-vN/` — frozen, rollback only, never loaded by default), `mcp/workspacehq/` (the `workspacehq` MCP server, `.mcp.json`), `browser-bridge/` (extension) | `fe:` |
| **structure** | `collector/`, `schema/`, `run-pipeline.ps1`, `scan-prompt.md`, `spellbook/` (curated spell defs) | `struct:` |
| shared (either, announce in handoff first) | `data/` shapes, `docs/`, `.gitignore`, `tools/`, `.mcp.json` | `meta:` |

**NEXUS v3 program is active** — charter: `docs/superpowers/specs/2026-07-21-nexus-v3-program.md`.
Program invariants: contract changes additive-only (v2 rollback stays one flip away);
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
- Claude Hub: `dashboard/claude-hub/` (system Node ≥ 22.13, `node:sqlite`) indexes `~/.claude/projects` into gitignored `data/claude/hub.sqlite`; tests `node --test dashboard/claude-hub/*.test.mjs`; overrides `HQ_CLAUDE_HOME`, `HQ_CLAUDE_DB`, `HQ_HUB_NODE`; library IPC `hq:claude-hub:{projects,conversations,conversation,search,stats,link,forget,reindex}`; Hub env `HQ_HUB_LATEST` (scan file for auto-link), `HQ_HUB_READER_UPGRADE_MS`; in-app chat (H3): dashboard/claude-chat.js runs one claude -p stream-json turn per send (plan / acceptEdits only, never bypass; 1 per chat, 3 total, 10 min), IPC hq:claude-chat:{send,cancel,event}; tests/gates set HQ_CLAUDE_BIN to the fake shim (dashboard/__fixtures__/make-fake-claude.mjs); claude.ai (H4): Claude › Chats › Import claude.ai export (Hub unzips into data/claude/tmp, removed after) and extension 0.4.0 live sync via bridge GET /claude/sync-state + POST /claude/sync (dashboard/claude-bridge-routes.js); web rows are web:<uuid>; gates set HQ_CLAUDE_IMPORT_ZIP instead of the dialog.
- Claude Hub H5: Ask's 7th chip "Claude history" (`hq-oracle-include.claude`, written only while on) asks the Hub op `contextFor` through `llm-context.js` (3 000-char reserve). "Save to vault" (`dashboard/claude-vault.js`, IPC `hq:claude-vault:preview|save`) drafts with the LOCAL model and writes one note only on the owner's Save, under `VEEMO CORTEX/30_Areas/Claude/<Project>/`; Replace only for that chat's own note. Gates override the vault with `HQ_VAULT_DIR`; tests `node --test dashboard/claude-vault.test.mjs dashboard/llm-context.test.mjs`.
- Instagram / Facebook (2026-10-27): Claude › Chats › "Import Instagram / Facebook export" (kind `meta`) or the drop folder → Hub op `importMeta` (`dashboard/claude-hub/ingest-meta.mjs`: Instagram as HTML, Facebook as JSON; text entries only, read in memory via `unzip.mjs` `readEntry`). DMs = sources `instagram`/`facebook` (others' lines role `other`, sender in `tool_name`; left out of unfiltered lists, stats, harvest); everything else = document source `social`. Sensitive folders are never read (`SENSITIVE`). Ask's 8th chip "Instagram & Facebook" = `contextFor` scope `social`. Tests `node --test dashboard/claude-hub/ingest-meta.test.mjs`; fixtures `__fixtures__/make-meta-export.mjs`.
- Hotkeys already claimed: `Ctrl+Alt+X` (quick-run) · `Ctrl+Alt+G` (summon) · `Ctrl+Alt+S` / `Ctrl+Alt+Shift+S` (snip) ·
  `Ctrl+Alt+R` / `Ctrl+Alt+Shift+R` (record) · `Ctrl+Alt+L` (open Studio). `Ctrl+Alt+Space` was retired 2026-09-15.
- Renderer: v5 is the default — `dashboard-v5/` (template renderer `src/dc/runtime.js`, data
  `src/live/`). A missing/unreadable `data/.ui-version` (gitignored, owner's file) or any value
  other than `v2` | `v3` | `v4` | `v5` loads v5. Rollback = `tools\rollback.ps1 v3` (or `v2`/`v4`):
  loads `legacy/dashboard-vN/index.html` on the same preload, main logs
  `[ui] legacy renderer vN (legacy/) — rollback mode`. `HQ_UI_VERSION=vN` overrides the file for one launch.
  The rule lives in `dashboard/ui-version.js` (pure, `ui-version.test.mjs`).
- Theme system invariants: never override `position` on `#tabs`/`.timemachine`;
  new themes must remap `--active`/`--active-arrow`/`--divider`/`--mono`.
- Archive sources (H6): hub.sqlite schema 2 (`document`/`document_fts`, `prompt_use`; migrated in place — an older app refuses it); ChatGPT chats are `source:'chatgpt'` (`chatgpt:<id>`); docs ingest reads `HQ_CLAUDE_HOME` memory/CLAUDE.md/history.jsonl and `HQ_VAULT_DIR/40_Resources/Prompts`; drop folder `Documents\WorkspaceHQ Imports` (`HQ_IMPORTS_DIR`), watcher `dashboard/claude-imports.js`, answered files in `imports-seen.json` next to the db.
- Prompt library (P1): Claude › Prompts lists `HQ_VAULT_DIR/40_Resources/Prompts/*.md` (Hub `listDocuments({source:'prompt'})` rows carry `meta` + `variables`; usage = Hub `promptStats` over `prompt_use`, written from P3). Note format + no-overwrite writer: `dashboard/claude-prompt-note.js`, `dashboard/claude-prompts.js` (`writePromptNote`); Open in Obsidian = `hq:claude-prompts:open` (main finds the file by its Hub id; only `obsidian://open?vault=<basename>&file=40_Resources/Prompts/<name>` or that file; `HQ_DRY_LAUNCH=1` logs `[dry-open]`).
- Prompt harvest (P2): `dashboard/claude-hub/harvest.mjs` (pure) scores Hub op `promptCandidates` (pool = newest 20 000 user messages + 20 000 history lines; reasons, never a judgment); Hide = `tombstone(kind 'candidate')` via `hideCandidate`; Promote = `claudePrompts.promote` in `dashboard/claude-prompts.js` (masked, `writePromptNote`, name only the title's slug or a confirmed `-2…-9`). No schema change (still 2).
- Prompt runs + packs (P3): `claudePrompts.run` (main, `dashboard/claude-prompts.js`) reads the note from `HQ_VAULT_DIR/40_Resources/Prompts`, fills `{{vars}}` once (`{{project}}`/`{{cwd}}` from the picked project), then Chat = the H3 engine (`claudeChatEngine` in main.js, bound to the asking window), Terminal = `launchClaudeTerminal`, copy = clipboard + `https://claude.ai/new` / `https://chatgpt.com/` only; usage = Hub op `promptUse` (writer only; a reader says "not recorded"). Packs: `dashboard/claude-prompt-pack.js` (own CRC-32 — Electron 32's Node has no `zlib.crc32`); `HQ_PACK_IMPORT` / `HQ_PACK_EXPORT` replace the dialogs for gates; `HQ_DRY_LAUNCH=1` also stops the copy targets (`[dry-copy]`). No schema change (still 2).
- Social tab (2026-10-27): 10th destination (key 0 = Studio now; Social = 9). Subs Accounts (9 platforms of browser-bridge/social.js via the extension snapshot hq:social-read; Open <site> = hq:social-open-site, fixed URLs in dashboard/social-tab.js), Inbox (was Life › Social; deep link life/social → social/inbox), Archive (Hub op socialSummary + documents {origin, kind}), Vault = VEEMO CORTEX: hq:social-vault:list/open/save over 30_Areas/Social/ + 00_Inbox/Social *.md (save writes one new note on the owner's Save, never over one). Tests: node --test dashboard/social-tab.test.mjs dashboard-v5/src/logic/social.test.mjs.
