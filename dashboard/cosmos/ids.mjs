/* Cosmos space — the sticky id map: relative path → element id, kept forever.

   WHY THIS EXISTS. An element's id is what every cluster, favourite, hidden flag and title/tag override
   points at. The source app (Cosmos Local) derived ids from the walk each time: slug(relative path), plus
   '-x' on a clash, minted newest-file-first. That is only stable while the folder stays the same. Two
   things break it for a library that keeps growing:
     - a NEWER file whose slug collides with an older one's takes the bare id in the next walk, and the
       older file is handed '-x' — the curated favourite now lands on the wrong image;
     - ids are cut at 80 characters, so two long paths that differ only in the tail collide.
   So the map is written down once and then only ever APPENDED to: a known path keeps its id, a never-seen
   path gets a new one that cannot equal any id ever handed out (even for a file that has since been
   deleted or moved), and an existing id is never re-suffixed.

   Shape (plain JSON, round-trips through JSON.stringify/parse unchanged):
     { version: 1, entries: [{ rel: 'folder/file.png', id: 'folder-file-png' }, …] }
   `rel` is root-relative with '/' separators and is stored as first seen; paths compare case-insensitively
   (Windows). The array form (not an object keyed by path) keeps odd names like '__proto__' harmless.

   Pure: no fs, no clock, no randomness. Every function returns a new map and never mutates its input. */

import { slug } from './infer.mjs';

export const ID_MAP_VERSION = 1;

/** An empty map: nothing known yet. */
export function emptyIdMap() {
  return { version: ID_MAP_VERSION, entries: [] };
}

/** Comparison key for a relative path: '/' separators, no leading './', lower-cased. */
export function pathKey(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}

/** The path as stored: '/' separators, no leading './', case untouched. */
function cleanRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * Root-relative path from a manifest `src` of the form '/media/<seg>/<seg>/…', where each segment was
 * encodeURIComponent'd ONCE by the source app. Each segment is decoded exactly once, here and nowhere
 * else: a segment that already contains a literal '%41' arrives as '%2541' and must come back as '%41',
 * not 'A'. Returns null for anything that is not a plain /media/ path (another prefix, a malformed
 * escape, an empty segment, or a segment that decodes to '.', '..' or something containing a separator).
 */
