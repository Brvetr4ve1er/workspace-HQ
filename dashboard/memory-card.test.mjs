// Memory card, main side (dashboard/memory-card.js): temp folders with INVENTED files, injected fs/clock where a real one cannot misbehave on
// demand. No real data folder, no real snapshot folder. Placeholder names only - the repo is public.
//   node --test dashboard/memory-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const mc = require('./memory-card.js');

const NOW = Date.parse('2026-11-14T12:00:00Z');
const H = 3600e3;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-memcard-'));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
const put = (file, bytes, agoMs) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  const t = new Date(NOW - agoMs);
  fs.utimesSync(file, t, t);
};
const by = (r) => Object.fromEntries(r.slots.map((s) => [s.kind, s]));
const only = (fsReal) => ({ readdirSync: fsReal.readdirSync.bind(fsReal), lstatSync: fsReal.lstatSync.bind(fsReal) });   // no readFile*, no open*: contents are unreachable

// the invented tree: top-level names from the fixed table, plus names the table does not know
function tree(root) {
  const data = path.join(root, 'data'), logs = path.join(root, 'logs');
  put(path.join(data, 'latest.json'), 100, 5 * H);
  put(path.join(data, 'shards.json'), 24, 2 * H);
  put(path.join(data, 'brief.json'), 10, 30 * 60e3);
  put(path.join(data, 'intents', 'one.json'), 5, 4 * H);
  put(path.join(data, 'intents', 'inner', 'two.json'), 7, 3 * H);
  put(path.join(data, 'money', 'ledger-x.bin'), 3, 26 * H);
  put(path.join(data, 'cosmos', 'library.json'), 4096, 9 * H);
  put(path.join(data, 'cosmos', 'thumbs', 't1.jpg'), 1000, 40e3);
  put(path.join(data, 'security', 'status.json'), 11, 50 * H);
  put(path.join(data, 'delivery.json'), 9, 7 * H);
  put(path.join(data, 'claude', 'hub.sqlite'), 8192, 6 * H);
  put(path.join(data, 'claude', 'hub.sqlite-wal'), 100, 20e3);
  put(path.join(data, 'assistant-audit.jsonl'), 50, 12 * H);
  put(path.join(data, 'today.json'), 13, 8 * H);
  put(path.join(data, 'disk-history.json'), 17, 9 * H);
  put(path.join(data, 'alpha-site-notes.txt'), 21, 100 * H);
  put(path.join(data, '.ui-version'), 2, 101 * H);
  put(path.join(data, 'client-zeta', 'secret-plan.docx'), 33, 60 * H);
  put(path.join(logs, 'app-2026-11-13.log'), 300, 18 * H);
  put(path.join(logs, 'app-2026-11-14.log'), 400, 2 * H);
  return { data, logs };
}

test('real folders: every kind gets exact counts, byte totals and newest writes, and the logs folder beside data/ is the logs kind', async () => {
  const root = tmp();
  try {
    const { data, logs } = tree(root);
    const r = await mc.create({ dataDir: data, logsDir: logs, snapshotDir: path.join(root, 'none'), now: () => NOW, fsImpl: only(fs) }).read();
    assert.equal(r.at, new Date(NOW).toISOString());
    assert.equal(r.capped, false);
    assert.deepEqual(r.slots.map((s) => s.kind), ['scans', 'brief', 'money', 'cosmos', 'security', 'delivery', 'chat-index', 'logs', 'today-drift', 'other']);
    const s = by(r);
    const at = (ago) => NOW - ago;
    assert.deepEqual([s.scans.files, s.scans.bytes, s.scans.newestMs], [2, 124, at(2 * H)]);
    assert.deepEqual([s.brief.files, s.brief.bytes, s.brief.newestMs], [3, 22, at(30 * 60e3)], 'brief.json plus the intents folder, two levels deep');
    assert.deepEqual([s.money.files, s.money.bytes, s.money.newestMs], [1, 3, at(26 * H)]);
    assert.deepEqual([s.cosmos.files, s.cosmos.bytes, s.cosmos.newestMs], [2, 5096, at(40e3)]);
    assert.deepEqual([s.security.files, s.security.bytes, s.security.newestMs], [1, 11, at(50 * H)]);
    assert.deepEqual([s.delivery.files, s.delivery.bytes, s.delivery.newestMs], [1, 9, at(7 * H)]);
    assert.deepEqual([s['chat-index'].files, s['chat-index'].bytes, s['chat-index'].newestMs], [2, 8292, at(20e3)]);
    assert.deepEqual([s.logs.files, s.logs.bytes, s.logs.newestMs], [3, 750, at(2 * H)], 'the audit file plus the two day logs');
    assert.deepEqual([s['today-drift'].files, s['today-drift'].bytes, s['today-drift'].newestMs], [2, 30, at(8 * H)]);
    assert.deepEqual([s.other.files, s.other.bytes, s.other.newestMs], [3, 56, at(60 * H)], 'the unknown folder and the two unknown files');
    assert.ok(r.slots.every((x) => x.partial === false));
    assert.deepEqual(Object.keys(r).sort(), ['at', 'capped', 'slots', 'snapshot']);
    for (const x of r.slots) assert.deepEqual(Object.keys(x).sort(), ['bytes', 'files', 'kind', 'label', 'newestMs', 'partial']);
  } finally { rm(root); }
});

