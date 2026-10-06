// "What's new · trailers" (Phase 3 P8, src/logic/whats-new.js) and the P3-SHELL
// app.js changes: opens once per version and only in front of the owner (a window
// that starts hidden to the tray waits for focus), Settings and closeTop, the
// bundled flag vs the files in dashboard-v5/media/, the template's no-autoplay
// markup, initState's Ask spread (contract K-1) and the dead notifyMeasured key.
// The Component is built the way src/logic/shell.test.mjs builds it
// (componentDidMount is never called).
//
//   node --test dashboard-v5/src/logic/whats-new.test.mjs
//
// Synthetic fixtures only (placeholder names and paths) — the repo is public.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan } from '../live/__fixtures__/synthetic.mjs';
import { WHATS_NEW_VERSION, TRAILERS, CHANGES, whatsNewDue, withWhatsNewSeen, changesFor } from './whats-new.js';
import extrasTpl from '../tpl/extras.tpl.js';
import settingsTpl from '../tpl/ov-settings.tpl.js';

process.env.TZ = 'UTC';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
// window events are recorded so the focus wait can be fired and checked
const listeners = new Map();
const on = (type) => [...(listeners.get(type) || [])];
const fire = (type) => on(type).forEach((f) => f({ type }));
let focused = false;
define('window', {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery,
  addEventListener(type, f) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(f); },
  removeEventListener(type, f) { if (listeners.has(type)) listeners.get(type).delete(f); },
});
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, hasFocus: () => focused });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const IDS = ['2026-10-01', '2026-10-03', '2026-10-05'];
const DATA = { scans: IDS.map((id) => scan(id, [proj('a', { dirty: 2 }), proj('b')])) };
const make = (props) => new Component(Object.assign({ store: createStore(DATA, null), previewState: 'live', startTab: 'home', theme: 'dark', pet: false }, props || {}));
const prefs = () => JSON.parse(localStorage.getItem('whq3-prefs') || '{}');
const key = (k, o) => ({ key: k, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...(o || {}) });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); listeners.clear(); focused = false; });

// ---- pure helpers ----------------------------------------------------------------
test('due until this version is marked seen; marking keeps every other pref', () => {
  assert.equal(WHATS_NEW_VERSION, '2026-10');
  assert.equal(whatsNewDue(undefined), true);
  assert.equal(whatsNewDue({}), true);
  assert.equal(whatsNewDue({ whatsNewSeen: '2026-09' }), true, 'an older version shows the new one');
  assert.equal(whatsNewDue({ whatsNewSeen: '2026-10' }), false);
  const before = { uiPrefsSeeded: true, sound: false };
  const after = withWhatsNewSeen(before);
  assert.deepEqual(after, { uiPrefsSeeded: true, sound: false, whatsNewSeen: '2026-10' });
  assert.deepEqual(before, { uiPrefsSeeded: true, sound: false }, 'the input is not changed');
});

test('a change line that needs another package’s method shows only when that method exists', () => {
  const base = CHANGES.filter((c) => !c.needs).map((c) => c.text);
  assert.ok(base.length >= 4);
  assert.deepEqual(changesFor({}), base);
  const needs = CHANGES.filter((c) => c.needs);
  for (const c of needs) assert.ok(changesFor({ [c.needs]() {} }).includes(c.text), c.needs + ' line missing when the method exists');
  assert.ok(CHANGES.every((c) => typeof c.text === 'string' && c.text.length > 20));
});

// ---- the trailers: paths, and the bundled flag vs the files on disk ----------------
test('two trailers, paths relative to dashboard-v5/index.html', () => {
  assert.equal(TRAILERS.length, 2);
  TRAILERS.forEach((t, i) => {
    assert.equal(t.src, 'media/hq-trailer-' + (i + 1) + '.webm');
    assert.equal(t.poster, 'media/hq-trailer-' + (i + 1) + '.jpg');
    assert.equal(typeof t.bundled, 'boolean');
  });
  assert.equal(new Set(TRAILERS.map((t) => t.id)).size, 2);
});

// A missing poster logs "Failed to load resource" at error level (that fails the
// selftest and the CDP gates), so a trailer renders as a <video> only when bundled.
// When the trailer package adds media/, flip `bundled` in logic/whats-new.js.
test('TRAILERS[i].bundled matches the files in dashboard-v5/media/', () => {
  for (const t of TRAILERS) {
    const here = (p) => existsSync(fileURLToPath(new URL('../../' + p, import.meta.url)));
    const both = here(t.src) && here(t.poster);
    assert.equal(t.bundled, both, t.id + ': bundled is ' + t.bundled + ' but ' + t.src + ' + ' + t.poster + (both ? ' are both there' : ' are not both there') + ' — update TRAILERS in src/logic/whats-new.js');
  }
});

