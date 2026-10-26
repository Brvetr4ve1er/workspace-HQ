# Data contract — collector (producer) ⇄ dashboard (consumer)

The frontend reads these files **by exact path and shape**. Changing anything here
requires an entry in the *Pending changes* section below BEFORE the code change,
plus a matching golden-fixture update in `collector/lib/__fixtures__/`.

## Files the frontend consumes

| File | Consumed by | Notes |
|---|---|---|
| `data/latest.json` | `build-data.mjs` → `window.DATA.latest` + `main.js` (tray, mini-HUD, shards, quest IPC) | the character sheet |
| `VEEMO CORTEX/…/Workspace Status *.json` | `build-data.mjs` → `window.DATA.scans[]` | time-machine history |
| `data/spellbook.json` | `build-data.mjs` → `window.DATA.spellbook` | arsenal |
| `data/spell-telemetry.json` | `build-data.mjs` → `window.DATA.telemetry` | mastery pips, collection meter |
| `data/weekly-recap.json` | `build-data.mjs` → `window.DATA.weeklyRecap` | Weekly Saga card |
| `data/quest-overrides.json` | written by `main.js` (quest-done, Obsidian sync), read by `assemble.mjs` | two-way |
| `data/brain-dump.json` | written by capture window, read by `assemble.mjs` | routed to side-quests |
| `data/shards.json` | runtime state of organic-UI shards — **main.js only**, not part of the scan | don't validate |
| `data/browser-activity.json` | written by `main.js` bridge server (extension ingest), read by `assemble.mjs` → `latest.json.browser` | runtime state, **don't validate**; rolling 3-day window |

## Load-bearing fields in `latest.json` (renderer will crash/blank without these)

- `scan.{id, previous_scan, enriched}`
- `account.{level, title, xp, xp_into_level, xp_to_next, health_index, health_delta}`
- `account.streak.{scan_days, longest_scan_days, last_scan}`
- `account.totals.{products, open_quests, red_quests, achievements_unlocked, open_side_quests, learnings, knowledge_xp, archived}`
- `account.daily_top3[] {kind, label, reason, project_id, quest_id}`
- `account.spellcraft.{spell_of_day{id,name,icon,school,rarity,bonus_xp}, ever_cast, spells_known, ever_cast_pct, lifetime_casts, per_school}`
- `projects[] {id, name, path, stack, dev_cmd, canonical_branch, completion{pct,basis,delta}, level, xp,`
  `activity{state, days_since_commit, last_commit}, signals{has_readme,has_tests,has_ci,…},`
  `metrics{code_health{build,tests,files,loc,recent_files}, git_safety{…, last_commit_subject}, risk_security{…}},`
  `insights, suggestions, roadmap, side_quests[]}`
- `quests[] {id, title, tier, xp, status, age_days, insight, project_id, completed}`
  — **quest `id` format `q-<project>-<concern>` is load-bearing**: Obsidian two-way
  sync round-trips it via `🆔` markers in Quest Board.md and `wq:` tasks in dailies.
- `side_quests[] {id (sq-…), kind, severity, title, detail, project_id, project_name, effort, impact, source, fat_dirs?}`
- `achievements[] {id, unlocked, unlocked_on?, progress{have,need}?}`
- `trends.{health_index, xp, knowledge_xp, completion_by_project, open_quests_by_tier, git_risk}` (arrays of `{d,v}`)
- `changes_since_prev[] {type, detail, impact, notify, …}` — celebration takeover keys on
  types `level_up`, `new_achievement`, `quest_completed`
- `inventory.{vaults, clones, anomalies, duplicates, empty, trivial}` + `archived_projects[]`, `recent_learnings[]`
- `browser.{captured, updated, current, by_domain[], by_project[], totals}` — the "Working On Now"
  insight from the WorkspaceHQ Bridge extension. **Additive & optional**: absent/`captured:false`
  on scans taken before the bridge existed or when the extension isn't loaded; the renderer guards
  for it (`renderBrowserFocus` shows a setup nudge instead of crashing). `current` may also be null.

## Pending changes

### Workspace discovery — "see everything" (2026-10-19) — structure lane, additive

`latest.json` only ever carried the hand-listed products/vaults/clones; every other folder under
Documents was dropped in `assemble.mjs`. All changes below are **additive and optional**; the v2 rollback
path ignores unknown keys.

