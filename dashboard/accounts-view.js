// Projects › Accounts — Vercel + Supabase (IPC-CONTRACT 2026-10-26 Connected accounts).
// hq:accounts-refresh() → the current data/accounts.json object | { error }
//   runs collector/accounts.mjs --max-age=60 (the owner's own CLI logins, read-only), one run at a time.
// hq:accounts-open(url) → true | { error }
//   same trust model as hq:github-open: only a URL listed verbatim in the CURRENT sidecar, https,
//   on vercel.com, a *.vercel.app deployment, or supabase.com, is handed to shell.openExternal.
const fs = require('node:fs');
const path = require('node:path');
const { createRefresher } = require('./github-view');

const HOST_OK = (h) => h === 'vercel.com' || h === 'supabase.com' || /^[a-z0-9-]+\.vercel\.app$/.test(h);

function listedUrls(a) {
  const urls = new Set();
  const add = (u) => { if (typeof u === 'string' && u) urls.add(u); };
  const v = a && a.vercel, s = a && a.supabase;
  for (const p of (v && Array.isArray(v.projects) ? v.projects : [])) { if (!p) continue; add(p.dashboard); add(p.prod && p.prod.url); add(p.latest && p.latest.url); }
  for (const d of (v && Array.isArray(v.deploys) ? v.deploys : [])) add(d && d.url);
  for (const p of (s && Array.isArray(s.projects) ? s.projects : [])) add(p && p.dashboard);
  return urls;
}

function createOpener({ readAccounts, openExternal }) {
  return async function openUrl(u) {
    if (typeof u !== 'string' || !u || u.length > 2048) return { error: 'not a link' };
    if (!listedUrls(readAccounts()).has(u)) return { error: 'refused: that link is not in the current accounts snapshot' };
    let parsed;
    try { parsed = new URL(u); } catch { return { error: 'refused: not a valid link' }; }
    if (parsed.protocol !== 'https:' || !HOST_OK(parsed.host)) return { error: 'refused: only Vercel and Supabase links open' };
    try { await openExternal(u); } catch (e) { return { error: String((e && e.message) || e) }; }
    return true;
  };
}

function init({ ipcMain, shell, dataDir, collectorDir, runNode, rebuild }) {
  const file = path.join(dataDir, 'accounts.json');
  const readAccounts = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const refresh = createRefresher({ run: () => runNode(path.join(collectorDir, 'accounts.mjs'), ['--max-age=60']), readGithub: readAccounts, rebuild });
  const open = createOpener({ readAccounts, openExternal: (u) => shell.openExternal(u) });
  ipcMain.handle('hq:accounts-refresh', () => refresh());
  ipcMain.handle('hq:accounts-open', (_e, u) => open(u));
  return { refresh, open };
}

module.exports = { init, createOpener, listedUrls, HOST_OK };
