// Phase 3 P4 (Studio media) + P5 (Claude › Canvas "＋ Note"). The Component is built
// the way src/logic/surfaces.test.mjs builds it — a store over synthetic DATA plus a
// recording fake of window.hq — and componentDidMount is never called (no timers,
// FX or store subscriptions).
//
//   node --test dashboard-v5/src/logic/studio-claude.test.mjs
//
// Synthetic fixtures only (placeholder names and paths) — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { fileUrl } from '../live/adapter.mjs';
import { proj, scan } from '../live/__fixtures__/synthetic.mjs';
import { fmtDur } from './studio.js';
import { canvasBoardNames, CANVAS_NAME_RE } from './claude.js';
import studioTpl from '../tpl/studio.tpl.js';
import lightboxTpl from '../tpl/lightbox.tpl.js';
import claudeTpl from '../tpl/claude.tpl.js';

process.env.TZ = 'UTC';
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();

// ---- browser globals initState / renderVals touch (same as the golden test) ----------------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {} });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

// ---- synthetic DATA + a recording fake of window.hq ------------------------------------------
const BOARDS = [
  { name: 'Board One', nodes: [{ id: 'n1', type: 'text', text: 'First idea\nSome detail about it', x: 0, y: 0 }], edges: [] },
  { name: 'Board Two', nodes: [{ id: 'n2', type: 'text', text: 'Second board note', x: 0, y: 0 }], edges: [] },
];
function DATA(o = {}) {
  const projects = [proj('a'), proj('b')];
  return { scans: [scan('2026-10-04', projects), scan('2026-10-05', projects)], canvas: o.canvas === undefined ? BOARDS : o.canvas };
}
function fakeHq(o = {}) {
  const calls = [];
  const or = (k, d) => (k in o ? o[k] : d);   // an explicit null/false answer is kept
  const rec = (name, ret) => (...args) => {
    calls.push([name, ...args]);
    if (ret && typeof ret === 'object' && ret.__throw) return Promise.reject(new Error(ret.__throw));
    return Promise.resolve(typeof ret === 'function' ? ret(...args) : ret);
  };
  return {
    calls,
    canvasAdd: rec('canvasAdd', or('canvasAdd', true)),
    studio: { libraryReveal: rec('libraryReveal', or('libraryReveal', true)), libraryDelete: rec('libraryDelete', true), panelToggle: rec('panelToggle', true), snipArm: rec('snipArm', true) },
  };
}
function make(hq, state, dataOpts) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore(DATA(dataOpts), hq === undefined ? fakeHq() : hq);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  if (state) Object.assign(c.state, typeof state === 'function' ? state(c, store.model) : state);
  return c;
}
const hasToast = (c, kind, text) => c.state.toasts.some((t) => t.kind === kind && t.text.includes(text));
const toasts = (c) => c.state.toasts.map((t) => t.kind + ' · ' + t.text).join('\n');
const timers = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
// a settled async action (the fakes resolve at once; the mocked clock never needs to tick)
const settle = () => new Promise((r) => setImmediate(r));

// captures in the shape live/adapter.mjs captures() produces (+ recovered, contract K-2)
const THUMB = 'data:image/jpeg;base64,AAAA';
const cap = (name, kind, o = {}) => ({ id: 'C:/captures/' + name, path: 'C:/captures/' + name, kind, name, day: 'Today', time: o.time || '09:00', size: '1.0 MB', thumb: o.thumb || null, mtime: o.mtime || 1, recovered: !!o.recovered });
const CAPS = () => [
  cap('snip 1.png', 'snip', { thumb: THUMB, mtime: 6, time: '09:50' }),
  cap('snip-2.png', 'snip', { mtime: 5, time: '09:40' }),
  cap('rec-1.webm', 'rec', { mtime: 4, time: '09:30' }),
  cap('rec-2.webm', 'rec', { thumb: THUMB, mtime: 3, time: '09:20' }),
  cap('rec-3.recovered.webm', 'rec', { recovered: true, mtime: 2, time: '09:10' }),
];
function studio(hq, state) {
  const c = make(hq, Object.assign({ tab: 'studio' }, state || {}));
  c.store.live.captures = CAPS();
  return c;
}
const tiles = (v) => v.days.flatMap((d) => d.items);
const tile = (v, name) => tiles(v).find((x) => x.name === name);

