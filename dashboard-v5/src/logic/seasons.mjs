// Seasonal touch (batch 7, dish small-delights): ONE tiny ornament per calendar month, beside the Home greeting.
//
// Pure data and pure functions. The registry never touches the DOM and never reads the clock: seasonFor(date) takes the date it is given
// (the caller injects the clock, so tests pin every month, the year boundary and a leap day).
//
//   SEASONS      12 frozen entries { month 1..12, id, name, art }
//   seasonFor(d) -> the entry for the LOCAL calendar month of a Date (or a millisecond number), null when the date is not a real date
//   seasonLabel(entry) -> 'Season ornament: Paper kite (February)'   (the aria-label and the tooltip's second half)
//   artLists(art) -> { box, circles, rects, lines, polys, paths }   the art split by primitive, every colour already a var(--token) style,
//                    the shape the template's sc-for lists read (vals/delights.js)
//
// ART is pure data in a 32 x 32 box, 3 to 8 primitives from this closed set (the test pins it):
//   { t:'circle', cx, cy, r }            { t:'rect', x, y, w, h, rx? }         { t:'line', x1, y1, x2, y2 }
//   { t:'poly', pts:[[x,y], ...] }       { t:'path', d }   (d uses only M L C Q Z and numbers)
// plus optional fill / stroke (a COLOUR TOKEN NAME from TOKENS or 'none', never a hex, so every theme and the Console skin recolour it) and sw (stroke width).
// Motifs are nature and craft only: no holiday, no brand, no character.
export const TOKENS = Object.freeze(['gold', 'green', 'red', 'orange', 'yellow', 'blue', 'purple', 'cyan', 'text', 'muted', 'faint', 'frame']);
export const PRIMITIVES = Object.freeze(['circle', 'rect', 'line', 'poly', 'path']);
export const ART_BOX = 32;

const C = (cx, cy, r, o) => ({ t: 'circle', cx, cy, r, ...o });
const R = (x, y, w, h, rx, o) => ({ t: 'rect', x, y, w, h, rx, ...o });
const L = (x1, y1, x2, y2, o) => ({ t: 'line', x1, y1, x2, y2, ...o });
const P = (pts, o) => ({ t: 'poly', pts, ...o });
const D = (d, o) => ({ t: 'path', d, ...o });

const entry = (month, id, name, shapes) => Object.freeze({ month, id, name, art: Object.freeze({ box: ART_BOX, shapes: Object.freeze(shapes.map((s) => Object.freeze(s))) }) });

export const SEASONS = Object.freeze([
  entry(1, 'snow-marker', 'Snow marker', [
    R(14, 8, 4, 20, 1, { fill: 'muted' }), R(11, 6, 10, 4, 1, { fill: 'cyan' }),
    C(8, 24, 2, { fill: 'text' }), C(24, 20, 1.5, { fill: 'text' }), L(4, 28, 28, 28, { stroke: 'frame', sw: 2 }),
  ]),
  entry(2, 'paper-kite', 'Paper kite', [
    P([[16, 3], [24, 12], [16, 22], [8, 12]], { fill: 'gold', stroke: 'text', sw: 1 }),
    L(16, 3, 16, 22, { stroke: 'text', sw: 1 }), L(8, 12, 24, 12, { stroke: 'text', sw: 1 }),
    D('M16 22 C12 25 20 27 16 30', { stroke: 'cyan', sw: 1.5, fill: 'none' }),
  ]),
  entry(3, 'first-sprout', 'First sprout', [
    R(6, 24, 20, 4, 1, { fill: 'orange' }), D('M16 24 C16 18 16 14 16 10', { stroke: 'green', sw: 2, fill: 'none' }),
    P([[16, 14], [8, 10], [12, 16]], { fill: 'green' }), P([[16, 12], [24, 7], [21, 14]], { fill: 'green' }), C(16, 26, 1.5, { fill: 'yellow' }),
  ]),
  entry(4, 'rain-ripple', 'Rain ripple', [
    C(16, 22, 9, { stroke: 'blue', sw: 1, fill: 'none' }), C(16, 22, 5, { stroke: 'blue', sw: 1, fill: 'none' }),
    P([[16, 4], [19, 10], [16, 13], [13, 10]], { fill: 'cyan' }), C(16, 22, 2, { fill: 'blue' }),
  ]),
  entry(5, 'blossom', 'Blossom', [
    C(22, 16, 4, { fill: 'purple' }), C(17.9, 21.7, 4, { fill: 'purple' }), C(11.1, 19.5, 4, { fill: 'purple' }),
    C(11.1, 12.5, 4, { fill: 'purple' }), C(17.9, 10.3, 4, { fill: 'purple' }), C(16, 16, 3, { fill: 'yellow' }),
  ]),
  entry(6, 'sundial', 'Sundial', [
    C(16, 18, 11, { stroke: 'gold', sw: 2, fill: 'none' }), P([[16, 18], [16, 8], [22, 18]], { fill: 'gold' }),
    L(5, 18, 8, 18, { stroke: 'muted', sw: 1.5 }), L(24, 18, 27, 18, { stroke: 'muted', sw: 1.5 }), L(6, 29, 26, 29, { stroke: 'frame', sw: 2 }),
  ]),
  entry(7, 'lantern-string', 'Lantern string', [
    D('M2 8 C10 14 22 14 30 8', { stroke: 'muted', sw: 1.5, fill: 'none' }),
    R(6, 13, 5, 7, 2, { fill: 'orange' }), R(14, 15, 5, 7, 2, { fill: 'gold' }), R(22, 13, 5, 7, 2, { fill: 'red' }),
  ]),
  entry(8, 'wheat-sheaf', 'Wheat sheaf', [
    L(16, 27, 8, 6, { stroke: 'yellow', sw: 2 }), L(16, 27, 12, 4, { stroke: 'yellow', sw: 2 }), L(16, 27, 16, 3, { stroke: 'yellow', sw: 2 }),
    L(16, 27, 20, 4, { stroke: 'yellow', sw: 2 }), L(16, 27, 24, 6, { stroke: 'yellow', sw: 2 }), R(11, 17, 10, 3, 1, { fill: 'orange' }),
  ]),
  entry(9, 'acorn', 'Acorn', [
    C(16, 19, 8, { fill: 'orange' }), R(8, 10, 16, 6, 3, { fill: 'muted' }), L(16, 10, 16, 5, { stroke: 'muted', sw: 2 }),
  ]),
  entry(10, 'fallen-leaf', 'Fallen leaf', [
    P([[16, 4], [25, 14], [21, 26], [16, 28], [11, 26], [7, 14]], { fill: 'orange', stroke: 'yellow', sw: 1 }),
    L(16, 6, 16, 28, { stroke: 'yellow', sw: 1 }), L(16, 14, 21, 10, { stroke: 'yellow', sw: 1 }), L(16, 19, 11, 15, { stroke: 'yellow', sw: 1 }),
  ]),
  entry(11, 'candle', 'Candle', [
    R(12, 14, 8, 14, 1, { fill: 'muted' }), P([[16, 4], [19, 10], [16, 13], [13, 10]], { fill: 'orange' }),
    L(16, 13, 16, 14, { stroke: 'frame', sw: 1 }), C(16, 9, 7, { stroke: 'yellow', sw: 1, fill: 'none' }),
  ]),
  entry(12, 'thread-spool', 'Thread spool', [
    R(8, 6, 16, 3, 1, { fill: 'muted' }), R(8, 23, 16, 3, 1, { fill: 'muted' }), R(11, 9, 10, 14, 0, { fill: 'purple' }),
    L(21, 16, 27, 22, { stroke: 'purple', sw: 1.5 }),
  ]),
]);

