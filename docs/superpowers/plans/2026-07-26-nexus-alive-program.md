# NEXUS ALIVE — Program Plan (instrument-panel → living console)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **Phase 0** task-by-task (it is a fully-executable TDD plan). Phases 1–4 are **epic specs**: spin each into its own dated plan (`docs/superpowers/plans/…`) at build time, per the writing-plans scope rule (multi-subsystem specs become one plan per subsystem). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn NEXUS from a beautiful read-only dashboard into a console that *tells you what to do* and *does it for you* — shipping all 22 brainstormed features across four coherent phases, without ever breaking the running app or the v2 rollback path.

**Architecture:** A three-module **substrate** lands first — pure `intel/derive.mjs` (the brain), `core/actions.mjs` (the one audited "do" path), `core/notify.mjs` (the event surface). ~85% of the 22 features are then **pure renderer-side derivations + additive UI** that consume the substrate and need **zero data-contract change and zero main-process change**. The remaining ~15% (tray HUD, real security remediation, Claude-session spawn, screenshot capture) are isolated into a late phase behind explicit CONTRACT.md / IPC-CONTRACT.md asks.

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
2. **One dispatch path.** Every side-effect (navigate, cast, complete quest, capture, scan, spawn Claude) goes through `core/actions.mjs`. Buttons, palette, Oracle, and Familiar all call `dispatch(id, ctx)` — so there is exactly one place to audit, guard, and telemetry-log actions.
3. **Tolerant mounts.** Every new surface renders a calm empty state when its data block is absent (the established realm pattern: `enabled: () => true` + guarded reads). A missing field never blanks the rail or throws.
4. **Feature flags in `localStorage`.** Each epic ships behind a `hq-ff-<epic>` flag (default on once verified, but instantly killable) so a regression is a toggle away, not a revert.
5. **Additive commits, `fe:` prefix, selftest between each.** No task lands red. Contract/IPC asks are separate, announced-first, struct/main-gated.
6. **Verify live, not just green.** Each phase ends with a headless capture run (`tools/nexus-shot.js` pattern) reviewed before the phase is called done — behavior observed, per the `verify` discipline.

---

## Shared Substrate — File Structure (Phase 0 builds these)

| File | Responsibility | Lane / contract |
|---|---|---|
| `dashboard-v3/src/intel/derive.mjs` | Pure derivations: `oracle`, `triage`, `forecast`, `anomalies`, `momentum`, `streakRisk`, `spellFit`, `achievementNudges`. Each `f(data,…)→plain`. | fe · no contract |
| `dashboard-v3/src/intel/derive.test.mjs` | `node --test` suite over the golden fixture. | fe · no contract |
| `dashboard-v3/src/core/actions.mjs` | Action registry + `dispatch()`. Wraps `switchRealm`, cast, quest-done, capture, scan-trigger. Single audited seam. | fe · reuses existing IPC |
| `dashboard-v3/src/core/notify.mjs` | Event surface: `emit(evt)` routed to a guarded HTML5 `Notification` (window hidden+permitted) or an injected in-app toaster (visible). For Oracle/streak/Familiar to push messages. **Does NOT replay `changes_since_prev`** — `fx.js` already owns the scan-celebration takeover + its `hq-celebrated` dedup; duplicating it would double-fire. | fe · renderer Notification API (no main change) |
| `dashboard-v3/src/intel/__fixtures__/sample.json` | Frozen copy of a real `latest.json` for headless tests (renderer-local, gitignored-eligible). | fe |

**Key architectural facts the implementer must know:**
- `data.js` exposes `data.bundle` (`.latest .scans .spellbook .telemetry .weeklyRecap .browser`), `data.selected`, `data.scans`, `data.select(i)`. Derive functions take these as **arguments** — never import `data.js` into `intel/` (keeps purity).
- The Command Palette (`src/core/palette.js`, shipped 2026-07-26) already has a `push(kind,label,hint,run,alias)` index and an `activate(it)` seam. Palette-actions (Epic F1) extends this — it does not rebuild it.
- `now-brief.mjs` (`tools/now-brief.mjs`) is a **headless Oracle prototype** already fusing browser focus + git + quests into one next-action. Port its ranking logic into `derive.oracle()` rather than reinventing.
- Electron renderer supports the HTML5 `Notification` API directly — OS notifications need **no** main-process change.
- `node --test` ships with Node 20 (Electron 32). Run pure suites with the app's node: `node --test dashboard-v3/src/intel/derive.test.mjs`.
- **Dual-runtime naming rule (load-bearing):** the pure substrate modules are named `.mjs` (`derive.mjs`, `actions.mjs`, `notify.mjs`) so they are ESM in **both** the Electron renderer (imported with explicit `.mjs` extension from `.js` ESM boot/realms) **and** under `node --test`. Do NOT add `"type":"module"` to `dashboard-v3/package.json` — `dev-main.js`/`nexus-shot.js` use CommonJS `require()` and that flag would break the selftest harness. Import them with the explicit extension everywhere (`import { oracle } from '../intel/derive.mjs'`).

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
- Create: `dashboard-v3/src/intel/derive.mjs`
- Test: `dashboard-v3/src/intel/derive.test.mjs`

