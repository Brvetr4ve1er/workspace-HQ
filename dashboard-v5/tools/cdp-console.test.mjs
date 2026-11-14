// node --test dashboard-v5/tools/cdp-console.test.mjs
// The Console-layer cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, that the words it looks for are the app's own, that the expected token values come from the sheet itself, that each scenario
// stops at a failed fresh() and touches nothing, and that a skin which never shows is reported and the page is put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeConsoleScenarios, PAGE, SCENARIO_NAMES, sheetTokens, ACCENTS, LAYER_OFF } from './cdp-console.mjs';

test('the factory returns exactly the seven scenarios, each an async function of one argument', () => {
  const S = makeConsoleScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), SCENARIO_NAMES.slice().sort());
  assert.equal(SCENARIO_NAMES.length, 7);
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const sample = { themePref: 'dark', reduceMotion: false };
  for (const [k, v] of Object.entries(PAGE)) {
    const src = typeof v === 'function' ? (k === 'restore' ? v(sample) : k === 'setLayer' ? v(LAYER_OFF) : k === 'cssVar' ? v('--bg') : k === 'setTheme' ? v('dark') : k === 'setReduce' ? v(true) : v('Console layer')) : v;
    assert.doesNotThrow(() => new vm.Script(src), k);
  }
});

test('the expected colours come from the sheet: the charcoal background and the four accents are all there', () => {
  const t = sheetTokens();
  assert.equal(t['--bg'].toLowerCase(), '#1f2023');
  for (const k of ACCENTS) assert.match(t[k], /^#[0-9a-f]{6}$/i, k);
  assert.equal(ACCENTS.length, 4);
});

test('the words the scenarios look for are the app’s own', async () => {
  const L = await import('../src/logic/console-skin.js');
  assert.equal(L.CSL_TITLE, 'Console layer');
  assert.equal(L.CSL_CHIP, 'Console');
  assert.equal(L.CSL_SCAN_TITLE, 'CRT scanlines');
  assert.equal(L.CSL_LINE, 'Opt-in look and a few extras. Off = nothing loads.');
  const layer = await import('../src/logic/console-layer.mjs');
  assert.equal(layer.CONSOLE_LINK_ID, 'hq-console-css');
  assert.equal(layer.CONSOLE_SCAN_ATTR, 'data-hq-scan');
  assert.deepEqual({ ...layer.CONSOLE_DEFAULTS }, { ...LAYER_OFF });
  assert.ok(PAGE.paletteToggle.includes('Toggle light / dark'));
  assert.ok(PAGE.clickThemeButton.includes('Light / dark'));
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../src/tpl/shell.tpl.js', import.meta.url), 'utf8');
  assert.ok(shell.includes('title="Light / dark"'), 'the shell toggle the scenarios click');
  const palette = readFileSync(new URL('../src/logic/palette.js', import.meta.url), 'utf8');
  assert.ok(palette.includes("label: 'Toggle light / dark'"));
});

test('the scenarios never schedule anything themselves', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('./cdp-console.mjs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  for (const w of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'addEventListener']) assert.ok(!text.includes(w), w);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {}, send: async () => ({}), sleep: async () => {}, reload: async () => {} };
  const S = makeConsoleScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of SCENARIO_NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a skin that never shows is reported, and the page is put back (layer off, media cleared, theme restored)', async () => {
  const S = makeConsoleScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of SCENARIO_NAMES) {
    const evals = [], sends = [];
    const t = {
      evaluate: async (s) => { evals.push(s); return s.includes('JSON.stringify({ themePref') ? JSON.stringify({ themePref: 'light', reduceMotion: true }) : null; },
      waitFor: async () => false, errors: () => [], clearErrors() {}, sleep: async () => {}, reload: async () => {},
      send: async (m, p) => { sends.push([m, p]); return {}; },
    };
    const out = await S[name](t);
    assert.ok(out.length > 0, name + ' reported nothing for a page that never showed it');
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes('themePref: "light"') && s.includes('reduceMotion: true')), name + ' puts the owner\'s theme and reduce-motion back');
    assert.ok(evals.some((s) => s.includes('"on":false') && s.includes('consoleLayer')), name + ' puts the layer back off');
    assert.ok(sends.some(([m, p]) => m === 'Emulation.setEmulatedMedia' && Array.isArray(p.features) && p.features.length === 0), name + ' clears the emulated media');
  }
});

test('the zero-cost scenario fails loudly on a page that kept the layer: a link, a probe count, a non-empty skin', async () => {
  const S = makeConsoleScenarios({ fresh: async () => null, sleep: async () => {} });
  const answers = (s) => {
    if (s.includes('__hqLayerProbe')) return JSON.stringify({ links: 1, listeners: 2, timers: 0, frames: 0 });
    if (s.includes("querySelectorAll('link#hq-console-css').length")) return 1;
    if (s.includes("querySelectorAll('[data-hq-console]').length")) return 1;
    if (s.includes("getAttribute('data-hq-skin')")) return 'console';
    if (s.includes("getAttribute('data-hq-scan')")) return 'on';
    if (s.includes('JSON.stringify({ themePref')) return JSON.stringify({ themePref: 'dark', reduceMotion: false });
    if (s.includes("button[role=\"switch\"]") && s.includes('.textContent.trim() : null')) return 'On';
    if (s.includes('["Dark"') || s.includes("'Dark'")) return JSON.stringify(['Dark', 'Light', 'Follow system', 'Console']);
    if (s.includes('!!b; })()')) return true;
    return null;
  };
  const t = { evaluate: async (s) => answers(s), waitFor: async () => true, errors: () => [], clearErrors() {}, sleep: async () => {}, reload: async () => {}, send: async () => ({}) };
  const out = await S['console-off-zero-cost'](t);
  const joined = out.join(' | ');
  assert.match(joined, /probe is not all zeros/);
  assert.match(joined, /link is in the page/);
  assert.match(joined, /data-hq-console/);
  assert.match(joined, /data-hq-skin/);
  assert.match(joined, /data-hq-scan/);
  assert.match(joined, /Console chip|Console while/);
});
