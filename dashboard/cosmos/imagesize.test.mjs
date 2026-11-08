// Cosmos space — image size from headers (dashboard/cosmos/imagesize.mjs).
// Every fixture is a synthetic header built right here: no real picture, name or path is involved.
//   node --test dashboard/cosmos/imagesize.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, orientedSize, HEADER_BYTES } from './imagesize.mjs';

/* ---------- byte helpers ---------- */
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const text = (s) => new TextEncoder().encode(s);

/* ---------- synthetic files ---------- */
const png = (w, h) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0], be32(0));

const gif = (w, h, v = '89a') => bytes('GIF' + v, le16(w), le16(h), [0xf7, 0, 0]);

const bmpInfo = (w, h) => bytes('BM', le32(54), le32(0), le32(54), le32(40), le32(w), le32(h >>> 0), le16(1), le16(24), le32(0));
const bmpCore = (w, h) => bytes('BM', le32(26), le32(0), le32(26), le32(12), le16(w), le16(h), le16(1), le16(24));

/** JPEG with optional leading segments; `sof` is the frame marker byte (0xC0 baseline, 0xC2 progressive…). */
const seg = (marker, body) => bytes([0xff, marker], be16(body.length + 2), body);
const sof = (marker, w, h) => seg(marker, bytes([8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
const jfif = () => seg(0xe0, bytes('JFIF\0', [1, 1, 0], be16(1), be16(1), [0, 0]));
function exif(orientation, order = 'II') {
  const le = order === 'II';
  const w16 = (n) => (le ? le16(n) : be16(n));
  const w32 = (n) => (le ? le32(n) : be32(n));
  const tiff = bytes(order, w16(42), w32(8), w16(2),
    w16(0x010f), w16(2), w32(1), w32(0),                    // Make (ignored)
    w16(0x0112), w16(3), w32(1), w16(orientation), w16(0),  // Orientation
    w32(0));
  return seg(0xe1, bytes('Exif\0\0', tiff));
}
const jpeg = (w, h, { marker = 0xc0, before = [] } = {}) => bytes([0xff, 0xd8], ...before, sof(marker, w, h), [0xff, 0xda, 0, 2], [0xff, 0xd9]);

const webpLossy = (w, h) => bytes('RIFF', le32(30), 'WEBP', 'VP8 ', le32(10), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h));
const webpLossless = (w, h) => bytes('RIFF', le32(25), 'WEBP', 'VP8L', le32(5), [0x2f], le32((w - 1) | ((h - 1) << 14)));
const webpExt = (w, h) => bytes('RIFF', le32(30), 'WEBP', 'VP8X', le32(10), [0x10, 0, 0, 0], le24(w - 1), le24(h - 1));

/** ISO box */
const box = (type, ...body) => { const b = bytes(...body); return bytes(be32(b.length + 8), type, b); };
const ispe = (w, h) => box('ispe', [0, 0, 0, 0], be32(w), be32(h));
const avif = (...props) =>
  bytes(box('ftyp', 'avif', be32(0), 'avif', 'mif1'),
    box('meta', [0, 0, 0, 0], box('hdlr', [0, 0, 0, 0], be32(0), 'pict', be32(0), be32(0), be32(0), [0]),
      box('iprp', box('ipco', box('colr', 'nclx', [0, 1, 0, 1, 0x80]), ...props))),
    box('mdat', [1, 2, 3, 4]));

describe('imageSize — every format', () => {
  it('PNG', () => assert.deepEqual(imageSize(png(640, 480)), { width: 640, height: 480, format: 'png' }));
  it('PNG with a width above 2^24 is still read as unsigned', () => {
    assert.equal(imageSize(png(256, 16777216)), null);                // over the sanity cap: refused, not wrapped
    assert.deepEqual(imageSize(png(65535, 3)), { width: 65535, height: 3, format: 'png' });
  });
  it('GIF87a and GIF89a', () => {
    assert.deepEqual(imageSize(gif(320, 200)), { width: 320, height: 200, format: 'gif' });
    assert.deepEqual(imageSize(gif(1, 2, '87a')), { width: 1, height: 2, format: 'gif' });
  });
  it('BMP: info header, core header, and a top-down (negative height) bitmap', () => {
    assert.deepEqual(imageSize(bmpInfo(100, 50)), { width: 100, height: 50, format: 'bmp' });
    assert.deepEqual(imageSize(bmpInfo(100, -50)), { width: 100, height: 50, format: 'bmp' });
    assert.deepEqual(imageSize(bmpCore(30, 20)), { width: 30, height: 20, format: 'bmp' });
  });
  it('JPEG baseline, with JFIF in front', () => {
    assert.deepEqual(imageSize(jpeg(4000, 3000, { before: [jfif()] })), { width: 4000, height: 3000, format: 'jpeg' });
  });
  it('JPEG progressive (SOF2) and the other frame types, but not DHT/JPG/DAC', () => {
    assert.deepEqual(imageSize(jpeg(1200, 800, { marker: 0xc2 })), { width: 1200, height: 800, format: 'jpeg' });
    for (const m of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
      assert.deepEqual(imageSize(jpeg(7, 9, { marker: m })), { width: 7, height: 9, format: 'jpeg' }, `SOF marker ${m.toString(16)}`);
    }
    for (const m of [0xc4, 0xc8, 0xcc]) assert.equal(imageSize(jpeg(7, 9, { marker: m })), null, `marker ${m.toString(16)} is not a frame`);
  });
  it('JPEG skips fill bytes, restart markers and long APPn segments before the frame', () => {
    const big = seg(0xe2, new Uint8Array(5000));
    const padded = bytes([0xff, 0xd8], [0xff, 0xff, 0xff], jfif(), [0xff, 0xd0], big, sof(0xc2, 321, 123));
    assert.deepEqual(imageSize(padded), { width: 321, height: 123, format: 'jpeg' });
  });
  it('JPEG reports the EXIF orientation, big- and little-endian, and orientedSize() swaps for 5–8', () => {
    const a = imageSize(jpeg(4000, 3000, { before: [jfif(), exif(6)] }));
    assert.deepEqual(a, { width: 4000, height: 3000, format: 'jpeg', orientation: 6 });
    assert.deepEqual(orientedSize(a), { width: 3000, height: 4000 });
    const b = imageSize(jpeg(4000, 3000, { before: [exif(3, 'MM')] }));
    assert.equal(b.orientation, 3);
    assert.deepEqual(orientedSize(b), { width: 4000, height: 3000 });
    for (const o of [5, 6, 7, 8]) assert.equal(orientedSize(imageSize(jpeg(40, 30, { before: [exif(o)] }))).width, 30);
    for (const o of [1, 2, 3, 4]) assert.equal(orientedSize(imageSize(jpeg(40, 30, { before: [exif(o)] }))).width, 40);
    assert.equal(orientedSize(null), null);
  });
  it('JPEG with a nonsense orientation value just has none', () => {
    assert.equal(imageSize(jpeg(40, 30, { before: [exif(9)] })).orientation, undefined);
    assert.equal(imageSize(jpeg(40, 30, { before: [exif(0)] })).orientation, undefined);
  });
  it('WebP lossy (VP8), lossless (VP8L) and extended (VP8X)', () => {
    assert.deepEqual(imageSize(webpLossy(800, 600)), { width: 800, height: 600, format: 'webp' });
    assert.deepEqual(imageSize(webpLossless(1024, 768)), { width: 1024, height: 768, format: 'webp' });
    assert.deepEqual(imageSize(webpLossless(16384, 1)), { width: 16384, height: 1, format: 'webp' });
    assert.deepEqual(imageSize(webpExt(5000, 2500)), { width: 5000, height: 2500, format: 'webp' });
  });
  it('WebP lossy ignores the scale bits in the top two bits of each dimension', () => {
    const b = webpLossy(800, 600);
    b[27] |= 0xc0;
    b[29] |= 0x40;
    assert.deepEqual(imageSize(b), { width: 800, height: 600, format: 'webp' });
  });
  it('AVIF reads ispe', () => {
    assert.deepEqual(imageSize(avif(ispe(1920, 1080))), { width: 1920, height: 1080, format: 'avif' });
  });
  it('AVIF with several ispe properties (thumbnail, tiles, alpha) → the largest, the canvas', () => {
    assert.deepEqual(imageSize(avif(ispe(160, 90), ispe(512, 512), ispe(4096, 2304), ispe(1024, 1024))), { width: 4096, height: 2304, format: 'avif' });
  });
  it('AVIF: the avis brand and a compatible-brand-only file are accepted; an HEIC brand is not', () => {
    const seq = bytes(box('ftyp', 'avis', be32(0), 'avis', 'msf1'), box('meta', [0, 0, 0, 0], box('iprp', box('ipco', ispe(30, 20)))));
    assert.deepEqual(imageSize(seq), { width: 30, height: 20, format: 'avif' });
    const compat = bytes(box('ftyp', 'mif1', be32(0), 'mif1', 'avif'), box('meta', [0, 0, 0, 0], box('iprp', box('ipco', ispe(31, 21)))));
    assert.deepEqual(imageSize(compat), { width: 31, height: 21, format: 'avif' });
    const heic = bytes(box('ftyp', 'heic', be32(0), 'mif1'), box('meta', [0, 0, 0, 0], box('iprp', box('ipco', ispe(31, 21)))));
    assert.equal(imageSize(heic), null);
  });
  it('AVIF whose meta box is cut off after the ispe is still read; cut inside the ispe is null', () => {
    const full = avif(ispe(640, 360));
    const at = full.length - 12 - 8 - 12;                          // …end of the ispe sits before the mdat (12 bytes)
    assert.ok(imageSize(full.slice(0, at + 20)));                  // generous cut: the ispe is whole
    for (let n = 0; n < 24; n += 1) assert.equal(imageSize(full.slice(0, 40 + n)), null);
  });
  it('SVG: width/height, px units, viewBox, and the fallbacks', () => {
    assert.deepEqual(imageSize(text('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>')), { width: 120, height: 80, format: 'svg' });
    assert.deepEqual(imageSize(text('<?xml version="1.0"?>\n<!-- c -->\n<svg width="64px" height=\'32px\' viewBox="0 0 10 10">')), { width: 64, height: 32, format: 'svg' });
    assert.deepEqual(imageSize(text('<svg viewBox="0 0 24 24"><path/></svg>')), { width: 24, height: 24, format: 'svg' });
    assert.deepEqual(imageSize(text('<svg viewBox="0,0,48.4,24.2">')), { width: 48, height: 24, format: 'svg' });
    // percentages and units we do not convert fall back to the viewBox
    assert.deepEqual(imageSize(text('<svg width="100%" height="100%" viewBox="0 0 300 150">')), { width: 300, height: 150, format: 'svg' });
    assert.deepEqual(imageSize(text('<svg width="2in" height="1in" viewBox="0 0 192 96">')), { width: 192, height: 96, format: 'svg' });
    // a data-width attribute is not width
    assert.deepEqual(imageSize(text('<svg data-width="9" data-height="9" viewBox="0 0 5 6">')), { width: 5, height: 6, format: 'svg' });
  });
  it('SVG without a usable size → null', () => {
    assert.equal(imageSize(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(imageSize(text('<svg width="100%" height="auto">')), null);
    assert.equal(imageSize(text('<svg viewBox="0 0 0 0">')), null);
    assert.equal(imageSize(text('<svg viewBox="a b c d">')), null);
    assert.equal(imageSize(text('<html><body>no picture</body></html>')), null);
  });
});

describe('imageSize — truncated and garbage input returns null and never throws', () => {
  const files = {
    png: png(640, 480), gif: gif(32, 32), bmp: bmpInfo(10, 10), bmpCore: bmpCore(10, 10),
    jpeg: jpeg(640, 480, { before: [jfif(), exif(6)] }), jpegProg: jpeg(64, 48, { marker: 0xc2 }),
    webp: webpLossy(64, 64), webpL: webpLossless(64, 64), webpX: webpExt(64, 64),
    avif: avif(ispe(64, 64)), svg: text('<svg width="9" height="9">'),
  };

  it('every prefix of every fixture is handled without throwing', () => {
    for (const [name, f] of Object.entries(files)) {
      for (let n = 0; n <= f.length; n += 1) {
        const r = imageSize(f.slice(0, n));
        assert.ok(r === null || (Number.isInteger(r.width) && Number.isInteger(r.height) && r.width > 0 && r.height > 0), `${name} @${n}`);
      }
    }
  });

  it('cut inside the size field → null', () => {
    assert.equal(imageSize(png(5, 5).slice(0, 23)), null);
    assert.equal(imageSize(png(5, 5).slice(0, 19)), null);
    assert.equal(imageSize(gif(5, 5).slice(0, 9)), null);
    assert.equal(imageSize(bmpInfo(5, 5).slice(0, 25)), null);
    assert.equal(imageSize(jpeg(5, 5).slice(0, 10)), null);                     // inside the SOF
    assert.equal(imageSize(jpeg(5, 5, { before: [jfif()] }).slice(0, 27)), null);
    assert.equal(imageSize(webpLossy(5, 5).slice(0, 29)), null);
    assert.equal(imageSize(webpLossless(5, 5).slice(0, 24)), null);
    assert.equal(imageSize(webpExt(5, 5).slice(0, 29)), null);
  });

  it('JPEG: EOI or SOS before any frame, a bad segment length, a missing marker prefix → null', () => {
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0])), null);
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6])), null);
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0, 0, 0])), null);            // length < 2
    assert.equal(imageSize(bytes([0xff, 0xd8, 0x00, 0xc0, 0, 11, 8, 0, 5, 0, 5, 1, 0, 0])), null);
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0])), null);            // length runs off the end
  });

  it('wrong magic, wrong chunk, zero and absurd sizes → null', () => {
    const p = png(5, 5);
    p[12] = 0x58;                                                                // IHDR → XHDR
    assert.equal(imageSize(p), null);
    assert.equal(imageSize(png(0, 5)), null);
    assert.equal(imageSize(png(5, 0)), null);
    assert.equal(imageSize(png(2_000_000, 5)), null);
    assert.equal(imageSize(gif(0, 5)), null);
    assert.equal(imageSize(bytes('RIFF', le32(30), 'WAVE', 'fmt ', new Uint8Array(30))), null);
    const bad = webpLossy(5, 5);
    bad[23] = 0;                                                                 // lossy start code destroyed
    assert.equal(imageSize(bad), null);
    const l = webpLossless(5, 5);
    l[20] = 0;                                                                   // lossless signature destroyed
    assert.equal(imageSize(l), null);
  });

  it('wrong input types and empty input → null', () => {
    for (const v of [undefined, null, 0, 'GIF89a', {}, [], new Uint8Array(0), new Uint8Array(3), new ArrayBuffer(0)]) {
      assert.equal(imageSize(v), null, String(v));
    }
  });

  it('accepts a Buffer and an ArrayBuffer', () => {
    const f = png(11, 22);
    assert.deepEqual(imageSize(Buffer.from(f)), { width: 11, height: 22, format: 'png' });
    assert.deepEqual(imageSize(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength)), { width: 11, height: 22, format: 'png' });
  });

  it('random bytes behind each real magic number never throw (deterministic fuzz)', () => {
    let s = 0x2545f491;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) & 255; };
    const heads = [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0xff, 0xd8, 0xff], [0xff, 0xd8, 0xff, 0xe1],
      [...'GIF89a'].map((c) => c.charCodeAt(0)), [0x42, 0x4d], [...'RIFF'].map((c) => c.charCodeAt(0)),
      [0, 0, 0, 24, ...[...'ftypavif'].map((c) => c.charCodeAt(0))], [...'<svg '].map((c) => c.charCodeAt(0)),
    ];
    for (let round = 0; round < 400; round += 1) {
      const head = heads[round % heads.length];
      const body = Uint8Array.from({ length: (round * 7) % 300 }, rnd);
      const r = imageSize(bytes(head, body));
      assert.ok(r === null || (r.width >= 1 && r.height >= 1), `round ${round}`);
    }
  });

  it('a box that claims to be enormous or tiny cannot loop or hang the AVIF walker', () => {
    const loop = bytes(box('ftyp', 'avif', be32(0), 'avif'), [0, 0, 0, 4, 0x6d, 0x65, 0x74, 0x61, 0, 0, 0, 0]);   // size 4 < header
    assert.equal(imageSize(loop), null);
    const huge = bytes(box('ftyp', 'avif', be32(0), 'avif'), [0, 0, 0, 1], 'meta', be32(1), be32(0));             // 64-bit size above 4 GB
    assert.equal(imageSize(huge), null);
    const zero = bytes(box('ftyp', 'avif', be32(0), 'avif'), be32(0), 'meta', [0, 0, 0, 0], box('iprp', box('ipco', ispe(9, 8))));  // size 0 = to the end
    assert.deepEqual(imageSize(zero), { width: 9, height: 8, format: 'avif' });
  });
});

describe('HEADER_BYTES', () => {
  it('is a sane read size', () => {
    assert.ok(Number.isInteger(HEADER_BYTES) && HEADER_BYTES >= 65536 && HEADER_BYTES <= 1048576);
  });
});
