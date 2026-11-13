// node --test dashboard/quick-targets-parity.test.mjs — the quick-run palette's Go table (dashboard/cast-modes.js goTable) must equal
// the app's own navigation (dashboard-v5/src/live/catalog.mjs NAV and SUBS): ids and labels, in the same order. The palette page cannot
// import an ES module, so it carries a copy; this test is what stops the copy drifting. Add a sub-view to catalog.mjs and this fails
// until cast-modes.js gets it too (Projects › Clients included: the comparison is exact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NAV, SUBS } from '../dashboard-v5/src/live/catalog.mjs';
const require = createRequire(import.meta.url);
const { goTable } = require('./cast-modes.js');

const tableSpaces = goTable.filter((t) => t.kind === 'space');
const tableSubs = (tab) => goTable.filter((t) => t.kind === 'sub' && t.tab === tab);

test('the spaces: goTable has exactly the catalog NAV ids and labels, in order', () => {
  assert.deepEqual(tableSpaces.map((t) => [t.tab, t.label]), NAV.map((n) => [n.id, n.label]));
});

test('the sub-views: goTable has exactly the catalog SUBS ids and labels per space, in order', () => {
  for (const n of NAV) {
    const want = (SUBS[n.id] || []).map(([id, label]) => [id, n.label + ' › ' + label]);
    const got = tableSubs(n.id).map((t) => [t.sub, t.label]);
    assert.deepEqual(got, want, 'sub-views of ' + n.id + ' drifted from catalog.mjs SUBS');
  }
});

test('every catalog space and sub-view is a Go target, and goTable has nothing the catalog lacks', () => {
  const targets = new Set(goTable.map((t) => t.tab + '/' + (t.sub || '')));
  const inCatalog = new Set();
  for (const n of NAV) {
    inCatalog.add(n.id + '/');
    assert.ok(targets.has(n.id + '/'), 'space ' + n.id);
    for (const [id] of SUBS[n.id] || []) { inCatalog.add(n.id + '/' + id); assert.ok(targets.has(n.id + '/' + id), n.id + ' › ' + id); }
  }
  for (const k of targets) assert.ok(inCatalog.has(k), k + ' is in goTable but not in catalog.mjs');
  for (const tab of Object.keys(SUBS)) assert.ok(NAV.some((n) => n.id === tab), 'SUBS has a space NAV lacks: ' + tab);
});

test('Projects › Clients is a Go target (delivery-clients landed)', () => {
  assert.ok(goTable.some((t) => t.tab === 'projects' && t.sub === 'clients'));
});

test('ids in goTable are routes nav-bridge accepts (lower-case letters, 2-16)', () => {
  for (const t of goTable) { assert.match(t.tab, /^[a-z]{2,16}$/); if (t.sub) assert.match(t.sub, /^[a-z]{2,16}$/); }
});

test('every SURFACE_TARGETS target exists in catalog NAV/SUBS, and SPACE_IDS are the NAV ids', () => {
  const { SURFACE_TARGETS, SPACE_IDS } = require('./cast-modes.js');
  const inCatalog = new Set();
  for (const n of NAV) { inCatalog.add(n.id + '/'); for (const [id] of SUBS[n.id] || []) inCatalog.add(n.id + '/' + id); }
  for (const [surface, target] of Object.entries(SURFACE_TARGETS)) assert.ok(inCatalog.has(target), surface + ' -> ' + target + ' is not in catalog.mjs');
  assert.deepEqual([...SPACE_IDS], NAV.map((n) => n.id));
});
