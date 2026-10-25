// dashboard/claude-hub/hub.test.mjs
// Black-box tests for the Hub process: every case spawns the real hub.mjs on the system Node against a
// placeholder ~/.claude (HQ_CLAUDE_HOME) and a temp db. Nothing here touches the owner's index or transcripts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeClaudeHome, userLine, titleLine } from './__fixtures__/make-fixture.mjs';
import { zipFiles, exportJson } from './__fixtures__/make-export.mjs';
import { makeDocsHome, historyLine } from './__fixtures__/make-docs.mjs';
import { writeChatGPTZip } from './__fixtures__/make-chatgpt-export.mjs';
import { openStore } from './store.mjs';
import { backfill, INDEX_VERSION } from './ingest-code.mjs';
import { acquireLock, resolveClaudeRoot, splitCommandLine } from './hub.mjs';

const HUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.mjs');
const dirs = [], procs = new Set();
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);   // line/paragraph separators, built rather than spelled
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const NO_QUERY = !WIN && 'the lock-owner check queries Windows processes';

// the lock file's content: {pid, db} (or the older plain pid)
const lockOf = (file) => { const t = fs.readFileSync(file, 'utf8').trim(); return t.startsWith('{') ? JSON.parse(t) : { pid: Number(t) }; };
// A live process the lock check takes for a Hub of `db` (node.exe running a script named hub.mjs with --db <db>) that never
// opens the index: "another WorkspaceHQ" that has not created or migrated the file yet.
function standInHub(dir, db, body = 'setTimeout(() => {}, 120000);') {
  const d = fs.mkdtempSync(path.join(dir, 'stand-in-'));
  const script = path.join(d, 'hub.mjs');
  fs.writeFileSync(script, body);
  const p = spawn(process.execPath, [script, '--db', db], { stdio: ['ignore', 'pipe', 'ignore'] });
  procs.add(p);
  return p;
}
// a live process that is not node at all (what a reused pid usually is)
function otherProgram() {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 60'], { stdio: 'ignore', windowsHide: true });
  procs.add(p);
  return p;
}

after(async () => {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  await Promise.all([...procs].map((p) => (p.exitCode === null && p.signalCode === null ? new Promise((r) => p.once('exit', r)) : null)));
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ } }
});

function startHub(env, db, { script = HUB } = {}) {
  const args = ['--no-warnings', script, ...(db ? ['--db', db] : [])];
  const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  procs.add(p);
  const exited = new Promise((r) => p.once('exit', (code, signal) => r({ code, signal })));
  let buf = '', id = 0, raw = '', err = '';
  const waiters = new Map(), events = [];
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    raw += d; buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = JSON.parse(line);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } else if (m.event) events.push(m);
    }
  });
  p.stderr.on('data', (d) => { err += d; });
  const req = (op, args = {}, ms = 10000) => new Promise((res, rej) => {
    const n = ++id;
    const t = setTimeout(() => { waiters.delete(n); rej(new Error('no response to ' + op + ' within ' + ms + ' ms')); }, ms);
    waiters.set(n, (m) => { clearTimeout(t); res(m); });
    p.stdin.write(JSON.stringify({ id: n, op, args }) + '\n');
  });
  const until = async (pred, ms = 15000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (await pred()) return true; return false; };
  const ready = () => until(() => events.some((e) => e.event === 'ready'));
  const healthy = async (ms = 15000) => { let h; await until(async () => { h = (await req('health')).result; return h.state === 'ready'; }, ms); return h; };
  const stop = async () => {
    if (p.exitCode === null && p.signalCode === null) p.stdin.end();
    return Promise.race([exited, sleep(8000).then(() => { p.kill('SIGKILL'); return exited; })]);
  };
  return { p, req, events, until, ready, healthy, stop, exited, raw: () => raw, err: () => err };
}

test('protocol: backfill progress, health, list/search, live append → changed (writer)', async () => {
  const dir = tmp('hub-proc-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '500' }, path.join(dir, 'hub.sqlite'));
  try {
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.done === e.data.total && e.data.total === 3)));
    let health;
    for (let i = 0; i < 100; i++) { health = (await h.req('health')).result; if (health.state === 'ready') break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(health.role, 'writer'); assert.equal(health.state, 'ready'); assert.equal(health.counts.conversations, 3);
    assert.equal(health.node, process.version);
    assert.deepEqual(health.backfill, { done: 3, total: 3 });
    assert.ok(health.dbBytes > 0, 'the index file has a size');
    assert.equal(health.lastError, null);
    assert.deepEqual(h.events.find((e) => e.event === 'ready').data, { role: 'writer' });
    assert.equal((await h.req('listConversations', { limit: 10 })).result.length, 3);
    assert.equal((await h.req('search', { q: 'placeholder release' })).result[0].conversationId, 'code:sess-a1');
    assert.equal((await h.req('nope')).ok, false);
    fs.appendFileSync(files.a2, userLine({ uuid: 'a2-live', sessionId: 'sess-a2', at: '2026-10-05T10:00:00.000Z', text: 'live line' }));
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('code:sess-a2'))));
    assert.equal((await h.req('search', { q: 'live line' })).result.length, 1);
  } finally { await h.stop(); }
});

test('a second Hub on the same db becomes a read-only reader (Review Focus 2)', async () => {
  const dir = tmp('hub-two-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await a.until(() => a.events.some((e) => e.event === 'ready')));
    const b = startHub({ HQ_CLAUDE_HOME: home }, db);
    try {
      assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready')));
      const hb = (await b.req('health')).result;
      assert.equal(hb.role, 'reader');
      const re = await b.req('reindex'), fo = await b.req('forget', { conversationId: 'code:sess-a1' });
      assert.equal(re.ok, false); assert.match(re.error, /read-only hub/);
      assert.equal(fo.ok, false); assert.match(fo.error, /read-only hub/);
    } finally { await b.stop(); }
  } finally { await a.stop(); }
  assert.equal(fs.existsSync(db + '.lock'), false, 'writer removes its lock on exit');
});

test('a reader serves what the writer indexed and never ingests itself', async () => {
  const dir = tmp('hub-rdata-');
  const { home, files } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.equal((await a.healthy()).counts.conversations, 3);
    const b = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '300' }, db);
    try {
      await b.ready();
      const hb = await b.healthy();
      assert.equal(hb.role, 'reader'); assert.equal(hb.lastError, null); assert.equal(hb.counts.conversations, 3);
      assert.equal((await b.req('search', { q: 'placeholder release' })).result[0].conversationId, 'code:sess-a1');
      assert.equal((await b.req('getConversation', { id: 'code:sess-a1' })).result.conversation.title, 'Release planning');
      fs.appendFileSync(files.b1, userLine({ uuid: 'b1-more', sessionId: 'sess-b1', at: '2026-10-06T10:00:00.000Z', cwd: 'C:\\placeholder\\project-b', text: 'zebra marker' }));
      await sleep(1500);   // several of the reader's would-be sweeps
      assert.equal(b.events.filter((e) => e.event === 'changed').length, 0, 'a reader never watches or sweeps');
      assert.equal((await a.req('search', { q: 'zebra marker' })).result.length, 1, 'the writer did ingest it');
    } finally { await b.stop(); }
  } finally { await a.stop(); }
});

