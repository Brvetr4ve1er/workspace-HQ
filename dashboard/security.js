// Security space, main side: the ten hq:security:* IPC channels. Spec docs/superpowers/specs/2026-11-11-security-space-design.md.
//
// init({ ipcMain, getWin, dataDir, safeStorage, shell, clipboard, appLog, deps? }) -> { store, vault, scanNow(), dispose() }
//   getWin: () => the MAIN window (like cosmos.js and nav-bridge.js). EVERY channel first checks event.sender === getWin().webContents and
//   otherwise answers { error: 'not available here' }: the cast palette window loads the same preload and must never reach read (decrypted
//   identity labels), refresh, edit, add, trash or copy.
//   deps (tests / gates only): { core, spawn, fetchRange, env, now, randomBytes, existsSync, fs, scanDirs, timers, timeoutMs, maxBytes, execPath }.
//
// hq:security:read -> { settings, map, owner, snapshots, status, cliFound, vaultExists }
// hq:security:refresh { passphrase, checkBreaches } -> { ok, accounts, breachChecked, notes } | { error }
// hq:security:settings { vaultPath?, keyFilePath?, cliPath? } -> { ok } | { error }
// hq:security:edit { id, patch } -> { ok } | { error }          hq:security:add-manual { title, host } -> { ok, id } | { error }
// hq:security:add-identity { kind, value } -> { ok, ref } | { error }      hq:security:walkthrough { stepId, done } -> { ok } | { error }
// hq:security:scan-exports -> { files }                          hq:security:trash-export { name, dir } -> { ok } | { error }
// hq:security:copy { text } -> { ok }   (cleared after 30 s only if the clipboard still holds the same text; honest limit: this does not
//                                        remove the text from Windows clipboard history or a cloud clipboard)
//
// THE PASSPHRASE: it arrives in the refresh argument and is handed straight to the vault module. No handler passes its arguments to appLog;
// the day-log lines carry fixed words and counts only. Refresh is NEVER at boot, never on a timer, never from MCP, the Bridge or a session:
// the only timer here is the cheap name-only export / conflict scan (60 s after start, then every 6 h).
const os = require('node:os');
const path = require('node:path');
const nodeFs = require('node:fs');
const { create: createStore } = require('./security-store');
const { create: createVault } = require('./security-vault');

const CHANNELS = ['read', 'refresh', 'settings', 'edit', 'add-manual', 'add-identity', 'walkthrough', 'scan-exports', 'trash-export', 'copy'];
const FIRST_SCAN_MS = 60_000;
const SCAN_EVERY_MS = 6 * 60 * 60 * 1000;
const CLIP_CLEAR_MS = 30_000;
const MAX_COPY = 1024;
const DENIED = { error: 'not available here' };

// safeStorage -> the store's crypto contract. Base64 in, base64 out; null whenever the OS keystore is unavailable (then labels are null
// and no identity ref is made - never plaintext).
function makeCrypto(safeStorage) {
  const usable = () => { try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; } };
  return {
    encrypt(str) { try { return usable() ? safeStorage.encryptString(String(str)).toString('base64') : null; } catch { return null; } },
    decrypt(b64) { try { return usable() ? safeStorage.decryptString(Buffer.from(String(b64), 'base64')) : null; } catch { return null; } },
  };
}

function defaultScanDirs(env) {
  if (env.HQ_SECURITY_SCAN_DIRS) return String(env.HQ_SECURITY_SCAN_DIRS).split(path.delimiter).filter(Boolean);   // gates
  const home = os.homedir();
  return ['Downloads', 'Desktop', 'Documents'].map((d) => path.join(home, d));
}

