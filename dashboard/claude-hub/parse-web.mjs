// claude.ai export / live-sync parser (spec 2026-10-13 §5.2–§5.3). The format is undocumented: accept known variants,
// count what is not understood (field NAMES only — never content), never throw on a row. Every text goes through
// maskSecrets on the FULL string before any cut (H1 ruling).
import fs from 'node:fs';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX, TOOL_RESULT_MAX } from './parse-code.mjs';

export const UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');
const safe = (s) => maskSecrets(String(s)).text;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const KNOWN_CONV = new Set(['uuid', 'id', 'name', 'title', 'summary', 'created_at', 'updated_at', 'create_time', 'update_time', 'account',
  'chat_messages', 'messages', 'project_uuid', 'project', 'project_id', 'model', 'settings', 'is_starred', 'is_temporary', 'current_leaf_message_uuid', 'platform']);
const KNOWN_MSG = new Set(['uuid', 'id', 'text', 'content', 'sender', 'role', 'created_at', 'updated_at', 'create_time', 'attachments', 'files', 'files_v2',
  'parent_message_uuid', 'parent', 'index', 'truncated', 'stop_reason', 'sync_sources', 'input_mode']);
const KNOWN_PROJ = new Set(['uuid', 'id', 'name', 'description', 'docs', 'created_at', 'updated_at', 'creator', 'is_private', 'is_starred',
  'is_starter_project', 'prompt_template', 'archived_at', 'permissions']);

export function isoOrNull(v) {
  let d = null;
  if (typeof v === 'number' && Number.isFinite(v)) d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim()) d = new Date(v);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

export function newReport() {
  return { files: { conversations: false, projects: false },
    conversations: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 },
    messages: { imported: 0, skipped: 0, empty: 0 },
    projects: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 },
    unknownFields: {}, truncated: false };
}

export function noteUnknown(report, names) {
  const u = report.unknownFields;
  for (const n of names || []) {
    const ok = typeof n === 'string' && /^[A-Za-z0-9_:]{1,48}$/.test(n) && (n in u || Object.keys(u).filter((k) => k !== '(other)').length < 50);
    const k = ok ? n : '(other)';
    u[k] = (u[k] || 0) + 1;
  }
}

const unknownOf = (o, known, prefix = '') => Object.keys(o).filter((k) => !known.has(k)).map((k) => prefix + k);
const uuidOf = (o) => { const u = typeof o.uuid === 'string' ? o.uuid : typeof o.id === 'string' ? o.id : ''; return UUID_RE.test(u) ? u : null; };

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : isObj(b) ? str(b.text) : '')).join('\n');
  return '';
}

function messageText(m, unknown) {
  const parts = [];
  if (Array.isArray(m.content) && m.content.length) {
    for (const b of m.content) {
      if (!isObj(b)) continue;
      if (b.type === 'text') parts.push(safe(str(b.text)));
      else if (b.type === 'tool_use') parts.push('[tool: ' + cutText(safe(str(b.name) || 'tool'), 80) + ']');
      else if (b.type === 'tool_result') parts.push(cutText(safe(resultText(b.content)), TOOL_RESULT_MAX));   // masked whole, then cut
      else if (b.type === 'image') parts.push('[image]');
      else if (b.type === 'document') parts.push('[document]');
      else if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
      else unknown.push('content:' + String(b.type || 'untyped'));
    }
  } else if (typeof m.text === 'string') parts.push(safe(m.text));
  for (const a of [...(Array.isArray(m.attachments) ? m.attachments : []), ...(Array.isArray(m.files) ? m.files : [])]) {
    if (isObj(a) && str(a.file_name)) parts.push('[attachment: ' + cutText(safe(a.file_name), 120) + ']');
  }
  return cutText(clean(parts.filter(Boolean).join('\n')).trim(), TEXT_MAX);
}

function roleOf(m) {
  const s = str(m.sender) || str(m.role);
  return s === 'human' || s === 'user' ? 'user' : s === 'assistant' ? 'assistant' : null;
}

