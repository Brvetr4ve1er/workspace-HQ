const { test } = require('node:test');
const assert = require('node:assert/strict');
const { UmcError, fromNative, fromStatus, toPublic, CATALOG } = require('../errors');

test('taxonomy codes all have message + next', () => {
  for (const [k, v] of Object.entries(CATALOG)) { assert.ok(v.message, k); assert.equal(typeof v.next, 'string'); }
});
test('native + status mapping; public shape carries no stack or url', () => {
  assert.equal(fromNative({ code: 'ENOSPC' }).code, 'DISK_FULL');
  assert.equal(fromNative({ code: 'ETIMEDOUT' }).code, 'NETWORK_TIMEOUT');
  assert.equal(fromNative({ code: 'ENOTFOUND' }).code, 'SOURCE_UNAVAILABLE');
  assert.equal(fromNative({ name: 'AbortError' }).code, 'CANCELLED');
  assert.equal(fromStatus(403).code, 'ACCESS_DENIED');
  assert.equal(fromStatus(429, { 'retry-after': '7' }).extra.retryAfterMs, 7000);
  assert.equal(fromStatus(503).code, 'SOURCE_UNAVAILABLE');
  const p = toPublic(new UmcError('FILE_TOO_LARGE', '3 GB'));
  assert.deepEqual(Object.keys(p).sort(), ['code', 'detail', 'extra', 'message', 'next']);
  assert.equal(new UmcError('ACCESS_DENIED').permanent, true);
  assert.equal(new UmcError('RATE_LIMITED').permanent, false);
  assert.equal(new UmcError('BOGUS').code, 'SOURCE_UNAVAILABLE');
});
