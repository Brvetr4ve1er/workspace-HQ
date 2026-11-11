// Today ribbon geometry. PURE (no DOM, no clock, no fs): minute-of-day to x, lane stacking, block merging, the 24 h axis, phone width,
// RTL. The model comes from main (dashboard/day-core.mjs through hq:today:read); this file only turns it into numbers for one SVG.
//
//   layout(model, { width, rtl, labelOf }) -> { width, height, viewBox, phone, plotX, plotW, axis, rows, rects, ticks, noteRows,
//                                              nowX, future }
//
//   width    the SVG's own coordinate width (the viewBox width): 360 on a phone, 960 elsewhere (isPhone/viewWidth)
//   rtl      true mirrors time right-to-left (a right-to-left page reads the day from the right) and moves side labels to the right
//   labelOf  (lane) -> the lane's label text; names stay on screen (the renderer maps project ids to names)
//
// Lanes are stacked in the order the model gives them (Claude projects, browser, PC, commits). A phone puts each lane's label ABOVE its
// bar (no side column) so the bars keep the width. Every number is finite and rounded to 0.1; an empty or half-made model gives a
// ribbon with its note rows and no rects, never NaN.
export const DAY_MIN = 1440;
export const PHONE_MAX_WIDTH = 520;
export const PHONE_VIEW_WIDTH = 360;
export const WIDE_VIEW_WIDTH = 960;
export const MIN_RECT_W = 2;   // a five-minute block is 0.35% of the day: never thinner than this

const r1 = (x) => Math.round(x * 10) / 10;
const fin = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const pad = (n) => String(n).padStart(2, '0');

/** A phone-width screen (window width in CSS px). */
export function isPhone(px) { return fin(px, WIDE_VIEW_WIDTH) < PHONE_MAX_WIDTH; }
/** The viewBox width to lay out for a screen width. */
export function viewWidth(px) { return isPhone(px) ? PHONE_VIEW_WIDTH : WIDE_VIEW_WIDTH; }

const clampMin = (m) => Math.max(0, Math.min(DAY_MIN, fin(m)));

/** x of a minute-of-day inside the plot [plotX, plotX + plotW]; rtl mirrors it. Minutes outside 0..1440 are clamped. */
export function minuteToX(min, plotX, plotW, rtl = false) {
  const f = clampMin(min) / DAY_MIN;
  return r1(plotX + (rtl ? 1 - f : f) * plotW);
}

/** A span [startMin, endMin] as { x, w } inside the plot: at least MIN_RECT_W wide and never past the plot's edges. */
export function spanRect(startMin, endMin, plotX, plotW, rtl = false, minW = MIN_RECT_W) {
  const a = minuteToX(startMin, plotX, plotW, rtl), b = minuteToX(endMin, plotX, plotW, rtl);
  let x = Math.min(a, b), w = Math.max(Math.abs(b - a), minW);
  const right = plotX + plotW;
  if (x + w > right) x = Math.max(plotX, right - w);
  return { x: r1(x), w: r1(w) };
}

/** Join spans of one lane that touch or overlap (within gapMin). Input is not changed; order is by start. */
export function mergeBlocks(spans, gapMin = 0) {
  const s = (Array.isArray(spans) ? spans : []).filter((p) => p && Number.isFinite(p.startMin) && Number.isFinite(p.endMin) && p.endMin > p.startMin && p.kind !== undefined)
    .map((p) => ({ ...p })).sort((p, q) => p.startMin - q.startMin || p.endMin - q.endMin);
  const out = [];
  for (const p of s) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind && p.startMin <= last.endMin + gapMin) { if (p.endMin > last.endMin) last.endMin = p.endMin; } else out.push(p);
  }
  return out;
}

/** The 24 h axis: a mark every 6 h on a phone, every 3 h elsewhere; the first and last labels anchor to the plot's edges. */
export function axisMarks(plotX, plotW, { phone = false, rtl = false } = {}) {
  const step = phone ? 6 : 3, marks = [];
  for (let h = 0; h <= 24; h += step) {
    const x = minuteToX(h * 60, plotX, plotW, rtl);
    const edge = h === 0 ? (rtl ? 'end' : 'start') : h === 24 ? (rtl ? 'start' : 'end') : 'middle';
    marks.push({ hour: h, x, label: pad(h), anchor: edge });
  }
  return marks;
}

