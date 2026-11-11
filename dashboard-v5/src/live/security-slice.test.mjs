// Security live slice (live/security-slice.mjs) against a fake window.hq.security. Plain Node; placeholder data only.
//
//   node --test dashboard-v5/src/live/security-slice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecuritySlice, emptySecurity, OFFLINE } from './security-slice.mjs';

const PASS = 'correct horse example';
const answer = (extra) => ({
  settings: { vaultPath: 'C:/placeholder/vault.kdbx', keyFilePath: null, cliPath: null, walkthrough: {} },
  map: { refreshedAt: '2026-11-10T09:00:00.000Z', accounts: [{ id: 'k-000000000001', title: 'alpha-site' }], identities: [{ ref: 'i-aaaaaaaaaaaa', kind: 'email', label: 'owner@example.test' }] },
  owner: { accounts: {}, manual: [], identities: [] }, snapshots: [{ at: '2026-11-10T09:00:00.000Z', accounts: 1, identities: 1, flags: {} }],
  status: { v: 1, at: '2026-11-10T09:00:00.000Z', refreshedAt: '2026-11-10T09:00:00.000Z', breachCheckedAt: null }, cliFound: true, vaultExists: true, ...(extra || {}),
});

function rig(security, opts = {}) {
  const live = { security: emptySecurity() };
  const emits = [];
  const emit = () => emits.push(1);
  const hq = security === null ? null : { security };
  const slice = createSecuritySlice({ hq, live, emit, pull: opts.noPull ? undefined : (p, fn) => Promise.resolve(typeof p === 'function' ? p() : p).then(fn).finally(emit) });
  return { slice, live, emits, S: () => live.security };
}

test('emptySecurity is the contract shape: loaded false, exports null (never scanned)', () => {
  const s = emptySecurity();
  assert.deepEqual(Object.keys(s).sort(), ['cliFound', 'error', 'exports', 'exportsError', 'loaded', 'map', 'owner', 'revision', 'settings', 'snapshots', 'status', 'vaultExists'].sort());
  assert.equal(s.loaded, false);
  assert.equal(s.map, null);
  assert.equal(s.exports, null);
  assert.deepEqual(s.owner, { accounts: {}, manual: [], identities: [] });
});

test('building the slice reads nothing (nothing at boot); one arrival reads once, concurrent arrivals coalesce', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_t, name) => async (...a) => { calls.push(String(name)); return name === 'read' ? answer() : { ok: true }; } });
  const { slice } = rig(spy);
  assert.deepEqual(calls, [], 'constructing the slice called hq.security');
  const a = slice.refreshSecurity(false), b = slice.refreshSecurity(false);
  assert.equal(a, b);
  await a;
  assert.deepEqual(calls, ['read']);
  await slice.refreshSecurity(false);
  assert.deepEqual(calls, ['read', 'read'], 'a later arrival reads again');
});

test('with hq.security absent every function resolves {error} and nothing throws', async () => {
  for (const hq of [null, {}, { other: {} }]) {
    const slice = createSecuritySlice({ hq, live: { security: emptySecurity() }, emit() {} });
    const names = Object.keys(slice);
    assert.equal(names.length, 10);
    for (const n of names) assert.deepEqual(await slice[n](), { error: OFFLINE }, n);
  }
});

test('a good read fills the slice and bumps the revision; the answer is normalised', async () => {
  const { slice, S, emits } = rig({ read: async () => answer({ snapshots: [null, { at: 'x' }], owner: { accounts: null, manual: 'x' } }) });
  await slice.refreshSecurity(false);
  assert.equal(S().loaded, true);
  assert.equal(S().error, '');
  assert.equal(S().map.accounts.length, 1);
  assert.equal(S().snapshots.length, 1);
  assert.deepEqual(S().owner, { accounts: {}, manual: [], identities: [] });
  assert.equal(S().cliFound, true);
  assert.equal(S().vaultExists, true);
  assert.equal(S().revision, 1);
  assert.ok(emits.length >= 1);
});

