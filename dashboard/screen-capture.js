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
//       hq:studio:library-open
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
//     library-open is stricter still (openableCapture): only a capture file itself reaches
//     shell.openPath.
//   - Recording state (recId, elapsedMs, bytes) is the only user-visible telemetry we log; source
//     labels and disk paths never hit console.log. The registry keys sessions by opaque recId.
//   - MediaRecorder itself runs in the renderer (Group 3, record-panel.js) — this module never
//     touches getUserMedia / getDisplayMedia. Chunks arrive over ipcRenderer.send as ArrayBuffers.
//
// v5 clean pass (S1, IPC-CONTRACT "Pending — v5 clean pass"):
//   - chunks go through rec-queue.js (seq from 0, written in order, the parked tail drained on
//     stop, gaps logged as counts) — the "recordings save empty" fix;
//   - hq:studio:rec-pause excludes paused time from elapsedMs; rec-status gains `paused`;
//   - hq:studio:panel-mode sizes the panel (setup ≈340×180 ↔ live pill ≈230×44);
//   - main-initiated stops (hotkey / low disk / 30-min limit) first push hq:studio:rec-command
//     to the recording's panel so it stops cleanly, and hard-stop after 3 s;
//   - snip-commit gains action 'save' | 'copy' | 'claude' (absent = save + copy, as before);
//     'claude' saves, then opts.launchClaude(<project path>, 'Look at this screenshot: <abs> — ').
//     The project is resolved main-side from opts.getProjects() by id — the renderer never
//     supplies a path — and the screenshot stays in the library (never copied into a repo).
//   - HQ_STUDIO_ROOT (absolute path, env only, never persisted) points the library at another
//     folder for one launch — the test seam rootOverride's IPC refusal below always intended.
//   - showPanel() is show-only (create, or show + focus). recToggle's no-source branch uses it,
//     and panel-toggle uses it while a recording runs: the panel is then the live pill, the
//     recording's visible stop control, so "Open recorder" never hides it.
//   - Recording length (2026-10-07): a successful stop writes recordings/.meta/<base>.json
//     {durationMs, startedAt, bytes} BEFORE studio:capture-added goes out, so the library-list
//     the renderer re-reads on that push already carries durationMs. Only a clean save gets one
//     (no gaps, rename done, stopped by the panel's own recStop, no backpressure pause — review
//     2026-10-07), written only when .meta really is inside the library; recordings without a
//     sidecar (older ones, .recovered.webm, gaps, hard stops) list durationMs:null, and a sidecar
//     whose bytes no longer match the file is ignored.
//   - hq:studio:library-open (2026-10-07): shell.openPath for a library capture only — a .png
//     directly in screenshots/ or a .webm directly in recordings/, a regular file whose real
//     path (links followed, 8.3 aliases expanded) still passes every rule inside the real root;
//     that real path is what opens. openPath runs the file's default handler, so nothing else
//     (.lnk, .exe, thumbs, sidecars, NTFS streams, dot-files) is ever opened.

const path = require('node:path');
const fs = require('node:fs');
const { nativeImage, shell, clipboard } = require('electron');
const { createQueue } = require('./rec-queue');

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
  LIB_OPEN: 'hq:studio:library-open',
  SET_GET: 'hq:studio:settings-get',
  SET_SET: 'hq:studio:settings-set',
  CAPTURE_ADDED: 'studio:capture-added',
  OPEN_REALM: 'hq:studio:open-realm',
  // v5 clean pass (K-7)
  REC_PAUSE: 'hq:studio:rec-pause',
  PANEL_MODE: 'hq:studio:panel-mode',
  REC_COMMAND: 'hq:studio:rec-command',
};

// Panel window sizes per mode (IPC-CONTRACT: setup ≈340×180, live pill ≈230×44).
const PANEL_SIZE = Object.freeze({
  setup: Object.freeze({ width: 340, height: 180 }),
  live: Object.freeze({ width: 230, height: 44 }),
});
const HARD_STOP_MS = 3000;              // a main-initiated stop waits this long for the panel
const REC_LIMIT_MS = 30 * 60 * 1000;    // recorded (unpaused) time before the 'limit' stop
const FINISHED_TTL_MS = 60 * 1000;      // a stop result stays answerable this long (late recStop)
const RENAME_RETRY_MS = Object.freeze([50, 100, 200, 400]);   // waits between .part → .webm retries
const SNIP_ACTIONS = Object.freeze(['save', 'copy', 'claude']);

// -------------------------- pure helpers (exported as _pure for tests) --------------------------

// 'save' | 'copy' | 'claude', or null for "absent / unknown" = today's save + copy.
function normalizeSnipAction(a) {
  return SNIP_ACTIONS.includes(a) ? a : null;
}

// What a snip commit does for each action. Absent = the pre-v5 behaviour (file + thumb +
// clipboard). copy = clipboard only: no file, no thumb, no capture-added (consumers expect a path).
function snipPlan(action) {
  switch (normalizeSnipAction(action)) {
    case 'save':   return { file: true,  clipboard: false, claude: false };
    case 'copy':   return { file: false, clipboard: true,  claude: false };
    case 'claude': return { file: true,  clipboard: false, claude: true };
    default:       return { file: true,  clipboard: true,  claude: false };
  }
}

