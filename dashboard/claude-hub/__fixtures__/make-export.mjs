// Placeholder claude.ai export builder for tests and gates. Placeholder text only; ZIPs are written at runtime.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function zipFiles(file, files, { forceZip64 = false } = {}) {
  const parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const method = f.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw), usize = f.lieSize ?? raw.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(usize, 22); loc.writeUInt16LE(name.length, 26);
    parts.push(loc, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(usize, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cen), tail = [];
  if (forceZip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(files.length), 24); z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(off), 48);
    const l = Buffer.alloc(20);
    l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cd.length), 8); l.writeUInt32LE(1, 16);
    tail.push(z, l);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 8); e.writeUInt16LE(forceZip64 ? 0xffff : files.length, 10);
  e.writeUInt32LE(forceZip64 ? 0xffffffff : cd.length, 12); e.writeUInt32LE(forceZip64 ? 0xffffffff : off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, ...tail, e]));
}
