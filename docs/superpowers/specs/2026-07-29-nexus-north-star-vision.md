# NEXUS — North Star Vision (2026-07-29)

> Upgrades the program charter (`docs/superpowers/plans/2026-07-21-nexus-v3-program.md`
> and `2026-07-26-nexus-alive-program.md`) with the Warden's expanded intent. Not a
> plan — the destination every epic serves. Build cadence stays **one epic → one
> plan → one fleet**, additive + flag-gated + selftest-green, v2 rollback one flip away.

## The dream, in the Warden's words

> "I want WorkspaceHQ to become my modular, extensible, mountable **widget master and
> desktop customizer**; my devices' **armory crate** and resource/health management; my
> **AI harness** for all my agents; linked with my **browser and Obsidian vault** — the
> perfect interconnected inner world. My own **life-OS video game system**, and my own
> **JARVIS**."

Mood board: Solo Leveling "System 2.0" HUD · Study-Like-A-Video-Game pixel RPG · cozy
Focus-Levels mascot · rxyhn/eww desktop ricing.

## The six pillars (state → gap)

| Pillar | State | What exists | The frontier |
|---|---|---|---|
| **LIFE-OS** — levels · quests · bosses · streaks · shop | 🟢 shipping | Full RPG canon (levels/XP/hunts/vitality/ember) | Bosses + skill-tree (Epic I), potion-shop (economy batch) |
| **JARVIS** — proactive assistant + voice | 🟡 partial | **Oracle** (shipped 2026-07-29), notify surface | Proactive Familiar (Epic J), **voice I/O (new)** |
| **AGENT HARNESS** — all agents in one console | 🟡 planned | Summoning Circle, session registry | MCP "The Binding" (M3), multi-agent command center |
| **WIDGET ENGINE** — mountable desktop widgets + customizer | 🟡 partial | Organic-UI **shard** system (summonable widget windows) | **Desktop-wide mounting + customizer** (eww/AGS-style) |
| **ARMOURY** — hardware + resource control | 🔵 new | Med-Bay (PC-health monitoring) | **ROG hardware control** (RGB/fans/perf modes) |
| **INNER-WORLD LINKS** — browser ⇄ Obsidian | 🟡 partial | Browser bridge (live), Observatory (multi-vault), quest-board sync | Deepen the two-way links |

## Aesthetic north star — the "System" HUD

The Solo Leveling "System" look (deep violet-on-black, hexagon-tessellated panels, a
glowing neon frame like a summoned System window, HP bars + stat radials in that idiom)
becomes the app's signature. **Debut: War-Room-only skin** (`warroom.css`) — decided
2026-07-29 to prove it live before promoting to a full **"SYSTEM" theme** (8th theme,
whole-app). Plain-copy contract still holds for nexus/daylight; the System look is a
*theme*, opt-in, never forced on the professional registers.

## New epics this vision adds to the roadmap (each its own future plan)

- **Epic K · Voice (JARVIS)** — TTS/STT layer so the System speaks + listens. Renderer
  Web Speech API first (no main change); local model later.
- **Epic L · Widget Engine** — evolve shards into desktop-wide mountable widgets + a
  customizer surface (the eww/AGS dream). Main-process + window-management asks.
- **Epic M · Armoury** — a hardware-control realm fusing Med-Bay health with ROG control
  (RGB/fans/perf). Hardware-specific, vendor/elevated-access asks — heaviest, latest.
- **"SYSTEM" theme** — promote the War-Room skin to a full theme once proven.

These slot **after** the current Phase 1 (Oracle ✅ → War Room → Foresight); nothing here
reorders the additive, reversible build discipline.
