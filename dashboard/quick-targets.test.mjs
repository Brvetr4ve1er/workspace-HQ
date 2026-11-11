// node --test dashboard/quick-targets.test.mjs — quick-targets.js (main side of the Ctrl+Alt+X Needs-you rows and Go mode).
// Placeholder names, ids and paths only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const QT = require('./quick-targets.js');

const CAST = { sender: 'cast-window' };      // an event from the palette
const MAIN = { sender: 'main-window' };      // an event from anywhere else
const isCastSender = (e) => !!e && e.sender === 'cast-window';

const REF_A = 'abcdef012345', REF_SCAN = '0123456789ab';
const LATEST = {
  generatedAt: '2026-11-10T08:00:00Z',
  projects: [
    { id: 'sample-app', name: 'Sample App', path: 'C:/placeholder/secret-dir/sample-app', metrics: { git_safety: { remote: 'https://example.invalid/placeholder/sample-app.git' } } },
    { id: 'demo-site', name: 'Demo Site', path: 'C:/placeholder/demo-site' },
    { id: 'no name', name: 'Bad Id' },                 // an id a route cannot carry: left out
    { id: 'idonly' },                                   // no name: the id stands in
    null, 7, { name: 'no id' },
  ],
};
const VIEW = {
  status: 'ok', statusLine: 'Needs you · 3', noteLine: null, total: 3,
  rows: [
    { ref: REF_A, scan: false, label: 'high · A project has secrets in plain sight', why: 'sample-app has a key at C:/placeholder/secret-dir/.env', amount: 98765432, path: 'C:/placeholder/secret-dir' },
    { ref: REF_SCAN, scan: true, label: 'The scan is old' },
    { ref: 'ffffffffffff', scan: false, label: 'A bill is late' },
    { ref: 'eeeeeeeeeeee', scan: false, label: 'a fourth row is never sent' },
  ],
};

function rig(over = {}) {
  const calls = { shown: [], scans: 0, logs: [], opened: [] };
  const deps = {
    latest: () => LATEST,
    trayBrief: {
      view: () => VIEW,
      open: (ref, showMainAt) => {
        calls.opened.push(ref);
        if (ref === REF_A) { showMainAt({ tab: 'projects', projectId: 'sample-app' }); return 'go'; }
        if (ref === REF_SCAN) return 'scan';
        return 'none';
      },
    },
    showMainAt: (r) => { calls.shown.push(r); return true; },
    runScan: () => { calls.scans++; return true; },
    log: (f) => calls.logs.push(f),
    isCastSender,
    ...over,
  };
  return { q: QT.create(deps), calls, deps };
}

// ---- read() ----
test('read(): projection rows (ref + label + scan), status and project { id, name } only', () => {
  const { q } = rig();
  const r = q.read(CAST);
  assert.equal(r.status, 'ok');
  assert.equal(r.brief.length, 3, 'capped at three');
  assert.deepEqual(r.brief[0], { ref: REF_A, label: 'high · A project has secrets in plain sight', scan: false });
  assert.equal(r.brief[1].scan, true);
  for (const b of r.brief) assert.deepEqual(Object.keys(b).sort(), ['label', 'ref', 'scan']);
  assert.deepEqual(r.projects, [{ id: 'sample-app', name: 'Sample App' }, { id: 'demo-site', name: 'Demo Site' }, { id: 'idonly', name: 'idonly' }]);
  for (const p of r.projects) assert.deepEqual(Object.keys(p).sort(), ['id', 'name']);
});

test('read() carries no why, no amounts, no paths and no ids other than project ids', () => {
  const { q } = rig();
  const text = JSON.stringify(q.read(CAST));
  for (const leak of ['placeholder', 'secret-dir', '.env', '98765432', 'example.invalid', 'git_safety', 'generatedAt', 'statusLine', 'a key at']) assert.ok(!text.includes(leak), leak);
  const keys = new Set();
  (function walk(x) { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } })(JSON.parse(text));
  assert.deepEqual([...keys].filter((k) => !/^\d+$/.test(k)).sort(), ['brief', 'id', 'label', 'name', 'projects', 'ref', 'scan', 'status']);
});

test('read(): honest states: no brief yet, no latest.json (projects null), a throwing source', () => {
  assert.deepEqual(rig({ trayBrief: { view: () => ({ status: 'not-ready', rows: [] }) }, latest: () => null }).q.read(CAST), { brief: [], status: 'not-ready', projects: null });
  assert.deepEqual(rig({ trayBrief: { view: () => ({ status: 'empty', rows: [] }) }, latest: () => ({ projects: [] }) }).q.read(CAST), { brief: [], status: 'empty', projects: [] });
  const thrown = rig({ trayBrief: { view: () => { throw new Error('boom'); } }, latest: () => { throw new Error('disk'); } }).q.read(CAST);
  assert.deepEqual(thrown, { brief: [], status: 'not-ready', projects: null });
  assert.deepEqual(rig({ trayBrief: null, latest: undefined }).q.read(CAST), { brief: [], status: 'not-ready', projects: null });
  const odd = rig({ trayBrief: { view: () => ({ status: 'whatever', rows: [{ ref: 'bad', label: 'x' }, { ref: REF_A, label: '' }] }) } }).q.read(CAST);
  assert.equal(odd.status, 'not-ready');
  assert.deepEqual(odd.brief, []);
});