// ---- P4 Studio --------------------------------------------------------------------------------
test('fmtDur: a real length reads m:ss / h:mm:ss; unknown, zero, negative and Infinity read as nothing', () => {
  assert.equal(fmtDur(42), '0:42');
  assert.equal(fmtDur(61.6), '1:02');
  assert.equal(fmtDur(3725), '1:02:05');
  assert.equal(fmtDur(0.3), '0:01');
  for (const x of [0, -3, Infinity, NaN, undefined, null, '12']) assert.equal(fmtDur(x), '', String(x));
});

test('tiles: the sidecar thumbnail, else the snip file, else ▶ for a recording (a video never goes in an img)', () => {
  const v = studio().renderVals();
  assert.equal(tiles(v).length, 5);
  const s1 = tile(v, 'snip 1.png'), s2 = tile(v, 'snip-2.png'), r1 = tile(v, 'rec-1.webm'), r2 = tile(v, 'rec-2.webm');
  assert.deepEqual([s1.src, s1.hasImg, s1.noImg], [THUMB, true, false]);
  assert.deepEqual([s2.src, s2.hasImg], [fileUrl('C:/captures/snip-2.png'), true]);
  assert.equal(s2.src, 'file:///C:/captures/snip-2.png');
  assert.deepEqual([r1.src, r1.hasImg, r1.noImg, r1.glyph, r1.isRec], ['', false, true, '▶', true]);
  assert.deepEqual([r2.src, r2.hasImg, r2.isRec], [THUMB, true, true]);
  for (const t of tiles(v)) {
    assert.ok(!/\.webm$/.test(t.src), t.name + ': a recording file is never an image source');
    for (const k of ['src', 'hasImg', 'noImg', 'glyph', 'recovered', 'recoveredTip', 'dur', 'hasDur', 'isRec']) assert.notEqual(t[k], undefined, t.name + '.' + k + ' is bound by the template');
  }
});

test('tiles: only recovered recordings carry the badge; a capture without the flag is not recovered', () => {
  const v = studio().renderVals();
  assert.equal(tile(v, 'rec-3.recovered.webm').recovered, true);
  assert.match(tile(v, 'rec-3.recovered.webm').recoveredTip, /ended abnormally/);
  for (const n of ['snip 1.png', 'snip-2.png', 'rec-1.webm', 'rec-2.webm']) assert.equal(tile(v, n).recovered, false, n);
  const c = studio(); c.store.live.captures = CAPS().map((x) => { const y = Object.assign({}, x); delete y.recovered; return y; });
  assert.ok(tiles(c.renderVals()).every((x) => x.recovered === false));
});

test('a recording’s length stays hidden until its video reports a real one, then shows on the tile and in the lightbox', () => {
  const path = 'C:/captures/rec-1.webm';
  const c = studio(undefined, { lightbox: path });
  let v = c.renderVals();
  assert.deepEqual([tile(v, 'rec-1.webm').dur, tile(v, 'rec-1.webm').hasDur], ['', false]);
  assert.doesNotMatch(v.lb.meta, /\d:\d\d$/);
  // MediaRecorder WebM: Infinity until played through, then the real length
  v.lb.onMeta({ target: { duration: Infinity } });
  v.lb.onMeta({ target: { duration: NaN } });
  v.lb.onMeta({ target: { duration: 0 } });
  assert.equal(c.capDur(path), 0);
  v.lb.onMeta({ target: { duration: 83.2 } });
  v = c.renderVals();
  assert.deepEqual([tile(v, 'rec-1.webm').dur, tile(v, 'rec-1.webm').hasDur], ['1:23', true]);
  assert.equal(v.lb.meta, 'Today 09:30 · 1.0 MB · 1:23');
  assert.equal(tile(v, 'rec-2.webm').hasDur, false, 'other recordings stay unknown');
  assert.equal(tile(v, 'snip-2.png').dur, '', 'a snip has no length');
});

