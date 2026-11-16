# WorkspaceHQ: the fullest-potential plan (2026-11-16)

Status: PROPOSED, awaiting the owner's approval; nothing in it is built. Written from main @ 5889e22 after readers, proposals and a red-team judge. It amends, and in two places contradicts, `2026-11-14-next-level-plan.md`.

## What the owner asked

Criticise the plan and make it better. Push the app to its fullest potential and plan how extensible it can be. It has no built-in browser and no app opener; opening apps inside it would be more useful and more fun. Give it more functions and purposes than "a dashboard".

## Criticism of the 2026-11-14 plan

**What it got right.** Reach before surface, the use report as the gate, counts-only projection, the tool rulebook, deletion only with a yes, and one Home.

**Where it is weak.**

1. **It measures glances.** About 74 marks in 7 days, every one an open. "Zero acts" is the headline, but the act counter was only fixed on 2026-11-14 and the report is dated 2026-11-15: roughly one valid day. We do not yet know the owner does not act. Every proposal leaned on this number; only one treated it as unverified.
2. **Acts were mostly unreachable.** `dashboard/brief-act-core.mjs` allows four verbs; only two change anything and none starts work. Zero is as likely to mean "nothing to click" as "did not want to".
3. **"Stop adding" was read as "build less".** The owner's own north star is a life-OS and an agent harness. The right reading is "build the loop first". A flat ban left a console skin and eight cheat codes but nothing that does work.
4. **Decoration came before reach.** Batch 7's Console layer is off by default and has no recorded use, yet costs value keys, goldens and tests.
5. **The app tells but cannot do.** Real work (dev server, editor, terminal, preview) happens outside it.
6. **Stage 0 started two days late and is half done.** On 2026-11-16 the tools were registered for every session and the session-start Brief line went in (through the new helper `tools/add-brief-hook.mjs`, because hand-editing the settings file failed). Bridge pairing, the test notification and the first Security refresh are still open. The owner-step queue grew while use stayed flat.

## Why nothing has been acted on

Owner-gated features need a step only the owner can take, the Brief cannot start anything, and the app sits hidden in the tray beside a terminal and an editor that already do the work. The plan answered with more reach, which needs yet another owner step. The way out is to put the work inside the app, where one click is an act.

## What "fullest potential" means (the purposes)

The app becomes **the place the owner starts work**, then grows purposes as modules. Ranked by how close the code already is:

| # | Purpose | Built today | Missing |
|---|---|---|---|
| 1 | Project workbench: launch, preview, sessions, quests for one project | ~70% | launcher, preview pane |
| 2 | Claude command centre: approve a waiting session in place | ~70% | live approve/deny |
| 3 | Capture inbox: one always-open door plus triage | ~50% | the door, triage view |
| 4 | Automation runner: owner recipes, run history | ~50% | recipes, history |
| 5 | Client delivery desk | ~60% | client-ready report |
| 6 | Browser and app opener | ~10% | everything (this plan) |

## The extension architecture

**Principle: extract the seam from two real modules (launcher, preview); do not design it ahead of them.** Modules are first-party repo code only.

**What stays core (never pluggable):** tool tiers and the audit log, the `brief-project` privacy projection, the Security vault and passphrase path, `safeStorage`, the refresh lock, Bridge pairing and token, `--permission-mode default` for every Claude launch, the `hq:use` allowlist. No downloaded code, no user-directory code, no plugin marketplace, no shell strings.

**Module manifest** (`dashboard/modules/<id>.manifest.mjs`, plain data, checked by a pure validator in the style of `logic/cheats.mjs` `validateRegistry`):

```js
export default {
  id: 'launcher',
  label: 'Launcher',
  glyph: 'rocket',
  home: { space: 'projects', tab: 'workbench' },
  ipc: ['hq:mod:launcher:read', 'hq:mod:launcher:open', 'hq:mod:launcher:add', 'hq:mod:launcher:forget'],
  dataDir: 'data/mod/launcher/',
  tools: [],
  useSurfaces: ['launcher-open', 'launcher-add'],
  defaultOn: true,
  ownerGated: false
}
```

**The validator refuses:** a `stage` or `shell` tier, any command string, a `home` naming a new space, channels outside `hq:mod:<id>:*`, a `dataDir` outside `data/mod/<id>/`, and any tool without a tier. A drift test derives the catalog row, the use-log allowlist and the IPC-CONTRACT rows from the manifests and fails when they disagree.

**Honest limit:** the drift test guards new modules only; the existing 92 `ipcMain.handle` sites and eight hand-edited tables stay unchecked until older spaces get manifests (a larger refactor, not in this plan).

