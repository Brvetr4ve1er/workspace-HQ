# Claude Hub H4 — claude.ai export import + extension live sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner's claude.ai chats and Projects land in the same Claude Hub library as their Claude Code sessions — once in bulk from the official claude.ai data export (a `.zip` picked in WorkspaceHQ), and then incrementally from the WorkspaceHQ Bridge extension 0.4.0, which (only after the owner grants `https://claude.ai/*`) reads the owner's own claude.ai session with paced, read-only GETs and posts what changed to the local bridge. Web chats show a `claude.ai` badge in Chats and can be continued as a new Claude Code chat in a picked project.

**Architecture:** Everything that touches `hub.sqlite` stays in the Hub process: a dependency-free streaming ZIP reader (`unzip.mjs`, central directory + `zlib.createInflateRaw`, only `conversations.json`/`projects.json`, extracted into `data/claude/tmp/<job>/` and removed in `finally`), a streaming JSON-array splitter plus a defensive pure parser (`parse-web.mjs`), and an upsert path (`ingest-web.mjs`) keyed on `web:<uuid>` with `web_sync` de-dup and tombstone checks. Three new Hub ops (`importExport`, `syncState`, `syncPush`); the import job and pushes deliberately run OUTSIDE H1's `serial()` write queue, each item being one synchronous `store.tx` (reason in the Deviations and in Task 4). Main gets one new file, `dashboard/claude-import.js` (file dialog → `importExport`, IPC `hq:claude-hub:import`, and it hands the host to the new bridge-route module), hooked by ONE line in `main.js`. The HTTP bridge gets `GET /claude/sync-state` and `POST /claude/sync` in a new `dashboard/claude-bridge-routes.js`, hooked by ONE line in `browser-bridge.js`. The extension gets `claude-sync.js` (pure pacing/backoff/shape-check core + a thin chrome wrapper) and a popup section. The v5 renderer gains an import action (Chats + Settings), an import progress/report strip, and a project picker for "Continue in Claude Code" on claude.ai chats.

**Tech Stack:** Node ≥ 22.13 (`node:sqlite`, `node:zlib`, `node:test`) for the Hub; Electron 32 main (CommonJS, Node 20 — never imports `node:sqlite`); MV3 service worker (classic script, `importScripts`); v5 vanilla ES modules (dc-lite templates), no build step.

**Spec:** `docs/superpowers/specs/2026-10-13-claude-hub-design.md` — §5.2, §5.3, §6 (`importExport`, `syncState`, `syncPush`), §7 (`claudeHub.importExport`), §9 (web badge, Continue), §10 (extension honesty), §11 (bridge routes, `claude-import-progress`), §12 (H4 row), §13 (claude.ai request risk). Builds on the H1 code at HEAD and on the H2/H3 plans' spec'd interfaces (`docs/superpowers/plans/2026-10-15-claude-hub-h2.md`, `…-h3.md`).

---

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

