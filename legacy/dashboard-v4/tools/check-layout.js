// check-layout.js — geometry gate. Catches what neither the selftest nor a
// glance at a screenshot reliably catches: text that overlaps other text, text
// that overflows its container, and stat rows wider than the constitution's
// three-per-row limit.
//
// Run: ..\..\dashboard\node_modules\electron\dist\electron.exe tools/check-layout.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_V4_PROFILE || 'hq-v4-layout'));
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


const PROBE = `(() => {
  const out = { overlaps: [], overflow: [], wideRows: [] };
  const stage = document.getElementById('stage');
  if (!stage) return out;

  // CLIP-AWARE RECTS. The naive version of this probe reported 476 findings and
  // almost all were noise: an element inside a scroller keeps its full-size
  // rect even when scrolled out of view, so it "overlaps" everything painted
  // after the scroller. What a reader actually sees is the rect INTERSECTED
  // with every clipping ancestor, so that is what we compare.
  function clipTo(rect, n) {
    let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
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
    // PER-LINE BOXES, not the union. A wrapped inline (<code>browser-bridge/</code>
    // breaking across two lines) returns ONE bounding rect spanning both lines,
    // which then "overlaps" whatever sits on the first line. getClientRects()
    // gives the real line boxes, and comparing those reports what a reader sees.
    const boxes = [];
    for (const raw of n.getClientRects()) {
      const c = clipTo(raw, n);
      if (c && c.width >= 3 && c.height >= 3) boxes.push(c);
    }
    if (!boxes.length) continue;
    leaves.push({ n, boxes, cs });
  }

  const desc = (n) => (n.tagName.toLowerCase() + '.' + (n.className && n.className.baseVal !== undefined ? n.className.baseVal : String(n.className || '')).trim().split(/\s+/).filter(Boolean).slice(0,2).join('.')) + ' "' + (n.textContent||'').trim().slice(0,26) + '"';

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i], B = leaves[j];
      if (A.n.contains(B.n) || B.n.contains(A.n)) continue;
      if (/absolute|fixed/.test(A.cs.position) || /absolute|fixed/.test(B.cs.position)) continue;
      let hit = null;
      for (const ra of A.boxes) for (const rb of B.boxes) {
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        // 3px of slack absorbs sub-pixel layout and font descenders
        if (ox > 3 && oy > 3) { hit = Math.round(ox) + 'x' + Math.round(oy); break; }
      }
      if (hit) out.overlaps.push(desc(A.n) + '  ><  ' + desc(B.n) + '  [' + hit + ']');
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
    if (cols <= 3 || g.children.length <= 3) continue;
    // The constitution's rule is about STAT TILES — a card whose point is a big
    // number — not about every wide grid. A 7-column weekday strip, a trophy
    // case, and a 4-part nudge ROW (icon | label | bar | count) all tripped the
    // naive version and none of them are stat tiles. A tile is identified by a
    // display-weight numeral (>=24px) inside it.
    const tiles = Array.from(g.children).filter((c) =>
      Array.from(c.querySelectorAll('*')).concat([c]).some((d) => parseFloat(getComputedStyle(d).fontSize) >= 24));
    if (tiles.length > 3) {
      out.wideRows.push(String(g.className || g.tagName) + ' -> ' + cols + ' columns, ' + tiles.length + ' stat tiles');
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
    const tabs = await tabsOf(win);
    const passes = tabs.length ? tabs.map((t, k) => ({ t, k })) : [{ t: null, k: -1 }];
    for (const { t, k } of passes) {
      if (k >= 0) { await clickTab(win, k); await sleep(800); }
      const r = await win.webContents.executeJavaScript(PROBE);
      const n = r.overlaps.length + r.overflow.length + r.wideRows.length;
      total += n;
      const who = labels[i].toLowerCase() + (t ? '/' + t.toLowerCase() : '');
      console.log(`LAYOUT ${who} overlaps=${r.overlaps.length} overflow=${r.overflow.length} wideRows=${r.wideRows.length}`);
      for (const s of r.overlaps.slice(0, 6))  console.log('    OVERLAP  ' + s);
      for (const s of r.overflow.slice(0, 4))  console.log('    OVERFLOW ' + s);
      for (const s of r.wideRows.slice(0, 4))  console.log('    WIDEROW  ' + s);
    }
    if (tabs.length) await clickTab(win, 0);
  }
  console.log('LAYOUT TOTAL findings=' + total);
  app.quit();
}
app.whenReady().then(() => run().catch((e) => { console.error('LAYOUT FAILED', e); app.exit(1); }));
app.on('window-all-closed', () => app.quit());
