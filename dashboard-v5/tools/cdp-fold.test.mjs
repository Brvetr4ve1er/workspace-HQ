// node --test dashboard-v5/tools/cdp-fold.test.mjs
// The fold cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that the selectors match the templates' own attributes, that each scenario stops at a failed fresh() and touches nothing, that a
// page that never shows is reported and reset, and (with a small model of the page built on the real foldable.mjs) that a healthy page reports
// nothing while four planted bugs are each caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFoldScenarios, PAGE, ALL_TITLES, railTitle, labelOf } from './cdp-fold.mjs';
import { NAV, SUBS } from '../src/live/catalog.mjs';
import { decideFold, foldNav, foldSubs, foldRow, numberKeyTarget } from '../src/live/foldable.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NAMES = ['fold-default-shows-everything', 'fold-hides-and-reveals', 'fold-number-keys-stable', 'fold-use-marks', 'fold-no-motion', 'fold-reload-persists'];

test('the factory returns exactly the six scenarios, each an async function of one argument', () => {
  const S = makeFoldScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const calls = [PAGE.setFold(['life'], true), PAGE.prefsWrite(['life']), PAGE.go('projects', 'archived'), PAGE.go('home'), PAGE.settings(true), PAGE.palette(true, 'x'), PAGE.paletteClick('Life'), PAGE.key('8'), PAGE.reduce(true)];
  const consts = Object.entries(PAGE).filter(([, v]) => typeof v === 'string').map(([, v]) => v);
  for (const s of [...consts, ...calls]) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 90));
});

test('the rail titles it expects are the shell\'s own: label plus the digit, the 11th with none', () => {
  assert.equal(ALL_TITLES.length, NAV.length);
  assert.equal(ALL_TITLES[0], 'Home (1)');
  assert.equal(ALL_TITLES[8], 'Money (9)');
  assert.equal(ALL_TITLES[9], 'Cosmos (0)');
  assert.equal(ALL_TITLES[10], 'Security');
  assert.equal(labelOf('Money (9)'), 'Money');
  assert.equal(railTitle({ label: 'X' }, 2), 'X (3)');
  const shell = fs.readFileSync(path.join(SRC, 'vals', 'shell.js'), 'utf8');
  assert.ok(shell.includes("title: n.label + (i < 10 ? ' (' + ((i + 1) % 10) + ')' : '')"), 'vals/shell.js still builds the rail title this way');
});

test('the selectors match the templates\' own attributes', () => {
  const read = (f) => fs.readFileSync(path.join(SRC, 'tpl', f), 'utf8');
  const shell = read('shell.tpl.js'), settings = read('ov-settings.tpl.js'), palette = read('ov-palette.tpl.js');
  for (const a of ['aria-label="Destinations"', 'title="{{ n.title }}"', 'role="tablist"', 'role="tab"']) assert.ok(shell.includes(a), 'shell.tpl.js: ' + a);
  for (const a of ['role="dialog" aria-label="Settings"', 'role="switch"']) assert.ok(settings.includes(a), 'ov-settings.tpl.js: ' + a);
  assert.ok(palette.includes('role="dialog" aria-label="Search and commands"'));
  assert.ok(/<button onClick="\{\{ it\.run \}\}"[^>]*><span[^>]*>\{\{ it\.glyph \}\}<\/span><span[^>]*>\{\{ it\.label \}\}<\/span>/.test(palette), 'a palette item is a button whose second child is its label');
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, reload: async () => { evals.push('reload'); }, errors: () => [], clearErrors() {} };
  const S = makeFoldScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a page that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, reload: async () => {}, errors: () => [], clearErrors() {} };
  const S = makeFoldScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.includes(PAGE.reset), name + ' leaves the page as it found it');
  }
});

