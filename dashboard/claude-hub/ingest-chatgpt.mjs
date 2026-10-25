// ChatGPT data export (spec 2026-10-15 §5.1). Pure parser here; the importer (Task 4) below it. Ids: conversation
// 'chatgpt:<id>', message 'chatgpt:<id>:<node id|@index>', project CHATGPT_CHATS. maskSecrets on the FULL text before any cut.
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX, TOOL_RESULT_MAX } from './parse-code.mjs';
import { UUID_RE } from './parse-web.mjs';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(String(s))).text;
const ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const KNOWN_CONV = new Set(['title', 'create_time', 'update_time', 'mapping', 'current_node', 'conversation_id', 'id', 'default_model_slug',
  'moderation_results', 'plugin_ids', 'gizmo_id', 'gizmo_type', 'is_archived', 'safe_urls', 'blocked_urls', 'conversation_template_id',
  'voice', 'async_status', 'disabled_tool_ids', 'is_do_not_remember', 'memory_scope', 'conversation_origin', 'is_starred', 'is_read_only',
  'sugar_item_id', 'sugar_item_visible', 'owner', 'context_scopes', 'pinned_time', 'is_study_mode']);

export function epochIso(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(Math.round(n * 1000)).toISOString() : null;
}

function partText(p) {
  if (typeof p === 'string') return p;
  if (isObj(p)) return /image/i.test(str(p.content_type)) ? '[image]' : '[attachment]';
  return '';
}

function contentText(c) {
  if (!isObj(c)) return '';
  const type = str(c.content_type);
  if (type === 'code') return '```' + str(c.language).replace(/[^\w+-]/g, '').slice(0, 20) + '\n' + str(c.text) + '\n```';
  if (type === 'execution_output') return str(c.text);
  if (Array.isArray(c.parts)) return c.parts.map(partText).filter((s) => s !== '').join('\n');
  if (typeof c.text === 'string') return c.text;
  if (typeof c.result === 'string') return c.result;
  return '';
}

// root → leaf ids of the branch the owner last saw. The walk is bounded (seen set): a parent cycle ends it.
function walk(mapping, current) {
  let leaf = typeof current === 'string' && isObj(mapping[current]) ? current : null;
  const leaves = Object.keys(mapping).filter((k) => isObj(mapping[k]) && !(Array.isArray(mapping[k].children) && mapping[k].children.length));
  if (!leaf) {   // dangling or missing current_node: the newest leaf (create_time, then id) is the best guess
    const t = (k) => (isObj(mapping[k].message) && Number(mapping[k].message.create_time)) || 0;
    leaf = leaves.slice().sort((x, y) => t(y) - t(x) || (x < y ? -1 : 1))[0] || null;
  }
  const path = [], seen = new Set();
  for (let id = leaf; typeof id === 'string' && isObj(mapping[id]) && !seen.has(id); id = mapping[id].parent) { seen.add(id); path.push(id); }
  return { path: path.reverse(), branches: Math.max(0, leaves.filter((k) => k !== leaf).length) };
}

export function parseChatGPTConversation(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  const id = str(raw.conversation_id) || str(raw.id);
  if (!UUID_RE.test(id)) return { ok: false, reason: 'no conversation id' };
  if (!isObj(raw.mapping)) return { ok: false, reason: 'no mapping' };
  const unknown = Object.keys(raw).filter((k) => !KNOWN_CONV.has(k));
  const createdAt = epochIso(raw.create_time), updatedAt = epochIso(raw.update_time) || createdAt;
  const { path, branches } = walk(raw.mapping, raw.current_node);
  const messages = [];
  let skipped = 0, empty = 0, prev = null;
  path.forEach((nodeId, i) => {
    const msg = raw.mapping[nodeId].message;
    if (!isObj(msg)) return;   // structural root
    const role = isObj(msg.author) ? str(msg.author.role) : '';
    if (!ROLES.has(role) || (isObj(msg.metadata) && msg.metadata.is_visually_hidden_from_conversation)) { skipped++; return; }
    const body = safe(contentText(msg.content)).trim();
    if (!body) { empty++; return; }
    const text = cutText(body, role === 'tool' ? TOOL_RESULT_MAX : TEXT_MAX);
    const nid = UUID_RE.test(nodeId) ? nodeId : '@' + i;
    messages.push({ nodeId: nid, parentId: prev, role, at: epochIso(msg.create_time) || updatedAt, text,
      toolName: role === 'tool' ? cutText(safe(str(msg.author.name) || 'tool'), 80) : null });
    prev = nid;
  });
  const title = cutText(safe(str(raw.title)).trim(), 200) || null;
  const model = str(raw.default_model_slug) ? cutText(safe(raw.default_model_slug), 80) : null;
  return { ok: true, conv: { id, title, createdAt, updatedAt, model, messages }, branches, skipped, empty, unknown };
}
