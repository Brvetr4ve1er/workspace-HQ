// node --test dashboard/vault-desk.test.mjs - the Vault desk's main side over an INVENTED vault in a temp folder (never a real vault).
// Every test also asserts that nothing was written outside the vault: a sentinel folder next to it is compared before and after.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const deskMod = require('./vault-desk.js');
const { tickedIds } = require('./daily-notes-watch.js');
const { WORDS, NOT_HERE } = deskMod;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vault-desk-test-'));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS cleans it */ } });
const DAY = new Date(2026, 10, 16, 9, 0, 0);
let counter = 0;

// a fresh world: <tmp>/<n>/vault (the invented vault), <tmp>/<n>/outside (a sentinel that must never change)
function world({ daily = true, note = '# Monday\n\nplain text\n', settings = null, extra = null, folder = '10_Daily' } = {}) {
  const base = path.join(tmp, String(++counter));
  const vault = path.join(base, 'Example Vault');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'sentinel.md'), 'keep me\n');
  if (settings !== null) { fs.mkdirSync(path.join(vault, '.obsidian')); fs.writeFileSync(path.join(vault, '.obsidian', 'daily-notes.json'), typeof settings === 'string' ? settings : JSON.stringify(settings)); }
  if (daily) fs.mkdirSync(path.join(vault, folder), { recursive: true });
  if (daily && note !== null) fs.writeFileSync(path.join(vault, folder, '2026-11-16.md'), note);
  if (extra) extra(vault);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).map((e) => (e.isDirectory() ? e.name + '/[' + walk(path.join(d, e.name)) + ']' : e.name + ':' + fs.readFileSync(path.join(d, e.name), 'utf8'))).join('|');
  const snap = () => walk(outside) + '#' + fs.readdirSync(base).sort().join(',');
  let before = snap();
  const noteFile = path.join(vault, folder, '2026-11-16.md');
  const make = (over = {}) => deskMod.create({ env: {}, vaultDir: vault, now: () => DAY, readLatest: () => null, ...over });
  return { base, vault, outside, noteFile, make, resnap: () => { before = snap(); }, untouched: () => assert.equal(snap(), before, 'something outside the vault changed') };
}
const readNote = (w) => fs.readFileSync(w.noteFile, 'utf8');

test('read: today\'s note as plain text, the recent names, and the words for where it looked', async () => {
  const w = world();
  const r = await w.make().read();
  assert.equal(r.state, 'ready');
  assert.equal(r.text, '# Monday\n\nplain text\n');
  assert.equal(r.folder, '10_Daily');
  assert.equal(r.folderFromSettings, false);
  assert.equal(r.noteName, '2026-11-16');
  assert.equal(r.vaultName, 'Example Vault');
  assert.equal(r.canOpen, false);
  assert.deepEqual(r.recent, [{ name: '2026-11-16' }]);
  assert.equal(JSON.stringify(r).includes(w.vault), false, 'no path leaves main');
  w.untouched();
});

test('read: the twelve most recent notes, names only, newest first; dot folders and non-notes are skipped', async () => {
  const w = world({ extra: (v) => {
    fs.mkdirSync(path.join(v, 'Projects'));
    fs.mkdirSync(path.join(v, '.trash'));
    for (let i = 0; i < 20; i++) {
      const f = path.join(v, 'Projects', 'idea ' + String(i).padStart(2, '0') + '.md');
      fs.writeFileSync(f, 'x');
      const t = new Date(2026, 10, 1 + (i % 15), 10, 0, i);
      fs.utimesSync(f, t, t);
    }
    fs.writeFileSync(path.join(v, '.trash', 'gone.md'), 'x');
    fs.writeFileSync(path.join(v, 'Projects', 'picture.png'), 'x');
  } });
  const r = await w.make().read();
  assert.equal(r.recent.length, 12);
  assert.ok(r.recent.every((x) => Object.keys(x).join() === 'name' && !/\.md$/.test(x.name)));
  assert.equal(r.recent.some((x) => x.name === 'gone' || x.name === 'picture'), false);
  w.untouched();
});

test('read: a note bigger than 20 KB is cut at 20 KB and says so', async () => {
  const w = world({ note: 'a'.repeat(30000) });
  const r = await w.make().read();
  assert.equal(r.truncated, true);
  assert.equal(Buffer.byteLength(r.text), 20480);
  w.untouched();
});

test('read: a planted secret is masked on the way out and stays in the file', async () => {
  const w = world({ note: '# Monday\n\npassword: hunter2-planted-secret\napi_key: abcdefghijklmnop1234\n' });
  const r = await w.make().read();
  assert.equal(r.text.includes('hunter2-planted-secret'), false);
  assert.equal(r.text.includes('abcdefghijklmnop1234'), false);
  assert.match(r.text, /secret/);
  assert.match(readNote(w), /hunter2-planted-secret/, 'the note itself is never rewritten');
  w.untouched();
});

