// Security IPC (dashboard/security.js): the ten hq:security:* channels, the main-window-only gate, the 30 s clipboard clear, the name-only scan timer.
// Fake ipcMain / windows / clipboard / timers, the fake keepassxc-cli, temp dirs. Invented data - the repo is public. No network.
//   node --test dashboard/security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  tmp, FAKE_CLI, PASSPHRASE, buildXml, secretsOf, coreUnderTest, sweepText, allFiles, fakeTimers, fakeIpc, fakeWin, fakeClipboard,
} from './security-vault-testkit.mjs';

const require = createRequire(import.meta.url);
const security = require('./security.js');

const CHANNELS = ['read', 'refresh', 'settings', 'edit', 'add-manual', 'add-identity', 'walkthrough', 'scan-exports', 'trash-export', 'copy'].map((c) => 'hq:security:' + c);
const NOW = new Date('2026-11-11T10:00:00Z');

// a fake safeStorage the real adapter wraps (base64 of a xor)
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)).toString('utf8'),
});

function make(o = {}) {
  const dataDir = tmp();
  const work = tmp('hq-sec-work-');
  const vaultPath = path.join(work, 'vault.kdbx'); fs.writeFileSync(vaultPath, 'x');
  const xmlPath = path.join(work, 'export.xml'); fs.writeFileSync(xmlPath, buildXml());
  const scanRoot = tmp('hq-sec-scan-');
  fs.mkdirSync(path.join(dataDir, 'security'), { recursive: true });   // the owner chose a vault earlier: written by hand so the boot state has no status.json
  fs.writeFileSync(path.join(dataDir, 'security', 'settings.json'), JSON.stringify({ v: 1, vaultPath, keyFilePath: null, cliPath: null, refKey: null, walkthrough: {} }));
  const ipc = fakeIpc();
  const main = { id: 'main', isDestroyed: () => false };
  const cast = { id: 'cast', isDestroyed: () => false };
  const clip = fakeClipboard('previous');
  const timers = fakeTimers();
  const logs = [], trashed = [], spawnCalls = [];
  const appLog = { event: (...a) => { logs.push(a); return true; }, error: (...a) => logs.push(a) };
  const handle = security.init({
    ipcMain: ipc, getWin: () => fakeWin(main), dataDir, safeStorage: fakeSafeStorage(o.available !== false),
    shell: { trashItem: async (p) => { trashed.push(p); } }, clipboard: clip, appLog,
    deps: {
      allowScriptCli: true, core: coreUnderTest, timers, now: () => NOW, scanDirs: [scanRoot], fetchRange: o.fetchRange || (async () => 'FFFF:0'),
      env: { ...process.env, HQ_KEEPASSXC_CLI: FAKE_CLI, HQ_FAKE_KP_XML: xmlPath, HQ_FAKE_KP_MODE: o.mode || 'ok' },
      spawn: (...a) => { spawnCalls.push(a); return cp.spawn(...a); },
    },
  });
  const sec = path.join(dataDir, 'security');

  return { ipc, main, cast, clip, timers, logs, trashed, spawnCalls, handle, dataDir, sec, scanRoot, vaultPath, work, xmlPath,
    call: (ch, arg, sender = main) => ipc.call('hq:security:' + ch, sender, arg) };
}

test('init registers exactly the ten hq:security:* channels and starts nothing that touches the vault', () => {
  const t = make();
  assert.deepEqual([...t.ipc.handlers.keys()].sort(), [...CHANNELS].sort());
  assert.deepEqual(security.CHANNELS.map((c) => 'hq:security:' + c).sort(), [...CHANNELS].sort());
  assert.equal(t.spawnCalls.length, 0, 'never a refresh at boot');
  t.handle.dispose();
});

