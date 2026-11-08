// Cosmos Feed pipeline, empty-state reasons and the memo. Invented library only: the repo is public.
//   node --test dashboard-v5/src/logic/cosmos-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFeed, emptyReason, createFeedMemo, feedKey, FEED_PAGE, FEED_WIDTH } from './cosmos-view.mjs';
import { runSearch } from './cosmos-search.mjs';
import { hexToRgb, toColorSig } from './cosmos-color.mjs';

const TYPES = ['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc'];
const HEXES = ['#1a6b52', '#e03020', '#8a8a8a', '#2050c0', '#f0c030', '#7a30a0'];
const library = (n) => Array.from({ length: n }, (_, i) => {
  const { r, g, b } = hexToRgb(HEXES[i % HEXES.length]);
  return {
    id: `w${i}`, title: `Piece ${i}`, type: TYPES[i % TYPES.length], rel: `alpha-site/p${i}.png`,
    width: 300 + (i * 31) % 500, height: 300 + (i * 47) % 500,
    color: toColorSig(Math.max(0, r - (i % 7)), g, b),
    tags: i % 10 === 0 ? ['wip', 'poster'] : i % 3 === 0 ? ['poster'] : [],
    createdAt: `2026-${String(1 + (i % 11)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
  };
});
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const cur = (o = {}) => ({ clusters: [], favorites: {}, hidden: {}, overrides: {}, ...o });

test('FEED_PAGE is Infinity by default and FEED_WIDTH is the golden width', () => {
  assert.equal(FEED_PAGE, Infinity);
  assert.equal(FEED_WIDTH, 1040);
});

test('the pipeline order: hidden never appears unless showHidden; favourites-only then the query', () => {
  const works = library(60);
  const curation = cur({ hidden: { w0: true, w1: true }, favorites: { w0: true, w2: true, w3: true, w10: true } });
  const plain = buildFeed({ works, curation, sort: 'title' });
  assert.equal(plain.total, 58);
  assert.ok(!plain.ids.includes('w0') && !plain.ids.includes('w1'));
  const shownHidden = buildFeed({ works, curation, showHidden: true });
  assert.equal(shownHidden.total, 60);
  assert.ok(shownHidden.ids.includes('w0'));
  // favourites only: w0 is a hidden favourite, so it is gone; w2, w3, w10 stay
  const favs = buildFeed({ works, curation, favOnly: true, sort: 'title' });
  assert.deepEqual([...favs.ids].sort(), ['w10', 'w2', 'w3']);
  const favsAndHidden = buildFeed({ works, curation, favOnly: true, showHidden: true });
  assert.deepEqual([...favsAndHidden.ids].sort(), ['w0', 'w10', 'w2', 'w3']);
  // favourites first, THEN the query: 'tag:poster' among the favourites only
  const q = buildFeed({ works, curation, favOnly: true, query: 'tag:poster' });
  assert.deepEqual([...q.ids].sort(), ['w10', 'w3']);
  assert.equal(q.kind, 'tag');
  assert.equal(q.chip, 'tag poster');
  // the query sees the effective record (override tag)
  const over = buildFeed({ works, curation: cur({ overrides: { w5: { tags: ['Zebra'] } } }), query: 'tag:zebra' });
  assert.deepEqual(over.ids, ['w5']);
  assert.equal(over.works[0].tags[0], 'zebra');
});

test('a colour query keeps nearest-first order whatever the sort is; other queries obey the sort', () => {
  const works = library(120);
  const base = runSearch(works, '#1a6b52').works.map((w) => w.id);
  for (const sort of ['newest', 'oldest', 'title', 'hue', 'brightness', 'saturation', 'random']) {
    const f = buildFeed({ works, curation: cur(), query: '#1a6b52', sort, today: '2026-11-08' });
    assert.deepEqual(f.ids, base, sort);
    assert.equal(f.kind, 'color');
    assert.equal(f.chip, 'colour #1a6b52');
  }
  assert.ok(base.length <= 80);
  const byTitle = buildFeed({ works, curation: cur(), query: 'poster', sort: 'title' });
  const titles = byTitle.works.map((w) => w.title.toLowerCase());
  assert.deepEqual(titles, [...titles].sort());
});

test('paging: shown=240 gives 240 cards, remaining is the rest, and ids still lists everything', () => {
  const works = library(1000);
  const all = buildFeed({ works, curation: cur() });
  assert.equal(all.total, 1000);
  assert.equal(all.cards.length, 1000);
  assert.equal(all.remaining, 0);
  assert.equal(all.shown, 1000);
  const page = buildFeed({ works, curation: cur(), shown: 240 });
  assert.equal(page.cards.length, 240);
  assert.equal(page.shown, 240);
  assert.equal(page.remaining, 760);
  assert.equal(page.ids.length, 1000);
  assert.deepEqual(page.ids, all.ids);
  assert.deepEqual(page.cards.map((c) => c.id), all.ids.slice(0, 240));
  assert.deepEqual(page.cards, all.cards.slice(0, 240), 'a page is a prefix of the full layout');
  assert.ok(page.height < all.height);
  const zero = buildFeed({ works, curation: cur(), shown: 0 });
  assert.deepEqual([zero.cards.length, zero.remaining, zero.ids.length], [0, 1000, 1000]);
});

test('grouping lays out headers with full counts and cards under them', () => {
  const works = library(40);
  const f = buildFeed({ works, curation: cur(), group: 'type', sort: 'title' });
  assert.equal(f.headers.length, 8);
  assert.equal(f.headers.reduce((n, h) => n + h.count, 0), 40);
  assert.equal(f.cards.length, 40);
  assert.equal(f.headers[0].label, '3D & Render');
  const byId = new Map(f.works.map((w) => [w.id, w]));
  assert.equal(byId.get(f.cards[0].id).type, '3d', 'the first card sits in the first group');
  const flat = buildFeed({ works, curation: cur(), group: 'none' });
  assert.equal(flat.headers.length, 0);
});

test('buildFeed is deterministic across calls and mutates nothing (frozen inputs)', () => {
  const works = deepFreeze(library(200));
  const curation = deepFreeze(cur({ hidden: { w4: true }, favorites: { w5: true }, overrides: { w6: { title: 'Renamed', tags: ['x'] } } }));
  const args = { works, curation, query: 'piece', sort: 'random', group: 'month', density: 'roomy', width: 1200, today: '2026-11-08' };
  const a = buildFeed(args);
  const b = buildFeed(args);
  assert.deepEqual(a, b);
  const other = buildFeed({ ...args, today: '2026-11-09' });
  assert.notDeepEqual(other.ids, a.ids, 'the day string seeds the shuffle');
});

test('no global is read: it runs with document, window, localStorage and fetch removed', () => {
  const saved = {};
  for (const k of ['document', 'window', 'localStorage', 'fetch']) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); delete globalThis[k]; }
  try {
    const f = buildFeed({ works: library(30), curation: cur(), query: 'teal', group: 'family', today: '2026-11-08' });
    assert.ok(f.total > 0);
    assert.equal(emptyReason({ loaded: false }), 'loading');
    assert.ok(feedKey({ width: 1000 }).length > 0);
  } finally {
    for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(globalThis, k, d);
  }
  const src = fs.readFileSync(new URL('./cosmos-view.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const imports = [...code.matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./cosmos-search.mjs', './cosmos-group.mjs', './cosmos-layout.mjs']);
  for (const word of ['document', 'window', 'localStorage', 'fetch', 'Date.now', 'new Date', 'Math.random', 'performance']) {
    assert.equal(new RegExp(`\\b${word.replace('.', '\\.')}\\b`).test(code), false, word);
  }
});

test('bad inputs do not throw: no works, no curation, a null library', () => {
  for (const works of [null, undefined, []]) {
    const f = buildFeed({ works });
    assert.deepEqual([f.total, f.cards.length, f.height], [0, 0, 0]);
  }
  assert.equal(buildFeed({ works: [], curation: null }).reason, 'empty-library');
  assert.equal(buildFeed({ works: library(3), curation: undefined, query: 'zzzz' }).reason, 'no-match');
  assert.equal(buildFeed({ works: library(3), curation: cur(), favOnly: true }).reason, 'no-favourites');
  assert.equal(buildFeed({ works: library(3), curation: cur(), favOnly: true, query: 'zzzz' }).reason, 'no-match');
  assert.equal(buildFeed({ works: library(3), curation: cur() }).reason, 'none');
});

test('emptyReason: all eight outputs', () => {
  const ok = { loaded: true, hasHq: true, state: 'ready', rootOk: true, total: 10, filtered: 10, query: '', favOnly: false };
  assert.equal(emptyReason({ ...ok, hasHq: false }), 'offline');
  assert.equal(emptyReason({ ...ok, loaded: false, total: null }), 'loading');
  assert.equal(emptyReason({ ...ok, loaded: false, total: null, error: 'x' }), 'error');
  assert.equal(emptyReason({ ...ok, loaded: false, total: null, state: 'error' }), 'error');
  assert.equal(emptyReason({ ...ok, state: 'empty', total: 0, filtered: 0 }), 'no-root');
  assert.equal(emptyReason({ ...ok, rootOk: false, total: 0, filtered: 0 }), 'no-root');
  assert.equal(emptyReason({ ...ok, total: 0, filtered: 0 }), 'empty-library');
  assert.equal(emptyReason({ ...ok, filtered: 0, query: 'zzz' }), 'no-match');
  assert.equal(emptyReason({ ...ok, filtered: 0, favOnly: true }), 'no-favourites');
  assert.equal(emptyReason({ ...ok, filtered: 0, favOnly: true, query: 'zzz' }), 'no-match');
  assert.equal(emptyReason({ ...ok, filtered: 0, favOnly: true, query: '   ' }), 'no-favourites');
  assert.equal(emptyReason(ok), 'none');
  assert.equal(emptyReason({ ...ok, filtered: 3, favOnly: true }), 'none');
});

test('emptyReason: loading vs empty-library is null vs [] (the honest difference)', () => {
  // callers derive `loaded` from works !== null; a caller that only passes the total gets the same answer
  assert.equal(emptyReason({ total: null, filtered: 0 }), 'loading');
  assert.equal(emptyReason({ total: undefined, filtered: 0 }), 'loading');
  assert.equal(emptyReason({ total: 0, filtered: 0 }), 'empty-library');
  assert.equal(emptyReason({ loaded: true, error: 'an earlier read worked; this one failed', total: 5, filtered: 5 }), 'none', 'an error does not hide works already held');
  assert.equal(emptyReason({}), 'loading');
});

test('feedKey: distinct for every field, equal for the same input, query trimmed', () => {
  const base = { width: 1040, sort: 'newest', group: 'none', density: 'cozy', query: 'teal', favOnly: false, showHidden: false, shown: Infinity, revision: 3, today: '2026-11-08' };
  const k0 = feedKey(base);
  assert.equal(feedKey({ ...base }), k0);
  assert.equal(feedKey({ ...base, query: '  teal ' }), k0);
  const variants = { width: 900, sort: 'title', group: 'type', density: 'roomy', query: 'tealish', favOnly: true, showHidden: true, shown: 240, revision: 4, today: '2026-11-09' };
  const seen = new Set([k0]);
  for (const [k, v] of Object.entries(variants)) {
    const key = feedKey({ ...base, [k]: v });
    assert.ok(!seen.has(key), `${k} changes the key`);
    seen.add(key);
  }
  assert.notEqual(feedKey({ ...base, shown: Infinity }), feedKey({ ...base, shown: 240 }));
});

test('the memo hits on an unchanged key and misses on each key field', () => {
  const works = library(80);
  const base = { width: 1040, sort: 'newest', group: 'none', density: 'cozy', query: '', favOnly: false, showHidden: false, shown: Infinity, revision: 1, today: '2026-11-08' };
  const memo = createFeedMemo();
  let computes = 0;
  const get = (p) => memo.get(feedKey(p), () => { computes += 1; return buildFeed({ works, curation: cur(), ...p }); });
  const first = get(base);
  assert.deepEqual([memo.stats.hits, memo.stats.misses, computes], [0, 1, 1]);
  const again = get({ ...base });
  assert.equal(again, first, 'the very same feed object');
  assert.deepEqual([memo.stats.hits, memo.stats.misses, computes], [1, 1, 1]);
  const changes = { width: 900, sort: 'title', group: 'type', density: 'roomy', query: 'piece 7', favOnly: true, showHidden: true, shown: 20, revision: 2, today: '2026-11-09' };
  let misses = 1;
  for (const [k, v] of Object.entries(changes)) {
    const before = computes;
    get({ ...base, [k]: v });
    assert.equal(computes, before + 1, `${k} recomputes`);
    misses = memo.stats.misses + memo.stats.reuses;
  }
  assert.equal(memo.stats.hits, 1);
  assert.equal(misses, 1 + Object.keys(changes).length);
});

test('a keystroke that leaves the result set unchanged reuses the cards object', () => {
  const works = library(100);
  const memo = createFeedMemo();
  const base = { width: 1040, sort: 'title', group: 'none', density: 'cozy', favOnly: false, showHidden: false, shown: Infinity, revision: 1, today: '2026-11-08' };
  const get = (query) => memo.get(feedKey({ ...base, query }), () => buildFeed({ works, curation: cur(), ...base, query }));
  const a = get('piece');          // matches all 100 titles
  const b = get('piece ');         // trimmed: same key -> hit
  assert.equal(b, a);
  const c = get('pie');            // different key, same 100 works in the same order
  assert.notEqual(c, a);
  assert.equal(c.cards, a.cards, 'same cards array: no layout work for the renderer');
  assert.equal(c.headers, a.headers);
  assert.equal(c.ids, a.ids);
  assert.equal(c.chip, 'pie', 'the chip is still the new query');
  assert.equal(memo.stats.reuses, 1);
  // narrowing changes the ids: a real miss with fresh cards
  const d = get('piece 7');
  assert.notEqual(d.cards, a.cards);
  assert.ok(d.total < a.total);
  assert.equal(memo.stats.reuses, 1);
  assert.equal(memo.stats.misses, 2);
  // a layout change with the same ids is not a reuse (the boxes differ)
  const e = memo.get(feedKey({ ...base, width: 900, query: 'pie' }), () => buildFeed({ works, curation: cur(), ...base, width: 900, query: 'pie' }));
  assert.notEqual(e.cards, c.cards);
});

test('the memo is bounded and clear() forgets everything', () => {
  const memo = createFeedMemo(3);
  let n = 0;
  const get = (i) => memo.get(feedKey({ width: 1000, query: `q${i}`, revision: 1 }), () => ({ ids: [`id${i}`], n: (n += 1) }));
  for (let i = 0; i < 5; i += 1) get(i);
  const before = n;
  get(4);
  assert.equal(n, before, 'the newest entry is still held');
  get(0);
  assert.equal(n, before + 1, 'the oldest was evicted');
  memo.clear();
  get(4);
  assert.equal(n, before + 2);
  // a key without the layout/result split is a plain memo entry and never reuses
  const m2 = createFeedMemo();
  const r1 = m2.get('plain-a', () => ({ ids: ['x'], cards: [] }));
  const r2 = m2.get('plain-b', () => ({ ids: ['x'], cards: [] }));
  assert.notEqual(r1.cards, r2.cards);
  assert.equal(m2.stats.reuses, 0);
});

test('1,000 works build in one pass (generous budget; the number is reported)', () => {
  const works = library(1000);
  const curation = cur({ hidden: { w7: true }, favorites: { w9: true } });
  buildFeed({ works, curation }); // warm up
  const t0 = process.hrtime.bigint();
  const f = buildFeed({ works, curation, query: 'poster', group: 'tag', sort: 'hue' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`# buildFeed over 1,000 works (query + group + sort): ${ms.toFixed(2)} ms`);
  assert.ok(f.total > 0);
  assert.ok(ms < 50, `took ${ms.toFixed(2)} ms`);
});
