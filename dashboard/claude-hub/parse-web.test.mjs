import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebConversation, parseWebProject, newReport, noteUnknown, isoOrNull } from './parse-web.mjs';
import { exportFixture } from './__fixtures__/make-export.mjs';

test('isoOrNull: ISO, epoch seconds, epoch ms, junk', () => {
  assert.equal(isoOrNull('2026-10-01T09:00:00Z'), '2026-10-01T09:00:00.000Z');
  assert.equal(isoOrNull(1759309200), '2025-10-01T09:00:00.000Z');
  assert.equal(isoOrNull(1759309200000), '2025-10-01T09:00:00.000Z');
  assert.equal(isoOrNull('soon'), null); assert.equal(isoOrNull(null), null); assert.equal(isoOrNull({}), null);
});

test('parseWebConversation: the variant table', () => {
  const [modern, legacy, noProject, notObj, noId] = exportFixture().conversations;
  const a = parseWebConversation(modern);
  assert.equal(a.ok, true);
  assert.equal(a.conv.uuid, 'web-chat-1'); assert.equal(a.conv.title, 'Release planning (web)'); assert.equal(a.conv.projectUuid, 'web-proj-1');
  assert.equal(a.conv.updatedAt, '2026-10-01T09:10:00.000Z');
  assert.deepEqual(a.conv.messages.map((m) => [m.uuid, m.role, m.text]), [
    ['web-msg-1', 'user', 'Plan the release for project-a'],
    ['web-msg-2', 'assistant', 'Here is a release plan.\n[tool: web_search]'],
  ]);
  assert.equal(a.conv.messages[1].parentUuid, 'web-msg-1');
  const b = parseWebConversation(legacy);
  assert.equal(b.conv.uuid, 'web-chat-2'); assert.equal(b.conv.title, 'Café notes 🚀'); assert.equal(b.conv.updatedAt, null);
  assert.deepEqual(b.conv.messages.map((m) => [m.uuid, m.role, m.text]), [[null, 'user', 'Hello from example.org']]);
  assert.equal(b.conv.messages[0].at, '2025-10-01T09:00:00.000Z');
  assert.equal(b.skipped, 1);   // the non-object message
  assert.ok(b.unknown.includes('mystery_field'));
  const c = parseWebConversation(noProject);
  assert.equal(c.conv.projectUuid, null);
  assert.deepEqual(c.conv.messages.map((m) => m.text), ['[attachment: notes.txt]', 'Answer']);
  assert.ok(c.unknown.includes('content:widget'));
  assert.equal(c.empty, 1);     // the message with no text and nothing else
  assert.deepEqual(parseWebConversation(notObj), { ok: false, reason: 'not-object' });
  assert.deepEqual(parseWebConversation(noId), { ok: false, reason: 'no-id' });
  assert.deepEqual(parseWebConversation({ uuid: '../../x', name: 'n' }), { ok: false, reason: 'no-id' });
});

test('parseWebConversation: secrets are masked on the full text BEFORE the cut (tool result and plain text)', () => {
  const key = 'sk-ant-' + 'a'.repeat(30);
  const longPrefix = 'x'.repeat(2039) + ' ';   // a word boundary before the key, as the anthropic-key rule needs
  const r = parseWebConversation({ uuid: 'web-s', chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'my key ' + key },
    { uuid: 'm2', sender: 'assistant', content: [{ type: 'tool_result', content: [{ type: 'text', text: longPrefix + key }] }] },
  ] });
  for (const m of r.conv.messages) assert.ok(!m.text.includes('sk-ant-'), m.text.slice(-60));
  assert.match(r.conv.messages[0].text, /••• secret \(anthropic-key\)/);
});

test('parseWebProject + the report holds counts and field names only, never content', () => {
  const [p, noUuid] = exportFixture().projects;
  const r = parseWebProject(p);
  assert.deepEqual(r.project, { uuid: 'web-proj-1', name: 'project-a (claude.ai)', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', docs: 1 });
  assert.deepEqual(parseWebProject(noUuid), { ok: false, reason: 'no-id' });
  const rep = newReport();
  for (const c of exportFixture().conversations) { const x = parseWebConversation(c); if (x.ok) noteUnknown(rep, x.unknown); }
  noteUnknown(rep, ['has space', 'a'.repeat(60)]);
  const s = JSON.stringify(rep);
  for (const leak of ['example.org', 'Placeholder brief', 'Release planning', 'notes.txt', 'not indexed']) assert.ok(!s.includes(leak), leak);
  assert.equal(rep.unknownFields['(other)'], 2);
  for (let i = 0; i < 80; i++) noteUnknown(rep, ['f' + i]);
  assert.ok(Object.keys(rep.unknownFields).length <= 51);
});

test('parseWebConversation: a secret split by a control byte is still masked (control bytes stripped BEFORE the mask)', () => {
  const split = 'sk-ant-' + 'a'.repeat(12) + '\u0001' + 'a'.repeat(18);
  const r = parseWebConversation({ uuid: 'web-c', name: 'k ' + split, chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'key ' + split },
    { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: 'a ' + split }, { type: 'text', text: 'b' }] },
  ] });
  for (const m of r.conv.messages) assert.ok(!m.text.includes('sk-ant-'), m.text);
  assert.ok(!r.conv.title.includes('sk-ant-'), r.conv.title);
  assert.match(r.conv.messages[0].text, /••• secret \(anthropic-key\)/);
  const p = parseWebProject({ uuid: 'web-p', name: 'p ' + split });
  assert.ok(!p.project.name.includes('sk-ant-'), p.project.name);
});
