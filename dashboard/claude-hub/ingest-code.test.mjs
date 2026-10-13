// dashboard/claude-hub/ingest-code.test.mjs
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { ingestFile, listTranscripts, backfill, sweep, watchRoot } from './ingest-code.mjs';
import { makeClaudeHome, userLine, assistantLines, titleLine } from './__fixtures__/make-fixture.mjs';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ingest-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('backfill: newest first, projects named from cwd, titles, tokens once per response, nested folders ignored', async () => {
  const { root } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  const seen = [];
  const r = await backfill(s, root, { onProgress: (p) => seen.push(p) });
  assert.deepEqual(r, { done: 3, total: 3 });
  assert.deepEqual(seen.at(-1), { done: 3, total: 3 });
  const order = (await listTranscripts(root)).map((f) => path.basename(f.file));
  assert.equal(order.at(-1), 'sess-b1.jsonl', 'oldest mtime last');
  assert.deepEqual(order.slice().sort(), ['sess-a1.jsonl', 'sess-a2.jsonl', 'sess-b1.jsonl']);
  const a1 = s.getConversation({ id: 'code:sess-a1' });
  assert.equal(a1.conversation.title, 'Release planning');
  assert.equal(a1.messages.length, 3);
  assert.deepEqual([a1.conversation.tokens_in, a1.conversation.tokens_out], [6, 40], 'two lines, one response → counted once');
  assert.equal(s.listProjects({}).find((p) => p.id === 'code:C--placeholder-project-a').name, 'project-a');
  assert.equal(s.counts().conversations, 3);
  assert.equal(s.search({ q: 'cafe' }).length, 1, 'diacritics folded; the emoji line ingested intact');
});

test('incremental: appends ingest only the new bytes; partial last line waits (Review Focus 5)', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  await ingestFile(s, root, files.a2);
  const extra = userLine({ uuid: 'a2-u2', sessionId: 'sess-a2', at: '2026-10-02T09:01:00.000Z', text: 'second message' });
  fs.appendFileSync(files.a2, extra.slice(0, 20));                      // half a line
  assert.equal((await ingestFile(s, root, files.a2)).added, 0);
  fs.appendFileSync(files.a2, extra.slice(20));
  assert.equal((await ingestFile(s, root, files.a2)).added, 1);
  assert.equal((await ingestFile(s, root, files.a2)).added, 0, 'nothing new → nothing added');
  assert.equal(s.getConversation({ id: 'code:sess-a2' }).messages.length, 2);
});

test('replaced or truncated file is re-ingested from 0 without duplicates (Review Focus 5)', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  await ingestFile(s, root, files.a1);
  fs.writeFileSync(files.a1, userLine({ uuid: 'new-1', sessionId: 'sess-a1', at: '2026-10-03T10:00:00.000Z', text: 'rewritten' }));
  const r = await ingestFile(s, root, files.a1);
  assert.equal(r.reset, true);
  assert.deepEqual(s.getConversation({ id: 'code:sess-a1' }).messages.map((m) => m.text), ['rewritten']);
});

test('CRLF, BOM and multi-byte characters split across tiny chunks (Review Focus 4)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-x');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-x.jsonl');
  const l1 = userLine({ uuid: 'x1', sessionId: 'sess-x', at: '2026-10-01T10:00:00.000Z', text: 'naïve 日本語 🚀' }).replace('\n', '\r\n');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(l1, 'utf8')]));
  const s = openStore(':memory:');
  const r = await ingestFile(s, root, f, { chunkSize: 7 });
  assert.equal(r.added, 1);
  assert.equal(s.getConversation({ id: 'code:sess-x' }).messages[0].text, 'naïve 日本語 🚀');
  assert.equal(s.getCursor(path.relative(root, f)).offset, fs.statSync(f).size, 'byte-exact offset');
});

test('an oversized line is skipped and counted; later lines still ingest; memory bounded (Review Focus 1)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-y');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-y.jsonl');
  const huge = userLine({ uuid: 'y0', sessionId: 'sess-y', at: '2026-10-01T09:00:00.000Z', text: 'z'.repeat(5000) });
  const ok = userLine({ uuid: 'y1', sessionId: 'sess-y', at: '2026-10-01T10:00:00.000Z', text: 'after the giant line' });
  fs.writeFileSync(f, huge + ok);
  const s = openStore(':memory:');
  const r = await ingestFile(s, root, f, { chunkSize: 256, maxLine: 1024 });
  assert.equal(r.skippedLong, 1);
  assert.equal(r.added, 1);
  assert.equal(s.getCursor(path.relative(root, f)).offset, fs.statSync(f).size);
});