const validProject = (p) => !!p && typeof p === 'object'
  && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 200
  && typeof p.path === 'string' && path.isAbsolute(p.path);

// The renderer-facing project list: {id, name} only — paths stay main-side.
function publicProjects(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!validProject(p)) continue;
    out.push({ id: p.id, name: String(p.name || p.id).slice(0, 120) });
    if (out.length >= 500) break;
  }
  return out;
}

// Resolve a renderer-supplied project id against main's own list. Never trusts a path from IPC.
function pickProject(list, id) {
  if (!Array.isArray(list) || typeof id !== 'string' || !id) return null;
  return list.find((p) => validProject(p) && p.id === id) || null;
}

function claudePrompt(absPath) {
  return `Look at this screenshot: ${absPath} — `;
}

// New panel bounds for a mode: the top-left corner stays put, clamped into the work area so a
// pill that started near an edge never ends up off-screen. null for an unknown mode.
function panelBounds(mode, cur, workArea) {
  const size = Object.prototype.hasOwnProperty.call(PANEL_SIZE, mode) ? PANEL_SIZE[mode] : null;
  if (!size) return null;
  let x = cur && Number.isFinite(cur.x) ? Math.round(cur.x) : 0;
  let y = cur && Number.isFinite(cur.y) ? Math.round(cur.y) : 0;
  const wa = workArea;
  if (wa && [wa.x, wa.y, wa.width, wa.height].every(Number.isFinite)) {
    x = Math.min(Math.max(x, wa.x), wa.x + Math.max(0, wa.width - size.width));
    y = Math.min(Math.max(y, wa.y), wa.y + Math.max(0, wa.height - size.height));
  }
  return { x, y, width: size.width, height: size.height };
}

// HQ_STUDIO_ROOT must be an absolute path; anything else is ignored (and said so).
function envRootFrom(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const p = v.trim();
  return path.isAbsolute(p) ? path.resolve(p) : null;
}

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
let deps = null;             // { app, BrowserWindow, screen, desktopCapturer, ipcMain, globalShortcut, send, ... }
let settings = null;
let envRoot = null;          // HQ_STUDIO_ROOT for this launch only — never written to settings
let panelWindow = null;
let overlayWindows = [];     // one per Display when a snip is armed
let panelHiddenForSnip = false;
const recorders = new Map(); // recId -> { stream, tmpPath, finalPath, q (rec-queue), bytes, owner, ... }
const finished = new Map();  // recId -> stop result, briefly, so a late recStop still gets the path
let recStatusTimer = null;
let diskWatchdogTick = 0;
let bootTime = Date.now();

// -------------------------- storage paths --------------------------

function rootDir() {
  if (envRoot) return envRoot;
  const override = settings && settings.rootOverride;
  if (override && typeof override === 'string') return override;
  return path.join(deps.app.getPath('videos'), 'WorkspaceHQ');
}
function shotsDir()      { return path.join(rootDir(), 'screenshots'); }
function recsDir()       { return path.join(rootDir(), 'recordings'); }
function shotsThumbsDir(){ return path.join(shotsDir(), '.thumbs'); }
function recsThumbsDir() { return path.join(recsDir(),  '.thumbs'); }
function recsMetaDir()   { return path.join(recsDir(),  '.meta'); }   // <base>.json length sidecars

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

// hq:studio:library-open — stricter than withinRoot, because shell.openPath RUNS the file's
// default handler: a .lnk / .exe / .bat dropped into the library must never launch. Returns
// the resolved path of a library capture, or null:
//   - an absolute string path, no NUL, not a \\?\ or \\.\ namespace path;
//   - lexically inside the root (withinRoot) and a direct child of screenshots/ (.png) or
//     recordings/ (.webm, .recovered.webm included) — never .thumbs/, .meta/ or a dot-file;
//   - no ':' in the name (an NTFS alternate data stream like a.webm:x.exe);
//   - a regular file, not a symlink, whose real path (junctions and links followed) is still
//     inside the real root — a junction inside the library that points elsewhere is refused;
//   - and every name rule holds AGAIN on that real path (review 2026-10-07): Windows answers an
//     8.3 alias as if it were the file, so screenshots\PAYLOA~1.PNG (really payload.pngexe) or
//     SECRET~1.PNG (really .secret.png) passed the lexical checks. The real path is what opens.
const OPEN_MAX_PATH = 4096;
const capturePlace = (dir, name, shots, recs) => {
  if (!name || name.startsWith('.') || name.includes(':')) return null;
  if (dir === shots && /\.png$/i.test(name)) return 'shot';
  if (dir === recs && /\.webm$/i.test(name)) return 'rec';
  return null;
};
function openableCapture(p) {
  if (typeof p !== 'string' || !p || p.length > OPEN_MAX_PATH || p.includes('\0')) return null;
  if (!path.isAbsolute(p) || /^[\\/]{2}[?.][\\/]/.test(p)) return null;
  const q = path.resolve(p);
  if (!withinRoot(q)) return null;
  const kind = capturePlace(path.dirname(q), path.basename(q), path.resolve(shotsDir()), path.resolve(recsDir()));
  if (!kind) return null;
  let st;
  try { st = fs.lstatSync(q); } catch { return null; }
  if (!st.isFile() || st.isSymbolicLink()) return null;
  try {
    const realRoot = fs.realpathSync.native(path.resolve(rootDir()));
    const realQ = fs.realpathSync.native(q);
    if (!realQ.startsWith(realRoot + path.sep)) return null;
    const realOf = (d) => { try { return fs.realpathSync.native(d); } catch { return null; } };   // a missing kind folder matches nothing
    const realKind = capturePlace(path.dirname(realQ), path.basename(realQ), realOf(shotsDir()), realOf(recsDir()));
    if (realKind !== kind) return null;
    return realQ;
  } catch { return null; }
}

