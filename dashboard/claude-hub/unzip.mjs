// Minimal streaming ZIP reader for the claude.ai export (spec 2026-10-13 §5.2). No dependency: the Hub runs on system
// Node outside Electron's node_modules. Reads the central directory and streams ONLY the wanted entries to FIXED names
// inside outDir (an entry's own path never touches the filesystem); stored/deflate only; size + CRC verified; capped.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ZIP_MAX_BYTES = 4 * 1024 ** 3;
const EOCD = 0x06054b50, Z64LOC = 0x07064b50, Z64EOCD = 0x06064b50, CEN = 0x02014b50, LOC = 0x04034b50, MAX32 = 0xffffffff;

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(Math.max(0, len));
  const { bytesRead } = await fh.read(b, 0, b.length, pos);
  return b.subarray(0, bytesRead);
}

export const baseName = (n) => String(n).split(/[\\/]/).pop();

export async function readZipIndex(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { e = i; break; }
    if (e < 0) throw new Error('not a zip file');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === MAX32 || cdOff === MAX32) {
      const locPos = size - tailLen + e - 20;
      const loc = locPos >= 0 ? await readAt(fh, locPos, 20) : Buffer.alloc(0);
      if (loc.length < 20 || loc.readUInt32LE(0) !== Z64LOC) throw new Error('zip64 locator missing');
      const z = await readAt(fh, Number(loc.readBigUInt64LE(8)), 56);
      if (z.length < 56 || z.readUInt32LE(0) !== Z64EOCD) throw new Error('zip64 record missing');
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) throw new Error('truncated zip');
    const cd = await readAt(fh, cdOff, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN) throw new Error('bad central directory');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      if (p + 46 + nlen + xlen + clen > cd.length) throw new Error('bad central directory');
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      for (let x = p + 46 + nlen, end = x + xlen; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === MAX32 && q + 8 <= end) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === MAX32 && q + 8 <= end) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === MAX32 && q + 8 <= end) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, crc, csize, usize, offset, encrypted: !!(flags & 1) });
      p += 46 + nlen + xlen + clen;
    }
    return { size, entries };
  } finally { await fh.close(); }
}

export async function extractEntries(file, wanted, outDir, { maxBytes = ZIP_MAX_BYTES } = {}) {
  const { size, entries } = await readZipIndex(file);
  const out = {};
  for (const want of wanted) {
    const hits = entries.filter((x) => !x.name.endsWith('/') && baseName(x.name).toLowerCase() === want.toLowerCase());
    if (!hits.length) continue;
    const e = hits.sort((a, b) => a.name.length - b.name.length)[0];
    if (e.encrypted) throw new Error(want + ' is encrypted');
    if (e.method !== 0 && e.method !== 8) throw new Error(want + ' uses an unsupported compression method (' + e.method + ')');
    let start;
    const fh = await fsp.open(file, 'r');
    try {
      const loc = await readAt(fh, e.offset, 30);
      if (loc.length < 30 || loc.readUInt32LE(0) !== LOC) throw new Error('bad local header for ' + want);
      start = e.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
    } finally { await fh.close(); }
    if (start + e.csize > size) throw new Error('truncated zip');
    let n = 0, crc = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        n += chunk.length;
        if (n > maxBytes) { cb(new Error(want + ' is larger than ' + maxBytes + ' bytes')); return; }
        crc = zlib.crc32(chunk, crc); cb(null, chunk);
      },
    });
    const src = e.csize === 0 ? Readable.from([]) : fs.createReadStream(file, { start, end: start + e.csize - 1 });
    const target = path.join(outDir, want);
    await pipeline(src, ...(e.method === 8 && e.csize > 0 ? [zlib.createInflateRaw()] : []), meter, fs.createWriteStream(target, { flags: 'wx' }));
    if (n !== e.usize) throw new Error(want + ': size mismatch');
    if ((crc >>> 0) !== e.crc) throw new Error(want + ': checksum mismatch');
    out[want] = target;
  }
  return out;
}

// One entry (from readZipIndex) into memory, by its exact index row: a Meta export holds hundreds of message_1.json,
// which extractEntries' basename lookup cannot tell apart. Same checks (method, local header, cap, size, CRC); nothing
// touches the disk. The caller keeps maxBytes small: this is for text files, never media.
export async function readEntry(file, e, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const label = baseName(e.name);
  if (e.encrypted) throw new Error(label + ' is encrypted');
  if (e.method !== 0 && e.method !== 8) throw new Error(label + ' uses an unsupported compression method (' + e.method + ')');
  if (e.usize > maxBytes) throw new Error(label + ' is larger than ' + maxBytes + ' bytes');
  const fh = await fsp.open(file, 'r');
  let start, size;
  try {
    size = (await fh.stat()).size;
    const loc = await readAt(fh, e.offset, 30);
    if (loc.length < 30 || loc.readUInt32LE(0) !== LOC) throw new Error('bad local header for ' + label);
    start = e.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
  } finally { await fh.close(); }
  if (start + e.csize > size) throw new Error('truncated zip');
  const chunks = [];
  let n = 0, crc = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      if (n > maxBytes) { cb(new Error(label + ' is larger than ' + maxBytes + ' bytes')); return; }
      crc = zlib.crc32(chunk, crc); chunks.push(chunk); cb();
    },
  });
  const src = e.csize === 0 ? Readable.from([]) : fs.createReadStream(file, { start, end: start + e.csize - 1 });
  await pipeline(src, ...(e.method === 8 && e.csize > 0 ? [zlib.createInflateRaw()] : []), meter);
  if (n !== e.usize) throw new Error(label + ': size mismatch');
  if ((crc >>> 0) !== e.crc) throw new Error(label + ': checksum mismatch');
  return Buffer.concat(chunks, n);
}
