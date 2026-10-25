import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerImport, init } = require('./claude-import.js');
const routes = require('./claude-bridge-routes.js');

function rig(pick, answer = { started: true }) {
  const handlers = new Map(), calls = [];
  const host = { request(op, args, o) { calls.push([op, args, o]); return Promise.resolve(answer); } };
  registerImport({ handle: (ch, fn) => handlers.set(ch, fn) }, host, { pickZip: pick });
  return { run: () => handlers.get('hq:claude-hub:import')({}), calls };
}

test('canceled dialog: no Hub call', async () => {
  const r = rig(async () => null);
  assert.deepEqual(await r.run(), { canceled: true }); assert.equal(r.calls.length, 0);
});

test('a picked zip goes to importExport; only the basename comes back', async () => {
  const r = rig(async () => 'C:\\placeholder\\exports\\claude-export.zip');
  assert.deepEqual(await r.run(), { started: true, file: 'claude-export.zip' });
  assert.deepEqual(r.calls, [['importExport', { zipPath: 'C:\\placeholder\\exports\\claude-export.zip' }, undefined]]);
});

test('Hub errors, wrong files and a broken dialog are honest errors', async () => {
  assert.deepEqual(await rig(async () => 'C:\\x\\e.zip', { error: 'an import is already running' }).run(), { error: 'an import is already running' });
  assert.deepEqual(await rig(async () => 'C:\\x\\notes.txt').run(), { error: 'pick a .zip file' });
  assert.deepEqual(await rig(async () => 'relative.zip').run(), { error: 'pick a .zip file' });
  assert.deepEqual(await rig(async () => { throw new Error('no window'); }).run(), { error: 'could not open the file dialog' });
});

test('init: HQ_CLAUDE_IMPORT_ZIP replaces the dialog (gates) and the bridge routes get the host', async () => {
  const prev = process.env.HQ_CLAUDE_IMPORT_ZIP;
  process.env.HQ_CLAUDE_IMPORT_ZIP = 'C:\\placeholder\\gate\\claude-export.zip';
  const handlers = new Map(), calls = [];
  const host = { request(op, args) { calls.push([op, args]); return Promise.resolve({ started: true }); } };
  try {
    assert.deepEqual(init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, host, getWin: () => null }), { registered: true });
    assert.equal(routes.getHub(), host);
    assert.deepEqual(await handlers.get('hq:claude-hub:import')({}), { started: true, file: 'claude-export.zip' });
    assert.equal(calls[0][1].zipPath, 'C:\\placeholder\\gate\\claude-export.zip');
  } finally {
    if (prev === undefined) delete process.env.HQ_CLAUDE_IMPORT_ZIP; else process.env.HQ_CLAUDE_IMPORT_ZIP = prev;
    routes.setHub(null);
  }
});

test('main.js hooks claude-import exactly once', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.equal(src.match(/require\('\.\/claude-import'\)\.init\(\{ ipcMain, host: claudeHub, getWin: \(\) => win \}\)/g).length, 1);
});
