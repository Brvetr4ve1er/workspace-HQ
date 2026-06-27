// WorkspaceHQ Electron shell.
// - refreshes data.js from sidecars on launch and after every scan
// - system tray (Show / Scan now / Quit) with a level+health tooltip
// - native notifications for quest completions (driven by changes_since_prev[].notify)
// - IPC: run scan, open a repo folder, mark a quest done (persists via quest-overrides.json)
//
// Tauri alternative: dashboard/ is the distDir; a src-tauri wrapper would call the
// same run-pipeline.ps1 and the same data/quest-overrides.json from a Rust command.

const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, shell, nativeImage, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync, spawn } = require('node:child_process');

const DIR = __dirname;
const SCAN_DIR = path.join(DIR, '..');
const PIPELINE = path.join(SCAN_DIR, 'run-pipeline.ps1');
const COLLECTOR = path.join(SCAN_DIR, 'collector');
const DATA = path.join(SCAN_DIR, 'data');
const DOCS_ROOT = 'C:\\Users\\ROG STRIX\\Documents';
const VAULT = path.join(DOCS_ROOT, 'VEEMO CORTEX');
const PROJECT_NOTES_DIR = path.join(VAULT, '30_Areas', 'Projects');
const NOTIFY_STATE = path.join(DATA, '.notify-state.json');
const HUD_STATE = path.join(DATA, '.hud-state.json');
const QUEST_BOARD = path.join(VAULT, '30_Areas', 'Workspace Status', 'Quest Board.md');
const START_HIDDEN = process.argv.includes('--hidden') || process.argv.includes('--start-minimized');
let win, tray, watcher, miniWin, qbWatcher;
const activeDevServers = new Map();

// Project paths in the data are already absolute (e.g. C:\Users\...\alliance travel);
// only fall back to joining DOCS_ROOT for legacy relative paths. Reject anything that
// escapes DOCS_ROOT after resolution.
function resolveProjectPath(p) {
  const s = String(p || '');
  const abs = path.resolve(path.isAbsolute(s) ? s : path.join(DOCS_ROOT, s.replace(/\//g, path.sep)));
  return abs.startsWith(path.resolve(DOCS_ROOT) + path.sep) || abs === path.resolve(DOCS_ROOT) ? abs : null;
}

// ---- Phase 3: mirror drawer notes into per-project vault notes -------------
// The app keeps data/project-notes.json as its display source, AND mirrors each
// entry into VEEMO CORTEX/30_Areas/Projects/<name>.md under a dedicated
// "WorkspaceHQ log" section so project tasks/mistakes live in the second brain.
// Additive only: creates the note if missing, prepends entries under the heading.
const NOTE_HEAD = '## 🛠️ WorkspaceHQ log';
function safeFile(name) { return String(name || 'project').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'project'; }
function mirrorProjectNote(name, id, text, prod) {
  fs.mkdirSync(PROJECT_NOTES_DIR, { recursive: true });
  const file = path.join(PROJECT_NOTES_DIR, safeFile(name) + '.md');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `- ${stamp} — ${text}`;
  if (!fs.existsSync(file)) {
    const meta = prod ? `> [!info] ${prod.completion?.pct ?? '?'}% complete · ${(prod.stack || []).slice(0, 4).join(' · ')} · \`${prod.path || ''}\`` : '';
    fs.writeFileSync(file, [
      '---', `title: ${name}`, 'type: project', 'tags: [workspace, project]',
      `workspacehq_id: ${id}`, 'generated_by: workspacehq', '---', '',
      `# ${name}`, '', meta, '', NOTE_HEAD, entry, '',
    ].join('\n'));
  } else {
    let content = fs.readFileSync(file, 'utf8');
    content = content.includes(NOTE_HEAD)
      ? content.replace(NOTE_HEAD, `${NOTE_HEAD}\n${entry}`)
      : content.trimEnd() + `\n\n${NOTE_HEAD}\n${entry}\n`;
    fs.writeFileSync(file, content);
  }
  return file;
}

function rebuildData() {
  // process.execPath is electron.exe; ELECTRON_RUN_AS_NODE makes it run the .mjs as
  // plain Node and exit, instead of treating it as a second app entry (which hangs
  // this blocking spawnSync and stops the window from ever being created).
  const r = spawnSync(process.execPath, [path.join(DIR, 'build-data.mjs')], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  if (r.stdout) console.log(r.stdout.trim());
}
function latest() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'latest.json'), 'utf8')); } catch { return null; }
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1180, height: 820, backgroundColor: '#0d1117', title: 'WorkspaceHQ',
    icon: path.join(DIR, 'icon.png'), show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  win.loadFile(path.join(DIR, 'index.html'));
  // Close-to-tray: keep the app (and tray) alive when the user closes the window,
  // unless they explicitly quit. The dead app.isQuitting flag now drives this.
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

