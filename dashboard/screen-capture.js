// dashboard/screen-capture.js — v3 STUDIO main-process wire (Group 1).
//
// Owns:
//   - The IPC channels listed in docs/sync/IPC-CONTRACT.md ("v3 STUDIO"):
//       hq:studio:panel-toggle
//       hq:studio:snip-arm | hq:studio:snip-frozen | hq:studio:snip-commit | hq:studio:snip-cancel
//       hq:studio:rec-sources | hq:studio:rec-start | hq:studio:rec-chunk
//       hq:studio:rec-stop   | hq:studio:rec-abort  | hq:studio:rec-status
//       hq:studio:rec-toggle
//       hq:studio:library-list | hq:studio:library-reveal | hq:studio:library-delete
//       hq:studio:settings-get | hq:studio:settings-set
//       studio:capture-added (bus broadcast)
//       hq:studio:open-realm (bus broadcast, from Ctrl+Alt+L)
//   - The floating-panel BrowserWindow (dashboard/record-panel.html, Group 3 owns the HTML/JS).
//   - The per-display transparent overlay BrowserWindows (dashboard/snip-overlay.html, Group 2 owns).
//   - The library tree under <videos>/WorkspaceHQ/{screenshots,recordings}/ with .thumbs/ sidecars,
//     the .part -> rename atomic write, crash-recovery of orphan .webm.part clusters, and the
//     disk-space watchdog.
//
// Does NOT own:
//   - The UI inside the panel/overlay (Groups 2/3).
//   - The STUDIO v3 realm view (Group 4).
//   - Any modification to dashboard/main.js beyond an additive require+init call and the two
//     "still free" global-hotkey registers (Ctrl+Alt+S, Ctrl+Alt+R).
//
// Safety invariants worth calling out:
//   - Every path passed through library-reveal / library-delete is contained under the resolved
//     root before it reaches shell.showItemInFolder / shell.trashItem. Anything outside is refused.
//   - Recording state (recId, elapsedMs, bytes) is the only user-visible telemetry we log; source
//     labels and disk paths never hit console.log. The registry keys sessions by opaque recId.
//   - MediaRecorder itself runs in the renderer (Group 3, record-panel.js) — this module never
//     touches getUserMedia / getDisplayMedia. Chunks arrive over ipcRenderer.send as ArrayBuffers.

const path = require('node:path');
const fs = require('node:fs');
const { nativeImage, shell, clipboard } = require('electron');

const CH = {
  PANEL_TOGGLE: 'hq:studio:panel-toggle',
  SNIP_ARM: 'hq:studio:snip-arm',
  SNIP_FROZEN: 'hq:studio:snip-frozen',
  SNIP_COMMIT: 'hq:studio:snip-commit',
  SNIP_CANCEL: 'hq:studio:snip-cancel',
  REC_SOURCES: 'hq:studio:rec-sources',
  REC_START: 'hq:studio:rec-start',
  REC_CHUNK: 'hq:studio:rec-chunk',
  REC_STOP: 'hq:studio:rec-stop',
  REC_ABORT: 'hq:studio:rec-abort',
  REC_STATUS: 'hq:studio:rec-status',
  REC_TOGGLE: 'hq:studio:rec-toggle',
  LIB_LIST: 'hq:studio:library-list',
  LIB_REVEAL: 'hq:studio:library-reveal',
  LIB_DELETE: 'hq:studio:library-delete',
  SET_GET: 'hq:studio:settings-get',
  SET_SET: 'hq:studio:settings-set',
  CAPTURE_ADDED: 'studio:capture-added',
  OPEN_REALM: 'hq:studio:open-realm',
};

const SETTINGS_DEFAULTS = Object.freeze({
  rootOverride: null,
  defaultFps: 30,
  hotkeysEnabled: true,
  defaultSourceId: null,
  defaultMic: false,
  defaultSysAudio: false,
  panelPosition: null,   // { x, y } — saved on panel move
});

const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_DEFAULTS));

// Module state.
let deps = null;             // { app, BrowserWindow, screen, desktopCapturer, ipcMain, globalShortcut, send }
let settings = null;
let panelWindow = null;
let overlayWindows = [];     // one per Display when a snip is armed
const recorders = new Map(); // recId -> { stream, tmpPath, finalPath, queue, nextSeq, bytes, ... }
let recStatusTimer = null;
let diskWatchdogTick = 0;
let bootTime = Date.now();

