// The app door, app side (dashboard/intent-inbox.js). Temp data dirs, a fake brief and fake dismissals; one test drives the real brief.js.
// Placeholder rows only — the repo is public.
//   node --test dashboard/intent-inbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refOf } from './brief-project.mjs';
import { record as recordAudit, read as readAudit, auditPath } from './assist-audit.mjs';
import * as C from './intent-core.mjs';

const require = createRequire(import.meta.url);
const { create } = require('./intent-inbox.js');
const realBrief = require('./brief.js');

const NOW = Date.parse('2026-11-11T10:00:00Z');
const MIN = 60e3;
const iso = (ms) => new Date(ms).toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-intent-'));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
const idOf = (n) => n.toString(16).padStart(32, '0');
const row = (key, rule = 'dirty', severity = 'low') => ({ key, rule, severity, text: 'Placeholder text ' + key, why: 'why', source: 'scan', age: 'live', action: null, count: 0 });
const KEY = 'dirty:alpha:12';

// a data dir with the mailbox folders, a fake brief and a counting dismissKey
function env(o = {}) {
  const dataDir = o.dataDir || tmp();
  const inbox = path.join(dataDir, 'intents', 'inbox'), answers = path.join(dataDir, 'intents', 'answers');
  fs.mkdirSync(inbox, { recursive: true }); fs.mkdirSync(answers, { recursive: true });
  const state = { brief: o.brief === undefined ? { items: [row(KEY), row('unpushed:beta:3', 'unpushed', 'med')], overflow: [row('ci-red:gamma:1', 'ci-red', 'med')], standing: [row('dirty:delta:40')] } : o.brief, dismissed: [], logs: [] };
  const dismissKey = o.dismissKey || (async (key) => {
    state.dismissed.push(key);
    state.brief = { ...state.brief, items: state.brief.items.filter((i) => i.key !== key) };
    return { changed: true };
  });
  const mk = (extra = {}) => create({ dataDir, getBrief: () => state.brief, dismissKey, now: () => NOW, pid: 4242, log: (l) => state.logs.push(l), ...extra });
  return { dataDir, inbox, answers, state, mk, door: mk(), put, answerOf, names: (d) => fs.readdirSync(d).sort() };
  function put(id, body, { mtime = NOW - 30e3, raw } = {}) {
    const file = path.join(inbox, C.inboxName(id));
    fs.writeFileSync(file, raw !== undefined ? raw : JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf(KEY), at: iso(NOW - 30e3), by: 'mcp', ...body }));
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  }
  function answerOf(id) { try { return JSON.parse(fs.readFileSync(path.join(answers, C.answerName(id)), 'utf8')); } catch { return null; } }
}
const withEnv = (fn, o) => async (t) => { const e = env(o); try { await fn(e, t); } finally { rm(e.dataDir); } };

test('a good request: claimed, applied, answered dismissed, audited, and the files are gone', withEnv(async (e) => {
  const id = idOf(1);
  e.put(id, {});
  const out = await e.door.sweep();
  assert.deepEqual([out.examined, out.applied, out.refused], [1, 1, 0]);
  assert.deepEqual(e.state.dismissed, [KEY]);
  assert.deepEqual(e.answerOf(id), { v: 1, ok: true, outcome: 'dismissed', at: iso(NOW) });
  assert.deepEqual(e.names(e.inbox), [], 'neither the request nor the .taken is left');
  const lines = readAudit(e.dataDir).entries;
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].tool, lines[0].door, lines[0].tier, lines[0].ok], ['intent.applied', 'mcp', 'note', true]);
}));

