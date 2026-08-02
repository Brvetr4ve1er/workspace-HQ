# NEXUS ALIVE — Epic C · Foresight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface the three already-built, already-tested Foresight derivations so NEXUS stops only reporting the present and starts projecting forward: where your XP is heading (#3), what junk is quietly accumulating (#4), and which achievements are one push from unlocking (#19).

**Architecture:** The brain exists — `derive.momentum()`, `derive.anomalies()`, `derive.achievementNudges()` are pure and unit-green. This epic adds (a) one pure presentation-adapter module `intel/foresight.mjs` that turns those raw outputs into display-ready shapes (headless-testable), and (b) three thin UI surfaces that consume it: a forecast card in **atlas**, a cleanup panel in **medbay**, and a shared `ui/nudge.js` strip. No new realm, no contract change, no main-process change.

**Tech Stack:** Electron 32 (Chromium 128, Node ~20), vanilla-JS ESM over `file://`, no build step. Pure-module tests: `node --test`. Mount integrity: `dev-main.js --smoke --selftest`.

## Global Constraints

- **Additive-only.** No `latest.json`/sidecar shape change. No IPC channel added or altered. No `dashboard/main.js` / `preload.js` edit. Everything under `dashboard-v3/`.
- **Selftest stays 105.** `SELFTEST combos=105 errors=0 PASS` (15 realms × 7 themes). Epic C adds **no** realm.
- **Lifecycle.** Realms mount/unmount 105× per selftest. Anything created on mount (listener, rAF, observer, subscription) is torn down in `unmount()` AND before each re-render. Preserve each realm's existing `offSelect` disposer; add no new subscriptions.
- **XSS.** Every dynamic value interpolated into `innerHTML` goes through `esc()`.
- **Purity firewall.** `intel/foresight.mjs` has NO imports, no DOM, no `Date.now()`, no globals — `now` and any lookup table are injected as arguments. It must be testable under `node --test`.
- **No dead buttons.** Every control shipped must do something real (the Epic B "Send Claude" lesson). If a seam doesn't exist, build it or don't ship the control.
- **Copy stays plain** for nexus/daylight (the plain lexicon register). No RPG prose in these surfaces.
- **Run tests by FILE, never a bare directory** — this environment's Node mis-discovers directory tests and reports false failures.

