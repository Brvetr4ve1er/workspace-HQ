// Main side of the daily chat-index snapshot (batch 6). Fake hub, fake clock, real temp folders, the real pure rules.
//   node --test dashboard/hub-snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HS = require('./hub-snapshot.js');
const { init, dayOf, fileFor, WARMUP_MS, CHECK_MS, MAX_FAILURES_PER_DAY } = HS;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-hubsnap-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const T0 = new Date(2026, 0, 10, 9, 0, 0).getTime();   // local 09:00, far from midnight in any zone

// a fake Hub: health answers `h`; snapshot writes a small file at dest unless told to fail
function fakeHub(over = {}) {
  const calls = [];
  const hub = {
    calls, health: { state: 'ready', backfill: { done: 0, total: 0 } }, snapshot: 'ok',
    async request(op, args, o) {
      calls.push({ op, args, o });
      if (op === 'health') { if (hub.healthThrows) throw new Error('boom'); return hub.health; }
      if (op === 'snapshot') {
        if (hub.snapshot === 'ok') { fs.mkdirSync(path.dirname(args.dest), { recursive: true }); fs.writeFileSync(args.dest, 'placeholder snapshot'); return { ok: true, bytes: 20, ms: 3, counts: {} }; }
        return { error: hub.snapshot };
      }
      return { error: 'unknown op' };
    },
    ...over,
  };
  return hub;
}

function rig(extra = {}) {
  const dir = tmp(), repo = path.join(dir, 'repo'), snaps = path.join(dir, 'snaps');
  fs.mkdirSync(repo, { recursive: true });
  const clock = { t: T0 }, events = [];
  const hub = extra.hub || fakeHub();
  const appLog = { event: (name, fields) => { events.push({ name, fields }); return true; } };
  const api = init({ hub, appLog, repoRoot: repo, env: { HQ_HUB_SNAPSHOT_DIR: snaps, ...(extra.env || {}) }, now: () => clock.t, schedule: false, ...(extra.opts || {}) });
  return { dir, repo, snaps, clock, events, hub, api, done: () => rm(dir) };
}
const snapEvents = (r) => r.events.filter((e) => e.name === 'hub-snapshot');

test('not in the first 5 minutes after start; then a snapshot is taken', async () => {
  const r = rig();
  try {
    assert.deepEqual(await r.api.tick(), { skipped: 'warm-up' });
    r.clock.t = T0 + WARMUP_MS - 1;
    assert.deepEqual(await r.api.tick(), { skipped: 'warm-up' });
    assert.equal(r.hub.calls.length, 0);   // the Hub was not even asked
    r.clock.t = T0 + WARMUP_MS;
    const res = await r.api.tick();
    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(path.join(r.snaps, fileFor(dayOf(r.clock.t)))));
    const call = r.hub.calls.find((c) => c.op === 'snapshot');
    assert.equal(call.o.timeout, 120000);
    assert.equal(path.basename(call.args.dest), 'hub-2026-01-10.sqlite');
  } finally { r.done(); }
});

test('not while health is "indexing", not while a backfill is in progress, not when health errors or throws', async () => {
  const r = rig();
  try {
    r.clock.t = T0 + 10 * MIN;
    r.hub.health = { state: 'indexing', backfill: { done: 0, total: 0 } };
    assert.deepEqual(await r.api.tick(), { skipped: 'hub-not-ready' });
    r.hub.health = { state: 'ready', backfill: { done: 40, total: 100 } };
    assert.deepEqual(await r.api.tick(), { skipped: 'backfill' });
    r.hub.health = { error: 'hub not running' };
    assert.deepEqual(await r.api.tick(), { skipped: 'hub-not-ready' });
    r.hub.health = { state: 'ready' }; r.hub.healthThrows = true;
    assert.deepEqual(await r.api.tick(), { skipped: 'hub-not-ready' });
    assert.equal(r.hub.calls.some((c) => c.op === 'snapshot'), false);
    assert.equal(snapEvents(r).length, 0);   // an idle-gate skip is not a failure and is not logged
    r.hub.healthThrows = false; r.hub.health = { state: 'ready', backfill: { done: 100, total: 100 } };   // a finished backfill is not "in progress"
    assert.equal((await r.api.tick()).ok, true);
  } finally { r.done(); }
});

