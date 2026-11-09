/* Cosmos space — the owner's curation and the validated intents that change it (spec §5).

   Two documents, both plain JSON, both written by main only:
     curation = { version:1, clusters:[{id,name,description?,elementIds[],createdAt,updatedAt,rule?}],
                  favorites:{id:true}, hidden:{id:true}, overrides:{id:{title?,tags?}} }
     cleanup  = { version:1, dismissed:{ clusters:{key:iso}, candidates:{id:iso} } }

   The renderer never sends a document. It sends an INTENT ({ type, … }); applyIntent validates it BEFORE any
   IO, mints every id and timestamp from the injected newId/now, and returns brand-new documents (the inputs
   are never mutated). A refusal is { error:'a sentence for the owner' } with nothing changed.

   Element ids must exist in the id map (which keeps every id forever, so a curated file that went missing
   still works) and must not be a retired reservation (`retired:` entries from import-local's re-key).

   Pure: no fs, no clock of its own, no randomness of its own. */

import { normalizeTag } from './infer.mjs';

export const CURATION_VERSION = 1;
export const MAX_INTENT_BYTES = 64 * 1024;
export const RETIRED_PREFIX = 'retired:';

export const LIMITS = Object.freeze({
  clusters: 500,
  elementsPerCluster: 20000,
  tagsPerElement: 30,
  tagLength: 40,
  title: 200,
  clusterName: 80,
  clusterDescription: 500,
  ruleQuery: 200,
  idsPerFlag: 500,
  idsPerClusterEdit: 2000,
  tagInputs: 100,
});

export const INTENT_TYPES = Object.freeze([
  'favorite', 'hide', 'tags', 'title', 'cluster-save', 'cluster-delete', 'cluster-add', 'cluster-remove',
  'cleanup-dismiss', 'import-replace',
]);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** An id/key that may be used as an object key and shown back safely. */
export function isSafeKey(k) {
  return typeof k === 'string' && k !== '' && k.length <= 300 && !DANGEROUS_KEYS.has(k) && !/[\u0000-\u001f]/.test(k);
}

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function emptyCuration() {
  return { version: CURATION_VERSION, clusters: [], favorites: {}, hidden: {}, overrides: {} };
}

export function emptyCleanup() {
  return { version: CURATION_VERSION, dismissed: { clusters: {}, candidates: {} } };
}

function normalizeRule(raw) {
  if (!isPlain(raw)) return undefined;
  const rule = {};
  if (typeof raw.query === 'string' && raw.query.trim() !== '') rule.query = raw.query;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t) => typeof t === 'string');
    if (tags.length) rule.tags = tags;
  }
  return rule.query || rule.tags ? rule : undefined;
}

function normalizeCluster(c) {
  if (!isPlain(c) || !isSafeKey(c.id) || typeof c.name !== 'string') return null;
  const ids = c.elementIds === undefined ? [] : c.elementIds;
  if (!Array.isArray(ids)) return null;
  const elementIds = [];
  for (const id of ids) {
    if (typeof id !== 'string') return null;
    if (isSafeKey(id)) elementIds.push(id);
  }
  const createdAt = c.createdAt === undefined ? '' : c.createdAt;
  const updatedAt = c.updatedAt === undefined ? createdAt : c.updatedAt;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null;
  if (c.description !== undefined && typeof c.description !== 'string') return null;
  const out = { id: c.id, name: c.name };
  if (typeof c.description === 'string' && c.description !== '') out.description = c.description;
  out.elementIds = elementIds;
  out.createdAt = createdAt;
  out.updatedAt = updatedAt;
  const rule = normalizeRule(c.rule);
  if (rule) out.rule = rule;
  return out;
}

function normalizeFlags(o) {
  if (o === undefined) return {};
  if (!isPlain(o)) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v === true && isSafeKey(k)) out[k] = true;
  return out;
}

