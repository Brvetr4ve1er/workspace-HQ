// Phase 3 review (R-P3) regression tests: the defects the review fixed, plus the
// cross-package contracts the packages could only test from one side.
//
//   node --test dashboard-v5/src/logic/review-p3.test.mjs
//
//  1. quota: an interactive Claude skill/command (`claude /<name>`) said quota:false in
//     the Automations list and in the run confirm — they now say it uses Claude quota.
//  2. Re-examine's toast counted the pc-health organs only, while the verdict also counts
//     the local model; with Ollama down it said "nothing flagged" over "1 issue to look at".
//  3. K-4: app.js declares every Phase 3 state key with the default its readers assume.
//  4. Escape folds the Canvas ＋ Note form, but only while it is on screen.
//  5. K-1 / K-2 / K-3 seen from both sides.
//
// Synthetic fixtures only (placeholder names and paths) — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { usesQuota, libFilters, LIB_PAGE } from './library.js';
import { machineIssues } from './system.js';
import { proj, scan, spell, spellbook, organ, pcHealth } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';

// ---- browser globals initState / renderVals touch (same as the golden test) ----------------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {} });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

function DATA() {
  return {
    scans: [scan('2026-10-05', [proj('a'), proj('b')])],
    spellbook: spellbook([
      spell('script:backup', { name: 'Backup notes', source: 'script', command: 'pwsh', args: ['-File', 'backup.ps1'] }),
      spell('script:ask-claude', { name: 'Ask Claude in the background', source: 'script', command: 'claude', args: ['-p', 'summarise'] }),
      spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'] }),
      spell('npm:a:dev', { name: 'dev (Project A)', kind: 'channeled', source: 'npm', command: 'npm', args: ['run', 'dev'] }),
    ]),
    pcHealth: pcHealth([organ('cpu'), organ('disk', { label: 'Storage', status: 'ember', diagnosis: 'Disk filling up', fixes: [] })]),
    canvas: [{ name: 'Board One', nodes: [{ id: 'n1', type: 'text', text: 'A note' }] }],
  };
}
function make(hq, state) {
  localStorage.clear(); sessionStorage.clear();
  const store = createStore(DATA(), hq === undefined ? null : hq);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  if (state) Object.assign(c.state, state);
  return c;
}
const tick = () => new Promise((r) => setImmediate(r));

// ---- 1. quota -----------------------------------------------------------------------------
test('usesQuota: true exactly when the command starts the Claude CLI', () => {
  assert.equal(usesQuota({ cmd: 'claude /review' }), true);
  assert.equal(usesQuota({ cmd: 'claude' }), true);
  assert.equal(usesQuota({ cmd: 'CLAUDE.exe -p x' }), true);
  assert.equal(usesQuota({ cmd: '  claude.cmd /plan' }), true);
  assert.equal(usesQuota({ cmd: 'npm run dev' }), false);
  assert.equal(usesQuota({ cmd: 'pwsh -File claude.ps1' }), false, 'a word inside the args is not the CLI');
  assert.equal(usesQuota({ cmd: 'claudette' }), false);
  assert.equal(usesQuota({}), false);
  assert.equal(usesQuota(null), false);
});

test('Automations rows and the run confirm say "quota" for Claude skills, not for npm dev', () => {
  const c = make(null, { tab: 'automations', libShow: 100 });
  const rows = Object.fromEntries(c.renderVals().autos.map((a) => [a.name, a]));
  assert.equal(rows['Review'].quota, true, 'a Claude skill uses quota');
  assert.equal(rows['Review'].mode, 'Terminal');
  assert.equal(rows['Ask Claude in the background'].quota, true, 'a background script that runs claude too');
  assert.equal(rows['dev (Project A)'].quota, false);
  assert.equal(rows['Backup notes'].quota, false);
  c.state.confirm = 'skill:review';
  const conf = c.renderVals().confirm;
  assert.equal(conf.quota, true);
  assert.equal(conf.kind, 'Opens a terminal · output stays there');
  // main's preview command wins over data.js's (it is what will run)
  c.state.confirmPreview = { id: 'skill:review', cmd: 'node review.js', dir: '' };
  assert.equal(c.renderVals().confirm.quota, false);
  c.state.confirm = 'npm:a:dev'; c.state.confirmPreview = null;
  assert.equal(c.renderVals().confirm.quota, false);
});

// ---- 2. Re-examine's count = the verdict's count ------------------------------------------------
test('machineIssues: the organs plus the local model when it is down or has no chat model', () => {
  const organs = [{ id: 'organ-disk', title: 'Disk' }];
  assert.deepEqual(machineIssues(organs, null).map((i) => i.id), ['organ-disk'], 'no probe yet: nothing claimed');
  assert.deepEqual(machineIssues(organs, { available: true, chatModel: 'm' }).map((i) => i.id), ['organ-disk']);
  assert.deepEqual(machineIssues(organs, { available: false }).map((i) => i.id), ['organ-disk', 'llm']);
  const noModel = machineIssues([], { available: true, chatModel: null });
  assert.equal(noModel[0].title, 'No local chat model installed');
  assert.equal(noModel[0].safe, false, 'never run as a safe fix');
});

