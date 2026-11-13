// node --test dashboard-v5/tools/cdp-cosmos-polish.test.mjs
// The Cosmos polish cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that importing it does nothing,
// that every in-page snippet is valid JavaScript and behaves on a stand-in page, that the invented library has what the failed-card scenario builds on,
// that the template hooks the scenarios look for are present once the shared tpl edit has landed, and that each scenario fails cleanly and cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fakeCosmos } from './cosmos-fixture.mjs';
import { PAGE as BASE } from './cdp-cosmos.mjs';
import * as mod from './cdp-cosmos-polish.mjs';

const { makeCosmosPolishScenarios, COSMOS_POLISH_SCENARIOS, PAGE, SEL, MISSING, FAILED_WORDS } = mod;
const SRC = fs.readFileSync(new URL('./cdp-cosmos-polish.mjs', import.meta.url), 'utf8');
const SNAP = (keys) => `(() => { const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = localStorage.getItem(k); return o; })()`;
const RESTORE = (saved) => `/*restore*/ ${JSON.stringify(saved || {})}`;
const NAMES = ['cosmos-polish-selects', 'cosmos-polish-failed-card', 'cosmos-polish-lightbox', 'cosmos-polish-drag', 'cosmos-polish-index-phases', 'cosmos-polish-report'];

test('the factory returns exactly the six scenarios, each an async function of one argument', () => {
  const S = makeCosmosPolishScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  assert.deepEqual([...COSMOS_POLISH_SCENARIOS].sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) {
    assert.equal(fn.constructor.name, 'AsyncFunction', name + ' is async');
    assert.equal(fn.length, 1, name + ' takes (t)');
  }
  assert.deepEqual(Object.keys(makeCosmosPolishScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE })).sort(), NAMES.slice().sort(), 'sleep is optional');
});

test('importing the file has no side effects: no socket, no timer, no process hook, nothing from cdp-gate', () => {
  const code = SRC.replace(/^\/\/.*$/gm, '');
  for (const re of [/\bWebSocket\b/, /\bfetch\(/, /process\.(exit|on|argv|stdin)/, /createServer|\.listen\(/, /cdp-gate/, /\brequire\(/, /setInterval/, /from 'node:(net|http|child_process)/]) assert.ok(!re.test(code), 'source mentions ' + re);
  assert.ok(!/ROG|\\Users\\|C:\/Users|Pictures/.test(SRC), 'no owner path');
});

const SAMPLES = {
  selectInfo: [['sort'], ['group']], selectSet: [['sort', 'oldest']], cardInfo: [['alpha-site-001']], reveal: [['alpha-site-001']], setLibrary: [[{ works: [] }]],
  openLb: [['a'], ['a', { edit: 'title', draft: 'x' }]], clickSel: [[SEL.lbSize]],
  dragEvent: [['dragenter', SEL.feed, ['Files']]], emit: [[{ phase: 'walk', done: 1, total: 2 }]], setAnswer: [['cosmos.importFromLocal', { seeded: 1 }]],
  callCount: [['cosmos.read']],
};
function everySnippet() {
  const out = [];
  for (const [name, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') out.push([name, v]);
    else { const sets = SAMPLES[name]; assert.ok(sets, 'PAGE.' + name + ' takes arguments: add samples to the test'); for (const a of sets) out.push([name + '(' + a.length + ')', v(...a)]); }
  }
  return out;
}
test('every in-page snippet is valid JavaScript, and none mentions the owner, a real path or the network', () => {
  const all = everySnippet();
  assert.ok(all.length > 25, 'snippets ' + all.length);
  for (const [name, code] of all) {
    assert.equal(typeof code, 'string', name);
    assert.doesNotThrow(() => new vm.Script(code), 'PAGE.' + name + ' does not parse:\n' + code);
    assert.ok(!/\bUsers\b|ROG|Pictures|Documents|https?:/.test(code), name);
  }
});

test('the snippets behave on a stand-in page', async () => {
  const run = (code, env) => vm.runInNewContext(code, { Event, getComputedStyle: () => ({ outlineStyle: 'dashed', outlineWidth: '2px' }), ...env });
  // selects
  const sel = { tagName: 'SELECT', value: 'name', options: [{ value: 'newest', selected: false }, { value: 'name', selected: true }], dispatchEvent(ev) { this.fired = ev.type; return true; } };
  const doc = { querySelector: (s) => (s === SEL.sort ? sel : null) };
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.selectInfo('sort'), { document: doc }))), { tag: 'select', value: 'name', options: ['newest', 'name'], selected: ['name'] });
  assert.equal(await run(PAGE.selectInfo('group'), { document: doc }), null);
  assert.equal(await run(PAGE.selectSet('sort', 'newest'), { document: doc }), true);
  assert.deepEqual([sel.value, sel.fired], ['newest', 'change']);
  assert.equal(await run(PAGE.selectSet('group', 'x'), { document: doc }), false);
  // a drag event carries its types and reports whether default was prevented
  let seen = null; const host = { dispatchEvent(ev) { seen = { type: ev.type, types: ev.dataTransfer.types, bubbles: ev.bubbles }; ev.preventDefault(); return true; }, getAttribute: (n) => (n === 'data-drag' ? 'true' : null) };
  const ddoc = { querySelector: (s) => (s === SEL.feed ? host : null) };
  assert.equal(await run(PAGE.dragEvent('dragenter', SEL.feed, ['Files']), { document: ddoc }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), { type: 'dragenter', types: ['Files'], bubbles: true });
  assert.equal(await run(PAGE.dragEvent('dragenter', SEL.card, ['Files']), { document: ddoc }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.feedInfo, { document: ddoc }))), { drag: 'true', outlineStyle: 'dashed', outlineWidth: '2px' });
  // phase rows read off the page
  const rows = [{ getAttribute: (n) => ({ 'data-phase': 'walk', 'data-state': 'done' })[n], textContent: ' Reading the folder   done ' }];
  assert.deepEqual(JSON.parse(JSON.stringify(await run(PAGE.phases, { document: { querySelectorAll: () => rows } }))), [{ id: 'walk', state: 'done', text: 'Reading the folder done' }]);
  assert.equal(await run(PAGE.repText, { document: { querySelector: () => null } }), null);
});

