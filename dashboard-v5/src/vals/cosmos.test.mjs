// Cosmos render values (vals/cosmos.js): the honest states, the frozen off-the-tab object, the memoised Feed, the
// lightbox, the index overlay and the import report. Plain Node, a rigged `this`, placeholder works only.
//
//   node --test dashboard-v5/src/vals/cosmos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosmosVals, COS_OFF, COS_TEXT } from './cosmos.js';
import { cosmosLogic, cosInitState, COS_STATE_KEYS } from '../logic/cosmos.js';
import { emptyCosmos } from '../live/cosmos-slice.mjs';
import { createFeedMemo } from '../logic/cosmos-view.mjs';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const DAY = 86400000;
const W = (n, extra) => ({
  id: 'w' + n, rel: 'sub/w' + n + '.png', title: ['', 'amber pier', 'blue pier', 'amber hill', 'green hill', 'blue hill'][n] || 'work ' + n, type: 'photo',
  width: 400, height: 300, tags: ['alpha'], createdAt: '2026-0' + (n % 9 + 1) + '-01T00:00:00.000Z', url: 'file:///alpha-site/w' + n + '.png', thumbUrl: 'file:///data/thumbs/w' + n + '.jpg', ...(extra || {}),
});
const WORKS = [W(1), W(2), W(3), W(4, { rel: 'imports:drop-4.png' }), W(5)];
const curation = (extra) => ({ version: 1, clusters: [], favorites: {}, hidden: {}, overrides: {}, ...(extra || {}) });

function slice(o = {}) {
  const c = emptyCosmos();
  return Object.assign(c, { loaded: true, state: 'ready', config: { root: 'alpha-site', indexedAt: new Date(NOW - 2 * DAY).toISOString() }, works: WORKS, curation: curation(), revision: 1 }, o);
}
function rig(o = {}) {
  const calls = [];
  const live = { cosmos: o.cosmos === undefined ? slice() : o.cosmos };
  const self = Object.assign(Object.create(cosmosLogic), {
    state: { tab: 'cosmos', ...cosInitState() }, hq: o.noHq ? null : { cosmos: {} }, store: { refreshCosmos: (f) => calls.push(['refresh', f]) }, LIVE: live,
  });
  for (const m of ['cosOpen', 'cosFavorite', 'cosHide', 'cosStep', 'cosClose', 'cosTrashAsk', 'cosTrashYes', 'cosTrashNo', 'cosIndexOpen', 'cosClear', 'cosToggleFav', 'cosToggleHidden', 'cosMore', 'cosImportLocal', 'cosReplaceAsk', 'cosReplaceYes', 'cosReplaceNo', 'cosReportClose', 'cosIndexCancel', 'cosPick', 'cosIndexStart', 'cosIndexClose', 'cosReveal', 'cosTagRemove']) {
    self[m] = (...a) => { calls.push([m, ...a]); };
  }
  const ctx = (state, extra) => ({ S: { tab: 'cosmos', route: null, ...cosInitState(), ...(state || {}) }, LIVE: live, live: true, tabStyle: (a) => ({ on: a }), today: '2026-11-08', nowMs: NOW, ...(extra || {}) });
  return { self, calls, live, ctx, vals: (state, extra) => cosmosVals.call(self, ctx(state, extra)) };
}

// every value, recursively, must be defined (functions count; undefined never)
function undefinedPaths(v, path = 'v', seen = new Set()) {
  if (v === undefined) return [path];
  if (v === null || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, path + '.' + k, seen));
}
const keysOf = (o) => Object.keys(o).sort();

// ---- off the tab ----------------------------------------------------------------------------------------------------------
test('off the tab (home, no overlay): ONE frozen object, the same reference every call, no layout work, no memo access', () => {
  let gets = 0;
  const spy = { stats: {}, get(key, compute) { gets += 1; return compute(); } };
  const r = rig({ cosmos: slice({ _memo: spy }) });
  const a = r.vals({ tab: 'home' }), b = r.vals({ tab: 'home' }), c = r.vals({ tab: 'projects' });
  assert.equal(a, COS_OFF);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.ok(Object.isFrozen(a));
  assert.equal(gets, 0);
  assert.equal(r.live.cosmos._memo, spy);
  assert.equal(r.calls.length, 0);
  // on a project page of the cosmos tab the Feed is not on screen either
  assert.equal(r.vals({ tab: 'cosmos', route: { type: 'project', id: 'p' } }), COS_OFF);
  assert.equal(gets, 0);
});

test('off the tab, the memo is not even created', () => {
  const r = rig();
  r.vals({ tab: 'home' });
  assert.equal(r.live.cosmos._memo, null);
});

test('a Cosmos overlay still open keeps the values live even when the tab moved', () => {
  const r = rig();
  const v = r.vals({ tab: 'home', cosLb: { id: 'w2', edit: null, trashAsk: false } });
  assert.notEqual(v, COS_OFF);
  assert.equal(v.cosLbOpen, true);
  assert.equal(v.cosOn, false);
  assert.equal(r.vals({ tab: 'home', cosIdx: true }).cosIdxOpen, true);
  assert.equal(r.vals({ tab: 'home', cosReportOpen: true }).cosOn, false);
});

test('the off object is the idle shape: every key defined, handlers are functions, arrays frozen', () => {
  assert.deepEqual(undefinedPaths(COS_OFF), []);
  assert.ok(Object.keys(COS_OFF).length > 100);
  for (const k of Object.keys(COS_OFF)) assert.match(k, /^(cos[A-Z]|cosp$)/, k);   // cosp: the ONE polish key (batch 5)
  assert.equal(COS_OFF.cosOn, false);
  assert.equal(COS_OFF.cosOffline, false);
  assert.equal(COS_OFF.cosLoading, false);
  assert.equal(COS_OFF.cosCards.length, 0);
  assert.ok(Object.isFrozen(COS_OFF.cosCards));
  assert.equal(typeof COS_OFF.cosOnSearch, 'function');
  assert.doesNotThrow(() => COS_OFF.cosOnSearch({ target: { value: 'x' } }));
});

