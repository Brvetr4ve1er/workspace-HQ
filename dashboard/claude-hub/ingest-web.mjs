// claude.ai export import + live-sync upserts (spec 2026-10-13 §5.2–§5.3). Ids: project 'web:<uuid>' (chats without a
// project → WEB_CHATS), conversation 'web:<uuid>', message 'web:<uuid>:<message uuid|@index>'. web_sync de-dups both
// paths; tombstones (written by forget with the full ids) win over every import.
import fs from 'node:fs';
import path from 'node:path';
import { extractEntries } from './unzip.mjs';
import { streamJsonArray, parseWebConversation, parseWebProject, newReport, noteUnknown } from './parse-web.mjs';

export const WEB_CHATS = 'web:chats';
const notNewer = (prev, at) => !!prev && (!at || (!!prev.updated_at && prev.updated_at >= at));
const tick = () => new Promise((r) => setImmediate(r));

export function ingestWebProject(store, p, report) {
  const id = 'web:' + p.uuid;
  if (store.isTombstoned('project', id)) { report.projects.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('project', p.uuid), p.updatedAt)) { report.projects.unchanged++; return 'unchanged'; }
  store.tx(() => {
    store.upsertProject({ id, source: 'web', key: p.uuid, name: p.name, path: null });
    store.setProjectName(id, p.name);
    store.setSync('project', p.uuid, p.updatedAt);
  });
  report.projects.imported++;
  return 'imported';
}

export function ingestWebConversation(store, conv, report) {
  const id = 'web:' + conv.uuid;
  // No project uuid in this copy (exports and list rows often omit it) → keep the project the chat already has.
  const prev = conv.projectUuid ? null : store.db.prepare('SELECT project_id FROM conversation WHERE id = ?').get(id);
  const projectId = conv.projectUuid ? 'web:' + conv.projectUuid : (prev && prev.project_id) || WEB_CHATS;
  if (store.isTombstoned('conversation', id) || store.isTombstoned('project', projectId)) { report.conversations.forgotten++; return 'forgotten'; }
  if (notNewer(store.getSync('conversation', conv.uuid), conv.updatedAt)) { report.conversations.unchanged++; return 'unchanged'; }
  if (!conv.messages.length) { store.setSync('conversation', conv.uuid, conv.updatedAt); report.conversations.skipped++; return 'empty'; }
  const fallback = conv.updatedAt || conv.createdAt || null;
  const msgs = conv.messages.map((m, i) => ({ id: id + ':' + (m.uuid || '@' + i), nativeId: m.uuid, parentId: m.parentUuid, role: m.role,
    at: m.at || fallback, text: m.text, toolName: null, isSidechain: false }));
  let added = 0;
  store.tx(() => {
    if (projectId === WEB_CHATS) store.upsertProject({ id: WEB_CHATS, source: 'web', key: 'chats', name: 'claude.ai chats', path: null });
    else store.upsertProject({ id: projectId, source: 'web', key: projectId.slice(4), name: 'claude.ai project', path: null });   // never renames an existing row (path null)
    store.resetConversation(id);   // replace: claude.ai edits and branches rewrite history; a no-op for a new chat
    store.ensureConversation({ id, source: 'web', projectId, nativeId: conv.uuid, cwd: null, gitBranch: null, model: conv.model });
    if (conv.title) store.setTitle(id, conv.title, 'web');
    added = store.addMessages(id, msgs);
    store.setSync('conversation', conv.uuid, conv.updatedAt);
  });
  report.conversations.imported++;
  report.messages.imported += added;
  report.messages.skipped += msgs.length - added;
  return 'imported';
}

// onImported(ids) announces the 'web:' ids saved so far every IMPORT_ANNOUNCE_EVERY conversations and once at the end, so
// the Hub can tell the renderer while a long import is still running (each conversation is its own committed tx).
export const IMPORT_ANNOUNCE_EVERY = 200;
export async function importExportFile(store, zipPath, { tmpRoot, onProgress = () => {}, onImported = () => {}, maxBytes } = {}) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const job = fs.mkdtempSync(path.join(tmpRoot, 'import-'));
  const report = newReport();
  try {
    onProgress({ phase: 'unzip', done: 0, total: 0 });
    const got = await extractEntries(zipPath, ['conversations.json', 'projects.json'], job, maxBytes ? { maxBytes } : {});
    report.files = { conversations: !!got['conversations.json'], projects: !!got['projects.json'] };
    if (!report.files.conversations && !report.files.projects) throw new Error('This ZIP has neither conversations.json nor projects.json — is it a claude.ai data export?');
    let n = 0;
    if (got['projects.json']) {
      const r = await streamJsonArray(got['projects.json'], async (raw) => {
        report.projects.seen++;
        const p = parseWebProject(raw);
        if (!p.ok) { report.projects.skipped++; return; }
        noteUnknown(report, p.unknown);
        ingestWebProject(store, p.project, report);
        if (++n % 200 === 0) await tick();
      });
      report.projects.skipped += r.bad; if (r.truncated) report.truncated = true;
      onProgress({ phase: 'projects', done: report.projects.seen, total: report.projects.seen });
    }
    if (got['conversations.json']) {
      let fresh = [];
      const announce = () => { if (fresh.length) { const ids = fresh; fresh = []; onImported(ids); } };
      let r;
      try {   // a failing file still announces the chats saved before the failure
        r = await streamJsonArray(got['conversations.json'], async (raw) => {
          report.conversations.seen++;
          const c = parseWebConversation(raw);
          if (!c.ok) { report.conversations.skipped++; return; }
          noteUnknown(report, c.unknown);
          report.messages.skipped += c.skipped; report.messages.empty += c.empty;
          if (ingestWebConversation(store, c.conv, report) === 'imported') fresh.push('web:' + c.conv.uuid);
          onProgress({ phase: 'conversations', done: report.conversations.seen, total: 0 });
          if (report.conversations.seen % IMPORT_ANNOUNCE_EVERY === 0) announce();
          if (++n % 200 === 0) await tick();
        });
      } finally { announce(); }
      report.conversations.skipped += r.bad; if (r.truncated) report.truncated = true;
    }
    return report;
  } finally {
    fs.rmSync(job, { recursive: true, force: true });
  }
}
