// M0 parity harness, v3 side — captures every theme × realm combo through the
// window.NEXUS debug handle. Run from dashboard-v3\:
//   $env:HQ_V3_PROFILE='hq-v3-shots'
//   & ..\dashboard\node_modules\electron\dist\electron.exe tools\parity-shot-v3.js
// Output: tools\shots\v3\<theme>_<realm>.png + v3-console.txt
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V3_PROFILE || 'hq-v3-shots'));

const THEMES = ['arcade', 'okami', 'numidea', 'ops', 'nightfall'];
const REALMS = ['roundtable', 'forge', 'hunts', 'grimoire', 'lands', 'legacy'];
const OUT = path.join(__dirname, 'shots', 'v3');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));
  // strip one-shot chrome that would contaminate captures (same as the v2
  // harness): boot splash + the fx celebration takeover
  await win.webContents.executeJavaScript(
    `document.getElementById('boot')?.remove(); document.getElementById('takeover')?.remove(); true;`);
  for (const theme of THEMES) {
    for (const realm of REALMS) {
      await win.webContents.executeJavaScript(
        `window.NEXUS.applyTheme('${theme}'); window.NEXUS.switchRealm('${realm}'); document.getElementById('stage').scrollTo(0,0); true;`);
      await new Promise((r) => setTimeout(r, 450));
      fs.writeFileSync(path.join(OUT, `${theme}_${realm}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  fs.writeFileSync(path.join(OUT, '..', 'v3-console.txt'), errs.join('\n') || 'no errors');
  console.log(`SHOTS v3 done: ${THEMES.length * REALMS.length} captures, ${errs.length} console errors`);
  app.quit();
});
