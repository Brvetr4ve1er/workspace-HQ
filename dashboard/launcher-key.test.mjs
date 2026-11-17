import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { makeKeyStore } = require('./launcher-key.js');
const crypto = { encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (b) => Buffer.from(b, 'base64').toString() };
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lkey-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('a missing key file makes a key once and the same key comes back', (t) => {
  const dir = tmp(t); const get = makeKeyStore({ dir, crypto });
  const k = get(); assert.match(k, /^[0-9a-f]{64}$/); assert.equal(makeKeyStore({ dir, crypto })(), k);
});
for (const [name, body] of [['garbage', 'not json {'], ['no enc prefix', '{"v":1,"key":"plain"}'], ['an array', '[]'], ['oversized', ' '.repeat(300 * 1024)]]) {
  test('a damaged key.json (' + name + ') is locked and left unchanged, never replaced', (t) => {
    const dir = tmp(t); const f = path.join(dir, 'key.json'); fs.writeFileSync(f, body);
    assert.equal(makeKeyStore({ dir, crypto })(), null);
    assert.equal(fs.readFileSync(f, 'utf8'), body);
  });
}
test('a key.json that is a folder is locked', (t) => {
  const dir = tmp(t); fs.mkdirSync(path.join(dir, 'key.json'));
  assert.equal(makeKeyStore({ dir, crypto })(), null);
});
