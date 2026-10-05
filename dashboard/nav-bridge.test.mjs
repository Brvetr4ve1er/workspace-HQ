// Satellites (mini HUD, tray) deep-link into the main window. These pin the
// route whitelist and the window choreography: create if missing, restore +
// show + focus, push now or once after did-finish-load (latest route wins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const nav = require('./nav-bridge.js');

test('cleanRoute validation table', () => {
  const ok = [
    [{ tab: 'projects' }, { tab: 'projects' }],
    [{ tab: 'projects', sort: 'dirty' }, { tab: 'projects', sort: 'dirty' }],
    [{ tab: 'projects', projectId: 'project-a' }, { tab: 'projects', projectId: 'project-a' }],
    [{ tab: 'system', sub: 'health' }, { tab: 'system', sub: 'health' }],
    [{ tab: 'projects', sub: 'list', projectId: 'Project_A.v2-x', sort: 'worst' }, { tab: 'projects', sub: 'list', projectId: 'Project_A.v2-x', sort: 'worst' }],
    [{ tab: 'home', extra: 1, onclick: 'x', path: '~/dev/project-a' }, { tab: 'home' }],   // unknown keys dropped
    [{ tab: 'home', sub: null, projectId: undefined, sort: null }, { tab: 'home' }],      // null/undefined = absent
    [{ tab: 'ab' }, { tab: 'ab' }],
    [{ tab: 'abcdefghijklmnop' }, { tab: 'abcdefghijklmnop' }],
    [{ tab: 'home', projectId: 'x'.repeat(80) }, { tab: 'home', projectId: 'x'.repeat(80) }],
  ];
  for (const [input, want] of ok) assert.deepEqual(nav.cleanRoute(input), want, JSON.stringify(input));
  for (const s of nav.SORTS) assert.deepEqual(nav.cleanRoute({ tab: 'projects', sort: s }), { tab: 'projects', sort: s });

  const bad = [
    undefined, null, 'projects', 42, true, [], ['projects'], {},
    { tab: '' }, { tab: 'a' }, { tab: 'abcdefghijklmnopq' }, { tab: 'Projects' }, { tab: 'pro jects' },
    { tab: 'proj3cts' }, { tab: 'pro-jects' }, { tab: ['projects'] }, { tab: 7 },
    { tab: 'projects', sub: 'X' }, { tab: 'projects', sub: 1 }, { tab: 'projects', sub: '' },
    { tab: 'projects', projectId: '../etc' }, { tab: 'projects', projectId: 'a/b' }, { tab: 'projects', projectId: 'a b' },
    { tab: 'projects', projectId: '' }, { tab: 'projects', projectId: 'x'.repeat(81) }, { tab: 'projects', projectId: 12 },
    { tab: 'projects', projectId: 'C:\\dev\\project-a' },
    { tab: 'projects', sort: 'zzz' }, { tab: 'projects', sort: 'DIRTY' }, { tab: 'projects', sort: '' }, { tab: 'projects', sort: ['dirty'] },
  ];
  for (const input of bad) assert.equal(nav.cleanRoute(input), null, JSON.stringify(input));
  // a returned route is a fresh object (no prototype tricks ride along)
  const r = nav.cleanRoute(JSON.parse('{"tab":"home","__proto__":{"sort":"dirty"}}'));
  assert.deepEqual(r, { tab: 'home' });
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
});

function fakeWin({ loading = false, minimized = false } = {}) {
  const calls = [];
  const wc = Object.assign(new EventEmitter(), {
    sent: [],
    loading,
    destroyed: false,
    isLoading() { return this.loading; },
    isDestroyed() { return this.destroyed; },
    send(ch, p) { this.sent.push([ch, p]); },
  });
  const w = {
    calls, webContents: wc, destroyed: false, minimized,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    restore() { calls.push('restore'); this.minimized = false; },
    show() { calls.push('show'); },
    focus() { calls.push('focus'); },
  };
  return w;
}

// main.js's createWindow assigns `win` and returns NOTHING — the fake does the same.
function boot(initial) {
  let win = initial || null;
  const handlers = new Map();
  const created = [];
  const api = nav.init({
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    getWin: () => win,
    createWindow: (show) => { created.push(show); win = fakeWin({ loading: true }); },
  });
  return { api, openAt: (r) => handlers.get('hq:open-at')({}, r), created, win: () => win, setWin: (w) => { win = w; } };
}

test('invalid route → false, and the window is not touched', () => {
  const w = fakeWin();
  const b = boot(w);
  assert.equal(b.openAt({ tab: 'projects', sort: 'zzz' }), false);
  assert.equal(b.openAt(null), false);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.webContents.sent, []);
  assert.deepEqual(b.created, []);
});

