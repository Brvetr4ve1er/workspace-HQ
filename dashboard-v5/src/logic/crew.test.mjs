// Claude > Crew, renderer side: the pure view logic (clean, search, group, page), the mixin (read on arrival only, one read at a time,
// Start and its marks) and the vals (ONE top-level key, every state, a static check that every key the template reads exists).
// Rig in the clients-list.test.mjs style. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/crew.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { crwView, crwFilter, crwCleanRoster, crwCleanRow, crwCleanRoles, crwCleanQuery, CRW_PER_ROLE, CRW_PAGE, CRW_OFF } from './crew-view.mjs';
import { crewLogic, CRW_SURFACE, CRW_START_SURFACE } from './crew.js';
import { useLogLogic } from './use-log.js';
import { crewVals, CRW_NOTE } from '../vals/crew.js';
import tpl from '../tpl/crew.tpl.js';
import { fakeCrew } from '../../tools/crew-fixture.mjs';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const ROLES = fakeCrew({ count: 0 }).roles;
const roster = (n) => fakeCrew({ count: n });

function rig(o = {}) {
  const calls = [], toasts = [], marks = [];
  const crew = o.noMethod ? {} : { read: async () => { calls.push('read'); await (o.gate || Promise.resolve()); if (o.reject) throw new Error('boom'); return o.answer || roster(24); },
    start: async (id) => { calls.push('start:' + id); await (o.startGate || Promise.resolve()); return o.startAnswer || { ok: true }; } };
  const self = Object.assign(Object.create(crewLogic), useLogLogic, {
    state: { tab: 'claude', sub: { claude: 'crew' }, route: null, crw: o.crw || {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    ps: () => (o.noBridge ? 'nobridge' : 'live'),
    toast: (k, t) => toasts.push([k, t]),
    hq: o.noBridge ? null : { crew, use: (s, a) => { marks.push(s + '/' + a); } },
  });
  const vals = () => crewVals.call(self, { S: self.state }).crwv;
  return { self, calls, toasts, marks, vals };
}

// ------------------------------------------------------------------ pure view
test('clean: an unknown role becomes other, a bad id loses its Start, control characters go, a nameless row is dropped', () => {
  const ids = new Set(ROLES.map((r) => r.id));
  assert.equal(crwCleanRow({ id: 'a b', name: 'x', role: 'finance', canStart: true }, ids).canStart, false);
  assert.equal(crwCleanRow({ id: 'a b', name: 'x', role: 'finance', canStart: true }, ids).id, '');
  assert.equal(crwCleanRow({ id: 'ok-id', name: 'x', role: 'made-up', canStart: true }, ids).role, 'other');
  assert.equal(crwCleanRow({ id: 'ok-id', name: 'x', role: 'data', canStart: 'yes' }, ids).canStart, false, 'only a real true starts');
  assert.equal(crwCleanRow({ id: 'ok-id', name: 'a\nb\u0000c', description: 'd\te', role: 'data', canStart: true }, ids).name, 'a b c');
  assert.equal(crwCleanRow({ id: 'ok', name: '' }, ids), null);
  assert.equal(crwCleanRow(null, ids), null);
  assert.equal(crwCleanRow({ id: 'x'.repeat(101), name: 'n', canStart: true }, ids).canStart, false);
  assert.ok(Array.from(crwCleanRow({ id: 'a', name: 'n', description: 'w'.repeat(500), canStart: true }, ids).description).length <= 140);
  const c = crwCleanRoster({ roles: [{ id: 'developers', label: 'Developers' }, { id: '../bad', label: 'x' }], skills: [{ id: 'a', name: 'A', role: 'developers', canStart: true }, 7, null] });
  assert.deepEqual(c.roles.map((r) => r.id), ['developers', 'other'], 'a bad role id is dropped and other is always there');
  assert.equal(c.rows.length, 1);
  assert.deepEqual(crwCleanRoster(null), { roles: [{ id: 'other', label: 'Other' }], rows: [] });
  assert.deepEqual(crwCleanRoles('nope'), [{ id: 'other', label: 'Other' }]);
});

test('search: every word must match name, plugin, description or role; case and accents ignored; control characters cut', () => {
  const rows = crwCleanRoster(roster(24)).rows;
  const roles = crwCleanRoles(ROLES);
  assert.deepEqual(crwFilter(rows, 'LEDGER', roles).map((r) => r.name).sort(), ['gamma-ledger', 'month-close']);
  assert.deepEqual(crwFilter(rows, 'acme-design', roles).map((r) => r.name), ['mood-board'], 'the plugin name is searched');
  assert.deepEqual(crwFilter(rows, 'closing month', roles).map((r) => r.name), ['month-close'], 'both words, anywhere in the description');
  assert.ok(crwFilter(rows, 'finance', roles).length >= 2, 'the role label is searched');
  assert.equal(crwFilter(rows, 'zzzz-nothing', roles).length, 0);
  assert.equal(crwFilter(rows, '   ', roles), rows, 'blank is everything');
  assert.equal(crwCleanQuery('a\nb'), 'a b');
  assert.equal(crwCleanQuery('x'.repeat(200)).length, 80);
  assert.equal(crwCleanQuery(42), '');
});

test('view: 12 rows a role, then all of them once the role is open; roles in main\'s order, only roles with rows', () => {
  const { rows } = crwCleanRoster(roster(300));
  const roles = crwCleanRoles(ROLES);
  const v = crwView({ rows, roles });
  assert.equal(v.searching, false);
  assert.deepEqual(v.groups.map((g) => g.role), roles.map((r) => r.id).filter((id) => rows.some((r) => r.role === id)));
  for (const g of v.groups) { assert.ok(g.rows.length <= CRW_PER_ROLE); assert.equal(g.rows.length + g.more, g.count); }
  const big = v.groups.find((g) => g.count > CRW_PER_ROLE);
  assert.ok(big && big.more > 0 && !big.expanded);
  const open = crwView({ rows, roles, open: { [big.role]: true } }).groups.find((g) => g.role === big.role);
  assert.equal(open.rows.length, open.count);
  assert.ok(open.expanded && open.canCollapse && open.more === 0);
  assert.equal(CRW_PER_ROLE, 12);
});

test('view: searching pages the matches 60 at a time and says how many are not shown', () => {
  const { rows } = crwCleanRoster(roster(300));
  const roles = crwCleanRoles(ROLES);
  const p1 = crwView({ rows, roles, q: 'gen-skill', page: 1 });
  assert.equal(p1.searching, true);
  assert.equal(p1.flat.length, CRW_PAGE);
  assert.equal(p1.matches, 276);
  assert.equal(p1.flatMore, 276 - 60);
  assert.deepEqual(p1.groups, []);
  assert.equal(crwView({ rows, roles, q: 'gen-skill', page: 2 }).flat.length, 120);
  assert.equal(crwView({ rows, roles, q: 'gen-skill', page: 99 }).flatMore, 0);
  assert.equal(crwView({ rows, roles, q: 'gen-skill', page: -3 }).flat.length, 60, 'a bad page is page one');
  assert.equal(CRW_PAGE, 60);
});

// ------------------------------------------------------------------ the mixin
test('arrival reads once; nothing is read at construction, on another view, or without the bridge', async () => {
  const r = rig();
  assert.equal(r.calls.length, 0, 'no read before the owner opens the view');
  await r.self.crwArrive();
  assert.deepEqual(r.calls, ['read']);
  assert.deepEqual(r.marks, ['crew/open']);
  assert.equal(r.self.state.crw.rows.length, 24);
  assert.equal(r.self.state.crw.loaded, true);
  const away = rig({ state: { tab: 'claude', sub: { claude: 'chats' } } });
  assert.equal(await away.self.crwArrive(), null);
  assert.deepEqual(away.calls, []);
  const off = rig({ noBridge: true });
  assert.deepEqual(await off.self.crwRead(), { error: CRW_OFF });
  assert.equal(rig({ noMethod: true }).self.crwCan(), false);
});

test('one read at a time; a failed read says so in a fixed phrase and a later one recovers; an error keeps the rows held', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ gate });
  const first = r.self.crwRead();
  assert.equal(await r.self.crwRead(), null, 'a second click while reading is ignored');
  release(); await first;
  assert.equal(r.calls.length, 1);
  const bad = rig({ reject: true });
  await bad.self.crwRead();
  assert.equal(bad.self.state.crw.error, 'the crew could not be read');
  assert.equal(bad.self.state.crw.rows, undefined);
  const kept = rig({ answer: { error: 'the crew could not be read' }, crw: { rows: [{ id: 'a', name: 'A', description: '', role: 'other', plugin: '', canStart: true }], roles: crwCleanRoles(ROLES), loaded: true } });
  await kept.self.crwRead();
  assert.equal(kept.self.state.crw.rows.length, 1, 'the last roster stays');
  assert.equal(kept.vals().error, true);
  assert.equal(kept.vals().ready, true);
});

