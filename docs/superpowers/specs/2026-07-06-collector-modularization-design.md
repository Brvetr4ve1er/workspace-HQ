---
title: Collector Modularization + Safety Net (Architecture Phase A)
date: 2026-07-06
status: approved-design
spine: behavior-preserving extraction, zero new dependencies, safe→risky sequencing
---

# Collector Modularization + Safety Net (Architecture Phase A)

## Context — why this change

WorkspaceHQ works, but three files have grown into monoliths that are hard to
navigate, hard to reason about, and — critically — untested:

| File | LOC | Shape |
|---|---|---|
| `dashboard/app.js` | 1502 | one giant renderer IIFE |
| `dashboard/styles.css` | 1112 | single stylesheet |
| `dashboard/main.js` | 926 | Electron main, sectioned functions |
| `collector/assemble.mjs` | 719 | pipeline script: imperative sections mutating shared state |

A manual review of the recent spellcraft settlement work found real correctness
bugs by hand precisely because the logic lives in an untested top-level block. The
deterministic pipeline is the *easiest* part of the system to test and the *safest*
to refactor (pure functions), yet it has zero coverage.

This spec covers **only the collector pipeline** (`assemble.mjs`). The renderer and
Electron main are deferred to later sub-projects (Phase B, Phase C). We ride the
structural asymmetry: start where refactoring is safe (pure ES-module functions),
establish the pattern and a safety net, and leave the risky UI monolith for after
the net exists.

## Vision (one line)

`assemble.mjs` becomes a thin I/O orchestrator that calls small, pure, independently
testable engines under `collector/lib/` — behavior byte-for-byte unchanged.

## Principle (the spine)

**Behavior-preserving extraction, zero new dependencies, safe→risky sequencing.**
Every slice must leave the pipeline's output identical to before (verified by
diffing a real scan's produced JSON). No slice mixes "move code" with "change
behavior." No new npm dependency is introduced.

---

## Design

### 1. Target module map (`collector/lib/`)

Each module has one purpose, takes explicit inputs, returns a value, and performs
**zero file I/O** — the orchestrator owns all reads and writes. This is what makes
each unit understandable and testable in isolation.

| Module | Extracted from `assemble.mjs` | Interface (inputs → output) |
|---|---|---|
| `spellcraft.mjs` | settlement block (§376–470) | `settle({ catalog, telemetry, config, prev, today }) → { spellcraft, spellXp, events, spellOfDay }` |
| `git-risk.mjs` | `gitRisk(g)` | `gitRisk(gitFacts) → riskLevel` (pure scalar) |
| `projects.mjs` | `buildProject`, `deterministicCompletion` | `buildProject(raw, enrich, prev, config) → project` |
| `quests.mjs` | quest carry / auto-close / derive (`autoSatisfied`, `questCtx`, `addQuest`, `buildSideQuests`) | `deriveQuests({ rawProjects, prevQuests, config }) → { quests, sideQuests }` |
| `gamification.mjs` | XP / level / streak / achievements rollup | `levelFor(xp)`, `rollup({ projects, quests, spellXp, prev, config }) → { account, achievements }` |
| `trends.mjs` | `appendTrend` + trend assembly | `appendTrend(arr, point, key)`, `buildTrends({ prev, today, metrics }) → trends` |

After all extractions, `assemble.mjs` reduces to: read inputs (`raw-metrics.json`,
`gamification.config.json`, previous scan, optional enrichment/spellbook/telemetry)
→ call the engines in dependency order → assemble and write `doc`.

### 2. Test harness

- **Framework: Node's built-in `node:test` + `node:assert`.** Zero new
  dependencies — honors the codebase's stated zero-dep ethos. Run via
  `node --test collector/`.
- **Location:** colocated as `collector/lib/<name>.test.mjs`.
- **Style: characterization tests.** Capture real fixture inputs from an actual
  scan (a `collector/lib/__fixtures__/` folder holds trimmed real `raw-metrics`,
  config, prev-scan, spellbook, and telemetry samples), feed them to the extracted
  module, and assert on the current output. A refactor that changes behavior turns a
  test red. These tests lock *current* behavior, bugs included (see §4).

