// node --test dashboard-v5/src/logic/version-card.test.mjs
// "New version inserted" (batch 7, dish version-card): the pure rule (every cell), the machine that runs it against a fake layer (listeners and
// timers counted the way console-layer's probe counts them), the Component mixin, the render values, the fragment, contrast, and the rule
// that no raw listener / timer / sound call exists in the dish's files. No DOM, no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decide, VC_ACTIONS, VC_MS, VC_CAPTION, VC_PREF, OVERLAY_KEYS, overlayOpenOf, reducedNow, createVersionCard, cartridgePaths, CARD_VIEWBOX,
  cardStyle, cartStyle, versionCardLogic, bindVersionCardLayer,
} from './version-card.mjs';
import { versionCardVals, VCD_OFF, VCD_SHOWN } from '../vals/version-card.js';
import tpl from '../tpl/version-card.tpl.js';
import { BUILD_STAMP } from '../live/build-stamp.mjs';
import { WHATS_NEW_VERSION } from './whats-new.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const STAMP = '2026-11-14.batch7';

// ---- 1. the rule: every cell ---------------------------------------------------------------------------------------------------------------
test('decide: the whole table, against an independently written reference', () => {
  const ref = (i) => {
    if (i.seen === i.stamp) return 'skip-seen';
    if (!i.layerOn) return 'record';
    if (i.reduced) return 'suppress';
    if (!i.visible || i.overlayOpen) return 'wait';
    return 'play';
  };
  let cells = 0;
  for (const seenEq of [true, false]) for (const visible of [true, false]) for (const layerOn of [true, false]) for (const reduced of [true, false]) for (const overlayOpen of [true, false]) {
    const i = { stamp: STAMP, seen: seenEq ? STAMP : '2026-11-01.batch6', visible, layerOn, reduced, overlayOpen };
    assert.equal(decide(i), ref(i), JSON.stringify(i));
    assert.ok(VC_ACTIONS.includes(decide(i)));
    cells++;
  }
  assert.equal(cells, 32);
});

test('decide: the named cells the spec lists', () => {
  const base = { stamp: STAMP, seen: undefined, visible: true, layerOn: true, reduced: false, overlayOpen: false };
  assert.equal(decide({ ...base, seen: STAMP }), 'skip-seen', 'seen first, whatever else is true');
  assert.equal(decide({ ...base, seen: STAMP, layerOn: false, visible: false, reduced: true, overlayOpen: true }), 'skip-seen');
  assert.equal(decide({ ...base, layerOn: false }), 'record', 'layer off, visible');
  assert.equal(decide({ ...base, layerOn: false, visible: false }), 'record', 'layer off, hidden: record at once, never wait');
  assert.equal(decide({ ...base, layerOn: false, reduced: true, overlayOpen: true }), 'record', 'layer off beats reduced and overlay');
  assert.equal(decide({ ...base, reduced: true }), 'suppress');
  assert.equal(decide({ ...base, reduced: true, visible: false }), 'suppress', 'reduced beats wait');
  assert.equal(decide({ ...base, visible: false }), 'wait', 'a hidden launch');
  assert.equal(decide({ ...base, overlayOpen: true }), 'wait');
  assert.equal(decide(base), 'play', 'a first-ever run (no versionCardSeen) with the layer on plays');
  assert.equal(decide({ ...base, layerOn: false }), 'record', 'a first-ever run with the layer off records');
});

test('decide: garbage in never plays', () => {
  assert.equal(decide(), 'skip-seen');
  assert.equal(decide({}), 'skip-seen');
  assert.equal(decide({ stamp: '', seen: '', layerOn: true, visible: true }), 'skip-seen');
  assert.equal(decide({ stamp: 7, seen: 7, layerOn: true, visible: true }), 'skip-seen');
  for (const seen of [null, 0, false, {}, [], 'old', STAMP + ' ']) assert.equal(decide({ stamp: STAMP, seen, layerOn: true, visible: true }), 'play', JSON.stringify(seen));
});

