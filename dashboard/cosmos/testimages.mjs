/* Cosmos space — hand-built test images (dashboard/cosmos/testimages.mjs). Pure: node:zlib and byte
   arithmetic only, no IO, no clock, no electron.

   Why this exists: the Electron-run check (dashboard/cosmos-native.check.js) has to put a KNOWN colour
   through every thumbnail strategy and compare what comes out, and the unit tests need the same bytes
   without a picture from anywhere. So the images are built here, from numbers.

   Exports exactly: crc32, solidPng, solidBmp, solidSvg. */

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (the PNG / zip polynomial) of a byte array; returns an unsigned 32-bit number. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function channel(v, name) {
  if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`${name} must be an integer 0-255`);
  return v;
}

function dimension(v, name) {
  if (!Number.isInteger(v) || v < 1 || v > 16384) throw new RangeError(`${name} must be an integer 1-16384`);
  return v;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A solid-colour PNG: 8-bit RGB, no interlace, filter 0 on every row, ONE IDAT. */
export function solidPng(r, g, b, w = 64, h = 64) {
  channel(r, 'r'); channel(g, 'g'); channel(b, 'b'); dimension(w, 'w'); dimension(h, 'h');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type 2 = RGB
  // compression, filter and interlace stay 0
  const stride = 1 + 3 * w;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;               // byte 0 of the row is the filter type (0 = none)
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A solid-colour 24-bit BMP (BI_RGB, bottom-up, rows padded to 4 bytes, stored B,G,R). */
export function solidBmp(r, g, b, w = 16, h = 16) {
  channel(r, 'r'); channel(g, 'g'); channel(b, 'b'); dimension(w, 'w'); dimension(h, 'h');
  const stride = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = stride * h;
  const out = Buffer.alloc(54 + pixelBytes);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);       // file size
  out.writeUInt32LE(54, 10);              // offset of the pixel data
  out.writeUInt32LE(40, 14);              // BITMAPINFOHEADER size
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);                // positive = bottom-up
  out.writeUInt16LE(1, 26);               // planes
  out.writeUInt16LE(24, 28);              // bits per pixel
  out.writeUInt32LE(0, 30);               // BI_RGB
  out.writeUInt32LE(pixelBytes, 34);
  out.writeInt32LE(2835, 38);             // 72 dpi
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = 54 + y * stride + x * 3;
      out[p] = b; out[p + 1] = g; out[p + 2] = r;
    }
  }
  return out;
}

/** A 64x64 SVG with one rect of the given colour ('#rrggbb' or 'rrggbb'); nothing else in it. */
export function solidSvg(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex));
  if (!m) throw new RangeError('solidSvg wants a #rrggbb colour');
  const fill = '#' + m[1].toLowerCase();
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" fill="${fill}"/></svg>`
  );
}
