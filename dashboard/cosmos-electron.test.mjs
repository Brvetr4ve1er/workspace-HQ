// Cosmos space — the Electron half (dashboard/cosmos-electron.js) against an injected FAKE electron.
// Plain Node: nothing here starts Electron, opens a window or reads a real picture. Placeholder paths only.
// The real-Electron run is dashboard/cosmos-native.check.js (the integrator runs it).
//   node --test dashboard/cosmos-electron.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { makeDeps, isAllowedRequestUrl, CALL_TIMEOUT_MS, IDLE_MS } = require('./cosmos-electron.js');
const MB = 1024 * 1024;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- fakes ---------- */

function fakeImage(w, h, { bgra = [0, 0, 255, 255], empty = false, log = null, name = 'img' } = {}) {
  return {
    name,
    isEmpty: () => empty,
    getSize: () => ({ width: w, height: h }),
    resize: ({ width, height, quality }) => {
      if (log) log.push(`resize:${width}x${height}:${quality}`);
      return fakeImage(width, height, { bgra, log, name: `${name}>${width}x${height}` });
    },
    toBitmap: () => {
      const b = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) b.set(bgra, i * 4);
      return b;
    },
    toJPEG: (q) => {
      if (log) log.push(`toJPEG:${q}:${w}x${h}`);
      return Buffer.from([0xff, 0xd8, q, 0xff, 0xd9]);
    },
  };
}

const JPEG_FROM_PAGE = Buffer.from([0xff, 0xd8, 82, 0xff, 0xd9]);
const PAGE_OK = {
  ok: true,
  dataUrl: 'data:image/jpeg;base64,' + JPEG_FROM_PAGE.toString('base64'),
  width: 64, height: 64, sourceWidth: 64, sourceHeight: 64,
};

function makeElectron(cfg = {}) {
  const log = { calls: [], dialogs: [], trashed: [], revealed: [], windows: [], scripts: [], images: [] };
  const sessions = [];
  const state = { inflight: 0, maxInflight: 0 };

  const nativeImage = {
    createThumbnailFromPath: cfg.createThumbnailFromPath || (async () => { throw new Error('no shell thumbnail'); }),
    createFromPath: cfg.createFromPath || (() => fakeImage(0, 0, { empty: true })),
    createFromBuffer: cfg.createFromBuffer || ((buf) => { log.calls.push('createFromBuffer'); return fakeImage(64, 64, { bgra: [0, 0, 255, 255], log: log.images }); }),
  };
  const origShell = nativeImage.createThumbnailFromPath;
  nativeImage.createThumbnailFromPath = (...a) => { log.calls.push('shell'); return origShell(...a); };
  const origFile = nativeImage.createFromPath;
  nativeImage.createFromPath = (...a) => { log.calls.push('native-file'); return origFile(...a); };

  class BrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.loaded = null;
      this.contentSize = null;
      const ses = { handlers: {}, webRequest: { onBeforeRequest: (h) => { ses.handlers.beforeRequest = h; } }, setPermissionRequestHandler: (h) => { ses.handlers.permission = h; } };
      sessions.push(ses);
      this.session = ses;
      const self = this;
      this.webContents = {
        session: ses,
        setWindowOpenHandler: (h) => { ses.handlers.windowOpen = h; },
        on: (ev, h) => { ses.handlers[ev] = h; },
        executeJavaScript: async (script) => {
          log.scripts.push(script);
          state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
          try { return await (cfg.executeJavaScript ? cfg.executeJavaScript(script, self) : PAGE_OK); }
          finally { state.inflight--; }
        },
        capturePage: async () => (cfg.capturePage ? cfg.capturePage() : fakeImage(100, 56, { bgra: [0, 255, 0, 255] })),
      };
      log.windows.push(this);
    }
    async loadFile(p) { this.loaded = p; }
    setContentSize(w, h) { this.contentSize = [w, h]; }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }

  const electron = {
    dialog: {
      showOpenDialog: async (...args) => { log.dialogs.push(args); return cfg.dialogResult || { canceled: false, filePaths: ['C:/alpha-site'] }; },
    },
    shell: {
      trashItem: async (p) => { log.trashed.push(p); if (cfg.trashError) throw new Error(cfg.trashError); },
      showItemInFolder: (p) => { log.revealed.push(p); },
    },
    nativeImage,
    BrowserWindow,
    app: { once() {}, removeListener() {} },
  };
  return { electron, log, sessions, state };
}