export function relFromSrc(src) {
  if (typeof src !== 'string' || !src.startsWith('/media/')) return null;
  const segs = src.slice('/media/'.length).split('/');
  const out = [];
  for (const seg of segs) {
    if (seg === '') return null;
    let dec;
    try {
      dec = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (dec === '' || dec === '.' || dec === '..' || /[\\/]/.test(dec)) return null;
    out.push(dec);
  }
  return out.join('/');
}

/** True when `m` looks like a well-formed map (used by the callers that read it from disk). */
function validEntries(raw) {
  return raw && typeof raw === 'object' && Array.isArray(raw.entries);
}

/**
 * Read a map back from parsed JSON. Never throws. Malformed or duplicate entries are dropped (the first
 * one for a path, and the first one for an id, wins) and counted in `dropped` so the caller can say so.
 * @returns {{ map: {version:number, entries:{rel:string,id:string}[]}, dropped: number }}
 */
export function parseIdMap(raw) {
  const map = emptyIdMap();
  if (!validEntries(raw)) return { map, dropped: 0 };
  const keys = new Set();
  const ids = new Set();
  let dropped = 0;
  for (const e of raw.entries) {
    const ok = e && typeof e.rel === 'string' && typeof e.id === 'string' && e.rel !== '' && e.id !== '';
    if (!ok) { dropped += 1; continue; }
    const k = pathKey(e.rel);
    if (keys.has(k) || ids.has(e.id)) { dropped += 1; continue; }
    keys.add(k);
    ids.add(e.id);
    map.entries.push({ rel: cleanRel(e.rel), id: e.id });
  }
  return { map, dropped };
}

/** The id already known for this path, or null. */
export function idFor(map, rel) {
  const k = pathKey(rel);
  for (const e of map.entries) if (pathKey(e.rel) === k) return e.id;
  return null;
}

/** The path a known id belongs to, or null. */
export function relFor(map, id) {
  for (const e of map.entries) if (e.id === id) return e.rel;
  return null;
}

/**
 * Seed a map from the source app's manifest ({ works: [{ id, src }] }): every work's `src` is decoded
 * once (relFromSrc) and its id is kept exactly as the manifest has it, '-x' suffixes and 80-character
 * cuts included. Entries already in `into` win (a re-seed never changes a known id).
 * Works that cannot be seeded are reported, never guessed at:
 *   - 'no-path'     the src is not a decodable /media/ path (a clip or an upload — other id namespaces)
 *   - 'no-id'       the work has no usable id
 *   - 'path-known'  the same path (any letter case) is already in the map with another id
 *   - 'id-known'    the same id is already in the map for another path
 * @returns {{ map, seeded: number, skipped: {id:string|null, reason:string}[] }}
 */
export function seedFromManifest(manifest, into = emptyIdMap()) {
  const map = { version: ID_MAP_VERSION, entries: into.entries.map((e) => ({ rel: e.rel, id: e.id })) };
  const keys = new Set(map.entries.map((e) => pathKey(e.rel)));
  const ids = new Set(map.entries.map((e) => e.id));
  const skipped = [];
  let seeded = 0;
  const works = manifest && Array.isArray(manifest.works) ? manifest.works : [];
  for (const w of works) {
    const id = w && typeof w.id === 'string' && w.id !== '' ? w.id : null;
    if (!id) { skipped.push({ id: null, reason: 'no-id' }); continue; }
    const rel = relFromSrc(w.src);
    if (rel === null) { skipped.push({ id, reason: 'no-path' }); continue; }
    const k = pathKey(rel);
    if (keys.has(k)) {
      // the same path twice with the same id is just a repeat; with another id it is a conflict
      if (!map.entries.some((e) => pathKey(e.rel) === k && e.id === id)) skipped.push({ id, reason: 'path-known' });
      continue;
    }
    if (ids.has(id)) { skipped.push({ id, reason: 'id-known' }); continue; }
    keys.add(k);
    ids.add(id);
    map.entries.push({ rel, id });
    seeded += 1;
  }
  return { map, seeded, skipped };
}

/**
 * Give every file an id. `files` is [{ rel, mtimeMs }] (root-relative; mtimeMs is the file's modified
 * time). Known paths keep their id. Never-seen paths are minted NEWEST FILE FIRST (ties by path), each as
 * slug(rel) — or 'work' when that is empty — with '-x' appended while it equals an id already handed out.
 * "Handed out" includes every id in the map, even one whose file is gone, so an id is never reused.
 * The same path listed twice (any letter case) is one file. Files without a usable rel are ignored.
 * @returns {{ map, entries: {rel:string, id:string, isNew:boolean}[], minted: number }}
 *   `entries` follows the order of `files`, without repeats.
 */
export function assignIds(map, files) {
  const next = { version: ID_MAP_VERSION, entries: map.entries.map((e) => ({ rel: e.rel, id: e.id })) };
  const byKey = new Map(next.entries.map((e) => [pathKey(e.rel), e.id]));
  const used = new Set(next.entries.map((e) => e.id));

  const seen = new Set();
  const list = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.rel !== 'string' || f.rel === '') continue;
    const k = pathKey(f.rel);
    if (seen.has(k)) continue;
    seen.add(k);
    const mtimeMs = Number.isFinite(f.mtimeMs) ? f.mtimeMs : 0;
    list.push({ rel: cleanRel(f.rel), key: k, mtimeMs });
  }

  const fresh = list
    .filter((f) => !byKey.has(f.key))
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const mintedIds = new Map();
  for (const f of fresh) {
    let id = slug(f.rel) || 'work';
    while (used.has(id)) id += '-x';
    used.add(id);
    byKey.set(f.key, id);
    mintedIds.set(f.key, id);
    next.entries.push({ rel: f.rel, id });
  }

  const entries = list.map((f) => ({ rel: f.rel, id: byKey.get(f.key), isNew: mintedIds.has(f.key) }));
  return { map: next, entries, minted: mintedIds.size };
}
