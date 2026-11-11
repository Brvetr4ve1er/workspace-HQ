// System › Machine › "How the PC changed" — the pure engine. No DOM, no IO, no clock reads except where `now` is passed.
// Turns the rows main hands over (dashboard/machine-history.js → hq:machine-history:read, a copy of data/pc-health-history.json the
// collector keeps) into seven small charts and one opt-in disk estimate.
//
// WHAT THE DATA REALLY IS (verified against collector/lib/pc-health.mjs historySample; the structure lane owns it):
//   - a ROLLING window (HIST_MAX = 96 checks), so every chart says "last N checks", never "all time".
//   - `at` is a zone-less LOCAL time string ("2026-10-16T10:03:28"), parsed here as local time (parseLocal), never as UTC.
//   - `temp` is TEMP-FILES in GB (m.tempGB), not a temperature: that chart is titled "Temp files (GB)".
//   - `pingMs` and `updateDays` are written as 0 when the collector could not tell ("?? 0"): a 0 there is a GAP, never a point at zero.
//   - gpuDriverDays, gpuTempC and battery are not charted: the GPU series flips between adapters until the structure lane
//     enumerates the GPU (HANDOFF ask). Nothing in this file mentions them; normalizeRows copies only the eight fields below.
//
// Honesty rules the tests pin: a gap is a BREAK in the line (a new "M"), never a zero; nothing is smoothed (straight segments between
// real readings); every chart states its sample count and date span; the estimate refuses, in words, unless there are at least
// MIN_ESTIMATE_CHECKS readings over at least MIN_ESTIMATE_DAYS days with a falling line, and when it answers it says "at this pace
// there would be about N days of room, if nothing changes", never a promise.

export const HIST_MAX = 96;
export const MIN_ESTIMATE_CHECKS = 8;
export const MIN_ESTIMATE_DAYS = 14;
/** A line that falls by less than this many GB a day is treated as flat: the arithmetic would give a meaningless horizon. */
export const FLAT_GB_PER_DAY = 0.02;
/** Past this many days the estimate says "more than" instead of printing a number nobody can mean. */
export const MAX_ESTIMATE_DAYS = 999;

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// the plot: a 300 x 80 box with a little room; the SVG is stretched to the card, strokes stay one size (vector-effect in the template)
export const BOX = Object.freeze({ w: 300, h: 80, left: 4, right: 296, top: 6, bottom: 74 });

/**
 * The seven charts, in order. `unknownIsZero`: the collector writes 0 when it could not tell, so a 0 is a gap.
 * `domain`: a fixed y range for percentages (0–100 reads honestly at any value); otherwise the range of the data, labelled.
 */
export const CHARTS = Object.freeze([
  { id: 'disk', key: 'diskFreeGB', title: 'Free disk (GB)', unit: 'GB', dec: 1, unknownIsZero: false, domain: null },
  { id: 'ram', key: 'ram', title: 'RAM in use (%)', unit: '%', dec: 0, unknownIsZero: false, domain: [0, 100] },
  { id: 'cpu', key: 'cpu', title: 'CPU load (%)', unit: '%', dec: 0, unknownIsZero: false, domain: [0, 100] },
  { id: 'temp', key: 'temp', title: 'Temp files (GB)', unit: 'GB', dec: 1, unknownIsZero: false, domain: null },
  { id: 'ping', key: 'pingMs', title: 'Ping (ms)', unit: 'ms', dec: 0, unknownIsZero: true, domain: null },
  { id: 'startup', key: 'startup', title: 'Startup apps', unit: 'apps', dec: 0, unknownIsZero: false, domain: null },
  { id: 'updates', key: 'updateDays', title: 'Days since updates', unit: 'days', dec: 0, unknownIsZero: true, domain: null },
]);
/** The only row fields this module reads; nothing else survives normalizeRows. */
export const ROW_KEYS = Object.freeze(['cpu', 'ram', 'diskFreeGB', 'startup', 'temp', 'pingMs', 'updateDays']);

export const ZERO_NOTE = 'The collector writes 0 when it could not measure this, so a 0 is left out as a gap, not drawn as a point.';
export const GAP_NOTE = 'A break in the line means there was no reading there, not zero.';

// ---------------------------------------------------------------------------------------------------------------- time
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/**
 * Epoch ms of a time string. A zone-less string ("2026-10-16T10:03:28", "2026-10-16 10:03", "2026-10-16") is LOCAL time;
 * a string that carries Z or an offset is exact. Anything else, or a date that does not exist (month 13, Feb 30), is NaN.
 */
export function parseLocal(at) {
  if (typeof at !== 'string') return NaN;
  const s = at.trim();
  const m = LOCAL_RE.exec(s);
  if (m) {
    const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
    const dt = new Date(y, mo - 1, d, h, mi, se);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || dt.getHours() !== h || dt.getMinutes() !== mi) return NaN;
    return dt.getTime();
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(s)) return Date.parse(s);
  return NaN;
}

