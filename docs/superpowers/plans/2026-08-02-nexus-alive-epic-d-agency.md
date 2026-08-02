# NEXUS ALIVE — Epic D · Agency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make NEXUS *act*. Every detected project gap gets a row with actions that genuinely work: hand the gap to Claude inside that project, or park it as an idea that becomes a real side-quest on the next scan.

**Architecture:** One pure module `intel/agency.mjs` turns `selected.projects[].signals` gaps into actionable proposals (label, seed prompt, capture text). One new registered action `claude:dispatch` wraps the **existing** `hq:claude-quest` IPC. One "Suggested actions" strip in the **forge** (PROJECTS) realm consumes both. Finally, the War Room's inert "Send Claude" button is wired to the same real seam. No new IPC channel, no contract change, no main-process edit.

**Tech Stack:** Electron 32 (Chromium 128, Node ~20), vanilla-JS ESM over `file://`, no build step. Pure-module tests: `node --test`. Mount integrity: `dev-main.js --smoke --selftest`.

## Global Constraints

- **Additive-only.** No `latest.json`/sidecar shape change. **No new IPC channel** — `claude:dispatch` reuses the existing `hq:claude-quest`; the capture path reuses `hq:capture-save`. No `dashboard/main.js` or `preload.js` edit. Everything under `dashboard-v3/`.
- **Selftest stays 105** (`combos=105 errors=0 PASS`, 15 realms × 7 themes). Epic D adds no realm.
- **Lifecycle.** forge and warroom mount/unmount 105× per selftest. Anything created on mount is torn down in `unmount()` and must not accumulate across re-renders (`render()` re-runs on `data:select`). Existing disposers stay intact. Handlers use **property assignment** (`onclick`), the codebase's leak-proof idiom.
- **XSS.** Every scan-derived value reaching `innerHTML` goes through `esc()`.
- **Purity firewall.** `intel/agency.mjs`: NO imports, no DOM, no `Date.now()`, no globals. Testable under `node --test`.
- **NO DEAD OR LYING CONTROLS.** A control does something real, or renders disabled with an explanation. A control must not claim an outcome it cannot verify, and must not imply synchrony where the effect is asynchronous. (Three prior epics each shipped one of these; each cost a fix wave.)
- **Copy stays plain** for nexus/daylight.
- **Run tests by FILE, never a bare directory** — this environment's Node mis-discovers directory tests.

