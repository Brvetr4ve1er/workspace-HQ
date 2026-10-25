import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { parseFrontmatter, docId, syncNotes, listNoteFiles, ingestHistory, syncDocs, watchDocs, HISTORY_CURSOR } from './ingest-docs.mjs';
import { makeDocsHome, FOLDER, historyLine } from './__fixtures__/make-docs.mjs';

const SECRET = 'sk-' + 'ant-' + 'A'.repeat(30);
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-docs-'));
  const fx = makeDocsHome(dir, { secret: SECRET });
  const s = openStore(':memory:');
  s.upsertProject({ id: 'code:' + FOLDER, source: 'code', key: FOLDER, name: 'project-a', path: fx.projectDir });
  return { dir, fx, s, opts: { home: fx.home, vaultDir: fx.vault } };
};

test('parseFrontmatter: lists, inline maps, quotes, numbers, CRLF, none, unterminated', () => {
  const p = parseFrontmatter('---\r\ntitle: "A: quoted"\r\ntags: [review, code]\r\nversion: 1\r\nok: true\r\nsource: { kind: code, conversation: "code:s1" }\r\n---\r\nBody {{x}}\r\n');
  assert.equal(p.has, true);
  assert.deepEqual(p.data, { title: 'A: quoted', tags: ['review', 'code'], version: 1, ok: true, source: { kind: 'code', conversation: 'code:s1' } });
  assert.equal(p.body, 'Body {{x}}\r\n');
  assert.deepEqual(parseFrontmatter('# no frontmatter\n'), { data: {}, body: '# no frontmatter\n', has: false });
  assert.deepEqual(parseFrontmatter('---\ntitle: never closed\n'), { data: {}, body: '---\ntitle: never closed\n', has: false });
});

test('syncNotes indexes memory notes, both CLAUDE.md files and top-level prompt notes only', async () => {
  const { fx, s, opts } = setup();
  const files = listNoteFiles(s, opts).map((f) => [f.source, path.basename(f.file)]).sort();
  assert.deepEqual(files, [['claude-md', 'CLAUDE.md'], ['claude-md', 'CLAUDE.md'], ['memory', 'MEMORY.md'], ['memory', 'feedback_tea.md'], ['prompt', 'review-a-pr.md']]);
  const r = await syncNotes(s, opts);
  assert.equal(r.changed.length, 5); assert.deepEqual(r.removed, []);
  const tea = s.getDocument({ id: docId('memory', fx.files.memTea) });
  assert.equal(tea.title, 'Placeholder tea rule');
  assert.deepEqual(tea.meta, { name: 'Placeholder tea rule', description: 'always offer tea', type: 'feedback' });
  assert.equal(tea.project_id, 'code:' + FOLDER); assert.equal(tea.project_path, fx.projectDir);
  assert.equal(s.getDocument({ id: docId('memory', fx.files.memIndex) }).title, 'Memory index');
  const pm = s.getDocument({ id: docId('prompt', fx.files.prompt) });
  assert.equal(pm.title, 'Review a PR like a staff engineer');
  assert.deepEqual(pm.meta.variables, ['project', 'file']);
  assert.equal(pm.text.trim(), 'You are reviewing {{file}} in {{project}}. Placeholder body.');
  assert.equal(s.getDocument({ id: docId('claude-md', fx.files.projMd) }).project_id, 'code:' + FOLDER);
  assert.equal(s.getDocument({ id: docId('claude-md', fx.files.homeMd) }).project_id, null);
});

test('memory and CLAUDE.md text are masked before the cut', async () => {
  const { fx, s, opts } = setup();
  // the space keeps redact.mjs's `\bsk-ant-` word boundary; the secret starts at 199991, so a cut-before-mask would keep
  // 'sk-ant-AA' at the end of the 200000-char cut and this assertion would catch it
  fs.writeFileSync(fx.files.homeMd, 'x'.repeat(199990) + ' ' + SECRET + ' tail');
  await syncNotes(s, opts);
  const md = s.getDocument({ id: docId('claude-md', fx.files.homeMd) }).text;
  assert.ok(!md.includes('sk-ant-'), 'a secret straddling the cut is masked, not half-kept');
  const tea = s.getDocument({ id: docId('memory', fx.files.memTea) });
  assert.ok(!tea.text.includes(SECRET)); assert.match(tea.text, /anthropic-key/);
  assert.equal(s.listDocuments({ q: 'sk-ant' }).length, 0, 'the raw secret is not in the FTS index either');
});

