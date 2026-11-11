// Home › "Where today went": render values. Keys are tdy-prefixed — one shared namespace with every other surface. The day arrives finished
// from main (dashboard/day-ribbon.js → hq:today:read, held by live/today-slice.mjs); geometry is logic/today-geometry.mjs, memoized on the
// slice's revision + day + width. This module only shapes it. Honest states: no bridge · still loading · read failed (nothing to show) ·
// ready (and, when a refresh failed, the last answer with the reason). Nothing is drawn for a lane whose source is missing: its note is.
// While the owner is on another tab each part returns a frozen constant: no read, no geometry.
import { layout, viewWidth, WIDE_VIEW_WIDTH } from '../logic/today-geometry.mjs';
import { TDY_TITLE, TDY_NO_BRIDGE, TDY_MAX_OFFSET, clampOffset, dayLabel, laneLabel, twinLines } from '../logic/today.js';

// colour tokens only (themes remap them); every kind also has a word in the legend and the text twin, so colour never carries it alone
const KIND = {
  block: { fill: 'var(--purple)', opacity: 1 },
  focus: { fill: 'var(--blue)', opacity: 0.9 },
  awake: { fill: 'var(--green)', opacity: 0.5 },
  asleep: { fill: 'var(--orange)', opacity: 0.9 },
  unknown: { fill: 'var(--faint)', opacity: 0.35 },
};
const LEGEND = Object.freeze([
  Object.freeze({ label: 'Claude (5-minute blocks)', color: KIND.block.fill }),
  Object.freeze({ label: 'browser focus', color: KIND.focus.fill }),
  Object.freeze({ label: 'PC awake', color: KIND.awake.fill }),
  Object.freeze({ label: 'PC asleep', color: KIND.asleep.fill }),
  Object.freeze({ label: 'app not running (unknown)', color: KIND.unknown.fill }),
  Object.freeze({ label: 'commit', color: 'var(--gold)' }),
]);

const OFF = Object.freeze({
  tdyShow: false, tdyTitle: TDY_TITLE, tdyOffline: false, tdyOfflineText: '', tdyLoading: false, tdyHasError: false, tdyErrorText: '', tdyHasStale: false, tdyStaleText: '',
  tdyReady: false, tdyDayLabel: '', tdyBackLabel: 'Previous day', tdyForwardLabel: 'Next day', tdyBackDisabled: true, tdyForwardDisabled: true,
  tdyBack: () => false, tdyForward: () => false,
  tdyCaption: '', tdyAria: '', tdySvgViewBox: '0 0 960 40', tdySvgHeight: 40, tdyAxis: [], tdyRows: [], tdyRects: [], tdyTicks: [],
  tdyHasNow: false, tdyNowX: 0, tdyNowY2: 0, tdyHasFuture: false, tdyFuture: Object.freeze({ x: 0, y: 0, w: 0, h: 0 }),
  tdyTwin: [], tdyLegend: LEGEND, tdyNotes: [], tdyHasNotes: false,
});

const pageWidth = () => { try { return typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : WIDE_VIEW_WIDTH; } catch { return WIDE_VIEW_WIDTH; } };
const pageRtl = () => { try { return typeof document !== 'undefined' && !!document.documentElement && document.documentElement.dir === 'rtl'; } catch { return false; } };

export function todayVals(ctx) {
  const { S, LIVE, live } = ctx;
  const onHome = S.tab === 'home' && !S.route && !!live;   // the ribbon is about now: hidden while an older scan is being viewed, like the Brief
  if (!onHome) { this.tdyRearm(); return OFF; }
  const can = !!(this.hq && this.hq.today && typeof this.hq.today.read === 'function');
  if (can) this.tdyEnsure();
  else return Object.freeze({ ...OFF, tdyShow: true, tdyOffline: true, tdyOfflineText: TDY_NO_BRIDGE + ' (hq.today): the ribbon is built from the app’s own logs, so there is nothing to draw without it.' });

  const off = clampOffset(S.tdyOffset);
  const T = (LIVE && LIVE.today) || { loaded: false, days: {}, errors: {}, revision: 0 };
  const entry = T.days && T.days[off], model = entry && entry.model, err = (T.errors && T.errors[off]) || '';
  const common = { ...OFF, tdyShow: true, tdyBackDisabled: off >= TDY_MAX_OFFSET, tdyForwardDisabled: off <= 0, tdyBack: () => this.tdyBack(), tdyForward: () => this.tdyForward(),
    tdyBackLabel: off >= TDY_MAX_OFFSET ? 'Previous day (the ribbon goes back 7 days)' : 'Previous day', tdyDayLabel: model ? dayLabel(model.day, off) : dayLabel('', off) };
  if (!model) {
    return err ? { ...common, tdyHasError: true, tdyErrorText: 'Couldn’t read the day · ' + err } : { ...common, tdyLoading: true };
  }

  const width = viewWidth(pageWidth()), rtl = pageRtl();
  const key = [T.revision, off, width, rtl ? 1 : 0, S.tdyNamesAt || 0].join('|');
  let g = this._tdyMemo && this._tdyMemo.key === key ? this._tdyMemo.value : null;
  if (!g) {
    const names = this._tdyNames || null;
    let ci = 0;
    const labelOf = (lane) => laneLabel(lane, names, lane.kind === 'claude' ? ci++ : 0, width < 520 ? 22 : 16);
    const lay = layout(model, { width, rtl, labelOf });
    const twinLabel = (lane, idx) => laneLabel(lane, names, idx, 40);
    g = {
      lay,
      twin: twinLines(model, twinLabel).map((text) => ({ text })),
      rows: lay.rows.map((r) => ({ ...r, trackX: lay.plotX, trackW: lay.plotW, hasNote: !!r.note })),
      rects: lay.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, fill: (KIND[r.kind] || KIND.unknown).fill, opacity: (KIND[r.kind] || KIND.unknown).opacity })),
      axis: lay.axis.map((m) => ({ x: m.x, label: m.label, anchor: m.anchor, lineY1: 15, lineY2: lay.height - 2 })),
      ticks: lay.ticks.map((t) => ({ x: t.x, y1: t.y1, y2: t.y2 })),
    };
    this._tdyMemo = { key, value: g };
  }
  const lay = g.lay;
  const notes = (Array.isArray(model.notes) ? model.notes : []).map((text) => ({ text }));
  this.tdyMark();   // usage counter: only while a ribbon is actually shown (logic/use-log.js dedupes per visit)
  return {
    ...common,
    tdyReady: true, tdyHasStale: !!err, tdyStaleText: err ? 'Couldn’t refresh · ' + err + ' · showing the last answer' : '',
    tdyCaption: model.caption || '',
    tdyAria: TDY_TITLE + ', ' + common.tdyDayLabel + '. ' + (model.caption || ''),
    tdySvgViewBox: lay.viewBox, tdySvgHeight: lay.height, tdyAxis: g.axis, tdyRows: g.rows, tdyRects: g.rects, tdyTicks: g.ticks,
    tdyHasNow: lay.nowX !== null, tdyNowX: lay.nowX === null ? 0 : lay.nowX, tdyNowY2: lay.height - 2,
    tdyHasFuture: !!lay.future, tdyFuture: lay.future || OFF.tdyFuture,
    tdyTwin: g.twin, tdyNotes: notes, tdyHasNotes: notes.length > 0,
  };
}
