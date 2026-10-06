'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeOneThing } = require('./one-thing.js');

const quest = (o) => ({ id: 'q1', status: 'open', tier: 'red', xp: 100, age_days: 3, title: 'Init git', insight: 'no repo', project_id: 'p1', ...o });
const sideq = (o) => ({ id: 's1', kind: 'risk', severity: 'medium', impact: 'medium', effort: 'M', title: 'Rotate secrets', detail: 'exposed key', project_id: 'p1', project_name: 'Proj', ...o });
const proj = (o) => ({ id: 'p1', name: 'Proj', activity: { days_since_commit: 6 }, metrics: { git_safety: { has_git: true, risk: 'high', unpushed: true, ahead: 2, dirty: 5 } }, ...o });

test('returns null for an empty or missing scan', () => {
  assert.equal(computeOneThing(null), null);
  assert.equal(computeOneThing({}), null);
  assert.equal(computeOneThing({ quests: [], projects: [], side_quests: [] }), null);
});

test('a red quest outranks a medium side-quest', () => {
  const a = computeOneThing({ quests: [quest()], projects: [], side_quests: [sideq()] });
  assert.equal(a.kind, 'quest');
  assert.equal(a.id, 'q1');
  assert.equal(a.quest.title, 'Init git');
});

test('a high-risk unpushed repo outranks an orange quest', () => {
  const a = computeOneThing({
    quests: [quest({ tier: 'orange', xp: 60, age_days: 5 })],
    projects: [proj()],
    side_quests: [],
  });
  assert.equal(a.kind, 'git');
  assert.equal(a.project_id, 'p1');
  assert.match(a.title, /Push Proj/);
});

test('a high-severity side-quest wins when no quests or git risk exist', () => {
  const a = computeOneThing({ quests: [], projects: [], side_quests: [sideq({ severity: 'high', impact: 'high', effort: 'S' })] });
  assert.equal(a.kind, 'side_quest');
  assert.equal(a.id, 's1');
});

test('idea side-quests and done quests are never picked', () => {
  const a = computeOneThing({
    quests: [quest({ status: 'done' })],
    projects: [],
    side_quests: [sideq({ kind: 'idea', severity: 'high' })],
  });
  assert.equal(a, null);
});

test('a clean, low-risk repo produces no git candidate', () => {
  const a = computeOneThing({
    quests: [],
    projects: [proj({ metrics: { git_safety: { has_git: true, risk: 'low', unpushed: false, ahead: 0, dirty: 0 } } })],
    side_quests: [],
  });
  assert.equal(a, null);
});