test('acquireLock: fresh file ({pid, db}), dead owner in either format, unreadable content', () => {
  const dir = tmp('hub-lock-');
  const lock = path.join(dir, 'x.sqlite.lock');
  assert.equal(acquireLock(lock), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(lock, 'utf8')), { pid: process.pid, db: path.join(dir, 'x.sqlite') }, 'the lock names its writer and its index');

  let asked = 0;
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;   // exited by the time spawnSync returns
  for (const held of [String(dead), JSON.stringify({ pid: dead, db: path.join(dir, 'x.sqlite') })]) {
    fs.writeFileSync(lock, held);
    assert.equal(acquireLock(lock, { inspect: () => { asked++; return null; } }), true, 'a dead owner leaves a stale lock that is taken over: ' + held);
    assert.equal(lockOf(lock).pid, process.pid);
  }
  assert.equal(asked, 0, 'a dead pid is never looked up (the ordinary restart pays nothing)');

  for (const junk of ['', 'not-a-pid', '-4', '0', '{"pid":', '{}', '{"pid":"x"}', '[]']) {
    fs.writeFileSync(lock, junk);
    assert.equal(acquireLock(lock), true, 'content that names no process is stale: ' + JSON.stringify(junk));
    assert.equal(lockOf(lock).pid, process.pid);
  }
  assert.equal(acquireLock(path.join(dir, 'no-such-dir', 'x.lock')), false, 'a lock that cannot be created is not held');
});

// A hard kill (tools\rollback.ps1, a crash) leaves the lock behind, and Windows reuses pids: a live pid owns the index only
// as a Claude Hub of this same db. Replaces the old "a live node sleeper keeps the lock" case, which inverts by design.
test('acquireLock: a live pid keeps the lock only as a Hub of the same index; node that is no Hub, another program or a Hub of another index do not', { skip: NO_QUERY }, async () => {
  const dir = tmp('hub-lockown-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite'), lock = db + '.lock';
  const notes = [];
  const take = (file = lock) => acquireLock(file, { note: (t) => notes.push(t) });

  const a = startHub({ HQ_CLAUDE_HOME: home }, db);   // a real Hub: the owner
  try {
    await a.ready();
    const held = fs.readFileSync(lock, 'utf8');
    assert.deepEqual(JSON.parse(held), { pid: a.p.pid, db });
    assert.equal(take(), false, 'a live Hub on the same db keeps the lock');
    assert.equal(fs.readFileSync(lock, 'utf8'), held, 'and its file is left alone');
    assert.deepEqual(notes, [], 'a verified owner needs no note');
    const elsewhere = path.join(dir, 'other.sqlite.lock');   // the same live Hub named in ANOTHER index's lock
    fs.writeFileSync(elsewhere, JSON.stringify({ pid: a.p.pid, db: path.join(dir, 'other.sqlite') }));
    assert.equal(take(elsewhere), true, 'a Hub of another index does not own this one');
    assert.match(notes.pop(), new RegExp('reclaimed a stale index lock \\(pid ' + a.p.pid + ' is a Claude Hub on another index\\)'));
  } finally { await a.stop(); }

  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });   // node, but no Hub
  procs.add(sleeper);
  try {
    fs.writeFileSync(lock, String(sleeper.pid));   // the older plain format
    assert.equal(take(), true, 'a node process that is not a Hub does not own the index');
    assert.equal(lockOf(lock).pid, process.pid);
    assert.match(notes.pop(), new RegExp('reclaimed a stale index lock \\(pid ' + sleeper.pid + ' was node\\.exe, not a Claude Hub\\)'));
    assert.equal(sleeper.exitCode, null, 'the process itself is left alone');
  } finally { sleeper.kill('SIGKILL'); }

  const other = otherProgram();   // a dead Hub's pid handed to something else entirely
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: other.pid, db }));
    assert.equal(take(), true, 'an unrelated live program does not own the index');
    assert.match(notes.pop(), new RegExp('reclaimed a stale index lock \\(pid ' + other.pid + ' was powershell\\.exe\\)', 'i'));
  } finally { other.kill('SIGKILL'); }
  assert.deepEqual(notes, []);
});

test('acquireLock: an owner that cannot be checked counts as live (the old rule) and the reason is reported', () => {
  const dir = tmp('hub-lockq-');
  const lock = path.join(dir, 'x.sqlite.lock');
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  procs.add(sleeper);
  try {
    const held = JSON.stringify({ pid: sleeper.pid, db: path.join(dir, 'x.sqlite') });
    fs.writeFileSync(lock, held);
    const notes = [], note = (t) => notes.push(t);
    assert.equal(acquireLock(lock, { inspect: () => { throw new Error('query timed out'); }, note }), false, 'the query failed: a live pid keeps the lock');
    assert.match(notes.pop(), new RegExp('could not check the index lock owner \\(pid ' + sleeper.pid + ': query timed out\\), assumed live'));
    assert.equal(acquireLock(lock, { inspect: () => ({ name: 'node.exe', commandLine: null }), note }), false, 'a node whose command line is unreadable is trusted');
    assert.match(notes.pop(), /could not read the command line of pid \d+ \(node\.exe\), assumed it owns the index lock/);
    assert.equal(fs.readFileSync(lock, 'utf8'), held, 'left alone both times');
    assert.equal(acquireLock(lock, { inspect: () => null, note }), false, 'the query missed a pid that is still alive: kept');
    assert.match(notes.pop(), /is alive but the process query did not see it/);
    assert.equal(fs.readFileSync(lock, 'utf8'), held, 'still left alone');
  } finally { sleeper.kill('SIGKILL'); }
});

test('splitCommandLine: the Windows quoting rules the lock check reads a Hub command line with', () => {
  assert.deepEqual(splitCommandLine('"C:\\Program Files\\nodejs\\node.exe" --no-warnings "C:\\Users\\A B\\workspace hq\\dashboard\\claude-hub\\hub.mjs" --db "C:\\Users\\A B\\data\\claude\\hub.sqlite"'),
    ['C:\\Program Files\\nodejs\\node.exe', '--no-warnings', 'C:\\Users\\A B\\workspace hq\\dashboard\\claude-hub\\hub.mjs', '--db', 'C:\\Users\\A B\\data\\claude\\hub.sqlite']);
  assert.deepEqual(splitCommandLine('node  hub.mjs\t--db x.sqlite '), ['node', 'hub.mjs', '--db', 'x.sqlite']);
  assert.deepEqual(splitCommandLine('a\\\\b "c\\"d" "e\\\\" f\\\\\\"g ""'), ['a\\\\b', 'c"d', 'e\\', 'f\\"g', '']);
});

test('resolveClaudeRoot: HQ_CLAUDE_HOME wins, else ~/.claude', () => {
  assert.equal(resolveClaudeRoot({ HQ_CLAUDE_HOME: path.join('X', 'home') }), path.join('X', 'home', 'projects'));
  assert.equal(resolveClaudeRoot({}), path.join(os.homedir(), '.claude', 'projects'));
});

test('a writer that was killed hard leaves a stale lock; the next Hub takes over as the writer', async () => {
  const dir = tmp('hub-crash-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const a = startHub({ HQ_CLAUDE_HOME: home }, db);
  await a.ready();
  assert.equal((await a.healthy()).counts.conversations, 3);
  a.p.kill('SIGKILL'); await a.exited;
  assert.equal(fs.existsSync(db + '.lock'), true, 'a hard kill runs no cleanup');
  const b = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    await b.ready();
    const hb = await b.healthy();
    assert.equal(hb.role, 'writer'); assert.equal(hb.counts.conversations, 3, 'the index survived the crash');
    assert.deepEqual(lockOf(db + '.lock'), { pid: b.p.pid, db });
  } finally { await b.stop(); }
  assert.equal(fs.existsSync(db + '.lock'), false, 'the writer removes its own {pid, db} lock on exit');
});