- `inventory.unclassified[]`, `inventory.ignored[]` — `{name, kind: empty|vault|project-like|other, stack[], has_git,
  remote, dirty, unpushed, files, last_modified, days_since_modified}` (`$defs/folder_facts`). `ignored` = folders the
  collector config skips; they are listed, not hidden.
- `inventory.loose_files[]` — `{name, bytes, days_since_modified}`, files sitting directly in Documents.
- `inventory.vaults[]` gains `source: config|registry|scan`, `path`, `embedded_in` (product id or null). Vaults are now
  auto-detected (Obsidian's `obsidian.json` registry + `.obsidian` folders under the root), so the vault count rises.
- `inventory.anomalies[]` / `inventory.trivial[]` are now **computed each scan** (were copied from the previous scan
  forever). Collector anomalies carry `source: "collector"`: `missing_path`, `root_vault`, `daily_dir_missing`.
- `scan.enrichment_scan_id`, `scan.enrichment_age_days` — `enriched: true` no longer implies fresh; the nightly runs
  `-NoEnrich`, so enrichment.json is carried forward. Renderer should show the age when > 1.
- `quests[].reopened_from` added to the schema (the code already emitted it; `validate-schema` failed on 7 quests).
- `collector.config.json`: new `vault_layout {root, project_note_dirs, daily_dir}` replaces hardcoded
  `30_Areas/Projects` / `10_Daily` paths in assemble.mjs; `product-intel-wizard` and `BRAIN-OS-v2` repointed to
  `travel agency  brain/`. `achievements.cartographer` progress is now real (4/9, was permanently 0).
- Golden fixtures: `inventory` output changes by design; re-baseline with this entry as the reason.


### Social bridge sidecars (extension ⇄ app relay ⇄ MCP) — frontend lane, additive

New producer/consumer pair, parallel to the browser tendril: the **WorkspaceHQ
Bridge** extension scrapes your logged-in social sessions and the app relay
(`dashboard/social-bridge.js`, a new tendril) writes sidecars under `data/social/`;
the MCP server (`mcp/workspacehq/server.mjs`; it lived in `dashboard-v3/mcp/` until
2026-10-06) reads them via `hq_social_*` tools.
**Not consumed by `build-data.mjs`/the renderer** — no `latest.json` field, no
golden fixture. All `data/social/*` is **gitignored** (personal content + session).

| File | Written by | Read by | Shape |
|---|---|---|---|
| `data/social/inbox.json` | app relay (extension ingest) | `hq_social_feed/_mentions/_metrics` | tendril doc: `{updated, live, events[]}`; each event `{platform, kind:'feed'\|'mention'\|'notification'\|'metrics', id, ts, author?, text?, url?, uri?, counts?{likes,reposts,replies}, metrics?{followers,following,posts}}` |
| `data/social/outbox.json` | `hq_social_post/_reply` (stage), `hq_social_cancel` + popup Skip (cancel), extension (claim + send result), owner (release) | `hq_social_outbox`, extension popup | `{updated, actions[]}`; action `{id, platform, op:'post'\|'reply', text, reply_to?, target?, title?, status:'staged'→'sending'→'sent'\|'failed', 'staged'→'canceled', 'staged'→'sent'\|'failed' (unclaimed: a 0.2.0 extension, or a late report for a released claim), staged_at, claimed_at?, released_at?, sent_at?, canceled_at?, result?{url,uri}, error?, by}`. `target`/`title` are additive optional platform routing (Reddit subreddit + title). `canceled_at` (additive, optional) is set by the popup's Skip route; the MCP cancel leaves it absent. `sent_after_cancel?:true` (additive, optional, with `sent_at` + `result`) marks a `canceled` action the extension then reported as published — see the 2026-10-06 amendment. `'sending'`, `claimed_at`, `released_at` are additive (2026-10-07 claim amendment): `claimed_at` is stamped by the claim and kept on the settled `sent`/`failed` entry; a release removes it and stamps `released_at`. |
| `data/social/accounts.json` | extension (on connect) | `hq_social_status` | `{updated, accounts[]}`; account `{platform, handle, display?, connected_at}` |

**Write-gate invariant (load-bearing):** MCP `hq_social_post/_reply` only ever
append an action with `status:"staged"`. **Nothing transitions to `sent` except by a
human click in the extension popup** — there is deliberately NO MCP approve tool, so
Claude can stage a post but can never publish one. Don't add a server-side or MCP
auto-approve path without a security review here first.

**Amendment (v5 clean pass, S8) — cancel never publishes.** There are two ways to cancel,
and both only flip `staged → canceled`: MCP `hq_social_cancel` and the popup's **Skip**,
which calls `POST /social/outbox/cancel {id}` on the app relay (`dashboard/social-bridge.js`;
same `X-HQ-Bridge` + optional `X-HQ-Token` gate as the other routes). The route answers
`200 {ok, id, status:'canceled'}` and stamps `canceled_at`. It refuses anything that isn't
`staged` with `409 {ok:false, error:'not staged', status}` and leaves the file byte-identical.
An unknown id gets 404, a missing id 400, a failed auth check 403. A cancel never calls
an adapter or messages the extension, and never writes `sent_at`/`result`. `canceled` is
terminal: `GET /social/outbox` stops listing it and `/social/outbox/result` never turns it
into `sent` (see the 2026-10-06 amendment below for a success report that arrives late).
On the extension side, `socialSend` re-reads the outbox before it publishes. It refuses
(and reports nothing) when the post is no longer staged, when its payload
(`platform/op/text/reply_to/target/title`) differs from what the popup showed, or when the
app can't confirm either. So a post skipped or canceled while the popup was open can't
be sent from a stale card. Pinned by `dashboard/social-cancel.test.mjs`.

**Amendment (2026-10-06, clean-pass review contract-1) — a send that beats its cancel keeps
its URL.** The re-read above is check-then-act: nothing moves the action out of `staged`
while the adapter publishes, so a Skip (or `hq_social_cancel`) that lands during the
seconds-long in-flight send still answers `canceled`, and the post goes live anyway. Until
an atomic claim step exists, `/social/outbox/result` no longer drops that outcome: when it
reports `ok:true` for an action that is already `canceled`, the relay keeps
`status:'canceled'` (the action is still terminal, never re-listed, never `sent`) and records
`sent_at`, `result{url,uri}` and `sent_after_cancel:true`, answering
`200 {ok, id, status:'canceled', sent_after_cancel:true}`. `hq_social_outbox` returns
`sent_at`/`result` and, since 2026-10-06, `canceled_at` (or `null`) and `sent_after_cancel`
(boolean, `false` unless recorded) on every action, so Claude sees the post is live and where. Only the first such report is
recorded (a repeat is `ignored`); an `ok:false` report for a canceled action, and any report
for `sent`/`failed`, stays `ignored` and writes nothing. Additive: no status value changes,
the write-gate invariant is untouched (only a human-approved send produces a result).
The claim step below (2026-10-07) now closes this window for every cancel that goes
through the relay; the fallback stays for the one path that doesn't (the MCP cancel).

**Amendment (2026-10-07) — claim before publish.** Approve & Send now claims the post on
the app before any adapter runs, so a cancel that lands mid-send is refused instead of
recorded after the fact. Same `X-HQ-Bridge` + optional `X-HQ-Token` gate (403), same
64 KB body cap (413), and the body must be a JSON object (400) on every route below.

- `POST /social/outbox/claim {id, content_hash?}` atomically flips ONE `staged` action
  to `'sending'`, stamps `claimed_at`, and answers
  `200 {ok, id, status:'sending', claimed_at, action}`. The extension publishes that
  returned copy and nothing else. Anything not staged gets
  `409 {ok:false, error:'not staged', id, status}` (a second claim sees
  `status:'sending'`). A `content_hash` that doesn't match the app's copy gets
  `409 {ok:false, error:'content changed', id, status:'staged'}`. Both 409s leave the
  file byte-identical. An unknown id is 404, a missing id or a malformed `content_hash`
  400. The claim publishes nothing and never calls an adapter.
- `content_hash` = lowercase hex SHA-256 of the UTF-8 string
  `JSON.stringify([platform, op, text, reply_to, target, title])`, where null or
  missing values become `''` and every other value is `String(v)`. These are the six
  payload fields the popup shows; `social-bridge.js` `contentHash()` and `social.js`
  `socialContentHash()` must agree, and `dashboard/social-claim.test.mjs` pins that.
- `socialSend` (extension 0.3.0) keeps its staged + payload re-read, then checks that
  an adapter and a logged-in tab exist, so nothing is claimed that can't be sent. Then
  it claims with the hash of the post the human saw and publishes ONLY after a `200`
  claim. Any other answer (409, 404 from an app without the route, 403, a network
  error) means it refuses, publishes nothing and reports nothing. After a successful
  claim it always reports `/result`, including when the adapter throws.
- `POST /social/outbox/cancel` on a `'sending'` action now answers
  `409 {ok:false, error:'already publishing', id, status:'sending'}` and leaves the file
  untouched. Every other non-staged status still gets `'not staged'`. The MCP
  `hq_social_cancel` already refuses anything that isn't `staged`.
- `POST /social/outbox/result` settles `'sending' → 'sent'` (`sent_at`, `result`) or
  `'sending' → 'failed'` (`error`), keeping `claimed_at`. It still settles `'staged'`
  too, because an extension that wasn't reloaded (0.2.0) publishes without claiming
  and its outcome must not be dropped. The `canceled` + ok → `sent_after_cancel`
  branch stays as well (below). Everything else is still `ignored`.
- **Owner release (no auto-publish, ever).** If a claim gets no result (the extension's
  service worker died mid-send, or the app was down when the result came back), the
  action stays `'sending'`: it is off the approval card, and nobody can cancel it or
  claim it. After `CLAIM_STALE_MIN` = **10 minutes**, the owner can run
  `POST /social/outbox/release {id}`. It flips `'sending' → 'staged'`, removes
  `claimed_at`, stamps `released_at`, and answers `200 {ok, id, status:'staged', released_at}`.
  A younger claim gets `409 {ok:false, error:'claim still fresh', id, status:'sending',
  claimed_at, release_after}`. Anything not `'sending'` gets `409 'not sending'`. A
  `'sending'` entry with no readable `claimed_at` (a hand edit) can be released at once.
  A release only puts the post back on the approval card, where it still needs a human
  Approve & Send. Nothing releases on a timer. The route is owner-run by hand, from
  PowerShell on the app's machine (add `'X-HQ-Token'='<data/.bridge-token>'` when a
  token is set):
  `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47821/social/outbox/release -Headers @{'X-HQ-Bridge'='1'} -ContentType 'application/json' -Body '{"id":"<id>"}'`.
  **Check the platform first:** a stuck claim may have published (the result just
  never arrived). Re-approving a released post that is already live posts it twice. A
  late success report for a released post still lands (`staged → sent`), which takes
  it off the card.
