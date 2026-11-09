// node --test dashboard-v5/tools/cdp-cosmos.test.mjs
// The Cosmos cdp scenarios cannot run here (they need the Electron harness), so this pins what can be pinned in plain Node: the
// factory's shape, that importing it does nothing, that every in-page snippet is valid JavaScript, that the snippets behave on a
// minimal stand-in page, the expectations computed from the fixture, and that each scenario starts, fails cleanly and cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fakeCosmos } from './cosmos-fixture.mjs';
import * as mod from './cdp-cosmos.mjs';

const { makeCosmosScenarios, COSMOS_SCENARIOS, PAGE, KEYS, keyEvents, visibleWorks, expectedCounts, dropToasts, fmtInt, BUDGET, WRITE_METHODS, COUNT_KEY } = mod;
const SRC = fs.readFileSync(new URL('./cdp-cosmos.mjs', import.meta.url), 'utf8');

const SNAP = (keys) => `(() => { const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = localStorage.getItem(k); return o; })()`;
const RESTORE = (saved) => `for (const [k, v] of Object.entries(${JSON.stringify(saved || {})})) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }`;

const NAMES = ['cosmos-open-key0', 'cosmos-search-narrows', 'cosmos-lightbox-arrows', 'cosmos-no-bridge-readonly', 'cosmos-button-sweep', 'cosmos-render-budget', 'cosmos-index-progress', 'cosmos-drop-import'];

test('the factory returns exactly the eight scenarios, each an async function of one argument', () => {
  const S = makeCosmosScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  assert.deepEqual([...COSMOS_SCENARIOS].sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) {
    assert.equal(typeof fn, 'function', name);
    assert.equal(fn.constructor.name, 'AsyncFunction', name + ' is async');
    assert.equal(fn.length, 1, name + ' takes (t)');
  }
  assert.deepEqual(Object.keys(makeCosmosScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE })).sort(), NAMES.slice().sort(), 'sleep is optional');
});

