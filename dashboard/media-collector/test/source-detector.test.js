const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detect } = require('../source-detector');
const { capability, list } = require('../sources');

test('detect classifies hosts and direct-looking paths', () => {
  assert.equal(detect('https://example.com/post/1').source, 'webpage');
  assert.equal(detect('https://example.com/p/a.JPG').source, 'direct');
  assert.equal(detect('https://example.com/p/a.JPG').ext, 'jpg');
  assert.equal(detect('https://www.reddit.com/r/pics/comments/abc/x/').source, 'reddit');
  assert.equal(detect('https://i.redd.it/abc.png').source, 'direct');
  assert.equal(detect('https://someone.tumblr.com/post/1').source, 'tumblr');
  assert.equal(detect('https://64.media.tumblr.com/x/y.gif').source, 'direct');
  assert.equal(detect('https://www.instagram.com/p/abc/').source, 'instagram');
  assert.equal(detect('https://www.facebook.com/x/videos/1').source, 'facebook');
  assert.equal(detect('https://youtu.be/abc').source, 'youtube');
  assert.equal(detect('https://x.com/u/status/1').source, 'x');
  assert.equal(detect('https://www.tiktok.com/@u/video/1').source, 'tiktok');
});

test('detect throws taxonomy errors for bad input', () => {
  assert.throws(() => detect('ftp://x'), (e) => e.code === 'UNSUPPORTED_SCHEME');
  assert.throws(() => detect('http://localhost/x.jpg'), (e) => e.code === 'INVALID_URL');
});

test('every detected source has a registry entry with a state', () => {
  for (const id of ['direct', 'webpage', 'tumblr', 'reddit', 'instagram', 'facebook', 'youtube', 'x', 'tiktok']) {
    const c = capability(id);
    assert.equal(c.id, id);
    assert.ok(['supported', 'limited', 'authorization-required', 'unavailable', 'unsupported'].includes(c.state), id);
    assert.ok(Array.isArray(c.limitations));
  }
  assert.ok(list().length >= 9);
});