// A sidecar's real folder must be inside the real library root (review 2026-10-07): withinRoot is
// lexical, so a recordings/.meta that is a junction to somewhere else would have taken the write
// (and a delete's trashItem) outside the library.
function realDirInsideRoot(dir) {
  try {
    const realRoot = fs.realpathSync.native(path.resolve(rootDir()));
    const realDir = fs.realpathSync.native(dir);
    return realDir === realRoot || realDir.startsWith(realRoot + path.sep);
  } catch { return false; }
}

// -------------------------- recording length sidecars --------------------------

// recordings/.meta/<base>.json for recordings/<base>.webm (same naming as the .thumbs sidecar).
function recMetaPath(recFile) {
  return path.join(recsMetaDir(), path.basename(String(recFile)).replace(/\.webm$/i, '') + '.json');
}
const META_MAX_BYTES = 4096;
const META_MAX_DURATION_MS = 24 * 60 * 60 * 1000;   // sanity bound; recordings stop at 30 min

// Written once, after the .part → .webm rename succeeded and before capture-added. Best-effort:
// a failed write only means the length stays unknown (the lightbox fallback), never a lost file.
function writeRecMeta(recFile, durationMs, startedAt) {
  const target = recMetaPath(recFile);
  if (!withinRoot(target)) return false;   // derived from a path this module made; checked anyway
  const tmp = target + '.part';
  try {
    const bytes = fs.statSync(recFile).size;   // ties the sidecar to this exact file
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!realDirInsideRoot(path.dirname(target))) { console.error('[studio] rec length sidecar refused: .meta resolves outside the library'); return false; }
    fs.writeFileSync(tmp, JSON.stringify({ durationMs: Math.round(durationMs), startedAt, bytes }), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.error('[studio] rec length sidecar write failed:', e.message);
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
    return false;
  }
}

// durationMs from a recording's sidecar, or null when unknown: no sidecar (recorded before
// sidecars existed, a .recovered.webm, a save with gaps), unreadable / oversized / junk JSON, a
// value that isn't a finite, non-negative number of ms, or bytes that no longer match the file
// (it was replaced or re-encoded since — the old length would be a guess).
function readRecDuration(name, size) {
  try {
    const f = recMetaPath(name);
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > META_MAX_BYTES) return null;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const d = m.durationMs;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > META_MAX_DURATION_MS) return null;
    if ('bytes' in m && m.bytes !== size) return null;
    return Math.round(d);
  } catch { return null; }
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
function effectiveSettings() {
  return Object.assign({}, settings, envRoot ? { rootOverride: envRoot } : {});
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
  for (const k of SETTINGS_KEYS) {
    if (!(k in patch)) continue;
    // rootOverride is the sole containment check for library-reveal/library-delete
    // (see withinRoot). An IPC-writable rootOverride would turn shell.trashItem into
    // an arbitrary-file trash primitive, so refuse it here — set it with the
    // HQ_STUDIO_ROOT env var at launch (init()), or by hand in studio-settings.json.
    if (k === 'rootOverride') continue;
    settings[k] = patch[k];
  }
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
    width: PANEL_SIZE.setup.width, height: PANEL_SIZE.setup.height,
    x: Number.isFinite(pos.x) ? pos.x : undefined,
    y: Number.isFinite(pos.y) ? pos.y : undefined,
    // v5: transparent so the setup card's rounded corners and the live pill's
    // 999px radius read as shapes, not as square window corners.
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false,
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

// hq:studio:panel-mode — setup card ↔ live pill. Non-resizable windows can ignore
// setBounds on Windows, so resizability is lifted for the one call.
function setPanelMode(mode) {
  const w = panelWindow;
  if (!w || w.isDestroyed()) return false;
  let cur = null;
  try { cur = w.getBounds(); } catch { return false; }
  let workArea = null;
  try { workArea = deps.screen.getDisplayMatching(cur).workArea; } catch { /* keep unclamped */ }
  const b = panelBounds(mode, cur, workArea);
  if (!b) return false;
  let wasResizable = false;
  try { wasResizable = w.isResizable(); } catch { /* ignore */ }
  try {
    if (!wasResizable) w.setResizable(true);
    w.setBounds(b);
  } catch (e) {
    console.error('[studio] panel-mode failed:', e.message);
    return false;
  } finally {
    try { if (!wasResizable) w.setResizable(false); } catch { /* window gone */ }
  }
  return true;
}

// Show-only: create the panel, or bring the existing one up and focus it. Never hides —
// for every "open the recorder" path (the hotkey with no source, the realm's Open recorder).
function showPanel() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    try { if (!panelWindow.isVisible()) panelWindow.show(); } catch { /* window mid-teardown */ }
    try { panelWindow.focus(); } catch { /* window mid-teardown */ }
    return;
  }
  makePanel();
}