**Verified ground truth (live `data/latest.json`, 2026-08-02 — do not re-derive):**
- `account.xp_to_next` = **379**; `account.xp` = 2021; `account.level` = 7. `trends.xp` = **44** points of `{d,v}`. → `momentum()` produces a real slope + ETA.
- `inventory` = `{ vaults, clones, trivial, empty, anomalies, duplicates }`. Live counts: **clones 10, duplicates 1, empty 2**. `clones[]` items are `{name, origin, dirty, diverged}`; `duplicates[]` are `{type, detail, severity}`; `empty[]` are **plain strings**. Σ `projects[].disk.reclaimable_bytes` = **1,960,209,832** (~1.96 GB).
- Achievements are **TOP-LEVEL `S.achievements`**, NOT `account.achievements` (normalized at `src/core/data.js:64`). 22 total, 7 unlocked, 13 locked-with-progress, **3 currently ≥50%**: `version_control` 7/8, `secret_free` 5/8, `documented` 6/8. Items are `{id, unlocked, progress:{have,need}}` — **there is no `title` field**, so `derive`'s `label` falls back to the raw id.
- Friendly labels live in the **exported `ACH` map at `src/ui/components.js:207`** — `{ name, icon, desc }` keyed by achievement id; it covers all three live nudge ids. Reuse it; do not author a second map.
- `achievements` includes `debt_zero` with `progress.need = 0`; `derive.achievementNudges()`'s `need > 0` guard already excludes it (no div-by-zero).
- **`window.hq.capture` DOES NOT EXIST.** `dashboard/preload.js` exposes only `captureSave(text)` and `captureCancel()`. The registered action `capture:idea` calls `hq?.capture?.()` and is therefore a **known no-op** (see the comment at `src/core/actions.mjs:48-50`). Task 3 adds a real `capture:note` action instead. Do NOT wire any new control to `capture:idea`.
- Host realms: `atlas/view.js` (157 lines, `render()` + `offSelect` disposer, uses `chartCard`/`aosKids`/`aosRefresh`), `medbay/view.js` (286 lines, `render()` + `offSelect`, sections built by `renderAnatomy`/`renderTriage`/`renderTreatments`).
- Design tokens in `styles/tokens.css`: `--space-0..7`, `--fs-xs..2xl`, `--tap-min`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dashboard-v3/src/intel/foresight.mjs` | **Pure** presentation adapters: `forecastLine`, `anomalyGroups`, `nudgeRows`. No imports/DOM. | 1 |
| `dashboard-v3/src/intel/foresight.test.mjs` | `node --test` suite. | 1 |
| `dashboard-v3/src/realms/atlas/view.js` + `styles/realms/atlas.css` | Momentum forecast card (#3). | 2 |
| `dashboard-v3/src/core/actions.mjs` + `actions.test.mjs` | New `capture:note` action (real `captureSave` seam). | 3 |
| `dashboard-v3/src/realms/medbay/view.js` + `styles/realms/medbay.css` | Anomaly cleanup panel (#4). | 3 |
| `dashboard-v3/src/ui/nudge.js` + `styles/components.css` | Shared achievement-nudge strip (#19), mounted in atlas. | 4 |

---

### Task 1: `intel/foresight.mjs` — pure presentation adapters

**Files:** Create `dashboard-v3/src/intel/foresight.mjs` and `dashboard-v3/src/intel/foresight.test.mjs`.

**Interfaces (produced — later tasks depend on these exact names):**
- `forecastLine(m, now) → { trend, slopePerDay, etaLabel, etaISO }`. `m` is `derive.momentum()`'s output. `trend ∈ 'rising'|'flat'|'falling'`: rising if `xpSlope > 0.5`, falling if `xpSlope < -0.5`, else flat. `slopePerDay` = `xpSlope` rounded to 1dp. `etaLabel` = `~N days` when `etaDays` is a finite positive number (`N` = `Math.ceil(etaDays)`, and the literal string `~1 day` when N is 1), else `'—'`. `etaISO` = `m.etaNextLevel` or `null`. Never throws on `{}`/`null`.
- `anomalyGroups(a) → { total, reclaimableLabel, groups }`. `a` is `derive.anomalies()`'s output. `groups` = array of `{ kind, count, items }` for each of `clone`/`duplicate`/`empty` **that has count > 0**, ordered clone → duplicate → empty. `items` are the matching `a.items[]` entries. `total` = `a.items.length`. `reclaimableLabel` = human bytes: `< 1024` → `'N B'`; else KB/MB/GB with 1dp and a trailing unit (e.g. `'1.8 GB'`); `0` → `'0 B'`.
- `nudgeRows(nudges, labelFor) → [{ id, label, icon, have, need, pct }]`. `nudges` is `derive.achievementNudges()`'s output. `labelFor` is an INJECTED lookup `(id) => ({name, icon}) | undefined` (keeps this module pure — the real `ACH` map is passed in by the caller). `label` = `labelFor(id)?.name || id`; `icon` = `labelFor(id)?.icon || ''`; `pct` = `Math.round(have/need*100)` clamped `[0,100]`. Sorted by `pct` DESC. Never throws on `null`.

- [ ] **Step 1: Write the failing test** — `dashboard-v3/src/intel/foresight.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastLine, anomalyGroups, nudgeRows } from './foresight.mjs';

test('forecastLine: rising slope yields a day ETA; flat/negative yields no ETA', () => {
  const r = forecastLine({ xpSlope: 10, etaDays: 3.2, etaNextLevel: '2026-08-05T00:00:00.000Z' });
  assert.equal(r.trend, 'rising');
  assert.equal(r.slopePerDay, 10);
  assert.equal(r.etaLabel, '~4 days');
  assert.equal(r.etaISO, '2026-08-05T00:00:00.000Z');

  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).trend, 'flat');
  assert.equal(forecastLine({ xpSlope: -3, etaDays: null, etaNextLevel: null }).trend, 'falling');
  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).etaLabel, '—');
  assert.equal(forecastLine({ xpSlope: 5, etaDays: 0.4, etaNextLevel: 'x' }).etaLabel, '~1 day');
  assert.doesNotThrow(() => forecastLine(null));
  assert.doesNotThrow(() => forecastLine({}));
});

