# Claude Hub H3 (In-app chat, Claude Code engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can chat with Claude inside WorkspaceHQ: start a new chat in any WorkspaceHQ or Claude Code project, or continue any indexed Claude Code session, with a Read-only / Allow edits switch, live streaming text, collapsed tool rows, Send / Stop and a "uses your Claude quota" label on every send; the chat lands in the H2 library on its own because it is an ordinary Claude Code session.

**Architecture:** A new main-side module `dashboard/claude-chat.js` (CommonJS, Electron main, Node 20) runs one `claude -p … stream-json` process per turn with the prompt on stdin, in a cwd it resolves itself (WorkspaceHQ project path or a cwd the Hub already recorded; deny list always wins). Its stdout goes through a new pure `parseEvents()` added to `dashboard/stream-parse.js` and becomes `hq:claude-chat:event` pushes. The renderer (v5) keeps turns in `store.live.claudeChat`, maps them in `live/adapter.mjs`, and shows the composer under H2's thread view. No Hub change: H2's `changed` event already refreshes the library when Claude Code writes the new transcript.

**Tech Stack:**
- Electron 32 main (CommonJS, Node 20) for `claude-chat.js`; `child_process.spawn`, `cmd.exe` for npm `.cmd` shims, `taskkill` / CIM for the tree stop.
- Claude Code CLI (verified 2026-10-16 on the owner's machine: 2.1.292 accepts `--include-partial-messages`, `--permission-prompts none|host`, `--permission-mode acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`, `--resume <id>`).
- The v5 renderer (vanilla ESM, dc-lite templates, no build step).
- `node --test`, the v5 selftest and `dashboard-v5/tools/cdp-gate.mjs`; a fake `claude` shim (`.cmd` + Node script) for every test and gate.

**Spec:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md` — this phase covers §8 (`claude-chat.js`: per-turn argv, stdin prompt, cwd rule, launcher-safe tree stop on cancel, limits, the never-bypass unit test, claude.ai seeding), §7 `claudeChat.send/cancel/on`, §9 composer (project picker, Read-only / Allow edits, Send / Stop, quota label, streaming into the thread view, "New chat" on project pages, "Continue in Claude Code" for web chats), §11 fake `claude` shim and CDP scenarios `claude-chat-stream-stop`, `claude-chat-mode-readonly`. The H1 plan (`docs/superpowers/plans/2026-10-13-claude-hub.md`, "H3 Chat" outline) and the H2 plan (`docs/superpowers/plans/2026-10-15-claude-hub-h2.md`) hold the interfaces this plan consumes.

## Global Constraints

Binding, from the spec and the H1 plan:
- Hub runtime: system Node ≥ 22.13. The Electron main process (Node 20) never imports node:sqlite; everything that touches hub.sqlite runs inside dashboard/claude-hub/hub.mjs.
- All imported data, indexes, temp files and logs live under data/claude/ (gitignored). Nothing leaves the machine except the owner's own claude.ai session requests (H4) and the owner's own Claude Code calls (H3).
- Fixtures: placeholder text only (project-a, example.org…); secret-shaped test strings are built at runtime, never committed literally.
- Never read a transcript whole; stream with byte cursors. The owner's ~/.claude is read-only, always.
- Test overrides: HQ_CLAUDE_HOME (a folder containing projects/), HQ_CLAUDE_DB (the db file), HQ_HUB_NODE, HQ_STUDIO_ROOT, HQ_APP_LOG_DIR, HQ_DRY_LAUNCH=1. EVERY test, harness, second instance and gate sets HQ_CLAUDE_DB + HQ_CLAUDE_HOME to temp/fixture paths — never the owner's real index (data/claude/hub.sqlite is live and owned by the owner's running app).
- IPC: every new channel/field gets a docs/sync/IPC-CONTRACT.md row BEFORE its handler (additive only); main-side code goes in new files with one-line hooks in dashboard/main.js; list every touched main.js line in the report.
- v5 renderer: template additions carry <!-- v5: reason --> markers; follow the Claude Design visual language (tokens, existing classes); goldens (src/vals.golden.test.mjs, src/__golden__/, src/tpl.hash.test.mjs) are re-recorded only after every changed scenario is attributed; src/selftest.js gets combos for every new state/overlay; dashboard-v5/tools/fake-preload.js mirrors every new preload method (fake-parity test); CSP unchanged (default-src 'self', no eval, no remote).
- Honesty: no invented numbers; "active time" is labelled estimate; empty states say why; estimates labelled; every in-app Claude send is labelled "uses your Claude quota".
- Chat engine (H3): never pass --dangerously-skip-permissions or --permission-mode bypassPermissions (a unit test pins this); read-only = plan, edits = acceptEdits; --permission-prompts none; one running turn per conversation, 3 total, 10-min cap; tests and gates use a fake `claude` shim on PATH (see dashboard/claude-launch.test.mjs for the pattern) — never spend real quota in tests.
- Extension (H4): read-only GETs to claude.ai, ≤ 1 request / 2 s, exponential backoff, shape-change pause with a visible status, optional host permission granted on the owner's click; never writes to claude.ai. A manual extension reload is an owner action — say so.
- Vault (H5): never writes without the owner's confirmation in the UI; atomic writes; never overwrites without an explicit replace confirm; only under VEEMO CORTEX/30_Areas/Claude/.
- Commits: explicit pathspecs (never git add -A), fe: / meta: prefixes, end with a truthful "Co-Authored-By: Claude <your model name> <noreply@anthropic.com>". Never amend, rebase, reset, stash, checkout or rewrite history on this shared tree. Never touch collector/, schema/, run-pipeline.ps1, run-scan.ps1, spellbook/, data/quest-overrides.json, collector/collector.config.json, legacy/.
- Processes: the owner's app (electron.exe . --hidden WITHOUT --user-data-dir, and its Hub child node … hub.mjs on data/claude/hub.sqlite) is never stopped; stop only PIDs you start (PowerShell Stop-Process -Id). Second instances: from dashboard/: node_modules\electron\dist\electron.exe . --hidden --user-data-dir=%TEMP%\<unique> --remote-debugging-port=<your port> with the env overrides above. Remove temp folders by literal path.
- Suites: node --test dashboard/claude-hub/*.test.mjs ; node --test dashboard/*.test.mjs ; v5: node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs ; v5 selftest from dashboard-v5: set HQ_V5_PROFILE=<unique>; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest (exit 0, errors/unresolved/failures 0); CDP scenarios: node dashboard-v5/tools/cdp-gate.mjs --scenario all against a --preload=fake harness.

Standing controller rulings from H1 (binding):
- Store/Hub errors surface (never swallowed into empty results); meta.last_error + the 'error' event carry them.
- The Hub lock is {pid, db} JSON; a live owner is a node process running hub.mjs on the same db.
- meta.index_version forces a one-off rebuild when the parser changes what it indexes — bump it when you change parse-code.mjs or redact.mjs semantics.
- Secrets are masked on the FULL text before any cut; every new text path into the index goes through maskSecrets BEFORE any length limit.
- Message ids are per conversation ('code:<session>:<uuid>'); usage is per API response (api_id) — never double count.
- Paging must tiebreak by (at, id) — H1's strict < cursor is a known gap for H2 to fix.
- Claude.ai export fields are undocumented: parse defensively, import what is understood, report counts only.
- Plans may deviate from the spec only with a reason written in the plan; the spec is the authority.

H3-specific (decided here):
- Commit trailer for this plan: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — an executor on another model writes its own model name.
- H3 touches no Hub file (`dashboard/claude-hub/*`): no parser or masking change, so `INDEX_VERSION` stays as H2 left it.
- The engine NEVER uses `claude-sessions.findClaude()`: it probes the owner's absolute `…\npm\claude.cmd` before `claude`, so a fake shim on PATH would lose and a test would spend real quota. `claude-chat.js` has its own resolver: env `HQ_CLAUDE_BIN` (NEW test override, documented in README beside `HQ_HUB_NODE`) else the first `claude.exe` / `claude.cmd` on the given env's `PATH`.
- Node ≥ 20.12 refuses `spawn('x.cmd')` without a shell (EINVAL). A `.cmd`/`.bat` binary is run as `cmd.exe /d /v:off /s /c ""<bin>" <fixed args>"` with `windowsVerbatimArguments`; nothing user-controlled is ever on that line (the prompt is on stdin; `--resume` takes only a UUID-shaped id; the bin path is refused when it holds `" % ! ^ & | < >`). This also makes the tree stop land on a `cmd.exe` root, the same shape do-commit's `stopGitTree` handles.
- Paths never cross IPC (K-5 rule): `projectId` is either a Hub project id (`code:<folder>`, cwd = that project's Hub-recorded `path`) or a WorkspaceHQ project id (cwd = `getProjects()`'s containment-checked `path`, main.js `studioProjects`).

## Review Focus

1. **Hostile ids and folders.** A renderer (or a poisoned index row) sends `conversationId: 'code:x" & calc'`, a `projectId` of `code:..\\..\\Windows`, a session id with spaces, or a recorded cwd of `C:\`, `C:\Windows\System32`, `C:\Program Files\x` or the profile root. Nothing user-controlled reaches argv or the command line; the deny list wins over "the Hub recorded it". *Pinned in Task 1 (`buildArgs` refuses a non-UUID resume id; `cwdRefusal` table) and Task 3 (`resolveTarget` hostile-id tests).*
2. **The stream lies twice.** With `--include-partial-messages`, Claude Code sends every text both as `stream_event` `text_delta`s and again in the complete `assistant` line; on Windows lines end in CRLF; banners and non-JSON lines appear; a failed run ends with `result` `is_error: true` and no text. Text must render exactly once, a failure must say why, and the parser never throws. *Pinned in Task 2 (`parseEvents` tests).*
3. **Stop in the middle of a tool call.** The owner presses Stop while Claude Code runs a tool through the npm `.cmd` launcher. The whole process tree ends (no orphan `claude.exe`), the turn ends exactly once as `done` with `stopped: true` and the text streamed so far, and a late `close` never emits a second end. *Pinned in Task 4 (runner unit test) and Task 5 (fake-shim end-to-end: the hanging shim's pid is gone after `cancel`).*
4. **A project outside Documents.** The owner's Desktop project has Claude Code sessions, so its cwd is recorded in the Hub but `resolveProjectPath` refuses it. Continuing that chat works; a WorkspaceHQ id outside Documents still does not; a recorded cwd that no longer exists is refused with the reason. *Pinned in Task 3.*
5. **Too many turns.** A second send on a conversation whose turn is still running, a 4th concurrent turn, and a turn that runs past 10 minutes. Each answers `{error}` with the reason (nothing spawned for the first two); the third is tree-stopped and ends as `error` "stopped after 10 min". *Pinned in Task 4.*

---

## File structure (H3)

| File | Responsibility |
|---|---|
| `dashboard/stream-parse.js` (+ `stream-parse.test.mjs`) | NEW additive export `parseEvents(buffered, chunk) -> {events, rest}`; `parseChunk` untouched (session-api keeps working) |
| `dashboard/claude-chat.js` — new (+ `claude-chat.test.mjs`) | pure core (`MODES`, `buildArgs`, `isSessionId`, `cwdRefusal`, `seedPrompt`), `resolveTarget`, `resolveClaudeBin`, `killTree`, the runner `createChat`, `init()` (IPC handlers + before-quit stop) |
| `dashboard/__fixtures__/fake-claude.js` — new, `dashboard/__fixtures__/make-fake-claude.mjs` — new | the fake `claude` (Node script behind an npm-shaped `claude.cmd`): records `{argv, cwd, stdin}`, prints real-shaped stream-json; modes `ok`, `tool`, `hang`, `fail` |
| `dashboard/claude-chat.e2e.test.mjs` — new | real `cmd.exe` + shim end to end: argv, stdin, cwd, cancel kills the tree |
| `dashboard/main.js` | ONE line after the `claudeHub = require('./claude-hub-host').init(…)` line |
| `dashboard/preload.js` | `hq.claudeChat.{send, cancel, on}` (additive) |
| `dashboard-v5/tools/fake-preload.js` (+ test) | stateful fake `claudeChat.send/cancel` streaming placeholder events |
| `dashboard-v5/src/live/adapter.mjs`, `live/store.js` (+ tests) | `chatTurn`, `liveTurns`; `live.claudeChat` + `sendClaudeChat`, `cancelClaudeChat`, subscription |
| `dashboard-v5/src/logic/claude-chat.js` — new (+ `claude-chat.test.mjs`) | mixin `claudeChatLogic` + pure `composerView`, `pickerOptions` |
| `dashboard-v5/src/vals/claude-chat.js` — new | `claudeChatVals` render values |
| `dashboard-v5/src/app.js`, `src/vals/index.js`, `src/logic/claude-lib.js` (H2) | state keys, mixin + surface wiring, `clNewChat` handler swap |
| `dashboard-v5/src/tpl/claude.tpl.js`, `src/tpl.hash.test.mjs`, `src/__golden__/vals.hashes.json`, `src/vals.golden.test.mjs`, `src/selftest.js` | composer markup + re-records + combos |
| `dashboard-v5/tools/cdp-gate.mjs` | scenarios `claude-chat-stream-stop`, `claude-chat-mode-readonly` |
| `docs/sync/IPC-CONTRACT.md`, `README.md`, `CLAUDE.md`, `docs/sync/HANDOFF.md` | rows before handlers, test commands + `HQ_CLAUDE_BIN`, facts, handoff |

H2 interfaces consumed (H2 executes first; anchor by symbol, not line — line numbers in H2-touched files will have moved): `live.claudeLib.thread` (`{conversation:{id, native_id, cwd, source, project_id}, messages, …}` from `openClaudeThread(id)`), `live.claudeLib.projects` (Hub rows `{id, source, name, path, …}`), store `openClaudeThread(id)`, `refreshClaudeLib()`, mixin `clOpenChat(id)`, `clNewChat(project)` (H2 Task 10: "H3 replaces the handler, not the markup"), vals key `clHasThread`, the `<section data-cl="thread">` block in `tpl/claude.tpl.js`, and the `changed`-event refresh in `live/store.js`.

Deviations from the spec, decided here (each with its reason):
- **`send` resolves at spawn, not at init.** §7 says `{turnId, sessionId?}`; a continue returns the `sessionId` at once, a new chat gets it in a NEW event kind `session` (`{turnId, kind:'session', sessionId, mode}`) and again on `done`. Waiting for the init line would block the IPC call for seconds on a cold CLI and buys nothing the event does not.
- **Event payloads are pinned** (§7 only names the kinds): `delta {text}`, `tool {name, hint}`, `done {sessionId, mode, usage|null, isError, subtype, result, stopped}`, `error {error}`; plus `session` above. Additive to §7.
- **A prompt cap of 100 000 chars** (§8 caps only the claude.ai seed at 30 000): stdin is unbounded otherwise and a pasted log could be megabytes of quota.
- **"Continue in Claude Code" for claude.ai chats ships as the engine branch only.** claude.ai rows arrive with H4 (the H1 outline lists the UI there). H3 implements `seedPrompt` + the `resolveTarget` branch (`conversation.source !== 'code'` → new chat in the linked project, no `--resume`) + the additive `seeded: {chars, trimmed}` field on the `send` result, and the composer's "Continue" button shows the trim note. It is exercised by unit tests with a fake Hub row. The `projectId` override for a web chat ("a project picked in the composer wins over a missing link") is unreachable from H3's UI, because `ccContinue` hides the picker; it becomes reachable once H4 adds a picker for web chats.
- **`HQ_CLAUDE_BIN`** is a new test override (reason in H3-specific above).
- **No `claude-sessions.findClaude()`.** Spec §3.1 lists it as the engine's dependency ("read-only use"); it probes the owner's absolute npm `claude.cmd` before PATH, so a fake shim on PATH would lose and a test or gate would spend real quota (§11 forbids that). `resolveClaudeBin` (HQ_CLAUDE_BIN, then PATH) replaces it; `claude-sessions.js` is untouched.
- **The renderer's composer lives in the Chats sub-tab** as one panel under the search/filter section, above the hits and the list/thread row (the thread header only gains a "Continue" button that opens the panel on that chat; "New chat" opens it with a project picker), and the project page's "New chat" opens that panel preset to the project. Turns stream inside the panel. The Sessions sub-tab's existing composer (`hq:session-start`) is untouched: it is a different feature (background agent runs).

---

### Task 1: Chat engine pure core — argv (never bypass), cwd deny list, claude.ai seed (`claude-chat.js`, new)

Closes Review Focus 1 (argv half).

**Files:**
- Create: `dashboard/claude-chat.js`, `dashboard/claude-chat.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; `node:path`, `node:os` only).
- Produces (CommonJS exports, all NEW):
  - `MODES` — frozen `{ 'read-only': 'plan', edits: 'acceptEdits' }` (spec §8 mapping; nothing else).
  - `FORBIDDEN_ARGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions']`.
  - `PROMPT_MAX = 100000`, `SEED_MAX = 30000`, `TURN_MS = 600000`, `MAX_TURNS = 3`.
  - `isSessionId(s) -> boolean` — UUID shape only (`8-4-4-4-12` hex).
  - `buildArgs({ mode, sessionId = null }) -> string[]` — exactly `['-p','--output-format','stream-json','--verbose','--include-partial-messages','--permission-prompts','none','--permission-mode', MODES[mode]]` + `['--resume', sessionId]` when given; throws `'unknown mode'` for any mode not an own key of `MODES`, `'bad session id'` for a non-UUID id, and `'refused: <arg>'` if a forbidden token ever appears.
  - `cwdRefusal(dir, env = process.env) -> string | null` — pure (no fs): `null` = allowed; else the reason: `'not an absolute folder'`, `'a network or device path'` (`\\…`), `'a drive root'`, `'the Windows folder'` (`env.SystemRoot`/`env.windir`, default `C:\Windows`, and anything inside), `'Program Files'` (`env.ProgramFiles`, `env['ProgramFiles(x86)']`, `env.ProgramW6432` and inside), `'your user folder itself'` (`env.USERPROFILE` or `os.homedir()`, equal only — folders inside it are fine). Case-insensitive on win32.
  - `seedPrompt({ title, text, message }) -> { prompt, chars, trimmed }` — keeps the LAST `SEED_MAX` chars of `text` (the end of a chat is what a continuation needs), never starts on half a surrogate pair; header `Context: a claude.ai conversation titled "<title or Untitled chat>", copied into Claude Code by WorkspaceHQ`, plus ` (trimmed to its last 30000 characters)` when trimmed; then the text, `\n\n---\n\n`, and the owner's message.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-chat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { MODES, FORBIDDEN_ARGS, buildArgs, isSessionId, cwdRefusal, seedPrompt, SEED_MAX } = require('./claude-chat.js');

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BASE = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none', '--permission-mode'];

test('buildArgs: exact argv per mode, resume only with a UUID', () => {
  assert.deepEqual(buildArgs({ mode: 'read-only' }), [...BASE, 'plan']);
  assert.deepEqual(buildArgs({ mode: 'edits' }), [...BASE, 'acceptEdits']);
  assert.deepEqual(buildArgs({ mode: 'read-only', sessionId: SID }), [...BASE, 'plan', '--resume', SID]);
  for (const bad of ['x" & calc', 'abc', `${SID} --dangerously-skip-permissions`, `${SID}\n`, '../x', '']) {
    assert.throws(() => buildArgs({ mode: 'read-only', sessionId: bad }), /bad session id/, JSON.stringify(bad));
  }
});

test('never bypass: only plan/acceptEdits exist, every other mode is refused, no forbidden token in any argv', () => {
  assert.deepEqual(Object.values(MODES).sort(), ['acceptEdits', 'plan']);
  assert.ok(Object.isFrozen(MODES));
  for (const m of ['bypassPermissions', 'auto', 'dontAsk', 'manual', 'plan', 'acceptEdits', '__proto__', 'constructor', 'toString', '', null, undefined]) {
    assert.throws(() => buildArgs({ mode: m }), /unknown mode/, String(m));
  }
  for (const mode of Object.keys(MODES)) for (const sessionId of [null, SID]) {
    const argv = buildArgs({ mode, sessionId });
    for (const f of FORBIDDEN_ARGS) assert.ok(!argv.some((a) => a.includes(f)), `${mode}/${sessionId} carries ${f}`);
    assert.equal(argv[argv.indexOf('--permission-prompts') + 1], 'none');
  }
});

test('isSessionId: UUID shape only', () => {
  assert.equal(isSessionId(SID), true);
  assert.equal(isSessionId(SID.toUpperCase()), true);
  for (const s of [null, 42, '', 'sess-a1', SID + 'x', ' ' + SID, SID.replace(/-/g, '')]) assert.equal(isSessionId(s), false, String(s));
});

test('cwdRefusal: deny list (drive roots, Windows, Program Files, the profile root itself)', { skip: process.platform !== 'win32' && 'win32 paths' }, () => {
  const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramW6432: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\placeholder' };
  const cases = [
    ['C:\\', 'a drive root'], ['D:\\', 'a drive root'], ['c:', 'not an absolute folder'], ['relative\\dir', 'not an absolute folder'], ['', 'not an absolute folder'], [null, 'not an absolute folder'],
    ['C:\\Windows', 'the Windows folder'], ['c:\\windows\\system32', 'the Windows folder'],
    ['C:\\Program Files\\x', 'Program Files'], ['C:\\Program Files (x86)', 'Program Files'],
    ['C:\\Users\\placeholder', 'your user folder itself'], ['C:\\Users\\PLACEHOLDER\\', 'your user folder itself'],
    ['\\\\server\\share\\x', 'a network or device path'], ['\\\\?\\C:\\x', 'a network or device path'],
    ['C:\\Users\\placeholder\\Documents\\project-a', null], ['C:\\Users\\placeholder\\Desktop\\project-b', null], ['C:\\Windowsish\\x', null], ['D:\\work\\project-c', null],
  ];
  for (const [dir, want] of cases) assert.equal(cwdRefusal(dir, env), want, JSON.stringify(dir));
});

test('seedPrompt: header, last 30 000 chars, surrogate-safe, message last', () => {
  const s = seedPrompt({ title: 'Release planning', text: 'short chat', message: 'Go on' });
  assert.equal(s.trimmed, false); assert.equal(s.chars, 10);
  assert.equal(s.prompt, 'Context: a claude.ai conversation titled "Release planning", copied into Claude Code by WorkspaceHQ\n\nshort chat\n\n---\n\nGo on');
  const t = seedPrompt({ title: '', text: 'A'.repeat(SEED_MAX) + 'B'.repeat(10), message: 'm' });
  assert.equal(t.trimmed, true); assert.equal(t.chars, SEED_MAX);
  assert.match(t.prompt, /^Context: a claude\.ai conversation titled "Untitled chat", copied into Claude Code by WorkspaceHQ \(trimmed to its last 30000 characters\)\n\n/);
  assert.ok(t.prompt.endsWith('B'.repeat(10) + '\n\n---\n\nm'));
  const u = seedPrompt({ title: 't', text: '🚀'.repeat(SEED_MAX) + 'x', message: 'm' });   // the cut lands at an odd offset inside the run: a naive cut starts on a low surrogate
  assert.equal(/^[\uDC00-\uDFFF]/.test(u.prompt.split('\n\n')[1]), false, 'no lone low surrogate at the cut');
  assert.equal(u.chars, SEED_MAX - 1, 'the half pair was dropped');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: FAIL — `Cannot find module './claude-chat.js'`.

- [ ] **Step 3: Implement**

```js
// dashboard/claude-chat.js
'use strict';
// Claude Hub H3 (spec 2026-10-13 §8) — the in-app chat engine. One `claude -p … stream-json`
// process per turn, prompt on stdin, in a folder this file resolves itself. Pure core first
// (argv, deny list, seed); target resolution, the runner and init() follow (Tasks 3, 4, 6).
// Never bypass: only `plan` and `acceptEdits` exist here; claude-chat.test.mjs pins it.
const path = require('node:path');
const os = require('node:os');

const MODES = Object.freeze({ 'read-only': 'plan', edits: 'acceptEdits' });
const FORBIDDEN_ARGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions'];
const PROMPT_MAX = 100000;      // stdin cap (plan deviation: a pasted log must not become megabytes of quota)
const SEED_MAX = 30000;         // spec §8: claude.ai seed
const TURN_MS = 10 * 60 * 1000; // spec §8: hard cap per turn
const MAX_TURNS = 3;            // spec §8: at most 3 at once
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSessionId(s) { return typeof s === 'string' && SESSION_RE.test(s); }

function buildArgs({ mode, sessionId = null } = {}) {
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, mode)) throw new Error('unknown mode');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-prompts', 'none', '--permission-mode', MODES[mode]];
  if (sessionId != null) {
    if (!isSessionId(sessionId)) throw new Error('bad session id');
    args.push('--resume', sessionId);
  }
  for (const a of args) for (const f of FORBIDDEN_ARGS) if (a.includes(f)) throw new Error('refused: ' + f);
  return args;
}

const WIN = process.platform === 'win32';
function norm(p) {
  let s = path.resolve(p);
  if (s.length > path.parse(s).root.length) s = s.replace(/[\\/]+$/, '');
  return WIN ? s.toLowerCase() : s;
}
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function cwdRefusal(dir, env = process.env) {
  if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir) || /^[a-z]:$/i.test(dir)) return 'not an absolute folder';
  if (/^[\\/]{2}/.test(dir)) return 'a network or device path';
  const d = norm(dir);
  if (d === norm(path.parse(path.resolve(dir)).root)) return 'a drive root';
  if (within(d, norm(env.SystemRoot || env.windir || 'C:\\Windows'))) return 'the Windows folder';
  for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]) if (pf && within(d, norm(pf))) return 'Program Files';
  const home = env.USERPROFILE || os.homedir();
  if (home && d === norm(home)) return 'your user folder itself';
  return null;
}

function seedPrompt({ title, text, message } = {}) {
  let body = String(text == null ? '' : text);
  const trimmed = body.length > SEED_MAX;
  if (trimmed) {
    body = body.slice(body.length - SEED_MAX);
    if (/^[\uDC00-\uDFFF]/.test(body)) body = body.slice(1);   // never start on half a surrogate pair
  }
  const name = String(title || '').trim() || 'Untitled chat';
  const head = `Context: a claude.ai conversation titled "${name}", copied into Claude Code by WorkspaceHQ`
    + (trimmed ? ` (trimmed to its last ${SEED_MAX} characters)` : '');
  return { prompt: `${head}\n\n${body}\n\n---\n\n${String(message == null ? '' : message)}`, chars: body.length, trimmed };
}

module.exports = { MODES, FORBIDDEN_ARGS, PROMPT_MAX, SEED_MAX, TURN_MS, MAX_TURNS, isSessionId, buildArgs, cwdRefusal, seedPrompt };
```

(The ASCII seed case keeps exactly `SEED_MAX` chars; in the emoji case the trailing `x` makes the cut land on a low surrogate, which is dropped, so `chars` is `SEED_MAX - 1`.)

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: PASS (5 tests; the deny-list test is skipped off Windows).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-chat.js dashboard/claude-chat.test.mjs
git commit -m "fe: Claude Hub H3 chat engine core — argv (never bypass, pinned), cwd deny list, claude.ai seed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Structured stream events — `parseEvents` (`stream-parse.js`, additive)

Closes Review Focus 2. Spec §8 "stdout goes through a stream-json parser (extending `stream-parse.js`'s rules)".

**Files:**
- Modify: `dashboard/stream-parse.js` (new function before `module.exports`; `module.exports = { parseChunk, parseEvents }`)
- Test: `dashboard/stream-parse.test.mjs` (append; it already imports `{ parseChunk } from './stream-parse.js'` — change that line to `import { parseChunk, parseEvents } from './stream-parse.js';`)

**Interfaces:**
- Consumes: the file's private `toolHint(input)` (same hint rules as `parseChunk`).
- Produces (NEW export; `parseChunk` is untouched, so `session-api.js` behaves exactly as before):
  - `parseEvents(buffered, chunk) -> { events, rest }` — pure, never throws, `buffered` is the previous call's `rest` (same buffering contract as `parseChunk`: complete lines only, CRLF stripped, blank lines skipped, a partial trailing line waits in `rest`). Events:
    - `{ kind: 'session', sessionId }` — `system` / `subtype: 'init'` with a string `session_id`.
    - `{ kind: 'delta', text }` — `stream_event` whose `event.delta.type === 'text_delta'` (non-empty `text`). Text comes ONLY from here: with `--include-partial-messages` the complete `assistant` line repeats the same text, so `assistant` text blocks are ignored (no double render).
    - `{ kind: 'tool', name, hint }` — each `tool_use` block of an `assistant` line (`name` defaults to `'tool'`; `hint` via `toolHint`, `''` when none).
    - `{ kind: 'result', sessionId, usage, isError, subtype, result }` — the `result` line: `sessionId` = `session_id` or `null`; `usage` = `{ in, out, cacheRead, cacheWrite }` from `input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens` (missing numbers → 0) or `null` when `usage` is absent (unknown is not zero); `isError` = `is_error === true` or a subtype starting `error`; `subtype` string or `''`; `result` string or `''`.
    - `{ kind: 'raw', text }` — a complete line that is not a JSON object (banner, stderr-ish text): never dropped (same rule as `parseChunk`).
    - `user`, other `system` subtypes, other `stream_event`s (`thinking_delta`, `input_json_delta`, `message_start`, …) and unknown types produce nothing — protocol events with no user-facing content, filtered by design.

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/stream-parse.test.mjs
const J = (o) => JSON.stringify(o);
const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const delta = (text) => J({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

test('parseEvents: init, deltas, tool, result — text exactly once even though assistant repeats it', () => {
  const lines = [
    J({ type: 'system', subtype: 'init', session_id: SID, cwd: 'C:\\placeholder\\project-a' }),
    J({ type: 'stream_event', event: { type: 'message_start', message: {} } }),
    delta('Hello'), delta(' world'),
    J({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } }),
    J({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\placeholder\\project-a\\README.md' } }] } }),
    J({ type: 'user', message: { content: [{ type: 'tool_result', content: 'file text' }] } }),
    J({ type: 'result', subtype: 'success', is_error: false, session_id: SID, result: 'Hello world', usage: { input_tokens: 6, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } }),
  ];
  const { events, rest } = parseEvents('', lines.join('\n') + '\n');
  assert.equal(rest, '');
  assert.deepEqual(events, [
    { kind: 'session', sessionId: SID },
    { kind: 'delta', text: 'Hello' }, { kind: 'delta', text: ' world' },
    { kind: 'tool', name: 'Read', hint: 'C:\\placeholder\\project-a\\README.md' },
    { kind: 'result', sessionId: SID, usage: { in: 6, out: 40, cacheRead: 100, cacheWrite: 10 }, isError: false, subtype: 'success', result: 'Hello world' },
  ]);
});

test('parseEvents: CRLF, split lines, blank lines, banners and non-object JSON', () => {
  const a = parseEvents('', 'Claude Code banner\r\n' + delta('par'));
  assert.deepEqual(a.events, [{ kind: 'raw', text: 'Claude Code banner' }]);
  const b = parseEvents(a.rest, '\r\n42\r\n[1,2]\r\n');
  assert.deepEqual(b.events, [{ kind: 'delta', text: 'par' }, { kind: 'raw', text: '42' }, { kind: 'raw', text: '[1,2]' }]);
  assert.equal(b.rest, '');
  const c = parseEvents('', '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}');
  assert.deepEqual(c.events, []); assert.ok(c.rest.length > 0, 'a partial line waits');
});

test('parseEvents: a failed run says why; missing usage is null, not zero', () => {
  const { events } = parseEvents('', J({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: SID }) + '\n'
    + J({ type: 'result', subtype: 'error_during_execution' }) + '\n');
  assert.deepEqual(events, [
    { kind: 'result', sessionId: SID, usage: null, isError: true, subtype: 'error_max_turns', result: '' },
    { kind: 'result', sessionId: null, usage: null, isError: true, subtype: 'error_during_execution', result: '' },
  ]);
});

test('parseEvents: hostile shapes never throw', () => {
  const weird = [J({ type: 'assistant', message: { content: 'not an array' } }), J({ type: 'assistant', message: { content: [null, 7, { type: 'tool_use' }] } }),
    J({ type: 'stream_event' }), J({ type: 'stream_event', event: { delta: null } }), J({ type: 'system', subtype: 'init', session_id: 7 }),
    J({ type: 'result', usage: 'x' }), J(null), '{bad json', '\u0000'];
  const { events } = parseEvents(null, weird.join('\n') + '\n');
  assert.deepEqual(events.filter((e) => e.kind === 'tool'), [{ kind: 'tool', name: 'tool', hint: '' }]);
  assert.ok(events.every((e) => typeof e.kind === 'string'));
});
```

(In the CRLF test `b`'s chunk is `'\r\n42\r\n[1,2]\r\n'`: the first `\r\n` completes the `delta('par')` line left in `a.rest`.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard/stream-parse.test.mjs`
Expected: FAIL — `SyntaxError: The requested module './stream-parse.js' does not provide an export named 'parseEvents'`.

- [ ] **Step 3: Implement** (insert above `module.exports`, then change the export line)

```js
// Claude Hub H3 (spec §8): structured events for the in-app chat engine (claude-chat.js).
// Same buffering contract as parseChunk; parseChunk itself is unchanged. With
// --include-partial-messages the text arrives as stream_event text_deltas AND again in the
// complete `assistant` line, so text comes only from the deltas and `assistant` lines
// contribute only their tool_use blocks (one render, never two).
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function eventsFrom(ev) {
  if (ev.type === 'system') {
    return ev.subtype === 'init' && typeof ev.session_id === 'string' && ev.session_id ? [{ kind: 'session', sessionId: ev.session_id }] : [];
  }
  if (ev.type === 'stream_event') {
    const d = ev.event && typeof ev.event === 'object' ? ev.event.delta : null;
    return d && typeof d === 'object' && d.type === 'text_delta' && typeof d.text === 'string' && d.text ? [{ kind: 'delta', text: d.text }] : [];
  }
  if (ev.type === 'assistant') {
    const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    const out = [];
    for (const b of content) {
      if (!b || typeof b !== 'object' || b.type !== 'tool_use') continue;
      out.push({ kind: 'tool', name: typeof b.name === 'string' && b.name ? b.name : 'tool', hint: toolHint(b.input) });
    }
    return out;
  }
  if (ev.type === 'result') {
    const u = ev.usage && typeof ev.usage === 'object' ? ev.usage : null;
    const subtype = typeof ev.subtype === 'string' ? ev.subtype : '';
    return [{
      kind: 'result',
      sessionId: typeof ev.session_id === 'string' && ev.session_id ? ev.session_id : null,
      usage: u ? { in: num(u.input_tokens), out: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) } : null,
      isError: ev.is_error === true || /^error/i.test(subtype),
      subtype,
      result: typeof ev.result === 'string' ? ev.result : '',
    }];
  }
  return [];
}

function parseEvents(buffered, chunk) {
  const s = String(buffered ?? '') + String(chunk ?? '');
  const events = [];
  let start = 0;
  let idx;
  while ((idx = s.indexOf('\n', start)) !== -1) {
    let line = s.slice(start, idx);
    start = idx + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { ev = undefined; }
    if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      try { events.push(...eventsFrom(ev)); } catch { events.push({ kind: 'raw', text: line }); }
    } else {
      events.push({ kind: 'raw', text: line });
    }
  }
  return { events, rest: s.slice(start) };
}

module.exports = { parseChunk, parseEvents };
```

Also add one line to the file's header comment: `// parseEvents (Claude Hub H3) — structured events for claude-chat.js; see its own comment.`

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard/stream-parse.test.mjs`
Expected: PASS (the existing `parseChunk` tests plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/stream-parse.js dashboard/stream-parse.test.mjs
git commit -m "fe: Claude Hub H3 parseEvents — structured stream-json events (text once, tools, result, raw lines kept)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Turn target — cwd rule, continue vs new, claude.ai seed branch (`resolveTarget`)

Closes Review Focus 1 (id half) and 4. Spec §8 cwd rule: "an existing directory that is either a WorkspaceHQ project path (`resolveProjectPath`) or a cwd that a Claude Code session in the Hub has already recorded … The drive root, `C:\Windows`, `Program Files` and the user-profile root itself are always refused."

**Files:**
- Modify: `dashboard/claude-chat.js` (new function above `module.exports`; add `resolveTarget` to the exports)
- Test: `dashboard/claude-chat.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `MODES`, `PROMPT_MAX`, `isSessionId`, `cwdRefusal`, `seedPrompt`; Hub ops through the host's `request(op, args)` (resolves, never rejects; failure = `{error}` — code map §4): `getConversation({id, limit})` → `{conversation, messages, hasMore} | null` (H1, `conversation` = the raw row: `id, source, project_id, native_id, title, cwd, …`), `listProjects({source})` → raw rows with `id, source, path, hq_project_id` (H1 + H2 link columns); main's `studioProjects()` → `[{id, name, path}]` (paths absolute, already containment-checked under Documents).
- Produces (NEW): `resolveTarget(req, { hub, getProjects, isDir, env = process.env }) -> Promise<{ cwd, sessionId, key, prompt, seeded } | { error }>` where
  - `req = { conversationId?, projectId?, text, mode }` (the §7 `send` argument);
  - `sessionId` = the Claude Code session to `--resume`, or `null` for a new chat;
  - `key` = the per-conversation lock key (`conversation.id`), or `null` for a new chat (every new chat is its own conversation);
  - `prompt` = what goes on stdin (the owner's text, or the claude.ai seed + text);
  - `seeded` = `null` | `{ chars, trimmed }` (additive `send` field, see deviations).
  - Errors (exact strings, shown to the owner): `'empty message'`, `'message is over 100000 characters'`, `'unknown mode'`, `'pick a project or a chat'`, `'Claude Hub: <text>'`, `'that chat is not in the index (forgotten, or not indexed yet)'`, `'this chat has no resumable Claude Code session id'`, `'unknown Claude Code project'`, `'unknown WorkspaceHQ project, or its folder is outside Documents'`, `'link this claude.ai project to a WorkspaceHQ project first (Claude › Projects)'`, `'refused folder (<cwdRefusal reason>)'`, `'the folder no longer exists'`.
  - Rules: a Code conversation resumes in its own recorded `cwd`; a `code:<folder>` project starts a new chat in that Hub project's recorded `path`; any other `projectId` is a WorkspaceHQ id looked up in `getProjects()` only; a claude.ai conversation (`source !== 'code'`) starts a NEW chat (no `--resume`) in `req.projectId`'s folder when given, else in the WorkspaceHQ project its Hub project is linked to. `cwdRefusal` runs on every path, recorded or not, and `isDir` last. Ids are compared with `===` against Hub/scan rows and never used as paths.

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-chat.test.mjs
const { resolveTarget, PROMPT_MAX } = require('./claude-chat.js');
const ENV = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\placeholder' };
const DOCS_A = 'C:\\Users\\placeholder\\Documents\\project-a';
const DESK_B = 'C:\\Users\\placeholder\\Desktop\\project-b';
const SID2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
function fakeHub(convs = {}, projects = []) {
  const calls = [];
  const hub = async (op, args) => {
    calls.push([op, args]);
    if (op === 'getConversation') return convs[args.id] || null;
    if (op === 'listProjects') return projects.filter((p) => !args.source || p.source === args.source);
    return { error: 'unknown op' };
  };
  return { hub, calls };
}
const conv = (row, messages = []) => ({ conversation: row, messages, hasMore: false });
const deps = (h, dirs = [DOCS_A, DESK_B], hq = [{ id: 'project-a', name: 'Project A', path: DOCS_A }]) =>
  ({ hub: h.hub, getProjects: () => hq, isDir: (p) => dirs.includes(p), env: ENV });
const win = { skip: process.platform !== 'win32' && 'win32 paths' };

test('resolveTarget: input checks come first and spawn nothing', async () => {
  const h = fakeHub();
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: '  ', mode: 'read-only' }, deps(h)), { error: 'empty message' });
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'x'.repeat(PROMPT_MAX + 1), mode: 'read-only' }, deps(h)), { error: 'message is over 100000 characters' });
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'hi', mode: 'bypassPermissions' }, deps(h)), { error: 'unknown mode' });
  assert.deepEqual(await resolveTarget({ text: 'hi', mode: 'read-only' }, deps(h)), { error: 'pick a project or a chat' });
  assert.equal(h.calls.length, 0);
});

test('resolveTarget: continue a Code chat in its recorded folder — a Desktop folder the Hub recorded is allowed', win, async () => {
  const h = fakeHub({ ['code:' + SID2]: conv({ id: 'code:' + SID2, source: 'code', native_id: SID2, cwd: DESK_B, title: 'Fix the café bug' }) });
  assert.deepEqual(await resolveTarget({ conversationId: 'code:' + SID2, text: 'go on', mode: 'edits' }, deps(h)),
    { cwd: DESK_B, sessionId: SID2, key: 'code:' + SID2, prompt: 'go on', seeded: null });
});

test('resolveTarget: hostile ids and folders never reach argv or cwd; the deny list beats "recorded"', win, async () => {
  const rows = {
    'code:evil': conv({ id: 'code:evil', source: 'code', native_id: 'x" & calc', cwd: DOCS_A }),
    'code:root': conv({ id: 'code:root', source: 'code', native_id: SID2, cwd: 'C:\\' }),
    'code:sys': conv({ id: 'code:sys', source: 'code', native_id: SID2, cwd: 'C:\\Windows\\System32' }),
    'code:home': conv({ id: 'code:home', source: 'code', native_id: SID2, cwd: 'C:\\Users\\placeholder' }),
    'code:gone': conv({ id: 'code:gone', source: 'code', native_id: SID2, cwd: 'C:\\Users\\placeholder\\Documents\\deleted' }),
  };
  const h = fakeHub(rows, [{ id: 'code:C--Windows', source: 'code', path: 'C:\\Windows' }]);
  const R = (req) => resolveTarget({ text: 'hi', mode: 'read-only', ...req }, deps(h));
  assert.deepEqual(await R({ conversationId: 'code:x" & calc' }), { error: 'that chat is not in the index (forgotten, or not indexed yet)' });
  assert.deepEqual(await R({ conversationId: 'code:evil' }), { error: 'this chat has no resumable Claude Code session id' });
  assert.deepEqual(await R({ conversationId: 'code:root' }), { error: 'refused folder (a drive root)' });
  assert.deepEqual(await R({ conversationId: 'code:sys' }), { error: 'refused folder (the Windows folder)' });
  assert.deepEqual(await R({ conversationId: 'code:home' }), { error: 'refused folder (your user folder itself)' });
  assert.deepEqual(await R({ conversationId: 'code:gone' }), { error: 'the folder no longer exists' });
  assert.deepEqual(await R({ projectId: 'code:..\\..\\Windows' }), { error: 'unknown Claude Code project' });
  assert.deepEqual(await R({ projectId: 'code:C--Windows' }), { error: 'refused folder (the Windows folder)' });
  assert.deepEqual(await R({ projectId: '..\\..\\Windows' }), { error: 'unknown WorkspaceHQ project, or its folder is outside Documents' });
  assert.deepEqual(await R({ projectId: 42 }), { error: 'pick a project or a chat' });
});

test('resolveTarget: new chats — WorkspaceHQ id or Hub code project; a Hub error surfaces', win, async () => {
  const h = fakeHub({}, [{ id: 'code:C--placeholder-Desktop-project-b', source: 'code', path: DESK_B }]);
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'hi', mode: 'read-only' }, deps(h)),
    { cwd: DOCS_A, sessionId: null, key: null, prompt: 'hi', seeded: null });
  assert.deepEqual(await resolveTarget({ projectId: 'code:C--placeholder-Desktop-project-b', text: 'hi', mode: 'read-only' }, deps(h)),
    { cwd: DESK_B, sessionId: null, key: null, prompt: 'hi', seeded: null });
  const down = { hub: async () => ({ error: 'hub not running' }), getProjects: () => [], isDir: () => true, env: ENV };
  assert.deepEqual(await resolveTarget({ conversationId: 'code:' + SID2, text: 'hi', mode: 'read-only' }, down), { error: 'Claude Hub: hub not running' });
});

test('resolveTarget: a claude.ai chat starts a NEW Code chat in the linked project, seeded', win, async () => {
  const web = conv({ id: 'web:w1', source: 'web', project_id: 'web:p1', native_id: 'w1', title: 'Release planning', cwd: null },
    [{ role: 'user', text: 'Plan the release' }, { role: 'assistant', text: 'Here is a plan' }]);
  const h = fakeHub({ 'web:w1': web }, [{ id: 'web:p1', source: 'web', path: null, hq_project_id: 'project-a' }]);
  const r = await resolveTarget({ conversationId: 'web:w1', text: 'Continue here', mode: 'read-only' }, deps(h));
  assert.equal(r.cwd, DOCS_A); assert.equal(r.sessionId, null); assert.equal(r.key, 'web:w1');
  assert.deepEqual(r.seeded, { chars: 'Owner: Plan the release\n\nClaude: Here is a plan'.length, trimmed: false });
  assert.equal(r.prompt, 'Context: a claude.ai conversation titled "Release planning", copied into Claude Code by WorkspaceHQ\n\nOwner: Plan the release\n\nClaude: Here is a plan\n\n---\n\nContinue here');
  const unlinked = fakeHub({ 'web:w1': web }, [{ id: 'web:p1', source: 'web', path: null, hq_project_id: null }]);
  assert.deepEqual(await resolveTarget({ conversationId: 'web:w1', text: 'x', mode: 'read-only' }, deps(unlinked)),
    { error: 'link this claude.ai project to a WorkspaceHQ project first (Claude › Projects)' });
  const picked = await resolveTarget({ conversationId: 'web:w1', projectId: 'project-a', text: 'x', mode: 'read-only' }, deps(unlinked));
  assert.equal(picked.cwd, DOCS_A, 'a project picked in the composer wins over a missing link');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: FAIL — `resolveTarget is not a function`.

- [ ] **Step 3: Implement** (above `module.exports`; add `resolveTarget` to it)

```js
// --- Task 3: where a turn runs (spec §8 cwd rule). Ids are only ever compared with === against
// Hub / scan rows; a path is never built from an id. cwdRefusal runs on recorded paths too.
const SEED_SPEAKER = { user: 'Owner', assistant: 'Claude' };
async function resolveTarget(req, { hub, getProjects, isDir, env = process.env } = {}) {
  const r = req && typeof req === 'object' ? req : {};
  const text = typeof r.text === 'string' ? r.text : '';
  if (!text.trim()) return { error: 'empty message' };
  if (text.length > PROMPT_MAX) return { error: `message is over ${PROMPT_MAX} characters` };
  if (typeof r.mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, r.mode)) return { error: 'unknown mode' };
  const convId = typeof r.conversationId === 'string' && r.conversationId ? r.conversationId : null;
  const projId = typeof r.projectId === 'string' && r.projectId ? r.projectId : null;
  if (!convId && !projId) return { error: 'pick a project or a chat' };
  const hubErr = (x) => (x && typeof x === 'object' && !Array.isArray(x) && x.error ? { error: 'Claude Hub: ' + x.error } : null);
  const place = (cwd, rest) => {
    const why = cwdRefusal(cwd, env);
    if (why) return { error: `refused folder (${why})` };
    if (!isDir(cwd)) return { error: 'the folder no longer exists' };
    return { cwd, ...rest };
  };
  const hqPath = (id) => { const p = (getProjects() || []).find((x) => x && x.id === id); return p ? p.path : null; };
  const projectCwd = async (id) => {
    if (id.startsWith('code:')) {
      const rows = await hub('listProjects', { source: 'code' });
      if (hubErr(rows)) return hubErr(rows);
      const p = (Array.isArray(rows) ? rows : []).find((x) => x && x.id === id);
      return p && p.path ? { path: p.path } : { error: 'unknown Claude Code project' };
    }
    const p = hqPath(id);
    return p ? { path: p } : { error: 'unknown WorkspaceHQ project, or its folder is outside Documents' };
  };

  if (convId) {
    const got = await hub('getConversation', { id: convId, limit: 1 });
    if (hubErr(got)) return hubErr(got);
    const c = got && got.conversation;
    if (!c || c.id !== convId) return { error: 'that chat is not in the index (forgotten, or not indexed yet)' };
    if (c.source === 'code') {
      if (!isSessionId(c.native_id)) return { error: 'this chat has no resumable Claude Code session id' };
      return place(c.cwd, { sessionId: c.native_id, key: c.id, prompt: text, seeded: null });
    }
    // claude.ai (H4 rows): a NEW Code chat, seeded with the chat's text (spec §8)
    let dest;
    if (projId) dest = await projectCwd(projId);
    else {
      const rows = await hub('listProjects', {});
      if (hubErr(rows)) return hubErr(rows);
      const p = (Array.isArray(rows) ? rows : []).find((x) => x && x.id === c.project_id);
      const path0 = p && p.hq_project_id ? hqPath(p.hq_project_id) : null;
      dest = path0 ? { path: path0 } : { error: 'link this claude.ai project to a WorkspaceHQ project first (Claude › Projects)' };
    }
    if (dest.error) return dest;
    const full = await hub('getConversation', { id: convId, limit: 500 });
    if (hubErr(full)) return hubErr(full);
    const body = (full && Array.isArray(full.messages) ? full.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text)
      .map((m) => `${SEED_SPEAKER[m.role]}: ${m.text}`).join('\n\n');
    const s = seedPrompt({ title: c.title, text: body, message: text });
    return place(dest.path, { sessionId: null, key: c.id, prompt: s.prompt, seeded: { chars: s.chars, trimmed: s.trimmed } });
  }
  const dest = await projectCwd(projId);
  if (dest.error) return dest;
  return place(dest.path, { sessionId: null, key: null, prompt: text, seeded: null });
}
```

(`getConversation` pages hold the newest ≤ 500 messages — H1's clamp; with the 30 000-char seed cap that is always enough text. `limit: 1` first keeps a Code continue to one tiny query.)

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-chat.js dashboard/claude-chat.test.mjs
git commit -m "fe: Claude Hub H3 resolveTarget — cwd rule (project or Hub-recorded, deny list wins), resume ids, claude.ai seed branch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The turn runner — spawn, stream, Stop (tree), limits, 10-min cap (`createChat`)

Closes Review Focus 3 (unit half) and 5. Spec §8 "One process per turn", "Stop calls `cancel`, which kills the process tree with the same launcher-safe tree stop as do-commit", "Limits".

**Files:**
- Modify: `dashboard/claude-chat.js` (new functions above `module.exports`; add `resolveClaudeBin`, `killTree`, `createChat`, `EVENT` to the exports)
- Test: `dashboard/claude-chat.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `buildArgs`, `TURN_MS`, `MAX_TURNS`; Task 2 `parseEvents` (`require('./stream-parse')`); a `resolve(req)` function with Task 3's result shape.
- Produces (NEW):
  - `EVENT = 'hq:claude-chat:event'`.
  - `resolveClaudeBin(env = process.env, { exists = fs.existsSync } = {}) -> { cmd, viaCmd } | { error }` — `env.HQ_CLAUDE_BIN` (NEW test override; must be absolute and exist) else the first `claude.exe` then `claude.cmd` found on `env.PATH || env.Path`; `viaCmd` = the name ends `.cmd`/`.bat`; a path holding any of `" % ! ^ & | < >` → `{ error: 'unsafe Claude Code path' }`; nothing found → `{ error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' }`. Never consults `claude-sessions.findClaude()` (see H3-specific constraints).
  - `killTree(pid, { spawnSync = child_process.spawnSync, platform = process.platform } = {})` — win32: first every child of `pid` (`Get-CimInstance Win32_Process -Filter 'ParentProcessId=<pid>'` → `taskkill /pid <child> /t /f`, as main.js `stopGitTree`), then `taskkill /pid <pid> /t /f` (children first: once the `cmd.exe` launcher is gone its orphans can no longer be found through it); other platforms: `process.kill(pid, 'SIGKILL')`. Best effort, never throws; `pid` must be a positive integer.
  - `createChat({ resolve, bin, spawnFn = child_process.spawn, kill = killTree, send = () => {}, log = null, env = process.env, turnMs = TURN_MS, maxTurns = MAX_TURNS, graceMs = 5000 }) -> { send(req), cancel(turnId), stopAll(), running() }`:
    - `send(req) -> Promise<{ turnId, sessionId?, seeded? } | { error }>` — order: total limit (`'3 Claude turns are already running — wait for one or press Stop'`, nothing resolved or spawned) → `resolve(req)` (its `{error}` passes through) → binary (`bin()`; its `{error}` passes through) → per-conversation limit on `key` (`'this chat already has a turn running — wait for it or press Stop'`) → total re-check (another send may have started while resolving) → spawn. `sessionId` is present when resuming; `seeded` when Task 3 seeded.
    - Spawn: `viaCmd` → `spawnFn(env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', '""<cmd>" <args joined by one space>"'], { cwd, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['pipe','pipe','pipe'] })`; else `spawnFn(cmd, args, { cwd, env, windowsHide: true, stdio: [...] })`. The prompt is written to stdin, then stdin is ended.
    - Pushes `send(EVENT, payload)`: `{ turnId, kind:'session', sessionId, mode }` · `{ turnId, kind:'delta', text }` (a `raw` line arrives as `text + '\n'`) · `{ turnId, kind:'tool', name, hint }` · exactly ONE end per turn: `{ turnId, kind:'done', sessionId, mode, usage, isError, subtype, result, stopped }` (`result` = the run's text only when `isError`, else `''` — the deltas already carried it; if a successful run streamed no delta, its `result` text is pushed as one `delta` first) or `{ turnId, kind:'error', error }` (`'stopped after N min'` on the cap, `'Claude Code exited with code N[: <last stderr line ≤ 300>]'` with no result line, `'could not start Claude Code: <message>'` on a spawn error). Anything after the end (late output, a second `close`) is ignored.
    - `cancel(turnId) -> boolean` — `true` when that turn was running (marks it stopped, `kill(pid)`; the end is `done` with `stopped: true`); `false` otherwise. If no `close` arrives within `graceMs` after a kill, the turn ends anyway.
    - `stopAll()` — cancels every running turn (before-quit). `running() -> number`.
    - `log` (the app-log object) gets `log.error('claude-chat', <reason>)` for ends with an error — the reason only, never prompt or answer text.

- [ ] **Step 1: Write the failing test**

```js
// append to dashboard/claude-chat.test.mjs
import { EventEmitter } from 'node:events';
const { createChat, resolveClaudeBin, EVENT } = require('./claude-chat.js');

function fakeSpawn() {
  const kids = [];
  let pid = 1000;
  const spawnFn = (cmd, args, opts) => {
    const k = new EventEmitter();
    k.pid = ++pid; k.cmd = cmd; k.args = args; k.opts = opts; k.stdinText = ''; k.stdinEnded = false;
    k.stdin = Object.assign(new EventEmitter(), { write: (s) => { k.stdinText += s; return true; }, end: () => { k.stdinEnded = true; } });
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter();
    k.out = (...lines) => k.stdout.emit('data', Buffer.from(lines.map((l) => JSON.stringify(l)).join('\r\n') + '\r\n'));
    kids.push(k);
    return k;
  };
  return { kids, spawnFn };
}
function rig(o = {}) {
  const sp = fakeSpawn(), pushed = [], killed = [], logs = [];
  const target = o.target || ((req) => ({ cwd: DOCS_A, sessionId: req.conversationId ? SID2 : null, key: req.conversationId || null, prompt: req.text, seeded: null }));
  const c = createChat({ resolve: async (req) => target(req), bin: () => (o.bin === undefined ? { cmd: 'C:\\fake\\claude.cmd', viaCmd: true } : o.bin),
    spawnFn: sp.spawnFn, kill: (pid) => killed.push(pid), send: (ch, d) => pushed.push([ch, d]), log: { error: (n, m) => logs.push([n, m]) },
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, turnMs: o.turnMs || 60000, maxTurns: 3, graceMs: o.graceMs || 5000 });
  const ev = (turnId) => pushed.filter(([ch, d]) => ch === EVENT && d.turnId === turnId).map(([, d]) => d);
  return { c, ...sp, pushed, killed, logs, ev };
}
const tick = () => new Promise((r) => setImmediate(r));
const SESSION = { type: 'system', subtype: 'init', session_id: SID2 };
const D = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const RESULT = { type: 'result', subtype: 'success', is_error: false, session_id: SID2, result: 'Hi there', usage: { input_tokens: 1, output_tokens: 2 } };

test('runner: argv through cmd.exe, prompt on stdin, events in order, one done', async () => {
  const r = rig();
  const res = await r.c.send({ projectId: 'project-a', text: 'Say hi', mode: 'read-only' });
  assert.match(res.turnId, /^ct-/); assert.equal(res.sessionId, undefined);
  const k = r.kids[0];
  assert.equal(k.cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(k.args, ['/d', '/v:off', '/s', '/c', '""C:\\fake\\claude.cmd" ' + buildArgs({ mode: 'read-only' }).join(' ') + '"']);
  assert.equal(k.opts.windowsVerbatimArguments, true); assert.equal(k.opts.cwd, DOCS_A); assert.equal(k.opts.windowsHide, true);
  assert.equal(k.stdinText, 'Say hi'); assert.equal(k.stdinEnded, true);
  k.out(SESSION, D('Hi'), D(' there'), { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there' }] } }, RESULT);
  k.emit('close', 0); k.emit('close', 0);
  k.out(D('late'));
  assert.deepEqual(r.ev(res.turnId).map((e) => e.kind), ['session', 'delta', 'delta', 'done']);
  assert.deepEqual(r.ev(res.turnId)[3], { turnId: res.turnId, kind: 'done', sessionId: SID2, mode: 'read-only', usage: { in: 1, out: 2, cacheRead: 0, cacheWrite: 0 }, isError: false, subtype: 'success', result: '', stopped: false });
  assert.equal(r.c.running(), 0);
});

test('runner: a direct .exe is spawned without a shell; a resumed turn reports its session at once', async () => {
  const r = rig({ bin: { cmd: 'C:\\fake\\claude.exe', viaCmd: false } });
  const res = await r.c.send({ conversationId: 'code:' + SID2, text: 'more', mode: 'edits' });
  assert.equal(res.sessionId, SID2);
  assert.equal(r.kids[0].cmd, 'C:\\fake\\claude.exe');
  assert.deepEqual(r.kids[0].args, buildArgs({ mode: 'edits', sessionId: SID2 }));
  assert.equal(r.kids[0].opts.windowsVerbatimArguments, undefined);
});

test('runner: Stop mid-tool kills the tree once and ends with done{stopped}; cancel twice is false', async () => {
  const r = rig();
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'Read the readme', mode: 'read-only' });
  const k = r.kids[0];
  k.out(SESSION, D('Reading'), { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
  assert.equal(r.c.cancel(turnId), true);
  assert.deepEqual(r.killed, [k.pid]);
  assert.equal(r.c.cancel(turnId), true, 'still running until close: a second Stop is harmless');
  assert.deepEqual(r.killed, [k.pid], 'but kills only once');
  k.emit('close', 1);
  assert.equal(r.c.cancel(turnId), false);
  const kinds = r.ev(turnId).map((e) => e.kind);
  assert.deepEqual(kinds, ['session', 'delta', 'tool', 'done']);
  assert.equal(r.ev(turnId)[3].stopped, true); assert.equal(r.ev(turnId)[3].sessionId, SID2);
  assert.equal(r.c.cancel('ct-unknown'), false);
});

test('runner: limits — per chat and 3 in total; nothing spawned when refused; a freed slot is reusable', async () => {
  const r = rig();
  const a = await r.c.send({ conversationId: 'code:' + SID2, text: 'one', mode: 'read-only' });
  assert.deepEqual(await r.c.send({ conversationId: 'code:' + SID2, text: 'two', mode: 'read-only' }), { error: 'this chat already has a turn running — wait for it or press Stop' });
  await r.c.send({ projectId: 'project-a', text: 'n1', mode: 'read-only' });
  await r.c.send({ projectId: 'project-a', text: 'n2', mode: 'read-only' });
  assert.deepEqual(await r.c.send({ projectId: 'project-a', text: 'n3', mode: 'read-only' }), { error: '3 Claude turns are already running — wait for one or press Stop' });
  assert.equal(r.kids.length, 3);
  r.kids[0].out(RESULT); r.kids[0].emit('close', 0);
  assert.equal(r.c.running(), 2);
  assert.ok((await r.c.send({ conversationId: 'code:' + SID2, text: 'again', mode: 'read-only' })).turnId);
  assert.equal(r.kids.length, 4);
  assert.ok(a.turnId);
});

test('runner: the 10-min cap tree-stops the turn and ends it as an error', async () => {
  const r = rig({ turnMs: 30 });
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'slow', mode: 'read-only' });
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(r.killed, [r.kids[0].pid]);
  r.kids[0].emit('close', 1);
  const end = r.ev(turnId).pop();
  assert.equal(end.kind, 'error'); assert.match(end.error, /^stopped after \d+ min$/);
  assert.equal(r.logs.length, 1); assert.equal(r.logs[0][0], 'claude-chat');
});

test('runner: a turn that never closes after a kill still ends (grace)', async () => {
  const r = rig({ graceMs: 20 });
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' });
  r.c.cancel(turnId);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.ev(turnId).pop().kind, 'done'); assert.equal(r.c.running(), 0);
});

test('runner: failures say why — exit without result, spawn error, missing binary, resolve error, raw lines kept', async () => {
  const r = rig();
  const t1 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[0].stdout.emit('data', Buffer.from('Some banner\r\n'));
  r.kids[0].stderr.emit('data', Buffer.from('first\nAuthentication required\n'));
  r.kids[0].emit('close', 1);
  assert.deepEqual(r.ev(t1).map((e) => [e.kind, e.text || e.error]), [['delta', 'Some banner\n'], ['error', 'Claude Code exited with code 1: Authentication required']]);
  const t2 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[1].emit('error', new Error('spawn ENOENT'));
  r.kids[1].emit('close', -1);
  assert.deepEqual(r.ev(t2).map((e) => e.kind), ['error']);
  assert.equal(r.ev(t2)[0].error, 'could not start Claude Code: spawn ENOENT');
  const nob = rig({ bin: { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' } });
  assert.deepEqual(await nob.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
  const bad = rig({ target: () => ({ error: 'refused folder (a drive root)' }) });
  assert.deepEqual(await bad.c.send({ projectId: 'x', text: 'x', mode: 'read-only' }), { error: 'refused folder (a drive root)' });
  assert.equal(nob.kids.length + bad.kids.length, 0);
});

test('runner: a successful run with no deltas still shows its text; an is_error result carries its reason', async () => {
  const r = rig();
  const t = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[0].out(SESSION, RESULT); r.kids[0].emit('close', 0);
  assert.deepEqual(r.ev(t).map((e) => e.kind), ['session', 'delta', 'done']);
  assert.equal(r.ev(t)[1].text, 'Hi there');
  const t2 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[1].out({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached max turns' }); r.kids[1].emit('close', 1);
  const d = r.ev(t2).pop();
  assert.equal(d.kind, 'done'); assert.equal(d.isError, true); assert.equal(d.result, 'Reached max turns'); assert.equal(d.usage, null);
});

test('resolveClaudeBin: HQ_CLAUDE_BIN first, then claude.exe / claude.cmd on PATH; unsafe paths refused', () => {
  const have = new Set(['C:\\bin2\\claude.cmd', 'C:\\bin3\\claude.exe', 'C:\\fake\\claude.cmd', 'C:\\R&D\\claude.cmd']);
  const exists = (p) => have.has(p);
  assert.deepEqual(resolveClaudeBin({ HQ_CLAUDE_BIN: 'C:\\fake\\claude.cmd', PATH: 'C:\\bin3' }, { exists }), { cmd: 'C:\\fake\\claude.cmd', viaCmd: true });
  assert.deepEqual(resolveClaudeBin({ PATH: 'C:\\bin1;C:\\bin2;C:\\bin3' }, { exists }), { cmd: 'C:\\bin2\\claude.cmd', viaCmd: true });
  assert.deepEqual(resolveClaudeBin({ Path: 'C:\\bin3' }, { exists }), { cmd: 'C:\\bin3\\claude.exe', viaCmd: false });
  assert.deepEqual(resolveClaudeBin({ PATH: 'C:\\R&D' }, { exists }), { error: 'unsafe Claude Code path' });
  assert.deepEqual(resolveClaudeBin({ HQ_CLAUDE_BIN: 'relative\\claude.cmd' }, { exists }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
  assert.deepEqual(resolveClaudeBin({ PATH: '' }, { exists }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
});
```

(`path.join` is win32 on the owner's machine; the `resolveClaudeBin` test builds Windows paths, so add `{ skip: process.platform !== 'win32' && 'win32 paths' }` as its options argument if this suite ever runs elsewhere.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: FAIL — `createChat is not a function`.

- [ ] **Step 3: Implement** (above `module.exports`; add `const fs = require('node:fs'); const cp = require('node:child_process'); const { parseEvents } = require('./stream-parse');` to the requires at the top; export `EVENT, resolveClaudeBin, killTree, createChat`)

```js
// --- Task 4: the runner. One process per turn; exactly one end event per turn.
const EVENT = 'hq:claude-chat:event';
const NOT_FOUND = 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)';
const UNSAFE = /["%!^&|<>]/;
function resolveClaudeBin(env = process.env, { exists = fs.existsSync } = {}) {
  const pick = (p) => (UNSAFE.test(p) ? { error: 'unsafe Claude Code path' } : { cmd: p, viaCmd: /\.(cmd|bat)$/i.test(p) });
  const forced = env.HQ_CLAUDE_BIN;
  if (forced) return path.isAbsolute(forced) && exists(forced) ? pick(forced) : { error: NOT_FOUND };
  for (const dir of String(env.PATH || env.Path || '').split(';')) {
    if (!dir.trim()) continue;
    for (const name of ['claude.exe', 'claude.cmd']) {
      const p = path.join(dir.trim(), name);
      if (exists(p)) return pick(p);
    }
  }
  return { error: NOT_FOUND };
}

// Launcher-safe tree stop (main.js stopGitTree's rule): children of the launcher first, then the root's tree.
function killTree(pid, { spawnSync = cp.spawnSync, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } return; }
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }`],
    { windowsHide: true, timeout: 15000 });
  } catch { /* best effort */ }
  try { spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, timeout: 15000 }); } catch { /* best effort */ }
}