// ---- mini HUD: small always-on-top ambient widget ----------------------
// A second frameless window that floats LV/XP/HP/streak + the single most urgent
// quest while you work. Clicking the quest row opens the full console; the whole
// card is draggable to reposition (see -webkit-app-region in mini.html).
function miniPayload() {
  const s = latest(); if (!s) return null;
  const a = s.account;
  const rank = { red: 0, orange: 1, yellow: 2 };
  const top = (s.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .sort((x, y) => (rank[x.tier] - rank[y.tier]) || (y.xp - x.xp) || (y.age_days - x.age_days))[0];
  const xpPct = a.xp_to_next ? (a.xp_into_level / (a.xp_into_level + a.xp_to_next)) * 100 : 100;
  return {
    level: a.level, title: a.title || '',
    xpPct: Math.round(xpPct), xp: a.xp, xpToNext: a.xp_to_next,
    hp: a.health_index, streak: a.streak?.scan_days ?? 0,
    openQuests: a.totals.open_quests, redQuests: a.totals.red_quests,
    topQuest: top ? { title: top.title, tier: top.tier, xp: top.xp } : null,
  };
}
function pushMini() { if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('hq:mini-update', miniPayload()); }

function hudPrefVisible() {
  try { return JSON.parse(fs.readFileSync(HUD_STATE, 'utf8')).miniVisible !== false; } catch { return true; }
}
function saveHudPref(v) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(HUD_STATE, JSON.stringify({ miniVisible: v })); } catch {}
}

function createMiniWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 286, H = 134, margin = 16;
  miniWin = new BrowserWindow({
    width: W, height: H,
    x: wa.x + wa.width - W - margin,
    y: wa.y + wa.height - H - margin,
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    fullscreenable: false, maximizable: false, minimizable: false,
    backgroundColor: '#00000000', title: 'WorkspaceHQ HUD',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  // float above fullscreen apps too, on every virtual desktop
  miniWin.setAlwaysOnTop(true, 'screen-saver');
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWin.loadFile(path.join(DIR, 'mini.html'));
  miniWin.on('closed', () => { miniWin = null; });
}
function showMini() {
  if (!miniWin || miniWin.isDestroyed()) createMiniWindow(); else miniWin.show();
  saveHudPref(true); updateTray();
}
function hideMini() {
  if (miniWin && !miniWin.isDestroyed()) miniWin.hide();
  saveHudPref(false); updateTray();
}
function toggleMini() { (miniWin && !miniWin.isDestroyed() && miniWin.isVisible()) ? hideMini() : showMini(); }

function updateTray() {
  if (!tray) return;
  const s = latest();
  tray.setToolTip(s ? `WorkspaceHQ — L${s.account.level} ${s.account.title} · health ${s.account.health_index} · ${s.account.totals.open_quests} open` : 'WorkspaceHQ');
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(DIR, 'icon.png')));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show WorkspaceHQ', click: () => { if (!win) createWindow(); else win.show(); } },
    { label: 'Toggle mini HUD', click: toggleMini },
    { label: 'Scan now', click: runScan },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (!win) createWindow(); else (win.isVisible() ? win.focus() : win.show()); });
  updateTray();
}

// Fire a native notification for each notify=true change in the latest scan,
// but only once per scan id (tracked in .notify-state.json).
function notifyForLatest() {
  const s = latest(); if (!s) return;
  let state = {}; try { state = JSON.parse(fs.readFileSync(NOTIFY_STATE, 'utf8')); } catch {}
  if (state.last_notified === s.scan.id) return;
  const fire = (s.changes_since_prev || []).filter((c) => c.notify);
  fire.slice(0, 5).forEach((c) => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: c.type === 'quest_completed' ? '✅ Quest complete (+XP)' : c.impact === 'negative' ? '⚠ Needs attention' : 'WorkspaceHQ',
      body: c.detail, icon: path.join(DIR, 'icon.png'),
    }).show();
  });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(NOTIFY_STATE, JSON.stringify({ last_notified: s.scan.id }));
}

