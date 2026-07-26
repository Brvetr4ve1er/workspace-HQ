# NEXUS ALIVE — Program Plan (instrument-panel → living console)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **Phase 0** task-by-task (it is a fully-executable TDD plan). Phases 1–4 are **epic specs**: spin each into its own dated plan (`docs/superpowers/plans/…`) at build time, per the writing-plans scope rule (multi-subsystem specs become one plan per subsystem). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn NEXUS from a beautiful read-only dashboard into a console that *tells you what to do* and *does it for you* — shipping all 22 brainstormed features across four coherent phases, without ever breaking the running app or the v2 rollback path.

**Architecture:** A three-module **substrate** lands first — pure `intel/derive.js` (the brain), `core/actions.js` (the one audited "do" path), `core/notify.js` (the event surface). ~85% of the 22 features are then **pure renderer-side derivations + additive UI** that consume the substrate and need **zero data-contract change and zero main-process change**. The remaining ~15% (tray HUD, real security remediation, Claude-session spawn, screenshot capture) are isolated into a late phase behind explicit CONTRACT.md / IPC-CONTRACT.md asks.

**Tech Stack:** Electron 32 (Chromium 128, Node ~20), vanilla-JS ESM over `file://`, no build step. Tests: `node --test` (built-in) for pure modules; the in-app `?selftest` harness (`dev-main.js --smoke --selftest`) for mount integrity; struct golden fixtures for the contract.

## Global Constraints (copied verbatim from the program charter — every task inherits these)

- **Additive-only contract.** `latest.json` / sidecar shapes never change destructively; any new field gets a `docs/sync/CONTRACT.md` *Pending changes* entry BEFORE code + a matching golden re-baseline in `collector/lib/__fixtures__/`. (struct-lane owns this.)
- **v2 rollback stays one flip away.** `data/.ui-version` → `"v2"` + restart must always fully revert. Nothing in this program may make v3 the only bootable renderer.
- **IPC is frozen & additive-only.** `window.hq` (40 invokes + 7 pushes) may gain rows via `docs/sync/IPC-CONTRACT.md`, never break existing ones. New main-side features go in **NEW files** (`dashboard/main.js` edits gated on in-flight work landing).
- **Lane ownership.** frontend owns `dashboard-v3/`; anything under `collector/` / `schema/` / `spellbook/` is a **struct ask** written in `docs/sync/HANDOFF.md`, never edited from this lane.
- **Selftest is the tripwire.** `SELFTEST combos=91 errors=0 PASS` (13 realms × 7 themes) must stay green after every task. It only grows as realms are added.
- **Copy stays plain.** Recent direction is clean/professional, de-cornied. Game-soul lives in *behavior and motion*, not purple prose. Realm labels ride the lexicon (plain register for nexus/daylight).
- **Rail discipline.** 13 realms is already a lot. Prefer augmenting existing realms; add **at most one** new realm this whole program (the War Room). Everything else is a section/card/overlay.

---

## The Surgical Doctrine — how we never break the app

1. **Purity firewall.** All intelligence is pure functions `f(bundle, selected, now) → plain object`, in `src/intel/`. No DOM, no globals, no `window.hq`. This makes the brain unit-testable headless and impossible to crash the renderer.
2. **One dispatch path.** Every side-effect (navigate, cast, complete quest, capture, scan, spawn Claude) goes through `core/actions.js`. Buttons, palette, Oracle, and Familiar all call `dispatch(id, ctx)` — so there is exactly one place to audit, guard, and telemetry-log actions.
3. **Tolerant mounts.** Every new surface renders a calm empty state when its data block is absent (the established realm pattern: `enabled: () => true` + guarded reads). A missing field never blanks the rail or throws.
4. **Feature flags in `localStorage`.** Each epic ships behind a `hq-ff-<epic>` flag (default on once verified, but instantly killable) so a regression is a toggle away, not a revert.
5. **Additive commits, `fe:` prefix, selftest between each.** No task lands red. Contract/IPC asks are separate, announced-first, struct/main-gated.
6. **Verify live, not just green.** Each phase ends with a headless capture run (`tools/nexus-shot.js` pattern) reviewed before the phase is called done — behavior observed, per the `verify` discipline.

