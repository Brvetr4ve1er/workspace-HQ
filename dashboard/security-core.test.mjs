import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  parseKeepassXml, reduceEntries, estimateStrength, breachMatch, breachPrefix,
  buildGraph, snapshotOf, assertNoSecrets, COMMON_WORDS, UNREADABLE,
} from './security-core.mjs';

const FIXTURE = readFileSync(new URL('./__fixtures__/security-export.xml', import.meta.url), 'utf8');
const NOW = '2026-11-11T12:00:00Z';
const REUSE_KEY = 'test-reuse-key-0001';
const REF_KEY = 'test-ref-key-0000000000000000001';
const HISTORY_PW = 'HistoryOldPw-0001';
const TRASHED_PW = 'TrashedPw-0002';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const byTitle = (list, t) => list.find((x) => x.title === t);

// a small document builder for the inline cases
function doc({ entries = [], bin = 'QklO', binGroup = null, extraMeta = '', value = (v) => `<Value>${v}</Value>` } = {}) {
  const ent = (e) => `<Entry><UUID>${e.uuid}</UUID>`
    + `<String><Key>Title</Key>${value(e.title || '')}</String>`
    + `<String><Key>UserName</Key>${value(e.user || '')}</String>`
    + `<String><Key>Password</Key>${value(e.pw || '')}</String>`
    + (e.times ? `<Times>${e.times}</Times>` : '') + '</Entry>';
  return `<?xml version="1.0"?><KeePassFile><Meta><RecycleBinUUID>${bin}</RecycleBinUUID>${extraMeta}</Meta><Root>`
    + `<Group><UUID>cm9vdA==</UUID><Name>Root</Name>${entries.map(ent).join('')}`
    + (binGroup ? `<Group><UUID>${bin}</UUID><Name>${binGroup.name}</Name>${binGroup.entries.map(ent).join('')}</Group>` : '')
    + '</Group></Root></KeePassFile>';
}

function allSecrets(parsed) {
  const out = [];
  for (const e of parsed.entries) for (const k of ['password', 'notes', 'otp', 'username']) if (e[k]) out.push(e[k]);
  return out;
}

test('parseKeepassXml reads the fixture: 6 entries, nested groups, History and Recycle Bin skipped, entities unescaped', () => {
  const r = parseKeepassXml(FIXTURE);
  assert.equal(r.error, undefined);
  assert.equal(r.entries.length, 6);
  assert.deepEqual(r.entries.map((e) => e.title).sort(), ['Forum', 'Mail Example', 'Passkey Site', 'Shop One', 'Shop Two', 'Strong One']);
  assert.equal(byTitle(r.entries, 'Shop One').group, 'Root/Web/Shops');
  assert.equal(byTitle(r.entries, 'Forum').group, 'Root/Web');
  assert.equal(byTitle(r.entries, 'Mail Example').group, 'Root');
  const mail = byTitle(r.entries, 'Mail Example');
  assert.equal(mail.password, 'Tr0ub&dor<Fix>9x');
  assert.equal(mail.notes, 'Recovery hint: pet name & street (fixture)');
  assert.ok(mail.otp.startsWith('otpauth://totp/'));
  assert.equal(mail.created, '2021-03-04T10:00:00.000Z');
  const dump = JSON.stringify(r.entries);
  assert.ok(!dump.includes(HISTORY_PW), 'history password is skipped');
  assert.ok(!dump.includes(TRASHED_PW), 'recycle bin entry is skipped');
  assert.ok(!dump.includes('Trashed Entry'));
  assert.ok(!dump.includes('FIXTURE-BINARY'), 'Meta/Binaries never read');
  // the strong entry is read once (not its history copy)
  assert.equal(r.entries.filter((e) => e.title === 'Strong One').length, 1);
  assert.equal(byTitle(r.entries, 'Strong One').password, 'k7#Qv9!zT2@mX5$wL8&e');
});

