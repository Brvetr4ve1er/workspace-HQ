# NEXUS Design System — Implementation Plan (Phase 0.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Unlike a code plan, the "test" for each task is **objective harness metrics + before/after screenshots + the mount selftest** — a task is done when its metric target is hit and the screenshots are reviewed. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give NEXUS a real design system — spacing + type tokens, a capped reading measure, a responsive ambient rail, a global tap-size floor, and a shared realm template — eliminating the 5 *measured* systemic causes of "feels built wrong," proven by re-running the UX measurement harness.

**Architecture:** A new `styles/tokens.css` (loaded first) defines `--space-*`, `--fs-*`, `--measure`, `--tap-min`, and a responsive `--ambient-w`. Then a mechanical migration snaps the shared sheets (`base`/`components`/`chrome`) and per-realm sheets onto those ramps — collapsing 16 gap values → 6 and 32 font sizes → ~6 — plus targeted bug fixes (lands micro-labels, tiny targets, medbay hscroll, the stray `)` glyph). Verification is objective: the measurement harness (committed as `tools/ux-measure.js`) reports the metrics before and after; the mount selftest guards structure; screenshots guard the look.

**Tech Stack:** vanilla CSS custom properties (no preprocessor), Electron 32 renderer over `file://`, the offscreen measurement harness (Electron `capturePage` + `getBoundingClientRect` walk).

**Source spec:** the teardown at `…/scratchpad/ux-teardown.md` (measured baseline + `file:line` root causes) is the requirements doc. Baseline artifacts (harness scripts, `ux-measurements.json`, 13 shots) are in that scratchpad.

## Global Constraints

- **Additive-first, reversible.** tokens.css is purely additive (Task 1 changes nothing visually). Migrations are per-sheet commits, screenshot-reviewed, revertible. No v2 changes; v2 rollback untouched.
- **No logic changes.** CSS only, plus one tiny `ambient.js` fix (the stray `)` glyph). No realm `view.js` behavior changes except where a class/markup hook is strictly needed for a bug fix (announce in the task).
- **Theme-safe.** Tokens live in `:root`; the 7 themes (nexus, daylight, arcade, okami, numidea, ops, nightfall) may override colors, NOT the spacing/type ramps. Every task keeps `SELFTEST combos=91 errors=0 PASS` across all 7 themes.
- **Selftest is the structural tripwire; the harness is the quality tripwire.** A task lands only when the mount selftest is green AND its harness metric target is met AND its before/after screenshots are reviewed.
- **Lane = frontend** (`dashboard-v3/`), `fe:` commits, small and often.
- **Ramps (the decisions — use these exact values):**
  - `--space-0:0; --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px`
  - `--fs-xs:12px; --fs-sm:14px; --fs-md:16px; --fs-lg:20px; --fs-xl:26px; --fs-2xl:34px` (nothing below 12px; the pixel display font keeps its large sizes only)
  - `--measure:880px` (reading-width cap for stage content), `--tap-min:32px` (interactive floor), `--ambient-w: clamp(200px, 18vw, 264px)` (responsive rail; replaces the fixed 264px at `cinematic.css:54`/`daylight.css:50`).

---

## The verification oracle

The teardown's throwaway harness becomes a committed tool so before/after is reproducible and reviewable.

- **Baseline (measured, the "before"):** 16 distinct `gap` values · 32 distinct font sizes · 22–34% text <12px (up to 45% hunts) · heading-step ≤1.1× in the flat realms · ambient rail fixed 264px (18–20%) · stage body ~1029px wide / ~120–140ch · tiny targets (`tm-toggle` 19px, `tm-nav` 24px, FOCUS/tab 23px, grimoire 26px) in all 13 realms · lands 15 overflows (6.5px labels) · stray `)` glyph in all 13.
- **Targets (the "after"):** `gap` distinct ≤ 7 · font-size distinct ≤ 8 · text <12px ≈ 0% · heading-step ≥ 1.25× in every realm · ambient rail shrinks at 1280 (share ≤ prior) · every realm's stage body ≤ `--measure` · tiny interactive targets = 0 · lands label overflows = 0 · zero stray-glyph.

