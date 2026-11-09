/* Cosmos space — importing the owner's old gallery (Cosmos Local): its backup envelope and its manifest.

   The backup carries the irreplaceable half (clusters, favourites, hidden flags, title/tag edits); the
   manifest carries the old ids. Everything here is pure: text in, plain objects out, inputs never mutated.

   readBackup(text)        the envelope, size-capped and sanitised field by field
   mergeCuration(…)        a UNION with what the space already holds. Existing wins; whatever the backup
                           would have changed is counted as a conflict and handed back so the owner can
                           still say "replace" (applyConflicts) — nothing is overwritten silently.
   seedManifest(…)         seedFromManifest with one extra guard: a decoded path containing ':' is refused
                           (it could only be a forged `imports:` / `retired:` entry)
   reconcileIds(…)         the one code path allowed to change an id. When the owner indexed BEFORE
                           importing, an indexed path may carry a minted id that differs from the manifest's.
                           If nothing refers to the minted id and the manifest id is free, the entry is
                           re-keyed to the manifest id and the minted id is reserved forever as
                           `{rel:'retired:<id>', id:<id>}` so it can never be handed out again.
                           A referenced or clashing one is left alone and listed (notMatched).
   importReport(…)         the text counters for the owner.

   The sticky-id rule still holds: nothing here ever hands an existing id to a different file. */

import { emptyIdMap, seedFromManifest, relFromSrc, pathKey } from './ids.mjs';
import { normalizeTag } from './infer.mjs';
import { LIMITS, RETIRED_PREFIX, isSafeKey, emptyCuration } from './curation.mjs';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_MISSING_LISTED = 200;
export const MAX_SKIPPED_LISTED = 200;
const EPOCH = '1970-01-01T00:00:00.000Z';

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function cleanTags(raw) {
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const n = normalizeTag(t);
    if (n === '' || n.length > LIMITS.tagLength || out.includes(n)) continue;
    out.push(n);
    if (out.length >= LIMITS.tagsPerElement) break;
  }
  return out;
}

function cleanCluster(c, fallbackStamp) {
  if (!isPlain(c) || !isSafeKey(c.id) || typeof c.name !== 'string') return null;
  const name = c.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, LIMITS.clusterName);
  if (name === '') return null;
  const seen = new Set();
  const elementIds = [];
  if (Array.isArray(c.elementIds)) {
    for (const id of c.elementIds) {
      if (!isSafeKey(id) || seen.has(id)) continue;
      seen.add(id);
      elementIds.push(id);
      if (elementIds.length >= LIMITS.elementsPerCluster) break;
    }
  }
  const stamp = (v) => (typeof v === 'string' && v !== '' && v.length <= 40 ? v : fallbackStamp);
  const out = { id: c.id, name };
  if (typeof c.description === 'string' && c.description.trim() !== '') out.description = c.description.trim().slice(0, LIMITS.clusterDescription);
  out.elementIds = elementIds;
  out.createdAt = stamp(c.createdAt);
  out.updatedAt = stamp(c.updatedAt || c.createdAt);
  if (isPlain(c.rule)) {
    const rule = {};
    if (typeof c.rule.query === 'string' && c.rule.query.trim() !== '') rule.query = c.rule.query.trim().slice(0, LIMITS.ruleQuery);
    const tags = cleanTags(c.rule.tags);
    if (tags && tags.length) rule.tags = tags;
    if (rule.query || rule.tags) { out.rule = rule; out.elementIds = []; }
  }
  return out;
}

/**
 * Read the old app's backup envelope: { app:'cosmos-local', version:1, clusters[], favorites, hidden, overrides }.
 * Extra keys are ignored; every id and field is sanitised. Never throws.
 * @returns {{backup:{clusters:object[], favorites:Record<string,true>, hidden:Record<string,true>,
 *            overrides:Record<string,{title?:string,tags?:string[]}>, dropped:number}}|{error:string}}
 */
