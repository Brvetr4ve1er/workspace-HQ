// Cosmos space — the colour quantizer (dashboard/cosmos/colorextract.mjs). Synthetic pixels only.
//   node --test dashboard/cosmos/colorextract.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractColors } from './colorextract.mjs';

/** w x h RGBA image from a per-pixel function (x, y) -> [r,g,b,a]. */
function image(w, h, fn) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) data.set(fn(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}
const solid = (r, g, b, a = 255, w = 32, h = 32) => image(w, h, () => [r, g, b, a]);

describe('extractColors', () => {
  it('flat red, green, blue, white and black give their own hex', () => {
    const cases = [[255, 0, 0, '#ff0000'], [0, 255, 0, '#00ff00'], [0, 0, 255, '#0000ff'], [255, 255, 255, '#ffffff'], [0, 0, 0, '#000000']];
    for (const [r, g, b, hex] of cases) {
      const out = extractColors(solid(r, g, b));
      assert.equal(out.color.hex, hex);
      assert.deepEqual([out.color.r, out.color.g, out.color.b], [r, g, b]);
      assert.deepEqual(out.palette, [hex]);
    }
  });

  it('reports hue, saturation and lightness', () => {
    const red = extractColors(solid(255, 0, 0)).color;
    assert.equal(red.h, 0);
    assert.equal(red.s, 1);
    assert.equal(red.l, 0.5);
    const green = extractColors(solid(0, 255, 0)).color;
    assert.equal(green.h, 120);
    const blue = extractColors(solid(0, 0, 255)).color;
    assert.equal(blue.h, 240);
    const gray = extractColors(solid(128, 128, 128)).color;
    assert.equal(gray.s, 0);
    assert.ok(Math.abs(gray.l - 128 / 255) < 1e-9);
  });

  it('a two-colour image gives a 2-entry palette in dominance order', () => {
    // 70% blue, 30% yellow
    const img = image(10, 10, (x) => (x < 7 ? [0, 0, 255, 255] : [255, 255, 0, 255]));
    const out = extractColors(img);
    assert.deepEqual(out.palette, ['#0000ff', '#ffff00']);
    const flipped = image(10, 10, (x) => (x < 3 ? [0, 0, 255, 255] : [255, 255, 0, 255]));
    assert.deepEqual(extractColors(flipped).palette, ['#ffff00', '#0000ff']);
  });

  it('the signature favours a vivid accent over a slightly bigger grey wall', () => {
    const img = image(10, 10, (x) => (x < 5 ? [200, 200, 200, 255] : [230, 20, 20, 255]));
    // grey count 50 * 0.45 = 22.5 vs red count 50 * (0.45 + 1) = 72.5
    const out = extractColors(img);
    assert.equal(out.color.hex, '#e61414');
  });

  it('palette skips colours that are too close to one already taken', () => {
    const img = image(10, 10, (x) => (x < 5 ? [100, 100, 100, 255] : [110, 100, 100, 255]));
    assert.equal(extractColors(img).palette.length, 1);
  });

  it('palette holds at most 5 colours', () => {
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [0, 0, 0]];
    const img = image(7, 1, (x) => [...colors[x], 255]);
    const out = extractColors(img);
    assert.equal(out.palette.length, 5);
    assert.ok(out.palette.every((h) => /^#[0-9a-f]{6}$/.test(h)));
  });

  it('transparent pixels are ignored', () => {
    const img = image(10, 10, (x) => (x < 8 ? [0, 255, 0, 0] : [255, 0, 0, 255]));
    const out = extractColors(img);
    assert.equal(out.color.hex, '#ff0000');
    assert.deepEqual(out.palette, ['#ff0000']);
    assert.equal(extractColors(solid(255, 0, 0, 124)), null);        // alpha < 125 counts as transparent
    assert.notEqual(extractColors(solid(255, 0, 0, 125)), null);
  });

  it('empty, malformed or fully transparent input is null', () => {
    assert.equal(extractColors(null), null);
    assert.equal(extractColors(undefined), null);
    assert.equal(extractColors({}), null);
    assert.equal(extractColors({ width: 0, height: 0, data: new Uint8Array(0) }), null);
    assert.equal(extractColors({ width: 2, height: 2, data: [1, 2, 3, 4] }), null);   // not a typed array
    assert.equal(extractColors({ width: 2, height: 2, data: new Uint8Array(3) }), null);
    assert.equal(extractColors(solid(10, 20, 30, 0)), null);
  });

  it('a BGRA-ordered buffer gives the SWAPPED colour: the caller must swap (documented contract)', () => {
    // a pure red pixel as Windows stores it (B,G,R,A) ...
    const bgraRed = { width: 4, height: 4, data: new Uint8Array(Array.from({ length: 16 }, () => [0, 0, 255, 255]).flat()) };
    // ... read as RGBA it is BLUE
    assert.equal(extractColors(bgraRed).color.hex, '#0000ff');
    // after the caller swaps channels, it is red
    const swapped = { ...bgraRed, data: bgraRed.data.map((v, i, a) => (i % 4 === 0 ? a[i + 2] : i % 4 === 2 ? a[i - 2] : v)) };
    assert.equal(extractColors(swapped).color.hex, '#ff0000');
  });

  it('accepts a clamped array and a big image (strided sampling) and stays deterministic', () => {
    const big = image(400, 300, (x) => (x < 200 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
    const a = extractColors({ ...big, data: new Uint8ClampedArray(big.data) });
    const b = extractColors(big);
    assert.deepEqual(a, b);
    assert.equal(a.palette.length, 2);
  });
});