test('with no logsDir given, the folder beside data/ named logs is used; a missing one is simply no log files', async () => {
  const root = tmp();
  try {
    const { data } = tree(root);
    const r = await mc.create({ dataDir: data, snapshotDir: path.join(root, 'none'), now: () => NOW }).read();
    assert.equal(by(r).logs.files, 3);
    rm(path.join(root, 'logs'));
    const r2 = await mc.create({ dataDir: data, snapshotDir: path.join(root, 'none'), now: () => NOW }).read();
    assert.deepEqual([by(r2).logs.files, by(r2).logs.bytes, by(r2).logs.newestMs], [1, 50, NOW - 12 * H], 'only the audit file is left');
  } finally { rm(root); }
});

test('LEAK: the reply never contains any file or folder name, or the temp path, only kinds, numbers and the words', async () => {
  const root = tmp();
  try {
    const { data, logs } = tree(root);
    const r = await mc.create({ dataDir: data, logsDir: logs, snapshotDir: path.join(root, 'none'), now: () => NOW }).read();
    const wire = JSON.stringify(r);
    const names = ['latest.json', 'shards.json', 'brief.json', 'intents', 'one.json', 'two.json', 'ledger-x.bin', 'library.json', 'thumbs', 't1.jpg', 'status.json', 'delivery.json', 'hub.sqlite',
      'hub.sqlite-wal', 'assistant-audit.jsonl', 'today.json', 'disk-history.json', 'alpha-site-notes.txt', 'alpha-site', '.ui-version', 'client-zeta', 'secret-plan.docx', 'secret-plan',
      'app-2026-11-13.log', 'app-2026-11-14.log', 'inner', path.basename(root), root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')];
    for (const n of names) assert.ok(!wire.includes(n), 'the reply leaks ' + n);
    // the only strings in the reply are: ISO time, kind ids, labels
    const strings = [];
    JSON.stringify(r, (k, v) => { if (typeof v === 'string') strings.push(v); return v; });
    const allowed = new Set([r.at, ...r.slots.flatMap((s) => [s.kind, s.label])]);
    for (const str of strings) assert.ok(allowed.has(str), 'unexpected string in the reply: ' + str);
  } finally { rm(root); }
});

test('nothing is read from file contents: a filesystem with only readdir and lstat is all it ever needs', async () => {
  const root = tmp();
  try {
    const { data, logs } = tree(root);
    const calls = [];
    const spy = (name) => (...a) => { calls.push(name); return fs[name](...a); };
    const r = await mc.create({ dataDir: data, logsDir: logs, snapshotDir: path.join(root, 'none'), now: () => NOW, fsImpl: { readdirSync: spy('readdirSync'), lstatSync: spy('lstatSync') } }).read();
    assert.ok(!r.error);
    assert.ok(calls.length > 20 && calls.every((c) => c === 'readdirSync' || c === 'lstatSync'));
  } finally { rm(root); }
});

// a tiny in-memory fs: tree = { name: number (file bytes) | { ...children } | { __link: true } | { __denied: true } }
function fakeFs(treeObj, { mtime = NOW - H, onList } = {}) {
  const norm = (p) => String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  const find = (p) => {
    let node = treeObj;
    for (const seg of norm(p).slice(2)) {   // the first two segments (drive and fake root) are the fake's own
      if (!node || typeof node !== 'object' || !(seg in node)) { const e = new Error('ENOENT ' + seg); e.code = 'ENOENT'; throw e; }
      node = node[seg];
    }
    return node;
  };
  const dirent = (name, v) => ({ name, isFile: () => typeof v === 'number', isDirectory: () => typeof v === 'object' && !v.__link, isSymbolicLink: () => !!(v && v.__link) });
  return {
    readdirSync(p) {
      if (onList) onList(p);
      const n = find(p);
      if (typeof n !== 'object' || n.__denied) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
      return Object.entries(n).filter(([k]) => !k.startsWith('__')).map(([k, v]) => dirent(k, v));
    },
    lstatSync(p) { const n = find(p); return { size: typeof n === 'number' ? n : 0, mtimeMs: mtime, isSymbolicLink: () => !!(n && n.__link) }; },
  };
}
const FAKE_ROOT = 'R:/fake/data';
const fake = (t, o) => mc.create({ dataDir: FAKE_ROOT, logsDir: null, snapshotDir: null, now: () => NOW, fsImpl: fakeFs({ data: t }, o), ...(o && o.create) });

test('every file the fake holds is counted once; symlinks are neither followed nor counted', async () => {
  const r = await fake({ 'latest.json': 10, cosmos: { 'library.json': 100, linked: { __link: true } }, pointer: { __link: true }, 'a-file-link': { __link: true } }).read();
  const s = by(r);
  assert.deepEqual([s.scans.files, s.scans.bytes], [1, 10]);
  assert.deepEqual([s.cosmos.files, s.cosmos.bytes], [1, 100], 'the link inside the folder is skipped');
  assert.equal(s.other.files, 0, 'a top-level link is skipped too');
  assert.equal(r.capped, false);
});

test('a real junction or symlink to a folder full of files is not followed (skipped when the platform will not make one)', async (t) => {
  const root = tmp();
  try {
    const { data } = tree(root);
    const outside = path.join(root, 'outside');
    put(path.join(outside, 'big-one.bin'), 5000, H);
    try { fs.symlinkSync(outside, path.join(data, 'cosmos', 'linked-out'), 'junction'); } catch (e) { return t.skip('cannot make a link here: ' + (e && e.code)); }
    const r = await mc.create({ dataDir: data, logsDir: null, snapshotDir: null, now: () => NOW }).read();
    assert.deepEqual([by(r).cosmos.files, by(r).cosmos.bytes], [2, 5096], 'the 5000-byte file behind the link is not counted');
  } finally { rm(root); }
});

test('depth: folders three levels down are not entered, so their slot is an "at least" figure', async () => {
  const r = await fake({ cosmos: { 'a.bin': 1, thumbs: { 't.bin': 2, deeper: { 'z.bin': 4 } } }, security: { 'x.bin': 8 } }).read();
  const s = by(r);
  assert.deepEqual([s.cosmos.files, s.cosmos.bytes, s.cosmos.partial], [2, 3, true], 'a.bin (depth 2) and t.bin (depth 3) counted; deeper/ (depth 3) not looked into');
  assert.deepEqual([s.security.files, s.security.partial], [1, false]);
  assert.equal(r.capped, true);
});

test('the entry cap stops the walk and says so: the slots it cut are partial, the ones it finished are exact', async () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['f' + i + '.bin', 1]));
  const r = await fake({ 'brief.json': 5, cosmos: many, money: { 'm.bin': 9 } }, { create: { limits: { entries: 12 } } }).read();
  const s = by(r);
  assert.equal(s.brief.files, 1);
  assert.equal(s.brief.partial, false, 'brief.json came first and was counted');
  assert.ok(s.cosmos.files < 30 && s.cosmos.files > 0 && s.cosmos.partial === true, 'cosmos stopped part-way: ' + JSON.stringify(s.cosmos));
  assert.equal(s.money.partial, true, 'money was never reached, so it is "at least" (here 0 found so far), not an exact 0');
  assert.equal(s.money.files, 0);
  assert.equal(r.capped, true);
});

