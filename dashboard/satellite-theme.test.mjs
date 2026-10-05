// node --test dashboard/satellite-theme.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyPrefs, follow } = require('./satellite-theme.js');

function fakeEl() {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('applyPrefs maps resolved → data-hq-theme and reduceMotion → data-hq-reduce', () => {
  const el = fakeEl();
  assert.equal(applyPrefs(el, { theme: 'os', resolved: 'light', reduceMotion: true }), true);
  assert.deepEqual(el.attrs, { 'data-hq-theme': 'light', 'data-hq-reduce': '1' });
  applyPrefs(el, { theme: 'dark', resolved: 'dark', reduceMotion: false });
  assert.deepEqual(el.attrs, { 'data-hq-theme': 'dark' });
  applyPrefs(el, { resolved: 'sepia' });
  assert.equal(el.attrs['data-hq-theme'], 'dark', 'anything but light is dark');
  assert.equal(applyPrefs(el, null), false);
  assert.equal(applyPrefs(el, 'light'), false);
});

test('follow: media-query guess first, then main’s get reply', async () => {
  const el = fakeEl();
  follow({ uiPrefs: { get: () => Promise.resolve({ resolved: 'light', reduceMotion: false }), on: () => () => {} } }, el, false);
  assert.equal(el.attrs['data-hq-theme'], 'dark');
  await tick();
  assert.equal(el.attrs['data-hq-theme'], 'light');
});

test('follow: a push that beats the get reply is not overwritten by it', async () => {
  const el = fakeEl();
  let cb = null, resolveGet;
  follow({ uiPrefs: { get: () => new Promise((r) => { resolveGet = r; }), on: (f) => { cb = f; return () => {}; } } }, el, false);
  cb({ resolved: 'light', reduceMotion: true });
  resolveGet({ resolved: 'dark', reduceMotion: false });
  await tick();
  assert.deepEqual(el.attrs, { 'data-hq-theme': 'light', 'data-hq-reduce': '1' });
});

test('follow: no bridge, a throwing get and a rejecting get all keep the guess', async () => {
  const a = fakeEl(); follow(undefined, a, true); assert.equal(a.attrs['data-hq-theme'], 'light');
  const b = fakeEl(); follow({ uiPrefs: { get: () => { throw new Error('x'); } } }, b, false); assert.equal(b.attrs['data-hq-theme'], 'dark');
  const c = fakeEl(); follow({ uiPrefs: { get: () => Promise.reject(new Error('y')) } }, c, true); await tick(); assert.equal(c.attrs['data-hq-theme'], 'light');
});

test('follow returns the push unsubscribe', () => {
  let released = false;
  const off = follow({ uiPrefs: { on: () => () => { released = true; } } }, fakeEl(), false);
  off();
  assert.equal(released, true);
});
