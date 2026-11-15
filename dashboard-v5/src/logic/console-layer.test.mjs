// node --test dashboard-v5/src/logic/console-layer.test.mjs
// The Console layer's master switch: the pref normaliser, the zero-cost layer (attach / detach / probe with an injected fake document and fake
// timers), the Settings actions and the Appearance chips, the skin-clearing theme entry points, the selftest rows, and the source rule that
// nothing but console-layer.mjs may register a listener, timer or frame. Placeholder state only; no DOM, no storage, no Electron.
//
// "Wiring" tests at the bottom read the shared files (app.js, tpl/shell.tpl.js, vals/index.js, vals/shell.js). They are SKIPPED until the integrator
// has applied this dish's shared edits (the marker is consoleSkinLogic in app.js) and are all live from then on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  CONSOLE_DEFAULTS, CONSOLE_KEYS, CONSOLE_LINK_ID, CONSOLE_CSS_HREF, CONSOLE_SKIN, normaliseConsoleLayer, consoleEffective, withConsoleLayer, withSkin,
  createConsoleLayer, exposeProbe, layerProbe, isAttached, detach as detachDefault,
} from './console-layer.mjs';
import { consoleSkinLogic, cslInitState, cslSavePatch, CSL_TITLE, CSL_LINE, CSL_SCAN_TITLE } from './console-skin.js';
import { consoleSkinVals, consoleThemeOpts, consoleSettings } from '../vals/console-skin.js';
import { consoleStates, consoleInitState, consoleSeen, consoleProblems, CONSOLE_ROW_NAMES } from '../selftest-console.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V5 = resolve(HERE, '../..');
const read = (rel) => readFileSync(resolve(V5, rel), 'utf8');

// ---- fakes ----------------------------------------------------------------------------------------------------------------------------
function fakeEnv() {
  const log = { intervals: new Map(), timeouts: new Map(), frames: new Map(), next: 1 };
  const attrs = {};
  const head = {
    children: [],
    appendChild(n) { n.parentNode = head; head.children.push(n); },
    removeChild(n) { const i = head.children.indexOf(n); if (i >= 0) head.children.splice(i, 1); n.parentNode = null; },
  };
  const rootAttrs = {};
  const themeRoot = { getAttribute: (k) => (k in rootAttrs ? rootAttrs[k] : null), setAttribute: (k, v) => { rootAttrs[k] = String(v); } };
  const documentElement = { setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; }, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  const doc = {
    head, documentElement,
    createElement(tag) {
      return { tag, attrs: {}, parentNode: null, setAttribute(k, v) { this.attrs[k] = String(v); }, remove() { if (this.parentNode) this.parentNode.removeChild(this); } };
    },
    getElementById: (id) => head.children.find((n) => n.attrs.id === id) || null,
    querySelector: (sel) => (sel === '[data-hq-theme]' ? themeRoot : null),
    querySelectorAll: (sel) => (sel === 'link#hq-console-css' ? head.children.filter((n) => n.tag === 'link' && n.attrs.id === CONSOLE_LINK_ID) : sel === '[data-hq-console]' ? head.children.filter((n) => 'data-hq-console' in n.attrs) : []),
  };
  const env = {
    doc,
    setInterval: (f, ms) => { const id = log.next++; log.intervals.set(id, { f, ms }); return id; }, clearInterval: (id) => { log.intervals.delete(id); },
    setTimeout: (f, ms) => { const id = log.next++; log.timeouts.set(id, { f, ms }); return id; }, clearTimeout: (id) => { log.timeouts.delete(id); },
    requestAnimationFrame: (f) => { const id = log.next++; log.frames.set(id, { f }); return id; }, cancelAnimationFrame: (id) => { log.frames.delete(id); },
  };
  return { env, doc, attrs, rootAttrs, log, head };
}
function fakeTarget() {
  const t = { listeners: [], addEventListener(type, fn) { t.listeners.push([type, fn]); }, removeEventListener(type, fn) { t.listeners = t.listeners.filter(([a, b]) => !(a === type && b === fn)); } };
  return t;
}
const ZERO = { links: 0, listeners: 0, timers: 0, frames: 0 };

