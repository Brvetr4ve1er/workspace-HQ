// The Brief in the tray (dashboard/tray-brief.js). Placeholder names only (public repo).
//   node --test dashboard/tray-brief.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create, routeOf, refOf } = require('./tray-brief.js');
const { refOf: projRef } = await import('./brief-project.mjs');

const MIN = 60e3, H = 3600e3;
const NOW = new Date(2026, 10, 7, 14, 10, 0);               // local 14:10 — the tray prints local time
const GEN = new Date(2026, 10, 7, 14, 5, 0);                // the brief's own 14:05
const it = (rule, severity, key, o = {}) => ({ key, rule, severity, text: 'NAMED ' + key, why: 'WHY', source: 'scan', age: 'scan 2 h ago', action: { kind: 'go', tab: 'projects' }, count: 0, ...o });
const SECRETS = it('secrets', 'high', 'secrets:proj-id-7731:2', { text: 'Zorblax Prime has 2 secrets', action: { kind: 'go', tab: 'projects', projectId: 'proj-id-7731' } });
const BLOOD = it('pc-blood', 'high', 'pc-blood:cpu', { action: { kind: 'go', tab: 'system', sub: 'machine' } });
const QUEST = it('quest-red', 'high', 'quest-red:q-4410', { text: 'Fix the Frobnicator', action: { kind: 'go', tab: 'tasks' } });
const CI = it('ci-red', 'med', 'ci-red:owner/alpha-site:2026-11-06T00:00:00Z', { count: 3, action: { kind: 'go', tab: 'projects', sub: 'github' } });
const PR = it('review-waiting', 'low', 'review-waiting:2026-11-05T00:00:00Z', { count: 1, action: { kind: 'go', tab: 'projects', sub: 'github' } });
const SCAN = it('scan-failed', 'high', 'scan-failed:2026-11-07T10:00:00Z', { action: { kind: 'scan' } });
const brief = (items, o = {}) => ({ v: 1, generatedAt: GEN.toISOString(), items, overflow: [], more: 0, errors: [], ...o });
const seenAgo = (keys, ms) => Object.fromEntries(keys.map((k) => [k, { first: new Date(NOW.getTime() - ms).toISOString(), last: NOW.toISOString() }]));

async function make(b, firstSeen, o = {}) {
  const calls = { log: [], show: [] };
  const tb = create({ log: (f) => calls.log.push(f), now: () => NOW, ...o });
  await tb.ready;
  if (b !== undefined) tb.set(b, firstSeen);
  return { tb, calls, show: (r) => calls.show.push(r) };
}

test('before any brief: "Brief not ready yet", today\'s level line below, no rows, no tooltip of its own', async () => {
  const { tb } = await make();
  const v = tb.view();
  assert.equal(v.status, 'not-ready');
  assert.equal(v.statusLine, 'Brief not ready yet');
  assert.equal(v.showLevel, true);
  assert.deepEqual(v.rows, []);
  assert.equal(v.overflow, null);
  assert.equal(tb.tooltip(), null);
  const before = create({});   // the projection module not loaded yet: still an honest object, never a throw
  assert.equal(before.view().status, 'not-ready');
});

test('items: "Needs you · 3 · 1 new · 14:05", three rows, tooltip "3 need you · 1 new"', async () => {
  const b = brief([SECRETS, BLOOD, QUEST]);
  const { tb } = await make(b, seenAgo([SECRETS.key], 2 * H));
  const v = tb.view();
  assert.equal(v.status, 'ok');
  assert.equal(v.statusLine, 'Needs you · 3 · 1 new · 14:05');
  assert.equal(v.noteLine, null);
  assert.equal(v.showLevel, false);
  assert.equal(v.rows.length, 3);
  assert.equal(v.rows[0].label, 'urgent · new · A project has secrets in plain sight');
  assert.equal(v.rows[1].label, 'urgent · The PC reports something critical');
  assert.equal(v.overflow, null);
  assert.equal(tb.tooltip(), 'WorkspaceHQ — 3 need you · 1 new');
});

