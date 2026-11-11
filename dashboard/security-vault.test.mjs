// Security vault reader (dashboard/security-vault.js): the cli on stdin, the breach check, scans and the Recycle Bin move.
// A fake keepassxc-cli (dashboard/__fixtures__/fake-keepassxc-cli.mjs), temp dirs, a stub core and a fake fetchRange only.
// Invented data - the repo is public. No network, no real vault.
//   node --test dashboard/security-vault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  tmp, FAKE_CLI, PASSPHRASE, ENTRIES, buildXml, secretsOf, stubCore, loadRealCore, coreUnderTest, fakeCrypto, nullCrypto, sweepText, allFiles,
} from './security-vault-testkit.mjs';

const require = createRequire(import.meta.url);
const store = require('./security-store.js');
const vaultMod = require('./security-vault.js');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').toUpperCase();
const NOW = new Date('2026-11-11T10:00:00Z');

function make(o = {}) {
  const dataDir = tmp();
  const work = tmp('hq-sec-work-');
  const vaultPath = path.join(work, 'vault.kdbx');
  if (o.vaultFile !== false) fs.writeFileSync(vaultPath, 'not a real vault');
  const xmlPath = path.join(work, 'export.xml');
  fs.writeFileSync(xmlPath, o.xml || buildXml());
  const st = store.create({ dataDir, crypto: o.crypto || fakeCrypto, core: coreUnderTest, now: () => NOW, randomBytes: o.randomBytes });
  if (o.settings !== false) st.setSettings({ vaultPath, ...(o.keyFile ? { keyFilePath: o.keyFile } : {}) });
  const calls = [], children = [];
  const spawn = (...a) => { calls.push(a); const c = cp.spawn(...a); children.push(c); return c; };
  const env = { ...process.env, HQ_FAKE_KP_XML: xmlPath, HQ_FAKE_KP_MODE: o.mode || 'ok', ...(o.record ? { HQ_FAKE_KP_RECORD: o.record } : {}) };
  const v = vaultMod.create({
    store: st, core: o.core || coreUnderTest, spawn, now: () => NOW, env, fetchRange: o.fetchRange,
    findCli: o.findCli === undefined ? () => FAKE_CLI : o.findCli, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes,
    trash: o.trash, log: o.log, fs: o.fs, randomBytes: o.randomBytes, allowScriptCli: true,
  });
  return { v, st, dataDir, dir: path.join(dataDir, 'security'), calls, children, vaultPath, work };
}
const waitExit = (c) => new Promise((r) => { if (c.exitCode !== null || c.signalCode) r(); else c.once('exit', r); });

// ---------------------------------------------------------------- refresh: the happy path and the no-secret proof
test('refresh with the fake cli: map.json written and NO secret (password, note, otp, username, history, passphrase) anywhere in data/security/', async () => {
  const t = make();
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.accounts.length, 4);
  assert.equal(r.breachChecked, false);
  const map = JSON.parse(fs.readFileSync(path.join(t.dir, 'map.json'), 'utf8'));
  assert.equal(map.accounts.length, 4);
  assert.ok(map.accounts.every((a) => a.breached === null), 'no breach check -> null everywhere');
  const files = allFiles(t.dir).map((f) => path.basename(f));
  for (const f of ['map.json', 'settings.json', 'snapshots.jsonl', 'status.json']) assert.ok(files.includes(f), f);
  for (const f of allFiles(t.dir)) stubCore.assertNoSecrets(fs.readFileSync(f, 'utf8'), secretsOf());
  assert.ok(!JSON.stringify(r).includes('Alpha-Bravo'), 'the result carries no secret either');
});

test('the passphrase went to stdin, NOT argv or env: spawn contract, args and an env without it', async () => {
  const record = path.join(tmp(), 'argv.json');
  const keyFile = path.join(tmp(), 'k.keyx'); fs.writeFileSync(keyFile, 'invented key file');
  const t = make({ record, keyFile });
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.equal(r.ok, true, 'the fake exits 3 if the passphrase is in argv or env, so ok proves stdin-only');
  assert.equal(t.calls.length, 1);
  const [cmd, argv, opts] = t.calls[0];
  assert.equal(cmd, process.execPath, 'a .mjs cli runs under Node');
  assert.deepEqual(argv, [FAKE_CLI, 'export', '--format', 'xml', '-q', t.vaultPath, '--key-file', keyFile]);
  assert.equal(opts.shell, false);
  assert.equal(opts.windowsHide, true);
  assert.ok(!JSON.stringify([argv, opts.env]).includes(PASSPHRASE));
  assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), argv.slice(1));
});

