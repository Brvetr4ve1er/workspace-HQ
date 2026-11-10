// Brief act-in-place, main side (dashboard/brief-act.js) with fakes for every effect. Placeholder data only (public repo).
//   node --test dashboard/brief-act.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { KEYS } from './brief-act-core.mjs';

const require = createRequire(import.meta.url);
const { create, init } = require('./brief-act.js');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ANCHOR = '2026-10-01T08:30:00.000Z', LAST = '2026-11-10T11:10:00.000Z';
const PLANTED_NAME = 'PLANTED_PROJECT_NAME', PLANTED_TITLE = 'PLANTED_CHAT_TITLE', PLANTED_SUM = 'PLANTED_AMOUNT_4242';
const item = (key, rule, action = { kind: 'go', tab: 'tasks' }) => ({ key, rule, severity: 'med', text: PLANTED_NAME + ' ' + rule, why: 'why', source: 's', age: 'now', action, count: 0 });
const ITEMS = [
  item(KEYS.questRed('wq:abc'), 'quest-red'),
  item(KEYS.moneyStale('acc-1', ANCHOR), 'money-stale', { kind: 'go', tab: 'money', sub: 'today' }),
  item(KEYS.sessionWaiting('sess-1', LAST), 'session-waiting', { kind: 'go', tab: 'claude', sub: 'sessions' }),
  item('dirty:proj-a:12', 'dirty', { kind: 'go', tab: 'projects', projectId: 'proj-a' }),
];
const makeBrief = (items = ITEMS) => ({ v: 1, generatedAt: new Date(NOW).toISOString(), items, more: 0, overflow: [], standing: [], errors: [] });
const SOURCES = {
  redQuests: [{ id: 'wq:abc', title: PLANTED_NAME }],
  staleAccounts: [{ id: 'acc-1', name: PLANTED_NAME, anchorAt: ANCHOR }],
  waitingSessions: [{ id: 'sess-1', lastAt: LAST, title: PLANTED_TITLE }],
};

function rig(o = {}) {
  const calls = { applyDone: [], moneyApply: [], openFolder: [], useMark: [], appLog: [], onActed: 0, getBrief: 0, sources: 0 };
  let brief = o.brief || makeBrief();
  let clock = NOW;
  const deps = {
    getBrief: async () => { calls.getBrief++; return typeof brief === 'function' ? brief(calls.getBrief) : brief; },
    sources: async () => { calls.sources++; return o.sources === undefined ? SOURCES : o.sources; },
    applyDone: o.applyDone || (async (ids) => { calls.applyDone.push(ids); return true; }),
    moneyApply: o.moneyApply || (async (i) => { calls.moneyApply.push(i); return { view: {}, note: PLANTED_NAME + ' confirmed ' + PLANTED_SUM }; }),
    openFolder: o.openFolder || (async (id) => { calls.openFolder.push(id); return { ok: true }; }),
    useMark: (s, a) => { calls.useMark.push([s, a]); return { ok: true }; },
    appLog: (l) => calls.appLog.push(l),
    onActed: () => { calls.onActed++; },
    now: () => clock,
  };
  const a = create(deps);
  return { a, calls, setBrief: (b) => { brief = b; }, tick: (ms) => { clock += ms; } };
}
const logsClean = (calls) => { for (const l of calls.appLog) assert.doesNotMatch(l, /PLANTED|wq:|acc-1|sess-1|proj-a|2026|\d{4}/i, l); };
const ask = (key, verb, value) => ({ key, verb, ...(value === undefined ? {} : { value }) });

test('quest-done: applyDone is called once, with the id of the matched record; the row is marked', async () => {
  const r = rig();
  const out = await r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.applyDone, [['wq:abc']]);
  assert.equal(out.acted.verb, 'quest-done');
  assert.equal(out.acted.at, new Date(NOW).toISOString());
  assert.deepEqual(r.calls.moneyApply, []); assert.deepEqual(r.calls.openFolder, []);
  assert.equal(r.calls.onActed, 1, 'the brief is told to re-decorate');
  logsClean(r.calls);
});

test('a double click calls applyDone once (the in-flight guard), and a click after the marker is refused too', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const calls = [];
  const r = rig({ applyDone: async (ids) => { calls.push(ids); await gate; return true; } });
  const first = r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  const second = r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  assert.match((await second).error, /already working/);
  release();
  assert.equal((await first).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(r.a._inflight(), 0, 'the guard is released');
  assert.match((await r.a.act(ask('quest-red:wq:abc', 'quest-done'))).error, /already done/);
  assert.equal(calls.length, 1);
});

test('the guard is per key: another key is not blocked, and a refused call releases its key', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ applyDone: async () => { await gate; return true; } });
  const slow = r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  const other = await r.a.act(ask('session-waiting:sess-1:' + LAST, 'open-folder'));
  assert.equal(other.ok, true);
  assert.match((await r.a.act(ask('quest-red:wq:abc', 'confirm-balance', '5'))).error, /already working/);
  release(); await slow;
  assert.match((await r.a.act(ask('quest-red:nope', 'quest-done'))).error, /not on the brief/);
  assert.equal(r.a._inflight(), 0);
});

