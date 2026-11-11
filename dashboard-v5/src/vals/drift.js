// System › Machine › "How the PC changed": render values. The 22 dft* keys ride under ONE top-level key, dftv (see the bottom of this file).
// Everything arrives finished: the rows and the what-grew lines come from main (dashboard/machine-history.js → hq:machine-history:read),
// logic/drift.js holds them in state.dft, src/live/machine-history.mjs draws the charts and runs the estimate; this module only shapes them.
//
// renderVals runs every surface on every machine push, so while the owner is on another screen this returns ONE frozen constant (and
// re-arms the next read): nothing is parsed or drawn. The charts are memoised on the rows array, so a re-render that holds the same
// rows costs nothing. Honest states: no bridge · loading · error (no rows held) · error with the last rows kept · empty ("No checks kept
// yet") · ready. One usage mark ('machine-drift') once per arrival on the panel, only while it can be seen (logic/use-log.js).
import { buildCharts, summaryText } from '../live/machine-history.mjs';
import { DFT_OFFLINE, DFT_SURFACE } from '../logic/drift.js';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

export const DFT_TITLE = 'How the PC changed';
export const DFT_INTRO = 'Small charts from the checks this PC has kept. Only the last few checks are kept, so these are not all-time. A break in a line means there was no reading there.';
export const DFT_DISK_TITLE = 'What filled the disk';
export const DFT_EMPTY = 'No checks kept yet. This fills as the app checks this PC.';

const OFF = Object.freeze({
  dftShow: false, dftTitle: DFT_TITLE, dftIntro: DFT_INTRO, dftOffline: false, dftOfflineText: '', dftLoading: false, dftHasErr: false, dftErrText: '',
  dftEmpty: false, dftEmptyText: '', dftReady: false, dftSummary: '', dftCharts: [], dftRefresh: () => {}, dftRefreshOff: true, dftRefreshLabel: 'Refresh',
  dftDiskShow: false, dftDiskTitle: DFT_DISK_TITLE, dftDiskLines: [], dftHasDiskLines: false, dftDiskNote: '', dftHasDiskNote: false,
});

/** "Downloads +4.2 GB in 7 days" */
export function diskLineText(l) { return l.label + ' +' + (Math.round(l.deltaGB * 10) / 10).toFixed(1) + ' GB in ' + plural(l.days, 'day'); }

function driftFlat(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const shown = !!(ctx && ctx.v && ctx.v.system && ctx.sub === 'machine' && S.tab === 'system');
  if (!shown) { if (typeof this.dftRearm === 'function') this.dftRearm(); return OFF; }
  const can = typeof this.dftCan === 'function' ? this.dftCan() : false;
  if (can) { this.dftWatch(!!S.sysExamining); this.dftEnsure(); }
  if (typeof this.useMark === 'function') this.useMark(DFT_SURFACE);

  const D = S.dft || {};
  const held = Array.isArray(D.rows) ? D.rows : null;
  const err = D.error || '';
  const loaded = !!D.loaded;
  const empty = loaded && held !== null && held.length === 0;
  const ready = held !== null && held.length > 0;

  let charts = [];
  if (ready) {
    const memo = this._dftMemo;
    if (memo && memo.rows === held) charts = memo.charts;
    else {
      charts = buildCharts(held);
      this._dftMemo = { rows: held, charts };
    }
  }
  const est = D.est || null;
  const items = charts.map((c) => {
    const isDisk = c.id === 'disk';
    return {
      id: c.id, title: c.title, countText: c.countText, rangeText: c.rangeText, hasRange: !!c.rangeText,
      path: c.path, hasPath: !!c.path, label: c.label, text: c.text, empty: c.empty,
      noteText: c.note, hasNote: !!c.note,
      lastText: c.lastText, hasLast: !!c.lastText,
      isDisk, estLabel: est ? 'Hide estimate' : 'Estimate', estPressed: !!est,
      est: () => this.dftEstimate(),
      hasEst: isDisk && !!est, estText: isDisk && est ? est.text : '', hasEstBasis: isDisk && !!est && !!est.basis, estBasis: isDisk && est && est.basis ? est.basis : '',
      estStyle: { fontSize: 13, color: est && est.ok ? 'var(--text)' : 'var(--muted)' },
    };
  });

  const disk = D.disk || { lines: [], note: '' };
  const diskLines = disk.lines.map((l) => ({ text: diskLineText(l) }));
  const diskNote = diskLines.length ? '' : disk.note || '';
  const busy = !!D.busy;
  return {
    dftShow: true, dftTitle: DFT_TITLE, dftIntro: DFT_INTRO,
    dftOffline: !can, dftOfflineText: DFT_OFFLINE + ': nothing can be shown without the desktop app’s machine-history module (hq.machineHistory).',
    dftLoading: can && !loaded && !err,
    dftHasErr: can && !!err, dftErrText: (held ? 'Couldn’t refresh the history · ' + err + ' · the last readings stay on screen' : 'Couldn’t read the history · ' + err),
    dftEmpty: can && empty, dftEmptyText: DFT_EMPTY,
    dftReady: can && ready,
    dftSummary: ready ? summaryText(held) + (D.counts && D.counts.dropped ? ' · ' + plural(D.counts.dropped, 'check') + ' could not be placed in time' : '') : '',
    dftCharts: items,
    dftRefresh: () => this.dftLoad(), dftRefreshOff: !can || busy, dftRefreshLabel: busy ? 'Reading…' : 'Refresh',
    dftDiskShow: can && loaded, dftDiskTitle: DFT_DISK_TITLE,
    dftDiskLines: diskLines, dftHasDiskLines: can && loaded && diskLines.length > 0,
    dftDiskNote: diskNote, dftHasDiskNote: can && loaded && !!diskNote,
  };
}

/** ONE top-level key (dftv): renderVals sits near V8's ~1020-property limit, so a new surface nests (see vals/brief-history.js); the template reads {{ dftv.dftShow }} etc. */
export function driftVals(ctx) {
  return { dftv: driftFlat.call(this, ctx) };
}
