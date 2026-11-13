# tools/

Small command-line helpers that live beside the app. None of them write settings, and none need the network.

## brief-lines.mjs

Prints up to three plain lines from the local Brief (`data/brief.json`, written by the running app), for an optional
Claude Code SessionStart hook so a session opens already knowing what needs the owner.

    node tools/brief-lines.mjs

Output is at most three item lines (`urgent: ...`, `soon: ...`, `when you can: ...`) and one `+N more` line, under 600
characters. Every word comes from the Brief's fixed wording table (the same projection the tray uses), so no project
name, path, amount, id or rule id is printed. A missing or unreadable file prints one `not available yet` line; a
Brief older than 30 minutes prints one `out of date` line and no items, so an old list is never shown as current. The
tool reads one file, writes nothing, and always exits 0.

The app never writes settings. If the owner wants the hook, they add it themselves, for example in their Claude Code
settings (replace the path with this repo's location):

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