export function readBackup(text, { nowIso } = {}) {
  if (typeof text !== 'string') return { error: 'That file could not be read.' };
  if (Buffer.byteLength(text) > MAX_BACKUP_BYTES) return { error: 'That file is too large to be a Cosmos backup (over 20 MB).' };
  let raw;
  try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return { error: 'That file is not a Cosmos backup (it is not valid JSON).' }; }
  if (!isPlain(raw) || raw.app !== 'cosmos-local') return { error: 'That file is not a Cosmos Local backup.' };
  if (raw.version !== 1) return { error: 'That backup is a version this app does not read.' };
  if (!Array.isArray(raw.clusters)) return { error: 'That backup has no list of clusters.' };
  const fallbackStamp = typeof raw.exportedAt === 'string' && raw.exportedAt !== '' && raw.exportedAt.length <= 40 ? raw.exportedAt : (nowIso || EPOCH);
  let dropped = 0;
  const clusters = [];
  const clusterIds = new Set();
  for (const c of raw.clusters) {
    const n = cleanCluster(c, fallbackStamp);
    if (!n || clusterIds.has(n.id)) { dropped += 1; continue; }
    clusterIds.add(n.id);
    clusters.push(n);
  }
  const flags = (o) => {
    const out = {};
    if (!isPlain(o)) return out;
    for (const [k, v] of Object.entries(o)) {
      if (v !== true) continue;
      if (isSafeKey(k)) out[k] = true; else dropped += 1;
    }
    return out;
  };
  const overrides = {};
  if (isPlain(raw.overrides)) {
    for (const [k, v] of Object.entries(raw.overrides)) {
      if (!isSafeKey(k) || !isPlain(v)) { dropped += 1; continue; }
      const o = {};
      if (typeof v.title === 'string') {
        const t = v.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
        if (t !== '') o.title = t.slice(0, LIMITS.title);
      }
      const tags = cleanTags(v.tags);
      if (tags) o.tags = tags;
      if (o.title !== undefined || o.tags !== undefined) overrides[k] = o;
    }
  }
  return { backup: { clusters, favorites: flags(raw.favorites), hidden: flags(raw.hidden), overrides, dropped } };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sameCluster = (a, b) => (
  a.name === b.name && (a.description || '') === (b.description || '')
  && JSON.stringify(a.rule || null) === JSON.stringify(b.rule || null)
  && sameSet(a.elementIds, b.elementIds)
);

/**
 * Union the backup into the current curation. Nothing the owner already has is replaced.
 * @param {object} current   a curation document
 * @param {object} backup    from readBackup
 * @param {{libraryIds?:Set<string>|string[], idMap?:{entries:{rel:string,id:string}[]}}} ctx
 * @returns {{merged:object, report:object, conflictItems:{clusters:object[], overrides:Record<string,object>}}}
 *   report: { clusters, favorites, hidden, overrides (newly applied), found:{…}, missingIds[≤200], missingCount, conflicts, dropped }
 */
