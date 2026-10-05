# WorkspaceHQ — Product Architecture & Design Brief

> **What this is.** The single source document for designing ONE final UI/UX for WorkspaceHQ in Claude Design, then handing the prototype back to engineering to wire. A designer should need nothing else.
>
> **Snapshot of:** the live build as of 2026-10-03 (`main` @ a31d859; renderer = `dashboard-v3/`, internally "NEXUS v3"). Compiled from a full code read of every surface, window, IPC channel and data file.
>
> **Conventions used throughout**
> - **(est.)** marks a value that is a model judgment, a heuristic, or carried forward from an older scan. It is not a measurement. The new design must show it differently from measured values.
> - **"likely", "suspected", "check live", "unverified"** are kept on purpose: they mark findings read from code and not yet confirmed in the running app.
> - **(Claude quota)** marks an action that spends the user's Claude plan usage.
> - **Reload** means the main process rebuilds the data bundle and calls `win.reload()`. Only the active screen and the viewed snapshot survive.
> - All names in examples are placeholders ("Project A", "docs.example.com", "@handle-a"). The repository is public: never put real project names, people or URLs into mock content.
> - Internal ids (`roundtable`, `forge`, `hunts`…) are wiring keys and stay. Every user-visible label is free to change.

---

## 0. Paste-into-Claude-Design prompt

Paste this as the opening message, then attach this whole document.

```text
You are designing the final UI/UX for WorkspaceHQ, a desktop control center for one person: a solo developer who runs about 8 personal software projects, a few Obsidian vaults, Claude Code and a local LLM on one Windows PC. It is an Electron app that lives in the tray and is opened between tasks all day.

What it does: scans the projects nightly (uncommitted work, unpushed commits, exposed secrets, tests, activity) and turns that into one next action, a task board and a "where was I?" page per project; runs local automations safely; hands jobs to Claude; checks machine health; captures the screen; shows browser time, social mentions and vault vitals; keeps ~90 daily snapshots you can scrub through; and has a quiet, earned game layer (level, XP, milestones).

Design the full app as ONE coherent prototype: the shell (navigation, a header carrying scan state and the viewed date, command palette, toasts and an activity/runs panel, settings), every destination in the attached brief (15 today; you may group or merge them using the options in section 10, but every action in section 7 must keep a home), the shared project page, focus mode, the run-confirm dialog, and the small satellite windows (mini HUD, quick-run palette, recorder, snip overlay).

Tone: calm, precise, premium. An instrument, not a toy. Not corny RPG or fantasy. Not anonymous dark panels. Not crowded, not shouting in caps. Plain words. One focal element per screen. Severity owns colour. The game layer stays, but small and earned.

Honesty rules: estimates must look different from measurements (mark them "est."). Model-written text appears only on AI surfaces (ORACLE chat, ASSISTANT sessions, CANVAS) and never in the header, badges, HUD or notifications. Nothing nags, counts down or punishes. Empty and near-empty states are the normal case: design them first.

Constraints: keyboard-first (command palette — "/" today, Ctrl+K welcome — plus 1-9, F for focus, Esc closes). Fully offline under a strict CSP: no CDN fonts, icons or scripts at runtime. Inter 400/600, JetBrains Mono 400 and DM Serif Display are bundled today; any other open-licence font is fine if you name it, because it will be bundled locally. Minimum window 1180x820. One dark theme plus its light twin, every colour a CSS custom property. Every screen must work read-only on a past snapshot, degrade with a stated reason when the live bridge is missing, and survive the app's frequent self-reloads without losing the user's place.

Deliver per screen: default, empty, loading, error, past-snapshot and disabled states, plus a component list and a token sheet.
```

---

## 1. What WorkspaceHQ is

WorkspaceHQ is a personal operations console for one developer's whole working life on one PC. Every night (and on demand) a scan pipeline measures each tracked project (git state, uncommitted and unpushed work, likely secrets, tests, activity, disk), asks a model for soft judgments (completion %, build health, insights), and stores the result as a dated snapshot. The app turns those snapshots into a single "do this now", a task board, a re-entry page per project, and a history you can scrub. Around that core it gathers the other things the owner does at this desk: running local automations and Claude skills, dispatching work to Claude and watching it, checking PC health, capturing the screen, and glancing at browser time, social activity and Obsidian vaults. It is also a small set of satellites outside the window: a tray menu, an always-on-top mini HUD, global hotkeys, a browser extension, and an MCP server that lets Claude read and lightly change the same data. A game layer (level, XP, streak, milestones) rewards real, measured progress. The owner's own words for the current UI: "the interface is genuinely shit". This brief exists so the next design is the last one.

### The single user

| Trait | Detail |
|---|---|
| Who | The owner. One person, one Windows 11 PC, no team, no accounts, no cloud backend |
| Works on | ~8 personal software projects (single digits), 2–4 Obsidian vaults, Claude Code, a local LLM (Ollama / LM Studio) |
| Habit | Keeps the app in the tray. Reaches it from the tray, global hotkeys and the mini HUD as much as from the main window |
| Wants | To know what matters right now, to get back into a project fast, and to feel progress that is real |
| Rejects | Vanity metrics, "theatre", nagging, corny fantasy wording, crowded boxes, losing familiar names (see §8 history) |
| Data reality | Empty states are the default: often 0–3 open tasks, ~16 automation runs ever out of ~980 catalogued, no social data yet |

### Jobs to be done, ranked

Ranking is the brief author's reading of the data model and the owner's documented feedback. It is not measured usage (est.).

| Rank | Job ("When…, I want to…") | Served today by | State today |
|---|---|---|---|
| 1 | When I sit down, I want **one next action** that is actually worth doing, and to start it | HOME (picks + decision card), right-rail DO NOW, FOCUS mode, mini HUD top quest | Three rankers disagree; the hero is buried under "pick one of three" |
| 2 | When I open a project, I want to **know where I was and resume** in one move (folder, dev server, last file, commit) | Project drawer, PROJECTS cards | Best surface in the app, but commit/learn/decision flows likely broken (`window.prompt`) and state is lost on reload |
| 3 | I want to **protect my work**: nothing uncommitted for days, nothing unpushed, no exposed secrets, no repo without a remote | TASKS, PROJECTS, drawer Git safety, tray bulk push/snapshot | Works, but risk signals are small badges while the estimated % is the loudest number |
| 4 | I want to **hand work to Claude and see what it did** | ASSISTANT, ⚡ buttons in TASKS/drawer/PROJECTS, CANVAS | Every button opens an untracked terminal; a full tracked engine exists but no screen uses it |
| 5 | I want to **run my automations safely** without a terminal | AUTOMATIONS, quick-run palette (Ctrl+Alt+X), tray, mini HUD | ~34 truly runnable items hidden in ~980; four entry points with different confirm rules |
| 6 | I want to know **if this PC is healthy** and run a safe fix | SYSTEM, right-rail MACHINE, mini HUD | Vitals refresh only once per scan (nightly / logon) or on Re-examine, with no staleness cue; problem and fix are a scroll apart |
| 7 | I want to **capture my screen** and find captures later | STUDIO, snip overlay, record panel, hotkeys | Snip works; recording likely saves empty files (check live); RECORD button doesn't record |
| 8 | I want to **see that I'm improving**, and enjoy earned milestones | HISTORY, TIMELINE, HUD level/XP, takeover | Five renderings of the same two numbers; streak counts scanner runs, not work |
| 9 | I want to **ask questions about my own data**, privately | ORACLE (local model) | Works; hard to find; answers are dead ends |
| 10 | I want **peripheral awareness**: browser time, social mentions and staged posts, vault vitals | SCREEN TIME, SOCIAL, NOTES, right rail | Numbers inflated (screen time), approval queue invisible (social), notes page can't open anything |

---

## 2. Information architecture today

### 2.1 The 15 realms (rail order)

"Actions" = user controls counted in the §7 inventory (counting rule there). Digit = in-window number hotkey.

| # | Rail label | id | Job (one line) | Primary data | Actions | Digit | Rail badge |
|---|---|---|---|---|---|---|---|
| 1 | HOME | `roundtable` | Across all projects, what should I do now, and is anything on fire? | `account.daily_top3`, `quests`, `derive.oracle()`, `trends`, `projects`, `changes_since_prev`, `weeklyRecap` | 16 | 1 | — |
| 2 | PROJECTS | `forge` | Which project needs me, how is each doing, how do I get in fast? | `projects[]` (git, code health, activity, completion est.), `browser`, signal gaps | 10 | 2 | — |
| 3 | TASKS | `hunts` | What is at risk or broken that I should fix next, and what did I just clear? | `quests[]`, `side_quests[]` | 6 | 3 | open task count |
| 4 | AUTOMATIONS | `grimoire` | What can I run on this machine, and run one safely now | `bundle.spellbook`, `bundle.telemetry`, `account.spellcraft` | 16 | 4 | catalog size (~1,000) |
| 5 | MAP | `lands` | Where does the portfolio stand at a glance, and what is lying around in storage? | `projects[]`, `inventory`, `archived_projects`, `recent_learnings` | 2 | 5 | — |
| 6 | HISTORY | `legacy` | Am I improving, what are my bests, which milestones have I earned? | `trends`, `achievements`, `actedOn` | 3 | 6 | unlocked milestones |
| 7 | SYSTEM | `medbay` | Is this PC healthy, what's wrong, what can I safely run to fix it? | `bundle.pcHealth`, `inventory` (cleanup), `hq.probeLlm()` | 5 | 7 | critical vitals (hidden at 0) |
| 8 | NOTES | `observatory` | How big and alive are my vaults, and how do I search them? | `inventory.vaults` | 4 | 8 | — |
| 9 | SCREEN TIME | `watchtower` | Where does my browser time go, and how much is distraction? | `scans[].browser.by_domain` (est., overstated) | 1 | 9 | — |
| 10 | ASSISTANT | `summoning` | What is Claude doing for me, and how do I give it a job? | `hq:claude-sessions`, `projects`, canvas boards | 8 | — | running sessions (live) |
| 11 | ORACLE | `oracle` | Ask about my projects/tasks/PC; local, grounded answers | local LLM stream, context built in main | 7 | — | — |
| 12 | TIMELINE | `chronicle` | What happened, when, scan by scan? | `scans[].changes_since_prev`, `achievements`, `weeklyRecap` | 0 | — | — |
| 13 | CANVAS | `conjure` | What has Claude built for me while we chatted? | `data/canvas/*.canvas` widget specs | 1 | — | — |
| 14 | SOCIAL | `social` | What's happening on my social accounts, and what has Claude staged? | `data/social/{inbox,outbox,accounts}.json` | 3 | — | — |
| 15 | STUDIO | `studio` | Where are my screenshots and recordings, and how do I take one? | `studio.libraryList()` | 8 | — | — |
| | | | | **Realm total** | **90** | | |

The ◎ FOCUS chip sits at the bottom of the rail but is a global mode, not a realm.

### 2.2 Global shell (around every realm) → §3

App frame and realm lifecycle · boot splash · top HUD strip (level, XP, health, streak) · SYS menu (the only settings) · SNAPSHOTS bar (time machine) · left rail · right ambient rail (now / do now / machine / top risk / assistant) · fixed status bar · command palette · project drawer · notifications/toasts (missing) · celebration takeover + stat card · FOCUS overlay · run confirm + run log · in-window keyboard layer.

### 2.3 Satellites (outside the main window) → §5

Main window frame + menu · tray icon/menu · mini HUD window · summon palette · desktop "shards" (7 widget types) · quick-run palette (Ctrl+Alt+X) · casting engine · snip overlay (one per monitor) · record panel · global hotkeys · OS notifications and native dialogs · scan pipeline · dev servers · Obsidian two-way sync · external launches (terminals, Explorer) · browser extension (capture + social approval popup) · MCP server (15 tools Claude can call).

### 2.4 What's wrong with the IA

1. **Too many flat destinations.** 15 ungrouped rail items with 8.5 px labels. Digits reach only the first 9, so ASSISTANT, ORACLE, TIMELINE, CANVAS, SOCIAL and STUDIO have no number key. At 820 px tall the rail scrolls.
2. **Overlapping clusters with no hierarchy:**
   - *AI:* HOME's "do this now" card, ORACLE, ASSISTANT, CANVAS.
   - *History:* HISTORY, TIMELINE, HOME momentum/changes/recap, the SNAPSHOTS bar, the HUD.
   - *Projects:* PROJECTS, MAP (same list as towers), HOME's per-project health list, the drawer.
   - *Capture:* NOTES, CANVAS, STUDIO, drawer notes, note shards.
   - *Machine:* SYSTEM, the right-rail MACHINE block, the mini HUD.
   - *Browser time:* SCREEN TIME, the right-rail "Working on now", PROJECTS' "Working on now" card.
3. **Three rankers for "what next"** (collector `daily_top3`, `derive.oracle()`, `computeOneThing()`) disagree on one screen; F focuses something other than the hero.
4. **Dead ends everywhere.** Palette results for tasks/ideas/vaults/automations land on the realm, not the item. Nothing in the right rail is clickable. Tasks don't link to their project. TIMELINE rows link nowhere. ORACLE answers can't act. Toasts can't be clicked.
5. **Inverse actions live apart.** Archive is in the drawer's ⋯ menu; Restore is only on MAP.
6. **One word, several things.** "Oracle" = HOME's deterministic decision card *and* the LLM chat realm. "Canvas" = the CANVAS feed, ASSISTANT's whiteboard, the board named "conjure", and "conjure:" desktop shards. "Spell / cast / Spellbook" survive in confirm dialogs, logs, tray and toasts while the rail says AUTOMATIONS / Run.
7. **Labels don't match ids** (TASKS = `hunts`, AUTOMATIONS = `grimoire`, SYSTEM = `medbay`…), and chrome says "products" where the rail says PROJECTS.
8. **Badges lie by colour.** All are red alert pills, but AUTOMATIONS shows a ~1,000 catalog size and HISTORY shows milestones earned. Only TASKS, SYSTEM and ASSISTANT are real "needs you" signals.
9. **Chrome eats the screen.** HUD + SNAPSHOTS bar + fixed status bar + two side rails leave the realm about 60% of a 1180×820 window.
10. **Time semantics differ per surface.** Scan data time-travels; sidecars (PC health, automations, recap, canvas) don't; ORACLE ignores the selection; each realm decides on its own what to disable on a past snapshot.
11. **Four ways to run an automation** (realm, quick-run palette, tray, mini HUD), each handling the confirm step differently.
12. **Things that need the user have no home:** staged social posts (approve in another app), running jobs (scan, runs, Claude sessions, recordings, dev servers), failures of scheduled scans, settings.
13. **FOCUS is a mode** but sits in the navigation.

---

## 3. Global shell

Every surface below uses the same template: **Job · Layout today · Data shown · Actions · States · Links · Problems · Designer notes.** Action tables here say *what* a control does and its side effects; exact wiring for every control is in §7.

**Scale to plan for (current bundle):** ~90 daily snapshots · ~8 projects · 0–12 open tasks (often 0) · up to 40 ideas/risks · ~980 catalogued automations · 2–4 vaults · 15 realms · 8 PC vitals · 22 milestones.

### 3.1 App frame & realm lifecycle — `shell`
*Files: `dashboard-v3/index.html`, `src/core/{boot,shell,registry,data,bus,themes,lexicon,actions}.js/.mjs`, `styles/{base,tokens}.css`.*

**Job:** Hold every screen in one window, move between 15 realms, and keep one shared "viewed snapshot" that every screen renders.

**Layout today (top → bottom):**
1. Full-window grid `#nexus`: `[left rail 84px] [center 1fr] [ambient rail clamp(200–264px), or 22px collapsed]`, 100vh, no page scroll.
2. Center column `#stage-wrap`: top HUD strip `#topstrip` → SNAPSHOTS bar `.timemachine` → `#stage`. `#stage` holds the one mounted realm, is the only scrolling area, and has 64 px bottom padding.
3. `#statusbar` is `position:fixed` across the whole window bottom, over the bottom of both rails.
4. Overlay layer `#overlays` (z100): `#scrim` + `#drawer`, `#palette`, `#onething` (focus), `#takeover` + `#confetti`, `#castconfirm`, `#castlog`, hidden `#cardcanvas`.
5. Decorative layers `#crt` (scanlines) and `#boot` (splash), both hidden in NEXUS/DAYLIGHT; injected SVG sprite `#hq-icon-sprite`.

At 1180 px wide the stage column is ~884 px.

**Boot order:** await icon sprite → register 15 realms → restore snapshot index and active realm from sessionStorage → `startShell(realm || 'roundtable')` (apply theme, build HUD, build rail, mount realm) → subscribe to Claude-session presence (keeps the ASSISTANT badge live) → `initChrome`, `initFx`, `initAmbient`, `initPalette`, `initActions`, `initNotify` → expose `window.NEXUS`.

**Realm lifecycle (`switchRealm(id, force)`):** skip if already active (unless forced) or `enabled(data)` is false → `prev.view.unmount()` in try/catch → clear stage, close drawer and scrim → save `hq-active-realm` → `view.mount(stage, ctx)` with `ctx = {data, bus, LX, theme, hq}` → mark rail button `aria-current=page` → emit `realm:switched`. A theme change rebuilds the rail and force-remounts the active realm.

**Reloads:** any main-process write that calls `win.reload()` (scan, task done, learn, archive, revive, capture, post-commit rescan, automation rescan, the `latest.json` watcher, Ctrl+Shift+R) reloads the whole page. Realm and snapshot come back from sessionStorage; the boot splash is skipped; everything else (scroll, open drawer, typed input, filters, in-flight ORACLE answers) is lost.

**Data shown:** `window.DATA` (built by `dashboard/build-data.mjs`) normalized into `data.scans[]`, `data.latest`, `data.selected` (the snapshot being viewed), `data.selectedIndex`, `data.isLatest`, `data.bundle` (raw sidecars). Full shape in §6. Every label goes through `LX(key)`; NEXUS and DAYLIGHT use the PLAIN register.

**Actions:** `switchRealm`, `dispatch('go:<id>' | 'scan:now' | 'capture:note' | 'claude:dispatch' | 'quest:done' | 'cast')`, debug handle `window.NEXUS` and `?selftest=1`. See §7 "Shell".

**Bus events (the only cross-module channel; realms never import each other):**

| Event | Emitted by | Consumed by |
|---|---|---|
| `realm:switched {id}` | shell | palette recency |
| `data:select {index, scan, isLatest}` | `data.select()` | chrome, ambient, fx, rail badges, every realm |
| `theme:changed {id}` | `applyTheme()` | shell, chrome, ambient |
| `focus:toggle` | FOCUS chip | `focus.js` |
| `fx:export-card` / `fx:sfx-toggle` | SYS menu | `fx.js` |

**Persisted keys:** sessionStorage `hq-active-realm`, `hq-scan-idx`, `hq-booted`. localStorage `hq-theme`, `hq-theme-migrated`, `hq-tm-open`, `hq-ambient`, `hq-sfx`, `hq-celebrated`, `hq-ff-oracle`, `hq-oracle-chat`, `hq-oracle-include`, `hq-sec-<key>` (fold state).

**States:**
- *Empty (no scans):* rails render, HUD shows placeholders, status bar says "No scans found. Run the pipeline, then `node build-data.mjs`." Digits, ←/→ and Esc are not wired at all.
- *Loading:* no skeletons; status bar "loading…" for under a second (local bundle). Pre-paint window colour `#0d1117` matches no theme.
- *Error:* a realm whose `mount()` throws leaves a **silent blank stage** (only unmount is guarded). Chrome/fx import failures go to the console only.
- *Past snapshot:* every surface renders `data.selected`; each realm decides what to disable; no global read-only treatment beyond the SNAPSHOTS bar.
- *Dev harness (no preload, `window.hq` undefined):* every `hq.*` call is feature-detected and does nothing; live signals never arrive.

**Problems:**
- Three horizontal bands plus two rails leave the realm ~60% of the window; the HUD is squeezed between the rails instead of spanning the window.
- The fixed status bar covers the bottom of both rails (including the FOCUS chip); only `#stage` reserves room for it.
- **Likely bug:** after the user has scrubbed snapshots once, `hq-scan-idx` stays stored even after "Back to live". When a new scan lands and the window reloads, the stored index now points at the previous snapshot, so the app reopens in past-snapshot mode (`boot.js:83` + `data.js:88`).
- 7 themes and 3 label registers in code, 2 themes in the UI; game vocabulary leaks into ids and copy ("INSERT COIN", "PERSONAL OPS CONSOLE — v2").

**Designer notes:**
- Non-negotiable: exactly one realm mounted at a time; realms re-render on snapshot change and can be unmounted at any moment.
- Non-negotiable: loads over `file://` with CSP `default-src 'self'`; fonts ship in `styles/fonts/`.
- Merge HUD + SNAPSHOTS head + status bar into one header row to reclaim height.
- Design a "refreshing…" transition that keeps the user's place across reloads, and a real error state for a realm that fails to mount.

### 3.2 Boot splash — `boot`
*Files: `index.html #boot`, `chrome.js bootSplash`, `styles/chrome.css`.*

**Job:** A branded "power-on" moment on the first open of a session.
**Layout today:** "WORKSPACE**HQ**" logo with RGB-split glow → "PERSONAL OPS CONSOLE — v2" → blinking "PRESS START" inside a CRT power-on animation.
**Data shown:** none.
**Actions:** click / any key / 2.4 s timeout fades it (sessionStorage `hq-booted`).
**States:** once per session; CSS hides it in every theme except the unreachable ARCADE; skipped after reloads.
**Links:** leads to the restored realm (HOME by default).
**Problems:** dead UI in practice; stale "v2" copy; its keydown listener and timer still run invisibly.
**Designer notes:** cut it, or replace with a sub-600 ms fade that doubles as the reload/refresh transition. There is no real load time to cover.

### 3.3 Top HUD strip — `topstrip`
*Files: `shell.js renderTopstrip`, `chrome.js paintWarden/wireSysMenu/paintSysActive`, `styles/chrome.css`, `cinematic.css`.*

**Job:** "What level am I, how healthy is my workspace, how long is my streak?" Also hosts the only settings menu.

**Layout today (left → right, one row):**
1. Brand: 46 px hard-coded pixel-art monitor logo, "WORKSPACE**HQ**", subtitle "8 products · 2 vaults · viewing 2026-01-15".
2. Level chip: "LV", level number, rank title under it ("Overseer").
3. XP block: "12,345 XP" (count-up animation), "420 to L13" or "max", progress bar.
4. Health block: "HEALTH" + count-up number over a bar; orange below 70, red with pulse below 40; flashes when health dropped since last paint.
5. Streak: pixel-art flame, day count, "STREAK".
6. "◈ SYS" button → dropdown (§3.4).

**Data shown:**

| Element | Field | Provenance |
|---|---|---|
| Subtitle | `selected.projects.length`, `inventory.vaults.length`, `scan.id` | measured |
| Level / rank | `account.level`, `account.title` | derived from XP |
| XP | `account.xp`, `xp_to_next`; bar = `xp_into_level / (xp_into_level + xp_to_next)` | derived |
| Health | `account.health_index` 0–100 | **(est.)** 60% of its weight comes from estimated completion, build and tests |
| Streak | `account.streak.scan_days` | measured, but it counts days the **scanner ran**, not days the user worked |

All follow the SNAPSHOTS selection (historical values off-live).

**Actions:** ◈ SYS opens the menu. Level / XP / Health / Streak are inert (no click-through).

**States:** empty "–", "0 XP", "—", "0"; past snapshot shows past values with no marker; focus mode dims it.
**Links:** none outbound. No path to an explanation of health or XP.
**Problems:** arcade logo and flame clash with NEXUS; HEALTH and STREAK are ambiguous (code health vs personal health; scan-days vs work-days) with no tooltip or drill-down; settings hidden behind "◈ SYS"; "products" vs PROJECTS; the HUD's two loudest numbers are the ones the 2026-09-15 audit flagged as estimate or vanity.
**Designer notes:** keep level + XP progress as the glanceable identity. Mark health as (est.) or replace it with measured signals. Make health and streak clickable to their explanation. The sprite already contains unused `brand-app`, `brand-wordmark` and `brand-level-coin` symbols.

### 3.4 SYS menu (theme, sound, export) — `sys-menu`
*Files: `shell.js renderTopstrip`, `chrome.js wireSysMenu/paintSysActive`, `core/themes.js`, `core/lexicon.js`, `fx.js`, `chrome.css .theme-*`.*

**Job:** "How should the app look and sound, and can I export a stat card?"

**Layout today:** "◈ SYS" at the far right of the HUD → dropdown (min 220 px, right-aligned):
1. Group label THEME → rows **NEXUS** "clean dark", **DAYLIGHT** "clean light" (active row: accent wash + left bar).
2. Group label TOOLS → **◈ EXPORT CARD** "shareable stat PNG", **♪ OFF** "chiptune sound effects".

**Data shown:** `<html data-theme>` → active row. `hq-sfx` should drive the ♪ label but doesn't. The exported 1000×560 PNG shows: "WORKSPACEHQ", "PERSONAL OPS CONSOLE · <scanId>", LV + rank, XP bar, HEALTH bar (est., unmarked), STREAK (scanner days), PRODUCTS, OPEN QUESTS, TROPHIES, up to 4 milestone names.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| ◈ SYS | Open/close (outside click closes) | none |
| NEXUS / DAYLIGHT | Live theme + PLAIN label register | localStorage; rail rebuilt; realm remounted (realm state resets); menu closes |
| ◈ EXPORT CARD | Renders and downloads `workspacehq-L<level>-<scanId>.png` | native save dialog; always arcade neon; menu stays open; exports a past snapshot without saying so |
| ♪ sound | Toggles chiptune SFX (move, blip, coin, level-up, fizzle) | localStorage; beep; label never changes |
| (hidden) ARCADE / OKAMI / NUMIDEA / OPS DESK / NIGHTFALL | Only via devtools, editing localStorage, or `?selftest=1` | game register; 4 of them render with fallback fonts |

**States:** static markup; export silently does nothing with no scan; works in the dev harness.
**Links:** mouse-only from the HUD; no hotkey, no palette entry, no settings page.
**Problems:** lying ♪ label; TOOLS rows don't close the menu; no keyboard access (no Esc, no arrows); appearance mixed with export and sound; persistent prefs (ambient rail, snapshot rail, folds, `hq-ff-oracle` flag) have no UI; the label register can't be chosen apart from colours.
**Designer notes:** replace with a real **Settings** surface reachable from the palette and keyboard: Appearance (dark / light / follow OS), Sound, Ambient rail, Notifications, Hotkeys (with registration status), Capture settings, Export card, optional "Flavor" (game register). Ship only the themes you design.

### 3.5 SNAPSHOTS bar (time machine) — `timemachine`
*Files: `index.html .timemachine`, `chrome.js buildTimeMachine/paintTimeMachine`, `core/data.js select`.*

**Job:** "What did my workspace look like on day X, and what changed since the scan before?" It chooses which snapshot the whole app renders.

**Layout today:**
1. Head row (always visible): toggle "▸ SNAPSHOTS" (▾ open) · ◀ older · date "2026-01-15" · ▶ newer · status pill green "latest" / grey "past snapshot" · gold "⏎ BACK TO LIVE" (off-live only) · delta text "vs 2026-01-14: health ▲ +3 · xp ▲ +120" or "baseline snapshot".
2. Track (collapsed by default, remembered): 48 px full-width rail, health sparkline behind ~90 diamond dots; every Nth dot and the newest labelled "MM-DD"; active dot enlarged with accent glow.

**Data shown:** `scans[i].scan.id` → dates/labels · `scans[i].account.health_index` (est.) → sparkline · dot tooltip "id · health N · L<level> · N open" · delta = selected − previous for `health_index` and `xp` (▲ green / ▼ red / ±0).

**Actions:** toggle track · ◀ / ▶ · dot click · ⏎ BACK TO LIVE (may fire the takeover) · ← / → keys (only when expanded or off-live).

**States:** empty "—", no dots, inert. Off-live: bar force-expands, grey pill, BACK TO LIVE appears; TASKS hides its buttons, but the drawer's action bar stays live.
**Links:** drives every realm via `data:select`; repaints HUD and status bar; the right rail switches WORKING ON NOW to the snapshot's recorded tab and hides DO NOW.
**Problems:** a full-width band on every screen for a rarely used feature; inconsistent read-only rules (some verbs vanish, others still act on today's files); ~90 dense dots with no zoom, calendar or jump-to-date; sparkline stroke hard-coded `#322a5e`; the reopen-in-past-mode bug (§3.1); delta covers only health and XP.
**Designer notes:** non-negotiable: one global "viewing date" every screen respects, and an unmistakable read-only mode with one-click "Back to live". Candidate: a compact date chip in the header opening a popover (sparkline, calendar, what changed). The expanded track could merge into the history surface.

### 3.6 Left rail — `rail-left`
*Files: `shell.js renderRail/refreshBadges`, `realms/*/manifest.js`, `chrome.js mountFocusChip`, `ui/icons.js`, `icons/hq-icons.svg`.*

**Job:** "Where can I go, and which places need me?"

**Layout today:** 84 px wide; 68 px buttons with a 21 px SVG icon, an 8.5 px uppercase label and a red count badge top-right; scrolls when short; ◎ FOCUS chip pinned at the bottom. Order, ids, badges and digits are in §2.1. Icons are sprite symbols `i-realm-<id>`; fallback is the manifest emoji. The sprite still carries retired `realm-atlas` and `realm-warroom`.

**Data shown (badges):**

| Realm | Badge source | Meaning |
|---|---|---|
| TASKS | `account.totals.open_quests` | needs you; **shows a red "0" pill when the board is clear** (the usual case) |
| AUTOMATIONS | `bundle.spellbook.counts.total` | catalog size, not actionable |
| HISTORY | count of unlocked `achievements` | earned, not actionable; red "0" with none unlocked |
| SYSTEM | `pcHealth.organs[]` with `status==='blood'` (hidden at 0) | needs you |
| ASSISTANT | running Claude sessions (live push) | live activity |

Badges recompute only on `data:select`, theme change, and session pushes. A badge hides only when `badge()` returns null (`shell.js refreshBadges`); TASKS and HISTORY return a number, so 0 renders as a red "0" pill (SYSTEM and ASSISTANT map 0 to null and hide).

**Actions:** realm button ×15 · digits 1–9 · ◎ FOCUS chip (enter/exit focus).
**States:** `enabled(data)` gating exists but every manifest returns true; past snapshot shows historical badge counts; ASSISTANT badge never appears in the dev harness; focus mode dims the rail.
**Links:** every realm; palette GO rows mirror the list with emoji instead of SVG.
**Problems:** 15 flat items; 8.5 px labels; rail scrolls at 820 px and the FOCUS chip sits under the status bar; red badges mean different things; label/id mismatch; FOCUS is a mode in the nav.
**Designer notes:** group destinations (example: Work · Automate · Life · System) or use a 6–7 item primary rail plus "More". Red only for "needs action". Keep 1–9 stable for the top destinations. Ids stay as wiring keys.

### 3.7 Right ambient rail — `rail-right`
*Files: `core/ambient.js`, `styles/base.css`, `cinematic.css`.*

**Job:** Peripheral vision beside every realm: "what am I doing, what should I do next, is the machine OK?"

**Layout today (top → bottom):**
0. Collapse toggle ">" / "<" (collapsed = 22 px, remembered).
1. "◉ WORKING ON NOW": live dot, domain ("docs.example.com"), focus time ("14m"), 2-line page title. Empty: "no signal — load the Bridge extension".
2. "DO NOW": one line with an accent bar, e.g. "Commit Project A (12 uncommitted)", "Rotate 1 exposed secret — Project B", or a top task title.
3. "MACHINE": up to 5 raw rows "cpu 23", "ram 61", "servers 1" (no units). Empty: "live app only".
4. "TOP RISK": first risk/urgent side-quest (else the first), kind chip (RISK red / URGENT / IDEA) + title. Empty: "the board is quiet".
5. "ASSISTANT": always the static text "no sessions running".
6. NIGHTFALL only: "the night deepens". Never renders: it needs the `night-tide` class on `<html>`, which nothing sets (§8.10).

**Data shown:** live tab `{live, host/domain, focus_ms, title}` (off-live: `selected.browser.current`) · DO NOW = `derive.oracle(bundle, selected).label`, a **deterministic rule**, not AI (weights: exposed secrets 90+, red task 70, dirty files 40–100, orange task 45, yellow task 20; latest snapshot only; hidden when flag `hq-ff-oracle` = off or nothing is actionable) · machine `{cpu %, ram %, servers}` every 2.5 s · `selected.side_quests[].{kind,title}` (LLM-written ones are (est.)).

**Actions:** collapse toggle only. Nothing in the rail is clickable.
**States:** each block has its own empty line; past snapshot shows the recorded tab and hides DO NOW; harness shows "live app only".
**Links:** none; every item is a dead end.
**Problems:** no deep links; ASSISTANT contradicts the live rail badge; raw lowercase machine keys; whole rail rebuilt from innerHTML every 2.5 s (hover/selection lost); duplicates PROJECTS / SCREEN TIME (now playing), HOME (DO NOW), TASKS (top risk); costs 200–264 px on every screen.
**Designer notes:** decide whether it survives. If yes, every row deep-links (DO NOW → task/drawer, risk → drawer, now playing → SCREEN TIME, machine → SYSTEM, assistant → ASSISTANT). If no, fold DO NOW and vitals into the header. Non-negotiable: model-generated text never appears here.

### 3.8 Bottom status bar — `statusbar`
*Files: `index.html #statusbar`, `chrome.js paintStatusbar`.*

**Job:** Fine print for the viewed snapshot plus a keyboard hint.
**Layout today:** one fixed row: "● INSERT COIN" · "**2026-01-15** · 8 products · 12 open (3 red) · health 72 · data built 2026-01-15 09:30 · 1-9 realms · F focus · / search".
**Data shown:** `scan.id`, `totals.products`, `totals.open_quests`, `totals.red_quests`, `health_index` (est.), `bundle.built_at`.
**Actions:** none.
**States:** "loading…"; no-scans message; past values with no marker.
**Problems:** redundant with HUD and SNAPSHOTS; arcade "INSERT COIN"; covers both rails; only place shortcuts are advertised (incomplete); its only unique fact is data freshness.
**Designer notes:** cut it. Move freshness ("Last scan 09:30 · Scan now") to the header and shortcuts to a "?" cheat sheet.

### 3.9 Command palette — `palette`
*Files: `core/palette.js`, `styles/palette.css`.*

**Job:** "Jump to anything."

**Layout today:** dim backdrop; centered 560 px panel 12vh from top: search input "Jump to anything — type to search…" → up to 8 rows (icon, label, faint hint, colour-coded kind tag GO / PROJECT / QUEST / IDEA / VAULT / SPELL) or "No matches" → footer "↑↓ move · ↵ open · esc close".

**Data shown (index rebuilt on every open from the viewed snapshot):**
- Realms (label via `LX`, emoji sigil; realm id is a hidden alias, so "grimoire" finds AUTOMATIONS).
- `projects[]` → name, hint "<completion.pct>% (LLM estimate) · first 2 stack items".
- `quests[]` → title + tier. `side_quests[]` → title + project or kind (IDEA).
- `inventory.vaults[]` → name + "N notes". `spellbook.spells[]` (~1,000) → name + category.
- Empty query: up to 3 recent non-realm items, then realms by recency.
- Ranking: label prefix → substring → hint/alias → fuzzy (2+ chars); ties by kind.

**Actions:** Ctrl/Cmd+K (works even in fields) · `/` · ↑/↓/hover · Enter/click per row kind · Esc/backdrop. GO → realm; PROJECT → drawer; QUEST/IDEA → TASKS only; VAULT → NOTES only; SPELL → AUTOMATIONS only.
**States:** empty data → realm rows only; works in the harness; activation errors swallowed.
**Problems:** non-project results land on the realm, not the item; no commands at all (Scan now, Snip, New note, theme…), though `actions.mjs all()` was built for this; no sections; 8-row cap; ~1,000 automations crowd fuzzy results; emoji vs SVG icons.
**Designer notes:** make it the power hub with sections (Go to · Projects · Tasks · Automations · Commands); every result deep-links to the exact item; add verbs; keep Ctrl+K and `/`.

### 3.10 Project drawer — `drawer` (the highest-value shared surface)
*Files: `src/ui/components.js openDrawer/closeDrawer/sideQuestRow`; anchors `#drawer` + `#scrim`; `styles/components.css .dwr-*, .ab-*, .mtile, .ins, .flag, .road`.*

**Job:** "Where was I on this project, what's the one thing to do next, and what can I do to it right now?" Re-entry briefing + every per-project verb + the full audit.

**Opened from:** PROJECTS card "Open ⤢", HOME (pick cards, decision card, health-row "OPEN DRAWER", change rows), MAP towers, palette PROJECT results (no previous-scan delta). Slides in from the right, `min(470px, 92vw)`, over a dimming scrim. Closes on ✕, scrim, Esc, or any realm switch.

**Layout today (top → bottom):**
1. Sticky header: ✕ · project name · "stack · stack · <absolute project path>".
2. Sticky action bar (live app only): **▶ RESUME** (green primary) · 📂 OPEN · 📦 SNAP · ✍️ COMMIT · ▶ DEV / ■ STOP (only with a dev command) · ⋯ menu → 📚 I learned… · 📝 Log decision · ⚰ Archive project (red).
3. "Where was I?" briefing:
   - **is:** first 3 stack items · "60% done" (est.)
   - **last:** "\"fix: header layout\" · 3d ago"
   - **wip:** "12 uncommitted files"
   - **next:** top open task for this project by tier → else "Commit 12 dirty files" → else "Open it and look around"
   - row of recent-file chips (basenames)
4. "Tasks & Mistakes": input "Record a task or mistake..." + ADD; list of notes (timestamp + text) or "No tasks or notes recorded."
5. "Side-quests · smart propositions" (only if any): kind pill RISK (red) / URGENT (orange) / IDEA (cyan) / POLISH (purple), title, detail, tags "effort S · impact high · ✦ AI"; buttons 🗑 PURGE (cache-reclaim rows only) · ⚡ · ✓ DID IT (live + latest only).
6. Folds (native `<details>`):
   - **Git safety — <low/medium/high> risk** (auto-open at high): tiles Repo · Remote · Commits · Dirty · Ahead/behind · Secrets seen; "branch → remote"; warning "Active branch (x) differs from canonical (y)".
   - **Security flags** (open; omitted if none): flag text + "type · file:line".
   - **Standing** (closed): Completion "60% ▲ +5" (est.) · Project level "L4 · 820 xp" · Build (est.) · Tests "14/20" / "present" / "none" · Activity · Files · LOC · one-sentence basis (est.).
   - **Insights** (closed): severity-striped notes with tags, or "No insights for this snapshot." (est.)
   - **Suggestions** (closed, if any): text + effort + impact (est.)
   - **Roadmap** (closed, if any): milestone, "status · NN%", bullet items (est.)

**Data shown:**

| Element | Fields | Provenance |
|---|---|---|
| Header | `p.name`, `p.stack[]`, `p.path` | config / measured |
| Briefing | `completion.pct`; `git_safety.last_commit_subject`, `activity.days_since_commit`, `git_safety.dirty`; top open quest from `S.quests[]` by project and tier; `code_health.recent_files[]` | completion (est.); rest measured |
| Notes | `bundle.projectNotes[p.id][] {date, text, completed}` | user-written; bundle-level (not per snapshot); `completed` never shown or settable |
| Side-quests | `p.side_quests[] {id, kind, title, detail, effort, impact, source, fat_dirs}` | `source:'llm'` → "✦ AI" (est.) |
| Git safety | `has_git, has_remote, commits, dirty, ahead, behind, branch, remote, risk, flags[]`, `p.canonical_branch`, `risk_security.secrets_found` | measured; secrets is a noisy regex count |
| Security flags | `risk_security.flags[] {type, severity, detail, location}` | (est.), carried |
| Standing | `completion.pct` + renderer delta, `p.level`, `p.xp`, `code_health.{build, tests, files, loc}`, `activity.state`, `completion.basis` | build/tests passing/basis (est.) |
| Insights / suggestions / roadmap | `p.insights[]`, `p.suggestions[]`, `p.roadmap[]` | (est.), carried until next enrichment |
| DEV button | `p.dev_cmd`, renderer `devState[p.id]` via `hq:dev-status` | — |

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| ✕ / scrim / Esc / realm switch | Close | — |
| ▶ RESUME | Opens folder + starts dev server (if any) + opens most recent file, all at once | Explorer + background process + external app; only feedback is a coin sound; error dialog outside <Documents> |
| 📂 OPEN | Opens the folder | Explorer |
| 📦 SNAP | Filtered backup copy | native confirm; backup folder; OS toast with raw path; failure silent |
| ✍️ COMMIT (draft) | AI drafts a conventional-commit message from the diff | local model 30 s, then Claude CLI 90 s (Claude quota); "Drafting…" up to ~2 min; `alert()` on error |
| ✍️ COMMIT (commit) | Edit the message, then commit | `git add -A` (stages everything incl. untracked) + commit; rescan; reload. **Suspected dead** (`window.prompt`); prompt says "Claude wrote this" even when the local model did |
| ▶ DEV / ■ STOP | Toggle dev server | process spawn/kill; label stale unless PROJECTS is mounted |
| ⋯ | Overflow menu | — |
| 📚 I learned… | Log a learning | learnings file + vault note; reload. Suspected dead (prompt) |
| 📝 Log decision | Log a decision | vault callout; no reload. Suspected dead (prompt) |
| ⚰ Archive project | Archive (confirm) | overrides; reload; project leaves counts; Restore is on MAP |
| Recent-file chip | Open file | external app |
| ADD / Enter (notes) | Save a note | notes file + vault mirror; optimistic; no reload; harness fakes it |
| 🗑 PURGE | Delete regenerable caches | native warning; delete; full scan (Claude quota); reload |
| ⚡ | Send side-quest to Claude | external terminal (Claude quota) |
| ✓ DID IT | Mark side-quest done | overrides; reload; "+~60 XP" shard |
| Fold headers | Expand/collapse | not persisted |

**States:**
- *Dev harness:* no action bar, no side-quest buttons, notes ADD fakes a save, file chips inert.
- *Past snapshot:* header, briefing and folds show that scan; **the action bar stays fully live and acts on today's repo**; side-quest buttons hidden (the only `isLatest` gate); notes are today's.
- *Empty:* "No tasks or notes recorded.", "No insights for this snapshot."; security/suggestions/roadmap/side-quests omitted; "next" falls back to "Open it and look around".
- *Loading:* only COMMIT's "Drafting…".
- *Error:* `alert()` for draft/commit; native dialogs for dev-start and open-folder; silent for snapshot, open-file and dev-server crash.
- *After any reload-triggering verb:* the drawer is gone.

**Links:** no in-app links out (to the project's tasks, vault note, history). External only: Explorer, editor, terminal.

**Problems:**
- Text-input flows (commit message, learning, decision) depend on `window.prompt()`, which Electron doesn't implement: **likely dead** in the live app.
- Unsafe commit: stages everything with no file list or diff.
- Opaque RESUME (three external effects, one vague label); OPEN duplicates part of it.
- Feedback is fragmented: native dialogs, `alert()`, `confirm()`, OS toasts, silent failures, chiptune.
- Four overlapping "what next" lists (briefing next, side-quests, suggestions, insights) plus non-completable notes.
- Absolute path in the header; key metrics buried in closed folds; project level/XP has no context.
- **Likely** sticky overlap: header and action bar are both `sticky; top:0` (unrendered).
- DEV label goes stale when opened outside PROJECTS.

**Designer notes:**
- Design it as a full **project page** (wide panel or route): header (name, stack, risk/health chips, freshness) → primary verbs (Resume, Commit with diff preview and editable multi-line message showing who drafted it, Dev server with live status and ideally URL/port, Open, Snapshot) → one ranked **Next** list merging next task + side-quests + suggestions, each with Do it / Send to Claude / Dismiss → one journal (notes, decisions, learnings) → diagnostics tabs (Git, Security, Standing, Insights, Roadmap).
- Every side-effect button says what will happen: the snapshot destination, which folders Purge deletes and how much space it frees, that Archive is reversible, that "a terminal will open".
- Non-negotiables: replace every `prompt/alert/confirm` with in-app inputs, toasts and confirm sheets (a wiring requirement); destructive verbs always confirm; Claude-quota verbs labelled; verbs disabled or annotated on past snapshots; read-only rendering when `window.hq` is missing; exposed secrets and security flags unmissable; reachable from HOME, MAP, palette and PROJECTS; keep every existing IPC call.

### 3.11 Notifications & toasts — `notify`
*Files: `core/notify.mjs`, `boot.js initNotify`; main-side native dialogs in `dashboard/main.js`.*

**Job:** Tell the user something happened: a scan finished, an action failed, a background event.
**Layout today:** there is **no in-app toast component**. `notify.emit(evt {type, title, body})` would route to an OS notification (window hidden) or a toast (window visible), but the toast handler is never injected and nothing calls `emit()`.
**What users actually get:** native `alert/prompt/confirm`; main-process native dialogs (snapshot, purge, dev-server / open-folder errors, "Scan failed"); OS toasts listed in §5.12; the title bar "WorkspaceHQ — scanning…"; optional chiptune; the celebration takeover; a desktop "+XP" shard after completing a task.
**Problems:** no in-app sign that a scan is running or finished; errors are blocking modals or silent; for most verbs the only success signal is the page reload.
**Designer notes:** design one toast system (info / success / error / progress with cancel) and a persistent **activity** indicator for long jobs (scan, commit drafting, automation runs, Claude sessions, recording, dev servers). The routing code exists; only the UI is missing. Owner rule (2026-09-15): OS toasts only for events that are measured, actionable and new.

### 3.12 Celebration takeover & stat card — `takeover`
*Files: `src/fx.js`, `styles/chrome.css` (duplicated in `fx.css`).*

**Job:** Reward moments (level-up, new milestone, task completed) plus a shareable stat card.
**Layout today:** full-screen dim + blur, 2.8 s confetti, centered card: big word "LEVEL UP" / "ACHIEVEMENT" / "QUEST COMPLETE" → sub-line ("L13 · Overseer", milestone name, or task detail) → optional voice line → "+120 XP" → rows "✓ 2 quests complete", "🏆 <milestone> +60" → "click to dismiss".
**Data shown:** `selected.changes_since_prev[]` entries `level_up {level, title, xp}`, `new_achievement {name, achievement_id, icon, xp}`, `quest_completed {detail, xp}`; voice line from `lexicon/voice/*.json` (deterministic per snapshot; slang such as "massive W"). Stat card: see §3.4.
**Actions:** click anywhere / 5.4 s auto-dismiss; console `hqDemo()` preview. Esc does not dismiss.
**States:** fires only on the latest snapshot, once per exact change-set (`hq-celebrated`), on load and on returning to live.
**Problems:** arcade styling with hard-coded neon in every theme; completing a task interrupts twice (reload, then takeover); a comment mentions a Ctrl+Shift+L demo binding that doesn't exist.
**Designer notes:** a light, non-blocking reward for task completion; reserve the big moment for a level-up; the card follows the theme and uses only measured numbers.

### 3.13 FOCUS mode overlay — `onething`
*Files: `realms/roundtable/focus.js`; `styles/chrome.css #onething / .ot-*` (dimming rule duplicated in `roundtable.css`); rail chip in `chrome.js mountFocusChip`.*

**Job:** "I've committed to one thing: hide everything else and time me until it's done." A global mode, not a realm.

**Layout today:**
0. Everything behind (stage, rails, HUD, SNAPSHOTS) turns grayscale at 38% brightness and stops taking pointer input; overlay fades in over 0.25 s (z95).
1. Centered card: eyebrow "ONE THING · everything else can wait" → task title (large) → "↳ Project A" → count-up timer "00:00" (mm:ss; no hour rollover, so "75:12") → green "✓ DONE — exit focus" → hint "press **F** to toggle · Esc to leave".

**Data shown:** the item passed in (a HOME pick's quest) or `computeOneThing(selected)` → `{kind: quest/git/side_quest, id, title, project_id, project_name, reason}`; `reason` is not displayed. Timer is local (`performance.now`), never persisted.

**Actions:** enter via rail chip, F, HOME FOCUS buttons · ✓ DONE (completes the task only if kind is quest; always logs a resolved ledger entry) · Esc / F (exit unresolved, ledger entry).
**Ledger entry sent:** `{at, kind, action_id, project_id, minutes, resolved, via:'focus'}`; main keeps `seconds` and drops `minutes`, so **every focus session is stored with 0 duration**.

**States:**
- Nothing actionable → entering silently does nothing.
- **Not wired until HOME has mounted once** this session (overlay, F listener and bus subscription are created in HOME's mount). After a reload into another realm, the chip and F are dead.
- Past snapshot: runs on old data; **DONE has no isLatest guard and completes the quest in live data.**
- Reload mid-focus (scan, a DONE elsewhere, a capture): overlay and timer vanish, no ledger entry.
- Dev harness: DONE just closes.

**Links:** in from HOME picks, legacy hero, rail chip, F. Exit returns to the realm underneath. No link to the project or task.
**Problems:** default pick ≠ HOME's "do this now"; a pick whose quest can't resolve silently substitutes another task; DONE label is misleading for non-quest kinds; no visible "Stop (not done)"; durations lost; keys not trapped (1–9 and ←/→ act underneath); no reason, pause or persistence; dead until HOME mounts.
**Designer notes:** show title, project, *why it matters*, elapsed time; primary Done only when actually completable; secondary "Stop (not done)" and optional "Open project"; a task picker; a timer that survives reloads; entry point in the header. Non-negotiables: global over every realm; F toggles, Esc leaves; nothing interactive underneath; a success state that bridges the reload after a quest Done.

### 3.14 Run confirm (dry-run) — `#castconfirm`
*Files: `ui/components.js showCastConfirm`, `styles/chrome.css`.*

**Job:** "Am I sure I want to run exactly this command, in this folder?" The trust anchor for automations.
**Layout today:** full-window dim backdrop, centered card (≤620 px, gold outline): "<icon> CAST <Name>?" → reason "First time casting this spell." / "⚠ The spell CHANGED since you last approved it." / "This spell always asks." → "it will run exactly:" + monospace command block (scrolls after ~140 px) → "in: <folder>" → CANCEL · ⚡ CAST IT.
**Data shown:** preview from `hq:spell-cast` → `name, icon, command, args[], cwd, always_confirm, changed`; `content_hash` is not shown but is sent back on confirm; `kind` is not shown.
**Actions:** CANCEL / backdrop (nothing runs) · ⚡ CAST IT (stores approval, runs).
**States:** reachable only from inside the main window (AUTOMATIONS card/drawer RUN, DEEP SCAN, HOME suggested ribbon). Esc doesn't close it; focus isn't moved into it. **Chains show an empty command block** (no step list). Doesn't say whether a terminal will open or tokens will be spent.
**Problems:** RPG copy in the plain theme ("CAST", "spell", "⚡ CAST IT"); empty preview for chains; no kind, timeout or quota info; no keyboard handling.
**Designer notes:** keep it. Show the kind (background vs opens a terminal), the exact command, the folder, the ordered steps for chains, and "will ask every time" vs "won't ask again". Enter = confirm, Esc = cancel. One confirm pattern for every entry point (main window, quick-run palette, tray, mini HUD).

### 3.15 Run log — `#castlog`
*Files: `ui/components.js castlogLine/showCastlog`; app-lifetime stream wiring in `fx.js wireCastStream`; `styles/chrome.css`.*

**Job:** "What is running, what did it print, did it succeed?"
**Layout today:** bottom slide-up console (16 px gutters, max 42% height), header "📡 CASTING LOG" + CLEAR + ▾ HIDE. One block per run: cyan first line "✨ casting Name…" (chains "⛓️ Name — 3 links"); stdout green, stderr red, ANSI stripped, ≤400 lines; "✕ cancel" top-right while running; final line "✨ Name RESOLVED · 3.2s" or "💥 Name FIZZLED (exit 1) · 3.2s" / "(timeout)"; then "+XP queued (settles on next scan — cast Deep Scan to bank it now)". Loose lines for errors ("✖ Name: already casting") and Interactive runs ("⚡ Name channeled into a terminal window"). Left stripe green/red by outcome.
**Data shown:** `hq:cast-output {castId, spellId, name, icon, stream: sys/out/err, chunk ≤8 KB, chainId}`; `hq:cast-done {castId, spellId, name, icon, outcome: resolved/fizzled, exit_code, duration_ms, timed_out, chainId}`.
**Actions:** CLEAR · ▾ HIDE · ✕ cancel per running block.
**States:** auto-opens on any run output, including runs started from the quick-run palette, mini HUD or tray; **no button reopens it once hidden**; wiped by every reload (including Deep Scan's own mid-run reload); never appears in the harness.
**Problems:** ephemeral although the last 500 runs are stored; RPG wording; the XP line nudges running Deep Scan (Claude quota) just to bank XP; covers page content; blocks don't link to their automation.
**Designer notes:** a persistent **Runs** panel with a running-count indicator in the chrome; each run shows status, duration, cancel (always reachable), expandable output, and a link to its automation; history from stored telemetry.

### 3.16 In-window keyboard layer — `keys`
*Files: `chrome.js wireKeys`, `palette.js onKey`, `focus.js onKey`, `ui/components.js`.*

**Job:** Drive the app without a mouse. (OS-wide hotkeys are in §5.11.)

| Key | Does | Notes |
|---|---|---|
| Ctrl/Cmd+K | Toggle palette | works even in fields |
| `/` | Open palette | not in fields |
| ↑ ↓ Enter Esc | Palette move / open / close | palette open |
| 1–9 | Nth visible rail item (HOME … SCREEN TIME) | not wired with no scans |
| ← / → | Older / newer snapshot | only when SNAPSHOTS is expanded or off-live |
| Esc | Close drawer, palette; leave focus | not the run confirm or the takeover |
| F | Toggle focus | only after HOME has mounted once |
| Enter | Add a drawer note | in the note input |
| any key | Dismiss boot splash | only in ARCADE |
| Ctrl+R | **Scan now** (app menu), not reload | full LLM-backed scan |
| Ctrl+Shift+R | Rebuild data + reload | |
| Ctrl+Shift+I | DevTools | |

In-app shortcuts are ignored while typing in input/textarea/select/contenteditable unless noted.
**Problems:** Ctrl+R habit triggers a 20 s–8 min scan that spends Claude quota; no cheat sheet; realms 10–15 have no digit; F depends on HOME; arrow scrubbing hidden; Esc inconsistent.
**Designer notes:** ship a "?" shortcut sheet; keep Ctrl+K, `/`, 1–9, F, Esc; consider "G then letter" navigation; make Scan now an explicit button with visible progress.

---

## 4. Realms

One subsection per realm in rail order. `S` = `ctx.data.selected` (the viewed snapshot), `a` = `S.account`, `D` = `window.DATA`, `prev` = the snapshot before `S`. Wiring for every control is in §7.

### 4.1 HOME — `roundtable`
*Files: `realms/roundtable/{view,oracle-card,oracle-logic,one-thing,manifest}.js` (`one-thing.js` re-exports `dashboard/lib/one-thing.js`); `styles/realms/roundtable.css`.*

**Job:** "Across all my projects, what should I do right now, and is anything on fire?" Rail #1, digit 1, default boot realm, no badge. One column capped at 880 px.

**Layout today (top → bottom):**
1. **Header** "Today — pick one". When side-quests exist, a right chip "⚠ 2 urgent · 5 ideas ▸".
2. **Pick cards** (auto-fit grid, min 230 px → 1–3 columns), up to 3. Each: coloured left seam + kicker QUICK WIN (sage) / MOMENTUM (steel blue) / RESCUE (amber) / AT RISK (red) / fallback DO (gold); title ("Pick up Project A"); reason ("last touched 2d ago — keep momentum"); hover-only hint "OPEN ▸" / "BOARD ▸"; verbs [◎ FOCUS] [✓ DONE].
3. **Hero card**, exactly one of:
   - a. **Decision card** (default; flag `hq-ff-oracle` ≠ off). Eyebrow "◎ DO THIS NOW · everything else can wait"; label ("Commit Project A (12 uncommitted)", "Rotate 1 exposed secret — Project B" or a task title); reason ("12 uncommitted files at risk", "exposed secrets are a live breach risk", "red quest"); one primary button "◆ Review & commit ▸" or "▸ Open task ▸".
   - b. **Rest card** (nothing actionable, or a past snapshot). "◎ CLEAR" (or "◎ ALL QUIET" 22:00–06:00), "Nothing on fire." / "Late and clear. Rest." + one sentence. No button.
   - c. **Legacy One-Thing card** (flag off). "◎ THE ONE THING · everything else can wait", title, "↳ Project A", reason, [◎ FOCUS].
4. **Suggested automation ribbon** (latest only): "SUGGESTED" · icon · name · "Automation · +10 XP" · [Run ▸].
5. **Momentum strip** (3 columns, stacks under 560 px): "Momentum · 14-day trend" + toggle [HEALTH] [XP] · 220×34 sparkline with pulsing "now" dot · big value ("68" / "12,340"), delta vs first point ("▲ +4"), range + streak ("09-20 → 10-03 · 🔥 9").
6. **Fold "▸ Overview"** (collapsed; summary "~62% avg · 12 open (3 red)"). Open: 4 KPI tiles (Avg completion (est.), Open tasks, At-risk tasks, Knowledge XP) with deltas → "PER-PROJECT HEALTH · 8 · tap a row for detail" → one row per project: status dot · name · thin bar · "62%" · "▲ +5" (if changed) · status tag AT RISK / NEEDS CARE / IDLE / HEALTHY · chevron. A row expands a detail panel.
7. **Fold "▸ Changes since 2026-09-30"** (collapsed; summary "5 · Pushed Project A (3 commits)…" or "nothing moved"). Rows: impact seam (green / red glowing / grey), glyph, text, trailing ▸ when project-linked.
8. **Weekly recap** (h2, not a fold) "Weekly recap · 2026-09-21 → 2026-09-27": teaser (first narrative line, ≤160 chars), stats "+420 XP · 6 tasks · 2 🏆", [READ]/[CLOSE]; expanded body rendered by mdLite (headings, ▸ bullets, bold).

**Data shown:**
- **Pick cards:** `a.daily_top3[] {kind, label, reason, project_id, quest_id}`, deterministic (collector `assemble.mjs`): `quick_win` = oldest lowest-tier open quest (canned reason "5-min win — clear something small"); `momentum` = most recently active non-dormant project with an open quest; `rescue` = longest-dormant project with an open quest ("dormant 40d — one action saves it"). All three need an open quest, so a cleared board means no picks.
- **Splice:** open/in-progress `S.quests[]` sorted tier (red → orange → yellow), xp desc, age desc; if the top quest isn't already covered it replaces card 3 (or is appended) as **AT RISK** (whatever its tier), label `quest.title`, reason `quest.insight` or "+60 XP". Quest↔card matching: quest_id → exact title → first open quest in the same project.
- **Header chip:** `S.side_quests[]` counts; urgent = kind risk/urgent, ideas = idea/polish.
- **Decision card:** `derive.oracle(D, S, now)`. Per project: `git_safety.dirty > 0` → commit (weight 40 + min(dirty, 60)); `risk_security.secrets_found > 0` → secret (90 + n). Per quest with status open only (in_progress ignored): red 70, orange 45, yellow 20. Returns `{action, label, reason, target{realmId, projectId | questId}}`; today only `commit` and `quest`. **Deterministic, not AI.**
- **Legacy hero / FOCUS default:** `computeOneThing(S)` (a different ranking: quests, push/stabilize per project, urgent side-quests).
- **Suggested automation:** `a.spellcraft.spell_of_day {id, name, icon, school, rarity, bonus_xp}`, resolved against `D.spellbook.spells[]`; bonus XP credited only at the next scan and only if run.
- **Momentum:** last 14 samples of `S.trends.health_index[]` or `S.trends.xp[]` (`{d, v}`), fallback to the current value; `a.streak.scan_days` as "🔥 N". "14-day" is really the last 14 scans (gaps possible). Health is (est.).
- **Overview:** average `projects[].completion.pct` (est.; `~` and "(est.)" only when `scan.enriched !== true`, which in practice never fires); `totals.open_quests`, `totals.red_quests` with inverted-colour deltas; `totals.knowledge_xp` (no delta).
- **Health rows:** `p.name`, `completion.pct` (est.) + delta; status from `projStatus()`: **AT RISK** = secrets > 0, or build red/failing, or git risk high **and** dirty > 0; **NEEDS CARE** = stale, or git risk high/medium; **HEALTHY** = active; **IDLE** = everything else. Sorted AT RISK → NEEDS CARE → IDLE → HEALTHY, then completion desc.
- **Row detail:** `completion.basis` (est.; or "heuristic — git/activity/tests/docs (no LLM)"); chips `L{level} · {xp} xp`, `◷ {activity.state}`, `build {build}` (est.), `tests {passing}/{count}`, `{dirty} dirty` (orange > 0), `↑{ahead} unpushed`, `🔑 {secrets} secrets` (red); last commit subject + "· 3d ago".
- **Changes:** `S.scan.previous_scan` in the title; rows from `S.changes_since_prev[] {type, detail, impact, project_id}`. Glyphs: ✓ quest_completed, ⇧ git_pushed, 🪄 spell_learned, ⚡ spellcraft_xp/spell_cast, ⭐ level_up; everything else ◈.
- **Weekly recap:** `D.weeklyRecap {week_start, week_end, narrative_md, stats}`. `narrative_md` is ~150 words written by the `claude -p` CLI (est.), with a static fallback; the `ai_narrative` flag is never shown. Shown stats: `xp_gain`, `quests_completed`, `achievements_unlocked`; `level_start/level_end/health_delta` unused.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| Header chip | Opens TASKS | navigation |
| Pick card body | Drawer for the pick's project; TASKS if none | drawer + scrim |
| Pick ◎ FOCUS | Focus on the card's quest; **silently substitutes** the `computeOneThing` pick if none resolves | focus overlay |
| Pick ✓ DONE (latest + preload + resolved quest) | Completes the quest | overrides; re-assemble; **reload**; tray/HUD refresh; XP shard; stays grey with no message if already done |
| "◆ Review & commit ▸" | PROJECTS + that project's drawer | navigation; commit happens in the drawer (Claude quota if the local model is down) |
| "▸ Open task ▸" | Secret: PROJECTS + drawer. Quest: TASKS with nothing selected | navigation (`questId` dropped) |
| "✎ Capture" / "⟳ Scan now" | Copy exists; never emitted today | would write brain-dump + reload / run a full scan (Claude quota) |
| Legacy ◎ FOCUS (flag off) | Focus on `computeOneThing` pick | focus overlay |
| Suggested "Run ▸" | Runs the suggested automation (AUTOMATIONS if missing) | run confirm on first run; Run log; `alert()` without preload |
| Momentum HEALTH / XP | Switch series | none |
| "Overview" fold | Expand/collapse | localStorage `hq-sec-kpis` |
| Health row | Expand detail | none |
| "OPEN DRAWER ▸" | Drawer | — |
| "Changes since" fold | Expand/collapse | localStorage `hq-sec-changes` |
| Change row (project-linked) | Drawer | — |
| Recap READ / CLOSE | Show/hide narrative | none |

**States:**
- *No scans:* blank stage, no message.
- *Partial empties:* no picks and no open quests → "Today — pick one" header alone; no side-quests → no chip; no spell of the day → no ribbon; no trend samples → bare value; 0 projects → "PER-PROJECT HEALTH · 0" over nothing; no changes → "nothing moved" / "Nothing moved since the previous scan — metrics held steady."; no recap → section absent.
- *Loading:* none; DONE and scans reload the window (flash).
- *Error:* none surfaced; dispatch errors → console; IPC failures silent.
- *Past snapshot:* picks render, FOCUS works, DONE hidden, ribbon and recap hidden; **the hero shows the Rest card ("Nothing on fire…"), which is false**; no read-only banner.
- *Dev harness:* DONE hidden, Run shows `alert()`, navigation works, drawer has no action bar.

**Links:** in from rail / digit 1 / boot default / `go:roundtable`. Out to the drawer (4 places), TASKS (chip, card without project, decision card quest case), PROJECTS (decision card commit/secret), AUTOMATIONS (Run fallback), FOCUS.

**Problems:**
- **Three rankers disagree on one screen** (`daily_top3`, `derive.oracle()`, `computeOneThing()`); the same task can appear twice; F focuses something other than "DO THIS NOW".
- **Inverted hierarchy:** "pick one of three" sits above "DO THIS NOW · everything else can wait"; the decision card has no FOCUS/DONE while the picks do.
- AT RISK label on any tier; decision card drops `questId` and ignores in_progress quests.
- Past snapshots lie (Rest card).
- Per-project health (most useful portfolio view) and KPIs start folded; avg completion is an estimate shown as a hard number.
- Duplication: momentum repeats HUD XP/health/streak, the time-machine sparkline and HISTORY; the health list overlaps PROJECTS.
- Two palettes (muted picks vs v2 neon `#3aff6e`/`#ffe14d` health tags); emoji mixed with geometric glyphs; glyph map misses most change types (new_achievement, build_flip, repo_initialized, quest_unresolved, new_project, anomaly, spell_of_day_cast fall back to ◈; keys achievement_unlocked and git_committed never occur).
- Recap: teaser repeats the body's first paragraph and is cut after HTML-escaping (can break an entity); not a fold; doesn't say it's AI-written.
- Not keyboard-reachable: cards, health rows and change rows are clickable `div`s; OPEN/BOARD hint hover-only; buttons nested in clickable cards.
- DONE reloads the whole window; no inline success state.
- Ribbon promises "+10 XP" that arrives only at the next scan and doesn't say what Run will execute.

**Designer notes:**
- Matters most: **one unmistakable next action** with inline FOCUS / DONE / OPEN, then a worst-first portfolio health list, then "what changed since last scan".
- Merge picks + decision card into one "Next action" module: 1 primary + up to 2 alternates, fed by **one** ranker (engineering ask).
- Cut or move: momentum → header or history; KPI tiles → inline in the health-list header; suggested automation → small slot or AUTOMATIONS; weekly recap → a weekly, dismissible card.
- Non-negotiables: DONE only on latest + preload; visible read-only mode; estimates marked; the 4 health statuses keep fixed meaning; a FOCUS entry on every actionable item; a success transition that survives the reload.
- Content lengths: task titles 30–70 chars; reasons 20–60 chars; 1–30 projects; 0–40 side-quests; 0–20 change rows; recap ~150 words.
- The approved exemplar from history (v4.2 HOME, §8): one focal decision card, today-pick-one, momentum strip, ≤2 accents, no outlined passive boxes, 48 px section gaps.

### 4.2 PROJECTS — `forge`
*Files: `realms/forge/{view,manifest}.js`, `styles/realms/forge.css`; shared `.toolbar/.grid/.card/.tag/.bfocus` in `components.css`.*

**Job:** "Which of my projects needs me right now, how is each doing, and how do I get into one fast?" Rail #2, digit 2.

**Layout today (one column capped at 880 px):**
1. **"◉ WORKING ON NOW" browser card** (only when browser data exists; otherwise, live + latest, a one-line setup hint). Header with source and age ("browser · 5m ago"); now line: live dot, host ("localhost:3000"), project chip ("Project A"), focus time ("12m"), tab title; up to 6 domain bars (domain · bar · duration); up to 5 project chips ("Project A · 1.2h"). It sits *above* the Projects heading.
2. Heading "Projects".
3. **Toolbar:** search "Filter projects…" · filter All / At risk / Active / Dormant · "SORT" Completion / Risk / Recent · count "6 / 8".
4. **Project grid** (auto-fill, min 290 px; cards size to content). Card anatomy in §4.2.1.
5. **"Suggested actions" strip** (only with proposals): up to 8 rows "Project A · No tests" with [Send Claude] [Add to ideas]; "+N more" text when >8.

**Data shown:**
- `S.browser.captured`, `.updated` → card presence and "5m ago"; `S.browser.current {host/domain, project_name/project_id, focus_ms, title, live}` (live tab replaces it on latest via `hq:browser-live` + `hq:browser-tab`); `by_domain[0..5] {domain, focus_ms}` (durations "45s / 12m / 1.2h"); `by_project[0..4] {project_name, focus_ms}`. Browser numbers are (est.) (see SCREEN TIME).
- `S.projects[]` → grid; count = filtered / total.
- Suggested actions from `agencyProposals(S)`: `signals.has_tests / has_ci / has_readme / has_license` explicitly `false` (projects without `path` skipped); one row per gap with `seedPrompt` ("Add a test suite to this project and make it pass.") and `captureText` ("Project A: add a test suite").

**Actions (page):**

| Control | Does | Side effects |
|---|---|---|
| Search | Live filter on name/stack | lost on reload; no debounce |
| Filter All / At risk / Active / Dormant | At risk = git risk high OR build red OR security high; Active / Dormant by `activity.state` | full re-render, re-animates page |
| Sort Completion / Risk / Recent | completion desc (est.); composite risk (git + build red + security + >20 dirty); days since commit asc | cards only |
| Send Claude | Terminal with the seed prompt | "Opened ▸" (stays disabled) / "✗ Not opened — retry"; Claude quota; disabled in harness |
| Add to ideas | Capture as an idea | **blocking re-assemble (UI freezes), reload**; "Saving…"; "✗ Not saved — retry" |

"+N more" is plain text (dead end). Live pushes: dev status (only while mounted) and browser tab.

**States:** no scans → blank stage; zero projects / no matches → empty grid, "0 / 8", no message; no browser data → setup hint "Load the WorkspaceHQ Bridge Chrome extension (browser-bridge/) to see what you're building, live." (live + latest) or nothing; no proposals → strip omitted; errors → strip buttons "✗ … — retry" (reason in tooltip); **past snapshot: strip buttons and card dev buttons stay live and act on today's repos**; harness: no dev buttons, no hint, strip buttons disabled "Needs the live app — … unavailable in this preview".

**Links:** in from rail / digit 2 / palette / HOME decision card (+ drawer). Out: card → inline detail; "Open ⤢" → drawer. Nothing links to TASKS, SCREEN TIME or NOTES.

**Problems:** telemetry above projects (and duplicated in the right rail and SCREEN TIME); filter vs sort risk definitions differ; stale projects in neither Active nor Dormant; no empty/no-match message; uneven redraws; state lost on reload; suggested actions cover only 4 gaps, one row per gap, dead "+N more", freezing "Add to ideas"; no past-snapshot gating.

**Designer notes:** answer "which project needs me" first; lead with attention signals (secrets, uncommitted, no remote, stale, build red), not the estimated %. One global "now" component instead of a per-page browser card (at most a "12m in browser today" chip per card). Gap chips per project with one "Fix with Claude" verb. Non-negotiables: search + filter + sort + count; per-project dev toggle at grid level; honest async copy ("Terminal opened", never "Done"); disabled-with-reason in the harness; visible past-snapshot mode. A shelved parallel redesign exists in `dashboard-v4/src/surfaces/projects/` (reference only). Archived projects + Restore could live here as a filter (§10).

#### 4.2.1 Project card + inline detail — `.card` / `.nx-detail`
*Files: `forge/view.js projectCard/buildPeek/togglePeek`; `forge.css`; `components.css .card/.bar/.tag/.cdevbtn`.*

**Job:** At a glance: how far along, is git/build/tests healthy, is it alive, is its dev server running? Then peek deeper without leaving the grid.

**Layout today:**
1. Dev-server toggle (live app + `dev_cmd` only): 24 px glyph-only square ▶ / ■, absolute top-left, green glow when running.
2. Top-right: unlabelled completion delta "▲ +5" / "▼ -3" (hidden if 0; CSS class `.xpd` though it's not XP).
3. Title row: big "72%" (est.) + name.
4. Stack line: first 4 entries "node · react · vite · tailwind".
5. Completion bar: red <50, orange <80, green ≥80.
6. Badges: "build: green / red / runs / unknown" (est.) · "git: in sync / 12 dirty / 3 ahead / no remote / 0 commits / no git" · "tests: 14/16 / present / none" · activity "active / stale / dormant" · (archetype badge, fantasy register only, effectively unreachable).
7. Left edge stripe by git risk: high red, medium orange, low green.
8. Footer: "▸ Details" · [Open ⤢].
9. Inline detail (click anywhere on the card): 8 metric tiles (completion "72% ▲ +5", git "12 dirty" with risk seam, activity, last commit "today / 3d ago / —", files · loc "120 · 8,400", tests, todo/fixme "7", secrets "0" red when >0) · **git** "branch → remote · 12 dirty · 3 ahead · 1 behind · 240 commits" · **last** italic commit subject · **stack** all chips or "no stack detected" · **tasks** up to 4 open tasks with tier dots or "no open tasks" · **browser** "1.2h · 14 visits · domain-a, domain-b" or "no browser time this scan" · **recent** clickable file chips · completion rationale (est.).

**Data shown:** `completion.pct` (est.) + renderer-computed delta (stored `completion.delta` unused); `name`, `stack[]`; `code_health.build` (est.); `git_safety {has_git, commits, has_remote, dirty, unpushed, ahead, behind, risk, branch, remote, last_commit_subject}` (badge priority: no git > 0 commits > no remote > N dirty > N ahead > in sync); `code_health.tests {passing (est.), count, present}`; `activity.state`, `days_since_commit`; `code_health.files, loc, todo_fixme, recent_files[]`; `risk_security.secrets_found`; `S.quests[]` for the project; `S.browser.by_project[]` match; `completion.basis` (est.); `dev_cmd`, renderer `devState`.
**In the data but not shown on PROJECTS:** `xp_delta` (dead), `xp_breakdown`, `commit_cadence_7d` (dead), `loc_delta`, `build_note`, `disk.reclaimable_bytes`, `disk.fat_dirs`, `signals.dep_count/has_dockerfile/build_script/test_script`, `stale_deps`, quest `age_days`.

**Actions:** card click (inline detail) · ▶ start dev server · ■ stop · Open ⤢ (drawer) · recent-file chip (open file). Task rows and browser line are plain text.

**States:** missing fields "—", "no stack detected", "no open tasks", "no browser time this scan"; no `dev_cmd`/harness → no dev button; running → ■ with glow, no command or port shown; past snapshot → old numbers, dev button still live.

**Problems:** the softest number (est. %) is the loudest; hard risks are small badges or hidden; three colour systems per card; the same facts at three tiers (card → detail → drawer folds); two expand models (inline vs drawer); clickable `div` with no keyboard focus; 24 px glyph-only dev toggle likely overlaps the % headline (unrendered); **dev state is renderer memory only**: after any reload, or a start from a drawer opened elsewhere, the card shows ▶ for a running server, clicking ▶ silently does nothing, and crashes silently flip back to ▶ (`code`/`error` ignored).

**Designer notes:** hierarchy: name + state + ONE "needs attention" reason → git/build/test chips → completion as a secondary, labelled estimate. Pick one expand model. Non-negotiables: dev start/stop + running indicator (ideally URL/port); dirty / ahead / no-remote; secrets > 0 loud; one-click recent files; open tasks linking to TASKS. Engineering ask: reliable dev state needs a new "list running dev servers" invoke channel (IPC-CONTRACT entry first; additive only).

### 4.3 TASKS — `hunts`
*Files: `realms/hunts/{manifest,view}.js`, `styles/realms/hunts.css`; row and drawer helpers in `ui/components.js`.*

**Job:** "Across all my projects, what is at risk or broken that I should fix next, and what did I just clear?" Rail #3, digit 3, badge = open task count.

**Layout today:**
1. No header or summary; opens straight into the board.
2. **Board** (responsive grid, columns ≥300 px, up to 4 side by side):
   - Tier columns: "Critical — loss & breakage" (red), "Important — before production" (orange), "Housekeeping" (yellow). Header = dot + label + count. Empty column: "All clear."
   - **Task card:** left XP chip "+100"; title + age chip "12d" (hidden at 0; warning colour at ≥7 days); one-line "why"; "↳ Project A"; actions **Open**, **⚡** (icon only), **Done**.
   - **"Ideas & risks" column** (blue; only if any): header + total + red "N urgent"; **first 12 rows only**. Each row: kind badge RISK / URGENT / IDEA / POLISH; title + "↳ Project A"; detail; tags "effort S · impact high · ✦ AI"; actions 🗑 PURGE (reclaim rows only), ⚡, ✓ DID IT.
3. **"Completed this scan" strip** (if any): "✓ 3 completed this scan" + inline "Title +100".

**Data shown:**
- `S.quests[]` with status open/in_progress → cards by `tier`; order = pipeline order (carried first, then derived); no sort.
- `quest.title`: derived templates ("Put Project A under version control", "Commit + push Project A", "Add a remote + push Project A", "Commit Project A working tree (23 files)", "Push Project A (3 ahead)", "Fix Project A build"); **counts are frozen at creation and go stale**. Older carried tasks can be free text.
- `quest.xp` (red 100 / orange 60 / yellow 30); `quest.age_days`; `quest.insight` ("23 uncommitted files at risk."; for build tasks it comes from `code_health.build_note`, (est.)); `quest.project_id` → project name and path.
- Completed strip: `quests[]` with `completed === scan.id`.
- Ideas: `S.side_quests[]` (≤40, sorted risk → urgent → idea → polish then severity; quick captures pushed on top): `kind, title, effort, impact, project_name` ("Inbox" when unmatched), `detail` (captures literally "captured"), `source === 'llm'` → "✦ AI" (est.), `fat_dirs` → PURGE, `reclaim_bytes` in the title ("Reclaim 1.2 GB of disk").
- Rail badge: `account.totals.open_quests` (tier tasks only).
- **Present but never shown:** `status === 'in_progress'` (looks like open), `auto_complete_when` (e.g. `dirty<=2`: closes itself next scan), `evidence`, `created`, `carried_from`, `side_quest.severity`, `totals.open_side_quests`.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| Task Open | Opens the project folder | Explorer; native error outside <Documents> |
| Task ⚡ ("Send to a Claude session") | Interactive Claude in the project, seeded "title — insight" | external terminal (Claude quota); no UI warning |
| Task Done | Marks done | overrides + acted-on ledger; app freezes for seconds; **reload**; XP bubble; no undo |
| Idea 🗑 PURGE | Deletes regenerable caches | native confirm; delete; full scan with enrich (Claude quota); reload |
| Idea ⚡ | Same as task ⚡ with "title — detail" | hidden for Inbox captures |
| Idea ✓ DID IT | Marks done | same freeze + reload + XP bubble (ideas earn no XP); no ledger entry |

Not clickable: card body, project line, XP chip, column headers.

**States:** no scan → blank; all tiers empty → three "All clear." panels (common: every quest in current data is done); Ideas column and completed strip omitted when empty; after Done the button greys until the reload; if the task is already done in the overrides file, main changes nothing and skips the reload (the handler still returns `true`, and the renderer doesn't read the result anyway), so the button just stays disabled with no message; **past snapshot → every action button hidden** (no banner); harness → zero buttons.

**Links:** in from rail / digit 3 / HOME chip / HOME picks without project / HOME decision card / palette QUEST or IDEA (none scroll to or highlight the item). Out: none in-app (no task → project drawer link). Focus isn't offered on task cards; after a Done-reload lands on TASKS, F is dead until HOME is visited.

**Problems:** the same concern twice (red task "Commit Project A working tree (23 files)" and URGENT idea "Commit the working tree (23 files)" for one dirty tree); four equal columns with no "do this first"; risks look no more important than housekeeping; no dismiss/snooze though the data supports `dismissed`; silent 12-of-40 cap with captures pushing real risks down; no filter, sort, search, grouping or summary; every completion = freeze + reload + bubble; unlabelled ⚡ spends quota; "Done" vs "✓ DID IT" for one action, logged differently; auto-closing tasks invisible; `in_progress` invisible; time-on-task always 0 (minutes vs seconds).

**Designer notes:** matters most: the Critical list, a readable "why", and three resolutions per task (open it, hand to Claude, mark done). Options: one ranked list with tier badges (+ group-by-project); show duplicate concerns once; Ideas & risks as its own segment or inside each project page; collapsible "Done today". Add: dismiss/snooze (needs a write path), "closes automatically when …" hint, project link → project page, a Focus button per task, a header summary ("12 open · 3 critical"), a non-blocking "saving…" for Done. Non-negotiables: no actions on past snapshots; completion through `hq.markQuestDone`; PURGE keeps its confirm; ⚡ says it opens a terminal session; red keeps its meaning (data loss / breakage).

### 4.4 AUTOMATIONS — `grimoire`
*Files: `realms/grimoire/{manifest,view}.js`, `styles/realms/grimoire.css`; run flow in `ui/components.js`, stream wiring in `fx.js`.*

**What an "automation" is (internally a "spell").** Anything runnable the app found on this machine, listed in one catalog so it can be run with one click. A read-only scanner (`collector/spellbook.mjs`) builds `data/spellbook.json` from six sources:

| Source (UI label) | What it is | id format |
|---|---|---|
| Built-in | Hand-written app recipes in `spellbook/spells/*.md`: **Deep Scan**, **Rebuild Dashboard Data**, **Weekly Saga** | `grimoire:<id>` |
| Skills / Commands | Claude Code skills and slash commands (personal + plugins); most of the catalog | `skill:<name>`, `skill:<plugin>:<name>`, `command:<plugin>:<cmd>` |
| Scripts | `*.ps1` / `*.mjs` at the app repo root | `script:<file>` |
| npm | Every `package.json` script of every tracked project | `npm:<projectId>:<script>` |
| Tasks | Windows Scheduled Tasks (non-Microsoft) | `task:<name>` |
| Plugins | Installed Claude plugin bundles (reference only) | `plugin:<name>` |

Also listed: **Agents** (MCP servers configured for Claude), never runnable.

Four **kinds**: **Runnable** (castable; headless, output streams to the Run log, ends resolved or fizzled) · **Interactive** (channeled; opens a terminal, e.g. `claude /skill-x` or `npm run dev`; recorded as "channeled" when the window opens, result never seen) · **Chain** (ordered Runnables, stops at first failure, always confirms) · **Plugin** (tome; information only).

**Safety model (non-negotiable):** the catalog is a whitelist. The UI sends only an **id**; main looks up the exact command. The exact command line + folder is shown and needs a second click on: the first run of anything, any run after its file changed (content hash differs), and every run of scripts, npm deploy/release/publish scripts and chains.

**Scale:** ~944–980 entries; only ~34 run headless; ~16 are scheduled; ~116 are plugin tomes; most of the rest are Interactive Claude skills. ~16 successful runs ever.

**Economy (settles only at the next scan):** +5 XP per distinct automation per day (cap 25/day); +15 for the first-ever success; +20 when usage rank rises; +10 for running the day's suggested automation. Usage rank = distinct days used: 1 / 5 / 15 / 40 / 100 → Novice / Adept / Expert / Master / Grandmaster. Failures never count.

**Job:** "What can I run on this machine, which ones do I actually use, and run one safely right now?" Rail #4, digit 4, badge = catalog size (~1,000; not actionable).

**Layout today:**
1. Header "Automations · 944 known" + **DEEP SCAN** + **RESCAN** (hidden without preload).
2. Category chips (8): Analyze · Generate · Build · Secure · Execute · Design · Notify · Fix, each with a count; coloured outline when active; click again to clear.
3. Coverage meter (if the snapshot has spellcraft data): "COVERAGE" bar + "123/944 used (13%) · 456 total runs" + 8 tiny per-category bars (tooltip "Analyze: 5/120 run").
4. Toolbar 1: search "Search automations…" + Source segment (All / Built-in / Skills / Commands / Scripts / npm / Tasks / Plugins) + "N matches".
5. Toolbar 2: Kind (All / Runnable / Interactive / Plugin) · Usage (All / Used / Unused) · "⏳ Scheduled" toggle · Sort (Most used / Recent / Name) · "Clear filters" (when any filter is off default).
6. Card grid (≥280 px columns), first **24** results; whole card clickable; 3 px left stripe in category colour. Card: emoji icon + name + usage dots "●●○○○" (if ever used) · category (coloured) + source · description (3-line clamp) · footer: next-run countdown "⏳ 3h 12m" / "ready" (scheduled only), kind chip (Interactive / Plugin / Chain), **RUN** (Runnable, Chain, Interactive; disabled if invalid).
7. "Show more (N hidden)" (+120 per click).
8. "Agents · N available" shelf: tiles "◉ Agent X" / "stdio · user" (hover shows command/URL). Reference only.
9. **Detail drawer** (shares `#drawer`): header icon, name, "Analyze · Skills · Adept (7d used)", ✕ → description (LLM tooltip if present, else description) → notes (Built-ins only, first 1200 chars) → **COMMAND** exact line (chains: "steps: a → b → c") → `dir:`, `source:` (file path), schedule "next: … · last: … (result 0)", "runs: 12 · last: 2026-10-01 14:03" → **RUN**, **Open file**.
10. Triggers the shared Run confirm (§3.14) and Run log (§3.15).

**Data shown:**
- `bundle.spellbook` (sidecar, **not** time-traveled): `counts.total`, `counts.by_school`; `spells[] {id, name, icon, source, kind, description ≤240, body, command, args, cwd, origin_path, schedule{next_run, last_run, last_result}, chain[], invalid}`; `school` → category (est.: keyword heuristic or LLM, except Built-ins); `tooltip` (LLM-written, est.); `familiars[] {name, transport, scope, detail}`.
- `bundle.telemetry.rollup[id]` (baked at build, **stale after a run until rebuild**): `distinct_days.length` → dots + rank; `last_cast` → Recent sort + drawer; `lifetime_casts` → "runs".
- `S.account.spellcraft` (time-travels): `spells_known, ever_cast, ever_cast_pct, lifetime_casts, per_school.{known, cast, pct}`.
- Carried but not rendered in NEXUS: `rarity`, `confirm` (always-asks), `timeout_min`, `schedule.state`.
- Available, unused: `telemetry.favorites`, `telemetry.confirmed_hashes` (could show "approved"), `telemetry.casts[]` (last 500 runs incl. failures, exit codes, durations), `rollup.avg_duration_ms`, `spellcraft.mastery`.

**Actions:** DEEP SCAN · RESCAN · category chip ×8 · search · source · kind · usage · scheduled · sort · clear filters · card click · card RUN · show more · drawer RUN · drawer Open file · drawer close. Side effects:

| Control | Side effects |
|---|---|
| DEEP SCAN | confirm first time; full pipeline incl. LLM enrich (Claude quota) + vault report; **main reloads the window mid-run** when the new scan lands (Run log wiped); 20-min timeout |
| RESCAN | blocking (incl. a Windows task query, up to ~30 s); rewrites the catalog; reload; "…" meanwhile; errors ignored |
| Filters / search / sort / show more | local only; filter state survives realm switches, lost on reload |
| RUN (card or drawer) | confirm if needed; Runnable → background + Run log; Interactive → terminal (Claude skills spend quota); scripts, npm deploy/release/publish and chains confirm every time; no busy state |
| Open file | opens only under <Documents>; **silently nothing** for most Claude skills |

**States:** no catalog → "No automations indexed yet — run node collector/spellbook.mjs (or the full pipeline) to build the catalog." (developer jargon); 0 matches → empty grid + "0 matches"; no agents → shelf omitted; old scans → coverage hidden; run errors only as red Run log lines ("✖ Name: already casting", "spawn failed: …", "unknown spell"); **past snapshot: catalog and RUN stay live while the coverage meter time-travels** (mixed timeframes); harness: DEEP SCAN / RESCAN / Open file hidden, RUN → `alert("Casting engine needs the Electron app…")`; countdowns refresh every 30 s.

**Links:** in from rail / digit 4 / HOME ribbon (runs directly) / palette SPELL (realm only) / tray "Open Spellbook" (only shows the window) / OS toasts ("Open WorkspaceHQ → Spellbook…", old name). Out: drawer, run confirm, Run log, terminal, default app.

**Problems:** a wall of ~944 items where ~34 truly run, and RUN on most means "open a terminal"; 25+ filter controls in three rows before content, with overlapping axes (Source "Plugins" vs Kind "Plugin"; Source "Tasks" vs "⏳ Scheduled"); meaningless badge; **favorites exist in the engine and drive the quick-run palette, tray and mini HUD, but nothing here can set one**; no running state, last result or history on cards; RUN live on past snapshots; guessed categories and invisible rarity drive layout and colour; raw absolute paths; silent Open file; DEEP SCAN duplicates "Scan now" with different behaviour; usage dots stale after runs; nothing says which items always ask, open a terminal or spend tokens; Agents shelf is a dead end.

**Designer notes:** matters most: find and run the ~30 things that truly run, with confidence (what it will do, did it work last time); a favorites shelf with a pin action; scheduled items with next run. Options: split "Runnable" (default) vs "Library" (skills, plugins, agents to browse); collapse category/source/kind/usage into one filter popover; move coverage to history; drop rarity; per-item "last runs" in the drawer. Non-negotiables: UI sends only an id; exact command + folder before a first, changed or always-ask run; invalid items can't run; plugins and agents aren't runnable; a running item is cancellable; Interactive items labelled "opens a terminal". A shelved v4 surface (`dashboard-v4/src/surfaces/automate/`) already wired favorite stars and cancel (engineering reference).

### 4.5 MAP — `lands`
*Files: `realms/lands/{manifest,view}.js`, `styles/realms/lands.css`; shared `.mapwrap/.isomap/.invcard/.invrow` in `components.css`.*

**Job:** "Where does my whole portfolio stand at a glance, and what is lying around in storage?" Rail #5, digit 5.

**Layout today:**
1. Header row "Project map · N projects" + inline legend: swatches on track (green), in progress (yellow), early (orange), at risk (red); red pennant "open tasks"; gold "⚠ secrets"; text "idle time per project · faded = dormant".
2. **Isometric map** (full stage width, max 72vh, rounded card with radial gradient). One tower per project on a diamond tile; near-square grid (columns = ceil(√n)) in raw data order, so **position means nothing**. Tower encodes:
   - height = completion % (est.)
   - colour = "standing": red if git risk high or build red; else orange <40%, yellow <75%, green ≥75%; darkens as days since commit approach 90
   - floor lines bright / dim / dark = active / stale / dormant
   - red pennant with open-task count; gold ⚠ if secrets found
   - two-line label: name (cut at 20 chars) and "NN%" + idle time ("21d", "3mo"; only when idle ≥14 days)
3. "Storage" heading (column capped ~880 px, so it doesn't line up with the full-width map).
4. **Storage card grid** (auto-fit, ≥280 px; each card only when it has rows):
   - Knowledge bases · N: vault name, "N notes", role pill ("primary")
   - Reference clones · N: repo short name (origin on hover), pill "clean" or "N diverged"
   - Anomalies · N: detail + severity pill
   - Duplicates · N: detail + type pill
   - Trivial / empty: "Empty folders" comma list + trivial items (name + note)
   - Archived projects · N: name, "archived YYYY-MM-DD", **↺ Restore**
   - What I learned · N total · +N XP: recent learnings (text + date)

**Data shown:** `S.projects[] {id, name, completion.pct (est.), git_safety.risk, code_health.build (est.), activity.days_since_commit, activity.state, risk_security.secrets_found}`; open/in-progress `S.quests[]` per project → pennant; `S.side_quests[]` counted per project but never drawn (dead parameter); `S.inventory.{vaults[] {name, notes, role}, clones[] {name, origin, dirty, diverged}, anomalies[] {detail, severity}, duplicates[] {detail, type}, empty[], trivial[] {name, note}}` (anomalies and trivial are carried, never regenerated); `S.archived_projects[] {id, name, archived_on}`; `S.recent_learnings[] {text, ts}` + `totals.learnings`, `totals.knowledge_xp`.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| Click a tower | Opens the project drawer | none (no keyboard focus, no ARIA) |
| ↺ Restore | Un-archives the project | overrides deleted; re-assemble; **reload**; no confirm, no pending state, no error UI; hidden without preload |

Hover brightens a tower (CSS only, no readout). Clone name shows the origin URL as a native tooltip.

**States:** no scans → completely blank; no projects → "No products to map." ("products", not projects); no storage data → "Storage" heading over an empty grid; **past snapshot → Restore stays active and acts on live state**; harness → Restore hidden, drawer without action bar.

**Links:** in from rail / digit 5 / palette ("GO MAP", alias `lands`). Out: tower → drawer. Archive (drawer ⋯) and Restore (here) live apart; drawer "I learned…" feeds the learnings card here.

**Problems:** 6 variables in arbitrary grid order, no hover card, sort or grouping; colour mixes completion bands, risk overrides and decay; not accessible (SVG groups with `onclick`, no focus/role/title); hard-coded dark colours (ground `#0e0b22`), so in DAYLIGHT it's a dark-purple diorama on a white card; "Storage" mixes 7 unrelated card types and duplicates NOTES (vaults) and SYSTEM (cleanup); **clone pill mislabelled** ("N diverged" shows the dirty-file count); risky Restore; no summary counts ("4 on track · 3 stale · 1 at risk").

**Designer notes:** matters most: portfolio health at a glance where the worst project is obvious in about a second, one click to open it. The isometric "city" is the app's most distinctive visual and fits the owner's "System HUD" North Star; worth keeping as a **mode** with legible encoding: deliberate sort (risk, then activity), a hover card (name, %, idle, open tasks, risk) and a summary strip. Options: MAP becomes a view toggle inside PROJECTS; Storage dissolves (vaults → NOTES; clones, duplicates, empty, trivial, anomalies → SYSTEM/cleanup; archived → PROJECTS "Archived" filter; learnings → NOTES or history). Non-negotiables: click a project → project page; secrets warning loud; un-archive exists, ideally next to archive; writes disabled (or labelled "acts on live") on past snapshots; tokenized colours.

### 4.6 HISTORY — `legacy`
*Files: `realms/legacy/{manifest,view}.js`, `styles/realms/legacy.css`; shared `.charts/.chart/.legend/.ach-grid/.ach/.blessing` in `components.css`; `intel/derive.mjs momentum`, `intel/foresight.mjs forecastLine`.*

**Job:** "Am I getting better over time, what are my bests, and which milestones have I earned?" Rail #6, digit 6, badge = unlocked milestones (not actionable).

**Layout today:**
1. **"Personal records"** (~880 px column): up to 5 tiles (icon, big value, uppercase label, sub-line, coloured left border): ❤ Peak health · ✦ Peak account XP · 🔥 Longest streak · ⚡ Most runs / day · ◆ Best completion.
2. **Trend chart grid** (full width, auto-fit ≥330 px). Card: small-caps title, latest value in large gold top-right (single-series), 320×130 SVG; only axis label is the max value; **no x-axis dates on line charts**; hover → guide line, dot, tooltip with date and values.
   1. Health index (green area; est.)
   2. Account XP (purple area)
   3. Automation runs / day (gold; only if data exists)
   4. Completion % by project: ~10 coloured lines, 9-colour palette repeats, legend (est.)
   5. Open tasks by priority: stacked bars critical/important/housekeeping, MM-DD label under **every** bar
   6. Git-safety risk: stacked bars high/medium/low
3. **Progress grid** (2 cards): **Momentum forecast** (header Rising/Falling/Flat; big "+12.3 XP/scan"; "~N scans to L{level+1}" or "XP is trending down — no level ETA." / "Not enough forward motion to project a date."; "based on N scans") · **Follow-through** (header NN%, bar, "N resolved" / "N acted on"; empty "No prompted actions taken yet.").
4. **"Consistency · level N"**: 8 pips, "N active days", "Level N / 8", bar to next threshold, "N more active days to reach level N+1" or "Every level reached — great consistency."
5. **"Milestones · N unlocked"** trophy grid (auto-fill ≥195 px, ~22 cards): 38 px pixel-art/emoji icon (greyscale locked, bouncing unlocked), name, one-line description, footer "unlocked YYYY-MM-DD" or progress bar + "have / need" or "locked"; unlocked = gold ring + ★. **Click** unfolds: Unlock (criteria) + Status / Progress / Remaining.

**Data shown** (every series clipped to points `d <= S.scan.id`):
- `S.trends.health_index[]` (est.) → peak + chart · `S.trends.xp[]` → peak + chart + momentum slope · `S.trends.casts_per_day[]` (feature-detected, not in CONTRACT) · `S.trends.completion_by_project{id: [{d,v}]}` (est.) + names · `S.trends.open_quests_by_tier[] {d, red, orange, yellow}` · `S.trends.git_risk[] {d, high, medium, low}` · `S.trends.knowledge_xp` (in contract, **shown nowhere**).
- `a.streak.longest_scan_days` (or derived from the health series) → longest streak (scanner days).
- `a.level`, `a.xp_to_next` → `momentum()` → `forecastLine()` (est.: least-squares slope per scan; ETA in scans, not days).
- `bundle.actedOn.entries[] {at, resolved | marked_done}` → follow-through (baked; stale until rebuild).
- `scans[].quests[].completed === scan.id` → consistency "active days" (thresholds 1, 3, 5, 8, 12, 17, 23, 30).
- `S.achievements[] {id, unlocked, unlocked_on, progress{have, need}}` + the static `ACH` catalog (name, icon, desc) in `ui/components.js` (duplicated in `schema/gamification.config.json`, which also carries XP).

**Actions:** hover line chart (tooltip) · hover stacked bars (tooltip with total + tiers) · click milestone card (detail; open state survives scrubs until reload). Read-only surface.

**States:** no scans → blank; missing series → card/tile dropped; series with no points to the selected date → an empty chart box with no message; no achievements → "Milestones · 0 unlocked" over nothing; past snapshot → everything rewinds **except Consistency, which counts all scans including "future" ones** (time-travel bug); harness identical.

**Links:** in from rail / digit 6 / palette. Out: none (no link to a project, task or date).

**Problems:** six same-size small charts with no hierarchy, no x dates, max-only y scale; per-project completion chart is ~10-line spaghetti with repeating colours; stacked bars print a date under every bar (unreadable at ~38+ scans); hard-coded hex (gridlines `#1d1840`, labels `#5e588a`); redundant stats (Peak XP ≈ current XP; XP chart vs HUD vs HOME momentum; health chart vs HOME vs time-machine sparkline); trophy unfold repeats the card; "drive to zero" milestones show "5 / 0" with an empty bar; **the "Almost there" nudge strip (`ui/nudge.js`) has no caller** since ATLAS was folded in; two streak concepts (scan days vs days with a completed task) and an overloaded "level"; jargon ("acted on", "XP/scan", "follow-through", "scans to L5"); alternating section widths; non-actionable badge.

**Designer notes:** matters most: "am I improving?": 3–4 headline trends with real axes and a selectable range; records as a compact hero row; milestones grouped unlocked / in-progress / locked with "almost there" first. Options: merge with TIMELINE into one history surface (Trends · Timeline · Milestones); cut the Account XP chart and Peak XP record; replace the spaghetti chart with small multiples or a sparkline table (project · now % · Δ · sparkline); thin the bar labels; restore the nudge strip; fold Consistency into the streak story. Non-negotiables: everything time-travels (Consistency fix required); read-only; the forecast keeps "based on N scans" and per-scan units (no fake calendar dates).

### 4.7 SYSTEM — `medbay`
*Files: `realms/medbay/{manifest,view}.js`, `styles/realms/medbay.css`; main handlers `hq:health-scan`, `hq:health-fix`; producer `collector/pc-health.mjs` + `pc-health.ps1`.*

**Job:** "Is this PC healthy right now, what's wrong, and what can I safely run to fix it?" The page also answers two unrelated questions: "is a local AI model available?" and "what folder clutter should I clean up?" Rail #7, digit 7, badge = critical vitals (hidden at 0).

**Layout today:**
1. **AI runtime strip** (preload only), one dashed line: "AI runtime: probing…" (grey pulse) / "AI runtime: ollama · model-a (3 models installed)" (green) / "AI runtime: none detected — install Ollama or LM Studio to enable local model features" (muted).
2. Header "SYSTEM · this machine" + **Re-examine** (tooltip says ~3 s).
3. Status tally: "5 healthy · 2 warning · 1 critical" + right "scanned 2026-07-23 09:00".
4. **Vitals "body map"**, 8 cards in a body-shaped grid (row 1 GPU "EYES" · CPU "BRAIN" · empty cell; rows 2–3 NETWORK "VEINS" (2 tall) · RAM "HEART" then DISK "GUT" · UPDATES "IMMUNE" (2 tall); row 4 TEMP "LIVER"; row 5 STARTUP "LEGS" full width; one column under 820 px). Card: tiny caps anatomical tag, organ name ("Processor"), status word + dot HEALTHY / WARNING / CRITICAL (green / orange / red), big number + unit ("43 % load"), 120×26 sparkline, plain diagnosis line, fainter joke line; 3 px status stripe; CRITICAL also gets a 1 px ring.
5. **"Recommended fixes · 11 scripts, most urgent first"**: fix cards sorted by organ severity: organ chip, title ("Find the CPU hog"), danger badge "read-only" (green) / "deletes files" (amber) / "needs admin" (red), "why" + joke, monospace PowerShell block, **⧉ COPY** + **RUN** (safe only) or text "copy and run it yourself — deletes files / needs admin", hidden output `<pre>` (max 240 px, red on failure).
6. **"Cleanup — 7 items"**: optional caption "Separately: ~1.2 GB of build artifacts reclaimable across 3 products — freed per project, not from this list."; groups "CLONED REPOS · 2", "DUPLICATES · 1", "EMPTY FOLDERS · 4", each row label + **Note for cleanup**; empty: "No clones, duplicates or empty folders to clear."

**Empty variant (no `pc-health.json` yet):** blocks 2–5 become "SYSTEM · no scan yet" + a card with an animated EKG line, "No health scan yet", "Run a scan to check CPU, memory, GPU, disk, network, startup, updates and temperature.", **Run scan**; caption "Eight system vitals, awaiting the first scan"; ghost body map (8 dashed cards "CPU", "RAM", "DISK", "TEMP FILES"… "—" "Awaiting scan"). AI strip and Cleanup still render.

**Data shown:**
- `DATA.pcHealth` (bundle sidecar, **not per scan**) or the in-memory Re-examine result: `scanned_at`; `organs[] {id, label, value, unit, status: grace/ember/blood (ok/watch/act; unknown → WARNING), spark[≤24], diagnosis, teaching (joke), fixes[] {title, why, teaching, command, danger: safe/caution/admin}}`. Spark = one sample per health probe (every pipeline run, scheduled or manual, plus each Re-examine; x-axis is "probes", not days), hidden under 2 samples.
- Today's 8 vitals and thresholds (collector-owned):

  | Vital | Unit | Healthy / warning |
  |---|---|---|
  | Processor | % load | ≤55 / ≤85 |
  | Memory | % used | ≤75 / ≤90 |
  | Graphics | GB VRAM | status from **driver age** ≤365 / ≤730 days |
  | Storage | GB free | % free ≥20 / ≥10 |
  | Startup | apps | ≤8 / ≤16 |
  | Temp debt | GB | ≤2 / ≤8 |
  | Network | ms ping to 1.1.1.1 | ≤40 / ≤120; null = CRITICAL |
  | Updates | days since last update | ≤30 / ≤90; null = WARNING |

  GPU card mismatch: number = VRAM (never changes), status = driver age, sparkline = driver-age days.
- Available, not rendered: `host {cpu, ramGB, uptimeHrs, battery}`.
- `hq.probeLlm()` → `{available, runtime: 'ollama'/'lmstudio', chatModel, models[]}` (runtime id printed raw).
- From the selected scan (time-travels): `inventory.clones[].name` (origin/dirty/diverged unused), `inventory.duplicates[].detail` (type/severity unused), `inventory.empty[]`; sum of `projects[].disk.reclaimable_bytes` → caption. `anomalies` and `trivial` only on MAP.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| Re-examine / Run scan | Fresh PC-health probe, re-render in place | writes `pc-health.json` + history; **blocking** rebuild (main briefly frozen); no reload; failure silently reverts the button; rail badge stale until reload |
| ⧉ COPY | Copy the exact command | clipboard; label 1.4 s; no fallback |
| RUN (safe only) | Run and show stdout+stderr below | main re-validates the command verbatim against on-disk `pc-health.json` (else "refused: not a whitelisted read-only fix"); spawnSync PowerShell, 30 s, 6000-char cap; **main blocked for the whole run**; 4 of 9 safe fixes open Windows apps and print "(done — no output)"; `ipconfig /flushdns` changes state; "Find the biggest folders" can hit 30 s |
| Note for cleanup | Saves "Clean up: <label>" as an idea | brain-dump; blocking re-assemble; **reload** (scroll lost); "✗ Not saved — retry"; nothing remembers noted rows |

AI probe runs automatically on mount (30 s cache, never forced, no refresh control).

**States:** empty (above; only before the first pipeline run or Re-examine). The probe runs as an optional step of **every** pipeline run, including the scheduled one (`run-pipeline.ps1:41`; confirmed in the 2026-10-03 pipeline log), so "scanned …" is normally under a day old; it goes stale only if the scheduled task stops firing or the optional step fails, which is skipped silently (§5.13); loading "Scanning…", RUN "running…" + "…", AI "probing…"; errors: failed scan invisible, failed RUN red output, "✗ COPY FAILED", "✗ Not saved — retry"; offline → Network CRITICAL "—" "No response from 1.1.1.1 — offline, or the ICMP gate is closed."; **past snapshot: vitals and fixes ignore it, Cleanup follows it, nothing says "past", RUN and Note stay live**; harness: no AI strip or Re-examine, empty-state copy "This machine hasn't been scanned yet…", safe fixes become copy-only, Cleanup buttons disabled "Needs the live app — capture is unavailable in this preview".

**Links:** in from rail / digit 7 / palette. Out: nothing clickable. Unlinked relationships: the caption points at PROJECTS' per-project purge; noted rows reappear as ideas on TASKS/HOME after reload; ORACLE uses the same probe and can read pc-health; the right rail shows live CPU/RAM every 2.5 s that this page doesn't; MAP repeats clones/duplicates/empty.

**Problems:** three jobs on two clocks on one scroll; costly body-map metaphor (empty cell, tall cards, tags to decode); ~22 lines of prose + 11 code blocks; problem and fix a scroll apart; GPU number doesn't explain its verdict; labels drift between empty and live states; **the "read-only" badge is wrong for 5 of 9 runnable fixes**; silent Re-examine failures and stale badge; meaningless sparklines; heavy, forgetful "Note for cleanup" (and clone rows hide dirty/diverged, exactly what matters before deleting); bare AI strip; unlinked caption; 16 distinct font sizes, 8.5% of text under 12 px.

**Designer notes:** one glanceable verdict ("Machine OK" / "2 issues"); each issue with its fix inline (issue → why → Run / Copy → output); healthy vitals collapse to a chip row; "scanned X ago" with a staleness warning. Options: live CPU/RAM in this page's header; Cleanup to PROJECTS/MAP or a separate "Workspace clutter" tab; AI status in a shared status/settings area with ORACLE; cut anatomy tags and the body grid; jokes cut or one per page, opt-in. Non-negotiables: RUN only for `danger:'safe'` and main re-validates; caution/admin stay copy-only with a clear risk label; full command visible before running; each RUN has its own output; keys `grace/ember/blood` stay (display words and colours free); rename "safe" to something like "won't delete files" and add an "opens an app" hint. Free data: `host.uptimeHrs`, `host.battery`, `host.ramGB`, clone `dirty/diverged/origin`, duplicate `severity`, `inventory.anomalies[]`. Engineering asks: open-folder/delete for cleanup rows (new main handler in a NEW file); a capture path that doesn't reload; a non-blocking RUN.

### 4.8 NOTES — `observatory`
*Files: `realms/observatory/{manifest,view}.js`, `styles/realms/observatory.css`; no IPC.*

**Job:** "How big and how alive are my Obsidian vaults, and how do I search them?" Rail #8, digit 8.

**Layout today:**
1. Header "Vaults · 3" + muted total "1,234 notes".
2. **Vault grid** (auto-fill ≥240 px); the primary vault first, full row, accent-coloured. Card: name (ellipsis), role pill (free text: "primary", "research", "business"), big "820 notes", thin unlabelled share bar (vs largest vault, min 3%), facts row "12 updated this week" (green) or "No updates this week", "340 untouched 90+ days" (orange, only >0), size "45.2 MB".
3. **"Obsidian sync"** line (never shows today): "last sync 2026-07-23 09:00 · 5 tasks synced". Reads `S.obsidian`, which the scan schema can't carry (`additionalProperties:false`), so it's dead.
4. **"Search across vaults"**: vault `<select>`, input "Search all notes for…", **Copy link**; read-only field showing `obsidian://search?vault=<vault>&query=<text>`; note "This window can't open obsidian:// links directly — copy the link and paste it into Win+R or your browser's address bar."

**Data shown:** `S.inventory.vaults[] {name, notes, role, recent7, stale90, kb}` (last three optional on older scans); sum of notes; vault names → select (primary default); search vault/query kept in module memory (survive realm switches, not reload). No vault path, last-opened date or per-note data.

**Actions:** vault select · query input · Enter (= Copy link) · Copy link (clipboard, fallback select + `execCommand('copy')`; "Copied" / "Selected — Ctrl+C" 1.6 s; coin/blip). Vault cards aren't clickable.

**States:** no vaults → "No vaults found yet — run a scan." (no button; search hidden); no scan → blank; past snapshot → counts follow, no marker; harness identical (no IPC).

**Links:** in from rail / digit 8 / palette VAULT results / HUD subtitle. Out: none. **Invisible background features:** main watches the primary vault's Quest Board note and daily notes (ticked tasks with a quest id complete quests and reload the app, §5.15) and mirrors project notes, decisions and learnings into the vault. None of this shows here.

**Problems:** can't do anything (no open vault/note; search builds a URL to paste into Win+R); heading says "across vaults" but searches one; the real two-way sync is invisible and its section is wired to a field the schema can't carry; unlabelled share bar; role pill mixes "primary" with descriptions; empty state says "run a scan" with no button; stale manifest comment and dead NotebookLM CSS (`.obs-dormant/.obs-shelf/.obs-book/.obs-bt/.obs-bm/.obs-cap`); duplicates MAP's knowledge-bases card; 17 font sizes, **20.5% of text under 12 px**.

**Designer notes:** per-vault vitality (active this week vs stale backlog, could be one bar); a real "Open in Obsidian" / "Search in Obsidian"; a small feed of sync activity ("Task X completed from the Quest Board"). Options: one home for vaults (here or MAP); grow into a "Knowledge" page with `recent_learnings[]`, `totals.learnings`, `knowledge_xp`, project notes and decisions. Engineering asks: opening `obsidian://` needs a new allow-listed main IPC (e.g. `shell.openExternal` restricted to the `obsidian:` scheme); sync status needs a new data field (CONTRACT entry + golden re-baseline, struct lane). Non-negotiables: query text only ever goes into the `obsidian://` URI; vault list comes from collector config (no add-vault UI); works with no preload.

### 4.9 SCREEN TIME — `watchtower`
*Files: `realms/watchtower/{manifest,view,categories}.js`, `styles/realms/watchtower.css`; no IPC; data from the browser extension via `scans[].browser`.*

**Job:** "Where does my browser time go, how much is distraction, and is it getting worse?" Rail #9, digit 9.

**Layout today:**
1. **Trend banner** (only when social time rose 3+ consecutive captured scans): "↑ TREND · Social time has risen 4 scans in a row." Pulsing red alarm in legacy themes, calm orange left-border note in NEXUS.
2. h2 "Overview" → 3 panels (auto-fit ≥238 px):
   - a. **Distraction meter** "DISTRACTION METER · SOCIAL & VIDEO SHARE": semicircle gauge "38%" over "DISTRACTING"; scale Low / Moderate / High (<35 green, <65 orange, ≥65 red); trend chip "▲ +6 pts" "vs last capture".
   - b. **Weekly rhythm** "WEEKLY RHYTHM · TIME BY WEEKDAY": 7 cells M–S, cyan opacity by time; values hover-only ("Mon · 3.2h").
   - c. **Summary**: Total time "41h", Sites tracked "37", Days captured "14", Busiest site "example.com".
3. h2 "Platforms · top 8" → cards (≥220 px). Collapsed: domain (no `www.`), category chip SOCIAL / VIDEO / DEV / DOCS / AI / NEWS / SHOPPING / OTHER, caret ▸, big "6.4h" + trend chip "▲ +22%" (orange) / "▼ -10%" (cyan) / "● ±0" / "new", category-coloured sparkline per captured scan, "Seen 9/14 days · 312 visits", category left border. Expanded: Category, Peak day "1.2h · 07-24", First seen "07-12", Total visits "312", Project "↳ Project A" (if attributed); last page title in quotes; "TIME BY DAY" list "07-24 [bar] 1.2h · 34v" or "—".

**Data shown:**
- Source: `scans[0 … selectedIndex]` with `browser.captured` and non-empty `by_domain[] {domain, focus_ms, visits, last_ts, title}`.
- **⚠ Every rolled-up number is (est.) and overstated.** Each scan's `by_domain` is a trailing **3-day window** (top 15 domains); summing daily scans counts each day up to 3 times (total time, platform totals, peak day, weekday heat, visits). "Days captured" and "Seen N/M days" count scans, not days.
- Distraction % = social + video `focus_ms` / all `focus_ms` in the latest captured scan (est.); categories from hard-coded substring rules (tutorial videos count as distraction).
- Trend chips vs the previous *captured* scan (points for the meter, % for cards; "new" = up from 0). Weekday buckets from `scan.id` dates (UTC; "-N" suffixed ids skipped). Social streak = consecutive strict increases. Project line from `browser.by_project[] {project_name, domains}` (latest mapping wins).
- Category colours: social pink, video red, dev green, docs blue, AI cyan, news orange, shopping gold, other lavender (hard-coded).
- Unused here: `browser.current` (live tab; only the right rail shows it), `browser.totals`, `browser.updated`, `by_project.focus_ms/visits`.

**Actions:** platform card click (expand/collapse; open set survives re-render, not reload). Nothing else: no IPC, writes, filters or range picker.

**States:** empty → "No browsing captured yet" / "There's no browsing time in any snapshot. Load the WorkspaceHQ Bridge extension (browser-bridge/ → chrome://extensions → Load unpacked) and tracking begins on the next scan." (no button); single captured scan → no trend chips, single-dot sparklines, no banner; past snapshot → fully respects it, but before the extension existed it shows the empty state with the false "no browsing time in any snapshot"; harness identical.

**Links:** in from rail / digit 9 / palette. Out: none (project line is plain text). Related: the right rail's live "Working on now" (absent here); SOCIAL is the active social surface.

**Problems:** inflated headline numbers with no "approx"; no time range ("today?", "this week?" unanswerable); "Weekly rhythm" is all-history by weekday, values hover-only; top 8 only (summary says 37 sites); fixed distraction rule and category map, thresholds unexplained; noisy trend chips across scan gaps; in-place expansion reshuffles the grid and the per-day list grows forever; developer-instruction empty state; read-only (no goals, limits, project link); banner differs per theme; 17 font sizes, 11% under 12 px; legacy 6–8 px pixel labels.

**Designer notes:** an honest "Today / This week" header (total, distracting share, top sites, change vs prior period) with a range toggle; label rolled-up totals "approx." until the struct lane fixes double counting (ask: per-day deltas instead of 3-day windows). Options: move the live "Working on now" here; feed per-project browser time into PROJECTS; cut the streak banner (make it a chip) and per-card sparklines. Non-negotiables: renders from data at or before the selection; no IPC; category map extendable by rules; capture owned by the extension (no tracking controls in the app).

### 4.10 ASSISTANT — `summoning`
*Files: `realms/summoning/{manifest,view,session-store,canvas-board}.js`, `styles/realms/summoning.css`; main: `hq:claude-quest`, `hq:sessions-list`, `hq:canvas-*`, `dashboard/claude-sessions.js`, `session-api.js`, `session-tails.js`.*

**Job:** "What is Claude doing for me right now, and how do I give it a new job in one of my projects?" A shared whiteboard sits at the bottom of the page too, unrelated to that question. Rail #10, no digit, badge = running sessions (live, app-wide).

**Layout today (three stacked sections, plain `h2`, no realm title):**
1. **Sessions** "Sessions · 2 running" (green count only when >0). Bordered rows, running first then newest: status chip (dot + "Running" / "Done" / "Failed · exit 1"), one-line label (ellipsis), right time "14:07:33 · 3m", optional "▸ Output" disclosure (monospace box, max 220 px, last ~800 chars).
2. **Start a session** card: teaching line "Opens a **terminal** in the project you pick, with your prompt ready. Close the terminal when the work is done." · PROJECT native `<select>` ("Project A — <absolute path>") · PROMPT textarea (4 rows) · primary "Start session" + inline hint.
3. **Canvas · N boards**: board pills + right "＋ Note" (toggles an inline text input + "Add"); a fixed **520 px** pannable viewport on a dotted grid showing JSON Canvas nodes (text cards, 📄 file chips, 🔗 link chips) joined by curved labelled arrows.

**Data shown:**
- Sessions: `hq.getSessions()` seed + every `hq:claude-sessions` push → `[{jobId, label, status, startedAt, endedAt, exitCode, tail}]`. Status: running = green pulse; done = grey; anything else = red "Failed · exit N" (−1 = spawn error; killed and timed-out show as failed). Label ≤60 chars. **The start form never produces a row.** Real producers: "conjure: <first 32 chars>" (desktop widget generation from Ctrl+Alt+G), "draft-commit" (drawer commit drafting when the local model is down), `hq:session-start` jobs (only the inactive v4 UI starts them). Duration "42s / 3m / 1h 4m"; repaints every 15 s while running. `tail` = last ~800 chars, **untrusted** (escaped): parsed prose + `[tool: …]` / `[error: …]` lines for session-start jobs, raw stdout otherwise (conjure = raw HTML fragment, draft-commit = commit message); `[timeout]` appended on timeout. Lifetime: finished jobs vanish after ~60 s (no history).
- Start form: `data.selected.projects[] {name, path}` (follows the time machine); first preselected.
- Board: `data.bundle.canvas` (baked) → `hq.getCanvas()` → `hq:canvas` pushes; `[{name, nodes[], edges[]}]` from `data/canvas/*.canvas` (Obsidian-compatible). Text nodes via `mdLite` (`###`, `-`, `**bold**` only), so CANVAS widget specs show as raw "```hq {json}" lines. File nodes "📄 basename"; link nodes "🔗 host/path" (**not clickable**). `x/y/width/height` (defaults 0, 0, 280, 120); `color` "1"–"6" or hex → left accent; edges with auto sides and midpoint labels. Plane = node bounding box + 80 px; pan per board in memory.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| "▸ Output" | Expand the tail | none |
| Project select | Target project | none |
| Prompt textarea | Free text | no counter; newlines flattened and cut at 500 chars later |
| Start session | Interactive Claude in a **new external terminal** in the project | Claude quota; untracked (never listed, can't be stopped or diffed); returns false outside <Documents> but the return is ignored and the hint always says "Started — a terminal just opened."; button stays enabled (duplicates possible); empty prompt = blip sound + focus |
| Board pill | Switch board | blip |
| ＋ Note | Toggle note input | disabled without `canvasAdd` or boards |
| Note + Add / Enter | Append a text node at view centre | atomic write; push to main, mini and cast windows; fixed 280×120; UI cap 600 chars (server 2000); optimistic card; failures silent (note can vanish on next push); board names with dots refused; coin sound |
| Drag / wheel on board | Pan (no zoom) | wheel blocks page scroll while over the board |

**States:** empty sessions "No sessions running yet. Start one below." (misleading); zero boards → "No boards", ＋ Note disabled, viewport "No canvas boards yet. Add a **.canvas** file in `data\canvas\` and it will appear here." (no create button); no projects → select disabled "No projects in this scan — run the pipeline first", Start disabled; loading: empty copy flashes before the seed; canvas paints the stale baked snapshot first; errors all silent; past snapshot → project list switches to that snapshot's projects, sessions and canvas stay live; harness → "Not connected — sessions will appear here once the bridge is running.", Start disabled "Not available in the dev harness", ＋ Note disabled "Unavailable — the bridge is offline".

**Links:** rail #10 (no digit), palette "ASSISTANT" (alias `summoning`). **Inbound: none**: PROJECTS "Send Claude", TASKS ⚡ and drawer ⚡ all call the same terminal launcher and never route here. Outbound: none. Ctrl+Alt+G creates "conjure:" rows. The board reads/writes the same files as CANVAS; MCP `hq_canvas_add` defaults to x/y 40/40, so MCP nodes pile on top of each other here.

**Problems:** start form and session list are two unrelated systems; list full of background jobs with internal labels and raw output; live-only, no history; no stop / live output / changes view (engine supports all three); dishonest success message and no double-click guard (PROJECTS' "Send Claude" handles this correctly); lossy prompt (500 chars, flattened newlines); native select with absolute paths, tied to the time machine; a second renderer of CANVAS data under the same word, with raw JSON specs, piled MCP nodes, fixed height, no zoom/fit/reset, non-clickable nodes and chips, no edit/move/delete/create board; wheel traps scroll; hard to find; chiptune as the only validation feedback.

**Designer notes:**
- Matters most: **one agent console per project** with a single loop: dispatch → watch → stop → review changes. The main object is a *session*.
- **Engine already in the preload, used by no v3 screen** (only the inactive v4 WORK pane): design for this, not for the terminal launcher.
  - `hq.sessionStart({cwd, task, label?})` → `{jobId}` or `{error}`: headless Claude (`-p`, stream-json) as a tracked registry job; task ≤2000 chars, label ≤60 (defaults to task start); 15-min timeout; no concurrency limit; all jobs killed on quit; `cwd` must be a project under <Documents>.
  - `hq.onSessionOutput(({jobId, chunk}) => …)`: live parsed text (prose + `[tool: Name hint]` + `[error: subtype]`), untrusted → text only.
  - `hq.sessionKill(jobId)` → true/false; only running jobs; wait for the sessions push (status ≠ running) before saying "stopped".
  - `hq.sessionDiff({cwd, jobId})` → `{files[{path, status: M/A/D/??/R "old -> new"}], stat, baseline}` or `{error}`; `baseline.state` needs three UIs: `captured` (with `paths`: subtract to show "changed by this run" vs "was already dirty"), `unavailable` (not a repo / no git: say so), `none` (unknown job: can't attribute).
  - The registry doesn't return `cwd`; the UI must remember which project each `jobId` belongs to. Live output is lost on reload → fall back to `tail`.
- Recommended model: "Run in app" (tracked, streamed, stoppable, diffable) as primary; "Open in terminal" (interactive, untracked, existing launcher) as secondary, labelled honestly "Opened", never "done".
- Session card: status (running / done / failed; timeout = failed whose tail ends `[timeout]`), label, project, elapsed, live output, Stop (no confirm, visible "Stopping…"), Changes. Honest async: "Starting…" until a `jobId`, "Stopping…" until the push confirms.
- Not wired today (new IPC or storage; new main features in NEW files): history beyond 60 s, follow-up turns, per-job cwd from the registry, token/cost display, creating/editing/deleting canvas nodes or boards.
- Merge/cut: move the whiteboard to CANVAS; every "Send Claude" / ⚡ elsewhere opens this surface pre-filled (seeds exist: task title + insight, the agency `seedPrompt`); hide or relabel background draft-commit and shard jobs (e.g. a "System" filter).
- Non-negotiables: tails, chunks, labels rendered as text; CSP `self`; works in dark and light; rail badge keeps the running count.

### 4.11 ORACLE — `oracle`
*Files: `realms/oracle/{manifest,view}.js`, `styles/realms/oracle.css`; main "PC-Brain Phase 2": `dashboard/main.js`, `llm-local.js`, `llm-context.js`, `llm-persona.md`.*

**Job:** "Ask about my projects, tasks or PC in plain language and get a short, honest answer built only from my own data, computed on this PC with nothing sent to the cloud." Rail #11 (order 10.5), no digit, no badge.

**Context:** a chat with a **local** LLM (Ollama on 127.0.0.1:11434; LM Studio :1234 fallback). For each question main builds a plain-text CONTEXT from the app's own data files; the renderer only picks which sources go in and never sees the context. Persona: a dry, sardonic "game guide"; answers in the first sentence, gives ONE recommendation, stays under ~120 words with at most 4 bullets, says "That's not in what I can see" when the data doesn't hold the answer. Warm reply ~1.5–2 s; cold model load up to ~1 min. The model is pinned in main (env `HQ_LLM_MODEL`); cloud models are refused.

**Layout today (one centred column, max 980 px, fills the stage; log scrolls, composer pinned):**
1. Header: icon tile + "ORACLE" + subtitle "Local model · answers only from your own data · nothing leaves this PC" + **status pill** (dot + text) + **New chat**.
2. Source chips: "Answer from" + 6 toggles Scan, Tasks, Projects, PC health, Browser, Vault (tooltips).
3. Message log (bordered scroll box): empty state or bubbles (user right; model left with accent border); a small monospace meta footer under each finished answer.
4. Offline panel (hidden unless needed): title + explanation + Retry.
5. Composer: textarea growing 1 row → 160 px + Send (becomes Stop while streaming).

**Data shown:**
- Status pill from `hq.probeLlm` (`runtime`, `chatModel`): "checking for a local model…" (pulse) · "preview — no model bridge" · "model offline" · "ollama · no local chat model" (warn) · "loading model-x into GPU memory…" · "ollama · model-x · warm-up failed, first reply may be slow" (warn) · "ollama · model-x" (green glow).
- Chat: localStorage `hq-oracle-chat` (today only, last 40) `{role, content, meta}`. User text plain; model text via `mdLite` (headings, "- " bullets as ▸, **bold**; no links, tables, code, images).
- Streaming: accumulated `hq:llm:delta` text ~25×/s with a blinking ▍; "thinking…" before the first token.
- Meta footer (" · "-joined): status ("stopped"; "model offline — <reason>"; "error — <reason>", incl. "interrupted — the window reloaded" after any scan/commit reload) · "grounded in Scan · Tasks (trimmed) · Projects" or "no sources ticked", plus notes ("Vault: dropped — context budget full", "Scan: no scan data yet", "failed: …") · "2.3s". Non-done footers turn warning-gold. Captured, never shown: `meta.model`, `contextChars`, `sections[].chars`.
- Chips from `hq-oracle-include` (default Scan/Tasks/Projects on; PC health/Browser/Vault off).
- What each source feeds the model (built in main; soft values labelled "(estimate)" inside the context): **Scan** level, XP, health index (est.), open/critical counts, scanner streak, today's 3 picks · **Tasks** open tasks by tier with age and live git counts ("now: 12 uncommitted, 3 unpushed") + measured risks (LLM side-quests excluded) · **Projects** activity, last commit, branch, uncommitted/unpushed, remote, build (est.), tests/CI, possible secrets, completion (est.) · **PC health** each vital (GPU VRAM omitted) · **Browser** today's focus per domain + rolling totals · **Vault** read-only keyword search, top 3 notes with dated snippets. Budget 4 KB per section, 12 KB total.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| New chat | Stops streaming, clears today, focuses input | no confirm; disabled when empty |
| Source chip ×6 | Include that section in the next question | localStorage; no IPC on click |
| Suggested prompt ×4 (empty state) | Sends that question (draft untouched) | disabled until the model is ready |
| Textarea | Enter sends, Shift+Enter newline (IME-safe) | draft lost on reload |
| Send | Question + earlier complete Q→A pairs (stopped/failed pairs dropped) | main reads `latest.json`, `pc-health.json`, browser sidecar; with Vault, walks up to 4000 .md files; HTTP only to 127.0.0.1; no cloud, no money |
| Stop | Aborts; keeps partial; footer "stopped" | — |
| Retry (offline panel) | Re-probe past the 30 s cache, then warm the model | can take ~1 min |

Probe + warm-up run automatically on every mount (skipped mid-stream; model kept in VRAM 30 min; at most 1 load/min).

**States:** empty → "Ask about your projects, tasks, or this PC." + "Answers come only from the sources ticked above… If the answer isn't in them, the ORACLE says so instead of guessing." (+ warm-up note) + 4 prompts: "What should I actually work on today?", "What's the biggest risk in my projects right now?", "Which project has gone quiet, and does it matter?", "Explain my health score."; loading → pill "checking…" → "loading … into GPU memory…", Send disabled until available; streaming → "thinking…", live text, red Stop, Enter ignored; errors only in the footer (no per-message retry); offline → "The local model isn't running." / "Open the Ollama app — it is set to start at login — then retry." + Retry (textarea enabled, Send disabled); no chat model → "No local chat model installed." / "Run ollama pull qwen2.5:7b, then retry." + Retry; **past snapshot ignored** (context is always today's data; composer live); harness → "preview — no model bridge", "The ORACLE needs the live app." (no Retry), inputs disabled, today's chat still shown; day rollover → starts empty, yesterday discarded; leaving mid-answer keeps generating and re-attaches on return.

**Links:** rail #11 / palette "oracle". No outbound links (the persona names tabs, but answers can't navigate). Model output appears **only** here. Related: SYSTEM's AI runtime strip (same probe); drawer commit drafting (same model, Claude CLI fallback).

**Problems:** name collision with HOME's deterministic "do this now" card (internally `derive.oracle`, `.oracle-card`); hard to find; developer jargon in status/offline copy (runtime ids, quantized model tags, "GPU memory", `ollama pull`); weak source chips (ambiguous "Answer from", no freshness/scan date, Vault off by default and slowest); the trust signal ("grounded in…") is the weakest element and mixes provenance, errors and timing; dead-end answers; no per-message retry ("interrupted" after every scan reload); no history (one chat per day, wiped); time-machine mismatch; duplicate runtime status in SYSTEM; the Vault chip's tooltip hard-codes the owner's real primary-vault name (`oracle/view.js:24`): in a public repo, show the configured primary vault from data instead.

**Designer notes:** the trust contract matters most: make "grounded in X" and "(estimate)" readable and prominent; the honest refusal is a feature, not an error. Compact answer cards (≤120 words, 1–4 bullets). Must handle offline/no-model with Retry, warm-up up to ~1 min, streaming with Stop, interrupted. Non-negotiables: local-only, no model picker, no cloud toggle; model output stays on this surface; model text only through mdLite; all text escaped. Options: one system-wide AI status indicator shared with SYSTEM; chips → a compact "context" popover with defaults; seed suggested prompts from HOME's next action; clickable go-to-realm citations would need structured citations from main (new work); could live as a global command bar mode (§10). Voice: dry game-guide wit; keep UI chrome quiet so it doesn't compete.

### 4.12 TIMELINE — `chronicle`
*Files: `realms/chronicle/{manifest,view}.js`, `styles/realms/chronicle.css`.*

**Job:** "What happened, when: the story of my progress scan by scan, newest first." Rail #12, no digit.

**Layout today (one column ~880 px):**
1. **Header stat strip**: huge XP number (counts up on entry; animates only the delta when scrubbing) + "XP"; date range "Jun 5 – Oct 3 2026"; chips **Level** "L7" · **Scans** "38" · **Span** "120 days" · **Streak** "5d".
2. **Weekly recap card** (if one exists): tag "WEEKLY RECAP", week range, "✦ AI" badge when LLM-written; chips "+120 XP" (green/red) · "2 unlocked" · "4 quests" · "+3 HP" · "L6→L7" (each only when meaningful); "Spellcraft — N casts · N distinct · N fizzled · N known"; the **full** markdown narrative, always expanded.
3. "Timeline" heading.
4. **Vertical spine**, one node per scan (~38+), newest (selected) on top: rail dot (accent on top node); date line "Oct 3" large + year small + right "latest" or "Nd earlier" (relative to the selection, not today); **change rows** as cards with a green / red / grey left rail: UPPERCASE type label ("QUEST CLEARED", "PUSHED TO REMOTE", or raw fallback "UNCOMMITTED WORK"), bold project name, detail. A scan with no changes gets one derived line: "First scan — baseline recorded", "Reached level N", "N quests cleared", "N achievements unlocked", "+N XP earned", "Health ±N" or "Quiet scan — steady state". Milestone badges unlocked in that scan's window: gold pill, icon + name (hover = description).

**Data shown:** `a.xp`, `a.level`, `a.streak.scan_days`; `scans[0].scan.id` + `S.scan.id` for range and span; "Scans" = `selectedIndex + 1`. `bundle.weeklyRecap {week_start, week_end, ai_narrative, narrative_md (LLM when ai_narrative; est.), stats{xp_gain, achievements_unlocked, quests_completed, health_delta, level_start, level_end}, spellcraft{casts, distinct_spells, fizzled, spells_known_end}}`: a single bundle-level object (latest week). `scans[i].changes_since_prev[] {type, impact, project_id, detail}` for i ≤ selected, names from `S.projects`. Derived one-liners from `scans[i].account` vs the previous (`level`, `totals.quests_done_total`, `totals.achievements_unlocked`, `xp`, `health_index`). `S.achievements[]` with `unlocked_on` bucketed into (prevDate, thisDate] + the `ACH` catalog.

**Actions:** none (native tooltip on milestone badges only). Rows, nodes and dates aren't clickable; no filter, search, jump-to-date or collapse.

**States:** no scans → "No scans yet — run a scan to begin your chronicle." (the only one of MAP/HISTORY/TIMELINE with an empty message); no recap → card omitted; past snapshot → header recomputes and the spine truncates at the selection, but **the recap still shows the latest week** (HOME hides its recap off-live); harness identical.

**Links:** rail #12, palette ("GO TIMELINE", alias `chronicle`). Out: none (unlike HOME's change rows, project mentions don't open the drawer).

**Problems:** a very long, uniform scroll (the CSS notes "7 screens of near-uniform text was the core complaint"); no grouping, collapsing or paging; insight-type entries ("no remote backup", "uncommitted work", "twin") mixed with real events and given raw labels (only 9 types mapped); off-register vocabulary in the plain theme ("Quest cleared", "Spell learned", "Spellcraft · casts · fizzled", "HP"); recap time-inconsistent and a fully expanded wall of text; header duplicates the HUD; dead ends.

**Designer notes:** a scannable activity feed grouped by week (week header = mini recap: XP Δ, tasks done, unlocks); notable events emphasised (level-ups, unlocks, first pushes); quiet scans collapsed ("N quiet scans"); filters by project, type, impact; every project mention links to the project page. Options: merge with HISTORY; the recap becomes the week header (remove one of the two recap surfaces); drop header chips the HUD already shows. Non-negotiables: newest first; rewinds with the time machine, including the recap; milestones appear at their unlock moment; AI-written narrative visibly marked.

### 4.13 CANVAS — `conjure`
*Files: `realms/conjure/{manifest,view,widget}.js`, `styles/realms/conjure.css`; writers: MCP `hq_canvas_add` (`dashboard-v3/mcp/server.mjs`), main `hq:canvas-add`.*

**Job:** "What has Claude built for me while we chatted?" A live, newest-first feed of small widgets (stat tiles, checklists, mini charts) that Claude posts from a chat session. Rail #13, no digit, no badge.

**Layout today:**
1. Heading "CANVAS" + muted count "12 elements".
2. Teaching line "Live UI Claude builds while you chat — newest first."
3. Board pills, **only when more than one board exists**.
4. Responsive grid (auto-fill, ≥220 px) of widget cards: rounded, 3 px left rail tinted by tone, rise-in on appear. `table` widgets and any `wide:true` span the row. Otherwise the empty card.

**Data shown:**
- Board choice: last pick (this mount) → board "conjure" (Claude's default) → fullest board → first.
- Nodes: `board.nodes[]` reversed (append order → newest first). Kept: file and link nodes, and text nodes that parse as a widget spec (a ```hq fenced JSON block, or bare JSON with a string `type`). **Plain text notes are hidden** (incl. notes from ASSISTANT's ＋ Note).
- **Widget catalog** (all LLM-authored, (est.)-grade content, display-only; strings escaped, bodies via `mdLite`):

  | Type | Spec | Renders |
  |---|---|---|
  | `stat` | `{label, value, unit?, delta?, tone?}` | big number (thousands separators), small unit, uppercase label, delta "▲ 2" green / "▼ 2" red / raw text |
  | `progress` | `{label?, value 0–100, tone?}` | title + "64%" + 10 px bar |
  | `checklist` | `{title?, items:[{text, done} / "[x] text" / "text"]}` | tick list (done filled + struck) + "3/5 DONE"; **not clickable** |
  | `callout` | `{title?, body(md), tone?}` | tinted panel |
  | `table` | `{title?, columns?, rows:[[…] / {…}]}` | full-width table, uppercase headers, mono cells, horizontal scroll |
  | `chips` | `{title?, items:[{text, tone?} / "text"]}` | pills (toned pills tinted) |
  | `spark` | `{label?, value?, points:[n…], tone?}` | header + 240×44 line + area + end dot; <2 points → "not enough points" |
  | `bars` | `{label?, data:[{label, value} / n…], tone?}` | 108 px column chart, value above, label below; hover values via `title`; empty → "no data" |
  | `note` | `{title?, body(md)}` | titled markdown |
  | file / link node | — | "📄 basename" / "🔗 url" chips, **not clickable** |
  | unknown type / crash | — | fallback note with raw text (fences included) / pretty JSON |

- Tones: good/success green; warn/warning orange; danger/bad red; info/note blue; neutral/missing theme accent.
- Not shown: time, author, source. App/MCP node ids are `n-` + base36 ms timestamp + 4 random chars, so "added 3m ago" can be decoded with no contract change (Obsidian-authored ids won't decode).

**Actions:** board pill (only with >1 board). Widgets can't be added, removed, reordered, pinned, cleared or clicked here. Writes come only from Claude via MCP `hq_canvas_add(name, text, x?, y?)`: append-only, ≤2000 chars, creates the board if missing; file watcher → `hq:canvas` → re-render; the file grows forever.

**States:** empty → dashed card "✦ Nothing conjured yet", explanatory copy, a literal MCP call sample (`hq_canvas_add(name:"conjure", text: ```hq { "type":"stat", … }```)`) and the type vocabulary: **developer documentation shown to the end user**; no loading (baked snapshot first, then live); bad nodes skipped silently, unparseable boards dropped by main; harness → frozen baked snapshot with **no "not live" indicator**; past snapshot → re-renders but nothing changes (feed not tied to scans; correct but unexplained).

**Links:** rail #13 / palette "CANVAS" (alias `conjure`). No badge, so widgets arriving while the user is elsewhere go unseen. The same files render as ASSISTANT's whiteboard. Producer: a Claude Code chat outside the app through the `workspacehq` MCP server.

**Problems:** Claude writes, the user can only read (no dismiss, delete, pin, clear, reorder; old tiles pile up forever); no context (time, which chat, grouping); jargon empty state; silent filtering (plain notes hidden, unknown types as raw JSON, count excludes both); **four things share one name** (this rail item; ASSISTANT's "Canvas · N boards"; "conjure:" session rows from the separate Ctrl+Alt+G shard system; the board named "conjure"); no arrival signal, 13th in the rail; widgets look interactive but aren't; hard-coded neon breaks DAYLIGHT (`#3aff6e` / `#ff4757` deltas, `#0c0a1e` tick, `COL` tone hexes); board picker hidden with one board; stale snapshot looks like live data.

**Designer notes:** a beautiful, glanceable gallery of Claude's "live answers". Treat the widget set as a **component kit** designed in dark and light: 9 types × 5 tones × normal/wide, plus file/link chip, fallback note, empty and "not enough data" states. Options: one CANVAS surface with two views, **Feed** (widgets, newest first) and **Board** (the spatial JSON Canvas with specs rendered as widgets, zoom, fit-to-content); remove the board from ASSISTANT. Cheap wins with no backend change: "added 3m ago" from node ids; always-visible board picker; arrival badge (renderer-side count of new ids); "snapshot, not live" indicator without `window.hq`; friendly empty state with MCP syntax behind a "for developers" disclosure. Not wired (new main IPC in a NEW file + MCP mirror): delete/dismiss, pin, clear board, create board, move/resize nodes, interactive checklists. Non-negotiables: display-only safe rendering (a spec never becomes raw HTML or runs code); local chart code only; files stay Obsidian-compatible JSON Canvas; "conjure" stays the default board; tokenized colours; keep it name-separated from the Ctrl+Alt+G desktop "shards" (a different system).

### 4.14 SOCIAL — `social`
*Files: `realms/social/{manifest,view}.js`, `styles/realms/social.css`; main `hq:social-read` → `dashboard/browser-bridge.js readSocial()`, `dashboard/social-bridge.js`.*

**Job:** "What's happening on my social accounts (feed, mentions, follower counts), and which posts has Claude staged or sent for me?" **Read-only by design.** Rail #14, no digit, no badge.

**Context:** the browser extension scrapes the user's already-logged-in social tabs every 5 min (or on demand with Sync in its popup) and posts results to the app's localhost bridge (127.0.0.1:47821). Stored in `data/social/inbox.json` (7-day window, ≤4000 events), `outbox.json`, `accounts.json`. Claude (MCP `hq_social_post` / `hq_social_reply`) can only **stage** posts; a human publishes them from the extension popup (§5.17). This realm cannot publish, approve, cancel, reply or open anything.

**Platforms (9), glyphs and support:**

| Platform | Glyph | Feed | Mentions / notifications | Metrics | Posting |
|---|---|---|---|---|---|
| Bluesky | 🦋 | ✓ | ✓ | ✓ | works |
| Mastodon | 🐘 | ✓ | ✓ | ✓ | works |
| Reddit | 🤖 | ✓ | inbox | karma | works |
| X | ✕ | ✓ | — | ✓ | best-effort |
| LinkedIn | in | — | ✓ | — | posts only |
| Instagram | 📸 | — | ✓ | ✓ | refuses |
| Threads | @ | — | — | ✓ | fails (needs config) |
| Facebook | f | — | — | — | account only; fails |
| YouTube | ▶ | — | ✓ | — | refuses |

Unknown platform → ◆.

**Layout today:**
1. Header h2 "SOCIAL" (hard-coded; ignores the lexicon) + REFRESH.
2. Accounts shelf: pills "🦋 @handle-a".
3. Metrics tiles (auto-fill ≥150 px): glyph + name, big follower number, "followers · N posts".
4. Tabs: Feed | Mentions | Outbox (N staged).
5. Platform filter chips (All + one per platform present; Feed/Mentions only; only with 2+ platforms).
6. List (max measure): feed/mention cards (≤100, newest first) or outbox rows.

**Data shown:**
- `accounts.accounts[] {platform, handle, display, connected_at}` → pills (`display`, `connected_at` unused).
- Latest `inbox.events[]` with `kind==='metrics'` per platform → tile `metrics.followers`, `metrics.posts`. For Reddit, "followers" is actually total karma and "posts" is link karma (**mislabelled**). `following/likes/impressions` and 7 days of hourly snapshots captured, no trend shown.
- `kind==='feed'` → card: glyph + name, `author` ("@user-a" / "u/user-a"), relative `ts` ("5m", "3h", "2d"), `text` (pre-wrap, ≤2000), `counts` "♥ 12 · ↻ 3 · 💬 4" (**frozen at first capture**), `url` as hover only.
- `kind==='mention'|'notification'` → Mentions; notifications include likes/follows/reposts (a Bluesky like's text is just "like"); these always show "♥ 0 · ↻ 0 · 💬 0".
- `outbox.actions[]` (newest `staged_at` first) → row: platform, `op` ("post"/"reply") + "· r/<target>" when `target` set (prefix added for any platform), status pill `staged` amber / `sent` green / `failed` red / `canceled` unstyled, `title` (bold), `text`, staged hint "Awaiting your Approve & Send in the extension popup.", `error` in red mono. Not shown: `staged_at`, `sent_at`, `result.url`, `reply_to`, `by` ("mcp").
- `inbox.updated` (last sync) shown nowhere.

**Actions:** REFRESH (re-reads sidecars; "…" meanwhile; no writes, no network) · tabs · platform chip. Cards and outbox rows are display only (no external-open IPC by design). Auto 60 s poll while mounted.

**States:** loading "Loading social…"; **one note for four situations** (empty, extension not installed, read error, localhost bridge down / port busy, plus the harness): "No social data yet. Load the WorkspaceHQ Bridge extension (browser-bridge/), open your logged-in social tabs, and hit Sync in the popup — then REFRESH here. Claude reads/stages via the hq_social_* tools; sending is approved in the popup." Per tab: "No feed items captured yet — hit Sync in the extension popup." / "No mentions captured yet." / "No staged or sent posts. Ask Claude to stage one (hq_social_post), then approve it in the extension popup."; stale data looks identical to fresh; time machine ignored (sidecars always live); **unstyled in DAYLIGHT** (CSS scoped to `:root[data-theme="nexus"]`, no daylight rules). The owner has no social data yet.

**Links:** rail #14 (sigil 📡) / palette. No outbound links. Publishing only in the popup; staging only from Claude. Related: SCREEN TIME counts social sites as distraction.

**Problems:** hidden approval queue (no badge, nothing on HOME; approve lives in another app); one jargon message for four situations; no freshness; noisy Mentions; dead-end cards (can't open, draft a reply, copy); wrong or stale numbers; weak outbox audit trail; theme and label bugs; 100-item cap with no "more" or search; `docs/sync/CONTRACT.md` wrongly says the renderer doesn't consume the social sidecars.

**Designer notes:** most valuable: (1) the approval queue (how many waiting, what they say) and (2) mentions that need a response; reading the feed is secondary. **Non-negotiable write gate:** nothing moves from staged to sent except a human click in the extension popup; there is no in-app or MCP approve path. An in-app "Approve & Send" is a CONTRACT.md security-review change, and the send must still run inside the logged-in tab via the extension. "Cancel staged" exists only as MCP `hq_social_cancel` (would need a new IPC). Options: a HOME widget ("2 posts awaiting approval · 5 new mentions") drilling into a slimmer realm; v4 folded SOCIAL into SYSTEM. Design for per-platform capability gaps, stale data and an explicit "last synced". Post text is third-party content: text only.

### 4.15 STUDIO — `studio`
*Files: `realms/studio/{manifest,view}.js`, `styles/realms/studio.css`; engine `dashboard/screen-capture.js` (§5.10).*

**Job:** "Where are my screenshots and screen recordings, and how do I take a new one?" Rail #15 (last), label literally "STUDIO" in every register, no digit, no badge.

**Layout today (centred, max 1240 px, fades in):**
1. Top bar: **SNIP** (scissors icon) · **RECORD** (record icon, gold text) · small **REFRESH** right.
2. Status line while loading or empty.
3. "Screenshots" + count → grid (≥220 px columns, 16:9 thumbnails) or "No screenshots yet."
4. "Recordings" + count → same grid or "No recordings yet."
5. "Recovered" + count (only if any) with red-bordered note "These files were restored from a recording that ended abnormally. The last cluster may be short." **Same tiles appear again here** (already under Recordings).
6. **Preview modal** on tile click: header filename + "Close ×"; full image or `<video controls>`; dark backdrop.

Tile: thumbnail (cover 16:9; recordings show a large play glyph instead); kind chip "PNG" / "WEBM" top-left; red "RECOVERED" badge + red border when recovered; monospace filename ("2026-01-01-120000.png", truncated); subline "2026-01-01 12:00 · 1.2 MB"; buttons REVEAL · RENAME · DELETE.

**Data shown:** `studio.libraryList({kind:'all', limit:500})` rows `{kind: shot/rec, recovered, path, name, size, mtimeMs, thumbDataUrl}` (newest first). That is all a row has: **no duration, dimensions, title, tags, source or project link**. Thumbnail = base64 JPEG for overlay snips; quick snaps fall back to the full-res PNG via `file://`; recordings never get a poster. Name = timestamp slug (repeats the date). Sizes "0 B / 12.3 KB / 4.5 MB / 1.2 GB". Scan data unused.

**Actions:**

| Control | Does | Side effects |
|---|---|---|
| SNIP | Region snip on all displays | overlays; on save PNG + thumbnail + clipboard; grid reloads (the HQ window is in the frozen image) |
| RECORD | **Shows/hides the record panel. Does not record.** | separate always-on-top window; tooltip wrongly says "Ctrl+Alt+R starts a recording directly" |
| REFRESH | Re-list the folder | reads every thumbnail as base64; full redraw |
| Tile click | Preview modal | — |
| REVEAL | Show in Explorer | main refuses paths outside the library root |
| RENAME | **Always disabled** ("Not available yet — rename an on-disk file in Explorer") | no IPC exists |
| DELETE | Native `window.confirm("Move to Trash?\n\n<name>")`, then file + thumbnail to the Recycle Bin | recoverable; tile removed at once; failure only in the button tooltip ("Not moved — …") |
| Close × / Esc / backdrop | Close preview, stop video | — |

Auto: reload on every new capture (`studio:capture-added`) and a 30 s poll (full redraw each time).

**States:** loading "Loading Studio library…"; empty "No captures yet. Press Ctrl+Alt+S to snip, or Ctrl+Alt+R to record." (the record part is false) + per-section empties; **load errors show the same empty state** (console only); delete errors only as tooltip; time machine ignored (always the live folder; delete still works); harness → SNIP/RECORD disabled "Needs the live app — the Studio bridge is unavailable in this preview", page "Studio bridge unavailable in this preview. In the live app, press Ctrl+Alt+S to snip, or Ctrl+Alt+R to record.", REFRESH clickable but useless; busy → SNIP/RECORD disabled 250 ms, DELETE "…"; follows NEXUS/DAYLIGHT tokens.

**Links:** in from rail / palette ("studio"); Ctrl+Alt+L is meant to open it but is dead; no tray entry; no realm links here. Out: Explorer, record panel, snip overlay. No links to projects or notes.

**Problems:** RECORD doesn't record; **recordings may be empty files** (check live: §5.9); dead RENAME on every tile; recovered files listed twice; identical recording tiles (no poster or duration); filename and subline repeat the timestamp; no filter, sort, search, day grouping, multi-select, storage total, folder path, "open folder", copy image, open in default app or drag-out; preview is a dead end (no prev/next, actions or metadata); load errors look empty; native confirm breaks the style; full rebuild every 30 s and after each capture (flicker, lost hover/focus); all 500 tiles at once with base64 thumbnails in the IPC payload; no recording-in-progress indicator (doesn't listen to `recStatus`); no confirmation after a snip; no capture settings UI anywhere.

**Designer notes:** matters most: (1) capture buttons whose labels match what they do ("Snip region", "Snip full screen", "Open recorder" / "Start recording"); (2) a "latest capture" hero with Copy, Reveal, Delete; (3) a fast newest-first gallery where screenshots and videos are clearly different. Options: one gallery with filter chips (All / Screenshots / Recordings / Recovered) and day headers (Recovered = badge + filter); drop REFRESH; hide RENAME until a rename IPC exists (main-side ask); tile actions on hover/overflow and in a lightbox preview with prev/next; a "Capture settings" sheet (UI only, `settingsGet/Set` exist; the panel must be wired to honour them); an optional global "Recording 00:42" pill driven by `recStatus` (the main window may itself be in the recording). Non-negotiables: delete goes to the Recycle Bin and asks first; RECOVERED warning stays visible; renders with no scan data and in the harness; design only name, date, size and optional thumbnail per item (no duration/dimensions/titles without a main-side ask); file names are untrusted text.

---

## 5. Outside the main window

**How these pieces fit.** One Electron main process (`dashboard/main.js`) owns everything outside the window; it is the only thing that runs commands, writes files and opens windows. It opens **7 kinds of window**: main window, mini HUD, summon palette, desktop shards (7 widget types), quick-run palette, snip overlay (one per monitor), record panel. Tray and native dialogs/toasts are OS chrome. Two things run **outside Electron** and talk to it through files or localhost: the **browser extension** (`browser-bridge/`, posts to 127.0.0.1:47821) and the **MCP server** (`dashboard-v3/mcp/server.mjs`, stdio; reads/writes `data/` directly, works with the app closed).

**The biggest constraint on the redesign:** the main window fully reloads after a scan, a quest completion from anywhere (Obsidian ticks and shards included), a capture, "I learned", archive/revive, a commit, an automation-catalog rescan, Ctrl+Shift+R, and any time `data/latest.json` changes on disk. Every screen must be reload-safe.

**None of the satellite windows follow the app theme today.** Each is its own frameless or transparent HTML with inline styles (hard-coded neon/mono). If they should match, they are in scope for the design.

### 5.1 Main window (launch, menu, close-to-tray) — `createWindow`
*Files: `dashboard/main.js`, `dashboard/Launch WorkspaceHQ.vbs`, `dashboard/launch-hidden.vbs`.*

**Job:** Is WorkspaceHQ running, and how do I get to it?
**Layout today:** native Windows frame and title bar "WorkspaceHQ" (during a manual scan: "WorkspaceHQ — scanning…", **the only scan-progress indicator in the app**); native menu with one menu **WorkspaceHQ**: Scan now (Ctrl+R) · Refresh (Ctrl+Shift+R) · — · Toggle Developer Tools · Quit; content = `dashboard-v3/index.html`, chosen at launch from `data/.ui-version` (`v3` current; `v4` → `dashboard-v4`; else legacy v2). Window 1180×820, background `#0d1117`, resizable, **no min size set**, bounds not remembered.
**Actions:** close (X) hides to tray · Scan now / Ctrl+R (full scan with enrich, Claude quota, up to 8 min; reload; error box) · Refresh / Ctrl+Shift+R · DevTools · Quit (saves shard positions; kills runs, dev servers, Claude jobs; closes bridge and watchers) · second launch focuses the existing window · `Launch WorkspaceHQ.vbs` (visible) · Startup-folder `launch-hidden.vbs` (`--hidden`: tray + mini HUD only).
**States:** hidden start; cold start builds the data bundle synchronously before the window paints (a delay); auto-start relies on the Startup-folder script (the app is not packaged). Dev arg `--summon="timer 5"` spawns a shard on launch.
**Problems:** Ctrl+R = Scan now (browser habit starts a 20 s–8 min Claude-backed pipeline); a manual scan can reload **twice** (watcher + close handler); scan progress only in the title bar; bounds not remembered; no global show/hide hotkey; native menu bar mismatches the custom chrome.
**Designer notes:** keep close-to-tray, single instance, clean quit. If you go frameless, the custom title bar must carry scan state. Consider a global "show HQ" hotkey and a visible scan-state component.

### 5.2 Tray (icon, tooltip, menu) — `buildTrayMenu` / `updateTray` / `createTray`
**Job:** Status at a glance; run things without opening the app.
**Layout today:** static icon (no badge or state) · tooltip "WorkspaceHQ — L7 Title · health 62 · 12 open" · left-click shows/focuses the window · right-click menu: Show WorkspaceHQ · Toggle mini HUD · Summon widget (Ctrl+Alt+G) · Cast a spell… (Ctrl+Alt+X) · Scan now · **Cast ▸** (if any castable: up to 3 "icon Name" · — · Open Spellbook) · — · "Quick actions" (greyed header) then only what applies: Push all unpushed (N) · Snapshot all dirty (N) · Kill all dev servers (N) · Open most-urgent: Project A · — · Quit.
**Data shown:** `account.level`, `title`, `health_index` (est.), `totals.open_quests`; counts of projects with `git_safety.unpushed`, with `dirty > 0`; running dev servers (**stale**: menu rebuilt only after scan, quest-done or HUD toggle); `daily_top3[0].project_id` name; top 3 automations = favorites → most recently run → Built-ins (Runnable + Interactive only).
**Actions:** see §7 "Tray" (13 controls). Bulk push and snapshot confirm via native dialogs; kill-all doesn't. "Push all unpushed" ends with a full scan **with enrich** (Claude quota), which the menu label doesn't say.
**States:** no scan → tooltip "WorkspaceHQ", no Quick actions; no automations → no Cast submenu; always latest (ignores the time machine).
**Problems:** "Open Spellbook" only shows the window (old name, no navigation); stale dev-server count; "Open most-urgent" opens Explorer, not the project in-app; bulk push reports "k/N" with no failure list; health tooltip is (est.); no screenshot/recording entries; icon never changes state (scanning, recording, critical).
**Designer notes:** the one always-present surface. Keep it short: status line, Show, Scan, HUD toggle, icon states for scanning/recording. Bulk git/snapshot keep their confirm. Decide whether automations belong here (four entry points today).

### 5.3 Mini HUD — `mini` window
*Files: `dashboard/mini.html`; `main.js`.*

**Job:** While I'm in another app: how am I doing, and what's the one thing to do next?
**Window:** 286×196, frameless, transparent, bottom-right of the primary display (16 px margin), always on top (also over fullscreen apps, on every virtual desktop), not in the taskbar; drag anywhere; not resizable; position **not** saved; visibility saved in `data/.hud-state.json` (currently off).
**Layout today:** row 1 "LV" + level (gold) · XP bar "340 XP to L8" (or "MAX LEVEL") · ×. Row 2 "HP" bar + number (green ≥70, orange 40–69, red <40) · 🔥 streak. Row 3 top-quest card: tier chip RED / ORANGE / YELLOW · title (ellipsis) · "+40". Row 4 (if any): up to 3 automation buttons "icon Name". Row 5: CPU bar + % · RAM bar + % (orange-red >85%) · "■ 2" kill-dev-servers (only when servers run). 8–10 px text.
**Data shown:** `account.level`, XP % and `xp_to_next`; `health_index` (est.); `streak.scan_days` (scanner days); top quest = open/in-progress sorted tier → xp → age; top 3 automations (tray rule); machine sample every 2.5 s. Sent but not shown: `title`, `xp`, `open_quests`, `red_quests`.
**Actions:** drag · × (hides persistently; only the tray brings it back) · quest card (shows the main window, not the quest) · automation buttons (run with notify; icon spins; ✨/💥 for 4 s; if confirm needed, opens the main window **without** the confirm) · ■ N (kill all, no confirm).
**States:** "Loading…" · "No scan data — run a scan" · "All quests clear ✓" · no automations → row hidden · always latest.
**Problems:** quest click lands wherever you were; no Done here (the quest shard has one); confirm dead-end; leads with the two values the audit flagged as estimate/vanity (HP, streak); kill-all without confirm or list; tiny fixed text; position resets; duplicates the vitals shard and tray tooltip.
**Designer notes:** the ambient companion; one job: a glanceable next action, measured values only. Candidate merge: HUD + vitals shard + tray tooltip = one "ambient status" design. Keep always-on-top, draggable, dismissible.

### 5.4 Summon palette — `summon` window
*Files: `dashboard/organic/summon.html`, `summon-preload.js`; `main.js`.*

**Job:** Put a small tool on my desktop, right here, right now.
**Window:** 470×104, frameless, just below the cursor, always on top, closes on blur; reduced bridge (summon or cancel only).
**Layout today:** magenta 9 px label "✨ summon UI here · note … / timer 25 / quest / hp — or describe ANY widget and Claude conjures it" + one input "e.g. water tracker with a +1 glass button".
**Grammar (only visible in that label):**

| You type | You get |
|---|---|
| `note buy milk` / `n: buy milk` | Note shard (saved) |
| `timer 25` / `25m` / `25 min` | Timer shard 1–180 min (not saved) |
| `quest` / `quests` | Top-quest shard (nothing if no open quest) |
| `hp` / `stats` / `hud` | Vitals shard (nothing if no scan) |
| `lib` / `library` | Library shard |
| a saved creation's name (exact or unique prefix) | That creation re-spawns instantly |
| anything else | **Conjure**: Claude CLI writes a widget (Claude quota, 120 s timeout) |

**Actions:** Enter (summon at the remembered cursor point; palette closes) · Esc / click away (close).
**States:** no loading state (conjure shows its own placeholder shard); **silent failure** for `quest`/`hp` with no data; Claude CLI missing → conjure shard shows an error.
**Links:** in from Ctrl+Alt+G and tray. Out: a shard at the cursor; conjure jobs appear briefly in ASSISTANT as "conjure: <prompt>".
**Problems:** hidden grammar; no failure feedback; no quota warning for free text; no suggestions/autocomplete; placement only at cursor.
**Designer notes:** Spotlight/Raycast pattern: list built-ins and saved creations as you type; clearly mark the row that will "ask Claude"; inline errors instead of silent close.

### 5.5 Shards (desktop widgets) — `shard` windows
*Files: `dashboard/organic/shard.html`, `shard-preload.js`; `main.js`.*

**Job:** Small persistent tools floating on the desktop outside the app.
**Common frame:** frameless, transparent, always on top (over fullscreen, every desktop), not resizable, not in the taskbar; spawns at the summon point within the screen; header strip = drag handle with coloured kind label, optional subtitle, ↻ (conjured only), ✕; 0.28 s "sprout" pop-in. Reduced bridge: close, save, regen, library, mark quest done, show main window; nothing else. Persisted across restarts: note and finished conjured shards (`data/shards.json`); timer, quest, vitals and library shards vanish on restart. Default sizes: note 260×200 · timer 220×130 · quest 340×158 · vitals 260×104 · XP drip 250×80 · conjured 360×300 · library 380×300. **Effectively unused today** (0 saved shards, no library file).

| Widget | Look | Data |
|---|---|---|
| NOTE (gold) | full-bleed 14 px mono textarea, autosave 0.5 s | `payload.text` |
| TIMER (cyan) | "24:59" (40 px), PAUSE/GO · RESET; at 00:00 flashes + 3-tone beep in the shard (no OS notification) | `payload.minutes` |
| QUEST (red) | title · "↳ Project A · +40 XP · red" · ✓ DONE · OPEN HQ | top quest (HUD rule) |
| VITALS (green) | "LV 7 [XP bar] 64%" · "HP 62 [bar] 🔥3"; a snapshot that never updates | HUD payload (HP, streak est./vanity) |
| XP DRIP (no chrome) | gold "✨ +~120 XP · 2 quests cleared" rises and fades over 6 s; click-through; spawns bottom-right after any quest completion | **(est.)** hard-coded 60 per quest until the next scan |
| CONJURED (magenta) | subtitle = first 34 chars of the prompt; conjuring (spinner orb + "conjuring widget… Claude is writing it for you") / error ("✖ generation returned nothing usable", "claude CLI not found on PATH") / ready (Claude-written HTML/JS, sandboxed, no network) | `payload.prompt/status/html` |
| LIBRARY (purple) | rows "prompt · 2026-09-30 · ▶ · ✕", newest first; empty: "No creations yet. Summon anything (Ctrl+Alt+G) and it lands here — then re-summon it instantly by typing its name." | `data/shard-library.json` |

**Actions:** see §7 "Shards" (10 controls).
**Problems:** no shard manager (can't list, hide or close all; they float over fullscreen video and games); closing a note deletes it permanently; quest and vitals shards are stale snapshots; timer lost on restart and silent if muted; nothing resizable; library delete without confirm; conjure/regen spend quota without warning; XP drip shows an invented number; a second notes system not connected to NOTES or the vault.
**Designer notes:** decide whether shards are a pillar or a cut. If kept: one widget frame for every type; an in-app "Desktop widgets" manager (list, recall, hide all, restore); live-updating data shards; undo/archive for notes. Non-negotiable: conjured HTML keeps no network access and the reduced bridge. Keep the name distinct from CANVAS.

### 5.6 Quick-run palette — `cast` window (Ctrl+Alt+X)
*Files: `dashboard/cast.html`; `main.js openCastPalette`.*

**Job:** Run one of my automations in two keystrokes from anywhere.
**Window:** 580×442, frameless, transparent, centred horizontally ~18% from the top of the primary display, always on top, no taskbar entry, closes on blur; full bridge; own hard-coded neon palette and monospace font.
**Layout today:** label "⚡ quick cast" + hint "↑↓ choose · Enter cast · Esc close" → input "spell name… (empty = favorites & recent)" → up to **12** rows (left border by category (8 colours), icon, name coloured by rarity (rare blue / epic purple / legendary gold), usage pips ● to ●●●●● (distinct days ≥1/5/15/40/100), meta "⚡" if it opens a terminal + "5m / 3h / 2d" since last run, or the rarity word) → "no matching spells" → inline confirm (black, gold border): "first cast — it will run exactly:" or "⚠ spell changed since last approval — it will run exactly:", the command (green), "Enter again = cast it · Esc = back".
**Data shown:** `hq.getSpellbook()` (live) filtered to valid Runnable / Interactive / Chain; `hq.getSpellTelemetry()` → favorites, `last_cast`, `lifetime_casts`, `distinct_days` (count). Empty query = favorites → recent → Built-ins. Ranking: name starts-with > contains > id/category contains (descriptions not searched).
**Actions:** type / ↑ / ↓ · Enter or **row click (runs immediately)** · Enter again on the inline confirm · Esc / blur.
**States:** blank list until both reads finish; after a run the palette closes at once and the result arrives only as an OS toast (+ the main window's Run log); **errors swallowed** ("already casting", "no spellbook" just close it); always-ask items described as "first cast"; chains show an empty command; favorites can't be set anywhere, so the empty state is effectively recent + built-ins.
**Problems:** different visual language and RPG copy; no progress/output after a run; one click runs; blur loses a pending confirm; 12-row cap; no description search; 9 px labels; jargon (spell, school, rarity, pips, channeled, chain).
**Designer notes:** the app's command bar in "run" mode, same tokens and theme; show kind (background vs terminal), last result, favorites with a pin action; the inline confirm shows full command + folder; errors stay on screen; consider a run-status chip that links to the runs panel. Non-negotiable: exact-command confirm before a first, changed or always-ask run; the renderer passes only an id.

### 5.7 Casting engine — `hq:spell-cast` contract
*Files: `dashboard/main.js` (~952–1364); bridge `dashboard/preload.js`; channels in `docs/sync/IPC-CONTRACT.md`. Not a screen.*

**Job:** Run only whitelisted things, show the exact command before first use, stream output, record the result.

**Decision flow of `hq:spell-cast(spellId, confirmedHash, opts)`:**
1. Load `data/spellbook.json` → `"no spellbook — run the scanner first"` if missing.
2. Find the id → `"unknown spell"`; invalid → `"spell is invalid (broken chain refs?)"`; plugin → `"tomes are lore, not incantations"`.
3. `known` = stored approval hash equals the item's current `content_hash`.
4. Always-ask **or** not known, and the caller didn't pass that exact hash → return `{confirm_required:true, preview:{id, name, icon, content_hash, command, args, cwd, kind, always_confirm, changed}}`. Nothing runs.
5. First approval of a non-always-ask item → save the hash (won't ask again until the file changes).
6. Interactive → open a terminal (Windows Terminal tab in the folder, else cmd), record `channeled`, return `{channeled:true}`.
7. Chain → run members in order (each a valid Runnable), stop on first failure → `{castId, chain:true}`.
8. Runnable → spawn with no shell, hidden window, in `cwd` → `{castId}`; same id while running → `{error:'already casting'}`.
9. Timeout = `timeout_min` (default 10; Built-ins 2–25) → kill tree → fizzled (timeout).
10. Finish → write telemetry, push `hq:cast-done`; OS notification if the caller asked (`opts.notify`: palette, mini HUD) or the main window is hidden.
11. Quitting kills every live run.

**Outcomes:** resolved / fizzled (non-zero exit, error, timeout, cancel) / channeled. Extra errors: `"spawn failed: …"`, `"chain has unresolvable members"`. One live run per id. XP settles only at the next scan.
**Entry points (5):** AUTOMATIONS realm (card, drawer, DEEP SCAN), HOME suggested ribbon, quick-run palette, tray Cast submenu (runs only already-approved non-always-ask non-chain items; otherwise just shows the window), mini HUD buttons (needs confirm → opens the main window, no confirm shown). `dispatch('cast')` ignores `confirm_required`.
**Problems:** tray/HUD confirm path dead-ends; every user-facing string is RPG copy outside the lexicon ("✨ Name resolved · 4s", "The spell took hold.", "💥 Name fizzled (exit 1)", "Open WorkspaceHQ → Spellbook…", "⛓️ … broke at link 2/3"); no favorite setter; stored "approved" state never shown.
**Designer notes:** design **one** confirm pattern and **one** runs panel for all entry points. When a quick surface can't confirm, deep-link to the item with its confirm open. Keep: id-only whitelist, exact-command preview, cancel, timeout.

### 5.8 Snip overlay — `snip-overlay` windows
*Files: `dashboard/snip-overlay.html` (inline script); `screen-capture.js snipArm()`.*

**Job:** Select part of my screen as an image, then get out of the way.
**Window:** one frameless, transparent, full-screen window per display, above everything (screen-saver level), hidden from screen capture, showing that display frozen at native resolution.
**Layout today (back → front):** frozen desktop (solid near-black until it arrives) → 55% black scrim → while dragging, a bright cut-out with a 1 px cyan frame, glow and corner ticks → "W × H" chip near the cursor (logical pixels; the saved file is larger on scaled displays) → HUD top-left, always visible: "DISPLAY 1 · REGION" / "DRAG select · SPACE full · ENTER commit · ESC cancel" → 55% white flash on capture.
**Data shown:** frozen `pngDataUrl`, display index (or shortened id), mode (REGION / FULL / WINDOW), live rectangle.
**Actions:** drag + release (**saves immediately**) · click without dragging (<3 px) **cancels** · Space = whole display · Enter = selection or whole display · Esc = cancel · right-click blocked.
**States:** arming (dark, HUD "DISPLAY <id>"); frozen idle (crosshair); dragging; full mode (auto-saves; code exists, nothing triggers it); after saving: flash, windows close, **nothing confirms the save**; freeze failure → no overlay, no message; multi-display: keyboard to the focused one, saving on any closes all; hard-coded cyan/gold/pink.
**Links:** in from Ctrl+Alt+S and STUDIO SNIP. Result → top of STUDIO and the clipboard.
**Problems:** release saves (no adjust, move, confirm or redo); click cancels (many tools capture the window under the cursor); no window mode in practice; no post-capture actions or toast (a code comment refers to a "toast from main" that doesn't exist); logical-pixel size chip; no magnifier; HUD can cover the target area.
**Designer notes:** instant and minimal: crisp selection, readable size, obvious Esc. Opportunity: after release, a small action bar at the selection (Copy · Save · Open in Studio · Redo); needs main to split "select" from "save". Non-negotiables: one window per display, full-bleed, no chrome; hidden from capture; Esc always cancels; the frozen image matches exactly what is saved.

### 5.9 Record panel — `record-panel` window
*Files: `dashboard/record-panel.{html,js,css}`; `screen-capture.js makePanel()`.*

**Job:** Choose what to record (screen or window, mic, system audio), then start and stop without the controls appearing in the video.
**Window:** 340×180, frameless, not resizable, always on top, not in the taskbar, **hidden from screen capture** (`setContentProtection(true)`), position remembered, dragged by its header; created non-transparent with no background colour while CSS rounds the card 12 px, so corners **likely** render as white squares (check on first run). Title "WorkspaceHQ Studio"; page title "Record".
**Layout today:**
1. Header (drag): status dot (grey idle, pulsing red recording) · "STUDIO / RECORD" · timer "00:00" (mm:ss, hh:mm:ss after an hour; red while recording).
2. "SOURCE": scrolling 3-column grid of tiles (16:9 snapshot taken at list time or "no preview"; kind tag "SCREEN" cyan / "WINDOW" pink; name "Screen 1" / "Window — Editor"; gold star on the primary display; selected = cyan glow). Empty: dashed "No sources available."
3. Chips: [ ] Mic · [ ] System audio.
4. Big red button: white dot + "RECORD" → dark with pulsing dot "STOP" → "SAVING…"; greyed when disabled.
5. Footer: one-line status (truncated) · REVEAL (after a save) · faint RESCAN.

Content needs ~220 px of height in a 180 px window (static estimate), so the grid is squeezed and the footer may clip.
**Data shown:** `recSources()` → `[{sourceId, displayId, label, primary, kind, thumbnail (320×180), width, height}]` (screens get tooltips "Screen 1 — 2560×1440"); default = primary screen → any screen → first source; local timer (4 Hz); status "● 01:23 · 45.6 MB" (~1 Hz; **the panel counts bytes itself** and ignores main's count); after save "Saved 2026-01-01-120500.webm".
**Actions:** source tile (click/Enter/Space; locked while recording) · Mic · System audio · RECORD · STOP · REVEAL · RESCAN · drag header. Internal: abort deletes the `.part` on start failure. **No close, minimize, collapse or "open Studio" control.** Closing the panel while recording stops and saves.
**States:** bridge missing "Bridge unavailable — reload the app" (all disabled with reasons) · "Scanning sources…" · "3 sources — ready" (RECORD needs a source: "Pick a source first") · "No sources available." · "Starting recorder…" · recording (red dot + timer, STOP, chips/RESCAN disabled, "● Recording" or "● Recording (codec fallback: video/webm;codecs=vp8,opus)") · warnings (pink): "System audio unavailable — recording without it", "Mic unavailable — recording without it", "Paused (backpressure)…", "Auto-split — recording continues in a new file", "Chunk drop: …", "Aborted <file>" · "Stopping…" / "SAVING…" · saved (gold) "Saved <file>.webm" + REVEAL · errors (red): "Capture failed: …", "recStart failed: …", "Recorder rejected start", "MediaRecorder init failed: …", "start() failed: …", "No supported WebM codec on this Chromium build", "Stopped — low disk space", "Recorder error (main)", "Save failed: …", "Failed to list sources: …" · stopped by hotkey → "Saved <file>" or "Stopped (main)". Hard-coded cyan/pink/purple on near-black; no light theme.
**Links:** opened by STUDIO RECORD and Ctrl+Alt+R / Ctrl+Alt+Shift+R when not recording (again hides it); hidden automatically during a snip. Out: Explorer only.
**Problems:**
- **Recordings may be saved as empty files (check in the live app).** The panel numbers chunks from 1 (`++state.seq`) but main only writes once it has chunk 0 (`nextSeq: 0`). Per the code, nothing reaches disk, chunks pile up in main's memory, an empty `.part` is renamed to `.webm`, and the panel's own MB counter keeps rising so the UI looks healthy. Confirm before designing around Recordings.
- Cramped and clipped; ~100 px thumbnails of every open window.
- Can't be closed from itself.
- "Auto-split — recording continues in a new file" is false: at 30 min main just stops.
- "Stopped — low disk space" can be overwritten by "Saved".
- Hotkey stop drops the last chunk.
- Settings not remembered (mic/system audio reset; fps fixed 30; bitrate 8 Mbps; saved defaults never read).
- No pause, countdown, region recording, webcam or mic level meter; the footer line is the only feedback; no preview/poster or "Open in Studio" after saving; nothing shows a recording is running when the panel is hidden.
**Designer notes:** it must stay a small separate window, always on top and hidden from capture; don't make the main window the only control. Two modes: **Setup** (larger source picker, perhaps a dropdown with one big preview; audio toggles; Record) and **Live** (compact pill: red dot, timer, size, Stop, optional Pause). Per-mode resizing needs a small main-side change. Add close (×) and "Open Studio". Saved state: small poster + Reveal, Open in Studio, Copy path. Non-negotiables: explicit source choice before recording; visible mic/system-audio failures; unmistakable recording state (red + running timer); raw source labels never rendered as HTML. Add a global recording indicator (tray icon state + HUD).

### 5.10 Capture engine reference (no UI of its own) — `dashboard/screen-capture.js`
**Storage layout:**
```
<OS Videos folder>/WorkspaceHQ/            root (settings.rootOverride exists but is refused over IPC)
  screenshots/
    2026-01-01-120000.png                  slug = local time YYYY-MM-DD-HHmmss; collisions -2, -3 …
    2026-01-01-120000.png.part             only during the atomic write; stale ones deleted at boot
    .thumbs/2026-01-01-120000.thumb.jpg    240 px JPEG q72; written ONLY by overlay snips
  recordings/
    2026-01-01-120500.webm                 VP9 or VP8 + Opus, 8 Mbps, 30 fps
    2026-01-01-120500.webm.part            while recording
    2026-01-01-120500.recovered.webm       a crash's .part, renamed at next boot
    .thumbs/                               created, never written (no recording posters)
<Electron userData>/studio-settings.json   settings
```
**Library row:** `{kind:'shot'/'rec', recovered, path, name, size, mtimeMs, thumbDataUrl}`, nothing else. Duration and bytes exist only on the one-time `studio:capture-added {kind, path, at, durationMs?, bytes?}` event.
**Settings** (`settingsGet/Set`): `{rootOverride, defaultFps:30, hotkeysEnabled:true, defaultSourceId:null, defaultMic:false, defaultSysAudio:false, panelPosition}`. **No UI reads or writes them**; only `panelPosition` is written (by main on drag).
**Recording lifecycle:** panel gets a stream (desktop + optional loopback + optional mic) → `recStart` opens `.webm.part` → a chunk every 500 ms via `recChunk` → `recStop` flushes and renames → `capture-added` + `rec-status:stopped`. Main limits: "30-min auto-split" that is actually a hard stop; stop below 500 MB free disk; `rec-status` every second; pause/resume on write backpressure.
**Snip lifecycle:** `snipArm` freezes each display → one overlay per display → drag → `snipCommit {displayId, rectDIP, mode}` → main crops, writes PNG atomically + thumbnail, copies to clipboard → `capture-added`; overlays close; the panel returns if it was open.
**Network / cost:** none; everything is local.

### 5.11 Global hotkeys — `globalShortcut`
*Files: `main.js`, `screen-capture.js`.*

| Hotkey | Registered in | Does | Status |
|---|---|---|---|
| Ctrl+Alt+G | main.js | Summon palette at cursor | works |
| Ctrl+Alt+X | main.js | Quick-run palette | works |
| Ctrl+Alt+S | main.js (always) | Region snip on all displays | works |
| Ctrl+Alt+R | main.js (always) | Stop recording, or show/hide the record panel | works; **never starts a recording** |
| Ctrl+Alt+Shift+S | screen-capture (`hotkeysEnabled`) | Instant full-display snap, no overlay | works; **silent** |
| Ctrl+Alt+Shift+R | screen-capture (`hotkeysEnabled`) | Same as Ctrl+Alt+R | redundant |
| Ctrl+Alt+L | screen-capture (`hotkeysEnabled`) | Broadcasts "open STUDIO" | **dead** (no subscriber; wouldn't show a hidden window anyway) |
| Ctrl+Alt+Space | — | was quick capture | **retired 2026-09-15**; still mentioned in project docs and the MCP `hq_capture` description |
| Ctrl+R / Ctrl+Shift+R / Ctrl+Shift+I | main window menu (focused only) | Scan now / Refresh / DevTools | Ctrl+R is a trap |

Registered at startup; released on quit. **A failed registration (key held by another app) is only logged to the console.** No cheat sheet anywhere; tray labels mention 2 of 7. `hotkeysEnabled` gates only the Studio extras.
**Designer notes:** a hotkey sheet in settings/help with per-key registration status; decide on one global show/hide-HQ hotkey.

### 5.12 OS notifications & native dialogs
*Files: `main.js` (Notification, dialog).*

**Toasts that still fire** (Windows notification, app icon, **no click action**):

| Trigger | Title | Body |
|---|---|---|
| Tray "Push all unpushed" | "⬆ Pushed" | "3/4 repos" |
| Tray "Snapshot all dirty" | "📦 Snapshotted" | "2/2 repos → backups/" |
| Project snapshot (drawer) | "📦 Snapshot saved" | full destination path |
| Automation OK (from tray/HUD/palette, or window hidden) | "✨ Name resolved · 12s" | "The spell took hold." |
| Automation failed / timed out | "💥 Name fizzled (exit 1)" / "(timeout)" | "Open WorkspaceHQ → Spellbook for the casting log." |
| Chain OK | "⛓️ Chain Name resolved · 3 links" | "Every link held." |
| Chain broke | "💥 Chain Name broke at link 2/3" | "Open WorkspaceHQ → Spellbook for the casting log." |

Retired 2026-09-15 by the owner: all positive scan / quest-completion toasts. Rule: only actionable events get an OS toast.

**Native dialogs:**

| Kind | Message | Buttons |
|---|---|---|
| warning | "Push 3 repo(s)?" + repo names | Cancel · Do it |
| warning | "Snapshot 2 dirty repo(s)?" "Filtered backup copy to backups/ — safe, non-disruptive." | Cancel · Do it |
| warning | "Purge regenerable caches?" "Delete node_modules, dist in: <path> … Reversible — npm install / a rebuild restores them." | Cancel · Purge |
| question | "Snapshot Project A?" "Filtered copy (keeps .git + source, drops node_modules) → backups/. Safe, non-disruptive." | Cancel · Snapshot (default) |
| error | "Scan failed to start" / "Scan failed — Pipeline exited 1. See workspace hq/logs." | OK |
| error | "Open folder — Refused to open path outside Documents: …" | OK |
| error | "Dev server — No dev command for "project-a"." / "Invalid project path…" / "Dev server failed to start" | OK |

**Problems:** toasts can't be clicked; failure text names a realm that no longer exists; raw path in the snapshot toast; scan errors point to a logs folder with no viewer; **scheduled-scan failures are shown nowhere**; native dialogs clash with the app.
**Designer notes:** an in-app notification/activity tray (recent runs, scans, pushes, captures) plus a short rule for which events also get an OS toast and where clicking it lands. Keep the confirm wording and safety (Cancel as default for destructive actions).

### 5.13 Scan pipeline (as experienced) — `runScan`
*Files: `main.js`, `run-pipeline.ps1`, `run-scan.ps1`, `register-task.ps1`.*

**Job:** Refresh everything the app knows about projects, machine and progress.
**Layout today:** no surface. Title bar "WorkspaceHQ — scanning…", then a full reload (or an error box).

| Step | What | Observed time | Notes |
|---|---|---|---|
| collector | git + filesystem metrics per project | 13–85 s | required |
| spellbook | rediscover skills/scripts/tasks → `data/spellbook.json` | 2–4 s | optional |
| pc-health | Windows vitals → `data/pc-health.json` | 5–37 s | optional; runs on every pipeline run, scheduled and manual (`run-pipeline.ps1:41`; confirmed in the 2026-10-03 log). A failure is skipped silently and leaves the previous `pc-health.json` in place. Re-examine runs it alone |
| enrich | `claude -p` writes completion %, build/test, risk, insights (est.) | up to 8 min cap | **manual scans only**; Claude quota; skipped without the CLI; failed when launched from inside a Claude session (log, 2026-09-21) |
| assemble | economy, quests, XP → `data/latest.json` | <1 s | required |
| render | Markdown "Workspace Status <date>" report into the vault | <1 s | required |
| weekly-narrator | weekly recap | — | Sundays; may call Claude |

Deterministic runs: ~20–100 s (last 5 logs).

| Trigger | Runs | User sees |
|---|---|---|
| Windows Scheduled Task, daily 00:00 + logon +2 min | full pipeline **without** enrich (`run-scan.ps1 -NoEnrich`; note: this flag is an **uncommitted** structure-lane edit in the working tree on 2026-10-03. The task runs the file on disk, so scheduled scans skip enrich today, but the committed `run-scan.ps1` at a31d859 omits the flag: a fresh checkout or a revert of that file would silently turn enrich (Claude quota) back on for scheduled scans until the edit is committed) | nothing, then a silent reload when `latest.json` lands (incl. at midnight or just after logon) |
| Tray "Scan now", menu Ctrl+R, tray "Push all unpushed" (scans after pushing), drawer/TASKS PURGE (after deleting). `dispatch('scan:now')` exists but **nothing in the window calls it today** (the palette has no commands; HOME's "⟳ Scan now" copy is never emitted) | full pipeline **with** enrich (Claude quota) | title "scanning…" → reload, or error box |
| Quest done / capture / I learned / archive / revive (app, shard or Obsidian tick; not MCP) | assemble only | reload in ~1 s |
| Commit from the app | collector + assemble, async | reload when done |
| Automation-catalog rescan | spellbook only | reload |
| SYSTEM Re-examine | pc-health only | data rebuilt, no reload |
| MCP `hq_scan_trigger` | collector only, detached | **nothing** (no assemble) |

Logs: `logs/pipeline-*.log` (last 30 kept).
**States:** idle (no "last scanned" indicator outside the renderer) / running (title bar only) / success (reload) / failure (native box for manual; **nothing** for scheduled) / stale (scheduled scan didn't run: no warning).
**Problems:** no progress, step, ETA or "what changed" summary; **no guard against parallel runs** (Scan twice = two pipelines); manual vs scheduled differ silently (manual spends quota); the reload interrupts; MCP-triggered scans invisible; failure text points to a folder.
**Designer notes:** one global **scan-state component** on every screen: last scan time + freshness; running with step x/6 and elapsed; done with a diff summary; failed with the step and a log excerpt. An explicit "include AI enrichment (uses Claude)" choice. A non-destructive post-scan refresh.

### 5.14 Dev servers — `hq:dev-start` / `hq:dev-stop`
**Job:** Is my project's dev server running? Start or stop it.
**Controls today (no window of its own):** PROJECTS card ▶/■ ("Launch Server" / "Stop Server") · drawer "▶ DEV" / "■ STOP" · drawer RESUME (starts it) · mini HUD "■ N" · tray "Kill all dev servers (N)" · app quit (kills all).
**Data:** `projects[].dev_cmd` → whether ▶ exists; push `hq:dev-status {id, running, code?, error?}` (main window only); `machine.servers` count (HUD, right rail). **Not available anywhere: port, URL, logs, exit code, uptime.**
**States:** running / stopped / error (native dialog). **After any reload every card shows ▶ though servers keep running** (state is renderer memory; there is no "list running servers" call); ▶ then silently does nothing. stdout/stderr are piped but never read, so a chatty server can stall once the pipe fills.
**Designer notes:** a global "Running" panel (status bar or activity tray) listing each server: project, uptime, URL, log tail, open, stop. Needs a new main-side list/log channel.

### 5.15 Obsidian two-way sync (invisible surface)
*Files: `main.js` `watchQuestBoard`, `watchDailyNotes`, note/decision/learn mirrors.*

**Vault → app:** ticking `- [x] … 🆔 <quest-id>` in the primary vault's Quest Board note, or `- [x] … wq:<quest-id>` in any daily note, completes that quest ~1.2 s later (overrides write, re-assemble, **reload**, XP drip). Unticking is ignored.
**App → vault:** drawer notes mirrored into the project's vault note under "## 🛠️ WorkspaceHQ log"; decisions appended as `> [!decision]` callouts; "I learned" entries appended to a "What I Learned" note; every scan writes the "Workspace Status <date>" report and the Quest Board.
**States:** vault folder missing → watcher off, silently.
**Problems:** no in-app trace that a completion came from Obsidian; the app reloads under you when you tick something in the vault; no un-complete from either side.
**Designer notes:** show the source of each completion in an activity feed; never interrupt typing for a background completion.

### 5.16 External launches (terminals, Explorer, editor)

| Trigger (in-app) | Opens | Note |
|---|---|---|
| "Send Claude" / ⚡ (`claude:dispatch`) | new cmd window in the project running interactive `claude "<prompt>"` (≤500 chars) | Claude quota; untracked |
| Interactive automation (any entry point) | new Windows Terminal tab (or cmd) running it | untracked; logged "channeled" |
| Open folder / Resume | Explorer at the project | refused outside <Documents> (error box or silent `false`) |
| Recent file / last file | the file in its default app | — |
| STUDIO Reveal | Explorer with the file selected | — |
| Tray "Open most-urgent" | Explorer | — |

**Problems:** the app loses track of everything it launches; no "opened Claude in Project A" record or link back.
**Designer notes:** log hand-offs in the activity feed; label buttons by destination ("Open in Explorer", "Open terminal") so the user knows a window will pop.

### 5.17 Browser bridge extension (capture + popup) — `browser-bridge/`
*Files: `manifest.json`, `background.js`, `social.js`, `popup.{html,css,js}`; app side `dashboard/browser-bridge.js`, `social-bridge.js`.*

**Job:** Tell the app what I'm doing in the browser, and let me approve posts Claude drafted.

**What it captures (background, no UI):**
- **Tab focus:** active tab host, path, full URL (≤500 chars, **query string included**), title, focus time; only while a browser window is focused and the user was active in the last 60 s; flickers under 1.5 s dropped. POSTed to `127.0.0.1:47821/ingest` (header `X-HQ-Bridge: 1`, optional token) every 30 s and on every tab switch, URL change, blur and idle. App keeps a rolling 3 days / 4000 events (`data/browser-activity.json`) and pushes the live tab to the right rail and PROJECTS. Up to 500 events queue in the extension while the app is closed.
- **Social (read):** every 5 min, for each open logged-in tab of the 9 platforms (Mastodon only for the instance granted in Settings), scrapes timeline, mentions/notifications and follower metrics using the site's own session → `data/social/inbox.json` (7 days), `accounts.json`.
- **Social (write):** only when a human clicks Approve & Send; posts through the open logged-in tab. Support: full Bluesky, Mastodon, Reddit; best-effort X (query ids rot); post-only LinkedIn; refuses Instagram, YouTube; not configured Threads, Facebook (always fail).

**Popup layout (280 px wide, refreshes every 2.5 s):**
1. Header "◆ WorkspaceHQ Bridge" + status dot (green if a flush succeeded in the last 90 s; grey off).
2. "WORKING ON NOW": host (or "— idle —") + page title.
3. Stats: queued event count · "app link" live/off.
4. **SOCIAL OUTBOX** + Sync. **Staged** items only: raw platform id · op (+ " ↩" for a reply) · text · green **Approve & Send** (→ "sending…" → "sent ✓" / "failed: <error>"; leaves the list after 1.4 s). Empty "nothing staged"; app down "app link off". Footnote: "Claude stages posts here — nothing sends until you approve."
5. "Pause capture" checkbox.
6. ▸ Settings (collapsed): App endpoint · Token (optional) · Save ("saved ✓") · Mastodon instance URL · "Connect Mastodon" (status line).
7. Red error line "link: <error>".

**Data shown:** `hq_state.current`, `queue.length`, `lastOk` / `lastError`, `hq_cfg.*`; outbox via `GET /social/outbox` (staged only) → `platform, op, reply_to (as ↩ only), text`. **Not shown: `title` and `target`** (a Reddit post is approved without seeing its title or subreddit) or the reply target.

**Actions:** Approve & Send (**irreversible public post**; the only publish path) · Sync · Pause capture (also stops social; clears queue) · Save settings · Connect Mastodon (browser permission prompt). **No Reject, Cancel or Edit**: a staged post can only be sent or left waiting.

**States:** app closed → grey dot, "off", "link: Failed to fetch", queue grows (max 500); paused → nothing sent, queue cleared; per item "failed: open a logged-in bluesky tab first", "Reddit post needs target (subreddit, without r/) + title"; failed items vanish from the popup and remain only in SOCIAL → Outbox; token mismatch → 401 in the error line.

**Problems:** looks like a different product (grey/blue, system font); no Discard/Edit (cancel is MCP-only); no destination preview; "Pause capture" silently pauses social too; captures full URLs with query strings, no per-site exclusion; platform support varies silently; failure feedback vanishes after 1.4 s; needs the matching tab open; split from the app where the queue is visible; README still calls the main card's home "the BASE tab".

**Designer notes:** **Non-negotiable:** publishing happens only by a human click on Approve & Send in the extension; no app or MCP send path, by design. Moving approval into the app is a CONTRACT.md write-gate change that needs a security review, and the send must still execute in the browser tab. Wherever the gate lives, show the complete payload (platform, account, post vs reply, destination/title, reply target, full text, character count) before a one-click irreversible publish; consider an explicit confirm step. Give the popup the app's visual language; add Discard; show what is captured, with a privacy/exclusion setting.

### 5.18 MCP server ("The Binding": tools Claude can call) — `dashboard-v3/mcp/server.mjs`
Registered in `.mcp.json` as `workspacehq`. A stdio JSON-RPC server (MCP 2024-11-05) that reads/writes `data/` (every path locked inside `data/`). No UI.

| Tool | Args | Does | Effect on the app |
|---|---|---|---|
| `hq_status` | — | level, XP, health (est.), open/red tasks, streak (scanner days), project count | read |
| `hq_quests_list` | — | quests + side-quests `{id, title, tier/kind, status, project, xp}` with overrides | read |
| `hq_quest_done` | `{id}` | marks done in `quest-overrides.json` (unknown ids refused) | **app doesn't refresh** (file not watched) until next scan/reload |
| `hq_capture` | `{text ≤4000}` | appends `brain-dump.json` | idea appears after the next assemble |
| `hq_canvas_read` | `{name?}` | list boards / one board | read |
| `hq_canvas_add` | `{name, text ≤2000, x?, y?}` | appends a 280×120 text node; creates the board | **live**: CANVAS updates ~300 ms later |
| `hq_scan_trigger` | — | starts the collector, detached | **no visible change** (no assemble) |
| `hq_social_status` | — | accounts, freshness, per-platform counts, outbox staged/sent/failed | read |
| `hq_social_feed` | `{platform?, limit? ≤200}` | feed posts | read |
| `hq_social_mentions` | `{platform?, limit?}` | mentions + notifications | read |
| `hq_social_metrics` | `{platform?}` | latest follower/post counts | read |
| `hq_social_post` | `{platform, text ≤3000, target?, title?}` | **stages** a post (`status:'staged', by:'mcp'`) | appears in the popup; never publishes |
| `hq_social_reply` | `{platform, reply_to, text}` | **stages** a reply | same |
| `hq_social_outbox` | `{status?}` | lists staged/sent/failed/canceled | read |
| `hq_social_cancel` | `{id}` | staged → canceled | leaves the popup |

**States:** no scan → "data/latest.json missing — run a scan first"; errors return as tool errors; the server never crashes.
**Problems:** README documents 7 of 15 tools; Claude's changes mostly invisible until the next scan, and nothing says "done by Claude"; `hq_scan_trigger` looks like it does nothing.
**Designer notes:** show Claude's footprint: "completed by Claude", staged posts awaiting you, boards Claude drew on (needs a watcher or activity feed on the engineering side). Keep the staging gate.

---

## 6. Data dictionary

**Provenance classes** (every number in the new UI needs one of three visible treatments: measured / (est.) / carried-from-date):
- **measured**: deterministic fact from git or the filesystem.
- **config**: hand-typed in `collector/collector.config.json`.
- **derived**: fixed formula over measured facts.
- **(est.)**: a model judgment or heuristic guess. Must be labelled.
- **carried**: copied from an earlier scan and never re-measured (often stale for weeks).
- **dead**: never populated or always the same constant. Don't design for it.

### 6.0 Pipeline: how data reaches a screen

```
collector.mjs (git/fs facts)      ─► data/raw-metrics.json
spellbook.mjs                     ─► data/spellbook.json
pc-health.mjs                     ─► data/pc-health.json (+ history)
enrich.mjs (claude -p, optional)  ─► data/enrichment.json        (soft fields, est.)
assemble.mjs                      ─► "Workspace Status <date>.json" (one per day, in the vault) + data/latest.json
weekly-narrator.mjs (Sundays)     ─► data/weekly-recap.json
build-data.mjs                    ─► dashboard/data.js = window.DATA {scans[], latest, …sidecars, built_at}
core/data.js                      ─► ctx.data (normalized scans + selection) ─► realm.mount(stage, ctx)
```

The renderer **never fetches**. Everything in `window.DATA` is baked at build time; to show new data main rebuilds `data.js` and reloads. Live values arrive only through `window.hq` push/pull channels (§6.14).

### 6.1 `ctx.data` (what every realm receives)

| Member | Meaning | Example |
|---|---|---|
| `scans` | every daily snapshot, oldest → newest, normalized | ~90 |
| `latest` | newest normalized scan | — |
| `selected` | the snapshot the time machine points at. **Realms render this, not `latest`** | null with no scans |
| `selectedIndex` | index into `scans`; sessionStorage `hq-scan-idx` (survives reload) | 88 |
| `isLatest` | `selectedIndex === last`. False = **read-only past-snapshot mode**; every write must hide or disable | bool |
| `select(i)` | moves the time machine; emits `data:select` | — |
| `bundle` | raw `window.DATA`; sidecars read from here, **not normalized** | — |

**Normalizer contract:** missing containers become `[]`/`{}` (account totals/streak/daily_top3; per project completion, activity, signals, metrics, insights, suggestions, roadmap, side_quests; quests, side_quests, achievements, changes_since_prev, archived_projects, recent_learnings, trends; inventory lists). Optional blocks (`browser`, `account.spellcraft`) are **never invented**: older snapshots lack them, so every surface needs an "absent" state.

### 6.2 `window.DATA` bundle

| Key | Source file | Changes when | Shown in |
|---|---|---|---|
| `scans[]` / `latest` | vault `Workspace Status YYYY-MM-DD.json` | every scan or re-assemble | everything; tray, mini HUD |
| `projectNotes` | `data/project-notes.json` `{projectId: [{id, date, text, completed}]}` | drawer ADD (**no rebuild** → stale until next) | drawer |
| `weeklyRecap` | `data/weekly-recap.json` | Sundays (or forced) | TIMELINE, HOME |
| `spellbook` | `data/spellbook.json` | each scan or RESCAN | AUTOMATIONS, HOME ribbon, palette, rail badge |
| `telemetry` | `data/spell-telemetry.json` | every run (**baked**, stale until rebuild) | AUTOMATIONS dots/last run |
| `actedOn` | `data/acted-on.json` `{entries[]}` | Done on TASKS, focus exit (**baked**) | HISTORY follow-through |
| `pcHealth` | `data/pc-health.json` | every pipeline run (pc-health step) and Re-examine | SYSTEM, rail badge |
| `notebooklm` | `data/notebooklm.json` | **no producer: always null** | NOTES (dead) |
| `canvas[]` | `data/canvas/*.canvas` | `hq:canvas-add`, MCP | ASSISTANT, CANVAS (live via push) |
| `built_at` | build time | each build | status bar "data built …" |

### 6.3 Scan header

| Field | Meaning | Class | Shown in |
|---|---|---|---|
| `schema_version` | "1.0" | constant | — |
| `scan.id` | snapshot day `"2026-09-30"`; **primary key of the time machine** | measured | SNAPSHOTS, status bar, HUD subtitle, HOME |
| `scan.date` | exact ISO timestamp | measured | — |
| `scan.mode` | always "manual", even when scheduled | dead | — |
| `scan.duration_ms` | never written | dead | — |
| `scan.previous_scan` | id this scan diffs against | measured | HOME "changes since" |
| `scan.enriched` | whether model enrichment contributed; gates "~est." markers. Stays true whenever any old `enrichment.json` exists | broken signal | HOME, HISTORY |
| `scan.engine.collector` / `.enricher` | "1.0.0" / "llm" (no real model id) | weak | — |

### 6.4 `account` (one per scan)

| Field | Meaning | Example | Class | Shown in |
|---|---|---|---|---|
| `level` | 1–9 | 4 | derived from XP | HUD, HOME, HISTORY, TIMELINE, mini HUD, tray, takeover |
| `title` | rank (Drifter … Grandmaster) | "Operator" | config | HUD, mini HUD, tray |
| `xp` | cumulative XP | 1,240 | derived | HUD, HOME, HISTORY, TIMELINE, SNAPSHOTS delta |
| `xp_into_level` / `xp_to_next` | bar numerator / remaining | 340 / 60 | derived | HUD bar, mini HUD, forecast |
| `health_index` | the "HP" headline, 0–100 | 72 | **(est.)**: 30% estimated completion + 20% estimated build + 10% estimated tests | HUD, SNAPSHOTS sparkline, status bar, HOME, HISTORY, TIMELINE, mini HUD, tray |
| `health_delta` | vs previous scan | -3 | derived | TIMELINE |
| `streak.scan_days` | consecutive days **the scanner ran** (auto at 00:00 + logon) | 12 | measured, not user effort | HUD, HOME, TIMELINE, mini HUD |
| `streak.longest_scan_days` / `last_scan` | record / last day | 30 | measured | HISTORY |
| `daily_top3[]` | today's 0–3 picks (§6.4b) | — | derived | HOME, tray "Open most-urgent" |
| `spellcraft` | automation economy (§6.4c); absent on older scans | — | derived | HOME, AUTOMATIONS, TIMELINE |

**Health index formula:** 0.30 × avg completion (est.) + 0.25 × git safety (100 − 25 per high-risk repo − 10 per medium) + 0.20 × % builds green or "runs" (est.) + 0.15 × (100 − risk; risk = 20 per high security flag + 8 per medium + min(4 × secrets, 60)) + 0.10 × % projects with passing tests (est.).
**XP economy:** previous XP + quests completed today (red 100 / orange 60 / yellow 30) + 10 per scan day + automation XP. Learnings feed a **separate** knowledge track (15 each) that doesn't affect level.

**6.4a `account.totals`:** `products` (active projects, 8; status bar) · `vaults` / `clones` / `trivial` (inventory counts; trivial carried ≈0) · `open_quests` / `red_quests` (TASKS badge, status bar, HOME KPIs, SNAPSHOTS tooltip, mini HUD, tray) · `quests_done_total` (TIMELINE) · `achievements_unlocked` (TIMELINE, HOME) · `open_side_quests` (shown nowhere) · `archived` · `learnings` / `knowledge_xp` (MAP, HOME).

**6.4b `daily_top3[]`:** `kind` (`quick_win` lowest-tier oldest quest / `momentum` most recently active project with an open quest / `rescue` most-neglected dormant project with an open quest), `label` ("Pick up Project A"), `reason` ("last touched 3d ago — keep momentum"), `project_id`, `quest_id`. All need an open quest: a cleared board = `[]` (common today).

**6.4c `account.spellcraft`:** `spells_known` (~980) · `familiars_bound` (MCP servers, 10) · `ever_cast` / `ever_cast_pct` (7 / 1%) · `per_school{school: {known, cast, pct}}` (8 categories: divination, conjuration, transmutation, abjuration, evocation, illusion, enchantment, restoration; shown as Analyze, Generate, Build, Secure, Execute, Design, Notify, Fix) · `lifetime_casts` (16) · `mastery{id: {rank, distinct_days}}` (novice 1, adept 5, expert 15, master 40, grandmaster 100) · `sotd_casts` · `spell_of_day{id, name, icon, school, rarity, bonus_xp}` (deterministic, from items unused 7+ days; +10 XP) · `last_processed_at` / `xp_settled_this_scan`.

### 6.5 `projects[]` (~8)

**Identity & config:** `id` (kebab key for every link; config) · `name` · `kind` (always "product") · `path` (absolute or Documents-relative; argument to every action) · `stack[]` (hand-typed) · `dev_cmd` (null = no DEV button) · `canonical_branch`.

**Standing:**

| Field | Example | Class | Shown in |
|---|---|---|---|
| `completion.pct` | 62 | **(est.)**: model value if enriched, else last real value carried, else a maturity heuristic clamped 3–95 | PROJECTS (card, sort), HOME, MAP, HISTORY, drawer, palette |
| `completion.basis` | "heuristic — git/activity/tests/docs (no LLM)" | (est.) | drawer, PROJECTS |
| `completion.delta` | +3 | derived from an estimate (renderer recomputes) | — |
| `level` / `xp` | L3 · 412 | derived (includes the estimate); a snapshot, not cumulative | drawer |
| `xp_breakdown{completion, git, build, tests, activity, dirty_penalty}` | — | derived | **nowhere** |
| `xp_delta` | always 0 | dead | — |

**Activity:** `activity.state` (active ≤14 days, stale ≤60, dormant; measured) · `activity.last_commit` · `activity.days_since_commit` ("3d ago"; PROJECTS, HOME, MAP, drawer) · `activity.commit_cadence_7d` (always null, dead) · `metrics.activity.{state, last_modified}` (duplicate).

**Signals** (cheap yes/no; no build or test is ever actually run): `has_tests` / `test_files` · `has_readme`, `has_ci`, `has_license`, `has_dockerfile`, `has_build_config`, `has_package_json` · `build_script` / `test_script` / `dep_count`. Feed side-quests, achievements and PROJECTS' suggested actions.

**Disk:** `disk.reclaimable_bytes` (1.2 GB) · `disk.fat_dirs[{name, bytes}]` (node_modules 900 MB…) → PURGE.

**`metrics.code_health`:** `build` green/red/runs/unknown **(est.; nothing is ever built)** · `build_note` (est.) · `tests{present, count (measured), passing (est. or null), status "present (unverified)"}` · `todo_fixme` · `files` / `loc` · `loc_delta` (shown nowhere) · `recent_files[]` (3 most recently edited; drawer chips).

**`metrics.git_safety`** (all measured unless noted): `has_git`, `has_remote`, `remote`, `branch`, `commits`, **`dirty`** (uncommitted files; the most-used number in the app: PROJECTS, HOME top action, MAP, drawer "wip", tray "Snapshot all dirty"), `ahead` / `behind` / `unpushed` (tray "Push all unpushed"), `risk` (derived: high if no commits, no remote or >20 dirty; medium if unpushed, 6–20 dirty or behind), `flags[]` (`no-git, no-commits, no-remote, many-dirty, unpushed, non-canonical-branch`), `last_commit_subject`.

**`metrics.risk_security`:** `secrets_found` (raw regex hit count; **over-reports**, yet carries the highest weight in HOME's next action (90+) and in health) · `score` low/medium/high (medium if any secret, else carried from the model) · `flags[{type, severity, detail, location}]` (est., carried) · `stale_deps` (carried, effectively dead).

**Model-written (est.; carried until the next successful enrichment):** `insights[] {id, text, severity info/warning/danger, tags[], evidence{}, linked_quest_ids[]}` · `suggestions[] {text, kind, effort S/M/L, impact low/medium/high, linked_quest_id}` · `roadmap[] {milestone, status planned/in_progress/done, target, items[], progress_pct}` · `side_quests[]` (≤8 per project) · `quest_ids[]` (carried, never maintained).

### 6.6 `quests[]` (TASKS)

| Field | Meaning | Class | Notes |
|---|---|---|---|
| `id` | `q-<project>-<concern>` | derived | **load-bearing**: the Obsidian Quest Board (`🆔`) and daily-note `wq:` sync on it |
| `title` | the task | derived, then carried | **counts frozen at creation** ("Push Project A (3 ahead)") |
| `project_id` | owner; null = workspace-wide | derived | links to the project |
| `tier` | red / orange / yellow (ORACLE says critical / important / housekeeping) | derived | sets XP |
| `status` | open / done / dismissed | derived + override | `in_progress` in schema, **never produced**; `dismissed` **has no UI path** |
| `xp` | 100 / 60 / 30 | config | — |
| `insight` | the "why" at creation | derived; build quests (est.) | — |
| `evidence{}` / `auto_complete_when` | facts / auto-close rule (`dirty<=2`) | derived | shown nowhere |
| `created` / `carried_from` / `age_days` | dates / days open | derived | age shown |
| `completed` | date done | derived | HISTORY, TIMELINE |

**Generation:** one git quest per project in priority order (no git → 0 commits → no remote → >20 dirty → unpushed) + a build quest if `build === 'red'` (est.). Auto-close when the rule is true. Manual done → `quest-overrides.json` → re-assemble → reload. **In current data every quest is done**, so the board is usually empty.

### 6.7 `side_quests[]` ("Ideas & risks", top 40)

`id` (`sq-<project>-<key>` or `sq-capture-<id>`) · `kind` risk (red) / urgent (orange) / idea (cyan) / polish (purple) · `title` / `detail` · `source` deterministic / **llm** ("✦ AI", unverified, often stale) / capture (typed by the user) · `severity` / `effort` / `impact` · `project_id` / `project_name` (captures → named project or "Inbox") · `reclaim_bytes` / `fat_dirs[]` (reclaim items only → PURGE) · `done` / `dismissed` (removed when set via overrides).
**Deterministic generators:** rotate N exposed secrets · commit the working tree (>20 dirty) · burn down TODOs (≥15) · reclaim disk (>100 MB) · write a README · add a first test · add CI · add a LICENSE · revisit a dormant project. Sorted risk → urgent → idea → polish, then severity.
**Shown in:** TASKS, MAP (counted, not drawn), HOME chip, right-rail TOP RISK, palette, drawer.

### 6.8 `achievements[]` (catalog of 22)

`id` (e.g. liftoff, in_sync, green_machine, version_control, test_first, crash_slayer, quest_streak_5, debt_zero, scan_streak_7, declutter, secret_free, documented, scribe, cartographer, plus 8 automation achievements) · `unlocked` / `unlocked_on` · `progress{have, need}` · `project_id` (rare). Name, icon, description and XP are **not in the scan**: they're in `schema/gamification.config.json` **and hard-coded again** in `ui/components.js` (`ACH`, pixel-art icons). Pick one source. Shown in HISTORY (+ badge), HOME, TIMELINE, takeover, nudges (≥50% progress, orphaned).

### 6.9 `trends` (dated points `{d, v}`, clipped at the selected snapshot)

`health_index[]` (est.) · `xp[]` · `knowledge_xp[]` (charted nowhere) · `casts_per_day[]` (runs/day incl. failures) · `completion_by_project{id: [{d,v}]}` (est.) · `open_quests_by_tier[{d, red, orange, yellow}]` · `git_risk[{d, high, medium, low}]`. Consumers: HISTORY charts, SNAPSHOTS sparkline (built from `scans[].account.health_index`), HOME momentum, forecast.

### 6.10 `changes_since_prev[]`

`{type, detail, impact positive/negative/neutral, notify, project_id?, quest_id?, achievement_id?, name?, icon?, xp?, level?, title?}`. Types: `new_project`, `git_pushed`, `first_remote`, `build_flip`, `quest_completed`, `level_up`, `new_achievement`, `spell_learned`, `spell_mastery_up`, `spell_of_day_cast`, `spellcraft_xp` (TIMELINE also sees insight-like types: repo_initialized, quest_unresolved, anomaly, "no remote backup", "uncommitted work", "twin"). Shown in TIMELINE, HOME "Changes since", takeover (`level_up`, `new_achievement`, `quest_completed`). `notify` still emitted; OS toasts retired.

### 6.11 `inventory`, `browser`, archive, learnings

| Field | Shape | Class | Shown in |
|---|---|---|---|
| `inventory.vaults[]` | `{name, role, notes, recent7, stale90, kb}` | measured | NOTES, MAP, HUD subtitle count |
| `inventory.clones[]` | `{name, origin, dirty, diverged}` (third-party repos) | measured | MAP, SYSTEM |
| `inventory.duplicates[]` | `{type: twin/shared_remote, detail, severity}` | derived | MAP, SYSTEM |
| `inventory.empty[]` | folder names | measured | MAP, SYSTEM |
| `inventory.anomalies[]` | `{type, detail, severity}` | **carried, never regenerated** | MAP |
| `inventory.trivial[]` | `{name, note}` | **carried, effectively empty** | MAP |
| `browser.captured` / `updated` | bool / ISO | measured | SCREEN TIME, PROJECTS nudge |
| `browser.current` | `{domain, host, title, url, focus_ms, project_id, live}` at scan time | measured | right rail (off-live), PROJECTS |
| `browser.by_domain[]` (top 15) | `{domain, focus_ms, visits, last_ts, title}` over a **3-day rolling window** | measured per window; **(est.) when summed across scans** | SCREEN TIME, PROJECTS |
| `browser.by_project[]` | `{project_id, project_name, focus_ms, visits, domains[]}` (matched by domain, dev-server port, then name/slug) | derived | SCREEN TIME, PROJECTS |
| `browser.totals` | `{focus_ms, visits, domains}` | measured | (unused on SCREEN TIME) |
| `archived_projects[]` | full project + `archived: true`, `archived_on` | — | MAP Restore |
| `recent_learnings[]` | last 10 `{id, ts, project_id, text}` | user-written | MAP |

### 6.12 Sidecars (`ctx.data.bundle.*` and live reads)

| Entity | Fields | Notes |
|---|---|---|
| **spellbook** | `generated_at`; `counts{total, by_source{skill, command, plugin, npm, task, script, grimoire}, by_school{}, familiars}`; `spells[]`; `familiars[]` | ~980 entries: ~830 Claude skills/commands (open a terminal), ~34 headless, ~116 plugin tomes |
| automation (each) | `{id, name, source, kind: castable/channeled/tome/chain, command, args[], cwd, school (est.), rarity: common…legendary, icon, description ≤240, tooltip (est.), body ≤2 KB, content_hash, origin_path, schedule{next_run, last_run, last_result, state}, confirm, timeout_min, chain[], invalid}` | `content_hash` drives the "first run / changed: confirm exact command" rule |
| familiar (each) | `{id, name, transport: stdio/http, detail, school, configured, scope: user/project}` | MCP servers; display only |
| **telemetry** | `{version, confirmed_hashes{id: hash}, favorites[], casts[≤500 {cast_id, spell_id, started_at, duration_ms, outcome: resolved/fizzled/channeled, exit_code, chain_id}], rollup{id: {lifetime_casts, distinct_days[], last_cast, avg_duration_ms}}}` | ~16 runs lifetime; favorites have no setter in v3; failures stay in `casts`, never in `rollup` |
| **weeklyRecap** | `{week_start, week_end, generated_at, ai_narrative, narrative_md (est.), stats{xp_gain, level_start, level_end, health_delta, quests_completed, achievements_unlocked}, spellcraft{casts, resolved, fizzled, distinct_spells, spells_known_start, spells_known_end}}` | one object (latest week), not per scan |
| **actedOn** | `{entries[≤500 {at, kind: quest/git/…, action_id, project_id, seconds, resolved, marked_done, via: board/focus}]}` | `seconds` always 0 (renderer sends minutes) |
| **pcHealth** | `{scanned_at, host{cpu, ramGB, uptimeHrs, battery}, organs[8]}`; organ `{id: cpu/ram/gpu/disk/startup/temp/network/updates, label, value, unit, status: grace/ember/blood, spark[≤24], diagnosis, teaching, fixes[{title, why, teaching, command, danger: safe/caution/admin}]}` | only `safe` fixes runnable; badge = count of `blood` |
| **canvas[]** | `{name, nodes[{id, type: text/file/link, text, x, y, width, height, color?}], edges[{id, fromNode, toNode, fromSide?, toSide?, label}]}` | JSON Canvas (Obsidian-compatible) |
| **projectNotes** | `{projectId: [{id, date, text, completed}]}` | drawer only; `completed` never toggled |
| **social** (live read, `hq.getSocial()`) | `inbox{updated, events[{kind: feed/mention/notification/metrics, platform, author, ts, text, counts, url, metrics{followers, posts, following, likes, impressions}}]}`; `outbox{actions[{id, platform, op: post/reply, target?, title?, reply_to?, text, status: staged/sent/failed/canceled, staged_at, sent_at, result{url}, error, by}]}`; `accounts{accounts[{platform, handle, display, connected_at}]}` | `data/social/*.json`; 7-day window, ≤4000 events; no push channel |
| **studio library** (live read) | rows `{kind: shot/rec, recovered, path, name, size, mtimeMs, thumbDataUrl}` | no duration/dimensions/titles (§5.10) |
| **ORACLE chat** | localStorage `hq-oracle-chat` `{messages[{role, content, meta{status, sections[{name, note, chars}], ms, model, contextChars}]}}` (today, ≤40) | model text untrusted |

### 6.13 User-writable stores (what a control actually changes)

| Store | Written by | Effect on screens |
|---|---|---|
| `data/quest-overrides.json` | Done / DID IT / focus Done / quest shard / Obsidian ticks / MCP `hq_quest_done` | re-assemble today, rebuild, **reload**, tray + HUD refresh, "+~XP" shard (MCP: no refresh) |
| `data/brain-dump.json` | capture (PROJECTS Add to ideas, SYSTEM Note for cleanup, MCP `hq_capture`) | re-assemble + reload; becomes an "Inbox"/project idea at the top of the feed |
| `data/learnings.json` + vault | drawer "I learned…" | re-assemble + reload; knowledge XP |
| `data/project-overrides.json` | Archive / Restore | re-assemble + reload |
| `data/project-notes.json` + vault note | drawer ADD | no rebuild (optimistic local append) |
| vault project note `[!decision]` | drawer "Log decision" | visible nowhere in the app |
| `data/acted-on.json` | focus exit, TASKS Done | invisible until next rebuild |
| `data/spell-telemetry.json` | each run; first-run confirm; favorite (no UI) | invisible until next rebuild |
| `data/canvas/*.canvas` | ASSISTANT ＋ Note, MCP `hq_canvas_add` | **live** via `hq:canvas` |
| `data/shards.json`, `data/shard-library.json` | shards, summon | shard windows |
| `data/social/outbox.json` | MCP stage/cancel; extension Approve & Send result | SOCIAL Outbox, popup |
| `data/.hud-state.json` | mini HUD ×, tray toggle | HUD visibility |
| `<Videos>/WorkspaceHQ/…` | snips, recordings, delete (Recycle Bin) | STUDIO (live) |
| `userData/studio-settings.json` | record panel drag | panel position |
| git working trees | COMMIT, tray Push all | async re-collect + assemble, reload |
| project folders | PURGE, SNAP (backups) | confirm, then delete (+ full scan) / copy |
| localStorage / sessionStorage | UI prefs (§3.1) | per-viewer only |

### 6.14 Live vs nightly

**Nightly / scan-bound:** everything in `scans[]` / `latest` plus the baked sidecars (`pcHealth`, `spellbook`, `weeklyRecap`, `telemetry`, `actedOn`, `projectNotes`). A full scan runs on the scheduled task (daily 00:00 and logon +2 min; no enrich), on Scan now (tray, menu Ctrl+R; with enrich), after tray "Push all unpushed" and after PURGE (both with enrich). AUTOMATIONS' DEEP SCAN runs the same pipeline as an automation. A lighter **re-assemble of today** (no new git facts) runs after quest done, capture, learn, archive and revive; commit runs collect + assemble async. Each ends in a rebuild + **full reload**; main also reloads when `latest.json` changes on disk (800 ms debounce).

**Live (no reload):**

| Stream | Cadence | Payload | Consumers |
|---|---|---|---|
| `hq:machine` | every 2.5 s | `{cpu %, ram %, servers}` | right rail, mini HUD |
| `hq:browser-tab` (+ `getBrowserLive`) | tab switch, URL change, focus, ~30 s flush | `{domain, host, port, path, url, title, ts, focus_ms}` or null | right rail, PROJECTS |
| `hq:claude-sessions` (+ `getSessions`) | any start/end; ended linger 60 s | `[{jobId, label, status, startedAt, endedAt, exitCode, tail ≤800}]` (untrusted) | ASSISTANT + badge |
| `hq:session-output` | streaming (engine only; no v3 consumer) | `{jobId, chunk}` | (none today) |
| `hq:canvas` (+ `getCanvas`) | board file change (300 ms) | full boards list | ASSISTANT, CANVAS |
| `hq:llm:delta` | ~25/s while answering | `{jobId, text}` accumulated (untrusted) | ORACLE only |
| `hq:dev-status` | start/stop/exit | `{id, running, code?, error?}` | PROJECTS, drawer |
| `hq:cast-output` / `hq:cast-done` | per chunk / at finish | §3.15 | Run log, mini HUD, palette |
| `studio:capture-added` / `hq:studio:rec-status` | each save / 1 Hz while recording | `{kind, path, at, durationMs?, bytes?}` / `{state, recId, elapsedMs, bytes, …}` | STUDIO, record panel |
| `hq:mini-update` (+ `getMiniData`) | after scans and quest changes | `{level, title, xpPct, xp, xpToNext, hp, streak, openQuests, redQuests, topQuest{title, tier, xp}, spells[3]}` | mini HUD |
| `shard:init` | shard creation/update | widget config + payload | shards |

**On demand (pull):** `getBrowserLive`, `getSessions`, `getCanvas`, `getSocial` (no push; the extension scrapes every 5 min), `probeLlm` (cached 30 s), `healthScan` (re-probe + rebuild without reload), `studio.libraryList`, `studio.settingsGet`, `getSpellTelemetry`, `getMiniData`, `getSpellbook`.

**Dev harness (no preload):** every live stream silent; right rail "live app only" / "no signal"; write buttons hidden or disabled.
**Past snapshot:** scan-bound values come from the past; live streams still show **now**; sidecars (`pcHealth`, `spellbook`, `telemetry`, `weeklyRecap`, `canvas`, social, studio) are always current, so a past screen mixes eras unless the design separates them.

### 6.15 Magnitudes to design against

| Thing | Typical size |
|---|---|
| Projects | ~8 (design for 1–30) |
| Open tasks | 0–3, often 0 (design for 0–12) |
| Ideas & risks | up to 40 |
| Daily snapshots | ~90 |
| Catalogued automations | ~980 (~34 headless) |
| Successful automation runs ever | ~16 |
| PC vitals | 8 |
| Milestones | 22 |
| Top browser domains per scan | 15 (3-day window) |
| Vaults | 2–4 |
| Social events | 0 today (≤4000, 7 days) |
| Captures | up to 500 listed |
| Change rows per scan | 0–20 |

**Empty and near-zero states are the default, not the edge case.** The core loop the data actually supports: see dirty / unpushed / risky repos → act (commit, push, purge, send to Claude) → re-assemble → XP / health change. Most other meters (automation coverage, knowledge XP, familiars) sit near zero.

**Dead or constant fields (don't design for them):** `activity.commit_cadence_7d`, project `xp_delta`, `scan.mode`, `scan.duration_ms`, quest status `in_progress`, `dismissed` (no write path), `xp_breakdown` (unused), `quest_ids`, `stale_deps`, `inventory.anomalies` and `.trivial` (carried only), `window.DATA.notebooklm`, `S.obsidian` (schema can't carry it).

---

## 7. Action & wiring inventory

One row per control, per place it lives. A control that appears in more than one reader area (the drawer, the run confirm and log, the snip and record hotkeys, `hq:quest-done`) is listed once, under the surface where it lives.

**Counting rule.** A row is a control that does something: it navigates, changes view state, writes, runs, or opens a window. Pure CSS hovers and native `title` tooltips are left out; they are mentioned in their surface sections instead. Scripted chart tooltips are counted. Automatic behaviours (pushes, polls, watchers) and engine calls with no control today are listed at the end in two separate groups and counted separately.

**Legend.** "Reload" means main rebuilds `dashboard/data.js` and calls `win.reload()`; only the active realm and selected snapshot survive (sessionStorage). "(Claude quota)" means the action spends the user's Claude plan usage. "<Documents>" is the containment root that main enforces for project paths. "Suspected", "likely" and "check live" are the readers' hedges, kept on purpose.

| Surface | Control | Wiring | Side effect |
|---|---|---|---|
| Shell | `dispatch('go:<realmId>')` | `core/actions.mjs` → `switchRealm(id)` | Navigation. Used by the HOME decision card. |
| Shell | `dispatch('scan:now')` | `hq.runScan()` → `hq:scan` | Full PowerShell pipeline incl. LLM enrich (Claude quota, up to 8 min); title bar "scanning…"; reload. **Registered, no caller today** (only HOME's never-emitted "⟳ Scan now" maps to it) |
| Shell | `dispatch('capture:note', {text})` | `hq.captureSave(text)` → `hq:capture-save` | Appends `data/brain-dump.json`; blocking re-assemble; reload; note becomes an "Inbox" idea |
| Shell | `dispatch('claude:dispatch', {projectPath, prompt})` | `hq.claudeQuest(path, prompt)` → `hq:claude-quest` | Opens an external cmd window running interactive `claude "<prompt>"` in the project (Claude quota). Prompt flattened to one line, cut at 500 chars. Untracked |
| Shell | `dispatch('quest:done', {questId})` | `hq.markQuestDone(id)` → `hq:quest-done` | Writes `data/quest-overrides.json`; re-assemble; reload; refreshes tray and mini HUD; spawns a desktop "+~60 XP" shard. **Registered, no caller today** (every Done button calls `hq.markQuestDone` directly) |
| Shell | `dispatch('cast', {spellId})` | `hq.castSpell(spellId)` → `hq:spell-cast` | Starts a whitelisted run. Ignores `confirm_required`: any new caller must route to the Run confirm. **Registered, no caller today** (RUN buttons call `castSpell()` in `ui/components.js` directly) |
| Shell | Debug handle and selftest | `window.NEXUS.{switchRealm, applyTheme, THEMES, ordered}`; `?selftest=1` | None. Selftest mounts every realm × theme (15 × 7) and ends on ARCADE. Only path to the 5 hidden themes |
| Boot splash | Click / any key / 2.4 s timeout | `chrome.js bootSplash()` | Fades splash; sessionStorage `hq-booted`. Visible only in the hidden ARCADE theme |
| SYS menu | ◈ SYS button | `chrome.js wireSysMenu` toggles `#theme-menu.open`; outside click closes | Opens/closes the dropdown |
| SYS menu | NEXUS / DAYLIGHT rows | `applyTheme(id)` (`core/themes.js`) → `setLexTheme(id)` → bus `theme:changed` | localStorage `hq-theme`; rail rebuilt; active realm force-remounted (realm-local state resets); menu closes |
| SYS menu | ◈ EXPORT CARD | bus `fx:export-card` → `fx.js exportStatCard()` | Downloads `workspacehq-L<level>-<scanId>.png` (1000×560) via native save; arcade colours regardless of theme; menu stays open |
| SYS menu | ♪ sound row | bus `fx:sfx-toggle` → `fx.js` | Flips localStorage `hq-sfx`; confirmation beep. Label always reads "♪ OFF" (lying control) |
| Snapshots bar | ▸ SNAPSHOTS toggle | `chrome.js buildTimeMachine` | Expands/collapses the dot track; localStorage `hq-tm-open`; blip |
| Snapshots bar | ◀ older / ▶ newer | `data.select(selectedIndex ± 1)` → bus `data:select` | Whole app re-renders that snapshot; sessionStorage `hq-scan-idx` |
| Snapshots bar | Snapshot dot | `data.select(i)` → bus `data:select` | Jumps the whole app to that snapshot |
| Snapshots bar | ⏎ BACK TO LIVE | `data.select(scans.length - 1)` | Returns to latest; may fire the celebration takeover |
| Snapshots bar | ← / → keys | `chrome.js wireKeys` (only when the track is open or already off-live) | Steps snapshots |
| Left rail | Realm button ×15 | `shell.js renderRail` → `switchRealm(m.id)` | Unmounts previous realm, mounts new one, closes drawer, sessionStorage `hq-active-realm`, emits `realm:switched` |
| Left rail | Digits 1–9 | `chrome.js wireKeys` → `switchRealm(ordered()[n-1])` | Opens HOME … SCREEN TIME by position; realms 10–15 have no digit. Not wired when there are no scans |
| Left rail | ◎ FOCUS chip | bus `focus:toggle` → `roundtable/focus.js toggleOneThing()` | Enters focus on the `computeOneThing` pick, or exits unresolved (ledger append). Dead until HOME has mounted once this session |
| Right rail | > / < collapse | `ambient.js render()` toggle | localStorage `hq-ambient`; grid switches to a 22 px strip |
| Palette | Ctrl/Cmd+K | `palette.js onKey` (window keydown) | Toggles the palette, even while typing in a field |
| Palette | `/` | `palette.js onKey` | Opens the palette when not in a field |
| Palette | ↑ / ↓ / hover | `move()` / `highlight()` | Moves selection; blip |
| Palette | Enter / click GO row | `switchRealm(realmId)` | Navigation |
| Palette | Enter / click PROJECT row | `openDrawer(project, null, data)` | Opens the project drawer (no previous-scan delta) |
| Palette | Enter / click QUEST or IDEA row | `switchRealm('hunts')` | Opens TASKS only; the item is not opened or highlighted |
| Palette | Enter / click VAULT row | `switchRealm('observatory')` | Opens NOTES only |
| Palette | Enter / click SPELL row | `switchRealm('grimoire')` | Opens AUTOMATIONS only; the item is not opened |
| Palette | Esc / backdrop click | `palette.js close()` | Closes |
| Drawer | ✕ / scrim click / Esc / any realm switch | `components.js closeDrawer()` (Esc in `chrome.js`) | Closes the drawer |
| Drawer | ▶ RESUME | `hq.openRepo(p.path)` + `hq.devStart(p.id)` (if `dev_cmd`) + `hq.openFile(p.path, recent_files[0])` → `hq:open-repo`, `hq:dev-start`, `hq:open-file` | Explorer window + background dev server + most recent file in the OS default app, all at once; coin sfx only; native error dialog if the path is outside <Documents> |
| Drawer | 📂 OPEN | `hq.openRepo(p.path)` → `hq:open-repo` | Explorer; native error dialog outside <Documents> |
| Drawer | 📦 SNAP | `hq.snapshot(p.path, p.name)` → `hq:snapshot` | Native confirm (defaults to Snapshot); robocopy filtered copy (source + .git, no node_modules/dist) to `<scan dir>/backups/<name>-<stamp>`; OS toast with the raw path; renderer ignores the result, so failure is silent |
| Drawer | ✍️ COMMIT, step 1: draft | `hq.draftCommit(p.path)` → `hq:draft-commit` → `{message, via}` or `{error}` | Label "✍️ Drafting…" (disabled, up to ~2 min); `git diff HEAD` (30k cap) drafted by the local model (30 s), then Claude CLI fallback (90 s, Claude quota); `alert()` on error |
| Drawer | ✍️ COMMIT, step 2: edit + commit | `window.prompt()` → `hq.doCommit(p.path, msg)` → `hq:do-commit` | `git add -A` (stages everything incl. untracked) + `git commit`; async rescan; reload; `alert()` on error. **Suspected dead**: Electron does not implement `window.prompt()` and nothing polyfills it |
| Drawer | ▶ DEV / ■ STOP | `hq.devStart(id)` / `hq.devStop(id)` → `hq:dev-start` / `hq:dev-stop`; status via `hq:dev-status` | Spawns `dev_cmd` / kills the process tree; label updates live only while PROJECTS is mounted; tooltip shows the raw command |
| Drawer | ⋯ overflow menu | local toggle `.ab-menu.open`; click elsewhere closes | Reveals I learned / Log decision / Archive |
| Drawer | 📚 I learned… | `window.prompt()` → `hq.learn(p.id, text)` → `hq:learn` | Writes `data/learnings.json` + appends to the vault "What I Learned" note; re-assemble (knowledge XP); reload. Suspected dead (prompt) |
| Drawer | 📝 Log decision | `window.prompt()` → `hq.logDecision(p.id, text)` → `hq:log-decision` | Appends a `> [!decision] <date>` callout to the project's vault note (creates it if missing); no reload. Suspected dead (prompt) |
| Drawer | ⚰ Archive project | `window.confirm()` → `hq.archiveProject(p.id)` → `hq:archive-project` | Writes `data/project-overrides.json`; re-assemble; reload; drawer closes; project leaves active counts. Inverse lives on MAP |
| Drawer | Recent-file chip (briefing) | `hq.openFile(p.path, rel)` → `hq:open-file` | Opens the file in the OS default app (contained to the project); inert in harness |
| Drawer | ADD / Enter in "Tasks & Mistakes" | `hq.saveNote(p.id, text)` → `hq:note-save` | Writes `data/project-notes.json` + mirrors into the vault project note under a "WorkspaceHQ log" heading; optimistic "Just now" row; no reload. Harness: memory-only fake save |
| Drawer | 🗑 PURGE (side-quest, only with `fat_dirs`) | `hq.reclaim(p.path, dirNames)` → `hq:reclaim` | Native warning; deletes allow-listed regenerable folders (node_modules, dist, .next…); full scan (LLM enrich, Claude quota); reload. Hidden on past snapshot / harness |
| Drawer | ⚡ send side-quest to Claude | `hq.claudeQuest(p.path, "title — detail")` → `hq:claude-quest` | External terminal running Claude (Claude quota). Hidden on past snapshot / harness |
| Drawer | ✓ DID IT (side-quest) | `hq.markQuestDone(sq.id)` → `hq:quest-done` | Overrides write; re-assemble; reload; "+~60 XP" shard. Hidden on past snapshot / harness |
| Drawer | Fold headers (Git safety, Security flags, Standing, Insights, Suggestions, Roadmap) | native `<details>` | Expand/collapse; not persisted. Git safety auto-opens at high risk; Security flags open by default |
| Takeover | Click anywhere / 5.4 s auto-dismiss | `fx.js celebrate()` | Dismisses overlay and confetti. Esc does not dismiss |
| Takeover | `hqDemo('level' / 'quest' / 'ach')` (console) | `window.hqDemo` in `fx.js` | Previews the takeover (developer only) |
| FOCUS overlay | F key (bare, outside fields) | document keydown in `focus.js` → `toggleOneThing()` | Toggles focus; exit logs an unresolved ledger entry. Dead until HOME has mounted once |
| FOCUS overlay | ✓ DONE — exit focus | `exitOneThing(true)` → `hq.markQuestDone(id)` (quest kind only) + `hq.actedOn(entry)` → `hq:quest-done`, `hq:acted-on` | Quest: overrides + re-assemble + reload + XP shard. Always appends `data/acted-on.json` (duration stored as 0: renderer sends minutes, main keeps seconds). **No isLatest guard**: on a past snapshot it completes the quest in live data |
| FOCUS overlay | Esc | `exitOneThing(false)` → `hq.actedOn` (also `closeDrawer`) | Exits; appends an unresolved ledger entry |
| Run confirm | CANCEL / backdrop click | DOM only | Closes; nothing runs. Esc does not close it |
| Run confirm | ⚡ CAST IT | `castSpell(s, preview.content_hash)` → `hq.castSpell(id, hash)` → `hq:spell-cast` | Stores the approval hash in `data/spell-telemetry.json` (except always-ask items); starts the run |
| Run log | CLEAR | DOM; `castBlocks.clear()` | Empties the log |
| Run log | ▾ HIDE | DOM class `hidden` | Slides the panel away; nothing reopens it until new output arrives |
| Run log | ✕ cancel (per running block) | `hq.cancelCast(spellId)` → `hq:spell-cancel` | `taskkill /t /f` on the process tree (or the active chain step); recorded as fizzled; halts a chain |
| In-window keys | Esc | `chrome.js` `closeDrawer`; `focus.js` exit; palette close | Closes drawer / palette, leaves focus (ledger write) |
| HOME | Header chip "⚠ N urgent · N ideas ▸" | `switchRealm('hunts')` (direct, not dispatch) | Opens TASKS |
| HOME | Pick card body | `openDrawer(p, prevP, ctx.data)`, or `switchRealm('hunts')` when the pick has no project | Drawer + scrim, or TASKS; sfx |
| HOME | Pick ◎ FOCUS | `enterOneThing(q)`; silently falls back to `computeOneThing(S)` when no quest resolves | Focus overlay + timer; no write until exit |
| HOME | Pick ✓ DONE (latest + preload + resolved quest only) | `hq.markQuestDone(id)` → `hq:quest-done` | Overrides; re-assemble; reload; tray/HUD refresh; XP shard. Disables at once; fire-and-forget (result not read; `hq:quest-done` returns `true` for any non-empty id). If the quest is already done, `applyDone` exits before the reload, so the button stays grey with no message |
| HOME | Decision card "◆ Review & commit ▸" | `dispatch('go:forge')` then `openDrawer(projById[target.projectId])` | PROJECTS + that project's drawer. The commit itself happens in the drawer |
| HOME | Decision card "▸ Open task ▸" | `dispatch('go:forge')` or `dispatch('go:hunts')`, plus `openDrawer` when `target.projectId` is set | Secret case: PROJECTS + drawer. Quest case: TASKS with nothing selected (`questId` is dropped) |
| HOME | Decision card "✎ Capture" / "⟳ Scan now" (copy exists, never emitted today) | `dispatch('capture:note')` / `dispatch('scan:now')` | Capture: brain-dump + reload. Scan: full pipeline with enrich (Claude quota) + reload |
| HOME | Legacy hero ◎ FOCUS (flag `hq-ff-oracle` = off) | `enterOneThing(computeOneThing(S))` | Focus overlay |
| HOME | Suggested automation "Run ▸" | `castSpell(sp)` → `hq.castSpell(id)` → `hq:spell-cast`; fallback `switchRealm('grimoire')` if the spell is missing | Run confirm on first run, then background process / terminal / chain; telemetry; Run log; `alert()` without preload; bonus XP only at next scan |
| HOME | Momentum HEALTH / XP toggle | module var `momentumMetric` | Switches the sparkline series (survives snapshot change, not reload) |
| HOME | "Overview" fold header | `foldSec` → localStorage `hq-sec-kpis` | Expand/collapse KPI tiles + health list; persisted |
| HOME | Per-project health row | module `Set openPulse` | Expands the inline detail panel |
| HOME | Health detail "OPEN DRAWER ▸" | `openDrawer(p, prevP, ctx.data)` | Drawer |
| HOME | "Changes since …" fold header | `foldSec` → localStorage `hq-sec-changes` | Expand/collapse; persisted |
| HOME | Change row (project-linked only) | `openDrawer(proj, prevProj[id], ctx.data)` | Drawer |
| HOME | Weekly recap READ / CLOSE | module var `sagaOpen` | Shows/hides the LLM-written narrative |
| PROJECTS | Search "Filter projects…" | renderer `projSearch` → `drawCards()`; no debounce | Live filter on name/stack; count "6 / 8"; lost on reload |
| PROJECTS | Filter All / At risk / Active / Dormant | renderer `projFilter` → full `render()` | Filters; re-animates the whole page. At risk = git risk high OR build red OR security high; stale projects are in neither Active nor Dormant |
| PROJECTS | Sort Completion / Risk / Recent | renderer `projSort` → `drawCards()` | Completion % desc (est.); composite risk desc; days since commit asc |
| PROJECTS | Suggested actions: Send Claude | `dispatch('claude:dispatch', {projectPath, prompt})` → `hq.claudeQuest` → `hq:claude-quest` | External terminal with the seed prompt (Claude quota); label "Opened ▸" (stays disabled) or "✗ Not opened — retry"; disabled in harness |
| PROJECTS | Suggested actions: Add to ideas | `dispatch('capture:note', {text})` → `hq.captureSave` → `hq:capture-save` | Brain-dump write; blocking re-assemble (UI freezes); reload; becomes a side-quest; "✗ Not saved — retry" on failure |
| PROJECTS card | Card body click ("▸ Details") | renderer `togglePeek()` (`expanded` Set) | Expands inline detail; blip; lost on reload |
| PROJECTS card | ▶ dev server | `hq.devStart(id)` → `hq:dev-start` | Spawns `dev_cmd` in the project folder (keeps running after leaving); native error dialog on failure; silently no-ops if main already runs it but renderer state was lost |
| PROJECTS card | ■ dev server | `hq.devStop(id)` → `hq:dev-stop` | `taskkill /f /t`; flips on the status push |
| PROJECTS card | Open ⤢ | `openDrawer(p, prevP, ctx.data)` | Drawer |
| PROJECTS card | Recent-file chip (inline detail) | `hq.openFile(p.path, rel)` → `hq:open-file` | OS default app; inert in harness |
| TASKS | Task card Open | `hq.openRepo(project.path)` → `hq:open-repo` | Explorer; native error box outside <Documents> |
| TASKS | Task card ⚡ (icon only) | `hq.claudeQuest(path, "title — insight")` → `hq:claude-quest` | External terminal running Claude (Claude quota); no warning |
| TASKS | Task card Done | `hq.markQuestDone(id)` → `hq:quest-done` + `hq.actedOn({kind:'quest', via:'board', resolved:true})` → `hq:acted-on` | Overrides + ledger; synchronous re-assemble (app freezes for seconds); reload; tray/HUD refresh; XP bubble; no undo |
| TASKS | Idea row 🗑 PURGE (reclaim rows only) | `hq.reclaim(path, dirNames)` → `hq:reclaim` | Native confirm; deletes cache folders; full scan with enrich (Claude quota); reload |
| TASKS | Idea row ⚡ | `hq.claudeQuest(path, "title — detail")` → `hq:claude-quest` | Terminal (Claude quota); hidden for Inbox captures |
| TASKS | Idea row ✓ DID IT | `hq.markQuestDone(sq.id)` → `hq:quest-done` | Same freeze + reload + XP bubble as Done (ideas earn no XP); no ledger entry |
| AUTOMATIONS | DEEP SCAN | `castSpell('grimoire:deep-scan')` → `hq:spell-cast` | Confirm first time; full pipeline incl. LLM enrich (Claude quota) + vault report; main reloads the window mid-run when `latest.json` lands (Run log wiped); 20-min timeout |
| AUTOMATIONS | RESCAN | `hq.rescanSpellbook()` → `hq:spellbook-rescan` | Blocking catalog rescan (up to ~30 s); rewrites `data/spellbook.json`; reload; error result ignored |
| AUTOMATIONS | Category chip ×8 | local `spellSchool` → `render()` | Toggles a category filter; resets paging to 24 |
| AUTOMATIONS | Search "Search automations…" | local `spellSearch` → `draw()` | Live filter on name, description, id |
| AUTOMATIONS | Source segment | local `spellSource` | All / Built-in / Skills / Commands / Scripts / npm / Tasks / Plugins |
| AUTOMATIONS | Kind segment | local `spellKind` | All / Runnable / Interactive / Plugin |
| AUTOMATIONS | Usage segment | local `spellUsage` (build-time telemetry) | All / Used / Unused; stale after runs until rebuild |
| AUTOMATIONS | ⏳ Scheduled toggle | local `spellScheduled` | Only Windows scheduled tasks |
| AUTOMATIONS | Sort segment | local `spellSort` | Most used / Recent / Name |
| AUTOMATIONS | Clear filters | `resetFilters(); render()` | Resets filters and paging |
| AUTOMATIONS | Card click | `openSpellDrawer(s)` → `#drawer` + `#scrim` | Detail drawer; sfx |
| AUTOMATIONS | Card RUN | `castSpell(s)` → `hq.castSpell(id, undefined)` → `hq:spell-cast` | Run confirm if needed; background run → Run log, or terminal (Interactive skills, Claude quota); telemetry; no busy state |
| AUTOMATIONS | Show more (N hidden) | `spellMax += 120; draw()` | Renders 120 more cards |
| AUTOMATIONS drawer | RUN | same as Card RUN | Same as Card RUN |
| AUTOMATIONS drawer | Open file | `hq.openFile(origin_path)` (called with one arg) → `hq:open-file` | Opens only if the file is under <Documents>; silently nothing otherwise (most Claude skills) |
| AUTOMATIONS drawer | ✕ / scrim / Esc | `closeDrawer()` | Closes |
| MAP | Click a tower | `openDrawer(p, prevProj[p.id], ctx.data)` + `sfx('open')` | Drawer; no keyboard focus |
| MAP | ↺ Restore (archived row) | `hq.reviveProject(id)` → `hq:revive-project` | Deletes the override in `project-overrides.json`; re-assemble; reload. No confirm, no pending state, no error UI; still live on past snapshots; hidden without preload |
| HISTORY | Hover a line chart | `attachLineTip` (local mousemove) | Guide line, dot, tooltip with date + values |
| HISTORY | Hover a stacked-bar chart | `attachBarTip` | Guide line, tooltip with date, total, per-tier counts |
| HISTORY | Click a milestone card | `toggleAch()`; module `openAch` Set; `sfx('blip')` | Expands detail (unlock criteria, status/progress); survives scrubs, not reload |
| SYSTEM | Re-examine (header) | `hq.healthScan()` → `hq:health-scan` → `collector/pc-health.mjs` + `rebuildData()` | Writes `pc-health.json` + history; blocking rebuild (main briefly frozen); no reload; silent revert on failure; rail badge stale until reload |
| SYSTEM | Run scan (empty state) | same as Re-examine | First probe; replaces the empty state |
| SYSTEM | ⧉ COPY (per fix) | `navigator.clipboard.writeText(fix.command)` | Clipboard; "✓ COPIED" / "✗ COPY FAILED" for 1.4 s |
| SYSTEM | RUN (per fix, `danger:'safe'` only) | `hq.healthFix(command)` → `hq:health-fix` (main re-validates the command verbatim against on-disk pc-health.json; `powershell.exe -NoProfile -ExecutionPolicy Bypass` via spawnSync, 30 s, 6000-char cap) | Runs a process; **main blocked for the whole run**; inline output (red on failure/refusal). 4 of 9 safe fixes open Windows apps; `ipconfig /flushdns` changes state |
| SYSTEM | Note for cleanup (per cleanup row) | `dispatch('capture:note', {text:'Clean up: <label>'})` → `hq:capture-save` | Brain-dump; blocking re-assemble; reload (scroll lost); "✗ Not saved — retry" on error; nothing remembers which rows were noted |
| NOTES | Vault select | local `searchVault` | Regenerates the `obsidian://search` URI |
| NOTES | Query input "Search all notes for…" | local `searchQuery` (oninput) | Live-regenerates the URI; survives realm switches, not reload |
| NOTES | Enter in query input | clicks Copy link | Same as Copy link |
| NOTES | Copy link | `navigator.clipboard.writeText(uri)`; fallback select + `execCommand('copy')` | Clipboard; "Copied" / "Selected — Ctrl+C" for 1.6 s. Does not open Obsidian |
| SCREEN TIME | Platform card click | local `Set openDoms`; `sfx('open'/'blip')` | Expands/collapses inline detail; survives re-render, not reload |
| ASSISTANT | Session row "▸ Output" | local `<details>`, open state per `jobId` | Shows last ~800 chars of untrusted output |
| ASSISTANT | Project select | reads `data.selected.projects[i].{name, path}` (follows time machine) | Chooses the target project |
| ASSISTANT | Prompt textarea | local value | Newlines later flattened and cut at 500 chars by main; cleared after Start |
| ASSISTANT | Start session | `hq.claudeQuest(path, prompt)` called directly → `hq:claude-quest` | External terminal running interactive Claude (Claude quota). Untracked: never appears in the Sessions list. Returns false outside <Documents>, but the return is ignored and the hint always says "Started — a terminal just opened."; button stays enabled (duplicates possible) |
| ASSISTANT | Canvas board pill | local | Switches board; sfx |
| ASSISTANT | ＋ Note toggle | local; disabled without `hq.canvasAdd` or with no board | Shows the inline note input |
| ASSISTANT | Note input + Add / Enter | `hq.canvasAdd(board, {type:'text', text, x, y})` → `hq:canvas-add` | Atomic append of a 280×120 text node to `data/canvas/<board>.canvas`; `hq:canvas` push to main, mini and cast windows; optimistic card; failures silent; UI cap 600 chars (server 2000) |
| ASSISTANT | Drag / mouse wheel on board | local pointer capture + wheel handler (`preventDefault`) | Pans (no zoom); pan per board in memory; wheel blocks page scroll |
| ORACLE | New chat | local `newChat()`; `hq.llm.cancel(jobId)` → `hq:llm:cancel` if streaming | Clears today's chat (localStorage `hq-oracle-chat`); no confirm; disabled when empty |
| ORACLE | Source chip ×6 (Scan, Tasks, Projects, PC health, Browser, Vault) | local; sent as `include{}` on the next chat | localStorage `hq-oracle-include`; no IPC on click |
| ORACLE | Suggested prompt ×4 (empty state) | `send(text)` → `hq.llm.chat` | Same as Send; disabled until a local model is ready |
| ORACLE | Textarea (Enter sends, Shift+Enter newline) | module-memory draft → `send()` | Draft lost on reload |
| ORACLE | Send | `hq.llm.chat({jobId, messages, include})` → `hq:llm:chat`; stream via `hq.llm.onDelta` (`hq:llm:delta`) | Main builds context from `latest.json`, `pc-health.json`, browser sidecar, optional vault walk (≤4000 .md files); HTTP only to 127.0.0.1; no cloud, no cost; writes localStorage chat |
| ORACLE | Stop (Send while streaming) | `hq.llm.cancel(jobId)` → `hq:llm:cancel` | Aborts; keeps partial; footer "stopped" |
| ORACLE | Retry (offline / no-model panel) | `hq.probeLlm({force:true})` → `hq:llm:probe`, then `hq.llm.warm()` → `hq:llm:warm` | Localhost probe; loads model into GPU memory (can take ~1 min) |
| CANVAS | Board pill (only when >1 board) | local | Switches the feed's board; no writes |
| SOCIAL | REFRESH | `hq.getSocial()` → `hq:social-read` → `bridge.readSocial()` | Re-reads `data/social/{inbox,outbox,accounts}.json`; no writes, no network |
| SOCIAL | Feed / Mentions / Outbox tabs | local module state | Switches the list; Outbox label shows staged count |
| SOCIAL | Platform filter chip | local | Filters Feed/Mentions; click again = All |
| STUDIO | SNIP | `hq.studio.snipArm('region')` → `hq:studio:snip-arm` | Opens snip overlays on every display |
| STUDIO | RECORD | `hq.studio.panelToggle()` → `hq:studio:panel-toggle` | Shows/hides the record panel. **Does not record** (tooltip wrongly says Ctrl+Alt+R records) |
| STUDIO | REFRESH | `hq.studio.libraryList({kind:'all', limit:500})` → `hq:studio:library-list` | Re-lists the capture folder (base64 thumbnails in payload); full redraw |
| STUDIO | Tile click | local `openPreview(item)` | Preview modal (image or `<video controls>`) |
| STUDIO | REVEAL (tile) | `hq.studio.libraryReveal(path)` → `hq:studio:library-reveal` | Explorer with the file selected; main refuses paths outside the library root |
| STUDIO | RENAME (tile) | none (always disabled; no rename IPC) | None; tooltip says rename in Explorer |
| STUDIO | DELETE (tile) | `window.confirm()` → `hq.studio.libraryDelete(path)` → `hq:studio:library-delete` | File + thumbnail to the Recycle Bin (recoverable); tile removed at once; errors only in the button tooltip |
| STUDIO | Preview Close × / Esc / backdrop | local `closePreview()` | Closes; stops video |
| Main window | Window close (X) | `win.on('close')` → `win.hide()` unless quitting | Hides to tray |
| Main window | Menu "Scan now" / Ctrl+R | `runScan()` → `run-pipeline.ps1` | Full scan with enrich (Claude quota); title "scanning…"; reload (can reload twice); native error box on failure |
| Main window | Menu "Refresh" / Ctrl+Shift+R | `rebuildData(); win.reload()` | Rebuilds the bundle; reload |
| Main window | Menu "Toggle Developer Tools" / Ctrl+Shift+I | menu role | DevTools |
| Main window | Menu "Quit" | menu role → `before-quit` | Saves shard positions; kills runs, dev servers, Claude jobs; stops the bridge server |
| Main window | Launch a second time | `requestSingleInstanceLock` + `second-instance` | Focuses the existing window |
| Main window | `Launch WorkspaceHQ.vbs` / Startup-folder `launch-hidden.vbs` | `electron .` / `--hidden` → `START_HIDDEN` | Starts visible / starts in the tray (+ mini HUD if enabled) |
| Tray | Icon left-click | `tray.on('click')` → `createWindow` / `win.show` / `win.focus` | Shows main window |
| Tray | Show WorkspaceHQ | `createWindow()` / `win.show()` | Shows main window |
| Tray | Toggle mini HUD | `toggleMini()` | Writes `data/.hud-state.json`; rebuilds menu |
| Tray | Summon widget (Ctrl+Alt+G) | `openSummon()` | Summon palette at cursor |
| Tray | Cast a spell… (Ctrl+Alt+X) | `openCastPalette()` | Quick-run palette |
| Tray | Scan now | `runScan()` | Full scan with enrich (Claude quota); reload |
| Tray | Cast ▸ <automation> (top 3) | `castFromShell(id)` → `doCast` / `openChanneled` | Runs only already-approved, non-always-ask, non-chain items (OS toast on finish); otherwise just shows the main window with no confirm open |
| Tray | Cast ▸ Open Spellbook | `win.show()` | Shows window; does not navigate to AUTOMATIONS |
| Tray | Push all unpushed (N) | `confirmThen` → `gitEach(['push'])` → Notification → `runScan()` | Native confirm; `git push` per repo (network); toast "k/N repos"; then a full scan **with enrich** (Claude quota, same as Scan now) + reload |
| Tray | Snapshot all dirty (N) | `confirmThen` → `snapshotProject` (robocopy) | Native confirm; backups per dirty repo; toast |
| Tray | Kill all dev servers (N) | `taskkill /pid /f /t` per server | Kills processes; no confirm; N can be stale |
| Tray | Open most-urgent: Project A | `shell.openPath(resolveProjectPath(path))` | Explorer (not the in-app project) |
| Tray | Quit | `app.isQuitting = true; app.quit()` | Quit with cleanup |
| Mini HUD | Drag card | `-webkit-app-region: drag` | Moves; position not persisted |
| Mini HUD | × hide | `hq.miniHide()` → `hq:mini-hide` | Hides; persists `miniVisible:false`; rebuilds tray; only way back is the tray |
| Mini HUD | Top-quest card click | `hq.showMain()` → `hq:show-main` | Shows main window (not the quest) |
| Mini HUD | Automation button ×3 | `hq.castSpell(id, undefined, {notify:true})` → `hq:spell-cast`; `hq.onCastDone` | Runs; icon spins; ✨/💥 for 4 s; OS toast; opens main window if a confirm is required (confirm not shown) |
| Mini HUD | ■ N (kill dev servers) | `hq.killServers()` → `hq:kill-servers` | Kills all dev servers; no confirm, no list |
| Summon palette | Enter | `hq.shardSummon(text)` → `hq:shard-summon` → `summonWidget()` | Spawns a shard at the cursor; note writes `data/shards.json`; free text runs `claude -p` (Claude quota, 120 s) and writes `data/shard-library.json`; `quest`/`hp` with no data closes silently |
| Summon palette | Esc / blur | `hq.shardSummonCancel()` → `hq:shard-summon-cancel` | Closes |
| Shards | Drag header | app-region drag → `moved` → `persistShards()` | Saves position (note and conjured shards) |
| Shards | ✕ close | `hq.shardClose()` → `hq:shard-close` | Closes; a note's text is deleted permanently; rewrites `shards.json` |
| Shards | Note typing | `hq.shardSave({text})` → `hq:shard-save` (500 ms debounce) | Writes `shards.json` |
| Shards | Timer PAUSE/GO, RESET | in-shard JS | Local countdown; beep at 00:00 (no OS notification) |
| Shards | Quest ✓ DONE | `hq.markQuestDone(id)` → `hq:quest-done` → `applyDone` | Overrides; re-assemble; reloads main window; tray rebuilt; XP drip |
| Shards | Quest OPEN HQ | `hq.showMain()` → `hq:show-main` | Shows main window |
| Shards | Conjured ↻ regenerate | `hq.shardRegen()` → `hq:shard-regen` | `claude -p` again (Claude quota); updates library + shards |
| Shards | Conjured widget's own controls | sandboxed inline JS, no network | No effect outside the shard |
| Shards | Library ▶ spawn | `hq.shardLibSpawn(key)` → `hq:shard-lib-spawn` | Spawns the saved creation 40 px offset |
| Shards | Library ✕ delete | `hq.shardLibDelete(key)` → `hq:shard-lib-delete` | Removes from `shard-library.json`; no confirm |
| Quick-run palette | Type / ↑ / ↓ | local filter / selection | Filters (max 12 rows); arrows cancel a pending confirm |
| Quick-run palette | Enter / row click | `hq.castSpell(id, hash?, {notify:true})` → `hq:spell-cast` | Runs (or shows inline confirm), then closes; outcome as OS toast + main Run log; errors swallowed; a click runs immediately |
| Quick-run palette | Enter again (inline confirm) | `hq.castSpell(id, preview.content_hash, {notify:true})` | Stores approval; runs; closes |
| Quick-run palette | Esc / blur | `hq.hideCastPalette()` → `hq:cast-palette-hide` / `blur` | Backs out of confirm, else closes; blur loses a pending confirm |
| Snip overlay | Left-drag + release / Enter with a selection | `hq.studio.snipCommit({displayId, rectDIP, mode:'region'})` → `hq:studio:snip-commit` (send) | Saves at once: PNG + 240 px thumb to `Videos/WorkspaceHQ/screenshots/`; clipboard; closes all overlays; `studio:capture-added`; no confirmation beyond a white flash |
| Snip overlay | Space / Enter with no selection | `snipCommit` with `mode:'full'` | Saves the whole display |
| Snip overlay | Esc / click without dragging (<3 px) | `hq.studio.snipCancel()` → `hq:studio:snip-cancel` | Cancels on every display; record panel returns if it was open |
| Record panel | Source tile (click / Enter / Space) | local `state.selectedId` | Selects screen or window; locked while recording |
| Record panel | Mic chip | local → `recStart({mic})` + `getUserMedia({audio:true})` | Adds mic; on failure records without it + warning |
| Record panel | System audio chip | local → `getUserMedia` desktop audio source | Adds loopback audio; on failure video only + warning |
| Record panel | RECORD | `getUserMedia(desktop)` → `hq.studio.recStart(opts)` → `hq:studio:rec-start`; `hq.studio.recChunk(recId, seq, buf)` every 500 ms → `hq:studio:rec-chunk` | Creates `recordings/<slug>.webm.part` (8 Mbps). **Check live:** chunk numbering (panel starts at 1, main waits for 0) may mean nothing is written |
| Record panel | STOP | `MediaRecorder.stop()` → `hq.studio.recStop(recId)` → `hq:studio:rec-stop` | Flushes and renames to `.webm`; `studio:capture-added`; shows Saved + REVEAL |
| Record panel | REVEAL (footer) | `hq.studio.libraryReveal(lastPath)` | Explorer on the last recording |
| Record panel | RESCAN (footer) | `hq.studio.recSources()` → `hq:studio:rec-sources` | Re-lists and re-snapshots screens/windows; disabled while recording |
| Record panel | Drag header | `-webkit-app-region: drag`; main `move` handler | Saves position to `userData/studio-settings.json` |
| Global hotkeys | Ctrl+Alt+G | `globalShortcut` → `openSummon()` | Summon palette at cursor |
| Global hotkeys | Ctrl+Alt+X | `globalShortcut` → `openCastPalette()` | Quick-run palette |
| Global hotkeys | Ctrl+Alt+S | `globalShortcut` → `screenCapture.snipArm('region')` (always registered) | Freezes all displays, opens overlays, hides record panel; repeat press ignored while armed |
| Global hotkeys | Ctrl+Alt+Shift+S | `screen-capture.js` → `quickFullSnap()` (only if `hotkeysEnabled`) | Full PNG of the display under the cursor, no overlay, no thumbnail; clipboard; `capture-added`. **No visible feedback** |
| Global hotkeys | Ctrl+Alt+R | `globalShortcut` → `screenCapture.recToggle()` (always registered) | Recording: stop + save. Otherwise: show/hide the record panel. **Never starts a recording** |
| Global hotkeys | Ctrl+Alt+Shift+R | `recToggle({mic:false, sysAudio:false})` (`hotkeysEnabled`) | Same as Ctrl+Alt+R (redundant) |
| Global hotkeys | Ctrl+Alt+L | broadcasts `hq:studio:open-realm` (`hotkeysEnabled`) | **Dead**: no renderer subscribes; would not show a hidden window anyway |
| Native dialogs | Confirm boxes (Do it / Purge / Snapshot vs Cancel) | `dialog.showMessageBox` via `confirmThen`, `hq:reclaim`, `hq:snapshot` | Proceeds with git push / folder delete / backup. Cancel is default except the project-snapshot box |
| Native dialogs | Error boxes (OK) | `runScan` errors, `hq:open-repo`, `hq:dev-start` | Acknowledge only; scan errors point to a logs folder with no viewer |
| OS notifications | Toast click | `new Notification(...).show()`, no click handler | Nothing (does not open the app or a surface) |
| Obsidian sync | Tick `- [x] … 🆔 <id>` in the vault Quest Board, or `- [x] … wq:<id>` in a daily note | `fs.watch` → `applyDone(ids)` (~1.2 s) | Completes the quest; overrides; re-assemble; reloads the main window; XP drip. Unticking is ignored |
| Bridge popup | Approve & Send (per staged post) | `chrome.runtime.sendMessage({type:'social:send'})` → `socialSend()` in the logged-in tab → POST `127.0.0.1:47821/social/outbox/result` | **Irreversible public post.** App sets outbox status sent/failed + result URL. The only publish path in the system |
| Bridge popup | Sync | `{type:'social:sync'}` → `socialTick()` → POST `/ingest/social`, `/social/accounts` | Read-only scrape of open logged-in social tabs; writes `inbox.json`, `accounts.json` |
| Bridge popup | Pause capture | `chrome.storage.local hq_cfg.paused` | Stops tab capture **and** social scraping; clears the queue; persistent |
| Bridge popup | Settings: Save (endpoint, token) | `chrome.storage.local hq_cfg` | Persists endpoint and optional token |
| Bridge popup | Connect Mastodon | `chrome.permissions.request(origin)` + `hq_cfg.mastodonHost` | Browser permission prompt; enables the user's instance |
| MCP tools | `hq_status`, `hq_quests_list` | stdio `tools/call` | Read `latest.json` (+ overrides) |
| MCP tools | `hq_quest_done {id}` | `tools/call` | Writes `quest-overrides.json`. App does not refresh (file not watched) until next scan/reload |
| MCP tools | `hq_capture {text ≤4000}` | `tools/call` | Appends `brain-dump.json`; appears after the next assemble |
| MCP tools | `hq_canvas_read {name?}` | `tools/call` | Reads boards |
| MCP tools | `hq_canvas_add {name, text ≤2000, x?, y?}` | `tools/call` | Appends a 280×120 node (default 40/40); creates the board; **live** in CANVAS ~300 ms later |
| MCP tools | `hq_scan_trigger` | `tools/call` → detached `collector.mjs` | Collector only, no assemble: **no visible change** |
| MCP tools | `hq_social_status` / `_feed` / `_mentions` / `_metrics` / `_outbox` | `tools/call` | Read social sidecars |
| MCP tools | `hq_social_post` / `hq_social_reply` | `tools/call` → `stageAction()` | Appends a **staged** action (`by:'mcp'`); never publishes |
| MCP tools | `hq_social_cancel {id}` | `tools/call` | Staged → canceled; leaves the popup |

### 7b. Engine capabilities with no control today (must get a home or be cut deliberately)

| Surface | Capability | Wiring | Side effect |
|---|---|---|---|
| (no UI today) | Run Claude in-app, headless and tracked | `hq.sessionStart({cwd, task, label?})` → `hq:session-start` (fixed args `-p --output-format stream-json --verbose`, task via stdin) | `{jobId}` or `{error}`; appears in `hq:claude-sessions`; task ≤2000 chars; 15-min timeout; git dirty baseline captured before spawn; Claude quota |
| (no UI today) | Live session output | `hq.onSessionOutput(cb)` ← `hq:session-output {jobId, chunk}` | Parsed prose + `[tool: …]` / `[error: …]` lines; untrusted, render as text; lost on reload (fall back to `tail`) |
| (no UI today) | Stop a session | `hq.sessionKill(jobId)` → `hq:session-kill` | `taskkill /f /t`; returns true/false; confirm via the sessions push |
| (no UI today) | What a session changed | `hq.sessionDiff({cwd, jobId})` → `hq:session-diff` | `{files[{path, status}], stat, baseline{state: captured/unavailable/none}}`; read-only |
| (no UI today) | Favorite an automation | `hq.favoriteSpell(id)` → `hq:spell-favorite` | Toggles telemetry favorites (drives quick-run palette empty state, tray Cast menu, mini HUD buttons) |
| (no UI today) | Live telemetry view | `hq.getSpellTelemetry()` → `hq:spell-telemetry` | `{favorites, rollup{last_cast, lifetime_casts, distinct_days count}, confirmed[]}`; used by the quick-run palette only |
| (no UI today) | Capture settings | `hq.studio.settingsGet()` / `settingsSet(patch)` | fps, mic/system-audio defaults, default source, hotkeys on/off; ignored by the panel today |
| (no UI today) | Abort a failed recording start | `hq.studio.recAbort(recId)` → `hq:studio:rec-abort` | Deletes the `.part` file (internal) |
| (no UI today) | Toggle recording from a renderer | `hq.studio.recToggle(opts)` → `hq:studio:rec-toggle` (exposed in `preload.js`; only the hotkeys call `recToggle`, in main) | Stops a running recording, else shows/hides the record panel. With `opts.sourceId` main opens a `.webm.part` itself, but nothing feeds it chunks unless the record panel is recording, so a start from anywhere else yields an empty file. A future "Start recording" button must go through the panel |
| (no UI today) | Toast / OS notification router | `core/notify.mjs` `emit(evt {type, title, body})` / `route()` | OS notification when hidden; toast handler never injected; no caller |
| (no UI today) | Command registry | `core/actions.mjs all()` | Lists dispatchable verbs; built for the palette, unused |
| (no UI today) | Open STUDIO on request | `hq.studio.onOpenRealm(cb)` ← `hq:studio:open-realm` | No subscriber (why Ctrl+Alt+L is dead) |

### 7c. Automatic behaviours (no control; the prototype must show their state)

| Surface | Behaviour | Wiring | Side effect |
|---|---|---|---|
| Whole window | Data refresh = reload | main `fs.watch data/latest.json` (800 ms) and after scan / quest-done / capture / learn / archive / revive / rescan / commit → `build-data.mjs` → `win.reload()` | Full reload; realm + snapshot restored from sessionStorage; everything else lost |
| Scan pipeline | Scheduled scan | Windows Scheduled Task daily 00:00 + logon +2 min → `run-scan.ps1 -NoEnrich` | Deterministic scan (no Claude); silent reload when it lands; failures shown nowhere |
| Right rail, mini HUD | Machine vitals | `hq.onMachine` ← `hq:machine` every 2.5 s | `{cpu %, ram %, servers}`; right rail re-renders entirely each tick |
| Right rail, PROJECTS | Live browser tab | `hq.getBrowserLive()` (`hq:browser-live`) seed + `hq.onBrowserTab` (`hq:browser-tab`) | Repaints "Working on now" (latest snapshot only) |
| ASSISTANT + rail badge | Claude session registry | `hq.getSessions()` (`hq:sessions-list`) + `hq.onClaudeSessions` (`hq:claude-sessions`), app-lifetime in `boot.js` | Session list + running-count badge; finished jobs linger ~60 s |
| ASSISTANT, CANVAS | Canvas boards | `hq.getCanvas()` (`hq:canvas-read`) + `hq.onCanvas` (`hq:canvas`, 300 ms debounce) | Live board updates |
| PROJECTS, drawer | Dev-server status | `hq.onDevStatus` ← `hq:dev-status {id, running, code?, error?}` (subscribed only while PROJECTS is mounted) | Repaints ▶/■; `code`/`error` ignored |
| Run log | Run output and result | `hq.onCastOutput` / `hq.onCastDone` (`hq:cast-output`, `hq:cast-done`), app-lifetime in `fx.js` | Auto-opens the Run log; sfx; OS toast if hidden |
| STUDIO | New capture + poll | `hq.studio.onCaptureAdded` (`studio:capture-added`) + 30 s `libraryList` poll | Full page redraw |
| Snip overlay | Frozen display image | `hq.studio.onSnipFrozen` ← `hq:studio:snip-frozen {displayId, pngDataUrl, bounds, scaleFactor, kind, displayIndex}` (one push per overlay window on show) | Paints the frozen desktop the selection is drawn over; until it arrives the overlay is solid near-black |
| Record panel | Recording status | `hq.studio.recStatus` ← `hq:studio:rec-status` (1 Hz + transitions) | Backpressure pause/resume; stop on low disk, error, 30-min limit or hotkey |
| Mini HUD | HUD payload | `hq.getMiniData()` (`hq:mini-data`) + `hq.onMiniUpdate` (`hq:mini-update`) | Repaints LV/XP/HP/streak/top quest/automations |
| Shards | Shard config | `hq.onShardInit` ← `shard:init` | Renders the widget |
| ORACLE, SYSTEM | Local model probe + warm-up on mount | `hq.probeLlm()` (`hq:llm:probe`, 30 s cache) + `hq.llm.warm()` (`hq:llm:warm`, ORACLE only) | Status pill / AI strip; model held in VRAM 30 min |
| SOCIAL | 60 s poll while mounted | `hq:social-read` | Re-reads sidecars |
| Boot | One-time theme migration | `currentTheme()`: if `hq-theme-migrated` absent, force `nexus` | Every returning install lands on NEXUS once |
| Bridge (background) | Tab capture flush + social scrape | `chrome.alarms` + tab/window/idle listeners → `flush()` every 30 s and on tab change → POST `/ingest`; `socialTick()` every 5 min | App writes `data/browser-activity.json` and pushes `hq:browser-tab`; social sidecars written; up to 500 events queue while the app is closed |

---

## 8. Design system today & UI history

### 8.1 How the CSS is layered today (cascade = `<link>` order; later wins)

1. `tokens.css`: spacing, type and layout ramps (header comment "nothing consumes them yet" is stale).
2. `base.css`: shell grid, rail sigils, ambient rail, fallback tokens.
3. `components.css`: the v2 stylesheet transcribed verbatim: pixel @font-faces, the v2 `:root` token contract (overrides base), the "NES frame" rule (2 px black gap + 2 px coloured frame + glow) on every container, every content primitive, and token blocks for OKAMI, NUMIDEA, OPS DESK, NIGHTFALL.
4. `chrome.css`: CRT overlay, boot splash, run log, run confirm, HUD, snapshots bar, status bar, takeover, focus overlay, theme menu, per-theme atmospheres.
5. `realms.css`: @imports 15 per-realm sheets (2,757 lines; heavy `:root[data-theme="nexus"] .realm-x` overrides).
6. `fx.css`: byte-identical duplicate of the takeover block.
7. `palette.css`: token-only (the cleanest sheet).
8. `cinematic.css`: the NEXUS skin; vendors Inter, DM Serif Display, JetBrains Mono; named palette (`--void/--ash/--edge/--parch/--ember…`) re-mapped onto v2 names.
9. `daylight.css`: DAYLIGHT, a mirror of cinematic.

Overlay z-stack: `#overlays` z100 → scrim z60, drawer z61, palette z70, takeover z90, focus z95; CRT z200; boot splash z300.

### 8.2 Tokens that exist

- **Spacing** `--space-0..7` = 0 / 4 / 8 / 12 / 16 / 24 / 32 / 48 px.
- **Type** `--fs-xs/sm/md/lg/xl/2xl` = 12 / 14 / 16 / 20 / 26 / 34 px.
- **Layout** `--measure` 880 px · `--tap-min` 32 px (every button, sigil, `[role=button]`) · `--ambient-w` clamp(200px, 18vw, 264px) · `--rail-w` 64 px base / 84 px NEXUS + DAYLIGHT.
- **Semantic contract every realm sheet consumes (v2 names):** surfaces `--bg --bg2 --panel --card --card-hi --ink --frame --frame-hi`; text `--text --muted --faint`; roles `--active --active-arrow --divider`; palette `--cyan --magenta --gold --gold-2 --green --red --orange --yellow --blue --purple --pink`; type `--px` (display/labels), `--term` (body), `--mono` (data). Themes must remap `--active`, `--active-arrow`, `--divider`, `--mono`.
- NEXUS/DAYLIGHT add `--void --void-2 --ash --ash-2 --ash-3 --edge --edge-2 --etch --parch --parch-2 --parch-3 --ember --ember-2 --ember-deep --blood --grace --rune --font-display --font-ui --font-data`.
- **Missing:** radius, shadow, elevation, motion tokens (radii hard-coded per theme: 0 / 3 / 6 / 12 / 14 / 16).
- **Token names lie** (5 stacked layers + 24 `!important`). In NEXUS: `--cyan` is steel blue, `--magenta` is amber, `--green` is sage, `--px` (the "pixel display" font) is Inter, `--ink` is the near-black gap/input background, not text.

### 8.3 The 7 themes (`THEMES` in `core/themes.js`; default `nexus`; only NEXUS and DAYLIGHT are in the menu)

| Theme | Surfaces / text | Accent & severities | Type (declared → renders) | Shape & atmosphere | Register |
|---|---|---|---|---|---|
| **NEXUS** (default "clean dark", Linear/Raycast intent) | page #0b0d13→#06070d, panel #141824, raised #1c2130, hairline #2a3040; text #eceef3 / #aeb4c2 / #7d8394 | one amber #e2a24a (hi #f2c479, deep #a8701c); danger #e0645a, success #7fb98a, info #6f9fe0, orange #d98a3a, yellow #d9b24a | Inter 400/600 UI, JetBrains Mono data, DM Serif Display on 2 headings → all shipped | 15px/1.55 body; 12 px cards, 8 px buttons, 9 px rail items; hairlines, near-solid panels, faint amber glow; Inter 600 15 px headings with a 24 px amber tick; no CRT/splash | PLAIN |
| **DAYLIGHT** ("clean light") | page #f6f7f9→#eef0f3, panel #ffffff, raised #f1f3f6, hairline #e3e6eb; text #1b1f27 / #565d6b / #838a97 | one blue #2f6feb (text #1e5fd8); danger #d64545, success #2f9e57, orange #c07817, yellow #b8891f | Inter + JetBrains Mono | NEXUS geometry, soft shadows | PLAIN |
| ARCADE (v2 original) | #07060f / #100d24 / cards #14102b–#1a1538, frame #322a5e; text #e8e6ff / #9a93c9 / #5e588a | gold #ffd23f, cyan #00f0ff, magenta #ff2bd6, green #3aff6e, red #ff4757, orange #ffa502 | Press Start 2P + VT323 (shipped from `dashboard/vendor/fonts`) | NES double frames, radius 0, glows, CRT scanlines, PRESS START splash | DEFAULT |
| OKAMI | #1E1623, cards #251f2b | #FFD23F, purple #AC4BFF, green #00C758, red #FB2C36 | Anton / Space Grotesk / Space Mono → Impact / Inter / Courier New | 16 px radius, pill buttons, aurora orbs, grain | DEFAULT |
| NUMIDEA | navy #0D1A2F, panel #17364F | teal #09D8C7, blood #BD0927, gold #F5B73D | Abril Fatface / Space Grotesk / Space Mono → Georgia / system-ui / Courier New | 14 px glass cards, drifting mesh, teal grid | DEFAULT |
| OPS DESK | #0e0e0c, cream #f2ead8 | amber #e8a41a, orange #e8521a, green #4caf7d, red #e05555 | Bebas Neue / Syne / Space Mono → Impact / system-ui / Courier New | 6 px radius, mono labels | DEFAULT |
| NIGHTFALL | umber #0e0b09, card #1e1814, parchment #d8cfba / #8f8577 / #5d564b | lantern #c78b3c, blood #a62c2b, grace #d4af6a, spectral #7c93a8, moon #b7c4b0 | Cinzel / IM Fell English / Space Mono → Georgia / Georgia / Courier New | 3 px radius, ✦ markers, fog, vignette, grain | NIGHTFALL |

Four themes declare fonts that are not vendored, so they render in fallbacks and look broken. `?selftest=1` mounts 15 realms × 7 themes = 105 combinations; each theme you keep multiplies test and design cost.

### 8.4 Label registers (`src/lexicon/lexicons.js`; `LX(key)` → default → the key itself)

| Realm id | PLAIN (NEXUS/DAYLIGHT) | DEFAULT (game) | NIGHTFALL |
|---|---|---|---|
| roundtable | HOME | BASE | ROUNDTABLE |
| forge | PROJECTS | PRODUCTS | THE FORGE |
| hunts | TASKS | QUESTS | HUNTS |
| grimoire | AUTOMATIONS | SPELLBOOK | GRIMOIRE |
| lands | MAP | MAP | LANDS BETWEEN |
| legacy | HISTORY | STATS | LEGACY |
| medbay | SYSTEM | MED-BAY | THE WARD |
| observatory | NOTES | OBSERVATORY | OBSERVATORY |
| watchtower | SCREEN TIME | WATCHTOWER | THE SPIRE |
| summoning | ASSISTANT | SUMMONING | THE CIRCLE |
| oracle | ORACLE | ORACLE | THE ORACLE |
| chronicle | TIMELINE | CHRONICLE | THE CHRONICLE |
| conjure | CANVAS | CONJURE | THE CONJURING |
| social | SOCIAL | SOCIAL | THE HERALD |
| studio | STUDIO (literal everywhere) | STUDIO | STUDIO |

| Chrome word | PLAIN | DEFAULT | NIGHTFALL |
|---|---|---|---|
| focus chip | ◎ FOCUS | ◎ FOCUS | ◎ THE HUNT |
| scrubber | SNAPSHOTS | STAGE SELECT | MEMORY OF GRACE |
| health | HEALTH | HP | VIT |
| streak | STREAK | STREAK | EMBER |
| XP | XP | XP | RUNES |
| ambient machine / risk / next / agent | MACHINE / TOP RISK / DO NOW / ASSISTANT | MACHINE / SIDE-QUEST / DO NOW / CLAUDE | THE VESSEL / WHISPER / THE OMEN / FAMILIAR |

PLAIN tier names: "Critical — loss & breakage", "Important — before production", "Housekeeping". Other PLAIN section names: "Today — pick one", "Overview", "Changes since", "Weekly recap", "WORKING ON NOW", "Projects", "Automations", "Agents", "Ideas & risks", "Milestones", "Storage", "Project map", "Consistency" / "active days". Voice packs (`lexicon/voice/*.json`) appear only on the takeover: `default` (internet slang, also used by NEXUS/DAYLIGHT) and `nightfall` (gothic). The register follows the theme; it can't be chosen separately.

### 8.5 Fonts, icons and libraries available offline

- **Fonts shipped** (woff2 + @font-face; nothing else can load under the CSP):
  - `dashboard-v3/styles/fonts/`: **Inter** 400 + 600 only (no 500/700, no italic files: bold rounds to 600, italic is synthesized) · **DM Serif Display** Regular · **JetBrains Mono** 400 only.
  - `dashboard/vendor/fonts/` (v2): **Press Start 2P**, **VT323**.
  - Anything else must be added as a local woff2 (OFL or similar) + @font-face.
- **Icons:** `dashboard-v3/icons/hq-icons.svg`, one hand-authored sprite of 30 `<symbol>`s on a 24×24 grid, `stroke: currentColor`, stroke-width 1.5, round caps; `.f`/`.fw` fills at reduced opacity; `.accent` hard-coded #f5a623. Injected at boot (`ui/icons.js`: `injectIconSprite`, `icon(name,{size})`, `hasIcon`); preview at `icons/preview.html`.
  - Realms (17): `i-realm-roundtable` (round table), `forge` (hammer/anvil), `hunts` (target + arrow), `warroom` (retired), `grimoire` (book + ribbon), `lands` (hex tiles), `legacy` (trophy), `medbay` (heartbeat + cross), `observatory` (telescope), `watchtower` (tower + beam), `oracle` (crystal orb), `summoning` (rune circle), `chronicle` (timeline), `atlas` (retired), `conjure` (palette + brush), `social` (two bubbles), `studio` (camera + crosshair).
  - Verbs (10): `i-verb-snip`, `record`, `focus`, `send-claude` (paper plane), `idea`, `run`, `done`, `open`, `dispatch` (rocket), `kill`.
  - Brand (3): `i-brand-wordmark`, `i-brand-app` (nested hexagons + amber hub; favicon source), `i-brand-level-coin` (hex ring around a number).
  - **Gaps filled with unicode/emoji today:** settings, search, close, chevrons, sort/filter, clock/snapshot, warning/info/success, theme, sound, export, back, external. Unicode in use: ◈ ◎ ▸ ▾ ◀ ▶ ⏎ ✕ ✦ ■ ● ♪ < >. Rail fallbacks are emoji. Trophies and the HUD logo/flame are 16×16 pixel-art SVGs.
- **Vendored JS:** three.js 0.160 and anime.js 3.2.2 (712 KB, unused since WAR ROOM retired).

### 8.6 Motion today (NEXUS/DAYLIGHT)
`nx-rise` 0.34 s cubic-bezier(.22,1,.36,1) on realm mount · `nx-pulse` 1.8 s on live dots only · −1 px hover lift on cards · a "breathing" nav glow was removed as too much · accent budget (v2 declutter): at most one glowing frame and one blinking element per viewport · `prefers-reduced-motion` honoured everywhere.

### 8.7 Shared primitives (scattered today; design each once)

- **Shell:** rail item (icon + label + count badge; active/hover) · FOCUS entry · header (brand, context, level coin + XP bar, health, streak, settings) · snapshot control (collapsed / expanded, latest vs past, back to live, delta line) · ambient sections · status/freshness line with key hints.
- **Content:** section heading (+ fold variant with chevron + one-line summary) · project card (status seam, %, bar, tags) · stat tile and key-value list · decision card ("do this now") · task row (tier, age, project, verbs) · idea/risk row (kind chip) · chart card + legend + tooltip · milestone tile (locked / unlocked / progress) · list row · pill/tag (neutral / success / warning / danger / info) · progress bar · empty sentence · **estimate marker**.
- **Overlays:** right drawer / project page (sticky header, sticky action bar with primary + secondary + overflow, folded sections, metric grid) · command palette (input, rows with icon/label/hint/kind, footer) · confirm modal with command preview · runs/log console · focus overlay · level-up / milestone moment · toast (planned, not built).
- **AI-surface kit:** chat bubble + grounded-in footer, session card with live output, canvas widget set (§4.13).

### 8.8 Principles any new UI must keep
*Sources: the ambient-companion spec (2026-06-20), the v4 design constitution (2026-08-19), the v3 program invariants, HANDOFF honesty rules.*

1. **Zero obligation, full invitation.** Nothing ever requires the user. The board is "always already tidy on arrival": no grooming, no chores, no mark-done-to-stay-correct; no countdowns, no loss-on-miss, mercy everywhere; time awareness is never pressure; every addition invites, none nags.
2. **Never bluff: estimates are visibly marked.** Soft fields look different from measured ones and are barred from ambient surfaces (HUD, ambient rail, mini HUD, tray tooltip, notifications, voice lines). Soft: completion %, health index, streak (scanner days), build/test status, insights/suggestions/roadmap, LLM side-quests. The only marker today (`~`/"(est.)" on HOME's avg completion) never fires. Needed: a first-class **estimate style** (e.g. `~` prefix + muted/dotted treatment + "estimate" tooltip) and a **"based on N scans"** line wherever a trend is projected.
3. **Honest joy.** Keep XP, levels, streaks, milestones and a celebration, but celebrate only measured, earned events.
4. **Notification contract.** Notify only when a change is measured + actionable + new; at most one per scan; good news and estimates never notify.
5. **Model-output boundary.** LLM text only on visibly-AI surfaces (ORACLE, ASSISTANT output, CANVAS, the commit draft the user edits); never on instrument surfaces (HUD, ambient rail, badges, notifications, tray, mini HUD). HOME's "do this now" and the ambient DO NOW are deterministic (`derive.oracle()`): give them a different name and look from the ORACLE chat.
6. **No dead or lying controls.** A control does a real action or is disabled with a reason; async effects say what is happening.
7. **Plain words by default.** Game flavour is opt-in. RPG/fantasy prose in default copy was rejected as "corny".
8. **Social safety.** App and MCP only stage; nothing sends without a human Approve & Send in the extension.
9. **Constitution rules (the best written taste guide):**
   - *Type:* body is mixed-case sans; ALL-CAPS + mono is a label register only; one display level per screen; nothing below 12 px; line-height ≥1.45.
   - *Space:* text capped at 880 px; sections 32–48 px apart; at most 3 stat tiles per row (more → key-value list).
   - *Chrome:* borders only on interactive or severity elements; severity owns colour; glow is seasoning, not a default.
   - *Hierarchy:* one focal element per surface; empty states are one calm sentence.
   - *Familiarity:* concrete rail nouns the owner knows (HOME, TASKS, PROJECTS, SYSTEM, NOTES, AUTOMATIONS, HISTORY…); HOME is the default and greets with a decision; **never merge two places the user navigates to separately without keeping both names reachable**.
   - *Motion:* only on real state changes; reduced motion kills all of it.

### 8.9 UI history: every attempt and why it failed

| # | When | Attempt | What it looked like | Owner's documented verdict | Lesson |
|---|---|---|---|---|---|
| 1 | Jun–early Jul 2026 | **v1/v2 "ARCADE"** (`dashboard/`, 5–7 tabs) | NES/CRT pixel RPG: Press Start 2P + VT323, neon on violet-black, scanlines, PRESS START, XP/HP/streak HUD, coin-spin quests, confetti, chiptune; plus OKAMI, NUMIDEA, OPS | The "ick": "vanity metrics / theater", "the thing you tend instead of working", "doesn't actually know anything true", fear of becoming "project #41 — abandoned"; later "two fighting pixel fonts that made the UI unreadable", 7 px labels | Joy must be earned and honest. A 2026-07-06 declutter added one decision per screen, 7→5 tabs, folded detail, accent budget, SYS menu |
| 2 | 2026-07-11 | **NIGHTFALL** theme + canon lexicon | FromSoftware gothic: Hunts, Runes, Vitality, Ember, Whispers, Cinzel/IM Fell, fog, tide | Within two weeks: "the dark-fantasy RPG labels read as corny" | Fantasy prose in default copy is out; flavour only in an opt-in theme |
| 3 | 2026-07-22/23 | **NEXUS v3 "CINEMATIC"** (`dashboard-v3/`, realm rail + ambient rail + scrubber, 6→16 realms) | "dark-fantasy AAA game-menu skin": obsidian + parchment + molten gold, DM Serif titles, ember glow, vignette, breathing nav | Replaced the next day: labels "corny" → PLAIN register; 2026-07-24 "UI overhaul — clean/professional" (gold pulled back, serif dropped, static nav, DAYLIGHT added, legacy themes hidden). A teardown found "feels built wrong": 16 gap values, 32 font sizes, tiny targets → `tokens.css` | Clean beat cinematic, but see #4 |
| 4 | 2026-08-03 → 09-05 | **v4 "THE HARNESS"** (`dashboard-v4/`, on disk, unused) | Diagnosis of v3: "a **vanity interface**: it looks at your work and never does any"; visuals "generic (anonymous dark panels), monotonous (same card in the same grid), static, typographically flat". Rebuilt as 6 abstract surfaces (WORK · PROJECTS · SYSTEM · MIND · AUTOMATE · LOOKBACK), violet "System HUD" look (Solo Leveling inspired), in-app agent harness, one unified queue | v4.0: "**it looks like you killed it**" (game layer stripped, 5 placeholders). After v4.1 refilled it: "**Too crowded**" (boxes edge to edge, borders on everything), "**Messy**" (ALL-CAPS mono shouting), "**You removed everything**" (abstract names erased his mental map). v4.3: legacy features missing (map, threat board, focus mode); only HOME got the approved look | Consolidation and renaming feel like loss; density and outlines feel like mess. **The one approved exemplar: v4.2 HOME** (one focal decision card, today-pick-one, momentum strip, ≤2 accents, no outlined passive boxes, 48 px section gaps) |
| 5 | 2026-09-09 → now | **Back to v3 NEXUS** (`data/.ui-version` = v3) | Added STUDIO, the icon sprite, ORACLE. 2026-09-15 dead-weight audit retired WAR ROOM, ATLAS, brain-dump capture box and positive toasts | Pivot reason not written down. Today: "the interface is genuinely shit" | The new design must hold all of the above at once |

**The cycle to break:** game-flavoured ("corny") → plain-professional ("generic, vanity") → consolidated-abstract ("you killed it / removed everything") → refilled ("too crowded / messy"). The target is **soul without corniness, clarity without generic emptiness, every feature reachable under familiar names, and no crowding.**

### 8.10 Problems with the current design system (summary)

- Lying token names; no radius/shadow/motion tokens; 24 `!important`.
- Arcade palette hard-coded in JS and markup bleeds into clean themes: `COL` in `ui/util.js` (#ff4757 / #3aff6e / #00f0ff / #ffd23f…) colours charts, bars, severities and category chips; 12 pixel-art trophy icons (`PX`); HUD pixel logo and flame; sparkline stroke #322a5e; takeover card #14102b; export card; sprite `.accent` #f5a623; CANVAS deltas; MAP ground #0e0b22; HISTORY gridlines #1d1840.
- Arcade leftovers in the plain themes: "● INSERT COIN", "◈ SYS", "STAGE SELECT", "⏎ BACK TO LIVE", LV chip + rank, confetti, slang voice lines ("massive W", "chat, we got cooked", "touch grass, Warden"), "products" vs PROJECTS.
- The 12 px floor is broken in NEXUS chrome: rail labels 8.5 px caps, LV caption 8 px, badges and menu labels 9 px, ambient headers 9.5 px, tags/pills 10.5 px `!important`; ~20 raw px sizes remain; realm pages use 16–17 distinct sizes.
- No global read-only (past snapshot) visual mode; no estimate style; pre-paint `#0d1117` matches no theme.
- Dead assets: NIGHTFALL "night-tide" class never set; three.js + anime.js unused; retired sprite icons; DM Serif used twice; fx.css duplicates chrome.css.
- Rail density: 15 realms + FOCUS in 84 px with 8.5 px labels.
- Satellite windows (mini HUD, quick-run palette, summon palette, shards, record panel, snip overlay, extension popup) each have their own hard-coded look.

---

## 9. Non-negotiables for the new design

**Honesty**
1. **Honesty boundary.** ORACLE's answers stay in ORACLE. More broadly, model-written text appears only on visibly-AI, labelled surfaces (ORACLE chat, ASSISTANT session output, CANVAS widgets, the commit-message draft, and LLM-sourced content marked "✦ AI"). It never appears on instrument surfaces: header/HUD, ambient rail, rail badges, notifications/toasts, tray, mini HUD, celebration voice lines.
2. **Estimates visibly marked.** Every (est.) field in §6 (completion %, health index, build, tests passing, insights, suggestions, roadmap, security flags, LLM side-quests, weekly narrative, summed browser time, automation categories) gets one consistent estimate style. Trend projections carry "based on N scans". Carried-forward values can show their age.
3. **Deterministic is not AI.** HOME's next action / ambient DO NOW come from fixed rules; name and style them differently from the ORACLE chat.
4. **No lying controls.** Every control either does what its label says or is disabled with a stated reason. Async verbs say what happened ("Terminal opened", never "Done").

**Tone and obligation**
5. **Zero obligation, no nagging.** No countdowns, loss-on-miss, guilt copy or chores to keep data correct. Notifications only for measured + actionable + new events.
6. **Plain words by default**; game flavour quiet, earned and optional. Keep level, XP, milestones and a level-up moment.
7. **Familiar names stay reachable.** Never merge two places the owner navigates to separately without keeping both names findable (rail, palette or tab).

**Interaction**
8. **Keyboard-first.** Ctrl/Cmd+K and `/` open the palette; 1–9 reach the top destinations; F toggles focus; Esc closes the top overlay; ←/→ scrub snapshots; typing in a field never triggers a hotkey; a "?" cheat sheet. Global OS hotkeys Ctrl+Alt+G / X / S / R / L and Ctrl+Alt+Shift+S / R are taken (Ctrl+Alt+Space retired).
9. **Every existing action has a home.** Each row of §7 (225 controls) and §7b (engine capabilities) maps to a place in the new design, or is cut by an explicit owner decision recorded in §11.
10. **Destructive verbs confirm** (archive, purge, delete capture, bulk push, kill all servers) with Cancel as the default; Claude-quota verbs are labelled as such; anything that opens a terminal or external window says so.
11. **Automation safety:** the UI sends only an id; the exact command line + folder is shown before a first, changed or always-ask run; invalid items and plugins/agents can't run; running items are cancellable.
12. **Social write gate:** nothing publishes except a human Approve & Send in the browser extension. Showing the full payload before that click is required wherever the gate lives.
13. **Untrusted text** (session output, model answers, canvas specs, social posts, file names, page titles) renders as text only; model text only through the limited markdown renderer.

**Modes every screen must support**
14. **Past snapshot = global read-only mode**: unmistakable, with one-click "Back to live"; every write verb disabled or labelled "acts on live data".
15. **No preload (dev harness / selftest)**: `window.hq` missing → controls disabled with a reason; the screen still renders from bundle data.
16. **Reload-safe**: the window reloads after most writes; no precious unsaved in-memory state; restore the user's place (screen, snapshot, and ideally scroll/selection) from sessionStorage; design a refresh transition.
17. **Empty-first**: design empty and near-empty states as the default case (0 open tasks, 0 social data, ~16 automation runs ever).

**Platform**
18. **Offline under CSP** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. No CDN fonts, icons, scripts or images; no inline `<script>` or `onclick=""`; no `eval`; inline `style=""` is fine.
19. **Vendored fonts only:** Inter 400/600, JetBrains Mono 400, DM Serif Display (others must be added as local woff2 with a permissive licence).
20. **Electron 32 / Chromium 128 over `file://`**, vanilla ES modules, no framework, no build step. Modern CSS is fine (nesting, `:has()`, container queries, `color-mix()`, `@layer`, subgrid, popover, anchor positioning, same-document View Transitions, `text-wrap: balance`).
21. **Minimum window 1180×820** (the native frame makes the client area slightly smaller); everything must work there with no horizontal scroll, and scale up gracefully.
22. **One dark theme + its light twin**, all colours as CSS custom properties; `data-theme` on `<html>` stays the switch; themes remap tokens only.
23. **Accessibility floor:** 12 px minimum text, 32 px minimum hit targets, visible focus, `aria-current` on the active destination, real buttons (not clickable divs), `prefers-reduced-motion` respected.
24. **Public repo:** mock content uses placeholders only (no real project names, people, URLs or paths).

---

## 10. Consolidation opportunities (options, not decisions)

The readers proposed these merges and cuts. **The owner decides in design.** Remember the history (§8.9): merging and renaming previously felt like "you removed everything", and refilling felt "too crowded". Every option below keeps every action reachable (§9 rule 9) and keeps familiar names findable (§9 rule 7).

### 10.1 Navigation: 15 flat destinations → fewer

| Option | Shape | Gains | Costs / risks |
|---|---|---|---|
| **A. Grouped rail, all 15 kept** | Same 15 names under 4 headings, e.g. *Work* (Home, Projects, Tasks, Map) · *Automate* (Automations, Assistant, Oracle, Canvas) · *Life* (Screen time, Social, Notes, Studio) · *System* (System, History, Timeline) | Zero loss of names; easy to wire (ids unchanged); fixes the "15 flat items" complaint | Still 15 stops; rail height at 820 px; digits only reach 9 |
| **B. 7 primary + "More"** | Primary: Home, Projects, Tasks, Automations, Assistant, History, System; "More": Notes, Screen time, Social, Studio, Canvas, Oracle, Map, Timeline | Calm rail; digits 1–7 stable | Items under "More" feel demoted; risk of "you removed everything" |
| **C. Merge to ~9 destinations with tabs inside** | Home · Projects (Grid / Map / Archived) · Tasks · Automations (Runnable / Library) · Claude (Sessions / Canvas) · Ask (ORACLE) · History (Trends / Timeline / Milestones) · System (Machine / Workspace clutter) · Life (Screen time / Social / Notes) + Studio | Biggest clarity gain; kills most duplication | Renaming risk; old names must survive as tab labels and palette aliases; more wiring (tab state, deep links) |

Whichever you pick: red badges only for "needs you" (TASKS open count, SYSTEM critical, ASSISTANT running, SOCIAL staged posts); informational counts neutral or dropped. FOCUS moves out of the nav to the header.

### 10.2 Shell chrome

| Option | Gains | Costs / risks |
|---|---|---|
| **One header row** merging the HUD, the SNAPSHOTS head and the status bar (brand · viewed date chip → popover with sparkline/calendar/"what changed" · level + XP · scan state "Last scan 09:30 · Scan now" · activity indicator · settings) | Reclaims ~2 bands of height; one place for freshness and scan state | The expanded dot track moves into a popover or the history surface |
| **Ambient rail: keep, with every row deep-linked** | Peripheral awareness on every screen | Costs 200–264 px of width on every screen; must re-render without destroying hover |
| **Ambient rail: fold into the header** (DO NOW + vitals as chips; now-playing in SCREEN TIME) | Full-width content | Less peripheral glanceability |
| **Ambient rail: drop** | Simplest | Loses "what am I doing" and live vitals unless placed elsewhere |
| **One activity / runs panel** for scans, automation runs, Claude sessions, recordings, dev servers, captures and notifications | Gives every long job a home; replaces the run log, native dialogs and silent failures | New component; needs some new IPC for dev-server listing and history |
| **A real Settings surface** (appearance, sound, ambient rail, notifications, hotkeys + status, capture settings, export card, optional flavour) | Replaces "◈ SYS" and unreachable prefs | Small new wiring for hotkey status and capture settings |

### 10.3 HOME and "what next"

| Option | Gains | Costs / risks |
|---|---|---|
| **One Next-action module** (1 primary + up to 2 alternates, inline Focus / Done / Open), fed by a single ranker | Ends the three-ranker conflict and the duplicate task | Engineering must pick or merge one ranker (`daily_top3`, `derive.oracle`, `computeOneThing`) |
| **Worst-first portfolio list open by default**; KPIs inline in its header | Most useful portfolio view becomes visible | Overlaps PROJECTS unless PROJECTS leads with something else |
| Move momentum to the header / history; recap to a dismissible weekly card; suggested automation to a small slot | Calmer HOME | Owner liked the v4.2 momentum strip: keep one small trend if so |

### 10.4 Projects, Map and the project page

| Option | Gains | Costs / risks |
|---|---|---|
| **MAP becomes a view mode of PROJECTS** (Grid / Map), with a deliberate sort and hover card | One project list; keeps the most distinctive visual | Map loses its own rail slot (keep "Map" as a palette alias) |
| **Archived filter in PROJECTS with Restore** next to Archive | Inverse actions together | — |
| **Dissolve MAP "Storage"**: vaults → NOTES; clones, duplicates, empty, trivial, anomalies → SYSTEM; learnings → NOTES or history | Each card in its natural home | Several surfaces change at once |
| **Drawer → full project page** (wide panel or route) with header, primary verbs, one "Next" list, one journal, diagnostics tabs | Highest-value surface done properly; one expand model | Route state must survive reloads; the inline card detail can go |

### 10.5 Tasks

| Option | Gains | Costs / risks |
|---|---|---|
| One ranked list with tier badges (+ group by project) instead of 3–4 equal columns | A clear "do this first" | Loses the at-a-glance tier split (could keep as filter chips) |
| Ideas & risks as a segment, or inside each project page | Board stays about measured tasks | Global idea view needs a home (segment or filter) |
| Show duplicate concerns once (task + identical urgent idea) | Less noise | Needs a dedupe rule (renderer or collector) |

### 10.6 History and Timeline

| Option | Gains | Costs / risks |
|---|---|---|
| **One "History" surface: Trends · Timeline · Milestones** (absorbs HISTORY, TIMELINE, the expanded snapshot track, HOME momentum/changes/recap) | Ends five renderings of the same two numbers; one recap | Two familiar names become tabs (keep both as palette aliases) |
| Weekly recap becomes the week-group header in Timeline | One recap, time-consistent with the scrubber | HOME loses its recap card |
| Cut Account XP chart + Peak XP record; small multiples instead of the spaghetti chart | Fewer, better charts | — |

### 10.7 AI surfaces (where ORACLE, ASSISTANT and CANVAS live)

| Option | Gains | Costs / risks |
|---|---|---|
| **ORACLE stays a realm** | Clear, contained honesty boundary | Hard to find; another rail slot |
| **ORACLE as a mode of the command bar** ("Ask" tab in Ctrl+K, answers in a panel) | Reachable from anywhere; fewer destinations | Model text must still never leak into instrument surfaces; answers need a stable panel (not a transient popup) to survive reloads and show provenance; it answers about **today**, not the viewed snapshot |
| **ORACLE as a right-side panel available everywhere** | Ask while looking at a screen | Same honesty and time-machine caveats; competes with the ambient rail for width |
| **"Claude" destination = Sessions + Canvas (Feed / Board)**; ASSISTANT's whiteboard moves to CANVAS; every "Send Claude" / ⚡ opens Sessions pre-filled | One agent console; ends the four-things-called-Canvas problem | Needs the existing (unused) session engine wired; ORACLE is a *local* model, so don't blur it with Claude (cloud) in one place unless clearly labelled |
| Rename HOME's deterministic "Oracle" card to something like "Next action" | Removes the name collision | Internal ids can stay |

### 10.8 System, Notes, Screen time, Social, Studio

| Option | Gains | Costs / risks |
|---|---|---|
| SYSTEM: verdict header + issue-with-fix rows; healthy vitals as chips; "Workspace clutter" as a separate tab; AI runtime status in Settings / a shared AI indicator | Problem and fix together; one clock per tab | Body-map metaphor goes |
| NOTES grows into **"Knowledge"** (vault vitality, learnings, decisions, project notes, Obsidian sync activity, open/search in Obsidian) | Gives learnings and sync a home | Opening `obsidian://` and sync status need engineering asks |
| A **"Signals" / "Life"** destination with tabs Screen time · Social · Notes | Three low-traffic pages become one | SOCIAL's approval queue still needs a HOME/badge entry |
| SOCIAL: slim realm + HOME widget ("2 posts awaiting approval · 5 new mentions") | The approval queue becomes visible | Approval itself stays in the extension (write gate) |
| SCREEN TIME: Today / This week header with range toggle; live "now" moves here | Answers the natural questions | Totals stay "approx." until the struct-lane fix |
| STUDIO: one gallery with filters and day headers; latest-capture hero; lightbox | Simpler, faster | RENAME stays hidden until an IPC exists |

### 10.9 Satellites

| Option | Gains | Costs / risks |
|---|---|---|
| Mini HUD + vitals shard + tray tooltip = one **ambient status** design (measured values only) | One companion, consistent | Owner currently has the HUD hidden |
| Quick-run palette = the app's command bar in "run" mode (same tokens, same confirm) | One palette language | Separate window remains (it must work with the app hidden) |
| **Shards: keep as a pillar** (manager, live data, one frame) **or cut** | Keep: distinctive desktop presence. Cut: removes an unused second notes system | Effectively unused today (0 saved shards) |
| Record panel Setup / Live modes; snip post-capture action bar | Usable capture | Needs small main-side changes (resize per mode; split select from save) |

### 10.10 Game layer and themes

| Option | Gains | Costs / risks |
|---|---|---|
| Quiet game layer: level + XP + milestones + level-up moment; health and streak removed from the header (or marked est. / replaced by measured signals) | Honest HUD; keeps "soul" | Stripping too much got "it looks like you killed it" |
| **2 themes (dark + light, optional follow-OS)**; delete the 5 hidden themes or rebuild them as opt-in "flavor" packs with vendored fonts | Halves test cost; honest menu | Loses unreachable flavour (already unreachable) |
| Owner's "System HUD" North Star (Solo Leveling inspired) as a restrained accent language (e.g. the isometric map, level coin) rather than a skin | Distinctive without corniness | Easy to overdo; v4's violet skin is documented as too much |

---

## 11. Open design questions (answer while designing)

- [ ] **Navigation shape:** grouped 15 (A), 7 + More (B), or ~9 with tabs (C)? Which items get digits 1–9?
- [ ] **Ambient rail:** keep with deep links, fold into the header, or drop?
- [ ] **Where does ORACLE live:** realm, command-bar mode, or global side panel? Should it answer about the viewed snapshot or always today (today is what main does now)?
- [ ] **Claude surfaces:** one "Claude" destination (Sessions + Canvas)? Is "Run in app" (tracked) the primary Claude verb everywhere, with "Open in terminal" secondary?
- [ ] **Project page:** wide drawer or full route? Does the inline card detail survive?
- [ ] **HOME:** one Next-action module fed by one ranker? Keep a small momentum trend (the v4.2 exemplar had one)?
- [ ] **History:** merge HISTORY + TIMELINE (+ snapshot track) into one surface with tabs?
- [ ] **Health and streak in the header:** keep marked as estimates, replace with measured signals (uncommitted files, unpushed repos, secrets), or remove?
- [ ] **Game layer volume:** which rewards stay (level, XP, milestones, level-up moment, stat card, sound)? Confetti or a quieter moment?
- [ ] **Shards:** keep as a pillar (with a manager) or cut?
- [ ] **Satellites:** should the mini HUD, quick-run palette, recorder, snip overlay and extension popup share the app's theme? (Recommended: yes.)
- [ ] **Social approval:** stays in the extension (current write gate) or moves in-app (requires a CONTRACT.md security review; the send still runs in the browser)?
- [ ] **Themes:** exactly dark + light? Follow the OS? Any opt-in flavour pack?
- [ ] **Accent colour:** keep NEXUS amber / DAYLIGHT blue, or choose a new single accent?
- [ ] **Past-snapshot treatment:** tint, banner, desaturation, or a header state? How do sidecar-backed panels (PC health, automations, social, studio, canvas) say "this is live, not historical"?
- [ ] **Activity panel:** one place for scans, runs, sessions, recordings, dev servers and notifications? Where does it open from?
- [ ] **Cuts to confirm:** boot splash, status bar, RENAME (until an IPC exists), body-map metaphor, joke lines, Account XP chart, Peak XP record, NotebookLM leftovers, rarity, the 5 hidden themes.
- [ ] **Confirm the suspected bugs before designing around them:** recordings saved empty (§5.9), `window.prompt` flows dead (§3.10), past-mode reopen after scans (§3.1). (pc-health scheduling is settled: it runs in every scan, §5.13.)

### 11.1 Deliberate cuts (v5 clean pass, 2026-10-05)

The owner kept the daily-use controls and cut the rest on purpose. Each cut below is something the Claude Design build (or this brief) shows that v5 does not do, with the reason. v3 stays on disk as the rollback (`data/.ui-version` = `v3`).

- **Canvas pin / remove:** boards are append-only. Main has only `hq.canvasAdd` (v5's ＋ Note), and pin / remove / clear / create-board need new IPC plus an MCP mirror (§4.13, §12.6).
- **Vault open / search:** the renderer can't open `obsidian://` links; that needs a scheme-restricted `openExternal` IPC (§12.6). v3's copy-a-search-link workaround wasn't carried over. Vault content still reaches Ask as an opt-in source.
- **Stat-card export:** v3's PNG came from `fx.js`'s takeover canvas, and porting it needs a renderer-side image builder plus a save path. It isn't daily use, so Settings and the level-up card say "not wired in this version yet".
- **Per-file staging:** `do-commit` stages everything (`git add -A`) after main's `.env` guard has checked the whole change set (`hq.commitPreview`). Ticking files would need a staging IPC and a second guard path, so the commit sheet lists every file it will commit.
- **Add-project channel:** tracking a project means writing `collector/collector.config.json` (struct lane), and no channel does that. Onboarding prepares and copies the config entry for you to paste.
- **Local idea dismiss:** side quests have no `dismissed` write path (§6.6, struct lane). v5's Hide is per-PC only (`whq3-prefs`) and says so ("the scan still tracks it"); v3, the mini HUD and the tray still show the idea.
- **Notifications toggle:** nothing reads it. OS notifications are main's (§5.12), and the in-app router has no caller (§7b), so the switch was removed in Phase 2.
- **Region recording:** the recorder captures a whole display or window. Cropping to a region needs a crop step in `dashboard/screen-capture.js` (owner decision: deferred).
- **Shard grid-snap / hide over full-screen apps:** both need main-side window management for every shard window (owner decision: deferred). Shards still float on top as before (§5.5).
- **Settings › Shards:** there's no shard manager IPC (list, hide or close all), so Settings has no Shards section (owner decision: deferred).
- **Extension "today" summary / edit:** a summary needs a new bridge HTTP route. Editing a staged post in the popup would change what was reviewed (CONTRACT.md write gate: approve or skip only). The popup keeps the connection state and the one-at-a-time approval card (owner decision: deferred).
- **30-minute recording continuation:** main stops a recording at the 30-minute limit and keeps the file. Continuing in a new file needs a chained recorder, so the panel says it stops, not "auto-split" (§5.9).
- **Hotkey registration status:** main only logs a failed `globalShortcut` registration to its console (§5.11). Settings › Global hotkeys lists the keys with no ok / conflict mark until a status channel exists.

**Contract note (Phase 2 C-1, narrowed in review):** Enter in the run confirm never confirms on a focused button or on a key auto-repeat. On a focused button, Enter does that button's own action, so Enter on Cancel cancels. A held-down Enter can't run an automation. Enter while typing in a field doesn't confirm either.

---

## 12. How the prototype will be wired back

### 12.1 The integration contract (what the engineer plugs the design into)

**Realms.** Each destination is a module pair under `dashboard-v3/src/realms/<id>/`:
- `manifest.js`: `{ id, order, lexKey, sigil, badge(data), enabled(data) }`. `badge` returns a number or null (null hides it). `order` sets rail position (ORACLE uses 10.5).
- `view.js`: `mount(stage, ctx)` and `unmount()`. Exactly one realm is mounted at a time into `#stage`. `ctx = { data, bus, LX, theme, hq }`.
- A theme switch **force-remounts** the active realm; snapshot changes arrive as bus `data:select` and the realm re-renders. Anything created in `mount` (listeners, timers, intervals, observers, subscriptions) must be torn down in `unmount`, which can be called at any moment.
- Realm ids (`roundtable`, `forge`, `hunts`, `grimoire`, `lands`, `legacy`, `medbay`, `observatory`, `watchtower`, `summoning`, `oracle`, `chronicle`, `conjure`, `social`, `studio`) are wiring keys. If destinations merge, the engineer maps new screens onto these ids (or registers new ones); labels come from `LX(key)`.

**Data.** Read-only from `window.DATA` via `ctx.data`: render `ctx.data.selected` (not `latest`), respect `ctx.data.isLatest`, read sidecars from `ctx.data.bundle`. The renderer never fetches. Field names and provenance are in §6; design components with those names in mind.

**Actions.** Two paths only:
- `window.hq.*` (the preload bridge; every call listed in §7 with its IPC channel). Always feature-detect: in the dev harness `window.hq` is undefined (its preload exposes only `window.hqv3`).
- `core/actions.mjs` `dispatch(id, payload, ctx)` for shared verbs: `go:<realmId>`, `scan:now`, `capture:note`, `claude:dispatch`, `quest:done`, `cast`. `all()` lists the registry (built for the command palette; unused today). Note: `dispatch('cast')` ignores `confirm_required`, so any new caller must route through the Run confirm.

**Push subscriptions.** Realm-scoped subscriptions (`hq.onDevStatus`, `hq.onCanvas`, `hq.llm.onDelta`, `hq.studio.onCaptureAdded`, polls) are opened in `mount` and **must be released in `unmount`**: every `hq.on*` / `hq.llm.onDelta` / `hq.studio.recStatus` / `hq.studio.on*` helper in `dashboard/preload.js` returns an unsubscribe function, and `unmount()` must call it. Polls and timers are cleared the same way. App-lifetime subscriptions stay in the shell: Claude sessions (`boot.js`), run output (`fx.js`), machine vitals and browser tab (`ambient.js`).

**Bus events** (the only cross-module channel; realms never import each other): `realm:switched`, `data:select`, `theme:changed`, `focus:toggle`, `fx:export-card`, `fx:sfx-toggle`. New global components (toasts, activity panel, settings) should talk over the bus too.

**Reloads.** Main calls `win.reload()` after most writes. Only sessionStorage survives (`hq-active-realm`, `hq-scan-idx`, `hq-booted`). Any UI context worth keeping (open project page, active tab, scroll, filters, drafts) must be written to sessionStorage and restored on mount.

**Safety in rendering.** Every scan or session string goes through `esc()` (or `textContent`). Model text renders only through `mdLite` (headings, bullets, bold). Session output, canvas specs, social posts, file names and page titles are untrusted.

### 12.2 Translation constraint (Claude Design → this codebase)

Claude Design will likely emit React and Tailwind. The engineer must translate it to **plain HTML, CSS and vanilla ES modules** loaded with relative imports over `file://`:
- No React runtime, no Tailwind CDN script, no Google Fonts `<link>`, no icon CDN (lucide etc.), no remote images.
- CSP: no inline `<script>`, no `onclick=""` attributes, no `eval`. Inline `style=""` is allowed.
- Icons become `<symbol>`s in `icons/hq-icons.svg` (24×24, `currentColor` stroke 1.5, round caps) used via `icon(name)`.
- Fonts: Inter 400/600, JetBrains Mono 400, DM Serif Display. Any other face must be supplied as a local woff2 with an OFL-style licence.

**To make translation cheap, ask Claude Design to:**
- Componentize **per destination** (one component tree per realm) plus a shared primitives set (§8.7). Name components after realm ids and §7 control names.
- Use **CSS custom properties for every colour, radius, shadow, spacing and motion value** (no hard-coded hex in components, charts or SVG), so theming stays token-driven and DAYLIGHT is a token remap.
- Keep state shallow and data-driven: props that mirror §6 field names; no client-side routing libraries; no global stores.
- Express every state as a variant (default / empty / loading / error / past-snapshot / no-preload / focus-dimmed), not as code paths.

### 12.3 Theme and shell invariants
- `data-theme` lives on `<html>`; selftest and `window.NEXUS.applyTheme` drive it. Themes remap tokens only.
- Themes never reposition `#rail-left`, `#rail-right`, `#stage-wrap` or `#topstrip` (if the new shell replaces these elements, the replacement inherits the same rule).
- Every theme defines `--active`, `--active-arrow`, `--divider`, `--mono` (alias new semantic tokens onto these during wiring so 15 existing realm sheets keep working until rewritten).
- Set the main window pre-paint background (`#0d1117` today in `main.js`) to the new dark page token.
- `?selftest=1` mounts every realm × theme: keep the theme count small.

### 12.4 Program invariants the wiring must respect
- Data contract changes are **additive-only** (`docs/sync/CONTRACT.md` entry first; golden tests in `collector/lib/__fixtures__` enforce it). A v2 rollback stays one flip away (`data/.ui-version`).
- New IPC channels are added to `docs/sync/IPC-CONTRACT.md` before code. New main-process features go in **new files**, not `main.js`.
- Economy changes (XP, levels, achievements) are structure-lane asks with a CONTRACT entry and a golden re-baseline.
- Directory ownership: the renderer (`dashboard/`, `dashboard-v3/`, `browser-bridge/`) is the frontend lane; `collector/`, `schema/`, pipeline scripts are the structure lane.

### 12.5 What the engineer needs from Claude Design

| Deliverable | Detail |
|---|---|
| **Screen list with mapping** | Each prototype screen/tab → the realm id(s) it replaces → the §7 rows it hosts. Any §7 row not placed must be listed as "cut (owner decision)". |
| **Component inventory** | Every component with variants and states, named consistently (e.g. `ProjectCard`, `NextAction`, `RunConfirm`, `SessionCard`, `EstimateValue`). |
| **Token sheet** | Semantic colours (page / panel / raised / overlay surfaces; primary / secondary / tertiary text; one accent; danger / warning / success / info; **estimate** style; **past-snapshot** style; focus ring), type ramp (≥12 px), spacing, radius, shadow/elevation, z-index layers, motion durations/easings, for dark **and** light. |
| **States per screen** | default, empty, loading, error, past snapshot (read-only), no preload (disabled with reason), focus-mode dimmed, refreshing (reload transition). |
| **Empty-state and microcopy table** | Plain-language copy for every empty state, error, confirm dialog and button in §7 (replacing the RPG strings in §5.7 / §5.12). |
| **Overlay specs** | Project page, command palette (sections + commands), run confirm, runs/activity panel, toasts, focus mode, level-up moment, settings. |
| **Satellite windows** | Mini HUD (286×196 today), quick-run palette (580×442), summon palette (470×104), shard frame, record panel Setup + Live, snip overlay HUD and post-capture bar, extension popup (280 px), at their real sizes. |
| **Interaction spec** | Keyboard map (incl. "?" sheet), focus order, what each hotkey does in each mode, hover vs focus behaviours. |
| **Data viz spec** | Chart types, axes, tooltips and empty/insufficient-data states, all token-coloured (HISTORY trends, sparklines, CANVAS widget kit). |
| **Icon list** | Which sprite symbols are reused and which new symbols are needed (settings, search, close, chevrons, filter, clock, warning/info/success, theme, sound, export, back, external). |
| **Layout at 1180×820** | Frames at the minimum window plus one larger size (e.g. 1600×1000), no horizontal scroll. |

### 12.6 Engineering asks a full redesign is likely to trigger (already known)

| Ask | Why | Lane |
|---|---|---|
| Replace `window.prompt/alert/confirm` with in-app inputs and sheets | Commit edit, "I learned", "Log decision" likely dead | frontend |
| "List running dev servers" invoke channel (+ logs, port/URL) | Dev state wrong after every reload | IPC entry + new main file |
| Wire the existing session engine (`sessionStart / onSessionOutput / sessionKill / sessionDiff`) into the UI | Tracked, stoppable, diffable Claude runs | frontend |
| Favorite toggle UI (`hq.favoriteSpell`) | Engine supports it; no setter | frontend |
| Single "next action" ranker | Three rankers disagree | frontend (+ struct if collector `daily_top3` changes) |
| Fix focus wiring at boot (not on HOME mount) and minutes→seconds in the acted-on ledger | Dead F key; 0-second focus sessions | frontend / main |
| Fix the `hq-scan-idx` reopen-in-past bug | App reopens on an old snapshot | frontend |
| Capture without a full reload; non-blocking health RUN; non-blocking re-assemble | Freezes and lost context | main (new files) |
| Open `obsidian://` (scheme-restricted `openExternal`) | NOTES can't open anything | IPC + main |
| Obsidian sync status field | NOTES sync section is dead | struct (CONTRACT + golden) |
| Per-day browser deltas instead of 3-day windows | SCREEN TIME double counts | struct |
| Canvas delete / pin / clear / create board (+ MCP mirror) | CANVAS is append-only | IPC + main + MCP |
| Social "cancel staged" IPC; in-app approve only after a security review | Approval queue usability | IPC (+ CONTRACT review) |
| Studio rename IPC; recording poster thumbnails; recorder per-mode resize; snip select/save split | Studio dead ends | main (screen-capture) |
| Recording chunk-numbering fix (check live first) | Recordings may be empty | frontend / main |
| Structured citations from ORACLE context | Answers could link to screens | main |
| Scan run guard (no parallel pipelines) + progress events | Scan state component | main |
| Toast click → open the relevant surface | Toasts are dead ends | main |
| Single source for the achievement catalog | Duplicated in two files | struct + frontend |
