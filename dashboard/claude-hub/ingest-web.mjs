// claude.ai live-sync upserts (spec 2026-10-13 §5.3; the export import was removed 2026-10-28). Ids: project 'web:<uuid>' (chats without a
// project → WEB_CHATS), conversation 'web:<uuid>', message 'web:<uuid>:<message uuid|@index>'. web_sync de-dups
// repeats; tombstones (written by forget with the full ids) win over every import.

export const WEB_CHATS = 'web:chats';
const notNewer = (prev, at) => !!prev && (!at || (!!prev.updated_at && prev.updated_at >= at));

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
