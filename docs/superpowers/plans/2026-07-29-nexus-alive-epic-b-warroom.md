# NEXUS ALIVE — Epic B · The War Room (SITROOM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the program's ONE new realm — a "SITROOM" tactical triage board that renders `derive.triage()` as blast-radius-sorted threat cards with draining HP bars, a live 3D radar, and same-project threat-vector lines, skinned in the Solo Leveling "System" HUD aesthetic (violet neon + hexagon panels), so the Warden sees "what's on fire" and acts in one motion.

**Architecture:** New realm `warroom` (#15). Pure `warroom-model.mjs` turns `triage()` rows into a board model (HP %, severity, radar coords, same-project vector groups) — unit-tested headless. `view.js` renders the 2D SITROOM board (cards + HP bars + kind badges + dispatch remediation) with AOS reveals + anime.js motion. A separate, **disposable** three.js radar module (flag `hq-ff-warroom-3d`, graceful-degrade to Canvas2D) mounts a corner 3D sweep. All game-feel lives in the System-HUD **skin + motion**, scoped to `warroom.css` only — the other 14 realms are untouched.

**Tech Stack:** Electron 32 (Chromium 128, Node ~20), vanilla-JS ESM over `file://`, no build step. Vendored **three.js** + **anime.js** (local ESM, CSP-safe). **AOS** (already integrated). Pure-module tests: `node --test`. Mount integrity: `dev-main.js --smoke --selftest`. Visual: `tools/nexus-shot.js` + `ui-design:design-review`.

## Global Constraints

- **Additive-only contract.** No `latest.json`/sidecar change. Reads only existing fields via `derive.triage(selected)` (already ground-truthed: `project.metrics.risk_security.secrets_found`, `.git_safety.dirty`, `activity.days_since_commit`, `signals.has_tests`, `signals.has_ci`, `project.id/name`).
- **v2 rollback stays one flip away.** `data/.ui-version → "v2"` must fully revert. A new realm is additive; it cannot make v3 the only bootable renderer.
- **IPC frozen & additive-only.** No new `window.hq` channel. Remediation routes through the **existing** registered actions (`go:<realm>`, and `openDrawer` for project-scoped rows). "Send Claude" is an **inert stub** behind `hq-ff-dispatch` (the spawn-session IPC is a Phase-2 ask, not this epic).
- **Lane ownership: frontend owns `dashboard-v3/`.** Every file here is under `dashboard-v3/`. No `collector/`/`schema/`/`spellbook/`/`dashboard/main.js` edits.
- **Selftest is the tripwire.** Adding this realm moves the count **14→15 realms → `combos=105 errors=0 PASS`** (7 themes). It must stay green after every task. (`boot.js` computes the count dynamically — no hardcoded 98 to change.)
- **Copy stays plain** for nexus/daylight (plain register). Rail label: plain `ON FIRE` / default `WAR ROOM` / nightfall `THE MUSTER`. Game-flavor lives in the System-HUD skin + motion, not corny prose.
- **System-HUD skin is realm-scoped.** All Solo-Leveling styling lives in `styles/realms/warroom.css` under `.realm-warroom`. It does NOT touch the shared theme system (decided 2026-07-29: skin first, promote to a full "SYSTEM" theme later if loved).
- **WebGL discipline (hard rule).** The 3D radar MUST fully dispose on `unmount()` (cancel RAF, dispose geometries/materials, `renderer.dispose()` + `renderer.forceContextLoss()`, drop canvas) and MUST `try/catch` context creation, degrading to a Canvas2D radar so it can never throw. The selftest mounts/unmounts warroom 7× — leaked WebGL contexts would fail it.
- **All dynamic HTML `esc()`'d** (XSS), matching the codebase pattern.

**Verified seams (do not re-derive):**
- `derive.triage(selected) → [{ projectId, name, blastRadius, kind, detail }]` sorted desc by `blastRadius`; `kind ∈ 'security'|'uncommitted'|'stale'|'no-tests'|'no-ci'` — `dashboard-v3/src/intel/derive.mjs:45`. Returns `[]` on clean/empty/null input (never throws).
- `dispatch(id, ctx)` — `core/actions.mjs:29`; ids `go:<realm.id>`, `scan:now`, `capture:idea`. `openDrawer(p, prevP, data)` — `ui/components.js:287`. `deriveScanContext(data) → { S, projById, prevProj, isLatest }` — `components.js:91`.
- Realm interface: `manifest { id, sigil, lexKey, order, badge(data), enabled(data) }` + `view { mount(el, ctx), unmount() }`, `ctx = { data, bus, LX, theme, hq }`. Registry sorts by `manifest.order`. Realms register in `src/core/boot.js`, `@import` in `styles/realms.css`, lexicon key in `src/lexicon/lexicons.js` (3 registers).
- `bus.on('data:select', cb)` returns a disposer — `unmount()` MUST call it. Existing realms (e.g. roundtable) are the pattern.
- `el, esc` (`ui/util.js`), `sfx, aos, aosKids` (`ui/components.js`), `switchRealm` (`core/shell.js`).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `dashboard-v3/vendor/three.module.js` | Vendored three.js ESM (local, CSP-safe). | 1 |
| `dashboard-v3/vendor/anime.es.js` | Vendored anime.js ESM. | 1 |
| `dashboard-v3/vendor/README.md` | Provenance + versions + refresh command. | 1 |
| `dashboard-v3/src/realms/warroom/manifest.js` | Realm manifest (id/sigil/lexKey/order/badge/enabled). | 1 |
| `dashboard-v3/src/realms/warroom/view.js` | Mount/unmount + board render (grows across tasks). | 1,3,4,5 |
| `dashboard-v3/styles/realms/warroom.css` | System-HUD skin (violet neon, hexagons, scanlines). | 1,3,4,5 |
| `dashboard-v3/src/core/boot.js` | Register the realm. | 1 |
| `dashboard-v3/styles/realms.css` | `@import` warroom.css. | 1 |
| `dashboard-v3/src/lexicon/lexicons.js` | `tab_warroom` in 3 registers. | 1 |
| `dashboard-v3/src/realms/warroom/warroom-model.mjs` | **Pure** board model from triage rows. | 2 |
| `dashboard-v3/src/realms/warroom/warroom-model.test.mjs` | `node --test` suite. | 2 |
| `dashboard-v3/src/realms/warroom/radar-3d.js` | Disposable three.js radar + Canvas2D degrade. | 4 |
| `dashboard-v3/tools/nexus-shot.js` | Add `warroom` to the shot list (verify only). | 6 |

---

### Task 1: Vendor deps + scaffold + register the realm (selftest 105 green)

**Files:** create `vendor/three.module.js`, `vendor/anime.es.js`, `vendor/README.md`, `src/realms/warroom/manifest.js`, `src/realms/warroom/view.js`, `styles/realms/warroom.css`; modify `src/core/boot.js`, `styles/realms.css`, `src/lexicon/lexicons.js`.

**Interfaces:**
- Produces: a registered `warroom` realm that mounts a placeholder System-HUD panel and unmounts cleanly. `manifest = { id:'warroom', sigil:'⌖', lexKey:'tab_warroom', order:<just after hunts>, badge:(data)=> triage count or 0, enabled:()=>true }`.

- [ ] **Step 1: Vendor three.js + anime.js** (network). From repo root:

```bash
mkdir -p dashboard-v3/vendor
curl -fsSL https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js -o dashboard-v3/vendor/three.module.js
curl -fsSL https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.es.js       -o dashboard-v3/vendor/anime.es.js
node --check dashboard-v3/vendor/anime.es.js && echo "anime ok"
node -e "const s=require('fs').statSync('dashboard-v3/vendor/three.module.js'); if(s.size<100000) throw new Error('three too small'); console.log('three ok', s.size)"
```
If a download fails (offline), STOP and report — Tasks 3–5 can still proceed with a WAAPI/CSS motion fallback, but note it. Write `vendor/README.md` recording exact versions + these refresh commands + "CSP `default-src 'self'` requires local vendoring; do not switch to a CDN `<script>`."

- [ ] **Step 2: Pick the rail order** — read the existing manifests' `order` fields:

Run: `grep -rn "order:" dashboard-v3/src/realms/*/manifest.js`
Choose an `order` that places WAR ROOM immediately **after HUNTS** (triage lives next to the task board). If orders are dense integers, use a fractional value (the registry sorts numerically); otherwise the midpoint between hunts and the next realm.

- [ ] **Step 3: Write `manifest.js`**

```js
// WAR ROOM (SITROOM) — realm #15. The "what's on fire" triage board: renders
// derive.triage() as blast-radius-sorted threats. Badge = active-threat count.
import { triage } from '../../intel/derive.mjs';
import { deriveScanContext } from '../../ui/components.js';

export const manifest = {
  id: 'warroom',
  sigil: '⌖',
  lexKey: 'tab_warroom',
  order: /* chosen in Step 2 */ 3.5,
  enabled: () => true,
  badge: (data) => {
    try { return triage(deriveScanContext(data).S).length || 0; } catch { return 0; }
  },
};
```

- [ ] **Step 4: Write a placeholder `view.js`** (real board arrives in Task 3; this proves mount/unmount + registration):

```js
// WAR ROOM view — SITROOM tactical board (System-HUD skin). Task 1 ships a
// placeholder shell; Task 3 fills the board, Task 4 the 3D radar, Task 5 vectors.
import { el } from '../../ui/util.js';

let rootEl = null, ctxRef = null, offData = null;

function render() {
  const root = rootEl; if (!root) return;
  root.innerHTML = '';
  const sec = el('section', 'realm-warroom');
  sec.innerHTML = `<div class="wr-frame">
    <div class="wr-head"><span class="wr-title">SITROOM</span><span class="wr-sub">standing by…</span></div>
  </div>`;
  root.appendChild(sec);
}

export const view = {
  mount(root, ctx) { rootEl = root; ctxRef = ctx; offData = ctx.bus.on('data:select', render); render(); },
  unmount() { if (offData) { offData(); offData = null; } rootEl = null; ctxRef = null; },
};
```

- [ ] **Step 5: Register** — in `boot.js` add the import pair beside the others and a `register(warroomM, warroomV)` call:

```js
import { manifest as warroomM } from '../realms/warroom/manifest.js';
import { view as warroomV } from '../realms/warroom/view.js';
// …
register(warroomM, warroomV);
```
In `styles/realms.css` add `@import './realms/warroom.css';`. In `lexicons.js` add `tab_warroom` to all three registers: `plain: 'ON FIRE'`, `default: 'WAR ROOM'`, `nightfall: 'THE MUSTER'`.

- [ ] **Step 6: Seed `warroom.css`** with the System-HUD frame primitives (violet neon + hexagon corners + dark panel), scoped under `.realm-warroom`. Use design-system tokens for spacing/type where possible; the violet palette is realm-local:

```css
/* WAR ROOM — SITROOM tactical board in the Solo Leveling "System" HUD skin.
   Realm-scoped (never touches the shared theme system). Violet neon on black,
   hexagon-cut frame, scanline grid. Promote to a full "SYSTEM" theme later. */
.realm-warroom {
  --wr-violet: #a78bfa; --wr-violet-hi: #c4b5fd; --wr-ink: #0d0b16;
  --wr-panel: #16122a; --wr-panel-hi: #1d1836; --wr-line: #3a2f6b;
  --wr-red: #f2555a; --wr-amber: #f2a33c; --wr-yellow: #e6c34a; --wr-dim: #6b6390;
  max-width: var(--measure); margin-inline: auto; color: #e9e6f5;
}
.realm-warroom .wr-frame {
  position: relative; padding: var(--space-5);
  background:
    repeating-linear-gradient(0deg, transparent 0 3px, rgba(167,139,250,.03) 3px 4px),
    linear-gradient(180deg, var(--wr-panel-hi), var(--wr-panel));
  border: 1px solid var(--wr-line);
  /* hexagon-cut corners = the summoned "System" window */
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
  box-shadow: 0 0 0 1px rgba(167,139,250,.15), 0 24px 60px -34px #000;
}
.realm-warroom .wr-head { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
.realm-warroom .wr-title { font-family: var(--term); font-size: var(--fs-lg); font-weight: 700; letter-spacing: .18em; color: var(--wr-violet-hi); text-shadow: 0 0 12px rgba(167,139,250,.5); }
.realm-warroom .wr-sub { font-family: var(--term); font-size: var(--fs-xs); letter-spacing: .1em; color: var(--wr-dim); text-transform: uppercase; }
```

- [ ] **Step 7: Selftest gate** — `dashboard/node_modules/electron/dist/electron.exe dashboard-v3/dev-main.js --smoke --selftest` → expect `NEXUS boot realms=15 …` and `SELFTEST combos=105 errors=0 PASS`. If red, STOP and report.

- [ ] **Step 8: Commit** `fe: scaffold WAR ROOM realm #15 + vendor three.js/anime.js (Epic B)`.

---

### Task 2: `warroom-model.mjs` — pure board model

**Files:** create `src/realms/warroom/warroom-model.mjs` + `warroom-model.test.mjs`.

**Interfaces:**
- Produces: `buildBoardModel(rows) → { threats, vectors, radar }` where `rows` is `triage()` output.
  - `threats: [{ projectId, name, kind, detail, blastRadius, hpPct, sev }]` — same order as `rows` (already blast-sorted). `hpPct = clamp(round(blastRadius / maxBlast * 100), 4, 100)` (0-row → `[]`; `maxBlast` = the top row's blastRadius). `sev = SEV[kind]` (a color-key string `'red'|'orange'|'yellow'|'dim'`).
  - `vectors: [{ projectId, idx: number[] }]` — one entry per project that has **≥2** threats, listing the indexes (into `threats`) of its rows. Single-concern projects produce no vector.
  - `radar: [{ idx, angle, radius, sev }]` — one blip per threat: `angle = (idx / threats.length) * 2π`, `radius = 0.35 + 0.6 * (hpPct/100)` (unit disc 0..1). Pure geometry for the 3D/2D radar.
- Pure. No DOM, no imports. `buildBoardModel(null)`/`([])` → `{ threats:[], vectors:[], radar:[] }`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardModel } from './warroom-model.mjs';

const ROWS = [
  { projectId:'p1', name:'Crucix', kind:'security',    detail:'2 exposed secrets', blastRadius:102 },
  { projectId:'p1', name:'Crucix', kind:'uncommitted', detail:'12 uncommitted',    blastRadius:62  },
  { projectId:'p2', name:'Hamma',  kind:'stale',       detail:'40 days since commit', blastRadius:40 },
];

test('threats: hp normalized to top blast, severity keyed by kind, order preserved', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.threats.length, 3);
  assert.equal(m.threats[0].hpPct, 100);              // top blast = 100%
  assert.equal(m.threats[0].sev, 'red');              // security
  assert.equal(m.threats[1].sev, 'orange');           // uncommitted
  assert.equal(m.threats[2].sev, 'yellow');           // stale
  assert.ok(m.threats[1].hpPct > 4 && m.threats[1].hpPct < 100);
  assert.equal(m.threats[0].name, 'Crucix');
});

