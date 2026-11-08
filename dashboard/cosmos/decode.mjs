/* Cosmos space — the pure half of thumbnailing (dashboard/cosmos/decode.mjs). No IO, no clock, no
   electron: the Electron half (dashboard/cosmos-electron.js) injects everything it touches.

   What lives here
   - planFor(ext, kind, size, opts): which decode strategies to try for a file, cheapest ASYNC first.
     nativeImage.createFromPath is SYNCHRONOUS and stalls the main process and every window while a large
     file decodes, so the async 'shell' strategy (Windows thumbnail providers) always goes first and
     'native-file' is dropped for a big file.
   - bgraToRgba: THE colour trap. nativeImage.toBitmap() is BGRA on Windows; everything downstream
     (extractColors, the dHash gray grid) wants RGBA. Forget the swap and every colour search is blue-shifted.
   - grayGrid, fitWithin, mimeFor, and the small data-URL and page-script builders the Chromium fallback uses.

   The Chromium fallback never draws a file: URL onto a canvas (each file: URL is its own opaque origin, so
   the canvas is tainted and toDataURL throws). Main reads the bytes and hands the page a data: URL, which is
   same-origin for canvas purposes. imageScript() therefore contains no file: URL by construction. */

export const EDGE = 560;
export const JPEG_QUALITY = 82;
export const NATIVE_FILE_MAX_BYTES = 25 * 1024 * 1024;   // above this createFromPath is not tried (it blocks)
export const CHROMIUM_MAX_BYTES = 32 * 1024 * 1024;      // above this the Chromium fallback gives up (null)

const NATIVE_FILE_EXT = new Set(['png', 'jpg', 'jpeg', 'ico']);   // a real Electron run showed createFromPath does NOT decode BMP
const SHELL_CHROMIUM_EXT = new Set(['gif', 'webp', 'avif', 'svg', 'tiff', 'tif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
};

/** '.PNG' / 'png' / 'Png' -> 'png'. Anything that is not a string -> ''. */
export function normExt(ext) {
  return typeof ext === 'string' ? ext.trim().toLowerCase().replace(/^\./, '') : '';
}

/** MIME type for an extension, or null when unknown. */
export function mimeFor(ext) {
  const e = normExt(ext);
  return Object.prototype.hasOwnProperty.call(MIME, e) ? MIME[e] : null;
}

/**
 * Ordered strategies for one file. 'shell' = createThumbnailFromPath (async), 'native-file' = createFromPath
 * (sync), 'chromium' = the hidden decode window with a data: URL, 'chromium-video' = the hidden window showing
 * the video. A size that is not a finite number counts as unknown and drops 'native-file' (stall risk).
 * opts.videoCapture === false removes 'chromium-video' (the machine could not capture a hidden window).
 */
export function planFor(ext, kind, size, opts = {}) {
  const e = normExt(ext);
  const videoCapture = !(opts && opts.videoCapture === false);
  if (VIDEO_EXT.has(e) || (!Object.prototype.hasOwnProperty.call(MIME, e) && kind === 'video')) {
    return videoCapture ? ['shell', 'chromium-video'] : ['shell'];
  }
  if (NATIVE_FILE_EXT.has(e)) {
    const small = Number.isFinite(size) && size <= NATIVE_FILE_MAX_BYTES;
    return small ? ['shell', 'native-file', 'chromium'] : ['shell', 'chromium'];
  }
  if (SHELL_CHROMIUM_EXT.has(e)) return ['shell', 'chromium'];
  return ['shell'];                                        // an extension nobody knows: only the shell may try
}

/** Fit w x h inside edge x edge keeping the ratio, never upscaling. null for unusable input. */
export function fitWithin(w, h, edge) {
  if (![w, h, edge].every((n) => Number.isFinite(n) && n > 0)) return null;
  const s = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Swap R and B of a BGRA buffer. Returns a NEW Uint8Array; the input is never touched. */
export function bgraToRgba(buf) {
  if (!buf || typeof buf.length !== 'number' || buf.length % 4 !== 0) {
    throw new RangeError('bgraToRgba wants a byte array whose length is a multiple of 4');
  }
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
    out[i + 3] = buf[i + 3];
  }
  return out;
}

/** Luma (0.299 R + 0.587 G + 0.114 B, rounded) of each pixel of an RGBA w x h grid; length w*h. */
export function grayGrid(rgba, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new RangeError('grayGrid wants a positive w and h');
  if (!rgba || rgba.length < w * h * 4) throw new RangeError('grayGrid: the pixel buffer is shorter than w*h*4');
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    out[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return out;
}

/** 'data:<mime>;base64,<...>' for a byte buffer. */
export function toDataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Inverse of toDataUrl for base64 data URLs: {mime, buffer} or null. */
export function parseDataUrl(text) {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=]*)$/.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  return buffer.length ? { mime: m[1], buffer } : null;
}

