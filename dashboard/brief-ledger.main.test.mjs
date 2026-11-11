// Brief ledger, main side (dashboard/brief-ledger.js): real files in a temp dir, a fake clock, placeholder rows only.
//   node --test dashboard/brief-ledger.main.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ledgerMod = require('./brief-ledger.js');
const T0 = Date.parse('2026-11-10T09:00:00Z');
const D = 24 * 60;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brief-ledger-'));
const row = (key, rule, source, severity = 'med', extra) => Object.assign({ key, rule, severity, text: 'Placeholder Project Zed ' + rule, why: 'Placeholder reason.', source, age: 'scan 1 h ago', action: { kind: 'scan' }, count: 0 }, extra || {});
const UNPUSHED = row('unpushed:proj-zed:3', 'unpushed', 'scan');
const LATE = row('money-late:bill-1:2026-11-09', 'money-late', 'money', 'high');
const CI = row('ci-red:repo-q:main', 'ci-red', 'github');
const SECRETS = row('secrets:proj-zed:2', 'secrets', 'scan', 'high');
const brief = (items, o = {}) => ({ v: 1, generatedAt: new Date(T0 + (o.min || 0) * 60e3).toISOString(), items, more: o.more || 0, overflow: o.overflow || [], standing: o.standing || [], errors: o.errors || [] });

// a ledger over a temp dir with a clock the test moves; `warm()` consumes the cold start with an empty brief
function make(dir = tmp()) {
  let min = 0;
  const L = ledgerMod.create({ dataDir: dir, now: () => new Date(T0 + min * 60e3) });
  const at = (m) => { min = m; return L; };
  const view = (items, o = {}) => brief(items, { ...o, min });
  return { L, dir, at, view, file: path.join(dir, 'brief-ledger.json'), json: () => JSON.parse(fs.readFileSync(path.join(dir, 'brief-ledger.json'), 'utf8')) };
}
async function warm(m, min = 0) { m.at(min); await m.L.observe(m.view([]), {}); }   // the cold start closes nothing and writes an empty ledger

test('create exposes the documented surface and registers exactly the two channels', () => {
  const L = ledgerMod.create({ dataDir: tmp() });
  assert.deepEqual(Object.keys(L).sort(), ['ack', 'files', 'load', 'observe', 'read', 'registerIpc']);
  const handlers = new Map();
  L.registerIpc({ handle: (ch, fn) => { assert.ok(!handlers.has(ch), ch + ' twice'); handlers.set(ch, fn); } }, () => null);
  assert.deepEqual([...handlers.keys()].sort(), ['hq:brief-history:ack', 'hq:brief-history:read']);
});

test('atomic save: the file appears whole, no .tmp is left, and it holds refs only', async () => {
  const m = make();
  await warm(m);
  m.at(1);
  assert.deepEqual(await m.L.observe(m.view([UNPUSHED, LATE]), {}), { ok: true, opened: 2, closed: [] });
  m.at(2 * D);
  await m.L.observe(m.view([LATE]), {});
  assert.deepEqual(fs.readdirSync(m.dir).filter((f) => f.endsWith('.tmp')), []);
  const text = fs.readFileSync(m.file, 'utf8');
  const j = JSON.parse(text);
  assert.equal(j.v, 1);
  assert.equal(j.closed.length, 1);
  assert.equal(j.closed[0].how, 'resolved');
  for (const bad of ['proj-zed', 'Zed', 'Placeholder', 'bill-1', 'unpushed:', 'why']) assert.ok(!text.includes(bad), 'the file leaks ' + bad);
  for (const ref of Object.keys(j.open)) assert.match(ref, /^[0-9a-f]{12}$/);
});

test('an unchanged ledger is not rewritten, a changed one is', async () => {
  const m = make();
  await warm(m);
  const before = fs.statSync(m.file).mtimeMs;
  m.at(0);
  await m.L.observe(m.view([]), {});
  assert.equal(fs.statSync(m.file).mtimeMs, before);
  m.at(5);
  await m.L.observe(m.view([UNPUSHED]), {});
  assert.deepEqual(Object.values(m.json().open).map((e) => e.rule), ['unpushed']);
});

test('a new instance on the same folder starts cold: the first computation closes nothing, the second decides', async () => {
  const a = make();
  await warm(a);
  a.at(1); await a.L.observe(a.view([UNPUSHED]), {});
  const b = make(a.dir);                       // the app restarted
  b.at(10);
  const first = await b.L.observe(b.view([]), {});
  assert.deepEqual(first.closed, []);
  assert.equal(Object.keys(b.json().open).length, 1, 'still open after the cold start');
  b.at(25);
  const second = await b.L.observe(b.view([]), {});
  assert.deepEqual(second.closed, [{ rule: 'unpushed', how: 'resolved' }]);
});

