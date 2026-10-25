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

import { makeDocsHome } from './claude-hub/__fixtures__/make-docs.mjs';

const { createPrompts, obsidianUrl, init } = prompts;
function rig(o = {}) {
  const fx = makeDocsHome(tmp());
  const ext = [], opened = [], logs = [];
  const p = createPrompts({ vaultDir: fx.vault, openExternal: async (u) => { ext.push(u); }, openPath: async (f) => { opened.push(f); return ''; },
    protocolName: () => (o.noObsidian ? '' : 'Obsidian'), env: o.env || {}, log: (l) => logs.push(l), ...o.over });
  const idOf = (...rel) => note.promptDocId(path.join(path.resolve(fx.vault), '40_Resources', 'Prompts', ...rel));
  return { fx, p, ext, opened, logs, idOf };
}

test('status says folder/obsidian and the vault basename; never a path', async () => {
  const { p } = rig();
  const s = await p.status();
  assert.deepEqual(s, { vault: 'vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true });
  const none = createPrompts({ vaultDir: tmp(), openExternal: async () => {}, openPath: async () => '', protocolName: () => '', env: {}, log: () => {} });
  assert.deepEqual((await none.status()).folder, { exists: false });
  assert.equal((await none.status()).obsidian, false);
});

test('open refuses everything but a contained prompt note; only the two allowed targets are opened', async () => {
  const { fx, p, ext, opened, idOf } = rig();
  const good = idOf('review-a-pr.md');
  assert.deepEqual(await p.open(good, 'obsidian'), { ok: true, how: 'obsidian' });
  assert.deepEqual(ext, ['obsidian://open?vault=vault&file=40_Resources%2FPrompts%2Freview-a-pr']);
  assert.deepEqual(await p.open(good, 'file'), { ok: true, how: 'file' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].toLowerCase(), path.join(fs.realpathSync.native(fx.prompts), 'review-a-pr.md').toLowerCase());   // .native: see Task 3 (8.3 TEMP names)
  const refused = [
    [idOf('drafts', 'nested.md'), 'obsidian'],          // a subfolder note is not a Library note
    [idOf('notes.txt'), 'file'],                          // not a .md note
    ['memory:' + 'a'.repeat(40), 'file'],                 // another document kind
    ['prompt:' + 'f'.repeat(40), 'obsidian'],             // no such note
    ['prompt:../../x', 'file'], ['C:\Windows\notepad.exe', 'file'], ['https://example.invalid/', 'obsidian'], [null, 'file'], [{}, 'file'],
    [good, 'url'], [good, undefined],                    // only 'obsidian' | 'file'
  ];
  for (const [id, how] of refused) assert.ok((await p.open(id, how)).error, JSON.stringify([id, how]));
  fs.unlinkSync(path.join(fx.prompts, 'review-a-pr.md'));   // deleted in Obsidian since the last sweep
  assert.match((await p.open(good, 'obsidian')).error, /not in the Prompts folder/);
  assert.equal(ext.length, 1, 'nothing else was ever opened externally');
  assert.equal(opened.length, 1, 'nothing else was ever opened as a file');
});

test('the obsidian link encodes the vault basename (HQ_VAULT_DIR override) and the note name', () => {
  assert.equal(obsidianUrl('My Vault #1', 'a & b.md'), 'obsidian://open?vault=My%20Vault%20%231&file=40_Resources%2FPrompts%2Fa%20%26%20b');
  assert.throws(() => obsidianUrl('v', '../x.md'));
  assert.throws(() => obsidianUrl('v', 'a/b.md'));
});

test('no obsidian handler → status says so and open(how:obsidian) is refused with fallback file', async () => {
  const { p, ext, idOf } = rig({ noObsidian: true });
  assert.equal((await p.status()).obsidian, false);
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'obsidian'), { error: 'Obsidian is not installed — use Open file', fallback: 'file' });
  assert.deepEqual(ext, []);
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'file'), { ok: true, how: 'file' });
});

test('HQ_DRY_LAUNCH=1 opens nothing and logs only the file name', async () => {
  const { p, ext, opened, logs, idOf } = rig({ env: { HQ_DRY_LAUNCH: '1' } });
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'obsidian'), { ok: true, how: 'obsidian', dry: true });
  assert.deepEqual(await p.open(idOf('review-a-pr.md'), 'file'), { ok: true, how: 'file', dry: true });
  assert.deepEqual([ext, opened], [[], []]);
  assert.deepEqual(logs, ['[dry-open] obsidian review-a-pr.md', '[dry-open] file review-a-pr.md']);
});

test('a Prompts junction out of the vault: status explains, open refuses', { skip: !WIN && 'junctions are Windows-only' }, async () => {
  const vault = tmp(), outside = tmp();
  fs.mkdirSync(path.join(vault, '40_Resources'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'x.md'), '---\ntitle: x\n---\n');
  fs.symlinkSync(outside, path.join(vault, '40_Resources', 'Prompts'), 'junction');
  const ext = [];
  const p = createPrompts({ vaultDir: vault, openExternal: async (u) => { ext.push(u); }, openPath: async () => '', protocolName: () => 'Obsidian', env: {}, log: () => {} });
  const s = await p.status();
  assert.equal(s.folder.exists, false); assert.match(s.folder.error, /outside the vault/);
  const id = note.promptDocId(path.join(path.resolve(vault), '40_Resources', 'Prompts', 'x.md'));
  assert.match((await p.open(id, 'obsidian')).error, /outside the vault/);
  assert.deepEqual(ext, []);
});

test('init: HQ_VAULT_DIR wins; handlers answer, ids are capped', async () => {
  const fx = makeDocsHome(tmp());
  const h = {};
  init({ ipcMain: { handle: (ch, fn) => { h[ch] = fn; } }, app: { getApplicationNameForProtocol: () => '' }, shell: { openExternal: async () => {}, openPath: async () => '' },
    vaultDir: path.join(os.tmpdir(), 'never-the-owner-vault'), env: { HQ_VAULT_DIR: fx.vault, HQ_DRY_LAUNCH: '1' }, log: () => {} });
  assert.deepEqual(Object.keys(h).sort(), ['hq:claude-prompts:open', 'hq:claude-prompts:status']);
  assert.equal((await h['hq:claude-prompts:status']({})).folder.exists, true);
  assert.ok((await h['hq:claude-prompts:open']({}, 'prompt:' + 'a'.repeat(400), 'file')).error);
});