// ---- the pref normaliser --------------------------------------------------------------------------------------------------------------
test('the defaults are everything off, and the key set is the documented one', () => {
  assert.deepEqual({ ...CONSOLE_DEFAULTS }, { on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
  assert.deepEqual([...CONSOLE_KEYS], ['on', 'skin', 'scan', 'palette', 'debug', 'shelf']);
  assert.equal(Object.isFrozen(CONSOLE_DEFAULTS), true);
});

test('missing, garbage and partial values normalise to defaults with every flag off', () => {
  for (const raw of [undefined, null, 0, 1, 'on', true, [], ['on'], () => {}, NaN]) assert.deepEqual(normaliseConsoleLayer(raw), { ...CONSOLE_DEFAULTS });
  assert.deepEqual(normaliseConsoleLayer({}), { ...CONSOLE_DEFAULTS });
  assert.deepEqual(normaliseConsoleLayer({ on: 'true', skin: 1, scan: 'yes', debug: {}, shelf: [] }), { ...CONSOLE_DEFAULTS }, 'only a strict true turns a flag on');
  assert.deepEqual(normaliseConsoleLayer({ on: true }), { ...CONSOLE_DEFAULTS, on: true });
  assert.deepEqual(normaliseConsoleLayer({ skin: true, junk: 1 }), { ...CONSOLE_DEFAULTS, skin: true }, 'unknown keys are dropped, a partial object keeps what it says');
  assert.equal(normaliseConsoleLayer({ palette: 'Ember' }).palette, 'ember');
  assert.equal(normaliseConsoleLayer({ palette: ' tide ' }).palette, 'tide');
  // the palette is one of the two hidden accent palettes (cheat codes) or none: an unknown id is dropped
  for (const bad of ['warm-2', 'plum', 'has space', 'x'.repeat(40), '<b>', 5, null, {}]) assert.equal(normaliseConsoleLayer({ palette: bad }).palette, '', JSON.stringify(bad));
});

test('normalising is pure: a fresh object every time, the input is never touched, and it is idempotent', () => {
  const src = Object.freeze({ on: true, skin: true, scan: false, extra: 1 });
  const a = normaliseConsoleLayer(src), b = normaliseConsoleLayer(src);
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  assert.deepEqual(normaliseConsoleLayer(a), a);
  a.on = false;
  assert.equal(normaliseConsoleLayer(src).on, true);
});

test('effective flags: nothing at all while the layer is off, scanlines only under the skin', () => {
  assert.deepEqual(consoleEffective({ on: false, skin: true, scan: true, shelf: true, palette: 'x' }), { ...CONSOLE_DEFAULTS });
  assert.deepEqual(consoleEffective({ on: true, skin: false, scan: true }), { ...CONSOLE_DEFAULTS, on: true, scan: false });
  assert.deepEqual(consoleEffective({ on: true, skin: true, scan: true }), { ...CONSOLE_DEFAULTS, on: true, skin: true, scan: true });
  assert.deepEqual(consoleEffective(null), { ...CONSOLE_DEFAULTS });
});

test('withConsoleLayer / withSkin return new normalised objects and keep the owner’s other choices', () => {
  const base = { on: true, skin: true, scan: true };
  assert.deepEqual(withSkin(base, false), { ...CONSOLE_DEFAULTS, on: true, scan: true });
  assert.deepEqual(withSkin(null, true), { ...CONSOLE_DEFAULTS, skin: true });
  assert.deepEqual(withConsoleLayer(base, { on: false }), { ...CONSOLE_DEFAULTS, skin: true, scan: true }, 'switching off keeps the sub-flags for next time');
  assert.deepEqual(withConsoleLayer(base, 'garbage'), { ...CONSOLE_DEFAULTS, on: true, skin: true, scan: true });
  assert.deepEqual(base, { on: true, skin: true, scan: true });
});

// ---- the layer: attach / detach / probe -----------------------------------------------------------------------------------------------
test('a fresh layer is detached: the probe is all zeros and every registration is a no-op that creates nothing', () => {
  const L = createConsoleLayer(), f = fakeEnv(), target = fakeTarget();
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
  const offs = [L.layerOn(target, 'keydown', () => {}), L.layerTimer(() => {}, 100), L.layerTimer(() => {}, 100, { once: true }), L.layerFrame(() => {})];
  for (const off of offs) assert.equal(typeof off, 'function');
  offs.forEach((off) => off());
  assert.equal(L.layerAttr('data-hq-scan', 'on'), false);
  assert.equal(target.listeners.length, 0);
  assert.equal(f.log.intervals.size + f.log.timeouts.size + f.log.frames.size, 0);
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
  assert.equal(L.isAttached(), false);
});

test('attach injects exactly one stylesheet link with the documented id, href and marker, and the probe counts it', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  assert.equal(L.attach(f.env), true);
  assert.equal(f.head.children.length, 1);
  const link = f.head.children[0];
  assert.equal(link.tag, 'link');
  assert.deepEqual(link.attrs, { rel: 'stylesheet', id: 'hq-console-css', href: './styles/console.css', 'data-hq-console': 'css' });
  assert.equal(CONSOLE_LINK_ID, 'hq-console-css');
  assert.equal(CONSOLE_CSS_HREF, './styles/console.css');
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 1 });
  assert.equal(L.isAttached(), true);
});

test('layerSheet: one extra counted stylesheet, only while attached; href null removes it; detach removes it; the same href twice is one link', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  assert.equal(L.layerSheet('palettes', './styles/palettes.css'), false, 'detached: nothing is created');
  assert.equal(f.head.children.length, 0);
  L.attach(f.env);
  assert.equal(L.layerSheet('palettes', './styles/palettes.css'), true);
  assert.equal(L.layerSheet('palettes', './styles/palettes.css'), true);
  const links = f.head.children.filter((n) => n.attrs.id === 'hq-palettes-css');
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].attrs, { rel: 'stylesheet', id: 'hq-palettes-css', href: './styles/palettes.css', 'data-hq-console': 'css' });
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 2 });
  assert.equal(L.layerSheet('palettes', null), true);
  assert.equal(f.head.children.some((n) => n.attrs.id === 'hq-palettes-css'), false);
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 1 });
  L.layerSheet('palettes', './styles/palettes.css');
  L.detach();
  assert.equal(f.head.children.length, 0, 'detach takes every link with it');
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
  assert.equal(L.layerSheet('Bad Name', 'x.css'), false);
});

