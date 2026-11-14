// node --test dashboard/notify-test.test.mjs
// Fake ipcMain, fake window, fake notify. No Electron, no OS toast, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const N = require('./notify-test.js');

function rig(o = {}) {
  const wc = { id: 'main-wc', isDestroyed: () => false };
  const win = o.noWin ? null : { webContents: wc, isDestroyed: () => !!o.destroyed };
  const calls = [];
  let t = 1000;
  const notify = o.notify || ((title, body) => { calls.push([title, body]); return o.ret; });
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const n = N.init({ ipcMain, notify, getWin: () => win, isSupported: o.isSupported || (() => true), now: () => t });
  return { n, handlers, calls, main: { sender: wc }, other: { sender: { id: 'other-wc' } }, advance: (ms) => { t += ms; } };
}

test('init registers exactly one channel, hq:reach:notify-test', () => {
  const r = rig();
  assert.deepEqual(Object.keys(r.handlers), ['hq:reach:notify-test']);
  assert.equal(N.CHANNEL, 'hq:reach:notify-test');
});

test('one press: notify is called once with the fixed text and the answer is ok:true', () => {
  const r = rig();
  const a = r.handlers[N.CHANNEL](r.main, { title: 'ignored', body: 'ignored' });
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(r.calls, [['WorkspaceHQ · test', 'If you can read this, notifications work on this PC.']]);
  assert.equal(N.TITLE, r.calls[0][0]);
  assert.equal(N.BODY, r.calls[0][1]);
});

test('a second press within 5 s is refused and shows nothing; after 5 s it works again', () => {
  const r = rig();
  r.handlers[N.CHANNEL](r.main);
  r.advance(4999);
  const b = r.handlers[N.CHANNEL](r.main);
  assert.ok(b.error && !b.ok);
  assert.equal(r.calls.length, 1);
  r.advance(1);
  assert.deepEqual(r.handlers[N.CHANNEL](r.main), { ok: true });
  assert.equal(r.calls.length, 2);
});

test('a sender that is not the main window is refused, shows nothing, and does not use the slot', () => {
  const r = rig();
  assert.ok(r.handlers[N.CHANNEL](r.other).error);
  assert.ok(r.handlers[N.CHANNEL](undefined).error);
  assert.ok(r.handlers[N.CHANNEL]({}).error);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.handlers[N.CHANNEL](r.main), { ok: true }, 'the refused calls did not eat the slot');
});

test('no main window, or a destroyed one: refused', () => {
  assert.ok(rig({ noWin: true }).handlers[N.CHANNEL]({ sender: {} }).error);
  const d = rig({ destroyed: true });
  assert.ok(d.handlers[N.CHANNEL](d.main).error);
  assert.equal(d.calls.length, 0);
});

test('unsupported: ok:false with a reason, nothing shown, the slot is not used', () => {
  let on = false;
  const r = rig({ isSupported: () => on });
  assert.deepEqual(r.handlers[N.CHANNEL](r.main), { ok: false, reason: 'not supported' });
  assert.equal(r.calls.length, 0);
  on = true;
  assert.deepEqual(r.handlers[N.CHANNEL](r.main), { ok: true });
});

test('notify answering exactly false counts as unsupported and does not use the slot', () => {
  const r = rig({ ret: false });
  assert.deepEqual(r.handlers[N.CHANNEL](r.main), { ok: false, reason: 'not supported' });
  assert.equal(r.handlers[N.CHANNEL](r.main).ok, false, 'still answered, not rate-refused');
});

test('a throwing isSupported counts as unsupported; a throwing notify answers a fixed error without its message', () => {
  const a = rig({ isSupported: () => { throw new Error('secret detail'); } });
  assert.deepEqual(a.handlers[N.CHANNEL](a.main), { ok: false, reason: 'not supported' });
  const b = rig({ notify: () => { throw new Error('C:\\private\\path boom'); } });
  const ans = b.handlers[N.CHANNEL](b.main);
  assert.deepEqual(ans, { error: 'the notification failed.' });
  assert.ok(!JSON.stringify(ans).includes('private'));
});

test('no notify function wired: unsupported, never a crash', () => {
  const wc = { id: 1 };
  const n = N.create({ notify: undefined, getWin: () => ({ webContents: wc }), isSupported: () => true });
  assert.deepEqual(n.run({ sender: wc }), { ok: false, reason: 'not supported' });
});

test('nothing else is sent: the module holds no network, fs or child_process use, and init without ipcMain is harmless', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('./notify-test.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/require\(['"](?:node:)?(?:https?|net|dgram|fs|child_process|dns|tls)['"]\)/.test(src));
  assert.ok(!/\bfetch\s*\(|\bwriteFile|\bexec(?:File)?\s*\(|\bspawn\s*\(/.test(src));
  assert.doesNotThrow(() => N.init({ notify: () => {}, getWin: () => null }));
});