// ---- the contract table: honest states -------------------------------------------------------------------------------------------
const STATES = {
  offline: () => rig({ noHq: true, cosmos: emptyCosmos() }),
  loading: () => rig({ cosmos: emptyCosmos() }),
  errorNoWorks: () => rig({ cosmos: slice({ works: null, error: 'could not read library.json' }) }),
  errorKept: () => rig({ cosmos: slice({ error: 'could not read library.json' }) }),
  noRoot: () => rig({ cosmos: slice({ works: [], state: 'empty', config: { root: null, indexedAt: null } }) }),
  emptyLibrary: () => rig({ cosmos: slice({ works: [] }) }),
  ready: () => rig(),
};

test('every state in the table produces a fully defined key set, the same keys as the off object', () => {
  const want = keysOf(COS_OFF);
  for (const [name, mk] of Object.entries(STATES)) {
    const v = mk().vals();
    assert.deepEqual(undefinedPaths(v), [], name);
    assert.deepEqual(keysOf(v), want, name);
  }
  const r = rig();
  const more = {
    noMatch: r.vals({ cosQuery: 'zzzz' }), noFav: r.vals({ cosFav: true }), lightbox: r.vals({ cosLb: { id: 'w2', edit: 'title', trashAsk: false, draft: 'x' } }),
    gone: r.vals({ cosLb: { id: 'gone', edit: null, trashAsk: false } }), idx: r.vals({ cosIdx: true }), paged: r.vals({ cosShown: 2 }), grouped: r.vals({ cosGroup: 'type' }), color: r.vals({ cosQuery: '#336699' }),
  };
  for (const [name, v] of Object.entries(more)) { assert.deepEqual(undefinedPaths(v), [], name); assert.deepEqual(keysOf(v), want, name); }
  r.live.cosmos.report = { clusters: 1, favorites: 2, hidden: 0, overrides: 0, found: 3, missingIds: ['m1'], missingCount: 1, conflicts: 1, token: 'abcdef0123456789', note: 'n' };
  const rep = r.vals({ cosReportOpen: true, cosReplaceAsk: true });
  assert.deepEqual(undefinedPaths(rep), []);
  assert.deepEqual(keysOf(rep), want);
  r.live.cosmos.indexing = { phase: 'thumbs', done: 1, total: 2 };
  r.live.cosmos.summary = { error: 'x' };
  assert.deepEqual(keysOf(r.vals()), want);
});

test('reasons: hq absent offline, works null loading, error with no works error, state empty no-root, 0 works empty-library', () => {
  assert.equal(STATES.offline().vals().cosReason, 'offline');
  assert.equal(STATES.loading().vals().cosReason, 'loading');
  assert.equal(STATES.errorNoWorks().vals().cosReason, 'error');
  assert.equal(STATES.noRoot().vals().cosReason, 'no-root');
  assert.equal(STATES.emptyLibrary().vals().cosReason, 'empty-library');
  assert.equal(STATES.ready().vals().cosReason, 'none');
  const r = rig();
  assert.equal(r.vals({ cosQuery: 'zzzz' }).cosReason, 'no-match');
  assert.equal(r.vals({ cosFav: true }).cosReason, 'no-favourites');
  assert.equal(r.vals({ cosFav: true, cosQuery: 'zzzz' }).cosReason, 'no-match');
});

test('flags are exclusive per state: offline · loading · error · cards · empty', () => {
  const flags = (v) => ['cosOffline', 'cosLoading', 'cosError', 'cosHasCards', 'cosEmpty'].filter((k) => v[k]);
  assert.deepEqual(flags(STATES.offline().vals()), ['cosOffline']);
  assert.deepEqual(flags(STATES.loading().vals()), ['cosLoading']);
  assert.deepEqual(flags(STATES.errorNoWorks().vals()), ['cosError']);
  assert.deepEqual(flags(STATES.noRoot().vals()), ['cosEmpty']);
  assert.deepEqual(flags(STATES.emptyLibrary().vals()), ['cosEmpty']);
  assert.deepEqual(flags(STATES.ready().vals()), ['cosHasCards']);
  assert.deepEqual(flags(rig().vals({ cosQuery: 'zzzz' })), ['cosEmpty']);
  // an error with a copy on screen keeps the cards and says so
  assert.deepEqual(flags(STATES.errorKept().vals()), ['cosError', 'cosHasCards']);
});

test('honest texts, exactly', () => {
  const off = STATES.offline().vals();
  assert.equal(off.cosOfflineText, "Cosmos needs the desktop app's gallery module. Main process unavailable, read only; nothing here changes your files.");
  assert.equal(off.cosOfflineText, COS_TEXT.offline);
  assert.equal(STATES.loading().vals().cosLoadingText, 'Reading the library...');
  const err = STATES.errorKept().vals();
  assert.equal(err.cosErrorText, 'could not read library.json');
  assert.equal(err.cosErrorKept, true);
  assert.equal(err.cosErrorNote, 'your last good copy is kept');
  const errBare = STATES.errorNoWorks().vals();
  assert.equal(errBare.cosErrorText, 'could not read library.json');
  assert.equal(errBare.cosErrorKept, false);
  assert.equal(errBare.cosErrorNote, '');
  const none = STATES.noRoot().vals();
  assert.equal(none.cosEmptyTitle, 'No library yet');
  assert.equal(none.cosEmptyText, "Choose the folder that holds your pictures and videos. Cosmos reads it in place and only writes inside this app's data folder.");
  assert.equal(none.cosEmptyAction, 'Choose a folder');
  assert.equal(STATES.emptyLibrary().vals().cosEmptyText, 'Indexed alpha-site and found no pictures or videos');
  const r = rig();
  const nm = r.vals({ cosQuery: ' zzzz ' });
  assert.equal(nm.cosEmptyText, 'nothing matches "zzzz"');
  assert.equal(nm.cosEmptyAction, 'Clear search');
  assert.equal(r.vals({ cosFav: true }).cosEmptyText, 'No favourites yet. Star an element to keep it here.');
});

