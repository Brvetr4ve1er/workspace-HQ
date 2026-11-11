// Golden guard for the v5 template. app.tpl.js is the Claude Design template
// kept verbatim, now assembled from src/tpl/*.tpl.js fragments (split at a8e0bf1);
// any refactor must keep this string IDENTICAL. If this test
// fails, the refactor changed the markup: revert that, don't re-record.
// (Re-record only for a deliberate template change, and say so in the commit.)
// It checks the exported string, not the file: JS turns CRLF inside a template
// literal into LF, so a CRLF checkout of app.tpl.js still passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import tpl from './app.tpl.js';

// recorded 2026-10-05 from the default export of src/app.tpl.js @ 8560518;
// re-recorded 2026-10-05 for the Phase 2 clean-pass template changes (14 fragments,
// each marked with <!-- v5: reason -->; see the Phase 2 commits);
// re-recorded 2026-10-05 for the Phase 3 v3-parity changes (review R-P3): 10 fragments
// (ov-ask, ov-settings, system, project-page, studio, lightbox, claude, automations,
// projects, extras), 24 hunks, every one carrying a <!-- v5: reason --> marker (22 → 63);
// re-recorded 2026-10-06 for the Phase 6 review fix honesty-5: one fragment (extras), one
// hunk — the What's new overlay's note under the trailers ("sample data, not your scans …
// no sound yet"), with its <!-- v5: reason --> marker;
// re-recorded 2026-10-13 for H1 Claude Hub card (Task 7): one fragment (system), one hunk, +1289 chars /
// +1292 bytes, no line removed — the Claude Hub section after Vitals on System > Machine, with its
// <!-- v5: reason --> marker;
// 2026-10-16 H2 Claude › Chats (+8964 chars / +8981 bytes): one fragment (claude), one hunk, no line removed — the Chats
// sub-tab block before Sessions (filters, search, thread view, Forget), with its <!-- v5: reason --> marker
// 2026-10-16 H2 Claude › Projects, project-page Claude, History Claude activity, System Reindex (+6749 chars / +6779 bytes): four fragments (claude, project-page, history, system), one hunk each, no line removed, each with its <!-- v5: reason --> marker
// 2026-10-25 H2 final review (token scope honesty, +100 chars / +100 bytes): one fragment (history), two lines, none removed —
// the per-project token span shows "N tokens (whole chat)" with a tooltip, and the strip's <!-- v5: reason --> marker gains the scope clause
// 2026-10-16 H3 Claude chat composer (claude.tpl.js: Continue, New chat bar, composer; project-page title) +5899 chars / +5916 bytes
// 2026-10-16 H4 claude.ai import strip (Chats + Settings), web Continue label/picker/note: +2728 chars / +2742 bytes
// 2026-10-16 H5 Ask: chip placeholder count 6 → 7 + marker text (+32 chars / +32 bytes)
// 2026-10-16 H5 Save to vault: extras dialog + thread-view button (+5844 chars / +5852 bytes)
// 2026-10-25 H6 archive sources: + ChatGPT import button, document hits + view, drop confirm card, System imports report (+5761 units)
// 2026-10-25 H6 final review: claude fragment, one line — the open-in-place document line <span> gains
// style="min-height:1.2em" so a blank line keeps its height in the flex column (+25 chars / +25 bytes, no line removed)
// 2026-10-25 P1 prompt library: Claude › Prompts Library block (claude.tpl.js) + project-page "Run a prompt" (+5622 chars / +5639 bytes)
// 2026-10-25 P2 prompt harvest: Library|Candidates toggle + Candidates list (claude.tpl.js) + Promote dialog (extras.tpl.js) (+8724 chars / +8738 bytes)
// 2026-10-25 P3 prompt runs + packs: run modal + pack dialog (extras.tpl.js), pack buttons (claude.tpl.js) (+9193 chars / +9219 bytes)
// 2026-10-26 PC health detail: System › Machine panels (system.tpl.js) — memory/processor users, disk breakdown with Open/Copy, graphics + live stats, power & system, drives, trends, startup, not-readable list (+9890 chars / +9898 bytes)
// 2026-10-26 GitHub view: Projects › GitHub (projects.tpl.js) — account stats, waiting on you, your PRs, assigned issues, repo grid with CI / clone / Open / Copy (+10003 chars / +10011 bytes)
// 2026-10-26 data freshness: top bar (shell.tpl.js) — scan time tooltip + an orange "N days old" badge when the newest scan is 2+ days old (+300 chars / +302 bytes)
// 2026-10-26 connected accounts: Projects › Vercel & Supabase (projects.tpl.js) — Vercel projects with production / latest deploy, recent deploys, Supabase projects, connect cards (+9098 chars / +9109 bytes)
// 2026-10-27 Instagram / Facebook import: claude fragment, one line — an "Import Instagram / Facebook export" button after the ChatGPT one, with its <!-- v5: reason --> marker (+463 chars / +463 bytes, no line removed)
// 2026-10-27 Social tab: new fragment social.tpl.js after life (Accounts, Inbox, Archive, Vault; each block with its <!-- v5: reason --> marker); life.tpl.js loses its Social block (moved unchanged into the Inbox) for a one-line marker (+20309 chars / +20339 bytes)
// 2026-10-27 button sweep fixes: social (Discard wired: data-so, disabled, title, label binding; Inbox marker), history (a timeline row with nowhere to go is disabled), home (momentum tabs aria-pressed), claude (Library | Candidates aria-selected), ov-scrub (snapshot bar aria-pressed); each with its <!-- v5: reason --> marker (+535 chars / +535 bytes)
// 2026-10-27 canvas pin / remove + stat card: claude (card Pin aria-pressed + title + label binding, Remove disabled + title + label binding), home (Pinned from canvas section), ov-settings (Save stat card PNG wired: disabled + label binding, the 'not wired' note replaced), ov-misc (level-up Save card: disabled + label binding); each with its <!-- v5: reason --> marker (+2168 chars / +2176 bytes)
// 2026-10-27 canvas ＋ Board + Clear board: claude (＋ Board button, the new-board form with its name hint, the board list with card counts and Clear); each with its <!-- v5: reason --> marker (+3572 chars / +3580 bytes)
// 2026-10-28 feature cleanup — Studio cut: the studio and lightbox fragments removed whole (snip / recorder / capture library had 1 recording and 0 snips ever) (-10096 chars / -10110 bytes)
// 2026-10-28 feature cleanup — importers + prompt library cut: claude (the claude.ai / ChatGPT / Instagram-Facebook import strip and the whole Prompts sub), ov-settings (claude.ai export row), system (drop-folder + last-import lines), social (both import buttons), project-page (Run a prompt), extras (Promote, Run, Pack dialogs and the drop card) (-30554 chars / -30631 bytes)
// 2026-10-28 feature cleanup — Canvas + stat card cut: claude (the whole Canvas sub: ＋ Note, ＋ Board, board list + Clear, cards with Pin / Remove), home (Pinned from canvas), ov-settings (Export › Save stat card PNG), ov-misc (level-up Save card) (-13441 chars / -13467 bytes)
// 2026-10-28 feature cleanup — Social tab cut (the outbox approval gate stays in the extension popup): the social fragment removed whole (Accounts / Inbox / Archive / Vault), home (the posts-awaiting-approval row) (-23142 chars / -23177 bytes)
// 2026-10-31 honesty fixes, each hunk with its <!-- v5: reason --> marker: tasks (a noFilterMatch box — an empty tier filter is not "Board clear"), ov-scrub (the overlay names the screens that follow the date; Life / clutter / the live rail pin to the latest scan), shell (read-only banner drops "social" — the tab was cut 2026-10-28), life (the stale social.tpl.js pointer marker reworded) (+773 chars / +774 bytes)
// 2026-11-03 money space (space-port-money, ported from the Ember money app): the money fragment joined after life, nothing else moved (+57015 chars / +57084 bytes — the package's own measured delta)
// 2026-11-05 project-page (journal Add binds cantAddJournal, greyed out while a save is in flight; one attribute + its <!-- v5: --> marker) (+82 chars / +82 bytes)
// 2026-11-05 Operator Brief: the brief fragment (tpl/brief.tpl.js) interpolated into home under the greeting, one <!-- v5: --> marker; nothing else moved (+4114 chars / +4129 bytes)
// 2026-11-07 assistant rulebook: the Reach fragment (tpl/reach.tpl.js) interpolated into ov-settings after Global hotkeys, one <!-- v5: --> marker; nothing else moved (+3795 chars / +3809 bytes — exactly the fragment's own length)
// 2026-11-07 sessions board: the board fragment (tpl/sessions-board.tpl.js, +9755 chars) first in Claude › Sessions, the strip fragment (tpl/sessions-strip.tpl.js, +1958 chars) after the Brief on Home, and the Chats thread's terminal button bound to clTerminalLabel / clTerminalTip (a <!-- v5: --> marker, +131 chars): +11844 chars / +11860 bytes in all, nothing else moved
// 2026-11-07 money in one minute + one line per spend: the start card (tpl/money-start.tpl.js, +5355 chars) replaces the money fragment's "start with what you have" card (-1777 chars) in the no-accounts branch, and the quick line (+2175 chars) leads Today under mnyHasAccounts; each carries a <!-- v5: --> marker; +22 chars of indentation per interpolation, nothing else moved (+5797 chars / +5805 bytes)
// 2026-11-07 client delivery: the card fragment (tpl/delivery.tpl.js, +15482 chars — exactly the fragment's own length) interpolated into project-page before the Claude section, one <!-- v5: --> marker; nothing else moved (+15482 chars / +15504 bytes)
// 2026-11-08 client delivery tasting fixes: one line in the card fragment (tpl/delivery.tpl.js) — the "a newer preview on <branch> is not the deployed branch" note under the link, +179 chars / +179 bytes, nothing else moved
// 2026-11-08 Brief standing line: one block in the brief fragment (tpl/brief.tpl.js) under the items - "Standing since 5 Nov: <text> · <text>" with each item a button, bound to brfHasStanding / brfStandingLead / brfStanding, with its <!-- v5: --> marker; nothing else moved (+957 chars / +959 bytes)
// 2026-11-09 Cosmos space (key 0): the Feed fragment (tpl/cosmos.tpl.js, joined after money) and the overlays fragment (tpl/cosmos-overlays.tpl.js: lightbox, index overlay, import report; joined before extras), each element with its <!-- v5: --> marker; nothing else moved (+47504 chars / +47544 bytes — the measured delta, the fragments' style constants expanded in place)
// 2026-11-10 client delivery check: the phone-and-language fragment (tpl/delivery-check.tpl.js, +8148 chars - exactly the fragment's own length) interpolated into project-page right after the delivery card, one <!-- v5: --> marker; nothing else moved (+8148 chars / +8165 bytes)
// 2026-11-10 Projects › Clients: the list fragment (tpl/clients-list.tpl.js, +4800 chars - exactly the fragment's own length) interpolated into projects.tpl.js after the Vercel & Supabase block, one <!-- v5: --> marker; nothing else moved (+4800 chars / +4809 bytes: the fragment's own non-ASCII characters - ellipsis, curly apostrophe, middle dots - count 2 or 3 bytes)
// 2026-11-10 Brief act in place: two fragments of tpl/brief-act.tpl.js interpolated into the existing Brief row in tpl/brief.tpl.js - the row's one local verb button (+659 chars, with its own line +27) and the done line + inline confirm under the row's text (+2507 chars), one <!-- v5: --> marker; nothing else moved (+3193 chars / +3195 bytes - exactly the two fragments and the button's own line)
// 2026-11-11 Money for Claude sessions: the Settings card (tpl/money-access.tpl.js, +1966 chars - exactly the fragment's own length) interpolated into ov-settings.tpl.js right after the Reach block, one <!-- v5: --> marker; 18 new mac* vals keys (golden re-recorded, every moved value attributed with tools/golden-diff.mjs)
// 2026-11-11 Today ribbon (batch 3): the ribbon fragment (tpl/today.tpl.js, +6451 chars / +6459 bytes - exactly the fragment's own length) interpolated into home.tpl.js after the Brief and the sessions strip, its <!-- v5: --> markers; nothing else moved
// 2026-11-11 Brief history (batch 3): three fragments (tpl/brief-history.tpl.js: the Operator section 2341 chars, the footer 270, the all-clear card 1576 = +4187 chars / +4193 bytes, exactly the fragments' own length) interpolated into history.tpl.js (first child of the timeline column), brief.tpl.js (the card under the empty line, the footer at the end of the section); each carries <!-- v5: reason --> markers; no existing line removed.
const SHA256 = '4e353bf740e52a00e4e2507a5026e1b2e55ea61ecca5562c4de997445a3e606e';
const LENGTH = 417072;        // tpl.length (UTF-16 code units)
const UTF8_BYTES = 417726;    // Buffer.byteLength(tpl, 'utf8')

test('app.tpl.js default export is identical to the recorded template', () => {
  assert.equal(typeof tpl, 'string', 'app.tpl.js must default-export the template string');
  assert.equal(tpl.length, LENGTH, 'template length changed');
  assert.equal(Buffer.byteLength(tpl, 'utf8'), UTF8_BYTES, 'template UTF-8 byte length changed');
  assert.equal(createHash('sha256').update(tpl, 'utf8').digest('hex'), SHA256, 'template content changed (sha256)');
});
