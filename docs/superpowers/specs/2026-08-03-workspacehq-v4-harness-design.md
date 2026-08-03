# WorkspaceHQ v4 — "THE HARNESS" — Design

**Status:** approved 2026-08-03. Supersedes the NEXUS v3 renderer program for all future UI work.

## The problem, stated honestly

v3 is a **vanity interface**: it looks at your work and never does any. Three structural causes — none cosmetic:

1. **The data is a nightly photograph.** Every surface renders `data/latest.json`, a snapshot. A snapshot cannot be a harness; it is inherently retrospective, so every screen becomes a report card.
2. **Every action is a launcher.** "Send Claude" opens `cmd.exe`. Open repo → the editor. Notes → Obsidian. The work always happens *somewhere else*, so the app is a menu, not a workspace.
3. **The game scores the wrong thing.** XP derives from scan deltas — it rewards *being scanned*, not *shipping*. That is why the gamification reads as decoration: it is not attached to real outcomes.

Secondary, and real, but downstream of the above: the visual language is generic (anonymous dark panels), monotonous (everything is the same card in the same grid), static (no weight or payoff on interaction), and typographically flat.

**The features are not the problem.** The way they were built is.

## Thesis

**v4 is a work loop, not a dashboard.**

```
SENSE  →  DECIDE  →  ACT  →  LAND  →  (XP)
live      one         agents   verified
truth     queue       run      outcome
                      in-app
```

v3 has a weak SENSE, a DECIDE scattered across 15 realms, and **no ACT or LAND at all**. The loop dead-ends at "look at this". v4 closes it.

## The decisive discovery

**The agent harness is already ~90% built in the main process, and the UI throws it away.**

`dashboard/claude-sessions.js` is a complete async session runner:
`start({ label, args, input, cwd, timeoutMs, onOutput, onDone, command })` — spawns Claude with an **arbitrary cwd**, streams stdout/stderr (`proc.stdout.on('data')`), buffers to `BUF_MAX` with a rolling `TAIL` of 800 chars, tracks lifecycle with a linger window, and emits changes through `setOnChange` → pushed to the renderer as `hq:claude-sessions`. Plus `list()`, `kill(jobId)`, `killAll()`. The shard/conjure feature already uses it correctly (`main.js:639`).

Then `hq:claude-quest` (`main.js:737`) ignores all of it: `spawnSync('cmd.exe', ['/c','start','','cmd','/k', 'cd /d "<cwd>" && claude "<prompt>"'])`.

**Consequence:** ACT is reachable through a *small additive seam*, not a rewrite.

## Architecture — four layers

### 1 · SENSE — the truth layer
**Module:** `src/state/` (new). Merges three input classes into one observable state:
- **Slow truth** — the nightly scan (`latest.json`), as today.
- **Live push** — sessions (`hq:claude-sessions`), machine (`hq:machine`), browser (`hq:browser-tab`). These channels already exist.
- **On-demand probe** — git status for a project, fetched when a surface needs it.

The scan stops being "the data" and becomes one input. Consumers subscribe to one place instead of reaching into `window.DATA`.

### 2 · DECIDE — the unified queue
**Module:** `src/intel/queue.mjs` (new, **pure**). Normalizes every actionable thing into ONE item shape:

```
{ id, source, title, detail, projectId, projectPath, severity, verbs[] }
```

Sources: `triage()` threats · open tasks · `agencyProposals()` signal gaps · captured ideas · `achievementNudges()`. It composes the substrate that already exists and is unit-tested.

**One shape → one component.** This is the structural fix for "everything is a card": there is exactly one item renderer, so hierarchy and rhythm are designed once instead of drifting across 15 hand-built surfaces.

### 3 · ACT — the agent harness
Sessions become first-class objects.
- **New IPC (additive):** `hq:session-start { cwd, task, label }` → `claudeSessions.start(...)` with the project's cwd → returns a `jobId`. Row added to `IPC-CONTRACT.md` **before** the handler lands.
- **Main-process work goes in a NEW file** (`dashboard/session-api.js`) integrated by a one-line hook in `main.js`, per the standing lane rule.
- Output streams into an in-app pane. **`claude-sessions.js` is NOT modified** — its existing `start({ onOutput })` callback is the seam: `session-api.js` subscribes and pushes chunks on its own additive channel (`hq:session-output`), so the renderer gets full streaming output while the shared registry stays untouched (its 800-char `tail` remains the presence/summary view for other consumers).
- The user can watch, kill, and — on completion — see the diff the session produced (`git diff` probe) and accept or discard.

**No renderer surface shells out to a terminal again.**