test('a native cli path is spawned itself with the bare args (no key file when none is set)', async () => {
  const t = make({ findCli: () => path.join(tmp(), 'keepassxc-cli.exe') });
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.ok(r.error);   // the file does not exist, spawn fails: reported, not thrown
  assert.equal(t.calls[0][0].endsWith('keepassxc-cli.exe'), true);
  assert.deepEqual(t.calls[0][1], ['export', '--format', 'xml', '-q', t.vaultPath]);
  assert.match(r.error, /could not be started/);
});

test('a .cmd or .bat cli is refused before any spawn', async () => {
  const t = make({ findCli: () => 'C:\\tools\\keepassxc-cli.cmd' });
  assert.match((await t.v.refresh({ passphrase: PASSPHRASE })).error, /\.cmd or \.bat/);
  assert.equal(t.calls.length, 0);
});

// ---------------------------------------------------------------- failures
test('wrong passphrase -> fixed words, and the previous map.json is untouched byte for byte', async () => {
  const t = make();
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  const files = ['map.json', 'snapshots.jsonl', 'status.json', 'settings.json'];
  const before = files.map((f) => fs.readFileSync(path.join(t.dir, f)));
  const r = await t.v.refresh({ passphrase: 'a different passphrase', checkBreaches: true });
  assert.deepEqual(r, { error: 'wrong passphrase or key file' });
  files.forEach((f, i) => assert.ok(fs.readFileSync(path.join(t.dir, f)).equals(before[i]), f));
});

test('passphrase with a newline, empty, or 1025 chars -> refused before spawn', async () => {
  const t = make();
  for (const p of ['a\nb', 'a\rb', '', 'x'.repeat(1025), undefined, 42]) assert.ok((await t.v.refresh({ passphrase: p })).error, String(p));
  assert.equal(t.calls.length, 0, 'the spawn spy was never called');
  assert.equal(fs.existsSync(path.join(t.dir, 'map.json')), false, 'nothing written');
  assert.ok((await t.v.refresh({})).error);
  assert.equal(t.calls.length, 0);
});

test('1024 chars is accepted by the length rule (it reaches the cli and fails there as a wrong passphrase)', async () => {
  const t = make();
  assert.deepEqual(await t.v.refresh({ passphrase: 'x'.repeat(1024) }), { error: 'wrong passphrase or key file' });
  assert.equal(t.calls.length, 1);
});

test('missing vault file -> "vault file not found" with no spawn; no vault chosen; cli absent -> "KeePassXC is not installed"', async () => {
  const t = make({ vaultFile: false });
  assert.match((await t.v.refresh({ passphrase: PASSPHRASE })).error, /vault file not found/);
  assert.equal(t.calls.length, 0);
  const n = make({ settings: false });
  assert.match((await n.v.refresh({ passphrase: PASSPHRASE })).error, /no vault chosen/);
  const c = make({ findCli: () => null });
  assert.match((await c.v.refresh({ passphrase: PASSPHRASE })).error, /KeePassXC is not installed/);
  assert.equal(c.calls.length, 0);
  const k = make({ keyFile: path.join(tmp(), 'missing.keyx') });
  assert.match((await k.v.refresh({ passphrase: PASSPHRASE })).error, /key file not found/);
  assert.equal(k.calls.length, 0);
});

test('stdout over the cap -> child killed, the "too large" words, nothing written', async () => {
  const t = make({ mode: 'big', maxBytes: 200_000 });
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.deepEqual(r, { error: 'the export is too large (attachments in the vault?)' });
  await waitExit(t.children[0]);
  assert.ok(t.children[0].killed || t.children[0].signalCode || t.children[0].exitCode !== 0, 'the child is gone');
  assert.equal(fs.existsSync(path.join(t.dir, 'map.json')), false);
  assert.equal(t.v.limits.maxBytes, 200_000);
});

test('the real limits are 64 MB and 60 s', () => {
  const t = make();
  assert.equal(vaultMod.MAX_BYTES, 64 * 1024 * 1024);
  assert.equal(vaultMod.TIMEOUT_MS, 60_000);
  assert.equal(t.v.limits.maxPassphrase, 1024);
  assert.equal(t.v.limits.breachConcurrency, 4);
  const d = vaultMod.create({ store: t.st, core: coreUnderTest });
  assert.equal(d.limits.maxBytes, 64 * 1024 * 1024);
  assert.equal(d.limits.timeoutMs, 60_000);
});