test('anomalyGroups: only non-empty groups, in order, with human bytes', () => {
  const a = {
    clones: 2, duplicates: 1, empty: 0, reclaimableBytes: 1960209832,
    items: [
      { label: 'playwright', kind: 'clone' },
      { label: 'vite', kind: 'clone' },
      { label: 'x mirrors y', kind: 'duplicate' },
    ],
  };
  const g = anomalyGroups(a);
  assert.equal(g.total, 3);
  assert.equal(g.reclaimableLabel, '1.8 GB');
  assert.deepEqual(g.groups.map((x) => x.kind), ['clone', 'duplicate']);   // empty omitted
  assert.equal(g.groups[0].count, 2);
  assert.equal(g.groups[0].items.length, 2);
  assert.equal(anomalyGroups({ items: [], reclaimableBytes: 0 }).reclaimableLabel, '0 B');
  assert.doesNotThrow(() => anomalyGroups(null));
});

test('nudgeRows: injected labels, pct, sorted desc; unknown id falls back to the id', () => {
  const ACHX = { version_control: { name: 'Under Control', icon: 'L' } };
  const rows = nudgeRows(
    [{ id: 'secret_free', have: 5, need: 8 }, { id: 'version_control', have: 7, need: 8 }],
    (id) => ACHX[id],
  );
  assert.equal(rows[0].id, 'version_control');        // 88% sorts above 63%
  assert.equal(rows[0].label, 'Under Control');
  assert.equal(rows[0].icon, 'L');
  assert.equal(rows[0].pct, 88);
  assert.equal(rows[1].label, 'secret_free');          // no entry -> raw id
  assert.equal(rows[1].icon, '');
  assert.doesNotThrow(() => nudgeRows(null, () => undefined));
});
```

- [ ] **Step 2: Run it — expect RED**

Run: `node --test dashboard-v3/src/intel/foresight.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `dashboard-v3/src/intel/foresight.mjs`**

```js
// foresight.mjs — PURE presentation adapters over derive.mjs's Foresight
// outputs (momentum / anomalies / achievementNudges). No imports, no DOM, no
// Date.now(): `now` and the achievement label table are injected, which is what
// keeps this headless-testable under node --test (same firewall as derive.mjs).
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A slope is "moving" only past ±0.5 XP/scan — below that it's sampling noise
// on a 44-point series and calling it a trend would be a lie.
export function forecastLine(m) {
  const slope = num(m?.xpSlope);
  const trend = slope > 0.5 ? 'rising' : slope < -0.5 ? 'falling' : 'flat';
  const eta = num(m?.etaDays, 0);
  let etaLabel = '—';
  if (eta > 0) {
    const n = Math.ceil(eta);
    etaLabel = `~${n} day${n === 1 ? '' : 's'}`;
  }
  return {
    trend,
    slopePerDay: Math.round(slope * 10) / 10,
    etaLabel,
    etaISO: m?.etaNextLevel || null,
  };
}

const UNITS = [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]];
function humanBytes(b) {
  const n = num(b);
  for (const [unit, size] of UNITS) {
    if (n >= size) return `${Math.round((n / size) * 10) / 10} ${unit}`;
  }
  return `${Math.round(n)} B`;
}

const KIND_ORDER = ['clone', 'duplicate', 'empty'];

export function anomalyGroups(a) {
  const items = Array.isArray(a?.items) ? a.items : [];
  const groups = [];
  for (const kind of KIND_ORDER) {
    const mine = items.filter((i) => i?.kind === kind);
    if (mine.length) groups.push({ kind, count: mine.length, items: mine });
  }
  return { total: items.length, reclaimableLabel: humanBytes(a?.reclaimableBytes), groups };
}

// labelFor is injected (the real ACH map lives in ui/components.js, which this
// module must not import — importing DOM-adjacent code would break purity).
export function nudgeRows(nudges, labelFor) {
  const out = [];
  for (const n of (nudges || [])) {
    const meta = (typeof labelFor === 'function' ? labelFor(n?.id) : null) || {};
    const have = num(n?.have), need = num(n?.need);
    out.push({
      id: n?.id,
      label: meta.name || n?.id,
      icon: meta.icon || '',
      have, need,
      pct: need > 0 ? clamp(Math.round((have / need) * 100), 0, 100) : 0,
    });
  }
  return out.sort((x, y) => y.pct - x.pct);
}
```