H4-specific (decided here):
- Commit trailer for this plan: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — an executor on another model writes its own model name.
- **No new dependency.** `dashboard/package.json` has no ZIP library and the Hub runs on system Node outside Electron's `node_modules` resolution anyway, so the Hub gets a small dependency-free reader (`unzip.mjs`): central directory (incl. ZIP64), methods 0 (stored) and 8 (deflate) only, streams each wanted entry through `zlib.createInflateRaw` to disk, verifies size + CRC-32, caps output bytes. Only the basenames `conversations.json` and `projects.json` are ever extracted, each to a FIXED target name inside a fresh job folder — an entry's own path is never used as a filesystem path, so `../` and absolute names cannot escape.
- **No schema bump, no index bump.** `web_sync`, `project.source/key`, `conversation.title_source` and `TITLE_RANK.web` already exist (store.mjs at HEAD, schema v1 + H2's additions). `parse-code.mjs`/`redact.mjs` are not changed, so `INDEX_VERSION` stays where H2 left it. `resetCode()` deletes only `code:%` rows, so a Reindex keeps every imported web row (pinned in Task 3).
- **Ids.** Project `web:<project uuid>`; chats without a project go under ONE synthetic project `web:chats` named `claude.ai chats` (so the Projects tab, links and "Continue in Claude Code" have something to link). Conversation `web:<chat uuid>`. Message `web:<chat uuid>:<message uuid>` or `web:<chat uuid>:@<index>` when the message has no uuid. Tombstones use these full ids (H1 `forget` writes `tombstone('conversation', c.id)`), so a forgotten web chat is never re-imported by an export or a sync.
- **De-dup rule (`web_sync`).** `web_sync(kind, native_id=<uuid>, updated_at)` is written for every imported conversation/project, by BOTH the export and the sync. An incoming item whose `updated_at` is not newer than the stored one is `unchanged` (no write). A newer one replaces the conversation's messages (`resetConversation` then re-add — claude.ai edits/branches rewrite history) and keeps its project link: an incoming item WITHOUT a project uuid stays in the project it already has (it is only put under `web:chats` when it is new). An item with no parseable `updated_at` is imported only when nothing is stored for it.
- Text path: `maskSecrets(full text).text` → `cutText(…, TEXT_MAX)` (H2's surrogate-safe cut from `parse-code.mjs`; `TEXT_MAX = 200000`). Titles: mask → `cutText(…, 200)` → `setTitle(id, title, 'web')`.

Deviations from the spec, decided here (each with its reason):
- **`importExport` returns at once (`{started:true}`) and runs outside the Hub's `serial()` write queue (each item is one synchronous `store.tx`, so nothing interleaves inside an item; a long import does not block live Code ingest, `forget` or `syncPush` — H1's code-map note "new writers MUST use serial()" is deliberately not followed here, for that reason);** progress and the final report come as `progress` events with an additive `kind:'import'` field (`{kind:'import', phase:'unzip'|'projects'|'conversations'|'done'|'failed', done, total, report?, error?}`). Reason: §6 says imports have no timeout and use progress events, and H1's `store.js` turns ANY `progress` into the backfill bar — the `kind` field lets it tell them apart without changing backfill events. One import at a time; a second request while one runs answers `{error:'an import is already running'}`.
- **`health` gains `lastImport`** (the last report, from `meta.last_import`, or `null`) — additive, so the Chats strip can say "imported N chats on <date>" after a restart instead of forgetting it.
- **`syncState` returns uuids, not Hub ids** (`{conversations:{<uuid>:updated_at}, projects:{<uuid>:updated_at}, forgotten:[<uuid>]}`), because the extension compares against claude.ai's own list; `forgotten` lets it skip fetching chats the owner forgot.
- **The extension pushes one conversation per `POST /claude/sync`** (§5.3 "chunked by conversation"); a single conversation whose JSON exceeds 4 MB is not sent — the popup counts it ("1 chat too large for live sync — use the export") instead of truncating it silently.
- **Live sync works in batches of at most 20 changed chats per run, a run every 5 minutes while on** (plus the owner's "Sync claude.ai" click). Reason: ≤ 1 request / 2 s is binding, and the bulk history is the export's job; the popup shows "N left — next batch at HH:MM".
- **The claude.ai endpoints are claude.ai's own page requests** (observed, undocumented): `GET /api/organizations`, `GET /api/organizations/<org>/projects`, `GET /api/organizations/<org>/chat_conversations`, `GET /api/organizations/<org>/chat_conversations/<uuid>?tree=True&rendering_mode=messages&render_all_tools=true`. Every response is shape-checked; a mismatch pauses sync with "claude.ai changed, sync paused" until the owner clicks Sync again (§5.3, §13).
- **The extension unit tests live in `dashboard/claude-sync-ext.test.mjs`** (they `require('../browser-bridge/claude-sync.js')`) so they run in the existing `node --test dashboard/*.test.mjs` suite instead of adding a new suite path.

## Review Focus

The five input classes most likely to bite the owner — reviewers check these first:

1. **Export field variants.** Real exports differ by date: `uuid` vs `id`, `name` vs `title`, `chat_messages` vs `messages`, `sender:'human'|'assistant'` vs `role:'user'|'assistant'`, `text` vs a `content[]` of `text`/`tool_use`/`tool_result`/`thinking`/`image` blocks, attachments with `extracted_content`, a missing `updated_at`, a message with no uuid, a non-object row. All are imported or counted — never thrown, never a crash of the whole import — and the report holds counts and field NAMES only. *Pinned in Task 2 (`parseWebConversation` variant table + "report has no content" test) and Task 3 (import of the variant fixture).*
2. **The same chat arrives twice** — once in the export, then again (newer) from the extension, or the same export imported twice. No duplicate conversation or message; the newer version wins; an older or equal one is `unchanged`. *Pinned in Task 3 (store-level re-import + newer sync) and Task 4 (Hub: import twice → counts equal, then `syncPush` newer → message replaced).*
3. **A hostile or wrong ZIP.** Not a ZIP, a truncated ZIP, an entry named `../../evil/conversations.json`, a zip bomb (tiny compressed, huge inflated), an unsupported method, a ZIP with neither file. Nothing is written outside `data/claude/tmp/<job>/`, the job folder is always removed, and the owner gets an honest error. *Pinned in Task 1 (`unzip.test.mjs`) and Task 4 (Hub `importExport` on a bad zip → `phase:'failed'` and no leftover folder).*
4. **claude.ai throttles or changes.** 429/5xx → exponential backoff honouring `Retry-After`, never a tight loop, never more than one request per 2 s; a 200 with an unexpected shape pauses sync with a visible status until the owner acts; every request is a GET with no body to `https://claude.ai/api/`. *Pinned in Task 7 (`claude-sync-ext.test.mjs` with a fake clock and fake fetch).*
5. **Forget, then sync/re-import; Reindex after import.** A forgotten web chat or project never comes back from an export or a sync (`forgotten` count), and a Reindex (which wipes `code:%`) keeps every web row. *Pinned in Task 3 (tombstone + `resetCode` tests) and Task 4 (Hub: forget → `syncPush` → `forgotten:1`).*

---

## File structure (H4)

| File | Responsibility |
|---|---|
| `dashboard/claude-hub/unzip.mjs` (+ `unzip.test.mjs`) — new | `readZipIndex(file)`, `extractEntries(file, wanted, outDir, {maxBytes})` — streaming, ZIP64, stored/deflate, CRC check, byte cap, fixed target names |
| `dashboard/claude-hub/parse-web.mjs` (+ `parse-web.test.mjs`) — new | `streamJsonArray(file, onItem)` (byte scanner, one element at a time); pure `parseWebConversation(raw)`, `parseWebProject(raw)`, `newReport()`, `isoOrNull(v)` |
| `dashboard/claude-hub/ingest-web.mjs` (+ `ingest-web.test.mjs`) — new | `ingestWebProject`, `ingestWebConversation` (tombstones, `web_sync` de-dup, mask → cut), `importExportFile(store, zipPath, {tmpRoot, onProgress})` |
| `dashboard/claude-hub/store.mjs` (+ `store.test.mjs`) | `getSync`, `setSync`, `syncState()` (additive methods; no schema change) |
| `dashboard/claude-hub/hub.mjs` (+ `hub.test.mjs`) | ops `importExport`, `syncState`, `syncPush`; `health.lastImport`; import progress events |
| `dashboard/claude-hub/__fixtures__/make-export.mjs` — new | placeholder export JSON + runtime ZIP writer (`zipFiles`) for tests and the gate |
| `dashboard/claude-import.js` (+ `claude-import.test.mjs`) — new | `registerImport(ipcMain, host, {pickZip})`, `init({ipcMain, host, getWin})` (file dialog; hands the host to the bridge routes) |
| `dashboard/claude-bridge-routes.js` (+ `claude-bridge-routes.test.mjs`) — new | `handleRoute(req, res, {url, send, token})`, `setHub(host)`, `checkItems(body)`; 4 MB cap; same token rule as social |
| `dashboard/browser-bridge.js` | ONE line: `/claude/` prefix → `claudeRoutes.handleRoute` (+ its `require`) |
| `dashboard/main.js` | ONE line after the `claudeHub = require('./claude-hub-host').init(…)` line |
| `dashboard/preload.js` | `hq.claudeHub.importExport()` |
| `browser-bridge/claude-sync.js` — new, `background.js`, `manifest.json` (0.4.0), `popup.html`, `popup.js`, `popup.css`, `README.md` | paced read-only sync, status, on/off, permission on click |
| `dashboard/claude-sync-ext.test.mjs` — new | pacing, backoff, shape pause, GET-only, batch cap, 4 MB skip |
| `dashboard-v5/tools/fake-preload.js` (+ test) | `claudeHub.importExport` canned `{started:true}` |
| `dashboard-v5/src/live/adapter.mjs`, `live/store.js` (+ tests) | `importView`; `live.claudeImport`; import progress handling |
| `dashboard-v5/src/logic/claude-import.js` (+ `claude-import.test.mjs`) — new | mixin `claudeImportLogic.clImport()` |
| `dashboard-v5/src/logic/claude-chat.js` (H3 file) | web chats: picker + "Continue in Claude Code" label |
| `dashboard-v5/src/vals/claude-import.js` — new, `vals/index.js`, `vals/claude-chat.js` (H3) | render values |
| `dashboard-v5/src/tpl/claude.tpl.js`, `tpl/ov-settings.tpl.js` | marked markup |
| `dashboard-v5/src/selftest.js`, `src/vals.golden.test.mjs`, `src/__golden__/vals.hashes.json`, `src/tpl.hash.test.mjs`, `tools/cdp-gate.mjs` | combos, scenarios, re-records, CDP `claude-import-progress` |
| `docs/sync/IPC-CONTRACT.md`, `docs/sync/CONTRACT.md`, `README.md`, `docs/sync/HANDOFF.md` | rows before handlers, HTTP routes, data notes, test commands, handoff |

---
### Task 1: Dependency-free streaming ZIP reader (`unzip.mjs`, new) + runtime ZIP writer for tests

Closes Review Focus 3 (ZIP side).

**Files:**
- Create: `dashboard/claude-hub/unzip.mjs`, `dashboard/claude-hub/unzip.test.mjs`, `dashboard/claude-hub/__fixtures__/make-export.mjs`

**Interfaces:**
- Consumes: `node:zlib` (`createInflateRaw`, `crc32` — Node ≥ 22.2; the Hub requires ≥ 22.13), `node:stream/promises` `pipeline`.
- Produces (NEW):
  - `ZIP_MAX_BYTES = 4 * 1024 ** 3` — default cap on one inflated entry.
  - `readZipIndex(file) -> Promise<{ size, entries: [{ name, method, crc, csize, usize, offset, encrypted }] }>` — reads only the tail + central directory (ZIP64 end records and the ZIP64 extra field understood). Throws `'not a zip file'`, `'zip64 locator missing'`, `'zip64 record missing'`, `'truncated zip'`, `'bad central directory'`.
  - `baseName(entryName) -> string` — last segment after `/` or `\`.
  - `extractEntries(file, wanted: string[], outDir, { maxBytes = ZIP_MAX_BYTES } = {}) -> Promise<{ [wantedName]: absPath }>` — for each wanted basename (case-insensitive) the shortest matching entry path wins; streams it to `path.join(outDir, wantedName)` (FIXED name — the entry path is never used on disk; `flags:'wx'`); stored (0) or deflate (8) only; verifies inflated size and CRC-32. Throws `'<name> is encrypted'`, `'<name> uses an unsupported compression method (<n>)'`, `'<name> is larger than <maxBytes> bytes'`, `'<name>: size mismatch'`, `'<name>: checksum mismatch'`, `'bad local header for <name>'`, `'truncated zip'`. A wanted name with no entry is simply absent from the result (the caller writes the honest error).
  - `__fixtures__/make-export.mjs`: `zipFiles(file, files: [{ name, data: string|Buffer, method = 8, lieSize? }], { forceZip64 = false } = {}) -> void` — writes a ZIP at runtime (tests and the gate; nothing binary is committed).

- [ ] **Step 1: Write the failing test** — `dashboard/claude-hub/unzip.test.mjs`

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZipIndex, extractEntries, baseName } from './unzip.mjs';
import { zipFiles } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-unzip-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CONV = JSON.stringify([{ uuid: 'c-1', name: 'Placeholder chat', chat_messages: [] }]);
const PROJ = JSON.stringify([{ uuid: 'p-1', name: 'project-a' }]);
const fresh = (d) => fs.mkdtempSync(path.join(d, 'o'));

test('extracts the two wanted files (deflate + stored, nested folder) and ignores everything else', async () => {
  const d = tmp(), zip = path.join(d, 'export.zip'), out = fresh(d);
  zipFiles(zip, [{ name: 'export-2026/conversations.json', data: CONV }, { name: 'export-2026/projects.json', data: PROJ, method: 0 }, { name: 'export-2026/users.json', data: '[]' }]);
  const idx = await readZipIndex(zip);
  assert.deepEqual(idx.entries.map((e) => baseName(e.name)), ['conversations.json', 'projects.json', 'users.json']);
  const got = await extractEntries(zip, ['conversations.json', 'projects.json'], out);
  assert.equal(fs.readFileSync(got['conversations.json'], 'utf8'), CONV);
  assert.equal(fs.readFileSync(got['projects.json'], 'utf8'), PROJ);
  assert.deepEqual(fs.readdirSync(out).sort(), ['conversations.json', 'projects.json']);
});

test('ZIP64 end records are understood', async () => {
  const d = tmp(), zip = path.join(d, 'z64.zip');
  zipFiles(zip, [{ name: 'conversations.json', data: CONV }], { forceZip64: true });
  assert.equal((await readZipIndex(zip)).entries.length, 1);
  assert.equal(fs.readFileSync((await extractEntries(zip, ['conversations.json'], fresh(d)))['conversations.json'], 'utf8'), CONV);
});

test('an entry path with ../ or a drive never escapes: the file lands under its fixed name in outDir', async () => {
  const d = tmp(), zip = path.join(d, 'evil.zip'), out = path.join(d, 'a', 'b', 'out'); fs.mkdirSync(out, { recursive: true });
  zipFiles(zip, [{ name: '../../evil/conversations.json', data: CONV }, { name: 'C:/abs/projects.json', data: PROJ }]);
  const got = await extractEntries(zip, ['conversations.json', 'projects.json'], out);
  assert.equal(got['conversations.json'], path.join(out, 'conversations.json'));
  assert.equal(got['projects.json'], path.join(out, 'projects.json'));
  assert.equal(fs.existsSync(path.join(d, 'a', 'evil')), false);
  assert.equal(fs.existsSync(path.join(d, 'evil')), false);
});

test('not a zip, truncated zip, unsupported method, size lie, zip bomb', async () => {
  const d = tmp();
  const junk = path.join(d, 'junk.zip'); fs.writeFileSync(junk, 'this is not a zip');
  await assert.rejects(readZipIndex(junk), /not a zip file/);
  const good = path.join(d, 'good.zip'); zipFiles(good, [{ name: 'conversations.json', data: CONV.repeat(50) }]);
  const b = fs.readFileSync(good), cut = path.join(d, 'cut.zip');
  fs.writeFileSync(cut, Buffer.concat([b.subarray(0, 40), b.subarray(b.length - 22)]));
  await assert.rejects(extractEntries(cut, ['conversations.json'], fresh(d)), /truncated zip|bad central directory|bad local header/);
  const m12 = path.join(d, 'm12.zip'); zipFiles(m12, [{ name: 'conversations.json', data: CONV, method: 12 }]);
  await assert.rejects(extractEntries(m12, ['conversations.json'], fresh(d)), /unsupported compression method \(12\)/);
  const lie = path.join(d, 'lie.zip'); zipFiles(lie, [{ name: 'conversations.json', data: CONV, lieSize: 3 }]);
  await assert.rejects(extractEntries(lie, ['conversations.json'], fresh(d)), /size mismatch/);
  const bomb = path.join(d, 'bomb.zip'); zipFiles(bomb, [{ name: 'conversations.json', data: Buffer.alloc(8 * 1024 * 1024) }]);
  assert.ok(fs.statSync(bomb).size < 64 * 1024, 'the bomb is tiny on disk');
  await assert.rejects(extractEntries(bomb, ['conversations.json'], fresh(d), { maxBytes: 1024 * 1024 }), /larger than 1048576 bytes/);
});

test('a wanted file that is absent is simply missing from the result', async () => {
  const d = tmp(), zip = path.join(d, 'other.zip');
  zipFiles(zip, [{ name: 'users.json', data: '[]' }]);
  assert.deepEqual(await extractEntries(zip, ['conversations.json', 'projects.json'], fresh(d)), {});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test dashboard/claude-hub/unzip.test.mjs`
Expected: FAIL — `Cannot find module '…/unzip.mjs'` (and `…/__fixtures__/make-export.mjs`).

- [ ] **Step 3: Implement**

`dashboard/claude-hub/__fixtures__/make-export.mjs`:

```js
// Placeholder claude.ai export builder for tests and gates. Placeholder text only; ZIPs are written at runtime.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function zipFiles(file, files, { forceZip64 = false } = {}) {
  const parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const method = f.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw), usize = f.lieSize ?? raw.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(usize, 22); loc.writeUInt16LE(name.length, 26);
    parts.push(loc, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(usize, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cen), tail = [];
  if (forceZip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(files.length), 24); z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(off), 48);
    const l = Buffer.alloc(20);
    l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cd.length), 8); l.writeUInt32LE(1, 16);
    tail.push(z, l);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 8); e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 10);
  e.writeUInt32LE(forceZip64 ? 0xffffffff : cd.length, 12); e.writeUInt32LE(forceZip64 ? 0xffffffff : off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, ...tail, e]));
}
```

`dashboard/claude-hub/unzip.mjs`:

```js
// Minimal streaming ZIP reader for the claude.ai export (spec 2026-10-13 §5.2). No dependency: the Hub runs on system
// Node outside Electron's node_modules. Reads the central directory and streams ONLY the wanted entries to FIXED names
// inside outDir (an entry's own path never touches the filesystem); stored/deflate only; size + CRC verified; capped.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ZIP_MAX_BYTES = 4 * 1024 ** 3;
const EOCD = 0x06054b50, Z64LOC = 0x07064b50, Z64EOCD = 0x06064b50, CEN = 0x02014b50, LOC = 0x04034b50, MAX32 = 0xffffffff;

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(Math.max(0, len));
  const { bytesRead } = await fh.read(b, 0, b.length, pos);
  return b.subarray(0, bytesRead);
}

export const baseName = (n) => String(n).split(/[\\/]/).pop();

export async function readZipIndex(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { e = i; break; }
    if (e < 0) throw new Error('not a zip file');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === MAX32 || cdOff === MAX32) {
      const locPos = size - tailLen + e - 20;
      const loc = locPos >= 0 ? await readAt(fh, locPos, 20) : Buffer.alloc(0);
      if (loc.length < 20 || loc.readUInt32LE(0) !== Z64LOC) throw new Error('zip64 locator missing');
      const z = await readAt(fh, Number(loc.readBigUInt64LE(8)), 56);
      if (z.length < 56 || z.readUInt32LE(0) !== Z64EOCD) throw new Error('zip64 record missing');
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) throw new Error('truncated zip');
    const cd = await readAt(fh, cdOff, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN) throw new Error('bad central directory');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      if (p + 46 + nlen + xlen + clen > cd.length) throw new Error('bad central directory');
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      for (let x = p + 46 + nlen, end = x + xlen; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === MAX32 && q + 8 <= end) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === MAX32 && q + 8 <= end) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === MAX32 && q + 8 <= end) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, crc, csize, usize, offset, encrypted: !!(flags & 1) });
      p += 46 + nlen + xlen + clen;
    }
    return { size, entries };
  } finally { await fh.close(); }
}

export async function extractEntries(file, wanted, outDir, { maxBytes = ZIP_MAX_BYTES } = {}) {
  const { size, entries } = await readZipIndex(file);
  const out = {};
  for (const want of wanted) {
    const hits = entries.filter((x) => !x.name.endsWith('/') && baseName(x.name).toLowerCase() === want.toLowerCase());
    if (!hits.length) continue;
    const e = hits.sort((a, b) => a.name.length - b.name.length)[0];
    if (e.encrypted) throw new Error(want + ' is encrypted');
    if (e.method !== 0 && e.method !== 8) throw new Error(want + ' uses an unsupported compression method (' + e.method + ')');
    let start;
    const fh = await fsp.open(file, 'r');
    try {
      const loc = await readAt(fh, e.offset, 30);
      if (loc.length < 30 || loc.readUInt32LE(0) !== LOC) throw new Error('bad local header for ' + want);
      start = e.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
    } finally { await fh.close(); }
    if (start + e.csize > size) throw new Error('truncated zip');
    let n = 0, crc = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        n += chunk.length;
        if (n > maxBytes) { cb(new Error(want + ' is larger than ' + maxBytes + ' bytes')); return; }
        crc = zlib.crc32(chunk, crc); cb(null, chunk);
      },
    });
    const src = e.csize === 0 ? Readable.from([]) : fs.createReadStream(file, { start, end: start + e.csize - 1 });
    const target = path.join(outDir, want);
    await pipeline(src, ...(e.method === 8 && e.csize > 0 ? [zlib.createInflateRaw()] : []), meter, fs.createWriteStream(target, { flags: 'wx' }));
    if (n !== e.usize) throw new Error(want + ': size mismatch');
    if ((crc >>> 0) !== e.crc) throw new Error(want + ': checksum mismatch');
    out[want] = target;
  }
  return out;
}
```

(A partial target left by a failed entry is inside the job folder, which the caller removes in `finally` — Task 3.)

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test dashboard/claude-hub/unzip.test.mjs`
Expected: PASS (5 tests). Then `node --test dashboard/claude-hub/*.test.mjs` — all green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/unzip.mjs dashboard/claude-hub/unzip.test.mjs dashboard/claude-hub/__fixtures__/make-export.mjs
git commit -m "fe: Claude Hub H4 — dependency-free streaming ZIP reader for the claude.ai export (fixed target names, ZIP64, CRC, byte cap)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Streaming JSON-array splitter + defensive claude.ai parser (`parse-web.mjs`, new) + placeholder export fixture

Closes Review Focus 1 (parser side). `conversations.json` can be hundreds of MB — larger than V8's maximum string — so it is never read or parsed whole: a byte scanner hands out one top-level array element at a time.

**Files:**
- Create: `dashboard/claude-hub/parse-web.mjs`, `dashboard/claude-hub/parse-web.test.mjs`
- Modify: `dashboard/claude-hub/__fixtures__/make-export.mjs` (append `exportFixture`)

**Interfaces:**
- Consumes: `maskSecrets` (`redact.mjs`); `cutText(s, max)`, `TEXT_MAX`, `TOOL_RESULT_MAX` (`parse-code.mjs`; `cutText` is H2 Task 3's surrogate-safe cut).
- Produces (NEW, pure except `streamJsonArray`):
  - `streamJsonArray(file, onItem: async (value) => void, { maxItemBytes = 256 * 1024 * 1024 } = {}) -> Promise<{ items, bad, truncated }>` — skips a UTF-8 BOM; throws `'not a JSON array'` when the first token is not `[`, `'an item is larger than <n> bytes'` for an oversize element; an element that does not parse counts in `bad`; a file that ends before `]` returns `truncated: true` (elements before the cut were delivered).
  - `isoOrNull(v) -> string|null` — ISO string from an ISO/date string or epoch number (seconds when `< 1e12`, else ms); `null` when unparseable.
  - `newReport() -> { files:{conversations, projects}, conversations:{seen, imported, unchanged, forgotten, skipped}, messages:{imported, skipped, empty}, projects:{seen, imported, unchanged, forgotten, skipped}, unknownFields:{}, truncated:false }` — counts and field NAMES only.
  - `noteUnknown(report, names: string[])` — `unknownFields[name]++` for names matching `/^[A-Za-z0-9_:]{1,48}$/` (others count under `'(other)'`); at most 50 distinct names (the rest under `'(other)'`).
  - `parseWebConversation(raw) -> { ok:false, reason:'not-object'|'no-id' } | { ok:true, conv:{ uuid, title, projectUuid, model, createdAt, updatedAt, messages:[{ uuid, parentUuid, role:'user'|'assistant', at, text }] }, skipped, empty, unknown:[names] }` — accepts `uuid|id`, `name|title`, `chat_messages|messages`, `sender:'human'|'assistant'` or `role:'user'|'human'|'assistant'`, `text` or `content[]` (`text` kept; `tool_use` → `[tool: <name>]`; `tool_result` → masked, then cut to 2 KB; `image` → `[image]`; `document` → `[document]`; `thinking`/`redacted_thinking` dropped; other block types dropped and noted as `content:<type>`), `attachments[].file_name` / `files[].file_name` → `[attachment: <name>]` (the attachment's content is NOT indexed). Every text is `maskSecrets` on the full string, then `cutText(…, TEXT_MAX)`; titles mask → `cutText(…, 200)`. Uuids must match `/^[A-Za-z0-9-]{1,80}$/`.
  - `parseWebProject(raw) -> { ok:false, reason } | { ok:true, project:{ uuid, name, createdAt, updatedAt, docs }, unknown }` — `docs` is a COUNT; doc contents are never indexed.
  - `UUID_RE = /^[A-Za-z0-9-]{1,80}$/`.
  - `make-export.mjs`: `exportFixture() -> { conversations: any[], projects: any[] }` (placeholder variants listed in the test), `exportJson() -> { conversations: string, projects: string }`.

- [ ] **Step 1: Write the failing test** — `dashboard/claude-hub/parse-web.test.mjs`

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamJsonArray, parseWebConversation, parseWebProject, newReport, noteUnknown, isoOrNull } from './parse-web.mjs';
import { exportFixture } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-pweb-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('streamJsonArray: one element at a time, across tiny chunks, strings with brackets/escapes, BOM, bad and truncated', async () => {
  const d = tmp(), f = path.join(d, 'a.json');
  fs.writeFileSync(f, '﻿[ {"a":"x]}\\"{["}, [1,2] ,{"b":{"c":[3]}}, {bad json}, 7 ]');
  const got = [];
  const r = await streamJsonArray(f, async (v) => { got.push(v); });
  assert.deepEqual(got, [{ a: 'x]}"{[' }, [1, 2], { b: { c: [3] } }, 7]);
  assert.deepEqual(r, { items: 4, bad: 1, truncated: false });
  const t = path.join(d, 't.json'); fs.writeFileSync(t, '[{"a":1},{"b":');
  const got2 = []; const r2 = await streamJsonArray(t, async (v) => { got2.push(v); });
  assert.deepEqual(got2, [{ a: 1 }]); assert.equal(r2.truncated, true);
  const n = path.join(d, 'n.json'); fs.writeFileSync(n, '{"not":"an array"}');
  await assert.rejects(streamJsonArray(n, async () => {}), /not a JSON array/);
  const big = path.join(d, 'big.json'); fs.writeFileSync(big, '[{"x":"' + 'y'.repeat(5000) + '"}]');
  await assert.rejects(streamJsonArray(big, async () => {}, { maxItemBytes: 1000 }), /an item is larger than 1000 bytes/);
});

test('streamJsonArray: multibyte text split across 1 MB chunk boundaries survives (~1.5 MB file)', async () => {
  const d = tmp(), f = path.join(d, 'u.json');
  const items = Array.from({ length: 60000 }, (_, i) => ({ t: 'café 🚀 ' + i }));
  fs.writeFileSync(f, JSON.stringify(items));
  const got = []; await streamJsonArray(f, async (v) => { got.push(v); });
  assert.deepEqual(got, items);
});

test('isoOrNull: ISO, epoch seconds, epoch ms, junk', () => {
  assert.equal(isoOrNull('2026-10-01T09:00:00Z'), '2026-10-01T09:00:00.000Z');
  assert.equal(isoOrNull(1759309200), '2025-10-01T09:00:00.000Z');
  assert.equal(isoOrNull(1759309200000), '2025-10-01T09:00:00.000Z');
  assert.equal(isoOrNull('soon'), null); assert.equal(isoOrNull(null), null); assert.equal(isoOrNull({}), null);
});

test('parseWebConversation: the variant table', () => {
  const [modern, legacy, noProject, notObj, noId] = exportFixture().conversations;
  const a = parseWebConversation(modern);
  assert.equal(a.ok, true);
  assert.equal(a.conv.uuid, 'web-chat-1'); assert.equal(a.conv.title, 'Release planning (web)'); assert.equal(a.conv.projectUuid, 'web-proj-1');
  assert.equal(a.conv.updatedAt, '2026-10-01T09:10:00.000Z');
  assert.deepEqual(a.conv.messages.map((m) => [m.uuid, m.role, m.text]), [
    ['web-msg-1', 'user', 'Plan the release for project-a'],
    ['web-msg-2', 'assistant', 'Here is a release plan.\n[tool: web_search]'],
  ]);
  assert.equal(a.conv.messages[1].parentUuid, 'web-msg-1');
  const b = parseWebConversation(legacy);
  assert.equal(b.conv.uuid, 'web-chat-2'); assert.equal(b.conv.title, 'Café notes 🚀'); assert.equal(b.conv.updatedAt, null);
  assert.deepEqual(b.conv.messages.map((m) => [m.uuid, m.role, m.text]), [[null, 'user', 'Hello from example.org']]);
  assert.equal(b.conv.messages[0].at, '2025-10-01T09:00:00.000Z');
  assert.equal(b.skipped, 1);   // the non-object message
  assert.ok(b.unknown.includes('mystery_field'));
  const c = parseWebConversation(noProject);
  assert.equal(c.conv.projectUuid, null);
  assert.deepEqual(c.conv.messages.map((m) => m.text), ['[attachment: notes.txt]', 'Answer']);
  assert.ok(c.unknown.includes('content:widget'));
  assert.equal(c.empty, 1);     // the message with no text and nothing else
  assert.deepEqual(parseWebConversation(notObj), { ok: false, reason: 'not-object' });
  assert.deepEqual(parseWebConversation(noId), { ok: false, reason: 'no-id' });
  assert.deepEqual(parseWebConversation({ uuid: '../../x', name: 'n' }), { ok: false, reason: 'no-id' });
});

test('parseWebConversation: secrets are masked on the full text BEFORE the cut (tool result and plain text)', () => {
  const key = 'sk-ant-' + 'a'.repeat(30);
  const longPrefix = 'x'.repeat(2039) + ' ';   // a word boundary before the key, as the anthropic-key rule needs
  const r = parseWebConversation({ uuid: 'web-s', chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'my key ' + key },
    { uuid: 'm2', sender: 'assistant', content: [{ type: 'tool_result', content: [{ type: 'text', text: longPrefix + key }] }] },
  ] });
  for (const m of r.conv.messages) assert.ok(!m.text.includes('sk-ant-'), m.text.slice(-60));
  assert.match(r.conv.messages[0].text, /••• secret \(anthropic-key\)/);
});

test('parseWebProject + the report holds counts and field names only, never content', () => {
  const [p, noUuid] = exportFixture().projects;
  const r = parseWebProject(p);
  assert.deepEqual(r.project, { uuid: 'web-proj-1', name: 'project-a (claude.ai)', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', docs: 1 });
  assert.deepEqual(parseWebProject(noUuid), { ok: false, reason: 'no-id' });
  const rep = newReport();
  for (const c of exportFixture().conversations) { const x = parseWebConversation(c); if (x.ok) noteUnknown(rep, x.unknown); }
  noteUnknown(rep, ['has space', 'a'.repeat(60)]);
  const s = JSON.stringify(rep);
  for (const leak of ['example.org', 'Placeholder brief', 'Release planning', 'notes.txt', 'not indexed']) assert.ok(!s.includes(leak), leak);
  assert.equal(rep.unknownFields['(other)'], 2);
  for (let i = 0; i < 80; i++) noteUnknown(rep, ['f' + i]);
  assert.ok(Object.keys(rep.unknownFields).length <= 51);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test dashboard/claude-hub/parse-web.test.mjs`
Expected: FAIL — `Cannot find module '…/parse-web.mjs'` and `exportFixture` is not exported.

- [ ] **Step 3: Implement**

Append to `dashboard/claude-hub/__fixtures__/make-export.mjs`:

```js
// Placeholder claude.ai export rows covering the field variants seen across export generations.
export function exportFixture() {
  return {
    conversations: [
      { uuid: 'web-chat-1', name: 'Release planning (web)', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:10:00Z',
        project_uuid: 'web-proj-1', model: 'claude-placeholder',
        chat_messages: [
          { uuid: 'web-msg-1', sender: 'human', created_at: '2026-10-01T09:00:00Z', text: 'Plan the release for project-a', content: [{ type: 'text', text: 'Plan the release for project-a' }] },
          { uuid: 'web-msg-2', sender: 'assistant', created_at: '2026-10-01T09:01:00Z', parent_message_uuid: 'web-msg-1',
            content: [{ type: 'text', text: 'Here is a release plan.' }, { type: 'thinking', thinking: 'hidden reasoning' }, { type: 'tool_use', name: 'web_search', input: { query: 'example.org' } }] },
        ] },
      { id: 'web-chat-2', title: 'Café notes 🚀', create_time: 1759309200, mystery_field: { nested: 'placeholder' },
        messages: [{ role: 'user', create_time: 1759309200, text: 'Hello from example.org' }, 42] },
      { uuid: 'web-chat-3', name: '', created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:05:00Z',
        chat_messages: [
          { uuid: 'web-msg-3', sender: 'human', created_at: '2026-10-02T10:00:00Z', text: '', attachments: [{ file_name: 'notes.txt', extracted_content: 'attachment body, not indexed' }] },
          { uuid: 'web-msg-4', sender: 'assistant', created_at: '2026-10-02T10:01:00Z', content: [{ type: 'widget', data: 1 }, { type: 'text', text: 'Answer' }] },
          { uuid: 'web-msg-5', sender: 'assistant', created_at: '2026-10-02T10:02:00Z', text: '' },
        ] },
      'oops',
      { name: 'no id here', chat_messages: [] },
    ],
    projects: [
      { uuid: 'web-proj-1', name: 'project-a (claude.ai)', description: 'Placeholder', created_at: '2026-09-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
        docs: [{ filename: 'brief.md', content: 'Placeholder brief' }] },
      { name: 'no uuid' },
    ],
  };
}
export const exportJson = () => { const f = exportFixture(); return { conversations: JSON.stringify(f.conversations), projects: JSON.stringify(f.projects) }; };
```

(`web-chat-3`'s `web-msg-5` is the one `empty` message: no text, no blocks, no attachments.)

`dashboard/claude-hub/parse-web.mjs`:

```js
// claude.ai export / live-sync parser (spec 2026-10-13 §5.2–§5.3). The format is undocumented: accept known variants,
// count what is not understood (field NAMES only — never content), never throw on a row. Every text goes through
// maskSecrets on the FULL string before any cut (H1 ruling).
import fs from 'node:fs';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX, TOOL_RESULT_MAX } from './parse-code.mjs';

export const UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');
const safe = (s) => maskSecrets(String(s)).text;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const KNOWN_CONV = new Set(['uuid', 'id', 'name', 'title', 'summary', 'created_at', 'updated_at', 'create_time', 'update_time', 'account',
  'chat_messages', 'messages', 'project_uuid', 'project', 'project_id', 'model', 'settings', 'is_starred', 'is_temporary', 'current_leaf_message_uuid', 'platform']);
const KNOWN_MSG = new Set(['uuid', 'id', 'text', 'content', 'sender', 'role', 'created_at', 'updated_at', 'create_time', 'attachments', 'files', 'files_v2',
  'parent_message_uuid', 'parent', 'index', 'truncated', 'stop_reason', 'sync_sources', 'input_mode']);
const KNOWN_PROJ = new Set(['uuid', 'id', 'name', 'description', 'docs', 'created_at', 'updated_at', 'creator', 'is_private', 'is_starred',
  'is_starter_project', 'prompt_template', 'archived_at', 'permissions']);

export function isoOrNull(v) {
  let d = null;
  if (typeof v === 'number' && Number.isFinite(v)) d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim()) d = new Date(v);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

export function newReport() {
  return { files: { conversations: false, projects: false },
    conversations: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 },
    messages: { imported: 0, skipped: 0, empty: 0 },
    projects: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 },
    unknownFields: {}, truncated: false };
}

export function noteUnknown(report, names) {
  const u = report.unknownFields;
  for (const n of names || []) {
    const ok = typeof n === 'string' && /^[A-Za-z0-9_:]{1,48}$/.test(n) && (n in u || Object.keys(u).filter((k) => k !== '(other)').length < 50);
    const k = ok ? n : '(other)';
    u[k] = (u[k] || 0) + 1;
  }
}

const unknownOf = (o, known, prefix = '') => Object.keys(o).filter((k) => !known.has(k)).map((k) => prefix + k);
const uuidOf = (o) => { const u = typeof o.uuid === 'string' ? o.uuid : typeof o.id === 'string' ? o.id : ''; return UUID_RE.test(u) ? u : null; };

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : isObj(b) ? str(b.text) : '')).join('\n');
  return '';
}

function messageText(m, unknown) {
  const parts = [];
  if (Array.isArray(m.content) && m.content.length) {
    for (const b of m.content) {
      if (!isObj(b)) continue;
      if (b.type === 'text') parts.push(safe(str(b.text)));
      else if (b.type === 'tool_use') parts.push('[tool: ' + cutText(safe(str(b.name) || 'tool'), 80) + ']');
      else if (b.type === 'tool_result') parts.push(cutText(safe(resultText(b.content)), TOOL_RESULT_MAX));   // masked whole, then cut
      else if (b.type === 'image') parts.push('[image]');
      else if (b.type === 'document') parts.push('[document]');
      else if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
      else unknown.push('content:' + String(b.type || 'untyped'));
    }
  } else if (typeof m.text === 'string') parts.push(safe(m.text));
  for (const a of [...(Array.isArray(m.attachments) ? m.attachments : []), ...(Array.isArray(m.files) ? m.files : [])]) {
    if (isObj(a) && str(a.file_name)) parts.push('[attachment: ' + cutText(safe(a.file_name), 120) + ']');
  }
  return cutText(clean(parts.filter(Boolean).join('\n')).trim(), TEXT_MAX);
}

function roleOf(m) {
  const s = str(m.sender) || str(m.role);
  return s === 'human' || s === 'user' ? 'user' : s === 'assistant' ? 'assistant' : null;
}

export function parseWebConversation(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not-object' };
  const uuid = uuidOf(raw);
  if (!uuid) return { ok: false, reason: 'no-id' };
  const unknown = unknownOf(raw, KNOWN_CONV);
  const createdAt = isoOrNull(raw.created_at ?? raw.create_time);
  const list = Array.isArray(raw.chat_messages) ? raw.chat_messages : Array.isArray(raw.messages) ? raw.messages : [];
  if (!Array.isArray(raw.chat_messages) && !Array.isArray(raw.messages)) unknown.push('no-messages');
  const messages = [];
  let skipped = 0, empty = 0;
  for (const m of list) {
    if (!isObj(m)) { skipped++; continue; }
    unknown.push(...unknownOf(m, KNOWN_MSG, 'message:'));
    const role = roleOf(m);
    if (!role) { skipped++; unknown.push('sender:' + String(str(m.sender) || str(m.role) || 'none').slice(0, 20)); continue; }
    const text = messageText(m, unknown);
    if (!text) { empty++; continue; }
    const mu = uuidOf(m), parent = str(m.parent_message_uuid) || str(m.parent);
    messages.push({ uuid: mu, parentUuid: UUID_RE.test(parent) ? parent : null, role, at: isoOrNull(m.created_at ?? m.create_time ?? m.updated_at) || createdAt, text });
  }
  const projectUuid = [raw.project_uuid, isObj(raw.project) ? raw.project.uuid : null, raw.project_id].find((p) => typeof p === 'string' && UUID_RE.test(p)) || null;
  const title = cutText(clean(safe(str(raw.name) || str(raw.title))).trim(), 200);
  return { ok: true, skipped, empty, unknown,
    conv: { uuid, title, projectUuid, model: str(raw.model).slice(0, 80) || null, createdAt, updatedAt: isoOrNull(raw.updated_at ?? raw.update_time), messages } };
}

export function parseWebProject(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not-object' };
  const uuid = uuidOf(raw);
  if (!uuid) return { ok: false, reason: 'no-id' };
  return { ok: true, unknown: unknownOf(raw, KNOWN_PROJ, 'project:'),
    project: { uuid, name: cutText(clean(safe(str(raw.name))).trim(), 200) || 'claude.ai project', createdAt: isoOrNull(raw.created_at),
      updatedAt: isoOrNull(raw.updated_at), docs: Array.isArray(raw.docs) ? raw.docs.length : 0 } };
}

export async function streamJsonArray(file, onItem, { maxItemBytes = 256 * 1024 * 1024 } = {}) {
  let opened = false, closed = false, depth = 0, inStr = false, esc = false;
  let parts = null, from = -1, size = 0, items = 0, bad = 0;
  const begin = (i) => { parts = []; from = i; size = 0; };
  const finish = async (chunk, end) => {
    if (size + (end - from) > maxItemBytes) throw new Error('an item is larger than ' + maxItemBytes + ' bytes');
    parts.push(chunk.subarray(from, end));
    const buf = Buffer.concat(parts); parts = null; from = -1;
    let v;
    try { v = JSON.parse(buf.toString('utf8')); } catch { bad++; return; }
    items++; await onItem(v);
  };
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    if (parts) from = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inStr) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x22) inStr = false; continue; }
      if (!opened) {
        if (c === 0x5b) { opened = true; depth = 1; }
        else if (c > 0x20 && c !== 0xef && c !== 0xbb && c !== 0xbf) throw new Error('not a JSON array');
        continue;
      }
      if (closed) continue;
      if (c === 0x22) { if (!parts) begin(i); inStr = true; continue; }
      if (c === 0x7b || c === 0x5b) { if (!parts) begin(i); depth++; continue; }
      if (c === 0x7d || c === 0x5d) {
        if (depth === 1) { if (parts) await finish(chunk, i); closed = true; continue; }
        depth--;
        if (depth === 1 && parts) await finish(chunk, i + 1);
        continue;
      }
      if (depth === 1) {
        if (c === 0x2c) { if (parts) await finish(chunk, i); continue; }
        if (c <= 0x20) continue;
        if (!parts) begin(i);
      }
    }
    if (parts) {
      parts.push(chunk.subarray(from)); size += chunk.length - from;
      if (size > maxItemBytes) throw new Error('an item is larger than ' + maxItemBytes + ' bytes');
    }
  }
  if (!opened) throw new Error('not a JSON array');
  return { items, bad, truncated: !closed };
}
```

`size` counts the bytes of the current element carried across 1 MB chunk boundaries; `finish` adds the final piece, so the cap holds both for an element inside one chunk and for one spanning many.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test dashboard/claude-hub/parse-web.test.mjs`
Expected: PASS (6 tests). Then `node --test dashboard/claude-hub/*.test.mjs` — all green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/parse-web.mjs dashboard/claude-hub/parse-web.test.mjs dashboard/claude-hub/__fixtures__/make-export.mjs
git commit -m "fe: Claude Hub H4 — defensive claude.ai export parser + streaming JSON-array splitter (mask before cut, counts-only report)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store sync helpers + web ingest + the export import job (`store.mjs`, `ingest-web.mjs` new)

Closes Review Focus 1 (import side), 2 (store level), 3 (job folder cleanup), 5 (tombstones, Reindex keeps web rows).

**Files:**
- Modify: `dashboard/claude-hub/store.mjs` (api object: add four methods next to `isTombstoned`), `dashboard/claude-hub/store.test.mjs` (append one test)
- Create: `dashboard/claude-hub/ingest-web.mjs`, `dashboard/claude-hub/ingest-web.test.mjs`

**Interfaces:**
- Consumes: store H1/H2 methods `tx`, `upsertProject`, `ensureConversation`, `setTitle`, `addMessages`, `resetConversation`, `resetCode`, `isTombstoned`, `forget`, `listConversations`, `getConversation`, `counts`; Task 1 `extractEntries`; Task 2 `streamJsonArray`, `parseWebConversation`, `parseWebProject`, `newReport`, `noteUnknown`.
- Produces — store (NEW, additive, no schema change; `web_sync` exists since schema v1):
  - `getSync(kind, nativeId) -> { updated_at } | undefined`
  - `setSync(kind, nativeId, updatedAt|null)` — upsert.
  - `setProjectName(id, name)` — `UPDATE project SET name = ?, updated_at = <now> WHERE id = ?` (H1's `upsertProject` only renames when a path is given; web projects have none).
  - `syncState() -> { conversations: { [uuid]: updated_at|null }, projects: { [uuid]: updated_at|null }, forgotten: [uuid] }` — `forgotten` = conversation tombstones with ids `web:%`, prefix stripped.
- Produces — `ingest-web.mjs` (NEW):
  - `WEB_CHATS = 'web:chats'` (the synthetic project for chats with no claude.ai project; name `'claude.ai chats'`).
  - `ingestWebProject(store, project, report) -> 'imported'|'unchanged'|'forgotten'`
  - `ingestWebConversation(store, conv, report) -> 'imported'|'unchanged'|'forgotten'|'empty'` — tombstone (`conversation` id or its `project` id) → `forgotten`; `web_sync` not newer → `unchanged`; no messages → `empty` (`web_sync` stamped, no rows, counted `skipped`); else ONE `tx`: project row ensured, `resetConversation(id)`, `ensureConversation({source:'web'})`, `setTitle(id, title, 'web')` when non-empty, `addMessages`, `setSync`. Message `at` falls back to the chat's `updatedAt`/`createdAt`.
  - `importExportFile(store, zipPath, { tmpRoot, onProgress = () => {}, maxBytes } = {}) -> Promise<report>` — job folder `fs.mkdtempSync(path.join(tmpRoot, 'import-'))`, ALWAYS removed in `finally`; projects first, then conversations; `onProgress({phase, done, total})` with `phase` `'unzip'|'projects'|'conversations'` (`total: 0` = unknown — conversations are counted as they stream, no invented total); yields to the event loop every 200 rows; throws `'This ZIP has neither conversations.json nor projects.json — is it a claude.ai data export?'`.

- [ ] **Step 1: Write the failing tests**

Append to `dashboard/claude-hub/store.test.mjs`:

```js
test('web_sync helpers, setProjectName, syncState', () => {
  const s = openStore(':memory:');
  assert.equal(s.getSync('conversation', 'u1'), undefined);
  s.setSync('conversation', 'u1', '2026-10-01T00:00:00.000Z'); s.setSync('conversation', 'u1', '2026-10-02T00:00:00.000Z');
  s.setSync('conversation', 'u2', null); s.setSync('project', 'p1', '2026-09-01T00:00:00.000Z');
  assert.deepEqual(s.getSync('conversation', 'u1'), { updated_at: '2026-10-02T00:00:00.000Z' });
  s.upsertProject({ id: 'web:p1', source: 'web', key: 'p1', name: 'claude.ai project', path: null });
  s.setProjectName('web:p1', 'project-a (claude.ai)');
  assert.equal(s.listProjects({ source: 'web' })[0].name, 'project-a (claude.ai)');
  s.ensureConversation({ id: 'web:u3', source: 'web', projectId: 'web:p1', nativeId: 'u3' });
  s.addMessages('web:u3', [{ id: 'web:u3:m', role: 'user', at: '2026-10-01T00:00:00.000Z', text: 'hi' }]);
  s.forget({ conversationId: 'web:u3' });
  assert.deepEqual(s.syncState(), { conversations: { u1: '2026-10-02T00:00:00.000Z', u2: null }, projects: { p1: '2026-09-01T00:00:00.000Z' }, forgotten: ['u3'] });
  s.close();
});
```

`dashboard/claude-hub/ingest-web.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { importExportFile, ingestWebConversation, WEB_CHATS } from './ingest-web.mjs';
import { newReport } from './parse-web.mjs';
import { zipFiles, exportJson } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-iweb-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function fixtureZip(d) { const j = exportJson(), z = path.join(d, 'export.zip'); zipFiles(z, [{ name: 'data-2026/conversations.json', data: j.conversations }, { name: 'data-2026/projects.json', data: j.projects }]); return z; }

test('import: counts only, rows under web ids, synthetic project for chats without one, job folder removed', async () => {
  const d = tmp(), s = openStore(':memory:'), tmpRoot = path.join(d, 'tmp'), phases = [];
  const r = await importExportFile(s, fixtureZip(d), { tmpRoot, onProgress: (p) => phases.push(p.phase) });
  assert.deepEqual(r.conversations, { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 });
  assert.deepEqual(r.messages, { imported: 5, skipped: 1, empty: 1 });
  assert.deepEqual(r.projects, { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 });
  assert.deepEqual(r.files, { conversations: true, projects: true });
  assert.ok(phases.includes('unzip') && phases.includes('projects') && phases.includes('conversations'));
  const rows = s.listConversations({ source: 'web' });
  assert.deepEqual(rows.map((x) => x.id).sort(), ['web:web-chat-1', 'web:web-chat-2', 'web:web-chat-3']);
  const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.equal(byId['web:web-chat-1'].project_name, 'project-a (claude.ai)');
  assert.equal(byId['web:web-chat-1'].title, 'Release planning (web)');
  assert.equal(byId['web:web-chat-1'].title_source, 'web');
  assert.equal(byId['web:web-chat-2'].project_id, WEB_CHATS);
  assert.equal(byId['web:web-chat-2'].project_name, 'claude.ai chats');
  const msgs = s.getConversation({ id: 'web:web-chat-2' }).messages;
  assert.equal(msgs[0].id, 'web:web-chat-2:@0');
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'job folder removed');
  for (const leak of ['example.org', 'Placeholder brief', 'Plan the release']) assert.ok(!JSON.stringify(r).includes(leak), leak);
  s.close();
});

test('re-import is idempotent; a newer sync replaces the messages; an older one is unchanged', async () => {
  const d = tmp(), s = openStore(':memory:'), zip = fixtureZip(d), tmpRoot = path.join(d, 'tmp');
  await importExportFile(s, zip, { tmpRoot });
  const before = s.counts();
  const r2 = await importExportFile(s, zip, { tmpRoot });
  assert.deepEqual(r2.conversations, { seen: 5, imported: 0, unchanged: 3, forgotten: 0, skipped: 2 });
  assert.deepEqual(r2.projects.unchanged, 1);
  assert.deepEqual(s.counts(), before);
  const newer = { uuid: 'web-chat-1', title: 'Release planning (web)', projectUuid: 'web-proj-1', model: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-03T09:00:00.000Z',
    messages: [{ uuid: 'web-msg-9', parentUuid: null, role: 'user', at: '2026-10-03T09:00:00.000Z', text: 'Edited question' }] };
  assert.equal(ingestWebConversation(s, newer, newReport()), 'imported');
  assert.deepEqual(s.getConversation({ id: 'web:web-chat-1' }).messages.map((m) => m.text), ['Edited question']);
  assert.equal(ingestWebConversation(s, { ...newer, updatedAt: '2026-10-02T00:00:00.000Z', messages: [{ ...newer.messages[0], text: 'older' }] }, newReport()), 'unchanged');
  assert.equal(s.listConversations({ source: 'web' }).find((x) => x.id === 'web:web-chat-1').project_name, 'project-a (claude.ai)', 'link/project kept');
  const noProject = { ...newer, projectUuid: null, updatedAt: '2026-10-04T09:00:00.000Z' };
  assert.equal(ingestWebConversation(s, noProject, newReport()), 'imported');
  assert.equal(s.listConversations({ source: 'web' }).find((x) => x.id === 'web:web-chat-1').project_id, 'web:web-proj-1', 'a copy without a project uuid keeps the project');
  s.close();
});

test('forgotten web chats never come back; Reindex (resetCode) keeps every web row', async () => {
  const d = tmp(), s = openStore(':memory:'), zip = fixtureZip(d), tmpRoot = path.join(d, 'tmp');
  await importExportFile(s, zip, { tmpRoot });
  assert.equal(s.forget({ conversationId: 'web:web-chat-1' }), true);
  const r = await importExportFile(s, zip, { tmpRoot });
  assert.equal(r.conversations.forgotten, 1);
  assert.equal(s.getConversation({ id: 'web:web-chat-1' }), null);
  assert.deepEqual(s.syncState().forgotten, ['web-chat-1']);
  s.resetCode();
  assert.equal(s.listConversations({ source: 'web' }).length, 2);
  s.close();
});

test('a bad or wrong ZIP: honest error, nothing left in tmp', async () => {
  const d = tmp(), s = openStore(':memory:'), tmpRoot = path.join(d, 'tmp');
  const junk = path.join(d, 'junk.zip'); fs.writeFileSync(junk, 'nope');
  await assert.rejects(importExportFile(s, junk, { tmpRoot }), /not a zip file/);
  const other = path.join(d, 'other.zip'); zipFiles(other, [{ name: 'users.json', data: '[]' }]);
  await assert.rejects(importExportFile(s, other, { tmpRoot }), /neither conversations\.json nor projects\.json/);
  assert.deepEqual(fs.readdirSync(tmpRoot), []);
  assert.deepEqual(s.counts(), { projects: 0, conversations: 0, messages: 0 });
  s.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test dashboard/claude-hub/store.test.mjs dashboard/claude-hub/ingest-web.test.mjs`
Expected: FAIL — `s.getSync is not a function`; `Cannot find module '…/ingest-web.mjs'`.

- [ ] **Step 3: Implement**

`dashboard/claude-hub/store.mjs` — add to the object returned by `api(db)`, next to `isTombstoned` (uses the file's existing `q(sql)` prepare helper and `n(v)` null mapper):

```js
    getSync: (kind, nativeId) => q('SELECT updated_at FROM web_sync WHERE kind = ? AND native_id = ?').get(kind, nativeId),
    setSync: (kind, nativeId, updatedAt) => q(`INSERT INTO web_sync(kind, native_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(kind, native_id) DO UPDATE SET updated_at = excluded.updated_at`).run(kind, nativeId, n(updatedAt)),
    setProjectName: (id, name) => q('UPDATE project SET name = ?, updated_at = ? WHERE id = ?').run(String(name), new Date().toISOString(), id),
    syncState() {
      const map = (kind) => Object.fromEntries(q('SELECT native_id, updated_at FROM web_sync WHERE kind = ? ORDER BY native_id').all(kind).map((r) => [r.native_id, r.updated_at ?? null]));
      const forgotten = q("SELECT native_id FROM tombstone WHERE kind = 'conversation' AND native_id LIKE 'web:%' ORDER BY native_id").all().map((r) => r.native_id.slice(4));
      return { conversations: map('conversation'), projects: map('project'), forgotten };
    },
```

(`Object.fromEntries` over node:sqlite rows: rows are null-prototype objects; `r.native_id` reads fine. If `api(db)` names its prepare helper differently at the time you edit, use that helper — the code map lists `q(...)` at HEAD.)

`dashboard/claude-hub/ingest-web.mjs`:

```js
// claude.ai export import + live-sync upserts (spec 2026-10-13 §5.2–§5.3). Ids: project 'web:<uuid>' (chats without a
// project → WEB_CHATS), conversation 'web:<uuid>', message 'web:<uuid>:<message uuid|@index>'. web_sync de-dups both
// paths; tombstones (written by forget with the full ids) win over every import.
import fs from 'node:fs';
import path from 'node:path';
import { extractEntries } from './unzip.mjs';
import { streamJsonArray, parseWebConversation, parseWebProject, newReport, noteUnknown } from './parse-web.mjs';

export const WEB_CHATS = 'web:chats';
const notNewer = (prev, at) => !!prev && (!at || (!!prev.updated_at && prev.updated_at >= at));
const tick = () => new Promise((r) => setImmediate(r));

export function ingestWebProject(store, p, report) {
  const id = 'web:' + p.uuid;
  if (store.isTombstoned('project', id)) { report.projects.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('project', p.uuid), p.updatedAt)) { report.projects.unchanged++; return 'unchanged'; }
  store.tx(() => {
    store.upsertProject({ id, source: 'web', key: p.uuid, name: p.name, path: null });
    store.setProjectName(id, p.name);
    store.setSync('project', p.uuid, p.updatedAt);
  });
  report.projects.imported++;
  return 'imported';
}

export function ingestWebConversation(store, conv, report) {
  const id = 'web:' + conv.uuid;
  // No project uuid in this copy (exports and list rows often omit it) → keep the project the chat already has.
  const prev = conv.projectUuid ? null : store.db.prepare('SELECT project_id FROM conversation WHERE id = ?').get(id);
  const projectId = conv.projectUuid ? 'web:' + conv.projectUuid : (prev && prev.project_id) || WEB_CHATS;
  if (store.isTombstoned('conversation', id) || store.isTombstoned('project', projectId)) { report.conversations.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('conversation', conv.uuid), conv.updatedAt)) { report.conversations.unchanged++; return 'unchanged'; }
  if (!conv.messages.length) { store.setSync('conversation', conv.uuid, conv.updatedAt); report.conversations.skipped++; return 'empty'; }
  const fallback = conv.updatedAt || conv.createdAt || null;
  const msgs = conv.messages.map((m, i) => ({ id: id + ':' + (m.uuid || '@' + i), nativeId: m.uuid, parentId: m.parentUuid, role: m.role,
    at: m.at || fallback, text: m.text, toolName: null, isSidechain: false }));
  let added = 0;
  store.tx(() => {
    if (projectId === WEB_CHATS) store.upsertProject({ id: WEB_CHATS, source: 'web', key: 'chats', name: 'claude.ai chats', path: null });
    else store.upsertProject({ id: projectId, source: 'web', key: projectId.slice(4), name: 'claude.ai project', path: null });   // never renames an existing row (path null)
    store.resetConversation(id);   // replace: claude.ai edits and branches rewrite history; a no-op for a new chat
    store.ensureConversation({ id, source: 'web', projectId, nativeId: conv.uuid, cwd: null, gitBranch: null, model: conv.model });
    if (conv.title) store.setTitle(id, conv.title, 'web');
    added = store.addMessages(id, msgs);
    store.setSync('conversation', conv.uuid, conv.updatedAt);
  });
  report.conversations.imported++;
  report.messages.imported += added;
  report.messages.skipped += msgs.length - added;
  return 'imported';
}

export async function importExportFile(store, zipPath, { tmpRoot, onProgress = () => {}, maxBytes } = {}) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const job = fs.mkdtempSync(path.join(tmpRoot, 'import-'));
  const report = newReport();
  try {
    onProgress({ phase: 'unzip', done: 0, total: 0 });
    const got = await extractEntries(zipPath, ['conversations.json', 'projects.json'], job, maxBytes ? { maxBytes } : {});
    report.files = { conversations: !!got['conversations.json'], projects: !!got['projects.json'] };
    if (!report.files.conversations && !report.files.projects) throw new Error('This ZIP has neither conversations.json nor projects.json — is it a claude.ai data export?');
    let n = 0;
    if (got['projects.json']) {
      const r = await streamJsonArray(got['projects.json'], async (raw) => {
        report.projects.seen++;
        const p = parseWebProject(raw);
        if (!p.ok) { report.projects.skipped++; return; }
        noteUnknown(report, p.unknown);
        ingestWebProject(store, p.project, report);
        if (++n % 200 === 0) await tick();
      });
      report.projects.skipped += r.bad; if (r.truncated) report.truncated = true;
      onProgress({ phase: 'projects', done: report.projects.seen, total: report.projects.seen });
    }
    if (got['conversations.json']) {
      const r = await streamJsonArray(got['conversations.json'], async (raw) => {
        report.conversations.seen++;
        const c = parseWebConversation(raw);
        if (!c.ok) { report.conversations.skipped++; return; }
        noteUnknown(report, c.unknown);
        report.messages.skipped += c.skipped; report.messages.empty += c.empty;
        ingestWebConversation(store, c.conv, report);
        onProgress({ phase: 'conversations', done: report.conversations.seen, total: 0 });
        if (++n % 200 === 0) await tick();
      });
      report.conversations.skipped += r.bad; if (r.truncated) report.truncated = true;
    }
    return report;
  } finally {
    fs.rmSync(job, { recursive: true, force: true });
  }
}
```

Check against the first test: conversations `seen 5` = 3 parsed + `'oops'` (not-object) + the no-id row → `skipped 2`; messages `imported 5` (2 + 1 + 2), `skipped 1` (the `42`), `empty 1` (`web-msg-5`).

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test dashboard/claude-hub/store.test.mjs dashboard/claude-hub/ingest-web.test.mjs`
Expected: PASS. Then `node --test dashboard/claude-hub/*.test.mjs` — all green (H1/H2 ingest/store tests untouched: no schema or index change).

- [ ] **Step 5: Commit**

```bash
git add dashboard/claude-hub/store.mjs dashboard/claude-hub/store.test.mjs dashboard/claude-hub/ingest-web.mjs dashboard/claude-hub/ingest-web.test.mjs
git commit -m "fe: Claude Hub H4 — claude.ai import into the index (web ids, web_sync de-dup, tombstones win, job folder always removed)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hub ops `importExport`, `syncState`, `syncPush`; import progress events; `health.lastImport` (`hub.mjs`)

Closes Review Focus 2 and 5 (Hub level) and 3 (failed import leaves nothing behind).

**Files:**
- Modify first: `docs/sync/IPC-CONTRACT.md` (H4 section, two "gains" rows)
- Modify: `dashboard/claude-hub/hub.mjs` (imports :14-15; new helpers after `markChanged`; `ops` table)
- Test: `dashboard/claude-hub/hub.test.mjs` (append; uses the file's local `tmp`, `startHub`)

**Interfaces:**
- Consumes: Task 3 `importExportFile`, `ingestWebConversation`, `ingestWebProject`, store `syncState`, `setMeta/getMeta`; Task 2 `parseWebConversation`, `parseWebProject`, `newReport`, `noteUnknown`; hub.mjs `dbFile`, `store`, `writer`, `notOwner`, `emit`, `markChanged`, `msg`.
- Produces (Hub protocol, spec §6 names exactly):
  - `importExport({ zipPath }) -> { started: true }` — writer only (`'read-only hub (another WorkspaceHQ owns the index)'`); throws `'importExport needs an absolute .zip path'`, `'no such file: <basename>'`, `'an import is already running'`. The job runs after the answer; temp folder = `<dir of the db>/tmp` (= `data/claude/tmp` for the owner, the temp db's sibling in tests).
  - Event `progress` `{ kind:'import', phase:'unzip'|'projects'|'conversations'|'done'|'failed', done, total, report?, error? }` — ≤ 2/s, the `done`/`failed` one always sent. Backfill `progress` events are unchanged (no `kind`).
  - After a finished import: `meta.last_import = JSON {at, ok:true, report}` (or `{at, ok:false, error}`), and one `changed` `{ids: []}` (the library re-asks its lists).
  - `syncState() -> { conversations:{[uuid]:updated_at|null}, projects:{…}, forgotten:[uuid] }` (readers answer too; empty maps without a store).
  - `syncPush({ items: [{ kind:'conversation'|'project', data }] (1–50) }) -> report` (Task 2 `newReport` shape) — writer only; throws `'syncPush needs 1–50 items'`; `changed` with the imported conversation ids; `meta.last_sync_at` stamped.
  - `health()` gains `lastImport: {at, ok, report?, error?} | null` and `importing: boolean` (additive).
- Concurrency note (written as a comment in the code): import and push are NOT put through `serial()`. Every per-item write is one synchronous `store.tx`, and the tombstone check runs inside the same synchronous turn as the write, so a `forget` (itself one synchronous tx) can never interleave with an item; web ids never collide with `code:` ids, so Claude Code ingest is unaffected. Keeping the import out of the queue means live Code ingest, `forget` and `syncPush` are not blocked for the length of a large import.

- [ ] **Step 0: Contract rows first** — Task 4's `health` fields and `progress.kind` reach the renderer through the EXISTING `hq:claude-hub:health` / `hq:claude-hub:event` passthrough, so their rows land before this code. Append to `docs/sync/IPC-CONTRACT.md`:

```markdown
## 2026-10-16 — Claude Hub, phase H4 (rows written before the handler lands)

Additive only. Main-side code lives in the NEW file `dashboard/claude-import.js`, hooked by one line in `main.js`.

### Claude Hub claude.ai import (spec 2026-10-13-claude-hub-design.md §5.2, §7, phase H4)

| Preload | Channel | Shape |
|---|---|---|
| `claudeHub.on(cb)` | push `hq:claude-hub:event` | gains `progress` with `kind:'import'`: `{kind:'import', phase:'unzip'\|'projects'\|'conversations'\|'done'\|'failed', done, total, report?, error?}` — `total: 0` means "not known yet" (conversations are counted as they stream); `report` (on `done`) holds counts and field names only. A `progress` without `kind` is backfill progress, as before. A finished import also sends `changed` `{ids: []}` |
| `claudeHub.health()` | `hq:claude-hub:health` | gains `lastImport: {at, ok:true, report} \| {at, ok:false, error} \| null` and `importing: boolean` |
```

(Task 6 appends the `hq:claude-hub:import` row and the Hub-op note to this same section.)

- [ ] **Step 1: Write the failing test** — append to `dashboard/claude-hub/hub.test.mjs`

```js
import { zipFiles, exportJson } from './__fixtures__/make-export.mjs';

function exportZip(dir) {
  const j = exportJson(), z = path.join(dir, 'claude-export.zip');
  zipFiles(z, [{ name: 'conversations.json', data: j.conversations }, { name: 'projects.json', data: j.projects }]);
  return z;
}
const importDone = (h, n = 1) => h.until(() => h.events.filter((e) => e.event === 'progress' && e.data.kind === 'import' && ['done', 'failed'].includes(e.data.phase)).length >= n, 20000);
const lastImportEvent = (h) => h.events.filter((e) => e.event === 'progress' && e.data.kind === 'import').at(-1).data;

test('importExport: started at once, progress with kind import, report in health, idempotent, tmp cleaned (H4)', async () => {
  const dir = tmp('hub-imp-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'data', 'hub.sqlite'); fs.mkdirSync(path.dirname(db), { recursive: true });
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    await h.healthy();
    const zip = exportZip(dir);
    assert.deepEqual((await h.req('importExport', { zipPath: zip })).result, { started: true });
    assert.ok(await importDone(h));
    const ev = lastImportEvent(h);
    assert.equal(ev.phase, 'done'); assert.equal(ev.report.conversations.imported, 3);
    assert.ok(h.events.some((e) => e.event === 'progress' && e.data.kind === 'import' && e.data.phase === 'unzip'));
    const health = (await h.req('health')).result;
    assert.equal(health.lastImport.ok, true); assert.equal(health.lastImport.report.projects.imported, 1); assert.equal(health.importing, false);
    assert.equal((await h.req('listConversations', { source: 'web' })).result.length, 3);
    assert.equal(health.counts.conversations, 6, '3 Code + 3 claude.ai');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'data', 'tmp')), [], 'job folder removed');
    assert.ok(h.events.some((e) => e.event === 'changed' && Array.isArray(e.data.ids)));
    await h.req('importExport', { zipPath: zip });
    assert.ok(await importDone(h, 2));
    assert.equal(lastImportEvent(h).report.conversations.unchanged, 3);
    assert.equal((await h.req('health')).result.counts.conversations, 6);
  } finally { await h.stop(); }
});

test('importExport: bad input is refused or fails honestly, never leaves files (H4)', async () => {
  const dir = tmp('hub-impbad-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    await h.healthy();
    assert.match((await h.req('importExport', { zipPath: 'relative.zip' })).error, /absolute \.zip path/);
    assert.match((await h.req('importExport', { zipPath: path.join(dir, 'missing.zip') })).error, /no such file: missing\.zip/);
    const junk = path.join(dir, 'junk.zip'); fs.writeFileSync(junk, 'not a zip');
    assert.equal((await h.req('importExport', { zipPath: junk })).ok, true);
    assert.ok(await importDone(h));
    const ev = lastImportEvent(h);
    assert.equal(ev.phase, 'failed'); assert.match(ev.error, /not a zip file/);
    assert.equal((await h.req('health')).result.lastImport.ok, false);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  } finally { await h.stop(); }
});

test('syncState / syncPush: uuids, newer wins, forgotten stays forgotten, changed ids (H4)', async () => {
  const dir = tmp('hub-sync-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    await h.healthy();
    await h.req('importExport', { zipPath: exportZip(dir) }); assert.ok(await importDone(h));
    const st = (await h.req('syncState')).result;
    assert.equal(st.conversations['web-chat-1'], '2026-10-01T09:10:00.000Z'); assert.equal(st.projects['web-proj-1'], '2026-10-01T08:00:00.000Z');
    assert.equal((await h.req('forget', { conversationId: 'web:web-chat-1' })).result, true);
    const newer = (uuid, text) => ({ kind: 'conversation', data: { uuid, name: 'Synced ' + uuid, updated_at: '2026-10-05T09:00:00Z', chat_messages: [{ uuid: uuid + '-m', sender: 'human', created_at: '2026-10-05T09:00:00Z', text }] } });
    const r = (await h.req('syncPush', { items: [newer('web-chat-1', 'should stay forgotten'), newer('web-chat-3', 'synced text'), { kind: 'weird' }] })).result;
    assert.equal(r.conversations.forgotten, 1); assert.equal(r.conversations.imported, 1); assert.equal(r.conversations.skipped, 1);
    assert.deepEqual((await h.req('syncState')).result.forgotten, ['web-chat-1']);
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('web:web-chat-3'))));
    const conv = (await h.req('getConversation', { id: 'web:web-chat-3' })).result;
    assert.deepEqual(conv.messages.map((m) => m.text), ['synced text']);
    assert.match((await h.req('syncPush', { items: [] })).error, /1–50 items/);
  } finally { await h.stop(); }
});
```

(Put the `import { zipFiles, exportJson }` line with the other imports at the top of the file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: FAIL — the three new tests: `unknown op` for `importExport` / `syncState` / `syncPush`.

- [ ] **Step 3: Implement** — `dashboard/claude-hub/hub.mjs`

Imports (next to the `ingest-code.mjs` import):

```js
import { importExportFile, ingestWebConversation, ingestWebProject } from './ingest-web.mjs';
import { parseWebConversation, parseWebProject, newReport, noteUnknown } from './parse-web.mjs';
```

After `markChanged`:

```js
  // ---- claude.ai (H4). Not routed through serial(): each item is ONE synchronous store.tx with its tombstone check in
  // the same turn, so forget (also one synchronous tx) cannot interleave with an item, and web ids never collide with
  // code: ids. Keeping a long import out of the queue keeps live Code ingest, forget and syncPush responsive.
  let importing = false, importEmitAt = 0;
  const emitImport = (p, force = false) => {
    const now = Date.now();
    if (force || now - importEmitAt > 500) { importEmitAt = now; emit('progress', { kind: 'import', ...p }); }
  };
  const lastImport = () => { try { return JSON.parse((store && store.getMeta('last_import')) || 'null'); } catch { return null; } };
  function runImport(zipPath) {
    importing = true;
    const tmpRoot = path.join(path.dirname(path.resolve(dbFile)), 'tmp');
    importExportFile(store, zipPath, { tmpRoot, onProgress: (p) => emitImport(p) })
      .then((report) => {
        store.setMeta('last_import', JSON.stringify({ at: new Date().toISOString(), ok: true, report }));
        emitImport({ phase: 'done', done: report.conversations.seen, total: report.conversations.seen, report }, true);
        markChanged([]);
      }, (e) => {
        const error = msg(e);
        try { store.setMeta('last_import', JSON.stringify({ at: new Date().toISOString(), ok: false, error })); } catch { /* the event still carries it */ }
        emitImport({ phase: 'failed', done: 0, total: 0, error }, true);
      })
      .finally(() => { importing = false; });
  }
  function pushItems(items) {
    const report = newReport(), ids = [];
    for (const it of items) {
      if (it && it.kind === 'project') {
        report.projects.seen++;
        const p = parseWebProject(it.data);
        if (!p.ok) { report.projects.skipped++; continue; }
        noteUnknown(report, p.unknown); ingestWebProject(store, p.project, report);
      } else if (it && it.kind === 'conversation') {
        report.conversations.seen++;
        const c = parseWebConversation(it.data);
        if (!c.ok) { report.conversations.skipped++; continue; }
        noteUnknown(report, c.unknown); report.messages.skipped += c.skipped; report.messages.empty += c.empty;
        if (ingestWebConversation(store, c.conv, report) === 'imported') ids.push('web:' + c.conv.uuid);
      } else report.conversations.skipped++;
    }
    store.setMeta('last_sync_at', new Date().toISOString());
    if (ids.length) markChanged(ids);
    return report;
  }