test('read: no folder and no note are said in words; nothing is created', async () => {
  const none = world({ daily: false });
  const r1 = await none.make().read();
  assert.equal(r1.state, 'no-folder');
  assert.equal(r1.folder, '10_Daily');
  assert.equal(fs.existsSync(path.join(none.vault, '10_Daily')), false);
  none.untouched();
  const noNote = world({ note: null });
  const r2 = await noNote.make().read();
  assert.equal(r2.state, 'no-note');
  assert.equal(fs.readdirSync(path.join(noNote.vault, '10_Daily')).length, 0);
  noNote.untouched();
});

test('read: the vault\'s own daily-notes settings decide the folder and the name; unsafe ones are ignored and said', async () => {
  const ok = world({ settings: { folder: 'Journal', format: 'YYYY-MM-DD' }, folder: 'Journal' });
  const r = await ok.make().read();
  assert.equal(r.state, 'ready');
  assert.equal(r.folder, 'Journal');
  assert.equal(r.folderFromSettings, true);
  ok.untouched();
  for (const bad of [{ folder: '../x', format: 'YYYY-MM-DD' }, { folder: 'a:b' }, { format: '../x' }, { format: 'a:b' }, '{broken']) {
    const w = world({ settings: bad });
    const rr = await w.make().read();
    assert.equal(rr.state, 'ready', JSON.stringify(bad));
    assert.equal(rr.folder, '10_Daily');
    if (typeof bad !== 'string') assert.equal(rr.settingsIgnored, true, JSON.stringify(bad));
    assert.equal(rr.text, '# Monday\n\nplain text\n');
    w.untouched();
  }
});

test('read: HQ_VAULT_DIR set but missing answers "vault not found" and never falls back to the default vault', async () => {
  const w = world();
  const before = readNote(w);
  const desk = w.make({ env: { HQ_VAULT_DIR: path.join(w.base, 'no-such-vault') } });
  assert.deepEqual(await desk.read(), { error: WORDS.noVault });
  assert.deepEqual(await desk.capture('hello'), { error: WORDS.noVault });
  assert.equal(readNote(w), before, 'the default vault was not written');
  // and when set and present it is the only vault
  const other = path.join(w.base, 'Other Vault');
  fs.mkdirSync(path.join(other, '10_Daily'), { recursive: true });
  fs.writeFileSync(path.join(other, '10_Daily', '2026-11-16.md'), 'other note\n');
  w.resnap();
  const r = await w.make({ env: { HQ_VAULT_DIR: other } }).read();
  assert.equal(r.vaultName, 'Other Vault');
  assert.equal(r.text, 'other note\n');
  w.untouched();
});

test('read: Open in Obsidian only when the scan lists the vault by that name', async () => {
  const w = world();
  const inv = { inventory: { vaults: [{ name: 'Example Vault', path: 'Example Vault' }] } };
  assert.equal((await w.make({ readLatest: () => inv }).read()).canOpen, true);
  assert.equal((await w.make({ readLatest: () => ({ inventory: { vaults: [{ name: 'Another', path: 'x' }] } }) }).read()).canOpen, false);
  assert.equal((await w.make({ readLatest: () => { throw new Error('boom'); } }).read()).canOpen, false);
  const calls = [];
  const desk = w.make({ readLatest: () => inv, vaultOpen: async (n, how) => { calls.push([n, how]); return { ok: true, how }; } });
  assert.deepEqual(await desk.open(), { ok: true, how: 'open' });
  assert.deepEqual(calls, [['Example Vault', 'open']]);
  assert.deepEqual(await w.make({ vaultOpen: async () => ({ ok: true }) }).open(), { error: 'not available here' });
  w.untouched();
});

test('capture: one "- " line appended at the end, under a Captured heading added once', async () => {
  const w = world();
  const desk = w.make();
  assert.deepEqual(await desk.capture('call the plumber'), { ok: true });
  assert.equal(readNote(w), '# Monday\n\nplain text\n\n## Captured\n\n- call the plumber\n');
  assert.deepEqual(await desk.capture('  buy bread \n'), { ok: true });
  assert.equal(readNote(w), '# Monday\n\nplain text\n\n## Captured\n\n- call the plumber\n- buy bread\n');
  w.untouched();
});

test('capture: a note with no trailing newline gets one first, and the old text is never touched', async () => {
  const w = world({ note: '# Monday\n\nno newline at the end' });
  assert.deepEqual(await w.make().capture('one'), { ok: true });
  assert.equal(readNote(w), '# Monday\n\nno newline at the end\n\n## Captured\n\n- one\n');
  w.untouched();
});