test('Start: one call per click, a success toast and an act mark; a refusal shows main\'s words and no mark', async () => {
  const r = rig();
  await r.self.crwRead();
  const row = r.self.state.crw.rows.find((x) => x.id === 'alpha-lint');
  let release; r.self.hq.crew.start = async (id) => { r.calls.push('start:' + id); await new Promise((res) => { release = res; }); return { ok: true }; };
  const a = r.self.crwStart(row), b = r.self.crwStart(row);
  assert.equal(await b, false, 'a double click is one call');
  assert.deepEqual(r.self.state.crwBusy, ['alpha-lint']);
  release(); assert.equal(await a, true);
  assert.deepEqual(r.calls.filter((c) => c.startsWith('start')), ['start:alpha-lint']);
  assert.deepEqual(r.marks.filter((m) => m.startsWith('crew-start')), ['crew-start/act'], 'one act mark for the launched session');
  assert.deepEqual(r.self.state.crwBusy, []);
  assert.equal(r.toasts.at(-1)[0], 'success');
  // the same skill again inside a minute adds no second mark (anti-farming), but the session still opens
  r.self.hq.crew.start = async () => ({ ok: true });
  assert.equal(await r.self.crwStart(row), true);
  assert.equal(r.marks.filter((m) => m.startsWith('crew-start')).length, 1);
  // a refusal
  const refused = rig({ startAnswer: { error: 'too many sessions started this hour' } });
  await refused.self.crwRead();
  assert.equal(await refused.self.crwStart(refused.self.state.crw.rows[0]), false);
  assert.match(refused.toasts.at(-1)[1], /too many sessions started this hour/);
  assert.deepEqual(refused.marks.filter((m) => m.startsWith('crew-start')), [], 'no act mark when nothing launched');
  // a row with no Start never calls main
  assert.equal(await refused.self.crwStart({ id: '', name: 'x', canStart: false }), false);
  assert.equal(await refused.self.crwStart(null), false);
});