test('forged files are refused and never applied: bad id, oversize, stale, future, a directory, a symlink', withEnv(async (e, t) => {
  // a name that is not <32 hex>.json: ignored and counted, left where it is
  fs.writeFileSync(path.join(e.inbox, 'forged.json'), JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf(KEY), at: iso(NOW), by: 'mcp' }));
  fs.writeFileSync(path.join(e.inbox, 'ABCDEF' + idOf(2).slice(6) + '.json'), '{}');
  // oversize
  e.put(idOf(3), {}, { raw: JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf(KEY), at: iso(NOW), by: 'mcp', pad: 'x'.repeat(9000) }) });
  // stale by mtime, and stale by its own date
  e.put(idOf(4), {}, { mtime: NOW - 11 * MIN });
  e.put(idOf(5), { at: iso(NOW - 11 * MIN) }, { mtime: NOW - 11 * MIN });
  // from the future
  e.put(idOf(6), { at: iso(NOW + 5 * MIN) }, { mtime: NOW + 5 * MIN });
  // the file's date and its own `at` disagree (a replay with a fresh date inside)
  e.put(idOf(7), {}, { mtime: NOW - 8 * MIN });
  // a directory under a request's name
  fs.mkdirSync(path.join(e.inbox, C.inboxName(idOf(8))));
  // a symlink under a request's name (skipped where the OS will not let this account make one)
  let linked = false;
  const target = path.join(e.dataDir, 'target.json');
  fs.writeFileSync(target, JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf(KEY), at: iso(NOW - 30e3), by: 'mcp' }));
  try { fs.symlinkSync(target, path.join(e.inbox, C.inboxName(idOf(9)))); linked = true; } catch { t.diagnostic('symlinks are not allowed for this account: that part is skipped'); }

  const out = await e.door.sweep();
  assert.deepEqual(e.state.dismissed, [], 'nothing forged was ever applied');
  assert.equal(out.applied, 0);
  assert.equal(out.ignored, 2 + 1 + (linked ? 1 : 0), 'two foreign names, a directory and a symlink are ignored and counted');
  assert.equal(out.refused, 5);
  assert.ok(fs.existsSync(path.join(e.inbox, 'forged.json')), 'a foreign name is never touched');
  assert.ok(fs.statSync(path.join(e.inbox, C.inboxName(idOf(8)))).isDirectory(), 'a directory is never touched');
  if (linked) assert.ok(fs.lstatSync(path.join(e.inbox, C.inboxName(idOf(9)))).isSymbolicLink(), 'a symlink is never followed or removed');
  assert.equal(fs.existsSync(target), true);
  // the refused requests got their own answer, in words, and their files are gone
  for (const n of [3, 4, 5, 6, 7]) {
    const a = e.answerOf(idOf(n));
    assert.equal(a.ok, false, 'request ' + n);
    assert.equal(fs.existsSync(path.join(e.inbox, C.inboxName(idOf(n)))), false);
  }
  assert.equal(e.answerOf(idOf(3)).error, C.WORDS.tooBig);
  assert.equal(e.answerOf(idOf(4)).error, C.WORDS.stale);
  assert.equal(e.answerOf(idOf(6)).error, C.WORDS.future);
  assert.equal(e.answerOf(idOf(8)), null);
  assert.equal(readAudit(e.dataDir).entries.length, 0, 'a refusal is not an applied dismissal');
}));

test('at most 10 files are examined per pass; the rest wait for the next one', withEnv(async (e) => {
  for (let i = 1; i <= 12; i++) e.put(idOf(i), {}, { mtime: NOW - 30 * MIN });   // all stale: each is refused and removed
  const a = await e.door.sweep();
  assert.deepEqual([a.examined, a.refused, a.deferred], [10, 10, 2]);
  assert.equal(e.names(e.inbox).length, 2);
  const b = await e.door.sweep();
  assert.deepEqual([b.examined, b.refused, b.deferred], [2, 2, 0]);
  assert.equal(e.names(e.inbox).length, 0);
}));

test('two claimants race on one request: exactly one applies', withEnv(async (e) => {
  const id = idOf(1);
  e.put(id, {});
  const other = e.mk();
  const [x, y] = await Promise.all([e.door.sweep(), other.sweep()]);
  assert.equal(x.applied + y.applied, 1);
  assert.equal(e.state.dismissed.length, 1, 'the row was dismissed once');
  assert.equal(readAudit(e.dataDir).entries.length, 1);
  assert.equal(e.answerOf(id).ok, true);
}));

