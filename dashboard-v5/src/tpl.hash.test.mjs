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
const SHA256 = '3e09b9867aef9be42bf5bd3324af25bd7e958203c272b7fb766ca510c2c2dc37';
const LENGTH = 217852;        // tpl.length (UTF-16 code units)
const UTF8_BYTES = 218232;    // Buffer.byteLength(tpl, 'utf8')

test('app.tpl.js default export is identical to the recorded template', () => {
  assert.equal(typeof tpl, 'string', 'app.tpl.js must default-export the template string');
  assert.equal(tpl.length, LENGTH, 'template length changed');
  assert.equal(Buffer.byteLength(tpl, 'utf8'), UTF8_BYTES, 'template UTF-8 byte length changed');
  assert.equal(createHash('sha256').update(tpl, 'utf8').digest('hex'), SHA256, 'template content changed (sha256)');
});
