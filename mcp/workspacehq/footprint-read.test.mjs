// hq_footprint: the read-only Security footprint reader. Invented map in a temp data dir (public repo: example.test names only);
// nothing of the owner's is touched and no vault is opened.
//   node --test mcp/workspacehq/footprint-read.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { read, readFootprint, FLAGS, DEFAULT_LIMIT, MAX_LIMIT, MAX_QUERY, NO_MAP } from './footprint-read.mjs';

// ---- the invented fixture. SECRETS are strings that must never appear in any answer. ----
const PLANTED = {
  username: 'planted-username-zebra',
  group: 'Root/Web/PlantedGroup',
  identityValue: 'owner@example.test',
  label: 'enc:UExBTlRFRC1MQUJFTC1RVUFH',
  vaultPath: 'Z:\\invented\\planted-vault.kdbx',
  keyFile: 'Z:\\invented\\planted.keyx',
  idShop: 'k-aaaaaaaaaaaa', idBank: 'k-bbbbbbbbbbbb', idMail: 'k-cccccccccccc', idOld: 'k-dddddddddddd', idHidden: 'k-eeeeeeeeeeee', idPlain: 'k-ffffffffffff',
  ref: 'i-0123456789ab',
  password: 'correct-horse-planted-pw',
  manualId: 'm-0123456789ab', hiddenManualId: 'm-ba9876543210',
  hiddenTitle: 'Hidden Ledger', hiddenHost: 'hidden-ledger.test', hiddenManualTitle: 'Hidden Manual Thing',
};
const SECRETS = [PLANTED.username, PLANTED.group, PLANTED.identityValue, PLANTED.label, PLANTED.vaultPath, PLANTED.keyFile, PLANTED.idShop, PLANTED.idBank, PLANTED.idMail,
  PLANTED.idOld, PLANTED.idHidden, PLANTED.idPlain, PLANTED.ref, PLANTED.password, PLANTED.manualId, PLANTED.hiddenManualId, 'IDENTITY-LABEL'];

// Every account carries stray fields a careless reader could copy: username, group, id, identityRef, password, notes.
const stray = (o) => ({ username: PLANTED.username, group: PLANTED.group, identityRef: PLANTED.ref, password: PLANTED.password, notes: 'note ' + PLANTED.password, created: '2020-01-01T00:00:00Z', modified: '2020-01-01T00:00:00Z', ...o });
const MAP = {
  v: 1, refreshedAt: '2026-11-10T09:00:00.000Z',
  accounts: [
    stray({ id: PLANTED.idShop, title: 'Acme Shop', host: 'acme.test', totp: false, passkey: false, strength: 'weak', reuseGroup: 1, old: false, breached: true }),
    stray({ id: PLANTED.idBank, title: 'Alpha Bank', host: 'alpha-site.test', totp: true, passkey: false, strength: 'strong', reuseGroup: null, old: false, breached: false }),
    stray({ id: PLANTED.idMail, title: 'Example Mail', host: 'example.test', totp: false, passkey: true, strength: 'fair', reuseGroup: 1, old: true, breached: null }),
    stray({ id: PLANTED.idOld, title: 'Old Forum', host: 'forum.example.test', totp: false, passkey: false, strength: 'strong', reuseGroup: null, old: true, breached: null }),
    stray({ id: PLANTED.idHidden, title: PLANTED.hiddenTitle, host: PLANTED.hiddenHost, totp: false, passkey: false, strength: 'weak', reuseGroup: 2, old: true, breached: true }),
    stray({ id: PLANTED.idPlain, title: 'owner@example.test', host: 'login.example.test', totp: false, passkey: false, strength: 'strong', reuseGroup: null, old: false, breached: false }),
  ],
  identities: [{ ref: PLANTED.ref, kind: 'email', label: PLANTED.label }],
};
const OWNER = {
  v: 1,
  accounts: {
    [PLANTED.idShop]: { twofa: 'none', signInWith: PLANTED.ref, recoveryRef: PLANTED.ref },
    [PLANTED.idMail]: { twofa: 'ente' },
    [PLANTED.idOld]: { archived: true },
    [PLANTED.idHidden]: { hiddenFromClaude: true },
    [PLANTED.hiddenManualId]: { hiddenFromClaude: true },
    'k-vanished0000': { hiddenFromClaude: true, twofa: 'none' },   // an owner edit whose account is gone from the vault
  },
  manual: [
    { id: PLANTED.manualId, title: 'Hand Added Club', host: 'club.example.test', createdAt: '2026-10-01T00:00:00Z' },
    { id: PLANTED.hiddenManualId, title: PLANTED.hiddenManualTitle, host: 'hidden-manual.test', createdAt: '2026-10-02T00:00:00Z' },
  ],
  identities: [{ ref: PLANTED.ref, kind: 'email', label: PLANTED.label }],
};

