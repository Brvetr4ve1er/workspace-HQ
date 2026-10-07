// node --test dashboard/app-log.test.mjs — the app lifecycle log (logs/app-YYYY-MM-DD.log).
// Every log folder here is a temp dir; the real logs/ is never touched. Paths and
// argv values are placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('./app-log.js');

const APP = 'C:\\Placeholder\\workspace hq';
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-applog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// a settable clock: local wall-clock components, so the day file is predictable in any timezone
function clock(y, mo, d, h = 12, mi = 0) {
  const c = { at: new Date(y, mo - 1, d, h, mi) };
  c.now = () => new Date(c.at.getTime());
  c.set = (y2, mo2, d2, h2 = 12, mi2 = 0) => { c.at = new Date(y2, mo2 - 1, d2, h2, mi2); };
  return c;
}

// ------------------------------------------------------------- format
test('day file + timestamp use the LOCAL date, with the offset spelled out', () => {
  const d = new Date(2026, 9, 7, 0, 30, 5, 9);   // 2026-10-07 00:30:05.009 local
  assert.equal(L.fileName(d), 'app-2026-10-07.log');
  assert.match(L.localIso(d), /^2026-10-07T00:30:05\.009[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(L.localIso(d)).getTime(), d.getTime(), 'the local ISO parses back to the same instant');
});

test('formatLine: ts, event, pid first; undefined dropped; base keys cannot be overridden; argv → flag names', () => {
  const d = new Date(2026, 9, 7, 9, 0);
  const o = JSON.parse(L.formatLine('start', { ts: 'x', event: 'y', pid: 0, a: 1, b: undefined, argv: ['electron.exe', '.', '--hidden', '--summon=note placeholder secret'] }, d, 42));
  assert.deepEqual(Object.keys(o), ['ts', 'event', 'pid', 'a', 'flags']);
  assert.equal(o.event, 'start'); assert.equal(o.pid, 42); assert.equal(o.a, 1);
  assert.deepEqual(o.flags, ['--hidden', '--summon']);
});

test('flagNames keeps names only, deduped; positionals and junk dropped', () => {
  assert.deepEqual(L.flagNames(['C:\\x\\electron.exe', '.', '--hidden', '--user-data-dir=C:\\Users\\placeholder\\tmp', '--hidden', '--remote-debugging-port=9471', '--summon-open', '-x', '--', '--bad name', 7]),
    ['--hidden', '--user-data-dir', '--remote-debugging-port', '--summon-open']);
  assert.deepEqual(L.flagNames(null), []);
});

test('pageName: the page file, never a host, title or full path', () => {
  assert.equal(L.pageName('file:///C:/Users/Placeholder%20Name/workspace%20hq/dashboard-v5/index.html'), 'dashboard-v5/index.html');
  assert.equal(L.pageName('file:///C:/x/dashboard/organic/summon.html?x=1#y'), 'organic/summon.html');
  assert.equal(L.pageName('https://example.com/private/page'), 'https');
  assert.equal(L.pageName('about:blank'), 'about');
  assert.equal(L.pageName(''), 'unknown');
  assert.equal(L.pageName(undefined), 'unknown');
});

test('redact: repo paths stay readable as <app>, every other path → <path>', () => {
  const s = [
    `at f (${APP}\\dashboard\\main.js:10:5)`,
    'at g (c:/placeholder/workspace hq/dashboard/app-log.js:1:1)',   // forward slashes, other case
    'file:///C:/Placeholder/workspace%20hq/dashboard/x.js',
    "ENOENT: no such file or directory, open 'C:\\Users\\Someone\\Documents\\Vault\\Private Note.md'",
    'at h (D:\\other\\thing.js:2:2)',
    'share \\\\server\\share\\file.txt',
    'file:///C:/Users/Someone/secret.html',
    'at Module._compile (node:internal/modules/cjs/loader:1504:14)',
  ].join('\n');
  const r = L.redact(s, APP).split('\n');
  assert.equal(r[0], 'at f (<app>\\dashboard\\main.js:10:5)');
  assert.equal(r[1], 'at g (<app>/dashboard/app-log.js:1:1)');
  assert.equal(r[2], 'file:///<app>/dashboard/x.js');
  assert.equal(r[3], "ENOENT: no such file or directory, open '<path>'");
  assert.equal(r[4], 'at h (<path>)');
  assert.equal(r[5], 'share <path>');
  assert.equal(r[6], '<path>');
  assert.equal(r[7], 'at Module._compile (node:internal/modules/cjs/loader:1504:14)', 'node: frames are not paths');
  assert.doesNotMatch(L.redact(s, APP), /Someone|Private Note|server/);
});

// review 2026-10-07: error text echoes data, not just paths — none of it may reach the log
test('redact: quoted data, URLs and e-mail addresses never reach the log; short identifiers stay readable', () => {
  // V8 quotes the JSON it failed on: a note, a post, a token
  let jsonErr;
  try { JSON.parse('placeholder private note'); } catch (e) { jsonErr = e; }
  const j = L.errorInfo(jsonErr, APP);
  assert.doesNotMatch(j.message, /placeholder|private|note/, j.message);
  assert.match(j.message, /is not valid JSON/, 'the kind of failure stays readable');
  assert.equal(L.redact('Unexpected token \'p\', "placeholder secret" is not valid JSON', APP), 'Unexpected token \'p\', "…" is not valid JSON');
  // a network error with a query-string token; the scheme+host+path are gone too
  assert.equal(L.redact('request to https://api.example.invalid/v1/me?access_token=PLACEHOLDERTOKEN failed, reason: ECONNRESET', APP),
    'request to <url> failed, reason: ECONNRESET');
  assert.equal(L.redact('connect ws://127.0.0.1:47821/socket?t=PLACEHOLDER refused', APP), 'connect <url> refused');
  // an address anywhere in the text
  assert.equal(L.redact('mailbox placeholder.user+tag@example.invalid rejected', APP), 'mailbox <email> rejected');
  // a long single-quoted value (a header, a title) goes; V8's short identifiers and redacted paths stay
  assert.equal(L.redact("Invalid value 'Bearer PLACEHOLDER-TOKEN-0123456789abcdefghij' for header", APP), "Invalid value '…' for header");
  assert.equal(L.redact("Cannot read properties of undefined (reading 'x')", APP), "Cannot read properties of undefined (reading 'x')");
  assert.equal(L.redact("Cannot find module 'C:\\Users\\Someone\\a-very-long-folder-name\\another-long-one\\x.js'", APP), "Cannot find module '<path>'");
  assert.equal(L.redact(`Cannot find module '${APP}\\dashboard\\organic\\a-rather-long-module-name.js'`, APP), "Cannot find module '<app>\\dashboard\\organic\\a-rather-long-module-name.js'");
  // repo file: URLs and node: frames are not <url>
  assert.equal(L.redact('file:///C:/Placeholder/workspace%20hq/dashboard/x.js', APP), 'file:///<app>/dashboard/x.js');
  assert.equal(L.redact('at Module._compile (node:internal/modules/cjs/loader:1504:14)', APP), 'at Module._compile (node:internal/modules/cjs/loader:1504:14)');
  // and end to end through a written line
  const e = new Error('fetch https://example.invalid/?q=PLACEHOLDER failed for "placeholder post text" by someone@example.invalid');
  const line = L.formatLine('uncaughtException', { error: L.errorInfo(e, APP) }, new Date(2026, 9, 7), 1);
  assert.doesNotMatch(line, /PLACEHOLDER|placeholder post|someone|example\.invalid/, line);
});

test('errorInfo: name, code, capped redacted message, ≤ 6 stack frames; non-Errors too', () => {
  const e = new Error(`open 'C:\\Users\\Someone\\x.json' ` + 'y'.repeat(500));
  e.code = 'ENOENT';
  e.stack = 'Error: …\n' + Array.from({ length: 9 }, (_, i) => `    at f${i} (${APP}\\dashboard\\main.js:${i}:1)`).join('\n');
  const info = L.errorInfo(e, APP);
  assert.equal(info.name, 'Error'); assert.equal(info.code, 'ENOENT');
  assert.ok(info.message.length <= 300); assert.match(info.message, /^open '<path>' y+$/);
  assert.equal(info.stack.length, 6); assert.equal(info.stack[0], 'at f0 (<app>\\dashboard\\main.js:0:1)');
  assert.deepEqual(L.errorInfo('rejected with C:\\Users\\Someone\\a', APP), { name: 'string', message: 'rejected with <path>' });
  const evil = { get message() { throw new Error('boom'); } };
  assert.deepEqual(L.errorInfo(evil, APP), { name: 'unknown', message: '(unprintable)' });
});

test('resolveDir: an absolute HQ_APP_LOG_DIR wins, a relative one is ignored', () => {
  assert.equal(L.resolveDir({ HQ_APP_LOG_DIR: 'C:\\temp\\hq-gate-logs' }, APP), 'C:\\temp\\hq-gate-logs');
  assert.equal(L.resolveDir({ HQ_APP_LOG_DIR: 'logs2' }, APP), path.join(APP, 'logs'));
  assert.equal(L.resolveDir({}, APP), path.join(APP, 'logs'));
  assert.equal(L.resolveDir(undefined, null), null);
});

// ------------------------------------------------------------- writing + rotation
test('one JSON line per event; the file follows the clock across midnight', (t) => {
  const dir = tmp(t);
  const c = clock(2026, 10, 7, 23, 59);
  const log = L.create({ dir, appRoot: APP, now: c.now, pid: 111 });
  assert.equal(log.event('alive', { uptimeMin: 1 }), true);
  c.set(2026, 10, 8, 0, 1);
  assert.equal(log.event('alive', { uptimeMin: 3 }), true);
  const a = lines(path.join(dir, 'app-2026-10-07.log')), b = lines(path.join(dir, 'app-2026-10-08.log'));
  assert.deepEqual(a.map((o) => [o.event, o.pid, o.uptimeMin]), [['alive', 111, 1]]);
  assert.deepEqual(b.map((o) => [o.event, o.pid, o.uptimeMin]), [['alive', 111, 3]]);
});

test('an argv field is never written raw', (t) => {
  const dir = tmp(t);
  const log = L.create({ dir, now: clock(2026, 10, 7).now, pid: 1 });
  log.event('second-instance', { argv: ['electron.exe', '--summon=note placeholder-secret', 'C:\\Users\\Someone\\file.txt'] });
  const raw = fs.readFileSync(path.join(dir, 'app-2026-10-07.log'), 'utf8');
  assert.doesNotMatch(raw, /placeholder-secret|Someone|argv/);
  assert.deepEqual(JSON.parse(raw).flags, ['--summon']);
});

test('prune: only app-YYYY-MM-DD.log files older than keepDays go', (t) => {
  const dir = tmp(t);
  const keep = ['app-2026-10-07.log', 'app-2026-09-07.log', 'pipeline-2026-01-01_000000.log', 'app-notes.txt', 'app-2020-01-01.log.bak'];
  const old = ['app-2026-09-06.log', 'app-2025-12-31.log'];
  for (const n of [...keep, ...old]) fs.writeFileSync(path.join(dir, n), 'x\n');
  fs.mkdirSync(path.join(dir, 'app-2020-01-02.log'));   // a folder with the name: left alone, no throw
  L.create({ dir, now: clock(2026, 10, 7).now, keepDays: 30 });
  const left = fs.readdirSync(dir).sort();
  assert.deepEqual(left, [...keep, 'app-2020-01-02.log'].sort());
});

test('a day file stops at maxBytes with ONE log-capped line; the next day writes again', (t) => {
  const dir = tmp(t);
  const c = clock(2026, 10, 7);
  const log = L.create({ dir, now: c.now, pid: 5, maxBytes: 300 });
  let written = 0;
  for (let i = 0; i < 20; i++) if (log.event('alive', { i })) written++;
  const day = lines(path.join(dir, 'app-2026-10-07.log'));
  assert.ok(written >= 1 && written < 20);
  assert.equal(day.filter((o) => o.event === 'log-capped').length, 1);
  assert.equal(day[day.length - 1].event, 'log-capped');
  c.set(2026, 10, 8);
  assert.equal(log.event('alive', { i: 99 }), true);
});

test('never throws: an unwritable log folder just returns false', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const log = L.create({ dir: file, now: clock(2026, 10, 7).now });
  assert.equal(log.event('start', {}), false);
  assert.equal(log.error('uncaughtException', new Error('x')), false);
  const circular = {}; circular.self = circular;
  const ok = L.create({ dir, now: clock(2026, 10, 7).now, pid: 9 });
  assert.equal(ok.event('weird', { circular }), true, 'an unserializable field still leaves a line');
  assert.equal(lines(path.join(dir, 'app-2026-10-07.log'))[0].unserializable, true);
  assert.equal(L.create({}).event('x'), false, 'no dir at all');
});

