// One theme + one reduce-motion switch for every window, held by main. These pin
// the persistence (atomic, corrupt-tolerant), the whitelist, and the broadcast
// (every live window, never a destroyed one; OS theme flips re-sent for 'os').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const uiPrefs = require('./ui-prefs.js');

function fakeWin({ destroyed = false, wcDestroyed = false } = {}) {
  const sent = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { isDestroyed: () => wcDestroyed, send: (ch, p) => sent.push([ch, p]) },
  };
}

// Fresh userData dir + fakes per test; `dir` reuse = an app restart.
function boot({ dir, dark = true, wins = [fakeWin()] } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ui-prefs-'));
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => { assert.ok(!handlers.has(ch), `${ch} registered twice`); handlers.set(ch, fn); } };
  const app = { getPath: (k) => { assert.equal(k, 'userData'); return dir; } };
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: dark });
  const BrowserWindow = { getAllWindows: () => wins };
  const api = uiPrefs.init({ ipcMain, app, nativeTheme, BrowserWindow });
  const get = () => handlers.get('hq:ui-prefs-get')({});
  const set = (patch) => handlers.get('hq:ui-prefs-set')({}, patch);
  return { dir, file: path.join(dir, 'ui-prefs.json'), api, get, set, nativeTheme, wins };
}
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('no file → defaults; get() and the ipc handler agree', (t) => {
  const b = boot(); t.after(() => cleanup(b.dir));
  assert.deepEqual(b.get(), { theme: 'dark', resolved: 'dark', reduceMotion: false });
  assert.deepEqual(b.api.get(), b.get());
  assert.equal(fs.existsSync(b.file), false, 'reading never writes');
});

test('set persists atomically and survives a restart', (t) => {
  const b = boot(); t.after(() => cleanup(b.dir));
  assert.deepEqual(b.set({ theme: 'light', reduceMotion: true }), { theme: 'light', resolved: 'light', reduceMotion: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(b.file, 'utf8')), { theme: 'light', reduceMotion: true });
  assert.deepEqual(fs.readdirSync(b.dir), ['ui-prefs.json'], 'no .tmp left behind');
  const again = boot({ dir: b.dir });
  assert.deepEqual(again.get(), { theme: 'light', resolved: 'light', reduceMotion: true });
  // a partial patch keeps the other key
  assert.deepEqual(again.set({ reduceMotion: false }), { theme: 'light', resolved: 'light', reduceMotion: false });
});

test('corrupt or wrong-shaped file → defaults, and the next set rewrites it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ui-prefs-')); t.after(() => cleanup(dir));
  const file = path.join(dir, 'ui-prefs.json');
  for (const junk of ['{not json', '[]', '"light"', 'null', '42']) {
    fs.writeFileSync(file, junk);
    assert.deepEqual(boot({ dir }).get(), { theme: 'dark', resolved: 'dark', reduceMotion: false }, junk);
  }
  fs.writeFileSync(file, '{not json');
  const b = boot({ dir });
  b.set({ theme: 'os' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { theme: 'os', reduceMotion: false });
});

test('a half-valid file keeps its valid keys only', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ui-prefs-')); t.after(() => cleanup(dir));
  fs.writeFileSync(path.join(dir, 'ui-prefs.json'), JSON.stringify({ theme: 'light', reduceMotion: 'yes', extra: 1 }));
  assert.deepEqual(boot({ dir }).get(), { theme: 'light', resolved: 'light', reduceMotion: false });
  fs.writeFileSync(path.join(dir, 'ui-prefs.json'), JSON.stringify({ theme: 'neon', reduceMotion: true }));
  assert.deepEqual(boot({ dir }).get(), { theme: 'dark', resolved: 'dark', reduceMotion: true });
});

