// dashboard/claude-hub/hub.mjs
// Claude Hub process (spec §6). Spawned by dashboard/claude-hub-host.js on system Node ≥ 22.13:
//   node --no-warnings dashboard/claude-hub/hub.mjs --db <file>        (env: HQ_CLAUDE_HOME, HQ_HUB_SWEEP_MS)
// stdin: one JSON request per line {id, op, args}. stdout: one JSON line per response {id, ok, result|error} or
// event {event, data} (ready | progress | changed | error). stderr: diagnostics only.
// One writer per database (a <db>.lock holding {"pid","db"}); any other Hub on the same db is a read-only reader
// (e.g. a test instance of the app while the owner's app runs): no ingest, no watch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { backfill, ingestTracked, sweep, watchRoot, INDEX_VERSION } from './ingest-code.mjs';
import { readHqProjects, autoLink } from './link.mjs';

export const resolveClaudeRoot = (env = process.env) => path.join(env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude'), 'projects');

const CHANGED_MAX_WAIT_MS = 2000;   // a burst of changes is reported at the latest this long after its first one
const READER_WAIT_MS = 5000;   // a reader whose read-only open fails keeps trying this long (the owner may still be creating/migrating the file)
const READER_RETRY_MS = 250;
const SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');   // built, not spelled: some tools rewrite the escapes into raw characters
const msg = (e) => String((e && e.message) || e).slice(0, 300);

// ---- single-writer lock -------------------------------------------------------------------------------------------
// <db>.lock holds {"pid":N,"db":"<absolute db path>"} (a plain "N" from an older Hub is still read). A hard kill leaves it
// behind: libuv puts spawned children in a KILL_ON_JOB_CLOSE job object, so Stop-Process -Force on the app (tools\
// rollback.ps1, a crash) ends the Hub before its exit handler runs — and Windows reuses pids. A live pid in the lock is
// therefore the owner only when it is node.exe running hub.mjs on this same db; any other process is a stale lock.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const HUB_SCRIPT = path.basename(fileURLToPath(import.meta.url)).toLowerCase();   // 'hub.mjs', however it was reached

// the pid a lock file's content names (JSON or the older plain number); 0 when it names none (empty, half-written, garbage)
const lockPid = (text) => {
  const t = String(text).trim();
  let v = t;
  if (t.startsWith('{')) { try { v = JSON.parse(t).pid; } catch { return 0; } }
  const pid = Number(v);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
};

// The pid in the lock file; 0 when it names no process (absent, empty, garbage); -1 when it cannot be read at all.
// A starting writer creates the file empty and writes its pid a moment later, so empty content is re-read for ~200 ms
// before it counts as "its creator died mid-write" — otherwise a second Hub would steal a lock that is being filled in.
function readLockPid(lockFile) {
  for (let i = 0; i < 6; i++) {
    let pid;
    try { pid = lockPid(fs.readFileSync(lockFile, 'utf8')); }
    catch (e) { return e.code === 'ENOENT' ? 0 : -1; }
    if (pid > 0) return pid;
    if (i < 5) nap(40);
  }
  return 0;
}

// A Windows command line → argv, by the CommandLineToArgvW rules Node's own quoting follows: whitespace splits outside
// quotes; 2n backslashes + '"' → n backslashes and a quote that toggles quoting; 2n+1 → n backslashes and a literal '"';
// backslashes not followed by '"' are literal.
export function splitCommandLine(s) {
  const out = [];
  let cur = '', quoted = false, any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') { cur += '\\'.repeat(n >> 1); if (n & 1) cur += '"'; else quoted = !quoted; }
      else { cur += '\\'.repeat(n); i--; }
      any = true;
    } else if (c === '"') { quoted = !quoted; any = true; }
    else if (!quoted && (c === ' ' || c === '\t')) { if (any) { out.push(cur); cur = ''; any = false; } }
    else { cur += c; any = true; }
  }
  if (any) out.push(cur);
  return out;
}

