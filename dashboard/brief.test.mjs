// Operator Brief, main side (dashboard/brief.js): gathers the inputs, writes data/brief.json, serves hq:brief:*.
// Temp dirs and fakes only (money, hub, live-state, notifier); placeholder data — the repo is public.
//   node --test dashboard/brief.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const brief = require('./brief.js');
const NOW = new Date('2026-11-05T10:00:00Z');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brief-'));
const latest = (projects) => ({ scan: { date: '2026-11-05T08:00:00Z' }, projects, quests: [] });
const proj = (id, dirty) => ({ id, name: 'Project ' + id, metrics: { git_safety: { dirty, ahead: 0, unpushed: false }, risk_security: { secrets_found: 0 } } });
const fakes = (o = {}) => ({
  money: o.money === undefined ? { read: async () => ({ view: { hasAccounts: false, accounts: [], obligations: [] } }) } : o.money,
  hub: o.hub === undefined ? { request: async () => ({ webCount: 4, lastSyncAt: '2026-11-05T09:00:00Z' }) } : o.hub,
  liveState: o.liveState || { snapshot: () => ({ scan: { state: 'done', endedAt: '2026-11-05T08:00:00Z', code: 0 } }), onChange: () => () => {} },
});
function make(o = {}) {
  const dataDir = o.dataDir || tmp();
  if (o.latest !== null) fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(o.latest || latest([proj('a', 12)])));
  if (o.pc !== null) fs.writeFileSync(path.join(dataDir, 'pc-health.json'), JSON.stringify(o.pc || { scanned_at: '2026-11-05T09:30:00Z', organs: [] }));
  const b = brief.create({ dataDir, ...fakes(o), now: () => NOW });
  return { b, dataDir };
}

test('init registers exactly hq:brief:read and hq:brief:dismiss', () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => { assert.ok(!handlers.has(ch), ch + ' twice'); handlers.set(ch, fn); } };
  const api = brief.init({ ipcMain, dataDir: tmp(), ...fakes(), notify: () => {}, getWins: () => [], intervalMs: 0, watch: false });
  assert.deepEqual([...handlers.keys()].sort(), ['hq:brief:dismiss', 'hq:brief:read']);
  api.stop();
});

test('compute reads every source, writes brief.json, and the items come from the data', async () => {
  const { b, dataDir } = make();
  const { brief: out } = await b.compute();
  assert.deepEqual(out.items.map((i) => i.rule), ['dirty']);
  assert.deepEqual(out.errors, []);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'brief.json'), 'utf8'));
  assert.deepEqual(onDisk, out, 'the file is what was returned');
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.endsWith('.tmp')), [], 'atomic: no tmp left behind');
});

test('buildInputs survives absent files and a failing hub: the brief still computes and names each failed source', async () => {
  const { b } = make({ latest: null, pc: null, hub: { request: async () => { throw new Error('hub down'); } }, money: { read: async () => ({ error: 'disk on fire' }) } });
  const { brief: out } = await b.compute();
  assert.deepEqual(out.items, []);
  assert.deepEqual(out.errors.map((e) => e.source).sort(), ['claude', 'money', 'pc-health', 'scan']);
  assert.match(out.errors.find((e) => e.source === 'scan').error, /no scan yet/);
  const noHub = make({ hub: null });
  assert.match((await noHub.b.compute()).brief.errors.find((e) => e.source === 'claude').error, /not running/);
});

test('a corrupt latest.json is a named error, not a crash', async () => {
  const { b, dataDir } = make();
  fs.writeFileSync(path.join(dataDir, 'latest.json'), '{"scan":');
  const { brief: out } = await b.compute();
  assert.match(out.errors.find((e) => e.source === 'scan').error, /unreadable/);
});