test('the empty-state buttons call the right action', () => {
  const r = rig();
  r.vals({ cosQuery: 'zzzz' }).cosEmptyDo();
  r.vals({ cosFav: true }).cosEmptyDo();
  STATES.noRoot().vals().cosEmptyDo();
  const n = STATES.noRoot();
  n.vals().cosEmptyDo();
  assert.deepEqual(r.calls.map((c) => c[0]), ['cosClear', 'cosToggleFav']);
  assert.deepEqual(n.calls.map((c) => c[0]), ['cosIndexOpen']);
  const e = STATES.errorNoWorks();
  e.vals().cosRetry();
  assert.deepEqual(e.calls, [['refresh', true]]);
});

test('everything hidden is said as such, not as an empty search', () => {
  const r = rig({ cosmos: slice({ curation: curation({ hidden: { w1: true, w2: true, w3: true, w4: true, w5: true } }) }) });
  const v = r.vals();
  assert.equal(v.cosReason, 'no-match');
  assert.equal(v.cosEmptyText, COS_TEXT.allHidden);
  assert.equal(v.cosEmptyAction, 'Show hidden');
  assert.equal(r.vals({ cosShowHidden: true }).cosReason, 'none');
});

// ---- count and paging --------------------------------------------------------------------------------------------------------------
test('count text: "N elements" for everything, "M of N" for a subset, singular for one', () => {
  const r = rig();
  assert.equal(r.vals().cosCount, '5 elements');
  assert.equal(r.vals({ cosQuery: 'pier' }).cosCount, '2 of 5');
  assert.equal(rig({ cosmos: slice({ works: [W(1)] }) }).vals().cosCount, '1 element');
  const big = Array.from({ length: 710 }, (_, i) => W(i + 10));
  assert.equal(rig({ cosmos: slice({ works: big }) }).vals().cosCount, '710 elements');
  assert.equal(rig({ cosmos: slice({ works: big }) }).vals({ cosQuery: 'work 1' }).cosCount.endsWith(' of 710'), true);
  const huge = Array.from({ length: 1234 }, (_, i) => W(i + 10));
  assert.equal(rig({ cosmos: slice({ works: huge }) }).vals().cosCount, '1,234 elements');
  assert.equal(STATES.loading().vals().cosCount, '');
});

test('paging labels: Show N more with N = min(240, remaining), and M left', () => {
  const all = rig().vals();
  assert.equal(all.cosHasMore, false);
  assert.equal(all.cosMoreLabel, '');
  assert.equal(all.cosLeft, '');
  const few = rig().vals({ cosShown: 2 });
  assert.equal(few.cosCards.length, 2);
  assert.equal(few.cosHasMore, true);
  assert.equal(few.cosMoreLabel, 'Show 3 more');
  assert.equal(few.cosLeft, '3 left');
  const big = Array.from({ length: 1000 }, (_, i) => W(i + 10));
  const page = rig({ cosmos: slice({ works: big }) }).vals({ cosShown: 100 });
  assert.equal(page.cosMoreLabel, 'Show 240 more');
  assert.equal(page.cosLeft, '900 left');
  assert.equal(rig({ cosmos: slice({ works: big }) }).vals({ cosShown: 900 }).cosMoreLabel, 'Show 100 more');
  rig().vals({ cosShown: 2 }).cosMore();
});

// ---- banners ---------------------------------------------------------------------------------------------------------------------------
test('stale chip: absent at 14 days, "Last indexed 15 days ago" at 15', () => {
  const at = (days) => rig({ cosmos: slice({ config: { root: 'alpha-site', indexedAt: new Date(NOW - days * DAY).toISOString() } }) }).vals();
  assert.equal(at(14).cosBannerStale, false);
  assert.equal(at(14).cosBannerStaleText, '');
  assert.equal(at(14.9).cosBannerStale, false);
  assert.equal(at(15).cosBannerStale, true);
  assert.equal(at(15).cosBannerStaleText, 'Last indexed 15 days ago');
  assert.equal(at(40).cosBannerStaleText, 'Last indexed 40 days ago');
  assert.equal(rig({ cosmos: slice({ config: { root: 'alpha-site', indexedAt: null } }) }).vals().cosBannerStale, false);
});

test('an unreachable folder says so, with the date of the last index', () => {
  const v = rig({ cosmos: slice({ rootOk: false, config: { root: 'alpha-site', indexedAt: '2026-11-01T08:00:00.000Z' } }) }).vals();
  assert.equal(v.cosBannerRoot, true);
  assert.equal(v.cosBannerRootText, 'The folder is not reachable right now. Showing the last index from Nov 1, 2026; originals may not open.');
  assert.equal(rig().vals().cosBannerRoot, false);
  assert.equal(rig().vals().cosBannerRootText, '');
});

