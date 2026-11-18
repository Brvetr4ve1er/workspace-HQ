// Projects > Shelf (batch 7, dish "cartridge-shelf"): the pure logic, the vals, the mixin, the template pins and the selftest rows.
// Plain Node, invented projects only (tools/console-fixture.mjs), no DOM.
//
//   node --test dashboard-v5/src/logic/shelf.test.mjs
//
// A few checks pin the SHARED edits (projects.tpl.js imports the fragment, vals/index.js registers shfv, app.js registers the mixin,
// the console-layer normaliser keeps the shelf boolean). They skip with a stated reason while the edit is not in and fail when it is
// in but wrong; nothing here depends on a file another dish has not landed yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHELF_PAGE, CART, CELL, NEUTRAL, INK_DARK, INK_LIGHT, MIN_CONTRAST, TOKEN_HEX, RAIL,
  initialsOf, parseColor, luminance, contrastRatio, toHex, hash32, labelColors, cartridgeOf, projSorters, sortProjects, shelfRowOf, pickInserted,
  shelfLayout, insertedArt, perRow, countLine, moreLabel, emptyLine, shelfFlags, shelfKey, shelfPages, motionAllowed,
} from './shelf.mjs';
import { shelfLogic } from './shelf.js';
import { compileAttr, unresolved } from '../dc/runtime.js';
import { shelfVals, SHF_OFF, shelfWidth } from '../vals/shelf.js';
import shelfView, { shelfToggle } from '../tpl/shelf.tpl.js';
import { projectsVals, PROJ_STATUSES, projMatches } from '../vals/projects.js';
import { toProject } from '../live/adapter.mjs';
import { ST } from '../live/catalog.mjs';
import { fakeShelfProjects } from '../../tools/console-fixture.mjs';
import { shelfStates, shelfInitState, swapProjects, SHELF_COUNTS } from '../selftest-shelf.mjs';
import { workbenchVals } from '../vals/workbench.js';
import { lanternVals } from '../vals/lantern.js';
// the empty-shelf line carries the Workbench art (batch 8); its bindings resolve against the look-on vals
const WBN_ON = workbenchVals.call({ state: { consoleLayer: { on: true, look: 'workbench' } } }, { rows: [] }).wbnv;
const LNT_ON = lanternVals.call({ state: { consoleLayer: { on: true, look: 'lantern' } } }, { rows: [] }).lntv;   // batch 11: the Lantern card beside the Workbench picture (sealed here: nothing read)
const SHAPE = { ...WBN_ON.projects.shapes[0], ...LNT_ON.projects.shapes[0] };   // both pictures loop their shapes as p

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const here = (p) => new URL(p, import.meta.url);
const read = (p) => fs.readFileSync(here(p), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const skipUnless = (cond, why) => (cond ? {} : { skip: why });

// ---- the invented projects, with the app's own status rule (app.js statusOf, copied: the fixture test pins its counts) -----------------
const statusOf = (p) => {
  if (p.secrets > 0 || !p.hasGit || (p.commits === 0 && p.dirty > 0)) return 'risk';
  if (p.activity === 'stale' || p.dirty > 20 || (p.hasGit && p.branch !== p.canonical)) return 'care';
  if (p.activity === 'dormant') return 'idle';
  if (p.dirty > 0) return 'care';
  return 'ok';
};
const projectsOf = (n) => fakeShelfProjects({ count: n }).map((raw) => { const p = toProject(raw); p.st = statusOf(p); p.reason = 'placeholder reason'; return p; });
const worstFirst = (ps) => ps.slice().sort((a, b) => ST[a.st].rank - ST[b.st].rank || b.pct - a.pct);

// ---- initials ------------------------------------------------------------------------------------------------------------------------
test('initialsOf: first letters of the first two words, uppercased, ? when there is nothing', () => {
  const cases = [['alpha-site', 'AS'], ['Placeholder 01', 'P0'], ['solo', 'S'], ['', '?'], ['   ', '?'], ['---', '?'], [null, '?'], [undefined, '?'], ['one two three', 'OT'],
    ['a_b-c', 'AB'], ['99 bottles', '9B'], ['été clair', 'ÉC'], ['\u{1F642}', '?'], ['x.y.z', 'XY'], ['  spaced   out ', 'SO'], [42, '4']];
  for (const [input, want] of cases) assert.equal(initialsOf(input), want, JSON.stringify(input));
});

// ---- colour ----------------------------------------------------------------------------------------------------------------------------
test('parseColor: hex, rgb, hsl and the v5 tokens; anything else is null', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseColor('#AABBCC'), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseColor('  #102030 '), { r: 16, g: 32, b: 48 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3 });
  assert.deepEqual(parseColor('rgba(1 2 3 / 0.5)'), { r: 1, g: 2, b: 3 });
  assert.deepEqual(parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseColor('hsl(120 100% 25%)'), { r: 0, g: 128, b: 0 });
  assert.deepEqual(parseColor('hsl(-120deg, 100%, 50%)'), { r: 0, g: 0, b: 255 });
  assert.deepEqual(parseColor('var(--red)'), parseColor('#e5645a'));
  assert.deepEqual(parseColor('var(--tone-green)'), parseColor(TOKEN_HEX.green));
  assert.deepEqual(parseColor('var(--blue, #000)'), parseColor(TOKEN_HEX.blue));
  for (const junk of ['banana', '', '   ', null, undefined, 5, {}, [], '#12', '#12345', '#gggggg', 'rgb(300, 0, 0)', 'hsl(0, 200%, 50%)', 'var(--nope)', 'var(--red', 'expression(alert(1))', 'url(x)', 'red', 'x'.repeat(200)]) {
    assert.equal(parseColor(junk), null, JSON.stringify(junk));
  }
});

test('luminance and contrastRatio follow WCAG', () => {
  assert.equal(luminance('#000000'), 0);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#000', '#fff') - 21) < 1e-6);
  assert.equal(contrastRatio('#808080', '#808080'), 1);
  assert.equal(contrastRatio('#123456', '#fedcba'), contrastRatio('#fedcba', '#123456'), 'symmetric');
  assert.equal(luminance('banana'), 0);
});

test('labelColors: garbage colour falls back to a neutral grey (no hue, never throws)', () => {
  for (const junk of ['banana', null, undefined, '', 7, 'var(--nope)', '#zzz']) {
    const c = labelColors(junk, 'p1');
    for (const hex of [c.base, ...c.labelStops]) {
      const k = parseColor(hex);
      assert.ok(k && Math.abs(k.r - k.g) <= 12 && Math.abs(k.g - k.b) <= 12, JSON.stringify(junk) + ' gave ' + hex + ', want a grey');
    }
  }
  const n = parseColor(NEUTRAL);
  assert.ok(Math.abs(n.r - n.g) <= 6 && Math.abs(n.g - n.b) <= 10, 'the neutral is a grey');
});