export function mergeCuration(current, backup, { libraryIds = new Set(), idMap = emptyIdMap() } = {}) {
  const merged = JSON.parse(JSON.stringify(current || emptyCuration()));
  const present = libraryIds instanceof Set ? libraryIds : new Set(libraryIds);
  const retired = new Set(idMap.entries.filter((e) => e.rel.startsWith(RETIRED_PREFIX)).map((e) => e.id));
  const referenced = new Set();
  const conflictItems = { clusters: [], overrides: {} };
  let conflicts = 0;
  let dropped = backup.dropped || 0;
  const usable = (id) => {
    if (retired.has(id)) { dropped += 1; return false; }
    referenced.add(id);
    return true;
  };

  let favAdded = 0;
  for (const id of Object.keys(backup.favorites)) if (usable(id) && merged.favorites[id] !== true) { merged.favorites[id] = true; favAdded += 1; }
  let hidAdded = 0;
  for (const id of Object.keys(backup.hidden)) if (usable(id) && merged.hidden[id] !== true) { merged.hidden[id] = true; hidAdded += 1; }

  let clustersAdded = 0;
  for (const bc of backup.clusters) {
    const ids = bc.elementIds.filter((id) => usable(id));
    const incoming = { ...bc, elementIds: ids };
    const existing = merged.clusters.find((c) => c.id === bc.id);
    if (existing) {
      if (!sameCluster(existing, incoming)) { conflicts += 1; conflictItems.clusters.push(incoming); }
      continue;
    }
    if (merged.clusters.length >= LIMITS.clusters) { dropped += 1; continue; }
    merged.clusters.push(incoming);
    clustersAdded += 1;
  }

  let overridesApplied = 0;
  for (const [id, bo] of Object.entries(backup.overrides)) {
    if (!usable(id)) continue;
    const ex = merged.overrides[id] || {};
    const next = { ...ex };
    const rest = {};
    let applied = false;
    if (bo.title !== undefined) {
      if (ex.title === undefined) { next.title = bo.title; applied = true; } else if (ex.title !== bo.title) rest.title = bo.title;
    }
    if (bo.tags !== undefined) {
      if (ex.tags === undefined) { next.tags = bo.tags.slice(); applied = true; } else if (!sameSet(ex.tags, bo.tags)) rest.tags = bo.tags.slice();
    }
    if (applied) { merged.overrides[id] = next; overridesApplied += 1; }
    if (rest.title !== undefined || rest.tags !== undefined) { conflicts += 1; conflictItems.overrides[id] = rest; }
  }

  for (const c of backup.clusters) for (const id of c.elementIds) if (!retired.has(id)) referenced.add(id);
  const missing = [...referenced].filter((id) => !present.has(id));
  return {
    merged,
    report: {
      clusters: clustersAdded,
      favorites: favAdded,
      hidden: hidAdded,
      overrides: overridesApplied,
      found: {
        clusters: backup.clusters.length,
        favorites: Object.keys(backup.favorites).length,
        hidden: Object.keys(backup.hidden).length,
        overrides: Object.keys(backup.overrides).length,
      },
      missingIds: missing.slice(0, MAX_MISSING_LISTED),
      missingCount: missing.length,
      conflicts,
      dropped,
    },
    conflictItems,
  };
}

/**
 * The owner chose "replace": take the backup's version of every entry that was held back as a conflict.
 * @returns {{curation:object, clusters:number, overrides:number}}
 */
export function applyConflicts(current, conflictItems) {
  const out = JSON.parse(JSON.stringify(current || emptyCuration()));
  let clusters = 0;
  let overrides = 0;
  for (const c of (conflictItems && conflictItems.clusters) || []) {
    const idx = out.clusters.findIndex((x) => x.id === c.id);
    if (idx >= 0) { out.clusters[idx] = JSON.parse(JSON.stringify(c)); clusters += 1; }
  }
  for (const [id, rest] of Object.entries((conflictItems && conflictItems.overrides) || {})) {
    if (!isSafeKey(id)) continue;
    out.overrides[id] = { ...(out.overrides[id] || {}), ...JSON.parse(JSON.stringify(rest)) };
    overrides += 1;
  }
  return { curation: out, clusters, overrides };
}

/**
 * seedFromManifest, minus any work whose decoded path contains ':' (a colon cannot be in a real relative
 * path; it could only be a forged `imports:` or `retired:` entry). Those are reported as 'bad-path'.
 * @returns {{map, seeded:number, skipped:{id:string|null, reason:string}[]}}
 */
export function seedManifest(manifest, into = emptyIdMap()) {
  const works = manifest && Array.isArray(manifest.works) ? manifest.works : [];
  const pre = [];
  const keep = [];
  for (const w of works) {
    const rel = w && typeof w.src === 'string' ? relFromSrc(w.src) : null;
    if (rel !== null && rel.includes(':')) pre.push({ id: w && typeof w.id === 'string' ? w.id : null, reason: 'bad-path' });
    else keep.push(w);
  }
  const r = seedFromManifest({ works: keep }, into);
  return { map: r.map, seeded: r.seeded, skipped: pre.concat(r.skipped) };
}

