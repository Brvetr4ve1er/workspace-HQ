// WorkspaceHQ Electron shell.
// - refreshes data.js from sidecars on launch and after every scan
// - system tray (Show / Scan now / Quit) with a level+health tooltip
// - native notifications for quest completions (driven by changes_since_prev[].notify)
// - IPC: run scan, open a repo folder, mark a quest done (persists via quest-overrides.json)
//
// Tauri alternative: dashboard/ is the distDir; a src-tauri wrapper would call the
// same run-pipeline.ps1 and the same data/quest-overrides.json from a Rust command.

const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, shell, nativeImage, dialog, screen, globalShortcut, desktopCapturer, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
// taskkill stays sync (several run at quit, while the process exits) but is never unbounded: a wedged kill can't freeze main
const TASKKILL_OPTS = { windowsHide: true, timeout: 10000 };
const { startBridge } = require('./browser-bridge');
const claudeSessions = require('./claude-sessions');   // MA: the Familiar's leash
const llmLocal = require('./llm-local');               // PC-Brain L3: local model adapter (Ollama/LM Studio)
const trayMenu = require('./tray-menu');               // v5 M4: tray menu as data (trayTemplate) + scanCounts (tray + mini HUD)
const { launchClaudeTerminal } = require('./claude-launch');   // v5 M4: hq:claude-quest; HQ_DRY_LAUNCH=1 only logs
const launchTools = require('./launch-tools').create({ repoRoot: path.join(__dirname, '..'), log: (l) => console.log(l) });   // a quest launch carries the workspacehq tools + an explicit permission mode (per-launch temp mcp.json, swept after 24 h)
const gitActions = require('./git-actions');     // async push/snapshot for the tray quick actions — the sync versions froze all of main on one hung push/copy
const dataRefreshMod = require('./data-refresh');   // assemble→bake→reload runner + the latest.json self-write marker
const bakeFreshness = require('./bake-freshness');  // launch-bake mtime short-circuit
const { readJsonStore, isPlainObj, emptyTelemetry, telemetryOk } = require('./json-store');   // quarantine-on-corrupt store reads (moved out of main.js for tests)
const appLog = require('./app-log').create({ appRoot: path.join(__dirname, '..'), env: process.env });   // lifecycle log → logs/app-YYYY-MM-DD.log (app-log.js; gates set HQ_APP_LOG_DIR)
appLog.attach({ app });   // crashes, hangs, session end, quit — every window
const trayBrief = require('./tray-brief').create({ log: (f) => appLog.event('use', f), onChange: () => updateTray() });   // the Brief in the tray menu + tooltip (brief.js onBrief feeds it)

// Last-resort safety net: a stray throw/rejection anywhere must never take the
// whole main process (and every window) down. Log and keep the app alive.
// A closed console pipe (hidden, detached launch) silences the console once instead of looping (stdio-guard.js).
const stdio = require('./stdio-guard').guardStdio({ onBroken: (e) => appLog.event('stdio-closed', { code: e.code }) });
process.on('uncaughtException', (e) => { if (stdio.handle(e)) return; try { console.error('[uncaught]', e); } catch (w) { stdio.handle(w); } appLog.error('uncaughtException', e); });
process.on('unhandledRejection', (e) => { if (stdio.handle(e)) return; try { console.error('[unhandledRejection]', e); } catch (w) { stdio.handle(w); } appLog.error('unhandledRejection', e); });

const DIR = __dirname;
const SCAN_DIR = path.join(DIR, '..');
const PIPELINE = path.join(SCAN_DIR, 'run-pipeline.ps1');
const COLLECTOR = path.join(SCAN_DIR, 'collector');
const DATA = path.join(SCAN_DIR, 'data');
const DOCS_ROOT = 'C:\\Users\\ROG STRIX\\Documents';
const VAULT = path.join(DOCS_ROOT, 'VEEMO CORTEX');
const PROJECT_NOTES_DIR = path.join(VAULT, '30_Areas', 'Projects');
const NOTIFY_STATE = path.join(DATA, '.notify-state.json');
const QUEST_BOARD = path.join(VAULT, '30_Areas', 'Workspace Status', 'Quest Board.md');
const DAILY_DIR = path.join(VAULT, '10_Daily');
// the data watcher must tell the app's own latest.json writes (refresh runner,
// runScan, do-commit rescan) from the scheduled scan's (data-refresh.js)
const selfWrite = dataRefreshMod.selfWriteMarker(path.join(DATA, 'latest.json'));
// Allow-list of regenerable dirs the reclaim action may delete (npm install / rebuild restores them).
const RECLAIMABLE_DIRS = new Set(['node_modules', '.next', '.nuxt', 'dist', 'build', 'out', '.output', 'target', '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache', 'coverage', '.turbo']);
const START_HIDDEN = process.argv.includes('--hidden') || process.argv.includes('--start-minimized');
let win, tray, watcher, qbWatcher, dailyWatcher, castWin = null;
let bridge = null;   // localhost ingest for the WorkspaceHQ Bridge browser extension
let navBridge = null;   // v5 M4: nav-bridge init() result ({ openAt }) — tray Show / Open Automations
let intentInbox = null;   // Brief mailbox (intent-inbox.js): stop() removes the app heartbeat at quit
let claudeHub = null;   // Claude Hub host (claude-hub-host.js), set in whenReady
const activeDevServers = new Map();

// Push the live browser tab (from the bridge extension) to any open windows so
// the "Working On Now" card updates in real time, without waiting for a scan.
function pushBrowserTab(live) {
  if (win && !win.isDestroyed()) { try { win.webContents.send('hq:browser-tab', live); } catch { /* window closing */ } }
}
// The renderer asks for the current live tab on load (the window may open after
// several bridge flushes have already landed).
ipcMain.handle('hq:browser-live', () => (bridge ? bridge.readActivity()?.live || null : null));

// SOCIAL BINDING: the renderer's SOCIAL realm reads the scraped sidecars (feed/
// mentions/metrics/outbox/accounts) on demand. Read-only — the extension writes.

// Project paths in the data are already absolute (e.g. C:\Users\...\alliance travel);
// only fall back to joining DOCS_ROOT for legacy relative paths. Reject anything that
// escapes DOCS_ROOT after resolution — unless it is exactly a tracked project's path in the
// current latest.json (own repos the scan found on the Desktop; dashboard/project-paths.js).
const resolveProjectPath = require('./project-paths').createResolver({ docsRoot: DOCS_ROOT, readLatest: require('./project-paths').readLatestFrom(DATA) });

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
// snapshotProject (filtered robocopy copy) and gitEach now live in
// git-actions.js, async: the sync versions ran spawnSync on main, so one push
// hung on a credential prompt — or one multi-GB copy — froze window, tray and
// every IPC handler with no way to cancel.
const snapshotOpts = () => ({ backupsDir: BACKUPS, excludeDirs: [...RECLAIMABLE_DIRS] });
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
  // a failed bake leaves the window on the previous bundle — say so instead of going silently stale
  if (r.status !== 0) console.error('[build-data] bake failed (exit ' + r.status + '): ' + String(r.stderr || (r.error && r.error.message) || '').trim().slice(0, 500));
}
function latest() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'latest.json'), 'utf8')); } catch { return null; }
}