// hq:studio:panel-toggle — the panel's own Hide button and the realm's "Open recorder" both
// land here. While anything is recording the panel IS the recording's live pill (its only
// stop control besides the hotkey), so a toggle then only ever shows it.
function togglePanel() {
  if (recorders.size > 0) { showPanel(); return; }
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

  // Hide the panel while we snip so we never race with its own paint (and remember
  // whether it was up, so closing the overlays doesn't pop a hidden panel back).
  panelHiddenForSnip = false;
  if (panelWindow && !panelWindow.isDestroyed()) {
    try { if (panelWindow.isVisible()) { panelWindow.hide(); panelHiddenForSnip = true; } } catch { /* ignore */ }
  }

  // The send-to-Claude picker. Only offered when main wired BOTH halves of K-5; an
  // empty list is how the overlay knows to disable the button (and say why).
  const projects = claudeWired() ? publicProjects(readProjects()) : [];

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
    w.__hqNativeImage = (pngDataUrl && deps.nativeImage.createFromDataURL(pngDataUrl)) || null;
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
          projects,
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
  if (panelHiddenForSnip && panelWindow && !panelWindow.isDestroyed()) {
    try { panelWindow.showInactive(); } catch { /* ignore */ }
  }
  panelHiddenForSnip = false;
}

// K-5 — both halves must be functions for the send-to-Claude action to exist.
function claudeWired() {
  return !!(deps && typeof deps.getProjects === 'function' && typeof deps.launchClaude === 'function');
}
function readProjects() {
  if (!deps || typeof deps.getProjects !== 'function') return [];
  try {
    const list = deps.getProjects();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('[studio] getProjects failed:', e.message);
    return [];
  }
}

// action 'claude', after the file is written: open an interactive Claude terminal in the
// chosen project with the absolute screenshot path in the prompt. Refusals are logged (the
// commit is fire-and-forget) and never lose the capture — the file is already saved.
async function sendShotToClaude(absPath, projectId) {
  if (!claudeWired()) {
    console.warn('[studio] send-to-Claude refused: launchClaude/getProjects not wired — screenshot saved only');
    return false;
  }
  const project = pickProject(readProjects(), projectId);
  if (!project) {
    console.warn('[studio] send-to-Claude refused: unknown project id — screenshot saved only');
    return false;
  }
  try {
    const ok = await deps.launchClaude(project.path, claudePrompt(absPath));
    if (!ok) console.warn('[studio] send-to-Claude: launchClaude returned false');
    return !!ok;
  } catch (e) {
    console.error('[studio] send-to-Claude failed:', e.message);
    return false;
  }
}

