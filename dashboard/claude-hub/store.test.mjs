// dashboard/claude-hub/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, ftsQuery, SNIP_START, SNIP_END, SCHEMA_VERSION, HARVEST_POOL_MAX, PROMPT_TARGETS } from './store.mjs';
import { makeV1Db } from './__fixtures__/make-v1-db.mjs';

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
  assert.deepEqual(s.counts(), { projects: 1, conversations: 2, messages: 2, documents: 0 });
  assert.equal(s.listProjects({})[0].conversations, 2);
});

test('readOnly opens an existing db for reading and refuses writes', () => {
  const f = tmpDb(); const w = openStore(f); seed(w);
  w.addMessages('code:s1', [msg(1, '2026-10-01T10:00:00.000Z', 'readable text')]);
  w.setCursor({ file: 'a.jsonl', size: 10, mtimeMs: 1234.7, offset: 10, head: 'h', sessionId: 's1' });
  w.close();
  const r = openStore(f, { readOnly: true });
  assert.equal(r.search({ q: 'readable' }).length, 1);
  assert.deepEqual(r.counts(), { projects: 1, conversations: 1, messages: 1, documents: 0 });
  assert.deepEqual({ ...r.getCursor('a.jsonl') }, { file: 'a.jsonl', size: 10, mtime_ms: 1234, offset: 10, head: 'h', session_id: 's1' });
  assert.throws(() => r.addMessages('code:s1', [msg(2, '2026-10-01T10:01:00.000Z', 'nope')]), /readonly/i);
  r.close();
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

const seedTies = (s) => {
  s.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'project-a', path: 'C:\placeholder\project-a' });
  const at = '2026-10-01T10:00:00.000Z';
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    s.ensureConversation({ id: 'code:' + n, source: 'code', projectId: 'code:p', nativeId: n });
    s.addMessages('code:' + n, [{ id: 'code:' + n + ':m', role: 'user', at, text: 'hello ' + n }]);
  }
  s.ensureConversation({ id: 'code:t', source: 'code', projectId: 'code:p', nativeId: 't' });
  // 7 lines sharing one timestamp, ids deliberately NOT in file order
  s.addMessages('code:t', ['z', 'b', 'y', 'a', 'x', 'c', 'w'].map((u, i) => ({ id: 'code:t:' + u, role: 'assistant', at, text: 'block ' + i })));
};

test('conversation list pages by (last_at, id): no chat skipped or repeated on a tie', () => {
  const s = openStore(tmpDb()); seedTies(s);
  const seen = []; let cur = {};
  for (;;) {
    const rows = s.listConversations({ limit: 2, ...cur });
    if (!rows.length) break;
    seen.push(...rows.map((r) => r.id));
    const last = rows[rows.length - 1]; cur = { before: last.last_at, beforeId: last.id };
  }
  assert.deepEqual(seen, ['code:t', 'code:c5', 'code:c4', 'code:c3', 'code:c2', 'code:c1']);
  s.close();
});

test('thread pages keep file order inside one timestamp and never skip or repeat', () => {
  const s = openStore(tmpDb()); seedTies(s);
  let page = s.getConversation({ id: 'code:t', limit: 3 });
  const got = [page.messages.map((m) => m.text)];
  while (page.hasMore) {
    const first = page.messages[0];
    page = s.getConversation({ id: 'code:t', limit: 3, before: first.at, beforeId: first.id });
    got.unshift(page.messages.map((m) => m.text));
  }
  assert.deepEqual(got.flat(), ['block 0', 'block 1', 'block 2', 'block 3', 'block 4', 'block 5', 'block 6']);
  assert.equal('_r' in page.messages[0], false);   // rowid never leaves the store
  s.close();
});

