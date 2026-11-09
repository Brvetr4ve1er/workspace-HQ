// node --test dashboard-v5/src/selftest-cosmos.test.mjs
// The Cosmos selftest states: unique cosmos- names, one sub, the 1,000-work library in at most four rows, every cos* key a real
// state key, and each row really lands in the state its name promises (checked with the same pure code the Feed runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeCosmos } from '../tools/cosmos-fixture.mjs';
import { cosmosStates, subsetLibrary, COSMOS_OFFLINE_ROWS, COSMOS_SCRUBBED_ROWS, SUBSET_SIZE } from './selftest-cosmos.mjs';
import { emptyReason, buildFeed } from './logic/cosmos-view.mjs';

const LIB = fakeCosmos();
const ROWS = cosmosStates(LIB);
const NAMES = ROWS.map((r) => r[0]);
const by = (name) => { const r = ROWS.find((x) => x[0] === name); assert.ok(r, name + ' is a row'); return r; };

// the 25 states the dish names (a 26th, cosmos-index-first, covers the overlay before any root exists)
const REQUIRED = ['cosmos-offline', 'cosmos-loading', 'cosmos-error', 'cosmos-error-with-library', 'cosmos-no-root', 'cosmos-empty-library', 'cosmos-no-match', 'cosmos-no-favourites',
  'cosmos-ready', 'cosmos-ready-grouped-type', 'cosmos-ready-paged', 'cosmos-ready-roomy', 'cosmos-stale', 'cosmos-root-missing', 'cosmos-indexing', 'cosmos-index-overlay', 'cosmos-index-done',
  'cosmos-lightbox-image', 'cosmos-lightbox-video', 'cosmos-lightbox-edit-title', 'cosmos-lightbox-trash-ask', 'cosmos-report', 'cosmos-report-conflicts', 'cosmos-report-replace-ask', 'cosmos-scrubbed'];

test('state names are unique, prefixed cosmos-, and include every named state', () => {
  assert.equal(new Set(NAMES).size, NAMES.length);
  for (const n of NAMES) assert.match(n, /^cosmos-[a-z0-9-]+$/, n);
  for (const n of REQUIRED) assert.ok(NAMES.includes(n), 'missing ' + n);
  assert.ok(ROWS.length <= 30, 'rows ' + ROWS.length + ': each runs in both themes under a 180 s selftest');
});

test('every row has the Money shape and the feed sub', () => {
  for (const r of ROWS) {
    assert.equal(r.length, 5, r[0]);
    assert.equal(r[1], 'feed', r[0] + ' sub');
    assert.ok(r[2] && typeof r[2] === 'object', r[0] + ' live');
    assert.ok(r[3] && typeof r[3] === 'object' && !Array.isArray(r[3]), r[0] + ' cosState');
    assert.ok(r[4] && typeof r[4] === 'object', r[0] + ' extra');
  }
});

test('the 1,000-work library is used by at most 4 rows; the rest run on a small subset', () => {
  const bigRows = ROWS.filter((r) => Array.isArray(r[2].works) && r[2].works.length > SUBSET_SIZE);
  assert.ok(bigRows.length >= 1 && bigRows.length <= 4, 'big rows ' + bigRows.map((r) => r[0]).join(', '));
  for (const r of bigRows) assert.equal(r[2].works.length, 1000, r[0]);
  for (const r of ROWS) if (!bigRows.includes(r)) assert.ok(!Array.isArray(r[2].works) || r[2].works.length <= SUBSET_SIZE, r[0] + ' stays small');
  assert.deepEqual(bigRows.map((r) => r[0]), ['cosmos-ready', 'cosmos-ready-grouped-type', 'cosmos-ready-paged']);
});

test('each row gets its own slice (its own memo), never a shared object', () => {
  const lives = ROWS.map((r) => r[2]);
  assert.equal(new Set(lives).size, lives.length);
  for (const l of lives) assert.equal(l._memo, null);
  assert.deepEqual(cosmosStates(LIB).map((r) => r[0]), NAMES, 'deterministic');
});