// Renderer commits a region via IPC; we crop the frozen bitmap main-side, then by action:
// absent → write the file atomically + thumbnail sidecar + clipboard (pre-v5 behaviour);
// 'save' → file + thumb; 'copy' → clipboard only (no file); 'claude' → file + thumb, then
// sendShotToClaude. Returns the written path, or null (copy, or a failure).
async function commitSnip(arg) {
  const payload = arg && typeof arg === 'object' ? arg : {};
  const displayId = payload.displayId;
  const rectDIP = payload.rectDIP || null;
  const mode = payload.mode === 'full' ? 'full' : (payload.mode === 'window' ? 'window' : 'region');
  const plan = snipPlan(payload.action);
  const projectId = typeof payload.projectId === 'string' ? payload.projectId.slice(0, 200) : null;

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

  if (!plan.file) {
    // 'copy' — the clipboard is the whole job; nothing lands on disk.
    try { deps.clipboard.writeImage(out); } catch (e) { console.error('[studio] clipboard write failed:', e.message); }
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
  if (plan.clipboard) {
    try { deps.clipboard.writeImage(out); } catch { /* clipboard busy */ }
  }

  broadcast(CH.CAPTURE_ADDED, { kind: 'shot', path: target, at: Date.now() });
  if (plan.claude) await sendShotToClaude(target, projectId);
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

// One rec-status 'recording' payload. elapsedMs excludes paused time (rec-queue accounting).
function recordingStatus(recId, r, now = Date.now()) {
  return {
    state: 'recording',
    recId,
    elapsedMs: r.q.elapsed(now, r.startedAt),
    bytes: r.bytes,
    paused: r.q.paused,
    sourceLabel: r.sourceLabel,
    mic: r.mic,
    sysAudio: r.sysAudio,
    lastPath: null,
  };
}

function recStatusTick() {
  const now = Date.now();
  for (const [recId, r] of recorders) {
    if (r.stopping) continue;
    const status = recordingStatus(recId, r, now);
    broadcast(CH.REC_STATUS, status);
    // 30 min of recorded (unpaused) time → stop. 'auto-split' is the existing state name;
    // recording does NOT continue in a new file (that continuation is a recorded cut).
    if (status.elapsedMs >= REC_LIMIT_MS && !r.stopRequested) {
      broadcast(CH.REC_STATUS, { state: 'auto-split', recId, lastPath: r.finalPath });
      requestStop(recId, 'limit');
    }
  }
  // Disk-space watchdog — every 10th tick (~10s) is enough on a hot loop and
  // never blocks the tick.
  diskWatchdogTick = (diskWatchdogTick + 1) % 10;
  if (diskWatchdogTick === 0 && recorders.size && typeof fs.statfsSync === 'function') {
    for (const [recId, r] of recorders) {
      if (r.stopping || r.stopRequested) continue;
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
        requestStop(recId, 'lowdisk');
      }
    }
  }
  stopRecStatusPushIfIdle();
}

// owner = the webContents that called rec-start (the record panel feeding the chunks).
function startRec(optsIn, owner) {
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
    q: null,             // rec-queue: in-order writes, parked tail, pause accounting
    startedAt: Date.now(),
    bytes: 0,
    sourceId: opts.sourceId || null,
    mic: !!opts.mic,
    sysAudio: !!opts.sysAudio,
    fps: Number.isFinite(opts.fps) ? opts.fps : (settings.defaultFps || 30),
    sourceLabel: String(opts.sourceLabel || ''),
    stopping: false,
    stopPromise: null,
    stopRequested: null, // reason of a pending main-initiated stop
    cleanStop: false,    // the FIRST stop was the panel's own recStop (flushed), not a hard stop / panel gone / write error
    hardStopTimer: null,
    backpressured: false,
    hadBackpressure: false, // the panel paused its MediaRecorder for the disk, but this clock kept running
    owner: owner && typeof owner.send === 'function' ? owner : null,
    onOwnerGone: null,
    onOwnerNav: null,
  };
  r.q = createQueue({
    write(b) {
      r.bytes += b.length;
      const ok = r.stream.write(b);
      if (!ok && !r.backpressured) {
        // Backpressure — nudge the panel to pause its MediaRecorder; one drain
        // listener at a time, however many writes came back false.
        r.backpressured = true;
        r.hadBackpressure = true;
        broadcast(CH.REC_STATUS, { state: 'backpressure', recId, bytes: r.bytes });
        r.stream.once('drain', () => {
          r.backpressured = false;
          broadcast(CH.REC_STATUS, { state: 'drained', recId, bytes: r.bytes });
        });
      }
    },
  });
  stream.on('error', (e) => {
    console.error('[studio] rec stream error:', e.message);
    broadcast(CH.REC_STATUS, { state: 'error', recId });
  });
  // The panel went away mid-recording: keep what arrived. Closed = 'destroyed'; a crashed
  // renderer is NOT destroyed, it fires 'render-process-gone' (and could never send recStop);
  // a reload / main-frame navigation starts a new document that doesn't own this recording.
  // Same three signals as hq:llm:chat in main.js.
  if (r.owner && typeof r.owner.once === 'function') {
    r.onOwnerGone = () => { if (recorders.get(recId) === r) stopRec(recId).catch(() => {}); };
    r.onOwnerNav = (ev) => {
      if (ev && (ev.isMainFrame === false || ev.isSameDocument === true)) return;
      r.onOwnerGone();
    };
    try {
      r.owner.once('destroyed', r.onOwnerGone);
      r.owner.once('render-process-gone', r.onOwnerGone);
      if (typeof r.owner.on === 'function') r.owner.on('did-start-navigation', r.onOwnerNav);
    } catch { /* clearRecTimers removes whatever did register */ }
  }
  recorders.set(recId, r);
  ensureRecStatusPush();
  broadcast(CH.REC_STATUS, recordingStatus(recId, r));
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
  // Out-of-order IPC frames park in the queue until their turn; junk seqs are ignored.
  try { r.q.push(seq, asBuf); }
  catch (e) {
    // rec-queue contract: stop on a write error rather than keep pushing.
    console.error('[studio] rec write failed:', e.message);
    broadcast(CH.REC_STATUS, { state: 'error', recId });
    stopRec(recId).catch(() => {});
    return false;
  }
  return true;
}

// hq:studio:rec-pause — user pause/resume; the panel pauses its own MediaRecorder.
function recPause(recId, paused) {
  const r = recorders.get(recId);
  if (!r || r.stopping) return false;
  if (paused) r.q.pause(); else r.q.resume();
  broadcast(CH.REC_STATUS, recordingStatus(recId, r));
  return true;
}

