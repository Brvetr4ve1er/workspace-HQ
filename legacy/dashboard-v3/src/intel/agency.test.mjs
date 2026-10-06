import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agencyProposals } from './agency.mjs';

const SEL = { projects: [
  { id: 'p1', name: 'Alpha', path: 'Alpha', signals: { has_tests: false, has_ci: false, has_readme: true, has_license: true } },
  { id: 'p2', name: 'Beta',  path: 'Beta',  signals: { has_tests: true,  has_ci: true,  has_readme: false, has_license: false } },
  { id: 'p3', name: 'NoPath',              signals: { has_tests: false } },          // no path -> skipped
  { id: 'p4', name: 'Clean', path: 'Clean', signals: { has_tests: true, has_ci: true, has_readme: true, has_license: true } },
] };

test('agencyProposals: one row per real gap, ordered, path-gated', () => {
  const r = agencyProposals(SEL);
  assert.deepEqual(r.map((x) => `${x.projectId}:${x.gap}`), ['p1:tests', 'p1:ci', 'p2:readme', 'p2:license']);
  assert.equal(r[0].projectName, 'Alpha');
  assert.equal(r[0].projectPath, 'Alpha');
  assert.equal(r[0].label, 'No tests');
  assert.match(r[0].seedPrompt, /test/i);
  assert.match(r[0].captureText, /^Alpha: /);
  assert.ok(r.every((x) => x.seedPrompt.length <= 200), 'seed prompts stay under the IPC truncation limit');
  assert.ok(!r.some((x) => x.projectId === 'p3'), 'projects without a path are skipped');
  assert.ok(!r.some((x) => x.projectId === 'p4'), 'clean projects produce nothing');
});

test('agencyProposals: only an explicit false is a gap; never throws', () => {
  // undefined/missing signal must NOT be treated as a gap (absence != known-absent)
  assert.deepEqual(agencyProposals({ projects: [{ id: 'x', name: 'X', path: 'X', signals: {} }] }), []);
  assert.deepEqual(agencyProposals({ projects: [{ id: 'x', name: 'X', path: 'X' }] }), []);
  assert.doesNotThrow(() => agencyProposals(null));
  assert.doesNotThrow(() => agencyProposals({}));
  assert.deepEqual(agencyProposals(null), []);
});