test('vectors: only multi-concern projects link; single-concern none', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.vectors.length, 1);                  // only p1 has 2 rows
  assert.equal(m.vectors[0].projectId, 'p1');
  assert.deepEqual(m.vectors[0].idx, [0, 1]);
});

test('radar: one blip per threat, radius grows with hp, angle spread', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.radar.length, 3);
  assert.ok(m.radar.every(b => b.radius >= 0.35 && b.radius <= 0.95));
  assert.equal(m.radar[0].sev, 'red');
});

test('empty / null never throws', () => {
  assert.deepEqual(buildBoardModel([]), { threats:[], vectors:[], radar:[] });
  assert.doesNotThrow(() => buildBoardModel(null));
});
```

- [ ] **Step 2: Run — FAIL** (`node --test dashboard-v3/src/realms/warroom/warroom-model.test.mjs`; module missing).

- [ ] **Step 3: Implement**

```js
// warroom-model.mjs — PURE. Turns triage() rows into the SITROOM board model
// (HP %, severity key, vector groups, radar blips). No DOM, no imports.
const SEV = { security:'red', uncommitted:'orange', stale:'yellow', 'no-tests':'dim', 'no-ci':'dim' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function buildBoardModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { threats: [], vectors: [], radar: [] };
  const maxBlast = list[0]?.blastRadius || 1;   // rows arrive blast-sorted desc
  const threats = list.map((r) => ({
    projectId: r.projectId, name: r.name, kind: r.kind, detail: r.detail,
    blastRadius: r.blastRadius,
    hpPct: clamp(Math.round((r.blastRadius / maxBlast) * 100), 4, 100),
    sev: SEV[r.kind] || 'dim',
  }));
  const byProj = new Map();
  threats.forEach((t, i) => { (byProj.get(t.projectId) || byProj.set(t.projectId, []).get(t.projectId)).push(i); });
  const vectors = [...byProj.entries()].filter(([, idx]) => idx.length >= 2).map(([projectId, idx]) => ({ projectId, idx }));
  const n = threats.length;
  const radar = threats.map((t, idx) => ({ idx, angle: (idx / n) * Math.PI * 2, radius: 0.35 + 0.6 * (t.hpPct / 100), sev: t.sev }));
  return { threats, vectors, radar };
}
```

- [ ] **Step 4: Run — PASS** (4/4, pristine).
- [ ] **Step 5: Commit** `fe: warroom-model — pure SITROOM board model (Epic B)`.

---

### Task 3: The 2D SITROOM board (cards + HP bars + remediation) + motion

**Files:** modify `src/realms/warroom/view.js`, `styles/realms/warroom.css`.

**Interfaces:**
- Consumes: `buildBoardModel` (Task 2); `triage` (`derive.mjs`); `dispatch` (`actions.mjs`); `openDrawer, deriveScanContext, sfx, aosKids` (`components.js`); `el, esc`; anime.js (`../../../vendor/anime.es.js`, default export `anime`).
- Produces: the full board — header `SITROOM ·· N ACTIVE THREATS`, threat cards (name · kind badge · detail · draining HP bar · sev glow · remediation button), empty state `AREA SECURE`. Remediation: project-scoped rows `dispatch('go:'+realmId)` + `openDrawer`; a **disabled** "Send Claude" chip when `hq-ff-dispatch` is off (default off).

- [ ] **Step 1: Rewrite `render()`** in `view.js` (replace the placeholder body). Key points, in code:
  - Guard `ctx.data.selected`; compute `const { S } = deriveScanContext(ctx.data)`; `const rows = triage(S)`; `const model = buildBoardModel(rows)`.
  - Empty → render `AREA SECURE · no active threats` calm panel (no fake danger).
  - Each threat → a `.wr-card` with `data-sev`, kind badge (`SECURITY`/`UNCOMMITTED`/`STALE`/`NO TESTS`/`NO CI` from a `KIND_LABEL` map), `esc(name)`, `esc(detail)`, an HP bar `<i style="width:0%">` (animated to `hpPct` in Step 3), and a remediation `<button class="wr-act">`.
  - Remediation `onclick`: the row carries `projectId` → `dispatch('go:'+ (kind-appropriate realm; project concerns → 'forge'), ctx)` then `openDrawer(projById[projectId], prevProj[projectId], ctx.data)`; `sfx('blip')`. (Task 5 refines vector visuals; nav logic ships here.)
  - Add the inert "Send Claude" chip: `const dispatchOn = (()=>{try{return localStorage.getItem('hq-ff-dispatch')==='on';}catch{return false;}})();` render it `disabled` with title "Send Claude — coming in Phase 2" when off.
  - Store nothing new on the module beyond the existing `offData` disposer (render re-runs on `data:select`).
- [ ] **Step 2: Style the board** in `warroom.css` — `.wr-board` (grid of cards), `.wr-card` (System-HUD panel with `data-sev` left-accent + glow via the `--wr-red/amber/yellow` vars), `.wr-badge` (kind chip), `.wr-hp` track + `.wr-hp > i` fill (sev-colored), `.wr-act` button (≥`--tap-min`), `.wr-empty` (AREA SECURE). Scanline overlay via the existing `.wr-frame` repeating-gradient. All under `.realm-warroom`.
- [ ] **Step 3: Motion** — after appending cards: `aosKids(board, 'fade-up', 60)` for staggered reveal; then anime.js drains the HP bars in:

```js
import anime from '../../../vendor/anime.es.js';
// …after cards are in the DOM:
anime({ targets: sec.querySelectorAll('.wr-hp > i'),
  width: (elm) => elm.getAttribute('data-hp') + '%',
  easing: 'easeOutExpo', duration: 900, delay: anime.stagger(70) });