// A webContents that can still receive a rec-command: present, not destroyed, renderer alive.
function liveWebContents(wc) {
  if (!wc || typeof wc.send !== 'function') return null;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return null;
  if (typeof wc.isCrashed === 'function' && wc.isCrashed()) return null;
  return wc;
}

// A stop main decides on (hotkey, low disk, 30-min limit, write error): ask the panel that
// feeds the recording to stop cleanly (flush its last chunk, then recStop), and hard-stop
// with whatever arrived if it hasn't finished within HARD_STOP_MS. No live panel → hard-stop now.
function requestStop(recId, reason) {
  const r = recorders.get(recId);
  if (!r || r.stopping) return false;
  if (r.stopRequested) return true;
  r.stopRequested = reason;
  // A crashed renderer isn't destroyed but can't answer either: asking it would only
  // delay the stop by HARD_STOP_MS.
  let wc = liveWebContents(r.owner);
  if (!wc && panelWindow && !panelWindow.isDestroyed()) wc = liveWebContents(panelWindow.webContents);
  let asked = false;
  if (wc) {
    try { wc.send(CH.REC_COMMAND, { cmd: 'stop', reason, recId }); asked = true; } catch { /* panel mid-teardown */ }
  }
  if (!asked) { stopRec(recId).catch(() => {}); return true; }
  const ms = Number.isFinite(deps.hardStopMs) ? deps.hardStopMs : HARD_STOP_MS;
  r.hardStopTimer = setTimeout(() => {
    r.hardStopTimer = null;
    if (recorders.get(recId) !== r || r.stopping) return;
    console.warn('[studio] rec', recId, 'panel did not stop within', ms, 'ms (' + reason + ') — hard stop');
    stopRec(recId).catch(() => {});
  }, ms);
  return true;
}

// Resolve once the write stream's fd is closed (end = flush first; destroy = discard).
function closeStream(stream, how) {
  return new Promise((resolve) => {
    if (!stream || stream.closed) { resolve(); return; }
    stream.once('close', resolve);
    try { if (how === 'destroy') stream.destroy(); else stream.end(); } catch { resolve(); }
  });
}

function clearRecTimers(r) {
  if (r.hardStopTimer) { clearTimeout(r.hardStopTimer); r.hardStopTimer = null; }
  if (r.owner && typeof r.owner.removeListener === 'function') {
    try {
      if (r.onOwnerGone) {
        r.owner.removeListener('destroyed', r.onOwnerGone);
        r.owner.removeListener('render-process-gone', r.onOwnerGone);
      }
      if (r.onOwnerNav) r.owner.removeListener('did-start-navigation', r.onOwnerNav);
    } catch { /* ignore */ }
  }
  r.onOwnerGone = null;
  r.onOwnerNav = null;
}

// .part → .webm. On Windows a sync client / indexer / AV scanner holding the file without
// FILE_SHARE_DELETE makes the rename fail with EBUSY / EPERM / EACCES for a moment: retry those
// on a short backoff (deps.renameRetryMs). Returns null on success, the last error otherwise.
const RENAME_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
async function renameWithRetry(from, to) {
  const waits = Array.isArray(deps && deps.renameRetryMs) ? deps.renameRetryMs : RENAME_RETRY_MS;
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return null; }
    catch (e) {
      if (attempt >= waits.length || !RENAME_RETRY_CODES.has(e && e.code)) return e || new Error('rename failed');
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
    }
  }
}

function rememberFinished(recId, result) {
  finished.set(recId, result);
  const t = setTimeout(() => finished.delete(recId), FINISHED_TTL_MS);
  if (t && typeof t.unref === 'function') t.unref();
}

