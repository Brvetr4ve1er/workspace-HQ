# Batch 9: Truth, then the Launcher

Date 2026-11-17, revised after red-team. Lane: frontend, plus `meta:` edits named below (announced in HANDOFF first). Source: the approved `docs/superpowers/plans/2026-11-16-fullest-potential-plan.md`, stage 0 and stage 1 only.

## What the owner gets

The freeze wording is amended in three places. The use report shows real acts per verb and days, and one real Brief click reaches the day log once. The dev server stops running scanned text through a shell: Start runs only a command the owner allowed, as an argv array. A Launcher list in Settings holds the owner's folders, files, apps and links, each added through a system dialog. Each project page gets "Open workspace" (dev server, editor at the folder, terminal at the folder); Ctrl+K gets a row per project. The Brief verb ships last, alone. No new space or MCP tool, no module host, preview pane, Workbench view, tiling, in-app terminal or Electron upgrade.

The batch 8 follow-up (Vault desk default folder, light-theme labels) landed and was pushed before this batch started, so the tree is clean at the start. The owner's app is running: never stop it or use its profile.

## Cooking order

| # | Dish | Size | Runs |
|---|---|---|---|
| 0 | G The gate reads invented data | M | First, alone |
| 1 | 0 Amended freeze wording | S | After G (dishes are cooked one at a time in the one working tree) |
| 2 | 0a Act baseline | M | After 1; owns `use-log.js` |
| 3 | 1a Dev command, argv only | M | After 2; lands before 1b |
| 4 | 1b-1 Launcher core and IO | M | After 3 and the other fleet |
| 5 | 1b-2 Launcher screens | M | After 4 |
| 6 | 1c Brief verb | S | After 5, own release |

Why split: 1a ships alone (replace the shell spawn first). The old 1b is too big for one green gate: 1b-1 has no renderer, 1b-2 is all screens. 1c has its own bar.

Single-writer files: `main.js` (thin delegates), `preload.js`, `fake-preload.js` (launcher block in its own BEGIN/END markers), `src/vals/index.js`, `vals.hashes.json`, `tpl.hash.test.mjs`, `IPC-CONTRACT.md`, `.gitignore` (`data/launcher/`). Nothing in `collector/` or `schema/`.

## Dish G: the gate reads invented data (M, cooked FIRST; added by the session lead after the plan run)

**Why first.** The selftest and the browser scenarios start `dev-main.js --preload=fake`, but the page still loads the owner's real `dashboard/data.js` (`dashboard-v5/index.html:21`), which the running app rebakes after every scan. A scan landing mid-gate changed Home on 2026-11-17 and failed a scenario. This batch runs the gate many times while the app is running, so the gate must stop depending on real data before anything else is cooked.

**Build.** New `dashboard-v5/tools/gate-data.mjs`: `gateData()` builds an invented `window.DATA` from the existing builders in `src/live/__fixtures__/synthetic.mjs` (placeholder names only): at least three scans, a git project, one with a gap, one with a secret, an interactive `claude` automation and a non-destructive one, `changes_since_prev` empty, a fixed scan date; `writeGateData(path)` writes `window.DATA = ...;`. `dashboard-v5/dev-main.js`: when `HQ_V5_DATA_FILE` is set, the page gets that file in place of `../dashboard/data.js` (spike first on a throwaway profile: a `webRequest.onBeforeRequest` redirect if Electron 32 allows file to file, else `protocol.handle('file', ...)` for that one path); unset means today's behaviour. `tools/gates-core.mjs`: the selftest and cdp steps write the fixture into their temp profile folder and set the variable.

**Tests.** `dashboard-v5/tools/gate-data.test.mjs`: the fixture passes through `createStore` and has what the scenarios need; no real name (placeholder convention only); `gates-core` sets the variable for both Electron steps. One boot assertion inside an existing scenario that the page is on the fixture. Then run the full gate ONCE on the fixture and fix every scenario or selftest row that silently relied on real data (name each in HANDOFF); update any pinned `combos=` or scenario count deliberately.

**Goldens.** None should move (they already use the synthetic fixture). **Docs.** HANDOFF entry; one clause in the CLAUDE.md gate bullet. **Not built.** No change to what the owner's own app loads.

