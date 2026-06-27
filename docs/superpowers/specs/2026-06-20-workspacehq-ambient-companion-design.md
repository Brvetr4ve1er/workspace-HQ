---
title: WorkspaceHQ → The Ambient Companion
date: 2026-06-20
status: approved-design
spine: zero obligation, full invitation
---

# WorkspaceHQ → The Ambient Companion

## Context — why this change

WorkspaceHQ today is a v0.1 that works: a deterministic nightly pipeline
(`collector → assemble → render`) scans ~40 projects with zero manual cost (the
`VEEMO Nightly Workspace Scan` task is healthy — ran 2026-06-20 00:00:01, exit 0),
and feeds a polished RPG-themed Electron dashboard (5 tabs, time machine, mini-HUD,
tray, vault mirroring).

But the author has an "ick" about it, and named all four facets: it can feel like
**vanity metrics / theater**, it risks becoming **the thing you tend instead of
working**, it **doesn't actually know anything true** (completion % is a 50% stub,
soft fields carry forward stale), and it fears becoming **project #41 — abandoned**.

The ick is not a sign the tool is bad. It is good taste outrunning the
implementation. The decisive correction reached during brainstorming: **"costs
nothing" means zero _obligation_, not zero _presence_.** A garden and a chore can
both be visited daily — one demands weeding, the other only delights. We remove the
weeding, keep the garden. The dashboard stays loved; the joy stays; the warmth
stays. We make them **honest and effortless**.

**Intended outcome:** a tool the author loves opening and never has to tend — that
tells the truth, celebrates only what was actually earned, and occasionally says
the perfect quiet thing.

## Vision (one line)

A tool you love visiting and never have to tend — that tells you the truth,
celebrates only what you've actually earned, and occasionally says the perfect
quiet thing.

## Principle (the spine)

**Zero obligation, full invitation.** Nothing ever *requires* the user; everything
*rewards* them when they choose to look. Every design decision below is checked
against this: does it add an obligation? If yes, cut or automate it.

---

## Design

### 1. Surfaces — kept, not buried

The dashboard is **not** demoted. All three surfaces keep their place; what changes
is that none of them ever *demands* attention.

- **Dashboard (`dashboard/index.html`, `app.js`, `styles.css`)** stays home — all
  5 tabs, time machine, drawers, charts. The single felt change: it is **always
  already tidy on arrival** (no quests to groom, no stale numbers, no chores). The
  user visits to enjoy and reflect, never to maintain.
- **Tray + mini-HUD (`main.js`, `mini.html`)** = the ambient layer. A glance, never
  a demand. Occasionally carries one quiet line (see §5).
- **Notifications (`main.js`)** = rare, batched (**max one per scan**), and only
  ever **measured + actionable + new** (see §4).

### 2. Honest joy — keep the game, earn every point

Keep XP, levels, streaks, achievements, the celebration. The vanity-metrics ick was
never "too much joy" — it was *unearned* joy. Make every point trace to a measured
act.

- **Audit `schema/gamification.config.json`** so every XP/health source maps to a
  real, measured event: a push, a build going green, a quest closed on real
  evidence, a project shipped/archived. Remove or down-weight any source that
  rewards mere activity (file touches) over outcomes.