test('the invented library has three works with data: pictures to build the missing-file case from', () => {
  const lib = fakeCosmos({ count: 40 });
  assert.ok(lib.works.length >= 3);
  assert.match(String(lib.works[2].thumbUrl || lib.works[2].url), /^data:/);
  assert.ok(lib.works[0].id && lib.works[1].id);
  assert.ok(MISSING.startsWith('file:///placeholder'));
  assert.equal(FAILED_WORDS, 'could not load');
});

test('the template hooks the scenarios look for are in the templates once the shared tpl edit landed (all or none of the new ones)', (t) => {
  const feed = fs.readFileSync(new URL('../src/tpl/cosmos.tpl.js', import.meta.url), 'utf8');
  const over = fs.readFileSync(new URL('../src/tpl/cosmos-overlays.tpl.js', import.meta.url), 'utf8');
  const both = feed + '\n' + over;
  const NEWHOOK = { sort: /<select[^>]*data-cos="sort"/, group: /<select[^>]*data-cos="group"/ };
  const hook = (k) => (NEWHOOK[k] ? NEWHOOK[k].test(both) : both.includes(SEL[k].slice(1, -1)));
  const fresh = ['sort', 'group', 'lbSize', 'lbFailed', 'idxPhase'];
  const found = fresh.filter((k) => hook(k));
  if (found.length === 0) { t.diagnostic('the shared tpl edit has not landed yet: new hooks not pinned'); }
  else assert.deepEqual(found, fresh, 'some new hooks are in the templates and some are not');
  for (const k of ['card', 'feed', 'lbImage', 'repLines']) assert.ok(hook(k), 'existing hook ' + k);
});

// a fake page for the scenario smoke tests
function fakeT({ waitFor = false } = {}) {
  const evals = [];
  return { evals, evaluate: async (code) => { evals.push(String(code)); return undefined; }, waitFor: async () => waitFor, send: async () => {}, reload: async () => {} };
}
test('each scenario stops at a failed fresh(), reports it, and still resets the polish state and cleans up', async () => {
  const S = makeCosmosPolishScenarios({ fresh: async () => ['not fresh'], SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  for (const [name, fn] of Object.entries(S)) {
    const t = fakeT();
    assert.deepEqual(await fn(t), ['not fresh'], name);
    assert.ok(t.evals.includes(PAGE.reset), name + ' resets the polish state');
    assert.ok(t.evals.includes(BASE.cleanup), name + ' runs the Cosmos cleanup');
    assert.ok(t.evals.some((e) => e.startsWith('/*restore*/')), name + ' restores the saved prefs');
    assert.ok(!t.evals.some((e) => /hqFake\.set\(/.test(e)), name + ' changed nothing before the page was fresh');
  }
});
test('a Feed that never shows its library is reported by every scenario, and the cleanup still runs', async () => {
  const S = makeCosmosPolishScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  for (const [name, fn] of Object.entries(S)) {
    const t = fakeT({ waitFor: false });
    const r = await fn(t);
    assert.ok(Array.isArray(r) && r.length === 1 && /never arrived/.test(r[0]), name + ': ' + JSON.stringify(r));
    assert.ok(t.evals.includes(BASE.cleanup), name);
    assert.ok(t.evals.includes(PAGE.reset), name);
  }
});
test('a scenario whose page lacks the new controls says which control is missing instead of throwing', async () => {
  const S = makeCosmosPolishScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  const t = { evals: [], evaluate: async (c) => { t.evals.push(c); return null; }, waitFor: async () => true, send: async () => {}, reload: async () => {} };
  const r = await S['cosmos-polish-selects'](t);
  assert.ok(r.some((x) => /no sort <select>/.test(x)) && r.some((x) => /no group <select>/.test(x)), JSON.stringify(r));
  const d = await S['cosmos-polish-drag'](t);
  assert.ok(d.some((x) => /no Feed host/.test(x)), JSON.stringify(d));
});
