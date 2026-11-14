// node --test dashboard/brief-file.test.mjs
// (temp data dir, repo and phone folder; a fake clock, fake timers, a fake watcher, a fake dialog)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { init, CHANNEL } = require('./brief-file.js');
const FILE = 'workspacehq-brief.txt';

const item = (key, rule, severity, extra) => ({ key, rule, severity, text: 'RAW ' + key, why: 'raw why', source: 'scan', age: 'scan 1 h ago', action: { kind: 'go', tab: 'projects', sub: 'grid', projectId: 'p-' + key }, count: 0, ...extra });

function setup(opts = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brief-file-')));
  const repo = path.join(root, 'repo'), data = path.join(repo, 'data'), phone = path.join(root, 'phone sync');
  for (const d of [data, phone]) fs.mkdirSync(d, { recursive: true });
  const clock = { t: new Date(2026, 10, 14, 9, 0) };
  const handlers = {}, wc = { id: 'main' };
  const timersLog = [], cleared = [];
  let watchCb = null, watchClosed = false, dialogCalls = 0, dialogAnswer = { canceled: false, filePaths: [phone] };
  const timers = {
    setTimeout: (fn, ms) => { const h = { fn, ms, unref() {} }; timersLog.push(h); return h; },
    clearTimeout: (h) => { cleared.push(h); const i = timersLog.indexOf(h); if (i >= 0) timersLog.splice(i, 1); },
    setInterval: () => ({ unref() {} }), clearInterval: () => {},
  };
  const dialog = { showOpenDialog: async () => { dialogCalls++; return typeof dialogAnswer === 'function' ? dialogAnswer() : dialogAnswer; } };
  const api = init({
    ipcMain: { handle: (c, f) => { handlers[c] = f; } }, dialog, getWin: () => ({ webContents: wc, isDestroyed: () => false }),
    dataDir: data, repoRoot: repo, now: () => new Date(clock.t), fsApi: opts.fsApi || fs,
    watchFn: (_d, cb) => { watchCb = cb; return { close() { watchClosed = true; } }; }, timers,
  });
  const ctx = {
    root, repo, data, phone, clock, api, handlers, wc, timersLog, cleared, timers,
    ask: (a, sender = wc) => handlers[CHANNEL]({ sender }, a),
    watch: (name) => watchCb && watchCb('change', name),
    get closed() { return watchClosed; }, get dialogCalls() { return dialogCalls; },
    setDialog: (a) => { dialogAnswer = a; },
    file: () => path.join(phone, FILE),
    text: () => fs.readFileSync(path.join(phone, FILE), 'utf8'),
    exists: () => fs.existsSync(path.join(phone, FILE)),
    state: () => JSON.parse(fs.readFileSync(path.join(data, '.brief-file.json'), 'utf8')),
    writeBrief: (items, extra) => fs.writeFileSync(path.join(data, 'brief.json'), JSON.stringify({ v: 1, generatedAt: new Date(clock.t).toISOString(), items, overflow: [], standing: [], more: 0, errors: [], ...extra })),
    fire: async () => { const hs = timersLog.splice(0); for (const h of hs) h.fn(); await api.check(false); },
    done: () => { api.dispose(); fs.rmSync(root, { recursive: true, force: true }); },
  };
  return ctx;
}
const A = () => [item('dirty:placeholder-a:1', 'dirty', 'low'), item('unpushed:placeholder-b:1', 'unpushed', 'med')];
const B = () => [item('secrets:placeholder-c:1', 'secrets', 'high')];
const minutes = (c, n) => { c.t = new Date(c.t.getTime() + n * 60e3); };

test('the channel name and the module surface', () => {
  assert.equal(CHANNEL, 'hq:reach:brief-file');
  const c = setup();
  try { assert.equal(typeof c.handlers[CHANNEL], 'function'); assert.equal(typeof c.api.act, 'function'); } finally { c.done(); }
});