// -------------------------- storage paths --------------------------

function rootDir() {
  const override = settings && settings.rootOverride;
  if (override && typeof override === 'string') return override;
  return path.join(deps.app.getPath('videos'), 'WorkspaceHQ');
}
function shotsDir()      { return path.join(rootDir(), 'screenshots'); }
function recsDir()       { return path.join(rootDir(), 'recordings'); }
function shotsThumbsDir(){ return path.join(shotsDir(), '.thumbs'); }
function recsThumbsDir() { return path.join(recsDir(),  '.thumbs'); }

function ensureTree() {
  try {
    fs.mkdirSync(shotsDir(),       { recursive: true });
    fs.mkdirSync(recsDir(),        { recursive: true });
    fs.mkdirSync(shotsThumbsDir(), { recursive: true });
    fs.mkdirSync(recsThumbsDir(),  { recursive: true });
  } catch (e) {
    console.error('[studio] ensureTree failed:', e.message);
  }
}

// Sortable, sv-SE style slug: YYYY-MM-DD-HHmmss.
function slug(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = fmt.formatToParts(date);
  const g = (t) => (p.find((x) => x.type === t) || {}).value || '00';
  return `${g('year')}-${g('month')}-${g('day')}-${g('hour')}${g('minute')}${g('second')}`;
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  let n = 2;
  while (fs.existsSync(candidate) || fs.existsSync(candidate + '.part')) {
    candidate = path.join(dir, `${base}-${n}${ext}`);
    n++;
    if (n > 999) break;
  }
  return candidate;
}

// Refuse to reveal / trash anything outside the resolved root — the renderer
// only ever asks about paths this module told it about, but ipc is untrusted.
function withinRoot(p) {
  try {
    const r = path.resolve(rootDir());
    const q = path.resolve(String(p));
    return q === r || q.startsWith(r + path.sep);
  } catch { return false; }
}

// -------------------------- settings persistence --------------------------

function settingsFile() {
  return path.join(deps.app.getPath('userData'), 'studio-settings.json');
}
function loadSettings() {
  let raw = null;
  try { raw = fs.readFileSync(settingsFile(), 'utf8'); } catch { /* first run */ }
  let parsed = null;
  if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
  settings = Object.assign({}, SETTINGS_DEFAULTS, parsed && typeof parsed === 'object' ? parsed : {});
}
function saveSettings() {
  try {
    fs.mkdirSync(deps.app.getPath('userData'), { recursive: true });
    const tmp = settingsFile() + '.part';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, settingsFile());
  } catch (e) {
    console.error('[studio] settings save failed:', e.message);
  }
}
function patchSettings(patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const k of SETTINGS_KEYS) if (k in patch) settings[k] = patch[k];
  saveSettings();
}

// -------------------------- broadcast --------------------------

// Push to every renderer that has a live webContents. Cheap enough at N < ~10.
function broadcast(channel, payload) {
  try {
    for (const w of deps.BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      try { w.webContents.send(channel, payload); } catch { /* window mid-teardown */ }
    }
  } catch { /* main quitting */ }
}

// -------------------------- crash recovery --------------------------

// A .webm.part left over from a prior crash is playable up to the last
// complete WebM cluster (we timeslice at 2000ms so worst-case loss is ~2s).
// Rename it to .recovered.webm so the library can surface it in the Recovered
// bucket with a warning badge. .png.part is unrecoverable, so we delete it.
function recoverPartials() {
  try {
    for (const dir of [shotsDir(), recsDir()]) {
      let entries;
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        if (!name.endsWith('.part')) continue;
        const full = path.join(dir, name);
        let st; try { st = fs.statSync(full); } catch { continue; }
        // Skip anything we just wrote in this session.
        if (st.mtimeMs > bootTime - 1000) continue;
        if (name.endsWith('.webm.part')) {
          const base = name.slice(0, -('.webm.part'.length));
          const target = uniquePath(dir, base + '.recovered', '.webm');
          try { fs.renameSync(full, target); } catch (e) {
            console.error('[studio] recovery rename failed:', e.message);
          }
        } else if (name.endsWith('.png.part')) {
          try { fs.unlinkSync(full); } catch { /* nothing to do */ }
        }
      }
    }
  } catch (e) {
    console.error('[studio] recoverPartials failed:', e.message);
  }
}

