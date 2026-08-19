// node --test dashboard-v4/src/surfaces/projects/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyView, commitAgoText, completionDelta, dwellFor, gitText, isAtRisk,
  nextActionFor, openTasksFor, pctOf, prevProjectMap, riskScore, testsText,
} from './core.mjs';

const proj = (over = {}) => ({
  id: 'p1', name: 'Alpha', stack: ['node'],
  completion: { pct: 50 },
  activity: { state: 'active', days_since_commit: 1 },
  signals: {},
  metrics: { git_safety: { has_git: true, has_remote: true, commits: 10, dirty: 0, risk: 'low' }, code_health: { build: 'green' }, risk_security: { score: 'low' } },
  ...over,
});

test('gitText walks the v3 branch ladder', () => {
  assert.equal(gitText({ has_git: false }), 'no git');
  assert.equal(gitText({ has_git: true, commits: 0 }), '0 commits');
  assert.equal(gitText({ has_git: true, commits: 3, has_remote: false }), 'no remote');
  assert.equal(gitText({ has_git: true, commits: 3, has_remote: true, dirty: 7 }), '7 dirty');
  assert.equal(gitText({ has_git: true, commits: 3, has_remote: true, dirty: 0, unpushed: true, ahead: 2 }), '2 ahead');
  assert.equal(gitText({ has_git: true, commits: 3, has_remote: true, dirty: 0 }), 'in sync');
  assert.equal(gitText(null), 'no git');
});

test('pctOf clamps to [0,100] and survives malformed scans', () => {
  assert.equal(pctOf(proj()), 50);
  assert.equal(pctOf({ completion: { pct: 250 } }), 100);
  assert.equal(pctOf({ completion: { pct: -4 } }), 0);
  assert.equal(pctOf({ completion: { pct: 'high' } }), 0);
  assert.equal(pctOf({}), 0);
  assert.equal(pctOf(null), 0);
});

test('riskScore composes git risk, red build, security and dirty pile', () => {
  assert.equal(riskScore(proj()), 0);
  const bad = proj({ metrics: {
    git_safety: { risk: 'high', dirty: 30 },
    code_health: { build: 'red' },
    risk_security: { score: 'medium' },
  } });
  assert.equal(riskScore(bad), 3 + 2 + 1 + 1);
  assert.equal(riskScore({}), 0);
});

test('isAtRisk fires on any of the three red flags', () => {
  assert.equal(isAtRisk(proj()), false);
  assert.ok(isAtRisk(proj({ metrics: { git_safety: { risk: 'high' }, code_health: {}, risk_security: {} } })));
  assert.ok(isAtRisk(proj({ metrics: { git_safety: {}, code_health: { build: 'red' }, risk_security: {} } })));
  assert.ok(isAtRisk(proj({ metrics: { git_safety: {}, code_health: {}, risk_security: { score: 'high' } } })));
});

test('applyView: search matches name and stack, filters gate, sorts order', () => {
  const a = proj({ id: 'a', name: 'Alpha', stack: ['react'], completion: { pct: 90 }, activity: { state: 'active', days_since_commit: 0 } });
  const b = proj({ id: 'b', name: 'Beta', stack: ['python'], completion: { pct: 40 }, activity: { state: 'dormant', days_since_commit: 60 },
    metrics: { git_safety: { risk: 'high', dirty: 25 }, code_health: { build: 'red' }, risk_security: { score: 'low' } } });
  const c = proj({ id: 'c', name: 'Gamma', stack: ['node'], completion: { pct: 70 }, activity: { state: 'active', days_since_commit: 3 } });
  const all = [a, b, c];

  assert.deepEqual(applyView(all, {}).map((p) => p.id), ['a', 'c', 'b']);           // completion desc
  assert.deepEqual(applyView(all, { sort: 'risk' })[0].id, 'b');                    // riskiest first
  assert.deepEqual(applyView(all, { sort: 'recent' }).map((p) => p.id), ['a', 'c', 'b']); // freshest commit first
  assert.deepEqual(applyView(all, { search: 'pyth' }).map((p) => p.id), ['b']);     // stack hit
  assert.deepEqual(applyView(all, { search: 'GAMMA' }).map((p) => p.id), ['c']);    // name hit, case-blind
  assert.deepEqual(applyView(all, { filter: 'risk' }).map((p) => p.id), ['b']);
  assert.deepEqual(applyView(all, { filter: 'cold' }).map((p) => p.id), ['b']);
  assert.deepEqual(applyView(all, { filter: 'active' }).map((p) => p.id), ['a', 'c']);
  const before = all.map((p) => p.id);
  applyView(all, { sort: 'risk' });
  assert.deepEqual(all.map((p) => p.id), before);                                   // input never reordered
});

test('prevProjectMap + completionDelta', () => {
  const prev = { projects: [proj({ id: 'a', completion: { pct: 30 } }), null] };
  const map = prevProjectMap(prev);
  assert.equal(completionDelta(proj({ id: 'a', completion: { pct: 45 } }), map.a), 15);
  assert.equal(completionDelta(proj(), map.missing), 0);
  assert.deepEqual(prevProjectMap(null), Object.create(null));
});

test('openTasksFor filters to the project, open/in_progress only, worst tier first', () => {
  const quests = [
    { id: 1, project_id: 'p1', status: 'open', tier: 'yellow', title: 'y' },
    { id: 2, project_id: 'p1', status: 'done', tier: 'red', title: 'done-red' },
    { id: 3, project_id: 'p1', status: 'in_progress', tier: 'red', title: 'r' },
    { id: 4, project_id: 'p2', status: 'open', tier: 'red', title: 'other' },
    { id: 5, project_id: 'p1', status: 'open', tier: 'orange', title: 'o' },
  ];
  assert.deepEqual(openTasksFor(quests, 'p1').map((q) => q.title), ['r', 'o', 'y']);
  assert.deepEqual(openTasksFor(undefined, 'p1'), []);
});

test('nextActionFor: top quest, else dirty commit nudge, else look around', () => {
  const p = proj({ metrics: { git_safety: { dirty: 3 }, code_health: {}, risk_security: {} } });
  assert.equal(nextActionFor(p, [{ project_id: 'p1', status: 'open', tier: 'red', title: 'Fix the leak' }]), 'Fix the leak');
  assert.equal(nextActionFor(p, []), 'Commit 3 dirty files');
  assert.equal(nextActionFor(proj({ metrics: { git_safety: { dirty: 1 }, code_health: {}, risk_security: {} } }), []), 'Commit 1 dirty file');
  assert.equal(nextActionFor(proj(), []), 'Open it and look around');
});

test('dwellFor finds the project row or null', () => {
  const browser = { by_project: [{ project_id: 'p1', focus_ms: 1000 }] };
  assert.equal(dwellFor(browser, 'p1').focus_ms, 1000);
  assert.equal(dwellFor(browser, 'p2'), null);
  assert.equal(dwellFor(null, 'p1'), null);
});

test('testsText + commitAgoText phrases', () => {
  assert.equal(testsText({ passing: 5, count: 8 }), '5/8');
  assert.equal(testsText({ passing: 5 }), '5/?');
  assert.equal(testsText({ present: true }), 'present');
  assert.equal(testsText(undefined), 'none');
  assert.equal(commitAgoText(null), '—');
  assert.equal(commitAgoText(0), 'today');
  assert.equal(commitAgoText(12), '12d ago');
});