test('read(): a 10,000-project latest.json is capped and a long name is clipped', () => {
  const big = { projects: Array.from({ length: 10000 }, (_, i) => ({ id: 'p' + i, name: 'N'.repeat(500) })) };
  const r = rig({ latest: () => big }).q.read(CAST);
  assert.ok(r.projects.length <= 2000);
  assert.ok(Array.from(r.projects[0].name).length <= 80);
});

// ---- sender check: all three channels ----
test('a call whose sender is not the cast window answers { error } on all three channels and does nothing', () => {
  const { q, calls } = rig();
  for (const e of [MAIN, undefined, null, {}, { sender: 'cast-window-2' }]) {
    assert.deepEqual(q.read(e), { error: QT.NOT_HERE });
    assert.deepEqual(q.openBrief(e, REF_A), { error: QT.NOT_HERE });
    assert.deepEqual(q.openGo(e, { tab: 'money', sub: 'runway' }), { error: QT.NOT_HERE });
  }
  assert.deepEqual(calls, { shown: [], scans: 0, logs: [], opened: [] });
});

test('the sender check fails closed: no isCastSender, or one that throws or answers loosely', () => {
  for (const isC of [undefined, null, 'yes', () => { throw new Error('gone'); }, () => 1, () => 'true', () => undefined]) {
    const { q, calls } = rig({ isCastSender: isC });
    assert.deepEqual(q.read(CAST), { error: QT.NOT_HERE });
    assert.deepEqual(q.openBrief(CAST, REF_A), { error: QT.NOT_HERE });
    assert.deepEqual(q.openGo(CAST, { tab: 'money' }), { error: QT.NOT_HERE });
    assert.equal(calls.shown.length + calls.scans + calls.logs.length, 0);
  }
});

// ---- openBrief ----
test('openBrief: only a 12-hex ref reaches the tray; anything else is none', () => {
  const { q, calls } = rig();
  for (const bad of ['', 'abc', 'ABCDEF012345', 'abcdef0123456', 'abcdef01234g', '../../etc/x1', undefined, null, 7, {}, [REF_A], 'abcdef012345\n']) {
    assert.equal(q.openBrief(CAST, bad), 'none', JSON.stringify(bad));
  }
  assert.deepEqual(calls.opened, [], 'the tray was never asked');
  assert.equal(calls.logs.length, 0);
});

test('openBrief: an unknown ref is none and logs nothing', () => {
  const { q, calls } = rig();
  assert.equal(q.openBrief(CAST, '123456789abc'), 'none');
  assert.deepEqual(calls.opened, ['123456789abc']);
  assert.equal(calls.logs.length, 0);
});

test('openBrief: a known ref goes through trayBrief.open to showMainAt (the full action), once, with one names-free use mark', () => {
  const { q, calls } = rig();
  assert.equal(q.openBrief(CAST, REF_A), 'go');
  assert.deepEqual(calls.shown, [{ tab: 'projects', projectId: 'sample-app' }]);
  assert.equal(calls.scans, 0);
  assert.deepEqual(calls.logs, [{ surface: 'quick-jump', action: 'open' }]);
});

test('openBrief: a scan ref calls runScan and not showMainAt', () => {
  const { q, calls } = rig();
  assert.equal(q.openBrief(CAST, REF_SCAN), 'scan');
  assert.equal(calls.scans, 1);
  assert.deepEqual(calls.shown, []);
  assert.deepEqual(calls.logs, [{ surface: 'quick-jump', action: 'open' }]);
});

test('openBrief: a scan that does not start says so and is not counted as a use', () => {
  const { q, calls } = rig({ runScan: () => false });
  const r = q.openBrief(CAST, REF_SCAN);
  assert.match(r.error, /did not start/);
  assert.equal(calls.logs.length, 0);
  assert.match(rig({ runScan: undefined }).q.openBrief(CAST, REF_SCAN).error, /cannot be started/);
});

test('openBrief: a throwing tray answers { error } and never throws', () => {
  const { q } = rig({ trayBrief: { view: () => VIEW, open: () => { throw new Error('boom'); } } });
  assert.deepEqual(q.openBrief(CAST, REF_A), { error: 'boom' });
  assert.equal(rig({ trayBrief: null }).q.openBrief(CAST, REF_A), 'none');
});