test('a read that comes back {error} keeps the previous map and says why', async () => {
  let next = answer();
  const { slice, S } = rig({ read: async () => next });
  await slice.refreshSecurity(false);
  const rev = S().revision;
  next = { error: 'not available here' };
  await slice.refreshSecurity(false);
  assert.equal(S().error, 'not available here');
  assert.equal(S().map.accounts.length, 1);
  assert.equal(S().revision, rev);
  next = null;
  await slice.refreshSecurity(false);
  assert.equal(S().error, 'Security gave no answer');
  assert.equal(S().map.accounts.length, 1);
});

test('a throwing read becomes an error in the slice, not an exception', async () => {
  const { slice, S } = rig({ read: async () => { throw new Error('boom'); } });
  await slice.refreshSecurity(false);
  assert.equal(S().error, 'boom');
  assert.equal(S().loaded, true);
});

test('only the newest read lands when two overlap', async () => {
  const gates = [];
  const { slice, S } = rig({ read: () => new Promise((res) => gates.push(res)) });
  const first = slice.refreshSecurity(false);
  const second = slice.refreshSecurity(true);
  await new Promise((r) => setTimeout(r, 0));
  gates[1](answer({ map: { refreshedAt: 'NEW', accounts: [], identities: [] } }));
  await second;
  gates[0](answer({ map: { refreshedAt: 'OLD', accounts: [], identities: [] } }));
  await first;
  assert.equal(S().map.refreshedAt, 'NEW');
});

test('unlockSecurity hands the passphrase to hq.security.refresh once, positionally, and re-reads after an ok', async () => {
  const seen = [];
  const { slice, S } = rig({
    refresh: async (...a) => { seen.push(a); return { ok: true, accounts: 4, breachChecked: true, notes: ['one note', 7] }; },
    read: async () => answer(), scanExports: async () => ({ files: [] }),
  });
  const r = await slice.unlockSecurity(PASS, true);
  assert.deepEqual(seen, [[PASS, true]]);
  assert.deepEqual(r, { ok: true, breachChecked: true, notes: ['one note'] });
  assert.equal(S().loaded, true);
  assert.deepEqual(S().exports, []);
  // the slice keeps the passphrase nowhere
  assert.ok(!JSON.stringify(S()).includes(PASS));
  assert.ok(!JSON.stringify(r).includes(PASS));
});

test('unlockSecurity with the checkbox off passes false; anything else passes true', async () => {
  const seen = [];
  const { slice } = rig({ refresh: async (...a) => { seen.push(a[1]); return { error: 'wrong passphrase or key file' }; } });
  await slice.unlockSecurity(PASS, false);
  await slice.unlockSecurity(PASS, undefined);
  assert.deepEqual(seen, [false, true]);
});

test('a failed refresh answers in main\'s words, re-reads nothing, and never echoes the passphrase', async () => {
  let reads = 0;
  const { slice, S } = rig({ refresh: async () => ({ error: 'wrong passphrase or key file' }), read: async () => { reads++; return answer(); } });
  const r = await slice.unlockSecurity(PASS, true);
  assert.deepEqual(r, { error: 'wrong passphrase or key file' });
  assert.equal(reads, 0);
  assert.equal(S().map, null);
  const t = await rig({ refresh: async () => { throw new Error('connection lost'); } }).slice.unlockSecurity(PASS, true);
  assert.deepEqual(t, { error: 'connection lost' });
  assert.deepEqual(await rig({ refresh: async () => null }).slice.unlockSecurity(PASS, true), { error: 'Security gave no answer' });
  assert.deepEqual(await rig({ refresh: async () => ({}) }).slice.unlockSecurity(PASS, true), { error: 'the refresh gave no answer' });
});

