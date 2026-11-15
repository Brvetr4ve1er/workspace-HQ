// Projects > Shelf (batch 7, dish "cartridge-shelf"): a playful second view of the SAME project list, never a replacement.
// Pure: no DOM, no clock, no storage, no listener, no timer. Everything the screen draws is data (point strings, colours, counts),
// so the template only binds it and a test can pin it.
//
//   cartridgeOf(row, opts)       one cartridge: { id, name, label, initials, hue, base, labelStops, ink, stripe, tone, gid, w, h, paths }
//   initialsOf(name)             up to two letters, '?' when there is nothing to take
//   parseColor(text)             { r, g, b } from #rgb / #rrggbb / rgb() / hsl() / var(--known-token), else null
//   luminance / contrastRatio    WCAG 2 relative luminance and contrast, on '#rrggbb'
//   sortProjects(list, id, ST)   the list sorters of vals/projects.js, mirrored (parity is pinned in shelf.test.mjs)
//   shelfRowOf(p, ST)            the light row the shelf needs from a project (id, name, tag, tone, color)
//   pickInserted(all, currentId) the project the console holds: the current one, else the first worst-first row
//   shelfLayout(items, opts)     rows of cartridges on rails, the paging, the count line, the inserted slot
//   insertedArt(cart)            the console-slot silhouette around one cartridge
//   shelfFlags(consoleLayer)     { on, shelf } read defensively from the persisted pref (the normaliser lives in console-layer.mjs)
//   motionAllowed({ reduceMotion, matchMedia })  the same two signals hq-v3.js reads: the pref OR the OS query
//
// Where the colour comes from: the list's row colour is the STATUS token ('var(--red)' ...), not a colour of the project's own
// (the scan has no such field). parseColor knows the v5 tokens, so a status-coloured row gets the real hue; a small deterministic
// shift from the project id keeps two projects with the same status apart on the shelf. Anything unparseable falls back to a
// neutral grey and never throws.
import { ST as CATALOG_ST } from '../live/catalog.mjs';

export const SHELF_PAGE = 48;
/** The artwork's own coordinate box. */
export const CART = Object.freeze({ w: 120, h: 148 });
/** How big a cartridge is drawn on the shelf (CSS px), and the gap between two. */
export const CELL = Object.freeze({ w: 104, h: 128, gap: 16 });
export const NEUTRAL = '#8a8d93';
export const INK_DARK = '#16120f';
export const INK_LIGHT = '#f7f3ea';
export const MIN_CONTRAST = 4.5;
export const TONES = Object.freeze(['red', 'orange', 'green', 'blue', 'gold', 'default']);

// The v5 palette tokens as the dark theme sets them (styles/tokens.css). The art is baked colour, so it reads the same in both themes.
export const TOKEN_HEX = Object.freeze({
  red: '#e5645a', orange: '#e0a35a', yellow: '#d8c26a', green: '#86b98a', blue: '#7aa2d6', purple: '#b39ddb', cyan: '#7cc4c0',
  gold: '#d97757', 'gold-2': '#e8916f', muted: '#a39d92', faint: '#6e695f',
  'tone-red': '#e5645a', 'tone-orange': '#e0a35a', 'tone-green': '#86b98a', 'tone-blue': '#7aa2d6', 'tone-gold': '#d97757', 'tone-default': '#a39d92',
});

// ---- colour maths ------------------------------------------------------------------------------------------------------------
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const byte = (x) => clamp(Math.round(x), 0, 255);
const hex2 = (n) => byte(n).toString(16).padStart(2, '0');
export const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}
export function rgbToHsl(c) {
  const R = c.r / 255, G = c.g / 255, B = c.b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, l = (mx + mn) / 2;
  let h = 0;
  if (d !== 0) { h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };

/** { r, g, b } (0..255 integers) from a colour string; null when the text is not one this knows. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const t = input.trim().toLowerCase();
  if (!t || t.length > 80) return null;
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(t);
  if (m) { const v = [m[1], m[2], m[3]].map(Number); return v.every((n) => n <= 255) ? { r: v[0], g: v[1], b: v[2] } : null; }
  m = /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d+(?:\.\d+)?)%\s*[, ]\s*(\d+(?:\.\d+)?)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(t);
  if (m) { const s = Number(m[2]), l = Number(m[3]); return s <= 100 && l <= 100 ? hslToRgb(Number(m[1]), s / 100, l / 100) : null; }
  m = /^var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(t);
  if (m && Object.prototype.hasOwnProperty.call(TOKEN_HEX, m[1])) return parseColor(TOKEN_HEX[m[1]]);
  return null;
}

const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
/** WCAG relative luminance of a colour ({r,g,b} or a parseable string). */
export function luminance(c) {
  const k = typeof c === 'string' ? parseColor(c) : c;
  if (!k) return 0;
  return 0.2126 * lin(k.r) + 0.7152 * lin(k.g) + 0.0722 * lin(k.b);
}
/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b), hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

