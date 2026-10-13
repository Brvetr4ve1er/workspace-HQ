// dashboard/claude-hub/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, ftsQuery, SNIP_START, SNIP_END, SCHEMA_VERSION } from './store.mjs';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-store-')), 'hub.sqlite');
const seed = (s) => {
  s.upsertProject({ id: 'code:C--p-a', source: 'code', key: 'C--p-a', name: 'C--p-a', path: null });
  s.ensureConversation({ id: 'code:s1', source: 'code', projectId: 'code:C--p-a', nativeId: 's1' });
};
const msg = (n, at, text, role = 'user') => ({ id: 'code:u' + n, nativeId: 'u' + n, parentId: null, role, at, text, toolName: null, isSidechain: false });

test('schema version is recorded and a newer schema is refused', () => {
  const f = tmpDb(); const s = openStore(f);
  assert.equal(s.getMeta('schema_version'), String(SCHEMA_VERSION));
  s.setMeta('schema_version', '99'); s.close();
  assert.throws(() => openStore(f), /newer WorkspaceHQ/);
  assert.throws(() => openStore(f, { readOnly: true }), /newer WorkspaceHQ/);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });   // would fail on Windows if the refused open leaked its handle
  assert.equal(fs.existsSync(path.dirname(f)), false);
});

test('addMessages is idempotent and maintains counts, span and active time', () => {
  const s = openStore(':memory:'); seed(s);
  const batch = [msg(1, '2026-10-01T10:00:00.000Z', 'hello'), msg(2, '2026-10-01T10:02:00.000Z', 'reply', 'assistant'), msg(3, '2026-10-01T11:00:00.000Z', 'later')];
  assert.equal(s.addMessages('code:s1', batch), 3);
  assert.equal(s.addMessages('code:s1', batch), 0, 'replay inserts nothing');
  const c = s.getConversation({ id: 'code:s1' }).conversation;
  assert.equal(c.message_count, 3);
  assert.equal(c.started_at, '2026-10-01T10:00:00.000Z');
  assert.equal(c.last_at, '2026-10-01T11:00:00.000Z');
  assert.equal(c.active_ms, 120000, 'only the 2-minute gap counts; the 58-minute gap is idle');
});

test('usage counts once per API response even when repeated on several lines (Review Focus 3)', () => {
  const s = openStore(':memory:'); seed(s);
  s.addUsage('code:s1', 'msg_A', { in: 6, out: 10, cacheRead: 100, cacheWrite: 50 });
  s.addUsage('code:s1', 'msg_A', { in: 6, out: 917, cacheRead: 100, cacheWrite: 50 });   // same response, later block
  s.addUsage('code:s1', 'msg_B', { in: 4, out: 20, cacheRead: 0, cacheWrite: 0 });
  s.refreshTokens('code:s1');
  const c = s.getConversation({ id: 'code:s1' }).conversation;
  assert.deepEqual([c.tokens_in, c.tokens_out, c.tokens_cache_read, c.tokens_cache_write], [10, 937, 100, 50]);
});

test('titles follow custom > ai > first-prompt', () => {
  const s = openStore(':memory:'); seed(s);
  assert.equal(s.setTitle('code:s1', 'first words', 'first-prompt'), true);
  assert.equal(s.setTitle('code:s1', 'other words', 'first-prompt'), false, 'first prompt never replaces a title');
  assert.equal(s.setTitle('code:s1', 'AI title', 'ai'), true);
  assert.equal(s.setTitle('code:s1', 'My title', 'custom'), true);
  assert.equal(s.setTitle('code:s1', 'AI again', 'ai'), false);
  assert.equal(s.getConversation({ id: 'code:s1' }).conversation.title, 'My title');
});

test('search: prefix + diacritics, snippet markers, filters; junk queries return []', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'We decided to rotate the café key')]);
  const hits = s.search({ q: 'rotat cafe' });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].snippet.includes(SNIP_START) && hits[0].snippet.includes(SNIP_END));
  assert.equal(hits[0].conversationId, 'code:s1');
  assert.deepEqual(s.search({ q: '"); DROP TABLE message; --' }), []);
  assert.deepEqual(s.search({ q: '' }), []);
  assert.equal(s.search({ q: 'rotate', source: 'web' }).length, 0);
  assert.equal(ftsQuery('a b'), '"a"* "b"*');
});

test('search never swallows a store failure into "no matches" (closed handle, missing FTS table)', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'We decided to rotate the key')]);
  // FTS operator words and punctuation are quoted by ftsQuery, so they are plain terms: no throw, just no/some hits
  for (const junk of ['AND', 'OR NOT', 'NEAR(a b)', 'a*', '\\"', 'col:val', '-rotate'])
    assert.doesNotThrow(() => s.search({ q: junk }), junk);
  assert.equal(s.search({ q: 'rotate' }).length, 1);
  s.close();
  assert.throws(() => s.search({ q: 'rotate' }), /not open/i);   // a closed handle is an error, not an empty result
  // a damaged index must also surface (here: the FTS table is gone)
  const f = tmpDb(); const w = openStore(f); seed(w);
  w.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'rotate the key')]);
  w.close();
  const r = openStore(f, { readOnly: true });
  assert.equal(r.search({ q: 'rotate' }).length, 1);
  const raw = new DatabaseSync(f); raw.exec('DROP TABLE message_fts'); raw.close();   // damage the index under a live reader
  assert.throws(() => r.search({ q: 'rotate' }), /message_fts|no such table/i);
  r.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test('forget deletes rows + FTS entries and tombstones; reset clears a conversation', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'secret plan')]);
  assert.equal(s.forget({ conversationId: 'code:s1' }), true);
  assert.equal(s.search({ q: 'secret' }).length, 0);
  assert.equal(s.isTombstoned('conversation', 'code:s1'), true);
  assert.equal(s.getConversation({ id: 'code:s1' }), null);
  assert.equal(s.forget({ conversationId: 'code:nope' }), false);
});

test('listConversations hides empty and forgotten chats, newest first, with counts', () => {
  const s = openStore(':memory:'); seed(s);
  s.ensureConversation({ id: 'code:s2', source: 'code', projectId: 'code:C--p-a', nativeId: 's2' });
  s.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'old')]);
  s.ensureConversation({ id: 'code:s3', source: 'code', projectId: 'code:C--p-a', nativeId: 's3' });
  s.addMessages('code:s3', [msg(9, '2026-10-02T10:00:00.000Z', 'new')]);
  assert.deepEqual(s.listConversations({}).map((c) => c.id), ['code:s3', 'code:s1']);
  assert.deepEqual(s.counts(), { projects: 1, conversations: 2, messages: 2 });
  assert.equal(s.listProjects({})[0].conversations, 2);
});

test('readOnly opens an existing db for reading and refuses writes', () => {
  const f = tmpDb(); const w = openStore(f); seed(w);
  w.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'readable text')]);
  w.setCursor({ file: 'a.jsonl', size: 10, mtimeMs: 1234.7, offset: 10, head: 'h', sessionId: 's1' });
  w.close();
  const r = openStore(f, { readOnly: true });
  assert.equal(r.search({ q: 'readable' }).length, 1);
  assert.deepEqual(r.counts(), { projects: 1, conversations: 1, messages: 1 });
  assert.deepEqual({ ...r.getCursor('a.jsonl') }, { file: 'a.jsonl', size: 10, mtime_ms: 1234, offset: 10, head: 'h', session_id: 's1' });
  assert.throws(() => r.addMessages('code:s1', [msg(2, '2026-10-01T10:01:00.000Z', 'nope')]), /readonly/i);
  r.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});