test('parseKeepassXml: truncated and empty documents return the honest error without throwing', () => {
  assert.deepEqual(parseKeepassXml('<KeePassFile><Root>'), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml(''), { entries: [], error: 'unreadable export' });
  assert.deepEqual(parseKeepassXml('   '), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml(null), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml('not xml at all'), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml('<a><b></a></b>'), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml('<Other><Root/></Other>'), { entries: [], error: UNREADABLE });
  assert.deepEqual(parseKeepassXml(FIXTURE.slice(0, FIXTURE.length - 40)), { entries: [], error: UNREADABLE });
});

test('parseKeepassXml: any Value Protected="True" means the export is not plaintext', () => {
  const protectedDoc = doc({
    entries: [{ uuid: 'AQ==', title: 'X', user: 'u', pw: 'x' }],
  }).replace('<Key>Password</Key><Value>x</Value>', '<Key>Password</Key><Value Protected="True">c2VjcmV0LWJhc2U2NA==</Value>');
  assert.ok(protectedDoc.includes('Protected="True"'));
  assert.deepEqual(parseKeepassXml(protectedDoc), { entries: [], error: UNREADABLE });
  // lower-case and single-quoted variants are caught too
  assert.equal(parseKeepassXml(protectedDoc.replace('Protected="True"', "Protected='true'")).error, UNREADABLE);
  // Protected="False" is plaintext
  const ok = protectedDoc.replace('Protected="True"', 'Protected="False"');
  assert.equal(parseKeepassXml(ok).entries.length, 1);
});

test('parseKeepassXml: the recycle bin is skipped by Meta/RecycleBinUUID even when named in Arabic or French', () => {
  for (const name of ['سلة المحذوفات', 'Corbeille']) {
    const x = doc({
      entries: [{ uuid: 'a1', title: 'Keep', pw: 'keep-pw-123' }],
      binGroup: { name, entries: [{ uuid: 'b1', title: 'Trash', pw: 'trash-pw-123' }] },
    });
    const r = parseKeepassXml(x);
    assert.deepEqual(r.entries.map((e) => e.title), ['Keep'], name);
  }
  // a group NAMED "Recycle Bin" whose id does not match is an ordinary group
  const named = doc({ entries: [], bin: 'AAAAAAAAAAAAAAAAAAAAAA==', binGroup: { name: 'Recycle Bin', entries: [{ uuid: 'c1', title: 'Real', pw: 'real-pw-123' }] } });
  assert.deepEqual(parseKeepassXml(named).entries.map((e) => e.title), ['Real']);
});

test('parseKeepassXml: a Meta/Binaries block is ignored and a non-ISO time becomes null (never old)', () => {
  const x = doc({
    extraMeta: '<Binaries><Binary ID="0" Compressed="True">QkxPQi1CSU5BUlktQkFTRTY0</Binary></Binaries>',
    entries: [
      { uuid: 'a1', title: 'Odd time', pw: 'p-odd-1234', times: '<CreationTime>AAAAAAAAAAA=</CreationTime><LastModificationTime>AQAAAAAAAAA=</LastModificationTime>' },
      { uuid: 'a2', title: 'Iso time', pw: 'p-iso-1234', times: '<LastModificationTime>2020-01-01T00:00:00Z</LastModificationTime>' },
    ],
  });
  const r = parseKeepassXml(x);
  assert.equal(r.entries.length, 2);
  assert.ok(!JSON.stringify(r.entries).includes('QkxPQi1C'));
  const odd = byTitle(r.entries, 'Odd time');
  assert.equal(odd.created, null);
  assert.equal(odd.modified, null);
  const red = reduceEntries(r.entries, { now: NOW });
  assert.equal(byTitle(red.accounts, 'Odd time').old, false);
  assert.equal(byTitle(red.accounts, 'Iso time').old, true);
});