let dir, dataDir, secDir;
const write = (name, v) => fs.writeFileSync(path.join(secDir, name), typeof v === 'string' ? v : JSON.stringify(v));
function seed(map = MAP, owner = OWNER) {
  fs.rmSync(secDir, { recursive: true, force: true });
  fs.mkdirSync(secDir, { recursive: true });
  if (map !== null) write('map.json', map);
  if (owner !== null) write('owner.json', owner);
  // the files this tool must NEVER open: the vault path, the status numbers, the history
  write('settings.json', { v: 1, vaultPath: PLANTED.vaultPath, keyFilePath: PLANTED.keyFile, cliPath: null, refKey: 'enc:' + Buffer.from('planted-ref-key').toString('base64'), walkthrough: {} });
  write('snapshots.jsonl', '{"at":"2026-11-01T00:00:00Z","accounts":6,"identities":1,"flags":{"weak":2,"reused":2,"breached":2,"no2fa":3,"old":2,"notInVault":0}}\n');
  write('status.json', { v: 1, at: '2026-11-10T09:00:00.000Z', refreshedAt: '2026-11-10T09:00:00.000Z', breachCheckedAt: null, counts: {}, exportsFound: 0, conflicts: 0, email2faDone: false, walkthroughStarted: false });
}
function listing() {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const st = fs.statSync(p); out.push(`${path.relative(dataDir, p)}|${st.isDirectory() ? 'd' : st.size}|${st.mtimeMs}`); if (st.isDirectory()) walk(p); } };
  walk(dataDir);
  return out;
}
// assertNoSecrets-style: no planted string (length >= 4) appears anywhere in the serialized answer
function assertNoSecrets(value, secrets) {
  const s = JSON.stringify(value);
  for (const x of secrets) if (x.length >= 4) assert.ok(!s.includes(x), 'leaked: ' + x);
}
const names = (r) => r.rows.map((x) => x.name);

before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-footprint-')); dataDir = path.join(dir, 'data'); secDir = path.join(dataDir, 'security'); fs.mkdirSync(secDir, { recursive: true }); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('exports, constants and the alias', () => {
  assert.equal(readFootprint, read);
  assert.deepEqual([...FLAGS], ['weak', 'reused', 'breached', 'no2fa', 'old', 'not-in-vault']);
  assert.equal(DEFAULT_LIMIT, 20);
  assert.equal(MAX_LIMIT, 50);
  assert.equal(MAX_QUERY, 100);
  assert.equal(NO_MAP, 'the Security map has not been refreshed yet - open WorkspaceHQ > Security');
});

test('no map -> the words, nothing else; no data dir -> the same words', () => {
  seed(null, null);
  fs.rmSync(path.join(secDir, 'settings.json'));
  assert.deepEqual(read(dataDir, {}), { error: 'the Security map has not been refreshed yet - open WorkspaceHQ > Security' });
  assert.deepEqual(read(path.join(dir, 'no-such-dir'), { q: 'x' }), { error: NO_MAP });
  assert.deepEqual(read('', {}), { error: NO_MAP });
});

test('a hiddenFromClaude account never appears in rows (name or host) and is counted in hiddenCount', () => {
  seed();
  const r = read(dataDir, { limit: 50 });
  const s = JSON.stringify(r.rows);
  for (const hidden of [PLANTED.hiddenTitle, PLANTED.hiddenHost, PLANTED.hiddenManualTitle, 'hidden-manual.test', 'hidden-ledger']) assert.ok(!s.includes(hidden), hidden);
  assert.equal(r.hiddenCount, 2, 'one map account and one hand-added account are hidden; the vanished owner edit is not an account of the map');
  assert.equal(r.total, 6, '4 visible vault accounts + the title-is-an-email one + the visible hand-added one = 6 minus the hidden');
  assert.equal(r.rows.length, 6);
});