**Verified ground truth (live data + code, 2026-08-02 — do not re-derive):**
- **`hq:claude-quest` EXISTS** (`dashboard/main.js:737`, `preload.js:13`, and a row in `docs/sync/IPC-CONTRACT.md`): `claudeQuest(projPath, prompt)` → resolves the project dir, then `spawnSync('cmd.exe', ['/c','start','','cmd','/k','cd /d "<cwd>" && claude "<prompt>"'])`. Because it shells out through `start`, it returns promptly and opens a NEW terminal window. Prompt is quote-escaped, newlines collapsed, **truncated to 500 chars**. Returns `true`, or `false` when the path fails containment.
- **`resolveProjectPath`** (`main.js:60`) accepts a RELATIVE path and resolves it under `DOCS_ROOT` with a containment check. Every project carries `.path` (e.g. `"alliance travel"`); **8/8 projects have it**. So pass `project.path` straight through.
- **Capture → side-quest is real but ASYNCHRONOUS.** `captureSave(text)` writes `data/brain-dump.json`; `collector/assemble.mjs:270-278` maps each dump to `{ id: 'sq-capture-<id>', kind:'idea', title: <text>, source:'capture' }` and unshifts it into `side_quests`. It therefore appears **after the next scan**, not immediately. It also honors `overrides[id].status` of `done`/`dismissed`.
- **`hq:capture-save` side effects** (`main.js:493-506`): writes the file, then runs a **blocking `spawnSync(assemble.mjs)`** and **`win.reload()`** — i.e. capturing from inside the main window freezes the app ~1.6s and hard-reloads the dashboard. (Measured in Epic C.) Any capture control must set expectations accordingly and must not promise a confirmation state that the reload destroys.
- **Signal gaps available** in `project.signals`: `has_tests` (5 projects false), `has_ci` (5 false), `has_readme` (2 false), `has_license` (6 false). Also present but NOT used here: `test_files`, `has_build_config`, `build_script`, `has_dockerfile`, `has_package_json`, `dep_count`.
- **Feature #6 (spell recommendations) is NOT SHIPPING — deliberately.** `hq:spell-cast`'s `opts` carries only `notify` (`main.js:1160-1185`); the cast always uses the spell's own `spell.cwd`, so a spell CANNOT be targeted at the project that has the gap. Independently, `derive.spellFit()`'s matching is naive substring-over-name+description: it matches `architecture-de**ci**sion-records` for "ci" and `caveman` for "license", and **zero** spells exist whose name contains "license" or "readme". Recommending any of these as a fix for a specific project would be a false claim. Task 4 files this as an ASK instead. **Do not add spell recommendations in this epic.**
- `derive.spellFit()` stays UNCHANGED (it is unit-tested and out of scope here).
- Host realm: `dashboard-v3/src/realms/forge/view.js` — the PROJECTS realm; appends its content directly into `#stage` (there is no `.realm-forge` wrapper; `styles/realms/forge.css` scopes via `#stage:has(> .forge-grid)`), and keeps a `data:select` disposer.
- Existing registered actions (`src/core/actions.mjs`): `go:<realm>`, `scan:now`, `capture:idea` (**a documented no-op — `hq.capture` does not exist; never wire anything to it**), `capture:note` (real, `hq.captureSave(ctx.text)`), `quest:done`, `cast`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dashboard-v3/src/intel/agency.mjs` | **Pure**: `agencyProposals(selected)` → per-project gap proposals. | 1 |
| `dashboard-v3/src/intel/agency.test.mjs` | `node --test` suite. | 1 |
| `dashboard-v3/src/core/actions.mjs` + `actions.test.mjs` | New `claude:dispatch` action over the existing `hq:claude-quest`. | 2 |
| `dashboard-v3/src/realms/forge/view.js` + `styles/realms/forge.css` | "Suggested actions" strip (#5 + #7). | 3 |
| `dashboard-v3/src/realms/warroom/view.js` | Wire the inert "Send Claude" to the real seam. | 4 |
| `docs/sync/HANDOFF.md` + `docs/sync/IPC-CONTRACT.md` | Handoff entry + the spell-cast `opts.cwd` ASK. | 4 |

---

### Task 1: `intel/agency.mjs` — pure gap→proposal derivation

**Files:** Create `dashboard-v3/src/intel/agency.mjs`, `dashboard-v3/src/intel/agency.test.mjs`.

**Interfaces (produced):**
- `agencyProposals(selected) → [{ projectId, projectName, projectPath, gap, label, seedPrompt, captureText }]`
  - One entry per `(project, gap)` where `project.signals[flag] === false`, for exactly these four flags in this order: `has_tests`, `has_ci`, `has_readme`, `has_license`.
  - `gap` ∈ `'tests'|'ci'|'readme'|'license'`.
  - `label` — plain, human: `No tests`, `No CI`, `No README`, `No license`.
  - `seedPrompt` — the sentence handed to Claude, project-scoped and imperative, e.g. `Add a test suite to this project and make it pass.` **Must be ≤ 200 chars** (the IPC truncates at 500; staying well under keeps it intact after quote-escaping).
  - `captureText` — the idea-feed line, e.g. `<projectName>: add a test suite`.
  - Sorted: by project order as given, then by the flag order above. Never throws on `null`/`{}`/missing `signals`. Projects missing `path` are SKIPPED entirely (they cannot be dispatched).

- [ ] **Step 1: Write the failing test** — `dashboard-v3/src/intel/agency.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agencyProposals } from './agency.mjs';

const SEL = { projects: [
  { id: 'p1', name: 'Alpha', path: 'Alpha', signals: { has_tests: false, has_ci: false, has_readme: true, has_license: true } },
  { id: 'p2', name: 'Beta',  path: 'Beta',  signals: { has_tests: true,  has_ci: true,  has_readme: false, has_license: false } },
  { id: 'p3', name: 'NoPath',              signals: { has_tests: false } },          // no path -> skipped
  { id: 'p4', name: 'Clean', path: 'Clean', signals: { has_tests: true, has_ci: true, has_readme: true, has_license: true } },
] };