/**
 * The script the decode window runs for an image: load the data: URL, draw it scaled to fit edge x edge on the
 * page's canvas, answer {ok, dataUrl (JPEG 0.82), width, height, sourceWidth, sourceHeight} or
 * {ok:false, error, tainted}. It never contains a file: URL, so the canvas stays clean. A raster is never
 * upscaled; an SVG (`upscale`) is, because a vector has no pixels to lose.
 */
export function imageScript(dataUrl, edge, upscale) {
  const e = Math.max(1, Math.floor(Number(edge) || EDGE));
  return `(() => new Promise((resolve) => {
  const fail = (err) => resolve({ ok: false, error: String((err && err.message) || err), tainted: !!(err && err.name === 'SecurityError') });
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const nw = img.naturalWidth, nh = img.naturalHeight;
        const bw = nw || ${e}, bh = nh || ${e};
        let s = ${e} / Math.max(bw, bh);
        if (!${upscale ? 'true' : 'false'} && s > 1) s = 1;
        const w = Math.max(1, Math.round(bw * s)), h = Math.max(1, Math.round(bh * s));
        const c = document.getElementById('c') || document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ ok: true, dataUrl: c.toDataURL('image/jpeg', 0.82), width: w, height: h, sourceWidth: nw || null, sourceHeight: nh || null });
      } catch (err) { fail(err); }
    };
    img.onerror = () => fail(new Error('decode-failed'));
    img.src = ${JSON.stringify(String(dataUrl))};
  } catch (err) { fail(err); }
}))()`;
}

/**
 * The script for a video: show it muted, seek to min(1 s, 10% of the duration), answer
 * {ok, sourceWidth, sourceHeight, duration} when a frame is ready. Main then captures the window.
 * (A video is shown, never drawn on a canvas, so there is nothing to taint.)
 */
export function videoScript(fileUrl) {
  return `(() => new Promise((resolve) => {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  try {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;object-fit:fill;background:#000';
    const ready = () => setTimeout(() => done({ ok: true, sourceWidth: v.videoWidth, sourceHeight: v.videoHeight, duration: isFinite(v.duration) ? v.duration : null }), 120);
    v.onerror = () => done({ ok: false, error: 'video-decode-failed' });
    v.onloadedmetadata = () => {
      if (!v.videoWidth || !v.videoHeight) return done({ ok: false, error: 'no-video-track' });
      const d = v.duration;
      const t = isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 0;
      if (t > 0) { v.onseeked = ready; v.currentTime = t; }
      else if (v.readyState >= 2) ready();
      else v.onloadeddata = ready;
    };
    document.body.appendChild(v);
    v.src = ${JSON.stringify(String(fileUrl))};
  } catch (err) { done({ ok: false, error: String((err && err.message) || err) }); }
}))()`;
}

/** Releases any video the page holds (a playing element keeps the file open on Windows). */
export function videoCleanupScript() {
  return `(() => { document.querySelectorAll('video').forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch (e) {} }); return true; })()`;
}