```

In `ops`, extend `health` with `lastImport: lastImport(), importing,` and add:

```js
    importExport: (a) => {
      if (!writer) notOwner();
      const zipPath = a && typeof a.zipPath === 'string' ? a.zipPath : '';
      if (!zipPath || !path.isAbsolute(zipPath) || !/\.zip$/i.test(zipPath)) throw new Error('importExport needs an absolute .zip path');
      if (!fs.existsSync(zipPath)) throw new Error('no such file: ' + path.basename(zipPath));
      if (importing) throw new Error('an import is already running');
      runImport(zipPath);
      return { started: true };
    },
    syncState: () => (store ? store.syncState() : { conversations: {}, projects: {}, forgotten: [] }),
    syncPush: (a) => {
      if (!writer) notOwner();
      const items = a && Array.isArray(a.items) ? a.items : [];
      if (!items.length || items.length > 50) throw new Error('syncPush needs 1–50 items');
      return pushItems(items);
    },
```

(`emit`, `msg`, `markChanged`, `notOwner`, `store`, `writer`, `dbFile` are the names at HEAD — code map §2; `fs`/`path` are already imported.)

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test dashboard/claude-hub/hub.test.mjs`
Expected: PASS (all old tests + 3 new). Then `node --test dashboard/claude-hub/*.test.mjs` — all green.

