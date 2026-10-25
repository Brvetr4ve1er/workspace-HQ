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