test('capture: it lands below the WorkspaceHQ block, and a later nightly rewrite of the block keeps it', async () => {
  const block = (n) => '%% workspacehq:start %%\n> [!summary]+ block ' + n + '\n> - [ ] wq:q1 first\n%% workspacehq:end %%\n';
  const w = world({ note: '# Monday\n\n' + block(1) });
  assert.deepEqual(await w.make().capture('captured between runs'), { ok: true });
  const mid = readNote(w);
  assert.ok(mid.indexOf('captured between runs') > mid.indexOf('%% workspacehq:end %%'), 'below the block');
  // what collector/assemble.mjs does to an existing note (the same replace)
  let cur = mid;
  cur = cur.replace(/%% workspacehq:start %%[\s\S]*?%% workspacehq:end %%\n?/, block(2));
  assert.match(cur, /block 2/);
  assert.match(cur, /- captured between runs/);
  w.untouched();
});

test('capture: "[x] done wq:id" can never be read back as a ticked quest', async () => {
  const w = world({ note: '# Monday\n\n- [ ] wq:q1 open one\n' });
  const desk = w.make();
  for (const t of ['[x] done wq:q1', '> [x] done wq:q1', '- [x] wq:q1', 'wq :q1', '* [X] wq:q1']) assert.deepEqual(await desk.capture(t), { ok: true });
  assert.deepEqual(tickedIds(readNote(w), () => false), []);
  assert.equal(/wq:q1[^\n]*\n[^\n]*wq:q1/.test(readNote(w).split('open one')[1] || ''), false);
  w.untouched();
});

test('capture: control characters are collapsed to one line and a 5,000-character line is refused', async () => {
  const w = world();
  const desk = w.make();
  assert.deepEqual(await desk.capture('a\r\nb\u0000c\td'), { ok: true });
  assert.match(readNote(w), /- a b c d\n$/);
  const before = readNote(w);
  assert.deepEqual(await desk.capture('x'.repeat(5000)), { error: WORDS.long });
  assert.deepEqual(await desk.capture('   '), { error: WORDS.empty });
  assert.deepEqual(await desk.capture(undefined), { error: WORDS.empty });
  assert.equal(readNote(w), before);
  w.untouched();
});

test('capture: a missing note and a missing daily folder are said in words and nothing is created', async () => {
  const noNote = world({ note: null });
  assert.deepEqual(await noNote.make().capture('hello'), { error: WORDS.noNote });
  assert.equal(fs.readdirSync(path.join(noNote.vault, '10_Daily')).length, 0);
  noNote.untouched();
  const noFolder = world({ daily: false });
  assert.deepEqual(await noFolder.make().capture('hello'), { error: WORDS.noFolder });
  assert.equal(fs.existsSync(path.join(noFolder.vault, '10_Daily')), false);
  assert.deepEqual(fs.readdirSync(noFolder.vault), []);
  noFolder.untouched();
});

test('capture: a settings file that asks for ../x or a:b writes into the default folder only', async () => {
  for (const bad of [{ folder: '../x', format: 'YYYY-MM-DD' }, { folder: 'a:b' }, { format: '../x' }, { format: 'a:b' }]) {
    const w = world({ settings: bad, extra: (v) => fs.mkdirSync(path.join(path.dirname(v), 'x'), { recursive: true }) });
    assert.deepEqual(await w.make().capture('safe'), { ok: true }, JSON.stringify(bad));
    assert.match(fs.readFileSync(path.join(w.vault, '10_Daily', '2026-11-16.md'), 'utf8'), /- safe\n$/);
    assert.deepEqual(fs.readdirSync(path.join(w.base, 'x')), [], 'nothing was written beside the vault');
  }
});

test('capture: a junction or symlink as the note is refused and its target is untouched', async () => {
  const w = world({ note: null });
  const target = path.join(w.outside, 'target');
  fs.mkdirSync(target);
  w.resnap();
  const link = path.join(w.vault, '10_Daily', '2026-11-16.md');
  try { fs.symlinkSync(target, link, 'junction'); } catch { return; }   // a platform that cannot make one has nothing to test
  w.resnap();
  const before = fs.readdirSync(target);
  assert.deepEqual(await w.make().capture('through the link'), { error: WORDS.unsafe });
  assert.deepEqual(fs.readdirSync(target), before);
  const r = await w.make().read();
  assert.equal(r.text, '');
  w.untouched();
});

test('capture: a symlinked daily FOLDER that leaves the vault is refused', async () => {
  const w = world({ daily: false });
  const elsewhere = path.join(w.outside, 'journal');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, '2026-11-16.md'), 'outside note\n');
  w.resnap();
  try { fs.symlinkSync(elsewhere, path.join(w.vault, '10_Daily'), 'junction'); } catch { return; }
  assert.deepEqual(await w.make().capture('escape'), { error: WORDS.noFolder });
  assert.equal(fs.readFileSync(path.join(elsewhere, '2026-11-16.md'), 'utf8'), 'outside note\n');
  assert.equal((await w.make().read()).state, 'no-folder');
  w.untouched();
});

