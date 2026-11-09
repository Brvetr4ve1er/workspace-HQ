// Cosmos render values (space "cosmos", key 0). Keys are cos-prefixed: one shared namespace with every other surface.
// All library math is in the pure modules (logic/cosmos-view.mjs and its siblings) and arrives here finished through
// cosFeed (logic/cosmos.js, memoised on LIVE.cosmos._memo); this module only shapes it for the templates and binds the
// handlers (logic/cosmos.js). Honest states first: offline / loading / error / no library / empty / no match / no favourites.
//
// Two rules the tests pin:
//  1. EVERY key is always defined (the template never meets undefined) and the key set is the same in every state.
//  2. While the owner is not on the tab (and no Cosmos overlay is open) this returns ONE frozen module-level object: the
//     same reference on every call, no layout work, no memo access. Vals run for every tab on every render.
//
// Optional ctx injections for tests: ctx.today ('2026-11-08'), ctx.nowMs. Without them the clock is read here (and only here).
import { cosFeed, cosWork, cosCanTrash, cosToday, cosInitState, COS_STATE_KEYS, COS_PAGE_STEP, COS_OFFLINE } from '../logic/cosmos.js';
import { emptyReason } from '../logic/cosmos-view.mjs';
import { SORT_MODES, SORT_LABELS, TYPE_LABELS, isFlagged } from '../logic/cosmos-search.mjs';
import { GROUP_MODES, GROUP_LABELS } from '../logic/cosmos-group.mjs';
import { DENSITIES } from '../logic/cosmos-layout.mjs';

export const COS_TEXT = Object.freeze({
  offline: "Cosmos needs the desktop app's gallery module. Main process unavailable, read only; nothing here changes your files.",
  loading: 'Reading the library...',
  noRootTitle: 'No library yet',
  noRootText: "Choose the folder that holds your pictures and videos. Cosmos reads it in place and only writes inside this app's data folder.",
  noFavourites: 'No favourites yet. Star an element to keep it here.',
  keptCopy: 'your last good copy is kept',
  allHidden: 'Every element here is hidden. Show hidden elements to see them.',
});
export const COS_STALE_DAYS = 14;

const NOOP = () => {};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PHASES = { walk: 'reading the folder', thumbs: 'thumbnails', hashes: 'file hashes', dupes: 'duplicates' };

const fmtInt = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const plural = (n, one, many) => fmtInt(n) + ' ' + (n === 1 ? one : many);
// an ISO stamp's calendar day as 'Nov 8, 2026', read from the text itself (no time zone, no locale)
function dayLabel(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m && MONTHS[Number(m[2]) - 1] ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
}
const progressText = (ix) => {
  if (!ix) return '';
  const phase = PHASES[ix.phase] || String(ix.phase || 'working');
  return 'Indexing: ' + phase + (ix.total > 0 ? ' ' + fmtInt(ix.done) + ' / ' + fmtInt(ix.total) : ix.done > 0 ? ' ' + fmtInt(ix.done) : '');
};
const summaryText = (s) => {
  if (!s || typeof s !== 'object') return '';
  if (s.error) return 'The last index stopped: ' + s.error;
  if (s.cancelled) return 'The last index was cancelled. Nothing was changed.';
  const parts = [plural(s.elements || 0, 'element', 'elements')];
  if (s.thumbsFailed > 0) parts.push(plural(s.thumbsFailed, 'thumbnail', 'thumbnails') + ' could not be made');
  if (s.minted > 0) parts.push(fmtInt(s.minted) + ' new');
  return 'Last index: ' + parts.join(' · ');
};