### 4 · LAND — outcomes
XP/progress derives from work actually landed: a session accepted, a threat cleared, a task closed. Replaces scan-delta XP. **Deferred to v4.2** — it touches the economy, which is structure-lane, and must not gate the spine.

## Surfaces — 6, with a workbench at the center

| Surface | Contents |
|---|---|
| **WORK** *(default)* | the loop: queue rail · live agent + streaming output · live truth rail |
| **PROJECTS** | per-project depth: health, git, session history, drawer |
| **SYSTEM** | machine health · screen time · social presence |
| **MIND** | vaults/notes · canvas |
| **AUTOMATE** | automations (968) · session history |
| **LOOKBACK** | trends · timeline · analytics · trophies (v3's four retrospective realms merged) |

**No feature is deleted.** Everything in v3 lands in one of these, rebuilt on one component set. One theme. No lexicon indirection.

## Visual direction

The **System HUD** identity from the mood board (Solo Leveling): deep violet-on-near-black, hexagon-cut frames, glowing edges, HUD chrome, real depth — the language prototyped in v3's War Room, now the app-wide default rather than one realm's skin.

**Motion law:** every animation is tied to a *real state change* — a session starting, output arriving, a threat clearing, work landing. No decorative fades. This is the fix for "static, no weight": the payoff exists because the event is real.

**Typography:** a genuine scale with display weight for focal numbers, not one family at four near-identical sizes.

## Delivery — three milestones

**v4.0 — THE SPINE** (build first; this is the milestone that changes what the app *is*)
- `src/state/` truth layer
- `src/intel/queue.mjs` + tests
- `dashboard/session-api.js` + `hq:session-start` (IPC-CONTRACT row first)
- the **WORK** surface: queue · streaming agent pane · live rail
- the System-HUD visual core (tokens, one theme, the single item component)
- **Exit:** you dispatch an agent at a real project from inside the app, watch it stream, kill or let it finish, and see what it changed — without a terminal.

**v4.1 — SURFACES** — PROJECTS, SYSTEM, MIND, AUTOMATE, LOOKBACK rebuilt on the v4.0 component set.

**v4.2 — CLEANUP + LAND** — delete the v2 renderer, the 5 legacy themes, the lexicon; XP from landed work.

## Constraints (inherited and explicit)

- **Build in `dashboard-v4/`**, alongside v3, selected by `data/.ui-version` → `"v4"`. **v3 becomes the rollback** during v4.0/v4.1 — the same proven pattern that carried v2 → v3. Both v2 and v3 renderers are deleted in v4.2, once v4 is proven.
- **Vanilla ESM, no build step**, CSP `default-src 'self'`; third-party libs vendored locally (anime.js and three.js already are). The no-build constraint is not what made v3 feel bad and is not being traded away.
- **Additive contract.** `latest.json` shapes unchanged. IPC additive-only, announced in `IPC-CONTRACT.md` before code. Main-process additions in NEW files with one-line hooks.
- **Lane ownership.** frontend owns `dashboard-v4/`; `collector/`, `schema/`, `spellbook/` remain struct asks.
- **KEEP the substrate** (~1,400 LOC, pure, unit-tested, zero DOM): `intel/derive.mjs`, `intel/foresight.mjs`, `intel/agency.mjs`, `core/actions.mjs`, `core/notify.mjs`, and their tests. They move to v4 unchanged.
- **No dead or lying controls.** A control does something real or renders disabled with a reason; it never claims an outcome it cannot verify, nor implies synchrony where the effect is async. (Three v3 epics each shipped one of these; each cost a fix wave.)
- **Selftest** remains the mount tripwire; the combo count is re-baselined for v4's surface count (from 15 realms × 7 themes = 105 → 6 surfaces × 1 theme = 6).

## Known hazards, carried forward

- `hq:capture-save` runs a **blocking `spawnSync` + `win.reload()`** — capturing from the main window freezes the app ~1.6s and hard-reloads it. v4 must not build a confirmation state that this destroys; fixing it at the source is a struct/main ask.
- `hq:spell-cast`'s `opts` carries only `notify`, so a spell always runs its own `cwd` and cannot be targeted at a project. Spell-based remediation stays impossible until an additive `opts.cwd` lands (ASK already filed).
- The Node in this environment mis-discovers directory tests: always run test **files**, never a bare directory.

## In flight at time of writing

NEXUS ALIVE **Epic D is 3/4 complete** and committed: `intel/agency.mjs` (pure, tested), the `claude:dispatch` action, and the forge suggested-actions strip. Only the War Room button wiring and its docs remain. The two logic pieces (`agency.mjs`, `claude:dispatch`) carry into v4 unchanged; the remaining UI task is superseded by v4.0's WORK surface and should be **closed, not finished**.