function createChat({ resolve, bin, spawnFn = cp.spawn, kill = killTree, send = () => {}, log = null, env = process.env,
  turnMs = TURN_MS, maxTurns = MAX_TURNS, graceMs = 5000 } = {}) {
  const turns = new Map();   // turnId -> turn
  let seq = 0;
  const FULL = `${maxTurns} Claude turns are already running — wait for one or press Stop`;
  const BUSY = 'this chat already has a turn running — wait for it or press Stop';
  const push = (d) => { try { send(EVENT, d); } catch { /* window gone */ } };
  const keyBusy = (key) => key != null && [...turns.values()].some((t) => t.key === key);

  function end(t, payload) {
    if (t.ended) return;
    t.ended = true;
    clearTimeout(t.timer); clearTimeout(t.grace);
    turns.delete(t.id);
    if (payload.kind === 'error' && log) try { log.error('claude-chat', payload.error); } catch { /* logging never breaks a turn */ }
    push({ turnId: t.id, ...payload });
  }
  function stop(t) {
    if (t.killed) return;
    t.killed = true;
    kill(t.proc.pid);
    t.grace = setTimeout(() => finish(t, null), graceMs);
    if (t.grace.unref) t.grace.unref();
  }
  function finish(t, code) {
    if (t.ended) return;
    if (t.timedOut) return end(t, { kind: 'error', error: `stopped after ${Math.max(1, Math.round(turnMs / 60000))} min` });
    if (t.spawnError) return end(t, { kind: 'error', error: 'could not start Claude Code: ' + t.spawnError });
    const r = t.result;
    if (r || t.stopped) {
      if (r && !r.isError && !t.sawDelta && r.result) push({ turnId: t.id, kind: 'delta', text: r.result });
      return end(t, { kind: 'done', sessionId: (r && r.sessionId) || t.sessionId || null, mode: t.mode, usage: r ? r.usage : null,
        isError: !!(r && r.isError), subtype: r ? r.subtype : '', result: r && r.isError ? r.result : '', stopped: !!t.stopped });
    }
    const last = t.err.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
    end(t, { kind: 'error', error: `Claude Code exited with code ${code}` + (last ? ': ' + last.slice(0, 300) : '') });
  }
  function onEvents(t, events) {
    for (const e of events) {
      if (t.ended) return;
      if (e.kind === 'session') { t.sessionId = e.sessionId; push({ turnId: t.id, kind: 'session', sessionId: e.sessionId, mode: t.mode }); }
      else if (e.kind === 'delta') { t.sawDelta = true; push({ turnId: t.id, kind: 'delta', text: e.text }); }
      else if (e.kind === 'raw') push({ turnId: t.id, kind: 'delta', text: e.text + '\n' });
      else if (e.kind === 'tool') push({ turnId: t.id, kind: 'tool', name: e.name, hint: e.hint });
      else if (e.kind === 'result') t.result = e;
    }
  }

  async function sendTurn(req) {
    if (turns.size >= maxTurns) return { error: FULL };
    const target = await resolve(req);
    if (!target || target.error) return { error: (target && target.error) || 'no target' };
    const b = bin();
    if (!b || b.error) return { error: (b && b.error) || NOT_FOUND };
    if (keyBusy(target.key)) return { error: BUSY };
    if (turns.size >= maxTurns) return { error: FULL };
    const args = buildArgs({ mode: req.mode, sessionId: target.sessionId });
    const opts = { cwd: target.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    const id = 'ct-' + Date.now().toString(36) + '-' + (++seq);
    const t = { id, key: target.key, mode: req.mode, sessionId: target.sessionId || null, proc: null, buf: '', err: '',
      sawDelta: false, result: null, stopped: false, killed: false, timedOut: false, spawnError: null, ended: false, timer: null, grace: null };
    try {
      t.proc = b.viaCmd
        ? spawnFn(env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `""${b.cmd}" ${args.join(' ')}"`], { ...opts, windowsVerbatimArguments: true })
        : spawnFn(b.cmd, args, opts);
    } catch (e) { return { error: 'could not start Claude Code: ' + String((e && e.message) || e) }; }
    turns.set(id, t);
    t.proc.stdout.on('data', (chunk) => { const r = parseEvents(t.buf, chunk); t.buf = r.rest; onEvents(t, r.events); });
    t.proc.stderr.on('data', (chunk) => { t.err = (t.err + String(chunk)).slice(-2000); });
    t.proc.on('error', (e) => { t.spawnError = String((e && e.message) || e); finish(t, -1); });
    t.proc.on('close', (code) => {
      if (t.buf.trim()) { const r = parseEvents(t.buf, '\n'); t.buf = ''; onEvents(t, r.events); }
      finish(t, code);
    });
    t.proc.stdin.on('error', () => { /* the process died first; close reports it */ });
    try { t.proc.stdin.write(target.prompt); t.proc.stdin.end(); } catch { /* close reports it */ }
    t.timer = setTimeout(() => { t.timedOut = true; stop(t); }, turnMs);
    if (t.timer.unref) t.timer.unref();
    const out = { turnId: id };
    if (target.sessionId) out.sessionId = target.sessionId;
    if (target.seeded) out.seeded = target.seeded;
    return out;
  }

  return {
    send: sendTurn,
    cancel(turnId) {
      const t = turns.get(turnId);
      if (!t || t.ended) return false;
      t.stopped = true;
      stop(t);
      return true;
    },
    stopAll() { for (const t of [...turns.values()]) { t.stopped = true; stop(t); } },
    running: () => turns.size,
  };
}
```

Note: in the spawn-error test the fake emits `error` then `close`; `finish` runs on `error` and the `close` is ignored by `t.ended`. In the stop test `cancel` marks `stopped` and `stop` kills once (`t.killed`).

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard/claude-chat.test.mjs`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/claude-chat.js dashboard/claude-chat.test.mjs
git commit -m "fe: Claude Hub H3 turn runner — stream events, launcher-safe Stop, one end per turn, limits 1/chat + 3 total + 10 min" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Fake `claude` shim + real-process end to end (cmd.exe, stdin, cwd, tree stop)

