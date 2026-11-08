/* Cosmos space — image width and height from file HEADERS only (no decode, no dependency).

   The Feed's masonry layout is a pure function of aspect ratios, so every element needs a width and a
   height before its thumbnail exists. Reading a few KB of header is enough for every format the library
   holds; the indexer reads the first HEADER_BYTES of a file and calls imageSize() on them.

   Formats: PNG (IHDR), JPEG (any SOF0–SOF15 frame: baseline, extended, progressive, lossless, arithmetic),
   WebP (VP8, VP8L, VP8X), AVIF (the ispe property), GIF, BMP (core and info headers), SVG (width/height,
   else viewBox). Detection is by magic bytes, never by file name.

   Contract: imageSize(bytes) → { width, height, format, orientation? } | null.
     - It NEVER throws. Truncated, garbage, wrong-type or oversized input returns null.
     - width/height are the stored (raw) pixel size. For a JPEG with an EXIF orientation tag the tag value
       is returned in `orientation` (1–8); orientedSize() swaps width and height for 5–8, which is what the
       source app's thumbnails did, so layout and thumbnail agree.
     - AVIF with several ispe properties (thumbnail, grid tiles, alpha) → the largest, which is the canvas.
       A rotation property (irot) is not applied.
   Pure: no fs, no clock. */

/** Read this many leading bytes of a file; every supported header (and a typical AVIF meta box) fits. */
export const HEADER_BYTES = 262144;

/** Anything larger is a corrupt header, not a picture. */
const MAX_DIM = 1_000_000;

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u32be = (b, o) => ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
const u32le = (b, o) => ((b[o + 3] * 0x1000000) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]));
const i32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n; i += 1) s += String.fromCharCode(b[o + i]); return s; };
const has = (b, o, n) => o >= 0 && o + n <= b.length;

function result(width, height, format, extra) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) return null;
  return { width, height, format, ...(extra || {}) };
}

function png(b) {
  if (!has(b, 0, 24)) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  return result(u32be(b, 16), u32be(b, 20), 'png');
}

function gif(b) {
  if (!has(b, 0, 10)) return null;
  const head = ascii(b, 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return null;
  return result(u16le(b, 6), u16le(b, 8), 'gif');
}

function bmp(b) {
  if (!has(b, 0, 26) || b[0] !== 0x42 || b[1] !== 0x4d) return null;
  const dib = u32le(b, 14);
  if (dib === 12) return result(u16le(b, 18), u16le(b, 20), 'bmp');             // BITMAPCOREHEADER
  if (dib >= 40 && dib <= 1024) return result(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)), 'bmp');   // a negative height = top-down
  return null;
}