// The regression behind the lock rule: the writer was hard-killed (its lock stays) and Windows has since handed its pid to an
// unrelated live process. Before, every later Hub saw "a live owner" and became a read-only reader for good.
test('a stale lock whose pid now belongs to an unrelated live program is reclaimed: the new Hub is the writer', { skip: NO_QUERY }, async () => {
  const dir = tmp('hub-pidreuse-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const other = otherProgram();
  try {
    assert.ok(other.pid > 0);
    fs.writeFileSync(db + '.lock', JSON.stringify({ pid: other.pid, db }));
    const h = startHub({ HQ_CLAUDE_HOME: home }, db);
    try {
      await h.ready();
      assert.deepEqual(h.events.find((e) => e.event === 'ready').data, { role: 'writer' });
      const hh = await h.healthy();
      assert.equal(hh.role, 'writer'); assert.equal(hh.counts.conversations, 3, 'and it indexes');
      assert.deepEqual(lockOf(db + '.lock'), { pid: h.p.pid, db });
      assert.match(h.err(), new RegExp('reclaimed a stale index lock \\(pid ' + other.pid + ' was powershell\\.exe\\)', 'i'));
      assert.equal(other.exitCode, null, 'the unrelated program is left alone');
    } finally { await h.stop(); }
  } finally { other.kill('SIGKILL'); }
  assert.equal(fs.existsSync(db + '.lock'), false);
});

test('a Hub started with HQ_CLAUDE_DB (no --db on its command line) is still the live owner: the next Hub is a reader', { skip: NO_QUERY }, async () => {
  const dir = tmp('hub-envowner-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const a = startHub({ HQ_CLAUDE_HOME: home, HQ_CLAUDE_DB: db }, null);
  try {
    assert.equal((await a.healthy()).role, 'writer');
    const b = startHub({ HQ_CLAUDE_HOME: home }, db);
    try {
      await b.ready();
      assert.equal((await b.req('health')).result.role, 'reader');
      assert.doesNotMatch(b.err(), /reclaimed/);
      assert.equal(lockOf(db + '.lock').pid, a.p.pid, 'the owner keeps its lock');
    } finally { await b.stop(); }
  } finally { await a.stop(); }
});

test('when the lock owner cannot be checked, the next Hub stays a reader and health says why (until it restarts)', { skip: NO_QUERY }, async () => {
  const dir = tmp('hub-noquery-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  openStore(db).close();   // an index exists, so the reader can open it
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });   // live, would fail the check
  procs.add(sleeper);
  try {
    fs.writeFileSync(db + '.lock', JSON.stringify({ pid: sleeper.pid, db }));
    // no PowerShell under %windir%: the query fails, and the old rule (a live pid owns the lock) applies. (Windows env names
    // are case-insensitive, but a second spelling in the env block is ignored: override the one in use.)
    const winKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'WINDIR') || 'windir';
    const h = startHub({ HQ_CLAUDE_HOME: home, [winKey]: path.join(dir, 'no-windows-here') }, db);
    try {
      await h.ready();
      const hh = await h.healthy();
      assert.equal(hh.role, 'reader');
      assert.match(hh.lastError, new RegExp('could not check the index lock owner \\(pid ' + sleeper.pid + ': .*\\), assumed live'), 'the read-only state is explained, not silent');
      assert.match(h.err(), /could not check the index lock owner/);
      assert.equal(lockOf(db + '.lock').pid, sleeper.pid);
    } finally { await h.stop(); }
  } finally { sleeper.kill('SIGKILL'); }
});

// Finding: the owner's hub.sqlite was written by the cut-before-mask code. Its cursors skip every byte already ingested and
// INSERT OR IGNORE never rewrites a row, so without a rebuild the straddled fragments stay searchable for ever.
test('an index without index_version (written by older code) is rebuilt on the next writer start; a current one is not', async () => {
  const dir = tmp('hub-idxver-');
  const { home, root } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const fragment = 'sk-' + 'ant-' + 'Gh5'.repeat(5);   // a straddled key's prefix the old code let through (under the rule's 20 chars)
  const old = openStore(db);
  await backfill(old, root);   // everything ingested: every cursor sits at the end of its file
  old.addMessages('code:sess-a1', [{ id: 'code:sess-a1:leak', role: 'tool', at: '2026-10-01T10:00:30.000Z', text: 'printed ' + fragment + '…' }]);
  old.forget({ conversationId: 'code:sess-b1' });   // a forgotten chat must stay forgotten through the rebuild
  assert.equal(old.getMeta('index_version'), null);
  assert.equal(old.search({ q: 'Gh5' }).length, 1, 'the seeded fragment is searchable');
  old.close();

  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    const hh = await h.healthy();
    assert.equal(hh.role, 'writer'); assert.equal(hh.lastError, null);
    assert.deepEqual((await h.req('search', { q: 'Gh5' })).result, [], 'the fragment is gone from the index');
    assert.equal((await h.req('getConversation', { id: 'code:sess-a1' })).result.messages.some((m) => m.text.includes('sk-ant-')), false);
    assert.equal(hh.counts.conversations, 2); assert.equal(hh.counts.messages, 4, 'rebuilt from the transcripts: 3 + 1, the seeded row is not among them');
    assert.equal((await h.req('getConversation', { id: 'code:sess-b1' })).result, null, 'forgotten stays forgotten');
  } finally { await h.stop(); }

  const cur = openStore(db);
  try {
    assert.equal(cur.getMeta('index_version'), String(INDEX_VERSION), 'the rebuild stamped the version');
    cur.addMessages('code:sess-a1', [{ id: 'code:sess-a1:marker', role: 'user', at: '2026-10-01T10:00:40.000Z', text: 'sentinel kept across restarts' }]);
  } finally { cur.close(); }
  const h2 = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    await h2.healthy();
    assert.equal((await h2.req('search', { q: 'sentinel kept' })).result.length, 1, 'a current index is not rebuilt on every start');
  } finally { await h2.stop(); }
});

test('reader whose index never appears: retries ~5 s, then runs store-less with health.lastError and never exits', async () => {
  const dir = tmp('hub-noidx-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.writeFileSync(db, '');                                 // exists but was never migrated (the owner has not finished opening it)
  const holder = standInHub(dir, db);                       // a live "writer" that has not migrated it yet
  const held = JSON.stringify({ pid: holder.pid, db });
  fs.writeFileSync(db + '.lock', held);
  const t0 = Date.now();
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await h.ready());
    assert.deepEqual(h.events.find((e) => e.event === 'ready').data, { role: 'reader' });
    const early = (await h.req('health')).result;
    assert.equal(early.role, 'reader'); assert.equal(early.state, 'indexing', 'still waiting for the owner');
    assert.match(early.lastError, /waiting for the index.*no such table/i);
    const last = await h.healthy(10000);
    const waited = Date.now() - t0;
    assert.ok(waited >= 4500 && waited < 9000, 'gave up after about 5 s, not at once and not never (' + waited + ' ms)');
    assert.equal(last.role, 'reader'); assert.equal(last.state, 'ready');
    assert.match(last.lastError, /read-only.*gave up after 5 s.*no such table/i);
    assert.deepEqual(last.counts, { projects: 0, conversations: 0, messages: 0, documents: 0 });
    assert.deepEqual((await h.req('listConversations')).result, []);
    assert.deepEqual((await h.req('listProjects')).result, []);
    assert.deepEqual((await h.req('search', { q: 'placeholder' })).result, []);
    assert.equal((await h.req('getConversation', { id: 'code:sess-a1' })).result, null);
    assert.equal((await h.req('reindex')).ok, false);
    assert.equal(h.p.exitCode, null, 'the reader is still running');
  } finally { assert.equal((await h.stop()).code, 0); holder.kill('SIGKILL'); }
  assert.equal(fs.readFileSync(db + '.lock', 'utf8'), held, 'a reader never touches the writer\'s lock');
});

