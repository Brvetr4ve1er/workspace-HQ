# Organic UI v2 — subproject charter (frontend lane)

WorkspaceHQ grows interface anywhere on the desktop. v1 shipped the shard engine
(frameless always-on-top windows, built-in widgets, Claude-conjured customs,
`Ctrl+Alt+G` summon palette, persistence). v2 makes it a *system*.

**Home:** `dashboard/organic/` · **Owner:** frontend session · **Seam:** main.js IPC +
data contract (`docs/sync/CONTRACT.md`) stay stable; structure lane untouched.

## Pillars

- [x] **P1 — Widget library.** Every successful conjure is saved to
  `data/shard-library.json` (prompt, html, timestamps). Summoning a matching
  prompt re-spawns instantly from cache. `lib` in the palette opens a library
  browser shard (summon / delete per entry). Conjured shards get a ↻ regen
  button to rewrite themselves.
- [ ] **P2 — Context-aware shards.** Sense the focused app (foreground-window
  polling in main) and dock shards beside it; per-app shard profiles (e.g. the
  quest card auto-appears next to VS Code, the timer beside a game).
- [ ] **P3 — Live-data shards.** Conjured widgets can be generated WITH live scan
  data baked into the prompt ("burndown of my red quests") and/or a read-only
  `hq.data()` snapshot API in the shard sandbox. Refresh on scan.
- [ ] **P4 — Shard manager.** A dashboard surface listing live shards + library,
  with respawn / kill-all / arrange; SYS menu entry.
- [ ] **P5 — Shard theming.** Shards follow the active dashboard theme
  (arcade/okami/numidea/ops) instead of always-arcade.

## Rules

- Shards are garnish: they must never block or crash the core loop (guarded spawns).
- Conjured HTML stays sandboxed: node-free window, CSP inline-only, navigation denied.
- Runtime state (`data/shards.json`, `data/shard-library.json`) is gitignored.