test('confirm-balance: moneyApply gets account-save {id, balance} and nothing else', async () => {
  const r = rig();
  const out = await r.a.act(ask('money-stale:acc-1:' + ANCHOR, 'confirm-balance', '2 500,50'));
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.moneyApply, [{ type: 'account-save', id: 'acc-1', balance: '2 500,50' }]);
  assert.deepEqual(Object.keys(r.calls.moneyApply[0]).sort(), ['balance', 'id', 'type']);
  assert.deepEqual(r.calls.applyDone, []);
  assert.equal(out.acted.verb, 'confirm-balance');
  assert.equal(JSON.stringify(out).includes(PLANTED_SUM), false, 'the money note never travels back');
  logsClean(r.calls);
});

test('confirm-balance: a bad balance never reaches money; money’s own refusal is passed on and nothing is marked', async () => {
  const r = rig();
  for (const bad of [undefined, '', -3, '-3', NaN, 'abc']) assert.ok((await r.a.act(ask('money-stale:acc-1:' + ANCHOR, 'confirm-balance', bad))).error, String(bad));
  assert.deepEqual(r.calls.moneyApply, []);
  const refused = rig({ moneyApply: async () => ({ error: 'balance needs a number above 0.' }) });
  const out = await refused.a.act(ask('money-stale:acc-1:' + ANCHOR, 'confirm-balance', '10'));
  assert.deepEqual(out, { error: 'balance needs a number above 0.' });
  assert.deepEqual(refused.a._acted(), {});
  assert.equal(refused.calls.onActed, 0);
  assert.deepEqual(refused.calls.useMark, []);
});

test('commit: returns open:commit with the item’s own project and performs nothing', async () => {
  const r = rig();
  const out = await r.a.act(ask('dirty:proj-a:12', 'commit'));
  assert.deepEqual(out, { ok: true, open: 'commit', projectId: 'proj-a' });
  for (const k of ['applyDone', 'moneyApply', 'openFolder']) assert.deepEqual(r.calls[k], [], k);
  assert.deepEqual(r.a._acted(), {}, 'commit is the overlay’s job; the row is not marked done');
  assert.equal(r.calls.onActed, 0);
  assert.equal(r.calls.sources, 1, 'sources are read but not needed');
});

test('open-folder: asks only for the board’s own session, once; the row is not marked', async () => {
  const r = rig();
  const out = await r.a.act(ask('session-waiting:sess-1:' + LAST, 'open-folder'));
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(r.calls.openFolder, ['sess-1']);
  assert.deepEqual(r.a._acted(), {});
  // the sessions board's own refusal (a folder that is gone) is shown as it is
  const gone = rig({ openFolder: async () => ({ error: 'that folder no longer exists' }) });
  assert.deepEqual(await gone.a.act(ask('session-waiting:sess-1:' + LAST, 'open-folder')), { error: 'that folder no longer exists' });
  const threw = rig({ openFolder: async () => { throw new Error('boom'); } });
  assert.match((await threw.a.act(ask('session-waiting:sess-1:' + LAST, 'open-folder'))).error, /boom/);
});

test('every refusal writes nothing and logs nothing with a name', async () => {
  const cases = [
    ask('quest-red:forged', 'quest-done'),                                   // not on the brief
    ask('quest-red:wq:abc', 'confirm-balance', '10'),                        // a verb of another rule
    ask('quest-red:wq:abc', 'push'),                                         // no such verb
    ask('quest-red:wq:abc', 'quest-done', '5'),                              // a value on a verb that takes none
    ask('session-waiting:sess-1:' + LAST, 'quest-done'),
    { key: 7, verb: 'quest-done' }, { verb: 'quest-done' }, null, 'x', [],
    ask('x'.repeat(300), 'quest-done'),
  ];
  const r = rig();
  for (const c of cases) assert.ok((await r.a.act(c)).error, JSON.stringify(c));
  for (const k of ['applyDone', 'moneyApply', 'openFolder', 'useMark']) assert.deepEqual(r.calls[k], [], k);
  assert.equal(r.calls.onActed, 0);
  assert.deepEqual(r.a._acted(), {});
  logsClean(r.calls);
  // a forged verb name is never echoed into the log
  const forged = rig();
  await forged.a.act(ask('quest-red:wq:abc', '__proto__'));
  assert.ok(forged.calls.appLog.every((l) => !l.includes('__proto__')), forged.calls.appLog.join('|'));
});