// -------------------------- FloatingPanel window --------------------------

function panelHtmlPath() { return path.join(__dirname, 'record-panel.html'); }

function makePanel() {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;
  const html = panelHtmlPath();
  if (!fs.existsSync(html)) {
    // Group 3 hasn't landed yet — no-op instead of crashing.
    console.warn('[studio] record-panel.html not present yet — panel toggle deferred.');
    return null;
  }
  const pos = (settings && settings.panelPosition) || {};
  panelWindow = new deps.BrowserWindow({
    width: 340, height: 180,
    x: Number.isFinite(pos.x) ? pos.x : undefined,
    y: Number.isFinite(pos.y) ? pos.y : undefined,
    frame: false, transparent: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    title: 'WorkspaceHQ Studio',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // The panel must be invisible to its own recordings on Windows — documented
  // mitigation from the design; not a security guarantee.
  try { panelWindow.setContentProtection(true); } catch { /* older Electron */ }
  panelWindow.on('closed', () => { panelWindow = null; });
  const persistPos = () => {
    if (!panelWindow || panelWindow.isDestroyed()) return;
    try {
      const b = panelWindow.getBounds();
      settings.panelPosition = { x: b.x, y: b.y };
      saveSettings();
    } catch { /* ignore */ }
  };
  panelWindow.on('move', persistPos);
  panelWindow.once('ready-to-show', () => {
    try { panelWindow.show(); } catch { /* window gone */ }
  });
  panelWindow.loadFile(html).catch((e) => console.error('[studio] panel load failed:', e.message));
  return panelWindow;
}

function togglePanel() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    try {
      if (panelWindow.isVisible()) panelWindow.hide();
      else panelWindow.show();
    } catch { /* window mid-teardown, recreate on next call */ }
    return;
  }
  makePanel();
}

// -------------------------- snip flow --------------------------

function overlayHtmlPath() { return path.join(__dirname, 'snip-overlay.html'); }

// Freeze the whole desktop (one PNG per display), then float a transparent
// BrowserWindow over every screen for the user to drag on. Overlay HTML is
// Group 2's file — we just point to it and hand it the frozen bitmap.
async function snipArm(kindArg) {
  if (overlayWindows.length) return; // already armed — ignore repeat presses
  const kind = kindArg === 'full' || kindArg === 'window' ? kindArg : 'region';
  const html = overlayHtmlPath();
  if (!fs.existsSync(html)) {
    console.warn('[studio] snip-overlay.html not present yet — snip skipped.');
    return;
  }
  let displays;
  try { displays = deps.screen.getAllDisplays(); }
  catch (e) { console.error('[studio] getAllDisplays failed:', e.message); return; }
  if (!displays.length) return;

  // Pick thumbnail dimensions large enough for the biggest display's native pixels;
  // any display smaller than that just gets a proportional cropped source we then
  // match by display_id on the join below.
  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width  * d.scaleFactor)));
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)));

  let sources;
  try {
    sources = await deps.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxW, height: maxH },
    });
  } catch (e) {
    console.error('[studio] desktopCapturer.getSources failed:', e.message);
    return;
  }

  // Hide the panel while we snip so we never race with its own paint.
  if (panelWindow && !panelWindow.isDestroyed()) {
    try { panelWindow.hide(); } catch { /* ignore */ }
  }

  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[i] || sources[0];
    if (!src) continue;
    const pngDataUrl = (src.thumbnail && typeof src.thumbnail.toDataURL === 'function')
      ? src.thumbnail.toDataURL()
      : null;

    let w;
    try {
      w = new deps.BrowserWindow({
        x: d.bounds.x, y: d.bounds.y,
        width: d.bounds.width, height: d.bounds.height,
        frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
        title: 'WorkspaceHQ Snip Overlay',
        webPreferences: {
          contextIsolation: true, nodeIntegration: false, sandbox: false,
          preload: path.join(__dirname, 'preload.js'),
        },
      });
    } catch (e) {
      console.error('[studio] overlay create failed:', e.message);
      continue;
    }
    // Stow the freeze on the window handle so commit can find it without an
    // extra round-trip. These are main-side properties, never sent to renderer.
    w.__hqDisplayId = d.id;
    w.__hqDisplayBounds = d.bounds;
    w.__hqScaleFactor = d.scaleFactor;
    w.__hqFrozenPng = pngDataUrl;
    w.__hqNativeImage = (pngDataUrl && nativeImage.createFromDataURL(pngDataUrl)) || null;
    try { w.setContentProtection(true); } catch { /* ignore */ }
    overlayWindows.push(w);

    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return;
      try { w.setAlwaysOnTop(true, 'screen-saver'); } catch { /* fine */ }
      try { w.show(); } catch { /* fine */ }
      try {
        w.webContents.send(CH.SNIP_FROZEN, {
          displayId: d.id,
          pngDataUrl,
          bounds: d.bounds,
          scaleFactor: d.scaleFactor,
          kind,
          displayIndex: i,
        });
      } catch { /* window vanished */ }
    });
    // Kind and displayId travel as query params too, so early Group 2 markup
    // can key off them before onSnipFrozen fires.
    w.loadFile(html, { query: { displayId: String(d.id), kind } })
      .catch((e) => console.error('[studio] overlay load failed:', e.message));
  }
}