test('exactly at the cap is not a cut: 5,000 entries by default, and a tree of exactly the cap reads clean', async () => {
  const mk = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['f' + i, 1]));
  const clean = await fake({ cosmos: mk(9) }, { create: { limits: { entries: 10 } } }).read();   // 1 folder + 9 files = 10 entries
  assert.equal(by(clean).cosmos.partial, false);
  assert.equal(by(clean).cosmos.files, 9);
  const cut = await fake({ cosmos: mk(10) }, { create: { limits: { entries: 10 } } }).read();
  assert.equal(by(cut).cosmos.partial, true);
  const core = await import('./memory-card-core.mjs');
  assert.equal(core.LIMITS.entries, 5000);
});

test('the time cap stops the walk and says so (an injected clock that jumps), and never invents a zero', async () => {
  let t = NOW;
  const r = await mc.create({
    dataDir: FAKE_ROOT, logsDir: null, snapshotDir: null, limits: { ms: 2000 },
    now: () => (t += 900),   // every look at the clock costs 0.9 s
    fsImpl: fakeFs({ data: { 'latest.json': 1, 'brief.json': 2, cosmos: { 'a.bin': 3 }, money: { 'm.bin': 4 }, 'today.json': 5 } }),
  }).read();
  assert.equal(r.capped, true);
  assert.ok(r.slots.some((s) => s.partial), 'something was cut');
  assert.ok(r.slots.every((s) => s.files === null || Number.isInteger(s.files)));
  const total = r.slots.reduce((n, s) => n + (s.files || 0), 0);
  assert.ok(total < 5, 'not everything was reached: ' + total);
});

