// UI preferences held by MAIN, so the main window and every satellite
// (quick-run, record panel, snip overlay) share one theme and one
// reduce-motion switch. IPC-CONTRACT "Pending — v5 clean pass":
//   hq:ui-prefs-get → prefs · hq:ui-prefs-set(patch) → prefs · push hq:ui-prefs
// prefs = { theme: 'dark'|'light'|'os', resolved: 'dark'|'light', reduceMotion: bool }
// Persisted in <userData>/ui-prefs.json (atomic tmp + rename). 'os' resolves via
// nativeTheme at READ time and is re-broadcast when the OS theme changes.
//
// init({ ipcMain, app, nativeTheme, BrowserWindow }) → { get }
// - the file and every set(patch) go through the same sanitize(): unknown keys and
//   bad values are dropped key by key, so a half-valid file keeps its valid half
//   and a corrupt/missing one falls back to DEFAULTS.
// - set() that changes nothing writes nothing and pushes nothing.
// - a failed write keeps the change in memory for this session (the toggle still
//   works; it just won't survive a restart) — logged, never thrown at the renderer.
const fs = require('fs');
const path = require('path');

const THEMES = ['dark', 'light', 'os'];
const DEFAULTS = Object.freeze({ theme: 'dark', reduceMotion: false });

// Whitelist + enum check. Returns only the keys that passed — never throws.
function sanitize(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  if (THEMES.includes(obj.theme)) out.theme = obj.theme;
  if (typeof obj.reduceMotion === 'boolean') out.reduceMotion = obj.reduceMotion;
  return out;
}

// nativeTheme is optional so the pure view stays testable; without it 'os' reads dark.
function view(prefs, nativeTheme) {
  const resolved = prefs.theme === 'light' ? 'light'
    : prefs.theme === 'os' ? (nativeTheme && !nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
    : 'dark';
  return { theme: prefs.theme, resolved, reduceMotion: !!prefs.reduceMotion };
}

function load(file) {
  try { return { ...DEFAULTS, ...sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))) }; }
  catch { return { ...DEFAULTS }; }   // missing or corrupt → defaults (rewritten on next change)
}

function init({ ipcMain, app, nativeTheme, BrowserWindow }) {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'ui-prefs.json');
  const prefs = load(file);
  const get = () => view(prefs, nativeTheme);

  const persist = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ theme: prefs.theme, reduceMotion: prefs.reduceMotion }, null, 1));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('[ui-prefs] persist failed (kept in memory)', e); }
  };
  // EVERY window, not castSend's three: satellites (snip, record panel) theme too.
  const broadcast = () => {
    const payload = get();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w || w.isDestroyed() || !w.webContents || w.webContents.isDestroyed()) continue;
      try { w.webContents.send('hq:ui-prefs', payload); } catch { /* window mid-teardown */ }
    }
  };
  const set = (patch) => {
    const clean = sanitize(patch);
    const changed = Object.keys(clean).filter((k) => clean[k] !== prefs[k]);
    if (!changed.length) return get();
    Object.assign(prefs, clean);
    persist();
    broadcast();
    return get();
  };

  ipcMain.handle('hq:ui-prefs-get', () => get());
  ipcMain.handle('hq:ui-prefs-set', (_e, patch) => set(patch));
  // 'updated' also fires for high-contrast/inverted changes; a duplicate push is harmless.
  nativeTheme?.on?.('updated', () => { if (prefs.theme === 'os') broadcast(); });
  return { get };
}

module.exports = { init, DEFAULTS, THEMES, view, sanitize };