Closes Review Focus 3 (process half). Spec §11 "Chat engine … with a fake `claude` shim on PATH as in `claude-launch.test.mjs`". The same shim serves the Task 10 gate, so no test or gate ever spends real quota.

**Files:**
- Create: `dashboard/__fixtures__/fake-claude.js` (the fake CLI, CommonJS, placeholder text only), `dashboard/__fixtures__/make-fake-claude.mjs` (builder), `dashboard/claude-chat.e2e.test.mjs`

**Interfaces:**
- Consumes: Task 4 `createChat`, `resolveClaudeBin`, `killTree`, `EVENT`; Task 1 `buildArgs`.
- Produces (NEW, test/gate tooling only):
  - `fake-claude.js` — reads stdin to the end, appends one JSON line `{ argv, cwd, stdin, pid }` to `env.FAKE_CLAUDE_LOG` (when set), then behaves by the mode — the trimmed content of the file `env.FAKE_CLAUDE_MODE_FILE` when set and present (read on every run, so the Task 11 gate can switch modes in a running instance), else `env.FAKE_CLAUDE_MODE`, else `ok`:
    - `ok` (default): `system/init` (session id = the `--resume` value, else `00000000-0000-4000-8000-000000000001`), three `text_delta`s of `Placeholder answer from the fake claude.` 80 ms apart, the complete `assistant` line repeating the text, a `result` success with usage `{input_tokens: 6, output_tokens: 40}`; exit 0.
    - `tool`: init, one delta `Reading`, an `assistant` `tool_use` `Read` `{file_path: 'README.md'}`, then 400 ms later a delta + result; exit 0.
    - `hang`: init, one delta `Working`, writes its own pid to `env.FAKE_CLAUDE_PIDFILE`, then never exits (`setInterval`).
    - `fail`: `Placeholder failure` on stderr, exit 1.
  - `makeFakeClaude(dir) -> { bin, binDir, log, env(extra = {}) }` — writes `<dir>/fakebin/claude.cmd` (npm-shim shape: `SETLOCAL` + `"<node>" "<repo>\dashboard\__fixtures__\fake-claude.js" %*`, CRLF); `env(extra)` = a minimal env whose PATH is ONLY `<binDir>;<SystemRoot>\System32` (the real `claude` can never be found), plus `SystemRoot, ComSpec, PATHEXT, TEMP, TMP, OS, NoDefaultCurrentDirectoryInExePath: '1', FAKE_CLAUDE_LOG: log`, then `extra`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard/claude-chat.e2e.test.mjs — real cmd.exe + the npm-shaped fake claude.cmd (never the real CLI)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeFakeClaude } from './__fixtures__/make-fake-claude.mjs';