// Renderer switch. v5 (dashboard-v5/) is the app. v2-v4 (legacy/) were removed 2026-10-28;
// (frozen, never loaded by default) and only come back as a rollback: data/.ui-version
// holding exactly "v2" | "v3" | "v4" (`tools\rollback.ps1 v3` writes it and restarts
// the app). A missing or unreadable file, or any other value, loads v5. Every
// renderer runs on THIS preload: the IPC surface is shared (IPC-CONTRACT.md).
// The decision is pure and unit-tested: ui-version.js + ui-version.test.mjs.
const uiSwitch = require('./ui-version');
function uiVersion() {
  // HQ_UI_VERSION tries a renderer for one launch without touching the user-owned file
  return uiSwitch.resolveUiVersion({ env: process.env, readFlag: () => fs.readFileSync(path.join(DATA, '.ui-version'), 'utf8') });
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1180, height: 820, backgroundColor: '#0d1117', title: 'WorkspaceHQ',
    icon: path.join(DIR, 'icon.png'), show,
    // A hidden start (--hidden, the login item) must load as hidden: Electron's default keeps a never-shown window's page
    // "visible", which counted every login as the owner opening Home (hq:use). Nothing here waits on 'ready-to-show'.
    paintWhenInitiallyHidden: show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(DIR, 'preload.js') },
  });
  const uiv = uiVersion();   // always loads dashboard-v5; a flag still naming v2–v4 is only logged
  if (uiSwitch.isLegacy(uiv)) { console.log(`[ui] renderer ${uiv} was removed 2026-10-28 — loading v5`); appLog.event('ui-legacy-removed', { asked: uiv }); }
  else win.setBackgroundColor('#0d0d0f');   // v5's page colour, so the pre-paint frame doesn't flash
  win.loadFile(uiSwitch.rendererPage(SCAN_DIR, uiv));
  // Close-to-tray: keep the app (and tray) alive when the user closes the window,
  // unless they explicitly quit. The dead app.isQuitting flag now drives this.
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

// ---- live machine vitals: CPU% (delta-sampled) + RAM% + orphaned dev-server count -----
let lastCpu = null, machineTimer = null;
function cpuTimes() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const t of Object.values(c.times)) total += t; idle += c.times.idle; } return { idle, total }; }
function machineSample() {
  const cur = cpuTimes();
  let cpu = 0;
  if (lastCpu) { const dt = cur.total - lastCpu.total, di = cur.idle - lastCpu.idle; cpu = dt > 0 ? Math.round((1 - di / dt) * 100) : 0; }
  lastCpu = cur;
  return { cpu: Math.max(0, Math.min(100, cpu)), ram: Math.round((1 - os.freemem() / os.totalmem()) * 100), servers: activeDevServers.size };
}
function pushMachine() {
  const s = machineSample();   // sample ONCE per tick (delta-based CPU%), then fan out
  if (win && !win.isDestroyed()) win.webContents.send('hq:machine', s);   // v4.1 Phase 3: main window (truth rail) gets vitals too
}
function startMachineSampler() { if (machineTimer) return; lastCpu = cpuTimes(); machineTimer = setInterval(pushMachine, 2500); }

// Tray menu (v5 M4 / S7): the layout is data in tray-menu.js (pure, unit-tested —
// status line, Show, Scan now, Quick-run…, Run ▸, then the
// Quick actions below a separator); main hands it the state and the actions, with
// the same confirms, notifications and rescans as the pre-v5 menu. Show and Open
// Automations go through nav-bridge openAt (v3 ignores the hq:navigate push, so
// there they only show the window); the old show code is the fallback.
function showMainAt(route) {
  if (navBridge && navBridge.openAt(route)) return;
  if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}
function trayNotify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(DIR, 'icon.png') }).show();
}
function buildTrayMenu() {
  return Menu.buildFromTemplate(trayMenu.trayTemplate(
    { scan: latest(), spells: topSpells(3), devServers: activeDevServers.size, brief: trayBrief.view() },
    {
      show: () => showMainAt({ tab: 'home' }),
      openRef: (ref) => trayBrief.open(ref, showMainAt),
      scan: () => { if (!runScan()) { const held = refreshLock.held(); trayNotify('WorkspaceHQ', held && held.by === 'mcp' ? require('./refresh-lock').refusalText(held) : liveState.snapshot().scan.state === 'running' ? 'A scan is already running.' : 'The scan didn’t start.'); } },
      quickRun: openCastPalette,
      openAutomations: () => showMainAt({ tab: 'automations' }),
      cast: (id) => castFromShell(id),
      // fire-and-notify: both batches run async + serial (git-actions.js) so main stays live;
      // per-repo failures land in the completion notification, details on the console
      pushAll: (unpushed) => confirmThen(`Push ${unpushed.length} repo(s)?`, unpushed.map((p) => p.name).join(', '), async () => {
        const { ok, failed } = await gitActions.gitEach(unpushed, ['push'], { resolvePath: resolveProjectPath });
        if (failed.length) console.error('[pushAll] failed:', failed.map((f) => `${f.name} (${f.reason})`).join(', '));
        trayNotify('⬆ Pushed', `${ok}/${unpushed.length} repos${failed.length ? ` — failed: ${failed.map((f) => f.name).join(', ')}` : ''}`);
        runScan();
      }),
      snapshotDirty: (dirty) => confirmThen(`Snapshot ${dirty.length} dirty repo(s)?`, 'Filtered backup copy to backups/ — safe, non-disruptive.', async () => {
        let ok = 0; const failed = [];
        for (const p of dirty) {   // serial: parallel robocopy over several trees thrashes the disk
          const b = resolveProjectPath(p.path);
          if (b && await gitActions.snapshotProject(b, p.name, snapshotOpts())) ok++;
          else failed.push(p.name);
        }
        trayNotify('📦 Snapshotted', `${ok}/${dirty.length} repos → backups/${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`);
      }),
      killServers: () => { for (const [, proc] of activeDevServers) { if (proc && proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], TASKKILL_OPTS); } activeDevServers.clear(); pushMachine(); updateTray(); },
      openUrgent: (tp) => { const b = resolveProjectPath(tp.path); if (b) shell.openPath(b); },
      quit: () => { appLog.setQuitReason('tray'); app.isQuitting = true; app.quit(); },
    }));
}
function updateTray() {
  if (!tray) return;
  const s = latest();
  tray.setToolTip(trayBrief.tooltip() || (s ? `WorkspaceHQ — L${s.account.level} ${s.account.title} · health ${s.account.health_index} · ${s.account.totals.open_quests} open` : 'WorkspaceHQ'));
  tray.setContextMenu(buildTrayMenu());   // refresh dynamic quick-actions on every scan
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(DIR, 'icon.png')));
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => { if (!win) createWindow(); else (win.isVisible() ? win.focus() : win.show()); });
  updateTray();
}