test('OFF by default: a brief and a watch event write nothing, anywhere, and no state file appears', async () => {
  const c = setup();
  try {
    await c.api.ready;
    c.writeBrief(A());
    c.watch('brief.json');
    await c.fire();
    assert.deepEqual(await c.api.check(true), { skipped: 'off' });
    assert.deepEqual(fs.readdirSync(c.phone), []);
    assert.equal(fs.existsSync(path.join(c.data, '.brief-file.json')), false);
  } finally { c.done(); }
});

test('pick: the folder is saved, the file is written once at once, and the answer is the last segment only', async () => {
  const c = setup();
  try {
    c.writeBrief(A());
    const r = await c.ask('pick');
    assert.deepEqual(r, { ok: true, folderName: 'phone sync', written: true });
    assert.ok(!JSON.stringify(r).includes(c.root), 'a full path in the answer');
    assert.ok(c.exists());
    const text = c.text();
    assert.ok(text.startsWith('WorkspaceHQ brief - 09:00\n'), text);
    assert.ok(text.includes('Needs you - 2'), text);
    const st = c.state();
    assert.equal(st.v, 1); assert.equal(st.folder, c.phone); assert.equal(st.lastWriteAt, new Date(c.clock.t).toISOString()); assert.equal(st.lastError, null);
    assert.deepEqual(fs.readdirSync(c.phone), [FILE], 'no temp file left behind');
  } finally { c.done(); }
});

test('pick with no brief yet saves the folder and says nothing was written', async () => {
  const c = setup();
  try {
    const r = await c.ask('pick');
    assert.deepEqual(r, { ok: true, folderName: 'phone sync', written: false });
    assert.equal(c.exists(), false);
    assert.equal(c.state().folder, c.phone);
    // the file appears when the first brief arrives
    c.writeBrief(A()); c.watch('brief.json'); await c.fire();
    assert.ok(c.exists());
  } finally { c.done(); }
});

test('a brief change rewrites; an unchanged brief within 10 minutes does not; after 10 minutes it does', async () => {
  const c = setup();
  try {
    c.writeBrief(A());
    await c.ask('pick');
    const first = c.text();
    // unchanged brief, 3 minutes later: nothing is rewritten (the time line stays the old one)
    minutes(c.clock, 3);
    assert.deepEqual(await c.api.check(false), { skipped: 'unchanged' });
    assert.equal(c.text(), first);
    // a changed brief: rewritten at once, with the new time
    c.writeBrief(B());
    c.watch('brief.json'); await c.fire();
    const second = c.text();
    assert.notEqual(second, first);
    assert.ok(second.startsWith('WorkspaceHQ brief - 09:03\n'), second);
    assert.ok(second.includes('urgent'), second);
    // unchanged again: 9 minutes later still not, 10 minutes later yes (the time stays true)
    minutes(c.clock, 9);
    assert.deepEqual(await c.api.check(false), { skipped: 'unchanged' });
    assert.equal(c.text(), second);
    minutes(c.clock, 1);
    assert.deepEqual(await c.api.check(false), { wrote: true });
    assert.ok(c.text().startsWith('WorkspaceHQ brief - 09:13\n'), c.text());
    assert.equal(c.text().split('\n').slice(1).join('\n'), second.split('\n').slice(1).join('\n'), 'only the time line differs');
  } finally { c.done(); }
});

test('the write is atomic: the target is only ever replaced by a rename of a complete temp file', async () => {
  const ops = [];
  const wrapped = { ...fs };
  let target = null;
  wrapped.writeFileSync = (p, d, ...r) => { ops.push(['write', path.basename(String(p))]); return fs.writeFileSync(p, d, ...r); };
  wrapped.renameSync = (a, b) => {
    if (path.basename(String(b)) === FILE) {
      const complete = fs.readFileSync(a, 'utf8');
      assert.ok(complete.startsWith('WorkspaceHQ brief - ') && complete.endsWith('\n'), 'a partial temp file');
      if (fs.existsSync(b)) assert.ok(fs.readFileSync(b, 'utf8').endsWith('\n'), 'the old file was already damaged');
      ops.push(['rename', path.basename(String(a)) + ' -> ' + path.basename(String(b))]);
    }
    return fs.renameSync(a, b);
  };
  wrapped.statSync = fs.statSync;
  const c = setup({ fsApi: wrapped });
  try {
    c.writeBrief(A()); await c.ask('pick');
    c.writeBrief(B()); await c.api.check(true);
    const toTarget = ops.filter((o) => o[0] === 'write' && o[1] === FILE);
    assert.equal(toTarget.length, 0, 'the target was written directly: ' + JSON.stringify(ops));
    const renames = ops.filter((o) => o[0] === 'rename');
    assert.equal(renames.length, 2);
    assert.match(renames[0][1], /^\..*workspacehq-brief\.txt\.\d+\.tmp -> workspacehq-brief\.txt$/);
    assert.ok(c.text().includes('urgent'));
    assert.deepEqual(fs.readdirSync(c.phone), [FILE]);
    target = c.text(); assert.ok(target);
  } finally { c.done(); }
});

