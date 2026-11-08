/* Cosmos space — the indexer: walk the pictures folder and build library.json's contents.

   `runIndex` is composition over injected IO (see the io contract below), so plain Node tests cover it with a
   fake file system. It READS the pictures folder and WRITES only thumbnails (io.writeThumb(id, jpeg)), never
   a path under the pictures root, never a rename or delete. The caller (cosmos-main) owns library.json: it
   writes the returned library atomically, and writes nothing when the result is { cancelled: true }.

   Steps, in order (progress phases walk -> thumbs -> hashes -> dupes, each with a first and a last event):
     1. idMap: the old library's map, parsed. On a FIRST run only (no old library, or one without an idMap)
        and when a manifest was supplied, the map is seeded from the manifest first (ids.seedFromManifest);
        the seeded / skipped counts go in stats. A manifest is ignored once an idMap exists.
     2. walk (./walk.mjs).
     3. assignIds: the sticky rule. A known path keeps its id forever; only never-seen paths are minted
        (newest first). An id of a deleted file is never reused: the idMap keeps its entry.
     4. thumbs: a file whose old work has the same size and mtimeMs, with a thumbnail that exists and is not
        older than the source, is carried over untouched (rel refreshed). Anything else: read the header
        (images only), make the thumbnail, extract colours and the dHash. Per-file errors become thumb:null.
        A file that vanished since the walk (ENOENT) is dropped silently.
        Width/height: header size (EXIF-oriented) > the thumbnail result's sourceWidth/sourceHeight > the
        thumbnail's OWN size, kept for its RATIO only and flagged `approx: true` > 1 x 1 with thumb:null and
        approx:true. A size pair is never omitted. `approx` is written only when true.
     5. hashes: sha256 only for files whose byte size equals another file's size (exact duplicates need equal
        size), up to 512 MB; bigger ones are left without a hash and counted in stats.tooLarge.
     6. dupes: clusterDuplicatesAsync + detectLowQuality -> library.dupes {exact, near, junk}.
     7. { library: { version: 1, generatedAt, root: rootLabel, idMap, works (newest first), dupes }, stats }.

   io contract (all async-or-sync; this module awaits each):
     readdir(dir) -> [{name,isDir,isFile,isSymlink}]      stat(abs) -> {size,mtimeMs,birthtimeMs}
     readHead(abs, n) -> Uint8Array (the first n bytes)     hashFile(abs) -> sha256 hex
     thumbnail(abs, {ext, kind, edge: 560, size}) -> null | { jpeg: Buffer, width, height,
         sourceWidth: number|null, sourceHeight: number|null, rgba32: {width,height,data RGBA}, gray9x8 }
         width/height are the THUMBNAIL's own size; sourceWidth/sourceHeight (DISPLAYED size, EXIF applied)
         only when the strategy knows the original's size.
     thumbInfo(id) -> null | { mtimeMs }                     writeThumb(id, jpegBuffer)

   Cancel: isCancelled() is polled between files and in the dupes chunks; a cancel returns { cancelled: true }.
   Thumbnails already written stay on disk and are reused by the next run. Never throws for a bad file; it
   throws TypeError only for programmer errors (a missing io function). */

import { parseIdMap, seedFromManifest, assignIds, pathKey } from './ids.mjs';
import { imageSize, orientedSize, HEADER_BYTES } from './imagesize.mjs';
import { inferType, titleFrom, normalizeTag } from './infer.mjs';
import { walk } from './walk.mjs';
import { extractColors } from './colorextract.mjs';
import { dhashFromGray } from './dhash.mjs';
import { clusterDuplicatesAsync, detectLowQuality, buildDupes } from './dupes.mjs';

export const LIBRARY_VERSION = 1;
export const THUMB_EDGE = 560;
export const MAX_HASH_BYTES = 512 * 1024 * 1024;
const IO_FUNCTIONS = ['readdir', 'stat', 'readHead', 'hashFile', 'thumbnail', 'thumbInfo', 'writeThumb'];

const isGone = (e) => !!e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
const isDim = (n) => Number.isFinite(n) && n > 0;

async function runPool(count, concurrency, task, isCancelled, yieldNow) {
  let next = 0;
  let finished = 0;
  let cancelled = false;
  const lane = async () => {
    for (;;) {
      if (cancelled || isCancelled()) { cancelled = true; return; }
      const i = next;
      next += 1;
      if (i >= count) return;
      await task(i);
      finished += 1;
      if (finished % 25 === 0) await yieldNow();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, lane));
  return cancelled;
}

