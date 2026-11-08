/* Cosmos space — duplicate clusters and low-quality (junk) proposals.

   PORTED (behaviour, not code) from the source app's duplicateClusters.ts, adjusted to this library's data.
   Everything here only PROPOSES; nothing deletes or hides anything.

   clusterDuplicates(works, { threshold })
     union-find over two edge kinds: EXACT (same contentHash) and NEAR (perceptualHash Hamming distance
     <= threshold, default 10). Chains merge (A=B exact, B~C near is ONE cluster). Works with neither hash are
     left out silently (they cannot take part; that is not an error). Only groups of >= 2 become clusters.
     Cluster = { kind, members (in input order), memberKind {id: 'exact'|'near'}, suggestedKeeperId, reason }.
       kind 'exact' when any member shares a contentHash with another member, else 'near';
       memberKind[id] is 'exact' only for a member sharing its contentHash with another member of the SAME
       cluster, so a chained-in near member is never mislabelled exact.
     suggestedKeeperId: largest pixel area, then newest createdAt, then lowest id. A work flagged `approx`
     (its size is a guess from a thumbnail) counts as area 0, so a measured work always beats it.
   clusterKey(c): the member ids sorted, joined by one space; stable across runs and input orders. This is
     what a dismissal remembers.
   clusterDuplicatesAsync(works, { threshold, yieldNow, isCancelled, onProgress, chunkRows })
     same result as the sync call; the O(n^2) near pass runs in chunks of 400 rows with an `await yieldNow()`
     between chunks (5,000 works => 12 yields), isCancelled() is checked per chunk. Resolves to the cluster
     array, or to null when cancelled. onProgress({ done, total }) counts rows.
   detectLowQuality(works) -> [{ id, reason: 'tiny'|'blank' }], at most one entry per work (tiny wins):
     tiny  min(width,height) < 64 or area < 4096, only for works with a MEASURED size (no `approx`) and a color;
     blank color saturation < 0.03 and palette length <= 1, only for works with a color.
   buildDupes(clusters, junk) -> the library.json `dupes` value:
     { exact: [{ key, ids, kinds, keeperId, reason }], near: [...same], junk: [{ id, reason }] }
     (`kinds` is an additive array parallel to `ids`: each member's memberKind.)

   Pure: no IO, no clock. Never throws on a work with missing fields. */

import { NEAR_DUPLICATE_THRESHOLD } from './dhash.mjs';

export const NEAR_CHUNK_ROWS = 400;
export const TINY_MIN_EDGE = 64;
export const TINY_MIN_AREA = 4096;
export const BLANK_MAX_SATURATION = 0.03;

const HEX16 = /^[0-9a-f]{16}$/i;

export function clusterKey(cluster) {
  return cluster.members.map((w) => w.id).sort().join(' ');
}

function pop32(x0) {
  const x = x0 >>> 0;
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return Math.imul(v, 0x01010101) >>> 24;
}

function areaOf(w) {
  return w.approx ? 0 : (Number(w.width) || 0) * (Number(w.height) || 0);
}