test('list filters: q (title, escaped), since, hqProjectId', () => {
  const s = openStore(tmpDb()); seedTies(s);
  s.setTitle('code:c1', 'Fix 100% of the café_bug', 'custom');
  assert.deepEqual(s.listConversations({ q: '100%' }).map((r) => r.id), ['code:c1']);
  assert.deepEqual(s.listConversations({ q: 'FIX 100' }).map((r) => r.id), ['code:c1']);
  assert.equal(s.listConversations({ q: '%' }).length, 1);            // a literal %, not "everything"
  assert.equal(s.listConversations({ q: '_' }).length, 1);            // a literal _, not "any char"
  assert.equal(s.listConversations({ since: '2026-10-02T00:00:00Z' }).length, 0);
  assert.equal(s.listConversations({ hqProjectId: 'project-a' }).length, 0);
  s.db.prepare("UPDATE project SET hq_project_id = 'project-a', link_state = 'confirmed' WHERE id = 'code:p'").run();
  assert.equal(s.listConversations({ hqProjectId: 'project-a' }).length, 6);
  s.close();
});

// append to dashboard/claude-hub/store.test.mjs
const seedStats = (s) => {
  s.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'project-a', path: 'C:\\placeholder\\project-a' });
  s.upsertProject({ id: 'code:q', source: 'code', key: 'q', name: 'project-b', path: 'C:\\placeholder\\project-b' });
  for (const [id, pid] of [['code:a', 'code:p'], ['code:fork', 'code:p'], ['code:b', 'code:q']]) s.ensureConversation({ id, source: 'code', projectId: pid, nativeId: id });
  // 23:30Z on 1 Oct = 01:30 on 2 Oct at UTC+2; gaps 2 min (counted) and 10 min (not)
  s.addMessages('code:a', [
    { id: 'code:a:1', role: 'user', at: '2026-10-01T23:30:00.000Z', text: 'one' },
    { id: 'code:a:2', role: 'assistant', at: '2026-10-01T23:32:00.000Z', text: 'two' },
    { id: 'code:a:3', role: 'user', at: '2026-10-01T23:42:00.000Z', text: 'three' },
  ]);
  s.addMessages('code:fork', [{ id: 'code:fork:1', role: 'user', at: '2026-10-02T08:00:00.000Z', text: 'fork' }]);
  s.addMessages('code:b', [{ id: 'code:b:1', role: 'user', at: '2026-10-02T09:00:00.000Z', text: 'bee' }]);
  s.addUsage('code:a', 'msg_1', { in: 10, out: 100, cacheRead: 0, cacheWrite: 0 });
  s.addUsage('code:fork', 'msg_1', { in: 10, out: 100, cacheRead: 0, cacheWrite: 0 });   // copied response
  s.addUsage('code:fork', 'msg_2', { in: 1, out: 5, cacheRead: 0, cacheWrite: 0 });
  s.addUsage('code:b', 'msg_3', { in: 2, out: 7, cacheRead: 0, cacheWrite: 0 });
};

test('stats buckets by local day, estimates active time, counts a copied response once', () => {
  const s = openStore(tmpDb()); seedStats(s);
  const r = s.stats({ from: '2026-10-01', to: '2026-10-02', tzOffsetMin: 120 });
  assert.deepEqual(r.days, [{ day: '2026-10-02', chats: 3, messages: 5, active_ms: 120000 }]);
  const p = Object.fromEntries(r.projects.map((x) => [x.project_id, x]));
  assert.equal(p['code:p'].tokens_out, 105);   // msg_1 once + msg_2
  assert.equal(p['code:q'].tokens_out, 7);
  assert.equal(r.totals.tokens_out, r.projects.reduce((n, x) => n + x.tokens_out, 0));
  assert.equal(r.totals.chats, 3);
  const utc = s.stats({ from: '2026-10-01', to: '2026-10-01', tzOffsetMin: 0 });
  assert.deepEqual(utc.days.map((d) => d.day), ['2026-10-01']);
  assert.equal(s.stats({ from: '2026-10-01', to: '2026-10-02', projectId: 'code:q' }).totals.chats, 1);
  assert.throws(() => s.stats({ from: 'yesterday', to: '2026-10-02' }), /YYYY-MM-DD/);
  s.close();
});