test('indexing banner: phase and counts; the overlay shows the same', () => {
  const r = rig({ cosmos: slice({ indexing: { phase: 'thumbs', done: 412, total: 1000 } }) });
  const v = r.vals({ cosIdx: true });
  assert.equal(v.cosBannerIndexing, true);
  assert.equal(v.cosBannerIndexingText, 'Indexing: thumbnails 412 / 1,000');
  assert.equal(v.cosIdxRunning, true);
  assert.equal(v.cosIdxProgress, 'Indexing: thumbnails 412 / 1,000');
  assert.equal(v.cosIdxStartOff, true);
  assert.equal(rig().vals().cosBannerIndexing, false);
  assert.equal(rig({ cosmos: slice({ indexing: { phase: 'walk', done: 0, total: 0 } }) }).vals().cosBannerIndexingText, 'Indexing: reading the folder');
});

test('a failed index stays visible; a good summary is in the overlay', () => {
  const bad = rig({ cosmos: slice({ summary: { error: 'not saved: disk full', elements: 0 } }) }).vals({ cosIdx: true });
  assert.equal(bad.cosBannerFailed, true);
  assert.equal(bad.cosBannerFailedText, 'The last index stopped: not saved: disk full');
  const ok = rig({ cosmos: slice({ summary: { elements: 1000, thumbs: 998, thumbsFailed: 2, minted: 12, cancelled: false } }) }).vals({ cosIdx: true });
  assert.equal(ok.cosBannerFailed, false);
  assert.equal(ok.cosIdxHasSummary, true);
  assert.equal(ok.cosIdxSummary, 'Last index: 1,000 elements · 2 thumbnails could not be made · 12 new');
});

test('scrubbed note when the time machine is rewound (snapOffset > 0), like Money', () => {
  const r = rig();
  assert.equal(r.vals(null, { live: true }).cosScrubbed, false);
  assert.equal(r.vals(null, { live: false }).cosScrubbed, true);
  assert.equal(STATES.offline().vals(null, { live: false }).cosScrubbed, false);
});

// ---- the cards ---------------------------------------------------------------------------------------------------------------------------------
test('card objects carry id, box, src, alt, video, fav, hidden and the open / favourite / hide handlers', () => {
  const r = rig({ cosmos: slice({ works: [W(1), W(2, { video: true, thumbUrl: null }), W(3)], curation: curation({ favorites: { w3: true }, hidden: { w1: true } }) }) });
  const v = r.vals({ cosShowHidden: true });
  const byId = Object.fromEntries(v.cosCards.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(byId).sort(), ['w1', 'w2', 'w3']);
  const c = byId.w3;
  for (const k of ['id', 'box', 'src', 'alt', 'video', 'fav', 'hidden', 'open', 'favGo', 'hideGo']) assert.ok(k in c, k);
  assert.equal(c.fav, true);
  assert.equal(c.hidden, false);
  assert.equal(c.src, 'file:///data/thumbs/w3.jpg');
  assert.equal(c.alt, 'amber hill');
  assert.equal(c.video, false);
  assert.equal(c.box.position, 'absolute');
  for (const k of ['left', 'top', 'width', 'height']) assert.equal(typeof c.box[k], 'number', k);
  assert.equal(byId.w1.hidden, true);
  assert.equal(byId.w2.video, true);
  assert.equal(byId.w2.src, 'file:///alpha-site/w2.png');   // no thumbnail: the original
  c.open(); c.favGo(); c.hideGo();
  assert.deepEqual(r.calls, [['cosOpen', 'w3'], ['cosFavorite', 'w3'], ['cosHide', 'w3']]);
});

test('hidden elements are not in the Feed unless shown; overrides change the alt text', () => {
  const r = rig({ cosmos: slice({ curation: curation({ hidden: { w5: true }, overrides: { w2: { title: 'harbour' } } }) }) });
  const v = r.vals();
  assert.equal(v.cosCards.length, 4);
  assert.equal(v.cosCards.find((c) => c.id === 'w2').alt, 'harbour');
  assert.equal(r.vals({ cosShowHidden: true }).cosCards.length, 5);
});

test('groups: headers come with the cards and a count', () => {
  const r = rig();
  const v = r.vals({ cosGroup: 'type' });
  assert.equal(v.cosHeaders.length, 1);
  assert.equal(v.cosHeaders[0].count, 5);
  assert.equal(v.cosHeaders[0].countText, '5');
  assert.equal(r.vals().cosHeaders.length, 0);
  assert.equal(v.cosGridStyle.height, v.cosHeight);
  assert.ok(v.cosHeight > 0);
});

test('the sort and group selects hold the current value, and density keeps its chips', () => {
  const v = rig().vals({ cosSort: 'title', cosGroup: 'month', cosDensity: 'roomy' });
  assert.equal(v.cosSorts.value, 'title');
  assert.equal(v.cosGroups.value, 'month');
  assert.deepEqual(v.cosSorts.options.filter((o) => o.selected).map((o) => o.label), ['Title A-Z']);
  assert.deepEqual(v.cosGroups.options.filter((o) => o.selected).map((o) => o.label), ['By month']);
  assert.deepEqual(v.cosDensities.filter((c) => c.on).map((c) => c.label), ['Roomy']);
  assert.equal(v.cosSorts.options.length, 7);
  assert.equal(v.cosGroups.options.length, 5);
  assert.equal(v.cosDensities.length, 3);
});

test('choosing a sort or group option sets state exactly as the chip did (an event or a bare value; a value that is not a mode is ignored)', () => {
  const r = rig();
  const picks = [];
  r.self.cosSetSort = (m) => picks.push(['sort', m]);
  r.self.cosSetGroup = (m) => picks.push(['group', m]);
  const v = r.vals();
  v.cosSorts.onChange({ target: { value: 'title' } });
  v.cosGroups.onChange('month');
  v.cosSorts.onChange({ target: { value: 'not-a-mode' } });
  assert.deepEqual(picks, [['sort', 'title'], ['group', 'month']]);
  assert.equal(v.cosSorts.options[0].value, 'newest');
});

