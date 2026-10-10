const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeComponent, buildName, resolveCollision, hintFromUrl, DEFAULT_TEMPLATE } = require('../filenames');

test('sanitizeComponent strips traversal, separators, reserved names, control chars', () => {
  assert.equal(sanitizeComponent('../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeComponent('..\\..\\win.ini'), 'win.ini');
  assert.equal(sanitizeComponent('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(sanitizeComponent('CON'), 'item');
  assert.equal(sanitizeComponent('lpt1.txt'), 'item');
  assert.equal(sanitizeComponent('  .hidden.  '), 'hidden');
  assert.equal(sanitizeComponent('tab\there\u0000null'), 'tabherenull');
  assert.equal(sanitizeComponent('rtl‮evil'), 'rtlevil');
  assert.equal(sanitizeComponent(''), 'item');
  assert.equal(sanitizeComponent('x'.repeat(300)).length, 80);
  assert.equal(sanitizeComponent('a....b'), 'ab');
});

test('buildName follows the template and always ends with a sane extension', () => {
  const n = buildName(DEFAULT_TEMPLATE, { source: 'web', date: '2026-10-10', title: 'Hello / World', id: 'abc', index: 3, ext: 'JPG' });
  assert.equal(n, 'web_2026-10-10_Hello - World_03.jpg');
  assert.equal(buildName('{title-or-id}', { id: 'xyz', ext: 'png' }), 'xyz.png');
  assert.equal(buildName('{host}/{title}.{ext}', { host: 'a.com', title: 'b', ext: 'mp4' }), 'a.com-b.mp4');
  assert.equal(buildName('{nope}', { ext: 'gif' }), 'media.gif');
  assert.equal(buildName('{title}.{ext}', { title: '../../x', ext: '../sh' }), 'x.sh');
  assert.equal(buildName('{title}.{ext}', { title: 'CON', ext: 'exe' }), 'media.exe');
});

test('resolveCollision is deterministic', () => {
  const taken = new Set(['a.jpg', 'a (2).jpg']);
  assert.equal(resolveCollision('a.jpg', (n) => taken.has(n)), 'a (3).jpg');
  assert.equal(resolveCollision('b.jpg', (n) => taken.has(n)), 'b.jpg');
  assert.equal(resolveCollision('noext', (n) => n === 'noext'), 'noext (2)');
});

test('hintFromUrl decodes the last path segment', () => {
  assert.equal(hintFromUrl('https://x.com/a/b/My%20File.JPG?sig=1'), 'My File.JPG');
  assert.equal(hintFromUrl('https://x.com/'), '');
});
