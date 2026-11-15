// node --test dashboard-v5/tools/cdp-cheats.test.mjs
// The cheat-code cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, that the keydown counting hook really counts add and remove on window (and nothing else), that the wording and the names
// the scenarios look for are the registry's own, that each scenario stops at a failed fresh() and touches nothing, and that a page that never
// does what a scenario waits for is reported and put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeCheatsScenarios, PAGE, KD_HOOK, EXPECT_KEYDOWN, LAYER_DEFAULT, FOUND_NAMES, ALL_CODES, typeKeys, pressArrowUp } from './cdp-cheats.mjs';
import { CHEATS } from '../src/logic/cheats.mjs';

const NAMES = ['cheats-legacy-still-work', 'cheats-typing-guard', 'cheats-unlock-chain', 'cheats-off-zero-cost', 'cheats-debug-overlay', 'cheats-reduced-motion', 'cheats-found-persist'];

test('the factory returns exactly the seven scenarios, each an async function of one argument', () => {
  const S = makeCheatsScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript (the function ones are called with a sample)', () => {
  const samples = { setLayer: [{ on: true, debug: true }], setState: [{ reduceMotion: true }], restorePrefs: ['{"a":1}'] };
  for (const [k, s] of Object.entries(PAGE)) {
    const code = typeof s === 'function' ? s(...(samples[k] || [])) : s;
    assert.equal(typeof code, 'string', k);
    assert.doesNotThrow(() => new vm.Script(code), k);
  }
  assert.doesNotThrow(() => new vm.Script(KD_HOOK));
  assert.match(PAGE.restorePrefs(null), /removeItem/);
  assert.match(PAGE.restorePrefs('x'), /setItem/);
  assert.match(PAGE.setLayer({ palette: 'tide' }), /"palette":"tide"/);
});

test('the keydown hook counts add and remove of window keydown listeners, once per function, and ignores every other listener', () => {
  // run inside one context so `window` and `this` are the same object, as in a page
  const calls = [];
  const ctx = vm.createContext({ log: (m, type) => calls.push([m, type]) });
  vm.runInContext('var window = this; window.addEventListener = function (type, fn) { log("add", type); }; window.removeEventListener = function (type, fn) { log("rem", type); };', ctx);
  vm.runInContext(KD_HOOK, ctx);
  const run = (s) => vm.runInContext(s, ctx);
  run('var a = function () {}, b = function () {};');
  run("window.addEventListener('keydown', a); window.addEventListener('keydown', a); window.addEventListener('keydown', b); window.addEventListener('keyup', b); window.addEventListener('keydown', a, true);");
  assert.equal(run('window.__hqKeydownCount()'), 3, 'a, b and a-with-capture; the same function twice is one listener');
  run("window.removeEventListener('keydown', a);");
  assert.equal(run('window.__hqKeydownCount()'), 2);
  run("window.removeEventListener('keydown', a);");
  assert.equal(run('window.__hqKeydownCount()'), 2, 'removing what is not there changes nothing');
  assert.equal(calls.filter((c) => c[1] === 'keyup').length, 1, 'every call still reaches the real method');
  // a bare call (how hq-fx.js and app code write it) counts too
  run("addEventListener('keydown', function () {});");
  assert.equal(run('window.__hqKeydownCount()'), 3);
  // a second install does not wrap twice
  vm.runInContext(KD_HOOK, ctx);
  run("window.addEventListener('keydown', function () {});");
  assert.equal(run('window.__hqKeydownCount()'), 4);
  // an element's listener is not the window's
  run("var el = { addEventListener: window.addEventListener }; el.addEventListener('keydown', function () {});");
  assert.equal(run('window.__hqKeydownCount()'), 4);
});

test('the expectation is the delta the plan states: two listeners on window, today and after the move', () => {
  assert.equal(EXPECT_KEYDOWN, 2);
});