test('reader started before the index exists opens it once the owner has created and migrated it', async () => {
  const dir = tmp('hub-late-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const holder = standInHub(dir, db);   // the live owner, before it has created the index
  fs.writeFileSync(db + '.lock', JSON.stringify({ pid: holder.pid, db }));
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  let owner = null;
  try {
    await h.ready();
    assert.match((await h.req('health')).result.lastError, /waiting for the index.*unable to open/i);
    await sleep(700);
    owner = openStore(db);   // creates + migrates the file, as the owner's Hub does
    owner.upsertProject({ id: 'code:p', source: 'code', key: 'p', name: 'p', path: null });
    owner.ensureConversation({ id: 'code:s1', source: 'code', projectId: 'code:p', nativeId: 's1' });
    owner.addMessages('code:s1', [{ id: 'code:s1:m1', role: 'user', at: '2026-10-01T10:00:00.000Z', text: 'hello owner' }]);
    let health;
    assert.ok(await h.until(async () => { health = (await h.req('health')).result; return health.counts.conversations === 1; }, 6000), 'the reader picked the index up');
    assert.equal(health.state, 'ready'); assert.equal(health.lastError, null, 'the waiting note clears itself');
    assert.equal((await h.req('search', { q: 'hello owner' })).result.length, 1);
    assert.equal((await h.req('listConversations')).result.length, 1);
  } finally { await h.stop(); if (owner) owner.close(); holder.kill('SIGKILL'); }
});

test('a writer that cannot open its index reports it and exits non-zero without leaving a lock', async () => {
  const dir = tmp('hub-bad-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.mkdirSync(db);   // a directory where the db file should be
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  const r = await Promise.race([h.exited, sleep(10000).then(() => 'still running')]);
  assert.notEqual(r, 'still running', 'a writer without an index must exit, not carry on');
  assert.equal(r.code, 3);
  assert.ok(h.events.some((e) => e.event === 'error' && /unable to open|cannot open/i.test(e.data.message)), 'an error event names the cause');
  assert.match(h.err(), /unable to open|cannot open/i, 'and so does stderr');
  assert.equal(fs.existsSync(db + '.lock'), false);
});

test('no --db and no HQ_CLAUDE_DB is a usage error; HQ_CLAUDE_DB stands in for --db', async () => {
  const dir = tmp('hub-args-');
  const { home } = makeClaudeHome(dir);
  const none = startHub({ HQ_CLAUDE_HOME: home, HQ_CLAUDE_DB: '' }, null);
  const r = await none.exited;
  assert.equal(r.code, 2); assert.match(none.err(), /--db <file> is required/);
  const db = path.join(dir, 'viaenv.sqlite');
  const env = startHub({ HQ_CLAUDE_HOME: home, HQ_CLAUDE_DB: db }, null);
  try { assert.equal((await env.healthy()).counts.conversations, 3); assert.equal(fs.existsSync(db), true); } finally { await env.stop(); }
});

test('reindex rebuilds from scratch, a repeated or overlapping reindex never doubles work; forget removes and stays removed', async () => {
  const dir = tmp('hub-reidx-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    const before = await h.healthy();
    assert.equal(before.counts.conversations, 3);
    const msgs = before.counts.messages;
    assert.deepEqual((await h.req('reindex')).result, { started: true });
    assert.deepEqual((await h.req('reindex')).result, { started: true }, 'overlapping reindex is accepted, not run twice');
    assert.deepEqual((await h.req('reindex')).result, { started: true });
    const after = await h.healthy();
    assert.equal(after.counts.conversations, 3); assert.equal(after.counts.messages, msgs, 'no duplicate and no lost messages');
    assert.deepEqual(after.backfill, { done: 3, total: 3 });
    assert.equal(after.lastError, null);
    assert.equal(h.events.filter((e) => e.event === 'error').length, 0);
    assert.equal((await h.req('search', { q: 'placeholder release' })).result[0].conversationId, 'code:sess-a1');

    assert.equal((await h.req('forget', { conversationId: 'code:sess-b1' })).result, true);
    assert.equal((await h.req('forget', { conversationId: 'code:sess-b1' })).result, false);
    assert.equal((await h.req('listConversations')).result.length, 2);
    assert.deepEqual((await h.req('reindex')).result, { started: true });
    assert.equal((await h.healthy()).counts.conversations, 2, 'a reindex does not resurrect a forgotten conversation');
  } finally { await h.stop(); }
});

test('robust protocol: junk lines are ignored; U+2028/2029 survive in both directions and never split a line', async () => {
  const dir = tmp('hub-wire-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '500' }, path.join(dir, 'hub.sqlite'));
  try {
    await h.healthy();
    h.p.stdin.write('this is not json\n[1,2]\n{"op":"health"}\n"str"\nnull\n\n   \n');
    assert.equal((await h.req('health')).ok, true, 'still in sync after junk');
    assert.equal((await h.req('listConversations', null)).ok, true, 'null args are treated as none');
    assert.equal((await h.req('toString')).ok, false, 'inherited names are not ops');
    assert.equal((await h.req('__proto__')).ok, false);

    fs.appendFileSync(files.a2, userLine({ uuid: 'a2-ls', sessionId: 'sess-a2', at: '2026-10-05T10:00:00.000Z', text: 'needle\u2028haystack\u2029tail' }));
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('code:sess-a2'))));
    const hits = (await h.req('search', { q: 'needle\u2028haystack' })).result;   // U+2028 inside the REQUEST line
    assert.equal(hits.length, 1);
    const conv = (await h.req('getConversation', { id: 'code:sess-a2' })).result;
    assert.ok(conv.messages.some((m) => m.text === 'needle\u2028haystack\u2029tail'), 'the text itself is intact');
    assert.equal(/[\u2028\u2029]/.test(h.raw()), false, 'the RESPONSE line carries them escaped, so line readers never split it');
  } finally { await h.stop(); }
});

test('a store failure reaches the caller as an error, not as an empty result', async () => {
  const dir = tmp('hub-storeerr-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.equal((await h.healthy()).counts.conversations, 3);
    assert.equal((await h.req('search', { q: 'placeholder' })).ok, true);
    const other = openStore(db);   // a second connection breaks the index underneath the running Hub
    other.db.exec('DROP TABLE message_fts'); other.close();
    const r = await h.req('search', { q: 'placeholder' });
    assert.equal(r.ok, false); assert.match(r.error, /message_fts/);
    assert.equal(h.p.exitCode, null, 'the Hub survives its own store errors');
    assert.equal((await h.req('listConversations')).ok, true, 'other ops keep working');
  } finally { await h.stop(); }
});

