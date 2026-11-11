// Home › "Where today went", renderer side: logic/today.js + vals/today.js + tpl/today.tpl.js on a rigged component.
//   node --test dashboard-v5/src/logic/today.test.mjs
// Pins: tdy-prefixed keys, every template binding exists in the vals, nothing is read at boot or off Home, ONE read per arrival (re-armed
// when Home is left), stepping back at most 6 days with disabled arrows at both ends, honest no-bridge / loading / error / stale states,
// project names stay on screen and fall back to "project N", one 'today-ribbon' usage mark while a ribbon shows, no "hours worked" wording.
// Placeholder names and ids only (public repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayLogic, dayLabel, laneLabel, twinLines, needsRead, clampOffset, TDY_TITLE, TDY_EVERY_MS, TDY_TODAY_FRESH_MS, TDY_PAST_FRESH_MS } from './today.js';
import { todayVals } from '../vals/today.js';
import tpl from '../tpl/today.tpl.js';
import { emptyToday } from '../live/today-slice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const settle = () => new Promise((res) => setTimeout(res, 8));

const MODEL = (day = '2026-11-10', over = {}) => ({
  ok: true, day, isToday: true, nowMin: 600, dayOffset: 0,
  lanes: [
    { id: 'claude-1', kind: 'claude', ref: 'code:alpha', state: 'ok', blocks: 3 },
    { id: 'claude-2', kind: 'claude', ref: 'code:unknown', state: 'ok', blocks: 1 },
    { id: 'browser', kind: 'browser', state: 'not-kept', note: 'browser lane is kept for 3 days' },
    { id: 'power', kind: 'power', state: 'ok' },
    { id: 'commits', kind: 'commits', state: 'ok' },
  ],
  spans: [
    { lane: 'claude-1', kind: 'block', startMin: 100, endMin: 110 }, { lane: 'claude-2', kind: 'block', startMin: 300, endMin: 305 },
    { lane: 'power', kind: 'awake', startMin: 0, endMin: 300 }, { lane: 'power', kind: 'asleep', startMin: 300, endMin: 450 }, { lane: 'power', kind: 'unknown', startMin: 450, endMin: 600 },
  ],
  ticks: [{ lane: 'commits', min: 200, count: 2 }],
  caption: '4 five-minute blocks with Claude across 2 projects, 2 commits, PC asleep 2 h 30 m',
  counts: { claudeBlocks: 4, claudeProjects: 2, commits: 2, asleepMinutes: 150, browserMinutes: null },
  notes: ['browser lane is kept for 3 days'],
  ...over,
});

function rig(o = {}) {
  const reads = [], marks = [], projectsCalls = [];
  const today = emptyToday();
  for (const [k, v] of Object.entries(o.days || {})) { today.days[k] = { model: v, at: o.at ?? Date.now() }; today.loaded = true; }
  Object.assign(today.errors, o.errors || {});
  today.revision = 1;
  const self = Object.assign(Object.create(todayLogic), {
    state: { tab: 'home', route: null, ...(o.state || {}) },
    LIVE: { today },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    useMark: (id, a) => marks.push([id, a]),
    hq: o.noBridge ? null : { today: { read: () => {} }, claudeHub: o.noNames ? undefined : { projects: async () => { projectsCalls.push(1); if (o.namesFail) throw new Error('hub down'); return [{ id: 'code:alpha', name: 'alpha-site' }, { id: 'code:beta', name: 'beta-app' }]; } } },
    store: { refreshToday: (off, opts) => { reads.push([off, !!(opts && opts.force)]); return Promise.resolve({ ok: true }); } },
  });
  const vals = (extra) => todayVals.call(self, { S: self.state, LIVE: self.LIVE, live: o.live !== false, ...(extra || {}) });
  return { self, vals, reads, marks, projectsCalls, today, done: () => self.tdyRearm() };
}