test('a locked target (the rename fails) falls back to ONE direct write, with no temp file left', async () => {
  const ops = [];
  const wrapped = { ...fs };
  let lock = false;
  wrapped.writeFileSync = (p, d, ...r) => { ops.push(['write', path.basename(String(p))]); return fs.writeFileSync(p, d, ...r); };
  wrapped.renameSync = (a, b) => {
    if (lock && path.basename(String(b)) === FILE) { const e = new Error('locked'); e.code = 'EBUSY'; throw e; }
    return fs.renameSync(a, b);
  };
  const c = setup({ fsApi: wrapped });
  try {
    c.writeBrief(A()); await c.ask('pick');
    ops.length = 0; lock = true;
    c.writeBrief(B());
    assert.deepEqual(await c.api.check(true), { wrote: true });
    assert.equal(ops.filter((o) => o[0] === 'write' && o[1] === FILE).length, 1, 'exactly one direct write: ' + JSON.stringify(ops));
    assert.ok(c.text().includes('urgent'));
    assert.deepEqual(fs.readdirSync(c.phone), [FILE]);
    assert.equal(c.state().lastError, null);
  } finally { c.done(); }
});

test('clear: writing stops, the old file stays, and the answer says so', async () => {
  const c = setup();
  try {
    c.writeBrief(A()); await c.ask('pick');
    const before = c.text();
    const r = await c.ask('clear');
    assert.equal(r.ok, true); assert.equal(r.folderName, null); assert.equal(r.fileLeft, true);
    assert.match(r.note, /file already written stays/);
    assert.ok(!JSON.stringify(r).includes(c.root));
    assert.equal(c.state().folder, null);
    c.writeBrief(B()); c.watch('brief.json'); await c.fire();
    assert.deepEqual(await c.api.check(true), { skipped: 'off' });
    assert.equal(c.text(), before, 'the file was touched after Turn off');
    // clearing again, or clearing before anything was ever written, is honest too
    const again = await c.ask('clear');
    assert.equal(again.ok, true); assert.equal(again.fileLeft, false); assert.equal(again.note, 'Turned off.');
  } finally { c.done(); }
});

test('a folder that became a repo path is refused on the next write, and nothing lands in the repo', async () => {
  const c = setup();
  try {
    c.writeBrief(A()); await c.ask('pick');
    const inRepo = path.join(c.repo, 'docs'); fs.mkdirSync(inRepo);
    fs.writeFileSync(path.join(c.data, '.brief-file.json'), JSON.stringify({ v: 1, folder: inRepo, lastWriteAt: null, lastError: null }));
    c.writeBrief(B());
    const r = await c.api.check(true);
    assert.match(r.error, /outside the WorkspaceHQ project/);
    assert.deepEqual(fs.readdirSync(inRepo), [], 'a file was written inside the repo');
    assert.match(c.state().lastError, /outside the WorkspaceHQ project/);
  } finally { c.done(); }
});

test('a folder that has vanished is refused, said in words, and retried later', async () => {
  const c = setup();
  try {
    c.writeBrief(A()); await c.ask('pick');
    fs.rmSync(c.phone, { recursive: true, force: true });
    c.writeBrief(B());
    const r = await c.api.check(true);
    assert.match(r.error, /does not exist/);
    assert.match(c.state().lastError, /does not exist/);
    fs.mkdirSync(c.phone);
    assert.deepEqual(await c.api.check(false), { wrote: true }, 'it tries again once the folder is back, even though the text is unchanged');
    assert.equal(c.state().lastError, null);
  } finally { c.done(); }
});

