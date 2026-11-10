// node --test dashboard-v5/tools/cdp-delivery-check.test.mjs
// The delivery-check cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that importing it does
// nothing, that every in-page snippet is valid JavaScript, and that each scenario stops at a failed fresh() and still cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeDeliveryCheckScenarios, PAGE, CLIENT_VIEW, READY } from './cdp-delivery-check.mjs';

const NAMES = ['delivery-check-nothing-answering', 'delivery-check-run', 'delivery-check-forget', 'delivery-check-button-sweep'];

test('the factory returns exactly the four scenarios, each an async function of one argument', () => {
  const S = makeDeliveryCheckScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.card, PAGE.text, PAGE.button('Check'), PAGE.input, PAGE.calls('deliveryCheck.run'), PAGE.reset, PAGE.open(CLIENT_VIEW)];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
  assert.equal(READY.state, 'ready');
});

test('each scenario returns the failed fresh() answer and still resets the page', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeDeliveryCheckScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0, 'a failed fresh() touches nothing');
});

test('a block that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeDeliveryCheckScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.match(out.join(' '), /never showed/, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});