test('scanSecurityExports: [] means scanned and clean, null means never scanned; a refusal keeps the old list', async () => {
  let next = { files: [{ name: 'chrome passwords.csv', dir: 'C:/placeholder/Downloads', size: 120, mtime: '2026-11-09T00:00:00.000Z' }, { nope: 1 }] };
  const { slice, S } = rig({ scanExports: async () => next });
  assert.equal(S().exports, null);
  await slice.scanSecurityExports();
  assert.equal(S().exports.length, 1);
  next = { error: 'not available here' };
  await slice.scanSecurityExports();
  assert.equal(S().exports.length, 1);
  assert.equal(S().exportsError, 'not available here');
  next = { files: [] };
  await slice.scanSecurityExports();
  assert.deepEqual(S().exports, []);
  assert.equal(S().exportsError, '');
});

test('writes pass main\'s answer through and re-read only after an ok', async () => {
  const log = [];
  const { slice } = rig({
    edit: async (id, patch) => { log.push(['edit', id, patch]); return { ok: true }; },
    addManual: async (o) => { log.push(['addManual', o]); return { ok: true, id: 'm-123456789abc' }; },
    addIdentity: async (o) => { log.push(['addIdentity', o]); return { error: 'not an email or phone number' }; },
    settings: async (p) => { log.push(['settings', p]); return { ok: true }; },
    walkthrough: async (s, d) => { log.push(['walkthrough', s, d]); return { ok: true }; },
    read: async () => { log.push(['read']); return answer(); },
  });
  assert.deepEqual(await slice.editSecurity('k-1', { archived: true }), { ok: true });
  assert.deepEqual(await slice.addSecurityManual({ title: 'alpha-site', host: 'alpha-site.test' }), { ok: true, id: 'm-123456789abc' });
  assert.deepEqual(await slice.addSecurityIdentity({ kind: 'email', value: 'owner@example.test' }), { error: 'not an email or phone number' });
  await slice.setSecuritySettings({ vaultPath: 'C:/placeholder/vault.kdbx' });
  await slice.setSecurityWalkthrough('email-2fa', 1);
  assert.deepEqual(log.filter((x) => x[0] !== 'read').map((x) => x[0]), ['edit', 'addManual', 'addIdentity', 'settings', 'walkthrough']);
  assert.equal(log.filter((x) => x[0] === 'read').length, 4, 'one re-read per ok write, none after the refusal');
  assert.deepEqual(log.find((x) => x[0] === 'walkthrough'), ['walkthrough', 'email-2fa', true]);
});

test('trashSecurityExport re-scans and re-reads after an ok, and leaves the list alone on a refusal', async () => {
  const log = [];
  let ok = true;
  const { slice } = rig({
    trashExport: async (n, d) => { log.push(['trash', n, d]); return ok ? { ok: true } : { error: 'not in the last scan' }; },
    scanExports: async () => { log.push(['scan']); return { files: [] }; },
    read: async () => { log.push(['read']); return answer(); },
  });
  assert.deepEqual(await slice.trashSecurityExport('a.csv', 'C:/placeholder/Downloads'), { ok: true });
  assert.deepEqual(log.map((x) => x[0]), ['trash', 'scan', 'read']);
  ok = false;
  log.length = 0;
  assert.deepEqual(await slice.trashSecurityExport('b.csv', 'C:/placeholder/Downloads'), { error: 'not in the last scan' });
  assert.deepEqual(log.map((x) => x[0]), ['trash']);
});

test('copySecurity passes the text to main and answers its words; it never touches the slice', async () => {
  const seen = [];
  const { slice, S } = rig({ copy: async (t) => { seen.push(t); return { ok: true }; } });
  const before = JSON.stringify(S());
  assert.deepEqual(await slice.copySecurity('alpha-bravo-charlie'), { ok: true });
  assert.deepEqual(seen, ['alpha-bravo-charlie']);
  assert.equal(JSON.stringify(S()), before);
  assert.deepEqual(await rig({ copy: async () => null }).slice.copySecurity('x'), { error: 'Security gave no answer' });
});

test('without a pull the read still works (plain promise chain)', async () => {
  const { slice, S } = rig({ read: async () => answer() }, { noPull: true });
  await slice.refreshSecurity(false);
  assert.equal(S().loaded, true);
});
