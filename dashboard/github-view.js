// Projects › GitHub (IPC-CONTRACT 2026-10-26 GitHub view).
// hq:github-refresh() → the current data/github.json object | { error }
//   runs collector/github.mjs --max-age=60 (the owner's own gh login, read-only), one run at a time.
// hq:github-open(url) → true | { error }
//   same trust model as hq:pc-open-folder: only a URL listed verbatim in the CURRENT sidecar,
//   https and host exactly github.com, is handed to shell.openExternal.
const fs = require('node:fs');
const path = require('node:path');

function listedUrls(gh) {
  const urls = new Set();
  if (!gh || typeof gh !== 'object') return urls;
  for (const k of ['repos', 'waiting', 'mine', 'issues']) {
    for (const row of Array.isArray(gh[k]) ? gh[k] : []) if (row && typeof row.url === 'string') urls.add(row.url);
  }
  return urls;
}

function createOpener({ readGithub, openExternal }) {
  return async function openUrl(u) {
    if (typeof u !== 'string' || !u || u.length > 2048) return { error: 'not a link' };
    if (!listedUrls(readGithub()).has(u)) return { error: 'refused: that link is not in the current GitHub snapshot' };
    let parsed;
    try { parsed = new URL(u); } catch { return { error: 'refused: not a valid link' }; }
    if (parsed.protocol !== 'https:' || parsed.host !== 'github.com') return { error: 'refused: only github.com links open' };
    try { await openExternal(u); } catch (e) { return { error: String((e && e.message) || e) }; }
    return true;
  };
}

// run = () => Promise (the collector run); concurrent callers share the one in flight
function createRefresher({ run, readGithub, rebuild }) {
  let inFlight = null;
  return function refresh() {
    if (!inFlight) {
      inFlight = (async () => {
        let err = null;
        try { await run(); } catch (e) { err = String((e && e.message) || e); }
        if (!err && rebuild) { try { rebuild(); } catch { /* the bake is best effort; the answer below is current */ } }
        const gh = readGithub();
        return gh || { error: err || 'no GitHub snapshot yet' };
      })().finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}

function init({ ipcMain, shell, dataDir, collectorDir, runNode, rebuild }) {
  const file = path.join(dataDir, 'github.json');
  const readGithub = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const refresh = createRefresher({ run: () => runNode(path.join(collectorDir, 'github.mjs'), ['--max-age=60']), readGithub, rebuild });
  const open = createOpener({ readGithub, openExternal: (u) => shell.openExternal(u) });
  ipcMain.handle('hq:github-refresh', () => refresh());
  ipcMain.handle('hq:github-open', (_e, u) => open(u));
  return { refresh, open };
}

module.exports = { init, createOpener, createRefresher, listedUrls };
