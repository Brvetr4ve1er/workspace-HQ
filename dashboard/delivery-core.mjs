// Client delivery engine. PURE: no clock, no network, no LLM, no direct fs — file access goes through an injected `io`
// (nodeIo(fs) builds one), so the same inputs and `now` always give the same view. Used by dashboard/delivery.js (main)
// and mcp/workspacehq/delivery-read.mjs (works with the app closed).
//
// What the owner sees on a project page: what is left against the agreed scope (an owner-picked checklist file, or a
// checklist kept in data/delivery.json), the newest link to send, and an update to paste. Nothing is invented: with no
// scope the view says so. WorkspaceHQ never writes the checklist files it reads.
//
//   parseChecklist(text)                      → { milestones:[{name, done, total, items:[{text, done, hash}]}], done, total, tooBig }
//   repoKey(remote) / matchVercelProjects(remote, vercel) / pickLink(accounts, matched) / linkFor(remote, accounts)
//   containScope(root, rel, io) / readScope(root, rel, io) / walkCandidates({root, io})
//   gatherScope({root, entry, io, withCandidates}) → what the project's scope source says right now
//   buildView({projectId, name, entry, scope, accounts, remote, now, tzOffsetMin}) → { view, doneHashes }
//   applyIntent(state, intent, ctx) → new state | throws DeliveryError;  sanitizeState(raw) → { v:1, projects }
//   listProjects(latest) → [{ id, name, path, remote }]
import path from 'node:path';

export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_ITEMS = 200, MAX_TEXT = 200, MAX_MILESTONE = 80, MAX_INTENT_BYTES = 16 * 1024;
export const MAX_REL = 260, MAX_DONE_HASHES = 500;
export const WALK = { depth: 3, files: 500, entries: 5000, listed: 50, skip: ['node_modules', 'dist', 'build'] };
export const INTENTS = ['mark-client', 'set-scope-file', 'item-add', 'item-toggle', 'item-remove', 'copied'];
export const FILE_STATES = ['ok', 'missing', 'outside', 'too-big', 'unreadable'];

export class DeliveryError extends Error {}

const H = 3600e3, D = 24 * H;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
// one line, no control characters, at most n code points — owner files and typed text both reach the copy
const oneLine = (s, n) => [...String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, n).join('').trim();
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

// ---------- hashing (stable ids for "done since the last update") ----------
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
// the same text twice in one list gets a .1, .2 … suffix, so duplicates don't merge
function hasher() {
  const seen = new Map();
  return (text) => { const k = norm(text), n = seen.get(k) || 0; seen.set(k, n + 1); return fnv1a(k) + (n ? '.' + n : ''); };
}

// ---------- the checklist parser ----------
const ITEM = /^\s*[-*]\s+\[([ xX])\]\s+(.*?)\s*$/;
const HEAD = /^##\s+(.*?)\s*#*\s*$/;
export function parseChecklist(text, { maxBytes = MAX_FILE_BYTES } = {}) {
  const out = { milestones: [], done: 0, total: 0, tooBig: false };
  if (typeof text !== 'string') return out;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) { out.tooBig = true; return out; }
  const hash = hasher();
  let cur = { name: '', done: 0, total: 0, items: [] }, fence = false;
  const flush = () => { if (cur.total > 0) out.milestones.push(cur); };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = HEAD.exec(line);
    if (h) { flush(); cur = { name: oneLine(h[1], MAX_MILESTONE), done: 0, total: 0, items: [] }; continue; }
    const m = ITEM.exec(line);
    if (!m) continue;
    const t = oneLine(m[2], MAX_TEXT);
    if (!t) continue;
    const done = m[1] !== ' ';
    cur.items.push({ text: t, done, hash: hash(t) });
    cur.total++; out.total++;
    if (done) { cur.done++; out.done++; }
  }
  flush();
  return out;
}

