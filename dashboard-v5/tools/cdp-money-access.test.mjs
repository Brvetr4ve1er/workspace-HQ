// node --test dashboard-v5/tools/cdp-money-access.test.mjs
// The Money-access cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeMoneyAccessScenarios, PAGE, WANT_TEXT } from './cdp-money-access.mjs';

const NAMES = ['money-access-off-by-default', 'money-access-toggle'];

test('the factory returns exactly the two scenarios, each an async function of one argument', () => {
  const S = makeMoneyAccessScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript, and the card text it expects is the logic module’s own', async () => {
  for (const s of [PAGE.switchEl, PAGE.section, PAGE.text, PAGE.checked, PAGE.calls('moneyAccess.read'), PAGE.open, PAGE.reset]) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 60));
  const L = await import('../src/logic/money-access.js');
  const all = [L.MAC_TITLE, L.MAC_EXPLAIN, L.MAC_NEVER, L.MAC_WARN].join(' ');
  for (const w of WANT_TEXT.slice(0, 4)) assert.ok(all.includes(w), w);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeMoneyAccessScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a switch that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeMoneyAccessScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});
