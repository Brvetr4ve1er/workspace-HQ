// One click, one mark: the whole path of a Brief verb, end to end, on a temp folder (batch 9, act baseline).
//   renderer batRun (real mixins) -> hq.brief.act -> main brief-act.js (real) -> use-log.js (real) -> app-log.js (real day file in a temp
//   folder) -> tools/use-report.mjs collect + buildReport (real).
// Only the effects behind the verbs (applyDone, money, opening a folder) are fakes. Placeholder data only: the repo is public, and
// nothing here reads the owner's logs, opens a window or starts a process.
//   node --test dashboard/act-trace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { useLogLogic } from '../dashboard-v5/src/logic/use-log.js';
import { briefActLogic } from '../dashboard-v5/src/logic/brief-act.js';
import { KEYS } from './brief-act-core.mjs';
import { collect, buildReport } from '../tools/use-report.mjs';

const require = createRequire(import.meta.url);
const appLogMod = require('./app-log.js');
const useLogMain = require('./use-log.js');
const briefAct = require('./brief-act.js');

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const T0 = new Date(2026, 10, 18, 9, 0, 0).getTime();   // a fixed local morning
const ANCHOR = '2026-10-01T08:30:00.000Z', LAST = new Date(T0 - 600e3).toISOString();

function trace(o = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-act-trace-'));
  let clock = T0;
  const log = appLogMod.create({ appRoot: dir, dir, now: () => new Date(clock), pid: 4242 });
  const mainUse = useLogMain.create({ appLog: log, now: () => clock });
  const n = o.quests || 1;
  const quests = Array.from({ length: n }, (_, i) => ({ id: 'wq:sample-' + i }));
  const items = [
    ...quests.map((q) => ({ key: KEYS.questRed(q.id), rule: 'quest-red', severity: 'med', text: 'a quest', why: 'w', source: 's', age: 'now', action: { kind: 'go', tab: 'tasks' }, count: 0 })),
    { key: KEYS.moneyStale('acc-1', ANCHOR), rule: 'money-stale', severity: 'med', text: 'stale', why: 'w', source: 's', age: 'now', action: { kind: 'go', tab: 'money' }, count: 0 },
    { key: KEYS.sessionWaiting('sess-1', LAST), rule: 'session-waiting', severity: 'med', text: 's', why: 'w', source: 's', age: 'now', action: { kind: 'go', tab: 'claude' }, count: 0 },
    { key: 'dirty:proj-a:12', rule: 'dirty', severity: 'med', text: 'd', why: 'w', source: 's', age: 'now', action: { kind: 'go', tab: 'projects', projectId: 'proj-a' }, count: 0 },
  ];
  const brief = { v: 1, generatedAt: new Date(T0).toISOString(), items, more: 0, overflow: [], standing: [], errors: [] };
  const effects = { applyDone: [], money: [], folder: [] };
  const mainAct = briefAct.create({
    getBrief: async () => brief,
    sources: async () => ({ redQuests: quests, staleAccounts: [{ id: 'acc-1', anchorAt: ANCHOR }], waitingSessions: [{ id: 'sess-1', lastAt: LAST }] }),
    applyDone: async (ids) => { effects.applyDone.push(ids); return true; },
    moneyApply: async (i) => { effects.money.push(i); return { view: {}, note: 'saved' }; },
    openFolder: async (id) => { effects.folder.push(id); return { ok: true }; },
    useMark: (s, a) => mainUse.mark(s, a),
    appLog: () => {},
    now: () => clock,
  });
  const toasts = [], opened = [];
  const self = Object.assign(Object.create(Object.assign({}, useLogLogic, briefActLogic)), {
    state: { tab: 'home', route: null, sub: {} },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    openCommit: async (id) => { opened.push(id); },
    hq: { use: (s, a) => mainUse.mark(s, a), brief: { act: (key, verb, value) => mainAct.act({ key, verb, ...(value === undefined ? {} : { value }) }) } },
  });
  const rowOf = (rule, i = 0) => items.filter((x) => x.rule === rule)[i];
  const report = () => buildReport(collect({ dir, now: () => clock }), [7]).windows[0];
  const count = (surface, action) => { const r = report().rows.find((x) => x.surface === surface); return r ? r[action] : 0; };
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } };
  return { self, rowOf, count, report, effects, opened, toasts, tick: (ms) => { clock += ms; }, cleanup, dir };
}