test('a failing sweep is reported (error event + health.lastError), never swallowed; the Hub keeps running', async () => {
  const dir = tmp('hub-sweeperr-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '100' }, db);
  try {
    assert.equal((await h.healthy()).lastError, null);
    const other = openStore(db);   // break the index underneath the running Hub: the next sweep cannot touch its meta table
    other.db.exec('DROP TABLE meta'); other.close();
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'error' && /meta/.test(e.data.message))), 'the sweep failure was announced');
    assert.match((await h.req('health')).result.lastError, /meta/);
    assert.equal(h.p.exitCode, null);
  } finally { await h.stop(); }
});

test('a missing transcripts root: the Hub runs and health says why it holds nothing', async () => {
  const dir = tmp('hub-noroot-');
  const home = path.join(dir, 'empty-claude-home');
  fs.mkdirSync(home);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '300' }, path.join(dir, 'hub.sqlite'));
  try {
    const health = await h.healthy();
    assert.equal(health.role, 'writer'); assert.deepEqual(health.counts, { projects: 0, conversations: 0, messages: 0, documents: 0 });
    assert.match(health.lastError, /no transcripts root at .*projects/);
    assert.equal(h.p.exitCode, null);

    // Claude Code gets installed later: the sweep picks the tree up and the note clears itself (to null, not '')
    const late = path.join(home, 'projects', 'C--placeholder-late');
    fs.mkdirSync(late, { recursive: true });
    fs.writeFileSync(path.join(late, 'sess-late.jsonl'), userLine({ uuid: 'late-u1', sessionId: 'sess-late', at: '2026-10-07T10:00:00.000Z', text: 'arrived after start' }));
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('code:sess-late'))));
    const now = (await h.req('health')).result;
    assert.equal(now.counts.conversations, 1); assert.equal(now.lastError, null);
  } finally { await h.stop(); }
});

test('acquireLock: a lock file that is still being filled in is held, not stolen', async () => {
  const dir = tmp('hub-lockrace-');
  const db = path.join(dir, 'x.sqlite'), lock = db + '.lock';
  // a Hub-shaped owner (hub.mjs --db <db>) that creates the lock empty, announces it, and writes {pid, db} 80 ms later —
  // the window a second Hub can land in
  const owner = standInHub(dir, db, [
    "import fs from 'node:fs';",
    "const db = process.argv[process.argv.indexOf('--db') + 1];",
    "const fd = fs.openSync(db + '.lock', 'wx');",
    "process.stdout.write('created\\n');",
    "setTimeout(() => { fs.writeSync(fd, JSON.stringify({ pid: process.pid, db })); fs.closeSync(fd); }, 80);",
    "setTimeout(() => {}, 30000);",
  ].join('\n'));
  try {
    await new Promise((res, rej) => { owner.stdout.once('data', res); owner.once('exit', () => rej(new Error('owner exited'))); });
    assert.equal(acquireLock(lock), false, 'the half-written lock belongs to a live process');
    assert.deepEqual(lockOf(lock), { pid: owner.pid, db });
  } finally { owner.kill('SIGKILL'); }
});

test('reindex requested while a long backfill is running restarts it cleanly: no overlap, no duplicates, no errors', async () => {
  const dir = tmp('hub-bigidx-');
  const { home, root } = makeClaudeHome(dir);
  const big = path.join(root, 'C--placeholder-project-big');
  fs.mkdirSync(big);
  for (let i = 0; i < 150; i++) {
    fs.writeFileSync(path.join(big, 'bulk-' + i + '.jsonl'), userLine({ uuid: 'bulk-u' + i, sessionId: 'bulk-' + i, at: '2026-09-01T10:00:00.000Z', cwd: 'C:/placeholder/big', text: 'bulk transcript ' + i }));
  }
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.total === 153 && e.data.done < 153)), 'the backfill has started');
    const replies = await Promise.all([h.req('reindex'), h.req('reindex'), h.req('reindex')]);
    for (const r of replies) assert.deepEqual(r.result, { started: true });
    const done = await h.healthy(30000);
    assert.deepEqual(done.counts, { projects: 3, conversations: 153, messages: 155, documents: 0 });   // 5 fixture messages + 150 bulk, each exactly once
    assert.deepEqual(done.backfill, { done: 153, total: 153 });
    assert.equal(done.lastError, null);
    assert.deepEqual(h.events.filter((e) => e.event === 'error'), []);
    assert.ok(h.events.filter((e) => e.event === 'progress').every((e) => e.data.done <= e.data.total));
    assert.equal((await h.req('search', { q: 'bulk transcript 149' })).result.length, 1);
  } finally { await h.stop(); }
});

test('live appends and sweeps during a reindex queue behind it: every line lands once, nothing errors', async () => {
  const dir = tmp('hub-collide-');
  const { home, root } = makeClaudeHome(dir);
  const big = path.join(root, 'C--placeholder-project-big');
  fs.mkdirSync(big);
  const bulk = (i) => path.join(big, 'bulk-' + i + '.jsonl');
  for (let i = 0; i < 150; i++) fs.writeFileSync(bulk(i), userLine({ uuid: 'bulk-u' + i, sessionId: 'bulk-' + i, at: '2026-09-01T10:00:00.000Z', cwd: 'C:/placeholder/big', text: 'bulk transcript ' + i }));
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '100' }, path.join(dir, 'hub.sqlite'));
  try {
    assert.equal((await h.healthy(30000)).counts.conversations, 153);   // first backfill done: the watcher and the 100 ms sweep are live
    const reindexed = Promise.all([h.req('reindex'), h.req('reindex')]);
    let appended = 0;
    for (let round = 0; round < 6; round++) {   // a live session keeps writing while the rebuild runs
      for (let i = 0; i < 150; i += 15) { fs.appendFileSync(bulk(i), userLine({ uuid: 'live-' + round + '-' + i, sessionId: 'bulk-' + i, at: '2026-09-02T10:0' + round + ':00.000Z', cwd: 'C:/placeholder/big', text: 'live append ' + round + ' ' + i })); appended++; }
      await sleep(80);
    }
    await reindexed;
    assert.ok(await h.until(async () => { const x = (await h.req('health')).result; return x.state === 'ready' && x.counts.messages === 155 + appended; }, 30000), 'every appended line is indexed exactly once');
    assert.deepEqual(h.events.filter((e) => e.event === 'error'), []);
    assert.equal((await h.req('health')).result.lastError, null);
  } finally { await h.stop(); }
});