/** Parsed JSON → a clean curation document, or null when the shape is wrong (the caller quarantines it). */
export function normalizeCuration(raw) {
  if (!isPlain(raw)) return null;
  if (raw.version !== undefined && typeof raw.version !== 'number') return null;
  const rawClusters = raw.clusters === undefined ? [] : raw.clusters;
  if (!Array.isArray(rawClusters)) return null;
  const clusters = [];
  for (const c of rawClusters) {
    const n = normalizeCluster(c);
    if (!n) return null;
    clusters.push(n);
  }
  const favorites = normalizeFlags(raw.favorites);
  const hidden = normalizeFlags(raw.hidden);
  if (favorites === null || hidden === null) return null;
  let overrides = {};
  if (raw.overrides !== undefined) {
    if (!isPlain(raw.overrides)) return null;
    for (const [k, v] of Object.entries(raw.overrides)) {
      if (!isSafeKey(k)) continue;
      if (!isPlain(v)) return null;
      if (v.title !== undefined && typeof v.title !== 'string') return null;
      if (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.some((t) => typeof t !== 'string'))) return null;
      const o = {};
      if (typeof v.title === 'string') o.title = v.title;
      if (Array.isArray(v.tags)) o.tags = v.tags.slice();
      if (o.title !== undefined || o.tags !== undefined) overrides[k] = o;
    }
  }
  return { version: CURATION_VERSION, clusters, favorites, hidden, overrides };
}

/** Parsed JSON → a clean cleanup document, or null when the shape is wrong. */
export function normalizeCleanup(raw) {
  if (!isPlain(raw)) return null;
  if (raw.version !== undefined && typeof raw.version !== 'number') return null;
  const d = raw.dismissed === undefined ? {} : raw.dismissed;
  if (!isPlain(d)) return null;
  const pick = (o) => {
    if (o === undefined) return {};
    if (!isPlain(o)) return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && k !== '' && k.length <= 20000 && !k.split(' ').some((p) => DANGEROUS_KEYS.has(p))) out[k] = v;
    }
    return out;
  };
  const clusters = pick(d.clusters);
  const candidates = pick(d.candidates);
  if (clusters === null || candidates === null) return null;
  return { version: CURATION_VERSION, dismissed: { clusters, candidates } };
}

/** The checks that need no document: shape, size, allowlisted type. Returns a sentence or null. */
export function checkIntent(intent) {
  if (!isPlain(intent)) return 'That action is not recognised.';
  let size;
  try { size = Buffer.byteLength(JSON.stringify(intent)); } catch { return 'That action is not recognised.'; }
  if (size > MAX_INTENT_BYTES) return 'That request is too large.';
  if (typeof intent.type !== 'string' || !INTENT_TYPES.includes(intent.type)) return 'That action is not recognised.';
  return null;
}

function toIso(d) {
  if (typeof d === 'string') return d;
  if (d instanceof Date) return d.toISOString();
  return new Date(d).toISOString();
}

function idProblem(ctx, id) {
  if (!isSafeKey(id)) return 'That is not a valid element.';
  const rel = ctx.known.get(id);
  if (rel === undefined) return 'That element is not in the library.';
  if (rel.startsWith(RETIRED_PREFIX)) return 'That element was retired when the library was re-matched.';
  return null;
}

