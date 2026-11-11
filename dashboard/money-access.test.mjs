// The Money access switch, main side (dashboard/money-access.js): off on a fresh install, the one writer of access.json.
//   node --test dashboard/money-access.test.mjs
// Placeholder data only: the repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readAccess } from '../mcp/workspacehq/money-read.mjs';
import { record } from './assist-audit.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mod = require('./money-access.js');

const temp = () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-access-'));
  return { dataDir, file: path.join(dataDir, 'money', 'access.json'), done: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
};
const audit = (entries) => async () => ({ entries });
const T0 = new Date('2026-11-10T09:00:00.000Z');
const clock = (d = T0) => { let t = d.getTime(); return () => new Date(t++); };

test('a fresh install is off, never asked, and writes nothing', async () => {
  const t = temp();
  try {
    const m = mod.create({ dataDir: t.dataDir, auditRead: audit([]) });
    assert.deepEqual(await m.read(), { on: false, lastAskedAt: null });
    assert.equal(fs.existsSync(path.join(t.dataDir, 'money')), false);
    // turning it off when it is already off (no file) does not create one
    assert.deepEqual(await m.set(false), { on: false });
    assert.equal(fs.existsSync(t.file), false);
  } finally { t.done(); }
});

test('set(true) then read; the file is { v:1, on, at } and the MCP reader sees it; set(false) closes it again', async () => {
  const t = temp();
  try {
    const m = mod.create({ dataDir: t.dataDir, now: clock(), auditRead: audit([]) });
    assert.deepEqual(await m.set(true), { on: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')), { v: 1, on: true, at: '2026-11-10T09:00:00.000Z' });
    assert.deepEqual(await m.read(), { on: true, lastAskedAt: null });
    assert.deepEqual(readAccess(t.dataDir), { on: true });
    assert.deepEqual(await m.set(false), { on: false });
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).on, false);
    assert.deepEqual(readAccess(t.dataDir), { on: false });
    assert.deepEqual(fs.readdirSync(path.dirname(t.file)), ['access.json']);   // no tmp file left
  } finally { t.done(); }
});

test('setting what it already is changes nothing (the at stamp is the last real change)', async () => {
  const t = temp();
  try {
    const m = mod.create({ dataDir: t.dataDir, now: clock(), auditRead: audit([]) });
    await m.set(true);
    const first = fs.readFileSync(t.file, 'utf8');
    await m.set(true);
    assert.equal(fs.readFileSync(t.file, 'utf8'), first);
  } finally { t.done(); }
});

test('anything but a strict boolean is refused before any IO', async () => {
  const t = temp();
  try {
    const m = mod.create({ dataDir: t.dataDir, auditRead: audit([]) });
    for (const bad of ['true', 'on', 1, 0, null, undefined, {}, [], [true], { on: true }]) {
      const r = await m.set(bad);
      assert.ok(r.error && !('on' in r), String(bad));
    }
    assert.equal(fs.existsSync(path.join(t.dataDir, 'money')), false);
  } finally { t.done(); }
});

test('a corrupt access.json reads as off and is quarantined by this writer, never overwritten; the MCP reader leaves it alone', async () => {
  for (const raw of ['{ truncated', '[true]', '7', 'null', JSON.stringify({ v: 1, on: 'true' }), JSON.stringify({ v: 1 })]) {
    const t = temp();
    try {
      fs.mkdirSync(path.dirname(t.file), { recursive: true });
      fs.writeFileSync(t.file, raw);
      // the MCP reader: off, and the file is exactly as it was
      assert.deepEqual(readAccess(t.dataDir), { on: false });
      assert.equal(fs.readFileSync(t.file, 'utf8'), raw);
      assert.deepEqual(fs.readdirSync(path.dirname(t.file)), ['access.json']);
      // the writer's read: off, and now moved aside
      const m = mod.create({ dataDir: t.dataDir, auditRead: audit([]) });
      assert.deepEqual(await m.read(), { on: false, lastAskedAt: null });
      assert.equal(fs.existsSync(t.file), false, raw);
      assert.equal(fs.readFileSync(t.file + '.corrupt', 'utf8'), raw);
      // a second corrupt file never replaces the first quarantine
      fs.writeFileSync(t.file, '{ again');
      await m.read();
      assert.equal(fs.readFileSync(t.file + '.corrupt', 'utf8'), raw);
      assert.equal(fs.readFileSync(t.file + '.corrupt-2', 'utf8'), '{ again');
      // and the owner can still turn it on afterwards
      assert.deepEqual(await m.set(true), { on: true });
      assert.equal(readAccess(t.dataDir).on, true);
    } finally { t.done(); }
  }
});

