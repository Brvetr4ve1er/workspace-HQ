// Cosmos actions (logic/cosmos.js) on a rigged component with a fake hq.cosmos behind the real live slice
// (live/cosmos-slice.mjs). No DOM, no main process. Placeholder works only (the repo is public).
//
// The last block exercises src/app.js itself (onKey guard, closeTop order, go(), initState, whq3-place, the arrival
// hook, key 0). Those rows need the integrator's app.js / catalog.mjs edits (spec: "SHARED EDITS"); until they land the
// rows are SKIPPED (not passed), and they run unchanged afterwards.
//
//   node --test dashboard-v5/src/logic/cosmos.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan } from '../live/__fixtures__/synthetic.mjs';
import { createCosmosSlice, emptyCosmos } from '../live/cosmos-slice.mjs';
import { useLogLogic } from './use-log.js';
import { FEED_PAGE } from './cosmos-view.mjs';
import { cosmosLogic, cosInitState, cosPrefsOf, cosPlaceOf, COS_STATE_KEYS, COS_PAGE_STEP, cosFeed, cosCanTrash, cosWork } from './cosmos.js';

process.env.TZ = 'UTC';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const searchBox = { focused: 0, selected: 0, focus() { this.focused += 1; }, select() { this.selected += 1; } };
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, querySelector: (sel) => (sel === "[data-cos='search']" ? searchBox : null) });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

// is app.js already wired for Cosmos? (checked BEFORE this file installs the mixin itself)
const INTEGRATED = typeof Component.prototype.cosKey === 'function';
if (!INTEGRATED) Object.assign(Component.prototype, cosmosLogic);
const integrated = (name, fn) => test(name, { skip: INTEGRATED ? false : 'waits for the integrator: app.js / catalog.mjs Cosmos edits' }, fn);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); searchBox.focused = 0; searchBox.selected = 0; });

// ---- fixtures -------------------------------------------------------------------------------------------------
const W = (n, extra) => ({
  id: 'w' + n, rel: 'sub/w' + n + '.png', title: ['', 'amber pier', 'blue pier', 'amber hill', 'green hill', 'blue hill'][n], type: 'photo',
  width: 400, height: 300, tags: ['alpha'], createdAt: '2026-0' + n + '-01T00:00:00.000Z', url: 'file:///alpha-site/w' + n + '.png', thumbUrl: 'file:///data/thumbs/w' + n + '.jpg', ...(extra || {}),
});
// newest first: w5 w4 w3 w2 w1; w4 is a dropped-in file (the only kind the app may move to the Recycle Bin)
const WORKS = [W(1), W(2), W(3), W(4, { rel: 'imports:drop-4.png' }), W(5)];
const curation = (extra) => ({ version: 1, clusters: [], favorites: {}, hidden: {}, overrides: {}, ...(extra || {}) });
const cleanup = () => ({ version: 1, dismissed: { clusters: {}, candidates: {} } });
const readAnswer = (works = WORKS) => ({ state: 'ready', config: { root: 'alpha-site', indexedAt: '2026-11-01T00:00:00.000Z' }, works, dupes: { exact: [], near: [], junk: [] }, curation: curation(), cleanup: cleanup(), rootOk: true, indexing: null });