test('a reindex asked for while a live ingest of a big file is mid-stream waits for it instead of cutting under it', async () => {
  const dir = tmp('hub-midstream-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '60000' }, path.join(dir, 'hub.sqlite'));
  try {
    const base = await h.healthy();
    const N = 6000, filler = 'lorem ipsum '.repeat(60);
    let chunk = '';
    for (let i = 0; i < N; i++) chunk += userLine({ uuid: 'big-' + i, sessionId: 'sess-a2', at: '2026-10-08T10:00:00.000Z', text: 'big append ' + i + ' ' + filler });
    fs.appendFileSync(files.a2, chunk);   // ~5 MB arrives at once: the watcher's ingest of it takes a while, in 500-line batches
    let mid = null;
    assert.ok(await h.until(async () => { const x = (await h.req('health')).result; if (x.counts.messages > base.counts.messages + 100 && x.counts.messages < base.counts.messages + N - 500) { mid = x; return true; } return false; }, 20000), 'caught the ingest mid-stream');
    assert.deepEqual((await h.req('reindex')).result, { started: true });
    const done = await h.healthy(30000);
    assert.equal(done.counts.messages, base.counts.messages + N, 'the rebuilt index holds every line once');
    assert.deepEqual(h.events.filter((e) => e.event === 'error'), [], 'no ingest failed under the reset');
    assert.equal(done.lastError, null);
    assert.ok(mid);
  } finally { await h.stop(); }
});

// forget is a privacy removal: when it lands while that conversation's transcript is being ingested, the ingest's remaining
// batches used to re-create the rows it had just removed (and the Hub still answered "true"). forget now waits its turn in
// the write queue, so the answer arrives only once nothing in flight can bring the data back.
async function forgetMidStream(target, verify) {
  const dir = tmp('hub-forgetmid-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '60000' }, path.join(dir, 'hub.sqlite'));
  try {
    const base = await h.healthy();
    assert.equal(base.counts.conversations, 3); assert.equal(base.counts.messages, 5);
    const N = 6000, filler = 'lorem ipsum '.repeat(60);
    let chunk = '';
    for (let i = 0; i < N; i++) chunk += userLine({ uuid: 'big-' + i, sessionId: 'sess-a2', at: '2026-10-08T10:00:00.000Z', text: 'big append ' + i + ' ' + filler });
    fs.appendFileSync(files.a2, chunk);   // ~5 MB arrives at once: the watcher's ingest of it takes a while, in 500-line batches
    let mid = null;
    assert.ok(await h.until(async () => { const x = (await h.req('health')).result; if (x.counts.messages > base.counts.messages + 100 && x.counts.messages < base.counts.messages + N - 500) { mid = x; return true; } return false; }, 20000), 'caught the ingest mid-stream');

    const r = await h.req('forget', target, 30000);   // lands while sess-a2 is still being read
    assert.equal(r.ok, true); assert.equal(r.result, true, 'the removal is reported only because it happened');
    const ids = (await h.req('listConversations', { limit: 10 })).result.map((c) => c.id);
    assert.equal(ids.includes('code:sess-a2'), false, 'the answer comes after the in-flight ingest, so nothing re-creates the conversation');
    const done = await h.healthy(30000);
    assert.equal((await h.req('getConversation', { id: 'code:sess-a2' })).result, null, 'no partial zombie once the ingest has settled');
    assert.equal((await h.req('search', { q: 'big append' })).result.length, 0, 'none of the streamed lines survive in the index');
    await verify(h, done, base);
    assert.deepEqual(h.events.filter((e) => e.event === 'error'), []);
    assert.equal(done.lastError, null);
    assert.ok(mid);
  } finally { await h.stop(); }
}

test('forget of a conversation landing mid-ingest of its transcript stays forgotten (no zombie rows from the rest of the ingest)', async () => {
  await forgetMidStream({ conversationId: 'code:sess-a2' }, async (h, done, base) => {
    assert.deepEqual((await h.req('listConversations', { limit: 10 })).result.map((c) => c.id).sort(), ['code:sess-a1', 'code:sess-b1']);
    assert.equal(done.counts.conversations, 2);
    assert.equal(done.counts.messages, base.counts.messages - 1, 'only sess-a2 (its 1 original message and every streamed one) is gone');
  });
});

test('forget of a project landing mid-ingest of one of its transcripts stays forgotten', async () => {
  await forgetMidStream({ projectId: 'code:C--placeholder-project-a' }, async (h, done) => {
    assert.deepEqual((await h.req('listConversations', { limit: 10 })).result.map((c) => c.id), ['code:sess-b1']);
    assert.deepEqual((await h.req('listProjects')).result.map((p) => p.id), ['code:C--placeholder-project-b'], 'the project row is not re-created either');
    assert.deepEqual(done.counts, { projects: 1, conversations: 1, messages: 1, documents: 0 });
  });
});

test('a forget that fails inside the write queue is answered as an error; the queue and the Hub carry on', async () => {
  const dir = tmp('hub-forgeterr-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '60000' }, db);
  try {
    assert.equal((await h.healthy()).counts.conversations, 3);
    const other = openStore(db);   // break the index underneath the running Hub: forget cannot record its tombstone
    other.db.exec('DROP TABLE tombstone'); other.close();
    const r = await h.req('forget', { conversationId: 'code:sess-b1' });
    assert.equal(r.ok, false); assert.match(r.error, /tombstone/);
    assert.equal((await h.req('listConversations')).result.length, 3, 'the failed removal rolled back, nothing half-forgotten');
    assert.equal((await h.req('health')).ok, true);
    assert.equal(h.p.exitCode, null, 'the Hub survives a failed forget');
    const repair = openStore(db);   // the index is repaired (the store re-creates the missing table when opened): the next forget runs in the same queue
    repair.close();
    assert.equal((await h.req('forget', { conversationId: 'code:sess-b1' })).result, true, 'the write queue still runs jobs after the failed one');
    assert.equal((await h.req('listConversations')).result.length, 2);
  } finally { await h.stop(); }
});

test('starts through a junction (the entry check compares real paths)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-junction-'));   // handed to the cleanup only once the link is gone
  const { home } = makeClaudeHome(dir);
  const link = path.join(dir, 'linked-hub');
  try { fs.symlinkSync(path.dirname(HUB), link, 'junction'); } catch (e) { dirs.push(dir); t.skip('cannot create a junction here: ' + e.code); return; }
  let h = null;
  const db = path.join(dir, 'hub.sqlite');
  try {
    h = startHub({ HQ_CLAUDE_HOME: home }, db, { script: path.join(link, 'hub.mjs') });
    assert.ok(await h.ready(), 'main() ran');
    assert.equal((await h.healthy()).counts.conversations, 3);
    // the lock check reads hub.mjs by its basename: a writer reached through a junction is still the live owner
    const b = startHub({ HQ_CLAUDE_HOME: home }, db);
    try { await b.ready(); assert.equal((await b.req('health')).result.role, 'reader'); } finally { await b.stop(); }
  } finally {
    if (h) await h.stop();
    try { fs.rmdirSync(link); } catch { /* reported below */ }
    if (!fs.existsSync(link)) dirs.push(dir);   // never hand a live junction to a recursive delete
    assert.ok(fs.existsSync(HUB), 'the real hub.mjs is untouched');
  }
});

// ---- H2: stats + link ops, auto-link, changed on titles with a max wait ------------------------------------------
// R() resolves the whole response line {id, ok, result|error}: unwrap it, a refused op becomes a rejection
const call = (h) => async (op, args) => { const r = await h.req(op, args); if (!r.ok) throw new Error(r.error); return r.result; };

test('stats and link ops; auto-link from latest.json; a manual unlink survives reindex', async () => {
  const dir = tmp('hub-h2-');
  const { home } = makeClaudeHome(dir);
  const latest = path.join(dir, 'latest.json');
  fs.writeFileSync(latest, JSON.stringify({ projects: [{ id: 'project-a', path: 'project-a' }, { id: 'project-b', path: 'project-b' }] }));
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '300', HQ_HUB_LATEST: latest }, path.join(dir, 'hub.sqlite'));
  await h.healthy(15000);
  const R = call(h);
  // length first: [].every() is true, and listProjects is [] until the first backfill has run
  assert.ok(await h.until(async () => { const xs = await R('listProjects'); return xs.length === 2 && xs.every((p) => p.link_state === 'auto'); }, 8000), 'both folders auto-linked');
  const ps = await R('listProjects');
  assert.deepEqual(ps.map((p) => p.hq_project_id).sort(), ['project-a', 'project-b']);
  const st = await R('stats', { from: '2026-09-01', to: '2026-12-31', tzOffsetMin: 0 });
  assert.equal(st.totals.chats, 3);
  assert.ok(st.projects.some((p) => p.tokens_out >= 40));
  const a = ps.find((p) => p.hq_project_id === 'project-a').id;
  assert.equal(await R('link', { projectId: a, hqProjectId: null, state: 'rejected' }), true);
  await assert.rejects(R('link', { projectId: a, hqProjectId: 'project-a', state: 'auto' }), /confirmed, rejected or none/);
  await R('reindex');
  await h.until(async () => (await R('health')).state === 'ready' && (await R('health')).counts.conversations === 3, 15000);
  await new Promise((r) => setTimeout(r, 700));   // two sweep ticks: auto-link ran again
  const after = (await R('listProjects')).find((p) => p.id === a);
  assert.deepEqual([after.link_state, after.hq_project_id], ['rejected', null]);
  await h.stop();
});