// ---- the blank (idle) shape: every key, neutral values. The frozen "off the tab" object IS this. ----------------------
function blank(fn) {
  return {
    cosOn: false, cosOffline: false, cosLoading: false, cosError: false, cosErrorText: '', cosErrorKept: false, cosErrorNote: '', cosRetry: fn,
    cosReason: 'none', cosHasCards: false, cosEmpty: false, cosEmptyTitle: '', cosEmptyText: '', cosEmptyAction: '', cosEmptyDo: fn,
    cosOfflineText: COS_TEXT.offline, cosLoadingText: COS_TEXT.loading,
    cosCards: Object.freeze([]), cosHeaders: Object.freeze([]), cosHeight: 0, cosGridStyle: Object.freeze({}), cosGridRef: fn,
    cosCount: '', cosChip: '', cosHasChip: false, cosHasMore: false, cosMoreLabel: '', cosLeft: '', cosMore: fn,
    cosQueryText: '', cosHasQuery: false, cosOnSearch: fn, cosClear: fn, cosSorts: Object.freeze([]), cosGroups: Object.freeze([]), cosDensities: Object.freeze([]),
    cosFavOnly: false, cosToggleFav: fn, cosShowHiddenOn: false, cosToggleHidden: fn, cosOnDrop: fn, cosOnDragOver: fn,
    cosBusy: false, cosScrubbed: false, cosIndexBtn: fn, cosImportBtn: fn,
    cosBannerIndexing: false, cosBannerIndexingText: '', cosBannerCancel: fn,
    cosBannerRoot: false, cosBannerRootText: '', cosBannerStale: false, cosBannerStaleText: '', cosBannerFailed: false, cosBannerFailedText: '',
    cosLbOpen: false, cosLbId: '', cosLbTitle: '', cosLbIsVideo: false, cosLbIsImage: false, cosLbSrc: '', cosLbFallbackSrc: '', cosLbPoster: '', cosLbAlt: '',
    cosLbType: '', cosLbDate: '', cosLbDims: '', cosLbFile: '', cosLbPos: '', cosLbHasPrev: false, cosLbHasNext: false, cosLbPrev: fn, cosLbNext: fn, cosLbClose: fn,
    cosLbFav: false, cosLbFavLabel: '', cosLbFavGo: fn, cosLbHidden: false, cosLbHideLabel: '', cosLbHideGo: fn, cosLbReveal: fn,
    cosLbTags: Object.freeze([]), cosLbHasTags: false, cosLbTagText: '', cosLbOnTag: fn, cosLbTagKey: fn, cosLbTagAdd: fn,
    cosLbEditing: false, cosLbEditStart: fn, cosLbTitleText: '', cosLbOnTitle: fn, cosLbTitleKey: fn, cosLbTitleSave: fn, cosLbTitleCancel: fn,
    cosLbCanTrash: false, cosLbTrashAsk: false, cosLbTrashStart: fn, cosLbTrashYes: fn, cosLbTrashNo: fn, cosLbBusy: false,
    cosIdxOpen: false, cosIdxFolder: '', cosIdxHasFolder: false, cosIdxFirst: false, cosIdxPick: fn, cosIdxStart: fn, cosIdxStartOff: true, cosIdxClose: fn,
    cosIdxRunning: false, cosIdxProgress: '', cosIdxCancel: fn, cosIdxHasSummary: false, cosIdxSummary: '', cosIdxImport: fn,
    cosRepOpen: false, cosRepClose: fn, cosRepNote: '', cosRepLines: Object.freeze([]), cosRepHasMissing: false, cosRepMissingText: '', cosRepMissing: Object.freeze([]),
    cosRepConflicts: 0, cosRepCanReplace: false, cosRepReplaced: false, cosRepAsk: false, cosRepReplaceStart: fn, cosRepReplaceYes: fn, cosRepReplaceNo: fn, cosRepBusy: false,
  };
}
/** Returned on every call while the owner is elsewhere: same reference, frozen. */
export const COS_OFF = Object.freeze(blank(NOOP));

// card list per feed: rebuilt only when the cards, the effective works or the curation change (a keystroke that narrows
// nothing, or an unchanged re-render, hands back the very same array)
const cardCache = new WeakMap();   // feed.cards -> { works, curation, feedHeaders, out, headers }