/**
 * Re-key minted ids to the manifest's where it is provably safe. Pure; inputs untouched.
 * @param {{idMap:{entries:{rel:string,id:string}[]}, works?:object[], manifestMap:{entries:{rel:string,id:string}[]},
 *          referenced?:Set<string>|string[]}} a
 * @returns {{idMap, works:object[], renames:{from:string,to:string}[], rekeyed:number,
 *            notMatched:{rel:string, id:string, manifestId:string, reason:'referenced'|'id-in-use'}[]}}
 */
export function reconcileIds({ idMap, works = [], manifestMap, referenced = new Set() }) {
  const ref = referenced instanceof Set ? referenced : new Set(referenced);
  const entries = idMap.entries.map((e) => ({ rel: e.rel, id: e.id }));
  const byKey = new Map(entries.map((e, i) => [pathKey(e.rel), i]));
  const used = new Set(entries.map((e) => e.id));
  const renames = [];
  const notMatched = [];
  const extra = [];
  for (const m of manifestMap.entries) {
    const idx = byKey.get(pathKey(m.rel));
    if (idx === undefined) continue;
    const cur = entries[idx];
    if (cur.id === m.id || cur.rel.startsWith(RETIRED_PREFIX)) continue;
    if (ref.has(cur.id)) { notMatched.push({ rel: cur.rel, id: cur.id, manifestId: m.id, reason: 'referenced' }); continue; }
    if (used.has(m.id)) { notMatched.push({ rel: cur.rel, id: cur.id, manifestId: m.id, reason: 'id-in-use' }); continue; }
    extra.push({ rel: RETIRED_PREFIX + cur.id, id: cur.id });
    renames.push({ from: cur.id, to: m.id });
    entries[idx] = { rel: cur.rel, id: m.id };
    used.add(m.id);
  }
  const renameMap = new Map(renames.map((r) => [r.from, r.to]));
  return {
    idMap: { version: idMap.version || 1, entries: entries.concat(extra) },
    works: works.map((w) => {
      if (!renameMap.has(w.id)) return w;
      const to = renameMap.get(w.id);
      const thumb = typeof w.thumb === 'string' && w.thumb.endsWith(w.id + '.jpg') ? w.thumb.slice(0, -(w.id.length + 4)) + to + '.jpg' : w.thumb;
      return { ...w, id: to, thumb };
    }),
    renames,
    rekeyed: renames.length,
    notMatched,
  };
}

/** The text counters the owner reads after an import. */
export function importReport(r) {
  const parts = [
    `${r.clusters} cluster${r.clusters === 1 ? '' : 's'}`,
    `${r.favorites} favourite${r.favorites === 1 ? '' : 's'}`,
    `${r.hidden} hidden`,
    `${r.overrides} edit${r.overrides === 1 ? '' : 's'}`,
  ];
  const out = [`Imported ${parts.join(', ')}.`];
  if (r.missingCount > 0) out.push(`${r.missingCount} referenced file${r.missingCount === 1 ? ' is' : 's are'} not in the library.`);
  if (r.seeded > 0) out.push(`${r.seeded} ids were taken over from the old manifest.`);
  if (r.rekeyed > 0) out.push(`${r.rekeyed} indexed file${r.rekeyed === 1 ? ' was' : 's were'} re-matched to the old id.`);
  if (r.notMatchedCount > 0) out.push(`${r.notMatchedCount} could not be re-matched because they are already in use.`);
  if (r.skippedCount > 0) out.push(`${r.skippedCount} manifest entr${r.skippedCount === 1 ? 'y was' : 'ies were'} skipped.`);
  if (r.conflicts > 0) out.push(`${r.conflicts} ${r.conflicts === 1 ? 'entry differs' : 'entries differ'} from what you already have: yours were kept.`);
  if (r.manifest === 'skipped') out.push('No manifest was chosen, so no ids were taken over.');
  else if (r.manifest === 'unreadable') out.push('The manifest could not be read, so no ids were taken over.');
  out.push('Duplicate-cleanup dismissals are not in the old backup.');
  return out.join(' ');
}