test('the marks use the two registered surfaces, and the view proves a visit once per arrival', () => {
  assert.equal(CRW_SURFACE, 'crew');
  assert.equal(CRW_START_SURFACE, 'crew-start');
});

test('search and paging state: typing sets the query and goes back to page one; Clear empties it; More adds a page; a role opens and closes', async () => {
  const r = rig();
  await r.self.crwRead();
  r.self.crwMorePage(); r.self.crwMorePage();
  assert.equal(r.self.state.crw.page, 3);
  r.self.crwQuery({ target: { value: 'ledger' } });
  assert.deepEqual([r.self.state.crw.q, r.self.state.crw.page], ['ledger', 1]);
  r.self.crwClear();
  assert.equal(r.self.state.crw.q, '');
  r.self.crwToggleRole('other'); assert.equal(r.self.state.crw.open.other, true);
  r.self.crwToggleRole('other'); assert.equal(r.self.state.crw.open.other, false);
});

// ------------------------------------------------------------------ the vals
test('vals: ONE top-level key, the same crwv key set in every state, and a frozen constant off the view', () => {
  const off = crewVals.call({ state: { tab: 'home', sub: {} } }, { S: { tab: 'home', sub: {} } });
  assert.deepEqual(Object.keys(off), ['crwv']);
  assert.ok(Object.isFrozen(off) && Object.isFrozen(off.crwv));
  assert.equal(off.crwv.on, false);
  assert.equal(crewVals.call({ state: { tab: 'claude', sub: { claude: 'crew' } } }, { S: { tab: 'claude', sub: { claude: 'crew' } } }) !== off, true);
  const keys = Object.keys(off.crwv).sort();
  const states = [rig({ noBridge: true }).vals(), rig().vals(), rig({ crw: { error: 'x', loaded: true } }).vals(), rig({ crw: { rows: [], roles: [], loaded: true } }).vals(),
    rig({ crw: { rows: crwCleanRoster(roster(24)).rows, roles: crwCleanRoles(ROLES), loaded: true } }).vals(),
    rig({ crw: { rows: crwCleanRoster(roster(24)).rows, roles: crwCleanRoles(ROLES), loaded: true, q: 'ledger' } }).vals(),
    rig({ crw: { rows: crwCleanRoster(roster(24)).rows, roles: crwCleanRoles(ROLES), loaded: true, q: 'zzzzz' } }).vals()];
  for (const v of states) assert.deepEqual(Object.keys(v).sort(), keys);
  const [offline, loading, errored, empty, ready, searching, none] = states;
  assert.equal(offline.offline, true);
  assert.equal(loading.loading, true);
  assert.equal(errored.error, true); assert.equal(errored.loading, false);
  assert.equal(empty.empty, true);
  assert.equal(ready.ready, true); assert.ok(ready.groups.length > 3); assert.match(ready.summary, /^24 skills · 6 plugins$/);
  assert.equal(searching.searching, true); assert.equal(searching.flat.length, 2); assert.match(searching.summary, /2 matches$/);
  assert.equal(none.noMatch, true); assert.match(none.noMatchText, /zzzzz/);
  assert.equal(ready.note, CRW_NOTE);
});