- [ ] **Step 4: Run it — expect GREEN** (3/3, output pristine).

- [ ] **Step 5: Commit**

```bash
git add dashboard-v3/src/intel/foresight.mjs dashboard-v3/src/intel/foresight.test.mjs
git commit -m "fe: intel/foresight — pure presentation adapters for Epic C"
```

---

### Task 2: Momentum forecast card in ATLAS (#3)

**Files:** Modify `dashboard-v3/src/realms/atlas/view.js` and `dashboard-v3/styles/realms/atlas.css`.

**Interfaces:** Consumes `momentum` (`../../intel/derive.mjs`) and `forecastLine` (`../../intel/foresight.mjs`). Reads `S.trends` + `S.account` from the existing `deriveScanContext`/scan context already present in `render()`.

- [ ] **Step 1: Read `atlas/view.js` first.** Note how `render()` builds cards (`xpCard`, `castsCard`, `followCard`, `streakCard`), how they are appended, and the existing `offSelect` disposer in `mount`/`unmount`. Follow that pattern exactly; do not restructure the realm.

- [ ] **Step 2: Add a `forecastCard(S, now)` builder** beside the other card builders. It must:
  - Call `momentum(S.trends, S.account, now)` then `forecastLine(...)`.
  - Render: a heading (`Momentum forecast`), the trend word, the slope (`+N XP/scan`), and the ETA to next level (`etaLabel` + the target level `S.account.level + 1`).
  - **Empty/flat state:** when `trend === 'flat'` or `etaLabel === '—'`, show a calm honest line — e.g. `Not enough forward motion to project a date.` — never a fake ETA.
  - `esc()` every interpolated value.
  - Use the realm's existing card idiom (`chartCard`/`emptyCard` or a plain `el('div', ...)` matching neighbours) and `--space-*`/`--fs-*` tokens.
  - `now` must come from `new Date().toISOString()` at the call site in `render()` — never inside `foresight.mjs`.

- [ ] **Step 3: Append the card in `render()`** in a sensible position (next to the XP card, since it forecasts XP). Keep `aosKids`/`aosRefresh` usage consistent with the rest of the realm.

- [ ] **Step 4: Style it** in `styles/realms/atlas.css`, scoped under the realm's existing root selector, tokens only.

- [ ] **Step 5: Verify.** `node --check dashboard-v3/src/realms/atlas/view.js`; then selftest:

Run: `dashboard/node_modules/electron/dist/electron.exe dashboard-v3/dev-main.js --smoke --selftest`
Expected: `SELFTEST combos=105 errors=0 PASS`.

- [ ] **Step 6: Commit** `fe: atlas — momentum forecast card (Epic C #3)` staging only the two files.

---

### Task 3: Anomaly cleanup panel in MED-BAY (#4) + a real `capture:note` action

**Files:** Modify `dashboard-v3/src/core/actions.mjs`, `dashboard-v3/src/core/actions.test.mjs`, `dashboard-v3/src/realms/medbay/view.js`, `dashboard-v3/styles/realms/medbay.css`.

**Interfaces:** Consumes `anomalies` (`../../intel/derive.mjs`) + `anomalyGroups` (`../../intel/foresight.mjs`) + `dispatch` (`../../core/actions.mjs`).

**Produces:** a new registered action `capture:note` — `run: (ctx) => hq?.captureSave?.(ctx?.text)`, `enabled: (ctx) => !!ctx?.text`.

> **Why a new action:** `window.hq.capture` does not exist (preload exposes only `captureSave(text)`/`captureCancel()`), so the pre-existing `capture:idea` action is a documented no-op. Wiring this panel to it would ship a dead button. `captureSave(text)` is real and already in the IPC contract — no new channel, no contract change.