function isoOf(ms, fallbackMs) {
  const t = Number.isFinite(ms) ? ms : fallbackMs;
  const d = new Date(Number.isFinite(t) ? t : 0);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function nameParts(rel, roots) {
  let r = rel;
  for (const root of roots) {
    if (root.prefix && r.startsWith(root.prefix)) { r = r.slice(root.prefix.length); break; }
  }
  return r.split('/');
}

function tagsFor(parts) {
  const out = [];
  for (const dir of parts.slice(0, -1)) {
    const t = normalizeTag(dir);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function pickSize(header, tres) {
  if (header) {
    const o = orientedSize(header);
    return { width: o.width, height: o.height, approx: false };
  }
  if (tres && isDim(tres.sourceWidth) && isDim(tres.sourceHeight)) {
    return { width: Math.round(tres.sourceWidth), height: Math.round(tres.sourceHeight), approx: false };
  }
  if (tres && isDim(tres.width) && isDim(tres.height)) {
    return { width: Math.round(tres.width), height: Math.round(tres.height), approx: true };
  }
  return { width: 1, height: 1, approx: true };
}

export async function runIndex({
  roots, rootLabel, io, oldLibrary = null, manifest = null,
  now = Date.now, yieldNow = async () => {}, onProgress = () => {}, isCancelled = () => false, concurrency = 3,
}) {
  if (!Array.isArray(roots) || roots.length === 0) throw new TypeError('runIndex needs roots');
  for (const fn of IO_FUNCTIONS) if (!io || typeof io[fn] !== 'function') throw new TypeError(`runIndex: io.${fn} is missing`);
  const lanes = Math.max(1, Math.floor(Number(concurrency)) || 1);
  const emit = (phase, done, total) => onProgress({ phase, done, total });

  const stats = {
    files: 0, indexed: 0, unchanged: 0, thumbsOk: 0, thumbsFailed: 0, byExt: {}, minted: 0,
    seeded: 0, seedSkipped: 0, idMapDropped: 0, hashed: 0, hashFailed: 0, tooLarge: 0,
    unreadable: 0, truncated: false, vanished: 0, skippedDirs: 0, skippedLinks: 0,
  };

  // 1. the sticky id map
  const hasOldMap = !!(oldLibrary && oldLibrary.idMap && Array.isArray(oldLibrary.idMap.entries));
  const parsed = parseIdMap(hasOldMap ? oldLibrary.idMap : null);
  let idMap = parsed.map;
  stats.idMapDropped = parsed.dropped;
  if (!hasOldMap && manifest && typeof manifest === 'object') {
    const seeded = seedFromManifest(manifest, idMap);
    idMap = seeded.map;
    stats.seeded = seeded.seeded;
    stats.seedSkipped = seeded.skipped.length;
  }

  // 2. walk
  emit('walk', 0, 0);
  const walked = await walk({
    roots, io, isCancelled, yieldNow, onProgress: ({ found }) => emit('walk', found, found),
  });
  if (walked.cancelled) return { cancelled: true };
  stats.files = walked.files.length;
  stats.unreadable = walked.unreadable;
  stats.truncated = walked.truncated;
  stats.skippedDirs = walked.skippedDirs;
  stats.skippedLinks = walked.skippedLinks;
  emit('walk', walked.files.length, walked.files.length);

  // 3. ids (sticky)
  const assigned = assignIds(idMap, walked.files);
  idMap = assigned.map;
  stats.minted = assigned.minted;
  const idByKey = new Map(assigned.entries.map((e) => [pathKey(e.rel), e.id]));
  const jobs = [];
  const seenKeys = new Set();
  for (const f of walked.files) {
    const k = pathKey(f.rel);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    jobs.push({ f, id: idByKey.get(k) });
  }

  // 4. thumbs
  const oldById = new Map();
  if (oldLibrary && Array.isArray(oldLibrary.works)) for (const w of oldLibrary.works) if (w && typeof w.id === 'string') oldById.set(w.id, w);
  const total = jobs.length;
  const results = new Array(total).fill(null);
  const todo = [];
  let done = 0;
  emit('thumbs', 0, total);
  for (let i = 0; i < total; i += 1) {
    if (isCancelled()) return { cancelled: true };
    const { f, id } = jobs[i];
    const old = oldById.get(id);
    if (old && old.size === f.size && old.mtimeMs === f.mtimeMs && typeof old.thumb === 'string') {
      let info = null;
      try { info = await io.thumbInfo(id); } catch { info = null; }
      if (info && Number.isFinite(info.mtimeMs) && info.mtimeMs >= f.mtimeMs) {
        results[i] = { ...structuredClone(old), rel: f.rel };
        stats.unchanged += 1;
        done += 1;
        if (done % 50 === 0) emit('thumbs', done, total);
        continue;
      }
    }
    todo.push(i);
  }

  const bump = (ext, ok) => {
    const slot = stats.byExt[ext] || (stats.byExt[ext] = { ok: 0, failed: 0 });
    if (ok) { slot.ok += 1; stats.thumbsOk += 1; } else { slot.failed += 1; stats.thumbsFailed += 1; }
  };

  async function processFile({ f, id }) {
    const video = f.kind === 'video';
    let header = null;
    if (!video) {
      try {
        header = imageSize(await io.readHead(f.abs, HEADER_BYTES));
      } catch (e) {
        if (isGone(e)) return null;
      }
    }
    let tres = null;
    try {
      tres = await io.thumbnail(f.abs, { ext: f.ext, kind: f.kind, edge: THUMB_EDGE, size: f.size });
    } catch (e) {
      if (isGone(e)) return null;
      tres = null;
    }
    if (tres && !(tres.jpeg && tres.jpeg.length > 0)) tres = null;
    let thumb = null;
    if (tres) {
      try {
        await io.writeThumb(id, tres.jpeg);
        thumb = `thumbs/${id}.jpg`;
      } catch {
        thumb = null;
      }
    }
    bump(f.ext, thumb !== null);

    let cs = null;
    let phash = null;
    if (tres) {
      try { cs = tres.rgba32 ? extractColors(tres.rgba32) : null; } catch { cs = null; }
      try { phash = dhashFromGray(tres.gray9x8); } catch { phash = null; }
    }
    const size = pickSize(header, tres);
    const parts = nameParts(f.rel, roots);
    const work = {
      id,
      rel: f.rel,
      title: titleFrom(parts.join('/')),
      type: inferType(f.rel),
      width: size.width,
      height: size.height,
      orientation: size.width > size.height ? 'landscape' : size.height > size.width ? 'portrait' : 'square',
      color: cs ? cs.color : null,
      palette: cs ? cs.palette : [],
      thumb,
      video,
      contentHash: null,
      perceptualHash: phash,
      tags: tagsFor(parts),
      createdAt: isoOf(f.createdMs, f.mtimeMs),
      size: f.size,
      mtimeMs: f.mtimeMs,
    };
    if (size.approx) work.approx = true;
    return work;
  }

  const thumbCancelled = await runPool(todo.length, lanes, async (k) => {
    const i = todo[k];
    results[i] = await processFile(jobs[i]);
    if (results[i]) stats.indexed += 1; else stats.vanished += 1;
    done += 1;
    emit('thumbs', done, total);
  }, isCancelled, yieldNow);
  if (thumbCancelled) return { cancelled: true };
  emit('thumbs', total, total);

  // 5. hashes (equal byte size only)
  const live = [];
  for (let i = 0; i < total; i += 1) if (results[i]) live.push({ w: results[i], f: jobs[i].f, gone: false });
  const sizeCount = new Map();
  for (const e of live) sizeCount.set(e.w.size, (sizeCount.get(e.w.size) || 0) + 1);
  const toHash = [];
  for (const e of live) {
    if (sizeCount.get(e.w.size) < 2) { e.w.contentHash = null; continue; }
    if (e.w.size > MAX_HASH_BYTES) { e.w.contentHash = null; stats.tooLarge += 1; continue; }
    if (typeof e.w.contentHash === 'string' && e.w.contentHash) continue;     // carried over, still valid
    e.w.contentHash = null;
    toHash.push(e);
  }
  let hashDone = 0;
  emit('hashes', 0, toHash.length);
  const hashCancelled = await runPool(toHash.length, lanes, async (k) => {
    const e = toHash[k];
    try {
      const h = await io.hashFile(e.f.abs);
      if (typeof h === 'string' && h) { e.w.contentHash = h.toLowerCase(); stats.hashed += 1; } else stats.hashFailed += 1;
    } catch (err) {
      if (isGone(err)) e.gone = true; else stats.hashFailed += 1;
    }
    hashDone += 1;
    emit('hashes', hashDone, toHash.length);
  }, isCancelled, yieldNow);
  if (hashCancelled) return { cancelled: true };
  emit('hashes', toHash.length, toHash.length);
  for (const e of live) if (e.gone) stats.vanished += 1;
  const works = live.filter((e) => !e.gone).map((e) => e.w);

  // 6. duplicates and junk
  const clusters = await clusterDuplicatesAsync(works, {
    yieldNow, isCancelled, onProgress: ({ done: d, total: t }) => emit('dupes', d, t),
  });
  if (clusters === null) return { cancelled: true };
  const dupes = buildDupes(clusters, detectLowQuality(works));

  const stamp = now();
  return {
    library: {
      version: LIBRARY_VERSION,
      generatedAt: stamp instanceof Date ? stamp.toISOString() : new Date(stamp).toISOString(),
      root: rootLabel,
      idMap,
      works,
      dupes,
    },
    stats,
  };
}
