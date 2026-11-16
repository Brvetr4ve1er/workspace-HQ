# Play the work: from points on top to the board itself

## Status

Stages 0 to 2 were built in batch 8 (2026-11-16): the ledger gaps, the counting fix, the strip and the clean-board card. Stages 3 and 4 are still PROPOSED and not built. One rule changed while building: a row that leaves while another subject of the same rule is still live is "changed", never a clear (see `docs/sync/HANDOFF.md`, batch 8 taster fixes). FREEZE RULE stands: no new space, no new MCP tool. Economy changes are structure-lane asks with a CONTRACT entry and golden re-baseline.

## What the owner asked

| Left column (gamification) | Right column (the work is the play) | In this app's terms |
|---|---|---|
| Points, levels, badges on top of the work | The real task is the game | The move is clearing a row that needs the owner |
| Rewards for participation | Measurable outcomes | The score is what left the board and stayed gone |
| Outside motivation | Inside motivation | The board getting cleaner, old problems finally gone |

## Why today is the left column

- XP comes from quests, scan-day streaks and automation runs. The level is maxed. Presence is paid.
- The task Done click pays a coin and a level-up card before any fact is checked.
- The use report shows 76 opens and 0 acts in 7 days. Part of that is a counting fault (see Counting fixes), so it is a hint, not a verdict.

## The design: Clear the Board

The Brief order is the only thing scored. The next-action card is a task and is not scored; clearing a row does not move it. The ledger already records how each row closed, so this extends it rather than rebuilding it.

**The move.** Clear a Brief row. Five rules have an in-place verb (quest, money-stale, dirty, session-left-dirty, session-waiting). Other rules (unpushed, secrets, money-late, scan-stale) are fixed elsewhere and show up only as the row leaving. Zero acts is therefore normal for part of the Brief, not a sign it is broken.

**The feedback.**
1. At once: the row leaves and a line says "1 cleared today". Day one reads as "the row leaves and a line says it", not as a held count.
2. Held: a clear counts when the same rule and subject stays absent for 72 hours of ledger observations, with no gap in observation longer than one day (a gap resets the hold).
3. If it returns inside the hold, the pending clear is cancelled and shows as "came back".

**The score.** Three counts on the strip, derived from the ledger each time, never stored as a total:
- Cleared and held this week.
- Age of the oldest open row, labelled "since the app first noticed" (the first weeks understate it).
- Rows set aside, with the age of the oldest one shown beside the open-row age.

No stored total, no comparison to a past week, no unlock.

**Honest labels.**
- "In place" means a verb that changed a fact. "Marked done" is a self-report (a quest marked done stays gone while the repo fact is still true). It counts as held only when the collector's own fact has cleared.
- "Gone, scan-confirmed": a row left and the source reported no error. "Gone, unknown": the rule's source is a senses source (github, vercel, claude-code), whose old-but-quiet data the ledger cannot detect. Unknown clears are shown, never held.
- "Waiting on something outside": rows not fixable in the app (the pc-* rules, claude-sync, review-waiting) leave the oldest-open-row count and sit on their own line.

**What unlocks.** Nothing. "Board clean since Tuesday 14:10" shows only when open plus set aside is zero. Otherwise: "Nothing new needs you, N set aside", naming set-aside high-severity rows by rule wording. Standing-exempt rules (secrets, security counts) are never eligible for the clean line.

## Counting fixes (before the strip means anything)

- The act mark fires only for effect verbs (those with `marks` true in the verb table). The commit hand-over becomes its own `handover` action. Today both land as `act`.
- A task Done click gets its own `act` mark on its own surface, so the most natural clearing action is visible. The use report counts acts per surface.
- Until this lands the use report decides nothing; stage bars read held clears from the ledger.

## What is removed or folded (stage 4, owner yes)

| Surface | Fate |
|---|---|
| Header level chip, XP bar, streak days | One line: rows open, held this week |
| "+N xp" on the next-action card | The task age ("waiting 9 days") |
| Coin fly, floating "+xp", level-up card and sound | Stop firing; Done just removes the task |
| Momentum XP chart, Weekly recap XP gain | Replaced by the strip |
| Level table, presence achievements | Hidden, then removed once `tools/dead-callers.mjs` shows no caller |

Kept: quests, the health gauge, Console cosmetics. `account.xp` stays in the data. The coin stays until stage 4: it fires on the task Done path, not Brief rows.

## Where it lives

