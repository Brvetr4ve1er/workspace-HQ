// node --test dashboard-v5/tools/cdp-workbench.test.mjs
// The Workbench cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that each scenario stops at a failed fresh() and touches nothing, that a look which never shows is reported and put back, and that the
// expected colours come from the sheets themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeWorkbenchScenarios, PAGE, SCENARIO_NAMES, LAYER_LOOK, workbenchTokens } from './cdp-workbench.mjs';
import { normaliseConsoleLayer } from '../src/logic/console-layer.mjs';

test('the factory returns exactly the four scenarios, each an async function of one argument', () => {
  const S = makeWorkbenchScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), [...SCENARIO_NAMES].sort());
  assert.deepEqual([...SCENARIO_NAMES], ['workbench-skin', 'workbench-art', 'workbench-reduced-motion', 'workbench-leave']);
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  for (const [k, v] of Object.entries(PAGE)) {
    const src = typeof v === 'function' ? (k === 'go' ? v('claude', 'crew') : k === 'setState' ? v({ a: 1 }) : k === 'heldCount' ? v('crw') : k === 'tokenNow' ? v('--bg') : v('skills')) : v;
    assert.doesNotThrow(() => new vm.Script(src), k + ': ' + String(src).slice(0, 80));
  }
});

test('the layer the scenarios set is a normalised one with the look on, and the sheets give the expected colours', () => {
  assert.deepEqual({ ...LAYER_LOOK }, normaliseConsoleLayer({ ...LAYER_LOOK }));
  assert.equal(LAYER_LOOK.look, 'workbench');
  const t = workbenchTokens();
  for (const k of ['dark', 'light', 'signalDark', 'signalLight']) assert.ok(Object.keys(t[k]).length >= 5, k);
  assert.notEqual(t.dark['--bg'], t.light['--bg']);
  assert.notEqual(t.dark['--gold'], t.signalDark['--gold']);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, send: async () => {}, errors: () => [], clearErrors() {} };
  const S = makeWorkbenchScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of SCENARIO_NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a look that never shows is reported, and the page, the layer and the emulated media are put back', async () => {
  const evals = [], sends = [];
  const t = { evaluate: async (s) => { evals.push(s); return /JSON\.stringify/.test(s) && /themePref/.test(s) ? JSON.stringify({ themePref: 'dark', reduceMotion: false }) : null; }, waitFor: async () => false, send: async (...a) => { sends.push(a); }, errors: () => [], clearErrors() {}, sleep: async () => {} };
  const S = makeWorkbenchScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of SCENARIO_NAMES) {
    evals.length = 0; sends.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name + ' reports the failure');
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(sends.some((a) => a[0] === 'Emulation.setEmulatedMedia'), name + ' clears the emulated media');
  }
});

test('the scenarios are merged by cdp-gate.mjs', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./cdp-gate.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ makeWorkbenchScenarios \} from '\.\/cdp-workbench\.mjs'/);
  assert.match(src, /Object\.assign\(SCENARIOS, makeWorkbenchScenarios\(\{ fresh, sleep \}\)\)/);
});
