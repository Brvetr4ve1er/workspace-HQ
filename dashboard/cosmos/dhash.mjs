/* Cosmos space — the perceptual hash (dHash) and its comparison.

   PORTED (behaviour, not code) from the source app's dhash.ts. The thumbnailer hands over a 9 x 8 grayscale
   grid (72 bytes, row-major: index = y * 9 + x). Each of the 8 rows gives 8 comparisons "pixel x is brighter
   than pixel x+1" = 64 bits, packed MSB-first in row-major order into a 16-character lowercase hex string.
   Two pictures are near-duplicates when the Hamming distance of their hashes is small: a re-save or resize
   lands in the low single digits, unrelated pictures sit near 32 bits apart.

   Hash strings are the stored form (library.json `perceptualHash`), so the bit order here is load-bearing:
   changing it would silently turn every old hash into a different fingerprint. dhash.test.mjs pins one.

   Pure: no IO, no clock. Never throws on bad input (returns null). */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
/** 10 of 64 bits, the source app's cutoff. */
export const NEAR_DUPLICATE_THRESHOLD = 10;

const HEX16 = /^[0-9a-f]{16}$/i;
const POP4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * @param {ArrayLike<number>} gray9x8  72 brightness values, row-major (scale does not matter)
 * @returns {string|null} 16 lowercase hex chars, or null when the input is not 72 numbers
 */
export function dhashFromGray(gray9x8) {
  if (!gray9x8 || typeof gray9x8.length !== 'number' || gray9x8.length !== DHASH_WIDTH * DHASH_HEIGHT) return null;
  let out = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
      const a = gray9x8[y * DHASH_WIDTH + x];
      const b = gray9x8[y * DHASH_WIDTH + x + 1];
      if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) return null;
      nibble = (nibble << 1) | (a > b ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        out += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return out;
}

/** Number of differing bits between two 16-hex-char hashes, or null when either is malformed. */
export function hammingDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX16.test(a) || !HEX16.test(b)) return null;
  let d = 0;
  for (let i = 0; i < 16; i += 1) d += POP4[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** True when the distance is known and within `threshold` (inclusive). */
export function isNearDuplicate(a, b, threshold = NEAR_DUPLICATE_THRESHOLD) {
  const d = hammingDistance(a, b);
  return d !== null && d <= threshold;
}
