// The Workbench look's five small illustrations (batch 8). Pure: real numbers in, shapes and readout text out. No DOM, no IO, no clock.
//
// Every picture is drawn from a FIXED table of four primitives (rect, line, circle, polyline) with coordinates written here by hand: nothing is
// traced, vectorized or read from a reference picture, and no picture names a product. Each one is a generic bench instrument with a small screen:
//   cleared   a tray with a screen         "N CLEARED"     (the clean-board card on Home)
//   skills    a pegboard of tools          "N SKILLS"      (the Crew header)
//   notes     a stack of note cards        "N NOTES"       (the Vault desk header)
//   needyou   a signal lamp                "0 NEED YOU"    (the empty Brief)
//   projects  a set of drawers             "N PROJECTS"    (the empty Projects shelf)
// Only these five readouts exist. The number in a readout is the number the host passed in, floored and clamped to 0 to 99999; anything that is
// not a finite number reads 0. Colours are the app's tokens only (var(--...)); a shape carries no literal colour.
//
//   workbenchArt(kind, n)  -> { kind, n, label, aria, viewBox, w, h, shapes: [{ key, prim, d, fill, stroke, sw }], screen: { x, y, w, h }, cursor: { x, y, w, h } }
//                             the screen box and the cursor are in viewBox units; the host overlays the readout text on the screen box
//   READOUTS               the five readout builders, the only strings that ever reach a screen
//   WBN_PRIMS              the primitive set; WBN_KINDS the five kinds; WBN_TOKENS the colour tokens a shape may use
export const WBN_KINDS = Object.freeze(['cleared', 'skills', 'notes', 'needyou', 'projects']);
export const WBN_PRIMS = Object.freeze(['rect', 'line', 'circle', 'polyline']);
export const WBN_TOKENS = Object.freeze(['var(--card)', 'var(--card-hi)', 'var(--ink)', 'var(--frame)', 'var(--frame-hi)', 'var(--gold)', 'var(--gold-2)', 'var(--green)', 'none']);
export const WBN_VIEW = Object.freeze({ w: 120, h: 84 });
export const WBN_MAX = 99999;

export const READOUTS = Object.freeze({
  cleared: (n) => n + ' CLEARED',
  skills: (n) => n + (n === 1 ? ' SKILL' : ' SKILLS'),
  notes: (n) => n + (n === 1 ? ' NOTE' : ' NOTES'),
  needyou: (n) => n + ' NEED YOU',
  projects: (n) => n + (n === 1 ? ' PROJECT' : ' PROJECTS'),
});

/** the count a readout shows: a whole number from 0 to 99999, anything else reads 0 */
export function readoutCount(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, Math.min(WBN_MAX, v));
}

// ---- the four primitives -> one path string each ------------------------------------------------------------------------------------
const f = (x) => String(Math.round(x * 100) / 100);
const D = {
  rect: ({ x, y, w, h }) => 'M' + f(x) + ' ' + f(y) + 'h' + f(w) + 'v' + f(h) + 'h' + f(-w) + 'z',
  line: ({ x1, y1, x2, y2 }) => 'M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2),
  circle: ({ cx, cy, r }) => 'M' + f(cx - r) + ' ' + f(cy) + 'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0z',
  polyline: ({ pts }) => 'M' + pts.map(([x, y]) => f(x) + ' ' + f(y)).join('L'),
};

// shape(prim, geometry, fill, stroke): stroke width is always 1.5 (the thin outline); round joins and caps come from the host's style
const SW = 1.5;
const shape = (prim, g, fill, stroke) => ({ prim, d: D[prim](g), fill, stroke, sw: SW });

// the shared small screen: a framed rect plus a cursor box the host blinks
const screen = (x, y, w, h) => ({ box: { x, y, w, h }, shapes: [shape('rect', { x, y, w, h }, 'var(--ink)', 'var(--frame-hi)')], cursor: { x: x + w - 9, y: y + h - 6, w: 5, h: 2 } });