// Ambient positive-outcome OS notifications were retired per the 2026-06-20
// ambient-companion spec: measured+new but not actionable, so five toasts per
// happy event of things the user already did. See docs/sync/HANDOFF.md for the
// audit rationale. The notify:true flags are still emitted by the collector
// (structure-lane responsibility) so a future ambient/voice surface can consume
// them honestly — nothing in the app now turns them into OS toasts.

// ---- readJsonStore / isPlainObj (quarantine-on-corrupt reads for every
// write-back store) moved to json-store.js (2026-10-31) so the rule is
// unit-tested; same behavior, same callers, required at the top of this file.

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
  if (!changed) {
    // overrides can say 'done' while latest.json still shows the quest open when
    // the last refresh failed — retry instead of leaving the quest stuck
    if (dataRefresh.lastFailed()) dataRefresh.refresh();
    return false;
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'quest-overrides.json'), JSON.stringify(ov, null, 2));
  // async assemble→bake→reload (data-refresh.js): main no longer freezes ~1-2s,
  // a failed step is surfaced instead of reloading stale data, and the data
  // watcher won't echo the write into a second bake + reload
  dataRefresh.refresh();
  return true;
}

// Two-way: ticking a `- [x] wq:<quest-id>` line in any daily note completes that
// quest. daily-notes-watch.js — debounce is PER FILE there (the old shared timer
// dropped note A's ticks whenever note B changed within the window).
function watchDailyNotes() {
  dailyWatcher = require('./daily-notes-watch').watch({ dir: DAILY_DIR, readOverrides, applyDone });
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
  // v5 clean pass: one pipeline at a time, and the scan state (hq:live-state /
  // hq:scan-status) is settled exactly once per child, BEFORE the reload, so a
  // reloaded window sees 'done'/'failed' instead of a scan that never ends.
  if (!refreshLock.take('app')) return false;   // a raw pass started from a Claude session is still running (assistant rulebook)
  if (!liveState.scanBegin()) { refreshLock.release('app'); return false; }
  let settled = false;
  const end = (code, err) => { if (settled) return; settled = true; refreshLock.release('app'); try { liveState.scanEnd(code, err); } catch (e) { console.error('scanEnd failed:', e); } };
  if (win) win.setTitle('WorkspaceHQ — scanning…');
  let ps;
  try { ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PIPELINE], { windowsHide: true }); }
  catch (err) { end(-1, err); if (win && !win.isDestroyed()) win.setTitle('WorkspaceHQ'); return false; }
  ps.on('error', (err) => { end(-1, err); if (win && !win.isDestroyed()) win.setTitle('WorkspaceHQ'); try { dialog.showErrorBox('Scan failed to start', String(err.message || err)); } catch {} });
  ps.on('close', (code) => {
    end(code);
    if (win) win.setTitle('WorkspaceHQ');
    if (code === 0) { selfWrite.note(); rebuildData(); if (win) win.reload(); updateTray(); }   // note first: the data watcher must not echo this scan's own latest.json
    else if (win) dialog.showErrorBox('Scan failed', `Pipeline exited ${code}. See workspace hq/logs.`);
  });
  return true;
}

// IPC
ipcMain.handle('hq:scan', () => runScan());   // v5 M4: false = not started (one is already running); v3/v4 ignore the value
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
  const dest = await gitActions.snapshotProject(base, name || path.basename(base), snapshotOpts());
  if (dest && Notification.isSupported()) new Notification({ title: '📦 Snapshot saved', body: dest, icon: path.join(DIR, 'icon.png') }).show();
  return !!dest;
});

// ---- Capture-save (Wave 4): now text-only, no frameless window ----
// The frameless Ctrl+Alt+Space quick-capture window was retired per the
// 2026-09-15 dead-weight audit — data/brain-dump.json was empty for 80+ days
// through both the hotkey UI and the MCP hq_capture tool. The IPC handler
// stays because the v3 medbay realm's "Note for cleanup" button (via the
// core/actions.mjs capture:note action) still writes captures programmatically,
// and the MCP hq_capture tool (mcp/workspacehq/server.mjs) is unchanged.
ipcMain.handle('hq:capture-save', (_e, text) => {
  const t = String(text || '').trim();
  if (!t) return false;
  const f = path.join(DATA, 'brain-dump.json');
  const arr = readJsonStore(f, () => [], Array.isArray);
  arr.push({ id: `${Date.now().toString(36)}`, ts: new Date().toISOString(), text: t });
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, JSON.stringify(arr, null, 2));
  // re-assemble the current scan (fast — no collector) so the dump shows as a
  // side-quest; async via data-refresh.js (was a main-freezing spawnSync chain)
  dataRefresh.refresh();
  return true;
});

// ---- Scoped Claude launcher: open an interactive Claude session cd'd to a project ----
// v5 M4 (K-5): the project picker (Claude chat, prompt runs) gets the project
// picker (latest scan, paths resolved + containment-checked, unresolvable ones
// dropped) and the launcher, which re-checks the cwd it is handed (untrusted input).
function studioProjects() {
  const s = latest();
  const out = [];
  for (const p of (s && Array.isArray(s.projects) ? s.projects : [])) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.path !== 'string' || !p.path) continue;
    const abs = resolveProjectPath(p.path);
    if (abs) out.push({ id: p.id, name: String(p.name || p.id), path: abs });
  }
  return out;
}
// v5 M4: the launch itself is claude-launch.js launchClaudeTerminal; HQ_DRY_LAUNCH=1
// logs instead of opening.
ipcMain.handle('hq:claude-quest', (_e, projPath, prompt) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return false;
  return launchClaudeTerminal(cwd, prompt, { tools: launchTools });
});

// ---- PC-Brain L3: local model runtime probe -----------------------------------
// The medbay realm calls this on mount to show whether Ollama/LM Studio is up.
// Renderer never gets to send prompts through this channel — this is presence only.
ipcMain.handle('hq:llm:probe', (_e, opts) => llmLocal.probe({ force: opts?.force === true }));

