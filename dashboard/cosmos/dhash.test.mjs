// Cosmos space — the perceptual hash (dashboard/cosmos/dhash.mjs). Synthetic grids only.
//   node --test dashboard/cosmos/dhash.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DHASH_WIDTH, DHASH_HEIGHT, NEAR_DUPLICATE_THRESHOLD, dhashFromGray, hammingDistance, isNearDuplicate,
} from './dhash.mjs';

const grid = (fn) => Uint8Array.from({ length: 72 }, (_, i) => fn(i % 9, Math.floor(i / 9)));

/** Independent reference: the source app's BigInt packing, bit by bit, MSB first. */
function reference(g) {
  let v = 0n;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) v = (v << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  return v.toString(16).padStart(16, '0');
}

describe('dhashFromGray', () => {
  it('uses the 9 x 8 grid constants', () => {
    assert.equal(DHASH_WIDTH, 9);
    assert.equal(DHASH_HEIGHT, 8);
    assert.equal(NEAR_DUPLICATE_THRESHOLD, 10);
  });

  it('a rising ramp is all zero bits, a falling ramp all one bits', () => {
    assert.equal(dhashFromGray(grid((x) => x * 10)), '0000000000000000');
    assert.equal(dhashFromGray(grid((x) => 100 - x * 10)), 'ffffffffffffffff');
  });

  it('alternating brightness gives the fixed pattern 1010... in every row', () => {
    assert.equal(dhashFromGray(grid((x) => (x % 2 === 0 ? 200 : 10))), 'aaaaaaaaaaaaaaaa');
  });

  it('a fixed gradient gives a fixed 16-char lowercase hex (pinned) equal to the reference packing', () => {
    const g = grid((x, y) => (x * 7 + y * 13) % 17);
    const h = dhashFromGray(g);
    assert.match(h, /^[0-9a-f]{16}$/);
    assert.equal(h, reference(g));
    assert.equal(h, '29a5544a29a59452');   // pinned: stored hashes depend on this bit order
  });

  it('is MSB-first, row-major: only the first comparison set makes the top bit', () => {
    const g = grid(() => 5);
    g[0] = 9;              // pixel (0,0) brighter than (1,0): the very first bit
    assert.equal(dhashFromGray(g), '8000000000000000');
    const g2 = grid(() => 5);
    g2[7 * 9 + 7] = 9;     // pixel (7,7) brighter than (8,7): the very last bit
    assert.equal(dhashFromGray(g2), '0000000000000001');
  });

  it('ignores the absolute scale: only the order of neighbours matters', () => {
    const g = grid((x, y) => (x * 7 + y * 13) % 17);
    assert.equal(dhashFromGray(g.map((v) => v * 3 + 20)), dhashFromGray(g));
    assert.equal(dhashFromGray(Array.from(g)), dhashFromGray(g));
  });

  it('returns null (never throws) for anything that is not 72 numbers', () => {
    assert.equal(dhashFromGray(null), null);
    assert.equal(dhashFromGray(undefined), null);
    assert.equal(dhashFromGray(new Uint8Array(71)), null);
    assert.equal(dhashFromGray(new Uint8Array(73)), null);
    assert.equal(dhashFromGray('x'.repeat(72)), null);
    assert.equal(dhashFromGray(Array.from({ length: 72 }, (_, i) => (i === 3 ? NaN : 1))), null);
  });
});

describe('hammingDistance and isNearDuplicate', () => {
  it('identical is 0, one flipped bit is 1, everything flipped is 64', () => {
    assert.equal(hammingDistance('2b6c9e5a1f7d4830', '2b6c9e5a1f7d4830'), 0);
    assert.equal(hammingDistance('2b6c9e5a1f7d4830', '2b6c9e5a1f7d4831'), 1);
    assert.equal(hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);
    assert.equal(hammingDistance('00000000000000ff', '0000000000000000'), 8);
  });

  it('is case-insensitive and symmetric', () => {
    assert.equal(hammingDistance('ABCDEF0123456789', 'abcdef0123456789'), 0);
    assert.equal(hammingDistance('0000000000000001', '8000000000000000'), 2);
    assert.equal(hammingDistance('8000000000000000', '0000000000000001'), 2);
  });

  it('threshold edge: 10 bits is a near duplicate, 11 is not', () => {
    const ten = '00000000000003ff';       // 10 bits set
    const eleven = '00000000000007ff';    // 11 bits set
    assert.equal(hammingDistance('0000000000000000', ten), 10);
    assert.equal(hammingDistance('0000000000000000', eleven), 11);
    assert.equal(isNearDuplicate('0000000000000000', ten), true);
    assert.equal(isNearDuplicate('0000000000000000', eleven), false);
    assert.equal(isNearDuplicate('0000000000000000', ten, 9), false);
    assert.equal(isNearDuplicate('0000000000000000', eleven, 11), true);
  });

  it('malformed hex returns null and is never near anything', () => {
    for (const bad of [null, undefined, 5, '', 'abc', 'zzzzzzzzzzzzzzzz', '0000000000000000f', '000000000000000']) {
      assert.equal(hammingDistance(bad, '0000000000000000'), null);
      assert.equal(hammingDistance('0000000000000000', bad), null);
      assert.equal(isNearDuplicate(bad, '0000000000000000'), false);
    }
  });
});