test('overlayOpenOf: every dialog key opens it, a running refresh does, menus and toasts do not', () => {
  assert.equal(overlayOpenOf(null), false);
  assert.equal(overlayOpenOf({}), false);
  for (const k of OVERLAY_KEYS) assert.equal(overlayOpenOf({ [k]: k === 'sheet' ? { x: 1 } : true }), true, k);
  assert.equal(overlayOpenOf({ refreshing: true }), true, 'never during a scan reload');
  assert.equal(overlayOpenOf({ moreOpen: true, pageMore: true, toasts: [{}], paletteQuery: 'x', levelUp: null, sheet: null, whatsNewOpen: false }), false);
});

test('OVERLAY_KEYS are real: each one is a key app.js closeTop knows', () => {
  const app = read('app.js');
  for (const k of OVERLAY_KEYS) assert.ok(app.includes("'" + k + "'"), k + ' is not in app.js');
  assert.ok(OVERLAY_KEYS.includes('whatsNewOpen'), 'the What’s-new overlay is the one the card must never cover');
});

test('reducedNow: the app pref, the OS setting, and a missing or broken matchMedia', () => {
  const yes = () => ({ matches: true }), no = () => ({ matches: false });
  assert.equal(reducedNow({ reduceMotion: true }, no), true);
  assert.equal(reducedNow({ reduceMotion: false }, yes), true);
  assert.equal(reducedNow({ reduceMotion: false }, no), false);
  assert.equal(reducedNow({}, null), false);
  assert.equal(reducedNow(null, () => { throw new Error('x'); }), false);
  let asked = '';
  reducedNow({}, (q) => { asked = q; return { matches: false }; });
  assert.equal(asked, '(prefers-reduced-motion: reduce)');
});

// ---- 2. the machine, against a fake layer ----------------------------------------------------------------------------------------------------
function world(o = {}) {
  const w = {
    seen: o.seen, writes: [], layerOn: o.layerOn !== false, visible: o.visible !== false, reduced: !!o.reduced, overlay: !!o.overlay,
    shows: 0, hides: 0, listeners: [], timers: [], nextId: 1, throwOnMark: !!o.throwOnMark,
    doc: { name: 'document' }, win: { name: 'window' },
  };
  w.deps = {
    stamp: o.stamp || STAMP,
    seen: () => w.seen,
    markSeen: (s) => { if (w.throwOnMark) throw new Error('disk full'); w.writes.push(s); w.seen = s; },
    visible: () => w.visible, layerOn: () => w.layerOn, reduced: () => w.reduced, overlayOpen: () => w.overlay,
    listen: (target, type, fn) => { const l = { id: w.nextId++, target, type, fn }; w.listeners.push(l); return () => { w.listeners = w.listeners.filter((x) => x !== l); }; },
    timer: (fn, ms) => { const t = { id: w.nextId++, fn, ms, done: false }; w.timers.push(t); return () => { t.done = true; }; },
    doc: w.doc, win: w.win,
    show: () => { w.shows++; }, hide: () => { w.hides++; },
  };
  w.probe = () => ({ listeners: w.listeners.length, timers: w.timers.filter((t) => !t.done).length });
  w.fire = (target, type) => { for (const l of w.listeners.slice()) if (l.target === target && l.type === type) l.fn({ type }); };
  w.advance = () => { for (const t of w.timers.slice()) if (!t.done) { t.done = true; t.fn(); } };
  w.make = () => createVersionCard(w.deps);
  return w;
}

test('plays once: shown, marked seen at once, two dismiss listeners and one 1.2 s timer, gone by itself; a reload does not show it again', () => {
  const w = world();
  const vc = w.make();
  assert.equal(vc.start(), 'play');
  assert.equal(w.shows, 1);
  assert.deepEqual(w.writes, [STAMP], 'marked seen the moment it plays');
  assert.deepEqual(w.probe(), { listeners: 2, timers: 1 });
  assert.deepEqual(w.listeners.map((l) => l.type + '@' + l.target.name).sort(), ['keydown@window', 'pointerdown@window']);
  assert.equal(w.timers[0].ms, 1200);
  assert.equal(VC_MS, 1200);
  w.advance();
  assert.equal(w.hides, 1);
  assert.deepEqual(w.probe(), { listeners: 0, timers: 0 });
  assert.equal(vc.status().showing, false);
  // a reload: a new machine, the same storage
  const again = world({ seen: w.seen });
  assert.equal(again.make().start(), 'skip-seen');
  assert.equal(again.shows, 0);
  assert.deepEqual(again.probe(), { listeners: 0, timers: 0 });
  assert.deepEqual(again.writes, []);
});