test('incremental: unchanged files are skipped, an edit re-indexes, a deleted file leaves, a forgotten one stays gone', async () => {
  const { fx, s, opts } = setup();
  await syncNotes(s, opts);
  assert.deepEqual((await syncNotes(s, opts)).changed, []);
  fs.writeFileSync(fx.files.prompt, fs.readFileSync(fx.files.prompt, 'utf8').replace('Placeholder body.', 'Edited body.'));
  fs.utimesSync(fx.files.prompt, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual((await syncNotes(s, opts)).changed, [docId('prompt', fx.files.prompt)]);
  fs.rmSync(fx.files.memIndex);
  const r = await syncNotes(s, opts);
  assert.deepEqual(r.removed, [docId('memory', fx.files.memIndex)]);
  assert.equal(s.getDocument({ id: docId('memory', fx.files.memIndex) }), null);
  assert.equal(s.forget({ documentId: docId('prompt', fx.files.prompt) }), true);
  fs.utimesSync(fx.files.prompt, new Date(), new Date(Date.now() + 9000));
  assert.deepEqual((await syncNotes(s, opts)).changed, []);
  assert.equal(s.getDocument({ id: docId('prompt', fx.files.prompt) }), null);
});

test('missing roots are not errors; ChatGPT memory rows (no path) are never removed by a sweep', async () => {
  const s = openStore(':memory:');
  s.upsertDocument({ id: 'memory:chatgpt:aa', source: 'memory', path: null, title: 't', text: 'placeholder', meta: { origin: 'chatgpt' } });
  const r = await syncNotes(s, { home: path.join(os.tmpdir(), 'no-such-home-h6'), vaultDir: path.join(os.tmpdir(), 'no-such-vault-h6') });
  assert.deepEqual(r, { changed: [], removed: [], skipped: 0, unreadable: [] });
  assert.ok(s.getDocument({ id: 'memory:chatgpt:aa' }));
});

test('an unreadable root (EPERM, not ENOENT) keeps its indexed rows and is reported, never swept as empty', async () => {
  const { fx, s, opts } = setup();
  await syncNotes(s, opts);
  const before = s.documentStamps('prompt').size, memBefore = s.documentStamps('memory').size;
  assert.ok(before > 0 && memBefore > 0);
  const promptsDir = path.resolve(fx.vault, '40_Resources', 'Prompts'), memRoot = path.resolve(fx.home, 'projects');
  const real = fs.readdirSync;
  const m = mock.method(fs, 'readdirSync', (d, o) => {
    const r = path.resolve(String(d));
    if (r === promptsDir || r === memRoot) { const e = new Error('locked'); e.code = 'EPERM'; throw e; }
    return real(d, o);
  });
  try {
    const r = await syncNotes(s, opts);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.unreadable.map((u) => [u.source, u.code]).sort(), [['memory', 'EPERM'], ['prompt', 'EPERM']]);
  } finally { m.mock.restore(); }
  assert.equal(s.documentStamps('prompt').size, before);
  assert.equal(s.documentStamps('memory').size, memBefore);
  const r2 = await syncNotes(s, opts);   // root readable again: no churn
  assert.deepEqual([r2.changed, r2.removed, r2.unreadable], [[], [], []]);
});

const histSetup = () => {
  const { dir, fx, s, opts } = setup();
  const file = path.join(fx.home, 'history.jsonl');
  return { dir, fx, s, opts, file };
};

test('history: each complete line is a document keyed by its byte offset, meta carries session/project/pasted', async () => {
  const { s, fx, file } = histSetup();
  const l1 = historyLine({ display: 'placeholder fix the lantern bug' });
  const l2 = historyLine({ display: 'placeholder paste this ' + SECRET, pasted: true, sessionId: 'sess-2' });
  fs.writeFileSync(file, l1 + 'not json\n' + l2);
  const r = await ingestHistory(s, fx.home);
  assert.equal(r.added, 2); assert.equal(r.bad, 1);
  const off2 = Buffer.byteLength(l1 + 'not json\n');
  assert.deepEqual(r.ids, ['history:sess-1:0', 'history:sess-2:' + off2]);
  const d2 = s.getDocument({ id: 'history:sess-2:' + off2 });
  assert.equal(d2.source, 'history');
  assert.deepEqual(d2.meta, { sessionId: 'sess-2', project: 'C:\\placeholder\\project-a', pasted: true, at: '2025-10-01T12:00:00.000Z' });
  assert.ok(!d2.text.includes(SECRET), 'masked');
  assert.equal(s.getCursor(HISTORY_CURSOR).offset, Buffer.byteLength(l1 + 'not json\n' + l2));
  assert.equal(s.listDocuments({ q: 'lantern' }).length, 0, 'history is not in default search');
  assert.equal(s.listDocuments({ q: 'lantern', source: 'history' }).length, 1);
});