test('every key is tdy-prefixed in every state, and the frozen "off" constant is frozen', () => {
  const states = [rig({ state: { tab: 'claude' } }), rig({ noBridge: true }), rig(), rig({ errors: { 0: 'boom' } }), rig({ days: { 0: MODEL() } }), rig({ days: { 0: MODEL() }, errors: { 0: 'boom' } })];
  for (const r of states) {
    const v = r.vals();
    for (const k of Object.keys(v)) assert.match(k, /^tdy[A-Z]/, k);
    r.done();
  }
  assert.ok(Object.isFrozen(rig({ state: { tab: 'claude' } }).vals()));
});

test('every binding in the template exists in the vals, including the fields of each loop item', () => {
  const r = rig({ days: { 0: MODEL() } });
  const v = r.vals();
  const bound = tpl.replace(/hint-placeholder-val="[^"]*"/g, '');
  const loops = new Map([...bound.matchAll(/<sc-for list="\{\{\s*([A-Za-z0-9_.]+)\s*\}\}" as="(\w+)"/g)].map((m) => [m[2], m[1]]));
  const all = [...bound.matchAll(/\{\{\s*([A-Za-z0-9_.!]+)\s*\}\}/g)].map((m) => m[1].replace(/^!/, ''));
  let n = 0;
  for (const b of all) {
    const [head, ...rest] = b.split('.');
    if (loops.has(head)) {
      const list = v[loops.get(head)];
      assert.ok(Array.isArray(list) && list.length > 0, 'loop ' + head + ' has nothing to check');
      assert.ok(rest[0] in list[0], 'item of ' + loops.get(head) + ' lacks ' + rest[0]);
    } else assert.ok(head in v, 'template binds ' + head + ' but vals has none');
    n++;
  }
  assert.ok(n >= 40, 'only ' + n + ' bindings checked');
  assert.match(tpl, /role="img"/);
  assert.match(tpl, /aria-label="\{\{ tdyAria \}\}"/);
  r.done();
});

test('nothing is read at boot or while the owner is anywhere but Home; leaving Home re-arms the read', async () => {
  const off = rig({ state: { tab: 'claude' } });
  off.vals(); off.vals();
  await settle();
  assert.deepEqual([off.reads, off.projectsCalls.length], [[], 0]);
  assert.equal(off.vals().tdyShow, false);
  const old = rig({ live: false });
  old.vals(); await settle();
  assert.deepEqual(old.reads, [], 'an older scan is being viewed: the ribbon is about now, so it stays out');
  const route = rig({ state: { route: 'project' } });
  route.vals(); await settle();
  assert.deepEqual(route.reads, []);
});

test('ONE read per arrival on Home, a fresh read after leaving and coming back, and a 10-minute timer only while Home is open', async () => {
  const r = rig();
  r.vals(); r.vals(); r.vals();
  await settle();
  assert.deepEqual(r.reads, [[0, true]]);
  assert.ok(r.self._tdyTimer, 'the 10-minute refresh is armed');
  assert.equal(TDY_EVERY_MS, 600000);
  r.self.setState({ tab: 'system' });
  r.vals();
  assert.equal(r.self._tdyTimer, null, 'the timer stops when Home is left');
  r.self.setState({ tab: 'home' });
  r.vals(); await settle();
  assert.deepEqual(r.reads, [[0, true], [0, true]]);
  r.done();
});

test('no bridge: an honest offline state, nothing is read, nothing is marked', async () => {
  const r = rig({ noBridge: true });
  const v = r.vals();
  await settle();
  assert.deepEqual([v.tdyShow, v.tdyOffline, v.tdyReady, v.tdyLoading], [true, true, false, false]);
  assert.match(v.tdyOfflineText, /desktop app/);
  assert.deepEqual([r.reads, r.marks], [[], []]);
  assert.equal(v.tdyBackDisabled, true);
});