- **Atomicity scope.** The relay reads, checks, mutates and writes the outbox
  synchronously in one event-loop turn, so a claim, a cancel, a result and a release
  that reach the relay serialize: exactly one of a racing claim and a Skip wins.
  `mcp/workspacehq/server.mjs` is a separate process with its own read-then-write and no
  lock. An `hq_social_cancel` whose read lands before a claim's write can therefore still
  overwrite `'sending'` with `'canceled'`. That publish is then recorded by the
  `sent_after_cancel` fallback above. Likewise, a `hq_social_post` staged in that same
  instant can overwrite a fresh claim back to `staged`. The late success report then
  marks it `sent`, but a second human Approve in that window would publish twice. The
  window is the MCP's own synchronous read-to-write gap. Closing it needs the MCP to
  write through the relay (not done).
- `GET /social/outbox` still lists `staged` only, so a `'sending'` post leaves the popup
  card and the v5 renderer's staged list. `hq_social_outbox` returns `claimed_at` and
  `released_at` (or `null`) on every action and accepts `status:'sending'`.
  `hq_social_status` counts `outbox.sending`.
- The write-gate invariant is unchanged. Nothing reaches `sent` except a human-approved
  send, and claim and release never publish.

### `data/claude/` — Claude Hub index (frontend lane, local only, gitignored)