test('a key press, a pointer press and the timer each dismiss at once and clear everything the card registered', () => {
  for (const how of ['key', 'pointer', 'timer']) {
    const w = world();
    const vc = w.make();
    vc.start();
    if (how === 'key') w.fire(w.win, 'keydown');
    if (how === 'pointer') w.fire(w.win, 'pointerdown');
    if (how === 'timer') w.advance();
    assert.equal(w.hides, 1, how);
    assert.deepEqual(w.probe(), { listeners: 0, timers: 0 }, how + ': the other listener and the timer are gone too');
    assert.equal(w.timers.every((t) => t.done), true, how);
    w.advance(); w.fire(w.win, 'keydown'); w.fire(w.win, 'pointerdown');
    assert.equal(w.hides, 1, how + ': a second dismissal does nothing');
  }
});

test('a new stamp plays again, once', () => {
  const w = world({ seen: '2026-11-01.batch6' });
  assert.equal(w.make().start(), 'play');
  assert.deepEqual(w.writes, [STAMP]);
  const later = world({ seen: w.seen, stamp: '2026-12-01.batch8' });
  assert.equal(later.make().start(), 'play', 'the next build plays again');
  assert.deepEqual(later.writes, ['2026-12-01.batch8']);
});

test('layer OFF: the stamp is recorded at load, whatever the visibility, with no listener, no timer and no card; switching the layer on later does not replay it', () => {
  for (const visible of [true, false]) {
    const w = world({ layerOn: false, visible });
    const vc = w.make();
    assert.equal(vc.start(), 'record');
    assert.deepEqual(w.writes, [STAMP]);
    assert.deepEqual(w.probe(), { listeners: 0, timers: 0 });
    assert.equal(w.shows, 0);
    assert.equal(vc.status().watching, false, 'never waits with the layer off');
    // the owner switches the layer on later: the next load sees the stamp as seen
    const later = world({ seen: w.seen, layerOn: true, visible: true });
    assert.equal(later.make().start(), 'skip-seen');
    assert.equal(later.shows, 0);
  }
});

test('layer ON + hidden launch: ONE visibility listener, kept while still hidden, then plays on the first visible event and removes it', () => {
  const w = world({ visible: false });
  const vc = w.make();
  assert.equal(vc.start(), 'wait');
  assert.deepEqual(w.writes, [], 'not marked while waiting: it has not been seen');
  assert.deepEqual(w.probe(), { listeners: 1, timers: 0 });
  assert.equal(w.listeners[0].type, 'visibilitychange');
  assert.equal(w.listeners[0].target, w.doc);
  w.fire(w.doc, 'visibilitychange');                 // still hidden (a flicker)
  assert.equal(w.shows, 0);
  assert.deepEqual(w.probe(), { listeners: 1, timers: 0 }, 'still one listener, not two');
  w.visible = true;
  w.fire(w.doc, 'visibilitychange');
  assert.equal(w.shows, 1);
  assert.deepEqual(w.writes, [STAMP]);
  assert.deepEqual(w.listeners.map((l) => l.type).sort(), ['keydown', 'pointerdown'], 'the visibility listener is gone; only the two dismiss listeners remain');
  assert.equal(w.probe().timers, 1);
  w.visible = false; w.fire(w.doc, 'visibilitychange'); w.visible = true; w.fire(w.doc, 'visibilitychange');
  assert.equal(w.shows, 1, 'plays at most once per stamp');
});

test('an open dialog waits, and the next visibility event rechecks', () => {
  const w = world({ overlay: true });
  const vc = w.make();
  assert.equal(vc.start(), 'wait');
  assert.equal(w.shows, 0);
  w.fire(w.doc, 'visibilitychange');
  assert.equal(w.shows, 0, 'dialog still open');
  assert.equal(w.probe().listeners, 1);
  w.overlay = false;
  assert.equal(w.probe().timers, 0);
  w.fire(w.doc, 'visibilitychange');
  assert.equal(w.shows, 1);
  assert.equal(w.listeners.some((l) => l.type === 'visibilitychange'), false);
});

