// node --test dashboard-v5/src/logic/decision-parity.test.mjs
// One order for "what needs you": Home reads the Brief items in Brief order, and the Ctrl+Alt+X palette's Needs-you rows (and the tray) come from
// tray-brief.view() over brief-project's projection, in the same brief-core order. decide().briefOrder is the one function the Home side exposes,
// so this fails if the two ever disagree. Placeholder data only (the repo is public).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decide } from './decision.mjs';
import { projectBrief, refOf } from '../../../dashboard/brief-project.mjs';

const require = createRequire(import.meta.url);
const trayBrief = require('../../../dashboard/tray-brief.js');

const NOW = new Date('2026-11-14T10:00:00.000Z');
const it = (key, severity, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity, text: 'Placeholder ' + key, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 }, extra || {});
const go = (tab, extra) => Object.assign({ kind: 'go', tab }, extra || {});

// brief-core's order: severity first, then the rule order; a group row, a scan row, a project row and a quest row all appear
const ITEMS = [
  it('scan-failed:2026-11-14T08:00:00Z', 'high', { kind: 'scan' }),
  it('secrets:proj-a:2', 'high', go('projects', { projectId: 'proj-a' }), { count: 1 }),
  it('dirty:proj-b:12', 'low', go('projects', { projectId: 'proj-b' }), { count: 2, group: { n: 3, sinceAt: null, listAction: go('projects', { sub: 'grid' }) } }),
];
const brief = (items, extra) => Object.assign({ v: 1, generatedAt: NOW.toISOString(), items, overflow: [], standing: [], more: 0, errors: [], quiet: null }, extra || {});

async function tray(b) {
  const t = trayBrief.create({ now: () => NOW });
  await t.ready;
  t.set(b);
  return t.view();
}

test('the Home order, the projection order and the tray/palette rows are the same list', async () => {
  const b = brief(ITEMS);
  const home = decide({ briefItems: b.items, open: [] }).briefOrder.map(refOf);
  const projected = projectBrief(b, { now: NOW }).items.map((x) => x.ref);
  const rows = (await tray(b)).rows.map((x) => x.ref);
  assert.equal(home.length, 3);
  assert.deepEqual(home, projected);
  assert.deepEqual(home, rows);
});

test('the same holds with a different top row, with one row, with none, and when Home also has tasks', async () => {
  const swapped = [ITEMS[1], ITEMS[0], ITEMS[2]];
  for (const items of [swapped, [ITEMS[2]], [], ITEMS.slice(0, 2)]) {
    const b = brief(items);
    const open = [{ id: 't1', proj: 'proj-a' }, { id: 't2', proj: 'proj-b' }];
    const home = decide({ briefItems: b.items, open }).briefOrder.map(refOf);
    assert.deepEqual(home, projectBrief(b, { now: NOW }).items.map((x) => x.ref));
    assert.deepEqual(home, (await tray(b)).rows.map((x) => x.ref));
  }
});

test('rows with no key (or not an object) are dropped by the projection and left out of briefOrder alike', async () => {
  const bad = [{ no: 'key' }, null, it('ok:proj-a:1', 'med', go('projects', { projectId: 'proj-a' }))];
  const b = brief(bad.concat(ITEMS.slice(0, 1)));
  const projected = projectBrief(b, { now: NOW }).items.map((x) => x.ref);
  const home = decide({ briefItems: b.items, open: [] }).briefOrder.map(refOf);
  assert.deepEqual(home, projected);
});

test('following the Brief never reorders the Brief: the card order and the Brief order are independent lists', () => {
  const open = [{ id: 't1', proj: 'proj-x' }, { id: 't2', proj: 'proj-a' }];
  const d = decide({ briefItems: ITEMS, open });
  // the lead is the scan row (names no project): the ranker top stays on the card, and the Brief keys keep their order
  assert.equal(d.mode, 'ranker');
  assert.deepEqual(d.briefOrder, ITEMS.map((x) => x.key));
  const d2 = decide({ briefItems: [ITEMS[1], ITEMS[0], ITEMS[2]], open });
  assert.equal(d2.mode, 'follows-brief');
  assert.equal(d2.next.id, 't2');
  assert.deepEqual(d2.briefOrder, [ITEMS[1], ITEMS[0], ITEMS[2]].map((x) => x.key));
});
