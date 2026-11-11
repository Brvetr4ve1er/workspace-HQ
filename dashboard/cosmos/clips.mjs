/* Cosmos space — grabbed files that land as clips (batch 3, "grab-into-cosmos"). A clip IS an import with a stricter
   front door: the Bridge saved one file on the owner's click into Downloads/WorkspaceHQ/grabs/<host>/, then asked the
   app (POST /library/grab -> dashboard/grab-routes.js -> cosmos.js addClip) to keep a copy. This module holds every rule of
   that front door, with all IO injected, so cosmos.js stays the only writer of data/cosmos and stays thin:
     - sniff(bytes)               the first 16 bytes decide the family (PNG, JPEG, GIF, WEBP, MP4/MOV, WEBM) — never the name
     - containment                the file must really live in <grabRoot>/<host>/<file> (realpath both, path.relative)
     - one open handle            fstat + head + the whole copy come from ONE handle, so a swap after the check changes nothing
     - temp outside the walk      the copy is built in data/cosmos/.grab-tmp (never indexed), hashed while it streams, then
                                  linked into imports/ as clip-<hash12>.<ext> with a no-overwrite rule (a partial file is
                                  never visible to the indexer; a name that exists answers duplicate and changes nothing)
     - provenance manifest        data/cosmos/clips.json { v:1, clips:[…] } (OUTSIDE the walked imports folder), atomic
                                  writes, a corrupt file is renamed aside and never overwritten empty, capped at 5000
     - after the next index run   the entry's tags and title are applied through cosmos.js's own validated apply path
   The app never fetches a URL and never reads a path the request names beyond the one realpath-contained file.

   Exports exactly: SNIFF_BYTES, MAX_CLIP_BYTES, MAX_CLIPS, MANIFEST_FILE, TMP_DIR, TMP_MAX_AGE_MS, sniff, extFamily,
   reducePageUrl, cleanTitle, clipRecord, normaliseManifest, capClips, pendingWork, readManifest, writeManifest,
   makeClipService.

   No clock and no randomness of its own: `now` and `newId` are injected. Error sentences never contain a path, a name
   or a URL (the route sends them to the extension and the audit log never sees them). */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { isInside } from './paths.mjs';
import { clipTags, inferTypeFromClip, normalizeTag } from './infer.mjs';
import { WORK_TYPES } from './types.mjs';

export const SNIFF_BYTES = 16;
export const MAX_CLIP_BYTES = 64 * 1024 * 1024;
export const MAX_CLIPS = 5000;
export const MANIFEST_FILE = 'clips.json';
export const TMP_DIR = '.grab-tmp';
export const TMP_MAX_AGE_MS = 60 * 60 * 1000;

const CHUNK = 256 * 1024;
const TITLE_MAX = 200;
const HOST_RE = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const FILE_RE = /^clip-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|mov|webm)$/;
const TMP_RE = /^grab-[A-Za-z0-9_-]{1,40}\.tmp$/;

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const errText = (e) => (e && e.message ? String(e.message).slice(0, 160) : 'unknown problem');
const ascii = (bytes, from, to) => { let s = ''; for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]); return s; };

