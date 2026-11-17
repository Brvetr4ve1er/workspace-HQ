// node --test dashboard/main-window-guard.test.mjs
// The main window stays on its own page: the gate accepts only that exact page once it is named, and a navigation, a redirect or a new window is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const gate = require('./main-gate.js');
const { pin } = require('./main-window-guard.js');

const PAGE = 'C:\\Apps\\Example App\\renderer\\index.html';
const HREF = pathToFileURL(PAGE).href;

function rig() {
  const wc = new EventEmitter();
  wc.isDestroyed = () => false;
  wc.mainFrame = { url: HREF, processId: 3, routingId: 1 };
  wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn; };
  const win = { isDestroyed: () => false, webContents: wc };
  const ask = (url) => gate.fromMain({ sender: wc, senderFrame: { ...wc.mainFrame, url } }, () => win);
  const nav = (ev, url) => { let stopped = false; wc.emit(ev, { preventDefault: () => { stopped = true; } }, url); return stopped; };
  return { wc, win, ask, nav };
}

test('before a page is named the gate still takes any file: address (tests, a window that has not loaded)', () => {
  gate.setAppPage(null);
  const r = rig();
  assert.equal(r.ask('file:///C:/Users/x/Downloads/page.html'), true);
});

test('once the window is pinned the gate accepts only the app page, query and hash ignored, and refuses another local file', (t) => {
  t.after(() => gate.setAppPage(null));
  const r = rig();
  assert.equal(pin(r.win, PAGE), true);
  assert.equal(r.ask(HREF), true);
  assert.equal(r.ask(HREF + '?x=1#top'), true);
  assert.equal(r.ask(HREF.toUpperCase().replace('FILE:', 'file:')), true, 'the drive and folder case does not matter on Windows');
  assert.equal(r.ask('file:///C:/Users/x/Downloads/page.html'), false, 'any other local page');
  assert.equal(r.ask('https://example.invalid/'), false);
  assert.equal(r.ask('about:blank'), false);
});

test('a navigation or a redirect away from the app page is cancelled; the same page again is not; a new window is denied', (t) => {
  t.after(() => gate.setAppPage(null));
  const r = rig();
  pin(r.win, PAGE);
  assert.equal(r.nav('will-navigate', 'file:///C:/Users/x/Downloads/page.html'), true);
  assert.equal(r.nav('will-navigate', 'https://example.invalid/'), true);
  assert.equal(r.nav('will-redirect', 'file:///C:/Users/x/Downloads/page.html'), true);
  assert.equal(r.nav('will-navigate', HREF), false, 'a reload');
  assert.equal(r.nav('will-navigate', HREF + '#settings'), false, 'a hash change');
  assert.deepEqual(r.wc.openHandler({ url: 'https://example.invalid/' }), { action: 'deny' });
});

test('a bad call pins nothing and never throws', () => {
  assert.equal(pin(null, PAGE), false);
  assert.equal(pin({ webContents: new EventEmitter() }, ''), false);
  gate.setAppPage(42);
  assert.equal(gate.defaultAllowUrl('file:///anything.html'), true, 'a non-address names no page');
});