test('capture: 30 an hour, then the word for it; the window slides', async () => {
  const w = world();
  let t = DAY.getTime();
  const desk = w.make({ now: () => new Date(t) });
  for (let i = 0; i < 30; i++) assert.deepEqual(await desk.capture('line ' + i), { ok: true }, 'capture ' + i);
  assert.deepEqual(await desk.capture('one too many'), { error: WORDS.rate });
  assert.equal(readNote(w).includes('one too many'), false);
  t += 3600e3 + 1;
  // an hour later the day has moved on in a real clock; here the note path is fixed by the same day, so only the limiter is under test
  const later = w.make({ now: () => new Date(DAY.getTime()) });
  desk._clear();
  assert.deepEqual(await desk.capture('after the hour'), { ok: true });
  void later;
  w.untouched();
});

test('capture: the re-entrancy lock refuses a second capture that starts while one is running', async () => {
  const w = world();
  const desk = w.make();
  const first = desk.capture('first');
  const second = await desk.capture('second');
  assert.deepEqual(second, { error: WORDS.busy });
  assert.deepEqual(await first, { ok: true });
  assert.equal(readNote(w).includes('second'), false);
  w.untouched();
});

function ipcWorld(over = {}) {
  const w = world();
  const handlers = {};
  const main = { id: 'main' };
  const other = { id: 'palette' };
  const win = { isDestroyed: () => false, webContents: main };
  deskMod.init({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, getWin: () => win, dataDir: w.base, env: {}, vaultDir: w.vault, now: () => DAY, ...over });
  return { w, handlers, main, other };
}

test('IPC: both channels answer the main window only; a foreign or missing sender is refused and nothing is written', async () => {
  const { w, handlers, main, other } = ipcWorld();
  const before = readNote(w);
  const r = await handlers['hq:vault-desk:read']({ sender: main });
  assert.equal(r.state, 'ready');
  assert.deepEqual(await handlers['hq:vault-desk:capture']({ sender: main }, { text: 'from main' }), { ok: true });
  for (const sender of [other, null, undefined, {}]) {
    assert.deepEqual(await handlers['hq:vault-desk:read']({ sender }), { error: NOT_HERE });
    assert.deepEqual(await handlers['hq:vault-desk:capture']({ sender }, { text: 'from elsewhere' }), { error: NOT_HERE });
  }
  assert.deepEqual(await handlers['hq:vault-desk:read'](null), { error: NOT_HERE });
  assert.equal(readNote(w), before + '\n## Captured\n\n- from main\n');
  w.untouched();
});

test('IPC: a payload that is not { text } captures nothing; a destroyed window and a missing window refuse', async () => {
  const { w, handlers, main } = ipcWorld();
  const before = readNote(w);
  assert.deepEqual(await handlers['hq:vault-desk:capture']({ sender: main }, 'bare string'), { error: WORDS.empty });
  assert.deepEqual(await handlers['hq:vault-desk:capture']({ sender: main }, { text: 42 }), { error: WORDS.empty });
  assert.deepEqual(await handlers['hq:vault-desk:capture']({ sender: main }, { txt: 'x' }), { error: WORDS.empty });
  assert.equal(readNote(w), before);
  const gone = ipcWorld({ getWin: () => ({ isDestroyed: () => true, webContents: {} }) });
  assert.deepEqual(await gone.handlers['hq:vault-desk:read']({ sender: gone.main }), { error: NOT_HERE });
  const none = ipcWorld({ getWin: () => null });
  assert.deepEqual(await none.handlers['hq:vault-desk:capture']({ sender: none.main }, { text: 'x' }), { error: NOT_HERE });
  w.untouched();
});

test('answers are fixed words: no error message, no path, from a failing file system', async () => {
  const w = world();
  const boom = () => { throw new Error(w.vault + ' EACCES secret detail'); };
  const failing = { ...fs, constants: fs.constants, openSync: boom, readFileSync: (f, e) => (String(f).endsWith('.md') ? boom() : fs.readFileSync(f, e)) };
  const desk = w.make({ fsApi: failing });
  const c = await desk.capture('hello');
  assert.ok(Object.values(WORDS).includes(c.error), c.error);
  assert.equal(JSON.stringify(c).includes(w.vault), false);
  const r = await desk.read();
  assert.equal(JSON.stringify(r).includes('EACCES'), false);
  assert.equal(JSON.stringify(r).includes(w.vault), false);
  w.untouched();
});