test('setLink: states, rejected clears the hq id, unknown project is false', () => {
  const s = openStore(tmpDb()); seedStats(s);
  assert.equal(s.setLink({ projectId: 'code:p', hqProjectId: 'project-a', state: 'auto' }), true);
  assert.deepEqual(s.linkRows().find((r) => r.id === 'code:p'), { id: 'code:p', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a', link_state: 'auto' });
  s.setLink({ projectId: 'code:p', hqProjectId: 'project-a', state: 'rejected' });
  assert.equal(s.linkRows().find((r) => r.id === 'code:p').hq_project_id, null);
  assert.equal(s.setLink({ projectId: 'code:none', hqProjectId: 'x', state: 'confirmed' }), false);
  assert.throws(() => s.setLink({ projectId: 'code:p', hqProjectId: 'x', state: 'bogus' }), /bad state/);
  assert.throws(() => s.setLink({ projectId: 'code:p', hqProjectId: '', state: 'confirmed' }), /required/);
  s.close();
});

test('a brand-new db is stamped with the index version; an existing one is not; secure_delete is on', () => {
  const f = tmpDb();
  const s = openStore(f, { indexVersion: 7 });
  assert.equal(s.getMeta('index_version'), '7');
  assert.equal(s.db.prepare('PRAGMA secure_delete').get().secure_delete, 1);
  s.setMeta('index_version', '1'); s.close();
  const again = openStore(f, { indexVersion: 7 });
  assert.equal(again.getMeta('index_version'), '1');   // not fresh: the Hub's rebuild rule decides
  again.optimize();                                    // runs on a populated or empty FTS table
  again.close();
});

test('stats token scope: a chat active in the window brings its whole token total (documented, final review)', () => {
  const s = openStore(tmpDb());
  s.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'project-a', path: null });
  s.ensureConversation({ id: 'code:long', source: 'code', projectId: 'code:p', nativeId: 'long' });
  s.addMessages('code:long', [
    { id: 'code:long:1', role: 'user', at: '2026-08-01T10:00:00.000Z', text: 'old turn' },
    { id: 'code:long:2', role: 'user', at: '2026-10-02T10:00:00.000Z', text: 'recent turn' },
  ]);
  s.addUsage('code:long', 'msg_old', { in: 1, out: 1000, cacheRead: 0, cacheWrite: 0 });
  s.addUsage('code:long', 'msg_new', { in: 1, out: 10, cacheRead: 0, cacheWrite: 0 });
  const r = s.stats({ from: '2026-10-01', to: '2026-10-30' });
  assert.equal(r.totals.chats, 1);
  assert.equal(r.totals.tokens_out, 1010);   // whole-chat total (usage has no timestamp) — IPC-CONTRACT stats row says so
  assert.equal(s.stats({ from: '2026-09-01', to: '2026-09-30' }).projects.length, 0);   // a chat not active in the window adds nothing
  s.close();
});

test('web_sync helpers, setProjectName, syncState', () => {
  const s = openStore(':memory:');
  assert.equal(s.getSync('conversation', 'u1'), undefined);
  s.setSync('conversation', 'u1', '2026-10-01T00:00:00.000Z'); s.setSync('conversation', 'u1', '2026-10-02T00:00:00.000Z');
  s.setSync('conversation', 'u2', null); s.setSync('project', 'p1', '2026-09-01T00:00:00.000Z');
  assert.deepEqual(s.getSync('conversation', 'u1'), { updated_at: '2026-10-02T00:00:00.000Z' });
  s.upsertProject({ id: 'web:p1', source: 'web', key: 'p1', name: 'claude.ai project', path: null });
  s.setProjectName('web:p1', 'project-a (claude.ai)');
  assert.equal(s.listProjects({ source: 'web' })[0].name, 'project-a (claude.ai)');
  s.ensureConversation({ id: 'web:u3', source: 'web', projectId: 'web:p1', nativeId: 'u3' });
  s.addMessages('web:u3', [{ id: 'web:u3:m', role: 'user', at: '2026-10-01T00:00:00.000Z', text: 'hi' }]);
  s.forget({ conversationId: 'web:u3' });
  assert.deepEqual(s.syncState(), { conversations: { u1: '2026-10-02T00:00:00.000Z', u2: null }, projects: { p1: '2026-09-01T00:00:00.000Z' }, forgotten: ['u3'] });
  s.close();
});

