// Reach — whether each door to the assistant is open (spec: "assistant-rulebook", part C). One row per door, each ending in its one
// missing step and who takes it. Read-only, bounded, honest: a probe that can't answer gives ok:null ("unknown"), never a guess.
// It prints counts, key presence and times — never file contents, values or command lines (process command lines are matched in memory
// and dropped; ~/.claude.json is parsed in memory for key presence only).
//
//   create({ dataDir, home?, exePath?, serverPath?, stateFile?, probes?, now?, probeTimeoutMs? }) → { read() }
//   read() → { at, rows: [{ id: 'phone-door'|'user-scope'|'bridge'|'tray-icon'|'calls', ok: true|false|null, detail, step?, who: 'owner'|'app', copy? }] }
//   init({ ipcMain, dataDir, exePath, ... }) → the same object; registers ipcMain.handle('hq:reach:read')
//   parseNotifyIcons(regText, exePath) → true | false | null   (the tray row's registry parser, exported for tests)
//
// probes (all injectable; the defaults are Windows-only and bounded by a timeout):
//   processes() → [{ pid, started?, cmd }]   isAlive(pid) → bool   tray(exePath) → true|false|null   bootTime() → ms
// Liveness is by pid, never by a state word in a file: a state file that says "running" for a pid that is gone reads as not running.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PROBE_MS = 9000;
const WEEK_MS = 7 * 24 * 3600e3;
const PHONE_COPY = 'claude remote-control';
const EXT_ORIGIN = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]{1,64}$/i;   // bridge-pair.js ORIGIN_RE

let mods = null;
const lib = () => mods || (mods = Promise.all([
  import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href),
  import(pathToFileURL(path.join(__dirname, 'assist-core.mjs')).href),
]).then(([audit, core]) => ({ audit, core })));

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// HH:MM today; 'Thu 11:00' within a week of `ref`; '2 Nov 11:00' beyond (a time without its day reads as today)
const when = (ms, ref) => {
  const d = new Date(ms), r = new Date(ref);
  if (d.toDateString() === r.toDateString()) return hhmm(ms);
  return (ref - ms < 6 * 24 * 3600e3 && ref > ms ? DAYS[d.getDay()] : d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]) + ' ' + hhmm(ms);
};
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

function withTimeout(p, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('probe timed out')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

// A bounded process-list check. Only claude.exe / node.exe are listed (a remote-control session is one of the two); the command lines
// come back to this process, are matched in memory and are never stored or logged.
function defaultProcesses() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = "Get-CimInstance Win32_Process -Filter \"Name='claude.exe' OR Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; started = $_.CreationDate.ToUniversalTime().ToString('o'); cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const t = String(stdout || '').trim();
        if (!t) return resolve([]);
        try { const j = JSON.parse(t); resolve(Array.isArray(j) ? j : [j]); } catch (e) { reject(e); }
      });
  });
}

// `reg query "HKCU\Control Panel\NotifyIconSettings" /s` → this exe's IsPromoted. true / false / null (no entry for this exe).
function parseNotifyIcons(text, exePath) {
  const want = norm(exePath);
  if (!want) return null;
  let found = null;
  for (const block of String(text || '').split(/\r?\n(?=HKEY_)/i)) {
    const exe = /^\s*ExecutablePath\s+REG_\w+\s+(.+?)\s*$/im.exec(block);
    if (!exe || norm(exe[1]) !== want) continue;
    const pr = /^\s*IsPromoted\s+REG_DWORD\s+(0x[0-9a-f]+)/im.exec(block);
    const on = !!pr && parseInt(pr[1], 16) === 1;
    found = found === true ? true : on;
  }
  return found;
}

function defaultTray(exePath) {
  if (process.platform !== 'win32' || !exePath) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    execFile('reg.exe', ['query', 'HKCU\\Control Panel\\NotifyIconSettings', '/s'],
      { timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(parseNotifyIcons(stdout, exePath));
      });
  });
}

