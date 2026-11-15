// node --test dashboard-v5/src/logic/delights.test.mjs
// Small delights: the attract eligibility table, the controller (fake layer + manual clock: arming, idle start, instant stop, the loop cap, blockers, the
// probe-shaped counts), the mixin (back room, Escape, found list), the vals (one key, slot only with the empty-Brief card, room closed by default), the
// template bindings, the selftest rows and the source test (no raw listener or timer in this dish's files).
// Placeholder data only: invented brief items, no owner names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATTRACT_IDLE_MS, ATTRACT_LOOP_MS, ATTRACT_MAX_LOOPS, ATTRACT_INPUTS, OVERLAY_FLAGS, ROOM_CODE, ROOM_NOTE, ROOM_TITLE,
  attractOk, overlayOpen, isTextField, readDomEnv, reducedNow, addFound, createAttract, delightsLogic, delightsInitState,
} from './delights.mjs';
import { delightsVals, briefEmptyNow, ROOM_CARTRIDGES } from '../vals/delights.js';
import { SEASONS } from './seasons.mjs';
import { delightsStates, DLX_FIXED_MS } from '../selftest-delights.mjs';

const GOOD = Object.freeze({ idleMs: 90000, selectionText: '', dialogOpen: false, reduced: false, layerOn: true, allClearVisible: true, pageVisible: true });

// ---- attractOk ----------------------------------------------------------------------------------------------------------------------------------
test('attractOk: all good is true, and each blocker ALONE blocks', () => {
  assert.equal(attractOk(GOOD), true);
  const blockers = {
    'idle too short': { idleMs: 89999 }, 'no idle reading': { idleMs: undefined }, 'idle NaN': { idleMs: NaN },
    'text selected': { selectionText: 'x' }, 'whitespace selection counts as selected': { selectionText: ' ' }, 'selection unknown': { selectionText: undefined },
    'dialog open': { dialogOpen: true }, 'dialog unknown': { dialogOpen: undefined },
    'reduced motion': { reduced: true }, 'reduced unknown': { reduced: undefined },
    'layer off': { layerOn: false }, 'layer unknown': { layerOn: undefined },
    'card hidden': { allClearVisible: false }, 'card unknown': { allClearVisible: 'yes' },
    'page hidden': { pageVisible: false }, 'page unknown': { pageVisible: 1 },
  };
  for (const [why, over] of Object.entries(blockers)) assert.equal(attractOk({ ...GOOD, ...over }), false, why);
});

test('attractOk: exactly 90 s of idle is enough, never less; a shortened threshold (the gates’ hook) only moves the bar, nothing else', () => {
  assert.equal(ATTRACT_IDLE_MS, 90000);
  assert.equal(attractOk({ ...GOOD, idleMs: 90000 }), true);
  assert.equal(attractOk({ ...GOOD, idleMs: 120000 }), true);
  assert.equal(attractOk({ ...GOOD, idleMs: 400 }), false);
  assert.equal(attractOk({ ...GOOD, idleMs: 400, thresholdMs: 400 }), true);
  assert.equal(attractOk({ ...GOOD, idleMs: 399, thresholdMs: 400 }), false);
  assert.equal(attractOk({ ...GOOD, idleMs: 400, thresholdMs: 400, layerOn: false }), false, 'a short threshold never overrides a blocker');
  assert.equal(attractOk({ ...GOOD, idleMs: 100, thresholdMs: 0 }), false, 'a zero threshold is ignored, not "always"');
  for (const bad of [null, undefined, 5, 'x', []]) assert.equal(attractOk(bad), false);
});

test('overlayOpen: every flag of closeTop’s list (and the back room) blocks, none set is clear', () => {
  assert.equal(overlayOpen({}), false);
  assert.equal(overlayOpen(null), false);
  assert.equal(overlayOpen({ settingsOpen: false, paletteOpen: false, askOpen: false }), false);
  for (const k of OVERLAY_FLAGS) assert.equal(overlayOpen({ [k]: true }), true, k);
  for (const k of ['paletteOpen', 'settingsOpen', 'dlxRoom', 'confirm', 'cheatOpen']) assert.ok(OVERLAY_FLAGS.includes(k), k);
  assert.equal(overlayOpen({ commit: { id: 'x' } }), true, 'an object flag counts');
});

test('isTextField: input, textarea, select, contenteditable, role textbox; buttons and checkboxes are not text fields', () => {
  const el = (o) => ({ tagName: 'DIV', type: '', isContentEditable: false, getAttribute: () => null, ...o });
  assert.equal(isTextField(el({ tagName: 'INPUT', type: 'text' })), true);
  assert.equal(isTextField(el({ tagName: 'INPUT', type: 'search' })), true);
  assert.equal(isTextField(el({ tagName: 'INPUT', type: 'password' })), true);
  assert.equal(isTextField(el({ tagName: 'INPUT' })), true, 'no type = text');
  assert.equal(isTextField(el({ tagName: 'TEXTAREA' })), true);
  assert.equal(isTextField(el({ tagName: 'SELECT' })), true);
  assert.equal(isTextField(el({ isContentEditable: true })), true);
  assert.equal(isTextField(el({ getAttribute: (n) => (n === 'contenteditable' ? 'true' : null) })), true);
  assert.equal(isTextField(el({ getAttribute: (n) => (n === 'role' ? 'textbox' : null) })), true);
  assert.equal(isTextField(el({ getAttribute: (n) => (n === 'role' ? 'combobox' : null) })), true);
  assert.equal(isTextField(el({ tagName: 'INPUT', type: 'checkbox' })), false);
  assert.equal(isTextField(el({ tagName: 'INPUT', type: 'button' })), false);
  assert.equal(isTextField(el({ tagName: 'BUTTON' })), false);
  assert.equal(isTextField(null), false);
  assert.equal(isTextField(undefined), false);
});

