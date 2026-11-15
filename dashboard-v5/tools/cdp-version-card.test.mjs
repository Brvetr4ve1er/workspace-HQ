// node --test dashboard-v5/tools/cdp-version-card.test.mjs
// The version-card cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet
// is valid JavaScript, that the selectors are the template's own, that each scenario stops at a failed fresh() and touches nothing, and that
// the scenarios agree with a small simulated page that runs the REAL rule (decide) on a virtual clock: a healthy page reports nothing, and each
// of five broken pages is caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeVersionCardScenarios, PAGE, initScript, LAYER_ON, LAYER_OFF, OLDER_STAMP, CARD_MS } from './cdp-version-card.mjs';
import { decide, VC_MS } from '../src/logic/version-card.mjs';
import { BUILD_STAMP } from '../src/live/build-stamp.mjs';
import { VCD_LAYER_ON, VCD_LAYER_OFF } from '../src/selftest-version-card.mjs';
import tpl from '../src/tpl/version-card.tpl.js';

const NAMES = ['version-card-hidden-launch', 'version-card-layer-off-hidden', 'version-card-new-stamp', 'version-card-plays-once', 'version-card-reduced-motion', 'version-card-skip'];

// ---- a simulated page: the real rule, a virtual clock ----------------------------------------------------------------------------------------
function simPage(bug = '') {
  const w = { now: 0, prefs: {}, hidden: false, media: false, shown: false, onAt: 0, waiting: false, listeners: 0, timers: 0, log: [], nextScript: 1, scripts: new Map(), calls: [], layerStateOn: false, reloads: 0 };
  const off = (at) => { if (!w.shown) return; w.shown = false; w.log.push(['off', at, 0]); w.listeners -= bug === 'leak' ? 1 : 2; w.timers -= 1; };
  const on = () => { w.shown = true; w.onAt = w.now; w.log.push(['on', w.now, 0]); w.timers += 1; };
  const tick = () => { if (w.shown && w.now - w.onAt >= VC_MS) off(w.onAt + VC_MS); };
  const advance = (ms) => { w.now += ms; tick(); };
  const inputs = () => ({ stamp: BUILD_STAMP, seen: w.prefs.versionCardSeen, visible: !w.hidden, layerOn: !!(w.prefs.consoleLayer && w.prefs.consoleLayer.on), reduced: !!w.prefs.reduceMotion || w.media, overlayOpen: false });
  const run = () => {
    let a = decide(inputs());
    if (bug === 'never' && a === 'play') a = 'record';
    if (bug === 'plays-when-off' && a === 'record') a = 'play';
    if (bug === 'replay' && a === 'skip-seen') a = 'play';
    if (a === 'record' || a === 'suppress' || a === 'play') w.prefs.versionCardSeen = BUILD_STAMP;
    if (a === 'play') { w.listeners += 2; on(); }
    if (a === 'wait') { w.waiting = true; w.listeners += 1; }
    return a;
  };
  const load = () => {
    w.reloads++; w.shown = false; w.waiting = false; w.listeners = 0; w.timers = 0; w.log = [];
    for (const src of w.scripts.values()) w.hidden = /__vcdHidden = true/.test(src);
    if (!w.scripts.size) w.hidden = false;
    run();
  };
  const dismissNow = () => { off(w.now); };
  const evalOf = (s) => {
    const merge = /^\(\(\) => \{ let p = \{\}; try \{ p = JSON\.parse\(localStorage\.getItem\("whq3-prefs"\)/.test(s);
    if (merge) { const patch = JSON.parse(/const patch = (\{.*?\}); for/.exec(s)[1]); for (const k of Object.keys(patch)) { if (patch[k] === null) delete w.prefs[k]; else w.prefs[k] = patch[k]; } return true; }
    if (s === PAGE.ready) return true;
    if (s === PAGE.has) return w.shown;
    if (s.startsWith('!') && s.slice(1) === PAGE.has) return !w.shown;
    if (s === PAGE.nodes || s === PAGE.cardNodes) return w.shown ? 1 : 0;
    if (s === PAGE.text) return w.shown ? 'New version inserted ' + BUILD_STAMP : '';
    if (s === PAGE.role) return w.shown ? 'status/polite' : '';
    if (s === PAGE.focusInside) return false;
    if (s === PAGE.probe) return bug === 'noprobe' ? null : JSON.stringify({ links: 0, listeners: w.listeners, timers: w.timers, frames: 0 });
    if (s === PAGE.log) return JSON.stringify(w.log);
    if (s === PAGE.audio) return 0;
    if (s === PAGE.prefs) return JSON.parse(JSON.stringify(w.prefs));
    if (s === PAGE.prefsRaw) return w.prefsRawBefore === undefined ? JSON.stringify(w.prefs) : w.prefsRawBefore;
    if (s === PAGE.becomeVisible) { w.hidden = false; if (w.waiting) { const a = decide(inputs()); if (a === 'play') { w.waiting = false; w.prefs.versionCardSeen = BUILD_STAMP; w.listeners += 1; on(); } } return true; }
    if (s === PAGE.switchLayerOn) { w.layerStateOn = true; w.prefs.consoleLayer = { ...LAYER_ON }; return true; }
    if (s === PAGE.press) { dismissNow(); return true; }
    if (s === PAGE.reset) return true;
    if (s.includes('localStorage.removeItem') || s.includes('localStorage.setItem("whq3-prefs", "')) { w.calls.push('put-back'); return true; }
    throw new Error('simPage cannot answer: ' + s.slice(0, 100));
  };
  w.t = {
    async evaluate(s) { return evalOf(s); },
    async waitFor(expr, ms = 10000) { for (let spent = 0; spent <= ms; spent += 100) { if (evalOf(expr)) return true; advance(100); } return false; },
    async reload() { w.calls.push('reload'); load(); },
    async press() { dismissNow(); },
    async send(method, params) {
      w.calls.push(method);
      if (method === 'Page.addScriptToEvaluateOnNewDocument') { const id = String(w.nextScript++); w.scripts.set(id, params.source); return { identifier: id }; }
      if (method === 'Page.removeScriptToEvaluateOnNewDocument') { w.scripts.delete(params.identifier); return {}; }
      if (method === 'Emulation.setEmulatedMedia') { w.media = params.features.length > 0; return {}; }
      if (method === 'Input.dispatchMouseEvent') { if (params.type === 'mousePressed') dismissNow(); return {}; }
      throw new Error('unexpected send ' + method);
    },
    sleep: async (ms) => advance(ms), errors: () => [], clearErrors() {},
  };
  w.sleep = async (ms) => advance(ms);
  return w;
}
const harness = (w) => makeVersionCardScenarios({ fresh: async () => null, sleep: w.sleep });

// ---- shape ------------------------------------------------------------------------------------------------------------------------------------
test('the factory returns exactly the six scenarios, each an async function of one argument, and needs the harness sleep', () => {
  const S = makeVersionCardScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES);
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
  assert.throws(() => makeVersionCardScenarios({ fresh: async () => null }), /sleep/);
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [initScript(true), initScript(false), PAGE.ready, PAGE.has, PAGE.nodes, PAGE.cardNodes, PAGE.text, PAGE.role, PAGE.focusInside, PAGE.probe, PAGE.log, PAGE.audio, PAGE.prefs, PAGE.prefsRaw,
    PAGE.setPrefs({ a: 1, versionCardSeen: null }), PAGE.putPrefsBack(null), PAGE.putPrefsBack('{"a":1}'), PAGE.becomeVisible, PAGE.switchLayerOn, PAGE.press, PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the selectors match the template’s own data attributes, and the page-side recorder looks for the same node', () => {
  for (const a of ['data-vcd="card"', 'data-vcd="caption"', 'data-vcd="stamp"']) assert.ok(tpl.includes(a), a);
  assert.ok(initScript(false).includes('[data-vcd="card"]'));
  assert.ok(PAGE.has.includes('[data-vcd="card"]'));
});

test('the constants agree with the rest of the dish', () => {
  assert.deepEqual({ ...LAYER_ON }, { ...VCD_LAYER_ON });
  assert.deepEqual({ ...LAYER_OFF }, { ...VCD_LAYER_OFF });
  assert.equal(CARD_MS, VC_MS);
  assert.notEqual(OLDER_STAMP, BUILD_STAMP);
  assert.match(OLDER_STAMP, /^\d{4}-\d{2}-\d{2}\.batch\d+$/);
});

test('the injected script overrides visibility from one flag and records the card coming and going', () => {
  const hidden = initScript(true), shown = initScript(false);
  assert.match(hidden, /__vcdHidden = true/);
  assert.match(shown, /__vcdHidden = false/);
  for (const k of ['visibilityState', "'hidden'", '__vcdLog', 'MutationObserver']) assert.ok(hidden.includes(k), k);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const calls = [];
  const t = { evaluate: async (s) => { calls.push(s); return null; }, send: async (m) => { calls.push(m); return {}; }, waitFor: async () => false, reload: async () => { calls.push('reload'); }, errors: () => [], clearErrors() {}, press: async () => {} };
  const S = makeVersionCardScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(calls.length, 0);
});

test('a page that never comes back is reported, and the injected script and prefs are still put back', async () => {
  const w = simPage();
  w.t.waitFor = async () => false;
  const S = harness(w);
  for (const name of NAMES) {
    const out = await S[name](w.t);
    assert.ok(out.length > 0 && /never came back/.test(out.join(' ')), name + ': ' + JSON.stringify(out));
    assert.equal(w.scripts.size, 0, name + ' removed its injected script');
  }
});

// ---- a healthy page: nothing to report -----------------------------------------------------------------------------------------------------
for (const name of NAMES) {
  test('healthy page: ' + name + ' reports nothing', async () => {
    const w = simPage();
    const out = await harness(w)[name](w.t);
    assert.deepEqual(out, [], name);
    assert.equal(w.scripts.size, 0, 'the injected script is removed');
    assert.equal(w.media, false, 'the emulated media is put back');
    assert.ok(w.calls.includes('reload'), 'the scenario reloaded');
  });
}

test('healthy page: the prefs the scenario wrote are put back (the original text, or removed when there was none)', async () => {
  const w = simPage();
  await harness(w)['version-card-plays-once'](w.t);
  assert.ok(w.calls.includes('put-back'));
});

// ---- broken pages are caught --------------------------------------------------------------------------------------------------------------
test('broken page: the card never shows -> plays-once, new-stamp and hidden-launch say so', async () => {
  for (const name of ['version-card-plays-once', 'version-card-new-stamp', 'version-card-skip']) {
    const w = simPage('never');
    const out = await harness(w)[name](w.t);
    assert.ok(out.some((m) => /never showed/.test(m)), name + ': ' + JSON.stringify(out));
  }
});

test('broken page: the card plays again after a reload -> plays-once, skip and new-stamp say so', async () => {
  for (const name of ['version-card-plays-once', 'version-card-skip', 'version-card-new-stamp']) {
    const w = simPage('replay');
    const out = await harness(w)[name](w.t);
    assert.ok(out.length > 0, name + ' should report a replay: ' + JSON.stringify(out));
  }
});

test('broken page: the layer leaves a listener behind -> plays-once and skip say so', async () => {
  for (const name of ['version-card-plays-once', 'version-card-skip']) {
    const w = simPage('leak');
    const out = await harness(w)[name](w.t);
    assert.ok(out.some((m) => /listener|still holds|fewer/.test(m)), name + ': ' + JSON.stringify(out));
  }
});

test('broken page: the card plays with the layer off -> layer-off-hidden says so', async () => {
  const w = simPage('plays-when-off');
  const out = await harness(w)['version-card-layer-off-hidden'](w.t);
  assert.ok(out.length > 0, JSON.stringify(out));
});

test('broken page: no layer probe in the build -> the layer-dependent scenarios say the Console layer dish is missing', async () => {
  for (const name of ['version-card-hidden-launch', 'version-card-layer-off-hidden']) {
    const w = simPage('noprobe');
    const out = await harness(w)[name](w.t);
    assert.ok(out.some((m) => /Console layer dish is not in this build/.test(m)), name + ': ' + JSON.stringify(out));
  }
});
