// Cosmos space — the ONE search grammar, shared by the Feed and by the MCP tool hq_cosmos_search.
// Ported by hand (behaviour, not code) from Cosmos Local's src/lib/{rank,tags}.ts; the semantic and OCR halves are dropped.
// The renderer can't import main-side code, but the MCP server CAN import this file, so the grammar lives once, here
// (the Money amountLine precedent, dashboard/money-line-parity.test.mjs). Hence the rules for this file:
//   * PURE: no DOM, no clock, no IO, no globals. The only import is './cosmos-color.mjs' (a test scans the source).
//   * WORK_TYPES / TYPE_LABELS are COPIES of dashboard/cosmos/types.mjs and normalizeTag a copy of infer.mjs'
//     (the renderer cannot import them); dashboard/cosmos/search-parity.test.mjs keeps the copies equal.
//
// A work (from data/cosmos/library.json): { id, title, type, tags?, color?, createdAt?, width?, height?, ... }.
// curation (data/cosmos/curation.json): { favorites:{id:true}, hidden:{id:true}, overrides:{id:{title?,tags?}}, clusters:[] }.
import { colorDistance, familyOf, hexToRgb, toColorSig, isColorSig, HUE_FAMILIES, MONO_FAMILY } from './cosmos-color.mjs';

export const WORK_TYPES = Object.freeze(['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc']);
export const TYPE_LABELS = Object.freeze({
  '3d': '3D & Render',
  ui: 'UI & Product',
  illustration: 'Illustration',
  photo: 'Photography',
  logo: 'Logo & Identity',
  motion: 'Motion',
  type: 'Typography',
  misc: 'Misc',
});

/** A colour query returns at most this many works, nearest first. */
export const COLOR_RESULT_CAP = 80;

// ---- tags ----

