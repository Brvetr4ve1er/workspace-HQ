// WorkspaceHQ v3 (Claude Design build) dev harness — runs BESIDE the live app:
// no single-instance lock, no tray, no global shortcuts, its own userData.
// Launch:  ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js
//   --state=empty --tab=projects --theme=light   forwarded as query params
//   --preload=v2                                 use the real app preload
//   --hidden                                     no window (drive it over CDP)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V5_PROFILE || 'hq-v5-dev-profile'));

function create() {
  const hidden = process.argv.includes('--hidden');
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#0d0d0f', title: 'WorkspaceHQ (dev)', show: !hidden,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: process.argv.includes('--preload=v2') ? path.join(__dirname, '..', 'dashboard', 'preload.js') : undefined,
    },
  });
  win.webContents.on('console-message', (_e, _level, msg) => console.log('[v5]', msg));
  const query = {};
  for (const a of process.argv) {
    const m = a.match(/^--(state|tab|theme|pet)=(.+)$/);
    if (m) query[m[1]] = m[2];
  }
  win.loadFile(path.join(__dirname, 'index.html'), Object.keys(query).length ? { query } : undefined);
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