## Dish 0: Amended freeze wording (S, `meta:`)

**Owner sees.** The approved wording, verbatim: "No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted." Openers `FREEZE RULE:` (CLAUDE.md) and `Freeze rule:` (README) kept.

**Edit.** `CLAUDE.md` line 3; `README.md` lines 10 to 12 (the sentence "nothing is deleted without a yes" stays, so deletion needs the owner's yes; read both together by hand); `tools/thesis.test.mjs` (header comment, `FREEZE` patterns lines 19 to 26, fixtures near 60, 66, 81). Old patterns are replaced by: `freeze rule`, `no new space`, `no new MCP tool`, `views inside an existing space are allowed`, `one stage at a time`, `the use report is read before every stage`, `the next stage waits for the previous act bar`, `fewer than 3 uses in 14 days is deleted`.

**Tests.** `node --test tools/thesis.test.mjs`. **Docs.** One HANDOFF line. **Not built.** No other CLAUDE.md or README change.

## Dish 0a: Act baseline (M)

The act bar reads this counter, so the fix is in scope; it changes Brief counting for other surfaces too (one HANDOFF line).

**Owner sees.** `node tools/use-report.mjs` prints per surface a count per verb (open, act, handover, copy, log, resume), an "act days" column (distinct local-time days, last 7; time zone stated), and "Open workspace: N acts on D days (bar 3 on 3, window 7 days to <date>)".

**Re-confirm first.** `dashboard/brief-act.js` line 34 always writes `act` (also open-folder, and commit at line 60) while the renderer `_batMark` also writes `handover` for commit; Mark done and Confirm balance can count twice (main plus renderer `useActOnce`). `brief-act.test.mjs` 195 to 201 and `act-marks.test.mjs` 183 to 192 pin the old behavior; rewrite together.

**Fix (one writer).** Main writes the mark, only for verbs whose table entry marks; `_batMark` (`dashboard-v5/src/logic/brief-act.js`) stops sending `act` for those. Commit writes `handover` only; open-folder nothing.

**Edit.** `dashboard/brief-act.js`, `dashboard-v5/src/logic/brief-act.js`, `tools/use-report.mjs`, and their three tests plus `tools/use-report.test.mjs`. **Create.** `dashboard/act-trace.test.mjs` (real renderer `_batMark` and `useActOnce`, real `use-log` on a temp directory, the real Brief act path, the report's `collect`; one act per click, including two clicks inside 60 s and the 30 a minute cap) and `dashboard/use-surfaces.test.mjs` (every surface any file marks is in `SURFACES`).

**IPC.** None. **Marks.** None here: `launcher-workspace` joins `SURFACES` in 1b-1 with its only sender, so the report lists no unused rows. The mark measures use of the button, not use across projects; a Brief-row launch writes the same mark, on purpose.

**Audit.** The launcher calls `assist-audit.mjs` `record` directly (the MCP `decide()` has a 10-minute per-tool cooldown that would block repeat launches). Add `app` to `DOORS` in `assist-core.mjs` (additive), tools `launcher_workspace`, `launcher_dev`, tier `run`. `auditEntry` only strips control characters from `reason`, so `reason` is a fixed step-name enum, never an error text. Tests: `summarize` and `hq_activity` print with a third door; no `launcher_*` audit line holds a path.

**Goldens.** None. **Docs.** HANDOFF; CONTRACT: main writes the act mark, the renderer does not. **Not built.** No change to other surfaces' rules, no edit of old logs.

## Dish 1a: Dev command as an argv array (M)

**Owner sees.** An unconfirmed project's Start shows the command as text with one "Allow and run" button on the project page; that click allows and runs it (no Settings trip). Resume skips the dev step with "not allowed yet". A refused command says "can't run this one: it needs a runner or syntax I don't run; open the terminal".

**Create.**
- `dashboard/dev-command-core.mjs`, pure. Per-runner grammar, no generic character filter: `npm run <name>`, `npm start`, `pnpm run <name>`, `pnpm dev`, `yarn <name>`, `bun run <name>`, `node <relative file>`. `<name>` is `^[a-z0-9:_-]+$`, no leading dash; the only suffix is `--port <digits>`; the node file is relative, no `..`, drive colon or leading slash, inside the folder. Refused: `npx bunx exec dlx init install`, `-e -p --eval --require --import --loader`, shell symbols, `%`, control characters, lines over 200 characters.
- `dashboard/dev-command.js`, IO. Store `data/launcher/dev-commands.json` (null-prototype object; project id `^[a-z0-9._-]{1,64}$`). An entry holds `{words, key, confirmedAt}`; `key` hashes the resolved folder, the `scripts` entries involved (named script plus `pre`/`post`) and `.npmrc`; any change forces a new allow. The row says "runs this project's own scripts". The runner resolves to an absolute path in main (System32 `cmd.exe`, a PATH search skipping the cwd and refusing a hit inside the project; `node.exe <npm-cli.js>` preferred over the shim). Child: `shell:false`, `stdio:'ignore'`, `windowsHide:true`, `NoDefaultCurrentDirectoryInExePath=1`, an environment allowlist. Returns the child; `spawn`, `taskkill` injectable. 10 starts an hour, in memory.
- `dashboard/main-gate.js`: `fromMain(event, getWin)` requires `event.sender` is the main window's contents, `event.senderFrame` is its main frame, and an app origin; the cast window (same preload) is refused. Six older copies stay untouched.

**Edit.** `main.js`: `hq:dev-start` becomes a delegate keeping `activeDevServers`, `__hqStartedAt` (read by `live-state.js`), the close and error handlers and `sendDevStatus` (about 12 lines; the Map stays shared with the tray, kill-all and `delivery-check.js`). No `prod.dev_cmd`, no `dialog.showErrorBox`, no path in any error (fixed words). `hq:dev-stop` and `hq:kill-servers` get `fromMain`. Orphans: pid plus start time in `data/launcher/running.json`; the next start offers an owner-click Stop that kills only if both match; never auto-kill. `src/vals/project-page.js` (`p.dev`, `devLabel`, `noDev`, `resumeHint`, `pg.dev`) reads an allowed flag. `dev_cmd` is display text everywhere.

**IPC.** `hq:dev-start({id})` returns a fixed word (`started running unconfirmed refused busy`); the renderer treats `started` and `running` as the old `true`. `hq:dev-allow({id, shownHash})`: main stores only if the hash of what was shown equals the hash of the current scan, else `changed` and nothing stored; 20 an hour. Main window only.

**Tests.** Core: accepts `npm run dev`, `node server.js`; refuses every symbol, `%`, newline, `npx`, `node -e`, `--require=x`, UNC, absolute and `..` scripts, `--script-shell`; pinned argv per runner; a loop over an invented `dev_cmd` list. IO with fake spawn: never `shell:true`; unconfirmed spawns nothing; changed scan text, `package.json` script or `.npmrc` each forces re-allow; a runner inside the project is refused; wrong sender or subframe refused; `__hqStartedAt` set; no module spawns `dev_cmd` text. Update `surfaces.test.mjs` 200 to 241. `dev-command.native.check.js` (`--native`): an invented node server through the real argv, one `npm run`, `taskkill /t` (unit tests prove argv only; say so in HANDOFF). cdp `dev-start-unconfirmed`, `dev-start-confirmed` on invented projects via `hqFake:` keys.

**Goldens.** `vals.hashes.json` moves for `^pg\.(dev|devLabel|noDev|resumeHint)` only; commit before 1b starts. `tpl.hash` unmoved. **Docs.** IPC-CONTRACT rows first; CONTRACT: `projects[].dev_cmd` is a suggestion only, no shape change. **Not built.** No command editing, env vars, working directory choice, auto-restart.

## Dish 1b-1: Launcher core and IO (M, no renderer)

**Create.** `dashboard/launcher-core.mjs` (pure), `dashboard/launcher.js` (IO shaped like `crew.js`; every dependency, the data directory and the Documents root injected, nothing hard-coded), `launcher-core.test.mjs`, `launcher.test.mjs`, `launcher.native.check.js` (dialog cancel, `wt.exe -d`, an editor given a folder).

**Core rules.** `validateEntry`: absolute drive-letter path equal to its `path.win32.normalize`; kind `folder|file|app|url`; refuses UNC and device paths, alternate streams, 8.3 names, trailing dot or space, reserved device names, non-fixed drives. App: `.exe` only, minus a deny list (`cmd powershell pwsh wscript cscript mshta rundll32 regsvr32 msiexec bash wsl msbuild`) that also applies to the editor. File and folder go to `shell.openPath` only for a document or media extension; `exe bat cmd ps1 lnk vbs js hta msi scr reg jar url com` are refused with a short why. Names are the basename; ids are random. Url: `new URL`, https or loopback `http`, no userinfo; a shortcut file is read with a 4 KB cap, only the `URL=` line; the card shows the host only.
**Every launch re-checks:** lstat, realpath equals stored path, no reparse point, file or directory by kind, extension still allowed. Entries are re-validated on every read and HMAC-signed with a `safeStorage` key; a failing entry is dropped. Store `data/launcher/entries.json`, cap 40.
`folderArg`: passes the injected project-path check, realpath equals the resolved path, a directory, no leading dash; for the terminal no `;`, `%` or control character (Windows Terminal reads `;` as a command separator; the terminal is skipped with a plain word). `wt.exe` resolves once to the fixed WindowsApps location (alias exception written in code). Editor `[exe, folder]`; terminal `['wt.exe','-d',folder]` else the console with `cwd`.

**IPC** (main window only, fixed-word answers never paths, per-hour limits in memory):

| Channel | Arguments | Checks and limit |
|---|---|---|
| `hq:launcher:read` | none | entries, editor, project rows (id, name, dev state) |
| `hq:launcher:add` | `{kind}` | main opens the dialog; 20; cancel gives `cancelled` |
| `hq:launcher:remove` | `{id}` `^[a-z0-9]{8,16}$` | 30 |
| `hq:launcher:set-editor` | `{id}` | an existing app entry; 10 |
| `hq:launcher:open` | `{id}` | one at a time; 30; app is a bare spawn, no arguments |
| `hq:launcher:open-workspace` | `{projectId}` | project in `latest.json`, folder checks above; one at a time (lock shared with 1c); 10 |

**Marks and audit.** `launcher-workspace`/`act` joins `SURFACES`, written by main only, and only when the dev or editor step really started (a terminal-only launch writes none). One names-only audit line per call. The renderer writes no mark.

**Result.** Steps run dev, editor, terminal; a failed or skipped step never stops the next. The answer `{ok, steps:[{step, state}]}` shows as ONE inline line under the button, no dialog. Sentences: "Dev server: started", "Dev server: already running", "Dev server: not allowed yet" with Allow and run, "Dev server: can't run this command", "Editor: none chosen. Pick one in Launcher", "Editor: didn't open", "Terminal: skipped, the folder name has a symbol Windows Terminal can't take", and "Folder not found: rescan" (all three skipped). A repeat click reuses the dev server, reopens the editor, opens a new terminal window.

**Not built.** No Jump launching, entry arguments, scripts, drag-and-drop, MCP tool. **Docs.** IPC-CONTRACT first; HANDOFF "not verified in the gate": `wt.exe -d`, an editor taking a folder, the file dialogs; owner check is one Open workspace click on a throwaway folder where the editor, terminal and dev server each appear.

## Dish 1b-2: Launcher screens (M)

**Owner sees.** Settings > Launcher: Entries (icon, name, Remove; four add buttons that open the system dialog: folder, file, app, link by picking an internet shortcut file); "My editor" and "My terminal" (the app dialog opens at the usual install folder; the owner still picks the file); "Allowed commands" (per project the scanned command as text, "Allow this command" or "Allowed", "Remove permission", a refused one says why). Project page: "Open workspace" beside Resume. Ctrl+K: "Open workspace · <project>" under Do, and "Set up Launcher" only while no editor is chosen. Fresh build: 3 clicks to dev server plus terminal.

**Create.** `src/logic/launcher.js`, `vals/launcher.js`, `tpl/launcher.tpl.js`, `tools/launcher-fixture.mjs` (paste tool, drift test), `src/selftest-launcher.mjs`, `tools/cdp-launcher.mjs`. **Edit.** `src/app.js`, `src/vals/index.js`, `src/tpl/ov-settings.tpl.js`, `src/tpl/project-page.tpl.js`, `src/vals/project-page.js`, `src/logic/palette.js`, `tools/cdp-gate.mjs`, `selftest.js`, `fake-preload.js`.

**Vals key.** `lnchv`; the button nests as `pg.workspace` (`{on, label, busy, line}`), nothing in `projCards`. renderVals 988 at the last reading, 989 expected; re-read at start.

**Tests.** Selftest rows (invented names): off, loading, error, empty, ready, unallowed, refused, editor set. cdp: `launcher-render`, `-add`, `-remove`, `-allow-command`, `-open-workspace` (order, one mark), `-refuse`, `-palette`, `-setup-row`.

**Goldens.** Take the before dump after 1a's committed golden. Allowed: `^lnchv(\.|$)`, `^pg\.workspace`, palette rows only if the golden has a project query. `tpl.hash` moves for `ov-settings` and `project-page` only. `golden-diff.mjs --allow`, update only on exit 0. **Docs.** CLAUDE.md Batch 9 line, no real names. **Deleted first on a miss:** the Brief verb, then the add buttons.

## Dish 1c: Brief verb "open workspace" (S, own release)

**Owner sees.** On the `dirty` Brief row a second button "Open workspace", offered and accepted only while that project's command is allowed. Own bar: an act mark from a Brief row.

**Edit.** `brief-act-core.mjs` (`VERBS`, `planAct` new plan kind, additive `secondary` field since `dirty` already carries `commit`), `brief-act.js` (injected `openWorkspace` seam taking a project id only; `planAct` re-looks the id up in current `latest.json` and re-resolves the folder; the sender check is inside this path; the id comes from the item's `action` field, never the key), `dashboard-v5/src/logic/brief-act.js`, `main.js` (one line). Table entry `marks:false`; the launcher writes its own act.

**Tests.** Four-table parity, stale-key refusal, one launcher call and one mark per click; `brief-act.test.mjs`, `act-marks.test.mjs` (a `marks:false` verb must not trip 183 to 192), `cdp-brief-act*`, cdp `brief-open-workspace`. **Goldens.** `^briefRows\[\d+\]\.verbs`. **Not built.** No new rule or toast.

## Batch-done checklist

- `node tools/gates.mjs` green; `--native` after the other fleet is done.
- Privacy scan: 0 hits.
- `BUILD_STAMP` `2026-11-17.batch9` in `dashboard-v5/src/live/build-stamp.mjs`, set at the close only.
- renderVals quoted from the gate (expected 989 of 1015). Use report quoted, counts only.
- Act bar: 3 or more Open workspace acts on 3 separate days in 7. The window starts the day the stamped build runs and the first real click works; read 2026-11-24 at the earliest, again if short. A short bar delays the next stage; deletion needs the owner's yes.
- HANDOFF entry (with the not-verified paragraph), CONTRACT, IPC-CONTRACT, CLAUDE.md Batch 9 line.

## Only the owner can decide

1. Extend the runner list (`python`, `vite`, `next`, `deno`, `dotnet`)? Default no; refusal is visible and the terminal step still runs.
2. Auto-allow the collector's own `npm run dev`? Default no; one in-place click per project.
3. Link entries: default pick an internet shortcut file.
4. Editor: default none until picked through the dialog; no silent detection.
5. Terminal: Windows Terminal if found, else the console.
6. A failed step: continue, report each.
7. Brief rule for the verb: `dirty`, own release.
8. Sender check on all of `hq:brief:act`: default only the new verb; other ungated channels not this batch.
9. Terminal-only launches count as acts? Default no.

## Red-team notes

**Safety.** The allowed string is bound to folder, scripts and `.npmrc`, because what runs is the project's own scripts (`collector.mjs:390` sets `dev_cmd` to the literal `npm run dev`). A per-runner grammar replaces the character filter. `fromMain` checks `senderFrame`; `hq:brief:act` has no sender check today, so 1c carries its own. **Build.** Unit tests prove argv and checks, not cmd.exe, `wt.exe` or dialogs: native checks and one owner click do. If the amended wording and "nothing is deleted without a yes" disagree, the README sentence wins.