test('labelColors: the ink reaches 4.5 against BOTH label stops over the whole palette', () => {
  const colors = [];
  for (const hex of Object.values(TOKEN_HEX)) colors.push(hex);
  for (let h = 0; h < 360; h += 10) for (const s of [0, 30, 60, 100]) for (let l = 0; l <= 100; l += 5) colors.push('hsl(' + h + ', ' + s + '%, ' + l + '%)');
  let worst = Infinity, n = 0;
  for (const color of colors) {
    for (const seed of ['a', 'proj-1', 'ph-083']) {
      const c = labelColors(color, seed);
      assert.ok(c.ink === INK_DARK || c.ink === INK_LIGHT, 'ink is one of the two inks');
      assert.equal(c.labelStops.length, 2);
      for (const hex of [...c.labelStops, c.base]) assert.match(hex, /^#[0-9a-f]{6}$/);
      for (const stop of c.labelStops) { const r = contrastRatio(c.ink, stop); worst = Math.min(worst, r); assert.ok(r >= MIN_CONTRAST, color + ' / ' + seed + ': ink ' + c.ink + ' on ' + stop + ' is ' + r.toFixed(2)); }
      n++;
    }
  }
  assert.ok(n > 2000 && worst >= MIN_CONTRAST, 'checked ' + n + ' colour/seed pairs, worst ratio ' + worst.toFixed(2));
});

test('labelColors: same status colour, different projects: a small deterministic shift, same family', () => {
  const bases = new Set();
  const red = rgbHue('#e5645a');
  for (let i = 0; i < 12; i++) {
    const c = labelColors('var(--red)', 'ph-' + i);
    bases.add(c.base);
    const d = Math.abs(((c.hue - red + 540) % 360) - 180);
    assert.ok(d <= 16, 'hue ' + c.hue + ' stays within 16 degrees of red ' + red);
    assert.deepEqual(labelColors('var(--red)', 'ph-' + i), c, 'deterministic');
  }
  assert.ok(bases.size >= 4, 'twelve projects spread over ' + bases.size + ' distinct bases');
});
function rgbHue(hex) { const k = parseColor(hex); const m = Math.max(k.r, k.g, k.b), n = Math.min(k.r, k.g, k.b), d = m - n; let h = m === k.r ? ((k.g - k.b) / d) % 6 : m === k.g ? (k.b - k.r) / d + 2 : (k.r - k.g) / d + 4; h *= 60; return Math.round(h < 0 ? h + 360 : h); }

test('hash32 is a stable 32-bit hash', () => {
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
  assert.ok(hash32('anything') >= 0 && hash32('anything') <= 0xffffffff);
  assert.equal(toHex({ r: 1, g: 2, b: 300 }), '#0102ff');
});

// ---- the cartridge ----------------------------------------------------------------------------------------------------------------------
const ROW = { id: 'ph-007', name: 'Lumsun 07', tag: 'At risk', tone: 'red', color: 'var(--red)' };

test('cartridgeOf: the data the template draws, deterministic for a row', () => {
  const a = cartridgeOf(ROW), b = cartridgeOf({ ...ROW });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.id, 'ph-007');
  assert.equal(a.name, 'Lumsun 07');
  assert.equal(a.label, 'Lumsun 07, At risk');
  assert.equal(a.initials, 'L0');
  assert.equal(a.tone, 'red');
  assert.equal(a.stripe, 'var(--tone-red)');
  assert.equal(a.w, CART.w); assert.equal(a.h, CART.h);
  assert.deepEqual([a.w, a.h], [120, 148]);
  assert.ok(Number.isInteger(a.hue) && a.hue >= 0 && a.hue < 360);
  assert.equal(a.labelStops.length, 2);
  assert.equal(a.stop0, a.labelStops[0]); assert.equal(a.stop1, a.labelStops[1]);
  assert.equal(a.fill, 'url(#' + a.gid + ')');
  assert.match(a.gid, /^shg-[A-Za-z0-9_-]+-[a-z0-9]+$/);
  assert.equal(cartridgeOf(ROW, { prefix: 'shi' }).gid.slice(0, 4), 'shi-');
  assert.notEqual(cartridgeOf(ROW, { prefix: 'shi' }).gid, a.gid, 'drawn twice, never the same gradient id');
  // the plastic: fixed integers, a notch in the top edge, five grip lines, two bevel triangles, all inside the 120 x 148 box
  const p = a.paths;
  const pts = (s) => s.split(' ').map((pair) => pair.split(',').map(Number));
  for (const key of ['shell', 'bevelLight', 'bevelDark']) for (const [x, y] of pts(p[key])) { assert.ok(Number.isInteger(x) && Number.isInteger(y), key + ' integers'); assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 148, key + ' inside the box'); }
  assert.equal(pts(p.shell).length, 10);
  assert.equal(pts(p.bevelLight).length, 3); assert.equal(pts(p.bevelDark).length, 3);
  assert.equal(p.grip.length, 5);
  for (const g of p.grip) assert.ok(g.y2 > g.y1 && g.x1 === g.x2);
  assert.equal(p.gripD, 'M36 116V138M48 116V138M60 116V138M72 116V138M84 116V138');
  assert.deepEqual(p.label, { x: 20, y: 28, w: 80, h: 70, rx: 3 });
  assert.ok(p.stripe.y >= p.label.y + p.label.h);
  assert.equal(p.paint.shell, '#4a4d55');
  // a neighbour with the same status differs in colour, not in shape
  const other = cartridgeOf({ ...ROW, id: 'ph-008', name: 'Zorvik 08' });
  assert.deepEqual(other.paths.shell, a.paths.shell);
  assert.notEqual(other.id, a.id);
});

test('cartridgeOf: the tone stripe uses the list tone tokens; an unknown tone is the default', () => {
  for (const tone of ['red', 'orange', 'green', 'blue', 'gold', 'default']) assert.equal(cartridgeOf({ ...ROW, tone }).stripe, 'var(--tone-' + tone + ')');
  assert.equal(cartridgeOf({ ...ROW, tone: 'purple' }).stripe, 'var(--tone-default)');
  assert.equal(cartridgeOf({ ...ROW, tone: undefined }).tone, 'default');
  assert.equal(cartridgeOf({ ...ROW, tone: '"><script>' }).stripe, 'var(--tone-default)', 'a tone can never put text into the style');
  // the real ST table of the list
  for (const [id, s] of Object.entries(ST)) assert.equal(cartridgeOf({ id, name: id, tone: s.tone, color: s.color }).stripe, 'var(--tone-' + s.tone + ')');
});

test('cartridgeOf: names, labels and ids from junk rows never throw', () => {
  for (const junk of [null, undefined, 5, 'x', [], {}, { id: 5 }, { name: '' }, { id: '', name: '' }, { name: 'ok', color: {} }, { name: 'ok', tag: 7 }]) assert.doesNotThrow(() => cartridgeOf(junk), JSON.stringify(junk));
  assert.equal(cartridgeOf({}).name, 'Untitled project');
  assert.equal(cartridgeOf({}).initials, 'UP');
  assert.equal(cartridgeOf({ name: '---' }).initials, '?');
  assert.equal(cartridgeOf({ id: 'p1', name: 'Plain' }).label, 'Plain, status unknown');
  assert.equal(cartridgeOf({ id: 'p1' }).name, 'p1');
  // ids with markup or punctuation make a safe gradient id, and two that differ only by punctuation differ
  const a = cartridgeOf({ id: 'a/b', name: 'x' }), b = cartridgeOf({ id: 'a_b', name: 'x' }), c = cartridgeOf({ id: '"><svg onload=1>', name: 'x' });
  assert.notEqual(a.gid, b.gid);
  assert.match(c.gid, /^[A-Za-z0-9_-]+$/);
  assert.equal(cartridgeOf({ id: 'p', name: '<b>"x"</b>' }).name, '<b>"x"</b>', 'the name is data: the template binds it, never concatenates it');
});