- [ ] **Step 1: Add the failing test** to `dashboard-v3/src/core/actions.test.mjs`

```js
test('capture:note passes ctx.text to hq.captureSave and needs text to enable', () => {
  _reset();
  const saved = [];
  initActions({ switchRealm: () => {}, ordered: () => [], hq: { captureSave: (t) => saved.push(t) } });
  assert.ok(resolve('capture:note'));
  assert.equal(all({}).find((a) => a.id === 'capture:note'), undefined);       // no text -> disabled
  assert.ok(all({ text: 'x' }).find((a) => a.id === 'capture:note'));
  dispatch('capture:note', { text: 'Clean up: playwright' });
  assert.deepEqual(saved, ['Clean up: playwright']);
  assert.doesNotThrow(() => { _reset(); initActions({ ordered: () => [], hq: {} }); dispatch('capture:note', { text: 'y' }); });
});
```

- [ ] **Step 2: Run — RED.** `node --test dashboard-v3/src/core/actions.test.mjs`

- [ ] **Step 3: Register the action** in `initActions()` in `actions.mjs`, beside the existing `capture:idea` line, following the established guarded idiom:

```js
  // Real capture seam: preload exposes captureSave(text) (capture:idea's
  // hq.capture() does not exist — see the note above). Text-carrying callers
  // (the Med-Bay cleanup panel) dispatch through here so the write stays on the
  // one audited path.
  register({ id: 'capture:note', label: 'Capture note', run: (ctx) => hq?.captureSave?.(ctx?.text), enabled: (ctx) => !!ctx?.text });
```

- [ ] **Step 4: Run — GREEN** (full `actions.test.mjs` passes).

- [ ] **Step 5: Read `medbay/view.js`**, then add a `renderAnomalies(parent, S)` section following the existing `renderTriage`/`renderTreatments` pattern. It must:
  - Call `anomalies(S)` → `anomalyGroups(...)`.
  - Header: `Cleanup — N items · ~SIZE reclaimable` (use `total` + `reclaimableLabel`).
  - One block per group (`clone` / `duplicate` / `empty`) with a plain-language heading (`Cloned repos` / `Duplicates` / `Empty folders`) and its items.
  - Each item gets ONE working button — `Note for cleanup` — that calls `dispatch('capture:note', { text: 'Clean up: <label>' })`, then gives feedback (disable the button + swap its label to `Noted`, matching the medbay `rx-copy` feedback idiom already in the file). **Guard the no-preload case:** if `window.hq?.captureSave` is absent (dev harness), render the button `disabled` with a title explaining it needs the live app — do NOT render a control that silently does nothing.
  - **Empty state:** `total === 0` → a calm `Nothing to clean up.` line.
  - `esc()` everything dynamic.
- [ ] **Step 6: Style** in `styles/realms/medbay.css` scoped under `.realm-medbay`, tokens only, buttons ≥ `var(--tap-min)`.
- [ ] **Step 7: Verify.** `node --check` both changed JS files; `node --test dashboard-v3/src/core/actions.test.mjs`; selftest → `SELFTEST combos=105 errors=0 PASS`.
- [ ] **Step 8: Commit** `fe: medbay — anomaly cleanup panel + capture:note action (Epic C #4)`.

---

### Task 4: Achievement-nudge strip (#19) + verify the epic

**Files:** Create `dashboard-v3/src/ui/nudge.js`. Modify `dashboard-v3/src/realms/atlas/view.js` and `dashboard-v3/styles/components.css`.

**Interfaces:** Consumes `achievementNudges` (`../intel/derive.mjs`), `nudgeRows` (`../intel/foresight.mjs`), and the exported `ACH` map from `./components.js`.
**Produces:** `buildNudgeStrip(achievements) → HTMLElement | null` — returns `null` when there is nothing to nudge, so callers can skip appending entirely.

- [ ] **Step 1: Implement `dashboard-v3/src/ui/nudge.js`**

