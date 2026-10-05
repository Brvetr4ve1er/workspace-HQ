// A reloaded window rebuilds its Activity rows from hq:live-state. These pin the
// scan guard (one pipeline at a time, first end wins), the status payloads, and
// the snapshot shape (clone-safe, dev `since`, cast names from the spellbook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const liveState = require('./live-state.js');

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const BOOK = { spells: [
  { id: 'spell-a', name: 'Spell A', icon: '🔥' },
  { id: 'chain-b', name: 'Chain B', icon: '⛓️' },
] };

function boot({ devServers = new Map(), casts = new Map(), readSpellbook = () => BOOK } = {}) {
  const handlers = new Map();
  const sent = [];
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  let reads = 0;
  const api = liveState.init({
    ipcMain, send: (ch, p) => sent.push([ch, p]), devServers, casts,
    readSpellbook: () => { reads++; return readSpellbook(); },
  });
  return { api, sent, ipc: () => handlers.get('hq:live-state')({}), reads: () => reads };
}

test('idle: nothing running, and the ipc handler answers the snapshot', () => {
  const b = boot();
  const want = { dev: [], casts: [], scan: { state: 'idle', startedAt: null, endedAt: null, code: null } };
  assert.deepEqual(b.ipc(), want);
  assert.deepEqual(b.api.snapshot(), want);
  assert.equal(b.reads(), 0, 'no casts → the spellbook is not read');
});

test('scanBegin guards against a second pipeline and pushes running', () => {
  const b = boot();
  assert.equal(b.api.scanBegin(), true);
  assert.equal(b.api.scanBegin(), false, 'second begin refused while running');
  assert.equal(b.sent.length, 1, 'the refused begin pushes nothing');
  const [ch, p] = b.sent[0];
  assert.equal(ch, 'hq:scan-status');
  assert.deepEqual(Object.keys(p), ['state', 'startedAt']);
  assert.equal(p.state, 'running');
  assert.match(p.startedAt, ISO_RE);
  assert.deepEqual(b.ipc().scan, { state: 'running', startedAt: p.startedAt, endedAt: null, code: null });
});

test('scanEnd(0) → done; a new scan may start after', () => {
  const b = boot();
  b.api.scanBegin();
  const startedAt = b.sent[0][1].startedAt;
  assert.equal(b.api.scanEnd(0), true);
  const [ch, p] = b.sent[1];
  assert.equal(ch, 'hq:scan-status');
  assert.deepEqual({ ...p, endedAt: 'x' }, { state: 'done', startedAt, endedAt: 'x', code: 0 });
  assert.equal('error' in p, false, 'no error key on success');
  assert.match(p.endedAt, ISO_RE);
  assert.deepEqual(b.ipc().scan, { state: 'done', startedAt, endedAt: p.endedAt, code: 0 });
  assert.equal(b.api.scanBegin(), true, 'done is not running');
  assert.deepEqual(b.ipc().scan.endedAt, null, 'a new begin resets the previous end');
  assert.deepEqual(b.ipc().scan.code, null);
});

test('scanEnd non-zero / error → failed with the message; first end wins', () => {
  const b = boot();
  b.api.scanBegin();
  assert.equal(b.api.scanEnd(1, new Error('pipeline exploded')), true);
  assert.deepEqual(
    (({ state, code, error }) => ({ state, code, error }))(b.sent[1][1]),
    { state: 'failed', code: 1, error: 'pipeline exploded' });
  // child_process 'error' then 'close': the late end must not clobber the result
  assert.equal(b.api.scanEnd(0), false);
  assert.equal(b.sent.length, 2);
  assert.equal(b.ipc().scan.state, 'failed');
  // a stray end with no scan running is ignored too
  assert.equal(boot().api.scanEnd(0), false);

  const c = boot();
  c.api.scanBegin();
  c.api.scanEnd(null, 'timed out');   // string errors and a null code (killed)
  assert.deepEqual((({ state, code, error }) => ({ state, code, error }))(c.sent[1][1]), { state: 'failed', code: null, error: 'timed out' });
  const d = boot();
  d.api.scanBegin();
  d.api.scanEnd();   // no code at all → failed, code null
  assert.deepEqual((({ state, code }) => ({ state, code }))(d.sent[1][1]), { state: 'failed', code: null });
});

test('the snapshot hands out copies, not the live scan state', () => {
  const b = boot();
  const s = b.ipc();
  s.scan.state = 'running';
  assert.equal(b.api.scanBegin(), true, 'mutating a snapshot does not block a scan');
});

test('dev rows: id + since (null until dev-start stamps it), never the process', () => {
  const devServers = new Map([
    ['project-a', { pid: 101, __hqStartedAt: '2026-10-05T09:00:00.000Z', stdout: {} }],
    ['project-b', { pid: 102 }],
  ]);
  const b = boot({ devServers });
  assert.deepEqual(b.ipc().dev, [
    { id: 'project-a', since: '2026-10-05T09:00:00.000Z' },
    { id: 'project-b', since: null },
  ]);
  devServers.delete('project-a');
  assert.deepEqual(b.ipc().dev, [{ id: 'project-b', since: null }], 'live view of the registry');
});

test('cast rows carry spellbook names/icons and the chain flag; clone-safe', () => {
  const casts = new Map([
    ['chain-b', { proc: null, castId: 'c-chain', startedAt: '2026-10-05T09:01:00.000Z', timer: null, chain: true, halted: false, activeMember: 'spell-a' }],
    ['spell-a', { proc: { pid: 7 }, castId: 'c-a', startedAt: '2026-10-05T09:01:01.000Z', timer: {} }],
  ]);
  const b = boot({ casts });
  const snap = b.ipc();
  assert.deepEqual(snap.casts, [
    { castId: 'c-chain', spellId: 'chain-b', name: 'Chain B', icon: '⛓️', startedAt: '2026-10-05T09:01:00.000Z', chain: true },
    { castId: 'c-a', spellId: 'spell-a', name: 'Spell A', icon: '🔥', startedAt: '2026-10-05T09:01:01.000Z', chain: false },
  ]);
  assert.deepEqual(structuredClone(snap), snap, 'no ChildProcess / timer leaks into the payload');
  assert.equal(b.reads(), 1, 'one spellbook read per snapshot');
});

test('missing spell or unreadable spellbook keeps the row: name = spellId, icon = null', () => {
  const casts = new Map([['spell-x', { castId: 'c-x', startedAt: '2026-10-05T09:02:00.000Z' }]]);
  const want = [{ castId: 'c-x', spellId: 'spell-x', name: 'spell-x', icon: null, startedAt: '2026-10-05T09:02:00.000Z', chain: false }];
  for (const readSpellbook of [
    () => BOOK,                               // not in the book
    () => null,                               // no spellbook yet
    () => ({ spells: 'nope' }),               // wrong shape
    () => ({ spells: [null, { name: 'no id' }] }),
    () => { throw new Error('EACCES'); },     // unreadable
  ]) assert.deepEqual(boot({ casts, readSpellbook }).ipc().casts, want);
});

test('a throwing send never breaks the scan state machine', () => {
  const handlers = new Map();
  const api = liveState.init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, send: () => { throw new Error('window gone'); }, devServers: new Map(), casts: new Map(), readSpellbook: () => null });
  assert.equal(api.scanBegin(), true);
  assert.equal(api.scanEnd(0), true);
  assert.equal(api.snapshot().scan.state, 'done');
});
