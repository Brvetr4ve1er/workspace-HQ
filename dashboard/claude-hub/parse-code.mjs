// dashboard/claude-hub/parse-code.mjs
// One Claude Code transcript line (~/.claude/projects/<folder>/<sessionId>.jsonl) → a
// message, a title, a meta marker or 'bad' (spec §5.1). Pure, never throws.
// Only `type`, message.role/content/usage/id/model and the line's own uuid,
// parentUuid, timestamp, cwd, gitBranch, sessionId, isSidechain, isMeta,
// isCompactSummary are relied on; every other field and line type is ignored.
// Secrets are masked HERE, on the whole text, before any length cap (spec §4 "masked … before indexing"): a cap that
// cuts through a secret first leaves a prefix too short for its rule ('sk-ant-' + 15 chars, 'AKIA' + 6, a 10-char
// bearer token), and that prefix would reach the index unmasked.
import { maskSecrets } from './redact.mjs';

export const TOOL_RESULT_MAX = 2048;
// ONE text-cap rule for every content shape (string or block array): system-role text (isMeta, compact
// summary, command echoes: harness noise, skill-body injections of 20-45k chars) is cut to SYSTEM_TEXT_MAX,
// everything else to TEXT_MAX; a cut always ends with '…' so truncation is never silent.
export const SYSTEM_TEXT_MAX = 500;
export const TEXT_MAX = 200000;
const COMMAND_ECHO = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;
const str = (v) => (typeof v === 'string' && v ? v : null);
// control-char strip (NUL survives in SQLite but reads back truncated at the NUL), then the mask, on the WHOLE text: a
// control char inside a secret is stripped before the rules look, and nothing has been cut yet. Every cap comes after.
const safe = (s) => maskSecrets(String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')).text;
const iso = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
// a cut never splits a surrogate pair: a lone high surrogate breaks JSON consumers and encodeURIComponent
export const cutText = (s, max) => {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end) + '…';
};
const cut = cutText;
// strip + mask + trim, then the role's cap with its marker
const body = (s, role) => cut(safe(s).trim(), role === 'system' ? SYSTEM_TEXT_MAX : TEXT_MAX);
// safe() masks first, then the 200-unit cut (no marker: H1 contract, pinned by the straddle test); surrogate-safe like cutText
const titleText = (s) => { const t = safe(s).trim(); if (t.length <= 200) return t; const c = t.charCodeAt(199); return t.slice(0, c >= 0xd800 && c <= 0xdbff ? 199 : 200); };

function toolHint(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
    // masked before the 80-char cut: `export ANTHROPIC_API_KEY=…` or `curl -H "Authorization: Bearer …` behind a long prefix straddles it
    if (typeof input[k] === 'string' && input[k]) return ' ' + cut(safe(input[k].replace(/\s+/g, ' ')), 80);
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
    return { role, text: body(content, role), toolName: null };
  }
  if (!Array.isArray(content)) return { role: type === 'assistant' ? 'assistant' : 'user', text: '', toolName: null };
  const parts = []; let toolName = null, onlyResults = content.length > 0;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type !== 'tool_result') onlyResults = false;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_use') { toolName = toolName || str(b.name); parts.push('[tool: ' + (str(b.name) || 'tool') + toolHint(b.input) + ']'); }
    else if (b.type === 'tool_result') parts.push(cut(safe(resultText(b.content)), TOOL_RESULT_MAX));   // masked whole, then cut
    else if (b.type === 'image') parts.push('[image]');
    else if (b.type === 'document') parts.push('[document]');
    // thinking / redacted_thinking / anything else: dropped
  }
  const role = onlyResults ? 'tool' : type === 'assistant' ? 'assistant' : systemish ? 'system' : 'user';
  const joined = parts.join('\n');
  // tool output goes through the same strip + cap (body) as every other role, system included
  return { role, text: body(joined, role), toolName };
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
  if (j.type === 'custom-title' && typeof j.customTitle === 'string') return { kind: 'title', sessionId, title: titleText(j.customTitle), source: 'custom' };
  if (j.type === 'ai-title' && typeof j.aiTitle === 'string') return { kind: 'title', sessionId, title: titleText(j.aiTitle), source: 'ai' };
  if (j.type !== 'user' && j.type !== 'assistant') return { kind: 'meta', type: String(j.type || 'unknown') };
  const msg = j.message && typeof j.message === 'object' ? j.message : null;
  if (!msg) return { kind: 'meta', type: j.type };
  const systemish = j.type === 'user' && (!!j.isMeta || !!j.isCompactSummary);
  const { role, text, toolName } = toText(msg.content, j.type, systemish);
  return {
    kind: 'message', sessionId, uuid: str(j.uuid), parentUuid: str(j.parentUuid), at: iso(j.timestamp),
    cwd: str(j.cwd) && maskSecrets(str(j.cwd)).text, gitBranch: str(j.gitBranch), isSidechain: !!j.isSidechain, role, text, toolName,
    model: j.type === 'assistant' ? str(msg.model) : null, apiId: j.type === 'assistant' ? str(msg.id) : null,
    usage: j.type === 'assistant' && msg.usage && typeof msg.usage === 'object' ? normUsage(msg.usage) : null,
  };
}
