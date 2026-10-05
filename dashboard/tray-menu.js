// The tray menu as data. main.js buildTrayMenu() hands its state and actions in
// and builds the native menu from what comes back, so the layout is testable
// without Electron.
//   trayTemplate(state, actions) → Electron MenuItemConstructorOptions[]
//     state   = { scan (latest.json or null), hudVisible, spells:[{id,name,icon}] }
//     actions = { show, scan, toggleHud, quickRun, summon, openAutomations, cast(id),
//                 pushAll, snapshotDirty, killServers, openUrgent, quit }
//   statusLine(scan) → "lv 8 · 34 uncommitted · 2 secrets" (disabled first item)
// Design (Satellites board): status line · Show · Scan now (uses Claude) · Mini HUD ✓ ·
// Quick-run… · Summon… · Run ▸ · ─ · Quick actions · ─ · Quit.
//
// SKELETON (F1): not used by main.js yet; M4 (Phase 4) switches buildTrayMenu
// over once tray-menu.test.mjs passes.
function statusLine() { return ''; }
function trayTemplate() { return []; }

module.exports = { trayTemplate, statusLine };