// { name, commandLine } of a pid; null when there is no such process; throws when the question cannot be asked (another
// platform, no PowerShell, a broken WMI, the 5 s timeout). Asked only when a lock names a live pid.
export function inspectProcess(pid) {
  if (process.platform !== 'win32') throw new Error('no process query on ' + process.platform);
  // by absolute path (no PATH lookup); %windir% rather than %SystemRoot%, which node itself needs to start at all
  const ps = path.join(process.env.windir || process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    "Get-CimInstance Win32_Process -Filter 'ProcessId=" + Number(pid) + "' | Select-Object Name,CommandLine | ConvertTo-Json -Compress";
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('powershell exited ' + r.status + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 160) : ''));
  const out = String(r.stdout || '').trim();
  if (!out) return null;
  const j = JSON.parse(out);
  return { name: String((j && j.Name) || ''), commandLine: j && typeof j.CommandLine === 'string' ? j.CommandLine : null };
}

// same file, compared on real paths (8.3 short names, junctions) and case-insensitively; a relative path resolves against
// this process's cwd (the host always passes an absolute --db)
const realLower = (p) => { const r = path.resolve(p); try { return fs.realpathSync.native(r).toLowerCase(); } catch { return r.toLowerCase(); } };

// Is the live `pid` the writer of the index at dbFile? { owner, note } — the note says why a lock was reclaimed, or why
// it was trusted without being verified.
function lockOwner(pid, dbFile, inspect) {
  let info;
  try { info = inspect(pid); }
  catch (e) { return { owner: true, note: 'could not check the index lock owner (pid ' + pid + ': ' + msg(e) + '), assumed live' }; }
  if (!info) return { owner: false, note: null };   // it exited after the liveness check: an ordinary stale lock
  if (!/^node(\.exe)?$/i.test(info.name)) return { owner: false, note: 'reclaimed a stale index lock (pid ' + pid + ' was ' + (info.name || 'another program') + ')' };
  if (info.commandLine === null) return { owner: true, note: 'could not read the command line of pid ' + pid + ' (' + info.name + '), assumed it owns the index lock' };
  const argv = splitCommandLine(info.commandLine);
  const at = argv.findIndex((a, k) => k > 0 && path.win32.basename(a).toLowerCase() === HUB_SCRIPT);
  if (at < 0) return { owner: false, note: 'reclaimed a stale index lock (pid ' + pid + ' was ' + info.name + ', not a Claude Hub)' };
  const d = argv.indexOf('--db', at + 1);
  // no --db: the HQ_CLAUDE_DB form — the lock file's own path already names the db
  if (d < 0 || d + 1 >= argv.length || realLower(argv[d + 1]) === realLower(dbFile)) return { owner: true, note: null };
  return { owner: false, note: 'reclaimed a stale index lock (pid ' + pid + ' is a Claude Hub on another index)' };
}

// true when this process now holds the lock. note(text) hears every reclaim of a lock whose pid was alive and every
// owner that could not be verified (the query failed: then a live pid counts as the owner, as before).
export function acquireLock(lockFile, { dbFile = lockFile.replace(/\.lock$/i, ''), inspect = inspectProcess, note = () => {} } = {}) {
  for (let i = 0; i < 3; i++) {
    let fd = null;
    try { fd = fs.openSync(lockFile, 'wx'); }
    catch (e) { if (e.code !== 'EEXIST') return false; }
    if (fd !== null) {
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, db: path.resolve(dbFile) })); fs.closeSync(fd); return true; }
      catch { try { fs.closeSync(fd); fs.unlinkSync(lockFile); } catch { /* nothing more to undo */ } return false; }
    }
    const pid = readLockPid(lockFile);
    if (pid < 0) return false;
    if (pid > 0 && pid !== process.pid && alive(pid)) {
      const o = lockOwner(pid, dbFile, inspect);
      if (o.note) note(o.note);
      if (o.owner) return false;
    }
    // Stale: its writer is dead, is no Hub of this index, or never finished writing the pid. Re-check right before
    // removing so a lock that was replaced in the meantime by a live writer is not removed from under it.
    if (pid > 0 && readLockPid(lockFile) !== pid) continue;
    try { fs.unlinkSync(lockFile); } catch (e) { if (e.code !== 'ENOENT') return false; }
  }
  return false;
}