function rig(o = {}) {
  const calls = [], toasts = [], marks = [];
  const live = { cosmos: emptyCosmos() };
  const cosmos = o.noCosmos ? undefined : {
    read: async (x) => { calls.push(['read', x]); return o.read ? o.read() : readAnswer(o.works); },
    apply: async (i) => { calls.push(['apply', i]); return o.apply ? o.apply(i) : { view: { curation: curation(), cleanup: cleanup() }, note: 'saved' }; },
    pickFolder: async () => { calls.push(['pickFolder']); return o.picked === undefined ? 'D:/alpha-site' : o.picked; },
    index: async () => { calls.push(['index']); return o.index === undefined ? true : o.index; },
    cancelIndex: async () => { calls.push(['cancelIndex']); return true; },
    trash: async (ids) => { calls.push(['trash', ids]); return o.trash ? o.trash(ids) : { trashed: ids.slice(), failed: [] }; },
    reveal: async (id) => { calls.push(['reveal', id]); return o.reveal === undefined ? true : o.reveal; },
    importFiles: async (paths) => { calls.push(['importFiles', paths]); return o.importFiles ? o.importFiles(paths) : { imported: paths.length, skipped: [] }; },
    importFromLocal: async () => { calls.push(['importFromLocal']); return o.importFromLocal ? o.importFromLocal() : { clusters: 1, favorites: 0, hidden: 0, overrides: 0, found: 1, missingIds: [], missingCount: 0, conflicts: 0, token: null, note: 'Imported 1 cluster.' }; },
    pathForFile: o.pathForFile || ((f) => f.path),
    onProgress: () => () => {},
  };
  const hq = cosmos ? { cosmos, use: o.noUse ? undefined : (s, a) => marks.push([s, a]) } : null;
  const store = { live, hq, ...createCosmosSlice({ hq, live, emit() {} }) };
  const self = Object.assign(Object.create(Object.assign({}, useLogLogic, cosmosLogic)), {
    state: { tab: 'cosmos', sub: {}, route: null, ...cosInitState(), ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    denied(why) { toasts.push(['denied', why]); },
    hq, store, LIVE: live,
  });
  return { self, calls, toasts, marks, live, C: () => live.cosmos, load: () => store.refreshCosmos(true), sent: (name) => calls.filter((c) => c[0] === name) };
}
const loaded = async (o) => { const r = rig(o); await r.load(); return r; };
const key = (k, o) => ({ key: k, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...(o || {}) });

// ---- state contract ----------------------------------------------------------------------------------------------
test('COS_STATE_KEYS lists exactly the keys cosInitState sets, with the contract defaults', () => {
  assert.deepEqual([...COS_STATE_KEYS].sort(), Object.keys(cosInitState()).sort());
  for (const k of ['cosQuery', 'cosSort', 'cosGroup', 'cosDensity', 'cosFav', 'cosShowHidden', 'cosShown', 'cosWidth', 'cosLb', 'cosIdx', 'cosReportOpen', 'cosReplaceAsk']) assert.ok(COS_STATE_KEYS.includes(k), k);
  const s = cosInitState();
  assert.equal(s.cosSort, 'newest');
  assert.equal(s.cosGroup, 'none');
  assert.equal(s.cosDensity, 'cozy');
  assert.equal(s.cosWidth, 1040);
  assert.equal(s.cosShown, FEED_PAGE);   // the Feed starts paged at FEED_PAGE cards
  assert.equal(s.cosLb, null);
  assert.equal(s.cosIdx, false);
  assert.equal(s.cosReportOpen, false);
  assert.equal(s.cosReplaceAsk, false);
  assert.equal(s.cosQuery, '');
});

test('sort, group and density come back from the prefs; query and the open element from the place; junk falls back', () => {
  const s = cosInitState({ cosSort: 'title', cosGroup: 'month', cosDensity: 'roomy' }, { cosQuery: 'pier', cosLb: 'w2' });
  assert.equal(s.cosSort, 'title');
  assert.equal(s.cosGroup, 'month');
  assert.equal(s.cosDensity, 'roomy');
  assert.equal(s.cosQuery, 'pier');
  assert.deepEqual(s.cosLb, { id: 'w2', edit: null, trashAsk: false });
  const j = cosInitState({ cosSort: 'bogus', cosGroup: 7, cosDensity: null }, { cosQuery: 4, cosLb: { id: 'x' } });
  assert.equal(j.cosSort, 'newest');
  assert.equal(j.cosGroup, 'none');
  assert.equal(j.cosDensity, 'cozy');
  assert.equal(j.cosQuery, '');
  assert.equal(j.cosLb, null);
  assert.deepEqual(cosPrefsOf({ cosSort: 'hue', cosGroup: 'type', cosDensity: 'compact', cosQuery: 'x' }), { cosSort: 'hue', cosGroup: 'type', cosDensity: 'compact' });
  assert.deepEqual(cosPlaceOf({ cosQuery: 'pier', cosLb: { id: 'w3', edit: 'title', trashAsk: true } }), { cosQuery: 'pier', cosLb: 'w3' });
  assert.deepEqual(cosPlaceOf({ cosQuery: 'pier', cosLb: null }), { cosQuery: 'pier', cosLb: null });
});

test('sort / group / density persist in the prefs and are restored; an unknown value is ignored', () => {
  const { self } = rig();
  self.cosSetSort('title'); self.cosSetGroup('type'); self.cosSetDensity('roomy');
  self.cosSetSort('nonsense'); self.cosSetGroup('nonsense'); self.cosSetDensity('nonsense');
  assert.equal(self.state.cosSort, 'title');
  const saved = JSON.parse(localStorage.getItem('whq3-prefs'));
  assert.deepEqual({ cosSort: saved.cosSort, cosGroup: saved.cosGroup, cosDensity: saved.cosDensity }, { cosSort: 'title', cosGroup: 'type', cosDensity: 'roomy' });
  const back = cosInitState(saved, {});
  assert.deepEqual([back.cosSort, back.cosGroup, back.cosDensity], ['title', 'type', 'roomy']);
  // other prefs survive
  localStorage.setItem('whq3-prefs', JSON.stringify({ ...saved, themePref: 'light' }));
  self.cosSetDensity('compact');
  assert.equal(JSON.parse(localStorage.getItem('whq3-prefs')).themePref, 'light');
});

// ---- arrival ---------------------------------------------------------------------------------------------------------
test('cosArrive reads the library once and marks the surface used once', async () => {
  const r = rig();
  await r.self.cosArrive();
  assert.equal(r.sent('read').length, 1);
  assert.deepEqual(r.marks, [['cosmos', 'open']]);
  assert.equal(r.C().works.length, 5);
  assert.equal(r.C().loaded, true);
});

test('cosArrive without hq.use marks nothing and does not throw; without hq.cosmos it reads nothing', async () => {
  const a = rig({ noUse: true });
  await a.self.cosArrive();
  assert.equal(a.marks.length, 0);
  assert.equal(a.sent('read').length, 1);
  const b = rig({ noCosmos: true });
  const out = await b.self.cosArrive();
  assert.ok(out.error);
  assert.equal(b.C().works, null);
  assert.equal(b.toasts.length, 0);   // offline is stated in the view, not a toast
});

test('cosArrive drops a restored lightbox whose element is gone, keeps one that exists', async () => {
  const gone = rig({ state: { cosLb: { id: 'zz-gone', edit: null, trashAsk: false } } });
  await gone.self.cosArrive();
  assert.equal(gone.self.state.cosLb, null);
  const here = rig({ state: { cosLb: { id: 'w2', edit: null, trashAsk: false } } });
  await here.self.cosArrive();
  assert.equal(here.self.state.cosLb.id, 'w2');
});

// ---- search and the Feed --------------------------------------------------------------------------------------------------
test('cosSearch / cosClear set the query and reset paging; the Feed follows', async () => {
  const { self, C } = await loaded();
  self.cosSearch('pier');
  assert.equal(self.state.cosQuery, 'pier');
  assert.deepEqual(cosFeed(self.state, C(), '2026-11-08').ids, ['w2', 'w1']);
  self.cosClear();
  assert.equal(self.state.cosQuery, '');
  assert.equal(cosFeed(self.state, C(), '2026-11-08').ids.length, 5);
});

test('cosMore adds one page only while paging is on', async () => {
  const { self } = await loaded();
  self.setState({ cosShown: 0 });
  self.cosMore();
  assert.equal(self.state.cosShown, 0);   // 0 = everything is already shown
  self.setState({ cosShown: FEED_PAGE });
  self.cosMore();
  assert.equal(self.state.cosShown, FEED_PAGE + COS_PAGE_STEP);
  self.cosSearch('x');
  assert.equal(self.state.cosShown, FEED_PAGE);   // a new query starts at the first page again
});

test('cosToggleFav / cosToggleHidden flip the filters and the Feed respects them', async () => {
  const r = await loaded({ read: () => ({ ...readAnswer(), curation: curation({ favorites: { w3: true }, hidden: { w5: true } }) }) });
  const { self, C } = r;
  const ids = () => cosFeed(self.state, C(), '2026-11-08').ids;
  assert.deepEqual(ids(), ['w4', 'w3', 'w2', 'w1']);   // w5 is hidden
  self.cosToggleHidden();
  assert.equal(ids().length, 5);
  self.cosToggleFav();
  assert.deepEqual(ids(), ['w3']);
});

// ---- the lightbox -----------------------------------------------------------------------------------------------------------
test('cosOpen / cosClose and cosStep follow the Feed order and stop at the ends (no wrap)', async () => {
  const { self } = await loaded();
  assert.deepEqual(self.cosOrder(), ['w5', 'w4', 'w3', 'w2', 'w1']);
  self.cosOpen('w5');
  assert.deepEqual(self.state.cosLb, { id: 'w5', edit: null, trashAsk: false });
  assert.equal(self.cosStep(-1), false);
  assert.equal(self.state.cosLb.id, 'w5');
  assert.equal(self.cosStep(1), true);
  assert.equal(self.state.cosLb.id, 'w4');
  self.cosOpen('w1');
  assert.equal(self.cosStep(1), false);
  assert.equal(self.state.cosLb.id, 'w1');
  self.cosClose();
  assert.equal(self.state.cosLb, null);
  assert.equal(self.cosStep(1), false);
  self.cosOpen('');
  self.cosOpen(5);
  assert.equal(self.state.cosLb, null);
});

test('stepping follows the search result order, not the whole library', async () => {
  const { self } = await loaded();
  self.cosSearch('pier');
  self.cosOpen('w2');
  assert.equal(self.cosStep(1), true);
  assert.equal(self.state.cosLb.id, 'w1');
  assert.equal(self.cosStep(1), false);
  // an element that is not in the current results has nowhere to step
  self.cosOpen('w5');
  assert.equal(self.cosStep(1), false);
});

test('keys act only while the lightbox is open: arrows step, f toggles favourite, / closes and focuses the search, Esc closes', async () => {
  const { self, sent } = await loaded();
  self.cosOpen('w4');
  assert.equal(self.cosKey(key('ArrowRight')), true);
  assert.equal(self.state.cosLb.id, 'w3');
  assert.equal(self.cosKey(key('ArrowLeft')), true);
  assert.equal(self.state.cosLb.id, 'w4');
  self.cosOpen('w5');
  assert.equal(self.cosKey(key('ArrowLeft')), true);   // handled even at the start, so the snapshot scrub never sees it
  assert.equal(self.state.cosLb.id, 'w5');
  assert.equal(self.cosKey(key('f')), true);
  await Promise.resolve();
  assert.deepEqual(sent('apply')[0][1], { type: 'favorite', id: 'w5', on: true });
  assert.equal(self.cosKey(key('/')), true);
  assert.equal(self.state.cosLb, null);
  assert.equal(searchBox.focused, 1);
  self.cosOpen('w5');
  assert.equal(self.cosKey(key('Escape')), true);
  assert.equal(self.state.cosLb, null);
});

test('with the lightbox closed cosKey claims nothing (palette, focus and the scrub keep their keys)', async () => {
  const { self, sent } = await loaded();
  for (const k of ['/', 'f', 'F', 'ArrowLeft', 'ArrowRight', 'Escape', '0', 'x']) assert.equal(self.cosKey(key(k)), false, k);
  assert.equal(sent('apply').length, 0);
  assert.equal(searchBox.focused, 0);
});

test('with the lightbox open Ctrl+K and other chords are not claimed; unrelated keys fall through', async () => {
  const { self } = await loaded();
  self.cosOpen('w3');
  assert.equal(self.cosKey(key('k', { ctrlKey: true })), false);
  assert.equal(self.cosKey(key('k', { metaKey: true })), false);
  assert.equal(self.cosKey(key('f', { ctrlKey: true })), false);
  assert.equal(self.cosKey(key('?')), false);
  assert.equal(self.cosKey(key('3')), false);
  assert.equal(self.state.cosLb.id, 'w3');
});

// ---- writes: one path --------------------------------------------------------------------------------------------------------
test('favourite and hide send intents with the element id and the new on/off value only', async () => {
  const { self, sent } = await loaded();
  assert.equal(await self.cosFavorite('w2'), true);
  assert.deepEqual(sent('apply')[0][1], { type: 'favorite', id: 'w2', on: true });
  assert.equal(await self.cosHide('w3'), true);
  assert.deepEqual(sent('apply')[1][1], { type: 'hide', id: 'w3', on: true });
  assert.equal(await self.cosFavorite(), false);   // no id, no lightbox: nothing to do
  assert.equal(sent('apply').length, 2);
});

test('a second favourite on an already-favourite element turns it off', async () => {
  const r = await loaded({ apply: (i) => ({ view: { curation: curation({ favorites: i.on ? { w2: true } : {} }), cleanup: cleanup() }, note: 'ok' }) });
  await r.self.cosFavorite('w2');
  await r.self.cosFavorite('w2');
  assert.deepEqual(r.sent('apply').map((c) => c[1].on), [true, false]);
});

test('a refused apply toasts main\'s real error, keeps the view and releases the guard', async () => {
  const r = await loaded({ apply: () => ({ error: 'That element is not in the library.' }) });
  const before = r.C().curation, rev = r.C().revision;
  assert.equal(await r.self.cosFavorite('w2'), false);
  assert.deepEqual(r.toasts.at(-1), ['error', 'That element is not in the library.']);
  assert.equal(r.C().curation, before);
  assert.equal(r.C().revision, rev);
  assert.equal(r.self.state.cosBusy, false);
  assert.equal(r.C().works.length, 5);
});

test('success toasts only the note main answered', async () => {
  const r = await loaded({ apply: () => ({ view: { curation: curation({ favorites: { w2: true } }), cleanup: cleanup() }, note: 'Added to favourites.' }) });
  await r.self.cosFavorite('w2');
  assert.deepEqual(r.toasts, [['success', 'Added to favourites.']]);
  assert.deepEqual(r.C().curation.favorites, { w2: true });
});

test('double submit is guarded: the second write while one is saving is refused with a message, not dropped silently', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const r = await loaded({ apply: async () => { await gate; return { view: { curation: curation(), cleanup: cleanup() }, note: 'ok' }; } });
  const first = r.self.cosFavorite('w2');
  assert.equal(r.self.state.cosBusy, true);
  assert.equal(await r.self.cosFavorite('w3'), false);
  assert.equal(r.toasts.at(-1)[0], 'info');
  release();
  assert.equal(await first, true);
  assert.equal(r.sent('apply').length, 1);
  assert.equal(r.self.state.cosBusy, false);
});

