'use strict';
// tools/trailer/render-main.js — Electron main process that renders one of the
// two Claude Design trailers to a silent x264 master, frame by frame.
//
//   dashboard\node_modules\electron\dist\electron.exe tools\trailer\render-main.js
//       --trailer 1|2 --src <design export dir>
//       [--fps 30] [--outro "<label>"]
//       [--stills 0,15,29.9 [--repeat]]   spike mode: PNG stills, no video
//       [--frames <n>]                    render only the first n frames (smoke test)
//       [--no-gpu] [--cdp-port <port>]
//
// Before anything renders, honesty-patch.mjs copies the design into
// .work/site and patches it (exact-once, denylist-checked); it throws, and
// the render stops, if anything does not apply cleanly.
//
// How a frame is made: the page's composition engine (animations-v3.jsx) owns
// a sync seek event, 'data-om-seek-to-time-frame' with {time, sync: true}, that
// commits the frame for that time before dispatchEvent returns. We dispatch
// it, wait two animation frames so the commit is painted, then capturePage()
// the 1920×1080 stage until two captures two frames apart are identical, and
// pipe that PNG to ffmpeg.
//
// The window is shown OFF-SCREEN (left of every display) at scale factor 1,
// so it never appears on your desktop; the editor chrome (play bar, tweaks,
// sound chip) is hidden and checked to be outside the frame.
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const HERE = __dirname;
const OUT = path.join(HERE, 'out');
const WORK = path.join(HERE, '.work');
const W = 1920, H = 1080;

function parseArgs(argv) {
  const i = argv.findIndex((x) => /render-main\.js$/i.test(x));
  const rest = i >= 0 ? argv.slice(i + 1) : argv.slice(1);
  const a = { trailer: 1, fps: 30, gpu: true, repeat: false };
  for (let k = 0; k < rest.length; k++) {
    const key = rest[k], v = rest[k + 1];
    if (key === '--trailer') { a.trailer = Number(v); k++; }
    else if (key === '--src') { a.src = v; k++; }
    else if (key === '--fps') { a.fps = Number(v); k++; }
    else if (key === '--outro') { a.outro = v; k++; }
    else if (key === '--stills') { a.stills = String(v).split(',').map(Number); k++; }
    else if (key === '--frames') { a.frames = Number(v); k++; }
    else if (key === '--repeat') a.repeat = true;
    else if (key === '--no-gpu') a.gpu = false;
    else if (key === '--cdp-port') { a.debugPort = Number(v); k++; }
  }
  if (![1, 2].includes(a.trailer)) throw new Error('--trailer must be 1 or 2');
  if (!(a.fps > 0 && a.fps <= 120)) throw new Error('--fps must be between 1 and 120');
  if (a.stills && a.stills.some((t) => !Number.isFinite(t) || t < 0)) throw new Error('--stills takes times in seconds, e.g. 0,15,29.9');
  return a;
}

let args;
try { args = parseArgs(process.argv); } catch (e) { console.error(e.message); process.exit(2); }

// ---- before ready: deterministic, unthrottled, isolated ----
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
// An off-screen window counts as occluded on Windows; keep it painting.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (args.debugPort) app.commandLine.appendSwitch('remote-debugging-port', String(args.debugPort));
if (!args.gpu) app.disableHardwareAcceleration();
// Own profile: never shares a lock, cache or localStorage with the real app.
app.setPath('userData', path.join(WORK, `electron-profile-${process.pid}`));

const log = (...m) => console.log('[trailer]', ...m);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Hide everything that is not the stage, and pin the stage to the top-left
// corner at its natural size (the engine scales it to fit the viewport).
const CAPTURE_CSS = `
  [data-omelette-chrome], [data-om-unknown-cues], .twk-panel { display: none !important; }
  svg[data-om-exportable-video-with-duration-secs] {
    position: fixed !important; left: 0 !important; top: 0 !important;
    transform: none !important; box-shadow: none !important; z-index: 2147483647 !important;
  }
  html, body { cursor: none !important; overflow: hidden !important; }
`;