const BAR = { wide: { barH: 14, gap: 8 }, phone: { barH: 12, gap: 6 } };

/**
 * Stack the model's lanes into rows and place every span and tick.
 * @param {object} model   { lanes, spans, ticks, nowMin } as hq:today:read answers
 */
export function layout(model, { width = WIDE_VIEW_WIDTH, rtl = false, labelOf = null } = {}) {
  const W = Math.max(240, fin(width, WIDE_VIEW_WIDTH));
  const phone = W < PHONE_MAX_WIDTH;
  const { barH, gap } = phone ? BAR.phone : BAR.wide;
  const LABEL_W = phone ? 0 : 120, PAD = 8, AXIS_H = 18, LABEL_H = phone ? 13 : 0;
  const plotW = W - PAD * 2 - LABEL_W;
  const plotX = rtl ? PAD : PAD + LABEL_W;   // side labels sit on the reading-start side: left, or right in rtl
  const lanes = Array.isArray(model && model.lanes) ? model.lanes : [];
  const spans = Array.isArray(model && model.spans) ? model.spans : [];
  const ticks = Array.isArray(model && model.ticks) ? model.ticks : [];
  const labelFor = typeof labelOf === 'function' ? labelOf : (l) => String((l && (l.label || l.kind)) || '');

  const rows = [], rects = [], tickMarks = [], noteRows = [];
  let y = AXIS_H;
  for (const lane of lanes) {
    if (!lane || typeof lane.id !== 'string') continue;
    const top = y + LABEL_H;
    const row = {
      id: lane.id, kind: String(lane.kind || ''), state: String(lane.state || ''), label: labelFor(lane),
      y: r1(top), h: barH,
      labelX: rtl ? W - PAD : PAD,
      labelY: r1(phone ? y + 10 : top + barH - 3),
      labelAnchor: rtl ? 'end' : 'start',
      noteX: r1(rtl ? plotX + plotW - 4 : plotX + 4), noteAnchor: rtl ? 'end' : 'start', noteY: r1(top + barH - 3),
      note: lane.state === 'ok' ? '' : String(lane.note || ''),
    };
    rows.push(row);
    if (row.note) noteRows.push({ id: lane.id, text: row.note });
    for (const m of mergeBlocks(spans.filter((s) => s && s.lane === lane.id), 0)) {
      const { x, w } = spanRect(m.startMin, m.endMin, plotX, plotW, rtl);
      rects.push({ lane: lane.id, kind: String(m.kind), x, y: row.y, w, h: barH, startMin: m.startMin, endMin: m.endMin });
    }
    for (const t of ticks.filter((k) => k && k.lane === lane.id && Number.isFinite(k.min))) {
      const x = minuteToX(t.min + 0.5, plotX, plotW, rtl);
      tickMarks.push({ lane: lane.id, x, y1: row.y, y2: r1(row.y + barH), min: t.min, count: Math.max(1, fin(t.count, 1)) });
    }
    y = top + barH + gap;
  }
  if (!rows.length) y = AXIS_H + gap;
  const height = r1(y + 2);
  const nowMin = model && Number.isFinite(model.nowMin) && model.nowMin >= 0 && model.nowMin <= DAY_MIN ? model.nowMin : null;
  const nowX = nowMin === null ? null : minuteToX(nowMin, plotX, plotW, rtl);
  let future = null;
  if (nowX !== null && nowMin < DAY_MIN) {
    const edge = minuteToX(DAY_MIN, plotX, plotW, rtl);
    future = { x: r1(Math.min(nowX, edge)), w: r1(Math.abs(edge - nowX)), y: AXIS_H, h: r1(Math.max(0, height - AXIS_H - 2)) };
  }
  return {
    width: W, height, viewBox: '0 0 ' + W + ' ' + height, phone, plotX: r1(plotX), plotW: r1(plotW), axisY: 12, axisH: AXIS_H,
    axis: axisMarks(plotX, plotW, { phone, rtl }), rows, rects, ticks: tickMarks, noteRows, nowX, future,
  };
}
