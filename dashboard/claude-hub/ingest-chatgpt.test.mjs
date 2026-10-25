import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation, epochIso } from './ingest-chatgpt.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { importChatGPTFile, CHATGPT_CHATS } from './ingest-chatgpt.mjs';
import { writeChatGPTZip } from './__fixtures__/make-chatgpt-export.mjs';
import { zipFiles } from './__fixtures__/make-export.mjs';
import { chatgptFixture, CG_IDS } from './__fixtures__/make-chatgpt-export.mjs';

const SECRET = 'sk-' + 'proj-' + 'Q'.repeat(40);
const conv = (id) => chatgptFixture({ secret: SECRET }).conversations.find((c) => c && c.conversation_id === id);

test('the current branch is walked root → current_node; the other branch is counted, not imported', () => {
  const r = parseChatGPTConversation(conv(CG_IDS.a));
  assert.equal(r.ok, true);
  assert.equal(r.conv.id, CG_IDS.a);
  assert.equal(r.conv.title, 'Placeholder lantern festival');
  assert.equal(r.conv.model, 'placeholder-model');
  assert.equal(r.conv.createdAt, '2025-10-01T12:00:00.000Z');
  assert.deepEqual(r.conv.messages.map((x) => [x.nodeId, x.role]), [['n2', 'user'], ['n3b', 'assistant'], ['n4', 'assistant'], ['n5', 'tool'], ['n6', 'assistant']]);
  assert.equal(r.branches, 1, 'n3a is another leaf');
  assert.equal(r.skipped, 1, 'the hidden system node');
  assert.deepEqual(r.unknown, ['some_future_field']);
});

test('parts mapping: image → [image], code → fenced, tool output, parents chain along the walk', () => {
  const { conv: c } = parseChatGPTConversation(conv(CG_IDS.a));
  assert.equal(c.messages[1].text, 'Here is a sketch\n[image]');
  assert.equal(c.messages[2].text, '```python\nprint(1)\n```');
  assert.equal(c.messages[3].text, '1'); assert.equal(c.messages[3].toolName, 'python');
  assert.equal(c.messages[0].parentId, null);
  assert.equal(c.messages[1].parentId, 'n2');
  assert.equal(c.messages[0].at, '2025-10-01T12:00:10.000Z');
});

test('secrets are masked before any cut', () => {
  const { conv: c } = parseChatGPTConversation(conv(CG_IDS.a));
  const last = c.messages[c.messages.length - 1].text;
  assert.ok(!last.includes(SECRET));
  assert.match(last, /••• secret \(openai-key\)/);
  const long = chatgptFixture({ secret: SECRET }).conversations[0];
  // the space keeps redact.mjs's `\bsk-` word boundary (an 'x' run glued to 'sk-' is not a secret shape at all); the secret
  // starts at 199991, so a cut-before-mask would keep 'sk-proj-Q' (9 chars) at the end of the 200000-char cut
  long.mapping.n6.message.content.parts = ['x'.repeat(199990) + ' ' + SECRET];
  const t = parseChatGPTConversation(long).conv.messages.at(-1).text;
  assert.ok(!t.includes('sk-proj-'), 'a secret straddling the cut is masked, not half-kept');
});

test('parent cycle and dangling current_node never hang', () => {
  const loop = parseChatGPTConversation(conv(CG_IDS.loop));
  assert.equal(loop.ok, true);
  assert.equal(loop.conv.messages.length, 2);
  const d = parseChatGPTConversation(conv(CG_IDS.dangling));
  assert.equal(d.ok, true);
  assert.deepEqual(d.conv.messages.map((x) => x.text), ['placeholder newest leaf'], 'walks from the newest leaf');
  assert.equal(d.branches, 1);
});