test('a cli that never answers -> killed at the timeout, error, nothing written', async () => {
  const t = make({ mode: 'hang', timeoutMs: 400 });
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.match(r.error, /took too long/);
  await waitExit(t.children[0]);
  assert.ok(t.children[0].killed || t.children[0].signalCode);
  assert.equal(fs.existsSync(path.join(t.dir, 'map.json')), false);
});

test('a non-zero exit with unrecognised (localised) stderr and empty stdout -> the long wrong-passphrase-or-could-not-open words', async () => {
  const t = make({ mode: 'localised' });
  assert.deepEqual(await t.v.refresh({ passphrase: PASSPHRASE }), { error: 'wrong passphrase or key file, or KeePassXC could not open the vault' });
  assert.equal(fs.existsSync(path.join(t.dir, 'map.json')), false);
});

test('a cli that exits before reading stdin: an error listener is on stdin before the write, nothing unhandled, a fixed answer', async () => {
  const t = make({ mode: 'early-exit' });
  let sawListener = null;
  const spawn = (...a) => {
    const c = cp.spawn(...a);
    const w = c.stdin.write.bind(c.stdin);
    c.stdin.write = (...x) => { sawListener = c.stdin.listenerCount('error') > 0; return w(...x); };
    return c;
  };
  const v2 = vaultMod.create({ store: t.st, core: coreUnderTest, spawn, now: () => NOW, env: { ...process.env, HQ_FAKE_KP_MODE: 'early-exit' }, findCli: () => FAKE_CLI, allowScriptCli: true });
  let unhandled = null; const h = (e) => { unhandled = e; }; process.once('uncaughtException', h);
  const r = await v2.refresh({ passphrase: PASSPHRASE });
  await new Promise((res) => setTimeout(res, 100));
  process.removeListener('uncaughtException', h);
  assert.equal(sawListener, true);
  assert.equal(unhandled, null);
  assert.deepEqual(r, { error: 'wrong passphrase or key file, or KeePassXC could not open the vault' });
});

test('an export with a Protected="True" Value -> "unreadable export", nothing written, the previous map untouched', async () => {
  const t = make();
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  const before = fs.readFileSync(path.join(t.dir, 'map.json'));
  const p = make({ mode: 'protected' });
  assert.deepEqual(await p.v.refresh({ passphrase: PASSPHRASE }), { error: 'unreadable export' });
  assert.equal(fs.existsSync(path.join(p.dir, 'map.json')), false);
  // the same store, a second vault reading the protected export
  const v2 = vaultMod.create({ store: t.st, core: coreUnderTest, now: () => NOW, env: { ...process.env, HQ_FAKE_KP_MODE: 'protected', HQ_FAKE_KP_XML: path.join(t.work, 'export.xml') }, findCli: () => FAKE_CLI, allowScriptCli: true });
  assert.deepEqual(await v2.refresh({ passphrase: PASSPHRASE }), { error: 'unreadable export' });
  assert.ok(fs.readFileSync(path.join(t.dir, 'map.json')).equals(before));
});

test('a truncated export is "unreadable export" too, never health', async () => {
  const t = make({ xml: '<KeePassFile><Root>' });
  assert.deepEqual(await t.v.refresh({ passphrase: PASSPHRASE }), { error: 'unreadable export' });
  assert.equal(fs.existsSync(path.join(t.dir, 'map.json')), false);
});

test('a second refresh while one runs -> "a refresh is already running", spawn called once; the lock frees afterwards', async () => {
  const t = make({ mode: 'slow' });
  const p1 = t.v.refresh({ passphrase: PASSPHRASE });
  const r2 = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.deepEqual(r2, { error: 'a refresh is already running' });
  assert.equal(t.calls.length, 1);
  assert.equal((await p1).ok, true);
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  assert.equal(t.calls.length, 2);
});