// ---- the page readers ----------------------------------------------------------------------------------------------------------------------------
const fakeDoc = (o = {}) => ({
  visibilityState: 'visible', hidden: false, activeElement: null, documentElement: { dataset: {} },
  querySelector: (sel) => {
    if (sel.includes('role="dialog"')) return o.dialog ? { role: 'dialog' } : null;
    if (sel.includes('data-dlx')) return o.noAnchor ? null : { getBoundingClientRect: () => o.rect || { top: 120, left: 40 } };
    return null;
  }, ...o.over,
});
const fakeWin = (o = {}) => ({ innerWidth: 1200, innerHeight: 800, getSelection: () => ({ toString: () => o.selection || '' }), matchMedia: () => ({ matches: !!o.osReduce }), ...o.over });

test('readDomEnv: a clear page reads clear; a selection, a dialog, a focused field, a hidden page or an off-screen anchor each read as blocked', () => {
  const clear = readDomEnv(fakeDoc(), fakeWin());
  assert.deepEqual(clear, { selectionText: '', dialogOpen: false, pageVisible: true, anchorVisible: true });
  assert.equal(readDomEnv(fakeDoc(), fakeWin({ selection: 'some words' })).selectionText, 'some words');
  assert.equal(readDomEnv(fakeDoc({ dialog: true }), fakeWin()).dialogOpen, true);
  assert.equal(readDomEnv(fakeDoc({ over: { activeElement: { tagName: 'TEXTAREA' } } }), fakeWin()).dialogOpen, true);
  assert.equal(readDomEnv(fakeDoc({ over: { visibilityState: 'hidden', hidden: true } }), fakeWin()).pageVisible, false);
  assert.equal(readDomEnv(fakeDoc({ rect: { top: 900, left: 10 } }), fakeWin()).anchorVisible, false, 'below the fold');
  assert.equal(readDomEnv(fakeDoc({ rect: { top: -5, left: 10 } }), fakeWin()).anchorVisible, false, 'above the fold');
  assert.equal(readDomEnv(fakeDoc({ noAnchor: true }), fakeWin()).anchorVisible, false);
});

test('readDomEnv: a probe that cannot answer blocks, it never reads as clear', () => {
  const boom = () => { throw new Error('no'); };
  const r = readDomEnv({ querySelector: boom, get visibilityState() { return boom(); } }, { getSelection: boom });
  assert.equal(r.selectionText, '?');
  assert.equal(r.dialogOpen, true);
  assert.equal(r.pageVisible, false);
  assert.equal(r.anchorVisible, false);
  const none = readDomEnv(null, null);
  assert.equal(none.pageVisible, false);
  assert.notEqual(none.selectionText, '');
  assert.equal(attractOk({ ...GOOD, ...none, dialogOpen: none.dialogOpen }), false);
});

test('reducedNow: the pref, the OS media query or the root attribute alone each mean reduced; an unreadable query reads as reduced', () => {
  assert.equal(reducedNow({ reduceMotion: false }, fakeWin()), false);
  assert.equal(reducedNow({ reduceMotion: true }, fakeWin()), true);
  assert.equal(reducedNow({}, fakeWin({ osReduce: true })), true);
  const attr = fakeWin(); attr.document = { documentElement: { dataset: { hqReduce: '1' } } };
  assert.equal(reducedNow({}, attr), true);
  assert.equal(reducedNow({}, fakeWin({ over: { matchMedia: () => { throw new Error('x'); } } })), true);
  assert.equal(reducedNow({}, null), false, 'no window (a plain Node host) = no media query to obey');
});

test('addFound: names only, no duplicates, the same array when nothing changes', () => {
  assert.deepEqual(addFound(undefined, 'backroom'), ['backroom']);
  assert.deepEqual(addFound(['bit'], 'backroom'), ['bit', 'backroom']);
  const have = ['bit', 'backroom'];
  assert.equal(addFound(have, 'backroom'), have);
  assert.deepEqual(addFound(['bit', 3, null], 'dance'), ['bit', 'dance']);
  assert.deepEqual(addFound(['bit'], ''), ['bit']);
  assert.deepEqual(addFound(['bit'], 7), ['bit']);
});

// ---- the controller -------------------------------------------------------------------------------------------------------------------------------
// a fake Console layer (counts like its probe), a manual clock, and a recorder for what the controller announces
function rig(over = {}) {
  let t = 1_000_000;
  const listeners = [], timers = [], told = [];
  let seq = 0;
  const layer = {
    on(target, type, fn) { const rec = { id: ++seq, target, type, fn }; listeners.push(rec); return () => { const i = listeners.indexOf(rec); if (i >= 0) listeners.splice(i, 1); }; },
    timer(fn, ms) { const rec = { id: ++seq, at: t + ms, ms, fn }; timers.push(rec); return over.noCancel ? undefined : () => { const i = timers.indexOf(rec); if (i >= 0) timers.splice(i, 1); }; },
  };
  const state = { layerOn: true, allClearVisible: true, reduced: false, selectionText: '', dialogOpen: false, pageVisible: true };
  const win = { name: 'win' }, doc = { name: 'doc' };
  const ctl = createAttract({
    layer, win, doc, now: () => t, idleMs: () => over.idle || ATTRACT_IDLE_MS, read: () => ({ ...state, ...(over.readOver || {}) }),
    onChange: (c) => told.push({ ...c }),
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); t = next.at; next.fn();
    }
    t = end;
  };
  const input = (type) => { const rec = listeners.find((l) => l.type === type); assert.ok(rec, 'a ' + type + ' listener is registered'); rec.fn({ type }); };
  const cond = (o) => ({ layerOn: true, allClearVisible: true, reduced: false, pageVisible: true, ...(o || {}) });
  return { ctl, layer, listeners, timers, told, state, advance, input, cond, win, doc, now: () => t };
}
const counts = (r) => ({ listeners: r.listeners.length, timers: r.timers.length });