const require = createRequire(import.meta.url);
const { createChat, resolveClaudeBin, buildArgs, EVENT } = require('./claude-chat.js');

const WIN = { skip: process.platform !== 'win32' && 'cmd.exe only', timeout: 60000 };
const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function setup(mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-chat-e2e-'));
  const fake = makeFakeClaude(base);
  const proj = path.join(base, 'project a & b');   // a folder name cmd would choke on if it ever reached a command line
  fs.mkdirSync(proj);
  const pidFile = path.join(base, 'fake.pid');
  const env = fake.env({ FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_PIDFILE: pidFile });
  const pushed = [];
  const chat = createChat({
    resolve: async (req) => ({ cwd: proj, sessionId: req.sessionId || null, key: null, prompt: req.text, seeded: null }),
    bin: () => resolveClaudeBin(env), env, send: (ch, d) => pushed.push([ch, d]), turnMs: 30000,
  });
  const ev = (id) => pushed.filter(([ch, d]) => ch === EVENT && d.turnId === id).map(([, d]) => d);
  const records = () => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { base, fake, proj, pidFile, env, chat, ev, records, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('e2e: the fake resolves (never the real claude), gets the exact argv, the prompt on stdin, the project folder', WIN, async () => {
  const s = setup('ok');
  try {
    assert.equal(resolveClaudeBin(s.env).cmd, s.fake.bin);
    const prompt = 'a & calc | "x" %OS% !OS! ^ <y> café 🚀\nsecond line';
    const { turnId } = await s.chat.send({ projectId: 'p', text: prompt, mode: 'read-only' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done' || e.kind === 'error')), 'the turn ended');
    const rec = s.records();
    assert.equal(rec.length, 1);
    assert.deepEqual(rec[0].argv, buildArgs({ mode: 'read-only' }));
    assert.equal(rec[0].stdin, prompt);
    assert.equal(path.resolve(rec[0].cwd).toLowerCase(), path.resolve(s.proj).toLowerCase());
    const kinds = s.ev(turnId).map((e) => e.kind);
    assert.equal(kinds[0], 'session'); assert.equal(kinds[kinds.length - 1], 'done');
    assert.equal(s.ev(turnId).filter((e) => e.kind === 'delta').map((e) => e.text).join(''), 'Placeholder answer from the fake claude.');
    assert.deepEqual(s.ev(turnId).pop().usage, { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 });
  } finally { s.done(); }
});

test('e2e: Allow edits passes acceptEdits, a resume id passes --resume, nothing ever bypasses', WIN, async () => {
  const s = setup('ok');
  try {
    const SID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const { turnId } = await s.chat.send({ projectId: 'p', sessionId: SID, text: 'x', mode: 'edits' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done')));
    const argv = s.records()[0].argv;
    assert.deepEqual(argv, buildArgs({ mode: 'edits', sessionId: SID }));
    assert.ok(!argv.join(' ').includes('bypass') && !argv.join(' ').includes('dangerously'));
    assert.equal(s.ev(turnId).find((e) => e.kind === 'session').sessionId, SID);
  } finally { s.done(); }
});

test('e2e: Stop on a hanging turn ends the whole tree — the fake node process is gone, one done{stopped}', WIN, async () => {
  const s = setup('hang');
  try {
    const { turnId } = await s.chat.send({ projectId: 'p', text: 'hang', mode: 'read-only' });
    assert.ok(await until(() => fs.existsSync(s.pidFile) && fs.readFileSync(s.pidFile, 'utf8').trim()), 'the fake started');
    const pid = Number(fs.readFileSync(s.pidFile, 'utf8').trim());
    assert.ok(alive(pid));
    assert.equal(s.chat.cancel(turnId), true);
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done')), 'the turn ended');
    assert.ok(await until(() => !alive(pid), 10000), 'no orphan: the fake claude process was stopped');
    const ends = s.ev(turnId).filter((e) => e.kind === 'done' || e.kind === 'error');
    assert.equal(ends.length, 1); assert.equal(ends[0].stopped, true);
    assert.ok(s.ev(turnId).some((e) => e.kind === 'delta' && e.text === 'Working'), 'the partial text had streamed');
  } finally { s.done(); }
});

test('e2e: a failing CLI says why', WIN, async () => {
  const s = setup('fail');
  try {
    const { turnId } = await s.chat.send({ projectId: 'p', text: 'x', mode: 'read-only' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'error')));
    assert.equal(s.ev(turnId).pop().error, 'Claude Code exited with code 1: Placeholder failure');
  } finally { s.done(); }
});
```

(The tests pass `sessionId` inside `req` only because their `resolve` stub echoes it; production `send` never takes a session id from the renderer — Task 3 reads it from the Hub row.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard/claude-chat.e2e.test.mjs`
Expected: FAIL — `Cannot find module '…/dashboard/__fixtures__/make-fake-claude.mjs'`.

- [ ] **Step 3: Implement**

```js
// dashboard/__fixtures__/fake-claude.js — a stand-in for the Claude Code CLI in tests and gates.
// Placeholder text only. Never contacts anything; records what it was given.
'use strict';
const fs = require('node:fs');
const argv = process.argv.slice(2);
// FAKE_CLAUDE_MODE_FILE (read per run) lets a long-lived gate instance switch modes without a restart
const modeFile = process.env.FAKE_CLAUDE_MODE_FILE;
const mode = (modeFile && fs.existsSync(modeFile) ? fs.readFileSync(modeFile, 'utf8').trim() : '') || process.env.FAKE_CLAUDE_MODE || 'ok';
const ri = argv.indexOf('--resume');
const sid = ri >= 0 ? argv[ri + 1] : '00000000-0000-4000-8000-000000000001';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', async () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(), stdin, pid: process.pid }) + '\n');
  if (mode === 'fail') { process.stderr.write('Placeholder failure\n'); process.exit(1); }
  out({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), permissionMode: argv[argv.indexOf('--permission-mode') + 1] });
  if (mode === 'hang') {
    delta('Working');
    if (process.env.FAKE_CLAUDE_PIDFILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(process.pid));
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'tool') {
    delta('Reading');
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
    await sleep(400);
    delta(' done.');
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'Reading done.', usage: { input_tokens: 6, output_tokens: 40 } });
    process.exit(0);
  }
  const parts = ['Placeholder answer', ' from the fake', ' claude.'];
  for (const p of parts) { delta(p); await sleep(80); }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: parts.join('') }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: parts.join(''), usage: { input_tokens: 6, output_tokens: 40 } });
  process.exit(0);
});
```

```js
// dashboard/__fixtures__/make-fake-claude.mjs — builds an npm-shaped claude.cmd that runs fake-claude.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
export function makeFakeClaude(dir) {
  const binDir = path.join(dir, 'fakebin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'claude.cmd');
  fs.writeFileSync(bin, ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
    `"${process.execPath}" "${FAKE}"   %*`, ''].join('\r\n'));
  const log = path.join(dir, 'claude-argv.jsonl');
  const root = process.env.SystemRoot || 'C:\\Windows';
  const env = (extra = {}) => ({
    SystemRoot: root, ComSpec: path.join(root, 'System32', 'cmd.exe'), PATH: `${binDir};${path.join(root, 'System32')}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD', NoDefaultCurrentDirectoryInExePath: '1', TEMP: os.tmpdir(), TMP: os.tmpdir(), OS: 'Windows_NT',
    FAKE_CLAUDE_LOG: log, ...extra,
  });
  return { bin, binDir, log, env };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard/claude-chat.e2e.test.mjs`
Expected: PASS (4 tests on Windows; skipped elsewhere). If the `hang` test leaves a `node.exe` behind, Task 4's `killTree` is wrong — fix it there, never by widening the test.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard/__fixtures__/fake-claude.js dashboard/__fixtures__/make-fake-claude.mjs dashboard/claude-chat.e2e.test.mjs
git commit -m "fe: Claude Hub H3 fake claude shim + end-to-end (exact argv, stdin prompt, hostile folder, tree stop leaves no orphan)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: IPC — contract rows first, then `init()`, the main.js hook, preload, fake preload

Spec §7 `claudeChat.send/cancel/on`. Rule: the IPC-CONTRACT rows are committed BEFORE any handler.

**Files:**
- Modify: `docs/sync/IPC-CONTRACT.md` (append a section after the H2 Claude Hub section), `dashboard/claude-chat.js` (`init`), `dashboard/main.js` (ONE line), `dashboard/preload.js` (`claudeChat` block right after the `claudeHub` block), `dashboard-v5/tools/fake-preload.js` (stateful fake + 3 `SPEC` rows right after the `claudeHub.*` rows + one line in `control.reset`)
- Test: `dashboard/claude-chat.test.mjs` (append), `dashboard-v5/tools/fake-preload.test.mjs` (append)

**Interfaces:**
- Consumes: Tasks 3–4 (`resolveTarget`, `createChat`, `resolveClaudeBin`); the Hub host object from `claude-hub-host.js` (`request(op, args, {timeout})`, resolves, never rejects); main.js `castSend`, `app`, `studioProjects`, `appLog` (all in scope at the `claudeHub = require('./claude-hub-host').init(…)` line inside `app.whenReady()`).
- Produces:
  - `init({ ipcMain, send, app = null, hub = null, getProjects = () => [], appLog = null, env = process.env, spawnFn, kill }) -> chat` (NEW export; `spawnFn`/`kill` are test seams forwarded to `createChat`) — registers exactly `hq:claude-chat:send` and `hq:claude-chat:cancel`; the send handler copies ONLY `{conversationId, projectId, text, mode}` from the renderer's object (a renderer-supplied `sessionId`, `cwd` or `args` is dropped) and never rejects (a throw becomes `{error}`); `app.on('before-quit', () => chat.stopAll())` when `app` is given; `isDir` = `fs.statSync(p).isDirectory()` in a try.
  - main.js, the line right after `claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog });`:
    `require('./claude-chat').init({ ipcMain, send: castSend, app, hub: claudeHub, getProjects: studioProjects, appLog });   // Claude Hub H3 in-app chat (spec 2026-10-13 §8)`
  - preload `hq.claudeChat = { send(req), cancel(turnId), on(cb) -> dispose }` (channels above; `on` uses the standard subscription idiom).
  - fake preload: `['claudeChat.send', chatTurn]`, `['claudeChat.cancel', cancelTurn]`, `['claudeChat.on', 'on:hq:claude-chat:event']` — `chatTurn(req)`: `{error:'empty message'}` for blank text; else `{turnId:'ct-fake-<n>', sessionId?}` (for `conversationId` `code:<id>` the id after `code:`) and, 150 ms apart, `session` (new chats: `00000000-0000-4000-8000-000000000001`), `delta 'Placeholder'`, `tool {name:'Read', hint:'README.md'}`, `delta ' answer from the fake claude.'`, `done {sessionId, mode, usage:{in:6,out:40,cacheRead:0,cacheWrite:0}, isError:false, subtype:'success', result:'', stopped:false}`; `cancelTurn(id)`: clears that turn's timers, pushes `done` with `stopped:true`, `usage:null`, returns `true`; `false` for an unknown/ended turn.

- [ ] **Step 1: Write the contract rows and commit them before any handler**

Append to `docs/sync/IPC-CONTRACT.md`:

```markdown
## 2026-10-16 — Claude Hub, phase H3 (rows written before the handler lands)

Additive only. Main side: `dashboard/claude-chat.js` (new) with one hook line in `main.js` (rule 2).

### Claude Hub in-app chat (spec 2026-10-13-claude-hub-design.md §7–§8, phase H3)

| Preload | Channel | Shape |
|---|---|---|
| `claudeChat.send(req)` | `hq:claude-chat:send` (invoke) | `req = {conversationId?, projectId?, text, mode: 'read-only'\|'edits'}`; any other field is ignored (no session id, cwd or argument ever comes from the renderer). `projectId` = a Hub project id (`code:<folder>`) or a WorkspaceHQ project id (resolved main-side; paths never cross IPC). → `{turnId, sessionId?, seeded?: {chars, trimmed}}` (`sessionId` when continuing a Claude Code session; `seeded` when a claude.ai chat was copied into a new Code chat) \| `{error}` with the reason (empty message, over 100 000 chars, unknown mode, no target, Hub error, unknown project, refused folder, folder gone, CLI not found, 1 turn per chat, 3 turns in total). Never throws |
| `claudeChat.cancel(turnId)` | `hq:claude-chat:cancel` (invoke) | `true` when that turn was running (its process tree is stopped; the turn then ends with `done` + `stopped: true`) \| `false` |
| `claudeChat.on(cb)` | push `hq:claude-chat:event` | `{turnId, kind, …}`: `session {sessionId, mode}` (new chats: from the CLI's init line) · `delta {text}` (increment, not accumulated) · `tool {name, hint}` · exactly one end per turn: `done {sessionId, mode, usage: {in, out, cacheRead, cacheWrite}\|null, isError, subtype, result, stopped}` (`result` = the failure text when `isError`, else `''`) or `error {error}` (cap reached "stopped after 10 min", spawn failure, exit without a result) |

Engine rules (`dashboard/claude-chat.js`): one `claude -p --output-format stream-json --verbose --include-partial-messages --permission-prompts none --permission-mode plan|acceptEdits [--resume <uuid>]` process per turn, prompt on stdin; `read-only` → `plan`, `edits` → `acceptEdits`; `bypassPermissions` / `--dangerously-skip-permissions` are never passed (unit test). cwd = a WorkspaceHQ project path or a cwd the Hub recorded; drive roots, the Windows folder, Program Files and the profile root itself are always refused. One running turn per conversation, 3 in total, 10 min each. Stop = launcher-safe tree stop (children of the `cmd.exe` launcher, then the root tree). The CLI is `HQ_CLAUDE_BIN` (test override) or the first `claude.exe`/`claude.cmd` on PATH. Errors reach `logs/app-*.log` as reasons only, never prompt or answer text. A finished chat reaches the library through the Hub's ordinary `changed` event (it is a normal Claude Code session).
```

```bash
git add -- docs/sync/IPC-CONTRACT.md
git commit -m "meta: IPC-CONTRACT rows for Claude Hub H3 in-app chat (claudeChat.send/cancel/on) before the handlers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing tests**

```js
// append to dashboard/claude-chat.test.mjs
const { init } = require('./claude-chat.js');
import fsm from 'node:fs';
import osm from 'node:os';
import pathm from 'node:path';
test('init: two handlers, renderer cannot inject a session id, before-quit stops running turns', async () => {
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'hq-chat-init-'));
  try {
    const bin = pathm.join(dir, 'claude.exe'); fsm.writeFileSync(bin, '');
    const proj = pathm.join(dir, 'project-a'); fsm.mkdirSync(proj);
    const handlers = {}, quit = [], sp = fakeSpawn(), killed = [];
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const hub = { request: async (op, args) => (op === 'getConversation' && args.id === 'code:' + SID2
      ? { conversation: { id: 'code:' + SID2, source: 'code', native_id: SID2, cwd: proj }, messages: [], hasMore: false } : null) };
    init({ ipcMain, send: () => {}, app: { on: (ev, fn) => { if (ev === 'before-quit') quit.push(fn); } }, hub,
      env: { HQ_CLAUDE_BIN: bin, USERPROFILE: 'C:\\Users\\placeholder', SystemRoot: 'C:\\Windows' }, spawnFn: sp.spawnFn, kill: (pid) => killed.push(pid) });
    assert.deepEqual(Object.keys(handlers).sort(), ['hq:claude-chat:cancel', 'hq:claude-chat:send']);
    const r = await handlers['hq:claude-chat:send']({}, { conversationId: 'code:' + SID2, text: 'hi', mode: 'read-only', sessionId: 'evil', cwd: 'C:\\', args: ['--dangerously-skip-permissions'] });
    assert.equal(r.sessionId, SID2);
    assert.deepEqual(sp.kids[0].args, buildArgs({ mode: 'read-only', sessionId: SID2 }));
    assert.equal(sp.kids[0].opts.cwd, proj);
    assert.deepEqual(await handlers['hq:claude-chat:send']({}, null), { error: 'empty message' });
    assert.equal(await handlers['hq:claude-chat:cancel']({}, 'nope'), false);
    assert.equal(quit.length, 1); quit[0]();
    assert.deepEqual(killed, [sp.kids[0].pid]);
  } finally { fsm.rmSync(dir, { recursive: true, force: true }); }
});
```

```js
// append to dashboard-v5/tools/fake-preload.test.mjs
test('claudeChat fake: streams session → delta → tool → delta → done; cancel ends with stopped', async () => {
  const { hq, control } = createFake();
  const got = [];
  const off = hq.claudeChat.on((e) => got.push(e));
  assert.deepEqual(await hq.claudeChat.send({ projectId: 'project-a', text: '  ', mode: 'read-only' }), { error: 'empty message' });
  const { turnId } = await hq.claudeChat.send({ projectId: 'project-a', text: 'hi', mode: 'read-only' });
  await new Promise((r) => setTimeout(r, 900));
  assert.deepEqual(got.filter((e) => e.turnId === turnId).map((e) => e.kind), ['session', 'delta', 'tool', 'delta', 'done']);
  const b = await hq.claudeChat.send({ conversationId: 'code:1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', text: 'more', mode: 'edits' });
  assert.equal(b.sessionId, '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed');
  assert.equal(await hq.claudeChat.cancel(b.turnId), true);
  assert.equal(await hq.claudeChat.cancel(b.turnId), false);
  await new Promise((r) => setTimeout(r, 10));   // the fake pushes the end on a 0 ms timer, like main after answering
  const end = got.filter((e) => e.turnId === b.turnId).pop();
  assert.equal(end.kind, 'done'); assert.equal(end.stopped, true); assert.equal(end.mode, 'edits');
  await hq.claudeChat.send({ projectId: 'project-a', text: 'x', mode: 'read-only' });
  control.reset();
  const n = got.length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(got.length, n, 'reset drops pending fake turns (a CDP scenario that ended mid-turn cannot stream into the next)');
  off();
});
```

(`fake-preload.test.mjs` already imports `createFake` and runs the parity tests; those fail too until the preload and the fake both carry `claudeChat.*`.)

- [ ] **Step 3: Run them to see them fail**

Run: `node --test dashboard/claude-chat.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: FAIL — `init is not a function`; `hq.claudeChat` is undefined.

