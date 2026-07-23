# MA — THE UNTANGLING

Milestone spec per the NEXUS v3 charter. Gate: other-session landing —
satisfied 2026-07-23 (`668a6a2`). All frontend-lane files. Gates M3
(Summoning Circle needs the session registry + hardened shards).

## Discovered seams (ground truth, main.js @ ad13f59)

- `hq:draft-commit` (~721): **blocking `spawnSync(claude -p)` with 90s
  timeout on the main process** — the single worst freeze in the app.
- `hq:do-commit` (~734): blocking git add/commit + a FULL collector run +
  assemble, all sync — seconds of frozen UI per commit.
- `findClaude()` (~713): re-probes `claude --version` (spawnSync) on every
  call; shard conjuring resolves it independently (~592).
- Shard conjure (~592-613): already async `spawn` but untracked — no
  registry, no presence, no kill.
- Cast engine (~939): `doCast` already threads `chainId` through
  output/done/telemetry; `hq:spell-cast` line ~1000 rejects `kind==='chain'`
  ("arrive in a later phase") — the runner is the only missing piece.
- Shard windows (~516) and summon palette load the FULL preload.js —
  conjured (Claude-written) HTML gets castSpell/doCommit/reclaim/etc.
  Actual usage: shard.html needs only {shardClose, shardRegen, shardSave,
  markQuestDone, showMain, shardLibSpawn, shardLibDelete, onShardInit};
  summon.html needs {shardSummon, shardSummonCancel}.

## Deliverables

1. **`dashboard/claude-sessions.js`** (NEW, CommonJS): unified `findClaude()`
   (probe once, cache) + `sessions` registry mirroring castRegistry's
   lifecycle: `start({label, args, input, cwd, timeoutMs, onOutput, onDone})`
   → `{jobId}`; `list()` (id, label, status, startedAt, tail); `kill(id)`;
   never a sync spawn. Registry changes push `hq:claude-sessions` to the
   windows (v3 ambient rail's Familiar slot is the consumer).
2. **main.js conversions** (new-file logic + thin hooks, invariant 3 style):
   draft-commit → async via registry (same `{message}|{error}` contract —
   invoke() already returns a promise to the renderer); do-commit's
   collector+assemble tail → async spawn chain (reload AFTER assemble);
   shard conjuring → routed through the registry (tracked + killable).
3. **Chains/Ultimates**: remove the line-1000 gate; `doChain` runs members
   sequentially via `doCast(..., {chainId, onDone})` (additive opts.onDone in
   finish()), halts on fizzle, records a chain-level telemetry cast, synthetic
   castRegistry entry so already-casting + cancel work. Confirm gate applies
   to the chain's own content_hash (spellbook.mjs already validates refs;
   v2+v3 renderers already display `chain` kind).
4. **Preload hardening**: `organic/shard-preload.js` + `organic/
   summon-preload.js` exposing exactly the surfaces above; spawnShard and the
   summon window flip `webPreferences.preload`. capture/cast/mini windows keep
   the full preload for now (static local HTML, not conjured — noted for
   their M3/M6 ports).
5. **Tendril router**: generalize `startBridge()` in `dashboard/
   browser-bridge.js` — `POST /ingest/<tendril>` routed to per-tendril
   sidecar writers sharing atomic tmp+rename (Windows EPERM retry), dedup
   keys, rolling windows, sanitize/clamp. Browser tendril = first client,
   byte-compatible output (`data/browser-activity.json` unchanged —
   CONTRACT.md untouched). Preps M4 NotebookLM + M5 Watchtower sidecars.

## New IPC (additive, rows added to IPC-CONTRACT.md with this landing)

- `hq:sessions-list` (invoke) → `sessions.list()`
- `hq:claude-sessions` (push) → fired on any registry change

## Verification

- `node --check` every touched CJS file; registry unit-tested standalone
  (fake command) under plain node.
- Bridge router: byte-compare `browser-activity.json` before/after a
  simulated POST (contract must not move).
- Full-app verify (draft-commit non-blocking, chain cast, hardened shard)
  requires an app restart — deferred to the user's next restart; nothing
  here changes the v2 renderer contract.