test('controller: eligible arms exactly the input listeners and ONE timer; nothing is read until the timer fires', () => {
  let reads = 0;
  const r = rig({ readOver: { get layerOn() { reads++; return true; } } });
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 }, 'nothing before sync');
  r.ctl.sync(r.cond());
  assert.deepEqual(counts(r), { listeners: ATTRACT_INPUTS.length, timers: 1 });
  assert.equal(r.timers[0].ms, 90000);
  assert.equal(reads, 0, 'the page is not polled while idle');
  assert.equal(r.listeners.filter((l) => l.target === r.win).length, 8);
  assert.equal(r.listeners.filter((l) => l.target === r.doc).length, 1);
  for (const [, type] of ATTRACT_INPUTS) assert.ok(r.listeners.some((l) => l.type === type), type);
  for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) assert.ok(r.listeners.some((l) => l.type === t), 'listens for ' + t);
  assert.deepEqual(r.told, []);
});

test('controller: each condition missing means no listener and no timer at all', () => {
  for (const off of [{ layerOn: false }, { allClearVisible: false }, { reduced: true }, { pageVisible: false }, { layerOn: undefined }, { reduced: undefined }]) {
    const r = rig();
    r.ctl.sync(r.cond(off));
    assert.deepEqual(counts(r), { listeners: 0, timers: 0 }, JSON.stringify(off));
  }
  const r = rig(); r.ctl.sync(); r.ctl.sync(null);
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 });
});

test('controller: after 90 s idle the scene starts (3 loops of 6 s) and the timer becomes the run’s end', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  r.advance(89999);
  assert.deepEqual(r.told, []);
  r.advance(1);
  assert.deepEqual(r.told, [{ running: true, loops: 3 }]);
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, ATTRACT_MAX_LOOPS * ATTRACT_LOOP_MS);
  assert.equal(r.ctl.status().running, true);
  assert.equal(r.listeners.length, ATTRACT_INPUTS.length, 'the listeners stay while it plays: that is how it stops');
});

test('controller: input before 90 s postpones the start by the time already waited (the idle clock re-arms on input)', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  r.advance(60000);
  r.input('mousemove');
  r.advance(30000);   // the original timer fires at 90 s: only 30 s of idle
  assert.deepEqual(r.told, []);
  assert.equal(r.timers.length, 1, 'still one timer');
  assert.equal(r.timers[0].ms, 60000, 'the rest of the idle spell');
  r.advance(59999);
  assert.deepEqual(r.told, []);
  r.advance(1);
  assert.deepEqual(r.told, [{ running: true, loops: 3 }]);
});

test('controller: ANY pointer, key, wheel or touch input stops it at once, synchronously, and the idle spell starts over', () => {
  for (const type of ['pointerdown', 'pointermove', 'mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'touchmove']) {
    const r = rig();
    r.ctl.sync(r.cond());
    r.advance(90000);
    assert.equal(r.ctl.status().running, true, type);
    r.input(type);
    assert.deepEqual(r.told.at(-1), { running: false, loops: 3 }, type + ' stops it synchronously');
    assert.equal(r.ctl.status().running, false);
    assert.equal(r.timers.length, 1, 'one new idle timer');
    assert.equal(r.timers[0].ms, 90000);
  }
});

test('controller: a hidden page stops a running scene', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  r.advance(90000);
  r.input('visibilitychange');
  assert.equal(r.ctl.status().running, false);
});

test('controller: a loop that was started counts, so three interruptions end the visit (at most 3 loops, then it rests with nothing registered)', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  for (let n = 1; n <= 3; n++) {
    r.advance(90000);
    assert.equal(r.ctl.status().running, true, 'run ' + n);
    r.advance(1000);
    r.input('keydown');
    assert.equal(r.ctl.status().loopsUsed, n);
  }
  assert.equal(r.ctl.status().rested, true);
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 }, 'rested: every listener and the timer are gone');
  r.ctl.sync(r.cond());
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 }, 'the same visit never re-arms');
  r.ctl.sync(r.cond({ allClearVisible: false }));
  r.ctl.sync(r.cond());
  assert.deepEqual(counts(r), { listeners: ATTRACT_INPUTS.length, timers: 1 }, 'a new visit to the card arms again');
  assert.equal(r.ctl.status().loopsUsed, 0);
});

test('controller: an interrupted run plays only the loops it has left next time; a cut at 7 s of a 6 s loop counts as two', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  r.advance(90000);
  r.advance(7000);
  r.input('wheel');
  assert.equal(r.ctl.status().loopsUsed, 2);
  r.advance(90000);
  assert.deepEqual(r.told.at(-1), { running: true, loops: 1 });
  assert.equal(r.timers[0].ms, ATTRACT_LOOP_MS);
});

test('controller: playing to the end rests: scene gone, listeners and timer removed, no replay in the same visit', () => {
  const r = rig();
  r.ctl.sync(r.cond());
  r.advance(90000);
  r.advance(ATTRACT_MAX_LOOPS * ATTRACT_LOOP_MS);
  assert.deepEqual(r.told.map((x) => x.running), [true, false, false].slice(0, r.told.length));
  assert.equal(r.told.at(-1).running, false);
  assert.equal(r.ctl.status().rested, true);
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 });
  r.advance(10 * 60 * 1000);
  assert.equal(r.told.filter((x) => x.running).length, 1, 'it ran once');
});

