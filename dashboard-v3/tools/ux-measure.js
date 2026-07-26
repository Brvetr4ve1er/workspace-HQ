// UX design-system verification harness — offscreen Electron, nexus theme, all realms, 2 viewports.
//
// Ports the throwaway teardown harness (harness.js + analyze.js from the Phase-0.5 recon) into a
// committed, reproducible tool. This is the OBJECTIVE oracle later design-system tasks verify
// against: run it before and after a change and diff `gapDistinctCount` / `fontSizeDistinctCount` /
// per-realm `sub12pct` / `tinyTargets` etc.
//
// Usage (from dashboard-v3/):
//   ../dashboard/node_modules/electron/dist/electron.exe tools/ux-measure.js --out tools/ux-baseline.json
//
// Mirrors the offscreen-BrowserWindow pattern in tools/nexus-shot.js.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', path.join(os.tmpdir(), 'hq-v3-ux-measure'));

const V3_DIR = path.join(__dirname, '..');
const SIZES = [[1440, 900], [1280, 800]];

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return def;
}
const OUT = path.resolve(process.cwd(), getArg('--out', 'tools/ux-measure-out.json'));

// Interactive selector for "tiny target" checks — the concrete set of clickable chrome/stage
// controls called out in the brief.
const TINY_TARGET_SEL = 'button,a,[role=button],.sigil,.tm-nav,.am-toggle,.tab-focus,.btn';

