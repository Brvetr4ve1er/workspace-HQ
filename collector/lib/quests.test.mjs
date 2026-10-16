import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSatisfied, questCtx, deriveQuests } from './quests.mjs';

test('autoSatisfied is false for manual/empty', () => {
  assert.equal(autoSatisfied('manual', {}), false);
  assert.equal(autoSatisfied('', {}), false);
});

test('autoSatisfied evaluates a safe expression', () => {
  assert.equal(autoSatisfied('has_git && commits>0', { has_git: true, commits: 3 }), true);
  assert.equal(autoSatisfied('has_git && commits>0', { has_git: true, commits: 0 }), false);
});

test('deriveQuests raises a red gitinit quest for a repo with no git', () => {
  const p = { id: 'x', name: 'X', metrics: { git_safety: { has_git: false }, code_health: { build: 'green' } } };
  const { quests } = deriveQuests({
    prevQuests: [], projects: [p], prodById: new Map([['x', p]]),
    emptyCount: 0, today: '2026-07-06', questXpByTier: { red: 50, orange: 20, yellow: 10 },
  });
  assert.ok(quests.some((q) => q.id === 'q-x-gitinit' && q.tier === 'red'));
});

test('a done quest is raised again when its problem returns, as a new quest', () => {
  const p = { id: 'x', name: 'X', metrics: { git_safety: { has_git: true, has_remote: true, commits: 10, dirty: 48, ahead: 0, behind: 0, unpushed: false }, code_health: { build: 'green' } } };
  const prev = [{ id: 'q-x-commit-dirty', project_id: 'x', status: 'done', created: '2026-07-03', completed: '2026-07-30', carried_from: '2026-07-03', title: 'Commit X working tree (25 files)', auto_complete_when: 'dirty<=20', evidence: { dirty: 25 } }];
  const { quests } = deriveQuests({ prevQuests: prev, projects: [p], prodById: new Map([['x', p]]), emptyCount: 0, today: '2026-10-16', questXpByTier: { red: 50, orange: 20, yellow: 10 } });
  const open = quests.filter((q) => q.status === 'open');
  assert.equal(open.length, 1);
  assert.equal(open[0].id, 'q-x-commit-dirty-r2');
  assert.equal(open[0].reopened_from, 'q-x-commit-dirty');
  assert.equal(open[0].created, '2026-10-16');
  assert.ok(quests.some((q) => q.id === 'q-x-commit-dirty' && q.status === 'done'), 'the done one is kept for history');
});

test('a re-raised quest is not raised a third time while it is still open', () => {
  const p = { id: 'x', name: 'X', metrics: { git_safety: { has_git: true, has_remote: true, commits: 10, dirty: 48, ahead: 0, behind: 0, unpushed: false }, code_health: { build: 'green' } } };
  const prev = [
    { id: 'q-x-commit-dirty', project_id: 'x', status: 'done', created: '2026-07-03', completed: '2026-07-30', carried_from: '2026-07-03', title: 'Commit X working tree (25 files)', auto_complete_when: 'dirty<=20', evidence: { dirty: 25 } },
    { id: 'q-x-commit-dirty-r2', project_id: 'x', status: 'open', created: '2026-10-16', completed: null, carried_from: '2026-10-16', title: 'Commit X working tree (48 files)', auto_complete_when: 'dirty<=20', evidence: { dirty: 48 }, reopened_from: 'q-x-commit-dirty' },
  ];
  const { quests } = deriveQuests({ prevQuests: prev, projects: [p], prodById: new Map([['x', p]]), emptyCount: 0, today: '2026-10-17', questXpByTier: { red: 50, orange: 20, yellow: 10 } });
  assert.deepEqual(quests.filter((q) => q.status === 'open').map((q) => q.id), ['q-x-commit-dirty-r2']);
});

test('a dismissed quest stays quiet even when its problem is back', () => {
  const p = { id: 'x', name: 'X', metrics: { git_safety: { has_git: true, has_remote: true, commits: 10, dirty: 48, ahead: 0, behind: 0, unpushed: false }, code_health: { build: 'green' } } };
  const prev = [{ id: 'q-x-commit-dirty', project_id: 'x', status: 'dismissed', created: '2026-07-03', completed: null, carried_from: '2026-07-03', title: 'Commit X working tree (25 files)', auto_complete_when: 'dirty<=20', evidence: { dirty: 25 } }];
  const { quests } = deriveQuests({ prevQuests: prev, projects: [p], prodById: new Map([['x', p]]), emptyCount: 0, today: '2026-10-16', questXpByTier: { red: 50, orange: 20, yellow: 10 } });
  assert.equal(quests.filter((q) => q.status === 'open').length, 0);
});