test('one snapshot per calendar day; a new day takes the next', async () => {
  const r = rig();
  try {
    r.clock.t = T0 + 10 * MIN;
    assert.equal((await r.api.tick()).ok, true);
    r.clock.t += CHECK_MS;
    assert.deepEqual(await r.api.tick(), { skipped: 'done-today' });
    r.clock.t += 6 * 60 * MIN;
    assert.deepEqual(await r.api.tick(), { skipped: 'done-today' });
    assert.equal(r.hub.calls.filter((c) => c.op === 'snapshot').length, 1);
    r.clock.t = T0 + DAY + 10 * MIN;
    assert.equal((await r.api.tick()).ok, true);
    assert.deepEqual(fs.readdirSync(r.snaps).sort(), ['hub-2026-01-10.sqlite', 'hub-2026-01-11.sqlite']);
    assert.equal(snapEvents(r).length, 2);
  } finally { r.done(); }
});

test('the 8th day deletes the oldest; only older hub-YYYY-MM-DD.sqlite names go, nothing else is touched', async () => {
  const r = rig();
  try {
    fs.mkdirSync(r.snaps, { recursive: true });
    for (const n of ['notes.txt', 'hub-latest.sqlite', 'hub-2026-01-10.sqlite.tmp-1-a', 'other-2025-01-01.sqlite']) fs.writeFileSync(path.join(r.snaps, n), 'x');
    for (let d = 0; d < 8; d++) {
      r.clock.t = T0 + d * DAY + 10 * MIN;
      assert.equal((await r.api.tick()).ok, true, 'day ' + d);
    }
    const names = fs.readdirSync(r.snaps).sort();
    const hubs = names.filter((n) => /^hub-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n));
    assert.deepEqual(hubs, ['hub-2026-01-11.sqlite', 'hub-2026-01-12.sqlite', 'hub-2026-01-13.sqlite', 'hub-2026-01-14.sqlite', 'hub-2026-01-15.sqlite', 'hub-2026-01-16.sqlite', 'hub-2026-01-17.sqlite']);
    for (const n of ['notes.txt', 'hub-latest.sqlite', 'hub-2026-01-10.sqlite.tmp-1-a', 'other-2025-01-01.sqlite']) assert.ok(names.includes(n), n + ' must be untouched');
    assert.equal(snapEvents(r).at(-1).fields.kept, 7);
  } finally { r.done(); }
});

test('a hub error, a timeout and a refused destination each write one ok:false line, no throw, nothing else', async () => {
  for (const [hubErr, code] of [['boom: C:/Users/placeholder/secret/path.sqlite', 'hub-error'], ['timeout', 'timeout'], ['hub not running', 'hub-down'], ['snapshot refused: destination is inside the repo', 'refused'], ['snapshot did not verify: planted', 'verify-failed']]) {
    const r = rig();
    try {
      r.hub.snapshot = hubErr;
      r.clock.t = T0 + 10 * MIN;
      const res = await r.api.tick();   // resolves, never throws
      assert.deepEqual(res, { ok: false, reason: code });
      const lines = snapEvents(r);
      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0].fields, { ok: false, reason: code });
      assert.equal(r.events.length, 1);   // no other day-log line
      assert.equal(JSON.stringify(lines[0]).includes('placeholder'), false);
      assert.equal(fs.existsSync(path.join(r.snaps, 'hub-2026-01-10.sqlite')), false);
    } finally { r.done(); }
  }
});

test('a dest that the main-side rules refuse (a snapshot folder inside the repo) never reaches the Hub', async () => {
  const dir = tmp(), repo = path.join(dir, 'repo');
  try {
    fs.mkdirSync(repo, { recursive: true });
    const events = [], hub = fakeHub(), clock = { t: T0 };
    const api = init({ hub, appLog: { event: (n, f) => events.push({ n, f }) }, repoRoot: repo, env: { HQ_HUB_SNAPSHOT_DIR: path.join(repo, 'data', 'snaps') }, now: () => clock.t, schedule: false });
    clock.t = T0 + 10 * MIN;
    const res = await api.tick();
    assert.deepEqual(res, { ok: false, reason: 'refused' });
    assert.equal(hub.calls.some((c) => c.op === 'snapshot'), false);
    assert.equal(fs.existsSync(path.join(repo, 'data')), false);   // not even the folder was created
    assert.deepEqual(events.map((e) => e.f), [{ ok: false, reason: 'refused' }]);
    // a synced folder is refused the same way
    clock.t = T0;
    const api2 = init({ hub, appLog: { event: (n, f) => events.push({ n, f }) }, repoRoot: repo, env: { HQ_HUB_SNAPSHOT_DIR: path.join(dir, 'Dropbox', 'snaps') }, now: () => clock.t, schedule: false });
    clock.t = T0 + 10 * MIN;
    assert.equal((await api2.tick()).reason, 'refused');
  } finally { rm(dir); }
});