// ---- a small model of the page, built on the real foldable.mjs ----
function makePage(bugs = {}) {
  const m = { tab: 'home', sub: { projects: 'grid', automations: 'runnable', system: 'machine', life: 'screen' }, foldIds: [], showEverything: false, settingsOpen: false, paletteOpen: false, paletteQuery: '', prefs: {}, marks: [], reduce: false, seen: '' };
  const dec = () => decideFold({ ownerFolded: m.foldIds, showEverything: m.showEverything });
  const save = () => { m.prefs = { foldIds: m.foldIds.slice(), showEverything: m.showEverything }; };
  const go = (tab, sub) => {
    const before = m.tab + '/' + (m.sub[m.tab] || '');
    m.tab = tab; if (sub) m.sub[tab] = sub;
    const now = m.tab + '/' + (m.sub[m.tab] || '');
    if (now !== before && m.tab === 'projects' && m.sub.projects === 'archived' && (bugs.markFolded || !dec().folded.has('projects/archived'))) m.marks.push('projects-archived/open');
  };
  const rail = () => foldNav(NAV, dec()).map((n) => railTitle(n, bugs.shiftDigits ? n.index - (m.foldIds.includes('life') && n.index > 7 ? 1 : 0) : n.index));
  const row = () => {
    const r = bugs.rowAlways ? { label: 'Show everything', desc: 'Hidden: .', on: m.showEverything } : foldRow(dec());
    return m.settingsOpen && r ? { text: r.label + ' ' + r.desc + ' ' + (r.on ? 'On' : 'Off'), state: r.on ? 'On' : 'Off' } : null;
  };
  const read = {
    [PAGE.railTitles]: () => rail(),
    [PAGE.subTabs]: () => foldSubs(m.tab, SUBS[m.tab], dec()).map((s) => s[1]),
    [PAGE.settingsOpen]: () => m.settingsOpen,
    [PAGE.row]: () => row(),
    [PAGE.rowMotion]: () => (row() ? 0 : -1),
    [PAGE.prefs]: () => (m.prefs.foldIds === undefined ? { foldIds: null, showEverything: null } : { foldIds: m.prefs.foldIds, showEverything: m.prefs.showEverything === undefined ? null : m.prefs.showEverything }),
    [PAGE.where]: () => ({ tab: m.tab, sub: m.sub[m.tab] || null, subs: { ...m.sub } }),
    [PAGE.state]: () => ({ foldIds: m.foldIds, showEverything: m.showEverything }),
    [PAGE.marks]: () => m.marks.slice(),
    [PAGE.paletteText]: () => (m.paletteOpen ? (m.paletteQuery ? 'Archived projects Projects' : NAV.map((n) => n.label).join(' ')) : ''),
  };
  const keys = Object.keys(read).sort((a, b) => b.length - a.length);
  const evalExpr = (expr) => {
    let e = expr;
    for (const k of keys) if (e.includes(k)) e = e.split(k).join('(' + JSON.stringify(read[k]()) + ')');
    return vm.runInNewContext(e);
  };
  const ops = {
    setFold: (a) => { m.foldIds = a.ids; m.showEverything = a.show; save(); return true; },
    prefsWrite: (a) => { m.prefs = { foldIds: a.ids }; return true; },
    go: (a) => { go(a.tab, a.sub); return true; },
    settings: (a) => { m.settingsOpen = a.open; m.paletteOpen = false; return true; },
    palette: (a) => { m.paletteOpen = a.open; m.paletteQuery = a.query; return true; },
    paletteClick: (a) => { const n = NAV.find((x) => x.label === a.label); if (!n || !m.paletteOpen) return false; m.paletteOpen = false; go(n.id); return true; },
    key: (a) => { const id = numberKeyTarget(NAV, a.key); if (id) go(id); return true; },
    reduce: (a) => { m.reduce = a.on; return true; },
    clickSwitch: () => { if (!row()) return false; m.showEverything = !m.showEverything; save(); return true; },
    reset: () => { m.foldIds = []; m.showEverything = false; m.settingsOpen = false; m.paletteOpen = false; m.reduce = false; m.marks = []; save(); go('home'); return true; },
  };
  const t = {
    evals: [],
    async evaluate(s) {
      t.evals.push(s);
      const mt = /^\/\*op:(\w+) (.*?)\*\/ /.exec(s);
      if (mt) return ops[mt[1]](JSON.parse(mt[2]));
      if (s === 'hqFake.reset(true)') { m.marks = []; return true; }
      return evalExpr(s);
    },
    async waitFor(expr) { try { return !!evalExpr(expr); } catch { return false; } },
    async reload() { m.foldIds = (m.prefs.foldIds || []).slice(); m.showEverything = m.prefs.showEverything === true; if (bugs.noPersist) { m.foldIds = []; m.showEverything = false; } m.settingsOpen = false; m.tab = 'home'; },
    errors: () => [], clearErrors() {},
  };
  return { t, m };
}

const run = async (name, bugs) => makeFoldScenarios({ fresh: async () => null, sleep: async () => {} })[name](makePage(bugs).t);

test('a healthy page reports nothing, for every scenario', async () => {
  for (const name of NAMES) assert.deepEqual(await run(name), [], name);
});

test('the model leaves the page as it found it', async () => {
  const { t, m } = makePage();
  const S = makeFoldScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) await S[name](t);
  assert.equal(m.tab, 'home');
  assert.deepEqual(m.foldIds, []);
  assert.equal(m.showEverything, false);
  assert.equal(m.settingsOpen, false);
});

test('a Settings row shown with nothing folded is caught by the default scenario', async () => {
  const out = await run('fold-default-shows-everything', { rowAlways: true });
  assert.ok(out.some((m) => /Show-everything row although nothing is folded/.test(m)), JSON.stringify(out));
});

test('shifted digits are caught by the number-keys scenario', async () => {
  const out = await run('fold-number-keys-stable', { shiftDigits: true });
  assert.ok(out.some((m) => /with Life folded the rail is/.test(m)), JSON.stringify(out));
});

test('a mark sent while the surface is folded is caught by the use-marks scenario', async () => {
  const out = await run('fold-use-marks', { markFolded: true });
  assert.ok(out.some((m) => /mark was sent for Archived while it is folded/.test(m)), JSON.stringify(out));
});

test('prefs that do not survive a reload are caught by the persistence scenario', async () => {
  const out = await run('fold-reload-persists', { noPersist: true });
  assert.ok(out.some((m) => /after a reload/.test(m)), JSON.stringify(out));
});

test('a scenario that finds a problem still cleans up', async () => {
  const { t, m } = makePage({ markFolded: true });
  const out = await makeFoldScenarios({ fresh: async () => null, sleep: async () => {} })['fold-use-marks'](t);
  assert.ok(out.length > 0);
  assert.ok(t.evals.includes(PAGE.reset));
  assert.deepEqual(m.foldIds, []);
  assert.equal(m.tab, 'home');
});
