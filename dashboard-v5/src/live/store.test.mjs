// createStore against a fake window.hq: hydration from liveState(), the new push
// channels, machine refresh, cast naming and subscription hygiene.
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
import { hubCard } from '../logic/claude-hub.js';
import { proj, scan, spell, spellbook, telemetry, organ, pcHealth } from './__fixtures__/synthetic.mjs';

// A recording fake of the preload bridge. Every on*/push subscription returns a
// disposer; `subs` counts handed out, `disposed` counts called. `push.x(payload)`
// fires channel x. Reads resolve with whatever `reads` holds.
function fakeHq(reads = {}) {
  const cbs = {}, stats = { subs: 0, disposed: 0, calls: [] };
  const on = (name) => (cb) => {
    (cbs[name] = cbs[name] || []).push(cb); stats.subs++;
    let live = true;
    return () => { if (live) { live = false; stats.disposed++; cbs[name] = cbs[name].filter((f) => f !== cb); } };
  };
  const read = (name) => (...args) => { stats.calls.push(name); return typeof reads[name] === 'function' ? reads[name](...args) : Promise.resolve(reads[name]); };
  const hq = {
    getSessions: read('getSessions'), onClaudeSessions: on('claudeSessions'), onSessionOutput: on('sessionOutput'),
    onDevStatus: on('devStatus'), onMachine: on('machine'),
    getBrowserLive: read('getBrowserLive'), onBrowserTab: on('browserTab'), onCastOutput: on('castOutput'), onCastDone: on('castDone'),
    getSocial: read('getSocial'), probeLlm: read('probeLlm'),
    liveState: read('liveState'), onScanStatus: on('scanStatus'),
    uiPrefs: { get: read('uiPrefs.get'), set: read('uiPrefs.set'), on: on('uiPrefs') },
  };
  const push = new Proxy({}, { get: (_, name) => (payload) => (cbs[name] || []).forEach((f) => f(payload)) });
  return { hq, push, stats, cbs };
}

const DATA = () => ({
  scans: [scan('2026-10-03', [proj('a', { path: 'C:\\dev\\project-a' })], { archived: [proj('z', { path: 'C:\\dev\\project-z' })] })],
  spellbook: spellbook([
    spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire', icon: '◎' }),
    spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'] }),
  ]),
  telemetry: telemetry([]),
  pcHealth: pcHealth([organ('cpu', { status: 'grace' }), organ('disk', { label: 'Storage', status: 'ember', diagnosis: 'Disk filling up', fixes: [{ title: 'Clean temp', command: 'cleanmgr', danger: 'safe' }] })], { at: '2026-10-03T03:00:00Z' }),
});

const LIVE_STATE = {
  dev: [{ id: 'a', since: 1_700_000_000_000 }, { id: 'b', since: null }, { id: 'c', since: '2026-10-03T08:00:00Z' }],
  casts: [
    { castId: 'k1', spellId: 'grimoire:scan', name: 'Deep scan (main)', icon: '◉', startedAt: '2026-10-03T09:00:00Z', chain: false },
    { castId: 'k2', spellId: 'skill:review', startedAt: 'not a date' },
  ],
  scan: { state: 'running', startedAt: '2026-10-03T10:00:00Z', endedAt: null, code: null },
};

test('model: new names exist; machine getters read the baked pc-health until refreshed', () => {
  const st = createStore(DATA(), null);
  const M = st.model;
  assert.deepEqual(M.INTERACTIVE.map((a) => a.id), ['skill:review']);
  assert.deepEqual(M.AUTOS.map((a) => a.id), ['grimoire:scan']);
  assert.equal(M.autoCounts.interactive, 1);
  assert.equal(M.fileUrl('C:\\x\\a b.png'), 'file:///C:/x/a%20b.png');
  assert.deepEqual(M.ISSUES.map((i) => i.id), ['organ-disk']);
  assert.equal(M.VITALS.length, 2);
  assert.equal(M.pcScannedAt, '2026-10-03T03:00:00Z');
  assert.deepEqual(M.pcHost, { name: 'test-pc' });
  assert.equal(M.ISSUES, M.ISSUES, 'memoised: same array until the source changes');
  // the time-machine / snapshot names are untouched
  assert.deepEqual([M.N, M.hasData, M.P0.length, M.T0.length], [1, true, 1, 0]);
});

test('refreshMachine swaps the source, emits, and null falls back to the baked sidecar', () => {
  const st = createStore(DATA(), null);
  let emits = 0; st.on(() => emits++);
  const before = st.model.ISSUES;
  st.refreshMachine(pcHealth([organ('cpu', { status: 'blood', diagnosis: 'CPU pegged' }), organ('ram', { status: 'blood', diagnosis: 'RAM full' })], { at: '2026-10-04T12:00:00Z' }));
  assert.equal(emits, 1);
  assert.deepEqual(st.model.ISSUES.map((i) => [i.id, i.sev]), [['organ-cpu', 'red'], ['organ-ram', 'red']]);
  assert.notEqual(st.model.ISSUES, before);
  assert.equal(st.model.pcScannedAt, '2026-10-04T12:00:00Z');
  assert.ok(st.live.pcHealth);
  st.refreshMachine(null);
  assert.equal(emits, 2);
  assert.equal(st.live.pcHealth, null);
  assert.deepEqual(st.model.ISSUES.map((i) => i.id), ['organ-disk']);
  st.refreshMachine('garbage');
  assert.equal(st.live.pcHealth, null);
});

