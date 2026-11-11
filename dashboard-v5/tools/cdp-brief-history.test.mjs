// node --test dashboard-v5/tools/cdp-brief-history.test.mjs
// The Brief-history cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, that the words the scenarios expect are the logic module's own, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeBriefHistoryScenarios, PAGE, ANSWER, CLEAR_ANSWER, ENTRY_WORDS, briefOf } from './cdp-brief-history.mjs';
import { normalizeAnswer, entryLine, clearLine, HOW_WORD, HOW_NOTE } from '../src/logic/brief-history.js';

const NAMES = ['brief-history-render', 'brief-history-all-clear'];

test('the factory returns exactly the two scenarios, each an async function of one argument', () => {
  const S = makeBriefHistoryScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.opSec, PAGE.opRows, PAGE.opTexts, PAGE.opText, PAGE.cardSec, PAGE.cardText, PAGE.ackBtn, PAGE.panelText, PAGE.reads, PAGE.acks, PAGE.reset,
    PAGE.serve(ANSWER, briefOf([])), PAGE.rebrief(briefOf([])), PAGE.go('home'), PAGE.go('history', 'timeline')];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 70));
});

test('the words the scenarios expect are the logic module’s own, and the placeholder answers are valid', () => {
  for (const [how, word] of Object.entries(ENTRY_WORDS)) {
    const own = how === 'changed' ? HOW_NOTE.changed : how === 'silent' ? HOW_WORD.silent : HOW_WORD[how];
    assert.ok(own.includes(word), how + ': "' + word + '" vs "' + own + '"');
  }
  const n = normalizeAnswer(ANSWER);
  assert.equal(n.entries.length, ANSWER.entries.length, 'every placeholder entry survives normalizeAnswer');
  assert.equal(n.error, undefined);
  n.entries.forEach((e, i) => assert.ok(entryLine(e).includes(ENTRY_WORDS[['open', 'resolved', 'acted', 'dismissed', 'changed', 'silent'][i]]), entryLine(e)));
  for (const i of [4, 5]) assert.doesNotMatch(entryLine(n.entries[i]), /resolved|fixed/i);
  const c = normalizeAnswer(CLEAR_ANSWER);
  assert.equal(c.allClear.resolved.length, 2);
  assert.ok(clearLine(c.allClear.resolved[0]).includes('resolved'));
  assert.ok(clearLine(c.allClear.resolved[1]).includes('acted on'));
});

test('the placeholder answers carry no real names (the repo is public)', () => {
  const text = JSON.stringify([ANSWER, CLEAR_ANSWER]);
  assert.doesNotMatch(text, /acme|workspace|C:\\|veemo|\.env/i);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefHistoryScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a section or card that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefHistoryScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
  }
});

test('the render scenario reports a silent close worded as resolved', async () => {
  const bad = ANSWER.entries.map((e) => (e.how === 'silent' ? 'An account needs confirming: noticed, resolved Thu' : e.text + ': ' + (ENTRY_WORDS[e.how] || '')));
  const t = {
    evaluate: async (s) => (s === PAGE.opTexts ? bad : s === PAGE.opText ? 'operator · what the Brief noticed 2 cleared this week · 1 dismissed' : s === PAGE.reads ? 1 : s === PAGE.acks ? 0 : null),
    waitFor: async () => true, errors: () => [], clearErrors() {},
  };
  const S = makeBriefHistoryScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['brief-history-render'](t);
  assert.ok(out.some((m) => /worded as resolved or fixed/.test(m)), JSON.stringify(out));
});
