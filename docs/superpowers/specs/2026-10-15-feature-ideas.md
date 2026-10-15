# 25 feature ideas for WorkspaceHQ (2026-10-15)

Each one is grounded in data the app already has or will have after Claude Hub H1–H5. None are scheduled; they are candidates. "Builds on" names the existing source so nothing here invents a number the app can't back.

## From the Claude Hub index (81k messages of your own history)

1. **Promise tracker.** Mine assistant lines like "I'll do X later", "deferred to H2", "TODO" from your chats into an open-items list per project, each linked to the chat. Builds on: Hub FTS + role=assistant messages.
2. **Unfinished threads.** Sessions whose last turn is an assistant question with no reply, or that ended on an API error / interrupted compaction, surfaced as "resume?" cards. Builds on: Hub conversation `last_at`, `<synthetic>`/error lines, `isCompactSummary`.
3. **Commit → chat link.** From any commit, find the Claude session that produced it (cwd + time window + files named in tool calls) and show "why this changed". Builds on: Hub tool-call text, `git log` the scan already reads.
4. **Secret-paste radar.** Count masked secrets per project and date ("you pasted a key-shaped string into a chat on Oct 3") with a "rotate it" nudge. Builds on: redact.mjs hit counts — the mask marks are already in the index.
5. **Skill & plugin usage stats.** Which Claude Code skills/plugins/MCP servers you actually use (transcripts carry `attributionSkill`, `attributionPlugin`, `attributionMcpServer`) against the 983 catalogued spells → "unused for 60 days, prune?". Builds on: parse-code.mjs (add three fields).
6. **Tool reliability panel.** Per project: most-used tools, `is_error` rates, the commands that fail most. Builds on: tool_result `is_error` already parsed.
7. **Compaction & effort meter.** How often sessions compact per project (a sign of oversized work units) and the effort levels used (`effort`, `perTurnEffort`). Builds on: transcript fields.
8. **Model & token ledger.** Tokens per day / project / model, cache hit ratio, no money figures unless you enter a rate. Builds on: Hub usage table (dedupe by api_id already done).
9. **Deep-work timeline.** When a Claude Code session is active in project X, the HUD and History show "deep work on X" blocks (labelled estimate). Builds on: Hub `active_ms` + live sessions.
10. **"Explain this error" from history.** Paste an error; the local model searches the Hub for the last time you fixed something similar and answers with the chat link. Builds on: H5 contextFor + Ask.
11. **Shared-tree collision guard.** Two Claude sessions on one repo: the Hub sees both sessions' tool calls live, so show "the other session is editing dashboard/main.js right now". Builds on: Hub live ingest of `[tool: Edit <path>]` lines + the HANDOFF protocol this repo already runs.
12. **Session transcript export.** Any chat → a clean Markdown transcript (tool calls collapsed, secrets masked) to the vault or clipboard. Builds on: H5 vault writer.

## Project and repo hygiene

13. **CLAUDE.md linter.** Flag stale paths, dead hotkeys and lane rules that no longer match the tree (the legacy/ move would have been caught). Builds on: the scan's file list.
14. **New-project wizard.** Folder + git init + CLAUDE.md from a template + a struct-lane ask to add it to the collector config. Builds on: existing `hq:open-repo`, project templates in docs.
15. **Unpushed-work-at-risk card.** Days since last push × uncommitted lines, per project, with one-click push (confirm). Builds on: scan `git_safety` + the tray's "Push all unpushed".
16. **Dependency watch.** Nightly `npm audit` / outdated counts per Node project, honest counts only. Builds on: collector products with package.json (struct-lane ask).
17. **Branch janitor.** Merged and stale branches per repo, with a confirm-to-delete list. Builds on: git per project.
18. **Worktree manager.** See every git worktree per repo and open a terminal/Claude in it. Builds on: `git worktree list`.

## Life, machine, vault

19. **Daily digest draft.** Each morning: yesterday's commits, Claude sessions, captures, vault notes → a drafted daily note you confirm into VEEMO CORTEX. Builds on: scan + Hub + brain-dump + H5 vault writer.
20. **Weekly review card.** Monday: the week's output per project, streaks, tokens, open promises — saveable to the vault. Builds on: 19.
21. **Workspace scenes.** "Open project X" = its folder, terminal, dev server, Claude session and the right browser tabs, in one click; scenes are saved per project. Builds on: dev-start, claudeQuest, openRepo, shell.openPath.
22. **Vault backlink hygiene.** Notes that mention a project name but don't link its project note; one-click fix with confirm. Builds on: the collector's vault scan + the project notes mirror.
23. **MCP server health.** Which MCP servers fail to connect (this session saw obsidian/filesystem failing repeatedly) and which are never used. Builds on: Claude Code's MCP logs under ~/.claude + attribution fields.
24. **Morning shard.** A desktop widget with today's one thing, the resumable Claude session and the deep-work timer. Builds on: organic shards + mini-data.
25. **Prompt library.** Your reusable prompts: harvested from your own best chats, tagged, versioned, with variables, runnable against Claude Code in a project with one click (and sent to claude.ai via the extension). Builds on: Hub FTS, H3 chat engine, the spellbook's run-and-confirm flow. *Being brainstormed now.*