test('a corrupt file is moved aside, never emptied silently: the bytes survive and the notice says so', async () => {
  const dir = tmp();
  const bad = '{ "v": 1, "open": {oops';
  fs.writeFileSync(path.join(dir, 'brief-ledger.json'), bad);
  const m = make(dir);
  m.at(0);
  const r = await m.L.observe(m.view([UNPUSHED]), {});
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'brief-ledger.json.corrupt'), 'utf8'), bad);
  const read = await m.L.read(m.view([UNPUSHED]));
  assert.match(read.notice, /set aside as brief-ledger\.json\.corrupt/);
  assert.equal(m.json().v, 1, 'a fresh, valid file was started');
  // a second corrupt file does not overwrite the first copy
  fs.writeFileSync(path.join(dir, 'brief-ledger.json'), 'not json again');
  const m2 = make(dir);
  await m2.L.observe(m2.view([]), {});
  assert.equal(fs.readFileSync(path.join(dir, 'brief-ledger.json.corrupt'), 'utf8'), bad);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('brief-ledger.json.corrupt')).length, 2);
});

test('a file from a different version is set aside too, and a JSON array or null is corrupt', async () => {
  for (const body of ['{"v":2,"open":{}}', '[]', 'null', '']) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'brief-ledger.json'), body);
    const m = make(dir);
    await m.L.observe(m.view([]), {});
    assert.ok(fs.existsSync(path.join(dir, 'brief-ledger.json.corrupt')), JSON.stringify(body));
    assert.equal(fs.readFileSync(path.join(dir, 'brief-ledger.json.corrupt'), 'utf8'), body);
  }
});

test('a write that fails keeps the ledger for the session and says so in notice', async () => {
  const dir = tmp();
  const m = make(dir);
  await warm(m);
  fs.rmSync(dir, { recursive: true, force: true });        // the folder vanishes: every write now fails
  m.at(1);
  const r = await m.L.observe(m.view([UNPUSHED]), {});
  assert.equal(r.ok, true, 'observe never throws at its caller');
  const read = await m.L.read(m.view([UNPUSHED]));
  assert.match(read.notice, /could not be saved/);
  assert.equal(read.entries.length, 1, 'the entry is still served from memory');
});

test('read: nothing yet is honest, an entry shows its words, and no brief means no card', async () => {
  const m = make();
  const none = await m.L.read(null);
  assert.deepEqual(none, { entries: [], clearedThisWeek: 0, dismissedThisWeek: 0, allClear: null, notice: '' });
  await warm(m);
  m.at(0); await m.L.observe(m.view([UNPUSHED]), {});
  m.at(2 * D); await m.L.observe(m.view([]), {});
  const r = await m.L.read(m.view([]));
  assert.deepEqual(r.entries.map((e) => [e.text, e.how, e.after]), [['Work not pushed', 'resolved', '2 d']]);
  assert.equal(r.clearedThisWeek, 1);
});

test('the all-clear shows once, and only after a real resolve', async () => {
  const m = make();
  await warm(m);
  m.at(1); await m.L.observe(m.view([UNPUSHED]), {});
  m.at(2 * D); await m.L.observe(m.view([]), {});
  const clear = m.view([]);
  const r1 = await m.L.read(clear);
  assert.equal(r1.allClear.resolved.length, 1);
  assert.equal(r1.allClear.resolved[0].text, 'Work not pushed');
  assert.equal(m.json().lastClearShownAt, null, 'reading is not showing: no write');
  assert.deepEqual(await m.L.ack(clear), { ok: true, acked: true });
  assert.equal(m.json().lastClearShownAt, new Date(T0 + 2 * D * 60e3).toISOString());
  assert.equal((await m.L.read(clear)).allClear, null, 'never repeats');
  assert.deepEqual(await m.L.ack(clear), { ok: true, acked: false }, 'a second ack records nothing');
  m.at(2 * D + 60);
  assert.equal((await m.L.read(m.view([]))).allClear, null, 'still gone an hour later');
  // the Brief has something again and clears by a resolve: a new episode, a new card
  m.at(3 * D); await m.L.observe(m.view([CI]), {});
  m.at(4 * D); await m.L.observe(m.view([]), {});
  const r2 = await m.L.read(m.view([]));
  assert.deepEqual(r2.allClear.resolved.map((x) => x.text), ['CI failing on a repo']);
});