// ---- openGo ----
test('openGo: a known space, view or project opens through showMainAt with one use mark each', () => {
  const { q, calls } = rig();
  assert.deepEqual(q.openGo(CAST, { tab: 'money' }), { ok: true });
  assert.deepEqual(q.openGo(CAST, { tab: 'money', sub: 'runway' }), { ok: true });
  assert.deepEqual(q.openGo(CAST, { tab: 'claude', sub: 'sessions' }), { ok: true });
  assert.deepEqual(q.openGo(CAST, { tab: 'projects', projectId: 'sample-app' }), { ok: true });
  assert.deepEqual(calls.shown, [{ tab: 'money' }, { tab: 'money', sub: 'runway' }, { tab: 'claude', sub: 'sessions' }, { tab: 'projects', projectId: 'sample-app' }]);
  assert.deepEqual(calls.logs, Array(4).fill({ surface: 'quick-jump', action: 'open' }));
  for (const l of calls.logs) assert.deepEqual(Object.keys(l).sort(), ['action', 'surface'], 'no names in a mark');
});

test('openGo: extra keys are dropped (a sort never rides along), the route main sees is rebuilt', () => {
  const { q, calls } = rig();
  assert.deepEqual(q.openGo(CAST, { tab: 'projects', sub: 'grid', sort: 'dirty', extra: 'x' }), { ok: true });
  assert.deepEqual(calls.shown, [{ tab: 'projects', sub: 'grid' }]);
});

test('openGo refuses an unknown tab, a bad sub, a projectId not in latest.json and a ../ id', () => {
  const { q, calls } = rig();
  const refused = [
    { tab: 'nowhere' }, { tab: 'Money' }, { tab: 'money', sub: 'nowhere' }, { tab: 'money', sub: 'feed' }, { tab: 'cosmos', sub: 'runway' },
    { tab: 'money', sub: 'Runway' }, { tab: 'money', sub: '../x' },
    { tab: 'projects', projectId: 'not-in-scan' }, { tab: 'projects', projectId: '../x' }, { tab: 'projects', projectId: '..' }, { tab: 'projects', projectId: 'a/b' },
    { tab: 'projects', projectId: 'no name' },
    { tab: 'money', projectId: 'sample-app' },                       // a project id only travels to Projects
    { tab: 'projects', sub: 'grid', projectId: 'sample-app' },       // either a view or a project
    { tab: 'projects', sort: 'zzz' },
    { tab: 7 }, { tab: ['money'] }, { sub: 'runway' }, {}, null, undefined, 'money', 42, [], [{ tab: 'money' }],
    { tab: 'money', sub: 7 }, { tab: 'projects', projectId: 7 },
  ];
  for (const r of refused) { const a = q.openGo(CAST, r); assert.ok(a && typeof a.error === 'string', JSON.stringify(r)); }
  assert.deepEqual(calls.shown, []);
  assert.equal(calls.logs.length, 0);
});

test('openGo: with no latest.json a project cannot be opened (said so), but spaces still can', () => {
  const { q, calls } = rig({ latest: () => null });
  assert.deepEqual(q.openGo(CAST, { tab: 'projects', projectId: 'sample-app' }), { error: 'no projects loaded' });
  assert.deepEqual(q.openGo(CAST, { tab: 'money', sub: 'today' }), { ok: true });
  assert.equal(calls.shown.length, 1);
});

test('openGo: no showMainAt, or one that throws, is an { error } (and not a use mark)', () => {
  const none = rig({ showMainAt: undefined });
  assert.match(none.q.openGo(CAST, { tab: 'money' }).error, /cannot be opened/);
  const boom = rig({ showMainAt: () => { throw new Error('window gone'); } });
  assert.deepEqual(boom.q.openGo(CAST, { tab: 'money' }), { error: 'window gone' });
  assert.equal(boom.calls.logs.length + none.calls.logs.length, 0);
});

test('a log that throws never blocks a jump', () => {
  const { q, calls } = rig({ log: () => { throw new Error('log full'); } });
  assert.deepEqual(q.openGo(CAST, { tab: 'money' }), { ok: true });
  assert.equal(q.openBrief(CAST, REF_A), 'go');
  assert.equal(calls.shown.length, 2);
});

// ---- init ----
test('init registers the three channels and each answers an { error } instead of throwing', async () => {
  const handlers = {};
  const calls = { shown: [] };
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  QT.init({ ipcMain, latest: () => LATEST, trayBrief: { view: () => VIEW, open: () => { throw new Error('x'); } }, showMainAt: (r) => calls.shown.push(r), runScan: () => true, log: () => {}, isCastSender });
  assert.deepEqual(Object.keys(handlers).sort(), ['hq:quick:open-brief', 'hq:quick:open-go', 'hq:quick:read']);
  assert.equal((await handlers['hq:quick:read'](CAST)).status, 'ok');
  assert.deepEqual(await handlers['hq:quick:open-brief'](CAST, REF_A), { error: 'x' });
  assert.deepEqual(await handlers['hq:quick:open-go'](CAST, { tab: 'money' }), { ok: true });
  for (const ch of Object.keys(handlers)) assert.deepEqual(await handlers[ch](MAIN, {}), { error: QT.NOT_HERE });
  assert.doesNotThrow(() => QT.init({}));
  assert.doesNotThrow(() => QT.init());
});
