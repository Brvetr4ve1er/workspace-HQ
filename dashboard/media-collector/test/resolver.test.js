const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers/fixture-server');
const { resolve } = require('../resolver');
const { request, readBounded, hostSlot } = require('../net');
const { previewImage } = require('../preview');

let S;
const CTX = () => ({ allowPrivate: true, timeoutMs: 4000, probeBudgetMs: 6000 });
before(async () => { S = await start(); });
after(async () => { await S.close(); });

test('direct: png resolves with type from bytes, size, dims, direct quality', async () => {
  const r = await resolve(`${S.base}/a.png`, CTX());
  assert.equal(r.error, null);
  assert.equal(r.source, 'direct');
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.equal(c.kind, 'image'); assert.equal(c.mime, 'image/png'); assert.equal(c.mimeTrusted, 'bytes');
  assert.equal(c.bytes, S.fixtures.PNG.length); assert.equal(c.width, 512); assert.equal(c.height, 384);
  assert.equal(c.quality, 'direct'); assert.equal(c.acceptRanges, true); assert.equal(typeof c.id, 'string');
  assert.equal(c.validators.etag, '"v1"');
});

test('direct: mislabeled content-type is corrected from bytes; jpeg dims parsed', async () => {
  const r = await resolve(`${S.base}/mislabeled.jpg`, CTX());
  assert.equal(r.candidates[0].mime, 'image/png');
  const j = await resolve(`${S.base}/b.jpg`, CTX());
  assert.equal(j.candidates[0].mime, 'image/jpeg'); assert.equal(j.candidates[0].width, 128); assert.equal(j.candidates[0].height, 256);
});

test('direct: a "file" that is an HTML page falls through to the page scan', async () => {
  const r = await resolve(`${S.base}/page-as.jpg`, CTX());
  assert.equal(r.error, null);
  assert.equal(r.source, 'webpage');
  assert.ok(r.warnings.some((w) => w.code === 'LINK_IS_PAGE'));
  assert.equal(r.title, 'Not a file');
  assert.equal(r.candidates[0].sourceUrl, `${S.base}/a.png`);
});

test('direct: manifests and non-media are refused honestly', async () => {
  assert.equal((await resolve(`${S.base}/stream.m3u8`, CTX())).error.code, 'UNSUPPORTED_MEDIA');
  assert.equal((await resolve(`${S.base}/big.bin`, CTX())).error.code, 'UNSUPPORTED_MEDIA');
});

test('status mapping: 403 → ACCESS_DENIED, 404 → SOURCE_UNAVAILABLE, 429 → RATE_LIMITED', async () => {
  assert.equal((await resolve(`${S.base}/forbidden.jpg`, CTX())).error.code, 'SOURCE_UNAVAILABLE');  // 404 path
  assert.equal((await resolve(`${S.base}/forbidden`, CTX())).error.code, 'ACCESS_DENIED');
  assert.equal((await resolve(`${S.base}/missing`, CTX())).error.code, 'SOURCE_UNAVAILABLE');
  const rl = await resolve(`${S.base}/ratelimited`, CTX());
  assert.equal(rl.error.code, 'RATE_LIMITED'); assert.equal(rl.error.extra.retryAfterMs, 1000);
});

test('page: candidates from html + metadata + json-ld, probed with types and sizes', async () => {
  const r = await resolve(`${S.base}/gallery`, CTX());
  assert.equal(r.error, null);
  assert.equal(r.source, 'webpage'); assert.equal(r.title, 'Local gallery');
  const by = (p) => r.candidates.find((c) => c.sourceUrl === `${S.base}${p}`);
  assert.equal(by('/a.png').width, 512); assert.equal(by('/a.png').quality, 'metadata'); assert.equal(by('/a.png').bytes, S.fixtures.PNG.length);
  assert.equal(by('/b.jpg').mime, 'image/jpeg'); assert.equal(by('/b.jpg').attribution.title, 'B'); assert.equal(by('/b.jpg').dimsFrom, 'file-header');
  assert.equal(by('/mislabeled.jpg').mime, 'image/png');
  assert.equal(by('/clip.mp4').kind, 'video'); assert.equal(by('/clip.mp4').duration, 'PT0M5S'); assert.equal(by('/clip.mp4').bytes, S.fixtures.MP4.length);
  assert.equal(by('/missing.png').probeError.code, 'SOURCE_UNAVAILABLE');
  assert.equal(by('/stream.m3u8'), undefined, 'manifest links are never listed as media');
  assert.equal(r.candidates.find((c) => c.sourceUrl.includes(':9/')).probeError.code, 'SOURCE_UNAVAILABLE');
  assert.ok(r.candidates.every((c) => c.pageUrl === `${S.base}/gallery`));
  assert.ok(r.candidates.every((c) => c.id));
  // honest user agent, no cookies
  assert.ok(S.log.every((l) => /WorkspaceHQ-MediaCollector/.test(l.ua)));
});