// ---- first launch ----------------------------------------------------------------
test('first launch with focus: opens once and marks this version seen', () => {
  localStorage.setItem('whq3-prefs', JSON.stringify({ uiPrefsSeeded: true }));
  focused = true;
  const c = make();
  assert.equal(c.state.whatsNewOpen, false, 'initState never opens it');
  assert.equal(c.maybeShowWhatsNew(), true);
  assert.equal(c.state.whatsNewOpen, true);
  assert.deepEqual(prefs(), { uiPrefsSeeded: true, whatsNewSeen: '2026-10' });
  const again = make();   // the next launch
  assert.equal(again.maybeShowWhatsNew(), false);
  assert.equal(again.state.whatsNewOpen, false);
  assert.equal(on('focus').length, 0, 'nothing waits once it was seen');
});

test('started hidden (no focus): waits for the first focus, and only then marks it seen', () => {
  const c = make();
  assert.equal(c.maybeShowWhatsNew(), false);
  assert.equal(c.state.whatsNewOpen, false);
  assert.equal(prefs().whatsNewSeen, undefined, 'a hidden window must not burn it');
  assert.equal(on('focus').length, 1);
  c.maybeShowWhatsNew();   // a second call doesn't stack listeners
  assert.equal(on('focus').length, 1);
  fire('focus');
  assert.equal(c.state.whatsNewOpen, true);
  assert.equal(prefs().whatsNewSeen, '2026-10');
  assert.equal(on('focus').length, 0, 'one-shot');
  c.closeWhatsNew();
  fire('focus');
  assert.equal(c.state.whatsNewOpen, false);
});

test('opened another way before the window got focus: the wait is dropped', () => {
  const c = make();
  c.maybeShowWhatsNew();
  assert.equal(on('focus').length, 1);
  c.openWhatsNew();   // Settings or the palette
  assert.equal(on('focus').length, 0);
  assert.equal(prefs().whatsNewSeen, '2026-10');
});

test('the unmount path drops a pending wait', () => {
  const c = make();
  c.maybeShowWhatsNew();
  c.stopWhatsNewWait();
  assert.equal(on('focus').length, 0);
  c.stopWhatsNewWait();   // twice is fine
});

test('not over the loading or error screen', () => {
  focused = true;
  for (const previewState of ['loading', 'error']) {
    const c = make({ previewState });
    assert.equal(c.maybeShowWhatsNew(), false, previewState);
    assert.equal(c.state.whatsNewOpen, false);
  }
  assert.equal(prefs().whatsNewSeen, undefined);
  assert.equal(on('focus').length, 0);
});

// ---- Settings, Escape, the key guard ----------------------------------------------
test('from Settings it opens on top; Escape closes it first, then Settings', () => {
  const c = make();
  c.setState({ settingsOpen: true });
  c.renderVals().openWhatsNew();
  assert.equal(c.state.whatsNewOpen, true);
  assert.equal(c.state.settingsOpen, true, 'Settings stays open underneath');
  c.onKey(key('Escape'));
  assert.equal(c.state.whatsNewOpen, false);
  assert.equal(c.state.settingsOpen, true);
  c.onKey(key('Escape'));
  assert.equal(c.state.settingsOpen, false);
});

test('while it is open, single-key shortcuts don’t act underneath', () => {
  const c = make();
  c.openWhatsNew();
  const tab = c.state.tab;
  c.onKey(key('3'));
  c.onKey(key('?'));
  assert.equal(c.state.tab, tab);
  assert.equal(c.state.cheatOpen, false);
  c.renderVals().closeWhatsNew();
  assert.equal(c.state.whatsNewOpen, false);
});

// ---- render values ------------------------------------------------------------------
test('render values: a trailer is a video only when bundled and not failed', () => {
  const c = make();
  c.openWhatsNew();
  let v = c.renderVals();
  assert.equal(v.whatsNewOpen, true);
  assert.equal(v.whatsNew.version, 'v5 · 2026-10');
  assert.equal(v.whatsNew.trailers.length, 2);
  v.whatsNew.trailers.forEach((t, i) => {
    assert.equal(t.ok, TRAILERS[i].bundled);
    assert.equal(t.missing, !TRAILERS[i].bundled);
    assert.equal(t.src, TRAILERS[i].src);
    assert.equal(t.poster, TRAILERS[i].poster);
  });
  assert.deepEqual(v.whatsNew.changes, changesFor(c));
  v.whatsNew.trailers[0].failed();   // the video's error event
  v = c.renderVals();
  assert.equal(v.whatsNew.trailers[0].ok, false);
  assert.equal(v.whatsNew.trailers[0].missing, true);
  assert.deepEqual(c.state.whatsNewMissing, { [TRAILERS[0].id]: true });
});

