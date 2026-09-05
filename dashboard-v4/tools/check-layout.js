// check-layout.js — geometry gate. Catches what neither the selftest nor a
// glance at a screenshot reliably catches: text that overlaps other text, text
// that overflows its container, and stat rows wider than the constitution's
// three-per-row limit.
//
// Run: ..\dashboard\node_modules\electron\dist\electron.exe tools/check-layout.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V4_PROFILE || 'hq-v4-layout'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const out = { overlaps: [], overflow: [], wideRows: [] };
  const stage = document.getElementById('stage');
  if (!stage) return out;

  // CLIP-AWARE RECTS. The naive version of this probe reported 476 findings and
  // almost all were noise: an element inside a scroller keeps its full-size
  // rect even when scrolled out of view, so it "overlaps" everything painted
  // after the scroller. What a reader actually sees is the rect INTERSECTED
  // with every clipping ancestor, so that is what we compare.
  function visibleRect(n) {
    let r = n.getBoundingClientRect();
    let p = n.parentElement;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      if (/auto|scroll|hidden/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        const left = Math.max(r.left, pr.left), top = Math.max(r.top, pr.top);
        const right = Math.min(r.right, pr.right), bottom = Math.min(r.bottom, pr.bottom);
        if (right <= left || bottom <= top) return null;      // fully clipped away
        r = { left, top, right, bottom, width: right - left, height: bottom - top };
      }
      p = p.parentElement;
    }
    // also clip to the stage itself — below-the-fold content is not a collision
    const sr = stage.getBoundingClientRect();
    const left = Math.max(r.left, sr.left), top = Math.max(r.top, sr.top);
    const right = Math.min(r.right, sr.right), bottom = Math.min(r.bottom, sr.bottom);
    if (right <= left || bottom <= top) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  const leaves = [];
  for (const n of stage.querySelectorAll('*')) {
    if (!n.getClientRects().length) continue;
    const txt = (n.textContent || '').trim();
    if (!txt) continue;
    if (Array.from(n.children).some((c) => (c.textContent || '').trim())) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    // A CLOSED <details> still hands its children rects in Chromium, collapsed
    // onto the summary's position — which reads as dozens of mutual overlaps
    // that no user can see. Same for [hidden] subtrees. This filter is what
    // took AUTOMATIONS from 33 phantom findings to 0.
    if (n.closest('details:not([open]) > *:not(summary), details:not([open]) *:not(summary)')) continue;
    if (n.closest('[hidden]')) continue;
    const r = visibleRect(n);
    if (!r || r.width < 3 || r.height < 3) continue;
    leaves.push({ n, r, cs });
  }

  const desc = (n) => (n.tagName.toLowerCase() + '.' + (n.className && n.className.baseVal !== undefined ? n.className.baseVal : String(n.className || '')).trim().split(/\s+/).filter(Boolean).slice(0,2).join('.')) + ' "' + (n.textContent||'').trim().slice(0,26) + '"';

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i], B = leaves[j];
      if (A.n.contains(B.n) || B.n.contains(A.n)) continue;
      if (/absolute|fixed/.test(A.cs.position) || /absolute|fixed/.test(B.cs.position)) continue;
      const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      // 3px of slack absorbs sub-pixel layout and font descenders
      if (ox > 3 && oy > 3) out.overlaps.push(desc(A.n) + '  ><  ' + desc(B.n) + '  [' + Math.round(ox) + 'x' + Math.round(oy) + ']');
    }
  }

  for (const { n } of leaves) {
    const p = n.parentElement; if (!p) continue;
    const cs = getComputedStyle(p);
    if (/auto|scroll|hidden/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
    const a = n.getBoundingClientRect(), b = p.getBoundingClientRect();
    if (a.right - b.right > 4) out.overflow.push(desc(n));
  }

  for (const g of stage.querySelectorAll('*')) {
    const cs = getComputedStyle(g);
    if (cs.display !== 'grid') continue;
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
    if (cols > 3 && g.children.length > 3) {
      out.wideRows.push(String(g.className || g.tagName) + ' -> ' + cols + ' columns, ' + g.children.length + ' items');
    }
  }
  return out;
})()`;

async function run() {
  const win = new BrowserWindow({
    width: 1440, height: 900, x: -4000, show: true, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      preload: path.join(__dirname, '..', 'preload.js') },
  });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await sleep(1200);
  const labels = await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('#rail .rail-btn .lbl')).map(n => n.textContent.trim())`);

  let total = 0;
  for (let i = 0; i < labels.length; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('#rail .rail-btn')[${i}].click(); true`);
    await sleep(1000);
    const r = await win.webContents.executeJavaScript(PROBE);
    const n = r.overlaps.length + r.overflow.length + r.wideRows.length;
    total += n;
    console.log(`LAYOUT ${labels[i].toLowerCase()} overlaps=${r.overlaps.length} overflow=${r.overflow.length} wideRows=${r.wideRows.length}`);
    for (const s of r.overlaps.slice(0, 6))  console.log('    OVERLAP  ' + s);
    for (const s of r.overflow.slice(0, 4))  console.log('    OVERFLOW ' + s);
    for (const s of r.wideRows.slice(0, 4))  console.log('    WIDEROW  ' + s);
  }
  console.log('LAYOUT TOTAL findings=' + total);
  app.quit();
}
app.whenReady().then(() => run().catch((e) => { console.error('LAYOUT FAILED', e); app.exit(1); }));
app.on('window-all-closed', () => app.quit());