test('lightbox: an img for a snip, a video for a recording, both from the file URL', () => {
  const s = studio(undefined, { lightbox: 'C:/captures/snip 1.png' }).renderVals();
  assert.equal(s.hasLightbox, true);
  assert.deepEqual([s.lb.isImg, s.lb.isVideo, s.lb.noMedia, s.lb.src], [true, false, false, 'file:///C:/captures/snip%201.png']);
  const r = studio(undefined, { lightbox: 'C:/captures/rec-2.webm' }).renderVals();
  assert.deepEqual([r.lb.isImg, r.lb.isVideo, r.lb.noMedia, r.lb.src, r.lb.isRec], [false, true, false, 'file:///C:/captures/rec-2.webm', true]);
  const rr = studio(undefined, { lightbox: 'C:/captures/rec-3.recovered.webm' }).renderVals();
  assert.match(rr.lb.meta, /recovered: the last few seconds may be missing$/);
  const closed = studio().renderVals();
  assert.deepEqual([closed.hasLightbox, closed.lb], [false, {}]);
});

test('a file that fails to load: the tile and hero fall back, the lightbox says so instead of a broken image', () => {
  const file = 'file:///C:/captures/snip-2.png';
  const c = studio(undefined, { lightbox: 'C:/captures/snip-2.png' });
  let v = c.renderVals();
  assert.equal(tile(v, 'snip-2.png').src, file);
  v.lb.onErr();
  v = c.renderVals();
  assert.deepEqual([tile(v, 'snip-2.png').hasImg, tile(v, 'snip-2.png').glyph], [false, '▢']);
  assert.deepEqual([v.lb.isImg, v.lb.noMedia], [false, true]);
  assert.equal(v.lb.missing, 'Couldn’t load snip-2.png · it may have been moved or deleted');
  // the hero prefers the file (sharper), then the sidecar thumbnail, then the glyph
  const h = studio();
  assert.equal(h.renderVals().latest.src, 'file:///C:/captures/snip%201.png');
  h.markCapBad('file:///C:/captures/snip%201.png');
  assert.equal(h.renderVals().latest.src, THUMB);
  h.markCapBad(THUMB);
  assert.deepEqual([h.renderVals().latest.hasImg, h.renderVals().latest.glyph], [false, '▢']);
  for (const k of ['name', 'day', 'time', 'size']) assert.ok(h.renderVals().latest[k], 'latest.' + k);
});

test('Show in folder goes through studio.libraryReveal; a refusal or a missing bridge is said, not swallowed', async (t) => {
  timers(t);
  const path = 'C:/captures/snip-2.png';
  const ok = fakeHq(), c1 = studio(ok, { lightbox: path });
  c1.renderVals().lbReveal(); await settle();
  assert.deepEqual(ok.calls.find((x) => x[0] === 'libraryReveal'), ['libraryReveal', path]);
  assert.equal(c1.state.toasts.length, 0, toasts(c1));

  for (const [hq, text] of [[fakeHq({ libraryReveal: false }), 'it may have been moved or deleted'], [fakeHq({ libraryReveal: { __throw: 'boom' } }), 'Couldn’t show it in its folder · boom']]) {
    const c = studio(hq, { lightbox: path });
    c.renderVals().lbReveal(); await settle();
    assert.ok(hasToast(c, 'error', text), toasts(c));
  }
  const nb = studio({}, { lightbox: path });   // a bridge without studio
  nb.renderVals().lbReveal(); await settle();
  assert.ok(hasToast(nb, 'error', 'Unavailable — the bridge is offline'), toasts(nb));
});

