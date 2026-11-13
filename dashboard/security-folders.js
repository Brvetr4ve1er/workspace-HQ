// Security space: which folders the plain-export name scan looks in. Batch 5 "Security honesty pass".
//
// WHY: the scan used to build ['Downloads','Desktop','Documents'] under the home folder by spelling. A Desktop or Documents folder that
// Windows (OneDrive "known folder move", a registry redirect) keeps elsewhere was never looked at, so "none found" could be wrong.
// Electron's app.getPath('downloads' | 'desktop' | 'documents') answers with the folder the OS actually uses; both spellings are scanned.
//
// resolveScanDirs({ env, getPath, home, platform }) -> { dirs: string[], looked: string[], redirected: number }
//   env      defaults to process.env. HQ_SECURITY_SCAN_DIRS (a path-delimiter list) wins exactly as before (gates): dirs = that list,
//            redirected = 0.
//   getPath  (name) => absolute path. Defaults to a lazy require('electron').app.getPath; outside Electron `.app` is undefined, the call
//            throws and the answer is ignored. Any throwing, empty, non-string or non-absolute answer is ignored (that folder is then
//            scanned by its home spelling only). Names are NEVER guessed: no 'OneDrive', no registry reads.
//   home     defaults to os.homedir().       platform defaults to process.platform (win32 compares case-insensitively).
//   looked   the three LABELS (never a path): what the Health line shows.
//   redirected  how many known-folder answers differ from the home spelling of the same folder.
// Top level only, by name only: the file scan (security-vault scanExportsIn) is untouched; this module only decides WHERE.
'use strict';
const os = require('node:os');
const path = require('node:path');

const FOLDERS = Object.freeze([['downloads', 'Downloads'], ['desktop', 'Desktop'], ['documents', 'Documents']]);
const LOOKED = Object.freeze(FOLDERS.map(([, label]) => label));

function defaultGetPath(name) {
  // lazy: this file is also loaded by plain node tests and the cdp tooling, where there is no Electron app
  return require('electron').app.getPath(name);
}

function resolveScanDirs({ env, getPath, home, platform } = {}) {
  const e = env || process.env;
  if (e.HQ_SECURITY_SCAN_DIRS) {
    return { dirs: String(e.HQ_SECURITY_SCAN_DIRS).split(path.delimiter).filter(Boolean), looked: [...LOOKED], redirected: 0 };   // gates
  }
  const plat = platform || process.platform;
  const P = plat === 'win32' ? path.win32 : path.posix;
  const ask = typeof getPath === 'function' ? getPath : defaultGetPath;
  const homeDir = typeof home === 'string' ? home : os.homedir();
  const keyOf = (p) => (plat === 'win32' ? p.toLowerCase() : p);
  const clean = (v) => (typeof v === 'string' && v.trim() && P.isAbsolute(v.trim()) ? P.resolve(v.trim()) : null);

  const dirs = [];
  const seen = new Set();
  const add = (p) => { if (!p || seen.has(keyOf(p))) return; seen.add(keyOf(p)); dirs.push(p); };
  let redirected = 0;

  for (const [name, label] of FOLDERS) {
    let known = null;
    try { known = clean(ask(name)); } catch { known = null; }   // never blocks the scan
    const home1 = typeof homeDir === 'string' && homeDir && P.isAbsolute(homeDir) ? P.resolve(P.join(homeDir, label)) : null;
    if (known && home1 && keyOf(known) !== keyOf(home1)) redirected += 1;
    add(known);
    add(home1);
  }
  return { dirs, looked: [...LOOKED], redirected };
}

module.exports = { resolveScanDirs, LOOKED, FOLDERS };