test('parseKeepassXml: CDATA, numeric entities and self-closing values are read tolerantly', () => {
  const x = '<KeePassFile><Root><Group><Name>G</Name><Entry><UUID>x</UUID>'
    + '<String><Key>Title</Key><Value><![CDATA[a & <b>]]></Value></String>'
    + '<String><Key>UserName</Key><Value/></String>'
    + '<String><Key>Password</Key><Value>&#65;&#x42;&amp;lt;</Value></String>'
    + '</Entry></Group></Root></KeePassFile>';
  const r = parseKeepassXml(x);
  assert.equal(r.entries[0].title, 'a & <b>');
  assert.equal(r.entries[0].username, '');
  assert.equal(r.entries[0].password, 'AB&lt;');
});

test('reduceEntries output passes assertNoSecrets for every password, notes, otp (and username with no refKey)', () => {
  const parsed = parseKeepassXml(FIXTURE);
  const secrets = [...allSecrets(parsed), HISTORY_PW, TRASHED_PW, 'FIXTUREPEMBODY', 'FIXTURESECRET0000'];
  assert.ok(secrets.length >= 10);
  // without a refKey nothing reversible exists, so usernames are absent from the whole output too
  const bare = reduceEntries(parsed.entries, { now: NOW, reuseKey: REUSE_KEY });
  assertNoSecrets(bare, secrets);
  assert.deepEqual(bare.identities, []);
  // with a refKey the identity VALUE (an email or phone) is the one intended label; everything else is clean
  const keyed = reduceEntries(parsed.entries, { now: NOW, reuseKey: REUSE_KEY, refKey: REF_KEY });
  const identValues = new Set(keyed.identities.map((i) => i.value));
  const nonIdentUsernames = parsed.entries.map((e) => e.username).filter((u) => u && !identValues.has(u.toLowerCase()) && !/^[+\d ()-]+$/.test(u));
  assertNoSecrets(keyed, [...secrets.filter((s) => !parsed.entries.some((e) => e.username === s)), ...nonIdentUsernames]);
  const stripped = { ...keyed, identities: keyed.identities.map(({ ref, kind }) => ({ ref, kind })) };
  assertNoSecrets(stripped, secrets);
  // no field named like a secret exists on any account
  for (const a of keyed.accounts) {
    for (const k of ['password', 'notes', 'otp', 'username', 'url']) assert.ok(!(k in a), k);
    assert.ok(a.host == null || !a.host.includes('/'), 'host has no path');
  }
  // the URL path and query are gone
  assert.ok(!JSON.stringify(keyed).includes('/inbox'));
  assert.ok(!JSON.stringify(keyed).includes('folder=1'));
  assert.ok(!JSON.stringify(keyed).includes('/boards'));
  // the guard really fires on a leak, and its message does not carry the secret
  assert.throws(() => assertNoSecrets({ x: 'prefix-sample-shared-pw-7Qz' }, ['sample-shared-pw-7Qz']), (e) => !e.message.includes('sample-shared'));
  assert.throws(() => assertNoSecrets({ m: new Map([['k', 'abcd-secret']]) }, ['abcd-secret']));
  assert.throws(() => assertNoSecrets({ q: 'say "hi" now' }, ['say "hi" now']), /secret #0/);
  assert.doesNotThrow(() => assertNoSecrets({ x: 'abc' }, ['abc', '', 42, null]));
});

test('reduceEntries: shared passwords share a reuseGroup, unique gets null, empty is strength empty with no group', () => {
  const parsed = parseKeepassXml(FIXTURE);
  const r = reduceEntries(parsed.entries, { now: NOW, reuseKey: REUSE_KEY, refKey: REF_KEY });
  const one = byTitle(r.accounts, 'Shop One');
  const two = byTitle(r.accounts, 'Shop Two');
  assert.equal(one.reuseGroup, 1);
  assert.equal(two.reuseGroup, 1);
  assert.equal(byTitle(r.accounts, 'Mail Example').reuseGroup, null);
  const pk = byTitle(r.accounts, 'Passkey Site');
  assert.equal(pk.strength, 'empty');
  assert.equal(pk.reuseGroup, null);
  assert.equal(r.accounts.length, 6);
  // two empty passwords never form a group
  const twoEmpty = reduceEntries([
    { uuid: 'a', title: 'A', password: '' }, { uuid: 'b', title: 'B', password: '' },
  ], { now: NOW, reuseKey: REUSE_KEY });
  assert.ok(twoEmpty.accounts.every((a) => a.reuseGroup === null));
  // renumbered 1..n in order of first account
  const many = reduceEntries([
    { uuid: '1', title: '1', password: 'aaaa-1111' }, { uuid: '2', title: '2', password: 'bbbb-2222' },
    { uuid: '3', title: '3', password: 'bbbb-2222' }, { uuid: '4', title: '4', password: 'aaaa-1111' },
    { uuid: '5', title: '5', password: 'cccc-3333' },
  ], { now: NOW, reuseKey: REUSE_KEY });
  assert.deepEqual(many.accounts.map((a) => a.reuseGroup), [1, 2, 2, 1, null]);
  // without a reuseKey nothing is grouped
  const nokey = reduceEntries(parsed.entries, { now: NOW });
  assert.ok(nokey.accounts.every((a) => a.reuseGroup === null));
});

test('reduceEntries: account id comes from the UUID, so a rename keeps it; hosts are bare lower-case', () => {
  const parsed = parseKeepassXml(FIXTURE);
  const before = reduceEntries(parsed.entries, { now: NOW });
  const renamed = parseKeepassXml(FIXTURE.replace('<Value>Mail Example</Value>', '<Value>Mail Renamed</Value>'));
  const after = reduceEntries(renamed.entries, { now: NOW });
  const a = byTitle(before.accounts, 'Mail Example');
  const b = byTitle(after.accounts, 'Mail Renamed');
  assert.ok(a && b);
  assert.equal(a.id, b.id);
  assert.match(a.id, /^k-[0-9a-f]{12}$/);
  assert.equal(a.id, 'k-' + sha256('Rml4dHVyZS1lbnRyeS0wMQ==').slice(0, 12));
  assert.equal(a.host, 'mail.example.test');
  assert.equal(byTitle(before.accounts, 'Shop One').host, 'shop.example.test');
  assert.equal(byTitle(before.accounts, 'Forum').host, 'forum.example.test');
  assert.equal(byTitle(before.accounts, 'Strong One').host, null);
  assert.equal(new Set(before.accounts.map((x) => x.id)).size, 6);
  // old: Shop Two was modified in 2023
  assert.equal(byTitle(before.accounts, 'Shop Two').old, true);
  assert.equal(byTitle(before.accounts, 'Mail Example').old, false);
  assert.equal(byTitle(before.accounts, 'Mail Example').group, 'Root');
});

test('reduceEntries (test refKey): an email and a phone become identities, a plain name does not', () => {
  const parsed = parseKeepassXml(FIXTURE);
  const r = reduceEntries(parsed.entries, { now: NOW, refKey: REF_KEY });
  assert.deepEqual(r.identities.map((i) => i.kind).sort(), ['email', 'phone']);
  const email = r.identities.find((i) => i.kind === 'email');
  const phone = r.identities.find((i) => i.kind === 'phone');
  assert.equal(email.value, 'owner@example.test');
  assert.equal(phone.value, '+15550100199');
  const mail = byTitle(r.accounts, 'Mail Example');
  const shop2 = byTitle(r.accounts, 'Shop Two');
  assert.equal(mail.identityRef, email.ref);
  assert.equal(shop2.identityRef, email.ref, 'two accounts, one identity');
  assert.equal(byTitle(r.accounts, 'Shop One').identityRef, phone.ref);
  assert.equal(byTitle(r.accounts, 'Forum').identityRef, null);
  assert.equal(byTitle(r.accounts, 'Strong One').identityRef, null);
  assert.equal(byTitle(r.accounts, 'Passkey Site').identityRef, null);
  // too short or too long a number is not a phone
  const edge = reduceEntries([
    { uuid: 'a', title: 'a', username: '1234567' }, { uuid: 'b', title: 'b', username: '1234567890123456' },
    { uuid: 'c', title: 'c', username: '0612345678' }, { uuid: 'd', title: 'd', username: 'Name@Example.TEST' },
  ], { refKey: REF_KEY });
  assert.deepEqual(edge.identities.map((i) => i.value), ['0612345678', 'name@example.test']);
});

test('reduceEntries: an attribute KPEX_PASSKEY_ sets passkey, a title ending (passkey) too; an otp value or TOTP Seed sets totp', () => {
  const parsed = parseKeepassXml(FIXTURE);
  assert.deepEqual(byTitle(parsed.entries, 'Passkey Site').attrKeys, ['KPEX_PASSKEY_PrivateKeyPEM']);
  const r = reduceEntries(parsed.entries, { now: NOW });
  assert.equal(byTitle(r.accounts, 'Passkey Site').passkey, true);
  assert.equal(byTitle(r.accounts, 'Passkey Site').totp, false);
  assert.equal(byTitle(r.accounts, 'Mail Example').totp, true);
  assert.equal(byTitle(r.accounts, 'Mail Example').passkey, false);
  assert.equal(byTitle(r.accounts, 'Forum').totp, false);
  const more = reduceEntries([
    { uuid: '1', title: 'Site (passkey)', password: '' },
    { uuid: '2', title: 'Seeded', password: '', attrKeys: ['TOTP Seed'] },
    { uuid: '3', title: 'Keyed', password: '', attrKeys: ['otp'] },
    { uuid: '4', title: 'Plain', password: '', otp: '   ' },
  ], { now: NOW });
  assert.deepEqual(more.accounts.map((a) => [a.passkey, a.totp]), [[true, false], [false, true], [false, true], [false, false]]);
});

test('estimateStrength: password1 weak, Summer2024! weak, a 20-char random mixed string strong, empty empty', () => {
  assert.equal(estimateStrength('password1').label, 'weak');
  assert.equal(estimateStrength('Summer2024!').label, 'weak');
  assert.equal(estimateStrength('k7#Qv9!zT2@mX5$wL8&e').label, 'strong');
  assert.deepEqual(estimateStrength(''), { bits: 0, label: 'empty' });
  assert.deepEqual(estimateStrength(undefined), { bits: 0, label: 'empty' });
  assert.equal(estimateStrength('qwerty123456').label, 'weak');
  assert.equal(estimateStrength('abcabcabcabc').label, 'weak');
  assert.equal(estimateStrength('aaaaaaaaaaaaaaaa').label, 'weak');
  assert.equal(estimateStrength('P@ssw0rd2020').label, 'weak', 'leet + year');
  assert.ok(estimateStrength('correct-horse-battery-staple-9!').bits > estimateStrength('Summer2024!').bits);
  assert.ok(['fair', 'strong'].includes(estimateStrength('xT7#mQ2$vL9').label));
  assert.equal(COMMON_WORDS.length, 200);
  assert.equal(new Set(COMMON_WORDS).size, 200);
  assert.ok(COMMON_WORDS.every((w) => w === w.toLowerCase() && w.length >= 4));
  // a pathological length does not hang
  const t0 = Date.now();
  estimateStrength('a1b2c3d4'.repeat(5000));
  assert.ok(Date.now() - t0 < 1000);
});

test('breachMatch: count 3 true, count 0 padding false, absent false, lower-case input normalised', () => {
  const sha1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
  const suffix = sha1.slice(5);
  const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', suffix + ':3', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'].join('\r\n');
  assert.equal(breachMatch(sha1, body), true);
  assert.equal(breachMatch(sha1.toLowerCase(), body), true);
  assert.equal(breachMatch(sha1, body.replace(suffix, suffix.toLowerCase())), true);
  assert.equal(breachMatch(sha1, suffix + ':0\n0018A45C4D1DEF81644B54AB7F969B88D65:5'), false);
  assert.equal(breachMatch(sha1, '0018A45C4D1DEF81644B54AB7F969B88D65:5\n'), false);
  assert.equal(breachMatch(sha1, ''), false);
  assert.equal(breachMatch('nothex', body), false);
  assert.equal(breachMatch(sha1, suffix + ':abc'), false);
  assert.equal(breachPrefix(sha1.toLowerCase()), '5BAA6');
  assert.equal(breachPrefix('x'), '');
  // reduceEntries' hash is the full upper-case sha1 of the password, keyed by account id, memory only
  const r = reduceEntries([{ uuid: 'u1', title: 'T', password: 'password' }, { uuid: 'u2', title: 'E', password: '' }], {});
  assert.ok(r.hashes instanceof Map);
  assert.equal(r.hashes.get(r.accounts[0].id), sha1);
  assert.equal(r.hashes.has(r.accounts[1].id), false);
});