export function cosmosVals(ctx) {
  const { S, LIVE } = ctx;
  const overlay = !!(S.cosLb || S.cosIdx || S.cosReportOpen);
  const onTab = S.tab === 'cosmos' && !S.route;
  if (!onTab && !overlay) return COS_OFF;

  const D = cosInitState();
  const cs = {};
  for (const k of COS_STATE_KEYS) cs[k] = S[k] !== undefined ? S[k] : D[k];
  const hq = this.hq, can = !!(hq && hq.cosmos);
  const C = (LIVE && LIVE.cosmos) || { works: null, error: '', loaded: false, state: null, config: null, curation: null, cleanup: null, rootOk: true, indexing: null, summary: null, report: null, revision: 0 };
  const works = C.works, hasLib = Array.isArray(works);
  const today = ctx.today || cosToday(), nowMs = ctx.nowMs != null ? ctx.nowMs : Date.now();
  const st = this.store;
  const retry = () => { if (st && typeof st.refreshCosmos === 'function') return st.refreshCosmos(true); return undefined; };
  const tabStyle = typeof ctx.tabStyle === 'function' ? ctx.tabStyle : () => ({});
  const chip = (on, go, label) => ({ label, go, on: !!on, pressed: on ? 'true' : 'false', style: Object.assign(tabStyle(!!on), { height: 28, padding: '0 10px', fontSize: 12 }) });

  // ---- the Feed -------------------------------------------------------------------------------------------------
  const feed = hasLib && can ? cosFeed(cs, C, today) : null;
  const reason = emptyReason({
    loaded: hasLib, error: C.error, hasHq: can, state: C.state, rootOk: C.rootOk !== false,
    total: hasLib ? works.length : null, filtered: feed ? feed.total : 0, query: cs.cosQuery, favOnly: cs.cosFav,
  });
  const q = String(cs.cosQuery || '').trim();
  const config = C.config || {};
  const root = typeof config.root === 'string' ? config.root : '';
  const indexing = C.indexing;

  const B = blank(NOOP);
  let cards = B.cosCards, headers = B.cosHeaders;
  if (feed && feed.cards.length) {
    const hit = cardCache.get(feed.cards);
    if (hit && hit.works === feed.works && hit.curation === C.curation && hit.feedHeaders === feed.headers) { cards = hit.out; headers = hit.headers; }
    else {
      const byId = new Map();
      for (const w of feed.works) byId.set(w.id, w);
      const cu = C.curation || {};
      cards = feed.cards.map((c) => {
        const w = byId.get(c.id) || { id: c.id };
        const fav = isFlagged(cu.favorites, c.id), hidden = isFlagged(cu.hidden, c.id);
        return {
          id: c.id, box: c.box, src: w.thumbUrl || w.url || '', hasSrc: !!(w.thumbUrl || w.url), alt: w.title == null ? '' : String(w.title), title: w.title == null ? '' : String(w.title),
          video: !!w.video, fav, hidden, bg: w.color && typeof w.color.hex === 'string' ? w.color.hex : '', type: w.type || '',
          open: () => this.cosOpen(c.id), favGo: () => this.cosFavorite(c.id), hideGo: () => this.cosHide(c.id),
        };
      });
      headers = feed.headers.map((h) => ({ key: h.key, label: h.label, count: h.count, countText: fmtInt(h.count), box: h.box }));
      cardCache.set(feed.cards, { works: feed.works, curation: C.curation, feedHeaders: feed.headers, out: cards, headers });
    }
  }

  const total = feed ? feed.total : 0, all = hasLib ? works.length : 0;
  const count = !feed ? '' : total === all ? plural(total, 'element', 'elements') : fmtInt(total) + ' of ' + fmtInt(all);
  const remaining = feed ? feed.remaining : 0;

  // ---- honest empty states ------------------------------------------------------------------------------------------
  const emptyKinds = ['no-root', 'empty-library', 'no-match', 'no-favourites'];
  let eTitle = '', eText = '', eAction = '', eDo = NOOP;
  if (reason === 'no-root') { eTitle = COS_TEXT.noRootTitle; eText = COS_TEXT.noRootText; eAction = 'Choose a folder'; eDo = () => this.cosIndexOpen(); }
  else if (reason === 'empty-library') { eTitle = 'Nothing to show'; eText = 'Indexed ' + (root || 'the folder') + ' and found no pictures or videos'; eAction = 'Index again'; eDo = () => this.cosIndexOpen(); }
  else if (reason === 'no-favourites') { eTitle = 'No favourites'; eText = COS_TEXT.noFavourites; eAction = 'Show everything'; eDo = () => this.cosToggleFav(); }
  else if (reason === 'no-match') {
    eTitle = 'No results';
    if (q) { eText = 'nothing matches "' + q + '"'; eAction = 'Clear search'; eDo = () => this.cosClear(); }
    else if (!cs.cosShowHidden) { eText = COS_TEXT.allHidden; eAction = 'Show hidden'; eDo = () => this.cosToggleHidden(); }
    else { eText = 'Nothing to show with these filters'; eAction = 'Show everything'; eDo = () => this.cosToggleFav(); }
  }

  // ---- banners ------------------------------------------------------------------------------------------------
  const days = config.indexedAt ? Math.floor((nowMs - Date.parse(config.indexedAt)) / 86400000) : NaN;
  const stale = hasLib && Number.isFinite(days) && days > COS_STALE_DAYS;
  const rootDown = can && hasLib && C.rootOk === false;
  const when = dayLabel(config.indexedAt);
  const failed = !!(C.summary && C.summary.error);
  const busy = !!cs.cosBusy;

  // ---- the lightbox ---------------------------------------------------------------------------------------------------
  const lb = cs.cosLb;
  const w = lb && can && hasLib ? cosWork(C, lb.id) : null;
  let lbv = {};
  if (w) {
    const cu = C.curation || {};
    const order = feed ? feed.ids : [];
    const at = order.indexOf(w.id);
    const fav = isFlagged(cu.favorites, w.id), hidden = isFlagged(cu.hidden, w.id);
    const editing = lb.edit === 'title';
    const dims = !w.approx && w.width > 0 && w.height > 0 ? w.width + ' × ' + w.height : '';
    const tags = Array.isArray(w.tags) ? w.tags : [];
    const rel = typeof w.rel === 'string' ? w.rel : '';
    lbv = {
      cosLbOpen: true, cosLbId: w.id, cosLbTitle: w.title == null ? '' : String(w.title), cosLbIsVideo: !!w.video, cosLbIsImage: !w.video,
      cosLbSrc: (w.video ? w.url : w.url || w.thumbUrl) || '', cosLbFallbackSrc: w.thumbUrl || '', cosLbPoster: w.video && w.thumbUrl ? w.thumbUrl : '', cosLbAlt: w.title == null ? '' : String(w.title),
      cosLbType: TYPE_LABELS[w.type] || String(w.type || ''), cosLbDate: typeof w.createdAt === 'string' ? w.createdAt.slice(0, 10) : '', cosLbDims: dims,
      cosLbFile: rel.startsWith('imports:') ? rel.slice('imports:'.length) : rel, cosLbPos: at >= 0 ? fmtInt(at + 1) + ' / ' + fmtInt(order.length) : '',
      cosLbHasPrev: at > 0, cosLbHasNext: at >= 0 && at < order.length - 1, cosLbPrev: () => this.cosStep(-1), cosLbNext: () => this.cosStep(1), cosLbClose: () => this.cosClose(),
      cosLbFav: fav, cosLbFavLabel: fav ? 'Remove from favourites' : 'Add to favourites', cosLbFavGo: () => this.cosFavorite(w.id),
      cosLbHidden: hidden, cosLbHideLabel: hidden ? 'Show again' : 'Hide', cosLbHideGo: () => this.cosHide(w.id), cosLbReveal: () => this.cosReveal(w.id),
      cosLbTags: tags.map((t) => ({ name: t, remove: () => this.cosTagRemove(t) })), cosLbHasTags: tags.length > 0,
      cosLbTagText: lb.tagDraft == null ? '' : String(lb.tagDraft), cosLbOnTag: (e) => this.cosTagDraft(e.target.value),
      cosLbTagKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.cosTagAdd(e.target.value); } }, cosLbTagAdd: () => this.cosTagAdd(),
      cosLbEditing: editing, cosLbEditStart: () => this.cosTitleEdit(), cosLbTitleText: editing ? String(lb.draft == null ? '' : lb.draft) : '',
      cosLbOnTitle: (e) => this.cosTitleDraft(e.target.value), cosLbTitleKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.cosTitleSave(e.target.value); } },
      cosLbTitleSave: () => this.cosTitleSave(), cosLbTitleCancel: () => this.cosTitleCancel(),
      cosLbCanTrash: cosCanTrash(w), cosLbTrashAsk: cosCanTrash(w) && !!lb.trashAsk, cosLbTrashStart: () => this.cosTrashAsk(), cosLbTrashYes: () => this.cosTrashYes(), cosLbTrashNo: () => this.cosTrashNo(), cosLbBusy: busy,
    };
  }

  // ---- the index overlay ----------------------------------------------------------------------------------------------
  const folder = String(cs.cosFolder || '');
  const idx = {
    cosIdxOpen: !!cs.cosIdx && can, cosIdxFolder: folder, cosIdxHasFolder: !!folder, cosIdxFirst: !root, cosIdxPick: () => this.cosPick(), cosIdxStart: () => this.cosIndexStart(),
    cosIdxStartOff: busy || !!indexing || !(folder || root), cosIdxClose: () => this.cosIndexClose(),
    cosIdxRunning: !!indexing, cosIdxProgress: progressText(indexing), cosIdxCancel: () => this.cosIndexCancel(),
    cosIdxHasSummary: !!C.summary, cosIdxSummary: summaryText(C.summary), cosIdxImport: () => this.cosImportLocal(),
  };

  // ---- the import report -----------------------------------------------------------------------------------------------
  const rep = C.report && typeof C.report === 'object' ? C.report : null;
  let repv = {};
  if (rep && cs.cosReportOpen) {
    const missing = Array.isArray(rep.missingIds) ? rep.missingIds : [];
    const missingCount = Number.isFinite(rep.missingCount) ? rep.missingCount : missing.length;
    const canReplace = !!rep.token && rep.conflicts > 0 && !rep.replaced;
    const line = (label, n) => ({ label, value: fmtInt(n) });
    repv = {
      cosRepOpen: true, cosRepClose: () => this.cosReportClose(), cosRepNote: typeof rep.note === 'string' ? rep.note : '',
      cosRepLines: [line('Clusters', rep.clusters || 0), line('Favourites', rep.favorites || 0), line('Hidden', rep.hidden || 0), line('Edits', rep.overrides || 0), line('Found in the library', rep.found || 0), line('Not in the library', missingCount)],
      cosRepHasMissing: missingCount > 0, cosRepMissingText: missingCount > 0 ? plural(missingCount, 'referenced element is', 'referenced elements are') + ' not in the library' + (missing.length < missingCount ? '; showing ' + missing.length : '') : '',
      cosRepMissing: missing.slice(0, 20).map((id) => ({ id: String(id) })),
      cosRepConflicts: rep.conflicts || 0, cosRepCanReplace: canReplace, cosRepReplaced: !!rep.replaced, cosRepAsk: canReplace && !!cs.cosReplaceAsk,
      cosRepReplaceStart: () => this.cosReplaceAsk(), cosRepReplaceYes: () => this.cosReplaceYes(), cosRepReplaceNo: () => this.cosReplaceNo(), cosRepBusy: busy,
    };
  }

  const out = Object.assign(B, {
    cosOn: onTab, cosOffline: !can, cosLoading: can && reason === 'loading', cosError: can && !!C.error, cosErrorText: can ? String(C.error || '') : '',
    cosErrorKept: can && !!C.error && hasLib, cosErrorNote: can && C.error && hasLib ? COS_TEXT.keptCopy : '', cosRetry: retry,
    cosReason: reason, cosHasCards: cards.length > 0, cosEmpty: emptyKinds.includes(reason), cosEmptyTitle: eTitle, cosEmptyText: eText, cosEmptyAction: eAction, cosEmptyDo: eDo,
    cosCards: cards, cosHeaders: headers, cosHeight: feed ? feed.height : 0, cosGridStyle: { position: 'relative', height: feed ? feed.height : 0 }, cosGridRef: typeof this.cosGridRef === 'function' ? this.cosGridRef() : NOOP,
    cosCount: count, cosChip: feed ? feed.chip : '', cosHasChip: !!(feed && feed.chip), cosHasMore: remaining > 0,
    cosMoreLabel: remaining > 0 ? 'Show ' + fmtInt(Math.min(COS_PAGE_STEP, remaining)) + ' more' : '', cosLeft: remaining > 0 ? fmtInt(remaining) + ' left' : '', cosMore: () => this.cosMore(),
    cosQueryText: String(cs.cosQuery || ''), cosHasQuery: q !== '', cosOnSearch: (e) => this.cosSearch(e.target.value), cosClear: () => this.cosClear(),
    cosSorts: SORT_MODES.map((m) => chip(cs.cosSort === m, () => this.cosSetSort(m), SORT_LABELS[m])),
    cosGroups: GROUP_MODES.map((m) => chip(cs.cosGroup === m, () => this.cosSetGroup(m), GROUP_LABELS[m])),
    cosDensities: DENSITIES.map((m) => chip(cs.cosDensity === m, () => this.cosSetDensity(m), m[0].toUpperCase() + m.slice(1))),
    cosFavOnly: !!cs.cosFav, cosToggleFav: () => this.cosToggleFav(), cosShowHiddenOn: !!cs.cosShowHidden, cosToggleHidden: () => this.cosToggleHidden(),
    cosOnDrop: (e) => { if (e && e.preventDefault) e.preventDefault(); return this.cosDrop(e && e.dataTransfer && e.dataTransfer.files); },
    cosOnDragOver: (e) => { if (e && e.preventDefault) e.preventDefault(); },
    cosBusy: busy, cosScrubbed: !ctx.live && can, cosIndexBtn: () => this.cosIndexOpen(), cosImportBtn: () => this.cosImportLocal(),
    cosBannerIndexing: can && !!indexing, cosBannerIndexingText: progressText(indexing), cosBannerCancel: () => this.cosIndexCancel(),
    cosBannerRoot: rootDown, cosBannerRootText: rootDown ? 'The folder is not reachable right now. Showing the last index' + (when ? ' from ' + when : '') + '; originals may not open.' : '',
    cosBannerStale: stale, cosBannerStaleText: stale ? 'Last indexed ' + days + ' days ago' : '',
    cosBannerFailed: can && failed, cosBannerFailedText: failed ? summaryText(C.summary) : '',
  }, lbv, idx, repv);
  return out;
}
