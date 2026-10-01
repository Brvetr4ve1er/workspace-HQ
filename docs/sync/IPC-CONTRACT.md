# IPC contract — `window.hq` bridge

The single reference for every channel between the Electron main process and any
renderer surface. **Names and argument shapes listed here are frozen for the
whole NEXUS v3 program (additive-only).** New channels get a row here BEFORE the
code lands, same rule as data shapes in `CONTRACT.md`.

Normative sources: `dashboard/preload.js` (renderer-facing signatures) and
`dashboard/main.js` (handlers + return shapes; line refs below drift with edits —
grep the channel name).

## The v3 swap story (why this doc exists)

- **Pre-swap (M0):** `dashboard-v3/dev-main.js` registers **no** IPC handlers.
  Ported realms must feature-detect (`window.hq?.markQuestDone`) and no-op
  gracefully — this is what makes renderer-only screenshot parity possible.
- **At swap:** the real `main.js` loads `dashboard-v3/index.html` with the
  **existing** `dashboard/preload.js`. Every channel below is already
  registered — the swap itself requires zero IPC changes.
- `dashboard-v3/preload.js` exists only for the dev harness (`hqv3.dev = true`).

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
| `shardSummon(text)` | `hq:shard-summon` | summon prompt | — | summon palette |
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
| `studio.panelToggle()` | `hq:studio:panel-toggle` | — | `true` (shows/hides the FloatingPanel; creates it on first call) | tray / hotkey / STUDIO realm |
| `studio.snipArm(kind)` | `hq:studio:snip-arm` | `{kind:'region'\|'full'\|'window'}` (default `'region'`) | `true` — main freezes every display via `desktopCapturer.getSources` at each display's native pixel size, spawns one transparent overlay BrowserWindow per Display, and pushes the freeze on `hq:studio:snip-frozen` | panel / Ctrl+Alt+S / STUDIO realm |
| `studio.recSources()` | `hq:studio:rec-sources` | — | `[{sourceId, displayId, label, primary, kind:'screen'\|'window', thumbnail (dataURL), width, height}]` — joined `getSources({types:['screen','window']})` × `screen.getAllDisplays()` on `display_id` | FloatingPanel |
| `studio.recStart(opts)` | `hq:studio:rec-start` | `{sourceId, mic, sysAudio, fps, sourceLabel?}` | `{recId, tmpPath}` \| `{error}` — opens `<slug>.webm.part` write stream and starts the 30-min auto-split + disk-space watchdog | FloatingPanel |
| `studio.recStop(recId)` | `hq:studio:rec-stop` | `{recId}` | final path \| `null` — flushes, `fsyncSync`, `renameSync` `.part`→`.webm`, then emits `studio:capture-added` | FloatingPanel |
| `studio.recToggle(opts?)` | `hq:studio:rec-toggle` | `{sourceId?, mic?, sysAudio?, fps?, sourceLabel?}` (opts optional) | `{toggled:'stopped', recId}` \| `{toggled:'panel-opened'}` \| `{recId, tmpPath}` — hotkey path; stops the first live recorder or starts one with saved defaults, opens the panel if no source is configured | Ctrl+Alt+R / panel |
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
(`dashboard-v4/src/surfaces/work/agent-pane.js`,
`dashboard-v4/src/surfaces/automate/sessions.js`, plus v3's summoning realm),
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
