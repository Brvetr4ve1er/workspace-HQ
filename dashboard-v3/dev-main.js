// NEXUS v3 dev harness — runs BESIDE the live v2 app with zero collisions:
// no single-instance lock, no tray, no global shortcuts, no bridge server,
// and its own scratch userData so Chromium profile locks never clash.
// Launch:  ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), 'hq-v3-dev-profile'));

function create() {
  const win = new BrowserWindow({
    width: 1280, height: 860, backgroundColor: '#07060f', title: 'NEXUS v3 (dev)',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  // pipe renderer console to stdout so spikes/parity checks are scriptable
  win.webContents.on('console-message', (_e, _level, msg) => console.log('[v3]', msg));
  // --smoke: load, let the renderer log, then exit — lets spike/parity runs
  // verify from a script without leaving a window behind
  if (process.argv.includes('--smoke')) {
    win.webContents.on('did-finish-load', () => setTimeout(() => app.quit(), 1500));
  }
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