// ---- the template ------------------------------------------------------------------
test('the overlay markup: never autoplays, loads nothing up front, text fallback', () => {
  assert.match(extrasTpl, /<video preload="none" controls poster="\{\{ t\.poster \}\}" src="\{\{ t\.src \}\}" onError="\{\{ t\.failed \}\}"/);
  const markup = extrasTpl.replace(/<!--[\s\S]*?-->/g, '');   // the markers may say "no autoplay"
  assert.ok(!/autoplay/i.test(markup), 'no autoplay attribute anywhere');
  assert.ok(!/\.play\(/.test(markup));
  assert.match(extrasTpl, /<sc-if value="\{\{ t\.ok \}\}"/);
  assert.match(extrasTpl, /<sc-if value="\{\{ t\.missing \}\}"[^>]*>\s*<!-- v5:[^>]*-->\s*<div[^>]*>Trailer not bundled in this build<\/div>/);
  assert.match(extrasTpl, /role="dialog" aria-label="What's new"/);
  assert.match(extrasTpl, /<sc-if value="\{\{ whatsNewOpen \}\}"/);
  assert.match(extrasTpl, /onClick="\{\{ closeWhatsNew \}\}"/);
});

// honesty-5: the overlay opens on its own on first launch and the trailers show made-up
// projects and an Ask answer, silently; the card says so (as README.md does), under the grid
test('the trailer grid is followed by a note: sample data, not your scans, and no sound', () => {
  const grid = extrasTpl.indexOf('</sc-for>'), changes = extrasTpl.indexOf('What changed in this version');
  const note = extrasTpl.indexOf('The trailers show sample data, not your scans');
  assert.ok(grid > 0 && note > grid && note < changes, 'between the trailers and the change list');
  assert.match(extrasTpl.slice(note, extrasTpl.indexOf('</div>', note)), /made up\. They have no sound yet\.$/);
});

test('every element in extras.tpl.js has a <!-- v5: --> marker right before it', () => {
  const lines = extrasTpl.split('\n').map((l) => l.trim());
  const unmarked = [];
  lines.forEach((l, i) => {
    const m = l.match(/^<([a-z][a-z0-9-]*)/);
    if (!m || m[1] === 'sc-if' || m[1] === 'sc-for') return;   // directives, not elements
    if (!lines[i - 1] || !lines[i - 1].startsWith('<!-- v5:')) unmarked.push(l.slice(0, 60));
  });
  assert.deepEqual(unmarked, []);
  assert.match(extrasTpl, /^\s*<!-- v5:[^>]*-->\s*<sc-if value="\{\{ whatsNewOpen \}\}"/);
});

test('Settings has the marked "What’s new · trailers" row', () => {
  assert.match(settingsTpl, /<!-- v5:[^>]*What's new · trailers[^>]*-->\s*<div[^>]*><div[^>]*><div[^>]*>What's new · trailers<\/div>[\s\S]*?onClick="\{\{ openWhatsNew \}\}"[^>]*>Open<\/button><\/div>/);
});

// ---- app.js: initState, the place write, prefs ----------------------------------------
function withAskInit(fn, impl) {
  const P = Component.prototype, had = Object.getOwnPropertyDescriptor(P, 'askInitState');
  if (impl) P.askInitState = impl; else delete P.askInitState;
  try { return fn(); } finally { if (had) Object.defineProperty(P, 'askInitState', had); else delete P.askInitState; }
}

test('initState: new keys declared, no notifyMeasured, Ask history from askInitState (K-1)', () => {
  localStorage.setItem('whq3-prefs', JSON.stringify({ notifyMeasured: false }));
  sessionStorage.setItem('whq3-place', JSON.stringify({ tab: 'tasks', ask: [{ q: 'old', id: 'x', a: { text: 'old', status: 'done' } }] }));
  withAskInit(() => {
    const c = make();
    assert.equal('notifyMeasured' in c.state, false);
    assert.equal(c.state.whatsNewOpen, false);
    assert.deepEqual(c.state.whatsNewMissing, {});
    assert.deepEqual(c.state.askHistory, [], 'whq3-place.ask is no longer read');
    assert.equal(c.state.tab, 'tasks', 'the rest of whq3-place still is');
  });
  const hist = [{ q: 'q', id: 'a1', a: { text: 'x', status: 'done' } }];
  withAskInit(() => {
    const c = make();
    assert.deepEqual(c.state.askHistory, hist);
    assert.deepEqual(c.state.askInclude, { scan: true });
  }, () => ({ askHistory: hist, askInclude: { scan: true } }));
});

test('the whq3-place write no longer carries the Ask chat', () => {
  const c = make();
  c.setState({ askHistory: [{ q: 'q', id: 'a1', a: { text: 'x', status: 'done' } }], tab: 'projects' });
  c.componentDidUpdate();
  const place = JSON.parse(sessionStorage.getItem('whq3-place'));
  assert.equal('ask' in place, false);
  assert.equal(place.tab, 'projects');
});

test('saving prefs drops a notifyMeasured older builds left and keeps whatsNewSeen', () => {
  localStorage.setItem('whq3-prefs', JSON.stringify({ notifyMeasured: true, whatsNewSeen: '2026-10', uiPrefsSeeded: true }));
  const c = make();
  c._prev = Object.assign({}, c.state, { sound: !c.state.sound });   // a pref changed since the last render
  c.componentDidUpdate();
  const p = prefs();
  assert.equal('notifyMeasured' in p, false);
  assert.equal(p.whatsNewSeen, '2026-10');
  assert.equal(p.uiPrefsSeeded, true);
  assert.equal(p.sound, c.state.sound);
});
