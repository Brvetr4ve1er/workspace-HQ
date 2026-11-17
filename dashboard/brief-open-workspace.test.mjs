// node --test dashboard/brief-open-workspace.test.mjs
// The Brief verb "Open workspace" (batch 10): main OFFERS it on a plain 'dirty' row and ACCEPTS it only while that project's dev command is allowed;
// the click is ONE call into the Launcher (its lock, its hourly limit, its result line, its single 'launcher-workspace' act mark).
// Fakes only: spawn, shell, dialog and the dev module are injected, so nothing opens and no window appears. Placeholder names only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { KEYS, VERBS, RULE_VERBS, SECONDARY, planAct, workspaceTarget } from './brief-act-core.mjs';

const require = createRequire(import.meta.url);
const briefAct = require('./brief-act.js');
const launcher = require('./launcher.js');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const dirtyItem = (id, over = {}) => ({ key: 'dirty:' + id + ':12', rule: 'dirty', severity: 'med', text: 'a project has 12 uncommitted files', why: 'w', source: 'scan', age: 'now', action: { kind: 'go', tab: 'projects', projectId: id }, count: 0, ...over });
const brief = (items) => ({ v: 1, generatedAt: new Date(NOW).toISOString(), items, more: 0, overflow: [], standing: [], errors: [] });

function rig(o = {}) {
  const calls = { open: [], useMark: [], appLog: [], onActed: 0, devState: [] };
  const cur = o.brief || brief([dirtyItem('proj-a')]);
  const scan = { projects: o.projects || [{ id: 'proj-a', name: 'Project A' }] };
  const states = o.states || { 'proj-a': 'allowed' };
  const a = briefAct.create({
    getBrief: async () => cur,
    sources: async () => ({ redQuests: [], staleAccounts: [], waitingSessions: [] }),
    latest: () => scan,
    devState: async (id) => { calls.devState.push(id); return states[id] || 'none'; },
    openWorkspace: o.openWorkspace || (async (id) => { calls.open.push(id); return { ok: true, steps: [], line: 'Dev server started. Terminal opened.' }; }),
    useMark: (s, x) => { calls.useMark.push([s, x]); return { ok: true }; },
    appLog: (l) => calls.appLog.push(l), onActed: () => { calls.onActed++; }, now: () => NOW,
  });
  return { a, calls, scan, states };
}
const ask = (key) => ({ key, verb: 'open-workspace' });

test('the table: Open workspace is a SECOND verb of dirty only, it marks nothing itself, and it is not outbound', () => {
  assert.equal(VERBS['open-workspace'].marks, false);
  assert.deepEqual(VERBS['open-workspace'].rules, ['dirty']);
  assert.deepEqual(RULE_VERBS.dirty, ['commit', 'open-workspace']);
  assert.deepEqual(RULE_VERBS['session-left-dirty'], ['commit']);
  assert.deepEqual(SECONDARY, { dirty: 'open-workspace' });
  assert.ok(Object.isFrozen(VERBS['open-workspace']) && Object.isFrozen(SECONDARY));
  assert.doesNotMatch(VERBS['open-workspace'].label, /push|publish|send|post|upload|deploy|delete|remove/i);
});

test('the id comes from the item action, never the key; a group row and a wrong action name no project', () => {
  assert.equal(workspaceTarget(dirtyItem('proj-a', { key: 'dirty:proj-zzz:1' })), 'proj-a');
  assert.equal(workspaceTarget(dirtyItem('proj-a', { group: { n: 3 } })), null);
  assert.equal(workspaceTarget(dirtyItem('proj-a', { action: { kind: 'go', tab: 'tasks' } })), null);
  assert.equal(workspaceTarget({ ...dirtyItem('proj-a'), rule: 'session-left-dirty' }), null);
  assert.equal(workspaceTarget(null), null);
});

