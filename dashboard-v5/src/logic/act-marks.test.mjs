// Act marks (batch 6): one ('surface','act') hq.use mark per real click that took effect, never one per arrival; a refused or failed action marks
// nothing, and a mark that throws never blocks the action. Rig in the use-log.test.mjs style: a never-mounted object over the REAL mixins with a
// fake window.hq. Placeholder data only — the repo is public.
//   node --test dashboard-v5/src/logic/act-marks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { useLogLogic } from './use-log.js';
import { briefLogic } from './brief.js';
import { cosmosLogic } from './cosmos.js';
import { securityLogic } from './security.js';
import { claudeVaultLogic } from './claude-vault.js';

process.env.TZ = 'UTC';
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };
const useLogMain = createRequire(import.meta.url)('../../../dashboard/use-log.js');

function rig(o = {}) {
  const sent = [], calls = [], toasts = [];
  const mixins = Object.assign({}, useLogLogic, briefLogic, cosmosLogic, securityLogic, claudeVaultLogic);
  const self = Object.assign(Object.create(mixins), {
    state: { tab: 'home', route: null, sub: {}, brfBusy: false, cosLb: { id: 'e1' }, vault: null, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    hq: o.noBridge ? null : { use: o.use || ((s, a) => { sent.push([s, a]); return { ok: true }; }), claudeVault: { preview() {}, save: o.save || (async () => true) } },
    LIVE: { cosmos: { curation: { favorites: [], hidden: [] } } },
    store: {
      dismissBrief: async (key) => { calls.push(['dismiss', key]); return o.dismiss ? o.dismiss(key) : { brief: { items: [] } }; },
      trashSecurityExport: async (n, d) => { calls.push(['trash', n, d]); return o.trash ? o.trash() : { ok: true }; },
    },
    go: (tab, sub) => calls.push(['go', tab, sub]),
    openProject: (id) => calls.push(['openProject', id]),
    scanNow: () => calls.push(['scan']),
    cosApply: async (m) => { calls.push(['cosApply', m.type]); return o.cosOk === undefined ? true : o.cosOk; },
    cosOrder: () => ['e1', 'e2'],
    canWrite: () => true,
  });
  return { self, sent, calls, toasts };
}

const acts = (sent, surface) => sent.filter(([s, a]) => s === surface && a === 'act').length;

test('three Dismiss clicks on one screen send three act marks; the open is still once per arrival', async () => {
  const { self, sent } = rig();
  self.useMark('brief-panel');
  self.useMark('brief-panel');
  assert.equal(sent.filter(([, a]) => a === 'open').length, 1, 'opens are deduped per arrival');
  for (const k of ['a:1', 'b:2', 'c:3']) assert.equal(await self.brfDismiss(k), true);
  assert.equal(acts(sent, 'brief-panel'), 3);
  assert.equal(sent.filter(([, a]) => a === 'open').length, 1, 'acts never disturb the open count');
});

test('an act is sent while the window is hidden too (a click means someone is there)', () => {
  const { self, sent } = rig();
  globalThis.document = { visibilityState: 'hidden', addEventListener() {} };
  try {
    assert.equal(self.useMark('cosmos', 'open'), false, 'a hidden open waits');
    assert.equal(self.useMark('cosmos', 'act'), true);
    assert.deepEqual(sent, [['cosmos', 'act']]);
  } finally { delete globalThis.document; }
});

test('the Brief row button marks (brief-panel, act) for go and scan; a bad action marks nothing', () => {
  const { self, sent, calls } = rig();
  self.brfAct({ kind: 'go', tab: 'claude', sub: 'chats' });
  self.brfAct({ kind: 'go', tab: 'projects', projectId: 'p1' });
  self.brfAct({ kind: 'scan' });
  assert.equal(acts(sent, 'brief-panel'), 3);
  assert.deepEqual(calls.map((c) => c[0]), ['go', 'openProject', 'scan']);
  for (const bad of [null, undefined, 'go', 7, { kind: 'nope' }, {}]) self.brfAct(bad);
  assert.equal(sent.length, 3, 'nothing extra for a refused action');
});

test('a Dismiss that fails or is refused marks nothing', async () => {
  const failed = rig({ dismiss: () => ({ error: 'disk full' }) });
  assert.equal(await failed.self.brfDismiss('a:1'), false);
  const thrown = rig({ dismiss: () => { throw new Error('boom'); } });
  assert.equal(await thrown.self.brfDismiss('a:1'), false);
  const busy = rig();
  busy.self._brfBusy = true;
  assert.equal(await busy.self.brfDismiss('a:1'), false);
  for (const r of [failed, thrown, busy]) assert.deepEqual(r.sent, []);
});

test('Cosmos favourite and hide each send one (cosmos, act); a failed one sends nothing', async () => {
  const { self, sent, calls } = rig();
  assert.equal(await self.cosFavorite('e1'), true);
  assert.equal(await self.cosHide('e2'), true);
  assert.equal(acts(sent, 'cosmos'), 2);
  assert.deepEqual(calls.map((c) => c.join(':')), ['cosApply:favorite', 'cosApply:hide']);
  const bad = rig({ cosOk: false });
  assert.equal(await bad.self.cosFavorite('e1'), false);
  assert.equal(await bad.self.cosHide('e1'), false);
  assert.deepEqual(bad.sent, []);
  const none = rig({ state: { cosLb: null } });
  assert.equal(await none.self.cosFavorite(), false, 'no element, no action');
  assert.deepEqual(none.sent, []);
});

test('the Security Recycle Bin click sends (security-recycle, act) only when the file moved', async () => {
  const ok = rig();
  await ok.self.secTrashExport('plain-export.xml', 'Downloads');
  assert.deepEqual(ok.sent, [['security-recycle', 'act']]);
  const failed = rig({ trash: () => ({ error: 'in use' }) });
  await failed.self.secTrashExport('plain-export.xml', 'Downloads');
  assert.deepEqual(failed.sent, []);
  assert.equal(failed.toasts[0][0], 'error');
});

test('Save to vault sends (claude-vault, act) on a saved note, not on a failed or asked-first one', async () => {
  const ready = { id: 'c1', phase: 'ready', path: 'x.md', rel: 'Claude/x.md', draft: '# note', exists: false };
  const saved = rig({ state: { vault: ready } });
  await saved.self.saveVault();
  assert.deepEqual(saved.sent, [['claude-vault', 'act']]);
  assert.equal(saved.self.state.vault.phase, 'saved');
  const failed = rig({ state: { vault: ready }, save: async () => ({ error: 'no folder' }) });
  await failed.self.saveVault();
  assert.deepEqual(failed.sent, []);
  const asks = rig({ state: { vault: { ...ready, exists: true } } });
  await asks.self.saveVault();
  assert.deepEqual(asks.sent, [], 'the Replace question is not an act');
  assert.equal(asks.self.state.vault.askReplace, true);
  await asks.self.saveVault(true);
  assert.deepEqual(asks.sent, [['claude-vault', 'act']]);
});

test('a mark that throws or rejects never blocks the action', async () => {
  const throwing = rig({ use: () => { throw new Error('bridge gone'); } });
  assert.equal(await throwing.self.brfDismiss('a:1'), true);
  assert.equal(await throwing.self.cosFavorite('e1'), true);
  throwing.self.brfAct({ kind: 'scan' });
  assert.ok(throwing.calls.some((c) => c[0] === 'scan'));
  const rejecting = rig({ use: () => Promise.reject(new Error('no')) });
  assert.equal(await rejecting.self.cosHide('e1'), true);
  const none = rig({ noBridge: true });
  assert.equal(await none.self.brfDismiss('a:1'), true, 'no hq.use: the action still runs');
  await none.self.secTrashExport('plain-export.xml', 'Downloads');
  assert.equal(none.toasts.at(-1)[0], 'success');
});

test('every surface these act marks send is on the main-side allowlist, and act is an allowed action', async () => {
  const { self, sent } = rig({ state: { vault: { id: 'c1', phase: 'ready', path: 'x.md', rel: 'x.md', draft: 'd', exists: false } } });
  await self.brfDismiss('a:1');
  self.brfAct({ kind: 'scan' });
  await self.cosFavorite('e1');
  await self.secTrashExport('plain-export.xml', 'Downloads');
  await self.saveVault();
  assert.deepEqual([...new Set(sent.map((s) => s[0]))].sort(), ['brief-panel', 'claude-vault', 'cosmos', 'security-recycle']);
  for (const [surface, action] of sent) {
    assert.ok(useLogMain.SURFACES.includes(surface), surface);
    assert.ok(useLogMain.ACTIONS.includes(action), action);
  }
});
