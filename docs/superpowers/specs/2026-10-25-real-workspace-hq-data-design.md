# Real WorkspaceHQ — the data layer that tells the truth (design)

Status: DRAFT for owner approval. Date: 2026-10-25. Lane of author: frontend.
Most of this work lands in the **structure** lane + the **data contract**, so it is written
as handoff asks (see §7), not as frontend edits. A multi-agent build fleet was live in the
tree when this was written — nothing here was edited into shared code.

## 1. Intent — why

The owner opens WorkspaceHQ and sees "the same old state": projects they're actively working
on are absent, whole conversations are missing, and anything living only on GitHub (or ChatGPT,
or the web) is invisible. The UI is good; the **data is wrong and stale**, which makes the whole
app untrustworthy. The goal is to make the data *real, complete, and current* — every project,
every chat, the actual GitHub account — and keep it fresh so the app is never lying when opened.

This was diagnosed (three read-only recon passes, 2026-10-25) to four independent root causes,
all in the data layer, none in the UI. Each fix below cites the diagnosed mechanism.

## 2. Goals / non-goals / anti-goals

**Goals**
- The window never shows data older than the last scheduled scan — even if the app was closed.
- Every project the owner actually works on appears as a tracked project, discovered automatically.
- The GitHub account is visible globally (repos incl. private, PRs/issues on the owner, CI, stars).
- claude.ai + ChatGPT (and Comet) conversations join the already-indexed local Claude Code sessions.
- Carried-forward "soft" numbers (completion %/insights) are either fresh or honestly labelled stale.