test('reduced motion: suppressed (marked seen, nothing shown, nothing registered), even for a hidden launch', () => {
  for (const visible of [true, false]) {
    const w = world({ reduced: true, visible });
    assert.equal(w.make().start(), 'suppress');
    assert.deepEqual(w.writes, [STAMP]);
    assert.equal(w.shows, 0);
    assert.deepEqual(w.probe(), { listeners: 0, timers: 0 });
  }
});

test('a layer that is switched on after a record never plays that stamp (record, then reload, then skip-seen) and a skip never writes again', () => {
  const w = world({ layerOn: false });
  w.make().start();
  const w2 = world({ seen: w.seen });
  w2.make().start();
  assert.deepEqual(w2.writes, []);
});

test('stop() ends a waiting machine and a showing card, and a started machine decides only once', () => {
  const a = world({ visible: false });
  const va = a.make();
  va.start();
  va.stop();
  assert.deepEqual(a.probe(), { listeners: 0, timers: 0 });
  a.visible = true; a.fire(a.doc, 'visibilitychange');
  assert.equal(a.shows, 0, 'a stopped wait never plays');
  const b = world();
  const vb = b.make();
  vb.start();
  assert.equal(vb.start(), 'play', 'start twice returns the same answer');
  assert.equal(b.shows, 1, 'and shows once');
  vb.stop();
  assert.equal(b.hides, 1);
  assert.deepEqual(b.probe(), { listeners: 0, timers: 0 });
  vb.stop();
  assert.equal(b.hides, 1);
});

test('a layer that returns no remover and no canceller is harmless: a stale visibility event decides nothing', () => {
  const w = world({ visible: false });
  w.deps.listen = (target, type, fn) => { w.listeners.push({ id: w.nextId++, target, type, fn }); };   // no remover
  const vc = w.make();
  vc.start();
  w.visible = true;
  w.fire(w.doc, 'visibilitychange');
  assert.equal(w.shows, 1);
  w.fire(w.doc, 'visibilitychange');   // the old listener still fires
  assert.equal(w.shows, 1, 'guarded: it does nothing once the wait is over');
});

test('a stamp that cannot be stored does not throw and the card still plays', () => {
  const w = world({ throwOnMark: true });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(w.make().start(), 'play'); } finally { console.warn = warn; }
  assert.equal(w.shows, 1);
});

// ---- 3. the Component mixin ------------------------------------------------------------------------------------------------------------------
function withGlobals(fn, { prefs = {}, visibility = 'visible' } = {}) {
  const had = { localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), document: Object.getOwnPropertyDescriptor(globalThis, 'document'), window: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  const store = { 'whq3-prefs': JSON.stringify(Object.assign({ whatsNewSeen: WHATS_NEW_VERSION }, prefs)) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: visibility } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try { return fn(store); } finally {
    for (const k of ['localStorage', 'document', 'window']) { if (had[k]) Object.defineProperty(globalThis, k, had[k]); else delete globalThis[k]; }
    bindVersionCardLayer(null);
  }
}
function fakeLayer() {
  const L = { listeners: [], timers: [], layerOn(t, type, fn) { const l = { t, type, fn }; L.listeners.push(l); return () => { L.listeners = L.listeners.filter((x) => x !== l); }; }, layerTimer(fn, ms) { const t = { fn, ms, done: false }; L.timers.push(t); return () => { t.done = true; }; } };
  return L;
}
function component(state) {
  const c = Object.assign(Object.create(versionCardLogic), { state: Object.assign({ consoleLayer: { on: true } }, state), setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); } });
  return c;
}
const stored = (s) => JSON.parse(s['whq3-prefs'])[VC_PREF];

test('mixin: layer on, visible, nothing open: plays, stores the stamp under versionCardSeen, shows through state.vcShow, ends on the timer', () => {
  withGlobals((store) => {
    const L = fakeLayer(); bindVersionCardLayer(L);
    const c = component({});
    assert.equal(c.vcStart(false), 'play');
    assert.equal(c.state.vcShow, true);
    assert.equal(stored(store), BUILD_STAMP);
    assert.deepEqual(JSON.parse(store['whq3-prefs']).whatsNewSeen, WHATS_NEW_VERSION, 'every other pref is kept');
    assert.equal(L.listeners.length, 2);
    assert.equal(L.timers.length, 1);
    L.timers[0].fn();
    assert.equal(c.state.vcShow, false);
    assert.equal(L.listeners.length, 0);
  });
});