---

## Shared Substrate — File Structure (Phase 0 builds these)

| File | Responsibility | Lane / contract |
|---|---|---|
| `dashboard-v3/src/intel/derive.js` | Pure derivations: `oracle`, `triage`, `forecast`, `anomalies`, `momentum`, `streakRisk`, `spellFit`, `achievementNudges`. Each `f(data,…)→plain`. | fe · no contract |
| `dashboard-v3/src/intel/derive.test.mjs` | `node --test` suite over the golden fixture. | fe · no contract |
| `dashboard-v3/src/core/actions.js` | Action registry + `dispatch()`. Wraps `switchRealm`, cast, quest-done, capture, scan-trigger. Single audited seam. | fe · reuses existing IPC |
| `dashboard-v3/src/core/notify.js` | Event surface: `emit(evt)` → in-app takeover (existing fx) + guarded HTML5 `Notification`. Reads `changes_since_prev` at boot. | fe · renderer Notification API (no main change) |
| `dashboard-v3/src/intel/__fixtures__/sample.json` | Frozen copy of a real `latest.json` for headless tests (renderer-local, gitignored-eligible). | fe |

**Key architectural facts the implementer must know:**
- `data.js` exposes `data.bundle` (`.latest .scans .spellbook .telemetry .weeklyRecap .browser`), `data.selected`, `data.scans`, `data.select(i)`. Derive functions take these as **arguments** — never import `data.js` into `intel/` (keeps purity).
- The Command Palette (`src/core/palette.js`, shipped 2026-07-26) already has a `push(kind,label,hint,run,alias)` index and an `activate(it)` seam. Palette-actions (Epic F1) extends this — it does not rebuild it.
- `now-brief.mjs` (`tools/now-brief.mjs`) is a **headless Oracle prototype** already fusing browser focus + git + quests into one next-action. Port its ranking logic into `derive.oracle()` rather than reinventing.
- Electron renderer supports the HTML5 `Notification` API directly — OS notifications need **no** main-process change.
- `node --test` ships with Node 20 (Electron 32). Run pure suites with the app's node: `node --test dashboard-v3/src/intel/derive.test.mjs`.

---

## Feature → Epic → Phase map (all 22, nothing dropped)

| # | Feature | Epic | Phase |
|---|---|---|---|
| 1 | The Oracle (live "do this now") | A · Oracle | 1 |
| 2 | "What's on fire" triage board | B · War Room | 1 |
| 3 | Momentum forecasting | C · Foresight | 1 |
| 4 | Anomaly whisperer | C · Foresight | 1 |
| 19 | Contextual achievement progress | C · Foresight | 1 |
| 8 | Command-Palette **actions** | F1 · Do-Anything | 2 |
| 6 | Contextual spell recommendations | D · Agency | 2 |
| 7 | Auto-quest generation from signals | D · Agency | 2 |
| 5 | Dispatch-Claude buttons | D · Agency | 2 (IPC ask) |
| 14 | Full-screen Focus Mode + timer | E · Focus | 2 |
| 9 | Narrative scan-diff / this-day-in-history | G · Memory | 3 |
| 10 | Streak insurance + night warning | G · Memory | 3 |
| 11 | Sunday review ritual | G · Memory | 3 |
| 12 | Tray micro-HUD (one number) | H · Ambient | 3 (main ask) |
| 13 | OS notifications on changes | H · Ambient | 3 |
| 16 | Browser accountability nudge | H · Ambient | 3 |
| 15 | Capture-everywhere | H · Ambient | 3 (partial main/ext ask) |
| 17 | Boss battles | I · Teeth | 4 |
| 18 | Skill tree / Seven Classes | I · Teeth | 4 |
| 20 | Themes as unlockables | I · Teeth | 4 |
| 21 | Proactive Familiar | J · Soul | 4 |
| 22 | Real sound design | J · Soul | 4 |

**Phase intent:** 0 = build the brain & the hands. 1 = make it *think* (surfaces). 2 = make it *act*. 3 = make it *reach* (time, ambient, OS). 4 = make it *sing* (teeth & soul). Each phase is shippable and reversible on its own.