test('controller: a blocker at the moment it would start (selection, dialog, hidden card, reduced motion) skips this spell and asks again after another full idle spell', () => {
  for (const blocker of [{ selectionText: 'a word' }, { dialogOpen: true }, { allClearVisible: false }, { reduced: true }, { pageVisible: false }, { layerOn: false }]) {
    const r = rig({ readOver: blocker });
    r.ctl.sync(r.cond());
    r.advance(90000);
    assert.deepEqual(r.told, [], JSON.stringify(blocker));
    assert.equal(r.ctl.status().running, false);
    assert.equal(r.timers.length, 1);
    assert.equal(r.timers[0].ms, 90000, 'a whole new spell');
  }
  const r = rig();
  r.state.selectionText = 'a word';
  const r2 = rig({ readOver: { selectionText: 'x' } });
  r2.ctl.sync(r2.cond()); r2.advance(90000);
  assert.deepEqual(r2.told, []);
  assert.ok(r);
});

test('controller: the page is read only when the timer fires, and a failing read blocks instead of starting', () => {
  let reads = 0;
  let t = 0, fire = null;
  const ctl = createAttract({
    layer: { on: () => () => {}, timer: (fn) => { fire = fn; return () => {}; } }, win: {}, doc: {}, now: () => t, read: () => { reads++; throw new Error('probe down'); }, onChange: () => {},
  });
  ctl.sync({ layerOn: true, allClearVisible: true, reduced: false, pageVisible: true });
  assert.equal(reads, 0);
  t = 90000; fire();
  assert.equal(reads, 1);
  assert.equal(ctl.status().running, false);
});

test('controller: the card leaving the screen, the layer going off, reduced motion or a hidden page disarm everything and stop a running scene', () => {
  for (const off of [{ allClearVisible: false }, { layerOn: false }, { reduced: true }, { pageVisible: false }]) {
    const r = rig();
    r.ctl.sync(r.cond());
    r.advance(90000);
    assert.equal(r.ctl.status().running, true);
    r.ctl.sync(r.cond(off));
    assert.equal(r.told.at(-1).running, false, JSON.stringify(off));
    assert.deepEqual(counts(r), { listeners: 0, timers: 0 }, JSON.stringify(off));
  }
});

test('controller: sync is idempotent (a render storm registers nothing twice) and destroy removes everything', () => {
  const r = rig();
  for (let i = 0; i < 20; i++) r.ctl.sync(r.cond());
  assert.deepEqual(counts(r), { listeners: ATTRACT_INPUTS.length, timers: 1 });
  r.ctl.destroy();
  assert.deepEqual(counts(r), { listeners: 0, timers: 0 });
  r.ctl.destroy();
});

test('controller: a layer whose timer cannot be cancelled still never fires a stale callback, and one whose undo throws does not break disarm', () => {
  const r = rig({ noCancel: true });
  r.ctl.sync(r.cond());
  const stale = r.timers[0];
  r.ctl.sync(r.cond({ allClearVisible: false }));
  stale.fn();
  assert.deepEqual(r.told, []);
  assert.equal(r.ctl.status().running, false);

  const bad = createAttract({ layer: { on: () => () => { throw new Error('already gone'); }, timer: () => () => { throw new Error('gone'); } }, win: {}, doc: {}, now: () => 0, read: () => ({}), onChange: () => {} });
  bad.sync({ layerOn: true, allClearVisible: true, reduced: false, pageVisible: true });
  assert.doesNotThrow(() => bad.sync({ layerOn: false, allClearVisible: false, reduced: false, pageVisible: true }));
  assert.equal(bad.status().armed, false);
});

test('controller: a layer that returns objects (off / cancel) instead of functions is understood; one that returns nothing is tolerated', () => {
  let offs = 0, cancels = 0;
  const a = createAttract({ layer: { on: () => ({ off: () => { offs++; } }), timer: () => ({ cancel: () => { cancels++; } }) }, win: {}, doc: {}, now: () => 0, read: () => ({}), onChange: () => {} });
  a.sync({ layerOn: true, allClearVisible: true, reduced: false, pageVisible: true });
  a.sync({ layerOn: false });
  assert.equal(offs, ATTRACT_INPUTS.length);
  assert.ok(cancels >= 1);
  const b = createAttract({ layer: { on: () => undefined, timer: () => undefined }, win: {}, doc: {}, now: () => 0, read: () => ({}), onChange: () => {} });
  b.sync({ layerOn: true, allClearVisible: true, reduced: false, pageVisible: true });
  assert.doesNotThrow(() => b.destroy());
});

// ---- the mixin ------------------------------------------------------------------------------------------------------------------------------------
function host(state = {}) {
  const self = Object.assign(Object.create(delightsLogic), {
    state: { consoleLayer: { on: true }, dlxRoom: false, dlxRun: false, cheatsFound: [], ...state },
    setState(p) { const patch = typeof p === 'function' ? p(this.state) : p; if (patch) Object.assign(this.state, patch); },
  });
  return self;
}

test('back room: opens only while the layer is on, records its name once, and closes with Escape', () => {
  const off = host({ consoleLayer: { on: false } });
  assert.equal(off.dlxOpenRoom(), false);
  assert.equal(off.state.dlxRoom, false);
  assert.deepEqual(off.state.cheatsFound, []);

  const h = host();
  assert.equal(h.dlxOpenRoom(), true);
  assert.equal(h.state.dlxRoom, true);
  assert.deepEqual(h.state.cheatsFound, [ROOM_CODE]);
  assert.equal(ROOM_CODE, 'backroom');
  assert.equal(h.dlxEscape(), true, 'Escape closes it');
  assert.equal(h.state.dlxRoom, false);
  assert.equal(h.dlxEscape(), false, 'nothing open: Escape is left to the next handler');
  h.dlxOpenRoom();
  assert.deepEqual(h.state.cheatsFound, [ROOM_CODE], 'found once, however often it is opened');
  h.dlxCloseRoom();
  assert.equal(h.state.dlxRoom, false);
  assert.doesNotThrow(() => h.dlxCloseRoom());
});