function closeOverlays() {
  for (const w of overlayWindows) {
    try { if (!w.isDestroyed()) w.close(); } catch { /* ignore */ }
  }
  overlayWindows = [];
  if (panelWindow && !panelWindow.isDestroyed()) {
    try { panelWindow.show(); } catch { /* ignore */ }
  }
}

// Renderer commits a region via IPC; we crop the frozen bitmap main-side, write
// the file atomically, drop a thumbnail sidecar, and copy to clipboard.
async function commitSnip(arg) {
  const payload = arg && typeof arg === 'object' ? arg : {};
  const displayId = payload.displayId;
  const rectDIP = payload.rectDIP || null;
  const mode = payload.mode === 'full' ? 'full' : (payload.mode === 'window' ? 'window' : 'region');

  const overlay = overlayWindows.find((w) => w.__hqDisplayId === displayId);
  const image = overlay ? overlay.__hqNativeImage : null;
  const scale = overlay ? (overlay.__hqScaleFactor || 1) : 1;
  closeOverlays();
  if (!image) return null;

  let out;
  try {
    if (mode === 'full' || !rectDIP) {
      out = image;
    } else {
      const rect = {
        x: Math.max(0, Math.round(Number(rectDIP.x) * scale)),
        y: Math.max(0, Math.round(Number(rectDIP.y) * scale)),
        width:  Math.max(1, Math.round(Number(rectDIP.w) * scale)),
        height: Math.max(1, Math.round(Number(rectDIP.h) * scale)),
      };
      out = image.crop(rect);
    }
  } catch (e) {
    console.error('[studio] crop failed:', e.message);
    return null;
  }

  ensureTree();
  const target = uniquePath(shotsDir(), slug(), '.png');
  const tmp = target + '.part';
  let buf;
  try { buf = out.toPNG(); } catch (e) { console.error('[studio] toPNG failed:', e.message); return null; }
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
  } catch (e) {
    console.error('[studio] snip write failed:', e.message);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return null;
  }
  // Thumb sidecar — 240px wide, JPEG q=72.
  try {
    const thumbImg = out.resize({ width: 240 });
    const thumbBuf = thumbImg.toJPEG(72);
    const thumbPath = path.join(shotsThumbsDir(), path.basename(target, '.png') + '.thumb.jpg');
    fs.writeFileSync(thumbPath, thumbBuf);
  } catch { /* thumb is nice-to-have, never a blocker */ }
  try { clipboard.writeImage(out); } catch { /* clipboard busy */ }

  broadcast(CH.CAPTURE_ADDED, { kind: 'shot', path: target, at: Date.now() });
  return target;
}

// -------------------------- record flow --------------------------