function fakeFs({ size = 2048, content = Buffer.from('<svg/>'), readError = null } = {}) {
  const calls = { stat: [], read: [] };
  return {
    calls,
    promises: {
      stat: async (p) => { calls.stat.push(p); return { size }; },
      readFile: async (p) => { calls.read.push(p); if (readError) throw new Error(readError); return content; },
    },
  };
}

const make = (cfg = {}, extra = {}) => {
  const f = makeElectron(cfg);
  const deps = makeDeps({ electron: f.electron, fs: extra.fs || fakeFs(extra.fsOpts), timeoutMs: 8000, idleMs: 0, settleMs: 0, ...extra.opts });
  return { ...f, deps };
};

/* ---------- the dialogs, trash, reveal ---------- */

describe('the deps object', () => {
  it('has exactly the six contract methods', () => {
    const { deps } = make();
    assert.deepEqual(Object.keys(deps).sort(), ['dispose', 'pickFile', 'pickFolder', 'reveal', 'thumbnail', 'trash']);
  });

  it('require("electron") is only touched inside makeDeps, and nothing in the file reaches the network or a child process', () => {
    const src = readFileSync(fileURLToPath(new URL('./cosmos-electron.js', import.meta.url)), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = [...code.matchAll(/require\('electron'\)/g)];
    assert.equal(hits.length, 1);
    assert.ok(hits[0].index > code.indexOf('function makeDeps'));
    assert.ok(!/require\(['"](node:)?(http|https|net|dns|tls|child_process)['"]\)/.test(code));
    assert.ok(!/\bfetch\(/.test(code));
  });
});

describe('pickFolder / pickFile', () => {
  it('pickFolder asks for openDirectory and returns the chosen path', async () => {
    const { deps, log } = make();
    assert.equal(await deps.pickFolder(), 'C:/alpha-site');
    assert.equal(log.dialogs.length, 1);
    assert.deepEqual(log.dialogs[0], [{ properties: ['openDirectory'] }]);
  });

  it('pickFolder returns null on cancel or an empty answer', async () => {
    assert.equal(await make({ dialogResult: { canceled: true, filePaths: [] } }).deps.pickFolder(), null);
    assert.equal(await make({ dialogResult: { canceled: false, filePaths: [] } }).deps.pickFolder(), null);
  });

  it('pickFolder is parented to the main window when there is a live one', async () => {
    const f = makeElectron();
    const main = { isDestroyed: () => false };
    const deps = makeDeps({ electron: f.electron, getWin: () => main });
    await deps.pickFolder();
    assert.equal(f.log.dialogs[0][0], main);
    assert.deepEqual(f.log.dialogs[0][1], { properties: ['openDirectory'] });
    const gone = makeElectron();
    const deps2 = makeDeps({ electron: gone.electron, getWin: () => ({ isDestroyed: () => true }) });
    await deps2.pickFolder();
    assert.equal(gone.log.dialogs[0].length, 1, 'a destroyed window is not used as the parent');
  });

  it('pickFolder never throws: a failing dialog is null', async () => {
    const f = makeElectron();
    f.electron.dialog.showOpenDialog = async () => { throw new Error('boom'); };
    assert.equal(await makeDeps({ electron: f.electron }).pickFolder(), null);
  });

  it('pickFile asks for openFile with the title and filters, and returns the path or null', async () => {
    const { deps, log } = make();
    const filters = [{ name: 'JSON', extensions: ['json'] }];
    assert.equal(await deps.pickFile({ title: 'Pick the backup', filters }), 'C:/alpha-site');
    assert.deepEqual(log.dialogs[0], [{ properties: ['openFile'], title: 'Pick the backup', filters }]);
    assert.equal(await make({ dialogResult: { canceled: true, filePaths: [] } }).deps.pickFile({}), null);
    assert.equal(await make().deps.pickFile(), 'C:/alpha-site');
  });
});

describe('trash and reveal', () => {
  it('trash passes exactly the absolute path it was given to shell.trashItem', async () => {
    const { deps, log } = make();
    await deps.trash('C:/alpha-site/imports/clip one.png');
    assert.deepEqual(log.trashed, ['C:/alpha-site/imports/clip one.png']);
  });

  it('trash rejects with the failure when the shell refuses', async () => {
    const { deps } = make({ trashError: 'The file is in use.' });
    await assert.rejects(() => deps.trash('C:/alpha-site/a.png'), /The file is in use\./);
  });

  it('trash refuses a non-path without calling the shell', async () => {
    const { deps, log } = make();
    for (const bad of [undefined, null, '', 5, {}]) await assert.rejects(() => deps.trash(bad));
    assert.deepEqual(log.trashed, []);
  });

  it('reveal calls showItemInFolder with the path', () => {
    const { deps, log } = make();
    deps.reveal('C:/alpha-site/a.png');
    deps.reveal(undefined);
    assert.deepEqual(log.revealed, ['C:/alpha-site/a.png']);
  });
});

/* ---------- thumbnails ---------- */

describe('thumbnail: the colour trap', () => {
  it('turns the BGRA bitmap into RGBA in rgba32 (B=1,G=2,R=3,A=255 -> 3,2,1,255)', async () => {
    const log = [];
    const { deps } = make({ createThumbnailFromPath: async () => fakeImage(800, 400, { bgra: [1, 2, 3, 255], log }) });
    const t = await deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', kind: 'image', size: 1 * MB });
    assert.ok(t);
    assert.equal(t.rgba32.width, 32);
    assert.equal(t.rgba32.height, 32);
    assert.equal(t.rgba32.data.length, 32 * 32 * 4);
    assert.deepEqual([...t.rgba32.data.slice(0, 8)], [3, 2, 1, 255, 3, 2, 1, 255]);
    assert.ok(t.rgba32.data instanceof Uint8Array);
    assert.equal(t.gray9x8.length, 72);
    assert.equal(t.gray9x8[0], Math.round(0.299 * 3 + 0.587 * 2 + 0.114 * 1));
  });

  it('a pure red bitmap (Windows hands it over as 0,0,255,255) comes out as red', async () => {
    const { deps } = make({ createThumbnailFromPath: async () => fakeImage(64, 64, { bgra: [0, 0, 255, 255] }) });
    const t = await deps.thumbnail('C:/alpha-site/red.png', { ext: 'png', size: 10 });
    assert.deepEqual([...t.rgba32.data.slice(0, 4)], [255, 0, 0, 255]);
  });

  it('bgrSwap:false (the native check\'s break switch) leaves the bytes as they came', async () => {
    const { deps } = make({ createThumbnailFromPath: async () => fakeImage(64, 64, { bgra: [0, 0, 255, 255] }) }, { opts: { bgrSwap: false } });
    const t = await deps.thumbnail('C:/alpha-site/red.png', { ext: 'png', size: 10 });
    assert.deepEqual([...t.rgba32.data.slice(0, 4)], [0, 0, 255, 255]);
  });
});

describe('thumbnail: the result', () => {
  it('fits 560 without upscaling, encodes JPEG 82 and leaves the source size null for the shell', async () => {
    const log = [];
    const { deps } = make({ createThumbnailFromPath: async () => fakeImage(800, 400, { log }) });
    const t = await deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 1 * MB });
    assert.equal(t.width, 560);
    assert.equal(t.height, 280);
    assert.equal(t.sourceWidth, null);
    assert.equal(t.sourceHeight, null);
    assert.ok(log.includes('resize:560x280:good'));
    assert.ok(log.includes('toJPEG:82:560x280'));
    assert.ok(Buffer.isBuffer(t.jpeg));
    assert.deepEqual(Object.keys(t).sort(), ['gray9x8', 'height', 'jpeg', 'rgba32', 'sourceHeight', 'sourceWidth', 'width']);

    const log2 = [];
    const small = make({ createThumbnailFromPath: async () => fakeImage(100, 50, { log: log2 }) });
    const t2 = await small.deps.thumbnail('C:/alpha-site/b.png', { ext: '.png', size: 10 });
    assert.deepEqual([t2.width, t2.height], [100, 50]);
    assert.ok(!log2.some((l) => l.startsWith('resize:100x50')), 'no resize when it already fits');
  });

  it('honours a smaller edge', async () => {
    const { deps } = make({ createThumbnailFromPath: async () => fakeImage(800, 400) });
    const t = await deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 10, edge: 200 });
    assert.deepEqual([t.width, t.height], [200, 100]);
  });

  it('native-file reports the full image size as the source size', async () => {
    const { deps } = make({ createFromPath: () => fakeImage(3000, 2000) });
    const t = await deps.thumbnail('C:/alpha-site/a.jpg', { ext: '.jpg', size: 1 * MB });
    assert.deepEqual([t.sourceWidth, t.sourceHeight], [3000, 2000]);
    assert.deepEqual([t.width, t.height], [560, 373]);
  });
});

describe('thumbnail: strategy order', () => {
  it('the shell is tried before native-file, and native-file is not touched when the shell answers', async () => {
    const a = make({ createThumbnailFromPath: async () => fakeImage(10, 10) });
    await a.deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 1 * MB });
    assert.deepEqual(a.log.calls, ['shell']);

    const b = make({ createThumbnailFromPath: async () => fakeImage(0, 0, { empty: true }), createFromPath: () => fakeImage(10, 10) });
    await b.deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 1 * MB });
    assert.deepEqual(b.log.calls, ['shell', 'native-file']);
  });

  it('a file over 25 MB never reaches createFromPath (it would stall the app)', async () => {
    const f = make({ createFromPath: () => fakeImage(10, 10) });
    const t = await f.deps.thumbnail('C:/alpha-site/big.png', { ext: '.png', size: 25 * MB + 1 });
    assert.ok(!f.log.calls.includes('native-file'));
    assert.ok(t, 'the chromium fallback still answered');   // the fake page answers
  });

  it('yields to the event loop (setImmediate) before working', async () => {
    const f = make({ createThumbnailFromPath: async () => fakeImage(10, 10) });
    let ticked = false;
    const p = f.deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 10 });
    setImmediate(() => { ticked = true; });
    await p;
    assert.equal(ticked, true);
    assert.equal(f.log.calls.length, 1);
  });

  it('opts.only pins one strategy', async () => {
    const f = make({ createThumbnailFromPath: async () => fakeImage(10, 10), createFromPath: () => fakeImage(10, 10) });
    await f.deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 10, only: ['native-file'] });
    assert.deepEqual(f.log.calls, ['native-file']);
  });
});