test('a claimant that loses the rename (ENOENT) does nothing at all', withEnv(async (e) => {
  const id = idOf(1);
  const file = e.put(id, {});
  // the first claimant's rename finds the file already taken by someone else: the real rename is done by the "other" party just before
  const stealing = { ...fs, renameSync: (a, b) => { if (a === file) fs.renameSync(a, path.join(e.inbox, C.takenName(id))); return fs.renameSync(a, b); } };
  const loser = e.mk({ fsImpl: stealing });
  const out = await loser.sweep();
  assert.deepEqual([out.applied, out.lost], [0, 1]);
  assert.deepEqual(e.state.dismissed, []);
  assert.equal(e.answerOf(id), null, 'the loser wrote no answer');
  assert.equal(fs.existsSync(path.join(e.inbox, C.takenName(id))), true, 'the winner\'s claim is untouched');
}));

test('a .taken found at start is never re-run: answered "may have run" and audited so', withEnv(async (e) => {
  const id = idOf(1), other = idOf(2);
  // a claimed request with a valid body, as a crash would leave it; and one that had already been answered
  fs.writeFileSync(path.join(e.inbox, C.takenName(id)), JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf(KEY), at: iso(NOW - 5e3), by: 'mcp' }));
  fs.writeFileSync(path.join(e.inbox, C.takenName(other)), '{}');
  fs.writeFileSync(path.join(e.answers, C.answerName(other)), JSON.stringify(C.answer(true, '', NOW)));
  await e.door.start({ watch: false, sweepMs: 0, heartbeatMs: 0 });
  try {
    assert.deepEqual(e.state.dismissed, [], 'never re-run');
    const a = e.answerOf(id);
    assert.equal(a.ok, false);
    assert.equal(a.error, 'interrupted, it may have run');
    assert.deepEqual(e.names(e.inbox), [], 'the leftovers are cleaned');
    assert.equal(e.answerOf(other).ok, true, 'an answered one keeps its answer');
    const lines = readAudit(e.dataDir).entries;
    assert.equal(lines.length, 1, 'only the unanswered one is audited');
    assert.deepEqual([lines[0].tool, lines[0].ok, lines[0].reason], ['intent.applied', false, 'may have run']);
    // and a later sweep never treats a .taken as a request
    fs.writeFileSync(path.join(e.inbox, C.takenName(idOf(3))), '{}');
    await e.door.sweep();
    assert.deepEqual(e.state.dismissed, []);
  } finally { e.door.stop(); }
}));

test('the answer is atomic: written to a temp name and renamed, never in place', withEnv(async (e) => {
  const writes = [], renames = [];
  const spy = { ...fs, writeFileSync: (f, ...r) => { writes.push(f); return fs.writeFileSync(f, ...r); }, renameSync: (a, b) => { renames.push([a, b]); return fs.renameSync(a, b); } };
  const door = e.mk({ fsImpl: spy });
  e.put(idOf(1), {});
  e.put(idOf(2), {}, { mtime: NOW - 30 * MIN });   // a refusal answers too
  await door.sweep();
  const answerWrites = writes.filter((f) => f.includes('.answer.json'));
  assert.equal(answerWrites.length, 2);
  for (const f of answerWrites) assert.ok(f.endsWith('.tmp'), 'written to a temp name: ' + path.basename(f));
  for (const f of answerWrites) assert.ok(renames.some(([a, b]) => a === f && b === f.replace(/\.[0-9a-f]{8}\.tmp$/, '')), 'then renamed into place');
  assert.deepEqual(e.names(e.answers), [C.answerName(idOf(1)), C.answerName(idOf(2))], 'no temp file is left behind');
}));

test('answers older than an hour are swept, with old temp files; fresh answers and foreign names stay', withEnv(async (e) => {
  const put = (name, mtime) => { const f = path.join(e.answers, name); fs.writeFileSync(f, '{}'); fs.utimesSync(f, mtime / 1000, mtime / 1000); };
  put(C.answerName(idOf(1)), NOW - 2 * 3600e3);
  put(C.answerName(idOf(2)), NOW - 5 * MIN);
  put(C.answerName(idOf(3)) + '.ab12cd34.tmp', NOW - 30 * MIN);
  put('notes.txt', NOW - 5 * 3600e3);
  await e.door.sweep();
  assert.deepEqual(e.names(e.answers), [C.answerName(idOf(2)), 'notes.txt'].sort());
}));

