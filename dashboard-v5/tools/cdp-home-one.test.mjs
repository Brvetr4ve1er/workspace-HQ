// node --test dashboard-v5/tools/cdp-home-one.test.mjs
// The Home-as-one-decision cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript and (for the two that read the disclosure) behaves on a tiny stand-in page, that the wording the scenarios look for is the modules' own,
// that each scenario stops at a failed fresh(), reports a Home that never renders and puts the page back, and that the selftest rows are well formed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  makeHomeOneScenarios, PAGE, HOME_MORE_ON, HOME_MORE_OFF, openHomeMore, briefOf, SCAN_ROW, projectRow, READY, MARKS,
} from './cdp-home-one.mjs';
import { KEY, label } from '../src/logic/home-more.mjs';
import { SOURCE_WORDS } from '../src/logic/decision.mjs';
import { homeOneStates, HOME_ONE_STORAGE_KEYS } from '../src/selftest-home-one.mjs';

const NAMES = ['home-one-render', 'home-one-more-persist', 'home-one-follows-brief', 'home-one-allclear', 'home-one-done-xp', 'home-one-no-motion', 'home-one-use-marks'];

test('the factory returns exactly the seven scenarios, each an async function of one argument', () => {
  const S = makeHomeOneScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const flat = [READY, HOME_MORE_ON, HOME_MORE_OFF];
  for (const [k, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') flat.push(v);
    else if (typeof v === 'function') flat.push(v(briefOf([SCAN_ROW, projectRow('placeholder-project-a')])));
    else for (const s of Object.values(v)) flat.push(s);   // PAGE.nodes
    assert.ok(v, k);
  }
  for (const s of flat) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the wording the scenarios look for is the modules\' own', () => {
  assert.ok(HOME_MORE_ON.includes("'" + KEY + "'") && HOME_MORE_OFF.includes("'" + KEY + "'"), 'the storage key');
  assert.ok(PAGE.moreBtn.includes('More|Less') && PAGE.moreBtn.includes('on Home'));
  assert.deepEqual([label(false), label(true)], ['More on Home', 'Less on Home']);
  assert.equal(SOURCE_WORDS['follows-brief'], 'Follows the top Brief row');
  assert.ok(SOURCE_WORDS.ranker.startsWith('picked by fixed rules'));
  assert.deepEqual(MARKS, ['today-ribbon', 'sessions-strip']);
  assert.equal(HOME_MORE_ON.includes("'1'"), true, 'open is stored as the exact string 1');
});

test('the Brief the scenarios serve is the brief-core shape and names invented projects only', () => {
  const b = briefOf([SCAN_ROW, projectRow('placeholder-project-a')]);
  assert.deepEqual(Object.keys(b).sort(), ['errors', 'generatedAt', 'items', 'more', 'overflow', 'quiet', 'standing', 'v']);
  for (const it of b.items) assert.deepEqual(Object.keys(it).sort(), ['action', 'age', 'count', 'key', 'rule', 'severity', 'source', 'text', 'why']);
  assert.equal(projectRow('p9').action.projectId, 'p9');
  assert.equal(projectRow(7).action.projectId, '7', 'a numeric project id is sent as text, the way main sends it');
});

// a stand-in page: one button, one region with two children, a style reader
function page({ withRegion = true, transition = '0s', animation = 'none', inline = '', animations = [] } = {}) {
  const mk = (extra) => Object.assign({ tagName: 'DIV', children: [], textContent: '', getAttribute() { return null; }, getAnimations: () => animations }, extra);
  const kids = [mk({ getAttribute: (a) => (a === 'style' ? inline : null) }), mk({})];
  const region = mk({ children: kids, getAttribute: () => null });
  const btn = mk({ tagName: 'BUTTON', textContent: ' Less on Home ', getAttribute: (a) => ({ 'aria-expanded': 'true', 'aria-controls': withRegion ? 'home-more' : null, type: 'button' }[a] ?? null) });
  const document = { querySelectorAll: () => [btn], getElementById: (id) => (withRegion && id === 'home-more' ? region : null) };
  const getComputedStyle = () => ({ transitionDuration: transition, animationName: animation });
  return { document, getComputedStyle, Node: { DOCUMENT_POSITION_FOLLOWING: 4 } };
}
const run = (src, env) => vm.runInNewContext(src, env);

test('the control probe reads the label, aria-expanded, aria-controls and that it is a real button', () => {
  assert.deepEqual({ ...run(PAGE.moreState, page()) }, { label: 'Less on Home', expanded: 'true', controls: 'home-more', tag: 'BUTTON', type: 'button' });
});

test('the motion probe passes a still page and names any control or block that moves', () => {
  const still = run(PAGE.motion, page());
  assert.deepEqual({ ...still, bad: [...still.bad] }, { checked: 4, region: true, bad: [] });
  assert.equal(run(PAGE.motion, page({ transition: '0.2s' })).bad.length, 4, 'a transition on the control and every block is named');
  assert.equal(run(PAGE.motion, page({ transition: '0s, 0.15s' })).bad.length, 4, 'a second transition in a list counts');
  assert.equal(run(PAGE.motion, page({ animation: 'fadeIn' })).bad.length, 4);
  assert.equal(run(PAGE.motion, page({ inline: 'transition: opacity .2s' })).bad.length, 1, 'an inline transition on one block');
  assert.equal(run(PAGE.motion, page({ animations: [{}] })).bad.length, 4, 'a running Web Animation counts');
  const noRegion = run(PAGE.motion, page({ withRegion: false }));
  assert.equal(noRegion.region, false);
  assert.equal(noRegion.checked, 1);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {}, send: async () => ({}), reload: async () => {} };
  const S = makeHomeOneScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a Home that never renders is reported, and the page is put back (reset runs last, the media emulation is cleared)', async () => {
  const S = makeHomeOneScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    const evals = [], sends = [];
    const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {}, reload: async () => {}, send: async (m, p) => { sends.push([m, p]); return { identifier: 'hook-1' }; } };
    const out = await S[name](t);
    assert.ok(Array.isArray(out) && out.length > 0, name + ' must say what it could not see');
    assert.ok(out.every((x) => typeof x === 'string'), name);
    assert.equal(evals.at(-1), PAGE.reset, name + ' leaves the page reset');
    if (name === 'home-one-no-motion') assert.deepEqual(sends.at(-1), ['Emulation.setEmulatedMedia', { features: [] }], 'the OS media emulation is cleared');
    if (name === 'home-one-more-persist') assert.ok(sends.every(([m]) => m !== 'Page.addScriptToEvaluateOnNewDocument'), 'nothing is hooked before Home shows');
  }
});