/** FNV-1a 32 bit: the deterministic seed for one project's colour shift and gradient id. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Up to two letters: the first letter of the first two words (split on anything that is not a letter or a digit), uppercased; '?' when there is none. */
export function initialsOf(name) {
  const words = String(name == null ? '' : name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = words.slice(0, 2).map((w) => Array.from(w)[0].toLocaleUpperCase('en')).join('');
  return out || '?';
}

// ---- the plastic ---------------------------------------------------------------------------------------------------------------
// Everything below is fixed integers: the body is a chunky trapezoid (narrower at the top) with a notch cut into the top edge.
const SHELL = '10,4 44,4 44,13 76,13 76,4 110,4 116,140 110,146 10,146 4,140';
const BEVEL_LIGHT = '10,4 44,4 8,40';          // low-poly highlight, upper left
const BEVEL_DARK = '110,146 116,140 113,104';   // low-poly shade, lower right
const LABEL = Object.freeze({ x: 20, y: 28, w: 80, h: 70, rx: 3 });
const STRIPE = Object.freeze({ x: 20, y: 100, w: 80, h: 7 });
const INITIALS_AT = Object.freeze({ x: 60, y: 76 });
const GRIP = Object.freeze([36, 48, 60, 72, 84].map((x) => Object.freeze({ x1: x, y1: 116, x2: x, y2: 138 })));
const PAINT = Object.freeze({ shell: '#4a4d55', edge: '#2a2c31', grip: '#2a2c31', bevelLight: '#ffffff', bevelDark: '#000000', bevelLightOpacity: 0.16, bevelDarkOpacity: 0.28 });

const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);

/**
 * The colour family of one cartridge: the row's colour, shifted a little by the project id, as two label stops (top lighter, bottom
 * darker) and the ink the initials are drawn in. The ink reaches MIN_CONTRAST against BOTH stops (the stops are pushed away from the
 * ink until it does), so the initials stay readable over the whole gradient.
 */
export function labelColors(color, seed) {
  const base0 = parseColor(color) || parseColor(NEUTRAL);
  const hsl = rgbToHsl(base0);
  let base = base0;
  if (hsl.s >= 0.08) {   // a grey has no hue to shift
    const h = hash32(seed);
    base = hslToRgb(hsl.h + ((h % 29) - 14), hsl.s, hsl.l + (((h >>> 5) % 9) - 4) / 100);
  }
  let top = mix(base, WHITE, 0.14), bottom = mix(base, BLACK, 0.18);
  const worst = (ink) => Math.min(contrastRatio(ink, toHex(top)), contrastRatio(ink, toHex(bottom)));
  const ink = worst(INK_DARK) >= worst(INK_LIGHT) ? INK_DARK : INK_LIGHT;
  const away = ink === INK_DARK ? WHITE : BLACK;
  for (let i = 0; i < 40 && worst(ink) < MIN_CONTRAST; i++) { top = mix(top, away, 0.08); bottom = mix(bottom, away, 0.08); }
  return { base: toHex(base), labelStops: [toHex(top), toHex(bottom)], ink, hue: Math.round(rgbToHsl(base).h) % 360 };
}

/**
 * One cartridge from a list row ({ id, name, color, tone, tag }). Deterministic: the same row gives the same data, byte for byte.
 * opts.prefix names the gradient id ('shg' on the shelf, 'shi' for the inserted one, so a project drawn twice never shares an id).
 * `paths` is an object of named parts (the template draws each one), all in the CART box.
 */