test('the heartbeat is written at start and removed at stop (only our own)', withEnv(async (e) => {
  const hb = path.join(e.dataDir, 'intents', 'app.json');
  assert.equal(fs.existsSync(hb), false);
  await e.door.start({ watch: false, sweepMs: 0, heartbeatMs: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(hb, 'utf8')), { v: 1, pid: 4242, at: iso(NOW) });
  assert.equal(C.heartbeat(fs.readFileSync(hb, 'utf8'), NOW + 5e3, (p) => p === 4242).open, true);
  e.door.stop();
  assert.equal(fs.existsSync(hb), false);
  // a heartbeat another app instance wrote is not ours to remove
  fs.writeFileSync(hb, JSON.stringify({ v: 1, pid: 777, at: iso(NOW) }));
  const second = e.mk({ pid: 4242 });
  second.stop();
  assert.equal(fs.existsSync(hb), true);
}));

test('the heartbeat repeats and the inbox is watched (timers and fs.watch)', withEnv(async (e) => {
  const hb = path.join(e.dataDir, 'intents', 'app.json');
  let clock = NOW;
  const door = e.mk({ now: () => clock });
  await door.start({ watch: true, sweepMs: 150, heartbeatMs: 100 });
  try {
    clock = NOW + 20e3;
    const deadline = Date.now() + 3000;
    let beat = '';
    while (Date.now() < deadline) { beat = JSON.parse(fs.readFileSync(hb, 'utf8')).at; if (beat === iso(NOW + 20e3)) break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(beat, iso(NOW + 20e3), 'the heartbeat was rewritten');
    e.put(idOf(1), { at: iso(NOW + 20e3 - 5e3) }, { mtime: NOW + 20e3 - 5e3 });
    while (Date.now() < deadline + 3000 && !e.answerOf(idOf(1))) await new Promise((r) => setTimeout(r, 50));
    assert.equal(e.answerOf(idOf(1)).ok, true, 'a dropped request is answered without anyone calling sweep');
  } finally { door.stop(); }
}));

test('a high item and a secrets item asked for from MCP are refused; the row stays', withEnv(async (e) => {
  e.state.brief = { items: [row('scan-failed:x', 'scan-failed', 'high'), row('secrets:alpha:2', 'secrets', 'high'), row(KEY)], overflow: [], standing: [] };
  e.put(idOf(1), { ref: refOf('scan-failed:x') });
  e.put(idOf(2), { ref: refOf('secrets:alpha:2') });
  const out = await e.door.sweep();
  assert.deepEqual([out.applied, out.refused], [0, 2]);
  assert.deepEqual(e.state.dismissed, []);
  for (const n of [1, 2]) assert.deepEqual([e.answerOf(idOf(n)).ok, e.answerOf(idOf(n)).error], [false, C.WORDS.urgent]);
  assert.equal(e.state.brief.items.length, 3);
}));

test('an overflow ref and a standing ref are refused and never answer dismissed', withEnv(async (e) => {
  e.put(idOf(1), { ref: refOf('ci-red:gamma:1') });
  e.put(idOf(2), { ref: refOf('dirty:delta:40') });
  e.put(idOf(3), { ref: refOf('dirty:nothing:0') });
  await e.door.sweep();
  assert.equal(e.answerOf(idOf(1)).error, C.WORDS.notTop);
  assert.equal(e.answerOf(idOf(2)).error, C.WORDS.standing);
  assert.equal(e.answerOf(idOf(3)).error, C.WORDS.movedOn);
  for (const n of [1, 2, 3]) { assert.equal(e.answerOf(idOf(n)).ok, false); assert.equal(e.answerOf(idOf(n)).outcome, undefined); }
  assert.deepEqual(e.state.dismissed, []);
}));

test('a dismissKey that reports changed:false answers ok:false, and a throwing one never answers ok', async () => {
  const cases = [['reports nothing changed', async () => ({ changed: false })], ['returns nothing', async () => undefined], ['a truthy but not strict true', async () => ({ changed: 'yes' })], ['throws', async () => { throw new Error('boom'); }]];
  for (const [label, fn] of cases) {
    const e = env({ dismissKey: fn });
    try {
      e.put(idOf(1), {});
      const out = await e.door.sweep();
      const a = e.answerOf(idOf(1));
      assert.equal(a.ok, false, label);
      assert.equal(out.applied, 0, label);
      assert.equal(readAudit(e.dataDir).entries.length, 0, label + ': nothing was applied, so nothing is audited as applied');
      assert.deepEqual(e.names(e.inbox), [], label + ': the claim is cleaned up');
      assert.equal(a.error, label === 'throws' ? C.WORDS.failed : C.WORDS.movedOn, label);
    } finally { rm(e.dataDir); }
  }
});

test('the cap: 10 applied an hour from the audit log; the 11th is refused', withEnv(async (e) => {
  e.state.brief = { items: Array.from({ length: 12 }, (_, i) => row('dirty:p' + i + ':1')), overflow: [], standing: [] };
  for (let i = 0; i < 12; i++) e.put(idOf(i + 1), { ref: refOf('dirty:p' + i + ':1') });
  const a = await e.door.sweep();
  assert.deepEqual([a.examined, a.applied, a.deferred], [10, 10, 2]);
  const b = await e.door.sweep();
  assert.deepEqual([b.applied, b.refused], [0, 2]);
  assert.equal(e.answerOf(idOf(11)).error, C.WORDS.cap);
  assert.equal(e.state.dismissed.length, 10);
  assert.equal(readAudit(e.dataDir).entries.length, 10);
  // an hour later the window has moved on
  const later = e.mk({ now: () => NOW + 61 * MIN });
  e.put(idOf(20), { ref: refOf('dirty:p11:1'), at: iso(NOW + 61 * MIN - 5e3) }, { mtime: NOW + 61 * MIN - 5e3 });
  const c = await later.sweep();
  assert.equal(c.applied, 1);
}));

test('the cap also counts lines already in the shared log (written by an earlier run)', withEnv(async (e) => {
  for (let i = 1; i <= 10; i++) recordAudit(e.dataDir, { at: NOW - i * MIN, door: 'mcp', tool: 'intent.applied', tier: 'note', ok: true, pid: 1 });
  e.put(idOf(1), {});
  await e.door.sweep();
  assert.equal(e.answerOf(idOf(1)).error, C.WORDS.cap);
  assert.deepEqual(e.state.dismissed, []);
}));

test('privacy: no ref, key, id or item text in the audit file, an answer file or an app-log line', withEnv(async (e) => {
  e.put(idOf(1), {});                                                // applied
  e.put(idOf(2), { ref: refOf('ci-red:gamma:1') });                  // refused: overflow
  e.put(idOf(3), {}, { mtime: NOW - 30 * MIN });                     // refused: stale
  fs.writeFileSync(path.join(e.inbox, C.takenName(idOf(4))), '{}');  // found claimed
  await e.door.recover();
  await e.door.sweep();
  const blob = [fs.readFileSync(auditPath(e.dataDir), 'utf8'), ...e.names(e.answers).map((n) => fs.readFileSync(path.join(e.answers, n), 'utf8')), e.state.logs.join('\n')].join('\n');
  for (const needle of [KEY, 'alpha', 'gamma', 'delta', 'Placeholder', refOf(KEY), refOf('ci-red:gamma:1'), idOf(1), idOf(2), idOf(3), idOf(4)]) assert.equal(blob.includes(needle), false, 'leaked: ' + needle);
  assert.ok(e.state.logs.length >= 3, 'the log lines exist, they just carry codes');
}));

test('an applied dismissal ends in brief.json without the item (the real brief)', async () => {
  const dataDir = tmp();
  try {
    fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify({ scan: { date: '2026-11-11T08:00:00Z' }, quests: [], projects: [
      { id: 'a', name: 'Project a', metrics: { git_safety: { dirty: 12, ahead: 0, unpushed: false }, risk_security: { secrets_found: 0 } } },
      { id: 'b', name: 'Project b', metrics: { git_safety: { dirty: 0, ahead: 0, unpushed: false }, risk_security: { secrets_found: 3 } } }] }));
    fs.writeFileSync(path.join(dataDir, 'pc-health.json'), JSON.stringify({ scanned_at: '2026-11-11T09:30:00Z', organs: [] }));
    const b = realBrief.create({ dataDir, money: { read: async () => ({ view: null }) }, hub: { request: async () => ({ webCount: 4, lastSyncAt: '2026-11-11T09:00:00Z' }) },
      liveState: { snapshot: () => ({ scan: { state: 'done', endedAt: '2026-11-11T08:00:00Z', code: 0 } }), onChange: () => () => {} }, now: () => new Date(NOW) });
    await b.compute();
    const items = b.current().items;
    const low = items.find((i) => i.severity !== 'high'), high = items.find((i) => i.severity === 'high');
    assert.ok(low && high, 'the fixture has a dismissable row and an urgent one: ' + JSON.stringify(items.map((i) => i.rule)));
    const inbox = path.join(dataDir, 'intents', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    const door = create({ dataDir, getBrief: () => b.current(), dismissKey: (k) => b.dismiss(k), now: () => NOW, pid: 1 });
    const put = (n, ref) => { const f = path.join(inbox, C.inboxName(idOf(n))); fs.writeFileSync(f, JSON.stringify({ v: 1, verb: 'brief.dismiss', ref, at: iso(NOW - 5e3), by: 'mcp' })); fs.utimesSync(f, (NOW - 5e3) / 1000, (NOW - 5e3) / 1000); };
    put(1, refOf(low.key));
    put(2, refOf(high.key));
    await door.sweep();
    const answer = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, 'intents', 'answers', C.answerName(idOf(n))), 'utf8'));
    assert.equal(answer(1).ok, true);
    assert.equal(answer(2).ok, false);
    const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'brief.json'), 'utf8'));
    const keys = written.items.concat(written.overflow || []).map((i) => i.key);
    assert.equal(keys.includes(low.key), false, 'the dismissed row is gone from data/brief.json');
    assert.equal(keys.includes(high.key), true, 'the urgent row stayed');
    // asking again for the same ref: the Brief moved on, and it is never reported as dismissed
    put(3, refOf(low.key));
    await door.sweep();
    assert.deepEqual([answer(3).ok, answer(3).error], [false, C.WORDS.movedOn]);
  } finally { rm(dataDir); }
});