test('importing the file has no side effects: no socket, no timer, no process hook, nothing from cdp-gate', async () => {
  for (const re of [/\bWebSocket\b/, /\bfetch\(/, /process\.(exit|on|argv|stdin)/, /createServer|\.listen\(/, /cdp-gate/, /\brequire\(/, /setInterval/, /from 'node:(net|http|child_process)/]) {
    assert.ok(!re.test(SRC.replace(/^\/\/.*$/gm, '')), 'source mentions ' + re);
  }
  assert.deepEqual(Object.keys(await import('./cdp-cosmos.mjs')).sort(), Object.keys(mod).sort());
  assert.ok(Object.isFrozen(PAGE) === false && typeof PAGE.READY === 'string');
});

// samples for the snippet builders that take arguments
const ROOT = "document.querySelector('main')";
const SAMPLES = {
  setCount: [[1000], [null]], libHas: [[1000]], dialog: [['Cosmos element']], hasFixedZ: [[1000]], isFavorite: [['alpha-site-001']],
  calls: [['cosmos.read']], callCount: [['cosmos.read']], anyCall: [[WRITE_METHODS]], emit: [[{ phase: 'walk', done: 1, total: 2 }]],
  persistRead: [[{ a: 1 }]], setAnswer: [['cosmos.importFiles', { imported: 1 }]], drop: [[[{ name: 'a', fakePath: 'C:/placeholder-drop/a.png' }]]],
  sweepReset: [[''], ["cosLb: { id: 'a', edit: null, trashAsk: false }"]], sweepCount: [[ROOT]], sweepClick: [[ROOT, 3]], buttonByText: [[ROOT, '/Recycle Bin/i']],
  openLb: [['a'], ['a', { edit: 'title' }]], rerenders: [[9]], narrow: [['photo', 125]],
};
function everySnippet() {
  const out = [];
  for (const [name, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') out.push([name, v]);
    else { const sets = SAMPLES[name]; assert.ok(sets, 'PAGE.' + name + ' takes arguments: add samples to the test'); for (const a of sets) out.push([name + '(' + a.length + ')', v(...a)]); }
  }
  return out;
}

test('every in-page snippet is valid JavaScript (they are evaluated in a page this test cannot open)', () => {
  const all = everySnippet();
  assert.ok(all.length > 50, 'snippets ' + all.length);
  for (const [name, code] of all) {
    assert.equal(typeof code, 'string', name);
    assert.doesNotThrow(() => new vm.Script(code), 'PAGE.' + name + ' does not parse:\n' + code);
  }
  // the key and storage names the fake preload and the scenarios agree on
  assert.equal(COUNT_KEY, 'hqFake:cosmosCount');
  assert.ok(PAGE.setCount(1000).includes('hqFake:cosmosCount'));
  assert.ok(PAGE.cleanup.includes('hqFake:cosmosCount') && PAGE.cleanup.includes('removeItem'), 'cleanup takes the size away again');
});

test('no snippet mentions the owner, a real path or the network', () => {
  for (const [name, code] of everySnippet()) assert.ok(!/\bUsers\b|ROG|Pictures|Documents|https?:/.test(code), name);
  assert.ok(!/ROG|\\Users\\|C:\/Users|Pictures/.test(SRC), 'the scenario file holds no owner path');
});

// ---- a minimal stand-in page for the snippets that do work ------------------------------------------------------------
const env = (extra) => { const e = Object.assign({ performance, setTimeout, clearTimeout, Event, Promise, console }, extra || {}); e.window = e; return vm.createContext(e); };
const run = (code, e) => vm.runInContext(code, e, { timeout: 5000 });
const button = (text, aria) => { const b = { text, clicked: 0, textContent: text, getAttribute: (k) => (k === 'aria-label' ? aria || '' : null), click() { b.clicked++; } }; return b; };

test('drop and dragover: preventDefault, and the File-likes reach the handler untouched', async () => {
  const seen = [];
  const host = { dispatchEvent(ev) { seen.push(ev.type); ev.preventDefault(); host.last = ev.dataTransfer.files; return true; } };
  const e = env({ document: { querySelector: (s) => (s === "[data-cos='feed']" ? host : null) } });
  assert.equal(await run(PAGE.dragOver, e), true);
  const files = [{ name: 'a.png', fakePath: 'C:/placeholder-drop/a.png' }, { name: 'note.txt' }];
  assert.equal(await run(PAGE.drop(files), e), true);
  assert.deepEqual(seen, ['dragover', 'drop']);
  assert.deepEqual(JSON.parse(JSON.stringify(host.last)), files);
  assert.equal(await run(PAGE.drop(files), env({ document: { querySelector: () => null } })), null, 'no host: null, not a throw');
  // a handler that forgets preventDefault is reported
  const lazy = { dispatchEvent() { return true; } };
  assert.equal(await run(PAGE.dragOver, env({ document: { querySelector: () => lazy } })), false);
});

test('the sweep snippets count a scope, click the i-th button, and never click a Yes', async () => {
  const btns = [button('Index a folder'), button('Yes'), button('', 'Favourite'), button('Move to Recycle Bin')];
  const root = { querySelectorAll: (s) => (s === 'button' ? btns : []) };
  const e = env({ document: { querySelector: () => root } });
  assert.equal(await run(PAGE.sweepCount(ROOT), e), 4);
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.sweepClick(ROOT, 0), e))), { label: 'Index a folder' });
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.sweepClick(ROOT, 1), e))), { skipped: 'Yes' });
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.sweepClick(ROOT, 2), e))), { label: 'Favourite' });
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.sweepClick(ROOT, 9), e))), { gone: 'button' });
  assert.deepEqual(btns.map((b) => b.clicked), [1, 0, 1, 0], 'the Yes button was never clicked');
  assert.equal(await run(PAGE.buttonByText(ROOT, '/Recycle Bin/i'), e), 'Move to Recycle Bin');
  assert.equal(btns[3].clicked, 1);
  assert.equal(await run(PAGE.buttonByText(ROOT, '/nothing like it/'), e), null);
  const none = env({ document: { querySelector: () => null } });
  assert.equal(await run(PAGE.sweepCount(ROOT), none), -1);
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.sweepClick(ROOT, 0), none))), { gone: 'scope' });
});