test('a populated schema-1 db migrates in place to 2; every v1 row, cursor, tombstone and FTS hit survives', () => {
  const file = makeV1Db(tmpDb());
  const s = openStore(file);
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(s.getMeta('schema_version'), '2');
  assert.equal(s.getMeta('index_version'), '2', 'the code index is not rebuilt by the schema bump');
  assert.deepEqual(s.counts(), { projects: 1, conversations: 1, messages: 2, documents: 0 });
  assert.equal(s.search({ q: 'lanterns' }).length, 1, 'message_fts still answers');
  assert.equal(s.getCursor('C--placeholder-project-a\\s1.jsonl').offset, 123);
  assert.equal(s.isTombstoned('conversation', 'code:gone'), true);
  assert.equal(s.getSync('conversation', 'web-uuid-1').updated_at, '2026-10-01T00:00:00Z');
  assert.equal(s.listProjects({})[0].link_state, 'confirmed');
  s.close();
  const again = openStore(file);   // a second open is a no-op
  assert.equal(again.getMeta('schema_version'), '2');
  assert.deepEqual(again.counts(), { projects: 1, conversations: 1, messages: 2, documents: 0 });
  again.close();
});

test('a db stamped newer than this app is refused BEFORE any DDL runs on it', () => {
  const file = makeV1Db(tmpDb(), { schemaVersion: '3' });
  assert.throws(() => openStore(file), /newer WorkspaceHQ \(schema 3\)/);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'document'").get(), undefined, 'nothing was created');
  db.close();
});

test('documents: upsert is idempotent, FTS + snippet, history hidden unless asked, forget tombstones', () => {
  const s = openStore(':memory:');
  const d = { id: 'memory:aa', source: 'memory', path: 'C:\\h\\.claude\\projects\\p\\memory\\a.md', title: 'Placeholder lantern note',
    text: 'the lantern keeper placeholder', projectId: 'code:p', projectPath: 'C:\\placeholder\\p', mtimeMs: 1, size: 10, meta: { type: 'user' } };
  assert.equal(s.upsertDocument(d), 'added');
  assert.equal(s.upsertDocument({ ...d, mtimeMs: 2 }), 'unchanged', 'stamps only');
  assert.equal(s.upsertDocument({ ...d, text: 'the lantern keeper placeholder, edited', mtimeMs: 3 }), 'updated');
  assert.equal(s.upsertDocument({ id: 'history:s1:0', source: 'history', path: null, title: null, text: 'lantern from history',
    projectId: null, projectPath: 'C:\\placeholder\\p', mtimeMs: null, size: null, meta: { sessionId: 's1', pasted: false } }), 'added');
  const hits = s.listDocuments({ q: 'lantern' });
  assert.deepEqual(hits.map((r) => r.id), ['memory:aa'], 'history rows are the harvest pool, not search results');
  assert.ok(hits[0].snippet.includes(SNIP_START) && hits[0].snippet.includes(SNIP_END));
  assert.equal(s.listDocuments({ q: 'lantern', source: 'history' }).length, 1);
  assert.deepEqual(s.listDocuments({ q: '!!!' }), []);
  assert.equal(s.listDocuments({ q: 'edited' }).length, 1, 'the update reached the FTS index');
  assert.equal(s.listDocuments({ q: 'keeper placeholder' }).length, 1);
  const got = s.getDocument({ id: 'memory:aa' });
  assert.deepEqual(got.meta, { type: 'user' });
  assert.equal(got.text, 'the lantern keeper placeholder, edited');
  assert.equal(s.documentStamps('memory').get('memory:aa').mtime_ms, 3);
  assert.equal(s.counts().documents, 2);
  assert.equal(s.forget({ documentId: 'memory:aa' }), true);
  assert.equal(s.forget({ documentId: 'memory:aa' }), false);
  assert.equal(s.getDocument({ id: 'memory:aa' }), null);
  assert.equal(s.listDocuments({ q: 'edited' }).length, 0, 'FTS row gone too');
  assert.equal(s.upsertDocument(d), 'forgotten', 'a forgotten document is never re-indexed');
  assert.equal(s.removeDocuments({ source: 'history', idPrefix: 'history:' }), 1);
  assert.equal(s.counts().documents, 0);
  s.close();
});