test('hiddenCount is identical with and without a q or a flag filter, and total only counts visible matches', () => {
  seed();
  const base = read(dataDir, {}).hiddenCount;
  assert.equal(base, 2);
  for (const opts of [{ q: 'acme' }, { q: 'hidden' }, { q: 'zzz-nothing' }, { q: PLANTED.hiddenHost }, { flag: 'breached' }, { flag: 'weak' }, { flag: 'old' }, { flag: 'reused' }, { flag: 'no2fa' }, { flag: 'not-in-vault' }, { flag: 'old', q: 'forum' }, { limit: 1 }]) {
    const r = read(dataDir, opts);
    assert.equal(r.hiddenCount, base, JSON.stringify(opts));
    assert.ok(!r.rows.some((x) => x.name === PLANTED.hiddenTitle || x.host === PLANTED.hiddenHost), JSON.stringify(opts));
  }
  // the hidden account is weak + reused + old + breached: no filter may count it
  assert.equal(read(dataDir, { flag: 'breached' }).total, 1, 'only Acme Shop; the hidden breached one is not in the total');
  assert.equal(read(dataDir, { q: 'hidden' }).total, 0);
  assert.equal(read(dataDir, { q: 'hidden' }).rows.length, 0);
  // two maps that differ ONLY in a hidden account's flags answer identically for every filter
  const a = [];
  const b = [];
  const map2 = JSON.parse(JSON.stringify(MAP));
  const h = map2.accounts.find((x) => x.id === PLANTED.idHidden);
  Object.assign(h, { strength: 'strong', reuseGroup: null, old: false, breached: false, totp: true });
  for (const opts of [{}, { flag: 'breached' }, { flag: 'weak' }, { flag: 'old' }, { flag: 'reused' }, { flag: 'no2fa' }]) a.push(read(dataDir, opts));
  seed(map2);
  for (const opts of [{}, { flag: 'breached' }, { flag: 'weak' }, { flag: 'old' }, { flag: 'reused' }, { flag: 'no2fa' }]) b.push(read(dataDir, opts));
  assert.deepEqual(a, b);
});

test('the JSON of every answer over the seeded fixture contains no identity value, label, username, group, account id, ref or vault path', () => {
  seed();
  const every = [{}, { limit: 50 }, { q: 'acme' }, { q: 'example' }, { q: 'k-' }, { q: 'enc:' }, ...FLAGS.map((flag) => ({ flag })), { flag: 'no2fa', q: 'club' }];
  for (const opts of every) {
    const r = read(dataDir, opts);
    assert.ok(!r.error, JSON.stringify(opts));
    assertNoSecrets(r, SECRETS);
  }
  // the stray fields are never keys of a row either
  for (const row of read(dataDir, { limit: 50 }).rows) assert.deepEqual(Object.keys(row), ['name', 'host', 'flags', 'twofa', 'archived']);
  assert.deepEqual(Object.keys(read(dataDir, {})), ['refreshedAt', 'rows', 'hiddenCount', 'total', 'note']);
});

test('flags: derived from the map and the owner edits; breached is true-only; null breached is no flag', () => {
  seed();
  const r = read(dataDir, { limit: 50 });
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.deepEqual(by['Acme Shop'].flags, ['weak', 'reused', 'breached', 'no2fa'], 'owner says twofa none');
  assert.equal(by['Acme Shop'].twofa, 'none');
  assert.deepEqual(by['Alpha Bank'].flags, [], 'totp in the vault: a second step exists');
  assert.equal(by['Alpha Bank'].twofa, 'totp');
  assert.deepEqual(by['Example Mail'].flags, ['reused', 'old'], 'owner says ente, so no no2fa; breached null is no flag');
  assert.equal(by['Example Mail'].twofa, 'ente');
  assert.deepEqual(by['Old Forum'].flags, ['no2fa', 'old'], 'unknown method and neither totp nor passkey');
  assert.equal(by['Old Forum'].archived, true);
  assert.equal(by['Old Forum'].twofa, 'unknown');
  assert.deepEqual(by['Hand Added Club'].flags, ['no2fa', 'not-in-vault']);
  assert.equal(by['Hand Added Club'].host, 'club.example.test');
  assert.equal(by['Hand Added Club'].archived, false);
});

test('flag filter "breached" returns only breached rows; every flag filter returns only rows carrying it', () => {
  seed();
  const r = read(dataDir, { flag: 'breached' });
  assert.deepEqual(names(r), ['Acme Shop']);
  assert.ok(r.rows.every((x) => x.flags.includes('breached')));
  for (const f of FLAGS) {
    const x = read(dataDir, { flag: f });
    assert.ok(x.rows.every((row) => row.flags.includes(f)), f);
    assert.equal(x.total, x.rows.length, f);
  }
  assert.deepEqual(names(read(dataDir, { flag: 'not-in-vault' })), ['Hand Added Club']);
  assert.deepEqual(names(read(dataDir, { flag: 'old' })).sort(), ['Example Mail', 'Old Forum']);
});