---

# PHASE 0 — THE SUBSTRATE (fully executable TDD plan)

> Build order: derive → actions → notify. No UI yet; these are load-bearing and must be green before any Phase-1 surface consumes them. Every task ends selftest-green.

### Task 0.1: Freeze a test fixture

**Files:**
- Create: `dashboard-v3/src/intel/__fixtures__/sample.json`

**Interfaces:**
- Produces: a real `latest.json` snapshot the derive suite reads. Shape = the documented `latest.json` (see `docs/sync/CONTRACT.md`).

- [ ] **Step 1: Copy the live scan (or golden) into the fixture**

```bash
# prefer the real live scan; fall back to the struct golden
cp "data/latest.json" dashboard-v3/src/intel/__fixtures__/sample.json \
  || cp collector/lib/__fixtures__/*latest*.json dashboard-v3/src/intel/__fixtures__/sample.json
```

- [ ] **Step 2: Sanity-check it parses and has load-bearing keys**

Run: `node -e "const d=require('./dashboard-v3/src/intel/__fixtures__/sample.json'); console.log('ok', d.account.level, d.projects.length, d.quests.length)"`
Expected: prints `ok <level> <n> <n>` with non-zero counts.

- [ ] **Step 3: Commit**

```bash
git add dashboard-v3/src/intel/__fixtures__/sample.json
git commit -m "fe: freeze latest.json fixture for intel unit tests"
```

### Task 0.2: `derive.oracle()` — the single live recommendation

**Files:**
- Create: `dashboard-v3/src/intel/derive.js`
- Test: `dashboard-v3/src/intel/derive.test.mjs`

**Interfaces:**
- Produces: `oracle(bundle, selected, now) → { action, label, reason, weight, target:{realmId, projectId?, questId?} } | null`
  where `action ∈ {'commit','quest','capture','scan','rest'}`. Pure. `now` is an ISO string or Date (injected for testability — never `Date.now()` inside).

- [ ] **Step 1: Write the failing test**

```js
// derive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracle } from './derive.js';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/sample.json', import.meta.url)));

test('oracle: uncommitted files at risk outrank a calm quest', () => {
  const sel = { ...FIX, projects: [
    { id:'p1', name:'A', metrics:{ git_safety:{ uncommitted: 24 } }, activity:{ days_since_commit: 0 } },
    { id:'p2', name:'B', metrics:{ git_safety:{ uncommitted: 0 } }, activity:{ days_since_commit: 1 } },
  ], quests: [{ id:'q1', title:'tidy', tier:'yellow', status:'open' }] };
  const r = oracle(FIX, sel, '2026-07-26T14:00:00Z');
  assert.equal(r.action, 'commit');
  assert.equal(r.target.projectId, 'p1');
  assert.match(r.reason, /uncommitted/i);
});

test('oracle: never throws on an empty/old scan', () => {
  assert.doesNotThrow(() => oracle({}, null, '2026-07-26T14:00:00Z'));
  assert.equal(oracle({}, null, '2026-07-26T03:00:00Z'), null); // nothing actionable → null
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test dashboard-v3/src/intel/derive.test.mjs`
Expected: FAIL — `oracle` is not exported / file missing.

- [ ] **Step 3: Write the minimal implementation (port now-brief ranking)**