**Value keys and golden churn.** renderVals sits at 985 of 1015; past that the V8 descriptor limit and the per-item `{...vals}` copy cost real time. So the host reserves ONE key, `modv`, nested per module, and nothing else flattens. One template fragment, one re-record with a CONTRACT entry; later modules change data, not the hashed template. Each module also gets its own small golden. **Verify that per-module goldens really leave the 160 shared hashes alone before relying on them.**

**Owner gates.** Each module has `defaultOn` and `ownerGated`. A gated feature with no first use after 30 days becomes hidden-until-enabled (hidden, never deleted).

**Safety rules for every module:** a names-only audit line and an act mark per real success; no MCP tool unless `read` or `note` tier with its first-use mark already in the use report; page content and launcher state never reach MCP.

## The in-app browser

**What it is:** a "Preview here" pane for the project being worked on. A main-process `WebContentsView` in a new file `dashboard/preview-pane.js`, with a pure `preview-core.mjs` (URL gate, bounds clamp). One live view at a time, closed explicitly (views are not freed on detach). One more renderer process, roughly 100 to 300 MB.

**What it is not:** a daily browser. No URL bar, tabs, extensions or password manager, and nothing from the open web. Chromium 128 is over two years old and the Bridge extension does not run in it.

**Isolation rules** (copied from `dashboard/delivery-check.js`): in-memory partition, `sandbox: true`, no preload, every permission, popup and download denied, certificate errors refused with no click-through. Navigation is pinned to one loopback origin and port. Every other loopback port is cancelled, so the Bridge (47821), Syncthing's local page and any local model endpoint are unreachable. `main.js` gains the missing `web-contents-created` navigation and window-open guard in the same batch. The renderer learns only `{host, title, loading, canBack}`. The view detaches while the palette, a dialog or a toast is open (a native view paints above all page content).

**v1 (loopback only):** the source is the project's running dev server from `activeDevServers`. Back, reload, phone-width toggle, "Open in real browser" (https and loopback only). A deploy link is NOT loaded in v1; it opens in the real browser, because it is https on the open web.

**v2 (only if v1 passes, and only after an Electron upgrade):** owner-pinned https hosts (docs, deploy dashboards) through a small pane-source resolver (dev server, deploy, doc), not a plugin API.

**Testing:** cdp cannot see a second `webContents`; this needs a native check plus pure tests for the URL gate and bounds.

## The app opener

**The ladder:**

| Rung | What | Verdict |
|---|---|---|
| 1 | Launcher: owner-picked apps, folders, files, URLs; "Open workspace" per project | Build first |
| 2 | Window tiling: list, focus and place existing windows via one spawned PowerShell user32 call | Second, only if rung 1 shows repeat use |
| 3 | Re-parent a foreign window into ours | Do not build |
| 4 | Web apps in the preview pane | Comes with the browser above |
| 5 | Real in-app terminal | Not now |

**v1 launcher.** Pure `launcher-core.mjs` plus `launcher.js`, entries in gitignored `data/mod/launcher/`. Entries are added only through the file or folder dialog, as an absolute target with a kind (folder, file, app, url). No arguments except one project folder that passes `resolveProjectPath` and does not begin with a dash. Always an argv array, `shell: false`. URLs are `https:` or loopback only. The sender must be the main window. Each project's dev command is **owner-confirmed once** in the Launcher list, never taken from scanned text. "Open workspace" runs in order: dev server, editor at the folder, terminal at the folder, preview. Each real success writes an act mark and one names-only audit line. The existing `hq:dev-start` `shell: true` spawn is replaced first, after checking where the scanned command at `collector/collector.mjs:318` comes from. The launcher is not an MCP tool.

**A cost nobody had budgeted.** "One click from the Brief to working" needs a new `brief-act-core.mjs` verb (open workspace). It is its own dish below.

**Honest verdict on embedding native windows: no.** Store apps refuse re-parenting, Chromium-based apps glitch, DPI and keyboard focus break, a native child always draws over our palette and dialogs, and a crash can take unsaved work with it. Web apps and localhost can live inside; native apps are launched and tiled.

**Honest verdict on an in-app terminal:** a real one needs `node-pty`, a native rebuild, which breaks the no-install rule. A pipe-based spawn has no TTY (no vim). Windows Terminal tiled beside the app is better for now.

## Stages and dishes

Every stage has an act bar. The next stage does not start until the previous bar passes (or the owner waives it in the handoff).

