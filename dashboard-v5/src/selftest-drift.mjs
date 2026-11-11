// System › Machine › "How the PC changed" — the states the selftest walks (selftest.js loops them in both themes), and the invented history
// that tools/fake-preload.js answers hq.machineHistory.read with (that file is a plain script, so it carries a pasted copy of
// inventedAnswer(); the integrator pastes it, and logic/drift.test.mjs pins what it must contain).
//
//   driftStates() -> [name, sub, live, dftState, extra][]        (the Cosmos / Money row shape, selftest.js "cosmos-" rows)
//     sub        always 'machine' (the caller sets tab 'system', sub.system 'machine')
//     live       null: the panel keeps nothing in the live store
//     dftState   the `dft` component state this row sets (logic/drift.js dftInit() plus the row's own values); the caller sets
//                L._dftAsked = true so the arrival read does not replace a preset state, and holds the Re-examine watcher still
//     extra      {} (no row needs another state patch)
//   DRIFT_OFFLINE_ROWS   rows that need hq.machineHistory hidden for one combo (the store's hq, never window.hq)
//
// Everything is invented, deterministic and placeholder: no owner data, no clock, no IO. Times are zone-less LOCAL strings like the
// collector writes. The states: offline · loading · error (no rows) · error with the last rows kept · no checks yet · ready (40 checks
// with a deliberate gap, a zero ping and a partial disk reading) · ready with what-grew lines · the estimate refusing · the estimate
// answering · a gap-heavy series (an all-zero ping, so an honest empty chart).
import { estimateDisk } from './live/machine-history.mjs';

export const DRIFT_OFFLINE_ROWS = Object.freeze(['drift-offline']);

/** What main's disk part says when the only readings so far are partial (dashboard/disk-history.js diskLines, verbatim). */
export const PARTIAL_DISK_NOTE = 'the readings so far are partial (some folders could not be measured), so nothing is compared yet · needs two days of readings';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (i, stepH) => {
  const d = new Date(Date.UTC(2026, 10, 1, 6 + i * stepH, 0, 0));   // calendar fields only: a zone-less "local" string, no DST arithmetic
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00';
};

/**
 * `count` invented checks, `stepH` hours apart from 2026-11-01 06:00. Deliberately awkward the way the real history is:
 * a few checks with no CPU/RAM reading (a gap), a ping of 0 every ninth check and updateDays 0 early on (unknown, written as 0),
 * a clean-up that frees disk once, and one dropped startup app.
 */
export function inventedHistory(count = 40, stepH = 6) {
  return Array.from({ length: count }, (_, i) => ({
    at: stamp(i, stepH),
    cpu: i >= 17 && i <= 19 ? null : 18 + ((i * 7) % 25),
    ram: i >= 17 && i <= 19 ? null : 55 + ((i * 3) % 15),
    diskFreeGB: Math.round((120 - i * 0.9 + (i >= 28 ? 8 : 0)) * 10) / 10,
    startup: i < 20 ? 10 : 9,
    temp: Math.round((3 + i * 0.05) * 100) / 100,
    pingMs: i % 9 === 4 ? 0 : 8 + ((i * 5) % 11),
    updateDays: i < 3 ? 0 : 2 + Math.floor(i / 8),
  }));
}

/** The IPC-shaped answer (hq:machine-history:read) over invented rows: ok, rows, the disk part (partial only), counts. */
export function inventedAnswer(count = 40, stepH = 6) {
  const rows = inventedHistory(count, stepH);
  return { ok: true, rows, disk: { lines: [], note: PARTIAL_DISK_NOTE }, counts: { rows: rows.length, dropped: 0, diskDays: 1 } };
}

const base = () => ({ rows: null, disk: null, counts: null, loaded: false, busy: false, error: '', est: null });
const held = (a, over) => Object.assign(base(), { rows: a.rows, disk: a.disk, counts: a.counts, loaded: true }, over || {});

/** @returns {Array<[string, string, null, object, object]>} */
export function driftStates() {
  const a = inventedAnswer(40, 6);                                          // under ten days: the estimate refuses
  const long = inventedAnswer(30, 24);                                      // a month of daily checks, free space falling: the estimate answers
  long.rows = long.rows.map((r, i) => ({ ...r, diskFreeGB: Math.round((130 - i * 2) * 10) / 10 }));
  const lines = { ...a, disk: { lines: [{ label: 'alpha-cache', deltaGB: 6.4, days: 7 }, { label: 'beta-projects', deltaGB: 1.2, days: 7 }, { label: 'gamma-downloads', deltaGB: 0.3, days: 7 }], note: '' } };
  const zeroPing = { ...a, rows: a.rows.map((r) => ({ ...r, pingMs: 0 })) };
  const row = (name, dft) => [name, 'machine', null, dft, {}];
  return [
    row('drift-offline', base()),
    row('drift-loading', base()),
    row('drift-error', Object.assign(base(), { error: 'selftest: synthetic read error' })),
    row('drift-error-with-rows', held(a, { error: 'selftest: synthetic read error' })),
    row('drift-empty', held({ rows: [], disk: { lines: [], note: 'needs two days of readings' }, counts: { rows: 0, dropped: 0, diskDays: 0 } })),
    row('drift-ready', held(a)),
    row('drift-ready-disk-lines', held(lines)),
    row('drift-estimate-refuses', held(a, { est: estimateDisk(a.rows) })),
    row('drift-estimate-answers', held(long, { est: estimateDisk(long.rows) })),
    row('drift-gap', held(zeroPing)),
  ];
}
