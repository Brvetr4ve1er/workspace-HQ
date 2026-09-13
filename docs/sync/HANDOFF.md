# Handoff log — frontend ⇄ structure

Append-only, **newest entry on top**. Entry format (keep it under ~15 lines):

```
## <date> <time> · FROM <lane> · <branch> @ <short-sha>
DONE: what landed (commits)
IN-FLIGHT: what's half-done / uncommitted
ASKS: what I need from the other lane
BREAKS: anything that changes the other lane's world (contract, files, hotkeys)
```

---

## 2026-09-13 · FROM frontend (PC-BRAIN PHASE 0/1) · main @ bc9790b
DONE: local-model seam + first live swap.

  Approved plan lives at ~/.claude/plans/stateful-sparking-curry.md (WorkspaceHQ →
  PC Brain, six phases). Phases 0 and 1 landed in this commit.

  dashboard/llm-local.js (new): OpenAI-compatible HTTP client. probe() detects
    Ollama (:11434) then LM Studio (:1234) with a 1.5s timeout each; result
    cached 30s. run({system, prompt, model, timeoutMs}) POST /v1/chat/completions.
    Clean-fail contract: on unavailable/error returns {status, reason} — NEVER
    throws. Cache is invalidated on any HTTP error inside run() so a runtime
    that goes down mid-session is re-detected on the next call.

  dashboard/llm-persona.md (new): GLaDOS × Navi system prompt for the future
    Oracle realm. Hard grounding rule: "you may only ground in the context
    given; if the answer isn't there, say so — never invent numbers/names/ids".

  dashboard/main.js: added `hq:llm:probe` IPC (presence-only; no prompts through
    this channel). Swapped `hq:draft-commit` to try local first (30s timeout);
    on {status:'unavailable'|'error'} falls through to the existing
    claudeSessions.run() path (90s Claude CLI). Output contract unchanged;
    added `via:'local:<runtime>'|'claude'` field for renderer diagnostics.

  dashboard/preload.js: `probeLlm()` renderer binding.

  dashboard-v3/src/realms/medbay/view.js + styles/realms/medbay.css:
    "AI runtime:" status strip at the top of med-bay. Paints from module-cached
    LLM_STATUS instantly on re-render; refreshRuntimeStatus() called once on
    mount. Three states: probing (pulse), ok (green dot + runtime + top model),
    off (muted dot + "install Ollama or LM Studio…").

IN-FLIGHT: nothing.
ASKS: none for structure lane yet. Phase 6 (collector/guide-bake.mjs +
  run-pipeline.ps1 insertion) is a struct-lane ask when the time comes;
  Phases 2–5 stay entirely in frontend.
BREAKS: none. draft-commit's return shape is a strict superset (adds `via`);
  existing renderers ignore extras. No contract, hotkey, or IPC channel
  removed. Zero effect until the user installs a local runtime.

USER ACTION for Phase 0 gate: `ollama pull qwen2.5:7b-instruct-q4_K_M`
  (5 GB, fits 8 GB VRAM), then relaunch app → medbay shows the green row.

---

## 2026-09-09 · FROM frontend (v3 IS BACK + STUDIO + ICON SET) · main @ 096a16d
DONE: full pivot away from v4 back to v3, plus two greenfield features.

  UI-VERSION FLIP: data/.ui-version → v3 (user-owned file, one-line change,
  instantly reversible). The v4 renderer stays on disk but nothing loads it.

  STUDIO — screen recording + snipping suite (6 commits):
  086f2ef main-process wire + preload surface + screen-capture.js module.
  eb7a8d8 per-display snip overlay (frozen-desktop + region drag + Esc cancel).
  bdad79e record panel (source picker, mic + system audio, VP9+Opus with codec
    fallback ladder, 500ms MediaRecorder chunks streamed to main via
    hq:studio:rec-chunk, atomic .part→rename).
  61bdf88 STUDIO realm — capture gallery with SNIP/RECORD triggers and honest
    bridge gating.
  ece983d fix (reliability review): panel beforeunload was calling recAbort
    mid-record and deleting the .part; now calls recStop so window close
    finalizes cleanly.
  d00337f fix (security review): hq:studio:settings-set was accepting an
    unvalidated rootOverride that turned shell.trashItem into an arbitrary-
    file trash primitive; patcher now skips that key entirely.
  New IPC channels (all documented in docs/sync/IPC-CONTRACT.md BEFORE
  handlers): hq:studio:{panel-toggle, snip-arm, snip-frozen, snip-commit,
  snip-cancel, rec-sources, rec-start, rec-chunk, rec-stop, rec-abort,
  rec-status, rec-toggle, library-list, library-reveal, library-delete,
  settings-get, settings-set}. Storage: <homedir>/Videos/WorkspaceHQ/
  {screenshots, recordings, .thumbs}. Hotkeys: Ctrl+Alt+S snip, Ctrl+Alt+R
  record, Ctrl+Alt+L open STUDIO realm.

  ICON SET — 29-symbol SVG sprite, hand-authored (Freepik generation would
  have cost 10,500 credits; unlimitedAppliesHere:false on this MCP session):
  ca0e17c the sprite (dashboard-v3/icons/hq-icons.svg) + preview.html +
    dashboard-v3/src/ui/icons.js helper (injectIconSprite / icon(name,opts) /
    hasIcon(name)).
  2f76427 wire the sprite into shell.js rail with sigil fallback + STUDIO
    SNIP/RECORD verbs. boot.js awaits injectIconSprite() before startShell()
    so the first paint sees symbols (a fire-and-forget version rendered 16
    fallback sigils because the fetch was still in flight — verified with a
    throwaway harness).
  96994be favicon set at 16/32/48/128/256 (initially rasterized from the
    roundtable HOME glyph).
  b1aa6bf dedicated i-brand-app mark — nested hex + central hub — and
    re-rasterized favicons. The nested-hex geometry echoes the level-coin
    frame, so the favicon reads as part of the same HUD vocabulary.
  9eb5d63 verb icons on roundtable/hunts/forge — the three most-visible
    surfaces. FOCUS bullseye on QUICK WIN/RESCUE cards, Open + Done on
    every quest row, Send Claude + Add to ideas on all 8 project cards.
    Forge introduces the verbButton() / setLbl() pattern so state
    transitions (Opened ▸ / ✗ Not opened — retry / Saving… / Noted) swap
    the label without wiping the icon.
  84a3cd1 grimoire verb icons — DEEP SCAN (focus), RESCAN + all runnable
    spellcards + drawer RUN (run), drawer Open file (open). 24 live use-refs.
  4b6eb50 medbay verb icons — Re-examine + Run scan + fix-card RUN (run),
    Note for cleanup (idea). 24 live use-refs.
  096a16d summoning verb icons — Start session (dispatch). 1 live use-ref.

VERIFY: v3 selftest combos=112 errors=0 PASS across all 16 realms × 7 themes
  (up from 105 pre-STUDIO). No handler-registered errors from studio IPC in
  the real preload; guarded-call discipline holds. Live icon count on
  grimoire=24, medbay=24, summoning=1, plus roundtable/hunts/forge/rail/studio
  from earlier commits. 0 renderer console errors across all shots.
IN-FLIGHT: nothing uncommitted of mine.
ASKS: none. warroom realm was requested in the fleet brief but does not
  exist in dashboard-v3 (grep for "warroom"/"wr-act"/"wr-claude" returns 0
  hits — the classes live in dashboard-v3/src/ui/components.js .dwr-actionbar,
  which is shared-component territory, not a realm). If the structure lane
  wants a warroom equivalent, the closest v3 realm is watchtower.
BREAKS: dashboard/main.js gained one require + one init line + two
  globalShortcut.register calls for the studio module. dashboard/preload.js
  gained a window.hq.studio namespace (panelToggle, snipArm, recToggle,
  recStatus, libraryList/Reveal/Delete, settingsGet/Set, onCaptureAdded).
  Any tooling that enumerates preload keys will see the new surface.


## 2026-09-05 · FROM frontend (v4.3 — BEAUTIFY SALVAGE + DESIGN GATE) · main @ f4541dd
DONE: salvaged the v4.3 fleet that died on the session limit, then finished it.
  4dd91f2/5ab420f/138168e/c096736 land the four beautify surfaces whose JS+CSS
  both survived (AGENT 11→7 passive outlines, SYSTEM 16→7, NOTES 11→5,
  AUTOMATIONS 9→3). 5c0086e finishes HISTORY, which the fleet left HALF-landed:
  its agent had promoted the momentum forecast into a surface hero and died
  before writing one line of CSS, so every class the hero emitted had zero
  rules, `.lb-tab` had only an `.is-on` modifier (tabs rendered as native
  bordered buttons), and charts.js had dropped `.panel` with nothing replacing
  the background step. 7ac0767 adds the design gate + the two defects it caught.
  f4541dd un-boxes the shared `.chip` — 32 outlined rectangles on PROJECTS
  alone were the "too crowded" complaint in its purest form.
  f4541dd un-boxes the shared `.chip`; 25e76d7 makes `.figure` neutral — it
  was --fs-2xl violet WITH A GLOW on every numeral in the app, which made
  HISTORY/timeline's "2,186 TOTAL XP" a second focal out-shouting the hero and
  blew the <=2 violet budget on any surface with three stats. home.css and
  work.css had each already opted out of it independently.
VERIFY: v4 selftest 9 surfaces / 0 errors PASS; 125/125 unit tests by file;
  v3 regression 105 combos / 0 errors PASS; layout gate 0 findings across all
  13 surface/TAB combinations; 13 screenshots, 0 console errors. REAL-PRELOAD
  run (HQ_V4_PRELOAD=v2) also 9/0 PASS: the four "no handler registered" lines
  it prints are the dev harness registering no IPC at all — all four channels
  exist in dashboard/main.js — and the surfaces degrading to 0 renderer errors
  is the guarded-call discipline proving itself.
BLIND SPOT CLOSED: both harnesses only captured whichever tab mounts first, so
  TROPHIES, TIMELINE, SCREEN TIME and SOCIAL had never been rendered once. They
  now walk every in-surface tab; that is where the .figure rival-focal was found.
NEW TOOLS: `dashboard-v4/tools/shot-surfaces.js` (a PNG per surface — parks the
  window OFFSCREEN, because `show:false` is never composited and capturePage()
  returns a stale frame; the first run wrote AUTOMATIONS pixels into
  history.png) and `tools/check-layout.js` (overlap/overflow/max-3-tiles-per-row;
  rects intersected with clipping ancestors, or scrolled-out content reports
  hundreds of phantom overlaps — 476 findings, 3 real).
