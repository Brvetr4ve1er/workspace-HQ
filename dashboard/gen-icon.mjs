#!/usr/bin/env node
// Generates icon.png (32x32 RGBA) — a blue tile with a white "H" — for the Electron
// tray/window. No image libs: hand-rolls a PNG (IHDR/IDAT/IEND + CRC32 + zlib).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 32, H = 32;

// CRC32
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// pixels: blue bg #58a6ff, white H
const BG = [0x16, 0x1b, 0x22, 255], TILE = [0x58, 0xa6, 0xff, 255], INK = [255, 255, 255, 255];
function isH(x, y) {
  const left = x >= 9 && x <= 12, right = x >= 19 && x <= 22, mid = y >= 14 && y <= 17 && x >= 9 && x <= 22;
  const vert = (left || right) && y >= 7 && y <= 24;
  return vert || mid;
}
function inTile(x, y) { return x >= 2 && x <= 29 && y >= 2 && y <= 29; }

const raw = Buffer.alloc((W * 4 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // filter
  for (let x = 0; x < W; x++) {
    const px = !inTile(x, y) ? BG : isH(x, y) ? INK : TILE;
    raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2]; raw[o++] = px[3];
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log(`[gen-icon] ${png.length} bytes -> ${out}`);