// Build the source picker payload the panel drives its <select> from. We join
// desktopCapturer.getSources with screen.getAllDisplays on display_id so screens
// get bounds + scale + a "primary" flag that windows don't.
async function listRecSources() {
  let sources, displays, primaryId = null;
  try {
    sources = await deps.desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
  } catch (e) {
    console.error('[studio] rec-sources getSources failed:', e.message);
    return [];
  }
  try { displays = deps.screen.getAllDisplays(); } catch { displays = []; }
  try { primaryId = deps.screen.getPrimaryDisplay ? deps.screen.getPrimaryDisplay().id : null; } catch { /* ignore */ }

  return sources.map((s) => {
    const isScreen = typeof s.id === 'string' && s.id.startsWith('screen:');
    const disp = isScreen ? displays.find((d) => String(d.id) === String(s.display_id)) : null;
    return {
      sourceId: s.id,
      displayId: s.display_id || null,
      label: String(s.name || ''),
      primary: disp ? disp.id === primaryId : false,
      kind: isScreen ? 'screen' : 'window',
      thumbnail: (s.thumbnail && typeof s.thumbnail.toDataURL === 'function') ? s.thumbnail.toDataURL() : null,
      width:  disp ? Math.round(disp.bounds.width  * disp.scaleFactor) : null,
      height: disp ? Math.round(disp.bounds.height * disp.scaleFactor) : null,
    };
  });
}

function randomRecId() {
  return 'rec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function ensureRecStatusPush() {
  if (recStatusTimer) return;
  recStatusTimer = setInterval(recStatusTick, 1000);
}
function stopRecStatusPushIfIdle() {
  if (recorders.size === 0 && recStatusTimer) {
    clearInterval(recStatusTimer);
    recStatusTimer = null;
  }
}

function recStatusTick() {
  const now = Date.now();
  for (const [recId, r] of recorders) {
    broadcast(CH.REC_STATUS, {
      state: 'recording',
      recId,
      elapsedMs: now - r.startedAt,
      bytes: r.bytes,
      sourceLabel: r.sourceLabel,
      mic: r.mic,
      sysAudio: r.sysAudio,
      lastPath: null,
    });
  }
  // Disk-space watchdog — every 10th tick (~10s) is enough on a hot loop and
  // never blocks the tick.
  diskWatchdogTick = (diskWatchdogTick + 1) % 10;
  if (diskWatchdogTick === 0 && recorders.size && typeof fs.statfsSync === 'function') {
    for (const [recId, r] of recorders) {
      let freeBytes = Infinity;
      try {
        const s = fs.statfsSync(path.dirname(r.tmpPath));
        freeBytes = Number(s.bavail) * Number(s.bsize);
      } catch { /* statfs unsupported here */ }
      if (freeBytes < 500 * 1024 * 1024) {
        broadcast(CH.REC_STATUS, {
          state: 'stopped-lowdisk', recId, bytes: r.bytes,
          sourceLabel: r.sourceLabel, lastPath: r.finalPath,
        });
        stopRec(recId).catch(() => { /* already dying */ });
      }
    }
  }
  stopRecStatusPushIfIdle();
}

function startRec(optsIn) {
  const opts = optsIn && typeof optsIn === 'object' ? optsIn : {};
  ensureTree();
  const target = uniquePath(recsDir(), slug(), '.webm');
  const tmpPath = target + '.part';
  let stream;
  try { stream = fs.createWriteStream(tmpPath, { flags: 'w' }); }
  catch (e) {
    console.error('[studio] rec createWriteStream failed:', e.message);
    return { error: 'write-failed' };
  }
  const recId = randomRecId();
  const r = {
    recId,
    stream,
    tmpPath,
    finalPath: target,
    queue: new Map(),   // seq -> ArrayBuffer/Uint8Array (out-of-order buffer)
    nextSeq: 0,
    startedAt: Date.now(),
    bytes: 0,
    sourceId: opts.sourceId || null,
    mic: !!opts.mic,
    sysAudio: !!opts.sysAudio,
    fps: Number.isFinite(opts.fps) ? opts.fps : (settings.defaultFps || 30),
    sourceLabel: String(opts.sourceLabel || ''),
    stopping: false,
    // 30-min auto-split so a runaway record produces chunked files rather than
    // a single uncroppable monster.
    autoSplitTimer: setTimeout(() => {
      broadcast(CH.REC_STATUS, { state: 'auto-split', recId, lastPath: target });
      stopRec(recId).catch(() => { /* ignore */ });
    }, 30 * 60 * 1000),
  };
  stream.on('error', (e) => {
    console.error('[studio] rec stream error:', e.message);
    broadcast(CH.REC_STATUS, { state: 'error', recId });
  });
  recorders.set(recId, r);
  ensureRecStatusPush();
  broadcast(CH.REC_STATUS, {
    state: 'recording', recId, elapsedMs: 0, bytes: 0,
    sourceLabel: r.sourceLabel, mic: r.mic, sysAudio: r.sysAudio,
  });
  return { recId, tmpPath };
}

