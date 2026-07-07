# Collector Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `collector/assemble.mjs` from a 719-line script into a thin I/O orchestrator that calls small, pure, unit-tested engines under `collector/lib/`, with output byte-for-byte unchanged.

**Architecture:** Extract pure logic (currently top-level imperative blocks and functions coupled to module globals `GCFG`/`prev`/`prevProj`/`enrichProj`/`TODAY`) into ES-module functions that take explicit inputs and return values and do zero file I/O. `assemble.mjs` keeps all reads/writes and wires the engines. Two verification layers: hermetic **unit tests** (`node:test`, real trimmed fixtures) per module, and a **golden end-to-end diff** proving the produced scan JSON is identical after every slice.

**Tech Stack:** Node.js ES modules (`.mjs`), built-in `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- **Behavior-preserving:** for a fixed `--date` and unchanged inputs, `Workspace Status <date>.json` must be byte-identical to the pre-refactor baseline. Verify after every task.
- **Zero new dependencies:** `node:test` / `node:assert` only. No `package.json` install step.
- **No file I/O inside `collector/lib/` engines** — the orchestrator owns all `fs`/`path`.
- **Do not touch** `dashboard/app.js`, `dashboard/styles.css`, `dashboard/main.js` (Phase B/C).
- **No bug fixes** — deferred per spec §4 (daily-cap gap, polymath magic-8, first-scan events, shape fragility). Tests lock *current* behavior, bugs included.
- **Do not change** the CLI contract (`--date`, `--reports-dir`), input/output file paths, or output filenames.
- Fixed test date for golden runs: **`2026-07-06`**.
- **Test command (Node 25):** `node --test collector/lib/*.test.mjs` (shell-glob form — `node --test collector/lib/*.test.mjs` tries to *run* the directory as a module and fails; do NOT use it).

---

## Verification Harness (built in Task 1; used by every task)

Two artifacts under `collector/lib/__fixtures__/`, created in Task 1:

- **`normalize.mjs`** — reads a scan JSON path, sets `scan.date` to `"NORMALIZED"`, prints canonical JSON. Neutralizes the one volatile output field (`assemble.mjs:662` stamps `new Date().toISOString()`).
- **`golden.sh {baseline|verify}`** — the behavior-preservation harness. `baseline` runs the CURRENT code and snapshots normalized output; `verify` re-runs and diffs against the snapshot (nonzero exit + `GOLDEN FAIL` on any change). It is **ephemeral** (baseline+verify run minutes apart on identical inputs, so a nightly scan / calendar advance cannot cause spurious diffs) and **side-effect free**: reports go to a temp dir, and both `data/latest.json` and the hardcoded vault daily note (`10_Daily/2026-07-06.md`) that `assemble.mjs` writes are backed up and restored. `prev` is seeded from `data/latest.json` so the real non-null-prev code path runs.

**Per-task protocol (MANDATORY for every task that edits `assemble.mjs`):**
1. **Before any edit:** `bash collector/lib/__fixtures__/golden.sh baseline` → expect `baseline captured`.
2. Do the extraction + unit tests.
3. **Before commit:** `node --test collector/lib/*.test.mjs` (all green) AND `bash collector/lib/__fixtures__/golden.sh verify` → expect `GOLDEN OK: no behavior change`.

If `verify` prints `GOLDEN FAIL`, the extraction changed behavior — fix before committing. This is the hard gate; a green unit test alone does NOT prove behavior preservation.

---

### Task 1: Test harness, shared util module, golden baseline

**Files:**
- Create: `collector/lib/util.mjs`
- Create: `collector/lib/util.test.mjs`
- Create: `collector/lib/__fixtures__/normalize.mjs` (strips the one volatile output field)
- Create: `collector/lib/__fixtures__/golden.sh` (ephemeral baseline/verify harness — see Verification Harness section)
- Modify: `collector/assemble.mjs` (add `import { clamp, round } from './lib/util.mjs'`; delete the inline `clamp`/`round` at the `// ---- helpers ----` block)

**Nondeterminism note (critical):** `assemble.mjs:662` writes `scan.date: new Date().toISOString()` — a wall-clock timestamp that changes every run. It is the ONLY volatile field in the output (everything else derives from `--date` or stable input files). The golden mechanism MUST normalize it, or every diff fails spuriously. `normalize.mjs` handles this; use it on both the baseline and every comparison.

**Interfaces:**
- Consumes: nothing.
- Produces: `export const clamp = (n, lo, hi) => ...`, `export const round = (n) => Math.round(n)` — imported by `spellcraft.mjs`, `projects.mjs`, `gamification.mjs` in later tasks.

- [ ] **Step 1: Create the normalizer**

Create `collector/lib/__fixtures__/normalize.mjs` (canonicalizes the volatile `scan.date` so diffs reflect only logic changes):
```js
// Normalize the one volatile output field (scan.date wall-clock) so golden
// diffs reflect logic changes only. Reads a file path, prints normalized JSON.
import { readFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (doc.scan) doc.scan.date = 'NORMALIZED';
process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
```

- [ ] **Step 2: Create the ephemeral golden runner** — see the **Verification Harness** section above for the full `golden.sh` script. Create `collector/lib/__fixtures__/golden.sh` exactly as specified there and `chmod +x` it.

- [ ] **Step 3: Prove the harness on unchanged code**

Run:
```bash
cd "C:/Users/ROG STRIX/Documents/workspace hq"
bash collector/lib/__fixtures__/golden.sh baseline   # captures current (pre-change) output
bash collector/lib/__fixtures__/golden.sh verify      # must pass with zero changes
```
Expected: `baseline captured` then `GOLDEN OK: no behavior change`. (Confirms the harness is stable before we rely on it.)

- [ ] **Step 4: Write the failing unit test for util**

Create `collector/lib/util.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, round } from './util.mjs';

test('clamp bounds a value to [lo, hi]', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('round is integer rounding', () => {
  assert.equal(round(2.4), 2);
  assert.equal(round(2.5), 3);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test collector/lib/*.test.mjs`
Expected: FAIL — `Cannot find module './util.mjs'`.

- [ ] **Step 6: Create the util module**

Create `collector/lib/util.mjs`:
```js
// Shared numeric helpers for the collector engines. Pure, no I/O.
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const round = (n) => Math.round(n);
```

- [ ] **Step 7: Wire it into assemble.mjs**

In `collector/assemble.mjs`, add near the other imports (after line 16):
```js
import { clamp, round } from './lib/util.mjs';
```
Delete the inline definitions at lines 54-55:
```js
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);
```

- [ ] **Step 8: Run unit tests + golden diff**

Run: `node --test collector/lib/*.test.mjs`
Expected: PASS (2 tests).
Run: `bash collector/lib/__fixtures__/golden.sh verify`
Expected: `GOLDEN OK: output identical (modulo scan.date)`.

- [ ] **Step 9: Commit**

```bash
git add collector/lib/ collector/assemble.mjs
git commit -m "refactor(collector): add lib/ test harness, util module, golden baseline"
```

---

### Task 2: Extract `spellcraft.mjs` (proof slice)

**Files:**
- Create: `collector/lib/spellcraft.mjs`
- Create: `collector/lib/spellcraft.test.mjs`
- Create: `collector/lib/__fixtures__/spellbook.sample.json` (trimmed copy of `data/spellbook.json`)
- Create: `collector/lib/__fixtures__/spell-telemetry.sample.json` (trimmed copy of `data/spell-telemetry.json`)
- Modify: `collector/assemble.mjs` — replace the settlement block (currently ≈ lines 376-471, the `let spellbookCat...` through the closing `}` of `if (spellbookCat) {`) with a call to `settle(...)`.

**Interfaces:**
- Consumes: `round` from `./util.mjs`.
- Produces:
```
settle({ catalog, telemetry, config, prev, today }) -> {
  spellcraft: object | null,   // the account.spellcraft rollup
  spellXp: number,             // XP to fold into xpGain
  events: object[],            // spellcraftEvents pushed into changes_since_prev
  spellOfDay: object | null
}
```
where `catalog` = parsed spellbook.json (or null), `telemetry` = parsed spell-telemetry.json (or null), `config` = `GCFG.spellcraft || {}`, `prev` = previous scan doc (or null), `today` = `TODAY` string.

- [ ] **Step 1: Capture fixtures**

Run:
```bash
cd "C:/Users/ROG STRIX/Documents/workspace hq"
cp data/spellbook.json       collector/lib/__fixtures__/spellbook.sample.json
cp data/spell-telemetry.json collector/lib/__fixtures__/spell-telemetry.sample.json
```

- [ ] **Step 2: Write the failing characterization test**

Create `collector/lib/spellcraft.test.mjs`. It runs `settle` with real fixtures and `prev: null`, and asserts on the *current* shape/values (this pins today's behavior — bugs included, per Global Constraints):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { settle } from './spellcraft.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '__fixtures__', f), 'utf8'));
const catalog = load('spellbook.sample.json');
const telemetry = load('spell-telemetry.sample.json');
const config = {
  cast_xp: 5, cast_xp_daily_cap_total: 25, first_cast_bonus: 15,
  spell_of_day_bonus: 10, mastery_rank_up_xp: 20,
  mastery_tiers: [
    { rank: 'novice', days: 1 }, { rank: 'adept', days: 5 },
    { rank: 'expert', days: 15 }, { rank: 'master', days: 40 },
    { rank: 'grandmaster', days: 100 },
  ],
  rarity_order: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
};

test('settle returns the four-key shape and non-negative XP', () => {
  const r = settle({ catalog, telemetry, config, prev: null, today: '2026-07-06' });
  assert.deepEqual(Object.keys(r).sort(), ['events', 'spellOfDay', 'spellXp', 'spellcraft'].sort());
  assert.ok(r.spellXp >= 0);
  assert.ok(r.spellcraft === null || typeof r.spellcraft === 'object');
});

test('settle degrades to null spellcraft when no catalog', () => {
  const r = settle({ catalog: null, telemetry: null, config, prev: null, today: '2026-07-06' });
  assert.equal(r.spellcraft, null);
  assert.equal(r.spellXp, 0);
  assert.deepEqual(r.events, []);
});

test('spellcraft rollup exposes the settlement watermark', () => {
  const r = settle({ catalog, telemetry, config, prev: null, today: '2026-07-06' });
  if (r.spellcraft) assert.ok('last_processed_at' in r.spellcraft);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test collector/lib/spellcraft.test.mjs`
Expected: FAIL — `Cannot find module './spellcraft.mjs'`.

- [ ] **Step 4: Create the module by moving the block verbatim**

Create `collector/lib/spellcraft.mjs`. Move the settlement logic from `assemble.mjs` (lines ≈376-471) into a `settle` function **unchanged except**: (a) wrap in the function signature, (b) replace the two module globals `GCFG.spellcraft`→`config`, `TODAY`→`today`, `prev`→`prev` (already the name), `spellbookCat`→`catalog`, `spellTele`→`telemetry`, (c) `import { round } from './util.mjs'`, (d) return the four values. Skeleton (the body between the markers is the moved code with the renames above):
```js
import { round } from './util.mjs';

// Settle Spellbook cast telemetry into XP. Pure; see docs spec 2026-07-06 §1.
// NOTE: preserves current behavior verbatim, including the deferred bugs in spec §4.
export function settle({ catalog, telemetry, config, prev, today }) {
  const SC = config || {};
  const scTiers = SC.mastery_tiers || [];
  const scRankOf = (days) => { let r = null; for (const t of scTiers) if (days >= t.days) r = t.rank; return r; };
  const scRankIdx = (rank) => scTiers.findIndex((t) => t.rank === rank);

  let spellcraft = null, spellXp = 0, spellOfDay = null;
  const spellcraftEvents = [];
  if (catalog) {
    // >>> BEGIN moved from assemble.mjs (rename: spellbookCat->catalog, spellTele->telemetry, TODAY->today) <<<
    // ... the existing body: catById, prevSC, rollup, casts, watermark, fresh,
    //     perDay base-XP loop, mastery loop, spell-of-day, deterministic pick,
    //     collection meters, maxWatermark, the `spellcraft = {...}` object,
    //     and the newSpellsCast / arsenal-grew event pushes ...
    // >>> END moved block <<<
  }
  return { spellcraft, spellXp, events: spellcraftEvents, spellOfDay };
}
```
Copy the real body from the current file; do not paraphrase it.

- [ ] **Step 5: Wire the call into assemble.mjs**

Add import after line 16:
```js
import { settle as settleSpellcraft } from './lib/spellcraft.mjs';
```
Replace the removed block (where it used to compute `spellcraft`/`spellXp`/`spellcraftEvents`/`spellOfDay`) with the file reads + call:
```js
let spellbookCat = null, spellTele = null;
try { spellbookCat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spellbook.json'), 'utf8')); } catch {}
try { spellTele = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spell-telemetry.json'), 'utf8')); } catch {}
const { spellcraft, spellXp, events: spellcraftEvents, spellOfDay } =
  settleSpellcraft({ catalog: spellbookCat, telemetry: spellTele, config: GCFG.spellcraft || {}, prev, today: TODAY });
```
Leave the downstream consumers (`xpGain += spellXp`, `changes.push(...spellcraftEvents)`, `...(spellcraft ? { spellcraft } : {})`, the `spellTele`/`spellbookCat`-based achievements and `castsToday`) exactly as they are — they still reference `spellTele`, `spellbookCat`, `spellcraft`, `spellXp`, which remain in scope.

- [ ] **Step 6: Run unit tests + golden diff**

Run: `node --test collector/lib/*.test.mjs`
Expected: PASS (util + spellcraft tests).
Run: `bash collector/lib/__fixtures__/golden.sh verify`
Expected: `GOLDEN OK: output byte-identical`.

- [ ] **Step 7: Commit**

```bash
git add collector/lib/spellcraft.mjs collector/lib/spellcraft.test.mjs collector/lib/__fixtures__/ collector/assemble.mjs
git commit -m "refactor(collector): extract spellcraft settlement into lib/spellcraft.mjs"
```

---

### Task 3: Extract `git-risk.mjs`

**Files:**
- Create: `collector/lib/git-risk.mjs`
- Create: `collector/lib/git-risk.test.mjs`
- Modify: `collector/assemble.mjs:57-68` (remove `gitRisk`, import instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function gitRisk(g) -> { risk: 'low'|'medium'|'high', flags: string[] }`. Called by `projects.mjs` in Task 4 and by `assemble.mjs`.

- [ ] **Step 1: Write the failing test**

Create `collector/lib/git-risk.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitRisk } from './git-risk.mjs';

test('no git => high risk with no-git flag', () => {
  const r = gitRisk({ has_git: false });
  assert.equal(r.risk, 'high');
  assert.ok(r.flags.includes('no-git'));
});

test('clean synced repo => low risk', () => {
  const r = gitRisk({ has_git: true, has_remote: true, commits: 10, dirty: 0, unpushed: false, behind: 0 });
  assert.equal(r.risk, 'low');
  assert.deepEqual(r.flags, []);
});

test('unpushed => medium risk', () => {
  const r = gitRisk({ has_git: true, has_remote: true, commits: 10, dirty: 0, unpushed: true, behind: 0 });
  assert.equal(r.risk, 'medium');
  assert.ok(r.flags.includes('unpushed'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test collector/lib/git-risk.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `collector/lib/git-risk.mjs` containing `export function gitRisk(g) { ... }` — move the body from `assemble.mjs:57-68` verbatim, add `export`.

- [ ] **Step 4: Wire into assemble.mjs**

Add import after line 16: `import { gitRisk } from './lib/git-risk.mjs';`
Delete `assemble.mjs:57-68` (the local `gitRisk`).

- [ ] **Step 5: Run tests + golden diff**

Run: `node --test collector/lib/*.test.mjs` → PASS.
Run: `bash collector/lib/__fixtures__/golden.sh verify` → `GOLDEN OK`.

- [ ] **Step 6: Commit**

```bash
git add collector/lib/git-risk.mjs collector/lib/git-risk.test.mjs collector/assemble.mjs
git commit -m "refactor(collector): extract gitRisk into lib/git-risk.mjs"
```

---

### Task 4: Extract `projects.mjs`

**Files:**
- Create: `collector/lib/projects.mjs`
- Create: `collector/lib/projects.test.mjs`
- Create: `collector/lib/__fixtures__/raw-metrics.sample.json` (trimmed copy of `data/raw-metrics.json` — keep 2-3 `products` entries)
- Modify: `collector/assemble.mjs` — remove `deterministicCompletion` (108-127), `slugify` (129), `buildSideQuests` (134-198), `buildProject` (200-266); import them; keep the `allProjects`/overrides wiring (269-275) in the orchestrator.

**Interfaces:**
- Consumes: `clamp`, `round` from `./util.mjs`; `gitRisk` from `./git-risk.mjs`.
- Produces:
  - `export function deterministicCompletion(rp) -> number`
  - `export function buildSideQuests(rp, en) -> object[]`
  - `export function buildProject(rp, { prevProj, enrichProj, config }) -> project` — the three module globals (`prevProj`, `enrichProj`, `GCFG`) become an explicit deps object; `ps` inside is `config.project_score`.

- [ ] **Step 1: Capture fixture**
```bash
cp data/raw-metrics.json collector/lib/__fixtures__/raw-metrics.sample.json
```
(Optionally hand-trim to 2-3 products; keep it valid JSON.)

- [ ] **Step 2: Write the failing test**

Create `collector/lib/projects.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildProject, deterministicCompletion } from './projects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, '__fixtures__', 'raw-metrics.sample.json'), 'utf8'));
const GCFG = JSON.parse(readFileSync(join(here, '..', '..', '..', 'schema', 'gamification.config.json'), 'utf8'));
const rp = RAW.products.find((p) => !p.missing);

test('deterministicCompletion stays within [3, 95]', () => {
  const pct = deterministicCompletion(rp);
  assert.ok(pct >= 3 && pct <= 95);
});

test('buildProject returns a product with id, level, metrics', () => {
  const p = buildProject(rp, { prevProj: new Map(), enrichProj: {}, config: GCFG });
  assert.equal(p.id, rp.id);
  assert.equal(p.kind, 'product');
  assert.ok(p.metrics.git_safety);
  assert.ok(typeof p.level === 'number');
});
```
Note the schema path from `collector/lib/`: `../../../schema/gamification.config.json`.

- [ ] **Step 3: Run to verify it fails**

Run: `node --test collector/lib/projects.test.mjs` → FAIL (module not found).

- [ ] **Step 4: Create the module**

Create `collector/lib/projects.mjs`:
```js
import { clamp, round } from './util.mjs';
import { gitRisk } from './git-risk.mjs';

export function deterministicCompletion(rp) { /* moved verbatim from assemble.mjs:108-127 */ }
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export function buildSideQuests(rp, en) { /* moved verbatim from assemble.mjs:134-198 */ }

