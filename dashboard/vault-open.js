// Life › Notes — Open in Obsidian / Search for one of the scan's vaults (IPC-CONTRACT 2026-10-27 Life › Notes).
// hq:vault-open(name, how) → {ok, how} | {error}
//   name: a vault listed in the CURRENT data/latest.json inventory.vaults; its folder must be a vault Obsidian has
//   registered (obsidian.json), and the link names it by Obsidian's own vault id, so two vaults with the same folder
//   name can't be confused. Only obsidian://open?vault=<id> or obsidian://search?vault=<id> is ever opened.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();

// Obsidian's own vault registry: [{ id, path }]
function obsidianVaults(appData) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(appData, 'obsidian', 'obsidian.json'), 'utf8'));
    return Object.entries((j && j.vaults) || {}).filter(([, v]) => v && typeof v.path === 'string').map(([id, v]) => ({ id, path: v.path }));
  } catch { return []; }
}

function createVaultOpen({ readLatest, docsRoot, appData, openExternal, protocolName = () => 'Obsidian', env = {}, log = () => {} }) {
  return async function vaultOpen(name, how) {
    if (how !== 'open' && how !== 'search') return { error: 'a vault opens or searches in Obsidian, nothing else' };
    if (typeof name !== 'string' || !name || name.length > 200) return { error: 'not a vault name' };
    const inv = ((readLatest() || {}).inventory) || {};
    const v = (Array.isArray(inv.vaults) ? inv.vaults : []).find((x) => x && x.name === name && typeof x.path === 'string' && x.path);
    if (!v) return { error: 'refused: not a vault in the latest scan' };
    const abs = path.isAbsolute(v.path) ? v.path : path.join(docsRoot, v.path);
    let hasObsidian = false;
    try { hasObsidian = !!protocolName('obsidian://'); } catch { hasObsidian = false; }
    if (!hasObsidian) return { error: 'Obsidian is not installed (no obsidian:// handler)' };
    const reg = obsidianVaults(appData).find((r) => norm(r.path) === norm(abs));
    if (!reg) return { error: 'Obsidian doesn\'t know this vault yet — in Obsidian use "Open folder as vault" and pick ' + abs };
    const url = 'obsidian://' + how + '?vault=' + encodeURIComponent(reg.id);
    if (env.HQ_DRY_LAUNCH === '1') { log('[dry-open] ' + url); return { ok: true, how, dry: true }; }
    try { await openExternal(url); } catch (e) { return { error: String((e && e.message) || e).slice(0, 300) }; }
    return { ok: true, how };
  };
}

function init({ ipcMain, app, shell, dataDir, docsRoot, log = () => {} }) {
  const open = createVaultOpen({
    readLatest: () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8')); } catch { return null; } },
    docsRoot, appData: app.getPath('appData'), openExternal: (u) => shell.openExternal(u), env: process.env, log,
    protocolName: (u) => (app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : ''),
  });
  ipcMain.handle('hq:vault-open', (_e, name, how) => open(name, how));
  return open;
}

module.exports = { obsidianVaults, createVaultOpen, init };
