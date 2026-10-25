// dashboard/claude-hub/context.test.mjs
// Ask grounding from the Hub index (Claude Hub H5, spec 2026-10-13 §6 contextFor, §9 Ask). In-memory stores with
// placeholder chats only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, SNIP_START, SNIP_END } from './store.mjs';
import { MASK } from './redact.mjs';
import { keywords, contextMatch, formatContext, contextFor, localDay, HEADER, CONTEXT_MAX, MAX_CHATS, PER_CHAT } from './context.mjs';

process.env.TZ = 'UTC';   // localDay → the UTC day in these tests

let n = 0;
const m = (text, at, role = 'user', extra = {}) => ({ id: 'm' + (++n), nativeId: 'n' + n, parentId: null, role, at, text, toolName: null, isSidechain: false, ...extra });
const conv = (s, id, { title, source = 'code', project = 'code:p-a', projectName = 'project-a' }) => {
  s.upsertProject({ id: project, source, key: project, name: projectName, path: source === 'code' ? 'C:\\placeholder\\' + projectName : null });
  s.ensureConversation({ id, source, projectId: project, nativeId: id.split(':').pop() });
  if (title) s.setTitle(id, title, 'custom');
};
function seeded() {
  const s = openStore(':memory:');
  conv(s, 'code:rel', { title: 'Release planning' });
  s.addMessages('code:rel', [
    m('Plan the placeholder release for project-a', '2026-10-01T10:00:00.000Z'),
    m('Here is the release plan: freeze, test, tag', '2026-10-01T10:01:00.000Z', 'assistant'),
    m('Move the release to Friday', '2026-10-01T10:02:00.000Z'),
    m('Release moved to Friday', '2026-10-01T10:03:00.000Z', 'assistant'),
    m('[tool: Read release-notes.md]', '2026-10-01T10:04:00.000Z', 'tool'),
  ]);
  conv(s, 'web:cafe', { title: 'Café menu', source: 'web', project: 'web:proj-b', projectName: 'Kitchen: B' });
  s.addMessages('web:cafe', [m('Draft the café menu with a release date', '2026-09-20T08:00:00.000Z')]);
  conv(s, 'code:gone', { title: 'Forgotten release chat' });
  s.addMessages('code:gone', [m('release notes from a forgotten chat', '2026-09-01T08:00:00.000Z')]);
  s.forget({ conversationId: 'code:gone' });
  conv(s, 'code:side', { title: 'Sidechain only' });
  s.addMessages('code:side', [m('release from a subagent', '2026-09-02T08:00:00.000Z', 'assistant', { isSidechain: true })]);
  conv(s, 'code:key', { title: 'Key rotation' });
  s.addMessages('code:key', [m('rotate the release key ' + MASK('stripe-key') + ' today', '2026-09-03T08:00:00.000Z')]);
  return s;
}
const blocks = (text) => text.split('\n- chat ').slice(1);   // one block per chat: '"<title>", <date> · …\n  · you: …'

test('keywords: a question becomes its searchable words; stop words, short words and punctuation go (Review Focus 1)', () => {
  assert.deepEqual(keywords('What did I decide about the release plan?'), ['decide', 'release', 'plan']);
  assert.deepEqual(keywords('Qu’avons-nous décidé pour le café ?'), ['avons', 'décidé', 'café']);
  assert.deepEqual(keywords('NEAR("x" OR y*) -- AND release_plan'), ['near', 'release', 'plan']);
  assert.deepEqual(keywords('what did the chat say?'), []);
  assert.deepEqual(keywords(undefined), []);
  assert.equal(keywords('alpha bravo charlie delta echo foxtrot golf hotel india juliet').length, 8);
});

test('contextMatch: quoted prefix terms joined by OR; nothing to search → null', () => {
  assert.equal(contextMatch(['release', 'plan']), '"release"* OR "plan"*');
  assert.equal(contextMatch([]), null);
  assert.equal(contextMatch(undefined), null);
});

test('localDay: the local calendar day, or "unknown date"', () => {
  assert.equal(localDay('2026-10-01T23:30:00.000Z'), '2026-10-01');
  assert.equal(localDay('not a date'), 'unknown date');
  assert.equal(localDay(null), 'unknown date');
});

