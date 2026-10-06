// Tests for the pure live-state reducer (live-core.mjs) and the thin hq
// wiring over it (live.js). live.js touches no DOM, so its guard behavior —
// the actual point of B2 — is testable here under plain `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, initialState, OUTPUT_CAP } from './live-core.mjs';
import { initLive, get, getOutput, on, _reset } from './live.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- live-core

test('initialState returns the empty live shape, fresh objects each call', () => {
  const s = initialState();
  assert.deepEqual(s, { sessions: [], machine: null, browser: null, outputs: {} });
  assert.notEqual(initialState(), s);
  assert.notEqual(initialState().outputs, s.outputs);
});

test('applyEvent never mutates the input state (deep-frozen input survives)', () => {
  const s = initialState();
  s.sessions = [{ jobId: 'a', status: 'running' }];
  s.outputs = { a: 'hello' };
  Object.freeze(s.sessions[0]); Object.freeze(s.sessions);
  Object.freeze(s.outputs); Object.freeze(s);
  assert.doesNotThrow(() => {
    applyEvent(s, { type: 'sessions', sessions: [] });
    applyEvent(s, { type: 'machine', machine: { cpu: 9, ram: 40, servers: 0 } });
    applyEvent(s, { type: 'browser', browser: { url: 'x' } });
    applyEvent(s, { type: 'session-output', jobId: 'a', chunk: 'more' });
  });
  assert.deepEqual(s.outputs, { a: 'hello' });
  assert.equal(s.sessions.length, 1);
});

test('sessions event replaces the list; non-array payload → []; null state → from initial', () => {
  const one = [{ jobId: 'a', label: 'claude', status: 'running' }];
  const s1 = applyEvent(initialState(), { type: 'sessions', sessions: one });
  assert.deepEqual(s1.sessions, one);
  assert.deepEqual(applyEvent(s1, { type: 'sessions', sessions: 'garbage' }).sessions, []);
  const fromNull = applyEvent(null, { type: 'sessions', sessions: one });
  assert.deepEqual(fromNull.sessions, one);
  assert.deepEqual(fromNull.outputs, {});
});

test('machine and browser events fill their slots; browser can go back to null', () => {
  let s = applyEvent(initialState(), { type: 'machine', machine: { cpu: 12, ram: 55, servers: 1 } });
  assert.deepEqual(s.machine, { cpu: 12, ram: 55, servers: 1 });
  s = applyEvent(s, { type: 'browser', browser: { url: 'https://x.test', title: 'X' } });
  assert.equal(s.browser.title, 'X');
  s = applyEvent(s, { type: 'browser', browser: null });
  assert.equal(s.browser, null);
  assert.deepEqual(s.machine, { cpu: 12, ram: 55, servers: 1 }); // untouched
});

test('session-output appends per jobId without crossing buffers', () => {
  let s = initialState();
  s = applyEvent(s, { type: 'session-output', jobId: 'a', chunk: 'one' });
  s = applyEvent(s, { type: 'session-output', jobId: 'a', chunk: 'two' });
  s = applyEvent(s, { type: 'session-output', jobId: 'b', chunk: 'three' });
  assert.equal(s.outputs.a, 'onetwo');
  assert.equal(s.outputs.b, 'three');
});

test('output buffers even for a jobId not (yet) in the sessions list', () => {
  const s = applyEvent(initialState(), { type: 'session-output', jobId: 'ghost', chunk: 'early' });
  assert.equal(s.outputs.ghost, 'early');
});

test('ring buffer caps at OUTPUT_CAP=64000 chars, keeping the tail', () => {
  assert.equal(OUTPUT_CAP, 64000);
  let s = applyEvent(initialState(), { type: 'session-output', jobId: 'a', chunk: 'x'.repeat(OUTPUT_CAP - 10) });
  s = applyEvent(s, { type: 'session-output', jobId: 'a', chunk: 'y'.repeat(30) });
  assert.equal(s.outputs.a.length, OUTPUT_CAP);
  assert.ok(s.outputs.a.endsWith('y'.repeat(30)));
  assert.ok(s.outputs.a.startsWith('x'));
  // a single oversized chunk is sliced to its own last OUTPUT_CAP chars
  const big = 'z'.repeat(OUTPUT_CAP + 5990) + 'ENDMARK123';
  const s2 = applyEvent(initialState(), { type: 'session-output', jobId: 'b', chunk: big });
  assert.equal(s2.outputs.b.length, OUTPUT_CAP);
  assert.ok(s2.outputs.b.endsWith('ENDMARK123'));
});

test('a non-string chunk is coerced, not dropped', () => {
  const s = applyEvent(initialState(), { type: 'session-output', jobId: 'a', chunk: 42 });
  assert.equal(s.outputs.a, '42');
});

test('malformed events return the SAME state reference (no phantom emits)', () => {
  const s = applyEvent(initialState(), { type: 'session-output', jobId: 'a', chunk: 'x' });
  assert.equal(applyEvent(s, { type: 'nope' }), s);
  assert.equal(applyEvent(s, null), s);
  assert.equal(applyEvent(s, {}), s);
  assert.equal(applyEvent(s, 'sessions'), s);
  assert.equal(applyEvent(s, { type: 'session-output', chunk: 'no-job' }), s);
  assert.equal(applyEvent(s, { type: 'session-output', jobId: '', chunk: 'x' }), s);
  assert.equal(applyEvent(s, { type: 'session-output', jobId: 'a', chunk: null }), s);
  assert.equal(applyEvent(s, { type: 'session-output', jobId: 'a', chunk: '' }), s);
});

