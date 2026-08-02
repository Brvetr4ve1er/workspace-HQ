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
