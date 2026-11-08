'use strict';
/* Cosmos space — the Electron half (dashboard/cosmos-electron.js). The ONLY file of the space that touches
   `electron`; `require('electron')` happens inside makeDeps, so plain-Node tests inject a fake and the rest of
   the space never loads it. The pure half (strategy plan, the BGRA->RGBA swap, the luma grid, the page scripts)
   is dashboard/cosmos/decode.mjs.

   DEPS TYPEDEF (the seam with cosmos-main; word for word the text in its spec):
     pickFolder() -> Promise<string|null>; pickFile({title,filters}) -> Promise<string|null>;
     trash(abs) -> Promise<void> (rejects with the failure); reveal(abs) -> void;
     thumbnail(abs,{ext,kind,edge,size}) -> Promise<null|{jpeg:Buffer,width,height,sourceWidth:number|null,
     sourceHeight:number|null,rgba32:{width,height,data:Uint8Array},gray9x8:Uint8Array}> (never throws); dispose().

   @typedef {Object} CosmosDeps
   @property {() => Promise<string|null>} pickFolder
   @property {(o?: {title?: string, filters?: Array<{name: string, extensions: string[]}>}) => Promise<string|null>} pickFile
   @property {(abs: string) => Promise<void>} trash                 rejects with the failure
   @property {(abs: string) => void} reveal
   @property {(abs: string, o?: {ext?: string, kind?: string, edge?: number, size?: number}) =>
       Promise<null|{jpeg: Buffer, width: number, height: number, sourceWidth: number|null, sourceHeight: number|null,
                     rgba32: {width: number, height: number, data: Uint8Array}, gray9x8: Uint8Array}>} thumbnail   never throws
   @property {() => void} dispose

   Thumbnail pipeline. Strategies run in ASYNC-cost order because nativeImage.createFromPath is synchronous and
   would stall the main process and every window while a big file decodes: 'shell' (Windows thumbnail providers,
   a Promise) -> 'native-file' (only <= 25 MB) -> 'chromium' (a hidden decode window) / 'chromium-video'. A
   setImmediate yield runs between strategies and before each file. Every failure is null; the work then renders
   from its original.

   THE COLOUR TRAP: nativeImage.toBitmap() is BGRA on Windows. The 32x32 grid and the 9x8 gray grid are built
   from toBitmap(), so decode.bgraToRgba swaps R and B before anything downstream sees them.

   THE TAINT TRAP: a file:// page that draws a file:// image taints its canvas (each file: URL is its own
   opaque origin) and toDataURL then throws. So an image is never drawn from a file: URL: main reads the bytes
   and the page gets a data: URL. Video is shown and captured by the window (capturePage), no canvas.

   Test seams (all optional, all behind makeDeps options): electron, fs, videoFallback (off in production; the native check turns it on to measure the video strategy), bgrSwap (the native check's
   HQ_COSMOS_CHECK_BREAK=bgr turns the swap off to prove the check can fail), timeoutMs, idleMs, settleMs. */

const nodeFs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CALL_TIMEOUT_MS = 8000;      // each call into the decode window
const IDLE_MS = 60000;             // the window is destroyed after this long unused
const SETTLE_MS = 150;             // a video window needs a moment to repaint after it is resized
const DECODE_PAGE = path.join(__dirname, 'cosmos-decode.html');
const ALLOWED_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:']);

let decodeLib = null;              // dashboard/cosmos/decode.mjs, loaded once
function decode() {
  if (!decodeLib) {
    decodeLib = import(pathToFileURL(path.join(__dirname, 'cosmos', 'decode.mjs')).href).catch((e) => { decodeLib = null; throw e; });
  }
  return decodeLib;
}

const yieldNow = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The decode window's request filter: only file, data, blob and devtools may load; everything else is cancelled. */
function isAllowedRequestUrl(url) {
  try { return ALLOWED_SCHEMES.has(new URL(String(url)).protocol); } catch { return false; }
}

/**
 * @param {{getWin?: () => any, dataDir?: string, electron?: any, fs?: any, bgrSwap?: boolean, videoFallback?: boolean,
 *          timeoutMs?: number, idleMs?: number, settleMs?: number}} [opts]
 * @returns {CosmosDeps}
 */
