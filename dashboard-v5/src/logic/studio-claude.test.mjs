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
import { canvasBoardNames, CANVAS_NAME_RE } from './claude.js';
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