test('dismiss(key) persists to brief-state.json and hides the item; unknown / malformed keys are a no-op', async () => {
  const { b, dataDir } = make();
  const key = (await b.compute()).brief.items[0].key;
  assert.deepEqual((await b.dismiss('dirty:zzz:1')).brief.items.map((i) => i.key), [key], 'unknown key: no-op');
  assert.deepEqual((await b.dismiss(42)).brief.items.map((i) => i.key), [key], 'not a string: no-op');
  assert.deepEqual((await b.dismiss('x'.repeat(201))).brief.items.map((i) => i.key), [key], 'too long: no-op');
  assert.deepEqual((await b.dismiss(key)).brief.items, [], 'dismissed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'brief-state.json'), 'utf8')).dismissed, [key]);
  const again = brief.create({ dataDir, ...fakes(), now: () => NOW });
  assert.deepEqual((await again.compute()).brief.items, [], 'survives a restart');
});

test('compute reports changed only when items, more or errors moved (generatedAt alone is not a change)', async () => {
  const { b, dataDir } = make();
  assert.equal((await b.compute()).changed, true, 'first compute');
  assert.equal((await b.compute()).changed, false, 'same facts');
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(latest([proj('a', 30)])));
  assert.equal((await b.compute()).changed, true, 'a fact moved');
});

test('init pushes hq:brief to every window only when the brief changed', async () => {
  const handlers = new Map(), sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(latest([proj('a', 12)])));
  const api = brief.init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, dataDir, ...fakes(), notify: () => {}, getWins: () => [win], intervalMs: 0, watch: false, now: () => NOW });
  await handlers.get('hq:brief:read')();
  await handlers.get('hq:brief:read')();
  assert.equal(sent.filter(([c]) => c === 'hq:brief').length, 1, 'pushed once, not on the unchanged second read');
  api.stop();
});

// ---- P2 (plan Task 6): change-only toast — high only, once per key per 24 h, quiet 23:00–08:00 local ----
const secretsLatest = () => ({ scan: { date: '2026-11-05T08:00:00Z' }, projects: [{ id: 's', name: 'Project S', metrics: { git_safety: { dirty: 0, ahead: 0, unpushed: false }, risk_security: { secrets_found: 2 } } }], quests: [] });
function initWith({ latestJson, now }) {
  const handlers = new Map(), toasts = [];
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(latestJson));
  fs.writeFileSync(path.join(dataDir, 'pc-health.json'), JSON.stringify({ scanned_at: '2026-11-05T09:30:00Z', organs: [] }));
  const api = brief.init({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, dataDir, ...fakes(), notify: (title, body) => toasts.push([title, body]), getWins: () => [], intervalMs: 0, watch: false, now });
  return { read: () => handlers.get('hq:brief:read')(), toasts, api, dataDir };
}

test('a new high top item toasts once; recomputing with the same top does not toast again', async () => {
  const w = initWith({ latestJson: secretsLatest(), now: () => new Date(2026, 10, 5, 11, 0) });
  await w.read(); await w.read(); await w.read();
  assert.equal(w.toasts.length, 1, 'one toast, not three');
  assert.match(w.toasts[0][0], /urgent/);
  assert.match(w.toasts[0][1], /Project S has 2 secrets/);
  const st = JSON.parse(fs.readFileSync(path.join(w.dataDir, 'brief-state.json'), 'utf8'));
  assert.ok(st.toasted['secrets:s:2'], 'remembered, so a restart does not re-toast it');
  w.api.stop();
});

test('quiet hours: a new high item at 23:30 local does not toast', async () => {
  const w = initWith({ latestJson: secretsLatest(), now: () => new Date(2026, 10, 5, 23, 30) });
  await w.read();
  assert.equal(w.toasts.length, 0);
  w.api.stop();
});

test('a low-severity top item never toasts', async () => {
  const w = initWith({ latestJson: latest([proj('a', 12)]), now: () => new Date(2026, 10, 5, 11, 0) });
  await w.read();
  assert.equal(w.toasts.length, 0, 'dirty files are "when you can", not a notification');
  w.api.stop();
});