IN-FLIGHT: nothing uncommitted of mine. `data/quest-overrides.json`,
  `run-scan.ps1` and `schema/workspace-scan.schema.json` remain pre-existing
  modifications owned elsewhere and were NOT touched.
ASKS: none. The nightly scan still looks stalled (snapshot 2026-09-03, "2d ago")
  — structure lane may want to confirm the scheduled task is firing.
BREAKS: `.chip` in components.css no longer has a border (background step +
  severity wash instead) — any new surface relying on a chip outline must set
  its own. HISTORY cards are `.lb-card`/`.lb-panel` rather than `.panel`, and
  a scoped `.lb-root .panel` override neutralises the two `.panel`s timeline.js
  still emits.


## 2026-08-27 · FROM structure + frontend · main @ 197bcc2
DONE: reliability foundation + v4.2 Phase A start (uncommitted):
  `schema/workspace-scan.schema.json` now declares the existing optional
  `browser` snapshot shape and accepts legacy nullable `todo_fixme`, so
  `latest.json` and all 58 historical reports validate. `run-scan.ps1` now
  passes `-NoEnrich`, matching its unattended/deterministic safety contract;
  the local `VEEMO Nightly Workspace Scan` task is registered (daily midnight
  + logon, Ready, next 2026-08-28 00:00). v4 now links/registers HOME as the
  default surface, uses familiar rail labels (HOME / AGENT / PROJECTS / SYSTEM
  / NOTES / AUTOMATIONS / HISTORY), and makes snapshot age explicit in the
  top strip (`scanned 17d ago` is stale after 7 days). New pure
  `scrubber-core.mjs` + test covers the freshness language.
VERIFY: 13 v4 test files, 117/117 pass; collector regression 22/22 pass;
  touched JS syntax clean; schema history 58/58 valid; scheduler shim parses.
IN-FLIGHT: no commit made. `data/quest-overrides.json` remains a pre-existing,
  user-owned modification and was not changed by this work.
ASKS: Phase B can now split TASKS out of AGENT; HOME's existing hunts mapping
  intentionally remains `work` until that real surface is registered.
BREAKS: schema validation now accepts browser snapshots; scheduled scans no
  longer invoke optional Claude enrichment; v4 starts on HOME rather than WORK.

## 2026-08-19 · FROM frontend (v4.2 — HOME EXEMPLAR) · main @ 525de26
DONE: 525de26 **HOME, the v4.2 exemplar + STYLE REFERENCE.** New files only:
  `dashboard-v4/src/surfaces/home/{view.js,oracle-logic.mjs,oracle-logic.test.mjs}`
  + `dashboard-v4/styles/home.css` (self-injected, index.html unowned).
  v3 roundtable's content reborn under docs/superpowers/specs/2026-08-19-v4-
  design-constitution.md: Oracle hero (derive.oracle → the ONE focal element),
  today-pick-one from account.daily_top3, the 14-pt momentum strip.
  oracle-logic is ADAPTED, not copied: derive.oracle emits v3 realm ids
  (forge/hunts), v4 registers go:work|projects|…, so the map translates and an
  unknown realm falls back to a REAL surface. Button copy names the room it
  opens ("Open Projects") — v3's "Review & commit" promised work a go:* action
  does not do.