test('writes without the desktop bridge are denied, not attempted', async () => {
  const r = rig({ noCosmos: true });
  assert.equal(await r.self.cosFavorite('w2'), false);
  assert.equal(r.toasts.length, 1);
  assert.equal(r.toasts[0][0], 'denied');
});

test('hiding the open element while hidden ones are not shown moves the lightbox on, or closes it at the end', async () => {
  const r = await loaded({ apply: (i) => ({ view: { curation: curation({ hidden: { [i.id]: true } }), cleanup: cleanup() }, note: 'Hidden.' }) });
  r.self.cosOpen('w5');
  await r.self.cosHide();
  assert.equal(r.self.state.cosLb.id, 'w4');
  const solo = await loaded({ works: [W(1)], apply: (i) => ({ view: { curation: curation({ hidden: { [i.id]: true } }), cleanup: cleanup() }, note: 'Hidden.' }) });
  solo.self.cosOpen('w1');
  await solo.self.cosHide();
  assert.equal(solo.self.state.cosLb, null);
});

test('title: an unchanged title sends nothing; a new one sends the title; empty resets (null)', async () => {
  const r = await loaded();
  r.self.cosOpen('w2');
  r.self.cosTitleEdit();
  assert.equal(r.self.state.cosLb.edit, 'title');
  assert.equal(r.self.state.cosLb.draft, 'blue pier');
  assert.equal(await r.self.cosTitleSave(), true);
  assert.equal(r.sent('apply').length, 0);
  assert.equal(r.self.state.cosLb.edit, null);
  r.self.cosTitleEdit();
  r.self.cosTitleDraft('  harbour  ');
  await r.self.cosTitleSave();
  assert.deepEqual(r.sent('apply')[0][1], { type: 'title', id: 'w2', title: 'harbour' });
  assert.equal(r.self.state.cosLb.edit, null);
  assert.equal('draft' in r.self.state.cosLb, false);
  r.self.cosTitleEdit();
  await r.self.cosTitleSave('   ');
  assert.deepEqual(r.sent('apply')[1][1], { type: 'title', id: 'w2', title: null });
  // an event object passed by mistake falls back to the draft rather than being stringified
  r.self.cosTitleEdit();
  r.self.cosTitleDraft('from draft');
  await r.self.cosTitleSave({ target: {} });
  assert.equal(r.sent('apply')[2][1].title, 'from draft');
});