test('set over a corrupt file quarantines it first, then writes a clean one', async () => {
  const t = temp();
  try {
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, 'garbage');
    const m = mod.create({ dataDir: t.dataDir, now: clock(), auditRead: audit([]) });
    assert.deepEqual(await m.set(true), { on: true });
    assert.equal(fs.readFileSync(t.file + '.corrupt', 'utf8'), 'garbage');
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).on, true);
  } finally { t.done(); }
});

test('lastAskedAt is the newest audit line for hq_money_today only', async () => {
  const t = temp();
  try {
    const lines = [
      { tool: 'hq_money_today', at: '2026-11-09T08:00:00.000Z' },
      { tool: 'hq_money_today', at: '2026-11-10T07:30:00.000Z' },
      { tool: 'hq_brief', at: '2026-11-10T08:59:00.000Z' },
      { tool: 'hq_money_today', at: '2026-11-08T23:00:00.000Z' },
      { tool: 'hq_money_today', at: 'not a time' },
      { tool: 'hq_money_today' },
      null, 'x',
    ];
    const m = mod.create({ dataDir: t.dataDir, auditRead: audit(lines) });
    assert.equal((await m.read()).lastAskedAt, '2026-11-10T07:30:00.000Z');
    assert.equal(mod.lastAsked([{ tool: 'hq_brief', at: '2026-11-10T08:59:00.000Z' }]), null);
    assert.equal(mod.lastAsked(undefined), null);
  } finally { t.done(); }
});

test('an unreadable audit log is "never", not a failure of the switch', async () => {
  const t = temp();
  try {
    const m = mod.create({ dataDir: t.dataDir, auditRead: async () => { throw new Error('boom'); } });
    assert.deepEqual(await m.read(), { on: false, lastAskedAt: null });
    const sync = mod.create({ dataDir: t.dataDir, auditRead: () => ({ entries: [{ tool: 'hq_money_today', at: '2026-11-10T07:30:00.000Z' }] }) });
    assert.equal((await sync.read()).lastAskedAt, '2026-11-10T07:30:00.000Z');   // a plain (non-promise) reader works too
  } finally { t.done(); }
});

test('the default reader is the shared audit log: names and time only', async () => {
  const t = temp();
  try {
    record(t.dataDir, { tool: 'hq_money_today', tier: 'read', door: 'mcp', ok: true, at: '2026-11-10T06:00:00.000Z' });
    record(t.dataDir, { tool: 'hq_brief', tier: 'read', door: 'mcp', ok: true, at: '2026-11-10T08:00:00.000Z' });
    const m = mod.create({ dataDir: t.dataDir });
    assert.equal((await m.read()).lastAskedAt, '2026-11-10T06:00:00.000Z');
  } finally { t.done(); }
});

test('a write that fails answers an error, keeps the old file and leaves no tmp file', async () => {
  const t = temp();
  try {
    const m0 = mod.create({ dataDir: t.dataDir, now: clock(), auditRead: audit([]) });
    await m0.set(true);
    const before = fs.readFileSync(t.file, 'utf8');
    const failing = { ...fs, renameSync: (a, b) => { if (String(b).endsWith('access.json')) throw new Error('disk full'); return fs.renameSync(a, b); } };
    const m = mod.create({ dataDir: t.dataDir, fsMod: failing, auditRead: audit([]) });
    const r = await m.set(false);
    assert.match(r.error, /not saved/);
    assert.equal(fs.readFileSync(t.file, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.dirname(t.file)), ['access.json']);
  } finally { t.done(); }
});

test('init registers exactly the two channels and passes the value through untouched', async () => {
  const t = temp();
  try {
    const handlers = {};
    const api = mod.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dataDir: t.dataDir, auditRead: audit([]) });
    assert.deepEqual(Object.keys(handlers).sort(), ['hq:money-access:read', 'hq:money-access:set']);
    assert.equal(typeof api.read, 'function');
    assert.ok((await handlers['hq:money-access:set']({}, 'true')).error);
    assert.deepEqual(await handlers['hq:money-access:set']({}, true), { on: true });
    assert.deepEqual(await handlers['hq:money-access:read']({}), { on: true, lastAskedAt: null });
  } finally { t.done(); }
});

test('only this module writes access.json: no other money or MCP source writes it', () => {
  const roots = [path.join(HERE, 'money.js'), path.join(HERE, '..', 'mcp', 'workspacehq', 'money-read.mjs')];
  for (const f of fs.readdirSync(path.join(HERE, 'money'))) if (/\.mjs$/.test(f) && !/\.test\./.test(f)) roots.push(path.join(HERE, 'money', f));
  for (const f of roots) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/access\.json|ACCESS_NAME/.test(src)) continue;
    const code = src.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /writeFile|renameSync|appendFile|unlinkSync|rmSync/, path.basename(f) + ' reads access.json but also writes');
  }
  // and this module is the one that does
  assert.match(fs.readFileSync(path.join(HERE, 'money-access.js'), 'utf8'), /writeFileSync/);
});