test('a double attach is idempotent: one link, same answer, nothing doubled', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  assert.equal(L.attach(f.env), true);
  assert.equal(L.attach(f.env), true);
  assert.equal(L.attach(fakeEnv().env), true, 'a second environment is ignored while attached');
  assert.equal(f.head.children.length, 1);
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 1 });
});

test('a stale link with the same id (a hot reload, a second window script) is replaced, never duplicated', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  const stale = f.doc.createElement('link'); stale.setAttribute('id', CONSOLE_LINK_ID); f.head.appendChild(stale);
  L.attach(f.env);
  assert.equal(f.head.children.length, 1);
  assert.notEqual(f.head.children[0], stale);
});

test('attach with nothing to attach to says so (false) and leaves the probe at zeros', () => {
  const L = createConsoleLayer();
  for (const bad of [undefined, null, {}, { doc: {} }, { doc: { createElement: 1 } }, 'doc']) assert.equal(L.attach(bad), false);
  const boom = { doc: { createElement() { throw new Error('no dom'); } } };
  assert.equal(L.attach(boom), false);
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
  assert.equal(L.isAttached(), false);
});

test('the probe counts exactly what was registered, and each off() and each fired one-shot takes its own count back', () => {
  const L = createConsoleLayer(), f = fakeEnv(), target = fakeTarget();
  L.attach(f.env);
  const offL1 = L.layerOn(target, 'keydown', () => {});
  const offL2 = L.layerOn(target, 'keyup', () => {});
  const offT = L.layerTimer(() => {}, 250);
  let fired = 0;
  L.layerTimer(() => { fired++; }, 50, { once: true });
  let framed = 0;
  L.layerFrame(() => { framed++; });
  assert.deepEqual({ ...L.layerProbe() }, { links: 1, listeners: 2, timers: 2, frames: 1 });
  assert.equal(target.listeners.length, 2);
  assert.equal(f.log.intervals.size, 1);
  assert.equal([...f.log.intervals.values()][0].ms, 250);
  // the one-shot fires: it no longer counts
  const [id, rec] = [...f.log.timeouts.entries()][0];
  f.log.timeouts.delete(id); rec.f();
  assert.equal(fired, 1);
  assert.equal(L.layerProbe().timers, 1);
  // the frame fires
  const [fid, frec] = [...f.log.frames.entries()][0];
  f.log.frames.delete(fid); frec.f(16);
  assert.equal(framed, 1);
  assert.equal(L.layerProbe().frames, 0);
  offL1(); offL1();
  assert.equal(L.layerProbe().listeners, 1, 'a second off() is harmless');
  assert.equal(target.listeners.length, 1);
  offT();
  assert.equal(L.layerProbe().timers, 0);
  assert.equal(f.log.intervals.size, 0);
  offL2();
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 1 });
});

test('detach removes the link, every listener, timer, frame and attribute without a reload, and the probe returns to zeros', () => {
  const L = createConsoleLayer(), f = fakeEnv(), a = fakeTarget(), b = fakeTarget();
  L.attach(f.env);
  L.layerOn(a, 'keydown', () => {}); L.layerOn(b, 'pointermove', () => {});
  L.layerTimer(() => {}, 10); L.layerTimer(() => {}, 10, { once: true }); L.layerFrame(() => {});
  assert.equal(L.layerAttr('data-hq-scan', 'on'), true);
  assert.equal(f.attrs['data-hq-scan'], 'on');
  assert.equal(L.detach(), true);
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
  assert.equal(f.head.children.length, 0, 'no link');
  assert.equal(a.listeners.length + b.listeners.length, 0);
  assert.equal(f.log.intervals.size + f.log.timeouts.size + f.log.frames.size, 0);
  assert.equal('data-hq-scan' in f.attrs, false);
  assert.equal(L.isAttached(), false);
  assert.equal(L.detach(), false, 'detaching twice is harmless');
  // and a registration after detach creates nothing
  L.layerOn(a, 'keydown', () => {}); L.layerTimer(() => {}, 5); L.layerFrame(() => {});
  assert.equal(a.listeners.length, 0);
  assert.deepEqual({ ...L.layerProbe() }, ZERO);
});

test('attach after detach works again (off, on, off, on), each time to exactly one link', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  for (let i = 0; i < 3; i++) {
    assert.equal(L.attach(f.env), true);
    assert.equal(f.head.children.length, 1);
    L.detach();
    assert.equal(f.head.children.length, 0);
  }
});