- [ ] **Step 4: Implement**

`dashboard/claude-chat.js` (above `module.exports`; export `init`):

```js
// --- Task 6: main-process wiring. One hook line in main.js calls this inside app.whenReady().
function init({ ipcMain, send, app = null, hub = null, getProjects = () => [], appLog = null, env = process.env, spawnFn, kill } = {}) {
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const hubReq = (op, args) => (hub && typeof hub.request === 'function' ? hub.request(op, args) : Promise.resolve({ error: 'hub not running' }));
  const chat = createChat({
    resolve: (req) => resolveTarget(req, { hub: hubReq, getProjects, isDir, env }),
    bin: () => resolveClaudeBin(env), send, log: appLog, env,
    ...(spawnFn ? { spawnFn } : {}), ...(kill ? { kill } : {}),
  });
  ipcMain.handle('hq:claude-chat:send', async (_e, req) => {
    const r = req && typeof req === 'object' ? req : {};
    try { return await chat.send({ conversationId: r.conversationId, projectId: r.projectId, text: r.text, mode: r.mode }); }
    catch (e) { return { error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('hq:claude-chat:cancel', (_e, turnId) => chat.cancel(turnId));
  if (app && typeof app.on === 'function') app.on('before-quit', () => { try { chat.stopAll(); } catch { /* quitting */ } });
  return chat;
}
```

`dashboard/main.js` — add exactly one line directly after the `claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog });` line (H1 put it at main.js:1594; find it by text, the number may have moved):

```js
  require('./claude-chat').init({ ipcMain, send: castSend, app, hub: claudeHub, getProjects: studioProjects, appLog });   // Claude Hub H3 in-app chat (spec 2026-10-13 §8)
```

`dashboard/preload.js` — directly after the closing `},` of the `claudeHub: { … }` block:

```js
  claudeChat: {
    send: (req) => ipcRenderer.invoke('hq:claude-chat:send', req),
    cancel: (turnId) => ipcRenderer.invoke('hq:claude-chat:cancel', turnId),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:claude-chat:event', handler);
      return () => ipcRenderer.removeListener('hq:claude-chat:event', handler);
    },
  },
```

`dashboard-v5/tools/fake-preload.js` — beside the `chat`/`cancelChat` canned answers (inside `createFake`, where `push` is in scope):

```js
  // Claude Hub H3 — like main (hq:claude-chat:send/cancel): increments, one end per turn.
  const turns = new Map();
  let turnSeq = 0;
  const chatTurn = (req) => {
    const r = req && typeof req === 'object' ? req : {};
    if (typeof r.text !== 'string' || !r.text.trim()) return { error: 'empty message' };
    const turnId = 'ct-fake-' + (++turnSeq), mode = r.mode === 'edits' ? 'edits' : 'read-only';
    const resumed = typeof r.conversationId === 'string' && r.conversationId.startsWith('code:') ? r.conversationId.slice(5) : null;
    const sessionId = resumed || '00000000-0000-4000-8000-000000000001';
    const steps = [
      { kind: 'session', sessionId, mode }, { kind: 'delta', text: 'Placeholder' }, { kind: 'tool', name: 'Read', hint: 'README.md' },
      { kind: 'delta', text: ' answer from the fake claude.' },
      { kind: 'done', sessionId, mode, usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, isError: false, subtype: 'success', result: '', stopped: false },
    ];
    const t = { timers: [], sessionId, mode };
    turns.set(turnId, t);
    steps.forEach((s, i) => t.timers.push(setTimeout(() => {
      if (s.kind === 'done') turns.delete(turnId);
      push('hq:claude-chat:event', { turnId, ...s });
    }, 150 * (i + 1))));
    return resumed ? { turnId, sessionId } : { turnId };
  };
  const cancelTurn = (turnId) => {
    const t = turns.get(turnId);
    if (!t) return false;
    t.timers.forEach(clearTimeout); turns.delete(turnId);
    setTimeout(() => push('hq:claude-chat:event', { turnId, kind: 'done', sessionId: t.sessionId, mode: t.mode, usage: null, isError: false, subtype: '', result: '', stopped: true }), 0);
    return true;
  };
```