// Runs in the page. Returns a promise that resolves once the frame for `t`
// has been committed (sync seek) and painted (two rAFs).
const PAGE_HELPERS = `(() => {
  const svgSel = 'svg[data-om-exportable-video-with-duration-secs]';
  window.__hqStage = () => document.querySelector(svgSel);
  window.__hqSeek = (t) => new Promise((resolve, reject) => {
    const svg = window.__hqStage();
    if (!svg) { reject(new Error('stage svg missing')); return; }
    svg.dispatchEvent(new CustomEvent('data-om-seek-to-time-frame', { detail: { time: t, sync: true } }));
    const to = setTimeout(() => reject(new Error('requestAnimationFrame stalled (window throttled?)')), 8000);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(to);
      const lab = document.querySelector('[data-screen-label]');
      resolve(lab ? lab.getAttribute('data-screen-label') : null);
    }));
  });
  return true;
})()`;

function offscreenPosition() {
  const ds = screen.getAllDisplays();
  const minX = Math.min(...ds.map((d) => d.bounds.x));
  const minY = Math.min(...ds.map((d) => d.bounds.y));
  return { x: minX - W - 600, y: minY, displays: ds.map((d) => `${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y} sf${d.scaleFactor}`) };
}

function intersectsAnyDisplay(b) {
  return screen.getAllDisplays().some((d) => {
    const r = d.bounds;
    return b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
  });
}

async function poll(fn, what, ms = 90000, every = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

function startFfmpeg(file, fps) {
  const ffArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'animation',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(fps), '-movflags', '+faststart', file,
  ];
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'pipe'], windowsHide: true });
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
  });
  return { ff, done, ffArgs };
}

async function writeFrame(ff, buf) {
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}

