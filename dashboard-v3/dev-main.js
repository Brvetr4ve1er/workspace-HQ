// NEXUS v3 dev harness — runs BESIDE the live v2 app with zero collisions:
// no single-instance lock, no tray, no global shortcuts, no bridge server,
// and its own scratch userData so Chromium profile locks never clash.
// Launch:  ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

// HQ_V3_PROFILE lets concurrent harness runs (parity shots, agent verifies)
// use separate Chromium profiles instead of colliding on one lock
app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V3_PROFILE || 'hq-v3-dev-profile'));

function create() {
  const win = new BrowserWindow({
    width: 1280, height: 860, backgroundColor: '#07060f', title: 'NEXUS v3 (dev)',
    // HQ_V3_PRELOAD=v2 loads the REAL app preload instead of the dev stub —
    // proves the swap surface (v3 html + v2 preload) before flipping the flag
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, process.env.HQ_V3_PRELOAD === 'v2' ? '..\\dashboard\\preload.js' : 'preload.js') },
  });
  // pipe renderer console to stdout so spikes/parity checks are scriptable
  win.webContents.on('console-message', (_e, _level, msg) => console.log('[v3]', msg));
  // --smoke: load, let the renderer log, then exit — lets spike/parity runs
  // verify from a script without leaving a window behind
  if (process.argv.includes('--smoke')) {
    win.webContents.on('did-finish-load', () => setTimeout(() => app.quit(), 1500));
  }
  // --selftest rides into the renderer as a query param (no preload needed)
  const query = process.argv.includes('--selftest') ? { selftest: '1' } : undefined;
  win.loadFile(path.join(__dirname, 'index.html'), query ? { query } : undefined);
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
