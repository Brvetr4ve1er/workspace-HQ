// Today ribbon, main side (dashboard/day-ribbon.js): a temp logs dir, a fake Hub, fake git and a temp data dir.
//   node --test dashboard/day-ribbon.test.mjs
// Pins: nothing is read at boot, bounded git (40 repos, 3 s, no shell, tracked project paths only), dayOffset 7 / -1 / 'x' refused,
// today.json written atomically and counts-only, an older Hub's unknown-op error becomes a lane note, no domain leaves the reader.
// Placeholder names only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ribbon = require('./day-ribbon.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = (s) => Date.parse(s);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-day-'));
const NOW = new Date('2026-11-10T15:00:00.000Z');   // 17:00 local at UTC+2: the local day is 2026-11-10 = 2026-11-09T22:00Z .. 2026-11-10T22:00Z
const TZ = () => 120;
const DAY_START = T('2026-11-09T22:00:00.000Z');

function rig(o = {}) {
  const dataDir = tmp(), logsDir = tmp();
  const calls = { hub: [], git: [] };
  let live = 0, maxLive = 0;
  const hub = o.hub === null ? null : { request: async (op, args, opts) => {
    calls.hub.push([op, args, opts]);
    if (o.hubImpl) return o.hubImpl(op, args, opts);
    return { fromMs: args.fromMs, toMs: args.toMs, bucketMin: 5, buckets: [
      { project_id: 'code:alpha', start_ms: DAY_START + 600 * 60000, messages: 3 }, { project_id: 'code:alpha', start_ms: DAY_START + 605 * 60000, messages: 1 },
      { project_id: 'code:beta', start_ms: DAY_START + 700 * 60000, messages: 2 } ] };
  } };
  const git = async (cwd, args, opts) => {
    calls.git.push([cwd, args, opts]); live++; maxLive = Math.max(maxLive, live);
    await new Promise((r) => setImmediate(r)); live--;
    if (o.gitImpl) return o.gitImpl(cwd, args, opts);
    return { ok: true, stdout: String(Math.floor(T('2026-11-10T10:00:00Z') / 1000)) + '\n' };
  };
  const clock = { t: NOW.getTime() };
  const r = ribbon.create({ dataDir, hub, logsDir: o.noLogs ? null : logsDir, projectsOf: o.projectsOf === undefined ? () => [path.join(os.tmpdir(), 'proj-a'), path.join(os.tmpdir(), 'proj-b')] : o.projectsOf,
    git, now: () => new Date(clock.t), tzOffsetOf: TZ, ...(o.extra || {}) });
  return { r, dataDir, logsDir, calls, clock, maxLive: () => maxLive };
}
const lane = (m, id) => m.lanes.find((l) => l.id === id);
const snap = (dir) => fs.readdirSync(dir).sort();

test('creating the ribbon, and starting its timer, reads and writes nothing', () => {
  const reads = [];
  const spy = new Proxy(fs, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { reads.push(k); return t[k](...a); } : t[k]) });
  const timers = [];
  const hubCalls = [], gitCalls = [];
  const dataDir = tmp();
  const r = ribbon.create({ dataDir, hub: { request: async () => { hubCalls.push(1); return {}; } }, logsDir: tmp(), projectsOf: () => { gitCalls.push('projects'); return []; },
    git: async () => { gitCalls.push('git'); return { error: 'x' }; }, now: () => NOW, tzOffsetOf: TZ, fsMod: spy,
    setIntervalFn: (fn, ms) => { timers.push([fn, ms]); return { unref() {} }; }, clearIntervalFn: () => {} });
  r.start();
  assert.deepEqual([reads, hubCalls, gitCalls, snap(dataDir)], [[], [], [], []]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 10 * 60 * 1000);
  r.dispose();
});