test('timers and frames fall back to the window’s own when the environment gives none', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  const seen = { i: 0, c: 0, r: 0 };
  const win = { setInterval: () => { seen.i++; return 7; }, clearInterval: () => { seen.c++; }, requestAnimationFrame: () => { seen.r++; return 9; }, cancelAnimationFrame: () => { seen.c++; } };
  L.attach({ doc: f.doc, win });
  L.layerTimer(() => {}, 20); L.layerFrame(() => {});
  assert.deepEqual([seen.i, seen.r], [1, 1]);
  L.detach();
  assert.equal(seen.c, 2);
});

test('layerAttr accepts data-hq-* names only and removes on null', () => {
  const L = createConsoleLayer(), f = fakeEnv();
  L.attach(f.env);
  for (const bad of ['class', 'style', 'data-x', 'onclick', 'data-hq-', 'data-hq-A', '', null]) assert.equal(L.layerAttr(bad, 'on'), false, String(bad));
  assert.equal(L.layerAttr('data-hq-scan', 'on'), true);
  assert.equal(f.attrs['data-hq-scan'], 'on');
  assert.equal(L.layerAttr('data-hq-scan', null), true);
  assert.equal('data-hq-scan' in f.attrs, false);
  assert.deepEqual({ ...L.layerProbe() }, { ...ZERO, links: 1 }, 'attributes are not counted: an attribute is not a node');
});

test('the probe is a fresh frozen object of four numbers, and window.__hqLayerProbe is read-only', () => {
  const p = layerProbe();
  assert.equal(Object.isFrozen(p), true);
  assert.deepEqual(Object.keys(p).sort(), ['frames', 'links', 'listeners', 'timers']);
  for (const v of Object.values(p)) assert.equal(typeof v, 'number');
  const win = {};
  assert.equal(exposeProbe(win), true);
  assert.equal(typeof win.__hqLayerProbe, 'function');
  assert.deepEqual(win.__hqLayerProbe(), { links: 0, listeners: 0, timers: 0, frames: 0 });
  assert.throws(() => { win.__hqLayerProbe = () => 1; }, TypeError);
  assert.throws(() => { delete win.__hqLayerProbe; }, TypeError);
  assert.equal(exposeProbe(win), true, 'twice is harmless');
  assert.equal(Object.keys(win).includes('__hqLayerProbe'), false, 'not enumerable');
  for (const bad of [null, undefined, 3, 'w']) assert.equal(exposeProbe(bad), false);
  const mine = createConsoleLayer(), f = fakeEnv();
  mine.attach(f.env);
  const w2 = {};
  exposeProbe(w2, mine.layerProbe);
  assert.equal(w2.__hqLayerProbe().links, 1);
  mine.detach();
  assert.equal(w2.__hqLayerProbe().links, 0, 'the probe reads live, not a copy from when it was installed');
});

// ---- the Settings actions (the mixin) -----------------------------------------------------------------------------------------------
function comp(state, extra = {}) {
  const c = Object.assign(Object.create(consoleSkinLogic), {
    state: { themePref: 'dark', consoleLayer: undefined, ...state },
    setState(u) { const patch = typeof u === 'function' ? u(this.state) : u; this.state = { ...this.state, ...patch }; },
    themeName() { const p = this.state.themePref; if (p === 'os') return 'dark'; return p === 'light' ? 'light' : 'dark'; },
  }, extra);
  return c;
}
const layerOf = (c) => normaliseConsoleLayer(c.state.consoleLayer);

test('the initial state and the prefs patch always carry a complete, normalised consoleLayer', () => {
  assert.deepEqual(cslInitState(undefined), { consoleLayer: { ...CONSOLE_DEFAULTS } });
  assert.deepEqual(cslInitState({ consoleLayer: 'garbage' }), { consoleLayer: { ...CONSOLE_DEFAULTS } });
  assert.deepEqual(cslInitState({ consoleLayer: { on: true, skin: true } }), { consoleLayer: { ...CONSOLE_DEFAULTS, on: true, skin: true } });
  assert.deepEqual(cslSavePatch({ consoleLayer: { on: true, junk: 1 } }), { consoleLayer: { ...CONSOLE_DEFAULTS, on: true } });
  assert.deepEqual(cslSavePatch(null), { consoleLayer: { ...CONSOLE_DEFAULTS } });
});

test('nobody gets Console unless they turn it on: a fresh state is off everywhere', () => {
  const c = comp({ consoleLayer: undefined });
  assert.equal(consoleSkinVals({ S: c.state }).cslv.cslOn, false);
  assert.equal(consoleSkinVals({ S: c.state }).cslv.cslSkin, '');
  assert.deepEqual(consoleThemeOpts.call(c, c.state, (a) => ({ a })).map((x) => x.label), ['Dark', 'Light', 'Follow system']);
});

test('the master switch flips on and off, keeping the sub-flags for next time', () => {
  const c = comp({});
  c.cslToggleOn();
  assert.equal(layerOf(c).on, true);
  c.cslChooseSkin();
  c.cslToggleScan();
  assert.deepEqual(layerOf(c), { ...CONSOLE_DEFAULTS, on: true, skin: true, scan: true });
  c.cslToggleOn();
  assert.deepEqual(layerOf(c), { ...CONSOLE_DEFAULTS, skin: true, scan: true });
  assert.equal(consoleSkinVals({ S: c.state }).cslv.cslSkin, '', 'stored skin with the layer off does nothing');
  assert.equal(consoleSkinVals({ S: c.state }).cslv.cslScan, false);
  c.cslToggleOn();
  assert.equal(consoleSkinVals({ S: c.state }).cslv.cslSkin, 'console', 'back on: the owner’s choice is back');
});