Home under the Brief (the existing history panel and vals key) and Settings, from one read. It extends `summarize()` in `dashboard/brief-ledger.mjs` and the existing brief-history channel, additively. No new channel or vals key. Counts, rule wording and opaque refs only.

## Ledger gaps (stage 0)

The ledger keys rows by a hash of rule, subject and value, and holds no subject. A changed count opens a new row, and a leaving row is filed as "changed" when another row of the same rule is live (a rule shows only its top subject, so most real clears look like this). On the real ledger, 10 of 12 closed rows are "changed". Add, additively:
- `subjectRef`: a hash of rule and subject only, on open and closed rows. Age (`first`) carries forward across value changes for the same subject.
- Per-subject closure: when a row leaves and a same-rule row is live, compare subjects. A different subject means the first is gone, counted as a clear. The same subject with a new value stays "changed".
- A `pending` state with a `heldUntil`, and an observation timestamp for gap detection.

Freshness comes only from reported errors and the scan-stale and scan-failed rows. A per-source age would be a structure-lane ask.

## Anti-farming

| Attempt | Result |
|---|---|
| Open, scan, view | Counts nothing |
| Dismiss | Never a clear, and never counts toward "clean since". Shown as set aside with its age |
| Click an act | Counts only if the underlying fact cleared and the hold passed; a quest override alone shows "marked done" |
| Create and clear at once | A row must be seen in at least one compute first |
| Reopen the same thing | One count per rule and subject per week, by `subjectRef` |
| Sensor goes quiet | Shown as unknown, never held |
| Restart or a long sleep | A gap over one day resets the hold |
| Pile shrinks (3 to 2) | Same subject; age carries, nothing counts |

## Lanes

The ledger shape is a `data/` shape, so stage 0 is a shared-lane `meta:` entry in HANDOFF before code, plus a CONTRACT note. Frontend then owns the code. Structure lane, each with a CONTRACT entry and golden re-baseline:
1. Quests carry the fact state, not only a hold (before stage 4).
2. Stop displaying XP, level and presence achievements.
3. Stop banking XP in `collector/assemble.mjs`; remove the unread `grace_hours` config.
4. Later: per-source ages.

## Stages

| # | Stage | Size | Bar |
|---|---|---|---|
| 0 | Ledger gaps, announce first | S | Per-subject closures appear in a week of real use |
| 1 | Counting fixes, three-count strip, instant line | S | At least 3 effect acts in 7 days, held clears readable |
| 2 | Clean-board wording, Settings numbers, set-aside age | S | The strip is opened more than once a week |
| 3 | Structure ask 1 (quests carry fact state) | S | Marked-done and verified clears separate |
| 4 | Hide XP surfaces, one-release legacy switch (owner yes) | M | Held clears in 2 of the last 3 weeks |
| Later | Median days, came back, weekly run, Proven Work | M | Only if the strip is read |

Stage 4 re-baselines the header, momentum and recap goldens, with per-file attribution in HANDOFF.

## Risks

The first weeks may read "0 held"; say so plainly. The Brief cap of three can hide backlog; show the overflow count. Removing XP removes the one reward the owner has; keep a switch for one release.

## Decisions for the owner

1. Build Clear the Board with stage 0 first. Recommend yes.
2. Hold: 72 hours of observations, a gap over a day resets. Recommend yes.
3. Show scan-confirmed gone separately from "in place"; count scan-confirmed on collector rules as held. Recommend yes, with senses rules unknown.
4. Hide the level chip, XP bar and coin after stage 3, with a one-release legacy switch. Recommend yes after a week of the strip.
5. Structure asks 2 and 3. Recommend yes, after stage 4.
6. Set-aside visible, never counted as clean. Recommend yes.
7. Proven Work and the later numbers: decide only if the strip is read. Recommend wait.

## Red-team notes

Accepted: the card is not scored; most clears file as "changed"; no subject or hold state; marked-done is farmable; acts and hand-overs mixed; no scan counter; senses sources untrusted; ages reset on value change; dismissal could fake "clean"; stage 1 mostly exists; five numbers read as a second score; ledger shape is shared-lane; the module-host-key clause was empty.

Partly accepted: the coin stops at stage 4, not for Brief rows alone, since it lives on the task Done path. The shared verb table is replaced by the mark fix.

Rejected: dropping "elsewhere" fixes entirely; they stay visible as the row leaving, just never labelled as verified. Exact scan cadence was not confirmed, so the spec avoids depending on it.