test('Open stays honestly not wired; Escape and the backdrop still close the lightbox', (t) => {
  timers(t);
  const c = studio(undefined, { lightbox: 'C:/captures/snip-2.png' });
  c.renderVals().lbOpen();
  assert.ok(hasToast(c, 'info', 'isn’t wired'), toasts(c));
  c.renderVals().closeLightbox();
  assert.equal(c.state.lightbox, null);
  c.state.lightbox = 'C:/captures/snip-2.png';
  c.closeTop();   // what Escape calls
  assert.equal(c.state.lightbox, null);
  assert.match(lightboxTpl, /<div onClick="\{\{ closeLightbox \}\}"/);
  assert.match(lightboxTpl, /<div onClick="\{\{ stop \}\}"/);
});

// runtime-3 (renderer half): main's panel-toggle hides a visible panel, so "● Open recorder"
// clicked during a recording used to hide the live pill and leave no visible stop control
test('● Open recorder during a recording leaves the live pill alone and says where it is', (t) => {
  timers(t);
  const hq = fakeHq();
  const c = studio(hq);
  c.store.live.recording = { state: 'recording', recId: 'r-1', elapsedMs: 4000 };
  c.renderVals().record();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'panelToggle'), [], 'never toggled (= hidden) mid-recording');
  assert.ok(hasToast(c, 'info', 'the recorder is the pill on screen'), toasts(c));
  c.store.live.recording = null;              // nothing recording: it opens the panel as before
  c.renderVals().record();
  assert.equal(hq.calls.filter((x) => x[0] === 'panelToggle').length, 1);
});

test('studio markup: real media, each change marked for the designer; no striped placeholder left', () => {
  assert.match(studioTpl, /<!-- v5:[^>]*-->(<[^>]*>)*<sc-if value="\{\{ c\.hasImg \}\}"[^>]*><img src="\{\{ c\.src \}\}"/);
  assert.match(studioTpl, /<sc-if value="\{\{ c\.recovered \}\}"[^>]*><span title="\{\{ c\.recoveredTip \}\}"[^>]*>recovered<\/span>/);
  assert.match(studioTpl, /●<sc-if value="\{\{ c\.hasDur \}\}"[^>]*> \{\{ c\.dur \}\}<\/sc-if>/);
  assert.match(studioTpl, /<!-- v5:[^>]*-->(<[^>]*>)*<sc-if value="\{\{ latest\.hasImg \}\}"[^>]*><img src="\{\{ latest\.src \}\}"/);
  assert.match(lightboxTpl, /<!-- v5:[^>]*-->(<[^>]*>)*<sc-if value="\{\{ lb\.isImg \}\}"[^>]*><img src="\{\{ lb\.src \}\}"/);
  assert.match(lightboxTpl, /<video src="\{\{ lb\.src \}\}" controls preload="metadata" onLoadedMetadata="\{\{ lb\.onMeta \}\}"/);
  assert.doesNotMatch(lightboxTpl, /<video[^>]*\sautoplay/i, 'a recording never starts on its own');
  assert.doesNotMatch(studioTpl + lightboxTpl, /repeating-linear-gradient/);
});

// ---- P5 Canvas "＋ Note" -----------------------------------------------------------------------
test('canvasBoardNames: the raw board list wins, else the widgets’ boards; unique, in order, only names main accepts', () => {
  assert.deepEqual(canvasBoardNames([{ name: 'Board One' }, { name: 'bad.name' }, { name: 'Board One' }, { name: '../x' }, {}, null, { name: 'B_2 x-y' }], [{ board: 'Other' }]), ['Board One', 'B_2 x-y']);
  assert.deepEqual(canvasBoardNames(undefined, [{ board: 'W1' }, { board: 'W1' }, { board: 'W 2' }, { board: '.hidden' }]), ['W1', 'W 2']);
  assert.deepEqual(canvasBoardNames([], [{ board: 'W1' }]), [], 'an empty board list means no boards, not a fallback');
  assert.deepEqual(canvasBoardNames(undefined, undefined), []);
  assert.ok(CANVAS_NAME_RE.test('a'.repeat(64)) && !CANVAS_NAME_RE.test('a'.repeat(65)) && !CANVAS_NAME_RE.test(' lead'));
});

function canvas(hq, state, dataOpts) {
  return make(hq, Object.assign({ tab: 'claude', sub: { claude: 'canvas' } }, state || {}), dataOpts);
}