function create({ dataDir, home = os.homedir(), exePath = null, serverPath = null, stateFile = null, probes = {}, now = Date.now, probeTimeoutMs = PROBE_MS } = {}) {
  const P = {
    processes: probes.processes || defaultProcesses,
    isAlive: probes.isAlive || defaultIsAlive,
    tray: probes.tray || defaultTray,
    bootTime: probes.bootTime || (() => now() - os.uptime() * 1000),
  };
  const server = serverPath || (dataDir ? path.join(dataDir, '..', 'mcp', 'workspacehq', 'server.mjs') : null);

  async function phoneDoor() {
    const base = { id: 'phone-door', who: 'owner' };
    let procs = null;
    try { procs = await withTimeout(P.processes(), probeTimeoutMs); } catch { procs = null; }
    const copyStep = { step: 'Start it in a terminal that stays open', copy: PHONE_COPY };
    const bootAt = () => { try { return when(P.bootTime(), now()); } catch { return null; } };
    const off = (extra) => ({ ...base, ok: false, detail: `not running since boot${bootAt() ? ' at ' + bootAt() : ''}${extra || ''}`, ...copyStep });
    if (Array.isArray(procs)) {
      const hit = procs.find((p) => p && p.pid !== process.pid && typeof p.cmd === 'string' && /remote-control/i.test(p.cmd) && /claude/i.test(p.cmd));
      if (hit) {
        const t = Date.parse(hit.started);
        return { ...base, ok: true, detail: `running (pid ${hit.pid})${Number.isFinite(t) ? ' since ' + when(t, now()) : ''}` };
      }
      return off();
    }
    // the process list could not be read: a state file is a hint only, and only when its pid is alive
    if (stateFile) {
      try {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const pid = Number(s && s.pid);
        if (Number.isInteger(pid) && pid > 0) {
          if (P.isAlive(pid)) return { ...base, ok: true, detail: `running (pid ${pid}) — from its state file; the process list could not be read` };
          return off(` (its state file still says running for pid ${pid}, which is gone)`);
        }
      } catch { /* no usable state file */ }
    }
    return { ...base, ok: null, detail: 'unknown — the process list could not be read' };
  }

  function userScope() {
    const base = { id: 'user-scope', who: 'owner' };
    const copy = server ? `claude mcp add --scope user workspacehq -- node "${String(server).replace(/\\/g, '/')}"` : undefined;
    const off = (detail) => ({ ...base, ok: false, detail, step: 'Register it once the structure lane has isolated the nightly runs', ...(copy ? { copy } : {}) });
    let raw;
    try { raw = fs.readFileSync(path.join(home, '.claude.json'), 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') return off('not registered — there is no ~/.claude.json yet');
      return { ...base, ok: null, detail: 'unknown — ~/.claude.json could not be read' };
    }
    let cfg;
    try { cfg = JSON.parse(raw); } catch { return { ...base, ok: null, detail: 'unknown — ~/.claude.json is not valid JSON' }; }
    raw = null;
    const has = !!(cfg && typeof cfg === 'object' && cfg.mcpServers && typeof cfg.mcpServers === 'object' && Object.prototype.hasOwnProperty.call(cfg.mcpServers, 'workspacehq'));
    cfg = null;
    return has ? { ...base, ok: true, detail: 'registered at user scope — every session has the workspacehq tools' }
      : off('not registered at user scope — only sessions started in this folder have the workspacehq tools');
  }

  // Paired means what bridge-pair.js means by it: a pairing file that parses (v 1, a browser-extension origin) AND a token file that is
  // there and not empty. The file contents are checked in memory and never reach the output; the token is only stat-ed.
  // (The two rules are repeated here on purpose: this module is also loaded from a copied MCP root that has no bridge-pair.js.)
  function bridge() {
    const base = { id: 'bridge', who: 'owner' };
    if (!dataDir) return { ...base, ok: null, detail: 'unknown — no data folder' };
    const unpaired = (detail) => ({ ...base, ok: false, detail, step: 'Open the extension popup and pair it with the app' });
    let text;
    try { text = fs.readFileSync(path.join(dataDir, '.bridge-pairing.json'), 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') return unpaired('not paired');
      return { ...base, ok: null, detail: 'unknown — the pairing file could not be checked' };
    }
    let j = null;
    try { j = JSON.parse(text); } catch { j = null; }
    text = null;
    if (!j || typeof j !== 'object' || Array.isArray(j) || j.v !== 1 || typeof j.origin !== 'string' || !EXT_ORIGIN.test(j.origin)) {
      return unpaired('not paired — the pairing file is not one this app accepts');
    }
    j = null;
    try {
      if (fs.statSync(path.join(dataDir, '.bridge-token')).size < 1) return unpaired('not paired — the bridge token is empty');
    } catch (e) {
      if (e && e.code === 'ENOENT') return unpaired('not paired — the bridge token is missing');
      return { ...base, ok: null, detail: 'unknown — the bridge token could not be checked' };
    }
    return { ...base, ok: true, detail: 'the browser extension is paired' };
  }

  async function trayIcon() {
    const base = { id: 'tray-icon', who: 'owner' };
    if (!exePath) return { ...base, ok: null, detail: 'unknown — this build does not know its own exe path' };
    let v = null;
    try { v = await withTimeout(P.tray(exePath), probeTimeoutMs); } catch { v = null; }
    if (v === true) return { ...base, ok: true, detail: 'shown on the taskbar' };
    if (v === false) return { ...base, ok: false, detail: 'hidden in the tray overflow', step: 'Windows Settings › Personalization › Taskbar › Other system tray icons: switch WorkspaceHQ on' };
    return { ...base, ok: null, detail: 'unknown — Windows has no entry for this app yet, or the registry could not be read' };
  }

  async function calls(t) {
    const base = { id: 'calls', who: 'owner' };
    try {
      const { audit, core } = await lib();
      const r = audit.read(dataDir);
      const from = t - WEEK_MS;
      const by = {};
      for (const d of core.DOORS) by[d] = 0;
      for (const e of r.entries) { const at = Date.parse(e.at); if (Number.isFinite(at) && at >= from && at <= t + 60e3 && e.door in by) by[e.door] += 1; }
      const total = Object.values(by).reduce((a, b) => a + b, 0);
      const detail = core.DOORS.map((d) => `${d} ${by[d]}`).join(' · ') + ' this week' + (r.skipped ? ` · ${r.skipped} unreadable line(s) skipped` : '');
      return total > 0 ? { ...base, ok: true, detail } : { ...base, ok: false, detail, step: 'Ask a Claude session in this folder for hq_brief' };
    } catch { return { ...base, ok: null, detail: 'unknown — the audit log could not be read' }; }
  }

  async function read() {
    const t = now();
    const settle = async (id, fn) => { try { return await fn(); } catch { return { id, ok: null, detail: 'unknown — the check failed', who: 'owner' }; } };
    const rows = await Promise.all([
      settle('phone-door', phoneDoor),
      settle('user-scope', userScope),
      settle('bridge', bridge),
      settle('tray-icon', trayIcon),
      settle('calls', () => calls(t)),
    ]);
    return { at: new Date(t).toISOString(), rows };
  }

  return { read };
}

function init({ ipcMain, ...opts } = {}) {
  const r = create(opts);
  if (ipcMain && typeof ipcMain.handle === 'function') ipcMain.handle('hq:reach:read', async () => { try { return await r.read(); } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; } });
  return r;
}

module.exports = { create, init, parseNotifyIcons, PHONE_COPY };
