# WorkspaceHQ: the next-level plan (2026-11-14)

Status: PROPOSED, awaiting the owner's approval. Written from a study of the app at main @ 3618d45: six readers (vision, real use, the product as built, code health, the backlog, an outside view), four strategists with different priorities, three judges who scored all 36 proposed initiatives. This document is the synthesis; the raw study stays local.

## What the study found

1. **The brain is built; almost nothing reaches the owner.** The Brief, the sessions board, recall, the tool rulebook, Cosmos, Security and Money are strong and honest. But every recorded use mark is an "open"; not one "act" has ever been recorded. Claude sessions have called the tools a handful of times in total. About half of the owner's Claude sessions run in folders where the tools do not exist.
2. **Everything that needs a one-time owner step is dark.** No Bridge pairing, no Security refresh, no Money data, no client job, no vault note, no picture ever favourited. Roughly half of the recent commits went to surfaces with no recorded use.
3. **The Brief is clogged.** Fifteen near-identical red chores have stood for weeks and hold the top slots, so new, real signals have nowhere to show. The Brief has never been dismissed, acted on, or toasted.
4. **Four different places answer "what should I do now"** (the Brief, Next action, the quest list, Ctrl+Alt+X), and eleven destinations share no single thesis.
5. **The game layer is frozen** (top level reached, nothing left to earn, milestones about code hygiene) and the console feel the owner asked for was never carried into this renderer. Sound is on by default and fires on every tab change.
6. **Change is slow.** A full gate takes 10 to 15 minutes, most of it fixed waits in one button sweep; the window re-renders every 2.5 s even while hidden in the tray.

## Thesis

**Stop adding. Make what exists reach the owner, get acted on, and feel like theirs.** The next level is not an eleventh capability; it is reach, truth, subtraction, and then the console layer on a product that is actually in use.

One standing rule until the evidence changes: **no new space and no new assistant tool until every existing owner-gated feature has one real first use** (or the owner retires it).

## Stage 0 — one guided sitting with Claude (about 30 minutes, owner present)

Not app nags: a session that walks the steps with the owner and checks each one.

- Register the workspacehq tools for every Claude session and add the session-start Brief line (the owner pastes two commands; the app never writes settings).
- Pair the Bridge extension (0.9.0) and pin the tray icon.
- Answer the open decisions in one pass (list at the end).
- Fire one test notification so the toast path is proven on this PC.
- Security and Money first steps stay the owner's own time; the sitting ends with the exact next step for each.

## Batch 6 — Reach and truth (touches no Home template; cheap gates)

| # | Dish | Size | What the owner gets | How we know it worked |
|---|---|---|---|---|
| 1 | The Brief in every Claude session | S | Each session opens with up to three Brief lines, in any folder. Needs the two one-line nightly-run changes in the structure lane first (strict tool config, shared refresh lock). | Tool calls in the audit log from other folders. |
| 2 | Unclog the Brief | M | Identical stale chores collapse into one aged row with one in-place action; a reserved quiet lane for "never started" and "gone dark" (a sensor or feature that stopped), so they neither vanish nor crowd out real alerts; no permanent top-three occupant. | The top three change week to week; a first dismiss or act is recorded. |
| 3 | Measure acts, and report them | S | Every in-place action records an "act" mark; each batch's handoff quotes a short use report, and the next plan must cite it. No new screen. | The report exists and drives batch 7's cut list. |
| 4 | Protect the memory | S | A nightly snapshot of the chat index to a folder outside the repo and outside any synced folder, taken read-only, with a restore note. | A dated snapshot file exists; a restore dry run passes. |
| 5 | The phone can read the Brief, no bot needed | S | The same counts-only projection the tray uses, written as one small file into a folder the owner already syncs to the phone. Off until the owner picks the folder. | The file updates on the phone. |
| 6 | Quiet and light | S | Sound off by default (kept for "done" moments if switched on); the hidden window stops re-rendering; a "send a test notification" button in Settings › Reach. | Idle CPU while in the tray drops; the toast is seen once. |
| 7 | Faster gates | M | One gate command; the button sweep waits for the page to settle instead of sleeping, old and new run side by side until they agree. | Full gate under 6 minutes. |

## Batch 7 — One Home, less app, and the console layer (one template window: goldens move once)

| # | Dish | Size | What the owner gets |
|---|---|---|---|
| 1 | Home as one decision | M | The Brief on top, one next action under it (kept as the all-clear fallback), everything else behind "more". The other rankers read the Brief instead of competing with it. |
| 2 | Subtraction pass | M | Driven by the use report and the owner's answers: fold or hide what is unused (candidates: the Life space, Archived, the plumbing panels, the dead social scrape in the extension, dead code kept for removed features), and rewrite the README and the first lines of CLAUDE.md to state the thesis. Nothing is deleted without a yes; everything stays restorable from a tag. |
| 3 | The console layer (the owner's N64-era wish) | L | Built as data and new files, original SVG and CSS only, one master switch, respects reduced motion, zero render cost when off. Contents: an opt-in console skin as a third theme; projects as cartridges on a shelf (label art generated from each project's own colours and initials); a memory-card view of what the app holds (read-only: what, how big, how old); cheat codes that unlock real things (the skin, hidden themes, a debug overlay) through one small registry instead of hardcoded one-offs; a short "new version inserted" card after an update, never on ordinary launches (the app starts hidden). No Nintendo names, logos, characters, sounds or level art. |
| 4 | Smaller decorations and easter eggs | S–M | A second pass of small items once the registry exists: seasonal touches, hidden rooms, idle-screen art that never interrupts reading. Chosen with the owner. |

Honest note: the judges scored decoration lowest because it does not change what the owner does tomorrow. It is in the plan because the owner asked for it and the app is theirs; it is placed here so it lands on a Home that is already simpler, and so the template snapshots are re-recorded once for dishes 1 and 3 together.

## Later, only when the use report says so

- A game that rewards outcomes (cleared Brief rows, finished setup steps) instead of scans; needs a structure-lane change and an owner yes.
- A phone door that can also act (dismiss, capture), once the read path is used.
- A goals note the Brief ranks by.
- Money and Cosmos growth (month view, Cleanup, Clusters) once those spaces have real data and repeat use.
- Runtime work on the value-key ceiling: measure first; 36 keys of headroom is enough for batches 6 and 7.

## What stops

- New spaces, new assistant tools, new Money or Cosmos features, until first real use.
- Per-click and per-tab sounds; a boot animation on every launch; a general widget grid; any paid image generation.
- Folding value keys as a standing ritual.

## Decisions for the owner

1. **Structure lane:** may the frontend session make the two one-line nightly-run changes itself (strict tool config, taking the refresh lock), announced in the handoff, or do they stay asks for the other session?
2. **The freeze rule** above: yes or no.
3. **Subtraction candidates** in batch 7: which may be folded or hidden (decided after the first use report, per item).
4. **Phone folder** for the Brief file: which synced folder (after Syncthing is set up for the vault).
5. **Tracked owner file and local plan files:** stop tracking the one tracked file under the data folder; keep the audit plans local.
6. **Console layer scope:** all four parts of dish 3, or start with the skin and the cartridge shelf.