// ---- PC-Brain Phase 2: ORACLE chat --------------------------------------------
// The renderer sends {jobId, messages, include}; main builds the grounding
// CONTEXT from the app's own data files (llm-context.js), prepends the persona,
// and streams the reply back. Model output only ever reaches the ORACLE realm —
// never the tray, HUD, or notifications (ambient-companion honesty boundary).
const llmContext = require('./llm-context');
let personaText = null;
function oraclePersona() {
  if (personaText == null) {
    try { personaText = fs.readFileSync(path.join(DIR, 'llm-persona.md'), 'utf8'); }
    catch { personaText = 'You are a concise assistant. Answer only from the CONTEXT block; if the answer is not there, say so.'; }
  }
  return personaText;
}
const llmJobs = new Map();   // jobId -> AbortController
const LLM_JOB_RE = /^[a-z0-9-]{4,40}$/i;
function cleanChatReq(req) {
  if (!req || typeof req !== 'object') return { error: 'bad request' };
  const jobId = String(req.jobId || '');
  if (!LLM_JOB_RE.test(jobId)) return { error: 'bad job id' };
  if (llmJobs.has(jobId)) return { error: 'job already running' };
  const msgs = (Array.isArray(req.messages) ? req.messages.slice(-20) : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  // Newest-first history budget (~2k tokens) so persona + context + history +
  // answer stay inside the 8k window llm-local asks Ollama for.
  const kept = [];
  let budget = 8000;
  for (let i = msgs.length - 1; i >= 0; i--) {
    budget -= msgs[i].content.length;
    if (budget < 0 && kept.length) break;
    kept.unshift(msgs[i]);
  }
  if (!kept.length || kept[kept.length - 1].role !== 'user') return { error: 'the last message must be from the user' };
  const include = {};
  for (const id of llmContext.SECTION_IDS) include[id] = req.include?.[id] === true;
  return { jobId, messages: kept, include };
}
ipcMain.handle('hq:llm:warm', () => llmLocal.warm());
ipcMain.handle('hq:llm:chat', async (e, req) => {
  const c = cleanChatReq(req);
  if (c.error) return { status: 'error', reason: c.error, output: '' };
  const t0 = Date.now();
  // Registered BEFORE any await: a Stop pressed while the vault is still being
  // searched must find the job, and a duplicate jobId must be refused.
  const ac = new AbortController();
  llmJobs.set(c.jobId, ac);
  // The renderer that asked can disappear mid-answer (main reloads the window
  // after scans and commits): abort instead of generating into the void.
  const sender = e.sender;
  const kill = () => ac.abort();
  const onNav = (ev) => { if (ev && (ev.isMainFrame === false || ev.isSameDocument === true)) return; kill(); };
  sender.on('did-start-navigation', onNav);
  sender.once('destroyed', kill);
  sender.once('render-process-gone', kill);
  // Push the ACCUMULATED text (not deltas), throttled to ~25/s — a renderer
  // that re-mounts mid-answer re-attaches cleanly instead of missing chunks.
  let latest = '', lastSent = 0, timer = null;
  const flush = () => {
    timer = null; lastSent = Date.now();
    if (!sender.isDestroyed()) sender.send('hq:llm:delta', { jobId: c.jobId, text: latest });
  };
  try {
    const ctx = await llmContext.assemble({
      dataDir: DATA, vaultDir: VAULT, include: c.include, query: c.messages[c.messages.length - 1].content,
      activity: bridge ? bridge.readActivity() : null,
      claudeHub,   // Claude Hub H5: the 'claude' section asks the Hub's contextFor (null-safe)
    });
    if (ac.signal.aborted) return { status: 'cancelled', output: '', sections: ctx.sections, contextChars: ctx.chars, ms: Date.now() - t0 };
    // The persona file is split at <!-- after-context -->: the answer rules go
    // AFTER the data, where a small model weights them most.
    const [personaPre, personaPost = ''] = oraclePersona().split('<!-- after-context -->');
    const r = await llmLocal.stream({
      messages: [{ role: 'system', content: `${personaPre.trim()}\n\n## CONTEXT\n${ctx.text}\n\n${personaPost.trim()}`.trim() }, ...c.messages],
      signal: ac.signal,
      onText: (t) => { latest = t; if (!timer) timer = setTimeout(flush, Math.max(0, 40 - (Date.now() - lastSent))); },
    });
    return { ...r, sections: ctx.sections, contextChars: ctx.chars, ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
    if (llmJobs.get(c.jobId) === ac) llmJobs.delete(c.jobId);
    if (!sender.isDestroyed()) {
      sender.removeListener('did-start-navigation', onNav);
      sender.removeListener('destroyed', kill);
      sender.removeListener('render-process-gone', kill);
    }
  }
});
ipcMain.handle('hq:llm:cancel', (_e, jobId) => {
  const ac = llmJobs.get(String(jobId || ''));
  if (!ac) return false;
  ac.abort();
  return true;
});

// ---- Commit drafter (Wave 4): claude -p over git diff -> conventional commit ----
// MA: async via the sessions registry — the main process no longer freezes for
// up to 90s while Claude writes. invoke() already promises to the renderer,
// so the {message}|{error} contract is unchanged.
// PC-Brain Phase 1: try the local model first (~3-8s via Ollama/LM Studio); on
// unavailable or error, fall through to the Claude CLI leash (~60s) so the
// user's daily commit-draft flow keeps working with no runtime installed.
ipcMain.handle('hq:draft-commit', async (_e, projPath) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return { error: 'bad path' };
  // unstaged + staged diff; cap to avoid blowing token budget
  // async + bounded (was an unbounded spawnSync: a huge repo's diff froze all of main); only the first 30k chars are used
  const gd = await gitActions.run('git', ['-C', cwd, 'diff', 'HEAD'], { timeoutMs: 20000, stdoutMax: 30000 });
  if (gd.timedOut) return { error: 'git diff took longer than 20 s — write this commit message by hand' };
  const diff = gd.stdout || '';
  if (!diff.trim()) return { error: 'no diff to summarize' };
  const prompt = `Write a single conventional-commit message for this diff. Format: "type(scope): summary" then blank line then 1-3 bullet points if useful. Reply with ONLY the message text, no fences.\n\n${diff}`;
  const local = await llmLocal.run({ prompt, timeoutMs: 30000 });
  if (local.status === 'done') return { message: local.output.trim(), via: `local:${local.runtime}` };
  const r = await claudeSessions.run({ label: 'draft-commit', input: prompt, timeoutMs: 90000 });
  if (r.error) return { error: r.error };
  if (r.status !== 'done') return { error: r.output.slice(-300).trim() || 'claude failed' };
  return { message: r.output.trim(), via: 'claude' };
});
// MA: async twin of the sync node runners — for post-action rescans that
// must not freeze the main process
function runNodeAsync(script, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    p.on('close', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error(path.basename(script) + ' exit ' + code), { exitCode: code }))));
    p.on('error', reject);
  });
}
// Every git call in hq:do-commit has a deadline, like commit-guard's: spawnSync blocks
// all of main, and a hung git (index.lock wait, AV scan, a hook that never returns)
// must end as an honest error, never a frozen app. A timeout fails closed.
const COMMIT_GIT_MS = { add: 60000, recheck: 15000, commit: 120000 };   // commit runs the commit hooks
const gitTimedOut = (r) => !!(r && r.error && r.error.code === 'ETIMEDOUT');
// Git for Windows: `git` on PATH is a launcher (cmd\git.exe) that runs the real git as its
// child, and spawnSync's timeout kills only the launcher — the real git and its hooks then
// finished the add/commit AFTER the timeout was reported (seen in the 2026-10-07 gate). So a
// timeout also stops the launcher's children, trees included. Timeout path only (~0.6 s).
function stopGitTree(r) {
  if (process.platform !== 'win32' || !r || !Number.isInteger(r.pid)) return;
  try { spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${r.pid}' | ForEach-Object { taskkill.exe /pid $_.ProcessId /t /f | Out-Null }`], { windowsHide: true, timeout: 15000 }); } catch { /* best effort */ }
}
ipcMain.handle('hq:do-commit', (_e, projPath, message) => {
  const cwd = resolveProjectPath(projPath);
  if (!cwd) return false;
  // v5 clean pass: `add -A` stages everything, so refuse a change set holding an
  // .env-style file (listed file by file, fails closed — commit-guard.js) …
  const before = commitGuard.envHits(cwd);
  if (before.length) return { error: 'refused: .env in change set', envHits: before };
  // maxBuffer (review 2026-10-07): spawnSync's 1 MiB default kills git on chatty output (one CRLF
  // warning per file on `add -A`, a lint hook in `commit`) — and, like a timeout, only the launcher.
  const a = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: COMMIT_GIT_MS.add });
  if (gitTimedOut(a)) {   // stop the real git first, then put the index back (it may hold part of the tree), as the .env refusal does
    stopGitTree(a);
    const u = commitGuard.unstageAll(cwd);
    return { error: 'git add timed out after 60 s — nothing committed' + (u.ok ? ', nothing left staged' : '; files may still be staged, run git reset in the project') };
  }
  if (a.status !== 0) return { error: 'add failed' };
  // … and re-check what actually got staged (a file can appear between the check
  // and the add). On a hit — or when git can't list the index — put the whole
  // index back to HEAD and refuse: the refusal "stages nothing" (IPC-CONTRACT).
  // Not `reset -- <hits>`: those paths are root-relative, a reset pathspec is
  // cwd-relative, so a subfolder project kept its .env staged (commit-guard.js unstageAll).
  // A timeout here is a git error (status null): the fail-closed refusal below.
  const staged = spawnSync('git', ['-C', cwd, '-c', 'diff.relative=false', 'diff', '--cached', '--name-only', '-z'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: COMMIT_GIT_MS.recheck });
  if (gitTimedOut(staged)) stopGitTree(staged);
  const after = staged.status === 0 ? String(staged.stdout || '').split('\0').filter((p) => p && commitGuard.isEnvPath(p)) : [commitGuard.GIT_ERROR_HIT];
  if (after.length) {
    const u = commitGuard.unstageAll(cwd);
    if (!u.ok) console.error('[do-commit] unstage after refusal failed:', u.error || u.remaining.join(', '));
    return { error: 'refused: .env in change set' + (u.ok ? '' : ' — couldn’t unstage it, run git reset in the project'), envHits: after };
  }
  const c = spawnSync('git', ['-C', cwd, 'commit', '-m', String(message || 'wip')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: COMMIT_GIT_MS.commit });
  // Stopped mid-commit (hooks included). A stop that lands mid-write is undefined, so it says
  // check before retrying — and no rescan.
  if (gitTimedOut(c)) { stopGitTree(c); return { error: 'git commit timed out after 120 s and was stopped — check the project’s git status and log before retrying' }; }
  if (c.status !== 0) return { error: (c.stderr || c.stdout || '').slice(0, 300).trim() || 'git commit failed' };   // never error:'' (v5 reads it as success)
  // MA: the post-commit rescan runs async — the commit returns immediately
  // instead of freezing main for a full collector pass; the window reloads
  // by itself once fresh data is bundled.
  // v5 clean pass: it is a scan like runScan's (same collector + assemble), so it
  // holds the one-scan-at-a-time guard — Scan now refuses during it and
  // hq:live-state / hq:scan-status show it — and settles BEFORE the reload.
  // scanBegin() false = a scan is already running; it picks the commit up.
  const s = latest();
  // Assistant rulebook: it also takes data/.refresh.lock ('app') like runScan, so a Claude session's raw pass
  // (hq_scan_trigger) and this rescan never run the collector together; a held lock = skip, the next scan picks the commit up.
  if (s && refreshLock.take('app')) {
    if (!liveState.scanBegin()) { refreshLock.release('app'); return { ok: true }; }
    let settled = false;
    const end = (code, err) => { if (settled) return; settled = true; refreshLock.release('app'); try { liveState.scanEnd(code, err); } catch (e) { console.error('scanEnd failed:', e); } };
    runNodeAsync(path.join(COLLECTOR, 'collector.mjs'))
      .then(() => runNodeAsync(path.join(COLLECTOR, 'assemble.mjs'), ['--date', s.scan.id]))
      .then(() => { end(0); selfWrite.note(); rebuildData(); if (win && !win.isDestroyed()) win.reload(); })   // note first: the watcher must not echo this rescan's latest.json
      .catch((err) => { end(Number.isInteger(err && err.exitCode) ? err.exitCode : -1, err); console.error('[do-commit] rescan failed:', err && err.message); });
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
  // v5 clean pass: also keep it in project-notes.json (kind:'decision') so the
  // project journal can show it — the vault note alone is invisible to the app.
  // Not mirrored again: the vault already has the [!decision] block above.
  try {
    const notesFile = path.join(DATA, 'project-notes.json');
    const notes = readJsonStore(notesFile, () => ({}), isPlainObj);
    if (!Array.isArray(notes[projId])) notes[projId] = [];
    notes[projId].push({ id: Date.now().toString(), date: new Date().toISOString(), text: String(text), completed: false, kind: 'decision' });
    fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
  } catch (e) { console.error('decision → project-notes failed:', e); }
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
  dataRefresh.refresh();   // async assemble→bake→reload (data-refresh.js); failures surfaced, no main freeze
  return true;
});

