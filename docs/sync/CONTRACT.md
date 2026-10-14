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
