/* Cosmos space — all disk IO for data/cosmos/, through an injected `fs` (the synchronous node:fs API).

   Files (the folder is local-only and gitignored):
     config.json        { version, root, indexedAt }
     library.json       { version, generatedAt, root, idMap, works[], dupes }   (rebuildable, EXCEPT idMap)
     curation.json      the irreplaceable half; curation.json.prev is the previous good copy
     cleanup.json       dismissals only
     thumbs/<name>.jpg  rebuildable thumbnails
     imports/           files dropped onto the Feed

   Rules this file keeps:
   - Every write is atomic: `<file>.<pid>.tmp`, then rename. A rename that throws leaves the old file intact.
   - curation.json: before each write the current copy, if it still parses and has the right shape, is copied
     to curation.json.prev. A corrupt current copy is never copied over a good .prev.
   - A file that fails JSON.parse or the shape check is renamed to `<file>.corrupt` (then .corrupt-2, -3 …,
     never replacing an earlier one) and the read says so. It is never overwritten with an empty document.
   - A missing file is a valid empty document.
   - A library that will not parse is moved aside AND its idMap is salvaged from the text, so the ids (which
     every cluster and favourite points at) survive; a stub library carrying the salvaged map takes its place.

   No clock, no randomness: only the injected fs and (for thumbnail names) a hash. */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { emptyIdMap, parseIdMap } from './ids.mjs';
import { normalizeCuration, normalizeCleanup, emptyCuration, emptyCleanup } from './curation.mjs';

export const LIBRARY_VERSION = 1;

export function emptyDupes() {
  return { exact: [], near: [], junk: [] };
}

export function emptyLibrary() {
  return { version: LIBRARY_VERSION, generatedAt: null, root: null, idMap: emptyIdMap(), works: [], dupes: emptyDupes() };
}

export function defaultConfig() {
  return { version: 1, root: null, indexedAt: null };
}

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

export function normalizeConfig(raw) {
  if (!isPlain(raw)) return null;
  if (raw.root !== undefined && raw.root !== null && typeof raw.root !== 'string') return null;
  if (raw.indexedAt !== undefined && raw.indexedAt !== null && typeof raw.indexedAt !== 'string') return null;
  return { version: 1, root: raw.root || null, indexedAt: raw.indexedAt || null };
}

function normalizeDupes(raw) {
  const d = emptyDupes();
  if (!isPlain(raw)) return d;
  if (Array.isArray(raw.exact)) d.exact = raw.exact;
  if (Array.isArray(raw.near)) d.near = raw.near;
  if (Array.isArray(raw.junk)) d.junk = raw.junk;
  return d;
}

/** Parsed JSON → a library, or null when it is not even an object with a works list. Bad rows are dropped. */
export function normalizeLibrary(raw) {
  if (!isPlain(raw)) return null;
  if (raw.works !== undefined && !Array.isArray(raw.works)) return null;
  const works = (raw.works || []).filter((w) => isPlain(w) && typeof w.id === 'string' && w.id !== '' && typeof w.rel === 'string' && w.rel !== '');
  return {
    version: LIBRARY_VERSION,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    root: typeof raw.root === 'string' ? raw.root : null,
    idMap: parseIdMap(raw.idMap).map,
    works,
    dupes: normalizeDupes(raw.dupes),
  };
}

/**
 * The file name (without folder) a thumbnail of this element lives under. An ordinary id is its own name;
 * anything with odd characters (a manifest can carry any string) is hashed so it can never name a path.
 */
export function thumbName(id) {
  const s = String(id);
  if (/^[a-z0-9][a-z0-9_-]{0,119}$/.test(s)) return s + '.jpg';
  return 'x-' + createHash('sha1').update(s).digest('hex').slice(0, 24) + '.jpg';
}

/**
 * Best effort: pull the `"idMap":{…}` object out of a library text that will not parse, so the ids survive.
 * Tries the balanced object first; falls back to scanning rel/id pairs. Always returns an id map.
 */
