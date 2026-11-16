// node --test dashboard-v5/tools/cdp-crew.test.mjs
// The Crew cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeCrewScenarios, PAGE } from './cdp-crew.mjs';

const NAMES = ['crew-render', 'crew-start', 'crew-search'];

test('the factory returns exactly the three scenarios, each an async function of one argument', () => {
  const S = makeCrewScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.view, PAGE.text, PAGE.groups, PAGE.groupSizes, PAGE.flatRows, PAGE.names, PAGE.startOf('alpha-lint'), PAGE.button('search'), PAGE.moreButtons,
    PAGE.calls('crew.read'), PAGE.callArgs('crew.start'), PAGE.marks('crew-start', 'act'), PAGE.count(300), PAGE.type('x'), PAGE.go, PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeCrewScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a view that never shows is reported, and the page and the fake are reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return /\.length$|calls/.test(s) ? 0 : ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeCrewScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes("sessionStorage.removeItem('hqFake:crewCount')")), name + ' puts the crew count back');
  }
});