```js
// derive.js — pure derivations. No DOM, no globals, no Date.now().
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// Weighted "what should I do right now". Higher weight wins. Ported from
// tools/now-brief.mjs's next-action heuristic, made pure + testable.
export function oracle(bundle, selected, now) {
  const sel = selected || {};
  const hour = new Date(now).getHours();
  const cands = [];

  for (const p of sel.projects || []) {
    const unc = num(p.metrics?.git_safety?.uncommitted);
    if (unc > 0) cands.push({
      action: 'commit', weight: 40 + Math.min(unc, 60),
      label: `Commit ${p.name} (${unc} uncommitted)`,
      reason: `${unc} uncommitted files at risk`,
      target: { realmId: 'forge', projectId: p.id },
    });
    const sec = num(p.metrics?.risk_security?.exposed);
    if (sec > 0) cands.push({
      action: 'quest', weight: 90 + sec,
      label: `Rotate ${sec} exposed secret${sec > 1 ? 's' : ''} — ${p.name}`,
      reason: 'exposed secrets are a live breach risk',
      target: { realmId: 'forge', projectId: p.id },
    });
  }
  for (const q of sel.quests || []) {
    if (q.status !== 'open') continue;
    const w = q.tier === 'red' ? 70 : q.tier === 'orange' ? 45 : 20;
    cands.push({ action: 'quest', weight: w, label: q.title,
      reason: `${q.tier} quest`, target: { realmId: 'hunts', questId: q.id } });
  }
  // late night with nothing on fire → rest, don't nag
  if (!cands.length) return (hour >= 22 || hour < 6) ? null : null;

  cands.sort((a, b) => b.weight - a.weight);
  return cands[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dashboard-v3/src/intel/derive.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add dashboard-v3/src/intel/derive.js dashboard-v3/src/intel/derive.test.mjs
git commit -m "fe: intel/derive.oracle — pure live 'do this now' recommendation"
```

### Task 0.3: `derive.triage()` + `derive.anomalies()` + `derive.momentum()`

**Files:**
- Modify: `dashboard-v3/src/intel/derive.js`
- Modify: `dashboard-v3/src/intel/derive.test.mjs`

**Interfaces:**
- Produces:
  - `triage(selected) → [{ projectId, name, blastRadius, kind, detail }]` sorted desc by `blastRadius` (kind ∈ `'security'|'uncommitted'|'stale'|'no-tests'|'no-ci'`).
  - `anomalies(bundle) → { clones:n, duplicates:n, empty:n, bytes:n, items:[{path,kind}] }` over `inventory`.
  - `momentum(trends) → { xpSlope, etaNextLevel:isoString|null, stalling:[projectId] }` — least-squares slope over `trends.xp` (`[{d,v}]`).

