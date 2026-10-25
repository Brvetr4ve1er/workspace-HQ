// ChatGPT data export (spec 2026-10-15 §5.1). Pure parser here; the importer (Task 4) below it. Ids: conversation
// 'chatgpt:<id>', message 'chatgpt:<id>:<node id|@index>', project CHATGPT_CHATS. maskSecrets on the FULL text before any cut.
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX, TOOL_RESULT_MAX } from './parse-code.mjs';
import { UUID_RE } from './parse-web.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractEntries, readZipIndex, baseName } from './unzip.mjs';
import { streamJsonArray, noteUnknown } from './parse-web.mjs';

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
  if (!(Number.isFinite(n) && n > 0)) return null;
  const d = new Date(Math.round(n * 1000));   // out-of-range epochs (> 8.64e15 ms) make an Invalid Date, never a throw
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

export const CHATGPT_CHATS = 'chatgpt:chats';
const ANNOUNCE_EVERY = 200;
const MEMORY_MAX_BYTES = 16 * 1024 * 1024;
const KNOWN_FILES = new Set(['conversations.json', 'user.json', 'memory.json', 'memories.json']);
const tick = () => new Promise((r) => setImmediate(r));
const notNewer = (prev, at) => !!prev && (!at || (!!prev.updated_at && prev.updated_at >= at));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

export function newChatGPTReport() {
  return { source: 'chatgpt', files: { conversations: false, user: false, other: [] },
    conversations: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 }, messages: { imported: 0, skipped: 0, empty: 0 },
    branches: { skipped: 0 }, memory: { found: false, imported: 0 }, unknownFields: {}, truncated: false };
}

export function ingestChatGPTConversation(store, conv, report) {
  const id = 'chatgpt:' + conv.id;
  if (store.isTombstoned('conversation', id) || store.isTombstoned('project', CHATGPT_CHATS)) { report.conversations.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('chatgpt', conv.id), conv.updatedAt)) { report.conversations.unchanged++; return 'unchanged'; }
  if (!conv.messages.length) { store.setSync('chatgpt', conv.id, conv.updatedAt); report.conversations.skipped++; return 'empty'; }
  const msgs = conv.messages.map((m) => ({ id: id + ':' + m.nodeId, nativeId: m.nodeId, parentId: m.parentId ? id + ':' + m.parentId : null,
    role: m.role, at: m.at, text: m.text, toolName: m.toolName, isSidechain: false }));
  let added = 0;
  store.tx(() => {
    store.upsertProject({ id: CHATGPT_CHATS, source: 'chatgpt', key: 'chats', name: 'ChatGPT chats', path: null });
    store.resetConversation(id);   // replace: an edited/regenerated chat rewrites its current branch
    store.ensureConversation({ id, source: 'chatgpt', projectId: CHATGPT_CHATS, nativeId: conv.id, cwd: null, gitBranch: null, model: conv.model });
    if (conv.title) store.setTitle(id, conv.title, 'web');
    added = store.addMessages(id, msgs);
    store.setSync('chatgpt', conv.id, conv.updatedAt);
  });
  report.conversations.imported++;
  report.messages.imported += added;
  report.messages.skipped += msgs.length - added;
  return 'imported';
}

// A memory file in a ChatGPT export has no documented shape: accept an array of strings or of objects with a string
// content/text/memory; anything else is "not recognized" (memory.found stays true, imported 0).
function importMemory(store, file, report) {
  report.memory.found = true;
  if (fs.statSync(file).size > MEMORY_MAX_BYTES) return;
  let rows; try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const raw = typeof r === 'string' ? r : r && typeof r === 'object' ? [r.content, r.text, r.memory].find((v) => typeof v === 'string') : null;
    if (!raw || !raw.trim()) continue;
    const text = cutText(safe(raw).trim(), TEXT_MAX);
    const title = cutText(text.split('\n')[0], 120);
    const res = store.upsertDocument({ id: 'memory:chatgpt:' + sha1(text), source: 'memory', path: null, title, text, meta: { origin: 'chatgpt' } });
    if (res === 'added' || res === 'updated') report.memory.imported++;
  }
}

export async function importChatGPTFile(store, zipPath, { tmpRoot, onProgress = () => {}, onImported = () => {}, maxBytes } = {}) {
  const report = newChatGPTReport();
  const names = (await readZipIndex(zipPath)).entries.filter((e) => !e.name.endsWith('/')).map((e) => baseName(e.name).toLowerCase());
  const has = (n) => names.includes(n);
  // re-verified here, never trusted from main's detection (spec §8 wording)
  if (!has('conversations.json')) throw new Error('Not a ChatGPT or claude.ai export (looked for conversations.json)');
  if (!has('user.json') && (has('projects.json') || has('users.json'))) throw new Error('This looks like a claude.ai export (projects.json / users.json, no user.json) — use Import claude.ai export');
  if (!has('user.json') && !has('chat.html')) throw new Error('Not a ChatGPT or claude.ai export (looked for conversations.json)');
  report.files.other = [...new Set(names.filter((n) => !KNOWN_FILES.has(n)))].sort().slice(0, 20).map((n) => n.slice(0, 80));
  fs.mkdirSync(tmpRoot, { recursive: true });
  const job = fs.mkdtempSync(path.join(tmpRoot, 'import-'));
  try {
    onProgress({ phase: 'unzip', done: 0, total: 0 });
    const got = await extractEntries(zipPath, ['conversations.json', 'user.json', 'memory.json', 'memories.json'], job, maxBytes ? { maxBytes } : {});
    report.files.conversations = !!got['conversations.json']; report.files.user = !!got['user.json'];
    const mem = got['memories.json'] || got['memory.json'];
    if (mem) importMemory(store, mem, report);
    let fresh = [];
    const announce = () => { if (fresh.length) { const ids = fresh; fresh = []; onImported(ids); } };
    let r;
    try {
      r = await streamJsonArray(got['conversations.json'], async (raw) => {
        report.conversations.seen++;
        const c = parseChatGPTConversation(raw);
        if (!c.ok) { report.conversations.skipped++; return; }
        noteUnknown(report, c.unknown);
        report.branches.skipped += c.branches; report.messages.skipped += c.skipped; report.messages.empty += c.empty;
        if (ingestChatGPTConversation(store, c.conv, report) === 'imported') fresh.push('chatgpt:' + c.conv.id);
        onProgress({ phase: 'conversations', done: report.conversations.seen, total: 0 });
        if (report.conversations.seen % ANNOUNCE_EVERY === 0) { announce(); await tick(); }
      });
    } finally { announce(); }
    report.conversations.skipped += r.bad; if (r.truncated) report.truncated = true;
    return report;
  } finally {
    fs.rmSync(job, { recursive: true, force: true });
  }
}
