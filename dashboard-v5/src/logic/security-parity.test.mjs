// The "no2fa" flag is decided in three places that must agree: the engine (security-core.mjs buildGraph, which feeds status.json, the
// Brief senses and the growth snapshots), the renderer (security-graph.mjs buildMapModel, the Health screen) and the MCP reader
// (footprint-read.mjs, hq_footprint). Invented data only (example.test names).
//   node --test dashboard-v5/src/logic/security-parity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph, snapshotOf } from '../../../dashboard/security-core.mjs';
import { buildMapModel } from './security-graph.mjs';
import { read as readFootprint } from '../../../mcp/workspacehq/footprint-read.mjs';

const WORDS = [undefined, 'unknown', 'none', 'ente', 'sms', 'passkey'];
const acct = (i, totp, passkey) => ({ id: 'k-' + String(i).padStart(12, '0'), title: 'Parity Site ' + i, host: 'parity' + i + '.example.test', totp, passkey, strength: 'strong', reuseGroup: null, old: false, breached: false, identityRef: null });

function fixture() {
  const accounts = []; const ownerAccounts = {}; const expectByTitle = new Map(); let i = 1;
  for (const [totp, passkey] of [[false, false], [true, false], [false, true]]) {
    for (const w of WORDS) {
      const a = acct(i++, totp, passkey); accounts.push(a);
      if (w !== undefined) ownerAccounts[a.id] = { twofa: w };
    }
  }
  const manual = [];
  for (const w of WORDS) {
    const m = { id: 'm-' + String(i++).padStart(12, '0'), title: 'Parity Manual ' + i, host: null, createdAt: '2026-01-01T00:00:00Z' };
    manual.push(m);
    if (w !== undefined) ownerAccounts[m.id] = { twofa: w };
  }
  const map = { v: 1, refreshedAt: '2026-11-10T09:00:00.000Z', accounts, identities: [] };
  const owner = { v: 1, accounts: ownerAccounts, manual, identities: [] };
  return { map, owner };
}

test('no2fa parity: engine, renderer and hq_footprint agree for every owner word x vault factor, accounts and manual', () => {
  const { map, owner } = fixture();
  const core = buildGraph({ accounts: map.accounts, identities: [], owner });
  const render = buildMapModel({ map, owner });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sec-parity-'));
  try {
    fs.mkdirSync(path.join(dir, 'security'));
    fs.writeFileSync(path.join(dir, 'security', 'map.json'), JSON.stringify(map));
    fs.writeFileSync(path.join(dir, 'security', 'owner.json'), JSON.stringify(owner));
    const fp = readFootprint(dir, { limit: 100 });
    assert.ok(Array.isArray(fp.rows), JSON.stringify(fp));
    const ids = [...map.accounts.map((a) => [a.id, a.title]), ...owner.manual.map((m) => [m.id, m.title])];
    for (const [id, title] of ids) {
      const c = core.nodes.find((n) => n.id === id);
      const r = render.nodes.find((n) => n.id === id);
      const f = fp.rows.find((x) => x.name === title);
      assert.ok(c && r && f, 'all three have ' + id);
      const word = owner.accounts[id] ? owner.accounts[id].twofa : '(none said)';
      const v = [c.flags.includes('no2fa'), r.flags.includes('no2fa'), f.flags.includes('no2fa')];
      assert.deepEqual(v, [v[1], v[1], v[1]], id + ' twofa=' + word + ' core/renderer/footprint = ' + v.join('/'));
    }
    // and the counts the Brief and the growth line read are the same as the renderer's Health count
    const snap = snapshotOf(map, owner, '2026-11-11T00:00:00Z');
    assert.equal(snap.flags.no2fa, render.counts.flags.no2fa);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the owner "not recorded" chip (twofa unknown) counts as no2fa in the engine, like nothing said', () => {
  const a = acct(1, false, false);
  const g = buildGraph({ accounts: [a], identities: [], owner: { accounts: { [a.id]: { twofa: 'unknown' } } } });
  assert.ok(g.nodes.find((n) => n.id === a.id).flags.includes('no2fa'));
  const g2 = buildGraph({ accounts: [{ ...a, totp: true }], identities: [], owner: { accounts: { [a.id]: { twofa: 'unknown' } } } });
  assert.ok(!g2.nodes.find((n) => n.id === a.id).flags.includes('no2fa'), 'a vault one-time-code seed still counts');
});

test('an archived manual account leaves the engine counts, like the renderer (owner edits for a manual id are not an orphan ghost)', () => {
  const { map, owner } = fixture();
  const m = owner.manual[0];
  owner.accounts[m.id] = { ...(owner.accounts[m.id] || {}), archived: true };
  const snap = snapshotOf(map, owner, '2026-11-11T00:00:00Z');
  const render = buildMapModel({ map, owner });
  assert.equal(snap.accounts, render.counts.accounts);
  assert.equal(snap.flags.no2fa, render.counts.flags.no2fa);
  assert.equal(snap.flags.notInVault, render.counts.flags.notInVault, 'a manual account is one not-in-vault node, never two');
});