test('mixin: no console layer bound, or the layer pref off: records only, nothing registered', () => {
  withGlobals((store) => {
    const L = fakeLayer();
    const off = component({ consoleLayer: { on: false } }); bindVersionCardLayer(L);
    assert.equal(off.vcStart(false), 'record');
    assert.equal(stored(store), BUILD_STAMP);
    assert.equal(L.listeners.length + L.timers.length, 0);
    assert.equal(off.state.vcShow, undefined);
  });
  withGlobals((store) => {
    const unbound = component({});   // the layer pref says on but console-layer was never bound: it cannot register anything, so it only records
    assert.equal(unbound.vcStart(false), 'record');
    assert.equal(stored(store), BUILD_STAMP);
  });
  withGlobals(() => {
    const none = component({ consoleLayer: undefined }); bindVersionCardLayer(fakeLayer());
    assert.equal(none.vcStart(false), 'record', 'no consoleLayer pref at all (the layer dish not in this build)');
  });
});

test('mixin: a hidden launch waits (one listener), then plays on the first visible event', () => {
  withGlobals((store) => {
    const L = fakeLayer(); bindVersionCardLayer(L);
    const c = component({});
    assert.equal(c.vcStart(false), 'wait');
    assert.equal(stored(store), undefined);
    assert.deepEqual(L.listeners.map((l) => l.type), ['visibilitychange']);
    assert.equal(L.listeners[0].t, globalThis.document);
    globalThis.document.visibilityState = 'visible';
    L.listeners[0].fn();
    assert.equal(c.state.vcShow, true);
    assert.equal(stored(store), BUILD_STAMP);
  }, { visibility: 'hidden' });
});

test('mixin: What’s-new just opened, still due, an open dialog or a running scan each hold the card back', () => {
  withGlobals(() => {
    bindVersionCardLayer(fakeLayer());
    assert.equal(component({}).vcStart(true), 'wait', 'maybeShowWhatsNew returned true a moment ago (its setState has not landed)');
  });
  withGlobals(() => {
    bindVersionCardLayer(fakeLayer());
    assert.equal(component({}).vcStart(false), 'wait', 'What’s-new is still due');
  }, { prefs: { whatsNewSeen: 'an older version' } });
  withGlobals(() => {
    bindVersionCardLayer(fakeLayer());
    assert.equal(component({ settingsOpen: true }).vcStart(false), 'wait');
  });
  withGlobals(() => {
    bindVersionCardLayer(fakeLayer());
    const c = component({}); c.scanStatus = () => ({ running: true });
    assert.equal(c.vcStart(false), 'wait', 'never during a scan reload');
  });
  withGlobals(() => {
    const L = fakeLayer(); bindVersionCardLayer(L);
    const c = component({});
    assert.equal(c.vcStart(true), 'wait');
    globalThis.document.visibilityState = 'visible';
    L.listeners[0].fn();
    assert.equal(c.state.vcShow, true, 'the hold is for the first look only; the recheck sees the settled state');
  });
});

test('mixin: reduce motion (the app pref) suppresses and records', () => {
  withGlobals((store) => {
    const L = fakeLayer(); bindVersionCardLayer(L);
    const c = component({ reduceMotion: true });
    assert.equal(c.vcStart(false), 'suppress');
    assert.equal(stored(store), BUILD_STAMP);
    assert.equal(L.listeners.length + L.timers.length, 0);
  });
});

test('mixin: vcStop (the layer switched off, or unmount) takes a showing card down', () => {
  withGlobals(() => {
    const L = fakeLayer(); bindVersionCardLayer(L);
    const c = component({});
    c.vcStart(false);
    c.vcStop();
    assert.equal(c.state.vcShow, false);
    assert.equal(L.listeners.length, 0);
    assert.equal(L.timers.every((t) => t.done), true);
    component({}).vcStop();   // nothing started: harmless
  });
});

