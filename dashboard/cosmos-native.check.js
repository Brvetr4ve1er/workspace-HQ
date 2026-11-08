'use strict';
/* Cosmos space — the Electron-run native check (dashboard/cosmos-native.check.js).

   Plain Node tests cannot see the three things that go wrong with thumbnails: Windows shell providers,
   BGRA vs RGBA from nativeImage.toBitmap(), and a canvas tainted by a file:// image. This script runs the real
   dashboard/cosmos-electron.js in a real (hidden) Electron and checks them with known colours.

     dashboard\node_modules\electron\dist\electron.exe dashboard\cosmos-native.check.js [--avif=<file>] [--dry-run=<folder>]

   Exit codes copy dashboard-v5/dev-main.js: 0 clean, 1 a check failed, 2 timed out after 60 s.
   A hidden test instance: its own userData under os.tmpdir() (named by HQ_COSMOS_CHECK_PROFILE), no single-instance
   lock, no tray, no shortcuts, no visible window. It cannot touch the owner's running app.

   HQ_COSMOS_CHECK_BREAK=bgr   test-only: turns the BGRA->RGBA swap OFF; the run must then exit 1 (it proves
                               the check can fail).
   --avif=<file>               a tiny AVIF fixture you supply (no encoder exists offline, nothing is downloaded);
                               without it the AVIF case says "not covered".
   --dry-run=<folder>          instead of the cases: walk that folder read-only, thumbnail each picture/video one at
                               a time and print ONLY counts per extension (`ext ok failed`) and a total. Never a
                               file name or a path. Exit 0 when it ran, 1 when the folder cannot be read.

   Cases are built at run time into a temp folder that is removed afterwards. The verdict logic (what is a pass,
   a skip, "not covered" or a failure, and the exit code) is the pure dashboard/cosmos/checkplan.mjs. */

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argv = process.argv;
const opt = (k) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY_RUN = opt('dry-run');
const AVIF = opt('avif');
const BREAK_BGR = process.env.HQ_COSMOS_CHECK_BREAK === 'bgr';
const TIMEOUT_MS = 60000;
const DRY_RUN_TIMEOUT_MS = 30 * 60 * 1000;     // a real folder takes as long as it takes

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_COSMOS_CHECK_PROFILE || 'hq-cosmos-check-profile'));
app.on('window-all-closed', () => { /* the decode window comes and goes; do not quit when it does */ });

let finished = false;
function finish(code, line) {            // same shape as dev-main.js finish()
  if (finished) return;
  finished = true;
  const exit = () => app.exit(code);
  process.stdout.write(line + '\n', exit);
  setTimeout(exit, 1500);                // in case the write callback never fires
}
const say = (line) => process.stdout.write('[cosmos-native] ' + line + '\n');
const imp = (rel) => import(pathToFileURL(path.join(__dirname, rel)).href);
const yieldNow = () => new Promise((resolve) => setImmediate(resolve));
// --dry-run must never print a path, and an fs error message carries one: details are withheld there
const messageOf = (e) => (DRY_RUN ? 'error (details withheld in --dry-run)' : String((e && e.message) || e).slice(0, 200));

// the decode window records one second of solid green through MediaRecorder; answers {ok, b64} or {unsupported}
const RECORD_WEBM_SCRIPT = [
  '(() => new Promise((resolve) => {',
  '  try {',
  "    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/webm')) return resolve({ unsupported: true });",
  "    const c = document.createElement('canvas'); c.width = 160; c.height = 120;",
  "    if (!c.captureStream) return resolve({ unsupported: true });",
  "    const g = c.getContext('2d');",
  "    const mr = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });",
  '    const chunks = [];',
  '    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };',
  '    mr.onstop = async () => {',
  "      const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());",
  "      let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));",
  '      resolve(bytes.length ? { ok: true, b64: btoa(s) } : { unsupported: true });',
  '    };',
  '    mr.start();',
  '    let n = 0;',
  "    const t = setInterval(() => { g.fillStyle = '#00ff00'; g.fillRect(0, 0, 160, 120); if (++n >= 15) { clearInterval(t); mr.stop(); } }, 100);",
  '  } catch (e) { resolve({ unsupported: true }); }',
  '}))()',
].join('\n');

// WebP encode through the decode window's canvas; answers a data URL or null
const ENCODE_WEBP_SCRIPT = [
  '(() => {',
  "  const c = document.createElement('canvas'); c.width = 64; c.height = 64;",
  "  const g = c.getContext('2d'); g.fillStyle = '#00ff00'; g.fillRect(0, 0, 64, 64);",
  "  const u = c.toDataURL('image/webp', 0.9);",
  "  return u.indexOf('data:image/webp') === 0 ? u : null;",
  '})()',
].join('\n');