/** "Oct 16" (local); with the year when `withYear`. */
export function dayLabel(ms, withYear = false) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + (withYear ? ', ' + d.getFullYear() : '');
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const round1 = (x) => Math.round(x * 10) / 10;
const fmt = (v, dec) => (dec > 0 ? (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec) : String(Math.round(v)));

/** "26 days" | "under a day" | "1 day" — whole days between two instants, honest about a short span. */
export function spanText(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return '';
  const d = (toMs - fromMs) / DAY_MS;
  if (d < 1) return 'under a day';
  return plural(Math.round(d), 'day');
}

// ------------------------------------------------------------------------------------------------------------ the rows
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Rows as main sent them → rows this module draws: { at, t, <seven fields> }, oldest first (a stable sort), only the last
 * HIST_MAX. A row with no readable `at` cannot be placed in time: it is dropped and counted. A field that is not a finite
 * non-negative number becomes null (a gap). Only the eight known fields are copied, so a GPU, battery or path field never travels.
 * @returns {{ rows: object[], dropped: number }}
 */
export function normalizeRows(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  let dropped = 0;
  src.forEach((r, i) => {
    const t = r && typeof r === 'object' ? parseLocal(r.at) : NaN;
    if (!Number.isFinite(t)) { dropped++; return; }
    const row = { at: String(r.at).trim(), t, _i: i };
    for (const k of ROW_KEYS) row[k] = numOrNull(r[k]);
    out.push(row);
  });
  out.sort((a, b) => a.t - b.t || a._i - b._i);
  const rows = out.slice(-HIST_MAX).map(({ _i, ...rest }) => rest);
  return { rows, dropped };
}

// -------------------------------------------------------------------------------------------------------------- charts
// the value a chart draws for a row: null is a gap. A 0 on an unknown-is-zero series is a gap too.
function plotValue(def, row) {
  const v = row[def.key];
  if (v === null || v === undefined) return null;
  if (def.unknownIsZero && v === 0) return null;
  return v;
}

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * One chart from normalized rows.
 * @returns {{ id, title, unit, empty, n, points, missing, countText, rangeText, path, label, text, note, lastText, minText, maxText }}
 *   path   an SVG path in BOX units: one "M x y" then "L" per real reading; a new "M" after every gap; a lone reading between
 *          gaps is "M x y h0" (a round dot). "" when there is nothing to draw. Never smoothed, never a point for a gap.
 *   text   the text twin of the chart, a plain sentence
 */
export function buildChart(def, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  const base = { id: def.id, title: def.title, unit: def.unit, n, note: def.unknownIsZero ? ZERO_NOTE : '' };
  const vals = list.map((r) => plotValue(def, r));
  const present = vals.filter((v) => v !== null);
  const missing = n - present.length;
  if (n === 0 || present.length === 0) {
    const why = n === 0 ? 'no checks yet' : 'none of the ' + plural(n, 'check') + ' has a reading';
    return { ...base, empty: true, points: 0, missing, countText: n === 0 ? 'no checks yet' : plural(n, 'check'), rangeText: '', path: '', label: def.title + ': ' + why,
      text: def.title + ': ' + why + '.', note: base.note, lastText: '', minText: '', maxText: '' };
  }

  const t0 = list[0].t, t1 = list[n - 1].t;
  const spreadByTime = t1 > t0;
  const xOf = (i) => {
    if (n === 1) return (BOX.left + BOX.right) / 2;
    const f = spreadByTime ? (list[i].t - t0) / (t1 - t0) : i / (n - 1);
    return BOX.left + f * (BOX.right - BOX.left);
  };
  let lo = Math.min(...present), hi = Math.max(...present);
  let dLo = lo, dHi = hi;
  if (def.domain) { dLo = def.domain[0]; dHi = def.domain[1]; }
  else if (dHi === dLo) { const pad = dHi === 0 ? 1 : Math.abs(dHi) * 0.05; dLo -= pad; dHi += pad; }
  const yOf = (v) => BOX.bottom - ((v - dLo) / (dHi - dLo)) * (BOX.bottom - BOX.top);

  // segments split at every gap; a segment of one reading is a dot
  const parts = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) parts.push('M' + r1(run[0].x) + ' ' + r1(run[0].y) + ' h0');
    else if (run.length > 1) parts.push('M' + run.map((p) => r1(p.x) + ' ' + r1(p.y)).join(' L'));
    run = [];
  };
  vals.forEach((v, i) => { if (v === null) flush(); else run.push({ x: xOf(i), y: yOf(v) }); });
  flush();

  const iFirst = vals.findIndex((v) => v !== null);
  let iLast = vals.length - 1;
  while (vals[iLast] === null) iLast--;
  const withYear = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  const rangeText = dayLabel(t0, withYear) + (t1 > t0 ? ' – ' + dayLabel(t1, withYear) : '');
  const span = spanText(t0, t1);
  const countText = plural(n, 'check') + (n < 2 || !span ? '' : span === 'under a day' ? ', all within a day' : ' over ' + span);
  const lastText = fmt(vals[iLast], def.dec) + ' ' + def.unit;
  const minText = fmt(lo, def.dec) + ' ' + def.unit, maxText = fmt(hi, def.dec) + ' ' + def.unit;
  const firstText = fmt(vals[iFirst], def.dec) + ' ' + def.unit;
  const when = (i) => dayLabel(list[i].t, withYear);
  let text = def.title + ': ' + (present.length === 1
    ? 'one reading, ' + lastText + ' on ' + when(iLast)
    : firstText + ' on ' + when(iFirst) + ', ' + lastText + ' on ' + when(iLast) + '; low ' + minText + ', high ' + maxText)
    + ' — ' + countText + (missing ? ', ' + plural(missing, 'check') + ' with no reading' : '') + '.';
  return { ...base, empty: false, points: present.length, missing, countText, rangeText, path: parts.join(' '), label: text,
    text, note: missing > 0 && !def.unknownIsZero ? GAP_NOTE : base.note, lastText, minText, maxText };
}