export function parseWebConversation(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not-object' };
  const uuid = uuidOf(raw);
  if (!uuid) return { ok: false, reason: 'no-id' };
  const unknown = unknownOf(raw, KNOWN_CONV);
  const createdAt = isoOrNull(raw.created_at ?? raw.create_time);
  const list = Array.isArray(raw.chat_messages) ? raw.chat_messages : Array.isArray(raw.messages) ? raw.messages : [];
  if (!Array.isArray(raw.chat_messages) && !Array.isArray(raw.messages)) unknown.push('no-messages');
  const messages = [];
  let skipped = 0, empty = 0;
  for (const m of list) {
    if (!isObj(m)) { skipped++; continue; }
    unknown.push(...unknownOf(m, KNOWN_MSG, 'message:'));
    const role = roleOf(m);
    if (!role) { skipped++; unknown.push('sender:' + String(str(m.sender) || str(m.role) || 'none').slice(0, 20)); continue; }
    const text = messageText(m, unknown);
    if (!text) { empty++; continue; }
    const mu = uuidOf(m), parent = str(m.parent_message_uuid) || str(m.parent);
    messages.push({ uuid: mu, parentUuid: UUID_RE.test(parent) ? parent : null, role, at: isoOrNull(m.created_at ?? m.create_time ?? m.updated_at) || createdAt, text });
  }
  const projectUuid = [raw.project_uuid, isObj(raw.project) ? raw.project.uuid : null, raw.project_id].find((p) => typeof p === 'string' && UUID_RE.test(p)) || null;
  const title = cutText(clean(safe(str(raw.name) || str(raw.title))).trim(), 200);
  return { ok: true, skipped, empty, unknown,
    conv: { uuid, title, projectUuid, model: str(raw.model).slice(0, 80) || null, createdAt, updatedAt: isoOrNull(raw.updated_at ?? raw.update_time), messages } };
}

export function parseWebProject(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'not-object' };
  const uuid = uuidOf(raw);
  if (!uuid) return { ok: false, reason: 'no-id' };
  return { ok: true, unknown: unknownOf(raw, KNOWN_PROJ, 'project:'),
    project: { uuid, name: cutText(clean(safe(str(raw.name))).trim(), 200) || 'claude.ai project', createdAt: isoOrNull(raw.created_at),
      updatedAt: isoOrNull(raw.updated_at), docs: Array.isArray(raw.docs) ? raw.docs.length : 0 } };
}

export async function streamJsonArray(file, onItem, { maxItemBytes = 256 * 1024 * 1024 } = {}) {
  let opened = false, closed = false, depth = 0, inStr = false, esc = false;
  let parts = null, from = -1, size = 0, items = 0, bad = 0;
  const begin = (i) => { parts = []; from = i; size = 0; };
  const finish = async (chunk, end) => {
    if (size + (end - from) > maxItemBytes) throw new Error('an item is larger than ' + maxItemBytes + ' bytes');
    parts.push(chunk.subarray(from, end));
    const buf = Buffer.concat(parts); parts = null; from = -1;
    let v;
    try { v = JSON.parse(buf.toString('utf8')); } catch { bad++; return; }
    items++; await onItem(v);
  };
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    if (parts) from = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inStr) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x22) inStr = false; continue; }
      if (!opened) {
        if (c === 0x5b) { opened = true; depth = 1; }
        else if (c > 0x20 && c !== 0xef && c !== 0xbb && c !== 0xbf) throw new Error('not a JSON array');
        continue;
      }
      if (closed) continue;
      if (c === 0x22) { if (!parts) begin(i); inStr = true; continue; }
      if (c === 0x7b || c === 0x5b) { if (!parts) begin(i); depth++; continue; }
      if (c === 0x7d || c === 0x5d) {
        if (depth === 1) { if (parts) await finish(chunk, i); closed = true; continue; }
        depth--;
        if (depth === 1 && parts) await finish(chunk, i + 1);
        continue;
      }
      if (depth === 1) {
        if (c === 0x2c) { if (parts) await finish(chunk, i); continue; }
        if (c <= 0x20) continue;
        if (!parts) begin(i);
      }
    }
    if (parts) {
      parts.push(chunk.subarray(from)); size += chunk.length - from;
      if (size > maxItemBytes) throw new Error('an item is larger than ' + maxItemBytes + ' bytes');
    }
  }
  if (!opened) throw new Error('not a JSON array');
  return { items, bad, truncated: !closed };
}