// ---- the same list, the same order -----------------------------------------------------------------------------------------------------
function listCtx(projects, S) {
  const rows = worstFirst(projects);
  return {
    S: { tab: 'projects', projSort: 'worst', projSearch: '', projStatus: 'all', route: null, ...(S || {}) }, H: { ST, fmtD: () => '' }, snap: { archived: [] },
    projects, rows, sub: 'grid', onPage: false, tabStyle: (a) => ({ on: a }), rowOf: (p) => ({ id: p.id, name: p.name, color: ST[p.st].color, tone: ST[p.st].tone, tag: ST[p.st].label }),
  };
}
function rig(state) {
  const calls = [];
  const self = Object.assign(Object.create(shelfLogic), {
    state: { ...(state || {}) },
    setState(patch) { calls.push(['setState', typeof patch === 'function' ? patch(self.state) : patch]); },
    openProject(id) { calls.push(['openProject', id]); },
  });
  return { self, calls };
}
const shelfIds = (v) => v.rows.flatMap((r) => r.items.map((c) => c.id));

test('the fixture gives every status in the app\'s own rule (statusOf copy is right)', () => {
  const d = fakeShelfProjects({ describe: true });
  for (const n of [4, 83, 200]) {
    const c = { ok: 0, care: 0, risk: 0, idle: 0 };
    for (const p of projectsOf(n)) c[p.st]++;
    assert.deepEqual(c, d.statusCounts(n), 'n = ' + n);
  }
});

test('sort and filter parity: the shelf order is the list order, per sort and per filter (the real projectsVals is the oracle)', () => {
  const projects = projectsOf(83);
  const filters = [{}, { projSearch: 'rust' }, { projSearch: 'NODE' }, { projStatus: 'risk' }, { projStatus: 'ok', projSearch: 'placeholder' }, { projSearch: 'zzz-none' }, { projStatus: 'bogus' }, { projSearch: '  Kai ' }];
  let checked = 0;
  for (const sort of ['worst', 'recent', 'dirty', 'name', 'bogus', undefined]) {
    for (const f of filters) {
      const S = { projSort: sort, ...f };
      const { self } = rig({ consoleLayer: { on: true, shelf: true } });
      const oracle = projectsVals.call(self, listCtx(projects, S)).projCards.map((c) => c.id);
      const v = shelfVals.call(self, listCtx(projects, { ...S, consoleLayer: { on: true, shelf: true }, shelfMore: { key: shelfKey(sort, f.projSearch, PROJ_STATUSES.includes(f.projStatus) ? f.projStatus : 'all'), pages: 2 } })).shfv;
      assert.deepEqual(shelfIds(v), oracle, 'sort ' + sort + ' filter ' + JSON.stringify(f));
      checked++;
    }
  }
  assert.equal(checked, 48);
});

test('sortProjects mirrors the list sorters (and sorts a copy; junk input is an empty list)', () => {
  const ps = projectsOf(30), before = ps.map((p) => p.id);
  const byName = sortProjects(ps, 'name', ST).map((p) => p.name);
  assert.deepEqual(byName, byName.slice().sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(ps.map((p) => p.id), before, 'the input is not reordered');
  assert.deepEqual(sortProjects(ps, 'nonsense').map((p) => p.id), sortProjects(ps, 'worst').map((p) => p.id), 'an unknown sort is worst-first, like the list');
  assert.deepEqual(sortProjects(null, 'name'), []);
  const s = projSorters(ST);
  assert.deepEqual(Object.keys(s).sort(), ['dirty', 'name', 'recent', 'worst']);
  assert.equal(s.recent({ lastDays: null }, { lastDays: 3 }) > 0, true, 'unknown days sort last');
});

test('shelfRowOf: the light row the shelf needs, and open goes through the injected handler', () => {
  const p = projectsOf(3)[2];
  const seen = [];
  const row = shelfRowOf(p, ST, (id) => seen.push(id));
  assert.deepEqual({ id: row.id, name: row.name, tag: row.tag, tone: row.tone, color: row.color }, { id: p.id, name: p.name, tag: 'At risk', tone: 'red', color: 'var(--red)' });
  row.open();
  assert.deepEqual(seen, [p.id]);
  assert.equal(typeof shelfRowOf({ id: 'x', name: 'y', st: 'nope' }, ST).open, 'function');
  assert.equal(shelfRowOf({ id: 'x', name: 'y', st: 'nope' }, ST).tag, '', 'an unknown status is not invented');
});

test('pickInserted: the current project, else the first row, else nothing', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(pickInserted(rows, 'b').id, 'b');
  assert.equal(pickInserted(rows, 7), rows[0], 'a current project that is not in the list: the first row');
  assert.equal(pickInserted(rows, 'ghost'), rows[0]);
  assert.equal(pickInserted(rows, null), rows[0]);
  assert.equal(pickInserted(rows, ''), rows[0]);
  assert.equal(pickInserted([], 'a'), null);
  assert.equal(pickInserted(null, 'a'), null);
  assert.equal(pickInserted([{ id: 5 }, { id: 6 }], '6').id, 6, 'ids compare as strings');
});

// ---- the layout and the paging -------------------------------------------------------------------------------------------------------------
const rowsOf = (n) => worstFirst(projectsOf(n)).map((p) => shelfRowOf(p, ST));