test('a failing day tries at most three times, then stops until tomorrow', async () => {
  const r = rig();
  try {
    r.hub.snapshot = 'timeout';
    r.clock.t = T0 + 10 * MIN;
    for (let i = 0; i < MAX_FAILURES_PER_DAY; i++) { assert.equal((await r.api.tick()).ok, false); r.clock.t += CHECK_MS; }
    assert.deepEqual(await r.api.tick(), { skipped: 'gave-up-today' });
    assert.equal(snapEvents(r).length, MAX_FAILURES_PER_DAY);
    r.hub.snapshot = 'ok'; r.clock.t = T0 + DAY + 10 * MIN;
    assert.equal((await r.api.tick()).ok, true);
  } finally { r.done(); }
});

test('the log line holds no path, on success or failure', async () => {
  const r = rig();
  try {
    r.clock.t = T0 + 10 * MIN;
    await r.api.tick();
    const line = JSON.stringify(snapEvents(r)[0]);
    assert.deepEqual(Object.keys(snapEvents(r)[0].fields).sort(), ['bytes', 'kept', 'ms', 'ok']);
    for (const bad of [r.snaps, r.dir, 'hub-2026', '.sqlite', os.tmpdir(), '\\', '/']) assert.equal(line.includes(bad), false, bad);
  } finally { r.done(); }
});

test('HQ_HUB_SNAPSHOT_DIR is honoured; the default is %LOCALAPPDATA%\\WorkspaceHQ\\hub-snapshots with a homedir fallback', () => {
  const r = rig();
  try { assert.equal(r.api.dir(), r.snaps); } finally { r.done(); }
  const a = init({ hub: fakeHub(), appLog: null, repoRoot: 'x', env: { LOCALAPPDATA: path.join(os.tmpdir(), 'LA') }, schedule: false });
  assert.equal(a.dir(), path.join(os.tmpdir(), 'LA', 'WorkspaceHQ', 'hub-snapshots'));
  const b = init({ hub: fakeHub(), appLog: null, repoRoot: 'x', env: {}, homedir: path.join(os.tmpdir(), 'home'), schedule: false });
  assert.equal(b.dir(), path.join(os.tmpdir(), 'home', 'AppData', 'Local', 'WorkspaceHQ', 'hub-snapshots'));
});

test('an overlapping tick is ignored; stop() ends it; a missing appLog or hub never throws', async () => {
  const r = rig();
  try {
    r.clock.t = T0 + 10 * MIN;
    const [a, b] = await Promise.all([r.api.tick(), r.api.tick()]);
    assert.deepEqual([a.ok, b.skipped], [true, 'busy']);
    r.api.stop();
    assert.deepEqual(await r.api.tick(), { skipped: 'busy' });
  } finally { r.done(); }
  const c2 = { t: T0 }, nl = tmp();
  const noLog = init({ hub: fakeHub({ snapshot: 'timeout' }), appLog: null, repoRoot: path.join(os.tmpdir(), 'r'), env: { HQ_HUB_SNAPSHOT_DIR: path.join(nl, 'snaps') }, now: () => c2.t, schedule: false });
  const noHub = init({ hub: null, appLog: null, repoRoot: 'x', env: {}, now: () => c2.t, schedule: false });
  c2.t = T0 + 10 * MIN;
  try { assert.equal((await noLog.tick()).ok, false); } finally { rm(nl); }
  assert.deepEqual(await noHub.tick(), { skipped: 'no-hub' });
});

test('scheduling: one warm-up timer then a 30 minute interval, both unref-ed; stop clears them', () => {
  const log = [];
  const timers = {
    setTimeout: (fn, ms) => { log.push(['timeout', ms]); fn(); return { unref() { log.push(['unref-t']); } }; },
    setInterval: (fn, ms) => { log.push(['interval', ms]); return { unref() { log.push(['unref-i']); } }; },
    clearTimeout: () => log.push(['clear-t']), clearInterval: () => log.push(['clear-i']),
  };
  const api = init({ hub: null, appLog: null, repoRoot: 'x', env: {}, timers });
  assert.deepEqual(log.filter((l) => l[0] === 'timeout' || l[0] === 'interval'), [['timeout', WARMUP_MS + 1000], ['interval', CHECK_MS]]);
  assert.equal(log.filter((l) => l[0].startsWith('unref')).length, 2);
  api.stop();
});