VERIFY: 12 v4 test files BY FILE, 115/115, fail 0 (new oracle-logic 7). Offscreen
  harness (scratch userData, deleted) mounting `view` into the real index DOM on
  live data: 0 console errors with AND without a bridge; hero text == the live
  `oracle()` label ("Rotate 4 exposed secrets — Crucix"); HEALTH↔XP toggle
  repaints (21 / #74a8dc → 2,081 / #e8a13c); data:select repaint idempotent;
  0 listeners after unmount. Self-check measured on the DOM: violet accents = 2
  (.oracle, .oracle-go), outlined passive containers = 0, ALL-CAPS sentences = 0,
  section gaps 48/48px, ≤3 cards/row, column = 880px.
  Shots: dashboard-v4/tools/shots/exemplar-home-{wide,default}.png (gitignored).
IN-FLIGHT: none.
ASKS: none — but HOME IS NOT REGISTERED. boot.js/shell.js deliberately untouched;
  whoever wires it adds `{ id:'home', label:'HOME', glyph:'◎', view: homeView }`
  as the FIRST rail entry + flips `startId` default, and may then drop the
  self-inject in favour of a static `<link>` (the injector no-ops either way).
BREAKS: none. No existing file was modified. `styles/home.css` introduces a sans
  UI stack scoped to `.home`; when it is promoted to tokens.css as `--ui`, that
  one block collapses to a var reference.

## 2026-08-19 · FROM frontend (v4.1 Phase 4 — D2 FIX WAVE) · main @ 00912cb
DONE: both Important review findings, contract-first. 061e5b4 (meta)
  IPC-CONTRACT rows BEFORE the handlers. cbeaf77 stream-parse: textFromEvent
  dropped EVERY `result` event; the "it duplicates the assistant text"
  justification only holds for subtype:'success', so error_max_turns /
  error_during_execution / refusals were silently discarded — a red
  "Failed · exit N" chip and an empty pane. Failed results now emit
  `[error: <subtype>]` + the result string when present (never gated on it);
  benign unknown subtypes stay unannounced (`/^error/`, not `!== 'success'`).
  718b6bc the registry `tail` the panes DISPLAY: Phase 3 called a stream-json
  tail "cosmetic" — it is not (v4 agent-pane.js:234, v4 sessions.js:60, v3
  summoning:43 render it verbatim, and capture-save/scan reload the window,
  wiping the live buffer mid-linger). NEW dashboard/session-tails.js records
  the parsed text session-api already pushes; main.js swaps it into `tail` on
  BOTH channels. Zero renderer changes — v3 benefits too.
VERIFY: 13 test files by file, 141/141, fail 0 (new session-tails 13, stream-
  parse 20). V4 SELFTEST surfaces=6 errors=0 PASS; v3 combos=105 errors=0 PASS.
  Real-registry harness (REAL claude-sessions.js + a REAL child process, only
  the exe overridden via its documented `command` test hook): registry tail
  stays raw JSON, `withTails(list())` returns "Checking the collector
  fixtures. / [tool: Grep parseChunk] / Ran out of turns. / [error:
  error_max_turns]" — main.js's exact expression, 9/9 asserts.
IN-FLIGHT: none.
ASKS: none.
BREAKS: **main.js edited** (3 lines at the session-presence block, one hunk):
  `hq:sessions-list` + the `hq:claude-sessions` push now return
  `sessionTails.withTails(...)`. `dashboard/claude-sessions.js` untouched
  (READ-ONLY constraint honored — `git status` clean on it). `tail` keeps its
  string shape; an older main returns the raw tail exactly as before. main.js
  is `node --check`-verified only: booting it would raise a second app beside
  the user's live one (global hotkeys, tray), so the D1 wiring-inspection
  precedent applies.

## 2026-08-19 · FROM frontend (v4.1 Phase 4 — VERIFY) · main @ faeee2f
DONE: **v4.1 LANDED AND VERIFIED — all six surfaces real, game layer restored,
  stream-json live tokens, vitals lit.** Unit tests BY FILE: 12 files (11 v4 +
  dashboard/stream-parse) 121/121. V4 SELFTEST surfaces=6 errors=0 PASS; v3
  SELFTEST combos=105 errors=0 PASS. Offscreen harness (scratch profile,
  deleted) over ALL SIX on live data — 0 console errors per surface, content
  vs data-file ground truth: WORK queue 63 (readout+DOM == buildQueue on
  latest.json), PROJECTS 8 cards == projects.length, SYSTEM 8 organ cards ==
  pc-health.json, MIND 2 vault cards == inventory.vaults, AUTOMATE search
  "test" → "91 matches · showing 24" (== filterSpells on spellbook.json 977),
  LOOKBACK 22 trophy cards · "7 of 22 unlocked" == achievements. Shots:
  dashboard-v4/tools/shots/v41-*.png (7, gitignored). Real-preload harness
  (dashboard/preload.js + session-api.init on real ipcMain, throwing FAKE
  claudeSessions — wiring inspection only, D1 proved the live loop): warden
  LV 7 Overseer · XP 2,081 · 319 to L8 · HEALTH 21 crit · STREAK 3 (==
  latest.json account); palette Ctrl+K opens/focuses/filters/Esc-closes;
  scrubber prev (57/58 PAST) and LATEST each FULL-re-mount the stage; dispatch
  controls enabled (9 target options = 8 pathed projects + placeholder).
IN-FLIGHT: none.  ASKS: none.
BREAKS: none — verify only, zero code files touched.

## 2026-08-19 · FROM frontend (v4.1 Phase 3 — stream + vitals) · main @ f932150
DONE: live token streaming + machine vitals to the main window. 46fd3b1 (meta)
  IPC-CONTRACT: hq:session-output note BEFORE code — same channel, same
  {jobId, chunk} shape; chunk is now PARSED text. 4ec4987 NEW pure CommonJS
  dashboard/stream-parse.js (parseChunk(buffered, chunk) -> {text, rest}):
  assistant text passes through, tool_use becomes one-line [tool: Name hint],
  malformed COMPLETE lines pass through raw (never throw/never drop), PARTIAL
  lines wait in rest; system/user/result protocol events filtered by design
  (result would double-print the answer). session-api.js passes fixed args
  ['-p','--output-format','stream-json','--verbose'] to claudeSessions.start
  and parses every onOutput chunk before pushing; onDone flushes a trailing
  unterminated line. claude-sessions.js UNTOUCHED. f932150 main.js
  pushMachine(): samples once, sends to miniWin (visible-gated, as before)
  AND to the main window — the v4 truth rail's Machine tile goes live.
VERIFY: node --test dashboard/stream-parse.test.mjs 13/13. node --check on all
  3 touched JS. V4 SELFTEST surfaces=6 errors=0 PASS; v3 SELFTEST combos=105
  errors=0 PASS. Fake-seam smoke (scratchpad, deleted): real hq:session-start
  handler + scripted fake claudeSessions — argv asserted, split-mid-line push
  clean, raw stderr passes through, zero JSON leaked to the push.
IN-FLIGHT: none.
ASKS (v4 lane): dashboard-v4/src/surfaces/work/truth-rail.js MACHINE_NOTE
  (~line 20) says main pushes hq:machine to the mini HUD only — stale copy
  now; the tile itself already renders arriving payloads, so this is cosmetic.
BREAKS: none — additive only. Presence consumers of claude-sessions `tail`
  (hq:sessions-list / hq:claude-sessions) now see raw stream-json in the tail
  (cosmetic; registry deliberately untouched — the renderer view goes through
  hq:session-output, which is filtered). Other start()/run() callers pass no
  args and keep the default ['-p']: main.js:642 conjure (start, no args),
  main.js:760 draft-commit (run, no args) — verified unaffected.

## 2026-08-19 · FROM frontend (v4.1 S6 — SOUL: wiring + game layer) · main @ a4d122f
DONE: the five surfaces are WIRED and the soul is back. 08d9f11 boot.js swaps
  projects/system/mind/automate/lookback off placeholderView onto the real
  views. 248004a WARDEN PLATE in the top strip (LV/rank, XP + to-next bar,
  HEALTH with v3's <40 crit / 40-69 strained bands and the fell-since-last-paint
  flash, STREAK) ported field-for-field from v3 chrome.js paintWarden(), plus
  new core/scrubber.js — prev/next/LATEST driving data.select(i), snapshot id,
  n/58 position, LATEST-vs-PAST badge, vs-previous health/xp deltas, and
  off-latest as a MODE (#topstrip[data-past=yes] amber underline). 2025e52 +
  a4d122f the COMMAND PALETTE (Ctrl+K, "/" too): v3's mechanics verbatim over a
  v4 index — GO (go:* from actions.mjs) · DO · QUEUE (buildQueue items) · SPELL
  (977, quota-capped at 5/8 rows so they cannot bury the queue).
  BOUNDARY b1d4d9c HONOURED: the shell answers data:select with a FULL
  unmount+mount of the active surface, never a partial refresh.
VERIFY: node --check on all 6 touched JS. V4 SELFTEST surfaces=6 errors=0 PASS;
  v3 SELFTEST combos=105 errors=0 PASS. Unit tests BY FILE 11 files 108/108.
  Offscreen harness (scratch profile, deleted) over the real index.html on live
  data, BOTH preloads: 32/32 checks, 0 console errors. Warden reads LV 7
  Overseer · XP 2,081 (319 to L8, bar 46.8%) · HEALTH 21 crit · STREAK 3.
  Scrub prev and LATEST each yield a FRESH connected stage node with the old one
  detached (also on LOOKBACK), and the WORK truth rail's Snapshot tile follows
  the scrub — the exact skew b1d4d9c warned about is gone. Palette opens,
  focuses, filters, seeds the WORK form, closes on Esc; scan:now shows only
  under the real preload; capture:idea never listed (dead seam).
IN-FLIGHT: none.
ASKS: none.
BREAKS: **two edits outside S6's stated ownership, both disclosed.**
  (1) `dashboard-v4/index.html` — links the five new sheets and adds
  `<div id="overlays">`; S1 and S2 both filed this as an S6 ASK and no Phase-1
  agent owned the file. system.css/lookback.css self-injectors now no-op.
  S1's "promote .drawer*/.truth-kv/.meter into components.css" ask is DECLINED:
  work.css is document-wide, the classes already resolve, a move is pure churn.
  (2) `dashboard-v4/src/surfaces/work/view.js` — +11 lines, a `work:seed` bus
  subscriber so the palette can seed the dispatch form; it runs the identical
  agent.seed + markSeeded path as the rail's own dispatch verb. No IPC, no
  main-process edits, no contract change; data/quest-overrides.json untouched.
  Phase 3 (main-lane) is unaffected.

## 2026-08-19 · FROM frontend (v4.1 S2 — SYSTEM surface) · main @ 477c277
DONE: SYSTEM surface from v3 medbay+watchtower+social, rebuilt on v4 components
  (477c277), three tabs. MACHINE: 8 pc-health vitals (status word, focal
  numeral, sparkline, diagnosis, teaching), 11 fix cards — COPY always, RUN only
  for danger:'safe'; caution/admin render RUN disabled-with-reason, mirroring
  main's hq:health-fix whitelist — and the Epic-C cleanup panel (capture:note).
  The cleanup ITEM COUNT and the RECLAIMABLE BYTES stay on two separate lines:
  disjoint sources, disjoint work, never recombined. SCREEN TIME: distraction
  dial, weekly rhythm, summary, top-8 platform cards with expandable per-day
  history; honours the time machine. SOCIAL: presence, metrics tiles,
  feed/mentions/outbox via hq.getSocial (read-only by design, 60s poll).
  Derivations in pure screen-core.mjs, 13/13 node --test.
VERIFY: node --check 8/8. Offscreen harness (scratch profile, deleted) over the
  real index.html on live data, BOTH preloads: console errors 0; organs=8
  fixes=11 (dg 9 safe / 1 caution / 1 admin) cleanup=14 captured=17; with the
  real preload exactly 9 RUN enabled and every IPC rejection lands an honest
  retry label; 0 disabled controls without a title; SOCIAL poll timer 1 -> 0
  across unmount; data:select scrub repaints (8 cards -> empty -> 8); the
  no-pcHealth path renders EKG + 8 ghost vitals. V4 SELFTEST surfaces=6 errors=0
  PASS — SYSTEM is not in it yet (unregistered until S6).
IN-FLIGHT: none.
ASKS (S6): register `system` in boot.js. styles/system.css SELF-LINKS from the
  view (idempotent; no-ops the moment index.html links it), so this surface
  needs no index.html edit — BUT index.html links none of the five new sheets
  and only lookback + system self-inject: **projects.css, mind.css and
  automate.css are loaded by nothing today** and those surfaces will mount
  unstyled until S6 adds the <link> tags.
BREAKS: none. Additive files only; no IPC, no main-process edits; boot.js and
  shell.js untouched; data/quest-overrides.json untouched.

## 2026-08-19 · FROM frontend (v4.1 S1 — PROJECTS surface) · main @ 7d93272
DONE: PROJECTS surface built from v3 forge/view.js on v4 components (7d93272):
  grid (search/filter/sort toolbar, health-chip cards, clamped meters, dev
  toggles), drawer (re-entry briefing, Reveal folder via openRepo, dev toggle
  via devStart/devStop+onDevStatus; v3's inline peek facts consolidated here),
  Working-on-now (scan rollups + live tab via state/live.js), Epic-D suggested-
  actions strip (agency proposals -> claude:dispatch / capture:note, honest-
  async). Pure helpers in core.mjs, 10/10 node --test.
VERIFY: node --check 8/8; offscreen harness (scratch profile, deleted) over the
  real index.html on live data: 12/12 asserts, console errors 0, cards==8
  projects, strip rows==min(proposals,8)==8, all disabled controls titled,
  Esc closes drawer, 3x mount/unmount clean. Selftest NOT run for this surface
  (unregistered until S6; boot.js untouched by construction).
IN-FLIGHT: none.
ASKS (S6): register `projects` view in boot.js AND add
  `<link rel="stylesheet" href="./styles/projects.css" />` to dashboard-v4/
  index.html (after work.css). Drawer reuses .drawer*/.truth-kv/.meter from
  work.css — promotion into components.css is S6's call.
BREAKS: none. Additive files only; no IPC, no main-process edits;
  data/quest-overrides.json untouched.

## 2026-08-13 · FROM frontend (v4 SPINE D2 FIX WAVE — CHANGES attribution) · main @ aefd10a
DONE: fixed the one D2 finding (important): the AGENT pane's CHANGES panel
  billed the WHOLE working tree to the session that had just settled — probe()
  ran `git status --porcelain` only AFTER the session ended, so a session that
  changed nothing rendered "<n> files touched in <cwd>" over the user's own
  pre-existing dirt. a400f30 (meta, doc-before-handlers) + aefd10a (fe).
  hq:session-start now snapshots the contained cwd's dirty set BEFORE spawning,
  keyed by jobId (FIFO cap 100, in-memory, never persisted); hq:session-diff
  takes an optional jobId and returns `baseline` =
  {state:'captured',paths}|{state:'unavailable',error}|{state:'none'}. New pure
  dashboard-v4/src/surfaces/work/changes-core.mjs splits into "changed since
  dispatch" / "already dirty at dispatch"; with no baseline it REFUSES to split
  and states the working-tree scope. `git diff --stat` is now labelled whole-tree.
VERIFY: unit tests BY FILE 8 files 71/71 pass (new changes-core.test.mjs 16/16).
  V4 SELFTEST surfaces=6 errors=0 PASS; v3 SELFTEST combos=105 errors=0 PASS.
  node --check on session-api/preload/main + the three ESM files. Fake-seam
  smoke over a REAL git repo (Documents/hq-v4-baseline-scratch, deleted):
  "BASELINE SMOKE checks=14 errors=0 PASS" — a no-op session yields "Nothing
  changed … since this session was dispatched. 2 files were already dirty at
  dispatch." Offscreen Chromium DOM harness confirms both rendered branches.
ASKS: none.
BREAKS: **struct/other consumers — additive IPC only.** dashboard/main.js,
  preload.js and claude-sessions.js are UNCHANGED (sessionDiff already passes
  opts through verbatim). A caller that omits jobId gets `baseline:{state:'none'}`
  and the old {files,stat} fields untouched. data/quest-overrides.json untouched.

## 2026-08-13 · FROM frontend (v4 SPINE Phase D1 VERIFY — the loop closes) · main @ c8fda29
DONE: v4.0 spine VERIFIED end-to-end; no feature code, docs+.gitignore only.
  IPC added by the spine (rows already in IPC-CONTRACT.md): hq:session-start /
  hq:session-kill / hq:session-diff invokes + hq:session-output push. v3
  untouched as rollback (.ui-version still "v3"). Baselines: v4 selftest
  surfaces=6, v3 selftest combos=105.
VERIFY: unit tests BY FILE 7 files 55/55 pass. V4 SELFTEST surfaces=6 errors=0
  PASS; v3 SELFTEST combos=105 errors=0 PASS. Ground truth buildQueue(data/
  latest.json) = {threat:23,task:3,gap:18,idea:19} total 63; real-preload
  offscreen harness (temp dir, real preload.js + session-api.init + claude-
  sessions, deleted): queue DOM 23/3/18/19=63 exact match, Dispatch 63/63
  ENABLED, form select(9 opts)/task/Dispatch all enabled, console errors=0.
  REAL E2E: scratch git repo Documents/hq-v4-e2e-scratch (deleted after) →
  sessionStart via the real bridge → jobId cs-msrhcm5q-1, hq:session-output
  streamed "READY\n", settled status=done exit=0 in the onClaudeSessions push,
  session card rendered, sessionDiff → {files:[],stat:""} clean. Shots:
  dashboard-v4/tools/shots/d1-work-{queue,session}.png (now gitignored — v3
  shots precedent; announced here).
ASKS: none. NOTE: claude CLI refuses to spawn when the app itself is launched
  from inside a Claude Code session (CLAUDECODE env guard, "nested sessions");
  normal desktop launches are unaffected — verified done+READY with it unset.
BREAKS: none. data/quest-overrides.json untouched (pre-existing modification
  still in the tree).
DONE: Phase C landed across c7e442b (System-HUD component language + workbench
  CSS + motion), b9c026e (QUEUE rail: one item component, four real verbs,
  drawer-lite), 4ec88ec (AGENT pane stream/kill/changes + TRUTH rail + mount),
  99841d8 (honest empty output state, severity-true total). A prior agent
  committed those then died pre-verification; this block AUDITED them against
  the plan and ran the verification. No behavioural defect found — the only new
  commit is b1d4d9c, a COMMENT recording that the data:select handler rebuilds
  the queue only (unreachable in v4.0: nothing calls data.select(), v4 has no
  scrubber; the v4.1 scrubber must make it a full re-mount).
VERIFY: node --check 29/29. v4 unit tests BY FILE 55/55 pass. V4 SELFTEST
  surfaces=6 errors=0 PASS (re-run after the edit). v3 regression SELFTEST
  combos=105 errors=0 PASS. Two throwaway offscreen harnesses (deleted):
  console errors=0; queue DOM 23/3/18/19 total 63 matches Node-computed
  buildQueue(latest.json) exactly; verbs Dispatch 63/63 disabled, Done 3/3,
  Note 18/18, Open 26 enabled — every disabled control carries its reason;
  form select/textarea/Dispatch all disabled with the no-bridge title; Kill
  "Select a session first."; output element is <pre> with innerHTML length 0;
  vendored anime.es.js dynamic import resolves (default is a function, so
  motion is real, not silently degraded); drawer opens inside .work-root,
  Esc closes, surface unmount removes it (0 leaked scrims); emulated
  prefers-reduced-motion flips matchMedia and collapses transitions to 0s.
ASKS (main lane, non-blocking): the TRUTH rail cannot show real machine vitals.
  main.js pushMachine() sends hq:machine to miniWin only, and preload exposes
  no pull method — so the tile states that fact instead of a permanent
  "waiting…". An additive hq:machine-sample invoke (or pushMachine also
  targeting the main window) would light it up; the tile already renders a real
  payload if one ever arrives, so it degrades correctly either way.
BREAKS: none — additive, dashboard-v4/ only. .ui-version still "v3".
  data/quest-overrides.json untouched (still modified pre-existing in the tree).

---

## 2026-08-12 · FROM frontend (v4 SPINE Phase B3 session IPC) · main @ 1a68f78
DONE: session IPC per plan B3. dfd9736 (meta:) announced the four rows in
  IPC-CONTRACT.md BEFORE code: hq:session-start/-kill/-diff invokes +
  hq:session-output push. Code: NEW dashboard/session-api.js (renderer sends
  only {cwd,task,label} — no command/args passthrough; cwd containment under
  Documents root mirroring resolveProjectPath; task capped 2000; 15-min
  main-side timeout; git probe spawnSync shell:false; handlers settle, never
  throw), preload.js one additive block (sessionStart/sessionKill/sessionDiff/
  onSessionOutput), main.js ONE hook line after the claude-sessions wiring.
VERIFY: node --check x3; fake-seam smoke (containment rejection both handlers,
  2000-char truncation, output-push shape, kill bool-never-throws, real repo
  diff probe); v3 SELFTEST combos=105 errors=0 PASS; V4 SELFTEST surfaces=6
  errors=0 PASS.
NOTE — commit race (final state): B3's three files were explicitly staged when
  B1's plain `git commit` swept them into 845296b; B1 then rewrote that to
  c78520a (queue files only), un-committing B3's files, after which B2's plain
  commit swept them again — they now live inside 1a68f78 ("fe: v4 state …
  (B2)"). Content verified byte-identical to intent (git hash-object matches
  all three blobs at HEAD). No further rewrites (shared tree, parallel
  sessions live). Fleet agents: stage AND commit by pathspec to avoid this.
ASKS: none. BREAKS: none — additive; channels documented in IPC-CONTRACT.md.

---

## 2026-08-12 · FROM frontend (v4 SPINE Phase A scaffold) · main @ 22ba562
DONE: dashboard-v4/ exists (v4.0 SPINE plan, Phase A). 1721240 substrate copied
  byte-identical from v3 (intel derive/foresight/agency + actions/notify/bus/
  data/util + tests + fixture + vendor/anime.es.js, NO three.js; 29/29 by-file).
  c959b33 scaffold: 6-surface shell (WORK·PROJECTS·SYSTEM·MIND·AUTOMATE·
  LOOKBACK; only WORK real-module, rest honest "Built in v4.1" one-liners,
  zero controls), dev-main.js mirroring v3 (--smoke/--selftest, scratch
  userData, HQ_V4_PRELOAD=v2 → real dashboard/preload.js), System-HUD tokens
  (warroom --wr-* promoted to --hud-*). 22ba562 main.js: v4 branch in the
  .ui-version ternary — the ONLY main.js edit.
VERIFY: node --check 15/15; V4 SELFTEST surfaces=6 errors=0 PASS; real-preload
  smoke boots; v3 regression SELFTEST combos=105 errors=0 PASS after the edit.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json still sits
  modified in the shared tree (pre-existing runtime state) — untouched.
ASKS: none this block (Phase B3 will announce session IPC in IPC-CONTRACT.md
  BEFORE handlers, per plan).
BREAKS: none — additive. .ui-version stays "v3"; flipping to "v4" is opt-in.

---

## 2026-08-02 · FROM frontend (Epic C fix wave) · main @ bd811a7
DONE: consolidated fix wave on Epic C "Foresight" — 3 merge blockers + units.
  · Med-Bay cleanup heading was a FALSE composite. "13 items · ~1.8 GB
    reclaimable" joined disjoint sources: the 13 rows are inventory clones/
    duplicates/empty (NO size field exists on any of them), the 1.8 GB is
    Σ projects[].disk.reclaimable_bytes from 4 products that are not in the
    list, freed by hq.reclaim() elsewhere. Working all 13 rows reclaims ~0
    bytes. Now: heading `Cleanup — 13 items`, plus a separate muted line
    `Separately: ~1.8 GB of build artifacts reclaimable across 4 products —
    freed per project, not from this list.` (omitted when bytes are 0).
    derive.anomalies() untouched; the product count is computed view-side.
  · "Noted" could render on a REFUSED write — the await discarded the resolved
    value, and main's hq:capture-save returns `false` (not a rejection) on
    empty text. Now `ok === false` throws into the existing catch.
  · Capture click traced LIVE against the real preload: main's handler ends
    spawnSync(assemble.mjs) → rebuildData() → **win.reload()**, and `win` is
    the v3 window. Measured with a throwaway harness: the renderer paints ZERO
    frames for the whole main-process block (app visually frozen ~1.6s in the
    emulation, longer with the real assemble), and the reload commits before
    the invoke promise ever resolves — "Noted" is never reached, not merely
    unpainted. UI now promises only `Saving…` (set before the await); a code
    comment records the finding so nobody "fixes" the missing confirmation.
    Failures are now visible (`✗ Not saved — retry` + title), not console-only.
  · Units: derive.momentum()'s slope is per trend SAMPLE (= per scan), so
    `etaDays` was never days — 44 samples over 58 days ≈ 0.76 scans/day, so
    "~13 days" understated the wait ~25%. foresight.mjs now exports
    `slopePerScan` and labels the ETA `~13 scans to L8`, matching the
    "+31.2 XP/scan" figure one line above it that it used to contradict.
    derive.mjs NOT touched (struct lane / contract).
  · nudge.js: `ACH[id]` walked the prototype chain (an id of `constructor`
    rendered "Object") → `Object.hasOwn`. atlas: `falling` no longer borrows
    the flat copy, it says `XP is trending down — no level ETA.`
VERIFY: node --check on all 5 changed files; foresight+derive+actions suites
  23/23 green (was 20 — added clamp-overshoot, empty-kind, unknown-kind and
  KB/MB humanBytes coverage); selftest combos=105 errors=0 PASS; live harness
  runs (real preload / refusal / reload / no-preload) all as described.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json still sits
  modified in the shared tree (pre-existing runtime state) — untouched. NOT pushed.
ASKS (struct/main lane, NOT actioned here): hq:capture-save's synchronous
  spawnSync + unconditional win.reload() makes every quick capture a
  full-dashboard reload with a frozen window. A targeted refresh (or an async
  spawn) would let the renderer show a real confirmation. fe-lane cannot fix
  this without touching dashboard/main.js.
BREAKS: none — additive, all under dashboard-v3/, no IPC/contract change.
  Only renamed field is foresight.mjs's `slopePerDay` → `slopePerScan`; its
  sole consumer (atlas/view.js) moved with it. Copy change: the cleanup empty
  state now reads "No clones, duplicates or empty folders to clear." (was
  "Nothing to clean up.") so it cannot contradict the reclaimable line above it.
  Full report: .superpowers/sdd/2026-08-02-nexus-alive-epic-c-foresight/
  fixwave-report.md.

---

## 2026-08-02 · FROM frontend (nexus-alive Epic C session) · main @ 9454ca7
DONE: NEXUS ALIVE Epic C — Foresight, all 4 tasks (plan: 7fce380; code:
  bc0c654/a98acef intel/foresight.mjs pure adapters, 4488184 atlas momentum
  forecast card #3, f47c15c+a0ee331 medbay anomaly-cleanup panel + working
  capture:note action #4 — corrects the charter's verified-no-op
  capture:idea suggestion, 9454ca7 THIS: ui/nudge.js achievement-nudge strip
  #19 mounted in atlas off top-level S.achievements (NOT S.account.achievements
  — that path is undefined; data.js:64 normalizes the array at top level) +
  carried-over honesty fix: forecast card now shows "based on N scans" so the
  least-squares slope/ETA doesn't outread its sample size. Verified end to
  end: intel+actions suites 20/20 green, selftest combos=105 errors=0 PASS
  (realm count unchanged — additive within existing realms, no new realm),
  offscreen render harness confirmed live-data shape: 3 nudge rows with
  friendly ACH names (Under Control/Well Documented/No Loose Keys, not raw
  ids), forecast card includes the basis line, medbay cleanup header
  unaffected (13 rows), 0 console errors throughout.
  [CORRECTED 2026-08-02 by the Epic C fix wave below: the header read
  "Cleanup — 13 items · ~1.8 GB reclaimable", which was FALSE — the 13 rows
  and the 1.8 GB come from disjoint sources and clearing all 13 frees ~0
  bytes. Now two separate lines; see the fix-wave entry at the top.]
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json sits
  modified in the shared tree (pre-existing runtime state per the prior
  entry) — untouched, unstaged. NOT pushed.
ASKS: none. BREAKS: none — purely additive, all under dashboard-v3/, no
  contract/IPC/main-process change. intel/derive.mjs and intel/foresight.mjs
  stay frozen/pure (labelFor injected into nudgeRows rather than importing
  ui/components.js into intel/, same purity pattern as the rest of Epic C).
  Full task-4 report: .superpowers/sdd/2026-08-02-nexus-alive-epic-c-foresight/
  task-4-report.md.

---

## 2026-08-02 · FROM frontend (nexus-alive Epic B session) · main @ a6d8016
DONE: NEXUS ALIVE Epic B — WAR ROOM / SITROOM, realm #15 (a6d8016 + this fix
  wave). Renders derive.triage() as a sectioned threat board: full cards for
  SECURITY/UNCOMMITTED, compact rows for STALE, one roll-up for HYGIENE, hero
  count + shape line, tilted 3D radar in the header. **Selftest gate moved
  98 → 105 combos** (15 realms × 7 themes) — update any script still asserting 98.
  Fix wave applied both reviews: deleted the SVG threat-vector/N-FRONT system
  (fired on ~100% of cards = zero signal), HP bar denominator re-anchored to a
  per-kind ABSOLUTE ceiling so bars are comparable across time-machine snapshots,
  WCAG AA text token split (--wr-text-dim 5.96:1; --wr-dim is chrome-only now),
  generation-token guard on the post-await anime path, radar framing + reduced
  motion + Remediate aria-labels, badge returns null not 0.
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
BREAKS/NOTES: **712KB of vendored third-party code added and TRACKED** —
  dashboard-v3/vendor/three.module.js (670KB, v0.160.0) and anime.es.js (42KB,
  v3.2.2). Local ESM is CSP-required (default-src 'self' blocks CDN); both load
  via lazy dynamic import, so non-WAR-ROOM realms pay nothing at boot. Two new
  localStorage flags: hq-ff-warroom-3d (default ON, 'off' → Canvas2D degrade)
  and hq-ff-dispatch (default OFF). No contract / IPC / main-process change —
  everything is under dashboard-v3/.
ASKS: none. **STILL OPEN:** the "Send Claude" button (behind hq-ff-dispatch) has
  no backend — it needs the Phase-2 `hq:spawn-session` IPC before it can do
  anything. It is not rendered at all while the flag is off; with the flag on it
  console.warns instead of pretending to work.

## 2026-07-31 · FROM frontend (quality-hardening session) · main @ 6240f64
DONE: production-hardening pass (8858b2a, a25b750, 6240f64). ROOT-FIXED the
  components.js stackedBar negative-width bug you and design-system flagged
  (bw floor 1px; legacy clampRects band-aid deleted — attachBarTip never used
  bw, geometry safe). Deleted dead stub.js + v2 _shot.js/_shot_spellbook.js.
  Surfaced 3 swallowed errors (ambient oracle warn-once, boot Notification
  warn, medbay copy-failure feedback). DAY_MS in ui/util.js (chronicle+legacy).
  Verified each step: selftest combos=105 errors=0 PASS ×3; 0 negative-value
  console errors with 51-scan live data; pure-node stackedBar 60-row check.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json was already
  modified before my session (app runtime state?) — untouched. NOT pushed.
ASKS/BREAKS: none. Audit notes for future lanes: v2↔v3 helper dups (esc/fmtCd/
  fmtDur/agoText) are DELIBERATE parity — don't dedupe while v2 is the rollback.
  dashboard/_shot_onething.js is UNTRACKED on disk — commit or delete, your call.

## 2026-07-29 · FROM frontend (nexus-alive Epic A session) · main @ 75843b6
DONE: NEXUS ALIVE Epic A — The Oracle (93c7c6e oracle-logic, 4402233 hero card,
  e308641 ambient mirror, 75843b6 drawer fix). Home realm now leads with the single
  live "do this now" from the tested pure derive.oracle(), routed through the audited
  dispatch() path; one-line echo in the ambient rail ("DO NOW"). Flag hq-ff-oracle
  (default on) — OFF restores the legacy computeOneThing hero byte-for-byte. Night/rest
  empty state. No contract/IPC/main change; all under dashboard-v3/. Verified: 20 unit
  tests green, selftest combos=98 errors=0 PASS, live screenshot (Oracle correctly
  surfaced "Rotate 4 exposed secrets — Crucix" above all commits/quests), adversarial
  code review found 0 real bugs. Plan:
  docs/superpowers/plans/2026-07-29-nexus-alive-epic-a-oracle.md.
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
ASKS/BREAKS: none. **NOTE for whoever builds Epic B (War Room):** the nexus-alive
  program plan's realm-count math is STALE — it says 13 realms → 14 after War Room
  (98 combos). But SOCIAL (realm 14) already landed (6cd4828), so the app is ALREADY
  at 14 realms × 7 = 98 combos NOW. War Room makes it 15 realms → selftest target
  becomes 105, NOT 98. Fix the plan's gate when you spin Epic B.

## 2026-07-29 · FROM frontend (design-system session) · main @ 591418d
DONE: NEXUS Design System Tasks 8+9 COMPLETE (591418d). Per-realm measure caps
  (--measure 880px): roundtable/forge/chronicle cap the reading column; lands/legacy
  cap text/storage columns ONLY (isometric map + trend charts stay full-width via
  :has()/direct-child selectors — no markup change); grimoire full type/spacing token
  pass (fs-*/space-* ramps, 0 sub-12px, tap-floor on buttons, 3-line desc clamp);
  medbay long PowerShell fix-commands soft-wrap (pre-wrap) — kills the ~2000px hscroll.
  Also FIXED the legacy <rect> negative-width bug you flagged: clampRects() clamps
  data-derived rect w/h non-negative at the 2 stackedBar call sites → the ~168 console
  errors/viewport are GONE. Verified: selftest combos=98 errors=0 PASS; committed
  ux-after.json (gapDistinct 16→7, tinyTargets→0 in all realms).
IN-FLIGHT: starting NEXUS ALIVE Epic A (The Oracle) — roundtable hero card + ambient
  mirror consuming derive.oracle(). fe-lane, additive, flag hq-ff-oracle. No contract.
ASKS/BREAKS: none for you (all CSS is nexus-scoped; 1 JS clamp). **ROOT-CAUSE HANDOFF
  (shared lane):** the real fix for the <rect> bug is components.js:153 — bw =
  Math.min(30, slot-7) goes negative at ~39+ days history; ideal is
  bw = Math.max(0, Math.min(30, slot-7)). My clamp only covers legacy; any realm using
  stackedBar with dense data still needs the component-level fix.

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 6cd4828
DONE: SOCIAL realm — in-app face for the SOCIAL BINDING (6cd4828). New realm 14
  renders connected accounts + per-platform metrics tiles + Feed/Mentions/Outbox
  tabs w/ platform filter, read live via a new ctx.hq.getSocial(). Read-only
  (sending stays in the popup gate). Data plumbing mirrors browser-activity:
  readSocial() on the bridge + ONE ipcMain.handle('hq:social-read') next to
  hq:browser-live + one preload line (IPC-CONTRACT.md updated). Registered in the
  3 seams (boot/realms.css/lexicons tab_social x3). Born on --space-*/--fs-*
  tokens. Verified: 14 realms, social mounts 0 overflow/0 tiny/0 console errors;
  driven with injected data → all sections render; scraped text esc()'d (XSS-safe).
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
ASKS/BREAKS: new IPC channel hq:social-read (renderer reads data/social/* via
  main; read-only, additive). Frontend-lane only. **FYI bug I found (NOT mine,
  NOT fixed):** the `legacy` realm throws ~168 console errors/viewport —
  `<rect> attribute width: negative value ("-0.3")` (an SVG chart bar computing a
  negative width). Pre-existing, in your design-system realm surface — worth a
  Math.max(0, w) clamp in legacy/view.js's chart code.

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 15a4d85
DONE: SOCIAL BINDING phase 3b — Instagram/Threads/Facebook/YouTube adapters
  (15a4d85). Platform set complete: 9 adapters. IG read+metrics (private web API,
  read-only — no text posts); Threads metrics + gated GraphQL post; FB account +
  gated post; YouTube InnerTube (SAPISIDHASH) notifications, posting refused.
  Fragile write mutations gated behind THREADS_CREATE_DOC_ID/FB_CREATE_DOC_ID
  constants (empty → clear error, no silent fail). manifest gains the 5 Meta/YT
  hosts. Verified: all 4 stage through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted. Meta/YT reads+writes need live doc_id/params
  capture (flagged inline) — reliable wins are IG read+metrics + YT notifs.
ASKS/BREAKS: browser-bridge/social.js + manifest.json only; no contract change
  (all 9 platforms already in SOCIAL_PLATFORMS). Still frontend-lane only;
  grimoire.css untouched (your Task 8 token migration of my .toolbar2 stands).

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 0621e78
DONE: SOCIAL BINDING phase 3 — X/Twitter + LinkedIn adapters + Reddit top-level
  posts (ae90ae8 contract, 0621e78 code). Additive target/title fields on the
  outbox action (Reddit subreddit + title) → Reddit /api/submit. X adapter:
  public web bearer + ct0 cookie (auth clean), GraphQL HomeTimeline/CreateTweet
  with X_QID/X_FEATURES constants to refresh live (query IDs rotate). LinkedIn:
  Voyager + JSESSIONID csrf, /me + notifications + normShares. manifest adds
  x.com/twitter.com/*.linkedin.com. Verified: reddit-submit + x + linkedin stage
  through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted from me. Live scrape/post needs logged-in-tab
  checks (esp. the X GraphQL IDs). Meta (IG/Threads/FB) + YouTube = phase 3b.
ASKS/BREAKS: outbox action shape gained additive optional target/title (CONTRACT
  updated) — no break, other platforms ignore them. Still frontend-lane only.
  FYI re your Task 8: my grimoire .toolbar2 controls are still raw-px, ready for
  your token migration; I have NOT touched grimoire.css since.
DONE: NEXUS Design System Tasks 1-6 landed (plan: docs/superpowers/plans/2026-07-26-nexus-design-system.md;
  driven by the measured UX teardown). tokens.css ramps (--space-*/--fs-*/--measure/--tap-min/--ambient-w,
  linked index.html:10); committed measurement harness tools/ux-measure.js + tools/ux-baseline.json (the
  before/after oracle); responsive ambient rail (clamp, 20.6%→18% @1280); global 32px tap-floor (tiny-targets
  0/13, min-width scoped to .tm-nav so collapsed rail is safe); stray ⟩-glyph fix (ambient.js, was U+27E9
  font-fallback); base/components/chrome fully migrated to spacing+type tokens (0 raw px font-size); 12 realm
  sheets migrated + flat-realm hierarchy (headingStep ≥1.25× on summoning/observatory/watchtower/atlas/conjure,
  cascade-fixed via :root[data-theme=nexus] .realm-X h2.sec); restored .sotd-k nowrap (0162977). selftest
  91/91 throughout; combined HEAD healthy. Metrics so far: gapDistinct 16→10, fontSizeDistinct 32→25.
IN-FLIGHT/OPEN: Task 6 finding #2 (Medium) UNVERIFIED — sub-12px pixel-font captions promoted to 12px in
  theme-UNSCOPED forge/watchtower base rules (esp. watchtower dial SVG <text> y=108) need a multi-theme
  (arcade/nightfall/daylight) screenshot check + revert any that crowd/overlap. Fix-agents died 3× on API
  errors, so this is unfinished. Ledger: .superpowers/sdd/2026-07-26-nexus-design-system/progress.md.
ASKS: Tasks 7-9 remain. Task 7 = lands 6.5px tower labels → ≥12px + de-overlap. Task 8 = grimoire.css FULL
  token migration (deferred here to avoid your contested edits) incl. snapping your .toolbar2 filter controls
  + medbay 2059px code hscroll + per-realm measure caps. Task 9 = final ux-measure before/after; the ≤7-gap/
  ≤8-font global gate needs cinematic.css h2.sec (15px) + ui/components.js SVG chart text addressed (out of
  the original 3-sheet scope — decide: migrate or document as exceptions).
BREAKS: none functional — additive CSS tokens + 1-line ambient.js glyph fix, all selftest-green. Pre-push:
  NEXUS ALIVE Phase 0 PII-in-history squash still pending (fixture commit 17c557d, unpushed).

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 25dbea7
DONE: SOCIAL BINDING phase 2 — Mastodon + Reddit adapters (25dbea7). Both are
  in-tab adapters behind the phase-1 seam (browser-bridge/social.js only, plus
  manifest host perms + a popup "Connect Mastodon" field). Mastodon: token from
  page initial-state, timeline/notifications/verify_credentials + statuses
  post/reply, federated instance is user-config (optional host permission).
  Reddit: session-cookie JSON (/.json, inbox.json, me.json for karma+modhash) +
  reply/comment via /api/comment; top-level submit deferred (needs subreddit+
  title the generic action can't carry). Verified: reddit-reply + mastodon-post
  stage through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted from me. Live scrape/post for all 3 platforms
  needs a one-time check in a logged-in browser (only the user can drive it).
ASKS/BREAKS: manifest now also requests `https://*.reddit.com/*` +
  `optional_host_permissions: https://*/*` (for the user's chosen Mastodon
  instance). No contract shape change — mastodon/reddit already valid platforms.
  Still frontend-lane only; untouched your design-system realm-sheet work.
DONE: SOCIAL BINDING phase 1 — MCP-level social media access via the browser-
  session bridge (33d7359 contract-first, d83b25c code). New hq_social_* MCP
  tools (feed/mentions/metrics/status read; post/reply STAGE-only; outbox/
  cancel), a new dashboard/social-bridge.js relay (social ingest tendril +
  /social/outbox routes, 3-line hook into browser-bridge.js, ZERO main.js
  change), and the browser-bridge extension gains social.js (per-platform
  adapters run in-tab via chrome.scripting; Bluesky adapter live). Verified
  14/14 end-to-end (real MCP stdio + bridge HTTP: stage→outbox→result→read,
  403 gate on missing header). data/social/* gitignored.
IN-FLIGHT: nothing uncommitted from me. Live Bluesky scrape needs a one-time
  check in a logged-in browser (only the user can drive that session).
ASKS/BREAKS: NEW shared shapes announced in CONTRACT.md "Social bridge sidecars"
  (data/social/{inbox,outbox,accounts}.json) — additive, NOT in latest.json, no
  golden fixture, not your (structure) surface. Load-bearing invariant: MCP only
  stages posts; nothing sends without a human "Approve & Send" in the extension
  popup — do not add a server/MCP auto-approve path without a security review.
  Extension manifest now requests `scripting` + `https://bsky.app/*`. I did NOT
  touch your in-flight realm-sheet migration (lands.css Task 7 etc.) or
  ux-after-t5.json — all left uncommitted for you.
DONE: Live-hotkey wiring — the statusbar advertised "1-5 tabs · F focus · /
  search" but only F was real. Now "/" opens the Ctrl+K command palette
  (typing-guarded) and digits 1-9 jump to the Nth visible realm; hint corrected
  to "1-9 realms". Fixed a latent number-nav bug (used r.id, but ordered()
  yields {manifest,view} → r.manifest.id). Path-scoped commit d3a38d1
  (core/chrome.js + core/palette.js ONLY). Selftest 91/91, 0 errors.
IN-FLIGHT: running a sequential self-improvement loop — each iteration is a
  small path-scoped commit + selftest. Staying OFF your DS CSS surface
  (base/components/chrome.css); I only touch JS + new files.
ASKS: none.
BREAKS: NEW in-app hotkeys claimed by the renderer — "/" (open palette) and
  1-9 (realm jump), both no-op while typing in a field. FYI: my earlier
  devfleet commit 92caa2f swept your then-uncommitted Task 4 work via a broad
  `git add` (the collision you noted in ebc649a) — mine; path-scoped from here.

## 2026-07-26 · FROM frontend (Task 4 session) · main @ a39df7e
DONE: NEXUS DS Task 4 — migrated ALL spacing literals (gap/margin/padding
  + longhands) in the three SHARED sheets (base.css, components.css,
  chrome.css) onto the --space-* ramp via a snap map (0→space-0 … stray
  40-56px→space-7). Verified: `--smoke --selftest` → `SELFTEST combos=91
  errors=0 PASS`; screenshots (nexus-shot.js) eyeballed across roundtable/
  grimoire/watchtower/legacy vs scratchpad baseline shots — pixel-level
  match, no broken layout. gapDistinctCount held at 16 (unchanged from
  baseline) — confirmed by design: gapDistinctCount only measures the CSS
  `gap` property, and every realm sheet (styles/realms/*.css, Task 6 scope)
  independently supplies the full spread of raw gap literals, so shared-
  sheet-only migration can't move that metric yet (expected per the plan;
  ≤7 gate is Task 9). One literal deliberately left un-snapped: `#stage
  padding-bottom: 64px` (chrome.css) — fixed-statusbar clearance, outside
  the ramp's 0-56px range, snapping would risk clipping content.
  Full report: .superpowers/sdd/2026-07-26-nexus-design-system/task-4-report.md
IN-FLIGHT/COLLISION: **this session's CSS diff never landed as its own
  commit.** While I was verifying (selftest/harness/screenshots), the
  concurrent frontend session committed `92caa2f` ("devfleet upgrade —
  CHRONICLE + ATLAS realms...") from the same shared working tree and its
  `git add` swept up my uncommitted base.css/components.css/chrome.css
  changes (diff is byte-identical to what I authored — 46/120/360 lines
  changed, matches exactly) AND my throwaway tools/ux-after-t4.json. So the
  Task 4 spacing-token migration IS in history, just riding under someone
  else's commit message/SHA instead of its own `fe: design-system —
  migrate shared sheets to spacing tokens` commit. I did NOT rewrite/amend
  92caa2f (rewriting a commit mid-flight in a shared worktree risks
  destroying the other session's follow-on work) — instead landed a small
  cleanup commit `a39df7e` untracking the stray json artifact.
ASKS: if anyone reviews `92caa2f`, know that ~526 of its changed lines
  (base.css/components.css/chrome.css) are Task 4's token migration, not
  part of the devfleet/realms feature work described in that commit's
  subject.
BREAKS: none functionally — pure spacing-token substitution, no selectors
  added/removed, no behavior change.
```

---

## 2026-07-26 · FROM frontend · main @ 9b93ae6
DONE: AUTOMATIONS (grimoire) advanced filtering (ba13b5e) — new .toolbar2 row:
  Kind (Runnable/Interactive/Plugin) · Usage (Used/Unused) · ⏳ Scheduled toggle
  · Sort (Most used/Recent/Name) · Clear. Additive: all logic in grimoire/
  view.js + a fresh-classname CSS block. Verified E2E headless (944→Runnable
  34→+Scheduled 16→Clear 944; 0 console errors). Plus 3 audit fixes: stranded
  drawer on realm switch (central closeDrawer in shell.switchRealm), stuck
  RESCAN '…' button (try/finally), roundtable NaN% avg (empty-projects guard)
  (ba13b5e + 9b93ae6).
IN-FLIGHT: nothing uncommitted from me.
ASKS: my new grimoire controls follow the sheet's CURRENT raw-px idiom (11.5px
  seg / 10px labels) to match their siblings — Task 8's grimoire.css migration
  should snap them onto --fs-* with the rest in one pass (they add ~1.5% to
  sub12pct until then).
BREAKS: none — additive JS + new-classname CSS; realm view.js is outside the
  design-system pass's CSS-only surface. NOT fixed (surfaced only): lands
  overflow=15 is your Task 7; jitter recs from the audit still open — ambient
  rail full innerHTML rebuild on every browser-tab push (ambient.js:87),
  summoning list rebuild/15s, forge search no-debounce, medbay LIVE stale
  across scrub, dormant AOS re-flash once fx lazy-loads AOS.

## 2026-07-26 · FROM frontend · main @ 535f49d
DONE: Final whole-branch review fixes for NEXUS ALIVE Phase 0 substrate — two
  commits. (1) C1-critical: scrubbed residual real-world PII missed by an
  earlier redaction pass in dashboard-v3/src/intel/__fixtures__/sample.json
  — nested insight IDs/text tied to real client names, a real PWA folder
  name, an orphan trend key, and personal GitHub clone origins. Broad
  case-insensitive sweep + absolute-Windows-path grep both zero-hit
  (688e012). (2) I1: derive.mjs streakRisk/momentum now guard invalid or
  undefined `now` instead of throwing RangeError — "never throws" contract
  is now total. 2 new tests added; derive.test.mjs is 11/11 green
  (535f49d). Report: .superpowers/sdd/2026-07-26-nexus-alive-program/
  final-fix-report.md.
IN-FLIGHT: nothing uncommitted.
ASKS: none new — this closes out the final-review punch list for Phase 0.
BREAKS: none. Fixture-only + derive.mjs (not yet imported by the renderer,
  per program invariants) — no runtime surface touched.

## 2026-07-26 · FROM frontend · main @ 07b74a8
DONE: Wired in the prior block's orphaned realms + palette (07b74a8). Three
  authored-but-unregistered realms are now live: CHRONICLE (🕰 retro timeline,
  order 11), ATLAS (📊 analytics/charts, order 12), CONJURE (✦ Claude's live
  canvas feed, order 13). Plus the Ctrl/Cmd+K COMMAND PALETTE (core/palette.js
  — quick-switch realms/projects/quests/tasks/vaults/spells). Touched the four
  shell seams only: boot.js (register+initPalette), realms.css (@imports),
  index.html (palette.css link), lexicons.js (tab_chronicle/atlas/conjure in
  all 3 registers). Verified headless: selftest 91/91 (13 realms × 7 themes),
  0 mount errors; palette opens on real Ctrl+K, 0 console errors.
IN-FLIGHT: nothing uncommitted. NOT pushed — 4 commits ahead of the last push
  point; run the usual pre-push secret scan when you next push.
ASKS: unchanged — M1 economy batches still open (entries below). CONJURE reads
  data/canvas/* (the MCP hq_canvas_add board) — shape already contract'd.
BREAKS: none. All additive, frontend-lane only (dashboard-v3/). New localhost/
  hotkey surface: Ctrl/Cmd+K is now claimed by the renderer palette (in-app
  only, not a global shortcut — no clash with the main-process Ctrl+Alt+* set).

## 2026-07-23 (GO-LIVE) · FROM frontend · main @ 8847fe8
DONE: ⚡ NEXUS IS LIVE — user-directed swap: data/.ui-version flipped to
  "v3", app restarted. Verified against the RUNNING instance: window title
  "WorkspaceHQ — NEXUS", bridge /health 200, boot log clean, and the full
  Familiar loop live (MCP hq_canvas_add → first-light board → app watcher;
  hq_quests_list serves 12 real quests). Rollback stays one flip: set the
  file back to "v2" + restart.
IN-FLIGHT: nothing. BREAKS: the app you relaunch now boots v3 — v2 renderer
  untouched on disk if you need it.

## 2026-07-23 (SWARM) · FROM frontend · main @ 8847fe8
DONE: THE MAP IS FULL — realms 7-10 built by a 7-agent swarm, adversarially
  reviewed (6 findings, all fixed), selftest 50/50, 50 shots clean. MED-BAY
  (anatomy ward + triage empty state), OBSERVATORY (vault constellation),
  WATCHTOWER (LIVE off existing dwell — Aggro 71 today), SUMMONING CIRCLE
  (session registry + Bell + THE CANVAS). Plus: canvas engine in main.js
  (data/canvas/*.canvas fs-watched, hq:canvas-read/add — IPC-CONTRACT'd) and
  dashboard-v3/mcp/server.mjs — zero-dep stdio MCP, 7 file-mediated tools,
  registered in .mcp.json (NEW tracked shared file — announce noted here).
IN-FLIGHT: nothing uncommitted.
ASKS (new, all CONTRACT-entry material — shapes documented in the realm
  view.js headers): (1) M2 pc-health: collector/pc-health.mjs →
  data/pc-health.json { scanned_at, organs:[{id,label,status:grace|ember|
  blood,value,unit,spark[],diagnosis,teaching?}] } — renderer ships tolerant.
  (2) M2 spellbook/: Restoration fix-spells need school:'restoration'.
  (3) M4: register the 4th vault (only 3 in inventory.vaults today).
  (4) NotebookLM sidecar shape + quest-sync field names when they land.
  M1 economy batches still open (below).
BREAKS: none. .mcp.json is NEW + tracked (no tokens in it — file-mediated
  v1); data/canvas/ gitignored (personal boards).

## 2026-07-23 (MA) · FROM frontend · main @ ea2b8ac
DONE: MA — THE UNTANGLING complete (spec: docs/superpowers/specs/
  2026-07-23-ma-untangling.md). claude-sessions.js registry (async
  everything; draft-commit's 90s main freeze is dead; unit-tested 6/6),
  chains/Ultimates in the caster (chain-aware cancel, chain telemetry),
  shards + summon palette on REDUCED preloads (conjured HTML can't reach
  castSpell/doCommit anymore), browser-bridge.js generalized into the
  tendril router (legacy routes byte-compatible, atomic writes, new tendril
  = one table row — your M4/M5 sidecars plug in there). New IPC rows in
  IPC-CONTRACT.md: hq:sessions-list + hq:claude-sessions push.
IN-FLIGHT: nothing uncommitted. Live-app verify (async draft-commit, chain
  cast, hardened shard) lands on the next app restart — nothing changes the
  v2 renderer contract, so restart timing is the user's.
ASKS: unchanged — M1 economy batches (below). M3 Summoning Circle is now
  ungated on my side.
BREAKS: none for you. FYI: telemetry may now contain chain-level cast rows
  (chain_id === cast_id) once chains are cast — additive, goldens
  unaffected (telemetry isn't goldened).

## 2026-07-23 (later) · FROM frontend · main @ ad13f59
DONE: Answered your ask — the orphaned uncommitted work was the ACTED-ON
  LEDGER (mine, pre-M0 in-flight); reviewed + landed as 668a6a2 (hardened
  write w/ quarantine, hq:acted-on-read live read, evidence strip, seconds
  fix). IPC-CONTRACT: +getActedOn row. Then, gate lifted (your push + that
  landing), the SWAP HOOK landed (ad13f59): main.js uiVersion() reads
  data/.ui-version — "v3" loads dashboard-v3/ with the UNCHANGED preload,
  anything else stays v2. Rehearsed: v3 html + real preload = NEXUS boot
  clean, selftest 30/30 PASS (dev-main HQ_V3_PRELOAD=v2 knob).
IN-FLIGHT: nothing uncommitted. Flag NOT flipped (user's call): flip
  data/.ui-version to "v3" + restart per CLAUDE.md to go live on NEXUS.
ASKS: M1 economy batches (entry below). Not pushed — run the usual pre-push
  secret scan when you next push (6 new commits).
BREAKS: dashboard/main.js touched for the first time post-gate — additive
  createWindow read only, default v2.

## 2026-07-23 · FROM frontend · main @ c63d120
DONE: NEXUS ambient rail (Working On Now / vitals / whisper / Familiar slot /
  night-tide, collapsible) + topstrip flex fix. M1 frontend half: voice packs
  (src/lexicon/voice/*.json + deterministic resolver, wired into the
  celebration card; verified both registers). M1 spec committed:
  docs/superpowers/specs/2026-07-23-m1-game-core.md.
IN-FLIGHT: nothing uncommitted in my lane.
ASKS (⚡ M1 economy — the four batches are yours, spec has full detail):
  1. grace_hours:36 config no-op FIRST, then wire the read (streak safety).
  2. GCFG projection into window.DATA via build-data (post-landing, one-line).
  3. Banking batch w/ stacking + grandfather (notify:false migration).
  4. Juice batch (seeded crits + combo times in quest-overrides — CONTRACT
     entry) · Meta batch (runes_balance split ledger). Each batch = CONTRACT
     Pending entry + golden re-baseline (invariant 2).
BREAKS: none. New tracked spec file only; voice packs are v3-renderer-local.

## 2026-07-23 · FROM meta (cleanup) · main @ 79dd119
DONE: repo hygiene. Gitignored Understand-Anything/ (67MB stray nested repo,
  github.com/Egonex-AI/Understand-Anything — kept on disk, out of git). Same
  commit also carried your uncommitted data/acted-on.json gitignore line (found
  it already in .gitignore, uncommitted — swept into this meta commit since it's
  additive + identical intent; nothing lost). Pushed main to origin (was 8 ahead).
IN-FLIGHT: nothing uncommitted by me.
ASKS: dashboard/{app,build-data,main,preload}.* + data/quest-overrides.json are
  sitting UNCOMMITTED in the shared tree — are these yours / in-flight? Flagging
  so they aren't lost on a checkout. I did NOT touch them (path-scoped commit).
BREAKS: none. New .gitignore lines only affect previously-untracked paths.

## 2026-07-22 · FROM frontend · main @ d4e3a46
DONE: NEXUS v3 M0 — the whole frame. dashboard-v3/ boots beside live v2 (ESM
  over file:// proven, strict CSP, scratch profiles). Shipped: realm registry +
  shell (6 realms: roundtable/forge/hunts/grimoire/lands/legacy), ALL v2
  surfaces ported at parity (11-agent workflow + adversarial verify: selftest
  30/30 combos, 0 console errors, parity screenshots reviewed), chrome
  (scrubber/Warden plate/SYS/FOCUS), fx (sfx/takeover/exporter), docs/sync/
  IPC-CONTRACT.md (window.hq frozen: 40 invokes + 7 pushes, additive-only).
  Parity harness: dashboard-v3/tools/parity-shot-{v2,v3}.js (shots gitignored).
IN-FLIGHT: nothing uncommitted in my lane.
ASKS: unchanged — land your uncommitted dashboard/* + data/ work whenever
  ready. The v2→v3 swap hook (main.js reads data/.ui-version, loads
  dashboard-v3/index.html with the EXISTING preload) waits on that landing
  (invariant 3); until then v3 runs via its dev harness only.
BREAKS: none for v2 (fully parallel build). Shared files touched (meta):
  .gitignore (+shots dir, +data/.ui-version), docs/sync/IPC-CONTRACT.md (NEW —
  read before adding any IPC channel), data/.ui-version (new gitignored
  runtime flag, currently "v2").

## 2026-07-21 · FROM frontend · main @ 386bc8a
DONE: Repo published to GitHub — https://github.com/Brvetr4ve1er/workspace-HQ
  (user-directed). Pre-push secret scan over all tracked files: clean; data/
  runtime files remain gitignored (only quest-overrides.json is tracked).
BREAKS (⚠ read this): `refactor/collector-modularization` was RENAMED to
  `main` (git branch -M, linear history — nothing orphaned) and pushed as
  origin/main with upstream tracking. Same commit, same working tree — but any
  reference to the old branch name is stale. Both lanes work on `main` now.
ASKS: commit your in-flight working-tree changes (app.js/build-data/main.js/
  preload + quest-overrides mods are uncommitted) whenever ready, then just
  `git push` — upstream is set.

## 2026-07-19 · FROM shared (landing) · refactor/collector-modularization @ 139db4b
DONE: Landed the in-flight Browser Bridge / CLAUDE-ON-TAP work (previously
  verified but sitting uncommitted in the shared tree — see the two 2026-07-16
  entries below) as a clean 3-way split: struct (8159e5b: collector/lib/
  browser.mjs +test, assemble.mjs), fe (139db4b: dashboard/browser-bridge.js,
  app.js, main.js, preload.js, styles.css), meta (this commit: browser-bridge/
  extension, tools/now-brief.mjs, CONTRACT.md, .gitignore, this handoff).
  Re-verified before commit: collector lib suite 22/22, browser.test 5/5, diffs
  reviewed (esc()-wrapped, latest.json.browser additive, no contract break).
IN-FLIGHT: nothing uncommitted. Understand-Anything/ is an unrelated nested git
  repo living in the folder — deliberately left untracked (not part of HQ).
ASKS: unchanged — optional structure per-project browser_domains[] (below).
BREAKS: none — all additive. Extension still needs a manual load-unpacked in
  Chrome; running Electron app must be restarted for port 47821 to listen.

## 2026-07-16 (later) · FROM shared · refactor/collector-modularization @ 663b66d
DONE: CLAUDE-ON-TAP (browser-bridge follow-up). New `tools/now-brief.mjs` (tracked) —
  fuses live browser focus (reuses collector/lib/browser.mjs) + per-project git (live
  `git status` for active projects, falls back to latest.json git_safety) + open quests
  into `data/now-brief.md`, ending with one next-action. `--json` flag for future app use.
  New `.claude/commands/resume.md` (LOCAL — .claude/ is gitignored) = the `/resume`
  slash command that runs the tool, reads the brief, answers what-to-resume. Verified:
  real run picks 5 active projects w/ live git dirty counts + correct next-action;
  browser-fed run correlates github repo path + localhost port → alliance travel.
IN-FLIGHT: uncommitted. NOT YET DONE (queued behind this slice, user picked Claude-on-tap
  first): (a) "Resume with Claude" dashboard button (reuse hq:claude-quest launch path,
  frontend lane), (b) extension "ask Claude about this page" (Claude-in-Chrome + bridge
  context). Also: the running Electron app predates the bridge server — it must be
  RESTARTED for 47821 to listen and browser-activity.json to appear (until then now-brief
  runs on git+quests only). Restart per CLAUDE.md.
ASKS: none blocking. Same optional structure ask stands (per-project browser_domains[] —
  now doubly useful: it'd let now-brief attribute tool dashboards like dash.cloudflare.com
  to the right project instead of leaving them unmapped).
BREAKS: none. New tracked file tools/now-brief.mjs. New gitignored runtime data/now-brief.md.
  now-brief is READ-ONLY over latest.json + browser-activity.json — no contract change.

## 2026-07-16 · FROM shared (both lanes) · refactor/collector-modularization @ 663b66d
DONE: BROWSER BRIDGE — WorkspaceHQ now sticks to Chrome like it sticks to Obsidian.
  New component `browser-bridge/` (MV3 Chrome extension: tracks active-tab focus,
  batches, POSTs to a localhost endpoint). New `dashboard/browser-bridge.js` ingest
  server on 127.0.0.1:47821 (CORS+custom-header gated, optional token), started from
  main.js whenReady, writes `data/browser-activity.json` (rolling 3-day window) and
  pushes a live-tab IPC ticker. Collector: `lib/browser.mjs` (+test, 4 cases green)
  folds activity into `latest.json.browser` (current focus, by_domain, by_project via
  dev_cmd ports + github repo slugs); wired in assemble.mjs. Frontend: "Working On Now"
  card in app.js renderOverview (+ live ticker via new preload getBrowserLive/onBrowserTab),
  styles.css, lexicon key working_now. Verified: bridge handshake via curl, browser.test
  + full lib suite (21) green, assemble emits populated block, offscreen render shows the
  card with no console errors.
IN-FLIGHT: all uncommitted (one shared working tree). NOT yet committed — commit split
  suggested: struct: (collector/lib/browser.mjs+test, assemble.mjs), fe: (dashboard/*),
  meta: (browser-bridge/, docs, .gitignore). Touched BOTH lanes in one session per user
  ask ("stick it to my browser like Obsidian"); flagging so the other session doesn't
  collide. Extension not yet loaded in Chrome by the user (manual load-unpacked step).
ASKS: none blocking. Optional (structure): add per-product `browser_domains[]` to
  collector.config.json for domains that aren't a github slug or dev_cmd port (e.g.
  almaflowclim.fr) — browser.mjs already matches host slugs, config would make it exact.
BREAKS: none — `latest.json.browser` is ADDITIVE & optional (CONTRACT.md updated; renderer
  guards absence). New runtime files data/browser-activity.json + data/.bridge-token
  (gitignored, don't schema-validate). New localhost port 47821. New IPC hq:browser-live
  / hq:browser-tab. Golden harness unaffected (additive, deterministic over file input).

## 2026-07-11 (later) · FROM frontend · refactor/collector-modularization @ 5804801
DONE: NIGHTFALL COMPLETE (P0-P4 all shipped). P3 theme-scoped lexicon — canon
  labels ride the Nightfall theme only; other themes verified byte-identical.
  P4: Night's Tide (ambient, --tide from age_days + night-hour class),
  Scadutree Blessing meter in LEGACY (render-derived, off the XP ledger),
  Seven Classes sigils (deterministic classify, lexicon-gated). Also fixed a
  latent SYS-menu bug (EXPORT/SFX clicks reset theme to arcade).
IN-FLIGHT: nothing. NG+ review screen deferred (needs your narrator pattern —
  see CANON.md). Organic v2 P2 (context-aware Messengers) is next on frontend.
ASKS: unchanged (optional canon variants in render.mjs + level titles).
BREAKS: none. New localStorage keys: hq-night-hour (default 21).

## 2026-07-11 · FROM frontend · refactor/collector-modularization @ d2ad23a
DONE: NIGHTFALL art direction P0-P2 (spec: docs/superpowers/specs/2026-07-11-
  nightfall-design.md, approved). P0 docs/CANON.md — THE shared vocabulary
  (Hunts/Whispers/Insight/Runes/Vitality/Spirit Summons/Messengers/…). P1 5th
  app theme "nightfall" (Yharnam gothic × ethereal; all theme rails honored).
  P2 vault skin: .obsidian/snippets/nightfall.css, 4 Keepsake templates,
  Roundtable Hold.md MOC, plugin HUD labels → canon (vault files, not in repo).
IN-FLIGHT: P3 (theme-scoped lexicon renames in app) + P4 (Night's Tide,
  Scadutree Fragments, class sigils) — next frontend block.
ASKS (optional, non-blocking): per CANON.md — canon headings variant in
  render.mjs Quest Board ("Hunts") and canon level-title set in
  gamification.config.json. Frontend display-remaps regardless.
BREAKS: none. New theme id "nightfall" in localStorage hq-theme. Fonts link
  in index.html grew Cinzel + IM Fell English.

## 2026-07-10 (later) · FROM frontend · refactor/collector-modularization @ 5a8e56f
DONE: Organic UI v2 subproject opened — charter at docs/ORGANIC-UI-V2.md, home
  dashboard/organic/ (shard.html + summon.html moved there, main.js paths updated).
  P1 widget library shipped: conjures auto-save to data/shard-library.json,
  matching summons re-spawn instantly from cache, `lib` opens a browser shard
  (summon/delete), conjured shards get a ↻ regen button. Verified live.
IN-FLIGHT: nothing uncommitted. Next pillars (P2 context-aware, P3 live-data
  shards, P4 manager, P5 theming) per charter.
ASKS: unchanged from previous entry. New runtime file data/shard-library.json
  is gitignored user content — don't schema-validate it.
BREAKS: none. dashboard/shard.html + summon.html no longer exist at the old
  paths (now dashboard/organic/) — irrelevant to your lane but noted.

## 2026-07-10 · FROM frontend · refactor/collector-modularization @ 82e3426
DONE: Session-linking scaffold (this file, CONTRACT.md, root CLAUDE.md). Prior
  frontend work all committed: organic-UI shard engine (0d1ead9), UX declutter
  (29df117), theme system + fixes, spellbook UI integration.
IN-FLIGHT: nothing uncommitted in dashboard/. New frontend subproject starts
  next frontend session — scope TBD by user.
ASKS: (1) When modularization tasks land, keep `latest.json` shape identical —
  golden fixtures are the contract. (2) If you rename/move any collector output
  file (latest.json, spellbook.json, spell-telemetry.json, weekly-recap.json),
  announce in CONTRACT.md first: build-data.mjs + main.js read them by path.
  (3) Merge to main when the refactor is green; frontend commits are riding
  your branch (shared working tree).
BREAKS: none for you. FYI: main.js grew an ORGANIC UI section (shards) +
  `Ctrl+Alt+G` global hotkey + `data/shards.json` runtime file (gitignored-eligible,
  currently untracked-by-design? it IS written at runtime — treat as runtime state,
  don't schema-validate it).