test('shelfLayout: 48 a page over 83 items, the count line and the true "Show N more"', () => {
  assert.equal(SHELF_PAGE, 48);
  const items = rowsOf(83);
  const p1 = shelfLayout(items, { width: 960 });
  assert.equal(p1.total, 83); assert.equal(p1.shown, 48); assert.equal(p1.remaining, 35); assert.equal(p1.page, 1);
  assert.equal(p1.countLine, 'showing 48 of 83');
  assert.equal(p1.hasMore, true);
  assert.equal(p1.moreLabel, 'Show 35 more');
  assert.equal(p1.empty, false); assert.equal(p1.emptyLine, '');
  assert.equal(p1.perRow, 8);
  assert.equal(p1.rows.length, 6);
  assert.deepEqual(p1.rows.map((r) => r.items.length), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(p1.rows.flatMap((r) => r.items.map((c) => c.id)), items.slice(0, 48).map((r) => r.id), 'in order, none lost, none doubled');
  assert.deepEqual(p1.rows.map((r) => r.key), ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  for (const r of p1.rows) assert.equal(r.rail, RAIL);
  const p2 = shelfLayout(items, { width: 960, page: 2 });
  assert.equal(p2.shown, 83); assert.equal(p2.remaining, 0); assert.equal(p2.countLine, 'showing 83 of 83');
  assert.equal(p2.hasMore, false); assert.equal(p2.moreLabel, '');
  assert.deepEqual(p2.rows.map((r) => r.items.length), [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 3]);
  assert.deepEqual(p2.rows.flatMap((r) => r.items.map((c) => c.id)), items.map((r) => r.id));
  assert.equal(shelfLayout(items, { page: 99 }).shown, 83, 'a page past the end is the end');
});

test('shelfLayout: edge sizes (0, 1, 3, 48, 49) and junk', () => {
  assert.equal(moreLabel(48), 'Show 48 more'); assert.equal(moreLabel(100), 'Show 48 more'); assert.equal(moreLabel(1), 'Show 1 more'); assert.equal(moreLabel(0), '');
  assert.equal(countLine(3, 3), 'showing 3 of 3');
  const l3 = shelfLayout(rowsOf(3), {});
  assert.equal(l3.countLine, 'showing 3 of 3'); assert.equal(l3.hasMore, false); assert.equal(l3.rows.length, 1);
  assert.equal(shelfLayout(rowsOf(48), {}).hasMore, false);
  assert.equal(shelfLayout(rowsOf(48), {}).countLine, 'showing 48 of 48');
  const l49 = shelfLayout(rowsOf(49), {});
  assert.equal(l49.moreLabel, 'Show 1 more'); assert.equal(l49.shown, 48);
  const l0 = shelfLayout([], {});
  assert.equal(l0.empty, true); assert.equal(l0.countLine, 'showing 0 of 0'); assert.deepEqual(l0.rows, []); assert.equal(l0.inserted, null); assert.equal(l0.hasMore, false);
  assert.equal(l0.emptyLine, 'No projects yet, so the shelf is empty.');
  const filtered = shelfLayout([], { allCount: 83, all: rowsOf(83).slice(0, 1) });
  assert.equal(filtered.emptyLine, 'Nothing on the shelf matches. Clear the search or the status chip to see all 83 projects.');
  assert.equal(emptyLine(1), 'Nothing on the shelf matches. Clear the search or the status chip to see all 1 project.');
  for (const page of [0, -1, 1.5, '2', NaN, null, undefined, Infinity]) assert.equal(shelfLayout(rowsOf(83), { page }).page, 1, 'page ' + String(page));
  assert.doesNotThrow(() => shelfLayout([null, 5, 'x', {}, { id: 'a' }], { width: 'wide' }));
  assert.equal(shelfLayout([null, 5, 'x', {}, { id: 'a' }], {}).total, 2, 'only objects are projects');
  assert.doesNotThrow(() => shelfLayout(null, null));
});

test('perRow: how many cartridges stand in a row, at least one', () => {
  assert.equal(perRow(960), 8);
  assert.equal(perRow(CELL.w), 1);
  assert.equal(perRow(1), 1); assert.equal(perRow(0), 1); assert.equal(perRow(-500), 1);
  assert.equal(perRow(NaN), 8); assert.equal(perRow(undefined), 8);
  assert.equal(perRow(1600), 13);
  assert.equal(perRow(CELL.w * 2 + CELL.gap), 2);
});

test('the inserted slot: the current project drawn pushed into a console, named "Inserted: <name>"', () => {
  const items = rowsOf(10), all = items;
  const l = shelfLayout(items, { currentId: items[4].id, all });
  assert.equal(l.inserted.id, items[4].id);
  assert.equal(l.inserted.caption, 'Inserted: ' + items[4].name);
  assert.equal(l.inserted.label, 'Inserted: ' + items[4].name + ', ' + items[4].tag);
  assert.ok(l.inserted.gid.startsWith('shi-'), 'its own gradient id');
  const onShelf = l.rows.flatMap((r) => r.items).find((c) => c.id === items[4].id);
  assert.ok(onShelf && onShelf.gid.startsWith('shg-') && onShelf.gid !== l.inserted.gid, 'still on the shelf (the list is the same list), with another gradient id');
  assert.equal(typeof l.inserted.open, 'function');
  assert.equal(shelfLayout(items, { currentId: 'ghost', all }).inserted.id, items[0].id, 'a current project missing from the list: the first row');
  assert.equal(shelfLayout(items, { all }).inserted.id, items[0].id, 'no current project: the first row');
  assert.equal(shelfLayout(items, { all: [] }).inserted, null);
  // not narrowed by the search: the shelf can be empty while the console still holds a project
  const narrowed = shelfLayout([], { currentId: items[2].id, all, allCount: 10 });
  assert.equal(narrowed.inserted.id, items[2].id); assert.equal(narrowed.total, 0);
  const art = insertedArt({ name: 'X' });
  assert.equal(art.label, 'Inserted: X'); assert.equal(insertedArt().label, 'Inserted');
  for (const key of ['front', 'lip', 'slot']) for (const pair of art[key].split(' ')) assert.match(pair, /^\d+,\d+$/);
  assert.match(art.cartTransform, /^translate\(\d+ \d+\) scale\(0\.8\)$/);
});

// ---- flags, paging memory, motion ---------------------------------------------------------------------------------------------------------
test('shelfFlags reads the persisted pref defensively; the sub-flag counts only with the layer on', () => {
  assert.deepEqual(shelfFlags({ on: true, shelf: true }), { on: true, shelf: true });
  assert.deepEqual(shelfFlags({ on: true, shelf: false }), { on: true, shelf: false });
  assert.deepEqual(shelfFlags({ on: false, shelf: true }), { on: false, shelf: false });
  assert.deepEqual(shelfFlags({ on: true }), { on: true, shelf: false });
  for (const junk of [undefined, null, 5, 'on', [], { on: 'yes', shelf: 'yes' }, { on: 1, shelf: 1 }]) assert.deepEqual(shelfFlags(junk), { on: false, shelf: false }, JSON.stringify(junk));
});

test('shelfKey and shelfPages: a different filter starts the page count again', () => {
  assert.equal(shelfKey('worst', '', 'all'), 'worst||all');
  assert.equal(shelfKey(undefined, undefined, undefined), 'worst||all');
  assert.equal(shelfKey('name', '  KaI ', 'risk'), 'name|kai|risk');
  const key = shelfKey('worst', '', 'all');
  assert.equal(shelfPages({ key, pages: 3 }, key), 3);
  assert.equal(shelfPages({ key, pages: 3 }, shelfKey('name', '', 'all')), 1);
  for (const junk of [null, undefined, 5, {}, { key }, { key, pages: 0 }, { key, pages: 1.5 }, { key, pages: '2' }, { key, pages: 1001 }]) assert.equal(shelfPages(junk, key), 1, JSON.stringify(junk));
});

test('motionAllowed: neither the pref nor the OS query may ask for less', () => {
  const mm = (matches) => () => ({ matches });
  assert.equal(motionAllowed({ reduceMotion: false, matchMedia: mm(false) }), true);
  assert.equal(motionAllowed({ reduceMotion: true, matchMedia: mm(false) }), false);
  assert.equal(motionAllowed({ reduceMotion: false, matchMedia: mm(true) }), false);
  assert.equal(motionAllowed({}), true);
  assert.equal(motionAllowed(), true);
  assert.equal(motionAllowed({ matchMedia: () => { throw new Error('no media'); } }), true, 'a throwing query leaves motion allowed');
  let asked = '';
  motionAllowed({ matchMedia: (q) => { asked = q; return { matches: false }; } });
  assert.equal(asked, '(prefers-reduced-motion: reduce)');
});

// ---- the vals ----------------------------------------------------------------------------------------------------------------------------
const LAYER_ON = { on: true, skin: false, scan: false, palette: '', debug: false, shelf: false };
const SHELF_ON = { ...LAYER_ON, shelf: true };
const valsOf = (projects, S, extra) => { const { self, calls } = rig({ ...(S || {}) }); return { v: shelfVals.call(self, { ...listCtx(projects, S), ...(extra || {}) }).shfv, calls, self }; };
function everyValueDefined(x, path = 'shfv') {
  assert.notEqual(x, undefined, path + ' is undefined');
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) everyValueDefined(v, path + '.' + k);
}

test('vals: ONE top-level key, shfv', () => {
  const { self } = rig();
  for (const S of [{}, { consoleLayer: LAYER_ON }, { consoleLayer: SHELF_ON }]) assert.deepEqual(Object.keys(shelfVals.call(self, listCtx(projectsOf(5), S))), ['shfv']);
});

test('vals: the toggle and the Shelf do not exist while the layer is off', () => {
  const ps = projectsOf(83);
  for (const S of [{}, { consoleLayer: undefined }, { consoleLayer: null }, { consoleLayer: { on: false, shelf: true } }, { consoleLayer: { on: 'true', shelf: true } }, { consoleLayer: LAYER_ON, tab: 'home' }, { consoleLayer: SHELF_ON, tab: 'money' }]) {
    const { v } = valsOf(ps, S);
    assert.equal(v, SHF_OFF, 'the frozen constant itself: nothing was built for ' + JSON.stringify(S));
    assert.equal(v.listOn, true); assert.equal(v.shelfOn, false); assert.equal(v.on, false);
    assert.deepEqual([...v.toggle], []); assert.deepEqual([...v.rows], []); assert.equal(v.hasInserted, false); assert.deepEqual([...v.insertedList], []);
  }
  // not the grid, or on a project page
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { sub: 'map' }).v, SHF_OFF);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { sub: 'archived' }).v, SHF_OFF);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { onPage: true }).v, SHF_OFF);
  assert.equal(shelfVals.call({ state: { tab: 'home' } }, undefined).shfv, SHF_OFF, 'no ctx at all');
  assert.throws(() => { SHF_OFF.shelfOn = true; }, TypeError, 'the off constant is frozen');
  assert.throws(() => { SHF_OFF.toggle.push({}); }, TypeError);
});

