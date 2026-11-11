// Security store (dashboard/security-store.js): atomic files under data/security/, encrypted labels, owner edits, status.json.
// Temp dirs, a fake crypto and a stub core only; invented data - the repo is public.
//   node --test dashboard/security-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { tmp, fakeCrypto, nullCrypto, stubCore, loadRealCore, sweepText, allFiles } from './security-vault-testkit.mjs';

const require = createRequire(import.meta.url);
const { create, KEEP_SNAPSHOTS } = require('./security-store.js');

const T0 = new Date('2026-11-11T10:00:00Z');
const make = (o = {}) => {
  const dataDir = tmp();
  let n = 0, at = T0.getTime();
  const store = create({ dataDir, crypto: o.crypto || fakeCrypto, core: o.core === undefined ? stubCore : o.core, now: () => new Date(at += 1000), randomBytes: (k) => Buffer.alloc(k, ++n) });
  return { store, dataDir, dir: path.join(dataDir, 'security') };
};
const acct = (i, extra = {}) => ({ id: 'k-' + String(i).padStart(12, '0'), title: 'T' + i, host: 'h' + i + '.example.test', group: 'Root', created: null, modified: null, totp: false, passkey: false, strength: 'weak', reuseGroup: null, old: false, identityRef: null, ...extra });

test('settings: absolute paths only, vault must end .kdbx, unknown keys refused, a .cmd cli refused', () => {
  const { store } = make();
  const abs = path.resolve(tmp(), 'v.kdbx');
  assert.deepEqual(store.setSettings({ vaultPath: abs }), { ok: true });
  assert.equal(store.readSettings().vaultPath, abs);
  assert.match(store.setSettings({ vaultPath: 'relative/v.kdbx' }).error, /absolute/);
  assert.match(store.setSettings({ vaultPath: path.resolve(tmp(), 'v.txt') }).error, /\.kdbx/);
  assert.match(store.setSettings({ cliPath: path.resolve(tmp(), 'x.cmd') }).error, /cmd/);
  for (const bad of ['x.js', 'x.mjs', 'evil.exe', 'keepassxc-cli.exe.js']) assert.match(store.setSettings({ cliPath: path.resolve(tmp(), bad) }).error, /keepassxc-cli.exe/, bad);
  assert.deepEqual(store.setSettings({ cliPath: path.resolve(tmp(), 'KeePassXC-CLI.exe') }), { ok: true });
  assert.ok(store.setSettings({ refKey: 'enc:AAAA' }).error, 'refKey is not settable from outside');
  assert.ok(store.setSettings({}).error);
  assert.deepEqual(store.setSettings({ vaultPath: null }), { ok: true });
  assert.equal(store.readSettings().vaultPath, null);
});

test('the refKey is in settings.json only as enc:..., never plaintext, and survives a re-open', () => {
  const { store, dir, dataDir } = make();
  const key = store.getRefKey({ create: true });
  assert.equal(key.length, 32);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.match(raw.refKey, /^enc:[A-Za-z0-9+/=]+$/);
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes(key.toString('hex')));
  const again = create({ dataDir, crypto: fakeCrypto }).getRefKey({});
  assert.deepEqual(again, key);
  assert.equal(store.getRefKey({ create: true }).equals(key), true, 'not regenerated');
});

test('crypto.encrypt returning null: refKey null, no file, identity add says locked, label stored as null', () => {
  const { store, dir } = make({ crypto: nullCrypto });
  assert.equal(store.getRefKey({ create: true }), null);
  assert.equal(store.cryptoAvailable(), false);
  assert.match(store.addIdentity({ kind: 'email', value: 'owner@example.test' }).error, /locked/);
  const map = store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(1)], identities: [{ ref: 'i-0123456789ab', kind: 'email', value: 'owner@example.test' }] });
  assert.equal(map.identities[0].label, null);
  const all = sweepText(dir);
  assert.ok(!all.includes('owner@example.test'), 'the plaintext appears nowhere in data/security/');
  assert.ok(!all.includes('enc:'), 'no sealed value either');
  assert.equal(store.read().settings.locked, true);
});

test('labels are sealed on disk and decrypted only by read()', () => {
  const { store, dir } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(1)], identities: [{ ref: 'i-0123456789ab', kind: 'email', value: 'owner@example.test' }] });
  assert.ok(!sweepText(dir).includes('owner@example.test'));
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'map.json'), 'utf8')).identities[0].label, /^enc:/);
  assert.equal(store.read().map.identities[0].label, 'owner@example.test');
  assert.ok(!JSON.stringify(store.read()).includes('refKey'), 'the key never leaves');
});