```js
// nudge.js — "you're one push away" strip. Renders derive.achievementNudges()
// (locked achievements >= 50% complete) as compact progress rows. The friendly
// name/icon comes from the shared ACH map; foresight.nudgeRows stays pure by
// taking that lookup as an argument.
import { el, esc } from './util.js';
import { ACH } from './components.js';
import { achievementNudges } from '../intel/derive.mjs';
import { nudgeRows } from '../intel/foresight.mjs';

export function buildNudgeStrip(achievements) {
  const rows = nudgeRows(achievementNudges(achievements), (id) => ACH[id]);
  if (!rows.length) return null;
  const wrap = el('div', 'nudge-strip');
  wrap.innerHTML = `<div class="nudge-h">Almost there</div>` + rows.map((r) => `
    <div class="nudge-row">
      <span class="nudge-ic">${r.icon || ''}</span>
      <span class="nudge-l">${esc(r.label)}</span>
      <span class="nudge-bar"><i style="width:${esc(String(r.pct))}%"></i></span>
      <span class="nudge-n">${esc(String(r.have))}/${esc(String(r.need))}</span>
    </div>`).join('');
  return wrap;
}
```

> **Note on `r.icon`:** `ACH` icons are trusted static strings from our own module (`PX.*` SVG markup or an emoji), NOT scan data — so they are intentionally injected raw. Every value that originates from the scan (`label`, `have`, `need`, `pct`) is `esc()`'d.

- [ ] **Step 2: Mount it in `atlas/view.js`'s `render()`** — build with `buildNudgeStrip(S.achievements)` (**top-level `S.achievements`, NOT `S.account.achievements`**) and append only when non-null.

- [ ] **Step 3: Style `.nudge-strip`** in `dashboard-v3/styles/components.css` (it is a shared component, not realm-scoped). Tokens only; the bar mirrors the existing progress-bar idiom.

- [ ] **Step 4: Verify the whole epic.**
  - `node --check` every changed JS file.
  - `node --test dashboard-v3/src/intel/foresight.test.mjs dashboard-v3/src/intel/derive.test.mjs dashboard-v3/src/core/actions.test.mjs` → all green, pristine.
  - Selftest → `SELFTEST combos=105 errors=0 PASS`.
  - **The selftest loop is synchronous and does not prove render output.** Write a THROWAWAY harness in a temp dir (not the repo) that loads `dashboard-v3/index.html` offscreen, switches to `atlas` then `medbay`, waits ~900ms each, and reports: console errors, `.nudge-row` count (expect **3** on live data), the forecast card's text, `.wr-`-free medbay cleanup item count (expect **13**), and the reclaimable label (expect `~1.8 GB`). Delete the harness afterwards and report what you observed.
- [ ] **Step 5: Commit** `fe: ui/nudge — achievement nudge strip in atlas (Epic C #19)`.

---

## Self-Review

**Spec coverage (charter Epic C):** #3 momentum forecast → Task 2 (atlas). #4 anomaly whisperer → Task 3 (medbay) *with a working action, correcting the charter's `capture:idea` suggestion which is a verified no-op*. #19 contextual achievement progress → Task 4 (`ui/nudge.js`, mounted in atlas). Gate "selftest unchanged (no new realm) + screenshots" → Tasks 2/3 selftest + Task 4 harness observation.

**Placeholder scan:** no TBD/TODO. Task 1 carries complete test + implementation code. Tasks 2–4 give exact interfaces, file targets, empty-state rules, and commands; their UI bodies are deliberately specified by behavior + idiom (each must match its host realm's existing card pattern, which the implementer reads first) rather than pre-written markup that would fight those realms' conventions.

**Type consistency:** `forecastLine`/`anomalyGroups`/`nudgeRows` signatures identical in Task 1 (definition), Task 2, Task 3, Task 4 (use), and the tests. `derive.momentum(trends, account, now)`, `derive.anomalies(selected)`, `derive.achievementNudges(achievements)` match `derive.mjs`. `dispatch(id, ctx)` / `register({id,label,run,enabled})` match `actions.mjs`. Selftest stated as 105 throughout.

**Invariant check:** additive; no realm added; no contract/IPC/main change (`capture:note` reuses the existing `hq:capture-save` channel); all files under `dashboard-v3/`; purity preserved by injecting `labelFor` instead of importing `components.js` into `intel/`.
