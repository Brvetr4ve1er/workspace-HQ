// dashboard/claude-hub/parse-code.mjs
// One Claude Code transcript line (~/.claude/projects/<folder>/<sessionId>.jsonl) → a
// message, a title, a meta marker or 'bad' (spec §5.1). Pure, never throws.
// Only `type`, message.role/content/usage/id/model and the line's own uuid,
// parentUuid, timestamp, cwd, gitBranch, sessionId, isSidechain, isMeta,
// isCompactSummary are relied on; every other field and line type is ignored.
export const TOOL_RESULT_MAX = 2048;
const COMMAND_ECHO = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;
const str = (v) => (typeof v === 'string' && v ? v : null);
const clean = (s, max) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const iso = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const cut = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s);

function toolHint(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
    if (typeof input[k] === 'string' && input[k]) return ' ' + cut(input[k].replace(/\s+/g, ' '), 80);
  }
  return '';
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
  return '';
}

function toText(content, type, systemish) {
  if (typeof content === 'string') {
    const role = type === 'assistant' ? 'assistant' : systemish || COMMAND_ECHO.test(content) ? 'system' : 'user';
    return { role, text: clean(content, role === 'system' ? 500 : 200000), toolName: null };
  }
  if (!Array.isArray(content)) return { role: type === 'assistant' ? 'assistant' : 'user', text: '', toolName: null };
  const parts = []; let toolName = null, onlyResults = content.length > 0;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type !== 'tool_result') onlyResults = false;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_use') { toolName = toolName || str(b.name); parts.push('[tool: ' + (str(b.name) || 'tool') + toolHint(b.input) + ']'); }
    else if (b.type === 'tool_result') parts.push(cut(resultText(b.content), TOOL_RESULT_MAX));
    else if (b.type === 'image') parts.push('[image]');
    else if (b.type === 'document') parts.push('[document]');
    // thinking / redacted_thinking / anything else: dropped
  }
  const role = onlyResults ? 'tool' : type === 'assistant' ? 'assistant' : systemish ? 'system' : 'user';
  const joined = parts.join('\n');
  // tool output goes through clean() too: a NUL byte survives in SQLite but reads back truncated at the NUL
  return { role, text: clean(joined, 200000), toolName };
}

function normUsage(u) {
  const v = (x) => (Number.isFinite(x) ? x : 0);
  return { in: v(u.input_tokens), out: v(u.output_tokens), cacheRead: v(u.cache_read_input_tokens), cacheWrite: v(u.cache_creation_input_tokens) };
}

export function parseCodeLine(line) {
  if (typeof line !== 'string') return null;
  const s = (line.charCodeAt(0) === 0xfeff ? line.slice(1) : line).trim();
  if (!s) return null;
  let j;
  try { j = JSON.parse(s); } catch { return { kind: 'bad' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { kind: 'bad' };
  const sessionId = str(j.sessionId) || str(j.session_id);
  if (j.type === 'custom-title' && typeof j.customTitle === 'string') return { kind: 'title', sessionId, title: clean(j.customTitle, 200), source: 'custom' };
  if (j.type === 'ai-title' && typeof j.aiTitle === 'string') return { kind: 'title', sessionId, title: clean(j.aiTitle, 200), source: 'ai' };
  if (j.type !== 'user' && j.type !== 'assistant') return { kind: 'meta', type: String(j.type || 'unknown') };
  const msg = j.message && typeof j.message === 'object' ? j.message : null;
  if (!msg) return { kind: 'meta', type: j.type };
  const systemish = j.type === 'user' && (!!j.isMeta || !!j.isCompactSummary);
  const { role, text, toolName } = toText(msg.content, j.type, systemish);
  return {
    kind: 'message', sessionId, uuid: str(j.uuid), parentUuid: str(j.parentUuid), at: iso(j.timestamp),
    cwd: str(j.cwd), gitBranch: str(j.gitBranch), isSidechain: !!j.isSidechain, role, text, toolName,
    model: j.type === 'assistant' ? str(msg.model) : null, apiId: j.type === 'assistant' ? str(msg.id) : null,
    usage: j.type === 'assistant' && msg.usage && typeof msg.usage === 'object' ? normUsage(msg.usage) : null,
  };
}