test('vals: layer on with List chosen: the toggle, no Shelf rows, the list stays', () => {
  const { v, calls } = valsOf(projectsOf(83), { consoleLayer: LAYER_ON });
  assert.equal(v.on, true); assert.equal(v.listOn, true); assert.equal(v.shelfOn, false);
  assert.deepEqual(v.toggle.map((b) => [b.id, b.label, b.on]), [['list', 'List', true], ['shelf', 'Shelf', false]]);
  assert.deepEqual([...v.rows], []); assert.equal(v.hasInserted, false); assert.equal(v.countLine, ''); assert.equal(v.hasMore, false);
  assert.deepEqual(v.toggle.map((b) => b.style), [{ on: true }, { on: false }], 'the pressed button is styled by the screen\'s own tab style');
  assert.equal(calls.length, 0, 'building the vals writes nothing');
  v.toggle[1].go();
  assert.deepEqual(calls[0][1].consoleLayer, { ...LAYER_ON, shelf: true }, 'Shelf sets the persisted sub-flag, spreading the rest of the pref');
});

test('vals: Shelf chosen: the first 48 of 83, count line, one console, the list is out of the way', () => {
  const ps = projectsOf(83);
  const { v } = valsOf(ps, { consoleLayer: SHELF_ON });
  assert.equal(v.on, true); assert.equal(v.shelfOn, true); assert.equal(v.listOn, false);
  assert.deepEqual(v.toggle.map((b) => [b.id, b.on]), [['list', false], ['shelf', true]]);
  assert.equal(shelfIds(v).length, 48);
  assert.equal(v.countLine, 'showing 48 of 83');
  assert.equal(v.hasMore, true); assert.equal(v.moreLabel, 'Show 35 more');
  assert.equal(v.empty, false); assert.equal(v.emptyLine, '');
  assert.equal(v.hasInserted, true); assert.equal(v.insertedList.length, 1);
  assert.equal(v.listLabel, 'Projects on the shelf');
  assert.equal(v.lift, true);
  assert.equal(v.insertedList[0].id, worstFirst(ps)[0].id, 'no shared next action: the first worst-first project');
  everyValueDefined(v);
  const w = shelfWidth({ innerWidth: 1260 });
  assert.equal(w, 960); assert.equal(shelfWidth({ innerWidth: 200 }), 320); assert.equal(shelfWidth({ innerWidth: 9000 }), 1600); assert.equal(shelfWidth(null), 960); assert.equal(shelfWidth({}), 960);
});

test('vals: Show more asks for the next page of THIS filter, a stale memory is ignored', () => {
  const ps = projectsOf(83);
  const first = valsOf(ps, { consoleLayer: SHELF_ON });
  first.v.more();
  assert.deepEqual(first.calls[0][1].shelfMore, { key: 'worst||all', pages: 2 });
  const asked = first.calls[0][1].shelfMore;
  const second = valsOf(ps, { consoleLayer: SHELF_ON, shelfMore: asked });
  assert.equal(shelfIds(second.v).length, 83); assert.equal(second.v.countLine, 'showing 83 of 83'); assert.equal(second.v.hasMore, false); assert.equal(second.v.moreLabel, '');
  const other = valsOf(ps, { consoleLayer: SHELF_ON, shelfMore: asked, projSort: 'name' });
  assert.equal(shelfIds(other.v).length, 48, 'another sort: back to the first page');
  const searched = valsOf(ps, { consoleLayer: SHELF_ON, shelfMore: asked, projStatus: 'risk' });
  assert.equal(searched.v.countLine, 'showing 21 of 21', 'a status chip: its own count');

  const third = valsOf(ps, { consoleLayer: SHELF_ON, shelfMore: { key: 'bogus', pages: 9 } });
  assert.equal(shelfIds(third.v).length, 48);
});

test('vals: a search that matches nothing says so, the count says 0 of 0, the console still holds a project', () => {
  const ps = projectsOf(83);
  const { v } = valsOf(ps, { consoleLayer: SHELF_ON, projSearch: 'zzzz-no-such-project' });
  assert.equal(v.empty, true);
  assert.equal(v.emptyLine, 'Nothing on the shelf matches. Clear the search or the status chip to see all 83 projects.');
  assert.equal(v.countLine, 'showing 0 of 0');
  assert.deepEqual([...v.rows], []); assert.equal(v.hasMore, false);
  assert.equal(v.hasInserted, true, 'the console is not narrowed by the search');
  const none = valsOf([], { consoleLayer: SHELF_ON });
  assert.equal(none.v.emptyLine, 'No projects yet, so the shelf is empty.');
  assert.equal(none.v.hasInserted, false);
  everyValueDefined(none.v); everyValueDefined(v);
});

test('vals: the console holds the project of the shared next action, else the worst-first one', () => {
  const ps = projectsOf(40), rows = worstFirst(ps), pick = ps[17];
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: { next: { proj: pick.id } } }).v.insertedList[0].id, pick.id);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: { next: { proj: 'ghost' } } }).v.insertedList[0].id, rows[0].id, 'a next action whose project is not in the list');
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: { next: null } }).v.insertedList[0].id, rows[0].id);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: { mode: 'rest', next: null } }).v.insertedList[0].id, rows[0].id);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: null }).v.insertedList[0].id, rows[0].id);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }, { dec: { next: { proj: pick.id } } }).v.insertedList[0].label.startsWith('Inserted: ' + pick.name), true);
  // the project hidden by a search is still what the console holds
  const hidden = valsOf(ps, { consoleLayer: SHELF_ON, projSearch: 'zzzz' }, { dec: { next: { proj: pick.id } } });
  assert.equal(hidden.v.insertedList[0].id, pick.id);
});