test('EVERY channel from a webContents that is not the main window -> { error }, no spawn, no store write, no clipboard write, no trash', async () => {
  const t = make();
  const before = allFiles(t.sec).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  const args = {
    read: {}, refresh: { passphrase: PASSPHRASE, checkBreaches: true }, settings: { vaultPath: t.vaultPath }, edit: { id: 'k-aaaaaaaaaaaa', patch: { archived: true } },
    'add-manual': { title: 'Nope', host: 'x.example.test' }, 'add-identity': { kind: 'email', value: 'a@example.test' }, walkthrough: { stepId: 'email-2fa', done: true },
    'scan-exports': {}, 'trash-export': { name: 'passwords.csv', dir: t.scanRoot }, copy: { text: 'secret-text-1' },
  };
  for (const ch of Object.keys(args)) {
    for (const sender of [t.cast, undefined, null, { id: 'main' }]) {   // the cast window, a missing sender, and a look-alike object
      assert.deepEqual(await t.ipc.call('hq:security:' + ch, sender, args[ch]), { error: 'not available here' }, ch);
    }
  }
  assert.equal(t.spawnCalls.length, 0);
  assert.equal(t.clip.writes, 0);
  assert.equal(t.clip.text, 'previous');
  assert.equal(t.trashed.length, 0);
  assert.deepEqual(allFiles(t.sec).map((f) => [f, fs.readFileSync(f, 'utf8')]), before, 'no store write');
  assert.equal(t.logs.length, 0, 'not even a log line');
  t.handle.dispose();
});

test('a destroyed or missing main window answers the same error', async () => {
  const t = make();
  const ipc = fakeIpc();
  const h = security.init({ ipcMain: ipc, getWin: () => null, dataDir: t.dataDir, safeStorage: fakeSafeStorage(), shell: {}, clipboard: t.clip, appLog: { event() {} }, deps: { core: coreUnderTest, timers: fakeTimers() } });
  assert.deepEqual(await ipc.call('hq:security:read', t.main, {}), { error: 'not available here' });
  const ipc2 = fakeIpc();
  security.init({ ipcMain: ipc2, getWin: () => ({ isDestroyed: () => true, webContents: t.main }), dataDir: t.dataDir, safeStorage: fakeSafeStorage(), shell: {}, clipboard: t.clip, appLog: { event() {} }, deps: { core: coreUnderTest, timers: fakeTimers() } });
  assert.deepEqual(await ipc2.call('hq:security:read', t.main, {}), { error: 'not available here' });
  h.dispose(); t.handle.dispose();
});

test('refresh from the main window: ok, no secret on disk, and appLog never sees the passphrase (success or failure)', async () => {
  const t = make();
  const ok = await t.call('refresh', { passphrase: PASSPHRASE, checkBreaches: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.breachChecked, true);
  const bad = await t.call('refresh', { passphrase: 'not the passphrase at all', checkBreaches: false });
  assert.deepEqual(bad, { error: 'wrong passphrase or key file' });
  const logText = JSON.stringify(t.logs);
  assert.ok(t.logs.length >= 2, 'a fixed-words line per refresh');
  for (const s of [PASSPHRASE, 'not the passphrase at all', ...secretsOf()]) assert.ok(!logText.includes(s), 'the log holds no secret');
  for (const f of allFiles(t.sec)) coreUnderTest.assertNoSecrets(fs.readFileSync(f, 'utf8'), secretsOf());
  assert.ok(!sweepText(t.sec).includes('enc:AAAA'));
  t.handle.dispose();
});

test('refresh: a non-object, a non-boolean checkBreaches, and an oversize passphrase never reach the network or the cli', async () => {
  const seen = [];
  const t = make({ fetchRange: async (p) => { seen.push(p); return ''; } });
  assert.ok((await t.call('refresh', undefined)).error);
  assert.ok((await t.call('refresh', 'a string')).error);
  assert.ok((await t.call('refresh', { passphrase: 'x'.repeat(2000) })).error);
  assert.equal(t.spawnCalls.length, 0);
  const r = await t.call('refresh', { passphrase: PASSPHRASE, checkBreaches: 'yes' });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [], 'only a literal true turns the breach check on');
  t.handle.dispose();
});

test('a handler that throws answers a fixed word, never the message', async () => {
  const t = make();
  t.handle.store.setSettings = () => { throw new Error('C:\\secret\\path leaked'); };
  const r = await t.call('settings', { vaultPath: t.vaultPath });
  assert.deepEqual(r, { error: 'security action failed' });
  t.handle.dispose();
});