function writeChunk(recId, seq, buf) {
  const r = recorders.get(recId);
  if (!r || r.stopping) return false;
  if (!buf) return false;
  // Normalize whatever contextBridge delivered (ArrayBuffer / Uint8Array /
  // Node Buffer) into a Node Buffer without an extra copy where possible.
  let asBuf;
  if (Buffer.isBuffer(buf)) asBuf = buf;
  else if (buf instanceof Uint8Array) asBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  else if (buf instanceof ArrayBuffer) asBuf = Buffer.from(buf);
  else return false;

  r.queue.set(Number(seq) | 0, asBuf);
  // Drain contiguous frames in order. Out-of-order IPC frames stay parked.
  while (r.queue.has(r.nextSeq)) {
    const b = r.queue.get(r.nextSeq);
    r.queue.delete(r.nextSeq);
    r.nextSeq++;
    r.bytes += b.length;
    const ok = r.stream.write(b);
    if (!ok) {
      // Backpressure — nudge the panel to pause its MediaRecorder. Group 3's
      // panel.js honors { state: 'backpressure' } and calls MediaRecorder.pause().
      broadcast(CH.REC_STATUS, { state: 'backpressure', recId, bytes: r.bytes });
      r.stream.once('drain', () => {
        broadcast(CH.REC_STATUS, { state: 'drained', recId, bytes: r.bytes });
      });
    }
  }
  return true;
}

async function stopRec(recId) {
  const r = recorders.get(recId);
  if (!r || r.stopping) return null;
  r.stopping = true;
  if (r.autoSplitTimer) { clearTimeout(r.autoSplitTimer); r.autoSplitTimer = null; }

  await new Promise((resolve) => {
    try { r.stream.end(resolve); } catch { resolve(); }
  });
  try {
    const fd = fs.openSync(r.tmpPath, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* best-effort fsync */ }
  try { fs.renameSync(r.tmpPath, r.finalPath); }
  catch (e) { console.error('[studio] rec rename failed:', e.message); }

  recorders.delete(recId);
  stopRecStatusPushIfIdle();

  broadcast(CH.CAPTURE_ADDED, {
    kind: 'rec', path: r.finalPath, at: Date.now(),
    durationMs: Date.now() - r.startedAt, bytes: r.bytes,
  });
  broadcast(CH.REC_STATUS, {
    state: 'stopped', recId, elapsedMs: Date.now() - r.startedAt, bytes: r.bytes,
    sourceLabel: r.sourceLabel, lastPath: r.finalPath,
  });
  return r.finalPath;
}

async function abortRec(recId) {
  const r = recorders.get(recId);
  if (!r) return;
  r.stopping = true;
  if (r.autoSplitTimer) { clearTimeout(r.autoSplitTimer); r.autoSplitTimer = null; }
  try { r.stream.destroy(); } catch { /* ignore */ }
  try { fs.unlinkSync(r.tmpPath); } catch { /* already gone */ }
  recorders.delete(recId);
  stopRecStatusPushIfIdle();
  broadcast(CH.REC_STATUS, { state: 'aborted', recId });
}

// Hotkey path. If anything is recording, stop it; otherwise start with either
// the caller's opts or the saved defaults; if we still have no source, open
// the panel so the user can pick one.
function recToggle(optsIn) {
  const opts = optsIn && typeof optsIn === 'object' ? optsIn : {};
  if (recorders.size > 0) {
    const [firstId] = recorders.keys();
    stopRec(firstId).catch(() => { /* ignore */ });
    return { toggled: 'stopped', recId: firstId };
  }
  const sourceId = opts.sourceId || (settings && settings.defaultSourceId);
  if (!sourceId) {
    togglePanel();
    return { toggled: 'panel-opened' };
  }
  const merged = {
    sourceId,
    mic: 'mic' in opts ? !!opts.mic : !!(settings && settings.defaultMic),
    sysAudio: 'sysAudio' in opts ? !!opts.sysAudio : !!(settings && settings.defaultSysAudio),
    fps: Number.isFinite(opts.fps) ? opts.fps : (settings && settings.defaultFps) || 30,
    sourceLabel: opts.sourceLabel || '',
  };
  return startRec(merged);
}

// -------------------------- library --------------------------

function readEntries(dir, tag, extRe) {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!extRe.test(name)) continue;
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const isRecovered = /\.recovered\.webm$/i.test(name);
    // Best-effort thumbnail sidecar lookup.
    let thumbDataUrl = null;
    try {
      const baseNoExt = name.replace(/\.(png|webm)$/i, '').replace(/\.recovered$/i, '.recovered');
      const thumbsDir = tag === 'shot' ? shotsThumbsDir() : recsThumbsDir();
      const thumbPath = path.join(thumbsDir, baseNoExt + '.thumb.jpg');
      if (fs.existsSync(thumbPath)) {
        const b = fs.readFileSync(thumbPath);
        thumbDataUrl = 'data:image/jpeg;base64,' + b.toString('base64');
      }
    } catch { /* thumb missing */ }
    out.push({
      kind: tag,
      recovered: isRecovered,
      path: full,
      name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      thumbDataUrl,
    });
  }
  return out;
}