/** The family a file's first bytes say it is: { family, ext, kind, mime } or null (SVG, HTML, a renamed script …). */
export function sniff(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return null;
  const b = bytes;
  const n = b.length;
  if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { family: 'png', ext: '.png', kind: 'image', mime: 'image/png' };
  }
  if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { family: 'jpeg', ext: '.jpg', kind: 'image', mime: 'image/jpeg' };
  if (n >= 6) {
    const g = ascii(b, 0, 6);
    if (g === 'GIF87a' || g === 'GIF89a') return { family: 'gif', ext: '.gif', kind: 'image', mime: 'image/gif' };
  }
  if (n >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { family: 'webp', ext: '.webp', kind: 'image', mime: 'image/webp' };
  if (n >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const qt = ascii(b, 8, 12) === 'qt  ';
    return { family: 'isobmff', ext: qt ? '.mov' : '.mp4', kind: 'video', mime: qt ? 'video/quicktime' : 'video/mp4' };
  }
  if (n >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { family: 'webm', ext: '.webm', kind: 'video', mime: 'video/webm' };
  return null;
}

const EXT_FAMILY = Object.freeze({
  '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp',
  '.mp4': 'isobmff', '.m4v': 'isobmff', '.mov': 'isobmff', '.webm': 'webm',
});

/** The family a file name claims, or null when the extension is not one a clip may have. */
export function extFamily(ext) {
  const e = typeof ext === 'string' ? ext.toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(EXT_FAMILY, e) ? EXT_FAMILY[e] : null;
}

/** A page URL reduced to what may be stored: { host, hostPath } with no scheme details, query, hash or credentials, or null. */
export function reducePageUrl(url) {
  if (typeof url !== 'string' || url === '' || url.length > 4096) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.length > 253) return null;
  let p = u.pathname || '/';
  if (p.length > 200) p = p.slice(0, 200);
  return { host, hostPath: host + (p === '/' ? '' : p) };
}

/** A page title as one clean line of at most 200 characters ('' when there is nothing left). */
export function cleanTitle(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
}

/** One manifest entry for a clip that has just landed. `leaf` is the original file's own name (a type hint only). */
export function clipRecord({ file, host, pageUrl, pageTitle, leaf, mime, at }) {
  const page = reducePageUrl(pageUrl);
  const title = cleanTitle(pageTitle);
  const mediaUrl = 'https://' + host + '/' + encodeURIComponent(typeof leaf === 'string' ? leaf : file);
  const tags = clipTags({ pageUrl: page ? 'https://' + page.hostPath : 'https://' + host + '/', pageTitle: title, siteName: host });
  const type = inferTypeFromClip({ mediaUrl, pageUrl: page ? 'https://' + page.hostPath : '', pageTitle: title, mime });
  return {
    file,
    host,
    pageHost: page ? page.host : '',
    page: page ? page.hostPath : '',
    title: title || 'Grab from ' + host,
    tags,
    type,
    at,
    applied: false,
  };
}

function normaliseEntry(raw) {
  if (!isPlain(raw)) return null;
  if (typeof raw.file !== 'string' || !FILE_RE.test(raw.file)) return null;
  if (typeof raw.host !== 'string' || !HOST_RE.test(raw.host)) return null;
  const tags = [];
  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      if (typeof t !== 'string') continue;
      const n = normalizeTag(t);
      if (n !== '' && n.length <= 40 && !tags.includes(n) && tags.length < 30) tags.push(n);
    }
  }
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    file: raw.file,
    host: raw.host,
    pageHost: str(raw.pageHost, 253),
    page: str(raw.page, 460),
    title: cleanTitle(typeof raw.title === 'string' ? raw.title : '') || 'Grab from ' + raw.host,
    tags,
    type: typeof raw.type === 'string' && WORK_TYPES.includes(raw.type) ? raw.type : 'misc',
    at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '',
    applied: raw.applied === true,
  };
}

/** Parsed JSON -> { v:1, clips } (bad rows dropped, repeated files collapsed to the first), or null when it is not a manifest. */
export function normaliseManifest(raw) {
  if (!isPlain(raw) || raw.v !== 1 || !Array.isArray(raw.clips)) return null;
  const seen = new Set();
  const clips = [];
  for (const r of raw.clips) {
    const e = normaliseEntry(r);
    if (!e || seen.has(e.file)) continue;
    seen.add(e.file);
    clips.push(e);
  }
  return { v: 1, clips: capClips(clips, MAX_CLIPS) };
}

/** At most `max` entries: the oldest applied ones go first, then the oldest of all. Order is kept. */
export function capClips(clips, max = MAX_CLIPS) {
  let over = clips.length - max;
  if (over <= 0) return clips;
  const drop = new Set();
  for (let i = 0; i < clips.length && drop.size < over; i++) if (clips[i].applied) drop.add(i);
  for (let i = 0; i < clips.length && drop.size < over; i++) drop.add(i);
  return clips.filter((_, i) => !drop.has(i));
}

