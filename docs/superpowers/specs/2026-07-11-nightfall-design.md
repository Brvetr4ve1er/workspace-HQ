# NIGHTFALL — FromSoftware art direction for WorkspaceHQ + VEEMO CORTEX

## Context

The user wants the "smarter layer" (WorkspaceHQ app + Obsidian vault) themed as a
merged FromSoftware world: Bloodborne's gothic Yharnam × Elden Ring's ethereal Lands
Between × Nightreign's cycle/classes. Depth: **full merge** (visuals + renames + new
mechanics). Phasing: **canon-first** (approved via brainstorming Q&A).

Constraints discovered in exploration:
- Pipeline hardcodes `30_Areas/Workspace Status` and sidecar paths → **no vault folder
  renames**; the direction overlays via MOCs, aliases, CSS, templates.
- Spellbook taxonomy already fantasy-coded (schools/rarities/kinds/familiars) → the
  reframe is a *remapping*, not a rebuild.
- Theme system has authoring rails (`styles.css` THEME SYSTEM block): never override
  sticky on `#tabs`/`.timemachine`; opaque card fills over atmosphere; remap
  `--active`/`--active-arrow`/`--divider`/`--mono`; per-theme tab metric compensation.
- Two-lane repo (CLAUDE.md): frontend owns `dashboard/`; `collector/render.mjs`
  (Quest Board headings) and `gamification.config.json` are **structure lane** → any
  ask goes through `docs/sync/HANDOFF.md` + `CONTRACT.md`.
- XP/quest/spellcraft economy is balanced and settled — new mechanics must NOT add a
  second currency into that ledger.

## Design

### P0 — The Canon (`docs/CANON.md`, `meta:` commit)

One vocabulary map both lanes + vault share. Core mappings (display-level):

| Today | Canon | Source |
|---|---|---|
| Quests (red/orange/yellow) | **Hunts** (Night / Blood / Ember) | BB |
| Side-quests / ideas feed | **Whispers** | — |
| Brain-dump capture | **Insight** (`Ctrl+Alt+Space` = "gain Insight") | BB stat |
| Knowledge XP | **Insight points** | BB |
| XP | **Runes** | ER |
| health_index | **Vitality** | — |
| Streak 🔥 | **Ember** | — |
| Spellbook umbrella | **Grimoire** | existing |
| kind: castable | **Ash of War** (interchangeable skill) | ER |
| kind: channeled | **Gadget** (triggered device, terminal) | BB |
| kind: tome | **Relic Tome** | NR |
| kind: chain | **Ultimate** (multi-stage) | NR |
| MCP familiars | **Spirit Summons** | ER |
| Organic-UI shards | **Messengers** (little helpers that surface anywhere) | BB |
| Summon palette (`Ctrl+Alt+G`) | **Beckoning Bell** | BB |
| Isometric MAP tab | **Lands Between** | ER |
| BASE tab | **Roundtable Hold** | ER |
| Achievements (in STATS) | **Memorials** | — |
| Graveyard (archived) | stays **Graveyard** | fits |
| STAGE SELECT scrubber | **Memory of Grace** | ER |
| Daily note (vault) | **Site of Grace** | ER |
| Project folders (vault 20_Projects) | **Legacy Dungeons** (MOC naming only) | ER |
| Error/blocked states | sterile **ACCESS DENIED** voice | user's doc |

