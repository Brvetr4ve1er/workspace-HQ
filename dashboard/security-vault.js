// Security space, main side: read the owner's KeePassXC vault through its own cli, in memory, and drop everything that is a secret.
// Spec docs/superpowers/specs/2026-11-11-security-space-design.md (dish "security-vault").
//
// THE RULE: a secret (the master passphrase, a password, a note, an OTP value) is held only in local variables for the length of one
// refresh. The passphrase goes to keepassxc-cli on STDIN (never argv, never env); the XML export is collected in memory (64 MB cap, 60 s);
// stdout and stderr are never written anywhere; the parse-and-reduce step (security-core.mjs) keeps only flags; every local that held the
// export or a password is set to null before the call returns. Refresh runs only when the owner presses it - never at boot, on a timer,
// from MCP, the Bridge or a session.
//
// create({ store, core | getCore, spawn, findCli, fetchRange, now, randomBytes, trash, log,
//          existsSync, fs, env, timeoutMs, maxBytes, execPath }) ->
//   { refresh({ passphrase, checkBreaches }) -> { ok, accounts, breachChecked, notes[] } | { error },
//     findCli() -> path|null, scanExports({ dirs }) -> [{ name, dir, size, mtime }], scanConflicts(vaultPath) -> number,
//     trashExport(name, dir) -> Promise<{ ok } | { error }>, limits }
//   core is the security-core module (parseKeepassXml, reduceEntries, snapshotOf, breachMatch); getCore may be async (main loads the ESM lazily).
//   now() returns a Date. trash(fullPath) is shell.trashItem; log(note) writes ONE fixed-words line (no names) through appLog.event.
//   Also exported: makeFindCli, hibpRange (the one product network call: a 5-hex prefix, never a hash), EXPORT_NAME_RE, scanExports helpers.
const nodeFs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const cp = require('node:child_process');

const MAX_PASS = 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const BREACH_CONCURRENCY = 4;
const HIBP_HOST = 'api.pwnedpasswords.com';
// name only, anchored: word boundaries and known export names, never a bare "pass" substring. A hit is a GUESS - the file is never opened.
const EXPORT_NAME_RE = /(^|[^a-z])passwords?([^a-z]|$)|chrome passwords|bitwarden_export|1password|keepass.*\.(csv|xml)|ente.?auth|authenticator.*export/i;
const EXPORT_EXT = new Set(['csv', 'json', 'txt', 'html', 'xml', '1pux']);
const noop = () => {};

// ---- the cli: env (tests) -> setting -> PATH -> Program Files ----
function makeFindCli({ store, env = process.env, existsSync = nodeFs.existsSync } = {}) {
  return function findCli() {
    const ok = (p) => { try { return !!p && existsSync(p); } catch { return false; } };
    if (ok(env.HQ_KEEPASSXC_CLI)) return env.HQ_KEEPASSXC_CLI;
    let st = null; try { st = store && store.readSettings(); } catch { /* none */ }
    if (st && ok(st.cliPath)) return st.cliPath;
    for (const d of String(env.PATH || env.Path || '').split(path.delimiter)) {
      if (!d) continue;
      const p = path.join(d, 'keepassxc-cli.exe');
      if (ok(p)) return p;
    }
    const pf = env.ProgramFiles || env.PROGRAMFILES;
    if (pf) { const p = path.join(pf, 'KeePassXC', 'keepassxc-cli.exe'); if (ok(p)) return p; }
    return null;
  };
}

// ---- HIBP range (k-anonymity: only the first 5 hex of a SHA-1 leave the machine; padded replies; a generic User-Agent) ----
function hibpRange(prefix, { https = require('node:https'), timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^[0-9A-F]{5}$/.test(String(prefix))) { reject(new Error('bad prefix')); return; }
    let done = false;
    const end = (fn, v) => { if (!done) { done = true; fn(v); } };
    const req = https.request({
      hostname: HIBP_HOST, path: '/range/' + prefix, method: 'GET', timeout: timeoutMs,
      headers: { 'Add-Padding': 'true', 'User-Agent': 'WorkspaceHQ' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); end(reject, new Error('status ' + res.statusCode)); return; }
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 4 * 1024 * 1024) { req.destroy(new Error('too large')); return; } parts.push(c); });
      res.on('end', () => end(resolve, Buffer.concat(parts).toString('utf8')));
      res.on('error', (e) => end(reject, e));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => end(reject, e));
    req.end();
  });
}

