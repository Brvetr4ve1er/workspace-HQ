// oracle-logic.test.mjs — headless unit test for the pure Oracle action adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oracleActionId, oracleButtonMeta } from './oracle-logic.mjs';

test('oracleActionId maps each action to a registered dispatch id', () => {
  assert.equal(oracleActionId({ action: 'commit', target: { realmId: 'forge', projectId: 'p1' } }), 'go:forge');
  assert.equal(oracleActionId({ action: 'quest', target: { realmId: 'hunts', questId: 'q1' } }), 'go:hunts');
  assert.equal(oracleActionId({ action: 'quest', target: { realmId: 'forge', projectId: 'p2' } }), 'go:forge'); // secrets quest lives on forge
  assert.equal(oracleActionId({ action: 'capture', target: { realmId: 'roundtable' } }), 'capture:note');
  assert.equal(oracleActionId({ action: 'scan', target: { realmId: 'roundtable' } }), 'scan:now');
  assert.equal(oracleActionId({ action: 'rest', target: {} }), 'go:roundtable'); // missing realmId → safe home
  assert.equal(oracleActionId(null), null);
});

test('oracleButtonMeta gives per-action copy; unknown/null → generic Open', () => {
  assert.equal(oracleButtonMeta({ action: 'commit' }).label, 'Review & commit');
  assert.equal(oracleButtonMeta({ action: 'quest' }).label, 'Open task');
  assert.equal(oracleButtonMeta({ action: 'capture' }).label, 'Capture');
  assert.equal(oracleButtonMeta({ action: 'scan' }).label, 'Scan now');
  assert.deepEqual(oracleButtonMeta({ action: '???' }), { label: 'Open', icon: '▸' });
  assert.deepEqual(oracleButtonMeta(null), { label: 'Open', icon: '▸' });
});
