// Cosmos space — duplicate clusters and junk (dashboard/cosmos/dupes.mjs). Synthetic works only.
//   node --test dashboard/cosmos/dupes.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterDuplicates, clusterDuplicatesAsync, clusterKey, detectLowQuality, buildDupes, NEAR_CHUNK_ROWS,
} from './dupes.mjs';

const Z = '0000000000000000';
const bits = (n) => (2n ** BigInt(n) - 1n).toString(16).padStart(16, '0');     // n low bits set
const work = (id, o = {}) => ({
  id, width: 1000, height: 800, createdAt: '2026-01-01T00:00:00.000Z', contentHash: null, perceptualHash: null,
  color: { hex: '#336699', r: 51, g: 102, b: 153, h: 210, s: 0.5, l: 0.4 }, palette: ['#336699', '#ffffff'], ...o,
});

describe('clusterDuplicates', () => {
  it('an exact pair is one cluster of kind exact', () => {
    const c = clusterDuplicates([work('a', { contentHash: 'h1' }), work('b', { contentHash: 'h1' }), work('c', { contentHash: 'h2' })]);
    assert.equal(c.length, 1);
    assert.equal(c[0].kind, 'exact');
    assert.deepEqual(c[0].members.map((m) => m.id), ['a', 'b']);
    assert.deepEqual(c[0].memberKind, { a: 'exact', b: 'exact' });
    assert.equal(c[0].reason, 'Identical file contents');
  });

  it('a near pair within 10 bits clusters, 11 bits does not', () => {
    const near = clusterDuplicates([work('a', { perceptualHash: Z }), work('b', { perceptualHash: bits(10) })]);
    assert.equal(near.length, 1);
    assert.equal(near[0].kind, 'near');
    assert.deepEqual(near[0].memberKind, { a: 'near', b: 'near' });
    assert.match(near[0].reason, /Visually similar \(perceptual hash within 10 bits\)/);
    assert.deepEqual(clusterDuplicates([work('a', { perceptualHash: Z }), work('b', { perceptualHash: bits(11) })]), []);
    assert.equal(clusterDuplicates([work('a', { perceptualHash: Z }), work('b', { perceptualHash: bits(11) })], { threshold: 11 }).length, 1);
  });

  it('a three-member chain (A~B exact, B~C near) is one cluster with member kinds exact, exact, near', () => {
    const a = work('a', { contentHash: 'h1', perceptualHash: null });
    const b = work('b', { contentHash: 'h1', perceptualHash: Z });
    const c = work('c', { contentHash: 'h9', perceptualHash: bits(6) });
    const out = clusterDuplicates([a, b, c]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'exact');
    assert.deepEqual(out[0].members.map((m) => m.id), ['a', 'b', 'c']);
    assert.deepEqual(['a', 'b', 'c'].map((id) => out[0].memberKind[id]), ['exact', 'exact', 'near']);
    assert.equal(out[0].reason, 'Contains an exact match plus visually similar files');
  });

  it('chains merge through near edges that are not directly close (A~B, B~C, A far from C)', () => {
    const a = work('a', { perceptualHash: Z });
    const b = work('b', { perceptualHash: bits(8) });
    const c = work('c', { perceptualHash: '000000000000ffff' });     // 16 bits from a, 8 from b
    const out = clusterDuplicates([a, b, c]);
    assert.equal(out.length, 1);
    assert.equal(out[0].members.length, 3);
  });

  it('never makes a cluster of one, and leaves works without hashes out silently', () => {
    const out = clusterDuplicates([work('a'), work('b'), work('c', { contentHash: 'h1' }), work('d', { perceptualHash: 'not-a-hash' }), null]);
    assert.deepEqual(out, []);
    assert.deepEqual(clusterDuplicates([]), []);
    assert.deepEqual(clusterDuplicates(undefined), []);
  });

  it('two separate clusters keep input order', () => {
    const out = clusterDuplicates([
      work('a', { contentHash: 'x' }), work('p', { contentHash: 'y' }), work('b', { contentHash: 'x' }), work('q', { contentHash: 'y' }),
    ]);
    assert.deepEqual(out.map((c) => c.members.map((m) => m.id)), [['a', 'b'], ['p', 'q']]);
  });

  it('keeper: largest area, then newest, then lowest id; an approx work loses to a measured one', () => {
    const k = (ws) => clusterDuplicates(ws)[0].suggestedKeeperId;
    const h = { contentHash: 'same' };
    assert.equal(k([work('a', { ...h, width: 100, height: 100 }), work('b', { ...h, width: 200, height: 100 })]), 'b');
    assert.equal(k([work('a', { ...h, createdAt: '2026-01-01T00:00:00.000Z' }), work('b', { ...h, createdAt: '2026-06-01T00:00:00.000Z' })]), 'b');
    assert.equal(k([work('z', h), work('m', h), work('q', h)]), 'm');
    // an approx work with a huge guessed size still loses to a small measured one
    assert.equal(k([work('big', { ...h, width: 9000, height: 9000, approx: true }), work('small', { ...h, width: 50, height: 50 })]), 'small');
    // two approx works: both area 0, so the newer wins
    assert.equal(k([
      work('a', { ...h, approx: true, createdAt: '2026-01-01T00:00:00.000Z' }), work('b', { ...h, approx: true, createdAt: '2026-02-01T00:00:00.000Z' }),
    ]), 'b');
    // a missing createdAt loses to a dated one
    assert.equal(k([work('a', { ...h, createdAt: undefined }), work('b', h)]), 'b');
  });

  it('clusterKey is the sorted ids joined by one space, independent of member order', () => {
    const [c1] = clusterDuplicates([work('b', { contentHash: 'x' }), work('a', { contentHash: 'x' }), work('c', { contentHash: 'x' })]);
    const [c2] = clusterDuplicates([work('c', { contentHash: 'x' }), work('a', { contentHash: 'x' }), work('b', { contentHash: 'x' })]);
    assert.equal(clusterKey(c1), 'a b c');
    assert.equal(clusterKey(c1), clusterKey(c2));
  });
});