const accountsOf = () => reduceEntries(parseKeepassXml(FIXTURE).entries, { now: NOW, reuseKey: REUSE_KEY, refKey: REF_KEY });

test('buildGraph: identity degree counts its accounts, signInWith adds an edge, an orphan owner edit becomes not-in-vault', () => {
  const { accounts, identities } = accountsOf();
  const email = identities.find((i) => i.kind === 'email');
  const mail = byTitle(accounts, 'Mail Example');
  const forum = byTitle(accounts, 'Forum');
  const g0 = buildGraph({ accounts, identities, owner: {} });
  assert.equal(g0.nodes.find((n) => n.id === email.ref).degree, 2);
  assert.equal(g0.edges.filter((e) => e.kind === 'uses').length, 3);
  assert.equal(g0.nodes.filter((n) => n.kind === 'account').length, 6);

  const owner = {
    accounts: {
      [forum.id]: { signInWith: mail.id, twofa: 'app' },
      'k-orphan000001': { label: 'Gone Site', twofa: 'none' },
      [byTitle(accounts, 'Shop Two').id]: { archived: true },
    },
    manual: [{ id: 'm-1', label: 'Paper club', twofa: 'sms', recoveryRef: email.ref }],
  };
  const g = buildGraph({ accounts, identities, owner });
  assert.ok(g.edges.some((e) => e.a === forum.id && e.b === mail.id && e.kind === 'signs-in-with'));
  assert.ok(g.edges.some((e) => e.a === email.ref && e.b === 'm-1' && e.kind === 'recovers'));
  assert.equal(g.nodes.find((n) => n.id === forum.id).degree, 1, 'the sign-in edge only');
  const orphan = g.nodes.find((n) => n.id === 'k-orphan000001');
  assert.ok(orphan, 'not dropped');
  assert.ok(orphan.flags.includes('not-in-vault'));
  assert.ok(orphan.flags.includes('no2fa'));
  assert.equal(orphan.label, 'Gone Site');
  const man = g.nodes.find((n) => n.id === 'm-1');
  assert.equal(man.kind, 'manual');
  assert.ok(man.flags.includes('not-in-vault'));
  assert.ok(!man.flags.includes('no2fa'), 'owner said sms');
  assert.equal(g.nodes.some((n) => n.label === 'Shop Two'), false, 'archived accounts leave the graph');
  // forum owner said app 2fa, so no 'no2fa'
  assert.ok(!g.nodes.find((n) => n.id === forum.id).flags.includes('no2fa'));
  // dangling targets never make an edge
  const g2 = buildGraph({ accounts, identities, owner: { accounts: { [forum.id]: { signInWith: 'k-nothere', recoveryRef: 'i-nothere' } } } });
  assert.equal(g2.edges.some((e) => e.kind !== 'uses'), false);
  // empty input is a valid empty graph
  assert.deepEqual(buildGraph(), { nodes: [], edges: [] });
});

