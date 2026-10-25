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
  assert.deepEqual(Object.keys(h).sort(), ['hq:claude-prompts:open', 'hq:claude-prompts:promote', 'hq:claude-prompts:status']);
  assert.equal((await h['hq:claude-prompts:status']({})).folder.exists, true);
  assert.ok((await h['hq:claude-prompts:open']({}, 'prompt:' + 'a'.repeat(400), 'file')).error);
});

// ---- P2 Promote (spec 2026-10-15 §6.1, §6.4, §8). Temp vaults only; the secret is built at runtime.
const SECRET = () => 'gh' + 'p_' + 'A'.repeat(36);
function p2Vault() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hq-p2-vault-')); }
function p2Make(vaultDir, o = {}) {
  const logs = [];
  const p = prompts.createPrompts({ vaultDir, openExternal: async () => {}, openPath: async () => '', protocolName: () => '', env: {},
    log: (s) => logs.push(s), now: () => new Date('2026-10-25T10:00:00Z'), ...o });
  return { p, logs };
}
const PDIR = (v) => path.join(v, '40_Resources', 'Prompts');

test('promote masks the body and the title before writing; creates the folder; §6.1 layout', async () => {
  const v = p2Vault(); const { p, logs } = p2Make(v);
  const r = await p.promote({ text: 'Review {{file}} with the placeholder token ' + SECRET() + ' and list changes.', title: 'Placeholder review ' + SECRET(),
    source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-09-01T10:00:00Z' } });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.match(r.name, /^placeholder-review-.*\.md$/);
  assert.equal(r.path, '40_Resources/Prompts/' + r.name);
  assert.match(r.id, /^prompt:[0-9a-f]{40}$/);
  assert.equal(r.masked, 2);
  const file = path.join(PDIR(v), r.name), src = fs.readFileSync(file, 'utf8');
  assert.equal(src.includes(SECRET()), false);
  assert.match(src, /••• secret \(github-token\)/);
  assert.match(src, /^---\ntitle: "Placeholder review ••• secret \(github-token\)"\ntags: \[harvested\]\nvariables: \[file\]\nversion: 1\ncreated: 2026-10-25T10:00:00.000Z\n/);
  assert.match(src, /\nsource: \{ kind: code, conversation: "code:sess-a1", at: "2026-09-01T10:00:00Z" \}\n/);
  assert.ok(src.includes(`hq: { id: "${r.id}" }`));
  assert.equal(r.id, note.promptDocId(path.join(path.resolve(v), '40_Resources', 'Prompts', r.name)));
  assert.equal(logs.some((l) => l.includes('placeholder token')), false);   // logs carry the file name only
});

test("promote: name must be the title's slug or slug-2…-9; never overwrites; creates the folder", async () => {
  const v = p2Vault(); const { p } = p2Make(v);
  const base = { text: 'Placeholder prompt body for the clash test.', title: 'Review a PR' };
  fs.mkdirSync(PDIR(v), { recursive: true });
  fs.writeFileSync(path.join(PDIR(v), 'review-a-pr.md'), 'OWNER NOTE');
  const c1 = await p.promote(base);
  assert.deepEqual(c1, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-2.md' });
  assert.equal(fs.readFileSync(path.join(PDIR(v), 'review-a-pr.md'), 'utf8'), 'OWNER NOTE');
  for (const name of ['../x.md', 'C:\\x.md', '..\\review-a-pr-2.md', 'other-2.md', 'review-a-pr-10.md', 'review-a-pr.md', 'review-a-pr-2.txt', 'sub/review-a-pr-2.md', 7]) {
    const r = await p.promote({ ...base, name });
    assert.match(String(r.error), /not one this title can take/, 'refused: ' + name);
  }
  const ok = await p.promote({ ...base, name: 'review-a-pr-2.md' });
  assert.equal(ok.name, 'review-a-pr-2.md');
  assert.deepEqual(fs.readdirSync(PDIR(v)).sort(), ['review-a-pr-2.md', 'review-a-pr.md']);
  assert.equal(fs.readdirSync(v).join(','), '40_Resources');
  const again = await p.promote({ ...base, name: 'review-a-pr-2.md' });
  assert.deepEqual(again, { error: 'a prompt note with this name is already there', exists: true, next: 'review-a-pr-3.md' });
});

test('promote refuses empty / oversized / non-object input and a missing vault; drops a forged source', async () => {
  const v = p2Vault(); const { p } = p2Make(v);
  assert.match((await p.promote(null)).error, /prompt text is empty/);
  assert.match((await p.promote({ text: '   ' })).error, /prompt text is empty/);
  assert.match((await p.promote({ text: 'x'.repeat(100001), title: 't' })).error, /over 100 000 characters/);
  assert.match((await p2Make(null).p.promote({ text: 'Placeholder', title: 't' })).error, /no vault folder is configured/);
  assert.match((await p2Make(path.join(v, 'missing')).p.promote({ text: 'Placeholder', title: 't' })).error, /vault folder was not found/);
  const r = await p.promote({ text: 'Placeholder prompt without a title line', source: { kind: 'evil', conversation: 'javascript:alert(1)', at: 'x' } });
  assert.equal(r.name, 'placeholder-prompt-without-a-title-line.md');   // title defaults to the first non-empty line
  const src = fs.readFileSync(path.join(PDIR(v), r.name), 'utf8');
  assert.equal(/\nsource:/.test(src), false);
  const r2 = await p.promote({ text: 'Placeholder second', title: 'Second', source: { kind: 'web', conversation: 'javascript:alert(1)', at: 'not a date' } });
  assert.match(fs.readFileSync(path.join(PDIR(v), r2.name), 'utf8'), /\nsource: \{ kind: web, conversation: "", at: "" \}\n/);
});

test('init registers hq:claude-prompts:promote; junk input becomes {} and answers {error}', async () => {
  const v = p2Vault(); const h = {};
  prompts.init({ ipcMain: { handle: (ch, fn) => { h[ch] = fn; } }, app: { getApplicationNameForProtocol: () => '' }, shell: {}, vaultDir: v, env: {}, log: () => {} });
  assert.ok(h['hq:claude-prompts:promote']);
  assert.match((await h['hq:claude-prompts:promote']({}, 'junk')).error, /prompt text is empty/);
  const ok = await h['hq:claude-prompts:promote']({}, { text: 'Placeholder via ipc', title: 'Via IPC' });
  assert.equal(ok.name, 'via-ipc.md');
});