test('tags: add parses the comma list and normalises; remove sends one tag; an empty add sends nothing', async () => {
  const r = await loaded();
  r.self.cosOpen('w3');
  r.self.cosTagDraft(' Moody , wip,moody ');
  await r.self.cosTagAdd();
  assert.deepEqual(r.sent('apply')[0][1], { type: 'tags', id: 'w3', add: ['moody', 'wip'] });
  assert.equal('tagDraft' in r.self.state.cosLb, false);
  assert.equal(await r.self.cosTagAdd('   ,  '), false);
  assert.equal(r.sent('apply').length, 1);
  await r.self.cosTagRemove('alpha');
  assert.deepEqual(r.sent('apply')[1][1], { type: 'tags', id: 'w3', remove: ['alpha'] });
  assert.equal(await r.self.cosTagRemove(''), false);
});

test('reveal sends the element id only; a refusal toasts main\'s message', async () => {
  const r = await loaded();
  assert.equal(await r.self.cosReveal('w2'), true);
  assert.deepEqual(r.sent('reveal'), [['reveal', 'w2']]);
  const bad = await loaded({ reveal: { ok: false, message: 'That file cannot be found.' } });
  assert.equal(await bad.self.cosReveal('w2'), false);
  assert.deepEqual(bad.toasts.at(-1), ['error', 'That file cannot be found.']);
});