test('buildGraph flags: weak, reused, breached, no2fa, old', () => {
  const { accounts, identities } = accountsOf();
  const g = buildGraph({ accounts, identities, owner: {}, breached: new Set([byTitle(accounts, 'Mail Example').id]) });
  const flagsOf = (t) => g.nodes.find((n) => n.id === byTitle(accounts, t).id).flags;
  assert.deepEqual(flagsOf('Forum'), ['weak', 'no2fa']);
  assert.deepEqual(flagsOf('Shop One'), ['reused', 'no2fa']);
  assert.deepEqual(flagsOf('Shop Two'), ['reused', 'no2fa', 'old']);
  assert.deepEqual(flagsOf('Mail Example'), ['breached']);
  assert.deepEqual(flagsOf('Passkey Site'), ['old']); // modified 2025-07-07, more than a year before NOW
  assert.deepEqual(flagsOf('Strong One'), ['no2fa']);
  // the breached input may also be an array, or a boolean on the account
  const g3 = buildGraph({ accounts, identities, owner: {}, breached: [byTitle(accounts, 'Forum').id] });
  assert.ok(g3.nodes.find((n) => n.id === byTitle(accounts, 'Forum').id).flags.includes('breached'));
  const g4 = buildGraph({ accounts: [{ ...accounts[0], breached: true }], identities: [], owner: {} });
  assert.ok(g4.nodes[0].flags.includes('breached'));
  // owner twofa 'none' flags even a totp account; a prototype-ish key is just an id
  const g5 = buildGraph({ accounts, identities, owner: { accounts: { [byTitle(accounts, 'Mail Example').id]: { twofa: 'none' }, __proto__x: { archived: false } } } });
  assert.ok(g5.nodes.find((n) => n.id === byTitle(accounts, 'Mail Example').id).flags.includes('no2fa'));
});