test('read: settings (paths shown, no refKey), the map with decrypted labels, owner, snapshots, status, cliFound, vaultExists', async () => {
  const t = make();
  const empty = await t.call('read', {});
  assert.equal(empty.cliFound, true);
  assert.equal(empty.vaultExists, true);
  assert.deepEqual(empty.map.accounts, []);
  assert.equal(empty.settings.vaultPath, t.vaultPath);
  assert.equal(empty.settings.locked, false);
  await t.call('refresh', { passphrase: PASSPHRASE });
  const r = await t.call('read', {});
  assert.equal(r.map.accounts.length, 4);
  assert.ok(r.map.identities.some((i) => i.label === 'owner@example.test'), 'labels come back decrypted');
  assert.equal(r.snapshots.length, 1);
  assert.equal(r.status.refreshedAt, NOW.toISOString());
  assert.ok(!JSON.stringify(r).includes('refKey'));
  fs.rmSync(t.vaultPath);
  assert.equal((await t.call('read', {})).vaultExists, false);
  t.handle.dispose();
});

test('safeStorage unavailable: read says locked, labels are null, a refresh still fills the map but records no identity', async () => {
  const t = make({ available: false });
  assert.equal((await t.call('read', {})).settings.locked, true);
  const r = await t.call('refresh', { passphrase: PASSPHRASE });
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => /locked/.test(n)));
  const after = await t.call('read', {});
  assert.deepEqual(after.map.identities, []);
  assert.match((await t.call('add-identity', { kind: 'email', value: 'a@example.test' })).error, /locked/);
  assert.ok(!sweepText(t.sec).includes('owner@example.test'));
  t.handle.dispose();
});

test('settings / edit / add-manual / add-identity / walkthrough go to the store and answer its { ok } | { error }', async () => {
  const t = make();
  assert.deepEqual(await t.call('settings', { vaultPath: 'relative.kdbx' }), { error: 'vaultPath must be an absolute path' });
  assert.deepEqual(await t.call('settings', { keyFilePath: path.resolve(t.work, 'k.keyx') }), { ok: true });
  assert.equal((await t.call('edit', { id: 'k-aaaaaaaaaaaa', patch: { note: 'x' } })).error, 'unknown field');
  assert.deepEqual(await t.call('edit', { id: 'k-aaaaaaaaaaaa', patch: { hiddenFromClaude: true } }), { ok: true });
  const m = await t.call('add-manual', { title: 'Paper', host: 'paper.example.test' });
  assert.match(m.id, /^m-[0-9a-f]{12}$/);
  const i = await t.call('add-identity', { kind: 'email', value: 'someone@example.test' });
  assert.match(i.ref, /^i-[0-9a-f]{12}$/);
  assert.deepEqual(await t.call('walkthrough', { stepId: 'email-2fa', done: true }), { ok: true });
  const r = await t.call('read', {});
  assert.equal(r.status.email2faDone, true);
  assert.equal(r.status.walkthroughStarted, true);
  assert.equal(r.owner.manual.length, 1);
  assert.equal(r.owner.identities[0].label, 'someone@example.test');
  t.handle.dispose();
});

test('scan-exports lists name-only guesses and stamps status; trash-export moves exactly a listed file through shell.trashItem and re-scans', async () => {
  const t = make();
  fs.writeFileSync(path.join(t.scanRoot, 'Chrome Passwords.csv'), 'x'); fs.writeFileSync(path.join(t.scanRoot, 'bypass.txt'), 'x');
  fs.writeFileSync(path.join(t.work, 'vault.sync-conflict-20261111-101010-ABCDEFG.kdbx'), '');
  const s = await t.call('scan-exports', {});
  assert.deepEqual(s.files.map((f) => f.name), ['Chrome Passwords.csv']);
  const st = await t.call('read', {});
  assert.equal(st.status.exportsFound, 1);
  assert.equal(st.status.conflicts, 1);
  assert.match((await t.call('trash-export', { name: 'bypass.txt', dir: t.scanRoot })).error, /latest scan/);
  assert.deepEqual(await t.call('trash-export', { name: 'Chrome Passwords.csv', dir: t.scanRoot }), { ok: true });
  assert.deepEqual(t.trashed, [path.join(t.scanRoot, 'Chrome Passwords.csv')]);
  assert.equal(JSON.stringify(t.logs).includes('Chrome'), false, 'the day log carries no file name');
  assert.ok(t.logs.some((l) => l[0] === 'security' && l[1].note === 'moved a plain export to the Recycle Bin'));
  t.handle.dispose();
});

