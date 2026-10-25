import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { importExportFile, ingestWebConversation, WEB_CHATS } from './ingest-web.mjs';
import { newReport } from './parse-web.mjs';
import { zipFiles, exportJson } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-iweb-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function fixtureZip(d) { const j = exportJson(), z = path.join(d, 'export.zip'); zipFiles(z, [{ name: 'data-2026/conversations.json', data: j.conversations }, { name: 'data-2026/projects.json', data: j.projects }]); return z; }

test('import: counts only, rows under web ids, synthetic project for chats without one, job folder removed', async () => {
  const d = tmp(), s = openStore(':memory:'), tmpRoot = path.join(d, 'tmp'), phases = [];
  const r = await importExportFile(s, fixtureZip(d), { tmpRoot, onProgress: (p) => phases.push(p.phase) });
  assert.deepEqual(r.conversations, { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 });
  assert.deepEqual(r.messages, { imported: 5, skipped: 1, empty: 1 });
  assert.deepEqual(r.projects, { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 });
  assert.deepEqual(r.files, { conversations: true, projects: true });
  assert.ok(phases.includes('unzip') && phases.includes('projects') && phases.includes('conversations'));
  const rows = s.listConversations({ source: 'web' });
  assert.deepEqual(rows.map((x) => x.id).sort(), ['web:web-chat-1', 'web:web-chat-2', 'web:web-chat-3']);
  const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.equal(byId['web:web-chat-1'].project_name, 'project-a (claude.ai)');
  assert.equal(byId['web:web-chat-1'].title, 'Release planning (web)');
  assert.equal(byId['web:web-chat-1'].title_source, 'web');
  assert.equal(byId['web:web-chat-2'].project_id, WEB_CHATS);
  assert.equal(byId['web:web-chat-2'].project_name, 'claude.ai chats');
  const msgs = s.getConversation({ id: 'web:web-chat-2' }).messages;
  assert.equal(msgs[0].id, 'web:web-chat-2:@0');
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'job folder removed');
  for (const leak of ['example.org', 'Placeholder brief', 'Plan the release']) assert.ok(!JSON.stringify(r).includes(leak), leak);
  s.close();
});

test('re-import is idempotent; a newer sync replaces the messages; an older one is unchanged', async () => {
  const d = tmp(), s = openStore(':memory:'), zip = fixtureZip(d), tmpRoot = path.join(d, 'tmp');
  await importExportFile(s, zip, { tmpRoot });
  const before = s.counts();
  const r2 = await importExportFile(s, zip, { tmpRoot });
  assert.deepEqual(r2.conversations, { seen: 5, imported: 0, unchanged: 3, forgotten: 0, skipped: 2 });
  assert.deepEqual(r2.projects.unchanged, 1);
  assert.deepEqual(s.counts(), before);
  const newer = { uuid: 'web-chat-1', title: 'Release planning (web)', projectUuid: 'web-proj-1', model: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-03T09:00:00.000Z',
    messages: [{ uuid: 'web-msg-9', parentUuid: null, role: 'user', at: '2026-10-03T09:00:00.000Z', text: 'Edited question' }] };
  assert.equal(ingestWebConversation(s, newer, newReport()), 'imported');
  assert.deepEqual(s.getConversation({ id: 'web:web-chat-1' }).messages.map((m) => m.text), ['Edited question']);
  assert.equal(ingestWebConversation(s, { ...newer, updatedAt: '2026-10-02T00:00:00.000Z', messages: [{ ...newer.messages[0], text: 'older' }] }, newReport()), 'unchanged');
  assert.equal(s.listConversations({ source: 'web' }).find((x) => x.id === 'web:web-chat-1').project_name, 'project-a (claude.ai)', 'link/project kept');
  const noProject = { ...newer, projectUuid: null, updatedAt: '2026-10-04T09:00:00.000Z' };
  assert.equal(ingestWebConversation(s, noProject, newReport()), 'imported');
  assert.equal(s.listConversations({ source: 'web' }).find((x) => x.id === 'web:web-chat-1').project_id, 'web:web-proj-1', 'a copy without a project uuid keeps the project');
  s.close();
});

test('forgotten web chats never come back; Reindex (resetCode) keeps every web row', async () => {
  const d = tmp(), s = openStore(':memory:'), zip = fixtureZip(d), tmpRoot = path.join(d, 'tmp');
  await importExportFile(s, zip, { tmpRoot });
  assert.equal(s.forget({ conversationId: 'web:web-chat-1' }), true);
  const r = await importExportFile(s, zip, { tmpRoot });
  assert.equal(r.conversations.forgotten, 1);
  assert.equal(s.getConversation({ id: 'web:web-chat-1' }), null);
  assert.deepEqual(s.syncState().forgotten, ['web-chat-1']);
  s.resetCode();
  assert.equal(s.listConversations({ source: 'web' }).length, 2);
  s.close();
});

test('a bad or wrong ZIP: honest error, nothing left in tmp', async () => {
  const d = tmp(), s = openStore(':memory:'), tmpRoot = path.join(d, 'tmp');
  const junk = path.join(d, 'junk.zip'); fs.writeFileSync(junk, 'nope');
  await assert.rejects(importExportFile(s, junk, { tmpRoot }), /not a zip file/);
  const other = path.join(d, 'other.zip'); zipFiles(other, [{ name: 'users.json', data: '[]' }]);
  await assert.rejects(importExportFile(s, other, { tmpRoot }), /neither conversations\.json nor projects\.json/);
  assert.deepEqual(fs.readdirSync(tmpRoot), []);
  assert.deepEqual(s.counts(), { projects: 0, conversations: 0, messages: 0 });
  s.close();
});

test('a long import announces the saved chats in batches of 200 while it runs, then the rest (each batch already readable)', async () => {
  const d = tmp(), s = openStore(':memory:'), tmpRoot = path.join(d, 'tmp'), zip = path.join(d, 'bulk.zip');
  const at = '2026-10-01T09:00:00Z';
  const convs = Array.from({ length: 450 }, (_, i) => ({ uuid: 'bulk-' + i, name: 'Chat ' + i, created_at: at, updated_at: at,
    chat_messages: [{ uuid: 'bulk-' + i + '-m', sender: 'human', created_at: at, text: 'placeholder ' + i }] }));
  zipFiles(zip, [{ name: 'conversations.json', data: JSON.stringify(convs) }]);
  const batches = [], seenAtCall = [];
  let resolved = false;
  const p = importExportFile(s, zip, { tmpRoot, onImported: (ids) => {
    assert.equal(resolved, false, 'announced before the import resolves');
    batches.push(ids);
    seenAtCall.push(s.db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE source = 'web'").get().n);
  } });
  const r = await p; resolved = true;
  assert.deepEqual(batches.map((b) => b.length), [200, 200, 50]);
  assert.deepEqual(seenAtCall, [200, 400, 450], 'every announced chat is already in the index');
  const all = batches.flat();
  assert.equal(new Set(all).size, all.length, 'no id announced twice');
  assert.equal(all.length, r.conversations.imported);
  assert.ok(all.every((id) => /^web:bulk-\d+$/.test(id)));
  const again = [];
  await importExportFile(s, zip, { tmpRoot, onImported: (ids) => again.push(ids) });
  assert.deepEqual(again, [], 'an unchanged re-import announces nothing');
  s.close();
});
