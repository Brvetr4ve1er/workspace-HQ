// node --test dashboard-v5/tools/cdp-delights.test.mjs
// The small-delights cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that the wording and the DOM hooks they look for are the dish's own, that each scenario stops at a failed fresh() and touches nothing, that a page
// where nothing is wired is reported as a failure and always reset, and the two simplest scenarios against a scripted page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeDelightsScenarios, PAGE, WANT, FEB_10_2026, OCT_20_2026 } from './cdp-delights.mjs';
import { SEASONS, seasonFor, seasonLabel } from '../src/logic/seasons.mjs';
import { ROOM_NOTE, ROOM_CODE } from '../src/logic/delights.mjs';

const NAMES = ['delights-off-nothing', 'delights-attract-idle', 'delights-attract-blockers', 'delights-attract-reduced-motion', 'delights-season', 'delights-room'];

test('the factory returns exactly the six scenarios, each an async function of one argument', () => {
  const S = makeDelightsScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript (the functions are called with sample arguments)', () => {
  for (const [k, s] of Object.entries(PAGE)) {
    const text = typeof s === 'function' ? (k === 'arm' ? s(true, 300) : k === 'typeCode' ? s('abc') : k === 'pinClock' ? s(FEB_10_2026) : k === 'go' ? s('home') : s({ a: 1 })) : s;
    assert.equal(typeof text, 'string', k);
    assert.doesNotThrow(() => new vm.Script(text), k);
  }
  assert.doesNotThrow(() => new vm.Script(PAGE.arm(false, 90000)));
});

test('the wording and the pinned months are the dish’s own', () => {
  assert.equal(WANT.febLabel, seasonLabel(SEASONS[1]));
  assert.equal(WANT.octLabel, seasonLabel(SEASONS[9]));
  assert.equal(seasonFor(FEB_10_2026).month, 2);
  assert.equal(seasonFor(OCT_20_2026).month, 10);
  assert.notEqual(seasonFor(FEB_10_2026).id, seasonFor(OCT_20_2026).id);
  assert.equal(WANT.roomNote, ROOM_NOTE);
  assert.equal(WANT.code, ROOM_CODE);
  assert.equal(WANT.emptySlot, 'Empty slot');
});

test('the DOM hooks the scenarios look for are in the template', async () => {
  const T = await import('../src/tpl/delights.tpl.js');
  const all = T.dlxSeason + T.dlxAttract + T.default;
  for (const hook of ['data-dlx="attract-anchor"', 'data-dlx="attract"', 'data-dlx="season"', 'data-dlx="room"', 'aria-label="Close back room"']) assert.ok(all.includes(hook), hook);
  assert.match(PAGE.anchor, /attract-anchor/);
  assert.match(PAGE.scene, /data-dlx="attract"/);
  assert.match(PAGE.emptySlot, /aria-label="Empty slot"/);
  assert.match(PAGE.cssLink, /delights\.css/);
});

test('the page hooks are the mixin’s own names (clock, idle threshold, controller status, found list)', async () => {
  const { delightsLogic } = await import('../src/logic/delights.mjs');
  for (const fn of ['dlxIdleMs', 'dlxNowDate', 'dlxOpenRoom', 'dlxEscape', 'dlxCloseRoom', 'dlxSync']) assert.equal(typeof delightsLogic[fn], 'function', fn);
  assert.match(PAGE.arm(true, 300), /_dlxIdleMs = 300/);
  assert.match(PAGE.pinClock(5), /_dlxClock/);
  assert.match(PAGE.ctl, /_dlxCtl/);
  assert.match(PAGE.found, /cheatsFound/);
  assert.match(PAGE.probe, /__hqLayerProbe/);
});

test('each scenario stops at a failed fresh() and touches nothing', async () => {
  for (const name of NAMES) {
    const calls = [];
    const S = makeDelightsScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
    const t = { evaluate: async (e) => { calls.push(e); }, waitFor: async () => { calls.push('wait'); return false; }, send: async () => { calls.push('send'); }, press: async () => { calls.push('press'); }, sleep: async () => {} };
    assert.deepEqual(await S[name](t), ['the app never mounted'], name);
    assert.equal(calls.length, 0, name + ' touched the page');
  }
});