// ---- quest completion (shared by the in-app DONE button and the Obsidian sync) ----
function readOverrides() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'quest-overrides.json'), 'utf8')); } catch { return {}; }
}
// Mark one or more quest / side-quest ids done in quest-overrides.json, then recompute
// the CURRENT scan (same date) so XP/quests reflect the closure, and refresh the UI.
// Re-runs assemble only — never render — so Quest Board.md is left untouched (no loop).
function applyDone(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return false;
  const ov = readOverrides();
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const id of list) {
    if (ov[id]?.status === 'done') continue;
    ov[id] = { status: 'done', completed: today };
    changed = true;
  }
  if (!changed) return false;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'quest-overrides.json'), JSON.stringify(ov, null, 2));
  const s = latest();
  if (s) spawnSync(process.execPath, [path.join(COLLECTOR, 'assemble.mjs'), '--date', s.scan.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  rebuildData(); if (win && !win.isDestroyed()) win.reload(); updateTray(); pushMini();
  return true;
}

// Quest/side-quest ids that sit on a CHECKED Tasks line carrying a 🆔 marker. The
// "Completed this scan" section has no 🆔, so it's skipped automatically.
function checkedQuestIds(text) {
  const ids = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!/^\s*[-*]\s*\[[xX]\]/.test(line)) continue;     // a ticked checkbox
    const m = line.match(/🆔\s*([A-Za-z0-9_-]+)/);        // ...that carries a quest id
    if (m) ids.push(m[1]);
  }
  return ids;
}

// Two-way sync: tick a quest in Obsidian's Quest Board.md → mirror that completion back
// into quest-overrides.json (the same store the dashboard writes). Debounced past the
// render.mjs rewrite; unticking is intentionally ignored.
function watchQuestBoard() {
  const dir = path.dirname(QUEST_BOARD);
  try {
    let t = null;
    qbWatcher = fs.watch(dir, (_evt, file) => {
      if (file !== path.basename(QUEST_BOARD)) return;
      clearTimeout(t);
      t = setTimeout(() => {
        let text = '';
        try { text = fs.readFileSync(QUEST_BOARD, 'utf8'); } catch { return; }
        const ov = readOverrides();
        const fresh = checkedQuestIds(text).filter((id) => ov[id]?.status !== 'done');
        if (fresh.length) { console.log('[quest-board] vault→app completion:', fresh.join(', ')); applyDone(fresh); }
      }, 1200);
    });
  } catch (e) { console.error('watchQuestBoard failed:', e); }
}

function runScan() {
  if (win) win.setTitle('WorkspaceHQ — scanning…');
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PIPELINE], { windowsHide: true });
  ps.on('close', (code) => {
    if (win) win.setTitle('WorkspaceHQ');
    if (code === 0) { rebuildData(); if (win) win.reload(); updateTray(); pushMini(); notifyForLatest(); }
    else if (win) dialog.showErrorBox('Scan failed', `Pipeline exited ${code}. See workspace hq/logs.`);
  });
}

// IPC
ipcMain.handle('hq:scan', () => { runScan(); return true; });
ipcMain.handle('hq:open-repo', (_e, rel) => {
  const target = resolveProjectPath(rel);
  if (!target) { dialog.showErrorBox('Open folder', `Refused to open path outside Documents: ${rel}`); return false; }
  return shell.openPath(target);
});
// Works for both core quest ids (q-…) and side-quest ids (sq-…) — both live in the
// same quest-overrides.json store that assemble.mjs reads.
ipcMain.handle('hq:quest-done', (_e, id) => { if (!id) return false; applyDone(id); return true; });

function sendDevStatus(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('hq:dev-status', payload);
}

