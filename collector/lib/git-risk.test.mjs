import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitRisk } from './git-risk.mjs';

test('no git => high risk with no-git flag', () => {
  const r = gitRisk({ has_git: false });
  assert.equal(r.risk, 'high');
  assert.ok(r.flags.includes('no-git'));
});

test('clean synced repo => low risk', () => {
  const r = gitRisk({ has_git: true, has_remote: true, commits: 10, dirty: 0, unpushed: false, behind: 0 });
  assert.equal(r.risk, 'low');
  assert.deepEqual(r.flags, []);
});

test('unpushed => medium risk', () => {
  const r = gitRisk({ has_git: true, has_remote: true, commits: 10, dirty: 0, unpushed: true, behind: 0 });
  assert.equal(r.risk, 'medium');
  assert.ok(r.flags.includes('unpushed'));
});
