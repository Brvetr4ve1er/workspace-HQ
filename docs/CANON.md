# THE CANON — Nightfall vocabulary & art direction

The merged FromSoftware world for WorkspaceHQ + VEEMO CORTEX: **Bloodborne**'s gothic
Yharnam (the hunt, gadgets, insight) × **Elden Ring**'s ethereal Lands Between (grace,
spirits, runes) × **Nightreign**'s cycle and classes. This doc is the single source of
truth for naming — both session lanes and the vault use these terms verbatim.

**Scope rule:** canon terms are *display-level* and ride the **Nightfall theme's
lexicon**. Data-contract field names (`quests`, `health_index`, `xp`, …) NEVER change.
Arcade/okami/numidea/ops keep their existing labels.

## Vocabulary

| Internal (contract) | Canon (Nightfall display) | Source |
|---|---|---|
| Quests | **Hunts** | BB |
| tier red / orange / yellow | **Night Hunt / Blood Hunt / Ember Hunt** | BB |
| Side-quests (ideas & risks) | **Whispers** | — |
| Brain-dump capture (`Ctrl+Alt+Space`) | **Insight** ("a moment of Insight") | BB |
| Knowledge XP | **Insight points** | BB |
| XP | **Runes** | ER |
| health_index | **Vitality** | — |
| Streak 🔥 | **Ember** | — |
| Spellbook | **Grimoire** | existing |
| spell kind `castable` | **Ash of War** — interchangeable skill | ER |
| spell kind `channeled` | **Gadget** — a device you trigger, runs in a terminal | BB |
| spell kind `tome` | **Relic Tome** | NR |
| spell kind `chain` | **Ultimate** — multi-stage workflow | NR |
| MCP familiars | **Spirit Summons** — bound allies that assist the hunt | ER |
| Organic-UI shards | **Messengers** — little helpers surfacing anywhere on the desktop | BB |
| Summon palette (`Ctrl+Alt+G`) | **Beckoning Bell** | BB |
| BASE tab | **Roundtable Hold** | ER |
| QUESTS tab | **HUNTS** | BB |
| SPELLBOOK tab | **GRIMOIRE** | — |
| STATS tab | **LEGACY** | — |
| Achievements section | **Memorials** | — |
| MAP tab | **LANDS BETWEEN** | ER |
| STAGE SELECT scrubber | **Memory of Grace** | ER |
| Daily note (vault) | **Site of Grace** | ER |
| 20_Projects (vault, MOC naming only) | **Legacy Dungeons** | ER |
| Archived projects | **Graveyard** (unchanged — already canon) | — |
| Focus / One-Thing mode | **The Hunt Focus** ("face one beast at a time") | BB |
| Dev server running | **channeling** | BB |
| Error / blocked states | sterile **ACCESS DENIED** security voice | user doc |

## The Seven Classes

Assigned to notes via `class:` frontmatter (vault) and auto-derived for app project
cards (deterministic; manual frontmatter wins).

| Class | For | App auto-classify rule (first match) |
|---|---|---|
| **Guardian** | security / integrity / backups | has_ci && has_tests, or security-heavy |
| **Heavy Knight** | large intricate projects | loc > 20k or files > 400 |
| **Hunter** | active task-driven work | activity == active |
| **Wylder** | ideation / creative exploration | age < 30d && completion < 40% |
| **Recluse** | research / archives / lore | dormant && has_readme |
| **Knight of Ides** | experiments / hidden features | name or path hints experiment/lab/poc |
| **Duchess** | MOCs / hubs / orchestration | fallback for meta/organizational |

## Voice (three registers)

1. **The Hunt** (gothic, terse) — quests, risks, errors that demand action:
   "A beast stirs in almaflowclim." / "The night grows long. 4 hunts remain."
2. **Grace** (ethereal, calm) — daily notes, progress, rest states:
   "You rest at the Site of Grace. The Ember holds at 3."
3. **ACCESS DENIED** (sterile, technical-friction) — blocked/denied/failed states:
   "ACCESS DENIED — credential perimeter breached. 24 secrets exposed."

## Shared palette tokens (app theme ⇄ vault CSS must match)

| Token | Hex | Role |
|---|---|---|
| `--nf-void` | `#0e0b09` | base background (charcoal umber) |
| `--nf-stone` | `#171210` | raised surface |
| `--nf-card` | `#1e1814` | card |
| `--nf-bone` | `#d8cfba` | primary text (parchment) |
| `--nf-ash` | `#8f8577` | muted text |
| `--nf-blood` | `#a62c2b` | danger / Night Hunts |
| `--nf-lantern` | `#c78b3c` | active / interactive (the ONE glow) |
| `--nf-grace` | `#d4af6a` | success / gold-leaf accents |
| `--nf-spectral` | `#7c93a8` | info / ethereal blue-grey |
| `--nf-moon` | `#b7c4b0` | calm highlights |

Fonts: display **Cinzel** · body **IM Fell English** (serif fallback) · mono **Space Mono**.

## Mechanics canon (P4)

- **Night's Tide** — ambient time-awareness, never pressure: aged hunts show a rising
  tide gradient; past the night hour the palette deepens and the top hunt is lantern-lit.
  No countdowns, no penalties.
- **Scadutree Fragments** — cosmetic progression OFF the XP ledger: 1 fragment per
  calendar day with ≥1 completed hunt (derived from scan history at render). Thresholds
  grant **Blessings** that unlock cosmetics only (Messenger skins, stat-card frames,
  boot variants).
- **New Game +** — annual/milestone review carrying over "relics" (deferred design).

## Structure-lane notes

These surfaces render canon text only if the structure session opts in (see HANDOFF):
`collector/render.mjs` (Quest Board headings — could say "Hunts"), level titles in
`schema/gamification.config.json` (frontend display-remaps meanwhile).
