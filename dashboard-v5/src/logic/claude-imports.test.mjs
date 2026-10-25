import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeImportsLogic } from './claude-imports.js';
import { claudeImportsVals } from '../vals/claude-imports.js';

function comp({ found = [], hub = { state: 'ready', role: 'writer' }, answer = { started: true, file: 'cg.zip', kind: 'chatgpt' }, canWrite = true } = {}) {
  const calls = [], toasts = [];
  const live = { claudeImports: { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found, refused: [], error: null }, claudeHub: hub, claudeImport: null, claudeLib: { docHits: null, doc: null } };
  const c = {
    LIVE: live, hq: { claudeHub: { importExport: async (...a) => { calls.push(['importExport', ...a]); return answer; } }, claudeImports: { dismiss: async (id) => { calls.push(['dismiss', id]); return true; } } },
    store: { openClaudeDocument: async (id) => calls.push(['open', id]), closeClaudeDocument: () => calls.push(['close']) },
    canWrite: () => canWrite, writeReason: () => 'Read-only right now', denied: (w) => toasts.push(['denied', w]),
    call: async (fn) => { const r = await fn(); return r && r.error ? (toasts.push(['error', r.error]), null) : r; },
    toast: (k, t) => toasts.push([k, t]), forceUpdate: () => {}, clOpenChat: () => {},
    ...claudeImportsLogic,
  };
  return { c, calls, toasts, live };
}
const card = { dropId: 'd1', file: 'chatgpt-export.zip', bytes: 1024, kind: 'chatgpt' };

test('confirm imports the first offered file by dropId with kind auto; nothing else is sent', async () => {
  const { c, calls, live } = comp({ found: [card] });
  await c.diConfirm();
  assert.deepEqual(calls, [['importExport', 'auto', { dropId: 'd1' }]]);
  assert.equal(live.claudeImport.phase, 'unzip'); assert.equal(live.claudeImport.source, 'chatgpt');
  assert.deepEqual(live.claudeImports.found, [], 'the card goes away at once');
});

test('Not now dismisses for good; a read-only window cannot confirm and says why', async () => {
  let r = comp({ found: [card] });
  await r.c.diDismiss();
  assert.deepEqual(r.calls, [['dismiss', 'd1']]); assert.deepEqual(r.live.claudeImports.found, []);
  r = comp({ found: [card], hub: { state: 'ready', role: 'reader' } });
  await r.c.diConfirm();
  assert.equal(r.calls.length, 0); assert.match(r.toasts[0][1], /Another WorkspaceHQ window owns the Claude index/);
});

test('Import ChatGPT export uses the dialog with kind chatgpt', async () => {
  const { c, calls } = comp();
  await c.diImportChatGPT();
  assert.deepEqual(calls, [['importExport', 'chatgpt']]);
});

test('vals: the card text, the folder line, document hits and the open document', () => {
  const { c, live } = comp({ found: [card, { ...card, dropId: 'd2' }] });
  live.claudeLib.docHits = [{ id: 'memory:1', source: 'memory', title: 'Tea', snippet: '\u0002tea\u0003', mtime_ms: 1 }];
  live.claudeLib.doc = { id: 'memory:1', source: 'memory', title: 'Tea', text: 'a\nb', mtime_ms: 1 };
  const v = claudeImportsVals.call(c, { LIVE: live, cantWrite: false, writeReason: '' });
  assert.equal(v.diShow, true);
  assert.match(v.diCard.text, /^Import ChatGPT export \(chatgpt-export\.zip, /);
  assert.equal(v.diMore, '+ 1 more waiting');
  assert.match(v.diFolderText, /WorkspaceHQ Imports/);
  assert.equal(v.cdHasHits, true); assert.equal(v.cdHits[0].badge, 'memory');
  assert.equal(v.cdOpen, true); assert.deepEqual(v.cdDoc.lines.map((l) => l.text), ['a', 'b']);
  assert.ok(Object.keys(v).every((k) => /^(di|cd)[A-Z]/.test(k)), 'surface keys are disjoint from every other surface');
  live.claudeImports.folder = { exists: false, name: 'WorkspaceHQ Imports' };
  assert.match(claudeImportsVals.call(c, { LIVE: live, cantWrite: false, writeReason: '' }).diFolderText, /not created yet/);
});