// ---- Graveyard verbs (Wave 5): Archive / Revive a project via overrides ----
ipcMain.handle('hq:archive-project', (_e, projId) => {
  const f = path.join(DATA, 'project-overrides.json');
  const o = readJsonStore(f, () => ({}), isPlainObj);
  o[projId] = { status: 'archived', archived: new Date().toISOString().slice(0, 10) };
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2));
  dataRefresh.refresh();   // async assemble→bake→reload (data-refresh.js); failures surfaced, no main freeze
  return true;
});
ipcMain.handle('hq:revive-project', (_e, projId) => {
  const f = path.join(DATA, 'project-overrides.json');
  const o = readJsonStore(f, () => ({}), isPlainObj);
  delete o[projId];
  fs.writeFileSync(f, JSON.stringify(o, null, 2));
  dataRefresh.refresh();   // async assemble→bake→reload (data-refresh.js); failures surfaced, no main freeze
  return true;
});

// hq:orphan-archive removed per 2026-09-15 dead-weight audit: zero renderer
// callsites across v2/v3/v4 — filesystem-mutation surface for a UI that was
// never built (Wave 5 triage plan). Latent chore-hook the ambient spec forbids.
// Works for both core quest ids (q-…) and side-quest ids (sq-…) — both live in the
// same quest-overrides.json store that assemble.mjs reads.
ipcMain.handle('hq:quest-done', (_e, id) => (id ? applyDone(id) : false));   // forwards 'newly marked' — true/false per IPC-CONTRACT; false also means 'was already done'

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
// hq:acted-on-read removed per 2026-09-15 dead-weight audit: consumer was the
// v2 renderer (now legacy/dashboard-v2/app.js:822-823), which is quarantined and
// only loads as a rollback (data/.ui-version=v2). The v3 renderer bakes window.DATA.actedOn at build time
// and never reads live. readActedOn() is still used by the ledger append path.
const castRegistry = new Map();   // spellId -> { proc, castId, startedAt, timer }

