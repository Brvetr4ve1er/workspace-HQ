# Claude Hub

The Hub (`hub.mjs`) is a separate process on the system Node (>= 22.13, `node:sqlite`), started by
`dashboard/claude-hub-host.js`. It indexes the owner's Claude Code transcripts (and the other sources the app still
reads) into one SQLite file and answers JSON-line requests from the main process.

## What the index holds

`data/claude/hub.sqlite` (gitignored; override with `HQ_CLAUDE_DB`) holds, per chat, its title, project, timestamps,
token counts and the full message text (secrets masked on read), plus documents (memory files, CLAUDE.md, vault prompt
notes) and a full-text index over both.

Claude Code deletes old transcripts after its retention period. For such a chat this file is the **only copy**
(`index-guard.mjs` counts them as `indexOnly`, and the Hub refuses every reset while any exist). Nothing else backs it
up, and it sits inside the repo tree, so it is covered by the daily snapshot below.

## Daily snapshot

`dashboard/hub-snapshot.js` (main side, started once from `main.js`) asks the Hub for a snapshot:

- first check 5 minutes after the app starts, then every 30 minutes; at most one snapshot per calendar day;
- only when the Hub answers `health` with state `ready` and no backfill in progress;
- the Hub runs `VACUUM INTO` a temp file (`snapshot.mjs`), verifies that copy (`PRAGMA integrity_check`, the Hub's own
  `meta` table, row counts) and only then renames it to its final name. A raw copy of the live WAL database is never
  taken. The copy is one synchronous call inside the Hub, so other Hub requests wait for it; it is why the check only
  runs when the Hub is idle;
- folder: `%LOCALAPPDATA%\WorkspaceHQ\hub-snapshots` (override `HQ_HUB_SNAPSHOT_DIR`), files `hub-YYYY-MM-DD.sqlite`;
- the last 7 are kept; older `hub-YYYY-MM-DD.sqlite` files are deleted, no other file in that folder is touched;
- a folder inside the repo, or on a path with a synced-folder segment (OneDrive, Dropbox, Google Drive, iCloud,
  Syncthing, Sync, Box, MEGA, pCloud), is refused by both main and the Hub;
- the outcome is one day-log line, `hub-snapshot` `{ ok, bytes, ms, kept, reason? }`, with no path in it. A failure is
  that line and nothing else: no Brief row, no toast. A failing day is tried at most three times.

A snapshot is a **full copy of the index, including the chat text** (masking happens when text is read out, not in the
file). Keep the folder off synced folders and out of backups you do not control.

## Check a snapshot (restore dry run)

```
node dashboard/claude-hub/snapshot.mjs --verify <file>
```

Read-only. Prints the schema version, size and a row count per table; exit 0 for a good file, 1 for a bad one
(truncated, empty, not a chat index), 2 for a missing argument.

## Restore

1. Quit WorkspaceHQ (the Hub must not be running).
2. Run `--verify` on the snapshot you picked.
3. Copy it over `data/claude/hub.sqlite`, and delete `hub.sqlite-wal` and `hub.sqlite-shm` beside it (a stale WAL from
   the old file must not be applied to the restored one).
4. Start the app. The Hub picks up from the restored index and re-ingests what changed on disk since.

## Tests

```
node --test dashboard/claude-hub/*.test.mjs dashboard/claude-hub-host.test.mjs dashboard/hub-snapshot.test.mjs
```