test('the Console skin is only choosable while the layer is on, and scanlines only under the skin', () => {
  const c = comp({});
  c.cslChooseSkin();
  assert.equal(layerOf(c).skin, false, 'layer off: choosing Console does nothing');
  c.cslToggleScan();
  assert.equal(layerOf(c).scan, false);
  c.cslToggleOn();
  c.cslToggleScan();
  assert.equal(layerOf(c).scan, false, 'layer on, skin not chosen: scanlines cannot be switched');
  c.cslChooseSkin();
  c.cslToggleScan();
  assert.equal(layerOf(c).scan, true);
  c.cslToggleScan();
  assert.equal(layerOf(c).scan, false);
});

test('every action stores a NEW normalised object (app.js saves on a reference change)', () => {
  const c = comp({});
  const seen = new Set();
  seen.add(c.state.consoleLayer);
  for (const act of ['cslToggleOn', 'cslChooseSkin', 'cslToggleScan', 'cslToggleScan', 'cslToggleOn']) { c[act](); seen.add(c.state.consoleLayer); }
  assert.equal(seen.size, 6);
});

// ---- the Appearance chips and the Settings rows -----------------------------------------------------------------------------------
const tabStyle = (a) => ({ selected: !!a });
const sw = (label, desc, on, toggle) => ({ label, desc, state: on ? 'On' : 'Off', toggle });

test('vals: the Console chip is absent while the layer is off and present while it is on', () => {
  const c = comp({ consoleLayer: { on: false, skin: true } });
  assert.deepEqual(consoleThemeOpts.call(c, c.state, tabStyle).map((x) => x.label), ['Dark', 'Light', 'Follow system']);
  c.state.consoleLayer = { on: true };
  assert.deepEqual(consoleThemeOpts.call(c, c.state, tabStyle).map((x) => x.label), ['Dark', 'Light', 'Follow system', 'Console']);
});

test('vals: only one chip reads selected; under the skin it is Console, never the base theme', () => {
  const c = comp({ themePref: 'light', consoleLayer: { on: true, skin: false } });
  let chips = consoleThemeOpts.call(c, c.state, tabStyle);
  assert.deepEqual(chips.map((x) => x.style.selected), [false, true, false, false]);
  c.state.consoleLayer = { on: true, skin: true };
  chips = consoleThemeOpts.call(c, c.state, tabStyle);
  assert.deepEqual(chips.map((x) => x.style.selected), [false, false, false, true]);
});

test('vals: choosing Dark, Light or Follow system clears the skin and sets the base theme; choosing Console sets the skin and leaves themePref alone', () => {
  const c = comp({ themePref: 'light', consoleLayer: { on: true, skin: false, scan: true } });
  consoleThemeOpts.call(c, c.state, tabStyle)[3].go();
  assert.equal(layerOf(c).skin, true);
  assert.equal(c.state.themePref, 'light', 'Console is a skin over the base theme, it never replaces it');
  for (const [i, id] of [[0, 'dark'], [1, 'light'], [2, 'os']]) {
    c.state.consoleLayer = { on: true, skin: true, scan: true };
    consoleThemeOpts.call(c, c.state, tabStyle)[i].go();
    assert.equal(layerOf(c).skin, false, id);
    assert.equal(c.state.themePref, id);
    assert.equal(layerOf(c).on, true, 'the layer stays on');
    assert.equal(layerOf(c).scan, true, 'the owner’s scanline choice is kept');
  }
  assert.ok(['dark', 'light'].includes(c.themeName()));
});

test('vals: Settings rows. The Console layer row always, CRT scanlines only while the skin is on, with the documented line', () => {
  const rowsOf = (cl) => { const c = comp({ consoleLayer: cl }); return consoleSettings.call(c, c.state, sw); };
  let rows = rowsOf(undefined);
  assert.deepEqual(rows.map((r) => [r.label, r.state]), [['Console layer', 'Off']]);
  assert.equal(rows[0].desc, 'Opt-in look and a few extras. Off = nothing loads.');
  assert.equal(CSL_TITLE, 'Console layer'); assert.equal(CSL_LINE, rows[0].desc); assert.equal(CSL_SCAN_TITLE, 'CRT scanlines');
  rows = rowsOf({ on: true });
  assert.deepEqual(rows.map((r) => [r.label, r.state]), [['Console layer', 'On']]);
  rows = rowsOf({ on: true, skin: true });
  assert.deepEqual(rows.map((r) => [r.label, r.state]), [['Console layer', 'On'], ['CRT scanlines', 'Off']]);
  rows = rowsOf({ on: true, skin: true, scan: true });
  assert.equal(rows[1].state, 'On');
  rows = rowsOf({ on: false, skin: true, scan: true });
  assert.equal(rows.length, 1, 'layer off: no scanline row even if one is stored');
  const c = comp({ consoleLayer: { on: false } });
  consoleSettings.call(c, c.state, sw)[0].toggle();
  assert.equal(layerOf(c).on, true);
});