/** Canonical tag form: lower-case, trimmed, inner whitespace collapsed. */
export function normalizeTag(raw) {
  return String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Comma-separated text -> unique normalised tags, in order. */
export function parseTags(raw) {
  const out = [];
  for (const part of String(raw == null ? '' : raw).split(',')) {
    const t = normalizeTag(part);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** tag -> how many works carry it. One pass. */
export function tagIndex(works) {
  const index = new Map();
  for (const w of works || []) {
    if (!Array.isArray(w.tags)) continue;
    for (const t of w.tags) index.set(t, (index.get(t) || 0) + 1);
  }
  return index;
}

/** Most-used tags first (count desc, then alphabetical so the order is stable). */
export function topTags(index, n = Infinity) {
  const all = [...index.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return n === Infinity ? all : all.slice(0, n);
}

/** Works carrying ALL of the given tags (AND). No tags -> the input array itself. */
export function filterByTags(works, tags) {
  if (!tags || tags.length === 0) return works;
  return works.filter((w) => {
    if (!Array.isArray(w.tags) || w.tags.length < tags.length) return false;
    for (const t of tags) if (!w.tags.includes(t)) return false;
    return true;
  });
}

// ---- curation layered over the library ----

/** Own-property flag lookup: curation maps are plain JSON objects keyed by ids the owner's files minted. */
export function isFlagged(map, id) {
  return !!map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, id) && !!map[id];
}

/**
 * The works as the owner sees them: a title or tag override from curation.overrides[id] replaces the library's.
 * The searchable record is the effective one. Nothing is mutated; a work without an override keeps its identity, and
 * with no override at all the SAME array comes back (so a memo keyed on it stays warm).
 */
export function effectiveWorks(works, curation) {
  const list = Array.isArray(works) ? works : [];
  const ov = curation && typeof curation === 'object' ? curation.overrides : null;
  if (!ov || typeof ov !== 'object') return list;
  let any = false;
  const out = list.map((w) => {
    if (!Object.prototype.hasOwnProperty.call(ov, w.id)) return w;
    const o = ov[w.id];
    if (!o || typeof o !== 'object') return w;
    const next = { ...w };
    let changed = false;
    if (typeof o.title === 'string' && o.title.trim()) { next.title = o.title; changed = true; }
    if (Array.isArray(o.tags)) {
      const tags = [];
      for (const t of o.tags) { const n = normalizeTag(t); if (n && !tags.includes(n)) tags.push(n); }
      next.tags = tags;
      changed = true;
    }
    if (!changed) return w;
    any = true;
    return next;
  });
  return any ? out : list;
}

// ---- the grammar ----

// A '#' always means hex. A bare token only counts as hex when it contains a digit, so words made of a-f letters
// ("add", "decade", "facade") stay words.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const BARE_HEX_RE = /^(?=.*\d)([0-9a-f]{3}|[0-9a-f]{6})$/i;
// 'tag:' followed at once by the tag. 'tag: wip' (a space after the colon) is not the grammar; it is a plain word search.
const TAG_RE = /^tag:(\S.*)$/i;

const FAMILY_NAMES = new Set([...HUE_FAMILIES.map((f) => f.name), MONO_FAMILY.name]);

// A type is named by its id ('ui') or by any word of its label ('render', 'photography', 'identity').
const LABEL_WORDS = Object.freeze(Object.fromEntries(WORK_TYPES.map((t) => [t, TYPE_LABELS[t].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)])));

function typeFromQuery(q) {
  const lower = q.toLowerCase();
  for (const t of WORK_TYPES) {
    if (t === lower || LABEL_WORDS[t].includes(lower)) return t;
  }
  return null;
}

/**
 * @param {object[]} works
 * @param {string} query
 * @returns {{kind:'none'|'color'|'family'|'type'|'tag'|'text', works:object[], hex?:string, family?:string, type?:string, tag?:string, text?:string}}
 *   priority: hex, tag:, colour family, type word, free text. An empty query is kind 'none' and returns `works` itself.
 */
export function runSearch(works, query) {
  const list = Array.isArray(works) ? works : [];
  const q = String(query == null ? '' : query).trim();
  if (!q) return { kind: 'none', works: list };

  const hexMatch = q.match(HEX_RE) || q.match(BARE_HEX_RE);
  if (hexMatch) {
    const hex = `#${hexMatch[1].toLowerCase()}`;
    const { r, g, b } = hexToRgb(hex);
    const target = toColorSig(r, g, b);
    const ranked = list
      .filter((w) => isColorSig(w.color))
      .map((w) => ({ w, d: colorDistance(target, w.color) }))
      .sort((a, b2) => a.d - b2.d) // stable: equal distances keep library order
      .slice(0, COLOR_RESULT_CAP)
      .map((x) => x.w);
    return { kind: 'color', works: ranked, hex };
  }

  const tagMatch = q.match(TAG_RE);
  if (tagMatch) {
    const tag = normalizeTag(tagMatch[1]);
    return { kind: 'tag', tag, works: list.filter((w) => Array.isArray(w.tags) && w.tags.includes(tag)) };
  }

  const upper = q.toUpperCase();
  if (FAMILY_NAMES.has(upper)) {
    return { kind: 'family', family: upper, works: list.filter((w) => isColorSig(w.color) && familyOf(w.color) === upper) };
  }

  const type = typeFromQuery(q);
  if (type) return { kind: 'type', type, works: list.filter((w) => w.type === type) };

  const lower = q.toLowerCase();
  return {
    kind: 'text',
    text: q,
    works: list.filter((w) => `${w.title == null ? '' : w.title} ${w.type == null ? '' : w.type} ${Array.isArray(w.tags) ? w.tags.join(' ') : ''}`.toLowerCase().includes(lower)),
  };
}

/** The short chip text for a search result: 'colour #1a6b52', 'tag wip', 'teal', 'photo', the typed words; '' for none. */
export function describeQuery(result) {
  if (!result || typeof result !== 'object') return '';
  switch (result.kind) {
    case 'color': return `colour ${result.hex}`;
    case 'tag': return `tag ${result.tag}`;
    case 'family': return String(result.family || '').toLowerCase();
    case 'type': return String(result.type || '');
    case 'text': return String(result.text || '');
    default: return '';
  }
}

// ---- sorting ----

export const SORT_MODES = Object.freeze(['newest', 'oldest', 'title', 'hue', 'brightness', 'saturation', 'random']);
export const SORT_LABELS = Object.freeze({
  newest: 'Newest', oldest: 'Oldest', title: 'Title A-Z', hue: 'Colour', brightness: 'Brightness', saturation: 'Saturation', random: 'Shuffle',
});

// Key-extracted and stable: each key is computed once, ties keep incoming order.
function sortByKey(works, key, desc = false) {
  const keyed = works.map((w, i) => ({ w, k: key(w), i }));
  keyed.sort((a, b) => {
    if (a.k < b.k) return desc ? 1 : -1;
    if (a.k > b.k) return desc ? -1 : 1;
    return a.i - b.i;
  });
  return keyed.map((x) => x.w);
}

// Chromatic works around the wheel (light before dark within a hue), then neutrals light to dark, then unscanned.
function hueKey(w) {
  if (!isColorSig(w.color)) return 3e6;
  const { h, s, l } = w.color;
  return s < 0.14 ? 2e6 + (1 - l) * 999 : h * 1000 + (1 - l) * 999;
}

/** Numeric seed from a string (a date key). */
export function hashSeed(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic shuffle: the same seed always gives the same order. */
export function seededShuffle(items, seed) {
  const out = [...items];
  let s = (seed >>> 0) || 1;
  const rand = () => { // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LAST_CODE_UNIT = String.fromCharCode(0xffff);

/**
 * A new array in the requested order (the input is never touched). `today` is the shuffle's seed: the caller passes a
 * day string ('2026-11-08') so 'random' is stable while browsing and nothing here reads a clock.
 * An unknown mode keeps the incoming order.
 */
export function sortWorks(works, mode, today = '') {
  const list = Array.isArray(works) ? works : [];
  switch (mode) {
    case 'newest': return sortByKey(list, (w) => w.createdAt || '', true);
    case 'oldest': return sortByKey(list, (w) => w.createdAt || LAST_CODE_UNIT);
    case 'title': return sortByKey(list, (w) => String(w.title == null ? '' : w.title).toLowerCase());
    case 'hue': return sortByKey(list, hueKey);
    case 'brightness': return sortByKey(list, (w) => (isColorSig(w.color) ? w.color.l : -1), true);
    case 'saturation': return sortByKey(list, (w) => (isColorSig(w.color) ? w.color.s : -1), true);
    case 'random': return seededShuffle(list, hashSeed(today));
    default: return [...list];
  }
}