- [ ] **Step 5: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md dashboard/claude-hub/hub.mjs dashboard/claude-hub/hub.test.mjs
git commit -m "fe: Claude Hub H4 — Hub ops importExport / syncState / syncPush, import progress (kind import), health.lastImport" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bridge routes `GET /claude/sync-state` + `POST /claude/sync` (`claude-bridge-routes.js`, new) — contract rows first

Spec §5.3 delivery + §11 "Bridge routes: token, size caps, schema checks, de-duplication" (de-dup itself is the Hub's, Task 4; here the route proves it passes items through unchanged and maps Hub answers to HTTP codes).

**Files:**
- Modify first: `docs/sync/CONTRACT.md` (new subsection after the `data/claude/` entry, CONTRACT.md:174-182)
- Create: `dashboard/claude-bridge-routes.js`, `dashboard/claude-bridge-routes.test.mjs`
- Modify: `dashboard/browser-bridge.js` (one `require` next to the social one; one hook line right after the `/social/` hook, browser-bridge.js:175)

**Interfaces:**
- Consumes: the Hub host object (`request(op, args, {timeout}) -> Promise<result | {error}>`, never rejects — code map §4), handed over by Task 6 via `setHub`; browser-bridge.js's `send(code, obj)`, `token`.
- Produces (NEW):
  - `MAX_SYNC_BODY = 4 * 1024 * 1024`, `MAX_ITEMS = 50`, `UUID_RE`.
  - `setHub(host|null)`, `getHub() -> host|null` — module-level slot (the bridge is started by main independently of the Hub host; this avoids changing `startBridge`'s signature or its main.js line).
  - `checkItems(body) -> { items } | { error }` — `body = { v: 1, items: [{ kind:'conversation'|'project', data:{ uuid, … } }] }`, 1–50 items, `data.uuid` matches `UUID_RE`, a conversation's `data.chat_messages` is an array; returns items reduced to `{kind, data}`.
  - `handleRoute(req, res, { url, send, token }) -> boolean` — `false` for any url not starting `/claude/`; else answers and returns `true`. Auth line identical to social-bridge.js: `req.headers['x-hq-bridge'] === '1' && (!token || req.headers['x-hq-token'] === token)` → else 403 `{ok:false, error:'forbidden'}`. `GET /claude/sync-state` → 200 `{ok:true, conversations, projects, forgotten}` (Hub `syncState`, 10 s timeout). `POST /claude/sync` → `Content-Length` or streamed bytes > 4 MB → 413 `too big`; bad JSON → 400 `bad json`; schema → 400 `<reason>`; Hub `syncPush` (30 s timeout) → 200 `{ok:true, report}`; a `read-only hub…` answer → 409; any other Hub error (`hub not running`, `timeout`, …) → 503; no host yet → 503 `claude hub not ready`. Anything else under `/claude/` → 404.

- [ ] **Step 1: Contract rows first** — `docs/sync/CONTRACT.md`, append after the `data/claude/` entry:

```markdown
#### Local bridge routes — Claude Hub live sync (H4, 2026-10-16; `dashboard/claude-bridge-routes.js`)

Same server as `/ingest/*` and `/social/*` (`127.0.0.1:47821`), same auth: header `X-HQ-Bridge: 1` plus
`X-HQ-Token` when `data/.bridge-token` exists (403 otherwise). Only client: the WorkspaceHQ Bridge extension ≥ 0.4.0.

| Route | Body / answer |
|---|---|
| `GET /claude/sync-state` | → `{ok:true, conversations:{<claude.ai chat uuid>: updated_at\|null}, projects:{<project uuid>: updated_at\|null}, forgotten:[<chat uuid>]}` — the extension fetches only chats whose claude.ai `updated_at` is newer, and never a forgotten one |
| `POST /claude/sync` | `{v:1, items:[{kind:'conversation'\|'project', data:<claude.ai JSON as fetched>}]}`, 1–50 items, ≤ 4 MB per request (413), `data.uuid` = `[A-Za-z0-9-]{1,80}`, a conversation's `data.chat_messages` an array (400 with the reason otherwise) → `{ok:true, report}` (counts only: `conversations/projects {seen, imported, unchanged, forgotten, skipped}`, `messages {imported, skipped, empty}`, `unknownFields {name: count}`); 409 when this app's Hub is a read-only reader, 503 when the Hub is not running |

Stored as Hub rows `web:<uuid>` (`source='web'`), de-duplicated through `web_sync(kind, native_id=<uuid>, updated_at)`
— the same table the export import writes. A forgotten chat/project (tombstone) is never re-created.
```

- [ ] **Step 2: Write the failing test** — `dashboard/claude-bridge-routes.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { handleRoute, setHub, getHub, checkItems, MAX_SYNC_BODY } = require('./claude-bridge-routes.js');

const H = { 'x-hq-bridge': '1' };
async function call(method, url, { headers = H, body = null, token = '' } = {}) {
  let done; const p = new Promise((r) => { done = r; });
  const chunks = body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(chunks); req.method = method; req.headers = headers;
  const handled = handleRoute(req, {}, { url, token, send: (code, obj) => done({ code, obj }) });
  if (!handled) done({ code: null, obj: null });
  return { handled, ...(await p) };
}
function fakeHub(answers) { const calls = []; return { calls, request(op, args, o) { calls.push([op, args, o]); return Promise.resolve(typeof answers[op] === 'function' ? answers[op](args) : answers[op]); } }; }
const conv = (uuid, extra = {}) => ({ kind: 'conversation', data: { uuid, chat_messages: [], ...extra } });

test('other urls fall through; unknown /claude/ urls are 404', async () => {
  assert.equal((await call('GET', '/social/outbox')).handled, false);
  setHub(fakeHub({}));
  assert.equal((await call('GET', '/claude/nope')).code, 404);
});

test('auth: header required, token enforced when set', async () => {
  setHub(fakeHub({ syncState: { conversations: {}, projects: {}, forgotten: [] } }));
  assert.equal((await call('GET', '/claude/sync-state', { headers: {} })).code, 403);
  assert.equal((await call('GET', '/claude/sync-state', { headers: { ...H, 'x-hq-token': 'wrong' }, token: 'tok' })).code, 403);
  const ok = await call('GET', '/claude/sync-state', { headers: { ...H, 'x-hq-token': 'tok' }, token: 'tok' });
  assert.equal(ok.code, 200); assert.deepEqual(ok.obj, { ok: true, conversations: {}, projects: {}, forgotten: [] });
  assert.equal((await call('POST', '/claude/sync', { headers: {}, body: { v: 1, items: [conv('a')] } })).code, 403);
});

test('no Hub yet / Hub errors map to 503 and 409', async () => {
  setHub(null);
  assert.equal(getHub(), null);
  assert.equal((await call('GET', '/claude/sync-state')).code, 503);
  setHub(fakeHub({ syncState: { error: 'hub not running' }, syncPush: { error: 'read-only hub (another WorkspaceHQ owns the index)' } }));
  assert.equal((await call('GET', '/claude/sync-state')).code, 503);
  assert.equal((await call('POST', '/claude/sync', { body: { v: 1, items: [conv('a')] } })).code, 409);
  setHub(fakeHub({ syncPush: { error: 'timeout' } }));
  assert.equal((await call('POST', '/claude/sync', { body: { v: 1, items: [conv('a')] } })).code, 503);
});

test('size cap: Content-Length and streamed bytes over 4 MB are 413; bad JSON is 400', async () => {
  setHub(fakeHub({ syncPush: {} }));
  assert.equal(MAX_SYNC_BODY, 4 * 1024 * 1024);
  assert.equal((await call('POST', '/claude/sync', { headers: { ...H, 'content-length': String(MAX_SYNC_BODY + 1) }, body: '{}' })).code, 413);
  const big = Buffer.alloc(MAX_SYNC_BODY + 10, 0x20);
  assert.equal((await call('POST', '/claude/sync', { body: big })).code, 413);
  const bad = await call('POST', '/claude/sync', { body: '{nope' });
  assert.equal(bad.code, 400); assert.equal(bad.obj.error, 'bad json');
});

test('schema checks', () => {
  assert.match(checkItems([]).error, /object/);
  assert.match(checkItems({ items: [conv('a')] }).error, /version/);
  assert.match(checkItems({ v: 1, items: [] }).error, /1–50/);
  assert.match(checkItems({ v: 1, items: Array.from({ length: 51 }, (_, i) => conv('c' + i)) }).error, /1–50/);
  assert.match(checkItems({ v: 1, items: [{ kind: 'user', data: { uuid: 'a' } }] }).error, /item 0: kind/);
  assert.match(checkItems({ v: 1, items: [conv('../x')] }).error, /item 0: data\.uuid/);
  assert.match(checkItems({ v: 1, items: [{ kind: 'conversation', data: { uuid: 'a' } }] }).error, /chat_messages/);
  assert.deepEqual(checkItems({ v: 1, items: [{ kind: 'project', data: { uuid: 'p' }, extra: 1 }] }), { items: [{ kind: 'project', data: { uuid: 'p' } }] });
});

test('a good push reaches syncPush with the items unchanged and answers the report', async () => {
  const hub = fakeHub({ syncPush: { conversations: { seen: 1, imported: 1, unchanged: 0, forgotten: 0, skipped: 0 } } });
  setHub(hub);
  const items = [conv('web-chat-1', { name: 'Placeholder', updated_at: '2026-10-05T09:00:00Z' })];
  const r = await call('POST', '/claude/sync', { body: { v: 1, items } });
  assert.equal(r.code, 200); assert.equal(r.obj.ok, true); assert.equal(r.obj.report.conversations.imported, 1);
  assert.deepEqual(hub.calls[0], ['syncPush', { items }, { timeout: 30000 }]);
});

test('browser-bridge.js routes /claude/ through handleRoute', () => {
  const src = fs.readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
  assert.match(src, /require\('\.\/claude-bridge-routes'\)/);
  assert.match(src, /url\.startsWith\('\/claude\/'\) && claudeRoutes\.handleRoute\(req, res, \{ url, send, token \}\)/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test dashboard/claude-bridge-routes.test.mjs`
Expected: FAIL — `Cannot find module './claude-bridge-routes.js'`.

- [ ] **Step 4: Implement** — `dashboard/claude-bridge-routes.js`

```js
// Claude Hub H4 — local bridge routes for the extension's claude.ai live sync (spec 2026-10-13 §5.3, §11).
// Contract: docs/sync/CONTRACT.md "Local bridge routes — Claude Hub live sync". The Hub does the parsing, de-dup and
// tombstone checks; this module authenticates, caps, schema-checks and maps Hub answers to HTTP codes.
const MAX_SYNC_BODY = 4 * 1024 * 1024;
const MAX_ITEMS = 50;
const UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
let hub = null;

function setHub(h) { hub = h || null; }
function getHub() { return hub; }
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function checkItems(body) {
  if (!isObj(body)) return { error: 'body must be an object' };
  if (body.v !== 1) return { error: 'unsupported version (expected v:1)' };
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_ITEMS) return { error: 'items must hold 1–50 entries' };
  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    if (!isObj(it) || (it.kind !== 'conversation' && it.kind !== 'project')) return { error: 'item ' + i + ': kind must be conversation or project' };
    if (!isObj(it.data) || typeof it.data.uuid !== 'string' || !UUID_RE.test(it.data.uuid)) return { error: 'item ' + i + ': data.uuid missing or malformed' };
    if (it.kind === 'conversation' && !Array.isArray(it.data.chat_messages)) return { error: 'item ' + i + ': chat_messages must be an array' };
  }
  return { items: body.items.map((it) => ({ kind: it.kind, data: it.data })) };
}

// Answers only from 'end' (or 'error'): like browser-bridge.js's ingest path, an oversize body is drained and THEN
// answered 413 — never req.destroy() and never a reply while the extension is still sending (that wedged its queue).
function readBody(req, max, cb) {
  const chunks = []; let size = 0, over = false, done = false;
  const finish = (err, obj) => { if (!done) { done = true; cb(err, obj); } };
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { over = true; chunks.length = 0; return; }   // keep draining, keep nothing
    if (!over) chunks.push(c);
  });
  req.on('end', () => {
    if (over) { finish('too big'); return; }
    let obj;
    try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish('bad json'); return; }
    finish(null, obj);
  });
  req.on('error', () => finish('read error'));
}

const hubError = (r) => (r && typeof r === 'object' && typeof r.error === 'string' ? r.error : null);

function handleRoute(req, res, { url, send, token }) {
  if (!url.startsWith('/claude/')) return false;
  const authed = req.headers['x-hq-bridge'] === '1' && (!token || req.headers['x-hq-token'] === token);
  if (req.method === 'GET' && url === '/claude/sync-state') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    const h = getHub();
    if (!h) { send(503, { ok: false, error: 'claude hub not ready' }); return true; }
    h.request('syncState', {}, { timeout: 10000 }).then((r) => {
      const e = hubError(r);
      if (e) send(503, { ok: false, error: e.slice(0, 200) }); else send(200, { ok: true, ...r });
    });
    return true;
  }
  if (req.method === 'POST' && url === '/claude/sync') {
    if (!authed) { req.resume(); send(403, { ok: false, error: 'forbidden' }); return true; }
    if (Number(req.headers['content-length'] || 0) > MAX_SYNC_BODY) {   // drained, then answered from 'end'
      let answered = false; const once = () => { if (!answered) { answered = true; send(413, { ok: false, error: 'too big' }); } };
      req.on('end', once); req.on('error', once); req.resume(); return true;
    }
    readBody(req, MAX_SYNC_BODY, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: err }); return; }
      const c = checkItems(body);
      if (c.error) { send(400, { ok: false, error: c.error }); return; }
      const h = getHub();
      if (!h) { send(503, { ok: false, error: 'claude hub not ready' }); return; }
      h.request('syncPush', { items: c.items }, { timeout: 30000 }).then((r) => {
        const e = hubError(r);
        if (e) send(e.startsWith('read-only hub') ? 409 : 503, { ok: false, error: e.slice(0, 200) });
        else send(200, { ok: true, report: r });
      });
    });
    return true;
  }
  send(404, { ok: false, error: 'not found' });
  return true;
}

module.exports = { handleRoute, setHub, getHub, checkItems, MAX_SYNC_BODY, MAX_ITEMS, UUID_RE };
```

`dashboard/browser-bridge.js` — next to the existing `social` require at the top:

```js
const claudeRoutes = require('./claude-bridge-routes');   // Claude Hub H4: /claude/sync-state, /claude/sync
```

and directly after the `/social/` hook line (browser-bridge.js:175):

```js
    if (url.startsWith('/claude/') && claudeRoutes.handleRoute(req, res, { url, send, token })) return;
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test dashboard/claude-bridge-routes.test.mjs`
Expected: PASS (7 tests). Then `node --test dashboard/*.test.mjs` — all green (the bridge's own tests, if any, unaffected: `/claude/` was a 404 before and is now answered by the module).

- [ ] **Step 6: Commit**

```bash
git add docs/sync/CONTRACT.md dashboard/claude-bridge-routes.js dashboard/claude-bridge-routes.test.mjs dashboard/browser-bridge.js
git commit -m "fe: Claude Hub H4 — bridge routes GET /claude/sync-state + POST /claude/sync (token rule, 4 MB cap, schema checks) + CONTRACT rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: IPC `hq:claude-hub:import` — contract rows first, then `claude-import.js`, the main.js hook, preload, fake preload

**Files:**
- Modify first: `docs/sync/IPC-CONTRACT.md` (the H4 section Task 4 started), `docs/sync/CONTRACT.md` (`data/claude/` entry: additive note)
- Create: `dashboard/claude-import.js`, `dashboard/claude-import.test.mjs`
- Modify: `dashboard/main.js` (ONE line), `dashboard/preload.js` (`claudeHub` block), `dashboard-v5/tools/fake-preload.js` (`SPEC`), `dashboard-v5/tools/fake-preload.test.mjs` (one assertion)

**Interfaces:**
- Consumes: the host object from `claude-hub-host.js` (`request(op, args, {timeout})`, never rejects); Task 4 `importExport`; Task 5 `setHub`; Electron `dialog.showOpenDialog`; main.js `ipcMain`, `claudeHub`, `win` (all in scope at the `claudeHub = require('./claude-hub-host').init(…)` line inside `app.whenReady()`).
- Produces (NEW):
  - `registerImport(ipcMain, host, { pickZip: () => Promise<string|null> }) -> void` — handles `hq:claude-hub:import`: `pickZip()` → `null` ⇒ `{canceled:true}`; a non-absolute or non-`.zip` path ⇒ `{error:'pick a .zip file'}`; a throwing picker ⇒ `{error:'could not open the file dialog'}`; else `host.request('importExport', {zipPath})` ⇒ Hub error ⇒ `{error}`, success ⇒ `{started:true, file:<basename>}` (the full path never goes to the renderer).
  - `init({ ipcMain, host, getWin }) -> { registered: true }` — the picker is `dialog.showOpenDialog(win, {title:'Import claude.ai export', properties:['openFile'], filters:[{name:'claude.ai export (.zip)', extensions:['zip']}]})` (electron required lazily inside the picker), EXCEPT when env `HQ_CLAUDE_IMPORT_ZIP` is set (gates only: that absolute path is used, no dialog); calls `require('./claude-bridge-routes').setHub(host)`.
  - Preload: `hq.claudeHub.importExport() -> Promise<{started, file} | {canceled} | {error}>` (spec §7 name).
  - main.js line (after the `claudeHub = require('./claude-hub-host').init(…)` line; H3 added one line there too — put this one after it): `require('./claude-import').init({ ipcMain, host: claudeHub, getWin: () => win });   // Claude Hub H4: claude.ai export import + bridge sync routes`

- [ ] **Step 1: Contract rows first** — `docs/sync/IPC-CONTRACT.md`, add to the H4 section Task 4 started (as the FIRST row of its table, above the two `gains` rows), then the note below the table:

```markdown
| `claudeHub.importExport()` | `hq:claude-hub:import` (invoke) | opens a `.zip`-only file dialog in main, then asks the Hub to import it → `{started:true, file:<basename>}` \| `{canceled:true}` \| `{error}` (`'an import is already running'`, `'read-only hub (another WorkspaceHQ owns the index)'`, `'pick a .zip file'`, …). The full path never reaches the renderer. Env **`HQ_CLAUDE_IMPORT_ZIP=<abs .zip>`** (gates and second instances only) replaces the dialog |

Hub ops behind it (protocol, not IPC): `importExport({zipPath})` → `{started:true}`; `syncState()`; `syncPush({items})` —
the last two are reached only through the local bridge routes (CONTRACT.md "Local bridge routes — Claude Hub live sync").
claude.ai chats appear in every existing list/search/thread channel with `source:'web'`, ids `web:<uuid>`, `title_source:'web'`,
no `cwd`/`git_branch`/tokens (null — unknown, not zero).
```

`docs/sync/CONTRACT.md`, append to the `data/claude/` entry:

```markdown
(2026-10-16, H4, additive) claude.ai rows: `source='web'`, ids `web:<uuid>` (chats without a claude.ai project live under
the synthetic project `web:chats`, "claude.ai chats"); `web_sync` is now written (export + live sync de-dup);
`meta.last_import` (JSON `{at, ok, report|error}`) and `meta.last_sync_at`. `data/claude/tmp/import-*/` holds one
import's two extracted JSON files and is removed when that import ends (success or failure). No schema or index-version change.
```

- [ ] **Step 2: Write the failing tests**

`dashboard/claude-import.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerImport, init } = require('./claude-import.js');
const routes = require('./claude-bridge-routes.js');

function rig(pick, answer = { started: true }) {
  const handlers = new Map(), calls = [];
  const host = { request(op, args, o) { calls.push([op, args, o]); return Promise.resolve(answer); } };
  registerImport({ handle: (ch, fn) => handlers.set(ch, fn) }, host, { pickZip: pick });
  return { run: () => handlers.get('hq:claude-hub:import')({}), calls };
}

test('canceled dialog: no Hub call', async () => {
  const r = rig(async () => null);
  assert.deepEqual(await r.run(), { canceled: true }); assert.equal(r.calls.length, 0);
});

test('a picked zip goes to importExport; only the basename comes back', async () => {
  const r = rig(async () => 'C:\\placeholder\\exports\\claude-export.zip');
  assert.deepEqual(await r.run(), { started: true, file: 'claude-export.zip' });
  assert.deepEqual(r.calls, [['importExport', { zipPath: 'C:\\placeholder\\exports\\claude-export.zip' }, undefined]]);
});

test('Hub errors, wrong files and a broken dialog are honest errors', async () => {
  assert.deepEqual(await rig(async () => 'C:\\x\\e.zip', { error: 'an import is already running' }).run(), { error: 'an import is already running' });
  assert.deepEqual(await rig(async () => 'C:\\x\\notes.txt').run(), { error: 'pick a .zip file' });
  assert.deepEqual(await rig(async () => 'relative.zip').run(), { error: 'pick a .zip file' });
  assert.deepEqual(await rig(async () => { throw new Error('no window'); }).run(), { error: 'could not open the file dialog' });
});

test('init: HQ_CLAUDE_IMPORT_ZIP replaces the dialog (gates) and the bridge routes get the host', async () => {
  const prev = process.env.HQ_CLAUDE_IMPORT_ZIP;
  process.env.HQ_CLAUDE_IMPORT_ZIP = 'C:\\placeholder\\gate\\claude-export.zip';
  const handlers = new Map(), calls = [];
  const host = { request(op, args) { calls.push([op, args]); return Promise.resolve({ started: true }); } };
  try {
    assert.deepEqual(init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, host, getWin: () => null }), { registered: true });
    assert.equal(routes.getHub(), host);
    assert.deepEqual(await handlers.get('hq:claude-hub:import')({}), { started: true, file: 'claude-export.zip' });
    assert.equal(calls[0][1].zipPath, 'C:\\placeholder\\gate\\claude-export.zip');
  } finally {
    if (prev === undefined) delete process.env.HQ_CLAUDE_IMPORT_ZIP; else process.env.HQ_CLAUDE_IMPORT_ZIP = prev;
    routes.setHub(null);
  }
});

test('main.js hooks claude-import exactly once', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.equal(src.match(/require\('\.\/claude-import'\)\.init\(\{ ipcMain, host: claudeHub, getWin: \(\) => win \}\)/g).length, 1);
});
```

`dashboard-v5/tools/fake-preload.test.mjs` — append:

```js
test('claudeHub.importExport answers started with a basename (H4)', async () => {
  const { hq } = createFake();
  assert.deepEqual(await hq.claudeHub.importExport(), { started: true, file: 'claude-export.zip' });
});
```

(`createFake` is already imported by that file; the existing "exactly the real preload method paths" test fails until preload and fake both have the method.)

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test dashboard/claude-import.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: FAIL — `Cannot find module './claude-import.js'`; `hq.claudeHub.importExport is not a function`.

- [ ] **Step 4: Implement**

`dashboard/claude-import.js`:

```js
// Claude Hub H4 — claude.ai export import, main side (spec 2026-10-13 §5.2, §7). New file, one hook line in main.js.
// The dialog runs here; the Hub (system Node) unzips and imports. Only the file's basename goes back to the renderer.
const path = require('path');
const bridgeRoutes = require('./claude-bridge-routes');

function registerImport(ipcMain, host, { pickZip }) {
  ipcMain.handle('hq:claude-hub:import', async () => {
    let file;
    try { file = await pickZip(); } catch { return { error: 'could not open the file dialog' }; }
    if (!file) return { canceled: true };
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.zip$/i.test(file)) return { error: 'pick a .zip file' };
    const r = await host.request('importExport', { zipPath: file });
    if (r && typeof r.error === 'string') return { error: r.error };
    return { started: true, file: path.basename(file) };
  });
}

function dialogPicker(getWin) {
  return async () => {
    const { dialog } = require('electron');
    const opts = { title: 'Import claude.ai export', properties: ['openFile'], filters: [{ name: 'claude.ai export (.zip)', extensions: ['zip'] }] };
    const win = getWin && getWin();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r && !r.canceled && r.filePaths && r.filePaths[0] ? r.filePaths[0] : null;
  };
}

function init({ ipcMain, host, getWin }) {
  const gateZip = process.env.HQ_CLAUDE_IMPORT_ZIP;   // gates only: no dialog in a hidden second instance
  registerImport(ipcMain, host, { pickZip: gateZip ? async () => gateZip : dialogPicker(getWin) });
  bridgeRoutes.setHub(host);
  return { registered: true };
}

module.exports = { registerImport, init };
```

`dashboard/main.js` — exactly one new line, directly after the `claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog });` line (and after H3's `claude-chat` line if present; find both by text, line numbers move):

```js
    require('./claude-import').init({ ipcMain, host: claudeHub, getWin: () => win });   // Claude Hub H4: claude.ai export import + bridge sync routes
```

`dashboard/preload.js` — inside `claudeHub: { … }`, after the H2/H3 methods:

```js
    importExport: () => ipcRenderer.invoke('hq:claude-hub:import'),
```

`dashboard-v5/tools/fake-preload.js` — in `SPEC`, after the last `claudeHub.*` row:

```js
  ['claudeHub.importExport', () => ({ started: true, file: 'claude-export.zip' })],
```

and add `lastImport: null, importing: false` to the canned `claudeHub.health` answer object (realism for the CDP harness; goldens do not use the fake).

- [ ] **Step 5: Run them to verify they pass**

Run: `node --test dashboard/claude-import.test.mjs dashboard-v5/tools/fake-preload.test.mjs`
Expected: PASS. Then `node --test dashboard/*.test.mjs` and `node --test dashboard-v5/tools/*.test.mjs` — all green.

- [ ] **Step 6: Commit**

```bash
git add docs/sync/IPC-CONTRACT.md docs/sync/CONTRACT.md dashboard/claude-import.js dashboard/claude-import.test.mjs dashboard/main.js dashboard/preload.js dashboard-v5/tools/fake-preload.js dashboard-v5/tools/fake-preload.test.mjs
git commit -m "fe: Claude Hub H4 — hq:claude-hub:import (file dialog in main, basename only to the renderer), bridge routes get the Hub host; contract rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report: the one touched main.js line (the new `claude-import` hook after the Claude Hub host line).

---

### Task 7: Extension sync core — paced read-only claude.ai reader (`browser-bridge/claude-sync.js`, new)

Closes Review Focus 4. The core is plain functions with injected `fetch`/`sleep`/`now`, so node tests drive it with a fake clock; the chrome wrapper (`claudeSyncTick`) is wired in Task 8.

**Files:**
- Create: `browser-bridge/claude-sync.js`, `dashboard/claude-sync-ext.test.mjs`

**Interfaces:**
- Consumes: Task 5 routes (`GET /claude/sync-state` → `{ok, conversations, projects, forgotten}`, `POST /claude/sync` `{v:1, items}`); background.js `getCfg()` → `{endpoint, token, …}` (wrapper only).
- Produces (NEW; classic-script globals — every top-level name starts with `claude`/`CLAUDE_` because background.js, social.js and this file share one global scope, which a test pins; plus a CommonJS export for node tests):
  - Constants: `CLAUDE_ORIGIN = 'https://claude.ai'`, `CLAUDE_SYNC_ALARM = 'claude-sync'`, `CLAUDE_SYNC_PERIOD_MIN = 5`, `CLAUDE_MIN_GAP_MS = 2000`, `CLAUDE_BATCH = 20`, `CLAUDE_MAX_PUSH_BYTES = 4 * 1024 * 1024`, `CLAUDE_RETRIES = 4`, `CLAUDE_MAX_INLINE_WAIT_MS = 30000`, `CLAUDE_BACKOFF_MAX_MS = 600000`, `CLAUDE_UUID_RE`.
  - `claudeBackoffMs(attempt, retryAfter?) -> ms` — `Retry-After` seconds when given (capped 10 min), else `2000 · 2^(attempt+1)` (4 s, 8 s, 16 s, 32 s …, capped 10 min).
  - `claudeCreatePacer({ now, sleep, gapMs = CLAUDE_MIN_GAP_MS }) -> async wait()` — guarantees ≥ `gapMs` between the starts of two requests.
  - `claudeSyncErr(kind, message, retryIn = 0) -> Error` with `.kind ∈ 'signed-out'|'backoff'|'paused'|'offline'|'app'` and `.retryIn` (ms).
  - `claudeGet(d, path, shape) -> Promise<json|null>` — `d = { fetch, sleep, pace }`; ALWAYS `{ method:'GET', credentials:'include', headers:{Accept:'application/json'} }`, never a body; 401/403 → `signed-out`; 429/5xx → inline backoff while the wait is ≤ 30 s and attempts < 4, else `backoff` with `retryIn`; another non-2xx, non-JSON, or a body that fails `CLAUDE_SHAPES[shape]` → `paused` "claude.ai changed, sync paused (…)"; a 404 for one conversation (`shape === 'conv'`) → `null` (deleted between list and fetch).
  - `CLAUDE_SHAPES = { orgs, projects, list, conv }` — predicates (uuid strings matching `CLAUDE_UUID_RE`; `list` rows need a string `updated_at`; `conv` needs `chat_messages` array).
  - `claudeIsNewer(remote, local, known) -> boolean` — compares with `Date.parse`; unknown or unparseable → newer.
  - `claudeSyncRun(d) -> Promise<{ pushed, projects, left, tooBig, tooBigIds: {[uuid]: updated_at} }>` — `d = { fetch, sleep, pace, app:{ state(), push(bodyString) }, skip = {}, batch = CLAUDE_BATCH, maxPushBytes = CLAUDE_MAX_PUSH_BYTES }`; reads the app's sync state, the FIRST organization (stated in the popup), its projects (changed ones pushed in chunks of 25), the conversation list; picks changed, not forgotten, not `skip`ped (same `updated_at`) chats, newest first, at most `batch`; fetches each and pushes it alone (`{v:1, items:[{kind:'conversation', data}]}`); a body over `maxPushBytes` is not sent and lands in `tooBigIds`.
  - `claudeAppClient(cfg, fetchFn) -> { state(), push(body) }` — headers `Content-Type`, `X-HQ-Bridge: 1`, `X-HQ-Token` when set; a 409 → `app` "Another WorkspaceHQ window owns the Claude index — sync from that one."; other non-2xx or a network error → `app` "WorkspaceHQ is not reachable (…)".
  - `claudeSummary(r) -> string` — e.g. `'Synced 3 chats · 5 left — next batch in 5 min · 1 too large for live sync — use the export'`; `'Up to date'` when nothing moved.

- [ ] **Step 1: Write the failing test** — `dashboard/claude-sync-ext.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SRC = new URL('../browser-bridge/claude-sync.js', import.meta.url);
const X = require('../browser-bridge/claude-sync.js');

const resp = ({ status = 200, json, headers = {} } = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => { if (json === undefined) throw new Error('not json'); return json; } });
const ORG = [{ uuid: 'org-1' }];
const chat = (uuid, updated) => ({ uuid, name: 'Chat ' + uuid, updated_at: updated });
const full = (uuid) => ({ uuid, name: 'Chat ' + uuid, updated_at: '2026-10-05T09:00:00Z', chat_messages: [{ uuid: uuid + '-m', sender: 'human', text: 'placeholder' }] });

function rig({ list, projects = [], state = { conversations: {}, projects: {}, forgotten: [] }, override = () => null, skip, batch, maxPushBytes }) {
  let t = 0; const reqs = [], sleeps = [], pushes = [];
  const now = () => t;
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const fetch = async (url, o = {}) => {
    reqs.push({ url, method: o.method, body: o.body, credentials: o.credentials, at: t });
    t += 10;
    const forced = override(url, reqs.length); if (forced) return resp(forced);
    const p = new URL(url).pathname;
    if (p === '/api/organizations') return resp({ json: ORG });
    if (p.endsWith('/projects')) return resp({ json: projects });
    if (p.endsWith('/chat_conversations')) return resp({ json: list });
    const id = p.split('/').pop();
    return resp({ json: full(id) });
  };
  const app = { state: async () => state, push: async (body) => { pushes.push(JSON.parse(body)); return { ok: true }; } };
  const d = { fetch, sleep, pace: X.claudeCreatePacer({ now, sleep }), app, skip, batch, maxPushBytes };
  return { d, reqs, sleeps, pushes };
}

test('paced, GET-only, newest first; forgotten and unchanged chats are not fetched', async () => {
  const r = rig({ list: [chat('a', '2026-10-01T00:00:00Z'), chat('b', '2026-10-03T00:00:00Z'), chat('gone', '2026-10-04T00:00:00Z'), chat('same', '2026-10-02T00:00:00Z')],
    projects: [{ uuid: 'p1', name: 'project-a', updated_at: '2026-10-01T00:00:00Z' }],
    state: { conversations: { same: '2026-10-02T00:00:00.000Z' }, projects: {}, forgotten: ['gone'] } });
  const out = await X.claudeSyncRun(r.d);
  assert.deepEqual(out, { pushed: 2, projects: 1, left: 0, tooBig: 0, tooBigIds: {} });
  const claude = r.reqs.filter((q) => q.url.startsWith('https://claude.ai/'));
  assert.ok(claude.every((q) => q.method === 'GET' && q.body === undefined && q.credentials === 'include' && q.url.startsWith('https://claude.ai/api/')));
  assert.deepEqual(claude.map((q) => new URL(q.url).pathname.split('/').pop()), ['organizations', 'projects', 'chat_conversations', 'b', 'a']);
  for (let i = 1; i < claude.length; i++) assert.ok(claude[i].at - claude[i - 1].at >= 2000, 'at most one claude.ai request per 2 s');
  assert.deepEqual(r.pushes.map((p) => p.items.map((it) => it.kind + ':' + it.data.uuid)), [['project:p1'], ['conversation:b'], ['conversation:a']]);
  assert.ok(r.pushes.every((p) => p.v === 1));
});

test('429 honours Retry-After; 5xx backs off exponentially, then gives up with retryIn; long Retry-After is not slept inline', async () => {
  let n = 0;
  const a = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') && n++ === 0 ? { status: 429, headers: { 'retry-after': '5' } } : null) });
  await X.claudeSyncRun(a.d);
  assert.ok(a.sleeps.includes(5000));
  const b = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') ? { status: 503 } : null) });
  await assert.rejects(X.claudeSyncRun(b.d), (e) => e.kind === 'backoff' && e.retryIn === 32000);
  assert.deepEqual(b.sleeps.filter((s) => s >= 4000), [4000, 8000, 16000]);
  assert.equal(b.reqs.filter((q) => q.url.endsWith('/chat_conversations')).length, 4);
  const c = rig({ list: [], override: (u) => (u.endsWith('/chat_conversations') ? { status: 429, headers: { 'retry-after': '3600' } } : null) });
  await assert.rejects(X.claudeSyncRun(c.d), (e) => e.kind === 'backoff' && e.retryIn === 600000);
  assert.ok(!c.sleeps.some((s) => s > 30000), 'never sleeps minutes inside a service worker');
});

test('a shape change pauses with a visible message and pushes nothing', async () => {
  const r = rig({ list: { conversations: [] } });
  await assert.rejects(X.claudeSyncRun(r.d), (e) => e.kind === 'paused' && /claude\.ai changed, sync paused/.test(e.message));
  assert.equal(r.pushes.length, 0);
  const s = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], override: (u) => (u.includes('/chat_conversations/a') ? { json: { uuid: 'a', chat_messages: 'nope' } } : null) });
  await assert.rejects(X.claudeSyncRun(s.d), (e) => e.kind === 'paused');
  const t = rig({ list: [], override: (u) => (u.endsWith('/api/organizations') ? { status: 200 } : null) });   // not JSON
  await assert.rejects(X.claudeSyncRun(t.d), (e) => e.kind === 'paused');
});

