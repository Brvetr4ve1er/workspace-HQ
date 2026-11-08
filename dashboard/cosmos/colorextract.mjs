/* Cosmos space — the colour scanner's quantizer: a signature colour and a palette from pixels.

   PORTED (behaviour, not code) from the source app's colorExtract.ts — the quantizer only. Its loadImage /
   loadVideoFrame / scanCache halves are browser-side and have no place here: the pixels now come from the
   native thumbnailer.

   INPUT CONTRACT: rgba32 = { width, height, data: Uint8Array|Uint8ClampedArray } with bytes in R,G,B,A order.
   It is NOT Windows BGRA: Electron's nativeImage.toBitmap() and the shell thumbnail return BGRA, and the
   channel swap lives in cosmos-native (the caller). A BGRA buffer passed here yields swapped colours — the
   red and blue channels trade places — by design; colorextract.test.mjs pins that so nobody "fixes" it here.

   Method (unchanged from the source): pixels with alpha < 125 are ignored; the rest go into coarse buckets
   (5 bits per channel); each bucket keeps its mean colour. The SIGNATURE is the bucket with the highest
   count * (0.45 + saturation) — a common-but-vivid accent beats a slightly bigger wall of near-white. The
   PALETTE is the top 5 buckets by raw count, skipping a colour within Manhattan RGB distance 48 of one
   already taken. Large inputs are sampled on a pixel stride (at most ~20,000 pixels looked at); the caller
   normally passes a small bitmap anyway.

   Returns { color: {hex,r,g,b,h,s,l}, palette: string[<=5] } or null for empty, malformed or fully
   transparent input. r,g,b are rounded to integers (the source kept the float means; the hex is identical).
   h is in [0,360), s and l in [0,1]. Pure: no IO, no clock. */

const SHIFT = 3;
const ALPHA_MIN = 125;
const MAX_SAMPLES = 20000;
const CLOSE_L1 = 48;
const PALETTE_SIZE = 5;

const clamp255 = (n) => Math.min(255, Math.max(0, Math.round(n)));
const toHex2 = (n) => clamp255(n).toString(16).padStart(2, '0');

function rgbToHex(r, g, b) {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

function rgbToHsl(r255, g255, b255) {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
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

function closeHex(a, b) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const dr = ((pa >> 16) & 255) - ((pb >> 16) & 255);
  const dg = ((pa >> 8) & 255) - ((pb >> 8) & 255);
  const db = (pa & 255) - (pb & 255);
  return Math.abs(dr) + Math.abs(dg) + Math.abs(db) < CLOSE_L1;
}

/**
 * @param {{ width:number, height:number, data:Uint8Array }} rgba32  RGBA byte order (NOT BGRA)
 * @returns {{ color:{hex:string,r:number,g:number,b:number,h:number,s:number,l:number}, palette:string[] } | null}
 */
export function extractColors(rgba32) {
  if (!rgba32 || !ArrayBuffer.isView(rgba32.data)) return null;
  const data = rgba32.data;
  const w = rgba32.width;
  const h = rgba32.height;
  let pixels = Math.floor(data.length / 4);
  if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) pixels = Math.min(pixels, w * h);
  if (pixels <= 0) return null;
  const step = Math.max(1, Math.ceil(pixels / MAX_SAMPLES));

  const buckets = new Map();
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    if (data[i + 3] < ALPHA_MIN) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> SHIFT) << 10) | ((g >> SHIFT) << 5) | (b >> SHIFT);
    let bk = buckets.get(key);
    if (!bk) {
      bk = { n: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, bk);
    }
    bk.n += 1;
    bk.r += r;
    bk.g += g;
    bk.b += b;
  }
  if (buckets.size === 0) return null;

  const all = [];
  for (const bk of buckets.values()) {
    const r = bk.r / bk.n;
    const g = bk.g / bk.n;
    const b = bk.b / bk.n;
    all.push({ r, g, b, n: bk.n, vivid: bk.n * (0.45 + rgbToHsl(r, g, b).s) });
  }

  let signature = all[0];
  for (const c of all) if (c.vivid > signature.vivid) signature = c;

  const palette = [];
  const byFreq = [...all].sort((a, b) => b.n - a.n);        // stable: ties keep first-seen order
  for (const c of byFreq) {
    if (palette.length >= PALETTE_SIZE) break;
    const hex = rgbToHex(c.r, c.g, c.b);
    if (palette.some((x) => closeHex(x, hex))) continue;
    palette.push(hex);
  }

  const r = clamp255(signature.r);
  const g = clamp255(signature.g);
  const b = clamp255(signature.b);
  return { color: { hex: rgbToHex(r, g, b), r, g, b, ...rgbToHsl(r, g, b) }, palette };
}