test('Re-examine with the local model down: the toast and the verdict give the same count', async () => {
  const report = { scanned_at: '2026-10-05T09:58:00Z', organs: [organ('cpu'), organ('gpu', { status: 'ember', diagnosis: 'Hot' })] };
  const hq = { healthScan: () => Promise.resolve(report) };
  const c = make(hq, { tab: 'system', sub: { system: 'machine' } });
  c.store.live.llm = { available: false, reason: 'not running' };
  await c.reexamine();
  await tick();
  const v = c.renderVals();
  assert.equal(v.verdict, '2 issues to look at');
  assert.ok(c.state.toasts.some((t) => t.text === 'Re-examined · 2 issues to look at'), JSON.stringify(c.state.toasts.map((t) => t.text)));
});

// ---- 3. K-4 initial state -------------------------------------------------------------------
test('K-4: app.js declares every Phase 3 key with the default its reader assumes', () => {
  const S = make(null).state;
  const want = { sysExamining: false, sysSaves: {}, fixed: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: LIB_PAGE, libRescanning: false,
    projSearch: '', projStatus: 'all', canvasNoteOpen: false, canvasDraft: '', canvasBoard: null, canvasSaving: false, askChecking: false, whatsNewOpen: false, whatsNewMissing: {} };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(S[k], v, k);
  // the declared defaults are what the readers fall back to for undefined
  assert.deepEqual(libFilters(S), libFilters({}));
  // and declaring them changes no render value
  const declared = make(null, { tab: 'automations' }).renderVals();
  const undeclared = make(null, { tab: 'automations' });
  for (const k of Object.keys(want)) delete undeclared.state[k];
  const strip = (o) => JSON.stringify(o, (key, val) => (typeof val === 'function' ? '[fn]' : val && typeof val === 'object' && 'current' in val && Object.keys(val).length === 1 ? '[ref]' : val));
  assert.equal(strip(undeclared.renderVals()), strip(declared));
});

// ---- 4. Escape and the Canvas note form ---------------------------------------------------------
test('Escape folds the ＋ Note form only while it is on screen', () => {
  const onCanvas = { tab: 'claude', sub: { claude: 'canvas' }, route: null, canvasNoteOpen: true };
  const c = make({ canvasAdd() {} }, onCanvas);
  c.closeTop();
  assert.equal(c.state.canvasNoteOpen, false, 'on Claude › Canvas: Escape folds it');
  // left open on Canvas, then a project page: Escape leaves the page, the hidden form stays as it was
  const d = make({ canvasAdd() {} }, Object.assign({}, onCanvas, { tab: 'projects', route: { type: 'project', id: 'a' } }));
  d.closeTop();
  assert.equal(d.state.route, null, 'Escape went to the page');
  assert.equal(d.state.canvasNoteOpen, true);
  // an overlay over the form closes first
  const e = make({ canvasAdd() {} }, Object.assign({}, onCanvas, { settingsOpen: true }));
  e.closeTop();
  assert.equal(e.state.settingsOpen, false);
  assert.equal(e.state.canvasNoteOpen, true);
});

// ---- 5. contracts seen from both sides ----------------------------------------------------------
test('K-2: the store’s raw boards feed the ＋ Note picker; a {boards} push replaces both views', () => {
  const pushes = [];
  const hq = { canvasAdd() {}, onCanvas: (cb) => { pushes.push(cb); return () => {}; } };
  const c = make(hq, { tab: 'claude', sub: { claude: 'canvas' } });
  c.store.start();
  assert.deepEqual(c.canvasBoardNames(), ['Board One']);
  pushes[0]({ boards: [{ name: 'Board Two', nodes: [{ id: 'x', type: 'text', text: 'Pushed', x: 1, y: 2 }] }, { name: '../escape', nodes: [] }] });
  assert.deepEqual(c.canvasBoardNames(), ['Board Two'], 'names main would refuse are not offered');
  assert.deepEqual(c.renderVals().canvas.map((w) => w.board), ['Board Two']);
  pushes[0]('not a board list');
  assert.deepEqual(c.canvasBoardNames(), ['Board Two'], 'a bad payload changes nothing');
  c.store.stop();
});

test('K-1 / K-3: Ask state comes from v3’s keys and the palette lists What’s new', () => {
  localStorage.clear();
  const day = new Date().toLocaleDateString('en-CA');
  localStorage.setItem('hq-oracle-include', JSON.stringify({ scan: false, tasks: true, projects: true, health: true, browser: 1, vault: false }));
  localStorage.setItem('hq-oracle-chat', JSON.stringify({ day, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a', meta: { status: 'done', sections: [], ms: 10 } }] }));
  const store = createStore(DATA(), null);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  assert.deepEqual(c.state.askInclude, { scan: false, tasks: true, projects: true, health: true, browser: false, vault: false });
  assert.equal(c.state.askHistory.length, 1);
  c.state.paletteOpen = true; c.state.paletteQuery = 'trailers';
  const items = c.paletteItems().flat.map((i) => i.label);
  assert.ok(items.includes('What’s new · trailers'), JSON.stringify(items));
  localStorage.clear();
});
