// node --test dashboard-v5/tools/cdp-quiet-light.test.mjs
// The quiet-light cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, that each scenario stops at a failed fresh() and touches nothing, that the hidden-window scenario passes against a page wired
// with the real visibility gate and FAILS against a page that re-renders per sample, and that the wording the scenarios look for is the app's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeQuietLightScenarios, PAGE, SAMPLE, TEST_LABEL } from './cdp-quiet-light.mjs';
import { createVisibilityGate } from '../src/live/visibility-gate.mjs';
import { migrateSound } from '../src/logic/sound-pref.mjs';

const NAMES = ['quiet-hidden-no-rerender', 'quiet-sound-default-off', 'reach-notify-test'];
const noSleep = async () => {};

test('the factory returns exactly the three scenarios, each an async function of one argument', () => {
  const S = makeQuietLightScenarios({ fresh: async () => null, sleep: noSleep });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('importing the file does nothing and the factory works without a sleep helper', () => {
  assert.doesNotThrow(() => makeQuietLightScenarios({ fresh: async () => null }));
});

test('every in-page snippet is valid JavaScript', () => {
  for (const [k, s] of Object.entries(PAGE)) {
    if (typeof s === 'function') assert.doesNotThrow(() => new vm.Script(s(3)), k);
    else assert.doesNotThrow(() => new vm.Script(s), k);
  }
});

test('the samples are invented placeholders and the wording is the Reach button’s own', () => {
  assert.deepEqual(SAMPLE(2), { cpu: 12, ram: 42, n: 2 });
  assert.equal(TEST_LABEL, 'Send a test notification');
});

test('each scenario stops at a failed fresh() and touches nothing', async () => {
  const S = makeQuietLightScenarios({ fresh: async () => ['the app never mounted'], sleep: noSleep });
  for (const name of NAMES) {
    let touched = 0;
    const t = { evaluate: async () => { touched++; return null; }, waitFor: async () => { touched++; return false; }, reload: async () => { touched++; }, errors: () => [], sleep: noSleep };
    assert.deepEqual(await S[name](t), ['the app never mounted'], name);
    assert.equal(touched, 0, name + ' touched the page after a failed fresh()');
  }
});

// A tiny simulated page for the hidden-window scenario: a document whose visibilityState lives on its prototype (like the real one, so the
// scenario's override-then-delete restores it), a store whose machine handler either goes through the real gate or emits per sample.
function simPage({ gated }) {
  const docListeners = new Set();
  const proto = { visibilityState: 'visible' };
  const document = Object.create(proto);
  document.addEventListener = (t, f) => { if (t === 'visibilitychange') docListeners.add(f); };
  document.removeEventListener = (t, f) => { if (t === 'visibilitychange') docListeners.delete(f); };
  document.dispatchEvent = (e) => { docListeners.forEach((f) => f(e)); return true; };
  const live = { machine: null }, listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const gate = createVisibilityGate({ emit, doc: document });
  const onMachine = (m) => { live.machine = m || null; if (gated) gate.tick(); else emit(); };
  const ctx = vm.createContext({
    document, Event: class { constructor(type) { this.type = type; } },
    WHQ: { store: { live, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } },
    hqFake: { emit: (ch, m) => { if (ch === 'hq:machine') onMachine(m); } },
  });
  ctx.window = ctx;
  const t = {
    evaluate: async (code) => vm.runInContext(code, ctx),
    waitFor: async (code) => !!vm.runInContext(code, ctx),
    reload: async () => {}, errors: () => [], clearErrors() {}, sleep: noSleep,
  };
  return { t, document, gate };
}

test('quiet-hidden-no-rerender passes on a page wired with the visibility gate, and leaves the document visible', async () => {
  const { t, document } = simPage({ gated: true });
  const S = makeQuietLightScenarios({ fresh: async () => null, sleep: noSleep });
  assert.deepEqual(await S['quiet-hidden-no-rerender'](t), []);
  assert.equal(document.visibilityState, 'visible', 'the override was put back');
});

test('quiet-hidden-no-rerender FAILS on a page that re-renders on every machine sample', async () => {
  const { t } = simPage({ gated: false });
  const S = makeQuietLightScenarios({ fresh: async () => null, sleep: noSleep });
  const out = await S['quiet-hidden-no-rerender'](t);
  assert.ok(out.some((x) => /5 machine samples while hidden caused 5 store emits/.test(x)), out.join(' | '));
});

test('reach-notify-test reports a missing button and resets the page', async () => {
  const seen = [];
  const t = { evaluate: async (c) => { seen.push(c); return null; }, waitFor: async () => false, reload: async () => {}, errors: () => [], sleep: noSleep };
  const S = makeQuietLightScenarios({ fresh: async () => null, sleep: noSleep });
  const out = await S['reach-notify-test'](t);
  assert.equal(out.length, 1);
  assert.match(out[0], /Send a test notification/);
  assert.ok(seen.includes(PAGE.reset), 'the page is reset after a failed run');
});

test('the saved-pref snippets and the migration agree on the key and the marker', () => {
  assert.match(PAGE.setPrefs({ sound: true }), /whq3-prefs/);
  const m = migrateSound({ sound: true });
  assert.equal(m.prefs.sound, false);
  assert.equal(m.prefs.soundV, 2, 'the scenario checks for soundV 2');
});
