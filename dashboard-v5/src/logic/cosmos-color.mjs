// Cosmos space — colour maths and the colour-family taxonomy (the search box's "teal", the Feed's "By colour").
// Ported by hand (behaviour, not code) from Cosmos Local's src/lib/color.ts; TypeScript stripped, values unchanged.
// PURE and import-free: no DOM, no clock, no IO. Imported by cosmos-search.mjs (which the MCP server also imports),
// so keep it that way.
//
// A "colour record" (ColorSig) is { hex, r, g, b, h, s, l }: h in [0,360), s and l in [0,1].

/** @param {number} n @param {number} lo @param {number} hi */
export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** '#abc' / 'abc' / '#aabbcc' -> { r, g, b }. Short input is padded with 0 like the source app. */
export function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex(r, g, b) {
  const to = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** A full colour record from an rgb triple. */
export function toColorSig(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return { hex: rgbToHex(r, g, b), r, g, b, h, s, l };
}

/** True when `c` carries the numbers the maths needs (a half-written record never throws, it is just "unscanned"). */
export function isColorSig(c) {
  return !!c && typeof c === 'object' && Number.isFinite(c.h) && Number.isFinite(c.s) && Number.isFinite(c.l);
}

// ---- the taxonomy: twelve named hue families plus MONO ----

export const HUE_FAMILIES = Object.freeze([
  Object.freeze({ name: 'RED', short: 'RED', hueCenter: 0 }),
  Object.freeze({ name: 'ORANGE', short: 'ORG', hueCenter: 30 }),
  Object.freeze({ name: 'AMBER', short: 'AMB', hueCenter: 50 }),
  Object.freeze({ name: 'YELLOW', short: 'YEL', hueCenter: 60 }),
  Object.freeze({ name: 'LIME', short: 'LIM', hueCenter: 90 }),
  Object.freeze({ name: 'GREEN', short: 'GRN', hueCenter: 130 }),
  Object.freeze({ name: 'TEAL', short: 'TEL', hueCenter: 170 }),
  Object.freeze({ name: 'CYAN', short: 'CYN', hueCenter: 190 }),
  Object.freeze({ name: 'BLUE', short: 'BLU', hueCenter: 220 }),
  Object.freeze({ name: 'INDIGO', short: 'IND', hueCenter: 260 }),
  Object.freeze({ name: 'VIOLET', short: 'VIO', hueCenter: 285 }),
  Object.freeze({ name: 'MAGENTA', short: 'MAG', hueCenter: 320 }),
]);

export const MONO_FAMILY = Object.freeze({ name: 'MONO', short: 'MNO', hueCenter: -1 });

const HUE_BOUNDS = [15, 40, 55, 75, 105, 150, 180, 200, 240, 270, 300, 345];

/** Index 0..11 into HUE_FAMILIES for a hue; past 345 wraps back to RED. */
export function hueFamilyIndex(h) {
  for (let i = 0; i < HUE_BOUNDS.length; i++) if (h < HUE_BOUNDS[i]) return i;
  return 0;
}

/** Almost no saturation: the hue is noise, the work counts as neutral. */
export function isNeutral(c) {
  return c.s < 0.14;
}

/** Family NAME (upper-case) of a colour record: 'RED' ... 'MAGENTA' or 'MONO'. */
export function familyOf(c) {
  return isNeutral(c) ? MONO_FAMILY.name : HUE_FAMILIES[hueFamilyIndex(c.h)].name;
}

/** Perceptual-ish distance in HSL space: hue weighted by the lesser saturation, wrap-aware. */
export function colorDistance(a, b) {
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  const hueWeight = Math.min(a.s, b.s);
  const dhN = (dh / 180) * hueWeight;
  const ds = Math.abs(a.s - b.s);
  const dl = Math.abs(a.l - b.l);
  return Math.sqrt(dhN * dhN * 2 + ds * ds + dl * dl);
}