// ------------------------------------------------------------- start / prev
test("start carries prev: the previous primary run's last line, skipping the lost-the-lock process", (t) => {
  const dir = tmp(t);
  const c = clock(2026, 10, 6, 22, 0);
  const run1 = L.create({ dir, now: c.now, pid: 111 });
  run1.start({ version: '0.0.0', renderer: 'v5', argv: ['--hidden'] });
  c.set(2026, 10, 7, 2, 45); run1.event('alive', { uptimeMin: 285 });
  // a second launch loses the lock (its own lines are secondary) — not "the previous run"
  const loser = L.create({ dir, now: c.now, pid: 222 });
  loser.secondary(); loser.event('second-launch-exit', { argv: ['--hidden'] }); loser.event('quit', { reason: 'second-launch' });
  // morning: the app is started again
  c.set(2026, 10, 7, 8, 10);
  const run2 = L.create({ dir, now: c.now, pid: 333 });
  run2.start({ version: '0.0.0', renderer: 'v5', argv: [] });
  const today = lines(path.join(dir, 'app-2026-10-07.log'));
  const s = today[today.length - 1];
  assert.equal(s.event, 'start');
  assert.deepEqual(s.prev, { pid: 111, event: 'alive', ts: today[0].ts, clean: false }, 'the dead run last wrote alive at 02:45');
  assert.ok(today.filter((o) => o.pid === 222).every((o) => o.secondary === true));
});