export function buildProject(rp, { prevProj, enrichProj, config }) {
  const ps = config.project_score;
  const en = enrichProj[rp.id] || {};
  // moved verbatim from assemble.mjs:202-265, with these renames:
  //   levelFor(...)  -> use gamification.levelFor in Task 6? NO — buildProject calls levelFor.
  //   To avoid a forward dep, inline the level lookup here OR import from gamification.
  // Simplest for this task: keep a local levelFor that reads config.level_curve.
  // (Task 6 will import THIS one, or both call a shared lib/levels — see Task 6 note.)
}
```
**Coupling note:** `buildProject` calls `levelFor`, which Task 6 also needs. To keep tasks independent, in this task add a local `function levelFor(xp, tiers = config.level_curve.tiers)` inside `projects.mjs` (moved from `assemble.mjs:94-104`, taking `tiers` as a param). Task 6 will extract the canonical `levelFor` into `gamification.mjs` and `projects.mjs` will switch its import to it. Document this in the commit message.

- [ ] **Step 5: Wire into assemble.mjs**

Add imports after line 16:
```js
import { buildProject, deterministicCompletion, buildSideQuests } from './lib/projects.mjs';
```
Delete `assemble.mjs` lines 106-127 (`deterministicCompletion`), 129 (`slugify`), 131-198 (`buildSideQuests`), 200-266 (`buildProject`). Change the map call at line 271:
```js
const allProjects = RAW.products.filter((p) => !p.missing)
  .map((rp) => buildProject(rp, { prevProj, enrichProj, config: GCFG }));
