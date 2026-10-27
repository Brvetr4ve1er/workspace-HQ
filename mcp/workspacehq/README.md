# THE BINDING — WorkspaceHQ MCP server

`mcp/workspacehq/server.mjs` — stdio MCP server (charter M3, "The Binding").
Any repo Claude session that binds it gains `hq_*` tools over the same `data\`
files the app reads and writes. **File-mediated v1**: zero dependencies, no HTTP,
no tokens — it works with the app closed, and when the app is open the two never
fight because every mutation mirrors the app's own write shapes byte-for-byte
(`applyDone`, `hq:capture-save`, `hq:canvas-add` in `dashboard/main.js`).

Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout, MCP protocol version
`2024-11-05`, capabilities `{ tools: {} }`.

## Tools

| Tool | Args | Does | Freshness |
|---|---|---|---|
| `hq_status` | — | Level, XP, health index, open/red quest counts, streak, project count from `data/latest.json` | as of last scan |
| `hq_quests_list` | — | All quests + side-quests (`id, title, tier/kind, status, project, xp`) with `quest-overrides.json` overlaid | live for completions, rest as of last scan |
| `hq_quest_done` | `{id}` | Marks a quest/side-quest done in `data/quest-overrides.json` (`{status:'done', completed:'YYYY-MM-DD'}` — the exact `applyDone` mutation). Unknown ids refused against the current scan. Atomic write. | XP settles on next app assemble |
| `hq_capture` | `{text}` (≤4000) | Appends `{id, ts, text}` to `data/brain-dump.json` — same store as the Ctrl+Alt+Space box | surfaces as a side-quest on next assemble |
| `hq_canvas_read` | `{name?}` | No name: list boards in `data/canvas/` with node/edge counts. Named: full board JSON | live |
| `hq_canvas_add` | `{name, text, x?, y?}` (text ≤2000) | Appends a text node (`280×120`, default position `40,40`) to `data/canvas/<name>.canvas`, creating the board if absent. Atomic write | **near-live** — the app fs-watches `data/canvas/` |
| `hq_canvas_remove` | `{name, id}` | Removes one node and every edge touching it from `data/canvas/<name>.canvas`; the node and its edges are appended to `data/canvas/removed.jsonl` first. Same rule as the app's Remove (`hq:canvas-remove`). Atomic write | **near-live** |
| `hq_scan_trigger` | — | Spawns `collector/collector.mjs` detached and returns `{started:true}` immediately | raw metrics only; assemble + enrichment on next app scan/relaunch |

The social tools (`hq_social_status/_feed/_mentions/_metrics/_post/_reply/_outbox/_cancel`)
and their outbox shape are specified in `docs/sync/CONTRACT.md` ("Social bridge sidecars").
`hq_social_outbox` returns `canceled_at` (or `null`) and `sent_after_cancel` (boolean) on
every action. `sent_after_cancel: true` means a canceled post went live anyway.

Tests: `node --test mcp/workspacehq/server.test.mjs`. The test runs a copy of the server
against fixture data in a temp folder.

Errors come back MCP-style: `result.isError: true` with a JSON `{error}` payload
in the text content — the loop never dies on a bad call, bad JSON line, or an
unknown method (`-32601`).

## Registering (Claude Code)

Command-type entry in the repo's `.mcp.json` (adding it there is the
orchestrator's move — this is the shape):

```json
{
  "mcpServers": {
    "workspacehq": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp/workspacehq/server.mjs"]
    }
  }
}
```

The server resolves `data\` from its own file location, so cwd doesn't matter.
Smoke test without any client:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hq_status"}}' | node mcp/workspacehq/server.mjs
```

Charter acceptance: a repo session binds via `.mcp.json`, calls `hq_status`,
and completes a real quest via `hq_quest_done`.

## v1 limits (read before trusting it with your life)

- **File-mediated only.** Quest completions and captures land in
  `quest-overrides.json` / `brain-dump.json`; the app folds them in (XP, board,
  tray) the next time it assembles — on reload, its own capture, or a scan. The
  app stays the only assemble runner; the MCP never rewrites `latest.json`.
- **Canvas is the near-live exception**: the app watches `data/canvas/`, so
  `hq_canvas_add` nodes appear on an open board within ~300 ms.
- **The charter's token-gated localhost endpoint** (`data/.mcp-token` pattern)
  for live-app mutations — shard summons, session spawning, instant re-assemble —
  is **deferred to v2**. No tokens exist in v1 because nothing crosses a network
  boundary: stdio in, files out.
- **`hq_scan_trigger` is fire-and-forget** — raw collector pass only, no job-id
  polling yet (v2, per charter: "long jobs = job-id + poll").
- Safety rails: every path is resolved and prefix-checked under
  `<repo>\data\` before any read/write; capture text clamps at 4000 chars,
  canvas text at 2000; board names match `^[\w][\w -]{0,63}$` (no dots, no
  separators) — same rail as the app.