**Non-goals**
- Not re-architecting the UI (it's fine). Not changing the gamification economy.
- Not indexing the 2,407 subagent/workflow child transcripts — deliberate noise exclusion.
- Not building a cloud backend. Everything stays local-first; GitHub/web calls are read-only pulls.

**Anti-goals (failure even if it "works")**
- Auto-tracking 41 repos including third-party clones (anthropics/microsoft/apache) → dashboard noise.
- A freshness fix that only works while the app is running (the current trap).
- Secrets (GitHub token, chat contents) leaking into git or to any host beyond the API being called.

## 3. Decided "how" (from the owner's survey, 2026-10-25)

- Work style: **write design + precise handoffs**, zero edits while the fleet is live.
- Project scope: **own repos only** — remote owner `Brvetr4ve1er`, plus local repos with no remote;
  exclude third-party clones/forks.
- Chat sources to add: **claude.ai web, ChatGPT history**, plus **Comet browser** (AI chat).
- Connected accounts (owner's "other"): **Vercel, Supabase** — the owner's most-used platforms,
  to be first-class connected accounts (deployments / databases) alongside GitHub, NOT chat sources.
  Confirmed wanted (not a stretch).
- GitHub view: **all repos incl. private · PRs waiting on me · issues assigned to me · CI/checks ·
  stars & recent activity**. Prerequisite: owner runs `gh auth login` (the author cannot).
- Freshness: **all four** — rebake on every scheduled scan · auto-start at login · a
  "last updated / stale" badge · scheduled enrichment refresh.

## 4. Constraints

- **Lanes (CLAUDE.md).** `collector/`, `schema/`, `run-pipeline.ps1`, `scan-prompt.md` = structure.
  `dashboard/`, `dashboard-v5/`, `mcp/workspacehq/` = frontend. `data/` shapes, `docs/`, `.gitignore`
  = shared (announce in HANDOFF first). Three of the four fronts here are structure-lane.
- **Data contract (docs/sync/CONTRACT.md).** Any new `latest.json` field / new sidecar is
  additive-only and announced in CONTRACT before code, with golden re-baseline
  (`collector/lib/__fixtures__`). New project auto-promotion and the GitHub/account sidecars are
  contract changes.
- **Local-first / privacy.** Cloud LLM stays refused. GitHub/web pulls are read-only and
  token/`gh`-mediated; tokens and raw chat content are gitignored, never committed, never sent
  anywhere but the originating API. Mask secrets on ingest (the Claude Hub already does this —
  reuse that redaction).
- **Live fleet.** The chat *library UI* is built (recent commits: a browsable chat library, search,
  in-app chat, workspace discovery). The claude.ai / ChatGPT **import** itself is spec'd and in the
  fleet's queue but **has not landed** — the ingest files (`ingest-web.mjs`, `ingest-chatgpt.mjs`)
  do not exist yet. So Front D is an open build to coordinate with the queue, not a duplicate.

## 5. The four fronts (each: the diagnosed cause → the fix)

### Front A — Freshness (the headline; makes the app honest tonight)
Cause: the renderer reads a **baked bundle** `dashboard/data.js` (loaded at
`dashboard-v5/index.html:21`, consumed via `window.DATA` in `src/boot.js`), regenerated **only**
by the Electron main process (`rebuildData()`, `dashboard/main.js:131-137`; at launch :1592, after
in-app scan :434, quest-done :352, and the `fs.watch` on `data/` :1575-1584). The scheduled nightly
scan (`VEEMO Nightly Workspace Scan`, ran today, exit 0) writes fresh `data/latest.json` but
**never rebakes `data.js`**, and the app has not launched since Oct 22 → UI frozen at Oct 22.
Second mechanism: soft fields (completion %/insights/roadmap/build/tests) are carried forward
(`collector/assemble.mjs:10-11,54-62`) and only refresh when `data/enrichment.json` is rebuilt,
but scheduled runs pass `-NoEnrich` (`run-scan.ps1:20`) → pinned at Oct 16 (`enrichment_age_days`
already in `latest.json`, never surfaced in v5).

Fix (ordered, smallest first):
1. **[struct] Re-bake on every scheduled scan.** In `run-pipeline.ps1` (render step ~:43-44), run
   `node dashboard/build-data.mjs` after `assemble`, so `data.js` is current whether or not the app
   is open. This is the single highest-leverage change (~3 lines) and makes the app honest without
   the app running.
2. **[fe] "Last updated / stale" badge.** Surface `scan` timestamp + `enrichment_age_days` in v5
   (currently rendered nowhere — grep of `dashboard-v5/` for `enrichment_age_days` → 0 hits). Show
   "data from <date>" and mark carried-forward soft fields "estimate · N days old" when age > 0.
   Zero-risk, high-trust; can ship first, even before A1.
3. **[struct] Scheduled enrichment.** Drop `-NoEnrich` on the nightly run (or add a separate
   scheduled enriching scan). `enrich.mjs` already has an 8-min timeout + graceful no-op if `claude`
   is absent; the CLI is present on this machine.
4. **[fe/main — fleet-gated] Auto-start at login.** The login-item is gated on `app.isPackaged`
   (`main.js:1589-1591`); the app runs unpackaged (`electron.exe . --hidden`) so it never
   auto-starts. Make the unpackaged `--hidden` launch register a login item (or a scheduled
   logon task) so the app is resident to catch scans live. NOTE: this is a **main-process** edit,
   which CLAUDE.md gates on "in-flight work landing" — that gate is **closed while the fleet is
   live**, so A4 waits, same as the struct asks. (A1 makes the app-resident path less critical:
   with scheduled re-bake, freshness no longer depends on the app running.)
5. **[fe] Surface silent bake failures.** `rebuildData()` discards `r.status`/`r.stderr`
   (`main.js:135-136`); log them so a failed bake is visible, not silently stale.

### Front B — Project coverage (own repos, discovered automatically)
Cause: tracked projects are the **hardcoded 9** in `collector/collector.config.json` `products[]`;
`collectProduct()` runs only over `cfg.products` (`collector.mjs:356`), and `assemble.mjs:78` sets
projects = products only. Discovery exists but is weak: single root `C:/Users/ROG STRIX/Documents`
(`config:3`), **top-level only** (`collector.mjs:406` non-recursive), and surfaces survivors as
unscored "unclassified folder" rows (`assemble.mjs:253`). Result: of ~41 independent git repos on
disk, 9 are projects, ~10 are demoted to folder rows, ~11 are invisible (Desktop never scanned,
nested repos unseen, ignore-list).

Fix:
1. **[struct] Multi-root.** Make `root` an array (or add `roots`): include `C:/Users/ROG STRIX/Desktop`.
2. **[struct] Recursive discovery.** The non-recursive top-level `readdirSync` at `collector.mjs:406`
   is the bottleneck; `collector/lib/discovery.mjs` already has a bounded `shallowStats`
   (`SHALLOW_DEPTH=3`). Walk to find nested `.git` repos.
3. **[struct] Auto-promote own repos to projects.** A discovered folder with `.git` becomes a
   scored project when git remote owner ∈ **`owner_logins`** (configurable; currently just
   `Brvetr4ve1er`), **or** it has no remote at all (local-only work, e.g. `artcv`, `chouchou voyages`,
   `noxkelp`). Third-party clones/forks (remote owner outside the set — e.g. `odysseus` →
   `pewdiepie-archdaemon`, confirmed NOT the owner's) stay inventory, not auto-promoted.
   **Manual adopt override:** the owner can pin any inventory repo as a tracked project — for
   third-party repos they are taking over. `odysseus` is the live example (wanted, not yet started).
   Implement as a small `adopt: [...]` allow-list in config and/or a "track this" UI action.
4. **[contract] CONTRACT.md entry** for the enlarged `projects[]` (additive) + golden re-baseline.

### Front C — GitHub account (global view)
Cause: no GitHub integration anywhere; `gh` not authenticated. Account `Brvetr4ve1er`
(≥15 public + unknown private) is seen only as ~10 local clones.

Prerequisite (owner): `gh auth login` (interactive; the author cannot run it). Everything in C
waits on this.

Fix:
1. **[struct] New data source** `collector/lib/github.mjs` (new file) that shells `gh` (preferred —
   uses the owner's existing auth, no stored token) to pull: repo list incl. private
   (`gh repo list --json ...`), PRs where the owner is requested/assigned
   (`gh search prs --review-requested=@me` / `--assignee=@me`), issues assigned (`gh search issues
   --assignee=@me`), CI/checks for the owner's repos, and stars/recent activity. Writes a gitignored
   sidecar `data/github.json`. Read-only; honours a rate budget; degrades gracefully when `gh` is
   unauthenticated (clean "connect GitHub" state, like the Hub's no-Node state).
2. **[contract] CONTRACT.md entry** for `data/github.json` shape (new sidecar, additive).
3. **[fe] Surface** a GitHub view in v5 (repos, "waiting on you" PRs/issues, CI, activity) and
   cross-link account repos to their local clones where present.
4. **Join with Front B:** an owner repo that exists on GitHub but is *not* cloned locally still
   appears as a project (remote-only), satisfying "own repos + whole account".

### Front D — Chats + connected accounts
Cause: local Claude Code sessions are indexed (96/97) and now browsable (fleet work). **claude.ai
web = 0, ChatGPT = 0** ingested (both designed, unbuilt — `2026-10-13-claude-hub-design.md §5.2/5.3`
"H4 claude.ai"; `2026-10-15-archive-and-prompt-library-design.md` ChatGPT export).

Fix:
1. **Coordinate with the queue.** The claude.ai/ChatGPT import is spec'd and queued for the fleet
   but not yet landed. This design's job: (a) confirm scope against that queued work so the build
   doesn't collide, and (b) add the owner's extra sources. If the fleet never gets to it, it becomes
   a direct build on the Hub's ingest path.
2. **[fe, Hub lane] Add Comet browser** as an AI-chat source (same ingest→index→library path as the
   other web chats, via export or the browser bridge).
3. **[struct] Connected accounts — Vercel & Supabase (owner's most-used).** Not chats: ingest
   deployments (Vercel) and projects/DB health (Supabase) as account sidecars, same pattern as
   GitHub (Front C) — surfaced as "connected accounts." Built right after GitHub (reuses the
   account-integration pattern); separate CONTRACT entries; read-only via the owner's existing
   Vercel/Supabase credentials.

## 6. Sequencing (one front at a time; honest-first)

1. **Front A** (freshness) — ship A2 badge first (fe, zero-risk), then A1 rebake (struct),
   then A3/A4/A5. Makes the app honest immediately.
2. **Front B** (own-repo auto-discovery) — struct + CONTRACT.
3. **Front C** (GitHub) — after `gh auth login`; struct source + CONTRACT + fe surface.
4. **Front D** — align with the fleet's queued claude.ai/ChatGPT work; add Comet; then connected
   accounts (Vercel/Supabase), which reuse the Front C account-integration pattern.

## 7. Handoff asks (ready to file in docs/sync/HANDOFF.md when the tree is clear)

To the **structure** lane:
- `run-pipeline.ps1`: add a `build-data.mjs` bake step after assemble (Front A1).
- `run-scan.ps1`: drop `-NoEnrich` on the scheduled path, or add a scheduled enriching scan (A3).
- `collector.config.json` + `collector.mjs` + `collector/lib/discovery.mjs`: multi-root, recursive
  discovery, own-repo auto-promotion (Front B1-B3).
- New `collector/lib/github.mjs` + `data/github.json` sidecar (Front C1); later Vercel/Supabase (D3).
- `docs/sync/CONTRACT.md`: entries for enlarged `projects[]`, `data/github.json`, and the account
  sidecars; golden re-baseline (Front B4, C2, D3).

To the **frontend** lane (author can take these once the fleet clears / on authorization):
- v5: last-updated + stale/enrichment-age badge (A2); auto-start-at-login for the unpackaged launch
  (A4); log bake failures (A5); GitHub view (C3); Comet source in the chat library (D2).

To the **live fleet** (coordination): confirm the claude.ai/ChatGPT import scope so Front D doesn't
collide or duplicate.

Owner action (blocking Front C): run `gh auth login`.

**Filing note:** these asks are written here now; the actual `docs/sync/HANDOFF.md` entry gets
appended the moment the fleet goes quiet — appending to a file 19 agents are concurrently writing
is exactly the careless concurrent edit the lane protocol forbids.

## 8. Author's calls (settle unless the owner objects)
- Vercel/Supabase read as **accounts**, not chat sources → Front D3 stretch. [confirm]
- "Own repo" = git remote owner ∈ `owner_logins` set OR no remote. `owner_logins` seeds with
  `Brvetr4ve1er` + `pewdiepie-archdaemon` (pending owner confirmation that the latter is theirs).
  Monorepos/nested repos: the innermost `.git` is the project; a parent without `.git` is a folder.
- GitHub pulled via `gh` (owner's existing auth) rather than a stored PAT — no secret to manage.
- Subagent/workflow child transcripts (2,407) stay excluded.

## 9. Verification (per front, when built)
- A1/A3: run the scheduled pipeline with the app closed; confirm `dashboard/data.js` mtime advances
  and `enrichment_age_days` resets. A2: badge shows the real scan date + stale marker in v5
  `?selftest`-clean. A4: reboot → app resident, catches a scan live.
- B: a new own-repo created under Documents/Desktop appears as a scored project on next scan;
  a third-party clone does not; goldens re-based with a CONTRACT note.
- C: after `gh auth login`, `data/github.json` lists private repos + PRs/issues on the owner;
  v5 shows them; an un-cloned own repo appears as a remote-only project.
- D: a claude.ai/ChatGPT/Comet conversation is searchable in the chat library next to Claude Code.