`data/claude/hub.sqlite` (+ `-wal`, `.lock`): SQLite schema v1 (`dashboard/claude-hub/store.mjs`).
Written only by the Hub process; never read by `collector/` or committed. Shape changes bump
`SCHEMA_VERSION`; an older app refuses a newer db instead of corrupting it.
(2026-10-14, additive) `meta.index_version` (`INDEX_VERSION` in `dashboard/claude-hub/ingest-code.mjs`) records which
parsing/masking produced the rows; when it is missing or lower, the next writer rebuilds the code index from the
transcripts (tombstones and projects kept). The first one: secrets masked on the full text before any cut. The lock
file holds `{"pid","db"}` (a plain pid is still read).
(2026-10-16, additive, H2) `INDEX_VERSION` 2: cwd masked, surrogate-safe cuts — the next writer rebuilds once.
`project.hq_project_id`/`link_state` are now written (auto-match from `data/latest.json`, read-only; owner choices
`confirmed`/`rejected` are never overwritten). `meta.last_error_at` / `meta.last_error_file` timestamp the last ingest
error and clear when that file ingests cleanly. Writer connections use `secure_delete`.
(2026-10-16, H4, additive) claude.ai rows: `source='web'`, ids `web:<uuid>` (chats without a claude.ai project live under
the synthetic project `web:chats`, "claude.ai chats"); `web_sync` is now written (export + live sync de-dup);
`meta.last_import` (JSON `{at, ok, report|error}`) and `meta.last_sync_at`. `data/claude/tmp/import-*/` holds one
import's two extracted JSON files and is removed when that import ends (success or failure). No schema or index-version change.
(2026-10-25, H6, schema 2 — migrated in place by the first schema-2 writer; an older app refuses the db) New tables:
`document(id PK, source NOT NULL 'memory'|'claude-md'|'prompt'|'history', path, title, text NOT NULL DEFAULT '' (masked),
project_id, project_path, mtime_ms, size, meta JSON)` with FTS5 `document_fts(title, text)` (external content, same tokenizer
as `message_fts`); `prompt_use(prompt_id NOT NULL, at NOT NULL, target NOT NULL, project_id, conversation_id)` (written from
phase P3 on). Ids: `memory:<sha1 of path>`, `memory:chatgpt:<sha1 of text>`, `claude-md:<sha1 of path>`, `prompt:<sha1 of
path>`, `history:<sessionId>:<byte offset>`. `ingest_cursor` row `file='history.jsonl'` = the byte cursor of
`~/.claude/history.jsonl` (never rewritten). `conversation.source` gains `'chatgpt'` (ids `chatgpt:<id>`, project
`chatgpt:chats`); `web_sync` kind `'chatgpt'` de-dups re-imports; tombstone kind `'document'`. `index_version` unchanged.
`data/claude/imports-seen.json` = which dropped ZIPs were answered (main-written).
(2026-10-25, P3, additive) `prompt_use` is now written: one row `{prompt_id, at, target, project_id, conversation_id:null}` per
successful prompt run (`chat` | `terminal` | `claude.ai` | `chatgpt`), by the Hub op `promptUse` only. No schema or index change.
(2026-10-25, P2, additive) `tombstone` gains kind `candidate` (`native_id` = `cand:<sha1 of the normalized prompt text>`,
written by the Hide button through the Hub op `hideCandidate`): that text is never offered as a prompt candidate again.
No schema or index-version change (`SCHEMA_VERSION` stays 2).

