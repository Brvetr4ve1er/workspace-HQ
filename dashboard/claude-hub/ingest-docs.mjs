// Local Claude context + vault prompt notes → `document` rows (spec 2026-10-15 §5.2). Read-only on every source: ~/.claude
// (HQ_CLAUDE_HOME), project CLAUDE.md files, <vault>/40_Resources/Prompts (HQ_VAULT_DIR). Text and titles are masked on
// the whole string before any cut. Symlinked files are not followed (Dirent.isFile() is false for them).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { historyLineKey } from './store.mjs';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX } from './parse-code.mjs';

export const PROMPTS_REL = path.join('40_Resources', 'Prompts');
export const NOTE_MAX_BYTES = 2 * 1024 * 1024;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(s)).text;
const MASKED = /•••/;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const docId = (source, file) => source + ':' + sha1(path.resolve(file).toLowerCase());
// Only ENOENT/ENOTDIR mean "root not there". Any other error (EACCES, EPERM, EBUSY, a locked/unmounted vault) is recorded in
// `bad` so syncNotes skips the removal sweep for that source instead of treating the root as empty and deleting its rows.
const missing = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
const mdFiles = (dir, source, bad) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => path.join(dir, d.name)); } catch (e) { if (!missing(e)) bad.push({ source, path: dir, code: (e && e.code) || 'ERR' }); return []; } };
const isFile = (f, source, bad) => { try { return fs.lstatSync(f).isFile(); } catch (e) { if (!missing(e)) bad.push({ source, path: f, code: (e && e.code) || 'ERR' }); return false; } };

function scalar(v) {
  const t = v.trim();
  if (/^".*"$/.test(t)) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null' || t === '~' || t === '') return null;
  return t;
}
// split on commas outside quotes
const items = (s) => { const out = []; let cur = '', q = null; for (const ch of s) { if (q) { if (ch === q) q = null; cur += ch; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim() !== '') out.push(cur); return out; };
function value(v) {
  const t = v.trim();
  if (t.startsWith('[') && t.endsWith(']')) return items(t.slice(1, -1)).map(scalar).filter((x) => x !== null);
  if (t.startsWith('{') && t.endsWith('}')) {
    const o = {};
    for (const it of items(t.slice(1, -1))) { const i = it.indexOf(':'); if (i > 0) o[it.slice(0, i).trim()] = scalar(it.slice(i + 1)); }
    return o;
  }
  return scalar(t);
}
export function parseFrontmatter(src) {
  const s = String(src);
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  if (!m) return { data: {}, body: s, has: false };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);   // top-level keys only; indented/continuation lines are ignored
    if (k) data[k[1]] = value(k[2]);
  }
  return { data, body: s.slice(m[0].length), has: true };
}
const maskDeep = (v) => (typeof v === 'string' ? cutText(safe(v), 2000) : Array.isArray(v) ? v.map(maskDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) : v);

export function listNoteFiles(store, { home, vaultDir }) {
  const out = [], seen = new Set(), bad = [];
  Object.defineProperty(out, 'unreadable', { value: bad });   // non-enumerable: [{source, path, code}]
  const add = (o) => { const k = path.resolve(o.file).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(o); } };
  const code = new Map(store.listProjects({ source: 'code' }).map((p) => [p.id, p.path]));
  const projPath = (id, folder) => { const p = code.get(id); return p && path.isAbsolute(p) && !MASKED.test(p) ? p : folder; };
  if (home) {
    const root = path.join(home, 'projects');
    let folders = []; try { folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { if (!missing(e)) bad.push({ source: 'memory', path: root, code: (e && e.code) || 'ERR' }); }
    for (const folder of folders) for (const file of mdFiles(path.join(root, folder, 'memory'), 'memory', bad)) add({ source: 'memory', file, projectId: 'code:' + folder, projectPath: projPath('code:' + folder, folder) });
    const g = path.join(home, 'CLAUDE.md');
    if (isFile(g, 'claude-md', bad)) add({ source: 'claude-md', file: g, projectId: null, projectPath: null });
  }
  for (const [id, p] of code) {   // only the project folders the Hub knows; never any other repo file
    if (!p || !path.isAbsolute(p) || MASKED.test(p)) continue;
    const f = path.join(p, 'CLAUDE.md');
    if (isFile(f, 'claude-md', bad)) add({ source: 'claude-md', file: f, projectId: id, projectPath: p });
  }
  if (vaultDir) for (const file of mdFiles(path.join(vaultDir, PROMPTS_REL), 'prompt', bad)) add({ source: 'prompt', file, projectId: null, projectPath: null });
  return out;
}

