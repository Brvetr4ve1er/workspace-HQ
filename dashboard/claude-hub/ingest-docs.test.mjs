import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { parseFrontmatter, docId, syncNotes, listNoteFiles } from './ingest-docs.mjs';
import { makeDocsHome, FOLDER } from './__fixtures__/make-docs.mjs';

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
