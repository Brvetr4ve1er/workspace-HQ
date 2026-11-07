// hq_recall / hq_chat_read reader (recall dish, commit 3), against a temp hub.sqlite built by backfilling the invented
// ~/.claude fixture through store.mjs. Placeholder text only; every secret-shaped value is assembled at run time.
//   node --test mcp/workspacehq/hub-read.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeClaudeHome } from '../../dashboard/claude-hub/__fixtures__/make-fixture.mjs';
import * as storeMod from '../../dashboard/claude-hub/store.mjs';
import { backfill } from '../../dashboard/claude-hub/ingest-code.mjs';
import { hubRecall, hubChatRead, HubReadError, insideFolder, SNIPPET_MAX, TURN_MAX, TURNS_TOTAL_MAX } from './hub-read.mjs';

const { openStore } = storeMod;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-hubread-'));
const DB = path.join(dir, 'hub.sqlite');
const HERE_A = 'C:\\placeholder\\project-a', HERE_B = 'C:\\placeholder\\project-b';
const alnum = (n) => 'Zx9Qm2Lp'.repeat(Math.ceil(n / 8)).slice(0, n);
const hex = (n) => 'a1b2c3d4'.repeat(Math.ceil(n / 8)).slice(0, n);
const FC = 'fc' + '-' + hex(32);                 // a Firecrawl-shaped key the OLD rules miss
const PW = alnum(11);                           // after "password is"
const SECRETS = [FC, hex(32), PW];
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

let seq = 0;
const msg = (text, at, role = 'user', extra = {}) => ({ id: 'hr' + (++seq), nativeId: 'n' + seq, parentId: null, role, at, text, toolName: null, isSidechain: false, ...extra });