test('no new items: no "new" part; one item reads "1 needs you"', async () => {
  const { tb } = await make(brief([SECRETS]), seenAgo([SECRETS.key], 3 * 24 * H));
  assert.equal(tb.view().statusLine, 'Needs you · 1 · 14:05');
  assert.equal(tb.tooltip(), 'WorkspaceHQ — 1 needs you');
});

test('the day-one case: three standing highs plus a ci-red item and a waiting PR put them on the overflow line', async () => {
  const b = brief([SECRETS, BLOOD, QUEST], { overflow: [CI, PR], more: 4 });
  const { tb } = await make(b, seenAgo([CI.key], H));
  const v = tb.view();
  assert.equal(v.rows.length, 3);
  assert.equal(v.overflow.label, '+4 more · CI failing on 4 repos · 2 pull requests waiting');
  assert.equal(v.total, 7);
  assert.equal(v.statusLine, 'Needs you · 7 · 1 new · 14:05');
  assert.equal(tb.tooltip(), 'WorkspaceHQ — 7 need you · 1 new');
});

test('never more than 3 rows, even from a brief with more items; labels and tooltip stay inside their limits', async () => {
  const many = Array.from({ length: 6 }, (_, i) => it('quest-red', 'high', 'quest-red:q' + i, { count: 400 }));
  const { tb } = await make(brief(many, { more: 9 }));
  const v = tb.view();
  assert.equal(v.rows.length, 3);
  for (const r of v.rows) assert.ok([...r.label].length <= 64, r.label);
  assert.ok([...v.overflow.label].length <= 64);
  assert.ok(tb.tooltip().length <= 127);
  // a long "when you can · new · …" row is clipped with an ellipsis
  const { tb: t2 } = await make(brief([it('dirty', 'low', 'dirty:p:12', { count: 999999 })]), seenAgo(['dirty:p:12'], H));
  const label = t2.view().rows[0].label;
  assert.equal([...label].length, 64);
  assert.ok(label.endsWith('…'));
});

test('empty brief: "Nothing needs you · from the 14:05 brief"', async () => {
  const { tb } = await make(brief([]));
  const v = tb.view();
  assert.equal(v.status, 'empty');
  assert.equal(v.statusLine, 'Nothing needs you · from the 14:05 brief');
  assert.deepEqual(v.rows, []);
  assert.equal(tb.tooltip(), 'WorkspaceHQ — nothing needs you');
});

test('errors: items keep their header and gain a note; an empty brief with errors does not claim "nothing needs you"', async () => {
  const errs = [{ source: 'github', error: 'data/github.json is partial' }, { source: 'github', error: 'dup' }];
  const { tb } = await make(brief([SECRETS], { errors: errs }), seenAgo([SECRETS.key], 3 * 24 * H));
  const v = tb.view();
  assert.equal(v.statusLine, 'Needs you · 1 · 14:05');
  assert.equal(v.noteLine, "Brief incomplete · couldn't read github");
  assert.equal(v.status, 'incomplete');
  const { tb: t2 } = await make(brief([], { errors: [{ source: 'github', error: 'x' }, { source: 'vercel', error: 'x' }, { source: 'claude-code', error: 'x' }] }));
  const v2 = t2.view();
  assert.equal(v2.statusLine, "Brief incomplete · couldn't read github, vercel and 1 more");
  assert.equal(v2.noteLine, null);
  assert.equal(t2.tooltip(), 'WorkspaceHQ — brief incomplete');
});