test('a full day: lanes from the Hub, the app log, the browser file and git, with the answer shaped for the renderer', async () => {
  const { r, dataDir, logsDir, calls } = rig();
  fs.writeFileSync(path.join(logsDir, 'app-2026-11-10.log'), [
    '{"ts":"2026-11-10T09:00:00.000+02:00","event":"start","pid":5}',
    '{"ts":"2026-11-10T09:15:00.000+02:00","event":"alive","pid":5}',
    '{"ts":"2026-11-10T09:30:00.000+02:00","event":"suspend","pid":5}',
    '{"ts":"2026-11-10T11:30:00.000+02:00","event":"resume","pid":5}',
    '{"ts":"2026-11-10T11:40:00.000+02:00","event":"alive","pid":5}',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dataDir, 'browser-activity.json'), JSON.stringify({ updated: 1, live: null, events: [
    { domain: 'secret.example', host: 'secret.example', url: 'https://secret.example/x', title: 'T', path: '/x', ts: T('2026-11-10T08:00:00Z'), focus_ms: 600000 }] }));
  const m = await r.read(0);
  assert.equal(m.ok, true);
  assert.equal(m.day, '2026-11-10');
  assert.equal(m.dayOffset, 0);
  assert.equal(m.generatedAt, NOW.toISOString());
  assert.equal(m.isToday, true);
  assert.equal(m.nowMin, 17 * 60);
  assert.deepEqual(calls.hub[0][0], 'activityBuckets');
  assert.deepEqual(calls.hub[0][1], { fromMs: DAY_START, toMs: DAY_START + 86400000, bucketMin: 5 });
  assert.deepEqual(m.counts, { claudeBlocks: 3, claudeProjects: 2, commits: 2, asleepMinutes: 120, browserMinutes: 10 });
  assert.equal(m.caption, '3 five-minute blocks with Claude across 2 projects, 2 commits, PC asleep 2 h');
  assert.deepEqual(m.lanes.map((l) => l.id), ['claude-1', 'claude-2', 'browser', 'power', 'commits']);
  assert.ok(!JSON.stringify(m).includes('secret') && !JSON.stringify(m).includes('example'), 'no domain reaches the answer');
});

test('dayOffset 7, -1, "x", 1.5 and nothing at all are refused and nothing is read; 0 and 6 are accepted', async () => {
  const { r, calls } = rig();
  for (const bad of [7, -1, 'x', 1.5, undefined, null, NaN, '3', {}]) { const a = await r.read(bad); assert.match(a.error, /whole number from 0 to 6/, String(bad)); }
  assert.deepEqual([calls.hub.length, calls.git.length], [0, 0]);
  assert.equal((await r.read(6)).ok, true);
  assert.equal((await r.read(0)).ok, true);
});

test('the IPC channel refuses anything that is not { dayOffset: integer 0..6 } and answers a value, never a throw', async () => {
  const handlers = new Map();
  const r = ribbon.init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, dataDir: tmp(), hub: null, logsDir: null, projectsOf: null, now: () => NOW, tzOffsetOf: TZ,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} });
  assert.deepEqual([...handlers.keys()], ['hq:today:read']);
  const h = handlers.get('hq:today:read');
  for (const bad of [undefined, null, 3, 'x', {}, { dayOffset: 'x' }, { dayOffset: 7 }, { dayOffset: -1 }, { dayOffset: 2.5 }]) assert.match((await h({}, bad)).error, /whole number from 0 to 6/, JSON.stringify(bad));
  const ok = await h({}, { dayOffset: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.day, '2026-11-09');
  r.dispose();
});

test('git is bounded: 40 repositories at most, tracked absolute paths only, no repeats, 3 s, %ct only, at most 4 at a time', async () => {
  const many = [];
  for (let i = 0; i < 45; i++) many.push(path.join(os.tmpdir(), 'proj-' + i));
  const { r, calls, maxLive } = rig({ projectsOf: () => [...many, many[0], path.join(os.tmpdir(), 'PROJ-1'), 'relative/path', '', 7, null, { path: 'x' }] });
  const m = await r.read(0);
  assert.equal(calls.git.length, 40);
  assert.equal(new Set(calls.git.map((c) => c[0])).size, 40);
  assert.deepEqual(calls.git.map((c) => c[0]), many.slice(0, 40).map((p) => path.resolve(p)));
  assert.ok(maxLive() <= 4 && maxLive() >= 1, 'concurrency ' + maxLive());
  const [, args, opts] = calls.git[0];
  assert.deepEqual(args, ['log', '--since=' + new Date(DAY_START).toISOString(), '--until=' + NOW.toISOString(), '--format=%ct', '--no-merges', '-n', '200']);
  assert.equal(opts.timeoutMs, 3000);
  assert.ok(args.every((a) => !/%s|%an|%ae|%b/.test(a)), 'no subject or author format');
  assert.equal(m.counts.commits, 40);
  assert.equal(ribbon.MAX_REPOS, 40);
  assert.equal(ribbon.GIT_TIMEOUT_MS, 3000);
  const src = fs.readFileSync(path.join(HERE, 'day-ribbon.js'), 'utf8');
  assert.match(src, /shell: false/);
  assert.match(src, /windowsHide: true/);
});