---

## Task 1: `tokens.css` — the ramps (purely additive, zero visual change)

**Files:** Create `dashboard-v3/styles/tokens.css`; Modify `dashboard-v3/index.html` (link it FIRST, before `base.css`).

- [ ] **Step 1:** Create `styles/tokens.css` with a single `:root { … }` holding the exact `--space-*`, `--fs-*`, `--measure`, `--tap-min`, `--ambient-w` values from Global Constraints. Nothing else references them yet.
- [ ] **Step 2:** In `index.html`, add `<link rel="stylesheet" href="./styles/tokens.css" />` immediately BEFORE the `base.css` link (line 10) so tokens resolve for every later sheet.
- [ ] **Step 3 (verify — no visual change):** run the selftest (`../dashboard/node_modules/electron/dist/electron.exe dev-main.js --smoke --selftest` from `dashboard-v3/`) → `combos=91 errors=0 PASS`. This task must not alter any layout — it only *declares* variables.
- [ ] **Step 4: Commit** `fe: design-system — add spacing/type/measure tokens (tokens.css, additive)`.

## Task 2: Commit the measurement harness + capture baseline

**Files:** Create `dashboard-v3/tools/ux-measure.js` (adapt the scratchpad `harness.js`+`analyze.js`), `dashboard-v3/tools/ux-baseline.json` (committed baseline metrics).

**Interfaces:**
- Produces: `node ../dashboard/node_modules/electron/dist/electron.exe tools/ux-measure.js [--out <file>]` → writes a metrics JSON with, per realm × {1440×900,1280×800}: `gapDistinct[]`, `fontSizeDistinct[]`, `tinyTargets[]`, `sub12pct`, `headingStep`, `railSharePct`, `stageBodyWidth`, `overflowCount`. Plus a top-level roll-up (global distinct-gap/font counts).

- [ ] **Step 1:** Port the scratchpad harness into `tools/ux-measure.js` (offscreen `BrowserWindow`, load index.html, per realm switch + walk `#nexus`/`#statusbar`, compute the signals above). Keep it dependency-free (Electron only), mirroring `tools/nexus-shot.js`.
- [ ] **Step 2:** Run it; save output as `tools/ux-baseline.json`. Confirm it reproduces the teardown's headline numbers (≈16 gap values, ≈32 font sizes) — if it doesn't, the harness is wrong, fix it before proceeding.
- [ ] **Step 3: Commit** `fe: design-system — commit UX measurement harness + baseline metrics`.

## Task 3: Global safety fixes (high-impact, low-risk — do before the big migration)

**Files:** Modify `styles/base.css`/`cinematic.css`/`daylight.css` (responsive `--ambient-w`), `styles/components.css`/`chrome.css` (tap-min rule), `src/core/ambient.js` (stray `)` glyph).
**Scope note:** the reading-**measure** cap is deliberately NOT here — a blanket `#stage` cap would wrongly narrow the intentionally-wide realms (lands' isometric map, legacy's chart grid). Measure caps are applied per-realm in Task 8, where each realm's content is known.