// ---- move to the Recycle Bin ----------------------------------------------------------------------------------------------------
test('only dropped-in elements (rel imports:) can be trashed from here', async () => {
  const { C } = await loaded();
  assert.equal(cosCanTrash(cosWork(C(), 'w4')), true);
  assert.equal(cosCanTrash(cosWork(C(), 'w3')), false);
  assert.equal(cosCanTrash(null), false);
  assert.equal(cosCanTrash({ rel: 42 }), false);
});

test('trash: the first click only arms, only Yes calls hq.cosmos.trash with [id], the lightbox moves on', async () => {
  const r = await loaded();
  r.self.cosOpen('w4');
  assert.equal(await r.self.cosTrashYes(), false);   // not armed
  assert.equal(r.sent('trash').length, 0);
  r.self.cosTrashAsk();
  assert.equal(r.self.state.cosLb.trashAsk, true);
  assert.equal(r.sent('trash').length, 0);
  r.self.cosTrashNo();
  assert.equal(r.self.state.cosLb.trashAsk, false);
  assert.equal(await r.self.cosTrashYes(), false);
  assert.equal(r.sent('trash').length, 0);
  r.self.cosTrashAsk();
  assert.equal(await r.self.cosTrashYes(), true);
  assert.deepEqual(r.sent('trash'), [['trash', ['w4']]]);
  assert.equal(r.C().works.some((w) => w.id === 'w4'), false);
  assert.equal(r.C().works.length, 4);
  assert.equal(r.self.state.cosLb.id, 'w3');
  assert.equal(r.self.state.cosLb.trashAsk, false);
  assert.equal(r.self.state.cosBusy, false);
  assert.deepEqual(r.toasts.at(-1), ['success', 'Moved to the Recycle Bin.']);
});