test('git failures and a full page of commits are said, not hidden; no tracked project is "unavailable", not zero', async () => {
  const { r } = rig({ gitImpl: (cwd) => (cwd.endsWith('proj-a') ? { error: 'git failed' } : { ok: true, stdout: Array.from({ length: 200 }, (_, i) => String(1789000000 + i)).join('\n') }) });
  const m = await r.read(0);
  assert.ok(m.notes.some((n) => /1 repository could not be read/.test(n)));
  assert.ok(m.notes.some((n) => /200-commit cap/.test(n)));
  const none = rig({ projectsOf: () => [] });
  assert.equal(lane(await none.r.read(0), 'commits').state, 'unavailable');
  assert.equal((await rig({ projectsOf: () => { throw new Error('boom'); } }).r.read(0)).counts.commits, null);
  assert.equal((await rig({ projectsOf: null }).r.read(0)).counts.commits, null);
  assert.deepEqual(none.calls.git, []);
});

test('an older Hub’s unknown-op error becomes a lane note, the other lanes still draw; so do a missing Hub and a Hub that throws', async () => {
  const old = rig({ hubImpl: () => { throw new Error('unknown op'); } });
  const m = await old.r.read(0);
  assert.equal(m.ok, true);
  assert.match(lane(m, 'claude').note, /update the Hub/);
  assert.equal(m.counts.claudeBlocks, null);
  assert.equal(lane(m, 'commits').state, 'ok');
  assert.match(lane(await rig({ hub: null }).r.read(0), 'claude').note, /not running/);
  assert.match(lane(await rig({ hubImpl: () => ({ error: 'the index is not open yet' }) }).r.read(0), 'claude').note, /index is not open/);
  assert.match(lane(await rig({ hubImpl: () => ({ nope: 1 }) }).r.read(0), 'claude').note, /shape/);
});

test('data/today.json: written atomically on a read of today, counts only, nothing for another day, a failed write does not fail the read', async () => {
  const renames = [];
  const wrapped = { ...fs, renameSync: (a, b) => { renames.push([path.basename(a), path.basename(b)]); return fs.renameSync(a, b); } };
  const { r, dataDir } = rig({ extra: { fsMod: wrapped } });
  await r.read(2);
  assert.ok(!snap(dataDir).includes('today.json'), 'a past day never writes it');
  await r.read(0);
  assert.deepEqual(snap(dataDir), ['today.json'], 'no .tmp left behind');
  assert.deepEqual(renames, [['today.json.' + process.pid + '.tmp', 'today.json']]);
  const doc = JSON.parse(fs.readFileSync(path.join(dataDir, 'today.json'), 'utf8'));
  assert.deepEqual(Object.keys(doc), ['v', 'day', 'generatedAt', 'counts']);
  assert.equal(doc.v, 1);
  assert.equal(doc.day, '2026-11-10');
  assert.equal(doc.generatedAt, NOW.toISOString());
  assert.deepEqual(Object.keys(doc.counts), ['claudeBlocks', 'claudeProjects', 'commits', 'asleepMinutes', 'browserMinutes']);
  for (const v of Object.values(doc.counts)) assert.ok(v === null || Number.isInteger(v));
  const text = fs.readFileSync(path.join(dataDir, 'today.json'), 'utf8');
  assert.ok(!/alpha|beta|proj|code:|example|\\\\/.test(text), 'no name, id or path in the file');
  const broken = rig({ extra: { fsMod: { ...fs, writeFileSync: () => { throw new Error('disk full'); } } } });
  assert.equal((await broken.r.read(0)).ok, true);
});

test('summary() computes today fresh, writes the file and returns counts only; the timer runs it every 10 minutes', async () => {
  const timers = [];
  const { r, dataDir, calls, clock } = rig({ extra: { setIntervalFn: (fn, ms) => { const t = { fn, ms, unref() { this.unrefd = true; } }; timers.push(t); return t; }, clearIntervalFn: (t) => { t.cleared = true; } } });
  const s = await r.summary();
  assert.deepEqual(Object.keys(s), ['day', 'generatedAt', 'counts']);
  assert.equal(s.counts.claudeBlocks, 3);
  assert.equal(calls.hub.length, 1);
  clock.t += 5000;
  await r.summary();
  assert.equal(calls.hub.length, 2, 'summary bypasses the 20 s cache');
  r.start(); r.start();
  assert.equal(timers.length, 1, 'a second start is a no-op');
  assert.equal(timers[0].ms, 600000);
  assert.equal(timers[0].unrefd, true);
  fs.rmSync(path.join(dataDir, 'today.json'));
  timers[0].fn();
  await new Promise((res) => setTimeout(res, 30));
  assert.ok(fs.existsSync(path.join(dataDir, 'today.json')), 'the timer wrote the file');
  r.dispose();
  assert.equal(timers[0].cleared, true);
});