// ---------- remote ↔ Vercel project ----------
// 'https://github.com/A/B.git' | 'git@github.com:A/B.git' | 'github.com/A/B' | 'A/B' → 'a/b' (or null)
export function repoKey(remote) {
  if (typeof remote !== 'string') return null;
  let s = remote.trim();
  if (!s || s.length > 300) return null;
  const ssh = /^git@([^:]+):(.+)$/.exec(s);
  if (ssh) s = ssh[1] + '/' + ssh[2];
  s = s.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, '').replace(/^www\./i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  s = s.replace(/^github\.com\//i, '');
  const parts = s.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /[\s:]/.test(s)) return null;
  return s.toLowerCase();
}
export function matchVercelProjects(remote, vercel) {
  const key = repoKey(remote);
  if (!key || !isObj(vercel)) return [];
  return arr(vercel.projects).filter((p) => isObj(p) && repoKey(p.repo) === key);
}

// ---------- the newest link to send ----------
const goodUrl = (u) => { try { return typeof u === 'string' && u.length <= 2048 && new URL(u).protocol === 'https:'; } catch { return false; } };
const newestFirst = (a, b) => (msOf(b.at) ?? -Infinity) - (msOf(a.at) ?? -Infinity);
const asLink = (kind, d) => ({ kind, url: d.url, state: typeof d.state === 'string' && d.state ? d.state : 'unknown', at: msOf(d.at) === null ? null : d.at, project: d.project || null, branch: typeof d.branch === 'string' ? d.branch : null });
// deploys[] sits in accounts.json under vercel (older notes say top-level) and carries a `project` per row, so it is
// filtered to the matched project(s) BEFORE the pick: another project's deploy is never offered.
export function pickLink(accounts, matched) {
  const names = new Set(arr(matched).map((p) => p && p.name).filter(Boolean));
  if (!names.size) return null;
  const rows = arr(isObj(accounts) && isObj(accounts.vercel) && Array.isArray(accounts.vercel.deploys) ? accounts.vercel.deploys : isObj(accounts) ? accounts.deploys : [])
    .filter((d) => isObj(d) && names.has(d.project) && goodUrl(d.url)).sort(newestFirst);
  const prev = rows.find((d) => d.target === 'preview');
  if (prev) return asLink('preview', prev);
  const own = (key) => arr(matched).map((p) => p && p[key]).filter((d) => isObj(d) && goodUrl(d.url)).sort(newestFirst);
  const latestPrev = own('latest').find((d) => d.target === 'preview');
  if (latestPrev) return asLink('preview', latestPrev);
  const prod = rows.find((d) => d.target === 'production') || own('prod')[0];
  return prod ? asLink('production', prod) : null;
}
// → { link, linkWhy }: exactly one is set
export function linkFor(remote, accounts) {
  if (!isObj(accounts) || !isObj(accounts.vercel) || !Array.isArray(accounts.vercel.projects)) return { link: null, linkWhy: 'No Vercel snapshot yet — refresh Projects › Accounts' };
  if (!repoKey(remote)) return { link: null, linkWhy: 'No GitHub remote on this project, so no Vercel project can be matched' };
  const matched = matchVercelProjects(remote, accounts.vercel);
  if (!matched.length) return { link: null, linkWhy: 'No Vercel project linked to this repo' };
  const link = pickLink(accounts, matched);
  return link ? { link, linkWhy: null } : { link: null, linkWhy: 'Vercel project ' + oneLine(matched[0].name, 60) + ' has no deploys in the snapshot' };
}

