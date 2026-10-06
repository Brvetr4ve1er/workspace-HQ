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
the MCP server (`dashboard-v3/mcp/server.mjs`) reads them via `hq_social_*` tools.
**Not consumed by `build-data.mjs`/the renderer** — no `latest.json` field, no
golden fixture. All `data/social/*` is **gitignored** (personal content + session).

| File | Written by | Read by | Shape |
|---|---|---|---|
| `data/social/inbox.json` | app relay (extension ingest) | `hq_social_feed/_mentions/_metrics` | tendril doc: `{updated, live, events[]}`; each event `{platform, kind:'feed'\|'mention'\|'notification'\|'metrics', id, ts, author?, text?, url?, uri?, counts?{likes,reposts,replies}, metrics?{followers,following,posts}}` |
| `data/social/outbox.json` | `hq_social_post/_reply` (stage), `hq_social_cancel` + popup Skip (cancel), extension (send result) | `hq_social_outbox`, extension popup | `{updated, actions[]}`; action `{id, platform, op:'post'\|'reply', text, reply_to?, target?, title?, status:'staged'→'sent'\|'failed'\|'canceled', staged_at, sent_at?, canceled_at?, result?{url,uri}, error?, by}`. `target`/`title` are additive optional platform routing (Reddit subreddit + title). `canceled_at` (additive, optional) is set by the popup's Skip route; the MCP cancel leaves it absent. `sent_after_cancel?:true` (additive, optional, with `sent_at` + `result`) marks a `canceled` action the extension then reported as published — see the 2026-10-06 amendment. |
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
`200 {ok, id, status:'canceled', sent_after_cancel:true}`. `hq_social_outbox` already returns
`sent_at`/`result`, so Claude sees the post is live and where. Only the first such report is
recorded (a repeat is `ignored`); an `ok:false` report for a canceled action, and any report
for `sent`/`failed`, stays `ignored` and writes nothing. Additive: no status value changes,
the write-gate invariant is untouched (only a human-approved send produces a result).
Planned follow-up (not shipped): `POST /social/outbox/claim` flipping `staged → sending`
atomically before the adapter runs, so a cancel during a send is refused instead of
recorded after the fact.
