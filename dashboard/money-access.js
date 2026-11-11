// money access — main side. The ONE writer of <dataDir>/money/access.json (gitignored with the rest of data/money/):
//   { v:1, on:boolean, at:ISO }   the owner's switch "Claude sessions may read Money (words only)". OFF on a fresh install.
// The MCP tool hq_money_today (mcp/workspacehq/money-read.mjs) reads this file first and only ever answers words while
// on is the boolean true; nothing but this module writes it.
// IPC-CONTRACT rows: hq:money-access:read · hq:money-access:set.
//
//   create({ dataDir, now?, auditRead?, fsMod? }) → { read, set, file }
//     read()    → { on, lastAskedAt|null } | { error }     lastAskedAt = the newest audit line of tool hq_money_today (names + time only)
//     set(on)   → { on } | { error }                        a strict boolean only; anything else is refused before any IO
//   init({ ipcMain, dataDir, auditRead? }) → { read, set }
//
// - a corrupt access.json (not JSON, not an object, `on` not a boolean) reads as OFF and is quarantined to
//   access.json.corrupt (-2, -3 …) by THIS module only; the MCP reader just treats it as off and never touches it.
// - writes are synchronous tmp + rename (a crash mid-write leaves the previous file intact); setting the value it already
//   has changes nothing (the `at` stamp is the time of the last real change).
// - auditRead(dataDir) → { entries } (or a promise of it): injected for tests; by default dashboard/assist-audit.mjs, loaded lazily.
// - every handler resolves a plain object, never throws at the renderer.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const TOOL = 'hq_money_today';
const VERSION = 1;

let auditLib = null;
function defaultAuditRead(dataDir) {
  if (!auditLib) auditLib = import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href);
  return auditLib.then((m) => m.read(dataDir));
}

// the newest `at` among the audit lines for the money tool, as written (ISO), or null
function lastAsked(entries) {
  let best = null, bestMs = -Infinity;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.tool !== TOOL || typeof e.at !== 'string') continue;
    const ms = Date.parse(e.at);
    if (Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = e.at; }
  }
  return best;
}

function create({ dataDir, now = () => new Date(), auditRead = defaultAuditRead, fsMod = fs } = {}) {
  const dir = path.join(dataDir, 'money'), file = path.join(dir, 'access.json');

  // → { on } (never throws). A corrupt file is moved aside and reads as off.
  function readOn() {
    let raw;
    try { raw = fsMod.readFileSync(file, 'utf8'); }
    catch (e) { return { on: false, absent: !!e && e.code === 'ENOENT' }; }
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.on !== 'boolean') throw new Error('not an access object');
      return { on: v.on, at: typeof v.at === 'string' ? v.at : '' };
    } catch (e) {
      // never overwrite an earlier quarantine: .corrupt, then .corrupt-2, -3 …
      let to = file + '.corrupt';
      for (let i = 2; fsMod.existsSync(to) && i < 1000; i++) to = file + '.corrupt-' + i;
      try { fsMod.renameSync(file, to); } catch { /* best effort: a read never throws */ }
      console.error(`[money-access] corrupt access.json quarantined to ${path.basename(to)} — ${e.message}`);
      return { on: false };
    }
  }

  async function read() {
    try {
      const { on } = readOn();
      let lastAskedAt = null;
      try {
        const r = await auditRead(dataDir);
        lastAskedAt = lastAsked(r && r.entries);
      } catch { lastAskedAt = null; }   // an unreadable audit log is "never" in words, not a failure of the switch
      return { on, lastAskedAt };
    } catch (e) { return { error: 'could not read the Money access switch — ' + ((e && e.message) || e) }; }
  }

  async function set(on) {
    if (typeof on !== 'boolean') return { error: 'the switch is on or off — nothing else is accepted.' };
    try {
      const cur = readOn();   // also quarantines a corrupt file before it is replaced
      if (cur.absent ? on === false : (cur.on === on && cur.at)) return { on };   // already so: nothing to write (a fresh install stays file-less while off)
      fsMod.mkdirSync(dir, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      try {
        fsMod.writeFileSync(tmp, JSON.stringify({ v: VERSION, on, at: now().toISOString() }, null, 1));
        fsMod.renameSync(tmp, file);
      } catch (e) { try { fsMod.unlinkSync(tmp); } catch { /* nothing to clean */ } throw e; }
      return { on };
    } catch (e) { return { error: 'not saved — could not write the Money access switch: ' + ((e && e.message) || e) }; }
  }

  return { read, set, file };
}

function init({ ipcMain, dataDir, auditRead } = {}) {
  const m = create({ dataDir, auditRead });
  ipcMain.handle('hq:money-access:read', () => m.read());
  ipcMain.handle('hq:money-access:set', (_e, on) => m.set(on));
  return { read: m.read, set: m.set };
}

module.exports = { create, init, TOOL, lastAsked };