test('vals: a cartridge opens its project through the same handler as the list card', () => {
  const ps = projectsOf(10);
  const { v, calls } = valsOf(ps, { consoleLayer: SHELF_ON });
  const cart = v.rows[0].items[3];
  cart.open();
  assert.deepEqual(calls[calls.length - 1], ['openProject', cart.id]);
  v.insertedList[0].open();
  assert.deepEqual(calls[calls.length - 1], ['openProject', v.insertedList[0].id]);
});

test('vals: the lift follows the reduceMotion pref and the OS query', () => {
  const ps = projectsOf(5);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }).v.lift, true);
  assert.equal(valsOf(ps, { consoleLayer: SHELF_ON, reduceMotion: true }).v.lift, false);
  const keep = globalThis.window;
  try {
    globalThis.window = { ...keep, matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }), innerWidth: 1000 };
    assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }).v.lift, false, 'the OS query alone turns the lift off');
    globalThis.window = { ...keep, matchMedia: () => ({ matches: false }), innerWidth: 1000 };
    assert.equal(valsOf(ps, { consoleLayer: SHELF_ON }).v.lift, true);
    assert.equal(valsOf(projectsOf(83), { consoleLayer: SHELF_ON }).v.rows[0].items.length, 5, 'rows are cut for the window width: 1000 - 300 = 700 px holds 5 cartridges and their gaps');
  } finally { globalThis.window = keep; }
});

test('vals: the off constant defines every key the shelf vals can return (and the same value types)', () => {
  const on = valsOf(projectsOf(83), { consoleLayer: SHELF_ON }).v, list = valsOf(projectsOf(83), { consoleLayer: LAYER_ON }).v;
  for (const v of [on, list]) {
    assert.deepEqual(Object.keys(v).sort(), Object.keys(SHF_OFF).sort());
    for (const [k, val] of Object.entries(SHF_OFF)) assert.equal(Array.isArray(v[k]), Array.isArray(val), k + ' keeps its type');
    for (const [k, val] of Object.entries(SHF_OFF)) assert.equal(typeof v[k], typeof val, k + ' keeps its typeof');
  }
});

test('vals: building the shelf is cheap (a named budget for the logic alone: 83 projects, 20 renders under 400 ms total)', () => {
  const ps = projectsOf(83), ctx = listCtx(ps, { consoleLayer: SHELF_ON }), { self } = rig();
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) shelfVals.call(self, ctx);
  const ms = performance.now() - t0;
  assert.ok(ms < 400, '20 builds took ' + ms.toFixed(1) + ' ms');
});

// ---- the mixin ---------------------------------------------------------------------------------------------------------------------------
test('mixin: shelfSet writes the sub-flag only while the layer is on, and keeps the rest of the pref', () => {
  const off = rig({ consoleLayer: { on: false, shelf: false } });
  off.self.shelfSet(true);
  assert.equal(off.calls.length, 0, 'layer off: nothing is written');
  const none = rig({});
  none.self.shelfSet(true);
  assert.equal(none.calls.length, 0, 'no pref at all: nothing is written');
  const on = rig({ consoleLayer: { on: true, skin: true, scan: true, palette: 'x', debug: true, shelf: false } });
  on.self.shelfSet(true);
  assert.deepEqual(on.calls[0][1], { consoleLayer: { on: true, skin: true, scan: true, palette: 'x', debug: true, shelf: true } });
  on.self.shelfSet(false);
  assert.equal(on.calls[1][1].consoleLayer.shelf, false);
  on.self.shelfSet('yes');
  assert.equal(on.calls[2][1].consoleLayer.shelf, false, 'only the boolean true chooses the Shelf');
});

test('mixin: shelfMore remembers { key, pages } one page further, junk starts from 1, capped', () => {
  const { self, calls } = rig({});
  self.shelfMore('worst||all', 1); self.shelfMore('k', undefined); self.shelfMore('k', 0); self.shelfMore(undefined, 2); self.shelfMore('k', 5000); self.shelfMore('k', 1.5);
  assert.deepEqual(calls.map((c) => c[1].shelfMore), [{ key: 'worst||all', pages: 2 }, { key: 'k', pages: 2 }, { key: 'k', pages: 2 }, { key: '', pages: 3 }, { key: 'k', pages: 1000 }, { key: 'k', pages: 2 }]);
  assert.deepEqual(Object.keys(shelfLogic).sort(), ['shelfMore', 'shelfSet']);
});

// ---- the template -------------------------------------------------------------------------------------------------------------------------
const TPL = shelfView + '\n' + shelfToggle;
const bindings = (text) => [...text.matchAll(/\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]);
const dig = (obj, path) => path.split('.').reduce((o, k) => (o !== null && o !== undefined && typeof o === 'object' && k in o ? o[k] : undefined), obj);

test('template: every binding resolves against the real vals (so the unresolved-path counter stays 0)', () => {
  const on = valsOf(projectsOf(83), { consoleLayer: SHELF_ON }, { dec: { next: { proj: 'ph-005' } } }).v;
  const scope = { shfv: on, c: on.rows[0].items[0], r: on.rows[0], b: on.toggle[0], cslv: { cslOn: true }, wbnv: WBN_ON, lntv: LNT_ON, p: SHAPE };
  const seen = new Set();
  // the inserted console binds a cartridge too, with the console art and the caption: those two resolve against the inserted one
  const ins = { ...scope, c: on.insertedList[0] };
  for (const raw of bindings(TPL)) {
    if (raw === 'true' || raw === 'false') continue;   // the designer hints (hint-placeholder-val), not bindings
    const expr = raw.replace(/^!\s*/, '');
    assert.match(expr, /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/, 'dc-lite dotted path only: ' + raw);
    const insertedOnly = expr.startsWith('c.art.') || expr === 'c.caption';
    assert.notEqual(dig(insertedOnly ? ins : scope, expr), undefined, 'unresolved: ' + raw);
    if (!insertedOnly) assert.notEqual(dig(ins, expr), undefined, 'unresolved on the inserted cartridge: ' + raw);
    seen.add(expr);
  }
  // listOn is bound by the list wrapper in projects.tpl.js (shared edit); on is read by tests and not by this fragment
  for (const key of Object.keys(SHF_OFF)) assert.ok([...seen].some((e) => e.startsWith('shfv.' + key)) || ['on', 'listOn'].includes(key), 'shfv.' + key + ' is never bound by the template (dead value)');
  // and against the off constant: every shfv binding is a key of it
  for (const expr of seen) if (expr.startsWith('shfv.')) assert.ok(expr.slice(5).split('.')[0] in SHF_OFF, expr + ' is not in SHF_OFF');
  assert.deepEqual([...seen].filter((e) => !/^(shfv|c|r|b|cslv|wbnv|lntv|p)\./.test(e)), [], 'no binding outside shfv, the loop variables, cslv.cslOn and the Workbench and Lantern art (wbnv, lntv)');
  assert.deepEqual([...seen].filter((e) => e.startsWith('cslv.')), ['cslv.cslOn'], 'the only thing read from the console skin dish is cslv.cslOn');
});