test('＋ Note: board chips come from the live board list (K-2) or, before it exists, from the canvas widgets', () => {
  const c = canvas();
  delete c.store.live.canvasBoards;   // before K-2 landed: the widgets' boards
  let v = c.renderVals();
  assert.equal(v.isCanvas, true);
  assert.deepEqual(v.canvasBoardChips.map((b) => [b.label, b.pressed]), [['Board One', 'true'], ['Board Two', 'false']]);
  assert.equal(v.cantCanvasNote, false);
  // the live list (contract K-2) includes boards with no text cards yet
  c.store.live.canvasBoards = [{ name: 'Board Two', nodes: [] }, { name: 'Empty Board', nodes: [] }];
  v = c.renderVals();
  assert.deepEqual(v.canvasBoardChips.map((b) => b.label), ['Board Two', 'Empty Board']);
  v.canvasBoardChips[1].go();
  assert.equal(c.state.canvasBoard, 'Empty Board');
  assert.deepEqual(c.renderVals().canvasBoardChips.map((b) => b.pressed), ['false', 'true']);
  // a picked board that went away falls back to the first one
  c.store.live.canvasBoards = [{ name: 'Board Two', nodes: [] }];
  assert.equal(c.canvasBoardPick(), 'Board Two');
});

test('＋ Note is disabled with the reason: no bridge (v3 tooltip), the time machine, no boards', () => {
  const nb = canvas({});   // a bridge without canvasAdd
  let v = nb.renderVals();
  assert.deepEqual([v.cantCanvasNote, v.canvasNoteTip, v.cantAddNote], [true, 'Unavailable — the bridge is offline', true]);
  const none = canvas(null);
  assert.equal(none.renderVals().canvasNoteTip, 'Unavailable — the bridge is offline');
  const past = canvas(undefined, { snapOffset: 1 });
  v = past.renderVals();
  assert.equal(v.cantCanvasNote, true);
  assert.match(v.canvasNoteTip, /^Read-only · viewing /);
  const empty = canvas(undefined, null, { canvas: [] });
  delete empty.store.live.canvasBoards;
  v = empty.renderVals();
  assert.equal(v.cantCanvasNote, true);
  assert.match(v.canvasNoteTip, /^No canvas boards yet/);
  assert.match(v.canvasEmptyText, /once a board exists/);
  // an open form closes itself when adding stops being possible
  nb.state.canvasNoteOpen = true;
  assert.deepEqual([nb.renderVals().canvasNoteOpen, nb.renderVals().canvasNoteExpanded], [false, 'false']);
  const ok = canvas(undefined, { canvasNoteOpen: true });
  assert.deepEqual([ok.renderVals().canvasNoteOpen, ok.renderVals().canvasNoteExpanded], [true, 'true']);
  assert.match(ok.renderVals().canvasEmptyText, /Add a note with ＋ Note/);
});

test('＋ Note toggles the form; adding sends {type:text, text, x:40, y:40} to the picked board and says it appears in a moment', async (t) => {
  timers(t);
  const hq = fakeHq(), c = canvas(hq);
  c.renderVals().toggleCanvasNote();
  assert.equal(c.state.canvasNoteOpen, true);
  let v = c.renderVals();
  assert.equal(v.cantAddNote, true, 'nothing typed yet');
  v.onCanvasDraft({ target: { value: '  remember the thing  ' } });
  v = c.renderVals();
  assert.equal(v.cantAddNote, false);
  v.canvasBoardChips[1].go();
  c.renderVals().addCanvasNote(); await settle();
  assert.deepEqual(hq.calls.filter((x) => x[0] === 'canvasAdd'), [['canvasAdd', 'Board Two', { type: 'text', text: 'remember the thing', x: 40, y: 40 }]]);
  assert.ok(hasToast(c, 'success', 'Added to Board Two · it appears in a moment'), toasts(c));
  assert.equal(c.state.canvasDraft, '');
  assert.equal(c.state.canvasSaving, false);
  assert.equal(c.state.canvasNoteOpen, true, 'the form stays open for the next note (v3)');
  c.renderVals().toggleCanvasNote();
  assert.equal(c.state.canvasNoteOpen, false);
});