describe('detectLowQuality', () => {
  it('flags tiny (short edge < 64 or area < 4096) for measured works with a colour', () => {
    const out = detectLowQuality([
      work('thin', { width: 63, height: 2000 }),
      work('edge', { width: 64, height: 2000 }),
      work('area', { width: 64, height: 63 }),
      work('ok', { width: 200, height: 200 }),
      work('exactly', { width: 64, height: 64 }),
    ]);
    assert.deepEqual(out, [{ id: 'thin', reason: 'tiny' }, { id: 'area', reason: 'tiny' }]);
  });

  it('flags blank (saturation < 0.03 and a palette of at most one)', () => {
    const grey = { hex: '#808080', r: 128, g: 128, b: 128, h: 0, s: 0, l: 0.5 };
    const out = detectLowQuality([
      work('flat', { color: grey, palette: ['#808080'] }),
      work('empty-palette', { color: grey, palette: [] }),
      work('greyphoto', { color: grey, palette: ['#808080', '#202020', '#e0e0e0'] }),
      work('vivid', { palette: ['#336699'] }),
      work('almost', { color: { ...grey, s: 0.03 }, palette: ['#808080'] }),
    ]);
    assert.deepEqual(out, [{ id: 'flat', reason: 'blank' }, { id: 'empty-palette', reason: 'blank' }]);
  });

  it('an approx work is never flagged tiny (its size is a guess), and a work without a colour is never flagged', () => {
    const out = detectLowQuality([
      work('guess', { width: 1, height: 1, approx: true }),
      work('nocolor', { width: 10, height: 10, color: null, palette: [] }),
    ]);
    assert.deepEqual(out, []);
  });

  it('one entry per work: tiny wins over blank', () => {
    const grey = { hex: '#808080', r: 128, g: 128, b: 128, h: 0, s: 0, l: 0.5 };
    assert.deepEqual(detectLowQuality([work('both', { width: 10, height: 10, color: grey, palette: ['#808080'] })]), [{ id: 'both', reason: 'tiny' }]);
  });
});

describe('buildDupes', () => {
  it('splits clusters into exact / near and carries junk', () => {
    const clusters = clusterDuplicates([
      work('a', { contentHash: 'x' }), work('b', { contentHash: 'x' }), work('c', { perceptualHash: Z }), work('d', { perceptualHash: bits(3) }),
    ]);
    const d = buildDupes(clusters, [{ id: 'z', reason: 'tiny' }]);
    assert.equal(d.exact.length, 1);
    assert.deepEqual(d.exact[0], { key: 'a b', ids: ['a', 'b'], kinds: ['exact', 'exact'], keeperId: 'a', reason: 'Identical file contents' });
    assert.equal(d.near.length, 1);
    assert.equal(d.near[0].key, 'c d');
    assert.deepEqual(d.junk, [{ id: 'z', reason: 'tiny' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
    assert.deepEqual(buildDupes([], []), { exact: [], near: [], junk: [] });
  });
});

/** deterministic 64-bit-ish hashes */
function synthetic(n) {
  let s = 123456789;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const hex8 = () => next().toString(16).padStart(8, '0');
  const works = [];
  for (let i = 0; i < n; i += 1) works.push(work(`w${i}`, { perceptualHash: hex8() + hex8(), contentHash: i % 997 === 0 && i > 0 ? `dup${i % 5}` : null }));
  // a few planted near pairs
  works.push(work('planted-1', { perceptualHash: 'aaaaaaaaaaaaaaaa' }), work('planted-2', { perceptualHash: 'aaaaaaaaaaaaaaab' }));
  return works;
}

describe('clusterDuplicatesAsync', () => {
  it('equals the sync result on 5,000 works and yields at least 10 times', async () => {
    assert.equal(NEAR_CHUNK_ROWS, 400);
    const works = synthetic(5000);
    let yields = 0;
    const seen = [];
    const a = await clusterDuplicatesAsync(works, { yieldNow: async () => { yields += 1; }, onProgress: (p) => seen.push(p) });
    const s = clusterDuplicates(works);
    assert.ok(yields >= 10, `yields: ${yields}`);
    assert.deepEqual(a, s);
    assert.ok(a.some((c) => c.members.some((m) => m.id === 'planted-1')));
    assert.ok(seen.length >= 10 && seen.every((p) => p.done <= p.total));
    assert.equal(seen.at(-1).done, seen.at(-1).total);
  });

  it('stops on cancel and resolves to null', async () => {
    const works = synthetic(1500);
    let polls = 0;
    const out = await clusterDuplicatesAsync(works, { isCancelled: () => { polls += 1; return polls > 2; } });
    assert.equal(out, null);
    assert.ok(polls <= 4);
  });

  it('small inputs: no yields, empty and single-work inputs give []', async () => {
    let yields = 0;
    const y = async () => { yields += 1; };
    assert.deepEqual(await clusterDuplicatesAsync([], { yieldNow: y }), []);
    assert.deepEqual(await clusterDuplicatesAsync([work('a', { perceptualHash: Z })], { yieldNow: y }), []);
    const two = await clusterDuplicatesAsync([work('a', { perceptualHash: Z }), work('b', { perceptualHash: Z })], { yieldNow: y });
    assert.equal(two.length, 1);
    assert.equal(yields, 0);
  });
});
