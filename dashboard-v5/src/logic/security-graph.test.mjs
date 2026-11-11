// Security space - the footprint map's pure engine (logic/security-graph.mjs). Plain Node, placeholder data only
// (example.test, acme.test, alpha-site.test, owner@example.test).
//
//   node --test dashboard-v5/src/logic/security-graph.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, buildMapModel, filterByDate, dateStops, growthSummary, cleanLabel, hash32, MAX_NODES, LOCKED_LABEL } from './security-graph.mjs';

// ---- builders ----------------------------------------------------------------------------------------------------------
const acct = (n, extra) => ({ id: 'k-' + String(n).padStart(12, '0'), title: 'site ' + n, host: 'site' + n + '.example.test', group: 'Root/Web', created: '2026-01-' + String((n % 27) + 1).padStart(2, '0') + 'T00:00:00.000Z', modified: '2026-02-01T00:00:00.000Z', totp: false, passkey: false, strength: 'strong', reuseGroup: null, old: false, identityRef: 'i-aaaaaaaaaaaa', breached: false, ...(extra || {}) });
const ident = (ref, label, kind = 'email') => ({ ref, kind, label });
const MAP = (accounts, identities, extra) => ({ v: 1, refreshedAt: '2026-11-10T09:00:00.000Z', accounts, identities, ...(extra || {}) });

function bigGraph(nAccounts, nIdentities = 3) {
  const nodes = [], edges = [];
  for (let i = 0; i < nIdentities; i++) nodes.push({ id: 'i-id' + i, kind: 'identity', label: 'owner' + i + '@example.test' });
  for (let i = 0; i < nAccounts; i++) {
    const id = 'k-acc' + String(i).padStart(5, '0');
    nodes.push({ id, kind: 'account', label: 'site ' + i });
    edges.push({ a: id, b: 'i-id' + (i % nIdentities), kind: 'uses' });
  }
  return { nodes, edges };
}

// ---- layout ------------------------------------------------------------------------------------------------------------
test('layoutGraph is deterministic: the same input twice gives identical coordinates', () => {
  const g = bigGraph(40);
  const a = layoutGraph(g, { width: 800, height: 520 }), b = layoutGraph(g, { width: 800, height: 520 });
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y, n.r]), b.nodes.map((n) => [n.id, n.x, n.y, n.r]));
  assert.deepEqual(a.edges, b.edges);
});

test('layoutGraph never asks Math.random for anything', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try { layoutGraph(bigGraph(30), { width: 600, height: 400 }); } finally { Math.random = real; }
});