test('every cos* state key a row sets is in COS_STATE_KEYS (skips LOUDLY if the logic file is missing)', async (t) => {
  let mod;
  try { mod = await import('./logic/cosmos.js'); } catch (e) {
    const msg = 'SKIPPED LOUDLY (selftest-cosmos): dashboard-v5/src/logic/cosmos.js is not importable yet (' + (e && e.code ? e.code : e) + ') - COS_STATE_KEYS cannot be checked';
    process.stderr.write('\n' + msg + '\n');
    return t.skip(msg);
  }
  const { COS_STATE_KEYS, cosInitState } = mod;
  assert.ok(Array.isArray(COS_STATE_KEYS) && COS_STATE_KEYS.length > 5, 'COS_STATE_KEYS is exported');
  const used = new Set();
  for (const r of ROWS) for (const k of Object.keys(r[3])) { assert.ok(COS_STATE_KEYS.includes(k), r[0] + ' sets ' + k + ' which is not a state key'); used.add(k); }
  for (const k of ['cosQuery', 'cosFav', 'cosGroup', 'cosShown', 'cosDensity', 'cosLb', 'cosIdx', 'cosFolder', 'cosReportOpen', 'cosReplaceAsk']) assert.ok(used.has(k), 'no row exercises ' + k);
  // a row's cos state starts from the defaults (the loop spreads cosInitState() first), so the lightbox ids and the other keys are real
  const d = cosInitState();
  for (const r of ROWS) for (const k of Object.keys(r[3])) assert.ok(k in d, k);
});

test('extra is only ever snapOffset, and only the scrubbed row has it', () => {
  for (const r of ROWS) {
    const keys = Object.keys(r[4]);
    if (COSMOS_SCRUBBED_ROWS.includes(r[0])) assert.deepEqual(keys, ['snapOffset']);
    else assert.deepEqual(keys, [], r[0]);
  }
  assert.deepEqual(COSMOS_OFFLINE_ROWS, ['cosmos-offline']);
});

// what the Feed would make of a row, with the same pure functions the renderer uses
function feedOf(name) {
  const [, , C, cs] = by(name);
  const S = { cosQuery: '', cosSort: 'newest', cosGroup: 'none', cosDensity: 'cozy', cosFav: false, cosShowHidden: false, cosShown: 0, cosWidth: 1040, ...cs };
  const feed = Array.isArray(C.works) ? buildFeed({ works: C.works, curation: C.curation, query: S.cosQuery, sort: S.cosSort, group: S.cosGroup, density: S.cosDensity, favOnly: S.cosFav, showHidden: S.cosShowHidden, width: S.cosWidth, shown: S.cosShown > 0 ? S.cosShown : Infinity, today: '2026-11-08' }) : null;
  const reason = emptyReason({ loaded: Array.isArray(C.works), error: C.error, hasHq: true, state: C.state, rootOk: C.rootOk !== false, total: Array.isArray(C.works) ? C.works.length : null, filtered: feed ? feed.total : 0, query: S.cosQuery, favOnly: S.cosFav });
  return { C, S, feed, reason };
}

test('the honest empty states land in the reason their name says', () => {
  assert.equal(feedOf('cosmos-loading').reason, 'loading');
  assert.equal(feedOf('cosmos-offline').reason, 'loading', 'offline hides hq.cosmos in the loop; the slice itself is unloaded');
  assert.equal(feedOf('cosmos-error').reason, 'error');
  assert.equal(feedOf('cosmos-no-root').reason, 'no-root');
  assert.equal(feedOf('cosmos-empty-library').reason, 'empty-library');
  assert.equal(feedOf('cosmos-no-match').reason, 'no-match');
  assert.equal(feedOf('cosmos-no-favourites').reason, 'no-favourites');
  assert.equal(feedOf('cosmos-no-match').feed.total, 0);
  assert.ok(feedOf('cosmos-error-with-library').feed.total > 0, 'the error keeps the library on screen');
  assert.ok(feedOf('cosmos-error-with-library').C.error);
  assert.equal(feedOf('cosmos-error').C.works, null);
});

test('the ready states show what their name says', () => {
  const ready = feedOf('cosmos-ready');
  assert.equal(ready.feed.total, 985, '1,000 works minus 15 hidden');
  assert.equal(ready.reason, 'none');
  assert.ok(ready.feed.headers.length === 0);
  const grouped = feedOf('cosmos-ready-grouped-type');
  assert.equal(grouped.feed.headers.length, 8, 'one header per type');
  const paged = feedOf('cosmos-ready-paged');
  assert.equal(paged.feed.shown, 240);
  assert.equal(paged.feed.remaining, 985 - 240);
  assert.ok(feedOf('cosmos-ready-roomy').feed.total > 0);
  const stale = feedOf('cosmos-stale').C;
  assert.ok(Date.parse(stale.config.indexedAt) < Date.parse('2026-10-01'), 'old enough to be stale on any run date');
  assert.equal(feedOf('cosmos-root-missing').C.rootOk, false);
  assert.ok(feedOf('cosmos-root-missing').feed.total > 0);
});

