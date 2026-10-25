import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTConversation, epochIso } from './ingest-chatgpt.mjs';
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
