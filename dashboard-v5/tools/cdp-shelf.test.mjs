// node --test dashboard-v5/tools/cdp-shelf.test.mjs
// The Shelf cdp scenarios cannot run here (they need the Electron harness), so this pins what can be pinned in plain Node: the factory's
// shape, that importing it does nothing, that every in-page snippet is valid JavaScript, that the snippets that do work behave on a minimal
// stand-in page (the cleanup above all: model rows, knob, console pref, motion pref), the expectations computed from the fixture, and that
// each scenario fails cleanly and always cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as mod from './cdp-shelf.mjs';
import { fakeShelfProjects } from './console-fixture.mjs';

const { makeShelfScenarios, SHELF_SCENARIOS, PAGE, SEL, KEYS, keyEvents, layerPref, expectedShelf, BUDGET, COUNT_KEY, BIG, PAGE_SIZE } = mod;
const SRC = fs.readFileSync(new URL('./cdp-shelf.mjs', import.meta.url), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SNAP = (keys) => `(() => { const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = localStorage.getItem(k); return o; })()`;
const RESTORE = (saved) => `for (const [k, v] of Object.entries(${JSON.stringify(saved || {})})) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }`;

const NAMES = ['shelf-off-no-dom', 'shelf-render', 'shelf-render-budget', 'shelf-hover-click', 'shelf-reduced-motion', 'shelf-more-and-search', 'shelf-keyboard'];
const make = (extra) => makeShelfScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {}, ...(extra || {}) });

test('the factory returns exactly the seven scenarios, each an async function of one argument', () => {
  const S = make();
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  assert.deepEqual([...SHELF_SCENARIOS].sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) {
    assert.equal(fn.constructor.name, 'AsyncFunction', name + ' is async');
    assert.equal(fn.length, 1, name + ' takes (t)');
  }
  assert.deepEqual(Object.keys(makeShelfScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE })).sort(), NAMES.slice().sort(), 'sleep is optional');
});

