/* Cosmos space — the path rules (spec §5, normative). This is the security surface of the space: the
   renderer is untrusted input, so every file the main process touches on its behalf goes through here.

   - A relative path ("rel") is the library's own bookkeeping string. It is checked as TEXT first
     (checkRel: no absolute, no drive, no UNC, no parent segment, no ':' except the one `imports:` prefix),
     then joined onto a root, then BOTH sides go through realpath() and containment is decided from
     path.relative() — never from a bare startsWith, so `C:/root-evil` is not inside `C:/root`.
   - A rel that begins `imports:` resolves ONLY into the imports folder, and what follows must be a plain
     file name. A `retired:<id>` reservation in the id map can never resolve (it has a colon).
   - Nothing here decodes a URL. The one decode in the whole space lives in ids.mjs (relFromSrc).
   - fileUrl() is the only URL builder: url.pathToFileURL(abs).href.

   Pure apart from the injected `realpath` / `existsSync`; no fs import, no clock. */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const IMPORTS_PREFIX = 'imports:';
export const MAX_REL_LENGTH = 1024;

const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN_CHARS = /[<>"|?*\u0000-\u001f]/;

function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** A segment Windows would treat as a device, so it never names a real file. */
function isDeviceName(seg) {
  return RESERVED_DEVICE.test(seg.split('.')[0].trim());
}

/** True for '.', '..', '...', ' ' and anything else made only of dots and spaces. */
function isDotSegment(seg) {
  return seg.replace(/[. ]+$/, '') === '';
}

/**
 * Check a rel as text. Returns { imp:false, segs:[…] } for a library file, { imp:true, name } for an
 * imported file, or { error } with a sentence for the owner.
 */
export function checkRel(rel) {
  if (typeof rel !== 'string' || rel === '') return { error: 'That element has no file path.' };
  if (rel.length > MAX_REL_LENGTH) return { error: 'That file path is too long.' };
  if (rel.includes('\0')) return { error: 'That file path is not valid.' };
  let imp = false;
  let body = rel;
  if (rel.startsWith(IMPORTS_PREFIX)) { imp = true; body = rel.slice(IMPORTS_PREFIX.length); }
  if (body.includes(':')) return { error: 'That file path is not valid.' };
  if (FORBIDDEN_CHARS.test(body)) return { error: 'That file path is not valid.' };
  if (imp) {
    if (body === '' || /[\\/]/.test(body) || isDotSegment(body) || /[. ]$/.test(body) || isDeviceName(body)) {
      return { error: 'That file path is not valid.' };
    }
    return { imp: true, name: body };
  }
  if (body.startsWith('/') || body.startsWith('\\')) return { error: 'That file path is not valid.' };
  const segs = body.split(/[\\/]/);
  for (const seg of segs) {
    if (seg === '' || isDotSegment(seg) || /[. ]$/.test(seg) || isDeviceName(seg)) {
      return { error: 'That file path is not valid.' };
    }
  }
  return { imp: false, segs };
}

/** Is `target` strictly inside `base`? Case-insensitive on win32; decided from path.relative(). */
export function isInside(base, target, platform = process.platform) {
  const P = pathFor(platform);
  let a = base;
  let b = target;
  if (platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase(); }
  const r = P.relative(a, b);
  if (r === '' || P.isAbsolute(r)) return false;
  return !(r === '..' || r.startsWith('..' + P.sep));
}

/**
 * Turn a rel into an absolute file path that is certain to be inside its folder.
 * `realpath` is injected (fs.realpathSync in main, a fake in tests) and must throw when the path is missing.
 * @returns {{abs:string}|{error:string}}
 */
export function resolveWork({ root, importsDir, rel, realpath, platform = process.platform }) {
  const c = checkRel(rel);
  if (c.error) return { error: c.error };
  if (typeof realpath !== 'function') return { error: 'The file could not be checked.' };
  const base = c.imp ? importsDir : root;
  if (typeof base !== 'string' || base === '') {
    return { error: c.imp ? 'The imports folder is not available.' : 'No folder has been indexed yet.' };
  }
  const P = pathFor(platform);
  const target = c.imp ? P.join(base, c.name) : P.join(base, ...c.segs);
  let realBase;
  let realTarget;
  try { realBase = realpath(base); } catch { return { error: 'The library folder cannot be reached right now.' }; }
  try { realTarget = realpath(target); } catch { return { error: 'That file is no longer there.' }; }
  if (typeof realBase !== 'string' || typeof realTarget !== 'string') return { error: 'The file could not be checked.' };
  if (!isInside(realBase, realTarget, platform)) return { error: 'That file is outside the library folder.' };
  return { abs: realTarget };
}

/** A safe file name from whatever a drop supplied: no path parts, no reserved names, no trailing dots. */
export function sanitizeFileName(srcName) {
  let n = typeof srcName === 'string' ? srcName : '';
  n = n.split(/[\\/]/).pop() || '';
  n = n.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\s+/, '').replace(/[. ]+$/, '');
  const dot = n.lastIndexOf('.');
  let stem = dot > 0 ? n.slice(0, dot) : n;
  let ext = dot > 0 ? n.slice(dot) : '';
  if (ext.length > 16) { stem = n; ext = ''; }
  stem = stem.replace(/[. ]+$/, '');
  if (isDeviceName(stem)) stem = '_' + stem;
  stem = stem.slice(0, Math.max(1, 120 - ext.length));
  if (stem === '' || isDotSegment(stem)) stem = 'file';
  return stem + ext;
}

/**
 * Where an imported file will be copied: `<importsDir>/<name>`, de-duplicated as `name (2).ext` against
 * `existsSync`. The destination is computed entirely here; the renderer supplies nothing but the source.
 * @returns {{abs:string, name:string}}
 */
export function importDestination(importsDir, srcName, existsSync, platform = process.platform) {
  const P = pathFor(platform);
  const clean = sanitizeFileName(srcName);
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let name = clean;
  for (let i = 2; i < 10000; i++) {
    const abs = P.join(importsDir, name);
    if (!existsSync(abs)) return { abs, name };
    name = `${stem} (${i})${ext}`;
  }
  throw new Error('too many files with the same name');
}

/** The only URL builder. */
export function fileUrl(abs) {
  return pathToFileURL(abs).href;
}