**Interfaces:**
- Produces: `oracle(bundle, selected, now) → { action, label, reason, weight, target:{realmId, projectId?, questId?} } | null`
  where `action ∈ {'commit','quest','capture','scan','rest'}`. Pure. `now` is an ISO string or Date (injected for testability — never `Date.now()` inside).

**Field ground-truth (verified against live `data/latest.json` 2026-07-26 — use these exact paths):**
- uncommitted work → `project.metrics.git_safety.dirty` (integer). Also present: `.ahead .behind .unpushed .risk`.
- exposed secrets → `project.metrics.risk_security.secrets_found` (integer). Also `.score`, `.flags[]`.
- staleness → `project.activity.days_since_commit` (integer), `.state ∈ {active,…}`.
- open quests → `quest.status === 'open'` (values seen: `'open'|'done'`), `quest.tier ∈ {red,orange,yellow}`, `quest.id`, `quest.title`, `quest.project_id`.
- xp series → `trends.xp` = `[{d:isoDate, v:number}]`.
- streak → `account.streak.{scan_days, longest_scan_days, last_scan:isoDate}`.

- [ ] **Step 1: Write the failing test**

```js
// derive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracle } from './derive.mjs';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/sample.json', import.meta.url)));

test('oracle: uncommitted files at risk outrank a calm quest', () => {
  const sel = { ...FIX, projects: [
    { id:'p1', name:'A', metrics:{ git_safety:{ dirty: 24 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 0 } },
    { id:'p2', name:'B', metrics:{ git_safety:{ dirty: 0 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 1 } },
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
// derive.mjs — pure derivations. No DOM, no globals, no Date.now().
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// Weighted "what should I do right now". Higher weight wins. Ported from
// tools/now-brief.mjs's next-action heuristic, made pure + testable.
export function oracle(bundle, selected, now) {
  const sel = selected || {};
  const hour = new Date(now).getHours();
  const cands = [];

  for (const p of sel.projects || []) {
    const unc = num(p.metrics?.git_safety?.dirty);
    if (unc > 0) cands.push({
      action: 'commit', weight: 40 + Math.min(unc, 60),
      label: `Commit ${p.name} (${unc} uncommitted)`,
      reason: `${unc} uncommitted files at risk`,
      target: { realmId: 'forge', projectId: p.id },
    });
    const sec = num(p.metrics?.risk_security?.secrets_found);
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
git add dashboard-v3/src/intel/derive.mjs dashboard-v3/src/intel/derive.test.mjs
git commit -m "fe: intel/derive.oracle — pure live 'do this now' recommendation"
```

### Task 0.3: `derive.triage()` + `derive.anomalies()` + `derive.momentum()`

**Files:**
- Modify: `dashboard-v3/src/intel/derive.mjs`
- Modify: `dashboard-v3/src/intel/derive.test.mjs`

