# Porting an app into WorkspaceHQ as a Space — full context brief

> Hand this document to the Claude chat that owns the app being ported. Its job: reshape the app
> into a **Space Port Package** (defined at the end) that WorkspaceHQ's own Claude Code session can
> merge mechanically. The port chat prepares; the merge happens inside the WorkspaceHQ repo.
> Written 2026-11-03 from the live codebase.

## 1. What WorkspaceHQ is

A local, personal desktop console for one Windows machine — a gamified "life control center".
A deterministic scanner reads every project folder on the PC (git state, uncommitted/unpushed work,
TODOs, risks); an Electron app turns that into one screen: what changed, what needs the owner next,
where the risks are. On top sit: a Claude Hub (an SQLite index of every Claude Code session and,
live-synced, the owner's claude.ai chats), an in-app Claude chat, a local-LLM "Ask" (Ollama/LM Studio),
a browser extension bridge (active-tab focus, social accounts, publish-with-approval), GitHub/Vercel/
Supabase views, a Life area (screen time, notes), and a light game layer (XP, levels, a pixel mascot).

One owner, one machine, no server, no accounts. The repo is **public on GitHub** — real data never
enters git; everything personal lives in gitignored `data/` files.

## 2. Hard platform constraints (non-negotiable)

- **Electron 32** (Chromium 128, Node 20.x in main). Windows only. No installer, no build step:
  edit → reload.
- **Renderer = vanilla JS ES modules, zero framework, zero bundler, zero npm deps.** No React, no
  Vue, no Tailwind, no CDN. If the app being ported is React/Vite/Next, its UI must be re-expressed
  (see §4); its pure logic usually ports as plain ES modules with little change.
- **CSP is `script-src 'self'`**: no `eval`, no `new Function`, no inline `<script>`, no remote
  scripts or styles. The template engine was purpose-built for this (§4).
- Main process code is **CommonJS** (`require`) in `dashboard/`; renderer and build scripts are ESM.
  The Claude Hub runs as a separate system-Node (≥ 22.13) child process using `node:sqlite`.
- Files are mostly **CRLF**; style is terse lowercase comments explaining *why*, 1-line-dense code,
  no semicolail drift — match what you see.
- **New main-process features go in NEW files** (`dashboard/<feature>.js`) with a one-line
  `require('./<feature>').init({ ipcMain, ... })` hook in `main.js`. Never bolt logic into main.js.

## 3. Architecture map

```
dashboard/                 Electron main (CJS): tray, hotkey (Ctrl+Alt+X only), IPC, feature modules
  main.js                  entry; wires every module; reloads the window after most writes
  preload.js               THE bridge: contextBridge.exposeInMainWorld('hq', { allowlisted methods })
  build-data.mjs           bakes scan data -> dashboard/data.js (window.DATA)
  claude-hub/              SQLite index child process (ESM, schema v2 — never change the schema)
  browser-bridge.js        local HTTP server 127.0.0.1:47821 for the Chrome extension
  social-bridge.js         outbox: Claude stages a post -> owner approves in extension popup -> publish
dashboard-v5/              the renderer ("v5", built from a Claude Design file)
  index.html               links styles/tokens.css + styles/app.css, loads src/boot.js
  src/boot.js              createStore(window.DATA, window.hq) -> mount(template, Component)
  src/dc/runtime.js        "dc-lite" CSP-safe template renderer (see §4)
  src/app.tpl.js           imports src/tpl/*.tpl.js fragments, joins them in order
  src/app.js               the Component class + Object.assign(Component.prototype, ...logic mixins)
  src/tpl/*.tpl.js         one template-string fragment per surface (screen or overlay)
  src/vals/*.js            one module per surface returning that surface's render values (flat keys)
  src/logic/*.js           Component.prototype mixins: event handlers, same `this`
  src/live/store.js        model (from window.DATA) + live (from window.hq pushes); emit() re-renders
  src/live/adapter.mjs     maps raw scan/live shapes -> what vals read
  src/live/catalog.mjs     static UI vocabulary: NAV destinations, sub-tabs, tiers, levels, keys
mcp/workspacehq/           MCP server Claude Code sessions bind via .mcp.json
browser-bridge/            the Chrome extension (manifest v3, currently 0.6.0)
data/                      gitignored owner data: data.js bake inputs, sidecars, hub.sqlite, flags
docs/sync/IPC-CONTRACT.md  every IPC channel documented BEFORE code — the law of the seam
docs/sync/CONTRACT.md      data shapes (scan bundle, sidecars, bridge routes)
docs/sync/HANDOFF.md       append-only log between the two Claude sessions working the repo
```

Two Claude Code sessions share the repo in lanes: **frontend** (`dashboard/`, `dashboard-v5/`,
`browser-bridge/`, `mcp/workspacehq/`) and **structure** (`collector/`, `schema/`, `spellbook/`).
A port lands entirely in the frontend lane. The port chat never touches `collector/`, `schema/`,
`spellbook/`, `run-pipeline.ps1`.

## 4. How the renderer actually renders (dc-lite)

`src/dc/runtime.js` renders a restricted template dialect — NOT JSX, NOT handlebars:

- Bindings are **dotted paths only**: `{{ a.b.c }}`. Plus literals, `!x`, and the equality ops
  `===`, `!==`, `==`, `!=`. **No function calls, no arithmetic, no ternaries in templates.**
  All computation happens in vals modules; the template only reads finished values.
- Conditionals: `<div sc-if="someVal">…</div>`. Lists: `sc-for` (item/index become paths).
  Attributes can bind camelCase via `sc-camel-*`. Custom elements (`hq-type`, `hq-roll`,
  `hq-lines`, `hq-icon`…) animate via `attributeChangedCallback` — they keep identity across
  renders because children are matched **by position** (a toggled `sc-if` never shifts siblings).
- Every render: `Component.renderVals()` builds ONE flat object (all vals modules merged, keys
  disjoint); runtime patches the DOM positionally. Full re-render per state change — it's fast
  because templates are static strings and the patch is positional.
- Event handlers: `data-action` style attributes resolved to Component methods (the logic mixins).
  Handlers mutate via `this.setState(…)` or store writes; store `emit()` triggers re-render.

**A port's UI must be re-expressed in this dialect.** Practical translation from React:
components → template fragment sections gated by `sc-if`; props/state → vals keys; event handlers →
logic-mixin methods; effects → store subscriptions or logic called from `start()`.

## 5. What a "Space" is, and every file it touches

A Space = one top-level destination in the left nav. Today there are **8** (keys 1–8): Home,
Projects, Tasks, Automations, Claude, History, System, Life. **Slots 9 and 0 are free** — exactly
two spaces fit without displacing anything.

Adding a space touches, renderer-side:

1. `src/live/catalog.mjs` — add `{ id, label, glyph }` to `NAV`, sub-tabs to `SUBS.<id>`.
2. `src/tpl/<space>.tpl.js` — new fragment, imported + joined in `app.tpl.js`. Wrap additions in
   `<!-- v5: <reason> -->` markers (design-traceability convention).
3. `src/vals/<space>.js` — `export function <space>Vals()` returning the surface's flat keys;
   registered in `src/vals/index.js`. Key prefix them (e.g. `fin*` for a finance space) — all
   surfaces share one namespace and keys must stay disjoint.
4. `src/logic/<space>.js` — the mixin with handlers; registered in `app.js`'s prototype merge.
5. `src/live/store.js` + `src/live/adapter.mjs` — a model/live slice + refresh function if the
   space has data beyond window.DATA (follow the `refreshSocial`/`refreshLlm` idiom that exists).
6. Default sub-tab in `app.js`'s sub-tab map; palette entries; `logic/whats-new.js` line.

Main-process side (only if the space needs native capability — files, processes, network):

7. `dashboard/<space>.js` — NEW CommonJS module: `init({ ipcMain, app, dataDir, ... })` registering
   `ipcMain.handle('hq:<space>:<verb>', …)`. Validate every renderer input (paths, ids) — the
   renderer is untrusted input as far as main is concerned.
8. `dashboard/preload.js` — allowlisted methods, grouped: `<space>: { list: () => ipcRenderer.invoke('hq:<space>:list'), onX: (cb) => … }`.
9. `docs/sync/IPC-CONTRACT.md` — a row per channel, **written before the code**.
10. `dashboard-v5/tools/fake-preload.js` — a recording fake of each new preload method, so gate
    scenarios run without the real main process.

## 6. State rules (the recurring bug class — read twice)

- Main **reloads the renderer window after most writes**. Any "running/open/selected" state that
  must survive goes in `sessionStorage` (`whq3-place` idiom) or is re-hydrated from a main-side
  query (`hq:live-state` idiom) — never in renderer memory alone.
- `window.hq` is **feature-detected everywhere** (`if (this.hq && this.hq.<space>)`): the dev
  harness and selftest run without the preload, and the screen must degrade to read-only with a
  stated reason, not throw.
- Owner preferences live in localStorage under `whq3-prefs` (one JSON object, read via
  `loadPrefs`/`savePrefs` in `logic/shared.js`).
- Double-submit guards on every write action; a failed write releases the guard and toasts the
  real error. Success toasts only after the write actually succeeded (honesty, §9).

## 7. Data & storage conventions

- Owner data = JSON files under `data/` (gitignored). A space brings its own
  `data/<space>/*.json` sidecars or its own SQLite only if JSON genuinely can't carry it.
- Shapes get a table in `docs/sync/CONTRACT.md` before code relies on them.
- Anything written to the owner's Obsidian vault (VEEMO CORTEX) is written **only on an explicit
  owner click** ("Save"), one note per click, never overwriting another note (see
  `dashboard/claude-vault.js` for the pattern: preview with a local draft → owner Saves).
- Anything **outbound** (posting, sending, publishing) goes through a staged-approval gate: the app
  stages, the owner approves in a separate surface, only then does it send (see
  `dashboard/social-bridge.js`). A port that talks to the outside world must adopt this shape.
- No telemetry, no analytics, no cloud storage. Local LLM (Ollama/LM Studio on localhost) is the
  only "AI at runtime" besides explicitly launched Claude sessions.

## 8. Look & feel

- **Everything is IBM Plex Mono** (`--term`/`--px`). Terminal/console aesthetic, dense, bordered
  panels, uppercase micro-labels. Study a fragment (e.g. `src/tpl/life.tpl.js`) and imitate.
- Colors come ONLY from the tokens in `dashboard-v5/styles/tokens.css` — `--bg --panel --card
  --frame --text --muted --faint --gold --green --red --orange --yellow --blue --purple --cyan`
  etc., themed via `[data-hq-theme]` (dark) and `[data-hq-theme="light"]`. A space's CSS references
  tokens, never hex. Both themes must work.
- Theme invariants: never override `position` on `#tabs`/`.timemachine`; new themes must remap
  `--active`/`--active-arrow`/`--divider`/`--mono`.
- The game layer is available, optional: `FX().sfx('done')`, `FX().floatText(x, y, '+5 xp')`,
  `this.hq.actedOn({...})` to grant XP for completed actions.
- The **time machine**: the top scrubber rewinds every screen to an older scan snapshot
  (`state.snapOffset`, vals built from `at(offset)`). A space whose data is snapshot-independent
  must say so honestly in the scrub overlay's exceptions line; a space with history should follow it.

## 9. Testing & honesty gates (a port is DONE when these pass)

- **Unit tests**: `node --test` files next to every module (`*.test.mjs`). Pure logic gets pure
  tests; main-process modules get tests with temp dirs; never real quota, real vault, or real
  network (fakes/fixtures only; the fake `claude` shim pattern exists in `dashboard/__fixtures__/`).
- **Golden tests**: `src/tpl.hash.test.mjs` (sha of the joined template) and
  `src/vals.golden.test.mjs` (serialized renderVals across tabs×overlays on a synthetic store)
  pin the UI. Template/vals changes re-record them deliberately, each moved key attributed.
- **Selftest**: `?selftest=1` renders every theme × state × tab × sub × overlay combination and
  must log 0 errors / 0 unresolved bindings. A space adds its tab/subs/overlays to this sweep
  (`src/selftest.js`).
- **cdp-gate**: `dashboard-v5/tools/cdp-gate.mjs` drives the real renderer on the fake preload
  (`dev-main.js --preload=fake --hidden --remote-debugging-port=93xx`) through named scenarios,
  including a button-sweep that clicks every button on every screen. A space ships 2–5 scenarios
  for its critical flows.
- **Honesty test**: `src/honesty.test.mjs` denylists lying UI copy. Rule: the UI never claims what
  the code doesn't do — no fake numbers, no "synced" that didn't sync, no success that wasn't
  checked, empty states that distinguish "no data" from "filtered out". Copy in the app's voice:
  lowercase-terse, concrete, no marketing.
- **Public repo hygiene**: fixtures use placeholder names/text only. Nothing personal in tests,
  goldens, screenshots, or docs.

## 10. The Space Port Package (what the port chat must deliver)

A single folder (zip or repo) with this layout — names 1:1 with where files land in WorkspaceHQ:

```
space-port-<name>/
  PORT.md                      the spec: what the space does, every screen, every flow (read first)
  ANSWERS.md                   the questionnaire below, answered
  renderer/
    <space>.tpl.js             dc-lite fragment(s) — ONLY the dialect in §4
    <space>.vals.js            vals module (prefixed, disjoint keys)
    <space>.logic.js           logic mixin (this.setState / canWrite / toast idioms)
    <space>.store.md           store slice spec: model keys, live keys, refresh fn, reload survival
    catalog.diff.md            NAV entry, SUBS, default sub-tab, palette entries, hotkey slot (9 or 0)
  main/                        only if native capability is needed
    <space>.js                 CJS module with init({ipcMain,...}) + input validation
    <space>.test.mjs           its tests (temp dirs, no real IO targets)
    preload.diff.md            the exact preload group to add
    IPC-CONTRACT.rows.md       one documented row per channel (shape, direction, errors)
    CONTRACT.rows.md           data sidecar shapes, if any
  tests/
    <space>.logic.test.mjs     pure-logic tests
    selftest-states.md         which states the selftest must sweep for this space
    cdp-scenarios.md           2-5 scripted flows (what to click, what must be true after)
  assets/                      only token-based CSS; no fonts, no images unless essential
```

Conversion rules for the port chat:
- Strip every framework dependency. What was a React component tree becomes template + vals + logic.
- Strip every server dependency. If the app had a backend, decide per feature: local file in
  `data/`, main-process module, or cut. Name every cut in PORT.md.
- Keep the app's *domain logic* as pure ES modules with tests — that's the part that ports verbatim.
- Shrink: a space earns 1 nav slot, 2–4 sub-tabs max. Features that don't fit become overlays or cuts.
- Write all copy in the app's voice (terse, lowercase, honest) and both themes in tokens.

## 11. Questionnaire (answer in ANSWERS.md)

1. What does the app do, in one paragraph? What are its 2–4 sub-tabs as a space?
2. Stack today (framework, build, deps)? Which deps does the port eliminate, and how?
3. Data model: what state exists, what must persist, what shape, how big? Where does it live
   post-port (`data/<space>/*.json`? main-side module? renderer-only)?
4. Does it need the main process (files, child processes, network, OS)? List each need as a
   proposed `hq:<space>:<verb>` channel with its payload/return shape.
5. Does it talk to the network at all? To where, how often, and what is the approval story?
6. Anything outbound (posting/sending)? Then it must adopt the staged-approval gate — sketch it.
7. What of the game layer applies (XP-worthy actions)?
8. What follows the time machine, what honestly can't?
9. What are the 3–5 cdp-gate scenarios that prove the space works?
10. What gets CUT in v1 of the space? (Be ruthless; list it.)

## 12. How the merge will run (here, in the WorkspaceHQ repo)

The WorkspaceHQ Claude Code session takes the two Space Port Packages, assigns the nav slots and
keys, lands renderer + main files per §5, writes the IPC-CONTRACT/CONTRACT rows, re-records goldens
with attribution, extends selftest + cdp-gate, runs the full suites (today: 584 main-side + 355
renderer, all green), and commits in small `fe:`/`meta:` commits with a HANDOFF entry. The better
the package matches §10, the more mechanical that is.
