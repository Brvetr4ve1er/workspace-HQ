// node --test dashboard/vault-draft.test.mjs
// templateDraft: the deterministic, model-free vault note body. Placeholder chats and fake-shaped keys only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateDraft, quoteLines, draftedBy, NO_MESSAGES, OPENING_MAX, ENDING_MAX, ENDING_LINES } from './vault-draft.mjs';

process.env.TZ = 'UTC';
const conv = (extra = {}) => ({ id: 'code:s-1', source: 'code', title: 'Release planning', started_at: '2026-10-01T10:00:00.000Z', last_at: '2026-10-02T09:00:00.000Z', ...extra });
const u = (text, extra = {}) => ({ role: 'user', text, ...extra });
const a = (text, extra = {}) => ({ role: 'assistant', text, ...extra });
const FAKE_KEY = 'sk-ant-' + 'x1'.repeat(15);          // fake-shaped, matches the Hub's anthropic-key rule
const FAKE_GH = 'ghp_' + 'Ab3'.repeat(11);              // fake-shaped github token

// the two excerpts of a body: the lines under "## Opening request" and under "## Where it ended"
function sections(body) {
  const lines = body.split('\n');
  const i1 = lines.indexOf('## Opening request'), i2 = lines.indexOf('## Where it ended');
  const quoted = (from, to) => lines.slice(from + 1, to).filter((l) => l !== '');
  const tail = lines.slice(i2 + 2);   // one blank line follows the heading
  const endBlock = []; for (const l of tail) { if (l === '') break; endBlock.push(l); }
  return { lines, i1, i2, opening: quoted(i1, i2), ending: endBlock, counts: lines.filter((l) => l !== '').pop() };
}