test('read-only on / off and the cleanup put the store back and take the size away', async () => {
  const hq = { cosmos: { read() {} }, use() {} };
  const store = { hq, refreshCosmos: async () => true };
  const logic = { states: [], went: [], setState(p) { this.states.push(p); }, go(t) { this.went.push(t); } };
  const sessionStorage = { removed: [], removeItem(k) { this.removed.push(k); }, setItem() {} };
  let resets = 0;
  const e = env({ WHQ: { store, app: { logic } }, sessionStorage, hqFake: { reset() { resets++; } } });
  run(PAGE.readOnly, e);
  assert.equal(store.hq.cosmos, undefined);
  assert.ok(store.hq.use, 'the rest of hq stays');
  run(PAGE.readOnlyOff, e);
  assert.equal(store.hq, hq);
  run(PAGE.readOnly, e);
  await run(PAGE.cleanup, e);
  assert.equal(store.hq, hq, 'cleanup restores the swapped hq');
  assert.deepEqual(sessionStorage.removed, [COUNT_KEY]);
  assert.deepEqual(logic.went, ['home']);
  assert.ok(resets >= 2);
  const closed = logic.states[0];
  for (const k of ['cosLb', 'cosIdx', 'cosReportOpen', 'cosReplaceAsk', 'cosQuery', 'cosFav', 'cosShowHidden', 'paletteOpen']) assert.ok(k in closed, 'cleanup closes ' + k);
});

test('rerenders: nine timed setStates and their median', async () => {
  const logic = { n: 0, setState(p) { if ('cosFolder' in p) this.n++; } };
  const e = env({ WHQ: { app: { logic } }, document: { body: { getBoundingClientRect: () => ({}) } } });
  const r = await run(PAGE.rerenders(9), e);
  assert.equal(r.all.length, 9);
  assert.equal(logic.n, 10, 'nine probes and one reset of cosFolder');
  assert.ok(r.median >= 0 && r.median < 500);
});

test('narrow and firstRender: they wait for the card count the caller expects', async () => {
  let cards = 40;
  const input = { value: '', focus() {}, dispatchEvent() { setTimeout(() => { cards = 125; }, 15); return true; } };
  const doc = {
    querySelector: (s) => (s === "[data-cos='search']" ? input : null),
    querySelectorAll: (s) => (s === '[data-cos-card]' ? { length: cards } : { length: 0 }),
    body: { getBoundingClientRect: () => ({}) },
  };
  const r = await run(PAGE.narrow('photo', 125), env({ document: doc }));
  assert.equal(r.n, 125);
  assert.equal(input.value, 'photo');
  assert.ok(r.ms >= 10 && r.ms < 2000, 'ms ' + r.ms);
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.narrow('x', 1), env({ document: { querySelector: () => null } })))), { error: 'no search box' });

  // first render: the live slice appears, then the cards
  let n = 0;
  const live = { cosmos: { works: null } };
  const logic = { state: { cosShown: 0 }, go() { setTimeout(() => { live.cosmos.works = new Array(985).fill({}); setTimeout(() => { n = 985; }, 10); }, 10); }, cosOrder: () => new Array(985).fill('x') };
  const e2 = env({ WHQ: { app: { logic }, store: { live } }, document: { querySelectorAll: () => ({ length: n }), body: { getBoundingClientRect: () => ({}) } } });
  const f = await run(PAGE.firstRender, e2);
  assert.equal(f.want, 985); assert.equal(f.n, 985); assert.ok(f.ms >= 15 && f.ms < 3000);
  // paging: want is capped at what is shown
  const paged = { state: { cosShown: 250 }, go() { live.cosmos.works = [{}]; n = 250; }, cosOrder: () => new Array(985).fill('x') };
  const f2 = await run(PAGE.firstRender, env({ WHQ: { app: { logic: paged }, store: { live: { cosmos: { works: [{}] } } } }, document: { querySelectorAll: () => ({ length: n }), body: { getBoundingClientRect: () => ({}) } } }));
  assert.equal(f2.want, 250); assert.equal(f2.n, 250);
});

test('buildCount reads the Feed memo; -1 when there is none', () => {
  assert.equal(run(PAGE.buildCount, env({ WHQ: { store: { live: { cosmos: { _memo: { stats: { hits: 5, misses: 3, reuses: 2 } } } } } } })), 5);
  assert.equal(run(PAGE.buildCount, env({ WHQ: { store: { live: { cosmos: { _memo: null } } } } })), -1);
});