test('back room: cheatsFound keeps what was found before (names only)', () => {
  const h = host({ cheatsFound: ['bit', 'cartridge'] });
  h.dlxOpenRoom();
  assert.deepEqual(h.state.cheatsFound, ['bit', 'cartridge', 'backroom']);
});

test('the test hooks: the idle threshold can only be made shorter, the clock is injected, and the defaults are the real ones', () => {
  const h = host();
  assert.equal(h.dlxIdleMs(), 90000);
  h._dlxIdleMs = 400; assert.equal(h.dlxIdleMs(), 400);
  h._dlxIdleMs = 120000; assert.equal(h.dlxIdleMs(), 90000, 'never longer');
  h._dlxIdleMs = -5; assert.equal(h.dlxIdleMs(), 90000);
  h._dlxIdleMs = NaN; assert.equal(h.dlxIdleMs(), 90000);
  h._dlxClock = () => DLX_FIXED_MS;
  assert.equal(h.dlxNowDate().getTime(), DLX_FIXED_MS);
  assert.equal(h.dlxMs() > 1e12, true, 'the idle clock is wall time unless a test sets one');
  h._dlxMs = () => 42; assert.equal(h.dlxMs(), 42);
});

test('dlxSync with the layer off and nothing of ours alive costs nothing: no microtask is queued', () => {
  const h = host({ consoleLayer: { on: false } });
  h.dlxSync({ layerOn: false, allClearVisible: false });
  assert.notEqual(h._dlxPending, true);
  assert.equal(h._dlxCtl, undefined);
  const hold = host(); hold._dlxHold = true; hold.dlxSync({ layerOn: true, allClearVisible: true });
  assert.notEqual(hold._dlxPending, true, 'a selftest row’s own state is never replaced');
});

test('dlxSync through a bound layer in a page-shaped host arms the controller, and turning the layer off removes everything and closes the room', async () => {
  const saved = { w: globalThis.window, d: globalThis.document };
  const listeners = [], timers = [];
  const win = fakeWin(), doc = fakeDoc();
  win.document = doc;
  globalThis.window = win; globalThis.document = doc;
  try {
    const h = host({ dlxRoom: true });
    h._dlxMs = () => 5000;
    h.dlxBind({
      layerOn: (t, type, fn, opts) => { const rec = { t, type, fn, opts }; listeners.push(rec); return () => listeners.splice(listeners.indexOf(rec), 1); },
      layerTimer: (fn, ms, opts) => { const rec = { fn, ms, opts }; timers.push(rec); return () => timers.splice(timers.indexOf(rec), 1); },
    });
    h.dlxSync({ layerOn: true, allClearVisible: true });
    await Promise.resolve();
    assert.equal(listeners.length, ATTRACT_INPUTS.length);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 90000);
    assert.equal(timers[0].opts.once, true, 'the real layerTimer is an interval unless it is asked for a one-shot');
    assert.ok(listeners.every((l) => l.opts && l.opts.passive === true && l.opts.capture === true), 'inputs are passive and captured');
    assert.equal(h.state.dlxRoom, true, 'the room stays while the layer is on');
    h.state.consoleLayer = { on: false };
    h.dlxSync({ layerOn: false, allClearVisible: false });
    await Promise.resolve();
    assert.equal(listeners.length, 0); assert.equal(timers.length, 0);
    assert.equal(h.state.dlxRoom, false, 'the room closes with the layer');
    h.dlxCleanup();
    h.dlxBind(null);
  } finally { globalThis.window = saved.w; globalThis.document = saved.d; if (saved.w === undefined) delete globalThis.window; if (saved.d === undefined) delete globalThis.document; }
});

test('dlxSync: a layer that reports itself detached arms nothing (its calls would be no-ops), and arms once it is attached', async () => {
  const saved = { w: globalThis.window, d: globalThis.document };
  const listeners = [], timers = [];
  const win = fakeWin(), doc = fakeDoc();
  win.document = doc;
  globalThis.window = win; globalThis.document = doc;
  try {
    let attached = false;
    const h = host();
    h.dlxBind({ isAttached: () => attached, layerOn: (t, ty, fn) => { listeners.push(fn); return () => {}; }, layerTimer: (fn) => { timers.push(fn); return () => {}; } });
    h.dlxSync({ layerOn: true, allClearVisible: true });
    await Promise.resolve();
    assert.equal(listeners.length + timers.length, 0, 'detached: nothing registered');
    attached = true;
    h.dlxSync({ layerOn: true, allClearVisible: true });
    await Promise.resolve();
    assert.equal(listeners.length, ATTRACT_INPUTS.length);
    assert.equal(timers.length, 1);
    h.dlxCleanup();
  } finally { globalThis.window = saved.w; globalThis.document = saved.d; if (saved.w === undefined) delete globalThis.window; if (saved.d === undefined) delete globalThis.document; }
});