/** All seven charts for a raw (or already normalized) row list. */
export function buildCharts(raw) {
  const { rows } = normalizeRows(raw);
  return CHARTS.map((def) => buildChart(def, rows));
}

/** The header line over all the charts: "57 checks · Oct 16 – Nov 11 · the last 96 checks are kept". '' when there are none. */
export function summaryText(raw) {
  const { rows } = normalizeRows(raw);
  if (!rows.length) return 'No checks kept yet';
  const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
  const withYear = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  return plural(rows.length, 'check') + ' · ' + dayLabel(t0, withYear) + (t1 > t0 ? ' – ' + dayLabel(t1, withYear) : '') + ' · only the last ' + HIST_MAX + ' checks are kept';
}

// ------------------------------------------------------------------------------------------------------------ estimate
/**
 * The opt-in disk estimate: a straight line (least squares) through the free-disk readings against time.
 * Refuses, with the reason in words, unless there are at least MIN_ESTIMATE_CHECKS readings over at least MIN_ESTIMATE_DAYS days
 * AND the line falls by at least FLAT_GB_PER_DAY a day. When it answers it never promises an end: it says how many days of room
 * there would be at this pace if nothing changes. The room is counted from the newest reading, not from the fitted line.
 * @returns {{ ok:false, reason:'few-checks'|'short-span'|'not-falling', text:string, checks:number, spanDays:number }
 *          | { ok:true, days:number, perDayGB:number, checks:number, spanDays:number, text:string, basis:string }}
 */
export function estimateDisk(raw) {
  const { rows } = normalizeRows(raw);
  const pts = rows.filter((r) => r.diskFreeGB !== null).map((r) => ({ t: r.t, y: r.diskFreeGB }));
  const checks = pts.length;
  const spanDays = checks > 1 ? (pts[checks - 1].t - pts[0].t) / DAY_MS : 0;
  const spanShown = round1(spanDays);
  if (checks < MIN_ESTIMATE_CHECKS) {
    return { ok: false, reason: 'few-checks', checks, spanDays: spanShown, text: 'Not enough to estimate: it needs at least ' + MIN_ESTIMATE_CHECKS + ' free-disk readings, and there ' + (checks === 1 ? 'is 1' : 'are ' + checks) + '.' };
  }
  if (spanDays < MIN_ESTIMATE_DAYS) {
    return { ok: false, reason: 'short-span', checks, spanDays: spanShown, text: 'Not enough to estimate: it needs readings spread over at least ' + MIN_ESTIMATE_DAYS + ' days, and these cover ' + (spanDays < 1 ? 'under a day' : plural(Math.floor(spanDays), 'day')) + '.' };
  }
  const x = pts.map((p) => (p.t - pts[0].t) / DAY_MS);
  const mx = x.reduce((a, b) => a + b, 0) / checks, my = pts.reduce((a, p) => a + p.y, 0) / checks;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < checks; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (pts[i].y - my); }
  const slope = sxx > 0 ? sxy / sxx : 0;   // GB per day
  if (!(slope <= -FLAT_GB_PER_DAY)) {
    return { ok: false, reason: 'not-falling', checks, spanDays: spanShown, text: 'Nothing to estimate: over these ' + checks + ' readings the free space is flat or rising, not falling.' };
  }
  const perDayGB = -slope;
  const left = pts[checks - 1].y;
  const days = Math.max(0, Math.floor(left / perDayGB));
  const room = days > MAX_ESTIMATE_DAYS ? 'more than ' + MAX_ESTIMATE_DAYS + ' days' : days < 1 ? 'less than a day' : 'about ' + plural(days, 'day');
  const basis = 'A straight line through ' + checks + ' readings over ' + plural(Math.round(spanDays), 'day') + ', falling about ' + (Math.round(perDayGB * 100) / 100) + ' GB a day. One big install or clean-up changes it.';
  return { ok: true, days, perDayGB: Math.round(perDayGB * 100) / 100, checks, spanDays: spanShown, text: 'At this pace there would be ' + room + ' of room, if nothing changes.', basis };
}