function makeDeps(opts = {}) {
  const getWin = typeof opts.getWin === 'function' ? opts.getWin : () => null;
  const fs = opts.fs || nodeFs;
  const bgrSwap = opts.bgrSwap !== false;
  // OFF by default: the hidden-window video capture was not proven on this machine (the native check's webm came back
  // with a shifted colour), so a video without a shell thumbnail gets thumb:null and renders from the original.
  const videoFallback = opts.videoFallback === true;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : CALL_TIMEOUT_MS;
  const idleMs = Number.isFinite(opts.idleMs) ? opts.idleMs : IDLE_MS;
  const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : SETTLE_MS;
  const electron = opts.electron || require('electron');
  const { dialog, shell, nativeImage, BrowserWindow, app } = electron;

  /* ---------- the one hidden decode window ---------- */
  let win = null;
  let chain = Promise.resolve();         // calls into the window run one at a time
  let idleTimer = null;
  let videoCaptureOk = true;             // false once a hidden-window capture came back empty on this machine
  const stats = { cancelled: 0, allowed: 0, tainted: 0, timeouts: 0 };

  function requestHandler(details, callback) {
    const ok = isAllowedRequestUrl(details && details.url);
    if (ok) stats.allowed++; else stats.cancelled++;
    callback({ cancel: !ok });
  }

  const alive = (w) => { try { return !!w && !(w.isDestroyed && w.isDestroyed()); } catch { return false; } };

  function destroyWin() {
    const w = win;
    win = null;
    if (alive(w)) { try { w.destroy(); } catch { /* already gone */ } }
  }

  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  function armIdle() {
    clearIdle();
    if (idleMs > 0) {
      idleTimer = setTimeout(() => { idleTimer = null; destroyWin(); }, idleMs);
      if (idleTimer.unref) idleTimer.unref();
    }
  }

  async function ensureWin() {
    if (alive(win)) return win;
    const w = new BrowserWindow({
      show: false, width: 560, height: 560, useContentSize: true, frame: false, skipTaskbar: true,
      webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'cosmos-decode', backgroundThrottling: false,
      },
    });
    win = w;
    const wc = w.webContents;
    const ses = wc.session;
    ses.webRequest.onBeforeRequest(requestHandler);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    if (typeof ses.setPermissionCheckHandler === 'function') ses.setPermissionCheckHandler(() => false);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('render-process-gone', () => { if (win === w) win = null; });
    await w.loadFile(DECODE_PAGE);
    return w;
  }

  /** Serialised, 8 s timeout (or whatever timeoutMs is). A timeout destroys the window; the next call makes a fresh one. */
  function runWindow(task) {
    const p = chain.then(async () => {
      clearIdle();
      let timer = null;
      let timedOut = false;
      try {
        const limit = new Promise((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('the decode window timed out')); }, timeoutMs);
        });
        const work = (async () => task(await ensureWin()))();
        work.catch(() => {});           // a task that outlives its timeout must not become an unhandled rejection
        return await Promise.race([work, limit]);
      } catch (e) {
        if (timedOut) { stats.timeouts++; destroyWin(); }
        throw e;
      } finally {
        clearTimeout(timer);
        armIdle();
      }
    });
    chain = p.then(() => {}, () => {});
    return p;
  }

  const onQuit = () => destroyWin();
  if (app && typeof app.once === 'function') app.once('before-quit', onQuit);

  /* ---------- strategies: each answers {img, sourceWidth, sourceHeight, jpeg?} or null ---------- */

  async function viaShell(abs, edge) {
    if (!nativeImage || typeof nativeImage.createThumbnailFromPath !== 'function') return null;
    const img = await nativeImage.createThumbnailFromPath(abs, { width: edge, height: edge });
    if (!img || img.isEmpty()) return null;
    return { img, sourceWidth: null, sourceHeight: null };
  }

  async function viaNativeFile(abs) {
    const img = nativeImage.createFromPath(abs);
    if (!img || img.isEmpty()) return null;
    const s = img.getSize();
    return { img, sourceWidth: s.width || null, sourceHeight: s.height || null };
  }

  async function viaChromiumImage(abs, ext, size, edge, lib) {
    const mime = lib.mimeFor(ext);
    if (!mime || !mime.startsWith('image/')) return null;
    let bytes = size;
    if (!Number.isFinite(bytes)) bytes = (await fs.promises.stat(abs)).size;
    if (bytes > lib.CHROMIUM_MAX_BYTES) return null;                    // too big to hand to a page; never read
    const buf = await fs.promises.readFile(abs);
    if (!buf || buf.length > lib.CHROMIUM_MAX_BYTES) return null;
    const script = lib.imageScript(lib.toDataUrl(mime, buf), edge, mime === 'image/svg+xml');
    const r = await runWindow((w) => w.webContents.executeJavaScript(script, true));
    if (r && r.tainted) stats.tainted++;
    if (!r || !r.ok) return null;
    const parsed = lib.parseDataUrl(r.dataUrl);
    if (!parsed) return null;
    const img = nativeImage.createFromBuffer(parsed.buffer);
    if (!img || img.isEmpty()) return null;
    return { img, sourceWidth: r.sourceWidth || null, sourceHeight: r.sourceHeight || null, jpeg: parsed.buffer };
  }

  async function viaChromiumVideo(abs, edge, lib) {
    const script = lib.videoScript(pathToFileURL(abs).href);
    return runWindow(async (w) => {
      const wc = w.webContents;
      try {
        const r = await wc.executeJavaScript(script, true);
        if (!r || !r.ok) return null;
        const fit = lib.fitWithin(r.sourceWidth, r.sourceHeight, edge);
        if (!fit) return null;
        w.setContentSize(fit.width, fit.height);
        if (settleMs > 0) await delay(settleMs);
        const img = await wc.capturePage();
        if (!img || img.isEmpty()) { videoCaptureOk = false; return null; }   // this machine cannot capture a hidden window
        return { img, sourceWidth: r.sourceWidth || null, sourceHeight: r.sourceHeight || null };
      } finally {
        try { await wc.executeJavaScript(lib.videoCleanupScript(), true); } catch { /* the window may be gone */ }
      }
    });
  }

  /** From the image obtained to the thumbnail record. Throws on anything odd; the caller turns that into "next strategy". */
  function finalize(lib, got, edge) {
    const { img } = got;
    const size = img.getSize();
    const fit = lib.fitWithin(size.width, size.height, edge);
    if (!fit) return null;
    const same = fit.width === size.width && fit.height === size.height;
    const scaled = same ? img : img.resize({ width: fit.width, height: fit.height, quality: 'good' });
    const jpeg = got.jpeg && same ? got.jpeg : scaled.toJPEG(lib.JPEG_QUALITY);
    if (!jpeg || !jpeg.length) return null;

    const rgbaOf = (bitmap) => (bgrSwap ? lib.bgraToRgba(bitmap) : Uint8Array.from(bitmap));   // bgrSwap=false only in the native check's break test
    const bm32 = img.resize({ width: 32, height: 32, quality: 'good' }).toBitmap();
    if (!bm32 || bm32.length !== 32 * 32 * 4) return null;
    const bm9 = img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap();
    if (!bm9 || bm9.length !== 9 * 8 * 4) return null;
    return {
      jpeg,
      width: fit.width,
      height: fit.height,
      sourceWidth: got.sourceWidth ?? null,
      sourceHeight: got.sourceHeight ?? null,
      rgba32: { width: 32, height: 32, data: rgbaOf(bm32) },
      gray9x8: lib.grayGrid(rgbaOf(bm9), 9, 8),
    };
  }

  /* ---------- the deps ---------- */

  const deps = {
    async pickFolder() {
      try {
        const w = getWin();
        const o = { properties: ['openDirectory'] };
        const r = alive(w) ? await dialog.showOpenDialog(w, o) : await dialog.showOpenDialog(o);
        return r && !r.canceled && Array.isArray(r.filePaths) && r.filePaths.length ? String(r.filePaths[0]) : null;
      } catch { return null; }
    },

    async pickFile({ title, filters } = {}) {
      try {
        const w = getWin();
        const o = { properties: ['openFile'] };
        if (typeof title === 'string') o.title = title;
        if (Array.isArray(filters)) o.filters = filters;
        const r = alive(w) ? await dialog.showOpenDialog(w, o) : await dialog.showOpenDialog(o);
        return r && !r.canceled && Array.isArray(r.filePaths) && r.filePaths.length ? String(r.filePaths[0]) : null;
      } catch { return null; }
    },

    async trash(abs) {
      if (typeof abs !== 'string' || !abs) throw new Error('There is no file to move to the Recycle Bin.');
      await shell.trashItem(abs);                       // a rejection bubbles up as the failure message
    },

    reveal(abs) {
      if (typeof abs === 'string' && abs) shell.showItemInFolder(abs);
    },

    async thumbnail(abs, o = {}) {
      try {
        if (typeof abs !== 'string' || !abs) return null;
        const lib = await decode();
        const edge = Number.isFinite(o.edge) && o.edge > 0 ? Math.min(Math.floor(o.edge), 4096) : lib.EDGE;
        await yieldNow();
        let size = Number.isFinite(o.size) ? o.size : null;
        if (size === null) { try { size = (await fs.promises.stat(abs)).size; } catch { size = null; } }
        let plan = lib.planFor(o.ext, o.kind, size, { videoCapture: videoFallback && videoCaptureOk });
        if (Array.isArray(o.only)) plan = plan.filter((s) => o.only.includes(s));   // diagnostics: the native check pins one strategy
        for (const strategy of plan) {
          try {
            let got = null;
            if (strategy === 'shell') got = await viaShell(abs, edge);
            else if (strategy === 'native-file') got = await viaNativeFile(abs);
            else if (strategy === 'chromium') got = await viaChromiumImage(abs, o.ext, size, edge, lib);
            else if (strategy === 'chromium-video') got = await viaChromiumVideo(abs, edge, lib);
            const out = got ? finalize(lib, got, edge) : null;
            if (out) return out;
          } catch { /* this strategy failed; the next one gets its turn */ }
          await yieldNow();
        }
        return null;
      } catch { return null; }
    },

    dispose() {
      clearIdle();
      destroyWin();
      if (app && typeof app.removeListener === 'function') app.removeListener('before-quit', onQuit);
    },
  };

  // Introspection for dashboard/cosmos-native.check.js; not part of the deps contract, not enumerable.
  Object.defineProperty(deps, '__native', {
    enumerable: false,
    value: {
      stats: () => ({ ...stats }),
      handler: requestHandler,
      run: (script) => runWindow((w) => w.webContents.executeJavaScript(script, true)),
      videoCaptureOk: () => videoCaptureOk,
      window: () => (alive(win) ? win : null),
    },
  });

  return deps;
}

module.exports = { makeDeps, isAllowedRequestUrl, CALL_TIMEOUT_MS, IDLE_MS };