test('an unreadable folder inside a kind makes that slot null ("could not look") and leaves every other slot exact', async () => {
  const r = await fake({ 'latest.json': 10, money: { __denied: true }, cosmos: { 'a.bin': 5 }, security: { 'x.bin': 1, locked: { __denied: true } } }).read();
  const s = by(r);
  assert.deepEqual([s.money.files, s.money.bytes, s.money.newestMs, s.money.partial], [null, null, null, false]);
  assert.deepEqual([s.security.files, s.security.bytes], [null, null], 'a readable file beside an unreadable folder does not make the slot a guess');
  assert.deepEqual([s.scans.files, s.cosmos.files], [1, 1]);
  assert.ok(!r.error, 'one slot failing is not a failed read');
});

test('an unreadable or missing data folder answers { error } in words, with no path in it', async () => {
  for (const dataDir of ['R:/fake/missing/data', undefined, '']) {
    const r = await mc.create({ dataDir, logsDir: null, snapshotDir: null, now: () => NOW, fsImpl: fakeFs({ data: {} }) }).read();
    assert.deepEqual(Object.keys(r), ['error'], String(dataDir));
    assert.equal(r.error, 'could not look at the data folder');
  }
  const denied = await mc.create({ dataDir: FAKE_ROOT, logsDir: null, snapshotDir: null, now: () => NOW, fsImpl: fakeFs({ data: { __denied: true } }) }).read();
  assert.deepEqual(denied, { error: 'could not look at the data folder' });
});

test('an unreadable logs folder makes the logs slot null; a missing one is just no files', async () => {
  const fsImpl = fakeFs({ data: { 'today.json': 1 }, locked: { __denied: true }, ok: { 'a.log': 5 } });
  const denied = await mc.create({ dataDir: FAKE_ROOT, logsDir: 'R:/fake/locked', snapshotDir: null, now: () => NOW, fsImpl }).read();
  assert.equal(by(denied).logs.files, null);
  const missing = await mc.create({ dataDir: FAKE_ROOT, logsDir: 'R:/fake/nope', snapshotDir: null, now: () => NOW, fsImpl }).read();
  assert.equal(by(missing).logs.files, 0);
  const there = await mc.create({ dataDir: FAKE_ROOT, logsDir: 'R:/fake/ok', snapshotDir: null, now: () => NOW, fsImpl }).read();
  assert.deepEqual([by(there).logs.files, by(there).logs.bytes], [1, 5]);
});

test('concurrent reads share one walk (a double click is one look)', async () => {
  let lists = 0;
  const api = fake({ 'latest.json': 1 }, { onList: () => { lists += 1; } });
  const [a, b] = await Promise.all([api.read(), api.read()]);
  assert.deepEqual(a, b);
  assert.equal(lists, 1);
  await api.read();
  assert.equal(lists, 2, 'a later read looks again');
});

test('snapshot slot: the newest file age and the number kept, from an injected folder; only hub-YYYY-MM-DD.sqlite names count', async () => {
  const root = tmp();
  try {
    const snap = path.join(root, 'snaps');
    put(path.join(snap, 'hub-2026-11-12.sqlite'), 5, 31 * H);
    put(path.join(snap, 'hub-2026-11-13.sqlite'), 5, 7 * H);
    put(path.join(snap, 'hub-2026-11-13.sqlite-wal'), 5, 60e3);
    put(path.join(snap, 'notes.txt'), 5, 1000);
    fs.mkdirSync(path.join(snap, 'hub-2026-11-14.sqlite'));
    const { data } = tree(root);
    const r = await mc.create({ dataDir: data, logsDir: null, snapshotDir: snap, now: () => NOW }).read();
    assert.deepEqual(r.snapshot, { newestMs: NOW - 7 * H, kept: 2, max: 7, ok: true });
    assert.ok(!JSON.stringify(r).includes('hub-2026'), 'no snapshot file name in the reply');
  } finally { rm(root); }
});

