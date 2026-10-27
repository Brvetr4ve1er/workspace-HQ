import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeChatGPTZip } from './claude-hub/__fixtures__/make-chatgpt-export.mjs';
import { zipFiles } from './claude-hub/__fixtures__/make-export.mjs';
const require = createRequire(import.meta.url);
const { detectExportKind, createWatcher, importsDir, EVENT } = require('./claude-imports.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rig = (o = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-imports-'));
  const dir = path.join(root, 'WorkspaceHQ Imports'); fs.mkdirSync(dir);
  const sent = [];
  const w = createWatcher({ dir, seenFile: path.join(root, 'claude', 'imports-seen.json'), send: (ch, d) => sent.push([ch, d]), stableMs: 100, refuseAfterMs: 400, pollMs: 60000, ...o });
  return { root, dir, sent, w, found: () => sent.filter(([, d]) => d.event === 'found').map(([, d]) => d.data) };
};
const settle = async (w, n = 3) => { for (let i = 0; i < n; i++) { await w.scan(); await sleep(130); } await w.scan(); };

test('detectExportKind: ChatGPT, claude.ai, and the refusal wording', () => {
  assert.deepEqual(detectExportKind(['conversations.json', 'user.json', 'chat.html']), { kind: 'chatgpt', reason: null });
  assert.deepEqual(detectExportKind(['conversations.json', 'projects.json', 'users.json']), { kind: 'claude', reason: null });
  assert.deepEqual(detectExportKind(['conversations.json', 'users.json']), { kind: 'claude', reason: null });
  assert.equal(detectExportKind(['photos.json']).reason, 'Not a ChatGPT, claude.ai, Instagram or Facebook export (looked for conversations.json or a profile information file)');
  assert.deepEqual(detectExportKind(['start_here.html', 'instagram_profile_information.html', 'message_1.html']), { kind: 'instagram', reason: null });
  assert.deepEqual(detectExportKind(['profile_information.json', 'your_friends.json', 'message_1.json']), { kind: 'facebook', reason: null });
  assert.equal(detectExportKind(['profile_information.json']).kind, null, 'a lone profile file is not enough');
  assert.equal(detectExportKind(['conversations.json']).kind, null);
  assert.equal(importsDir({ HQ_IMPORTS_DIR: 'C:\\gate\\imports' }), 'C:\\gate\\imports');
  assert.match(importsDir({}), /Documents[\\/]WorkspaceHQ Imports$/);
});

test('waits for a stable, readable ZIP before announcing', async () => {
  const { dir, w, sent, found, root } = rig();
  const full = fs.readFileSync(writeChatGPTZip(path.join(root, 'src.zip')));
  const target = path.join(dir, 'chatgpt-export.zip');
  fs.writeFileSync(target, full.subarray(0, 64));   // a copy in progress: no central directory yet
  await w.scan(); await sleep(130); await w.scan();
  assert.deepEqual(sent, [], 'a half-written ZIP is neither announced nor refused (yet)');
  fs.writeFileSync(target, full);                   // the copy finished
  await settle(w);
  assert.deepEqual(found().map((f) => [f.file, f.kind, f.bytes]), [['chatgpt-export.zip', 'chatgpt', full.length]]);
  assert.equal(sent[0][0], EVENT);
  assert.equal(found().length, 1, 'announced once');
  assert.deepEqual(w.pending().found.map((f) => f.file), ['chatgpt-export.zip']);
  assert.equal(w.pending().folder.exists, true); assert.equal(w.pending().folder.name, 'WorkspaceHQ Imports');
});

test('a ZIP that stays unreadable is refused only after it stopped changing for refuseAfterMs; a non-export ZIP is refused with the reason', async () => {
  const { dir, w, sent } = rig();
  fs.writeFileSync(path.join(dir, 'broken.zip'), 'not a zip at all');
  zipFiles(path.join(dir, 'photos.zip'), [{ name: 'a.txt', data: 'placeholder' }]);
  await settle(w, 2);
  const errs = () => sent.filter(([, d]) => d.event === 'error').map(([, d]) => d.data);
  assert.deepEqual(errs().map((e) => e.file), ['photos.zip']);
  assert.equal(errs()[0].error, 'Not a ChatGPT, claude.ai, Instagram or Facebook export (looked for conversations.json or a profile information file)');
  await sleep(450); await w.scan();
  assert.deepEqual(errs().map((e) => e.file).sort(), ['broken.zip', 'photos.zip']);
  assert.match(errs().find((e) => e.file === 'broken.zip').error, /not a readable ZIP/);
});

test('dismiss and import are remembered across restarts; a vanished file is gone; the drop folder is never written', async () => {
  const r = rig();
  const a = writeChatGPTZip(path.join(r.dir, 'a.zip'));
  zipFiles(path.join(r.dir, 'b.zip'), [{ name: 'conversations.json', data: '[]' }, { name: 'projects.json', data: '[]' }]);
  const before = fs.readdirSync(r.dir).sort();
  await settle(r.w);
  const [fa, fb] = ['a.zip', 'b.zip'].map((n) => r.found().find((f) => f.file === n));
  assert.equal(fb.kind, 'claude');
  assert.equal(r.w.dismiss(fb.dropId), true); assert.equal(r.w.dismiss('nope'), false);
  const t = r.w.take(fa.dropId);
  assert.equal(t.file, a); assert.equal(t.kind, 'chatgpt');
  r.w.markImported(t.key);
  assert.deepEqual(r.w.pending().found, []);
  assert.ok(r.sent.some(([, d]) => d.event === 'gone' && d.data.dropId === fb.dropId));
  const seen = JSON.parse(fs.readFileSync(path.join(r.root, 'claude', 'imports-seen.json'), 'utf8'));
  assert.deepEqual(Object.values(seen).sort(), ['dismissed', 'imported']);
  const again = createWatcher({ dir: r.dir, seenFile: path.join(r.root, 'claude', 'imports-seen.json'), send: () => {}, stableMs: 100, pollMs: 60000 });
  await settle(again);
  assert.deepEqual(again.pending().found, [], 'answered files are never announced again');
  assert.deepEqual(fs.readdirSync(r.dir).sort(), before, 'nothing created, moved or deleted in the drop folder');
  const c = writeChatGPTZip(path.join(r.dir, 'c.zip'));
  await settle(r.w);
  const fc = r.found().find((f) => f.file === 'c.zip');
  fs.rmSync(c);
  await r.w.scan();
  assert.ok(r.sent.some(([, d]) => d.event === 'gone' && d.data.dropId === fc.dropId));
  assert.equal(r.w.take(fc.dropId), null);
});

test('a missing drop folder is reported, not created', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-imports-none-'));
  const dir = path.join(root, 'WorkspaceHQ Imports');
  const w = createWatcher({ dir, seenFile: path.join(root, 'seen.json'), send: () => {}, pollMs: 60000 });
  await w.scan();
  assert.deepEqual(w.pending(), { folder: { exists: false, name: 'WorkspaceHQ Imports' }, found: [], refused: [] });
  assert.equal(fs.existsSync(dir), false);
});