test('bad arguments are refused with words: a 101-character q, an unknown flag, a non-text q, a bad limit', () => {
  seed();
  assert.match(read(dataDir, { q: 'x'.repeat(101) }).error, /q is too long \(100 characters at most\)/);
  assert.ok(!read(dataDir, { q: 'x'.repeat(100) }).error, '100 characters is allowed');
  assert.match(read(dataDir, { flag: 'secret' }).error, /flag must be one of weak, reused, breached, no2fa, old, not-in-vault/);
  assert.match(read(dataDir, { flag: 42 }).error, /flag must be one of/);
  assert.match(read(dataDir, { q: 42 }).error, /q must be text/);
  assert.match(read(dataDir, { q: {} }).error, /q must be text/);
  for (const limit of ['5', 1.5, NaN, {}, true]) assert.match(read(dataDir, { limit }).error, /limit must be a whole number from 1 to 50/, String(limit));
  // a refused argument comes before any file is read, so it is the same answer with no map at all
  seed(null, null);
  assert.match(read(dataDir, { q: 'x'.repeat(101) }).error, /too long/);
});

test('q matches the name or the host, case-insensitively; blank q and null args mean no filter', () => {
  seed();
  assert.deepEqual(names(read(dataDir, { q: 'ACME' })), ['Acme Shop']);
  assert.deepEqual(names(read(dataDir, { q: 'alpha-site.TEST' })), ['Alpha Bank']);
  assert.deepEqual(names(read(dataDir, { q: '  forum  ' })), ['Old Forum']);
  assert.equal(read(dataDir, { q: '   ' }).total, 6);
  assert.equal(read(dataDir, { q: null, flag: null, limit: null }).total, 6);
  assert.equal(read(dataDir, { flag: '' }).total, 6);
  assert.equal(read(dataDir, undefined).total, 6);
  assert.equal(read(dataDir, null).total, 6);
});

test('limit: default 20, at most 50 rows, at least 1; total still counts every visible match', () => {
  const big = JSON.parse(JSON.stringify(MAP));
  big.accounts = Array.from({ length: 80 }, (_, i) => stray({ id: 'k-' + String(i).padStart(12, '0'), title: 'Site ' + String(i).padStart(2, '0'), host: 'site-' + i + '.example.test', totp: true, strength: 'strong', reuseGroup: null, old: false, breached: false }));
  seed(big, { v: 1, accounts: {}, manual: [], identities: [] });
  const d = read(dataDir, {});
  assert.equal(d.rows.length, 20);
  assert.equal(d.total, 80);
  assert.equal(d.hiddenCount, 0);
  assert.equal(read(dataDir, { limit: 50 }).rows.length, 50);
  assert.equal(read(dataDir, { limit: 500 }).rows.length, 50);
  assert.equal(read(dataDir, { limit: 0 }).rows.length, 1);
  assert.equal(read(dataDir, { limit: -3 }).rows.length, 1);
  assert.equal(read(dataDir, { limit: 7 }).rows.length, 7);
});

test('rows are sorted most-to-fix first, then by name; the order is stable', () => {
  seed();
  const r = read(dataDir, { limit: 50 });
  assert.equal(r.rows[0].name, 'Acme Shop', 'four flags');
  const counts = r.rows.map((x) => x.flags.length);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.deepEqual(read(dataDir, { limit: 50 }), r);
});

test('a title that is itself an email address or a phone number is not returned as written; a host with a user part is dropped', () => {
  const map = JSON.parse(JSON.stringify(MAP));
  map.accounts.push(stray({ id: 'k-111111111111', title: '+1 (555) 010-0199', host: 'phone.example.test', totp: true, strength: 'strong', reuseGroup: null, old: false, breached: false }));
  map.accounts.push(stray({ id: 'k-222222222222', title: 'owner@example.test', host: null, totp: true, strength: 'strong', reuseGroup: null, old: false, breached: false }));
  map.accounts.push(stray({ id: 'k-333333333333', title: 'Line one\nline two\u0007', host: 'user:pass@leaky.example.test/path', totp: true, strength: 'strong', reuseGroup: null, old: false, breached: false }));
  seed(map);
  const r = read(dataDir, { limit: 50 });
  assertNoSecrets(r, ['owner@example.test', '555', '0199', 'user:pass', 'leaky.example.test', '/path']);
  const s = JSON.stringify(r);
  assert.ok(s.includes('login.example.test'), 'the email-titled account is shown by its host');
  assert.ok(s.includes('phone.example.test'));
  assert.ok(s.includes('unnamed account'), 'an email title and no host');
  const multi = r.rows.find((x) => x.name.startsWith('Line one'));
  assert.equal(multi.name, 'Line one line two');
  assert.equal(multi.host, null);
  assert.equal(read(dataDir, { q: 'owner@example.test' }).total, 0, 'the identity cannot be found by searching for it');
  // names are clamped to 120 characters
  const long = JSON.parse(JSON.stringify(MAP));
  long.accounts.push(stray({ id: 'k-444444444444', title: 'N'.repeat(500), host: null, totp: true, strength: 'strong', reuseGroup: null, old: false, breached: false }));
  seed(long);
  assert.ok(read(dataDir, { limit: 50 }).rows.every((x) => x.name.length <= 120));
});