test('the first owner message and the last Claude message are picked; the counts line says how many and the date', () => {
  const r = templateDraft(conv(), [u('first ask'), a('first answer'), u('second ask'), a('closing answer\nsecond line')]);
  assert.equal(r.error, undefined);
  assert.equal(r.basis, 4);
  const s = sections(r.body);
  assert.deepEqual(s.opening, ['> first ask']);
  assert.deepEqual(s.ending, ['> closing answer', '> second line']);
  assert.equal(s.counts, '4 messages · chat of 2026-10-01');
  assert.equal(r.body.split('\n')[0], '## Opening request');
  assert.equal(r.body.split('\n').filter((l) => /^#{1,6} /.test(l)).length, 2, 'only the two headings the template writes');
  assert.ok(r.body.endsWith('\n'));
});

test('sidechain, tool and empty rows are not part of the chat; the day can be given or is honestly unknown', () => {
  const msgs = [{ role: 'tool', text: 'tool output' }, u('real ask'), a('sub', { is_sidechain: 1 }), a('   '), { role: 'assistant' }, a('real answer'), null, 7];
  const r = templateDraft(conv({ started_at: null, last_at: null }), msgs);
  assert.equal(r.basis, 2);
  const s = sections(r.body);
  assert.deepEqual(s.opening, ['> real ask']);
  assert.deepEqual(s.ending, ['> real answer']);
  assert.equal(s.counts, '2 messages · chat of an unknown date');
  assert.equal(sections(templateDraft(conv(), msgs, { day: '2026-01-05' }).body).counts, '2 messages · chat of 2026-01-05');
  assert.equal(sections(templateDraft(conv({ started_at: 'nope' }), [u('x')]).body).counts, '1 message · chat of 2026-10-02', 'singular, and the last day when the start is unreadable');
});

test('a chat with only one side says so instead of inventing the other', () => {
  const onlyUser = templateDraft(conv(), [u('a question nobody answered')]);
  assert.match(onlyUser.body, /## Where it ended\n\n> \(no reply from Claude in this chat\)\n/);
  const onlyClaude = templateDraft(conv(), [a('an answer with no question')]);
  assert.match(onlyClaude.body, /## Opening request\n\n> \(no message from you in this chat\)\n/);
});

test('caps: the opening is at most 600 characters, the ending at most 8 lines and 900 characters, maxChars lowers both', () => {
  const long = 'word '.repeat(400);                                   // 2000 chars
  const r = templateDraft(conv(), [u(long), a(long)]);
  const s = sections(r.body);
  const open = s.opening.map((l) => l.slice(2)).join('\n');
  assert.ok(Array.from(open).length <= OPENING_MAX && Array.from(open).length > OPENING_MAX - 8, 'opening ' + Array.from(open).length);
  assert.ok(open.endsWith('…'));
  const end = s.ending.map((l) => l.slice(2)).join('\n');
  assert.ok(Array.from(end).length <= ENDING_MAX && Array.from(end).length > ENDING_MAX - 8, 'ending ' + Array.from(end).length);
  assert.ok(end.endsWith('…'));

  const tall = Array.from({ length: 30 }, (_, i) => 'row ' + i).join('\n');
  const t = sections(templateDraft(conv(), [u('q'), a(tall)]).body);
  assert.equal(t.ending.length, ENDING_LINES, 'eight lines');
  assert.equal(t.ending[0], '> row 0');
  assert.equal(t.ending[ENDING_LINES - 1], '> row 7…', 'the cut is marked');
  const exactly8 = Array.from({ length: 8 }, (_, i) => 'row ' + i).join('\n');
  assert.equal(sections(templateDraft(conv(), [u('q'), a(exactly8)]).body).ending[7], '> row 7', 'eight lines is not cut');

  const small = sections(templateDraft(conv(), [u(long), a(long)], { maxChars: 50 }).body);
  for (const part of [small.opening, small.ending]) assert.ok(Array.from(part.map((l) => l.slice(2)).join('\n')).length <= 50);
  const emoji = sections(templateDraft(conv(), [u('🚀'.repeat(700)), a('ok')]).body).opening.join('');
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji), 'cut on a code point: no broken surrogate');
  assert.ok(Array.from(emoji.slice(2)).length <= OPENING_MAX);
});

test('the caps count what lands in the note: escapes added by neutralising do not push an excerpt over', () => {
  const r = templateDraft(conv(), [u('[[a]] '.repeat(300)), a('<b> '.repeat(400))]);
  const s = sections(r.body);
  assert.ok(Array.from(s.opening.map((l) => l.slice(2)).join('\n')).length <= OPENING_MAX);
  assert.ok(Array.from(s.ending.map((l) => l.slice(2)).join('\n')).length <= ENDING_MAX);
});

test('a secret in the chat is masked, even one the Hub did not catch, and one that a cut would have half-exposed', () => {
  const r = templateDraft(conv(), [u('use ' + FAKE_KEY + ' for the call'), a('and ' + FAKE_GH + ' too\nAuthorization: Bearer ' + 'Zz9'.repeat(8))]);
  assert.ok(!r.body.includes(FAKE_KEY) && !r.body.includes(FAKE_GH) && !r.body.includes('Zz9Zz9'));
  assert.match(r.body, /••• secret \(anthropic-key\)/);
  assert.match(r.body, /••• secret \(github-token\)/);
  // a key that straddles the 600 character cut: masked on the whole text first, so the cut never leaves a recognisable stub
  const straddle = templateDraft(conv(), [u('a'.repeat(590) + ' ' + FAKE_KEY + ' tail'), a('ok')]);
  assert.ok(!straddle.body.includes('sk-ant-'), 'no key stub survives the cut');
  // text the Hub already masked passes through unchanged (masking twice changes nothing more)
  const pre = '••• secret (anthropic-key) and ••• secret (github-token)';
  assert.deepEqual(sections(templateDraft(conv(), [u(pre), a('ok')]).body).opening, ['> ' + pre]);
  // a private key block with no END line masks to the end of the message
  const pk = templateDraft(conv(), [u('see -----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\nstill key'), a('ok')]);
  assert.ok(!pk.body.includes('MIIBOg') && !pk.body.includes('still key'));
});

test('hostile chat text cannot break the note: every excerpt line is quoted, nothing starts a heading, frontmatter or rule, no link or tag is made', () => {
  const hostile = [
    '---', 'title: injected', '---', '# a heading', '## another', '===', '***', '___', '[[Some Note]]', '![[embed.png]]', '[[a]][[b]]',
    '<script>alert(1)</script>', '<div class="x">', '</div>', '<!-- comment -->', '%% hidden %%', '#tag and #another-tag', '```', 'code fence', '```',
    '    indented', '- list', '1. numbered', '|a|b|', '\u0007bell', 'tab\there',
  ].join('\n');
  for (const msgs of [[u(hostile), a('ok')], [u('ok'), a(hostile)], [u(hostile), a(hostile)]]) {
    const r = templateDraft(conv(), msgs);
    const s = sections(r.body);
    for (const l of s.opening.concat(s.ending)) assert.ok(l.startsWith('> ') || l === '>', 'unquoted line: ' + JSON.stringify(l));
    assert.ok(!r.body.includes('[['), 'no [[ anywhere');
    assert.ok(!/<[A-Za-z/!?]/.test(r.body.replace(/\\</g, '')), 'no live HTML tag');
    assert.ok(!r.body.includes('%%'), 'no comment opener');
    assert.ok(!/(^|\s)#[\p{L}_-]/u.test(r.body.replace(/\\#/g, '')), 'no tag');
    for (const l of s.opening.concat(s.ending)) { const t = l.slice(2); assert.ok(!/^\s*(#{1,6}(\s|$)|[-=*_]{3,}\s*$)/.test(t), 'a heading or rule line survived: ' + JSON.stringify(l)); }
    assert.equal(r.body.split('\n')[0], '## Opening request', 'the body never starts with chat text');
    assert.ok(!/^---/m.test(r.body), 'no frontmatter fence at a line start');
    assert.equal(r.body.split('\n').filter((l) => /^#{1,6} /.test(l)).length, 2);
    assert.equal(r.body.split('\n').filter((l) => /^(\s*)(\d+\.|-|\*|\||```|    )/.test(l)).length, 0, 'no list, table, fence or code block outside a quote');
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.body), 'control characters are gone');
  }
  assert.equal(quoteLines('[[x]]\n\n# y'), '> [ [x]]\n> \n> \\# y');
});

test('empty, tool-only and malformed chats answer the existing "no messages" error', () => {
  for (const msgs of [[], undefined, null, 'x', [{ role: 'tool', text: 'out' }], [a('side', { is_sidechain: true })], [u('   '), a('')], [{ role: 'system', text: 'x' }]]) {
    assert.deepEqual(templateDraft(conv(), msgs), { error: NO_MESSAGES }, JSON.stringify(msgs));
  }
  assert.equal(NO_MESSAGES, 'that chat has no messages from you or Claude to summarise');
  assert.doesNotThrow(() => templateDraft(null, [u('x')]));
  assert.doesNotThrow(() => templateDraft(undefined, [u('x')], null));
});

test('deterministic: the same input is the same bytes, and the input is not changed', () => {
  const msgs = [u('ask [[x]] ' + FAKE_KEY), a('line one\nline two\n\n\n\nline three')];
  const before = JSON.stringify(msgs);
  const r1 = templateDraft(conv(), msgs), r2 = templateDraft(conv(), msgs);
  assert.equal(r1.body, r2.body);
  assert.equal(Buffer.compare(Buffer.from(r1.body), Buffer.from(r2.body)), 0);
  assert.equal(JSON.stringify(msgs), before);
  assert.match(r1.body, /> line two\n> \n> line three/, 'runs of blank lines collapse to one, kept quoted');
});

test('drafted_by wording', () => {
  assert.equal(draftedBy(12), 'a template, no model, from 12 chat messages');
  assert.equal(draftedBy('x'), 'a template, no model, from 0 chat messages');
});
