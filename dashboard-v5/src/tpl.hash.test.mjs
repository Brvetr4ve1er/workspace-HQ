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
const SHA256 = 'eed4e7407832035e39ed8d338b025db21639316f02e3893c7f9f6bad59b75460';
const LENGTH = 311743;        // tpl.length (UTF-16 code units)
const UTF8_BYTES = 312299;    // Buffer.byteLength(tpl, 'utf8')

test('app.tpl.js default export is identical to the recorded template', () => {
  assert.equal(typeof tpl, 'string', 'app.tpl.js must default-export the template string');
  assert.equal(tpl.length, LENGTH, 'template length changed');
  assert.equal(Buffer.byteLength(tpl, 'utf8'), UTF8_BYTES, 'template UTF-8 byte length changed');
  assert.equal(createHash('sha256').update(tpl, 'utf8').digest('hex'), SHA256, 'template content changed (sha256)');
});
