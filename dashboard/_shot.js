// throwaway: capture each tab + collect console errors
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile('index.html');
  await new Promise((r) => setTimeout(r, 3200));
  for (const tab of ['quests', 'trends', 'achievements', 'inventory']) {
    await win.webContents.executeJavaScript(`document.querySelector('#tabs button[data-tab="${tab}"]').click(); window.scrollTo(0,0);`);
    await new Promise((r) => setTimeout(r, 1100));
    fs.writeFileSync(`_tab_${tab}.png`, (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync('_console.txt', errs.join('\n') || 'no errors');
  app.quit();
});