test('search value, chip and handlers', () => {
  const r = rig();
  const v = r.vals({ cosQuery: '#336699' });
  assert.equal(v.cosQueryText, '#336699');
  assert.equal(v.cosHasQuery, true);
  assert.match(v.cosChip, /^colour #336699$/);
  assert.equal(v.cosHasChip, true);
  let got = null;
  r.self.cosSearch = (t) => { got = t; };
  v.cosOnSearch({ target: { value: 'pier' } });
  assert.equal(got, 'pier');
});

test('a drop forwards the dropped files to cosDrop and stops the browser from opening them', () => {
  const r = rig();
  let files = null, prevented = 0;
  r.self.cosDrop = (f) => { files = f; };
  const dt = { files: [1, 2] };
  r.vals().cosOnDrop({ preventDefault() { prevented += 1; }, dataTransfer: dt });
  assert.equal(files, dt.files);
  r.vals().cosOnDragOver({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 2);
  assert.doesNotThrow(() => r.vals().cosOnDrop(undefined));
});

// ---- the Feed memo ----------------------------------------------------------------------------------------------------------------------------------
test('a 1,000-work library builds in ONE buildFeed call; an unchanged render is a memo hit with the same cards', () => {
  const big = Array.from({ length: 1000 }, (_, i) => W(i + 10, { createdAt: '2026-01-' + String(i % 28 + 1).padStart(2, '0') + 'T00:00:00.000Z' }));
  const r = rig({ cosmos: slice({ works: big }) });
  const a = r.vals({ cosShown: 0 });   // 0 = every card (the default pages at FEED_PAGE)
  const memo = r.live.cosmos._memo;
  assert.equal(a.cosCards.length, 1000);
  assert.deepEqual({ ...memo.stats }, { hits: 0, misses: 1, reuses: 0 });
  const b = r.vals({ cosShown: 0 });
  assert.deepEqual({ ...memo.stats }, { hits: 1, misses: 1, reuses: 0 });
  assert.equal(b.cosCards, a.cosCards);
  assert.equal(b.cosHeaders, a.cosHeaders);
  // the same feed is what the lightbox steps through
  r.self.state.cosShown = 0;   // the component's state pages at FEED_PAGE by default; the feed key includes it
  assert.equal(r.self.cosOrder().length, 1000);
  assert.equal(memo.stats.misses, 1);
});

test('a keystroke that narrows nothing reuses the cards (compute runs, layout identity is kept); a new revision recomputes', () => {
  const big = Array.from({ length: 50 }, (_, i) => W(i + 10));
  const r = rig({ cosmos: slice({ works: big }) });
  const a = r.vals({ cosQuery: 'work' });
  const b = r.vals({ cosQuery: 'work ' });   // trimmed: the same key
  assert.equal(r.live.cosmos._memo.stats.hits, 1);
  const c = r.vals({ cosQuery: 'wor' });     // a new key, the same results
  assert.equal(r.live.cosmos._memo.stats.reuses, 1);
  assert.equal(c.cosCards, a.cosCards);
  assert.equal(b.cosCards, a.cosCards);
  r.live.cosmos.revision += 1;
  r.vals({ cosQuery: 'wor' });
  assert.equal(r.live.cosmos._memo.stats.misses, 2);
});

test('the card list is rebuilt when the curation changes, not before', () => {
  const r = rig();
  const a = r.vals();
  assert.equal(r.vals().cosCards, a.cosCards);
  r.live.cosmos.curation = curation({ favorites: { w1: true } });
  r.live.cosmos.revision += 1;
  const b = r.vals();
  assert.notEqual(b.cosCards, a.cosCards);
  assert.equal(b.cosCards.find((c) => c.id === 'w1').fav, true);
});

test('a width the grid measured lays the cards out in that width', () => {
  const r = rig();
  const wide = r.vals({ cosWidth: 1400 }), narrow = r.vals({ cosWidth: 500 });
  assert.notEqual(wide.cosCards[0].box.width, narrow.cosCards[0].box.width);
});

// ---- the lightbox --------------------------------------------------------------------------------------------------------------------------------------
test('lightbox: the open element, its position among the results and the ends', () => {
  const r = rig();
  const mid = r.vals({ cosLb: { id: 'w3', edit: null, trashAsk: false } });
  assert.equal(mid.cosLbOpen, true);
  assert.equal(mid.cosLbId, 'w3');
  assert.equal(mid.cosLbTitle, 'amber hill');
  assert.equal(mid.cosLbIsVideo, false);
  assert.equal(mid.cosLbIsImage, true);
  assert.equal(mid.cosLbSrc, 'file:///alpha-site/w3.png');
  assert.equal(mid.cosLbFallbackSrc, 'file:///data/thumbs/w3.jpg');
  assert.equal(mid.cosLbType, 'Photography');
  assert.equal(mid.cosLbDate, '2026-04-01');
  assert.equal(mid.cosLbPos, '3 / 5');
  assert.equal(mid.cosLbHasPrev, true);
  assert.equal(mid.cosLbHasNext, true);
  assert.equal(mid.cosLbFile, 'sub/w3.png');
  assert.equal(r.vals({ cosLb: { id: 'w5', edit: null, trashAsk: false } }).cosLbHasPrev, false);
  assert.equal(r.vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } }).cosLbHasNext, false);
  mid.cosLbPrev(); mid.cosLbNext(); mid.cosLbClose(); mid.cosLbReveal(); mid.cosLbFavGo(); mid.cosLbHideGo();
  assert.deepEqual(r.calls.map((c) => c[0]), ['cosStep', 'cosStep', 'cosClose', 'cosReveal', 'cosFavorite', 'cosHide']);
  assert.deepEqual([r.calls[0][1], r.calls[1][1]], [-1, 1]);
});