test('prev is clean when the previous run ended on quit; null with no history', (t) => {
  const dir = tmp(t);
  const c = clock(2026, 10, 7, 9);
  const run1 = L.create({ dir, now: c.now, pid: 1 });
  run1.start({});
  run1.event('quit', { exitCode: 0, reason: 'tray' });
  const run2 = L.create({ dir, now: c.now, pid: 2 });
  run2.start({});
  const all = lines(path.join(dir, 'app-2026-10-07.log'));
  assert.equal(all[0].prev, null);
  assert.equal(all[2].prev.event, 'quit'); assert.equal(all[2].prev.clean, true);
  fs.appendFileSync(path.join(dir, 'app-2026-10-07.log'), '{"ts":"torn line');   // a crash mid-write
  assert.equal(L.lastRun(dir).pid, 2, 'a torn last line is skipped');
});

// ------------------------------------------------------------- Electron hooks (fakes)
function fakeWc(url) { return { getURL: () => url }; }
test('attach: crashes, hangs, session end and quit reasons — every window via browser-window-created', (t) => {
  const dir = tmp(t);
  const app = new EventEmitter(), proc = new EventEmitter();
  const log = L.create({ dir, now: clock(2026, 10, 7).now, pid: 7 });
  assert.equal(log.attach({ app, proc }), true);
  app.emit('render-process-gone', {}, fakeWc('file:///C:/x/dashboard-v5/index.html'), { reason: 'crashed', exitCode: -1073741819 });
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'killed', exitCode: 1, name: 'GPU' });
  const w1 = new EventEmitter(); w1.webContents = fakeWc('file:///C:/x/dashboard/mini.html');
  const w2 = new EventEmitter(); w2.webContents = fakeWc('file:///C:/x/dashboard/organic/summon.html');
  app.emit('browser-window-created', {}, w1);
  app.emit('browser-window-created', {}, w2);
  w1.emit('unresponsive'); w1.emit('responsive');
  w1.emit('session-end'); w2.emit('session-end');   // every window hears it: one line
  app.emit('before-quit'); app.emit('will-quit'); app.emit('quit', {}, 0);
  proc.emit('exit', 0);                              // quit already logged: no exit line
  const got = lines(path.join(dir, 'app-2026-10-07.log')).map(({ ts, pid, ...rest }) => rest);
  assert.deepEqual(got, [
    { event: 'render-process-gone', window: 'dashboard-v5/index.html', reason: 'crashed', exitCode: -1073741819 },
    { event: 'child-process-gone', type: 'GPU', reason: 'killed', exitCode: 1, name: 'GPU' },
    { event: 'unresponsive', window: 'dashboard/mini.html' },
    { event: 'responsive', window: 'dashboard/mini.html' },
    { event: 'session-end', window: 'dashboard/mini.html' },
    { event: 'before-quit', reason: 'session-end' },
    { event: 'will-quit', reason: 'session-end' },
    { event: 'quit', exitCode: 0, reason: 'session-end' },
  ]);
});

