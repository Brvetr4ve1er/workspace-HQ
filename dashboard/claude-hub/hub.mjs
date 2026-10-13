// dashboard/claude-hub/hub.mjs
// Claude Hub process (spec §6). Spawned by dashboard/claude-hub-host.js on system Node ≥ 22.13:
//   node --no-warnings dashboard/claude-hub/hub.mjs --db <file>        (env: HQ_CLAUDE_HOME, HQ_HUB_SWEEP_MS)
// stdin: one JSON request per line {id, op, args}. stdout: one JSON line per response {id, ok, result|error} or
// event {event, data} (ready | progress | changed | error). stderr: diagnostics only.
// One writer per database (a <db>.lock holding the pid); any other Hub on the same db is a read-only reader
// (e.g. a test instance of the app while the owner's app runs): no ingest, no watch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { backfill, ingestFile, sweep, watchRoot } from './ingest-code.mjs';

export const resolveClaudeRoot = (env = process.env) => path.join(env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude'), 'projects');

const READER_WAIT_MS = 5000;   // a reader whose read-only open fails keeps trying this long (the owner may still be creating/migrating the file)
const READER_RETRY_MS = 250;
const SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');   // built, not spelled: some tools rewrite the escapes into raw characters
const msg = (e) => String((e && e.message) || e).slice(0, 300);

// ---- single-writer lock -------------------------------------------------------------------------------------------
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The pid in the lock file; 0 when it names no process (absent, empty, garbage); -1 when it cannot be read at all.
// A starting writer creates the file empty and writes its pid a moment later, so empty content is re-read for ~200 ms
// before it counts as "its creator died mid-write" — otherwise a second Hub would steal a lock that is being filled in.
function readLockPid(lockFile) {
  for (let i = 0; i < 6; i++) {
    let pid;
    try { pid = Number(fs.readFileSync(lockFile, 'utf8').trim()); }
    catch (e) { return e.code === 'ENOENT' ? 0 : -1; }
    if (Number.isInteger(pid) && pid > 0) return pid;
    if (i < 5) nap(40);
  }
  return 0;
}

export function acquireLock(lockFile) {
  for (let i = 0; i < 3; i++) {
    let fd = null;
    try { fd = fs.openSync(lockFile, 'wx'); }
    catch (e) { if (e.code !== 'EEXIST') return false; }
    if (fd !== null) {
      try { fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
      catch { try { fs.closeSync(fd); fs.unlinkSync(lockFile); } catch { /* nothing more to undo */ } return false; }
    }
    const pid = readLockPid(lockFile);
    if (pid < 0) return false;
    if (pid > 0 && pid !== process.pid && alive(pid)) return false;
    // Stale: its writer is dead (or never finished writing the pid). Re-check right before removing so a lock that
    // was replaced in the meantime by a live writer is not removed from under it.
    if (pid > 0 && readLockPid(lockFile) !== pid) continue;
    try { fs.unlinkSync(lockFile); } catch (e) { if (e.code !== 'ENOENT') return false; }
  }
  return false;
}

function releaseLock(lockFile) {
  try { if (Number(fs.readFileSync(lockFile, 'utf8').trim()) === process.pid) fs.unlinkSync(lockFile); } catch { /* gone, or not ours */ }
}

// ---- the process --------------------------------------------------------------------------------------------------
function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dbFile = arg('--db') || process.env.HQ_CLAUDE_DB;
  if (!dbFile) { process.stderr.write('hub: --db <file> is required\n'); process.exit(2); }
  const root = resolveClaudeRoot();
  const lockFile = dbFile + '.lock';

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

  process.on('exit', () => {   // every way out: stdin closed, signal, crash, process.exit()
    clearInterval(sweepTimer); clearTimeout(readerTimer); clearTimeout(changedTimer);
    try { watcher && watcher.close(); } catch { /* closing */ }
    try { store && store.close(); } catch { /* closing */ }
    if (writer) releaseLock(lockFile);
  });
  const shutdown = () => { stopping = true; process.exit(0); };

  // ---- open the index: one writer, any number of readers
  try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch (e) { return fatal('cannot create ' + path.dirname(dbFile) + ': ' + msg(e)); }
  writer = acquireLock(lockFile);
  if (writer) {
    try { store = openStore(dbFile); }
    catch (e) { return fatal('cannot open the index: ' + msg(e)); }   // the host restarts a Hub that exits
  } else {
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

  // ---- changes: batched into one `changed` event per burst
  const changedIds = new Set();
  const markChanged = (ids) => {
    for (const id of ids) changedIds.add(id);
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => { emit('changed', { ids: [...changedIds] }); changedIds.clear(); }, 300);
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

  function startWatching() {
    if (watcher || sweepTimer || stopping) return;
    watcher = watchRoot(root, (file) => {
      serial(() => ingestFile(store, root, file))
        .then((r) => { if (r.added || r.reset) markChanged(['code:' + path.basename(file, '.jsonl')]); }, fail);
    });
    sweepTimer = setInterval(() => {   // the safety net behind fs.watch (missed events, a dead watcher)
      if (sweeping) return;
      sweeping = true;
      serial(() => sweep(store, root))
        .then((ids) => { lastError = null; if (ids.length) markChanged(ids); }, fail)
        .finally(() => { sweeping = false; });
    }, Math.max(100, Number(process.env.HQ_HUB_SWEEP_MS) || 60000));
  }

  // One backfill job at a time. A reindex asks for a reset: if a run is in flight it winds down (it stops between files),
  // then the same job clears the code index — inside the queue, never under an ingest — and starts over. Failures end up
  // in lastError, never as an unhandled rejection.
  function runIndex() {
    if (running) return;
    running = true; state = 'indexing';
    serial(async () => {
      do {
        if (resetNext) { resetNext = false; store.resetCode(); progress = { done: 0, total: 0 }; }
        await backfill(store, root, { shouldStop: () => stopping || resetNext, onProgress });
      } while (resetNext && !stopping);
    }).then(() => { lastError = null; }, fail)
      .finally(() => { running = false; state = 'ready'; startWatching(); });
  }

  const notOwner = () => { throw new Error('read-only hub (another WorkspaceHQ owns the index)'); };
  const ops = {
    health: () => ({ state, role: writer ? 'writer' : 'reader', node: process.version, backfill: progress,
      counts: store ? store.counts() : { projects: 0, conversations: 0, messages: 0 }, dbBytes: dbBytes(),
      lastError: lastError || (store && store.getMeta('last_error')) || null }),
    listProjects: (a) => (store ? store.listProjects(a) : []),
    listConversations: (a) => (store ? store.listConversations(a) : []),
    getConversation: (a) => (store ? store.getConversation(a) : null),
    search: (a) => (store ? store.search(a) : []),
    reindex: () => { if (!writer) notOwner(); resetNext = true; progress = { done: 0, total: 0 }; runIndex(); return { started: true }; },
    // forget writes, so it takes its turn in the queue: run beside an in-flight ingest of the same transcript, it would be
    // undone by that ingest's remaining batches (they re-create the rows it removed; the tombstone is only checked on
    // entry) while still answering "true". Queued behind the ingest, the tombstone is in place before any later one starts.
    // The answer therefore waits for the slot in progress (a live append: one file; the first backfill: the whole run).
    forget: (a) => { if (!writer) notOwner(); return serial(() => store.forget(a)); },
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
  if (writer) runIndex();
}

// Entry check on REAL paths: import.meta.url is the realpath of this file, process.argv[1] may reach it through a
// junction/symlink — comparing them raw would skip main() and let the process exit 0 without a word.
const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main();