test('trash: failed[] keeps the element and shows main\'s message', async () => {
  const r = await loaded({ trash: () => ({ trashed: [], failed: [{ id: 'w4', message: 'The file is open in another program.' }] }) });
  r.self.cosOpen('w4');
  r.self.cosTrashAsk();
  assert.equal(await r.self.cosTrashYes(), false);
  assert.equal(r.C().works.length, 5);
  assert.equal(r.self.state.cosLb.id, 'w4');
  assert.equal(r.self.state.cosLb.trashAsk, false);
  assert.deepEqual(r.toasts.at(-1), ['error', 'The file is open in another program.']);
});

test('trash: an id main did not list is not dropped even when other ids were', async () => {
  const r = await loaded({ trash: () => ({ trashed: ['w1'], failed: [] }) });
  r.self.cosOpen('w4');
  r.self.cosTrashAsk();
  assert.equal(await r.self.cosTrashYes(), false);
  assert.equal(r.C().works.some((w) => w.id === 'w4'), true);
});

test('trash is never armed for a file the app did not copy in', async () => {
  const r = await loaded();
  r.self.cosOpen('w3');
  r.self.cosTrashAsk();
  assert.equal(r.self.state.cosLb.trashAsk, false);
  r.self.setState({ cosLb: { id: 'w3', edit: null, trashAsk: true } });   // even a forced flag does not reach main
  assert.equal(await r.self.cosTrashYes(), false);
  assert.equal(r.sent('trash').length, 0);
});

test('trash of the last element closes the lightbox', async () => {
  const r = await loaded({ works: [W(4, { rel: 'imports:drop-4.png' })] });
  r.self.cosOpen('w4');
  r.self.cosTrashAsk();
  await r.self.cosTrashYes();
  assert.equal(r.self.state.cosLb, null);
  assert.deepEqual(r.C().works, []);
});

// ---- index a folder -----------------------------------------------------------------------------------------------------------------
test('index overlay: opens on the saved folder, Choose sets the folder, Cancel in the dialog changes nothing', async () => {
  const r = await loaded();
  r.self.cosIndexOpen();
  assert.equal(r.self.state.cosIdx, true);
  assert.equal(r.self.state.cosFolder, 'alpha-site');
  assert.equal(await r.self.cosPick(), 'D:/alpha-site');
  assert.equal(r.self.state.cosFolder, 'D:/alpha-site');
  const none = await loaded({ picked: null });
  none.self.cosIndexOpen();
  assert.equal(await none.self.cosPick(), null);
  assert.equal(none.self.state.cosFolder, 'alpha-site');
  assert.equal(none.toasts.length, 0);
  r.self.cosIndexClose();
  assert.equal(r.self.state.cosIdx, false);
});

test('index start: accepted closes the overlay; a refusal toasts main\'s message and keeps it open; no folder is refused here', async () => {
  const ok = await loaded();
  ok.self.cosIndexOpen();
  assert.equal(await ok.self.cosIndexStart(), true);
  assert.equal(ok.self.state.cosIdx, false);
  assert.equal(ok.self.state.cosBusy, false);
  assert.deepEqual(ok.C().indexing, { phase: 'walk', done: 0, total: 0 });
  const no = await loaded({ index: { ok: false, reason: 'root-missing', message: 'That folder cannot be reached right now. Is the drive connected?' } });
  no.self.cosIndexOpen();
  assert.equal(await no.self.cosIndexStart(), false);
  assert.equal(no.self.state.cosIdx, true);
  assert.deepEqual(no.toasts.at(-1), ['error', 'That folder cannot be reached right now. Is the drive connected?']);
  const bare = rig({ read: () => ({ ...readAnswer([]), state: 'empty', config: { root: null, indexedAt: null } }) });
  await bare.load();
  bare.self.cosIndexOpen();
  assert.equal(await bare.self.cosIndexStart(), false);
  assert.equal(bare.sent('index').length, 0);
});

test('index cancel asks main to cancel', async () => {
  const r = await loaded();
  assert.equal(await r.self.cosIndexCancel(), true);
  assert.equal(r.sent('cancelIndex').length, 1);
});

// ---- import from the old gallery ---------------------------------------------------------------------------------------------------------
test('import: a report opens the dialog; cancelling the file dialog is silent; a refusal toasts its message', async () => {
  const ok = await loaded();
  assert.equal(await ok.self.cosImportLocal(), true);
  assert.equal(ok.self.state.cosReportOpen, true);
  assert.equal(ok.C().report.clusters, 1);
  ok.self.cosReportClose();
  assert.equal(ok.self.state.cosReportOpen, false);
  const cancelled = await loaded({ importFromLocal: () => ({ ok: false, reason: 'canceled', message: 'Import canceled.' }) });
  assert.equal(await cancelled.self.cosImportLocal(), false);
  assert.equal(cancelled.toasts.length, 0);
  assert.equal(cancelled.self.state.cosReportOpen, false);
  const bad = await loaded({ importFromLocal: () => ({ ok: false, reason: 'bad-backup', message: 'That file is not a Cosmos backup.' }) });
  await bad.self.cosImportLocal();
  assert.deepEqual(bad.toasts.at(-1), ['error', 'That file is not a Cosmos backup.']);
  assert.equal(bad.self.state.cosBusy, false);
});