test('masked secrets, tombstones respected, sweep reports changed conversations', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  fs.appendFileSync(files.a2, userLine({ uuid: 'a2-s', sessionId: 'sess-a2', at: '2026-10-02T09:05:00.000Z', text: 'key ' + 'sk_' + 'live_' + 'Q'.repeat(24) }));
  await backfill(s, root);
  assert.ok(s.getConversation({ id: 'code:sess-a2' }).messages.some((m) => m.text.includes('••• secret (stripe-key)')));
  s.forget({ conversationId: 'code:sess-b1' });
  fs.appendFileSync(files.b1, userLine({ uuid: 'b1-u2', sessionId: 'sess-b1', at: '2026-10-04T08:00:00.000Z', text: 'more' }));
  fs.appendFileSync(files.a1, userLine({ uuid: 'a1-u9', sessionId: 'sess-a1', at: '2026-10-04T08:00:00.000Z', text: 'more' }));
  const changed = await sweep(s, root);
  assert.deepEqual(changed, ['code:sess-a1']);
  assert.equal(s.getConversation({ id: 'code:sess-b1' }), null, 'forgotten stays forgotten');
});

// ---- added beyond the brief (see task-4-report.md, "Deviations") ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a fork/resume copy: the same uuid in two sessions lands in BOTH conversations (probe: ~25% of the owner\'s lines)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-fork');
  fs.mkdirSync(folder, { recursive: true });
  const shared = (sessionId) => userLine({ uuid: 'shared-1', sessionId, at: '2026-10-01T10:00:00.000Z', text: 'copied history line' });
  fs.writeFileSync(path.join(folder, 'sess-orig.jsonl'), shared('sess-orig'));
  fs.writeFileSync(path.join(folder, 'sess-fork.jsonl'), shared('sess-orig') +   // a fork keeps the parent's sessionId on copied lines
    userLine({ uuid: 'fork-2', sessionId: 'sess-fork', at: '2026-10-01T11:00:00.000Z', text: 'only in the fork' }));
  const s = openStore(':memory:');
  await backfill(s, root);
  assert.equal(s.getConversation({ id: 'code:sess-orig' }).messages.length, 1, 'the original keeps its message');
  assert.equal(s.getConversation({ id: 'code:sess-fork' }).messages.length, 2, 'the fork has the copy and its own line');
  assert.equal(s.counts().messages, 3);
  assert.equal(s.counts().conversations, 2, 'neither conversation vanishes from the lists');
});

test('lines without a uuid get stable, distinct ids; a replaced file re-ingests without duplicates', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-nouuid');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-n.jsonl');
  const line = (text) => userLine({ uuid: undefined, sessionId: 'sess-n', at: '2026-10-01T10:00:00.000Z', text });
  fs.writeFileSync(f, line('first') + line('second'));
  const s = openStore(':memory:');
  assert.equal((await ingestFile(s, root, f)).added, 2, 'same timestamp, no uuid → still two messages');
  fs.writeFileSync(f, line('first') + line('second') + line('third'));
  const r = await ingestFile(s, root, f);
  assert.equal(r.reset, false, 'an append is not a replacement');
  assert.equal(r.added, 1);
  assert.equal(s.getConversation({ id: 'code:sess-n' }).messages.length, 3);
});

test('a stopped backfill is not recorded as done', async () => {
  const { root } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  let calls = 0;
  const r = await backfill(s, root, { shouldStop: () => calls++ >= 1 });
  assert.deepEqual(r, { done: 1, total: 3 });
  assert.equal(s.getMeta('backfill_done_at'), null, 'stopped early → no "done" timestamp');
  assert.equal((await backfill(s, root)).done, 3);
  assert.ok(s.getMeta('backfill_done_at'), 'a completed run records it');
});

test('a file that fails to ingest is reported in meta.last_error by backfill and sweep; the rest still ingest', async () => {
  const { root } = makeClaudeHome(tmp());
  const real = openStore(':memory:');
  const s = { ...real, addMessages: (id, msgs) => { if (id === 'code:sess-a2') throw new Error('disk on fire'); return real.addMessages(id, msgs); } };
  await backfill(s, root);
  assert.match(real.getMeta('last_error') || '', /sess-a2\.jsonl: disk on fire/);
  assert.equal(real.getConversation({ id: 'code:sess-a1' }).messages.length, 3, 'other files unaffected');
  real.setMeta('last_error', '');
  const changed = await sweep(s, root);
  assert.deepEqual(changed, []);
  assert.match(real.getMeta('last_error') || '', /sess-a2\.jsonl: disk on fire/, 'sweep surfaces it too (never a silent skip)');
});

