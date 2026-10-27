// Save stat card PNG (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card).
// hq:stat-card-save(dataUrl) → {ok, path} | {ok:false, canceled:true} | {error}
//   The renderer draws the card; main only checks it is a PNG, picks the path (save dialog, or HQ_STAT_CARD_PATH for
//   gates) and writes it. The renderer never names a path.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'data:image/png;base64,';
const MAX_BYTES = 8 * 1024 * 1024;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return { error: 'not a PNG' };
  if (dataUrl.length - PREFIX.length > Math.ceil(MAX_BYTES / 3) * 4) return { error: 'too big' };
  const buf = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
  if (buf.length > MAX_BYTES) return { error: 'too big' };
  if (buf.length < PNG_SIG.length || !buf.subarray(0, PNG_SIG.length).equals(PNG_SIG)) return { error: 'not a PNG' };
  return { buf };
}

const defaultName = (d = new Date()) => 'stat-card-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.png';

function createStatCardSave({ pick, env = {} }) {
  return async function statCardSave(dataUrl) {
    const png = decodePng(dataUrl);
    if (png.error) return png;
    const file = env.HQ_STAT_CARD_PATH || await pick(defaultName());
    if (!file) return { ok: false, canceled: true };
    try { fs.writeFileSync(file, png.buf); } catch (e) { return { error: 'write failed: ' + String((e && e.message) || e).slice(0, 200) }; }
    return { ok: true, path: file };
  };
}

function init({ ipcMain, app, dialog, getWin }) {
  const save = createStatCardSave({
    env: process.env,
    pick: async (name) => {
      let w = null; try { w = getWin ? getWin() : null; } catch { w = null; }
      const opts = { title: 'Save the stat card', defaultPath: path.join(app.getPath('pictures'), name), filters: [{ name: 'PNG image', extensions: ['png'] }] };
      const r = await (w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts));
      return r && !r.canceled && r.filePath ? r.filePath : null;
    },
  });
  ipcMain.handle('hq:stat-card-save', (_e, dataUrl) => save(dataUrl));
  return save;
}

module.exports = { decodePng, defaultName, createStatCardSave, init };