```
Keep 269-270 (projOverrides read) and 272-275 as-is.

- [ ] **Step 6: Run tests + golden diff**

Run: `node --test collector/lib/*.test.mjs` → PASS.
Run: `bash collector/lib/__fixtures__/golden.sh verify` → `GOLDEN OK`.

- [ ] **Step 7: Commit**

```bash
git add collector/lib/projects.mjs collector/lib/projects.test.mjs collector/lib/__fixtures__/raw-metrics.sample.json collector/assemble.mjs
git commit -m "refactor(collector): extract project builders into lib/projects.mjs"
```

---

### Task 5: Extract `quests.mjs`

**Files:**
- Create: `collector/lib/quests.mjs`
- Create: `collector/lib/quests.test.mjs`
- Modify: `collector/assemble.mjs` — remove `autoSatisfied` (71-81), `questCtx` (83-92); import them and a new `deriveQuests`. The carry/override loops that mutate `quests` stay in the orchestrator OR move whole — see interface.

**Interfaces:**
- Consumes: nothing from other lib modules.
- Produces:
  - `export function autoSatisfied(expr, ctx) -> boolean` (moved verbatim from 71-81)
  - `export function questCtx(q, prodById, emptyCount) -> object` (moved verbatim from 83-92)
  - `export function deriveQuests({ prevQuests, projects, prodById, emptyCount, today, questXpByTier }) -> { quests, questsCompletedThisScan }` — wraps the carry+re-evaluate loop (283-291), the concern-dedup (294-311), and the git/build derivation (312-327). Reads `GCFG.quest_xp_by_tier` via the passed `questXpByTier`. Does **not** apply user overrides (kept in orchestrator, since it does its own file read).

- [ ] **Step 1: Write the failing test**

Create `collector/lib/quests.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSatisfied, questCtx, deriveQuests } from './quests.mjs';

test('autoSatisfied is false for manual/empty', () => {
  assert.equal(autoSatisfied('manual', {}), false);
  assert.equal(autoSatisfied('', {}), false);
});

test('autoSatisfied evaluates a safe expression', () => {
  assert.equal(autoSatisfied('has_git && commits>0', { has_git: true, commits: 3 }), true);
  assert.equal(autoSatisfied('has_git && commits>0', { has_git: true, commits: 0 }), false);
});

test('deriveQuests raises a red gitinit quest for a repo with no git', () => {
  const p = { id: 'x', name: 'X', metrics: { git_safety: { has_git: false }, code_health: { build: 'green' } } };
  const { quests } = deriveQuests({
    prevQuests: [], projects: [p], prodById: new Map([['x', p]]),
    emptyCount: 0, today: '2026-07-06', questXpByTier: { red: 50, orange: 20, yellow: 10 },
  });
  assert.ok(quests.some((q) => q.id === 'q-x-gitinit' && q.tier === 'red'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test collector/lib/quests.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Create the module**

Create `collector/lib/quests.mjs` with `autoSatisfied`, `questCtx` (verbatim moves), and `deriveQuests` wrapping the three loops. Inside `deriveQuests`, replace `prev?.quests || []` with `prevQuests`, `TODAY` with `today`, `GCFG.quest_xp_by_tier` with `questXpByTier`, and return `{ quests, questsCompletedThisScan }`.

- [ ] **Step 4: Wire into assemble.mjs**

Add import after line 16:
```js
import { autoSatisfied, questCtx, deriveQuests } from './lib/quests.mjs';
```
Delete 71-92 (the two functions). Replace the block 277-327 with:
```js
const emptyCount = RAW.discovered.filter((d) => d.classification === 'empty').length;
let { quests, questsCompletedThisScan } = deriveQuests({
  prevQuests: prev?.quests || [], projects, prodById,
  emptyCount, today: TODAY, questXpByTier: GCFG.quest_xp_by_tier,
});
```
Keep the override block 329-345 (it reads `data/quest-overrides.json`) and 347-348 unchanged. (`questCtx`/`autoSatisfied` are still imported for any other reference; if none remain, drop those two from the import.)

- [ ] **Step 5: Run tests + golden diff**

Run: `node --test collector/lib/*.test.mjs` → PASS.
Run: `bash collector/lib/__fixtures__/golden.sh verify` → `GOLDEN OK`.

- [ ] **Step 6: Commit**

```bash
git add collector/lib/quests.mjs collector/lib/quests.test.mjs collector/assemble.mjs
git commit -m "refactor(collector): extract quest engine into lib/quests.mjs"
```

---

### Task 6: Extract `gamification.mjs`

**Files:**
- Create: `collector/lib/gamification.mjs`
- Create: `collector/lib/gamification.test.mjs`
- Modify: `collector/assemble.mjs` — remove `levelFor` (94-104) and the rollup block (350-374); import `levelFor` + `rollup`. Update `projects.mjs` to import `levelFor` from here (removing its local copy from Task 4).

**Interfaces:**
- Consumes: `clamp`, `round` from `./util.mjs`.
- Produces:
  - `export function levelFor(xp, tiers) -> { level, title, xp_into_level, xp_to_next }` (moved from 94-104; `GCFG.level_curve.tiers` becomes the `tiers` param).
  - `export function rollup({ projects, quests, riskCounts, prev, today }) -> { avgCompletion, buildScore, testCovScore, riskScore, gitSafetyScore, healthIndex, scanDays, longest }` — wraps 351-374.

- [ ] **Step 1: Write the failing test**

Create `collector/lib/gamification.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor } from './gamification.mjs';

const tiers = [
  { level: 1, title: 'Novice', min_xp: 0 },
  { level: 2, title: 'Apprentice', min_xp: 100 },
  { level: 3, title: 'Adept', min_xp: 300 },
];

test('levelFor picks the highest tier at or below xp', () => {
  const r = levelFor(150, tiers);
  assert.equal(r.level, 2);
  assert.equal(r.xp_into_level, 50);
  assert.equal(r.xp_to_next, 150);
});

test('levelFor at top tier reports zero to next', () => {
  const r = levelFor(500, tiers);
  assert.equal(r.level, 3);
  assert.equal(r.xp_to_next, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test collector/lib/gamification.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Create the module**

Create `collector/lib/gamification.mjs`:
```js
import { clamp, round } from './util.mjs';

export function levelFor(xp, tiers) { /* moved from assemble.mjs:94-104, `GCFG.level_curve.tiers` -> tiers param */ }

