// Prompt library main side (spec 2026-10-15 §6.4, phase P1): note writing + (Task 5) open whitelist. Temp dirs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import prompts from './claude-prompts.js';
import note from './claude-prompt-note.js';

const { writePromptNote, resolvePromptsDir } = prompts;
const WIN = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p1-'));
const TEXT = note.promptNoteText({ title: 'Review a PR', tags: ['review'], created: '2026-10-15T10:00:00Z', body: 'Placeholder {{file}}' });
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));

test('writes a new note, creating the Prompts folder inside the vault', async () => {
  const vault = tmp();
  assert.equal(await resolvePromptsDir(vault), null, 'missing folder is null, not an error');
  const r = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  const dir = path.join(vault, '40_Resources', 'Prompts');
  assert.equal(r.name, 'review-a-pr.md');
  // .native = the same resolver as fsp.realpath: it expands 8.3 TEMP names (C:\Users\ROGSTR~1\…); the JS fs.realpathSync does not
  assert.equal(path.dirname(r.path).toLowerCase(), fs.realpathSync.native(dir).toLowerCase());
  assert.equal(fs.readFileSync(r.path, 'utf8'), TEXT);
  assert.deepEqual(leftovers(dir), []);
});

test('never overwrites: clash and a file appearing mid-write both refuse', async () => {
  const vault = tmp();
  const dir = path.join(vault, '40_Resources', 'Prompts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review-a-pr.md'), 'OWNER NOTE');
  const a = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  assert.deepEqual(a, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-2.md' });
  fs.writeFileSync(path.join(dir, 'review-a-pr-2.md'), 'OWNER NOTE 2');
  assert.equal((await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT })).next, 'review-a-pr-3.md');
  for (let n = 3; n <= 9; n++) fs.writeFileSync(path.join(dir, `review-a-pr-${n}.md`), 'x');
  const full = await writePromptNote(vault, { name: 'review-a-pr.md', text: TEXT });
  assert.equal(full.exists, true); assert.equal(full.next, null);
  // a file that appears between the check and the link (Obsidian saving the same name): EEXIST → refused, theirs kept
  const race = { link: async (from, to) => { fs.writeFileSync(to, 'APPEARED'); return fsp.link(from, to); }, rename: fsp.rename };
  const b = await writePromptNote(vault, { name: 'fresh.md', text: TEXT }, { ops: race });
  assert.equal(b.exists, true);
  assert.equal(fs.readFileSync(path.join(dir, 'fresh.md'), 'utf8'), 'APPEARED');
  assert.equal(fs.readFileSync(path.join(dir, 'review-a-pr.md'), 'utf8'), 'OWNER NOTE');
  assert.deepEqual(leftovers(dir), []);
});

test('a slug at the 60-character cap clashes and the offered -2 name is accepted', async () => {
  const vault = tmp();
  const dir = path.join(vault, '40_Resources', 'Prompts');
  fs.mkdirSync(dir, { recursive: true });
  for (const [src, len] of [['abcdefghi '.repeat(7), 59], ['abcdefghij '.repeat(7), 60]]) {
    const slug = note.slugify(src);
    assert.equal(slug.length, len);
    fs.writeFileSync(path.join(dir, `${slug}.md`), 'OWNER NOTE');
    const a = await writePromptNote(vault, { name: `${slug}.md`, text: TEXT });
    assert.equal(a.exists, true); assert.equal(a.next, `${slug}-2.md`);
    const b = await writePromptNote(vault, { name: a.next, text: TEXT });
    assert.equal(b.name, a.next, JSON.stringify(b));
    assert.equal(fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8'), 'OWNER NOTE');
    fs.rmSync(path.join(dir, `${slug}.md`)); fs.rmSync(path.join(dir, a.next));
  }
});

test('refuses names, texts and folders it does not make', async () => {
  const vault = tmp();
  for (const name of ['../x.md', 'a/b.md', 'a\\b.md', 'X.md', 'con.md', 'x.txt', '', '.md', 'a'.repeat(70) + '.md', null]) {
    const r = await writePromptNote(vault, { name, text: TEXT });
    assert.ok(r.error && !r.exists, String(name));
  }
  assert.ok((await writePromptNote(vault, { name: 'ok.md', text: 'no frontmatter' })).error);
  assert.ok((await writePromptNote(vault, { name: 'ok.md', text: '---\n' + 'x'.repeat(200001) })).error);
  assert.ok((await writePromptNote(path.join(vault, 'nope'), { name: 'ok.md', text: TEXT })).error, 'missing vault');
  assert.ok((await writePromptNote(null, { name: 'ok.md', text: TEXT })).error, 'no vault configured');
  assert.equal(fs.existsSync(path.join(vault, '40_Resources', 'Prompts', 'ok.md')), false);
});

test('a Prompts junction that leads out of the vault is refused', { skip: !WIN && 'junctions are Windows-only' }, async () => {
  const vault = tmp(), outside = tmp();
  fs.mkdirSync(path.join(vault, '40_Resources'), { recursive: true });
  fs.symlinkSync(outside, path.join(vault, '40_Resources', 'Prompts'), 'junction');
  const r = await writePromptNote(vault, { name: 'ok.md', text: TEXT });
  assert.match(r.error, /outside the vault/);
  assert.deepEqual(fs.readdirSync(outside), []);
  await assert.rejects(resolvePromptsDir(vault), /outside the vault/);
});