test('writeMap copies accounts through a whitelist: a stray password / notes / username key never reaches disk', () => {
  const { store, dir } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [{ ...acct(1), password: 'Leak-Me-Please-1', notes: 'leak note', username: 'leak-user', url: 'https://x.example.test/secret/path', otp: 'JBSWY3DP' }], identities: [] });
  const all = sweepText(dir);
  for (const s of ['Leak-Me-Please-1', 'leak note', 'leak-user', '/secret/path', 'JBSWY3DP']) assert.ok(!all.includes(s), s);
});

test('editAccount: refuses an unknown key (note), accepts hiddenFromClaude, validates values, clears with null', () => {
  const { store } = make();
  const id = 'k-aaaaaaaaaaaa';
  assert.equal(store.editAccount(id, { note: 'x' }).error, 'unknown field');
  assert.equal(store.editAccount(id, { password: 'x' }).error, 'unknown field');
  assert.ok(store.editAccount(id, { twofa: 'carrier-pigeon' }).error);
  assert.ok(store.editAccount(id, { signInWith: 'not-a-ref' }).error);
  assert.ok(store.editAccount('nope', { archived: true }).error);
  assert.deepEqual(store.editAccount(id, { hiddenFromClaude: true, twofa: 'ente', signInWith: 'i-0123456789ab' }), { ok: true });
  assert.deepEqual(store.readOwner().accounts[id], { hiddenFromClaude: true, twofa: 'ente', signInWith: 'i-0123456789ab' });
  store.editAccount(id, { hiddenFromClaude: false, twofa: null, signInWith: null });
  assert.equal(store.readOwner().accounts[id], undefined, 'an emptied entry is removed');
});

test('owner edits survive a refresh that renamed the entry (ids come from the vault uuid, owner.json is separate)', () => {
  const { store } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(7, { title: 'Old name' })], identities: [] });
  store.editAccount('k-000000000007', { archived: true, twofa: 'sms' });
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(7, { title: 'New name' })], identities: [] });
  assert.deepEqual(store.readOwner().accounts['k-000000000007'], { archived: true, twofa: 'sms' });
  assert.equal(store.readMap().accounts[0].title, 'New name');
});

test('addManual: id m-<12hex>, createdAt ISO, host reduced to a hostname, bad input refused', () => {
  const { store } = make();
  const r = store.addManual({ title: ' Paper account ', host: 'https://Example.TEST/path?q=1' });
  assert.match(r.id, /^m-[0-9a-f]{12}$/);
  const m = store.readOwner().manual[0];
  assert.equal(m.title, 'Paper account');
  assert.equal(m.host, 'example.test');
  assert.match(m.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(store.addManual({ title: '' }).error);
  assert.ok(store.addManual({ title: 'x', host: 'bad host with spaces' }).error);
  assert.equal(store.addManual({ title: 'No host' }).ok, true);
  assert.equal(store.readOwner().manual[1].host, null);
});

test('addIdentity: a stable keyed ref (no plain hash), label sealed, a repeat does not duplicate', () => {
  const { store, dir } = make();
  const a = store.addIdentity({ kind: 'email', value: 'Owner@Example.test' });
  const b = store.addIdentity({ kind: 'email', value: 'owner@example.test' });
  assert.match(a.ref, /^i-[0-9a-f]{12}$/);
  assert.equal(a.ref, b.ref);
  assert.equal(store.readOwner().identities.length, 1);
  assert.ok(!sweepText(dir).toLowerCase().includes('owner@example.test'));
  assert.ok(store.addIdentity({ kind: 'email', value: 'no-at-sign' }).error);
  assert.ok(store.addIdentity({ kind: 'phone', value: '12' }).error);
  assert.equal(store.addIdentity({ kind: 'phone', value: '+1 (555) 010-0199' }).ok, true);
  assert.equal(store.read().owner.identities[0].label, 'Owner@Example.test');
});

test('snapshots.jsonl keeps the last 400 lines', () => {
  const { store, dir } = make();
  for (let i = 0; i < KEEP_SNAPSHOTS + 25; i++) store.appendSnapshot({ at: new Date(T0.getTime() + i).toISOString(), accounts: i, identities: 0, flags: {} });
  const lines = fs.readFileSync(path.join(dir, 'snapshots.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 400);
  assert.equal(JSON.parse(lines[0]).accounts, 25);
  assert.equal(JSON.parse(lines[399]).accounts, 424);
  assert.equal(store.readSnapshots().length, 400);
});

test('status.json: stamped on every write, numbers / booleans / timestamps only, never a name', () => {
  const { store, dir } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(1, { title: 'Secret Shop Name', host: 'secret-host.example.test' })], identities: [] });
  const s1 = store.writeStatus({ refreshedAt: T0.toISOString() });
  const s2 = store.setScanResult({ exportsFound: 2, conflicts: 1 }).status;
  assert.ok(s2.at > s1.at, 'a scan write re-stamps at');
  assert.equal(s2.exportsFound, 2);
  assert.equal(s2.conflicts, 1);
  assert.equal(s2.refreshedAt, T0.toISOString(), 'a scan keeps the refresh time');
  const raw = fs.readFileSync(path.join(dir, 'status.json'), 'utf8');
  assert.ok(!raw.includes('Secret Shop Name') && !raw.includes('secret-host'));
  const leaves = [];
  (function walk(v) { if (v && typeof v === 'object') Object.values(v).forEach(walk); else leaves.push(v); })(JSON.parse(raw));
  for (const l of leaves) assert.ok(l === null || typeof l === 'number' || typeof l === 'boolean' || (typeof l === 'string' && !Number.isNaN(Date.parse(l))), String(l));
  const before = store.readStatus().at;
  store.editAccount('k-bbbbbbbbbbbb', { archived: true });
  assert.ok(store.readStatus().at > before, 'an owner edit re-stamps too');
});

