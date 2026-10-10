const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseUrl, isPublicIp, redactUrl, resolvePublic } = require('../url-safety');

const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

test('parseUrl accepts public http(s) and strips fragments', () => {
  assert.equal(parseUrl('https://example.com/a/b.jpg?x=1#frag').href, 'https://example.com/a/b.jpg?x=1');
  assert.equal(parseUrl('  http://example.com  ').href, 'http://example.com/');
});

test('parseUrl rejects schemes, credentials, empties, control chars', () => {
  assert.equal(codeOf(() => parseUrl('file:///etc/passwd')), 'UNSUPPORTED_SCHEME');
  assert.equal(codeOf(() => parseUrl('javascript:alert(1)')), 'UNSUPPORTED_SCHEME');
  assert.equal(codeOf(() => parseUrl('data:image/png;base64,AAAA')), 'UNSUPPORTED_SCHEME');
  assert.equal(codeOf(() => parseUrl('ftp://example.com/x')), 'UNSUPPORTED_SCHEME');
  assert.equal(codeOf(() => parseUrl('https://user:pw@example.com/')), 'INVALID_URL');
  assert.equal(codeOf(() => parseUrl('')), 'INVALID_URL');
  assert.equal(codeOf(() => parseUrl('not a url')), 'INVALID_URL');
  assert.equal(codeOf(() => parseUrl('https://exa\nmple.com')), 'INVALID_URL');
});

test('parseUrl rejects local and private hostnames / literal addresses', () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.1.2.3/x', 'http://192.168.1.1/',
    'http://172.16.5.5/', 'http://169.254.169.254/latest/meta-data', 'http://metadata.google.internal/', 'http://foo.local/',
    'http://intranet/', 'http://0.0.0.0/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://2130706433/', 'http://0x7f000001/',
    'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://100.64.0.1/']) {
    assert.equal(codeOf(() => parseUrl(u)), 'INVALID_URL', u);
  }
});

test('isPublicIp classifies v4 and v6 ranges', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('93.184.216.34'), true);
  assert.equal(isPublicIp('2606:4700::1111'), true);
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.0.1', '172.31.255.255', '169.254.1.1', '224.0.0.1', '255.255.255.255',
    '0.0.0.0', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:c0a8:101::']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  assert.equal(isPublicIp('not-an-ip'), false);
});

test('resolvePublic: literal private IP is refused unless allowPrivate', async () => {
  await assert.rejects(resolvePublic('127.0.0.1'), (e) => e.code === 'INVALID_URL');
  const a = await resolvePublic('127.0.0.1', { allowPrivate: true });
  assert.equal(a[0].address, '127.0.0.1');
});

test('allowPrivate allowlist lifts the guard for named hosts only', async () => {
  await assert.rejects(resolvePublic('169.254.169.254', { allowPrivate: ['127.0.0.1'] }), (e) => e.code === 'INVALID_URL');
  assert.equal((await resolvePublic('127.0.0.1', { allowPrivate: ['127.0.0.1'] }))[0].address, '127.0.0.1');
  assert.equal(parseUrl('http://127.0.0.1/x', { allowPrivate: ['127.0.0.1'] }).hostname, '127.0.0.1');
  assert.equal(codeOf(() => parseUrl('http://10.0.0.1/x', { allowPrivate: ['127.0.0.1'] })), 'INVALID_URL');
});

test('redactUrl keeps origin+path only', () => {
  assert.equal(redactUrl('https://cdn.example.com/a/b.mp4?X-Amz-Signature=abc&token=1#x'), 'https://cdn.example.com/a/b.mp4');
  assert.equal(redactUrl('garbage'), '[invalid url]');
});