test('snapshotOf returns numbers only (every leaf a number or the ISO at)', () => {
  const { accounts, identities } = accountsOf();
  const s = snapshotOf({ accounts, identities, breached: [byTitle(accounts, 'Forum').id] }, { manual: [{ id: 'm-1', label: 'x' }] }, NOW);
  assert.equal(s.at, '2026-11-11T12:00:00.000Z');
  assert.equal(s.accounts, 7);
  assert.equal(s.identities, 2);
  assert.deepEqual(s.flags, { weak: 1, reused: 2, breached: 1, no2fa: 5, old: 2, notInVault: 1 });
  const leaves = [];
  const walk = (v, k) => {
    if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
    else leaves.push([k, v]);
  };
  walk(s, 'root');
  for (const [k, v] of leaves) assert.ok(k === 'at' ? typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) : typeof v === 'number', k);
  assertNoSecrets(s, [...allSecrets(parseKeepassXml(FIXTURE)), 'owner@example.test', 'Mail Example']);
  // a built graph works as input too
  const g = buildGraph({ accounts, identities, owner: {} });
  assert.equal(snapshotOf(g, {}, NOW).accounts, 6);
  assert.deepEqual(snapshotOf(null, null, NOW).flags, { weak: 0, reused: 0, breached: 0, no2fa: 0, old: 0, notInVault: 0 });
});

