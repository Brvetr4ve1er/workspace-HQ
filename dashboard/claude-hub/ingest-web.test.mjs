import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { ingestWebConversation, ingestWebProject, WEB_CHATS } from './ingest-web.mjs';
import { parseWebConversation, parseWebProject, newReport } from './parse-web.mjs';
import { exportFixture } from './__fixtures__/make-export.mjs';

// What one live-sync pass does: parse each item, then upsert it (hub.mjs pushItems).
function pushFixture(s) {
  const f = exportFixture(), report = newReport();
  for (const raw of f.projects) { const p = parseWebProject(raw); if (p.ok) ingestWebProject(s, p.project, report); else report.projects.skipped++; }
  for (const raw of f.conversations) { const c = parseWebConversation(raw); if (c.ok) ingestWebConversation(s, c.conv, report); else report.conversations.skipped++; }
  return report;
}

test('sync: rows under web ids, synthetic project for chats without one', () => {
  const s = openStore(':memory:');
  const r = pushFixture(s);
  assert.equal(r.conversations.imported, 3);
  assert.equal(r.projects.imported, 1);
  const rows = s.listConversations({ source: 'web' });
  assert.deepEqual(rows.map((x) => x.id).sort(), ['web:web-chat-1', 'web:web-chat-2', 'web:web-chat-3']);
  const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.equal(byId['web:web-chat-1'].project_name, 'project-a (claude.ai)');
  assert.equal(byId['web:web-chat-1'].title, 'Release planning (web)');
  assert.equal(byId['web:web-chat-1'].title_source, 'web');
  assert.equal(byId['web:web-chat-2'].project_id, WEB_CHATS);
  assert.equal(byId['web:web-chat-2'].project_name, 'claude.ai chats');
  assert.equal(s.getConversation({ id: 'web:web-chat-2' }).messages[0].id, 'web:web-chat-2:@0');
  s.close();
});

test('a repeat sync is unchanged; a newer copy replaces the messages; an older one is unchanged', () => {
  const s = openStore(':memory:');
  pushFixture(s);
  const before = s.counts();
  const r2 = pushFixture(s);
  assert.equal(r2.conversations.imported, 0);
  assert.equal(r2.conversations.unchanged, 3);
  assert.equal(r2.projects.unchanged, 1);
  assert.deepEqual(s.counts(), before);
  const newer = { uuid: 'web-chat-1', title: 'Release planning (web)', projectUuid: 'web-proj-1', model: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-03T09:00:00.000Z',
    messages: [{ uuid: 'web-msg-9', parentUuid: null, role: 'user', at: '2026-10-03T09:00:00.000Z', text: 'Edited question' }] };
  assert.equal(ingestWebConversation(s, newer, newReport()), 'imported');
  assert.deepEqual(s.getConversation({ id: 'web:web-chat-1' }).messages.map((m) => m.text), ['Edited question']);
  assert.equal(ingestWebConversation(s, { ...newer, updatedAt: '2026-10-02T00:00:00.000Z', messages: [{ ...newer.messages[0], text: 'older' }] }, newReport()), 'unchanged');
  const noProject = { ...newer, projectUuid: null, updatedAt: '2026-10-04T09:00:00.000Z' };
  assert.equal(ingestWebConversation(s, noProject, newReport()), 'imported');
  assert.equal(s.listConversations({ source: 'web' }).find((x) => x.id === 'web:web-chat-1').project_id, 'web:web-proj-1', 'a copy without a project uuid keeps the project');
  s.close();
});

test('forgotten web chats never come back; Reindex (resetCode) keeps every web row', () => {
  const s = openStore(':memory:');
  pushFixture(s);
  assert.equal(s.forget({ conversationId: 'web:web-chat-1' }), true);
  const r = pushFixture(s);
  assert.equal(r.conversations.forgotten, 1);
  assert.equal(s.getConversation({ id: 'web:web-chat-1' }), null);
  assert.deepEqual(s.syncState().forgotten, ['web-chat-1']);
  s.resetCode();
  assert.equal(s.listConversations({ source: 'web' }).length, 2);
  s.close();
});