// ---------------------------------------------------------------- breach check
const manyPasswords = (n) => Array.from({ length: n }, (_, i) => ({ uuid: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Acct ${i}`, username: `user${i}`, password: `Invented-Pass-${i}-${i * 7919}!`, url: `https://s${i}.example.test/` }));

test('breach check: a matching suffix -> true, padded count 0 -> false, an absent suffix -> false; each prefix once; shared prefix fetched once', async () => {
  const fetched = [];
  const hit = sha1(ENTRIES[0].password), padded = sha1(ENTRIES[2].password);
  const fetchRange = async (prefix) => {
    fetched.push(prefix);
    const lines = ['0000000000000000000000000000000000A:5'];
    if (prefix === hit.slice(0, 5)) lines.push(`${hit.slice(5)}:3`);
    if (prefix === padded.slice(0, 5)) lines.push(`${padded.slice(5)}:0`);
    return lines.join('\r\n');
  };
  const t = make({ fetchRange });
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: true });
  assert.equal(r.ok, true);
  assert.equal(r.breachChecked, true);
  const by = Object.fromEntries(r.accounts.map((a) => [a.title, a.breached]));
  assert.equal(by['Shop A'], true);
  assert.equal(by['Forum B'], true, 'same password, same prefix');
  assert.equal(by['Bank C'], false, 'padding (count 0) never matches');
  assert.equal(by['Empty D'], null, 'an empty password has nothing to check');
  assert.equal(fetched.length, new Set(fetched).size, 'each prefix once');
  assert.equal(fetched.length, 2, 'two unique prefixes for three non-empty passwords');
  assert.ok(fetched.every((p) => /^[0-9A-F]{5}$/.test(p)), 'only a 5-hex prefix is ever handed out');
  const map = JSON.parse(fs.readFileSync(path.join(t.dir, 'map.json'), 'utf8'));
  assert.equal(map.accounts.find((a) => a.title === 'Shop A').breached, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, 'status.json'), 'utf8')).breachCheckedAt, NOW.toISOString());
  assert.ok(!sweepText(t.dir).includes(hit), 'no hash on disk');
  assert.ok(!sweepText(t.dir).includes(hit.slice(5)));
});

test('breach check: never more than 4 in flight, every prefix answered once', async () => {
  let inflight = 0, peak = 0; const seen = [];
  const fetchRange = async (prefix) => { seen.push(prefix); inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 15)); inflight--; return 'FFFF:0'; };
  const t = make({ xml: buildXml(manyPasswords(14)), fetchRange });
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: true });
  assert.equal(r.ok, true);
  assert.ok(peak <= 4 && peak >= 2, 'peak ' + peak);
  assert.equal(seen.length, new Set(seen).size);
  assert.equal(seen.length, 14);
  assert.ok(r.accounts.every((a) => a.breached === false));
});

test('breach check: one prefix rejecting -> those accounts null, the note "breach check incomplete", breachCheckedAt stays null; a complete one sets it', async () => {
  const bad = sha1(ENTRIES[2].password).slice(0, 5);
  const fetchRange = async (prefix) => { if (prefix === bad) throw new Error('offline'); return 'FFFF:0'; };
  const t = make({ fetchRange });
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: true });
  assert.equal(r.ok, true);
  assert.equal(r.breachChecked, false);
  assert.ok(r.notes.includes('breach check incomplete'));
  const by = Object.fromEntries(r.accounts.map((a) => [a.title, a.breached]));
  assert.equal(by['Bank C'], null);
  assert.equal(by['Shop A'], false);
  assert.equal(t.st.readStatus().breachCheckedAt, null);
  assert.equal(t.st.readStatus().refreshedAt, NOW.toISOString());
  // a later complete run on the same store sets it
  const v2 = vaultMod.create({ store: t.st, core: coreUnderTest, now: () => NOW, env: { ...process.env, HQ_FAKE_KP_MODE: 'ok', HQ_FAKE_KP_XML: path.join(t.work, 'export.xml') }, findCli: () => FAKE_CLI, allowScriptCli: true, fetchRange: async () => 'FFFF:0' });
  assert.equal((await v2.refresh({ passphrase: PASSPHRASE, checkBreaches: true })).breachChecked, true);
  assert.equal(t.st.readStatus().breachCheckedAt, NOW.toISOString());
});

test('checkBreaches false -> fetchRange never called, breached null everywhere', async () => {
  let n = 0;
  const t = make({ fetchRange: async () => { n++; return ''; } });
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: false });
  assert.equal(r.ok, true);
  assert.equal(n, 0);
  assert.ok(r.accounts.every((a) => a.breached === null));
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  assert.equal(n, 0, 'omitted means off');
});