```
(Set each fill's `data-hp` to its `hpPct` and initial inline `width:0%`.) If the anime import failed to vendor (Task 1 note), fall back to setting `style.width` directly (no throw).

- [ ] **Step 4: `node --check`** `view.js`; **Step 5: Selftest** → `combos=105 errors=0 PASS`. **Step 6: Commit** `fe: WAR ROOM SITROOM board + HP-bar motion (Epic B)`.

---

### Task 4: The 3D radar (disposable three.js + Canvas2D degrade)

**Files:** create `src/realms/warroom/radar-3d.js`; modify `view.js` (mount/unmount hooks), `warroom.css` (radar slot).

**Interfaces:**
- Produces: `createRadar(container, model) → { destroy() }`. Builds a tilted 3D radar disc (three.js) with a sweeping arm + blips from `model.radar`; animates via its own RAF. `destroy()` cancels RAF + fully disposes WebGL. On any WebGL failure, transparently renders a **Canvas2D** radar instead (same `{destroy()}`), so it never throws. Flag `hq-ff-warroom-3d` (default on); off → Canvas2D path directly.

- [ ] **Step 1: Implement `radar-3d.js`** — key requirements (full impl by the executor):
  - `let flag3d = (()=>{try{return localStorage.getItem('hq-ff-warroom-3d')!=='off';}catch{return true;}})();`
  - three.js path in `try`: `WebGLRenderer({ alpha:true, antialias:true })` sized to the container; an orbit-less scene with a violet wireframe disc, concentric rings, a sweeping arm (rotates in RAF), and small emissive blips positioned from `model.radar` (`x=cos(angle)*radius`, `z=sin(angle)*radius`), colored by `sev`. Store `rafId`, all `geometry`/`material` refs.
  - `destroy()`: `cancelAnimationFrame(rafId)`; traverse scene disposing geometries + materials; `renderer.dispose()`; `renderer.forceContextLoss()`; `renderer.domElement.remove()`; null refs.
  - `catch`/flag-off → `drawCanvasRadar(container, model)`: a 2D `<canvas>` sweep (requestAnimationFrame rotating a gradient arm + dots); its `destroy()` cancels RAF + removes the canvas.
- [ ] **Step 2: Hook into `view.js`** — module var `let radar = null;`. In `render()` after the board mounts, if a `.wr-radar` slot exists and there are threats: `radar?.destroy(); radar = createRadar(slot, model);`. In `unmount()`: `radar?.destroy(); radar = null;` **before** nulling refs. (Also destroy at the top of each `render()` to avoid stacking on `data:select`.)
- [ ] **Step 3: Style** the `.wr-radar` slot in `warroom.css` (fixed-size corner box in the header, `position:relative`, the canvas fills it).
- [ ] **Step 4: `node --check`** both JS files. **Step 5: Selftest — the WebGL disposal proof** → `combos=105 errors=0 PASS` with **zero** WebGL/context console errors across the 7 warroom mounts. If any `WebGL`/`context lost`/`too many contexts` errors appear, the disposal is wrong — fix before commit. **Step 6: Commit** `fe: WAR ROOM 3D radar — disposable three.js + Canvas2D degrade (Epic B)`.

---

### Task 5: Threat-vector connectors + polish

**Files:** modify `view.js`, `warroom.css`.

**Interfaces:** consumes `model.vectors`. Draws an SVG overlay linking the cards of each multi-concern project ("under attack on N fronts"), animated on with anime.js (`stroke-dashoffset`).

- [ ] **Step 1:** After cards render, for each `model.vectors[]` compute the on-screen positions of its cards (`getBoundingClientRect` relative to the board) and draw an absolutely-positioned SVG `<path>`/`<line>` overlay (`.wr-vectors`, `pointer-events:none`) connecting them; tag the involved cards with a `.wr-card.linked` class + a small "N-FRONT" pip.
- [ ] **Step 2:** Animate the vector lines in: `anime({ targets:'.wr-vectors path', strokeDashoffset:[anime.setDashoffset,0], easing:'easeInOutSine', duration:700, delay:anime.stagger(120) })`. Recompute/redraw on `data:select` re-render (positions change) — guard against a zero-size board (not yet laid out) by deferring one `requestAnimationFrame`.
- [ ] **Step 3:** Polish pass: severity pulse on the top (most dangerous) card, hover lift, System-HUD hexagon pips on badges. Keep it tasteful — motion serves legibility, not chaos.
- [ ] **Step 4: `node --check`; Step 5: Selftest `combos=105 errors=0 PASS`; Step 6: Commit** `fe: WAR ROOM threat-vector connectors + polish (Epic B)`.

---

### Task 6: Verify live + design-review + close out

**Files:** modify `tools/nexus-shot.js` (add `warroom` to `REALMS`); no source change.

- [ ] **Step 1: Full unit suite** — `node --test dashboard-v3/src/intel/derive.test.mjs dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs dashboard-v3/src/realms/warroom/warroom-model.test.mjs dashboard-v3/src/core/actions.test.mjs dashboard-v3/src/core/notify.test.mjs` → all green.
- [ ] **Step 2: Selftest** `combos=105 errors=0 PASS`; confirm **zero** WebGL errors.
- [ ] **Step 3: Screenshot** — add `'warroom'` to `tools/nexus-shot.js` REALMS, run it, open `tools/shots/nexus/nexus_warroom.png` (and `nightfall_warroom.png`). Confirm: System-HUD frame, blast-sorted threat cards with drained HP bars + kind badges, the 3D radar, vector lines on multi-concern projects, empty-state `AREA SECURE` when clean.
- [ ] **Step 4: Design review** — run `ui-design:design-review` against the War Room (the captured screenshots + the live realm). Address any high-priority legibility/contrast/hierarchy findings (the System-HUD skin must not sacrifice readability).
- [ ] **Step 5: Revert-path smoke** — `localStorage.setItem('hq-ff-warroom-3d','off')` → reload → Canvas2D radar (or none), no errors; board intact. Confirm removing the realm registration is a clean revert (it's additive).
- [ ] **Step 6: HANDOFF entry** — append a `## 2026-07-29 · FROM frontend …` block: Epic B landed (realm #15, System-HUD skin, selftest 105), the three vendored deps, the `hq-ff-warroom-3d` + `hq-ff-dispatch` flags, and that "Send Claude" awaits the Phase-2 spawn-session IPC ask. **Step 7: Commit** `meta: handoff — NEXUS ALIVE Epic B (War Room) landed`.