### 3. Data flow (unchanged)

```
raw-metrics.json ─┐
gamification.config ─┤
previous scan ───────┼─→ assemble.mjs (orchestrator)
enrichment.json ─────┤        │
spellbook.json ──────┤        ├─ projects.mjs   → projects[]
spell-telemetry.json ┘        ├─ quests.mjs     → quests[], sideQuests[]
                              ├─ spellcraft.mjs → spellcraft, spellXp, events
                              ├─ gamification.mjs → account, achievements
                              ├─ trends.mjs     → trends
                              └─→ doc → Workspace Status <date>.json + data/latest.json
```

---

## Sequencing (dependency-ordered slices)

Each slice: **extract → capture fixture → characterization tests green → verify
end-to-end scan output is byte-identical → commit.** No slice touches the next.

1. **`spellcraft.mjs`** — self-contained (~110 lines), highest-value proof of the
   pattern (it's where the known bugs live). Establishes `__fixtures__/` and the
   `node --test` wiring.
2. **`git-risk.mjs`** — trivial pure function; proves the mechanical pattern is cheap.
3. **`projects.mjs`** — `buildProject` + `deterministicCompletion`.
4. **`quests.mjs`** — the largest engine; done after the pattern is proven on smaller
   modules.
5. **`gamification.mjs`** — consumes quest + spellcraft outputs.
6. **`trends.mjs`** — purely mechanical, last.

The pipeline runs identically after every slice, so it is never broken between
commits.

## 4. Bug policy — refactor only, bugs deferred

This spec is **strictly structural**. The bugs found in review are **logged here and
deferred** to a separate later sub-project. Characterization tests deliberately lock
*current* (buggy) behavior so extraction stays provably behavior-preserving.

### Deferred bug log (do NOT fix in Phase A)

1. **Daily cast-XP cap is per-settlement-window, not per calendar day**
   (`assemble.mjs` base-XP loop). Multiple same-day scans can each award up to the
   daily cap, exceeding the stated invariant. Fix requires persisting per-day paid
   base-XP in the `spellcraft` state. Same class affects the spell-of-the-day bonus
   and `sotd_casts`.
2. **`polymath` achievement hardcodes `schools.length >= 8`** — permanently
   unlockable and progress-capped-below-`need` if the spellbook defines fewer than 8
   schools. Threshold should derive from data/config.
3. **First-scan cosmetic mismatch** — when `prev` is null, spellcraft events
   (e.g. "N spells cast for the first time (+X XP)") are pushed into
   `changes_since_prev` although no XP is applied. Guard those pushes with `if (prev)`.
4. **Structural fragility** — the spellcraft `try/catch` guards only JSON parse, not
   shape; `spellbookCat.spells`/`.counts.total` throw if the scanner emits a
   malformed file, taking down the whole scan. Add shape defaults.

## Non-goals / guardrails

- **No behavior change** anywhere in Phase A. Output JSON must diff clean against the
  pre-refactor scan for the same `--date` and inputs.
- **No new dependencies** — `node:test`/`node:assert` only.
- **No touching `app.js`, `styles.css`, or `main.js`** — those are Phase B/C.
- **No bug fixes** — see §4; deferred by explicit decision.
- Do not change the pipeline's external contract (CLI args, file paths, output
  filenames).

## Verification (how we'll know it's done)

1. **Behavior-preserving:** for a fixed `--date` and the same inputs, the
   `Workspace Status <date>.json` produced by the refactored pipeline is byte-identical
   to the pre-refactor output (capture a baseline before slice 1; diff after each slice).
2. **Modules pure:** each `collector/lib/*.mjs` imports no `fs`/`path` for its core
   logic and is exercised by `collector/lib/*.test.mjs`.
3. **Tests green:** `node --test collector/` passes; each extracted engine has at
   least one characterization test over real fixture data.
4. **Orchestrator shrunk:** `assemble.mjs` contains no engine logic — only I/O, wiring,
   and the final `doc` assembly.
5. **Deferred bugs preserved:** the characterization tests encode current behavior,
   so the deferred bugs are still present (and now pinned by tests) for the follow-up
   sub-project to fix against.
