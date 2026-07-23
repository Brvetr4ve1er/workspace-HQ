// Cinematic-theme capture — nexus across the key realms, at a real window size.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V3_PROFILE || 'hq-v3-nexus-shot'));

const REALMS = ['roundtable', 'forge', 'hunts', 'grimoire', 'lands', 'legacy', 'medbay', 'observatory', 'watchtower', 'summoning'];
const OUT = path.join(__dirname, 'shots', 'nexus');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));
  await win.webContents.executeJavaScript(`document.getElementById('boot')?.remove(); document.getElementById('takeover')?.remove(); window.NEXUS.applyTheme('nexus'); true;`);
  await new Promise((r) => setTimeout(r, 400));
  for (const realm of REALMS) {
    await win.webContents.executeJavaScript(`window.NEXUS.switchRealm('${realm}'); document.getElementById('stage').scrollTo(0,0); true;`);
    await new Promise((r) => setTimeout(r, 450));
    fs.writeFileSync(path.join(OUT, `${realm}.png`), (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(OUT, '_console.txt'), errs.join('\n') || 'no errors');
  console.log(`NEXUS shots: ${REALMS.length} realms, ${errs.length} console errors`);
  app.quit();
});
