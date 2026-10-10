const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractCandidates, bestFromSrcset } = require('../html-parse');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const byUrl = (r, u) => r.candidates.find((c) => c.sourceUrl === u);

test('gallery fixture: elements, srcset, picture, video, audio, og, json-ld, links', () => {
  const r = extractCandidates(fixture('gallery.html'), 'https://site.example/posts/42');
  assert.equal(r.title, 'Autumn gallery');
  const urls = r.candidates.map((c) => c.sourceUrl);
  assert.ok(urls.includes('https://cdn.example/img/one-2048.jpg'), 'largest srcset entry');
  assert.equal(byUrl(r, 'https://cdn.example/img/one-2048.jpg').quality, 'page-largest-variant');
  assert.equal(byUrl(r, 'https://cdn.example/img/one-2048.jpg').width, 2048);
  assert.ok(urls.includes('https://site.example/posts/relative/two.png'), 'relative src resolved');
  assert.ok(urls.includes('https://cdn.example/pic/three@2x.avif'), 'picture source, densest variant');
  assert.equal(byUrl(r, 'https://cdn.example/pic/three@2x.avif').quality, 'page-largest-variant');
  assert.ok(urls.includes('https://cdn.example/v/clip.mp4'), 'video source');
  assert.equal(byUrl(r, 'https://cdn.example/v/clip.mp4').kind, 'video');
  assert.equal(byUrl(r, 'https://cdn.example/v/poster.jpg').quality, 'thumbnail');
  assert.ok(urls.includes('https://cdn.example/a/song.mp3'), 'audio');
  assert.equal(byUrl(r, 'https://cdn.example/og.jpg').via.includes('og:image'), true);
  assert.equal(byUrl(r, 'https://cdn.example/og.jpg').width, 1200);
  assert.equal(byUrl(r, 'https://cdn.example/og.jpg').height, 630);
  assert.equal(byUrl(r, 'https://cdn.example/ld/photo.jpg').title, 'Leaf close-up');
  assert.equal(byUrl(r, 'https://cdn.example/ld/movie.mp4').duration, 'PT1M30S');
  assert.ok(urls.includes('https://cdn.example/dl/raw-file.mov'), 'linked media file');
  assert.ok(!urls.includes('https://site.example/posts/other-page'), 'non-media links ignored');
  assert.ok(!urls.some((u) => u.startsWith('data:')), 'data: urls ignored');
  assert.ok(!urls.includes('https://track.example/pixel.gif'), '1x1 pixel ignored');
  assert.ok(!urls.some((u) => u.includes('javascript')), 'javascript: ignored');
  assert.equal(r.truncated, false);
});

test('base href and dedup merge', () => {
  const html = `<html><head><base href="https://b.example/root/"></head><body>
    <img src="x.jpg" width="100"><img src="x.jpg" height="50" alt="same">
    <meta property="og:image" content="x.jpg"></body></html>`;
  const r = extractCandidates(html, 'https://a.example/page');
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.equal(c.sourceUrl, 'https://b.example/root/x.jpg');
  assert.equal(c.width, 100); assert.equal(c.height, 50);
  assert.deepEqual(c.via, ['img', 'og:image']);
});

test('candidate cap marks partial results', () => {
  const imgs = Array.from({ length: 50 }, (_, i) => `<img src="/i/${i}.jpg">`).join('');
  const r = extractCandidates(`<html><body>${imgs}</body></html>`, 'https://x.example/', { maxCandidates: 10 });
  assert.equal(r.candidates.length, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.dropped, 40);
});

test('malformed html and hostile content never throw', () => {
  assert.doesNotThrow(() => extractCandidates('<img src="<script>"><<<>>><a href="javascript:x">', 'https://x.example/'));
  assert.doesNotThrow(() => extractCandidates('<script type="application/ld+json">{not json</script>', 'https://x.example/'));
  const r = extractCandidates('<a href="file:///etc/passwd.jpg">x</a><img src="http://127.0.0.1/x.jpg">', 'https://x.example/');
  // private-address candidates are still LISTED here (pure parser); the
  // network layer refuses them when fetched — the parser's job is only scheme safety.
  assert.ok(!r.candidates.some((c) => c.sourceUrl.startsWith('file:')));
});

test('bestFromSrcset picks the largest width or density', () => {
  assert.equal(bestFromSrcset('a.jpg 320w, b.jpg 1280w, c.jpg 640w').url, 'b.jpg');
  assert.equal(bestFromSrcset('a.jpg 1x, b.jpg 2x').url, 'b.jpg');
  assert.equal(bestFromSrcset(''), null);
});