test('planAct: allowed + project in the scan = a plan with the id; not allowed, gone, or a bad action = a refusal', () => {
  const b = brief([dirtyItem('proj-a')]);
  const ctx = (over) => ({ brief: b, sources: { projects: [{ id: 'proj-a' }] }, acted: {}, now: NOW, devAllowed: true, ...over });
  const key = 'dirty:proj-a:12';
  assert.deepEqual(planAct({ key, verb: 'open-workspace' }, ctx()).plan, { kind: 'open-workspace', projectId: 'proj-a' });
  assert.match(planAct({ key, verb: 'open-workspace' }, ctx({ devAllowed: false })).error, /not allowed right now/);
  assert.match(planAct({ key, verb: 'open-workspace' }, ctx({ devAllowed: undefined })).error, /not allowed right now/);
  assert.match(planAct({ key, verb: 'open-workspace' }, ctx({ sources: { projects: [{ id: 'other' }] } })).error, /no longer matches/);
  assert.match(planAct({ key, verb: 'open-workspace' }, ctx({ sources: null })).error, /no longer matches/);
  assert.match(planAct({ key, verb: 'open-workspace', value: 1 }, ctx()).error, /takes no value/);
  const q = { key: KEYS.questRed('wq:x'), rule: 'quest-red', severity: 'med', text: 't', why: 'w', source: 's', age: 'n', action: { kind: 'go', tab: 'tasks' }, count: 0 };
  assert.match(planAct({ key: q.key, verb: 'open-workspace' }, ctx({ brief: brief([q]) })).error, /not offered/);
});

test('click: exactly one Launcher call with the project id only, its line comes back, and this file writes no mark and no refresh', async () => {
  const r = rig();
  const out = await r.a.act(ask('dirty:proj-a:12'));
  assert.deepEqual(out, { ok: true, workspace: { ok: true, line: 'Dev server started. Terminal opened.' } });
  assert.deepEqual(r.calls.open, ['proj-a']);
  assert.deepEqual(r.calls.useMark, [], 'the Launcher writes the act; brief-act never does');
  assert.equal(r.calls.onActed, 0);
  assert.deepEqual(r.a._acted(), {}, 'nothing is marked acted: the verb changes no Brief fact');
  for (const l of r.calls.appLog) assert.doesNotMatch(l, /proj-|Project|2026/);
});

test('the project is the item action, not the key: a key naming another id still opens the action project', async () => {
  const r = rig({ brief: brief([dirtyItem('proj-a', { key: 'dirty:proj-zzz:9' })]) });
  assert.equal((await r.a.act(ask('dirty:proj-zzz:9'))).ok, true);
  assert.deepEqual(r.calls.open, ['proj-a']);
});

test('not allowed right now (unconfirmed, refused, none, a throwing state): nothing is opened', async () => {
  for (const st of ['unconfirmed', 'refused', 'none']) {
    const r = rig({ states: { 'proj-a': st } });
    const out = await r.a.act(ask('dirty:proj-a:12'));
    assert.match(out.error, /not allowed right now/, st);
    assert.deepEqual(r.calls.open, [], st);
  }
  const r2 = rig();
  const b = briefAct.create({ getBrief: async () => brief([dirtyItem('proj-a')]), latest: () => r2.scan, devState: async () => { throw new Error('x'); }, openWorkspace: async () => { throw new Error('must not run'); }, now: () => NOW });
  assert.match((await b.act(ask('dirty:proj-a:12'))).error, /not allowed right now/);
});

test('a stale or forged key, a project gone from the scan, and a group row are refused before the Launcher', async () => {
  const r = rig();
  assert.match((await r.a.act(ask('dirty:proj-a:99'))).error, /not on the brief any more/);
  assert.match((await r.a.act(ask('forged'))).error, /not on the brief any more/);
  const r2 = rig({ projects: [{ id: 'proj-q' }] });
  assert.match((await r2.a.act(ask('dirty:proj-a:12'))).error, /no longer matches/);
  const r3 = rig({ brief: brief([dirtyItem('proj-a', { group: { n: 2 } })]) });
  assert.match((await r3.a.act(ask('dirty:proj-a:12'))).error, /does not name a project/);
  const r4 = rig({ brief: brief([{ ...dirtyItem('proj-a'), rule: 'session-left-dirty', key: 'session-left-dirty:proj-a:1' }]) });
  assert.match((await r4.a.act(ask('session-left-dirty:proj-a:1'))).error, /not offered/);
  for (const x of [r, r2, r3, r4]) assert.deepEqual(x.calls.open, []);
});

test('a row that changes while the scan is read is refused (changed while reading)', async () => {
  const r = rig();
  let n = 0;
  const a = briefAct.create({ getBrief: async () => (++n <= 1 ? brief([dirtyItem('proj-a')]) : brief([])), latest: () => r.scan, devState: async () => 'allowed', openWorkspace: async () => { r.calls.open.push('x'); return { ok: true, line: '' }; }, now: () => NOW });
  assert.match((await a.act(ask('dirty:proj-a:12'))).error, /changed while you clicked/);
  assert.deepEqual(r.calls.open, []);
});