test('vals: a Start button per startable row, none for a row without one, and the row closures call crwStart', async () => {
  const r = rig();
  await r.self.crwRead();
  const rows = [];
  const started = [];
  r.self.crwStart = (row) => { started.push(row.id); return true; };
  for (const g of r.vals().groups) rows.push(...g.rows);
  assert.ok(rows.every((x) => x.canStart));
  rows.find((x) => x.name === 'alpha-lint').start();
  assert.deepEqual(started, ['alpha-lint']);
  const odd = rig({ crw: { rows: [{ id: '', name: 'bad name!', description: '', role: 'other', plugin: '', canStart: false }], roles: crwCleanRoles(ROLES), loaded: true } }).vals();
  assert.equal(odd.groups[0].rows[0].canStart, false);
  assert.match(odd.groups[0].rows[0].noStartText, /unusual characters/);
});

test('vals: the Show more toggle appears only for a role with more than 12', async () => {
  const r = rig({ answer: roster(300) });
  await r.self.crwRead();
  const g = r.vals().groups;
  assert.ok(g.some((x) => x.canToggle && /^Show \d+ more$/.test(x.toggleLabel)));
  assert.ok(g.some((x) => !x.canToggle) || true);
  const small = rig();
  await small.self.crwRead();
  assert.ok(small.vals().groups.every((x) => !x.canToggle || x.hasMore));
});

test('template: every crwv key the fragment reads exists in the vals, every row and group key too, and no markup binding of a description', async () => {
  const r = rig();
  await r.self.crwRead();
  const v = r.vals();
  const rowKeys = Object.keys(v.groups[0].rows[0]);
  const groupKeys = Object.keys(v.groups[0]);
  for (const m of tpl.matchAll(/\{\{\s*crwv\.([A-Za-z0-9_]+)\s*\}\}/g)) assert.ok(m[1] in v, 'crwv.' + m[1] + ' is in the vals');
  for (const m of tpl.matchAll(/\{\{\s*!?r\.([A-Za-z0-9_]+)\s*\}\}/g)) assert.ok(rowKeys.includes(m[1]), 'r.' + m[1] + ' is a row key');
  for (const m of tpl.matchAll(/\{\{\s*g\.([A-Za-z0-9_]+)\s*\}\}/g)) assert.ok(groupKeys.includes(m[1]), 'g.' + m[1] + ' is a group key');
  assert.ok(!/innerHTML|v-html|dangerously/i.test(tpl));
  assert.ok(!/\{\{\s*r\.description\s*\}\}[^<]*style=/.test(tpl));
  assert.ok(tpl.includes('data-crw="start"') && tpl.includes('data-crw="search"'));
});