#### Local bridge routes — Claude Hub live sync (H4, 2026-10-16; `dashboard/claude-bridge-routes.js`)

Same server as `/ingest/*` and `/social/*` (`127.0.0.1:47821`), same auth: header `X-HQ-Bridge: 1` plus
`X-HQ-Token` when `data/.bridge-token` exists (403 otherwise). Only client: the WorkspaceHQ Bridge extension ≥ 0.4.0.

| Route | Body / answer |
|---|---|
| `GET /claude/sync-state` | → `{ok:true, conversations:{<claude.ai chat uuid>: updated_at\|null}, projects:{<project uuid>: updated_at\|null}, forgotten:[<chat uuid>]}` — the extension fetches only chats whose claude.ai `updated_at` is newer, and never a forgotten one |
| `POST /claude/sync` | `{v:1, items:[{kind:'conversation'\|'project', data:<claude.ai JSON as fetched>}]}`, 1–50 items, ≤ 4 MB per request (413), `data.uuid` = `[A-Za-z0-9-]{1,80}`, a conversation's `data.chat_messages` an array (400 with the reason otherwise) → `{ok:true, report}` (counts only: `conversations/projects {seen, imported, unchanged, forgotten, skipped}`, `messages {imported, skipped, empty}`, `unknownFields {name: count}`); 409 when this app's Hub is a read-only reader, 503 when the Hub is not running |