test('a failing disk keeps the last file, sets lastError with no path, never throws, and recovers', async () => {
  let broken = false;
  const wrapped = { ...fs };
  wrapped.writeFileSync = (p, ...r) => { if (broken && String(p).includes('phone sync')) { const e = new Error('disk gone: ' + p); e.code = 'EIO'; throw e; } return fs.writeFileSync(p, ...r); };
  const c = setup({ fsApi: wrapped });
  try {
    c.writeBrief(A()); await c.ask('pick');
    const good = c.text();
    broken = true; c.writeBrief(B());
    const r = await c.api.check(true);
    assert.deepEqual(r, { error: 'could not write the file (EIO)' });
    assert.equal(c.text(), good, 'the last file was damaged');
    assert.deepEqual(fs.readdirSync(c.phone), [FILE]);
    assert.equal(c.state().lastError, 'could not write the file (EIO)');
    assert.ok(!c.state().lastError.includes(c.root));
    assert.ok(c.state().lastWriteAt, 'lastWriteAt keeps the last good write');
    broken = false;
    assert.deepEqual(await c.api.check(false), { wrote: true });
    assert.equal(c.state().lastError, null);
    assert.ok(c.text().includes('urgent'));
  } finally { c.done(); }
});

test('a failing first write on pick is said, and the folder stays saved', async () => {
  const wrapped = { ...fs };
  wrapped.writeFileSync = (p, ...r) => { if (String(p).includes('phone sync')) { const e = new Error('x'); e.code = 'EACCES'; throw e; } return fs.writeFileSync(p, ...r); };
  const c = setup({ fsApi: wrapped });
  try {
    c.writeBrief(A());
    const r = await c.ask('pick');
    assert.match(r.error, /first write failed: could not write the file \(EACCES\)/);
    assert.equal(c.state().folder, c.phone);
  } finally { c.done(); }
});

test('only "pick" and "clear" are accepted, and only from the main window', async () => {
  const c = setup();
  try {
    for (const bad of ['write', 'PICK', 'pick ', '', null, undefined, 5, { action: 'pick' }, ['pick'], '../clear']) {
      assert.deepEqual(await c.ask(bad), { error: 'Unknown action' }, JSON.stringify(bad));
    }
    assert.equal(c.dialogCalls, 0);
    assert.deepEqual(await c.ask('pick', { id: 'someone else' }), { error: 'Not allowed from this window' });
    assert.deepEqual(await c.ask('pick', null), { error: 'Not allowed from this window' });
    assert.equal(c.dialogCalls, 0, 'the dialog opened for a window that is not the main one');
    assert.equal(fs.existsSync(path.join(c.data, '.brief-file.json')), false);
  } finally { c.done(); }
});

test('a cancelled dialog, a repo folder and a file picked as a folder change nothing', async () => {
  const c = setup();
  try {
    c.setDialog({ canceled: true, filePaths: [] });
    assert.deepEqual(await c.ask('pick'), { error: 'No folder was picked', canceled: true });
    c.setDialog({ canceled: false, filePaths: [c.data] });
    assert.match((await c.ask('pick')).error, /outside the WorkspaceHQ project/);
    const f = path.join(c.phone, 'a.txt'); fs.writeFileSync(f, 'x');
    c.setDialog({ canceled: false, filePaths: [f] });
    assert.match((await c.ask('pick')).error, /not a folder/);
    c.setDialog({ canceled: false, filePaths: [] });
    assert.equal((await c.ask('pick')).canceled, true);
    assert.equal(fs.existsSync(path.join(c.data, '.brief-file.json')), false);
    assert.deepEqual(fs.readdirSync(c.phone), ['a.txt']);
  } finally { c.done(); }
});

test('a second pick while the folder window is open is refused', async () => {
  const c = setup();
  try {
    let release;
    c.setDialog(() => new Promise((res) => { release = () => res({ canceled: true, filePaths: [] }); }));
    const first = c.ask('pick');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(await c.ask('pick'), { error: 'A folder window is already open' });
    release();
    assert.equal((await first).canceled, true);
  } finally { c.done(); }
});

