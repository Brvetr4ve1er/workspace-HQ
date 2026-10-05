// Deep links into the main window ("open Projects sorted by uncommitted", "open
// project X") for satellites: mini HUD count buttons, tray items. IPC-CONTRACT
// "Pending — v5 clean pass": hq:open-at(route) → bool · push hq:navigate(route).
//   route = { tab, sub?, projectId?, sort? }
//   tab/sub /^[a-z]{2,16}$/ · projectId /^[\w.-]{1,80}$/ · sort ∈ SORTS
// Shows + focuses the main window (creating it if needed); if the page is still
// loading, the push waits for did-finish-load. The v3 renderer ignores the push.
//
// init({ ipcMain, getWin, createWindow })
// SKELETON (F1): validates nothing and refuses; F6 implements it (nav-bridge.test.mjs).
const SORTS = ['worst', 'dirty', 'recent', 'name'];

function cleanRoute() { return null; }

function init({ ipcMain }) {
  ipcMain.handle('hq:open-at', () => false);
}

module.exports = { init, cleanRoute, SORTS };
