// WorkspaceHQ Electron shell.
// - refreshes data.js from sidecars on launch and after every scan
// - system tray (Show / Scan now / Quit) with a level+health tooltip
// - native notifications for quest completions (driven by changes_since_prev[].notify)
// - IPC: run scan, open a repo folder, mark a quest done (persists via quest-overrides.json)
//
// Tauri alternative: dashboard/ is the distDir; a src-tauri wrapper would call the
// same run-pipeline.ps1 and the same data/quest-overrides.json from a Rust command.

const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, shell, nativeImage, dialog, screen, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const { startBridge } = require('./browser-bridge');
const claudeSessions = require('./claude-sessions');   // MA: the Familiar's leash

// Last-resort safety net: a stray throw/rejection anywhere must never take the
// whole main process (and every window) down. Log and keep the app alive.
process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

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
const DAILY_DIR = path.join(VAULT, '10_Daily');
// Allow-list of regenerable dirs the reclaim action may delete (npm install / rebuild restores them).
const RECLAIMABLE_DIRS = new Set(['node_modules', '.next', '.nuxt', 'dist', 'build', 'out', '.output', 'target', '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache', 'coverage', '.turbo']);
const START_HIDDEN = process.argv.includes('--hidden') || process.argv.includes('--start-minimized');
let win, tray, watcher, miniWin, qbWatcher, dailyWatcher, castWin = null, canvasWatcher = null;
let bridge = null;   // localhost ingest for the WorkspaceHQ Bridge browser extension
const activeDevServers = new Map();

// Push the live browser tab (from the bridge extension) to any open windows so
// the "Working On Now" card updates in real time, without waiting for a scan.
function pushBrowserTab(live) {
  for (const w of [win, miniWin]) {
    if (w && !w.isDestroyed()) { try { w.webContents.send('hq:browser-tab', live); } catch { /* window closing */ } }
  }
}
// The renderer asks for the current live tab on load (the window may open after
// several bridge flushes have already landed).
ipcMain.handle('hq:browser-live', () => (bridge ? bridge.readActivity()?.live || null : null));

// SOCIAL BINDING: the renderer's SOCIAL realm reads the scraped sidecars (feed/
// mentions/metrics/outbox/accounts) on demand. Read-only — the extension writes.
ipcMain.handle('hq:social-read', () => (bridge ? bridge.readSocial() : null));

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

// ---- snapshot safety net + bulk git/confirm helpers (Wave 2b) ----------------
const BACKUPS = path.join(SCAN_DIR, 'backups');
// Filtered working-tree copy via robocopy (built into Windows): keeps .git + source,
// drops the heavy regenerable dirs. Non-disruptive, reversible. Returns dest or null.
function snapshotProject(absPath, name) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const dest = path.join(BACKUPS, `${safeFile(name)}-${stamp}`);
  try { fs.mkdirSync(dest, { recursive: true }); } catch { return null; }
  const xd = [...RECLAIMABLE_DIRS].flatMap((d) => ['/XD', d]);
  const r = spawnSync('robocopy', [absPath, dest, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...xd], { encoding: 'utf8', windowsHide: true });
  // robocopy exit codes 0-7 = success; >=8 = real error
  if ((r.status ?? 16) >= 8) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} return null; }
  return dest;
}
function gitEach(projects, args) {
  let ok = 0;
  for (const p of projects) {
    const cwd = resolveProjectPath(p.path); if (!cwd) continue;
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    if (r.status === 0) ok++;
  }
  return ok;
}
async function confirmThen(message, detail, fn) {
  const { response } = await dialog.showMessageBox(win || undefined, { type: 'warning', buttons: ['Cancel', 'Do it'], defaultId: 0, cancelId: 0, message, detail });
  if (response === 1) await fn();
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

// NEXUS v3 swap flag: data/.ui-version containing exactly "v3" loads the
// parallel dashboard-v3 renderer with THIS preload (per IPC-CONTRACT.md the
// swap needs zero channel changes). Anything else — missing file, "v2",
// read error — stays v2, so rollback is one flip + restart away.
function uiVersion() {
  try { return fs.readFileSync(path.join(DATA, '.ui-version'), 'utf8').trim(); } catch { return 'v2'; }
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1180, height: 820, backgroundColor: '#0d1117', title: 'WorkspaceHQ',
    icon: path.join(DIR, 'icon.png'), show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  win.loadFile(uiVersion() === 'v3'
    ? path.join(DIR, '..', 'dashboard-v3', 'index.html')
    : path.join(DIR, 'index.html'));
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
    spells: topSpells(3),   // one-click cast buttons on the HUD
  };
}
function pushMini() { if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('hq:mini-update', miniPayload()); }

// ---- live machine HUD: CPU% (delta-sampled) + RAM% + orphaned dev-server count -----
let lastCpu = null, machineTimer = null;
function cpuTimes() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const t of Object.values(c.times)) total += t; idle += c.times.idle; } return { idle, total }; }
function machineSample() {
  const cur = cpuTimes();
  let cpu = 0;
  if (lastCpu) { const dt = cur.total - lastCpu.total, di = cur.idle - lastCpu.idle; cpu = dt > 0 ? Math.round((1 - di / dt) * 100) : 0; }
  lastCpu = cur;
  return { cpu: Math.max(0, Math.min(100, cpu)), ram: Math.round((1 - os.freemem() / os.totalmem()) * 100), servers: activeDevServers.size };
}
function pushMachine() { if (miniWin && !miniWin.isDestroyed() && miniWin.isVisible()) miniWin.webContents.send('hq:machine', machineSample()); }
function startMachineSampler() { if (machineTimer) return; lastCpu = cpuTimes(); machineTimer = setInterval(pushMachine, 2500); }

function hudPrefVisible() {
  try { return JSON.parse(fs.readFileSync(HUD_STATE, 'utf8')).miniVisible !== false; } catch { return true; }
}
function saveHudPref(v) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(HUD_STATE, JSON.stringify({ miniVisible: v })); } catch {}
}

function createMiniWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 286, H = 196, margin = 16;   // +32px for the spell-shortcut row
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

