import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import pack from './claude-prompt-pack.js';
import { zipFiles } from './claude-hub/__fixtures__/make-export.mjs';
import { readZipIndex } from './claude-hub/unzip.mjs';

// Placeholder text only; the secret is built at runtime. Temp folders only — never the owner's vault.
const SECRET = () => 'gh' + 'p_' + 'B'.repeat(36);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function vaultWithNote() {
  const v = tmp('hq-pack-vault-');
  const dir = path.join(v, '40_Resources', 'Prompts'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review-a-pr.md'), '---\ntitle: "Review a PR"\n---\nOwner text, untouched.\n');
  return { v, dir };
}
function make(vaultDir, o = {}) {
  const logs = [];
  const p = pack.createPacks({ vaultDir, env: {}, log: (s) => logs.push(s), now: o.now || (() => Date.now()),
    pick: async () => (o.pick === undefined ? null : o.pick), save: async () => (o.save === undefined ? null : o.save) });
  return { p, logs };
}
const listAll = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();

test('crc32 matches zlib.crc32 (Electron 32 main has no zlib.crc32)', () => {
  for (const s of ['', 'a', 'Placeholder prompt text', 'é🚀'.repeat(100)]) assert.equal(pack.crc32(Buffer.from(s)), zlib.crc32(Buffer.from(s)), s);
  const big = Buffer.alloc(70000, 7); assert.equal(pack.crc32(big), zlib.crc32(big));
});

test('exportPack streams a readable ZIP and never overwrites', async () => {
  const { v, dir } = vaultWithNote();
  fs.writeFileSync(path.join(dir, 'standup.md'), '---\ntitle: Standup\n---\nPlaceholder standup {{day}}\n');
  fs.mkdirSync(path.join(dir, 'sub')); fs.writeFileSync(path.join(dir, 'sub', 'nested.md'), 'not exported');
  fs.writeFileSync(path.join(dir, 'image.png'), 'not a note');
  const out = path.join(tmp('hq-pack-out-'), 'pack.zip');
  const r = await make(v, { save: out }).p.exportPack();
  assert.deepEqual(r, { file: 'pack.zip', notes: 2 });
  const { entries } = await readZipIndex(out);
  assert.deepEqual(entries.map((e) => e.name), ['review-a-pr.md', 'standup.md']);
  const back = await pack.readEntry(out, entries[1], pack.PACK_NOTE_MAX);
  assert.equal(back.toString('utf8'), fs.readFileSync(path.join(dir, 'standup.md'), 'utf8'));
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['pack.zip'], 'no partial file left');
  const before = fs.readFileSync(out);
  assert.match((await make(v, { save: out }).p.exportPack()).error, /already there .*nothing is ever replaced/);
  assert.deepEqual(fs.readFileSync(out), before);
  assert.deepEqual(await make(v, { save: null }).p.exportPack(), { canceled: true });
  assert.match((await make(v, { save: path.join(path.dirname(out), 'x.txt') }).p.exportPack()).error, /pick a \.zip/);
  assert.match((await make(tmp('hq-pack-empty-'), { save: out + '2.zip' }).p.exportPack()).error, /No prompts folder yet — nothing to export/);
});