test('transcript titles are masked like message text', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-t');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-t.jsonl');
  fs.writeFileSync(f, userLine({ uuid: 't1', sessionId: 'sess-t', at: '2026-10-01T10:00:00.000Z', text: 'hello' }) +
    titleLine({ sessionId: 'sess-t', title: 'Rotate ' + 'sk_' + 'live_' + 'Q'.repeat(24) + ' now' }));
  const s = openStore(':memory:');
  await ingestFile(s, root, f);
  const title = s.getConversation({ id: 'code:sess-t' }).conversation.title;
  assert.ok(title.includes('••• secret (stripe-key)'), title);
  assert.ok(!title.includes('QQQQ'));
});

test('a missing file is reported, not thrown', async () => {
  const dir = tmp(), root = path.join(dir, 'projects');
  fs.mkdirSync(root, { recursive: true });
  const r = await ingestFile(openStore(':memory:'), root, path.join(root, 'C--x', 'gone.jsonl'));
  assert.equal(r.missing, true);
  assert.equal(r.added, 0);
});

test('watchRoot: one debounced callback per <folder>/<session>.jsonl; nested and non-jsonl ignored; close() stops it', async () => {
  const { root, files } = makeClaudeHome(tmp());
  const got = [];
  const w = watchRoot(root, (f) => got.push(f), { debounceMs: 60 });
  try {
    await sleep(100);   // let the OS watcher arm
    fs.appendFileSync(path.join(root, 'C--placeholder-project-a', 'sess-a1', 'subagents', 'agent-x.jsonl'), 'x\n');   // nested → ignored
    fs.appendFileSync(path.join(root, 'C--placeholder-project-a', 'notes.txt'), 'x\n');                              // not .jsonl → ignored
    fs.appendFileSync(files.a2, 'one\n'); fs.appendFileSync(files.a2, 'two\n');                                      // a burst → one callback
    for (let i = 0; i < 40 && !got.length; i++) await sleep(50);
    await sleep(300);
    assert.deepEqual(got, [files.a2]);
  } finally { w.close(); }
  fs.appendFileSync(files.a2, 'three\n');
  await sleep(300);
  assert.equal(got.length, 1, 'closed watchers stay quiet');
});

test('watchRoot on a missing root does not throw; close() is safe to call twice', () => {
  const w = watchRoot(path.join(tmp(), 'nope'), () => {});
  w.close(); w.close();
});

// ---- fix round 1 (task review): masking behind the parser's cut, and listing errors that must not read as "empty" ----

test('a private key longer than the parser cut is masked end to end (the cut drops the END marker)', async () => {
  const dir = tmp(), root = path.join(dir, 'projects'), folder = path.join(root, 'C--placeholder-k');
  fs.mkdirSync(folder, { recursive: true });
  const f = path.join(folder, 'sess-k.jsonl');
  const body = 'Zm9vYmFy'.repeat(10);   // an 80-char placeholder "key" line
  const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----\n' + (body + '\n').repeat(40) + '-----END ' + 'RSA PRIVATE KEY-----';   // ~3.3 KB, over TOOL_RESULT_MAX
  fs.writeFileSync(f, JSON.stringify({ type: 'user', uuid: 'k1', parentUuid: null, sessionId: 'sess-k', timestamp: '2026-10-01T10:00:00.000Z',
    cwd: 'C:\placeholder\project-k', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: pem }] } }) + '\n');
  const s = openStore(':memory:');
  assert.equal((await ingestFile(s, root, f)).added, 1);
  const [m] = s.getConversation({ id: 'code:sess-k' }).messages;
  assert.equal(m.role, 'tool');
  assert.ok(m.text.includes('••• secret (private-key)'), m.text.slice(0, 120));
  assert.ok(!m.text.includes('Zm9vYmFy'), 'no key material in the stored text');
  assert.equal(s.search({ q: body }).length, 0, 'no key material in the FTS index either');
});

const eperm = (code, message) => Object.assign(new Error(message), { code });
// fs.promises.* is looked up at call time by ingest-code.mjs, so a test can fail one path deterministically
// (chmod does not model EACCES on Windows).
function failing(fn, pathEndsWith, err) {
  const real = fs.promises[fn];
  return mock.method(fs.promises, fn, async (p, ...rest) => {
    if (String(p).endsWith(pathEndsWith)) throw err;
    return real.call(fs.promises, p, ...rest);
  });
}

