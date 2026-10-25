// Placeholder ChatGPT data export for tests and gates (spec 2026-10-15 §5.1, §9). Placeholder text only; the secret-shaped
// string is built at runtime by the caller; ZIPs are written at runtime.
import { zipFiles } from './make-export.mjs';

export const CG_IDS = { a: 'cg-0001-aaaa', b: 'cg-0002-bbbb', loop: 'cg-0003-loop', dangling: 'cg-0004-dang', empty: 'cg-0005-empt' };
const m = (id, role, t, content, { name = null, hidden = false } = {}) =>
  ({ id, author: { role, name, metadata: {} }, create_time: t, content, status: 'finished_successfully',
    metadata: hidden ? { is_visually_hidden_from_conversation: true } : {} });
const text = (...parts) => ({ content_type: 'text', parts });
const node = (id, parent, children, message = null) => ({ id, message, parent, children });

export function chatgptFixture({ secret = 'sk-' + 'proj-' + 'Q'.repeat(40) } = {}) {
  const T = 1759320000;   // 2025-10-01T12:00:00Z
  const a = {
    title: 'Placeholder lantern festival', create_time: T, update_time: T + 600, conversation_id: CG_IDS.a, id: CG_IDS.a,
    current_node: 'n6', default_model_slug: 'placeholder-model', some_future_field: 1,
    mapping: {
      n0: node('n0', null, ['n1']),
      n1: node('n1', 'n0', ['n2'], m('n1', 'system', T, text(''), { hidden: true })),
      n2: node('n2', 'n1', ['n3a', 'n3b'], m('n2', 'user', T + 10, text('Placeholder: plan the lantern festival'))),
      n3a: node('n3a', 'n2', [], m('n3a', 'assistant', T + 20, text('an older branch answer'))),
      n3b: node('n3b', 'n2', ['n4'], m('n3b', 'assistant', T + 30, { content_type: 'multimodal_text', parts: ['Here is a sketch', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://placeholder' }] })),
      n4: node('n4', 'n3b', ['n5'], m('n4', 'assistant', T + 40, { content_type: 'code', language: 'python', text: 'print(1)' })),
      n5: node('n5', 'n4', ['n6'], m('n5', 'tool', T + 50, { content_type: 'execution_output', text: '1' }, { name: 'python' })),
      n6: node('n6', 'n5', [], m('n6', 'assistant', T + 60, text('Done — the token is ' + secret))),
    },
  };
  const b = { title: 'Placeholder second chat', create_time: T + 1000, update_time: T + 1100, conversation_id: CG_IDS.b, current_node: 'b2',
    mapping: { b1: node('b1', null, ['b2'], m('b1', 'user', T + 1000, text('placeholder hello'))), b2: node('b2', 'b1', [], m('b2', 'assistant', T + 1100, text('placeholder hi'))) } };
  const loop = { title: 'Placeholder loop', create_time: T, update_time: T, conversation_id: CG_IDS.loop, current_node: 'l2',
    mapping: { l1: node('l1', 'l2', ['l2'], m('l1', 'user', T, text('placeholder loop one'))), l2: node('l2', 'l1', ['l1'], m('l2', 'assistant', T + 1, text('placeholder loop two'))) } };
  const dangling = { title: 'Placeholder dangling', create_time: T, update_time: T, conversation_id: CG_IDS.dangling, current_node: 'missing-node',
    mapping: { d1: node('d1', null, ['d2', 'd3']), d2: node('d2', 'd1', [], m('d2', 'user', T + 5, text('placeholder older leaf'))), d3: node('d3', 'd1', [], m('d3', 'user', T + 9, text('placeholder newest leaf'))) } };
  const empty = { title: 'Placeholder empty', create_time: T, update_time: T, conversation_id: CG_IDS.empty, current_node: 'e1',
    mapping: { e1: node('e1', null, [], m('e1', 'system', T, text(''))) } };
  return { conversations: [a, b, loop, dangling, empty, { title: 'no id', mapping: {} }, 'not an object'], user: { id: 'user-placeholder', chatgpt_plus_user: false } };
}

export function writeChatGPTZip(file, { conversations, user, extra = [] } = {}) {
  const f = chatgptFixture();
  zipFiles(file, [
    { name: 'conversations.json', data: JSON.stringify(conversations ?? f.conversations) },
    { name: 'user.json', data: JSON.stringify(user ?? f.user) },
    { name: 'message_feedback.json', data: '[]' },
    { name: 'chat.html', data: '<html>placeholder</html>' },
    ...extra,
  ]);
  return file;   // zipFiles writes the file and returns nothing
}
