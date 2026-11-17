// node --test dashboard-v5/tools/cdp-launcher.test.mjs
// The Launcher cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that each scenario stops at a failed fresh() and touches nothing, and that a screen that never shows is reported and the page and the fake are reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeLauncherScenarios, PAGE } from './cdp-launcher.mjs';

const NAMES = ['launcher-render', 'launcher-add', 'launcher-remove', 'launcher-allow-command', 'launcher-open-workspace', 'launcher-refuse', 'launcher-palette', 'launcher-setup-row'];

test('the factory returns exactly the eight scenarios, each an async function of one argument', () => {
  const S = makeLauncherScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.sel('section'), PAGE.all('entry'), PAGE.text, PAGE.section, PAGE.calls('launcher.read'), PAGE.callArgs('launcher.add'), PAGE.marks('launcher-workspace', 'act'), PAGE.allMarks,
    PAGE.mode('refuse'), PAGE.openSettings, PAGE.closeSettings, PAGE.project, PAGE.openPage('a'), PAGE.button('Allow and run'), PAGE.rowButton('entry', 'x', 'remove'), PAGE.palette('workspace'),
    PAGE.paletteLabels, PAGE.enter, PAGE.state('WHQ.app.logic.state.lnch'), PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeLauncherScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a screen that never shows is reported, and the page and the fake are reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return /\.length$|calls|allMarks/.test(s) ? 0 : ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeLauncherScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes("sessionStorage.removeItem('hqFake:launcher')")), name + ' puts the fake state back');
  }
});

test('no snippet or scenario can launch anything: the page never calls a real program, a dialog or a window', () => {
  const src = JSON.stringify(Object.values(PAGE).map((v) => (typeof v === 'function' ? v('x', 'y', 'z') : v)));
  assert.ok(!/child_process|spawn|openExternal|showOpenDialog|window\.open|shell\./.test(src));
});