function assertNotBlank(img, what) {
  const bmp = img.toBitmap(); // BGRA
  let lo = 255, hi = 0;
  for (let i = 0; i < bmp.length; i += 4 * 97) { const v = bmp[i + 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 8) throw new Error(`${what}: captured frame is blank (green channel range ${lo}..${hi})`);
}

async function main() {
  const hp = await import(pathToFileURL(path.join(HERE, 'honesty-patch.mjs')).href);
  const serveMod = await import(pathToFileURL(path.join(HERE, 'serve.mjs')).href);
  fs.mkdirSync(OUT, { recursive: true });

  // The honesty patch copies the design into .work/site and throws on any
  // pattern that is not exact-once and on any denylist hit — so a render
  // never starts from unpatched content.
  // Outro: --outro "<label>" replaces the design's "v3 out now" / "v3 · out now" in both
  // trailers; without it the design's labels are kept (DEFAULT_OUTRO = null, owner decision).
  const outro = args.outro ?? hp.DEFAULT_OUTRO;
  const honesty = hp.run({ src: args.src || process.env.HQ_TRAILER_SRC, outro, log: (m) => log(m) });
  const site = hp.WORK_SITE;
  const nPatches = (honesty.patches || []).length;
  if (!nPatches) throw new Error('honesty patch reported no applied patches — refusing to render');
  log(`honesty patch ok: ${nPatches} exact-once patches, denylist clean, outro: ${honesty.outro ?? "design labels (v3 out now)"}`);
  const srv = await serveMod.serve(site, { port: 0 });
  const url = `${srv.url.replace(/\/$/, '')}/trailer-${args.trailer}.html`;

  const pos = offscreenPosition();
  log(`displays: ${pos.displays.join(' | ')}; window at ${pos.x},${pos.y}`);
  const win = new BrowserWindow({
    x: pos.x, y: pos.y, width: W, height: H, useContentSize: true,
    show: false, frame: false, resizable: false, movable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, backgroundColor: '#0d0d0f', title: 'WorkspaceHQ trailer render',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.setBounds({ x: pos.x, y: pos.y, width: W, height: H });
  // Checked before the window is ever shown (and again after showInactive, in
  // case Windows moves it on show), so a failed placement never flashes on screen.
  const b0 = win.getBounds();
  if (intersectsAnyDisplay(b0)) { win.destroy(); throw new Error(`window would land on a display (${JSON.stringify(b0)}) — refusing to render on your desktop`); }
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) log('page error:', message); });
  win.webContents.on('render-process-gone', (_e, d) => { console.error('[trailer] renderer gone:', d.reason); app.exit(3); });

  await win.loadURL(url);
  await win.webContents.insertCSS(CAPTURE_CSS);
  win.showInactive();
  const b = win.getBounds();
  if (intersectsAnyDisplay(b)) { win.hide(); throw new Error(`window landed on a display (${JSON.stringify(b)}) — refusing to render on your desktop`); }
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);

  // ---- readiness: React + Babel loaded, piece mounted, sync seek advertised ----
  const hqVar = args.trailer === 1 ? '__HQ1' : '__HQ2';
  const ready = await poll(() => js(`(() => {
    const svg = document.querySelector('svg[data-om-exportable-video-with-duration-secs]');
    const hq = window.${hqVar};
    if (!svg || !hq || !hq.K || !document.querySelector('[data-screen-label]')) return null;
    return { total: +svg.getAttribute('data-om-exportable-video-with-duration-secs'), sync: svg.hasAttribute('data-om-sync-seek'),
             scenes: JSON.parse(window.OM_SCENES).reduce((s, x) => s + x.dur, 0), authored: hq.total };
  })()`), 'the trailer to mount');
  if (!ready.sync) throw new Error('stage does not advertise data-om-sync-seek (ReactDOM.flushSync missing?)');
  if (Math.abs(ready.total - ready.scenes) > 1e-6) throw new Error(`stage duration ${ready.total}s != scene total ${ready.scenes}s`);
  log(`mounted: total ${ready.total}s (scenes ${ready.scenes}s), sync seek ok`);
  await js(PAGE_HELPERS);

  // ---- pre-roll: visit the whole timeline once so every glyph's font subset loads ----
  for (let t = 0; t < ready.total; t += 0.5) await js(`window.__hqSeek(${t})`);
  const fonts = await poll(() => js(`(async () => {
    const svg = window.__hqStage();
    if (svg.getAttribute('data-om-fonts-inlined') !== 'true') return null;
    await document.fonts.ready;
    const res = await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(w + ' 30px "IBM Plex Mono"', 'Aa0')));
    const ok = res.every((faces) => faces.some((f) => f.status === 'loaded'));
    return { ok, weights: res.map((faces) => faces.length) };
  })()`), 'fonts', 60000);
  if (!fonts.ok) throw new Error(`IBM Plex Mono did not load (${JSON.stringify(fonts.weights)}) — the render needs network for Google Fonts; refusing to render in a fallback font`);

  // ---- geometry + chrome check ----
  const geo = await js(`(() => {
    const svg = window.__hqStage(), r = svg.getBoundingClientRect();
    const misses = [];
    for (let y = 5; y < ${H}; y += 107) for (let x = 5; x < ${W}; x += 191) {
      const el = document.elementFromPoint(x, y);
      if (!el || !(el === svg || svg.contains(el))) misses.push([x, y, el ? (el.tagName + '.' + (el.className && el.className.baseVal !== undefined ? '' : el.className)) : 'none']);
    }
    return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio,
             transform: getComputedStyle(svg).transform, misses };
  })()`);
  if (geo.x !== 0 || geo.y !== 0 || geo.w !== W || geo.h !== H || geo.dpr !== 1 || geo.iw < W || geo.ih < H || (geo.transform !== 'none' && geo.transform !== 'matrix(1, 0, 0, 1, 0, 0)')) {
    throw new Error(`stage geometry is off: ${JSON.stringify(geo)}`);
  }
  if (geo.misses.length) throw new Error(`something other than the stage is in frame: ${JSON.stringify(geo.misses.slice(0, 5))}`);
  log(`geometry ok: ${geo.w}x${geo.h} at 0,0, dpr 1; chrome check: 0 foreign elements over the frame`);

  const rect = { x: 0, y: 0, width: W, height: H };
  const frames = (k) => js(`new Promise((r) => { let n = ${k}; const f = () => (--n > 0 ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })`);
  const capture = async (t) => {
    const img = await wc.capturePage(rect);
    const sz = img.getSize();
    if (img.isEmpty() || sz.width !== W || sz.height !== H) throw new Error(`capture at ${t}s is ${sz.width}x${sz.height} (empty: ${img.isEmpty()})`);
    return { img, sha: sha(img.toBitmap()) };
  };
  // A capture right after the paint can still show the previous frame, or a
  // frame whose tiles are only partly rastered. So a frame is accepted only
  // when two captures, two animation frames apart, are pixel-identical.
  const settle = { total: 0, max: 0 };
  const grab = async (t) => {
    const label = await js(`window.__hqSeek(${t})`);
    const want = `t=${Math.floor(t)}s`;
    if (label !== want) throw new Error(`seek to ${t}s rendered ${label}, expected ${want}`);
    let prev = await capture(t);
    for (let i = 0; i < 10; i++) {
      await frames(2);
      const cur = await capture(t);
      if (cur.sha === prev.sha) { settle.total += i; settle.max = Math.max(settle.max, i); return cur.img; }
      prev = cur;
    }
    throw new Error(`frame at ${t}s never settled (10 captures all differed)`);
  };

  const tag = `hq-trailer-${args.trailer}`;
  if (args.stills) {
    // ---- spike mode: stills (+ optional determinism check) ----
    const report = [];
    for (const t of args.stills) {
      if (t >= ready.total) throw new Error(`still ${t}s is past the end (${ready.total}s)`);
      const img = await grab(t);
      assertNotBlank(img, `still ${t}s`);
      const png = img.toPNG();
      const file = path.join(OUT, `${tag}-still-${String(t).replace('.', '_')}.png`);
      fs.writeFileSync(file, png);
      const row = { t, file: path.relative(HERE, file), bitmapSha: sha(img.toBitmap()), pngSha: sha(png) };
      if (args.repeat) {
        await grab((t + 7.3) % ready.total); // go somewhere else first
        const again = await grab(t);
        const a = img.toBitmap(), b2 = again.toBitmap();
        row.repeatBitmapSha = sha(b2);
        row.identical = row.repeatBitmapSha === row.bitmapSha;
        if (!row.identical) {
          let n = 0, max = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
          for (let p = 0; p < a.length; p += 4) {
            const d = Math.max(Math.abs(a[p] - b2[p]), Math.abs(a[p + 1] - b2[p + 1]), Math.abs(a[p + 2] - b2[p + 2]));
            if (!d) continue;
            n++; if (d > max) max = d;
            const px = (p / 4) % W, py = Math.floor(p / 4 / W);
            if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
          }
          row.diff = { pixels: n, maxDelta: max, box: [x0, y0, x1, y1] };
          fs.writeFileSync(file.replace(/\.png$/, '-repeat.png'), again.toPNG());
          log(`  differs on repeat: ${n} px, max channel delta ${max}, box ${row.diff.box.join(',')}`);
        }
      }
      report.push(row);
      log(`still ${t}s → ${row.file}${args.repeat ? (row.identical ? '  [identical on repeat]' : '  [DIFFERENT on repeat]') : ''}`);
    }
    fs.writeFileSync(path.join(OUT, `${tag}.stills.json`), JSON.stringify({ trailer: args.trailer, gpu: args.gpu, report }, null, 2));
    if (args.repeat && report.some((r) => !r.identical)) throw new Error('determinism check failed: the same time rendered differently');
  } else {
    // ---- video mode: every frame → ffmpeg → silent x264 master ----
    const total = Math.round(ready.total * args.fps);
    const n = args.frames ? Math.min(args.frames, total) : total;
    const master = path.join(OUT, `${tag}.master.mp4`);
    const part = path.join(OUT, `${tag}.master.part.mp4`);
    const { ff, done, ffArgs } = startFfmpeg(part, args.fps);
    const started = Date.now();
    let firstSha = null;
    for (let i = 0; i < n; i++) {
      const t = i / args.fps;
      const img = await grab(t);
      if (i === Math.floor(n / 2)) assertNotBlank(img, `frame ${i}`);
      const png = img.toPNG();
      if (i === 0) firstSha = sha(png);
      await writeFrame(ff, png);
      if (i % 60 === 0 || i === n - 1) {
        const per = (Date.now() - started) / (i + 1);
        log(`frame ${i + 1}/${n}  t=${t.toFixed(3)}s  ${per.toFixed(0)} ms/frame  eta ${(((n - i - 1) * per) / 1000).toFixed(0)}s`);
      }
    }
    ff.stdin.end();
    await done;
    fs.renameSync(part, master);
    const manifest = {
      trailer: args.trailer, fps: args.fps, frames: n, complete: n === total, durationSec: ready.total,
      width: W, height: H, gpu: args.gpu, electron: process.versions.electron, chrome: process.versions.chrome,
      renderedAt: new Date().toISOString(), renderSeconds: Math.round((Date.now() - started) / 1000),
      firstFramePngSha: firstSha, master: path.basename(master), ffmpeg: ffArgs.join(' '),
      settle: { extraCapturesTotal: settle.total, extraCapturesMax: settle.max }, audio: null, outro, honesty: { ...honesty, site: undefined },
    };
    fs.writeFileSync(path.join(OUT, `${tag}.render.json`), JSON.stringify(manifest, null, 2));
    log(`master: ${master} (${n} frames, ${manifest.renderSeconds}s)`);
  }
  win.destroy();
  await srv.close();
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((e) => { console.error('[trailer] FAILED:', e && e.stack ? e.stack : e); app.exit(1); });
app.on('window-all-closed', () => {});