// ---- the expectations --------------------------------------------------------------------------------------------------
test('expectations from the fixture: the known counts, minus what is hidden, with overrides applied', () => {
  const lib = fakeCosmos();
  const K = expectedCounts(lib);
  assert.equal(K.total, 1000);
  assert.equal(K.visible, 985);
  assert.equal(K.all, '985 of 1,000');
  assert.equal(K.of(985), '985 of 1,000');
  assert.equal(K.of(1000), '1,000 elements');
  assert.equal(K.tag, 40);
  assert.equal(K.type, lib.works.filter((w) => w.type === 'photo' && !lib.curation.hidden[w.id]).length);
  const teal = new Set(['#1a6b52', '#17a398']);
  assert.equal(K.family, lib.works.filter((w) => w.color && teal.has(w.color.hex) && !lib.curation.hidden[w.id]).length);
  assert.equal(K.hexExact, lib.works.filter((w) => w.color && w.color.hex === '#1a6b52' && !lib.curation.hidden[w.id]).length);
  assert.ok(K.hexExact > 0 && K.hexExact <= 80, 'the nearest-first check has exact matches to lead with');
  assert.equal(K.known.tag, 'kiln');
  assert.equal(K.colorById.size, K.withColor);
  // visibleWorks leaves hidden ones out and applies a tag override
  const v = visibleWorks(lib), ids = new Set(v.map((w) => w.id));
  for (const id of Object.keys(lib.curation.hidden)) assert.ok(!ids.has(id));
  const [oid, o] = Object.entries(lib.curation.overrides).find(([, x]) => Array.isArray(x.tags) && !lib.curation.hidden[x] );
  if (ids.has(oid)) assert.deepEqual(v.find((w) => w.id === oid).tags, o.tags);
  // a library with nothing hidden reads "N elements"
  const none = { works: lib.works.slice(0, 40), curation: { hidden: {}, overrides: {} } };
  assert.equal(expectedCounts(none).all, '40 elements');
});

test('fmtInt and dropToasts follow the app’s own words', () => {
  assert.equal(fmtInt(1000), '1,000'); assert.equal(fmtInt(985), '985'); assert.equal(fmtInt(1234567), '1,234,567');
  assert.deepEqual(dropToasts({ imported: 2, skipped: [{ path: 'x', reason: 'not a picture' }] }), [['success', 'Added 2 files · 1 skipped'], ['info', 'not a picture']]);
  assert.deepEqual(dropToasts({ imported: 1, skipped: [] }), [['success', 'Added 1 file']]);
  assert.deepEqual(dropToasts({ imported: 0, skipped: [{ path: 'x' }] }), [['error', 'Some files were skipped']]);
  assert.deepEqual(dropToasts({ imported: 0, skipped: [] }), []);
});

test('key events: printable keys send text, arrows and Escape do not, Ctrl+K sends the modifier', () => {
  const k0 = keyEvents('0');
  assert.equal(k0[0].type, 'keyDown'); assert.equal(k0[0].text, '0'); assert.equal(k0[0].code, 'Digit0'); assert.equal(k0[1].type, 'keyUp');
  assert.equal(keyEvents('ArrowRight')[0].type, 'rawKeyDown'); assert.equal('text' in keyEvents('ArrowRight')[0], false);
  assert.equal(keyEvents('Escape')[0].windowsVirtualKeyCode, 27);
  const ck = keyEvents('k', { ctrl: true });
  assert.equal(ck[0].modifiers, 2); assert.equal(ck[0].type, 'rawKeyDown'); assert.equal(ck[0].key, 'k');
  assert.equal(keyEvents('f')[0].modifiers, 0);
  assert.throws(() => keyEvents('F13'), /no key table entry/);
  for (const k of Object.keys(KEYS)) assert.equal(keyEvents(k).length, 2);
});

test('the budget is the one the design names', () => {
  assert.deepEqual({ ...BUDGET }, { firstRender: 400, rerenderMedian: 40, narrowKeystroke: 150 });
  assert.ok(WRITE_METHODS.every((m) => m.startsWith('cosmos.')));
  assert.ok(WRITE_METHODS.includes('cosmos.trash') && WRITE_METHODS.includes('cosmos.apply'));
  assert.match(SRC, /FEED_PAGE = 250 in dashboard-v5\/src\/logic\/cosmos-view\.mjs/, 'the failure message tells the Pass what to flip');
});

