// Claude Hub H4 — claude.ai export import, main side (spec 2026-10-13 §5.2, §7). New file, one hook line in main.js.
// The dialog runs here; the Hub (system Node) unzips and imports. Only the file's basename goes back to the renderer.
const path = require('path');
const bridgeRoutes = require('./claude-bridge-routes');

function registerImport(ipcMain, host, { pickZip }) {
  ipcMain.handle('hq:claude-hub:import', async () => {
    let file;
    try { file = await pickZip(); } catch { return { error: 'could not open the file dialog' }; }
    if (!file) return { canceled: true };
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.zip$/i.test(file)) return { error: 'pick a .zip file' };
    const r = await host.request('importExport', { zipPath: file });
    if (r && typeof r.error === 'string') return { error: r.error };
    return { started: true, file: path.basename(file) };
  });
}

function dialogPicker(getWin) {
  return async () => {
    const { dialog } = require('electron');
    const opts = { title: 'Import claude.ai export', properties: ['openFile'], filters: [{ name: 'claude.ai export (.zip)', extensions: ['zip'] }] };
    const win = getWin && getWin();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r && !r.canceled && r.filePaths && r.filePaths[0] ? r.filePaths[0] : null;
  };
}

function init({ ipcMain, host, getWin }) {
  const gateZip = process.env.HQ_CLAUDE_IMPORT_ZIP;   // gates only: no dialog in a hidden second instance
  registerImport(ipcMain, host, { pickZip: gateZip ? async () => gateZip : dialogPicker(getWin) });
  bridgeRoutes.setHub(host);
  return { registered: true };
}

module.exports = { registerImport, init };
