import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeImportLogic } from './claude-import.js';

function rig({ answer = { started: true, file: 'claude-export.zip' }, hub = { state: 'ready', role: 'writer' }, canWrite = true, bridge = true } = {}) {
  const toasts = [], denied = [], calls = [];
  const self = {
    ...claudeImportLogic,
    hq: bridge ? { claudeHub: { importExport: () => { calls.push('importExport'); return Promise.resolve(answer); } } } : null,
    LIVE: { claudeHub: hub, claudeImport: null },
    canWrite: () => canWrite, writeReason: () => 'Viewing a past snapshot',
    toast: (kind, text) => toasts.push([kind, text]), denied: (why) => denied.push(why), forceUpdate() {},
    async call(fn) { const r = await fn(); if (r && r.error) { toasts.push(['error', r.error]); return null; } return r; },
  };
  return { self, toasts, denied, calls };
}

test('clImport: started → running state + toast with the file name', async () => {
  const r = rig();
  await r.self.clImport();
  assert.deepEqual(r.calls, ['importExport']);
  assert.deepEqual(r.self.LIVE.claudeImport, { kind: 'import', phase: 'unzip', done: 0, total: 0 });
  assert.deepEqual(r.toasts, [['info', 'Importing claude-export.zip — chats appear as they are read.']]);
});

test('clImport: canceled is silent; an error is toasted; refusals never call main', async () => {
  const c = rig({ answer: { canceled: true } }); await c.self.clImport();
  assert.deepEqual([c.toasts, c.self.LIVE.claudeImport], [[], null]);
  const e = rig({ answer: { error: 'an import is already running' } }); await e.self.clImport();
  assert.deepEqual(e.toasts, [['error', 'an import is already running']]);
  const ro = rig({ canWrite: false }); await ro.self.clImport();
  assert.deepEqual([ro.calls, ro.denied], [[], ['Viewing a past snapshot']]);
  const rd = rig({ hub: { state: 'ready', role: 'reader' } }); await rd.self.clImport();
  assert.deepEqual(rd.calls, []); assert.match(rd.denied[0], /owns the Claude index/);
  const nb = rig({ bridge: false }); await nb.self.clImport();
  assert.match(nb.denied[0], /no app bridge/);
});