// an <img> pointing at a closed local port; answers 'error' | 'loaded' | 'timeout'
const NETWORK_PROBE_SCRIPT = [
  '(() => new Promise((resolve) => {',
  "  const i = new Image();",
  "  i.onload = () => resolve('loaded');",
  "  i.onerror = () => resolve('error');",
  "  setTimeout(() => resolve('timeout'), 4000);",
  "  i.src = 'http://127.0.0.1:9/x';",
  '}))()',
].join('\n');

function validThumb(t) {
  return !!(t && t.jpeg && t.jpeg.length > 4 && t.jpeg[0] === 0xff && t.jpeg[1] === 0xd8
    && t.rgba32 && t.rgba32.data && t.rgba32.data.length === 32 * 32 * 4 && t.gray9x8 && t.gray9x8.length === 72);
}

async function main() {
  const [plan, imgs, infer, lib] = await Promise.all([
    imp('cosmos/checkplan.mjs'), imp('cosmos/testimages.mjs'), imp('cosmos/infer.mjs'), imp('cosmos/decode.mjs'),
  ]);
  const real = require('electron');
  let shellRejects = false;               // the fallback-order case flips this for one thumbnail
  const electron = {
    dialog: real.dialog, shell: real.shell, BrowserWindow: real.BrowserWindow, app: real.app,
    nativeImage: {
      createFromPath: (p) => real.nativeImage.createFromPath(p),
      createFromBuffer: (b) => real.nativeImage.createFromBuffer(b),
      createThumbnailFromPath: (p, o) => (shellRejects ? Promise.reject(new Error('forced shell failure')) : real.nativeImage.createThumbnailFromPath(p, o)),
    },
  };
  const { makeDeps } = require('./cosmos-electron.js');
  const deps = makeDeps({ getWin: () => null, electron, bgrSwap: !BREAK_BGR, videoFallback: true });
  const native = deps.__native;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cosmos-check-'));
  const cleanup = () => { try { deps.dispose(); } catch { /* ignore */ } try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };

  try {
    if (DRY_RUN) return await dryRun(deps, infer, plan, cleanup);

    if (BREAK_BGR) say('HQ_COSMOS_CHECK_BREAK=bgr: the BGRA->RGBA swap is OFF, this run must fail');
    const hasExtractor = fs.existsSync(path.join(__dirname, 'cosmos', 'colorextract.mjs'));
    const extractor = hasExtractor ? await imp('cosmos/colorextract.mjs') : null;
    const avifFile = AVIF && fs.existsSync(AVIF) ? AVIF : null;
    if (AVIF && !avifFile) say('--avif: that file was not found, the AVIF case stays "not covered"');
    const cases = plan.buildCases({ avifFile, hasExtractor });

    const timer = setTimeout(() => {
      cleanup();
      finish(plan.EXIT.TIMED_OUT, '[cosmos-native] ' + plan.finalLine(results, { timedOut: true }));
    }, TIMEOUT_MS);
    const results = [];

    // ---- builders: write the case's file, or say this machine cannot ----
    const write = (def, ext, bytes) => {
      const f = path.join(tmp, def.id.replace(/[^a-z0-9]+/gi, '_') + ext);
      fs.writeFileSync(f, bytes);
      return f;
    };
    async function build(def) {
      const k = def.file.kind, c = def.file.color;
      if (k === 'png') return { file: write(def, '.png', imgs.solidPng(c.r, c.g, c.b, 64, 64)), ext: '.png' };
      if (k === 'jpeg') {
        const jpg = real.nativeImage.createFromBuffer(imgs.solidPng(c.r, c.g, c.b, 64, 64)).toJPEG(90);
        return { file: write(def, '.jpg', jpg), ext: '.jpg' };
      }
      if (k === 'bmp') return { file: write(def, '.bmp', imgs.solidBmp(c.r, c.g, c.b, 32, 32)), ext: '.bmp' };
      if (k === 'svg') return { file: write(def, '.svg', imgs.solidSvg(plan.rgbToHex(c))), ext: '.svg' };
      if (k === 'webp') {
        const url = await native.run(ENCODE_WEBP_SCRIPT);
        const parsed = typeof url === 'string' ? lib.parseDataUrl(url) : null;
        if (!parsed) return { unsupported: true, note: 'Chromium cannot encode WebP here' };
        return { file: write(def, '.webp', parsed.buffer), ext: '.webp' };
      }
      if (k === 'avif') return { file: def.file.path, ext: '.avif' };
      if (k === 'webm') {
        const r = await native.run(RECORD_WEBM_SCRIPT);
        if (!r || !r.ok) return { unsupported: true, note: 'MediaRecorder cannot record a webm here' };
        return { file: write(def, '.webm', Buffer.from(r.b64, 'base64')), ext: '.webm', video: true };
      }
      throw new Error('unknown case file kind');
    }

    // ---- the runners ----
    async function colourCase(def) {
      const built = await build(def);
      if (built.unsupported) return plan.classify(def, { unsupported: true, note: built.note });
      shellRejects = !!def.shellRejects;
      const taintedBefore = native.stats().tainted;
      let t;
      try {
        const only = def.strategy && def.strategy !== 'default' ? [def.strategy] : undefined;
        t = await deps.thumbnail(built.file, { ext: built.ext, kind: built.video ? 'video' : 'image', size: fs.statSync(built.file).size, only });
      } finally { shellRejects = false; }
      const obs = { tainted: native.stats().tainted > taintedBefore, produced: validThumb(t), rgba32: t && t.rgba32 };
      if (built.video && !native.videoCaptureOk()) return plan.classify(def, { unsupported: true, note: 'a hidden window cannot be captured on this machine' });
      if (obs.produced && def.viaExtractor) {
        const found = extractor.extractColors(t.rgba32);
        const rgb = found && found.color ? plan.hexToRgb(found.color.hex) : null;
        if (!rgb) { obs.produced = false; } else { obs.rgba32 = { width: 1, height: 1, data: Uint8Array.from([rgb.r, rgb.g, rgb.b, 255]) }; }
      }
      return plan.classify(def, obs);
    }

    async function networkCase(def) {
      const before = native.stats().cancelled;
      const page = await native.run(NETWORK_PROBE_SCRIPT);     // the CSP stops it first; an error is what we want
      // the same request filter the session runs, driven directly: it must cancel the network and let file through
      let net = null, file = null;
      native.handler({ url: 'http://127.0.0.1:9/x' }, (r) => { net = r; });
      native.handler({ url: pathToFileURL(path.join(tmp, 'x.png')).href }, (r) => { file = r; });
      const cancelCounted = native.stats().cancelled > before && !!net && net.cancel === true && !!file && file.cancel === false;
      const res = plan.classify(def, { pageError: page === 'error', cancelCounted });
      return { ...res, note: res.note || `page request: ${page}; filter cancels network, allows file` };
    }

    async function loopCase(def) {
      const png = imgs.solidPng(40, 120, 200, def.edge, def.edge);      // built BEFORE the probe starts
      const files = [];
      for (let i = 0; i < def.count; i++) files.push(write({ id: `loop-${i}` }, '.png', png));
      const size = png.length;
      let last = Date.now(), maxGap = 0;
      const probe = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last - 50); last = now; }, 50);
      let produced = 0;
      try {
        for (const f of files) { if (validThumb(await deps.thumbnail(f, { ext: '.png', kind: 'image', size }))) produced++; }
      } finally { clearInterval(probe); }
      maxGap = Math.max(maxGap, Date.now() - last - 50, 0);
      if (produced !== files.length) return plan.classify(def, { error: `${produced} of ${files.length} thumbnails came back` });
      return plan.classify(def, { maxGapMs: maxGap });
    }

    for (const def of cases) {
      let res;
      try {
        if (def.group === 'static') res = plan.classify(def);
        else if (def.group === 'network') res = await networkCase(def);
        else if (def.group === 'loop') res = await loopCase(def);
        else res = await colourCase(def);
      } catch (e) {
        res = plan.classify(def, { error: messageOf(e) });
      }
      results.push({ id: def.id, ...res });
      say(plan.formatCaseLine(def, res));
      await yieldNow();
    }

    clearTimeout(timer);
    cleanup();
    finish(plan.exitCodeFor(results), '[cosmos-native] ' + plan.finalLine(results));
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function dryRun(deps, infer, plan, cleanup) {
  const folder = DRY_RUN;
  let isDir = false;
  try { isDir = fs.statSync(folder).isDirectory(); } catch { isDir = false; }
  if (!isDir) { cleanup(); return finish(1, '[cosmos-native] dry-run: that folder cannot be read'); }
  const exts = new Set([...infer.IMAGE_EXT, ...infer.VIDEO_EXT, '.tif', '.tiff', '.ico']);
  const counts = {};
  const stack = [folder];
  const timer = setTimeout(() => { cleanup(); finish(plan.EXIT.TIMED_OUT, '[cosmos-native] dry-run timed out'); }, DRY_RUN_TIMEOUT_MS);
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;
      let size;
      try { size = (await fs.promises.stat(full)).size; } catch { size = undefined; }
      const kind = infer.VIDEO_EXT.has(ext) ? 'video' : 'image';
      const t = await deps.thumbnail(full, { ext, kind, size });        // concurrency 1
      const bucket = (counts[ext.slice(1)] = counts[ext.slice(1)] || { ok: 0, failed: 0 });
      if (validThumb(t)) bucket.ok++; else bucket.failed++;
    }
  }
  clearTimeout(timer);
  cleanup();
  finish(0, plan.formatDryRun(counts));
}

process.on('unhandledRejection', (e) => finish(1, '[cosmos-native] unhandled rejection: ' + messageOf(e)));
app.whenReady().then(() => {
  if (!DRY_RUN) setTimeout(() => finish(2, '[cosmos-native] timed out after ' + TIMEOUT_MS / 1000 + ' s'), TIMEOUT_MS + 5000).unref();
  return main();
}).catch((e) => finish(1, '[cosmos-native] the check crashed: ' + messageOf(e)));