test('sessions event prunes buffers for jobs gone from the list, keeps the rest', () => {
  let s = initialState();
  s = applyEvent(s, { type: 'session-output', jobId: 'a', chunk: 'aaa' });
  s = applyEvent(s, { type: 'session-output', jobId: 'b', chunk: 'bbb' });
  s = applyEvent(s, { type: 'sessions', sessions: [{ jobId: 'a', status: 'done' }] });
  assert.deepEqual(s.outputs, { a: 'aaa' });
});

test('a jobId named "constructor" gets a clean own buffer (no prototype walk)', () => {
  const s = applyEvent(initialState(), { type: 'session-output', jobId: 'constructor', chunk: 'boo' });
  assert.equal(s.outputs.constructor, 'boo');
});

// ------------------------------------------------------------------ live.js

test('initLive is a silent no-op on missing hq / missing methods (dev harness)', () => {
  _reset();
  assert.doesNotThrow(() => initLive(undefined));
  _reset();
  assert.doesNotThrow(() => initLive({}));
  assert.deepEqual(get(), initialState());
  _reset();
  // onSessionOutput absent (lands with B3) — the others alone must not throw
  assert.doesNotThrow(() => initLive({ onClaudeSessions() {}, onMachine() {}, onBrowserTab() {} }));
});

test('initLive subscribes exactly once — a second call is a no-op', () => {
  _reset();
  let subs = 0;
  const hq = { onClaudeSessions: () => { subs++; return () => {}; } };
  initLive(hq);
  initLive(hq);
  assert.equal(subs, 1);
});

test('pushes land in get()/getOutput(); on() notifies; the unsubscribe stops it', () => {
  _reset();
  const cbs = {};
  const hq = {
    onClaudeSessions: (cb) => { cbs.sessions = cb; return () => {}; },
    onMachine:        (cb) => { cbs.machine = cb; return () => {}; },
    onBrowserTab:     (cb) => { cbs.browser = cb; return () => {}; },
    onSessionOutput:  (cb) => { cbs.output = cb; return () => {}; },
  };
  initLive(hq);
  let notified = 0;
  const off = on(() => notified++);
  cbs.sessions([{ jobId: 'j1', status: 'running' }]);
  cbs.machine({ cpu: 3, ram: 60, servers: 2 });
  cbs.browser({ url: 'https://live.test' });
  cbs.output({ jobId: 'j1', chunk: 'hi' });
  assert.equal(get().sessions[0].jobId, 'j1');
  assert.equal(get().machine.cpu, 3);
  assert.equal(get().browser.url, 'https://live.test');
  assert.equal(getOutput('j1'), 'hi');
  assert.equal(notified, 4);
  off();
  cbs.output({ jobId: 'j1', chunk: '!' });
  assert.equal(notified, 4);
  assert.equal(getOutput('j1'), 'hi!');
});

test('a broken listener does not break the others', () => {
  _reset();
  const cbs = {};
  initLive({ onMachine: (cb) => { cbs.machine = cb; return () => {}; } });
  let ok = 0;
  on(() => { throw new Error('bad listener'); });
  on(() => ok++);
  assert.doesNotThrow(() => cbs.machine({ cpu: 1, ram: 1, servers: 0 }));
  assert.equal(ok, 1);
});

test('seeds apply via getSessions/getBrowserLive when no push arrived yet', async () => {
  _reset();
  initLive({
    getSessions: async () => [{ jobId: 'seeded', status: 'running' }],
    getBrowserLive: async () => ({ url: 'https://seed.test' }),
  });
  await flush();
  assert.equal(get().sessions[0].jobId, 'seeded');
  assert.equal(get().browser.url, 'https://seed.test');
});

test('a push that already arrived wins over a late seed reply', async () => {
  _reset();
  let resolveSeed;
  const cbs = {};
  initLive({
    onClaudeSessions: (cb) => { cbs.sessions = cb; return () => {}; },
    getSessions: () => new Promise((r) => { resolveSeed = r; }),
  });
  cbs.sessions([{ jobId: 'fresh', status: 'running' }]);
  resolveSeed([{ jobId: 'stale', status: 'done' }]);
  await flush();
  assert.equal(get().sessions.length, 1);
  assert.equal(get().sessions[0].jobId, 'fresh');
});

test('a rejecting seed is swallowed', async () => {
  _reset();
  initLive({ getSessions: () => Promise.reject(new Error('no main process')) });
  await flush();
  assert.deepEqual(get().sessions, []);
});

test('getOutput guards the prototype chain and bad ids', () => {
  _reset();
  assert.equal(getOutput('constructor'), '');
  assert.equal(getOutput('hasOwnProperty'), '');
  assert.equal(getOutput(undefined), '');
  assert.equal(getOutput('never-seen'), '');
});