test('status counts follow owner edits through the core; walkthrough flags are booleans', () => {
  const { store } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(1), acct(2)], identities: [] });
  assert.equal(store.writeStatus().counts.accounts, 2);
  assert.equal(store.readStatus().walkthroughStarted, false);
  assert.equal(store.readStatus().email2faDone, false);
  store.setWalkthrough('email-2fa', true);
  assert.equal(store.readStatus().walkthroughStarted, true);
  assert.equal(store.readStatus().email2faDone, true);
  store.addManual({ title: 'On paper' });
  assert.equal(store.readStatus().counts.notInVault, 1);
  store.setWalkthrough('email-2fa', false);
  assert.equal(store.readStatus().email2faDone, false);
  assert.ok(store.setWalkthrough('Bad Step', true).error);
});

test('without a core the counts come from the newest snapshot line', () => {
  const { store } = make({ core: null });
  store.appendSnapshot({ at: T0.toISOString(), accounts: 9, identities: 3, flags: { weak: 4, reused: 2, breached: 1, no2fa: 5, old: 0, notInVault: 0 } });
  const s = store.writeStatus();
  assert.equal(s.counts.accounts, 9);
  assert.equal(s.counts.weak, 4);
});

test('writes are atomic: no tmp file is left behind and a corrupt file is quarantined, not overwritten', () => {
  const { store, dir } = make();
  store.writeMap({ refreshedAt: T0.toISOString(), accounts: [acct(1)], identities: [] });
  store.setSettings({ vaultPath: path.resolve(tmp(), 'v.kdbx') });
  store.appendSnapshot({ at: T0.toISOString(), accounts: 1, identities: 0, flags: {} });
  assert.ok(allFiles(dir).every((f) => !f.endsWith('.tmp')));
  fs.writeFileSync(path.join(dir, 'owner.json'), '{ not json');
  assert.deepEqual(store.readOwner().accounts, {});
  assert.ok(fs.existsSync(path.join(dir, 'owner.json.corrupt')));
});

test('an identity added by hand gets the same ref the real security-core gives a vault username (skips until that module exists)', async (ctx) => {
  const real = await loadRealCore();
  if (!real) return ctx.skip('security-core.mjs has not landed yet');
  const { store } = make({ core: real });
  const key = store.getRefKey({ create: true });
  const rows = [['email', 'Owner@Example.test'], ['phone', '+1 (555) 010-0199']];
  const out = real.reduceEntries(rows.map(([, u], i) => ({ uuid: 'u' + i, title: 't', username: u, password: 'x', url: '', notes: '', otp: '', attrKeys: [], modified: null, created: null })), { now: T0, reuseKey: Buffer.alloc(32, 9), refKey: key });
  for (const [kind, value] of rows) {
    const mine = store.addIdentity({ kind, value }).ref;
    assert.ok(out.identities.some((i) => i.ref === mine), `${kind} ref matches the core`);
  }
});