// ---- each scenario starts, fails cleanly when the page is not ready, and cleans up after itself ----------------------------
test('every scenario returns fresh()’s failure untouched and still cleans up (the library size goes away)', async () => {
  for (const name of NAMES) {
    const seen = [];
    const t = {
      async evaluate(code) { seen.push(code); new vm.Script(String(code)); return undefined; },
      async waitFor() { return false; }, async reload() {}, async send() {}, async type() {}, async press() {}, sleep: async () => {},
      errors: () => [], clearErrors() {},
    };
    const S = makeCosmosScenarios({ fresh: async () => ['stub: the page is not ready'], SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
    const r = await S[name](t);
    assert.deepEqual(r, ['stub: the page is not ready'], name);
    assert.ok(seen.includes(PAGE.cleanup), name + ' ran the cleanup that removes ' + COUNT_KEY);
  }
});

test('every scenario survives a page that answers nothing: a failure list or a clean throw, never a hang', async () => {
  for (const name of NAMES) {
    const seen = [];
    const t = {
      async evaluate(code) { seen.push(String(code)); new vm.Script(String(code)); return undefined; },
      async waitFor() { return false; }, async reload() {}, async send() {}, async type() {}, async press() {}, sleep: async () => {},
      errors: () => [], clearErrors() {},
    };
    const S = makeCosmosScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
    let r, thrown = null;
    try { r = await S[name](t); } catch (e) { thrown = e; }
    assert.ok(thrown ? thrown instanceof TypeError || /undefined|null/.test(String(thrown.message)) : Array.isArray(r), name + ' -> ' + (thrown ? thrown.message : typeof r));
    assert.ok(seen.includes(PAGE.cleanup), name + ' cleaned up even when it could not run');
    for (const code of seen) assert.doesNotThrow(() => new vm.Script(code), name);
  }
});

// ======================================================================================================================
// An in-process page. The scenarios cannot meet Electron here, but their expectations (the counts, the order, the texts, the
// call shapes) can meet the REAL pieces behind them: logic/cosmos.js, the live slice, the vals, the fixture generator and the
// pasted fake rows. Only the DOM and the app's key handler are stood in for (about forty lines of each); everything the
// scenarios assert about Cosmos itself is the real code answering.
// ======================================================================================================================
if (typeof globalThis.window === 'undefined') globalThis.window = {};
const { cosmosLogic, cosInitState } = await import('../src/logic/cosmos.js');
const { createCosmosSlice, emptyCosmos } = await import('../src/live/cosmos-slice.mjs');
const { cosmosVals } = await import('../src/vals/cosmos.js');
const { rowsBlock } = await import('./cosmos-fixture-paste.mjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function simPage() {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const rows = new Function('storage', 'fakeCosmos', rowsBlock() + '\nreturn COSMOS;')(storage, fakeCosmos);
  const log = [], overrides = new Map(), subs = new Set();
  const rec = (method, args) => log.push({ method, args: clone(args) });
  const cosmos = {};
  for (const [name, kind] of rows.rows) {
    const m = name.slice('cosmos.'.length);
    if (typeof kind === 'string') cosmos[m] = (cb) => { rec(name, ['[function]']); subs.add(cb); return () => subs.delete(cb); };
    else if (kind && kind.sync) cosmos[m] = (...a) => { rec(name, a); return overrides.has(name) ? overrides.get(name) : kind.sync(...a); };
    else cosmos[m] = (...a) => { rec(name, a); return Promise.resolve(overrides.has(name) ? clone(overrides.get(name)) : kind(...a)); };
  }
  const hq = { cosmos, use: (s, a) => rec('use', [s, a]) };
  const live = { cosmos: emptyCosmos() };
  const store = { live, hq, ...createCosmosSlice({ hq, live, emit() {} }) };
  store.watchCosmos();
  const input = { value: '', getAttribute: (k) => (k === 'data-cos' ? 'search' : null), focus() { doc.activeElement = input; }, select() {}, blur() { doc.activeElement = null; }, dispatchEvent() { self.cosSearch(input.value); return true; } };
  const baseState = () => ({ tab: 'home', sub: { cosmos: 'feed' }, route: null, toasts: [], snapOffset: 0, whatsNewOpen: false, paletteOpen: false, focus: null, askOpen: false, ...cosInitState() });
  const self = Object.assign(Object.create(cosmosLogic), {
    state: baseState(),
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast(kind, text) { this.state = { ...this.state, toasts: this.state.toasts.concat([{ kind, text }]) }; },
    denied(why) { this.toast('error', why); },
    useMark(s, a) { (this.hq && this.hq.use || (() => {}))(s, a); },
    go(tab, sub) {
      const moved = this.state.tab !== tab;
      this.setState({ tab, sub: sub ? { ...this.state.sub, [tab]: sub } : this.state.sub });
      if (tab === 'cosmos' && moved) return this.cosArrive();
      return undefined;
    },
    LIVE: live, store,
    renderVals() { return cosmosVals.call(this, { S: this.state, LIVE: live, live: true }); },
  });
  Object.defineProperty(self, 'hq', { get: () => store.hq });
  globalThis.document = null;   // set below: logic/cosmos.js reads the global document for its search-box focus
  const vals = () => self.renderVals();
  const card = (c) => ({ getAttribute: (k) => (k === 'data-id' ? c.id : null), click: () => self.cosOpen(c.id) });
  const doc = {
    activeElement: null,
    body: { getBoundingClientRect: () => ({}) },
    querySelector(sel) {
      const v = () => vals();
      if (sel === '#app') return { childElementCount: 1 };
      if (sel === "[data-cos='search']") return input;
      if (sel === "[data-cos='count']") { const c = v(); return c.cosOn && c.cosCount ? { textContent: c.cosCount } : null; }
      if (sel === "[data-cos='empty']") { const c = v(); return c.cosOffline ? { getAttribute: () => 'offline' } : c.cosEmpty ? { getAttribute: () => c.cosReason } : null; }
      if (sel === "[data-cos='feed']") return { dispatchEvent(ev) { const c = v(); if (ev.type === 'drop') c.cosOnDrop(ev); else c.cosOnDragOver(ev); return true; } };
      if (sel === 'main') { const c = v(); return { textContent: c.cosOffline ? c.cosOfflineText : (c.cosCount || '') + ' ' + (c.cosCards.length ? 'cards' : '') }; }
      if (sel === '[data-cos-card]') { const c = v(); return c.cosOn && c.cosCards.length ? card(c.cosCards[0]) : null; }
      if (sel === '[aria-label="Clear search"]') return { click: () => self.cosClear() };
      if (sel === '[role="dialog"][aria-label="Cosmos element"]') return self.state.cosLb ? { __z: '990' } : null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-cos-card]') { const c = vals(); return c.cosOn && !c.cosOffline ? c.cosCards.map(card) : []; }
      if (sel === 'body *') return self.state.paletteOpen ? [{ __z: '1000' }] : [];
      return [];
    },
  };
  const control = {
    calls: (m) => log.filter((c) => !m || c.method === m).map((c) => clone(c)),
    reset: (all) => { log.length = 0; if (all) overrides.clear(); rows.reset(); return true; },
    emit: (ch, payload) => { let n = 0; for (const cb of [...subs]) { cb(payload); n++; } return n; },
    set: (m, v) => { if (v === undefined) overrides.delete(m); else overrides.set(m, clone(v)); return true; },
  };
  // the app's key handler, reduced to what the scenarios press (app.js onKey + closeTop order with the Cosmos edits)
  const onKey = (ev) => {
    const S = self.state;
    if (ev.ctrlKey && ev.key.toLowerCase() === 'k') { self.setState({ paletteOpen: !S.paletteOpen }); return; }
    if (ev.key === 'Escape') { if (S.paletteOpen) self.setState({ paletteOpen: false }); else if (S.cosLb) self.cosClose(); return; }
    if (S.paletteOpen || doc.activeElement === input) return;
    if (self.cosKey(ev)) return;
    if (ev.key === '/') { self.setState({ paletteOpen: true }); return; }
    if (ev.key === '0') { self.go('cosmos'); return; }
    if (ev.key === 'f') { self.setState({ focus: { start: 1 } }); return; }
    if (ev.key === 'ArrowLeft') self.setState({ snapOffset: Math.min(5, S.snapOffset + 1) });
    if (ev.key === 'ArrowRight') self.setState({ snapOffset: Math.max(0, S.snapOffset - 1) });
  };
  globalThis.document = doc;
  const ctx = { WHQ: { app: { logic: self }, store }, document: doc, hqFake: control, sessionStorage: storage, performance, setTimeout, Event, console, getComputedStyle: (e) => ({ position: 'fixed', zIndex: (e && e.__z) || 'auto' }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  const t = {
    async evaluate(code) { return vm.runInContext(String(code), ctx, { timeout: 8000 }); },
    async waitFor(expr, ms = 10000) { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(3)) { try { if (await t.evaluate(expr)) return true; } catch { /* not yet */ } } return false; },
    async reload() { log.push({ method: 'liveState', args: [] }); self.state = baseState(); store.live.cosmos = emptyCosmos(); store.live.cosmos._memo = null; },
    async send(method, p) {
      if (method !== 'Input.dispatchKeyEvent' || p.type === 'keyUp') return;
      if (p.key === 'Backspace') { if (doc.activeElement === input) { input.value = ''; self.cosSearch(''); } return; }
      onKey({ key: p.key, ctrlKey: (p.modifiers & 2) === 2, metaKey: false, altKey: false, target: { tagName: 'BODY' }, preventDefault() {} });
    },
    async type(text) { if (doc.activeElement === input) { input.value = String(text); self.cosSearch(input.value); } },
    sleep: wait, errors: () => [], clearErrors() {},
  };
  const fresh = async () => { self.state = baseState(); control.reset(true); doc.activeElement = null; return null; };
  return { t, fresh, self, control, store, storage, log };
}

async function runSim(name, setup) {
  const page = simPage();
  if (setup) setup(page);
  const S = makeCosmosScenarios({ fresh: page.fresh, SNAP_KEYS: () => 'true', RESTORE_KEYS: () => 'true', sleep: wait });
  const out = await S[name](page.t);
  return { out, page };
}

for (const name of ['cosmos-open-key0', 'cosmos-search-narrows', 'cosmos-lightbox-arrows', 'cosmos-no-bridge-readonly', 'cosmos-render-budget', 'cosmos-index-progress', 'cosmos-drop-import']) {
  test('on the in-process page: ' + name + ' passes against the real logic, slice, vals and rows', { timeout: 60000 }, async () => {
    const { out, page } = await runSim(name);
    assert.deepEqual(out, [], name + ' reported: ' + JSON.stringify(out));
    assert.equal(page.storage.getItem(COUNT_KEY), null, 'the library size was taken away again');
    assert.notEqual(page.store.hq.cosmos, undefined, 'the bridge was put back');
  });
}

test('on the in-process page: the scenarios notice a regression (they fail when the app does the wrong thing)', { timeout: 60000 }, async () => {
  // a favourite key that opens focus mode instead of toggling the star
  let r = await runSim('cosmos-lightbox-arrows', ({ self }) => { self.cosFavorite = async function () { this.setState({ focus: { start: 1 } }); return true; }; });
  assert.ok(r.out.some((m) => /f did not call hq\.cosmos\.apply|focus mode/.test(m)), JSON.stringify(r.out));
  // an arrival that reads twice
  r = await runSim('cosmos-open-key0', ({ self }) => { const arrive = self.cosArrive; self.cosArrive = async function () { await arrive.call(this); return this.store.refreshCosmos(true); }; });
  assert.ok(r.out.some((m) => /exactly 1/.test(m)), JSON.stringify(r.out));
  // a search that ignores tag:
  r = await runSim('cosmos-search-narrows', ({ self }) => { const s = self.cosSearch; self.cosSearch = function (text) { return /^tag:/.test(text) ? undefined : s.call(this, text); }; });
  assert.ok(r.out.length > 0, 'a search that ignores tag: is caught');
  // a drop that sends the names instead of the paths
  r = await runSim('cosmos-drop-import', ({ store }) => { const f = store.importCosmosFiles; store.importCosmosFiles = (paths) => f(paths.map((p) => p.split('/').pop())); });
  assert.ok(r.out.some((m) => /importFiles got/.test(m)), JSON.stringify(r.out));
});