test('mixin: the layer is bound only when it has the two registration functions', () => {
  withGlobals(() => {
    bindVersionCardLayer({ layerOn() {} });
    assert.equal(component({}).vcLayerOn(), false);
    bindVersionCardLayer({ layerOn() {}, layerTimer() {} });
    assert.equal(component({}).vcLayerOn(), true);
    assert.equal(component({ consoleLayer: { on: 'yes' } }).vcLayerOn(), false, 'only a real true counts');
  });
});

// ---- 4. render values ---------------------------------------------------------------------------------------------------------------------
const vals = (S) => versionCardVals.call({ state: S }, { S }).vcdv;

test('vals: ONE top-level key, vcdv', () => {
  assert.deepEqual(Object.keys(versionCardVals.call({ state: {} }, { S: {} })), ['vcdv']);
});

test('vals: nothing is rendered when the card is off, not started, or seen', () => {
  assert.equal(vals({}).vcdShow, false);
  assert.equal(vals({ vcShow: false, consoleLayer: { on: true } }).vcdShow, false, 'seen / never started: vcShow is false');
  assert.equal(vals({ vcShow: true }).vcdShow, false, 'no layer pref');
  assert.equal(vals({ vcShow: true, consoleLayer: { on: false } }).vcdShow, false, 'layer off');
  assert.equal(vals({ vcShow: true, consoleLayer: { on: true }, reduceMotion: true }).vcdShow, false, 'reduce motion');
  assert.equal(vals({ vcShow: true, consoleLayer: { on: true }, whatsNewOpen: true }).vcdShow, false, 'a dialog opened over it');
  assert.equal(vals({ vcShow: true, consoleLayer: { on: true }, refreshing: true }).vcdShow, false, 'a scan reload');
});

test('vals: shown only with the card started, the layer on, motion allowed and nothing open; the same frozen constants every time', () => {
  const S = { vcShow: true, consoleLayer: { on: true } };
  const a = vals(S), b = vals(S);
  assert.equal(a.vcdShow, true);
  assert.equal(a, VCD_SHOWN);
  assert.equal(a, b, 'nothing is built per render');
  assert.equal(vals({}), VCD_OFF);
  assert.ok(Object.isFrozen(VCD_OFF) && Object.isFrozen(VCD_SHOWN));
});

test('vals: the caption and the stamp text, and an accessible label that has both', () => {
  assert.equal(VCD_SHOWN.vcdCaption, 'New version inserted');
  assert.equal(VC_CAPTION, 'New version inserted');
  assert.equal(VCD_SHOWN.vcdStamp, BUILD_STAMP);
  assert.equal(VCD_SHOWN.vcdLabel, 'New version inserted, ' + BUILD_STAMP);
  assert.equal(VCD_OFF.vcdCaption, VCD_SHOWN.vcdCaption, 'the text keys always exist, so no binding is ever a hole');
});

test('vals: no animation style when not shown (reduced motion, layer off, anything), and the two animation strings when shown', () => {
  for (const S of [{ vcShow: true, consoleLayer: { on: true }, reduceMotion: true }, { vcShow: true, consoleLayer: { on: false } }, {}]) {
    const v = vals(S);
    assert.equal(v.vcdCardStyle, '');
    assert.equal(v.vcdCartStyle, '');
    for (const val of Object.values(v)) if (typeof val === 'string') assert.doesNotMatch(val, /animation/);
  }
  assert.match(VCD_SHOWN.vcdCardStyle, /animation:hqvcd-card 1200ms linear both/);
  assert.match(VCD_SHOWN.vcdCartStyle, /animation:hqvcd-slide 1200ms /);
  assert.equal(VCD_SHOWN.vcdCardStyle, cardStyle());
  assert.equal(VCD_SHOWN.vcdCartStyle, cartStyle());
  assert.equal(VCD_SHOWN.vcdMs, 1200);
});

test('vals: the OS reduce-motion setting is honoured too, and OFF and SHOWN carry exactly the same keys', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  try { assert.equal(vals({ vcShow: true, consoleLayer: { on: true }, reduceMotion: false }).vcdShow, false); }
  finally { if (had) Object.defineProperty(globalThis, 'matchMedia', had); else delete globalThis.matchMedia; }
  assert.deepEqual(Object.keys(VCD_OFF).sort(), Object.keys(VCD_SHOWN).sort());
});