test('listTranscripts reports unreadable folders and files, skips vanished ones quietly, and still lists the rest', async () => {
  const { root } = makeClaudeHome(tmp());
  const run = async () => { const errs = []; const files = await listTranscripts(root, { onError: (where, e, isRoot) => errs.push([where, e.code, isRoot]) }); return { errs, names: files.map((f) => path.basename(f.file)).sort() }; };
  let m = failing('readdir', 'C--placeholder-project-b', eperm('EACCES', 'EACCES: permission denied'));
  try {
    const r = await run();
    assert.deepEqual(r.errs, [['C--placeholder-project-b', 'EACCES', false]]);
    assert.deepEqual(r.names, ['sess-a1.jsonl', 'sess-a2.jsonl']);
  } finally { m.mock.restore(); }
  m = failing('stat', 'sess-a2.jsonl', eperm('EPERM', 'EPERM: operation not permitted'));
  try {
    const r = await run();
    assert.deepEqual(r.errs, [[path.join('C--placeholder-project-a', 'sess-a2.jsonl'), 'EPERM', false]]);
    assert.deepEqual(r.names, ['sess-a1.jsonl', 'sess-b1.jsonl']);
  } finally { m.mock.restore(); }
  for (const [fn, tail] of [['readdir', 'C--placeholder-project-b'], ['stat', 'sess-a2.jsonl']]) {   // deleted between readdir and stat: not an error
    m = failing(fn, tail, eperm('ENOENT', 'ENOENT: no such file or directory'));
    try { assert.deepEqual((await run()).errs, [], fn); } finally { m.mock.restore(); }
  }
  assert.equal((await run()).names.length, 3, 'back to normal once the fault is gone');
});

test('a missing transcripts root is reported with a reason (not an empty "ready"); an empty root is not an error; the note clears when the root appears', async () => {
  const dir = tmp(), root = path.join(dir, 'nope', 'projects');
  const s = openStore(':memory:');
  assert.deepEqual(await backfill(s, root), { done: 0, total: 0 });
  assert.equal(s.getMeta('last_error'), 'no transcripts root at ' + root);
  s.setMeta('last_error', '');
  assert.deepEqual(await sweep(s, root), []);
  assert.equal(s.getMeta('last_error'), 'no transcripts root at ' + root, 'sweep says it too');
  fs.mkdirSync(root, { recursive: true });   // legitimately empty: Claude Code installed, nothing run yet
  assert.deepEqual(await sweep(s, root), []);
  assert.equal(s.getMeta('last_error'), '', 'the stale "no root" note is cleared');
  s.setMeta('last_error', 'sess-x.jsonl: disk on fire');
  await sweep(s, root);
  assert.equal(s.getMeta('last_error'), 'sess-x.jsonl: disk on fire', 'only the "no root" note is ever cleared');
});

test('a transcripts root that cannot be read is recorded by backfill and sweep, with the root and the error', async () => {
  const dir = tmp(), root = path.join(dir, 'projects');
  fs.writeFileSync(root, 'not a folder');   // readdir on a file: ENOTDIR (or the platform's equivalent), not ENOENT
  const s = openStore(':memory:');
  assert.deepEqual(await backfill(s, root), { done: 0, total: 0 });
  const err = s.getMeta('last_error') || '';
  assert.ok(err.startsWith(root + ': '), err);
  assert.ok(!err.startsWith('no transcripts root'), err);
  s.setMeta('last_error', '');
  await sweep(s, root);
  assert.ok((s.getMeta('last_error') || '').startsWith(root + ': '));
});

test('an unreadable folder is recorded by backfill and sweep; the other folders still ingest', async () => {
  const { root } = makeClaudeHome(tmp());
  const s = openStore(':memory:');
  const m = failing('readdir', 'C--placeholder-project-b', eperm('EACCES', 'EACCES: permission denied'));
  try {
    assert.deepEqual(await backfill(s, root), { done: 2, total: 2 });
    assert.match(s.getMeta('last_error') || '', /^C--placeholder-project-b: EACCES: permission denied/);
    assert.equal(s.counts().conversations, 2);
    s.setMeta('last_error', '');
    await sweep(s, root);
    assert.match(s.getMeta('last_error') || '', /^C--placeholder-project-b: EACCES/);
  } finally { m.mock.restore(); }
});
