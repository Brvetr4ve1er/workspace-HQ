// M0 parity harness, v2 side — captures every theme × tab of the LIVE v2 app
// for side-by-side comparison against the v3 realm shots. Run from legacy\dashboard-v3\:
//   & ..\..\dashboard\node_modules\electron\dist\electron.exe tools\parity-shot-v2.js
// Output: tools\shots\v2\<theme>_<tab>.png + v2-console.txt
// (v2 is loaded read-only; its own userData is untouched — scratch profile.)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), 'hq-v2-shots-profile'));

const THEMES = ['arcade', 'okami', 'numidea', 'ops', 'nightfall'];
const TABS = ['overview', 'quests', 'spellbook', 'trends', 'basemap'];
const OUT = path.join(__dirname, 'shots', 'v2');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile(path.join(__dirname, '..', '..', 'dashboard-v2', 'index.html'));
  await new Promise((r) => setTimeout(r, 3200));   // let the boot splash finish
  // strip one-shot chrome that would contaminate captures: boot splash + the
  // celebration takeover (fires on changes_since_prev and dims the whole page)
  await win.webContents.executeJavaScript(
    `document.getElementById('boot')?.remove(); document.getElementById('takeover')?.remove(); true;`);
  for (const theme of THEMES) {
    // v2 has no debug handle — drive the real SYS menu option buttons
    await win.webContents.executeJavaScript(
      `document.querySelector('.theme-opt[data-theme="${theme}"]')?.click(); true;`);
    await new Promise((r) => setTimeout(r, 350));
    for (const tab of TABS) {
      await win.webContents.executeJavaScript(
        `document.querySelector('#tabs button[data-tab="${tab}"]')?.click(); window.scrollTo(0,0); true;`);
      await new Promise((r) => setTimeout(r, 700));
      fs.writeFileSync(path.join(OUT, `${theme}_${tab}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  fs.writeFileSync(path.join(OUT, '..', 'v2-console.txt'), errs.join('\n') || 'no errors');
  console.log(`SHOTS v2 done: ${THEMES.length * TABS.length} captures, ${errs.length} console errors`);
  app.quit();
});
