# WorkspaceHQ — session contract

Two Claude sessions work this repo in parallel. **Read `docs/sync/HANDOFF.md` before
editing anything; append an entry there when you finish a work block.**

## Lanes (directory ownership)

| Lane | Owns | Commit prefix |
|---|---|---|
| **frontend** | `dashboard/` (all of it: app.js, main.js, *.html, styles), `dashboard-v3/` (NEXUS v3, live until the v5 flip), `dashboard-v4/` (shelved), `dashboard-v5/` (the Claude Design build), `browser-bridge/` (extension) | `fe:` |
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
- Restart app: kill `electron.exe` matching `*workspace hq*`, relaunch
  `node_modules\electron\dist\electron.exe .` from `dashboard/` (PowerShell, not cmd).
- Rebuild renderer data after pipeline changes: `node dashboard/build-data.mjs`.
- Test a scan without the LLM: `node collector/collector.mjs && node collector/assemble.mjs`.
- Hotkeys already claimed: `Ctrl+Alt+X` (quick-run) · `Ctrl+Alt+G` (summon) · `Ctrl+Alt+S` / `Ctrl+Alt+Shift+S` (snip) ·
  `Ctrl+Alt+R` / `Ctrl+Alt+Shift+R` (record) · `Ctrl+Alt+L` (open Studio). `Ctrl+Alt+Space` was retired 2026-09-15.
- Renderer switch: `data/.ui-version` (gitignored) = `v2` | `v3` | `v4` | `v5`; `HQ_UI_VERSION=v5` overrides it
  for one launch. v5 = `dashboard-v5/` (template renderer `src/dc/runtime.js`, data `src/live/`).
- Theme system invariants: never override `position` on `#tabs`/`.timemachine`;
  new themes must remap `--active`/`--active-arrow`/`--divider`/`--mono`.