test('a key whose source record is gone is refused (the live records, not the brief, decide)', async () => {
  const r = rig({ sources: { redQuests: [], staleAccounts: [], waitingSessions: [] } });
  assert.match((await r.a.act(ask('quest-red:wq:abc', 'quest-done'))).error, /no longer matches/);
  assert.deepEqual(r.calls.applyDone, []);
  const none = rig({ sources: null });
  assert.match((await none.a.act(ask('quest-red:wq:abc', 'quest-done'))).error, /live records/);
  const broke = create({ getBrief: async () => makeBrief(), sources: async () => { throw new Error('x'); }, applyDone: async () => true });
  assert.match((await broke.act(ask('quest-red:wq:abc', 'quest-done'))).error, /live records/);
});

test('re-checked in flight: if the brief moves between the first read and the effect, nothing is performed', async () => {
  const moved = rig({ brief: (n) => (n === 1 ? makeBrief() : makeBrief([ITEMS[1]])) });   // the second read no longer has the quest
  const out = await moved.a.act(ask('quest-red:wq:abc', 'quest-done'));
  assert.match(out.error, /changed while you clicked/);
  assert.deepEqual(moved.calls.applyDone, []);
  assert.deepEqual(moved.a._acted(), {});
  const down = create({ getBrief: async () => { throw new Error('x'); }, sources: async () => SOURCES, applyDone: async () => { throw new Error('must not run'); } });
  assert.match((await down.act(ask('quest-red:wq:abc', 'quest-done'))).error, /brief could not be read/);
});

test('applyDone throwing is an error, not a mark; a no-op (false) is still a clean done', async () => {
  const bad = rig({ applyDone: async () => { throw new Error('disk full'); } });
  assert.match((await bad.a.act(ask('quest-red:wq:abc', 'quest-done'))).error, /could not mark it done — disk full/);
  assert.deepEqual(bad.a._acted(), {});
  assert.equal(bad.a._inflight(), 0);
  const noop = rig({ applyDone: async () => false });   // already done in the overrides: applyDone returns false
  assert.equal((await noop.a.act(ask('quest-red:wq:abc', 'quest-done'))).ok, true);
});

test('the use log gets one brief-act / act mark per successful action, and only that', async () => {
  const r = rig();
  await r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  await r.a.act(ask('session-waiting:sess-1:' + LAST, 'open-folder'));
  await r.a.act(ask('dirty:proj-a:12', 'commit'));
  await r.a.act(ask('quest-red:forged', 'quest-done'));
  assert.deepEqual(r.calls.useMark, [['brief-act', 'act'], ['brief-act', 'act'], ['brief-act', 'act']]);
  // the app log keeps the rule id and the verb: fixed vocabulary, no name, id, path or amount
  assert.ok(r.calls.appLog.some((l) => /done · quest-red · quest-done/.test(l)), r.calls.appLog.join('|'));
  logsClean(r.calls);
});

test('decorate adds the acted marker to the brief, prunes it once the key leaves, and expires it after 24 h', async () => {
  const r = rig();
  await r.a.act(ask('quest-red:wq:abc', 'quest-done'));
  const on = await r.a.decorate(makeBrief());
  assert.deepEqual(on.items[0].acted, { verb: 'quest-done', at: new Date(NOW).toISOString() });
  assert.equal('acted' in on.items[1], false);
  r.tick(2 * 60e3);
  assert.equal((await r.a.decorate(makeBrief())).items[0].acted.verb, 'quest-done');
  // the next scan confirmed it: the key is off the brief, so the marker is pruned
  const gone = await r.a.decorate(makeBrief([ITEMS[1]]));
  assert.equal(gone.items.length, 1);
  assert.deepEqual(r.a._acted(), {});
  // a key that comes back later is a fresh row with no marker
  assert.equal('acted' in (await r.a.decorate(makeBrief())).items[0], false);
  // 24 h cap while the key is still on the brief
  const r2 = rig();
  await r2.a.act(ask('quest-red:wq:abc', 'quest-done'));
  r2.tick(24 * 3600e3 + 1);
  assert.equal('acted' in (await r2.a.decorate(makeBrief())).items[0], false);
});

test('init registers hq:brief:act and the handler never throws at the caller', async () => {
  const handlers = {};
  const a = init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, getBrief: async () => { throw new Error('x'); } });
  assert.deepEqual(Object.keys(handlers), ['hq:brief:act']);
  assert.ok((await handlers['hq:brief:act']({}, { key: 'quest-red:wq:abc', verb: 'quest-done' })).error);
  assert.ok((await handlers['hq:brief:act']({}, undefined)).error);
  assert.equal(typeof a.act, 'function');
  assert.equal(init({}).act !== undefined, true, 'no ipcMain: still returns the api');
});

test('a throwing log, use mark or refresh hook never fails an action', async () => {
  const a = create({
    getBrief: async () => makeBrief(), sources: async () => SOURCES, applyDone: async () => true,
    appLog: () => { throw new Error('log'); }, useMark: () => { throw new Error('use'); }, onActed: () => { throw new Error('tell'); }, now: () => NOW,
  });
  assert.equal((await a.act(ask('quest-red:wq:abc', 'quest-done'))).ok, true);
});