function readSpellbook() {
  try { return JSON.parse(fs.readFileSync(SPELLBOOK_FILE, 'utf8')); } catch { return null; }
}
function readTelemetry() {
  // quarantine-on-corrupt like every other write-back store (json-store.js): the
  // old bare catch returned the default and the next cast WROTE IT BACK, erasing
  // favorites, the cast log and the mastery rollup; wrong-shape-but-valid JSON
  // (e.g. `[]`) passed the parse and crashed recordCast mid-finish instead
  return readJsonStore(TELEMETRY_FILE, emptyTelemetry, telemetryOk);
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
  for (const w of [win, castWin]) {
    if (w && !w.isDestroyed()) try { w.webContents.send(channel, payload); } catch {}
  }
}
// MA: session presence — every registry change pushes to the windows, and the
// list is pollable (IPC-CONTRACT: hq:claude-sessions push / hq:sessions-list).
// v4.1 D2: claude-sessions.js buffers RAW output and stays READ-ONLY, so for a
// stream-json session its `tail` is JSON — and the panes DISPLAY tail whenever
// the renderer's live buffer is empty (every capture-save/scan reloads the
// window mid-linger). session-tails.js holds the parsed text for jobs we
// dispatched; withTails swaps it in on the way out, on both channels, and
// leaves every foreign job's tail untouched (IPC-CONTRACT: registry tail).
const sessionTails = require('./session-tails');
claudeSessions.setOnChange((sessions) => castSend('hq:claude-sessions', sessionTails.withTails(sessions)));
ipcMain.handle('hq:sessions-list', () => sessionTails.withTails(claudeSessions.list()));
require('./session-api').init({ ipcMain, claudeSessions, send: castSend });   // v4 SPINE B3: session IPC (IPC-CONTRACT.md)
const liveState = require('./live-state').init({ ipcMain, send: castSend, devServers: activeDevServers, casts: castRegistry, readSpellbook });   // v5 clean pass: hq:live-state
const refreshLock = require('./refresh-lock').create({ dataDir: DATA });   // assistant rulebook: the app's Scan and a Claude session's raw collector pass share data/.refresh.lock
const commitGuard = require('./commit-guard'); commitGuard.init({ ipcMain, resolveProjectPath });   // v5 clean pass: hq:commit-preview + the do-commit .env guard
// One shared async assemble→bake→reload for the write handlers (quest done,
// capture, learn, archive, revive) — data-refresh.js. Holds the scan guard like
// do-commit's rescan (Scan now refuses while it runs, hq:scan-status shows it),
// coalesces bursts into one reload, surfaces failures, and marks self-writes so
// the data watcher doesn't bake + reload a second time.
const dataRefresh = dataRefreshMod.init({
  runNode: runNodeAsync,
  assembleScript: path.join(COLLECTOR, 'assemble.mjs'),
  buildScript: path.join(DIR, 'build-data.mjs'),
  latest,
  scanBegin: () => liveState.scanBegin(),
  scanEnd: (code, err) => liveState.scanEnd(code, err),
  marker: selfWrite,
  onDone: () => { if (win && !win.isDestroyed()) win.reload(); updateTray(); },
  onError: (err) => {
    console.error('[data-refresh] failed:', err && err.message);
    appLog.error('data-refresh', err);
    trayNotify('WorkspaceHQ', 'Refreshing after that change failed — the window may show stale data (see logs/).');
  },
});

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
  // cmd.exe has no backslash escape: in `\"` the backslash is literal and the quote
  // toggles quoting OFF, so anything after (&, |, …) runs as live shell syntax.
  // Doubling the quote is cmd's own escape and stays inert under cmd /k.
  const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
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
    if (proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], TASKKILL_OPTS);
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
    if (m?.proc?.pid) spawnSync('taskkill', ['/pid', String(m.proc.pid), '/f', '/t'], TASKKILL_OPTS);
    return true;
  }
  if (entry.proc?.pid) spawnSync('taskkill', ['/pid', String(entry.proc.pid), '/f', '/t'], TASKKILL_OPTS);
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
  // async + bounded (was an unbounded spawnSync over a 962-command scan: the window froze until it finished)
  const r = await gitActions.run(process.execPath, [path.join(COLLECTOR, 'spellbook.mjs')], { timeoutMs: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  if (r.status !== 0) return { error: r.timedOut ? 'the automations rescan took longer than 2 min — stopped' : (r.stderr || '').slice(0, 300) || 'scanner failed' };
  rebuildData();
  if (win && !win.isDestroyed()) win.reload();
  return { ok: true };
});
// Lightweight telemetry view for the palette / mini HUD (favorites + recency).
// v5 M4 (K-6): each entry also says how the spell's LAST cast ended — read from
// the newest casts[] entry (casts are pushed when they end), not persisted: the
// rollup only ever counts successes (the economy, collector/lib/spellcraft.mjs),
// so a spell that has only failed gets a view-only entry with zero counts.
// last_outcome 'ok'|'failed'|'channeled'|null · last_exit number|null ·
// last_outcome_at = that cast's started_at (last_cast stays the success watermark).
const CAST_OUTCOME = { resolved: 'ok', fizzled: 'failed', channeled: 'channeled' };
ipcMain.handle('hq:spell-telemetry', () => {
  const t = readTelemetry();
  const rollup = {};
  for (const [id, r] of Object.entries(t.rollup || {})) rollup[id] = { last_cast: r.last_cast, lifetime_casts: r.lifetime_casts, distinct_days: (r.distinct_days || []).length, last_outcome: null, last_exit: null, last_outcome_at: null };
  const seen = new Set();
  const casts = Array.isArray(t.casts) ? t.casts : [];
  for (let i = casts.length - 1; i >= 0; i--) {
    const c = casts[i];
    if (!c || typeof c.spell_id !== 'string' || seen.has(c.spell_id)) continue;
    seen.add(c.spell_id);
    const r = rollup[c.spell_id] || (rollup[c.spell_id] = { last_cast: null, lifetime_casts: 0, distinct_days: 0 });
    r.last_outcome = CAST_OUTCOME[c.outcome] || null;
    r.last_exit = Number.isFinite(c.exit_code) ? c.exit_code : null;
    r.last_outcome_at = typeof c.started_at === 'string' ? c.started_at : null;
  }
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
  try { updateTray(); } catch (e) { console.error('[tray] refresh failed', e); }   // v5 M4: keeps "Stop all running dev servers (N)" current
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
    proc.__hqStartedAt = Date.now();   // hq:live-state reports it, so a reloaded window knows how long it has run
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
    const r = spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], TASKKILL_OPTS);
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

