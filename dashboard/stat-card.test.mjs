// dashboard/stat-card.test.mjs — Save stat card PNG (IPC-CONTRACT 2026-10-27). Temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStatCardSave, decodePng, defaultName } = require('./stat-card.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-a-png')]);
const url = (b) => 'data:image/png;base64,' + b.toString('base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-stat-card-'));

test('writes the decoded PNG where the dialog points', async () => {
  const dir = tmp(), file = path.join(dir, 'card.png'), asked = [];
  const save = createStatCardSave({ pick: async (n) => { asked.push(n); return file; } });
  assert.deepEqual(await save(url(PNG)), { ok: true, path: file });
  assert.deepEqual(fs.readFileSync(file), PNG);
  assert.match(asked[0], /^stat-card-\d{4}-\d{2}-\d{2}\.png$/);
});

test('HQ_STAT_CARD_PATH replaces the dialog; a cancelled dialog writes nothing', async () => {
  const dir = tmp(), file = path.join(dir, 'gate.png');
  const gated = createStatCardSave({ env: { HQ_STAT_CARD_PATH: file }, pick: async () => { throw new Error('dialog opened'); } });
  assert.deepEqual(await gated(url(PNG)), { ok: true, path: file });
  const cancel = createStatCardSave({ pick: async () => null });
  assert.deepEqual(await cancel(url(PNG)), { ok: false, canceled: true });
});

test('refuses anything that is not a PNG data URL, or too big, before asking for a path', async () => {
  let asked = 0;
  const save = createStatCardSave({ pick: async () => { asked++; return null; } });
  assert.deepEqual(await save('data:image/jpeg;base64,AAAA'), { error: 'not a PNG' });
  assert.deepEqual(await save(url(Buffer.from('GIF89a-not-png'))), { error: 'not a PNG' });
  assert.deepEqual(await save(42), { error: 'not a PNG' });
  assert.deepEqual(decodePng('data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024)), { error: 'too big' });
  assert.equal(asked, 0);
  assert.equal(defaultName(new Date(2026, 0, 5)), 'stat-card-2026-01-05.png');
});
