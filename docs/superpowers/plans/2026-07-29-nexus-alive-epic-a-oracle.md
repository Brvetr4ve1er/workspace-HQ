# NEXUS ALIVE — Epic A · The Oracle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn NEXUS's home screen from a passive read-out into a console that names the single highest-leverage move right now and gives one button to act on it — powered by the tested pure `derive.oracle()` brain, routed through the one audited `dispatch()` path.

**Architecture:** `derive.oracle(bundle, selected, now)` (Phase-0 substrate, already built + 11/11 unit-green) returns the top-weighted candidate `{ action, label, reason, weight, target }`. A DOM-free `oracle-logic.mjs` maps that result to a registered action id + button copy (unit-tested). `oracle-card.js` assembles the hero card + a night/rest fallback. `roundtable/view.js` renders the Oracle in place of the legacy `computeOneThing` hero **when the `hq-ff-oracle` flag is on** (off → today's exact behavior — one-line revert). `ambient.js` mirrors a one-line version into the right rail. No new realm, no data-contract change, no main-process change.

**Tech Stack:** Electron 32 (Chromium 128, Node ~20), vanilla-JS ESM over `file://`, no build step. Pure-module tests: `node --test` (Node 20+). Mount integrity: `dev-main.js --smoke --selftest`. Headless visual: `tools/nexus-shot.js`.

## Global Constraints

- **Additive-only contract.** No change to `latest.json`/sidecar shapes. The Oracle reads only existing fields (`project.metrics.git_safety.dirty`, `project.metrics.risk_security.secrets_found`, `project.activity.days_since_commit`, `quest.{status,tier,id,title,project_id}`) — all consumed inside `derive.oracle()`, already ground-truthed.
- **v2 rollback stays one flip away.** `data/.ui-version → "v2"` must still fully revert. Nothing here makes v3 the only bootable renderer.
- **IPC is frozen & additive-only.** No new `window.hq` channel. The Oracle routes through the **existing** registered actions only: `go:<realm>`, `scan:now` (→`hq.runScan`), `capture:idea` (→`hq.capture`).
- **Lane ownership: frontend owns `dashboard-v3/`.** Every file in this plan is under `dashboard-v3/`. No `collector/`/`schema/`/`spellbook/` edits; no `dashboard/main.js`/`preload.js` edits.
- **Do NOT reimplement one-thing ranking.** `dashboard/lib/one-thing.js` is the READ-ONLY v2 truth (`computeOneThing` is re-exported via `src/realms/roundtable/one-thing.js`). The Oracle is a *parallel* brain (`derive.oracle`), never a copy of it.
- **Selftest is the tripwire.** `SELFTEST combos=98 errors=0 PASS` (14 realms × 7 themes) must stay green after every task. Epic A adds **no** realm — the count stays **98**.
- **Copy stays plain** for the `nexus`/`daylight` themes (plain register). Game-flavor lives in behavior + motion, and only in the `default`/`nightfall` registers.
- **Flag-gated + reversible.** Ships behind `hq-ff-oracle` (default **on**, killable by setting it to `'off'` in `localStorage`). Flag off restores the legacy One-Thing hero exactly.

**Verified seams (do not re-derive):**
- `derive.oracle(bundle, selected, now)` — `dashboard-v3/src/intel/derive.mjs:10`. Currently emits `action ∈ {'commit','quest'}` or `null`; interface reserves `{'capture','scan','rest'}`. `target = { realmId, projectId?, questId? }`.
- `dispatch(id, ctx)` — `dashboard-v3/src/core/actions.mjs:29`. Registered ids: `go:<realm.id>`, `scan:now`, `capture:idea`, `quest:done`, `cast`.
- `openDrawer(p, prevP, data)` — `dashboard-v3/src/ui/components.js:287`. `deriveScanContext(data) → { S, prev, a, projById, prevProj, isLatest }` — `components.js:91`.
- roundtable `render()` already re-runs on the `data:select` bus event (`roundtable/view.js:349`) — the Oracle refreshes on scan-select for free. `ambient.js` likewise re-renders on `data:select` (`ambient.js:83`).
- `LX(k)` resolves against the active theme register, always falling back through `LEXICONS.default` (`lexicon.js`). Adding a key to `default` + `plain` + `nightfall` covers all 7 themes.
- Roundtable imports already present: `el, esc` (util), `sfx, aos, openDrawer, deriveScanContext, castSpell` (components), `switchRealm` (shell), `computeOneThing` (one-thing).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dashboard-v3/src/realms/roundtable/oracle-logic.mjs` | **Pure** (no DOM): `oracleActionId(oracle)` → registered dispatch id; `oracleButtonMeta(oracle)` → `{label, icon}`. Headless-testable. | 1 |
| `dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs` | `node --test` over the adapter. | 1 |
| `dashboard-v3/src/realms/roundtable/oracle-card.js` | DOM builder: `buildOracleCard(oracle, ctx)`, `buildRestCard(now)`, `oracleFlagOn()`. Consumes oracle-logic + `dispatch` + `openDrawer`. | 2 |
| `dashboard-v3/src/realms/roundtable/view.js` | Render the Oracle hero (flag on) in place of the legacy One-Thing block (flag off). | 2 |
| `dashboard-v3/styles/realms/roundtable.css` | `.oracle-card` styling on the design-system tokens. | 2 |
| `dashboard-v3/src/core/ambient.js` | One-line Oracle mirror section (flag-gated). | 3 |
| `dashboard-v3/src/lexicon/lexicons.js` | `amb_next` key in `default` + `plain` + `nightfall`. | 3 |

---

### Task 1: `oracle-logic.mjs` — pure action adapter

**Files:**
- Create: `dashboard-v3/src/realms/roundtable/oracle-logic.mjs`
- Test: `dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs`

**Interfaces:**
- Consumes: an `oracle` result object `{ action, label, reason, weight, target:{realmId, projectId?, questId?} } | null` from `derive.oracle()`.
- Produces:
  - `oracleActionId(oracle) → string | null` — the **registered** `dispatch()` id that enacts the recommendation: `capture → 'capture:idea'`, `scan → 'scan:now'`, everything else (`commit`/`quest`/`rest`) → `'go:' + target.realmId` (falls back to `'go:roundtable'`). `null` in → `null`.
  - `oracleButtonMeta(oracle) → { label, icon }` — primary-button copy per action; unknown/`null` → `{ label:'Open', icon:'▸' }`.

- [ ] **Step 1: Write the failing test**

```js
// oracle-logic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oracleActionId, oracleButtonMeta } from './oracle-logic.mjs';

test('oracleActionId maps each action to a registered dispatch id', () => {
  assert.equal(oracleActionId({ action:'commit', target:{ realmId:'forge', projectId:'p1' } }), 'go:forge');
  assert.equal(oracleActionId({ action:'quest',  target:{ realmId:'hunts', questId:'q1' } }),   'go:hunts');
  assert.equal(oracleActionId({ action:'quest',  target:{ realmId:'forge', projectId:'p2' } }), 'go:forge'); // secrets quest lives on forge
  assert.equal(oracleActionId({ action:'capture', target:{ realmId:'roundtable' } }), 'capture:idea');
  assert.equal(oracleActionId({ action:'scan',    target:{ realmId:'roundtable' } }), 'scan:now');
  assert.equal(oracleActionId({ action:'rest',    target:{} }), 'go:roundtable'); // missing realmId → safe home
  assert.equal(oracleActionId(null), null);
});

test('oracleButtonMeta gives per-action copy; unknown/null → generic Open', () => {
  assert.equal(oracleButtonMeta({ action:'commit' }).label, 'Review & commit');
  assert.equal(oracleButtonMeta({ action:'quest'  }).label, 'Open task');
  assert.equal(oracleButtonMeta({ action:'capture'}).label, 'Capture');
  assert.equal(oracleButtonMeta({ action:'scan'   }).label, 'Scan now');
  assert.deepEqual(oracleButtonMeta({ action:'???' }), { label:'Open', icon:'▸' });
  assert.deepEqual(oracleButtonMeta(null),             { label:'Open', icon:'▸' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs`
Expected: FAIL — module missing / exports undefined. (Invoke the test **file** directly, never a bare directory — Node's directory test-discovery is inconsistent across versions.)

- [ ] **Step 3: Write the implementation**

```js
// oracle-logic.mjs — PURE adapter from a derive.oracle() result to the one
// audited dispatch path. No DOM, no imports — unit-testable under node --test,
// mirroring the intel/ purity firewall.

// action → primary-button copy. Kept here (not in the DOM builder) so the
// wording is asserted by a headless test.
const BTN = {
  commit:  { label: 'Review & commit', icon: '◆' },
  quest:   { label: 'Open task',       icon: '▸' },
  capture: { label: 'Capture',         icon: '✎' },
  scan:    { label: 'Scan now',        icon: '⟳' },
  rest:    { label: 'Open',            icon: '▸' },
};

// The registered dispatch id that enacts the recommendation. capture/scan hit
// their own verbs; every navigational action routes through go:<realm> so the
// side-effect still passes through core/actions.dispatch (the audited seam).
export function oracleActionId(oracle) {
  if (!oracle) return null;
  switch (oracle.action) {
    case 'capture': return 'capture:idea';
    case 'scan':    return 'scan:now';
    default:        return 'go:' + (oracle.target?.realmId || 'roundtable');
  }
}

export function oracleButtonMeta(oracle) {
  return (oracle && BTN[oracle.action]) || { label: 'Open', icon: '▸' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs`
Expected: PASS (2/2), output pristine.

- [ ] **Step 5: Commit**

```bash
git add dashboard-v3/src/realms/roundtable/oracle-logic.mjs dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs
git commit -m "fe: oracle-logic — pure action adapter for the Oracle (Epic A)"
```

---

### Task 2: `oracle-card.js` + wire the hero into roundtable (flag-gated)

**Files:**
- Create: `dashboard-v3/src/realms/roundtable/oracle-card.js`
- Modify: `dashboard-v3/src/realms/roundtable/view.js` (replace the `computeOneThing` hero block with a flag branch)
- Modify: `dashboard-v3/styles/realms/roundtable.css` (append `.oracle-card` rules)

**Interfaces:**
- Consumes: `oracleActionId`, `oracleButtonMeta` (Task 1); `dispatch` (`core/actions.mjs`); `oracle` (`intel/derive.mjs`); `el, esc` (`ui/util.js`); `sfx, openDrawer, deriveScanContext` (`ui/components.js`).
- Produces:
  - `oracleFlagOn() → boolean` — `true` unless `localStorage['hq-ff-oracle'] === 'off'` (guarded for headless).
  - `buildOracleCard(oracle, ctx) → HTMLElement` — the hero: eyebrow + `label` + `reason` + one primary button that `dispatch(oracleActionId(oracle), ctx)`es and, for `commit` with a `projectId`, also opens that project's drawer.
  - `buildRestCard(now) → HTMLElement` — the calm empty/rest state when `oracle()` is `null` (night-aware copy).

- [ ] **Step 1: Write `oracle-card.js`**

```js
// oracle-card.js — the Oracle hero for the home realm. Renders derive.oracle()'s
// single "do this now" as label + reason + ONE primary button routed through the
// audited dispatch() seam. DOM lives here; the action mapping + copy come from
// the headless-tested oracle-logic.mjs. Flag: hq-ff-oracle (default on).
import { el, esc } from '../../ui/util.js';
import { sfx, openDrawer, deriveScanContext } from '../../ui/components.js';
import { dispatch } from '../../core/actions.mjs';
import { oracleActionId, oracleButtonMeta } from './oracle-logic.mjs';

// Default ON; killable with localStorage.setItem('hq-ff-oracle','off').
export function oracleFlagOn() {
  try { return localStorage.getItem('hq-ff-oracle') !== 'off'; } catch { return true; }
}

export function buildOracleCard(oracle, ctx) {
  const meta = oracleButtonMeta(oracle);
  const card = el('div', 'oracle-card');
  card.setAttribute('data-action', oracle.action || '');
  card.innerHTML = `
    <div class="oc-eyebrow">◎ DO THIS NOW · everything else can wait</div>
    <div class="oc-label">${esc(oracle.label || '')}</div>
    <div class="oc-reason">${esc(oracle.reason || '')}</div>
    <div class="oc-act"><button class="oc-go">${esc(meta.icon)} ${esc(meta.label)} ▸</button></div>`;
  card.querySelector('.oc-go').onclick = () => {
    const id = oracleActionId(oracle);
    if (id) dispatch(id, ctx);                       // audited nav / side-effect
    // commit points at a project — open its drawer so the commit UI is one motion.
    if (oracle.action === 'commit' && oracle.target?.projectId) {
      const { projById, prevProj } = deriveScanContext(ctx.data);
      const p = projById[oracle.target.projectId];
      if (p) openDrawer(p, prevProj[oracle.target.projectId], ctx.data);
    }
    sfx('blip');
  };
  return card;
}

// Calm state when nothing is on fire (oracle() returned null). Night-aware copy.
export function buildRestCard(now) {
  const hour = new Date(now).getHours();
  const night = hour >= 22 || hour < 6;
  const card = el('div', 'oracle-card rest');
  card.innerHTML = `
    <div class="oc-eyebrow">◎ ${night ? 'ALL QUIET' : 'CLEAR'}</div>
    <div class="oc-label">${night ? 'Late and clear. Rest.' : 'Nothing on fire.'}</div>
    <div class="oc-reason">${night
      ? 'No uncommitted work, no exposed secrets, no red tasks. Come back tomorrow.'
      : 'Everything is committed and the board is clear. Pick anything below, or take the win.'}</div>`;
  return card;
}
```

- [ ] **Step 2: Wire the hero into `roundtable/view.js`** — replace the existing One-Thing block (currently `const otAction = … ov.appendChild(otc);`, the block that starts with the `// The One Thing:` comment) with this flag branch. Add the two imports at the top beside the existing realm imports:

```js
import { oracle } from '../../intel/derive.mjs';
import { buildOracleCard, buildRestCard, oracleFlagOn } from './oracle-card.js';
```

Replace the One-Thing block with:

```js
  // The Oracle — the single live "do this now", from the tested pure brain
  // (derive.oracle) and routed through dispatch(). Flag hq-ff-oracle OFF falls
  // back to the legacy One-Thing hero (unchanged), so this is a one-flip revert.
  if (oracleFlagOn()) {
    const o = isLatest ? oracle(D, S, new Date().toISOString()) : null;
    const hero = o ? buildOracleCard(o, ctx) : buildRestCard(new Date().toISOString());
    aos(hero, 'fade-up');
    ov.appendChild(hero);
  } else {
    // legacy One-Thing hero (v2 computeOneThing truth) — kept intact behind the flag
    const otAction = (typeof computeOneThing === 'function' && isLatest) ? computeOneThing(S) : null;
    if (otAction) {
      const otc = el('div', 'onething-card');
      otc.innerHTML = `<div class="otc-eyebrow">◎ THE ONE THING · everything else can wait</div>
        <div class="otc-title">${esc(otAction.title)}</div>
        ${otAction.project_name ? `<div class="otc-proj">↳ ${esc(otAction.project_name)}</div>` : ''}
        <div class="otc-reason">${esc(otAction.reason)}</div>
        <div class="otc-actions"><button class="otc-focus">◎ FOCUS</button></div>`;
      otc.querySelector('.otc-focus').onclick = () => enterOneThing(otAction);
      aos(otc, 'fade-up');
      ov.appendChild(otc);
    }
  }
```

(Leave the existing `computeOneThing` / `enterOneThing` imports in place — the else-branch still uses them.)

- [ ] **Step 3: Append `.oracle-card` styles to `styles/realms/roundtable.css`** (design-system tokens; nexus-scoped accent, theme-safe base):

```css
/* ==== THE ORACLE — the single "do this now" hero (Epic A) =================
   Sits where the One-Thing card did (after daily3). Built on the shared
   spacing/type tokens; the accent seam borrows the semantic --active. */
.realm-roundtable .oracle-card {
  margin: var(--space-2) 0 var(--space-5);
  padding: var(--space-5) var(--space-5) var(--space-4);
  background: linear-gradient(168deg, var(--card-hi), var(--card));
  border: 1px solid var(--frame);
  border-left: 3px solid var(--active, var(--gold));
  border-radius: 14px;
  box-shadow: 0 16px 40px -28px #000;
}
.realm-roundtable .oracle-card .oc-eyebrow {
  font-family: var(--term); font-size: var(--fs-xs); font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--faint);
}
.realm-roundtable .oracle-card .oc-label {
  font-family: var(--term); font-size: var(--fs-lg); font-weight: 600;
  color: var(--text); line-height: 1.25; margin-top: var(--space-2);
}
.realm-roundtable .oracle-card .oc-reason {
  font-family: var(--term); font-size: var(--fs-sm); color: var(--muted);
  line-height: 1.5; margin-top: var(--space-1);
}
.realm-roundtable .oracle-card .oc-act { margin-top: var(--space-4); }
.realm-roundtable .oracle-card .oc-go {
  font-family: var(--term); font-size: var(--fs-sm); font-weight: 600;
  letter-spacing: .02em; cursor: pointer; min-height: var(--tap-min);
  padding: var(--space-2) var(--space-4); border-radius: 8px;
  color: var(--ink, #05060a); background: var(--active, var(--gold));
  border: 1px solid var(--active, var(--gold));
}
.realm-roundtable .oracle-card .oc-go:hover { filter: brightness(1.08); }
/* rest state: no accent bar, calmer */
.realm-roundtable .oracle-card.rest { border-left-color: var(--frame); }
.realm-roundtable .oracle-card.rest .oc-label { color: var(--muted); }
```

- [ ] **Step 4: Syntax-check the touched JS**

Run: `node --check dashboard-v3/src/realms/roundtable/oracle-card.js && node --check dashboard-v3/src/realms/roundtable/view.js`
Expected: both print nothing (exit 0).

- [ ] **Step 5: Selftest gate**

Run: `dashboard/node_modules/electron/dist/electron.exe dashboard-v3/dev-main.js --smoke --selftest`
Expected: `[v3] SELFTEST combos=98 errors=0 PASS`. If `errors>0` or an import error, STOP and report — do not commit a red selftest.

- [ ] **Step 6: Commit**

```bash
git add dashboard-v3/src/realms/roundtable/oracle-card.js dashboard-v3/src/realms/roundtable/view.js dashboard-v3/styles/realms/roundtable.css
git commit -m "fe: Oracle hero card in roundtable, flag hq-ff-oracle (Epic A)"
```

---

### Task 3: Ambient-rail one-line mirror + lexicon key

**Files:**
- Modify: `dashboard-v3/src/lexicon/lexicons.js` (add `amb_next` to `default`, `plain`, `nightfall`)
- Modify: `dashboard-v3/src/core/ambient.js` (flag-gated Oracle section)

**Interfaces:**
- Consumes: `oracle` (`intel/derive.mjs`); existing ambient `data`, `deriveScanContext`, `LX`, `el/esc`, `sec()` helper.
- Produces: a new right-rail section (label `LX('amb_next')`) showing `oracle().label` on one line — rendered only when `hq-ff-oracle` is on, the scan is latest, and a result exists.

- [ ] **Step 1: Add the lexicon key** — in `dashboard-v3/src/lexicon/lexicons.js`, add one line to each of the three registers, beside the existing `amb_whisper` entries:
  - `plain`: `amb_next: 'DO NOW',`
  - `default`: `amb_next: 'DO NOW',`
  - `nightfall`: `amb_next: 'THE OMEN',`

  (`default` is always the merge base in `setLexTheme`, so `arcade`/`okami`/`numidea`/`ops` inherit `'DO NOW'`.)

- [ ] **Step 2: Add the mirror to `ambient.js`** — add the import beside the others at the top:

```js
import { oracle } from '../intel/derive.mjs';
```

Add this helper above `render()` (self-contained flag read — ambient is a core module and must not depend on a realm file):

```js
// One-line Oracle mirror. Flag-gated (hq-ff-oracle, default on) and latest-only.
// Returns '' when off / not latest / nothing actionable, so the section is
// suppressed entirely rather than showing a hollow slot.
function oracleHtml(S) {
  let on = true; try { on = localStorage.getItem('hq-ff-oracle') !== 'off'; } catch {}
  if (!on || !S || !data.isLatest) return '';
  let o = null; try { o = oracle(data.bundle, S, new Date().toISOString()); } catch {}
  if (!o) return '';
  return `<div class="am-next">${esc(o.label)}</div>`;
}
```

In `render()`, add the section immediately after the Working-Now section (`sec(`◉ ${LX('working_now')}`, …)`), gated so it only appears when non-empty:

```js
  const oh = oracleHtml(S);
  if (oh) sec(LX('amb_next'), oh);
```

- [ ] **Step 3: Syntax-check**

Run: `node --check dashboard-v3/src/core/ambient.js && node --check dashboard-v3/src/lexicon/lexicons.js`
Expected: exit 0, no output.

- [ ] **Step 4: Selftest gate**

Run: `dashboard/node_modules/electron/dist/electron.exe dashboard-v3/dev-main.js --smoke --selftest`
Expected: `[v3] SELFTEST combos=98 errors=0 PASS`.

- [ ] **Step 5: Commit**

```bash
git add dashboard-v3/src/core/ambient.js dashboard-v3/src/lexicon/lexicons.js
git commit -m "fe: Oracle ambient-rail mirror + amb_next lexicon (Epic A)"
```

---

### Task 4: Verify live + close out

**Files:** none (verification + handoff only)

- [ ] **Step 1: Full unit suite green**

Run: `node --test dashboard-v3/src/intel/derive.test.mjs dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs dashboard-v3/src/core/actions.test.mjs dashboard-v3/src/core/notify.test.mjs`
Expected: all pass (derive 11 + oracle-logic 2 + actions 4 + notify 3).

- [ ] **Step 2: Headless screenshot of the Oracle hero**

Run: `dashboard/node_modules/electron/dist/electron.exe dashboard-v3/tools/nexus-shot.js`
Then open `dashboard-v3/tools/shots/nexus_roundtable.png` and confirm: the Oracle hero renders at the top of the decision surface with an eyebrow, a bold `label`, a `reason` line, and one primary button. Confirm the ambient rail shows the `DO NOW` one-liner. (If the live scan has nothing actionable, the rest card shows instead — verify by temporarily toggling, or accept the rest state as correct.)

- [ ] **Step 3: Revert-path smoke** — confirm the flag is a clean revert: `localStorage.setItem('hq-ff-oracle','off')` in the running app's devtools → reload → the legacy One-Thing card returns and no `.oracle-card` renders. (Documented check; no commit.)

- [ ] **Step 4: Append the HANDOFF entry**

Append a `## 2026-07-29 · FROM frontend …` block to `docs/sync/HANDOFF.md`: Epic A landed (3 fe commits), no contract/IPC/main change, flag `hq-ff-oracle` default on, selftest 98/98. Note the reconciliation (Oracle replaces the One-Thing hero behind the flag; `dashboard/lib/one-thing.js` untouched).

- [ ] **Step 5: Commit the handoff**

```bash
git add docs/sync/HANDOFF.md
git commit -m "meta: handoff — NEXUS ALIVE Epic A (The Oracle) landed"
```

---

## Self-Review

**Spec coverage (Epic A charter):**
- ✅ "single card shows `label` + `reason` + one primary button that `dispatch()`es `oracle.action`" → Task 2 `buildOracleCard` + `oracleActionId`.
- ✅ "Commit→forge+project drawer, Quest→hunts" → Task 2 button handler (dispatch `go:<target.realmId>` + `openDrawer` for commit).
- ✅ "consume `derive.oracle()` + `core/actions.dispatch()`" → Tasks 1–2.
- ✅ "mirror a one-line version into the ambient rail" → Task 3.
- ✅ "Refreshes on scan-select change (subscribe to the data bus)" → roundtable + ambient already re-render on `data:select`; documented, no new subscription.
- ✅ "Empty/rest state at night" → Task 2 `buildRestCard` (night-aware).
- ✅ "Flag: `hq-ff-oracle`" → `oracleFlagOn()` + ambient inline read.
- ✅ "Gate: selftest 98/98 + captured screenshot reviewed" → Tasks 2/3 selftest + Task 4 nexus-shot.

**Placeholder scan:** every step carries real code or an exact command. No TBD/TODO. The rest card, the flag helper, the CSS, the lexicon values, and the two failing-test assertions are all concrete.

**Type consistency:** `oracleActionId(oracle)` / `oracleButtonMeta(oracle)` signatures identical across Task 1 (def), Task 2 (use), and the test. `oracle` result shape (`action`, `label`, `reason`, `target.{realmId,projectId,questId}`) matches `derive.oracle()` in `derive.mjs`. `dispatch(id, ctx)` and `openDrawer(p, prevP, data)` match the verified seams. Selftest count is stated as 98 everywhere (no realm added).

**Invariant check:** additive (no contract/IPC/main change); flag-gated + one-flip reversible; v2 rollback untouched; every file under `dashboard-v3/` (frontend lane); the v2 `computeOneThing` truth is read, never rewritten.
