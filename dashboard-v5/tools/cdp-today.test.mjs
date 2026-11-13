// node --test dashboard-v5/tools/cdp-today.test.mjs
// The Today-ribbon cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, that the wording it expects is the ribbon's own, and that each scenario stops at a failed fresh() and touches
// nothing, and that a ribbon that never shows is reported and the page is reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeTodayScenarios, PAGE, WANT_TEXT, NO_TEXT } from './cdp-today.mjs';

const NAMES = ['today-render', 'today-step-back', 'today-partial'];

test('the factory returns exactly the three scenarios, each an async function of one argument', () => {
  const S = makeTodayScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript, and the text it expects is the ribbon’s own', async () => {
  for (const [k, s] of Object.entries(PAGE)) assert.doesNotThrow(() => new vm.Script(s), k);
  const V = await import('../src/vals/today.js');
  const L = await import('../src/logic/today.js');
  assert.equal(typeof V.todayVals, 'function');
  assert.equal(L.TDY_TITLE, 'Where today went');
  assert.ok(WANT_TEXT.includes(L.TDY_TITLE));
  const tpl = (await import('../src/tpl/today.tpl.js')).default;
  assert.ok(tpl.includes('aria-label="Where today went"'), 'the section the scenarios look for');
  assert.ok(tpl.includes('aria-label="Where today went, in words"'), 'the text twin the scenarios count');
  assert.match(tpl, /role="img"/);
  assert.match(tpl, /aria-live="polite"/);
  assert.ok(NO_TEXT.test('NaN') && NO_TEXT.test('undefined') && NO_TEXT.test('hours worked') && !NO_TEXT.test('five-minute blocks'));
});

test('the legend words the scenarios look for are in the vals', async () => {
  const { todayVals } = await import('../src/vals/today.js');
  const { todayLogic } = await import('../src/logic/today.js');
  const self = Object.assign(Object.create(todayLogic), { state: { tab: 'home', route: null }, LIVE: { today: { loaded: false, days: {}, errors: {}, revision: 0 } }, hq: { today: { read() {} } }, useMark() {}, store: { refreshToday: () => Promise.resolve() }, setState() {} });
  const v = todayVals.call(self, { S: self.state, LIVE: self.LIVE, live: true });
  self.tdyRearm();
  const words = v.tdyv.tdyLegend.map((g) => g.label).join(' | ');
  for (const w of ['Claude (5-minute blocks)', 'browser focus', 'PC asleep']) assert.ok(words.includes(w), w);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeTodayScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a ribbon that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeTodayScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes('tdyOffset: 0')), name + ' puts day 0 back');
  }
});