Stored as Hub rows `web:<uuid>` (`source='web'`), de-duplicated through `web_sync(kind, native_id=<uuid>, updated_at)`
— the same table the export import writes. A forgotten chat/project (tombstone) is never re-created.

### `VEEMO CORTEX/30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md` — Claude chat notes (frontend lane, owner's vault, Claude Hub H5)

Written only by `dashboard/claude-vault.js`, one note per owner-confirmed Save. Names: `safeSegment` (no `/:*?"<>|[]#^`, no control chars, no leading dot / trailing dot or space, DOS device names prefixed `_`, ≤ 60 code points); a name used by another chat takes ` (2)`…` (9)`. Frontmatter (YAML; strings JSON-quoted): `source` (`claude-code` | `claude.ai` | `chatgpt` — H6, additive), `conversation` (Hub id — how a later Save recognises "this chat's own note"), `project` (`"[[<WorkspaceHQ project note or Claude project name>]]"`), `created` (YYYY-MM-DD), `chat_date`, `title`, `drafted_by` ("local model <id>, from N chat messages"), `tags: [claude]`. Body: `# <title>`, a `Project: [[…]]` line, then the owner-edited Summary / Decisions / To-dos / Links. The structure lane's pipeline never writes here; Ask's Vault source reads these notes like any other (they carry no `generated_by: workspacehq-pipeline`).

### `VEEMO CORTEX/40_Resources/Prompts/<slug>.md` — prompt notes (frontend lane, owner's vault; prompt library P1 format, P2 writes)

The owner's prompt library; the vault is the source of truth (spec 2026-10-15 §6.1). The Hub only reads the folder (top level,
`*.md`, H6 `ingest-docs.mjs`). WorkspaceHQ writes only NEW notes the owner confirmed (Promote, from phase P2), through
`writePromptNote` in `dashboard/claude-prompts.js`: atomic (temp + hard link), never an overwrite — a clash is refused and
offers `<slug>-2.md`…`<slug>-9.md`. File name = `slugify(title)` (`dashboard/claude-prompt-note.js`: NFKD, ASCII letters/digits,
`-` separators, ≤ 60 chars, Windows device names prefixed `prompt-`, empty → `prompt`). Frontmatter (YAML; strings
JSON-quoted): `title`, `tags: [a, b]`, `variables: [a, b]`, `version: 1`, `created` (ISO), `source: { kind, conversation, at }`
(harvested only), `hq: { id: "prompt:<sha1 of the lowercased absolute path>" }` (harmless if removed). Body = the prompt;
variables are `{{name}}` tokens (`{{project}}` / `{{cwd}}` filled from the chosen project at run time). Bodies written by
WorkspaceHQ are masked (`maskSecrets`). The structure lane never writes here.
(2026-10-25, P2) The writer is Promote (`claudePrompts.promote`, Claude › Prompts › Candidates), one note per owner-confirmed
candidate; `source.kind` ∈ `code` | `web` | `chatgpt` | `history`, `source.conversation` = the Hub id the text came from
(`code:<sessionId>`, `web:<uuid>`, `chatgpt:<id>` or `history:<sessionId>:<offset>`), `tags: [harvested]` by default.
(2026-10-25, P3) Import pack also writes here: new notes only (an existing name is skipped and counted), names `slugify(<entry
base name>).md`, bodies masked, a note without frontmatter given `title` + `tags: [imported]`, atomic through `writePromptNote`. Export pack only reads the folder.

## 2026-10-16 · struct · quests re-raise (additive)
A done quest whose condition returns is raised again as a NEW quest with id `<old id>-r<N>` (N ≥ 2),
`created` = that scan's date and `reopened_from` = the old id; the old done quest stays in `quests[]`
for history. A dismissed quest is never re-raised. No shape change: `reopened_from` is a new optional
string field on quest objects. Also: `collector/enrich.mjs` now launches Claude through the real
binary (or the npm shim via a shell) — Node ≥ 20.12 refused the `.cmd` shim, so every scan since
August carried the 2026-08-10 enrichment forward; the default model is the CLI alias `sonnet`.