test('the persist scenario removes the storage hook it installs, even when it stops early', async () => {
  const S = makeHomeOneScenarios({ fresh: async () => null, sleep: async () => {} });
  const sends = [];
  let ready = true;   // Home shows, the flag state is always read as closed/absent
  const t = {
    evaluate: async (s) => (s === PAGE.moreState ? { label: 'More on Home', expanded: 'false', controls: 'x', tag: 'BUTTON', type: 'button' } : s === PAGE.flagState ? false : null),
    waitFor: async () => ready, errors: () => [], clearErrors() {}, reload: async () => {},
    send: async (m, p) => { sends.push([m, p && p.identifier]); return { identifier: 'hook-9' }; },
  };
  const out = await S['home-one-more-persist'](t);
  assert.ok(Array.isArray(out));
  const add = sends.find(([m]) => m === 'Page.addScriptToEvaluateOnNewDocument');
  if (add) assert.ok(sends.some(([m, id]) => m === 'Page.removeScriptToEvaluateOnNewDocument' && id === 'hook-9'), 'the hook is removed');
});

test('openHomeMore (the helper other Home-block scenarios call) opens the flag and the state, shows Home, then waits for Less on Home', async () => {
  const evals = [], waits = [];
  const t = { evaluate: async (s) => { evals.push(s); return true; }, waitFor: async (s) => { waits.push(s); return true; } };
  assert.equal(await openHomeMore(t), true);
  assert.equal(evals[0], HOME_MORE_ON);
  assert.match(evals[1], /go\('home'\)/);
  assert.ok(waits[0].includes('Less on Home'));
});

test('the selftest rows are well formed: ho1- names, Home, a LIVE.brief value, a boolean homeMore, invented ids only', () => {
  const rows = homeOneStates();
  assert.ok(rows.length >= 6);
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length, 'unique names');
  for (const r of rows) {
    assert.match(r.name, /^ho1-[a-z-]+$/);
    assert.equal(r.tab, 'home');
    assert.equal(r.sub, null);
    assert.deepEqual(Object.keys(r.state), ['homeMore']);
    assert.equal(typeof r.state.homeMore, 'boolean');
    assert.equal(r.brief.loaded, true);
    assert.equal(r.brief.error, '');
    assert.ok(Array.isArray(r.brief.brief.items));
  }
  assert.ok(rows.some((r) => r.state.homeMore) && rows.some((r) => !r.state.homeMore), 'both disclosure states are walked');
  assert.ok(rows.some((r) => r.brief.brief.items.length === 0), 'an empty Brief is walked');
  assert.ok(rows.some((r) => r.brief.brief.items.some((i) => i.group && i.group.listAction)), 'a group lead is walked');
  assert.deepEqual([...HOME_ONE_STORAGE_KEYS], [KEY]);
});

test('the selftest rows name the project the caller passes (so the card can follow) and an invented one otherwise', () => {
  const none = JSON.stringify(homeOneStates());
  assert.ok(none.includes('placeholder-project-a'));
  const named = homeOneStates({ projectId: 'proj-from-page-data' });
  const follows = named.find((r) => r.name === 'ho1-follows-closed');
  assert.equal(follows.brief.brief.items[0].action.projectId, 'proj-from-page-data');
  assert.equal(homeOneStates({ projectId: 42 })[0].brief.brief.items[0].action.projectId, 'placeholder-project-a', 'a non-string id is ignored');
});

test('no real names, paths, hosts or ids in the placeholders (the repo is public)', () => {
  const blob = JSON.stringify([homeOneStates(), briefOf([SCAN_ROW, projectRow('placeholder-project-a')])]);
  assert.doesNotMatch(blob, /[A-Za-z]:\\|\/Users\/|https?:\/\/|@[a-z0-9-]+\.[a-z]/i);
  const ids = [...blob.matchAll(/"projectId":"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^placeholder-project-[a-z]$/);
});
