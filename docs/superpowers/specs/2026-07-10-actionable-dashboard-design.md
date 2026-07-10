# Actionable Dashboard — design spec

- **Date:** 2026-07-10
- **Lane:** frontend (`dashboard/` only)
- **Branch:** `refactor/collector-modularization` (shared working tree)
- **Status:** approved design, pre-implementation
- **Origin:** adversarial brainstorm — "how is WorkspaceHQ *actually* useful?"

## Problem

WorkspaceHQ observes work; it does not provoke it. The dashboard scores and displays
(health index, XP, streaks, spellbook) but rarely changes what the user does next.
The adversarial critique named four risks; the sharpest is the **observation→action
gap**: a glance ends in a nicer picture, not a move.

The codebase already half-solves this and then drops it:

- `enterOneThing()` (app.js ~1551) picks the top **open quest** by tier→XP, opens a
  focus overlay (`#onething`), runs a timer, and can mark the quest done.
- **But** it is blind to `git-risk` and `side_quests` that `latest.json` already carries;
  its only verb is "mark done" (no cast-to-fix); and **line 1571 is a dead `console.log`**
  — every completed focus session is discarded. Nothing proves the tool caused action.

## Goal

Finish the wire. Every visit to the dashboard should surface **one** highest-leverage
action, make **doing it** one click, and **remember** that it happened — turning the
vanity metric ("look how much XP") into an evidence metric ("HQ prompted N actions you
actually took").

Non-goals (YAGNI): new gamification, theme changes, any `collector/` edit, a fix-catalog
for actions that have no natural spell.

## Existing infrastructure we build on

| Piece | Location | Role |
|---|---|---|
| `enterOneThing()` / `exitOneThing()` | app.js ~1551–1574 | focus overlay + timer + mark-done |
| `#onething` overlay markup | index.html ~119–127 | the focus takeover |
| `castSpell(s, confirmedHash?)` | app.js ~442 | run a spell via `window.hq.castSpell` |
| Spell-of-the-Day card | app.js ~747 (renderOverview) | precedent for a cast button on overview |
| `data/shards.json` runtime pattern | main.js | precedent: main.js-written runtime state, NOT schema-validated |

## Design

### Component 1 — `computeOneThing(S)`  (app.js, pure function)

Input: the current scan `S`. Output: a single `Action` or `null`.

```
Action = {
  kind: 'quest' | 'git' | 'side_quest',
  id, title, reason,              // reason = why this is #1, human phrase
  project_id, project_name,
  weight,                         // numeric rank score
  quest?,                         // the source quest object, if kind==='quest'
  spell_id?                       // set only if a fix-spell is confidently matched
}
```

Ranking (highest weight wins; ties → smallest effort / newest risk):

1. **red quest** (open/in_progress) — weight by tier then XP (current behavior, preserved).
2. **high git-risk** project — `metrics.risk_security` / `git_safety` high, or unpushed +
   `activity.days_since_commit` large.
3. **high-severity side_quest** — `severity` × `impact` ÷ `effort`.
4. orange/yellow quests, lower risk, etc.

`enterOneThing(quest)` is refactored to accept the computed Action (still defaults to the
quest picker when called with none, so `F` and the FOCUS tab keep working).

### Component 2 — "One Thing" overview card

A persistent card at the top of `renderOverview()` (above Spell-of-the-Day), shown only
on the latest scan:

```
◎ THE ONE THING
<title>                       ↳ <project>
<reason — e.g. "unpushed for 6 days · highest risk">
[ ◎ FOCUS ]
```

- `◎ FOCUS` → `enterOneThing(action)` (existing overlay, now fed the broadened Action).

**Cast-to-fix is deferred, on purpose.** The arsenal (851 castable spells) is almost
entirely Claude Code *skills*, not fixes — nothing in it cleanly resolves an unpushed
commit or a missing README. A `⚡ CAST FIX` button would either never appear or rely on
fuzzy-matching a top action to an unrelated skill. That is over-engineering; we ship the
card + FOCUS now, and revisit cast-to-fix only if/when genuine fix-spells (a push script,
a scribe spell) enter the grimoire. Recorded as a future item, not built.

### Component 3 — Acted-on ledger (the keystone)

Replace the dead `console.log` (1571) with persistence + an evidence surface.

- **Write path (main.js, frontend lane):** new IPC `hq:actedOn` appends an entry to
  `data/acted-on.json`:
  ```
  { entries: [ { at, kind, action_id, project_id, minutes, resolved:boolean, via:'focus'|'cast' } ] }
  ```
  Runtime state, written by main.js only, **not** part of the scan contract (same class as
  `shards.json`) → no CONTRACT.md change, no golden-fixture change. Gitignore-eligible.
- **Callers (app.js):** `exitOneThing(done)` records `{via:'focus', resolved:done}`. (The
  `via` field is kept open so a future cast-to-fix can record `{via:'cast'}` without a
  schema change — but only `'focus'` is written in this slice.)
- **Read path (frontend-owned):** `build-data.mjs` loads `data/acted-on.json` into
  `window.DATA.actedOn` (dashboard/ file → frontend lane). Overview shows a one-line
  evidence strip: *"HQ prompted N actions you took in the last 7 days."* Counted client-side
  from `entries[].at`.

## Data & lane boundaries

- New file `data/acted-on.json` — runtime state, main.js-written, frontend-read. Add to
  `.gitignore` alongside `shards.json`.
- **Zero `collector/` edits.** The weekly-saga "acted-on" narrative (structure lane) is a
  **future HANDOFF ask**, recorded when this slice lands — not built here.
- Files touched: `dashboard/app.js` (compute + card + ledger callers + evidence strip),
  `dashboard/styles.css` (card styling), `dashboard/main.js` (`hq:actedOn` IPC),
  `dashboard/build-data.mjs` (load ledger), `.gitignore` (ignore `data/acted-on.json`).
  `index.html` is untouched — the card and evidence strip are JS-rendered into the overview
  (like the Spell-of-the-Day card); the `#onething` overlay it reuses already exists.

## Error handling

- `computeOneThing` returns `null` when no open quests/risks/side-quests exist → card and
  its logic are skipped (overview renders exactly as today). No throw.
- `data/acted-on.json` missing/corrupt → treated as `{entries:[]}` (try/catch, same as
  telemetry reads). Ledger never blocks render.
- CAST FIX outside Electron → same guard as `castSpell` (alert to launch the app).
- Fix-spell id not present in `D.spellbook` → button hidden, never a broken cast.

## Testing / verification

- Unit-ish: `computeOneThing` over a fixture scan returns the expected top action for
  red-quest, git-risk, and side-quest-dominant cases (node, no Electron).
- Live (Electron capture, offscreen): card renders with the correct one-thing; FOCUS enters
  the overlay; completing focus appends a `via:'focus'` ledger entry; evidence strip counts
  the last-7-days entries.
- Regression: `F` key and FOCUS tab still work; overview with no open work renders unchanged.

## Rollout

Single frontend commit (`fe:` prefix). HANDOFF entry on completion: declare the subproject,
note the new runtime file, and file the weekly-saga ask to the structure lane.
