// "What is running right now", answerable after a reload. Main reloads the
// window after most writes, so the renderer can't keep running dev servers,
// casts or a scan in memory — it asks here instead. IPC-CONTRACT "Pending —
// v5 clean pass": hq:live-state · push hq:scan-status.
//
// init({ ipcMain, send, devServers, casts, readSpellbook }) where
//   devServers = main.js activeDevServers (Map id → ChildProcess; dev-start stamps proc.__hqStartedAt)
//   casts      = main.js castRegistry (Map spellId → { proc, castId, startedAt, chain? })
//   send(channel, payload) = main.js castSend (main window, mini HUD, quick-run)
// returns { scanBegin() → bool, scanEnd(code, err?), snapshot() }:
//   scanBegin() is false while a scan is already running (runScan must not start a second pipeline)
//
// SKELETON (F1): answers "nothing running"; F6 implements it (with live-state.test.mjs).
function init({ ipcMain }) {
  const scan = { state: 'idle', startedAt: null, endedAt: null, code: null };
  const snapshot = () => ({ dev: [], casts: [], scan: { ...scan } });
  ipcMain.handle('hq:live-state', () => snapshot());
  return { scanBegin: () => true, scanEnd: () => {}, snapshot };
}

module.exports = { init };