- [ ] **Step 1 — responsive rail:** make the ambient rail width the token's responsive clamp. The grid at `base.css:39` already reads `var(--ambient-w)`; the fixed `--ambient-w:264px` in `cinematic.css:54` and `daylight.css:50` overrides tokens.css's `clamp(200px,18vw,264px)` — replace those two fixed decls with `var(--ambient-w)` inheritance (delete them so tokens.css wins, or set them to the clamp). Confirm via harness that `railSharePct` shrinks at 1280×900.
- [ ] **Step 2 — tap floor:** add one rule `button, .sigil, .tm-nav, .am-toggle, .tab-focus, [role="button"] { min-height: var(--tap-min); }` with adequate inline padding so 23–26px controls clear 32px. Verify the 1280×800 FOCUS-chip clip is gone.
- [ ] **Step 3 — stray glyph:** find the `)` emitted in the ambient-rail header (`src/core/ambient.js` header builder) and remove it.
- [ ] **Step 4 (verify):** selftest `combos=91 errors=0 PASS`; run `tools/ux-measure.js` → **tinyTargets = 0** all realms, **railSharePct shrinks at 1280** (vs baseline 20.6%); capture screenshots (`tools/nexus-shot.js`) and review vs baseline — layout intact, rail narrower, no glyph.
- [ ] **Step 5: Commit** `fe: design-system — responsive rail, tap-size floor, drop stray glyph`.

## Task 4: Migrate shared-sheet SPACING to `--space-*`

**Files:** Modify `styles/base.css`, `styles/components.css`, `styles/chrome.css`.

- [ ] **Step 1:** Replace hardcoded `gap`/`margin`/`padding` literals in the three shared sheets with the nearest `--space-*` token (snap: 2–4→`--space-1`, 5–8→`--space-2`, 9–12→`--space-3`, 14–16→`--space-4`, 18–24→`--space-5`, 26–32→`--space-6`; kill the stray `55.28px`→`--space-7`). This intentionally regularizes spacing.
- [ ] **Step 2 (verify):** selftest green; harness → global gapDistinct **meaningfully reduced** vs the baseline 16 (realm-sheet spacing is migrated in Task 6; the hard **≤7 gate lands in Task 9** once all sheets are on the scale); screenshots reviewed — the rhythm should read tighter/consistent, no broken layouts (watch topstrip, scrubber, cards).
- [ ] **Step 3: Commit** `fe: design-system — migrate shared sheets to spacing tokens`.

## Task 5: Migrate shared-sheet TYPE to `--fs-*`; kill sub-12px text

**Files:** Modify `styles/base.css`, `styles/components.css`, `styles/chrome.css`.

- [ ] **Step 1:** Replace font-size literals with the nearest `--fs-*` token; **promote everything <12px to `--fs-xs` (12px)** (the 6–11px chrome labels at `chrome.css:129` etc.); collapse near-duplicates (13/13.3/13.5→`--fs-xs`/`--fs-sm` as appropriate). Keep the pixel display font only at `--fs-lg`+ sizes.
- [ ] **Step 2 (verify):** selftest green; harness → **sub12pct ≈ 0**, **fontSizeDistinct ≤ 8** global; screenshots reviewed — labels legible, no overflow from larger text (check the scrubber and rail labels most).
- [ ] **Step 3: Commit** `fe: design-system — migrate shared sheets to type ramp; promote sub-12px text`.

## Task 6: Per-realm type + spacing + hierarchy pass (fix the flat realms)

**Files:** Modify `styles/realms/*.css` (all 13), applying `--fs-*` AND `--space-*`; focus on the flat realms — `summoning`, `observatory`, `watchtower`, `atlas`, `conjure` — plus `chronicle`, `hunts`.