**Interfaces (signatures corrected to live data 2026-07-26):**
- `triage(selected) → [{ projectId, name, blastRadius, kind, detail }]` sorted desc by `blastRadius`; `kind ∈ 'security'|'uncommitted'|'stale'|'no-tests'|'no-ci'`. One row per concern per project. Reads `project.metrics.risk_security.secrets_found`, `.git_safety.dirty`, `activity.days_since_commit`, `signals.has_tests`, `signals.has_ci`.
- `anomalies(selected) → { clones, duplicates, empty, reclaimableBytes, items:[{label,kind}] }`. **Field ground-truth:** `selected.inventory.clones[]` items are `{name,…}`; `.duplicates[]` are `{detail,…}`; `.empty[]` are **plain strings**. Inventory items carry NO byte size — `reclaimableBytes` = Σ `selected.projects[].disk.reclaimable_bytes`.
- `momentum(trends, account, now) → { xpSlope, etaDays:number|null, etaNextLevel:isoString|null }`. Least-squares slope over `trends.xp` (`[{d,v}]`) by sample index; `etaDays = account.xp_to_next / xpSlope` when `xpSlope>0`; `etaNextLevel = now + etaDays`. `now` injected. (No `stalling` — that concern lives in `triage`'s `stale` kind.)

- [ ] **Step 1: Write the failing tests** (append to `derive.test.mjs`)

```js
import { triage, anomalies, momentum } from './derive.mjs';

test('triage: secrets outrank a dirty tree; rows sorted desc by blast radius', () => {
  const sel = { projects: [
    { id:'p1', name:'A', metrics:{ risk_security:{secrets_found:2}, git_safety:{dirty:0} }, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} },
    { id:'p2', name:'B', metrics:{ risk_security:{secrets_found:0}, git_safety:{dirty:12} }, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} },
    { id:'p3', name:'C', metrics:{ risk_security:{secrets_found:0}, git_safety:{dirty:0} }, signals:{has_tests:false,has_ci:false}, activity:{days_since_commit:40} },
  ] };
  const r = triage(sel);
  assert.equal(r[0].kind, 'security');
  assert.equal(r[0].projectId, 'p1');
  assert.ok(r.every((x,i,a) => i===0 || a[i-1].blastRadius >= x.blastRadius));
});

test('triage: clean project → no rows; never throws on empty/null', () => {
  assert.deepEqual(triage({ projects:[{ id:'ok', name:'ok', metrics:{risk_security:{secrets_found:0},git_safety:{dirty:0}}, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} }] }), []);
  assert.doesNotThrow(() => triage({}));
  assert.doesNotThrow(() => triage(null));
});

test('anomalies: counts buckets, normalizes heterogeneous item shapes, sums disk', () => {
  const sel = { inventory:{ clones:[{name:'x'},{name:'y'}], duplicates:[{detail:'z mirrors w'}], empty:['e1','e2','e3'] },
    projects:[{disk:{reclaimable_bytes:100}},{disk:{reclaimable_bytes:50}}] };
  const a = anomalies(sel);
  assert.equal(a.clones, 2); assert.equal(a.duplicates, 1); assert.equal(a.empty, 3);
  assert.equal(a.reclaimableBytes, 150);
  assert.equal(a.items.length, 6);
  assert.ok(a.items.every(i => typeof i.label === 'string' && i.kind));
  assert.doesNotThrow(() => anomalies({}));
});

test('momentum: positive slope → finite ETA; flat/empty → null, no div-by-zero', () => {
  const up = momentum({ xp:[{d:'a',v:100},{d:'b',v:110},{d:'c',v:120},{d:'d',v:130}] }, { xp_to_next:50 }, '2026-07-04T12:00:00Z');
  assert.ok(up.xpSlope > 9 && up.xpSlope < 11);
  assert.ok(up.etaDays > 0 && isFinite(up.etaDays));
  assert.equal(typeof up.etaNextLevel, 'string');
  const flat = momentum({ xp:[{d:'a',v:5},{d:'b',v:5}] }, { xp_to_next:50 }, '2026-07-04T12:00:00Z');
  assert.equal(flat.etaDays, null); assert.equal(flat.etaNextLevel, null);
  assert.doesNotThrow(() => momentum({}, {}, '2026-07-04T12:00:00Z'));
});
```

- [ ] **Step 2: Run — FAIL** (`node --test dashboard-v3/src/intel/derive.test.mjs`; the three fns are undefined).

- [ ] **Step 3: Implement beside `oracle` in `derive.mjs`**

```js
export function triage(selected) {
  const rows = [];
  for (const p of (selected?.projects || [])) {
    const sec = num(p.metrics?.risk_security?.secrets_found);
    const dirty = num(p.metrics?.git_safety?.dirty);
    const stale = num(p.activity?.days_since_commit);
    const concerns = [];
    if (sec > 0)     concerns.push({ kind:'security',    blastRadius: 100 + sec,                    detail:`${sec} exposed secret${sec>1?'s':''}` });
    if (dirty > 0)   concerns.push({ kind:'uncommitted', blastRadius: 50 + Math.min(dirty, 40),      detail:`${dirty} uncommitted files` });
    if (stale >= 14) concerns.push({ kind:'stale',       blastRadius: 20 + Math.min(stale, 60) / 2,  detail:`${stale} days since a commit` });
    if (p.signals?.has_tests === false) concerns.push({ kind:'no-tests', blastRadius: 15, detail:'no tests' });
    if (p.signals?.has_ci === false)    concerns.push({ kind:'no-ci',    blastRadius: 10, detail:'no CI' });
    for (const c of concerns) rows.push({ projectId: p.id, name: p.name, ...c });
  }
  return rows.sort((a, b) => b.blastRadius - a.blastRadius);
}

export function anomalies(selected) {
  const inv = selected?.inventory || {};
  const items = [];
  for (const c of (inv.clones || []))     items.push({ label: c?.name || 'clone',      kind: 'clone' });
  for (const d of (inv.duplicates || [])) items.push({ label: d?.detail || 'duplicate', kind: 'duplicate' });
  for (const e of (inv.empty || []))      items.push({ label: typeof e === 'string' ? e : (e?.name || 'empty'), kind: 'empty' });
  const reclaimableBytes = (selected?.projects || []).reduce((s, p) => s + num(p.disk?.reclaimable_bytes), 0);
  return { clones: (inv.clones||[]).length, duplicates: (inv.duplicates||[]).length, empty: (inv.empty||[]).length, reclaimableBytes, items };
}

export function momentum(trends, account, now) {
  const xs = (trends?.xp || []).map((pt, i) => [i, num(pt?.v)]);
  const n = xs.length;
  let xpSlope = 0;
  if (n >= 2) {
    const mx = xs.reduce((s, [x]) => s + x, 0) / n;
    const my = xs.reduce((s, [, y]) => s + y, 0) / n;
    let numr = 0, den = 0;
    for (const [x, y] of xs) { numr += (x - mx) * (y - my); den += (x - mx) ** 2; }
    xpSlope = den ? numr / den : 0;
  }
  const toNext = num(account?.xp_to_next);
  let etaDays = null, etaNextLevel = null;
  if (xpSlope > 0 && toNext > 0) {
    etaDays = toNext / xpSlope;                                  // slope is per-sample (~per-day scan)
    etaNextLevel = new Date(new Date(now).getTime() + etaDays * 86400000).toISOString();
  }
  return { xpSlope, etaDays, etaNextLevel };
}
```

- [ ] **Step 4: Run — PASS** (all tests green, output pristine).
- [ ] **Step 5: Commit** `fe: intel/derive — triage, anomalies, momentum`.

### Task 0.4: `derive.spellFit()` + `derive.streakRisk()` + `derive.achievementNudges()`

**Files:** Modify `dashboard-v3/src/intel/derive.mjs` + `derive.test.mjs`. Reuse the existing `num` helper.

**Interfaces (ground-truthed 2026-07-26):**
- `spellFit(bundle, selected) → [{ spellId, name, forProjectId, why }]`. For each project, for each `signals.<flag> === false` gap, find the first spell whose `name`+`description` (lowercased) contains the gap keyword. Reads `bundle.spellbook.spells[]` (`{id,name,description,school,…}`, 944 live) and `selected.projects[].signals`.
- `streakRisk(streakInfo, now) → { atRisk, hoursLeft, streak }`. `streakInfo` is the `account.streak` object `{scan_days, last_scan:'YYYY-MM-DD'}`. At risk when `scan_days>0` and `last_scan !== today(now)`. `now` injected.
- `achievementNudges(achievements) → [{ id, have, need, label }]` for locked achievements (`unlocked !== true`) with `progress.have/need ≥ 0.5`. `achievements[]` items are `{id, unlocked, progress?{have,need}}` — **no title field**, so `label` falls back to `id`.

- [ ] **Step 1: Write the failing tests** (append to `derive.test.mjs`)

```js
import { spellFit, streakRisk, achievementNudges } from './derive.mjs';

test('spellFit: matches a signal gap to a spell by keyword, scoped to the project', () => {
  const bundle = { spellbook:{ spells:[
    { id:'s1', name:'test-scaffold', description:'adds a test suite' },
    { id:'s2', name:'readme-gen', description:'writes a README' },
  ] } };
  const sel = { projects:[ { id:'p1', name:'A', signals:{ has_tests:false, has_readme:true } } ] };
  const r = spellFit(bundle, sel);
  assert.equal(r.length, 1);
  assert.equal(r[0].spellId, 's1');
  assert.equal(r[0].forProjectId, 'p1');
  assert.match(r[0].why, /test/i);
  assert.doesNotThrow(() => spellFit({}, {}));
});

test('streakRisk: alive-but-unscanned-today is at risk; scanned-today is safe', () => {
  const risk = streakRisk({ scan_days:4, last_scan:'2026-07-25' }, '2026-07-26T20:00:00Z');
  assert.equal(risk.atRisk, true);
  assert.equal(risk.streak, 4);
  assert.ok(risk.hoursLeft > 0 && risk.hoursLeft <= 24);
  const safe = streakRisk({ scan_days:4, last_scan:'2026-07-26' }, '2026-07-26T20:00:00Z');
  assert.equal(safe.atRisk, false);
  assert.doesNotThrow(() => streakRisk({}, '2026-07-26T20:00:00Z'));
});

test('achievementNudges: surfaces near-complete locked achievements only', () => {
  const r = achievementNudges([
    { id:'a', unlocked:true,  progress:{ have:5, need:5 } },   // unlocked → skip
    { id:'b', unlocked:false, progress:{ have:4, need:5 } },   // 0.8 → nudge
    { id:'c', unlocked:false, progress:{ have:1, need:8 } },   // 0.125 → skip
    { id:'d', unlocked:false },                                // no progress → skip
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b');
  assert.equal(r[0].have, 4);
  assert.equal(r[0].need, 5);
  assert.equal(r[0].label, 'b');
  assert.doesNotThrow(() => achievementNudges(null));
});
```

- [ ] **Step 2: Run — FAIL** (three fns undefined).

- [ ] **Step 3: Implement beside the others in `derive.mjs`**

```js
// signal flag → [human label, keyword scanned in spell name+description]
const GAP_MAP = { has_tests:['tests','test'], has_ci:['CI','ci'], has_readme:['a README','readme'], has_license:['a license','license'] };

export function spellFit(bundle, selected) {
  const spells = bundle?.spellbook?.spells || [];
  const out = [];
  for (const p of (selected?.projects || [])) {
    const sig = p.signals || {};
    for (const [flag, [label, kw]] of Object.entries(GAP_MAP)) {
      if (sig[flag] !== false) continue;   // only a true, present gap
      const hit = spells.find((s) => `${s.name || ''} ${s.description || ''}`.toLowerCase().includes(kw));
      if (hit) out.push({ spellId: hit.id, name: hit.name, forProjectId: p.id, why: `${p.name} has no ${label}` });
    }
  }
  return out;
}

export function streakRisk(streakInfo, now) {
  const streak = num(streakInfo?.scan_days);
  const last = streakInfo?.last_scan || null;
  const today = new Date(now).toISOString().slice(0, 10);   // YYYY-MM-DD (UTC)
  const atRisk = streak > 0 && last !== today;
  const hoursLeft = 24 - new Date(now).getUTCHours();        // hours to end of UTC day
  return { atRisk, hoursLeft, streak };
}

export function achievementNudges(achievements) {
  const out = [];
  for (const a of (achievements || [])) {
    if (a.unlocked === true || !a.progress) continue;
    const have = num(a.progress.have), need = num(a.progress.need);
    if (need > 0 && have / need >= 0.5) out.push({ id: a.id, have, need, label: a.title || a.id });
  }
  return out;
}
```

- [ ] **Step 4: Run — PASS** (all tests green, pristine).
- [ ] **Step 5: Commit** `fe: intel/derive — spellFit, streakRisk, achievementNudges`.

### Task 0.5: `core/actions.mjs` — the one dispatch path

**Files:**
- Create: `dashboard-v3/src/core/actions.mjs`
- Test: `dashboard-v3/src/core/actions.test.mjs` (pure registry logic; side-effects injected)

**Interfaces:**
- Produces: `register({id,label,icon?,run,enabled?})`, `dispatch(id, ctx) → {ok, result?, error?}`, `all(ctx) → [{id,label,icon}]` (enabled only), `resolve(id) → action|null`, `_reset()` (test-only). `run(ctx)` may call injected effect-fns; `dispatch` wraps `run` in try/catch so a bad action never throws out of a keystroke (mirrors palette's `activate`).

- [ ] **Step 1: Write the failing test** (`dashboard-v3/src/core/actions.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, dispatch, all, resolve, _reset } from './actions.mjs';

test('dispatch runs the action once and reports ok + result', () => {
  _reset();
  let calls = 0;
  register({ id:'x', label:'X', run: () => { calls++; return 42; } });
  const r = dispatch('x', {});
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.result, 42);
});

test('dispatch swallows a throwing action → {ok:false}; unknown id → {ok:false}', () => {
  _reset();
  register({ id:'boom', label:'B', run: () => { throw new Error('nope'); } });
  let r;
  assert.doesNotThrow(() => { r = dispatch('boom', {}); });
  assert.equal(r.ok, false);
  assert.match(r.error, /nope/);
  assert.equal(dispatch('missing', {}).ok, false);
});

test('all(ctx) lists only enabled actions, projected to {id,label,icon}', () => {
  _reset();
  register({ id:'a', label:'A', icon:'✦', run(){}, enabled: () => true });
  register({ id:'b', label:'B', run(){}, enabled: (ctx) => ctx.allow === true });
  assert.deepEqual(all({ allow:false }).map(x => x.id), ['a']);
  assert.deepEqual(all({ allow:true }).map(x => x.id).sort(), ['a','b']);
  assert.equal(resolve('a').label, 'A');
  assert.equal(resolve('nope'), null);
  assert.deepEqual(Object.keys(all({ allow:false })[0]).sort(), ['icon','id','label']);
});
```

- [ ] **Step 2: Run — FAIL** (`node --test dashboard-v3/src/core/actions.test.mjs`; module missing).

- [ ] **Step 3: Implement `dashboard-v3/src/core/actions.mjs`**

```js
// core/actions.mjs — the ONE audited path for every app side-effect. Buttons,
// the command palette, the Oracle, and the Familiar all dispatch through here,
// so there is exactly one place to guard, log, and reason about actions.
// PURE registry: effect functions are injected at seed time (initActions),
// never imported here — which keeps it unit-testable under node --test.
const REG = new Map();

// action: { id, label, icon?, run(ctx), enabled?(ctx) }
export function register(action) {
  REG.set(action.id, { icon: '', enabled: () => true, ...action });
}

export function resolve(id) { return REG.get(id) || null; }

// Enabled actions projected for a menu/palette. An enabled() that throws is
// treated as "unavailable" rather than crashing the list build.
export function all(ctx) {
  const out = [];
  for (const a of REG.values()) {
    let ok = false;
    try { ok = a.enabled(ctx); } catch { ok = false; }
    if (ok) out.push({ id: a.id, label: a.label, icon: a.icon });
  }
  return out;
}

// Single guarded invocation — a malformed/throwing action can never escape a
// keystroke; it returns {ok:false} and logs, mirroring the palette's activate().
export function dispatch(id, ctx) {
  const a = REG.get(id);
  if (!a) return { ok: false, error: 'unknown-action' };
  try { return { ok: true, result: a.run(ctx) }; }
  catch (err) { console.warn('[actions] dispatch', id, err); return { ok: false, error: err?.message || String(err) }; }
}

// test-only: clear the module-global registry between unit tests.
export function _reset() { REG.clear(); }
```

- [ ] **Step 4: Run — PASS** (3/3, pristine).
- [ ] **Step 5: Commit** `fe: core/actions — unified audited dispatch seam`.

### Task 0.6: Seed the core action set + wire boot

**Files:**
- Modify: `dashboard-v3/src/core/actions.mjs` (register defaults)
- Modify: `dashboard-v3/src/core/boot.js` (call `initActions()` after shell, before palette)

**Interfaces:**
- Adds `initActions(deps)` to `actions.mjs`. `deps = { switchRealm, ordered, hq }`. Registers `go:<realm.id>` per realm plus `scan:now`, `capture:idea`, `quest:done`, `cast` — each effect optional-chain-guarded so a missing preload method degrades to a no-op (never throws). `quest:done`/`cast` read `ctx.questId`/`ctx.spellId` and are `enabled` only when that ctx field is present.
- `boot.js` already imports `switchRealm` (shell) and `ordered` (registry) — inject them; `hq: window.hq`.
- **Verified renderer methods** (guarded): `window.hq.snapshot()` (scan), `window.hq.capture()`, `window.hq.markQuestDone(id)`, `window.hq.castSpell(id)`. Confirm exact names against `dashboard/preload.js` while implementing; the guards mean a mismatch no-ops rather than crashing.

- [ ] **Step 1: Write the failing test** (append to `actions.test.mjs`)

```js
import { initActions } from './actions.mjs';

test('initActions seeds go:<realm> + core verbs from injected deps', () => {
  _reset();
  const switched = [];
  initActions({ switchRealm: (id) => switched.push(id), ordered: () => [{ manifest:{ id:'forge', sigil:'⚒' } }], hq: {} });
  assert.ok(resolve('go:forge'));
  assert.ok(resolve('scan:now'));
  assert.ok(resolve('quest:done'));
  dispatch('go:forge', {});
  assert.deepEqual(switched, ['forge']);
  // quest:done is enabled only with a questId in ctx
  assert.equal(all({}).find(a => a.id === 'quest:done'), undefined);
  assert.ok(all({ questId: 'q1' }).find(a => a.id === 'quest:done'));
  // a missing hq method must not throw when dispatched
  assert.doesNotThrow(() => dispatch('scan:now', {}));
});
```

- [ ] **Step 2: Run — FAIL** (`initActions` undefined). Then implement in `actions.mjs`:

```js
// Register the default app actions, wiring real effects passed in as deps so
// this module stays import-pure. Every effect is optional-chain-guarded — a
// missing preload method (old build / headless) degrades to a silent no-op.
// deps: { switchRealm, ordered, hq }
export function initActions(deps) {
  const { switchRealm, ordered, hq } = deps || {};
  for (const { manifest: m } of (ordered?.() || [])) {
    register({ id: `go:${m.id}`, label: `Go: ${m.id}`, icon: m.sigil, run: () => switchRealm?.(m.id) });
  }
  register({ id: 'scan:now',     label: 'Scan now',       run: () => hq?.snapshot?.() });
  register({ id: 'capture:idea', label: 'Capture idea',   run: () => hq?.capture?.() });
  register({ id: 'quest:done',   label: 'Complete quest', run: (ctx) => hq?.markQuestDone?.(ctx?.questId), enabled: (ctx) => !!ctx?.questId });
  register({ id: 'cast',         label: 'Cast spell',     run: (ctx) => hq?.castSpell?.(ctx?.spellId),      enabled: (ctx) => !!ctx?.spellId });
}
```

- [ ] **Step 3: Run the unit suite — PASS** (`node --test dashboard-v3/src/core/actions.test.mjs`, 4/4 pristine).

- [ ] **Step 4: Wire `boot.js`** — add a static import beside the other core imports (this is the first `.mjs` imported by the renderer — the selftest in Step 5 proves `.mjs` loads over `file://`):

```js
import { initPalette } from './palette.js';
import { initActions } from './actions.mjs';
```

and, right after the existing `initPalette();` call:

```js
// action registry — the one audited dispatch path (buttons/palette/Oracle all
// route through it). Seeded with real effects; guards make a missing preload
// method a no-op. switchRealm + ordered are already imported above.
initActions({ switchRealm, ordered, hq: window.hq });
```

- [ ] **Step 5: Selftest gate** — from `dashboard-v3/`:

Run: `../dashboard/node_modules/electron/dist/electron.exe dev-main.js --smoke --selftest`
Expected: a line `NEXUS boot realms=13 …` and `SELFTEST combos=91 errors=0 PASS` (0 mount errors; the `.mjs` import loaded cleanly in the renderer). If it prints `errors>0` or a `.mjs`/import error, STOP and report — do not commit a red selftest.

- [ ] **Step 6: Commit** `fe: seed core actions + boot wiring` (`git status` shows `actions.mjs`, `actions.test.mjs`, `boot.js`).

### Task 0.7: `core/notify.mjs` — the event surface

**Files:**
- Create: `dashboard-v3/src/core/notify.mjs`
- Test: `dashboard-v3/src/core/notify.test.mjs` (pure routing; effects injected)
- Modify: `dashboard-v3/src/core/boot.js` (init after actions — NO changes replay)

**Scope note (ground-truth 2026-07-26):** `fx.js` already replays `changes_since_prev` into the celebration takeover (`celebrate()` + `hq-celebrated` localStorage dedup at `initFx()`). notify.mjs therefore does **not** touch celebrations — it is the forward-looking surface for the *new* channels (OS notification, later in-app toast) that Phase 1+ features emit through. The `changes_since_prev → OS notification` bridge is deferred to Epic H (#13), coordinated with fx there.

**Interfaces:**
- Produces: `route(evt, env) → { os, toast }` (pure), `emit(evt) → { os, toast }`, `initNotify(deps)`. `route`: `os = env.canNotify && env.hidden`; `toast = !env.hidden` (no in-app toast behind an OS notif). `emit` applies `route` via injected `deps = { isHidden(), canNotify(), notify(evt), toast?(evt) }`, each channel guarded so a throwing effect never escapes the caller. `emit` with no `initNotify` is a safe no-op.

- [ ] **Step 1: Write the failing test** (`dashboard-v3/src/core/notify.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, emit, initNotify } from './notify.mjs';

test('route: OS only when hidden+permitted; toast only when visible', () => {
  assert.deepEqual(route({type:'x'}, { hidden:true,  canNotify:true  }), { os:true,  toast:false });
  assert.deepEqual(route({type:'x'}, { hidden:false, canNotify:true  }), { os:false, toast:true  });
  assert.deepEqual(route({type:'x'}, { hidden:true,  canNotify:false }), { os:false, toast:false });
  assert.deepEqual(route(null, {}), { os:false, toast:false });
});

test('emit routes through injected effects; a throwing effect never escapes', () => {
  const os = [], toast = [];
  initNotify({ isHidden:()=>true, canNotify:()=>true, notify:(e)=>os.push(e.type), toast:(e)=>toast.push(e.type) });
  emit({ type:'streak_risk', title:'t' });
  assert.deepEqual(os, ['streak_risk']);
  assert.deepEqual(toast, []);
  initNotify({ isHidden:()=>false, canNotify:()=>true, notify:()=>{}, toast:()=>{ throw new Error('x'); } });
  assert.doesNotThrow(() => emit({ type:'x' }));
});

test('emit is a safe no-op before initNotify (or after init(null))', () => {
  initNotify(null);
  assert.deepEqual(emit({ type:'x' }), { os:false, toast:false });
});
```

- [ ] **Step 2: Run — FAIL.** Then implement `notify.mjs`:

```js
// core/notify.mjs — the app's event surface. Phase-1+ features (Oracle, streak
// warnings, the proactive Familiar) call emit() to surface a message: an OS
// Notification when the window is hidden+permitted, else an injected in-app
// toaster. PURE routing; every effect is injected, so it's unit-testable and
// can never crash a caller.
// NOTE: the scan celebration takeover is OWNED by fx.js (its own
// changes_since_prev replay + 'hq-celebrated' dedup). notify does NOT replay
// changes, to avoid a double-fire.
let deps = null;   // { isHidden(), canNotify(), notify(evt), toast?(evt) }

export function initNotify(d) { deps = d; }

export function route(evt, env) {
  if (!evt || !evt.type) return { os: false, toast: false };
  const hidden = !!env?.hidden;
  return { os: !!env?.canNotify && hidden, toast: !hidden };
}

export function emit(evt) {
  if (!deps) return { os: false, toast: false };
  const env = { hidden: deps.isHidden?.(), canNotify: deps.canNotify?.() };
  const r = route(evt, env);
  if (r.os)    { try { deps.notify?.(evt); } catch (e) { console.warn('[notify] os', e); } }
  if (r.toast) { try { deps.toast?.(evt);  } catch (e) { console.warn('[notify] toast', e); } }
  return r;
}
```

- [ ] **Step 3: Run the unit suite — PASS** (3/3, pristine).

- [ ] **Step 4: Wire `boot.js`** — add `import { initNotify } from './notify.mjs';` beside the other core imports, and right after the `initActions({...});` call:

```js
// event surface — Phase-1+ features emit through here; fires an OS Notification
// when the window is hidden+permitted (else an in-app toast, wired in a later
// phase). fx.js owns the scan celebration takeover separately, so notify does
// NOT replay changes_since_prev.
initNotify({
  isHidden: () => document.hidden,
  canNotify: () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  notify: (evt) => { try { new Notification(evt.title || 'WorkspaceHQ', { body: evt.body || '' }); } catch {} },
  // toast: wired when the in-app toast UI lands (Epic H)
});
```

- [ ] **Step 5: Selftest gate** — from `dashboard-v3/`: `../dashboard/node_modules/electron/dist/electron.exe dev-main.js --smoke --selftest` → `SELFTEST combos=91 errors=0 PASS`. If red, STOP and report.

- [ ] **Step 6: Commit** `fe: core/notify — OS + toast event surface (fx keeps celebrations)`.

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
- **Files:** `src/core/palette.js` (extend the existing `buildIndex()` — add `all(ctx)` from `core/actions.mjs` as a new `kind:'action'` with `run: () => dispatch(id, ctx)`).
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
- **13 OS notifications:** already in `notify.mjs` (renderer `Notification`) — this epic just enriches copy/sound. **No main change.**
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
