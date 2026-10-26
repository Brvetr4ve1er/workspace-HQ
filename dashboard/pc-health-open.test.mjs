import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createOpener, listedFolders } = createRequire(import.meta.url)('./pc-health-open.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-pcopen-'));
const listed = path.join(tmp, 'Listed');
fs.mkdirSync(listed);
const file = path.join(tmp, 'a-file.txt');
fs.writeFileSync(file, 'x');
const ph = { detail: { hogs: { items: [{ path: listed, gb: 1 }, { path: file, gb: 1 }, { path: path.join(tmp, 'Gone'), gb: 1 }] } } };

const make = (pc = ph) => {
  const opened = [];
  return { opened, open: createOpener({ readPcHealth: () => pc, openPath: async (p) => { opened.push(p); return ''; } }) };
};

test('opens a folder listed in the current disk breakdown', async () => {
  const { open, opened } = make();
  assert.equal(await open(listed), true);
  assert.deepEqual(opened, [listed]);
});

test('refuses anything not listed verbatim — even a real folder or a near-miss', async () => {
  const { open, opened } = make();
  assert.match((await open(tmp)).error, /not in the current disk breakdown/);
  assert.match((await open(listed + '\\')).error, /not in the current disk breakdown/);
  assert.match((await open(listed.toUpperCase() === listed ? listed + 'x' : listed.toUpperCase())).error, /not in the current disk breakdown/);
  assert.match((await open('C:\\Windows')).error, /not in the current disk breakdown/);
  assert.deepEqual(opened, []);
});

test('refuses a listed path that is a file or no longer exists', async () => {
  const { open, opened } = make();
  assert.match((await open(file)).error, /not a folder/);
  assert.match((await open(path.join(tmp, 'Gone'))).error, /no longer exists/);
  assert.deepEqual(opened, []);
});

test('bad input and a missing sidecar are refused', async () => {
  const { open } = make(null);
  assert.match((await open(listed)).error, /not in the current disk breakdown/);
  const { open: o2 } = make();
  for (const bad of [null, 42, '', {}, 'x'.repeat(2000)]) assert.ok((await o2(bad)).error);
});

test('an openPath error string comes back as an error', async () => {
  const open = createOpener({ readPcHealth: () => ph, openPath: async () => 'Access is denied' });
  assert.deepEqual(await open(listed), { error: 'Access is denied' });
});

test('listedFolders tolerates junk', () => {
  assert.equal(listedFolders({ detail: { hogs: { items: [null, { path: 3 }, { path: 'C:\\x' }] } } }).size, 1);
  assert.equal(listedFolders(undefined).size, 0);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
