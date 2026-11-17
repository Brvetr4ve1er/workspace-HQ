// node --test dashboard/launcher.test.mjs
// The Launcher's main side (launcher.js) over temp folders with FAKE spawn, shell, dialog and drive lookup: nothing opens, no window appears.
// What these prove is the checks and the argument lists; whether Windows Terminal or an editor really takes them is the owner's one real click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as core from './launcher-core.mjs';

const require = createRequire(import.meta.url);
const { create, init, LIMITS } = require('./launcher.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

// the long form of the temp folder: the short 8.3 form (a user folder named with a tilde) is refused by design
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-launcher-')));
const cleanup = (t, d) => t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } });
const fakeCrypto = { encrypt: (s) => Buffer.from('sealed:' + s).toString('base64'), decrypt: (b) => { const t = Buffer.from(b, 'base64').toString(); return t.startsWith('sealed:') ? t.slice(7) : null; } };

function rig(t, o = {}) {
  const root = tmp(); cleanup(t, root);
  const data = path.join(root, 'data'), docs = path.join(root, 'docs'), proj = path.join(root, 'proj a'), local = path.join(root, 'local');
  for (const d of [data, docs, proj]) fs.mkdirSync(d);
  if (o.wt !== false) { fs.mkdirSync(path.join(local, 'Microsoft', 'WindowsApps'), { recursive: true }); fs.writeFileSync(path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe'), ''); }
  const scan = { projects: [{ id: 'proj-a', name: 'Project A', path: proj, dev_cmd: 'npm run dev' }, { id: 'proj-b', name: 'Project B', path: path.join(root, 'gone'), dev_cmd: '' }] };
  const spawns = [], opened = [], externals = [], marks = [], audits = [], devCalls = [];
  const spawn = (file, args, options) => {
    const p = new EventEmitter(); p.pid = 9000 + spawns.length; p.unref = () => {}; spawns.push({ file, args, options });
    if (o.spawnThrows && o.spawnThrows(file)) throw new Error('boom ' + root);
    return p;
  };
  const dialogQueue = [];
  const dialog = { showOpenDialog: async (...a) => { const opts = a[a.length - 1]; dialog.last = opts; const n = dialogQueue.shift(); return n === 'cancel' || n === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [n] }; } };
  const devState = { value: o.devState || 'allowed', start: o.devStart || 'started' };
  const dev = { state: async () => devState.value, start: async (id) => { devCalls.push(id); return devState.start; } };
  let clock = 1_800_000_000_000;
  const shell = { openPath: async (p) => { opened.push(p); return o.openPathMsg || ''; }, openExternal: async (u) => { externals.push(u); } };
  const l = create({
    dataDir: data, documentsRoot: docs, resolveProjectPath: (p) => p, latest: () => scan, dev, shell, dialog, getWin: () => ({}), crypto: o.crypto === null ? { encrypt: () => null, decrypt: () => null } : fakeCrypto,
    useMark: (s, a) => { marks.push([s, a]); return { ok: true }; }, audit: async (f) => { audits.push(f); }, spawn, env: { LOCALAPPDATA: local, SystemRoot: 'C:\\Windows', GITHUB_TOKEN: 'placeholder', Path: 'x' },
    platform: 'win32', now: () => clock, driveType: async () => 'Fixed', ...(o.over || {}),
  });
  const mk = (rel, body = '') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
  const addVia = async (kind, p) => { dialogQueue.push(p); return l.add({ kind }); };
  return { root, data, docs, proj, local, scan, spawns, opened, externals, marks, audits, devCalls, dev, devState, dialog, dialogQueue, l, mk, addVia, tick: (ms) => { clock += ms; } };
}

test('read on a fresh start: nothing listed, the projects and their dev state, not locked', async (t) => {
  const r = rig(t);
  const out = await r.l.read();
  assert.deepEqual(out.entries, []);
  assert.equal(out.editor, null);
  assert.equal(out.locked, false);
  assert.deepEqual(out.projects.map((p) => [p.id, p.name, p.dev]), [['proj-a', 'Project A', 'allowed'], ['proj-b', 'Project B', 'allowed']]);
  assert.equal(out.terminal, 'wt');
});

test('add: the dialog opens at the Documents root with the right kind of picker, and an added entry comes back by name, never by path', async (t) => {
  const r = rig(t);
  const doc = r.mk('files/Plan A.pdf'), app = r.mk('tools/edit.exe'), folder = path.join(r.root, 'files');
  assert.deepEqual((await r.addVia('file', doc)).state, 'added');
  assert.equal(r.dialog.last.defaultPath, r.docs);
  assert.deepEqual(r.dialog.last.properties, ['openFile']);
  assert.equal((await r.addVia('folder', folder)).state, 'added');
  assert.deepEqual(r.dialog.last.properties, ['openDirectory']);
  assert.equal((await r.addVia('app', app)).state, 'added');
  assert.deepEqual(r.dialog.last.filters, [{ name: 'Programs', extensions: ['exe'] }]);
  const out = await r.l.read();
  assert.deepEqual(out.entries.map((e) => [e.kind, e.name]), [['file', 'Plan A.pdf'], ['folder', 'files'], ['app', 'edit']]);
  assert.ok(!JSON.stringify(out).includes(r.root), 'no path in the answer');
  assert.ok(!JSON.stringify(out).includes('sig'));
});

test('add: cancel stores nothing; the same pick twice answers exists; unknown kind and a bad argument are refused', async (t) => {
  const r = rig(t);
  assert.equal((await r.l.add({ kind: 'folder' })).state, 'cancelled');
  assert.equal((await r.l.add({ kind: 'folder' })).state, 'cancelled');
  assert.equal((await r.l.add({ kind: 'script' })).state, 'refused');
  assert.equal((await r.l.add(null)).state, 'refused');
  assert.equal((await r.l.add({})).state, 'refused');
  assert.equal(fs.existsSync(path.join(r.data, 'launcher', 'entries.json')), false);
  const doc = r.mk('a.txt');
  const first = await r.addVia('file', doc);
  const again = await r.addVia('file', doc.toUpperCase());
  assert.equal(again.state, 'exists');
  assert.equal(again.id, first.id);
  assert.equal((await r.l.read()).entries.length, 1);
});

test('add refuses what the rules refuse, each with a fixed sentence and nothing stored', async (t) => {
  const r = rig(t);
  const refused = async (kind, p) => { const a = await r.addVia(kind, p); assert.equal(a.state, 'refused', kind + ' ' + path.basename(p)); assert.ok(Object.values(core.WHY).includes(a.why), 'a fixed sentence'); return a; };
  await refused('file', r.mk('x/run.exe'));
  await refused('file', r.mk('x/run.bat'));
  await refused('file', r.mk('x/run.ps1'));
  await refused('file', r.mk('x/odd.xyz'));
  await refused('app', r.mk('x/run.bat'));
  await refused('app', r.mk('x/cmd.exe'));
  await refused('app', r.mk('x/PowerShell.EXE'));
  await refused('app', path.join(r.root, 'nothing', 'here.exe'));
  await refused('file', '\\\\host\\share\\a.pdf');
  await refused('file', 'relative\\a.pdf');
  assert.equal((await r.l.read()).entries.length, 0);
});

test('add refuses a folder reached through a junction (the real path differs)', async (t) => {
  const r = rig(t);
  const real = path.join(r.root, 'real'); fs.mkdirSync(real);
  const link = path.join(r.root, 'link');
  try { fs.symlinkSync(real, link, 'junction'); } catch { return t.skip('no junction here'); }
  assert.equal((await r.addVia('folder', link)).state, 'refused');
  assert.equal((await r.addVia('folder', real)).state, 'added');
});

test('add refuses a drive the system does not call fixed', async (t) => {
  const r = rig(t, { over: { driveType: async () => 'Removable' } });
  const a = await r.addVia('folder', r.proj);
  assert.equal(a.state, 'refused');
  assert.equal(a.why, core.WHY.drive);
});

test('a link entry is read from an internet shortcut: first URL= line, https or loopback only, the card shows the host', async (t) => {
  const r = rig(t);
  const good = r.mk('links/Docs.url', '[InternetShortcut]\r\nURL=https://docs.example.org/secret/page?x=1\r\n');
  assert.equal((await r.addVia('url', good)).state, 'added');
  assert.deepEqual(r.dialog.last.filters, [{ name: 'Internet shortcuts', extensions: ['url'] }]);
  const out = await r.l.read();
  assert.deepEqual(out.entries.map((e) => [e.kind, e.name, e.host]), [['url', 'docs.example.org', 'docs.example.org']]);
  assert.ok(!JSON.stringify(out).includes('secret'));
  for (const [name, body] of [['plain.url', '[InternetShortcut]\r\nURL=http://example.org/\r\n'], ['login.url', 'URL=https://user:pw@example.org/\n'], ['none.url', '[InternetShortcut]\n'], ['file.url', 'URL=file:///C:/a\n'], ['js.url', 'URL=javascript:alert(1)\n'], ['big.url', 'x'.repeat(5000) + '\nURL=https://example.org\n']]) {
    assert.equal((await r.addVia('url', r.mk('links/' + name, body))).state, 'refused', name);
  }
  assert.equal((await r.addVia('url', r.mk('links/notashortcut.txt', 'URL=https://example.org'))).state, 'refused');
  assert.equal((await r.l.read()).entries.length, 1);
});

test('the list is capped at 40', async (t) => {
  const r = rig(t);
  for (let i = 0; i < 40; i++) { if (i && i % 15 === 0) r.tick(3600e3 + 1); assert.equal((await r.addVia('file', r.mk(`d/f${i}.txt`))).state, 'added'); }
  r.tick(3600e3 + 1);
  assert.equal((await r.addVia('file', r.mk('d/over.txt'))).state, 'full');
  assert.equal((await r.l.read()).entries.length, 40);
});

test('limits: 20 adds an hour, 30 removes, 10 set-editor, 30 opens, 10 workspaces; the hour rolls', async (t) => {
  const r = rig(t);
  for (let i = 0; i < LIMITS.add; i++) assert.equal((await r.l.add({ kind: 'file' })).state, 'cancelled');
  assert.equal((await r.l.add({ kind: 'file' })).state, 'busy');
  r.tick(3600e3 + 1);
  assert.equal((await r.l.add({ kind: 'file' })).state, 'cancelled');
  for (let i = 0; i < LIMITS.remove; i++) assert.equal((await r.l.remove({ id: 'aaaaaaaa' })).state, 'unknown');
  assert.equal((await r.l.remove({ id: 'aaaaaaaa' })).state, 'busy');
  for (let i = 0; i < LIMITS.setEditor; i++) assert.equal((await r.l.setEditor({ id: 'aaaaaaaa' })).state, 'unknown');
  assert.equal((await r.l.setEditor({ id: 'aaaaaaaa' })).state, 'busy');
  for (let i = 0; i < LIMITS.open; i++) assert.equal((await r.l.open({ id: 'aaaaaaaa' })).state, 'unknown');
  assert.equal((await r.l.open({ id: 'aaaaaaaa' })).state, 'busy');
  for (let i = 0; i < LIMITS.workspace; i++) assert.equal((await r.l.openWorkspace({ projectId: 'proj-a' })).ok, true);
  assert.equal((await r.l.openWorkspace({ projectId: 'proj-a' })).state, 'busy');
});

test('an id that is not 8 to 16 lowercase letters or digits is refused before anything is read', async (t) => {
  const r = rig(t);
  for (const id of ['', 'ABCDEFGH', 'short', '../../etc/passwd', 'a'.repeat(17), 5, null, undefined, { x: 1 }]) {
    assert.equal((await r.l.remove({ id })).state, 'refused');
    assert.equal((await r.l.setEditor({ id })).state, 'refused');
    assert.equal((await r.l.open({ id })).state, 'refused');
  }
  assert.equal(r.spawns.length, 0);
});

test('remove drops the entry (and the editor with it); set-editor takes only an existing app entry', async (t) => {
  const r = rig(t);
  const app = await r.addVia('app', r.mk('tools/edit.exe'));
  const doc = await r.addVia('file', r.mk('a.txt'));
  assert.equal((await r.l.setEditor({ id: doc.id })).state, 'refused');
  assert.equal((await r.l.setEditor({ id: 'zzzzzzzz' })).state, 'unknown');
  assert.equal((await r.l.setEditor({ id: app.id })).state, 'set');
  assert.equal((await r.l.read()).editor, app.id);
  assert.equal((await r.l.remove({ id: app.id })).state, 'removed');
  const out = await r.l.read();
  assert.equal(out.editor, null);
  assert.equal(out.entries.length, 1);
});

test('entries that were edited by hand, unsigned, or point at something now refused are dropped on read', async (t) => {
  const r = rig(t);
  const doc = await r.addVia('file', r.mk('a.txt'));
  await r.addVia('file', r.mk('b.txt'));
  const file = path.join(r.data, 'launcher', 'entries.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.entries[0].path = r.mk('evil.exe');           // changed path: the signature no longer fits
  raw.entries.push({ id: 'deadbeef1234', kind: 'app', path: path.join(r.root, 'tools', 'x.exe'), name: 'x', addedAt: 'now' });   // never signed
  fs.writeFileSync(file, JSON.stringify(raw));
  const out = await r.l.read();
  assert.deepEqual(out.entries.map((e) => e.name), ['b.txt']);
  assert.notEqual(out.entries[0].id, doc.id);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual((await r.l.read()).entries, []);
});

test('without a key from the system the launcher is locked: nothing is added, nothing is shown', async (t) => {
  const r = rig(t, { crypto: null });
  const a = await r.addVia('folder', r.proj);
  assert.equal(a.state, 'locked');
  const out = await r.l.read();
  assert.equal(out.locked, true);
  assert.deepEqual(out.entries, []);
  assert.equal(fs.existsSync(path.join(r.data, 'launcher', 'entries.json')), false);
  assert.equal((await r.l.open({ id: 'aaaaaaaa' })).state, 'unknown');
});

test('a key that no longer opens is not replaced: the list reads as locked and old entries stay on disk', async (t) => {
  const r = rig(t);
  await r.addVia('file', r.mk('a.txt'));
  const key = path.join(r.data, 'launcher', 'key.json');
  fs.writeFileSync(key, JSON.stringify({ v: 1, key: 'enc:' + Buffer.from('garbage').toString('base64') }));
  const out = await r.l.read();
  assert.equal(out.locked, true);
  assert.ok(fs.readFileSync(key, 'utf8').includes(Buffer.from('garbage').toString('base64')), 'the old key file is left alone');
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.data, 'launcher', 'entries.json'), 'utf8')).entries.length, 1);
});