test('contextFor: a question finds its chat (OR, not AND) and cites "chat <title>, <date>"; ≤ PER_CHAT snippets a chat (Review Focus 1)', () => {
  const s = seeded();
  const r = contextFor(s, { query: 'What did I decide about the release plan?', budgetChars: 3000 });
  assert.equal(r.hits[0].conversationId, 'code:rel');
  assert.deepEqual(r.hits.map((h) => h.conversationId).sort(), ['code:key', 'code:rel', 'web:cafe']);
  assert.deepEqual(r.cites, r.hits.map((h) => 'chat ' + h.title + ', ' + h.date));
  assert.ok(r.cites.includes('chat Release planning, 2026-10-01'));
  assert.ok(r.text.startsWith(HEADER + '\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n  · '));
  const rel = blocks(r.text).find((b) => b.startsWith('"Release planning"'));
  assert.equal(rel.split('\n').filter((l) => l.startsWith('  · ')).length, PER_CHAT, 'a chatty chat cannot fill the block');
  assert.ok(r.text.length <= 3000);
  assert.equal(r.chars, r.text.length);
  assert.deepEqual(r.words, ['decide', 'release', 'plan']);
  assert.equal(r.note, undefined);
});

test('contextFor: only your and Claude’s words in chats that still exist — tool rows, subagent turns and forgotten chats never appear', () => {
  const r = contextFor(seeded(), { query: 'release', budgetChars: 8000 });
  assert.deepEqual(r.hits.map((h) => h.conversationId).sort(), ['code:key', 'code:rel', 'web:cafe']);
  assert.doesNotMatch(r.text, /release-notes\.md|subagent|forgotten chat/);
});

test('contextFor: diacritics fold both ways; the source and project read right', () => {
  const s = seeded();
  for (const q of ['cafe menu', 'café menu', 'CAFÉ']) assert.equal(contextFor(s, { query: q, budgetChars: 3000 }).hits[0].conversationId, 'web:cafe', q);
  assert.match(contextFor(s, { query: 'café', budgetChars: 3000 }).text, /\n- chat "Café menu", 2026-09-20 · Kitchen: B · claude\.ai\n {2}· you: /);
});

test('contextFor: FTS syntax typed into a question never reaches MATCH raw (Review Focus 1)', () => {
  const s = seeded();
  for (const q of ['NEAR("release" plan', 'release OR', '"unbalanced', 'release*', '-release', 'col:release', ')(*&^%$#@!', 'AND OR NOT']) {
    assert.doesNotThrow(() => contextFor(s, { query: q, budgetChars: 2000 }), q);
  }
});

test('contextFor: the budget is never exceeded; a chat comes in with at least one snippet or not at all', () => {
  const s = seeded();
  for (const b of [0, 50, HEADER.length + 59, HEADER.length + 60, 400, 700, 1500, 8000, 20000]) {
    const r = contextFor(s, { query: 'release plan', budgetChars: b });
    assert.ok(r.text.length <= Math.min(b, CONTEXT_MAX), b + ': ' + r.text.length);
    for (const blk of blocks(r.text)) assert.match(blk, /\n {2}· (you|Claude): /, b + ': every chat has a snippet');
    assert.equal(r.cites.length, r.hits.length);
  }
  assert.deepEqual(contextFor(s, { query: 'release', budgetChars: 100 }), { text: '', chars: 0, cites: [], hits: [], words: ['release'], note: 'no room in the context budget' });
});

test('contextFor: no keywords and no match say so, honestly', () => {
  const s = seeded();
  const none = contextFor(s, { query: 'what did the chat say?', budgetChars: 2000 });
  assert.equal(none.note, 'no searchable keywords');
  assert.equal(none.text, HEADER + '\n- the question has no searchable keywords');
  const miss = contextFor(s, { query: 'zebra quantum', budgetChars: 2000 });
  assert.equal(miss.note, 'no past chats matched');
  assert.equal(miss.text, HEADER + '\n- no past chats matched: zebra, quantum');
  assert.deepEqual(miss.cites, []);
});

test('contextFor: no snippet marker or control character reaches the model; masked secrets stay masked', () => {
  const r = contextFor(seeded(), { query: 'rotate key', budgetChars: 3000 });
  assert.ok(!r.text.includes(SNIP_START) && !r.text.includes(SNIP_END));
  assert.doesNotMatch(r.text, /[\u0000-\u0009\u000b-\u001f]/);
  assert.ok(r.text.includes(MASK('stripe-key')), r.text);
});

test('formatContext: at most MAX_CHATS chats, in rank order', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ conversationId: 'c' + i, role: 'user', snippet: 'release ' + i, title: 'Chat ' + i, startedAt: '2026-10-0' + (i + 1) + 'T08:00:00.000Z', source: 'code', projectName: 'project-a' }));
  const r = formatContext(rows, { words: ['release'], budgetChars: 8000 });
  assert.deepEqual(r.hits.map((h) => h.conversationId), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].slice(0, MAX_CHATS));
});