test("the layer defaults the scenarios reset to are the documented pref, all off, and the names are the registry's own", () => {
  assert.deepEqual(LAYER_DEFAULT, { on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
  assert.deepEqual(ALL_CODES.slice(), CHEATS.map((c) => c.id));
  for (const c of CHEATS) assert.equal(FOUND_NAMES[c.id], c.name, c.id);
  assert.equal(Object.keys(FOUND_NAMES).length, CHEATS.length);
});

test('the wording the scenarios expect is what the registry says and what the overlay and the list draw', async () => {
  const { runCheat } = await import('../src/logic/cheats.mjs');
  const st = { layerOn: true, skin: false, palette: '', debug: false, found: [] };
  const want = { cartridge: 'Console layer on', plastic: 'Console skin on', ember: 'Ember accent on', tide: 'Tide accent on', timing: 'Timing overlay on' };
  assert.equal(runCheat('cartridge', { ...st, layerOn: false }).toast.text, want.cartridge);
  for (const id of ['plastic', 'ember', 'tide', 'timing']) assert.equal(runCheat(id, st).toast.text, want[id], id);
  assert.equal(runCheat('ember', { ...st, palette: 'ember' }).toast.text, 'Ember accent off');
  const tpl = (await import('../src/tpl/cheats-overlay.tpl.js')).default;
  assert.ok(tpl.includes('aria-label="Frame timing"'));
  assert.ok(tpl.includes('aria-label="Close frame timing"'));
  for (const w of ['p50', 'p95', 'renders, last minute', 'values', 'last live update', 'last render']) assert.ok(tpl.includes(w), w);
  const { foundFragment } = await import('../src/tpl/cheats-overlay.tpl.js');
  assert.ok(foundFragment.includes('data-hq-console="found"'));
  assert.ok(tpl.includes('data-hq-console="timing"'));
  const { foundSummary } = await import('../src/logic/cheats.mjs');
  assert.equal(foundSummary(['cartridge', 'plastic', 'ember', 'tide', 'timing']).title, 'Codes found: 5 of 7');
  assert.equal(foundSummary(['cartridge', 'ember', 'bit']).title, 'Codes found: 3 of 7');
});

test('typeKeys sends a keyDown with text then a keyUp per letter, and ArrowUp is a raw key', async () => {
  const sent = [];
  const t = { send: async (m, p) => { sent.push([m, p]); } };
  await typeKeys(t, 'ab');
  assert.deepEqual(sent.map(([m, p]) => [m, p.type, p.key]), [['Input.dispatchKeyEvent', 'keyDown', 'a'], ['Input.dispatchKeyEvent', 'keyUp', 'a'], ['Input.dispatchKeyEvent', 'keyDown', 'b'], ['Input.dispatchKeyEvent', 'keyUp', 'b']]);
  assert.equal(sent[0][1].text, 'a');
  assert.equal(sent[0][1].code, 'KeyA');
  assert.equal(sent[0][1].windowsVirtualKeyCode, 65);
  sent.length = 0;
  await pressArrowUp(t);
  assert.deepEqual(sent.map(([, p]) => [p.type, p.key, p.windowsVirtualKeyCode]), [['rawKeyDown', 'ArrowUp', 38], ['keyUp', 'ArrowUp', 38]]);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [], sends = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {}, send: async (m) => { sends.push(m); return {}; }, reload: async () => { sends.push('reload'); } };
  const S = makeCheatsScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
  assert.equal(sends.length, 0);
});

test('a page that never does what a scenario waits for is reported, and the page is put back', async () => {
  const S = makeCheatsScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    const evals = [], sends = [];
    const t = {
      evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {},
      send: async (m, p) => { sends.push([m, p]); return { identifier: 'hook-1' }; }, reload: async () => { sends.push(['reload']); },
    };
    const out = await S[name](t);
    assert.ok(Array.isArray(out) && out.length > 0, name + ' reported nothing for a page that does nothing');
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes('settingsOpen: false')), name + ' closes Settings');
    assert.ok(evals.some((s) => s.includes('localStorage.removeItem("whq3-prefs")') || s.includes('localStorage.setItem("whq3-prefs"')), name + ' puts the prefs key back');
    for (const s of out) assert.equal(typeof s, 'string');
  }
});

test('the zero-cost scenario installs its hook and removes it again, then reloads the page clean', async () => {
  const sends = [];
  const t = { evaluate: async () => '', waitFor: async () => false, errors: () => [], clearErrors() {}, send: async (m, p) => { sends.push([m, p && (p.identifier || (p.source ? 'source' : ''))]); return { identifier: 'hook-9' }; }, reload: async () => { sends.push(['reload']); } };
  const S = makeCheatsScenarios({ fresh: async () => null, sleep: async () => {} });
  await S['cheats-off-zero-cost'](t);
  const names = sends.map((s) => s[0]);
  assert.ok(names.includes('Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(names.includes('Page.removeScriptToEvaluateOnNewDocument'));
  assert.ok(names.indexOf('Page.addScriptToEvaluateOnNewDocument') < names.indexOf('reload'), 'the hook goes in BEFORE the reload, so it wraps addEventListener ahead of the app');
  assert.equal(names[names.length - 1], 'reload', 'and the page is reloaded clean at the end');
  assert.ok(sends.some((s) => s[0] === 'Page.removeScriptToEvaluateOnNewDocument' && s[1] === 'hook-9'));
});

test('the reduced-motion scenario clears the emulated media on the way out', async () => {
  const sends = [];
  const t = { evaluate: async () => '', waitFor: async () => false, errors: () => [], clearErrors() {}, send: async (m, p) => { sends.push([m, p]); return {}; }, reload: async () => {} };
  const S = makeCheatsScenarios({ fresh: async () => null, sleep: async () => {} });
  await S['cheats-reduced-motion'](t);
  const media = sends.filter(([m]) => m === 'Emulation.setEmulatedMedia').map(([, p]) => p.features);
  assert.equal(media.length >= 2, true);
  assert.deepEqual(media[0], [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.deepEqual(media[media.length - 1], []);
});