test('reduceEntries: the identity ref differs per refKey, is i- + 12 hex, and is never a bare hash; refKey absent gives none', () => {
  const entries = parseKeepassXml(FIXTURE).entries;
  const a = reduceEntries(entries, { now: NOW, refKey: 'ref-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const b = reduceEntries(entries, { now: NOW, refKey: 'ref-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  const again = reduceEntries(entries, { now: NOW, refKey: 'ref-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(a.identities.length, 2);
  for (const i of a.identities) assert.match(i.ref, /^i-[0-9a-f]{12}$/);
  assert.notDeepEqual(a.identities.map((i) => i.ref), b.identities.map((i) => i.ref));
  assert.deepEqual(a.identities.map((i) => i.ref), again.identities.map((i) => i.ref), 'stable for one key');
  // dictionary-reversal check: no ref equals a plain hash of its value
  for (const i of a.identities) {
    for (const alg of ['sha256', 'sha1', 'md5']) {
      const plain = createHash(alg).update(i.value.toLowerCase(), 'utf8').digest('hex');
      assert.notEqual(i.ref, 'i-' + plain.slice(0, 12), alg);
    }
  }
  // no refKey: nothing reversible exists
  for (const noKey of [{ now: NOW }, { now: NOW, refKey: '' }, { now: NOW, refKey: null }]) {
    const n = reduceEntries(entries, noKey);
    assert.deepEqual(n.identities, []);
    assert.ok(n.accounts.every((x) => x.identityRef === null));
    assert.ok(!JSON.stringify(n).includes('i-'));
  }
  // a Buffer key works the same as its string
  const buf = reduceEntries(entries, { now: NOW, refKey: Buffer.from('ref-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa') });
  assert.deepEqual(buf.identities.map((i) => i.ref), a.identities.map((i) => i.ref));
});

test('reduceEntries tolerates junk input and duplicate uuids', () => {
  assert.deepEqual(reduceEntries(undefined), { accounts: [], identities: [], hashes: new Map() });
  assert.deepEqual(reduceEntries([null, 5, 'x']).accounts, []);
  const dup = reduceEntries([{ uuid: 'same', title: 'A', password: 'x' }, { uuid: 'same', title: 'B', password: 'y' }]);
  assert.equal(dup.accounts.length, 1);
  const noId = reduceEntries([{ title: 'No id', group: 'G', password: 'x' }]);
  assert.match(noId.accounts[0].id, /^k-[0-9a-f]{12}$/);
});

// ---- batch 4 taster fix: the owner's "not recorded" word, and manual accounts, in the engine's flags (parity with the renderer and hq_footprint) ----
test('buildGraph: twofa "unknown" (the "not recorded" chip) is the same as nothing said; a vault otp seed or passkey still counts', () => {
  const { accounts } = accountsOf();
  const a = { ...byTitle(accounts, 'Strong One'), totp: false, passkey: false };
  const flag = (acct, edit) => buildGraph({ accounts: [acct], identities: [], owner: { accounts: edit ? { [acct.id]: edit } : {} } }).nodes.find((n) => n.id === acct.id).flags.includes('no2fa');
  assert.equal(flag(a, { twofa: 'unknown' }), true);
  assert.equal(flag(a, null), true);
  assert.equal(flag({ ...a, totp: true }, { twofa: 'unknown' }), false);
  assert.equal(flag({ ...a, passkey: true }, { twofa: 'unknown' }), false);
  assert.equal(flag(a, { twofa: 'sms' }), false);
  assert.equal(flag({ ...a, totp: true }, { twofa: 'none' }), true, 'the owner says none');
});

test('buildGraph: a manual account takes its twofa from owner.accounts[id] (where the store writes it); an archived one leaves the graph; no duplicate ghost', () => {
  const owner = (acc) => ({ accounts: acc, manual: [{ id: 'm-000000000001', title: 'Paper club' }] });
  const node = (acc) => buildGraph({ accounts: [], identities: [], owner: owner(acc) }).nodes;
  assert.ok(node({}).find((n) => n.id === 'm-000000000001').flags.includes('no2fa'), 'nothing said');
  assert.ok(node({ 'm-000000000001': { twofa: 'unknown' } }).find((n) => n.id === 'm-000000000001').flags.includes('no2fa'));
  assert.ok(node({ 'm-000000000001': { twofa: 'none' } }).find((n) => n.id === 'm-000000000001').flags.includes('no2fa'));
  const sms = node({ 'm-000000000001': { twofa: 'sms' } });
  assert.ok(!sms.find((n) => n.id === 'm-000000000001').flags.includes('no2fa'));
  assert.equal(sms.filter((n) => n.id === 'm-000000000001').length, 1);
  assert.ok(sms.find((n) => n.id === 'm-000000000001').flags.includes('not-in-vault'), 'still one not-in-vault node');
  assert.equal(node({ 'm-000000000001': { archived: true } }).some((n) => n.id === 'm-000000000001'), false);
  const snap = snapshotOf({ accounts: [], identities: [] }, owner({ 'm-000000000001': { twofa: 'sms' } }), '2026-11-11T00:00:00Z');
  assert.deepEqual([snap.accounts, snap.flags.no2fa, snap.flags.notInVault], [1, 0, 1]);
});