describe('thumbnail: the Chromium fallback', () => {
  it('runs when the shell rejects, in a window with the locked-down preferences', async () => {
    const f = make({}, { fsOpts: { size: 2048, content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') } });
    const t = await f.deps.thumbnail('C:/alpha-site/logo.svg', { ext: '.svg', kind: 'image', size: 2048 });
    assert.ok(t, 'a thumbnail came back through chromium');
    assert.deepEqual(f.log.calls.slice(0, 1), ['shell']);
    assert.equal(f.log.windows.length, 1);
    const w = f.log.windows[0];
    assert.equal(w.opts.show, false);
    assert.equal(w.opts.webPreferences.sandbox, true);
    assert.equal(w.opts.webPreferences.nodeIntegration, false);
    assert.equal(w.opts.webPreferences.contextIsolation, true);
    assert.equal(w.opts.webPreferences.partition, 'cosmos-decode');
    assert.notEqual(w.opts.webPreferences.webSecurity, false, 'webSecurity stays on');
    assert.match(w.loaded, /cosmos-decode\.html$/);
    assert.ok(w.session.handlers.permission, 'a permission handler is installed');
    let granted = null;
    w.session.handlers.permission(null, 'media', (v) => { granted = v; });
    assert.equal(granted, false);
    assert.deepEqual(w.session.handlers.windowOpen(), { action: 'deny' });
  });

  it('the request handler cancels http, https, ftp and ws, allows file, data, blob and devtools, and counts the cancels', async () => {
    const f = make();
    await f.deps.thumbnail('C:/alpha-site/logo.svg', { ext: '.svg', size: 10 });
    const h = f.log.windows[0].session.handlers.beforeRequest;
    assert.equal(typeof h, 'function');
    const verdict = (url) => { let r; h({ url }, (x) => { r = x; }); return r.cancel; };
    for (const u of ['http://127.0.0.1:9/x', 'https://example.test/a.png', 'ftp://example.test/a', 'ws://example.test/s', 'wss://example.test/s', 'chrome-extension://x/y', 'not a url']) {
      assert.equal(verdict(u), true, u);
    }
    for (const u of ['file:///C:/alpha-site/a.mp4', 'data:image/png;base64,AAAA', 'blob:null/1234', 'devtools://devtools/bundled/x.html']) {
      assert.equal(verdict(u), false, u);
    }
    const s = f.deps.__native.stats();
    assert.equal(s.cancelled, 7);
    assert.equal(s.allowed, 4);
  });

  it('isAllowedRequestUrl matches the handler', () => {
    assert.equal(isAllowedRequestUrl('file:///x'), true);
    assert.equal(isAllowedRequestUrl('http://x'), false);
    assert.equal(isAllowedRequestUrl(undefined), false);
  });

  it('the script for an image uses a data: src and NEVER a file: URL (the taint guard)', async () => {
    const f = make({}, { fsOpts: { size: 2048, content: Buffer.from('<svg/>') } });
    await f.deps.thumbnail('C:/alpha-site/logo.svg', { ext: '.svg', kind: 'image', size: 2048 });
    assert.equal(f.log.scripts.length, 1);
    const s = f.log.scripts[0];
    assert.match(s, /img\.src = "data:image\/svg\+xml;base64,/);
    assert.ok(!/file:/i.test(s), 'no file: anywhere in the script');
    assert.ok(!s.includes('alpha-site'), 'the path is not sent to the page either');
  });

  it('feeds the page\'s JPEG back through createFromBuffer, so the colour path is the same', async () => {
    const f = make();
    const t = await f.deps.thumbnail('C:/alpha-site/logo.svg', { ext: '.svg', size: 10 });
    assert.ok(f.log.calls.includes('createFromBuffer'));
    assert.deepEqual([...t.rgba32.data.slice(0, 4)], [255, 0, 0, 255], 'BGRA 0,0,255 -> red');
    assert.deepEqual([t.sourceWidth, t.sourceHeight], [64, 64]);
    assert.deepEqual([...t.jpeg], [...JPEG_FROM_PAGE], 'the page\'s own JPEG is reused when it already fits');
  });

  it('a page-reported tainted canvas is counted and gives null', async () => {
    const f = make({ executeJavaScript: async () => ({ ok: false, error: 'tainted', tainted: true }) });
    const t = await f.deps.thumbnail('C:/alpha-site/logo.svg', { ext: '.svg', size: 10 });
    assert.equal(t, null);
    assert.equal(f.deps.__native.stats().tainted, 1);
  });

  it('a file over 32 MB gives null without reading it (and without opening a window)', async () => {
    const fs = fakeFs({ size: 33 * MB });
    const f = make({}, { fs });
    const t = await f.deps.thumbnail('C:/alpha-site/huge.webp', { ext: '.webp', kind: 'image', size: 33 * MB });
    assert.equal(t, null);
    assert.deepEqual(fs.calls.read, []);
    assert.equal(f.log.windows.length, 0);
  });

  it('with no size given it asks the file system, still without reading a big file', async () => {
    const fs = fakeFs({ size: 40 * MB });
    const f = make({}, { fs });
    assert.equal(await f.deps.thumbnail('C:/alpha-site/huge.avif', { ext: '.avif' }), null);
    assert.equal(fs.calls.stat.length, 1);
    assert.deepEqual(fs.calls.read, []);
  });

  it('a file that grew past 32 MB since it was measured is still refused after the read', async () => {
    const fs = fakeFs({ size: 1000, content: Buffer.alloc(32 * MB + 1) });
    const f = make({}, { fs });
    assert.equal(await f.deps.thumbnail('C:/alpha-site/grew.webp', { ext: '.webp', size: 1000 }), null);
    assert.equal(f.log.windows.length, 0);
  });

  it('two concurrent fallback calls are serialised (one at a time in the window)', async () => {
    const f = make({ executeJavaScript: async () => { await wait(25); return PAGE_OK; } });
    const [a, b] = await Promise.all([
      f.deps.thumbnail('C:/alpha-site/a.svg', { ext: '.svg', size: 10 }),
      f.deps.thumbnail('C:/alpha-site/b.svg', { ext: '.svg', size: 10 }),
    ]);
    assert.ok(a && b);
    assert.equal(f.log.scripts.length, 2);
    assert.equal(f.state.maxInflight, 1);
    assert.equal(f.log.windows.length, 1, 'one lazily created window serves both');
  });

  it('an 8 s timeout (default) returns null, destroys the window, and the next call gets a fresh one', async () => {
    assert.equal(CALL_TIMEOUT_MS, 8000);
    assert.equal(IDLE_MS, 60000);
    let hang = true;
    const f = make({ executeJavaScript: async () => (hang ? new Promise(() => {}) : PAGE_OK) }, { opts: { timeoutMs: 30 } });
    const first = await f.deps.thumbnail('C:/alpha-site/a.svg', { ext: '.svg', size: 10 });
    assert.equal(first, null);
    assert.equal(f.log.windows[0].destroyed, true);
    assert.equal(f.deps.__native.stats().timeouts, 1);
    hang = false;
    const second = await f.deps.thumbnail('C:/alpha-site/b.svg', { ext: '.svg', size: 10 });
    assert.ok(second);
    assert.equal(f.log.windows.length, 2);
  });

  it('the window is destroyed on dispose()', async () => {
    const f = make();
    await f.deps.thumbnail('C:/alpha-site/a.svg', { ext: '.svg', size: 10 });
    assert.equal(f.log.windows[0].destroyed, false);
    f.deps.dispose();
    assert.equal(f.log.windows[0].destroyed, true);
    assert.equal(f.deps.__native.window(), null);
  });

  it('the window is destroyed after the idle time', async () => {
    const f = make({}, { opts: { idleMs: 25 } });
    await f.deps.thumbnail('C:/alpha-site/a.svg', { ext: '.svg', size: 10 });
    assert.equal(f.log.windows[0].destroyed, false);
    await wait(80);
    assert.equal(f.log.windows[0].destroyed, true);
  });
});

describe('thumbnail: video', () => {
  const frame = () => fakeImage(100, 56, { bgra: [0, 255, 0, 255] });
  const VIDEO_ON = { opts: { videoFallback: true } };

  it('is OFF by default: a video with no shell thumbnail is null and the window is never opened', async () => {
    const f = make({ createThumbnailFromPath: async () => { throw new Error('no handler'); }, capturePage: frame });
    assert.equal(await f.deps.thumbnail('C:/alpha-site/clip.mp4', { ext: '.mp4', kind: 'video', size: 10 }), null);
    assert.equal(f.log.windows.length, 0);
  });

  it('shows the video from a file: URL, sizes the window to the fit, captures the page and cleans up', async () => {
    const f = make({ executeJavaScript: async (s) => (s.includes('createElement') ? { ok: true, sourceWidth: 1920, sourceHeight: 1080, duration: 12 } : true), capturePage: frame }, VIDEO_ON);
    const t = await f.deps.thumbnail('C:/alpha-site/clip.mp4', { ext: '.mp4', kind: 'video', size: 90 * MB });
    assert.ok(t);
    assert.deepEqual(f.log.windows[0].contentSize, [560, 315]);
    assert.ok(f.log.scripts[0].includes(JSON.stringify(pathToFileURL('C:/alpha-site/clip.mp4').href)));
    assert.match(f.log.scripts[1], /removeAttribute\('src'\)/, 'the video is released afterwards');
    assert.deepEqual([t.sourceWidth, t.sourceHeight], [1920, 1080]);
    assert.deepEqual([...t.rgba32.data.slice(0, 4)], [0, 255, 0, 255]);
  });

  it('an empty capture removes the strategy for the rest of the session and the work gets null', async () => {
    const f = make({
      executeJavaScript: async (s) => (s.includes('createElement') ? { ok: true, sourceWidth: 640, sourceHeight: 360 } : true),
      capturePage: () => fakeImage(0, 0, { empty: true }),
    }, VIDEO_ON);
    assert.equal(await f.deps.thumbnail('C:/alpha-site/clip.webm', { ext: '.webm', kind: 'video', size: 10 }), null);
    assert.equal(f.deps.__native.videoCaptureOk(), false);
    const before = f.log.scripts.length;
    assert.equal(await f.deps.thumbnail('C:/alpha-site/clip2.webm', { ext: '.webm', kind: 'video', size: 10 }), null);
    assert.equal(f.log.scripts.length, before, 'the window is not asked again');
  });

  it('a video the page cannot decode is null, not an error', async () => {
    const f = make({ executeJavaScript: async () => ({ ok: false, error: 'video-decode-failed' }) }, VIDEO_ON);
    assert.equal(await f.deps.thumbnail('C:/alpha-site/clip.mov', { ext: '.mov', kind: 'video', size: 10 }), null);
    assert.equal(f.deps.__native.videoCaptureOk(), true);
  });
});

describe('thumbnail: never throws', () => {
  it('every failure mode is null (with every later strategy also failing)', async () => {
    const cases = {
      'shell throws synchronously': { createThumbnailFromPath: () => { throw new Error('x'); } },
      'native-file throws': { createFromPath: () => { throw new Error('x'); } },
      'page rejects': { executeJavaScript: async () => { throw new Error('x'); } },
      'page answers junk': { executeJavaScript: async () => 'junk' },
      'page answers a bad data url': { executeJavaScript: async () => ({ ok: true, dataUrl: 'file:///x.jpg' }) },
      'toBitmap is the wrong size': { createThumbnailFromPath: async () => ({ ...fakeImage(10, 10), resize: () => ({ toBitmap: () => Buffer.alloc(7) }) }) },
      'toJPEG throws': { createThumbnailFromPath: async () => ({ ...fakeImage(10, 10), toJPEG: () => { throw new Error('x'); } }) },
      'toJPEG is empty': { createThumbnailFromPath: async () => ({ ...fakeImage(10, 10), toJPEG: () => Buffer.alloc(0) }) },
      'zero-size image': { createThumbnailFromPath: async () => fakeImage(0, 0) },
    };
    for (const [name, cfg] of Object.entries(cases)) {
      const f = make({ executeJavaScript: async () => ({ ok: false, error: 'decode-failed' }), ...cfg });
      let r;
      await assert.doesNotReject(async () => { r = await f.deps.thumbnail('C:/alpha-site/a.png', { ext: '.png', size: 10 }); }, name);
      assert.equal(r, null, name);
    }
  });

  it('a read error and a missing file are null', async () => {
    const f = make({}, { fsOpts: { readError: 'EACCES' } });
    assert.equal(await f.deps.thumbnail('C:/alpha-site/a.svg', { ext: '.svg', size: 10 }), null);
    const g = make({}, { fs: { promises: { stat: async () => { throw new Error('ENOENT'); }, readFile: async () => { throw new Error('ENOENT'); } } } });
    assert.equal(await g.deps.thumbnail('C:/alpha-site/gone.webp', { ext: '.webp' }), null);
  });

  it('bad arguments are null', async () => {
    const { deps } = make();
    for (const bad of [undefined, null, '', 5, {}]) assert.equal(await deps.thumbnail(bad, { ext: '.png' }), null);
    assert.equal(await deps.thumbnail('C:/alpha-site/a.xyz'), null);
    assert.equal(await deps.thumbnail('C:/alpha-site/a.png', null), null);
  });

  it('an unknown extension gets only the shell', async () => {
    const f = make({ createFromPath: () => fakeImage(10, 10) });
    assert.equal(await f.deps.thumbnail('C:/alpha-site/a.xyz', { ext: '.xyz', size: 10 }), null);
    assert.deepEqual(f.log.calls, ['shell']);
    assert.equal(f.log.windows.length, 0);
  });
});