test('＋ Note: false is “Not added” and the draft is kept; a throw says why; empty text, no bridge or the time machine send nothing', async (t) => {
  timers(t);
  for (const [ret, text] of [[false, 'Not added'], [null, 'Not added'], [{ __throw: 'disk full' }, 'Not added · disk full']]) {
    const hq = fakeHq({ canvasAdd: ret }), c = canvas(hq, { canvasDraft: 'a note' });
    await c.addCanvasNote();
    assert.equal(hq.calls.filter((x) => x[0] === 'canvasAdd').length, 1);
    assert.ok(c.state.toasts.some((x) => x.kind === 'error' && x.text === text), toasts(c));
    assert.ok(!hasToast(c, 'success', 'Added'), 'no success claim for ' + JSON.stringify(ret));
    assert.equal(c.state.canvasDraft, 'a note');
    assert.equal(c.state.canvasSaving, false);
  }
  const blank = fakeHq(), cb = canvas(blank, { canvasDraft: '   ' });
  await cb.addCanvasNote();
  assert.equal(blank.calls.length, 0);
  const past = fakeHq(), cp = canvas(past, { canvasDraft: 'x', snapOffset: 1 });
  await cp.addCanvasNote();
  assert.equal(past.calls.length, 0);
  assert.ok(hasToast(cp, 'error', 'Read-only'), toasts(cp));
  const nb = canvas({}, { canvasDraft: 'x' });
  await nb.addCanvasNote();
  assert.ok(hasToast(nb, 'error', 'Unavailable — the bridge is offline'), toasts(nb));
});

test('＋ Note: text is capped at 600 characters, Enter adds once (not while composing or on key repeat)', async (t) => {
  timers(t);
  const hq = fakeHq(), c = canvas(hq, { canvasDraft: 'x'.repeat(700) });
  let prevented = 0;
  const key = (o) => Object.assign({ key: 'Enter', isComposing: false, repeat: false, preventDefault: () => { prevented++; } }, o);
  c.renderVals().canvasDraftKey(key({ isComposing: true }));
  c.renderVals().canvasDraftKey(key({ repeat: true }));
  c.renderVals().canvasDraftKey(key({ key: 'a' }));
  await settle();
  assert.equal(hq.calls.length, 0);
  c.renderVals().canvasDraftKey(key({}));
  c.renderVals().canvasDraftKey(key({}));   // a second Enter while the first is out is ignored
  await settle();
  const sent = hq.calls.filter((x) => x[0] === 'canvasAdd');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][2].text.length, 600);
  assert.equal(prevented, 2);
});

test('canvas markup: ＋ Note, the 600-char input and the board picker are marked for the designer; cards show their board, not an AI claim', () => {
  assert.match(claudeTpl, /<!-- v5:[^>]*-->(<[^>]*>)*<div[^>]*>Boards you share with Claude[^<]*<\/div><button type="button" onClick="\{\{ toggleCanvasNote \}\}" disabled="\{\{ cantCanvasNote \}\}" title="\{\{ canvasNoteTip \}\}"[^>]*>＋ Note<\/button>/);
  assert.match(claudeTpl, /<!-- v5:[^>]*-->\s*<sc-if value="\{\{ canvasNoteOpen \}\}"/);
  assert.match(claudeTpl, /<input [^>]*maxlength="600"[^>]*placeholder="New note…[^"]*"/);
  assert.match(claudeTpl, /<sc-for list="\{\{ canvasBoardChips \}\}" as="b"/);
  assert.match(claudeTpl, /<!-- v5:[^>]*--><span[^>]*>\{\{ w\.board \}\}<\/span>/);
  assert.doesNotMatch(claudeTpl, /Everything here is model output/);
  assert.doesNotMatch(claudeTpl, /color:var\(--purple\)">✦ AI<\/span>/, 'canvas cards no longer claim to be AI output');
  assert.match(claudeTpl, />✦ AI output</, 'a session’s output still is');
});
