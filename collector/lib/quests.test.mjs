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
