// dashboard/claude-hub/parse-code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeLine, TOOL_RESULT_MAX } from './parse-code.mjs';

const L = (o) => JSON.stringify(o);
const base = { sessionId: 's1', uuid: 'u1', parentUuid: null, timestamp: '2026-10-01T10:00:00.000Z', cwd: 'C:\\placeholder\\project-a', gitBranch: 'main' };

test('user text, assistant text + tool_use, tool_result trimmed, thinking dropped', () => {
  const u = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: 'hello there' } }));
  assert.equal(u.kind, 'message'); assert.equal(u.role, 'user'); assert.equal(u.text, 'hello there'); assert.equal(u.cwd, base.cwd);
  const a = parseCodeLine(L({ ...base, uuid: 'u2', type: 'assistant', message: { id: 'msg_1', model: 'claude-x', role: 'assistant',
    content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Reading it' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\p\\a.js' } }],
    usage: { input_tokens: 6, output_tokens: 9, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } } }));
  assert.equal(a.role, 'assistant'); assert.equal(a.text, 'Reading it\n[tool: Read C:\\p\\a.js]'); assert.equal(a.toolName, 'Read');
  assert.equal(a.apiId, 'msg_1'); assert.deepEqual(a.usage, { in: 6, out: 9, cacheRead: 100, cacheWrite: 50 });
  const big = 'x'.repeat(TOOL_RESULT_MAX + 500);
  const t = parseCodeLine(L({ ...base, uuid: 'u3', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } }));
  assert.equal(t.role, 'tool'); assert.equal(t.text.length, TOOL_RESULT_MAX + 1); assert.ok(t.text.endsWith('…'));
  const th = parseCodeLine(L({ ...base, uuid: 'u4', type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }], usage: { output_tokens: 917 } } }));
  assert.equal(th.text, ''); assert.equal(th.usage.out, 917, 'usage kept even when no text');
});

test('control characters are stripped from every role, tool output included (NUL reads back truncated from SQLite)', () => {
  const dirty = 'a\u0000b\u001b[0mc\ttail\nend';
  const tool = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: dirty }] } }));
  assert.equal(tool.role, 'tool'); assert.equal(tool.text, 'ab[0mc\ttail\nend');
  const arr = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: dirty }] }] } }));
  assert.equal(arr.text, 'ab[0mc\ttail\nend', 'array-form tool_result content is cleaned too');
  const user = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: dirty } }));
  assert.equal(user.text, 'ab[0mc\ttail\nend');
  for (const m of [tool, arr, user]) assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(m.text));
});

test('titles, command echoes and meta lines', () => {
  assert.deepEqual(parseCodeLine(L({ type: 'custom-title', customTitle: ' My chat ', sessionId: 's1' })), { kind: 'title', sessionId: 's1', title: 'My chat', source: 'custom' });
  assert.deepEqual(parseCodeLine(L({ type: 'ai-title', aiTitle: 'List files', sessionId: 's1' })), { kind: 'title', sessionId: 's1', title: 'List files', source: 'ai' });
  const echo = parseCodeLine(L({ ...base, type: 'user', message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } }));
  assert.equal(echo.role, 'system');
  const meta = parseCodeLine(L({ ...base, type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: …' } }));
  assert.equal(meta.role, 'system');
  const compact = parseCodeLine(L({ ...base, type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } }));
  assert.equal(compact.role, 'system');
  assert.deepEqual(parseCodeLine(L({ type: 'file-history-snapshot', messageId: 'x' })), { kind: 'meta', type: 'file-history-snapshot' });
});

test('robust input: BOM, CRLF, blank, broken JSON, missing uuid, bad timestamp (Review Focus 4, 5)', () => {
  const withBom = '\ufeff' + L({ ...base, type: 'user', message: { role: 'user', content: 'café 🚀' } }) + '\r';
  assert.equal(parseCodeLine(withBom).text, 'café 🚀');
  assert.equal(parseCodeLine(''), null);
  assert.equal(parseCodeLine('   '), null);
  assert.deepEqual(parseCodeLine('{"type":"user",'), { kind: 'bad' });
  assert.deepEqual(parseCodeLine('42'), { kind: 'bad' });
  const noId = parseCodeLine(L({ type: 'user', sessionId: 's1', timestamp: 'not a date', message: { role: 'user', content: 'hi' } }));
  assert.equal(noId.uuid, null); assert.equal(noId.at, null);
});
