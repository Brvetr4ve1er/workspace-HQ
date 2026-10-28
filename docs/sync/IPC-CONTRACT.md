# IPC contract — `window.hq` bridge

The single reference for every channel between the Electron main process and any
renderer surface. **Names and argument shapes listed here are frozen for the
whole NEXUS v3 program (additive-only).** New channels get a row here BEFORE the
code lands, same rule as data shapes in `CONTRACT.md`.

Normative sources: `dashboard/preload.js` (renderer-facing signatures) and
`dashboard/main.js` (handlers + return shapes; line refs below drift with edits —
grep the channel name).

## The v3 swap story (why this doc exists)

- **Pre-swap (M0):** `legacy/dashboard-v3/dev-main.js` registers **no** IPC handlers.
  Ported realms must feature-detect (`window.hq?.markQuestDone`) and no-op
  gracefully — this is what makes renderer-only screenshot parity possible.
- **At swap:** the real `main.js` loads `legacy/dashboard-v3/index.html` with the
  **existing** `dashboard/preload.js`. Every channel below is already
  registered — the swap itself requires zero IPC changes.
- `legacy/dashboard-v3/preload.js` exists only for the dev harness (`hqv3.dev = true`).
- **Since 2026-10-06:** v5 (`dashboard-v5/`) is the default renderer. v2–v4 are
  quarantined in `legacy/dashboard-v2|v3|v4/` and load only as a rollback
  (`data/.ui-version` = `v2`|`v3`|`v4`, written by `tools\rollback.ps1 v3`). Every
  renderer still runs on `dashboard/preload.js`, so a rollback needs no IPC change.

## Invoke channels (renderer → main, `ipcRenderer.invoke`)