test('changed fires for a title-only append and within the max wait during a burst', async () => {
  const dir = tmp('hub-h2c-');
  const { home, files } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '150' }, path.join(dir, 'hub.sqlite'));
  await h.healthy(15000);
  const R = call(h);
  const n0 = h.events.filter((e) => e.event === 'changed').length;
  fs.appendFileSync(files.b1, titleLine({ sessionId: 'sess-b1', title: 'Renamed chat' }));
  assert.ok(await h.until(() => h.events.filter((e) => e.event === 'changed').length > n0, 5000), 'changed after a title-only append');
  const n1 = h.events.filter((e) => e.event === 'changed').length;
  const t0 = Date.now();
  let k = 0;
  const burst = setInterval(() => fs.appendFileSync(files.b1, userLine({ uuid: 'burst-' + k++, sessionId: 'sess-b1', at: new Date().toISOString(), text: 'tick' })), 100);
  try { await h.until(() => h.events.filter((e) => e.event === 'changed').length > n1, 3500); }
  finally { clearInterval(burst); }
  assert.ok(Date.now() - t0 < 3500, 'a changed event arrived while the burst was still running');
  assert.equal((await R('health')).lastErrorAt ?? null, null);
  await h.stop();
});

test('lock owner: the Hub binary may have any name; a pid the query missed but that is alive is kept', () => {
  const dir = tmp('hub-lock2-');
  const db = path.join(dir, 'hub.sqlite'), lock = db + '.lock';
  const live = otherProgram();   // a real live pid
  fs.writeFileSync(lock, JSON.stringify({ pid: live.pid, db }));
  const notes = [];
  const custom = () => ({ name: 'node22.exe', commandLine: '"C:\\tools\\node22.exe" --no-warnings "C:\\x\\hub.mjs" --db "' + db + '"' });
  assert.equal(acquireLock(lock, { dbFile: db, inspect: custom, nodeName: 'node22.exe', note: (t) => notes.push(t) }), false);
  assert.equal(acquireLock(lock, { dbFile: db, inspect: () => null, note: (t) => notes.push(t) }), false);
  assert.ok(notes.some((t) => /alive but the process query did not see it/.test(t)));
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, live.pid);   // never reclaimed
});

test('a reader takes over as writer once the writer exits', async () => {
  const dir = tmp('hub-up-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  const env = { HQ_CLAUDE_HOME: home, HQ_HUB_SWEEP_MS: '500', HQ_HUB_READER_UPGRADE_MS: '300' };
  const a = startHub(env, db);
  await a.healthy(15000);
  const b = startHub(env, db);
  await b.healthy(15000);
  assert.equal((await b.req('health')).result.role, 'reader');
  await a.stop();
  assert.ok(await b.until(() => b.events.some((e) => e.event === 'ready' && e.data.role === 'writer'), 5000), 'reader upgraded');
  const h = await b.healthy(15000);
  assert.equal(h.role, 'writer');
  assert.equal(h.counts.conversations, 3);
  assert.equal((await b.req('reindex')).ok, true);   // writer-only ops work now
  await b.stop();
});

function exportZip(dir) {
  const j = exportJson(), z = path.join(dir, 'claude-export.zip');
  zipFiles(z, [{ name: 'conversations.json', data: j.conversations }, { name: 'projects.json', data: j.projects }]);
  return z;
}
const importDone = (h, n = 1) => h.until(() => h.events.filter((e) => e.event === 'progress' && e.data.kind === 'import' && ['done', 'failed'].includes(e.data.phase)).length >= n, 20000);
const lastImportEvent = (h) => h.events.filter((e) => e.event === 'progress' && e.data.kind === 'import').at(-1).data;

test('importExport: started at once, progress with kind import, report in health, idempotent, tmp cleaned (H4)', async () => {
  const dir = tmp('hub-imp-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'data', 'hub.sqlite'); fs.mkdirSync(path.dirname(db), { recursive: true });
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    await h.healthy();
    const zip = exportZip(dir);
    assert.deepEqual((await h.req('importExport', { zipPath: zip })).result, { started: true });
    assert.ok(await importDone(h));
    const ev = lastImportEvent(h);
    assert.equal(ev.phase, 'done'); assert.equal(ev.report.conversations.imported, 3);
    assert.ok(h.events.some((e) => e.event === 'progress' && e.data.kind === 'import' && e.data.phase === 'unzip'));
    const health = (await h.req('health')).result;
    assert.equal(health.lastImport.ok, true); assert.equal(health.lastImport.report.projects.imported, 1); assert.equal(health.importing, false);
    assert.equal((await h.req('listConversations', { source: 'web' })).result.length, 3);
    assert.equal(health.counts.conversations, 6, '3 Code + 3 claude.ai');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'data', 'tmp')), [], 'job folder removed');
    // the importer announces the chats it saved (every 200 and at the end), so the Chats list re-pulls them
    assert.ok(await h.until(() => ['web:web-chat-1', 'web:web-chat-2', 'web:web-chat-3'].every((id) => h.events.some((e) => e.event === 'changed' && e.data.ids.includes(id)))),
      'changed carries the imported web ids (debounced, so wait for it)');
    await h.req('importExport', { zipPath: zip });
    assert.ok(await importDone(h, 2));
    assert.equal(lastImportEvent(h).report.conversations.unchanged, 3);
    assert.equal((await h.req('health')).result.counts.conversations, 6);
  } finally { await h.stop(); }
});

test('importExport: bad input is refused or fails honestly, never leaves files (H4)', async () => {
  const dir = tmp('hub-impbad-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    await h.healthy();
    assert.match((await h.req('importExport', { zipPath: 'relative.zip' })).error, /absolute \.zip path/);
    assert.match((await h.req('importExport', { zipPath: path.join(dir, 'missing.zip') })).error, /no such file: missing\.zip/);
    const junk = path.join(dir, 'junk.zip'); fs.writeFileSync(junk, 'not a zip');
    assert.equal((await h.req('importExport', { zipPath: junk })).ok, true);
    assert.ok(await importDone(h));
    const ev = lastImportEvent(h);
    assert.equal(ev.phase, 'failed'); assert.match(ev.error, /not a zip file/);
    assert.equal((await h.req('health')).result.lastImport.ok, false);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  } finally { await h.stop(); }
});

