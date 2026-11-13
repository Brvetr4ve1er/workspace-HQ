// What the owner actually uses, as counts (batch 5, dish "Jump ordered by measured use"). Main side, CJS, no Electron.
// The use log (use-log.js) writes ONE line per mark, {event:'use', surface, action}, into logs/app-YYYY-MM-DD.log. This reads the last
// 14 days of those day files and turns the marks into per-destination counts the Ctrl+Alt+X Go palette can break ties with.
//
//   create({ logDir?, env?, appRoot?, now?, fs?, days: 14 }) → { read() }
//   read() → { marks: number, byTarget: { 'tab/sub': number } }   NEVER throws; a missing dir, an unreadable file → zeros
//
// Reading rules (each pinned by use-counts.test.mjs):
//   · only files named app-YYYY-MM-DD.log whose DATE is within the window: today and the 13 days before it (days = 14);
//   · only lines whose JSON has event === 'use' and a known surface; garbage, other events and unknown surfaces are ignored;
//   · SPACE level comes ONLY from 'space-<id>' marks (→ '<id>/'); the older surfaces map ONLY to sub-view targets no space mark covers
//     (SURFACE_TARGETS), every other known surface maps to nothing — so one arrival is never counted twice;
//   · `marks` = the known-surface marks seen (informational); ordering by use is ACTIVE only when the SUM of byTarget >= ACTIVE_MIN;
//   · a file is read from its tail, at most MAX_READ bytes (a capped 5 MiB day file stays cheap); the answer is cached 60 s;
//   · the result holds numbers under 'tab/sub' keys from the fixed table and nothing else: no names, ids, text or paths.
// The default folder follows app-log's rule (HQ_APP_LOG_DIR when absolute, else <repo>/logs), so main.js needs no edit.
const fs0 = require('fs');
const path = require('path');
const appLog = require('./app-log.js');
const modes = require('./cast-modes.js');
const useLog = require('./use-log.js');

const DAYS = 14;
const CACHE_MS = 60e3;
const MAX_READ = 2 * 1024 * 1024;
const ACTIVE_MIN = 10;

// the destinations a mark may count towards: exactly the palette's own table (a target not in it is dropped, never counted)
const GO_KEYS = new Set((modes.goTable || []).map((t) => t.tab + '/' + (t.sub || '')));
const SPACE_IDS = Object.freeze((modes.SPACE_IDS && modes.SPACE_IDS.length ? [...modes.SPACE_IDS] : (modes.goTable || []).filter((t) => t.kind === 'space').map((t) => t.tab)));

// older surface → the ONE sub-view it proves a visit to. Surfaces that sit on a screen a space mark already covers map to nothing.
const LOCAL_TARGETS = {
  'sessions-board': 'claude/sessions', 'sessions-strip': 'claude/sessions',
  'clients-list': 'projects/clients', 'machine-drift': 'system/machine', 'brief-history': 'history/timeline',
  'money-start': 'money/today', 'money-quick': 'money/today', 'money-access': 'money/today',
};
const NO_TARGET = ['brief-panel', 'today-ribbon', 'brief-act', 'cosmos', 'security', 'security-refresh', 'delivery-card', 'delivery-check', 'quick-jump', 'reach', 'palette-money-line'];
const SURFACE_TARGETS = Object.freeze(Object.assign({}, modes.SURFACE_TARGETS || LOCAL_TARGETS));

// surface → target key | null, for every surface a line may carry and be counted as a mark
function buildSurfaceMap() {
  const m = new Map();
  for (const s of NO_TARGET) m.set(s, null);
  for (const s of Array.isArray(useLog.SURFACES) ? useLog.SURFACES : []) if (!m.has(s)) m.set(s, null);
  for (const [s, t] of Object.entries(SURFACE_TARGETS)) m.set(s, GO_KEYS.has(t) ? t : null);
  for (const id of SPACE_IDS) m.set('space-' + id, GO_KEYS.has(id + '/') ? id + '/' : null);
  return m;
}
const SURFACE_MAP = buildSurfaceMap();

const FILE_RE = appLog.FILE_RE || /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const zeros = () => ({ marks: 0, byTarget: {} });

const sum = (byTarget) => Object.values(byTarget || {}).reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0);
// the one activation rule; cast-modes.js carries its own copy of the number (it is a page script and cannot require this file)
const isActive = (use) => !!use && typeof use === 'object' && sum(use.byTarget) >= ACTIVE_MIN;

function tailText(fs, file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.max(0, Math.min(size, MAX_READ));
    if (!len) return '';
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { try { fs.closeSync(fd); } catch { /* nothing to do */ } }
}

function create({ logDir, env, appRoot, now = Date.now, fs = fs0, days = DAYS } = {}) {
  const span = Number.isInteger(days) && days > 0 ? days : DAYS;
  const dir = logDir || appLog.resolveDir(env || process.env, appRoot || path.resolve(__dirname, '..'));
  let cache = null;   // { at, value }
  const clock = () => { try { const t = now(); const ms = t instanceof Date ? t.getTime() : Number(t); return Number.isFinite(ms) ? ms : Date.now(); } catch { return Date.now(); } };

  function scan(ms) {
    const out = zeros();
    if (!dir) return out;
    const today = new Date(ms);
    const first = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (span - 1)));
    const last = localDate(today);
    let names;
    try { names = fs.readdirSync(dir); } catch { return out; }
    const counts = new Map();
    for (const n of Array.isArray(names) ? names : []) {
      const m = typeof n === 'string' ? FILE_RE.exec(n) : null;
      if (!m) continue;
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      if (day < first || day > last) continue;
      let text;
      try { text = tailText(fs, path.join(dir, n)); } catch { continue; }
      for (const line of text.split('\n')) {
        if (line.charCodeAt(0) !== 123 || line.indexOf('"use"') < 0) continue;   // '{' and the word, before paying for a parse
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (!o || typeof o !== 'object' || o.event !== 'use' || typeof o.surface !== 'string' || !SURFACE_MAP.has(o.surface)) continue;
        out.marks++;
        const t = SURFACE_MAP.get(o.surface);
        if (t) counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    for (const k of [...counts.keys()].sort()) out.byTarget[k] = counts.get(k);
    return out;
  }

  function read() {
    try {
      const ms = clock();
      if (!cache || ms - cache.at >= CACHE_MS || ms < cache.at) cache = { at: ms, value: scan(ms) };
      return { marks: cache.value.marks, byTarget: Object.assign({}, cache.value.byTarget) };
    } catch { return zeros(); }
  }
  return { read };
}

module.exports = { create, isActive, ACTIVE_MIN, DAYS, CACHE_MS, MAX_READ, SURFACE_TARGETS, SPACE_IDS };
