// Local Claude context + vault prompt notes → `document` rows (spec 2026-10-15 §5.2). Read-only on every source: ~/.claude
// (HQ_CLAUDE_HOME), project CLAUDE.md files, <vault>/40_Resources/Prompts (HQ_VAULT_DIR). Text and titles are masked on
// the whole string before any cut. Symlinked files are not followed (Dirent.isFile() is false for them).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX } from './parse-code.mjs';

export const PROMPTS_REL = path.join('40_Resources', 'Prompts');
export const NOTE_MAX_BYTES = 2 * 1024 * 1024;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(s)).text;
const MASKED = /•••/;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const docId = (source, file) => source + ':' + sha1(path.resolve(file).toLowerCase());
const mdFiles = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => path.join(dir, d.name)); } catch { return []; } };
const isFile = (f) => { try { return fs.lstatSync(f).isFile(); } catch { return false; } };

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
  const out = [], seen = new Set();
  const add = (o) => { const k = path.resolve(o.file).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(o); } };
  const code = new Map(store.listProjects({ source: 'code' }).map((p) => [p.id, p.path]));
  const projPath = (id, folder) => { const p = code.get(id); return p && path.isAbsolute(p) && !MASKED.test(p) ? p : folder; };
  if (home) {
    const root = path.join(home, 'projects');
    let folders = []; try { folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* no projects yet */ }
    for (const folder of folders) for (const file of mdFiles(path.join(root, folder, 'memory'))) add({ source: 'memory', file, projectId: 'code:' + folder, projectPath: projPath('code:' + folder, folder) });
    const g = path.join(home, 'CLAUDE.md');
    if (isFile(g)) add({ source: 'claude-md', file: g, projectId: null, projectPath: null });
  }
  for (const [id, p] of code) {   // only the project folders the Hub knows; never any other repo file
    if (!p || !path.isAbsolute(p) || MASKED.test(p)) continue;
    const f = path.join(p, 'CLAUDE.md');
    if (isFile(f)) add({ source: 'claude-md', file: f, projectId: id, projectPath: p });
  }
  if (vaultDir) for (const file of mdFiles(path.join(vaultDir, PROMPTS_REL))) add({ source: 'prompt', file, projectId: null, projectPath: null });
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
    for (const [id, stamp] of store.documentStamps(source)) {
      if (stamp.path && !live.has(id) && store.removeDocument(id)) removed.push(id);   // path-less rows (ChatGPT memory) are not files
    }
  }
  return { changed, removed, skipped };
}
