// dashboard/claude-hub/index-guard.mjs
// The index can't be wiped (recall dish, commit 1). Claude Code deletes transcripts after a retention period, so for
// an old chat the Hub's hub.sqlite is the ONLY copy. A reindex (store.resetCode) deletes every code conversation and
// rebuilds from the transcripts on disk, which would delete exactly those chats. This module counts them so the Hub
// can refuse the reset while any exist.
//
// A code conversation 'code:<sessionId>' in project 'code:<folder>' has its transcript at <root>/<folder>/<sessionId>.jsonl
// (ingest-code.mjs: only files directly in a project folder are ingested). A transcript that exists only deeper
// (<folder>/<session>/subagents/...) does not count as present: that is the conservative reading, it can only make
// the guard refuse more. Never throws: a missing or unreadable root means every chat is index-only (the transcripts
// are not there to rebuild from), and a failing existence check counts the chat as index-only.
import fs from 'node:fs';
import path from 'node:path';

// project_id is 'code:<folder>' (ingest-code.mjs), native_id is the session id (the file's base name)
const folderOf = (projectId) => (typeof projectId === 'string' && projectId.startsWith('code:') ? projectId.slice(5) : null);

// rows: [{ project_id, native_id }] of non-forgotten code conversations -> the ones whose transcript is gone
export function indexOnlyRows(rows, root, { exists = (f) => fs.statSync(f).isFile() } = {}) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const folder = folderOf(r && r.project_id);
    const native = r && typeof r.native_id === 'string' ? r.native_id : '';
    let present = false;
    if (folder && native && typeof root === 'string' && root && !/[\\/]/.test(folder) && !/[\\/]/.test(native)) {
      try { present = !!exists(path.join(root, folder, native + '.jsonl')); } catch { present = false; }
    }
    if (!present) out.push(r);
  }
  return out;
}

export const countIndexOnly = (rows, root, opts) => indexOnlyRows(rows, root, opts).length;

// the code conversations a reset would delete (forgotten ones are already gone for the owner)
export function codeConversationRows(store) {
  return store.db.prepare("SELECT id, project_id, native_id FROM conversation WHERE source = 'code' AND forgotten = 0").all();
}

// store: an open Hub store (store.db); root: the projects root (resolveClaudeRoot). -> { indexOnly, allow }
// allow is false while any chat exists only in this index. A store that cannot be read refuses (the safe answer).
export function guardReset(store, root, opts) {
  try {
    const n = countIndexOnly(codeConversationRows(store), root, opts);
    return { indexOnly: n, allow: n === 0 };
  } catch (e) {
    return { indexOnly: 0, allow: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// the exact words the reindex op answers with and the log carries
export const refusalText = (n) => n + ' chats exist only in this index — a reindex would delete them';