- **Fix the streak.** Today the streak counts *days the scanner ran* (`scan_days`,
  computed in `collector/assemble.mjs`) — i.e. it rewards the machine showing up.
  Re-base it on **days the user actually committed/pushed** (already available from
  the collector's git facts in `data/raw-metrics.json`). The fire becomes the
  user's, not the cron job's.
- **Graduation, not decay.** Add a project lifecycle state
  (`active | shipped | archived`) to the data model. A project that goes quiet
  because it is *done* (e.g. shipped/archived, or marked complete) graduates to a
  **"Shipped" shelf** and leaves the attention surfaces — instead of rotting into
  `activity.state: dormant`, which currently reads as neglect. Finishing looks like
  winning. Set in `assemble.mjs`; rendered as a distinct shelf/section in the
  dashboard and excluded from "at risk" / quest derivation.

### 3. Zero-grooming mechanics (so the dashboard is always tidy on arrival)

The user must never *maintain* the board; it resolves itself on measured evidence.

- **Strengthen self-closing quests** in `assemble.mjs`: broaden and harden the
  `auto_complete_when` evaluation, and **auto-dismiss stale quests** (open beyond an
  age threshold with no supporting evidence still present).
- **Garbage-collect `data/quest-overrides.json`**: prune entries whose quests no
  longer exist or have long since closed, so cruft never accumulates.
- Net effect: opening the dashboard never presents a chore.

### 4. Never bluff — honesty for free

By restricting the ambient layer to measured facts, it becomes *constitutionally
unable to bluff*; honesty falls out of the spine at no extra cost.

- **Quarantine estimates.** The 50% completion stub and any carried-forward soft
  field (insights, suggestions, roadmap, build/test status) is **visibly marked as
  an estimate** in the dashboard (the `~` prefix logic already exists at
  `dashboard/app.js:~284`; extend it consistently) **and barred from the ambient
  layer** — tray tooltip, mini-HUD, voice lines, and notifications read
  **measured-only** fields.
- **Notification contract** (`main.js`): a change earns a notification only if it is
  **measured** (derived from deterministic git/build/secret facts, not a soft
  field), **actionable** (needs the user's hands), and **new** (state changed since
  last shown). Good news and estimates never notify. The `changes_since_prev` /
  `notify` flagging in `assemble.mjs` is tightened to this rule.

### 5. The voice — quiet, warm, deterministic

Warmth through precision and timing, not volume. No LLM (honors the 2026-05-27
decision to retire the nightly LLM; keeps the voice free, instant, and honest).

- A small **curated line library** — new file `dashboard/voice.json` — maps
  **measured events** to small pools of hand-written lines, e.g.: `build_greened`,
  `project_shipped`, `streak_earned`, `one_push_from_green`, `long_quiet_but_done`,
  `red_appeared`.
- A tiny `collector/voice.mjs`, called by `assemble.mjs`, emits a `voice` field
  into the dated scan JSON: the chosen line + the event that triggered it, selected
  deterministically (keyed off the scan date + project id, so it is stable for a
  given snapshot and varies across days).
- Rendered **sparingly**: an occasional tray tooltip line (`main.js`), one line atop
  the dashboard (`app.js`), and the text of the rare notification. Mostly silent.
- Tone: a friend who knows your work and respects your time. Example —
  *"Crucix went quiet three weeks ago — but it shipped. That's not neglect, that's
  done."*

### 6. Scope — small enough to finish (this is v1)

- **In (v1 floor):** the six items above, all on the **existing** pipeline +
  Electron shell. No architectural rewrite.
- **In (v2 layer):** the local-model AI Guide (separate surface, baked + live,
  auto-detected) and the UI scale-up — see *Design v2* below.
- **Out (explicitly):** cloud / token-cost LLM enrichment, a web version,
  multi-machine sync, any new always-on background daemon. We make what exists
  *honest and warm* and add the local AI Guide on top, then we stop. Done = this
  list completed and dogfooded on WorkspaceHQ's own scan for one week.

---

## Design v2 — The AI Guide (the hyperinteractive layer)

Added 2026-06-20, after the spine was approved. A **separate** surface from the
deterministic voice (§5), so the honest floor and the smart layer never blur.

**What it is:** a distinct in-dashboard **AI Guide** — a coach/assistant panel —
powered by a **local model** (auto-detected LM Studio or Ollama; both expose an
OpenAI-compatible endpoint). Persona: **GLaDOS × Navi, retro-gamer** — dry,
sardonic, deadpan-witty, but a real guide underneath ("Hey! Listen!").
**Guardrails:** playful, never actually demoralizing; grounded **only** in the
measured scan data (no invented facts).

**What it does (all four):** next-move coaching, contextual UX help, smart
narration, ask-anything panel.

**When it runs (baked + live):**
- **Baked:** after `assemble`, a **non-blocking** local-model pass writes a `guide`
  block into the dated scan JSON (per-project next-move + a workspace briefing),
  persona-styled, grounded in measured facts. Time-bounded; if no model or it
  errors, the pipeline continues untouched — same clean-fail pattern as
  `collector/enrich.mjs`.
- **Live:** an AI Guide panel in the dashboard talks to the local model on demand
  (ask-anything + "explain this" / "what next" from UI elements), streamed via
  Electron IPC.

**Runtime:** auto-detect — probe LM Studio (`127.0.0.1:1234`) and Ollama
(`127.0.0.1:11434`) on their OpenAI-compatible endpoints with a short timeout; use
whichever answers; none up → graceful deterministic fallback (panel still shows
measured summaries / curated lines, never breaks).

**Honesty boundary:** the AI Guide is *visibly* the AI guide, so it may interpret —
but the **measured instrument surfaces (tray / HUD / notification / deterministic
voice) never carry model output.** §4's "never bluff" is fully preserved.

**UI scale-up:** weave the guide in (panel + inline "Hey! Listen!" affordances on
cards/quests + hover hints) and lift the whole UI from static read-out to
responsive/alive, keeping the existing CRT/arcade theme. Every addition *invites*,
none *nags* (zero obligation).

**New files:** `collector/guide-bake.mjs` (baked pass), `dashboard/llm-local.mjs`
(shared auto-detect client), `dashboard/guide-persona.md` (system prompt); plus the
AI Guide panel woven into `dashboard/app.js` / `index.html` / `styles.css` and live
IPC in `dashboard/main.js` / `preload.js`.

---

## Files touched (map for the implementation plan)

- `schema/gamification.config.json` — XP sources audit, streak basis, weights.
- `collector/assemble.mjs` — streak re-base, project lifecycle/graduation,
  self-closing + auto-dismiss quests, override GC, tightened `notify` flags, emit
  `voice` field, mark estimates.
- `collector/collector.mjs` — confirm git facts needed for "days committed" streak
  are present in `raw-metrics.json` (likely already; verify, extend if not).
- `dashboard/app.js` — Shipped shelf rendering, consistent estimate marking, render
  one voice line, exclude shipped projects from "at risk".
- `dashboard/index.html` / `styles.css` — Shipped shelf section + estimate styling.
- `dashboard/main.js` — measured+actionable+new notification gate, voice line in
  tray tooltip / notification.
- `dashboard/mini.html` — measured-only HUD; optional voice line.
- `dashboard/voice.json` (new) — curated line library.
- `collector/voice.mjs` (new) — deterministic line picker, called by `assemble.mjs`.
- `collector/render.mjs` — reflect lifecycle/Shipped + estimate marking in the
  Markdown mirror (keep the vault report consistent).

## Non-goals / guardrails

- Do not add any step that the user must run by hand to keep data honest.
- Do not introduce a cloud / token-cost LLM anywhere. The local-model AI Guide
  (Design v2) is optional, non-blocking, and degrades gracefully — it must never
  stall the nightly pipeline.
- Do not reward activity over outcomes anywhere in the gamification.
- Do not let any estimated value reach tray / HUD / voice / notification.

## Verification (how we'll know it's done)

1. **Honest joy:** Re-run the pipeline (`.\run-pipeline.ps1`) on a date; confirm in
   the produced scan JSON that every XP delta and the streak value trace to a
   measured git/build event (spot-check 3 projects against `raw-metrics.json`).
2. **Graduation:** Mark/flag a known-finished project; confirm it appears on the
   Shipped shelf and is absent from "at risk" and quest derivation.
3. **Zero-grooming:** Run two consecutive scans without touching the dashboard;
   confirm no quest requires a manual mark-done to stay correct, stale quests
   auto-dismiss, and `quest-overrides.json` does not grow unbounded.
4. **Never bluff:** Confirm no `~`-estimated field is present in the mini-HUD,
   tray tooltip, voice line, or any notification payload; confirm a soft-field-only
   change fires **no** notification while a measured red-build change fires exactly
   one.
5. **Voice:** Trigger each `voice.json` event class via crafted fixture data and
   confirm a tasteful line renders in the dashboard header and (for measured/
   actionable events) the notification — and that most scans produce no line.
6. **Finishable:** All six sections shipped and the tool dogfoods cleanly on its own
   nightly scan for 7 consecutive days with no manual intervention.