// ---- name-only scans (never opens a file) ----
const extOf = (n) => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
function scanExportsIn(dirs, fsApi) {
  const out = [];
  for (const dir of dirs || []) {
    let ents;
    try { ents = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { continue; }   // top level only
    for (const e of ents) {
      if (!e.isFile()) continue;
      const ext = extOf(e.name);
      if (ext === 'kdbx' || !EXPORT_EXT.has(ext) || !EXPORT_NAME_RE.test(e.name)) continue;
      try { const st = fsApi.statSync(path.join(dir, e.name)); out.push({ name: e.name, dir, size: st.size, mtime: new Date(st.mtimeMs).toISOString() }); } catch { /* vanished */ }
    }
  }
  return out;
}
function scanConflictsIn(vaultPath, fsApi) {
  if (!vaultPath) return 0;
  const base = path.basename(vaultPath).replace(/\.kdbx$/i, '');
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.sync-conflict-.*\\.kdbx$', 'i');
  try { return fsApi.readdirSync(path.dirname(vaultPath), { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).length; } catch { return 0; }
}

function create(opts = {}) {
  const {
    store, spawn = cp.spawn, now = () => new Date(), randomBytes = nodeCrypto.randomBytes,
    existsSync = nodeFs.existsSync, fs: fsApi = nodeFs, env = process.env, trash = null, log = noop,
    timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, execPath = process.execPath,
  } = opts;
  const fetchRange = opts.fetchRange || ((p) => hibpRange(p));
  const findCli = opts.findCli || makeFindCli({ store, env, existsSync });
  const resolveCore = async () => (typeof opts.getCore === 'function' ? opts.getCore() : opts.core);
  let running = false;
  let lastScan = [];

  // run the cli once; resolves with the raw outcome, never rejects. The passphrase is written to stdin and nowhere else.
  function runCli(cli, args, passphrase) {
    return new Promise((resolve) => {
      const isScript = /\.(mjs|js)$/i.test(cli);   // a script runs under Node (tests' fake cli); a .cmd/.bat is refused earlier
      const cmd = isScript ? execPath : cli;
      const argv = isScript ? [cli, ...args] : args;
      let child;
      try { child = spawn(cmd, argv, { shell: false, windowsHide: true, env: { ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { resolve({ spawnError: true }); return; }
      const chunks = []; let bytes = 0; let overflow = false; let timedOut = false; let errText = ''; let settled = false;
      const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
      const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* gone */ } }, timeoutMs);
      if (timer.unref) timer.unref();
      child.on('error', () => finish({ spawnError: true }));
      child.stdout.on('data', (c) => {
        if (overflow) return;
        bytes += c.length;
        if (bytes > maxBytes) { overflow = true; chunks.length = 0; try { child.kill(); } catch { /* gone */ } return; }
        chunks.push(c);
      });
      child.stdout.on('error', noop);
      child.stderr.on('data', (c) => { if (errText.length < 4096) errText += c.toString('utf8'); });   // classified, then dropped; never stored
      child.stderr.on('error', noop);
      child.on('close', (code) => {
        const stdout = overflow || timedOut ? null : Buffer.concat(chunks).toString('utf8');
        chunks.length = 0;
        finish({ code, stdout, stderr: errText, overflow, timedOut });
        errText = '';
      });
      // a cli that exits before reading must not raise an unhandled EPIPE: the listener goes on BEFORE the write
      child.stdin.on('error', noop);
      try { child.stdin.write(passphrase + '\n'); child.stdin.end(); } catch { /* the close event reports it */ }
    });
  }

  function classifyFailure(r) {
    if (r.spawnError) return 'KeePassXC could not be started';
    if (r.overflow) return 'the export is too large (attachments in the vault?)';
    if (r.timedOut) return 'KeePassXC took too long (60 s) and was stopped';
    if (/invalid credentials/i.test(r.stderr || '')) return 'wrong passphrase or key file';
    if (!r.stdout) return 'wrong passphrase or key file, or KeePassXC could not open the vault';   // the cli is localised: unrecognised text, empty stdout
    return 'KeePassXC could not read the vault';
  }

  async function mapLimit(items, limit, fn) {
    let i = 0;
    const worker = async () => { while (i < items.length) { const item = items[i++]; await fn(item); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  async function run(passphrase, checkBreaches) {
    const settings = store.readSettings();
    if (!settings.vaultPath) return { error: 'no vault chosen: set the vault file in Security settings' };
    if (!existsSync(settings.vaultPath)) return { error: 'vault file not found' };
    if (settings.keyFilePath && !existsSync(settings.keyFilePath)) return { error: 'key file not found' };
    const cli = findCli();
    if (!cli) return { error: 'KeePassXC is not installed' };
    if (/\.(cmd|bat)$/i.test(cli)) return { error: 'the KeePassXC cli must be keepassxc-cli.exe (a .cmd or .bat cannot be run)' };
    const core = await resolveCore();
    if (!core) return { error: 'the security engine is not available' };

    const args = ['export', '--format', 'xml', '-q', settings.vaultPath];
    if (settings.keyFilePath) args.push('--key-file', settings.keyFilePath);
    const r = await runCli(cli, args, passphrase);
    if (r.spawnError || r.overflow || r.timedOut || r.code !== 0) { r.stdout = null; return { error: classifyFailure(r) }; }

    let xml = r.stdout; r.stdout = null;
    let parsed = core.parseKeepassXml(xml);
    xml = null;
    if (!parsed || parsed.error) return { error: (parsed && parsed.error) || 'unreadable export' };

    const notes = [];
    let refKey = null;
    try { refKey = store.getRefKey({ create: true }); } catch { refKey = null; }
    if (!refKey) notes.push('locked: secure storage is unavailable, so identities are not recorded');
    let reuseKey = randomBytes(32);
    let reduced = core.reduceEntries(parsed.entries, { now: now(), reuseKey, refKey });
    parsed = null; reuseKey = null;
    let hashes = reduced.hashes instanceof Map ? reduced.hashes : new Map();
    const accounts = reduced.accounts.map((a) => ({ ...a, breached: null }));
    const identities = reduced.identities || [];
    reduced = null;

    let breachChecked = false;
    if (checkBreaches) {
      const byPrefix = new Map();   // prefix -> [{ id, sha }]
      for (const [id, sha] of hashes) {
        const p = String(sha).slice(0, 5).toUpperCase();
        if (!byPrefix.has(p)) byPrefix.set(p, []);
        byPrefix.get(p).push({ id, sha: String(sha).toUpperCase() });
      }
      const byId = new Map(accounts.map((a) => [a.id, a]));
      let failed = false;
      await mapLimit([...byPrefix.keys()], BREACH_CONCURRENCY, async (prefix) => {
        let body;
        try { body = await fetchRange(prefix); } catch { failed = true; return; }
        if (typeof body !== 'string') { failed = true; return; }
        for (const { id, sha } of byPrefix.get(prefix)) { const a = byId.get(id); if (a) a.breached = !!core.breachMatch(sha, body); }
        body = null;
      });
      breachChecked = !failed;
      if (failed) notes.push('breach check incomplete');
    }
    hashes.clear(); hashes = null;

    const at = now().toISOString();
    try {
      const map = store.writeMap({ refreshedAt: at, accounts, identities });
      if (typeof store.attachCore === 'function') store.attachCore(core);
      store.appendSnapshot(core.snapshotOf(map, store.readOwner(), now()));
      store.writeStatus({ refreshedAt: at, breachCheckedAt: breachChecked ? at : null });
    } catch { return { error: 'could not save the result' }; }
    return { ok: true, accounts, breachChecked, notes };
  }

  async function refresh(arg) {
    if (running) return { error: 'a refresh is already running' };
    running = true;
    let passphrase = arg && typeof arg.passphrase === 'string' ? arg.passphrase : '';
    try {
      if (!passphrase) return { error: 'enter the vault passphrase' };
      if (passphrase.length > MAX_PASS) return { error: 'the passphrase is too long' };
      if (/[\r\n]/.test(passphrase)) return { error: 'the passphrase must be a single line' };
      return await run(passphrase, !!(arg && arg.checkBreaches));
    } catch { return { error: 'refresh failed' }; }
    finally { passphrase = null; running = false; }
  }

  function scanExports({ dirs } = {}) {
    lastScan = scanExportsIn(dirs, fsApi);
    return lastScan.map((f) => ({ ...f }));
  }
  const scanConflicts = (vaultPath) => scanConflictsIn(vaultPath, fsApi);

  async function trashExport(name, dir) {
    if (typeof name !== 'string' || typeof dir !== 'string') return { error: 'bad file' };
    const hit = lastScan.find((f) => f.name === name && f.dir === dir);
    if (!hit) return { error: 'that file is not in the latest scan' };
    if (typeof trash !== 'function') return { error: 'the Recycle Bin is not available' };
    try { await trash(path.join(hit.dir, hit.name)); } catch { return { error: 'could not move it to the Recycle Bin' }; }
    lastScan = lastScan.filter((f) => f !== hit);
    try { log('moved a plain export to the Recycle Bin'); } catch { /* the log never blocks */ }
    return { ok: true };
  }

  return { refresh, findCli, scanExports, scanConflicts, trashExport, limits: { maxBytes, timeoutMs, maxPassphrase: MAX_PASS, breachConcurrency: BREACH_CONCURRENCY } };
}

module.exports = { create, makeFindCli, hibpRange, EXPORT_NAME_RE, MAX_BYTES, TIMEOUT_MS };