test('P1: prompt rows carry parsed meta and variables; bad meta JSON is null, never a throw', () => {
  const s = openStore(':memory:');
  s.upsertDocument({ id: 'prompt:a', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\a.md', title: 'A', text: 'Use {{file}} in {{project}}', mtimeMs: 2, size: 1, meta: { title: 'A', tags: ['review'], variables: ['project'] } });
  s.upsertDocument({ id: 'prompt:b', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\b.md', title: 'B', text: 'no vars here', mtimeMs: 1, size: 1, meta: { title: 'B' } });
  s.upsertDocument({ id: 'memory:m', source: 'memory', path: 'C:\\placeholder\\m.md', title: 'M', text: '{{not_a_prompt}}', mtimeMs: 3, size: 1, meta: { name: 'M' } });
  s.db.prepare("UPDATE document SET meta = '{bad' WHERE id = 'prompt:b'").run();
  const rows = s.listDocuments({ source: 'prompt' });
  assert.deepEqual(rows.map((r) => r.id), ['prompt:a', 'prompt:b']);
  assert.deepEqual(rows[0].meta, { title: 'A', tags: ['review'], variables: ['project'] });
  assert.deepEqual(rows[0].variables, ['project', 'file']);
  assert.equal(rows[1].meta, null);
  assert.equal(rows[1].origin, null, 'json_valid guards the H6 origin column');
  assert.deepEqual(rows[1].variables, []);
  for (const k of ['text', 'meta_json', 'prompt_text']) assert.equal(k in rows[0], false, k + ' must not reach the renderer');
  const mem = s.listDocuments({}).find((r) => r.id === 'memory:m');
  assert.deepEqual(mem.meta, { name: 'M' });
  assert.equal('variables' in mem, false);
  const hit = s.listDocuments({ source: 'prompt', q: 'file' });
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].variables, ['project', 'file']);
  assert.ok(typeof hit[0].snippet === 'string');
});

test('P1: promptStats counts prompt_use rows per prompt (real counts; empty before P3 writes any)', () => {
  const s = openStore(':memory:');
  assert.deepEqual(s.promptStats(), []);
  const ins = s.db.prepare('INSERT INTO prompt_use(prompt_id, at, target) VALUES (?, ?, ?)');
  ins.run('prompt:a', '2026-10-20T10:00:00.000Z', 'chat');
  ins.run('prompt:a', '2026-10-22T10:00:00.000Z', 'terminal');
  ins.run('prompt:b', '2026-10-21T10:00:00.000Z', 'claude.ai');
  assert.deepEqual(s.promptStats(), [
    { prompt_id: 'prompt:a', uses: 2, last_at: '2026-10-22T10:00:00.000Z' },
    { prompt_id: 'prompt:b', uses: 1, last_at: '2026-10-21T10:00:00.000Z' },
  ]);
});

// ---- P2 prompt harvest pool (spec 2026-10-15 §6.2); placeholder text only
const P2_LONG = (s) => { let t = s; while (t.length < 130) t += ' placeholder words'; return t; };
function p2Store() {
  const s = openStore(':memory:');
  s.upsertProject({ id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'project-a', path: 'C:\\placeholder\\project-a' });
  const conv = (id, source, projectId) => s.ensureConversation({ id, source, projectId, nativeId: id.split(':')[1] });
  conv('code:s1', 'code', 'code:C--placeholder-project-a');
  conv('code:s2', 'code', 'code:C--placeholder-project-a');
  conv('chatgpt:g1', 'chatgpt', null);
  const m = (cid, id, role, at, text, o = {}) => ({ id: `${cid}:${id}`, nativeId: id, parentId: null, role, at, text, toolName: null, isSidechain: false, ...o });
  s.addMessages('code:s1', [
    m('code:s1', 'u1', 'user', '2026-09-01T10:00:00Z', P2_LONG('Placeholder prompt alpha')),
    m('code:s1', 'a1', 'assistant', '2026-09-01T10:00:01Z', 'ok'),
    m('code:s1', 'a2', 'assistant', '2026-09-01T10:00:02Z', 'ok'),
    m('code:s1', 'u2', 'user', '2026-09-01T10:01:00Z', 'short'),
    m('code:s1', 'u3', 'user', '2026-09-01T10:02:00Z', P2_LONG('Placeholder tool result'), { toolName: 'Read' }),
    m('code:s1', 'u4', 'user', '2026-09-01T10:03:00Z', P2_LONG('Placeholder sidechain'), { isSidechain: true }),
  ]);
  s.addMessages('code:s2', [m('code:s2', 'u1', 'user', '2026-09-02T10:00:00Z', P2_LONG('Placeholder prompt in a chat to forget'))]);
  s.addMessages('chatgpt:g1', [m('chatgpt:g1', 'u1', 'user', '2026-09-03T10:00:00Z', P2_LONG('Placeholder prompt alpha'))]);
  const hist = (sid, off, text, pasted, at) => s.upsertDocument({ id: `history:${sid}:${off}`, source: 'history', path: null, title: null, text,
    projectId: null, projectPath: 'C:\\placeholder\\project-a', mtimeMs: null, size: null, meta: { sessionId: sid, project: 'C:\\placeholder\\project-a', pasted, at } });
  hist('s1', 0, P2_LONG('Placeholder prompt alpha'), false, '2026-09-01T09:59:59Z');
  hist('s1', 400, P2_LONG('Placeholder pasted log'), true, '2026-09-01T10:05:00Z');
  hist('s2', 0, P2_LONG('Placeholder prompt in a chat to forget'), false, '2026-09-02T09:59:59Z');
  s.upsertDocument({ id: 'prompt:p1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\a.md', title: 'A', text: 'Placeholder body', projectId: null, projectPath: null, mtimeMs: 1, size: 1, meta: { title: 'A' } });
  return s;
}

test('harvestPool: user messages only (no tool, no sidechain, ≥ 120 chars), turns after by (at, id), project name', () => {
  const s = p2Store();
  const { rows, pooled, capped } = s.harvestPool();
  const msgs = rows.filter((r) => r.kind !== 'history');
  assert.deepEqual(msgs.map((r) => r.conversationId).sort(), ['chatgpt:g1', 'code:s1', 'code:s2']);
  const a = msgs.find((r) => r.conversationId === 'code:s1');
  assert.equal(a.role, 'user');
  assert.equal(a.turnsAfter, 2);
  assert.equal(a.project, 'project-a');
  assert.equal(a.sessionKey, 'code:s1');
  assert.equal(a.documentId, null);
  assert.equal(a.pasted, false);
  assert.deepEqual(pooled, { messages: 3, history: 3 });
  assert.deepEqual(capped, { messages: false, history: false });
  assert.equal(HARVEST_POOL_MAX, 20000);
  s.close();
});

test('harvestPool: history rows carry sessionKey code:<sessionId> and pasted', () => {
  const s = p2Store();
  const h = s.harvestPool().rows.filter((r) => r.kind === 'history');
  const first = h.find((r) => r.documentId === 'history:s1:0');
  assert.equal(first.sessionKey, 'code:s1');
  assert.equal(first.conversationId, null);
  assert.equal(first.turnsAfter, 2);         // the two assistant messages after 09:59:59 in code:s1
  assert.equal(first.at, '2026-09-01T09:59:59Z');
  assert.equal(first.project, 'project-a');  // basename of the typed-in project path
  assert.equal(h.find((r) => r.documentId === 'history:s1:400').pasted, true);
  s.close();
});

test('harvestPool: a history line with the nosession placeholder keys by its document id', () => {
  const s = p2Store();
  for (const off of [0, 500]) s.upsertDocument({ id: 'history:nosession:' + off, source: 'history', path: null, title: null, text: P2_LONG('Placeholder session-less prompt'),
    projectId: null, projectPath: null, mtimeMs: null, size: null, meta: { sessionId: 'nosession', project: null, pasted: false, at: '2026-09-04T10:00:0' + (off ? 1 : 0) + 'Z' } });
  const h = s.harvestPool().rows.filter((r) => r.kind === 'history' && r.documentId.startsWith('history:nosession:'));
  assert.deepEqual(h.map((r) => r.sessionKey).sort(), ['history:nosession:0', 'history:nosession:500']);
  assert.equal(h.every((r) => r.turnsAfter === 0), true);
  s.close();
});

test('harvestPool: a forgotten chat and its history lines leave the pool', () => {
  const s = p2Store();
  assert.equal(s.forget({ conversationId: 'code:s2' }), true);
  const rows = s.harvestPool().rows;
  assert.equal(rows.some((r) => r.conversationId === 'code:s2' || r.sessionKey === 'code:s2'), false);
  s.close();
});

test('harvestPool: the bound is applied newest-first and reported', () => {
  const s = p2Store();
  const r = s.harvestPool({ limit: 2 });
  assert.deepEqual(r.rows.filter((x) => x.kind !== 'history').map((x) => x.conversationId), ['chatgpt:g1', 'code:s2']);
  assert.deepEqual(r.capped, { messages: true, history: true });
  assert.deepEqual(r.pooled, { messages: 2, history: 2 });
  s.close();
});

test('promptBodies lists prompt-note bodies only', () => {
  const s = p2Store();
  assert.deepEqual(s.promptBodies(), ['Placeholder body']);
  s.close();
});

test('hidden candidates survive resetCode and new rows; only cand:<sha1> keys are accepted', () => {
  const s = p2Store();
  const key = 'cand:' + 'a'.repeat(40);
  assert.equal(s.hideCandidate(key), true);
  assert.equal(s.hideCandidate(key), true);   // idempotent
  for (const bad of ['', 'cand:xyz', 'conversation:code:s1', 'cand:' + 'A'.repeat(40), null]) assert.throws(() => s.hideCandidate(bad), /not a candidate key/);
  s.resetCode();   // drops every code conversation (code:s1 included); tombstones stay
  s.ensureConversation({ id: 'code:s1', source: 'code', projectId: null, nativeId: 's1' });
  s.addMessages('code:s1', [{ id: 'code:s1:u9', nativeId: 'u9', parentId: null, role: 'user', at: '2026-09-09T10:00:00Z', text: P2_LONG('Placeholder new row'), toolName: null, isSidechain: false }]);
  assert.deepEqual([...s.hiddenCandidates()], [key]);
  assert.equal(s.isTombstoned('candidate', key), true);
  s.close();
});

test('P3: addPromptUse validates and writes one row per call; promptStats counts them', () => {
  const s = openStore(':memory:');
  const A = 'prompt:' + 'a'.repeat(40), B = 'prompt:' + 'b'.repeat(40);
  assert.deepEqual(PROMPT_TARGETS, ['chat', 'terminal', 'claude.ai', 'chatgpt']);
  assert.equal(s.addPromptUse({ promptId: A, at: '2026-10-25T09:00:00.000Z', target: 'chat', projectId: 'project-a' }), true);
  s.addPromptUse({ promptId: A, at: '2026-10-25T10:00:00.000Z', target: 'claude.ai' });
  s.addPromptUse({ promptId: B, at: '2026-10-24T08:00:00.000Z', target: 'terminal', projectId: 'project-b', conversationId: null });
  assert.deepEqual(s.promptStats(), [
    { prompt_id: A, uses: 2, last_at: '2026-10-25T10:00:00.000Z' },
    { prompt_id: B, uses: 1, last_at: '2026-10-24T08:00:00.000Z' },
  ]);
  const row = s.db.prepare("SELECT * FROM prompt_use WHERE target = 'chat'").get();
  assert.equal(row.project_id, 'project-a'); assert.equal(row.conversation_id, null);
  const bad = [
    { promptId: 'memory:' + 'a'.repeat(40), at: '2026-10-25T09:00:00Z', target: 'chat' },
    { promptId: 'prompt:' + 'A'.repeat(40), at: '2026-10-25T09:00:00Z', target: 'chat' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'https://evil.example' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'CHAT' },
    { promptId: A, at: 'yesterday', target: 'chat' },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'chat', projectId: 'x'.repeat(201) },
    { promptId: A, at: '2026-10-25T09:00:00Z', target: 'chat', conversationId: 42 },
  ];
  for (const b of bad) assert.throws(() => s.addPromptUse(b), /^Error: promptUse: /, JSON.stringify(b));
  assert.throws(() => s.addPromptUse(null), /promptUse: /);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS c FROM prompt_use').get().c, 3, 'a refused row writes nothing');
});

test('Social tab: listDocuments filters by origin/kind; socialSummary counts docs per network+kind and DM chats', () => {
  const s = openStore(tmpDb());
  const doc = (id, origin, kind, ms) => s.upsertDocument({ id, source: 'social', title: id, text: 'placeholder ' + id, mtimeMs: ms, size: 1, meta: { origin, kind } });
  doc('social:instagram:posts:1', 'instagram', 'posts', 10); doc('social:instagram:posts:2', 'instagram', 'posts', 30);
  doc('social:instagram:likes:top', 'instagram', 'likes', 20); doc('social:facebook:posts:1', 'facebook', 'posts', 5);
  s.upsertDocument({ id: 'memory:x', source: 'memory', title: 'm', text: 'placeholder', mtimeMs: 1, size: 1, meta: null });
  assert.deepEqual(s.listDocuments({ source: 'social', origin: 'instagram' }).map((d) => d.id), ['social:instagram:posts:2', 'social:instagram:likes:top', 'social:instagram:posts:1']);
  assert.deepEqual(s.listDocuments({ source: 'social', origin: 'instagram', kind: 'posts' }).map((d) => d.id), ['social:instagram:posts:2', 'social:instagram:posts:1']);
  assert.deepEqual(s.listDocuments({ source: 'social', kind: 'posts', q: 'placeholder' }).map((d) => d.id).sort(), ['social:facebook:posts:1', 'social:instagram:posts:1', 'social:instagram:posts:2']);
  s.upsertProject({ id: 'instagram:dms', source: 'instagram', key: 'dms', name: 'Instagram DMs', path: null });
  s.ensureConversation({ id: 'instagram:t1', source: 'instagram', projectId: 'instagram:dms', nativeId: 't1' });
  s.ensureConversation({ id: 'instagram:t2', source: 'instagram', projectId: 'instagram:dms', nativeId: 't2' });   // no messages: not counted
  s.addMessages('instagram:t1', [{ id: 'instagram:m1', nativeId: 'm1', parentId: null, role: 'user', at: '2026-10-01T10:00:00Z', text: 'hi', toolName: null, isSidechain: false },
    { id: 'instagram:m2', nativeId: 'm2', parentId: null, role: 'other', at: '2026-10-02T10:00:00Z', text: 'hey', toolName: 'Someone', isSidechain: false }]);
  const sum = s.socialSummary();
  assert.deepEqual(sum.kinds, [
    { origin: 'facebook', kind: 'posts', docs: 1, newest_ms: 5 },
    { origin: 'instagram', kind: 'posts', docs: 2, newest_ms: 30 },
    { origin: 'instagram', kind: 'likes', docs: 1, newest_ms: 20 },
  ]);
  assert.deepEqual(sum.dms, [{ origin: 'instagram', conversations: 1, messages: 2, last_at: '2026-10-02T10:00:00Z' }]);
});