test('lightbox: a video opens its file with the thumbnail as poster', () => {
  const r = rig({ cosmos: slice({ works: [W(1, { video: true })] }) });
  const v = r.vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } });
  assert.equal(v.cosLbIsVideo, true);
  assert.equal(v.cosLbIsImage, false);
  assert.equal(v.cosLbSrc, 'file:///alpha-site/w1.png');
  assert.equal(v.cosLbPoster, 'file:///data/thumbs/w1.jpg');
});

test('lightbox: an approximate size is not shown as a size; a measured one is', () => {
  const approx = rig({ cosmos: slice({ works: [W(1, { approx: true, width: 560, height: 420 })] }) }).vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } });
  assert.equal(approx.cosLbDims, '');
  const real = rig({ cosmos: slice({ works: [W(1)] }) }).vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } });
  assert.equal(real.cosLbDims, '400 × 300');
});

test('lightbox: closed while the library has not arrived or the element is gone', () => {
  assert.equal(STATES.loading().vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } }).cosLbOpen, false);
  assert.equal(rig().vals({ cosLb: { id: 'nope', edit: null, trashAsk: false } }).cosLbOpen, false);
  assert.equal(rig().vals({ cosLb: null }).cosLbOpen, false);
  assert.equal(STATES.offline().vals({ cosLb: { id: 'w1', edit: null, trashAsk: false } }).cosLbOpen, false);
});

test('lightbox: favourite / hidden state, tags and the owner\'s title override', () => {
  const r = rig({ cosmos: slice({ curation: curation({ favorites: { w2: true }, hidden: { w2: true }, overrides: { w2: { title: 'harbour', tags: ['moody', 'wip'] } } }) }) });
  const v = r.vals({ cosLb: { id: 'w2', edit: null, trashAsk: false }, cosShowHidden: true });
  assert.equal(v.cosLbTitle, 'harbour');
  assert.equal(v.cosLbFav, true);
  assert.equal(v.cosLbFavLabel, 'Remove from favourites');
  assert.equal(v.cosLbHidden, true);
  assert.equal(v.cosLbHideLabel, 'Show again');
  assert.deepEqual(v.cosLbTags.map((t) => t.name), ['moody', 'wip']);
  assert.equal(v.cosLbHasTags, true);
  v.cosLbTags[1].remove();
  assert.deepEqual(r.calls.at(-1), ['cosTagRemove', 'wip']);
  const plain = rig().vals({ cosLb: { id: 'w3', edit: null, trashAsk: false } });
  assert.equal(plain.cosLbFavLabel, 'Add to favourites');
  assert.equal(plain.cosLbHideLabel, 'Hide');
});

test('lightbox: editing the title and a tag draft come from the open element\'s own state', () => {
  const r = rig();
  const v = r.vals({ cosLb: { id: 'w2', edit: 'title', trashAsk: false, draft: 'half typed', tagDraft: 'wip, ' } });
  assert.equal(v.cosLbEditing, true);
  assert.equal(v.cosLbTitleText, 'half typed');
  assert.equal(v.cosLbTagText, 'wip, ');
  const idle = r.vals({ cosLb: { id: 'w2', edit: null, trashAsk: false } });
  assert.equal(idle.cosLbEditing, false);
  assert.equal(idle.cosLbTitleText, '');
  let saved = null, drafted = null, tagged = null;
  r.self.cosTitleSave = (t) => { saved = t; }; r.self.cosTitleDraft = (t) => { drafted = t; }; r.self.cosTagAdd = (t) => { tagged = t; };
  const enter = { key: 'Enter', preventDefault() {}, target: { value: 'new' } };
  v.cosLbTitleKey(enter); v.cosLbOnTitle({ target: { value: 'abc' } }); v.cosLbTagKey({ ...enter, target: { value: 'x' } });
  v.cosLbTitleKey({ key: 'a', preventDefault() {}, target: { value: 'ignored' } });
  assert.deepEqual([saved, drafted, tagged], ['new', 'abc', 'x']);
});

test('lightbox trash: offered only for dropped-in elements; the armed state follows cosLb.trashAsk', () => {
  const r = rig();
  const plain = r.vals({ cosLb: { id: 'w3', edit: null, trashAsk: true } });
  assert.equal(plain.cosLbCanTrash, false);
  assert.equal(plain.cosLbTrashAsk, false);
  const imp = r.vals({ cosLb: { id: 'w4', edit: null, trashAsk: false } });
  assert.equal(imp.cosLbCanTrash, true);
  assert.equal(imp.cosLbTrashAsk, false);
  assert.equal(imp.cosLbFile, 'drop-4.png');
  const armed = r.vals({ cosLb: { id: 'w4', edit: null, trashAsk: true } });
  assert.equal(armed.cosLbTrashAsk, true);
  armed.cosLbTrashStart(); armed.cosLbTrashYes(); armed.cosLbTrashNo();
  assert.deepEqual(r.calls.map((c) => c[0]), ['cosTrashAsk', 'cosTrashYes', 'cosTrashNo']);
});