| `window.hq` method | Channel | Args | Returns | Primary surface |
|---|---|---|---|---|
| **Scan & project ops** | | | | |
| `runScan()` | `hq:scan` | — | `true` (fire-and-forget; results arrive via rebuilt `data.js` + reload) | main |
| `openRepo(relPath)` | `hq:open-repo` | project-relative path | — | main |
| `openFile(projPath, fileRel)` | `hq:open-file` | abs project path, relative file | — | main |
| `reclaim(projPath, dirNames)` | `hq:reclaim` | abs path, dir names[] | async result | main |
| `snapshot(projPath, name)` | `hq:snapshot` | abs path, snapshot name | async result | main |
| **Capture** | | | | |
| `captureSave(text)` | `hq:capture-save` | brain-dump text | `true` \| `false` (empty text) — appends to `data/brain-dump.json`, re-assembles, reloads | v3 `capture:note` action (Med-Bay "Note for cleanup", HOME suggestion card's "Capture" outcome) — the frameless Ctrl+Alt+Space window and `hq:capture-cancel` were retired 2026-09-15 |
| **Claude** | | | | |
| `claudeQuest(projPath, prompt)` | `hq:claude-quest` | abs path, prompt | — (spawns terminal session) | main |
| `draftCommit(projPath)` | `hq:draft-commit` | abs path | `{message, via:'local:<runtime>'\|'claude'}` \| `{error}` — local model first (30 s), Claude CLI fallback (90 s); async | main |
| `doCommit(projPath, msg)` | `hq:do-commit` | abs path, message | commit result | main |
| **Journal** | | | | |
| `logDecision(projId, text)` | `hq:log-decision` | id, text | — | main |
| `learn(projId, text)` | `hq:learn` | id, text | — | main |
| **Project lifecycle** | | | | |
| `archiveProject(id)` | `hq:archive-project` | project id | — | main |
| `reviveProject(id)` | `hq:revive-project` | project id | — | main |
| **Quests** | | | | |
| `markQuestDone(id)` | `hq:quest-done` | quest id | `true`/`false` | main |
| `actedOn(entry)` | `hq:acted-on` | ledger entry object (normalized main-side) | `true`/`false` | main |
| **Dev servers** | | | | |
| `devStart(id)` | `hq:dev-start` | project id | — | main |
| `devStop(id)` | `hq:dev-stop` | project id | — | main |
| `killServers()` | `hq:kill-servers` | — | — | mini HUD |
| **Notes** | | | | |
| `saveNote(id, note)` | `hq:note-save` | project id, note text | — | main |
| **Spellbook (casting engine)** | | | | |
| `castSpell(id, confirmedHash, opts)` | `hq:spell-cast` | spell id, content hash (confirm gate), opts | cast start result | main + cast palette |
| `cancelCast(id)` | `hq:spell-cancel` | spell id | — | main + cast palette |
| `getSpellbook()` | `hq:spellbook-get` | — | spellbook object | main + cast palette |
| `favoriteSpell(id)` | `hq:spell-favorite` | spell id | — | main |
| `rescanSpellbook()` | `hq:spellbook-rescan` | — | async rescan result | main |
| `getSpellTelemetry()` | `hq:spell-telemetry` | — | telemetry object | main |
| `hideCastPalette()` | `hq:cast-palette-hide` | — | `true` (closes window) | cast palette |
| **Organic UI (shards)** | | | | |
| `shardSummon(text)` | `hq:shard-summon` | summon prompt | shard id `string` (spawned) \| `{ok:false, reason, message}` (nothing to show — palette stays open) \| `false` (empty text). Since 2026-10-07, see the MAIN package section | summon palette |
| `shardSummonCancel()` | `hq:shard-summon-cancel` | — | `true` (closes window) | summon palette |
| `shardClose()` | `hq:shard-close` | — (sender-scoped) | `true` | shard |
| `shardSave(patch)` | `hq:shard-save` | patch object (sender-scoped) | — | shard |
| `shardLibSpawn(key)` | `hq:shard-lib-spawn` | library key | — | main + shard |
| `shardLibDelete(key)` | `hq:shard-lib-delete` | library key | — | main + shard |
| `shardRegen()` | `hq:shard-regen` | — (sender-scoped) | — | shard |
| **Mini HUD** | | | | |
| `getMiniData()` | `hq:mini-data` | — | `miniPayload()` object | mini HUD |
| `showMain()` | `hq:show-main` | — | `true` | mini HUD |
| `miniHide()` | `hq:mini-hide` | — | `true` | mini HUD |
| **Claude sessions (MA)** | | | | |
| `getSessions()` | `hq:sessions-list` | — | `[{jobId, label, status, startedAt, endedAt, exitCode, tail}]` (`tail` is untrusted text; for `sessionStart` jobs it is PARSED — see the tail note below) | main |
| **The Canvas (M3)** | | | | |
| `getCanvas()` | `hq:canvas-read` | — | `[{name, nodes, edges}]` (JSON Canvas boards from `data/canvas/`) | main |
| `canvasAdd(name, node)` | `hq:canvas-add` | board name (`[\w][\w -]{0,63}`), `{type:'text', text, x?, y?}` | `true`/`false` (text clamped 2000; atomic write; watcher pushes) | main |
| **Claude sessions (v4 SPINE B3, `dashboard/session-api.js`)** | | | | |
| `sessionStart(opts)` | `hq:session-start` | `{cwd, task, label?}` — cwd containment-checked under the Documents root (same rule as `resolveProjectPath`), task truncated at 2,000 chars, label defaults from task; NO command/args passthrough; headless print mode (since 2026-08-19 main passes the fixed args `claude -p --output-format stream-json --verbose`, task still via stdin), main-side 15-min timeout | `{jobId}` \| `{error}` | v4 WORK |
| `sessionKill(jobId)` | `hq:session-kill` | jobId | `true`/`false` (never throws) | v4 WORK |
| `sessionDiff(opts)` | `hq:session-diff` | `{cwd, jobId?}` (containment-checked as above; `jobId` optional — pass it to get the dispatch-time baseline) | `{files:[{path,status}], stat, baseline}` (git `status --porcelain` + `diff --stat`, no shell) \| `{error}` | v4 WORK |

**`hq:session-diff` baseline (added 2026-08-13, additive).** `hq:session-start`
records a **dispatch-time working-tree snapshot** as a side effect: it runs the
same `git status --porcelain` in the contained `cwd` *before* spawning the
session, and keys the resulting path set by `jobId` (LRU-capped, in memory,
never persisted). `hq:session-diff` echoes it back so a renderer can tell the
session's work apart from dirt that was already there:

| `baseline` value | Meaning |
|---|---|
| `{state:'captured', paths:[…]}` | Paths dirty in that cwd at dispatch. Anything in `files` but not in `paths` changed **after** dispatch (by the session or by anything else touching the tree in that window). |
| `{state:'unavailable', error}` | Baseline probe failed at dispatch (not a git repo, git missing). Attribution is unknown — callers MUST NOT present `files` as the session's work. |
| `{state:'none'}` | No `jobId` supplied, or the job is not one this main process started/still remembers. Same rule: attribution unknown. |

`stat` stays **whole-working-tree** `git diff --stat` output — it is NOT split by
the baseline; label it as such wherever it is rendered. A main process older than
this row omits `baseline` entirely; treat a missing field as `{state:'none'}`.
| **Browser bridge** | | | | |
| `getBrowserLive()` | `hq:browser-live` | — | live activity object \| `null` | main |
| **Social bridge** | | | | |
| `getSocial()` | `hq:social-read` | — | `{inbox, outbox, accounts}` from `data/social/*` (read-only snapshot) \| `null` | main (SOCIAL realm) |
| **PC-Brain — local model (owns `dashboard/llm-local.js`, `dashboard/llm-context.js`)** | | | | |
| `probeLlm(opts?)` | `hq:llm:probe` | `{force?:boolean}` | `{available, runtime?:'ollama'\|'lmstudio', endpoint?, models?:[{id,size}], reason?}` — cached 30 s unless `force` | Med-Bay status row, ORACLE realm |
| `llm.warm()` | `hq:llm:warm` | — | `{status:'warm'\|'skipped'\|'unavailable'\|'error', model?, reason?}` — loads the chat model into VRAM (8k ctx, keep_alive 30 m); coalesced, ≤ 1 load/min | ORACLE realm |
| `llm.chat(req)` | `hq:llm:chat` | `{jobId:/^[a-z0-9-]{4,40}$/i, messages:[{role:'user'\|'assistant', content}] (≤20, ≤4000 chars each, last must be user), include:{scan,tasks,projects,health,browser,vault: boolean}}` | `{status:'done'\|'cancelled'\|'error'\|'unavailable', output, reason?, runtime?, model?, sections:[{id,label,chars,clipped,note?}], contextChars, ms}` — main builds the grounding CONTEXT itself; the renderer never sends one. Model output is shown ONLY in the ORACLE realm (ambient-companion honesty boundary) | ORACLE realm |
| `llm.cancel(jobId)` | `hq:llm:cancel` | job id | `true` if a running job was aborted, else `false` | ORACLE realm |
| **v3 STUDIO — screen capture (owns `dashboard/screen-capture.js`)** | | | | |
| `studio.panelToggle()` | `hq:studio:panel-toggle` | — | `true` (shows/hides the FloatingPanel; creates it on first call). While a recording runs it is show-only (show + focus, never hides): the panel is then the live pill, the recording's visible stop control (2026-10-06) | tray / hotkey / STUDIO realm |
| `studio.snipArm(kind)` | `hq:studio:snip-arm` | `{kind:'region'\|'full'\|'window'}` (default `'region'`) | `true` — main freezes every display via `desktopCapturer.getSources` at each display's native pixel size, spawns one transparent overlay BrowserWindow per Display, and pushes the freeze on `hq:studio:snip-frozen` | panel / Ctrl+Alt+S / STUDIO realm |
| `studio.recSources()` | `hq:studio:rec-sources` | — | `[{sourceId, displayId, label, primary, kind:'screen'\|'window', thumbnail (dataURL), width, height}]` — joined `getSources({types:['screen','window']})` × `screen.getAllDisplays()` on `display_id` | FloatingPanel |
| `studio.recStart(opts)` | `hq:studio:rec-start` | `{sourceId, mic, sysAudio, fps, sourceLabel?}` | `{recId, tmpPath}` \| `{error}` — opens `<slug>.webm.part` write stream and starts the 30-min auto-split + disk-space watchdog | FloatingPanel |
| `studio.recStop(recId)` | `hq:studio:rec-stop` | `{recId}` | `{path, bytes, durationMs, gaps, reason}` \| `{path:null, error, partPath, bytes, durationMs, gaps, reason}` (failed save) \| `null` — flushes, `fsyncSync`, renames `.part`→`.webm`, then emits `studio:capture-added`. On a failed rename it keeps the bytes in `partPath` (recovered as `.recovered.webm` at the next launch), emits no `capture-added`, and `error` says why. See the v5 rows below | FloatingPanel / record panel |
| `studio.recToggle(opts?)` | `hq:studio:rec-toggle` | `{sourceId?, mic?, sysAudio?, fps?, sourceLabel?}` (opts optional) | `{toggled:'stopped', recId}` \| `{toggled:'panel-opened'}` \| `{recId, tmpPath}` — hotkey path; stops the first live recorder or starts one with saved defaults, opens the panel if no source is configured (show-only since 2026-10-06: a second press keeps the setup card up instead of hiding it) | Ctrl+Alt+R / panel |
| `studio.libraryList(query)` | `hq:studio:library-list` | `{kind:'shot'\|'rec'\|'all'\|'recovered', limit}` | `[{kind, recovered, path, name, size, mtimeMs, thumbDataUrl}]` sorted newest-first | STUDIO realm |
| `studio.libraryReveal(path)` | `hq:studio:library-reveal` | absolute path | `true`/`false` — refuses anything outside the resolved library root before it reaches `shell.showItemInFolder` | STUDIO realm |
| `studio.libraryDelete(path)` | `hq:studio:library-delete` | absolute path | `true`/`false` — same containment check; `shell.trashItem` + best-effort thumb sidecar | STUDIO realm |
| `studio.settingsGet()` | `hq:studio:settings-get` | — | `{rootOverride, defaultFps, hotkeysEnabled, defaultSourceId, defaultMic, defaultSysAudio, panelPosition}` (persisted at `userData/studio-settings.json`) | STUDIO realm / panel |
| `studio.settingsSet(patch)` | `hq:studio:settings-set` | partial of the above (whitelisted keys only) | full settings after merge | STUDIO realm / panel |

**Overlay-only channels (`ipcRenderer.send`, no invoke shape).** These flow between
the snip overlay window and main; the STUDIO realm never uses them.

| `window.hq.studio` method | Channel | Direction | Payload |
|---|---|---|---|
| `studio.snipCommit(payload)` | `hq:studio:snip-commit` | overlay → main | `{displayId, rectDIP:{x,y,w,h}, mode:'region'\|'full'\|'window'}` — main crops the frozen buffer via `nativeImage`, atomic-writes `<slug>.png`, writes thumb sidecar, copies to clipboard, emits `studio:capture-added` |
| `studio.snipCancel()` | `hq:studio:snip-cancel` | overlay → main | — (Esc; main closes every overlay and re-shows the panel) |
| `studio.recChunk(recId, seq, buf)` | `hq:studio:rec-chunk` | panel → main | `{recId, seq, buf:ArrayBuffer}` — main queues per-recId, appends in order to the open write stream; backpressure surfaces as a `rec-status` `state:'backpressure'` push |
| `studio.recAbort(recId)` | `hq:studio:rec-abort` | panel → main | `{recId}` — closes the stream and unlinks the `.part` |

## Push channels (main → renderer, subscribe via `window.hq.on*`)

Every subscription helper returns an **unsubscribe function** — v3 realm
`unmount()` MUST call it (v2 never unmounts, v3 does; leaking listeners across
realm switches is the #1 porting hazard).

| Subscription | Channel | Payload | Fires when |
|---|---|---|---|
| `onDevStatus(cb)` | `hq:dev-status` | dev-server status | server start/stop/exit |
| `onCastOutput(cb)` | `hq:cast-output` | stream chunk | spell process emits output |
| `onCastDone(cb)` | `hq:cast-done` | settlement result | cast finishes |
| `onShardInit(cb)` | `shard:init` | shard config/state | shard window boots |
| `onMiniUpdate(cb)` | `hq:mini-update` | mini payload | mini HUD data refresh |
| `onMachine(cb)` | `hq:machine` | machine vitals | vitals poll tick |
| `onBrowserTab(cb)` | `hq:browser-tab` | active-tab event | bridge extension reports focus |
| `onClaudeSessions(cb)` | `hq:claude-sessions` | full sessions list | any registry change (start/stream-end/linger-expiry) |
| `onCanvas(cb)` | `hq:canvas` | full boards list | any `.canvas` file change in `data/canvas/` (300ms debounce) |
| `onSessionOutput(cb)` | `hq:session-output` | `{jobId, chunk}` (chunk is untrusted text — render via `textContent`/`esc()` only; since 2026-08-19 chunk is PARSED text, see note below) | a `sessionStart` session emits stdout/stderr |
| `llm.onDelta(cb)` | `hq:llm:delta` | `{jobId, text}` — the ACCUMULATED answer so far (not an increment), throttled ~25/s, so a realm that re-mounts mid-answer re-attaches cleanly. Untrusted model text — render via `mdLite()`/`textContent` only | an `llm.chat` job streams tokens |
| `studio.recStatus(cb)` | `hq:studio:rec-status` | `{state:'recording'\|'backpressure'\|'drained'\|'stopped'\|'aborted'\|'auto-split'\|'stopped-lowdisk'\|'error', recId, elapsedMs?, bytes?, sourceLabel?, mic?, sysAudio?, lastPath?}` | 1 Hz push while any recording is live, plus one-shot state transitions |
| `studio.onCaptureAdded(cb)` | `studio:capture-added` | `{kind:'shot'\|'rec', path, at, durationMs?, bytes?}` | atomic write of a shot or recording finishes; STUDIO realm prepends a tile without polling |
| `studio.onSnipFrozen(cb)` | `hq:studio:snip-frozen` | `{displayId, pngDataUrl, bounds, scaleFactor, kind, displayIndex}` | overlay window is ready; main hands it the freeze so the paint is real pixels |
| `studio.onOpenRealm(cb)` | `hq:studio:open-realm` | `{at}` | Ctrl+Alt+L pressed; renderer routes v3 to the STUDIO realm |

**`hq:session-output` payload semantics (2026-08-19, additive — shape unchanged).**
The channel and payload keep the exact same shape: `{jobId, chunk}`, `chunk` a
string. What changed is what main feeds into it: `session-api.js` now launches
sessions with `claude -p --output-format stream-json --verbose` and runs the
raw stdout through a pure line parser (`dashboard/stream-parse.js`) BEFORE
pushing. So `chunk` carries assistant text plus one-line bracketed tool notices
(`[tool: Read C:\...\file.js]`) instead of raw JSON lines:

- Assistant `text` content blocks are emitted as-is (newline-terminated).
- `tool_use` content blocks become one-line `[tool: <name> <hint>]` notices.
- Complete lines that are NOT valid JSON (stderr, CLI banners) pass through
  verbatim — never dropped, the parser never throws.
- Partial lines are buffered until their terminating newline arrives (a
  trailing unterminated line is flushed when the process ends).
- Known protocol events with no user-facing text are filtered by design:
  `system` init and `user` tool-result echoes.
- The final `result` event is filtered **only when the run succeeded** (it
  duplicates the assistant text already emitted). Amended 2026-08-19 (D2 fix
  wave): a FAILED result — `is_error: true`, or an `error*` subtype such as
  `error_during_execution` / `error_max_turns` — emits a one-line
  `[error: <subtype>]` notice plus its `result` string when it carries one.
  On a failed run there is no assistant text for it to duplicate, and it is
  frequently the ONLY diagnostic the run produces; filtering it left the user
  with a red "Failed · exit N" chip and no reason.

`chunk` remains untrusted text: `textContent`/`esc()` only, as before.

**Registry `tail` for `sessionStart` sessions (2026-08-19, additive — shape
unchanged).** Supersedes the earlier note that called a stream-json `tail`
"cosmetic": it is not, because two renderer surfaces DISPLAY `tail` verbatim
(`legacy/dashboard-v4/src/surfaces/work/agent-pane.js`,
`legacy/dashboard-v4/src/surfaces/automate/sessions.js`, plus v3's summoning realm),
and `hq:capture-save`/`hq:scan` reload the window — which wipes the renderer's
live output buffer while the session still lingers ~60 s in the registry. The
next look at that session therefore falls back to `tail`, and a raw one would
be a wall of `{"type":"assistant",…}`.

`claude-sessions.js` is unchanged (READ-ONLY by program constraint) and still
buffers RAW output. `dashboard/session-tails.js` keeps a parallel PARSED tail
(same ~800-char rolling window) for jobs started via `hq:session-start`, fed by
the same `stream-parse.js` pass that feeds `hq:session-output`; `main.js` swaps
it into the `tail` field on the way out of BOTH `hq:sessions-list` and the
`hq:claude-sessions` push.

| `tail` value | When |
|---|---|
| PARSED text (assistant text + `[tool: …]` / `[error: …]` notices), possibly `''` | job started by `hq:session-start` in this main process |
| RAW process output, exactly as before | every other job (`hq:claude-quest`, `draft-commit`, jobs from an earlier main process) |

An empty parsed tail is returned as `''` rather than falling back to the raw
one — the panes' honest "no output reached this window" state is correct, and a
JSON wall is not. The registry's `[timeout]` marker (written straight into its
own buffer, so the parser never sees it) is carried across. `tail` stays a
string and stays untrusted; a main process older than this row returns the raw
tail as before.

## v5 clean pass — live as of 2026-10-06 (announced 2026-10-05)

New main-side logic lives in NEW files with a one-line init hook in `main.js`
(rule 2). Every row is additive; no existing channel changes meaning.

| `window.hq` method | Channel | Args | Returns | Owner file · surface |
|---|---|---|---|---|
| `uiPrefs.get()` | `hq:ui-prefs-get` | — | `{theme:'dark'\|'light'\|'os', resolved:'dark'\|'light', reduceMotion:bool}` | `dashboard/ui-prefs.js` · every window |
| `uiPrefs.set(patch)` | `hq:ui-prefs-set` | `{theme?, reduceMotion?}` (keys whitelisted, enums checked) | the full prefs object; then pushes `hq:ui-prefs` | `ui-prefs.js` · v5 Settings |
| `uiPrefs.on(cb)` | push `hq:ui-prefs` | full prefs → **every** window (`BrowserWindow.getAllWindows()`); re-sent when the OS theme changes | disposer | `ui-prefs.js` · v5 + satellites (shards/summon get `get`/`on` only, no `set`) |
| `liveState()` | `hq:live-state` | — | `{dev:[{id, since\|null}], casts:[{castId, spellId, name, icon, startedAt, chain}], scan:{state:'idle'\|'running'\|'done'\|'failed', startedAt, endedAt, code}}` — what is running *now*, so a reloaded window can rebuild its Activity rows | `dashboard/live-state.js` · v5 |
| `onScanStatus(cb)` | push `hq:scan-status` | `{state:'running'\|'done'\|'failed', startedAt, endedAt?, code?, error?}` | disposer | `live-state.js` · v5 |
| `openAt(route)` | `hq:open-at` | `{tab, sub?, projectId?, sort?}` (tab/sub `/^[a-z]{2,16}$/`, id `/^[\w.-]{1,80}$/`, sort enum) | `true`/`false`; shows + focuses the main window, then pushes `hq:navigate` | `dashboard/nav-bridge.js` · mini HUD, tray |
| `onNavigate(cb)` | push `hq:navigate` | the validated route (sent after `did-finish-load` if the window is loading) | disposer | `nav-bridge.js` · v5 (v3 ignores it) |
| `commitPreview(projPath)` | `hq:commit-preview` | abs project path (containment-checked like `resolveProjectPath`) | `{files:[{path, status, env}], stat, envHits:[path], branch}` \| `{error}` — union of `git status --porcelain -z -uall --no-renames` and `git diff --cached --name-only -z`, so files inside untracked folders are listed individually | `dashboard/commit-guard.js` · v5 commit sheet |
| `studio.recPause(recId, paused)` | send `hq:studio:rec-pause` | `{recId, paused:bool}` | — (status pushes carry `paused`; `elapsedMs` excludes paused time) | `screen-capture.js` · record panel |
| `studio.panelMode(mode)` | `hq:studio:panel-mode` | `{mode:'setup'\|'live'}` | `true` (main sets the panel bounds: setup ≈340×180, live pill ≈230×44) \| `false` (no panel window, unknown mode, or the bounds could not be set — the panel keeps its size) | `screen-capture.js` · record panel |
| `studio.onRecCommand(cb)` | push `hq:studio:rec-command` | `{cmd:'stop', reason:'hotkey'\|'lowdisk'\|'limit', recId}` → the recording's owner panel only; main hard-stops if the panel hasn't finished in 3 s (immediately when there is no panel to ask) | disposer | `screen-capture.js` · record panel |

**Additive fields on existing channels**

| Channel | Addition |
|---|---|
| `hq:do-commit` | may return `{error:'refused: .env in change set', envHits:[path]}` and stage nothing. "Env-shaped" = `commit-guard.isEnvPath()`: `.env`, `.env.<anything>`, the copies people make (`.env - Copy`, `.env~`, `.env (1)`, `.env_prod`), `<name>.env`; templates are allowed (`.env.example/.sample/.template/.dist/.defaults`, also `-`/`_` separated). A git error fails closed (`envHits:['<git error>']`). When an env file only shows up AFTER `add -A` (the post-add recheck), main resets the whole index to HEAD before refusing. If that reset fails, the error is `'refused: .env in change set — couldn’t unstage it, run git reset in the project'` (U+2019 apostrophe, exactly as `main.js` sends it), `envHits` unchanged, and the files may still be staged. Match on the `refused: .env in change set` prefix |
| `hq:sessions-list`, `hq:claude-sessions` | entries started via `hq:session-start` gain `cwd` (side table in `session-tails.js`; `claude-sessions.js` untouched) |
| `hq:spell-telemetry` | (K-6) each rollup entry gains `last_outcome` (`'ok'`\|`'failed'`\|`'channeled'`\|`null`), `last_exit` (number\|`null`) and `last_outcome_at` (ISO `started_at` of that cast\|`null`), read from the newest entry in `casts[]` (casts are pushed when they END; `resolved`→`ok`, `fizzled`→`failed` incl. timeouts, `channeled`→`channeled`). Nothing new is persisted. A spell whose casts all failed (the rollup only counts successes) gets a view-only entry `{last_cast:null, lifetime_casts:0, distinct_days:0, …}`; `last_cast` stays the SUCCESS watermark, so "failed 2d ago" reads `last_outcome_at`. Absent fields = older main |
| `hq:mini-data`, `hq:mini-update` | (K-6) gain `uncommitted` (uncommitted FILES summed over projects, `git_safety.dirty`), `secrets` (`risk_security.secrets_found` summed), `unpushed` (number of PROJECTS with unpushed commits) — the same `tray-menu.js` `scanCounts()` numbers as the tray status line — and `topQuest.projectId` (string\|`null`), `topQuest.project` (project name\|`null`). Consumers tolerate absence (older main) |
| `hq:scan` | returns `runScan()`'s boolean instead of a constant `true`: `false` = no scan started (one is already running — `hq:live-state` `scan.state === 'running'` — or the pipeline could not be spawned). v3/v4 ignore the value; v5 toasts "A scan is already running" |
| `hq:claude-quest` | returns `true` (terminal opened) \| `false` (path refused, folder missing, spawn failed). The launch is `dashboard/claude-launch.js` `launchClaudeTerminal(cwd, prompt)`: prompt flattened to one line, capped at 500 chars, `"` → `'`. Neither the folder nor the prompt is ever put on a cmd command line (R-P4 fix — the pre-v5 `cd /d "<cwd>" && claude "<prompt>"` argument never reached claude, and its prompt sat outside cmd's quotes, so `&`/`\|` in a quest title ran as commands): a fixed `cmd /d /v:off /c start "" cmd /d /v:off /k "<dashboard>\claude-launch.cmd"` is spawned with the project as its working directory and the prompt in env `HQ_LAUNCH_PROMPT`; the static helper runs `claude "%HQ_LAUNCH_PROMPT%"` with delayed expansion off. **Env `HQ_DRY_LAUNCH=1`** (read per call, exact value `1`): logs `[dry-launch] <cwd> :: <prompt>` to main's stdout, opens nothing, returns `true` — for gates and tests |
| `hq:studio:rec-status` | gains `paused` |
| `hq:studio:rec-stop` | the result is an object, not a bare path (it already was before v5): `{path, bytes, durationMs, gaps, reason}` \| `null`; v5 adds `gaps` (chunk gaps logged by `rec-queue.js` while draining, `null` if unknown) and `reason` (`'hotkey'`\|`'lowdisk'`\|`'limit'` for a main-initiated stop, else `null`). **Failed save** (the `.part`→`.webm` rename failed after retries): `{path:null, error, partPath, bytes, durationMs, gaps, reason}`. `error` is `'rename failed: <code> — kept as <file>.part, recovered at next launch'` and `partPath` is the absolute `.part` path. No `studio:capture-added` is emitted, and the closing `hq:studio:rec-status` push carries `state:'stopped'`, `lastPath:null` and the same `error`. A `recStop` that arrives after the recording finished returns the remembered result (success or failure), not `null`. Check `path`: a falsy `path` with `error` means "not saved" |
| `hq:studio:snip-frozen` | gains `projects:[{id, name}]` (for the send-to-Claude picker); `[]` unless main wired BOTH K-5 functions — the overlay disables send-to-Claude (and says why) on an empty list |
| `hq:studio:snip-commit` | gains `action:'save'\|'copy'\|'claude'` and `projectId`; absent `action` = today's save+copy. `copy` writes no file; `claude` saves, then resolves `projectId` main-side (paths never come from IPC) and launches with `Look at this screenshot: <abs path> — ` |
| `hq:studio:rec-command` payload | carries `recId` (see the row above) |
| `hq:studio:settings-get`, `hq:studio:settings-set` | `rootOverride` reads back the library root actually in use: **env `HQ_STUDIO_ROOT`** (absolute path, read once at launch, never saved) wins over the saved value. `settings-set` still refuses `rootOverride` (it bounds library-reveal / library-delete), so tests point the library elsewhere with the env var and confirm via `settings-get` before recording |
| `hq:log-decision` | also appends `{id, date, text, completed:false, kind:'decision'}` to `data/project-notes.json` (frontend-owned store) so the journal can show decisions |

**Main-internal seams (not IPC — init contracts between main.js and its helper modules)**

| Contract | Shape | Notes |
|---|---|---|
| **K-5** `screenCapture.init(opts)` (main.js → `screen-capture.js`) | gains `opts.getProjects()` → `[{id, name, path}]` and `opts.launchClaude(cwd, prompt)` → boolean | `getProjects`: the projects of the latest `latest.json`, `path` absolute and containment-checked via `resolveProjectPath` (entries without a resolvable path are dropped; `[]` with no scan). `launchClaude`: re-resolves `cwd` the same way, then `launchClaudeTerminal` — `false` when refused or failed; honours `HQ_DRY_LAUNCH=1`. Either may be absent (older main): screen-capture must then deny the claude action honestly ("not wired"), never fake success. Feeds `hq:studio:snip-frozen` `projects` (send `{id, name}` only — paths stay main-side) and `hq:studio:snip-commit` `action:'claude'` + `projectId` |
| **K-7** record panel ↔ `screen-capture.js` | `hq:studio:rec-pause`, `hq:studio:panel-mode`, push `hq:studio:rec-command` (rows above) + `hq:studio:rec-status` `paused` | the handlers live INSIDE `screen-capture.js` (registered by its `init`), not in main.js; the preload methods `studio.recPause` / `panelMode` / `onRecCommand` already exist |
| **Tray** (main.js `buildTrayMenu` → `tray-menu.js` `trayTemplate`) | disabled status line `lv N · X uncommitted · Y secret(s)` · Show workspace-hq · Scan now (uses Claude) · Mini HUD ☑ · Quick-run… · Summon… · Run ▸ favourites + Open Automations · ─ · Quick actions (only those that apply) · ─ · Quit | Show → `openAt({tab:'home'})`, Open Automations → `openAt({tab:'automations'})` (v3 ignores the push and only shows the window); the tray icon click still just shows the window. Not a channel — listed so the satellites agree on the numbers |

**HTTP (browser extension, `dashboard/social-bridge.js`)**: `POST /social/outbox/cancel`
`{id}` → `{ok, id, status:'canceled'}`; only `staged` entries change (any other
status → 409 `{ok:false, error:'not staged', id, status}`, file untouched), an unknown id
is 404, a missing id or bad JSON 400, an oversized body 413, a missing/invalid token 403.
The canceled entry gains an optional `canceled_at` (ISO). `canceled` is terminal: `GET /social/outbox` stops listing
it and `/result` ignores it. Cancelling never publishes (CONTRACT.md write-gate
amendment lands with it).

## 2026-10-07 — post-go-live fixes (rows announced before the handlers land)

Additive only, as above. Three packages land together; each block names its owner.

### MAIN package (`dashboard/main.js`, `dashboard/app-log.js`, `dashboard/organic/summon.*`)

| `window.hq` method | Channel | Args | Returns | Owner file · surface |
|---|---|---|---|---|
| `shardSummon(text)` | `hq:shard-summon` | summon text | **Main answers before it closes anything.** A shard id `string` = spawned; main then closes the palette (the new shard's focus has usually blurred it shut already). `{ok:false, reason:'no-quest'\|'no-scan'\|'error', message}` = nothing spawned: the palette stays open and shows `message` in its footer until the text changes — `'quest'` with no open quest → `'No open quest right now'`; `'quest'`/`'hp'` before any scan → `'No scan data yet — run a scan first'`; a main-side throw → `'Couldn’t open that widget'`. `false` = empty text (unchanged). The failure object is truthy: callers test `typeof r === 'string'` | `main.js` summonWidget · `organic/summon.js` |

**Additive values on existing channels**

| Channel | Addition |
|---|---|
| `hq:do-commit` | Every git call now has a deadline and fails closed, like `commit-guard.js`: `git add -A` 60 s, the post-add `git diff --cached` recheck 15 s, `git commit` 120 s (commit hooks run inside it). On Git for Windows, `git` on PATH is a launcher (`cmd\git.exe`) and spawnSync's timeout kills only the launcher; the real git and its hooks kept going and a timed-out commit landed afterwards (2026-10-07 gate). So on a timeout main also stops the launcher's child processes (trees included) before it answers, and a timed-out add/commit does not complete later. New `{error}` strings: `'git add timed out after 60 s — nothing committed, nothing left staged'` or `'git add timed out after 60 s — nothing committed; files may still be staged, run git reset in the project'` (after stopping git, main puts the index back to HEAD with `commitGuard.unstageAll`, as the .env refusal does, and says whether that worked); `'git commit timed out after 120 s and was stopped — check the project’s git status and log before retrying'` (a stop that lands mid-write is undefined, so no rescan runs and the files stay staged). A recheck timeout is a git error, so it takes the existing fail-closed refusal (`envHits:['<git error>']`). A failed commit with no git output now returns `'git commit failed'`; before this it returned `error:''`, which the v5 commit sheet read as success |

**Main-internal (not IPC)**

| What | Shape |
|---|---|
| Lifecycle log `dashboard/app-log.js` (init hooks in `main.js`) | One JSON line per event in `logs/app-YYYY-MM-DD.log` (LOCAL date; `logs/` is gitignored): `{ts (local ISO + offset), event, pid, …}`. Events: `start` {version, electron, renderer, flags, prev} · `second-instance` {flags} · `second-launch-exit` {flags} · `render-process-gone` {window, reason, exitCode} · `child-process-gone` {type, reason, exitCode, name} · `unresponsive` / `responsive` {window} · `session-end` {window} · `suspend` / `resume` / `shutdown` · `uncaughtException` / `unhandledRejection` {error:{name, code?, message, stack}} · `alive` every 15 min {uptimeMin, rssMb, heapMb} · `before-quit` / `will-quit` {reason} · `quit` {exitCode, reason} · `exit` {code} (only when no `quit` line) · `log-capped` {maxBytes}. `reason` = `'tray'` \| `'session-end'` \| `'shutdown'` \| `'second-launch'` \| `'unknown'` (never guessed). Lines from a process that lost the single-instance lock carry `secondary:true`. `prev` = the previous primary run's last line `{pid, event, ts, clean}` (`clean` = it ended on `quit`/`exit`) or `null`. A hard kill (`Stop-Process`, `tools\rollback.ps1`, a native crash, power loss) writes nothing; the last `alive` brackets it. Privacy: `flags` = argv flag NAMES only; `window` = the page file (`dashboard-v5/index.html`, `organic/summon.html`), never a title; error text keeps repo paths as `<app>\…`, every other path → `<path>`; **review:** any other URL → `<url>`, an e-mail address → `<email>`, every double-quoted span → `"…"` (V8 quotes the JSON it failed to parse) and a single-quoted span over 40 chars → `'…'`. Day files older than 30 days are pruned at start (only `app-YYYY-MM-DD.log`); 5 MiB/day cap. Electron 32 emits `session-end` per window (win32) and has no `query-session-end`; `powerMonitor` `shutdown` fires on linux/darwin only. **Env `HQ_APP_LOG_DIR`** (absolute path, read at launch) moves the log; gates set it so the owner's log stays clean |
| Dev args | `--summon-open` opens the summon palette ~1.2 s after ready (for gates), next to the existing `--summon="<text>"` |
| Shards | the conjure prompt (`generateInto`) now asks for the page's tokens (`var(--card)` / `--frame` / `--text` / `--muted` / `--gold` / `--purple`, font `var(--term)`) instead of the old neon hex palette. Creations already in `data/shard-library.json` keep their old HTML until regenerated (↻) |

### STUDIO and SOCIAL packages (rows written from the code in the working tree on 2026-10-07; checked against the handlers, preload and fake-preload by the 2026-10-07 review, which also landed the fixes marked "review")

| `window.hq` method | Channel | Args | Returns | Owner file · surface |
|---|---|---|---|---|
| `studio.libraryOpen(path)` | `hq:studio:library-open` | absolute path | `true` (opened with the OS default app) \| `false` (refused) \| `{error}` (`shell.openPath` failed). Stricter than `libraryReveal`, because opening RUNS the file's handler: only a capture itself is opened, meaning a `.png` directly in `screenshots/` or a `.webm` (`.recovered.webm` included) directly in `recordings/`. It must be a regular file whose real path (links and junctions followed) stays inside the real library root. Never a dot-file, `.thumbs/`, `.meta/`, a name with `:` (NTFS stream), or a `\\?\` / `\\.\` path. **Review:** every name rule is checked again on the real path (8.3 aliases expanded — `PAYLOA~1.PNG` for `payload.pngexe` or `SECRET~1.PNG` for `.secret.png` is refused), and the real path is what `shell.openPath` receives. Other spellings (another case, URL-encoding, `file:` URLs) are refused, never reinterpreted | `screen-capture.js` openableCapture · STUDIO realm |

| Channel | Addition |
|---|---|
| `hq:studio:library-list` | entries gain `durationMs`: a number for a recording that has a length sidecar `recordings/.meta/<base>.json` `{durationMs, startedAt, bytes}`. The sidecar is written only on a clean, gap-free save, after the rename and before `studio:capture-added`, so the list re-read on that push already has it. `durationMs` is main's recorded time (pauses excluded), not the WebM's own duration. `durationMs` is `null` for shots, older recordings, `.recovered.webm`, recordings with gaps, and a sidecar whose `bytes` no longer match the file. **Review:** "clean" also means the FIRST stop was the panel's own `hq:studio:rec-stop` (a hard stop after `HARD_STOP_MS`, a vanished panel or a write error may have lost a tail, so no sidecar) and the recording never hit backpressure (the panel paused its MediaRecorder for the disk while main's clock ran); and the sidecar is written only when `recordings/.meta` really resolves inside the library root (a junction elsewhere gets nothing) |
| `hq:studio:library-delete` | also moves a recording's `.meta` length sidecar to the Recycle Bin (best effort, and only when `.meta` really resolves inside the library root), so a stale length never describes another file |

**HTTP (`dashboard/social-bridge.js`, extension token required → else 403; full status semantics in
CONTRACT.md's 2026-10-07 claim amendment):**
- `POST /social/outbox/claim` `{id, content_hash?}` (`content_hash` = sha256 hex of the payload the
  human saw). This is Approve & Send step 1, before any adapter runs. It atomically flips ONE `staged`
  action to `sending`, stamps `claimed_at`, and answers `200 {ok, id, status:'sending', claimed_at, action}`
  (the app's copy is the only one the extension may publish). Error answers: 409
  `{ok:false, error:'not staged'|'content changed', id, status}` with the file untouched, 404
  unknown id, 400 missing id / bad JSON / bad `content_hash`, 413 oversized body. A claim publishes
  nothing. `/result` now settles `sending` → `sent`|`failed` (keeping `claimed_at`), or `staged`,
  from an unreloaded 0.2.0 extension (which publishes without claiming — the relay can only record
  it) or a late report on a released claim.
- `POST /social/outbox/cancel` (amended): a `sending` entry → 409
  `{ok:false, error:'already publishing', id, status:'sending'}`, file untouched — the approved
  send already won, a Skip can't race it. Claim, cancel, result and release each read, check and
  write synchronously inside one request callback, so racing requests serialize in the relay. The
  MCP server writes the same file from another process (CONTRACT.md 2026-10-07 claim amendment).
- `POST /social/outbox/release` `{id}` is the owner's escape hatch, run by hand only: a `sending` claim with
  no result for 10 min goes back to `staged` (`claimed_at` removed, `released_at` stamped). It answers
  `200 {ok, id, status:'staged', released_at}`, or 409 `'not sending'` / `'claim still fresh'` (with
  `release_after`). A human must Approve & Send again; nothing calls it on a timer.

## 2026-10-13 — Claude Hub, phase H1 (rows written before the handler lands)

Additive only. Main-side code lives in a NEW file with one-line hooks in `main.js` (rule 2).

### Claude Hub (spec 2026-10-13-claude-hub-design.md, phase H1)

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.health()` | `hq:claude-hub:health` (invoke) | `{state:'ready'\|'indexing'\|'no-node'\|'starting'\|'down', role?:'writer'\|'reader', node, backfill?:{done,total}, counts?:{projects,conversations,messages}, dbBytes?, error?/lastError?}` — never throws; `no-node` = system Node < 22.13 or missing |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | `{event:'ready'\|'progress'\|'changed'\|'error'\|'health', data}`; `progress` = `{done,total}` (≤ 2/s), `changed` = `{ids:[conversationId]}`, `health` = `{state,node,error}` (the host itself: `starting` the moment a Hub dies and a restart is pending, then `no-node` or `down` when it settles; the Hub's own events are passed through unchanged). `changed` means the counts in `health()` moved: re-ask |

Main side: `dashboard/claude-hub-host.js` spawns `dashboard/claude-hub/hub.mjs` on the system Node
(`HQ_HUB_NODE` overrides the binary; `HQ_CLAUDE_DB` the db file; `HQ_CLAUDE_HOME` the `~/.claude`
folder read). One writer per db (`<db>.lock` = `{pid, db}`); a second app instance gets a read-only reader. A lock
whose pid is alive but is not node running `hub.mjs` on that db (Windows reused a hard-killed Hub's pid) is reclaimed;
when that check itself fails, a live pid still owns the lock and `health().lastError` says so. A Hub that exits
is restarted on a 1 s / 5 s / 30 s backoff, then the host settles in `down` (a Hub that stayed up 60 s starts the
backoff over). Hub stderr and error text reach `logs/app-*.log` only through `appLog.error` (redacted: no paths,
URLs, addresses or quoted fragments).

## 2026-10-16 — Claude Hub, phase H2 (rows written before the handler lands)

Additive only. Handlers live in `dashboard/claude-hub-host.js` (`registerIpc`); no `main.js` line changes. Rows are the
Hub's own snake_case rows, passed through unchanged. Every handler resolves; failures are `{error}`.

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.projects(opts?)` | `hq:claude-hub:projects` (invoke) | `opts = {source?}` → `[{id, source, key, name, path, hq_project_id, link_state:'auto'\|'confirmed'\|'none'\|'rejected', conversations, last_at, …}]` |
| `claudeHub.conversations(opts?)` | `hq:claude-hub:conversations` (invoke) | `opts = {projectId?, source?, q?, since?, hqProjectId?, before?, beforeId?, limit?≤200}`; order `last_at DESC, id DESC`; next page = the last row's `{before:last_at, beforeId:id}`; `q` = title substring (ASCII case-insensitive) → rows |
| `claudeHub.conversation(id, opts?)` | `hq:claude-hub:conversation` (invoke) | `opts = {limit?≤500, before?, beforeId?}` → `{conversation, messages:[{id, role, at, text, tool_name, is_sidechain, …}] (oldest first), hasMore}` \| `null` (unknown or forgotten); earlier page = the first message's `{before:at, beforeId:id}` |
| `claudeHub.search(q, opts?)` | `hq:claude-hub:search` (invoke) | `opts = {projectId?, source?, limit?≤50}` → `[{messageId, conversationId, at, role, title, source, projectId, snippet, rank}]`; `snippet` is plain text with hits between U+0002 and U+0003 — render as text, never as HTML; `[]` when the query has no letters/digits |
| `claudeHub.stats(opts)` | `hq:claude-hub:stats` (invoke, 15 s) | `opts = {from:'YYYY-MM-DD', to:'YYYY-MM-DD', projectId?, tzOffsetMin?}` → `{days:[{day, chats, messages, active_ms}], projects:[{project_id, name, chats, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write}], totals}`; `active_ms` is an estimate (gaps < 5 min); tokens deduplicated per API response; **token scope:** `projects[].tokens_*` / `totals.tokens_*` are ALL tokens of the chats that have a message in [from, to) — whole-chat totals, not only tokens spent inside the window (usage rows carry no timestamp; per-turn usage time is a later-phase schema change); the History strip labels them "whole chat" |
| `claudeHub.link(id, hqId, state)` | `hq:claude-hub:link` (invoke) | `state:'confirmed'\|'rejected'\|'none'` → `true` \| `{error}`; `rejected`/`none` clear `hq_project_id`; the Hub's auto-matcher never overwrites `confirmed`/`rejected` |
| `claudeHub.forget(target)` | `hq:claude-hub:forget` (invoke, 60 s) | `{conversationId}` \| `{projectId}` → `true` \| `{error}`; removes the index rows + tombstone; the transcript on disk is untouched |
| `claudeHub.reindex()` | `hq:claude-hub:reindex` (invoke) | → `{started:true}` \| `{error}` (a read-only Hub refuses); links and tombstones survive |
| `claudeHub.on(cb)` (H1) | push `hq:claude-hub:event` | additive: `changed` may carry `projects:[projectId]` (`'*'` = links re-matched); `health()` gains `lastErrorAt` |

## 2026-10-16 — Claude Hub, phase H3 (rows written before the handler lands)

Additive only. Main side: `dashboard/claude-chat.js` (new) with one hook line in `main.js` (rule 2).

### Claude Hub in-app chat (spec 2026-10-13-claude-hub-design.md §7–§8, phase H3)

| Preload | Channel | Shape |
|---|---|---|
| `claudeChat.send(req)` | `hq:claude-chat:send` (invoke) | `req = {conversationId?, projectId?, text, mode: 'read-only'\|'edits'}`; any other field is ignored (no session id, cwd or argument ever comes from the renderer). `projectId` = a Hub project id (`code:<folder>`) or a WorkspaceHQ project id (resolved main-side; paths never cross IPC). → `{turnId, sessionId?, seeded?: {chars, trimmed}}` (`sessionId` when continuing a Claude Code session; `seeded` when a claude.ai chat was copied into a new Code chat) \| `{error}` with the reason (empty message, over 100 000 chars, unknown mode, no target, Hub error, unknown project, refused folder, folder gone, CLI not found, 1 turn per chat, 3 turns in total). Never throws |
| `claudeChat.cancel(turnId)` | `hq:claude-chat:cancel` (invoke) | `true` when that turn was running (its process tree is stopped; the turn then ends with `done` + `stopped: true`) \| `false` |
| `claudeChat.on(cb)` | push `hq:claude-chat:event` | `{turnId, kind, …}`: `session {sessionId, mode}` (new chats: from the CLI's init line) · `delta {text}` (increment, not accumulated) · `tool {name, hint}` · exactly one end per turn: `done {sessionId, mode, usage: {in, out, cacheRead, cacheWrite}\|null, isError, subtype, result, stopped}` (`result` = the failure text when `isError`, else `''`) or `error {error}` (cap reached "stopped after 10 min", spawn failure, exit without a result) |

Engine rules (`dashboard/claude-chat.js`): one `claude -p --output-format stream-json --verbose --include-partial-messages --permission-prompts none --permission-mode plan|acceptEdits [--resume <uuid>]` process per turn, prompt on stdin; `read-only` → `plan`, `edits` → `acceptEdits`; `bypassPermissions` / `--dangerously-skip-permissions` are never passed (unit test). cwd = a WorkspaceHQ project path or a cwd the Hub recorded; drive roots, the Windows folder, Program Files and the profile root itself are always refused. One running turn per conversation, 3 in total, 10 min each. A new or claude.ai-seeded chat's turn also counts as `code:<session>` from the CLI's init line on, so a Continue on that session is refused ("already has a turn running") until it ends. The turn belongs to the window that sent it: when that window reloads (main reloads it after scans, capture saves, commits and relearn), crashes or closes, the turn is stopped (ends `done` + `stopped: true`); a reload while the target is still resolving spawns nothing and the send answers `{error: 'the window that asked was reloaded — nothing was sent'}`. Stop = launcher-safe tree stop (children of the `cmd.exe` launcher, then the root tree). The CLI is `HQ_CLAUDE_BIN` (test override) or the first `claude.exe`/`claude.cmd` on PATH. Errors reach `logs/app-*.log` as reasons only, never prompt or answer text. A finished chat reaches the library through the Hub's ordinary `changed` event (it is a normal Claude Code session).

## 2026-10-16 — Claude Hub, phase H4 (rows written before the handler lands)

Additive only. Main-side code lives in the NEW file `dashboard/claude-import.js`, hooked by one line in `main.js`.

### Claude Hub claude.ai import (spec 2026-10-13-claude-hub-design.md §5.2, §7, phase H4)

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.importExport()` | `hq:claude-hub:import` (invoke) | opens a `.zip`-only file dialog in main, then asks the Hub to import it → `{started:true, file:<basename>}` \| `{canceled:true}` \| `{error}` (`'an import is already running'`, `'read-only hub (another WorkspaceHQ owns the index)'`, `'pick a .zip file'`, …). The full path never reaches the renderer. Env **`HQ_CLAUDE_IMPORT_ZIP=<abs .zip>`** (gates and second instances only) replaces the dialog |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | gains `progress` with `kind:'import'`: `{kind:'import', phase:'unzip'\|'projects'\|'conversations'\|'done'\|'failed', done, total, report?, error?}` — `total: 0` means "not known yet" (conversations are counted as they stream); `report` (on `done`) holds counts and field names only. A `progress` without `kind` is backfill progress, as before. A finished import also sends `changed` `{ids: []}` |
| `claudeHub.health()` | `hq:claude-hub:health` | gains `lastImport: {at, ok:true, report} \| {at, ok:false, error} \| null` and `importing: boolean` |

Hub ops behind it (protocol, not IPC): `importExport({zipPath})` → `{started:true}`; `syncState()`; `syncPush({items})` —
the last two are reached only through the local bridge routes (CONTRACT.md "Local bridge routes — Claude Hub live sync").
claude.ai chats appear in every existing list/search/thread channel with `source:'web'`, ids `web:<uuid>`, `title_source:'web'`,
no `cwd`/`git_branch`/tokens (null — unknown, not zero).

## 2026-10-16 — Claude Hub, phase H5 (rows written before the handler lands)

Additive only. Main-side code lives in NEW files (`dashboard/claude-vault.js`) with one-line hooks in `main.js` (rule 2).

### Changed channels (H5)

| Channel | Addition |
|---|---|
| `hq:llm:chat` | (Claude Hub H5) `req.include` gains the 7th key `claude` (boolean, default off). When it is `true`, main asks the Claude Hub op `contextFor({query, budgetChars ≤ 3000})` (4 s timeout) and the answer's `sections` gains `{id:'claude', label:'Claude history', chars, clipped, cites:['chat <title>, <date>', …], note?}`; the other sections then share 9 000 of the 12 000-char budget. A Hub that is missing, down or slow only adds a `note` ("Claude Hub is not running" …); the answer still runs. Unticked = byte-identical context to before |

### Claude Hub — Save to vault (spec 2026-10-13-claude-hub-design.md §7/§9, phase H5)

| Preload | Channel | Shape |
|---|---|---|
| `claudeVault.preview(conversationId)` | `hq:claude-vault:preview` (invoke) | in: conversation id (string ≤ 300) → `{path, rel, markdown, exists, model, basis}` \| `{error}` — the LOCAL model drafts Summary / Decisions / To-dos / Links from the Hub's copy of the chat (≤ 500 newest messages; user + assistant text only). Writes nothing. `path` is absolute under `VEEMO CORTEX/30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md`; `exists:true` = this chat's own earlier note is there (the UI then asks Replace). Another chat's note of the same name is never offered: the name takes ` (2)`…` (9)`. `{error}` when the Hub, the chat or the local model is missing (H5; additive to spec §7: `rel`, `exists`, `model`, `basis`); never throws |
| `claudeVault.save({path, markdown, replace?})` | `hq:claude-vault:save` (invoke) | in: `path` from preview, the edited `markdown` (≤ 200 000 chars, must keep its `conversation:` frontmatter line), `replace` only from the Replace button → `true` \| `{error}` \| `{error, exists:true}` (a note is there and `replace` was not sent). Only `30_Areas/Claude/<Project>/<note>.md` inside the vault (junctions out refused); atomic (temp + link/rename); `replace:true` overwrites only a note whose `conversation:` matches; never automatic, never bulk. Env `HQ_VAULT_DIR` overrides the vault folder for gates (H5); never throws |

## 2026-10-25 — AI archive sources, phase H6 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §5, §6.3, §7. Main-side code: handlers added to
`dashboard/claude-hub-host.js` (`registerIpc`) and `dashboard/claude-import.js`; the drop watcher is the NEW file
`dashboard/claude-imports.js` (one new hook line in `main.js`; the host hook line gains `vaultDir: VAULT`).

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.importExport(kind?, opts?)` (H4, extended) | `hq:claude-hub:import` (invoke) | `kind` ∈ `'auto'\|'claude'\|'chatgpt'`; absent = `'claude'` (H4 unchanged). `opts = {dropId?}`: a `dropId` from a `claudeImports` `found` event imports that dropped file with no dialog; no `dropId` = the `.zip` dialog (its title names the kind). `'auto'` detects by ZIP entry names: `conversations.json` + `user.json` ⇒ ChatGPT; `conversations.json` + (`projects.json` or `users.json`) ⇒ claude.ai; no `conversations.json` ⇒ `{error:'Not a ChatGPT or claude.ai export (looked for conversations.json)'}`; `conversations.json` alone ⇒ `{error}` naming the two explicit buttons. A picked/dropped file whose kind differs from an explicit `kind` is refused with both names. → `{started:true, file:<basename>, kind:'claude'\|'chatgpt'}` \| `{canceled:true}` \| `{error}` (`'unknown import kind'`, `'that dropped file is gone or was already handled'`, H4 errors). Never a path from the renderer |
| `claudeHub.documents(opts?)` | `hq:claude-hub:documents` (invoke) | `opts = {source?:'memory'\|'claude-md'\|'prompt'\|'history', projectId?, q?, limit?≤200 (default 50)}` → `[{id, source, path, title, project_id, project_path, mtime_ms, size, origin, snippet?, rank?}]`; without `source`, `history` rows are left out (they are the harvest pool, not chats); with `q`: FTS over title + text, `snippet` uses the U+0002/U+0003 markers of `search` (render as text), order `rank`; without `q`: order `mtime_ms DESC, id DESC`; `[]` when `q` has no letters/digits; `{error}` when the Hub fails (never an empty list for a failure) |
| `claudeHub.document(id)` | `hq:claude-hub:document` (invoke) | in: document id (string ≤ 300) → `{id, source, path, title, text, project_id, project_path, mtime_ms, size, meta}` (`text` masked; `meta` parsed JSON or `null`) \| `null` (unknown or forgotten) \| `{error}` |
| `claudeHub.forget(target)` (H2, extended) | `hq:claude-hub:forget` | gains `{documentId}` → `true` \| `{error:'nothing to forget'}`; removes the row and writes tombstone `('document', id)`; the file on disk is untouched; a forgotten document is never re-indexed |
| `claudeHub.health()` | `hq:claude-hub:health` | `counts` gains `documents` (all sources); `lastImport` gains `source:'claude'\|'chatgpt'` |
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | `progress{kind:'import'}` gains `source:'claude'\|'chatgpt'` (absent = claude); a ChatGPT `report` = `{source:'chatgpt', files:{conversations, user, other:[name]}, conversations:{seen, imported, unchanged, forgotten, skipped}, messages:{imported, skipped, empty}, branches:{skipped}, memory:{found, imported}, unknownFields, truncated}` (counts and file/field names only); `changed` may carry `documents:[documentId]` (indexed, updated or removed documents) |
| `claudeImports.on(cb)` | push `hq:claude-imports:event` | `{event:'found', data:{dropId, file:<basename>, bytes, kind:'claude'\|'chatgpt'}}` (a new, complete ZIP in the drop folder, announced once) \| `{event:'error', data:{file, error}}` (a ZIP that is not an export, or unreadable — refused with the reason, nothing imported, nothing deleted) \| `{event:'gone', data:{dropId}}` (answered or the file vanished). Import progress stays on `hq:claude-hub:event` |
| `claudeImports.pending()` | `hq:claude-imports:pending` (invoke) | → `{folder:{exists:boolean, name:'WorkspaceHQ Imports'}, found:[{dropId, file, bytes, kind}], refused:[{file, error}]}` — what the watcher holds now (reloads and late subscribers read it) |
| `claudeImports.dismiss(dropId)` | `hq:claude-imports:dismiss` (invoke) | → `true` \| `false` (unknown id); "Not now": that file (name + size + mtime) is never announced again |

Seen state: `imports-seen.json` next to the Hub db (`data/claude/imports-seen.json`; `HQ_CLAUDE_DB` moves it) `{"<name>|<size>|<mtimeMs>": "imported"|"dismissed"}` — written by main, never in the drop folder.
The app never creates, moves or deletes anything in the drop folder (`HQ_IMPORTS_DIR` overrides it for gates).
Rows from ChatGPT appear in every existing list/search/thread channel with `source:'chatgpt'`, ids `chatgpt:<conversation id>`,
project `chatgpt:chats` ("ChatGPT chats"), `title_source:'web'`, no `cwd`/`git_branch`/tokens (null). Continue on a ChatGPT
chat behaves like a claude.ai chat (a new, seeded Claude Code chat); Save to vault writes `source: chatgpt`.

## 2026-10-25 — Prompt library, phase P1 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.1, §6.3, §6.4, §7, §8. Main-side code: the NEW file
`dashboard/claude-prompts.js` (one new hook line in `main.js`, after the `claude-imports` line); the Hub handler is added to
`dashboard/claude-hub-host.js` (`registerIpc`). P1 writes nothing to the vault.

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.documents(opts?)` (H6, extended) | `hq:claude-hub:documents` | every row gains `meta` (the stored frontmatter / meta JSON parsed, or `null`; masked like the text); `source:'prompt'` rows also gain `variables: [name]` = the frontmatter `variables` list ∪ the `{{name}}` tokens of the body, in first-seen order, names matching `[A-Za-z_][A-Za-z0-9_-]{0,39}`, at most 20. Other fields and the order are unchanged |
| `claudeHub.promptStats()` | `hq:claude-hub:prompt-stats` (invoke) | → `[{prompt_id, uses, last_at}]` (one row per prompt id that has at least one `prompt_use` row; `uses` = real count, `last_at` = ISO of the newest) \| `{error}`. Nothing writes `prompt_use` before phase P3, so the list is `[]` until then. Readers allowed |
| `claudePrompts.status()` | `hq:claude-prompts:status` (invoke) | → `{vault:<basename of the configured vault root>, rel:'40_Resources/Prompts', folder:{exists:boolean, error?}, obsidian:boolean}` — `obsidian` = an `obsidian://` handler is registered on this PC (`app.getApplicationNameForProtocol`). Never a path. Never throws — `folder.error` = why a folder that is there cannot be used (vault missing, or 40_Resources/Prompts leads outside the vault); the Library then shows that reason instead of "No prompts folder yet" |
| `claudePrompts.open(id, how)` | `hq:claude-prompts:open` (invoke) | in: a prompt document id (`prompt:<sha1>`, string ≤ 300) and `how` ∈ `'obsidian'\|'file'` → `{ok:true, how}` \| `{error}` \| `{error, fallback:'file'}` (Obsidian not installed). Main finds the file itself: it lists `<vault>/40_Resources/Prompts/*.md` (top level only) and takes the one whose H6 `docId` equals `id`; the realpaths of the folder and the file must stay inside the vault (junctions out refused). `obsidian` opens exactly `obsidian://open?vault=<encodeURIComponent(vault basename)>&file=<encodeURIComponent('40_Resources/Prompts/<file name without .md>')>`; `file` calls `shell.openPath` on that file. No path or URL is ever taken from the renderer, the index or note text. `HQ_DRY_LAUNCH=1` logs `[dry-open] obsidian\|file <name>`, opens nothing and answers `{ok:true, how, dry:true}` (gates) |

## 2026-10-25 — Prompt library, phase P2 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.2, §6.3, §6.4, §7, §8. Hub ops in
`dashboard/claude-hub/hub.mjs` (`harvest.mjs` scores); host handlers in `dashboard/claude-hub-host.js` (`registerIpc`);
`promote` in `dashboard/claude-prompts.js` (P1 file; registered by its `init` — no `main.js` line changes).

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.promptCandidates(opts?)` | `hq:claude-hub:prompt-candidates` (invoke, 15 s) | `opts = {limit?}` (default 50, cap 200) → `{candidates:[{key, text, chars, score, reasons:[{key:'reuse'\|'turns'\|'length'\|'library', points, text}], sources:[{kind:'code'\|'web'\|'chatgpt'\|'history', conversationId?, documentId?, at, project}], sessions, lastAt}], pooled:{messages, history}, capped:{messages:boolean, history:boolean}, hidden}` \| `{error}`. `key` = `cand:<sha1 of the normalized text>`; `text` = the newest occurrence, trimmed, masked as indexed; `score` = the sum of the `reasons[].points` (2 decimals); order `score DESC, lastAt DESC, key`. Pool: user-role messages of `code`/`web`/`chatgpt` chats (no sidechain, no tool name) + `history` documents; at most the newest 20 000 of each (`capped` says when the bound was reached). Excluded: < 120 characters, starts with `/` or `<command-`, holds `••• secret (` or `<local-command`, pasted history lines. Readers allowed; no open index → `{error:'the index is not open yet'}` (never `[]`) |
| `claudeHub.hideCandidate(key)` | `hq:claude-hub:hide-candidate` (invoke) | in: `cand:<40 hex>` → `true` \| `{error}` (`'not a candidate key'`, `'read-only hub (another WorkspaceHQ owns the index)'`). Writes a `tombstone(kind 'candidate', native_id key)`; that text never comes back as a candidate, through re-index and new sessions alike. (§7 lists `hideCandidate` as a Hub op only; this row exists because the Hide button lives in the renderer — P2 deviation 1) |
| `claudePrompts.promote(p)` | `hq:claude-prompts:promote` (invoke) | `p = {text, title, tags?, source?:{kind:'code'\|'web'\|'chatgpt'\|'history', conversation, at}, name?}` → `{path:'40_Resources/Prompts/<name>', name, id:'prompt:<sha1>', masked:<number of masks applied now>}` \| `{error}` \| `{error, exists:true, next:'<slug>-2.md'\|null}` (a note of that name is there; nothing written). `text` ≤ 100 000 chars and `title` are masked (`maskSecrets`) BEFORE the note is built; the note is the §6.1 layout (P1 `promptNoteText`: `title`, `tags` (default `[harvested]`), `variables` (from `{{name}}` tokens), `version: 1`, `created`, `source`, `hq.id`). `name` is accepted only when it equals `<slugify(title)>-<n>.md`, n ∈ 2…9 (the name a clash answer offered and the owner confirmed); every other name is refused. Written only under `<vault>/40_Resources/Prompts/` (created when missing), atomically, never overwriting (P1 `writePromptNote`). `HQ_VAULT_DIR` overrides the vault (tests, gates). Logs carry the file name only, never prompt text. Never throws |

## 2026-10-25 — Prompt library, phase P3 (rows written before the handler lands)

Additive only. Spec `2026-10-15-archive-and-prompt-library-design.md` §6.3, §6.4, §7. Handlers are registered inside P1's
`dashboard/claude-prompts.js` `init` (pack work in the NEW file `dashboard/claude-prompt-pack.js`). `main.js`: the H3 line
`require('./claude-chat').init(` now keeps its result (`const claudeChatEngine = …`) and P1's `claude-prompts` init line
passes `hub, chat, getProjects, launch, clipboard, dialog, getWin`; no line added. No path or prompt text is sent by the renderer.

| Preload | Channel | Shape |
|---|---|---|
| `claudePrompts.run(req)` | `hq:claude-prompts:run` (invoke) | `req = {promptId:'prompt:<40 hex>', target:'chat'\|'terminal'\|'claude.ai'\|'chatgpt', projectId?:<HQ project id>, vars?:{name:string}, mode?:'read-only'\|'edits'}` (`mode` only for `chat`, default `read-only`; other fields ignored). Main reads the note from `<vault>/40_Resources/Prompts/` (P1 `findPromptFile`, contained), strips the frontmatter, fills `{{project}}` (project name) and `{{cwd}}` (project path) from `projectId` and every other `{{name}}` from `vars` in ONE pass (values ≤ 4 000 chars, never re-expanded). `chat` → the H3 engine's `send({projectId, text, mode}, {alive})` bound to the asking window exactly like `hq:claude-chat:send` (needs a project); `terminal` → `launchClaudeTerminal(<project path>, text)` (needs a project; a filled prompt over 500 characters — claude-launch.js `PROMPT_MAX`, one command line — is refused with the reason, never cut); `claude.ai` / `chatgpt` → `clipboard.writeText(text)` then `shell.openExternal` of the literal `https://claude.ai/new` / `https://chatgpt.com/`. → `{ok:true, target, title, turnId?, sessionId?, seeded?, usage:'recorded'\|'not recorded: <reason>', dry?:true}` \| `{error}` \| `{error, missing:[name]}` (fields to fill; nothing sent). After the target succeeded, and only then, one Hub `promptUse` row is written; a read-only or stopped Hub does not fail the run (`usage` says why). `HQ_DRY_LAUNCH=1`: copy targets log `[dry-copy] <target> <chars> chars` and write/open nothing; terminal: claude-launch.js's existing `[dry-launch] <cwd> :: <prompt>` stdout line (dry mode only — gates and second instances run fixture text). The app log (`[prompts] run …`) carries target, prompt file name and counts, never prompt text. Never throws |
| `claudePrompts.importPack(req?)` | `hq:claude-prompts:import-pack` (invoke) | step 1 `importPack({from?:'zip'\|'folder'})` (default `'zip'`; Windows dialogs pick a file OR a folder, not both): main opens a `.zip` file dialog or a folder dialog (env **`HQ_PACK_IMPORT=<abs folder\|.zip>`** replaces it — gates only), scans top-level `.md` files (a folder) or every `.md` entry (a ZIP, ≤ 50 MB, entries ≤ 200 000 bytes, ≤ 200 notes) and answers `{planId, source:<basename>, notes:[{name, title, exists}], total, skipped:{notMd, tooBig, tooMany, duplicate, unreadable}}` \| `{canceled:true}` \| `{error}` — writes nothing. Step 2 `importPack({planId})` (a plan id is random, held main-side, used once, ≤ 10 min): writes every note whose name is free, masked (`maskSecrets`; a note without frontmatter gets `title` + `tags: [imported]`, CRLF → LF), atomically, never overwriting → `{imported, masked, skipped:{exists, failed}}` \| `{error}`. Names = `slugify(<entry base name>) + '.md'`; no entry path is used. Never throws |
| `claudePrompts.exportPack()` | `hq:claude-prompts:export-pack` (invoke) | main opens a save dialog (`.zip`; env **`HQ_PACK_EXPORT=<abs .zip>`** replaces it) and streams a ZIP of the top-level `*.md` notes of the Prompts folder, one entry at a time, opened with `wx` (an existing file is refused, never replaced) → `{file:<basename>, notes}` \| `{canceled:true}` \| `{error}` ("No prompts folder yet — nothing to export"). Never throws |
| `claudeHub.promptStats()` (P1) | `hq:claude-hub:prompt-stats` | unchanged shape; from P3 on the counts move (one `prompt_use` row per successful run). The renderer re-asks after each run (the Hub's `changed` event does not fire for usage) |

Hub op (protocol, not IPC; main-only, the renderer cannot write usage): `promptUse({promptId, target, projectId?, conversationId?})` →
`true`; writer only (a reader throws `read-only hub (another WorkspaceHQ owns the index)`); `promptId` must match `prompt:<40 hex>`,
`target` one of the four, `projectId`/`conversationId` strings ≤ 200 or absent; `at` is the Hub's clock (ISO).

## 2026-10-26 — PC health: Open in Explorer for the disk breakdown

Additive only. New file `dashboard/pc-health-open.js` (one hook line in `main.js`). Same trust model as `hq:health-fix`:
the renderer cannot open an arbitrary path.

| Preload | Channel | Shape |
|---|---|---|
| `pcOpenFolder(path)` | `hq:pc-open-folder` (invoke) | `path` must equal (verbatim) one `detail.hogs.items[].path` in the CURRENT `data/pc-health.json` and still be an absolute, existing directory that is not a link; main then calls `shell.openPath` (opens Explorer, runs nothing). Answers `true` or `{error}` (`refused: …`, `… no longer exists …`, or the openPath error text). |

`hq:health-scan` is unchanged in shape; the pc-health sidecar it returns gains additive `detail`, `trends` and a `battery` organ (CONTRACT.md 2026-10-26).

## 2026-10-26 — GitHub view (Projects › GitHub)

Additive only. New file `dashboard/github-view.js` (one hook line in `main.js`).

| Preload | Channel | Shape |
|---|---|---|
| `githubRefresh()` | `hq:github-refresh` (invoke) | Runs `collector/github.mjs --max-age=60` (one run at a time; a second call while one runs waits for it), then answers the current `data/github.json` object (CONTRACT.md 2026-10-26), or `{error}` when the run failed and no sidecar exists. |
| `githubOpen(url)` | `hq:github-open` (invoke) | `url` must equal (verbatim) a `repos[].url`, `waiting[].url`, `mine[].url` or `issues[].url` in the CURRENT `data/github.json`, be `https:` and have host exactly `github.com`; main then calls `shell.openExternal`. Answers `true` or `{error}` (`refused: …`). Same trust model as `hq:pc-open-folder`. |

## 2026-10-26 — Connected accounts (Projects › Accounts: Vercel + Supabase)

Additive only. New file `dashboard/accounts-view.js` (one hook line in `main.js`).

| Preload | Channel | Shape |
|---|---|---|
| `accountsRefresh()` | `hq:accounts-refresh` (invoke) | Runs `collector/accounts.mjs --max-age=60` (one run at a time), then answers the current `data/accounts.json` object (CONTRACT.md 2026-10-26), or `{error}` when the run failed and no sidecar exists. |
| `accountsOpen(url)` | `hq:accounts-open` (invoke) | `url` must equal (verbatim) a project `dashboard` / `prod.url` / `latest.url`, a `deploys[].url` or a Supabase `dashboard` in the CURRENT `data/accounts.json`, be `https:` and have host `vercel.com`, `supabase.com` or `<one label>.vercel.app`; main then calls `shell.openExternal`. Answers `true` or `{error}` (`refused: …`). |

## 2026-10-27 — Instagram / Facebook data exports in the Claude Hub (no new channel)

Additive only, no schema change (still 2). Hub: new `dashboard/claude-hub/ingest-meta.mjs` + op `importMeta({zipPath, expect?})`;
main: `dashboard/claude-import.js` / `dashboard/claude-imports.js` (no new `main.js` line).

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.importExport(kind?, opts?)` | `hq:claude-hub:import` (invoke) | `kind` gains `'instagram'\|'facebook'\|'meta'` (meta = either). Detection by entry names: `instagram_profile_information.(html\|json)` ⇒ Instagram; `profile_information.(json\|html)` + `your_friends.*` or `messenger_active_status_settings.*` ⇒ Facebook. Routed to the Hub op `importMeta` with `expect`; the other network is refused ("That is a Facebook export, not an Instagram export"). → `{started, file, kind:'instagram'\|'facebook'}`. The no-export refusal now reads `Not a ChatGPT, claude.ai, Instagram or Facebook export (looked for conversations.json or a profile information file)` |
| `claudeHub.on(cb)` / `claudeHub.health()` | `hq:claude-hub:event` / `hq:claude-hub:health` | import `progress.source` is `'meta'` while running and `'instagram'\|'facebook'` on `done` (and in `lastImport.source`); new phase `documents`. Report `{source, format:'html'\|'json', owner:boolean, conversations{seen,imported,unchanged,forgotten,skipped}, messages{imported,skipped,empty}, documents{imported,unchanged,removed,categories[]}, skippedFiles{sensitive,other}, truncated}` — counts and category labels only |
| `claudeImports.on(cb)` / `pending()` | `hq:claude-imports:event` / `:pending` | `kind` may be `'instagram'\|'facebook'` |
| `claudeHub.conversations / search / conversation` | (H2 channels) | new sources `instagram` / `facebook`, ids `instagram:<thread folder>` / `facebook:<thread folder>`, projects `instagram:dms` ("Instagram DMs") / `facebook:messenger` ("Facebook Messenger"). The owner's lines are role `user`; everyone else's are role **`other`** with the sender's name in `tool_name`. **Unfiltered** conversation / project lists and `stats` leave these two sources out (people, not AI chats); `source:'instagram'\|'facebook'` lists them. Never continued (read-only) |
| `claudeHub.documents(opts?)` | `hq:claude-hub:documents` | new document source `social`: ids `social:<instagram\|facebook>:<kind>:…`, `meta:{origin, kind}`, chunks of ≤ 100 records (posts, comments, likes + a "most frequent accounts" tally, saved, connections, interests, ads, searches, profile whitelist) |
| `hq:llm:chat` | (H5 row) | `req.include` gains the 8th key `social` (default off): main asks `contextFor({query, budgetChars, scope:'social'})`; section `{id:'social', label:'Instagram & Facebook', chars, clipped, cites, note?}`; it has its own 3 000-char reserve, assembled after `claude` |

Never read, whatever was asked: `security_and_login_information/`, passwords, payments / checkout, ID verification, location
and locations of interest, devices, cookies, uploaded / synced contacts, off-Meta activity, targeting categories, message
attachment pages. Profile = a whitelist (name, username, bio, website, pronouns, city, hometown, education, work, pages);
post metadata rows (device ids, coordinates, file sizes, camera fields) are dropped. Text only: media entries are never read.

## 2026-10-27 — Social tab (top-level; its vault is VEEMO CORTEX)

Additive only. New file `dashboard/social-tab.js` (one hook line in `main.js`). The tab's Accounts / Inbox read the existing
`hq:social-read` (browser-extension bridge); its Archive reads the existing Hub channels (`projects` / `documents` / `document`
with `source:'instagram'|'facebook'|'social'`). Life › Social moves here (the sub leaves Life; a deep link to `life/social` lands on `social/inbox`).

| Preload | Channel | Shape |
|---|---|---|
| `socialVault.list()` | `hq:social-vault:list` (invoke) | → `{vault, folder:'30_Areas/Social', exists, obsidian, notes:[{rel, name, title, mtime, size, where:'social'\|'inbox'}]}` — every `.md` under `<vault>/30_Areas/Social/` (≤ 2 folders deep) plus `<vault>/00_Inbox/Social *.md`; newest first, ≤ 500; a file whose real path leaves the vault is skipped. Or `{error}`. Reads only. |
| `socialVault.open(rel, how)` | `hq:social-vault:open` (invoke) | `rel` must be in a fresh `list()`; `how` = `'obsidian'` (only `obsidian://open?vault=<vault basename>&file=<rel without .md>`) or `'file'` (shell.openPath). `HQ_DRY_LAUNCH=1` logs `[dry-open]` instead. → `{ok, how}` or `{error}`. |
| `socialVault.save({title, body})` | `hq:social-vault:save` (invoke) | Only from the owner's Save in Social › Vault. Writes ONE new note `<vault>/30_Areas/Social/<safe title>.md` (front matter `title`, `type: note`, `tags: [social]`, `created`, `source: WorkspaceHQ`), atomically, never over an existing note (`{error, exists:true}`). Title 1–60 chars, body ≤ 50 000. → `{rel}` or `{error}`. |
| `claudeHub.socialSummary()` | `hq:claude-hub:social-summary` (invoke) | Hub op `socialSummary` (store.mjs, read-only, no schema change) → `{kinds:[{origin, kind, docs, newest_ms}], dms:[{origin, conversations, messages, last_at}]}` — counts only, no text. |
| `claudeHub.documents(opts?)` | `hq:claude-hub:documents` | `opts` gains `origin` and `kind` (social documents' `meta.origin` / `meta.kind`), both optional filters; everything else unchanged. |
| `socialOpenSite(platform)` | `hq:social-open-site` (invoke) | `platform` ∈ `bluesky reddit x linkedin instagram threads facebook youtube`; main opens that platform's fixed home URL (a literal in `social-tab.js`, e.g. `https://bsky.app/`) with `shell.openExternal` so the owner can sign in — the extension reads signed-in tabs every 5 min. Anything else (incl. `mastodon`, which has no fixed server) → `{error:'refused: …'}`. `HQ_DRY_LAUNCH=1` logs `[dry-open] site <url>`. → `{ok}`. |

`HQ_VAULT_DIR` overrides the vault (gates); tests pass `vaultDir` directly.

## 2026-10-27 — Social › Inbox: Discard a staged post

Additive only. `dashboard/social-tab.js` gains the handler (same `main.js` hook line, which now also passes `dataDir`); the
staged → canceled rule is ONE function, `cancelStaged(outboxFile, id)` in `dashboard/social-bridge.js`, shared with the
popup's `POST /social/outbox/cancel` (CONTRACT.md "cancel never publishes" amendment).

| Preload | Channel | Shape |
|---|---|---|
| `socialCancel(id)` | `hq:social-cancel` (invoke) | Only from the owner's second click on Discard in Social › Inbox. Flips ONE `staged` action in `data/social/outbox.json` to `canceled` (+ `canceled_at`), synchronously; never publishes, never touches any other action. → `{ok:true, id, status:'canceled'}`, or `{error}`: `unknown action id`, `already publishing` (status `sending`), `not staged`, `id required`, `write failed: …`. |

## 2026-10-27 — Life › Notes: Open in Obsidian / Search (were "isn't wired")

Additive only. New file `dashboard/vault-open.js` (one hook line in `main.js`).

| Preload | Channel | Shape |
|---|---|---|
| `vaultOpen(name, how)` | `hq:vault-open` (invoke) | `name` must equal a `name` in the CURRENT `data/latest.json` `inventory.vaults`; its `path` (absolute, or relative to Documents) must be a vault Obsidian has registered (`%APPDATA%/obsidian/obsidian.json` `vaults{id:{path}}`, compared case-insensitively). `how` = `'open'` → `obsidian://open?vault=<that vault's id>`, `'search'` → `obsidian://search?vault=<id>`; nothing else is ever opened. `HQ_DRY_LAUNCH=1` logs `[dry-open]`. → `{ok, how}` or `{error}` (`refused: not a vault in the latest scan`, `Obsidian doesn't know this vault yet — …`, `Obsidian is not installed …`). |

## 2026-10-27 — Claude › Canvas Remove + Settings / level-up "Save stat card PNG" (were "isn't wired")

Additive only. New files `dashboard/canvas-ops.js` and `dashboard/stat-card.js` (one hook line each in `main.js`).
Pin to Home needs no channel: pins are per-PC (`whq3-prefs.canvasPins`, keys `<board>/<node id>`, at most 6), and a pin
whose node is gone drops silently. The MCP server gains `hq_canvas_remove`, the same rule on the same files.

| Preload | Channel | Shape |
|---|---|---|
| `canvasRemove(board, id)` | `hq:canvas-remove` (invoke) | Only from the owner's second click on Remove in Claude › Canvas. `board` matches the `hq:canvas-add` name rule; `id` is a node id (1–120 chars). Drops that ONE node from `data/canvas/<board>.canvas` plus every edge whose `fromNode` / `toNode` is it (tmp + rename, the same serialization as add), and appends `{at, board, node, edges}` to `data/canvas/removed.jsonl` first, so a removal can be undone by hand. The board watcher pushes `hq:canvas`. → `{ok:true, board, id, edges:<n>}`, or `{error}`: `bad board name`, `node id required`, `no board named …`, `unknown node`, `write failed: …`. |
| `statCardSave(dataUrl)` | `hq:stat-card-save` (invoke) | Only from the owner's click on Save stat card PNG (Settings › Export, the level-up card). `dataUrl` = `data:image/png;base64,…`, decoded ≤ 8 MB and starting with the PNG signature; the renderer draws it, main only picks the path (save dialog, default `Pictures\stat-card-YYYY-MM-DD.png`; `HQ_STAT_CARD_PATH` replaces the dialog for gates) and writes it. → `{ok:true, path}`, `{ok:false, canceled:true}`, or `{error}`: `not a PNG`, `too big`, `write failed: …`. |

## 2026-10-27 — Claude › Canvas: ＋ Board and Clear board

Additive only. Both live in `dashboard/canvas-ops.js` (its existing `main.js` hook line registers them). The MCP server
gains `hq_canvas_create` and `hq_canvas_clear`, the same rules on the same files. A cleared board's pins drop from Home
the way a removed card's do.

| Preload | Channel | Shape |
|---|---|---|
| `canvasCreate(board)` | `hq:canvas-create` (invoke) | Only from the owner's Create in Claude › Canvas ＋ Board. `board` follows the `hq:canvas-add` name rule; writes `data/canvas/<board>.canvas` = `{"nodes":[],"edges":[]}` (add's serialization) only if no board with that name exists (compared case-insensitively — Windows file names). → `{ok:true, board}`, or `{error}`: `bad board name`, `a board named … already exists`, `write failed: …`. |
| `canvasClear(board)` | `hq:canvas-clear` (invoke) | Only from the owner's second click on Clear in the board list. Appends `{at, board, cleared:true, nodes, edges}` to `data/canvas/removed.jsonl` first, then rewrites the board with `nodes: []`, `edges: []` (every other key kept). The file stays, so the board stays listed. → `{ok:true, board, nodes:<n>, edges:<n>}`, or `{error}`: `bad board name`, `no board named …`, `write failed: …`. |

## Rules

1. **Additive-only** through the program: never rename a channel, change an arg
   order, or repurpose a payload field. Deprecate by adding + leaving the old.
2. **Announce first**: new channels get their row here before the handler lands.
   Main-process handler additions are gated per program invariant 3 (new files,
   one-line hooks) until in-flight work lands.
3. **Feature-detect in v3**: all realm code guards `window.hq?.method` — the dev
   harness has no handlers, and parity must hold data-only.
4. **Unsubscribe on unmount**: any realm that subscribes stores the returned
   disposer and calls it in `unmount()`.
5. Planned M3+ additions (session registry, canvas, MCP-triggered scans) enter
   this table as a `Pending` section before implementation, mirroring
   CONTRACT.md's *Pending changes* convention.

## 2026-10-28 — Feature cleanup (channels REMOVED; owner: "do the cleanup")

The one deliberate break of the additive-only rule. These features had no recorded use in a month
(local audit, docs/audits/, not committed). The rows above stay as history. Restore any cut with
`git checkout cleanup-base-2026-10-28 -- <paths>` (tag pushed). The v2–v4 legacy renderers never used these channels.

| Cut | Channels / methods removed |
|---|---|
| Mini HUD | `getMiniData` `hq:mini-data`, `miniHide` `hq:mini-hide`, push `onMiniUpdate` `hq:mini-update`. `showMain` `hq:show-main` and `killServers` `hq:kill-servers` STAY (quick-run uses them). Tray loses the Mini HUD checkbox. |
| Summon + desktop shards | `shardSummon` `hq:shard-summon`, `shardSummonCancel`, `shardClose`, `shardSave`, `shardLibSpawn`, `shardLibDelete`, `shardRegen` (`hq:shard-*`), push `onShardInit` `shard:init`; hotkey Ctrl+Alt+G released; the `--summon=` / `--summon-open` dev flags are gone. Tray loses Summon…. data/shards.json, data/shard-library.json and data/.hud-state.json are left on disk, unread. |
| Legacy renderers v2–v4 | No channel: `legacy/` deleted. `data/.ui-version` / `HQ_UI_VERSION` naming v2–v4 loads v5 and writes an `ui-legacy-removed` log line; `tools\rollback.ps1 v2..v4` refuses with the restore command. |
| Studio (snip, recorder, capture library) | the whole `studio.*` preload group (`hq:studio:*` invoke/send channels: panel-toggle, snip-arm/commit/cancel, rec-sources/start/chunk/stop/abort/toggle/pause, panel-mode, library-list/reveal/delete/open, settings-get/set) and its pushes (`hq:studio:rec-status`, `studio:capture-added`, `hq:studio:snip-frozen`, `hq:studio:open-realm`, `hq:studio:rec-command`); hotkeys Ctrl+Alt+S, Ctrl+Alt+Shift+S, Ctrl+Alt+R, Ctrl+Alt+Shift+R, Ctrl+Alt+L released. Studio was the 10th destination (key 0); the renderer now has 9 (keys 1–9). Existing captures on disk are left as they are. |
| Importers (claude.ai / ChatGPT / Instagram-Facebook ZIPs, drop folder, claude.ai live sync) | `claudeHub.importExport` `hq:claude-hub:import`; `claudeImports.pending/dismiss` (`hq:claude-imports:pending`, `:dismiss`) + push `hq:claude-imports:event`; Hub ops `importExport` / `importChatGPT` / `importMeta` / `syncState` / `syncPush` and the `import` progress event; health loses `lastImport` / `importing`; bridge routes `GET /claude/sync-state`, `POST /claude/sync` (CONTRACT.md amendment). Extension 0.5.0. |
| Prompt library, harvest, runs, packs | `claudePrompts.status/open/promote/run/importPack/exportPack` (`hq:claude-prompts:*`); `claudeHub.promptCandidates` `hq:claude-hub:prompt-candidates`, `hideCandidate` `:hide-candidate`, `promptStats` `:prompt-stats`; Hub ops `promptUse` / `promptStats` / `promptCandidates` / `hideCandidate`. `claudeHub.documents` stays (prompt notes are still indexed as documents). |