// ---------- reading files inside the project root only ----------
// io = { realpath(p), stat(p) → {isFile, size}, readdir(p) → [{name, isDir, isFile, isLink}], readText(p, maxBytes) → string }
export function nodeIo(fs) {
  return {
    realpath: (p) => fs.realpathSync(p),
    stat: (p) => { const s = fs.statSync(p); return { isFile: s.isFile(), size: s.size }; },
    readdir: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile(), isLink: e.isSymbolicLink() })),
    // never more than maxBytes + 1 bytes, even if the file grows after the size check
    readText: (p, maxBytes) => {
      const fd = fs.openSync(p, 'r');
      try { const buf = Buffer.alloc(maxBytes + 1); const n = fs.readSync(fd, buf, 0, buf.length, 0); return buf.subarray(0, n).toString('utf8'); }
      finally { fs.closeSync(fd); }
    },
  };
}
const inside = (root, p) => { const r = path.relative(root, p); return !!r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
const errState = (e) => (e && e.code === 'ENOENT' ? 'missing' : 'unreadable');

// a clean relative path ('docs/plan.md') or null: no absolute paths, no '..', must be .md
export function cleanRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > MAX_REL || rel.includes('\0')) return null;
  const s = rel.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  const segs = s.split('/').filter((x) => x && x !== '.');
  if (!segs.length || segs.some((x) => x === '..')) return null;
  if (!/\.md$/i.test(segs[segs.length - 1])) return null;
  return segs.join('/');
}
// → { ok:true, real, size } | { ok:false, state, detail }
export function containScope(root, rel, io) {
  if (typeof root !== 'string' || !root) return { ok: false, state: 'outside', detail: 'this project’s folder is not one the app may read' };
  const clean = cleanRel(rel);
  if (!clean) return { ok: false, state: 'outside', detail: 'not a .md file inside the project folder' };
  let realRoot;
  try { realRoot = io.realpath(root); } catch (e) { return { ok: false, state: 'missing', detail: 'the project folder was not found' }; }
  let real;
  try { real = io.realpath(path.join(realRoot, ...clean.split('/'))); }
  catch (e) { const s = errState(e); return { ok: false, state: s, detail: s === 'missing' ? clean + ' was not found' : clean + ' could not be read' }; }
  if (!inside(realRoot, real)) return { ok: false, state: 'outside', detail: clean + ' resolves outside the project folder' };
  let st;
  try { st = io.stat(real); } catch (e) { return { ok: false, state: errState(e), detail: clean + ' could not be read' }; }
  if (!st.isFile) return { ok: false, state: 'unreadable', detail: clean + ' is not a file' };
  if (st.size > MAX_FILE_BYTES) return { ok: false, state: 'too-big', detail: clean + ' is over 64 KB' };
  return { ok: true, real, size: st.size };
}
// → { state:'ok', text } | { state, detail }
export function readScope(root, rel, io) {
  const c = containScope(root, rel, io);
  if (!c.ok) return { state: c.state, detail: c.detail };
  try { return { state: 'ok', text: io.readText(c.real, MAX_FILE_BYTES) }; }
  catch (e) { return { state: errState(e), detail: 'could not read ' + rel }; }
}

