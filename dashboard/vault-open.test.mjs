// dashboard/vault-open.test.mjs — Life › Notes Open in Obsidian / Search (IPC-CONTRACT 2026-10-27). Temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createVaultOpen, obsidianVaults } = require('./vault-open.js');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vault-open-'));
  const docs = path.join(root, 'Docs'), appData = path.join(root, 'AppData');
  fs.mkdirSync(path.join(appData, 'obsidian'), { recursive: true });
  fs.writeFileSync(path.join(appData, 'obsidian', 'obsidian.json'), JSON.stringify({ vaults: {
    abc123: { path: path.join(docs, 'Example Vault').toUpperCase(), ts: 1 }, def456: { path: path.join(root, 'Elsewhere', 'Second') } } }));
  const latest = { inventory: { vaults: [{ name: 'Example Vault', path: 'Example Vault' }, { name: 'Second', path: path.join(root, 'Elsewhere', 'Second') }, { name: 'Unknown', path: 'Unknown' }] } };
  const calls = [];
  const make = (o = {}) => createVaultOpen({ readLatest: () => latest, docsRoot: docs, appData, openExternal: async (u) => calls.push(u), ...o });
  return { make, calls, appData };
}

test('opens / searches a scanned vault by Obsidian\'s own id (relative and absolute paths, case-insensitive)', async () => {
  const { make, calls } = setup();
  const open = make();
  assert.deepEqual(await open('Example Vault', 'open'), { ok: true, how: 'open' });
  assert.deepEqual(await open('Second', 'search'), { ok: true, how: 'search' });
  assert.deepEqual(calls, ['obsidian://open?vault=abc123', 'obsidian://search?vault=def456']);
});

test('refuses what the scan does not list, unregistered vaults, other verbs, no Obsidian; dry launch logs', async () => {
  const { make, calls, appData } = setup();
  const open = make();
  assert.match((await open('Nope', 'open')).error, /refused: not a vault in the latest scan/);
  assert.match((await open('Unknown', 'open')).error, /doesn't know this vault yet/);
  assert.match((await open('Example Vault', 'delete')).error, /opens or searches/);
  assert.match((await open('', 'open')).error, /not a vault name/);
  assert.match((await make({ protocolName: () => '' })('Example Vault', 'open')).error, /not installed/);
  const logs = [];
  assert.equal((await make({ env: { HQ_DRY_LAUNCH: '1' }, log: (s) => logs.push(s) })('Example Vault', 'search')).dry, true);
  assert.deepEqual(logs, ['[dry-open] obsidian://search?vault=abc123']);
  assert.equal(calls.length, 0);
  assert.equal(obsidianVaults(path.join(appData, 'missing')).length, 0);
});