| Stage | # | Dish | Size | What the owner gets | How we know it worked |
|---|---|---|---|---|---|
| 0 Truth | 0a | Verify act counting end to end; add launch, preview and open marks | S | A trustworthy baseline | `node tools/use-report.mjs` shows per-verb counts; a deliberate click appears |
| 1 Launcher | 1a | Replace `shell: true`; owner-confirmed dev command | S | A safe dev-server start | Test: no scanned text reaches a spawn |
| 1 | 1b | Launcher and "Open workspace" (Settings list, project button, palette rows) | M | One click starts a project | 3 or more Open workspace acts on 3 separate days in 7 |
| 1 | 1c | Brief act: open workspace | S | A Brief row starts work | An act mark from a Brief row |
| 2 Seam | 2a | Manifest validator and drift test | S | Nothing visible; new modules are checked | The test fails when one table is missed |
| 2 | 2b | Module host: registry, `modv`, `hq.mod.invoke`; port the launcher onto it | M | A third module needs no edit to preload, main or the template | renderVals 986; one re-record; cdp and selftest counts hold; a per-module golden leaves the shared hashes alone |
| 3 Preview | 3a | Preview here, loopback only, with the main-window navigation guard | M | The running project beside the work | 3 or more previews in 14 days, else delete |
| 4 Workbench | 4 | One Workbench view inside Projects: launcher, preview, sessions strip, quests | M | One place per project | Opened on 3 days in 7 |
| 5 Purposes | 5a | Tiling (rung 2) | M | Terminal and editor beside the app | Only if 1b shows repeat use |
| 5 | 5b | Capture door, then approve-in-place, then runner recipes | S each | Each a manifest and a view over data that exists | One at a time, each gated on the last |

**Success is work, not clicks:** the owner opens a project and finishes a real task inside the workbench on 3 days in 7. Launch counts are only a leading signal.

## The freeze rule, amended

Current: no new space and no new MCP tool until every owner-gated feature has a first use.

**Proposed wording:** "No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted."

**What it costs, honestly.** The use report no longer alone decides the next batch, so we build before owner-gated features have a first use, and more surface can mean more unused surface (the 2026-11-14 failure). Gate time and golden re-records rise, with 30 keys of headroom. The preview adds a process and a native check.

## Risks

1. A seventh batch of unused surface. Mitigation: act bar per stage, delete clause.
2. The launcher becomes arbitrary execution. Mitigation: owner-picked entries, argv only, no scanned text.
3. A page in the pane reaches the Bridge, `data/` or an MCP flow. Mitigation: pinned port, no preload, no MCP.
4. The seam becomes a refactor that ships nothing. Mitigation: launcher first; the seam is extracted in Stage 2 from two real modules; stop if the drift test takes more than about 2 days.
5. "Zero acts" is mis-measured. Mitigation: Stage 0.

## What stops or gets deleted

Held for the owner's yes after the next use report: the Console layer and everything under it, the dormant fold machinery, the `--settle` gate sweep. Never built: a plugin marketplace, user-directory code, window re-parenting, an in-app terminal, pane tabs, a new space, a new MCP tool. Deleted on a miss: the preview (under 3 uses in 14 days), launcher entries and tiling (no acts in 14 days).

## Decisions for the owner

1. **Amend the freeze as worded above?** Recommended: yes, with the act bar on each stage.
2. **Is a loopback preview pane enough as "the built-in browser"?** Recommended: yes for now; a real browser waits for an Electron upgrade, and your real one already has your extensions and passwords.
3. **Is launching plus tiling Windows Terminal enough for "open apps inside it"?** Recommended: yes; native windows cannot be embedded reliably.
4. **Install `node-pty` for a real in-app terminal?** Recommended: no, not yet.
5. **Will you pick launcher entries yourself through the file dialog and confirm each project's dev command once?** Recommended: yes; nothing is built from scanned text.
6. **May the 30-day hide-until-enabled rule apply to unused gated features, and the Console layer join the deletion list?** Recommended: yes to the rule; decide deletions after the next use report.
7. **Is success "finish a real task inside the workbench on 3 days in 7"?** Recommended: yes.
8. **Will you do the owner steps this week (Bridge pairing, first Security refresh, the brief hook)?** Recommended: yes; otherwise every plan sits behind them.
9. **Upgrade Electron (32 to a current release) so a real in-app browser becomes safe to build?** Recommended: yes, as its own batch after stage 1, with nothing else in it. It is the one thing standing between the preview pane and pinned web pages or a URL bar; it touches every native check and may move goldens, so it must not share a batch with features. (Added by the session lead, not by the planning run.)