test('open: a file or folder goes to the system opener, a link to openExternal, an app is a bare spawn with no arguments and no shell', async (t) => {
  const r = rig(t);
  const doc = r.mk('a.pdf'), app = r.mk('tools/edit.exe');
  const f = await r.addVia('file', doc), fo = await r.addVia('folder', r.proj), a = await r.addVia('app', app);
  const u = await r.addVia('url', r.mk('l.url', 'URL=https://docs.example.org/x\n'));
  for (const e of [f, fo, a, u]) assert.equal((await r.l.open({ id: e.id })).state, 'opened');
  assert.deepEqual(r.opened, [doc, r.proj]);
  assert.deepEqual(r.externals, ['https://docs.example.org/x']);
  assert.equal(r.spawns.length, 1);
  assert.equal(r.spawns[0].file, app);
  assert.deepEqual(r.spawns[0].args, []);
  assert.equal(r.spawns[0].options.shell, false);
  assert.equal(r.spawns[0].options.stdio, 'ignore');
  assert.equal(r.spawns[0].options.env.GITHUB_TOKEN, undefined, 'no token reaches the program');
  assert.equal(r.spawns[0].options.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(r.marks.length, 0, 'an entry open writes no workspace mark');
});

test('open re-checks the disk: a missing file is "missing", a folder swapped for a junction or a file turned into a folder is refused, nothing opens', async (t) => {
  const r = rig(t);
  const doc = r.mk('a.pdf');
  const fo = path.join(r.root, 'swap'); fs.mkdirSync(fo);
  const e1 = await r.addVia('file', doc), e2 = await r.addVia('folder', fo), e3 = await r.addVia('file', r.mk('c.pdf'));
  fs.rmSync(doc);
  assert.equal((await r.l.open({ id: e1.id })).state, 'missing');
  fs.rmSync(fo, { recursive: true });
  const real = path.join(r.root, 'real2'); fs.mkdirSync(real);
  let junction = true;
  try { fs.symlinkSync(real, fo, 'junction'); } catch { junction = false; }
  if (junction) assert.equal((await r.l.open({ id: e2.id })).state, 'refused');
  fs.rmSync(path.join(r.root, 'c.pdf'));
  fs.mkdirSync(path.join(r.root, 'c.pdf'));
  assert.equal((await r.l.open({ id: e3.id })).state, 'refused');
  assert.deepEqual(r.opened, []);
  assert.equal(r.spawns.length, 0);
});

test('open: a failing opener or spawn answers failed; two opens at once, the second is busy', async (t) => {
  const r = rig(t, { openPathMsg: 'no handler' });
  const e = await r.addVia('file', r.mk('a.pdf'));
  assert.equal((await r.l.open({ id: e.id })).state, 'failed');
  let release;
  const slow = new Promise((res) => { release = res; });
  const r3 = rig(t, { over: { shell: { openPath: () => slow.then(() => ''), openExternal: async () => {} } } });
  const g = await r3.addVia('file', r3.mk('a.pdf'));
  const first = r3.l.open({ id: g.id });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal((await r3.l.open({ id: g.id })).state, 'busy');
  release();
  assert.equal((await first).state, 'opened');
});

// ---- Open workspace --------------------------------------------------------------------------------------

async function withEditor(r) { const a = await r.addVia('app', r.mk('tools/Editor/edit.exe')); await r.l.setEditor({ id: a.id }); return a; }

test('Open workspace runs dev, editor, terminal in that order: the editor gets [exe, folder], the terminal wt.exe -d folder, no shell, one act mark', async (t) => {
  const r = rig(t);
  const ed = await withEditor(r);
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.steps, [{ step: 'dev', state: 'started' }, { step: 'editor', state: 'opened' }, { step: 'terminal', state: 'opened' }]);
  assert.equal(out.line, 'Dev server: started. Editor: opened. Terminal: opened.');
  assert.deepEqual(r.devCalls, ['proj-a']);
  assert.equal(r.spawns.length, 2);
  assert.deepEqual([r.spawns[0].file, r.spawns[0].args], [path.join(r.root, 'tools', 'Editor', 'edit.exe'), [r.proj]]);
  assert.deepEqual([r.spawns[1].file, r.spawns[1].args], [path.join(r.local, 'Microsoft', 'WindowsApps', 'wt.exe'), ['-d', r.proj]]);
  for (const s of r.spawns) { assert.equal(s.options.shell, false); assert.equal(s.options.cwd, r.proj); assert.equal(s.options.stdio, 'ignore'); }
  assert.deepEqual(r.marks, [['launcher-workspace', 'act']]);
  assert.ok(ed);
});

