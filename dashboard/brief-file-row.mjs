// The phone file's Reach row and the small pure helpers it needs (batch 6, dish phone-file). It lives apart from brief-file-core.mjs on purpose:
// dashboard/reach.js loads it lazily, and this file imports nothing but node:path, so the Reach row works from any copied root
// (the MCP guard loads reach.js) without dragging the Brief projection along. brief-file-core.mjs re-exports every name here.
//   briefFileRow({ state, unreadable }, now) -> the Reach row (id 'brief-file'); never prints the full path
//   normalizeState(raw) -> { v:1, folder, lastWriteAt, lastError }   (a state file that cannot be used reads as OFF)
//   folderNameOf(folder) -> the last path segment only
import path from 'node:path';

export const FRESH_MS = 24 * 3600e3;    // the Reach row reads "on" only when the last write is this recent

const pad = (n) => String(n).padStart(2, '0');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const nowMs = (n) => (n instanceof Date ? n.getTime() : typeof n === 'number' && Number.isFinite(n) ? n : 0);
const hhmmOf = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : null; };

export function folderNameOf(folder) {
  if (typeof folder !== 'string') return '';
  const segs = folder.split(/[\\/]+/).filter(Boolean);
  const last = segs.length ? segs[segs.length - 1] : '';
  return last.length > 80 ? last.slice(0, 79) + '…' : last;
}

export function normalizeState(raw) {
  const o = isObj(raw) ? raw : {};
  const iso = (x) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
  return {
    v: 1,
    folder: typeof o.folder === 'string' && o.folder.trim() && path.isAbsolute(o.folder) ? o.folder : null,
    lastWriteAt: iso(o.lastWriteAt),
    lastError: typeof o.lastError === 'string' && o.lastError ? o.lastError.slice(0, 200) : null,
  };
}

export const ACTIONS = Object.freeze([{ id: 'brief-file-pick', label: 'Pick folder' }, { id: 'brief-file-clear', label: 'Turn off' }]);

// The Reach row. Never prints the full path: the folder's last segment, and the time of the last write.
export function briefFileRow({ state, unreadable } = {}, now) {
  const base = { id: 'brief-file', who: 'owner', actions: ACTIONS.map((a) => ({ ...a })) };
  if (unreadable) return { ...base, ok: null, detail: 'unknown - the phone file settings could not be read' };
  const s = normalizeState(state);
  if (!s.folder) return { ...base, ok: false, detail: 'off - nothing is written for your phone', step: 'Pick a folder you already sync to your phone' };
  const name = folderNameOf(s.folder) || 'the folder';
  const at = s.lastWriteAt ? Date.parse(s.lastWriteAt) : null, n = nowMs(now);
  if (at === null) return { ...base, ok: false, detail: 'folder "' + name + '" - nothing written yet' + (s.lastError ? ' (' + s.lastError + ')' : ''), step: 'Open the app so the Brief can write the file, or pick the folder again' };
  const same = new Date(at).toDateString() === new Date(n).toDateString();
  const when = same ? hhmmOf(at) : new Date(at).getDate() + '/' + (new Date(at).getMonth() + 1) + ' ' + hhmmOf(at);
  const detail = 'folder "' + name + '" - last written ' + when + (s.lastError ? ' (the latest write failed: ' + s.lastError + ')' : '');
  if (n - at <= FRESH_MS) return { ...base, ok: true, detail };
  return { ...base, ok: false, detail, step: 'Nothing was written for over a day - open the app, or pick the folder again' };
}