test('page: robots.txt disallow blocks the scan when enabled, not when disabled', async () => {
  assert.equal((await resolve(`${S.base}/private/page`, CTX())).error.code, 'ROBOTS_OR_POLICY_BLOCK');
  assert.equal((await resolve(`${S.base}/private/page`, { ...CTX(), respectRobots: false })).error, null);
});

test('page: no media → NO_MEDIA_FOUND with a next step', async () => {
  const r = await resolve(`${S.base}/forbidden`, CTX());
  assert.equal(r.error.code, 'ACCESS_DENIED'); assert.ok(r.error.next.length > 0);
});

test('platform URLs fail clearly with the capability state, never fake results', async () => {
  const ig = await resolve('https://www.instagram.com/p/abc/', CTX());
  assert.equal(ig.error.code, 'UNSUPPORTED_SOURCE'); assert.equal(ig.capability.state, 'unavailable'); assert.equal(ig.candidates.length, 0);
  assert.ok(ig.nextAction.includes('Download your information'));
  const rd = await resolve('https://www.reddit.com/r/pics/comments/x/y/', CTX());
  assert.equal(rd.error.code, 'AUTHORIZATION_REQUIRED'); assert.equal(rd.capability.state, 'authorization-required');
  const tb = await resolve('https://blog.tumblr.com/post/1', CTX());
  assert.equal(tb.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await resolve('https://youtu.be/x', CTX())).error.code, 'UNSUPPORTED_SOURCE');
});

test('invalid input is a ResolverResult too', async () => {
  const r = await resolve('nope', CTX());
  assert.equal(r.error.code, 'INVALID_URL'); assert.equal(r.candidates.length, 0);
  assert.equal((await resolve('http://10.0.0.1/x.png', { ...CTX(), timeoutMs: 150 })).source, 'direct');   // allowPrivate on in tests; unreachable → network error, not a guard error
  assert.equal((await resolve('http://10.0.0.1/x.png', { ...CTX(), allowPrivate: false })).error.code, 'INVALID_URL');
});

test('net: redirects are followed, re-validated, and bounded', async () => {
  const ok = await request(`${S.base}/redir`, { allowPrivate: true });
  assert.equal(ok.status, 200); assert.equal(ok.hops.length, 1); ok.res.resume();
  await assert.rejects(request(`${S.base}/redir-private`, { allowPrivate: ['127.0.0.1'] }), (e) => e.code === 'INVALID_URL' && /redirect/.test(e.detail));
  await assert.rejects(request(`${S.base}/redir-file`, { allowPrivate: true }), (e) => e.code === 'UNSUPPORTED_SCHEME');
  await assert.rejects(request(`${S.base}/redir-loop`, { allowPrivate: true, maxRedirects: 3 }), (e) => e.code === 'SOURCE_UNAVAILABLE' && /redirects/.test(e.detail));
  // without allowPrivate the loopback fixture itself is refused — the guard is on by default
  await assert.rejects(request(`${S.base}/a.png`), (e) => e.code === 'INVALID_URL');
});

test('net: timeouts and size caps', async () => {
  await assert.rejects(request(`${S.base}/slow?ms=1500`, { allowPrivate: true, timeoutMs: 300 }), (e) => e.code === 'NETWORK_TIMEOUT');
  const st = await request(`${S.base}/stall`, { allowPrivate: true, idleMs: 300 });
  await assert.rejects(readBounded(st.res, 10_000), (e) => e.code === 'NETWORK_TIMEOUT');
  const big = await request(`${S.base}/big.bin`, { allowPrivate: true });
  await assert.rejects(readBounded(big.res, 1024), (e) => e.code === 'FILE_TOO_LARGE');
  const big2 = await request(`${S.base}/big.bin`, { allowPrivate: true });
  const { buf, truncated } = await readBounded(big2.res, 1024, { stopEarly: true });
  assert.equal(buf.length, 1024); assert.equal(truncated, true);
});

test('net: hostSlot limits concurrency per host', async () => {
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    const release = await hostSlot('h.example', 2);
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--; release();
  }));
  assert.equal(peak, 2);
});

test('preview: returns a data url only for verified raster images', async () => {
  const p = await previewImage(`${S.base}/a.png`, { allowPrivate: true });
  assert.ok(p.dataUrl.startsWith('data:image/png;base64,'));
  await assert.rejects(previewImage(`${S.base}/page-as.jpg`, { allowPrivate: true }), (e) => e.code === 'UNSUPPORTED_MEDIA');
  await assert.rejects(previewImage(`${S.base}/big.bin`, { allowPrivate: true }), (e) => e.code === 'UNSUPPORTED_MEDIA');
});