export function salvageIdMap(text) {
  if (typeof text !== 'string') return emptyIdMap();
  const m = /"idMap"\s*:\s*\{/.exec(text);
  if (!m) return emptyIdMap();
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end > 0) {
    try {
      const parsed = parseIdMap(JSON.parse(text.slice(start, end + 1)));
      if (parsed.map.entries.length > 0) return parsed.map;
    } catch { /* fall through to the scan */ }
  }
  const entries = [];
  const pair = /\{\s*"rel"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"id"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g;
  pair.lastIndex = start;
  let p;
  while ((p = pair.exec(text)) !== null) {
    try { entries.push({ rel: JSON.parse(p[1]), id: JSON.parse(p[2]) }); } catch { /* skip a broken pair */ }
  }
  return parseIdMap({ entries }).map;
}

/**
 * @param {{fs:object, dir:string, pid?:number}} o  `fs` is the synchronous node:fs API (or a fake of it).
 */
export function makeStore({ fs, dir, pid = process.pid }) {
  const file = (n) => path.join(dir, n);
  const f = {
    config: file('config.json'),
    library: file('library.json'),
    curation: file('curation.json'),
    prev: file('curation.json.prev'),
    cleanup: file('cleanup.json'),
    thumbs: file('thumbs'),
    imports: file('imports'),
  };

  function atomicWrite(target, text) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${pid}.tmp`;
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, target);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* the tmp may not exist */ }
      throw e;
    }
  }

  /** Move a bad file aside without ever replacing an earlier quarantine. Returns the new path or null. */
  function quarantine(target) {
    let to = target + '.corrupt';
    for (let i = 2; fs.existsSync(to) && i < 1000; i++) to = `${target}.corrupt-${i}`;
    if (fs.existsSync(to)) return null;
    try { fs.renameSync(target, to); return to; } catch { return null; }
  }

  function readDoc(target, normalize) {
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') return { status: 'missing' };
      return { status: 'unreadable', error: e };
    }
    let raw;
    try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch {
      return { status: 'corrupt', text, reason: 'it is not valid JSON' };
    }
    const value = normalize(raw);
    if (value === null) return { status: 'corrupt', text, reason: 'it does not have the expected shape' };
    return { status: 'ok', value, text };
  }

  const nameOf = (p) => path.basename(p);
  const unreadable = (what, r) => ({ error: `Could not read ${what}: ${r.error && r.error.message ? r.error.message : 'unknown problem'}.` });

  /** Quarantine a corrupt document; the sentence says where it went (or that it could not be moved). */
  function aside(target, r) {
    const to = quarantine(target);
    const base = nameOf(target);
    return to
      ? { to, message: `${base} could not be read (${r.reason}). It was kept as ${nameOf(to)}.` }
      : { to: null, message: `${base} could not be read (${r.reason}) and could not be moved aside. Nothing was overwritten.` };
  }

  return {
    paths: f,
    atomicWrite,
    quarantine,
    thumbName,

    readConfig() {
      const r = readDoc(f.config, normalizeConfig);
      if (r.status === 'missing') return { config: defaultConfig() };
      if (r.status === 'ok') return { config: r.value };
      if (r.status === 'unreadable') return unreadable('the Cosmos settings', r);
      const a = aside(f.config, r);
      return { config: defaultConfig(), warning: a.message };
    },
    writeConfig(config) {
      atomicWrite(f.config, JSON.stringify({ version: 1, root: config.root || null, indexedAt: config.indexedAt || null }, null, 1));
    },

    /** { library, exists } | { error, idMap } (the file was moved aside; idMap is what could be salvaged). */
    readLibrary() {
      const r = readDoc(f.library, normalizeLibrary);
      if (r.status === 'missing') return { library: emptyLibrary(), exists: false };
      if (r.status === 'ok') return { library: r.value, exists: true };
      if (r.status === 'unreadable') return unreadable('the library', r);
      const salvaged = salvageIdMap(r.text);
      const a = aside(f.library, r);
      const out = { error: a.message, idMap: salvaged, recovered: salvaged.entries.length };
      if (a.to) {
        out.error += salvaged.entries.length
          ? ` ${salvaged.entries.length} element ids were recovered; index again to rebuild the library.`
          : ' Index again to rebuild the library.';
        if (salvaged.entries.length) {
          try { atomicWrite(f.library, JSON.stringify({ ...emptyLibrary(), idMap: salvaged })); } catch { /* the ids stay in memory for the next index */ }
        }
      }
      return out;
    },
    writeLibrary(library) {
      atomicWrite(f.library, JSON.stringify(library));
    },

    /** { curation } | { error, curation, restored } | { error } (unreadable: no document is offered). */
    readCuration() {
      const r = readDoc(f.curation, normalizeCuration);
      if (r.status === 'missing') return { curation: emptyCuration() };
      if (r.status === 'ok') return { curation: r.value };
      if (r.status === 'unreadable') return unreadable('your curation', r);
      const a = aside(f.curation, r);
      if (!a.to) return { error: a.message };
      const p = readDoc(f.prev, normalizeCuration);
      if (p.status === 'ok') {
        try {
          atomicWrite(f.curation, p.text);
          return { error: `${a.message} Your previous save (curation.json.prev) was restored.`, curation: p.value, restored: true };
        } catch { /* fall through: serve it from memory */ }
        return { error: `${a.message} Your previous save could not be restored.`, curation: p.value, restored: false };
      }
      return { error: a.message, curation: emptyCuration(), restored: false };
    },
    writeCuration(doc) {
      if (normalizeCuration(doc) === null) throw new Error('refusing to write a curation document with the wrong shape');
      const cur = readDoc(f.curation, normalizeCuration);
      if (cur.status === 'unreadable') throw cur.error;
      if (cur.status === 'ok') atomicWrite(f.prev, cur.text);
      else if (cur.status === 'corrupt') {
        if (!quarantine(f.curation)) throw new Error('curation.json is damaged and could not be moved aside');
      }
      atomicWrite(f.curation, JSON.stringify(doc, null, 1));
    },

    readCleanup() {
      const r = readDoc(f.cleanup, normalizeCleanup);
      if (r.status === 'missing') return { cleanup: emptyCleanup() };
      if (r.status === 'ok') return { cleanup: r.value };
      if (r.status === 'unreadable') return unreadable('the cleanup list', r);
      const a = aside(f.cleanup, r);
      return a.to ? { error: a.message, cleanup: emptyCleanup() } : { error: a.message };
    },
    writeCleanup(doc) {
      if (normalizeCleanup(doc) === null) throw new Error('refusing to write a cleanup document with the wrong shape');
      const cur = readDoc(f.cleanup, normalizeCleanup);
      if (cur.status === 'unreadable') throw cur.error;
      if (cur.status === 'corrupt' && !quarantine(f.cleanup)) throw new Error('cleanup.json is damaged and could not be moved aside');
      atomicWrite(f.cleanup, JSON.stringify(doc, null, 1));
    },

    thumbPath: (id) => path.join(f.thumbs, thumbName(id)),
    writeThumb(id, buf) {
      atomicWrite(path.join(f.thumbs, thumbName(id)), buf);
    },
    thumbInfo(id) {
      try {
        const st = fs.statSync(path.join(f.thumbs, thumbName(id)));
        return st && st.isFile() ? { mtimeMs: st.mtimeMs } : null;
      } catch { return null; }
    },
    removeThumb(id) {
      try { fs.unlinkSync(path.join(f.thumbs, thumbName(id))); return true; } catch { return false; }
    },
    renameThumb(fromId, toId) {
      try {
        fs.renameSync(path.join(f.thumbs, thumbName(fromId)), path.join(f.thumbs, thumbName(toId)));
        return true;
      } catch { return false; }
    },
    listThumbNames() {
      try { return new Set(fs.readdirSync(f.thumbs)); } catch { return new Set(); }
    },
  };
}