test('importing the file has no side effects: no socket, no timer, no process hook, nothing from cdp-gate', () => {
  const code = noComments(SRC);
  for (const re of [/\bWebSocket\b/, /\bfetch\(/, /process\.(exit|on|argv|stdin)/, /createServer|\.listen\(/, /cdp-gate/, /\brequire\(/, /setInterval/, /from 'node:(net|http|child_process)/]) assert.ok(!re.test(code), 'source mentions ' + re);
  assert.ok(/^import \{ fakeShelfProjects \} from '\.\/console-fixture\.mjs';$/m.test(SRC), 'its one import is the fixture');
});

// samples for the snippet builders that take arguments
const SAMPLES = {
  setKnob: [[83], [null]], setLayer: [[{ on: true, shelf: true }], [{}]], setState: [[{ reduceMotion: true }]], setSearch: [['zzzz'], ['']], clickSel: [[SEL.more]],
  clickToggle: [['list']], centerOf: [[SEL.cart, 4]], styleOf: [[SEL.cart, 0], [SEL.inserted, 0]],
};
function everySnippet() {
  const out = [];
  for (const [name, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') out.push([name, v]);
    else { const sets = SAMPLES[name]; assert.ok(sets, 'PAGE.' + name + ' takes arguments: add samples to the test'); for (const a of sets) out.push([name + '(' + a.length + ')', v(...a)]); }
  }
  return out;
}

test('every in-page snippet is valid JavaScript (they are evaluated in a page this test cannot open)', () => {
  const all = everySnippet();
  assert.ok(all.length > 30, 'snippets ' + all.length);
  for (const [name, code] of all) {
    assert.equal(typeof code, 'string', name);
    assert.doesNotThrow(() => new vm.Script(code), 'PAGE.' + name + ' does not parse:\n' + code);
  }
  assert.equal(COUNT_KEY, 'hqFake:projectCount');
  assert.ok(PAGE.setKnob(83).includes('hqFake:projectCount'));
  assert.ok(PAGE.cleanup.includes('hqFake:projectCount') && PAGE.cleanup.includes('removeItem'), 'cleanup takes the knob away again');
  assert.ok(PAGE.putProjects.includes('hqFake.shelfProjects()'), 'the page reads the knob through the fake preload hook, not a number of its own');
});

test('no snippet mentions a user-profile path or the network', () => {
  const profile = new RegExp(['[A-Za-z]:[\\\\/]+', 'Us' + 'ers', '|', 'Docu' + 'ments[\\\\/]', '|https?:'].join(''));
  for (const [name, code] of everySnippet()) assert.ok(!profile.test(code), name);
  assert.ok(!profile.test(noComments(SRC)), 'the scenario file holds no owner path');
});

test('the selectors are the ones the template carries, and the layer pref spells out every sub-flag', () => {
  assert.deepEqual(Object.keys(layerPref()).sort(), ['debug', 'on', 'palette', 'scan', 'shelf', 'skin']);
  assert.deepEqual(layerPref({ on: true, shelf: true }), { on: true, skin: false, scan: false, palette: '', debug: false, shelf: true });
  assert.equal(layerPref({ on: false }).on, false);
  assert.equal(BIG, 83); assert.equal(PAGE_SIZE, 48); assert.equal(BUDGET.firstRender, 400);
  for (const sel of Object.values(SEL)) assert.equal(typeof sel, 'string');
});

test('expectedShelf: what the screen should say, from the generator alone', () => {
  const e = expectedShelf(83);
  assert.deepEqual([e.total, e.shown, e.remaining], [83, 48, 35]);
  assert.equal(e.count, 'showing 48 of 83'); assert.equal(e.moreLabel, 'Show 35 more');
  assert.deepEqual(e.statusCounts, { ok: 21, care: 21, risk: 21, idle: 20 });
  assert.equal(e.names.length, 83);
  assert.equal(expectedShelf(3).moreLabel, null); assert.equal(expectedShelf(3).count, 'showing 3 of 3');
  assert.equal(expectedShelf(48).moreLabel, null);
  assert.equal(expectedShelf(49).moreLabel, 'Show 1 more');
  assert.equal(expectedShelf(0).count, 'showing 0 of 0');
  assert.equal(expectedShelf('junk').total, 0);
  assert.deepEqual(expectedShelf(83).names, fakeShelfProjects({ count: 83 }).map((p) => p.name));
});

test('keyEvents: Tab and Enter as real CDP key events; anything else is refused', () => {
  assert.deepEqual(Object.keys(KEYS).sort(), ['Enter', 'Tab']);
  const tab = keyEvents('Tab'), enter = keyEvents('Enter');
  assert.equal(tab[0].type, 'rawKeyDown'); assert.equal(tab[0].windowsVirtualKeyCode, 9); assert.equal(tab[1].type, 'keyUp');
  assert.equal(enter[0].type, 'keyDown'); assert.equal(enter[0].text, '\r'); assert.equal(enter[0].windowsVirtualKeyCode, 13);
  assert.throws(() => keyEvents('F13'), /no key table entry/);
});

// ---- a minimal stand-in page for the snippets that do work -----------------------------------------------------------------------
const env = (extra) => { const e = Object.assign({ performance, setTimeout, clearTimeout, Event, Promise, console }, extra || {}); e.window = e; return vm.createContext(e); };
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));   // objects made inside the vm context have another Object.prototype
const run = (code, e) => plain(vm.runInContext(code, e, { timeout: 5000 }));
const el = (attrs, extra) => Object.assign({
  getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null), textContent: '', querySelectorAll: () => [], querySelector: () => null,
  scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 120 }),
}, extra || {});

test('snippets: centerOf scrolls to the element and gives its centre and project id; none is null', () => {
  const b = el({ 'data-id': 'ph-004' });
  let scrolled = 0; b.scrollIntoView = () => { scrolled++; };
  const e = env({ document: { querySelectorAll: (sel) => (sel === SEL.cart ? [el(), el(), el(), el(), b] : []) } });
  assert.deepEqual(run(PAGE.centerOf(SEL.cart, 4), e), { x: 60, y: 80, id: 'ph-004' });
  assert.equal(scrolled, 1);
  assert.equal(run(PAGE.centerOf(SEL.cart, 9), e), null);
  assert.equal(run(PAGE.centerOf('.nothing', 0), e), null);
});

test('snippets: cartsInfo reads the accessible name, the visible text and the initials of each cartridge', () => {
  const text = (t) => ({ textContent: t });
  const mk = (id, label, initials, extraText) => el({ 'data-id': id, 'aria-label': label }, {
    tagName: 'BUTTON', textContent: initials + (extraText || ''), querySelectorAll: (s) => (s === 'text' ? [text(initials)] : []), querySelector: (s) => (s === 'svg[role="img"]' ? {} : null),
  });
  const e = env({ document: { querySelectorAll: (sel) => (sel === SEL.cart ? [mk('a', 'Alpha, At risk', 'A'), mk('b', 'Beta, Idle', 'BX', ' stray')] : []) } });
  const rows = run(PAGE.cartsInfo, e);
  assert.deepEqual(rows.map((r) => [r.tag, r.id, r.label, r.text, r.initials, r.art]), [['button', 'a', 'Alpha, At risk', 'A', 'A', true], ['button', 'b', 'Beta, Idle', 'BXstray', 'BX', true]]);
});

test('snippets: saveOriginals keeps the FIRST state; cleanup puts model rows, knob, console pref and motion pref back', () => {
  const calls = [], P0 = [{ id: 'invented-1' }, { id: 'invented-2' }, { id: 'invented-3' }];
  const removed = [];
  const L = {
    state: { consoleLayer: { on: true, shelf: true }, reduceMotion: false }, M: { at: () => ({ P0 }) },
    setState: (p) => calls.push(['setState', p]), go: (t) => calls.push(['go', t]),
  };
  const e = env({ WHQ: { app: { logic: L } }, sessionStorage: { removeItem: (k) => removed.push(k) }, hqFake: { reset: (a) => calls.push(['reset', a]) }, document: { activeElement: { blur: () => calls.push(['blur']) } } });
  // first the page as it was: layer pref present, reduceMotion off
  run(PAGE.saveOriginals, e);
  assert.deepEqual(plain(e.window.__shelfOrig), { cl: JSON.stringify({ on: true, shelf: true }), rm: false });
  // a scenario changes things, a second save must not record the changed state
  L.state.consoleLayer = { on: true, shelf: false }; L.state.reduceMotion = true;
  run(PAGE.saveOriginals, e);
  assert.equal(e.window.__shelfOrig.rm, false); assert.equal(e.window.__shelfOrig.cl, JSON.stringify({ on: true, shelf: true }));
  // the model rows: the page keeps the real ones in window.__shelfP0 when it swaps (the real swap is async; stand it in)
  e.window.__shelfP0 = [{ id: 'real-1' }, { id: 'real-2' }];
  run(PAGE.cleanup, e);
  assert.deepEqual(P0, [{ id: 'real-1' }, { id: 'real-2' }], 'the model\'s own rows are back');
  assert.ok(!('__shelfP0' in e.window) && !('__shelfOrig' in e.window), 'the page leaves nothing behind');
  assert.deepEqual(removed, [COUNT_KEY], 'the knob is removed');
  const patch = plain(calls.find((c) => c[0] === 'setState')[1]);
  assert.deepEqual(patch.consoleLayer, { on: true, shelf: true });
  assert.equal(patch.reduceMotion, false); assert.equal(patch.shelfMore, null); assert.equal(patch.route, null); assert.equal(patch.projSearch, '');
  assert.deepEqual(plain(calls.filter((c) => c[0] !== 'setState')), [['go', 'home'], ['blur'], ['reset', true]], 'home, focus released, a fresh fake');
});

test('snippets: cleanup with no console pref before (the layer dish absent) puts undefined back, not an invented pref', () => {
  const calls = [];
  const L = { state: {}, M: { at: () => ({ P0: [] }) }, setState: (p) => calls.push(p), go() {} };
  const e = env({ WHQ: { app: { logic: L } }, sessionStorage: { removeItem() {} }, hqFake: { reset() {} }, document: { activeElement: null } });
  run(PAGE.saveOriginals, e);
  assert.equal(e.window.__shelfOrig.cl, null);
  run(PAGE.cleanup, e);
  assert.equal(calls[0].consoleLayer, undefined);
  assert.equal(calls[0].reduceMotion, false);
});

test('snippets: setKnob writes and removes the sessionStorage key', () => {
  const store = {};
  const e = env({ sessionStorage: { setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } });
  run(PAGE.setKnob(83), e); assert.deepEqual(store, { [COUNT_KEY]: '83' });
  run(PAGE.setKnob(null), e); assert.deepEqual(store, {});
});

test('snippets: the layer and state setters send exactly the pref the scenario names', () => {
  const calls = [];
  const e = env({ WHQ: { app: { logic: { setState: (p) => calls.push(p) } } } });
  run(PAGE.setLayer({ on: true, shelf: true }), e);
  run(PAGE.setState({ reduceMotion: true }), e);
  assert.deepEqual(plain(calls), [{ consoleLayer: { on: true, skin: false, scan: false, palette: '', debug: false, shelf: true } }, { reduceMotion: true }]);
});

test('snippets: setSearch types into the Projects search box with an input event', () => {
  const seen = [];
  const box = { focus() { seen.push('focus'); }, value: '', dispatchEvent: (ev) => seen.push(ev.type) };
  const e = env({ document: { querySelector: (s) => (s === SEL.search ? box : null) } });
  assert.equal(run(PAGE.setSearch('zzzz'), e), true);
  assert.equal(box.value, 'zzzz'); assert.deepEqual(seen, ['focus', 'input']);
  assert.equal(run(PAGE.setSearch('x'), env({ document: { querySelector: () => null } })), false);
});

// ---- the scenarios, driven by a fake page ----------------------------------------------------------------------------------------
function fakeT(answer) {
  const evals = [], sends = [];
  return {
    evals, sends,
    evaluate: async (code) => { evals.push(code); return answer ? answer(code) : undefined; },
    send: async (m, p) => { sends.push([m, p]); },
    waitFor: async () => false, sleep: async () => {}, errors: () => [], reload: async () => {}, clearErrors() {},
  };
}

test('every scenario that cannot get a ready page fails with that reason and still cleans up', async () => {
  const S = make({ fresh: async () => ['the app never mounted'] });
  for (const name of NAMES) {
    const t = fakeT();
    const out = await S[name](t);
    assert.deepEqual(out, ['the app never mounted'], name);
    assert.ok(t.evals.includes(PAGE.cleanup), name + ' ran the cleanup');
    assert.ok(t.sends.some(([m, p]) => m === 'Emulation.setEmulatedMedia' && Array.isArray(p.features) && p.features.length === 0), name + ' cleared the emulated media');
    assert.ok(t.evals.some((c) => c.includes('localStorage')), name + ' put the prefs key back');
  }
});

test('a fake preload without the shelf hook says what to run, and cleans up', async () => {
  const S = make();
  for (const name of NAMES) {
    const t = fakeT((code) => (code.includes("typeof hqFake.shelfProjects") ? false : undefined));
    const out = await S[name](t);
    assert.equal(out.length, 1, name);
    assert.match(out[0], /hqFake\.shelfProjects is missing: run node tools\/console-fixture-paste\.mjs --init then --write/, name);
    assert.ok(t.evals.includes(PAGE.cleanup), name);
  }
});

test('a page whose model never takes the invented projects fails with a message naming the count', async () => {
  const S = make();
  const t = fakeT((code) => (code.includes("typeof hqFake.shelfProjects") ? true : code === PAGE.putProjects ? 12 : undefined));
  const out = await S['shelf-render'](t);
  assert.match(out[0], /never reached the model \(12, want 83\)/);
  assert.ok(t.evals.includes(PAGE.cleanup));
});

test('shelf-off-no-dom sets the layer OFF with the sub-flag left on, and checks the list, not the Shelf', async () => {
  const S = make();
  const seenLayer = [];
  const t = fakeT((code) => {
    if (code.includes("typeof hqFake.shelfProjects")) return true;
    if (code === PAGE.putProjects) return 83;
    if (code.startsWith('(() => { WHQ.app.logic.setState({ consoleLayer:')) seenLayer.push(code);
    if (code === PAGE.anyShelfNodes) return 0;
    if (code === PAGE.valsInfo) return { on: false, listOn: true, shelfOn: false, toggle: 0, rows: 0, lift: true, countLine: '', inserted: 0 };
    if (code === PAGE.listCards || code === PAGE.listCardsWanted) return 83;
    if (code === PAGE.hasList) return false;
    if (code.includes('toasts.filter')) return [];
    return undefined;
  });
  const out = await S['shelf-off-no-dom'](t);
  assert.deepEqual(out, []);
  assert.ok(seenLayer.some((c) => c.includes('"on":false') && c.includes('"shelf":true')), 'layer off, sub-flag on');
  // and it reports each way the DOM can be wrong
  const bad = fakeT((code) => {
    if (code.includes("typeof hqFake.shelfProjects")) return true;
    if (code === PAGE.putProjects) return 83;
    if (code === PAGE.anyShelfNodes) return 5;
    if (code === PAGE.valsInfo) return { on: true, listOn: false, shelfOn: true, toggle: 2 };
    if (code === PAGE.listCards) return 40;
    if (code === PAGE.listCardsWanted) return 83;
    if (code === PAGE.hasList) return true;
    if (code.includes('toasts.filter')) return [];
    return undefined;
  });
  const failures = await S['shelf-off-no-dom'](bad);
  assert.ok(failures.length >= 4, failures.join(' | '));
  assert.ok(failures.some((m) => /5 Shelf node/.test(m)) && failures.some((m) => /role=list/.test(m)) && failures.some((m) => /40 cards/.test(m)));
});

test('shelf-render-budget reports a miss with the re-run advice, and a pass with nothing', async () => {
  const mk = (ms) => fakeT((code) => {
    if (code.includes("typeof hqFake.shelfProjects")) return true;
    if (code === PAGE.putProjects) return 83;
    if (code === PAGE.firstRender) return { ms, n: 48 };
    return undefined;
  });
  const S = make();
  const log = console.log; console.log = () => {};
  try {
    assert.deepEqual(await S['shelf-render-budget'](mk(120)), []);
    const miss = await S['shelf-render-budget'](mk(401));
    assert.equal(miss.length, 1);
    assert.match(miss[0], /401 ms \(budget 400\)/); assert.match(miss[0], /re-run alone on a fresh instance/);
    const short = await S['shelf-render-budget'](fakeT((code) => (code.includes("typeof hqFake.shelfProjects") ? true : code === PAGE.putProjects ? 83 : code === PAGE.firstRender ? { ms: 5, n: 10 } : undefined)));
    assert.match(short[0], /never reached its 48 cartridges \(got 10\)/);
  } finally { console.log = log; }
});

test('shelf-render: a clean page passes; the failures it can report are specific', async () => {
  const E = expectedShelf(83);
  const carts = Array.from({ length: 48 }, (_, i) => ({ tag: 'button', id: 'ph-' + String(i + 1).padStart(3, '0'), label: 'Name ' + i + ', At risk', text: 'N' + i % 10, initials: 'N' + i % 10, art: true }));
  const answers = {
    [PAGE.countText]: E.count, [PAGE.moreText]: E.moreLabel, [PAGE.worstFirst]: { id: 'ph-003', name: 'Fenara 03' },
    [PAGE.insertedInfo]: [{ tag: 'button', label: 'Inserted: Fenara 03, At risk', id: 'ph-003' }], [PAGE.cartsInfo]: carts,
    [PAGE.listRole]: { role: 'list', label: 'Projects on the shelf', items: 48 }, [PAGE.cartCount]: 48, [PAGE.listCards]: 0,
    [PAGE.toggleInfo]: { group: { role: 'group', label: 'Projects view' }, buttons: [{ view: 'list', pressed: 'false', text: 'List' }, { view: 'shelf', pressed: 'true', text: 'Shelf' }] },
  };
  const mk = (over) => fakeT((code) => {
    if (code.includes("typeof hqFake.shelfProjects")) return true;
    if (code === PAGE.putProjects) return 83;
    if (code.includes('toasts.filter')) return [];
    const a = { ...answers, ...(over || {}) };
    return code in a ? a[code] : undefined;
  });
  const S = make();
  const ok = mk(); ok.waitFor = async () => true;
  assert.deepEqual(await S['shelf-render'](ok), []);
  const bad = mk({
    [PAGE.countText]: 'showing 83 of 83', [PAGE.insertedInfo]: [{ tag: 'div', label: 'x', id: 'ph-009' }, { tag: 'button', label: 'Inserted: y', id: 'ph-010' }],
    [PAGE.cartsInfo]: [{ tag: 'div', id: 'a', label: '', text: 'ABC extra', initials: 'ABC', art: false }, { tag: 'button', id: 'a', label: 'Name, Idle', text: 'N', initials: 'N', art: true }],
    [PAGE.listCards]: 12,
  });
  bad.waitFor = async () => true;
  const fails = (await S['shelf-render'](bad)).join(' | ');
  for (const re of [/count line reads "showing 83 of 83"/, /2 Inserted cartridges/, /without a button/, /beyond their initials/, /share a project id/, /list cards are still on screen/]) assert.match(fails, re);
});

test('shelf-keyboard stops when Tab never reaches a cartridge, naming what it saw', async () => {
  const S = make();
  const t = fakeT((code) => {
    if (code.includes("typeof hqFake.shelfProjects")) return true;
    if (code === PAGE.putProjects) return 83;
    if (code === PAGE.focusSearch) return true;
    if (code === PAGE.active) return { shelf: null, id: null, tag: 'button' };
    return undefined;
  });
  t.waitFor = async () => true;
  const out = await S['shelf-keyboard'](t);
  assert.match(out[0], /Tab never reached a cartridge in 30 presses/);
  assert.equal(t.sends.filter(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Tab' && p.type !== 'keyUp').length, 30);
  assert.ok(t.evals.includes(PAGE.cleanup));
});