function shape(f, raw) {
  const base = path.basename(f.file).replace(/\.md$/i, '');
  if (f.source === 'claude-md') return { title: 'CLAUDE.md — ' + (f.projectPath ? path.win32.basename(f.projectPath) : '~/.claude'), text: raw, meta: null };
  const fm = parseFrontmatter(raw);
  const heading = (/^#\s+(.+)$/m.exec(fm.body) || [])[1];
  if (f.source === 'memory') {
    const meta = fm.has ? maskDeep({ name: fm.data.name ?? null, description: fm.data.description ?? null, type: fm.data.type ?? null }) : null;
    return { title: (typeof fm.data.name === 'string' && fm.data.name) || heading || base, text: fm.body, meta };
  }
  return { title: (typeof fm.data.title === 'string' && fm.data.title) || heading || base, text: fm.body, meta: maskDeep(fm.data) };   // prompt
}

export async function syncNotes(store, { home, vaultDir }) {
  const changed = [], removed = [];
  let skipped = 0;
  const files = listNoteFiles(store, { home, vaultDir });
  const live = new Set();
  const unreadable = files.unreadable.slice(), blocked = new Set(unreadable.map((u) => u.source));
  for (const f of files) {
    const id = docId(f.source, f.file);
    live.add(id);
    let st; try { st = await fs.promises.stat(f.file); } catch { continue; }
    if (st.size > NOTE_MAX_BYTES) { skipped++; continue; }
    const prev = store.documentStamps(f.source).get(id);
    if (prev && prev.size === st.size && Math.floor(prev.mtime_ms) === Math.floor(st.mtimeMs)) continue;
    if (store.isTombstoned('document', id)) continue;
    let raw; try { raw = await fs.promises.readFile(f.file, 'utf8'); } catch { continue; }
    const s = shape(f, raw);
    const res = store.upsertDocument({ id, source: f.source, path: f.file, title: cutText(safe(s.title).trim(), 200) || null,
      text: cutText(safe(s.text), TEXT_MAX), projectId: f.projectId, projectPath: f.projectPath, mtimeMs: Math.floor(st.mtimeMs), size: st.size, meta: s.meta });
    if (res === 'added' || res === 'updated') changed.push(id);
  }
  for (const source of ['memory', 'claude-md', 'prompt']) {
    if (blocked.has(source)) continue;   // a root we could not read is not an empty root: keep its rows
    for (const [id, stamp] of store.documentStamps(source)) {
      if (stamp.path && !live.has(id) && store.removeDocument(id)) removed.push(id);   // path-less rows (ChatGPT memory) are not files
    }
  }
  return { changed, removed, skipped, unreadable };
}

export const HISTORY_CURSOR = 'history.jsonl';
const HEAD_BYTES = 256;
const SID_RE = /^[A-Za-z0-9-]{1,80}$/;
async function headOf(file, size) {
  const len = Math.min(HEAD_BYTES, size);
  const fh = await fs.promises.open(file, 'r');
  try { const b = Buffer.alloc(len); await fh.read(b, 0, len, 0); return len + ':' + sha1(b); } finally { await fh.close(); }
}

// Byte-cursor ingest of ~/.claude/history.jsonl (spec §5.2). Read-only: the file is opened 'r' and never written.
export async function ingestHistory(store, home, { chunkSize = 1 << 20, maxLine = 8 << 20 } = {}) {
  const file = path.join(home, 'history.jsonl');
  let st;
  try { st = await fs.promises.stat(file); } catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) st = null; else throw e; }   // only 'no file' is missing; EPERM/EBUSY/EACCES surface
  if (!st || !st.isFile()) return { added: 0, bad: 0, reset: false, ids: [], missing: true };
  let cur = store.getCursor(HISTORY_CURSOR), reset = false;
  if (cur) {
    const prevLen = cur.head ? Number(String(cur.head).split(':')[0]) || 0 : 0;
    const headNow = prevLen && st.size >= prevLen ? await headOf(file, prevLen) : null;
    if (st.size < cur.offset || (cur.head && headNow !== cur.head)) {
      store.tx(() => { store.removeDocuments({ source: 'history', idPrefix: 'history:' }); store.deleteCursor(HISTORY_CURSOR);
        store.dropTombstones('document', 'history:');   // offset ids are stale now; forgotten lines stay hidden by their content key
      });
      cur = null; reset = true;
    }
  }
  const start = cur ? cur.offset : 0;
  if (start >= st.size) return { added: 0, bad: 0, reset, ids: [] };
  const head = await headOf(file, st.size);
  const ids = [];
  let added = 0, bad = 0, offset = start, pending = Buffer.alloc(0), pendingAt = start, skipping = false;
  const handle = (buf, at) => {
    let o; try { o = JSON.parse(buf.toString('utf8')); } catch { bad++; return; }
    const display = o && typeof o.display === 'string' ? o.display : '';
    if (!display.trim()) { bad++; return; }
    const sessionId = typeof o.sessionId === 'string' && SID_RE.test(o.sessionId) ? o.sessionId : 'nosession';
    const project = typeof o.project === 'string' ? cutText(safe(o.project), 500) : null;
    const at2 = typeof o.timestamp === 'number' && Number.isFinite(o.timestamp) ? new Date(o.timestamp).toISOString() : null;
    const pasted = !!(o.pastedContents && typeof o.pastedContents === 'object' && Object.keys(o.pastedContents).length);
    const id = 'history:' + sessionId + ':' + at;
    const text = cutText(safe(display), TEXT_MAX);
    if (store.isTombstoned('history-line', historyLineKey(sessionId, at2, text))) return;   // forgotten line, wherever it now sits
    const res = store.upsertDocument({ id, source: 'history', path: null, title: null, text,
      projectId: null, projectPath: project, mtimeMs: null, size: buf.length, meta: { sessionId, project, pasted, at: at2 } });
    if (res === 'added' || res === 'updated') { added++; ids.push(id); }
  };
  const fh = await fs.promises.open(file, 'r');
  try {
    let pos = start;
    while (pos < st.size) {
      const len = Math.min(chunkSize, st.size - pos), chunk = Buffer.alloc(len);
      const { bytesRead } = await fh.read(chunk, 0, len, pos);
      if (!bytesRead) break;
      let from = 0;
      store.tx(() => {
        for (let i = 0; i < bytesRead; i++) {
          if (chunk[i] !== 0x0a) continue;
          const piece = chunk.subarray(from, i), lineAt = pendingAt;
          const line = pending.length ? Buffer.concat([pending, piece]) : piece;
          const body = line.length && line[line.length - 1] === 0x0d ? line.subarray(0, line.length - 1) : line;   // CRLF-safe
          if (!skipping && body.length) handle(body, lineAt);
          pending = Buffer.alloc(0); skipping = false;
          from = i + 1; pendingAt = pos + from; offset = pos + from;
        }
        store.setCursor({ file: HISTORY_CURSOR, size: st.size, mtimeMs: st.mtimeMs, offset, head, sessionId: null });
      });
      const rest = chunk.subarray(from, bytesRead);
      if (!skipping) { pending = Buffer.concat([pending, rest]); if (pending.length > maxLine) { pending = Buffer.alloc(0); skipping = true; bad++; } }
      pos += bytesRead;
    }
  } finally { await fh.close(); }
  return { added, bad, reset, ids };   // a trailing half line stays unread: the cursor sits at its start
}