/** The ids an intent names (`ids` wins over `id`), validated and de-duplicated. */
function namedIds(ctx, intent, max) {
  let list;
  if (intent.ids !== undefined) {
    if (!Array.isArray(intent.ids)) return { error: 'That is not a valid list of elements.' };
    list = intent.ids;
  } else if (intent.id !== undefined) list = [intent.id];
  else return { error: 'Say which element.' };
  if (list.length === 0) return { error: 'Say which element.' };
  if (list.length > max) return { error: `Too many at once (up to ${max}).` };
  const seen = new Set();
  const ids = [];
  for (const id of list) {
    const p = idProblem(ctx, id);
    if (p) return { error: p };
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return { ids };
}

function tagList(raw, what) {
  if (raw === undefined || raw === null) return { tags: [] };
  if (!Array.isArray(raw) || raw.length > LIMITS.tagInputs) return { error: `The tags to ${what} are not valid.` };
  const tags = [];
  for (const t of raw) {
    if (typeof t !== 'string') return { error: `The tags to ${what} are not valid.` };
    const n = normalizeTag(t);
    if (n === '') return { error: 'A tag cannot be empty.' };
    if (n.length > LIMITS.tagLength) return { error: `A tag can be at most ${LIMITS.tagLength} characters.` };
    if (!tags.includes(n)) tags.push(n);
  }
  return { tags };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function setFlag(ctx, intent, bucket, onNote, offNote) {
  if (typeof intent.on !== 'boolean') return { error: 'Say whether to turn this on or off.' };
  const r = namedIds(ctx, intent, LIMITS.idsPerFlag);
  if (r.error) return r;
  const flags = ctx.cur[bucket];
  let changed = 0;
  for (const id of r.ids) {
    if (intent.on && flags[id] !== true) { flags[id] = true; changed += 1; }
    if (!intent.on && flags[id] === true) { delete flags[id]; changed += 1; }
  }
  const many = r.ids.length > 1;
  return { curation: changed > 0, note: changed === 0 ? 'Nothing to change.' : (intent.on ? onNote(many) : offNote(many)) };
}

function dropEmptyOverride(ctx, id) {
  const o = ctx.cur.overrides[id];
  if (o && o.title === undefined && o.tags === undefined) delete ctx.cur.overrides[id];
}

const HANDLERS = {
  favorite: (ctx, i) => setFlag(ctx, i, 'favorites', () => 'Added to favourites.', () => 'Removed from favourites.'),
  hide: (ctx, i) => setFlag(ctx, i, 'hidden', (m) => (m ? 'Hidden.' : 'Hidden. Show hidden elements to bring it back.'), () => 'Shown again.'),

  tags(ctx, i) {
    const r = namedIds(ctx, i, LIMITS.idsPerFlag);
    if (r.error) return r;
    const add = tagList(i.add, 'add');
    if (add.error) return add;
    const remove = tagList(i.remove, 'remove');
    if (remove.error) return remove;
    if (add.tags.length === 0 && remove.tags.length === 0) return { error: 'Give a tag to add or remove.' };
    let changed = 0;
    for (const id of r.ids) {
      const existing = ctx.cur.overrides[id];
      const effective = (existing && existing.tags ? existing.tags : ctx.baseTags(id) || []).map((t) => normalizeTag(t)).filter((t) => t !== '');
      const next = [];
      for (const t of effective.filter((t) => !remove.tags.includes(t)).concat(add.tags)) if (!next.includes(t)) next.push(t);
      if (next.length > LIMITS.tagsPerElement) return { error: `An element can have at most ${LIMITS.tagsPerElement} tags.` };
      if (sameJson(next, effective)) continue;          // already what it shows: no override needed
      ctx.cur.overrides[id] = { ...(existing || {}), tags: next };
      changed += 1;
    }
    return { curation: changed > 0, note: changed === 0 ? 'Nothing to change.' : 'Tags updated.' };
  },

  title(ctx, i) {
    const p = idProblem(ctx, i.id);
    if (p) return { error: p };
    if (i.title !== null && typeof i.title !== 'string') return { error: 'That title is not valid.' };
    const t = i.title === null ? '' : i.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (t.length > LIMITS.title) return { error: `A title can be at most ${LIMITS.title} characters.` };
    const existing = ctx.cur.overrides[i.id];
    if (t === '') {
      if (!existing || existing.title === undefined) return { note: 'Nothing to change.' };
      delete existing.title;
      dropEmptyOverride(ctx, i.id);
      return { curation: true, note: 'Title reset.' };
    }
    if (existing && existing.title === t) return { note: 'Nothing to change.' };
    ctx.cur.overrides[i.id] = { ...(existing || {}), title: t };
    return { curation: true, note: 'Title saved.' };
  },

  'cluster-save'(ctx, i) {
    const name = typeof i.name === 'string' ? i.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
    if (name === '' || name.length > LIMITS.clusterName) return { error: `Give the cluster a name of up to ${LIMITS.clusterName} characters.` };
    let description;
    if (i.description !== undefined && i.description !== null) {
      if (typeof i.description !== 'string') return { error: 'That description is not valid.' };
      description = i.description.trim();
      if (description.length > LIMITS.clusterDescription) return { error: `A description can be at most ${LIMITS.clusterDescription} characters.` };
    }
    let rule;
    if (i.rule !== undefined && i.rule !== null) {
      if (!isPlain(i.rule)) return { error: 'That rule is not valid.' };
      const query = i.rule.query === undefined || i.rule.query === null ? '' : i.rule.query;
      if (typeof query !== 'string' || query.trim().length > LIMITS.ruleQuery) return { error: `A search rule can be at most ${LIMITS.ruleQuery} characters.` };
      const tags = tagList(i.rule.tags, 'match');
      if (tags.error) return tags;
      if (tags.tags.length > LIMITS.tagsPerElement) return { error: `A rule can match at most ${LIMITS.tagsPerElement} tags.` };
      if (query.trim() === '' && tags.tags.length === 0) return { error: 'A smart cluster needs a search or at least one tag.' };
      rule = {};
      if (query.trim() !== '') rule.query = query.trim();
      if (tags.tags.length) rule.tags = tags.tags;
    }
    const stamp = ctx.iso();
    const existingIdx = typeof i.id === 'string' ? ctx.cur.clusters.findIndex((c) => c.id === i.id) : -1;
    if (existingIdx >= 0) {
      const old = ctx.cur.clusters[existingIdx];
      const next = { id: old.id, name };
      const desc = i.description === undefined ? old.description : description;
      if (desc) next.description = desc;
      const nextRule = i.rule === undefined ? old.rule : (rule || undefined);
      next.elementIds = nextRule ? [] : old.elementIds;
      next.createdAt = old.createdAt;
      next.updatedAt = old.updatedAt;
      if (nextRule) next.rule = nextRule;
      if (sameJson(next, old)) return { note: 'Nothing to change.' };
      next.updatedAt = stamp;
      ctx.cur.clusters[existingIdx] = next;
      return { curation: true, note: 'Cluster saved.' };
    }
    if (ctx.cur.clusters.length >= LIMITS.clusters) return { error: `There is room for ${LIMITS.clusters} clusters.` };
    let id = null;
    for (let tries = 0; tries < 20 && id === null; tries++) {
      const part = String(ctx.newId ? ctx.newId() : '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
      const cand = 'cl-' + part;
      if (part !== '' && !ctx.cur.clusters.some((c) => c.id === cand)) id = cand;
    }
    if (id === null) return { error: 'Could not make a new cluster just now. Try again.' };
    const made = { id, name };
    if (description) made.description = description;
    made.elementIds = [];
    made.createdAt = stamp;
    made.updatedAt = stamp;
    if (rule) made.rule = rule;
    ctx.cur.clusters.push(made);
    return { curation: true, note: 'Cluster created.' };
  },

  'cluster-delete'(ctx, i) {
    const idx = typeof i.id === 'string' ? ctx.cur.clusters.findIndex((c) => c.id === i.id) : -1;
    if (idx < 0) return { error: 'That cluster no longer exists.' };
    ctx.cur.clusters.splice(idx, 1);
    return { curation: true, note: 'Cluster deleted.' };
  },

  'cluster-add': (ctx, i) => editCluster(ctx, i, true),
  'cluster-remove': (ctx, i) => editCluster(ctx, i, false),

  'cleanup-dismiss'(ctx, i) {
    if (i.kind !== 'dupe' && i.kind !== 'junk') return { error: 'That is not something that can be dismissed.' };
    if (typeof i.key !== 'string' || i.key === '' || i.key.length > 20000) return { error: 'That is not something that can be dismissed.' };
    const parts = i.kind === 'dupe' ? i.key.split(' ') : [i.key];
    if (i.kind === 'dupe' && (parts.length < 2 || parts.length > 500)) return { error: 'That is not something that can be dismissed.' };
    for (const id of parts) {
      const p = idProblem(ctx, id);
      if (p) return { error: p };
    }
    const bucket = i.kind === 'dupe' ? ctx.cln.dismissed.clusters : ctx.cln.dismissed.candidates;
    if (typeof bucket[i.key] === 'string') return { note: 'Already dismissed.' };
    bucket[i.key] = ctx.iso();
    return { cleanup: true, note: 'Dismissed.' };
  },

  'import-replace'(ctx, i) {
    if (typeof i.token !== 'string' || i.token.length < 8 || i.token.length > 100 || typeof ctx.replace !== 'function') {
      return { error: 'That import can no longer be replaced. Import the backup again.' };
    }
    const r = ctx.replace(i.token, ctx.cur);
    if (!r || r.error) return { error: (r && r.error) || 'That import can no longer be replaced. Import the backup again.' };
    ctx.cur = r.curation;
    return { curation: true, note: r.note || 'Replaced with the backup’s version.' };
  },
};

function editCluster(ctx, i, adding) {
  const idx = typeof i.id === 'string' ? ctx.cur.clusters.findIndex((c) => c.id === i.id) : -1;
  if (idx < 0) return { error: 'That cluster no longer exists.' };
  const cluster = ctx.cur.clusters[idx];
  if (cluster.rule) return { error: 'A smart cluster fills itself from its rule. Edit the rule instead.' };
  if (!Array.isArray(i.ids)) return { error: 'That is not a valid list of elements.' };
  const r = namedIds(ctx, { ids: i.ids }, LIMITS.idsPerClusterEdit);
  if (r.error) return r;
  const have = new Set(cluster.elementIds);
  let next;
  if (adding) {
    next = cluster.elementIds.slice();
    for (const id of r.ids) if (!have.has(id)) { have.add(id); next.push(id); }
    if (next.length > LIMITS.elementsPerCluster) return { error: `A cluster holds at most ${LIMITS.elementsPerCluster} elements.` };
  } else {
    const drop = new Set(r.ids);
    next = cluster.elementIds.filter((id) => !drop.has(id));
  }
  const delta = Math.abs(next.length - cluster.elementIds.length);
  if (delta === 0) return { note: 'Nothing to change.' };
  cluster.elementIds = next;
  cluster.updatedAt = ctx.iso();
  return { curation: true, note: adding ? `Added ${delta} to the cluster.` : `Removed ${delta} from the cluster.` };
}

/**
 * Apply one validated intent. Returns brand-new documents; the inputs are never touched.
 * @param {object} curation
 * @param {object} cleanup
 * @param {object} intent
 * @param {{idMap?:{entries:{rel:string,id:string}[]}, now?:()=>Date|string, newId?:()=>string,
 *          baseTags?:(id:string)=>string[], replace?:(token:string, curation:object)=>{curation?:object,note?:string,error?:string}}} opts
 * @returns {{curation:object, cleanup:object, note:string, touched:{curation:boolean, cleanup:boolean}}|{error:string}}
 */
export function applyIntent(curation, cleanup, intent, opts = {}) {
  const bad = checkIntent(intent);
  if (bad) return { error: bad };
  const idMap = opts.idMap && Array.isArray(opts.idMap.entries) ? opts.idMap : { entries: [] };
  const known = new Map();
  for (const e of idMap.entries) if (e && typeof e.id === 'string' && typeof e.rel === 'string') known.set(e.id, e.rel);
  const now = typeof opts.now === 'function' ? opts.now : () => new Date();
  const ctx = {
    cur: clone(curation || emptyCuration()),
    cln: clone(cleanup || emptyCleanup()),
    known,
    iso: () => toIso(now()),
    newId: opts.newId,
    baseTags: typeof opts.baseTags === 'function' ? opts.baseTags : () => [],
    replace: opts.replace,
  };
  let r;
  try { r = HANDLERS[intent.type](ctx, intent); } catch (e) { return { error: 'That did not work: ' + (e && e.message ? e.message : 'unknown problem') }; }
  if (r.error) return { error: r.error };
  return { curation: ctx.cur, cleanup: ctx.cln, note: r.note || 'Saved.', touched: { curation: !!r.curation, cleanup: !!r.cleanup } };
}

/** Every element id the curation and cleanup point at (used by import-local before it re-keys anything). */
export function referencedIds(curation, cleanup) {
  const out = new Set();
  if (curation) {
    for (const c of curation.clusters || []) for (const id of c.elementIds || []) out.add(id);
    for (const id of Object.keys(curation.favorites || {})) out.add(id);
    for (const id of Object.keys(curation.hidden || {})) out.add(id);
    for (const id of Object.keys(curation.overrides || {})) out.add(id);
  }
  if (cleanup && cleanup.dismissed) {
    for (const key of Object.keys(cleanup.dismissed.clusters || {})) for (const id of key.split(' ')) out.add(id);
    for (const id of Object.keys(cleanup.dismissed.candidates || {})) out.add(id);
  }
  return out;
}