function init({ ipcMain, getWin, dataDir, safeStorage, shell, clipboard, appLog, deps = {} } = {}) {
  const env = deps.env || process.env;
  const timers = deps.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const store = createStore({ dataDir, crypto: makeCrypto(safeStorage), now: deps.now, randomBytes: deps.randomBytes });
  let corePromise = null;
  const getCore = () => {
    if (deps.core) return Promise.resolve(deps.core);
    if (!corePromise) corePromise = import('./security-core.mjs').catch(() => null);
    return corePromise;
  };
  const vault = createVault({
    store, getCore, spawn: deps.spawn, fetchRange: deps.fetchRange, now: deps.now, randomBytes: deps.randomBytes,
    existsSync: deps.existsSync, fs: deps.fs, env, timeoutMs: deps.timeoutMs, maxBytes: deps.maxBytes, execPath: deps.execPath, allowScriptCli: deps.allowScriptCli === true,
    trash: shell && typeof shell.trashItem === 'function' ? (p) => shell.trashItem(p) : null,
    log: (note) => { try { appLog && appLog.event('security', { note }); } catch { /* never blocks */ } },
  });
  const logEvent = (fields) => { try { appLog && appLog.event('security', fields); } catch { /* never blocks */ } };
  getCore().then((c) => { if (c) store.attachCore(c); }).catch(() => {});   // status counts follow owner edits once the engine is loaded
  const scanDirs = () => deps.scanDirs || defaultScanDirs(env);

  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
      const wc = w.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
      return !!event && event.sender === wc;
    } catch { return false; }
  };
  // arguments are NEVER logged; a throw answers a fixed word, not the message
  const handle = (name, fn) => ipcMain.handle('hq:security:' + name, async (event, arg) => {
    if (!fromMain(event)) return { ...DENIED };
    try { return await fn(arg && typeof arg === 'object' ? arg : {}); } catch { return { error: 'security action failed' }; }
  });

  function scanNow() {
    try {
      const files = vault.scanExports({ dirs: scanDirs() });
      const conflicts = vault.scanConflicts(store.readSettings().vaultPath);
      store.setScanResult({ exportsFound: files.length, conflicts });
      return { files, conflicts };
    } catch { return { files: [], conflicts: 0 }; }
  }

  handle('read', () => {
    const data = store.read();
    return { ...data, cliFound: !!vault.findCli(), vaultExists: !!(data.settings.vaultPath && (deps.existsSync || nodeFs.existsSync)(data.settings.vaultPath)) };
  });
  handle('refresh', async (a) => {
    const r = await vault.refresh({ passphrase: a.passphrase, checkBreaches: a.checkBreaches === true });
    if (r && r.ok) logEvent({ note: 'refresh finished', accounts: Array.isArray(r.accounts) ? r.accounts.length : 0, breachChecked: !!r.breachChecked });
    else logEvent({ note: 'refresh did not finish' });
    return r;
  });
  handle('settings', (a) => store.setSettings(a));
  handle('edit', (a) => store.editAccount(a.id, a.patch));
  handle('add-manual', (a) => store.addManual({ title: a.title, host: a.host }));
  handle('add-identity', (a) => store.addIdentity({ kind: a.kind, value: a.value }));
  handle('walkthrough', (a) => store.setWalkthrough(a.stepId, a.done));
  handle('scan-exports', () => { const { files } = scanNow(); return { files }; });
  handle('trash-export', async (a) => {
    const r = await vault.trashExport(a.name, a.dir);
    if (r && r.ok) scanNow();   // the status count follows the list
    return r;
  });

  let clipTimer = null;
  handle('copy', (a) => {
    if (typeof a.text !== 'string' || !a.text || a.text.length > MAX_COPY) return { error: 'nothing to copy' };
    clipboard.writeText(a.text);
    if (clipTimer) timers.clearTimeout(clipTimer);
    let held = a.text;
    clipTimer = timers.setTimeout(() => {
      clipTimer = null;
      try { if (clipboard.readText() === held) clipboard.clear(); } catch { /* the clipboard is gone */ }   // left alone when the owner copied something else
      held = null;
    }, CLIP_CLEAR_MS);
    if (clipTimer && clipTimer.unref) clipTimer.unref();
    return { ok: true };
  });

  const first = timers.setTimeout(scanNow, FIRST_SCAN_MS);
  const every = timers.setInterval(scanNow, SCAN_EVERY_MS);
  if (first && first.unref) first.unref();
  if (every && every.unref) every.unref();

  return {
    store, vault, scanNow,
    dispose() { try { timers.clearTimeout(first); timers.clearInterval(every); if (clipTimer) timers.clearTimeout(clipTimer); } catch { /* done */ } },
  };
}

module.exports = { init, makeCrypto, CHANNELS };