// Regression (review): ISSUES/VITALS became getters read on every render; a refreshed sidecar with a junk
// organ entry made machine() throw inside renderVals (each render after the refresh failed).
test('refreshMachine with junk organ entries keeps ISSUES/VITALS readable', () => {
  const st = createStore(DATA(), null);
  st.refreshMachine(pcHealth([null, 7, 'x', organ('gpu', { status: 'ember', diagnosis: 'GPU hot' })]));
  assert.deepEqual(st.model.ISSUES.map((i) => i.id), ['organ-gpu']);
  assert.deepEqual(st.model.VITALS.map((v) => v[0]), ['GPU']);
  assert.doesNotThrow(() => createStore({ ...DATA(), pcHealth: { organs: [null] } }, null).model.VITALS);
});

test('start() hydrates dev servers, casts and scan from liveState()', async () => {
  const { hq } = fakeHq({ liveState: LIVE_STATE });
  const st = createStore(DATA(), hq);
  const t = Date.now();
  await st.start();
  const L = st.live;
  assert.deepEqual(Object.keys(L.dev).sort(), ['a', 'b', 'c']);
  assert.equal(L.dev.a.since, 1_700_000_000_000);
  assert.equal(L.dev.c.since, Date.parse('2026-10-03T08:00:00Z'));
  assert.equal(L.dev.b.since, null, 'an unknown start time stays unknown (never 1970, never the load time)');
  assert.deepEqual(L.casts.k1, { castId: 'k1', spellId: 'grimoire:scan', name: 'Deep scan (main)', icon: '◉', chainId: null, chain: false, out: [], status: 'running', t0: Date.parse('2026-10-03T09:00:00Z') });
  assert.equal(L.casts.k2.name, 'Review', 'name from the INTERACTIVE catalog');
  assert.equal(L.casts.k2.icon, '›_');
  assert.ok(L.casts.k2.t0 >= t, 'unparseable startedAt → now');
  assert.deepEqual(L.scan, LIVE_STATE.scan);
  st.stop();
});

