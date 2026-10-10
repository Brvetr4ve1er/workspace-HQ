'use strict';
// LibraryRepository — local history of saved files. JSON store (atomic
// writes, corrupt-file quarantine). Records hold only what the UI needs:
// never a query string, a token, or a signed URL.
const path = require('node:path');
const crypto = require('node:crypto');
const { readJsonStore, writeJsonStore } = require('./json-store');
const { redactUrl } = require('./url-safety');

function createLibrary(userData, log = console) {
  const file = path.join(userData, 'library.json');
  const { value: store, quarantined } = readJsonStore(file, { version: 1, items: [] }, log);
  if (!Array.isArray(store.items)) store.items = [];
  const persist = () => writeJsonStore(file, store);

  return {
    file, quarantined: quarantined || null,
    add(rec) {
      const item = {
        id: crypto.randomUUID(), savedAt: new Date().toISOString(),
        source: rec.source || 'web', host: rec.host || '', pageUrl: rec.pageUrl ? redactUrl(rec.pageUrl) : null, sourceUrl: redactUrl(rec.sourceUrl),
        localPath: rec.localPath, originalName: rec.originalName || '', finalName: path.basename(rec.localPath),
        kind: rec.kind, mime: rec.mime, bytes: rec.bytes, sha256: rec.sha256, width: rec.width || null, height: rec.height || null, duration: rec.duration || null,
        title: rec.title || '', pageTitle: rec.pageTitle || '', quality: rec.quality || 'unknown', via: rec.via || [], tags: [], note: '',
        jobId: rec.jobId || null, deleted: false,
      };
      store.items.unshift(item);
      persist();
      return item;
    },
    list({ q = '', sort = 'savedAt', dir = 'desc', kind = 'all', includeDeleted = false } = {}) {
      const needle = String(q || '').toLowerCase();
      let items = store.items.filter((i) => includeDeleted || !i.deleted);
      if (kind !== 'all') items = items.filter((i) => i.kind === kind);
      if (needle) items = items.filter((i) => [i.finalName, i.originalName, i.title, i.pageTitle, i.host, i.sourceUrl, i.pageUrl || '', i.tags.join(' '), i.note].join('\n').toLowerCase().includes(needle));
      const key = ['savedAt', 'bytes', 'finalName', 'host', 'kind'].includes(sort) ? sort : 'savedAt';
      items.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'asc' ? 1 : -1));
      return items;
    },
    get: (id) => store.items.find((i) => i.id === id) || null,
    findBySha: (sha) => store.items.find((i) => i.sha256 === sha && !i.deleted) || null,
    update(id, patch) {
      const it = store.items.find((i) => i.id === id); if (!it) return null;
      if (typeof patch.note === 'string') it.note = patch.note.slice(0, 2000);
      if (Array.isArray(patch.tags)) it.tags = patch.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 30);
      persist(); return it;
    },
    // Soft delete with undo (brief: undo destructive history actions).
    remove(id) { const it = store.items.find((i) => i.id === id); if (!it) return false; it.deleted = true; it.deletedAt = new Date().toISOString(); persist(); return true; },
    restore(id) { const it = store.items.find((i) => i.id === id); if (!it) return false; it.deleted = false; delete it.deletedAt; persist(); return true; },
    purgeDeleted() { const n = store.items.length; store.items = store.items.filter((i) => !i.deleted); persist(); return n - store.items.length; },
    clear() { store.items = []; persist(); },
    stats() { const live = store.items.filter((i) => !i.deleted); return { count: live.length, bytes: live.reduce((s, i) => s + (i.bytes || 0), 0) }; },
  };
}

module.exports = { createLibrary };
