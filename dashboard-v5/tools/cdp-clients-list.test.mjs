// node --test dashboard-v5/tools/cdp-clients-list.test.mjs
// The Clients-list cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeClientsListScenarios, PAGE, ORDER } from './cdp-clients-list.mjs';

const NAMES = ['clients-list-open', 'clients-list-open-card', 'clients-list-empty'];

test('the factory returns exactly the three scenarios, each an async function of one argument', () => {
  const S = makeClientsListScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  for (const s of [PAGE.list, PAGE.text, PAGE.rows, PAGE.rowNames, PAGE.button('Open card'), PAGE.calls('delivery.clients'), PAGE.go, PAGE.reset]) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
  assert.equal(ORDER.length, 4);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeClientsListScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a list that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const answer = (s) => (/M\.P0\[0\]/.test(s) ? 'p-1' : /\.length$/.test(s) || /calls/.test(s) ? 0 : '');
  const t = { evaluate: async (s) => { evals.push(s); return answer(s); }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeClientsListScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});
