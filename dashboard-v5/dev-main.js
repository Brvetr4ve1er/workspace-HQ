// WorkspaceHQ v3 (Claude Design build) dev harness — runs BESIDE the live app:
// no single-instance lock, no tray, no global shortcuts, its own userData.
// Launch:  ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js
//   --state=empty --tab=projects --theme=light   forwarded as query params
//   --preload=v2                                 use the real app preload (no IPC handlers here: calls reject)
//   --preload=fake                               tools/fake-preload.js, a recording fake of window.hq
//   --hidden                                     no window (drive it over CDP); background throttling off
//   --remote-debugging-port=9342                 CDP for tools/cdp-gate.mjs
//   --selftest                                   load ?selftest=1; exit 0 clean · 1 broken · 2 timed out (180 s)
// Env HQ_V5_PROFILE names the throwaway userData folder (give concurrent runs their own).
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

const argv = process.argv;
const opt = (k) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const SELFTEST = argv.includes('--selftest'), HIDDEN = argv.includes('--hidden');
const PRELOADS = { v2: path.join(__dirname, '..', 'dashboard', 'preload.js'), fake: path.join(__dirname, 'tools', 'fake-preload.js') };
const SELFTEST_MS = 180000;

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V5_PROFILE || 'hq-v5-dev-profile'));
// Chromium reads this switch from argv too; appending makes it independent of argument order
const port = opt('remote-debugging-port');
if (port && /^\d{2,5}$/.test(port)) app.commandLine.appendSwitch('remote-debugging-port', port);

// --selftest verdict. The page's own line carries {combos, errors, unresolved,
// failures}; on top of that any error-level console message (boot-time errors
// before selftest.js loads, CSP or resource failures) fails the run.
let finished = false;
const pageErrors = [];
function finish(code, line) {
  if (finished) return;
  finished = true;
  const exit = () => app.exit(code);
  process.stdout.write(line + '\n', exit);
  setTimeout(exit, 1500);   // in case the write callback never fires
}
function verdict(msg) {
  let r;
  try { r = JSON.parse(msg.slice('[selftest] '.length)); } catch { return finish(1, '[selftest] unreadable result: ' + msg); }
  const clean = r.errors === 0 && r.unresolved === 0 && r.failures === 0 && pageErrors.length === 0;
  const extra = pageErrors.length ? '\n[selftest] ' + pageErrors.length + ' error-level console message(s):\n  ' + pageErrors.slice(0, 10).join('\n  ') : '';
  finish(clean ? 0 : 1, msg + extra + '\n[selftest] ' + (clean ? 'PASS' : 'FAIL'));
}

function create() {
  const pre = opt('preload');
  if (pre && !PRELOADS[pre]) console.warn('[dev] unknown --preload=' + pre + ' (v2 | fake); running without a preload');
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#0d0d0f', title: 'WorkspaceHQ (dev)', show: !HIDDEN,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      // timers stay at full speed in a hidden window (it still gets only ~1 animation
      // frame a second, which no switch changes; the selftest doesn't wait on rAF alone)
      backgroundThrottling: !(HIDDEN || SELFTEST),
      preload: PRELOADS[pre] || undefined,
    },
  });
  // Electron 32 passes (event, level, message); newer versions put them on the event
  win.webContents.on('console-message', (ev, level, message) => {
    const msg = typeof message === 'string' ? message : String((ev && ev.message) || '');
    const lvl = typeof level === 'number' ? level : { debug: 0, info: 1, warning: 2, error: 3 }[ev && ev.level];
    console.log('[v5]', msg);
    if (!SELFTEST || finished) return;
    if (lvl === 3) pageErrors.push(msg.slice(0, 300));
    if (msg.startsWith('[selftest] ')) verdict(msg);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    console.log('[v5] preload failed:', p, err && err.message);
    if (SELFTEST) pageErrors.push('preload failed: ' + (err && err.message));
  });
  if (SELFTEST) {
    setTimeout(() => finish(2, '[selftest] timed out after ' + SELFTEST_MS / 1000 + ' s'), SELFTEST_MS);
    win.webContents.on('render-process-gone', (_e, d) => finish(1, '[selftest] renderer gone: ' + (d && d.reason)));
    win.webContents.on('did-fail-load', (_e, code, desc) => finish(1, '[selftest] page failed to load: ' + code + ' ' + desc));
    win.on('closed', () => finish(1, '[selftest] window closed before the result'));
  }
  const query = {};
  for (const a of argv) {
    const m = a.match(/^--(state|tab|theme|pet)=(.+)$/);
    if (m) query[m[1]] = m[2];
  }
  if (SELFTEST) query.selftest = '1';
  win.loadFile(path.join(__dirname, 'index.html'), Object.keys(query).length ? { query } : undefined);
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