// a bounded look for checklist files: ≤ 3 folders deep, no node_modules / dot folders / dist / build, no links, ≤ 500
// files opened, each ≤ 64 KB; only files with at least one '- [ ]' / '- [x]' line are listed
export function walkCandidates({ root, io, limits = WALK }) {
  const out = { candidates: [], truncated: false, error: null };
  let realRoot;
  try { realRoot = io.realpath(root); } catch { out.error = 'the project folder was not found'; return out; }
  const stack = [{ abs: realRoot, rel: '', depth: 0 }];
  let looked = 0, seen = 0;
  while (stack.length) {
    const { abs, rel, depth } = stack.pop();
    let ents;
    try { ents = io.readdir(abs); } catch { continue; }
    ents = ents.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const dirs = [];
    for (const e of ents) {
      if (++seen > limits.entries) { out.truncated = true; stack.length = 0; break; }
      if (e.isLink) continue;
      if (e.isDir) {
        if (depth < limits.depth && !e.name.startsWith('.') && !limits.skip.includes(e.name.toLowerCase())) dirs.push(e.name);
        continue;
      }
      if (!e.isFile || !/\.md$/i.test(e.name)) continue;
      if (looked >= limits.files) { out.truncated = true; stack.length = 0; break; }
      looked++;
      const full = path.join(abs, e.name);
      try {
        const real = io.realpath(full);
        if (!inside(realRoot, real)) continue;
        const st = io.stat(real);
        if (!st.isFile || st.size > MAX_FILE_BYTES) continue;
        const p = parseChecklist(io.readText(real, MAX_FILE_BYTES));
        if (p.total > 0) out.candidates.push({ rel: rel ? rel + '/' + e.name : e.name, items: p.total, done: p.done });
      } catch { /* an unreadable file is simply not a candidate */ }
    }
    // pushed in reverse so the walk pops them in name order
    for (let i = dirs.length - 1; i >= 0; i--) {
      const abs2 = path.join(abs, dirs[i]);
      try { if (!inside(realRoot, io.realpath(abs2))) continue; } catch { continue; }   // a junction that escapes is not walked
      stack.push({ abs: abs2, rel: rel ? rel + '/' + dirs[i] : dirs[i], depth: depth + 1 });
    }
  }
  const rank = (c) => (c.rel.toLowerCase() === 'scope.md' ? 0 : 1);
  out.candidates.sort((a, b) => rank(a) - rank(b) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  if (out.candidates.length > limits.listed) { out.candidates.length = limits.listed; out.truncated = true; }
  return out;
}

// ---------- state ----------
export function emptyState() { return { v: 1, projects: {} }; }
const cleanItem = (it) => {
  if (!isObj(it) || typeof it.id !== 'string' || !it.id || it.id.length > 80) return null;
  const text = oneLine(it.text, MAX_TEXT);
  if (!text) return null;
  const done = it.done === true;
  return { id: it.id, text, milestone: oneLine(it.milestone, MAX_MILESTONE), done, doneAt: done && msOf(it.doneAt) !== null ? it.doneAt : null };
};
export function sanitizeState(raw) {
  const st = emptyState();
  if (!isObj(raw) || !isObj(raw.projects)) return st;
  for (const [id, e] of Object.entries(raw.projects)) {
    if (!id || id.length > 200 || !isObj(e)) continue;
    const seen = new Set(), items = [];
    for (const it of arr(e.items)) { const c = cleanItem(it); if (c && !seen.has(c.id) && items.length < MAX_ITEMS) { seen.add(c.id); items.push(c); } }
    const lc = isObj(e.lastCopy) && msOf(e.lastCopy.at) !== null
      ? { at: e.lastCopy.at, doneHashes: arr(e.lastCopy.doneHashes).filter((h) => typeof h === 'string' && h.length <= 20).slice(0, MAX_DONE_HASHES) } : null;
    st.projects[id] = { client: e.client === true, scopeFile: cleanRel(e.scopeFile), items, lastCopy: lc };
  }
  return st;
}

// ---------- which source a project reads ----------
// explicit file pick > the checklist kept in the app > SCOPE.md at the repo root (client jobs only). `fileState` and
// `fileDetail` say exactly what is wrong with a file source; `parsed` is set only when the file read fine.
export function gatherScope({ root, entry, io, withCandidates = true }) {
  const client = !!(entry && entry.client);
  const out = { source: 'none', scopeFile: null, fileState: null, fileDetail: null, parsed: null, candidates: [], walkTruncated: false, walkError: null };
  if (withCandidates && root) {
    try { const w = walkCandidates({ root, io }); out.candidates = w.candidates; out.walkTruncated = w.truncated; out.walkError = w.error; }
    catch (e) { out.walkError = 'could not look for checklist files'; }
  }
  const picked = entry && entry.scopeFile;
  if (picked) { out.source = 'file'; out.scopeFile = picked; }
  else if (client && entry.items.length) out.source = 'app';
  else if (client && root) {
    const c = containScope(root, 'SCOPE.md', io);
    if (c.ok || c.state !== 'missing') { out.source = 'file'; out.scopeFile = 'SCOPE.md'; }
  }
  if (out.source === 'file') {
    const r = readScope(root, out.scopeFile, io);
    out.fileState = r.state; out.fileDetail = r.detail || null;
    if (r.state === 'ok') {
      out.parsed = parseChecklist(r.text);
      if (out.parsed.tooBig) { out.fileState = 'too-big'; out.fileDetail = out.scopeFile + ' is over 64 KB'; out.parsed = null; }
    }
  }
  return out;
}

// ---------- the view ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayText(t, tzOffsetMin = 0) {
  const ms = typeof t === 'number' ? t : msOf(t);
  if (ms === null) return 'an earlier date';
  const d = new Date(ms + tzOffsetMin * 60e3);
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
}
export function agoText(t, now) {
  const ms = msOf(t); if (ms === null) return 'age unknown';
  const d = Math.max(0, now - ms);
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < D ? Math.round(d / H) + ' h ago' : Math.floor(d / D) + ' d ago';
}
const list = (xs, n = 8) => xs.slice(0, n).join('; ') + (xs.length > n ? ' and ' + (xs.length - n) + ' more' : '');