test('hibpRange: a GET with Add-Padding and the generic User-Agent, only the prefix in the path, a bad prefix refused before any request', async () => {
  const seen = [];
  const https = { request(opts, cb) {
    seen.push(opts);
    const handlers = {};
    const req = { on: (e, f) => { handlers[e] = f; return req; }, end: () => { const res = { statusCode: 200, on: (e, f) => { if (e === 'data') setImmediate(() => f(Buffer.from('ABC:1\r\n'))); if (e === 'end') setImmediate(() => setImmediate(f)); return res; }, resume() {} }; cb(res); }, destroy() {} };
    return req;
  } };
  assert.equal(await vaultMod.hibpRange('ABCDE', { https }), 'ABC:1\r\n');
  assert.equal(seen[0].hostname, 'api.pwnedpasswords.com');
  assert.equal(seen[0].path, '/range/ABCDE');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers['Add-Padding'], 'true');
  assert.equal(seen[0].headers['User-Agent'], 'WorkspaceHQ');
  assert.equal(seen[0].timeout, 10_000);
  await assert.rejects(() => vaultMod.hibpRange('abcde', { https }));
  await assert.rejects(() => vaultMod.hibpRange('ABCDEF', { https }));
  assert.equal(seen.length, 1);
});

// ---------------------------------------------------------------- identities and the ref key
test('crypto unavailable -> refKey null, identities [] after a refresh, no identity ref anywhere in data/security/, and a "locked" note', async () => {
  const t = make({ crypto: nullCrypto });
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => /locked/.test(n)));
  const map = JSON.parse(fs.readFileSync(path.join(t.dir, 'map.json'), 'utf8'));
  assert.deepEqual(map.identities, []);
  assert.ok(map.accounts.every((a) => a.identityRef === null));
  const all = sweepText(t.dir);
  assert.ok(!/i-[0-9a-f]{12}/.test(all), 'no identity ref anywhere');
  assert.ok(!all.includes('"refKey": "enc'), 'no key either');
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).refKey, null);
});

test('with crypto: the refKey is created on the first refresh, kept as enc:..., identities carry sealed labels', async () => {
  const t = make();
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  const s = JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8'));
  assert.match(s.refKey, /^enc:/);
  const map = JSON.parse(fs.readFileSync(path.join(t.dir, 'map.json'), 'utf8'));
  assert.ok(map.identities.length >= 1);
  for (const i of map.identities) { assert.match(i.ref, /^i-[0-9a-f]{12}$/); assert.match(i.label, /^enc:/); }
  assert.ok(t.st.read().map.identities.some((i) => i.label === 'owner@example.test'));
  const refs = map.identities.map((i) => i.ref).sort();
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.dir, 'map.json'), 'utf8')).identities.map((i) => i.ref).sort(), refs, 'a stable ref across refreshes');
});

test('owner edits survive a refresh that renamed the entry', async () => {
  const t = make();
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  const id = t.st.readMap().accounts.find((a) => a.title === 'Shop A').id;
  t.st.editAccount(id, { twofa: 'ente', hiddenFromClaude: true });
  const renamed = ENTRIES.map((e, i) => (i === 0 ? { ...e, title: 'Shop A (renamed)' } : e));
  fs.writeFileSync(path.join(t.work, 'export.xml'), buildXml(renamed));
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  assert.equal(t.st.readMap().accounts.find((a) => a.id === id).title, 'Shop A (renamed)');
  assert.deepEqual(t.st.readOwner().accounts[id], { twofa: 'ente', hiddenFromClaude: true });
});

test('manual accounts carry createdAt; a refresh leaves them alone', async () => {
  const t = make();
  t.st.addManual({ title: 'Paper', host: 'paper.example.test' });
  assert.equal((await t.v.refresh({ passphrase: PASSPHRASE })).ok, true);
  assert.match(t.st.readOwner().manual[0].createdAt, /^2026-11-11T/);
  assert.equal(t.st.readStatus().counts.notInVault, 1);
});

