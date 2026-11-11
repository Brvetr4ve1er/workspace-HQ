// hq_money_today's reader (mcp/workspacehq/money-read.mjs): off by default, words only, read-only, works with no app.
//   node --test mcp/workspacehq/money-read.test.mjs
// Placeholder data only: the repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMoneyToday, readAccess, REFUSAL } from './money-read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date(2026, 10, 10, 12, 0, 0);
const stamp = new Date(2026, 10, 1, 12).toISOString();
const PLANT = 'ZZ-Planted';

function rig(o = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-read-'));
  const dir = path.join(dataDir, 'money');
  fs.mkdirSync(dir, { recursive: true });
  const state = { v: 1, money: {
    accounts: [{ id: 'a1', name: PLANT + '-Account', currency: 'DA', anchorBalance: 9876543, anchorAt: stamp, archived: false, updatedAt: stamp }],
    obligations: [
      { id: 'b1', name: PLANT + '-Bill-1', amount: 12345, currency: 'DA', kind: 'bill', cadence: 'monthly', firstDue: '2026-11-02', accountId: null, installment: null, nextStep: '', archived: false, updatedAt: stamp },
      { id: 'b2', name: PLANT + '-Bill-2', amount: 12345, currency: 'DA', kind: 'bill', cadence: 'monthly', firstDue: '2026-11-20', accountId: null, installment: null, nextStep: '', archived: false, updatedAt: stamp },
    ],
    settings: { fxDaPerUsd: 137.25, paydayDay: 25 },
  }, transactions: [{ id: 't1', amountDA: 1234567, category: 'Food', date: '2026-11-08', note: PLANT + '-Note', accountId: 'a1' }], inbox: { candidates: [] } };
  if (o.state !== null) fs.writeFileSync(path.join(dir, 'state.json'), o.stateRaw != null ? o.stateRaw : JSON.stringify(state, null, 1));
  if (o.access !== undefined) fs.writeFileSync(path.join(dir, 'access.json'), typeof o.access === 'string' ? o.access : JSON.stringify(o.access));
  return { dataDir, dir, stateFile: path.join(dir, 'state.json'), done: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}
const listing = (dir) => fs.readdirSync(dir).sort();
const on = { v: 1, on: true, at: '2026-11-09T10:00:00.000Z' };

test('off by default: no access file, an unreadable one, the wrong type, on:false all answer the refusal', () => {
  const r = rig();   // no access.json at all
  try {
    const refused = (a) => { assert.deepEqual(a, { enabled: false, error: REFUSAL }); };
    refused(readMoneyToday({ dataDir: r.dataDir, now: NOW }));
    fs.writeFileSync(path.join(r.dir, 'access.json'), '{ not json');
    refused(readMoneyToday({ dataDir: r.dataDir, now: NOW }));
    fs.rmSync(path.join(r.dir, 'access.json'));
    fs.mkdirSync(path.join(r.dir, 'access.json'));   // a directory where the file should be: unreadable
    refused(readMoneyToday({ dataDir: r.dataDir, now: NOW }));
    fs.rmdirSync(path.join(r.dir, 'access.json'));
    for (const bad of [{ v: 1, on: 'true' }, { v: 1, on: false }, { v: 1, on: 1 }, { v: 1, on: 'on' }, { v: 1 }, [true], 'true', 7, null]) {
      fs.writeFileSync(path.join(r.dir, 'access.json'), JSON.stringify(bad));
      refused(readMoneyToday({ dataDir: r.dataDir, now: NOW }));
    }
    assert.equal(REFUSAL, 'Claude sessions may not read Money: the owner has not turned it on in Settings');
  } finally { r.done(); }
});

test('while off, state.json is not even opened', () => {
  const r = rig({ access: { v: 1, on: false } });
  try {
    const seen = [];
    const spy = { readFileSync: (f, ...a) => { seen.push(path.basename(String(f))); return fs.readFileSync(f, ...a); } };
    readMoneyToday({ dataDir: r.dataDir, now: NOW, fsMod: spy });
    assert.deepEqual(seen, ['access.json']);
  } finally { r.done(); }
});

test('on:true answers words, with the generated time and nothing like an amount', () => {
  const r = rig({ access: on });
  try {
    const a = readMoneyToday({ dataDir: r.dataDir, now: NOW });
    assert.deepEqual(a, { enabled: true, setUp: true, room: 'ok', roomWhy: null, daysToPayday: 15, billsLate: 1, billsDueSoon: 0, slipsWaiting: 0, generatedAt: NOW.toISOString() });
    const { generatedAt, ...rest } = a;
    const text = JSON.stringify(rest);
    assert.doesNotMatch(text, /\d{4,}|ZZ-Planted/);
    for (const n of ['9876543', '12345', '1234567', '137.25']) assert.ok(!text.includes(n), n);
  } finally { r.done(); }
});

test('a missing state.json is "not set up", not an error; a missing payday or rate says what is needed', () => {
  const none = rig({ access: on, state: null });
  const noFx = rig({ access: on, stateRaw: JSON.stringify({ money: { accounts: [{ id: 'a1', name: 'x', currency: 'DA', anchorBalance: 5, anchorAt: stamp, updatedAt: stamp }], settings: { paydayDay: 5 } } }) });
  fs.writeFileSync(path.join(noFx.dir, 'access.json'), JSON.stringify(on));
  try {
    const a = readMoneyToday({ dataDir: none.dataDir, now: NOW });
    assert.equal(a.enabled, true);
    assert.equal(a.setUp, false);
    assert.equal(a.room, 'unknown');
    const b = readMoneyToday({ dataDir: noFx.dataDir, now: NOW });
    assert.deepEqual([b.setUp, b.room, b.roomWhy], [true, 'unknown', 'needs a DA rate']);
  } finally { none.done(); noFx.done(); }
});

test('it never writes: state.json bytes and mtime are identical and no file appears', () => {
  const r = rig({ access: on });
  try {
    const before = { bytes: fs.readFileSync(r.stateFile), mtime: fs.statSync(r.stateFile).mtimeMs, files: listing(r.dir), accessBytes: fs.readFileSync(path.join(r.dir, 'access.json')) };
    for (let i = 0; i < 3; i++) readMoneyToday({ dataDir: r.dataDir, now: NOW });
    assert.ok(before.bytes.equals(fs.readFileSync(r.stateFile)));
    assert.equal(fs.statSync(r.stateFile).mtimeMs, before.mtime);
    assert.deepEqual(listing(r.dir), before.files);
    assert.ok(before.accessBytes.equals(fs.readFileSync(path.join(r.dir, 'access.json'))));
    assert.deepEqual(listing(r.dataDir), ['money']);
  } finally { r.done(); }
});

test('it needs nothing but readFileSync: an fs with only that one method works, any other call would throw', () => {
  const r = rig({ access: on });
  try {
    const only = { readFileSync: (...a) => fs.readFileSync(...a) };
    assert.equal(readMoneyToday({ dataDir: r.dataDir, now: NOW, fsMod: only }).setUp, true);
    assert.equal(readAccess(r.dataDir, only).on, true);
  } finally { r.done(); }
});

test('a corrupt state.json answers an error and is NOT quarantined or touched', () => {
  for (const raw of ['{ truncated', '[1,2,3]', '42', 'null', '""']) {
    const r = rig({ access: on, stateRaw: raw });
    try {
      const a = readMoneyToday({ dataDir: r.dataDir, now: NOW });
      assert.ok(typeof a.error === 'string' && /state\.json is unreadable/.test(a.error), raw);
      assert.equal('setUp' in a, false);
      assert.equal(fs.readFileSync(r.stateFile, 'utf8'), raw);
      assert.deepEqual(listing(r.dir), ['access.json', 'state.json']);
    } finally { r.done(); }
  }
});

test('an unreadable state.json (a directory in its place) answers an error, writes nothing', () => {
  const r = rig({ access: on, state: null });
  try {
    fs.mkdirSync(r.stateFile);
    const a = readMoneyToday({ dataDir: r.dataDir, now: NOW });
    assert.deepEqual(a, { error: 'data/money/state.json could not be read' });
    assert.deepEqual(listing(r.dir), ['access.json', 'state.json']);
  } finally { r.done(); }
});

test('it works with no app running: a plain node process answers from the two files alone', () => {
  const r = rig({ access: on });
  try {
    const mod = pathToFileURL(path.join(HERE, 'money-read.mjs')).href;
    const code = `import(${JSON.stringify(mod)}).then(m => console.log(JSON.stringify(m.readMoneyToday({ dataDir: ${JSON.stringify(r.dataDir)}, now: new Date(2026, 10, 10, 12) }))))`;
    const p = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    assert.equal(p.status, 0, p.stderr);
    const a = JSON.parse(p.stdout);
    assert.equal(a.enabled, true);
    assert.equal(a.room, 'ok');
  } finally { r.done(); }
});

test('the module source has no write call at all (a guard against a later edit adding one)', () => {
  const src = fs.readFileSync(path.join(HERE, 'money-read.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /writeFile|appendFile|rename|unlink|rmSync|rmdir|mkdir|copyFile|truncate|createWriteStream|\.open\(/);
});