test('the scan timer: first at 60 s, then every 6 h, each stamping status.json `at`; no refresh is ever scheduled', async () => {
  const t = make();
  fs.writeFileSync(path.join(t.scanRoot, 'passwords.csv'), 'x');
  assert.equal(fs.existsSync(path.join(t.sec, 'status.json')), false, 'nothing at boot');
  t.timers.advance(59_000);
  assert.equal(fs.existsSync(path.join(t.sec, 'status.json')), false);
  t.timers.advance(2_000);
  const first = JSON.parse(fs.readFileSync(path.join(t.sec, 'status.json'), 'utf8'));
  assert.equal(first.exportsFound, 1);
  assert.match(first.at, /^2026-11-11T/);
  fs.writeFileSync(path.join(t.scanRoot, 'bitwarden_export_1.json'), 'x');
  t.timers.advance(6 * 60 * 60 * 1000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.sec, 'status.json'), 'utf8')).exportsFound, 2);
  assert.equal(t.spawnCalls.length, 0, 'timers never run the cli');
  assert.equal(allFiles(t.sec).some((f) => path.basename(f) === 'map.json'), false, 'and never write a map');
  t.handle.dispose();
  assert.equal(t.timers.pending(), 0, 'dispose clears the timers');
});

test('copy: written at once, cleared after 30 s when unchanged, left alone when the owner copied something else', async () => {
  const t = make();
  assert.deepEqual(await t.call('copy', { text: 'Invented-Passphrase-one' }), { ok: true });
  assert.equal(t.clip.text, 'Invented-Passphrase-one');
  t.timers.advance(29_000);
  assert.equal(t.clip.clears, 0);
  t.timers.advance(2_000);
  assert.equal(t.clip.clears, 1);
  assert.equal(t.clip.text, '');
  // the owner copies something else in the meantime
  await t.call('copy', { text: 'Invented-Passphrase-two' });
  t.clip.text = 'something the owner copied';
  t.timers.advance(31_000);
  assert.equal(t.clip.clears, 1, 'not cleared again');
  assert.equal(t.clip.text, 'something the owner copied');
  // a second copy restarts the countdown
  await t.call('copy', { text: 'Invented-Passphrase-three' });
  t.timers.advance(20_000);
  await t.call('copy', { text: 'Invented-Passphrase-four' });
  t.timers.advance(20_000);
  assert.equal(t.clip.text, 'Invented-Passphrase-four', 'the first countdown was cancelled');
  t.timers.advance(11_000);
  assert.equal(t.clip.text, '');
  for (const bad of [{}, { text: '' }, { text: 7 }, { text: 'x'.repeat(1025) }]) assert.ok((await t.call('copy', bad)).error);
  assert.ok(!JSON.stringify(t.logs).includes('Invented-Passphrase'), 'copied text is never logged');
  t.handle.dispose();
});

test('a second refresh while one runs answers the lock error through the channel; spawn called once', async () => {
  const t = make({ mode: 'slow' });
  const p1 = t.call('refresh', { passphrase: PASSPHRASE });
  const r2 = await t.call('refresh', { passphrase: PASSPHRASE });
  assert.deepEqual(r2, { error: 'a refresh is already running' });
  assert.equal(t.spawnCalls.length, 1);
  assert.equal((await p1).ok, true);
  t.handle.dispose();
});

test('makeCrypto: base64 in and out, null when safeStorage is unavailable or throws', () => {
  const c = security.makeCrypto(fakeSafeStorage(true));
  const sealed = c.encrypt('hello example');
  assert.ok(!sealed.includes('hello'));
  assert.equal(c.decrypt(sealed), 'hello example');
  const off = security.makeCrypto(fakeSafeStorage(false));
  assert.equal(off.encrypt('x'), null);
  assert.equal(off.decrypt('eA=='), null);
  assert.equal(security.makeCrypto(null).encrypt('x'), null);
  assert.equal(security.makeCrypto({ isEncryptionAvailable: () => { throw new Error('no'); } }).encrypt('x'), null);
});