// ---- 5. the fragment ---------------------------------------------------------------------------------------------------------------------
test('fragment: every vcdv binding resolves, the card is wrapped in vcdShow, and nothing renders without it', () => {
  const names = [...tpl.matchAll(/vcdv\.(\w+)/g)].map((m) => m[1]);
  assert.ok(names.length > 8);
  for (const n of names) assert.ok(n in VCD_OFF, n + ' is not a vcdv key');
  assert.match(tpl, /<sc-if value="\{\{ vcdv\.vcdShow \}\}"/);
  const outside = tpl.split('<sc-if value="{{ vcdv.vcdShow }}"')[0].replace(/<!--[\s\S]*?-->/g, '').trim();
  assert.equal(outside, '', 'no node before the sc-if');
  assert.match(tpl.trim(), /<\/sc-if>\s*$/);
});

test('fragment: a polite status region that takes no focus, has no handler, no sound and no literal colour', () => {
  assert.match(tpl, /role="status"/);
  assert.match(tpl, /aria-live="polite"/);
  assert.doesNotMatch(tpl, /tabindex|autofocus|onClick|onKey|onPointer|<audio|<video|<button|<input/i);
  assert.doesNotMatch(tpl, /#[0-9a-fA-F]{3,8}\b/, 'tokens only');
  assert.doesNotMatch(tpl, /(?:^|[^-\w])(?:rgb|hsl)a?\((?!0,0,0,\.35\))/i, 'the one shadow is the only literal colour');
});

test('fragment: the keyframes exist only inside the card, hold no binding, and are the ones the animation strings name', () => {
  const css = (/<style>([\s\S]*?)<\/style>/.exec(tpl) || [])[1] || '';
  assert.ok(css.length > 50, 'the <style> is in the fragment');
  assert.ok(!css.includes('{{'), 'the runtime would turn a binding inside <style> into a <span>');
  assert.ok(tpl.indexOf('<style>') > tpl.indexOf('<sc-if'), 'inside the sc-if, so it is defined only while shown');
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ['hqvcd-card', 'hqvcd-slide']);
  for (const n of names) assert.ok(cardStyle().includes(n) || cartStyle().includes(n), n);
  assert.match(css, /100%\s*\{\s*opacity:\s*0/, 'the card fades out by the end of the 1.2 s');
});

test('fragment: the static viewBox is the one the logic names, and every path is a real value', () => {
  assert.ok(tpl.includes('viewBox="' + CARD_VIEWBOX + '"'));
  const P = cartridgePaths();
  assert.deepEqual(Object.keys(P).sort(), ['contacts', 'label', 'ridges', 'shell', 'slotMouth', 'slotPlate']);
  for (const [k, d] of Object.entries(P)) { assert.match(d, /^M[\d. MHVLQZ-]+$/, k); assert.doesNotMatch(d, /NaN|undefined/, k); }
  assert.equal(VCD_SHOWN.vcdShell, P.shell);
});

test('fragment: the status overlay sits above the page and below the toasts, covers the screen, and swallows the press', () => {
  const s = cardStyle();
  assert.match(s, /position:fixed;inset:0/);
  assert.match(s, /pointer-events:auto/);
  const z = Number(/z-index:(\d+)/.exec(s)[1]);
  assert.ok(z > 1200 && z < 1300, 'toasts are at 1300');
});

// ---- contrast: the plate is the opaque --card-hi, so the text colours are checked against it in both themes ---------------------------------
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function themeTokens() {
  const css = fs.readFileSync(path.join(SRC, '..', 'styles', 'tokens.css'), 'utf8');
  const block = (re) => { const m = re.exec(css); const o = {}; if (m) for (const x of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) o[x[1]] = x[2]; return o; };
  const dark = block(/^\[data-hq-theme\]\s*\{([^}]*)\}/m);
  const light = Object.assign({}, dark, block(/^\[data-hq-theme="light"\]\s*\{([^}]*)\}/m));
  return { dark, light };
}
test('contrast: the caption (--text) and the stamp (--muted) on the plate (--card-hi) are AA in both themes', () => {
  const T = themeTokens();
  for (const theme of ['dark', 'light']) {
    const t = T[theme];
    assert.ok(t['card-hi'] && t.text && t.muted, theme + ' tokens parsed');
    assert.ok(ratio(t.text, t['card-hi']) >= 4.5, theme + ' caption ' + ratio(t.text, t['card-hi']).toFixed(2));
    assert.ok(ratio(t.muted, t['card-hi']) >= 4.5, theme + ' stamp ' + ratio(t.muted, t['card-hi']).toFixed(2));
  }
  assert.match(tpl, /background:var\(--card-hi\)/);
  assert.match(tpl, /data-vcd="caption"[^>]*color:var\(--text\)/);
  assert.match(tpl, /data-vcd="stamp"[^>]*color:var\(--muted\)/);
});