// ---- the index overlay and the report ------------------------------------------------------------------------------------------------------------------
test('index overlay: first time vs saved folder, and when Start is possible', () => {
  const first = rig({ cosmos: slice({ works: [], state: 'empty', config: { root: null, indexedAt: null } }) });
  const a = first.vals({ cosIdx: true });
  assert.equal(a.cosIdxOpen, true);
  assert.equal(a.cosIdxFirst, true);
  assert.equal(a.cosIdxHasFolder, false);
  assert.equal(a.cosIdxStartOff, true);
  const b = first.vals({ cosIdx: true, cosFolder: 'D:/alpha-site' });
  assert.equal(b.cosIdxHasFolder, true);
  assert.equal(b.cosIdxFolder, 'D:/alpha-site');
  assert.equal(b.cosIdxStartOff, false);
  const again = rig().vals({ cosIdx: true, cosFolder: 'alpha-site' });
  assert.equal(again.cosIdxFirst, false);
  assert.equal(again.cosIdxStartOff, false);
  assert.equal(rig().vals({ cosIdx: true, cosFolder: 'alpha-site', cosBusy: true }).cosIdxStartOff, true);
  assert.equal(rig().vals({ cosIdx: false }).cosIdxOpen, false);
});

test('import report: the counts, the missing ids and the Replace steps', () => {
  const report = { clusters: 2, favorites: 3, hidden: 0, overrides: 1, found: 4, missingIds: ['m1', 'm2'], missingCount: 5, conflicts: 2, token: 'abcdef0123456789', note: 'Imported 2 clusters, 3 favourites, 0 hidden, 1 edit.' };
  const r = rig({ cosmos: slice({ report }) });
  assert.equal(r.vals().cosRepOpen, false);   // closed until the owner's flag opens it
  const v = r.vals({ cosReportOpen: true });
  assert.equal(v.cosRepOpen, true);
  assert.equal(v.cosRepNote, report.note);
  assert.deepEqual(v.cosRepLines.map((l) => [l.label, l.value]), [['Clusters', '2'], ['Favourites', '3'], ['Hidden', '0'], ['Edits', '1'], ['Found in the library', '4'], ['Not in the library', '5']]);
  assert.equal(v.cosRepHasMissing, true);
  assert.equal(v.cosRepMissingText, '5 referenced elements are not in the library; showing 2');
  assert.deepEqual(v.cosRepMissing, [{ id: 'm1' }, { id: 'm2' }]);
  assert.equal(v.cosRepConflicts, 2);
  assert.equal(v.cosRepCanReplace, true);
  assert.equal(v.cosRepAsk, false);
  assert.equal(r.vals({ cosReportOpen: true, cosReplaceAsk: true }).cosRepAsk, true);
  v.cosRepReplaceStart(); v.cosRepReplaceYes(); v.cosRepReplaceNo(); v.cosRepClose();
  assert.deepEqual(r.calls.map((c) => c[0]), ['cosReplaceAsk', 'cosReplaceYes', 'cosReplaceNo', 'cosReportClose']);
  // a spent token offers nothing
  r.live.cosmos.report = { ...report, token: null, replaced: true };
  const spent = r.vals({ cosReportOpen: true, cosReplaceAsk: true });
  assert.equal(spent.cosRepCanReplace, false);
  assert.equal(spent.cosRepAsk, false);
  assert.equal(spent.cosRepReplaced, true);
  // no report in the slice: nothing opens even if the flag is set
  r.live.cosmos.report = null;
  assert.equal(r.vals({ cosReportOpen: true }).cosRepOpen, false);
});

test('a report with nothing missing says nothing about missing ids', () => {
  const r = rig({ cosmos: slice({ report: { clusters: 1, favorites: 0, hidden: 0, overrides: 0, found: 1, missingIds: [], missingCount: 0, conflicts: 0, token: null, note: 'ok' } }) });
  const v = r.vals({ cosReportOpen: true });
  assert.equal(v.cosRepHasMissing, false);
  assert.equal(v.cosRepMissingText, '');
  assert.equal(v.cosRepCanReplace, false);
});

// ---- misc ---------------------------------------------------------------------------------------------------------------------------------------------------
test('a state object from before the integrator\'s initState (no cos keys) still renders', () => {
  const r = rig();
  const v = cosmosVals.call(r.self, { S: { tab: 'cosmos', route: null }, LIVE: r.live, live: true, tabStyle: () => ({}) });
  assert.equal(v.cosOn, true);
  assert.equal(v.cosCards.length, 5);
});

test('COS_STATE_KEYS are all read with a default', () => {
  const r = rig();
  const S = { tab: 'cosmos', route: null };
  for (const k of COS_STATE_KEYS) assert.ok(!(k in S));
  assert.doesNotThrow(() => cosmosVals.call(r.self, { S, LIVE: r.live, live: true }));
});

test('the Feed memo can be swapped for a counting one: one get per render on the tab', () => {
  let gets = 0;
  const real = createFeedMemo();
  const r = rig({ cosmos: slice({ _memo: { stats: real.stats, get: (k, c) => { gets += 1; return real.get(k, c); } } }) });
  r.vals(); r.vals();
  assert.equal(gets, 2);
  assert.equal(real.stats.misses, 1);
});

// ---- Cosmos polish (batch 5): failed pictures, the size toggle, the drag outline, phase rows, the fuller report ------------------------
const card = (v, id) => v.cosCards.find((c) => c.id === id);

test('polish: a card whose thumbnail fails shows the original, and one whose pictures both fail shows its title and the words (no image)', () => {
  const r = rig();
  const hits = [];
  r.self.cosImgError = (id) => hits.push(id);
  const fine = card(r.vals(), 'w1');
  assert.equal(fine.src, 'file:///data/thumbs/w1.jpg');
  assert.equal(fine.failed, false);
  assert.equal(fine.failedAttr, null);
  const thumb = card(r.vals({ cosBroken: { w1: 'thumb' } }), 'w1');
  assert.equal(thumb.src, 'file:///alpha-site/w1.png');
  assert.equal(thumb.thumbFailed, true);
  assert.equal(thumb.failed, false);
  const dead = card(r.vals({ cosBroken: { w1: 'failed' } }), 'w1');
  assert.equal(dead.hasSrc, false);
  assert.equal(dead.failed, true);
  assert.equal(dead.failedAttr, 'true');
  assert.equal(dead.failedText, 'could not load');
  assert.equal(dead.title, 'amber pier');   // the card keeps its title
  card(r.vals(), 'w2').onImgError();
  assert.deepEqual(hits, ['w2']);
});

