// Settings > Memory card - the states the selftest walks (selftest.js loops them in both themes), and the invented answer that tools/fake-preload.js
// gives hq.memory.read (that file is a plain script, so it carries a pasted copy of inventedMemoryRead's source: tools/cdp-memory-card.mjs
// fakeMemorySource() prints the exact text and its test pins it).
//
//   memoryStates()  -> [name, sub, live, mcdState, extra][]            (the Drift / Cosmos row shape)
//     sub        always 'settings'. The caller sets state.settingsOpen from extra (every row carries it), opens nothing else
//     live       null: the card keeps nothing in the live store
//     mcdState   the `mcd` component state this row sets (logic/memory-card.js mcdInit() plus the row's own values); the caller sets
//                L._mcdAsked = true so the arrival read does not replace a preset state
//     extra      { settingsOpen: true, consoleLayer: { on: true } } - the card exists only while the Console layer is on
//   MEMORY_OFFLINE_ROWS   rows that need hq.memory hidden for one combo (the store's hq, never window.hq)
//
// Everything is invented, deterministic and placeholder: no owner data, no clock, no IO. The read happened at a fixed instant; every age counts back
// from it. The ten kinds and their labels mirror dashboard/memory-card-core.mjs KINDS (memory-card-core.test.mjs pins the parity).

export const MEMORY_OFFLINE_ROWS = Object.freeze(['memory-offline']);

/**
 * The invented answer of hq:memory:read. SELF-CONTAINED on purpose (no outer names): its source text is pasted into tools/fake-preload.js.
 * opts: { fresher: scans were just written (age 1 min, a re-read changes the age) · empty: nothing kept anywhere · partial: capped, one kind
 * could not be looked at · noSnapshot: no snapshot yet · snapshotUnreadable: the snapshot folder could not be looked at · huge: sizes near the unit edges }
 */
export function inventedMemoryRead(opts) {
  const o = opts || {};
  const AT = Date.parse('2026-11-14T12:00:00.000Z');
  const H = 3600e3, M = 60e3;
  const rows = [
    ['scans', 'Scans and history', 34, 12400000, 3 * H],
    ['brief', 'Brief', 5, 48000, 20 * M],
    ['money', 'Money (counts only)', 2, 9800, 26 * H],
    ['cosmos', 'Cosmos library', 812, 5100000000, 5 * 24 * H],
    ['security', 'Security map (sizes only)', 3, 21000, 2 * 24 * H],
    ['delivery', 'Delivery', 0, 0, null],
    ['chat-index', 'Claude chat index', 4, 880000000, 45e3],
    ['logs', 'Logs', 30, 3200000, 59 * M],
    ['today-drift', 'Today and drift', 6, 160000, 90 * M],
    ['other', 'Other', 2, 100, 10 * 24 * H],
  ];
  const slots = rows.map((r) => ({ kind: r[0], label: r[1], files: r[2], bytes: r[3], newestMs: r[4] === null ? null : AT - r[4], partial: false }));
  if (o.fresher) slots[0].newestMs = AT - M;
  if (o.empty) for (const s of slots) { s.files = 0; s.bytes = 0; s.newestMs = null; }
  if (o.huge) { slots[3].bytes = 1023.9 * 1024 * 1024 * 1024; slots[0].bytes = 1048575; slots[1].bytes = 1023; }
  if (o.partial) {
    slots[3].partial = true; slots[3].files = 5000;
    slots[4].files = null; slots[4].bytes = null; slots[4].newestMs = null;
    slots[8].partial = true;
  }
  const snapshot = o.noSnapshot ? { newestMs: null, kept: 0, max: 7, ok: true }
    : o.snapshotUnreadable ? { newestMs: null, kept: null, max: 7, ok: false }
      : { newestMs: AT - 7 * H, kept: 3, max: 7, ok: true };
  return { at: new Date(AT).toISOString(), capped: !!o.partial, slots, snapshot };
}

/** The `mcd` state a row holds after main answered: exactly what logic/memory-card.js cleanRead() would keep. */
function held(answer, over) {
  return {
    slots: answer.slots.map((s) => ({ ...s })), snapshot: { ...answer.snapshot }, at: Date.parse(answer.at), capped: answer.capped === true,
    loaded: true, busy: false, error: '', ...(over || {}),
  };
}
const blank = () => ({ slots: null, snapshot: null, at: null, capped: false, loaded: false, busy: false, error: '' });

/** @returns {Array<[string, string, null, object, object]>} */
export function memoryStates() {
  const extra = () => ({ settingsOpen: true, consoleLayer: { on: true } });
  const row = (name, mcd) => [name, 'settings', null, mcd, extra()];
  return [
    row('memory-offline', blank()),
    row('memory-loading', blank()),
    row('memory-error', { ...blank(), error: 'selftest: synthetic read error' }),
    row('memory-error-with-rows', held(inventedMemoryRead(), { error: 'selftest: synthetic read error' })),
    row('memory-ready', held(inventedMemoryRead())),
    row('memory-ready-empty', held(inventedMemoryRead({ empty: true, noSnapshot: true }))),
    row('memory-ready-partial', held(inventedMemoryRead({ partial: true, snapshotUnreadable: true }))),
    row('memory-ready-edges', held(inventedMemoryRead({ huge: true }))),
  ];
}