test('dlxSync: the scene starts through the mixin once idle, with text selected it does not, and the run flag follows', async () => {
  const saved = { w: globalThis.window, d: globalThis.document };
  const timers = [];
  let selection = 'chosen words';
  const win = fakeWin({ over: { getSelection: () => ({ toString: () => selection }) } }), doc = fakeDoc();
  win.document = doc;
  globalThis.window = win; globalThis.document = doc;
  try {
    const h = host();
    let t = 0; h._dlxMs = () => t; h._dlxIdleMs = 400;
    h.dlxBind({ layerOn: () => () => {}, layerTimer: (fn, ms) => { const rec = { fn, ms }; timers.push(rec); return () => timers.splice(timers.indexOf(rec), 1); } });
    h.dlxSync({ layerOn: true, allClearVisible: true });
    await Promise.resolve();
    assert.equal(timers[0].ms, 400);
    t = 400; timers.shift().fn();
    assert.equal(h.state.dlxRun, false, 'text is selected: it does not start');
    selection = '';
    t = 800; timers.shift().fn();
    assert.equal(h.state.dlxRun, true);
    assert.equal(h.state.dlxLoops, 3);
    h.dlxCleanup();
    assert.equal(h.state.dlxRun, false, 'cleanup stops a running scene');
  } finally { globalThis.window = saved.w; globalThis.document = saved.d; if (saved.w === undefined) delete globalThis.window; if (saved.d === undefined) delete globalThis.document; }
});

// ---- the vals ---------------------------------------------------------------------------------------------------------------------------------------
const BRIEF_EMPTY = { loaded: true, error: '', brief: { items: [], more: 0, overflow: [], standing: [], errors: [] } };
const BRIEF_BUSY = { loaded: true, error: '', brief: { items: [{ key: 'a:b:1', text: 'Placeholder item' }], more: 0, overflow: [], standing: [], errors: [] } };
function valsFor(S, { brief = BRIEF_EMPTY, live = true, hq = { brief: {} }, clock } = {}) {
  const self = Object.assign(Object.create(delightsLogic), {
    state: { tab: 'home', route: null, consoleLayer: { on: true }, ...S }, hq,
    setState(p) { const patch = typeof p === 'function' ? p(this.state) : p; if (patch) Object.assign(this.state, patch); }, _dlxHold: true, _dlxClock: clock || (() => DLX_FIXED_MS),
  });
  const out = delightsVals.call(self, { S: self.state, LIVE: { brief }, live });
  return { out, v: out.dlxv, self };
}

test('vals: ONE top-level key, the same set of fields in every state, and a closed room by default', () => {
  const on = valsFor({}), off = valsFor({ consoleLayer: { on: false } });
  assert.deepEqual(Object.keys(on.out), ['dlxv']);
  assert.deepEqual(Object.keys(off.out), ['dlxv']);
  assert.deepEqual(Object.keys(on.v).sort(), Object.keys(off.v).sort());
  assert.equal(on.v.dlxRoomOpen, false);
  assert.equal(off.v.dlxRoomOpen, false);
  assert.equal(on.v.dlxRoomTitle, ROOM_TITLE);
  assert.equal(on.v.dlxRoomNote, ROOM_NOTE);
  assert.equal(ROOM_NOTE, 'Nothing here needs you.');
  assert.equal(on.v.dlxRoomCartridges.length, 6);
  assert.equal(ROOM_CARTRIDGES.length, 6);
});

test('vals: with the layer off nothing shows, whatever else is set (even a stale open room and a playing scene)', () => {
  const { v } = valsFor({ consoleLayer: { on: false }, dlxRoom: true, dlxRun: true });
  assert.equal(v.dlxLayerOn, false);
  assert.equal(v.dlxSeasonOn, false);
  assert.equal(v.dlxAttractSlot, false);
  assert.equal(v.dlxAttractRun, false);
  assert.equal(v.dlxRoomOpen, false);
  assert.equal(v.dlxSeasonLabel, '');
  assert.deepEqual(v.dlxSeasonCircles, []);
  for (const bad of [undefined, null, 'on', 1, {}, { on: 'true' }]) assert.equal(valsFor({ consoleLayer: bad }).v.dlxLayerOn, false, JSON.stringify(bad));
  assert.ok(Object.isFrozen(v), 'the off object is one shared frozen constant');
});

test('vals: the attract slot exists only while the empty-Brief card is shown (layer on, Home, live, Brief ready and empty, motion allowed)', () => {
  assert.equal(valsFor({}).v.dlxAttractSlot, true);
  assert.equal(valsFor({}, { brief: BRIEF_BUSY }).v.dlxAttractSlot, false, 'the Brief has an item');
  assert.equal(valsFor({}, { brief: { loaded: true, error: '', brief: { items: [], more: 2, errors: [] } } }).v.dlxAttractSlot, false, 'more rows hidden');
  assert.equal(valsFor({}, { brief: { loaded: true, error: '', brief: { items: [], more: 0, errors: ['x'] } } }).v.dlxAttractSlot, false, 'a source error');
  assert.equal(valsFor({}, { brief: { loaded: false, error: '', brief: null } }).v.dlxAttractSlot, false, 'still loading');
  assert.equal(valsFor({}, { brief: { loaded: true, error: 'boom', brief: null } }).v.dlxAttractSlot, false, 'read failed');
  assert.equal(valsFor({}, { hq: {} }).v.dlxAttractSlot, false, 'no brief module: no card');
  assert.equal(valsFor({}, { live: false }).v.dlxAttractSlot, false, 'an older scan is being viewed');
  assert.equal(valsFor({ tab: 'projects' }).v.dlxAttractSlot, false, 'not on Home');
  assert.equal(valsFor({ route: { projectId: 'x' } }).v.dlxAttractSlot, false, 'a project page is open');
  assert.equal(valsFor({ reduceMotion: true }).v.dlxAttractSlot, false, 'reduce motion: no slot at all');
});

