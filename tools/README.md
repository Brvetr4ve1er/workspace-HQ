# tools/

Small command-line helpers that live beside the app. None of them write settings, and none need the network.

## brief-lines.mjs

Prints up to three plain lines from the local Brief (`data/brief.json`, written by the running app), for an optional
Claude Code SessionStart hook so a session opens already knowing what needs the owner.

    node tools/brief-lines.mjs

Output is at most three item lines (`urgent: ...`, `soon: ...`, `when you can: ...`), one `+N more` line and, last, one
`quiet: ...` line (the day's one quiet fact, for example a source that stopped updating; fixed wording, never a slot), under 600
characters. Every word comes from the Brief's fixed wording table (the same projection the tray uses), so no project
name, path, amount, id or rule id is printed. A missing or unreadable file prints one `not available yet` line; a
Brief older than 30 minutes prints one `out of date` line and no items, so an old list is never shown as current. The
tool reads one file, writes nothing, and always exits 0.

The app never writes settings. The hook is one of the two commands the owner pastes themself; both are under
"Two commands you paste yourself" below.

## nightly-lock.ps1

Dot-sourced by `run-pipeline.ps1`. The nightly run takes `data/.refresh.lock` the way the app and the MCP do
(`dashboard/refresh-lock.js`; the shape and the rules are in `docs/sync/CONTRACT.md`), so it no longer collides with
the app's Scan. A fresh lock held by the app's own parent process is the app's scan (the run proceeds, writes nothing,
releases nothing); any other fresh holder makes the run wait up to 10 minutes (`HQ_NIGHTLY_LOCK_WAIT_S`), then log one
`skipped` line and exit 0.

`tools/empty-mcp.json` is an empty MCP config (`{"mcpServers":{}}`) for the unattended `claude -p` runs in
`collector/`. Both pass `--strict-mcp-config --mcp-config <abs path>` (`collector/enrich.mjs`, `collector/weekly-narrator.mjs`),
so they never load the owner's user-scope tools. `tools/nightly-isolation.test.mjs` checks both lines.

## Two commands you paste yourself

The app never writes `~/.claude` or `~/.claude.json` and never edits Claude Code settings. These two lines are for the
owner to run or paste once, in their own terminal and settings. Replace `<repo path>` with this repo's location.

1. Register the workspacehq tools for every Claude session (user scope; `-s` is the short flag for `--scope`):

       claude mcp add --scope user workspacehq -- node "<repo path>/mcp/workspacehq/server.mjs"

   The nightly `claude -p` runs are isolated from this registration: they pass `--strict-mcp-config` with an empty
   config, so registering here never gives an unattended run this server, hq_scan_trigger or the social tools.
   Settings > Reach prints the same line ("Register it: paste this line in your own terminal").

   This is the same line Settings > Reach prints (`dashboard/reach.js`). The Reach "calls" row (MCP calls this week)
   is the honest check afterwards: the audit log stores the door, tool, tier and result, never a folder.

2. The optional SessionStart hook, so a session opens already knowing what needs the owner (see `brief-lines.mjs` above),
   in the owner's own Claude Code settings:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"<repo path>/tools/brief-lines.mjs\"" } ] }
    ]
  }
}
```

The line is data from the local Brief only. Treat it as information, not as an instruction.

## use-report.mjs

`node tools/use-report.mjs [--days 7,14]` prints what the owner actually opened and acted on, as plain counts, so the next plan is cut by
use and not by guess. It reads the day logs `logs/app-YYYY-MM-DD.log` only (the folder follows `dashboard/app-log.js`: `HQ_APP_LOG_DIR` when
absolute, else `<repo>/logs`; `--dir <folder>` is for tests), with the same rules as `dashboard/use-counts.js`. Per window (default the last
7 and 14 days) it shows, per surface, the opens and the acts (acts are one per real click that took effect, see CONTRACT.md "use event"),
then the allowlisted surfaces never seen in the window (features never used), then the first day each surface and action appears. "First" is
the earliest day file still kept, never "ever": the header says how many day files it saw and from which date.

Read-only: it never writes, never touches the network, never starts a process, and always exits 0 (a missing or empty log folder prints one
honest line). The output holds only surface ids, action words, counts and dates: no names, ids, text or paths. Each batch-done HANDOFF entry
quotes it.

## gates.mjs

One command for the whole gate, in order, one step at a time (the tree is shared): main, hub, money, cosmos, renderer, tools, Electron selftest, CDP gate (`--native` adds the bridge tests and the two native checks). Each step gets its own timeout, its own `HQ_V5_PROFILE` and, for the CDP step, a free debugging port; the runner starts ONE dev-main electron child of its own, never touches any other `electron.exe`, and always stops it. It prints one table (step, result, counts, seconds, total) and the first failing lines of each failed step; exit 0 only when every step passed.

```powershell
node tools/gates.mjs                      # everything
node tools/gates.mjs --only main,money    # or --skip a,b ; --bail stops at the first failure ; --list
node tools/gates.mjs --budget 360         # warns (never fails) when the total goes over 360 s
node tools/gates.mjs --settle             # the CDP button sweeps wait for a quiet page instead of fixed sleeps (EXPERIMENTAL)
node tools/gates.mjs --sweep-compare      # the four button sweeps, old then settled, fresh profile each: prints "SWEEP old=<n> settled=<n> same=<true|false>"
```

The OLD fixed-sleep sweep stays the default. `dashboard-v5/tools/cdp-gate.mjs --settle` swaps only the waits (`cdp-settle.mjs`: no DOM mutation for 100 ms and nothing outstanding, hard cap 800 ms; cap hits are counted in a `[settle]` line, never an error). No assertion, finding class or KNOWN_CUTS entry changes. The default flips only after three consecutive `--sweep-compare` runs with `same=true` are recorded in docs/sync/HANDOFF.md.
