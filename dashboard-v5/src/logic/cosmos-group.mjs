// Cosmos space — Feed grouping: splits an (already sorted) list of works into labelled sections for the sectioned masonry.
// Ported by hand (behaviour, not code) from Cosmos Local's src/lib/grouping.ts. PURE: siblings only, no DOM, no clock
// (the caller passes `today`; month labels are English and fixed so a golden never depends on the machine's locale).
//
//   none   -> ONE unlabelled group (key 'all') holding everything; [] for no works (the source returned [] for none and
//             let the caller special-case it; here the caller always gets a list it can lay out)
//   type   -> the eight types in declaration order, empty types skipped
//   family -> the twelve hue families around the wheel, MONO, then 'Unscanned' (no colour yet)
//   month  -> newest month first, 'Undated' last
//   tag    -> each work files under its most-used tag (library-wide count, over the works passed in), groups largest
//             first, at most TAG_GROUP_CAP named groups (the rest merge into 'Other tags (n)'), 'Untagged' last
//
// Order INSIDE a group is the incoming order, so the active sort applies within every group.
import { HUE_FAMILIES, MONO_FAMILY, familyOf, isColorSig } from './cosmos-color.mjs';
import { WORK_TYPES, TYPE_LABELS, tagIndex } from './cosmos-search.mjs';

export const GROUP_MODES = Object.freeze(['none', 'type', 'family', 'month', 'tag']);
export const GROUP_LABELS = Object.freeze({ none: 'No grouping', type: 'By type', family: 'By colour', month: 'By month', tag: 'By tag' });

export const UNSCANNED_KEY = 'unscanned';
export const UNDATED_KEY = 'undated';
export const UNTAGGED_KEY = '~untagged'; // the '~' keeps these two from colliding with a real tag called 'untagged'
export const OTHER_TAGS_KEY = '~other-tags';
export const UNSCANNED_LABEL = 'Unscanned';
export const UNDATED_LABEL = 'Undated';
export const UNTAGGED_LABEL = 'Untagged';

/** tag mode never lists more than this many named groups; the long tail merges into one 'Other tags' group */
export const TAG_GROUP_CAP = 30;

const MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])/;

function bucket(works, keyOf) {
  const map = new Map();
  for (const w of works) {
    const k = keyOf(w);
    const list = map.get(k);
    if (list) list.push(w);
    else map.set(k, [w]);
  }
  return map;
}

/** '2026-11' -> 'November 2026' */
export function monthLabel(key) {
  const m = MONTH_KEY_RE.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : UNDATED_LABEL;
}

const monthKeyOf = (w) => {
  const m = typeof w.createdAt === 'string' ? MONTH_KEY_RE.exec(w.createdAt) : null;
  return m ? `${m[1]}-${m[2]}` : UNDATED_KEY;
};

/**
 * @param {object[]} works already sorted
 * @param {'none'|'type'|'family'|'month'|'tag'} mode
 * @param {{today?: string}} [opts] accepted so every caller passes the same shape; no mode reads the day today
 * @returns {{key:string, label:string, works:object[]}[]}
 */
export function groupWorks(works, mode, _opts = {}) {
  const list = Array.isArray(works) ? works : [];
  if (list.length === 0) return [];

  if (mode === 'type') {
    const map = bucket(list, (w) => w.type);
    const known = WORK_TYPES.filter((t) => map.has(t)).map((t) => ({ key: t, label: TYPE_LABELS[t], works: map.get(t) }));
    // a type this build does not know (a hand-edited library) still shows, last, under its own name, never silently dropped
    const strange = [...map.keys()].filter((k) => !WORK_TYPES.includes(k)).map((k) => ({ key: String(k), label: String(k), works: map.get(k) }));
    return [...known, ...strange];
  }

  if (mode === 'family') {
    const map = bucket(list, (w) => (isColorSig(w.color) ? familyOf(w.color) : UNSCANNED_KEY));
    const order = [...HUE_FAMILIES.map((f) => f.name), MONO_FAMILY.name, UNSCANNED_KEY];
    return order.filter((k) => map.has(k)).map((k) => ({ key: k, label: k === UNSCANNED_KEY ? UNSCANNED_LABEL : k.toLowerCase(), works: map.get(k) }));
  }

  if (mode === 'month') {
    const map = bucket(list, monthKeyOf);
    const keys = [...map.keys()].filter((k) => k !== UNDATED_KEY).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first
    if (map.has(UNDATED_KEY)) keys.push(UNDATED_KEY);
    return keys.map((k) => ({ key: k, label: k === UNDATED_KEY ? UNDATED_LABEL : monthLabel(k), works: map.get(k) }));
  }

  if (mode === 'tag') {
    // file each work under its most-used tag so groups stay meaningful when a work carries several; the first tag wins a tie
    const counts = tagIndex(list);
    const assigned = list.map((w) => {
      if (!Array.isArray(w.tags) || w.tags.length === 0) return UNTAGGED_KEY;
      let best = w.tags[0];
      for (const t of w.tags) if ((counts.get(t) || 0) > (counts.get(best) || 0)) best = t;
      return `t:${best}`;
    });
    const map = new Map();
    list.forEach((w, i) => {
      const bucketList = map.get(assigned[i]);
      if (bucketList) bucketList.push(w);
      else map.set(assigned[i], [w]);
    });
    // largest first; equal sizes keep first-seen order (Array.sort is stable)
    const named = [...map.keys()].filter((k) => k !== UNTAGGED_KEY).sort((a, b) => map.get(b).length - map.get(a).length);
    const kept = named.slice(0, TAG_GROUP_CAP);
    const tail = new Set(named.slice(TAG_GROUP_CAP));
    const groups = kept.map((k) => ({ key: k.slice(2), label: k.slice(2), works: map.get(k) }));
    if (tail.size > 0) {
      const other = list.filter((_, i) => tail.has(assigned[i]));
      groups.push({ key: OTHER_TAGS_KEY, label: `Other tags (${tail.size})`, works: other });
    }
    if (map.has(UNTAGGED_KEY)) groups.push({ key: UNTAGGED_KEY, label: UNTAGGED_LABEL, works: map.get(UNTAGGED_KEY) });
    return groups;
  }

  return [{ key: 'all', label: '', works: list }];
}