test('vals: ONE new top-level key (cslv) with the documented fields; the root attribute is empty off and "console" only under the skin', () => {
  const keys = (cl) => consoleSkinVals({ S: { consoleLayer: cl } });
  assert.deepEqual(Object.keys(keys(null)), ['cslv']);
  assert.deepEqual(Object.keys(keys(null).cslv).sort(), ['cslLine', 'cslOn', 'cslScan', 'cslSkin', 'cslSwitchLabel']);
  assert.equal(keys(null).cslv.cslSkin, '');
  assert.equal(keys({ on: true }).cslv.cslSkin, '');
  assert.equal(keys({ on: true, skin: true }).cslv.cslSkin, CONSOLE_SKIN);
  assert.equal(keys({ on: true, skin: true, scan: true }).cslv.cslScan, true);
  assert.equal(keys({ on: true, skin: false, scan: true }).cslv.cslScan, false);
  assert.equal(keys({ on: false, skin: true }).cslv.cslSkin, '');
  assert.equal(keys(null).cslv.cslSwitchLabel, 'Console layer: off');
  assert.equal(keys({ on: true }).cslv.cslSwitchLabel, 'Console layer: on');
});

// ---- the theme entry points -----------------------------------------------------------------------------------------------------------
// The documented app.js edit: toggleTheme() { this.setState((s) => ({ themePref: ..., paletteOpen: false, ...this.cslLeaveSkin(s) })); }
const toggleTheme = (c) => c.setState((s) => ({ themePref: c.themeName() === 'light' ? 'dark' : 'light', paletteOpen: false, ...c.cslLeaveSkin(s) }));

test('toggleTheme leaves Console and flips to the opposite of the base theme, from either base', () => {
  let c = comp({ themePref: 'dark', consoleLayer: { on: true, skin: true } });
  toggleTheme(c);
  assert.equal(layerOf(c).skin, false);
  assert.equal(c.state.themePref, 'light');
  assert.equal(c.themeName(), 'light');
  assert.equal(layerOf(c).on, true, 'only the skin leaves; the layer stays on');
  c = comp({ themePref: 'light', consoleLayer: { on: true, skin: true } });
  toggleTheme(c);
  assert.deepEqual([layerOf(c).skin, c.state.themePref], [false, 'dark']);
  c = comp({ themePref: 'os', consoleLayer: { on: true, skin: true, scan: true } });
  toggleTheme(c);
  assert.deepEqual([layerOf(c).skin, c.state.themePref, layerOf(c).scan], [false, 'light', true]);
});

test('toggleTheme without the skin changes nothing about the layer (no consoleLayer key in the patch)', () => {
  const c = comp({ themePref: 'dark', consoleLayer: { on: true, skin: false } });
  assert.deepEqual(c.cslLeaveSkin(c.state), {});
  const before = c.state.consoleLayer;
  toggleTheme(c);
  assert.equal(c.state.consoleLayer, before, 'the very same object: no needless prefs save');
  assert.equal(c.state.themePref, 'light');
  assert.deepEqual(comp({}).cslLeaveSkin({ consoleLayer: 'junk' }), {});
});

test('the palette command "Toggle light / dark" calls this.toggleTheme() (so it reaches the same method), and themeName() never says console', () => {
  const palette = read('src/logic/palette.js');
  assert.match(palette, /label: 'Toggle light \/ dark'[^}]*run: \(\) => this\.toggleTheme\(\)/);
  const app = read('src/app.js');
  const m = /themeName\(\) \{([^\n]*)\n/.exec(app);
  assert.ok(m, 'themeName() not found in app.js');
  assert.doesNotMatch(m[1], /console/i);
  assert.match(m[1], /'light' : 'dark'/);
  const shared = read('src/logic/shared.js');
  assert.match(shared, /export const THEMES = \['dark', 'light', 'os'\];/, 'THEMES stays dark|light|os: no fourth value reaches main or the satellites');
});

// ---- the layer follows the pref (cslSync) -------------------------------------------------------------------------------------------
test('cslSync: on attaches the link, off detaches it, scanlines follow skin + scan, no reload involved', () => {
  const f = fakeEnv();
  const win = {};
  const env = { ...f.env, win };
  const c = comp({ consoleLayer: { on: false } });
  try {
    assert.equal(c.cslSync(env), false);
    assert.equal(f.head.children.length, 0);
    assert.deepEqual(win.__hqLayerProbe(), ZERO, 'the probe exists even while the layer is off, and says zeros');
    c.state.consoleLayer = { on: true };
    assert.equal(c.cslSync(env), true);
    assert.equal(f.head.children.length, 1);
    assert.equal('data-hq-scan' in f.attrs, false);
    c.state.consoleLayer = { on: true, skin: true, scan: true };
    c.cslSync(env);
    assert.equal(f.attrs['data-hq-scan'], 'on');
    assert.equal(f.head.children.length, 1, 'syncing again does not add a second link');
    c.state.consoleLayer = { on: true, skin: false, scan: true };
    c.cslSync(env);
    assert.equal('data-hq-scan' in f.attrs, false, 'scanlines only under the skin');
    c.state.consoleLayer = { on: true, skin: true, scan: true };
    c.cslSync(env);
    c.state.consoleLayer = { on: false, skin: true, scan: true };
    assert.equal(c.cslSync(env), false);
    assert.equal(f.head.children.length, 0);
    assert.equal('data-hq-scan' in f.attrs, false);
    assert.equal(isAttached(), false);
  } finally { detachDefault(); }
});