test('template: the real dc-lite resolver finds every binding, mixed attribute strings included (no hole is reported)', () => {
  const on = valsOf(projectsOf(83), { consoleLayer: SHELF_ON }).v;
  const base = { shfv: on, c: on.rows[0].items[0], r: on.rows[0], b: on.toggle[0], cslv: { cslOn: true }, wbnv: WBN_ON, lntv: LNT_ON, p: SHAPE };
  const inserted = { ...base, c: on.insertedList[0] };
  unresolved.clear();
  let n = 0;
  const attrs = [...TPL.matchAll(/="([^"]*\{\{[^"]*)"/g)].map((m) => m[1]);
  const texts = [...TPL.matchAll(/>([^<>]*\{\{[^<>]*)</g)].map((m) => m[1]);
  assert.ok(attrs.length > 40 && texts.length >= 5, 'attributes ' + attrs.length + ', texts ' + texts.length);
  for (const raw of [...attrs, ...texts]) {
    const scope = /c\.art\.|c\.caption/.test(raw) ? inserted : base;
    const out = compileAttr(raw)(scope);
    n++;
    if (/^\s*\{\{[^}]*\}\}\s*$/.test(raw)) assert.notEqual(out, undefined, raw);
    else { assert.equal(typeof out, 'string', raw); assert.ok(!/\[object|undefined|NaN/.test(out), raw + ' rendered as ' + out); }   // a whole binding keeps its type (list, function, style object); a mixed string must read as text
  }
  assert.deepEqual([...unresolved], [], 'the runtime reported unresolved holes');
  assert.ok(n > 45);
  // the mixed strings the art depends on come out as the CSS the screen needs
  const c = base.c;
  assert.equal(compileAttr('fill:{{ c.fill }}')(base), 'fill:' + c.fill);
  assert.equal(compileAttr('fill:{{ c.stripe }}')(base), 'fill:var(--tone-' + c.tone + ')');
  assert.ok(/^fill:#[0-9a-f]{6};stroke:#[0-9a-f]{6};stroke-width:2/.test(compileAttr('fill:{{ c.paths.paint.shell }};stroke:{{ c.paths.paint.edge }};stroke-width:2;stroke-linejoin:round')(base)));
  assert.equal(compileAttr('{{ c.open }}')(base), c.open, 'a whole binding keeps the function');
  assert.equal(compileAttr('{{ !shfv.lift }}')(base), false);
});

test('template: both fragments wrap themselves (zero DOM while off) and the tags balance', () => {
  const bare = (t) => t.replace(/^\s*<!--[\s\S]*?-->\s*/, '');   // the leading <!-- v5: ... --> marker (the runtime drops comments)
  assert.ok(/^<!-- v5: /.test(shelfToggle) && /^<!-- v5: /.test(shelfView), 'each fragment carries its <!-- v5: reason --> marker');
  assert.ok(bare(shelfToggle).startsWith('<sc-if value="{{ cslv.cslOn }}"'), 'the toggle is inside an sc-if on cslv.cslOn');
  assert.ok(bare(shelfView).startsWith('<sc-if value="{{ shfv.shelfOn }}"'), 'the view is inside an sc-if on shfv.shelfOn');
  for (const [name, text] of [['view', shelfView], ['toggle', shelfToggle]]) {
    for (const tag of ['sc-if', 'sc-for', 'div', 'span', 'button', 'svg', 'g', 'defs', 'linearGradient', 'polygon', 'rect', 'text', 'line', 'path', 'stop']) {
      const open = (text.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length, close = (text.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      assert.equal(open, close, name + ': <' + tag + '> opens ' + open + ', closes ' + close);
    }
  }
  assert.ok(!/<script|<style|<img|<image|<foreignObject|javascript:/i.test(TPL), 'no script, style, image or foreign content');
  assert.ok(!/https?:|url\((?!#)/i.test(TPL), 'no network and no url() but a local gradient id');
  assert.ok(!/(^|[^-])font-family:(?!var\(--term\))/.test(TPL), 'no font beyond var(--term)');
});

test('template: the cartridge is a button with an accessible name; the shelf a role=list; hover differs by motion', () => {
  assert.equal((shelfView.match(/data-shelf="cart"/g) || []).length, 2, 'the cartridge exists in the lifting and the outlining branch only');
  assert.equal((shelfView.match(/data-shelf="inserted"/g) || []).length, 1);
  assert.ok(/<button type="button" data-shelf="cart"[^>]*aria-label="\{\{ c\.label \}\}"/.test(shelfView), 'every cartridge button names itself');
  assert.ok(/<svg[^>]*role="img"[^>]*aria-label="\{\{ c\.label \}\}"/.test(shelfView), 'the art is role=img with the same name');
  assert.ok(/role="list"[^>]*aria-label="\{\{ shfv\.listLabel \}\}"/.test(shelfView) && /role="listitem"/.test(shelfView));
  assert.ok(/role="group" aria-label="Projects view"/.test(shelfToggle) && /aria-pressed="\{\{ b\.on \}\}"/.test(shelfToggle), 'the toggle is a group of pressed buttons');
  const liftAt = shelfView.indexOf('{{ shfv.lift }}'), flatAt = shelfView.indexOf('{{ !shfv.lift }}');
  assert.ok(liftAt > 0 && flatAt > liftAt);
  const lift = shelfView.slice(liftAt, flatAt), flat = shelfView.slice(flatAt, shelfView.indexOf('</sc-for>', flatAt));
  assert.ok(lift.includes('style-hover="transform:translateY(-6px);filter:drop-shadow(') && /transition:transform \.12s/.test(lift), 'lift: translateY(-6px), a drop shadow, a 120 ms transition');
  assert.ok(flat.includes('style-hover="outline:2px solid var(--gold)'), 'outline: 2px');
  assert.ok(!/transition|transform|translate|animate/.test(flat), 'the outline branch has no transition, no transform');
  assert.ok(!/<animate|<set |@keyframes|animation:/.test(TPL), 'nothing animates');
  // the only visible text in a cartridge is its initials
  const art = shelfView.slice(shelfView.indexOf('<svg viewBox="0 0 120 148"'), shelfView.indexOf('</svg>', shelfView.indexOf('<svg viewBox="0 0 120 148"')));
  const texts = [...art.matchAll(/<text[^>]*>(.*?)<\/text>/gs)].map((m) => m[1]);
  assert.deepEqual(texts, ['{{ c.initials }}']);
  assert.ok(!/<title>|<desc>/.test(TPL));
});

test('template: the hooks the CDP scenarios use are in it', async () => {
  const { SEL } = await import('../../tools/cdp-shelf.mjs');
  const need = [['data-shelf="cart"', SEL.cart], ['data-shelf="inserted"', SEL.inserted], ['data-shelf="count"', SEL.count], ['data-shelf="more"', SEL.more], ['data-shelf="empty"', SEL.empty], ['data-shelf="view"', SEL.view], ['data-shelf="toggle"', SEL.toggle], ['data-shelf-view=', SEL.toggleBtn], ['data-shelf="shelf"', SEL.list]];
  for (const [text, sel] of need) assert.ok(TPL.includes(text), 'the template lacks ' + text + ' (selector ' + sel + ')');
  assert.ok(SEL.list.includes('role="list"') && TPL.includes('role="list"'));
});

// ---- the shared edits, pinned once they are in -------------------------------------------------------------------------------------------------
const projectsTpl = read('../tpl/projects.tpl.js'), valsIndex = read('../vals/index.js'), appJs = read('../app.js');
const tplIn = /shelf\.tpl\.js/.test(projectsTpl), valsIn = /from '\.\/shelf\.js'/.test(valsIndex), appIn = /from '\.\/logic\/shelf\.js'/.test(appJs);

test('shared edit pin: projects.tpl.js carries the toggle, the view and the list wrapper', skipUnless(tplIn, 'projects.tpl.js does not import tpl/shelf.tpl.js yet (shared edit, see the pass notes)'), () => {
  assert.ok(/import shelfView, \{ shelfToggle \} from '\.\/shelf\.tpl\.js'/.test(projectsTpl) || /import .*shelf\.tpl\.js/.test(projectsTpl));
  assert.ok(projectsTpl.includes('${shelfToggle}') && projectsTpl.includes('${shelfView}'));
  assert.ok(projectsTpl.includes('{{ shfv.listOn }}'), 'the list\'s card grid is wrapped in sc-if shfv.listOn');
  assert.ok(projectsTpl.indexOf('${shelfToggle}') < projectsTpl.indexOf('{{ projCount }}'), 'the toggle sits in the Sort row, before the search row');
});
test('shared edit pin: vals/index.js registers shfv (one key)', skipUnless(valsIn, 'vals/index.js does not import vals/shelf.js yet (shared edit)'), () => {
  assert.ok(/shelfVals/.test(valsIndex.replace(/import .*\n/g, '')), 'shelfVals is in SURFACES');
});
test('shared edit pin: app.js registers the shelf mixin', skipUnless(appIn, 'app.js does not import logic/shelf.js yet (shared edit)'), () => {
  assert.ok(/shelfLogic\)?;?\s*$|shelfLogic[,)]/m.test(appJs.slice(appJs.indexOf('Object.assign(Component.prototype') >= 0 ? appJs.indexOf('Object.assign(Component.prototype') : 0)));
});
const clMod = await import('./console-layer.mjs').catch(() => null);
const clNorm = clMod ? Object.entries(clMod).find(([k, v]) => /normali[sz]e/i.test(k) && typeof v === 'function') : null;
test('shared edit pin: the console-layer normaliser keeps the shelf boolean', skipUnless(!!clNorm, 'logic/console-layer.mjs (dish "console-skin") is not in the tree yet, or exports no normaliser'), () => {
  const n = clNorm[1];
  assert.equal(n({ on: true, shelf: true }).shelf, true);
  assert.equal(n({ on: true, shelf: 'yes' }).shelf, false);
  assert.equal(n(undefined).shelf, false);
  assert.equal(n({ on: true }).shelf, false);
});

// ---- selftest rows -------------------------------------------------------------------------------------------------------------------------------
test('selftest: shelf states with 3, 48 and 83 invented projects, a no-match search, reduced motion, List chosen and layer off', () => {
  assert.deepEqual([...SHELF_COUNTS], [3, 48, 83]);
  const rows = shelfStates();
  const names = rows.map((r) => r[0]);
  assert.equal(new Set(names).size, names.length, 'unique names');
  for (const want of ['shelf-3', 'shelf-48', 'shelf-83', 'shelf-83-more', 'shelf-83-no-match', 'shelf-83-reduced-motion', 'shelf-83-list-chosen', 'shelf-83-layer-off', 'shelf-0-empty']) assert.ok(names.includes(want), want);
  const byName = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.deepEqual([byName['shelf-3'][1], byName['shelf-48'][1], byName['shelf-83'][1]], [3, 48, 83]);
  assert.equal(byName['shelf-83-no-match'][2].projSearch.length > 5, true);
  for (const [name, count, patch] of rows) {
    assert.ok(Number.isInteger(count) && count >= 0, name);
    assert.deepEqual(Object.keys(patch.consoleLayer).sort(), ['debug', 'on', 'palette', 'scan', 'shelf', 'skin'], name + ' spells out every sub-flag');
    assert.ok(['all', 'risk'].includes(patch.projStatus === undefined ? 'all' : patch.projStatus), name + ' status chip');
    // the patch is exactly what the vals read: it produces the state the name says
    const v = valsOf(projectsOf(Math.min(count, 83)), patch).v;
    if (/layer-off/.test(name)) { assert.equal(v, SHF_OFF, name); continue; }
    if (/list-chosen/.test(name)) { assert.equal(v.shelfOn, false, name); assert.equal(v.toggle.length, 2, name); continue; }
    assert.equal(v.shelfOn, true, name);
  }
  assert.equal(valsOf(projectsOf(83), byName['shelf-83-more'][2]).v.countLine, 'showing 83 of 83', 'the "more" row\'s key is the filters\' own');
  assert.equal(valsOf(projectsOf(83), byName['shelf-83-no-match'][2]).v.empty, true);
  assert.equal(valsOf(projectsOf(0), byName['shelf-0-empty'][2]).v.empty, true);
  assert.equal(valsOf(projectsOf(48), byName['shelf-48'][2]).v.hasMore, false, 'exactly one page: no more button');
  assert.equal(valsOf(projectsOf(3), byName['shelf-3'][2]).v.countLine, 'showing 3 of 3');
  assert.deepEqual(shelfInitState(), { shelfMore: null });
  assert.equal(shelfStates({ counts: [1, 2, 3] })[0][0], 'shelf-1');
  assert.equal(shelfStates({ counts: [1, 2] })[0][0], 'shelf-3', 'a malformed override is ignored');
});

test('selftest: swapProjects refills the model\'s own array in place and puts the real rows back', () => {
  const P0 = [{ id: 'real-1' }, { id: 'real-2' }], same = P0;
  const restore = swapProjects(P0, fakeShelfProjects({ count: 83 }), toProject);
  assert.equal(P0, same, 'the same array object');
  assert.equal(P0.length, 83);
  assert.equal(P0[0].id, 'ph-001'); assert.equal(typeof P0[0].stack.join, 'function');
  restore();
  assert.deepEqual(P0, [{ id: 'real-1' }, { id: 'real-2' }]);
  P0.push({ id: 'later' });
  restore();
  assert.equal(P0.length, 3, 'a second restore does nothing');
  assert.throws(() => swapProjects('nope', [], toProject), /not an array/);
  assert.throws(() => swapProjects([], [], null), /toProject/);
  const empty = []; swapProjects(empty, null, toProject)(); assert.deepEqual(empty, []);
});

// ---- the layer rule and the public repo -----------------------------------------------------------------------------------------------------------
// built from pieces so this file never contains the text it forbids
const OWNER_PATH = new RegExp(['[A-Za-z]:[\\/]+', 'Us' + 'ers', '|', 'Docu' + 'ments[\\/]'].join(''));
const NEW_SRC = ['./shelf.mjs', './shelf.js', '../vals/shelf.js', '../tpl/shelf.tpl.js', '../selftest-shelf.mjs'];
test('layer rule: no listener, timer or frame in any new renderer file', () => {
  for (const f of NEW_SRC) {
    const code = noComments(read(f));
    assert.ok(!/addEventListener|setInterval|setTimeout|requestAnimationFrame|requestIdleCallback|MutationObserver|ResizeObserver|IntersectionObserver/.test(code), f + ' registers something');
    assert.ok(!/\bdocument\b|\bnavigator\b|localStorage|sessionStorage|\.animate\(/.test(code), f + ' touches the DOM, storage or the animation API');
  }
});
test('public repo: the new renderer files hold no owner path, vault or account name', () => {
  for (const f of [...NEW_SRC, './shelf.test.mjs']) {
    const text = read(f);
    assert.ok(!OWNER_PATH.test(text), f + ' mentions a user-profile path');
    assert.ok(!/https?:\/\//.test(noComments(text)), f + ' mentions a URL');
  }
});