test('signed out, deleted chat, batch cap, too-big chats remembered', async () => {
  const so = rig({ list: [], override: (u) => (u.endsWith('/api/organizations') ? { status: 401 } : null) });
  await assert.rejects(X.claudeSyncRun(so.d), (e) => e.kind === 'signed-out');
  const del = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], override: (u) => (u.includes('/chat_conversations/a') ? { status: 404 } : null) });
  assert.equal((await X.claudeSyncRun(del.d)).pushed, 0);
  const many = rig({ list: Array.from({ length: 25 }, (_, i) => chat('c' + i, '2026-10-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z')) });
  const out = await X.claudeSyncRun(many.d);
  assert.equal(out.pushed, 20); assert.equal(out.left, 5);
  assert.equal(many.pushes[0].items[0].data.uuid, 'c24', 'newest first');
  const big = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], maxPushBytes: 50 });
  const ob = await X.claudeSyncRun(big.d);
  assert.deepEqual([ob.pushed, ob.tooBig, ob.tooBigIds], [0, 1, { a: '2026-10-01T00:00:00Z' }]);
  const again = rig({ list: [chat('a', '2026-10-01T00:00:00Z')], maxPushBytes: 50, skip: ob.tooBigIds });
  await X.claudeSyncRun(again.d);
  assert.ok(!again.reqs.some((q) => q.url.includes('/chat_conversations/a')), 'a known too-big chat is not refetched until it changes');
  assert.match(X.claudeSummary({ pushed: 3, projects: 0, left: 5, tooBig: 1 }), /^Synced 3 chats · 5 left — next batch in 5 min · 1 too large for live sync — use the export$/);
  assert.equal(X.claudeSummary({ pushed: 0, projects: 0, left: 0, tooBig: 0 }), 'Up to date');
});

test('app client: bridge headers, token, 409 and offline are app errors', async () => {
  const seen = [];
  const f = async (url, o = {}) => { seen.push([url, o]); return url.endsWith('/claude/sync') ? resp({ status: 409, json: { ok: false } }) : resp({ json: { ok: true, conversations: {}, projects: {}, forgotten: [] } }); };
  const app = X.claudeAppClient({ endpoint: 'http://127.0.0.1:47821', token: 'tok' }, f);
  assert.deepEqual((await app.state()).forgotten, []);
  assert.equal(seen[0][1].headers['X-HQ-Bridge'], '1'); assert.equal(seen[0][1].headers['X-HQ-Token'], 'tok');
  await assert.rejects(app.push('{}'), (e) => e.kind === 'app' && /owns the Claude index/.test(e.message));
  const off = X.claudeAppClient({ endpoint: 'http://127.0.0.1:1', token: '' }, async () => { throw new Error('refused'); });
  await assert.rejects(off.state(), (e) => e.kind === 'app' && /not reachable/.test(e.message));
});

test('every top-level name is claude-prefixed (shared classic-script global scope)', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const names = [...src.matchAll(/^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.length > 5);
  for (const n of names) assert.match(n, /^(claude|CLAUDE_)/, n);
  assert.ok(!/\bmethod:\s*'(POST|PUT|PATCH|DELETE)'[^\n]*claude\.ai/i.test(src));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test dashboard/claude-sync-ext.test.mjs`
Expected: FAIL — `Cannot find module '../browser-bridge/claude-sync.js'`.

- [ ] **Step 3: Implement** — `browser-bridge/claude-sync.js`

```js
// CLAUDE SYNC (extension 0.4.0) — importScripts'd by background.js (classic SW); also require()d by node tests.
// Reads the owner's OWN claude.ai session with read-only GETs (claude.ai's page requests: observed, undocumented — they
// can change without notice), at most one request per 2 s, exponential backoff on 429/5xx, and a pause with a visible
// status when a response does not look as expected. Never writes to claude.ai. Results go to the local WorkspaceHQ
// bridge (POST /claude/sync). Every top-level name is claude-prefixed: this file shares one global scope with
// background.js and social.js.
const CLAUDE_ORIGIN = 'https://claude.ai';
const CLAUDE_SYNC_ALARM = 'claude-sync';
const CLAUDE_SYNC_PERIOD_MIN = 5;
const CLAUDE_MIN_GAP_MS = 2000;
const CLAUDE_BATCH = 20;
const CLAUDE_MAX_PUSH_BYTES = 4 * 1024 * 1024;
const CLAUDE_RETRIES = 4;
const CLAUDE_MAX_INLINE_WAIT_MS = 30000;
const CLAUDE_BACKOFF_MAX_MS = 600000;
const CLAUDE_UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
const claudeIsId = (x) => typeof x === 'string' && CLAUDE_UUID_RE.test(x);
const CLAUDE_SHAPES = {
  orgs: (j) => Array.isArray(j) && j.length > 0 && j.every((o) => o && claudeIsId(o.uuid)),
  projects: (j) => Array.isArray(j) && j.every((p) => p && claudeIsId(p.uuid)),
  list: (j) => Array.isArray(j) && j.every((c) => c && claudeIsId(c.uuid) && typeof c.updated_at === 'string'),
  conv: (j) => !!j && typeof j === 'object' && claudeIsId(j.uuid) && Array.isArray(j.chat_messages),
};

function claudeSyncErr(kind, message, retryIn = 0) { const e = new Error(message); e.kind = kind; e.retryIn = retryIn; return e; }

function claudeBackoffMs(attempt, retryAfter) {
  const ra = Number(retryAfter);
  if (retryAfter != null && Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, CLAUDE_BACKOFF_MAX_MS);
  return Math.min(CLAUDE_MIN_GAP_MS * 2 ** (attempt + 1), CLAUDE_BACKOFF_MAX_MS);
}

function claudeCreatePacer({ now, sleep, gapMs = CLAUDE_MIN_GAP_MS }) {
  let last = -Infinity;
  return async function claudePace() { const wait = last + gapMs - now(); if (wait > 0) await sleep(wait); last = now(); };
}

async function claudeGet(d, path, shape) {
  for (let attempt = 0; ; attempt++) {
    await d.pace();
    let r;
    try { r = await d.fetch(CLAUDE_ORIGIN + path, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }); }
    catch (e) { throw claudeSyncErr('offline', 'claude.ai did not answer (' + String((e && e.message) || e).slice(0, 80) + ')', claudeBackoffMs(attempt)); }
    if (r.status === 401 || r.status === 403) throw claudeSyncErr('signed-out', 'Log in to claude.ai in this browser, then press Sync claude.ai.');
    if (r.status === 429 || r.status >= 500) {
      const wait = claudeBackoffMs(attempt, r.headers.get('retry-after'));
      if (attempt >= CLAUDE_RETRIES - 1 || wait > CLAUDE_MAX_INLINE_WAIT_MS) {
        throw claudeSyncErr('backoff', 'claude.ai is limiting requests (HTTP ' + r.status + ') — trying again later.', wait);
      }
      await d.sleep(wait);
      continue;
    }
    if (r.status === 404 && shape === 'conv') return null;
    if (!r.ok) throw claudeSyncErr('paused', 'claude.ai changed, sync paused (HTTP ' + r.status + ' for ' + shape + ')');
    let j;
    try { j = await r.json(); } catch { throw claudeSyncErr('paused', 'claude.ai changed, sync paused (' + shape + ' is not JSON)'); }
    if (!CLAUDE_SHAPES[shape](j)) throw claudeSyncErr('paused', 'claude.ai changed, sync paused (' + shape + ' looks different)');
    return j;
  }
}

function claudeIsNewer(remote, local, known) {
  if (!known || local == null) return true;
  const a = Date.parse(remote), b = Date.parse(local);
  return Number.isNaN(a) || Number.isNaN(b) || a > b;
}

const claudeBytes = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : Buffer.byteLength(s, 'utf8'));

async function claudeSyncRun(d) {
  const batch = d.batch ?? CLAUDE_BATCH, maxPush = d.maxPushBytes ?? CLAUDE_MAX_PUSH_BYTES, skip = d.skip || {};
  const st = await d.app.state();
  const known = { c: st.conversations || {}, p: st.projects || {} };
  const forgotten = new Set(st.forgotten || []);
  const org = (await claudeGet(d, '/api/organizations', 'orgs'))[0].uuid;
  const base = '/api/organizations/' + org;
  const projects = (await claudeGet(d, base + '/projects', 'projects')).filter((p) => claudeIsNewer(p.updated_at, known.p[p.uuid], p.uuid in known.p));
  for (let i = 0; i < projects.length; i += 25) await d.app.push(JSON.stringify({ v: 1, items: projects.slice(i, i + 25).map((p) => ({ kind: 'project', data: p })) }));
  const list = await claudeGet(d, base + '/chat_conversations', 'list');
  const todo = list.filter((c) => !forgotten.has(c.uuid) && skip[c.uuid] !== c.updated_at && claudeIsNewer(c.updated_at, known.c[c.uuid], c.uuid in known.c))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const run = todo.slice(0, batch);
  const out = { pushed: 0, projects: projects.length, left: todo.length - run.length, tooBig: 0, tooBigIds: {} };
  for (const c of run) {
    const conv = await claudeGet(d, base + '/chat_conversations/' + c.uuid + '?tree=True&rendering_mode=messages&render_all_tools=true', 'conv');
    if (!conv) continue;
    const body = JSON.stringify({ v: 1, items: [{ kind: 'conversation', data: conv }] });
    if (claudeBytes(body) > maxPush) { out.tooBig++; out.tooBigIds[c.uuid] = c.updated_at; continue; }
    await d.app.push(body);
    out.pushed++;
  }
  return out;
}

function claudeAppClient(cfg, fetchFn) {
  const headers = { 'Content-Type': 'application/json', 'X-HQ-Bridge': '1', ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}) };
  const call = async (path, opts) => {
    let r;
    try { r = await fetchFn(cfg.endpoint + path, { ...opts, headers }); }
    catch (e) { throw claudeSyncErr('app', 'WorkspaceHQ is not reachable (' + String((e && e.message) || e).slice(0, 60) + ') — open the app.'); }
    if (r.status === 409) throw claudeSyncErr('app', 'Another WorkspaceHQ window owns the Claude index — sync from that one.');
    if (!r.ok) throw claudeSyncErr('app', 'WorkspaceHQ is not reachable (HTTP ' + r.status + ') — open the app.');
    return r.json();
  };
  return { state: () => call('/claude/sync-state', { method: 'GET' }), push: (body) => call('/claude/sync', { method: 'POST', body }) };
}

function claudeSummary(r) {
  const parts = [];
  if (r.pushed) parts.push('Synced ' + r.pushed + ' chat' + (r.pushed === 1 ? '' : 's'));
  if (r.projects) parts.push(r.projects + ' project' + (r.projects === 1 ? '' : 's') + ' updated');
  if (r.left) parts.push(r.left + ' left — next batch in ' + CLAUDE_SYNC_PERIOD_MIN + ' min');
  if (r.tooBig) parts.push(r.tooBig + ' too large for live sync — use the export');
  return parts.length ? parts.join(' · ') : 'Up to date';
}

if (typeof module === 'object' && module && module.exports) {
  module.exports = { CLAUDE_ORIGIN, CLAUDE_SYNC_ALARM, CLAUDE_SYNC_PERIOD_MIN, CLAUDE_MIN_GAP_MS, CLAUDE_BATCH, CLAUDE_MAX_PUSH_BYTES, CLAUDE_RETRIES,
    CLAUDE_SHAPES, claudeSyncErr, claudeBackoffMs, claudeCreatePacer, claudeGet, claudeIsNewer, claudeSyncRun, claudeAppClient, claudeSummary };
}
```

Check against the test's `claudeSummary` expectation `'Synced 3 chats · 5 left — next batch in 5 min · 1 too large for live sync — use the export'` (projects 0 → no projects part). The `org` uuid is shape-checked (`CLAUDE_UUID_RE`) before it is put in a path; chat uuids come from the shape-checked list.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test dashboard/claude-sync-ext.test.mjs`
Expected: PASS (6 tests). Then `node --test dashboard/*.test.mjs` — all green.

- [ ] **Step 5: Commit**

```bash
git add browser-bridge/claude-sync.js dashboard/claude-sync-ext.test.mjs
git commit -m "fe: WorkspaceHQ Bridge 0.4.0 core — paced read-only claude.ai sync (≤1 req/2 s, backoff, shape pause, batch of 20, 4 MB skip)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Extension 0.4.0 wiring — permission on click, on/off, status in the popup, alarm (`claude-sync.js` wrapper, `background.js`, `popup.*`, `manifest.json`, `README.md`)

Spec §5.3 permission + §10 extension honesty. Loading the new version is a manual owner action (`chrome://extensions` → reload "WorkspaceHQ Bridge") — say so in the README and the HANDOFF; no step here reloads it.

**Files:**
- Modify: `browser-bridge/claude-sync.js` (append the chrome wrapper above the `module.exports` guard), `browser-bridge/background.js` (importScripts, `bootstrap`, `onAlarm`, `onMessage`), `browser-bridge/popup.html` (new section), `browser-bridge/popup.js` (render + handlers), `browser-bridge/popup.css` (two rules), `browser-bridge/manifest.json` (0.4.0 + optional host), `browser-bridge/README.md` (new section)
- Test: `dashboard/claude-sync-ext.test.mjs` (append)