function listLibrary(queryIn) {
  ensureTree();
  const query = queryIn && typeof queryIn === 'object' ? queryIn : {};
  const kind = query.kind === 'shot' || query.kind === 'rec' || query.kind === 'recovered' ? query.kind : 'all';
  const limit = Math.max(1, Math.min(1000, Number.isFinite(query.limit) ? query.limit : 200));

  let rows = [];
  if (kind === 'shot' || kind === 'all') {
    rows = rows.concat(readEntries(shotsDir(), 'shot', /\.png$/i));
  }
  if (kind === 'rec' || kind === 'all' || kind === 'recovered') {
    rows = rows.concat(readEntries(recsDir(), 'rec', /\.webm$/i));
  }
  if (kind === 'recovered') rows = rows.filter((r) => r.recovered);
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.slice(0, limit);
}

async function revealPath(p) {
  if (typeof p !== 'string' || !withinRoot(p)) return false;
  try { shell.showItemInFolder(p); return true; } catch { return false; }
}
async function trashPath(p) {
  if (typeof p !== 'string' || !withinRoot(p)) return false;
  try {
    await shell.trashItem(p);
    // Also trash a matching thumb sidecar, best-effort.
    try {
      const dir = path.dirname(p);
      const thumbsDir = path.join(dir, '.thumbs');
      const baseNoExt = path.basename(p).replace(/\.(png|webm)$/i, '');
      const thumbPath = path.join(thumbsDir, baseNoExt + '.thumb.jpg');
      if (fs.existsSync(thumbPath)) await shell.trashItem(thumbPath);
    } catch { /* sidecar orphaned — harmless */ }
    return true;
  } catch (e) {
    console.error('[studio] trash failed:', e.message);
    return false;
  }
}

// -------------------------- extra hotkeys --------------------------

// Ctrl+Alt+Shift+S — instant full-display snap under cursor, no overlay.
async function quickFullSnap() {
  let pt, disp;
  try { pt = deps.screen.getCursorScreenPoint(); }
  catch (e) { console.error('[studio] getCursorScreenPoint failed:', e.message); return; }
  try { disp = deps.screen.getDisplayNearestPoint(pt); }
  catch (e) { console.error('[studio] getDisplayNearestPoint failed:', e.message); return; }
  if (!disp) return;
  let sources;
  try {
    sources = await deps.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(disp.bounds.width  * disp.scaleFactor),
        height: Math.round(disp.bounds.height * disp.scaleFactor),
      },
    });
  } catch (e) { console.error('[studio] quick snap sources failed:', e.message); return; }
  const src = sources.find((s) => String(s.display_id) === String(disp.id)) || sources[0];
  if (!src || !src.thumbnail) return;

  ensureTree();
  const target = uniquePath(shotsDir(), slug(), '.png');
  const tmp = target + '.part';
  try {
    fs.writeFileSync(tmp, src.thumbnail.toPNG());
    fs.renameSync(tmp, target);
  } catch (e) {
    console.error('[studio] quick snap write failed:', e.message);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return;
  }
  try { clipboard.writeImage(src.thumbnail); } catch { /* ignore */ }
  broadcast(CH.CAPTURE_ADDED, { kind: 'shot', path: target, at: Date.now() });
}

