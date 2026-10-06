// Ask history + sources, stored in v3's ORACLE format (legacy/dashboard-v3).
//
// v3 and v5 run in the same window on the same file:// origin, so they share
// localStorage: v3's keys are adopted as they are (legacy/dashboard-v3/src/realms/oracle/view.js:18-56)
// and a flip between renderers keeps today's chat and the ticked sources.
//
//   hq-oracle-include  {"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false}
//                      a value that isn't a boolean falls back to its default
//   hq-oracle-chat     {"day":"YYYY-MM-DD" (en-CA, local), "messages":[{role:'user'|'assistant', content, meta?}]}
//                      one day only; at most 40 messages; assistant meta is
//                      {status:'done'|'cancelled'|'error'|'unavailable', reason?, sections, ms, model}
//                      or {pending:true} while the answer streams (→ "interrupted" on load)
//
// v5 keeps one entry per exchange: { id, q, a: { text, status, meta, est } } where
// a.status is 'thinking' while the answer streams, else v3's meta.status, and
// a.meta is v3's meta object as it is (so a load → save round trip is exact).
// Entries marked `local` (refusals made before any request: no bridge, a past
// day, the model is down) are v5-only and never written: v3 has no such message.
//
// Pure: storage (a Web Storage) and the day are passed in; nothing here touches the DOM.

export const LS_CHAT = 'hq-oracle-chat';
export const LS_INCLUDE = 'hq-oracle-include';
export const KEEP = 40;                       // messages kept per day (v3)
export const INTERRUPTED = 'interrupted — the window reloaded';
export const STATUSES = ['done', 'cancelled', 'error', 'unavailable'];

// v3's chips, in v3's order, with v3's tooltips
export const SOURCES = [
  { id: 'scan', label: 'Scan', tip: 'Level, XP, health index and today\'s suggested picks' },
  { id: 'tasks', label: 'Tasks', tip: 'Open tasks and flagged risks' },
  { id: 'projects', label: 'Projects', tip: 'Git, build, tests and activity for each project' },
  { id: 'health', label: 'PC health', tip: 'The SYSTEM tab\'s vitals' },
  { id: 'browser', label: 'Browser', tip: 'Focus time by site, from the Bridge extension' },
  { id: 'vault', label: 'Vault', tip: 'Keyword search of your VEEMO CORTEX notes (read-only)' },
];
export const DEFAULT_INCLUDE = { scan: true, tasks: true, projects: true, health: false, browser: false, vault: false };
// v3's starter prompts (shown while the chat is empty)
export const PROMPTS = [
  'What should I actually work on today?',
  'What\'s the biggest risk in my projects right now?',
  'Which project has gone quiet, and does it matter?',
  'Explain my health score.',
];

// the local calendar day, as v3 writes it
export const today = (d = new Date()) => d.toLocaleDateString('en-CA');

// v3's job id: `or-<time36>-<rand>`; main accepts /^[a-z0-9-]{4,40}$/i
export const jobId = () => 'or-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

function read(storage, key) { try { return JSON.parse((storage && storage.getItem(key)) || 'null'); } catch { return null; } }
function write(storage, key, value) { try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

// ---- sources -------------------------------------------------------------------
export function normInclude(o) {
  const s = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const out = {};
  for (const src of SOURCES) out[src.id] = typeof s[src.id] === 'boolean' ? s[src.id] : DEFAULT_INCLUDE[src.id];
  return out;
}
export const loadInclude = (storage) => normInclude(read(storage, LS_INCLUDE));
export function saveInclude(storage, include) { const out = normInclude(include); write(storage, LS_INCLUDE, out); return out; }

// ---- chat ----------------------------------------------------------------------
const validMsg = (m) => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';

function answerFromV3(m) {
  let meta = m.meta;
  // a message still pending was cut off by a reload (main reloads after scans and commits)
  if (meta && typeof meta === 'object' && meta.pending) meta = { status: 'error', reason: INTERRUPTED };
  const st = meta && typeof meta === 'object' ? meta.status : undefined;
  return { text: m.content, status: STATUSES.includes(st) ? st : 'error', meta, est: !!m.content };
}

// v3 messages → v5 entries. Questions pair with the answer that follows them; an
// answer with no question before it is dropped; a question with no answer stays
// (`orphan`, written back as a lone question).
export function fromV3(messages) {
  const ms = (Array.isArray(messages) ? messages : []).filter(validMsg);
  const out = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.role !== 'user') continue;
    const next = ms[i + 1], id = 'h' + out.length;
    if (next && next.role === 'assistant') { out.push({ id, q: m.content, a: answerFromV3(next) }); i++; }
    else out.push({ id, q: m.content, a: { text: '', status: 'error', meta: undefined, est: false, orphan: true } });
  }
  return out;
}

// v5 entries → v3 messages (local refusals are left out; ids are not stored)
export function toV3(entries) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.q !== 'string' || e.local) continue;
    const a = e.a || {};
    out.push({ role: 'user', content: e.q });
    if (a.orphan) continue;
    const msg = { role: 'assistant', content: typeof a.text === 'string' ? a.text : '' };
    const meta = a.status === 'thinking' ? { pending: true } : a.meta;
    if (meta !== undefined && meta !== null) msg.meta = meta;
    out.push(msg);
  }
  return out;
}

// today's chat; another day's (or a broken) record starts an empty chat
export function load(storage, day = today()) {
  const s = read(storage, LS_CHAT);
  if (!s || typeof s !== 'object' || s.day !== day || !Array.isArray(s.messages)) return [];
  return fromV3(s.messages);
}
export function save(storage, entries, day = today()) {
  return write(storage, LS_CHAT, { day, messages: toV3(entries).slice(-KEEP) });
}

// What goes back to the model: only complete question → answer pairs whose answer
// finished (v3's rule). A stopped, failed or interrupted pair is left out, or the
// model sees two questions in a row and answers the abandoned one again.
export function modelHistory(entries, q) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const a = e && e.a;
    if (!a || e.local || a.refusal || !a.meta || a.meta.status !== 'done' || !a.text) continue;
    out.push({ role: 'user', content: e.q }, { role: 'assistant', content: a.text });
  }
  out.push({ role: 'user', content: q });
  return out;
}

// v3's meta line (view.js:111-125), parts joined by " · ": the outcome when it
// isn't done, what the answer was grounded in (trimmed sections marked), section
// notes, and the time in seconds. "no sources ticked" only when main reported its
// sections (an error before the context was built says nothing about sources).
export function metaLine(meta) {
  if (!meta || typeof meta !== 'object' || meta.pending) return '';
  const secs = Array.isArray(meta.sections) ? meta.sections.filter((s) => s && typeof s === 'object') : null;
  const used = (secs || []).filter((s) => s.chars > 0).map((s) => s.label + (s.clipped ? ' (trimmed)' : ''));
  const notes = (secs || []).filter((s) => s.note).map((s) => s.label + ': ' + s.note);
  const parts = [];
  if (meta.status === 'cancelled') parts.push('stopped');
  else if (meta.status === 'unavailable') parts.push('model offline — ' + (meta.reason || 'no runtime'));
  else if (meta.status === 'error') parts.push('error — ' + (meta.reason || 'unknown'));
  if (meta.status !== 'unavailable' && secs) parts.push(used.length ? 'grounded in ' + used.join(' · ') : 'no sources ticked');
  if (notes.length) parts.push(notes.join('; '));
  if (Number.isFinite(meta.ms)) parts.push((meta.ms / 1000).toFixed(1) + 's');
  return parts.join(' · ');
}