test('vals: the scene draws only while it plays, with the loop length and the loops left in its style', () => {
  assert.equal(valsFor({}).v.dlxAttractRun, false);
  assert.equal(valsFor({}).v.dlxAttractStyle, '');
  const run = valsFor({ dlxRun: true, dlxLoops: 2 }).v;
  assert.equal(run.dlxAttractRun, true);
  assert.equal(run.dlxAttractStyle, '--dlx-loop:6s;--dlx-loops:2');
  assert.equal(valsFor({ dlxRun: true, dlxLoops: 9 }).v.dlxAttractStyle, '--dlx-loop:6s;--dlx-loops:3', 'never more than the cap');
  assert.equal(valsFor({ dlxRun: true }, { brief: BRIEF_BUSY }).v.dlxAttractRun, false, 'a busy Brief ends it');
  assert.equal(valsFor({ dlxRun: true, reduceMotion: true }).v.dlxAttractRun, false);
  assert.equal(valsFor({ dlxRun: true, tab: 'money' }).v.dlxAttractRun, false);
});

test('vals: the room is closed until opened, opens on the flag, and Escape (through the mixin) closes it', () => {
  assert.equal(valsFor({}).v.dlxRoomOpen, false);
  const open = valsFor({ dlxRoom: true });
  assert.equal(open.v.dlxRoomOpen, true);
  assert.equal(open.self.dlxEscape(), true);
  assert.equal(open.self.state.dlxRoom, false);
  assert.equal(valsFor({ dlxRoom: true, tab: 'claude' }).v.dlxRoomOpen, true, 'the room opens over any screen');
  assert.equal(typeof open.v.dlxRoomClose, 'function');
  assert.equal(typeof open.v.dlxRoomStop, 'function');
  let stopped = 0;
  open.v.dlxRoomStop({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1);
  assert.doesNotThrow(() => open.v.dlxRoomStop(undefined));
  let focused = 0;
  open.v.dlxRoomRef({ focus: () => { focused++; } });
  assert.equal(focused, 1);
  assert.doesNotThrow(() => open.v.dlxRoomRef(null));
});

test('vals: the ornament follows the injected clock, carries its title and aria-label, and shows only on Home', () => {
  const feb = valsFor({}).v;
  assert.equal(feb.dlxSeasonOn, true);
  assert.equal(feb.dlxSeasonName, 'Paper kite');
  assert.equal(feb.dlxSeasonTitle, 'Paper kite · February');
  assert.equal(feb.dlxSeasonLabel, 'Season ornament: Paper kite (February)');
  assert.equal(feb.dlxSeasonBox, '0 0 32 32');
  assert.ok(feb.dlxSeasonPolys.length + feb.dlxSeasonPaths.length + feb.dlxSeasonLines.length > 0);
  const dec = valsFor({}, { clock: () => new Date(2026, 11, 31, 23, 59).getTime() }).v;
  assert.equal(dec.dlxSeasonName, 'Thread spool');
  const jan = valsFor({}, { clock: () => new Date(2027, 0, 1, 0, 0).getTime() }).v;
  assert.equal(jan.dlxSeasonName, 'Snow marker');
  const names = new Set();
  for (let m = 0; m < 12; m++) names.add(valsFor({}, { clock: () => new Date(2026, m, 3).getTime() }).v.dlxSeasonName);
  assert.equal(names.size, 12, 'the ornament changes every month');
  assert.equal(valsFor({ tab: 'projects' }).v.dlxSeasonOn, false);
  assert.equal(valsFor({}, { clock: () => NaN }).v.dlxSeasonOn, false, 'a clock that is not a date hides it, never guesses');
  assert.equal(valsFor({}, { live: false }).v.dlxSeasonOn, true, 'the greeting is there on an older scan too');
});

test('vals: briefEmptyNow keeps parity with the Brief panel’s own empty rule', () => {
  assert.equal(briefEmptyNow({ brief: BRIEF_EMPTY }, true), true);
  assert.equal(briefEmptyNow({ brief: BRIEF_EMPTY }, false), false);
  assert.equal(briefEmptyNow({ brief: BRIEF_BUSY }, true), false);
  assert.equal(briefEmptyNow({}, true), false);
  assert.equal(briefEmptyNow(null, true), false);
});

// ---- the template -----------------------------------------------------------------------------------------------------------------------------------
test('template: every binding reads dlxv or a loop variable, every fragment sits inside its own sc-if, and nothing can reach out', async () => {
  const T = await import('../tpl/delights.tpl.js');
  const { v } = valsFor({ dlxRun: true, dlxRoom: true });
  const keys = new Set(Object.keys(v));
  const frags = { season: T.dlxSeason, attract: T.dlxAttract, room: T.default };
  for (const [name, src] of Object.entries(frags)) {
    for (const m of src.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const path = m[1];
      if (path === 'false' || path === 'true') continue;   // the hint-placeholder-val attributes
      if (path.startsWith('dlxv.')) assert.ok(keys.has(path.slice(5)), name + ' binds a key vals does not return: ' + path);
      else assert.match(path, /^[pqrlck]\.[a-zA-Z0-9]+$/, name + ' binds something outside dlxv: ' + path);
    }
    assert.ok(!/<(script|image|audio|video|iframe|img|a|link|object|embed|input|form)\b/i.test(src), name + ' has no element that loads or sends anything');
    assert.ok(!/\bhref=|\bsrc=|fetch\(|XMLHttpRequest|hq\./.test(src), name + ' makes no network or hq call');
  }
  assert.match(T.dlxSeason, /^\s*<!--[^>]*-->\s*\n\s*<sc-if value="\{\{ dlxv\.dlxSeasonOn \}\}"/);
  assert.match(T.dlxAttract, /^<sc-if value="\{\{ dlxv\.dlxAttractSlot \}\}"/);
  assert.match(T.default, /<sc-if value="\{\{ dlxv\.dlxRoomOpen \}\}"/);
  assert.match(T.dlxAttract, /<sc-if value="\{\{ dlxv\.dlxAttractRun \}\}"/);
});

test('template: the ornament has a title and an aria-label and no animation; the attract scene is decorative; the room is a labelled dialog with a close button and the one note', async () => {
  const T = await import('../tpl/delights.tpl.js');
  assert.match(T.dlxSeason, /title="\{\{ dlxv\.dlxSeasonTitle \}\}"/);
  assert.match(T.dlxSeason, /role="img" aria-label="\{\{ dlxv\.dlxSeasonLabel \}\}"/);
  assert.match(T.dlxSeason, /width="28" height="28"/);
  assert.ok(!/animate|class="dlx-|transition/.test(T.dlxSeason), 'static: no animation hook of any kind');
  assert.match(T.dlxAttract, /aria-hidden="true"/);
  assert.match(T.dlxAttract, /pointer-events:none/);
  assert.match(T.dlxAttract, /width:0;height:0/, 'the anchor takes no space');
  assert.match(T.dlxAttract, /data-dlx="attract-anchor"/);
  assert.match(T.default, /role="dialog" aria-modal="true" aria-label="\{\{ dlxv\.dlxRoomTitle \}\}"/);
  assert.match(T.default, /aria-label="Close back room"/);
  assert.match(T.default, /\{\{ dlxv\.dlxRoomNote \}\}/);
  assert.equal((T.default.match(/<button\b/g) || []).length, 1, 'one button: close');
  assert.ok(!/<text\b|<foreignObject/.test(T.default), 'the room is drawn entirely in shapes; the one note is a plain line');
  assert.ok(T.default.includes('role="img"'));
});

test('template: the room names no data of the owner’s (no placeholder binding other than the title, the note and the cartridge shapes)', async () => {
  const T = await import('../tpl/delights.tpl.js');
  const binds = [...T.default.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
  for (const b of binds.filter((x) => x !== 'false' && x !== 'true')) assert.match(b, /^(dlxv\.dlxRoom(Close|Stop|Ref|Open|Title|Note|Cartridges)|k.[a-zA-Z0-9]+)$/, b);
});

// ---- the selftest rows ------------------------------------------------------------------------------------------------------------------------------
test('selftest rows: invented data, the Today row shape, and each row renders what its name says', () => {
  const rows = delightsStates();
  assert.ok(rows.length >= 5);
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length);
  const by = {};
  for (const [name, sub, live, st, extra] of rows) {
    assert.match(name, /^dlx-/);
    assert.equal(sub, 'home');
    assert.ok(live && typeof live === 'object' && typeof live.loaded === 'boolean');
    assert.ok(extra.consoleLayer && typeof extra.consoleLayer.on === 'boolean');
    by[name] = valsFor({ ...delightsInitState(), ...st, ...extra }, { brief: live }).v;
  }
  assert.equal(by['dlx-off'].dlxSeasonOn, false);
  assert.equal(by['dlx-armed'].dlxSeasonOn, true);
  assert.equal(by['dlx-armed'].dlxAttractSlot, true);
  assert.equal(by['dlx-armed'].dlxAttractRun, false);
  assert.equal(by['dlx-attract-playing'].dlxAttractRun, true);
  assert.equal(by['dlx-busy-brief'].dlxSeasonOn, true);
  assert.equal(by['dlx-busy-brief'].dlxAttractSlot, false);
  assert.equal(by['dlx-room'].dlxRoomOpen, true);
  assert.equal(by['dlx-room-layer-off'].dlxRoomOpen, false);
  assert.equal(new Date(DLX_FIXED_MS).getMonth(), 1);
  assert.deepEqual(delightsInitState(), { dlxRoom: false, dlxRun: false, dlxLoops: 3 });
});

// ---- the source test --------------------------------------------------------------------------------------------------------------------------------
const SRC = ['logic/delights.mjs', 'logic/seasons.mjs', 'vals/delights.js', 'tpl/delights.tpl.js', 'selftest-delights.mjs'];
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('source test: no raw listener, timer or frame in this dish’s files (everything goes through the layer), and no hq call, network or sound', () => {
  for (const f of SRC) {
    const s = read(f);
    assert.ok(!/addEventListener|removeEventListener|setInterval|setTimeout|requestAnimationFrame|requestIdleCallback|\.animate\(/.test(s), f + ' registers something outside the layer');
    assert.ok(!/\.hq\.\w+\(|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new Audio|AudioContext|localStorage|sessionStorage/.test(s), f + ' reaches outside the page');
    assert.ok(!/\bHQFx\b|\bFX\(\)|sfx\(/.test(s), f + ' makes a sound');
  }
});

test('source test: the controller’s inputs go through layer.on and layer.timer, and the delights stylesheet is not linked from here', () => {
  const s = read('logic/delights.mjs');
  assert.match(s, /layer\.on\(/);
  assert.match(s, /layer\.timer\(/);
  assert.ok(!/<link|createElement/.test(s), 'attaching the stylesheet is console-layer.mjs’s job');
  assert.ok(ATTRACT_INPUTS.every(([w]) => w === 'window' || w === 'document'));
});

test('no company, brand, character or real-holiday words in any file of this dish (inline placeholder deny-list)', () => {
  const DENY = ['disney', 'nintendo', 'sega', 'sony', 'mario', 'pokemon', 'lego', 'atari', 'playstation', 'xbox', 'christmas', 'halloween', 'easter', 'santa', 'valentine', 'thanksgiving'];
  for (const f of SRC) { const s = read(f).toLowerCase(); for (const w of DENY) assert.ok(!s.includes(w), f + ' contains ' + w); }
  assert.equal(SEASONS.length, 12);
});