// Drain the parked tail in order (gaps logged as counts), close + fsync + rename. Concurrent
// callers (the panel's recStop racing a hard stop) share one promise; a recStop that lands
// after the recording finished gets the remembered result instead of null.
// how.clean: the panel's own hq:studio:rec-stop (it flushed its last chunk first). Every other
// first stop (hard stop, panel gone, write error) may have lost a tail, so its time isn't the file's.
function stopRec(recId, how) {
  const r = recorders.get(recId);
  if (!r) return Promise.resolve(finished.get(recId) || null);
  if (r.stopping) return r.stopPromise;
  r.stopping = true;
  r.cleanStop = !!(how && how.clean === true);
  clearRecTimers(r);
  r.stopPromise = (async () => {
    let drained = null;
    try { drained = r.q.stop(); }
    catch (e) { console.error('[studio] rec drain failed:', e.message); }
    if (drained && drained.gaps.length) {
      const g = drained.gaps;
      console.warn('[studio] rec', recId, 'saved with', g.length, 'missing chunk(s):',
        g.slice(0, 20).join(',') + (g.length > 20 ? ',…' : ''), '· written', drained.written);
    }
    const endedAt = Date.now();
    const durationMs = r.q.elapsed(endedAt, r.startedAt);
    await closeStream(r.stream, 'end');
    try {
      const fd = fs.openSync(r.tmpPath, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch { /* best-effort fsync */ }
    const renameErr = await renameWithRetry(r.tmpPath, r.finalPath);

    recorders.delete(recId);
    stopRecStatusPushIfIdle();

    const gaps = drained ? drained.gaps.length : null;
    const reason = r.stopRequested || null;
    if (renameErr) {
      // The bytes are safe in the .part (recoverPartials turns it into a .recovered.webm at
      // the next launch), but there is no .webm: never report a path, never announce a capture.
      const code = renameErr.code || 'error';
      console.error('[studio] rec rename failed:', code, renameErr.message);
      const error = `rename failed: ${code} — kept as ${path.basename(r.tmpPath)}, recovered at next launch`;
      const failed = { path: null, error, partPath: r.tmpPath, bytes: r.bytes, durationMs, gaps, reason };
      rememberFinished(recId, failed);
      broadcast(CH.REC_STATUS, {
        state: 'stopped', recId, elapsedMs: durationMs, bytes: r.bytes, paused: false,
        sourceLabel: r.sourceLabel, lastPath: null, error,
      });
      return failed;
    }

    const result = { path: r.finalPath, bytes: r.bytes, durationMs, gaps, reason };
    rememberFinished(recId, result);
    // The length sidecar lands BEFORE capture-added: the renderer re-reads library-list on
    // that push and must already see durationMs. Only a save whose recorded time IS the file's
    // length gets one: no gaps (a failed drain is gaps null), stopped by the panel's own recStop
    // (a hard stop counted up to HARD_STOP_MS the file never got; a vanished panel lost its tail),
    // and no backpressure (the panel paused its MediaRecorder for the disk, this clock didn't).
    // Anything else stays unknown → the lightbox's loadedmetadata fallback. Review 2026-10-07.
    if (gaps === 0 && r.cleanStop && !r.hadBackpressure) writeRecMeta(r.finalPath, durationMs, r.startedAt);
    broadcast(CH.CAPTURE_ADDED, {
      kind: 'rec', path: r.finalPath, at: endedAt, durationMs, bytes: r.bytes,
    });
    broadcast(CH.REC_STATUS, {
      state: 'stopped', recId, elapsedMs: durationMs, bytes: r.bytes, paused: false,
      sourceLabel: r.sourceLabel, lastPath: r.finalPath,
    });
    return result;
  })();
  return r.stopPromise;
}

async function abortRec(recId) {
  const r = recorders.get(recId);
  if (!r || r.stopping) return;
  r.stopping = true;
  clearRecTimers(r);
  try { r.q.stop(); } catch { /* discarding anyway */ }
  // Unlink only once the fd is closed: the stream opens asynchronously, so an unlink right
  // after destroy() can run before the file exists, and the open then leaves an empty .part.
  await closeStream(r.stream, 'destroy');
  try { fs.unlinkSync(r.tmpPath); } catch { /* already gone */ }
  recorders.delete(recId);
  stopRecStatusPushIfIdle();
  broadcast(CH.REC_STATUS, { state: 'aborted', recId });
}

// Hotkey path. If anything is recording, ask its panel to stop (hard stop after 3 s);
// otherwise start with the caller's opts or the saved defaults; if we still have no source,
// open the panel so the user can pick one.
function recToggle(optsIn) {
  const opts = optsIn && typeof optsIn === 'object' ? optsIn : {};
  if (recorders.size > 0) {
    const [firstId] = recorders.keys();
    requestStop(firstId, 'hotkey');
    return { toggled: 'stopped', recId: firstId };
  }
  // MediaRecorder lives in the record-panel renderer — without a caller who is
  // already feeding chunks (i.e. opts.sourceId came from that renderer), opening
  // the file here just produces an empty .part. Hotkey with no live panel:
  // surface the panel and let the user press Rec there. Show-only: pressing the
  // hotkey again while the setup card is up keeps it up (it used to hide it).
  if (!opts.sourceId) {
    showPanel();
    return { toggled: 'panel-opened' };
  }
  const merged = {
    sourceId: opts.sourceId,
    mic: 'mic' in opts ? !!opts.mic : !!(settings && settings.defaultMic),
    sysAudio: 'sysAudio' in opts ? !!opts.sysAudio : !!(settings && settings.defaultSysAudio),
    fps: Number.isFinite(opts.fps) ? opts.fps : (settings && settings.defaultFps) || 30,
    sourceLabel: opts.sourceLabel || '',
  };
  return startRec(merged, null);
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
      // recorded length from the .meta sidecar; null = unknown (shots, recovered, no sidecar)
      durationMs: tag === 'rec' && !isRecovered ? readRecDuration(name, st.size) : null,
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
  try { deps.shell.showItemInFolder(p); return true; } catch { return false; }
}
async function trashPath(p) {
  if (typeof p !== 'string' || !withinRoot(p)) return false;
  try {
    await deps.shell.trashItem(p);
    // Also trash a matching thumb sidecar, best-effort.
    try {
      const dir = path.dirname(p);
      const thumbsDir = path.join(dir, '.thumbs');
      const baseNoExt = path.basename(p).replace(/\.(png|webm)$/i, '');
      const thumbPath = path.join(thumbsDir, baseNoExt + '.thumb.jpg');
      if (fs.existsSync(thumbPath)) await deps.shell.trashItem(thumbPath);
    } catch { /* sidecar orphaned — harmless */ }
    // …and a recording's length sidecar, so a stale one can never describe another file.
    try {
      if (/\.webm$/i.test(p)) {
        const metaPath = recMetaPath(p);
        if (path.dirname(path.resolve(p)) === path.resolve(recsDir()) && fs.existsSync(metaPath) && realDirInsideRoot(path.dirname(metaPath))) await deps.shell.trashItem(metaPath);
      }
    } catch { /* orphaned sidecar — readRecDuration also checks bytes */ }
    return true;
  } catch (e) {
    console.error('[studio] trash failed:', e.message);
    return false;
  }
}
// true = the OS took the open request; false = refused (not a library capture, or gone);
// {error} = shell.openPath's own message (e.g. no app associated with the file type).
async function openPath(p) {
  const q = openableCapture(p);
  if (!q) return false;
  try {
    const err = await deps.shell.openPath(q);
    return err ? { error: String(err) } : true;
  } catch (e) {
    return { error: (e && e.message) || 'open failed' };
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
  try { deps.clipboard.writeImage(src.thumbnail); } catch { /* ignore */ }
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
    // K-5 (main.js wires these; either may be missing — the claude action then refuses)
    getProjects: typeof bag.getProjects === 'function' ? bag.getProjects : null,
    launchClaude: typeof bag.launchClaude === 'function' ? bag.launchClaude : null,
    // Electron modules, injectable so screen-capture.test.mjs can run under plain Node.
    clipboard: bag.clipboard || clipboard,
    nativeImage: bag.nativeImage || nativeImage,
    shell: bag.shell || shell,
    hardStopMs: Number.isFinite(bag.hardStopMs) ? bag.hardStopMs : HARD_STOP_MS,
    renameRetryMs: Array.isArray(bag.renameRetryMs) && bag.renameRetryMs.every(Number.isFinite)
      ? bag.renameRetryMs.slice() : RENAME_RETRY_MS,
  };
  bootTime = Date.now();
  envRoot = envRootFrom(process.env.HQ_STUDIO_ROOT);
  if (process.env.HQ_STUDIO_ROOT && !envRoot) console.warn('[studio] HQ_STUDIO_ROOT ignored — it must be an absolute path');
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
  ipcMain.handle(CH.REC_START,  (e, opts) => startRec(opts, e && e.sender));
  ipcMain.on(CH.REC_CHUNK, (_e, arg) => {
    if (!arg) return;
    const buf = arg.buf != null ? arg.buf : arg.chunk;
    // seq goes to rec-queue as sent: it validates integers itself ("seq | 0" turned junk into 0).
    writeChunk(arg.recId, arg.seq, buf);
  });
  ipcMain.handle(CH.REC_STOP,  (_e, arg) => stopRec(arg && arg.recId, { clean: true }));
  ipcMain.on(CH.REC_ABORT,     (_e, arg) => { abortRec(arg && arg.recId); });
  ipcMain.handle(CH.REC_TOGGLE, (_e, opts) => recToggle(opts));
  ipcMain.on(CH.REC_PAUSE,      (_e, arg) => { if (arg) recPause(arg.recId, !!arg.paused); });
  ipcMain.handle(CH.PANEL_MODE, (_e, arg) => setPanelMode(arg && arg.mode));

  ipcMain.handle(CH.LIB_LIST,   (_e, q)   => listLibrary(q));
  ipcMain.handle(CH.LIB_REVEAL, (_e, p)   => revealPath(p));
  ipcMain.handle(CH.LIB_DELETE, (_e, p)   => trashPath(p));
  ipcMain.handle(CH.LIB_OPEN,   (_e, p)   => openPath(p));

  // rootOverride reads back the EFFECTIVE override (HQ_STUDIO_ROOT wins), so a test can
  // confirm where captures will land before it records anything.
  ipcMain.handle(CH.SET_GET, () => effectiveSettings());
  ipcMain.handle(CH.SET_SET, (_e, patch) => { patchSettings(patch); return effectiveSettings(); });

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

  return { CH, snipArm, recToggle, togglePanel, showPanel };
}

// Exports: init is the one-shot setup call from main.js; the imperative helpers
// (snipArm, recToggle, togglePanel, showPanel) are exported directly so main.js's
// globalShortcut callbacks call them by reference — no ipcMain.emit gymnastics.
module.exports = {
  init,
  CH,
  // pure helpers, for screen-capture.test.mjs
  _pure: { normalizeSnipAction, snipPlan, publicProjects, pickProject, claudePrompt, panelBounds, envRootFrom, PANEL_SIZE },
  snipArm: (kind) => snipArm(kind),
  recToggle: (opts) => recToggle(opts),
  togglePanel: () => togglePanel(),
  showPanel: () => showPanel(),
};

