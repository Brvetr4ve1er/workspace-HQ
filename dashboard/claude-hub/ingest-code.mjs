// dashboard/claude-hub/ingest-code.mjs
// Incremental Claude Code ingest (spec §5.1). Streams each transcript from a stored
// byte cursor (never the whole file — one is 630 MB), keeps a partial last line for
// the next run, detects truncated/replaced files by size + a hash of the first bytes,
// and batches inserts in transactions so queries keep flowing during backfill.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCodeLine } from './parse-code.mjs';
import { maskSecrets } from './redact.mjs';

export const HEAD_BYTES = 256;
const BATCH = 500;
const NL = 0x0a;

// '<bytes>:<sha1>' of the first min(HEAD_BYTES, size) bytes. A later check hashes the SAME number
// of bytes, so an append to a short file (< HEAD_BYTES) is not mistaken for a replacement.
async function readHead(file, len = HEAD_BYTES) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return bytesRead + ':' + crypto.createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex');
  } finally { await fh.close(); }
}

const firstLine = (t) => String(t).split('\n').find((l) => l.trim()) || '';

export async function ingestFile(store, root, file, { chunkSize = 1 << 20, maxLine = 64 * 1024 * 1024 } = {}) {
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || !st.isFile()) return { added: 0, bad: 0, skippedLong: 0, reset: false, missing: true };
  const rel = path.relative(root, file);
  const folder = rel.split(path.sep)[0];
  const sessionId = path.basename(file, '.jsonl');
  const projectId = 'code:' + folder, convId = 'code:' + sessionId;
  if (store.isTombstoned('conversation', convId) || store.isTombstoned('project', projectId)) {
    store.setCursor({ file: rel, size: st.size, mtimeMs: st.mtimeMs, offset: st.size, head: null, sessionId });
    return { added: 0, bad: 0, skippedLong: 0, reset: false, tombstoned: true };
  }
  let cur = store.getCursor(rel), reset = false;
  const prevLen = cur && cur.head ? Number(String(cur.head).split(':')[0]) || 0 : 0;
  const headNow = prevLen ? await readHead(file, prevLen) : null;
  if (cur && (st.size < cur.offset || (cur.head && headNow !== cur.head))) {
    store.tx(() => { store.resetConversation(convId); store.deleteCursor(rel); });
    cur = null; reset = true;
  }
  const start = cur ? cur.offset : 0;
  if (start >= st.size) return { added: 0, bad: 0, skippedLong: 0, reset };
  const head = await readHead(file);   // recorded with the cursor (covers min(HEAD_BYTES, size) bytes)

  store.tx(() => {
    store.upsertProject({ id: projectId, source: 'code', key: folder, name: folder, path: null });
    store.ensureConversation({ id: convId, source: 'code', projectId, nativeId: sessionId });
  });

  let offset = start, pending = [], pendingLen = 0, skipping = false;
  let added = 0, bad = 0, skippedLong = 0, batch = [];
  const flush = () => {
    store.tx(() => {
      if (batch.length) added += store.addMessages(convId, batch);
      store.refreshTokens(convId);
      store.setCursor({ file: rel, size: st.size, mtimeMs: st.mtimeMs, offset, head, sessionId });
    });
    batch = [];
  };
  const handle = (lineBuf) => {
    const p = parseCodeLine(lineBuf.toString('utf8'));
    if (!p) return;
    if (p.kind === 'bad') { bad++; return; }
    if (p.kind === 'title') { store.setTitle(convId, maskSecrets(p.title).text, p.source); return; }   // titles reach lists and search hits too
    if (p.kind !== 'message') return;
    if (p.cwd) store.upsertProject({ id: projectId, source: 'code', key: folder, name: path.win32.basename(p.cwd) || folder, path: p.cwd });
    store.ensureConversation({ id: convId, source: 'code', projectId, nativeId: sessionId, cwd: p.cwd, gitBranch: p.gitBranch, model: p.model });
    if (p.usage && p.apiId) store.addUsage(convId, p.apiId, p.usage);
    if (!p.text) return;
    const text = maskSecrets(p.text).text;
    // Message ids are scoped to the conversation: a resumed/forked session copies its parent's lines with the
    // same uuids, and a global 'code:<uuid>' key + INSERT OR IGNORE would silently drop them from whichever
    // transcript is ingested second (the owner's tree: ~25% of lines). nativeId keeps the raw uuid.
    const id = 'code:' + sessionId + ':' + (p.uuid || '@' + offset);
    batch.push({ id, nativeId: p.uuid, parentId: p.parentUuid, role: p.role, at: p.at, text, toolName: p.toolName, isSidechain: p.isSidechain });
    if (p.role === 'user' && !p.isSidechain) store.setTitle(convId, firstLine(text).slice(0, 80), 'first-prompt');
  };

  const stream = fs.createReadStream(file, { start, end: st.size - 1, highWaterMark: chunkSize });
  for await (const chunk of stream) {
    let from = 0;
    for (;;) {
      const nl = chunk.indexOf(NL, from);
      if (nl === -1) {
        const rest = chunk.subarray(from);
        if (skipping) { offset += rest.length; break; }
        pending.push(rest); pendingLen += rest.length;
        if (pendingLen > maxLine) { skipping = true; skippedLong++; offset += pendingLen; pending = []; pendingLen = 0; }
        break;
      }
      const piece = chunk.subarray(from, nl + 1);
      if (skipping) { offset += piece.length; skipping = false; }
      else {
        const lineBuf = pendingLen ? Buffer.concat([...pending, piece]) : piece;
        pending = []; pendingLen = 0;
        offset += lineBuf.length;
        if (lineBuf.length - 1 > maxLine) skippedLong++; else handle(lineBuf.subarray(0, lineBuf.length - 1));
        if (batch.length >= BATCH) { flush(); await new Promise((r) => setImmediate(r)); }
      }
      from = nl + 1;
    }
  }
  flush();   // the offset excludes a partial last line, which is re-read next time
  return { added, bad, skippedLong, reset };
}