// satellite IPC (quick-run palette)
ipcMain.handle('hq:show-main', () => { if (!win) createWindow(true); else win.show(); if (win) win.focus(); return true; });
ipcMain.handle('hq:kill-servers', () => {
  let n = 0;
  for (const [, proc] of activeDevServers) { if (proc && proc.pid) { spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], TASKKILL_OPTS); n++; } }
  activeDevServers.clear(); pushMachine();
  return n;
});

// Single-instance lock: a second launch (e.g. autostart + manual) just focuses the
// running window instead of opening a duplicate tray / racing the pipeline writers.
if (!app.requestSingleInstanceLock()) {
  appLog.secondary(); appLog.event('second-launch-exit', { argv: process.argv });   // this process loses the lock; the running app logs 'second-instance'
  app.quit();
} else {
  appLog.start({ version: app.getVersion(), electron: process.versions.electron, renderer: uiVersion(), argv: process.argv });   // + prev: what the last run wrote last
  app.on('second-instance', (_e, argv) => {
    appLog.event('second-instance', { argv });
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    else createWindow(true);
  });

  // Watch the data sidecar so the always-open UI refreshes itself when the scheduled
  // scan (register-task.ps1: logon +2min / daily 00:00) lands a new latest.json.
  // In-app writers (refresh runner, runScan, do-commit rescan) bake + reload
  // themselves and mark the write — the watcher must not echo them into a second
  // bake + reload; the defer/skip rules live in data-refresh.js createLatestWatcher.
  let latestWatch = null;
  function watchData() {
    try {
      latestWatch = dataRefreshMod.createLatestWatcher({
        isScanRunning: () => liveState.snapshot().scan.state === 'running',
        marker: selfWrite,
        onExternal: () => { rebuildData(); if (win && !win.isDestroyed()) win.reload(); updateTray(); },
      });
      watcher = fs.watch(DATA, (_evt, file) => latestWatch.onEvent(file));
    } catch (e) { console.error('watchData failed:', e); }
  }

  app.whenReady().then(() => {
    try { launchTools.sweepStale(); } catch {}   // crashed runs' per-launch MCP configs older than 24 h
    appLog.watchPower(powerMonitor); appLog.heartbeat();   // suspend / resume / shutdown + a 15-min 'alive' line (app-log.js)
    // Persist as the main dashboard: launch at login, hidden to tray — packaged or not; test instances never register
    require('./login-item').init({ app });
    // skip the launch bake when data.js is already newer than every input it is
    // baked from — the hidden autostart usually has nothing new, yet paid a
    // blocking child process before the window existed (bake-freshness.js)
    if (!bakeFreshness.dataJsFresh({ dataJs: path.join(DIR, 'data.js'), reportsDir: path.join(VAULT, '30_Areas', 'Workspace Status'), dataDir: DATA, bakeScript: path.join(DIR, 'build-data.mjs') })) rebuildData();
    else console.log('[build-data] launch bake skipped — data.js is newer than every input');
    require('./ui-prefs').init({ ipcMain, app, nativeTheme, BrowserWindow });   // v5 clean pass: hq:ui-prefs-*
    claudeHub = require('./claude-hub-host').init({ ipcMain, send: castSend, dataDir: DATA, appLog, vaultDir: VAULT });   // Claude Hub (spec 2026-10-13): index of every Claude Code session
    require('./claude-bridge-routes').setHub(claudeHub);   // claude.ai live sync: the extension's /claude/* bridge routes ask this Hub
  require('./claude-vault').init({ ipcMain, hub: claudeHub, dataDir: DATA, vaultDir: VAULT });   // Claude Hub H5: Save to vault (writes only on the owner's Save)
  require('./day-ribbon').init({ ipcMain, dataDir: DATA, hub: claudeHub, projectsOf: () => studioProjects().map((p) => p.path) });   // Today ribbon (IPC-CONTRACT hq:today:read): read on demand, data/today.json every 10 min
    const claudeChatEngine = require('./claude-chat').init({ ipcMain, send: castSend, app, hub: claudeHub, getProjects: studioProjects, appLog });   // Claude Hub H3 in-app chat (spec 2026-10-13 §8)
    require('./vault-open').init({ ipcMain, app, shell, dataDir: DATA, docsRoot: DOCS_ROOT, log: (s) => console.log(s) });   // Life › Notes: Open in Obsidian / Search for a scanned, Obsidian-registered vault (hq:vault-open)
    require('./pc-health-open').init({ ipcMain, shell, dataDir: DATA });   // System › Machine: Open in Explorer for a folder in the current disk breakdown (hq:pc-open-folder)
    require('./github-view').init({ ipcMain, shell, dataDir: DATA, collectorDir: COLLECTOR, runNode: runNodeAsync, rebuild: rebuildData });
    require('./accounts-view').init({ ipcMain, shell, dataDir: DATA, collectorDir: COLLECTOR, runNode: runNodeAsync, rebuild: rebuildData });   // Projects › Accounts: Vercel + Supabase through the owner's CLI logins (hq:accounts-refresh, hq:accounts-open)   // Projects › GitHub: refresh through the owner's gh login + open a listed github.com link (hq:github-refresh, hq:github-open)   // System › Machine: Open in Explorer for a folder in the current disk breakdown (hq:pc-open-folder)
    const moneyApi = require('./money').init({ ipcMain, dataDir: DATA, getWin: () => win });   // money space: data/money/state.json (IPC-CONTRACT hq:money:*)
    const cosmosCtl = require('./cosmos').init({ ipcMain, dataDir: DATA, getWin: () => win, castSend });   // Cosmos space: data/cosmos/ (IPC-CONTRACT hq:cosmos:*)
    const useLogApi = require('./use-log').init({ ipcMain, appLog });   // usage counter: hq:use → one 'use' line in the day log (IPC-CONTRACT hq:use)
    require('./money-access').init({ ipcMain, dataDir: DATA });   // Settings › "Claude sessions may read Money (words only)": the ONLY writer of data/money/access.json, off by default (IPC-CONTRACT hq:money-access:*)
    require('./reach').init({ ipcMain, dataDir: DATA, exePath: process.execPath });   // Settings › Reach: whether each door is open (IPC-CONTRACT hq:reach:read)
    let sessionsApi = null, briefActApi = null;   // the sessions board is created after the Brief (below): the Brief reads it lazily
    const briefApi = require('./brief').init({ ipcMain, dataDir: DATA, money: moneyApi, hub: claudeHub, liveState, notify: trayNotify, onBrief: (b, fs) => { trayBrief.set(b, fs); updateTray(); }, getWins: () => BrowserWindow.getAllWindows(), getSessionBoard: () => (sessionsApi ? sessionsApi._board() : null), decorate: (b) => (briefActApi ? briefActApi.decorate(b) : b), ledger: require('./brief-ledger').create({ dataDir: DATA }) });   // Operator Brief: data/brief.json (IPC-CONTRACT hq:brief:*)
    briefActApi = require('./brief-act').init({ ipcMain, getBrief: briefApi.current, sources: briefApi.sources, applyDone, moneyApply: moneyApi.apply, openFolder: (id) => (sessionsApi ? sessionsApi.openFolder(id) : { error: 'the sessions board is not running.' }), useMark: useLogApi.mark, appLog: (l) => appLog.event('brief-act', { note: l }), onActed: briefApi.recomputeNow });   // act in place on a Brief row (IPC-CONTRACT hq:brief:act)
    intentInbox = require('./intent-inbox').init({ dataDir: DATA, brief: briefApi, log: (l) => appLog.event('intent', { note: l }) });   // Brief mailbox: a session may dismiss one top-three Brief row through data/intents/ (CONTRACT "data/intents"; hq_brief_dismiss)
    require('./delivery-check').init({ ipcMain, dataDir: DATA, resolveProjectPath, devServers: activeDevServers, latest });   // Client delivery check: phone size + ar/fr/en against a LOCAL dev server only; data/delivery/ (IPC-CONTRACT hq:delivery-check:*)
    require('./delivery').init({ ipcMain, dataDir: DATA, resolveProjectPath });   // Client delivery card on each project page: data/delivery.json (IPC-CONTRACT hq:delivery:*)
    require('./delivery-clients').init({ ipcMain, dataDir: DATA, resolveProjectPath });   // Projects > Clients: one read-only summary row per client job (IPC-CONTRACT hq:delivery:clients)
    sessionsApi = require('./sessions-board').init({ ipcMain, app, hub: claudeHub, getWins: () => BrowserWindow.getAllWindows(), shell, appLog, repoRoot: path.join(DIR, '..'), onBoard: (b) => briefApi.onBoard(b) });   // Claude › Sessions board + Resume (IPC-CONTRACT hq:sessions-board:*)
    navBridge = require('./nav-bridge').init({ ipcMain, getWin: () => win, createWindow });   // v5 clean pass: hq:open-at (+ tray openAt)
    require('./quick-targets').init({ ipcMain, latest, trayBrief, showMainAt, runScan, log: (f) => useLogApi.mark(f.surface, f.action), isCastSender: (e) => !!castWin && !castWin.isDestroyed() && e.sender === castWin.webContents });   // quick-run palette: Needs-you rows + Go mode (IPC-CONTRACT hq:quick:*); only the cast window may call
    require('./grab-routes').setDeps({ dataDir: DATA, grabRoot: path.join(app.getPath('downloads'), 'WorkspaceHQ', 'grabs'), addClip: (a) => cosmosCtl.addClip(a), log: (m) => console.log(m) });   // Bridge 0.8.0: POST /library/grab (a grabbed file also lands in Cosmos as a clip; CONTRACT "Local bridge routes")
    require('./assist-bridge-routes').setDeps({ dataDir: DATA, dialog, openAt: (r) => showMainAt(r), log: (m) => console.log(m) });   // Bridge 0.7.0: POST /pair (native dialog), GET /assist/brief, POST /assist/open (CONTRACT "Local bridge routes")
    createWindow(!START_HIDDEN);
    createTray();
    watchData();
    watchQuestBoard();   // two-way: ticking a quest in Obsidian completes it here
    watchDailyNotes();   // two-way for daily notes (`wq:<id>` tasks)
    bridge = startBridge({ dataDir: DATA, onLive: pushBrowserTab });   // browser extension ingest
    startMachineSampler();   // live CPU/RAM/servers for the main window
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
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(true); });
  });

  // Keep the tray alive on Windows/Linux when all windows close (close-to-tray).
  app.on('window-all-closed', () => { if (process.platform === 'darwin') return; /* stay resident in tray */ });
  app.on('before-quit', () => {
    app.isQuitting = true;
    if (machineTimer) clearInterval(machineTimer);
    try { globalShortcut.unregisterAll(); } catch {}
    if (latestWatch) try { latestWatch.close(); } catch {}   // no stray debounce timer baking mid-quit
    for (const w of [watcher, qbWatcher, dailyWatcher]) if (w) try { w.close(); } catch {}
    if (bridge) try { bridge.stop(); } catch {}
    try { intentInbox && intentInbox.stop(); } catch {}   // removes our own heartbeat, so a session sees 'the app is closed' at once
    try { claudeHub && claudeHub.stop(); } catch {}   // the Hub releases its db lock on stdin close
    // no orphaned incantations: kill any live cast trees on the way out
    for (const [, entry] of castRegistry) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.proc?.pid) spawnSync('taskkill', ['/pid', String(entry.proc.pid), '/f', '/t'], TASKKILL_OPTS);
    }
    castRegistry.clear();
    // same for live dev servers and in-flight Claude sessions — no orphans on quit
    for (const [, proc] of activeDevServers) { if (proc?.pid) try { spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], TASKKILL_OPTS); } catch {} }
    activeDevServers.clear();
    try { claudeSessions.killAll(); } catch {}
    try { launchTools.cleanup(); } catch {}   // only per-launch MCP configs older than 24 h; a session still open keeps its tools
  });
}