// Tray menu rebuilt from the latest scan: static items + dynamic power "quick actions"
// (push all unpushed / snapshot all dirty / kill all dev servers / open most-urgent).
function buildTrayMenu() {
  const s = latest();
  const items = [
    { label: 'Show WorkspaceHQ', click: () => { if (!win) createWindow(); else win.show(); } },
    { label: 'Toggle mini HUD', click: toggleMini },
    { label: 'Quick capture (Ctrl+Alt+Space)', click: openCapture },
    { label: 'Summon widget (Ctrl+Alt+G)', click: openSummon },
    { label: 'Cast a spell… (Ctrl+Alt+X)', click: openCastPalette },
    { label: 'Scan now', click: runScan },
  ];
  const favs = topSpells(3);
  if (favs.length) {
    items.push({
      label: 'Cast',
      submenu: [
        ...favs.map((sp) => ({ label: `${sp.icon || '✴️'} ${sp.name}`, click: () => castFromShell(sp.id) })),
        { type: 'separator' },
        { label: 'Open Spellbook', click: () => { if (!win) createWindow(); else win.show(); } },
      ],
    });
  }
  if (s) {
    const unpushed = s.projects.filter((p) => p.metrics.git_safety.unpushed);
    const dirty = s.projects.filter((p) => p.metrics.git_safety.dirty > 0);
    const quick = [];
    if (unpushed.length) quick.push({ label: `Push all unpushed (${unpushed.length})`, click: () => confirmThen(`Push ${unpushed.length} repo(s)?`, unpushed.map((p) => p.name).join(', '), () => { const ok = gitEach(unpushed, ['push']); if (Notification.isSupported()) new Notification({ title: '⬆ Pushed', body: `${ok}/${unpushed.length} repos`, icon: path.join(DIR, 'icon.png') }).show(); runScan(); }) });
    if (dirty.length) quick.push({ label: `Snapshot all dirty (${dirty.length})`, click: () => confirmThen(`Snapshot ${dirty.length} dirty repo(s)?`, 'Filtered backup copy to backups/ — safe, non-disruptive.', () => { let ok = 0; for (const p of dirty) { const b = resolveProjectPath(p.path); if (b && snapshotProject(b, p.name)) ok++; } if (Notification.isSupported()) new Notification({ title: '📦 Snapshotted', body: `${ok}/${dirty.length} repos → backups/`, icon: path.join(DIR, 'icon.png') }).show(); }) });
    if (activeDevServers.size) quick.push({ label: `Kill all dev servers (${activeDevServers.size})`, click: () => { for (const [, proc] of activeDevServers) { if (proc && proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t']); } activeDevServers.clear(); } });
    const top = (s.account?.daily_top3 || [])[0];
    if (top?.project_id) { const tp = s.projects.find((p) => p.id === top.project_id); if (tp) quick.push({ label: `Open most-urgent: ${tp.name}`, click: () => { const b = resolveProjectPath(tp.path); if (b) shell.openPath(b); } }); }
    if (quick.length) items.push({ type: 'separator' }, { label: 'Quick actions', enabled: false }, ...quick);
  }
  items.push({ type: 'separator' }, { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}
function updateTray() {
  if (!tray) return;
  const s = latest();
  tray.setToolTip(s ? `WorkspaceHQ — L${s.account.level} ${s.account.title} · health ${s.account.health_index} · ${s.account.totals.open_quests} open` : 'WorkspaceHQ');
  tray.setContextMenu(buildTrayMenu());   // refresh dynamic quick-actions on every scan
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(DIR, 'icon.png')));
  tray.setContextMenu(buildTrayMenu());
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

// ---- safe read for a persisted JSON store that gets MODIFIED and written back.
// A read-modify-write on an unparseable file would OVERWRITE (destroy) it with the
// empty default — silently erasing the user's accreted history (quests, notes,
// ideas, learnings). Instead: quarantine the bad file to <file>.corrupt so nothing
// is lost, and hand back a FRESH empty (makeEmpty() — never a shared reference).
// Generalizes the readActedOn() pattern below to every write-back store.
//   ENOENT        -> empty (a first run with no file yet is correct)
//   real IO error -> rethrow (never mask a disk/permission failure by resetting)
//   unparseable / wrong shape -> quarantine + log + empty (recoverable, not gone)
function readJsonStore(file, makeEmpty, ok) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return makeEmpty(); throw e; }
  try {
    const v = JSON.parse(raw);
    if (ok && !ok(v)) throw new Error('unexpected shape');
    return v;
  } catch (e) {
    try { fs.renameSync(file, file + '.corrupt'); } catch { /* best effort — never throw from a read */ }
    console.error(`[store] corrupt ${path.basename(file)} quarantined to ${path.basename(file)}.corrupt — ${e.message}`);
    return makeEmpty();
  }
}
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- quest completion (shared by the in-app DONE button and the Obsidian sync) ----
function readOverrides() {
  return readJsonStore(path.join(DATA, 'quest-overrides.json'), () => ({}), isPlainObj);
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
  // organic feedback: an XP drip sprouts on the desktop even when the app is hidden
  try {
    const xp = list.length * 60;   // rough until the ledger settles on next scan
    const wa = screen.getPrimaryDisplay().workArea;
    spawnShard({ widget: 'xp-drip', payload: { text: `+~${xp} XP · ${list.length} quest${list.length > 1 ? 's' : ''} cleared` }, x: wa.x + wa.width - 270, y: wa.y + wa.height - 100, ttl: 6000, clickThrough: true });
  } catch { /* shards are garnish, never block the core loop */ }
  return true;
}

// Two-way: ticking a `- [x] wq:<quest-id>` line in any daily note completes that quest.
function watchDailyNotes() {
  if (!fs.existsSync(DAILY_DIR)) return;
  try {
    let t = null;
    dailyWatcher = fs.watch(DAILY_DIR, (_evt, file) => {
      if (!file || !file.endsWith('.md')) return;
      clearTimeout(t);
      t = setTimeout(() => {
        let text = '';
        try { text = fs.readFileSync(path.join(DAILY_DIR, file), 'utf8'); } catch { return; }
        const ov = readOverrides();
        const ids = [];
        for (const line of text.split(/\r?\n/)) {
          if (!/^\s*[->]?\s*[-*]?\s*\[[xX]\]/.test(line)) continue;
          const m = line.match(/wq:([A-Za-z0-9_-]+)/);
          if (m && ov[m[1]]?.status !== 'done') ids.push(m[1]);
        }
        if (ids.length) { console.log(`[daily-note] vault→app completion (${file}):`, ids.join(', ')); applyDone(ids); }
      }, 1200);
    });
  } catch (e) { console.error('watchDailyNotes failed:', e); }
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
  ps.on('error', (err) => { if (win && !win.isDestroyed()) win.setTitle('WorkspaceHQ'); try { dialog.showErrorBox('Scan failed to start', String(err.message || err)); } catch {} });
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
// Open one specific file inside a project (re-entry ramp "last file" + clickable recents).
ipcMain.handle('hq:open-file', (_e, projPath, fileRel) => {
  const base = resolveProjectPath(projPath);
  if (!base) return false;
  const target = path.resolve(base, String(fileRel || '').replace(/\//g, path.sep));
  if (target !== base && !target.startsWith(base + path.sep)) return false;   // stay inside the project
  return shell.openPath(target);
});
// Reclaim disk: delete allow-listed regenerable dirs in a project, AFTER an explicit confirm.
ipcMain.handle('hq:reclaim', async (_e, projPath, dirNames) => {
  const base = resolveProjectPath(projPath);
  if (!base) return false;
  const names = (Array.isArray(dirNames) ? dirNames : []).filter((n) => RECLAIMABLE_DIRS.has(n));
  if (!names.length) return false;
  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'warning', buttons: ['Cancel', 'Purge'], defaultId: 0, cancelId: 0,
    message: 'Purge regenerable caches?',
    detail: `Delete ${names.join(', ')} in:\n${base}\n\nReversible — npm install / a rebuild restores them.`,
  });
  if (response !== 1) return false;
  let ok = 0;
  for (const n of names) {
    const target = path.join(base, n);
    if (target !== base && target.startsWith(base + path.sep)) {
      try { fs.rmSync(target, { recursive: true, force: true }); ok++; } catch (e) { console.error('reclaim failed', target, e); }
    }
  }
  if (ok) runScan();   // refresh disk numbers
  return ok;
});
// Snapshot one project (filtered backup copy) after an explicit confirm.
ipcMain.handle('hq:snapshot', async (_e, projPath, name) => {
  const base = resolveProjectPath(projPath);
  if (!base) return false;
  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'question', buttons: ['Cancel', 'Snapshot'], defaultId: 1, cancelId: 0,
    message: `Snapshot ${name || 'project'}?`, detail: 'Filtered copy (keeps .git + source, drops node_modules) → backups/. Safe, non-disruptive.',
  });
  if (response !== 1) return false;
  const dest = snapshotProject(base, name || path.basename(base));
  if (dest && Notification.isSupported()) new Notification({ title: '📦 Snapshot saved', body: dest, icon: path.join(DIR, 'icon.png') }).show();
  return !!dest;
});

// ---- Quick-capture: global hotkey -> frameless box -> data/brain-dump.json (Wave 4) ----
let captureWin = null;
function openCapture() {
  if (captureWin && !captureWin.isDestroyed()) { captureWin.show(); captureWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 480, H = 96;
  captureWin = new BrowserWindow({
    width: W, height: H, x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + wa.height * 0.26),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  captureWin.setAlwaysOnTop(true, 'screen-saver');
  captureWin.loadFile(path.join(DIR, 'capture.html'));
  captureWin.on('blur', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.close(); });
  captureWin.on('closed', () => { captureWin = null; });
}
ipcMain.handle('hq:capture-save', (_e, text) => {
  const t = String(text || '').trim();
  if (captureWin && !captureWin.isDestroyed()) captureWin.close();
  if (!t) return false;
  const f = path.join(DATA, 'brain-dump.json');
  const arr = readJsonStore(f, () => [], Array.isArray);
  arr.push({ id: `${Date.now().toString(36)}`, ts: new Date().toISOString(), text: t });
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, JSON.stringify(arr, null, 2));
  if (Notification.isSupported()) new Notification({ title: '🧠 Captured', body: t.slice(0, 90), icon: path.join(DIR, 'icon.png') }).show();
  // re-assemble the current scan (fast — no collector) so the dump shows as a side-quest
  const s = latest();
  if (s) { spawnSync(process.execPath, [path.join(COLLECTOR, 'assemble.mjs'), '--date', s.scan.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }); rebuildData(); if (win && !win.isDestroyed()) win.reload(); pushMini(); }
  return true;
});
ipcMain.handle('hq:capture-cancel', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.close(); return true; });

// ============================================================================
// ORGANIC UI — shards. WorkspaceHQ grows interface anywhere on the desktop.
// A shard is a small frameless always-on-top window materialized at any screen
// position, floating over every app (incl. fullscreen). Built-in widgets
// (note / timer / quest / hp / xp-drip) render instantly; any other summon text
// is CONJURED: Claude generates a self-contained HTML widget on the fly.
// Notes + conjured widgets persist across restarts via data/shards.json.
// ============================================================================
const SHARDS_FILE = path.join(DATA, 'shards.json');
const shards = new Map();   // id -> { win, cfg }
let summonWin = null, summonAt = null;

function readShardsFile() { return readJsonStore(SHARDS_FILE, () => [], Array.isArray); }
function persistShards() {
  const keep = [...shards.values()].map(({ cfg, win }) => {
    if (!cfg.persist || !win || win.isDestroyed()) return null;
    const [x, y] = win.getPosition(); const [w, h] = win.getSize();
    return { id: cfg.id, widget: cfg.widget, payload: cfg.payload, persist: true, x, y, w, h };
  }).filter(Boolean);
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(SHARDS_FILE, JSON.stringify(keep, null, 2)); } catch {}
}

const SHARD_SIZES = { note: [260, 200], timer: [220, 130], quest: [340, 158], hp: [260, 104], 'xp-drip': [250, 80], custom: [360, 300] };

function spawnShard(cfg) {
  const id = cfg.id || ('sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  const [dw, dh] = SHARD_SIZES[cfg.widget] || [320, 220];
  const w = cfg.w || dw, h = cfg.h || dh;
  let x = cfg.x, y = cfg.y;
  if (x == null || y == null) {
    const pt = screen.getCursorScreenPoint();
    x = pt.x - Math.round(w / 2); y = pt.y + 12;
  }
  // clamp to the work area of whichever display the shard lands on
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  const sw = new BrowserWindow({
    width: w, height: h, x, y,
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    fullscreenable: false, maximizable: false, minimizable: false,
    backgroundColor: '#00000000', title: 'HQ Shard',
    // REDUCED preload (MA): conjured HTML never sees the full hq bridge
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(DIR, 'organic', 'shard-preload.js') },
  });
  sw.setAlwaysOnTop(true, 'screen-saver');                       // float over fullscreen apps
  sw.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // conjured HTML stays LOCAL: no navigation, no popups, ever
  sw.webContents.on('will-navigate', (e) => e.preventDefault());
  sw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sw.loadFile(path.join(DIR, 'organic', 'shard.html'));
  const full = { ...cfg, id, w, h };
  sw.webContents.once('did-finish-load', () => { if (!sw.isDestroyed()) sw.webContents.send('shard:init', full); });
  if (cfg.clickThrough) sw.setIgnoreMouseEvents(true);
  sw.on('moved', () => { if (full.persist) persistShards(); });
  sw.on('closed', () => { shards.delete(id); persistShards(); });
  shards.set(id, { win: sw, cfg: full });
  if (cfg.persist) persistShards();
  if (cfg.ttl) setTimeout(() => { if (!sw.isDestroyed()) sw.close(); }, cfg.ttl);
  console.log(`[shard] spawned ${cfg.widget} ${id} @ ${x},${y}`);
  return id;
}

function updateShard(id, payloadPatch) {
  const s = shards.get(id); if (!s || s.win.isDestroyed()) return;
  s.cfg.payload = { ...s.cfg.payload, ...payloadPatch };
  s.win.webContents.send('shard:init', s.cfg);
  if (s.cfg.persist) persistShards();
}

function topQuestPayload() {
  const s = latest(); if (!s) return null;
  const rank = { red: 0, orange: 1, yellow: 2 };
  const top = (s.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .sort((x, y) => (rank[x.tier] - rank[y.tier]) || (y.xp - x.xp) || (y.age_days - x.age_days))[0];
  if (!top) return null;
  const proj = (s.projects || []).find((p) => p.id === top.project_id);
  return { id: top.id, title: top.title, tier: top.tier, xp: top.xp, project: proj ? proj.name : '' };
}

// ---- widget library (Organic UI v2 · P1): conjures become durable creations ----
// Every successful generation is saved keyed by normalized prompt; summoning a
// matching prompt re-spawns instantly from cache instead of re-generating.
const LIB_FILE = path.join(DATA, 'shard-library.json');
const normPrompt = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function readLibrary() { return readJsonStore(LIB_FILE, () => [], Array.isArray); }
function saveLibrary(items) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(LIB_FILE, JSON.stringify(items, null, 2)); } catch {} }
function libUpsert(prompt, html) {
  const items = readLibrary();
  const key = normPrompt(prompt);
  const now = new Date().toISOString();
  const i = items.findIndex((x) => x.key === key);
  if (i >= 0) items[i] = { ...items[i], html, updated_at: now };
  else items.push({ key, prompt, html, created_at: now, updated_at: now });
  saveLibrary(items);
}
function libFind(text) {
  const q = normPrompt(text);
  if (!q) return null;
  const items = readLibrary();
  const exact = items.find((x) => x.key === q);
  if (exact) return exact;
  const prefix = items.filter((x) => x.key.startsWith(q));
  return prefix.length === 1 ? prefix[0] : null;   // only unambiguous prefixes
}
function libraryPayload() {
  return { items: readLibrary().map(({ key, prompt, updated_at }) => ({ key, prompt, updated_at })) };
}