and in `control.reset` (the CDP scenarios' `fresh()` calls `hqFake.reset(true)`), right after the existing `for (const id of [...chats.keys()]) cancelChat(id);` line, drop every pending fake turn silently so a scenario that ended mid-turn cannot stream into the next one:

```js
      for (const t of turns.values()) t.timers.forEach(clearTimeout); turns.clear();   // Claude Hub H3 fake chat turns
```

In `SPEC`, right after `['claudeHub.on', 'on:hq:claude-hub:event']` (H2 inserted its `claudeHub.*` rows around it — keep preload order: the `claudeChat` rows follow the LAST `claudeHub.*` row):

```js
    ['claudeChat.send', chatTurn], ['claudeChat.cancel', cancelTurn], ['claudeChat.on', 'on:hq:claude-chat:event'],
```


- [ ] **Step 5: Run them to see them pass**

Run: `node --test dashboard/claude-chat.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: PASS (20 engine tests; every fake-preload test incl. both parity tests and the new one).
Run: `node --test dashboard/*.test.mjs`
Expected: PASS (nothing else in `dashboard/` changed behaviour).

- [ ] **Step 6: Commit**

```bash
git add -- dashboard/claude-chat.js dashboard/claude-chat.test.mjs dashboard/main.js dashboard/preload.js dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs
git commit -m "fe: Claude Hub H3 IPC — hq:claude-chat:send/cancel + event push, one main.js hook, preload + fake preload" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report the touched main.js line (the single new line after the `claudeHub = require('./claude-hub-host').init(…)` line).

### Task 7: v5 live data — chat turns (`adapter.mjs` reducer + view, `store.js` `live.claudeChat`)

Spec §8 "The renderer shows text growing live and tool calls as collapsed rows"; §8 "The chat appears in the library automatically" (no extra plumbing: H2's `changed` refresh does it).

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (new exports at the end), `dashboard-v5/src/live/store.js` (`live` object, `start()` subscriptions, the returned object)
- Test: `dashboard-v5/src/live/adapter.test.mjs`, `dashboard-v5/src/live/store.test.mjs` (append)

**Interfaces:**
- Consumes: Task 6 `hq.claudeChat.send/cancel/on` and its event shapes; H2 adapter `fmtTokens(n)`; H2 raw thread `live.claudeLib.thread = { conversation, messages: [{ role, at, text, … }] }`.
- Produces (adapter, pure, NEW):
  - `CHAT_TEXT_MAX = 200000`; `chatTurnNew({ turnId, convId, projectId, prompt, mode, sessionId, seeded, now }) -> turn` with `turn = { turnId, convId, projectId, prompt, mode, status: 'starting', items: [], sessionId, usage: null, error: null, seeded, startedAt: now, endedAt: null }`. `convId` = the conversation sent to, or `null` for a new chat.
  - `chatReduce(turn, ev, now) -> turn` (new object, never mutates): `session` → `sessionId`, `convId = turn.convId || 'code:' + sessionId`, `status: 'running'`; `delta` → appends to the last `{ type: 'text' }` item (or a new one), keeping at most the LAST `CHAT_TEXT_MAX` chars of that item, `status: 'running'`; `tool` → `{ type: 'tool', name, hint }` item (≤ 200 items, oldest dropped); `done` → `status` `'stopped'` (stopped) | `'error'` (isError; `error` = `result || subtype || 'Claude Code reported an error'`) | `'done'`, `usage`, `sessionId` (if given), `endedAt: now`; `error` → `status: 'error'`, `error`, `endedAt`. Any event after the end is ignored.
  - `chatTurnView(turn) -> { id, status, running, statusText, modeText, prompt, items: [{ key, text, tool, name, hint }], tokens, hasTokens, error, seededNote }` — `statusText`: `starting` 'Starting Claude Code…', `running` 'Claude is replying…', `done` 'Done', `stopped` 'Stopped — the partial answer is kept', `error` 'Failed'; `modeText`: 'Read-only' | 'Allow edits' (spec: "The UI shows the mode on every turn"); `tokens` = `fmtTokens(usage.in + usage.out)` or `null` (unknown is not zero); `seededNote`: `''`, `'Copied the claude.ai chat (N characters)'`, or `'Copied the last N characters of the claude.ai chat (trimmed)'`.
  - `liveTurns(turns, convId, thread) -> turn[]` — the turns sent to `convId` (or that became `convId` via `session`), oldest first, minus FINISHED turns whose prompt the reloaded thread already shows (a `user` message whose whitespace-collapsed text starts with the first 40 chars of the prompt, `at` ≥ `startedAt − 60 s`) — so a turn never shows twice once the Hub has indexed it; running turns always show.
- Produces (store, NEW): `live.claudeChat = { turns: [] }` (newest last, ≤ 20 kept) and on the store object:
  - `sendClaudeChat({ conversationId, projectId, text, mode }) -> Promise<{ turnId } | { error }>` — `{ error: 'This window has no app bridge' }` without `hq.claudeChat`; on success appends `chatTurnNew(...)` and replays any events that arrived for that `turnId` before the answer (kept in a 200-event pending buffer); `{error}` answers and throws are RETURNED (the caller toasts), never swallowed, and add no turn.
  - `cancelClaudeChat(turnId) -> Promise<boolean>` (`false` without a bridge or on a throw).
  - subscription in `start()`: `hq.claudeChat.on(e)` → `chatReduce` into the matching turn (or the pending buffer); `delta`/`tool` emit through a 50 ms coalescing timer, every other kind emits at once.

- [ ] **Step 1: Write the failing tests**

```js
// append to dashboard-v5/src/live/adapter.test.mjs
import { chatTurnNew, chatReduce, chatTurnView, liveTurns, CHAT_TEXT_MAX } from './adapter.mjs';
const SIDX = '00000000-0000-4000-8000-000000000001';
test('chatReduce: text grows, tools become their own rows, one end, nothing after it', () => {
  let t = chatTurnNew({ turnId: 't1', convId: null, projectId: 'project-a', prompt: 'Say hi', mode: 'read-only', sessionId: null, seeded: null, now: 1000 });
  t = chatReduce(t, { kind: 'session', sessionId: SIDX }, 1001);
  assert.equal(t.convId, 'code:' + SIDX); assert.equal(t.status, 'running');
  for (const ev of [{ kind: 'delta', text: 'Hel' }, { kind: 'delta', text: 'lo' }, { kind: 'tool', name: 'Read', hint: 'README.md' }, { kind: 'delta', text: 'Done.' }]) t = chatReduce(t, ev, 1002);
  assert.deepEqual(t.items, [{ type: 'text', text: 'Hello' }, { type: 'tool', name: 'Read', hint: 'README.md' }, { type: 'text', text: 'Done.' }]);
  const done = chatReduce(t, { kind: 'done', sessionId: SIDX, usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, isError: false, stopped: false }, 2000);
  assert.equal(done.status, 'done'); assert.equal(done.endedAt, 2000);
  assert.deepEqual(chatReduce(done, { kind: 'delta', text: 'late' }, 2001), done);
  assert.equal(t.items.length, 3, 'the input turn was not mutated');
  const stopped = chatReduce(t, { kind: 'done', stopped: true, usage: null }, 3000);
  assert.equal(stopped.status, 'stopped');
  const failed = chatReduce(t, { kind: 'done', isError: true, subtype: 'error_max_turns', result: '' }, 3000);
  assert.equal(failed.status, 'error'); assert.equal(failed.error, 'error_max_turns');
  assert.equal(chatReduce(t, { kind: 'error', error: 'stopped after 10 min' }, 3000).error, 'stopped after 10 min');
  let big = chatTurnNew({ turnId: 't2', prompt: 'x', mode: 'edits', now: 0 });
  big = chatReduce(big, { kind: 'delta', text: 'a'.repeat(CHAT_TEXT_MAX) }, 1); big = chatReduce(big, { kind: 'delta', text: 'END' }, 2);
  assert.equal(big.items[0].text.length, CHAT_TEXT_MAX); assert.ok(big.items[0].text.endsWith('END'));
});
test('chatTurnView: mode on every turn, honest status, unknown tokens are null, trim note', () => {
  const t = chatTurnNew({ turnId: 't1', convId: 'code:' + SIDX, prompt: 'x', mode: 'edits', seeded: { chars: 30000, trimmed: true }, now: 0 });
  const v = chatTurnView(t);
  assert.equal(v.modeText, 'Allow edits'); assert.equal(v.statusText, 'Starting Claude Code…'); assert.equal(v.running, true);
  assert.equal(v.tokens, null); assert.equal(v.hasTokens, false);
  assert.equal(v.seededNote, 'Copied the last 30000 characters of the claude.ai chat (trimmed)');
  const d = chatTurnView(chatReduce(t, { kind: 'done', usage: { in: 600, out: 12000, cacheRead: 5, cacheWrite: 0 } }, 1));
  assert.equal(d.tokens, '12.6k'); assert.equal(d.running, false); assert.equal(d.modeText, 'Allow edits');
  assert.equal(chatTurnView(chatTurnNew({ turnId: 'x', prompt: 'p', mode: 'read-only', now: 0 })).modeText, 'Read-only');
});
test('liveTurns: a finished turn disappears once the thread shows its prompt; running turns stay', () => {
  const base = { convId: 'code:' + SIDX, mode: 'read-only' };
  const a = { ...chatTurnNew({ turnId: 'a', prompt: 'Explain   the release plan please', now: Date.parse('2026-10-05T10:00:00Z'), ...base }), status: 'done' };
  const b = { ...chatTurnNew({ turnId: 'b', prompt: 'And the risks?', now: Date.parse('2026-10-05T10:01:00Z'), ...base }), status: 'running' };
  const other = chatTurnNew({ turnId: 'c', convId: 'code:other', prompt: 'x', mode: 'read-only', now: 0 });
  const thread = { messages: [{ role: 'user', at: '2026-10-05T10:00:01Z', text: 'Explain the release plan please' }, { role: 'user', at: '2026-10-05T10:01:01Z', text: 'And the risks?' }] };
  assert.deepEqual(liveTurns([a, b, other], 'code:' + SIDX, null).map((t) => t.turnId), ['a', 'b']);
  assert.deepEqual(liveTurns([a, b, other], 'code:' + SIDX, thread).map((t) => t.turnId), ['b']);
  const old = { messages: [{ role: 'user', at: '2026-09-01T00:00:00Z', text: 'Explain the release plan please' }] };
  assert.deepEqual(liveTurns([a], 'code:' + SIDX, old).map((t) => t.turnId), ['a'], 'an older identical prompt is not this turn');
});
```

```js
// append to dashboard-v5/src/live/store.test.mjs
function chatHq(answer = { turnId: 't1' }) {
  const f = fakeHq(), cbs = [], calls = [];
  f.hq.claudeChat = {
    send: (req) => { calls.push(['send', req]); return typeof answer === 'function' ? answer(req) : Promise.resolve(answer); },
    cancel: (id) => { calls.push(['cancel', id]); return Promise.resolve(true); },
    on: (cb) => { cbs.push(cb); return () => cbs.splice(cbs.indexOf(cb), 1); },
  };
  return { ...f, calls, fire: (e) => cbs.slice().forEach((cb) => cb(e)) };
}
test('claudeChat: send adds a turn, early events are replayed, deltas stream, cancel goes to main', async () => {
  let fire;
  const h = chatHq((req) => { fire({ turnId: 't1', kind: 'session', sessionId: '00000000-0000-4000-8000-000000000001', mode: req.mode }); return Promise.resolve({ turnId: 't1' }); });
  fire = h.fire;
  const st = createStore(DATA(), h.hq);
  await st.start();
  assert.deepEqual(st.live.claudeChat, { turns: [] });
  assert.deepEqual(await st.sendClaudeChat({ projectId: 'project-a', text: 'hi', mode: 'read-only' }), { turnId: 't1' });
  assert.equal(st.live.claudeChat.turns.length, 1);
  assert.equal(st.live.claudeChat.turns[0].convId, 'code:00000000-0000-4000-8000-000000000001', 'the session event that beat the answer was replayed');
  h.fire({ turnId: 't1', kind: 'delta', text: 'Hel' }); h.fire({ turnId: 't1', kind: 'delta', text: 'lo' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(st.live.claudeChat.turns[0].items[0].text, 'Hello');
  assert.equal(await st.cancelClaudeChat('t1'), true);
  assert.deepEqual(h.calls.map((c) => c[0]), ['send', 'cancel']);
  st.stop();
});
test('claudeChat: an {error} answer is returned, adds no turn; no bridge says so', async () => {
  const h = chatHq({ error: '3 Claude turns are already running — wait for one or press Stop' });
  const st = createStore(DATA(), h.hq);
  await st.start();
  assert.deepEqual(await st.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: '3 Claude turns are already running — wait for one or press Stop' });
  assert.equal(st.live.claudeChat.turns.length, 0);
  const thrower = chatHq(() => Promise.reject(new Error('ipc gone')));
  const s2 = createStore(DATA(), thrower.hq); await s2.start();
  assert.deepEqual(await s2.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: 'ipc gone' });
  const s3 = createStore(DATA(), null);
  assert.deepEqual(await s3.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: 'This window has no app bridge' });
  assert.equal(await s3.cancelClaudeChat('t1'), false);
  st.stop(); s2.stop();
});
```

(`fakeHq` counts subscriptions in `stats.subs`; tests that assert those counts use their own `fakeHq` without `claudeChat`, so their numbers do not move.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: FAIL — `does not provide an export named 'chatTurnNew'`; `st.sendClaudeChat is not a function`.

- [ ] **Step 3: Implement**

`dashboard-v5/src/live/adapter.mjs` (append):

```js
// ---- Claude Hub H3: in-app chat turns (spec §8). Pure; text is bound as text, never HTML.
export const CHAT_TEXT_MAX = 200000;
export function chatTurnNew({ turnId, convId = null, projectId = null, prompt = '', mode = 'read-only', sessionId = null, seeded = null, now = Date.now() } = {}) {
  return { turnId, convId, projectId, prompt: String(prompt), mode, status: 'starting', items: [], sessionId, usage: null, error: null, seeded: seeded || null, startedAt: now, endedAt: null };
}
const ENDED = new Set(['done', 'stopped', 'error']);
export function chatReduce(turn, ev, now = Date.now()) {
  if (!turn || !ev || ENDED.has(turn.status)) return turn;
  const t = { ...turn, items: turn.items.slice() };
  if (ev.kind === 'session' && typeof ev.sessionId === 'string') {
    t.sessionId = ev.sessionId; t.convId = t.convId || 'code:' + ev.sessionId; t.status = 'running';
  } else if (ev.kind === 'delta' && typeof ev.text === 'string') {
    const last = t.items[t.items.length - 1];
    const text = ((last && last.type === 'text' ? last.text : '') + ev.text).slice(-CHAT_TEXT_MAX);
    if (last && last.type === 'text') t.items[t.items.length - 1] = { type: 'text', text }; else t.items.push({ type: 'text', text });
    t.status = 'running';
  } else if (ev.kind === 'tool') {
    t.items.push({ type: 'tool', name: String(ev.name || 'tool'), hint: String(ev.hint || '') });
    if (t.items.length > 200) t.items.splice(0, t.items.length - 200);
    t.status = 'running';
  } else if (ev.kind === 'done') {
    t.status = ev.stopped ? 'stopped' : ev.isError ? 'error' : 'done';
    if (ev.isError && !ev.stopped) t.error = ev.result || ev.subtype || 'Claude Code reported an error';
    t.usage = ev.usage && typeof ev.usage === 'object' ? ev.usage : null;
    if (typeof ev.sessionId === 'string' && ev.sessionId) { t.sessionId = ev.sessionId; t.convId = t.convId || 'code:' + ev.sessionId; }
    t.endedAt = now;
  } else if (ev.kind === 'error') {
    t.status = 'error'; t.error = String(ev.error || 'Claude Code failed'); t.endedAt = now;
  } else return turn;
  return t;
}
const TURN_STATUS = { starting: 'Starting Claude Code…', running: 'Claude is replying…', done: 'Done', stopped: 'Stopped — the partial answer is kept', error: 'Failed' };
export function chatTurnView(turn) {
  const u = turn.usage;
  const tokens = u ? fmtTokens((Number(u.in) || 0) + (Number(u.out) || 0)) : null;
  const s = turn.seeded;
  return {
    id: turn.turnId, status: turn.status, running: !ENDED.has(turn.status), statusText: TURN_STATUS[turn.status] || turn.status,
    modeText: turn.mode === 'edits' ? 'Allow edits' : 'Read-only', prompt: turn.prompt,
    items: turn.items.map((it, i) => ({ key: turn.turnId + ':' + i, text: it.type === 'text' ? it.text : '', tool: it.type === 'tool', name: it.name || '', hint: it.hint || '' })),
    tokens, hasTokens: tokens != null, error: turn.error || '',
    seededNote: !s ? '' : s.trimmed ? `Copied the last ${s.chars} characters of the claude.ai chat (trimmed)` : `Copied the claude.ai chat (${s.chars} characters)`,
  };
}
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function liveTurns(turns, convId, thread) {
  const msgs = thread && Array.isArray(thread.messages) ? thread.messages : [];
  return (Array.isArray(turns) ? turns : []).filter((t) => t && t.convId === convId).filter((t) => {
    if (!ENDED.has(t.status)) return true;
    const head = squash(t.prompt).slice(0, 40);
    return !msgs.some((m) => m && m.role === 'user' && squash(m.text).startsWith(head) && Date.parse(m.at) >= t.startedAt - 60000);
  });
}
```

`dashboard-v5/src/live/store.js`:
- in `live` (beside `claudeHub`/`claudeLib`): `claudeChat: { turns: [] },`
- no import change: `store.js` already imports the adapter as a namespace (`import * as A from './adapter.mjs';`, store.js:15), so the code below calls `A.chatTurnNew` / `A.chatReduce`
- inside `createStore`, after `pull`:

```js
  // Claude Hub H3 — in-app chat turns. Events can beat the send() answer, so unknown turnIds wait in `pending`.
  const pendingChat = [];
  let chatTimer = null;
  const emitSoon = () => { if (chatTimer) return; chatTimer = setTimeout(() => { chatTimer = null; emit(); }, 50); };
  const applyChat = (e) => {
    if (!e || typeof e !== 'object' || typeof e.turnId !== 'string') return false;
    const turns = live.claudeChat.turns, i = turns.findIndex((t) => t.turnId === e.turnId);
    if (i < 0) { pendingChat.push(e); if (pendingChat.length > 200) pendingChat.shift(); return false; }
    turns[i] = A.chatReduce(turns[i], e, Date.now());
    return true;
  };
  async function sendClaudeChat(req = {}) {
    if (!hq || !hq.claudeChat) return { error: 'This window has no app bridge' };
    let r;
    try { r = await hq.claudeChat.send(req); } catch (e) { return { error: String((e && e.message) || e) }; }
    if (!r || typeof r !== 'object' || r.error || typeof r.turnId !== 'string') return { error: (r && r.error) || 'no answer from the app' };
    const turns = live.claudeChat.turns;
    turns.push(A.chatTurnNew({ turnId: r.turnId, convId: req.conversationId || null, projectId: req.projectId || null, prompt: req.text, mode: req.mode, sessionId: r.sessionId || null, seeded: r.seeded || null, now: Date.now() }));
    if (turns.length > 20) turns.splice(0, turns.length - 20);
    for (const e of pendingChat.splice(0).filter((x) => { if (x.turnId === r.turnId) return true; pendingChat.push(x); return false; })) applyChat(e);
    emit();
    return r;
  }
  async function cancelClaudeChat(turnId) {
    if (!hq || !hq.claudeChat) return false;
    try { return (await hq.claudeChat.cancel(turnId)) === true; } catch { return false; }
  }
```

- in `start()`, beside the Hub wiring: `if (hq.claudeChat && hq.claudeChat.on) sub(() => hq.claudeChat.on((e) => { if (applyChat(e)) { if (e.kind === 'delta' || e.kind === 'tool') emitSoon(); else emit(); } }));`
- in `stop()`: `clearTimeout(chatTimer); chatTimer = null;`
- add `sendClaudeChat, cancelClaudeChat` to the returned object.

(The replay line keeps unrelated pending events: it empties the buffer, re-pushes every event for other turns, and applies the ones for this turn in arrival order.)

- [ ] **Step 4: Run them to see them pass**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs
git commit -m "fe: Claude Hub H3 v5 live chat turns — reducer, view (mode on every turn, honest status), dedupe vs the reloaded thread" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Composer logic — pure `composerView` / `pickerOptions` / `composerRows` + mixin `claudeChatLogic`

Spec §9 "Composer. Project picker, mode switch (Read-only / Allow edits), Send / Stop, and the quota label."

**Files:**
- Create: `dashboard-v5/src/logic/claude-chat.js`, `dashboard-v5/src/logic/claude-chat.test.mjs`

**Interfaces:**
- Consumes: Task 7 `chatTurnView`, `liveTurns` (`../live/adapter.mjs`), store `sendClaudeChat`, `cancelClaudeChat`; H2 `live.claudeLib.thread` (raw `{conversation:{id, source, title}, messages}`), `live.claudeLib.projects` (raw Hub rows `{id, source, name, path, hq_project_id}`), mixin `clOpenChat(id)`; Component helpers `this.canWrite()`, `this.writeReason()`, `this.toast(kind, text)`, `this.go(tab, sub)`, `this.setState(patch)`, `this.store`, `this.LIVE`, `this.state`.
- Produces (NEW):
  - State keys (added to `initState` in Task 9): `ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false`. The mode is NOT persisted: every composer opens Read-only (the safe default).
  - `QUOTA = 'Uses your Claude quota'`, `MODE_NOTE = { 'read-only': 'Read-only: Claude can read and answer, but not edit files or run commands', edits: 'Allow edits: Claude can edit files in this folder; commands are still refused' }`.
  - `pickerOptions(hqProjects, hubProjects) -> [{ id, label }]` — every WorkspaceHQ project (`{id, name}` → `label: name`) first, then Hub Claude Code projects (`source === 'code'`, with a `path`) that are NOT linked to a WorkspaceHQ project (`hq_project_id` empty) as `label: '<name> · Claude Code folder'`; ids are passed to `send` as `projectId` unchanged.
  - `composerTarget(S, LIVE) -> string | null` — `S.ccConv`, else the conversation the composer's last turn (`S.ccTurn`) became (a new chat's `code:<session>` after its `session` event), else `null`.
  - `composerView(S, LIVE, { hasBridge, canWrite, writeReason, hqProjects }) -> { open, isNew, convId, title, text, mode, modeNote, picks: [{ id, label, on }], needsPick, turns: [view], running, runningTurnId, canSend, sendTip, sending, quota }` — `title`: continuing → `'Continue · <thread title or "this chat">'`, new → `'New chat · <picked label or "pick a project">'`; `turns` = `liveTurns(...)` for `convId` (new chat before its session: the turn with id `S.ccTurn` only) mapped through `chatTurnView`; `sendTip` reasons, in order: `'This window has no app bridge'`, `writeReason`, `'A reply is still running — wait for it or press Stop'`, `'Sending…'`, `'Pick a project'`, `'Type a message'`, else `'Send to Claude Code (uses your Claude quota)'`; `canSend` = `sendTip` is the last one.
  - `composerRows(turns) -> [{ key, isPrompt, isText, isTool, isMeta, isError, text }]` — flattens the turns into one list for the template (no nested loops): per turn a meta row `'<modeText> · <statusText>'` (+ `' · <tokens> tokens'` when known), an optional meta row with the seed note, the prompt row, text/tool rows (`tool` rows read `'▸ <name> <hint>'` — collapsed by design), and an error row when `error`.
  - Mixin `claudeChatLogic`: `ccNew(projectId = '')`, `ccContinue()`, `onCcText(e)`, `ccSetMode(mode)`, `ccPick(id)`, `ccSend()`, `ccStop()`, `ccClose()`, `ccOpenThread()`.

- [ ] **Step 1: Write the failing test**

```js
// dashboard-v5/src/logic/claude-chat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerOptions, composerTarget, composerView, composerRows, claudeChatLogic, QUOTA } from './claude-chat.js';
import { chatTurnNew, chatReduce } from '../live/adapter.mjs';

const SID = '00000000-0000-4000-8000-000000000001';
const HQP = [{ id: 'project-a', name: 'Project A' }];
const HUBP = [{ id: 'code:C--placeholder-project-a', source: 'code', name: 'project-a', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a' },
  { id: 'code:C--placeholder-Desktop-project-b', source: 'code', name: 'project-b', path: 'C:\\placeholder\\Desktop\\project-b', hq_project_id: null },
  { id: 'web:p1', source: 'web', name: 'Web project', path: null, hq_project_id: null }];
const S0 = { ccOpen: true, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false };
const LIVE0 = (o = {}) => ({ claudeChat: { turns: [] }, claudeLib: { projects: HUBP, thread: null }, ...o });
const OPTS = { hasBridge: true, canWrite: true, writeReason: '', hqProjects: HQP };

test('pickerOptions: WorkspaceHQ projects, then unlinked Claude Code folders; web projects are not folders', () => {
  assert.deepEqual(pickerOptions(HQP, HUBP), [{ id: 'project-a', label: 'Project A' }, { id: 'code:C--placeholder-Desktop-project-b', label: 'project-b · Claude Code folder' }]);
  assert.deepEqual(pickerOptions(null, null), []);
});

test('composerView: the send button says why it is off, in order', () => {
  const V = (s, o = {}) => composerView({ ...S0, ...s }, LIVE0(o.live), { ...OPTS, ...o });
  assert.equal(V({}, { hasBridge: false }).sendTip, 'This window has no app bridge');
  assert.equal(V({}, { canWrite: false, writeReason: 'Viewing an old snapshot' }).sendTip, 'Viewing an old snapshot');
  assert.equal(V({}).sendTip, 'Pick a project'); assert.equal(V({}).needsPick, true);
  assert.equal(V({ ccProj: 'project-a' }).sendTip, 'Type a message');
  const ok = V({ ccProj: 'project-a', ccText: 'Hi' });
  assert.equal(ok.canSend, true); assert.equal(ok.sendTip, 'Send to Claude Code (uses your Claude quota)'); assert.equal(ok.quota, QUOTA);
  assert.equal(ok.title, 'New chat · Project A'); assert.equal(ok.modeNote, 'Read-only: Claude can read and answer, but not edit files or run commands');
  assert.equal(V({ ccProj: 'project-a', ccText: 'Hi', ccSending: true }).sendTip, 'Sending…');
  const running = chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'x', mode: 'read-only', now: 0 });
  const busy = V({ ccConv: 'code:' + SID, ccText: 'more' }, { live: { claudeChat: { turns: [running] } } });
  assert.equal(busy.sendTip, 'A reply is still running — wait for it or press Stop'); assert.equal(busy.running, true); assert.equal(busy.runningTurnId, 't1');
  assert.equal(busy.isNew, false); assert.equal(busy.needsPick, false);
});

test('composerTarget: a new chat follows its first turn into the session it created', () => {
  let t = chatTurnNew({ turnId: 't9', convId: null, prompt: 'Hi', mode: 'edits', now: 0 });
  assert.equal(composerTarget({ ...S0, ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } })), null);
  const v0 = composerView({ ...S0, ccProj: 'project-a', ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } }), OPTS);
  assert.deepEqual(v0.turns.map((x) => x.id), ['t9'], 'before the session event the turn still shows');
  t = chatReduce(t, { kind: 'session', sessionId: SID }, 1);
  assert.equal(composerTarget({ ...S0, ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } })), 'code:' + SID);
});

test('composerRows: mode on every turn, collapsed tool rows, errors and seed notes as their own rows', () => {
  let t = chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'Read it', mode: 'edits', seeded: { chars: 120, trimmed: false }, now: 0 });
  t = chatReduce(t, { kind: 'delta', text: 'Reading' }, 1); t = chatReduce(t, { kind: 'tool', name: 'Read', hint: 'README.md' }, 2);
  t = chatReduce(t, { kind: 'done', usage: { in: 6, out: 40 } }, 3);
  const v = composerView({ ...S0, ccConv: 'code:' + SID }, LIVE0({ claudeChat: { turns: [t] } }), OPTS);
  const rows = composerRows(v.turns);
  assert.deepEqual(rows.map((r) => [r.isMeta, r.isPrompt, r.isText, r.isTool, r.isError, r.text]), [
    [true, false, false, false, false, 'Allow edits · Done · 46 tokens'],
    [true, false, false, false, false, 'Copied the claude.ai chat (120 characters)'],
    [false, true, false, false, false, 'Read it'],
    [false, false, true, false, false, 'Reading'],
    [false, false, false, true, false, '▸ Read README.md'],
  ]);
  const e = composerRows([{ ...v.turns[0], error: 'stopped after 10 min', items: [] }]);
  assert.equal(e[e.length - 1].isError, true); assert.equal(e[e.length - 1].text, 'stopped after 10 min');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique');
});

function fakeThis(state = {}, live = LIVE0(), answer = { turnId: 't1' }) {
  const sent = [], toasts = [], cancels = [], opened = [];
  const self = {
    state: { ...S0, ...state }, LIVE: live, hq: {},
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    canWrite: () => true, writeReason: () => '', toast: (k, t) => toasts.push([k, t]), go: () => {},
    clOpenChat: (id) => opened.push(id),
    store: { sendClaudeChat: async (req) => { sent.push(req); return answer; }, cancelClaudeChat: async (id) => { cancels.push(id); return false; } },
    ...claudeChatLogic,
  };
  return { self, sent, toasts, cancels, opened };
}

test('ccSend: sends exactly the target, clears the text, remembers the turn; an error is toasted', async () => {
  const a = fakeThis({ ccProj: 'project-a', ccText: 'Hello', ccMode: 'edits' });
  await a.self.ccSend();
  assert.deepEqual(a.sent, [{ conversationId: undefined, projectId: 'project-a', text: 'Hello', mode: 'edits' }]);
  assert.equal(a.self.state.ccText, ''); assert.equal(a.self.state.ccTurn, 't1'); assert.equal(a.self.state.ccSending, false);
  const b = fakeThis({ ccConv: 'code:' + SID, ccText: 'More' }, LIVE0(), { error: 'this chat already has a turn running — wait for it or press Stop' });
  await b.self.ccSend();
  assert.deepEqual(b.sent[0], { conversationId: 'code:' + SID, projectId: undefined, text: 'More', mode: 'read-only' });
  assert.deepEqual(b.toasts, [['error', 'Claude didn’t start · this chat already has a turn running — wait for it or press Stop']]);
  assert.equal(b.self.state.ccText, 'More', 'the owner’s text is kept on failure');
  const c = fakeThis({ ccText: '   ' });
  await c.self.ccSend();
  assert.equal(c.sent.length, 0);
});

test('ccSetMode / ccContinue / ccStop / ccNew', async () => {
  const live = LIVE0({ claudeLib: { projects: HUBP, thread: { conversation: { id: 'code:' + SID, source: 'code', title: 'Release planning' }, messages: [] } },
    claudeChat: { turns: [chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'x', mode: 'read-only', now: 0 })] } });
  const f = fakeThis({ ccOpen: false }, live);
  f.self.ccSetMode('bypassPermissions'); assert.equal(f.self.state.ccMode, 'read-only');
  f.self.ccSetMode('edits'); assert.equal(f.self.state.ccMode, 'edits');
  f.self.ccContinue();
  assert.equal(f.self.state.ccOpen, true); assert.equal(f.self.state.ccConv, 'code:' + SID); assert.equal(f.self.state.ccMode, 'read-only', 'every composer opens Read-only');
  await f.self.ccStop();
  assert.deepEqual(f.cancels, ['t1']); assert.deepEqual(f.toasts, [['info', 'That reply had already finished']]);
  f.self.ccNew('project-a');
  assert.equal(f.self.state.ccConv, null); assert.equal(f.self.state.ccProj, 'project-a'); assert.equal(f.self.state.ccTurn, null);
  // from a project page (a route over the Claude › Chats tab) New chat must leave the page, or the composer never shows
  const went = [], p = fakeThis({ route: { type: 'project', id: 'project-a' }, tab: 'claude', sub: { claude: 'chats' } });
  p.self.go = (...a) => went.push(a);
  p.self.ccNew('project-a');
  assert.deepEqual(went, [['claude', 'chats']]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard-v5/src/logic/claude-chat.test.mjs`
Expected: FAIL — `Cannot find module '…/logic/claude-chat.js'`.

- [ ] **Step 3: Implement**

```js
// dashboard-v5/src/logic/claude-chat.js — Claude Hub H3 composer (spec 2026-10-13 §8–§9).
// Pure view functions + the claudeChatLogic mixin (this = the Component). Every send is labelled
// "Uses your Claude quota"; the mode is shown on every turn and always starts Read-only.
import { chatTurnView, liveTurns } from '../live/adapter.mjs';

export const QUOTA = 'Uses your Claude quota';
export const MODE_NOTE = {
  'read-only': 'Read-only: Claude can read and answer, but not edit files or run commands',
  edits: 'Allow edits: Claude can edit files in this folder; commands are still refused',
};
const MODES = ['read-only', 'edits'];

export function pickerOptions(hqProjects, hubProjects) {
  const out = [];
  for (const p of Array.isArray(hqProjects) ? hqProjects : []) if (p && p.id) out.push({ id: p.id, label: String(p.name || p.id) });
  for (const p of Array.isArray(hubProjects) ? hubProjects : []) {
    if (p && p.source === 'code' && p.path && !p.hq_project_id) out.push({ id: p.id, label: `${p.name || p.id} · Claude Code folder` });
  }
  return out;
}

const turnsOf = (LIVE) => (LIVE && LIVE.claudeChat && Array.isArray(LIVE.claudeChat.turns) ? LIVE.claudeChat.turns : []);
export function composerTarget(S, LIVE) {
  if (S.ccConv) return S.ccConv;
  const t = S.ccTurn ? turnsOf(LIVE).find((x) => x.turnId === S.ccTurn) : null;
  return (t && t.convId) || null;
}

export function composerView(S, LIVE, { hasBridge, canWrite, writeReason, hqProjects }) {
  const lib = (LIVE && LIVE.claudeLib) || {};
  const convId = composerTarget(S, LIVE);
  const isNew = !S.ccConv;
  const thread = lib.thread && lib.thread.conversation && lib.thread.conversation.id === convId ? lib.thread : null;
  const raw = convId ? liveTurns(turnsOf(LIVE), convId, thread) : turnsOf(LIVE).filter((t) => t.turnId === S.ccTurn);
  const turns = raw.map(chatTurnView);
  const run = turns.find((t) => t.running);
  const opts = pickerOptions(hqProjects, lib.projects);
  const picked = opts.find((o) => o.id === S.ccProj);
  const needsPick = isNew && !convId;
  const text = String(S.ccText || '');
  const sendTip = !hasBridge ? 'This window has no app bridge'
    : !canWrite ? (writeReason || 'Read-only right now')
      : run ? 'A reply is still running — wait for it or press Stop'
        : S.ccSending ? 'Sending…'
          : needsPick && !picked ? 'Pick a project'
            : !text.trim() ? 'Type a message'
              : 'Send to Claude Code (uses your Claude quota)';
  const mode = MODES.includes(S.ccMode) ? S.ccMode : 'read-only';
  const tTitle = thread && thread.conversation.title;
  return {
    open: !!S.ccOpen, isNew, convId,
    title: isNew && !convId ? `New chat · ${picked ? picked.label : 'pick a project'}` : `Continue · ${tTitle || 'this chat'}`,
    text, mode, modeNote: MODE_NOTE[mode],
    picks: opts.map((o) => ({ ...o, on: o.id === S.ccProj })), needsPick,
    turns, running: !!run, runningTurnId: run ? run.id : null,
    canSend: sendTip === 'Send to Claude Code (uses your Claude quota)', sendTip, sending: !!S.ccSending, quota: QUOTA,
  };
}

export function composerRows(turns) {
  const rows = [];
  const row = (key, kind, text) => rows.push({ key, isPrompt: kind === 'prompt', isText: kind === 'text', isTool: kind === 'tool', isMeta: kind === 'meta', isError: kind === 'error', text });
  for (const t of Array.isArray(turns) ? turns : []) {
    row(t.id + ':m', 'meta', `${t.modeText} · ${t.statusText}` + (t.hasTokens ? ` · ${t.tokens} tokens` : ''));
    if (t.seededNote) row(t.id + ':s', 'meta', t.seededNote);
    row(t.id + ':p', 'prompt', t.prompt);
    for (const it of t.items) row(it.key, it.tool ? 'tool' : 'text', it.tool ? `▸ ${it.name}${it.hint ? ' ' + it.hint : ''}` : it.text);
    if (t.error) row(t.id + ':e', 'error', t.error);
  }
  return rows;
}

export const claudeChatLogic = {
  ccNew(projectId = '') {
    this.setState({ ccOpen: true, ccConv: null, ccProj: typeof projectId === 'string' ? projectId : '', ccTurn: null, ccText: '', ccMode: 'read-only' });
    // a project page is a route OVER the tab (ctx v.claude is false while route is set): go() clears it
    if (this.state.route || this.state.tab !== 'claude' || (this.state.sub && this.state.sub.claude !== 'chats')) this.go('claude', 'chats');
  },
  ccContinue() {
    const t = this.LIVE.claudeLib && this.LIVE.claudeLib.thread, c = t && t.conversation;
    if (!c || !c.id) return;
    this.setState({ ccOpen: true, ccConv: c.id, ccProj: '', ccTurn: null, ccMode: 'read-only' });
  },
  onCcText(e) { this.setState({ ccText: e && e.target ? String(e.target.value) : '' }); },
  ccSetMode(mode) { if (MODES.includes(mode)) this.setState({ ccMode: mode }); },
  ccPick(id) { this.setState({ ccProj: typeof id === 'string' ? id : '' }); },
  ccClose() { this.setState({ ccOpen: false }); },
  ccOpenThread() { const id = composerTarget(this.state, this.LIVE); if (id) this.clOpenChat(id); },
  async ccSend() {
    const S = this.state;
    const text = String(S.ccText || '');
    if (!text.trim() || S.ccSending || !this.canWrite()) return;
    const convId = composerTarget(S, this.LIVE);
    if (!convId && !S.ccProj) return;
    this.setState({ ccSending: true });
    let r;
    try {
      r = await this.store.sendClaudeChat({ conversationId: convId || undefined, projectId: S.ccProj || undefined, text, mode: MODES.includes(S.ccMode) ? S.ccMode : 'read-only' });
    } finally { this.setState({ ccSending: false }); }
    if (!r || r.error) { this.toast('error', 'Claude didn’t start · ' + ((r && r.error) || 'no answer')); return; }
    this.setState({ ccText: '', ccTurn: r.turnId, ...(convId && !S.ccConv ? { ccConv: convId } : {}) });
    if (r.seeded && r.seeded.trimmed) this.toast('info', `Copied the last ${r.seeded.chars} characters of the claude.ai chat`);
  },
  async ccStop() {
    const id = composerView(this.state, this.LIVE, { hasBridge: true, canWrite: true, writeReason: '', hqProjects: [] }).runningTurnId;
    if (!id) return;
    const ok = await this.store.cancelClaudeChat(id);
    if (!ok) this.toast('info', 'That reply had already finished');
  },
};
```

(`ccSend` passes `projectId` even when continuing: the engine ignores it for a Code chat and uses it as the destination for a claude.ai chat — Task 3. Note on the first `ccSend` test: `conversationId` is `undefined` because a fresh composer has no target yet.)

- [ ] **Step 4: Run it to see it pass**

Run: `node --test dashboard-v5/src/logic/claude-chat.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -- dashboard-v5/src/logic/claude-chat.js dashboard-v5/src/logic/claude-chat.test.mjs
git commit -m "fe: Claude Hub H3 composer logic — picker, honest send reasons, mode always starts Read-only, flattened turn rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Composer on screen — vals, app wiring, markup in Chats + thread "Continue", project-page "New chat" swap, re-records

Spec §9 "Composer … streams into the thread view", "Project page … 'New chat'", §8 "The UI shows the mode on every turn", "Every send shows 'uses your Claude quota'". One commit, so the template hash and goldens never sit red between commits.

**Files:**
- Create: `dashboard-v5/src/vals/claude-chat.js`
- Modify: `dashboard-v5/src/app.js` (import, `initState`, `Object.assign` mixins), `dashboard-v5/src/vals/index.js` (`SURFACES`), `dashboard-v5/src/tpl/claude.tpl.js`, `dashboard-v5/src/tpl/project-page.tpl.js` (the H2 "New chat" button's `title` only), `dashboard-v5/src/logic/claude-lib.js` (H2 `clNewChat` body), `dashboard-v5/src/logic/claude-lib.test.mjs` (only if it asserts `clNewChat` opens a terminal), `dashboard-v5/src/tpl.hash.test.mjs` (re-record by hand), `dashboard-v5/src/__golden__/vals.hashes.json` (re-record)

**Interfaces:**
- Consumes: Task 8 `composerView`, `composerRows`, `claudeChatLogic`; Task 7 store functions; ctx (`vals/ctx.js`) `S, LIVE, v, sub, projects, cantWrite, writeReason, tabStyle`; H2 markup anchors in `tpl/claude.tpl.js`: the standalone `<sc-if value="{{ clSearched }}" hint-placeholder-val="{{ false }}">` line (first sibling after the Chats filter `</section>`, followed by `<section data-cl="hits"`; the same tag also appears inline beside the search row's Clear button — not that one) and `<button type="button" onClick="{{ clTerminal }}"` (thread header).
- Produces:
  - `claudeChatVals(ctx)` (NEW surface; every key starts `cc`, none exists at HEAD): `ccBarShow, ccNewChat, ccShow, ccIsNew, ccTitle, ccText, onCcText, ccPicks, ccHasPicks, ccNoPicks, ccReadOnlyOn, ccEditsOn, ccSetReadOnly, ccSetEdits, ccReadOnlyStyle, ccEditsStyle, ccModeNote, ccRows, ccHasRows, ccSend, ccCantSend, ccSendTip, ccStop, ccRunning, ccQuota, ccClose, ccContinue, ccCanContinue, ccOpenThread, ccHasConv, ccSending`.
  - `initState` keys (comment `// Claude chat composer (H3, logic/claude-chat.js)`): `ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false`.
  - H2's `clNewChat(project)` now opens the composer: `return this.ccNew(project && project.id ? project.id : '');` (H2: "H3 replaces the handler, not the markup"; the button's `title` changes because the old one would now be false).

- [ ] **Step 1: Write the failing test** (a vals test for the new surface, appended to `dashboard-v5/src/logic/claude-chat.test.mjs`)

```js
// append to dashboard-v5/src/logic/claude-chat.test.mjs
import { claudeChatVals } from '../vals/claude-chat.js';
test('claudeChatVals: composer only on Claude › Chats when open; quota label always; Send carries its reason', () => {
  const self = { hq: { claudeChat: {} }, ...claudeChatLogic, setState() {}, ccNew() {}, ccContinue() {} };
  const ctx = (S, o = {}) => ({ S: { ...S0, ...S }, LIVE: LIVE0(o.live), v: { claude: true }, sub: 'chats', projects: HQP, cantWrite: false, writeReason: '', tabStyle: (on) => ({ color: on ? 'on' : 'off' }), ...o.ctx });
  const closed = claudeChatVals.call(self, ctx({ ccOpen: false }));
  assert.equal(closed.ccShow, false); assert.equal(closed.ccBarShow, true); assert.equal(closed.ccQuota, 'Uses your Claude quota');
  const open = claudeChatVals.call(self, ctx({ ccOpen: true, ccProj: 'project-a', ccText: 'Hi' }));
  assert.equal(open.ccShow, true); assert.equal(open.ccIsNew, true); assert.equal(open.ccCantSend, false);
  assert.equal(open.ccReadOnlyOn, true); assert.equal(open.ccEditsOn, false);
  assert.deepEqual(open.ccPicks.map((p) => [p.label, p.on]), [['Project A', true], ['project-b · Claude Code folder', false]]);
  assert.equal(claudeChatVals.call(self, ctx({ ccOpen: true }, { ctx: { sub: 'sessions' } })).ccShow, false);
  assert.equal(claudeChatVals.call(self, ctx({ ccOpen: true }, { ctx: { v: { claude: false } } })).ccBarShow, false);
  const nob = claudeChatVals.call({ ...self, hq: null }, ctx({ ccOpen: true, ccProj: 'project-a', ccText: 'Hi' }));
  assert.equal(nob.ccCantSend, true); assert.equal(nob.ccSendTip, 'This window has no app bridge');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test dashboard-v5/src/logic/claude-chat.test.mjs`
Expected: FAIL — `Cannot find module '…/vals/claude-chat.js'`.

- [ ] **Step 3: Implement the surface and the wiring**

```js
// dashboard-v5/src/vals/claude-chat.js — Claude Hub H3 composer render values (spec §8–§9).
import { composerView, composerRows } from '../logic/claude-chat.js';

export function claudeChatVals(ctx) {
  const { S, LIVE, v, sub, projects, cantWrite, writeReason, tabStyle } = ctx;
  const onChats = !!(v && v.claude && sub === 'chats');
  const cv = composerView(S, LIVE, { hasBridge: !!(this.hq && this.hq.claudeChat), canWrite: !cantWrite, writeReason, hqProjects: projects });
  const chip = (on) => Object.assign(tabStyle(on), { height: 28 });
  const thread = LIVE && LIVE.claudeLib && LIVE.claudeLib.thread;
  const rows = composerRows(cv.turns);
  return {
    ccBarShow: onChats, ccNewChat: () => this.ccNew(''),
    ccShow: onChats && cv.open, ccIsNew: cv.isNew && !cv.convId, ccTitle: cv.title,
    ccText: cv.text, onCcText: (e) => this.onCcText(e),
    ccPicks: cv.picks.map((p) => ({ label: p.label, on: p.on, go: () => this.ccPick(p.id), style: chip(p.on) })),
    ccHasPicks: cv.picks.length > 0, ccNoPicks: 'No projects to start in yet — run a scan, or start a Claude Code session in a folder first',
    ccReadOnlyOn: cv.mode === 'read-only', ccEditsOn: cv.mode === 'edits',
    ccSetReadOnly: () => this.ccSetMode('read-only'), ccSetEdits: () => this.ccSetMode('edits'),
    ccReadOnlyStyle: chip(cv.mode === 'read-only'), ccEditsStyle: chip(cv.mode === 'edits'), ccModeNote: cv.modeNote,
    ccRows: rows, ccHasRows: rows.length > 0,
    ccSend: () => this.ccSend(), ccCantSend: !cv.canSend, ccSendTip: cv.sendTip,
    ccStop: () => this.ccStop(), ccRunning: cv.running, ccQuota: cv.quota, ccClose: () => this.ccClose(),
    ccContinue: () => this.ccContinue(), ccCanContinue: !!(thread && thread.conversation && thread.conversation.id),
    ccOpenThread: () => this.ccOpenThread(), ccHasConv: !!cv.convId, ccSending: cv.sending,
  };
}
```

`dashboard-v5/src/vals/index.js`: `import { claudeChatVals } from './claude-chat.js';` and add `claudeChatVals` to `SURFACES` right after `claudeLibVals` (H2's surface).

`dashboard-v5/src/app.js`: `import { claudeChatLogic } from './logic/claude-chat.js';` beside the H2 `claudeLibLogic` import; add `claudeChatLogic` to the `Object.assign(Component.prototype, …)` list right after `claudeLibLogic`; in `initState`, after H2's `// Claude library (H2, logic/claude-lib.js)` keys:

```js
      // Claude chat composer (H3, logic/claude-chat.js) — not persisted: every composer opens Read-only
      ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false,
```

`dashboard-v5/src/logic/claude-lib.js` — replace the body of H2's `clNewChat(project)`:

```js
  clNewChat(project) { return this.ccNew(project && project.id ? project.id : ''); },   // H3: the in-app composer (was a terminal until H3)
```

If `claude-lib.test.mjs` asserts that `clNewChat` reaches `clTermAt`/`claudeQuest`, change that assertion to: a stub `ccNew` records `['project-a']` when `clNewChat({ id: 'project-a', path: 'project-a' })` runs.

- [ ] **Step 4: Add the markup** (`dashboard-v5/src/tpl/claude.tpl.js`)

(a) In the thread header, immediately BEFORE `<button type="button" onClick="{{ clTerminal }}"` insert:

```html
<!-- v5: Claude Hub H3 (spec §9) — "Continue" opens the composer on this chat (claude --resume) -->
<button type="button" data-cc="continue" onClick="{{ ccContinue }}" disabled="{{ !ccCanContinue }}" title="Continue this chat in WorkspaceHQ — uses your Claude quota" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer">Continue</button>
```

(b) H2's markup holds `<sc-if value="{{ clSearched }}" hint-placeholder-val="{{ false }}">` TWICE: once inline inside the search row (wrapping the "Clear" button) and once on its own line, directly after the filter `</section>` and directly before `<section data-cl="hits"`. Anchor on the SECOND one — the line that starts with that `<sc-if` and whose next line opens `<section data-cl="hits"` — never the inline one next to Clear. Immediately BEFORE that line insert:

```html
                <!-- v5: Claude Hub H3 (spec §8–§9) — in-app chat: New chat bar + composer (project picker, Read-only / Allow edits, Send / Stop, quota label); turns stream here as text, tool calls as collapsed rows -->
                <sc-if value="{{ ccBarShow }}" hint-placeholder-val="{{ true }}">
                  <div data-cc="bar" style="display:flex;gap:8px;align-items:center"><button type="button" data-cc="new" onClick="{{ ccNewChat }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer">New chat</button><span style="font-size:11px;color:var(--faint)">{{ ccQuota }}</span></div>
                </sc-if>
                <sc-if value="{{ ccShow }}" hint-placeholder-val="{{ false }}">
                  <section data-cc="composer" aria-label="Chat with Claude Code" style="background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
                    <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:15px;flex:1">{{ ccTitle }}</span><sc-if value="{{ ccHasConv }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ ccOpenThread }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Open in library</button></sc-if><button type="button" onClick="{{ ccClose }}" aria-label="Close the composer" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">✕</button></div>
                    <sc-if value="{{ ccIsNew }}" hint-placeholder-val="{{ true }}">
                      <div data-cc="picker" role="group" aria-label="Project" style="display:flex;gap:4px;flex-wrap:wrap"><sc-for list="{{ ccPicks }}" as="p" hint-placeholder-count="3"><button type="button" onClick="{{ p.go }}" aria-pressed="{{ p.on }}" style="{{ p.style }}">{{ p.label }}</button></sc-for></div>
                      <sc-if value="{{ !ccHasPicks }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ ccNoPicks }}</div></sc-if>
                    </sc-if>
                    <div data-cc="mode" role="group" aria-label="Mode" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap"><button type="button" data-cc="mode-ro" onClick="{{ ccSetReadOnly }}" aria-pressed="{{ ccReadOnlyOn }}" style="{{ ccReadOnlyStyle }}">Read-only</button><button type="button" data-cc="mode-edits" onClick="{{ ccSetEdits }}" aria-pressed="{{ ccEditsOn }}" style="{{ ccEditsStyle }}">Allow edits</button><span style="font-size:11px;color:var(--faint)">{{ ccModeNote }}</span></div>
                    <sc-if value="{{ ccHasRows }}" hint-placeholder-val="{{ false }}">
                      <div data-cc="turns" aria-live="polite" style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto;border-left:2px solid var(--frame);padding-left:10px">
                        <sc-for list="{{ ccRows }}" as="r" hint-placeholder-count="4"><div data-cc="row"><sc-if value="{{ r.isMeta }}" hint-placeholder-val="{{ true }}"><div data-cc="meta" style="font-size:11px;color:var(--faint)">{{ r.text }}</div></sc-if><sc-if value="{{ r.isPrompt }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);white-space:pre-wrap;word-break:break-word">{{ r.text }}</div></sc-if><sc-if value="{{ r.isText }}" hint-placeholder-val="{{ false }}"><div data-cc="text" style="font-size:13px;white-space:pre-wrap;word-break:break-word">{{ r.text }}</div></sc-if><sc-if value="{{ r.isTool }}" hint-placeholder-val="{{ false }}"><div data-cc="tool" style="font-family:var(--term);font-size:12px;color:var(--muted)">{{ r.text }}</div></sc-if><sc-if value="{{ r.isError }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--orange)">{{ r.text }}</div></sc-if></div></sc-for>
                      </div>
                    </sc-if>
                    <textarea data-cc="input" value="{{ ccText }}" onChange="{{ onCcText }}" aria-label="Message to Claude Code" rows="3" placeholder="Message Claude Code…" style="width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--frame);border-radius:8px;background:transparent;color:var(--text);padding:8px 10px;font-family:var(--term);font-size:13px"></textarea>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" data-cc="send" onClick="{{ ccSend }}" disabled="{{ ccCantSend }}" title="{{ ccSendTip }}" style="height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--purple);background:var(--purple);color:var(--bg);cursor:pointer">Send</button><sc-if value="{{ ccRunning }}" hint-placeholder-val="{{ false }}"><button type="button" data-cc="stop" onClick="{{ ccStop }}" style="height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--orange);background:transparent;color:var(--orange);cursor:pointer">Stop</button></sc-if><span data-cc="quota" style="font-size:11px;color:var(--faint)">{{ ccQuota }}</span><span style="font-size:11px;color:var(--faint);flex:1;text-align:right">{{ ccSendTip }}</span></div>
                  </section>
                </sc-if>
```

(Every value is a `{{ }}` text binding: streamed text and tool hints are textContent, never HTML. `{{ !ccCanContinue }}` uses the runtime's `!` operator, the only expression form besides comparisons — code map §11.)

(c) `dashboard-v5/src/tpl/project-page.tpl.js` — on H2's "New chat" button change ONLY `title="Opens Claude Code in a terminal in this project"` to `title="Opens the in-app chat on this project"`, and put `<!-- v5: Claude Hub H3 — New chat opens the in-app composer (was a terminal in H2) -->` directly before the H2 comment that precedes that section.

- [ ] **Step 5: Re-record the template hash (deliberate change) and the goldens (after attributing every diff)**

Compute the new constants:

```bash
node --input-type=module -e "import t from './dashboard-v5/src/app.tpl.js'; import { createHash } from 'node:crypto'; console.log(t.length, Buffer.byteLength(t, 'utf8'), createHash('sha256').update(t).digest('hex'));"
```

Put the three numbers into `SHA256`, `LENGTH`, `UTF8_BYTES` in `dashboard-v5/src/tpl.hash.test.mjs` and add a history line: `// 2026-10-16 H3 Claude chat composer (claude.tpl.js: Continue, New chat bar, composer; project-page title) +<Δ chars> chars / +<Δ bytes> bytes` with the real deltas from the old constants.

Attribute the golden diff before re-recording:

```bash
GOLDEN_DUMP="$TEMP/h3-golden-before" node --test dashboard-v5/src/vals.golden.test.mjs
```

Expected: every scenario differs ONLY by the new `cc*` keys (the whole `renderVals()` object is hashed), plus `tab.claude.chats` / `claude.*` scenarios where `ccBarShow` is `true`; any other key change is a bug — fix it, don't record it. Then:

```bash
UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs
rm -rf "$TEMP/h3-golden-before"
```

- [ ] **Step 6: Run the v5 suites**

Run: `node --test dashboard-v5/src/*.test.mjs dashboard-v5/src/dc/*.test.mjs dashboard-v5/src/live/*.test.mjs dashboard-v5/src/logic/*.test.mjs dashboard-v5/src/elements/*.test.mjs dashboard-v5/styles/*.test.mjs dashboard-v5/tools/*.test.mjs`
Expected: PASS (incl. `honesty.test.mjs` — the new strings are UI vocabulary, not sample data — and the new vals test).

- [ ] **Step 7: Commit**

```bash
git add -- dashboard-v5/src/vals/claude-chat.js dashboard-v5/src/vals/index.js dashboard-v5/src/app.js dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/project-page.tpl.js dashboard-v5/src/logic/claude-lib.js dashboard-v5/src/logic/claude-chat.test.mjs dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/src/__golden__/vals.hashes.json
git commit -m "fe: Claude Hub H3 composer on screen — New chat, Continue, Read-only/Allow edits, Send/Stop, quota label; project-page New chat opens it" -m "Template hash and goldens re-recorded: every scenario gains only the cc* keys; Claude › Chats scenarios show the New chat bar." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `dashboard-v5/src/logic/claude-lib.test.mjs` to the pathspec only if Step 3 changed it.)

### Task 10: Selftest combos, golden scenarios, CDP scenarios `claude-chat-stream-stop` + `claude-chat-mode-readonly`

Spec §11 "Goldens and selftest combos for each new state", "CDP scenarios: … `claude-chat-stream-stop`, `claude-chat-mode-readonly`".

**Files:**
- Modify: `dashboard-v5/src/selftest.js` (`CLEAR`, `savedLive`, `STATES`), `dashboard-v5/src/vals.golden.test.mjs` (scenarios after H2's Claude scenarios), `dashboard-v5/src/__golden__/vals.hashes.json` (record the new names), `dashboard-v5/tools/cdp-gate.mjs` (`fresh()` reset list, two scenarios before the closing `};` of `SCENARIOS`, header comment list)

**Interfaces:**
- Consumes: Task 7 turn shape (`chatTurnNew` fields), Task 8/9 state keys and `data-cc` hooks (`bar`, `new`, `composer`, `picker`, `mode-ro`, `mode-edits`, `turns`, `row`, `meta`, `text`, `tool`, `input`, `send`, `stop`, `quota`, `continue`); Task 6 fake `claudeChat.*`; `hqFake.set/emit/calls/reset`.
- Produces: selftest STATES `cc-new-empty`, `cc-new-picked`, `cc-streaming`, `cc-stopped`, `cc-error`, `cc-edits-done`, `cc-seeded`; golden scenarios `claude.composer-new`, `claude.composer-streaming`, `claude.composer-edits-done`, `claude.composer-error`; CDP scenarios `claude-chat-stream-stop`, `claude-chat-mode-readonly`.

- [ ] **Step 1: Selftest** (`dashboard-v5/src/selftest.js`)

Add to `CLEAR`: `ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false`. Add `claudeChat: LV.claudeChat` to `savedLive` (restored after the STATES loop like the others). Append to `STATES`:

```js
      // Claude Hub H3 — composer (logic/claude-chat.js): every visible state, both themes, both snapshot ends
      ...(() => {
        const SID = '00000000-0000-4000-8000-000000000001';
        const turn = (o) => ({ turnId: 'st-1', convId: 'code:' + SID, projectId: null, prompt: 'Placeholder question', mode: 'read-only', status: 'running',
          items: [{ type: 'text', text: 'Placeholder answer' }, { type: 'tool', name: 'Read', hint: 'README.md' }], sessionId: SID, usage: null, error: null, seeded: null,
          startedAt: Date.now(), endedAt: null, ...o });
        const cont = { ccOpen: true, ccConv: 'code:' + SID };
        const firstProj = (M.P0[0] || {}).id || '';
        return [
          ['cc-new-empty', at('claude', 'chats'), { ccOpen: true }],
          ['cc-new-picked', at('claude', 'chats'), { ccOpen: true, ccProj: firstProj, ccText: 'Placeholder question' }],
          ['cc-streaming', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn()] }; }],
          ['cc-stopped', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ status: 'stopped', endedAt: Date.now() })] }; }],
          ['cc-error', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ status: 'error', error: 'stopped after 10 min', endedAt: Date.now() })] }; }],
          ['cc-edits-done', at('claude', 'chats'), { ...cont, ccMode: 'edits' }, () => { LV.claudeChat = { turns: [turn({ mode: 'edits', status: 'done', usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, endedAt: Date.now() })] }; }],
          ['cc-seeded', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ convId: 'code:' + SID, seeded: { chars: 30000, trimmed: true } })] }; }],
        ];
      })(),
```

(`at`, `LV` and `M` are the helpers/locals the existing STATES entries use — code map §14; H2's `cl-*` states sit just above.)

Run (from `dashboard-v5/`, PowerShell):

```powershell
$env:HQ_V5_PROFILE = "h3-selftest-$PID"; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest; $LASTEXITCODE
```

Expected: `[selftest] {...}` with `errors: 0, unresolved: 0, failures: 0`, exit `0`. Then remove the profile folder `dev-main.js` names for `HQ_V5_PROFILE` (by its literal path, as the H1/H2 gates did).

- [ ] **Step 2: Golden scenarios** (`dashboard-v5/src/vals.golden.test.mjs`, after H2's Claude scenarios)

```js
// Claude Hub H3 — composer. A bridge with claudeChat (never started: render() does not call store.start()).
const CC_HQ = { ...P3_HQ, claudeChat: { send() {}, cancel() {}, on() { return () => {}; } } };
const CC_SID = '00000000-0000-4000-8000-000000000001';
const ccTurn = (o) => ({ turnId: 'g-1', convId: 'code:' + CC_SID, projectId: null, prompt: 'Placeholder question', mode: 'read-only', status: 'running',
  items: [{ type: 'text', text: 'Placeholder answer' }, { type: 'tool', name: 'Read', hint: 'README.md' }], sessionId: CC_SID, usage: null, error: null, seeded: null,
  startedAt: Date.parse('2026-10-05T09:59:00Z'), endedAt: null, ...o });
// tabSub(tab, sub) returns a FUNCTION (c) => ({…}) (vals.golden.test.mjs:243): call it — spreading the function itself yields {} and every scenario would render Home
const ccAt = (state, turns) => ({ hq: CC_HQ, live: (L) => { L.claudeChat = { turns }; }, state: (c) => ({ ...tabSub('claude', 'chats')(c), ...state }) });
add('claude.composer-new', ccAt({ ccOpen: true }, []));
add('claude.composer-streaming', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID }, [ccTurn()]));
add('claude.composer-edits-done', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID, ccMode: 'edits' }, [ccTurn({ mode: 'edits', status: 'done', usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, endedAt: Date.parse('2026-10-05T10:00:00Z') })]));
add('claude.composer-error', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID }, [ccTurn({ status: 'error', error: 'stopped after 10 min', endedAt: Date.parse('2026-10-05T10:00:00Z') })]));
```

Run: `node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: FAIL — the four names are "not in the hashes file". Dump and read them (`GOLDEN_DUMP="$TEMP/h3-golden-new" node --test dashboard-v5/src/vals.golden.test.mjs`; check `ccRows`, `ccSendTip`, `ccModeNote` in each JSON match the state), then record: `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`, rerun without the env → PASS, and `rm -rf "$TEMP/h3-golden-new"`.

- [ ] **Step 3: CDP scenarios** (`dashboard-v5/tools/cdp-gate.mjs`)

In `fresh()`'s `L.setState({...})` add `ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false,` and, inside the same evaluated function before `setState`, `if (L.store && L.store.live && L.store.live.claudeChat) L.store.live.claudeChat.turns.length = 0;`. Add both names to the header comment's scenario list. Add before the closing `};` of `SCENARIOS`:

```js
  // Claude Hub H3 (spec §8–§9): a turn streams as text, Stop ends it once with the partial text kept, and the mode
  // switch reaches main. Deterministic: claudeChat.send/cancel are overridden to emit events by hand.
  async 'claude-chat-stream-stop'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    try {
      await t.evaluate(`(() => {
        const SID = '00000000-0000-4000-8000-000000000001', ev = (d) => hqFake.emit('hq:claude-chat:event', d);
        hqFake.set('claudeChat.send', (req) => {
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'session', sessionId: SID, mode: req.mode }), 30);
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'delta', text: 'Placeholder <img src=x onerror=alert(1)> partial' }), 60);
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'tool', name: 'Read', hint: 'README.md' }), 90);
          return { turnId: 'ct-g1' };
        });
        hqFake.set('claudeChat.cancel', (id) => { setTimeout(() => ev({ turnId: id, kind: 'done', sessionId: SID, mode: 'read-only', usage: null, isError: false, subtype: '', result: '', stopped: true }), 0); return true; });
        const L = WHQ.app.logic; L.go('claude', 'chats'); L.ccNew(''); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="composer"]')`, 3000)) return ['the composer never opened'];
      if (!await t.evaluate(`(document.querySelector('[data-cc="quota"]') || {}).textContent === 'Uses your Claude quota'`)) out.push('the quota label is missing');
      if (!await t.evaluate(`document.querySelector('[data-cc="send"]').disabled`)) out.push('Send was enabled with no project picked');
      if (!await t.evaluate(`(() => { const b = document.querySelector('[data-cc="picker"] button'); if (!b) return false; b.click(); return true; })()`)) return out.concat(['no project to pick in the harness']);
      await t.evaluate(`(() => { WHQ.app.logic.setState({ ccText: 'Placeholder question' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="stop"]') && [...document.querySelectorAll('[data-cc="tool"]')].some((e) => e.textContent.includes('Read README.md'))`, 3000)) out.push('the turn never streamed a tool row with Stop showing');
      const sent = await t.evaluate(`hqFake.calls('claudeChat.send').map((c) => c.args[0])`);
      if (sent.length !== 1 || sent[0].mode !== 'read-only' || sent[0].text !== 'Placeholder question' || !sent[0].projectId) out.push('send got ' + JSON.stringify(sent));
      await t.evaluate(`document.querySelector('[data-cc="stop"]').click(), true`);
      if (!await t.waitFor(`!document.querySelector('[data-cc="stop"]') && [...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Read-only · Stopped — the partial answer is kept'))`, 3000)) out.push('Stop did not end the turn as stopped');
      await t.sleep(400);
      const r = await t.evaluate(`(() => { const turns = document.querySelector('[data-cc="turns"]');
        return { cancels: hqFake.calls('claudeChat.cancel').length, texts: [...document.querySelectorAll('[data-cc="text"]')].map((e) => e.textContent),
          markup: turns ? turns.querySelectorAll('img,script').length : -1, metas: [...document.querySelectorAll('[data-cc="meta"]')].map((e) => e.textContent) }; })()`);
      if (r.cancels !== 1) out.push('cancel calls: ' + r.cancels);
      if (r.texts.length !== 1 || r.texts[0] !== 'Placeholder <img src=x onerror=alert(1)> partial') out.push('partial text not kept exactly once as text: ' + JSON.stringify(r.texts));
      if (r.markup !== 0) out.push('streamed text became markup: ' + r.markup);
      if (r.metas.filter((m) => m.includes('Stopped')).length !== 1) out.push('the turn ended more than once: ' + JSON.stringify(r.metas));
      return out.concat(await t.errors());
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.store.live.claudeChat.turns.length = 0; L.setState({ ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false }); return true; })()`);
    }
  },

  async 'claude-chat-mode-readonly'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const pressed = (k) => `document.querySelector('[data-cc="${k}"]').getAttribute('aria-pressed')`;
    try {
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.go('claude', 'chats'); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="new"]')`, 3000)) return ['no New chat button on Claude › Chats'];
      await t.evaluate(`document.querySelector('[data-cc="new"]').click(), true`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="composer"]')`, 3000)) return ['New chat did not open the composer'];
      if (await t.evaluate(pressed('mode-ro')) !== 'true' || await t.evaluate(pressed('mode-edits')) !== 'false') out.push('the composer did not open Read-only');
      await t.evaluate(`(() => { document.querySelector('[data-cc="picker"] button').click(); WHQ.app.logic.setState({ ccText: 'First' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`[...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Read-only · Done'))`, 4000)) out.push('the first turn never showed "Read-only · Done"');
      await t.evaluate(`document.querySelector('[data-cc="mode-edits"]').click(), true`);
      await t.sleep(80);
      if (await t.evaluate(pressed('mode-edits')) !== 'true') out.push('Allow edits did not switch on');
      await t.evaluate(`(() => { WHQ.app.logic.setState({ ccText: 'Second' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`[...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Allow edits · Done'))`, 4000)) out.push('the second turn never showed "Allow edits · Done"');
      const sent = await t.evaluate(`hqFake.calls('claudeChat.send').map((c) => ({ mode: c.args[0].mode, conv: c.args[0].conversationId || null }))`);
      if (JSON.stringify(sent) !== JSON.stringify([{ mode: 'read-only', conv: null }, { mode: 'edits', conv: 'code:00000000-0000-4000-8000-000000000001' }])) out.push('send calls: ' + JSON.stringify(sent));
      await t.evaluate(`(() => { WHQ.app.logic.ccClose(); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="new"]').click(), true`);
      await t.sleep(120);
      if (await t.evaluate(pressed('mode-ro')) !== 'true') out.push('Allow edits was remembered: a new composer must open Read-only');
      return out.concat(await t.errors());
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.store.live.claudeChat.turns.length = 0; L.setState({ ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false }); return true; })()`);
    }
  },
```

(The second send continues the chat the first one created: the fake's `session` event gives the turn `convId = 'code:00000000-…-000000000001'` and `composerTarget` follows it — the same path a real new chat takes.)

Run the harness and the scenarios (from `dashboard-v5/`, PowerShell; port 9343 is this task's own):

```powershell
$env:HQ_V5_PROFILE = "h3-cdp-$PID"; $p = Start-Process -PassThru -FilePath ..\dashboard\node_modules\electron\dist\electron.exe -ArgumentList 'dev-main.js','--preload=fake','--hidden','--remote-debugging-port=9343'
node tools/cdp-gate.mjs --port 9343 --scenario claude-chat-stream-stop,claude-chat-mode-readonly,fake-parity,boot
node tools/cdp-gate.mjs --port 9343 --scenario all
Stop-Process -Id $p.Id
```

Expected: `PASS` for every scenario, exit 0 (both runs). Stop only `$p.Id` (the harness this step started), then remove that profile folder by its literal path.

- [ ] **Step 4: Commit**

```bash
git add -- dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: Claude Hub H3 selftest combos, composer goldens, CDP claude-chat-stream-stop + claude-chat-mode-readonly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: H3 gate on a real second instance (fixtures + fake claude), docs, HANDOFF

Spec §11 "Real second instance … The chat gate uses a fake `claude` shim, so no real quota is spent in gates." **This task never restarts or stops the owner's app** (`electron.exe . --hidden` without `--user-data-dir`, or its Hub child on `data/claude/hub.sqlite`); the controller restarts it after the plan lands, which is what loads the new main-side `claude-chat.js` and the preload `claudeChat` block into the owner's app.

**Files:**
- Modify: `README.md` (test commands + `HQ_CLAUDE_BIN`), `CLAUDE.md` (one fact line), `docs/sync/HANDOFF.md` (entry on top), `docs/sync/IPC-CONTRACT.md` (only if the gate shows drift from the Task 6 rows)
- No code changes. If the gate finds a bug, fix it in the task that owns the file (new commit with that task's prefix) and re-run this gate.

**Interfaces:**
- Consumes: everything above; `dashboard/claude-hub/__fixtures__/make-fixture.mjs` (`makeClaudeHome`, `userLine`, `assistantLines`, `titleLine`); `dashboard/__fixtures__/make-fake-claude.mjs` (`makeFakeClaude`). Produces: the gate result and the docs.

- [ ] **Step 1: Run every suite** (Global Constraints › Suites): `node --test dashboard/claude-hub/*.test.mjs`; `node --test dashboard/*.test.mjs` (includes `claude-chat.test.mjs`, `claude-chat.e2e.test.mjs`, `stream-parse.test.mjs`); the v5 suite; the v5 selftest (own `HQ_V5_PROFILE`); `node tools/cdp-gate.mjs --port 9343 --scenario all` against a `--preload=fake` harness (Task 10 Step 3). All PASS / exit 0; record the counts for the HANDOFF entry.

- [ ] **Step 2: Real second instance on fixtures with the fake claude** (PowerShell from the repo root; port 9494 — H1 used 9492, H2 9493):

```powershell
$g = Join-Path $env:TEMP ('hq-h3-gate-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $g, (Join-Path $g 'project-a') | Out-Null
$before = Get-ChildItem -LiteralPath data\claude -File | Select-Object Name, Length, LastWriteTime
# fixture ~/.claude (3 H1 chats with non-UUID ids) + one resumable chat: UUID session id, cwd = a real folder in $g
node --input-type=module -e "
import { makeClaudeHome, userLine, assistantLines, titleLine } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs';
import fs from 'node:fs'; import path from 'node:path';
const g = process.argv[1], h = makeClaudeHome(g), sid = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', cwd = path.join(g, 'project-a');
const dir = path.join(h.root, 'gate-project-a'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, sid + '.jsonl'), userLine({ uuid: 'u-g1', sessionId: sid, at: '2026-10-16T08:00:00Z', cwd, text: 'Placeholder gate start' })
  + assistantLines({ apiId: 'msg_g1', uuids: ['a-g1'], sessionId: sid, at: '2026-10-16T08:00:05Z', cwd, blocks: [{ type: 'text', text: 'Placeholder gate reply' }], usage: { input_tokens: 1, output_tokens: 2 } })
  + titleLine({ sessionId: sid, title: 'Gate resumable chat' }));
console.log(JSON.stringify({ home: h.home }));
" $g
node --input-type=module -e "import { makeFakeClaude } from './dashboard/__fixtures__/make-fake-claude.mjs'; console.log(JSON.stringify(makeFakeClaude(process.argv[1])));" $g
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'hub.sqlite'
$env:HQ_HUB_LATEST  = Join-Path $g 'latest.json'
Set-Content -LiteralPath $env:HQ_HUB_LATEST -Encoding utf8 -Value '{"projects":[],"archived_projects":[]}'
$env:HQ_CLAUDE_BIN  = Join-Path $g 'fakebin\claude.cmd'      # the engine runs ONLY the fake (never the owner's claude)
$env:FAKE_CLAUDE_LOG = Join-Path $g 'claude-argv.jsonl'
$env:FAKE_CLAUDE_MODE_FILE = Join-Path $g 'fake-mode.txt'
$env:FAKE_CLAUDE_PIDFILE = Join-Path $g 'fake.pid'
Set-Content -LiteralPath $env:FAKE_CLAUDE_MODE_FILE -Value 'ok'
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9494'
$p.Id   # the ONLY electron pid this task may stop
```

Note on projects in this instance: `HQ_HUB_LATEST` (H2's override) feeds ONLY the Hub's linker. Main's `studioProjects()` and the renderer still read the owner's `data/latest.json` (read-only, as in the H1/H2 gates), so the composer's picker lists the owner's real WorkspaceHQ projects first. The gate never SENDS to a WorkspaceHQ project: every send targets the fixture chat or the `$g\project-a` Hub folder (check 6 opens a real project page but sends nothing). Even a stray send would run only the fake (`HQ_CLAUDE_BIN`), which writes nothing outside `$g`.

Drive the instance over CDP on port 9494 (`Runtime.evaluate` from a short script kept in `$g`, never in the repo — as the H1/H2 gates did; `L = WHQ.app.logic`). Checks:
  1. `L.go('claude','chats')`: 4 chats listed, incl. `Gate resumable chat`; the `[data-cc="bar"]` shows `New chat` + `Uses your Claude quota`.
  2. **Honest refusal (hostile/unsuitable id):** open `Release planning` (fixture id `sess-a1`, not a UUID), click `[data-cc="continue"]`, set `ccText`, click Send → an error toast `Claude didn’t start · this chat has no resumable Claude Code session id`; `claude-argv.jsonl` does not exist yet (nothing spawned).
  3. **Continue, Read-only:** open `Gate resumable chat`, Continue, `ccText = 'Placeholder gate question'`, Send → within 5 s one `[data-cc="text"]` reads exactly `Placeholder answer from the fake claude.` and a meta row starts `Read-only · Done · 46 tokens`. `claude-argv.jsonl` line 1: `argv` deep-equals `buildArgs({mode:'read-only', sessionId:'1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'})` (contains `plan`, `--permission-prompts none`, no `bypass`/`dangerously`), `cwd` = `$g\project-a`, `stdin` = `Placeholder gate question`.
  4. **New chat, Allow edits:** `L.ccNew('')`, pick the gate folder: `const row = L.LIVE.claudeLib.projects.find((r) => r.path && r.path.toLowerCase() === <$g\project-a lower-cased>); L.ccPick(row.id)` and check its picker button (text ending ` · Claude Code folder` — an unlinked Hub folder: the H2 linker reads the empty fixture scan at `HQ_HUB_LATEST`) now has `aria-pressed="true"`, click `[data-cc="mode-edits"]`, Send `Placeholder edit request` → meta `Allow edits · Done`; argv line 2 = `buildArgs({mode:'edits'})` (no `--resume`), `cwd` = `$g\project-a`. (The fake writes no transcript, so this new chat does not appear in the library — a real Claude Code session does, through the Hub's ordinary `changed` event, which H1/H2 already gate.)
  5. **Stop leaves no orphan:** `Set-Content -LiteralPath $env:FAKE_CLAUDE_MODE_FILE -Value 'hang'`; Continue `Gate resumable chat`, Send → wait for `fake.pid`; `$fp = [int](Get-Content -LiteralPath $env:FAKE_CLAUDE_PIDFILE)`; click `[data-cc="stop"]` → meta `Read-only · Stopped — the partial answer is kept`, `Working` still shown once; within 10 s `Get-Process -Id $fp -ErrorAction SilentlyContinue` returns nothing, and `Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like "*$g*" }` returns nothing. Then `Set-Content -LiteralPath $env:FAKE_CLAUDE_MODE_FILE -Value 'ok'`.
  6. **Project page:** `L.openProject(<first project id>)`, click the Claude section's `New chat` → the Claude › Chats composer opens with that project's picker button `aria-pressed="true"` and Read-only on (send nothing).
  7. **Logs carry no conversation text:** `Select-String -Path "$g\logs\*" -Pattern 'Placeholder gate question','Placeholder answer','Placeholder edit request'` → no match.
  8. **The owner's data is untouched:** `Get-ChildItem -LiteralPath data\claude -File | Select-Object Name, Length, LastWriteTime` equals `$before` for every file the owner's app does not itself write during the gate (compare names + sizes of `hub.sqlite` only if the owner's app is idle; the gate instance's own files are all under `$g`). `git status --short` shows no new or modified tracked file outside this task's docs.

Stop only your PIDs: `Stop-Process -Id $p.Id` (its Hub child exits when stdin closes; if `Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)"` still lists a `node.exe … hub.mjs … $g\hub.sqlite`, stop that PID too — never a Hub whose `--db` is the repo's `data\claude\hub.sqlite`). Then `Remove-Item -LiteralPath $g -Recurse -Force` and clear the env vars set above in this shell.

- [ ] **Step 3: Docs**
  - `README.md` test section: add `node --test dashboard/claude-chat.test.mjs dashboard/claude-chat.e2e.test.mjs dashboard/stream-parse.test.mjs` and `node dashboard-v5/tools/cdp-gate.mjs --port <port> --scenario claude-chat-stream-stop,claude-chat-mode-readonly` (against `dev-main.js --preload=fake`); in the env-override list add `HQ_CLAUDE_BIN` — "absolute path of the `claude` the in-app chat runs (tests and gates point it at `dashboard/__fixtures__` fake via `make-fake-claude.mjs`; never spend real quota in a test)".
  - `CLAUDE.md` "Facts": extend the Claude Hub line with `; in-app chat (H3): dashboard/claude-chat.js runs one claude -p stream-json turn per send (plan / acceptEdits only, never bypass; 1 per chat, 3 total, 10 min), IPC hq:claude-chat:{send,cancel,event}; tests/gates set HQ_CLAUDE_BIN to the fake shim (dashboard/__fixtures__/make-fake-claude.mjs)`.
  - Re-read the Task 6 IPC-CONTRACT rows against what the gate saw; fix any drift in this commit.
  - `docs/sync/HANDOFF.md`, new entry on top:

```markdown
## 2026-10-16 · FROM frontend (Claude Hub H3 — in-app chat, Claude Code engine) · main @ <short-sha>
DONE: Claude › Chats composer — New chat (WorkspaceHQ project or Claude Code folder), Continue (claude --resume),
  Read-only (plan) / Allow edits (acceptEdits), Send / Stop, "Uses your Claude quota" on every send, streaming text with
  collapsed tool rows; project-page "New chat" opens it. Engine dashboard/claude-chat.js (+ stream-parse.js parseEvents):
  one process per turn, prompt on stdin, cwd = project or Hub-recorded folder (deny list wins), launcher-safe tree stop,
  1 turn per chat / 3 total / 10 min. claude.ai "Continue in Claude Code" seeding is in the engine (unit-tested); its
  rows arrive with H4. Gate: fixture second instance + fake claude (no quota spent). Commits: <list the fe:/meta: shas of Tasks 1–11>.
IN-FLIGHT: none. The owner's app runs the H2 code until the controller restarts it (tools\rollback.ps1 v5).
ASKS: none.
BREAKS: none for the struct lane. main.js lines touched: 1 (the claude-chat init line after the claudeHub init line).
  New test override HQ_CLAUDE_BIN.
```

- [ ] **Step 4: Commit**

```bash
git add -- README.md CLAUDE.md docs/sync/HANDOFF.md docs/sync/IPC-CONTRACT.md
git commit -m "meta: Claude Hub H3 done — gate on a fixture second instance with the fake claude, docs, HANDOFF" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `IPC-CONTRACT.md` only if Step 3 changed it; `git add` of an unchanged file is a no-op.)

---

## Self-review (done while writing)

- **Spec coverage:** §8 argv + stdin + modes + never-bypass pin → Tasks 1, 4, 5; cwd rule (project path or Hub-recorded, deny list) → Tasks 1, 3; new vs continue (`--resume`, sessionId from init) → Tasks 3, 4 (deviation: `session` event); streaming (deltas, tool rows, result → done with usage) → Tasks 2, 4, 7; Stop = launcher-safe tree stop → Tasks 4, 5, 11; limits 1/chat, 3 total, 10 min → Task 4; claude.ai seeding (30 000 chars, header, trim shown) → Tasks 1, 3, 7, 8 (UI note; rows arrive with H4 — deviation); quota label → Tasks 8, 9, 10. §7 `claudeChat.send/cancel/on` → Task 6 (rows first). §9 composer (picker, mode switch, Send/Stop, quota, streams into the thread view), "New chat" on project pages → Tasks 8, 9. §11 fake shim, `claude-chat-stream-stop`, `claude-chat-mode-readonly`, real second instance → Tasks 5, 10, 11.
- **Placeholder scan:** no TBD/TODO; every code step carries the code; the only `<…>` markers are values the executor reads at run time (shas, hash constants computed by the given command, deltas).
- **Type consistency:** event kinds `session|delta|tool|done|error` and the `done` fields are identical in Task 4 (engine), Task 6 (contract rows, fake), Task 7 (reducer), Task 10 (CDP overrides). State keys `ccOpen, ccConv, ccProj, ccText, ccMode, ccTurn, ccSending` are identical in Tasks 8, 9 (`initState`), 10 (`CLEAR`, `fresh()`, finally blocks). `projectId` semantics (`code:` = Hub folder, else WorkspaceHQ id) match in Tasks 3, 6, 8.
- **Review Focus pins:** 1 → Task 1 `buildArgs`/`cwdRefusal` + Task 3 hostile-id test; 2 → Task 2 `parseEvents` tests; 3 → Task 4 Stop test + Task 5 `hang` e2e (+ gate check 5); 4 → Task 3 Desktop test; 5 → Task 4 limits + cap tests.

<!-- plan complete: 11 tasks -->
