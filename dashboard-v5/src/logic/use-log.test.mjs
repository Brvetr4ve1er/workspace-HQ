// Usage marks (hq.use) and the Reach block's loader + vals. Rig in the logic/brief.test.mjs style: a never-mounted object over the real mixin
// and vals, a fake window.hq. Placeholder data only — the repo is public.
//   node --test dashboard-v5/src/logic/use-log.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { useLogLogic } from './use-log.js';
import { reachVals } from '../vals/reach.js';
import reachTpl from '../tpl/reach.tpl.js';

process.env.TZ = 'UTC';

function rig(o = {}) {
  const sent = [], copies = [];
  const self = Object.assign(Object.create(useLogLogic), {
    state: { tab: 'home', route: null, sub: {}, settingsOpen: false, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    copy: (t, m) => copies.push([t, m]),
    hq: o.noBridge ? null : { use: o.use || ((s, a) => { sent.push([s, a]); return { ok: true }; }), ...(o.reach ? { reach: o.reach } : {}) },
  });
  return { self, sent, copies };
}

test('useMark sends once per arrival, again after leaving and coming back', () => {
  const { self, sent } = rig();
  assert.equal(self.useMark('brief-panel'), true);
  assert.equal(self.useMark('brief-panel'), false, 'a re-render of the same screen');
  assert.equal(self.useMark('brief-panel', 'open'), false);
  self.useMark('brief-panel', 'act');                 // a different action is its own mark
  assert.deepEqual(sent, [['brief-panel', 'open'], ['brief-panel', 'act']]);
  self.state = { ...self.state, tab: 'money' };       // leave Home
  self.useArrive();                                   // the navigation hook sees the move
  self.state = { ...self.state, tab: 'home' };        // and come back
  assert.equal(self.useMark('brief-panel'), true);
  assert.equal(self.useMark('brief-panel'), false);
  assert.equal(sent.length, 3);
});

test('a screen change seen by useMark itself does not double-send when didUpdate runs after the render', () => {
  const { self, sent } = rig({ state: { tab: 'claude', sub: { claude: 'chats' } } });
  self.useArrive();
  self.state = { ...self.state, sub: { claude: 'sessions' } };
  assert.equal(self.useMark('sessions-board'), true);   // the render shows the new screen first
  self.useArrive();                                      // then didUpdate notices the move
  assert.equal(self.useMark('sessions-board'), false, 'same arrival');
  assert.deepEqual(sent, [['sessions-board', 'open']]);
  self.state = { ...self.state, sub: { claude: 'chats' } };
  self.useArrive();
  self.state = { ...self.state, sub: { claude: 'sessions' } };
  assert.equal(self.useMark('sessions-board'), true, 'back on Sessions is a new arrival');
  assert.equal(sent.length, 2);
});

test('a route (a project page) is its own screen', () => {
  const { self, sent } = rig();
  self.useMark('brief-panel');
  self.state = { ...self.state, route: { projectId: 'alpha-site' } };
  self.useArrive();
  self.state = { ...self.state, route: null };
  self.useMark('brief-panel');
  assert.equal(sent.length, 2);
});

test('nothing without hq.use: no throw, no mark remembered, and a bridge that arrives later still counts', () => {
  const none = rig({ noBridge: true });
  assert.equal(none.self.useMark('brief-panel'), false);
  none.self.hq = {};                                   // an old preload without use()
  assert.equal(none.self.useMark('brief-panel'), false);
  const later = [];
  none.self.hq = { use: (s, a) => { later.push([s, a]); } };
  assert.equal(none.self.useMark('brief-panel'), true);
  assert.deepEqual(later, [['brief-panel', 'open']]);
});

test('a throwing or rejecting hq.use never reaches the caller', async () => {
  const a = rig({ use: () => { throw new Error('ipc closed'); } });
  assert.doesNotThrow(() => a.self.useMark('reach'));
  const b = rig({ use: () => Promise.reject(new Error('refused')) });
  assert.doesNotThrow(() => b.self.useMark('reach'));
  await new Promise((r) => setTimeout(r, 5));          // an unhandled rejection would fail the run here
});

test('Reach loader: reads once per opening, keeps old rows when a refresh fails, marks the arrival and the copy', async () => {
  const rows = [{ id: 'bridge', ok: false, detail: 'not paired', step: 'Pair it', who: 'owner' }];
  let reads = 0, mode = 'ok';
  const reach = { read: async () => { reads++; if (mode === 'fail') throw new Error('read failed'); return { at: '2026-11-07T09:30:00.000Z', rows }; } };
  const { self, sent, copies } = rig({ reach, state: { settingsOpen: true } });
  self.rchEnsure(); self.rchEnsure();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(reads, 1);
  assert.deepEqual(sent, [['reach', 'open']]);
  assert.deepEqual(self.state.rchRows, rows);
  assert.equal(self.state.rchBusy, false);
  mode = 'fail';
  await self.rchLoad();
  assert.deepEqual(self.state.rchRows, rows, 'the previous rows stay');
  assert.match(self.state.rchError, /read failed/);
  mode = 'ok';
  await self.rchLoad();
  assert.equal(self.state.rchError, '');
  self.rchCopy('claude remote-control');
  assert.deepEqual(copies, [['claude remote-control', 'Copied']]);
  assert.deepEqual(sent.at(-1), ['reach', 'copy']);
  self.rchRearm(); self.rchEnsure();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(reads, 4, 'reopening Settings reads again');
  const none = rig({ noBridge: true });
  assert.equal(await none.self.rchLoad(), false);
});

test('reachVals: offline · loading · error · rows with open, closed and unknown said in words', async () => {
  const R = (self) => reachVals.call(self, { S: self.state });
  const off = rig({ noBridge: true, state: { settingsOpen: true } });
  const vOff = R(off.self);
  assert.equal(vOff.rchOffline, true); assert.equal(vOff.rchReady, false);

  const rows = [
    { id: 'phone-door', ok: false, detail: 'not running since boot at 07:12', step: 'Start it in a terminal that stays open', who: 'owner', copy: 'claude remote-control' },
    { id: 'user-scope', ok: true, detail: 'registered', who: 'owner' },
    { id: 'tray-icon', ok: null, detail: 'unknown — no entry', who: 'owner' },
  ];
  const reach = { read: async () => ({ at: '2026-11-07T09:30:00.000Z', rows }) };
  const { self, copies } = rig({ reach, state: { settingsOpen: true } });
  const v0 = R(self);
  assert.equal(v0.rchLoading, true); assert.equal(v0.rchReady, false);
  await new Promise((r) => setTimeout(r, 10));
  const v = R(self);
  assert.equal(v.rchReady, true); assert.equal(v.rchLoading, false);
  assert.deepEqual(v.rchRows.map((r) => r.stateText), ['closed', 'open', 'unknown']);
  assert.equal(v.rchSummary, '1 of 3 open · checked 09:30');
  assert.equal(v.rchRows[0].next, 'Next: Start it in a terminal that stays open · by you');
  assert.equal(v.rchRows[0].hasCopy, true); assert.equal(v.rchRows[1].hasCopy, false);
  assert.equal(v.rchRows[1].hasNext, false);
  v.rchRows[0].copy();
  assert.equal(copies[0][0], 'claude remote-control');
  assert.equal(v.rchRows[0].label, 'Phone door · Claude remote control');
  // a closed Settings shows nothing and re-arms the loader
  self.state = { ...self.state, settingsOpen: false };
  assert.equal(R(self).rchShow, false);
  assert.equal(self._rchAsked, false);

  const bad = rig({ reach: { read: async () => ({ error: 'registry unreadable' }) }, state: { settingsOpen: true } });
  R(bad.self);
  await new Promise((r) => setTimeout(r, 10));
  const vb = R(bad.self);
  assert.equal(vb.rchError, true); assert.match(vb.rchErrorText, /registry unreadable/); assert.equal(vb.rchReady, false);
});

test('the Reach fragment binds only keys reachVals returns', () => {
  const self = rig({ reach: { read: async () => ({ rows: [] }) } }).self;
  const keys = new Set(Object.keys(reachVals.call(self, { S: self.state })));
  const top = [...reachTpl.matchAll(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g)].map((m) => m[1]);
  const loop = new Set(['r', 'true', 'false']);   // r = the loop variable; true/false = hint-placeholder literals
  for (const k of top) assert.ok(keys.has(k) || loop.has(k), 'unbound template key: ' + k);
  const bound = [...reachTpl.matchAll(/\{\{\s*r\.(\w+)\s*\}\}/g)].map((m) => m[1]);
  const rowKeys = new Set(Object.keys(reachVals.call(rig({ reach: { read() {} }, state: { rchRows: [{ id: 'bridge', ok: true, detail: 'x', who: 'owner' }] } }).self, { S: { rchRows: [{ id: 'bridge', ok: true, detail: 'x', who: 'owner' }] } }).rchRows[0]));
  for (const k of bound) assert.ok(rowKeys.has(k), 'unbound row key: ' + k);
  assert.match(reachTpl, /<!-- v5: Reach/);
  assert.ok(!reachTpl.includes('`'));
});

test('a hidden window is not an arrival: the mark waits for the first show, and a screen change meanwhile drops it', () => {
  const listeners = [];
  const doc = { visibilityState: 'hidden', addEventListener: (t, f) => { if (t === 'visibilitychange') listeners.push(f); } };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = doc;
  const show = () => { doc.visibilityState = 'visible'; for (const f of listeners) f(); };
  try {
    const a = rig();
    assert.equal(a.self.useMark('brief-panel'), false, 'hidden: not marked');
    assert.equal(a.self.useMark('brief-panel'), false, 'and a re-render while hidden stays quiet');
    assert.deepEqual(a.sent, []);
    show();
    assert.deepEqual(a.sent, [['brief-panel', 'open']], 'the first real show sends it once');
    assert.equal(a.self.useMark('brief-panel'), false, 'already counted for this arrival');
    // hidden again (tray), a reload re-renders Home, nobody looks: nothing new
    doc.visibilityState = 'hidden';
    a.self.state = { ...a.self.state, tab: 'money' }; a.self.useArrive();
    a.self.state = { ...a.self.state, tab: 'home' };
    assert.equal(a.self.useMark('brief-panel'), false);
    a.self.state = { ...a.self.state, tab: 'claude' };   // the owner is elsewhere when the window shows
    a.self.useArrive();
    show();
    assert.equal(a.sent.length, 1, 'the pending Home mark is dropped, not sent for the wrong screen');
    assert.equal(a.self.useMark('sessions-board'), true, 'a visible page marks straight away');
  } finally {
    if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document;
  }
});
