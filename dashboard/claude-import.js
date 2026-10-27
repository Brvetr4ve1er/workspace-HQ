// Claude Hub H4 — claude.ai export import, main side (spec 2026-10-13 §5.2, §7). New file, one hook line in main.js.
// The dialog runs here; the Hub (system Node) unzips and imports. Only the file's basename goes back to the renderer.
const path = require('path');
const bridgeRoutes = require('./claude-bridge-routes');

const imports = require('./claude-imports');
const KINDS = ['auto', 'claude', 'chatgpt', 'instagram', 'facebook', 'meta'];   // meta = Instagram or Facebook
const META = ['instagram', 'facebook'];
const LABEL = { claude: 'claude.ai', chatgpt: 'ChatGPT', instagram: 'Instagram', facebook: 'Facebook', meta: 'Instagram or Facebook' };
const opFor = (use, zipPath) => (use === 'chatgpt' ? ['importChatGPT', { zipPath }] : META.includes(use) ? ['importMeta', { zipPath, expect: use }] : ['importExport', { zipPath }]);

function registerImport(ipcMain, host, { pickZip, readNames = imports.readEntryNames, getWatcher = imports.current }) {
  ipcMain.handle('hq:claude-hub:import', async (_e, kind, opts) => {
    const k = kind === undefined || kind === null ? 'claude' : kind;   // no kind = H4, unchanged
    if (!KINDS.includes(k)) return { error: 'unknown import kind' };
    const dropId = opts && typeof opts === 'object' && typeof opts.dropId === 'string' ? opts.dropId : null;
    let file, detected = null, key = null;
    if (dropId) {
      const w = getWatcher(), d = w && w.take(dropId);
      if (!d) return { error: 'that dropped file is gone or was already handled' };
      ({ file, kind: detected, key } = d);
    } else {
      try { file = await pickZip(k); } catch { return { error: 'could not open the file dialog' }; }
      if (!file) return { canceled: true };
      if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.zip$/i.test(file)) return { error: 'pick a .zip file' };
    }
    let use = k;
    // An explicit kind (the v5 buttons, a drop) is checked against the ZIP's entry names, so a claude.ai ZIP picked under
    // "Import ChatGPT export" (or the reverse) is refused here with both names instead of "succeeding" with every row
    // skipped (IPC-CONTRACT H6 row). No kind at all = the H4 call, unchanged (no extra read).
    const explicit = kind !== undefined && kind !== null;
    if (explicit || dropId) {
      if (!detected) {
        let names; try { names = await readNames(file); } catch (e) { return { error: 'could not read that ZIP: ' + String((e && e.message) || e).slice(0, 120) }; }
        const d = imports.detectExportKind(names);
        if (!d.kind) return { error: d.reason };
        detected = d.kind;
      }
      if (k !== 'auto' && k !== detected && !(k === 'meta' && META.includes(detected))) return { error: 'That is a ' + LABEL[detected] + ' export, not ' + (/^[AEIOU]/.test(LABEL[k]) ? 'an ' : 'a ') + LABEL[k] + ' export' };
      use = detected;
    }
    const r = await host.request(...opFor(use, file));
    if (r && typeof r.error === 'string') return { error: r.error };
    if (key) { const w = getWatcher(); if (w) w.markImported(key); }
    return { started: true, file: path.basename(file), kind: use };
  });
}

function dialogPicker(getWin) {
  return async (kind) => {
    const { dialog } = require('electron');
    const what = kind === 'auto' ? 'ChatGPT or claude.ai export' : (LABEL[kind] || 'claude.ai') + ' export';
    const opts = { title: 'Import ' + what, properties: ['openFile'], filters: [{ name: what + ' (.zip)', extensions: ['zip'] }] };
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
