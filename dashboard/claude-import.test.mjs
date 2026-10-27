import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerImport, init } = require('./claude-import.js');
const routes = require('./claude-bridge-routes.js');

function rig(pick, answer = { started: true }, extra = {}) {
  const handlers = new Map(), calls = [];
  const host = { request(op, args, o) { calls.push([op, args, o]); return Promise.resolve(answer); } };
  registerImport({ handle: (ch, fn) => handlers.set(ch, fn) }, host, { pickZip: pick, ...extra });
  return { run: (...a) => handlers.get('hq:claude-hub:import')({}, ...a), calls };
}

test('canceled dialog: no Hub call', async () => {
  const r = rig(async () => null);
  assert.deepEqual(await r.run(), { canceled: true }); assert.equal(r.calls.length, 0);
});

test('a picked zip goes to importExport; only the basename comes back', async () => {
  const r = rig(async () => 'C:\\placeholder\\exports\\claude-export.zip');
  assert.deepEqual(await r.run(), { started: true, file: 'claude-export.zip', kind: 'claude' });
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
    assert.deepEqual(await handlers.get('hq:claude-hub:import')({}), { started: true, file: 'claude-export.zip', kind: 'claude' });
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

test('H6: kind routing — chatgpt goes to importChatGPT, auto detects, a mismatch and an unknown kind are refused', async () => {
  const names = { 'C:\\p\\cg.zip': ['conversations.json', 'user.json'], 'C:\\p\\cl.zip': ['conversations.json', 'projects.json'], 'C:\\p\\x.zip': ['a.txt'] };
  const readNames = async (f) => names[f];
  let r = rig(async () => 'C:\\p\\cg.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('chatgpt'), { started: true, file: 'cg.zip', kind: 'chatgpt' });
  assert.equal(r.calls[0][0], 'importChatGPT');
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('auto'), { started: true, file: 'cl.zip', kind: 'claude' });
  assert.equal(r.calls[0][0], 'importExport');
  r = rig(async () => 'C:\\p\\x.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('auto'), { error: 'Not a ChatGPT, claude.ai, Instagram or Facebook export (looked for conversations.json or a profile information file)' });
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('chatgpt'), { error: 'That is a claude.ai export, not a ChatGPT export' }, 'an explicit kind is checked, not trusted');
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cg.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('claude'), { error: 'That is a ChatGPT export, not a claude.ai export' });
  assert.equal(r.calls.length, 0);
  r = rig(async () => 'C:\\p\\cl.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('nope'), { error: 'unknown import kind' });
  assert.equal(r.calls.length, 0);
});

test('Instagram / Facebook: meta or the exact network routes to importMeta with expect; the other network is refused', async () => {
  const names = { 'C:/p/ig.zip': ['instagram_profile_information.html'], 'C:/p/fb.zip': ['profile_information.json', 'your_friends.json'] };
  const readNames = async (f) => names[f];
  let r = rig(async () => 'C:/p/ig.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('meta'), { started: true, file: 'ig.zip', kind: 'instagram' });
  assert.deepEqual(r.calls[0].slice(0, 2), ['importMeta', { zipPath: 'C:/p/ig.zip', expect: 'instagram' }]);
  r = rig(async () => 'C:/p/fb.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('auto'), { started: true, file: 'fb.zip', kind: 'facebook' });
  r = rig(async () => 'C:/p/fb.zip', { started: true }, { readNames });
  assert.deepEqual(await r.run('instagram'), { error: 'That is a Facebook export, not an Instagram export' });
  assert.equal(r.calls.length, 0);
});

test('H6: a dropId imports the watcher\'s file with no dialog and marks it imported; an unknown dropId is refused', async () => {
  const marked = [];
  const w = { take: (id) => (id === 'd1' ? { file: 'C:\\drop\\cg.zip', kind: 'chatgpt', key: 'cg.zip|1|1' } : null), markImported: (k) => marked.push(k) };
  const r = rig(async () => { throw new Error('the dialog must not open'); }, { started: true }, { getWatcher: () => w });
  assert.deepEqual(await r.run('auto', { dropId: 'd1' }), { started: true, file: 'cg.zip', kind: 'chatgpt' });
  assert.deepEqual(r.calls[0].slice(0, 2), ['importChatGPT', { zipPath: 'C:\\drop\\cg.zip' }]);
  assert.deepEqual(marked, ['cg.zip|1|1']);
  assert.deepEqual(await r.run('auto', { dropId: 'zz' }), { error: 'that dropped file is gone or was already handled' });
  const bad = rig(async () => null, { error: 'an import is already running' }, { getWatcher: () => w });
  assert.deepEqual(await bad.run('auto', { dropId: 'd1' }), { error: 'an import is already running' });
});