test('every node lands inside [r, width - r] x [r, height - r], and r = 8 + 4 * sqrt(degree)', () => {
  const g = bigGraph(60, 4);
  const out = layoutGraph(g, { width: 700, height: 450 });
  const deg = new Map();
  for (const e of g.edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
  for (const n of out.nodes) {
    assert.ok(n.x >= n.r && n.x <= 700 - n.r, n.id + ' x ' + n.x);
    assert.ok(n.y >= n.r && n.y <= 450 - n.r, n.id + ' y ' + n.y);
    assert.ok(Math.abs(n.r - (8 + 4 * Math.sqrt(deg.get(n.id) || 0))) < 1e-9, n.id + ' r ' + n.r);
  }
  const identity = out.nodes.find((n) => n.id === 'i-id0'), account = out.nodes.find((n) => n.id === 'k-acc00001');
  assert.ok(identity.r > account.r, 'an identity that recovers many accounts is the bigger bubble');
});

test('an explicit degree sets the size, and a missing edge target or a duplicate edge is dropped', () => {
  const out = layoutGraph({
    nodes: [{ id: 'a', degree: 9 }, { id: 'b' }, { id: 'a' }],
    edges: [{ a: 'a', b: 'b', kind: 'uses' }, { a: 'a', b: 'b', kind: 'uses' }, { a: 'a', b: 'ghost', kind: 'uses' }, { a: 'b', b: 'b', kind: 'uses' }],
  }, { width: 300, height: 200 });
  assert.equal(out.nodes.length, 2);
  assert.equal(out.nodes[0].r, 8 + 4 * 3);
  assert.equal(out.edges.length, 1);
});

test('a box too small for the radii still returns finite points', () => {
  const out = layoutGraph(bigGraph(5, 1), { width: 10, height: 10 });
  for (const n of out.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  assert.deepEqual(layoutGraph({ nodes: [], edges: [] }).nodes, []);
  assert.deepEqual(layoutGraph(null).nodes, []);
  assert.equal(layoutGraph({ nodes: [{ id: 'solo' }], edges: [] }, { width: 100, height: 100 }).nodes.length, 1);
});

test('900 accounts on 3 identities: at most 600 nodes and one "+N more" node per identity, the Ns adding up', () => {
  const g = bigGraph(900, 3);
  const out = layoutGraph(g, { width: 900, height: 600, iterations: 5 });
  assert.ok(out.nodes.length <= MAX_NODES, 'nodes ' + out.nodes.length);
  const more = out.nodes.filter((n) => n.kind === 'more');
  assert.equal(more.length, 3);
  assert.deepEqual(more.map((m) => m.identity).sort(), ['i-id0', 'i-id1', 'i-id2']);
  const keptAccounts = out.nodes.filter((n) => n.kind === 'account').length;
  assert.equal(keptAccounts + more.reduce((t, m) => t + m.count, 0), 900);
  assert.equal(out.folded, 900 - keptAccounts);
  for (const m of more) assert.equal(m.label, '+' + m.count + ' more');
  // each "+N more" hangs off its own identity
  for (const m of more) assert.ok(out.edges.some((e) => e.a === m.id && e.b === m.identity));
  // the identities were never folded
  assert.equal(out.nodes.filter((n) => n.kind === 'identity').length, 3);
  // no edge points at a folded account
  const ids = new Set(out.nodes.map((n) => n.id));
  for (const e of out.edges) assert.ok(ids.has(e.a) && ids.has(e.b));
});

test('the smallest-degree accounts fold first: a well-linked account survives the fold', () => {
  const g = bigGraph(700, 2);
  g.nodes.push({ id: 'k-hub', kind: 'account', label: 'hub' });
  g.edges.push({ a: 'k-hub', b: 'i-id0', kind: 'uses' });
  for (let i = 0; i < 4; i++) g.edges.push({ a: 'k-hub', b: 'k-acc0000' + i, kind: 'signs-in-with' });
  const out = layoutGraph(g, { iterations: 2 });
  assert.ok(out.nodes.some((n) => n.id === 'k-hub'), 'the hub was folded');
  assert.ok(out.nodes.length <= MAX_NODES);
});

test('a graph already within the limit is not folded, and a pile of identities is clipped to the limit with the count said', () => {
  const small = layoutGraph(bigGraph(100, 3), { iterations: 2 });
  assert.equal(small.folded, 0);
  assert.ok(!small.nodes.some((n) => n.kind === 'more'));
  const ids = { nodes: Array.from({ length: 650 }, (_, i) => ({ id: 'i-' + i, kind: 'identity' })), edges: [] };
  const out = layoutGraph(ids, { iterations: 1 });
  assert.equal(out.nodes.length, MAX_NODES);
  assert.equal(out.clipped, 50);
});

test('the layout of 600 nodes finishes in reasonable time', () => {
  const t0 = Date.now();
  layoutGraph(bigGraph(597, 3), { width: 1000, height: 700 });
  assert.ok(Date.now() - t0 < 8000, 'took ' + (Date.now() - t0) + ' ms');
});

test('hash32 is stable and spreads (two ids, two seeds)', () => {
  assert.equal(hash32('k-1', 1), hash32('k-1', 1));
  assert.notEqual(hash32('k-1', 1), hash32('k-1', 2));
  assert.notEqual(hash32('k-1', 1), hash32('k-2', 1));
});

// ---- the model ---------------------------------------------------------------------------------------------------------
test('cleanLabel: text passes, null / empty / ciphertext are locked', () => {
  assert.equal(cleanLabel(' owner@example.test '), 'owner@example.test');
  for (const x of [null, undefined, '', '   ', 'enc:AAAA', 42]) assert.equal(cleanLabel(x), null);
});

test('buildMapModel: nodes, edges, degrees, the flags and the counts', () => {
  const accounts = [
    acct(1, { strength: 'weak', reuseGroup: 1, breached: true, totp: true }),
    acct(2, { reuseGroup: 1, old: true, identityRef: 'i-bbbbbbbbbbbb', passkey: true }),
    acct(3, { breached: null }),
    acct(4, { identityRef: null }),
  ];
  const owner = { v: 1, accounts: { [accounts[2].id]: { twofa: 'ente', signInWith: accounts[0].id, recoveryRef: 'i-bbbbbbbbbbbb', hiddenFromClaude: true }, [accounts[3].id]: { archived: true } }, manual: [], identities: [] };
  const m = buildMapModel({ map: MAP(accounts, [ident('i-aaaaaaaaaaaa', 'owner@example.test'), ident('i-bbbbbbbbbbbb', null, 'phone')]), owner });
  const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.deepEqual(by[accounts[0].id].flags, ['breached', 'reused', 'weak']);   // totp on, so no 2FA flag
  assert.deepEqual(by[accounts[1].id].flags, ['reused', 'old']);                 // passkey on
  assert.deepEqual(by[accounts[2].id].flags, []);                                // owner says ente
  assert.deepEqual(by[accounts[3].id].flags, [], 'an archived account keeps no flags');
  assert.equal(by[accounts[3].id].archived, true);
  assert.equal(by[accounts[2].id].hidden, true);
  assert.equal(by['i-aaaaaaaaaaaa'].label, 'owner@example.test');
  assert.equal(by['i-bbbbbbbbbbbb'].label, LOCKED_LABEL);
  assert.equal(by['i-bbbbbbbbbbbb'].locked, true);
  assert.equal(by['i-bbbbbbbbbbbb'].identityKind, 'phone');
  const kinds = (k) => m.edges.filter((e) => e.kind === k).map((e) => e.a + '>' + e.b).sort();
  assert.deepEqual(kinds('uses'), [accounts[0].id + '>i-aaaaaaaaaaaa', accounts[1].id + '>i-bbbbbbbbbbbb', accounts[2].id + '>i-aaaaaaaaaaaa'].sort());
  assert.deepEqual(kinds('signs-in-with'), [accounts[2].id + '>' + accounts[0].id]);
  assert.deepEqual(kinds('recovers'), [accounts[2].id + '>i-bbbbbbbbbbbb']);
  assert.equal(by['i-aaaaaaaaaaaa'].degree, 2);
  assert.equal(by['i-bbbbbbbbbbbb'].degree, 2);
  assert.equal(m.counts.accounts, 3);
  assert.equal(m.counts.archived, 1);
  assert.equal(m.counts.identities, 2);
  assert.deepEqual(m.counts.flags, { weak: 1, reused: 2, breached: 1, no2fa: 0, old: 1, notInVault: 0 });
  assert.equal(m.counts.breachUnknown, 1);
});

test('buildMapModel: an account with no 2FA recorded is flagged, "none" is flagged even with a factor, unknown with a factor is not', () => {
  const a = [acct(1), acct(2, { totp: true }), acct(3, { totp: true })];
  const owner = { accounts: { [a[2].id]: { twofa: 'none' } } };
  const m = buildMapModel({ map: MAP(a, [ident('i-aaaaaaaaaaaa', 'owner@example.test')]), owner });
  const f = Object.fromEntries(m.nodes.map((n) => [n.id, n.flags]));
  assert.ok(f[a[0].id].includes('no2fa'));
  assert.ok(!f[a[1].id].includes('no2fa'));
  assert.ok(f[a[2].id].includes('no2fa'));
});

test('buildMapModel: manual accounts and an owner edit whose account vanished both show as "not in vault"', () => {
  const a = [acct(1)];
  const gone = 'k-ffffffffffff';
  const owner = { accounts: { [gone]: { twofa: 'sms' } }, manual: [{ id: 'm-123456789abc', title: 'alpha-site', host: 'alpha-site.test', createdAt: '2026-05-05T00:00:00.000Z' }], identities: [] };
  const m = buildMapModel({ map: MAP(a, []), owner });
  const manual = m.nodes.find((n) => n.id === 'm-123456789abc'), ghost = m.nodes.find((n) => n.id === gone);
  assert.equal(manual.kind, 'manual');
  assert.ok(manual.flags.includes('not-in-vault'));
  assert.equal(manual.created, '2026-05-05T00:00:00.000Z');
  assert.equal(ghost.kind, 'ghost');
  assert.deepEqual(ghost.flags, ['not-in-vault']);
  assert.equal(m.counts.flags.notInVault, 2);
  // before any refresh nothing can be called missing
  const before = buildMapModel({ map: null, owner });
  assert.ok(!before.nodes.some((n) => n.kind === 'ghost'));
  assert.equal(before.nodes.filter((n) => n.kind === 'manual').length, 1);
});

test('buildMapModel: ciphertext is never shown as a label, junk input never throws', () => {
  const m = buildMapModel({ map: MAP([acct(1)], [ident('i-aaaaaaaaaaaa', 'enc:SGVsbG8=')]), owner: { identities: [ident('i-aaaaaaaaaaaa', 'owner@example.test')] } });
  assert.equal(m.nodes.find((n) => n.kind === 'identity').label, 'owner@example.test', 'a readable owner label wins over ciphertext');
  const only = buildMapModel({ map: MAP([], [ident('i-aaaaaaaaaaaa', 'enc:SGVsbG8=')]) });
  assert.equal(only.nodes[0].label, LOCKED_LABEL);
  for (const bad of [undefined, null, {}, { map: 'x', owner: 3 }, { map: { accounts: [null, 1, {}], identities: [null] }, owner: { accounts: { x: 1 }, manual: [null] } }]) assert.doesNotThrow(() => buildMapModel(bad));
});

test('buildMapModel never carries a password, note, username or one-time value (only names and flags)', () => {
  const m = buildMapModel({ map: MAP([{ ...acct(1), password: 'PLACEHOLDER-pass-1', username: 'someone', notes: 'N' }], [ident('i-aaaaaaaaaaaa', 'owner@example.test')]) });
  const text = JSON.stringify(m);
  for (const s of ['PLACEHOLDER-pass-1', 'someone']) assert.ok(!text.includes(s), s);
});

// ---- the slider --------------------------------------------------------------------------------------------------------
test('dateStops and filterByDate: accounts created on or before the day, manual ones from createdAt, identities follow', () => {
  const a = [acct(1, { created: '2026-01-05T00:00:00.000Z' }), acct(2, { created: '2026-03-01T00:00:00.000Z', identityRef: 'i-bbbbbbbbbbbb' }), acct(3, { created: null })];
  const owner = { manual: [{ id: 'm-aaaaaaaaaaaa', title: 'late', host: '', createdAt: '2026-08-01T00:00:00.000Z' }] };
  const m = buildMapModel({ map: MAP(a, [ident('i-aaaaaaaaaaaa', 'owner@example.test'), ident('i-bbbbbbbbbbbb', 'second@example.test')]), owner });
  assert.deepEqual(dateStops(m), ['2026-01-05', '2026-03-01', '2026-08-01']);
  const ids = (f) => f.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids(filterByDate(m, null)), ids(m));
  const early = filterByDate(m, '2026-01-31');
  assert.deepEqual(ids(early), [a[0].id, a[2].id, 'i-aaaaaaaaaaaa'].sort(), 'the second identity has no account yet; an undated account is never hidden');
  const mid = filterByDate(m, '2026-03-01');
  assert.ok(mid.nodes.some((n) => n.id === a[1].id) && mid.nodes.some((n) => n.id === 'i-bbbbbbbbbbbb'));
  assert.ok(!mid.nodes.some((n) => n.id === 'm-aaaaaaaaaaaa'));
  assert.ok(filterByDate(m, '2026-08-01').nodes.some((n) => n.id === 'm-aaaaaaaaaaaa'));
  for (const e of early.edges) assert.ok(ids(early).includes(e.a) && ids(early).includes(e.b));
  assert.deepEqual(filterByDate(null, '2026-01-01'), { nodes: [], edges: [] });
});

// ---- growth ------------------------------------------------------------------------------------------------------------
test('growthSummary: numbers only, a line from two snapshots, honest with none or one', () => {
  assert.match(growthSummary([]).text, /No refresh kept yet/);
  assert.equal(growthSummary(undefined).accountsPath, '');
  const one = growthSummary([{ at: '2026-11-01T10:00:00.000Z', accounts: 8, identities: 2, flags: { weak: 1, reused: 2, breached: 0, no2fa: 3, old: 0, notInVault: 0 } }]);
  assert.match(one.text, /8 accounts on 2 identities, 6 flags/);
  assert.equal(one.accountsPath, '');
  const two = growthSummary([
    { at: '2026-11-01T10:00:00.000Z', accounts: 8, identities: 2, flags: { weak: 1, reused: 2, breached: 0, no2fa: 3, old: 0, notInVault: 0 } },
    { at: '2026-11-10T10:00:00.000Z', accounts: 12, identities: 3, flags: { weak: 0, reused: 1, breached: 0, no2fa: 2, old: 0, notInVault: 0 } },
  ]);
  assert.match(two.text, /12 accounts on 3 identities, 3 flags/);
  assert.match(two.text, /first kept 2026-11-01: 8 accounts, 6 flags/);
  assert.match(two.text, /2 refreshes kept/);
  assert.match(two.accountsPath, /^M[\d. ]+L[\d. ]+$/);
  assert.match(two.flagsPath, /^M/);
  assert.equal(two.points.length, 2);
  assert.doesNotThrow(() => growthSummary([null, 3, { flags: 'x' }]));
});