test('Replace needs two clicks and spends the token', async () => {
  const report = { clusters: 2, favorites: 0, hidden: 0, overrides: 1, found: 3, missingIds: [], missingCount: 0, conflicts: 1, token: 'abcdef0123456789', note: 'Imported 2 clusters. 1 entry differs from what you already have: yours were kept.' };
  const r = await loaded({ importFromLocal: () => report, apply: () => ({ view: { curation: curation(), cleanup: cleanup() }, note: 'Replaced 1 cluster and 0 edits with the backup’s version.' }) });
  await r.self.cosImportLocal();
  assert.equal(await r.self.cosReplaceYes(), false);   // not asked yet
  assert.equal(r.sent('apply').length, 0);
  r.self.cosReplaceAsk();
  assert.equal(r.self.state.cosReplaceAsk, true);
  assert.equal(r.sent('apply').length, 0);
  r.self.cosReplaceNo();
  assert.equal(r.self.state.cosReplaceAsk, false);
  assert.equal(await r.self.cosReplaceYes(), false);
  r.self.cosReplaceAsk();
  assert.equal(await r.self.cosReplaceYes(), true);
  assert.deepEqual(r.sent('apply').map((c) => c[1]), [{ type: 'import-replace', token: 'abcdef0123456789' }]);
  assert.equal(r.self.state.cosReplaceAsk, false);
  assert.equal(r.C().report.token, null);
  r.self.cosReplaceAsk();   // the spent token cannot be asked again
  assert.equal(r.self.state.cosReplaceAsk, false);
});

test('Replace without a token (no conflicts) cannot be asked', async () => {
  const r = await loaded();
  await r.self.cosImportLocal();
  r.self.cosReplaceAsk();
  assert.equal(r.self.state.cosReplaceAsk, false);
});

// ---- drop ---------------------------------------------------------------------------------------------------------------------------------
test('cosDrop maps Array.from(files) through pathForFile one File at a time, skips empty strings, and sends only those paths', async () => {
  const f1 = { path: 'C:/drop/one.png' }, f2 = { path: '' }, f3 = { path: 'C:/drop/two.mp4' }, f4 = { path: 'C:/drop/boom.png', throws: true };
  const argCounts = [];
  const r = await loaded({
    pathForFile: (...a) => { argCounts.push(a.length); if (a[0].throws) throw new Error('not a file'); return a[0].path; },
    importFiles: (paths) => ({ imported: paths.length, skipped: [{ path: 'x', reason: 'Only pictures and videos can be added.' }] }),
  });
  const list = { 0: f1, 1: f2, 2: f3, 3: f4, length: 4 };   // a FileList is array-like
  assert.equal(await r.self.cosDrop(list), true);
  assert.deepEqual(argCounts, [1, 1, 1, 1]);
  assert.deepEqual(r.sent('importFiles'), [['importFiles', ['C:/drop/one.png', 'C:/drop/two.mp4']]]);
  assert.deepEqual(r.toasts[0], ['success', 'Added 2 files · 1 skipped']);
  assert.deepEqual(r.toasts[1], ['info', 'Only pictures and videos can be added.']);
});

test('cosDrop with nothing readable sends nothing; main\'s error is toasted as is; no bridge is denied', async () => {
  const r = await loaded({ pathForFile: () => '' });
  assert.equal(await r.self.cosDrop([{ path: 'x' }]), false);
  assert.equal(r.sent('importFiles').length, 0);
  assert.equal(r.toasts.at(-1)[0], 'info');
  assert.equal(await r.self.cosDrop(null), false);
  const bad = await loaded({ importFiles: () => ({ error: 'Index a folder first.' }) });
  assert.equal(await bad.self.cosDrop([{ path: 'C:/drop/a.png' }]), false);
  assert.deepEqual(bad.toasts.at(-1), ['error', 'Index a folder first.']);
  const off = rig({ noCosmos: true });
  assert.equal(await off.self.cosDrop([{ path: 'C:/a.png' }]), false);
  assert.equal(off.toasts[0][0], 'denied');
});

test('cosDrop where the preload has no pathForFile says so and sends nothing', async () => {
  const r = await loaded();
  delete r.self.hq.cosmos.pathForFile;
  assert.equal(await r.self.cosDrop([{ path: 'C:/a.png' }]), false);
  assert.equal(r.sent('importFiles').length, 0);
  assert.equal(r.toasts.at(-1)[0], 'error');
});

// ---- the grid width --------------------------------------------------------------------------------------------------------------------------
test('the grid ref is stable and measures the host; an unchanged width sets no state', () => {
  const { self } = rig();
  const ref = self.cosGridRef();
  assert.equal(self.cosGridRef(), ref);
  let sets = 0;
  const set = self.setState;
  self.setState = function (p) { sets += 1; return set.call(this, p); };
  ref({ clientWidth: 880 });
  assert.equal(self.state.cosWidth, 880);
  assert.equal(sets, 1);
  ref({ clientWidth: 880 });
  assert.equal(sets, 1);
  ref(null);
  ref({ clientWidth: 0 });
  assert.equal(self.state.cosWidth, 880);
});

