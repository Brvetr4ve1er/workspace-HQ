import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracle } from './derive.mjs';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/sample.json', import.meta.url)));

test('oracle: uncommitted files at risk outrank a calm quest', () => {
  const sel = { ...FIX, projects: [
    { id:'p1', name:'A', metrics:{ git_safety:{ dirty: 24 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 0 } },
    { id:'p2', name:'B', metrics:{ git_safety:{ dirty: 0 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 1 } },
  ], quests: [{ id:'q1', title:'tidy', tier:'yellow', status:'open' }] };
  const r = oracle(FIX, sel, '2026-07-26T14:00:00Z');
  assert.equal(r.action, 'commit');
  assert.equal(r.target.projectId, 'p1');
  assert.match(r.reason, /uncommitted/i);
});

test('oracle: never throws on an empty/old scan', () => {
  assert.doesNotThrow(() => oracle({}, null, '2026-07-26T14:00:00Z'));
  assert.equal(oracle({}, null, '2026-07-26T03:00:00Z'), null); // nothing actionable → null
});