export function cartridgeOf(row, opts) {
  const r = row && typeof row === 'object' ? row : {};
  const id = String(r.id == null ? '' : r.id);
  const name = String(r.name == null || r.name === '' ? (id || 'Untitled project') : r.name);
  const tone = TONES.includes(r.tone) ? r.tone : 'default';
  const status = typeof r.tag === 'string' && r.tag ? r.tag : 'status unknown';
  const c = labelColors(r.color, id || name);
  const prefix = opts && typeof opts.prefix === 'string' && opts.prefix ? opts.prefix : 'shg';
  const gid = prefix + '-' + safeId(id || name) + '-' + hash32(id || name).toString(36).slice(0, 5);
  return {
    id, name, label: name + ', ' + status, initials: initialsOf(name),
    hue: c.hue, base: c.base, labelStops: c.labelStops, stop0: c.labelStops[0], stop1: c.labelStops[1], ink: c.ink,
    stripe: 'var(--tone-' + tone + ')', tone,
    gid, fill: 'url(#' + gid + ')',
    w: CART.w, h: CART.h,
    paths: {
      shell: SHELL, bevelLight: BEVEL_LIGHT, bevelDark: BEVEL_DARK,
      label: { ...LABEL }, stripe: { ...STRIPE }, initials: { ...INITIALS_AT },
      grip: GRIP.map((g) => ({ ...g })), gripD: GRIP.map((g) => 'M' + g.x1 + ' ' + g.y1 + 'V' + g.y2).join(''),
      paint: { ...PAINT },
    },
  };
}

// ---- the same list, the same order -----------------------------------------------------------------------------------------------
/** The grid's sorters (vals/projects.js `sorters`), over raw projects. ST maps a status id to { rank }. */
export function projSorters(ST) {
  const S = ST || CATALOG_ST;
  return {
    worst: (a, b) => S[a.st].rank - S[b.st].rank || b.pct - a.pct,
    recent: (a, b) => (a.lastDays == null ? 999 : a.lastDays) - (b.lastDays == null ? 999 : b.lastDays),
    dirty: (a, b) => (b.dirty || 0) - (a.dirty || 0),
    name: (a, b) => a.name.localeCompare(b.name),
  };
}
/** A sorted copy (the list's own rule: an unknown sort id is worst-first). */
export function sortProjects(list, sortId, ST) {
  const s = projSorters(ST);
  return (Array.isArray(list) ? list : []).slice().sort(s[sortId] || s.worst);
}
/** The light row the shelf draws from a raw project (no chips, no activity: the list card has those). */
export function shelfRowOf(p, ST, open) {
  const S = ST || CATALOG_ST, st = S[p.st] || null;
  return { id: p.id, name: p.name, tag: st ? st.label : '', tone: st ? st.tone : 'default', color: st ? st.color : '', open: typeof open === 'function' ? () => open(p.id) : () => {} };
}

/** The row the console holds: the current project's, else the first row of `all` (worst-first, NOT narrowed by the search), else null. */
export function pickInserted(all, currentId) {
  const rows = Array.isArray(all) ? all : [];
  if (currentId != null && currentId !== '') { const hit = rows.find((r) => String(r.id) === String(currentId)); if (hit) return hit; }
  return rows.length ? rows[0] : null;
}

// ---- the layout ------------------------------------------------------------------------------------------------------------------
/** One shelf rail, in its own 100 x 12 box (the svg stretches it to the row): a lit top edge, a bevelled face, a shaded underside. */
export const RAIL = Object.freeze({ viewBox: '0 0 100 12', face: '0,2 100,2 99,10 1,10', lit: { x1: 0, y1: 2, x2: 100, y2: 2 }, shade: { x1: 1, y1: 10, x2: 99, y2: 10 } });

/** The console slot silhouette: the cartridge pushed in from above, the lower part hidden behind the console's front. */
export function insertedArt(cart) {
  return {
    viewBox: '0 0 180 120', w: 150, h: 100,
    cartTransform: 'translate(42 0) scale(0.8)',
    front: '0,76 180,76 176,118 4,118', lip: '34,70 146,70 150,80 30,80', slot: '34,72 146,72 144,78 36,78',
    light: { x1: 0, y1: 77, x2: 180, y2: 77 },
    paint: { front: '#3b3e46', lip: '#23252a', slot: '#101114', light: '#ffffff' },
    label: cart ? 'Inserted: ' + cart.name : 'Inserted',
  };
}