const BUILD = {
  // a flat tray on feet with a screen above it and two dials
  cleared() {
    const s = screen(18, 8, 84, 24);
    return { s, shapes: [
      shape('rect', { x: 10, y: 38, w: 100, h: 30 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 18, y1: 50, x2: 102, y2: 50 }, 'none', 'var(--frame)'),
      shape('polyline', { pts: [[18, 60], [26, 64], [40, 56]] }, 'none', 'var(--green)'),
      shape('circle', { cx: 92, cy: 59, r: 4 }, 'var(--card-hi)', 'var(--frame-hi)'),
      shape('line', { x1: 18, y1: 68, x2: 18, y2: 76 }, 'none', 'var(--frame-hi)'),
      shape('line', { x1: 102, y1: 68, x2: 102, y2: 76 }, 'none', 'var(--frame-hi)'),
    ] };
  },
  // a pegboard: a back panel, a screen, three tool outlines hung on pegs
  skills() {
    const s = screen(14, 8, 92, 22);
    return { s, shapes: [
      shape('rect', { x: 8, y: 36, w: 104, h: 40 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 28, y1: 44, x2: 28, y2: 68 }, 'none', 'var(--gold)'),
      shape('circle', { cx: 28, cy: 71, r: 3 }, 'var(--card-hi)', 'var(--gold)'),
      shape('polyline', { pts: [[56, 44], [56, 62], [64, 68], [64, 44]] }, 'none', 'var(--frame-hi)'),
      shape('rect', { x: 84, y: 46, w: 12, h: 20 }, 'var(--card-hi)', 'var(--frame-hi)'),
      shape('circle', { cx: 28, cy: 40, r: 1.5 }, 'var(--frame-hi)', 'var(--frame-hi)'),
      shape('circle', { cx: 60, cy: 40, r: 1.5 }, 'var(--frame-hi)', 'var(--frame-hi)'),
      shape('circle', { cx: 90, cy: 42, r: 1.5 }, 'var(--frame-hi)', 'var(--frame-hi)'),
    ] };
  },
  // three note cards fanned in a stack under a screen
  notes() {
    const s = screen(22, 8, 76, 22);
    return { s, shapes: [
      shape('rect', { x: 14, y: 54, w: 92, h: 22 }, 'var(--card)', 'var(--frame)'),
      shape('rect', { x: 12, y: 46, w: 92, h: 22 }, 'var(--card-hi)', 'var(--frame-hi)'),
      shape('rect', { x: 10, y: 38, w: 92, h: 22 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 18, y1: 46, x2: 70, y2: 46 }, 'none', 'var(--gold)'),
      shape('line', { x1: 18, y1: 52, x2: 56, y2: 52 }, 'none', 'var(--frame)'),
    ] };
  },
  // a signal lamp on a base, its screen to the side
  needyou() {
    const s = screen(48, 12, 66, 24);
    return { s, shapes: [
      shape('rect', { x: 10, y: 66, w: 36, h: 10 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 28, y1: 66, x2: 28, y2: 42 }, 'none', 'var(--frame-hi)'),
      shape('circle', { cx: 28, cy: 30, r: 13 }, 'var(--card-hi)', 'var(--gold)'),
      shape('circle', { cx: 28, cy: 30, r: 5 }, 'var(--gold)', 'var(--gold-2)'),
      shape('rect', { x: 54, y: 46, w: 56, h: 30 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 62, y1: 56, x2: 102, y2: 56 }, 'none', 'var(--frame)'),
      shape('line', { x1: 62, y1: 66, x2: 90, y2: 66 }, 'none', 'var(--frame)'),
    ] };
  },
  // a three-drawer unit with a screen on top
  projects() {
    const s = screen(18, 6, 84, 20);
    return { s, shapes: [
      shape('rect', { x: 12, y: 32, w: 96, h: 14 }, 'var(--card)', 'var(--frame-hi)'),
      shape('rect', { x: 12, y: 46, w: 96, h: 14 }, 'var(--card-hi)', 'var(--frame-hi)'),
      shape('rect', { x: 12, y: 60, w: 96, h: 14 }, 'var(--card)', 'var(--frame-hi)'),
      shape('line', { x1: 52, y1: 39, x2: 68, y2: 39 }, 'none', 'var(--gold)'),
      shape('line', { x1: 52, y1: 53, x2: 68, y2: 53 }, 'none', 'var(--gold)'),
      shape('line', { x1: 52, y1: 67, x2: 68, y2: 67 }, 'none', 'var(--gold)'),
    ] };
  },
};

/** One illustration with its real number. An unknown kind is null (the host draws nothing). */
export function workbenchArt(kind, n) {
  if (!WBN_KINDS.includes(kind)) return null;
  const count = readoutCount(n);
  const b = BUILD[kind]();
  const label = READOUTS[kind](count);
  const shapes = b.s.shapes.concat(b.shapes).map((x, i) => ({ key: kind + i, prim: x.prim, d: x.d, fill: x.fill, stroke: x.stroke, sw: x.sw }));
  return {
    kind, n: count, label, aria: label.toLowerCase(), show: true,
    viewBox: '0 0 ' + WBN_VIEW.w + ' ' + WBN_VIEW.h, w: WBN_VIEW.w, h: WBN_VIEW.h,
    shapes, screen: b.s.box, cursor: b.s.cursor,
  };
}

/** The empty art every key of the wbnv group carries while the look is off, so the template always meets the same keys. */
export const WBN_EMPTY_ART = Object.freeze({
  kind: '', n: 0, label: '', aria: '', show: false, viewBox: '0 0 ' + WBN_VIEW.w + ' ' + WBN_VIEW.h, w: WBN_VIEW.w, h: WBN_VIEW.h,
  shapes: Object.freeze([]), screen: Object.freeze({ x: 0, y: 0, w: 0, h: 0 }), cursor: Object.freeze({ x: 0, y: 0, w: 0, h: 0 }),
  screenStyle: '', cursorX: 0, cursorY: 0, cursorW: 0, cursorH: 0,
});

/** The art a host binds: the pure picture plus the two things a template cannot compute (the readout box as a CSS style, the cursor's numbers). */
export function bindArt(kind, n) {
  const a = workbenchArt(kind, n);
  if (!a) return WBN_EMPTY_ART;
  const pw = (v) => (Math.round((v / a.w) * 10000) / 100) + '%';
  const ph = (v) => (Math.round((v / a.h) * 10000) / 100) + '%';
  return {
    ...a,
    screenStyle: 'position:absolute;left:' + pw(a.screen.x) + ';top:' + ph(a.screen.y) + ';width:' + pw(a.screen.w) + ';height:' + ph(a.screen.h) + ';display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;white-space:nowrap;overflow:hidden',
    cursorX: a.cursor.x, cursorY: a.cursor.y, cursorW: a.cursor.w, cursorH: a.cursor.h,
  };
}