function releaseLock(lockFile) {
  try { if (lockPid(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch { /* gone, or not ours */ }
}

// ---- the process --------------------------------------------------------------------------------------------------
function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dbFile = arg('--db') || process.env.HQ_CLAUDE_DB;
  if (!dbFile) { process.stderr.write('hub: --db <file> is required\n'); process.exit(2); }
  const root = resolveClaudeRoot();
  const lockFile = dbFile + '.lock';
  const latestFile = arg('--latest') || process.env.HQ_HUB_LATEST || null;   // the WorkspaceHQ scan the linker reads; absent = auto-link off

  // U+2028/U+2029 are legal inside a JSON string but line readers (the host's readline) split on them: escape them.
  const send = (o) => {
    let s;
    try { s = JSON.stringify(o); }
    catch { if (o.id === undefined) return; s = JSON.stringify({ id: o.id, ok: false, error: 'result cannot be serialised' }); }
    try { process.stdout.write(s.replace(SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16)) + '\n'); } catch { /* parent gone */ }
  };
  const emit = (event, data) => send({ event, data });
  const diag = (text) => { try { process.stderr.write('hub: ' + text + '\n'); } catch { /* parent gone */ } };

  let store = null, writer = false, state = 'indexing', progress = { done: 0, total: 0 }, lastError = null;
  let stopping = false, watcher = null, sweepTimer = null, readerTimer = null, changedTimer = null;
  let readerNote = null, rebuild = false;

  process.on('exit', () => {   // every way out: stdin closed, signal, crash, process.exit()
    clearInterval(sweepTimer); clearTimeout(readerTimer); clearTimeout(changedTimer);
    try { watcher && watcher.close(); } catch { /* closing */ }
    try { store && store.close(); } catch { /* closing */ }
    if (writer) releaseLock(lockFile);
  });
  const shutdown = () => { stopping = true; process.exit(0); };

  // ---- open the index: one writer, any number of readers
  try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch (e) { return fatal('cannot create ' + path.dirname(dbFile) + ': ' + msg(e)); }
  const lockNotes = [];
  writer = acquireLock(lockFile, { dbFile, note: (t) => { lockNotes.push(t); diag(t); } });
  if (writer) {
    lastError = lockNotes.join('; ') || null;   // a reclaimed lock is reported while the first pass runs; the pass's success clears it
    try { store = openStore(dbFile, { indexVersion: INDEX_VERSION }); }   // a brand-new index needs no rebuild
    catch (e) { return fatal('cannot open the index: ' + msg(e)); }   // the host restarts a Hub that exits
    // An index written by older parsing/masking code keeps whatever that code let through (cursors skip ingested bytes,
    // INSERT OR IGNORE never rewrites a row): rebuild the code index through the same serial reset a reindex uses.
    const v = store.getMeta('index_version');
    rebuild = v === null || !(Number(v) >= INDEX_VERSION);
  } else {
    readerNote = lockNotes.join('; ') || null;   // e.g. the owner could not be verified: it stays visible, it explains "read-only"
    // A reader cannot create the file; if the owner has not created and migrated it yet, wait a little (never crash).
    const deadline = Date.now() + READER_WAIT_MS;
    const attempt = () => {
      if (stopping) return;
      try { store = openStore(dbFile, { readOnly: true }); lastError = null; state = 'ready'; return; }
      catch (e) {
        const gaveUp = Date.now() >= deadline;
        lastError = gaveUp ? 'read-only hub: index not available (gave up after ' + READER_WAIT_MS / 1000 + ' s): ' + msg(e)
          : 'read-only hub: waiting for the index: ' + msg(e);
        if (gaveUp) { state = 'ready'; return; }
      }
      readerTimer = setTimeout(attempt, READER_RETRY_MS);
    };
    attempt();
  }
  function fatal(message) { emit('error', { message }); diag(message); process.exitCode = 3; }   // no handles are open yet: the process ends once the lines are flushed

  const fail = (e) => { lastError = msg(e); emit('error', { message: lastError }); };

  // ---- changes: one `changed` per burst, but never later than CHANGED_MAX_WAIT_MS after the burst's first change
  const changedIds = new Set(), changedProjects = new Set();
  let changedFirst = 0;
  const flushChanged = () => {
    clearTimeout(changedTimer); changedTimer = null; changedFirst = 0;
    const data = { ids: [...changedIds] };
    if (changedProjects.size) data.projects = [...changedProjects];
    changedIds.clear(); changedProjects.clear();
    emit('changed', data);
  };
  const markChanged = (ids, projects = []) => {
    for (const id of ids) changedIds.add(id);
    for (const p of projects) changedProjects.add(p);
    const now = Date.now();
    if (!changedFirst) changedFirst = now;
    clearTimeout(changedTimer);
    changedTimer = setTimeout(flushChanged, Math.max(0, Math.min(300, changedFirst + CHANGED_MAX_WAIT_MS - now)));
  };
  const dbBytes = () => { let n = 0; for (const f of [dbFile, dbFile + '-wal']) { try { n += fs.statSync(f).size; } catch { /* absent */ } } return n; };

  // ---- indexing. Everything that writes (backfill run, watch ingest, sweep, forget) goes through one queue, so a reindex
  // never overlaps a live ingest of the same file, two ingests never interleave on the same cursor, and a forget never
  // lands in the middle of an ingest that would re-create what it removed.
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  let running = false, resetNext = false, lastProgressAt = 0, sweeping = false;
  const onProgress = (p) => {
    progress = p; const now = Date.now();
    if (p.done === p.total || now - lastProgressAt > 500) { lastProgressAt = now; emit('progress', p); }
  };

  // ---- links: auto-match against the latest scan; only none/auto rows move (link.mjs)
  let latestMtime = -1;
  const relink = (force = false) => {
    if (!latestFile || !store || !writer || stopping) return Promise.resolve();
    let m = 0;
    try { m = fs.statSync(latestFile).mtimeMs; } catch { m = 0; }
    if (!force && m === latestMtime) return Promise.resolve();
    latestMtime = m;
    return serial(() => autoLink(store, readHqProjects(latestFile)))
      .then((r) => { if (r.linked || r.cleared) markChanged([], ['*']); }, fail);
  };

  function startWatching() {
    if (watcher || sweepTimer || stopping) return;
    watcher = watchRoot(root, (file) => {
      serial(() => ingestTracked(store, root, file))
        .then((r) => { if (r.added || r.reset || r.titled) markChanged(['code:' + path.basename(file, '.jsonl')]); }, fail);
    });
    sweepTimer = setInterval(() => {   // the safety net behind fs.watch (missed events, a dead watcher)
      if (sweeping) return;
      sweeping = true;
      serial(() => sweep(store, root))
        .then((ids) => { lastError = null; if (ids.length) markChanged(ids); }, fail)
        .finally(() => { sweeping = false; relink(); });
    }, Math.max(100, Number(process.env.HQ_HUB_SWEEP_MS) || 60000));
  }

  // One backfill job at a time. A reindex asks for a reset: if a run is in flight it winds down (it stops between files),
  // then the same job clears the code index — inside the queue, never under an ingest — and starts over. Failures end up
  // in lastError, never as an unhandled rejection.
  function runIndex() {
    if (running) return;
    running = true; state = 'indexing';
    let didReset = false;
    serial(async () => {
      do {
        // the version is stamped only once the old rows are gone: a kill before this point rebuilds again next start
        if (resetNext) { resetNext = false; didReset = true; store.resetCode(); store.setMeta('index_version', INDEX_VERSION); progress = { done: 0, total: 0 }; }
        await backfill(store, root, { shouldStop: () => stopping || resetNext, onProgress });
      } while (resetNext && !stopping);
      if (didReset && !stopping) store.optimize();   // a full rebuild leaves many FTS segments: merge them once
    }).then(() => { lastError = null; }, fail)
      .finally(() => { running = false; state = 'ready'; startWatching(); relink(true); });
  }

  const metaOrNull = (k) => { try { return (store && store.getMeta(k)) || null; } catch { return null; } };   // health must answer even when the meta table is broken (lastError says why)
  const notOwner = () => { throw new Error('read-only hub (another WorkspaceHQ owns the index)'); };
  const ops = {
    health: () => ({ state, role: writer ? 'writer' : 'reader', node: process.version, backfill: progress,
      counts: store ? store.counts() : { projects: 0, conversations: 0, messages: 0 }, dbBytes: dbBytes(),
      lastError: lastError || readerNote || (store && store.getMeta('last_error')) || null,
      lastErrorAt: metaOrNull('last_error_at') }),   // H1's fields unchanged + lastErrorAt
    stats: (a) => (store ? store.stats(a) : { from: a.from, to: a.to, tzOffsetMin: 0, days: [], projects: [],
      totals: { chats: 0, active_ms: 0, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 } }),
    link: (a) => {
      if (!writer) notOwner();
      if (!['confirmed', 'rejected', 'none'].includes(a.state)) throw new Error('link: state must be confirmed, rejected or none');
      return serial(() => store.setLink(a)).then((ok) => { if (ok) markChanged([], [a.projectId]); return ok; });
    },
    listProjects: (a) => (store ? store.listProjects(a) : []),
    listConversations: (a) => (store ? store.listConversations(a) : []),
    getConversation: (a) => (store ? store.getConversation(a) : null),
    search: (a) => (store ? store.search(a) : []),
    reindex: () => { if (!writer) notOwner(); resetNext = true; progress = { done: 0, total: 0 }; runIndex(); return { started: true }; },
    // forget writes, so it takes its turn in the queue: run beside an in-flight ingest of the same transcript, it would be
    // undone by that ingest's remaining batches (they re-create the rows it removed; the tombstone is only checked on
    // entry) while still answering "true". Queued behind the ingest, the tombstone is in place before any later one starts.
    // The answer therefore waits for the slot in progress (a live append: one file; the first backfill: the whole run).
    forget: (a) => { if (!writer) notOwner(); return serial(() => store.forget(a)).then((ok) => { if (ok) markChanged(a.conversationId ? [a.conversationId] : [], a.projectId ? [a.projectId] : []); return ok; }); },
  };

  // ---- stdin: requests, split on '\n' only (readline also splits on U+2028/U+2029, which a search query may hold)
  const handle = (line) => {
    let req;
    try { req = JSON.parse(line); } catch { diag('dropped a request line that is not JSON'); return; }
    if (!req || typeof req !== 'object' || typeof req.id !== 'number') { diag('dropped a request without a numeric id'); return; }
    const fn = Object.prototype.hasOwnProperty.call(ops, req.op) ? ops[req.op] : null;
    if (!fn) { send({ id: req.id, ok: false, error: 'unknown op' }); return; }
    // An op returns its result, or a promise of it (the ones that go through the write queue). Plain results are answered
    // at once, in the order the requests arrived; a promise is answered when it settles, so the response can come after
    // later requests' responses. Either way a failure is an {ok:false} response, never an unhandled rejection.
    const ok = (result) => send({ id: req.id, ok: true, result });
    const bad = (e) => send({ id: req.id, ok: false, error: msg(e) });
    let out;
    try { out = fn(req.args || {}); } catch (e) { bad(e); return; }
    if (out && typeof out.then === 'function') out.then(ok, bad); else ok(out);
  };
  const decoder = new StringDecoder('utf8');
  let pending = '';
  process.stdin.on('data', (chunk) => {
    pending += decoder.write(chunk);
    let i;
    while ((i = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 1); if (line.trim()) handle(line); }
  });
  for (const ev of ['end', 'close', 'error']) process.stdin.on(ev, shutdown);   // the parent is gone
  process.stdout.on('error', shutdown);                                        // EPIPE
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK']) process.on(sig, shutdown);

  emit('ready', { role: writer ? 'writer' : 'reader' });
  if (writer) { if (rebuild) resetNext = true; runIndex(); }
}

// Entry check on REAL paths: import.meta.url is the realpath of this file, process.argv[1] may reach it through a
// junction/symlink — comparing them raw would skip main() and let the process exit 0 without a word.
const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main();
