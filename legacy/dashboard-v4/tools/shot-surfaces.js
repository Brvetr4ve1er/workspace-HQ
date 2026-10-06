// shot-surfaces.js — the DESIGN GATE harness.
//
// WHY THIS EXISTS. The selftest mounts every surface and reports errors=0, but
// it renders into a window nobody looks at and it cannot see CSS at all: the
// v4.3 lookback surface passed the selftest with chars=51834 and errors=0 while
// its hero had literally zero style rules. The constitution's process rule is
// that a restyle ships on a SCREENSHOT review, and this is what produces them.
//
// Run:  ..\..\dashboard\node_modules\electron\dist\electron.exe tools/shot-surfaces.js
// Out:  tools/shots/<surface>.png   (gitignored)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V4_PROFILE || 'hq-v4-shots'));

const OUT = path.join(__dirname, 'shots');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-surface tabs. HISTORY and SYSTEM each hide two thirds of themselves behind
// a tab bar, so a harness that only captures the default tab leaves TROPHIES,
// TIMELINE, SCREEN TIME and SOCIAL completely unverified — which is exactly the
// blind spot "you destroyed it" keeps coming out of.
const TAB_SEL = '[role="tab"], .lb-tab, .sys-tab';
async function tabsOf(win) {
  return win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('#stage ${TAB_SEL.replace(/'/g, "\'")}'))
       .map(n => (n.textContent || '').trim()).filter(Boolean)`);
}
async function clickTab(win, i) {
  return win.webContents.executeJavaScript(
    `(() => { const t = document.querySelectorAll('#stage ${TAB_SEL.replace(/'/g, "\'")}')[${i}];
       if (!t) return false; t.click(); return true; })()`);
}


async function shoot(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  const chars = await win.webContents.executeJavaScript(
    `(document.getElementById('stage')?.innerHTML || '').length`);
  console.log(`SHOT ${name} chars=${chars} -> ${path.relative(process.cwd(), file)}`);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  // SHOWN, BUT PARKED OFFSCREEN. `show: false` looks like the tidy choice and
  // is a trap: a hidden window is never composited, so capturePage() hands back
  // the last frame that WAS painted. The first run of this harness wrote
  // AUTOMATIONS pixels into history.png while the DOM assertion said 51834
  // chars of HISTORY — the two disagreed and only the pixels showed it.
  // Parking it at a negative x keeps it off the user's screen while Chromium
  // still paints every frame. backgroundThrottling stays off for the same reason.
  const win = new BrowserWindow({
    width: 1440, height: 900, x: -4000, y: 0, show: true, skipTaskbar: true,
    backgroundColor: '#0d0b16',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errors.push(msg);            // 2 = warning, 3 = error
  });

  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await sleep(1200);

  // The rail is the app's own surface switcher, so driving it exercises the
  // real mount path rather than a private back door the user never uses.
  const labels = await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('#rail .rail-btn .lbl')).map(n => n.textContent.trim())`);
  console.log('SHOT rail=' + labels.join(','));

  for (let i = 0; i < labels.length; i++) {
    const name = labels[i].toLowerCase();
    if (ONLY.length && !ONLY.includes(name)) continue;
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('#rail .rail-btn')[${i}].click(); true`);
    await sleep(1100);                           // let async mounts (radar, canvas) paint
    // Belt and braces: wait for an actual compositor frame before grabbing it,
    // so the capture can never precede the paint it is meant to record.
    await new Promise((r) => win.webContents.once('paint', r).isDestroyed?.() || setTimeout(r, 350));

    const tabs = await tabsOf(win);
    if (!tabs.length) {
      await shoot(win, name);
    } else {
      // Capture EVERY tab, not just whichever one mounts first.
      for (let t = 0; t < tabs.length; t++) {
        await clickTab(win, t);
        await sleep(800);
        const slug = tabs[t].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await shoot(win, `${name}-${slug}`);
      }
      await clickTab(win, 0);
    }
  }

  console.log(`SHOT DONE errors=${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ERR ' + e);
  app.quit();
}

app.whenReady().then(() => run().catch((e) => { console.error('SHOT FAILED', e); app.exit(1); }));
app.on('window-all-closed', () => app.quit());