const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
export const monthName = (m) => MONTH_NAMES[m - 1] || '';

/** The entry for the LOCAL calendar month of `date` (a Date or a millisecond number); null when it is not a real date. */
export function seasonFor(date) {
  const d = date instanceof Date ? date : typeof date === 'number' ? new Date(date) : null;
  if (!d) return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return SEASONS[d.getMonth()] || null;
}

/** The words for assistive tech and the tooltip. */
export function seasonLabel(e) {
  return e && e.name ? 'Season ornament: ' + e.name + ' (' + monthName(e.month) + ')' : '';
}

const colour = (tok, dflt) => (tok === 'none' ? 'none' : TOKENS.includes(tok) ? 'var(--' + tok + ')' : dflt);
const num = (n) => (Number.isFinite(n) ? n : 0);

/** One primitive's style string (no hex ever reaches the page: unknown tokens fall back to the muted token). */
function styleOf(s, defaults) {
  const fill = colour(s.fill, defaults.fill), stroke = colour(s.stroke, defaults.stroke);
  const sw = s.sw === undefined ? '' : ';stroke-width:' + num(s.sw);
  return 'fill:' + fill + ';stroke:' + stroke + sw + ';stroke-linecap:round;stroke-linejoin:round';
}

/** The art split by primitive for the template's lists. Unknown primitives are dropped, never guessed. */
export function artLists(art) {
  const out = { box: ART_BOX, circles: [], rects: [], lines: [], polys: [], paths: [] };
  if (!art || !Array.isArray(art.shapes)) return out;
  out.box = Number.isFinite(art.box) ? art.box : ART_BOX;
  art.shapes.forEach((s, n) => {
    const key = 's' + n;
    if (!s || typeof s !== 'object') return;
    if (s.t === 'circle') out.circles.push({ key, cx: num(s.cx), cy: num(s.cy), r: num(s.r), style: styleOf(s, { fill: 'none', stroke: 'none' }) });
    else if (s.t === 'rect') out.rects.push({ key, x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), rx: num(s.rx), style: styleOf(s, { fill: 'none', stroke: 'none' }) });
    else if (s.t === 'line') out.lines.push({ key, x1: num(s.x1), y1: num(s.y1), x2: num(s.x2), y2: num(s.y2), style: styleOf({ stroke: 'muted', ...s, fill: 'none' }, { fill: 'none', stroke: 'none' }) });
    else if (s.t === 'poly' && Array.isArray(s.pts)) out.polys.push({ key, points: s.pts.map((p) => num(p[0]) + ',' + num(p[1])).join(' '), style: styleOf(s, { fill: 'none', stroke: 'none' }) });
    else if (s.t === 'path' && typeof s.d === 'string') out.paths.push({ key, d: s.d, style: styleOf({ stroke: 'muted', ...s }, { fill: 'none', stroke: 'none' }) });
  });
  return out;
}
