// node --test dashboard-v5/tools/cdp-brief-act.test.mjs
// The Brief act-in-place cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, that the placeholder rows carry keys their own rule owns, and that each scenario stops at a failed fresh().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeBriefActScenarios, PAGE, ITEMS, briefOf, QUEST, STALE, DIRTY, WAIT } from './cdp-brief-act.mjs';

const NAMES = ['brief-act-done', 'brief-act-commit', 'brief-act-balance', 'brief-act-forged', 'brief-waiting-render'];

test('the factory returns exactly the five scenarios, each an async function of one argument', () => {
  const S = makeBriefActScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.sec, PAGE.rows, PAGE.texts, PAGE.btn(0, 'Mark done'), PAGE.click(1, 'Commit…'), PAGE.calls, PAGE.toasts, PAGE.reset, PAGE.serve(briefOf(Object.values(ITEMS)))];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('each placeholder row carries the key and rule the real engine would give it, and no real name', () => {
  assert.equal(ITEMS.quest.rule, 'quest-red'); assert.equal(ITEMS.quest.key, QUEST);
  assert.equal(ITEMS.stale.rule, 'money-stale'); assert.equal(ITEMS.stale.key, STALE);
  assert.equal(ITEMS.dirty.rule, 'dirty'); assert.equal(ITEMS.dirty.key, DIRTY);
  assert.equal(ITEMS.wait.rule, 'session-waiting'); assert.equal(ITEMS.wait.key, WAIT);
  assert.equal(ITEMS.dirty.action.projectId, 'p1');
  assert.ok(/Acme|Project A|Cash/.test(JSON.stringify(ITEMS)) && !/[A-Za-z]:[\/]/.test(JSON.stringify(ITEMS)));
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefActScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a Brief that never renders is reported, and the page and the fake are put back', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefActScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});