export async function syncDocs(store, { home, vaultDir }) {
  const n = await syncNotes(store, { home, vaultDir });
  const h = home ? await ingestHistory(store, home) : { ids: [] };
  return { changed: [...n.changed, ...h.ids], removed: n.removed, unreadable: n.unreadable, skipped: n.skipped,
    history: { added: h.added || 0, bad: h.bad || 0, reset: !!h.reset, missing: !!h.missing } };
}

export function watchDocs({ home, vaultDir }, onChange, { debounceMs = 1000 } = {}) {
  const ws = [];
  let timer = null, closed = false;
  const kick = () => { if (closed) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; if (!closed) onChange(); }, debounceMs); };
  const watch = (dir, opts, ok) => {
    try {
      const w = fs.watch(dir, opts, (_e, name) => { if (name && ok(String(name))) kick(); });
      w.on('error', () => { try { w.close(); } catch { /* closed */ } });   // a dead watch falls back to the Hub's sweep
      ws.push(w);
    } catch { /* missing folder: the sweep covers it */ }
  };
  if (home) {
    watch(home, {}, (n) => n === 'history.jsonl' || n === 'CLAUDE.md');
    watch(path.join(home, 'projects'), { recursive: true }, (n) => /^[^\\/]+[\\/]memory[\\/][^\\/]+\.md$/i.test(n));
  }
  if (vaultDir) watch(path.join(vaultDir, PROMPTS_REL), {}, (n) => /\.md$/i.test(n));
  return { close() { closed = true; clearTimeout(timer); for (const w of ws) { try { w.close(); } catch { /* closed */ } } } };
}
