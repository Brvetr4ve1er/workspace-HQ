# Actionable Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard end every glance with one obvious action and remember when the user takes it — finishing the half-wired One-Thing feature.

**Architecture:** Extract the highest-leverage-action ranking into a pure, unit-tested module (`dashboard/lib/one-thing.js`, dual-mode: `require`-able in Node, `window`-global in the browser). Render a persistent "One Thing" card at the top of the overview that feeds the existing focus overlay. Replace the dead `console.log` in `exitOneThing` with a real acted-on ledger (`data/acted-on.json`) written via a new `main.js` IPC and read back through `build-data.mjs`, surfaced as an evidence strip.

**Tech Stack:** Vanilla browser JS (zero-dependency IIFE renderer), Electron (CommonJS main + preload IPC), Node v25 `node:test` for the one pure module. No bundler, no build step.

## Global Constraints

- **Lane = frontend.** Touch only `dashboard/**` and `.gitignore`. Zero edits to `collector/**`. (CLAUDE.md lane ownership; shared working tree.)
- **No CONTRACT.md change.** `data/acted-on.json` is runtime state (same class as `data/shards.json`) — main.js-written, frontend-read, never schema-validated.
- **Commit prefix `fe:`** for all code commits (per CLAUDE.md lane table).
- **Renderer stays zero-dependency.** No npm packages added to the browser path.
- **XSS-safety:** all scan-derived strings interpolated into `innerHTML` (titles, project names, reasons, insights, side-quest details) MUST be wrapped in the existing `esc()` helper (`app.js:91`, escapes `& < > "`). This matches the Spell-of-the-Day card. Never drop `esc()` — commit subjects and file-derived names are untrusted-ish text.
- **Preserve `latest.json` shape.** This plan reads it, never asks the collector to change it.
- Dashboard is **CommonJS** (`dashboard/package.json` has no `"type"`). `.js` files use `require`/`module.exports`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `dashboard/lib/one-thing.js` | **create** | Pure `computeOneThing(scan) → Action|null` ranking. Dual-export. |
| `dashboard/lib/one-thing.test.js` | **create** | `node:test` unit tests for the ranking. |
| `dashboard/index.html` | modify (1 line) | Load `lib/one-thing.js` before `app.js`. *(Deviation from spec's "index.html untouched" — required for the extracted, testable module.)* |
| `dashboard/app.js` | modify | Render the One-Thing card + evidence strip; refactor `enterOneThing`/`exitOneThing` to consume an Action and record the ledger. |
| `dashboard/styles.css` | modify | `.onething-card` + `.acted-strip` styling. |
| `dashboard/main.js` | modify | `hq:acted-on` IPC handler + `ACTED_ON_FILE`. |
| `dashboard/preload.js` | modify | Expose `hq.actedOn(entry)`. |
| `dashboard/build-data.mjs` | modify | Load `data/acted-on.json` → `window.DATA.actedOn`. |
| `.gitignore` | modify | Ignore `data/acted-on.json`. |

**Action shape** (produced by Task 1, consumed by Tasks 2–3):
```
Action = {
  kind: 'quest' | 'git' | 'side_quest',
  id: string,              // quest id, `git-<projectId>`, or side-quest id
  title: string,
  reason: string,          // one-line "why this is #1"
  project_id: string|null,
  project_name: string|null,
  weight: number,
  quest: object|null       // the source quest object when kind==='quest', else null
}
```

---

### Task 1: `computeOneThing` pure ranking module + unit tests

**Files:**
- Create: `dashboard/lib/one-thing.js`
- Test: `dashboard/lib/one-thing.test.js`

**Interfaces:**
- Consumes: a scan object with `quests[]`, `projects[]`, `side_quests[]` (shapes from `latest.json`).
- Produces: `computeOneThing(scan) → Action|null` (shape above); also `window.computeOneThing` in the browser.

- [ ] **Step 1: Write the failing test**

Create `dashboard/lib/one-thing.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeOneThing } = require('./one-thing.js');

const quest = (o) => ({ id: 'q1', status: 'open', tier: 'red', xp: 100, age_days: 3, title: 'Init git', insight: 'no repo', project_id: 'p1', ...o });
const sideq = (o) => ({ id: 's1', kind: 'risk', severity: 'medium', impact: 'medium', effort: 'M', title: 'Rotate secrets', detail: 'exposed key', project_id: 'p1', project_name: 'Proj', ...o });
const proj = (o) => ({ id: 'p1', name: 'Proj', activity: { days_since_commit: 6 }, metrics: { git_safety: { has_git: true, risk: 'high', unpushed: true, ahead: 2, dirty: 5 } }, ...o });

test('returns null for an empty or missing scan', () => {
  assert.equal(computeOneThing(null), null);
  assert.equal(computeOneThing({}), null);
  assert.equal(computeOneThing({ quests: [], projects: [], side_quests: [] }), null);
});

test('a red quest outranks a medium side-quest', () => {
  const a = computeOneThing({ quests: [quest()], projects: [], side_quests: [sideq()] });
  assert.equal(a.kind, 'quest');
  assert.equal(a.id, 'q1');
  assert.equal(a.quest.title, 'Init git');
});

test('a high-risk unpushed repo outranks an orange quest', () => {
  const a = computeOneThing({
    quests: [quest({ tier: 'orange', xp: 60, age_days: 5 })],
    projects: [proj()],
    side_quests: [],
  });
  assert.equal(a.kind, 'git');
  assert.equal(a.project_id, 'p1');
  assert.match(a.title, /Push Proj/);
});

test('a high-severity side-quest wins when no quests or git risk exist', () => {
  const a = computeOneThing({ quests: [], projects: [], side_quests: [sideq({ severity: 'high', impact: 'high', effort: 'S' })] });
  assert.equal(a.kind, 'side_quest');
  assert.equal(a.id, 's1');
});

test('idea side-quests and done quests are never picked', () => {
  const a = computeOneThing({
    quests: [quest({ status: 'done' })],
    projects: [],
    side_quests: [sideq({ kind: 'idea', severity: 'high' })],
  });
  assert.equal(a, null);
});

test('a clean, low-risk repo produces no git candidate', () => {
  const a = computeOneThing({
    quests: [],
    projects: [proj({ metrics: { git_safety: { has_git: true, risk: 'low', unpushed: false, ahead: 0, dirty: 0 } } })],
    side_quests: [],
  });
  assert.equal(a, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dashboard/lib/one-thing.test.js`
Expected: FAIL — `Cannot find module './one-thing.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/lib/one-thing.js`:
```js
'use strict';
// Pure ranking: given a scan, pick the single highest-leverage action to surface.
// Dual-mode: require()'d by the node test AND loaded as a plain <script> in the
// renderer (attaches window.computeOneThing). No build step, no dependencies.

const TIER_BASE = { red: 100, orange: 60, yellow: 30 };
const SEV_BASE = { high: 75, medium: 45, info: 10 };
const IMPACT_BONUS = { high: 15, medium: 8, low: 0 };
const EFFORT_PENALTY = { S: 0, M: -5, L: -10 };
const KIND_ORDER = { quest: 0, git: 1, side_quest: 2 }; // tie-break: quests first

const clamp = (n, max) => (n > max ? max : n < 0 ? 0 : n);

function questCandidates(S) {
  return (S.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .map((q) => ({
      kind: 'quest', id: q.id, title: q.title,
      reason: q.insight || `+${q.xp || 0} XP · ${q.age_days || 0}d open`,
      project_id: q.project_id || null, project_name: null,
      weight: (TIER_BASE[q.tier] || 0) + clamp(q.xp || 0, 40) + clamp(q.age_days || 0, 20),
      quest: q,
    }));
}

function gitCandidates(S) {
  const out = [];
  for (const p of S.projects || []) {
    const g = p.metrics && p.metrics.git_safety;
    if (!g || !g.has_git) continue;
    const pushRisk = !!g.unpushed || (g.ahead || 0) > 0;
    const highRisk = g.risk === 'high';
    if (!pushRisk && !highRisk) continue;
    const days = (p.activity && p.activity.days_since_commit) || 0;
    out.push({
      kind: 'git', id: `git-${p.id}`,
      title: pushRisk ? `Push ${p.name}` : `Stabilize ${p.name}`,
      reason: [
        pushRisk ? `${g.ahead || 0} unpushed` : null,
        g.dirty ? `${g.dirty} dirty` : null,
        `${days}d since commit`,
        `risk ${g.risk || 'n/a'}`,
      ].filter(Boolean).join(' · '),
      project_id: p.id, project_name: p.name,
      weight: 70 + (highRisk ? 25 : 0) + clamp(days, 15) + (pushRisk ? 15 : 0),
      quest: null,
    });
  }
  return out;
}

function sideQuestCandidates(S) {
  return (S.side_quests || [])
    .filter((s) => (s.kind === 'risk' || s.kind === 'urgent') && (s.severity === 'high' || s.severity === 'medium'))
    .map((s) => ({
      kind: 'side_quest', id: s.id, title: s.title,
      reason: s.detail || `${s.severity} · ${s.impact || '?'} impact · ${s.effort || '?'} effort`,
      project_id: s.project_id || null, project_name: s.project_name || null,
      weight: (SEV_BASE[s.severity] || 0) + (IMPACT_BONUS[s.impact] || 0)
            + (EFFORT_PENALTY[s.effort] || 0) + (s.kind === 'urgent' ? 10 : 0),
      quest: null,
    }));
}

function computeOneThing(S) {
  if (!S) return null;
  const all = [...questCandidates(S), ...gitCandidates(S), ...sideQuestCandidates(S)];
  if (!all.length) return null;
  all.sort((a, b) =>
    (b.weight - a.weight)
    || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    || String(a.id).localeCompare(String(b.id)));
  return all[0];
}

if (typeof module !== 'undefined' && module.exports) module.exports = { computeOneThing };
if (typeof window !== 'undefined') window.computeOneThing = computeOneThing;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test dashboard/lib/one-thing.test.js`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/one-thing.js dashboard/lib/one-thing.test.js
git commit -m "fe: computeOneThing — pure highest-leverage-action ranking + tests"
```

---

### Task 2: Load the module + render the One-Thing card

**Files:**
- Modify: `dashboard/index.html` (add script tag before `app.js`)
- Modify: `dashboard/app.js` (card render + `enterOneThing`/`exitOneThing` refactor)
- Modify: `dashboard/styles.css` (card styling)

**Interfaces:**
- Consumes: `window.computeOneThing` (Task 1), existing `enterOneThing`/`exitOneThing` overlay, `el`/`esc`/`aos` helpers, `ov` overview container, `cur`/`SCANS`/`isElectron` in-IIFE state.
- Produces: an on-screen card; `enterOneThing(action)` now accepts an Action; `otKind`/`otProj` tracked for Task 3.

- [ ] **Step 1: Load the module before `app.js`**

In `dashboard/index.html`, find:
```html
  <script src="data.js"></script>
  <script src="vendor/aos.js"></script>
  <script src="app.js"></script>
```
Insert the one-thing module immediately before `app.js`:
```html
  <script src="data.js"></script>
  <script src="vendor/aos.js"></script>
  <script src="lib/one-thing.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 2: Refactor `enterOneThing` / `exitOneThing` to consume an Action**

In `dashboard/app.js`, find the One-Thing state line:
```js
  let otTimer = null, otStart = 0, otQid = null;
```
Replace with:
```js
  let otTimer = null, otStart = 0, otQid = null, otKind = null, otProj = null;
  // Accept either an Action (from computeOneThing) or a raw quest object (legacy callers).
  const toAction = (x) => !x ? null : (x.kind ? x
    : { kind: 'quest', id: x.id, title: x.title, project_id: x.project_id || null, project_name: null, quest: x });
```

Find the body of `enterOneThing` (the block that starts `function enterOneThing(quest) {` and computes `const q = quest || ...`). Replace the function up to (and including) the `otQid = q.id; otStart = ...` line with:
```js
  function enterOneThing(input) {
    const S = SCANS[cur];
    const act = toAction(input) || (typeof computeOneThing === 'function' ? computeOneThing(S) : null);
    if (!act) return;
    const projName = act.project_name || (S.projects || []).find((p) => p.id === act.project_id)?.name || '';
    $('ot-quest').textContent = act.title;
    $('ot-proj').textContent = projName ? '↳ ' + projName : '';
    otQid = act.id; otKind = act.kind; otProj = act.project_id || null; otStart = performance.now();
```
(Leave the rest of `enterOneThing` — the `tick`/timer/overlay-show lines — unchanged.)

In `exitOneThing`, find:
```js
    console.log(`[one-thing] ${mins}m focused on ${otQid}`);
    if (done && isElectron && otQid) { SFX.coin(); window.hq.markQuestDone(otQid); }
    otQid = null;
```
Replace with (mark-done only for real quests; Task 3 fills the ledger call):
```js
    if (done && isElectron && otKind === 'quest' && otQid) { SFX.coin(); window.hq.markQuestDone(otQid); }
    // [Task 3 inserts the acted-on ledger call here]
    otQid = null; otKind = null; otProj = null;
```

- [ ] **Step 3: Render the card at the top of the overview**

In `dashboard/app.js`, inside `renderOverview(...)`, find the Spell-of-the-Day block start:
```js
    const sotd = a.spellcraft?.spell_of_day;
```
Immediately **before** that line, insert:
```js
    // The One Thing: the single highest-leverage move, one click from focus.
    const otAction = (typeof computeOneThing === 'function' && cur === SCANS.length - 1) ? computeOneThing(S) : null;
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
```

- [ ] **Step 4: Style the card**

In `dashboard/styles.css`, append:
```css
/* ------------------------------------------------ The One Thing (overview) */
.onething-card {
  padding: 12px 15px; margin-bottom: 16px;
  background: linear-gradient(90deg, rgba(255,210,63,.10), transparent 55%), var(--card);
  border: 2px solid var(--ink);
  box-shadow: 0 0 0 2px var(--gold, #ffd23f), 0 0 18px -6px var(--gold, #ffd23f);
}
.otc-eyebrow { font-family: var(--px); font-size: 8px; letter-spacing: 1px; color: var(--gold, #ffd23f); margin-bottom: 8px; }
.otc-title { font-family: var(--px); font-size: 12px; color: var(--text); line-height: 1.55; }
.otc-proj { font-family: var(--term); font-size: 15px; color: var(--muted); margin-top: 3px; }
.otc-reason { font-family: var(--term); font-size: 15px; color: var(--muted); margin: 6px 0 10px; }
.otc-actions { display: flex; gap: 8px; }
.otc-focus { font-family: var(--px); font-size: 9px; padding: 8px 14px; cursor: pointer;
  background: rgba(255,210,63,.12); color: var(--gold, #ffd23f);
  border: 2px solid var(--ink); box-shadow: 0 0 0 1px var(--gold, #ffd23f); }
.otc-focus:hover { background: rgba(255,210,63,.24); }
```

- [ ] **Step 5: Verify live (Electron offscreen capture)**

Create `dashboard/_shot_onething.js`:
```js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 950, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile('index.html');
  await new Promise((r) => setTimeout(r, 3200));
  fs.writeFileSync('_onething.png', (await win.webContents.capturePage()).toPNG());
  const hasCard = await win.webContents.executeJavaScript(`!!document.querySelector('.onething-card')`);
  fs.writeFileSync('_console.txt', `card:${hasCard}\n` + (errs.join('\n') || 'no errors'));
  app.quit();
});
```
Run (PowerShell, from `dashboard/`): `node_modules\electron\dist\electron.exe _shot_onething.js`
Expected: `_console.txt` shows `card:true` and `no errors`; `_onething.png` shows the gold-framed card at the top of the overview. Click-through (FOCUS) is covered in Task 3's capture.

- [ ] **Step 6: Commit**

```bash
git add dashboard/index.html dashboard/app.js dashboard/styles.css
git commit -m "fe: One-Thing overview card — surface the single highest-leverage move"
```

---

### Task 3: Acted-on ledger — persist the action + evidence strip

**Files:**
- Modify: `dashboard/main.js` (`ACTED_ON_FILE` + `hq:acted-on` IPC)
- Modify: `dashboard/preload.js` (expose `actedOn`)
- Modify: `dashboard/app.js` (ledger call in `exitOneThing` + evidence strip in overview)
- Modify: `dashboard/build-data.mjs` (load ledger into `window.DATA.actedOn`)
- Modify: `.gitignore` (ignore `data/acted-on.json`)

**Interfaces:**
- Consumes: `otKind`/`otProj`/`otQid` (Task 2), `DATA` path const + `fs` in main.js, `el` helper + `ov` container + `cur`/`SCANS` in app.js.
- Produces: `data/acted-on.json` `{ entries: [{ at, kind, action_id, project_id, minutes, resolved, via }] }`; `window.DATA.actedOn`; on-screen evidence strip.

- [ ] **Step 1: Add the IPC handler in `main.js`**

In `dashboard/main.js`, find the telemetry file const:
```js
const TELEMETRY_FILE = path.join(DATA, 'spell-telemetry.json');
```
Immediately after it, add:
```js
const ACTED_ON_FILE = path.join(DATA, 'acted-on.json');
function readActedOn() {
  try { return JSON.parse(fs.readFileSync(ACTED_ON_FILE, 'utf8')); }
  catch { return { entries: [] }; }
}
ipcMain.handle('hq:acted-on', (_e, entry) => {
  if (!entry || typeof entry !== 'object') return false;
  const led = readActedOn();
  led.entries.push(entry);
  if (led.entries.length > 500) led.entries = led.entries.slice(-500); // rolling window
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = ACTED_ON_FILE + '.tmp';                                   // atomic write
  fs.writeFileSync(tmp, JSON.stringify(led, null, 1));
  fs.renameSync(tmp, ACTED_ON_FILE);
  return true;
});
```

- [ ] **Step 2: Expose it in `preload.js`**

In `dashboard/preload.js`, find:
```js
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
```
Immediately after it, add:
```js
  actedOn: (entry) => ipcRenderer.invoke('hq:acted-on', entry),
```

- [ ] **Step 3: Record the ledger entry in `exitOneThing`**

In `dashboard/app.js`, find the marker left by Task 2:
```js
    // [Task 3 inserts the acted-on ledger call here]
```
Replace it with:
```js
    if (isElectron && window.hq?.actedOn) {
      // `mins` is the existing local in exitOneThing (const mins = Math.round(...)). Do NOT rename to `minutes`.
      window.hq.actedOn({ at: new Date().toISOString(), kind: otKind, action_id: otQid, project_id: otProj, minutes: mins, resolved: !!done, via: 'focus' });
    }
```

- [ ] **Step 4: Load the ledger in `build-data.mjs`**

In `dashboard/build-data.mjs`, find the telemetry load:
```js
let telemetry = null;
```
…through its `try { telemetry = JSON.parse(... 'spell-telemetry.json' ...); } catch {}` block. Immediately after that block, add:
```js
let actedOn = null;
try {
  actedOn = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/acted-on.json'), 'utf8'));
} catch { /* no ledger yet */ }
```
Then find the assembled data object:
```js
const data = { scans, latest: scans[scans.length - 1] || null, projectNotes, weeklyRecap, spellbook, telemetry, built_at: new Date().toISOString() };
```
Add `actedOn` to it:
```js
const data = { scans, latest: scans[scans.length - 1] || null, projectNotes, weeklyRecap, spellbook, telemetry, actedOn, built_at: new Date().toISOString() };
```

- [ ] **Step 5: Render the evidence strip in the overview**

In `dashboard/app.js`, in `renderOverview(...)`, immediately after the One-Thing card block from Task 2 (right after its closing `}`), insert:
```js
    // Evidence, not vanity: how often HQ prompted a move the user actually took.
    const led = window.DATA?.actedOn;
    if (led && cur === SCANS.length - 1) {
      const weekAgo = Date.now() - 7 * 86400000;
      const n = (led.entries || []).filter((e) => Date.parse(e.at) >= weekAgo).length;
      const strip = el('div', 'acted-strip', n
        ? `◆ HQ prompted <b>${n}</b> action${n === 1 ? '' : 's'} you took this week`
        : `◆ No prompted actions taken yet — hit <b>FOCUS</b> on the one thing above`);
      ov.appendChild(strip);
    }
```

- [ ] **Step 6: Style the strip**

In `dashboard/styles.css`, append:
```css
/* acted-on evidence strip */
.acted-strip { font-family: var(--term); font-size: 14px; color: var(--muted);
  margin: -6px 0 14px; padding: 6px 10px; border-left: 3px solid var(--gold, #ffd23f); background: var(--card); }
.acted-strip b { color: var(--gold, #ffd23f); }
```

- [ ] **Step 7: Ignore the runtime file**

In `.gitignore`, find the generated-scan-outputs section (the block containing `data/spell-telemetry.json`) and add a line:
```
data/acted-on.json
```

- [ ] **Step 8: Verify live (Electron capture — full round-trip)**

Extend `dashboard/_shot_onething.js` to exercise focus → exit → ledger, replacing the body after `loadFile`:
```js
  await win.loadFile('index.html');
  await new Promise((r) => setTimeout(r, 3200));
  const before = require('node:fs').existsSync('../data/acted-on.json');
  // enter focus on the one thing, then exit as "done"
  await win.webContents.executeJavaScript(`document.querySelector('.onething-card .otc-focus')?.click()`);
  await new Promise((r) => setTimeout(r, 600));
  await win.webContents.executeJavaScript(`document.getElementById('ot-exit')?.click()`);
  await new Promise((r) => setTimeout(r, 600));
  fs.writeFileSync('_onething.png', (await win.webContents.capturePage()).toPNG());
  const after = JSON.parse(require('node:fs').readFileSync('../data/acted-on.json', 'utf8'));
  fs.writeFileSync('_console.txt', `ledger_before:${before} entries_after:${after.entries.length} last:${JSON.stringify(after.entries.at(-1))}\n` + (errs.join('\n') || 'no errors'));
  app.quit();
```
Run (from `dashboard/`): `node_modules\electron\dist\electron.exe _shot_onething.js`
Expected: `_console.txt` shows `entries_after:1` (or +1) with a `via:"focus"` entry, and `no errors`. Rebuild renderer data so the strip reflects it: `node build-data.mjs`.

- [ ] **Step 9: Clean up the throwaway + commit**

```bash
rm dashboard/_shot_onething.js dashboard/_onething.png dashboard/_console.txt
git add dashboard/main.js dashboard/preload.js dashboard/app.js dashboard/build-data.mjs .gitignore
git commit -m "fe: acted-on ledger — persist prompted actions + overview evidence strip"
```

---

## Post-implementation

- [ ] **Append a HANDOFF.md entry** (frontend lane): declare the actionable-dashboard subproject landed; note the new runtime file `data/acted-on.json` (don't schema-validate); file the ASK to the structure lane — *feed `acted-on.json` into the Weekly Saga as an "actions taken" line* (future, collector-side).
- [ ] Regression check in the capture: `F` key and the `◎ FOCUS` tab still enter focus (now via the broadened picker); an overview with no open work renders with no card and the "no prompted actions" strip.

## Self-review notes (traceability to spec)

- Spec Component 1 → Task 1. Component 2 (card + FOCUS) → Task 2. Component 3 (ledger + evidence) → Task 3.
- Cast-to-fix intentionally absent (spec: deferred).
- Zero `collector/` edits; `data/acted-on.json` gitignored, no CONTRACT change — matches spec lane boundaries.
- `index.html` gains one `<script>` line — the single, flagged deviation from the spec, required to load the testable module.
