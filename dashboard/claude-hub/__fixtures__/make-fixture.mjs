// dashboard/claude-hub/__fixtures__/make-fixture.mjs
// A placeholder ~/.claude for tests and gates. Placeholder text only — never real data.
import fs from 'node:fs';
import path from 'node:path';

export const userLine = ({ uuid, sessionId, at, cwd = 'C:\\placeholder\\project-a', text, isMeta = false, parentUuid = null }) =>
  JSON.stringify({ type: 'user', uuid, parentUuid, sessionId, timestamp: at, cwd, gitBranch: 'main', isSidechain: false, isMeta,
    message: { role: 'user', content: text } }) + '\n';

// one API response written as one line per content block, each repeating usage (as Claude Code does)
export const assistantLines = ({ apiId, uuids, sessionId, at, cwd = 'C:\\placeholder\\project-a', blocks, usage, model = 'claude-placeholder' }) =>
  blocks.map((b, i) => JSON.stringify({ type: 'assistant', uuid: uuids[i], parentUuid: null, sessionId, timestamp: at, cwd, gitBranch: 'main',
    isSidechain: false, message: { id: apiId, model, role: 'assistant', content: [b], usage } }) + '\n').join('');

export const titleLine = ({ sessionId, title, ai = false }) =>
  JSON.stringify(ai ? { type: 'ai-title', aiTitle: title, sessionId } : { type: 'custom-title', customTitle: title, sessionId }) + '\n';

export function makeClaudeHome(dir) {
  const home = path.join(dir, '.claude'), root = path.join(home, 'projects');
  const a = path.join(root, 'C--placeholder-project-a'), b = path.join(root, 'C--placeholder-project-b');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  fs.mkdirSync(path.join(a, 'sess-a1', 'subagents'), { recursive: true });   // nested folders are ignored in H1
  const usage = { input_tokens: 6, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 };
  const a1 = path.join(a, 'sess-a1.jsonl');
  fs.writeFileSync(a1,
    JSON.stringify({ type: 'file-history-snapshot', messageId: 'x' }) + '\n' +
    userLine({ uuid: 'a1-u1', sessionId: 'sess-a1', at: '2026-10-01T10:00:00.000Z', text: 'Plan the placeholder release' }) +
    assistantLines({ apiId: 'msg_a1', uuids: ['a1-a1', 'a1-a2'], sessionId: 'sess-a1', at: '2026-10-01T10:01:00.000Z',
      blocks: [{ type: 'text', text: 'Here is the plan' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }], usage }) +
    titleLine({ sessionId: 'sess-a1', title: 'Release planning', ai: true }));
  const a2 = path.join(a, 'sess-a2.jsonl');
  fs.writeFileSync(a2, userLine({ uuid: 'a2-u1', sessionId: 'sess-a2', at: '2026-10-02T09:00:00.000Z', text: 'Fix the café bug 🚀' }));
  const b1 = path.join(b, 'sess-b1.jsonl');
  fs.writeFileSync(b1, userLine({ uuid: 'b1-u1', sessionId: 'sess-b1', at: '2026-09-30T08:00:00.000Z', cwd: 'C:\\placeholder\\project-b', text: 'Hello project b' }));
  fs.utimesSync(b1, new Date('2026-09-30T08:00:00Z'), new Date('2026-09-30T08:00:00Z'));
  fs.writeFileSync(path.join(a, 'sess-a1', 'subagents', 'agent-x.jsonl'), userLine({ uuid: 'sub-1', sessionId: 'sess-a1', at: '2026-10-01T10:05:00.000Z', text: 'sub' }));
  return { home, root, files: { a1, a2, b1 } };
}