// -------------------------- public init --------------------------

function init(bag) {
  if (!bag || !bag.ipcMain || !bag.app || !bag.BrowserWindow || !bag.screen || !bag.desktopCapturer) {
    console.error('[studio] init called without required deps — screen capture disabled.');
    return { CH };
  }
  deps = {
    app: bag.app,
    BrowserWindow: bag.BrowserWindow,
    screen: bag.screen,
    desktopCapturer: bag.desktopCapturer,
    ipcMain: bag.ipcMain,
    globalShortcut: bag.globalShortcut || null,
    send: typeof bag.send === 'function' ? bag.send : broadcast,
  };
  bootTime = Date.now();
  loadSettings();
  ensureTree();
  recoverPartials();

  const { ipcMain } = deps;
  ipcMain.handle(CH.PANEL_TOGGLE, () => { togglePanel(); return true; });
  ipcMain.handle(CH.SNIP_ARM, (_e, arg) => { snipArm(arg && arg.kind).catch(() => {}); return true; });
  // Overlay commits/cancels use .send (fire-and-forget) so a slow crop can't
  // block the renderer's keyup handler.
  ipcMain.on(CH.SNIP_COMMIT, (_e, arg) => { commitSnip(arg).catch(() => {}); });
  ipcMain.on(CH.SNIP_CANCEL, () => { closeOverlays(); });

  ipcMain.handle(CH.REC_SOURCES, () => listRecSources());
  ipcMain.handle(CH.REC_START,  (_e, opts) => startRec(opts));
  ipcMain.on(CH.REC_CHUNK, (_e, arg) => {
    if (!arg) return;
    const buf = arg.buf != null ? arg.buf : arg.chunk;
    writeChunk(arg.recId, arg.seq | 0, buf);
  });
  ipcMain.handle(CH.REC_STOP,  (_e, arg) => stopRec(arg && arg.recId));
  ipcMain.on(CH.REC_ABORT,     (_e, arg) => { abortRec(arg && arg.recId); });
  ipcMain.handle(CH.REC_TOGGLE, (_e, opts) => recToggle(opts));

  ipcMain.handle(CH.LIB_LIST,   (_e, q)   => listLibrary(q));
  ipcMain.handle(CH.LIB_REVEAL, (_e, p)   => revealPath(p));
  ipcMain.handle(CH.LIB_DELETE, (_e, p)   => trashPath(p));

  ipcMain.handle(CH.SET_GET, () => Object.assign({}, settings));
  ipcMain.handle(CH.SET_SET, (_e, patch) => { patchSettings(patch); return Object.assign({}, settings); });

  // Module-owned hotkeys (main.js registers the two "still free" ones, we take
  // the Shift variants and the STUDIO-realm opener).
  const gs = deps.globalShortcut;
  if (gs && settings.hotkeysEnabled) {
    const tryReg = (accel, fn) => {
      try { gs.register(accel, fn); }
      catch (e) { console.error('[studio] hotkey register failed', accel, e.message); }
    };
    tryReg('CommandOrControl+Alt+Shift+S', () => { quickFullSnap().catch(() => {}); });
    tryReg('CommandOrControl+Alt+Shift+R', () => { recToggle({ mic: false, sysAudio: false }); });
    tryReg('CommandOrControl+Alt+L',       () => { broadcast(CH.OPEN_REALM, { at: Date.now() }); });
  }

  return { CH, snipArm, recToggle, togglePanel };
}

// Exports: init is the one-shot setup call from main.js; the imperative helpers
// (snipArm, recToggle, togglePanel) are exported directly so main.js's globalShortcut
// callbacks call them by reference — no ipcMain.emit gymnastics.
module.exports = {
  init,
  CH,
  snipArm: (kind) => snipArm(kind),
  recToggle: (opts) => recToggle(opts),
  togglePanel: () => togglePanel(),
};