test('pushes that land before the liveState reply win over it', async () => {
  let release;
  const { hq, push } = fakeHq({ liveState: () => new Promise((r) => { release = () => r(LIVE_STATE); }) });
  const st = createStore(DATA(), hq);
  const done = st.start();
  push.devStatus({ id: 'a', running: false });
  push.castOutput({ castId: 'k1', spellId: 'grimoire:scan', chunk: 'line 1\nline 2' });
  push.scanStatus({ state: 'done', startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:05:00Z', code: 0 });
  release();
  await done;
  assert.equal(st.live.dev.a, null, 'stopped after the snapshot was taken');
  assert.ok(st.live.dev.b);
  assert.deepEqual(st.live.casts.k1.out, ['line 1', 'line 2'], 'streaming cast kept its output');
  assert.equal(st.live.casts.k1.name, 'Deep scan', 'name from the AUTOS catalog');
  assert.equal(st.live.scan.state, 'done');
  // dev-status pushes: main's start stamp when it sends one, else "since now" (the old behaviour)
  const t = Date.now();
  push.devStatus({ id: 'd1', running: true, since: 1_700_000_000_000 });
  push.devStatus({ id: 'd2', running: true });
  assert.equal(st.live.dev.d1.since, 1_700_000_000_000);
  assert.ok(st.live.dev.d2.since >= t);
  st.stop();
});

test('onScanStatus and uiPrefs: initial get, then every push replaces the value and emits', async () => {
  const prefs = { theme: 'os', resolved: 'dark', reduceMotion: false };
  const { hq, push } = fakeHq({ 'uiPrefs.get': prefs });
  const st = createStore(DATA(), hq);
  await st.start();
  assert.deepEqual(st.live.uiPrefs, prefs);
  assert.equal(st.live.scan, null, 'liveState returned nothing → no scan state invented');
  let emits = 0; st.on(() => emits++);
  push.uiPrefs({ theme: 'light', resolved: 'light', reduceMotion: true });
  assert.deepEqual(st.live.uiPrefs, { theme: 'light', resolved: 'light', reduceMotion: true });
  push.scanStatus({ state: 'running', startedAt: '2026-10-03T10:00:00Z' });
  assert.equal(st.live.scan.state, 'running');
  push.scanStatus({ state: 'failed', startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:01:00Z', code: 1, error: 'collector exited 1' });
  assert.deepEqual([st.live.scan.state, st.live.scan.error], ['failed', 'collector exited 1']);
  push.scanStatus(null);   // junk payloads are ignored
  push.uiPrefs(undefined);
  assert.equal(st.live.scan.state, 'failed');
  assert.equal(st.live.uiPrefs.theme, 'light');
  assert.equal(emits, 3);
  st.stop();
});

test('a uiPrefs push that beats the initial get is not overwritten by the stale reply', async () => {
  let release;
  const { hq, push } = fakeHq({ 'uiPrefs.get': () => new Promise((r) => { release = () => r({ theme: 'dark', resolved: 'dark', reduceMotion: false }); }) });
  const st = createStore(DATA(), hq);
  const done = st.start();
  push.uiPrefs({ theme: 'light', resolved: 'light', reduceMotion: false });
  release();
  await done;
  assert.equal(st.live.uiPrefs.theme, 'light');
  st.stop();
});

test('cast output for an unknown castId takes the catalog name/icon, then the spell id', async () => {
  const { hq, push } = fakeHq();
  const st = createStore(DATA(), hq);
  await st.start();
  push.castOutput({ castId: 'x1', spellId: 'skill:review', chunk: 'opened' });
  push.castOutput({ castId: 'x2', spellId: 'grimoire:scan', chunk: 'ok', stream: 'err' });
  push.castOutput({ castId: 'x3', spellId: 'npm:gone:test', chunk: 'hi' });
  push.castOutput({ castId: 'x4', spellId: 'grimoire:scan', name: 'Named by main', chunk: '' });
  push.castDone({ castId: 'x5', spellId: 'skill:review', outcome: 'fizzled', exit_code: 3, duration_ms: 2400 });
  const C = st.live.casts;
  assert.deepEqual([C.x1.name, C.x1.icon], ['Review', '›_']);
  assert.deepEqual([C.x2.name, C.x2.icon, C.x2.out], ['Deep scan', '◎', ['✗ ok']]);
  assert.deepEqual([C.x3.name, C.x3.icon], ['npm:gone:test', '▶']);
  assert.equal(C.x4.name, 'Named by main');
  assert.deepEqual([C.x5.name, C.x5.status, C.x5.meta, C.x5.done], ['Review', 'failed', '2s · exit 3', true]);
  st.stop();
});

test('a failed cast without an exit code reads "exit code unknown", never "exit null" / "exit undefined"', async () => {
  const { hq, push } = fakeHq();
  const st = createStore(DATA(), hq);
  await st.start();
  push.castDone({ castId: 'k1', spellId: 'grimoire:scan', outcome: 'fizzled', exit_code: null, duration_ms: 4100, chainId: 'k1' });   // a chain settles with null
  push.castDone({ castId: 'k2', spellId: 'grimoire:scan', outcome: 'fizzled', duration_ms: 1000 });                                   // no exit_code at all
  push.castDone({ castId: 'k3', spellId: 'grimoire:scan', outcome: 'fizzled', exit_code: null, timed_out: true, duration_ms: 600000 });
  push.castDone({ castId: 'k4', spellId: 'grimoire:scan', outcome: 'resolved', exit_code: 0, duration_ms: 1500 });
  const C = st.live.casts;
  assert.deepEqual([C.k1.meta, C.k2.meta, C.k3.meta, C.k4.meta], ['4s · exit code unknown', '1s · exit code unknown', '600s · timed out', '2s']);
  st.stop();
});

test('sessions map cwd → project against the latest snapshot (live and archived)', async () => {
  const list = [
    { jobId: 'j1', label: 'Fix A', status: 'running', startedAt: 0, cwd: 'c:/dev/PROJECT-A/src' },
    { jobId: 'j2', label: 'Old', status: 'done', startedAt: 0, cwd: 'C:\\dev\\project-z' },
    { jobId: 'j3', label: 'Loose', status: 'done', startedAt: 0, cwd: 'C:\\elsewhere' },
  ];
  const { hq, push } = fakeHq({ getSessions: list });
  const st = createStore(DATA(), hq);
  await st.start();
  assert.deepEqual(st.live.sessions.map((s) => s.proj), ['a', 'z', null]);
  push.claudeSessions([{ jobId: 'j4', label: 'New', status: 'running', startedAt: 0, cwd: 'C:\\dev\\project-a' }]);
  assert.deepEqual(st.model.SESSIONS.map((s) => [s.id, s.proj]), [['j4', 'a']]);
  st.stop();
});

// Regression (review): the latest real scans carry relative project paths
test('sessions map an absolute cwd onto a relative project path (newer scans)', async () => {
  const data = { scans: [scan('2026-10-05', [proj('a', { path: 'project-a' })], { archived: [proj('z', { path: 'old\\project-z' })] })] };
  const { hq } = fakeHq({ getSessions: [
    { jobId: 'j1', label: 'A', status: 'running', startedAt: 0, cwd: 'C:\\Users\\me\\Docs\\project-a\\src' },
    { jobId: 'j2', label: 'Z', status: 'done', startedAt: 0, cwd: 'C:/Users/me/Docs/old/project-z' },
    { jobId: 'j3', label: 'None', status: 'done', startedAt: 0, cwd: 'C:/Users/me/Docs/project-q' },
  ] });
  const st = createStore(data, hq);
  await st.start();
  assert.deepEqual(st.live.sessions.map((s) => s.proj), ['a', 'z', null]);
  st.stop();
});

// Regression (review): refreshLlm called the bridge outside pull(), so a
// read that threw synchronously escaped start() and skipped every subscription after it.
test('a bridge read that throws synchronously is a failed read, not a failed start()', async () => {
  const boom = () => { throw new Error('sync boom'); };
  const { hq, cbs } = fakeHq({ probeLlm: boom });
  const st = createStore(DATA(), hq);
  const warn = console.warn; console.warn = () => {};
  try {
    await st.start();
    assert.equal((cbs.uiPrefs || []).length, 1, 'subscriptions still made');
    await st.refreshLlm(true);
  } finally { console.warn = warn; }
  assert.equal(st.live.llm, null);
  st.stop();
});

test('stop() releases every subscription, the new ones included', async () => {
  const { hq, stats, cbs, push } = fakeHq({ liveState: LIVE_STATE });
  const st = createStore(DATA(), hq);
  await st.start();
  for (const ch of ['claudeSessions', 'sessionOutput', 'devStatus', 'machine', 'browserTab', 'castOutput', 'castDone', 'scanStatus', 'uiPrefs']) {
    assert.equal((cbs[ch] || []).length, 1, ch + ' subscribed once');
  }
  assert.equal(stats.subs, 9);
  st.stop();
  assert.equal(stats.disposed, stats.subs);
  assert.ok(Object.values(cbs).every((l) => l.length === 0));
  // nothing reaches the store after stop()
  push.scanStatus({ state: 'failed' });
  assert.equal(st.live.scan.state, 'running');
  st.stop();   // idempotent
  assert.equal(stats.disposed, 9);
});

test('reads that throw or reject leave the store usable; no bridge → read-only and start() resolves', async () => {
  const { hq } = fakeHq({ liveState: () => { throw new Error('no handler'); }, 'uiPrefs.get': () => Promise.reject(new Error('nope')) });
  const warn = console.warn; console.warn = () => {};
  try {
    const st = createStore(DATA(), hq);
    await st.start();
    assert.deepEqual([st.live.dev, st.live.casts, st.live.scan, st.live.uiPrefs], [{}, {}, null, null]);
    st.stop();
  } finally { console.warn = warn; }
  const ro = createStore(DATA(), null);
  assert.equal(ro.bridge, false);
  assert.equal(await ro.start(), undefined);
  ro.stop();
  // a preload without the clean-pass methods (older main) still starts
  const { hq: old } = fakeHq();
  delete old.liveState; delete old.onScanStatus; delete old.uiPrefs;
  const st2 = createStore(DATA(), old);
  await st2.start();
  assert.deepEqual([st2.live.scan, st2.live.uiPrefs], [null, null]);
  st2.stop();
});

test('empty DATA still builds a model with the new names', () => {
  const st = createStore(undefined, null);
  assert.deepEqual([st.model.INTERACTIVE, st.model.ISSUES, st.model.VITALS, st.model.pcScannedAt], [[], [], [], null]);
  assert.deepEqual(st.model.autoCounts, { runnable: 0, interactive: 0, bySource: {} });
});

// ---- clean pass Phase 3 (K-2): raw canvas boards next to the widgets ------------------------

test('the model keeps fileUrl', async () => {
  const { hq } = fakeHq({});
  const st = createStore(DATA(), hq);
  await st.start();
  assert.equal(st.model.fileUrl('C:\\caps\\a.recovered.webm'), 'file:///C:/caps/a.recovered.webm');
  st.stop();
});

// ---- Claude Hub (H1.7): hq.claudeHub.health() / .on() -> live.claudeHub -----------------------------------
// The shared fake has no claudeHub (its subscription count is asserted above), so these tests bolt one on.
function hubHq(health) {
  const f = fakeHq(), hubCbs = [], calls = { health: 0, disposed: 0 };
  f.hq.claudeHub = {
    health: () => { calls.health++; return typeof health === 'function' ? health(calls.health) : Promise.resolve(health); },
    on: (cb) => { hubCbs.push(cb); return () => { calls.disposed++; hubCbs.splice(hubCbs.indexOf(cb), 1); }; },
  };
  return { ...f, calls, hubCbs, fire: (e) => hubCbs.slice().forEach((cb) => cb(e)) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('claudeHub: health() hydrates live.claudeHub; anything that is not an object reads as null', async () => {
  const { hq } = hubHq({ state: 'ready', role: 'writer', counts: { projects: 1, conversations: 2, messages: 3 } });
  const st = createStore(DATA(), hq);
  assert.equal(st.live.claudeHub, null);
  await st.start();
  assert.deepEqual(st.live.claudeHub, { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 2, messages: 3 } });
  st.stop();
  for (const junk of ['nope', null, [1], 7]) {
    const { hq: h } = hubHq(junk);
    const s = createStore(DATA(), h);
    await s.start();
    assert.equal(s.live.claudeHub, null, 'junk ' + JSON.stringify(junk));
    s.stop();
  }
});

test('claudeHub: progress moves the card on, and done === total re-pulls health (fresh counts, "ready")', async () => {
  const answers = [{ state: 'indexing', role: 'writer', backfill: { done: 0, total: 32 }, counts: { projects: 0, conversations: 0, messages: 0 } },
    { state: 'ready', role: 'writer', backfill: { done: 32, total: 32 }, counts: { projects: 3, conversations: 40, messages: 900 }, dbBytes: 2048 }];
  const { hq, calls, fire } = hubHq((n) => Promise.resolve(answers[n - 1]));
  const st = createStore(DATA(), hq);
  let emits = 0; st.on(() => { emits++; });
  await st.start();
  assert.equal(st.live.claudeHub.state, 'indexing');
  fire({ event: 'progress', data: { done: 8, total: 32 } });
  assert.equal(st.live.claudeHub.state, 'indexing');
  assert.deepEqual(st.live.claudeHub.backfill, { done: 8, total: 32 });
  assert.equal(st.live.claudeHub.role, 'writer', 'the rest of the last health answer is kept');
  assert.equal(calls.health, 1, 'a mid-backfill progress does not re-pull');
  const before = emits;
  fire({ event: 'progress', data: { done: 32, total: 32 } });
  assert.equal(st.live.claudeHub.state, 'ready', 'flips at once, before the re-pull lands');
  assert.equal(emits, before + 1);
  await settle();
  assert.equal(calls.health, 2);
  assert.deepEqual(st.live.claudeHub.counts, { projects: 3, conversations: 40, messages: 900 });
  assert.equal(st.live.claudeHub.dbBytes, 2048);
  assert.ok(emits > before + 1, 'the re-pull emits too');
  st.stop();
});

test('claudeHub: a first backfill (zero counts, progress 8/32) renders no "nothing indexed yet" next to a filling bar', async () => {
  const { hq, calls, fire } = hubHq({ state: 'indexing', role: 'writer', backfill: { done: 0, total: 32 }, counts: { projects: 0, conversations: 0, messages: 0 } });
  const st = createStore(DATA(), hq);
  await st.start();
  assert.equal(hubCard(st.live.claudeHub, true).detail, 'nothing indexed yet', 'nothing read yet: the zeros are accurate');
  fire({ event: 'progress', data: { done: 8, total: 32 } });
  assert.equal(calls.health, 1, 'counts are not re-pulled mid-backfill, so they stay at the first answer (zeros)');
  const card = hubCard(st.live.claudeHub, true);
  assert.equal(card.state, 'Indexing 8 of 32 sessions');
  assert.equal(card.bar, true);
  assert.equal(card.detail, 'counts appear when indexing finishes');
  st.stop();
});

test('claudeHub: a health push replaces the whole value; a re-pull that answers junk keeps what we had', async () => {
  const { hq, calls, fire } = hubHq((n) => Promise.resolve(n === 1 ? { state: 'starting' } : 'junk'));
  const st = createStore(DATA(), hq);
  await st.start();
  fire({ event: 'health', data: { state: 'down', node: 'v25.6.1', error: 'Claude Hub exited (1)' } });
  assert.deepEqual(st.live.claudeHub, { state: 'down', node: 'v25.6.1', error: 'Claude Hub exited (1)' });
  fire({ event: 'progress', data: { done: 1, total: 1 } });
  await settle();
  assert.equal(calls.health, 2);
  assert.equal(st.live.claudeHub.state, 'ready', 'the junk re-pull answer did not wipe the value');
  st.stop();
});

test('claudeHub: a "ready" event after a "starting" answer re-pulls health (a reader never reports progress)', async () => {
  const { hq, calls, fire } = hubHq((n) => Promise.resolve(n === 1 ? { state: 'starting', node: 'v25.6.1' } : { state: 'ready', role: 'reader', counts: { projects: 1, conversations: 1, messages: 1 } }));
  const st = createStore(DATA(), hq);
  await st.start();
  assert.equal(st.live.claudeHub.state, 'starting');
  fire({ event: 'ready', data: { role: 'reader' } });
  await settle();
  assert.equal(calls.health, 2);
  assert.equal(st.live.claudeHub.state, 'ready');
  assert.equal(st.live.claudeHub.role, 'reader');
  st.stop();
});

test('claudeHub: a "changed" event re-pulls health (the counts move on while the app sits open)', async () => {
  // gate finding (H1 real-instance gate): the Hub indexed an appended line and said so with "changed", but the card kept the old
  // counts until the next backfill or restart, because nothing re-asked for them.
  const answers = [{ state: 'ready', role: 'writer', counts: { projects: 2, conversations: 3, messages: 5 } },
    { state: 'ready', role: 'writer', counts: { projects: 2, conversations: 3, messages: 6 }, dbBytes: 4096 }];
  const { hq, calls, fire } = hubHq((n) => Promise.resolve(answers[n - 1]));
  const st = createStore(DATA(), hq);
  let emits = 0; st.on(() => { emits++; });
  await st.start();
  assert.equal(hubCard(st.live.claudeHub, true).detail, '3 chats · 2 projects · 5 messages');
  const before = emits;
  fire({ event: 'changed', data: { ids: ['code:sess-a2'] } });
  await settle();
  assert.equal(calls.health, 2, 'one re-pull per changed event');
  assert.equal(hubCard(st.live.claudeHub, true).detail, '3 chats · 2 projects · 6 messages');
  assert.ok(emits > before, 'the card is told to render');
  st.stop();
});

test('claudeHub: a "changed" event whose re-pull answers junk keeps the value we had', async () => {
  const { hq, calls, fire } = hubHq((n) => Promise.resolve(n === 1 ? { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 1, messages: 1 } } : 'junk'));
  const st = createStore(DATA(), hq);
  await st.start();
  fire({ event: 'changed', data: { ids: ['c1'] } });
  await settle();
  assert.equal(calls.health, 2);
  assert.equal(st.live.claudeHub.counts.messages, 1);
  st.stop();
});

test('claudeHub: junk and unrelated events change nothing; stop() unsubscribes; an older preload without claudeHub still starts', async () => {
  const { hq, calls, hubCbs, fire } = hubHq({ state: 'ready', role: 'writer' });
  const st = createStore(DATA(), hq);
  await st.start();
  const snapshot = st.live.claudeHub;
  for (const e of [null, 'x', 7, [], {}, { event: 'progress' }, { event: 'progress', data: 'x' }, { event: 'health', data: null }, { event: 'error', data: { message: 'x' } }]) fire(e);
  assert.equal(st.live.claudeHub, snapshot);
  assert.equal(calls.health, 1);
  assert.equal(hubCbs.length, 1);
  st.stop();
  assert.equal(calls.disposed, 1);
  assert.equal(hubCbs.length, 0);
  const { hq: old } = fakeHq();
  const s2 = createStore(DATA(), old);
  await s2.start();
  assert.equal(s2.live.claudeHub, null);
  s2.stop();
});

// append to dashboard-v5/src/live/store.test.mjs
function libHq(over = {}) {
  const h = hubHq({ state: 'ready' }), calls = [];
  const rec = (name, val) => (...a) => { calls.push([name, a]); return Promise.resolve(typeof val === 'function' ? val(...a) : val); };
  Object.assign(h.hq.claudeHub, {
    projects: rec('projects', [{ id: 'code:p', name: 'project-a', conversations: 1, last_at: '2026-10-04T10:00:00Z', hq_project_id: null, link_state: 'none' }]),
    conversations: rec('conversations', (o) => (o && o.beforeId ? [] : [{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }])),
    conversation: rec('conversation', (id) => ({ conversation: { id, title: 'T' }, hasMore: false, messages: [] })),
    search: rec('search', []), stats: rec('stats', { days: [], projects: [], totals: {} }), ...over,
  });
  return { ...h, calls };
}
test('claudeLib: loads on demand, pages with the (before, beforeId) cursor, sends the local offset', async () => {
  const { hq, calls, fire } = libHq();
  const st = createStore(DATA(), hq); await st.start();
  assert.equal(st.live.claudeLib.convs, null);                       // nothing fetched until a screen asks
  await st.refreshClaudeLib({ source: 'code' });
  assert.equal(st.live.claudeLib.convs.length, 1);
  await st.moreClaudeConvs();
  assert.deepEqual(calls.at(-1), ['conversations', [{ source: 'code', limit: 50, before: '2026-10-04T10:00:00Z', beforeId: 'code:s' }]]);
  assert.equal(st.live.claudeLib.convsMore, false);
  await st.refreshClaudeStats(30);
  assert.equal(calls.at(-1)[1][0].tzOffsetMin, -new Date().getTimezoneOffset());
  await st.openClaudeThread('code:s');
  const before = calls.length;
  fire({ event: 'changed', data: { ids: ['code:s'] } }); await settle(); await settle();
  assert.ok(calls.slice(before).some(([n]) => n === 'conversation'), 'open thread re-read on change');
  assert.ok(calls.slice(before).some(([n]) => n === 'conversations'), 'list re-read on change');
  st.stop();
});
test('claudeLib: an {error} keeps the last data and says why; a no-term search says so', async () => {
  let fail = false;
  const { hq } = libHq({ conversations: () => Promise.resolve(fail ? { error: 'timeout' } : [{ id: 'code:s', title: 'T', last_at: 'x', message_count: 1 }]) });
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeLib({}); fail = true; await st.refreshClaudeLib({});
  assert.equal(st.live.claudeLib.convs.length, 1);
  assert.equal(st.live.claudeLib.error, 'Claude Hub: timeout');
  await st.searchClaude('!!! ...');
  assert.equal(st.live.claudeLib.hits, null); assert.equal(st.live.claudeLib.noTerms, true);
  st.stop();
});
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };
test('claudeLib: a changed event keeps loaded pages (list and thread) and merges by id', async () => {
  const mk = (n, at) => Array.from({ length: n }, (_, i) => ({ id: 'c' + (at - i), last_at: '2026-10-' + String(at - i).padStart(2, '0') + 'T00:00:00Z' }));
  let head = mk(3, 30);
  const { hq, calls, fire } = libHq({
    conversations: (o) => Promise.resolve(o && o.beforeId ? mk(2, 20) : head.slice(0, o.limit)),
    conversation: (id, o) => Promise.resolve(o && o.beforeId
      ? { conversation: { id }, hasMore: false, messages: [{ id: 'm1', at: 'a' }] }
      : { conversation: { id }, hasMore: true, messages: [{ id: 'm2', at: 'b' }, { id: 'm3', at: 'c' }, ...(head.length > 3 ? [{ id: 'm4', at: 'd' }] : [])] }),
  });
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeLib({}); await st.moreClaudeConvs();
  await st.openClaudeThread('code:s'); await st.earlierClaudeThread();
  assert.deepEqual(st.live.claudeLib.thread.messages.map((m) => m.id), ['m1', 'm2', 'm3']);
  head = mk(1, 31).concat(head);                       // a newer conversation appears
  fire({ event: 'changed', data: { ids: ['code:s'] } }); await settle(); await settle();
  const L = st.live.claudeLib;
  assert.equal(L.convs[0].id, 'c31'); assert.equal(L.convs.length, 1 + 3 + 2);
  assert.ok(L.convs.some((c) => c.id === 'c19'), 'the older page survives');
  assert.equal(new Set(L.convs.map((c) => c.id)).size, L.convs.length, 'no duplicates');
  assert.deepEqual(L.thread.messages.map((m) => m.id), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(L.thread.hasMore, false);
  st.stop();
});
test('claudeLib: late answers are dropped (closed thread, replaced open, replaced search)', async () => {
  const gates = {};
  const { hq } = libHq({
    conversation: (id) => { const d = defer(); (gates[id] = gates[id] || []).push(d); return d.p; },
    search: (q) => { const d = defer(); (gates['q' + q] = gates['q' + q] || []).push(d); return d.p; },
  });
  const st = createStore(DATA(), hq); await st.start();
  const open = st.openClaudeThread('A'); await settle(); st.closeClaudeThread();
  gates.A[0].res({ conversation: { id: 'A' }, hasMore: false, messages: [] }); await open;
  assert.equal(st.live.claudeLib.thread, null, 'a closed thread stays closed');
  const a = st.openClaudeThread('A'), b = st.openClaudeThread('B'); await settle();
  gates.B[0].res({ conversation: { id: 'B' }, hasMore: false, messages: [] }); await b;
  gates.A[1].res({ conversation: { id: 'A' }, hasMore: false, messages: [] }); await a;
  assert.equal(st.live.claudeLib.thread.conversation.id, 'B');
  const s1 = st.searchClaude('ab'); await settle(); const s2 = st.searchClaude('');
  gates.qab[0].res([{ id: 'h' }]); await s1; await s2;
  assert.equal(st.live.claudeLib.hits, null, 'the cleared search is not overwritten');
  st.stop();
});

test('claudeLib: a first load that failed while the Hub was starting is retried when the Hub reports ready', async () => {
  const { hq, fire } = hubHq((n) => Promise.resolve(n === 1 ? { state: 'starting' } : { state: 'ready', counts: {} }));
  let up = false, convCalls = 0;
  hq.claudeHub.projects = () => Promise.resolve(up ? [] : { error: 'hub not running' });
  hq.claudeHub.conversations = () => { convCalls++; return Promise.resolve(up ? [{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }] : { error: 'hub not running' }); };
  const st = createStore(DATA(), hq);
  await st.start();
  await st.refreshClaudeLib();
  assert.equal(st.live.claudeLib.convs, null);
  assert.match(st.live.claudeLib.error, /hub not running/);
  up = true;
  fire({ event: 'ready', data: {} });
  await settle(); await settle(); await settle();
  assert.equal(convCalls, 2, 'refetched once the Hub is ready');
  assert.equal(st.live.claudeLib.convs.length, 1);
  assert.equal(st.live.claudeLib.error, null);
  st.stop();
});

test('claudeLib: a project page asks only its linked chats', async () => {
  const { hq, calls } = libHq();
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeForProject('project-a');
  assert.deepEqual(calls.at(-1), ['conversations', [{ hqProjectId: 'project-a', limit: 5 }]]);
  assert.equal(st.live.claudeLib.byHq['project-a'].length, 1);
  st.stop();
});

test('claudeLib: a failed project-page / History load keeps its own error, never the Chats banner, and retries when the Hub is ready', async () => {
  let fail = true;
  const { hq, fire } = libHq({
    conversations: () => (fail ? Promise.reject(new Error('hub not running')) : Promise.resolve([{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }])),
    stats: () => (fail ? Promise.resolve({ error: 'hub not running' }) : Promise.resolve({ days: [], projects: [], totals: {} })),
  });
  const st = createStore(DATA(), hq); await st.start();
  await st.refreshClaudeForProject('project-a'); await st.refreshClaudeStats(30);
  assert.equal(st.live.claudeLib.byHq['project-a'], undefined);
  assert.equal(st.live.claudeLib.pageErr['project-a'], 'Claude Hub: hub not running');
  assert.equal(st.live.claudeLib.statsErr, 'Claude Hub: hub not running');
  assert.equal(st.live.claudeLib.error, null, 'the Chats banner is not touched by page/stats loads');
  fail = false; fire({ event: 'ready', data: {} });
  await settle(); await settle(); await settle(); await settle();
  assert.equal(st.live.claudeLib.byHq['project-a'].length, 1, 'page retried on ready');
  assert.ok(st.live.claudeLib.stats, 'stats retried on ready');
  assert.equal(st.live.claudeLib.pageErr['project-a'], null);
  assert.equal(st.live.claudeLib.statsErr, null);
  st.stop();
});

function chatHq(answer = { turnId: 't1' }) {
  const f = fakeHq(), cbs = [], calls = [];
  f.hq.claudeChat = {
    send: (req) => { calls.push(['send', req]); return typeof answer === 'function' ? answer(req) : Promise.resolve(answer); },
    cancel: (id) => { calls.push(['cancel', id]); return Promise.resolve(true); },
    on: (cb) => { cbs.push(cb); return () => cbs.splice(cbs.indexOf(cb), 1); },
  };
  return { ...f, calls, fire: (e) => cbs.slice().forEach((cb) => cb(e)) };
}
test('claudeChat: send adds a turn, early events are replayed, deltas stream, cancel goes to main', async () => {
  let fire;
  const h = chatHq((req) => { fire({ turnId: 't1', kind: 'session', sessionId: '00000000-0000-4000-8000-000000000001', mode: req.mode }); return Promise.resolve({ turnId: 't1' }); });
  fire = h.fire;
  const st = createStore(DATA(), h.hq);
  await st.start();
  assert.deepEqual(st.live.claudeChat, { turns: [] });
  assert.deepEqual(await st.sendClaudeChat({ projectId: 'project-a', text: 'hi', mode: 'read-only' }), { turnId: 't1' });
  assert.equal(st.live.claudeChat.turns.length, 1);
  assert.equal(st.live.claudeChat.turns[0].convId, 'code:00000000-0000-4000-8000-000000000001', 'the session event that beat the answer was replayed');
  h.fire({ turnId: 't1', kind: 'delta', text: 'Hel' }); h.fire({ turnId: 't1', kind: 'delta', text: 'lo' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(st.live.claudeChat.turns[0].items[0].text, 'Hello');
  assert.equal(await st.cancelClaudeChat('t1'), true);
  assert.deepEqual(h.calls.map((c) => c[0]), ['send', 'cancel']);
  st.stop();
});
test('claudeChat: an {error} answer is returned, adds no turn; no bridge says so', async () => {
  const h = chatHq({ error: '3 Claude turns are already running — wait for one or press Stop' });
  const st = createStore(DATA(), h.hq);
  await st.start();
  assert.deepEqual(await st.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: '3 Claude turns are already running — wait for one or press Stop' });
  assert.equal(st.live.claudeChat.turns.length, 0);
  const thrower = chatHq(() => Promise.reject(new Error('ipc gone')));
  const s2 = createStore(DATA(), thrower.hq); await s2.start();
  assert.deepEqual(await s2.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: 'ipc gone' });
  const s3 = createStore(DATA(), null);
  assert.deepEqual(await s3.sendClaudeChat({ projectId: 'p', text: 'x', mode: 'read-only' }), { error: 'This window has no app bridge' });
  assert.equal(await s3.cancelClaudeChat('t1'), false);
  st.stop(); s2.stop();
});

function h6Hq() {
  let pushImports = null;
  const calls = [];
  const hq = {
    claudeHub: {
      health: async () => ({ state: 'ready', role: 'writer' }), on: () => () => {},
      search: async (q) => { calls.push(['search', q]); return [{ messageId: 'm', conversationId: 'code:s', title: 't', snippet: 'a \u0002tea\u0003', at: '2026-10-01T00:00:00Z' }]; },
      documents: async (o) => { calls.push(['documents', o]); return [{ id: 'memory:1', source: 'memory', title: 'Tea', snippet: '\u0002tea\u0003', mtime_ms: 1 }]; },
      document: async (id) => { calls.push(['document', id]); return id === 'memory:1' ? { id, source: 'memory', title: 'Tea', text: 'masked text' } : null; },
    },
    claudeImports: {
      pending: async () => ({ folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd0', file: 'old.zip', bytes: 1, kind: 'claude' }], refused: [] }),
      on: (cb) => { pushImports = cb; return () => { pushImports = null; }; }, dismiss: async () => true,
    },
  };
  return { hq, calls, push: (e) => pushImports && pushImports(e) };
}

test('H6: search asks messages and documents together under one staleness token; documents exclude nothing client-side', async () => {
  const { hq, calls } = h6Hq();
  const st = createStore(DATA(), hq);
  await st.searchClaude('tea');
  assert.deepEqual(calls.filter((c) => c[0] !== 'document').map((c) => c[0]).sort(), ['documents', 'search']);
  assert.deepEqual(calls.find((c) => c[0] === 'documents')[1], { q: 'tea', limit: 20 });
  assert.equal(st.live.claudeLib.hits.length, 1); assert.equal(st.live.claudeLib.docHits.length, 1);
  await st.searchClaude('   ');
  assert.equal(st.live.claudeLib.docHits, null);
});

test('H6: openClaudeDocument loads in place; an unknown id says so; close clears', async () => {
  const { hq } = h6Hq();
  const st = createStore(DATA(), hq);
  await st.openClaudeDocument('memory:1');
  assert.equal(st.live.claudeLib.doc.text, 'masked text');
  await st.openClaudeDocument('memory:gone');
  assert.deepEqual(st.live.claudeLib.doc, { id: 'memory:gone', error: 'That document is no longer in the index (its file was removed or it was forgotten).' });
  st.closeClaudeDocument();
  assert.equal(st.live.claudeLib.doc, null);
});

test('adoptClaudeTurn registers a turn main started and replays events that arrived first; once only', async () => {
  let chatCb = null;
  const hq = { claudeChat: { on: (cb) => { chatCb = cb; return () => {}; }, send: async () => ({ error: 'unused' }), cancel: async () => false },
    claudeHub: { health: async () => ({ state: 'ready' }), on: () => () => {} } };
  const st = createStore(DATA(), hq);
  await st.start();
  chatCb({ turnId: 'ct-1', kind: 'session', sessionId: '00000000-0000-4000-8000-000000000009', mode: 'read-only' });   // beats the adopt
  chatCb({ turnId: 'ct-1', kind: 'delta', text: 'Placeholder' });
  assert.equal(st.adoptClaudeTurn({ turnId: 'ct-1', projectId: 'p1', prompt: 'Placeholder question' }), true);
  const t = st.live.claudeChat.turns.find((x) => x.turnId === 'ct-1');
  assert.ok(t); assert.equal(t.projectId, 'p1');
  assert.match(JSON.stringify(t), /Placeholder/, 'the delta that arrived first was replayed');
  assert.equal(st.adoptClaudeTurn({ turnId: 'ct-1', prompt: 'again' }), false, 'a turn is adopted once');
  st.stop();
});
