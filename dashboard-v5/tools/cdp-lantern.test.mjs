// node --test dashboard-v5/tools/cdp-lantern.test.mjs
// The Lantern cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that each scenario stops at a failed fresh() and touches nothing, that a look which never shows is reported and put back, and that the
// expected colours come from the sheet itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeLanternScenarios, PAGE, SCENARIO_NAMES, LAYER_LANTERN, lanternTokens } from './cdp-lantern.mjs';
import { normaliseConsoleLayer } from '../src/logic/console-layer.mjs';

test('the factory returns exactly the five scenarios, each an async function of one argument', () => {
  const S = makeLanternScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), [...SCENARIO_NAMES].sort());
  assert.deepEqual([...SCENARIO_NAMES], ['lantern-skin', 'lantern-art', 'lantern-sealed', 'lantern-reduced-motion', 'lantern-leave']);
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const ARGS = { go: ['claude', 'crew'], setState: [{ a: 1 }], heldCount: ['crw'], tokenNow: ['--bg'], openProject: ['proj-a'], serveBrief: [{ items: [] }] };
  for (const [k, v] of Object.entries(PAGE)) {
    const src = typeof v === 'function' ? v(...(ARGS[k] || ['skills'])) : v;
    assert.doesNotThrow(() => new vm.Script(src), k + ': ' + String(src).slice(0, 80));
  }
});

test('the layer the scenarios set is a normalised one with the look on, and the sheet gives the expected colours', () => {
  assert.deepEqual({ ...LAYER_LANTERN }, normaliseConsoleLayer({ ...LAYER_LANTERN }));
  assert.equal(LAYER_LANTERN.look, 'lantern');
  const t = lanternTokens();
  for (const k of ['dark', 'light']) assert.ok(Object.keys(t[k]).length >= 30, k);
  assert.notEqual(t.dark['--bg'], t.light['--bg']);
  assert.equal(t.dark['--lnt-glyph'], '#0a090b', 'the card ink the art scenario reads as rgb(10, 9, 11)');
  assert.equal(t.dark['--lnt-brass-dim'], '#a07c3c', 'the sealed word the sealed scenario reads as rgb(160, 124, 60)');
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, send: async () => {}, errors: () => [], clearErrors() {} };
  const S = makeLanternScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of SCENARIO_NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a look that never shows is reported, and the page, the layer and the emulated media are put back', async () => {
  const evals = [], sends = [];
  const t = { evaluate: async (s) => { evals.push(s); return /JSON\.stringify/.test(s) && /themePref/.test(s) ? JSON.stringify({ themePref: 'dark', reduceMotion: false }) : null; }, waitFor: async () => false, send: async (...a) => { sends.push(a); }, errors: () => [], clearErrors() {}, sleep: async () => {} };
  const S = makeLanternScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of SCENARIO_NAMES) {
    evals.length = 0; sends.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name + ' reports the failure');
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(sends.some((a) => a[0] === 'Emulation.setEmulatedMedia'), name + ' clears the emulated media');
  }
});

test('the scenarios are merged by cdp-gate.mjs', () => {
  const src = readFileSync(new URL('./cdp-gate.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ makeLanternScenarios \} from '\.\/cdp-lantern\.mjs'/);
  assert.match(src, /Object\.assign\(SCENARIOS, makeLanternScenarios\(\{ fresh, sleep \}\)\)/);
  for (const n of SCENARIO_NAMES) assert.ok(src.includes(n), n + ' is listed in the gate header');
});