function timeOf(w) {
  const t = w.createdAt ? Date.parse(w.createdAt) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** true when `a` should be kept over `b` */
function betterKeeper(a, b) {
  const aa = areaOf(a);
  const ba = areaOf(b);
  if (aa !== ba) return aa > ba;
  const at = timeOf(a);
  const bt = timeOf(b);
  if (at !== bt) return at > bt;
  return String(a.id) < String(b.id);
}

function suggestKeeper(members) {
  let best = members[0];
  for (let i = 1; i < members.length; i += 1) if (betterKeeper(members[i], best)) best = members[i];
  return best.id;
}

function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

function prepare(works, threshold) {
  const candidates = (Array.isArray(works) ? works : []).filter(
    (w) => w && w.id != null && (w.contentHash || (typeof w.perceptualHash === 'string' && HEX16.test(w.perceptualHash))),
  );
  const uf = makeUnionFind(candidates.length);
  const byContent = new Map();
  candidates.forEach((w, i) => {
    if (!w.contentHash) return;
    const arr = byContent.get(w.contentHash);
    if (arr) arr.push(i);
    else byContent.set(w.contentHash, [i]);
  });
  for (const idxs of byContent.values()) for (let k = 1; k < idxs.length; k += 1) uf.union(idxs[0], idxs[k]);

  const nearIdx = [];
  const hi = [];
  const lo = [];
  candidates.forEach((w, i) => {
    if (typeof w.perceptualHash !== 'string' || !HEX16.test(w.perceptualHash)) return;
    nearIdx.push(i);
    hi.push(parseInt(w.perceptualHash.slice(0, 8), 16) | 0);
    lo.push(parseInt(w.perceptualHash.slice(8), 16) | 0);
  });
  return { candidates, uf, nearIdx, hi, lo, threshold };
}

function nearRows(st, from, to) {
  const { uf, nearIdx, hi, lo, threshold } = st;
  const n = nearIdx.length;
  for (let a = from; a < to; a += 1) {
    const ha = hi[a];
    const la = lo[a];
    for (let b = a + 1; b < n; b += 1) {
      if (pop32(ha ^ hi[b]) + pop32(la ^ lo[b]) <= threshold) uf.union(nearIdx[a], nearIdx[b]);
    }
  }
}

function finish(st) {
  const { candidates, uf, threshold } = st;
  const groups = new Map();
  candidates.forEach((_, i) => {
    const r = uf.find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  });
  const clusters = [];
  const ordered = [...groups.values()].sort((x, y) => x[0] - y[0]);
  for (const idxs of ordered) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => candidates[i]);
    const counts = new Map();
    for (const w of members) if (w.contentHash) counts.set(w.contentHash, (counts.get(w.contentHash) || 0) + 1);
    const memberKind = {};
    for (const w of members) memberKind[w.id] = w.contentHash && counts.get(w.contentHash) > 1 ? 'exact' : 'near';
    const kind = members.some((w) => memberKind[w.id] === 'exact') ? 'exact' : 'near';
    const mixed = kind === 'exact' && members.some((w) => memberKind[w.id] === 'near');
    clusters.push({
      kind,
      members,
      memberKind,
      suggestedKeeperId: suggestKeeper(members),
      reason: mixed
        ? 'Contains an exact match plus visually similar files'
        : kind === 'exact'
          ? 'Identical file contents'
          : `Visually similar (perceptual hash within ${threshold} bits)`,
    });
  }
  return clusters;
}

function thresholdOf(opts) {
  return opts && Number.isFinite(opts.threshold) ? opts.threshold : NEAR_DUPLICATE_THRESHOLD;
}

export function clusterDuplicates(works, opts = {}) {
  const st = prepare(works, thresholdOf(opts));
  if (st.candidates.length < 2) return [];
  nearRows(st, 0, st.nearIdx.length);
  return finish(st);
}

export async function clusterDuplicatesAsync(works, opts = {}) {
  const { yieldNow = async () => {}, isCancelled = () => false, onProgress, chunkRows = NEAR_CHUNK_ROWS } = opts;
  const st = prepare(works, thresholdOf(opts));
  const rows = st.nearIdx.length;
  const report = (done) => { if (onProgress) onProgress({ done, total: rows }); };
  report(0);
  if (st.candidates.length < 2) return [];
  const chunk = Math.max(1, Math.floor(chunkRows));
  for (let from = 0; from < rows; from += chunk) {
    if (isCancelled()) return null;
    const to = Math.min(rows, from + chunk);
    nearRows(st, from, to);
    report(to);
    if (to < rows) await yieldNow();
  }
  if (isCancelled()) return null;
  return finish(st);
}

export function detectLowQuality(works) {
  const out = [];
  for (const w of Array.isArray(works) ? works : []) {
    if (!w || w.id == null || !w.color) continue;
    const width = Number(w.width) || 0;
    const height = Number(w.height) || 0;
    const tiny = !w.approx && width > 0 && height > 0 && (Math.min(width, height) < TINY_MIN_EDGE || width * height < TINY_MIN_AREA);
    if (tiny) {
      out.push({ id: w.id, reason: 'tiny' });
      continue;
    }
    const palette = Array.isArray(w.palette) ? w.palette : [];
    if (Number(w.color.s) < BLANK_MAX_SATURATION && palette.length <= 1) out.push({ id: w.id, reason: 'blank' });
  }
  return out;
}

export function buildDupes(clusters, junk) {
  const row = (c) => ({
    key: clusterKey(c),
    ids: c.members.map((m) => m.id),
    kinds: c.members.map((m) => c.memberKind[m.id]),
    keeperId: c.suggestedKeeperId,
    reason: c.reason,
  });
  const list = Array.isArray(clusters) ? clusters : [];
  return {
    exact: list.filter((c) => c.kind === 'exact').map(row),
    near: list.filter((c) => c.kind === 'near').map(row),
    junk: Array.isArray(junk) ? junk.map((j) => ({ id: j.id, reason: j.reason })) : [],
  };
}