test('the watcher: only brief.json schedules a check, debounced by 2 s, a second event restarts the wait', async () => {
  const c = setup();
  try {
    await c.api.ready;
    c.timersLog.length = 0; c.cleared.length = 0;
    c.watch('latest.json'); c.watch('brief.json.123.tmp'); c.watch('money');
    assert.equal(c.timersLog.length, 0, 'an unrelated file scheduled a check');
    c.watch('brief.json');
    assert.equal(c.timersLog.length, 1); assert.equal(c.timersLog[0].ms, 2000);
    const h1 = c.timersLog[0];
    c.watch('brief.json');
    assert.equal(c.timersLog.length, 1, 'the earlier wait was replaced, not stacked'); assert.ok(c.cleared.includes(h1), 'the first wait was cancelled'); assert.notEqual(c.timersLog[0], h1);
    c.watch(null);
    assert.equal(c.timersLog.length, 1);
    c.api.dispose();
    assert.equal(c.closed, true);
  } finally { c.done(); }
});

test('no brief.json: nothing is written, the file already there stays, and it is not an error', async () => {
  const c = setup();
  try {
    c.writeBrief(A()); await c.ask('pick');
    const before = c.text();
    fs.unlinkSync(path.join(c.data, 'brief.json'));
    assert.deepEqual(await c.api.check(true), { skipped: 'no-brief' });
    assert.equal(c.text(), before);
    assert.equal(c.state().lastError, null);
    fs.writeFileSync(path.join(c.data, 'brief.json'), '{ not json');
    assert.deepEqual(await c.api.check(true), { skipped: 'no-brief' });
  } finally { c.done(); }
});

test('a state file that cannot be read means off, never a write', async () => {
  const c = setup();
  try {
    c.writeBrief(A());
    fs.writeFileSync(path.join(c.data, '.brief-file.json'), '{ broken');
    assert.deepEqual(await c.api.check(true), { skipped: 'off' });
    fs.writeFileSync(path.join(c.data, '.brief-file.json'), JSON.stringify({ v: 1, folder: 'relative/path', lastWriteAt: null, lastError: null }));
    assert.deepEqual(await c.api.check(true), { skipped: 'off' });
    assert.deepEqual(fs.readdirSync(c.phone), []);
  } finally { c.done(); }
});

test('privacy: a hostile raw brief never reaches the file on disk', async () => {
  const c = setup();
  try {
    c.writeBrief([item('secrets:Zebra-Project:C:/Users/someone/zebra', 'secrets', 'high', { text: 'Zebra-Project holds 1,200 DA of secrets', why: 'C:\\Users\\someone\\zebra', count: 1 }), item('zz-unknown:Acme:1', 'zz-unknown', 'med', { text: 'Pay Acme-Client 4,500 DA' })],
      { errors: [{ source: 'scan', error: 'C:\\Users\\someone\\Zebra\\.env unreadable' }] });
    await c.ask('pick');
    const t = c.text();
    for (const bad of ['Zebra', 'Acme', 'someone', 'C:', '1,200', '4,500', 'DA', 'zz-unknown', 'secrets:', 'grid']) assert.ok(!t.includes(bad), 'leaked ' + bad + ':\n' + t);
    assert.doesNotMatch(t, /[0-9a-f]{12}|[\\/]/);
    assert.ok(t.length <= 600);
  } finally { c.done(); }
});

test('a stale brief on disk is written as "out of date" with no items', async () => {
  const c = setup();
  try {
    c.writeBrief(A(), { generatedAt: new Date(2026, 10, 14, 7, 0).toISOString() });
    await c.ask('pick');
    const t = c.text();
    assert.match(t, /Brief out of date - last updated 2 h ago/);
    assert.ok(!/urgent|soon|when you can/.test(t));
  } finally { c.done(); }
});

test('init never throws without a window, a dialog or a folder, and dispose is safe twice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-file-bare-'));
  try {
    const api = init({ ipcMain: { handle() {} }, dataDir: root, repoRoot: root, watch: false, timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
    api.dispose(); api.dispose();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