// ---------------------------------------------------------------- findCli
test('findCli: env (tests) -> cliPath setting -> PATH -> Program Files -> null', () => {
  const t = make();
  const dir = tmp();
  const onPath = path.join(dir, 'keepassxc-cli.exe'); fs.writeFileSync(onPath, '');
  const pf = tmp(); fs.mkdirSync(path.join(pf, 'KeePassXC')); const pfCli = path.join(pf, 'KeePassXC', 'keepassxc-cli.exe'); fs.writeFileSync(pfCli, '');
  const setting = path.join(tmp(), 'keepassxc-cli.exe'); fs.writeFileSync(setting, '');
  const envCli = path.join(tmp(), 'env-cli.mjs'); fs.writeFileSync(envCli, '');
  const mk = (env) => vaultMod.makeFindCli({ store: t.st, env })();
  assert.equal(mk({ HQ_KEEPASSXC_CLI: envCli, PATH: dir, ProgramFiles: pf }), envCli);
  assert.equal(mk({ HQ_KEEPASSXC_CLI: path.join(dir, 'gone.mjs'), PATH: dir, ProgramFiles: pf }), onPath, 'an env path that does not exist is skipped');
  assert.equal(mk({ PATH: dir, ProgramFiles: pf }), onPath);
  assert.equal(mk({ PATH: tmp(), ProgramFiles: pf }), pfCli);
  assert.equal(mk({ PATH: tmp(), ProgramFiles: tmp() }), null);
  t.st.setSettings({ cliPath: setting });
  assert.equal(mk({ PATH: dir, ProgramFiles: pf }), setting, 'the setting beats PATH');
  assert.equal(mk({ HQ_KEEPASSXC_CLI: envCli, PATH: dir }), envCli, 'env beats the setting');
});

// ---------------------------------------------------------------- scans
function withOpenSpy() {
  const opened = [];
  const real = fs;
  const spy = new Proxy(real, { get(target, k) {
    if (['openSync', 'readFileSync', 'createReadStream', 'readSync', 'open', 'readFile', 'promises'].includes(k)) return (...a) => { opened.push(String(k)); throw new Error('contents must never be opened'); };
    const v = target[k]; return typeof v === 'function' ? v.bind(target) : v;
  } });
  return { spy, opened };
}

test('scanExports: top-level names only, anchored; contents never opened; false-positive names are NOT found', () => {
  const root = tmp();
  const put = (rel) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'.repeat(10)); };
  for (const f of ['Chrome Passwords.csv', 'bitwarden_export_20261111.json', '1password-export.1pux', 'my_keepass_dump.xml', 'ente-auth export.txt', 'authenticator backup export.json', 'passwords.html']) put(f);
  put('sub/Chrome Passwords.csv');
  for (const f of ['vault.kdbx', 'passwords.kdbx', 'boarding-pass.html', 'bypass.txt', 'compass.json', 'passport-scan.html', 'trespass.csv', 'password-manager-notes.png', 'Chrome Passwords.csv.exe']) put(f);
  const { spy, opened } = withOpenSpy();
  const t = make({ fs: spy });
  const got = t.v.scanExports({ dirs: [root, path.join(root, 'does-not-exist')] });
  const names = got.map((f) => f.name).sort();
  assert.deepEqual(names, ['1password-export.1pux', 'Chrome Passwords.csv', 'authenticator backup export.json', 'bitwarden_export_20261111.json', 'ente-auth export.txt', 'my_keepass_dump.xml', 'passwords.html'].sort());
  assert.ok(!names.includes('vault.kdbx') && !names.includes('passwords.kdbx'));
  assert.deepEqual(opened, [], 'fs.open / readFile never called');
  assert.ok(got.every((f) => f.dir === root && f.size === 10 && !Number.isNaN(Date.parse(f.mtime))));
  assert.equal(got.filter((f) => f.name === 'Chrome Passwords.csv').length, 1, 'sub/Chrome Passwords.csv is not found');
  for (const bad of ['boarding-pass.html', 'bypass.txt', 'compass.json', 'passport-scan.html']) assert.equal(vaultMod.EXPORT_NAME_RE.test(bad), false, bad);
});

test('scanConflicts counts vault.sync-conflict-*.kdbx next to vault.kdbx and nothing else', () => {
  const t = make();
  const dir = t.work;
  for (const f of ['vault.sync-conflict-20261111-101010-ABCDEFG.kdbx', 'vault.sync-conflict-20261112-111111-HIJKLMN.kdbx', 'other.sync-conflict-20261111-101010-ABCDEFG.kdbx', 'vault.kdbx.bak', 'vault-old.kdbx']) fs.writeFileSync(path.join(dir, f), '');
  assert.equal(t.v.scanConflicts(path.join(dir, 'vault.kdbx')), 2);
  assert.equal(t.v.scanConflicts(path.join(dir, 'nothing.kdbx')), 0);
  assert.equal(t.v.scanConflicts(null), 0);
  assert.equal(t.v.scanConflicts(path.join(tmp(), 'vault.kdbx')), 0);
});