test('snapshot slot: no folder yet = none (0 kept, ok); an empty folder = none; an unreadable one = ok:false with nothing guessed', async () => {
  const root = tmp();
  try {
    const { data } = tree(root);
    const none = await mc.create({ dataDir: data, logsDir: null, snapshotDir: path.join(root, 'never-made'), now: () => NOW }).read();
    assert.deepEqual(none.snapshot, { newestMs: null, kept: 0, max: 7, ok: true });
    fs.mkdirSync(path.join(root, 'empty'));
    const empty = await mc.create({ dataDir: data, logsDir: null, snapshotDir: path.join(root, 'empty'), now: () => NOW }).read();
    assert.deepEqual(empty.snapshot, { newestMs: null, kept: 0, max: 7, ok: true });
    const denied = await mc.create({ dataDir: FAKE_ROOT, logsDir: null, snapshotDir: 'R:/fake/snap', now: () => NOW, fsImpl: fakeFs({ data: {}, snap: { __denied: true } }) }).read();
    assert.deepEqual(denied.snapshot, { newestMs: null, kept: null, max: 7, ok: false });
    const nodir = await mc.create({ dataDir: data, logsDir: null, snapshotDir: null, now: () => NOW }).read();
    assert.deepEqual(nodir.snapshot, { newestMs: null, kept: null, max: 7, ok: false });
  } finally { rm(root); }
});

test('the default snapshot folder comes from hub-snapshot.defaultDir(env, home): an env override is followed, and no real folder is touched', async () => {
  const root = tmp();
  try {
    const snap = path.join(root, 'via-env');
    put(path.join(snap, 'hub-2026-11-14.sqlite'), 5, 2 * H);
    const { data } = tree(root);
    const r = await mc.create({ dataDir: data, logsDir: null, env: { HQ_HUB_SNAPSHOT_DIR: snap }, homedir: path.join(root, 'home'), now: () => NOW }).read();
    assert.deepEqual(r.snapshot, { newestMs: NOW - 2 * H, kept: 1, max: 7, ok: true });
    const guess = require('./hub-snapshot.js').defaultDir({ LOCALAPPDATA: path.join(root, 'local') }, path.join(root, 'home'));
    assert.ok(guess.startsWith(root), 'the injected env and home decide where it would look');
  } finally { rm(root); }
});

// ---- the channel -------------------------------------------------------------------------------------------------------
function channel(extra) {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const wc = { id: 'main-window', isDestroyed: () => false };
  const win = { webContents: wc, isDestroyed: () => false };
  const api = mc.init({ ipcMain, getWin: () => win, dataDir: FAKE_ROOT, logsDir: null, snapshotDir: null, now: () => NOW, fsImpl: fakeFs({ data: { 'latest.json': 12 } }), ...extra });
  return { handlers, wc, win, api, call: (event, ...args) => handlers.get('hq:memory:read')(event, ...args) };
}

test('init registers exactly one channel, hq:memory:read, and returns an object that can only read', () => {
  const c = channel();
  assert.deepEqual([...c.handlers.keys()], ['hq:memory:read']);
  assert.deepEqual(Object.keys(c.api), ['read']);
  assert.deepEqual(Object.keys(mc).sort(), ['DENIED', 'collect', 'create', 'init']);
});

test('SENDER: the main window gets the numbers; any other sender, a missing event, a destroyed window or no window gets { error }', async () => {
  const c = channel();
  const ok = await c.call({ sender: c.wc });
  assert.equal(ok.slots.length, 10);
  assert.deepEqual(await c.call({ sender: { id: 'a-satellite-window' } }), { error: 'not available here' });
  assert.deepEqual(await c.call({ sender: null }), { error: 'not available here' });
  assert.deepEqual(await c.call(undefined), { error: 'not available here' });
  assert.deepEqual(await c.call({}), { error: 'not available here' });
  const gone = channel(); gone.win.isDestroyed = () => true;
  assert.deepEqual(await gone.call({ sender: gone.wc }), { error: 'not available here' });
  const goneWc = channel(); goneWc.wc.isDestroyed = () => true;
  assert.deepEqual(await goneWc.call({ sender: goneWc.wc }), { error: 'not available here' });
  const noWin = channel({ getWin: () => null });
  assert.deepEqual(await noWin.call({ sender: noWin.wc }), { error: 'not available here' });
  const noGetter = channel({ getWin: undefined });
  assert.deepEqual(await noGetter.call({ sender: noGetter.wc }), { error: 'not available here' });
  const throwing = channel({ getWin: () => { throw new Error('boom'); } });
  assert.deepEqual(await throwing.call({ sender: throwing.wc }), { error: 'not available here' });
});

