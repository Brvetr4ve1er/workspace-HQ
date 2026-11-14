// Reach block (Settings): the generic row-action button loop (batch 6, phone-file dish) and the rows around it. Plain Node, a rigged `this`,
// a fake window.hq.reach. Placeholder data only - the repo is public.
//   node --test dashboard-v5/src/vals/reach.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { useLogLogic } from '../logic/use-log.js';
import { reachVals } from './reach.js';
import { resolve } from '../dc/runtime.js';
import reachTpl from '../tpl/reach.tpl.js';

process.env.TZ = 'UTC';
const tick = () => new Promise((r) => setTimeout(r, 10));

const PLAIN = { id: 'user-scope', ok: true, detail: 'registered', who: 'owner' };
const WITH = {
  id: 'brief-file', ok: false, detail: 'off - nothing is written for your phone', step: 'Pick a folder you already sync to your phone', who: 'owner',
  actions: [{ id: 'brief-file-pick', label: 'Pick folder' }, { id: 'brief-file-clear', label: 'Turn off' }],
};

function rig(o = {}) {
  const sent = [], toasts = [], calls = [];
  const reach = o.noReach ? undefined : {
    read: async () => { calls.push(['read']); return { at: '2026-11-14T09:30:00.000Z', rows: o.rows || [PLAIN, WITH] }; },
    briefFile: async (a) => { calls.push(['briefFile', a]); return o.answer ? o.answer(a) : { ok: true, folderName: 'Phone Notes' }; },
  };
  const self = Object.assign(Object.create(useLogLogic), {
    state: { tab: 'home', route: null, sub: {}, settingsOpen: true, rchRows: o.rows || [PLAIN, WITH], rchAt: null, rchError: '', rchBusy: false, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    copy() {},
    hq: { use: (s, a) => { sent.push([s, a]); return { ok: true }; }, ...(reach ? { reach } : {}) },
  });
  self._rchAsked = true;   // the rows are already loaded in these tests
  const vals = () => reachVals.call(self, { S: self.state });
  return { self, sent, toasts, calls, vals };
}

test('a row without actions has no action buttons, and the row keeps every value it had before the loop', () => {
  const { vals } = rig();
  const [plain] = vals().rchRows;
  assert.equal(plain.hasActions, false);
  assert.deepEqual(plain.actions, []);
  assert.deepEqual(
    { id: plain.id, label: plain.label, stateText: plain.stateText, detail: plain.detail, hasNext: plain.hasNext, next: plain.next, hasCopy: plain.hasCopy },
    { id: 'user-scope', label: 'Tools in every Claude session', stateText: 'open', detail: 'registered', hasNext: false, next: '', hasCopy: false });
});

test('actions appear only on the row that carries them, in the order main sent them, labelled in words', () => {
  const { vals } = rig();
  const rows = vals().rchRows;
  assert.deepEqual(rows.map((r) => r.hasActions), [false, true]);
  assert.deepEqual(rows[1].actions.map((a) => [a.id, a.label]), [['brief-file-pick', 'Pick folder'], ['brief-file-clear', 'Turn off']]);
  assert.equal(rows[1].label, 'Phone brief file');
  assert.equal(rows[1].actions[0].aria, 'Pick folder: Phone brief file');
  assert.ok(rows[1].actions.every((a) => typeof a.run === 'function' && a.busy === false));
});

test('an unknown, malformed or prototype action id renders nothing; no top-level vals key was added', () => {
  const bad = { ...WITH, actions: [{ id: 'rm-rf', label: 'Do it' }, { id: '__proto__', label: 'x' }, { id: 'brief-file-pick' }, null, 7, { id: 'brief-file-clear', label: 'Turn off' }] };
  const { vals } = rig({ rows: [bad] });
  assert.deepEqual(vals().rchRows[0].actions.map((a) => a.id), ['brief-file-clear']);
  const noList = rig({ rows: [{ ...WITH, actions: 'nope' }] }).vals().rchRows[0];
  assert.deepEqual([noList.hasActions, noList.actions], [false, []]);
  assert.deepEqual(Object.keys(rig().vals()).sort(), ['rchBusy', 'rchError', 'rchErrorText', 'rchLoading', 'rchOffline', 'rchReady', 'rchRefresh', 'rchRows', 'rchShow', 'rchStaleError', 'rchSummary']);
});

test('the template binds the loop through one nested sc-for, every binding resolves, every handler is a function', () => {
  const { vals } = rig();
  const v = vals();
  const r = v.rchRows[1];
  const scope = { ...v, r, ra: r.actions[0] };
  assert.match(reachTpl, /<sc-for list="\{\{ r\.actions \}\}" as="ra" hint-placeholder-count="2">/);
  const block = /<sc-if value="\{\{ r\.hasActions \}\}"[\s\S]*?<\/sc-for><\/span><\/sc-if>/.exec(reachTpl)[0];
  assert.match(reachTpl, /<!-- v5: Reach row actions/);
  for (const m of block.matchAll(/\{\{\s*([A-Za-z0-9_.!]+)\s*\}\}/g)) {
    const b = m[1].replace(/^!/, '');
    assert.notEqual(resolve(scope, b), undefined, 'unbound ' + b);
  }
  assert.equal(typeof resolve(scope, 'ra.run'), 'function');
  // outside the block the template is what it was: no other mention of the loop variable
  assert.equal((reachTpl.replace(block, '').match(/\bra\./g) || []).length, 0);
  assert.ok(!reachTpl.includes('`'));
});

test('a click calls hq.reach once with the mapped argument, re-reads the rows, toasts, and sends one act mark', async () => {
  const { self, vals, calls, sent, toasts } = rig();
  const [pick, clear] = vals().rchRows[1].actions;
  pick.run();
  await tick();
  assert.deepEqual(calls.filter((c) => c[0] === 'briefFile'), [['briefFile', 'pick']]);
  assert.ok(calls.some((c) => c[0] === 'read'), 'the rows are read again');
  assert.deepEqual(sent, [['reach', 'act']]);
  assert.deepEqual(toasts, [['success', 'Saved: Phone Notes']]);
  assert.equal(self.state.rchBusy, false);
  clear.run();
  await tick();
  assert.deepEqual(calls.filter((c) => c[0] === 'briefFile').map((c) => c[1]), ['pick', 'clear']);
  assert.deepEqual(sent, [['reach', 'act'], ['reach', 'act']], 'one act per click that took effect');
});

test('a note in the answer is the toast; a cancelled dialog says nothing, marks nothing and reads nothing', async () => {
  const a = rig({ answer: () => ({ ok: true, folderName: null, fileLeft: true, note: 'Turned off. The file already written stays where it is.' }) });
  a.vals().rchRows[1].actions[1].run();
  await tick();
  assert.deepEqual(a.toasts, [['success', 'Turned off. The file already written stays where it is.']]);
  const c = rig({ answer: () => ({ error: 'canceled', canceled: true }) });
  c.vals().rchRows[1].actions[0].run();
  await tick();
  assert.deepEqual([c.toasts, c.sent, c.calls.filter((x) => x[0] === 'read').length], [[], [], 0]);
});

test('a refused or throwing answer toasts the reason, marks nothing, and never throws into the click', async () => {
  const r = rig({ answer: () => ({ error: 'That folder is inside the app repo' }) });
  r.vals().rchRows[1].actions[0].run();
  await tick();
  assert.deepEqual(r.toasts, [['error', 'That folder is inside the app repo']]);
  assert.deepEqual(r.sent, []);
  const t = rig({ answer: () => { throw new Error('ipc closed'); } });
  assert.doesNotThrow(() => t.vals().rchRows[1].actions[0].run());
  await tick();
  assert.deepEqual(t.toasts, [['error', 'ipc closed']]);
  assert.deepEqual(t.sent, []);
  assert.equal(t.self.state.rchBusy, false, 'busy is cleared');
});

test('a second click while one is running is ignored; with no hq.reach method nothing happens', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const { self, vals, calls } = rig({ answer: () => gate.then(() => ({ ok: true, folderName: 'Phone Notes' })) });
  const [pick] = vals().rchRows[1].actions;
  const first = pick.run();
  assert.equal(vals().rchRows[1].actions[0].busy, true, 'the buttons are disabled while it runs');
  assert.equal(await pick.run(), false);
  release(); await first;
  assert.equal(calls.filter((c) => c[0] === 'briefFile').length, 1);
  const none = rig({ noReach: true });
  assert.equal(await none.self.rchAct({ api: 'briefFile', arg: 'pick' }), false);
  assert.equal(await self.rchAct({ api: 'nonexistent', arg: 'x' }), false);
  assert.equal(await self.rchAct(null), false);
});