- [ ] **Step 1:** In each realm sheet, snap font sizes to `--fs-*` and gap/margin/padding literals to `--space-*` (same snap map as Task 4), and ensure a real heading step: section titles at `--fs-lg`+ over `--fs-sm/md` body (target ≥1.25× step). Give the flat realms one clear focal element (model on `roundtable`'s "THE ONE THING" card scale). Add scannable anchors to `chronicle` (7-screen wall of uniform text).
- [ ] **Step 2 (verify):** selftest green; harness → **headingStep ≥ 1.25× in every realm**, sub12pct ≈ 0 per realm, per-realm gapDistinct snapped to the scale; screenshots of all 13 reviewed against baseline — each realm now has a visible "where do I look first."
- [ ] **Step 3: Commit** `fe: design-system — per-realm type ramp, spacing + hierarchy (fix the flat realms)`.

## Task 7: `lands` — make the tower labels readable

**Files:** Modify `styles/realms/lands.css` (+ minimal `src/realms/lands/view.js` only if a class hook is required).

- [ ] **Step 1:** Raise the 6.5–7px absolutely-positioned tower labels to ≥`--fs-xs` (12px); stop 8-char ellipsis truncation of project names; de-overlap (leader lines, stagger, or reveal-on-hover) so labels don't clip the isometric towers.
- [ ] **Step 2 (verify):** selftest green; harness → **lands overflowCount = 0**, no <12px labels; screenshot reviewed — names readable, towers uncluttered.
- [ ] **Step 3: Commit** `fe: design-system — lands: legible, de-overlapped tower labels`.

## Task 8: Remaining per-realm caps + affordances

**Files:** Modify `styles/realms/{roundtable,forge,grimoire,lands,legacy,chronicle}.css` (measure caps), `medbay.css` (command wrap), `grimoire.css` (clamp affordance).

- [ ] **Step 1:** Add `max-width: var(--measure)` (or rely on the Task-3 global cap) to the 6 uncapped realms' content wrappers; in `medbay`, soft-wrap or add a copy affordance to the 2059px fix-command `<code>` so reading needs no horizontal scroll; in `grimoire`, add an expand affordance (or clamp to 3 lines) for the 2-line-truncated descriptions + bump the 26px action buttons (covered by Task 3 tap floor — verify).
- [ ] **Step 2 (verify):** selftest green; harness → every realm stageBodyWidth ≤ measure, medbay overflow resolved; screenshots reviewed.
- [ ] **Step 3: Commit** `fe: design-system — measure caps + medbay/grimoire affordances`.

## Task 9: Final harness re-run + before/after proof

**Files:** none (verification + report).

- [ ] **Step 1:** Run `tools/ux-measure.js`; write `tools/ux-after.json`. Produce a before/after table (baseline vs after) for the 8 target metrics.
- [ ] **Step 2 (verify all 5 causes measurably fixed):** gapDistinct ≤7 · fontSizeDistinct ≤8 · sub12pct ≈0 · headingStep ≥1.25× all realms · rail responsive · every realm ≤ measure · tinyTargets 0 · lands overflow 0. Capture the final 13 screenshots.
- [ ] **Step 3:** Dispatch the final whole-branch review (most capable model) over the whole design-system range; point it at the before/after table + screenshots.
- [ ] **Step 4: Commit** `fe: design-system — final metrics (before/after) + screenshots`.

---

## Self-Review (writing-plans checklist vs the teardown)

**Spec coverage:** V1 no-spacing-scale → Tasks 1,4. V2 no-type-scale/sub-legible → Tasks 1,5,6. V3 weak-hierarchy → Task 6. V4 wide-content/bloated-rail → Task 3 (rail+measure) + Task 8 (per-realm caps). V5 density/no-page-model → Task 6 (template). Named bugs: tiny targets → Task 3; lands labels → Task 7; medbay hscroll + grimoire clamp → Task 8; stray glyph → Task 3; 1280 FOCUS-chip clip → Task 3. All covered.

**Placeholder scan:** exact token values, exact metric targets, and exact `file:line` anchors (from the teardown) are inline — no "add appropriate spacing" hand-waving.

**Consistency:** the ramp values in Global Constraints are the single source; every migration task snaps to them. The harness metric names (`gapDistinct`, `sub12pct`, `headingStep`, `railSharePct`, `stageBodyWidth`, `tinyTargets`, `overflowCount`) are defined once in Task 2 and reused in every verify step and in Task 9.

**Risk:** Tasks 4–6 change the look intentionally; each is a small, screenshot-reviewed, revertible commit gated on both the mount selftest and objective harness metrics. Task 1 proves the additive foundation before anything migrates.