test('it reads only map.json and owner.json: never settings.json, snapshots.jsonl or status.json, and writes nothing', () => {
  seed();
  const opened = [];
  const spy = {
    statSync: (p) => { opened.push(String(p)); return fs.statSync(p); },
    readFileSync: (p, enc) => { opened.push(String(p)); return fs.readFileSync(p, enc); },
    openSync: (p) => { opened.push(String(p)); throw new Error('open is not allowed'); },
    writeFileSync: () => { throw new Error('write is not allowed'); },
    readdirSync: (p) => { opened.push(String(p)); throw new Error('readdir is not allowed'); },
  };
  const before = listing();
  const r = read(dataDir, { fsMod: spy, limit: 50 });
  assert.ok(!r.error);
  assert.deepEqual([...new Set(opened.map((p) => path.basename(p)))].sort(), ['map.json', 'owner.json']);
  assert.deepEqual(listing(), before, 'nothing written, touched or created');
});

test('a corrupt or oversized map is an error in words; a corrupt owner.json FAILS CLOSED (no rows at all); a missing owner.json is no edits', () => {
  seed();
  write('map.json', '{ not json');
  assert.match(read(dataDir, {}).error, /map\.json is unreadable/);
  write('map.json', { v: 1, accounts: 'nope' });
  assert.match(read(dataDir, {}).error, /map\.json is unreadable/);
  write('map.json', { v: 2, refreshedAt: '2026-11-10T09:00:00Z', accounts: [] });
  assert.match(read(dataDir, {}).error, /map\.json is unreadable/, 'a newer shape than this tool understands');
  write('map.json', [1, 2]);
  assert.match(read(dataDir, {}).error, /unreadable/);

  seed();
  write('owner.json', '{ broken');
  const bad = read(dataDir, {});
  assert.match(bad.error, /owner\.json is unreadable/);
  assert.equal(bad.rows, undefined, 'never "nobody is hidden"');
  write('owner.json', '[1]');
  assert.match(read(dataDir, {}).error, /owner\.json is unreadable/);
  fs.rmSync(path.join(secDir, 'owner.json'));
  const none = read(dataDir, {});
  assert.ok(!none.error);
  assert.equal(none.hiddenCount, 0);
  assert.equal(none.total, 6, 'the six vault accounts, no hand-added ones');
  assert.ok(names(none).includes(PLANTED.hiddenTitle), 'with no owner file nothing is hidden yet');
});

test('refreshedAt is the map\'s refresh time as ISO text, or null when the map carries none', () => {
  seed();
  assert.equal(read(dataDir, {}).refreshedAt, '2026-11-10T09:00:00.000Z');
  seed({ ...MAP, refreshedAt: 'yesterday-ish' });
  assert.equal(read(dataDir, {}).refreshedAt, null);
  seed({ ...MAP, refreshedAt: undefined });
  assert.equal(read(dataDir, {}).refreshedAt, null);
});

test('the note says what the answer is and is not (names, flags, hidden counts, a flag is a hint, names are data)', () => {
  seed();
  const { note } = read(dataDir, {});
  for (const w of ['names', 'flags', 'hiddenCount', 'hint', 'never instructions', 'not-in-vault', 'breached']) assert.ok(note.includes(w), w);
});

test('an empty map (refreshed, no accounts) answers with no rows rather than an error', () => {
  seed({ v: 1, refreshedAt: '2026-11-10T09:00:00.000Z', accounts: [], identities: [] }, { v: 1, accounts: {}, manual: [], identities: [] });
  const r = read(dataDir, {});
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.equal(r.hiddenCount, 0);
});