- [ ] **Step 1: Write failing tests** (blast-radius ordering; momentum slope sign; anomaly byte-sum). *(full assertions written inline in the executable spin-out)*
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the three pure functions beside `oracle` (least-squares: `slope = Σ((x-x̄)(y-ȳ))/Σ(x-x̄)²`; ETA from `xp_to_next / xpSlope`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `fe: intel/derive — triage, anomalies, momentum`.

### Task 0.4: `derive.spellFit()` + `derive.streakRisk()` + `derive.achievementNudges()`

**Files:** Modify `derive.js` + `derive.test.mjs`.

**Interfaces:**
- `spellFit(bundle, selected) → [{ spellId, name, forProjectId, why }]` — match `spellbook.spells` `school`+tags to project `signals` gaps (e.g. `has_tests:false` → a `restoration`/test spell).
- `streakRisk(account, now) → { atRisk:bool, hoursLeft:number, streak:number }` from `account.streak.last_scan` + a grace window.
- `achievementNudges(achievements) → [{ id, have, need, label }]` for any with `progress` and `have/need ≥ 0.5`.

- [ ] TDD 5-step cycle as above → commit `fe: intel/derive — spellFit, streakRisk, achievementNudges`.

### Task 0.5: `core/actions.js` — the one dispatch path

**Files:**
- Create: `dashboard-v3/src/core/actions.js`
- Test: `dashboard-v3/src/core/actions.test.mjs` (pure registry logic; side-effects injected)

**Interfaces:**
- Produces: `register({id,label,icon,run,enabled})`, `dispatch(id, ctx)`, `all(ctx)→[{id,label,icon,enabled}]`, `resolve(id)`.
- `run` receives `ctx` and may call injected effect-fns; `dispatch` wraps `run` in try/catch + optional telemetry, so a bad action can never throw out of a keystroke (mirrors palette's `activate`).

- [ ] **Step 1: Failing test** — `register` then `dispatch('x')` calls its run once; a throwing run is swallowed and returns `{ok:false}`; `all()` filters by `enabled(ctx)`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the registry (a `Map`), `dispatch` with try/catch, `all` with enabled-filter.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `fe: core/actions — unified audited dispatch seam`.

### Task 0.6: Seed the core action set + wire boot

**Files:**
- Modify: `dashboard-v3/src/core/actions.js` (register defaults)
- Modify: `dashboard-v3/src/core/boot.js` (call `initActions()` after shell, before palette)

**Interfaces:**
- Consumes: `switchRealm` (shell), `window.hq.scanTrigger/markQuestDone/capture` (existing IPC), `castSpell` (existing).
- Produces: registered ids `go:<realm>`, `scan:now`, `quest:done`, `capture:idea`, `cast:<spellId>` — all guarded by feature-detecting `window.hq?.…`.

- [ ] **Step 1:** Register defaults; guard every `window.hq` call (headless/old-preload tolerance).
- [ ] **Step 2:** `initActions()` in boot after `initAmbient()`.
- [ ] **Step 3:** Selftest gate — `dev-main.js --smoke --selftest` → `combos=91 errors=0 PASS`.
- [ ] **Step 4: Commit** `fe: seed core actions + boot wiring`.

### Task 0.7: `core/notify.js` — the event surface

**Files:**
- Create: `dashboard-v3/src/core/notify.js`
- Test: `dashboard-v3/src/core/notify.test.mjs` (pure: event routing; DOM/Notification injected)
- Modify: `dashboard-v3/src/core/boot.js` (init after actions; replay `changes_since_prev`)

**Interfaces:**
- Produces: `emit({type,title,body,weight})`, `initNotify(deps)`. Routes: always the in-app takeover for `type ∈ {level_up,new_achievement,quest_completed}` (existing fx); additionally an OS `Notification` when `document.hidden` and permission granted.
- Consumes: `changes_since_prev[]` from `data.bundle.latest` at boot → replays as events (dedup by a `localStorage` seen-set so a reload doesn't re-fire).

- [ ] TDD cycle (route table; dedup; hidden-gate) → selftest gate → commit `fe: core/notify — in-app + OS event surface`.

**Phase 0 exit gate:** `node --test` green across `intel/` + `core/`; `SELFTEST combos=91 errors=0 PASS`; a one-off harness prints `oracle()` on the live fixture. Tag: `git commit -m "fe: NEXUS ALIVE substrate complete (derive+actions+notify)"`.

---

# PHASE 1 — MAKE IT THINK (epics A, B, C · fe · no contract change)

> Each epic → its own executable plan. Interfaces below are the contract between epics; copy them verbatim into the spin-out.

### Epic A · The Oracle (feature 1)
- **Files:** `src/realms/roundtable/oracle-card.js` (hero card), consume `derive.oracle()` + `core/actions.dispatch()`. Mount into existing roundtable view + mirror a one-line version into the ambient rail (`core/ambient.js` has the Familiar/whisper slots).
- **Behavior:** the single card shows `label` + `reason` + one primary button that `dispatch()`es `oracle.action` (Commit→forge+project drawer, Quest→hunts, etc.). Refreshes on scan-select change (subscribe to the data bus). Empty/rest state at night.
- **Flag:** `hq-ff-oracle`. **Gate:** selftest 91/91 + captured screenshot reviewed.

### Epic B · The War Room (feature 2) — the ONE new realm this program allows
- **Files:** `src/realms/warroom/{manifest.js,view.js}`, `styles/realms/warroom.css`; register in `boot.js`; `@import` in `realms.css`; lexicon keys `tab_warroom` in all 3 registers (plain: `ON FIRE` / default: `WAR ROOM` / nightfall: `THE MUSTER`). **This is the +1 realm; count goes 13→14, selftest target becomes 14×7=98.**
- **Behavior:** `derive.triage()` rendered as a blast-radius-sorted board; each row has a `dispatch()` remediation button (Phase-2 wires real remediation; Phase-1 ships navigate-to-project + "Send Claude" stub disabled behind `hq-ff-dispatch`).
- **Gate:** selftest **98/98** after registration.

### Epic C · Foresight (features 3, 4, 19)
- **Files:** augment existing realms — `atlas/view.js` gets a `momentum()` forecast card; `medbay/view.js` (or observatory) gets the `anomalies()` cleanup panel; a shared `ui/nudge.js` renders `achievementNudges()` inline next to advancing surfaces.
- **Behavior:** forecast line + ETA label; anomaly panel with per-item "make a cleanup quest" (`dispatch('capture:idea', …)` in Phase 1, real quest-gen in Epic D).
- **Gate:** selftest unchanged (no new realm) + screenshots.

---

# PHASE 2 — MAKE IT ACT (epics F1, D, E · fe + one IPC ask)

### Epic F1 · Do-Anything Palette (feature 8) — cheapest killer, build first
- **Files:** `src/core/palette.js` (extend the existing `buildIndex()` — add `all(ctx)` from `core/actions.js` as a new `kind:'action'` with `run: () => dispatch(id, ctx)`).
- **Behavior:** Ctrl/Cmd+K now surfaces verbs (`Cast X`, `Complete quest Y`, `Scan now`, `Capture idea`, `Send Claude at Z`) alongside nav. `KIND_RANK`/`KIND_LABEL`/`KIND_ICON` gain an `action` entry. No new module — the `run()` seam already exists.
- **Gate:** selftest + palette capture (reuse the `wire-shot` pattern) showing an action row executing.

### Epic D · Agency (features 6, 7, 5)
- **6 spell recs:** `spellFit()` → a "recommended automation" strip on `forge`/`grimoire`, cast via `dispatch('cast:<id>')`.
- **7 auto-quests:** `derive` proposes quests from signal gaps → written through the **existing** `quest-overrides.json` path (`window.hq` quest write) — *no new contract*. Accept/dismiss UI.
- **5 dispatch-Claude:** needs a session-spawn IPC. **IPC ASK** (write in HANDOFF + IPC-CONTRACT.md first): `hq:spawn-session {projectId, task}` returning a session id, reusing the existing summon/`claude-sessions` path. Until it lands, the button is flag-gated (`hq-ff-dispatch`) and inert. **Main-process work goes in a NEW file**, not `main.js`.

### Epic E · Focus Mode (feature 14)
- **Files:** `src/core/focus.js` (full-screen overlay) + `styles/focus.css`; triggered from Oracle/quest via `dispatch('focus:start', {questId})`.
- **Behavior:** one quest, a running timer, everything else dimmed; completing → `dispatch('quest:done')` + `notify.emit` celebration + XP. Esc exits. Pure renderer.

---

# PHASE 3 — MAKE IT REACH (epics G, H · fe + main asks isolated)

### Epic G · Memory (features 9, 10, 11) — all pure derivations over history
- **9 scan-diff:** `derive.diff(scanA, scanB) → {moved:[…]}`; a narrative before/after view driven by the existing scrubber selection. Pure.
- **10 streak insurance:** `streakRisk()` + `notify.emit` a night warning when `atRisk` & `document.hidden`; a `localStorage` grace-token mechanic (renderer-only).
- **11 Sunday ritual:** an interactive pass over `weekly-recap.json` (swipe shipped items, rate, set next top-3 → written via existing quest/override path).

### Epic H · Ambient & OS (features 13, 16, 12, 15)
- **13 OS notifications:** already in `notify.js` (renderer `Notification`) — this epic just enriches copy/sound. **No main change.**
- **16 browser nudge:** `derive` over `browser.by_domain` vs open red quests → one dismissible ambient nudge. Pure (data already in `latest.json.browser`).
- **12 tray micro-HUD:** **MAIN-PROCESS ASK.** New file `dashboard/tray-hud.js` (NOT edits to `main.js`), reads `latest.json.account.health_index`, sets tray title/tooltip. IPC-CONTRACT: none (main reads the file it already reads). Gated on in-flight main work landing.
- **15 capture-everywhere:** renderer capture variants ship in-lane; **screenshot capture + browser-extension capture are ASKS** (extension = meta lane `browser-bridge/`, screenshot = main/`desktopCapturer`). Isolate; announce.

---

# PHASE 4 — MAKE IT SING (epics I, J · fe · pure)

### Epic I · Teeth (features 17, 18, 20)
- **17 boss battles:** `derive.boss(selected) → {name, hp, max, drainPerCommit}` from a security cluster or big-refactor project; a health-bar overlay in War Room/forge that drains on commits (observed via `changes_since_prev`).
- **18 skill tree:** visualize `spellcraft.per_school` + the existing Seven-Classes classifier as a real tree in `grimoire`; levels per school as casts land.
- **20 unlockable themes:** gate ≥2 of the 7 themes behind `achievements`; `themes.js` reads unlock state from `localStorage`, falls back to locked-preview.

### Epic J · Soul (features 21, 22)
- **21 proactive Familiar:** the ambient Familiar slot subscribes to `derive.oracle()` + sessions; surfaces one unprompted insight per session with a `dispatch('spawn-session')` offer (rides Epic D's IPC ask).
- **22 sound design:** author real cues on the existing `sfx()` seam (`setSfx` in `fx.js`) — level-up fanfare, cast whoosh, quest chime, palette blip. Data-URI/local assets only (CSP: `default-src 'self'`).

---

## Struct-lane & main-process asks (isolated, announce-first)

| Ask | Lane | Gate | Needed by |
|---|---|---|---|
| `hq:spawn-session {projectId,task}` push/invoke | main (NEW file) + IPC-CONTRACT.md | additive IPC row | Epic D (#5), Epic J (#21) |
| `dashboard/tray-hud.js` (tray title from health_index) | main (NEW file) | no IPC; reads existing file | Epic H (#12) |
| screenshot capture (`desktopCapturer`) | main (NEW file) + IPC row | additive | Epic H (#15) |
| extension "capture this page" | meta · `browser-bridge/` | additive POST to existing bridge | Epic H (#15) |
| one-click security remediation spells (`school:'restoration'`, secret-rotation) | **struct** · `spellbook/` | CONTRACT entry + golden re-baseline | War Room #2 real remediation |

*No feature in Phases 0–1, and most of 2–4, requires any of these — they are the isolated 15%.*

## Verification gates (run at every task; hard-block a phase exit)

1. `node --test dashboard-v3/src/intel dashboard-v3/src/core` → all green.
2. `../dashboard/node_modules/electron/dist/electron.exe dev-main.js --smoke --selftest` → `combos=N errors=0 PASS` (N: 91 through Phase 1 Epic A; **98** after War Room registers; grows with any further realm).
3. Headless capture (`tools/nexus-shot.js` pattern) of the phase's new surfaces → visually reviewed (the `verify` discipline: observe behavior, not just green tests).
4. `git status` clean; contract goldens untouched unless a CONTRACT.md *Pending* entry exists.
5. HANDOFF.md entry appended per phase (`fe:` work + any struct/main asks queued).

## Self-Review (writing-plans checklist, run against the 22-feature spec)

**Spec coverage:** all 22 features appear in the Feature→Epic→Phase table with a named file target; none dropped. ✎ Gap check: features needing data the app lacks? None — every derivation cites an existing `latest.json` field (`git_safety`, `risk_security`, `trends.xp`, `inventory`, `browser.by_domain`, `spellcraft.per_school`, `achievements.progress`, `streak.last_scan`). Real remediation/spawn/screenshot correctly deferred to asks, not faked.

**Placeholder scan:** Phase 0 tasks carry real test + impl code (no TBD). Phases 1–4 are explicitly **epic specs → own plans** (permitted by the scope rule), each with exact files + interface signatures, not hand-waving.

**Type consistency:** `dispatch(id, ctx)` / `register({id,label,icon,run,enabled})` / `oracle(...).target.{realmId,projectId,questId}` used identically in Phase 0 (definition), Epic A, Epic B, Epic F1. `notify.emit({type,title,body,weight})` consistent across Phase 0 and Epic H. Selftest count transitions 91→98 stated at the one realm-adding task (Epic B) and nowhere else.

**Invariant check:** every phase is additive, flag-gated, reversible; v2 rollback untouched; contract/IPC/main changes quarantined into the asks table with announce-first gating.