---

## Self-Review

**Spec coverage:** SITROOM board (T3), System-HUD skin (T1/T3/T5), draining HP bars (T2 model + T3 motion), kind badges + dispatch remediation (T3), 3D radar (T4), same-project threat vectors (T2 model + T5 draw), empty state (T3), realm registration + rail label + selftest 105 (T1), vendored three.js/anime.js + AOS (T1/T3), flag-gating + graceful degrade + WebGL disposal (T4), design-review + screenshot (T6). All covered.

**Placeholder scan:** every step carries real code or an exact command except the deliberately-delegated full impls of `radar-3d.js` (T4) and the vector-geometry (T5), which specify exact interfaces, requirements, and the disposal contract — not hand-waving. No TBD/TODO.

**Type consistency:** `buildBoardModel(rows) → {threats,vectors,radar}` identical across T2 (def), T3/T4/T5 (use), and the test. `createRadar(container, model) → {destroy()}` consistent T4↔view. `triage()`/`dispatch()`/`openDrawer()`/`deriveScanContext()` match the verified seams. Selftest count stated as **105** at every gate.

**Invariant check:** additive (no contract/IPC/main change; "Send Claude" is an inert flagged stub); realm-scoped skin (no shared-theme edit); WebGL fully disposed + graceful-degrade so the selftest can't leak/throw; v2 rollback untouched; every file under `dashboard-v3/`.