test('importPack never overwrites and never escapes (ZIP): plan first, then one confirm', async () => {
  const { v, dir } = vaultWithNote();
  const src = tmp('hq-pack-src-');
  const zip = path.join(src, 'placeholder-pack.zip');
  zipFiles(zip, [
    { name: '../../evil.md', data: '---\ntitle: Evil\n---\nPlaceholder escape attempt' },
    { name: 'sub/dir/Daily Notes.md', data: 'Placeholder daily {{day}} with ' + SECRET() },
    { name: 'review-a-pr.md', data: 'Would overwrite the owner note' },
    { name: 'notes.txt', data: 'not markdown' },
    { name: 'big.md', data: 'x'.repeat(pack.PACK_NOTE_MAX + 1) },
    { name: 'folder/', data: '' },
  ]);
  const { p } = make(v, { pick: zip });
  const plan = await p.importPack({ from: 'zip' });
  assert.match(plan.planId, /^pack-[0-9a-f]{16}$/);
  assert.equal(plan.source, 'placeholder-pack.zip');
  assert.deepEqual(plan.notes, [
    { name: 'evil.md', title: 'Evil', exists: false },
    { name: 'daily-notes.md', title: 'daily-notes', exists: false },
    { name: 'review-a-pr.md', title: 'review-a-pr', exists: true },
  ]);
  assert.equal(plan.total, 3);
  assert.deepEqual(plan.skipped, { notMd: 1, tooBig: 1, tooMany: 0, duplicate: 0, unreadable: 0 });
  assert.deepEqual(listAll(dir), ['review-a-pr.md'], 'the plan writes nothing');
  const done = await p.importPack({ planId: plan.planId });
  assert.deepEqual(done, { imported: 2, masked: 1, skipped: { exists: 1, failed: 0 } });
  assert.deepEqual(listAll(dir), ['daily-notes.md', 'evil.md', 'review-a-pr.md']);
  assert.equal(fs.readFileSync(path.join(dir, 'review-a-pr.md'), 'utf8'), '---\ntitle: "Review a PR"\n---\nOwner text, untouched.\n');
  const daily = fs.readFileSync(path.join(dir, 'daily-notes.md'), 'utf8');
  assert.ok(!daily.includes(SECRET()), 'pack notes are written masked');
  assert.ok(daily.startsWith('---\ntitle: "daily-notes"\ntags: [imported]\n---\nPlaceholder daily {{day}} with '), 'a plain .md gets a minimal frontmatter; the body is kept');
  assert.equal(fs.readFileSync(path.join(dir, 'evil.md'), 'utf8'), '---\ntitle: Evil\n---\nPlaceholder escape attempt', 'a note with frontmatter is copied as is');
  assert.deepEqual(listAll(v), ['40_Resources', '40_Resources\\Prompts', '40_Resources\\Prompts\\daily-notes.md', '40_Resources\\Prompts\\evil.md', '40_Resources\\Prompts\\review-a-pr.md'].map((s) => s.split('\\').join(path.sep)).sort(), 'nothing outside the Prompts folder');
  assert.match((await p.importPack({ planId: plan.planId })).error, /expired — pick the pack again/, 'a plan is used once');
  assert.match((await p.importPack({ planId: 'pack-forged' })).error, /expired/);
  assert.deepEqual(await make(v, { pick: null }).p.importPack({}), { canceled: true });
});

test('importPack: folder = top-level .md only; plans expire; oversize ZIP and too many notes are refused or counted', async () => {
  const { v, dir } = vaultWithNote();
  const src = tmp('hq-pack-folder-');
  fs.writeFileSync(path.join(src, 'One.md'), 'Placeholder one'); fs.writeFileSync(path.join(src, 'one.md.txt'), 'x');
  fs.mkdirSync(path.join(src, 'deep')); fs.writeFileSync(path.join(src, 'deep', 'two.md'), 'Placeholder two');
  let t = 1000;
  const { p } = make(v, { pick: src, now: () => t });
  const plan = await p.importPack({ from: 'folder' });
  assert.deepEqual(plan.notes, [{ name: 'one.md', title: 'one', exists: false }], 'no frontmatter title → the slugged file name');
  assert.equal(plan.skipped.notMd, 1);
  t += pack.PLAN_TTL_MS + 1;
  assert.match((await p.importPack({ planId: plan.planId })).error, /expired/);
  assert.deepEqual(listAll(dir), ['review-a-pr.md']);
  const many = path.join(src, 'many.zip');
  zipFiles(many, Array.from({ length: pack.PACK_NOTES_MAX + 3 }, (_, i) => ({ name: `n${i}.md`, data: 'Placeholder ' + i })));
  const mp = await make(v, { pick: many }).p.importPack({ from: 'zip' });
  assert.equal(mp.total, pack.PACK_NOTES_MAX); assert.equal(mp.skipped.tooMany, 3);
  const dup = path.join(src, 'dup.zip');
  zipFiles(dup, [{ name: 'a/Same.md', data: 'one' }, { name: 'b/same.md', data: 'two' }]);
  assert.equal((await make(v, { pick: dup }).p.importPack({ from: 'zip' })).skipped.duplicate, 1);
  const notZip = path.join(src, 'fake.zip'); fs.writeFileSync(notZip, 'not a zip at all');
  assert.match((await make(v, { pick: notZip }).p.importPack({ from: 'zip' })).error, /not a readable ZIP/);
});