test('reads are cached for 20 s per day, coalesced while one is in flight, and a new local day is a new key', async () => {
  const { r, calls, clock } = rig();
  await Promise.all([r.read(0), r.read(0), r.read(0)]);
  assert.equal(calls.hub.length, 1, 'three asks at once is one gather');
  await r.read(0);
  assert.equal(calls.hub.length, 1, 'inside the cache window');
  clock.t += 21000;
  await r.read(0);
  assert.equal(calls.hub.length, 2);
  await r.read(1);
  assert.equal(calls.hub.length, 3, 'another day is its own read');
  clock.t = T('2026-11-10T22:30:00Z');   // local 00:30 on the 11th: "today" is a new day
  const m = await r.read(0);
  assert.equal(m.day, '2026-11-11');
  assert.equal(calls.hub.length, 4);
});

test('power: the neighbouring days’ logs carry a sleep across midnight; a second launch’s lines and junk are ignored; no log is said', async () => {
  const { r, logsDir } = rig();
  fs.writeFileSync(path.join(logsDir, 'app-2026-11-09.log'), ['{"ts":"2026-11-09T23:00:00.000+02:00","event":"alive","pid":1}', '{"ts":"2026-11-09T23:30:00.000+02:00","event":"suspend","pid":1}', 'junk'].join('\n'));
  fs.writeFileSync(path.join(logsDir, 'app-2026-11-10.log'), ['{"ts":"2026-11-10T06:00:00.000+02:00","event":"resume","pid":1}', '{"ts":"2026-11-10T06:10:00.000+02:00","event":"start","pid":9,"secondary":true}',
    '{"ts":"2026-11-10T06:10:05.000+02:00","event":"quit","pid":9,"reason":"second-launch"}', '{"ts":"2026-11-10T06:10:00.000+02:00","event":"alive","pid":1}'].join('\n'));
  const m = await r.read(0);
  assert.equal(m.counts.asleepMinutes, 360, 'asleep from local midnight to 06:00');
  const none = await rig().r.read(0);
  assert.equal(lane(none, 'power').state, 'unavailable');
  assert.match(lane(none, 'power').note, /no app log/);
  assert.match(lane(await rig({ noLogs: true }).r.read(0), 'power').note, /no app log/);
});

test('an oversized log is read only up to 5 MB, and says so', async () => {
  const { r, logsDir } = rig();
  const line = '{"ts":"2026-11-10T09:00:00.000+02:00","event":"alive","pid":1}\n';
  const f = path.join(logsDir, 'app-2026-11-10.log');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, line);
  fs.ftruncateSync(fd, ribbon.LOG_MAX_BYTES + 100);   // a sparse file just over the cap
  fs.closeSync(fd);
  const m = await r.read(0);
  assert.equal(m.ok, true);
  assert.ok(m.notes.some((n) => /larger than 5 MB/.test(n)));
});

test('the browser file: a corrupt one is "could not be read", an absent one is unavailable, an old window gives the not-kept note', async () => {
  const bad = rig();
  fs.writeFileSync(path.join(bad.dataDir, 'browser-activity.json'), '{ not json');
  assert.match(lane(await bad.r.read(0), 'browser').note, /could not be read/);
  assert.equal(lane(await rig().r.read(0), 'browser').state, 'unavailable');
  const old = rig();
  fs.writeFileSync(path.join(old.dataDir, 'browser-activity.json'), JSON.stringify({ events: [{ domain: 'd.example', ts: T('2026-11-05T10:00:00Z'), focus_ms: 60000 }] }));
  const m = await old.r.read(4);   // 2026-11-06 is more than 3 days before now
  assert.equal(lane(m, 'browser').state, 'not-kept');
  assert.equal(m.counts.browserMinutes, null);
  assert.ok(m.notes.includes('browser lane is kept for 3 days'));
});