test('cslSync: the accent palettes stylesheet exists only while the layer is on AND a palette is chosen (the probe counts it)', () => {
  const f = fakeEnv();
  const env = { ...f.env, win: {} };
  const c = comp({ consoleLayer: { on: true } });
  const has = () => f.head.children.some((n) => n.attrs.id === 'hq-palettes-css');
  try {
    c.cslSync(env);
    assert.equal(has(), false, 'no palette, no link');
    c.state.consoleLayer = { on: true, palette: 'ember' };
    c.cslSync(env);
    assert.equal(has(), true);
    assert.equal(env.win.__hqLayerProbe().links, 2);
    c.state.consoleLayer = { on: true, palette: 'tide' };
    c.cslSync(env);
    assert.equal(f.head.children.filter((n) => n.attrs.id === 'hq-palettes-css').length, 1, 'a second palette does not add a second link');
    c.state.consoleLayer = { on: true, palette: '' };
    c.cslSync(env);
    assert.equal(has(), false, 'clearing the palette removes the link');
    c.state.consoleLayer = { on: true, palette: 'tide' };
    c.cslSync(env);
    c.state.consoleLayer = { on: false, palette: 'tide' };
    c.cslSync(env);
    assert.equal(f.head.children.length, 0, 'the layer going off takes the palette link with it');
    assert.deepEqual(env.win.__hqLayerProbe(), ZERO);
  } finally { detachDefault(); }
});

test('cslSync with no page to work in (no env, no window) does nothing and says false', () => {
  assert.equal(comp({ consoleLayer: { on: true } }).cslSync(), false);
  assert.equal(isAttached(), false);
});

// ---- the selftest rows ---------------------------------------------------------------------------------------------------------------
test('selftest rows: the documented five, each a full state patch, and the init state is everything off', () => {
  const rows = consoleStates();
  assert.deepEqual(rows.map((r) => r[0]), CONSOLE_ROW_NAMES.slice());
  assert.deepEqual(rows.map((r) => r[0]), ['console-off', 'console-on-no-skin', 'console-skin', 'console-skin-scan', 'console-off-stored']);
  for (const r of rows) { assert.equal(r.length, 5); assert.equal(r[1], 'home'); assert.deepEqual(Object.keys(r[3]), ['consoleLayer']); assert.deepEqual(r[3].consoleLayer, normaliseConsoleLayer(r[3].consoleLayer)); }
  assert.deepEqual(consoleInitState(), { consoleLayer: { ...CONSOLE_DEFAULTS } });
  assert.notEqual(consoleInitState().consoleLayer, consoleInitState().consoleLayer);
});

test('selftest rows against a faked page: the layer driven by each row passes consoleProblems; a leftover link, node or probe count fails it', () => {
  const win = {};
  for (const [name, , , patch] of consoleStates()) {
    const f = fakeEnv();
    const env = { ...f.env, win };
    const c = comp({ ...patch });
    try {
      c.cslSync(env);
      const skin = consoleSkinVals({ S: c.state }).cslv.cslSkin;
      f.rootAttrs['data-hq-skin'] = skin;   // what the template binding renders
      const seen = consoleSeen(f.doc, { __hqLayerProbe: win.__hqLayerProbe });
      assert.deepEqual(consoleProblems(name, seen), [], name);
    } finally { detachDefault(); }
  }
  const off = { skin: '', scan: null, links: 0, nodes: 0, probe: { links: 0, listeners: 0, timers: 0, frames: 0 } };
  assert.deepEqual(consoleProblems('console-off', off), []);
  assert.match(consoleProblems('console-off', { ...off, links: 1 }).join('|'), /link/);
  assert.match(consoleProblems('console-off', { ...off, nodes: 1 }).join('|'), /data-hq-console/);
  assert.match(consoleProblems('console-off', { ...off, probe: { ...off.probe, listeners: 1 } }).join('|'), /listeners/);
  assert.match(consoleProblems('console-off', { ...off, skin: null }).join('|'), /EMPTY attribute/);
  assert.match(consoleProblems('console-off', { ...off, scan: 'on' }).join('|'), /data-hq-scan/);
  assert.match(consoleProblems('console-off', { ...off, probe: null }).join('|'), /__hqLayerProbe/);
  assert.match(consoleProblems('console-skin', off).join('|'), /want 1/);
  assert.deepEqual(consoleProblems('console-skin', { skin: 'console', scan: null, links: 1, nodes: 1, probe: { links: 1, listeners: 2, timers: 0, frames: 0 } }, { listeners: 2 }), [], 'a later dish raises the expected registrations with its own');
  assert.match(consoleProblems('console-skin-scan', { skin: 'console', scan: null, links: 1, nodes: 1, probe: { links: 1, listeners: 0, timers: 0, frames: 0 } }).join('|'), /scanlines should be on/);
  assert.match(consoleProblems('nope', off).join('|'), /no expectation/);
});

