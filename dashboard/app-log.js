// The app lifecycle log. The owner's app stopped silently overnight and nothing
// said why: this appends ONE JSON line per lifecycle event to
// logs/app-YYYY-MM-DD.log (logs/ is gitignored), so the next morning reads what
// happened, in order. IPC-CONTRACT "2026-10-07 — MAIN package" (main-internal row).
//
// create({ appRoot, env?, dir?, now?, pid?, maxBytes?, keepDays? }) → logger
//   dir       the log folder; default resolveDir(env, appRoot): env HQ_APP_LOG_DIR when it is
//             an absolute path (gates point it at a temp dir), else <appRoot>/logs
//   appRoot   the repo root: paths under it stay readable in error text as <app>\…
//   now / pid injectable for tests
// logger.event(name, fields?)        → true when the line was written. NEVER throws.
// logger.error(name, err, fields?)   adds error:{name, code, message, stack} (redacted, below)
// logger.start(fields)               the 'start' line, plus prev = what the PREVIOUS run wrote
//                                    last ({pid, event, ts, clean} | null; clean = it ended on quit/exit)
// logger.secondary()                 this process lost the single-instance lock: its lines carry
//                                    secondary:true (prev skips them) and its quit reason is 'second-launch'
// logger.attach({ app, proc? })      app-level hooks, so every window counts (screen-capture's too):
//     render-process-gone {window, reason, exitCode} · child-process-gone {type, reason, exitCode, name}
//     browser-window-created → per window: unresponsive / responsive / session-end {window}
//       Electron 32 has session-end only as a (win32) BaseWindow event — there is no app-level one
//       and no 'query-session-end' yet (later Electron); both names are listened for per window,
//       the missing one simply never fires. Once per 10 s: every window gets the same session end.
//     before-quit / will-quit {reason} · quit {exitCode, reason} · process exit {code} (only when
//     no quit line was written — a direct process.exit)
// logger.watchPower(powerMonitor)    suspend / resume / shutdown — call it after app ready. 'shutdown'
//                                    fires on linux/darwin only; on Windows session-end is that signal.
// logger.heartbeat(ms = 15 min)      an 'alive' line {uptimeMin, rssMb, heapMb}. A hard kill (taskkill /f,
//                                    Stop-Process, tools\rollback.ps1, a native crash, power loss) writes
//                                    NOTHING; the last 'alive' brackets when the process died, and the next
//                                    'start' says (prev) what the dead run wrote last.
// logger.setQuitReason(r)            main.js: 'tray' (tray › Quit). Set here: 'session-end', 'shutdown',
//                                    'second-launch'. Anything else quits as 'unknown' — never guessed
//                                    (the app menu's role:'quit' / Ctrl+Q has no hook).
//
// Line: {"ts":"<local ISO + offset>","event":"<name>","pid":<n>, …fields}. Day files by LOCAL date (the
// owner reads "overnight" in local time); the file name is computed per write, so a process running past
// midnight rolls over to the new day's file. Rotation: files named exactly app-YYYY-MM-DD.log that are
// older than keepDays (30) are pruned at create() — nothing else in logs/ (pipeline logs) is touched; one
// day's file stops at maxBytes (5 MiB) with a single 'log-capped' line.
// PRIVACY — no personal data beyond window names: an `argv` field is never written raw, only its flag
// NAMES (--summon="note …" → --summon); a window is named by its page file (dashboard-v5/index.html,
// organic/summon.html), never its title (page-authored — a conjured widget can set it); error text keeps
// paths under the repo as <app>\…, every other path becomes <path>, URLs <url>, e-mail addresses
// <email>, quoted data "…" (redact below), and messages are capped.
// Writes are synchronous (appendFileSync): a line written just before a crash must already be on disk.
// Pure Node, no Electron require — app-log.test.mjs runs without Electron.
const fs = require('node:fs');
const path = require('node:path');

