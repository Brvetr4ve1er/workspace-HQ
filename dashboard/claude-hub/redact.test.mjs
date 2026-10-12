import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, MASK } from './redact.mjs';

// secret-shaped strings are assembled at runtime so no literal key is ever committed
const k = (prefix, n, ch = 'A') => prefix + ch.repeat(n);

test('masks each known secret shape and counts hits', () => {
  const cases = [
    ['anthropic-key', k('sk-' + 'ant-', 30)],
    ['stripe-key', k('sk_' + 'live_', 24)],
    ['github-token', k('gh' + 'p_', 36)],
    ['aws-key', 'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['slack-token', k('xo' + 'xb-', 20, '1')],
    ['google-key', k('AI' + 'za', 35)],
    ['jwt', 'eyJ' + 'a'.repeat(12) + '.eyJ' + 'b'.repeat(12) + '.' + 'c'.repeat(12)],
  ];
  for (const [name, secret] of cases) {
    const { text, hits } = maskSecrets('before ' + secret + ' after');
    assert.equal(text, 'before ' + MASK(name) + ' after', name);
    assert.equal(hits, 1, name);
  }
});

test('private key blocks and bearer headers keep their context', () => {
  const pem = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIabc\n-----END ' + 'PRIVATE KEY-----';
  assert.equal(maskSecrets('x ' + pem + ' y').text, 'x ' + MASK('private-key') + ' y');
  const r = maskSecrets('Authorization: Bearer ' + 'z'.repeat(20));
  assert.equal(r.text, 'Authorization: Bearer ' + MASK('bearer'));
});

test('ordinary text, short tokens and non-strings are untouched; masking is idempotent', () => {
  assert.deepEqual(maskSecrets('rotate the key in project-a'), { text: 'rotate the key in project-a', hits: 0 });
  assert.deepEqual(maskSecrets('sk-short'), { text: 'sk-short', hits: 0 });
  assert.deepEqual(maskSecrets(undefined), { text: '', hits: 0 });
  const once = maskSecrets('k=' + k('sk_' + 'test_', 20)).text;
  assert.deepEqual(maskSecrets(once), { text: once, hits: 0 });
});