export async function listTranscripts(root) {
  const out = [];
  const dirs = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const files = await fs.promises.readdir(path.join(root, d.name), { withFileTypes: true }).catch(() => []);
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const file = path.join(root, d.name, f.name);
      const st = await fs.promises.stat(file).catch(() => null);
      if (st) out.push({ file, rel: path.relative(root, file), size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// A file that fails to ingest never stops the others; its reason is kept in meta.last_error (surfaced by the
// Hub's health) rather than vanishing. A dead store makes this setMeta throw too, which rejects the caller's run.
const recordError = (store, rel, e) => store.setMeta('last_error', rel + ': ' + String(e && e.message || e).slice(0, 300));

export async function backfill(store, root, { onProgress = () => {}, shouldStop = () => false } = {}) {
  const files = await listTranscripts(root);
  let done = 0, stopped = false;
  onProgress({ done, total: files.length });
  for (const f of files) {
    if (shouldStop()) { stopped = true; break; }
    try { await ingestFile(store, root, f.file); }
    catch (e) { recordError(store, f.rel, e); }
    done++;
    onProgress({ done, total: files.length });
    await new Promise((r) => setImmediate(r));
  }
  if (!stopped) store.setMeta('backfill_done_at', new Date().toISOString());   // a stopped run is not "done"
  return { done, total: files.length };
}

export async function sweep(store, root) {
  const changed = [];
  for (const f of await listTranscripts(root)) {
    const cur = store.getCursor(f.rel);
    if (cur && cur.size === f.size && Math.floor(cur.mtime_ms) === Math.floor(f.mtimeMs)) continue;
    let r;
    try { r = await ingestFile(store, root, f.file); }
    catch (e) { recordError(store, f.rel, e); continue; }
    if (r.added > 0 || r.reset) changed.push('code:' + path.basename(f.file, '.jsonl'));
  }
  return changed;
}

export function watchRoot(root, onFile, { debounceMs = 1000 } = {}) {
  const timers = new Map();
  let w = null;
  try {
    w = fs.watch(root, { recursive: true }, (_evt, name) => {
      if (!name || !String(name).endsWith('.jsonl')) return;
      const parts = String(name).split(/[\\/]/);
      if (parts.length !== 2) return;   // only <folder>/<session>.jsonl
      const file = path.join(root, String(name));
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => { timers.delete(file); onFile(file); }, debounceMs));
    });
    // an FSWatcher 'error' with no listener would throw out of the Hub process; a dead watch just falls back to sweep()
    w.on('error', () => { try { w.close(); } catch { /* closed */ } });
  } catch { w = null; }   // a missing root: sweep() still runs on its timer
  return { close() { for (const t of timers.values()) clearTimeout(t); timers.clear(); try { w && w.close(); } catch { /* closed */ } } };
}
