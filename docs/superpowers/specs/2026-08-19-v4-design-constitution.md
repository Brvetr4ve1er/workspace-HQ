# v4 Design Constitution — binding rules for every v4 surface

> Written after three ship→recoil cycles. The recurring failure is never data or logic —
> it is density, hierarchy, and familiarity. These rules bind every agent that touches
> `dashboard-v4/` styling or layout, and the design reviewer enforces them per-surface
> on SCREENSHOTS, not diffs.

## The three complaints these rules exist to kill
1. **"Too crowded"** — boxes jammed edge to edge, five tiles in a row, borders on everything.
2. **"Messy"** — ALL-CAPS mono shouting everywhere; every element at the same visual volume.
3. **"You removed everything"** — abstract surface names and consolidations that erase the user's mental map.

## Type
- Body text is **mixed-case**, `--fs-sm`/`--fs-md`, the UI (sans) family. ALL-CAPS + mono is a **label register only**: eyebrows, tiny section labels, stat captions — never sentences, never titles, never data values.
- One display level per screen: the focal number or title gets `--fs-xl/2xl` display weight. Everything else steps down the ramp. If two elements compete for focal, one of them is wrong.
- Nothing below `--fs-xs` (12px). Line-height ≥ 1.45 for any multi-line text.

## Space
- Text columns cap at `--measure` (880px). Wide grids (charts, card shelves) may exceed it but never touch the viewport edge (min `--space-6` gutters).
- Vertical rhythm: sections separated by `--space-6/7`, cards padded `--space-4/5`. If a screenshot shows panels touching, it fails review.
- Max **3** stat tiles in a row. More stats → a quiet key-value list, not more tiles.

## Chrome
- **Border diet:** borders belong to interactive elements and severity accents ONLY. Passive containers separate by spacing and a background step (`--hud-panel` vs page), not by outline. A screen where every box is outlined fails review.
- **Severity owns color.** Red/amber/yellow appear only where something is wrong. Violet is chrome-accent: ≤ 2 violet-glow elements per screen. Neutral panels are near-black steps, not tinted.
- Glow/scanline/hexagon are seasoning on the shell frame and focal moments — never on every card.

## Hierarchy
- Every surface answers in one glance: *what is the ONE thing this screen wants me to see?* That element is visually dominant; everything else recedes.
- Empty states are calm single sentences, not styled panels.

## Familiarity (the IA rules)
- Rail names are **concrete nouns the user already knows** from v3's plain register: HOME · TASKS · AGENT · PROJECTS · SYSTEM · NOTES · AUTOMATIONS · HISTORY.
- **HOME is the default surface** and it is the v3 decision surface reborn: Oracle "do this now" card, today-pick-one, momentum strip. The app greets you with a decision, not a tool.
- Never merge two surfaces the user navigates to separately without keeping both names reachable.

## Motion
- Only on real state changes (session start/done, output arrival, item cleared). Nothing loops idly except the shell's ambient minimum. `prefers-reduced-motion` kills all of it.

## Process rule
- Any restyle lands per-surface with a SCREENSHOT design review against this document. A surface ships when the reviewer can name the focal element, count ≤2 violet accents, find no touching panels, and read every sentence in mixed case.