test('loaded window: show + focus, push the cleaned route now', () => {
  const w = fakeWin();
  const b = boot(w);
  assert.equal(b.openAt({ tab: 'projects', sort: 'dirty', junk: 1 }), true);
  assert.deepEqual(w.calls, ['show', 'focus']);
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'projects', sort: 'dirty' }]]);
  assert.equal(w.webContents.listenerCount('did-finish-load'), 0);
});

test('minimized window is restored before show + focus', () => {
  const w = fakeWin({ minimized: true });
  const b = boot(w);
  assert.equal(b.openAt({ tab: 'home' }), true);
  assert.deepEqual(w.calls, ['restore', 'show', 'focus']);
});

test('loading window: one push after did-finish-load, latest route wins', () => {
  const w = fakeWin({ loading: true });
  const b = boot(w);
  assert.equal(b.openAt({ tab: 'projects', projectId: 'project-a' }), true);
  assert.equal(b.openAt({ tab: 'projects', projectId: 'project-b' }), true);
  assert.deepEqual(w.webContents.sent, [], 'nothing sent while loading');
  assert.equal(w.webContents.listenerCount('did-finish-load'), 1, 'coalesced to one listener');
  w.webContents.loading = false;
  w.webContents.emit('did-finish-load');
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'projects', projectId: 'project-b' }]]);
  w.webContents.emit('did-finish-load');   // a later reload does not replay it
  assert.equal(w.webContents.sent.length, 1);
});

test('a failed load does not drop the pending push (reload-after-write aborts, then finishes)', () => {
  const w = fakeWin({ loading: true });
  const b = boot(w);
  b.openAt({ tab: 'tasks' });
  w.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED');
  w.webContents.emit('did-finish-load');
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'tasks' }]]);
});

test('a route stranded by a load that never finished is not replayed later', () => {
  const w = fakeWin({ loading: true });
  const b = boot(w);
  b.openAt({ tab: 'tasks' });
  w.webContents.loading = false;   // load died without did-finish-load
  b.openAt({ tab: 'home' });
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'home' }]]);
  w.webContents.emit('did-finish-load');   // a later reload finishes
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'home' }]], 'stale tasks route not pushed');
});

test('no window yet → createWindow(true), then the new (loading) window gets the push', () => {
  const b = boot(null);
  assert.equal(b.openAt({ tab: 'claude' }), true);
  assert.deepEqual(b.created, [true]);
  const w = b.win();
  assert.deepEqual(w.calls, ['show', 'focus']);
  assert.deepEqual(w.webContents.sent, []);
  w.webContents.loading = false;
  w.webContents.emit('did-finish-load');
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'claude' }]]);
  // the window now exists: the next call reuses it
  assert.equal(b.openAt({ tab: 'home' }), true);
  assert.deepEqual(b.created, [true]);
});

test('a freshly created window waits for did-finish-load even if isLoading() lags', () => {
  let win = null;
  const h = new Map();
  nav.init({
    ipcMain: { handle: (c, f) => h.set(c, f) },
    getWin: () => win,
    createWindow: () => { win = fakeWin({ loading: false }); },   // loadFile issued, flag not raised yet
  });
  assert.equal(h.get('hq:open-at')({}, { tab: 'life' }), true);
  assert.deepEqual(win.webContents.sent, [], 'not pushed into an empty page');
  win.webContents.emit('did-finish-load');
  assert.deepEqual(win.webContents.sent, [['hq:navigate', { tab: 'life' }]]);
});

test('destroyed window is replaced', () => {
  const dead = fakeWin();
  dead.destroyed = true;
  const b = boot(dead);
  assert.equal(b.openAt({ tab: 'home' }), true);
  assert.deepEqual(b.created, [true]);
  assert.notEqual(b.win(), dead);
  assert.deepEqual(dead.calls, []);
});

test('createWindow that throws or yields no window → false', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const handlers = new Map();
  nav.init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, getWin: () => null, createWindow: () => { throw new Error('boom'); } });
  assert.equal(handlers.get('hq:open-at')({}, { tab: 'home' }), false);
  assert.equal(logged.mock.callCount(), 1);
  const h2 = new Map();
  nav.init({ ipcMain: { handle: (c, f) => h2.set(c, f) }, getWin: () => null, createWindow: () => {} });
  assert.equal(h2.get('hq:open-at')({}, { tab: 'home' }), false);
});

test('init returns openAt for main-side callers (tray)', () => {
  const w = fakeWin();
  const b = boot(w);
  assert.equal(b.api.openAt({ tab: 'projects', sort: 'recent' }), true);
  assert.deepEqual(w.webContents.sent, [['hq:navigate', { tab: 'projects', sort: 'recent' }]]);
});