test('syncState / syncPush: uuids, newer wins, forgotten stays forgotten, changed ids (H4)', async () => {
  const dir = tmp('hub-sync-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'));
  try {
    await h.healthy();
    await h.req('importExport', { zipPath: exportZip(dir) }); assert.ok(await importDone(h));
    const st = (await h.req('syncState')).result;
    assert.equal(st.conversations['web-chat-1'], '2026-10-01T09:10:00.000Z'); assert.equal(st.projects['web-proj-1'], '2026-10-01T08:00:00.000Z');
    assert.equal((await h.req('forget', { conversationId: 'web:web-chat-1' })).result, true);
    const newer = (uuid, text) => ({ kind: 'conversation', data: { uuid, name: 'Synced ' + uuid, updated_at: '2026-10-05T09:00:00Z', chat_messages: [{ uuid: uuid + '-m', sender: 'human', created_at: '2026-10-05T09:00:00Z', text }] } });
    const r = (await h.req('syncPush', { items: [newer('web-chat-1', 'should stay forgotten'), newer('web-chat-3', 'synced text'), { kind: 'weird' }] })).result;
    assert.equal(r.conversations.forgotten, 1); assert.equal(r.conversations.imported, 1); assert.equal(r.conversations.skipped, 1);
    assert.deepEqual((await h.req('syncState')).result.forgotten, ['web-chat-1']);
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'changed' && e.data.ids.includes('web:web-chat-3'))));
    const conv = (await h.req('getConversation', { id: 'web:web-chat-3' })).result;
    assert.deepEqual(conv.messages.map((m) => m.text), ['synced text']);
    assert.match((await h.req('syncPush', { items: [] })).error, /1–50 items/);
  } finally { await h.stop(); }
});

test('contextFor over stdio: a question gets cited snippets inside its budget; FTS-hostile text is fine (H5, Review Focus 1)', async () => {
  const dir = tmp('hub-ctx-');
  const { home } = makeClaudeHome(dir);
  const h = startHub({ HQ_CLAUDE_HOME: home, TZ: 'UTC' }, path.join(dir, 'hub.sqlite'));
  try {
    assert.equal((await h.healthy()).counts.conversations, 3);
    const r = await h.req('contextFor', { query: 'What was the placeholder release plan?', budgetChars: 3000 });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.cites.includes('chat Release planning, 2026-10-01'), JSON.stringify(r.result.cites));
    assert.ok(r.result.text.length <= 3000);
    assert.match(r.result.text, /\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n {2}· you: Plan the placeholder release/);
    for (const q of ['NEAR("release" OR *', '"', 'release*)', '']) {
      const x = await h.req('contextFor', { query: q, budgetChars: 3000 });
      assert.equal(x.ok, true, q + ': ' + x.error);
    }
  } finally { await h.stop(); }
});

test('contextFor: no open index → an error, never an empty answer; a broken index → its own error (H5, Review Focus 3)', async () => {
  // a reader still waiting for the owner to create and migrate the index
  const dir = tmp('hub-ctx-noidx-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.writeFileSync(db, '');
  const holder = standInHub(dir, db);
  fs.writeFileSync(db + '.lock', JSON.stringify({ pid: holder.pid, db }));
  const h = startHub({ HQ_CLAUDE_HOME: home }, db);
  try {
    assert.ok(await h.ready());
    const r = await h.req('contextFor', { query: 'release', budgetChars: 2000 });
    assert.equal(r.ok, false); assert.match(r.error, /the index is not open yet/);
  } finally { await h.stop(); holder.kill('SIGKILL'); }
  // a writer whose FTS table disappears underneath it
  const dir2 = tmp('hub-ctx-broken-');
  const { home: home2 } = makeClaudeHome(dir2);
  const db2 = path.join(dir2, 'hub.sqlite');
  const w = startHub({ HQ_CLAUDE_HOME: home2 }, db2);
  try {
    assert.equal((await w.healthy()).counts.conversations, 3);
    const other = openStore(db2); other.db.exec('DROP TABLE message_fts'); other.close();
    const r = await w.req('contextFor', { query: 'release', budgetChars: 2000 });
    assert.equal(r.ok, false); assert.match(r.error, /message_fts/);
  } finally { await w.stop(); }
});

test('H6 documents: the Hub indexes HQ_CLAUDE_HOME notes/history + HQ_VAULT_DIR prompts, lists, gets, forgets, and sees a new prompt live', async () => {
  const dir = tmp('hub-h6-docs-');
  const fx = makeDocsHome(dir);
  fs.writeFileSync(path.join(fx.home, 'history.jsonl'), historyLine({ display: 'placeholder typed prompt' }));
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: fx.home, HQ_VAULT_DIR: fx.vault, HQ_HUB_SWEEP_MS: '500' }, db);
  try {
    assert.ok(await h.until(async () => ((await h.req('health')).result.counts || {}).documents === 5, 15000), 'memory 2 + CLAUDE.md 1 (home; the fixture project has no Hub path yet) + prompt 1 + history 1');
    const list = (await h.req('listDocuments', {})).result;
    assert.ok(list.every((d) => d.source !== 'history'));
    const prompt = list.find((d) => d.source === 'prompt');
    assert.equal(prompt.title, 'Review a PR like a staff engineer');
    const doc = (await h.req('getDocument', { id: prompt.id })).result;
    assert.match(doc.text, /You are reviewing/);
    assert.equal((await h.req('getDocument', { id: 'prompt:nope' })).result, null);
    fs.writeFileSync(path.join(fx.prompts, 'second.md'), '---\ntitle: Second placeholder prompt\n---\nBody');
    assert.ok(await h.until(async () => (await h.req('listDocuments', { source: 'prompt' })).result.length === 2, 8000), 'a new prompt note is picked up live');
    assert.ok(h.events.some((e) => e.event === 'changed' && Array.isArray(e.data.documents) && e.data.documents.length), 'changed carries documents');
    assert.equal((await h.req('forget', { documentId: prompt.id })).result, true);
    assert.equal((await h.req('getDocument', { id: prompt.id })).result, null);
    assert.equal((await h.req('listDocuments', { q: 'reviewing' })).result.length, 0);
  } finally { await h.stop(); }
});

test('H6 importChatGPT: progress carries source chatgpt, lastImport records it, chats are listed; a claude.ai ZIP fails with the reason', async () => {
  const dir = tmp('hub-h6-cg-');
  const home = path.join(dir, '.claude'); fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  const db = path.join(dir, 'hub.sqlite');
  const h = startHub({ HQ_CLAUDE_HOME: home, HQ_VAULT_DIR: path.join(dir, 'vault') }, db);
  try {
    await h.healthy();
    assert.equal((await h.req('importChatGPT', { zipPath: 'relative.zip' })).ok, false);
    const zip = writeChatGPTZip(path.join(dir, 'chatgpt.zip'));
    assert.deepEqual((await h.req('importChatGPT', { zipPath: zip })).result, { started: true });
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.kind === 'import' && e.data.phase === 'done' && e.data.source === 'chatgpt')));
    const health = (await h.req('health')).result;
    assert.equal(health.lastImport.ok, true); assert.equal(health.lastImport.source, 'chatgpt');
    assert.equal(health.lastImport.report.conversations.imported, 4);
    assert.equal((await h.req('listConversations', { source: 'chatgpt' })).result.length, 4);
    const claude = path.join(dir, 'claude.zip');
    zipFiles(claude, [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }]);
    assert.deepEqual((await h.req('importChatGPT', { zipPath: claude })).result, { started: true });
    assert.ok(await h.until(() => h.events.some((e) => e.event === 'progress' && e.data.phase === 'failed' && /claude\.ai export/.test(e.data.error))));
    assert.equal((await h.req('health')).result.lastImport.ok, false);
  } finally { await h.stop(); }
});