test('loading before an answer, an error with nothing to show, and the last answer kept with the reason when a refresh fails', async () => {
  const a = rig(); const va = a.vals();
  assert.deepEqual([va.tdyLoading, va.tdyReady, va.tdyHasError], [true, false, false]);
  const b = rig({ errors: { 0: 'the day could not be built: x' } }); const vb = b.vals();
  assert.deepEqual([vb.tdyHasError, vb.tdyLoading, vb.tdyReady], [true, false, false]);
  assert.match(vb.tdyErrorText, /Couldn’t read the day · the day could not be built: x/);
  const c = rig({ days: { 0: MODEL() }, errors: { 0: 'ipc closed' } }); const vc = c.vals();
  assert.deepEqual([vc.tdyReady, vc.tdyHasStale], [true, true]);
  assert.match(vc.tdyStaleText, /ipc closed · showing the last answer/);
  assert.equal(vc.tdyCaption, MODEL().caption);
  for (const r of [a, b, c]) r.done();
});

test('a ready day: the caption in blocks, the picture, one row per lane, a text twin and the lane notes; no "hours"', () => {
  const r = rig({ days: { 0: MODEL() } });
  const v = r.vals();
  assert.equal(v.tdyReady, true);
  assert.equal(v.tdyDayLabel, 'Today');
  assert.equal(v.tdyCaption, '4 five-minute blocks with Claude across 2 projects, 2 commits, PC asleep 2 h 30 m');
  assert.match(v.tdyAria, /^Where today went, Today\. 4 five-minute blocks/);
  assert.equal(v.tdyRows.length, 5);
  assert.equal(v.tdyRects.length, 5);
  assert.deepEqual(v.tdyRects.map((x) => x.fill).slice(0, 2), ['var(--purple)', 'var(--purple)']);
  assert.equal(v.tdyTicks.length, 1);
  assert.equal(v.tdyHasNow, true);
  assert.equal(v.tdyHasFuture, true);
  assert.match(v.tdySvgViewBox, /^0 0 960 \d/);
  assert.deepEqual(v.tdyTwin.map((t) => t.text), [
    'project 1: 3 five-minute blocks', 'project 2: 1 five-minute block', 'browser: browser lane is kept for 3 days',
    'PC: awake 5 h, asleep 2 h 30 m, unknown 2 h 30 m', 'commits: 2 commits',
  ]);
  assert.deepEqual(v.tdyNotes, [{ text: 'browser lane is kept for 3 days' }]);
  assert.equal(v.tdyRows.find((x) => x.label === 'browser').hasNote, true);
  assert.ok(v.tdyLegend.every((g) => /^var\(--/.test(g.color)), 'colour tokens only');
  assert.doesNotMatch(JSON.stringify(v), /hours? (worked|of work)|productive|NaN|undefined/i);
  r.done();
});

test('project names come from the Hub on this screen only; without them the lanes say "project N"; a failed list changes nothing else', async () => {
  const r = rig({ days: { 0: MODEL() } });
  r.vals(); await settle(); await settle();
  assert.equal(r.projectsCalls.length, 1, 'the project list is read once per arrival');
  const v = r.vals();
  assert.deepEqual(v.tdyRows.slice(0, 2).map((x) => x.label), ['alpha-site', 'project 2']);
  assert.equal(v.tdyTwin[0].text, 'alpha-site: 3 five-minute blocks');
  const failed = rig({ days: { 0: MODEL() }, namesFail: true });
  failed.vals(); await settle(); await settle();
  assert.deepEqual(failed.vals().tdyRows.slice(0, 2).map((x) => x.label), ['project 1', 'project 2']);
  assert.equal(failed.vals().tdyReady, true);
  assert.deepEqual(rig({ days: { 0: MODEL() }, noNames: true }).vals().tdyRows[0].label, 'project 1');
  for (const x of [r, failed]) x.done();
});

test('stepping back: one read per day not yet held, arrows disabled at both ends, never past 6 days', async () => {
  const r = rig({ days: { 0: MODEL() } });
  assert.deepEqual([r.vals().tdyBackDisabled, r.vals().tdyForwardDisabled], [false, true]);
  assert.equal(r.self.tdyForward(), false, 'no day after today');
  assert.equal(r.self.tdyBack(), true);
  assert.equal(r.self.state.tdyOffset, 1);
  assert.deepEqual(r.reads.slice(-1)[0], [1, false]);
  const readsAfterOne = r.reads.length;
  assert.equal(r.vals().tdyLoading, true, 'the new day has no answer yet');
  assert.equal(r.vals().tdyDayLabel, 'Yesterday');
  for (let i = 0; i < 5; i++) assert.equal(r.self.tdyBack(), true);
  assert.equal(r.self.state.tdyOffset, 6);
  assert.equal(r.self.tdyBack(), false);
  assert.equal(r.self.state.tdyOffset, 6);
  const v = r.vals();
  assert.deepEqual([v.tdyBackDisabled, v.tdyForwardDisabled], [true, false]);
  assert.match(v.tdyBackLabel, /goes back 7 days/);
  assert.equal(r.reads.length, readsAfterOne + 5);
  assert.equal(r.self.tdyForward(), true);
  assert.equal(r.self.state.tdyOffset, 5);
  r.done();
});

test('a stepped-to day that is already held and fresh is not read again; a stale one is', () => {
  const held = rig({ days: { 0: MODEL(), 1: MODEL('2026-11-09') } });
  held.self.tdyBack();
  assert.deepEqual(held.reads, [], 'yesterday was just read');
  const stale = rig({ days: { 0: MODEL(), 1: MODEL('2026-11-09') }, at: Date.now() - TDY_PAST_FRESH_MS - 1000 });
  stale.self.tdyBack();
  assert.deepEqual(stale.reads, [[1, false]]);
  const now = 1e12;
  assert.equal(needsRead(undefined, 0, now), true);
  assert.equal(needsRead({ model: null, at: now }, 0, now), true);
  assert.equal(needsRead({ model: {}, at: now - TDY_TODAY_FRESH_MS + 1 }, 0, now), false);
  assert.equal(needsRead({ model: {}, at: now - TDY_TODAY_FRESH_MS - 1 }, 0, now), true);
  assert.equal(needsRead({ model: {}, at: now - TDY_TODAY_FRESH_MS - 1 }, 3, now), false, 'a past day is fresh for longer');
  assert.equal(needsRead({ model: {}, at: now - TDY_PAST_FRESH_MS - 1 }, 3, now), true);
});

test('the usage mark: one today-ribbon mark per render while a ribbon shows, none while loading, offline or off Home', () => {
  const shown = rig({ days: { 0: MODEL() } });
  shown.vals();
  assert.deepEqual(shown.marks, [['today-ribbon', undefined]]);
  for (const o of [{ noBridge: true }, {}, { state: { tab: 'claude' } }, { errors: { 0: 'x' } }]) {
    const r = rig(o); r.vals();
    assert.deepEqual(r.marks, [], JSON.stringify(o));
    r.done();
  }
  shown.done();
});

test('the layout is memoized on the slice revision, the day, the width and the names: a second render is the same objects', () => {
  const r = rig({ days: { 0: MODEL() } });
  const a = r.vals(), b = r.vals();
  assert.equal(a.tdyRows, b.tdyRows);
  r.today.revision += 1;
  assert.notEqual(r.vals().tdyRows, a.tdyRows);
  r.done();
});

test('a phone-width window lays the ribbon out at 360 with a 6-hour axis; a right-to-left page mirrors it', () => {
  const r = rig({ days: { 0: MODEL() } });
  globalThis.window = { innerWidth: 375 };
  try {
    const v = r.vals();
    assert.match(v.tdySvgViewBox, /^0 0 360 /);
    assert.deepEqual(v.tdyAxis.map((a) => a.label), ['00', '06', '12', '18', '24']);
    globalThis.window = { innerWidth: 1280 };
    globalThis.document = { documentElement: { dir: 'rtl' } };
    r.today.revision += 1;
    const rtl = r.vals();
    assert.equal(rtl.tdyRows[0].labelAnchor, 'end');
  } finally { delete globalThis.window; delete globalThis.document; r.done(); }
});

test('helpers: day labels, clamping, lane labels, twin sentences', () => {
  assert.deepEqual([dayLabel('2026-11-10', 0), dayLabel('2026-11-09', 1), dayLabel('2026-11-08', 2), dayLabel('2026-11-04', 6), dayLabel('junk', 3)], ['Today', 'Yesterday', 'Sun 8 Nov', 'Wed 4 Nov', '3 days ago']);
  assert.deepEqual([-3, 0, 4, 6, 9, 2.5, 'x', null].map(clampOffset), [0, 0, 4, 6, 6, 0, 0, 0]);
  const names = { 'code:alpha': 'alpha-site-with-a-very-long-name' };
  assert.equal(laneLabel({ kind: 'claude', id: 'claude-1', ref: 'code:alpha', state: 'ok' }, names, 0, 10), 'alpha-sit…');
  assert.equal(laneLabel({ kind: 'claude', id: 'claude-3', ref: 'x', state: 'ok' }, names, 2), 'project 3');
  assert.equal(laneLabel({ kind: 'claude', id: 'claude-1', ref: null, state: 'ok' }, names, 0), 'no project');
  assert.equal(laneLabel({ kind: 'claude', id: 'claude-more', more: 3, state: 'ok' }, names, 8), '+3 more projects');
  assert.equal(laneLabel({ kind: 'claude', id: 'claude', state: 'unavailable' }, names, 0), 'Claude');
  assert.deepEqual(['browser', 'power', 'commits'].map((k) => laneLabel({ kind: k }, null, 0)), ['browser', 'PC', 'commits']);
  assert.equal(laneLabel(null, null, 0), '');
  const t = twinLines({ lanes: [{ id: 'claude', kind: 'claude', state: 'empty', note: 'No Claude turns on this day' }, { id: 'commits', kind: 'commits', state: 'ok' }, { id: 'browser', kind: 'browser', state: 'ok', note: 'browser lane covers only part of this day' }],
    spans: [{ lane: 'browser', kind: 'focus', startMin: 0, endMin: 75 }], ticks: [{ lane: 'commits', min: 5, count: 1 }] }, (l) => l.kind);
  assert.deepEqual(t, ['claude: No Claude turns on this day', 'commits: 1 commit', 'browser: 1 h 15 m of focus (browser lane covers only part of this day)']);
  assert.deepEqual(twinLines(null, () => ''), []);
  assert.equal(TDY_TITLE, 'Where today went');
});

test('the module reads only through store.refreshToday and the Hub project list; it never writes and never touches XP', () => {
  const src = fs.readFileSync(path.join(HERE, 'today.js'), 'utf8');
  assert.deepEqual([...new Set([...src.matchAll(/this\.store\.(\w+)/g)].map((m) => m[1]))].sort(), ['refreshToday']);
  assert.deepEqual([...new Set([...src.matchAll(/api\.(\w+)/g)].map((m) => m[1]))].sort(), ['projects']);
  assert.doesNotMatch(src, /actedOn|\.forget|\.link\(|reindex/);
});

test('honesty: none of the ribbon’s renderer files say "hours worked" or call a block time worked', () => {
  const files = ['logic/today.js', 'logic/today-geometry.mjs', 'vals/today.js', 'tpl/today.tpl.js'].map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8'));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const s of files.map(strip)) assert.doesNotMatch(s, /hours? worked|worked hours|productive|time worked|work(ed)? for \d/i);
});