test('bad rows are refused with a reason; an empty chat parses with no messages', () => {
  assert.deepEqual(parseChatGPTConversation('not an object'), { ok: false, reason: 'not an object' });
  assert.equal(parseChatGPTConversation({ title: 'no id', mapping: {} }).reason, 'no conversation id');
  assert.equal(parseChatGPTConversation({ conversation_id: 'x-1' }).reason, 'no mapping');
  const e = parseChatGPTConversation(conv(CG_IDS.empty));
  assert.equal(e.ok, true); assert.equal(e.conv.messages.length, 0);
  assert.equal(epochIso('soon'), null); assert.equal(epochIso(0), null); assert.equal(epochIso(1e20), null); assert.equal(epochIso('1e13'), null);
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cg-'));

test('import: counts only, current branches, ChatGPT project, searchable, tmp cleaned', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), zip = writeChatGPTZip(path.join(dir, 'export.zip'));
  const s = openStore(':memory:');
  const phases = [], announced = [];
  const r = await importChatGPTFile(s, zip, { tmpRoot, onProgress: (p) => phases.push(p.phase), onImported: (ids) => announced.push(...ids) });
  assert.deepEqual(r.conversations, { seen: 7, imported: 4, unchanged: 0, forgotten: 0, skipped: 3 });
  assert.equal(r.messages.imported, 10);
  assert.equal(r.branches.skipped, 2);
  assert.deepEqual(r.files, { conversations: true, user: true, other: ['chat.html', 'message_feedback.json'] });
  assert.deepEqual(r.memory, { found: false, imported: 0 });
  assert.deepEqual(r.unknownFields, { some_future_field: 1 });
  assert.ok(!JSON.stringify(r).includes('lantern'), 'the report never holds chat text');
  assert.ok(phases.includes('unzip') && phases.includes('conversations'));
  assert.equal(announced.length, 4);
  assert.equal(s.listConversations({ source: 'chatgpt' }).length, 4);
  assert.equal(s.listProjects({}).find((p) => p.id === CHATGPT_CHATS).name, 'ChatGPT chats');
  const th = s.getConversation({ id: 'chatgpt:cg-0001-aaaa' });
  assert.equal(th.conversation.title_source, 'web'); assert.equal(th.conversation.tokens_in, null);
  assert.equal(th.messages.length, 5);
  assert.equal(s.search({ q: 'lantern', source: 'chatgpt' }).length >= 1, true);
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'the extracted files are gone');
});

test('re-import is idempotent, newer replaces, forgotten stays gone', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), s = openStore(':memory:');
  await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'a.zip')), { tmpRoot });
  const again = await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'b.zip')), { tmpRoot });
  assert.deepEqual(again.conversations, { seen: 7, imported: 0, unchanged: 5, forgotten: 0, skipped: 2 });
  assert.equal(s.counts().conversations, 4, 'no duplicates');
  const f = (await import('./__fixtures__/make-chatgpt-export.mjs')).chatgptFixture();
  const b = f.conversations[1];
  b.update_time += 100; b.mapping.b2.message.content.parts = ['placeholder hi, edited'];
  assert.equal(s.forget({ conversationId: 'chatgpt:cg-0001-aaaa' }), true);
  const third = await importChatGPTFile(s, writeChatGPTZip(path.join(dir, 'c.zip'), { conversations: f.conversations }), { tmpRoot });
  assert.equal(third.conversations.imported, 1);
  assert.equal(third.conversations.forgotten, 1);
  assert.equal(s.getConversation({ id: 'chatgpt:cg-0001-aaaa' }), null, 'a forgotten chat never comes back');
  const msgs = s.getConversation({ id: 'chatgpt:cg-0002-bbbb' }).messages.map((m) => m.text);
  assert.deepEqual(msgs, ['placeholder hello', 'placeholder hi, edited'], 'replaced, not appended');
});

test('a claude.ai export and an unknown ZIP are refused with the reason; nothing imported', async () => {
  const dir = tmp(), tmpRoot = path.join(dir, 'tmp'), s = openStore(':memory:');
  const claude = path.join(dir, 'claude.zip');
  zipFiles(claude, [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }, { name: 'users.json', data: '[]' }]);
  await assert.rejects(importChatGPTFile(s, claude, { tmpRoot }), /looks like a claude\.ai export/);
  const other = path.join(dir, 'other.zip');
  zipFiles(other, [{ name: 'photos/a.txt', data: 'placeholder' }]);
  await assert.rejects(importChatGPTFile(s, other, { tmpRoot }), /Not a ChatGPT or claude\.ai export \(looked for conversations\.json\)/);
  assert.equal(s.counts().conversations, 0);
  // both refusals happen on the ZIP index, before tmpRoot is created — nothing was extracted anywhere
  assert.equal(fs.existsSync(tmpRoot) ? fs.readdirSync(tmpRoot).length : 0, 0);
});

test('a recognizable memory file becomes masked memory documents with origin chatgpt', async () => {
  const dir = tmp(), s = openStore(':memory:');
  const secret = 'ghp_' + 'Z'.repeat(36);
  const zip = writeChatGPTZip(path.join(dir, 'm.zip'), { extra: [{ name: 'memories.json', data: JSON.stringify([{ content: 'placeholder memory about tea ' + secret }, { nope: 1 }, 'placeholder plain memory']) }] });
  const r = await importChatGPTFile(s, zip, { tmpRoot: path.join(dir, 'tmp') });
  assert.deepEqual(r.memory, { found: true, imported: 2 });
  const docs = s.listDocuments({ source: 'memory' });
  assert.equal(docs.length, 2); assert.ok(docs.every((d) => d.origin === 'chatgpt'));
  const one = s.getDocument({ id: docs.find((d) => /tea/.test(d.title)).id });
  assert.ok(!one.text.includes(secret)); assert.match(one.text, /github-token/);
});
