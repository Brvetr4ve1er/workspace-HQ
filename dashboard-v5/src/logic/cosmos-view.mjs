// Cosmos space — the Feed's whole pipeline in one pure function, plus the honest empty-state reasons and the memo that
// makes an unchanged result set cost nothing to re-render. No DOM, no clock, no IO, no globals: the caller passes
// `width` (a number) and `today` (a day string). The renderer's vals call buildFeed; the Electron gate measures it.
//
//   buildFeed({ works, curation, query, sort, group, density, favOnly, showHidden, width, shown, today })
//     fixed order: effectiveWorks -> drop hidden (unless showHidden) -> favourites only -> runSearch -> sort (a colour
//     query keeps its nearest-first order) -> groupWorks -> layoutGroups for the first `shown` cards.
//     -> { ids, works, cards, headers, height, total, shown, remaining, kind, chip, reason }
//        ids        every result, in display order (the lightbox steps through these)
//        works      the same results as the effective work records (override titles/tags applied), same order
//        cards      [{ id, box }] for the first `shown` results; headers [{ key, label, count, box }]
//        total      results; shown = cards.length; remaining = total - shown
//        kind/chip  what the query was read as ('tag', 'colour #1a6b52', ...); chip is '' for no query
//        reason     'none' when there is something to show, else the search-side empty reason
//                   ('empty-library' | 'no-match' | 'no-favourites'); the load/connection reasons come from emptyReason
import { effectiveWorks, runSearch, sortWorks, describeQuery, isFlagged } from './cosmos-search.mjs';
import { groupWorks } from './cosmos-group.mjs';
import { layoutGroups } from './cosmos-layout.mjs';

/**
 * The paging switch. Infinity = every card is emitted (design section 8: lazy images, no paging). The Pass flips this to
 * 250 ONLY if the Electron render-budget scenario fails, and keeps it only if the paged variant then passes.
 */
export const FEED_PAGE = 250;

/** The width the goldens and tests use when they don't care. */
export const FEED_WIDTH = 1040;

export function buildFeed({
  works, curation, query = '', sort = 'newest', group = 'none', density = 'cozy', favOnly = false, showHidden = false,
  width = FEED_WIDTH, shown = FEED_PAGE, today = '',
} = {}) {
  const base = Array.isArray(works) ? works : [];
  const eff = effectiveWorks(base, curation);
  const hidden = curation && curation.hidden;
  const favorites = curation && curation.favorites;

  let pool = eff;
  if (!showHidden && hidden && typeof hidden === 'object') pool = pool.filter((w) => !isFlagged(hidden, w.id));
  if (favOnly) pool = pool.filter((w) => isFlagged(favorites, w.id));

  const result = runSearch(pool, query);
  const ordered = result.kind === 'color' ? result.works : sortWorks(result.works, sort, today);
  const groups = groupWorks(ordered, group, { today });
  const cap = shown == null ? FEED_PAGE : shown;
  const laid = layoutGroups(groups, { width, density, limit: cap });

  const total = ordered.length;
  return {
    ids: ordered.map((w) => w.id),
    works: ordered,
    cards: laid.cards,
    headers: laid.headers,
    height: laid.height,
    total,
    shown: laid.cards.length,
    remaining: total - laid.cards.length,
    kind: result.kind,
    chip: describeQuery(result),
    reason: total > 0 ? 'none' : emptyReason({ loaded: true, hasHq: true, state: 'ready', rootOk: true, total: base.length, filtered: 0, query, favOnly }),
  };
}

/**
 * Why the Feed has nothing to show, in the order the owner can act on it.
 * @returns {'offline'|'loading'|'error'|'no-root'|'empty-library'|'no-match'|'no-favourites'|'none'}
 *   offline        the bridge to the app's main process is missing (a plain browser tab)
 *   loading        nothing has arrived yet (works is null, no error)
 *   error          the read failed and there is nothing from an earlier read to show
 *   no-root        never indexed (state 'empty'), or the pictures folder is gone and the library holds nothing
 *   empty-library  indexed, and the folder had no pictures (works is [], not null: that is the honest difference)
 *   no-match       works exist, nothing matches the query (also: everything is hidden)
 *   no-favourites  favourites-only with no query and no favourite to show
 *   none           there is something to show
 */
export function emptyReason({ loaded, error, hasHq = true, state, rootOk = true, total, filtered, query = '', favOnly = false } = {}) {
  if (hasHq === false) return 'offline';
  const arrived = loaded === undefined ? total != null : !!loaded;
  if (!arrived) return error || state === 'error' ? 'error' : 'loading';
  if (state === 'empty') return 'no-root';
  if (!(total > 0)) return rootOk === false ? 'no-root' : 'empty-library';
  if (filtered > 0) return 'none';
  return favOnly && !String(query == null ? '' : query).trim() ? 'no-favourites' : 'no-match';
}

const SEP = '\u0001';

/**
 * The memo key. Two halves: what the LAYOUT depends on (revision, width, density, group, shown) and what the RESULT SET
 * depends on (sort, day, query, favourites-only, show-hidden). The memo uses the split to reuse the boxes.
 * The query is trimmed: 'teal ' and 'teal' are one result.
 */
export function feedKey({ width, sort, group, density, query, favOnly, showHidden, shown, revision, today } = {}) {
  const layout = JSON.stringify([revision, width, density, group, shown === Infinity ? 'all' : shown]);
  const result = JSON.stringify([sort, today, String(query == null ? '' : query).trim(), !!favOnly, !!showHidden]);
  return layout + SEP + result;
}

const sameIds = (a, b) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * A small memo for buildFeed. get(key, compute):
 *   hit    the key was computed before and is still held: the SAME feed object comes back, compute is not called;
 *   reuse  a new key whose layout half and result ids equal the previous computation's (a keystroke that narrows nothing,
 *          a sort that lands in the same order): compute ran, but the cards, headers and ids of the previous feed are
 *          kept, so a renderer comparing them by identity does no layout work;
 *   miss   anything else.
 * It holds the last few feeds (the revision is in the key, so a stale one is never hit and is just evicted).
 */
export function createFeedMemo(limit = 6) {
  const held = new Map();
  let last = null; // { layout, feed } of the most recent computation
  const stats = { hits: 0, misses: 0, reuses: 0 };
  return {
    stats,
    get(key, compute) {
      if (held.has(key)) {
        const feed = held.get(key);
        held.delete(key);
        held.set(key, feed); // most recent last
        stats.hits += 1;
        return feed;
      }
      const at = typeof key === 'string' ? key.indexOf(SEP) : -1;
      const layout = at > 0 ? key.slice(0, at) : null;
      let feed = compute();
      if (last && layout !== null && last.layout === layout && feed && last.feed && sameIds(feed.ids, last.feed.ids)) {
        feed = { ...feed, ids: last.feed.ids, works: last.feed.works, cards: last.feed.cards, headers: last.feed.headers };
        stats.reuses += 1;
      } else {
        stats.misses += 1;
      }
      last = { layout, feed };
      held.set(key, feed);
      while (held.size > limit) held.delete(held.keys().next().value);
      return feed;
    },
    clear() {
      held.clear();
      last = null;
    },
  };
}
