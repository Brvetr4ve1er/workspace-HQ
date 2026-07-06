// throwaway: capture the new spellbook tab + boot overview, collect console errors
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 950, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadFile('index.html');
  await new Promise((r) => setTimeout(r, 3200));
  fs.writeFileSync('_tab_overview2.png', (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#tabs button[data-tab="spellbook"]').click(); window.scrollTo(0,0);`);
  await new Promise((r) => setTimeout(r, 1200));
  fs.writeFileSync('_tab_spellbook.png', (await win.webContents.capturePage()).toPNG());
  // filtered view: search + a school chip
  await win.webContents.executeJavaScript(`
    const i = document.querySelector('#spsearch'); i.value = 'scan'; i.dispatchEvent(new Event('input'));
  `);
  await new Promise((r) => setTimeout(r, 700));
  fs.writeFileSync('_tab_spellbook_search.png', (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync('_console.txt', errs.join('\n') || 'no errors');
  app.quit();
});
