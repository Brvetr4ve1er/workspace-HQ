import test from 'node:test';
import assert from 'node:assert/strict';
import { runLogic, RUN_TARGET_IDS } from './run.js';

function rig(o = {}) {
  const calls = [], toasts = [], went = [];
  const self = Object.assign(Object.create(runLogic), {
    state: { run: null, pack: null, prFor: o.prFor || null, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    canWrite: () => o.canWrite !== false, writeReason: () => 'read-only window', denied(why) { toasts.push(['denied', why]); },
    toast: (k, t) => toasts.push([k, t]), go: (tab, sub) => went.push([tab, sub]),
    ccNew(pid) { this.state = { ...this.state, ccOpen: true, ccProj: pid, ccMode: 'read-only', ccTurn: null }; },
    store: {
      runPrompt: async (req) => { calls.push(['run', req]); return o.run ? o.run(req) : { ok: true, target: req.target, title: 'T', usage: 'recorded' }; },
      packImport: async (req) => { calls.push(['import', req]); return o.pack ? o.pack(req) : (req.planId ? { imported: 1, masked: 0, skipped: { exists: 0, failed: 0 } } : { planId: 'pack-1', source: 'p.zip', notes: [], total: 0, skipped: {} }); },
      packExport: async () => { calls.push(['export']); return o.exp || { file: 'x.zip', notes: 2 }; },
    },
  });
  return { self, calls, toasts, went };
}

test('rnOpen defaults to the Library project context; setters keep the shape; only known targets and modes', () => {
  const { self } = rig({ prFor: 'p1' });
  self.rnOpen('prompt:a');
  assert.deepEqual(self.state.run, { id: 'prompt:a', projectId: 'p1', vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null });
  self.rnSetVar('file', 'a.js'); self.rnSetProject('p2'); self.rnSetTarget('terminal'); self.rnSetMode('edits');
  assert.deepEqual([self.state.run.vars, self.state.run.projectId, self.state.run.target, self.state.run.mode], [{ file: 'a.js' }, 'p2', 'terminal', 'edits']);
  self.rnSetTarget('https://evil.example'); self.rnSetMode('bypassPermissions'); self.rnSetVar('__proto__', 'x');
  assert.equal(self.state.run.target, 'terminal'); assert.equal(self.state.run.mode, 'edits');
  assert.equal(Object.keys(self.state.run.vars).length, 1);
  assert.deepEqual(RUN_TARGET_IDS, ['chat', 'terminal', 'claude.ai', 'chatgpt']);
  self.rnClose(); assert.equal(self.state.run, null);
});

test('rnGo sends only ids, target, vars (and mode for chat); a chat run opens its turn in Claude › Chats', async () => {
  const { self, calls, toasts, went } = rig({ run: (req) => ({ ok: true, target: 'chat', title: 'T', turnId: 'ct-9', usage: 'recorded' }) });
  self.rnOpen('prompt:a', 'p1'); self.rnSetVar('file', 'a.js');
  await self.rnGo();
  assert.deepEqual(calls, [['run', { promptId: 'prompt:a', target: 'chat', projectId: 'p1', vars: { file: 'a.js' }, mode: 'read-only' }]]);
  assert.equal(self.state.run, null, 'the modal closes on a started chat');
  assert.equal(self.state.ccTurn, 'ct-9'); assert.equal(self.state.ccOpen, true); assert.equal(self.state.ccProj, 'p1');
  assert.deepEqual(went, [['claude', 'chats']], 'a started chat run shows Claude › Chats, where its turn streams');
  assert.ok(toasts.some(([k, t]) => k === 'success' && /uses your Claude quota/.test(t)));
  const c = rig(); c.self.rnOpen('prompt:a'); c.self.rnSetTarget('claude.ai');
  await c.self.rnGo();
  assert.deepEqual(c.calls[0][1], { promptId: 'prompt:a', target: 'claude.ai', vars: {} }, 'no mode, no projectId when none is picked');
  assert.equal(c.self.state.run.phase, 'done'); assert.equal(c.went.length, 0);
});

test('rnGo: errors keep the modal with the missing fields; read-only windows are refused; no double send', async () => {
  const e = rig({ run: () => ({ error: 'fill in {{file}}', missing: ['file'] }) });
  e.self.rnOpen('prompt:a', 'p1');
  await e.self.rnGo();
  assert.deepEqual([e.self.state.run.phase, e.self.state.run.error, e.self.state.run.missing], ['error', 'fill in {{file}}', ['file']]);
  const ro = rig({ canWrite: false }); ro.self.rnOpen('prompt:a', 'p1');
  await ro.self.rnGo();
  assert.deepEqual(ro.calls, []); assert.deepEqual(ro.toasts[0], ['denied', 'read-only window']);
  let release; const slow = rig({ run: () => new Promise((r) => { release = r; }) });
  slow.self.rnOpen('prompt:a', 'p1'); slow.self.rnSetTarget('chatgpt');
  const p = slow.self.rnGo(); slow.self.rnGo(); slow.self.rnClose();
  assert.equal(slow.calls.length, 1); assert.equal(slow.self.state.run.phase, 'running', 'cannot close while running');
  release({ ok: true, target: 'chatgpt', title: 'T', usage: 'recorded' }); await p;
  assert.equal(slow.self.state.run.phase, 'done');
});

test('packs: pick → plan → one confirm → done; cancel and errors; export toasts', async () => {
  const { self, calls, toasts } = rig();
  await self.rnPackImport('folder');
  assert.deepEqual(calls[0], ['import', { from: 'folder' }]); assert.equal(self.state.pack.phase, 'plan');
  await self.rnPackConfirm();
  assert.deepEqual(calls[1], ['import', { planId: 'pack-1' }]); assert.equal(self.state.pack.phase, 'done');
  self.rnPackCancel(); assert.equal(self.state.pack, null);
  const cx = rig({ pack: () => ({ canceled: true }) }); await cx.self.rnPackImport('zip'); assert.equal(cx.self.state.pack, null);
  const er = rig({ pack: () => ({ error: 'that ZIP is over 50 MB' }) }); await er.self.rnPackImport('zip');
  assert.deepEqual([er.self.state.pack.phase, er.self.state.pack.error], ['error', 'that ZIP is over 50 MB']);
  await self.rnPackExport(); assert.deepEqual(toasts.at(-1), ['success', 'Exported 2 prompt notes to x.zip']);
  const ex = rig({ exp: { error: 'No prompts folder yet — nothing to export' } }); await ex.self.rnPackExport();
  assert.deepEqual(ex.toasts.at(-1), ['error', 'Export pack · No prompts folder yet — nothing to export']);
  const ro = rig({ canWrite: false }); await ro.self.rnPackImport('zip'); await ro.self.rnPackExport();
  assert.deepEqual(ro.calls, []);
});