// ---- app.js integration (skipped until the integrator's edits land) ----------------------------------------------------------------------------
const IDS = ['2026-10-01', '2026-10-03', '2026-10-05'];
const DATA = { scans: IDS.map((id) => scan(id, [proj('a', { dirty: 2 }), proj('b')])) };
const make = (props) => new Component(Object.assign({ store: createStore(DATA, null), previewState: 'live', startTab: 'home', theme: 'dark', pet: false }, props || {}));
const lb = (id = 'w1') => ({ id, edit: null, trashAsk: false });

integrated('app: initState sets every Cosmos state key', () => {
  const c = make();
  for (const k of COS_STATE_KEYS) assert.ok(k in c.state, k);
});

integrated('app: key 0 goes to the Cosmos tab (the tenth destination)', () => {
  const c = make();
  assert.equal(c.M.NAV[9].id, 'cosmos');
  c.onKey(key('0'));
  assert.equal(c.state.tab, 'cosmos');
});

integrated('app: "/" with the lightbox open closes it and does NOT open the palette; with it closed the palette opens', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb() });
  c.onKey(key('/'));
  assert.equal(c.state.cosLb, null);
  assert.equal(c.state.paletteOpen, false);
  assert.equal(searchBox.focused, 1);
  c.onKey(key('/'));
  assert.equal(c.state.paletteOpen, true);
});

integrated('app: "f" with the lightbox open does NOT start focus mode; with it closed it does', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb() });
  c.onKey(key('f'));
  assert.equal(c.state.focus, null);
  c.setState({ cosLb: null });
  c.onKey(key('f'));
  assert.ok(c.state.focus);
});

integrated('app: arrows step through the results and do NOT scrub snapshots; with the lightbox closed they scrub', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb(), snapOffset: 1 });
  c.onKey(key('ArrowRight'));
  c.onKey(key('ArrowLeft'));
  assert.equal(c.state.snapOffset, 1);
  c.setState({ cosLb: null });
  c.onKey(key('ArrowRight'));
  assert.equal(c.state.snapOffset, 0);
  c.onKey(key('ArrowLeft'));
  assert.equal(c.state.snapOffset, 1);
});

integrated('app: Ctrl+K opens the palette over the lightbox and Escape closes the palette first, then the lightbox', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb() });
  c.onKey(key('k', { ctrlKey: true }));
  assert.equal(c.state.paletteOpen, true);
  assert.ok(c.state.cosLb);
  c.onKey(key('Escape'));
  assert.equal(c.state.paletteOpen, false);
  assert.ok(c.state.cosLb);
  c.onKey(key('Escape'));
  assert.equal(c.state.cosLb, null);
});

integrated('app: Escape closes the import report, then the index overlay, then the lightbox', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb(), cosIdx: true, cosReportOpen: true });
  c.onKey(key('Escape'));
  assert.equal(c.state.cosReportOpen, false);
  assert.equal(c.state.cosIdx, true);
  c.onKey(key('Escape'));
  assert.equal(c.state.cosIdx, false);
  assert.ok(c.state.cosLb);
  c.onKey(key('Escape'));
  assert.equal(c.state.cosLb, null);
});

integrated('app: leaving the tab clears the lightbox and both overlays', () => {
  const c = make({ startTab: 'cosmos' });
  c.setState({ cosLb: lb(), cosIdx: true, cosReportOpen: true });
  c.go('home');
  assert.equal(c.state.cosLb, null);
  assert.equal(c.state.cosIdx, false);
  assert.equal(c.state.cosReportOpen, false);
});

integrated('app: the query and the open element ride in whq3-place and come back; sort, group and density ride in the prefs', () => {
  const a = make({ startTab: 'cosmos' });
  a.setState({ cosQuery: 'pier', cosLb: lb('w2') });
  a.componentDidUpdate();
  const place = JSON.parse(sessionStorage.getItem('whq3-place'));
  assert.equal(place.cosQuery, 'pier');
  assert.equal(place.cosLb, 'w2');
  a.cosSetSort('title');
  const b = make();
  assert.equal(b.state.cosQuery, 'pier');
  assert.equal(b.state.cosLb.id, 'w2');
  assert.equal(b.state.cosSort, 'title');
});

integrated('app: arriving at the tab calls cosArrive once', () => {
  const c = make({ startTab: 'home' });
  let n = 0;
  c.cosArrive = () => { n += 1; return Promise.resolve(); };
  c.componentDidUpdate();   // seeds _prev
  c.setState({ tab: 'cosmos' });
  c.componentDidUpdate();
  assert.equal(n, 1);
  c.componentDidUpdate();
  assert.equal(n, 1);
});