test('indexing and report rows carry what the overlays read', () => {
  assert.deepEqual(Object.keys(by('cosmos-indexing')[2].indexing).sort(), ['done', 'phase', 'total']);
  const ov = by('cosmos-index-overlay');
  assert.equal(ov[3].cosIdx, true); assert.ok(ov[3].cosFolder); assert.ok(ov[2].indexing);
  const first = by('cosmos-index-first');
  assert.equal(first[2].config.root, null); assert.equal(first[3].cosIdx, true);
  const done = by('cosmos-index-done');
  assert.equal(done[2].indexing, null); assert.ok(done[2].summary && done[2].summary.elements > 0); assert.equal(done[3].cosIdx, true);
  for (const n of ['cosmos-report', 'cosmos-report-conflicts', 'cosmos-report-replace-ask']) {
    const r = by(n);
    assert.equal(r[3].cosReportOpen, true, n);
    assert.ok(r[2].report && r[2].report.found > 0 && Array.isArray(r[2].report.missingIds), n);
  }
  assert.equal(by('cosmos-report')[2].report.conflicts, 0);
  assert.equal(by('cosmos-report')[2].report.token, null);
  for (const n of ['cosmos-report-conflicts', 'cosmos-report-replace-ask']) { assert.ok(by(n)[2].report.conflicts > 0); assert.ok(by(n)[2].report.token); }
  assert.equal(by('cosmos-report-conflicts')[3].cosReplaceAsk, undefined);
  assert.equal(by('cosmos-report-replace-ask')[3].cosReplaceAsk, true);
});

test('the lightbox rows open an element of the right kind', async () => {
  const find = (name) => { const [, , C, cs] = by(name); const w = C.works.find((x) => x.id === cs.cosLb.id); assert.ok(w, name + ': the open element is in the library'); return { w, lb: cs.cosLb }; };
  const img = find('cosmos-lightbox-image');
  assert.equal(img.w.video, false); assert.ok(img.w.thumbUrl); assert.equal(img.lb.edit, null); assert.equal(img.lb.trashAsk, false);
  assert.equal(find('cosmos-lightbox-video').w.video, true);
  const ed = find('cosmos-lightbox-edit-title');
  assert.equal(ed.lb.edit, 'title'); assert.equal(ed.lb.draft, ed.w.title);
  const tr = find('cosmos-lightbox-trash-ask');
  assert.ok(tr.w.rel.startsWith('imports:'), 'only a dropped-in file can be armed for the Recycle Bin');
  assert.equal(tr.lb.trashAsk, true);
  // and the logic's own gate agrees (when the logic file is there)
  try { const { cosCanTrash, cosWork } = await import('./logic/cosmos.js'); assert.equal(cosCanTrash(cosWork(by('cosmos-lightbox-trash-ask')[2], tr.w.id)), true); } catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND') return; throw e; }
});

test('subsetLibrary: 60 works in order, odd cases kept, every reference still resolves', () => {
  const s = subsetLibrary(LIB, 60);
  assert.equal(s.works.length, 60);
  const ids = new Set(s.works.map((w) => w.id));
  const order = LIB.works.filter((w) => ids.has(w.id)).map((w) => w.id);
  assert.deepEqual(s.works.map((w) => w.id), order, 'original order');
  assert.ok(s.works.some((w) => w.rel.startsWith('imports:')) && s.works.some((w) => w.approx) && s.works.some((w) => w.video));
  assert.ok(s.works.some((w) => w.title.length >= 200) && s.works.some((w) => w.title.includes('"')));
  for (const k of [...Object.keys(s.curation.favorites), ...Object.keys(s.curation.hidden), ...Object.keys(s.curation.overrides)]) assert.ok(ids.has(k), k);
  assert.ok(Object.keys(s.curation.favorites).length >= 1 && Object.keys(s.curation.hidden).length >= 1 && Object.keys(s.curation.overrides).length >= 1);
  for (const c of s.curation.clusters) for (const id of c.elementIds) assert.ok(ids.has(id), id);
  assert.equal(s.curation.clusters.length, 3);
  for (const g of [...s.dupes.exact, ...s.dupes.near]) for (const id of g.ids) assert.ok(ids.has(id), id);
  for (const j of s.dupes.junk) assert.ok(ids.has(j.id));
  assert.notEqual(LIB.works.length, s.works.length);
  assert.equal(LIB.works.length, 1000, 'the input is untouched');
  assert.equal(subsetLibrary(s, 60), s, 'already small: returned as is');
});