test('a double click is one Launcher call (the per-key guard)', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ openWorkspace: async (id) => { r.calls.open.push(id); await gate; return { ok: true, line: 'Opened.' }; } });
  const first = r.a.act(ask('dirty:proj-a:12'));
  await new Promise((res) => setTimeout(res, 20));
  const second = await r.a.act(ask('dirty:proj-a:12'));
  assert.match(second.error, /already working/);
  release();
  assert.equal((await first).ok, true);
  assert.deepEqual(r.calls.open, ['proj-a']);
});

test('the Launcher refusals come back in its fixed words, never a path: working, busy, failed, a throw, no seam', async () => {
  for (const [ans, re] of [[{ ok: false, steps: [], line: '', state: 'working' }, /Another launch is still running/], [{ ok: false, steps: [], line: '', state: 'busy' }, /Too many Open workspace clicks/], [{ ok: false, steps: [], line: '', state: 'refused' }, /did not work/], [null, /did not work/]]) {
    const r = rig({ openWorkspace: async () => ans });
    assert.match((await r.a.act(ask('dirty:proj-a:12'))).error, re);
    assert.deepEqual(r.calls.useMark, []);
  }
  const t = rig({ openWorkspace: async () => { throw new Error('C:\\secret\\folder'); } });
  const o = await t.a.act(ask('dirty:proj-a:12'));
  assert.match(o.error, /did not work/); assert.doesNotMatch(JSON.stringify(o), /secret/);
  const b = briefAct.create({ getBrief: async () => brief([dirtyItem('proj-a')]), latest: () => ({ projects: [{ id: 'proj-a' }] }), devState: async () => 'allowed', now: () => NOW });
  assert.match((await b.act(ask('dirty:proj-a:12'))).error, /did not work/);
});

test('a line the Launcher built from a failed step is passed on as not ok', async () => {
  const r = rig({ openWorkspace: async () => ({ ok: false, steps: [], line: 'The folder is not there.' }) });
  assert.deepEqual(await r.a.act(ask('dirty:proj-a:12')), { ok: true, workspace: { ok: false, line: 'The folder is not there.' } });
});

test('decorate OFFERS the verb only where the click would pass: plain dirty row, project in the scan, command allowed', async () => {
  const items = [dirtyItem('proj-a'), dirtyItem('proj-b'), dirtyItem('proj-c', { group: { n: 2 } }), dirtyItem('proj-d'), { ...dirtyItem('proj-a'), rule: 'session-left-dirty', key: 'session-left-dirty:proj-a:1' }];
  const r = rig({ projects: [{ id: 'proj-a' }, { id: 'proj-b' }, { id: 'proj-c' }], states: { 'proj-a': 'allowed', 'proj-b': 'unconfirmed', 'proj-c': 'allowed', 'proj-d': 'allowed' } });
  const out = await r.a.decorate({ ...brief(items), overflow: [dirtyItem('proj-a', { key: 'dirty:proj-a:13' })] });
  assert.deepEqual(out.items.map((i) => i.secondary || null), [['open-workspace'], null, null, null, null]);
  assert.deepEqual(out.overflow[0].secondary, ['open-workspace']);
  assert.equal('secondary' in items[0], false, 'the input brief is not mutated');
  const none = briefAct.create({ getBrief: async () => brief([]), now: () => NOW });
  assert.equal((await none.decorate(brief([dirtyItem('proj-a')]))).items[0].secondary, undefined, 'no dev module: nothing is offered');
});

test('the sender check belongs to this verb only: a foreign sender is refused before anything runs, other verbs keep their behaviour', async () => {
  const handlers = {};
  const r = rig();
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const seen = [];
  const gate = (e, getWin) => { seen.push(getWin()); return !!e && e.ok === true; };
  const win = { w: 1 };
  briefAct.init({ ipcMain, getWin: () => win, gate, getBrief: async () => brief([dirtyItem('proj-a')]), sources: async () => ({}), latest: () => r.scan, devState: async () => 'allowed', openWorkspace: async (id) => { r.calls.open.push(id); return { ok: true, line: 'x' }; }, openFolder: async () => ({ ok: true }), now: () => NOW });
  const foreign = await handlers['hq:brief:act']({ ok: false }, ask('dirty:proj-a:12'));
  assert.deepEqual(foreign, { error: 'not available here.' });
  assert.deepEqual(r.calls.open, []);
  assert.equal(seen[0], win);
  const mine = await handlers['hq:brief:act']({ ok: true }, ask('dirty:proj-a:12'));
  assert.equal(mine.ok, true);
  assert.deepEqual(r.calls.open, ['proj-a']);
  // commit from a "foreign" sender is NOT gated here (batch 10 adds no check to the other verbs)
  const commit = await handlers['hq:brief:act']({ ok: false }, { key: 'dirty:proj-a:12', verb: 'commit' });
  assert.equal(commit.open, 'commit');
});