test('quit reason: tray when main says so, unknown otherwise; a bare process exit is logged', (t) => {
  const dir = tmp(t);
  const app = new EventEmitter(), proc = new EventEmitter();
  const log = L.create({ dir, now: clock(2026, 10, 7).now, pid: 8 });
  log.attach({ app, proc });
  app.emit('before-quit');
  log.setQuitReason('tray');
  app.emit('before-quit');
  proc.emit('exit', 3);
  const got = lines(path.join(dir, 'app-2026-10-07.log')).map((o) => [o.event, o.reason ?? o.code]);
  assert.deepEqual(got, [['before-quit', 'unknown'], ['before-quit', 'tray'], ['exit', 3]]);
  assert.equal(log.attach({}), false, 'no app → nothing attached');
});

// Review 2026-10-07 (real-app gate): Electron's init registers app.on('quit') → process.emit('exit')
// BEFORE main.js attaches, so a clean quit used to log 'exit' (meant for a bare process.exit) and then 'quit'.
test('a clean quit logs quit once and no exit line, even though Electron emits process exit from its own earlier quit listener', (t) => {
  const dir = tmp(t);
  const app = new EventEmitter(), proc = new EventEmitter();
  app.on('quit', (_e, code) => proc.emit('exit', code));   // what electron/lib/browser/init does, first
  const log = L.create({ dir, now: clock(2026, 10, 7).now, pid: 10 });
  log.attach({ app, proc });
  app.emit('before-quit'); app.emit('will-quit'); app.emit('quit', {}, 0);
  const got = lines(path.join(dir, 'app-2026-10-07.log')).map((o) => o.event);
  assert.deepEqual(got, ['before-quit', 'will-quit', 'quit']);
  // a fake app without prependListener still gets its quit line
  const dir2 = tmp(t);
  const bare = { handlers: {}, on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); } };
  const log2 = L.create({ dir: dir2, now: clock(2026, 10, 7).now, pid: 11 });
  log2.attach({ app: bare, proc: new EventEmitter() });
  bare.handlers.quit.forEach((fn) => fn({}, 0));
  assert.deepEqual(lines(path.join(dir2, 'app-2026-10-07.log')).map((o) => o.event), ['quit']);
});

