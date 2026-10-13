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
import { makeClaudeHome, userLine } from './__fixtures__/make-fixture.mjs';
import { openStore } from './store.mjs';
import { acquireLock, resolveClaudeRoot } from './hub.mjs';

const HUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.mjs');
const dirs = [], procs = new Set();
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);   // line/paragraph separators, built rather than spelled
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

test('acquireLock: fresh file, live owner, dead owner and unreadable content', () => {
  const dir = tmp('hub-lock-');
  const lock = path.join(dir, 'x.lock');
  assert.equal(acquireLock(lock), true);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));

  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  procs.add(sleeper);
  try {
    fs.writeFileSync(lock, String(sleeper.pid));
    assert.equal(acquireLock(lock), false, 'a live owner keeps the lock');
    assert.equal(fs.readFileSync(lock, 'utf8'), String(sleeper.pid), 'and its file is left alone');
  } finally { sleeper.kill('SIGKILL'); }

  const dead = spawnSync(process.execPath, ['-e', '0']).pid;   // exited by the time spawnSync returns
  fs.writeFileSync(lock, String(dead));
  assert.equal(acquireLock(lock), true, 'a dead owner leaves a stale lock that is taken over');
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));

  for (const junk of ['', 'not-a-pid', '-4', '0']) {
    fs.writeFileSync(lock, junk);
    assert.equal(acquireLock(lock), true, 'content that names no process is stale: ' + JSON.stringify(junk));
    assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  }
  assert.equal(acquireLock(path.join(dir, 'no-such-dir', 'x.lock')), false, 'a lock that cannot be created is not held');
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
    assert.equal(fs.readFileSync(db + '.lock', 'utf8'), String(b.p.pid));
  } finally { await b.stop(); }
  assert.equal(fs.existsSync(db + '.lock'), false);
});

test('reader whose index never appears: retries ~5 s, then runs store-less with health.lastError and never exits', async () => {
  const dir = tmp('hub-noidx-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.writeFileSync(db, '');                                 // exists but was never migrated (the owner has not finished opening it)
  fs.writeFileSync(db + '.lock', String(process.pid));      // a live "writer": this test runner
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
    assert.deepEqual(last.counts, { projects: 0, conversations: 0, messages: 0 });
    assert.deepEqual((await h.req('listConversations')).result, []);
    assert.deepEqual((await h.req('listProjects')).result, []);
    assert.deepEqual((await h.req('search', { q: 'placeholder' })).result, []);
    assert.equal((await h.req('getConversation', { id: 'code:sess-a1' })).result, null);
    assert.equal((await h.req('reindex')).ok, false);
    assert.equal(h.p.exitCode, null, 'the reader is still running');
  } finally { assert.equal((await h.stop()).code, 0); }
  assert.equal(fs.readFileSync(db + '.lock', 'utf8'), String(process.pid), 'a reader never touches the writer\'s lock');
});

test('reader started before the index exists opens it once the owner has created and migrated it', async () => {
  const dir = tmp('hub-late-');
  const { home } = makeClaudeHome(dir);
  const db = path.join(dir, 'hub.sqlite');
  fs.writeFileSync(db + '.lock', String(process.pid));
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
  } finally { await h.stop(); if (owner) owner.close(); }
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
    assert.equal(health.role, 'writer'); assert.deepEqual(health.counts, { projects: 0, conversations: 0, messages: 0 });
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
  const lock = path.join(dir, 'x.lock');
  const script = path.join(dir, 'slow-owner.mjs');
  // creates the lock empty, announces it, and writes its pid 80 ms later — the window a second Hub can land in
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    "const fd = fs.openSync(process.argv[2], 'wx');",
    "process.stdout.write('created\\n');",
    "setTimeout(() => { fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); }, 80);",
    "setTimeout(() => {}, 30000);",
  ].join('\n'));
  const owner = spawn(process.execPath, [script, lock], { stdio: ['ignore', 'pipe', 'ignore'] });
  procs.add(owner);
  try {
    await new Promise((res, rej) => { owner.stdout.once('data', res); owner.once('exit', () => rej(new Error('owner exited'))); });
    assert.equal(acquireLock(lock), false, 'the half-written lock belongs to a live process');
    assert.equal(fs.readFileSync(lock, 'utf8'), String(owner.pid));
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
    assert.deepEqual(done.counts, { projects: 3, conversations: 153, messages: 155 });   // 5 fixture messages + 150 bulk, each exactly once
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

test('starts through a junction (the entry check compares real paths)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-junction-'));   // handed to the cleanup only once the link is gone
  const { home } = makeClaudeHome(dir);
  const link = path.join(dir, 'linked-hub');
  try { fs.symlinkSync(path.dirname(HUB), link, 'junction'); } catch (e) { dirs.push(dir); t.skip('cannot create a junction here: ' + e.code); return; }
  let h = null;
  try {
    h = startHub({ HQ_CLAUDE_HOME: home }, path.join(dir, 'hub.sqlite'), { script: path.join(link, 'hub.mjs') });
    assert.ok(await h.ready(), 'main() ran');
    assert.equal((await h.healthy()).counts.conversations, 3);
  } finally {
    if (h) await h.stop();
    try { fs.rmdirSync(link); } catch { /* reported below */ }
    if (!fs.existsSync(link)) dirs.push(dir);   // never hand a live junction to a recursive delete
    assert.ok(fs.existsSync(HUB), 'the real hub.mjs is untouched');
  }
});
