/* Cosmos space — the folder walk: which files does the library hold, newest first.

   All IO is injected (io.readdir, io.stat), so this module is plain Node-testable. The rules are the
   security and sanity surface of the indexer:
     - only picture/video extensions (IMAGE_EXT ∪ VIDEO_EXT from ./infer.mjs, compared lower-cased);
     - directories named _clips, node_modules, .git, .obsidian, .trash, .thumbnails, $RECYCLE.BIN and
       System Volume Information are never entered (exact name, any letter case);
     - symlinks and junctions are NEVER followed (an entry with isSymlink is skipped, file or directory), so
       the walk cannot leave its root. The caller builds readdir entries from Dirent (see entryFromDirent):
       libuv reports a Windows junction as a symbolic link too;
     - depth cap 32 and file cap 200,000: past either the walk stops descending/collecting and says
       `truncated: true`; it never crashes;
     - an unreadable directory or file is counted in `unreadable`, never thrown;
     - rel is always '/'-separated; each root has a prefix ('' for the pictures folder, 'imports:' for
       data/cosmos/imports, so an import is `imports:<file name>`);
     - result sorted NEWEST FIRST by mtimeMs, ties by lower-cased rel;
     - `await yieldNow()` every 200 directory entries so the main process stays responsive;
       isCancelled() is checked before every directory and a cancelled walk returns { cancelled: true }.

   Result: { files: [{ rel, abs, ext, size, mtimeMs, createdMs, kind: 'image'|'video' }],
             skippedDirs, skippedLinks, unreadable, truncated }   (the three counts are numbers)
   Pure apart from the injected io: no fs, no clock. */

import { IMAGE_EXT, VIDEO_EXT } from './infer.mjs';

export const SKIP_DIR_NAMES = Object.freeze([
  '_clips', 'node_modules', '.git', '.obsidian', '.trash', '.thumbnails', '$RECYCLE.BIN', 'System Volume Information',
]);
const SKIP = new Set(SKIP_DIR_NAMES.map((n) => n.toLowerCase()));

export const WALK_LIMITS = Object.freeze({ maxDepth: 32, maxFiles: 200000, yieldEvery: 200 });

/** A readdir entry from an fs.Dirent (fs.readdir with withFileTypes). */
export function entryFromDirent(d) {
  return { name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink() };
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

function joinAbs(dir, name) {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir + sep + name;
}

const byLowerName = (a, b) => {
  const x = String(a.name).toLowerCase();
  const y = String(b.name).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * @param {{ roots: {prefix:string, dir:string}[], io: {readdir:Function, stat:Function},
 *   isCancelled?: ()=>boolean, yieldNow?: ()=>Promise<void>,
 *   limits?: {maxDepth?:number, maxFiles?:number, yieldEvery?:number},
 *   onProgress?: (p:{found:number})=>void }} args
 */
export async function walk({ roots, io, isCancelled = () => false, yieldNow = async () => {}, limits = {}, onProgress }) {
  const maxDepth = Number.isFinite(limits.maxDepth) ? limits.maxDepth : WALK_LIMITS.maxDepth;
  const maxFiles = Number.isFinite(limits.maxFiles) ? limits.maxFiles : WALK_LIMITS.maxFiles;
  const yieldEvery = Number.isFinite(limits.yieldEvery) && limits.yieldEvery > 0 ? limits.yieldEvery : WALK_LIMITS.yieldEvery;

  const files = [];
  let skippedDirs = 0;
  let skippedLinks = 0;
  let unreadable = 0;
  let truncated = false;
  let seen = 0;

  outer:
  for (const root of roots) {
    const prefix = root.prefix || '';
    const stack = [{ dir: root.dir, relDir: '', depth: 0 }];
    while (stack.length) {
      if (isCancelled()) return { cancelled: true };
      const cur = stack.pop();
      let list;
      try {
        list = await io.readdir(cur.dir);
      } catch {
        unreadable += 1;
        continue;
      }
      if (!Array.isArray(list)) { unreadable += 1; continue; }
      const sorted = list.filter((e) => e && typeof e.name === 'string' && e.name !== '').sort(byLowerName);
      const subdirs = [];
      for (const e of sorted) {
        seen += 1;
        if (seen % yieldEvery === 0) {
          await yieldNow();
          if (onProgress) onProgress({ found: files.length });
        }
        if (e.isSymlink) { skippedLinks += 1; continue; }
        const name = e.name.replace(/\\/g, '/');
        if (e.isDir) {
          if (SKIP.has(name.toLowerCase())) { skippedDirs += 1; continue; }
          if (cur.depth + 1 > maxDepth) { truncated = true; continue; }
          subdirs.push({ dir: joinAbs(cur.dir, e.name), relDir: cur.relDir ? `${cur.relDir}/${name}` : name, depth: cur.depth + 1 });
          continue;
        }
        if (!e.isFile) continue;
        const ext = extOf(name);
        const isImage = IMAGE_EXT.has(ext);
        if (!isImage && !VIDEO_EXT.has(ext)) continue;
        if (files.length >= maxFiles) { truncated = true; break outer; }
        const abs = joinAbs(cur.dir, e.name);
        let st;
        try {
          st = await io.stat(abs);
        } catch {
          unreadable += 1;
          continue;
        }
        if (!st || !Number.isFinite(st.size) || !Number.isFinite(st.mtimeMs)) { unreadable += 1; continue; }
        const born = Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
        files.push({
          rel: prefix + (cur.relDir ? `${cur.relDir}/${name}` : name),
          abs,
          ext,
          size: st.size,
          mtimeMs: st.mtimeMs,
          createdMs: born,
          kind: isImage ? 'image' : 'video',
        });
      }
      // DFS in name order: push in reverse so the smallest name is popped first
      for (let i = subdirs.length - 1; i >= 0; i -= 1) stack.push(subdirs[i]);
    }
  }

  const lower = new Map(files.map((f) => [f, f.rel.toLowerCase()]));
  files.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (lower.get(a) < lower.get(b) ? -1 : lower.get(a) > lower.get(b) ? 1 : 0));
  return { files, skippedDirs, skippedLinks, unreadable, truncated };
}
