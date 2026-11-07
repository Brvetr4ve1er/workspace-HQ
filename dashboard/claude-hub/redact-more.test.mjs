// Extra masking rules (recall dish, commit 2). Placeholder values only; every key-shaped value is assembled at run time
// so no secret-looking literal sits in the repo.
//   node --test dashboard/claude-hub/redact-more.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskMore, maskSnippet, maskText, dropCutKeyEdges, EXTRA_RULES, MASK } from './redact-more.mjs';
import { maskSecrets } from './redact.mjs';

const rep = (ch, n) => ch.repeat(n);
const hex = (n) => rep('a1b2c3d4', Math.ceil(n / 8)).slice(0, n);
const alnum = (n) => rep('Zx9Qm2Lp', Math.ceil(n / 8)).slice(0, n);

// [rule, positive text, expected to be gone, negative text (must be untouched)]
const CASES = [
  ['url-credentials', 'clone https://alpha-user:' + alnum(12) + '@git.alpha-site.test/repo.git now', alnum(12),
    'open https://git.alpha-site.test:8443/repo.git and https://alpha-user@alpha-site.test/x'],
  ['env-secret', 'export ALPHA_SERVICE_TOKEN=' + alnum(24), alnum(24), 'PASSWORD= then nothing, MAX_TOKENS=4096, ALPHA_TOKEN=$ALPHA_TOKEN'],
  ['env-secret', 'DB_PASSWORD="' + alnum(16) + '"', alnum(16), 'DB_PASSWORD=<your password here>'],
  ['password', 'my password is ' + alnum(10) + ' ok', alnum(10), 'the password field is required'],
  ['password', 'password: ' + alnum(10), alnum(10), 'password: none'],
  ['password', 'mon mot de passe est ' + alnum(10), alnum(10), 'mot de passe oublié, voir la page'],
  ['password', 'mdp : ' + alnum(9), alnum(9), 'the password is stored hashed'],
  ['api-key', 'api_key: ' + alnum(20), alnum(20), 'api_key: your-key-here and apikey is optional'],
  ['api-key', '{"apiKey": "' + alnum(20) + '"}', alnum(20), 'the api key rotates monthly'],
  ['secret-value', 'token: ' + 'ab12' + alnum(12), alnum(12), 'token: none, secret: management plan, token=short1'],
  ['firecrawl-key', 'FIRECRAWL key ' + 'fc' + '-' + hex(32), hex(32), 'fc-short and abc-' + hex(32)],
  ['supabase-key', 'cli ' + 'sbp' + '_' + hex(40), hex(40), 'sbp_short sbpx_' + hex(40)],
  ['supabase-key', 'new ' + 'sb' + '_secret_' + alnum(28), alnum(28), 'sb_publishable_' + alnum(28)],
  ['telegram-bot-token', 'bot ' + '1234567890' + ':' + alnum(35), alnum(35), 'at 12:30:45 or 1234567890:short'],
];

for (const [rule, positive, gone, negative] of CASES) {
  test('rule ' + rule + ': masks "' + positive.slice(0, 28) + '…" and leaves prose alone', () => {
    const r = maskMore(positive);
    assert.ok(r.hits >= 1, 'a hit');
    assert.ok(!r.text.includes(gone), 'secret gone: ' + r.text);
    assert.ok(r.text.includes(MASK(rule)), 'masked as ' + rule + ': ' + r.text);
    const n = maskMore(negative);
    assert.equal(n.hits, 0, 'negative hit: ' + n.text);
    assert.equal(n.text, negative);
  });
}

test('every rule in EXTRA_RULES has a case above, and carries the redact.mjs rule shape', () => {
  const covered = new Set(CASES.map((c) => c[0]));
  for (const r of EXTRA_RULES) {
    assert.ok(covered.has(r.name), 'case for ' + r.name);
    assert.ok(r.re instanceof RegExp && r.re.global, r.name + ' is global');
  }
});

