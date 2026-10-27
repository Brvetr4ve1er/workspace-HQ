import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZipIndex, extractEntries, readEntry, baseName } from './unzip.mjs';
import { zipFiles } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-unzip-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CONV = JSON.stringify([{ uuid: 'c-1', name: 'Placeholder chat', chat_messages: [] }]);
const PROJ = JSON.stringify([{ uuid: 'p-1', name: 'project-a' }]);
const fresh = (d) => fs.mkdtempSync(path.join(d, 'o'));

test('extracts the two wanted files (deflate + stored, nested folder) and ignores everything else', async () => {
  const d = tmp(), zip = path.join(d, 'export.zip'), out = fresh(d);
  zipFiles(zip, [{ name: 'export-2026/conversations.json', data: CONV }, { name: 'export-2026/projects.json', data: PROJ, method: 0 }, { name: 'export-2026/users.json', data: '[]' }]);
  const idx = await readZipIndex(zip);
  assert.deepEqual(idx.entries.map((e) => baseName(e.name)), ['conversations.json', 'projects.json', 'users.json']);
  const got = await extractEntries(zip, ['conversations.json', 'projects.json'], out);
  assert.equal(fs.readFileSync(got['conversations.json'], 'utf8'), CONV);
  assert.equal(fs.readFileSync(got['projects.json'], 'utf8'), PROJ);
  assert.deepEqual(fs.readdirSync(out).sort(), ['conversations.json', 'projects.json']);
});

test('ZIP64 end records are understood', async () => {
  const d = tmp(), zip = path.join(d, 'z64.zip');
  zipFiles(zip, [{ name: 'conversations.json', data: CONV }], { forceZip64: true });
  assert.equal((await readZipIndex(zip)).entries.length, 1);
  assert.equal(fs.readFileSync((await extractEntries(zip, ['conversations.json'], fresh(d)))['conversations.json'], 'utf8'), CONV);
});

test('an entry path with ../ or a drive never escapes: the file lands under its fixed name in outDir', async () => {
  const d = tmp(), zip = path.join(d, 'evil.zip'), out = path.join(d, 'a', 'b', 'out'); fs.mkdirSync(out, { recursive: true });
  zipFiles(zip, [{ name: '../../evil/conversations.json', data: CONV }, { name: 'C:/abs/projects.json', data: PROJ }]);
  const got = await extractEntries(zip, ['conversations.json', 'projects.json'], out);
  assert.equal(got['conversations.json'], path.join(out, 'conversations.json'));
  assert.equal(got['projects.json'], path.join(out, 'projects.json'));
  assert.equal(fs.existsSync(path.join(d, 'a', 'evil')), false);
  assert.equal(fs.existsSync(path.join(d, 'evil')), false);
});

test('not a zip, truncated zip, unsupported method, size lie, zip bomb', async () => {
  const d = tmp();
  const junk = path.join(d, 'junk.zip'); fs.writeFileSync(junk, 'this is not a zip');
  await assert.rejects(readZipIndex(junk), /not a zip file/);
  const good = path.join(d, 'good.zip'); zipFiles(good, [{ name: 'conversations.json', data: CONV.repeat(50) }]);
  const b = fs.readFileSync(good), cut = path.join(d, 'cut.zip');
  fs.writeFileSync(cut, Buffer.concat([b.subarray(0, 40), b.subarray(b.length - 22)]));
  await assert.rejects(extractEntries(cut, ['conversations.json'], fresh(d)), /truncated zip|bad central directory|bad local header/);
  const m12 = path.join(d, 'm12.zip'); zipFiles(m12, [{ name: 'conversations.json', data: CONV, method: 12 }]);
  await assert.rejects(extractEntries(m12, ['conversations.json'], fresh(d)), /unsupported compression method \(12\)/);
  const lie = path.join(d, 'lie.zip'); zipFiles(lie, [{ name: 'conversations.json', data: CONV, lieSize: 3 }]);
  await assert.rejects(extractEntries(lie, ['conversations.json'], fresh(d)), /size mismatch/);
  const bomb = path.join(d, 'bomb.zip'); zipFiles(bomb, [{ name: 'conversations.json', data: Buffer.alloc(8 * 1024 * 1024) }]);
  assert.ok(fs.statSync(bomb).size < 64 * 1024, 'the bomb is tiny on disk');
  await assert.rejects(extractEntries(bomb, ['conversations.json'], fresh(d), { maxBytes: 1024 * 1024 }), /larger than 1048576 bytes/);
});

test('readEntry reads same-named entries apart, in memory, with the same checks', async () => {
  const d = tmp(), zip = path.join(d, 'meta.zip');
  zipFiles(zip, [{ name: 'inbox/a_1/message_1.json', data: '{"a":1}' }, { name: 'inbox/b_2/message_1.json', data: '{"b":2}', method: 0 }]);
  const { entries } = await readZipIndex(zip);
  assert.deepEqual(await Promise.all(entries.map(async (e) => String(await readEntry(zip, e)))), ['{"a":1}', '{"b":2}']);
  const lie = path.join(d, 'lie.zip'); zipFiles(lie, [{ name: 'x.json', data: CONV, lieSize: 3 }]);
  await assert.rejects(readEntry(lie, (await readZipIndex(lie)).entries[0]), /size mismatch|larger than/);
  const bomb = path.join(d, 'bomb.zip'); zipFiles(bomb, [{ name: 'x.json', data: Buffer.alloc(4 * 1024 * 1024) }]);
  await assert.rejects(readEntry(bomb, (await readZipIndex(bomb)).entries[0], { maxBytes: 1024 }), /larger than 1024 bytes/);
});

test('a wanted file that is absent is simply missing from the result', async () => {
  const d = tmp(), zip = path.join(d, 'other.zip');
  zipFiles(zip, [{ name: 'users.json', data: '[]' }]);
  assert.deepEqual(await extractEntries(zip, ['conversations.json', 'projects.json'], fresh(d)), {});
});