before(async () => {
  const { root } = makeClaudeHome(dir);
  const s = openStore(DB);
  await backfill(s, root);
  // rows the fixture does not have, planted straight into the index (as an older version's rows would be: unmasked)
  s.upsertProject({ id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'C--placeholder-project-a', path: null });
  s.ensureConversation({ id: 'code:rich-a', source: 'code', projectId: 'code:C--placeholder-project-a', nativeId: 'rich-a', cwd: HERE_A });
  s.setTitle('code:rich-a', 'Zebra planning with password is ' + PW, 'custom');
  s.addMessages('code:rich-a', [
    msg('zebra user line one about the release', '2026-10-05T10:00:00.000Z'),
    msg('zebra assistant answer about the release', '2026-10-05T10:01:00.000Z', 'assistant'),
    msg('zebra tool output file dump', '2026-10-05T10:02:00.000Z', 'tool', { toolName: 'Read' }),
    msg('zebra subagent turn', '2026-10-05T10:03:00.000Z', 'assistant', { isSidechain: true }),
    msg('zebra someone else said this', '2026-10-05T10:04:00.000Z', 'other', { toolName: 'Placeholder Pal' }),
    msg('zebra key pasted here ' + FC + ' and password is ' + PW + ' done', '2026-10-05T10:05:00.000Z'),
    msg('zebra three', '2026-10-05T10:06:00.000Z'), msg('zebra four', '2026-10-05T10:07:00.000Z'),
  ]);
  s.ensureConversation({ id: 'code:rich-b', source: 'code', projectId: 'code:C--placeholder-project-b', nativeId: 'rich-b', cwd: HERE_B });
  s.upsertProject({ id: 'code:C--placeholder-project-b', source: 'code', key: 'C--placeholder-project-b', name: 'C--placeholder-project-b', path: null });
  s.addMessages('code:rich-b', [msg('zebra in the other folder', '2026-10-06T10:00:00.000Z'), msg('zebra reply in the other folder', '2026-10-06T10:01:00.000Z', 'assistant')]);
  // a chat with long turns: caps
  s.ensureConversation({ id: 'code:long-a', source: 'code', projectId: 'code:C--placeholder-project-a', nativeId: 'long-a', cwd: HERE_A + '\\sub' });
  s.addMessages('code:long-a', Array.from({ length: 24 }, (_, i) => msg('giraffe ' + 'word '.repeat(600) + i, '2026-10-07T10:' + String(i).padStart(2, '0') + ':00.000Z', i % 2 ? 'assistant' : 'user')));
  // claude.ai, Instagram and Facebook chats
  s.ensureConversation({ id: 'web:w1', source: 'web', projectId: null, nativeId: 'w1' });
  s.addMessages('web:w1', [msg('zebra from claude.ai', '2026-10-08T10:00:00.000Z')]);
  s.ensureConversation({ id: 'instagram:i1', source: 'instagram', projectId: null, nativeId: 'i1' });
  s.addMessages('instagram:i1', [msg('zebra private dm', '2026-10-08T11:00:00.000Z', 'other', { toolName: 'Placeholder Pal' })]);
  s.ensureConversation({ id: 'facebook:f1', source: 'facebook', projectId: null, nativeId: 'f1' });
  s.addMessages('facebook:f1', [msg('zebra private message', '2026-10-08T12:00:00.000Z', 'user')]);
  s.close();
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctxA = (extra = {}) => ({ dbFile: DB, cwd: HERE_A, caseInsensitive: true, ...extra });
const all = (o) => JSON.stringify(o);
const ids = (r) => [...new Set(r.hits.map((h) => h.conversationId))].sort();

test('recall returns only your and Claude’s words: tool rows, subagent turns and other people never come back', async () => {
  const r = await hubRecall({ q: 'zebra', scope: 'all', limit: 20 }, ctxA());
  assert.ok(r.hits.length >= 3);
  for (const h of r.hits) {
    assert.ok(h.role === 'user' || h.role === 'assistant');
    assert.ok(!/tool output|subagent|someone else/.test(h.snippet), h.snippet);
    assert.deepEqual(Object.keys(h).sort(), ['at', 'conversationId', 'project', 'role', 'snippet', 'title']);
  }
  assert.equal(r.scope, 'all');
  assert.equal(r.indexed.source, 'code');
  assert.ok(r.indexed.conversations >= 3);
});

test('web only when asked; Instagram and Facebook never', async () => {
  const code = await hubRecall({ q: 'zebra', scope: 'all', limit: 20 }, ctxA());
  assert.ok(!ids(code).some((i) => i.startsWith('web:') || i.startsWith('instagram:') || i.startsWith('facebook:')));
  const web = await hubRecall({ q: 'zebra', scope: 'all', source: 'web' }, ctxA());
  assert.deepEqual(ids(web), ['web:w1']);
  for (const source of ['instagram', 'facebook', 'chatgpt', 'all']) {
    await assert.rejects(hubRecall({ q: 'zebra', scope: 'all', source }, ctxA()), /source must be/);
  }
  const webHere = await hubRecall({ q: 'zebra', source: 'web' }, ctxA());
  assert.equal(webHere.hits.length, 0);
  assert.match(webHere.note, /scope "all"|No match/);
});

test('"here" (the default) returns only the session folder’s chats; "all" returns every folder', async () => {
  const here = await hubRecall({ q: 'zebra', limit: 20 }, ctxA());
  assert.equal(here.scope, 'here');
  assert.deepEqual(ids(here), ['code:rich-a']);
  const there = await hubRecall({ q: 'zebra', limit: 20 }, ctxA({ cwd: HERE_B }));
  assert.deepEqual(ids(there), ['code:rich-b']);
  const everywhere = await hubRecall({ q: 'zebra', scope: 'all', limit: 20 }, ctxA());
  assert.deepEqual(ids(everywhere), ['code:rich-a', 'code:rich-b']);
  const nowhere = await hubRecall({ q: 'zebra' }, ctxA({ cwd: 'C:\\placeholder\\project-c' }));
  assert.equal(nowhere.hits.length, 0);
  assert.match(nowhere.note, /scope "all"/);
  assert.match(nowhere.note, /elsewhere/);
});

test('the project filter applies to the project name after the query; limit and per-chat caps hold', async () => {
  const b = await hubRecall({ q: 'zebra', scope: 'all', project: 'PROJECT-B' }, ctxA());
  assert.deepEqual(ids(b), ['code:rich-b']);
  const none = await hubRecall({ q: 'zebra', scope: 'all', project: 'no-such-project' }, ctxA());
  assert.equal(none.hits.length, 0);
  const one = await hubRecall({ q: 'zebra', scope: 'all', limit: 1 }, ctxA());
  assert.equal(one.hits.length, 1);
  const big = await hubRecall({ q: 'zebra', scope: 'all', limit: 500 }, ctxA());
  assert.ok(big.hits.length <= 20);
  const perChat = {};
  for (const h of big.hits) perChat[h.conversationId] = (perChat[h.conversationId] || 0) + 1;
  assert.ok(Object.values(perChat).every((n) => n <= 2));
  await assert.rejects(hubRecall({ q: 'zebra', limit: 0 }, ctxA()), /limit/);
  await assert.rejects(hubRecall({ q: 'zebra', scope: 'elsewhere' }, ctxA()), /scope must be/);
  await assert.rejects(hubRecall({ q: '   ' }, ctxA()), /q is required/);
  await assert.rejects(hubRecall({ q: '!!! ???' }, ctxA()), /searchable words/);
});

test('snippet cap holds', async () => {
  const r = await hubRecall({ q: 'giraffe', scope: 'all', limit: 20 }, ctxA());
  assert.ok(r.hits.length > 0);
  for (const h of r.hits) assert.ok([...h.snippet].length <= SNIPPET_MAX, 'snippet ' + [...h.snippet].length);
});

test('a runtime-assembled secret planted in a user line never appears in any output', async () => {
  const outs = [
    await hubRecall({ q: 'zebra key pasted', scope: 'all', limit: 20 }, ctxA()),
    await hubRecall({ q: 'fc', scope: 'all', limit: 20 }, ctxA()),          // searched by its first characters
    await hubRecall({ q: 'password', scope: 'all', limit: 20 }, ctxA()),
    await hubChatRead({ id: 'code:rich-a', limit: 20 }, ctxA()),
  ];
  for (const o of outs) for (const s of SECRETS) assert.ok(!all(o).includes(s), 'leaked ' + s.slice(0, 6) + ' in ' + all(o).slice(0, 200));
  // the title carried "password is <secret>" too
  assert.ok(outs[0].hits.length > 0);
  assert.match(all(outs[3]), /secret/);
  assert.ok(!/[\u0002\u0003]/.test(all(outs)), 'no snippet markers leak');
});

test('hq_chat_read: the last turns of one chat, user and assistant only, oldest first', async () => {
  const r = await hubChatRead({ id: 'code:rich-a', limit: 20 }, ctxA());
  assert.equal(r.id, 'code:rich-a');
  assert.ok(r.turns.length >= 5);
  for (const t of r.turns) { assert.ok(t.role === 'user' || t.role === 'assistant'); assert.ok(!/tool output|subagent|someone else/.test(t.text)); }
  const ats = r.turns.map((t) => t.at);
  assert.deepEqual([...ats].sort(), ats);
  const last2 = await hubChatRead({ id: 'code:rich-a', limit: 2 }, ctxA());
  assert.equal(last2.turns.length, 2);
  assert.equal(last2.more, true);
  assert.match(last2.turns[1].text, /zebra four/);
});

test('hq_chat_read refuses another folder’s chat unless scope is "all"; unknown, web-less and people chats are errors', async () => {
  await assert.rejects(hubChatRead({ id: 'code:rich-b' }, ctxA()), /another folder/);
  await assert.rejects(hubChatRead({ id: 'code:rich-b', scope: 'here' }, ctxA()), /another folder/);
  const ok = await hubChatRead({ id: 'code:rich-b', scope: 'all' }, ctxA());
  assert.equal(ok.turns.length, 2);
  await assert.rejects(hubChatRead({ id: 'code:no-such-chat', scope: 'all' }, ctxA()), /no such chat/);
  await assert.rejects(hubChatRead({ id: 'instagram:i1', scope: 'all' }, ctxA()), /no such chat/);
  await assert.rejects(hubChatRead({ id: 'facebook:f1', scope: 'all' }, ctxA()), /no such chat/);
  await assert.rejects(hubChatRead({}, ctxA()), /id is required/);
  await assert.rejects(hubChatRead({ id: 'code:rich-a', limit: 'many' }, ctxA()), /limit/);
});

test('hq_chat_read caps: 1,500 chars a turn, 24,000 in total, more:true when cut', async () => {
  const r = await hubChatRead({ id: 'code:long-a', limit: 20 }, ctxA());   // cwd is a subfolder of the session folder
  assert.ok(r.turns.length > 0 && r.turns.length < 20, 'the total budget cut the count: ' + r.turns.length);
  let total = 0;
  for (const t of r.turns) { assert.ok([...t.text].length <= TURN_MAX); total += t.text.length; }
  assert.ok(total <= TURNS_TOTAL_MAX);
  assert.equal(r.more, true);
  const small = await hubChatRead({ id: 'code:long-a', limit: 1 }, ctxA());
  assert.equal(small.turns.length, 1);
  assert.match(small.turns[0].text, /…$/);   // the turn itself was cut
  assert.equal(small.more, true);
});

test('a missing db is an error that says what to do', async () => {
  await assert.rejects(hubRecall({ q: 'zebra' }, { dbFile: path.join(dir, 'nope.sqlite') }), (e) => e instanceof HubReadError && /open WorkspaceHQ once/.test(e.message));
  await assert.rejects(hubChatRead({ id: 'code:x' }, { dbFile: path.join(dir, 'nope.sqlite') }), /open WorkspaceHQ once/);
});

test('HQ_CLAUDE_DB is honoured', async () => {
  const r = await hubRecall({ q: 'zebra', scope: 'all' }, { env: { HQ_CLAUDE_DB: DB }, cwd: HERE_A, caseInsensitive: true });
  assert.ok(r.hits.length > 0);
});

test('a newer-schema db is an error', async () => {
  const f = path.join(dir, 'newer.sqlite');
  const s = openStore(f);
  s.setMeta('schema_version', '99');
  s.close();
  await assert.rejects(hubRecall({ q: 'zebra' }, { dbFile: f }), /newer WorkspaceHQ/);
});

test('a locked db is an error, not an empty list', async () => {
  const locked = { openStore() { throw new Error('database is locked'); }, ftsQuery: storeMod.ftsQuery };
  await assert.rejects(hubRecall({ q: 'zebra' }, ctxA({ storeModule: locked })), (e) => e instanceof HubReadError && /locked/.test(e.message));
  const lockedLater = { ftsQuery: storeMod.ftsQuery, openStore: (f, o) => ({ ...openStore(f, o), contextHits() { throw new Error('database is locked'); } }) };
  await assert.rejects(hubRecall({ q: 'zebra' }, ctxA({ storeModule: lockedLater })), /locked/);
});

test('a Node without node:sqlite is an error that names Node 22.13', async () => {
  const importStore = async () => { const e = new Error('No such built-in module: node:sqlite'); e.code = 'ERR_UNKNOWN_BUILTIN_MODULE'; throw e; };
  await assert.rejects(hubRecall({ q: 'zebra' }, ctxA({ importStore })), (e) => e instanceof HubReadError && /22\.13/.test(e.message));
});

test('the handle is closed after each call, errors included, and the db file is never changed', async () => {
  const before = sha(DB);
  let opened = 0, closed = 0;
  const counting = { ftsQuery: storeMod.ftsQuery, openStore: (f, o) => { opened++; assert.equal(o.readOnly, true); const s = openStore(f, o); return { ...s, close() { closed++; s.close(); } }; } };
  const ctx = ctxA({ storeModule: counting });
  await hubRecall({ q: 'zebra', scope: 'all' }, ctx);
  await hubChatRead({ id: 'code:rich-a' }, ctx);
  await assert.rejects(hubChatRead({ id: 'code:rich-b' }, ctx), /another folder/);
  await assert.rejects(hubChatRead({ id: 'code:nope', scope: 'all' }, ctx), /no such chat/);
  assert.equal(opened, 4);
  assert.equal(closed, 4);
  assert.equal(sha(DB), before);
});

test('insideFolder: the folder itself and anything below it, nothing that merely shares a prefix', () => {
  assert.equal(insideFolder('C:\\work\\alpha-site', 'C:\\work\\alpha-site', true), true);
  assert.equal(insideFolder('C:\\work\\alpha-site\\src\\x', 'c:/work/alpha-site/', true), true);
  assert.equal(insideFolder('C:\\work\\alpha-site-two', 'C:\\work\\alpha-site', true), false);
  assert.equal(insideFolder('/work/Alpha', '/work/alpha', false), false);
  assert.equal(insideFolder(null, '/work/alpha', false), false);
  assert.equal(insideFolder('/work/alpha', '', false), false);
});

// ---- tasting fixes: scope paging, tool-call stubs, short paths, claude.ai chats ------------------------------------------
function bigDb(name, build) {
  const f = path.join(dir, name + '.sqlite');
  const s = openStore(f);
  build(s);
  s.close();
  return f;
}
const chat = (s, id, cwd, msgs, projectId = null, source = 'code') => {
  s.ensureConversation({ id, source, projectId, nativeId: id.split(':')[1], cwd });
  s.addMessages(id, msgs);
};

test('scope "here" and the project filter see past the first 200 ranked rows: in-folder chats ranked below 250 other-folder chats are found', async () => {
  const f = bigDb('paging', (s) => {
    s.upsertProject({ id: 'code:far', source: 'code', key: 'far', name: 'far-project', path: null });
    s.upsertProject({ id: 'code:near', source: 'code', key: 'near', name: 'near-project', path: null });
    for (let i = 0; i < 250; i++) chat(s, 'code:far' + i, 'C:\\placeholder\\far', [msg('quokka quokka quokka', '2026-10-01T10:00:00.000Z')], 'code:far');
    chat(s, 'code:near1', HERE_A, [msg('one quokka among many many other filler words so that this row ranks far below the strong ones', '2026-10-02T10:00:00.000Z')], 'code:near');
  });
  const here = await hubRecall({ q: 'quokka', limit: 5 }, { dbFile: f, cwd: HERE_A, caseInsensitive: true });
  assert.deepEqual(ids(here), ['code:near1'], 'the one in-folder chat is found; ' + JSON.stringify(here.note));
  assert.equal(here.note, null);
  const proj = await hubRecall({ q: 'quokka', scope: 'all', project: 'near-project', limit: 5 }, { dbFile: f, cwd: HERE_A, caseInsensitive: true });
  assert.deepEqual(ids(proj), ['code:near1']);
  // and the "elsewhere" note is only said when the search really ran dry in-folder
  const none = await hubRecall({ q: 'quokka', limit: 5 }, { dbFile: f, cwd: 'C:\\placeholder\\nowhere', caseInsensitive: true });
  assert.equal(none.hits.length, 0);
  assert.match(none.note, /251 chat\(s\) elsewhere match/);
});

test('assistant tool-call stubs are not recalled or read as turns; the words around a stub stay', async () => {
  const f = bigDb('stubs', (s) => {
    chat(s, 'code:st1', HERE_A, [
      msg('please run quokka tests', '2026-10-03T10:00:00.000Z'),
      msg('[tool: Bash npm test quokka]', '2026-10-03T10:01:00.000Z', 'assistant', { toolName: 'Bash' }),
      msg('[tool: Read src/quokka.js]', '2026-10-03T10:02:00.000Z', 'assistant', { toolName: 'Read' }),
      msg('the quokka tests pass\n[tool: Bash git status]', '2026-10-03T10:03:00.000Z', 'assistant', { toolName: 'Bash' }),
      msg('[tool: Bash echo]', '2026-10-03T10:04:00.000Z', 'assistant', { toolName: 'Bash' }),
    ]);
  });
  const ctx = { dbFile: f, cwd: HERE_A, caseInsensitive: true };
  const r = await hubRecall({ q: 'quokka', limit: 20 }, ctx);
  assert.ok(r.hits.length > 0);
  for (const h of r.hits) assert.ok(!h.snippet.startsWith('[tool:'), h.snippet);
  const c = await hubChatRead({ id: 'code:st1', limit: 20 }, ctx);
  assert.deepEqual(c.turns.map((t) => t.text), ['please run quokka tests', 'the quokka tests pass'], 'stub-only turns are gone, stub lines are stripped');
  const last = await hubChatRead({ id: 'code:st1', limit: 1 }, ctx);
  assert.equal(last.turns[0].text, 'the quokka tests pass', 'the last turn is the last real one, not a stub');
});

test('a chat recorded under an 8.3 short path is inside the long-form folder (and the other way round)', async () => {
  const f = bigDb('shortpath', (s) => {
    chat(s, 'code:sp1', 'C:\\Users\\ROGSTR~1\\proj\\sub', [msg('okapi notes', '2026-10-04T10:00:00.000Z')]);
    chat(s, 'code:sp2', 'C:\\Users\\ROG STRIX\\other', [msg('okapi elsewhere', '2026-10-04T11:00:00.000Z')]);
  });
  const realpath = (p) => p.replace('ROGSTR~1', 'ROG STRIX');
  const ctx = { dbFile: f, cwd: 'C:\\Users\\ROG STRIX\\proj', caseInsensitive: true, realpath };
  assert.deepEqual(ids(await hubRecall({ q: 'okapi' }, ctx)), ['code:sp1']);
  assert.equal((await hubChatRead({ id: 'code:sp1' }, ctx)).turns.length, 1);
  await assert.rejects(hubChatRead({ id: 'code:sp2' }, ctx), /another folder/);
  const shortSession = { dbFile: f, cwd: 'C:\\Users\\ROGSTR~1\\other', caseInsensitive: true, realpath };
  assert.deepEqual(ids(await hubRecall({ q: 'okapi' }, shortSession)), ['code:sp2']);
  // a path that cannot be resolved stays as written, never an error
  const broken = { ...ctx, realpath() { throw new Error('ENOENT'); } };
  assert.deepEqual(ids(await hubRecall({ q: 'okapi' }, broken)), []);
});

test('claude.ai chats with the default scope say they carry no folder, instead of "N chats elsewhere"', async () => {
  const web = await hubRecall({ q: 'zebra', source: 'web' }, ctxA());
  assert.equal(web.hits.length, 0);
  assert.match(web.note, /claude\.ai chats carry no working folder/);
  assert.doesNotMatch(web.note, /elsewhere/);
  await assert.rejects(hubChatRead({ id: 'web:w1' }, ctxA()), /claude\.ai chats carry no working folder/);
  assert.equal((await hubChatRead({ id: 'web:w1', scope: 'all' }, ctxA())).turns.length, 1);
});
