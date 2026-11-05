# WorkspaceHQ Operator: the Brief

**Status:** approved by the owner 2026-11-05 ("Build the Operator", phases P1–P2).
**Why:** WorkspaceHQ's passive senses are used daily, while the features that wait to be visited aren't. The owner works in Claude Code sessions, so the app should *say what needs them, where they are*, instead of being one more place to go. The evidence and its numbers are in a local, uncommitted study, `docs/audits/2026-11-05-concept-operator.md`.

## Concept

One deterministic engine ranks **at most 3 things that need the owner now**.

- **Sources:**
  - the scan;
  - quests;
  - Money;
  - PC health;
  - the scan run itself;
  - claude.ai sync.
- **Each item says:**
  - what's wrong;
  - why it matters now;
  - its source and age;
  - the one action that clears it.
- **Where it shows (P1–P2):**
  - the top of Home;
  - an MCP tool (`hq_brief`), so any Claude session can ask;
  - a Windows toast when a *new* high-severity item becomes the top one.

## Goals

- **G1:** the Brief is right. Every item comes from data with a stated source and age, and nothing is invented. No LLM sits in the ranking, so it works offline and is explainable.
- **G2:** the Brief is short: at most 3 items, plus a "+N more" count.
- **G3:** every item has exactly one action (a route in the app, or "scan now") and a dismiss.
- **G4:** a dismissed item stays hidden until its underlying fact *changes*. Its key includes the value, so a worse value is a new item.
- **G5:** P2 adds a change-only toast:
  - high severity only;
  - once per item key per 24 hours;
  - never between 23:00 and 08:00 local time.

## Non-goals and anti-goals

- No LLM ranking.
- No new destination screen; the Brief heads Home.
- No outbound action. The Brief proposes; the owner clicks.
- No phone channel, no Claude Code SessionStart hook, no XP changes in P1–P2. Those are later phases that need the owner's OK.
- **Anti-goal:** a Brief that nags. If the same thing toasts twice a day, P2 has failed.

## Rules (P1)

Ranked by severity, high before med before low, then in the rule order below. Projects are named by `name`.

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| scan-failed | live-state `scan.state === 'failed'` | high | Scan now |
| secrets | a project's `metrics.risk_security.secrets_found > 0` | high | open that project |
| money-late | a Money obligation has `status === 'late'` | high | Money › Runway |
| pc-blood | a PC-health organ has `status === 'blood'` | high | System › Machine |
| quest-red | an open quest with `tier === 'red'` (the first one) | high | Tasks |
| scan-stale | `scan.date` older than 36 h | med | Scan now |
| unpushed | a project with `git_safety.ahead > 0` or `unpushed` | med | open that project |
| money-stale | a Money account with `stale === true` | med | Money › Today |
| pc-ember | a PC-health organ has `status === 'ember'` | med | System › Machine |
| dirty | a project's `git_safety.dirty >= 10` (the largest) | low | open that project |
| money-backup | Money has accounts and no export in 30 days, or never | low | Money › Today |
| claude-sync | no claude.ai chats indexed, or the last sync is more than 3 days old | low | Claude › Chats |

When a rule matches several projects, accounts or organs, the item names the worst one and adds "and N more".

## Interfaces

- **`data/brief.json`** (written by main, atomically):

  ```
  { v:1, generatedAt, items:[{ key, rule, severity, text, why, source, age, action }], more, errors:[{ source, error }] }
  ```

  `action` is one of `{ kind:'go', tab, sub?, projectId? }` or `{ kind:'scan' }`.
- **`data/brief-state.json`:** `{ dismissed:[key], toasted:{ [key]: ISO } }`.
- **`data/money/meta.json`:** `{ lastExportAt }`, written by a successful Money export.
- **IPC:**
  - `hq:brief:read` returns `{ brief }`;
  - `hq:brief:dismiss(key)` returns `{ brief }`;
  - push `hq:brief` sends the new brief whenever it changes.
- **MCP:** `hq_brief` returns `data/brief.json` plus its age in minutes, and says so when the app hasn't written it.
- **Hub health** gains `lastSyncAt` and `webCount` (additive).

## UI: the Brief panel (heads Home)

- **Template:** `src/tpl/brief.tpl.js`, joined into Home's fragment, with a `<!-- v5: -->` marker.
- **Vals:** `src/vals/brief.js`, keys prefixed `brf`.
- **Logic:** `src/logic/brief.js`.
- **Look:**
  - severity in words and colour: high `var(--red)`, med `var(--orange)`, low `var(--muted)`;
  - IBM Plex Mono, inline token styles, both themes;
  - actions are real `<button>`s, and the list is `role="list"`.
- **States, all honest:**
  - **empty:** "Nothing needs you right now · from the HH:MM brief";
  - **error:** the real reason;
  - **loading;**
  - **offline:** no bridge.

## Gates

- unit tests for the engine and the main module;
- vals tests;
- goldens attributed;
- selftest states (empty, error, loading, 1–3 items, each severity, the "+N more" line);
- cdp scenarios: the panel renders, an action routes, a dismiss sends its key.