// ---- the source rule --------------------------------------------------------------------------------------------------------------------
// ONE place attaches anything: no new console file calls addEventListener, setInterval, setTimeout or requestAnimationFrame outside
// console-layer.mjs. One named exception: the single legacy keydown listener in cheats-host.js (cheat-codes dish), at most one addEventListener.
const FORBIDDEN = /\b(addEventListener|setInterval|setTimeout|requestAnimationFrame)\b/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const consoleFiles = () => {
  const out = [];
  for (const d of ['src/logic', 'src/vals', 'src/live', 'src/tpl', 'src', 'tools', 'styles']) {
    const dir = resolve(V5, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/\.test\./.test(f) || f === 'console-layer.mjs') continue;
      if (/^console[.-]/.test(f) || f === 'selftest-console.mjs' || f === 'cdp-console.mjs') out.push(join(d, f).replace(/\\/g, '/'));
    }
  }
  return out;
};

test('source rule: no new console file registers a listener, timer or frame outside console-layer.mjs', () => {
  const files = consoleFiles();
  for (const must of ['styles/console.css', 'src/logic/console-skin.js', 'src/vals/console-skin.js', 'src/selftest-console.mjs', 'tools/cdp-console.mjs']) assert.ok(files.includes(must), 'the scan does not cover ' + must);
  for (const f of files) {
    const hits = [...stripComments(read(f)).matchAll(FORBIDDEN)].map((m) => m[1]);
    assert.deepEqual(hits, [], f + ' calls ' + hits.join(', ') + ' directly: register through layerOn / layerTimer / layerFrame');
  }
  const layerSrc = stripComments(read('src/logic/console-layer.mjs'));
  assert.match(layerSrc, /addEventListener/, 'console-layer.mjs is the one file that does it');
});

test('source rule: the one named exception (cheats-host.js: a single legacy keydown listener) stays at one addEventListener and nothing else', () => {
  const p = 'src/logic/cheats-host.js';
  if (!existsSync(resolve(V5, p))) return;   // not written yet: the cheat-codes dish adds it
  const hits = [...stripComments(read(p)).matchAll(FORBIDDEN)].map((m) => m[1]);
  assert.ok(hits.every((h) => h === 'addEventListener') && hits.length <= 1, 'cheats-host.js: ' + hits.join(', '));
});

// ---- wiring (skipped until the integrator applies the shared edits) ----------------------------------------------------------------------
const APP = read('src/app.js');
const WIRED = APP.includes('consoleSkinLogic');
const wired = (name, fn) => test('wiring: ' + name, { skip: WIRED ? false : 'shared edits not applied yet (marker: consoleSkinLogic in app.js)' }, fn);

wired('app.js mixes in consoleSkinLogic, seeds and saves consoleLayer, syncs the layer, and toggleTheme clears the skin', () => {
  assert.match(APP, /import \{[^}]*consoleSkinLogic[^}]*\} from '\.\/logic\/console-skin\.js'/);
  assert.match(APP, /Object\.assign\(Component\.prototype,[^;]*consoleSkinLogic/);
  assert.match(APP, /cslInitState\(/);
  assert.match(APP, /\['themePref'[^\]]*'consoleLayer'[^\]]*\]\.some/, 'consoleLayer is in the componentDidUpdate change list');
  assert.match(APP, /savePrefs\(Object\.assign\(P, \{[^}]*\.\.\.cslSavePatch\(S\)/, 'the prefs save writes consoleLayer');
  assert.match(APP, /ps\.consoleLayer !== S\.consoleLayer\) this\.cslSync\(\)/, 'a change attaches or detaches the layer');
  assert.match(APP, /componentDidMount\(\) \{[\s\S]*?this\.cslSync\(\)/, 'after mount the layer is synced once');
  assert.match(APP, /toggleTheme\(\) \{[^\n]*cslLeaveSkin/);
});

wired('tpl/shell.tpl.js binds the root data-hq-skin to cslv.cslSkin next to data-hq-theme', () => {
  assert.match(read('src/tpl/shell.tpl.js'), /<div data-hq-theme="\{\{ themeName \}\}" data-hq-skin="\{\{ cslv\.cslSkin \}\}"/);
});

wired('vals/index.js registers consoleSkinVals (one surface, one key) and vals/shell.js uses the two helpers', () => {
  const idx = read('src/vals/index.js');
  assert.match(idx, /import \{ consoleSkinVals \} from '\.\/console-skin\.js'/);
  assert.match(idx, /SURFACES = \[[^\]]*consoleSkinVals/);
  const shell = read('src/vals/shell.js');
  assert.match(shell, /consoleThemeOpts\.call\(this, S, tabStyle\)/);
  assert.match(shell, /consoleSettings\.call\(this, S, sw\)/);
});