/**
 * The work the index run has produced for entries that still wait: [{ file, id, intents:[tags, title] }].
 * An entry whose work is not in the library yet is left out (it is retried at the next run).
 */
export function pendingWork(clips, works) {
  const byRel = new Map();
  for (const w of Array.isArray(works) ? works : []) if (w && typeof w.rel === 'string' && typeof w.id === 'string') byRel.set(w.rel, w.id);
  const out = [];
  for (const c of clips) {
    if (c.applied) continue;
    const id = byRel.get('imports:' + c.file);
    if (!id) continue;
    out.push({ file: c.file, id, intents: [{ type: 'tags', id, add: c.tags }, { type: 'title', id, title: c.title }] });
  }
  return out;
}

// ---- the manifest on disk ---------------------------------------------------------------------------------------------
function quarantine(fs, target) {
  let to = target + '.corrupt';
  for (let i = 2; fs.existsSync(to) && i < 1000; i++) to = `${target}.corrupt-${i}`;
  if (fs.existsSync(to)) return null;
  try { fs.renameSync(target, to); return to; } catch { return null; }
}

/**
 * -> { clips, status:'ok'|'missing'|'quarantined'|'held' }. A missing file is an empty manifest. A file that does not
 * parse or has the wrong shape is renamed aside (never over an earlier one) and the manifest starts empty; if it cannot be
 * moved aside the answer is 'held' and the caller must not write (an empty document would bury the old one).
 */
export function readManifest(fs, file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { clips: [], status: 'missing' };
    return { clips: [], status: 'held' };
  }
  let value = null;
  try { value = normaliseManifest(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)); } catch { value = null; }
  if (value) return { clips: value.clips, status: 'ok' };
  return quarantine(fs, file) ? { clips: [], status: 'quarantined' } : { clips: [], status: 'held' };
}

/** Atomic: `<file>.<pid>.tmp`, then rename. A rename that throws leaves the old file intact. */
export function writeManifest(fs, file, clips, pid = process.pid) {
  const doc = { v: 1, clips: capClips(clips, MAX_CLIPS) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* the tmp may not exist */ }
    throw e;
  }
}

// ---- the service ------------------------------------------------------------------------------------------------------
const fail = (status, error) => ({ ok: false, status, error });

/**
 * @param {object} o
 * @param {object} o.fs            node:fs (sync API and fs.promises) or a wrapper of it
 * @param {string} o.cosmosDir     <dataDir>/cosmos
 * @param {string} o.importsDir    <dataDir>/cosmos/imports
 * @param {() => Date} [o.now]
 * @param {() => string} o.newId   short random token for temp names
 * @param {() => boolean|Promise<boolean>} o.hasFolder   has the owner indexed a folder yet (importFiles' own precondition)
 * @param {() => Promise<Array<{id:string,rel:string}>>} o.readWorks   the library's works, fresh
 * @param {(intent:object) => Promise<{error?:string}>} o.apply        cosmos.js's own validated curation path
 * @param {() => Promise<void>} [o.reindex]   start (or queue) an index run
 * @param {number} [o.maxBytes]    tests lower it; the default is 64 MB
 */