test('watchPower: suspend / resume / shutdown (shutdown sets the quit reason)', (t) => {
  const dir = tmp(t);
  const app = new EventEmitter(), pm = new EventEmitter();
  const log = L.create({ dir, now: clock(2026, 10, 7).now, pid: 9 });
  log.attach({ app, proc: new EventEmitter() });
  assert.equal(log.watchPower(pm), true);
  pm.emit('suspend'); pm.emit('resume'); pm.emit('shutdown'); app.emit('before-quit');
  const got = lines(path.join(dir, 'app-2026-10-07.log')).map((o) => o.reason ? `${o.event}:${o.reason}` : o.event);
  assert.deepEqual(got, ['suspend', 'resume', 'shutdown', 'before-quit:shutdown']);
  assert.equal(log.watchPower(null), false);
});

test('error lines carry the redacted error; heartbeat writes alive lines until stopped', async (t) => {
  const dir = tmp(t);
  const log = L.create({ dir, appRoot: APP, now: clock(2026, 10, 7).now, pid: 10 });
  const e = new TypeError("Cannot read properties of undefined (reading 'x')");
  e.stack = `TypeError: x\n    at summonWidget (${APP}\\dashboard\\main.js:660:45)`;
  log.error('uncaughtException', e);
  log.heartbeat(15);
  await new Promise((r) => setTimeout(r, 80));
  log.stop();
  const got = lines(path.join(dir, 'app-2026-10-07.log'));
  assert.deepEqual(got[0].error, { name: 'TypeError', message: "Cannot read properties of undefined (reading 'x')", stack: ['at summonWidget (<app>\\dashboard\\main.js:660:45)'] });
  const alive = got.filter((o) => o.event === 'alive');
  assert.ok(alive.length >= 1);
  assert.ok(Number.isInteger(alive[0].uptimeMin) && Number.isInteger(alive[0].rssMb) && Number.isInteger(alive[0].heapMb));
  const n = got.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lines(path.join(dir, 'app-2026-10-07.log')).length, n, 'stop() ends the heartbeat');
});