test('agencyProposals: one row per real gap, ordered, path-gated', () => {
  const r = agencyProposals(SEL);
  assert.deepEqual(r.map((x) => `${x.projectId}:${x.gap}`), ['p1:tests', 'p1:ci', 'p2:readme', 'p2:license']);
  assert.equal(r[0].projectName, 'Alpha');
  assert.equal(r[0].projectPath, 'Alpha');
  assert.equal(r[0].label, 'No tests');
  assert.match(r[0].seedPrompt, /test/i);
  assert.match(r[0].captureText, /^Alpha: /);
  assert.ok(r.every((x) => x.seedPrompt.length <= 200), 'seed prompts stay under the IPC truncation limit');
  assert.ok(!r.some((x) => x.projectId === 'p3'), 'projects without a path are skipped');
  assert.ok(!r.some((x) => x.projectId === 'p4'), 'clean projects produce nothing');
});

test('agencyProposals: only an explicit false is a gap; never throws', () => {
  // undefined/missing signal must NOT be treated as a gap (absence != known-absent)
  assert.deepEqual(agencyProposals({ projects: [{ id: 'x', name: 'X', path: 'X', signals: {} }] }), []);
  assert.deepEqual(agencyProposals({ projects: [{ id: 'x', name: 'X', path: 'X' }] }), []);
  assert.doesNotThrow(() => agencyProposals(null));
  assert.doesNotThrow(() => agencyProposals({}));
  assert.deepEqual(agencyProposals(null), []);
});
```

- [ ] **Step 2: Run — expect RED.** `node --test dashboard-v3/src/intel/agency.test.mjs`

- [ ] **Step 3: Implement `dashboard-v3/src/intel/agency.mjs`**

```js
// agency.mjs — PURE: turns a scan's signal gaps into proposals the UI can act on.
// No imports, no DOM, no Date.now() (same firewall as derive.mjs/foresight.mjs).
//
// A gap is ONLY an explicit `false`. A missing signal means "the scanner didn't
// determine it", which is not the same as "the project lacks it" — proposing
// work off an absent field would invent problems.
const GAPS = [
  { flag: 'has_tests',   gap: 'tests',   label: 'No tests',
    seed: 'Add a test suite to this project and make it pass.',
    capture: 'add a test suite' },
  { flag: 'has_ci',      gap: 'ci',      label: 'No CI',
    seed: 'Set up CI for this project so tests run on every push.',
    capture: 'set up CI' },
  { flag: 'has_readme',  gap: 'readme',  label: 'No README',
    seed: 'Write a README for this project: what it is, how to run it, how to deploy it.',
    capture: 'write a README' },
  { flag: 'has_license', gap: 'license', label: 'No license',
    seed: 'Add an appropriate open-source LICENSE file to this project.',
    capture: 'add a LICENSE' },
];