## 2026-10-26 · struct · pc-health.json says more (additive)
`data/pc-health.json` (gitignored sidecar, `collector/pc-health.mjs` → shaping in `collector/lib/pc-health.mjs`):
- `organs[gpu].value` is now the real VRAM of the biggest GPU (display-class registry `qwMemorySize`, or nvidia-smi's
  total); WMI's 32-bit `AdapterRAM` capped every card at ~4 GB. Fix commands and their `danger` levels are unchanged
  (main.js `hq:health-fix` still whitelists only `danger:'safe'`); the disk organ gains one safe fix (Storage settings).
- New optional organ `battery` (`value` = %, only when Windows reports a battery).
- New optional `detail`: `{ gpus[], gpuLive|null, topRam[], topCpu[] (share of the whole CPU), hogs|null {at, partial,
  items[{path, label, gb}], fresh}, recycleGB, storage[], battery|null, power{plan}, network|null, displays[],
  rebootPending, startupApps[], uptimeHrs, unreadable[] }` and `trends[{id, dir, bad, text}]` (only what the history backs).
- `host` gains `plugged`, `gpu`, `vramGB`. `data/pc-health-history.json` keeps 96 samples (+ `gpuTempC`, `battery`).
- New gitignored cache `data/pc-health-disk.json`: the folder-size breakdown, re-measured at most every 6 h.
Older sidecars without `detail`/`trends` stay valid: every consumer treats them as absent.

## 2026-10-26 · struct · new sidecar data/github.json (additive, owner-authorized)
`data/github.json` (gitignored — holds private repo names and PR titles; `collector/github.mjs` → shaping in
`collector/lib/github.mjs`, optional pipeline step after pc-health). Read-only, through the owner's own `gh` login
(no stored token); two GraphQL calls; a snapshot younger than 10 min is kept (`--max-age=<s>` overrides).
- `{ v:1, state:'ok', at, login, partial, errors[], totals{repos, private, archived, stars, openPrs, openIssues,
  ciFailing, cloned, waiting|null}, repos[{full, name, url, private, fork, archived, pushedAt, stars, forks, desc, lang,
  openPrs, openIssues, branch, lastCommit{at,title}|null, ci:'success'|'failure'|'error'|'pending'|null, local:path|null}],
  waiting[{kind:'review'|'assigned'|'on-your-repo', repo, number, title, url, updatedAt, author, draft, ci}],
  mine[{kind:'mine', …same}], issues[{repo, number, title, url, updatedAt, author}] }` — lists capped at 30, newest first.
- Failure: `{ v:1, state:'no-gh'|'signed-out'|'error', at, error }`; when a good snapshot exists it is kept instead,
  with `stale:true, staleReason, checkedAt`. `partial:true` (+ `totals.waiting:null`) = the PR/issue search failed.
- `local` = a clone found on this machine (scanned project paths + direct children of Documents and Desktop) whose
  `origin` points at the repo. `latest.json` / `projects[]` are untouched (remote-only repos are Front B's job).
- `dashboard/build-data.mjs` bakes it as `DATA.github` (null when absent).

## 2026-10-26 · struct · own repos become projects (additive, owner-authorized — data overhaul Front B)
`projects[]` grows on its own: besides the hand-kept `products[]`, every git repo under `root` and the new
`discover_roots` (config; seeded `["~/Desktop"]`, up to `discover_depth` = 3 levels) becomes a scored project when its
GitHub owner is in `owner_logins` (seeded with the owner's login), it has no remote at all, or it is on `adopt`.
Respected as before: `ignore` (top-level names under root), configured products / vaults / clones (neither candidates nor
searched inside). Never descends into a repo, `node_modules`, dot-folders or pruned names; a worktree/submodule (`.git`
file) is not a project. Third-party clones stay inventory.
- raw-metrics `products[]` and latest.json `projects[]` gain optional `discovered: 'owner'|'no-remote'|'adopted'` on
  those entries only (absent on configured products — the golden sample is unchanged).
- Their `id` is a slug of the folder name (parent-qualified, then numbered, on a clash); `name` is the folder name
  (a generic one like `theme` gets its parent's name in front). `path` stays relative to `root` when inside it; a repo
  outside `root` (Desktop) carries its absolute path with forward slashes.
- Main accepts an absolute project path outside Documents only when it is exactly a tracked project's path in the
  current latest.json (`dashboard/project-paths.js`, used by main.js `resolveProjectPath` and session-api.js).
- The first scan with this on found 15 own repos (24 projects); the collector takes ~40 s instead of ~15 s.