test('url credentials: scheme and host are kept', () => {
  const r = maskMore('https://alpha-user:' + alnum(12) + '@git.alpha-site.test/repo.git');
  assert.equal(r.text, 'https://' + MASK('url-credentials') + '@git.alpha-site.test/repo.git');
});

test('env and prose rules keep the label, only the value goes', () => {
  assert.equal(maskMore('ALPHA_API_KEY=' + alnum(20)).text, 'ALPHA_API_KEY=' + MASK('env-secret'));
  assert.equal(maskMore('password is ' + alnum(10)).text, 'password is ' + MASK('password'));
});

test('masking twice changes nothing more', () => {
  const text = ['https://u:' + alnum(10) + '@h.test/x', 'ALPHA_TOKEN=' + alnum(20), 'password is ' + alnum(9), 'api_key: ' + alnum(16),
    'token: ab12' + alnum(10), 'fc' + '-' + hex(32), 'sbp' + '_' + hex(40), '1234567890:' + alnum(35)].join('\n');
  const once = maskMore(text);
  const twice = maskMore(once.text);
  assert.equal(twice.text, once.text);
  assert.equal(twice.hits, 0);
});

test('stacking on the existing rules is stable too (redact.mjs first, then these)', () => {
  const text = 'url https://u:sk' + '-ant-' + alnum(30) + '@h.test and ALPHA_TOKEN=' + alnum(20);
  const a = maskMore(maskSecrets(text).text).text;
  assert.equal(maskMore(maskSecrets(a).text).text, a);
  assert.ok(!a.includes(alnum(30)) && !a.includes(alnum(20)));
});

test('non-strings and empty input never throw', () => {
  for (const v of [undefined, null, 5, {}, '']) assert.deepEqual(maskMore(v), { text: '', hits: 0 });
  assert.equal(maskText(undefined), '');
});

test('maskSnippet: highlight markers are stripped before matching, and a changed snippet comes back without them', () => {
  const key = 'fc' + '-' + hex(32);
  const S = '\u0002', E = '\u0003';
  const snippet = 'the key ' + S + 'fc' + E + '-' + hex(32) + ' was pasted';   // a marker splits the key
  assert.ok(!maskMore(snippet).text.includes(MASK('firecrawl-key')), 'unstripped, the marker defeats the rule');
  const out = maskSnippet(snippet, (t) => maskSecrets(t));
  assert.ok(out.includes(MASK('firecrawl-key')));
  assert.ok(!out.includes(hex(32)) && !/[\u0002\u0003]/.test(out));
  assert.ok(!out.includes(key));
});

test('maskSnippet: an unchanged snippet keeps its highlights', () => {
  const S = '\u0002', E = '\u0003';
  const snippet = '…we chose the ' + S + 'release' + E + ' plan…';
  assert.equal(maskSnippet(snippet, (t) => maskSecrets(t)), snippet);
});

test('maskSnippet: a cut at the edge that leaves only the body of a key drops the orphan', () => {
  const body = hex(32);
  const left = '…' + body + ' was the key for alpha-site';
  const right = 'alpha-site used key fc ' + body + '…';
  const l = maskSnippet(left, (t) => maskSecrets(t));
  const r = maskSnippet(right, (t) => maskSecrets(t));
  assert.ok(!l.includes(body) && l.startsWith('…') && l.includes('was the key'));
  assert.ok(!r.includes(body) && r.endsWith('…') && r.includes('alpha-site used key'));
  assert.equal(dropCutKeyEdges('plain words only…'), 'plain words only…');
  assert.equal(dropCutKeyEdges('…short words'), '…short words');
});

test('maskSnippet and maskText take a missing or odd mask function', () => {
  assert.equal(maskSnippet('hello \u0002world\u0003', undefined), 'hello \u0002world\u0003');
  assert.equal(maskText('ALPHA_TOKEN=' + alnum(20), null), 'ALPHA_TOKEN=' + MASK('env-secret'));
  assert.equal(maskText('x', () => ({ text: 'y', hits: 0 })), 'y');
  assert.equal(maskText('x', () => 'z'), 'z');
});