**Interfaces:**
- Consumes: Task 7 core; background.js `getCfg()`; `chrome.storage.local`, `chrome.alarms`, `chrome.permissions.contains`, `chrome.tabs.query`.
- Produces (NEW):
  - Storage key `hq_claude` = `{ on, status: 'off'|'idle'|'syncing'|'ok'|'no-permission'|'no-tab'|'signed-out'|'backoff'|'paused'|'offline'|'app', message, lastSyncAt, last, skip, nextAt, running }`.
  - `claudeGetState() -> Promise<state>`, `claudeSetState(patch) -> Promise<state>`, `claudeEnsureAlarm() -> Promise<void>` (alarm `claude-sync` every 5 min while on, cleared when off), `claudeSetOn(on, opts?) -> Promise<state>` (on: alarm + an immediate manual run; off: alarm cleared, status `off`).
  - `claudeSyncTick({ manual = false, sleep = claudeSleep, now = Date.now } = {}) -> Promise<state>` — does nothing while off; a `paused` sync waits for the owner (manual only); a backoff window (`nextAt`) is respected unless manual; a run marked `running` less than 10 min ago is not doubled; no permission → `no-permission`; no open `https://claude.ai/*` tab → `no-tab` (no request made); else `claudeSyncRun` → `ok` with `claudeSummary`, or the error's kind (`paused` for a shape change) with its message and `nextAt = now + retryIn`.
  - Runtime message `{ type: 'claude:set', on: boolean }` → `claudeSetOn(on)` (the popup's checkbox and its "Sync claude.ai" button, which sends `on: true` after the permission prompt).
  - manifest: `"version": "0.4.0"`, `optional_host_permissions` gains `"https://claude.ai/*"` (already covered by `https://*/*`; listed explicitly so the grant prompt names claude.ai).

- [ ] **Step 1: Write the failing test** — append to `dashboard/claude-sync-ext.test.mjs`

```js
import vm from 'node:vm';

function chromeFake({ on = true, granted = true, tabs = 1, state = {} } = {}) {
  const store = { hq_claude: { on, status: on ? 'idle' : 'off', ...state } }, alarms = new Map();
  return { store, alarms, chrome: {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } },
    alarms: { create: (n, o) => alarms.set(n, o), clear: async (n) => alarms.delete(n) },
    permissions: { contains: async () => granted },
    tabs: { query: async () => Array.from({ length: tabs }, () => ({ url: 'https://claude.ai/new' })) },
  } };
}
function loadTick(fake, fetchImpl) {
  const ctx = vm.createContext({ chrome: fake.chrome, fetch: fetchImpl, getCfg: async () => ({ endpoint: 'http://127.0.0.1:47821', token: '' }), setTimeout, TextEncoder, URL, console });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);
  return ctx;
}
const fastSleep = async () => {};
function fakeFetch(calls, { list = [] } = {}) {
  return async (url, o = {}) => {
    calls.push(url);
    const p = new URL(url).pathname;
    if (p === '/claude/sync-state') return resp({ json: { ok: true, conversations: {}, projects: {}, forgotten: [] } });
    if (p === '/claude/sync') return resp({ json: { ok: true, report: {} } });
    if (p === '/api/organizations') return resp({ json: ORG });
    if (p.endsWith('/projects')) return resp({ json: [] });
    if (p.endsWith('/chat_conversations')) return resp({ json: list });
    return resp({ json: full(p.split('/').pop()) });
  };
}

test('tick: off / no permission / no claude.ai tab never touch claude.ai', async () => {
  for (const [opts, status] of [[{ on: false }, 'off'], [{ granted: false }, 'no-permission'], [{ tabs: 0 }, 'no-tab']]) {
    const calls = [], fake = chromeFake(opts), ctx = loadTick(fake, fakeFetch(calls));
    const s = await ctx.claudeSyncTick({ sleep: fastSleep });
    assert.equal(s.status, status); assert.equal(calls.length, 0, status);
  }
});

test('tick: a good run records ok + summary + lastSyncAt; paused waits for a manual click; backoff window respected', async () => {
  const calls = [], fake = chromeFake(), ctx = loadTick(fake, fakeFetch(calls, { list: [chat('a', '2026-10-01T00:00:00Z')] }));
  const s = await ctx.claudeSyncTick({ sleep: fastSleep });
  assert.equal(s.status, 'ok'); assert.equal(s.message, 'Synced 1 chat'); assert.ok(s.lastSyncAt > 0); assert.equal(s.running, 0);
  const p = chromeFake({ state: { status: 'paused', message: 'claude.ai changed, sync paused (list looks different)' } }), pc = [];
  const pctx = loadTick(p, fakeFetch(pc));
  assert.equal((await pctx.claudeSyncTick({ sleep: fastSleep })).status, 'paused'); assert.equal(pc.length, 0);
  assert.equal((await pctx.claudeSyncTick({ manual: true, sleep: fastSleep })).status, 'ok');
  const b = chromeFake({ state: { status: 'backoff', nextAt: Date.now() + 60000 } }), bc = [];
  const bctx = loadTick(b, fakeFetch(bc));
  await bctx.claudeSyncTick({ sleep: fastSleep }); assert.equal(bc.length, 0);
});

test('tick: a shape change becomes a visible paused status', async () => {
  const calls = [], fake = chromeFake();
  const ctx = loadTick(fake, async (url) => { calls.push(url); return new URL(url).pathname === '/claude/sync-state' ? resp({ json: { conversations: {}, projects: {}, forgotten: [] } }) : resp({ json: { not: 'an array' } }); });
  const s = await ctx.claudeSyncTick({ sleep: fastSleep });
  assert.equal(s.status, 'paused'); assert.match(s.message, /claude\.ai changed, sync paused/);
});

test('claudeSetOn: alarm on/off', async () => {
  const fake = chromeFake({ on: false }), ctx = loadTick(fake, fakeFetch([]));
  await ctx.claudeSetOn(true, { sleep: fastSleep });
  assert.deepEqual(fake.alarms.get('claude-sync'), { periodInMinutes: 5 });
  const off = await ctx.claudeSetOn(false);
  assert.equal(off.status, 'off'); assert.equal(fake.alarms.has('claude-sync'), false);
});

test('manifest 0.4.0, background wiring, popup controls and the risk note', () => {
  const read = (f) => fs.readFileSync(new URL('../browser-bridge/' + f, import.meta.url), 'utf8');
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.version, '0.4.0'); assert.ok(m.optional_host_permissions.includes('https://claude.ai/*'));
  assert.ok(!m.host_permissions.some((h) => h.includes('claude.ai')), 'claude.ai stays optional, granted on the owner\'s click');
  const bg = read('background.js');
  assert.match(bg, /importScripts\('claude-sync\.js'\)/);
  assert.match(bg, /a\.name === CLAUDE_SYNC_ALARM\) claudeSyncTick\(\)/);
  assert.match(bg, /msg\.type === 'claude:set'/);
  const html = read('popup.html');
  for (const id of ['claude-on', 'claude-sync', 'claude-status', 'claude-last']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /not a public API/); assert.match(html, /export/);
  const pj = read('popup.js');
  assert.match(pj, /chrome\.permissions\.request\(\{ origins: \['https:\/\/claude\.ai\/\*'\] \}\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test dashboard/claude-sync-ext.test.mjs`
Expected: FAIL — `ctx.claudeSyncTick is not a function`; manifest version `0.3.0`.

- [ ] **Step 3: Implement**

`browser-bridge/claude-sync.js` — append ABOVE the `if (typeof module === 'object' …)` guard:

```js
// ---- chrome wrapper (service worker only; node tests run it in a vm with a fake chrome) -------------------------
const CLAUDE_PERM = { origins: ['https://claude.ai/*'] };
const CLAUDE_OFF_MSG = 'Off — nothing is read from claude.ai.';
const claudeSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claudeGetState() {
  const { hq_claude } = await chrome.storage.local.get('hq_claude');
  return { on: false, status: 'off', message: CLAUDE_OFF_MSG, lastSyncAt: 0, last: null, skip: {}, nextAt: 0, running: 0, ...(hq_claude || {}) };
}
async function claudeSetState(patch) {
  const s = { ...(await claudeGetState()), ...patch };
  await chrome.storage.local.set({ hq_claude: s });
  return s;
}
async function claudeEnsureAlarm() {
  const s = await claudeGetState();
  if (s.on) chrome.alarms.create(CLAUDE_SYNC_ALARM, { periodInMinutes: CLAUDE_SYNC_PERIOD_MIN });
  else await chrome.alarms.clear(CLAUDE_SYNC_ALARM);
}
async function claudeSetOn(on, opts = {}) {
  if (!on) {
    await chrome.alarms.clear(CLAUDE_SYNC_ALARM);
    return claudeSetState({ on: false, status: 'off', message: CLAUDE_OFF_MSG, running: 0, nextAt: 0 });
  }
  await claudeSetState({ on: true, status: 'idle', message: 'On — reading claude.ai…' });
  chrome.alarms.create(CLAUDE_SYNC_ALARM, { periodInMinutes: CLAUDE_SYNC_PERIOD_MIN });
  return claudeSyncTick({ ...opts, manual: true });
}
async function claudeSyncTick({ manual = false, sleep = claudeSleep, now = Date.now } = {}) {
  const s = await claudeGetState();
  if (!s.on) return s;
  if (s.status === 'paused' && !manual) return s;                          // a shape change waits for the owner
  if (!manual && s.nextAt && now() < s.nextAt) return s;                    // backoff window
  if (s.running && now() - s.running < 10 * 60 * 1000) return s;           // a run is already in flight
  if (!(await chrome.permissions.contains(CLAUDE_PERM))) return claudeSetState({ status: 'no-permission', message: 'Press "Sync claude.ai" to allow reading claude.ai.' });
  if (!(await chrome.tabs.query({ url: 'https://claude.ai/*' })).length) return claudeSetState({ status: 'no-tab', message: 'Open claude.ai in a tab (logged in) — sync runs only then.' });
  await claudeSetState({ status: 'syncing', running: now(), message: 'Reading claude.ai…' });
  try {
    const cfg = await getCfg();
    const r = await claudeSyncRun({ fetch: (u, o) => fetch(u, o), sleep, pace: claudeCreatePacer({ now, sleep }), app: claudeAppClient(cfg, (u, o) => fetch(u, o)), skip: s.skip || {} });
    return claudeSetState({ status: 'ok', running: 0, nextAt: 0, lastSyncAt: now(), last: r, skip: { ...(s.skip || {}), ...r.tooBigIds }, message: claudeSummary(r) });
  } catch (e) {
    const kind = (e && e.kind) || 'app';
    return claudeSetState({ status: kind, running: 0, message: String((e && e.message) || e).slice(0, 200), nextAt: e && e.retryIn ? now() + e.retryIn : 0 });
  }
}
```

`browser-bridge/background.js`:
- after `importScripts('social.js');` add: `importScripts('claude-sync.js');   // CLAUDE SYNC (0.4.0): paced read-only claude.ai → /claude/sync`
- inside `async function bootstrap()` add: `claudeEnsureAlarm().catch(() => {});`
- in `chrome.alarms.onAlarm.addListener`, after the social branch: `else if (a.name === CLAUDE_SYNC_ALARM) claudeSyncTick().catch(() => {});`
- in `chrome.runtime.onMessage.addListener`, before `return false;`: `if (msg && msg.type === 'claude:set') { claudeSetOn(!!msg.on).then(reply).catch((e) => reply({ status: 'app', message: String(e) })); return true; }`

`browser-bridge/manifest.json`: `"version": "0.4.0"`; `"optional_host_permissions": ["https://*/*", "https://claude.ai/*"]`; description gains ` Optionally reads your own claude.ai chats (read-only) into the app.`

`browser-bridge/popup.html` — a new section right after the `appr` section:

```html
  <section id="claude" class="blk">
    <div class="appr-head">
      <span class="k">claude.ai</span>
      <span class="grow"></span>
      <label class="mini" title="Turn claude.ai live sync on or off"><input type="checkbox" id="claude-on" /> on</label>
      <button id="claude-sync" class="mini" title="Allow reading claude.ai (asked once) and sync now — read-only">Sync claude.ai</button>
    </div>
    <div id="claude-status" class="m" role="status">Off — nothing is read from claude.ai.</div>
    <div id="claude-last" class="meta"></div>
    <div class="note">Reads your own claude.ai chats with claude.ai's own page requests — read-only, at most one every 2 s, only while a claude.ai tab is open — and sends them only to WorkspaceHQ on this PC. These requests are not a public API: claude.ai may change or rate-limit them; sync then pauses and says so. Importing your claude.ai data export in WorkspaceHQ keeps working regardless. Only your first claude.ai organization is synced.</div>
  </section>
```

`browser-bridge/popup.js` — before the final `refresh(); setInterval(refresh, POLL_MS);` lines:

```js
// ---- claude.ai live sync (0.4.0). The permission prompt must run inside the click (a user gesture).
async function renderClaude() {
  const { hq_claude } = await chrome.storage.local.get('hq_claude');
  const s = { on: false, status: 'off', message: 'Off — nothing is read from claude.ai.', ...(hq_claude || {}) };
  $('claude-on').checked = !!s.on;
  $('claude-status').textContent = s.message;
  $('claude-status').dataset.state = s.status;
  $('claude-last').textContent = s.lastSyncAt ? 'last sync ' + new Date(s.lastSyncAt).toLocaleString() : 'never synced';
  $('claude-sync').disabled = s.status === 'syncing';
}
async function claudeTurn(on) {
  if (on) {
    const granted = await chrome.permissions.request({ origins: ['https://claude.ai/*'] }).catch(() => false);
    if (!granted) { $('claude-on').checked = false; $('claude-status').textContent = 'Permission not granted — nothing is read from claude.ai.'; return; }
  }
  $('claude-status').textContent = on ? 'Reading claude.ai…' : 'Turning off…';
  await chrome.runtime.sendMessage({ type: 'claude:set', on }).catch(() => null);
  renderClaude();
}
$('claude-on').addEventListener('change', (e) => claudeTurn(e.target.checked));
$('claude-sync').addEventListener('click', () => claudeTurn(true));
renderClaude();
setInterval(renderClaude, POLL_MS);
```

`browser-bridge/popup.css` — append:

```css
#claude-status[data-state="paused"], #claude-status[data-state="signed-out"], #claude-status[data-state="app"] { color: var(--warn, #e0a040); }
#claude-status[data-state="ok"] { color: var(--ok, #6fbf73); }
```

`browser-bridge/README.md` — new section before "How Claude uses it":

```markdown
## claude.ai live sync (0.4.0, optional)

Off by default. Press **Sync claude.ai** in the popup: Chrome asks once to allow `https://claude.ai/*` (an optional
permission), then the extension reads YOUR claude.ai chats with claude.ai's own page requests — read-only `GET`s, at most
one every 2 s, only while a claude.ai tab is open and you are logged in — and posts them to WorkspaceHQ on this PC
(`POST /claude/sync`). Every 5 minutes it fetches up to 20 changed chats (newest first); the popup shows the last sync
time and status. It never writes to claude.ai. These requests are not a public API: on HTTP 429/5xx it backs off; when a
response looks different it **pauses** ("claude.ai changed, sync paused") until you press Sync again. A chat over 4 MB is
skipped and counted — import your claude.ai data export in WorkspaceHQ (Claude › Chats › Import claude.ai export) for
those and for your full history. Only the first claude.ai organization is synced. Untick **on** to stop.

