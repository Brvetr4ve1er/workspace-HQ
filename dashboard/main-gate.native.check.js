'use strict';
/* The main-window gate, checked in a real Electron (dashboard/main-gate.native.check.js), run by `node tools/gates.mjs --native` (step main-gate-native).

   main-gate.test.mjs and dev-command.test.mjs prove fromMain() with fake events. Only a real Electron can say that the REAL
   event.sender, event.senderFrame and webContents.mainFrame compare the way the gate assumes. This script opens HIDDEN windows on a
   temp page, asks one IPC handler (which answers fromMain(event, getWin)) from each place, and expects:

     main frame of the main window ..................... true
     an iframe inside the main window .................. false   (a subframe)
     the main frame of a second window ................. false   (another webContents, the cast window's case)
     the main frame of the main window, address not file: false   (an https page the page navigated to is refused: tested with allowUrl)
     a PINNED main window (main-window-guard.js) in a folder with a space: its own page true (the real frame address equals the pinned one),
       another local page false, and a script that sets location.href to that other page never leaves the app page

   Nothing is shown: show:false windows, a temp userData folder (HQ_MAINGATE_CHECK_PROFILE), no single-instance lock, no tray, no
   network. It cannot touch the owner's running app.

     dashboard\node_modules\electron\dist\electron.exe dashboard\main-gate.native.check.js

   Exit codes copy the other native checks: 0 clean, 1 a check failed, 2 timed out after 60 s. */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fromMain } = require('./main-gate.js');
const { pin } = require('./main-window-guard.js');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_MAINGATE_CHECK_PROFILE || 'hq-maingate-check-profile'));
app.on('window-all-closed', () => { /* the check windows come and go */ });

let finished = false;
function finish(code, line) {
  if (finished) return;
  finished = true;
  const exit = () => app.exit(code);
  process.stdout.write(line + '\n', exit);
  setTimeout(exit, 1500);
}
const say = (line) => process.stdout.write('[main-gate-native] ' + line + '\n');
setTimeout(() => finish(2, '[main-gate-native] timed out after 60 s'), 60000).unref();

const webPrefs = { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true, sandbox: false };

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-maingate-'));
  const ask = `<script>require('electron').ipcRenderer.invoke('gate-ask').then((r) => { window.__answer = r; document.title = 'done:' + r; });</script>`;
  fs.writeFileSync(path.join(dir, 'sub.html'), `<!doctype html><title>sub</title>${ask}`);
  fs.writeFileSync(path.join(dir, 'main.html'), `<!doctype html><title>main</title><iframe src="sub.html"></iframe>${ask}`);
  fs.writeFileSync(path.join(dir, 'other.html'), `<!doctype html><title>other</title>${ask}`);

  const answers = [];   // { frame: 'main'|'sub'|'other', ok, strict }
  let main = null, other = null;
  ipcMain.handle('gate-ask', (event) => {
    const url = event.senderFrame && event.senderFrame.url || '';
    const which = /other\.html/.test(url) ? 'other' : /sub\.html/.test(url) ? 'sub' : 'main';
    answers.push({ which, ok: fromMain(event, () => main), noFile: fromMain(event, () => main, { allowUrl: () => false }) });
    return which;
  });

  main = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: webPrefs });
  other = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: webPrefs });
  await main.loadFile(path.join(dir, 'main.html'));
  await other.loadFile(path.join(dir, 'other.html'));
  const end = Date.now() + 15000;
  while (Date.now() < end && !(answers.some((a) => a.which === 'main') && answers.some((a) => a.which === 'sub') && answers.some((a) => a.which === 'other'))) await new Promise((r) => setTimeout(r, 100));

  const by = (w) => answers.find((a) => a.which === w);
  const failures = [];
  if (!by('main')) failures.push('the main window never asked');
  else {
    if (by('main').ok !== true) failures.push('the real main frame of the main window was refused (the gate would refuse every Start)');
    if (by('main').noFile !== false) failures.push('an address the allow rule refuses was accepted');
  }
  if (!by('sub')) failures.push('the iframe never asked');
  else if (by('sub').ok !== false) failures.push('a subframe of the main window was accepted');
  if (!by('other')) failures.push('the second window never asked');
  else if (by('other').ok !== false) failures.push('another window was accepted');
  // a pinned window: the real frame address must equal what pin() computed, or the gate would refuse every Start
  const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq pinned-'));
  fs.writeFileSync(path.join(pdir, 'app page.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(pdir, 'other.html'), '<!doctype html><title>other</title>');
  const pinned = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: webPrefs });
  const appPath = path.join(pdir, 'app page.html');
  pin(pinned, appPath);
  await pinned.loadFile(appPath);
  const frameOf = () => ({ sender: pinned.webContents, senderFrame: pinned.webContents.mainFrame });
  if (fromMain(frameOf(), () => pinned) !== true) failures.push('a pinned window own page was refused (the pinned address differs from the real one)');
  await pinned.webContents.executeJavaScript("location.href = " + JSON.stringify(require('node:url').pathToFileURL(path.join(pdir, 'other.html')).href)).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  if (!/app%20page.html$/i.test(pinned.webContents.getURL())) failures.push('a script moved the pinned window to another page: ' + pinned.webContents.getURL().slice(-40));
  try { pinned.destroy(); fs.rmSync(pdir, { recursive: true, force: true }); } catch { /* temp */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  if (failures.length) { for (const f of failures) say('FAIL ' + f); return finish(1, '[main-gate-native] ' + failures.length + ' check(s) failed'); }
  say('main frame accepted; iframe, second window and a refused address rejected');
  finish(0, '[main-gate-native] all checks passed');
}).catch((e) => finish(1, '[main-gate-native] crashed: ' + String((e && e.message) || e).slice(0, 300)));
