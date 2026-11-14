// Brief quiet lane, main side: the few cheap facts dashboard/brief-quiet.mjs needs. STAT AND READ ONLY: it never writes, never spawns, never
// touches the network, and never throws — a source it cannot read is skipped (null), never guessed.
//
//   create({ dataDir, logDir?, env?, appRoot?, fs?, now?, cacheMs? }) → { gather() }
//   gather() → { security: { started: bool|null }, bridge: { paired: bool|null }, moneyOpened: bool|null, sources: [{ kind, mtimeMs }] }
//   gather({ dataDir, ... }) (module level) → the same, one cached instance per folder pair
//
//   security.started  data/security/status.json: absent → false; an object → its walkthroughStarted === true; unreadable or not an object → null
//   bridge.paired     the same two-file rule dashboard/reach.js bridge() states: data/.bridge-pairing.json parses (v 1, a browser-extension origin) AND
//                     data/.bridge-token is there and not empty. Contents are checked in memory and dropped; the token is only stat-ed. A read error that
//                     is not "absent" → null
//   moneyOpened       a 'space-money' use mark ({event:'use', surface:'space-money'}, dashboard/use-log.js) in the retained day logs (app-YYYY-MM-DD.log).
//                     true once found (sticky); false when day logs exist and none holds one; null when there are no day logs to tell from
//   sources           { kind, mtimeMs } for each sensor file that EXISTS (pc-health, github, accounts, disk-history); an absent or unstat-able file is left
//                     out, so "dark" can only ever mean "existed and stopped" (the pure side decides the 3-day line)
//
// Nothing returned holds a path, a name or a file's contents: booleans, a fixed kind word and a modification time.
const fs0 = require('fs');
const path = require('path');
const appLog = require('./app-log.js');

const EXT_ORIGIN = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]{1,64}$/i;   // bridge-pair.js ORIGIN_RE, as reach.js repeats it
const FILE_RE = appLog.FILE_RE || /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;
const SENSORS = Object.freeze([['pc-health', ['pc-health.json']], ['github', ['github.json']], ['accounts', ['accounts.json']], ['disk-history', ['disk-history.json']]]);
const MAX_READ = 4 * 1024 * 1024;   // a day file is capped near 5 MiB by app-log; its tail is read
const CACHE_MS = 5 * 60e3;          // how long a "no mark yet" answer is reused (a found mark is kept for good)
const MARK = '"space-money"';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function create({ dataDir, logDir, env, appRoot, fs = fs0, now = Date.now, cacheMs = CACHE_MS } = {}) {
  const dir = logDir || (() => { try { return appLog.resolveDir(env || process.env, appRoot || path.resolve(__dirname, '..')); } catch { return null; } })();
  let moneyOpened = null, moneyAt = -Infinity;   // sticky true; false / null reused for cacheMs
  const clock = () => { try { const t = now(); const ms = t instanceof Date ? t.getTime() : Number(t); return Number.isFinite(ms) ? ms : Date.now(); } catch { return Date.now(); } };

  function readSecurity() {
    if (!dataDir) return null;
    let raw;
    try { raw = fs.readFileSync(path.join(dataDir, 'security', 'status.json'), 'utf8'); }
    catch (e) { return e && e.code === 'ENOENT' ? false : null; }
    try { const j = JSON.parse(raw); return isObj(j) ? j.walkthroughStarted === true : null; } catch { return null; }
  }

  function readBridge() {
    if (!dataDir) return null;
    let text;
    try { text = fs.readFileSync(path.join(dataDir, '.bridge-pairing.json'), 'utf8'); }
    catch (e) { return e && e.code === 'ENOENT' ? false : null; }
    let j = null;
    try { j = JSON.parse(text); } catch { j = null; }
    text = null;
    if (!isObj(j) || j.v !== 1 || typeof j.origin !== 'string' || !EXT_ORIGIN.test(j.origin)) return false;
    j = null;
    try { return fs.statSync(path.join(dataDir, '.bridge-token')).size >= 1; }
    catch (e) { return e && e.code === 'ENOENT' ? false : null; }
  }

  function tailText(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, len = Math.max(0, Math.min(size, MAX_READ));
      if (!len) return '';
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { try { fs.closeSync(fd); } catch { /* nothing to do */ } }
  }

  function scanMoney() {
    if (!dir) return null;
    let names;
    try { names = fs.readdirSync(dir); } catch { return null; }
    const days = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && FILE_RE.test(n));
    if (!days.length) return null;   // no retained day log: nothing to tell from, so no claim
    for (const n of days) {
      let text;
      try { text = tailText(path.join(dir, n)); } catch { continue; }
      if (text.indexOf(MARK) < 0) continue;
      for (const line of text.split('\n')) {
        if (line.charCodeAt(0) !== 123 || line.indexOf(MARK) < 0) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (isObj(o) && o.event === 'use' && o.surface === 'space-money') return true;
      }
    }
    return false;
  }

  function readMoney() {
    const t = clock();
    if (moneyOpened === true) return true;
    if (t >= moneyAt && t - moneyAt < cacheMs) return moneyOpened;
    let v = null;
    try { v = scanMoney(); } catch { v = null; }
    moneyOpened = v; moneyAt = t;
    return v;
  }

  function readSources() {
    const out = [];
    if (!dataDir) return out;
    for (const [kind, files] of SENSORS) {
      for (const f of files) {
        try { const st = fs.statSync(path.join(dataDir, f)); if (st && st.isFile() && Number.isFinite(st.mtimeMs)) { out.push({ kind, mtimeMs: st.mtimeMs }); break; } } catch { /* absent or unreadable: not a dark source */ }
      }
    }
    return out;
  }

  function gather() {
    const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
    return { security: { started: safe(readSecurity, null) }, bridge: { paired: safe(readBridge, null) }, moneyOpened: safe(readMoney, null), sources: safe(readSources, []) };
  }
  return { gather };
}

// module level: brief.js calls gather({ dataDir }) on every compute, so one instance per folder pair keeps the money answer cached
const instances = new Map();
function gather(opts) {
  try {
    const o = isObj(opts) ? opts : {};
    const k = String(o.dataDir || '') + '|' + String(o.logDir || '');
    let inst = instances.get(k);
    if (!inst) { inst = create(o); instances.set(k, inst); }
    return inst.gather();
  } catch { return { security: { started: null }, bridge: { paired: null }, moneyOpened: null, sources: [] }; }
}

module.exports = { create, gather, SENSORS, CACHE_MS, MAX_READ };