// ---- the master-switch rule and "no sound at all" ----------------------------------------------------------------------------------------
const DISH_FILES = ['logic/version-card.mjs', 'vals/version-card.js', 'tpl/version-card.tpl.js', 'live/build-stamp.mjs', 'selftest-version-card.mjs', '../tools/cdp-version-card.mjs'];
test('source: no raw listener, timer or frame outside console-layer.mjs, and no sound call, in any file of this dish', () => {
  for (const f of DISH_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(addEventListener|removeEventListener|setInterval|setTimeout|clearTimeout|clearInterval|requestAnimationFrame|cancelAnimationFrame|queueMicrotask)\b/, f);
    if (!f.includes('cdp-')) assert.doesNotMatch(src, /\b(sfx|AudioContext|HQFx|FX\s*\(|new Audio|\.play\s*\()/, f + ' makes no sound');   // the cdp harness counts AudioContext constructions on purpose
  }
});

test('source: the machine and the mixin register only through deps.listen / deps.timer (the layer), and read no document method', () => {
  const src = read('logic/version-card.mjs');
  assert.match(src, /d\.listen\(d\.doc, 'visibilitychange'/);
  assert.match(src, /d\.listen\(d\.win, 'keydown'/);
  assert.match(src, /d\.listen\(d\.win, 'pointerdown'/);
  assert.match(src, /d\.timer\(dismiss, VC_MS\)/);
  assert.match(src, /LAYER\.layerOn\(t, type, fn\)/);
  assert.match(src, /LAYER\.layerTimer\(fn, ms, \{ once: true \}\)/, 'the timer is ONE shot (without once the layer makes a repeating interval)');
  assert.doesNotMatch(src, /\.focus\s*\(|\.blur\s*\(|preventDefault|stopPropagation/, 'focus is never stolen and no key is swallowed');
});

// ---- the selftest rows --------------------------------------------------------------------------------------------------------------------
import { versionCardStates, checkRow, VCD_STATE_KEYS } from '../selftest-version-card.mjs';

test('selftest rows: vcd- names, every row sets every key it touches, and the vals agree with each row’s expectation', () => {
  const rows = versionCardStates();
  assert.ok(rows.length >= 6);
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length, 'unique names');
  for (const r of rows) {
    assert.match(r.name, /^vcd-/);
    assert.equal(r.tab, 'home');
    assert.deepEqual(Object.keys(r.patch).sort(), [...VCD_STATE_KEYS].sort(), r.name + ' sets all four keys, so it inherits nothing');
    assert.equal(vals(r.patch).vcdShow, r.shown, r.name);
  }
  assert.ok(rows.some((r) => r.shown) && rows.some((r) => !r.shown));
  assert.ok(rows.some((r) => r.patch.reduceMotion) && rows.some((r) => r.patch.settingsOpen) && rows.some((r) => r.patch.consoleLayer.skin));
});

test('selftest checkRow: a shown row needs the card, the caption and the stamp; a hidden row needs no card', () => {
  const [idle, showing] = versionCardStates();
  assert.deepEqual(checkRow(idle, { present: false, text: '' }), []);
  assert.equal(checkRow(idle, { present: true, text: 'x' }).length, 1);
  assert.deepEqual(checkRow(showing, { present: true, text: VC_CAPTION + ' ' + BUILD_STAMP }), []);
  assert.equal(checkRow(showing, { present: false, text: '' }).length, 1);
  assert.equal(checkRow(showing, { present: true, text: VC_CAPTION }).length, 1, 'the stamp is missing');
  assert.equal(checkRow(showing, { present: true, text: BUILD_STAMP }).length, 1, 'the caption is missing');
  assert.equal(checkRow(showing).length, 1);
});
