# WorkspaceHQ — session contract

Two Claude sessions work this repo in parallel. **Read `docs/sync/HANDOFF.md` before
editing anything; append an entry there when you finish a work block.**

## Lanes (directory ownership)

| Lane | Owns | Commit prefix |
|---|---|---|
| **frontend** | `dashboard/` (all of it: app.js, main.js, *.html, styles) | `fe:` |
| **structure** | `collector/`, `schema/`, `run-pipeline.ps1`, `scan-prompt.md` | `struct:` |
| shared (either, announce in handoff first) | `data/` shapes, `docs/`, `.gitignore` | `meta:` |

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
- Hotkeys already claimed: `Ctrl+Alt+Space` (capture) · `Ctrl+Alt+X` (cast) · `Ctrl+Alt+G` (summon).
- Theme system invariants: never override `position` on `#tabs`/`.timemachine`;
  new themes must remap `--active`/`--active-arrow`/`--divider`/`--mono`.
