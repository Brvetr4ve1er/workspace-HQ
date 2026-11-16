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
import { briefActLogic, VERB_MARKS, RULE_VERB } from './brief-act.js';
import { tasksLogic } from './tasks.js';
import { journalLogic } from './journal.js';
import { crewLogic } from './crew.js';
import { vaultDeskLogic } from './vault-desk.js';
import { VERBS } from '../../../dashboard/brief-act-core.mjs';

process.env.TZ = 'UTC';
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };
const useLogMain = createRequire(import.meta.url)('../../../dashboard/use-log.js');

function rig(o = {}) {
  const sent = [], calls = [], toasts = [];
  const mixins = Object.assign({}, useLogLogic, briefLogic, cosmosLogic, securityLogic, claudeVaultLogic, briefActLogic, tasksLogic, journalLogic);
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

test('Dismiss sets a row aside and sends no act mark; the open is still once per arrival', async () => {
  const { self, sent } = rig();
  self.useMark('brief-panel');
  self.useMark('brief-panel');
  assert.equal(sent.filter(([, a]) => a === 'open').length, 1, 'opens are deduped per arrival');
  for (const k of ['a:1', 'b:2', 'c:3']) assert.equal(await self.brfDismiss(k), true);
  assert.equal(acts(sent, 'brief-panel'), 0, 'a dismissed row is set aside, not an effect (batch 8)');
  assert.equal(sent.filter(([, a]) => a === 'open').length, 1, 'dismisses never disturb the open count');
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

test('the Brief row Go and Scan buttons send no act mark (viewing and scanning count nothing); a bad action marks nothing', () => {
  const { self, sent, calls } = rig();
  self.brfAct({ kind: 'go', tab: 'claude', sub: 'chats' });
  self.brfAct({ kind: 'go', tab: 'projects', projectId: 'p1' });
  self.brfAct({ kind: 'scan' });
  assert.equal(acts(sent, 'brief-panel'), 0, 'go and scan are not effects');
  assert.deepEqual(sent, [['brief-panel', 'open']], 'one plain open mark, deduped per arrival');
  assert.deepEqual(calls.map((c) => c[0]), ['go', 'openProject', 'scan']);
  for (const bad of [null, undefined, 'go', 7, { kind: 'nope' }, {}]) self.brfAct(bad);
  assert.equal(sent.length, 1, 'nothing extra for a refused action');
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
  const { self, sent } = batRig({ state: { vault: { id: 'c1', phase: 'ready', path: 'x.md', rel: 'x.md', draft: 'd', exists: false } } });
  await self.brfDismiss('a:1');
  await self.batRun({ key: 'quest-red:a:1', rule: 'quest-red' }, 'quest-done');
  self.brfAct({ kind: 'scan' });
  await self.cosFavorite('e1');
  await self.secTrashExport('plain-export.xml', 'Downloads');
  await self.saveVault();
  assert.deepEqual([...new Set(sent.map((s) => s[0]))].sort(), ['brief-act', 'brief-panel', 'claude-vault', 'cosmos', 'security-recycle']);
  for (const [surface, action] of sent) {
    assert.ok(useLogMain.SURFACES.includes(surface), surface);
    assert.ok(useLogMain.ACTIONS.includes(action), action);
  }
});

// ---- batch 8, counting fix: effect-only marks, the commit hand-over, task Done, anti-farming ----

const answer = (o) => (o.act || (async (key, verb) => (verb === 'commit' ? { ok: true, open: 'commit', projectId: 'p1' } : verb === 'open-folder' ? { ok: true } : { ok: true, acted: { verb, at: '2026-11-16T10:00:00.000Z' } })));
function batRig(o = {}) {
  const r = rig(o);
  if (r.self.hq) r.self.hq.brief = { act: answer(o) };
  r.self.openCommit = async (id) => r.calls.push(['openCommit', id]);
  return r;
}
const rowOf = (rule, n = 1) => ({ key: rule + ':sample:' + n, rule });

test('the renderer verb table matches main: VERB_MARKS is exactly VERBS[...].marks, and every offered verb exists', () => {
  assert.deepEqual(Object.keys(VERB_MARKS).sort(), Object.keys(VERBS).sort());
  for (const [verb, v] of Object.entries(VERBS)) assert.equal(VERB_MARKS[verb], v.marks, verb);
  for (const verb of Object.values(RULE_VERB)) assert.ok(Object.prototype.hasOwnProperty.call(VERBS, verb), verb);
});

test('an effect verb sends one (brief-act, act); Open its folder, which changes nothing, sends nothing', async () => {
  const { self, sent } = batRig();
  assert.equal(await self.batRun(rowOf('quest-red'), 'quest-done'), true);
  assert.deepEqual(sent, [['brief-act', 'act']]);
  assert.equal(await self.batRun(rowOf('session-waiting'), 'open-folder'), true);
  assert.deepEqual(sent, [['brief-act', 'act']], 'open-folder marks nothing');
});

test('Confirm balance is an effect: one act, sent only after main answers it', async () => {
  const { self, sent } = batRig();
  self.setState({ batBal: '120.50' });
  assert.equal(await self.batYes(rowOf('money-stale')), true);
  assert.deepEqual(sent, [['brief-act', 'act']]);
  const bad = batRig();
  bad.self.setState({ batBal: 'abc' });
  assert.equal(await bad.self.batYes(rowOf('money-stale')), false);
  assert.deepEqual(bad.sent, []);
});

test('Commit is a hand-over: one (brief-act, handover), never an act, and the overlay still opens', async () => {
  const { self, sent, calls } = batRig();
  assert.equal(await self.batRun(rowOf('dirty'), 'commit'), true);
  assert.deepEqual(sent, [['brief-act', 'handover']]);
  assert.deepEqual(calls, [['openCommit', 'p1']]);
});

test('a refused or failed verb marks nothing, and a mark that throws never blocks the verb', async () => {
  const refused = batRig({ act: async () => ({ error: 'that item is not on the brief any more.' }) });
  assert.equal(await refused.self.batRun(rowOf('quest-red'), 'quest-done'), false);
  const thrown = batRig({ act: async () => { throw new Error('boom'); } });
  assert.equal(await thrown.self.batRun(rowOf('quest-red'), 'quest-done'), false);
  assert.deepEqual([...refused.sent, ...thrown.sent], []);
  const throwing = batRig({ use: () => { throw new Error('bridge gone'); } });
  assert.equal(await throwing.self.batRun(rowOf('quest-red'), 'quest-done'), true);
  const noBridge = batRig({ noBridge: true });
  noBridge.self.hq = { brief: { act: answer({}) } };
  assert.equal(await noBridge.self.batRun(rowOf('quest-red'), 'quest-done'), true, 'no hq.use: the verb still runs');
});

test('anti-farming: one effect, one mark; the same click again inside a minute adds none; a different row or a later minute does', async () => {
  const realNow = Date.now;
  let t = 1e12;
  Date.now = () => t;
  try {
    const { self, sent } = batRig();
    await self.batRun(rowOf('quest-red', 1), 'quest-done');
    t += 5e3;
    await self.batRun(rowOf('quest-red', 1), 'quest-done');
    assert.equal(sent.length, 1, 'an identical click inside a minute adds nothing');
    await self.batRun(rowOf('quest-red', 2), 'quest-done');
    assert.equal(sent.length, 2, 'another row is another effect');
    t += 61e3;
    await self.batRun(rowOf('quest-red', 1), 'quest-done');
    assert.equal(sent.length, 3, 'after a minute the same row counts again');
    const none = rig({ noBridge: true });
    assert.equal(none.self.useActOnce('tasks-board', 'x'), false);
    none.self.hq = { use: () => ({ ok: true }) };
    assert.equal(none.self.useActOnce('tasks-board', 'x'), true, 'an unsent mark was not remembered');
  } finally { Date.now = realNow; }
});

test('a task Done sends one (tasks-board, act) only when the save took effect; Undo, a failure and an already-done answer send none', async () => {
  const mk = () => {
    const r = rig();
    r.self.M = { T0: [{ id: 'task-1', title: 'Sample task', xp: 10, proj: 'p1' }, { id: 'task-2', title: 'Other task', xp: 10, proj: 'p1' }], IDEAS: [] };
    r.self.canWrite = () => true;
    r.self.pt = () => ({ x: 0, y: 0 });
    r.pending = {};
    r.self._pending = r.pending;
    r.self.defer = (key, fn) => { r.pending[key] = { fn }; };
    r.self.call = async (f) => { try { const x = await f(); return x && x.error ? null : x; } catch { return null; } };
    r.self.hq.markQuestDone = () => (r.answer === undefined ? true : r.answer);
    r.self.hq.actedOn = () => {};
    r.self.state = { ...r.self.state, completed: [], recentDone: [], focus: null, toasts: [], xp: 0 };
    r.self.gainXp = () => {};
    return r;
  };
  const fxSaved = window.HQFx;
  window.HQFx = { sfx() {}, floatText() {}, asciiBurst() {}, event() {}, coinFly: () => new Promise(() => {}) };
  try {
    const a = mk();
    a.self.completeTask('task-1');
    assert.deepEqual(a.sent, [], 'nothing is marked while the write is still waiting (Undo can cancel it)');
    await a.pending['done:task-1'].fn();
    assert.deepEqual(a.sent, [['tasks-board', 'act']]);
    const b = mk();
    b.self.completeTask('task-2');
    delete b.pending['done:task-2'];   // what undoTask does to the waiting write
    assert.deepEqual(b.sent, []);
    // a write that fails or was already done is not an act
    for (const answer of [{ error: 'disk full' }, false, null]) {
      const c = mk();
      c.answer = answer;
      c.self.completeTask('task-1');
      await c.pending['done:task-1'].fn();
      assert.deepEqual(c.sent, [], 'no mark for an answer of ' + JSON.stringify(answer));
    }
    // the Journal's Done on an idea counts the same way
    const d = mk();
    d.self.doIdea({ id: 'idea-1', title: 'An idea', proj: 'p1', purge: false });
    await d.pending['done:idea-1'].fn();
    assert.deepEqual(d.sent, [['tasks-board', 'act']]);
    const e = mk();
    e.answer = { error: 'nope' };
    e.self.doIdea({ id: 'idea-2', title: 'An idea', proj: 'p1', purge: false });
    await e.pending['done:idea-2'].fn();
    assert.deepEqual(e.sent, []);
  } finally { window.HQFx = fxSaved; }
});

test('allowlist: every mark these paths send is exactly (surface, action), both on the main list, and no argument carries an id or a name', async () => {
  const calls = [];
  const { self } = batRig({ use: (...args) => { calls.push(args); return { ok: true }; } });
  await self.batRun({ key: 'quest-red:Alpha Note:1', rule: 'quest-red' }, 'quest-done');
  await self.batRun({ key: 'dirty:example-skill-name:1', rule: 'dirty' }, 'commit');
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.equal(args.length, 2, 'two arguments, nothing else');
    assert.ok(useLogMain.SURFACES.includes(args[0]) && useLogMain.ACTIONS.includes(args[1]));
    assert.equal(JSON.stringify(args).includes('Alpha') || JSON.stringify(args).includes('example-skill'), false);
  }
  // the Crew and Vault desk surfaces (later dishes) are held to the same shape: once on the allowlist, a skill or note name in the action slot is refused
  const main = useLogMain.create({ appLog: { event() {} } });
  for (const s of ['crew', 'crew-start', 'vault-desk', 'vault-desk-capture']) {
    if (useLogMain.SURFACES.includes(s)) assert.equal(typeof main.mark(s, 'example-skill-name').error, 'string', s);
  }
});

test('the Crew Start and the Vault desk capture send exactly (surface, action): a skill id and a note line with sentinel words never reach the mark', async () => {
  const SKILL = 'zzsentinel-skill', LINE = 'qqsentinel note line';
  const calls = [];
  const self = Object.assign(Object.create(Object.assign({}, useLogLogic, crewLogic, vaultDeskLogic)), {
    state: { tab: 'life', sub: { life: 'notes' }, route: null, crw: {}, vdk: {} },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    ps: () => 'live',
    toast() {},
    hq: {
      use: (...args) => { calls.push(args); return { ok: true }; },
      crew: { read: async () => ({}), start: async () => ({ ok: true }) },
      vaultDesk: { capture: async () => ({ ok: true }), read: async () => ({ state: 'ready', vaultName: 'Example Vault', text: '', recent: [] }) },
    },
  });
  assert.equal(await self.crwStart({ id: SKILL, name: SKILL, canStart: true }), true);
  assert.equal(await self.vdkCapture(LINE), true);
  const marks = calls.filter((a) => a[0] === 'crew-start' || a[0] === 'vault-desk-capture');
  assert.deepEqual(marks.map((a) => a.join('/')), ['crew-start/act', 'vault-desk-capture/act']);
  for (const args of calls) {
    assert.equal(args.length, 2, 'two arguments, nothing else');
    assert.ok(useLogMain.SURFACES.includes(args[0]) && useLogMain.ACTIONS.includes(args[1]), args.join('/'));
    assert.equal(JSON.stringify(args).includes('sentinel'), false, 'no id, name or line in a mark');
  }
  // a refused start or capture marks nothing
  const before = calls.length;
  self.hq.crew.start = async () => ({ error: 'no' });
  self.hq.vaultDesk.capture = async () => ({ error: 'no' });
  self._crwStarting = null;
  assert.equal(await self.crwStart({ id: SKILL, name: SKILL, canStart: true }), false);
  assert.equal(await self.vdkCapture(LINE), false);
  assert.equal(calls.length, before);
});