/** EXIF orientation (1–8) from a JPEG APP1 segment body starting at `o`, or undefined. */
function exifOrientation(b, o, end) {
  if (end - o < 14 || ascii(b, o, 6) !== 'Exif\0\0') return undefined;
  const t = o + 6;
  const little = ascii(b, t, 2) === 'II';
  if (!little && ascii(b, t, 2) !== 'MM') return undefined;
  const r16 = (p) => (little ? u16le(b, p) : u16be(b, p));
  const r32 = (p) => (little ? u32le(b, p) : u32be(b, p));
  if (t + 8 > end || r16(t + 2) !== 42) return undefined;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return undefined;
  const n = r16(ifd);
  for (let i = 0; i < n && i < 256; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return undefined;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

function jpeg(b) {
  if (!has(b, 0, 4) || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  let orientation;
  for (let guard = 0; guard < 4096; guard += 1) {
    // each segment starts with 0xFF (possibly padded with more 0xFF) and a marker byte
    if (i >= b.length || b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i += 1;
    if (i >= b.length) return null;
    const m = b[i];
    i += 1;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;     // markers without a length
    if (m === 0xd9 || m === 0xda) return null;                             // EOI / SOS before any frame header
    if (!has(b, i, 2)) return null;
    const len = u16be(b, i);
    if (len < 2) return null;
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) {
      if (len < 8 || !has(b, i, 7)) return null;
      const height = u16be(b, i + 3);
      const width = u16be(b, i + 5);
      return result(width, height, 'jpeg', orientation ? { orientation } : undefined);
    }
    if (m === 0xe1 && orientation === undefined) {
      const end = Math.min(i + len, b.length);
      orientation = exifOrientation(b, i + 2, end);
    }
    i += len;
  }
  return null;
}

function webp(b) {
  if (!has(b, 0, 16) || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const kind = ascii(b, 12, 4);
  if (kind === 'VP8 ') {
    if (!has(b, 20, 10) || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return result(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff, 'webp');
  }
  if (kind === 'VP8L') {
    if (!has(b, 20, 5) || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return result((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'webp');
  }
  if (kind === 'VP8X') {
    if (!has(b, 20, 10)) return null;
    const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return result(w, h, 'webp');
  }
  return null;
}

/* ISO base media boxes: [size:4][type:4] (size 1 → 64-bit size after the type, size 0 → to the end). */
function boxes(b, start, end, visit) {
  let p = start;
  for (let guard = 0; guard < 4096 && p + 8 <= end; guard += 1) {
    let size = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    let head = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      const hi = u32be(b, p + 8);
      if (hi > 0) return;                                    // a box over 4 GB inside a header: not ours
      size = u32be(b, p + 12);
      head = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < head) return;
    const stop = Math.min(p + size, end);                    // a truncated container is still walked up to the data we have
    if (visit(type, p + head, stop, p + size <= end) === false) return;
    p += size;
  }
}

function avif(b) {
  if (!has(b, 0, 16) || ascii(b, 4, 4) !== 'ftyp') return null;
  const ftypEnd = Math.min(u32be(b, 0), b.length);
  let brandOk = false;
  for (let o = 8; o + 4 <= ftypEnd; o += 4) {
    if (o === 12) continue;                                  // minor version, not a brand
    const brand = ascii(b, o, 4);
    if (brand === 'avif' || brand === 'avis') brandOk = true;
  }
  if (!brandOk) return null;
  let best = null;
  boxes(b, 0, b.length, (type, body, stop) => {
    if (type !== 'meta') return true;
    boxes(b, body + 4, stop, (t2, body2, stop2) => {         // meta is a full box: 4 bytes of version/flags first
      if (t2 !== 'iprp') return true;
      boxes(b, body2, stop2, (t3, body3, stop3) => {
        if (t3 !== 'ipco') return true;
        boxes(b, body3, stop3, (t4, body4, stop4, whole) => {
          if (t4 === 'ispe' && whole && stop4 - body4 >= 12) {
            const w = u32be(b, body4 + 4);
            const h = u32be(b, body4 + 8);
            if (w >= 1 && h >= 1 && w <= MAX_DIM && h <= MAX_DIM && (!best || w * h > best.w * best.h)) best = { w, h };
          }
          return true;
        });
        return false;
      });
      return false;
    });
    return false;
  });
  return best ? result(best.w, best.h, 'avif') : null;
}

const NUM = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i;

function svgAttr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : null;
}

function svg(b) {
  // text format: look at the first part only, as latin-1 so any byte decodes
  const n = Math.min(b.length, 65536);
  let text = '';
  for (let i = 0; i < n; i += 1) text += String.fromCharCode(b[i]);
  const m = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(text);
  if (!m) return null;
  const tag = ` ${m[1]}`;
  const w = svgAttr(tag, 'width');
  const h = svgAttr(tag, 'height');
  const wn = w ? NUM.exec(w) : null;
  const hn = h ? NUM.exec(h) : null;
  if (wn && hn) {
    const r = result(Math.round(parseFloat(wn[1])), Math.round(parseFloat(hn[1])), 'svg');
    if (r) return r;
  }
  const vb = svgAttr(tag, 'viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) return result(Math.round(parts[2]), Math.round(parts[3]), 'svg');
  }
  return null;
}

/**
 * Pixel size from the leading bytes of an image file.
 * @param {Uint8Array|ArrayBuffer} input  the first HEADER_BYTES (or more) of the file
 * @returns {{ width: number, height: number, format: string, orientation?: number } | null}
 */
export function imageSize(input) {
  try {
    const b = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(b instanceof Uint8Array) || b.length < 4) return null;
    return png(b) || jpeg(b) || gif(b) || bmp(b) || webp(b) || avif(b) || svg(b) || null;
  } catch {
    return null;
  }
}

/** The size the picture is DISPLAYED at: width and height swap for EXIF orientations 5–8 (quarter turns). */
export function orientedSize(info) {
  if (!info) return null;
  return info.orientation >= 5 ? { width: info.height, height: info.width } : { width: info.width, height: info.height };
}
