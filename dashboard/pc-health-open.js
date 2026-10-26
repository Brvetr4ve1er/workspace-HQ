// System › Machine "Open in Explorer" for the disk breakdown (IPC-CONTRACT 2026-10-26 PC health).
// hq:pc-open-folder(path) → true | { error }
// Same trust model as hq:health-fix: the renderer cannot open an arbitrary path. Only a folder
// listed verbatim in the CURRENT data/pc-health.json detail.hogs.items, that still exists as a
// directory (not a link out of it), is opened — with shell.openPath, which never runs anything.
const fs = require('node:fs');
const path = require('node:path');

function listedFolders(pcHealth) {
  const items = pcHealth && pcHealth.detail && pcHealth.detail.hogs && Array.isArray(pcHealth.detail.hogs.items) ? pcHealth.detail.hogs.items : [];
  return new Set(items.map((h) => h && typeof h.path === 'string' ? h.path : null).filter(Boolean));
}

function createOpener({ readPcHealth, openPath, statSync = fs.statSync, lstatSync = fs.lstatSync }) {
  return async function openFolder(p) {
    if (typeof p !== 'string' || !p || p.length > 1024) return { error: 'not a folder path' };
    if (!listedFolders(readPcHealth()).has(p)) return { error: 'refused: that folder is not in the current disk breakdown' };
    if (!path.isAbsolute(p)) return { error: 'refused: not an absolute path' };
    try {
      if (lstatSync(p).isSymbolicLink()) return { error: 'refused: that folder is a link' };
      if (!statSync(p).isDirectory()) return { error: 'that is not a folder any more' };
    } catch { return { error: 'that folder no longer exists — Re-examine to refresh the list' }; }
    const r = await openPath(p);
    return r ? { error: String(r) } : true; // shell.openPath answers '' on success, an error string otherwise
  };
}

function init({ ipcMain, shell, dataDir }) {
  const file = path.join(dataDir, 'pc-health.json');
  const readPcHealth = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const open = createOpener({ readPcHealth, openPath: (p) => shell.openPath(p) });
  ipcMain.handle('hq:pc-open-folder', (_e, p) => open(p));
  return { open };
}

module.exports = { init, createOpener, listedFolders };
