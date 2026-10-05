// createStore against a fake window.hq: hydration from liveState(), the new push
// channels, machine refresh, cast naming and subscription hygiene.
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store.js';
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
    onDevStatus: on('devStatus'), getCanvas: read('getCanvas'), onCanvas: on('canvas'), onMachine: on('machine'),
    getBrowserLive: read('getBrowserLive'), onBrowserTab: on('browserTab'), onCastOutput: on('castOutput'), onCastDone: on('castDone'),
    getSocial: read('getSocial'), probeLlm: read('probeLlm'),
    liveState: read('liveState'), onScanStatus: on('scanStatus'),
    uiPrefs: { get: read('uiPrefs.get'), set: read('uiPrefs.set'), on: on('uiPrefs') },
    studio: { libraryList: read('libraryList'), onCaptureAdded: on('captureAdded'), recStatus: on('recStatus') },
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

// Regression (review): refreshSocial/refreshLlm/refreshCaptures called the bridge outside pull(), so a
// read that threw synchronously escaped start() and skipped every subscription after it.
test('a bridge read that throws synchronously is a failed read, not a failed start()', async () => {
  const boom = () => { throw new Error('sync boom'); };
  const { hq, cbs } = fakeHq({ getSocial: boom, probeLlm: boom, libraryList: boom });
  const st = createStore(DATA(), hq);
  const warn = console.warn; console.warn = () => {};
  try {
    await st.start();
    assert.equal((cbs.recStatus || []).length, 1, 'subscriptions after the studio read still made');
    await st.refreshSocial(); await st.refreshLlm(true); await st.refreshCaptures();
  } finally { console.warn = warn; }
  assert.equal(st.live.social.loaded, false);
  assert.equal(st.live.llm, null);
  st.stop();
});

test('stop() releases every subscription, the new ones included', async () => {
  const { hq, stats, cbs, push } = fakeHq({ liveState: LIVE_STATE });
  const st = createStore(DATA(), hq);
  await st.start();
  for (const ch of ['claudeSessions', 'sessionOutput', 'devStatus', 'canvas', 'machine', 'browserTab', 'castOutput', 'castDone', 'scanStatus', 'uiPrefs', 'captureAdded', 'recStatus']) {
    assert.equal((cbs[ch] || []).length, 1, ch + ' subscribed once');
  }
  assert.equal(stats.subs, 12);
  st.stop();
  assert.equal(stats.disposed, stats.subs);
  assert.ok(Object.values(cbs).every((l) => l.length === 0));
  // nothing reaches the store after stop()
  push.scanStatus({ state: 'failed' });
  assert.equal(st.live.scan.state, 'running');
  st.stop();   // idempotent
  assert.equal(stats.disposed, 12);
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