export function rollup({ projects, quests, riskCounts, prev, today }) {
  // moved verbatim from assemble.mjs:351-374 (avgCompletion..healthIndex, streak),
  // returning the named values. `TODAY` -> today.
}
```

- [ ] **Step 4: Wire into assemble.mjs and projects.mjs**

`assemble.mjs`: add import after line 16:
```js
import { levelFor, rollup as gamificationRollup } from './lib/gamification.mjs';
```
Delete 94-104 (`levelFor`). Replace 350-374 with:
```js
const riskCounts = { high: 0, medium: 0, low: 0 };
for (const p of projects) riskCounts[p.metrics.git_safety.risk]++;
const { avgCompletion, buildScore, testCovScore, riskScore, gitSafetyScore, healthIndex, scanDays, longest } =
  gamificationRollup({ projects, quests, riskCounts, prev, today: TODAY });
```
(Any downstream reference to `avgCompletion`, `healthIndex`, `scanDays`, `longest`, `riskCounts`, `buildScore` etc. still resolves — they are now `const`s from the destructure.)

`projects.mjs`: replace the local `levelFor` (added in Task 4) with `import { levelFor } from './gamification.mjs';` and call `levelFor(Math.max(0, score), config.level_curve.tiers)`.

- [ ] **Step 5: Run tests + golden diff**

Run: `node --test collector/lib/*.test.mjs` → PASS.
Run: `bash collector/lib/__fixtures__/golden.sh verify` → `GOLDEN OK`.

- [ ] **Step 6: Commit**

```bash
git add collector/lib/gamification.mjs collector/lib/gamification.test.mjs collector/lib/projects.mjs collector/assemble.mjs
git commit -m "refactor(collector): extract levelFor + health/streak rollup into lib/gamification.mjs"
```

---

### Task 7: Extract `trends.mjs`

**Files:**
- Create: `collector/lib/trends.mjs`
- Create: `collector/lib/trends.test.mjs`
- Modify: `collector/assemble.mjs` — remove `appendTrend` (545-549); import it (and optionally a `buildTrends` wrapper).

**Interfaces:**
- Consumes: nothing.
- Produces: `export function appendTrend(arr, point, today, key = 'd') -> array` — the `TODAY` global becomes an explicit `today` param (inserted before `key`).

- [ ] **Step 1: Write the failing test**

Create `collector/lib/trends.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendTrend } from './trends.mjs';

test('appendTrend replaces an existing same-day point (idempotent)', () => {
  const start = [{ d: '2026-07-05', v: 1 }, { d: '2026-07-06', v: 2 }];
  const out = appendTrend(start, { d: '2026-07-06', v: 9 }, '2026-07-06');
  assert.equal(out.filter((x) => x.d === '2026-07-06').length, 1);
  assert.equal(out.find((x) => x.d === '2026-07-06').v, 9);
});

test('appendTrend appends a new day', () => {
  const out = appendTrend([{ d: '2026-07-05', v: 1 }], { d: '2026-07-06', v: 2 }, '2026-07-06');
  assert.equal(out.length, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test collector/lib/trends.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Create the module**

Create `collector/lib/trends.mjs`:
```js
export function appendTrend(arr, point, today, key = 'd') {
  const a = (arr || []).filter((x) => x[key] !== today);
  a.push(point);
  return a;
}
```

- [ ] **Step 4: Wire into assemble.mjs**

Add import after line 16: `import { appendTrend } from './lib/trends.mjs';`
Delete 545-549. Update every `appendTrend(...)` call in the `trends` object (≈552-562) to pass `TODAY`: e.g. `appendTrend(prev?.trends?.health_index, { d: TODAY, v: healthIndex }, TODAY)`.

- [ ] **Step 5: Run tests + golden diff**

Run: `node --test collector/lib/*.test.mjs` → PASS (all modules).
Run: `bash collector/lib/__fixtures__/golden.sh verify` → `GOLDEN OK`.

- [ ] **Step 6: Final verification + commit**

Confirm `assemble.mjs` now contains no engine logic — only imports, file reads, the wiring calls, and the final `doc` assembly/writes. Check its new line count (`wc -l collector/assemble.mjs`) is materially smaller (target ≲ 350).
```bash
git add collector/lib/trends.mjs collector/lib/trends.test.mjs collector/assemble.mjs
git commit -m "refactor(collector): extract appendTrend into lib/trends.mjs; assemble.mjs is now orchestrator-only"
```

---

## Post-plan verification (run once, after Task 7)

- [ ] `node --test collector/lib/*.test.mjs` — all module tests green.
- [ ] `bash collector/lib/__fixtures__/golden.sh verify` — byte-identical.
- [ ] `grep -nE "^(function|const [a-z]+ = \()" collector/assemble.mjs` — only orchestration/I/O helpers remain (`arg`, `loadPrevious`); no `gitRisk`/`levelFor`/`buildProject`/`autoSatisfied`/`appendTrend`/settlement logic.
- [ ] Deferred bugs from spec §4 are still present and now pinned by characterization tests (do NOT fix here).