test('a repeat click reuses the running dev server, reopens the editor and opens a new terminal window; the mark follows the editor', async (t) => {
  const r = rig(t, { devStart: 'running' });
  await withEditor(r);
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.deepEqual(out.steps.map((s) => s.state), ['running', 'opened', 'opened']);
  assert.match(out.line, /^Dev server: already running\./);
  assert.equal(r.spawns.length, 2);
  assert.equal(r.marks.length, 1);
});

test('no editor chosen: the line says so and the terminal still opens; a terminal-only launch writes no act mark', async (t) => {
  const r = rig(t, { devState: 'unconfirmed', devStart: 'unconfirmed' });
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.deepEqual(out.steps, [{ step: 'dev', state: 'unconfirmed' }, { step: 'editor', state: 'none' }, { step: 'terminal', state: 'opened' }]);
  assert.equal(out.line, 'Dev server: not allowed yet. Editor: none chosen. Pick one in Launcher. Terminal: opened.');
  assert.equal(out.ok, true);
  assert.equal(r.marks.length, 0);
  assert.equal(r.spawns.length, 1);
});

test('a project with no scanned command skips the dev step; a refused command says so; a busy dev says so', async (t) => {
  const none = rig(t, { devState: 'none' });
  assert.equal((await none.l.openWorkspace({ projectId: 'proj-a' })).steps[0].state, 'none');
  assert.deepEqual(none.devCalls, []);
  const refused = rig(t, { devState: 'refused', devStart: 'refused' });
  const out = await refused.l.openWorkspace({ projectId: 'proj-a' });
  assert.equal(out.steps[0].state, 'refused');
  assert.match(out.line, /^Dev server: can't run this command\./);
  const busy = rig(t, { devStart: 'busy' });
  assert.equal((await busy.l.openWorkspace({ projectId: 'proj-a' })).steps[0].state, 'busy');
});

test('a failed step never stops the next one: the editor spawn throws, the terminal still opens', async (t) => {
  const r = rig(t, { spawnThrows: (file) => /edit\.exe$/i.test(file) });
  await withEditor(r);
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.deepEqual(out.steps.map((s) => s.state), ['started', 'failed', 'opened']);
  assert.equal(out.line, "Dev server: started. Editor: didn't open. Terminal: opened.");
  assert.ok(!JSON.stringify(out).includes(r.root), 'no path or error text in the answer');
  assert.equal(r.marks.length, 1, 'the dev server really started');
});

test('an editor swapped on disk after it was chosen does not run', async (t) => {
  const r = rig(t);
  await withEditor(r);
  const exe = path.join(r.root, 'tools', 'Editor', 'edit.exe');
  fs.rmSync(exe); fs.mkdirSync(exe);
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.equal(out.steps[1].state, 'failed');
  assert.equal(r.spawns.filter((s) => s.file === exe).length, 0);
});

test('a folder name with a semicolon skips only the terminal; the editor still gets the folder', async (t) => {
  const r = rig(t);
  const odd = path.join(r.root, 'semi;colon'); fs.mkdirSync(odd);
  r.scan.projects.push({ id: 'proj-c', name: 'Project C', path: odd, dev_cmd: 'npm run dev' });
  await withEditor(r);
  const out = await r.l.openWorkspace({ projectId: 'proj-c' });
  assert.deepEqual(out.steps.map((s) => s.state), ['started', 'opened', 'skipped']);
  assert.match(out.line, /Terminal: skipped, the folder name has a symbol Windows Terminal can't take\.$/);
  assert.deepEqual(r.spawns.map((s) => s.args), [[odd]]);
});

test('without Windows Terminal the console opens with the folder as its working directory, never from the PATH or the folder', async (t) => {
  const r = rig(t, { wt: false });
  const out = await r.l.openWorkspace({ projectId: 'proj-a' });
  assert.equal(out.steps[2].state, 'opened');
  assert.equal(r.spawns.length, 1);
  assert.equal(r.spawns[0].file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(r.spawns[0].args, []);
  assert.equal(r.spawns[0].options.cwd, r.proj);
  assert.equal((await r.l.read()).terminal, 'console');
});

test('a project whose folder is gone, unknown, or reached through a junction: "Folder not found: rescan", all three skipped, nothing spawned', async (t) => {
  const r = rig(t);
  const real = path.join(r.root, 'real'); fs.mkdirSync(real);
  const link = path.join(r.root, 'link');
  let junction = true;
  try { fs.symlinkSync(real, link, 'junction'); } catch { junction = false; }
  r.scan.projects.push({ id: 'proj-d', name: 'Project D', path: link, dev_cmd: 'npm run dev' });
  const ids = ['proj-b', 'nope', ...(junction ? ['proj-d'] : [])];
  for (const projectId of ids) {
    const out = await r.l.openWorkspace({ projectId });
    assert.equal(out.ok, false, projectId);
    assert.equal(out.line, 'Folder not found: rescan');
    assert.deepEqual(out.steps.map((s) => s.state), ['skipped', 'skipped', 'skipped']);
  }
  assert.equal(r.spawns.length, 0);
  assert.equal(r.devCalls.length, 0);
  assert.equal(r.marks.length, 0);
});

test('a project id that is not a plain id is refused before the scan is read', async (t) => {
  const r = rig(t);
  for (const projectId of ['', '../x', 'a b', 'a'.repeat(65), 5, null]) assert.equal((await r.l.openWorkspace({ projectId })).state, 'refused');
  assert.equal((await r.l.openWorkspace(null)).state, 'refused');
  assert.equal(r.spawns.length, 0);
});

test('one audit line per call, names only: tool, door app, tier run, fixed step words, no path', async (t) => {
  const r = rig(t);
  await withEditor(r);
  const e = await r.addVia('file', r.mk('a.pdf'));
  await r.l.openWorkspace({ projectId: 'proj-a' });
  await r.l.openWorkspace({ projectId: 'proj-b' });
  await r.l.open({ id: e.id });
  assert.equal(r.audits.length, 3);
  assert.deepEqual(r.audits.map((a) => [a.tool, a.door, a.tier]), [['launcher_workspace', 'app', 'run'], ['launcher_workspace', 'app', 'run'], ['launcher_open', 'app', 'run']]);
  assert.equal(r.audits[0].reason, 'dev:started editor:opened terminal:opened');
  assert.equal(r.audits[1].reason, 'folder:missing');
  assert.equal(r.audits[2].reason, 'file:opened');
  assert.ok(!JSON.stringify(r.audits).includes(r.root));
  assert.ok(!JSON.stringify(r.audits).includes('proj'));
});

test('the real audit writer takes the line and keeps it names only', async (t) => {
  const r = rig(t, { over: { audit: undefined } });
  await withEditor(r);
  await r.l.openWorkspace({ projectId: 'proj-a' });
  const text = fs.readFileSync(path.join(r.data, 'assistant-audit.jsonl'), 'utf8');
  const line = JSON.parse(text.trim().split('\n').pop());
  assert.equal(line.door, 'app');
  assert.equal(line.tool, 'launcher_workspace');
  assert.ok(!text.includes(r.root));
});

test('two Open workspace calls at once: the second is busy and spawns nothing more', async (t) => {
  let release;
  const slow = new Promise((res) => { release = res; });
  const r = rig(t);
  r.dev.start = async () => { await slow; return 'started'; };
  const first = r.l.openWorkspace({ projectId: 'proj-a' });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal((await r.l.openWorkspace({ projectId: 'proj-a' })).state, 'busy');
  assert.equal((await r.l.open({ id: 'aaaaaaaa' })).state, 'busy');
  release();
  assert.equal((await first).ok, true);
});

// ---- the doors -------------------------------------------------------------------------------------------

function ipcRig(t, over = {}) {
  const r = rig(t);
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { processId: 1, routingId: 1, url: 'file:///app/index.html' } } };
  const good = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const l = init({ ipcMain, getWin: () => win, dataDir: r.data, documentsRoot: r.docs, resolveProjectPath: (p) => p, latest: () => r.scan, dev: r.dev, shell: { openPath: async () => '', openExternal: async () => {} }, dialog: r.dialog,
    crypto: fakeCrypto, useMark: () => ({}), audit: async () => {}, spawn: () => ({ on() {}, unref() {} }), env: { LOCALAPPDATA: r.local }, platform: 'win32', driveType: async () => 'Fixed', ...over });
  return { r, handlers, good, win, l };
}

test('six channels, main window only: another sender, a subframe or an outside address gets a refusal and nothing runs', async (t) => {
  const { r, handlers, good, win } = ipcRig(t);
  assert.deepEqual([...handlers.keys()].sort(), ['hq:launcher:add', 'hq:launcher:open', 'hq:launcher:open-workspace', 'hq:launcher:read', 'hq:launcher:remove', 'hq:launcher:set-editor']);
  const other = { sender: {}, senderFrame: win.webContents.mainFrame };
  const sub = { sender: win.webContents, senderFrame: { processId: 1, routingId: 2, url: 'file:///app/index.html' } };
  const web = { sender: win.webContents, senderFrame: { processId: 1, routingId: 1, url: 'https://example.org/' } };
  for (const ev of [other, sub, web, null, {}]) {
    assert.ok(handlers.get('hq:launcher:read')(ev).then ? (await handlers.get('hq:launcher:read')(ev)).error : true);
    assert.equal((await handlers.get('hq:launcher:add')(ev, { kind: 'file' })).state, 'refused');
    assert.equal((await handlers.get('hq:launcher:remove')(ev, { id: 'aaaaaaaa' })).state, 'refused');
    assert.equal((await handlers.get('hq:launcher:set-editor')(ev, { id: 'aaaaaaaa' })).state, 'refused');
    assert.equal((await handlers.get('hq:launcher:open')(ev, { id: 'aaaaaaaa' })).state, 'refused');
    assert.equal((await handlers.get('hq:launcher:open-workspace')(ev, { projectId: 'proj-a' })).state, 'refused');
  }
  assert.equal(r.devCalls.length, 0);
  const read = await handlers.get('hq:launcher:read')(good);
  assert.ok(Array.isArray(read.entries));
  assert.equal((await handlers.get('hq:launcher:open-workspace')(good, 'not an object')).state, 'refused');
  assert.equal((await handlers.get('hq:launcher:add')(good, 'not an object')).state, 'refused');
});

test('no launcher source spawns with a shell, builds a command string, or reads the real home', () => {
  for (const f of ['launcher.js', 'launcher-core.mjs']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!/shell:\s*true/.test(src), f + ' never asks for a shell');
    assert.ok(!/(?<![.\w])exec\(|\bexecSync\(|\bspawnSync\(/.test(src), f + ' has no exec or spawnSync');
    assert.ok(!/homedir\(|\.claude|Documents/.test(src.replace(/documentsRoot/g, '').replace(/\/\/.*$/gm, '')), f + ' hard-codes no home or Documents path');
  }
});

test('add: the app dialog starts at the usual install folder when the system names one; every other kind starts at the Documents root', async (t) => {
  const r = rig(t, { over: { env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' } }, wt: false });
  const app = r.mk('tools/edit.exe'), doc = r.mk('files/Plan A.pdf');
  assert.equal((await r.addVia('app', app)).state, 'added');
  assert.equal(r.dialog.last.defaultPath, 'C:\\Program Files');
  assert.equal((await r.addVia('file', doc)).state, 'added');
  assert.equal(r.dialog.last.defaultPath, r.docs);
  const odd = rig(t, { over: { env: { SystemRoot: 'C:\\Windows', ProgramFiles: '\\\\server\\share' } }, wt: false });
  await odd.addVia('app', odd.mk('tools/edit.exe'));
  assert.equal(odd.dialog.last.defaultPath, odd.docs, 'a value that is not a drive path is ignored');
});