Seven note/project **Classes** (from user's doc): Hunter (action/checklists),
Wylder (ideation), Guardian (security/integrity), Duchess (MOCs/hubs), Recluse
(research/lore), Heavy Knight (large projects), Knight of Ides (experiments).
Deterministic auto-classify rule for app project cards (e.g. tests+CI → Guardian,
dormant+research-y → Recluse); manual `class:` frontmatter wins in vault.

**Key decision — lexicon rides the theme:** canon terms are *theme-scoped*, not
global. Each app theme gets a `lexicon` (label map); arcade keeps QUESTS/BASE/etc.
(zero regression), Nightfall speaks full canon. Default lexicon = current labels.

### P1 — Nightfall app theme (5th theme, frontend)

- Palette: charcoal-umber base `#0e0b09`/`#171210`; bone/parchment text `#d8cfba`;
  blood accent `#a62c2b`; lantern amber `--active: #c78b3c`; ethereal grace-gold
  `#d4af6a`; spectral blue-grey `#7c93a8`; moon-pale `#b7c4b0`. Status semantics kept
  recognizable: ok=grace-gold, warn=ember-orange, crit=blood-red.
- Fonts: display `Cinzel` (gothic caps), body `IM Fell English`/serif fallback,
  `--mono: Space Mono` (rail). Add to the Google Fonts `<link>` in `index.html`.
- Atmosphere (accent budget: ONE glow): slow-drifting fog gradient via `body::before`
  (z:0, reduced-motion guarded), vignette, okami-style grain reuse. Opaque card
  gradient fill per rail. Sticky surfaces get semi-opaque bg + blur like okami.
- Tab/heading metric compensation for Cinzel per rail. Theme picker entry:
  `NIGHTFALL · yharnam gothic · lands between`.

### P2 — Vault skin (frontend lane; vault files)

- `.obsidian/snippets/nightfall.css`: dark gothic workspace, gold-leaf headings,
  ethereal graph-view accents, styled callouts: `[!grace]` (gold), `[!hunt]` (blood),
  `[!lore]` (parchment), `[!denied]` (sterile mono red).
- Templates in `90_Meta/templates/`: **Site of Grace (daily)**, **Hunt**, **Lore
  Entry**, **Legacy Dungeon (project)** — class frontmatter + Status Effects block
  (energy/mood), Keepsake-style starting sections.
- `Roundtable Hold.md` hub MOC (vault root): links Lands Between (10_Atlas), Legacy
  Dungeons (20_Projects), Sites of Grace (dailies), Quest Board, Workspace Status.
  **No folder renames** — aliases/MOC naming only.
- Restyle the existing `workspacehq` Obsidian plugin HUD labels to canon.

### P3 — App renames via lexicon (frontend)

- `LEX` map in `app.js` + tiny `t(key)` helper; all surface labels route through it
  (tabs, section headers, drawer, statusbar, tray, summon placeholder, mini-HUD).
  Theme switch swaps lexicon live. `main.js` tray/notifications read the saved theme's
  lexicon from a small shared map (duplicated constant — main has no DOM).
- **Structure-lane ask (HANDOFF)**: optional canon headings in `render.mjs` Quest
  Board + level-title canon variants in `gamification.config.json`. Not blocking:
  frontend display-remaps titles meanwhile.

### P4 — Mechanics (each opt-in, gentle-by-design for the ND brain)

1. **Night's Tide** — ambient time-awareness, NOT deadline pressure: a subtle tide
   gradient rises in aged hunt cards (maps `age_days`), and past a configurable hour
   the app shifts to night palette with the top hunt softly lit. No countdowns, no
   penalties. Pure frontend (clock + existing `age_days`).
2. **Scadutree Fragments** — parallel *cosmetic* progression, OFF the XP ledger:
   derived at render time from scan history (each day with ≥1 completion = 1
   fragment; thresholds = Blessing levels). Blessings unlock cosmetics (shard skins,
   boot splash variants, stat-card frames). No new pipeline state, no economy
   collision.
3. **Classes everywhere** — project cards + drawer show auto-classified class sigils;
   vault templates carry `class:` frontmatter (P2).
4. **NG+ (deferred design)** — annual review screen in STATS reading full scan
   history; generator via weekly-narrator pattern is a structure-lane follow-up.

## Files touched (frontend lane unless noted)

- `docs/CANON.md` (new), `docs/ORGANIC-UI-V2.md` (Messengers note), `docs/sync/HANDOFF.md`
- `dashboard/index.html` (fonts, theme option), `dashboard/styles.css` (Nightfall block),
  `dashboard/app.js` (lexicon, tide, fragments, class sigils), `dashboard/main.js`
  (tray lexicon, summon placeholder), `dashboard/organic/shard.html` (Messenger skin, stretch)
- Vault: `.obsidian/snippets/nightfall.css`, `90_Meta/templates/*` (4 new),
  `Roundtable Hold.md`, `.obsidian/plugins/workspacehq/main.js` labels
- Structure-lane asks only: `collector/render.mjs`, `schema/gamification.config.json`

## Verification

- All 5 themes × BASE/QUESTS/GRIMOIRE/STATS/MAP at 1180×820 via chrome-devtools
  against the dev server: sticky intact, cards opaque, active-tab visible, dates mono.
- Lexicon regression: arcade renders byte-identical labels (screenshot diff by eye).
- Night's Tide: mock clock in console, verify tide gradient + night shift.
- Fragments: derive from real 37-scan history, assert count matches days-with-completions.
- Vault: open Obsidian, verify snippet + templates + Roundtable Hold render.
- Restart Electron app; per-surface eyeball; commit per phase (`fe:`/`meta:` prefixes);
  HANDOFF.md entry at end.

## Execution order

P0 canon → P1 Nightfall theme → P2 vault skin → P3 lexicon renames → P4 mechanics
(tide → fragments → classes; NG+ deferred). Spec doc per brainstorming skill written
to `docs/superpowers/specs/2026-07-11-nightfall-design.md` immediately after approval.