test('trashExport: refuses a name not in the last scan, trashes a listed file once, logs without the name', async () => {
  const root = tmp(); fs.writeFileSync(path.join(root, 'Chrome Passwords.csv'), 'x'); fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  const trashed = [], logged = [];
  const t = make({ trash: async (p) => { trashed.push(p); }, log: (n) => logged.push(n) });
  assert.match((await t.v.trashExport('Chrome Passwords.csv', root)).error, /latest scan/, 'no scan yet');
  t.v.scanExports({ dirs: [root] });
  assert.match((await t.v.trashExport('notes.txt', root)).error, /latest scan/);
  assert.match((await t.v.trashExport('Chrome Passwords.csv', path.join(root, 'sub'))).error, /latest scan/, 'right name, wrong dir');
  assert.match((await t.v.trashExport('..\\..\\Chrome Passwords.csv', root)).error, /latest scan/);
  assert.equal(trashed.length, 0);
  assert.deepEqual(await t.v.trashExport('Chrome Passwords.csv', root), { ok: true });
  assert.deepEqual(trashed, [path.join(root, 'Chrome Passwords.csv')]);
  assert.deepEqual(logged, ['moved a plain export to the Recycle Bin']);
  assert.ok(!logged.join('').includes('Chrome'));
  assert.match((await t.v.trashExport('Chrome Passwords.csv', root)).error, /latest scan/, 'a second try: gone from the list');
  assert.equal(trashed.length, 1);
});

test('trashExport: a failing Recycle Bin is an honest error and the list keeps the file', async () => {
  const root = tmp(); fs.writeFileSync(path.join(root, 'passwords.csv'), 'x');
  const t = make({ trash: async () => { throw new Error('denied'); } });
  t.v.scanExports({ dirs: [root] });
  assert.match((await t.v.trashExport('passwords.csv', root)).error, /Recycle Bin/);
  const t2 = make();
  t2.v.scanExports({ dirs: [root] });
  assert.match((await t2.v.trashExport('passwords.csv', root)).error, /not available/);
});

// ---------------------------------------------------------------- the real core, when the other dish has landed
test('refresh against the real security-core on the same invented export: ok, and no secret on disk', async (ctx) => {
  const real = await loadRealCore();
  if (!real) return ctx.skip('security-core.mjs has not landed yet');
  const t = make({ core: real });
  const r = await t.v.refresh({ passphrase: PASSPHRASE, checkBreaches: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const f of allFiles(t.dir)) real.assertNoSecrets(fs.readFileSync(f, 'utf8'), secretsOf());
});

// ---------------------------------------------------------------- batch 4 taster fix: the script seam is a test seam only
test('a script cli (.mjs/.js) is refused in the app: only keepassxc-cli.exe runs unless a test injects allowScriptCli; nothing is spawned', async () => {
  const t = make();
  const calls = [];
  const spawn = (...a) => { calls.push(a); throw new Error('must not spawn'); };
  const prod = (findCli) => vaultMod.create({ store: t.st, core: coreUnderTest, spawn, now: () => NOW, env: { ...process.env }, findCli });
  for (const cli of [FAKE_CLI, path.join(t.work, 'evil.js'), path.join(t.work, 'other.exe'), path.join(t.work, 'keepassxc-cli.exe.js')]) {
    const r = await prod(() => cli).refresh({ passphrase: PASSPHRASE });
    assert.match(r.error, /keepassxc-cli\.exe/, cli);
  }
  assert.equal(calls.length, 0, 'the passphrase never reached a spawn');
  // the real name is accepted (the fake spawn is reached, which then fails as "could not be started")
  const real = await prod(() => path.join(t.work, 'KeePassXC-CLI.EXE')).refresh({ passphrase: PASSPHRASE });
  assert.equal(calls.length, 1);
  assert.match(real.error, /could not be started/);
});

test('the test seam pins ELECTRON_RUN_AS_NODE so a script never starts a second Electron app', async () => {
  const t = make();
  const r = await t.v.refresh({ passphrase: PASSPHRASE });
  assert.equal(r.ok, true);
  assert.equal(t.calls[0][2].env.ELECTRON_RUN_AS_NODE, '1');
});
