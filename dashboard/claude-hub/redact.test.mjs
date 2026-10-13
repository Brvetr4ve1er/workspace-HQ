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

test('an unterminated private key block is masked to the end of the text (the parser cuts long tool results, losing the END marker)', () => {
  const begin = '-----BEGIN ' + 'RSA PRIVATE KEY-----\n';
  const body = 'M'.repeat(2000);
  // a cut key: header, body, and the parser's '…' cut marker, but no END line
  const cut = maskSecrets('printed:\n' + begin + body + '…');
  assert.equal(cut.text, 'printed:\n' + MASK('private-key'));
  assert.equal(cut.hits, 1);
  assert.ok(!cut.text.includes('MMMM'), 'no key material survives');
  // text that follows a cut block inside the same indexed string is masked too (conservative: never leak the tail)
  assert.equal(maskSecrets(begin + body + '…\nnext tool result').text, MASK('private-key'));
});

test('a terminated block and a later unterminated one are both masked, each once; the result is stable', () => {
  const head = (n) => '-----BEGIN ' + n + 'PRIVATE KEY-----\n';
  const done = head('') + 'AAAA\n-----END ' + 'PRIVATE KEY-----';
  const r = maskSecrets('one ' + done + ' two ' + head('EC ') + 'BBBB'.repeat(500));
  assert.equal(r.text, 'one ' + MASK('private-key') + ' two ' + MASK('private-key'));
  assert.equal(r.hits, 2);
  assert.deepEqual(maskSecrets(r.text), { text: r.text, hits: 0 });
  // a terminated block is still masked by the precise rule only (text after its END marker is kept)
  assert.equal(maskSecrets(done + ' kept').text, MASK('private-key') + ' kept');
});

test('ordinary text, short tokens and non-strings are untouched; masking is idempotent', () => {
  assert.deepEqual(maskSecrets('rotate the key in project-a'), { text: 'rotate the key in project-a', hits: 0 });
  assert.deepEqual(maskSecrets('sk-short'), { text: 'sk-short', hits: 0 });
  assert.deepEqual(maskSecrets(undefined), { text: '', hits: 0 });
  const once = maskSecrets('k=' + k('sk_' + 'test_', 20)).text;
  assert.deepEqual(maskSecrets(once), { text: once, hits: 0 });
});