test('polish: the failed-picture map is part of the card cache key (a new map rebuilds the cards, the same map hands back the same array)', () => {
  const r = rig();
  const broken = { w3: 'failed' };
  const a = r.vals({ cosBroken: broken }), b = r.vals({ cosBroken: broken });
  assert.equal(a.cosCards, b.cosCards);
  const c = r.vals({ cosBroken: { w3: 'thumb' } });
  assert.notEqual(c.cosCards, a.cosCards);
  assert.equal(card(c, 'w3').failed, false);
});

test('polish: cosp - the drag outline follows the counter, the size toggle follows the zoom, and there is exactly one new top-level key', () => {
  const r = rig();
  const off = r.vals();
  assert.equal(off.cosp.dragOn, false);
  assert.equal(off.cosp.dragAttr, null);
  assert.equal(off.cosp.dragOutline, 'none');
  const on = r.vals({ cosDrag: 2 });
  assert.equal(on.cosp.dragOn, true);
  assert.equal(on.cosp.dragAttr, 'true');
  assert.match(on.cosp.dragOutline, /dashed/);
  assert.equal(off.cosp.lbSize.mode, 'fit');
  assert.equal(off.cosp.lbSize.label, 'Actual size');
  const actual = r.vals({ cosLbZoom: 'actual' });
  assert.equal(actual.cosp.lbSize.mode, 'actual');
  assert.equal(actual.cosp.lbSize.label, 'Fit');
  assert.equal(actual.cosp.lbSize.overflow, 'auto');
  const sets = [];
  r.self.cosSetZoom = (m) => sets.push(m);
  r.vals().cosp.lbSize.toggle();
  r.vals({ cosLbZoom: 'actual' }).cosp.lbSize.toggle();
  assert.deepEqual(sets, ['actual', 'fit']);
  assert.deepEqual(keysOf(COS_OFF).filter((k) => !/^cos[A-Z]/.test(k)), ['cosp']);
  assert.deepEqual(keysOf(off), keysOf(COS_OFF));
});

test('polish: the lightbox failed-original note shows only for an image whose original failed', () => {
  const r = rig();
  const hits = [];
  r.self.cosLbError = (id) => hits.push(id);
  const ok = r.vals({ cosLb: { id: 'w2', edit: null, trashAsk: false } });
  assert.equal(ok.cosp.lbFailed, false);
  const bad = r.vals({ cosLb: { id: 'w2', edit: null, trashAsk: false }, cosBroken: { 'lb:w2': 'failed' } });
  assert.equal(bad.cosp.lbFailed, true);
  assert.match(bad.cosp.lbFailedText, /^Could not open the original/);
  bad.cosp.onLbError();
  assert.deepEqual(hits, ['w2']);
  assert.equal(r.vals({ cosLb: { id: 'w3', edit: null, trashAsk: false }, cosBroken: { 'lb:w2': 'failed' } }).cosp.lbFailed, false);
});

test('polish: the index overlay lists one row per phase, and no rows when nothing runs', () => {
  assert.deepEqual(rig().vals({ cosIdx: true }).cosp.phases, []);
  assert.equal(rig().vals({ cosIdx: true }).cosp.hasPhases, false);
  const r = rig({ cosmos: slice({ indexing: { phase: 'thumbs', done: 40, total: 100 } }) });
  const v = r.vals({ cosIdx: true });
  assert.equal(v.cosp.hasPhases, true);
  assert.deepEqual(v.cosp.phases.map((p) => [p.id, p.state, p.text]), [['walk', 'done', 'done'], ['thumbs', 'running', '40 / 100'], ['hashes', 'waiting', 'waiting'], ['dupes', 'waiting', 'waiting']]);
  assert.match(v.cosIdxProgress, /^Indexing: thumbnails 40 \/ 100$/);   // the one-line progress is still there
});

test('polish: the import report gains the seeded, re-keyed and skipped lines only when main sent the numbers', () => {
  const base = { clusters: 2, favorites: 3, hidden: 0, overrides: 1, found: 4, missingIds: [], missingCount: 0, conflicts: 0, token: null, note: 'Imported' };
  const plain = rig({ cosmos: slice({ report: base }) }).vals({ cosReportOpen: true });
  assert.equal(plain.cosRepLines.length, 6);
  const full = { ...base, seeded: 12, rekeyed: 3, skippedCount: 2, skipped: [{ id: 'a', reason: 'id-known' }, { id: 'b', reason: 'no-id' }], notMatchedCount: 0, manifest: 'used' };
  const v = rig({ cosmos: slice({ report: full }) }).vals({ cosReportOpen: true });
  const labels = v.cosRepLines.map((l) => l.label);
  for (const l of ['Matched to old ids', 'Re-keyed to the old ids', 'Skipped from the manifest', 'Manifest']) assert.ok(labels.includes(l), l);
  assert.ok(!labels.includes('Not matched'));
  const calm = rig({ cosmos: slice({ report: { ...full, skippedCount: 0, skipped: [] } }) }).vals({ cosReportOpen: true });
  assert.ok(!calm.cosRepLines.map((l) => l.label).includes('Skipped from the manifest'));
});