export function agencyProposals(selected) {
  const out = [];
  for (const p of (selected?.projects || [])) {
    // no path -> hq:claude-quest cannot resolve a cwd, so the row would be inert
    if (!p?.path) continue;
    const sig = p.signals || {};
    for (const g of GAPS) {
      if (sig[g.flag] !== false) continue;
      out.push({
        projectId: p.id,
        projectName: p.name,
        projectPath: p.path,
        gap: g.gap,
        label: g.label,
        seedPrompt: g.seed,
        captureText: `${p.name}: ${g.capture}`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect GREEN** (2/2, pristine).
- [ ] **Step 5: Commit** `fe: intel/agency — pure gap→proposal derivation (Epic D)`.

---

### Task 2: `claude:dispatch` action over the existing IPC

**Files:** Modify `dashboard-v3/src/core/actions.mjs`, `dashboard-v3/src/core/actions.test.mjs`.

**Interfaces (produced):** a registered action
`claude:dispatch` — `run: (ctx) => hq?.claudeQuest?.(ctx?.projectPath, ctx?.prompt)`, `enabled: (ctx) => !!ctx?.projectPath && !!ctx?.prompt`.

> **Why no new IPC:** `hq:claude-quest` already exists and is already in `IPC-CONTRACT.md`. This action is a renderer-side wrapper so the side effect routes through the one audited `dispatch()` path — same pattern as `capture:note`.

- [ ] **Step 1: Add the failing test** to `actions.test.mjs`

```js
test('claude:dispatch forwards path+prompt to hq.claudeQuest and needs both to enable', () => {
  _reset();
  const calls = [];
  initActions({ switchRealm: () => {}, ordered: () => [], hq: { claudeQuest: (p, t) => { calls.push([p, t]); return true; } } });
  assert.ok(resolve('claude:dispatch'));
  assert.equal(all({}).find((a) => a.id === 'claude:dispatch'), undefined);                      // neither
  assert.equal(all({ projectPath: 'A' }).find((a) => a.id === 'claude:dispatch'), undefined);    // prompt missing
  assert.ok(all({ projectPath: 'A', prompt: 'do it' }).find((a) => a.id === 'claude:dispatch')); // both
  const r = dispatch('claude:dispatch', { projectPath: 'A', prompt: 'do it' });
  assert.deepEqual(calls, [['A', 'do it']]);
  assert.equal(r.ok, true);
  // a missing preload method must no-op, not throw
  _reset();
  initActions({ ordered: () => [], hq: {} });
  assert.doesNotThrow(() => dispatch('claude:dispatch', { projectPath: 'A', prompt: 'x' }));
});
```

- [ ] **Step 2: Run — RED.** `node --test dashboard-v3/src/core/actions.test.mjs`
- [ ] **Step 3: Register it** in `initActions()`, beside `capture:note`:

```js
  // Hands a task to Claude INSIDE the target project: hq:claude-quest resolves
  // the project dir and opens a terminal running `claude "<prompt>"` there. The
  // channel already exists (IPC-CONTRACT.md) — this is only the audited wrapper.
  register({ id: 'claude:dispatch', label: 'Send Claude', run: (ctx) => hq?.claudeQuest?.(ctx?.projectPath, ctx?.prompt), enabled: (ctx) => !!ctx?.projectPath && !!ctx?.prompt });
```

- [ ] **Step 4: Run — GREEN** (full `actions.test.mjs` passes).
- [ ] **Step 5: Commit** `fe: core/actions — claude:dispatch over the existing hq:claude-quest (Epic D)`.

---

### Task 3: "Suggested actions" strip in FORGE (#5 + #7)

**Files:** Modify `dashboard-v3/src/realms/forge/view.js`, `dashboard-v3/styles/realms/forge.css`.

**Interfaces:** consumes `agencyProposals` (`../../intel/agency.mjs`) and `dispatch` (`../../core/actions.mjs`).

- [ ] **Step 1: READ `forge/view.js` first.** Note that it appends into `#stage` with no realm wrapper, how it builds its cards, and its `data:select` disposer. Follow that idiom; add no new subscription; do not restructure the realm.

- [ ] **Step 2: Build the strip.** A section headed `Suggested actions` listing the proposals (cap at the first **8** rows and, if more exist, append a plain `+N more` line — do NOT silently truncate). Each row shows the project name and the `label`, plus two buttons:
  - **`Send Claude`** → `dispatch('claude:dispatch', { projectPath, prompt: seedPrompt })`. On a truthy result, give feedback that matches reality: a terminal window opens — so the honest label is e.g. `Opened ▸`, not "Done". Disable the button after a successful dispatch (re-enable on failure) so a double-click can't spawn two terminals.
  - **`Add to ideas`** → `dispatch('capture:note', { text: captureText })`. **Honest async copy is mandatory:** this becomes a side-quest only after the next scan, and the capture handler reloads the app. Set an in-flight label before the await, and put the truth in the button `title` (e.g. `Adds to your Ideas feed — appears after the next scan; the dashboard will refresh`). Await the real result exactly as Med-Bay does: `const ok = await Promise.resolve(r.result); if (ok === false) throw …` and surface failure visibly (re-enable + an error label), never a silent reset.
  - **No dead controls:** if `window.hq?.claudeQuest` (or `captureSave`) is absent — the dev harness has no preload — render that button `disabled` with a `title` saying it needs the live app.
  - **Empty state:** no proposals → render nothing at all (do not show an empty section).
- [ ] **Step 3: `esc()` every dynamic value** (project names, labels, and anything placed into a `title` built by string interpolation).
- [ ] **Step 4: Style** in `styles/realms/forge.css` under the realm's existing scoping, design tokens only, buttons ≥ `var(--tap-min)`.
- [ ] **Step 5: Verify.** `node --check dashboard-v3/src/realms/forge/view.js`; selftest → `SELFTEST combos=105 errors=0 PASS`.
- [ ] **Step 6: Commit** `fe: forge — suggested-actions strip, real Claude dispatch + idea capture (Epic D #5/#7)`.

---

### Task 4: Wire the War Room's "Send Claude" + verify the epic + file the ASK

**Files:** Modify `dashboard-v3/src/realms/warroom/view.js`, `docs/sync/HANDOFF.md`, `docs/sync/IPC-CONTRACT.md`.

- [ ] **Step 1: Make the War Room button real.** It currently renders only when `hq-ff-dispatch === 'on'` and then `console.warn`s ("not wired yet"). Now that `claude:dispatch` exists, wire it: `dispatch('claude:dispatch', { projectPath, prompt })` where the prompt is built from the threat (e.g. `Rotate the 4 exposed secrets in this project.` / `Commit and push the 32 uncommitted files in this project.`). The threat rows carry `projectId` — resolve the project's `path` from the scan context (the realm already has it). If the project or its path can't be resolved, render the button disabled with a title. Remove the "coming in Phase 2" copy. Keep `hq-ff-dispatch` as the gate but **default it ON** now that it does something real.
- [ ] **Step 2: File the spell-cast ASK.** Add a `Pending changes` note to `docs/sync/IPC-CONTRACT.md`: `hq:spell-cast` would need an additive `opts.cwd` (containment-checked like `resolveProjectPath`) before a spell could be recommended as a fix for a specific project. Explain that Epic D dropped feature #6 for this reason.
- [ ] **Step 3: Append the HANDOFF entry** (frontend lane): Epic D landed #5 + #7; **#6 deliberately NOT shipped** (cast can't target a project cwd + `spellFit` keyword matching produces false matches such as `architecture-decision-records` for "ci" and `caveman` for "license"; zero spells exist for license/readme); no new IPC (reuses `hq:claude-quest` + `hq:capture-save`); note that capture still triggers the main-side `spawnSync` + `win.reload()`.
- [ ] **Step 4: Verify the epic.**
  - `node --check` every changed JS file.
  - `node --test dashboard-v3/src/intel/agency.test.mjs dashboard-v3/src/core/actions.test.mjs dashboard-v3/src/intel/foresight.test.mjs dashboard-v3/src/intel/derive.test.mjs` → all green, pristine.
  - Selftest → `SELFTEST combos=105 errors=0 PASS`.
  - **The selftest is synchronous and proves nothing about the click paths.** Write a THROWAWAY harness in a temp dir (NOT the repo): (a) default preload → confirm the strip renders, count rows, and confirm both buttons are disabled-with-title; (b) with `HQ_V3_PRELOAD=v2` → confirm the buttons render ENABLED and that `claude:dispatch` resolves through the real bridge. **Do NOT actually click "Send Claude" against a real project** — it spawns a terminal and starts an agent; assert the wiring by inspecting the resolved action/ctx instead. Delete the harness; report observations.
- [ ] **Step 5: Commit** `fe: warroom — wire Send Claude to the real dispatch (Epic D #5)` and a `meta:` commit for the docs.

---

## Self-Review

**Spec coverage (charter Epic D):** #5 dispatch-Claude → Tasks 2/3/4, built on the EXISTING `hq:claude-quest` (the charter's claim that a new `hq:spawn-session` IPC was required is wrong — corrected here). #7 auto-quests → Task 3's `Add to ideas`, routed through `capture:note` → brain-dump → `assemble.mjs` side-quest, with mandatory honest async copy (the charter's "written through quest-overrides" path does not exist — there is no quest-create IPC). #6 spell recs → **explicitly not shipped**, with the technical reason recorded and an additive `opts.cwd` ASK filed (Task 4).

**Placeholder scan:** no TBD/TODO. Tasks 1 and 2 carry complete test + implementation code. Tasks 3 and 4 specify exact interfaces, actions, copy rules, empty/disabled states, and commands; their markup is specified by behavior + host-realm idiom (which the implementer reads first) rather than pre-written HTML that would fight forge's existing conventions.

**Type consistency:** `agencyProposals(selected)` and its row shape are identical across Task 1 (definition), Task 3 (use), and the tests. `dispatch(id, ctx)` / `register({id,label,run,enabled})` match `actions.mjs`. `claude:dispatch` ctx is `{projectPath, prompt}` in Tasks 2, 3 and 4. `capture:note` ctx is `{text}`, matching Epic C. Selftest is 105 throughout.

**Invariant check:** additive; no realm added; no new IPC channel; no contract or main-process change; every code file under `dashboard-v3/`; purity preserved (`agency.mjs` imports nothing); all controls either act for real or render disabled with a reason; the one asynchronous effect (capture → side-quest) is stated in the UI rather than disguised as instant.