const FILE_RE = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_DAYS = 30;
const HEARTBEAT_MS = 15 * 60 * 1000;
const SESSION_END_DEDUPE_MS = 10000;
const CLEAN_END = new Set(['quit', 'exit']);
const BASE_KEYS = new Set(['ts', 'event', 'pid']);

const pad = (n, w = 2) => String(n).padStart(w, '0');
function localDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function localIso(d) {
  const off = -d.getTimezoneOffset();   // minutes east of UTC
  const a = Math.abs(off);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
    + `${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function fileName(d) { return `app-${localDate(d)}.log`; }

function resolveDir(env, appRoot) {
  const o = env && typeof env.HQ_APP_LOG_DIR === 'string' ? env.HQ_APP_LOG_DIR.trim() : '';
  if (o && path.isAbsolute(o)) return o;
  return appRoot ? path.join(appRoot, 'logs') : null;
}

// argv → the flag names, deduped: '--summon=note text' → '--summon'; positionals ('.', paths) dropped.
function flagNames(argv) {
  const out = [];
  for (const a of Array.isArray(argv) ? argv : []) {
    if (typeof a !== 'string' || !a.startsWith('--')) continue;
    const name = a.split('=')[0];
    if (/^--[A-Za-z0-9][\w-]{0,47}$/.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

// A window's name = its page file: the last two path segments of a file: URL. Any other scheme is
// named by the scheme alone (never a host or path).
function pageName(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return 'unknown'; }
  if (u.protocol !== 'file:') return u.protocol.replace(/:$/, '') || 'unknown';
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch { /* keep it encoded */ }
  return p.split('/').filter(Boolean).slice(-2).join('/') || 'unknown';
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Paths under appRoot (Windows, forward-slash and file-URL spellings, any case) → <app>; every other
// absolute path (drive letter, UNC, file:///) → <path>. Over-redaction is the safe failure.
// Error text also echoes DATA, not just paths (review 2026-10-07): V8's JSON.parse quotes the input
// ('Unexpected token \'h\', "hello plac"... is not valid JSON' — a note, a post, a token), network
// errors carry URLs with query strings, and messages can carry an address. So: any other URL →
// <url>, an e-mail address → <email>, every double-quoted span → "…", and a long single-quoted span
// (V8 keeps short identifiers there: (reading 'x'), module names) → '…'.
function redact(s, appRoot) {
  let out = String(s ?? '');
  if (appRoot) {
    const fwd = String(appRoot).replace(/\\/g, '/');
    for (const v of new Set([String(appRoot), fwd, encodeURI(fwd)])) out = out.replace(new RegExp(escRe(v), 'gi'), '<app>');
  }
  return out
    .replace(/file:\/\/\/(?!<app>)[^\s'"`)\]]*/gi, '<path>')
    .replace(/\b(?!file:)[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/[^\s'"`)\]]+/g, '<url>')
    .replace(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/][^'"`\r\n)\]]*/g, '$1<path>')
    .replace(/\\\\[^\s'"`)\]]+/g, '<path>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '<email>')
    .replace(/"[^"\r\n]*"/g, '"…"')
    .replace(/'(?!<app>|<path>|<url>)[^'\r\n]{41,}'/g, "'…'");
}

function errorInfo(err, appRoot) {
  try {
    if (err && typeof err === 'object' && ('message' in err || 'stack' in err)) {
      const stack = String(err.stack || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '))
        .slice(0, 6).map((l) => redact(l, appRoot).slice(0, 200));
      const info = { name: String(err.name || 'Error').slice(0, 60), message: redact(err.message, appRoot).slice(0, 300), stack };
      if (err.code != null) info.code = String(err.code).slice(0, 40);
      return info;
    }
    return { name: typeof err, message: redact(String(err), appRoot).slice(0, 300) };
  } catch { return { name: 'unknown', message: '(unprintable)' }; }
}

function formatLine(event, fields, d, pid) {
  const line = { ts: localIso(d), event: String(event), pid };
  for (const [k, v] of Object.entries(fields || {})) {
    if (BASE_KEYS.has(k) || v === undefined) continue;
    if (k === 'argv') { line.flags = flagNames(v); continue; }   // never raw argv
    line[k] = v;
  }
  return JSON.stringify(line);
}

// Remove app-YYYY-MM-DD.log files dated before (today − keepDays). Returns how many went.
function prune(dir, now, keepDays = KEEP_DAYS) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const cutoff = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays));
  let removed = 0;
  for (const n of names) {
    const m = FILE_RE.exec(n);
    if (!m || `${m[1]}-${m[2]}-${m[3]}` >= cutoff) continue;
    try { fs.unlinkSync(path.join(dir, n)); removed++; } catch { /* in use / a folder — leave it */ }
  }
  return removed;
}

// The last line a previous PRIMARY run wrote: newest app-*.log first (3 at most), last 64 KiB of
// each, newest line first; skips secondary (lost-the-lock) lines, this pid, and torn/partial lines.
function lastRun(dir, { pid } = {}) {
  let names;
  try { names = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort().reverse().slice(0, 3); } catch { return null; }
  for (const n of names) {
    let text = '';
    try {
      const fd = fs.openSync(path.join(dir, n), 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, 64 * 1024);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        text = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { continue; }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!o || typeof o !== 'object' || o.secondary === true || (pid != null && o.pid === pid)) continue;
      const event = String(o.event || '');
      return { pid: Number.isInteger(o.pid) ? o.pid : null, event, ts: typeof o.ts === 'string' ? o.ts : null, clean: CLEAN_END.has(event) };
    }
  }
  return null;
}

function create(opts = {}) {
  const appRoot = opts.appRoot || null;
  const dir = opts.dir || resolveDir(opts.env, appRoot);
  const now = typeof opts.now === 'function' ? opts.now : () => new Date();
  const pid = Number.isInteger(opts.pid) ? opts.pid : process.pid;
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : MAX_BYTES;
  const keepDays = opts.keepDays > 0 ? opts.keepDays : KEEP_DAYS;
  const sizes = new Map();    // day file → bytes as far as this process knows
  const capped = new Set();   // day files this process stopped writing
  const lastAt = new Map();   // deduped event → ms
  let quitReason = null, quitLogged = false, isSecondary = false, hbTimer = null;

  if (dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* write() retries */ }
    try { prune(dir, now(), keepDays); } catch { /* never block startup */ }
  }

  function write(event, fields) {
    try {
      if (!dir) return false;
      const d = now();
      const name = fileName(d);
      if (capped.has(name)) return false;
      const f = isSecondary ? { ...fields, secondary: true } : fields;
      let line;
      try { line = formatLine(event, f, d, pid) + '\n'; }
      catch { line = formatLine(event, { unserializable: true }, d, pid) + '\n'; }   // circular / BigInt field
      const file = path.join(dir, name);
      let size = sizes.get(name);
      if (size === undefined) { try { size = fs.statSync(file).size; } catch { size = 0; } }
      const bytes = Buffer.byteLength(line);
      if (size + bytes > maxBytes) {
        capped.add(name);
        try { fs.appendFileSync(file, formatLine('log-capped', { maxBytes }, d, pid) + '\n'); } catch { /* full disk */ }
        return false;
      }
      try { fs.appendFileSync(file, line); }
      catch (e) {
        if (!e || e.code !== 'ENOENT') throw e;
        fs.mkdirSync(dir, { recursive: true });   // logs/ removed while running
        fs.appendFileSync(file, line);
      }
      sizes.set(name, size + bytes);
      return true;
    } catch { return false; }
  }
  const reason = () => quitReason || 'unknown';
  const winName = (wc) => { try { return pageName(wc && typeof wc.getURL === 'function' ? wc.getURL() : ''); } catch { return 'unknown'; } };
  const dedupe = (key, ms) => {
    const t = now().getTime();
    if (t - (lastAt.get(key) ?? -Infinity) < ms) return false;
    lastAt.set(key, t);
    return true;
  };

  function setQuitReason(r) { if (typeof r === 'string' && r) quitReason = r.slice(0, 40); }

  function attach({ app, proc = process } = {}) {
    if (!app || typeof app.on !== 'function') return false;
    app.on('render-process-gone', (_e, wc, details) => write('render-process-gone', { window: winName(wc), reason: details?.reason ?? null, exitCode: details?.exitCode ?? null }));
    app.on('child-process-gone', (_e, d) => write('child-process-gone', { type: d?.type ?? null, reason: d?.reason ?? null, exitCode: d?.exitCode ?? null, name: d?.name || d?.serviceName || null }));
    app.on('browser-window-created', (_e, w) => {
      if (!w || typeof w.on !== 'function') return;
      const name = () => { try { return winName(w.webContents); } catch { return 'unknown'; } };
      w.on('unresponsive', () => write('unresponsive', { window: name() }));
      w.on('responsive', () => write('responsive', { window: name() }));
      for (const ev of ['session-end', 'query-session-end']) {
        w.on(ev, () => { setQuitReason('session-end'); if (dedupe(ev, SESSION_END_DEDUPE_MS)) write(ev, { window: name() }); });
      }
    });
    app.on('before-quit', () => write('before-quit', { reason: reason() }));
    app.on('will-quit', () => write('will-quit', { reason: reason() }));
    // PREPENDED (review 2026-10-07): Electron's own init registers app.on('quit') → process.emit('exit')
    // before main.js runs, so an appended listener ran after 'exit' and every clean quit logged a
    // spurious 'exit' line (meant only for a direct process.exit) ahead of its 'quit' (real-app gate).
    const onQuit = (_e, exitCode) => { quitLogged = true; write('quit', { exitCode: exitCode ?? null, reason: reason() }); };
    if (typeof app.prependListener === 'function') app.prependListener('quit', onQuit); else app.on('quit', onQuit);
    if (proc && typeof proc.on === 'function') proc.on('exit', (code) => { if (!quitLogged) write('exit', { code: code ?? null }); });
    return true;
  }

  function watchPower(pm) {
    if (!pm || typeof pm.on !== 'function') return false;
    pm.on('suspend', () => write('suspend'));
    pm.on('resume', () => write('resume'));
    pm.on('shutdown', () => { setQuitReason('shutdown'); write('shutdown'); });   // no preventDefault: never delays a shutdown
    return true;
  }

  function heartbeat(ms = HEARTBEAT_MS) {
    if (hbTimer) return hbTimer;
    hbTimer = setInterval(() => {
      let m = null;
      try { m = process.memoryUsage(); } catch { /* keep the line */ }
      write('alive', { uptimeMin: Math.round(process.uptime() / 60), rssMb: m ? Math.round(m.rss / 1048576) : null, heapMb: m ? Math.round(m.heapUsed / 1048576) : null });
    }, Math.max(10, Number(ms) || HEARTBEAT_MS));
    if (typeof hbTimer.unref === 'function') hbTimer.unref();
    return hbTimer;
  }

  return {
    dir,
    event: (name, fields) => write(name, fields),
    error: (name, err, fields) => write(name, { ...fields, error: errorInfo(err, appRoot) }),
    start: (fields) => write('start', { ...fields, prev: dir ? lastRun(dir, { pid }) : null }),
    secondary: () => { isSecondary = true; setQuitReason('second-launch'); },
    setQuitReason,
    attach,
    watchPower,
    heartbeat,
    stop: () => { if (hbTimer) clearInterval(hbTimer); hbTimer = null; },
  };
}

module.exports = {
  create, resolveDir, flagNames, pageName, redact, errorInfo, formatLine, prune, lastRun,
  localDate, localIso, fileName, FILE_RE, MAX_BYTES, KEEP_DAYS, HEARTBEAT_MS,
};