// Walk function, stringified and executed in-renderer. Returns the raw per-element data; all
// metric computation happens back in Node (keeps the in-page script simple + fast).
const WALK = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const roots = [document.getElementById('nexus'), document.getElementById('statusbar')].filter(Boolean);
  const out = { vw, vh, elements: [] };
  const isTinyTargetCandidate = (el) => el.matches('${TINY_TARGET_SEL}');
  const px = (v) => parseFloat(v) || 0;
  function regionOf(el){
    if (el.closest('#rail-left')) return 'rail-left';
    if (el.closest('#topstrip')) return 'topstrip';
    if (el.closest('.timemachine')) return 'timemachine';
    if (el.closest('#stage')) return 'stage';
    if (el.closest('#rail-right')) return 'rail-right';
    if (el.closest('#statusbar')) return 'statusbar';
    return 'other';
  }
  const all = [];
  for (const root of roots) { all.push(root); all.push(...root.querySelectorAll('*')); }
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // skip zero-box (hidden) nodes
    const cs = getComputedStyle(el);
    out.elements.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      cls: (typeof el.className === 'string' ? el.className : '') || '',
      region: regionOf(el),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      fs: px(cs.fontSize),
      overflowX: cs.overflowX, overflowY: cs.overflowY,
      gap: cs.gap && cs.gap !== 'normal' ? cs.gap : '',
      sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
      tinySel: isTinyTargetCandidate(el),
    });
  }
  return out;
})()`;

function round1(v) { return Math.round(v * 10) / 10; }

function selOf(e) {
  const cls = e.cls ? '.' + String(e.cls).split(' ').filter(Boolean).slice(0, 2).join('.') : '';
  return e.tag + (e.id ? '#' + e.id : '') + cls;
}

// Computes the exact metric fields the brief specifies, from one realm's raw element walk.
function computeMetrics(data) {
  const { vw, elements } = data;

  const gapSet = new Set();
  for (const e of elements) {
    if (e.gap) {
      e.gap.split(' ').forEach((g) => {
        const v = parseFloat(g);
        if (v > 0) gapSet.add(round1(v));
      });
    }
  }
  const gapDistinct = [...gapSet].sort((a, b) => a - b);

  const textEls = elements.filter((e) => e.fs > 0);
  const fsSet = new Set(textEls.map((e) => round1(e.fs)));
  const fontSizeDistinct = [...fsSet].sort((a, b) => a - b);

  const tinyTargets = elements
    .filter((e) => e.tinySel && Math.min(e.w, e.h) > 0 && Math.min(e.w, e.h) < 28)
    .map((e) => ({ sel: selOf(e), w: e.w, h: e.h }));

  const sub12 = textEls.filter((e) => e.fs < 12);
  const sub12pct = textEls.length ? round1((sub12.length / textEls.length) * 100) : 0;

  // headingStep: largest recurring (count>=2) stage font size ÷ modal (most frequent) stage body font.
  // NOTE: this is an approximate hierarchy proxy, not ground truth — it's false-passable: two
  // incidental same-size badges/labels (count>=2) with no semantic "heading" role would count as
  // "recurring" and could produce a step even where there's no real visual hierarchy. Per-realm
  // screenshots (Task 6) are the authoritative check for whether hierarchy actually reads visually;
  // treat this number as a cheap signal to catch regressions, not a substitute for looking.
  const stageText = elements.filter((e) => e.region === 'stage' && e.fs > 0);
  let headingStep = 1;
  if (stageText.length) {
    const hist = {};
    for (const e of stageText) {
      const k = round1(e.fs);
      hist[k] = (hist[k] || 0) + 1;
    }
    const entries = Object.entries(hist).map(([k, v]) => [Number(k), v]);
    let bodyFont = entries[0][0];
    let bodyCount = -1;
    for (const [fs, count] of entries) {
      if (count > bodyCount || (count === bodyCount && fs < bodyFont)) {
        bodyFont = fs;
        bodyCount = count;
      }
    }
    const recurring = entries.filter(([, count]) => count >= 2).map(([fs]) => fs);
    const largestRecurring = recurring.length ? Math.max(...recurring) : bodyFont;
    headingStep = bodyFont > 0 ? round1(largestRecurring / bodyFont) : 1;
  }

  const railRight = elements.find((e) => e.id === 'rail-right');
  const railSharePct = railRight && vw ? round1((railRight.w / vw) * 100) : 0;

  const stageKids = elements.filter((e) => e.region === 'stage' && e.id !== 'stage');
  let stageBodyWidth = 0;
  if (stageKids.length) {
    const contentLeft = Math.min(...stageKids.map((e) => e.x));
    const contentRight = Math.max(...stageKids.map((e) => e.right));
    stageBodyWidth = contentRight - contentLeft;
  }

  // Smell-filtered: only count elements whose content overflows AND whose overflow-x is the
  // default 'visible' — i.e. actual unhandled layout spill, not a deliberate overflow-x:auto/
  // hidden/scroll container (a real scroll affordance isn't a bug). Matches the scratchpad
  // analyze.js's hOverflow filter, which excluded handled containers for the same reason.
  const overflowCount = elements.filter((e) => e.sw - e.cw > 2 && e.overflowX === 'visible').length;

  return {
    gapDistinct,
    fontSizeDistinct,
    tinyTargets,
    sub12pct,
    headingStep,
    railSharePct,
    stageBodyWidth,
    overflowCount,
  };
}

async function measureSize(win, size, realmIds) {
  const [w, h] = size;
  win.setContentSize(w, h);
  await new Promise((r) => setTimeout(r, 300));
  const perRealm = {};
  for (const realm of realmIds) {
    await win.webContents.executeJavaScript(
      `window.NEXUS.switchRealm('${realm}'); document.getElementById('stage').scrollTo(0,0); true;`
    );
    await new Promise((r) => setTimeout(r, 400));
    const data = await win.webContents.executeJavaScript(WALK);
    perRealm[realm] = computeMetrics(data);
  }
  return perRealm;
}

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true } });
  const errs = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errs.push(msg); });

  await win.loadFile(path.join(V3_DIR, 'index.html'));
  await new Promise((r) => setTimeout(r, 2600));
  await win.webContents.executeJavaScript(
    `document.getElementById('boot')?.remove(); document.getElementById('takeover')?.remove();
     window.NEXUS.applyTheme('nexus'); true;`
  );
  const realmIds = await win.webContents.executeJavaScript(`window.NEXUS.ordered().map(r=>r.manifest.id)`);

  const bySize = {};
  for (const size of SIZES) {
    bySize[size.join('x')] = await measureSize(win, size, realmIds);
  }

  // Global roll-up: union of distinct gap/font values across all realms and both viewports.
  const globalGaps = new Set();
  const globalFonts = new Set();
  for (const sizeKey of Object.keys(bySize)) {
    for (const realm of realmIds) {
      bySize[sizeKey][realm].gapDistinct.forEach((v) => globalGaps.add(v));
      bySize[sizeKey][realm].fontSizeDistinct.forEach((v) => globalFonts.add(v));
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    realmIds,
    sizes: SIZES.map((s) => s.join('x')),
    gapDistinctCount: globalGaps.size,
    fontSizeDistinctCount: globalFonts.size,
    bySize,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  const summary = `UX-MEASURE realms=${realmIds.length} gapDistinctCount=${globalGaps.size} fontSizeDistinctCount=${globalFonts.size} consoleErrors=${errs.length} out=${OUT}`;
  console.log(summary);
  app.quit();
});