ipcMain.handle('hq:dev-start', (_e, id) => {
  try {
    if (activeDevServers.has(id)) return false;
    const s = latest();
    if (!s) return false;
    const prod = (s.projects || []).find((p) => p.id === id);   // data key is `projects`, not `products`
    if (!prod || !prod.dev_cmd) { dialog.showErrorBox('Dev server', `No dev command for "${id}".`); return false; }

    const cwd = resolveProjectPath(prod.path);
    if (!cwd) { dialog.showErrorBox('Dev server', `Invalid project path for "${id}": ${prod.path}`); return false; }

    // dev_cmd may contain quoted paths / spaces; spawn with shell:true and pass it whole.
    const proc = spawn(prod.dev_cmd, { cwd, shell: true });
    activeDevServers.set(id, proc);

    proc.on('close', (code) => {
      activeDevServers.delete(id);
      sendDevStatus({ id, running: false, code });
    });
    proc.on('error', (err) => {
      activeDevServers.delete(id);
      console.error(`Dev server error for ${id}:`, err);
      sendDevStatus({ id, running: false, error: String(err.message || err) });
    });

    sendDevStatus({ id, running: true });
    return true;
  } catch (err) {
    dialog.showErrorBox('Dev server failed to start', String(err && err.message || err));
    return false;
  }
});

ipcMain.handle('hq:dev-stop', (_e, id) => {
  const proc = activeDevServers.get(id);
  if (proc && proc.pid) {
    const r = spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
    activeDevServers.delete(id);
    sendDevStatus({ id, running: false });
    return r.status === 0;
  }
  return false;
});

ipcMain.handle('hq:note-save', (_e, id, note) => {
  const notesFile = path.join(DATA, 'project-notes.json');
  let notes = {};
  try { notes = JSON.parse(fs.readFileSync(notesFile, 'utf8')); } catch {}
  if (!notes[id]) notes[id] = [];
  notes[id].push({ id: Date.now().toString(), date: new Date().toISOString(), text: note, completed: false });
  fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
  // mirror into the vault second brain (best-effort; never block the app save)
  try {
    const s = latest();
    const prod = s && (s.projects || []).find((p) => p.id === id);
    mirrorProjectNote(prod ? prod.name : id, id, note, prod);
  } catch (e) { console.error('vault note mirror failed:', e); }
  return true;
});

// mini HUD IPC
ipcMain.handle('hq:mini-data', () => miniPayload());
ipcMain.handle('hq:show-main', () => { if (!win) createWindow(true); else win.show(); if (win) win.focus(); return true; });
ipcMain.handle('hq:mini-hide', () => { hideMini(); return true; });

// Single-instance lock: a second launch (e.g. autostart + manual) just focuses the
// running window instead of opening a duplicate tray / racing the pipeline writers.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    else createWindow(true);
  });

  // Watch the data sidecar so the always-open UI refreshes itself when the scheduled
  // scan (register-task.ps1: logon +2min / daily 00:00) lands a new latest.json.
  function watchData() {
    try {
      let t = null;
      watcher = fs.watch(DATA, (_evt, file) => {
        if (file !== 'latest.json') return;
        clearTimeout(t);
        t = setTimeout(() => { rebuildData(); if (win && !win.isDestroyed()) win.reload(); updateTray(); pushMini(); notifyForLatest(); }, 800);
      });
    } catch (e) { console.error('watchData failed:', e); }
  }

  app.whenReady().then(() => {
    // Persist as the main dashboard: launch at login, hidden to tray.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }
    rebuildData();
    createWindow(!START_HIDDEN);
    createTray();
    if (hudPrefVisible()) createMiniWindow();   // ambient HUD floats even when started to tray
    watchData();
    watchQuestBoard();   // two-way: ticking a quest in Obsidian completes it here
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'WorkspaceHQ', submenu: [
        { label: 'Scan now', accelerator: 'CmdOrCtrl+R', click: runScan },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+Shift+R', click: () => { rebuildData(); if (win) win.reload(); } },
        { type: 'separator' }, { role: 'toggleDevTools' }, { role: 'quit' },
      ] },
    ]));
    notifyForLatest();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(true); });
  });

  // Keep the tray alive on Windows/Linux when all windows close (close-to-tray).
  app.on('window-all-closed', () => { if (process.platform === 'darwin') return; /* stay resident in tray */ });
  app.on('before-quit', () => { app.isQuitting = true; for (const w of [watcher, qbWatcher]) if (w) try { w.close(); } catch {} });
}