test('stale: older than 30 min says "from the HH:MM brief"; exactly 30 min does not', async () => {
  const old = new Date(NOW.getTime() - 31 * MIN);
  const { tb } = await make(brief([SECRETS], { generatedAt: old.toISOString() }), seenAgo([SECRETS.key], 3 * 24 * H));
  assert.equal(tb.view().statusLine, 'Needs you · 1 · from the 13:39 brief');
  const edge = new Date(NOW.getTime() - 30 * MIN);
  const { tb: t2 } = await make(brief([SECRETS], { generatedAt: edge.toISOString() }), seenAgo([SECRETS.key], 3 * 24 * H));
  assert.equal(t2.view().statusLine, 'Needs you · 1 · 13:40');
});

test('the tooltip carries the same honest state as the menu header: stale says from HH:MM, a partial brief says incomplete', async () => {
  const old = new Date(NOW.getTime() - 31 * MIN);
  const { tb } = await make(brief([SECRETS], { generatedAt: old.toISOString() }), seenAgo([SECRETS.key], 3 * 24 * H));
  assert.equal(tb.tooltip(), 'WorkspaceHQ — 1 needs you · from 13:39');
  const { tb: t2 } = await make(brief([SECRETS], { errors: [{ source: 'github', error: 'x' }] }), seenAgo([SECRETS.key], 3 * 24 * H));
  assert.equal(t2.tooltip(), 'WorkspaceHQ — 1 needs you · incomplete');
  const { tb: t3 } = await make(brief([], { generatedAt: old.toISOString() }));
  assert.equal(t3.tooltip(), 'WorkspaceHQ — nothing needs you · from 13:39');
  assert.ok(t3.tooltip().length <= 127);
});

test('without a firstSeen map the tray stamps keys itself: new now, not new a day later, gone keys forgotten', async () => {
  let t = NOW;
  const { tb } = await make(undefined, undefined, { now: () => t });
  tb.set(brief([SECRETS, BLOOD]));
  assert.equal(tb.view().newCount, 2);
  t = new Date(NOW.getTime() + 25 * H);
  assert.equal(tb.view().newCount, 0);
  tb.set(brief([SECRETS, BLOOD, QUEST]));
  assert.equal(tb.view().newCount, 1);
});

test('open(ref): a row maps back to the item\'s FULL action and calls showMainAt with its route', async () => {
  const b = brief([SECRETS, BLOOD, QUEST], { overflow: [CI] , more: 1 });
  const { tb, calls, show } = await make(b);
  const rows = tb.view().rows;
  assert.equal(tb.open(rows[0].ref, show), 'go');
  assert.deepEqual(calls.show[0], { tab: 'projects', projectId: 'proj-id-7731' });   // the full action, project id and all
  assert.equal(tb.open(rows[1].ref, show), 'go');
  assert.deepEqual(calls.show[1], { tab: 'system', sub: 'machine' });
  assert.equal(tb.open(refOf(CI.key), show), 'go');                                   // an overflow item is reachable too
  assert.deepEqual(calls.show[2], { tab: 'projects', sub: 'github' });
  assert.equal(refOf(SECRETS.key), projRef(SECRETS.key));                             // the same ref the projection hands out
  assert.equal(calls.show.length, 3);
});

test('open(ref): a scan item returns "scan" and opens nothing; unknown, forged and stale refs do nothing', async () => {
  const { tb, calls, show } = await make(brief([SCAN, SECRETS]));
  const scanRef = tb.view().rows[0].ref;
  assert.equal(tb.view().rows[0].scan, true);
  assert.equal(tb.open(scanRef, show), 'scan');
  assert.equal(calls.show.length, 0);
  for (const bad of ['', 'zzzzzzzzzzzz', '0123456789ab', null, undefined, 42, '../../etc/passwd', refOf(SECRETS.key).toUpperCase()]) assert.equal(tb.open(bad, show), 'none', String(bad));
  const old = tb.view().rows[1].ref;
  tb.set(brief([SCAN]));   // the item is gone from the current brief
  assert.equal(tb.open(old, show), 'none');
  assert.equal(tb.open(old, undefined), 'none');
  assert.equal(calls.show.length, 0);
});