test('invalid patch keys and values are ignored — no write, no push', (t) => {
  const w = fakeWin();
  const b = boot({ wins: [w] }); t.after(() => cleanup(b.dir));
  const before = b.get();
  for (const patch of [
    undefined, null, 'light', 42, ['light'], {},
    { theme: 'blue' }, { theme: 'DARK' }, { theme: 1 }, { reduceMotion: 'true' }, { reduceMotion: 1 },
    { resolved: 'light' }, { evil: true }, JSON.parse('{"__proto__":{"theme":"light"}}'),
    { theme: 'dark' }, { reduceMotion: false },   // valid but unchanged
  ]) assert.deepEqual(b.set(patch), before, JSON.stringify(patch));
  assert.equal(fs.existsSync(b.file), false);
  assert.equal(w.sent.length, 0);
  assert.equal({}.theme, undefined, 'no prototype pollution');
  // valid keys still apply when mixed with junk
  assert.deepEqual(b.set({ theme: 'light', reduceMotion: 'nope', color: 'red' }), { theme: 'light', resolved: 'light', reduceMotion: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(b.file, 'utf8')), { theme: 'light', reduceMotion: false });
});

test('a change is pushed to every live window and skips destroyed ones', (t) => {
  const live1 = fakeWin(), live2 = fakeWin(), dead = fakeWin({ destroyed: true }), deadWc = fakeWin({ wcDestroyed: true });
  const throwing = fakeWin(); throwing.webContents.send = () => { throw new Error('gone'); };
  const b = boot({ wins: [live1, dead, throwing, deadWc, live2] }); t.after(() => cleanup(b.dir));
  const r = b.set({ reduceMotion: true });
  const want = [['hq:ui-prefs', { theme: 'dark', resolved: 'dark', reduceMotion: true }]];
  assert.deepEqual(r, want[0][1]);
  assert.deepEqual(live1.sent, want);
  assert.deepEqual(live2.sent, want, 'a throwing window does not stop the fan-out');
  assert.equal(dead.sent.length, 0);
  assert.equal(deadWc.sent.length, 0);
});

test("'os' resolves through nativeTheme and re-broadcasts on an OS flip", (t) => {
  const w = fakeWin();
  const b = boot({ dark: false, wins: [w] }); t.after(() => cleanup(b.dir));
  // not 'os' yet: an OS flip is nobody's business
  b.nativeTheme.emit('updated');
  assert.equal(w.sent.length, 0);
  assert.deepEqual(b.set({ theme: 'os' }), { theme: 'os', resolved: 'light', reduceMotion: false });
  b.nativeTheme.shouldUseDarkColors = true;
  b.nativeTheme.emit('updated');
  assert.deepEqual(w.sent.at(-1), ['hq:ui-prefs', { theme: 'os', resolved: 'dark', reduceMotion: false }]);
  assert.equal(b.get().resolved, 'dark', 'resolved is computed at read time');
  // back to a fixed theme: OS flips stop pushing
  b.set({ theme: 'light' });
  const n = w.sent.length;
  b.nativeTheme.shouldUseDarkColors = false;
  b.nativeTheme.emit('updated');
  assert.equal(w.sent.length, n);
});

test('an unwritable userData keeps the change for this session and still pushes', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ui-prefs-')); t.after(() => cleanup(parent));
  const blocker = path.join(parent, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');   // userData path is a FILE → mkdir/write fail
  const w = fakeWin();
  const b = boot({ dir: blocker, wins: [w] });
  assert.deepEqual(b.set({ theme: 'light' }), { theme: 'light', resolved: 'light', reduceMotion: false });
  assert.deepEqual(b.get().theme, 'light');
  assert.equal(w.sent.length, 1);
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'x', 'nothing clobbered');
});

test('pure helpers: view without nativeTheme, sanitize whitelist', () => {
  assert.deepEqual(uiPrefs.view({ theme: 'os', reduceMotion: 0 }), { theme: 'os', resolved: 'dark', reduceMotion: false });
  assert.deepEqual(uiPrefs.view({ theme: 'os' }, { shouldUseDarkColors: false }).resolved, 'light');
  assert.deepEqual(uiPrefs.sanitize({ theme: 'os', reduceMotion: true, x: 1 }), { theme: 'os', reduceMotion: true });
  assert.deepEqual(uiPrefs.sanitize([]), {});
  assert.ok(Object.isFrozen(uiPrefs.DEFAULTS));
});
