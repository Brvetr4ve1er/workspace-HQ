// node --test dashboard-v5/tools/cdp-drift.test.mjs
// The Machine-drift cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, that the titles it expects are the engine's own, and that each scenario stops at a failed fresh() and
// touches nothing, and cleans up after itself when the panel never shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeMachineDriftScenarios, PAGE, SEVEN, TITLES } from './cdp-drift.mjs';

const NAMES = ['machine-drift-render', 'machine-drift-estimate-refuses'];

test('the factory returns exactly the two scenarios, each an async function of one argument', () => {
  const S = makeMachineDriftScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.section, PAGE.text, PAGE.charts, PAGE.ids, PAGE.titles, PAGE.pathOf('cpu'), PAGE.twinOf('disk'), PAGE.cardText('ping'), PAGE.summary, PAGE.disk,
    PAGE.estButton, PAGE.estimate, PAGE.estimateText, PAGE.calls('machineHistory.read'), PAGE.marks, PAGE.go, PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the chart ids and titles it expects are the engine’s own, in the engine’s order', async () => {
  const { CHARTS } = await import('../src/live/machine-history.mjs');
  assert.deepEqual([...SEVEN], CHARTS.map((c) => c.id));
  assert.deepEqual([...TITLES], CHARTS.map((c) => c.title));
});

test('the selectors match the template’s own data attributes', async () => {
  const { default: tpl } = await import('../src/tpl/drift.tpl.js');
  for (const a of ['data-md="drift"', 'data-dft="chart"', 'data-dft-id="{{ c.id }}"', 'data-dft="twin"', 'data-dft="summary"', 'data-dft="disk"', 'data-dft="estimate-button"', 'data-dft="estimate"']) assert.ok(tpl.includes(a), a);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeMachineDriftScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a panel that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeMachineDriftScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes("L.go('home')")), name + ' leaves the app on Home');
  }
});

test('a scenario that runs against a healthy page reports nothing, and one that gets a bad page reports why', async () => {
  let readCalls = 0;
  const answers = (s) => {
    if (s === PAGE.ids) return [...SEVEN];
    if (s === PAGE.titles) return [...TITLES];
    if (s === PAGE.summary) return '40 checks · Nov 1 – Nov 11 · only the last 96 checks are kept';
    if (s.startsWith('(() => { const p = document.querySelector')) return 'M4 10 L20 12 M30 5 L40 6';
    if (s.includes('[data-dft="chart"][data-dft-id="ping"]') && s.includes('textContent')) return 'Ping (ms) 40 checks over 10 days left out as a gap';
    if (s.includes('data-dft-id=') && s.includes('textContent')) return '40 checks over 10 days Temp files (GB)';
    if (s === PAGE.disk) return 'What filled the disk the readings so far are partial';
    if (s === PAGE.text) return 'How the PC changed';
    if (s.startsWith('!!')) return false;
    if (s === PAGE.calls('machineHistory.read')) return readCalls++ === 0 ? 0 : 1;   // none before the panel opens, one after
    if (s === PAGE.marks) return ['machine-drift/open'];
    return null;
  };
  const t = { evaluate: async (s) => answers(s), waitFor: async () => true, errors: () => [], clearErrors() {} };
  const S = makeMachineDriftScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(await S['machine-drift-render'](t), [], 'a healthy page');
  readCalls = 0;
  const bad = { ...t, evaluate: async (s) => (s === PAGE.ids ? ['disk', 'cpu'] : s === PAGE.calls('machineHistory.read') ? (readCalls++ === 0 ? 0 : 3) : answers(s)) };
  const out = await S['machine-drift-render'](bad);
  assert.ok(out.some((m) => /chart order/.test(m)), JSON.stringify(out));
  assert.ok(out.some((m) => /read the history 3 times/.test(m)), JSON.stringify(out));
});