test('open(ref): logs once per click with only the surface and the rule id — no names; a throwing log or missing showMainAt is harmless', async () => {
  const { tb, calls, show } = await make(brief([SECRETS, SCAN]));
  const [a, s] = tb.view().rows;
  tb.open(a.ref, show);
  tb.open(s.ref, show);
  assert.deepEqual(calls.log, [{ surface: 'tray-brief', rule: 'secrets' }, { surface: 'tray-brief', rule: 'scan-failed' }]);
  assert.ok(!JSON.stringify(calls.log).includes('Zorblax') && !JSON.stringify(calls.log).includes('proj-id'));
  tb.open('0123456789ab', show);
  assert.equal(calls.log.length, 2);
  const { tb: bad } = await make(brief([SECRETS]), undefined, { log: () => { throw new Error('disk full'); } });
  assert.equal(bad.open(bad.view().rows[0].ref, undefined), 'go');
  assert.equal(bad.open(bad.view().rows[0].ref, show), 'go');
});

test('the view and tooltip carry no names, project ids or why text', async () => {
  const { tb } = await make(brief([SECRETS, BLOOD, QUEST], { overflow: [CI, PR], more: 4, errors: [{ source: 'github', error: 'C:/secret/path' }] }));
  const s = JSON.stringify(tb.view()) + tb.tooltip();
  for (const x of ['Zorblax', 'Frobnicator', 'proj-id-7731', 'q-4410', 'alpha-site', 'WHY', 'NAMED', 'C:/secret']) assert.ok(!s.includes(x), x);
});

test('onChange fires once the projection module loads, only if a brief was already waiting', async () => {
  let n = 0;
  const tb = create({ now: () => NOW, onChange: () => { n++; } });
  tb.set(brief([SECRETS]));
  await tb.ready;
  assert.equal(n, 1);
  const tb2 = create({ now: () => NOW, onChange: () => { n++; } });
  await tb2.ready;
  assert.equal(n, 1);
});

test('set(garbage) keeps the tray honest; routeOf only passes well-formed routes', async () => {
  const { tb } = await make(null);
  assert.equal(tb.view().status, 'not-ready');
  tb.set('nope'); assert.equal(tb.view().status, 'not-ready');
  tb.set({ items: [null, 5, { key: 'k' }], overflow: 'x', more: 'y', generatedAt: 'bad' });
  assert.doesNotThrow(() => tb.view());
  assert.deepEqual(routeOf({ kind: 'go', tab: 'money', sub: 'today' }), { tab: 'money', sub: 'today' });
  assert.equal(routeOf({ kind: 'go', tab: '../x' }), null);
  assert.equal(routeOf({ kind: 'scan' }), null);
  assert.deepEqual(routeOf({ kind: 'go', tab: 'projects', sub: 'A B', projectId: 'bad id!' }), { tab: 'projects' });
});

test('standing: the view carries only the count and the date line, no row for it, and the tooltip is unchanged', async () => {
  const STD = it('dirty', 'low', 'dirty:proj-id-7731:12', { text: 'Zorblax Prime has 12 uncommitted files', since: new Date(2026, 10, 5, 12, 0, 0).toISOString() });
  const { tb } = await make(brief([SECRETS], { standing: [STD] }), seenAgo([SECRETS.key], 2 * H));
  const v = tb.view();
  assert.equal(v.standingLine, '1 standing since 5 Nov');
  assert.equal(v.rows.length, 1, 'a standing item is not a row');
  assert.equal(v.total, 1, 'and not in the total');
  assert.ok(!JSON.stringify(v).includes('Zorblax') && !JSON.stringify(v).includes('proj-id-7731'));
  assert.equal(tb.tooltip(), 'WorkspaceHQ — 1 needs you · 1 new');
  const none = (await make(brief([SECRETS]), seenAgo([SECRETS.key], 2 * H))).tb.view();
  assert.equal(none.standingLine, null);
});
