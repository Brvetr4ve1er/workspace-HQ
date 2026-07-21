# WORKSPACEHQ v3 — THE NEXUS
### Full app map · worldbuilding · modularity · upgrade program (stress-tested)

## Context

WorkspaceHQ graduates from gamified dashboard to **the control center of the user's
whole digital life** — every device, browser, vault, notebook, social account, PC
subsystem, and Claude session flows through one modular, RPG-hearted app. The user
supplies visual design separately; this plan owns **content, worldbuilding,
modularity, adaptability** and the build program.

Approved: **Full v3 parallel build** · Watchtower = **passive + platform APIs** ·
Phone = **cloud-synced day one** · Claude = **two-way (app-side MCP)**.
Architecture was independently stress-tested; its corrections are baked in below.

**Program invariants (law for every phase):**
1. Contract changes are **additive-only** for the whole program — v2 must keep
   rendering `latest.json` so rollback stays one flip away.
2. Economy changes = structure-lane asks, batched, each with a CONTRACT.md
   *Pending changes* entry + golden re-baseline (goldens diff behavior by design).
3. Main-process (`dashboard/main.js`, `preload.js`, `browser-bridge.js`,
   `build-data.mjs`) edits are **gated on the other session landing its
   uncommitted work**; until then, new main-side features live in NEW files
   integrated later by one-line hooks.
4. Anti-anxiety rails: no countdowns, no loss-on-miss, mercy everywhere.
5. Nothing personal leaves the machine except an **explicit allowlist** projection.

---

# PART I — THE WORLD (canon v3, extends docs/CANON.md)

**WorkspaceHQ is THE NEXUS** — a stronghold at the center of the digital world.
External systems are **Realms**; connectors are **Tendrils**; automations are
Grimoire incantations; Claude is the **Familiar-Prime**, permanently bound and
biddable; the user is the **Warden**.

Carried over: Hunts, Whispers, Insight, Runes, Vitality, Ember, Messengers,
Beckoning Bell, Seven Classes, Nightfall palette, three voice registers.