const plural = (n, one, many) => (n === 1 ? one : many);
export const countLine = (shown, total) => 'showing ' + shown + ' of ' + total;
export const moreLabel = (remaining) => (remaining > 0 ? 'Show ' + Math.min(SHELF_PAGE, remaining) + ' more' : '');
export function emptyLine(allCount) {
  if (!allCount) return 'No projects yet, so the shelf is empty.';
  return 'Nothing on the shelf matches. Clear the search or the status chip to see all ' + allCount + ' ' + plural(allCount, 'project', 'projects') + '.';
}

/** How many cartridges stand in one row for a content width (CSS px). At least one. */
export function perRow(width) {
  const w = Number.isFinite(width) ? width : 960;
  return Math.max(1, Math.floor((w + CELL.gap) / (CELL.w + CELL.gap)));
}

/**
 * The shelf for an already sorted and filtered list of rows ({ id, name, color, tone, tag, open }).
 *   opts.width      the content width, CSS px (default 960)
 *   opts.page       pages shown, 1-based (default 1); SHELF_PAGE cartridges per page
 *   opts.currentId  the project the console holds (the shared next action's project); falls back to the first of opts.all
 *   opts.all        every project, worst-first, NOT narrowed by the search; default = items
 *   opts.allCount   how many projects exist at all (for the empty line); default = all.length
 * Returns { total, shown, remaining, page, perRow, rows:[{ key, items, rail }], hasMore, moreLabel, countLine, empty, emptyLine, inserted }.
 * Pure data; never throws on a junk row.
 */
export function shelfLayout(items, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const list = (Array.isArray(items) ? items : []).filter((r) => r && typeof r === 'object');
  const page = Number.isInteger(o.page) && o.page >= 1 ? o.page : 1;
  const total = list.length, shown = Math.min(total, page * SHELF_PAGE), remaining = total - shown;
  const per = perRow(o.width);
  const all = Array.isArray(o.all) ? o.all : list;
  const allCount = Number.isInteger(o.allCount) ? o.allCount : all.length;
  const carts = list.slice(0, shown).map((r) => Object.assign(cartridgeOf(r, { prefix: 'shg' }), { open: typeof r.open === 'function' ? r.open : () => {} }));
  const rows = [];
  for (let i = 0; i < carts.length; i += per) rows.push({ key: 'r' + rows.length, items: carts.slice(i, i + per), rail: RAIL });
  const insRow = pickInserted(all, o.currentId);
  let inserted = null;
  if (insRow) {
    const cart = Object.assign(cartridgeOf(insRow, { prefix: 'shi' }), { open: typeof insRow.open === 'function' ? insRow.open : () => {} });
    const art = insertedArt(cart);
    inserted = Object.assign(cart, { label: art.label + ', ' + (insRow.tag || 'status unknown'), caption: art.label, art });
  }
  return {
    total, shown, remaining, page, perRow: per, rows, hasMore: remaining > 0, moreLabel: moreLabel(remaining), countLine: countLine(shown, total),
    empty: total === 0, emptyLine: total === 0 ? emptyLine(allCount) : '', inserted,
  };
}

// ---- the sub-flag, the paging memory, the motion rule ----------------------------------------------------------------------------
/** { on, shelf } as plain booleans from the persisted consoleLayer pref (anything else reads false). The pref's own normaliser is console-layer.mjs. */
export function shelfFlags(consoleLayer) {
  const c = consoleLayer && typeof consoleLayer === 'object' ? consoleLayer : {};
  return { on: c.on === true, shelf: c.on === true && c.shelf === true };
}
/** The filters a "show more" belongs to: change the search, the status chip or the sort and the page count starts again. */
export const shelfKey = (sort, q, st) => String(sort || 'worst') + '|' + String(q || '').trim().toLowerCase() + '|' + String(st || 'all');
/** Pages shown for this key out of the remembered { key, pages } (anything else = 1). */
export function shelfPages(memory, key) {
  return memory && typeof memory === 'object' && memory.key === key && Number.isInteger(memory.pages) && memory.pages >= 1 && memory.pages <= 1000 ? memory.pages : 1;
}
/** Hover may lift a cartridge only when neither signal asks for less motion (the pref, or the OS query; hq-v3.js reads the same two). */
export function motionAllowed(env) {
  const e = env && typeof env === 'object' ? env : {};
  if (e.reduceMotion) return false;
  try { if (typeof e.matchMedia === 'function' && e.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* no media query: motion stays allowed */ }
  return true;
}