test('Mark done is one act in the report, however the click travels (renderer and main write it once, not twice)', async () => {
  const t = trace();
  try {
    assert.equal(await t.self.batRun(t.rowOf('quest-red'), 'quest-done'), true);
    assert.deepEqual(t.effects.applyDone, [['wq:sample-0']]);
    assert.equal(t.count('brief-act', 'act'), 1);
    assert.equal(t.count('brief-act', 'handover'), 0);
    assert.equal(t.report().rows.find((r) => r.surface === 'brief-act').actDays, 1);
  } finally { t.cleanup(); }
});

test('the same Mark done twice, inside a minute or later, is still one act: main refuses a repeat while the row is marked done', async () => {
  const t = trace();
  try {
    await t.self.batRun(t.rowOf('quest-red'), 'quest-done');
    t.tick(5e3);
    assert.equal(await t.self.batRun(t.rowOf('quest-red'), 'quest-done'), false, 'the second click is refused');
    t.tick(2 * 60e3);
    assert.equal(await t.self.batRun(t.rowOf('quest-red'), 'quest-done'), false);
    assert.equal(t.effects.applyDone.length, 1);
    assert.equal(t.count('brief-act', 'act'), 1);
  } finally { t.cleanup(); }
});

test('Confirm balance is one act; Commit is one handover and no act; Open its folder marks nothing', async () => {
  const t = trace();
  try {
    t.self.setState({ batBal: '120.50' });
    assert.equal(await t.self.batYes(t.rowOf('money-stale')), true);
    assert.equal(t.count('brief-act', 'act'), 1);
    assert.equal(await t.self.batRun(t.rowOf('dirty'), 'commit'), true);
    assert.deepEqual(t.opened, ['proj-a'], 'the overlay hand-over still happens');
    assert.equal(t.count('brief-act', 'handover'), 1);
    assert.equal(t.count('brief-act', 'act'), 1, 'a hand-over is not an act');
    assert.equal(await t.self.batRun(t.rowOf('session-waiting'), 'open-folder'), true);
    assert.deepEqual(t.effects.folder, ['sess-1']);
    assert.equal(t.count('brief-act', 'act'), 1);
    assert.equal(t.count('brief-act', 'handover'), 1);
    assert.equal(t.report().marks, 2, 'two marks in all: one act, one handover');
  } finally { t.cleanup(); }
});

test('a refused verb leaves nothing in the report', async () => {
  const t = trace();
  try {
    assert.equal(await t.self.batRun({ key: 'quest-red:forged', rule: 'quest-red' }, 'quest-done'), false);
    assert.equal(await t.self.batRun(t.rowOf('quest-red'), 'commit'), false);
    assert.equal(t.report().marks, 0);
  } finally { t.cleanup(); }
});

test('many different rows: each effect is one act and main caps the use channel at 30 a minute', async () => {
  const t = trace({ quests: 35 });
  try {
    for (let i = 0; i < 35; i++) await t.self.batRun(t.rowOf('quest-red', i), 'quest-done');
    assert.equal(t.effects.applyDone.length, 35, 'every row took effect');
    assert.equal(t.count('brief-act', 'act'), useLogMain.PER_MINUTE, 'the day log holds at most 30 in a minute');
    t.tick(61e3);
    await t.self.batRun(t.rowOf('quest-red', 34), 'quest-done');   // already marked done: refused, adds nothing
    assert.equal(t.count('brief-act', 'act'), useLogMain.PER_MINUTE);
  } finally { t.cleanup(); }
});

test('act days are local days: acts a day apart count as two days in the report', async () => {
  const t = trace({ quests: 2 });
  try {
    await t.self.batRun(t.rowOf('quest-red', 0), 'quest-done');
    t.tick(26 * 3600e3);
    await t.self.batRun(t.rowOf('quest-red', 1), 'quest-done');
    const row = t.report().rows.find((r) => r.surface === 'brief-act');
    assert.equal(row.act, 2);
    assert.equal(row.actDays, 2);
  } finally { t.cleanup(); }
});