function sourceMilestones(scope, entry) {
  if (scope.source === 'file') return scope.parsed ? scope.parsed.milestones : [];
  if (scope.source !== 'app') return [];
  const hash = hasher(), order = [], by = new Map();
  for (const it of entry.items) {
    const name = it.milestone || '';
    if (!by.has(name)) { by.set(name, { name, done: 0, total: 0, items: [] }); order.push(name); }
    const m = by.get(name);
    m.items.push({ id: it.id, text: it.text, done: it.done, hash: hash(it.text) });
    m.total++; if (it.done) m.done++;
  }
  return order.map((n) => by.get(n));
}

export function buildView({ projectId, name, entry, scope, accounts, remote, now, tzOffsetMin = 0 }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const client = !!(entry && entry.client);
  const mode = client ? 'client' : scope.source === 'file' ? 'plan' : 'none';
  const ms = sourceMilestones(scope, entry || { items: [] });
  const done = ms.reduce((a, m) => a + m.done, 0), total = ms.reduce((a, m) => a + m.total, 0);
  const lc = entry && entry.lastCopy ? entry.lastCopy : null;
  const seenHashes = new Set(lc ? lc.doneHashes : []);
  const doneItems = ms.flatMap((m) => m.items.filter((i) => i.done));
  const doneSince = doneItems.filter((i) => !seenHashes.has(i.hash)).map((i) => i.text);
  const doneHashes = doneItems.map((i) => i.hash).slice(0, MAX_DONE_HASHES);
  const { link, linkWhy } = linkFor(remote, accounts);
  const isScopeMd = scope.scopeFile && scope.scopeFile.toLowerCase() === 'scope.md';
  const sourceLabel = scope.source === 'file' ? scope.scopeFile : scope.source === 'app' ? 'a checklist kept in WorkspaceHQ' : '';
  const sourceNote = scope.source === 'file' && !isScopeMd ? 'a plan checklist, not the quote' : '';

  let update = '';
  if (client && total > 0) {
    const left = [], pName = oneLine(name, 60) || projectId;
    for (const m of ms) for (const i of m.items) if (!i.done) left.push(i.text);
    const parts = [pName + ' — update ' + dayText(nowMs, tzOffsetMin)];
    if (doneSince.length) parts.push((lc ? 'Done since ' + dayText(lc.at, tzOffsetMin) : 'Done so far') + ': ' + list(doneSince));
    parts.push(left.length ? 'Still to do (' + left.length + ' of ' + total + '): ' + list(left) : 'Everything in the agreed scope is done');
    if (link) parts.push((link.kind === 'preview' ? 'Preview' : 'Live') + ': ' + link.url + ' (' + link.state + ', ' + agoText(link.at, nowMs) + ')');
    update = parts.join(' · ');
  }

  const view = {
    projectId, client, mode, source: scope.source, scopeFile: scope.scopeFile, sourceLabel, sourceNote,
    fileState: scope.source === 'file' ? scope.fileState : null, fileDetail: scope.source === 'file' ? scope.fileDetail : null,
    candidates: scope.candidates, walkTruncated: scope.walkTruncated, walkError: scope.walkError,
    milestones: ms.map((m) => ({ name: m.name, done: m.done, total: m.total, items: m.items.map((i) => (i.id ? { id: i.id, text: i.text, done: i.done } : { text: i.text, done: i.done })) })),
    done, total, summary: done + ' of ' + total + ' done', doneSince,
    link: link ? { kind: link.kind, url: link.url, state: link.state, at: link.at, branch: link.branch } : null, linkWhy,
    update, lastCopyAt: lc ? lc.at : null,
  };
  return { view, doneHashes };
}

