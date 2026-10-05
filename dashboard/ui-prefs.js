// UI preferences held by MAIN, so the main window and every satellite (mini HUD,
// quick-run, record panel, snip overlay, summon, shards) share one theme and one
// reduce-motion switch. IPC-CONTRACT "Pending — v5 clean pass":
//   hq:ui-prefs-get → prefs · hq:ui-prefs-set(patch) → prefs · push hq:ui-prefs
// prefs = { theme: 'dark'|'light'|'os', resolved: 'dark'|'light', reduceMotion: bool }
// Persisted in <userData>/ui-prefs.json. 'os' resolves via nativeTheme and is
// re-broadcast when the OS theme changes.
//
// SKELETON (F1): handlers answer with the defaults; F6 implements persistence,
// validation and broadcasting (with ui-prefs.test.mjs).
const DEFAULTS = Object.freeze({ theme: 'dark', reduceMotion: false });

function view(prefs) {
  return { theme: prefs.theme, resolved: prefs.theme === 'light' ? 'light' : 'dark', reduceMotion: !!prefs.reduceMotion };
}

function init({ ipcMain }) {
  const prefs = { ...DEFAULTS };
  ipcMain.handle('hq:ui-prefs-get', () => view(prefs));
  ipcMain.handle('hq:ui-prefs-set', () => view(prefs));
  return { get: () => view(prefs) };
}

module.exports = { init, DEFAULTS, view };