// Conjuring: Claude writes a bespoke self-contained widget for whatever was asked.
// A placeholder shard appears instantly (organic feedback), then morphs when ready.
// generateInto is shared by fresh conjures AND the ↻ regen button on existing shards.
function conjureShard(prompt, at) {
  const id = spawnShard({ widget: 'custom', payload: { status: 'conjuring', prompt }, persist: true, ...at });
  generateInto(id, prompt);
  return id;
}
function generateInto(id, prompt) {
  const gen = `Generate a tiny self-contained desktop widget for: "${prompt.replace(/"/g, "'")}"

HARD RULES:
- Reply with ONLY an HTML fragment (no \`\`\` fences, no <html>/<head>/<body>).
- Everything inline: <style scoped to your own class names> + optional inline <script>.
- NO external resources of any kind (no URLs, no fonts, no images, no fetch/XHR/WebSocket).
- Dark translucent card look: background rgba(12,10,30,.92); 1px border #322a5e; border-radius 10px; neon accents (#00f0ff cyan, #ff2bd6 magenta, #ffd23f gold); monospace font.
- Max footprint ~340x260px. It must be immediately useful and interactive if the request implies it (buttons, counters, inputs all work via inline JS).
- If the request implies live time, use setInterval. State can live in JS variables only.`;
  // MA: routed through the sessions registry — tracked, killable, presence-visible
  const r = claudeSessions.start({
    label: `conjure: ${prompt.slice(0, 32)}`, input: gen, timeoutMs: 120000,
    onDone: ({ status, output }) => {
      const html = output.trim().replace(/^```(html)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (status !== 'done' || !html || !/</.test(html)) { updateShard(id, { status: 'error', error: 'generation returned nothing usable' }); return; }
      updateShard(id, { status: 'ready', html });
      libUpsert(prompt, html);   // durable: joins the widget library for instant re-summon
      console.log(`[shard] conjured "${prompt.slice(0, 40)}" (${html.length}b) -> library`);
    },
  });
  if (r.error) updateShard(id, { status: 'error', error: r.error });
}

// Summon router: known words materialize built-ins; everything else is conjured.
function summonWidget(text, at = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  let m;
  if ((m = t.match(/^n(?:ote)?[:\s]+(.+)/i))) return spawnShard({ widget: 'note', payload: { text: m[1] }, persist: true, ...at });
  if ((m = t.match(/^timer\s+(\d+)\s*m?(?:in)?s?$/i)) || (m = t.match(/^(\d+)\s*m(?:in)?s?$/i)))
    return spawnShard({ widget: 'timer', payload: { minutes: Math.max(1, Math.min(180, +m[1])) }, ...at });
  if (/^quests?$/i.test(t)) { const q = topQuestPayload(); return q ? spawnShard({ widget: 'quest', payload: q, ...at }) : false; }
  if (/^(hp|stats?|hud)$/i.test(t)) { const p = miniPayload(); return p ? spawnShard({ widget: 'hp', payload: p, ...at }) : false; }
  if (/^lib(rary)?$/i.test(t)) return spawnShard({ widget: 'library', payload: libraryPayload(), w: 380, h: 300, ...at });
  // library hit: a past creation matching this prompt re-materializes instantly
  const hit = libFind(t);
  if (hit) return spawnShard({ widget: 'custom', payload: { status: 'ready', prompt: hit.prompt, html: hit.html }, persist: true, ...at });
  return conjureShard(t, at);
}

// Summon palette: Ctrl+Alt+G anywhere in Windows -> tiny prompt at the cursor.
function openSummon() {
  if (summonWin && !summonWin.isDestroyed()) { summonWin.focus(); return; }
  const pt = screen.getCursorScreenPoint();
  summonAt = { x: pt.x - 30, y: pt.y + 10 };   // shards materialize where summoned
  const W = 470, H = 104;
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  summonWin = new BrowserWindow({
    width: W, height: H,
    x: Math.max(wa.x, Math.min(pt.x - Math.round(W / 2), wa.x + wa.width - W)),
    y: Math.max(wa.y, Math.min(pt.y + 16, wa.y + wa.height - H)),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(DIR, 'organic', 'summon-preload.js') },
  });
  summonWin.setAlwaysOnTop(true, 'screen-saver');
  summonWin.loadFile(path.join(DIR, 'organic', 'summon.html'));
  summonWin.on('blur', () => { if (summonWin && !summonWin.isDestroyed()) summonWin.close(); });
  summonWin.on('closed', () => { summonWin = null; });
}

ipcMain.handle('hq:shard-summon', (_e, text) => {
  const at = summonAt || {};
  if (summonWin && !summonWin.isDestroyed()) summonWin.close();
  return summonWidget(text, at);
});
ipcMain.handle('hq:shard-summon-cancel', () => { if (summonWin && !summonWin.isDestroyed()) summonWin.close(); return true; });
// shard self-service: resolve the calling shard by its webContents
function shardOfSender(e) { return [...shards.values()].find((v) => !v.win.isDestroyed() && v.win.webContents === e.sender); }
ipcMain.handle('hq:shard-close', (e) => { const s = shardOfSender(e); if (s) s.win.close(); return true; });
ipcMain.handle('hq:shard-save', (e, patch) => {
  const s = shardOfSender(e); if (!s) return false;
  s.cfg.payload = { ...s.cfg.payload, ...patch };
  if (s.cfg.persist) persistShards();
  return true;
});
// widget library: spawn / delete from the library browser shard
ipcMain.handle('hq:shard-lib-spawn', (e, key) => {
  const item = readLibrary().find((x) => x.key === key); if (!item) return false;
  const s = shardOfSender(e);
  const at = {};
  if (s && !s.win.isDestroyed()) { const [x, y] = s.win.getPosition(); at.x = x + 40; at.y = y + 40; }
  return spawnShard({ widget: 'custom', payload: { status: 'ready', prompt: item.prompt, html: item.html }, persist: true, ...at });
});
ipcMain.handle('hq:shard-lib-delete', (e, key) => {
  saveLibrary(readLibrary().filter((x) => x.key !== key));
  const s = shardOfSender(e);
  if (s && s.cfg.widget === 'library') updateShard(s.cfg.id, libraryPayload());
  return true;
});
// ↻ regen: a conjured shard rewrites itself in place (fresh generation, same spot)
ipcMain.handle('hq:shard-regen', (e) => {
  const s = shardOfSender(e); if (!s || s.cfg.widget !== 'custom' || !s.cfg.payload?.prompt) return false;
  updateShard(s.cfg.id, { status: 'conjuring', html: null });
  generateInto(s.cfg.id, s.cfg.payload.prompt);
  return true;
});

function respawnShards() {
  for (const cfg of readShardsFile()) {
    if (!cfg || !cfg.widget) continue;
    // conjured shards revive in their ready state; skip ones that never finished
    if (cfg.widget === 'custom' && cfg.payload?.status !== 'ready') continue;
    try { spawnShard(cfg); } catch (err) { console.error('[shard] respawn failed:', err); }
  }
}

// ---- Scoped Claude launcher: open an interactive Claude session cd'd to a project ----
ipcMain.handle('hq:claude-quest', (_e, projPath, prompt) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return false;
  const p = String(prompt || '').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').slice(0, 500);
  // new terminal window, cd into the project, launch claude with the quest as the seed prompt
  spawnSync('cmd.exe', ['/c', 'start', '', 'cmd', '/k', `cd /d "${cwd}" && claude "${p}"`], { windowsHide: false });
  return true;
});

// ---- Commit drafter (Wave 4): claude -p over git diff -> conventional commit ----
// MA: async via the sessions registry — the main process no longer freezes for
// up to 90s while Claude writes. invoke() already promises to the renderer,
// so the {message}|{error} contract is unchanged.
ipcMain.handle('hq:draft-commit', async (_e, projPath) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return { error: 'bad path' };
  // unstaged + staged diff; cap to avoid blowing token budget
  const diff = (spawnSync('git', ['-C', cwd, 'diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).stdout || '').slice(0, 30000);
  if (!diff.trim()) return { error: 'no diff to summarize' };
  const prompt = `Write a single conventional-commit message for this diff. Format: "type(scope): summary" then blank line then 1-3 bullet points if useful. Reply with ONLY the message text, no fences.\n\n${diff}`;
  const r = await claudeSessions.run({ label: 'draft-commit', input: prompt, timeoutMs: 90000 });
  if (r.error) return { error: r.error };
  if (r.status !== 'done') return { error: r.output.slice(-300).trim() || 'claude failed' };
  return { message: r.output.trim() };
});
// MA: async twin of the sync node runners — for post-action rescans that
// must not freeze the main process
function runNodeAsync(script, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(path.basename(script) + ' exit ' + code))));
    p.on('error', reject);
  });
}
ipcMain.handle('hq:do-commit', (_e, projPath, message) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return false;
  const a = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8' });
  if (a.status !== 0) return { error: 'add failed' };
  const c = spawnSync('git', ['-C', cwd, 'commit', '-m', String(message || 'wip')], { encoding: 'utf8' });
  if (c.status !== 0) return { error: (c.stderr || c.stdout || '').slice(0, 300) };
  // MA: the post-commit rescan runs async — the commit returns immediately
  // instead of freezing main for a full collector pass; the window reloads
  // by itself once fresh data is bundled.
  const s = latest();
  if (s) {
    runNodeAsync(path.join(COLLECTOR, 'collector.mjs'))
      .then(() => runNodeAsync(path.join(COLLECTOR, 'assemble.mjs'), ['--date', s.scan.id]))
      .then(() => { rebuildData(); if (win && !win.isDestroyed()) win.reload(); pushMini(); })
      .catch((err) => console.error('[do-commit] rescan failed:', err.message));
  }
  return { ok: true };
});

// ---- Decision log (Wave 5): append [!decision] callout to project vault note ----
function ensureVaultNote(name, id, prod) {
  fs.mkdirSync(PROJECT_NOTES_DIR, { recursive: true });
  const file = path.join(PROJECT_NOTES_DIR, safeFile(name) + '.md');
  if (!fs.existsSync(file)) {
    const meta = prod ? `> [!info] ${prod.completion?.pct ?? '?'}% complete · ${(prod.stack || []).slice(0, 4).join(' · ')} · \`${prod.path || ''}\`` : '';
    fs.writeFileSync(file, ['---', `title: ${name}`, 'type: project', 'tags: [workspace, project]', `workspacehq_id: ${id}`, 'generated_by: workspacehq', '---', '', `# ${name}`, '', meta, '', NOTE_HEAD, ''].join('\n'));
  }
  return file;
}
ipcMain.handle('hq:log-decision', (_e, projId, text) => {
  const s = latest(); if (!s) return false;
  const prod = (s.projects || []).find((p) => p.id === projId);
  if (!prod) return false;
  const file = ensureVaultNote(prod.name, projId, prod);
  const stamp = new Date().toISOString().slice(0, 10);
  const block = `\n> [!decision] ${stamp}\n> ${String(text).replace(/\n/g, '\n> ')}\n`;
  fs.appendFileSync(file, block);
  return true;
});

// ---- Knowledge XP (Wave 5): "I learned X" capture -> learnings.json + vault append ----
const LEARNINGS = path.join(DATA, 'learnings.json');
ipcMain.handle('hq:learn', (_e, projId, text) => {
  const t = String(text || '').trim(); if (!t) return false;
  const arr = readJsonStore(LEARNINGS, () => [], Array.isArray);
  arr.push({ id: Date.now().toString(36), ts: new Date().toISOString(), project_id: projId || null, text: t });
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(LEARNINGS, JSON.stringify(arr, null, 2));
  // mirror to vault: a "What I Learned.md" log in 30_Areas
  try {
    const wif = path.join(VAULT, '30_Areas', 'What I Learned.md');
    if (!fs.existsSync(wif)) fs.writeFileSync(wif, '---\ntitle: What I Learned\ntags: [learning, log]\ngenerated_by: workspacehq\n---\n\n# 📚 What I Learned\n\n');
    const s = latest();
    const projName = projId && s ? (s.projects || []).find((p) => p.id === projId)?.name : '';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    fs.appendFileSync(wif, `- ${stamp}${projName ? ` · [[${projName}]]` : ''} — ${t}\n`);
  } catch {}
  // re-assemble so knowledge XP updates
  const s = latest();
  if (s) spawnSync(process.execPath, [path.join(COLLECTOR, 'assemble.mjs'), '--date', s.scan.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  rebuildData(); if (win && !win.isDestroyed()) win.reload();
  return true;
});

// ---- Graveyard verbs (Wave 5): Archive / Revive a project via overrides ----
ipcMain.handle('hq:archive-project', (_e, projId) => {
  const f = path.join(DATA, 'project-overrides.json');
  const o = readJsonStore(f, () => ({}), isPlainObj);
  o[projId] = { status: 'archived', archived: new Date().toISOString().slice(0, 10) };
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2));
  const s = latest();
  if (s) spawnSync(process.execPath, [path.join(COLLECTOR, 'assemble.mjs'), '--date', s.scan.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  rebuildData(); if (win && !win.isDestroyed()) win.reload(); pushMini();
  return true;
});
ipcMain.handle('hq:revive-project', (_e, projId) => {
  const f = path.join(DATA, 'project-overrides.json');
  const o = readJsonStore(f, () => ({}), isPlainObj);
  delete o[projId];
  fs.writeFileSync(f, JSON.stringify(o, null, 2));
  const s = latest();
  if (s) spawnSync(process.execPath, [path.join(COLLECTOR, 'assemble.mjs'), '--date', s.scan.id], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  rebuildData(); if (win && !win.isDestroyed()) win.reload();
  return true;
});

// ---- Orphan triage (Wave 5): register / delete discovered folders ----
ipcMain.handle('hq:orphan-archive', (_e, dirPath) => {
  const src = resolveProjectPath(dirPath); if (!src) return false;
  const archiveRoot = path.join(DOCS_ROOT, '_archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  const dest = path.join(archiveRoot, path.basename(src));
  try { fs.renameSync(src, dest); } catch (e) { return { error: String(e.message) }; }
  return { ok: true, dest };
});
// Works for both core quest ids (q-…) and side-quest ids (sq-…) — both live in the
// same quest-overrides.json store that assemble.mjs reads.
ipcMain.handle('hq:quest-done', (_e, id) => { if (!id) return false; applyDone(id); return true; });

// ==== Casting engine (Spellbook) =============================================
// Executes ONLY spells present in data/spellbook.json (the scanner's catalog is
// the whitelist — the renderer can never pass a command, only a spell id).
// shell:false everywhere; args stay arrays end-to-end. First cast of a spell
// (and any cast after its content_hash changes) requires the dry-run confirm
// in the renderer; always-confirm spells re-prompt every time.
const SPELLBOOK_FILE = path.join(DATA, 'spellbook.json');
const TELEMETRY_FILE = path.join(DATA, 'spell-telemetry.json');
const ACTED_ON_FILE = path.join(DATA, 'acted-on.json');
function readActedOn() {
  let raw;
  try { raw = fs.readFileSync(ACTED_ON_FILE, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { entries: [] };  // no ledger yet — fresh start is correct
    throw e;                                            // real I/O error: don't mask it by resetting
  }
  try {
    const led = JSON.parse(raw);
    if (led && Array.isArray(led.entries)) return led;
    throw new Error('ledger missing entries[]');
  } catch (e) {
    // File exists but is unparseable/malformed. Quarantine it instead of
    // overwriting — silently resetting would destroy the entire history.
    try { fs.renameSync(ACTED_ON_FILE, ACTED_ON_FILE + '.corrupt'); } catch { /* best effort */ }
    console.error(`[acted-on] corrupt ledger quarantined to ${ACTED_ON_FILE}.corrupt: ${e.message}`);
    return { entries: [] };
  }
}
// Normalize into a known shape — never persist arbitrary renderer-supplied
// keys. `resolved` = user asserted done; `marked_done` = a durable side-effect
// (quest-overrides.json) actually fired. quest-overrides.json stays the source
// of truth for quest STATE; this ledger is an append-only EVENT log.
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.kind !== 'string' || typeof entry.action_id !== 'string') return null;
  return {
    at: typeof entry.at === 'string' ? entry.at : new Date().toISOString(),
    kind: entry.kind,
    action_id: entry.action_id,
    project_id: typeof entry.project_id === 'string' ? entry.project_id : null,
    seconds: Number.isFinite(entry.seconds) ? Math.max(0, Math.round(entry.seconds)) : 0,
    resolved: !!entry.resolved,
    marked_done: !!entry.marked_done,
    via: typeof entry.via === 'string' ? entry.via : 'unknown',
  };
}
ipcMain.handle('hq:acted-on', (_e, entry) => {
  const clean = cleanEntry(entry);
  if (!clean) return false;
  const led = readActedOn();
  led.entries.push(clean);
  if (led.entries.length > 500) led.entries = led.entries.slice(-500); // rolling window
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = ACTED_ON_FILE + '.tmp';                                   // atomic write
  fs.writeFileSync(tmp, JSON.stringify(led, null, 1));
  fs.renameSync(tmp, ACTED_ON_FILE);
  return true;
});
// Live read — the renderer bakes a build-time snapshot into window.DATA.actedOn,
// but that goes stale the moment a session is logged; this serves the current file.
ipcMain.handle('hq:acted-on-read', () => readActedOn());
const castRegistry = new Map();   // spellId -> { proc, castId, startedAt, timer }

function readSpellbook() {
  try { return JSON.parse(fs.readFileSync(SPELLBOOK_FILE, 'utf8')); } catch { return null; }
}
function readTelemetry() {
  try { return JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8')); }
  catch { return { version: 1, confirmed_hashes: {}, favorites: [], casts: [], rollup: {} }; }
}
function writeTelemetry(t) {   // atomic: survive a crash mid-cast
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = TELEMETRY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(t, null, 1));
  fs.renameSync(tmp, TELEMETRY_FILE);
}
function recordCast(entry) {
  const t = readTelemetry();
  t.casts.push(entry);
  if (t.casts.length > 500) t.casts = t.casts.slice(-500);   // rolling window; rollup keeps totals
  // The economy rewards SUCCESS, not attempts: only non-fizzled casts (resolved or
  // channeled) feed the rollup that drives mastery distinct-days + lifetime_casts.
  // Fizzles stay in casts[] so the casting log still shows failures — they just never
  // earn XP or mastery. You master a spell by landing it, not by failing it.
  if (entry.outcome !== 'fizzled') {
    const r = t.rollup[entry.spell_id] ?? (t.rollup[entry.spell_id] = { lifetime_casts: 0, distinct_days: [], last_cast: null, avg_duration_ms: null });
    r.lifetime_casts++;
    const day = entry.started_at.slice(0, 10);
    if (!r.distinct_days.includes(day)) r.distinct_days.push(day);
    r.last_cast = entry.started_at;
    if (entry.duration_ms != null) r.avg_duration_ms = r.avg_duration_ms == null ? entry.duration_ms : Math.round(r.avg_duration_ms * 0.7 + entry.duration_ms * 0.3);
  }
  writeTelemetry(t);
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function castSend(channel, payload) {
  for (const w of [win, miniWin, castWin]) {
    if (w && !w.isDestroyed()) try { w.webContents.send(channel, payload); } catch {}
  }
}
// MA: session presence — every registry change pushes to the windows, and the
// list is pollable (IPC-CONTRACT: hq:claude-sessions push / hq:sessions-list)
claudeSessions.setOnChange((sessions) => castSend('hq:claude-sessions', sessions));
ipcMain.handle('hq:sessions-list', () => claudeSessions.list());

// ---- THE CANVAS (M3): data/canvas/*.canvas — JSON Canvas, Obsidian-compatible,
// fs-watched so both the Warden and the Familiar (via the MCP server writing
// the same files) draw on a live shared board.
const CANVAS_DIR = path.join(DATA, 'canvas');
const CANVAS_NAME_RE = /^[\w][\w -]{0,63}$/;   // confinement: no dots, no separators
function canvasList() {
  try {
    return fs.readdirSync(CANVAS_DIR).filter((f) => f.endsWith('.canvas')).map((f) => {
      try { return { name: f.replace(/\.canvas$/, ''), ...JSON.parse(fs.readFileSync(path.join(CANVAS_DIR, f), 'utf8')) }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
ipcMain.handle('hq:canvas-read', () => canvasList());
ipcMain.handle('hq:canvas-add', (_e, name, node) => {
  if (!CANVAS_NAME_RE.test(String(name || ''))) return false;
  if (!node || node.type !== 'text' || typeof node.text !== 'string') return false;
  const file = path.join(CANVAS_DIR, name + '.canvas');
  let board = { nodes: [], edges: [] };
  try { const b = JSON.parse(fs.readFileSync(file, 'utf8')); if (b && Array.isArray(b.nodes)) board = { edges: [], ...b }; } catch { /* new board */ }
  board.nodes.push({
    id: 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: 'text', text: node.text.slice(0, 2000),
    x: Number.isFinite(node.x) ? Math.round(node.x) : 40,
    y: Number.isFinite(node.y) ? Math.round(node.y) : 40,
    width: 280, height: 120,
  });
  fs.mkdirSync(CANVAS_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 1));
  fs.renameSync(tmp, file);   // the watcher pushes; no manual castSend needed
  return true;
});
{
  let t = null;
  try {
    fs.mkdirSync(CANVAS_DIR, { recursive: true });
    canvasWatcher = fs.watch(CANVAS_DIR, (_evt, file) => {
      if (!file || !file.endsWith('.canvas')) return;
      clearTimeout(t);
      t = setTimeout(() => castSend('hq:canvas', canvasList()), 300);
    });
  } catch { /* canvas dir unwatchable — reads still work */ }
}

// ---- MED-BAY (M2): live PC-health scan + safe fix runner -----------------
const PC_HEALTH_FILE = path.join(DATA, 'pc-health.json');
function readPcHealth() { try { return JSON.parse(fs.readFileSync(PC_HEALTH_FILE, 'utf8')); } catch { return null; } }
// RE-EXAMINE: re-run the unelevated probe, rebuild the bundle, return fresh vitals.
ipcMain.handle('hq:health-scan', async () => {
  try { await runNodeAsync(path.join(COLLECTOR, 'pc-health.mjs')); }
  catch (e) { return { error: String(e.message || e) }; }
  rebuildData();
  return readPcHealth();
});
// RUN a fix — ONLY commands that appear verbatim as a danger:'safe' fix in the
// CURRENT pc-health.json. The renderer cannot smuggle an arbitrary command
// through: unknown/altered strings and every 'caution'/'admin' fix are refused.
ipcMain.handle('hq:health-fix', (_e, command) => {
  const ph = readPcHealth();
  const safe = new Set();
  for (const o of ph?.organs || []) for (const f of o.fixes || []) if (f && f.danger === 'safe') safe.add(f.command);
  if (!safe.has(String(command))) return { ok: false, output: 'refused: not a whitelisted read-only fix' };
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', String(command)],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return { ok: r.status === 0, output: ((r.stdout || '') + (r.stderr || '')).slice(0, 6000) };
});

// Channeled spells (Claude skills, dev-ish scripts) open a real terminal:
// Windows Terminal when present, classic cmd window otherwise.
function openChanneled(spell) {
  const cwd = spell.cwd || SCAN_DIR;
  const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a);
  const cmdline = [spell.command, ...(spell.args || [])].map(quote).join(' ');
  const wt = spawnSync('where', ['wt'], { encoding: 'utf8', windowsHide: true }).status === 0;
  const child = wt
    ? spawn('wt', ['-w', '0', 'nt', '-d', cwd, 'cmd', '/k', cmdline], { detached: true, stdio: 'ignore', windowsHide: false })
    : spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', `cd /d "${cwd}" && ${cmdline}`], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (e) => console.error('[channeled] spawn failed', e));
  child.unref();
  recordCast({ cast_id: 'c-' + Date.now().toString(36), spell_id: spell.id, started_at: new Date().toISOString(), duration_ms: null, outcome: 'channeled', exit_code: null, chain_id: null });
}

function doCast(spell, { notifyOutcome = false, chainId = null, onDone = null } = {}) {
  if (castRegistry.has(spell.id)) return { error: 'already casting' };
  const castId = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let proc;
  try {
    proc = spawn(spell.command, spell.args || [], { cwd: spell.cwd || SCAN_DIR, shell: false, windowsHide: true });
  } catch (e) {
    return { error: 'spawn failed: ' + (e.message || e) };
  }
  const entry = { proc, castId, startedAt, timer: null };
  castRegistry.set(spell.id, entry);
  castSend('hq:cast-output', { castId, spellId: spell.id, name: spell.name, icon: spell.icon, stream: 'sys', chunk: `✨ casting ${spell.name}…`, chainId });

  const pipe = (streamName) => (buf) => {
    const chunk = String(buf).replace(ANSI_RE, '').slice(0, 8192);
    if (chunk) castSend('hq:cast-output', { castId, spellId: spell.id, stream: streamName, chunk, chainId });
  };
  proc.stdout?.on('data', pipe('out'));
  proc.stderr?.on('data', pipe('err'));

  const finish = (code, timedOut) => {
    if (entry.timer) clearTimeout(entry.timer);
    if (!castRegistry.has(spell.id)) return;   // already finished/cancelled
    castRegistry.delete(spell.id);
    const outcome = timedOut ? 'fizzled' : code === 0 ? 'resolved' : 'fizzled';
    const duration = Date.now() - t0;
    recordCast({ cast_id: castId, spell_id: spell.id, started_at: startedAt, duration_ms: duration, outcome, exit_code: timedOut ? null : code, chain_id: chainId });
    castSend('hq:cast-done', { castId, spellId: spell.id, name: spell.name, icon: spell.icon, outcome, exit_code: code, duration_ms: duration, timed_out: !!timedOut, chainId });
    if (onDone) try { onDone(outcome); } catch { /* chain settles itself */ }
    if (notifyOutcome && Notification.isSupported()) {
      const secs = Math.round(duration / 1000);
      new Notification({
        title: outcome === 'resolved' ? `✨ ${spell.name} resolved · ${secs}s` : `💥 ${spell.name} fizzled${timedOut ? ' (timeout)' : ` (exit ${code})`}`,
        body: outcome === 'resolved' ? 'The spell took hold.' : 'Open WorkspaceHQ → Spellbook for the casting log.',
        icon: path.join(DIR, 'icon.png'),
      }).show();
    }
  };
  proc.on('close', (code) => finish(code, false));
  proc.on('error', (err) => {
    castSend('hq:cast-output', { castId, spellId: spell.id, stream: 'err', chunk: String(err.message || err), chainId });
    finish(-1, false);
  });
  const mins = Math.max(1, Number(spell.timeout_min) || 10);
  entry.timer = setTimeout(() => {
    if (proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
    finish(null, true);
  }, mins * 60000);
  return { castId };
}

// MA: chains/Ultimates — members cast sequentially through doCast, halting on
// the first fizzle. The chain holds a synthetic castRegistry entry (key = the
// chain spell's id, proc:null) so 'already casting' and cancel both work;
// cancelling kills the active member, whose fizzle settles the chain.
function doChain(book, spell, { notifyOutcome = false } = {}) {
  if (castRegistry.has(spell.id)) return { error: 'already casting' };
  const members = (spell.chain || []).map((id) => book.spells.find((s) => s.id === id));
  if (!members.length || members.some((m) => !m || m.invalid || m.kind === 'tome' || m.kind === 'channeled' || m.kind === 'chain'))
    return { error: 'chain has unresolvable members' };
  const chainId = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const entry = { proc: null, castId: chainId, startedAt, timer: null, chain: true, halted: false, activeMember: null };
  castRegistry.set(spell.id, entry);
  castSend('hq:cast-output', { castId: chainId, spellId: spell.id, name: spell.name, icon: spell.icon, stream: 'sys', chunk: `⛓️ ${spell.name} — ${members.length} links`, chainId });

  let i = 0;
  const settle = (outcome) => {
    if (!castRegistry.has(spell.id)) return;
    castRegistry.delete(spell.id);
    const duration = Date.now() - t0;
    recordCast({ cast_id: chainId, spell_id: spell.id, started_at: startedAt, duration_ms: duration, outcome, exit_code: null, chain_id: chainId });
    castSend('hq:cast-done', { castId: chainId, spellId: spell.id, name: spell.name, icon: spell.icon, outcome, exit_code: null, duration_ms: duration, timed_out: false, chainId });
    if (notifyOutcome && Notification.isSupported()) {
      new Notification({
        title: outcome === 'resolved' ? `⛓️ ${spell.name} resolved · ${members.length} links` : `💥 ${spell.name} broke at link ${i + 1}/${members.length}`,
        body: outcome === 'resolved' ? 'Every link held.' : 'Open WorkspaceHQ → Spellbook for the casting log.',
        icon: path.join(DIR, 'icon.png'),
      }).show();
    }
  };
  const next = () => {
    if (entry.halted) return settle('fizzled');
    if (i >= members.length) return settle('resolved');
    const m = members[i];
    entry.activeMember = m.id;
    const r = doCast(m, { chainId, onDone: (outcome) => { if (outcome === 'resolved' && !entry.halted) { i++; next(); } else settle('fizzled'); } });
    if (r.error) {
      castSend('hq:cast-output', { castId: chainId, spellId: spell.id, stream: 'err', chunk: `link ${m.id}: ${r.error}`, chainId });
      settle('fizzled');
    }
  };
  next();
  return { castId: chainId, chain: true };
}

// confirmedHash: the content_hash the user saw in the dry-run modal this round.
// Required on first cast, after any hash change, and every time for confirm:true spells.
ipcMain.handle('hq:spell-cast', (_e, spellId, confirmedHash, opts) => {
  const book = readSpellbook();
  if (!book) return { error: 'no spellbook — run the scanner first' };
  const spell = book.spells.find((s) => s.id === String(spellId));
  if (!spell) return { error: 'unknown spell' };
  if (spell.invalid) return { error: 'spell is invalid (broken chain refs?)' };
  if (spell.kind === 'tome') return { error: 'tomes are lore, not incantations' };

  const t = readTelemetry();
  const known = t.confirmed_hashes[spell.id] === spell.content_hash;
  if ((spell.confirm || !known) && confirmedHash !== spell.content_hash) {
    return {
      confirm_required: true,
      preview: {
        id: spell.id, name: spell.name, icon: spell.icon, content_hash: spell.content_hash,
        command: spell.command, args: spell.args, cwd: spell.cwd, kind: spell.kind,
        always_confirm: !!spell.confirm, changed: !known && !!t.confirmed_hashes[spell.id],
      },
    };
  }
  if (!known && !spell.confirm) { t.confirmed_hashes[spell.id] = spell.content_hash; writeTelemetry(t); }

  if (spell.kind === 'channeled') { openChanneled(spell); return { channeled: true }; }
  const notifyOutcome = !!opts?.notify || !win || !win.isVisible();
  if (spell.kind === 'chain') return doChain(book, spell, { notifyOutcome });   // MA: Ultimates live
  return doCast(spell, { notifyOutcome });
});
ipcMain.handle('hq:spell-cancel', (_e, spellId) => {
  const entry = castRegistry.get(String(spellId));
  if (!entry) return false;
  if (entry.chain) {
    // MA: cancelling a chain = halt + kill the active member; its fizzle
    // settles the chain (members chain synchronously, so there is no idle
    // between-links state to catch).
    entry.halted = true;
    const m = entry.activeMember && castRegistry.get(entry.activeMember);
    if (m?.proc?.pid) spawnSync('taskkill', ['/pid', String(m.proc.pid), '/f', '/t'], { windowsHide: true });
    return true;
  }
  if (entry.proc?.pid) spawnSync('taskkill', ['/pid', String(entry.proc.pid), '/f', '/t'], { windowsHide: true });
  return true;   // the close handler records the fizzle
});
ipcMain.handle('hq:spellbook-get', () => readSpellbook());
ipcMain.handle('hq:spell-favorite', (_e, spellId) => {
  const t = readTelemetry();
  const id = String(spellId);
  const i = t.favorites.indexOf(id);
  if (i > -1) t.favorites.splice(i, 1); else t.favorites.push(id);
  writeTelemetry(t);
  return t.favorites;
});
// Fast relearn: rescan the arsenal only (no pipeline), rebuild the bundle, reload.
ipcMain.handle('hq:spellbook-rescan', async () => {
  const r = spawnSync(process.execPath, [path.join(COLLECTOR, 'spellbook.mjs')], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  if (r.status !== 0) return { error: (r.stderr || '').slice(0, 300) || 'scanner failed' };
  rebuildData();
  if (win && !win.isDestroyed()) win.reload();
  return { ok: true };
});
// Lightweight telemetry view for the palette / mini HUD (favorites + recency).
ipcMain.handle('hq:spell-telemetry', () => {
  const t = readTelemetry();
  const rollup = {};
  for (const [id, r] of Object.entries(t.rollup)) rollup[id] = { last_cast: r.last_cast, lifetime_casts: r.lifetime_casts, distinct_days: r.distinct_days.length };
  return { favorites: t.favorites, rollup, confirmed: Object.keys(t.confirmed_hashes) };
});

// Top castable spells for mini HUD buttons + tray submenu: favorites first, then
// most-recently-cast. Tomes and invalid spells never surface here.
function topSpells(n = 3) {
  const book = readSpellbook(); if (!book) return [];
  const t = readTelemetry();
  const castable = book.spells.filter((s) => !s.invalid && (s.kind === 'castable' || s.kind === 'channeled'));
  const byId = new Map(castable.map((s) => [s.id, s]));
  const out = [];
  for (const id of t.favorites) { const s = byId.get(id); if (s && !out.includes(s)) out.push(s); }
  const recent = castable
    .filter((s) => t.rollup[s.id]?.last_cast)
    .sort((a, b) => t.rollup[b.id].last_cast.localeCompare(t.rollup[a.id].last_cast));
  for (const s of recent) { if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  for (const s of castable) { if (out.length >= n) break; if (s.source === 'grimoire' && !out.includes(s)) out.push(s); }
  return out.slice(0, n).map((s) => ({ id: s.id, name: s.name, icon: s.icon, school: s.school, kind: s.kind }));
}

// Cast without a renderer confirm hop (tray / mini HUD): already-approved spells
// fire straight away; anything needing the dry-run opens the main window instead.
function castFromShell(spellId) {
  const book = readSpellbook(); if (!book) return;
  const spell = book.spells.find((s) => s.id === spellId);
  if (!spell || spell.invalid || spell.kind === 'tome' || spell.kind === 'chain') return;
  const t = readTelemetry();
  const known = !spell.confirm && t.confirmed_hashes[spell.id] === spell.content_hash;
  if (!known) { if (!win) createWindow(true); else win.show(); return; }   // confirm belongs in the UI
  if (spell.kind === 'channeled') { openChanneled(spell); return; }
  doCast(spell, { notifyOutcome: true });
}

// ---- Quick-cast palette: Ctrl+Alt+X -> frameless spell launcher --------------
function openCastPalette() {
  if (castWin && !castWin.isDestroyed()) { castWin.show(); castWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 580, H = 442;
  castWin = new BrowserWindow({
    width: W, height: H, x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + wa.height * 0.18),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  castWin.setAlwaysOnTop(true, 'screen-saver');
  castWin.loadFile(path.join(DIR, 'cast.html'));
  castWin.on('blur', () => { if (castWin && !castWin.isDestroyed()) castWin.close(); });
  castWin.on('closed', () => { castWin = null; });
}
ipcMain.handle('hq:cast-palette-hide', () => { if (castWin && !castWin.isDestroyed()) castWin.close(); return true; });

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
  const notes = readJsonStore(notesFile, () => ({}), isPlainObj);
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
ipcMain.handle('hq:kill-servers', () => {
  let n = 0;
  for (const [, proc] of activeDevServers) { if (proc && proc.pid) { spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t']); n++; } }
  activeDevServers.clear(); pushMachine();
  return n;
});

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
    watchDailyNotes();   // two-way for daily notes (`wq:<id>` tasks)
    bridge = startBridge({ dataDir: DATA, onLive: pushBrowserTab });   // browser extension ingest
    startMachineSampler();   // live CPU/RAM/servers strip for the mini HUD
    try { globalShortcut.register('CommandOrControl+Alt+Space', openCapture); } catch (e) { console.error('capture hotkey failed:', e); }
    try { globalShortcut.register('CommandOrControl+Alt+G', openSummon); } catch (e) { console.error('summon hotkey failed:', e); }
    respawnShards();   // sticky notes + conjured widgets grow back where you left them
    // dev/test hook: `electron . --summon="timer 5"` materializes a shard on launch
    const sArg = process.argv.find((a) => a.startsWith('--summon='));
    if (sArg) setTimeout(() => summonWidget(sArg.slice(9).replace(/^["']|["']$/g, '')), 1200);
    // Quick-cast palette: the spellbook must be reachable faster than a terminal.
    const CAST_HOTKEY = 'CommandOrControl+Alt+X';
    try { globalShortcut.register(CAST_HOTKEY, openCastPalette); } catch (e) { console.error('cast hotkey failed:', e); }
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
  app.on('before-quit', () => {
    app.isQuitting = true;
    try { persistShards(); } catch {}   // sticky shards remember their spots
    if (machineTimer) clearInterval(machineTimer);
    try { globalShortcut.unregisterAll(); } catch {}
    for (const w of [watcher, qbWatcher, dailyWatcher, canvasWatcher]) if (w) try { w.close(); } catch {}
    if (bridge) try { bridge.stop(); } catch {}
    // no orphaned incantations: kill any live cast trees on the way out
    for (const [, entry] of castRegistry) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.proc?.pid) spawnSync('taskkill', ['/pid', String(entry.proc.pid), '/f', '/t'], { windowsHide: true });
    }
    castRegistry.clear();
    // same for live dev servers and in-flight Claude sessions — no orphans on quit
    for (const [, proc] of activeDevServers) { if (proc?.pid) try { spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true }); } catch {} }
    activeDevServers.clear();
    try { claudeSessions.killAll(); } catch {}
  });
}