// ---------- intents (pure state transitions) ----------
// ctx = { now: Date, newId(), known(projectId) → bool }. The caller has already checked the file for set-scope-file and
// computed `doneHashes` for copied from the live source — the renderer's own values for those are never trusted.
export function applyIntent(state, intent, ctx) {
  if (!isObj(intent)) throw new DeliveryError('unknown action.');
  let size = 0; try { size = JSON.stringify(intent).length; } catch { throw new DeliveryError('unknown action.'); }
  if (size > MAX_INTENT_BYTES || !INTENTS.includes(intent.type)) throw new DeliveryError('unknown action.');
  const id = intent.projectId;
  if (typeof id !== 'string' || !id || id.length > 200 || !ctx.known(id)) throw new DeliveryError('that project is not in the current scan.');
  const next = sanitizeState(state);
  const e = next.projects[id] || (next.projects[id] = { client: false, scopeFile: null, items: [], lastCopy: null });
  const needClient = () => { if (!e.client) throw new DeliveryError('mark this project as a client job first.'); };
  switch (intent.type) {
    case 'mark-client':
      if (typeof intent.on !== 'boolean') throw new DeliveryError('unknown action.');
      e.client = intent.on; break;
    case 'set-scope-file': {
      if (intent.rel === null || intent.rel === '') { e.scopeFile = null; break; }
      const c = cleanRel(intent.rel);
      if (!c) throw new DeliveryError('that is not a .md file inside the project folder.');
      e.scopeFile = c; break;
    }
    case 'item-add': {
      needClient();
      if (typeof intent.text !== 'string') throw new DeliveryError('write what is in scope.');
      const text = oneLine(intent.text, 100000);
      if (!text) throw new DeliveryError('write what is in scope.');
      if ([...text].length > MAX_TEXT) throw new DeliveryError('keep an item to ' + MAX_TEXT + ' characters.');
      if (intent.milestone != null && typeof intent.milestone !== 'string') throw new DeliveryError('unknown action.');
      const milestone = oneLine(intent.milestone, 100000);
      if ([...milestone].length > MAX_MILESTONE) throw new DeliveryError('keep a milestone name to ' + MAX_MILESTONE + ' characters.');
      if (e.items.length >= MAX_ITEMS) throw new DeliveryError('at most ' + MAX_ITEMS + ' items per project.');
      e.items.push({ id: 'i-' + ctx.newId(), text, milestone, done: false, doneAt: null }); break;
    }
    case 'item-toggle': case 'item-remove': {
      needClient();
      const i = typeof intent.id === 'string' ? e.items.findIndex((x) => x.id === intent.id) : -1;
      if (i < 0) throw new DeliveryError('that item is gone.');
      if (intent.type === 'item-remove') e.items.splice(i, 1);
      else { const it = e.items[i]; it.done = !it.done; it.doneAt = it.done ? ctx.now.toISOString() : null; }
      break;
    }
    case 'copied': {
      needClient();
      const hs = arr(intent.doneHashes);
      if (hs.length > MAX_DONE_HASHES || hs.some((h) => typeof h !== 'string' || h.length > 20)) throw new DeliveryError('unknown action.');
      e.lastCopy = { at: ctx.now.toISOString(), doneHashes: hs }; break;
    }
  }
  return next;
}

// ---------- latest.json → the projects this module can name ----------
export function listProjects(latest) {
  const ps = isObj(latest) ? arr(latest.projects) : [];
  return ps.filter((p) => isObj(p) && typeof p.id === 'string' && p.id).map((p) => ({
    id: p.id, name: typeof p.name === 'string' && p.name ? p.name : p.id, path: typeof p.path === 'string' ? p.path : '',
    remote: isObj(p.metrics) && isObj(p.metrics.git_safety) && typeof p.metrics.git_safety.remote === 'string' ? p.metrics.git_safety.remote : null,
  }));
}