export function makeClipService({ fs, cosmosDir, importsDir, now = () => new Date(), newId, hasFolder, readWorks, apply, reindex = async () => {}, maxBytes = MAX_CLIP_BYTES, log = () => {} }) {
  const tmpDir = path.join(cosmosDir, TMP_DIR);
  const manifestFile = path.join(cosmosDir, MANIFEST_FILE);

  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(fn);
    chain = p.then(() => {}, () => {});
    return p;
  };

  async function writeAll(fh, buf, n) {
    let off = 0;
    while (off < n) {
      const { bytesWritten } = await fh.write(buf, off, n - off, null);
      if (!(bytesWritten > 0)) throw new Error('short write');
      off += bytesWritten;
    }
  }

  async function addClipInner(a) {
    const abs = a && a.abs;
    const grabRoot = a && a.grabRoot;
    if (typeof abs !== 'string' || abs === '' || abs.length > 1024 || abs.includes('\0') || !path.isAbsolute(abs)) return fail(400, 'That is not a file path.');
    if (typeof grabRoot !== 'string' || grabRoot === '' || !path.isAbsolute(grabRoot)) return fail(503, 'The grab folder is not set up.');

    let folder = false;
    try { folder = !!(await hasFolder()); } catch { folder = false; }
    if (!folder) return fail(409, 'Cosmos has no folder yet');

    // containment: first as text (so a path elsewhere on the disk learns nothing about what exists), then through realpath
    let realRoot;
    try { realRoot = fs.realpathSync(grabRoot); } catch { return fail(404, 'The grab folder does not exist yet.'); }
    if (!isInside(grabRoot, abs) && !isInside(realRoot, abs)) return fail(403, 'That file is not in the grab folder.');
    let real;
    try { real = fs.realpathSync(abs); } catch { return fail(404, 'The file could not be found.'); }
    if (!isInside(realRoot, real)) return fail(403, 'That file is not in the grab folder.');
    const segs = path.relative(realRoot, real).split(path.sep);
    if (segs.length !== 2) return fail(403, 'That file is not in a site folder of the grab folder.');
    const host = segs[0].toLowerCase();
    if (!HOST_RE.test(host)) return fail(403, 'That file is not in a site folder of the grab folder.');
    const leaf = segs[1];
    const fam = extFamily(path.extname(leaf));
    if (!fam) return fail(415, 'Only pictures and videos Cosmos can show are added.');

    // the manifest must be usable BEFORE anything is copied (a corrupt one that cannot be moved aside stops the line)
    const before = readManifest(fs, manifestFile);
    if (before.status === 'held') return fail(503, 'Cosmos could not read its clip notes, so nothing was added.');

    let fh = null;
    let tw = null;
    let tmp = null;
    try {
      try { fh = await fs.promises.open(real, 'r'); } catch { return fail(404, 'The file could not be opened.'); }
      const st = await fh.stat();
      if (!st.isFile()) return fail(400, 'That is not a regular file.');
      if (st.size > maxBytes) return fail(413, 'That file is larger than Cosmos keeps as a clip.');
      const head = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await fh.read(head, 0, SNIFF_BYTES, 0);
      const kind = sniff(head.subarray(0, bytesRead));
      if (!kind) return fail(415, 'Only pictures and videos Cosmos can show are added.');
      if (kind.family !== fam) return fail(415, 'The file is not what its name says it is.');

      fs.mkdirSync(tmpDir, { recursive: true });
      tmp = path.join(tmpDir, `grab-${newId()}.tmp`);
      tw = await fs.promises.open(tmp, 'wx');
      const hash = createHash('sha256');
      const buf = Buffer.allocUnsafe(CHUNK);
      let total = 0;
      for (;;) {
        const { bytesRead: n } = await fh.read(buf, 0, CHUNK, total);
        if (n === 0) break;
        total += n;
        if (total > maxBytes) return fail(413, 'That file is larger than Cosmos keeps as a clip.');
        hash.update(buf.subarray(0, n));
        await writeAll(tw, buf, n);
      }
      if (total !== st.size) return fail(422, 'The file changed while it was being copied.');
      await tw.close();
      tw = null;

      const name = `clip-${hash.digest('hex').slice(0, 12)}${kind.ext}`;
      const dest = path.join(importsDir, name);
      fs.mkdirSync(importsDir, { recursive: true });
      let duplicate = false;
      try {
        await fs.promises.link(tmp, dest);
      } catch (e) {
        if (e && e.code === 'EEXIST') duplicate = true;
        else if (fs.existsSync(dest)) duplicate = true;
        else await fs.promises.rename(tmp, dest);   // a file system without hard links: the name was free a moment ago
      }
      try { await fs.promises.unlink(tmp); } catch { /* already renamed away or gone */ }
      tmp = null;

      // provenance
      const doc = readManifest(fs, manifestFile);
      let entry = doc.clips.find((c) => c.file === name) || null;
      let noted = true;
      let changed = false;
      if (!duplicate) {
        const rec = clipRecord({ file: name, host, pageUrl: a.pageUrl, pageTitle: a.pageTitle, leaf, mime: kind.mime, at: now().toISOString() });
        const rest = doc.clips.filter((c) => c.file !== name);
        rest.push(rec);
        doc.clips = rest;
        entry = rec;
        changed = true;
      } else if (!entry && doc.status !== 'held') {
        // the file landed earlier but its note never did (a crash between the two): repair it once
        entry = clipRecord({ file: name, host, pageUrl: a.pageUrl, pageTitle: a.pageTitle, leaf, mime: kind.mime, at: now().toISOString() });
        doc.clips.push(entry);
        changed = true;
      }
      if (changed) {
        try { writeManifest(fs, manifestFile, doc.clips); } catch (e) { noted = false; log('clips: manifest not saved: ' + errText(e)); }
      }
      if (!duplicate || (entry && !entry.applied)) {
        try { await reindex(); } catch (e) { log('clips: could not start an index run: ' + errText(e)); }
      }
      return { ok: true, status: 200, duplicate, indexed: !!(entry && entry.applied), file: name, noted };
    } catch (e) {
      log('clips: ' + errText(e));
      return fail(500, 'Cosmos could not add that file.');
    } finally {
      if (tw) { try { await tw.close(); } catch { /* closing */ } }
      if (fh) { try { await fh.close(); } catch { /* closing */ } }
      if (tmp) { try { await fs.promises.unlink(tmp); } catch { /* never created or already gone */ } }
    }
  }

  /** The route's one call: { abs, grabRoot, pageUrl?, pageTitle? } -> { ok:true, duplicate, indexed } | { ok:false, status, error }. */
  function addClip(a) {
    return serial(() => addClipInner(a || {}));
  }

  /** After an index run: apply tags and title for entries whose work now exists; the rest wait for the next run. */
  function afterIndex() {
    return serial(async () => {
      const doc = readManifest(fs, manifestFile);
      if (doc.status === 'held') return { applied: 0, waiting: 0 };
      const waiting = doc.clips.filter((c) => !c.applied);
      if (waiting.length === 0) return { applied: 0, waiting: 0 };
      let works;
      try { works = await readWorks(); } catch { return { applied: 0, waiting: waiting.length }; }
      let applied = 0;
      for (const job of pendingWork(doc.clips, works)) {
        let ok = true;
        for (const intent of job.intents) {
          let r;
          try { r = await apply(intent); } catch { r = { error: 'failed' }; }
          if (!r || r.error) { ok = false; break; }
        }
        if (ok) {
          const e = doc.clips.find((c) => c.file === job.file);
          if (e) { e.applied = true; applied += 1; }
        }
      }
      if (applied > 0) {
        try { writeManifest(fs, manifestFile, doc.clips); } catch (e) { log('clips: manifest not saved: ' + errText(e)); return { applied: 0, waiting: waiting.length }; }
      }
      return { applied, waiting: waiting.length - applied };
    });
  }

  /** Startup: temp files in .grab-tmp older than an hour are orphans of a crashed copy. -> how many were removed. */
  async function sweepTmp() {
    let removed = 0;
    let names;
    try { names = fs.readdirSync(tmpDir); } catch { return 0; }
    const t = now().getTime();
    for (const name of names) {
      if (!TMP_RE.test(name)) continue;
      const f = path.join(tmpDir, name);
      try {
        const st = fs.statSync(f);
        if (st.isFile() && t - st.mtimeMs > TMP_MAX_AGE_MS) { fs.unlinkSync(f); removed += 1; }
      } catch { /* gone already */ }
    }
    return removed;
  }

  return { addClip, afterIndex, sweepTmp, tmpDir, manifestFile };
}