// ---- through the REAL Launcher (fake spawn / shell / dev): one launch, one act mark, the same lock and hourly limit as the Settings button ----
function realLauncher(t, o = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brief-ws-')));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ } });
  const data = path.join(root, 'data'), proj = path.join(root, 'proj a'), local = path.join(root, 'local');
  for (const d of [data, proj, path.join(local, 'Microsoft', 'WindowsApps')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe'), '');
  const scan = { projects: [{ id: 'proj-a', name: 'Project A', path: proj, dev_cmd: 'npm run dev' }] };
  const spawns = [], marks = [], devCalls = [];
  const spawn = (file, args, options) => { const p = new EventEmitter(); p.unref = () => {}; spawns.push({ file, args, options }); return p; };
  const states = { v: o.devState || 'allowed' };
  const dev = { state: async () => states.v, start: async (id) => { devCalls.push(id); if (o.devHold) await o.devHold; return 'started'; } };
  const fakeCrypto = { encrypt: (s) => Buffer.from('sealed:' + s).toString('base64'), decrypt: (b) => { const x = Buffer.from(b, 'base64').toString(); return x.startsWith('sealed:') ? x.slice(7) : null; } };
  const l = launcher.create({ dataDir: data, documentsRoot: root, resolveProjectPath: (p) => p, latest: () => scan, dev, shell: { openPath: async () => '', openExternal: async () => {} }, dialog: {}, getWin: () => ({}), crypto: fakeCrypto,
    useMark: (s, a) => { marks.push([s, a]); return { ok: true }; }, audit: async () => {}, spawn, env: { LOCALAPPDATA: local, SystemRoot: 'C:\\Windows', Path: 'x' }, platform: 'win32', now: () => NOW, driveType: async () => 'Fixed' });
  const a = briefAct.create({ getBrief: async () => brief([dirtyItem('proj-a')]), sources: async () => ({}), latest: () => scan, devState: (id) => dev.state(id), openWorkspace: (id) => l.openWorkspace({ projectId: id }), useMark: (s, x) => { marks.push([s, x]); return { ok: true }; }, now: () => NOW });
  return { a, l, spawns, marks, devCalls, states };
}

test('real Launcher: one click = one dev start, one terminal start, ONE launcher-workspace act mark, and the row gets the Launcher own line', async (t) => {
  const r = realLauncher(t);
  const out = await r.a.act(ask('dirty:proj-a:12'));
  assert.equal(out.ok, true);
  assert.equal(out.workspace.ok, true);
  assert.match(out.workspace.line, /\S/);
  assert.deepEqual(r.devCalls, ['proj-a']);
  assert.equal(r.spawns.length, 1, 'the terminal only (no editor picked)');
  assert.deepEqual(r.marks, [['launcher-workspace', 'act']]);
});

test('real Launcher: the same lock (a launch in flight answers "working", nothing else starts) and the same hourly limit as the Settings button', async (t) => {
  let release; const hold = new Promise((res) => { release = res; });
  const r = realLauncher(t, { devHold: hold });
  const first = r.l.openWorkspace({ projectId: 'proj-a' });   // the Settings button own call, still running
  await new Promise((res) => setTimeout(res, 20));
  const out = await r.a.act(ask('dirty:proj-a:12'));
  assert.match(out.error, /Another launch is still running/);
  assert.equal(r.devCalls.length, 1);
  release(); await first;
  assert.equal(r.marks.filter((m) => m[0] === 'launcher-workspace').length, 1);
  // the hour allowance is shared: the Brief click and the Settings button draw from the same ten
  const r2 = realLauncher(t);
  for (let i = 0; i < launcher.LIMITS.workspace - 1; i++) assert.equal((await r2.l.openWorkspace({ projectId: 'proj-a' })).ok, true);
  assert.equal((await r2.a.act(ask('dirty:proj-a:12'))).ok, true, 'the tenth');
  assert.match((await r2.a.act(ask('dirty:proj-a:12'))).error, /Too many Open workspace clicks/);
});

test('real Launcher: a command that is no longer allowed is refused by the Brief verb before the Launcher runs (no spawn, no mark)', async (t) => {
  const r = realLauncher(t, { devState: 'unconfirmed' });
  assert.match((await r.a.act(ask('dirty:proj-a:12'))).error, /not allowed right now/);
  assert.equal(r.spawns.length, 0); assert.deepEqual(r.marks, []); assert.deepEqual(r.devCalls, []);
});
