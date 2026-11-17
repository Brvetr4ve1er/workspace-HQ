// node --test dashboard-v5/tools/cdp-dev-command.test.mjs
// The dev command cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeDevCommandScenarios, PAGE } from './cdp-dev-command.mjs';

const NAMES = ['dev-start-unconfirmed', 'dev-start-confirmed'];

test('the factory returns exactly the two scenarios, each an async function of one argument', () => {
  const S = makeDevCommandScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.btn('Start dev'), PAGE.text, PAGE.calls('devStart'), PAGE.callArgs('devAllow'), PAGE.project, PAGE.open('proj-a'), PAGE.toasts, PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeDevCommandScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a page with no project that has a dev command is reported, and the page and the fake are reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeDevCommandScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});