test('the channel takes no arguments: nothing a caller passes can steer what it looks at', async () => {
  const lists = [];
  const c = channel({ fsImpl: fakeFs({ data: { 'latest.json': 1 } }, { onList: (p) => lists.push(String(p)) }) });
  const r = await c.call({ sender: c.wc }, { dataDir: 'R:/somewhere/else', path: 'C:/Windows', limits: { entries: 1 } });
  assert.equal(r.slots.find((s) => s.kind === 'scans').files, 1);
  assert.ok(lists.every((p) => p.replace(/\\/g, '/').startsWith(FAKE_ROOT)), 'only the data folder was listed: ' + lists.join(' | '));
});

test('a failure inside answers one fixed word, never the underlying message or a path', async () => {
  const c = channel({ fsImpl: { readdirSync() { throw new Error('EPERM C:/Users/someone/secret-path'); }, lstatSync() { throw new Error('x'); } } });
  const r = await c.call({ sender: c.wc });
  assert.deepEqual(r, { error: 'could not look at the data folder' });
  assert.ok(!JSON.stringify(r).includes('secret-path'));
});

test('READ-ONLY by construction: the module source has no write, delete, rename, copy or spawn call', () => {
  const src = fs.readFileSync(new URL('./memory-card.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const re of [/writeFile/, /appendFile/, /\bunlink/, /\brm(Sync|dir)?\(/, /rmdir/, /\brename/, /copyFile/, /\bmkdir/, /\btruncate/, /utimes/, /chmod/, /\bchild_process\b/, /\bexec(File|Sync)?\(/, /\bspawn/, /\bshell\b/, /trashItem/, /readFile/, /createReadStream/, /\bopenSync\b/]) {
    assert.ok(!re.test(src), 'source mentions ' + re);
  }
});

// ---- the shared edits (skipped LOUDLY until the integrator lands them, then they pin them) ------------------------------------------
const loud = (t, what) => { const m = 'SKIPPED LOUDLY (memory-card): ' + what + ' is not in place yet'; process.stderr.write('\n' + m + '\n'); return t.skip(m); };
const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('preload: hq.memory exposes read and nothing else, over the one channel', (t) => {
  const src = read('dashboard/preload.js');
  const m = /^\s*memory:\s*\{([^}]*)\}/m.exec(src);
  if (!m) return loud(t, 'the hq.memory group in dashboard/preload.js');
  const members = [...m[1].replace(/'[^']*'/g, "''").matchAll(/(\w+)\s*:/g)].map((x) => x[1]);   // string literals out first: the channel name has colons of its own
  assert.deepEqual(members, ['read']);
  assert.match(m[1], /ipcRenderer\.invoke\('hq:memory:read'\)/);
  assert.equal((m[1].match(/ipcRenderer\./g) || []).length, 1);
  assert.equal((src.match(/hq:memory:/g) || []).length, 1, 'no other memory channel in the preload');
});

test('main.js wires it with ONE init line that hands over the main window; IPC-CONTRACT has the row', (t) => {
  const main = read('dashboard/main.js');
  const lines = main.split(/\r?\n/).filter((l) => /require\('\.\/memory-card'\)/.test(l));
  if (!lines.length) return loud(t, 'the memory-card init line in dashboard/main.js');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\.init\(\{[^}]*ipcMain[^}]*getWin: \(\) => win[^}]*dataDir: DATA/);
  const contract = read('docs/sync/IPC-CONTRACT.md');
  const row = contract.split(/\r?\n/).find((l) => l.includes('hq:memory:read'));
  if (!row) return loud(t, 'the hq:memory:read row in docs/sync/IPC-CONTRACT.md');
  assert.match(row, /memory\.read\(\)/);
  assert.match(row, /never file names|no file names|never a (file )?name/i);
});