test('no brief computed yet: refused in words, nothing applied', withEnv(async (e) => {
  e.state.brief = null;
  e.put(idOf(1), {});
  await e.door.sweep();
  assert.equal(e.answerOf(idOf(1)).error, C.WORDS.noBrief);
  assert.deepEqual(e.state.dismissed, []);
}));

test('an inbox that does not exist yet is not an error', async () => {
  const dataDir = tmp();
  try {
    const door = create({ dataDir, getBrief: () => null, dismissKey: async () => ({ changed: true }), now: () => NOW });
    assert.deepEqual(await door.sweep(), { examined: 0, applied: 0, refused: 0, ignored: 0, lost: 0, deferred: 0 });
    assert.equal(await door.recover(), 0);
  } finally { rm(dataDir); }
});

test('an old orphaned temp file in the inbox is swept; a fresh one (a door mid-write) is left', withEnv(async (e) => {
  const old = path.join(e.inbox, C.inboxName(idOf(1)) + '.tmp'), fresh = path.join(e.inbox, C.inboxName(idOf(2)) + '.tmp');
  fs.writeFileSync(old, '{'); fs.utimesSync(old, (NOW - 30 * MIN) / 1000, (NOW - 30 * MIN) / 1000);
  fs.writeFileSync(fresh, '{'); fs.utimesSync(fresh, (NOW - 5e3) / 1000, (NOW - 5e3) / 1000);
  await e.door.sweep();
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
}));