After updating these files, reload the extension yourself at `chrome://extensions` (WorkspaceHQ Bridge → reload) —
nothing reloads an unpacked extension on its own. 0.3.0 keeps working without the claude.ai section.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test dashboard/claude-sync-ext.test.mjs`
Expected: PASS (all Task 7 + 5 new tests). Then `node --test dashboard/*.test.mjs` — all green.

- [ ] **Step 5: Commit**

```bash
git add browser-bridge/claude-sync.js browser-bridge/background.js browser-bridge/popup.html browser-bridge/popup.js browser-bridge/popup.css browser-bridge/manifest.json browser-bridge/README.md dashboard/claude-sync-ext.test.mjs
git commit -m "fe: WorkspaceHQ Bridge 0.4.0 — claude.ai sync on the owner's click (optional permission), on/off, status + risk note in the popup, 5-min alarm" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: v5 data + logic — `live.claudeImport`, `importView`, `clImport`, web-chat "Continue in Claude Code" picker

Pure functions and the store; no markup (Task 10). The `claude.ai` badge already exists (H2 `hubConv.sourceLabel`, rendered in the Chats rows) and the `claude.ai` source chip already filters `source:'web'` — H4 does not re-add either.

**Files:**
- Modify: `dashboard-v5/src/live/adapter.mjs` (append `importView`, `importReportLines`), `dashboard-v5/src/live/store.js` (`live` object; the `hq.claudeHub.on` callback), `dashboard-v5/src/logic/claude-chat.js` (H3: `composerView`; `ccSend`'s success `setState`)
- Create: `dashboard-v5/src/logic/claude-import.js` (mixin `claudeImportLogic`), `dashboard-v5/src/logic/claude-import.test.mjs`
- Test: `dashboard-v5/src/live/adapter.test.mjs`, `dashboard-v5/src/live/store.test.mjs` (append; the local `hubHq` helper), `dashboard-v5/src/logic/claude-chat.test.mjs` (H3 file; append)
- Modify: `dashboard-v5/src/app.js` (import + add `claudeImportLogic` to the `Object.assign` mixin list)

**Interfaces:**
- Consumes: Task 6 `hq.claudeHub.importExport()` and the `progress {kind:'import'}` event / `health.lastImport`, `health.importing`; H2 `live.claudeLib` (`thread`, `projects`); H3 `composerView`, `pickerOptions`; app.js `call`, `denied`, `toast`, `canWrite`, `writeReason`.
- Produces (NEW):
  - `live.claudeImport = null | {kind:'import', phase, done, total, report?, error?}` — the latest import event; the store re-asks `health()` on `done`/`failed` (the Hub's `changed {ids:[]}` already makes H2 reload the lists).
  - `importReportLines(report) -> string[]` — counts only, e.g. `['Chats: 3 imported · 0 unchanged · 0 forgotten · 2 skipped', 'Messages: 5 imported · 1 skipped · 1 empty', 'Projects: 1 imported · 0 unchanged · 1 skipped', 'Not understood (counted, not imported): content:widget ×1, mystery_field ×1']`, plus `'The export file ended early — what came before the cut was imported.'` when `truncated`. Field names sorted by count desc then name, at most 5 shown, `'+N more'` after.
  - `importView(imp, hub, { hasBridge, canWrite, writeReason }) -> { canImport, why, running, text, tone:'muted'|'ok'|'error', report: string[], hasReport }` — `why` (first that applies): no bridge → `'Importing needs the WorkspaceHQ app — this preview has no app bridge.'`; Hub missing/`no-node`/`down`/`starting` → `'The Claude Hub is not running — import is unavailable.'`; `role === 'reader'` → `'Another WorkspaceHQ window owns the Claude index — import from that one.'`; `!canWrite` → `writeReason`; running → `'An import is running.'`. `text`: running → `'Unpacking the export…'` | `'Reading claude.ai Projects…'` | `'Reading chats… N read'`; failed → `'Import failed: <error>'`; done (event, else `hub.lastImport`) → `'Imported N chats (YYYY-MM-DD)'` / `'Nothing new — N chats were already imported (YYYY-MM-DD)'` / `'No chats found in that export'`; never imported → `''`.
  - Mixin `claudeImportLogic.clImport()` — denies with `why` when `!canImport`; else `this.call(() => this.hq.claudeHub.importExport())`; `{started, file}` → `LIVE.claudeImport = {kind:'import', phase:'unzip', done:0, total:0}` + toast `'Importing <file> — chats appear as they are read.'`; `{canceled}` → nothing; `{error}` → `call` toasts it.
  - H3 `composerView` (additive return keys): `isWeb` (the continued conversation is `source === 'web'`), `showPicks` (`isNew || isWeb`), `webNote` (`'Starts a NEW Claude Code chat in the picked project, seeded with this claude.ai conversation (its last 30 000 characters when longer). Uses your Claude quota.'` or `''`); a web chat with no linked WorkspaceHQ project (`lib.projects` row for `conversation.project_id` has no `hq_project_id`) sets `needsPick` until a project is picked; `title` for a web chat = `'Continue in Claude Code · <title>'`.

- [ ] **Step 1: Write the failing tests**

Append to `dashboard-v5/src/live/adapter.test.mjs`:

```js
import { importView, importReportLines } from './adapter.mjs';

const REP = { files: { conversations: true, projects: true }, conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 },
  messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 },
  unknownFields: { mystery_field: 1, 'content:widget': 1 }, truncated: false };
const HUBW = { state: 'ready', role: 'writer', lastImport: null, importing: false };
const OPT = { hasBridge: true, canWrite: true, writeReason: '' };

test('importReportLines: counts only, unknown names capped', () => {
  assert.deepEqual(importReportLines(REP), ['Chats: 3 imported · 0 unchanged · 0 forgotten · 2 skipped', 'Messages: 5 imported · 1 skipped · 1 empty',
    'Projects: 1 imported · 0 unchanged · 1 skipped', 'Not understood (counted, not imported): content:widget ×1, mystery_field ×1']);
  const many = { ...REP, unknownFields: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['f' + i, 8 - i])), truncated: true };
  const l = importReportLines(many);
  assert.equal(l[3], 'Not understood (counted, not imported): f0 ×8, f1 ×7, f2 ×6, f3 ×5, f4 ×4, +3 more');
  assert.equal(l[4], 'The export file ended early — what came before the cut was imported.');
  assert.deepEqual(importReportLines(null), []);
});

test('importView: why, running phases, done/failed, last import from health', () => {
  assert.equal(importView(null, null, { ...OPT, hasBridge: false }).why, 'Importing needs the WorkspaceHQ app — this preview has no app bridge.');
  assert.equal(importView(null, { state: 'no-node' }, OPT).why, 'The Claude Hub is not running — import is unavailable.');
  assert.equal(importView(null, { ...HUBW, role: 'reader' }, OPT).why, 'Another WorkspaceHQ window owns the Claude index — import from that one.');
  assert.equal(importView(null, HUBW, { ...OPT, canWrite: false, writeReason: 'Viewing a past snapshot' }).why, 'Viewing a past snapshot');
  const idle = importView(null, HUBW, OPT);
  assert.deepEqual([idle.canImport, idle.text, idle.hasReport], [true, '', false]);
  const run = importView({ kind: 'import', phase: 'conversations', done: 12, total: 0 }, HUBW, OPT);
  assert.deepEqual([run.running, run.canImport, run.why, run.text], [true, false, 'An import is running.', 'Reading chats… 12 read']);
  assert.equal(importView({ kind: 'import', phase: 'unzip', done: 0, total: 0 }, HUBW, OPT).text, 'Unpacking the export…');
  const done = importView({ kind: 'import', phase: 'done', done: 5, total: 5, report: REP }, HUBW, OPT);
  assert.deepEqual([done.running, done.tone, done.text.startsWith('Imported 3 chats'), done.hasReport], [false, 'ok', true, true]);
  const again = importView({ kind: 'import', phase: 'done', report: { ...REP, conversations: { ...REP.conversations, imported: 0, unchanged: 3 } } }, HUBW, OPT);
  assert.match(again.text, /^Nothing new — 3 chats were already imported/);
  const failed = importView({ kind: 'import', phase: 'failed', error: 'not a zip file' }, HUBW, OPT);
  assert.deepEqual([failed.text, failed.tone, failed.canImport], ['Import failed: not a zip file', 'error', true]);
  const fromHealth = importView(null, { ...HUBW, lastImport: { at: '2026-10-04T08:00:00.000Z', ok: true, report: REP } }, OPT);
  assert.equal(fromHealth.text, 'Imported 3 chats (2026-10-04)');
  assert.equal(importView(null, { ...HUBW, importing: true }, OPT).running, true);
});
```

Append to `dashboard-v5/src/live/store.test.mjs` (inside the Hub tests, using the file's `hubHq(health)` → `{hq, calls: {health, disposed}, hubCbs, fire(e)}` (store.test.mjs:354 — `calls.health` is a COUNTER), `DATA()` and `settle()`):

```js
test('claude.ai import events land in live.claudeImport and never touch the backfill bar; done re-asks health', async () => {
  const h = hubHq({ state: 'ready', role: 'writer', backfill: { done: 3, total: 3 }, counts: { projects: 2, conversations: 3, messages: 5 } });
  const st = createStore(DATA(), h.hq); await st.start(); await settle();
  const healthCalls = () => h.calls.health;
  const before = healthCalls();
  h.fire({ event: 'progress', data: { kind: 'import', phase: 'conversations', done: 4, total: 0 } }); await settle();
  assert.deepEqual(st.live.claudeImport, { kind: 'import', phase: 'conversations', done: 4, total: 0 });
  assert.equal(st.live.claudeHub.state, 'ready', 'an import progress event is not a backfill');
  assert.deepEqual(st.live.claudeHub.backfill, { done: 3, total: 3 });
  h.fire({ event: 'progress', data: { kind: 'import', phase: 'done', done: 5, total: 5, report: {} } }); await settle();
  assert.equal(st.live.claudeImport.phase, 'done');
  assert.ok(healthCalls() > before, 'health re-asked after the import ended');
  st.stop();
});
```

(H2 keeps `hubHq` and records its new methods in a separate local `calls` array, so `h.calls.health` stays the health counter.)

`dashboard-v5/src/logic/claude-import.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeImportLogic } from './claude-import.js';

function rig({ answer = { started: true, file: 'claude-export.zip' }, hub = { state: 'ready', role: 'writer' }, canWrite = true, bridge = true } = {}) {
  const toasts = [], denied = [], calls = [];
  const self = {
    ...claudeImportLogic,
    hq: bridge ? { claudeHub: { importExport: () => { calls.push('importExport'); return Promise.resolve(answer); } } } : null,
    LIVE: { claudeHub: hub, claudeImport: null },
    canWrite: () => canWrite, writeReason: () => 'Viewing a past snapshot',
    toast: (kind, text) => toasts.push([kind, text]), denied: (why) => denied.push(why), forceUpdate() {},
    async call(fn) { const r = await fn(); if (r && r.error) { toasts.push(['error', r.error]); return null; } return r; },
  };
  return { self, toasts, denied, calls };
}

test('clImport: started → running state + toast with the file name', async () => {
  const r = rig();
  await r.self.clImport();
  assert.deepEqual(r.calls, ['importExport']);
  assert.deepEqual(r.self.LIVE.claudeImport, { kind: 'import', phase: 'unzip', done: 0, total: 0 });
  assert.deepEqual(r.toasts, [['info', 'Importing claude-export.zip — chats appear as they are read.']]);
});

test('clImport: canceled is silent; an error is toasted; refusals never call main', async () => {
  const c = rig({ answer: { canceled: true } }); await c.self.clImport();
  assert.deepEqual([c.toasts, c.self.LIVE.claudeImport], [[], null]);
  const e = rig({ answer: { error: 'an import is already running' } }); await e.self.clImport();
  assert.deepEqual(e.toasts, [['error', 'an import is already running']]);
  const ro = rig({ canWrite: false }); await ro.self.clImport();
  assert.deepEqual([ro.calls, ro.denied], [[], ['Viewing a past snapshot']]);
  const rd = rig({ hub: { state: 'ready', role: 'reader' } }); await rd.self.clImport();
  assert.deepEqual(rd.calls, []); assert.match(rd.denied[0], /owns the Claude index/);
  const nb = rig({ bridge: false }); await nb.self.clImport();
  assert.match(nb.denied[0], /no app bridge/);
});
```

Append to `dashboard-v5/src/logic/claude-chat.test.mjs` (H3's file; reuse its `S0`, `OPTS`, `LIVE0`-style helpers or inline as here):

```js
test('composerView: a claude.ai chat continues in Claude Code — picker shown, pick required without a link (H4)', () => {
  const web = { conversation: { id: 'web:web-chat-1', source: 'web', title: 'Release planning (web)', project_id: 'web:web-proj-1' }, messages: [], hasMore: false };
  const lib = (linked) => ({ thread: web, projects: [{ id: 'web:web-proj-1', source: 'web', hq_project_id: linked ? 'project-a' : null }] });
  const S = { ccOpen: true, ccConv: 'web:web-chat-1', ccProj: '', ccText: 'Go on', ccMode: 'read-only', ccTurn: null, ccSending: false };
  const opts = { hasBridge: true, canWrite: true, writeReason: '', hqProjects: [{ id: 'project-a', name: 'Project A' }] };
  const v = composerView(S, { claudeLib: lib(false), claudeChat: { turns: [] } }, opts);
  assert.deepEqual([v.isWeb, v.showPicks, v.needsPick, v.sendTip], [true, true, true, 'Pick a project']);
  assert.equal(v.title, 'Continue in Claude Code · Release planning (web)');
  assert.match(v.webNote, /NEW Claude Code chat .* last 30 000 characters/);
  assert.equal(composerView({ ...S, ccProj: 'project-a' }, { claudeLib: lib(false), claudeChat: { turns: [] } }, opts).canSend, true);
  const linked = composerView(S, { claudeLib: lib(true), claudeChat: { turns: [] } }, opts);
  assert.deepEqual([linked.needsPick, linked.canSend], [false, true]);
  const code = composerView({ ...S, ccConv: 'code:sess-a1' }, { claudeLib: { thread: { conversation: { id: 'code:sess-a1', source: 'code', title: 't' }, messages: [] }, projects: [] }, claudeChat: { turns: [] } }, opts);
  assert.deepEqual([code.isWeb, code.showPicks, code.webNote], [false, false, '']);
});

test('ccSend from a claude.ai chat then follows the NEW Code chat — a second send never re-seeds a fresh chat (H4)', async () => {
  const sent = [];
  const self = { ...claudeChatLogic,
    state: { ccOpen: true, ccConv: 'web:web-chat-1', ccProj: 'project-a', ccText: 'Go on', ccMode: 'read-only', ccTurn: null, ccSending: false },
    LIVE: { claudeLib: {}, claudeChat: { turns: [] } }, canWrite: () => true, toast: () => {},
    setState(p) { Object.assign(this.state, p); },
    store: { sendClaudeChat: async (a) => { sent.push(a); return { turnId: 't1' }; } } };
  await self.ccSend();
  assert.deepEqual([sent[0].conversationId, sent[0].projectId], ['web:web-chat-1', 'project-a']);
  assert.deepEqual([self.state.ccConv, self.state.ccTurn], [null, 't1'], 'composerTarget now follows the turn (code:<session> once its session event lands)');
  const code = { ...self, state: { ...self.state, ccConv: 'code:sess-a1', ccText: 'more', ccTurn: null } };
  await code.ccSend();
  assert.equal(code.state.ccConv, 'code:sess-a1', 'a Code chat keeps its target');
});
```

(`claudeChatLogic` is exported by H3's `claude-chat.js`; add it to this test file's import line if it is not already there.)

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs dashboard-v5/src/logic/claude-import.test.mjs dashboard-v5/src/logic/claude-chat.test.mjs`
Expected: FAIL — `importView` not exported; `live.claudeImport` undefined (and the import event flips `claudeHub.state`); `Cannot find module './claude-import.js'`; `v.isWeb` undefined; the ccSend test sees `ccConv` still `web:web-chat-1`.

- [ ] **Step 3: Implement**

`dashboard-v5/src/live/adapter.mjs` — append:

```js
// ---- Claude Hub H4: claude.ai export import (counts only — the report never holds chat text)
export function importReportLines(r) {
  if (!r || typeof r !== 'object') return [];
  const c = obj(r.conversations), m = obj(r.messages), p = obj(r.projects);
  const lines = [
    `Chats: ${num(c.imported, 0)} imported · ${num(c.unchanged, 0)} unchanged · ${num(c.forgotten, 0)} forgotten · ${num(c.skipped, 0)} skipped`,
    `Messages: ${num(m.imported, 0)} imported · ${num(m.skipped, 0)} skipped · ${num(m.empty, 0)} empty`,
    `Projects: ${num(p.imported, 0)} imported · ${num(p.unchanged, 0)} unchanged · ${num(p.skipped, 0)} skipped`,
  ];
  const u = Object.entries(obj(r.unknownFields)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (u.length) lines.push('Not understood (counted, not imported): ' + u.slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(', ') + (u.length > 5 ? `, +${u.length - 5} more` : ''));
  if (r.truncated) lines.push('The export file ended early — what came before the cut was imported.');
  return lines;
}

const IMPORT_PHASE = { unzip: 'Unpacking the export…', projects: 'Reading claude.ai Projects…', conversations: 'Reading chats…' };
export function importView(imp, hub, { hasBridge, canWrite, writeReason } = {}) {
  const cur = imp && imp.kind === 'import' ? imp : null;
  const ended = !!cur && (cur.phase === 'done' || cur.phase === 'failed');
  const running = (!!cur && !ended) || (!!hub && !!hub.importing && !ended);
  const why = !hasBridge ? 'Importing needs the WorkspaceHQ app — this preview has no app bridge.'
    : !hub || ['no-node', 'down', 'starting'].includes(hub.state) ? 'The Claude Hub is not running — import is unavailable.'
      : hub.role === 'reader' ? 'Another WorkspaceHQ window owns the Claude index — import from that one.'
        : !canWrite ? (writeReason || 'Read-only right now')
          : running ? 'An import is running.' : '';
  let text = '', tone = 'muted', report = [];
  if (running) {
    text = (cur && IMPORT_PHASE[cur.phase]) || 'Importing…';
    if (cur && cur.phase === 'conversations' && num(cur.done, 0)) text += ` ${num(cur.done, 0)} read`;
  } else if (cur && cur.phase === 'failed') { text = 'Import failed: ' + String(cur.error || 'unknown error'); tone = 'error'; }
  else {
    const last = cur && cur.phase === 'done' ? { ok: true, report: cur.report, at: null } : hub && hub.lastImport ? hub.lastImport : null;
    if (last && last.ok) {
      const c = obj(obj(last.report).conversations), day = last.at ? ` (${String(last.at).slice(0, 10)})` : '';
      const n = num(c.imported, 0), u = num(c.unchanged, 0);
      text = n ? `Imported ${n} chat${n === 1 ? '' : 's'}${day}` : u ? `Nothing new — ${u} chat${u === 1 ? ' was' : 's were'} already imported${day}` : 'No chats found in that export';
      tone = 'ok'; report = importReportLines(last.report);
    } else if (last) { text = 'Last import failed: ' + String(last.error || 'unknown error'); tone = 'error'; }
  }
  return { canImport: !why, why, running, text, tone, report, hasReport: report.length > 0 };
}
```

`dashboard-v5/src/live/store.js`:
- `live` object: add `claudeImport: null,` next to `claudeHub` (comment `// Claude Hub H4: latest claude.ai import progress event`).
- In the `hq.claudeHub.on((e) => { … })` callback, as its FIRST branch:

```js
      if (e && e.event === 'progress' && e.data && e.data.kind === 'import') {   // H4: import progress is not backfill progress
        live.claudeImport = e.data;
        if (e.data.phase === 'done' || e.data.phase === 'failed') pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
        emit();
        return;
      }
```

(`pull`, `isObj`, `emit` are store.js's own helpers — code map §10.)

`dashboard-v5/src/logic/claude-import.js`:

```js
// Claude Hub H4 — "Import claude.ai export" (spec 2026-10-13 §5.2, §9). Main opens the file dialog; the Hub imports.
import { importView } from '../live/adapter.mjs';

export const claudeImportLogic = {
  async clImport() {
    const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
    const v = importView(this.LIVE.claudeImport, this.LIVE.claudeHub, { hasBridge, canWrite: this.canWrite(), writeReason: this.writeReason() });
    if (!v.canImport) { this.denied(v.why); return; }
    const r = await this.call(() => this.hq.claudeHub.importExport(), 'Import failed');
    if (r && r.started) {
      this.LIVE.claudeImport = { kind: 'import', phase: 'unzip', done: 0, total: 0 };
      this.toast('info', 'Importing ' + (r.file || 'the export') + ' — chats appear as they are read.');
      this.forceUpdate();
    }
  },
};
```

`dashboard-v5/src/app.js`: `import { claudeImportLogic } from './logic/claude-import.js';` with the other logic imports, and add `claudeImportLogic` to the `Object.assign(Component.prototype, …)` list.

`dashboard-v5/src/logic/claude-chat.js` (H3) — in `composerView`, after `const thread = …`:

```js
  const conv = thread && thread.conversation;
  const isWeb = !!(conv && conv.source === 'web');   // H4: a claude.ai chat continues as a NEW Claude Code chat (spec §8)
  const hubProj = isWeb ? (lib.projects || []).find((p) => p.id === conv.project_id) : null;
  const webLinked = !!(hubProj && hubProj.hq_project_id);
```

change `const needsPick = isNew && !convId;` to `const needsPick = (isNew && !convId) || (isWeb && !webLinked);`, change the `title` expression's continue branch to `` isWeb ? `Continue in Claude Code · ${tTitle || 'this chat'}` : `Continue · ${tTitle || 'this chat'}` ``, and add to the returned object:

```js
    isWeb, showPicks: (isNew && !convId) || isWeb,
    webNote: isWeb ? 'Starts a NEW Claude Code chat in the picked project, seeded with this claude.ai conversation (its last 30 000 characters when longer). Uses your Claude quota.' : '',
```

(The engine already treats `projectId` as the destination for a claude.ai chat and ignores it for a Code chat — H3 Task 3 — and `ccSend` always passes `ccProj`.)

One send-path change IS needed: H3's `ccSend` keeps `ccConv` after a send, so with `ccConv = 'web:…'` every later message would start ANOTHER seeded Code chat (a fresh session and quota each time). In `claudeChatLogic.ccSend`, replace the success `setState` line

```js
    this.setState({ ccText: '', ccTurn: r.turnId, ...(convId && !S.ccConv ? { ccConv: convId } : {}) });
```

with

```js
    // H4: a claude.ai chat was the seed, not the target — follow the new Code chat (composerTarget → the turn's code:<session>)
    const follow = String(convId || '').startsWith('web:') ? { ccConv: null } : (convId && !S.ccConv ? { ccConv: convId } : {});
    this.setState({ ccText: '', ccTurn: r.turnId, ...follow });
```

(If H3 landed the line with different spacing, match it by its `ccTurn: r.turnId` text.)

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.test.mjs dashboard-v5/src/logic/claude-import.test.mjs dashboard-v5/src/logic/claude-chat.test.mjs`
Expected: PASS. Then the whole v5 unit suite (Global Constraints "Suites") except the goldens — `vals.golden.test.mjs` is unaffected here because no render value changed yet.

- [ ] **Step 5: Commit**

```bash
git add dashboard-v5/src/live/adapter.mjs dashboard-v5/src/live/adapter.test.mjs dashboard-v5/src/live/store.js dashboard-v5/src/live/store.test.mjs dashboard-v5/src/logic/claude-import.js dashboard-v5/src/logic/claude-import.test.mjs dashboard-v5/src/logic/claude-chat.js dashboard-v5/src/logic/claude-chat.test.mjs dashboard-v5/src/app.js
git commit -m "fe: v5 Claude Hub H4 — import progress/report view model, clImport action, claude.ai chats continue in Claude Code with a project pick" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: v5 on screen — import strip (Chats + Settings), web Continue markup, honest web empty state; selftest, goldens, CDP `claude-import-progress`

**Files:**
- Create: `dashboard-v5/src/vals/claude-import.js` (`claudeImportVals`)
- Modify: `dashboard-v5/src/vals/index.js` (`SURFACES`), `dashboard-v5/src/vals/claude-chat.js` (H3 `claudeChatVals`: 4 keys), `dashboard-v5/src/logic/claude-lib.js` (H2 `chatsView`: web empty text) + `logic/claude-lib.test.mjs`, `dashboard-v5/src/tpl/claude.tpl.js`, `dashboard-v5/src/tpl/ov-settings.tpl.js`, `dashboard-v5/src/selftest.js`, `dashboard-v5/src/vals.golden.test.mjs`, `dashboard-v5/src/__golden__/vals.hashes.json` (re-record), `dashboard-v5/src/tpl.hash.test.mjs` (re-record by hand), `dashboard-v5/tools/cdp-gate.mjs`

**Interfaces:**
- Consumes: Task 9 `importView`, `clImport`, `composerView` additions; ctx `LIVE`, `cantWrite`, `writeReason` (vals/ctx.js).
- Produces (render keys — NEW, none exists at HEAD/H2/H3): `ciImport, ciCant, ciTip, ciRunning, ciText, ciHasText, ciTone, ciReport, ciHasReport` (surface `claudeImportVals`); in `claudeChatVals`: `ccShowPicks, ccIsWeb, ccWebNote, ccContinueLabel` (`'Continue in Claude Code'` when the open thread is `source === 'web'`, else `'Continue'`).
- H2 `chatsView` empty text, NEW branch before the "filters" one: `S.clSrc === 'web'` and no rows → `'No claude.ai chats yet — import your claude.ai data export (button above) or turn on "Sync claude.ai" in the WorkspaceHQ Bridge extension.'`
- CDP scenario `claude-import-progress` (spec §11 name).

- [ ] **Step 0: Record the "before" golden dump** (attribution baseline, outside the repo)

Run: `GOLDEN_DUMP="$TEMP/h4-golden-old" node --test dashboard-v5/src/vals.golden.test.mjs`
Expected: PASS, and one `<scenario>.json` per scenario in `$TEMP/h4-golden-old`.

- [ ] **Step 1: Write the failing tests**

Append to `dashboard-v5/src/logic/claude-lib.test.mjs` (H2's file; `chatsView` is imported there):

```js
test('chatsView: the claude.ai filter with no rows says how to get them (H4)', () => {
  const v = chatsView({ convs: [], hits: null, thread: null }, { state: 'ready', role: 'writer' }, { clSrc: 'web', clProj: '', clSince: 'all' }, true);
  assert.equal(v.emptyText, 'No claude.ai chats yet — import your claude.ai data export (button above) or turn on "Sync claude.ai" in the WorkspaceHQ Bridge extension.');
});
```

In `dashboard-v5/src/vals.golden.test.mjs`, after the H3 scenarios:

```js
// ---- Claude Hub H4: claude.ai import strip + web Continue
const CI_REP = { files: { conversations: true, projects: true }, conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 },
  messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 }, unknownFields: { mystery_field: 1 }, truncated: false };
const CI_HUB = { state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 3, total: 3 }, counts: HUB_COUNTS, lastImport: null, importing: false };
const CI_HQ = { ...P3_HQ, claudeHub: { importExport() {} } };
const ciAt = (imp, hub = CI_HUB) => ({ hq: CI_HQ, live: (L) => { L.claudeHub = hub; L.claudeImport = imp; }, state: tabSub('claude', 'chats') });
add('claude.import-running', ciAt({ kind: 'import', phase: 'conversations', done: 12, total: 0 }));
add('claude.import-done', ciAt({ kind: 'import', phase: 'done', done: 5, total: 5, report: CI_REP }));
add('claude.import-failed', ciAt({ kind: 'import', phase: 'failed', done: 0, total: 0, error: 'not a zip file' }));
add('claude.import-reader', ciAt(null, { ...CI_HUB, role: 'reader' }));
add('claude.import-last', ciAt(null, { ...CI_HUB, lastImport: { at: '2026-10-04T08:00:00.000Z', ok: true, report: CI_REP } }));
```

and one web-Continue scenario built the way H3's composer scenarios are (its `cc-*` scenarios set `ccOpen`/`ccConv` on top of `tabSub('claude', 'chats')` and fill `L.claudeLib`): thread `{ conversation: { id: 'web:g-web', source: 'web', title: 'Golden web chat', project_id: 'web:chats' }, messages: [], hasMore: false }`, `L.claudeLib.projects = [{ id: 'web:chats', source: 'web', key: 'chats', name: 'claude.ai chats', hq_project_id: null, link_state: 'none', conversations: 1, last_at: CL_AT }]`, state `(c) => ({ ...tabSub('claude', 'chats')(c), ccOpen: true, ccConv: 'web:g-web' })` (`tabSub` returns a FUNCTION — invoke it, never spread it bare; the H3 ledger records that bug), name `'claude.web-continue'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/vals.golden.test.mjs`
Expected: FAIL — the web empty text is H2's generic one; the six new scenarios are "not in the hashes file".

- [ ] **Step 3: Implement**

`dashboard-v5/src/logic/claude-lib.js` (H2) — in `chatsView`, insert before `else if (!rows.length && filtered) …`:

```js
    else if (!rows.length && S.clSrc === 'web') emptyText = 'No claude.ai chats yet — import your claude.ai data export (button above) or turn on "Sync claude.ai" in the WorkspaceHQ Bridge extension.';
```

`dashboard-v5/src/vals/claude-import.js`:

```js
// Claude Hub H4 — the "Import claude.ai export" strip (Claude › Chats and Settings). Keys start with ci.
import { importView } from '../live/adapter.mjs';

export function claudeImportVals(ctx) {
  const { LIVE, cantWrite, writeReason } = ctx;
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
  const v = importView(LIVE.claudeImport, LIVE.claudeHub, { hasBridge, canWrite: !cantWrite, writeReason });
  const color = v.tone === 'error' ? 'var(--orange)' : v.tone === 'ok' ? 'var(--text)' : 'var(--muted)';
  return {
    ciImport: () => this.clImport(), ciCant: !v.canImport,
    ciTip: v.why || 'Pick your claude.ai data export (.zip) — it is read on this PC only; nothing is uploaded',
    ciRunning: v.running, ciText: v.text, ciHasText: !!v.text, ciTone: { fontSize: '12px', color },
    ciReport: v.report.map((text, i) => ({ key: 'r' + i, text })), ciHasReport: v.hasReport,
  };
}
```

`dashboard-v5/src/vals/index.js`: import `claudeImportVals` and add it to `SURFACES` right after the H2/H3 Claude surfaces.

`dashboard-v5/src/vals/claude-chat.js` (H3 `claudeChatVals`), in the returned object:

```js
    ccShowPicks: cv.showPicks, ccIsWeb: cv.isWeb, ccWebNote: cv.webNote,
    ccContinueLabel: thread && thread.conversation && thread.conversation.source === 'web' ? 'Continue in Claude Code' : 'Continue',
```

(`thread` is the variable H3's `claudeChatVals` already reads for `ccCanContinue`; if it is named differently there, use that one.)

`dashboard-v5/src/tpl/claude.tpl.js` — inside the Chats block, immediately after the filters `</section>` (the one ending with the `clProjChips` row) and before `<sc-if value="{{ clSearched }}"`:

```html
                <!-- v5: claude.ai export import (Claude Hub H4, spec §5.2/§9) — button, live progress, counts-only report; never chat text -->
                <section data-ci="import" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:10px 16px;display:flex;flex-direction:column;gap:6px">
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" data-ci="go" onClick="{{ ciImport }}" disabled="{{ ciCant }}" title="{{ ciTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)">Import claude.ai export</button><sc-if value="{{ ciHasText }}" hint-placeholder-val="{{ false }}"><span data-ci="status" role="status" style="{{ ciTone }}">{{ ciText }}</span></sc-if></div>
                  <sc-if value="{{ ciHasReport }}" hint-placeholder-val="{{ false }}"><div data-ci="report" style="font-size:11px;color:var(--faint);display:flex;flex-direction:column;gap:2px"><sc-for list="{{ ciReport }}" as="l" hint-placeholder-count="3"><span>{{ l.text }}</span></sc-for></div></sc-if>
                </section>
```

In H3's composer markup: change the picker wrapper `<sc-if value="{{ ccIsNew }}" hint-placeholder-val="{{ true }}">` to `<sc-if value="{{ ccShowPicks }}" hint-placeholder-val="{{ true }}">` with a marker line above it `<!-- v5: H4 — the project picker also shows when continuing a claude.ai chat (it starts a new Claude Code chat) -->`; right after that `</sc-if>` add:

```html
                    <!-- v5: H4 — say what continuing a claude.ai chat does before the owner sends -->
                    <sc-if value="{{ ccIsWeb }}" hint-placeholder-val="{{ false }}"><div data-cc="webnote" style="font-size:11px;color:var(--faint)">{{ ccWebNote }}</div></sc-if>
```

and in the thread's Continue button (`data-cc="continue"`) replace the literal text `Continue</button>` with `{{ ccContinueLabel }}</button>` (marker: `<!-- v5: H4 — "Continue in Claude Code" for claude.ai chats -->` above the button).

`dashboard-v5/src/tpl/ov-settings.tpl.js` — after the "What's new · trailers" row, copying its row and button styles exactly:

```html
          <!-- v5: Claude Hub H4 — claude.ai export import, same action as Claude › Chats; status shown in Chats -->
          <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px dashed var(--frame)"><div style="flex:1;min-width:0"><div style="font-size:15px">claude.ai export</div><div style="font-size:12px;color:var(--muted)">Import your claude.ai data export (.zip) into the Claude library. Read on this PC only.</div></div><button type="button" data-ci="settings" onClick="{{ ciImport }}" disabled="{{ ciCant }}" title="{{ ciTip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;flex:0 0 auto;transition:transform .12s, background .15s, border-color .15s, filter .15s">Import</button></div>
```

(The `style` is the What's-new button's, character for character — ov-settings.tpl.js:16 at HEAD — so the two buttons are identical.)

`dashboard-v5/src/selftest.js`: add `claudeImport: LV.claudeImport` to `savedLive` (and `claudeLib` if H2 did not add it); append to `STATES`:

```js
      ['ci-running', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'conversations', done: 12, total: 0 }; }],
      ['ci-done', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'done', done: 5, total: 5, report: { conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 }, messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 }, unknownFields: { mystery_field: 1 }, truncated: false } }; }],
      ['ci-failed', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'failed', done: 0, total: 0, error: 'not a zip file' }; }],
      ['cc-web', at('claude', 'chats'), { ccOpen: true, ccConv: 'web:st-web' }, () => { LV.claudeLib = { ...LV.claudeLib, thread: { conversation: { id: 'web:st-web', source: 'web', title: 'Selftest web chat', project_id: 'web:chats' }, messages: [], hasMore: false }, projects: [{ id: 'web:chats', source: 'web', hq_project_id: null }] }; }],
```

`dashboard-v5/tools/cdp-gate.mjs` — in `fresh()`'s evaluated function add `if (L.store && L.store.live) L.store.live.claudeImport = null;`; add `claude-import-progress` to the header comment's scenario list; add before the closing `};` of `SCENARIOS`:

```js
  async 'claude-import-progress'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    const status = `((document.querySelector('[data-ci="status"]') || {}).textContent || '')`;
    const click = `document.querySelector('[data-ci="go"]').click()`;
    try {
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      if (!(await t.waitFor(`!!document.querySelector('[data-ci="go"]')`, 5000))) return ['the import button never rendered'];
      await t.evaluate(click);
      if (!(await t.waitFor(`hqFake.calls('claudeHub.importExport').length === 1`, 3000))) fails.push('importExport was not called');
      if (!(await t.waitFor(`${status} === 'Unpacking the export…'`, 3000))) fails.push('no running status after start: ' + (await t.evaluate(status)));
      await t.evaluate(`hqFake.emit('hq:claude-hub:event', { event: 'progress', data: { kind: 'import', phase: 'conversations', done: 7, total: 0 } })`);
      if (!(await t.waitFor(`${status} === 'Reading chats… 7 read'`, 3000))) fails.push('progress not shown: ' + (await t.evaluate(status)));
      if (!(await t.evaluate(`document.querySelector('[data-ci="go"]').disabled`))) fails.push('the button stays enabled while an import runs');
      if ((await t.evaluate(`WHQ.app.logic.store.live.claudeHub && WHQ.app.logic.store.live.claudeHub.state`)) === 'indexing') fails.push('an import event was treated as a backfill');
      await t.evaluate(`hqFake.emit('hq:claude-hub:event', { event: 'progress', data: { kind: 'import', phase: 'done', done: 5, total: 5, report: { conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 }, messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 }, unknownFields: {}, truncated: false } } })`);
      if (!(await t.waitFor(`/^Imported 3 chats/.test(${status})`, 3000))) fails.push('done not shown: ' + (await t.evaluate(status)));
      const lines = await t.evaluate(`[...document.querySelectorAll('[data-ci="report"] span')].map((s) => s.textContent)`);
      if (lines[0] !== 'Chats: 3 imported · 0 unchanged · 0 forgotten · 2 skipped') fails.push('report line: ' + lines[0]);
      if (await t.evaluate(`document.querySelector('[data-ci="go"]').disabled`)) fails.push('the button is not re-enabled after the import');
      await t.evaluate(`hqFake.set('claudeHub.importExport', () => ({ error: 'an import is already running' }))`);
      await t.evaluate(click);
      if (!(await t.waitFor(`document.body.textContent.includes('an import is already running')`, 3000))) fails.push('a refused import is not toasted');
      await t.evaluate(`hqFake.set('claudeHub.importExport', () => ({ canceled: true }))`);
      await t.evaluate(click);
      await t.sleep(300);
      if (!/^Imported 3 chats/.test(await t.evaluate(status))) fails.push('a canceled dialog changed the status');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; if (L.store && L.store.live) L.store.live.claudeImport = null; L.setState({}); })()`);
    }
    return fails.concat(t.errors());
  },
```

- [ ] **Step 4: Attribute, then re-record**

Run: `GOLDEN_DUMP="$TEMP/h4-golden-new" node --test dashboard-v5/src/vals.golden.test.mjs` (FAILS: every hash moved because new keys were added to `renderVals()`; six scenarios are new). Attribute every changed scenario — the only allowed differences are the new H4 keys:

```bash
node -e "const fs=require('fs'),p=require('path');const [A,B]=process.argv.slice(1);const NEW=/^(ci[A-Z]|ccShowPicks$|ccIsWeb$|ccWebNote$|ccContinueLabel$)/;const bad=[];for(const f of fs.readdirSync(B)){const fa=p.join(A,f);if(!fs.existsSync(fa))continue;const a=JSON.parse(fs.readFileSync(fa,'utf8')),b=JSON.parse(fs.readFileSync(p.join(B,f),'utf8'));for(const k of Object.keys(b))if(NEW.test(k))delete b[k];if(JSON.stringify(a)!==JSON.stringify(b))bad.push(f)}console.log(bad.length?'UNATTRIBUTED: '+bad.join(', '):'only the H4 keys changed')" "$TEMP/h4-golden-old" "$TEMP/h4-golden-new"
```

Expected: `only the H4 keys changed`. (If a `tab.claude.*` scenario with the `claude.ai` filter shows the new empty text, that is the Step 3 `chatsView` change — attribute it by name in the commit message.) Then read the six new dumps (`claude.import-*.json`, `claude.web-continue.json`): `ciText`/`ciReport`/`ciCant` and `ccTitle`/`ccWebNote`/`ccContinueLabel` match their state. Record: `UPDATE_GOLDEN=1 node --test dashboard-v5/src/vals.golden.test.mjs`, rerun without the env → PASS; `rm -rf "$TEMP/h4-golden-old" "$TEMP/h4-golden-new"`.

Template hash (`src/tpl.hash.test.mjs`, re-recorded BY HAND): run `node -e "import('./dashboard-v5/src/app.tpl.js').then((m)=>{const t=m.default;console.log(t.length, Buffer.byteLength(t,'utf8'), require('crypto').createHash('sha256').update(t).digest('hex'))})"` from the repo root, put the three numbers into `LENGTH`, `UTF8_BYTES`, `SHA256`, and add the dated history line `2026-10-16 H4 claude.ai import strip (Chats + Settings), web Continue label/picker/note: +<Δlength> chars / +<Δbytes> bytes`.

- [ ] **Step 5: Verify**

Run the full v5 unit suite (Global Constraints "Suites") → PASS. Selftest: from `dashboard-v5/`, `$env:HQ_V5_PROFILE='h4-selftest-<unique>'; ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --hidden --selftest` → exit 0, errors/unresolved/failures 0 (the `ci-*` and `cc-web` combos run in both themes). CDP: start `..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --remote-debugging-port=9347` from `dashboard-v5/` (note its PID), `node tools/cdp-gate.mjs --port 9347 --scenario claude-import-progress,fake-parity,boot` → all PASS, then `--scenario all` → all PASS; stop ONLY that PID (`Stop-Process -Id <pid>`); remove the `HQ_V5_PROFILE` folder by its literal path.

- [ ] **Step 6: Commit**

```bash
git add dashboard-v5/src/vals/claude-import.js dashboard-v5/src/vals/index.js dashboard-v5/src/vals/claude-chat.js dashboard-v5/src/logic/claude-lib.js dashboard-v5/src/logic/claude-lib.test.mjs dashboard-v5/src/tpl/claude.tpl.js dashboard-v5/src/tpl/ov-settings.tpl.js dashboard-v5/src/selftest.js dashboard-v5/src/vals.golden.test.mjs dashboard-v5/src/__golden__/vals.hashes.json dashboard-v5/src/tpl.hash.test.mjs dashboard-v5/tools/cdp-gate.mjs
git commit -m "fe: v5 Claude Hub H4 — Import claude.ai export (Chats + Settings) with live progress and counts-only report; Continue in Claude Code for claude.ai chats; goldens re-recorded (only H4 keys changed); CDP claude-import-progress" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: H4 gate — real second instance + real bridge on fixtures, docs, HANDOFF

Spec §11 "Real second instance". **This task never restarts or stops the owner's app** (`electron.exe . --hidden` without `--user-data-dir`, or its Hub child on `data/claude/hub.sqlite`) and never touches the owner's bridge on port 47821; the controller restarts the app after the plan lands. Reloading the WorkspaceHQ Bridge extension to 0.4.0 is the OWNER's manual action (`chrome://extensions` → reload) — this task does not load or reload any extension; the extension is gated by its node tests (Tasks 7–8) plus the real bridge below.

**Files:**
- Modify: `README.md` (test commands, env override), `CLAUDE.md` (one fact line), `docs/sync/HANDOFF.md` (entry on top), `docs/sync/IPC-CONTRACT.md` / `docs/sync/CONTRACT.md` (only if the gate shows drift from the Task 5/6 rows)
- No code changes. A bug found here is fixed in the task that owns the file (new commit with that task's prefix), then this gate is re-run.

**Interfaces:**
- Consumes: everything above; `dashboard/claude-hub/__fixtures__/make-fixture.mjs` (`makeClaudeHome`, `userLine`, `assistantLines`, `titleLine`), `__fixtures__/make-export.mjs` (`zipFiles`, `exportJson`), H3's `dashboard/__fixtures__/make-fake-claude.mjs` (`makeFakeClaude`), `dashboard/claude-hub-host.js` `create`, `dashboard/browser-bridge.js` `startBridge({dataDir, port})`. Produces: the gate result and the docs.

- [ ] **Step 1: Run every suite** (Global Constraints › Suites): `node --test dashboard/claude-hub/*.test.mjs` (incl. `unzip`, `parse-web`, `ingest-web`, the new Hub tests); `node --test dashboard/*.test.mjs` (incl. `claude-import`, `claude-bridge-routes`, `claude-sync-ext`); the v5 suite; the v5 selftest (own `HQ_V5_PROFILE`); `node tools/cdp-gate.mjs --port 9347 --scenario all` against a `--preload=fake` harness (Task 10 Step 5). All PASS / exit 0; record the counts for the HANDOFF entry.

- [ ] **Step 2: Fixtures** (PowerShell from the repo root; this task uses ports 9495 and 47899 — H1 9492, H2 9493, H3 9494; 47821 is the owner's bridge):

```powershell
$g = Join-Path $env:TEMP ('hq-h4-gate-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $g, (Join-Path $g 'project-a') | Out-Null
$before = Get-ChildItem -LiteralPath data\claude -Force | Select-Object Name, Length, LastWriteTime
node --input-type=module -e "
import { makeClaudeHome, userLine, assistantLines, titleLine } from './dashboard/claude-hub/__fixtures__/make-fixture.mjs';
import { zipFiles, exportJson } from './dashboard/claude-hub/__fixtures__/make-export.mjs';
import fs from 'node:fs'; import path from 'node:path';
const g = process.argv[1], h = makeClaudeHome(g), sid = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bee', cwd = path.join(g, 'project-a');
const dir = path.join(h.root, 'gate-project-a'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, sid + '.jsonl'), userLine({ uuid: 'u-g1', sessionId: sid, at: '2026-10-16T08:00:00Z', cwd, text: 'Placeholder gate folder' })
  + assistantLines({ apiId: 'msg_g1', uuids: ['a-g1'], sessionId: sid, at: '2026-10-16T08:00:05Z', cwd, blocks: [{ type: 'text', text: 'Placeholder reply' }], usage: { input_tokens: 1, output_tokens: 2 } })
  + titleLine({ sessionId: sid, title: 'Gate folder chat' }));
const j = exportJson(); zipFiles(path.join(g, 'claude-export.zip'), [{ name: 'export/conversations.json', data: j.conversations }, { name: 'export/projects.json', data: j.projects }]);
" $g
node --input-type=module -e "import { makeFakeClaude } from './dashboard/__fixtures__/make-fake-claude.mjs'; console.log(JSON.stringify(makeFakeClaude(process.argv[1])));" $g
```

- [ ] **Step 3: Real bridge + real Hub on a fixture db (routes end to end)** — write `$g\bridge-gate.cjs` (kept in `$g`, never in the repo):

```js
const path = require('path');
const [repo, g] = process.argv.slice(2);
const { startBridge } = require(path.join(repo, 'dashboard', 'browser-bridge.js'));
const { create } = require(path.join(repo, 'dashboard', 'claude-hub-host.js'));
const routes = require(path.join(repo, 'dashboard', 'claude-bridge-routes.js'));
(async () => {
  const host = create({ hubScript: path.join(repo, 'dashboard', 'claude-hub', 'hub.mjs'), dbFile: path.join(g, 'bridge-hub.sqlite'),
    env: { ...process.env, HQ_CLAUDE_HOME: path.join(g, '.claude'), HQ_CLAUDE_DB: path.join(g, 'bridge-hub.sqlite') } });
  host.start();
  for (let i = 0; i < 200 && host.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 100));
  routes.setHub(host);
  const b = startBridge({ dataDir: path.join(g, 'bridge-data'), port: 47899 });
  await new Promise((r) => setTimeout(r, 300));
  const base = 'http://127.0.0.1:47899', H = { 'Content-Type': 'application/json', 'X-HQ-Bridge': '1' };
  const item = { kind: 'conversation', data: { uuid: 'gate-web-1', name: 'Gate synced chat', updated_at: '2026-10-16T09:00:00Z',
    chat_messages: [{ uuid: 'gate-web-1-m', sender: 'human', created_at: '2026-10-16T09:00:00Z', text: 'Placeholder synced text' }] } };
  const post = (body) => fetch(base + '/claude/sync', { method: 'POST', headers: H, body });
  const out = {};
  out.noHeader = (await fetch(base + '/claude/sync-state')).status;
  out.push1 = await (await post(JSON.stringify({ v: 1, items: [item] }))).json();
  out.push2 = await (await post(JSON.stringify({ v: 1, items: [item] }))).json();
  out.big = (await post('x'.repeat(4 * 1024 * 1024 + 1))).status;
  out.badSchema = (await post(JSON.stringify({ v: 1, items: [{ kind: 'conversation', data: { uuid: '../x', chat_messages: [] } }] }))).status;
  out.state = await (await fetch(base + '/claude/sync-state', { headers: H })).json();
  console.log(JSON.stringify(out));
  b.stop(); host.stop();
})();
```

Run: `node $g\bridge-gate.cjs (Get-Location).Path $g` (if `browser-bridge.js` needs Electron to load, run the same file with `$env:ELECTRON_RUN_AS_NODE='1'; dashboard\node_modules\electron\dist\electron.exe $g\bridge-gate.cjs …` and clear the env var after).
Expected JSON: `noHeader` 403; `push1.report.conversations.imported` 1; `push2.report.conversations.unchanged` 1; `big` 413; `badSchema` 400; `state.conversations['gate-web-1']` = `'2026-10-16T09:00:00.000Z'`. The script stops its own Hub (`host.stop()` closes stdin); confirm with `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*bridge-hub.sqlite*" }` → nothing.

- [ ] **Step 4: Real second instance** (fixture `~/.claude`, own db, own profile, own port; the import dialog replaced by `HQ_CLAUDE_IMPORT_ZIP`; chat runs only the fake claude):

```powershell
$env:HQ_CLAUDE_HOME = Join-Path $g '.claude'
$env:HQ_CLAUDE_DB   = Join-Path $g 'hub.sqlite'
$env:HQ_HUB_LATEST  = Join-Path $g 'latest.json'
Set-Content -LiteralPath $env:HQ_HUB_LATEST -Encoding utf8 -Value '{"projects":[],"archived_projects":[]}'
$env:HQ_CLAUDE_IMPORT_ZIP = Join-Path $g 'claude-export.zip'
$env:HQ_CLAUDE_BIN  = Join-Path $g 'fakebin\claude.cmd'
$env:FAKE_CLAUDE_LOG = Join-Path $g 'claude-argv.jsonl'
$env:FAKE_CLAUDE_MODE_FILE = Join-Path $g 'fake-mode.txt'; Set-Content -LiteralPath $env:FAKE_CLAUDE_MODE_FILE -Value 'ok'
$env:HQ_APP_LOG_DIR = Join-Path $g 'logs'
$env:HQ_DRY_LAUNCH  = '1'
$env:HQ_UI_VERSION  = 'v5'
$p = Start-Process -PassThru -WorkingDirectory dashboard -FilePath 'node_modules\electron\dist\electron.exe' -ArgumentList '.', '--hidden', "--user-data-dir=$g\profile", '--remote-debugging-port=9495'
$p.Id   # the ONLY electron pid this task may stop
```

(This instance's own HTTP bridge cannot bind 47821 — the owner's app holds it — exactly as in the H1–H3 gates; the routes were gated in Step 3.)

Drive it over CDP on port 9495 (`Runtime.evaluate` from a short script kept in `$g`; `L = WHQ.app.logic`, as the H1–H3 gates did). Checks:
  1. **Import:** `L.go('claude','chats')`, click `[data-ci="go"]` → within 15 s `[data-ci="status"]` starts `Imported 3 chats`; the `[data-ci="report"]` lines read `Chats: 3 imported · 0 unchanged · 0 forgotten · 2 skipped`, `Messages: 5 imported · 1 skipped · 1 empty`, `Projects: 1 imported · 0 unchanged · 1 skipped`, and a `Not understood …` line naming `mystery_field`. `Get-ChildItem -LiteralPath (Join-Path $g 'tmp')` is empty.
  2. **Badges + filter:** `L.clSetFilter('clSrc','web')` → exactly 3 rows, each with the `claude.ai` badge; titles include `Release planning (web)`, `Café notes 🚀`, `Untitled chat`. Search `release` returns the web chat among the hits.
  3. **Idempotent:** click `[data-ci="go"]` again → status starts `Nothing new — 3 chats were already imported`; still 3 web rows.
  4. **Continue in Claude Code:** open `Release planning (web)` → messages show `Plan the release for project-a` and `Here is a release plan.\n[tool: web_search]`; the `[data-cc="continue"]` button reads `Continue in Claude Code`; click it → the picker shows, `[data-cc="webnote"]` is visible, Send is disabled with tip `Pick a project`; pick the gate folder (`L.LIVE.claudeLib.projects.find((r) => r.path && r.path.toLowerCase() === <$g\project-a lower-cased>).id` via `L.ccPick`), type `Placeholder continue`, Send → `claude-argv.jsonl` line 1: no `--resume`, `plan` present, no `bypass`/`dangerously`, `cwd` = `$g\project-a`, `stdin` starts with `Context: a claude.ai conversation titled "Release planning (web)"` and ends with `Placeholder continue`.
  5. **Forget wins over re-import:** open `Café notes 🚀`, Forget (H2 action, confirm) → click `[data-ci="go"]` → status `Nothing new — 2 chats were already imported`, first report line exactly `Chats: 0 imported · 2 unchanged · 1 forgotten · 2 skipped`; the chat does not come back.
  6. **Settings:** `L.setState({ settingsOpen: true })` → `[data-ci="settings"]` exists and is enabled; close Settings.
  7. **Logs carry no conversation text:** `Select-String -Path "$g\logs\*" -Pattern 'Plan the release','Placeholder continue','example.org','Placeholder brief'` → no match.
  8. **The owner's data is untouched:** `Get-ChildItem -LiteralPath data\claude -Force | Select-Object Name, Length, LastWriteTime` equals `$before` apart from files the owner's own app writes (its `hub.sqlite`/`-wal` while it runs); `Test-Path data\claude\tmp` is unchanged from before the gate; `git status --short` shows no new or modified tracked file outside this task's docs (and the other lane's four known files).

Stop only your PIDs: `Stop-Process -Id $p.Id`; if `Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)"` still lists a `node.exe … hub.mjs … $g\hub.sqlite`, stop that PID too — never a Hub whose `--db` is the repo's `data\claude\hub.sqlite`. Then `Remove-Item -LiteralPath $g -Recurse -Force` and remove every env var set above from this shell (`Remove-Item Env:HQ_CLAUDE_HOME, Env:HQ_CLAUDE_DB, Env:HQ_HUB_LATEST, Env:HQ_CLAUDE_IMPORT_ZIP, Env:HQ_CLAUDE_BIN, Env:FAKE_CLAUDE_LOG, Env:FAKE_CLAUDE_MODE_FILE, Env:HQ_APP_LOG_DIR, Env:HQ_DRY_LAUNCH, Env:HQ_UI_VERSION`).

- [ ] **Step 5: Docs**
  - `README.md` test section: add `node --test dashboard/claude-hub/unzip.test.mjs dashboard/claude-hub/parse-web.test.mjs dashboard/claude-hub/ingest-web.test.mjs`, `node --test dashboard/claude-import.test.mjs dashboard/claude-bridge-routes.test.mjs dashboard/claude-sync-ext.test.mjs`, and `node dashboard-v5/tools/cdp-gate.mjs --port <port> --scenario claude-import-progress`; in the env-override list add `HQ_CLAUDE_IMPORT_ZIP` — "absolute path of a claude.ai export used instead of the file dialog (gates and second instances only)".
  - `CLAUDE.md` "Facts": extend the Claude Hub line with `; claude.ai (H4): Claude › Chats › Import claude.ai export (Hub unzips into data/claude/tmp, removed after) and extension 0.4.0 live sync via bridge GET /claude/sync-state + POST /claude/sync (dashboard/claude-bridge-routes.js); web rows are web:<uuid>; gates set HQ_CLAUDE_IMPORT_ZIP instead of the dialog`.
  - Re-read the Task 5 (CONTRACT) and Task 6 (IPC-CONTRACT) rows against what the gate saw; fix any drift in this commit.
  - `docs/sync/HANDOFF.md`, new entry on top:

```markdown
## 2026-10-16 · FROM frontend (Claude Hub H4 — claude.ai export import + extension live sync) · main @ <short-sha>
DONE: claude.ai chats and Projects join the Claude library. Claude › Chats (and Settings) › "Import claude.ai export" — a
  .zip picked in main, unzipped and parsed by the Hub (dependency-free streaming reader; conversations.json streamed one
  chat at a time; secrets masked before any cut; counts-only report; idempotent; forgotten chats never return; data/claude/tmp
  job folder always removed). Bridge GET /claude/sync-state + POST /claude/sync (token rule, 4 MB cap, schema checks).
  Extension 0.4.0: "Sync claude.ai" asks for https://claude.ai/* on click, read-only GETs ≤ 1 / 2 s, backoff, pauses with a
  visible status on a shape change, 20 chats per 5-min run, on/off in the popup. claude.ai chats carry the claude.ai badge
  and "Continue in Claude Code" (new Code chat in a picked project, seeded, uses your Claude quota). Gate: fixture second
  instance on port 9495 + real bridge/Hub on port 47899 (no owner data touched). Commits: <list the fe:/meta: shas of Tasks 1–11>.
IN-FLIGHT: none.
ASKS: owner — reload the WorkspaceHQ Bridge extension at chrome://extensions to get 0.4.0 (manual; nothing reloads it),
  then press "Sync claude.ai" in its popup when you want live sync. Controller — restart the app (tools\rollback.ps1 v5)
  so main loads claude-import.js and the Hub child gets the new ops.
BREAKS: none for structure (no collector/schema change). Additive IPC/contract rows: IPC-CONTRACT "phase H4",
  CONTRACT "Local bridge routes — Claude Hub live sync" + data/claude H4 note. main.js: one line (claude-import hook).
  browser-bridge.js: one require + one route hook.
```

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/sync/HANDOFF.md
git commit -m "meta: Claude Hub H4 gate (fixture second instance + real bridge/Hub), README test commands, CLAUDE.md fact, HANDOFF" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `docs/sync/IPC-CONTRACT.md` / `docs/sync/CONTRACT.md` to that `git add` only if Step 5 changed them.)

Report: the one touched `main.js` line (Task 6), the two touched `browser-bridge.js` lines (Task 5), the gate results (Steps 1, 3, 4) and the owner/controller asks above.

---

## Self-review (done while writing)

- **Spec coverage:** §5.2 file dialog in main `.zip` only → Task 6; streaming unzip into `data/claude/tmp`, deleted afterwards → Tasks 1, 3, 4; `conversations.json` + `projects.json`, known variants, unknown shapes counted (no content), honest error for a ZIP with neither file → Tasks 2, 3; idempotent re-import + `web_sync` de-dup → Tasks 3, 4. §5.3 optional `https://claude.ai/*` on the popup click → Task 8; read-only GETs with the session cookie, changed = `updated_at` newer than `GET /claude/sync-state` → Task 7; ≤ 1 req / 2 s, exponential backoff on 429/5xx, "claude.ai changed, sync paused" → Task 7 (+ status in Task 8); `POST /claude/sync`, token rule, 4 MB, chunked by conversation → Tasks 5, 7; risk stated in the popup → Task 8. §6 ops `importExport`/`syncState`/`syncPush` (exact names) + `progress` for imports → Task 4. §7 `claudeHub.importExport` → `hq:claude-hub:import`, `{started}`/`{canceled}`, progress via push → Tasks 6, 9. §9 web source badge (already H2 — verified, not re-added), "Continue in Claude Code" → Tasks 9, 10. §10 empty states say why (web filter) → Task 10; extension shows last sync + status, can be turned off → Task 8; logs carry no text → Task 11. §11 parsers, bridge routes (token, caps, schema, de-dup), `claude-import-progress`, real second instance → Tasks 1–5, 10, 11. CONTRACT.md + IPC-CONTRACT rows → Tasks 5, 6.
- **Placeholder scan:** no "TBD"/"similar to"; every test and implementation is spelled out. Two edits name H2/H3 code by its spec'd names (`chatsView`, `composerView`, `claudeChatVals`, the `ccIsNew` picker wrapper, the `data-cc="continue"` button) because those files land in H2/H3 before H4 runs; each says what to do if a local variable is named differently. The Settings button carries the What's-new button's `style` copied verbatim from ov-settings.tpl.js:16.
- **Type consistency:** report shape (`newReport`, Task 2) is the one used by `ingestWeb*` (3), Hub events/`lastImport` (4), the bridge answer (5), `importReportLines`/`importView` (9) and the CDP/golden fixtures (10). Event `{kind:'import', phase, done, total, report?, error?}` is identical in Tasks 4, 6, 9, 10. Ids `web:<uuid>`, `web:chats`, `web:<uuid>:<msg|@i>` are the same in Tasks 3, 4, 5, 9, 11. `syncState` shape is the same in Tasks 3, 4, 5, 7. The extension's push body `{v:1, items:[{kind, data}]}` matches `checkItems` (5) and `pushItems` (4).
- **Review Focus pins:** 1 → Task 2 variant table + Task 3 import counts; 2 → Task 3 re-import/newer + Task 4 Hub test; 3 → Task 1 hostile ZIP tests + Task 3/4 tmp cleanup; 4 → Task 7 clock/fetch tests (+ Task 8 tick); 5 → Task 3 tombstone/`resetCode` + Task 4 `syncPush` forgotten.

<!-- plan complete: 11 tasks -->