**Voice Packs** (new): internet-culture layer on the canon registers — celebration
("massive W", "locked in"), failure ("chat, we got cooked"), break nudges ("touch
grass, Warden — 3h in the mines"), ambient ("this bug living rent free"). JSON
files (`dashboard-v3/src/lexicon/voice/*.json`), keyed by event type, theme-scoped
and stackable. Never hardcoded.

---

# PART II — THE MAP (10 Realms + shell)
*(the content inventory for the user's visual-design handoff)*

## NEXUS FRAME (shell)
**Left Rail**: 10 realm sigils, badges, FOCUS at bottom. **Top Strip**: Warden
plate (LV · Runes · Vitality · Ember — the one permanent glow) + Memory of Grace
one-line scrubber + SYS. **Center Stage**: active realm. **Right Ambient Rail**
(collapsible): Working On Now live ticker, machine vitals, latest whisper, Claude
presence (sessions running), night-tide state. **Overlay layer** (core, not
realms): celebration takeover, cast log, One-Thing focus, summon palette, SFX.

## 1. ROUNDTABLE — home, the one decision
One-Thing hero card (FOCUS/DONE/⚡) · Today's 3 picks (deduped) · Spell-of-the-Day
ribbon · **While You Were Away** (nightly scan narrated as idle-game offline
progress) · folded Pulse/Changes/Saga.

## 2. THE FORGE — projects (split from home; deep work)
Products grid w/ class sigils + decay states · drawer (re-entry briefing, action
bar, folds) · per-project browser dwell ("42m in this dungeon's docs today") ·
acted-on focus-session history (ledger finally read back).

## 3. HUNTS — quest board
Tier columns (Night/Blood/Ember) + Whispers column + receipt strip · **Daily
Bounties** (3 date-hash-rotated micro-objectives from real facts — reuses the
spell-of-day hash primitive) · Raid banner (season objective) · combo meter ·
crit flashes.

## 4. GRIMOIRE — automations
Arsenal, mastery pips, collection meter, casting engine, Spirit Summons shelf ·
**Ultimates wing** (chains — finally implemented, main-slice MA) · Restoration
ward cross-list (Med-Bay spells) · shop unlock previews.

## 5. LANDS BETWEEN — world map
Isometric city + warehouse · new districts: vault buildings (Observatory), Med-Bay
ward (condition mirrors PC health), Watchtower spire (beacon = social load).

## 6. LEGACY — history
Trends · Memorials · Saga · Blessing · **Seasons panel** (6-week seasons + NG+
recap carrying relics) · Hall of Builds (stat-card gallery).

## 7. MED-BAY — PC health (NEW)
Anatomy view: organs = CPU/RAM/GPU/disks/network/startup/updates/temp-debt; each
with status (grace/ember/blood), sparkline, plain-language diagnosis + funny
teaching voice ("23 startup apps. That's not a boot, that's a parade."). **Fixes
are curated static Restoration spells** run through the EXISTING casting engine
(content-hash confirm gate requires static definitions; destructive fixes chain
`snapshotProject()` first + allowlist dirs only). Data: `collector/pc-health.mjs`
(unelevated probes: disk usage/offenders, startup apps, RAM pressure, temp debt,
latency, Update age, pagefile, battery) → `data/pc-health.json` sidecar.

## 8. WATCHTOWER — social overseer (NEW)
**Passive first**: domain-category rollup over existing dwell capture → platform
cards (time, cadence, session lengths), **doomscroll detector** → "touch grass"
lines, posting-vs-consuming ratio, **Aggro Meter**, weekly rhythm heatmap.
**API plugins after**: YouTube Data first (free/stable; subs/views/per-video),
then Reddit; X/IG flagged paid/fragile. Each plugin = isolated tendril + own
sidecar + gitignored key file.

## 9. OBSERVATORY — knowledge (NEW)
All 4 registered Obsidian vaults: health (notes/recent/stale/orphans), Insight
economy, Quest-Board sync status · **NotebookLM shelf** via extension capture on
notebooklm.google.com (titles, last-opened, dwell, deep links; capture scope
specified in M4's own spec) · cross-vault search launcher.

## 10. SUMMONING CIRCLE — Claude command (NEW)
**Session registry** (observable `-p`/channeled runs; detached terminals listed
as fire-and-forget) · spawn scoped sessions · **THE CANVAS**: JSON Canvas files
(`data/canvas/*.canvas`, Obsidian-compatible), fs-watched (reuse qbWatcher
debounce pattern), both Warden and Claude draw; nodes → "send to Familiar".
**The Binding**: stdio MCP server (see PART III) — any repo Claude session gains
`hq_*` tools; Claude presence shows in the Right Rail while acting.

---

# PART III — ARCHITECTURE (corrected per stress-test)

## M0 boot story (the unblocking design)
- `dashboard-v3/dev-main.js`: minimal Electron harness — window + own preload,
  **no** tray/bridge/shortcuts/single-instance; `app.setPath('userData', scratch)`;
  runs beside live v2 with zero collisions (`electron dashboard-v3/dev-main.js`).
- **Step-0 spike**: verify `<script type="module">` + nested relative imports over
  `loadFile()`; fallback `protocol.handle('app://')` in the harness.
- v3 reads `../dashboard/data.js` via relative `<script src>` **read-only** —
  `build-data.mjs` is never touched pre-swap.
- Swap flag: `data/.ui-version` file (main-readable; localStorage is not) —
  v2 stays one flip away.

## Module system (dashboard-v3/, native ESM once spiked)
```
dashboard-v3/
  dev-main.js  index.html
  src/core/{data,bus,registry,lexicon,themes}.js
  src/realms/<realm>/{manifest.js,view.js}     × 10
  src/ui/components.js   src/fx.js
  src/lexicon/{lexicons.js, voice/*.json}
  styles/{base,components}.css  styles/realms/*.css  styles/themes/*.css
  mcp/server.mjs           (stdio sidecar — see Claude layer)
```
Realm interface: `manifest {id, sigil, lexKey, order, badge(data), enabled(data)}`
(badge recomputed only on data-refresh events) + `view {mount(el,ctx), unmount()}`,
`ctx = {data, bus, LX, theme, hq}`. Shell renders the registry → new realm = new
folder. Theme invariants are REWRITTEN for the rail layout (old `#tabs`/
`.timemachine` rules retire; new: never override rail/stage positioning; all 5
themes re-verified against the new frame in M0 parity).

## Single-source game rules (no `game/core.mjs` — corrected)
- `build-data.mjs` (post-landing, one-line) includes a `GCFG` projection in
  `window.DATA` → thresholds/tiers/curves become *data*.
- Renderer deletes its duplicated tables and consumes collector-exported derived
  fields (`account.spellcraft.mastery[].rank` already exists; blessing moves
  collector-side as an ask). `one-thing.js` dual-mode pattern covers true
  both-sides logic.

## Tendril system
Generalize `startBridge()` in place (router + per-tendril sidecars, atomic
tmp+rename **with Windows EPERM retry**, dedup keys, rolling windows, sanitize/
clamp per tendril). Every sidecar gets a CONTRACT.md row before consumption;
merges into `latest.json` follow the additive-optional `browser.captured` pattern.

## Game economy v2 (ALL structure-lane asks, four batched contract events)
1. **Canonicalize**: set `grace_hours` config to 36 (behavior-preserving no-op),
   then wire the read; GCFG → window.DATA; blessing derivation collector-side.
2. **Banking batch**: bank achievement XP + wire the 6 vestigial milestones with a
   **stacking policy** (milestone pays only when no quest paid the same concern
   that scan) + **grandfather policy** (existing unlocks back-pay 0 via a single
   `notify:false` migration event — no takeover storm, no level spike).
3. **Juice batch**: seeded crit rolls (date-hash primitive from spell-of-day;
   quest-completion XP only; new `changes_since_prev` type guarded in BOTH
   renderers) + same-day combo (requires persisting completion *times* in
   quest-overrides — contract entry; rules must stay pure functions of
   (prev-scan, today's inputs)).
4. **Meta batch**: split ledger — `account.xp` stays lifetime/monotonic (levels,
   trends untouched); NEW spendable `account.runes_balance` + purchases in a
   main-owned runtime file (shards.json pattern, "don't validate") → Cosmetic
   Shop (shard skins, stat-card frames, voice packs, boot variants) · daily
   bounties · 6-week Seasons + NG+ (nothing resets `xp`; seasons are windows over
   history) · Ember Shelter streak shield.

## Claude layer (sequenced: MA before M3)
- **MA "The Untangling"** (own milestone, gated on other-session landing): unify
  `findClaude()`; convert blocking `spawnSync` seams (enrich/narrator/
  draft-commit) to a **`claudeSessions` registry** (castRegistry lifecycle +
  `castSend`-style streaming); long jobs = job-id + poll; implement **chains/
  Ultimates** in the caster; **harden shard preload** (reduced shard-only API —
  closes the conjured-HTML → `castSpell` injection chain).
- **MCP = stdio sidecar** (`dashboard-v3/mcp/server.mjs`, command-type `.mcp.json`
  entry — announce as meta; token never committed): reads `data/*.json` directly
  (works even app-closed); calls a small token-gated localhost endpoint
  (`.bridge-token` pattern → `data/.mcp-token`) only for live-app mutations.
  Tools tiered: reads open, mutations token-gated: `hq_status, hq_quests_list,
  hq_quest_done, hq_capture, hq_summon_shard (post-hardening), hq_canvas_read,
  hq_canvas_add, hq_scan_trigger (job-id), hq_sessions_list`. Scan-trigger
  policy: sessions may trigger; app debounces + never reloads a v3 stage that a
  session is actively driving.

## Far Signal (cloud + phone)
Projection = **explicit allowlist** seeded from `tools/now-brief.mjs --json` +
`miniPayload()`: level, xp, vitality, ember, counts, top-3 labels, quest titles
(contain project names — user accepted). NEVER: URLs/titles from browser data,
brain-dump text, secret locations, absolute paths, tokens. Snapshot test asserts
no unexpected keys; schema versioned. Desktop pushes from main (retry queue,
gitignored key); phone PWA reads via Supabase anon key + RLS single-user row
(never service_role); phone captures land in a cloud inbox polled by main into
`brain-dump.json` (single-writer merge in main).

---

# PART IV — PHASING

| # | Milestone | Ships | Gate |
|---|---|---|---|
| M0 | **NEXUS FRAME** | ESM spike + dev harness + `docs/sync/IPC-CONTRACT.md` + CLAUDE.md lane-table amendment (dashboard-v3/, spellbook/, browser-bridge/, tools/ rows) → shell → port ALL current surfaces into 6 realms (roundtable, forge, hunts, grimoire, lands, legacy; overlays/scrubber/SYS = core) → parity via `_shot*.js` screenshot harness, 5 themes × 6 realms → swap flag | none (renderer-only) |
| MA | **THE UNTANGLING** | async claude registry + findClaude unification + chains caster + shard-preload hardening + tendril router | other session lands |
| M1 | **GAME CORE** | economy v2 batches 1-4 (struct asks + contract events + re-baselines) + voice packs (fe) | M0 |
| M2 | **MED-BAY** | pc-health scanner (struct) + curated restoration spells (spellbook/) + anatomy realm (fe) — landed as an announced 3-way split like the browser bridge | M0 |
| M3 | **SUMMONING CIRCLE** | stdio MCP + Canvas + session UI | MA |
| M4 | **OBSERVATORY** | multi-vault registration (struct ask) + NotebookLM capture (extension manifest change, meta) + realm | M0 |
| M5 | **WATCHTOWER** | a) passive rollup (shared category map used by extension + collector) + realm · b) YouTube plugin | M0 (a), MA (b) |
| M6 | **FAR SIGNAL** | allowlist projection + Supabase push (main) + phone PWA + capture up-sync | MA |

Each milestone gets its own spec → plan → build cycle (this document is the
program charter + M0's context). Un-ported aux windows (mini/capture/cast/shard)
keep loading v2 files post-swap; their port is scheduled inside M3 (cast/shard)
and M6 (mini/capture) where they're touched anyway.

## Verification
- M0: side-by-side screenshot parity (v2 vs v3) per realm × 5 themes at 1180×820;
  arcade labels byte-identical; sticky/rail invariants re-verified.
- Economy: `node collector/collector.mjs && node collector/assemble.mjs` loop;
  golden re-baseline per contract event; celebration-storm regression check.
- MCP: acceptance = THIS Claude session binds via `.mcp.json` and successfully
  calls `hq_status` + completes a real quest via `hq_quest_done`.
- Med-Bay: every fix-spell dry-run reviewed; destructive ones snapshot-first.
- Far Signal: projection snapshot test (no unexpected keys); phone tested on the
  actual phone.

## Design handoff (user's visual pass)
PART II is the per-screen content inventory. Asset list: 10 rail sigils · Warden
plate · One-Thing hero · bounty chips · combo meter · anatomy wireframe ·
platform cards + Aggro dial · rhythm heatmap · canvas board · session presence
chips · 3 iso building archetypes · shop cards · seasons panel.
