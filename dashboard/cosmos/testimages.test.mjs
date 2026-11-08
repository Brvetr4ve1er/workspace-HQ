// Cosmos space — the hand-built test images (dashboard/cosmos/testimages.mjs). Placeholder colours only.
//   node --test dashboard/cosmos/testimages.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { crc32, solidPng, solidBmp, solidSvg } from './testimages.mjs';
import * as mod from './testimages.mjs';

function chunks(png) {
  const out = [];
  let p = 8;
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('latin1', p + 4, p + 8);
    out.push({ type, data: png.subarray(p + 8, p + 8 + len), crc: png.readUInt32BE(p + 8 + len), crcInput: png.subarray(p + 4, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

describe('testimages exports', () => {
  it('exports crc32, solidPng, solidBmp, solidSvg and nothing else', () => {
    assert.deepEqual(Object.keys(mod).sort(), ['crc32', 'solidBmp', 'solidPng', 'solidSvg']);
  });
});

describe('crc32', () => {
  it('matches the well-known check value for "123456789"', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  });
  it('is 0 for nothing', () => {
    assert.equal(crc32(new Uint8Array(0)), 0);
  });
});

describe('solidPng', () => {
  const png = solidPng(255, 0, 0, 64, 64);

  it('starts with the PNG signature and ends with IEND', () => {
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cs = chunks(png);
    assert.deepEqual(cs.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    assert.equal(cs[2].data.length, 0);
  });

  it('has a correct IHDR (size, 8-bit, RGB, no interlace)', () => {
    const ihdr = chunks(png)[0].data;
    assert.equal(ihdr.length, 13);
    assert.equal(ihdr.readUInt32BE(0), 64);
    assert.equal(ihdr.readUInt32BE(4), 64);
    assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0]);
  });

  it('carries a CRC that recomputes for every chunk', () => {
    for (const c of chunks(png)) assert.equal(crc32(c.crcInput), c.crc, c.type);
  });

  it('has an IDAT that inflates to height x (1 + 3*width) bytes of the requested colour', () => {
    const p = solidPng(10, 200, 30, 5, 3);
    const idat = chunks(p).find((c) => c.type === 'IDAT').data;
    const raw = inflateSync(idat);
    assert.equal(raw.length, 3 * (1 + 3 * 5));
    for (let y = 0; y < 3; y++) {
      assert.equal(raw[y * 16], 0, 'filter byte 0');
      for (let x = 0; x < 5; x++) {
        const o = y * 16 + 1 + x * 3;
        assert.deepEqual([raw[o], raw[o + 1], raw[o + 2]], [10, 200, 30]);
      }
    }
  });

  it('uses ONE IDAT even for a big picture', () => {
    const big = solidPng(1, 2, 3, 300, 200);
    assert.equal(chunks(big).filter((c) => c.type === 'IDAT').length, 1);
  });

  it('refuses a channel or size that is out of range', () => {
    assert.throws(() => solidPng(256, 0, 0), RangeError);
    assert.throws(() => solidPng(0, -1, 0), RangeError);
    assert.throws(() => solidPng(0, 0, 1.5), RangeError);
    assert.throws(() => solidPng(0, 0, 0, 0, 4), RangeError);
    assert.throws(() => solidPng(0, 0, 0, 4, 99999), RangeError);
  });
});

describe('solidBmp', () => {
  it('writes BM, consistent sizes and a 24-bit bottom-up header', () => {
    const bmp = solidBmp(1, 2, 3, 5, 4);        // 5*3 = 15 bytes a row, padded to 16
    assert.equal(bmp.toString('latin1', 0, 2), 'BM');
    assert.equal(bmp.readUInt32LE(2), bmp.length);
    assert.equal(bmp.length, 54 + 16 * 4);
    assert.equal(bmp.readUInt32LE(10), 54);
    assert.equal(bmp.readUInt32LE(14), 40);
    assert.equal(bmp.readInt32LE(18), 5);
    assert.equal(bmp.readInt32LE(22), 4);
    assert.equal(bmp.readUInt16LE(26), 1);
    assert.equal(bmp.readUInt16LE(28), 24);
    assert.equal(bmp.readUInt32LE(30), 0);
    assert.equal(bmp.readUInt32LE(34), 16 * 4);
  });

  it('stores each pixel as B, G, R', () => {
    const bmp = solidBmp(255, 128, 0, 2, 2);
    assert.deepEqual([bmp[54], bmp[55], bmp[56]], [0, 128, 255]);
    assert.deepEqual([bmp[57], bmp[58], bmp[59]], [0, 128, 255]);
  });

  it('pads rows with zeros', () => {
    const bmp = solidBmp(9, 9, 9, 1, 2);        // 3 bytes a row, padded to 4
    assert.equal(bmp[54 + 3], 0);
    assert.equal(bmp[54 + 4 + 3], 0);
  });
});

describe('solidSvg', () => {
  it('is a well-formed svg that holds only the colour', () => {
    const svg = solidSvg('#008080');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64" viewBox="0 0 64 64">/);
    assert.match(svg, /<rect width="64" height="64" fill="#008080"\/><\/svg>$/);
    assert.equal((svg.match(/#[0-9a-f]{6}/g) || []).length, 1);
    assert.equal((svg.match(/</g) || []).length, 3);
    assert.ok(!/script|href|url\(|http:\/\/(?!www\.w3\.org)/.test(svg));
  });

  it('lower-cases the colour and accepts it without #', () => {
    assert.match(solidSvg('FF00AA'), /fill="#ff00aa"/);
  });

  it('refuses anything that is not a six-digit colour (nothing can be injected)', () => {
    assert.throws(() => solidSvg('red'), RangeError);
    assert.throws(() => solidSvg('#fff'), RangeError);
    assert.throws(() => solidSvg('#00ff00"/><script>'), RangeError);
  });
});
