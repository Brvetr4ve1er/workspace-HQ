// Cosmos space — the states the selftest walks (selftest.js loops them beside Money's, in both themes).
//
//   cosmosStates(lib) -> [name, sub, cosmosLive, cosState, extra][]            (the Money row shape, selftest.js "money-" rows)
//     lib         the 1,000-work answer of tools/cosmos-fixture.mjs fakeCosmos() (selftest.js imports it dynamically, like the money JSON)
//     cosmosLive  a LIVE.cosmos slice, put straight into the store (LV.cosmos = row[2]); the arrival read is held by the caller
//     cosState    the cos* component state this row sets (an object of COS_STATE_KEYS keys); the caller spreads cosInitState() first, so a
//                 row never inherits the previous row's query, lightbox or overlay
//     extra       any other state patch (only snapOffset, for the scrubbed row; the caller skips that row when the time machine has no
//                 past, as it does for money-scrubbed)
//
// The 1,000-work library is used by at most four rows (the selftest has a 180 s ceiling); every other ready state runs on a 60-work
// subset that keeps one of each odd case (a dropped-in file, an unknown size, a video, the long and the quoted titles, the curation).
// This file is import-light on purpose (only the slice's emptyCosmos) and does no IO: the test drives it in plain Node.
import { emptyCosmos } from './live/cosmos-slice.mjs';

/** Rows that need hq.cosmos hidden for one combo (the store's hq, never window.hq), the way rch-offline hides hq.reach. */
export const COSMOS_OFFLINE_ROWS = Object.freeze(['cosmos-offline']);
/** Rows that need a time machine with a past (snapOffset 1); the caller drops them when M.maxOff is 0. */
export const COSMOS_SCRUBBED_ROWS = Object.freeze(['cosmos-scrubbed']);
/** How many works a non-big ready state shows. */
export const SUBSET_SIZE = 60;

const isImport = (w) => typeof w.rel === 'string' && w.rel.startsWith('imports:');

/**
 * A smaller, self-consistent library: `n` works in the original order, always keeping the odd cases and the curated ones, with the
 * curation, clusters and duplicate groups cut down to what is left (a group survives only if every member does).
 */
export function subsetLibrary(lib, n = SUBSET_SIZE) {
  const works = Array.isArray(lib && lib.works) ? lib.works : [];
  if (works.length <= n) return lib;
  const keep = new Set();
  const add = (w) => { if (w && keep.size < n) keep.add(w.id); };
  const some = (pred, k) => { let c = 0; for (const w of works) { if (c >= k) break; if (pred(w)) { add(w); c++; } } };
  const cu = lib.curation || {};
  some(isImport, 2);
  some((w) => w.approx === true, 1);
  some((w) => w.video === true, 2);
  some((w) => typeof w.title === 'string' && w.title.length >= 200, 1);
  some((w) => typeof w.title === 'string' && w.title.includes('"'), 1);
  some((w) => typeof w.rel === 'string' && w.rel.includes('#'), 1);
  some((w) => !!(cu.favorites && cu.favorites[w.id]), 4);
  some((w) => !!(cu.hidden && cu.hidden[w.id]), 2);
  some((w) => !!(cu.overrides && cu.overrides[w.id]), 2);
  const tagged = works.find((w) => Array.isArray(w.tags) && w.tags.includes('kiln'));
  add(tagged);
  for (const w of works) { if (keep.size >= n) break; keep.add(w.id); }
  const picked = works.filter((w) => keep.has(w.id));
  const ids = new Set(picked.map((w) => w.id));
  const only = (map) => Object.fromEntries(Object.entries(map || {}).filter(([k]) => ids.has(k)));
  const groups = (list) => (list || []).filter((g) => g.ids.every((id) => ids.has(id)));
  return {
    ...lib,
    works: picked,
    curation: {
      ...cu,
      favorites: only(cu.favorites),
      hidden: only(cu.hidden),
      overrides: only(cu.overrides),
      clusters: (cu.clusters || []).map((c) => ({ ...c, elementIds: (c.elementIds || []).filter((id) => ids.has(id)) })),
    },
    dupes: { exact: groups(lib.dupes && lib.dupes.exact), near: groups(lib.dupes && lib.dupes.near), junk: ((lib.dupes && lib.dupes.junk) || []).filter((j) => ids.has(j.id)) },
  };
}

// ---- LIVE.cosmos builders ---------------------------------------------------------------------------------
const emptyDupes = () => ({ exact: [], near: [], junk: [] });
const emptyCuration = () => ({ version: 1, clusters: [], favorites: {}, hidden: {}, overrides: {} });
const emptyCleanup = () => ({ version: 1, dismissed: { clusters: {}, candidates: {} } });

/** A slice as the store holds it after a good read of `a` (the shape cosmos-slice.mjs takeRead leaves), then `over`. */
function liveOf(a, over) {
  return Object.assign(emptyCosmos(), {
    loaded: true, error: '', state: a.state, config: a.config, works: a.works, dupes: a.dupes, curation: a.curation, cleanup: a.cleanup,
    rootOk: a.rootOk !== false, indexing: a.indexing || null, revision: 1,
  }, over || {});
}
const never = () => ({ state: 'empty', config: { version: 1, root: null, indexedAt: null }, works: [], dupes: emptyDupes(), curation: emptyCuration(), cleanup: emptyCleanup(), rootOk: true, indexing: null });