test('the ack survives a restart', async () => {
  const a = make();
  await warm(a);
  a.at(1); await a.L.observe(a.view([UNPUSHED]), {});
  a.at(60); await a.L.observe(a.view([]), {});
  await a.L.ack(a.view([]));
  const b = make(a.dir);
  b.at(70);
  assert.equal((await b.L.read(b.view([]))).allClear, null);
});

test('no card without a real resolve: a first-ever empty brief, a silent close, a change, a dismissal', async () => {
  const fresh = make();
  await warm(fresh);
  assert.equal((await fresh.L.read(fresh.view([]))).allClear, null, 'an empty brief with no history');

  const silent = make();
  await warm(silent);
  silent.at(1); await silent.L.observe(silent.view([UNPUSHED]), {});
  silent.at(60); await silent.L.observe(silent.view([], { errors: [{ source: 'scan', error: 'x' }] }), {});
  silent.at(75);
  assert.equal((await silent.L.read(silent.view([]))).allClear, null, 'a close with its source erroring');
  assert.equal((await silent.L.read(silent.view([])) ).entries[0].how, 'silent');

  const changed = make();
  await warm(changed);
  changed.at(1); await changed.L.observe(changed.view([row('unpushed:proj-zed:3', 'unpushed', 'scan')]), {});
  changed.at(30); await changed.L.observe(changed.view([row('unpushed:proj-zed:5', 'unpushed', 'scan')]), {});
  changed.at(60); await changed.L.observe(changed.view([], { errors: [] }), { dismissedKeys: ['unpushed:proj-zed:5'] });
  assert.equal((await changed.L.read(changed.view([]))).allClear, null, 'a change then a dismissal');
  assert.equal((await changed.L.read(changed.view([]))).dismissedThisWeek, 1);
  assert.equal((await changed.L.read(changed.view([]))).clearedThisWeek, 0);
});

test('no card while standing rows, hidden rows, source errors or a stale brief are present', async () => {
  const m = make();
  await warm(m);
  m.at(1); await m.L.observe(m.view([UNPUSHED]), {});
  m.at(60); await m.L.observe(m.view([]), {});
  assert.ok((await m.L.read(m.view([]))).allClear, 'baseline: the card is due');
  assert.equal((await m.L.read(m.view([], { standing: [{ ...SECRETS, since: new Date(T0).toISOString() }] }))).allClear, null, 'standing rows');
  assert.equal((await m.L.read(m.view([], { more: 4 }))).allClear, null, 'hidden rows');
  assert.equal((await m.L.read(m.view([], { errors: [{ source: 'money', error: 'x' }] }))).allClear, null, 'a source error');
  assert.equal((await m.L.read(m.view([UNPUSHED]))).allClear, null, 'an item');
  m.at(60 + 45);
  assert.equal((await m.L.read(brief([], { min: 60 }))).allClear, null, 'a 45-minute-old brief is stale');
  assert.equal((await m.L.read(null)).allClear, null, 'no brief computed yet');
});

test('an ack when no card is due records nothing (the renderer cannot forge a shown card)', async () => {
  const m = make();
  await warm(m);
  const before = fs.readFileSync(m.file, 'utf8');
  assert.deepEqual(await m.L.ack(m.view([])), { ok: true, acked: false });
  assert.deepEqual(await m.L.ack(null), { ok: true, acked: false });
  assert.equal(fs.readFileSync(m.file, 'utf8'), before);
});

test('the IPC handlers answer from the live brief and never throw', async () => {
  const m = make();
  await warm(m);
  m.at(1); await m.L.observe(m.view([UNPUSHED]), {});
  m.at(60); await m.L.observe(m.view([]), {});
  let live = m.view([]);
  const handlers = new Map();
  m.L.registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, () => live);
  const r = await handlers.get('hq:brief-history:read')({});
  assert.equal(r.allClear.resolved.length, 1);
  live = m.view([UNPUSHED]);                                   // the brief got an item between the read and the ack
  assert.deepEqual(await handlers.get('hq:brief-history:ack')({}), { ok: true, acked: false });
  live = m.view([]);
  assert.deepEqual(await handlers.get('hq:brief-history:ack')({}), { ok: true, acked: true });
  const thrower = make();
  thrower.L.registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, () => { throw new Error('boom'); });
  const r2 = await handlers.get('hq:brief-history:read')({});
  assert.equal(r2.allClear, null);
});

test('observe never throws at the caller, even on junk', async () => {
  const m = make();
  for (const junk of [null, undefined, 42, 'x', { items: 'no' }]) {
    const r = await m.L.observe(junk, null);
    assert.equal(r.ok, true);
  }
});