test('partial last line waits; truncation resets; append continues', async () => {
  const { s, fx, file } = histSetup();
  const a = historyLine({ display: 'placeholder one' }), b = historyLine({ display: 'placeholder two' });
  fs.writeFileSync(file, a + b.slice(0, 20));   // a writer is mid-line
  assert.equal((await ingestHistory(s, fx.home)).added, 1);
  assert.equal(s.getCursor(HISTORY_CURSOR).offset, Buffer.byteLength(a), 'the cursor stops before the half line');
  fs.appendFileSync(file, b.slice(20));
  const r2 = await ingestHistory(s, fx.home);
  assert.deepEqual(r2.ids, ['history:sess-1:' + Buffer.byteLength(a)], 'the finished line, once');
  assert.equal((await ingestHistory(s, fx.home)).added, 0, 'nothing doubles');
  const c = historyLine({ display: 'placeholder rotated' });
  fs.writeFileSync(file, c);   // Claude Code rewrote/rotated the file: shorter than the cursor
  const r3 = await ingestHistory(s, fx.home);
  assert.equal(r3.reset, true);
  assert.deepEqual(s.listDocuments({ source: 'history' }).map((d) => d.id), ['history:sess-1:0']);
  assert.match(s.getDocument({ id: 'history:sess-1:0' }).text, /rotated/);
  const same = historyLine({ display: 'placeholder XXXXXXX' });   // same length, different head: also a reset
  fs.writeFileSync(file, same.replace('XXXXXXX', 'rotated'.toUpperCase()) + historyLine({ display: 'placeholder more' }));
  assert.equal((await ingestHistory(s, fx.home)).reset, true);
});

test('history.jsonl is never written; a missing file is not an error', async () => {
  const { s, fx, file } = histSetup();
  assert.equal((await ingestHistory(s, fx.home)).missing, true);
  fs.writeFileSync(file, historyLine({ display: 'placeholder keep' }));
  const before = fs.statSync(file), bytes = fs.readFileSync(file);
  await ingestHistory(s, fx.home); await ingestHistory(s, fx.home);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('syncDocs = notes + history; watchDocs fires once per burst and stops on close', async () => {
  const { s, fx, opts, file } = histSetup();
  fs.writeFileSync(file, historyLine({ display: 'placeholder via sync' }));
  const r = await syncDocs(s, opts);
  assert.equal(r.changed.length, 6, '5 notes + 1 history line');
  let calls = 0;
  const w = watchDocs(opts, () => { calls++; }, { debounceMs: 200 });
  try {
    fs.writeFileSync(path.join(fx.prompts, 'new-prompt.md'), '---\ntitle: New placeholder\n---\nBody');
    fs.appendFileSync(file, historyLine({ display: 'placeholder live' }));
    const until = Date.now() + 4000;
    while (!calls && Date.now() < until) await new Promise((res) => setTimeout(res, 50));
    assert.ok(calls >= 1, 'a change was noticed');
  } finally { w.close(); }
  const n = calls;
  fs.writeFileSync(path.join(fx.prompts, 'after-close.md'), 'x');
  await new Promise((res) => setTimeout(res, 600));
  assert.equal(calls, n, 'closed watchers stay quiet');
});

test('syncDocs passes through unreadable roots and history counters', async () => {
  const { s, opts, file } = histSetup();
  fs.writeFileSync(file, historyLine({ display: 'placeholder one' }) + 'not json\n');
  const r = await syncDocs(s, opts);
  assert.deepEqual(r.unreadable, []);
  assert.equal(typeof r.skipped, 'number');
  assert.deepEqual(r.history, { added: 1, bad: 1, reset: false, missing: false });
  const m = mock.method(fs, 'readdirSync', () => { const e = new Error('denied'); e.code = 'EPERM'; throw e; });
  try { assert.ok((await syncDocs(s, opts)).unreadable.length >= 1); } finally { m.mock.restore(); }
});

test('history stat failures other than ENOENT surface instead of reading as missing', async () => {
  const { s, fx, file } = histSetup();
  fs.writeFileSync(file, historyLine({ display: 'placeholder x' }));
  const m = mock.method(fs.promises, 'stat', async () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; });
  try { await assert.rejects(ingestHistory(s, fx.home), /busy/); } finally { m.mock.restore(); }
});

test('a forgotten history line stays forgotten across rotation and does not hide an unrelated line at its old offset', async () => {
  const { s, fx, file } = histSetup();
  const a = historyLine({ display: 'placeholder keep a', timestamp: 1759320000000 }), b = historyLine({ display: 'placeholder forget me', timestamp: 1759320001000 });
  fs.writeFileSync(file, a + b);
  await ingestHistory(s, fx.home);
  const bid = 'history:sess-1:' + Buffer.byteLength(a);
  assert.equal(s.forget({ documentId: bid }), true);
  // rotation: forgotten line now first, an unrelated same-session line lands on the old offset
  const c = historyLine({ display: 'placeholder unrelated c', timestamp: 1759320002000 });
  const d = historyLine({ display: 'placeholder swap a', timestamp: 1759320000000 });
  assert.equal(Buffer.byteLength(d), Buffer.byteLength(a));
  fs.writeFileSync(file, d + c + b);
  const r = await ingestHistory(s, fx.home);
  assert.equal(r.reset, true);
  const texts = s.listDocuments({ source: 'history' }).map((d) => s.getDocument({ id: d.id }).text);
  assert.ok(!texts.some((t) => /forget me/.test(t)), 'forgotten line does not come back');
  assert.ok(texts.some((t) => /unrelated c/.test(t)), 'unrelated line is not hidden');
});