const REPORT = () => ({
  clusters: 3, favorites: 25, hidden: 15, overrides: 4, found: 38, seeded: 12, skipped: [],
  missingIds: ['alpha-site-9001', 'alpha-site-9002', 'beta-shots-9003'], missingCount: 3, conflicts: 0, token: null,
  note: 'Imported the placeholder backup',
});

/** @returns {Array<[string, string, object, object, object]>} */
export function cosmosStates(lib) {
  const big = lib;
  const small = subsetLibrary(lib, SUBSET_SIZE);
  const ws = (small && small.works) || [];
  const plain = ws.find((w) => !w.video && !w.approx && !isImport(w) && w.thumbUrl && Array.isArray(w.tags) && w.tags.length > 0) || ws[0];
  const video = ws.find((w) => w.video) || plain;
  const other = ws.find((w) => !w.video && !w.approx && !isImport(w) && w.thumbUrl && w !== plain) || plain;
  const dropped = ws.find(isImport) || plain;
  const lb = (w, extra) => ({ cosLb: Object.assign({ id: w ? w.id : '', edit: null, trashAsk: false }, extra || {}) });
  const row = (name, live, cs, extra) => [name, 'feed', live, cs || {}, extra || {}];
  const idle = () => liveOf(small);
  const withReport = (r) => liveOf(small, { report: r });
  const rep = (over) => Object.assign(REPORT(), over || {});
  const conflicts = () => rep({ conflicts: 3, token: 'selftest-token' });
  const loaded = (over) => liveOf(small, over);
  const noFavs = () => liveOf({ ...small, curation: { ...small.curation, favorites: {} } });

  return [
    row('cosmos-offline', emptyCosmos()),
    row('cosmos-loading', emptyCosmos()),
    row('cosmos-error', Object.assign(emptyCosmos(), { loaded: true, error: 'selftest: synthetic read error' })),
    row('cosmos-error-with-library', loaded({ error: 'selftest: synthetic read error' })),
    row('cosmos-no-root', liveOf(never())),
    row('cosmos-empty-library', liveOf({ ...never(), state: 'ready', config: { version: 1, root: 'C:/placeholder-library', indexedAt: '2026-11-05T09:00:00.000Z' } })),
    row('cosmos-no-match', idle(), { cosQuery: 'zzz-no-such-word' }),
    row('cosmos-no-favourites', noFavs(), { cosFav: true }),
    row('cosmos-ready', liveOf(big)),
    row('cosmos-ready-grouped-type', liveOf(big), { cosGroup: 'type' }),
    row('cosmos-ready-paged', liveOf(big), { cosShown: 240 }),
    row('cosmos-ready-roomy', idle(), { cosDensity: 'roomy' }),
    row('cosmos-stale', loaded({ config: { ...small.config, indexedAt: '2026-01-05T09:00:00.000Z' } })),
    row('cosmos-root-missing', loaded({ rootOk: false })),
    row('cosmos-indexing', loaded({ indexing: { phase: 'thumbs', done: 412, total: 1000 } })),
    row('cosmos-index-overlay', loaded({ indexing: { phase: 'hashes', done: 230, total: 1000 } }), { cosIdx: true, cosFolder: 'C:/placeholder-library' }),
    row('cosmos-index-first', liveOf(never()), { cosIdx: true, cosFolder: 'C:/placeholder-library' }),
    row('cosmos-index-done', loaded({ summary: { elements: 1000, thumbsFailed: 13, minted: 12 } }), { cosIdx: true, cosFolder: 'C:/placeholder-library' }),
    row('cosmos-lightbox-image', idle(), lb(plain)),
    row('cosmos-lightbox-video', idle(), lb(video)),
    row('cosmos-lightbox-edit-title', idle(), lb(plain, { edit: 'title', draft: plain ? String(plain.title) : '' })),
    row('cosmos-lightbox-trash-ask', idle(), lb(dropped, { trashAsk: true })),
    // batch 5 polish: a card whose thumbnail fell back / whose pictures both failed, the lightbox at actual size, a failed original, the drag outline
    row('cosmos-failed-card', idle(), plain && other ? { cosBroken: { [plain.id]: 'thumb', [other.id]: 'failed' } } : {}),
    row('cosmos-lightbox-actual-size', idle(), Object.assign(lb(plain), { cosLbZoom: 'actual' })),
    row('cosmos-lightbox-failed-original', idle(), Object.assign(lb(plain), plain ? { cosBroken: { ['lb:' + plain.id]: 'failed' } } : {})),
    row('cosmos-feed-dragging', idle(), { cosDrag: 1 }),
    row('cosmos-report', withReport(rep()), { cosReportOpen: true }),
    row('cosmos-report-conflicts', withReport(conflicts()), { cosReportOpen: true }),
    row('cosmos-report-replace-ask', withReport(conflicts()), { cosReportOpen: true, cosReplaceAsk: true }),
    row('cosmos-report-skipped', withReport(rep({ rekeyed: 3, skippedCount: 3, skipped: [{ id: 'alpha-site-9101', reason: 'id-known' }, { id: null, reason: 'no-id' }, { id: 'alpha-site-9102', reason: 'bad-path' }], notMatchedCount: 1, notMatched: [{ rel: 'placeholder/a.png', id: 'alpha-site-0001', manifestId: 'alpha-site-9103', reason: 'referenced' }], manifest: 'used' })), { cosReportOpen: true }),
    row('cosmos-scrubbed', idle(), {}, { snapOffset: 1 }),
  ];
}