test('on a page where nothing is wired each scenario reports a failure and the last thing it does is reset the page', async () => {
  for (const name of NAMES) {
    const calls = [];
    const S = makeDelightsScenarios({ fresh: async () => null, sleep: async () => {} });
    const t = {
      evaluate: async (e) => { calls.push(e); return undefined; }, waitFor: async () => false, send: async () => {}, press: async () => {}, sleep: async () => {},
    };
    const out = await S[name](t);
    assert.ok(Array.isArray(out) && out.length > 0, name + ' passed on a blank page');
    assert.ok(out.every((x) => typeof x === 'string' && x.length > 0), name);
    assert.equal(calls.at(-1), PAGE.reset, name + ' did not end with the reset');
  }
});

// a scripted page: answers by the exact snippet, and understands the "!" and "=== label" forms waitFor uses
function scripted(state) {
  const lookup = (expr) => {
    if (typeof expr === 'string' && expr.startsWith('!') && expr.slice(1) in table) return !table[expr.slice(1)]();
    if (expr in table) return table[expr]();
    const m = /^(.*) === ("[^"]*")$/s.exec(expr);
    if (m && m[1] in table) return table[m[1]]() === JSON.parse(m[2]);
    return undefined;
  };
  const table = {
    [PAGE.emptyBrief]: () => true, [PAGE.reset]: () => { state.resets++; state.layer = false; return true; },
    [PAGE.probe]: () => JSON.stringify(state.probe || { links: 0, listeners: 0, timers: 0, frames: 0 }),
    [PAGE.cssLink]: () => !!state.css, [PAGE.anyDlxNode]: () => state.layer && state.season ? 1 : 0, [PAGE.consoleNodes]: () => 0,
    [PAGE.scene]: () => false, [PAGE.season]: () => state.layer && !!state.season, [PAGE.room]: () => !!state.room, [PAGE.ctl]: () => state.ctl || null,
    [PAGE.typeCode(WANT.code)]: () => { if (state.layer) state.room = true; return true; },
    [PAGE.seasonLabel]: () => (state.season ? seasonLabel(seasonFor(state.clock)) : null),
    [PAGE.seasonTitle]: () => (state.season ? seasonFor(state.clock).name + ' · month' : null),
    [PAGE.seasonSize]: () => [28, 28], [PAGE.seasonAnimations]: () => 0,
  };
  return {
    table,
    async evaluate(expr) {
      state.log.push(expr);
      if (expr.startsWith('(() => { const L = WHQ.app.logic; L._dlxIdleMs')) { state.layer = expr.includes('on: true'); state.season = state.layer; return true; }
      const pin = /_dlxClock = \(\) => (\d+)/.exec(expr); if (pin) { state.clock = Number(pin[1]); return true; }
      if (expr.includes('"consoleLayer"') && expr.includes('"on":false')) { state.layer = false; return true; }
      return lookup(expr);
    },
    async waitFor(expr) { return !!(await this.evaluate(expr)); },
    async send() {}, async press() {}, async sleep() {},
  };
}

test('delights-off-nothing passes on a page with the layer off and reports each thing that is wrongly there', async () => {
  const S = makeDelightsScenarios({ fresh: async () => null, sleep: async () => {} });
  const st = { log: [], resets: 0 };
  assert.deepEqual(await S['delights-off-nothing'](scripted(st)), []);
  assert.equal(st.resets, 1);
  assert.equal(st.log.at(-1), PAGE.reset);

  const bad = { log: [], resets: 0, probe: { links: 1, listeners: 9, timers: 1, frames: 0 }, css: true, ctl: '{"armed":true}', room: true };
  const out = await S['delights-off-nothing'](scripted(bad));
  assert.ok(out.some((x) => /probe counts/.test(x)), out.join('|'));
  assert.ok(out.some((x) => /delights\.css/.test(x)));
  assert.ok(out.some((x) => /controller/.test(x)));
  assert.ok(out.some((x) => /room/.test(x)));
});

test('delights-season passes when two months give two labelled ornaments and the layer off removes it; a wrong label is reported', async () => {
  const S = makeDelightsScenarios({ fresh: async () => null, sleep: async () => {} });
  const st = { log: [], resets: 0 };
  assert.deepEqual(await S['delights-season'](scripted(st)), []);
  assert.equal(st.log.at(-1), PAGE.reset);

  const page = scripted({ log: [], resets: 0 });
  page.table[PAGE.seasonLabel] = () => 'Season ornament: Paper kite (February)';   // never changes with the clock
  const out = await S['delights-season'](page);
  assert.ok(out.some((x) => /different month did not change/.test(x)), out.join('|'));
});
