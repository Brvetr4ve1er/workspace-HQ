import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQueue } from './queue.mjs';

// ---- synthetic selected --------------------------------------------------
// p1: secrets + dirty (two threats), has path.
// p2: stale + no-tests threats AND real signal gaps (tests/ci), has path.
// p3: dirty threat but NO path -> its items must lose the 'dispatch' verb.
// (No project entry at all for quest q-ghost / idea sq-ghost -> also unresolvable.)
const SEL = {
  projects: [
    { id: 'p1', name: 'Alpha', path: '/proj/alpha',
      metrics: { risk_security: { secrets_found: 2 }, git_safety: { dirty: 3 } },
      signals: { has_tests: true, has_ci: true, has_readme: true, has_license: true } },
    { id: 'p2', name: 'Beta', path: '/proj/beta',
      activity: { days_since_commit: 20 },
      signals: { has_tests: false, has_ci: false, has_readme: true, has_license: true } },
    { id: 'p3', name: 'NoPath',
      metrics: { git_safety: { dirty: 5 } },
      signals: { has_tests: true, has_ci: true, has_readme: true, has_license: true } },
  ],
  quests: [
    { id: 'q-orange', title: 'Orange quest', tier: 'orange', status: 'open', project_id: 'p2', insight: 'orange why' },
    { id: 'q-red', title: 'Red quest', tier: 'red', status: 'in_progress', project_id: 'p1', insight: 'red why' },
    { id: 'q-done', title: 'Done quest', tier: 'red', status: 'done', project_id: 'p1' },
    { id: 'q-ghost', title: 'Ghost quest', tier: 'yellow', status: 'open', project_id: 'nowhere' },
    { id: 'q-weird', title: 'Weird tier', tier: 'green', status: 'open', project_id: 'p1' },
  ],
  side_quests: [
    { id: 'sq-risk', project_id: 'p1', kind: 'risk', title: 'Not an idea' },
    { id: 'sq-idea-1', project_id: 'p1', kind: 'idea', title: 'Build the thing', detail: 'because reasons' },
    { id: 'sq-ghost', project_id: 'nowhere', kind: 'idea', title: 'Orphan idea' },
    { id: 'sq-idea-nopath', project_id: 'p3', kind: 'idea', title: 'Pathless idea' },
  ],
};

test('buildQueue: never throws, null/{} -> {items:[],counts:{}}', () => {
  assert.deepEqual(buildQueue(null), { items: [], counts: {} });
  assert.deepEqual(buildQueue(undefined), { items: [], counts: {} });
  assert.deepEqual(buildQueue({}), { items: [], counts: {} });
});

test('buildQueue: ordering across sources — threats, tasks, gaps, ideas', () => {
  const { items } = buildQueue(SEL);
  const sources = items.map((i) => i.source);
  // block order: every threat before every task before every gap before every idea
  const rank = { threat: 0, task: 1, gap: 2, idea: 3 };
  for (let i = 1; i < sources.length; i++) {
    assert.ok(rank[sources[i]] >= rank[sources[i - 1]],
      `source blocks out of order at ${i}: ${sources.join(',')}`);
  }
  // threats keep triage's blast-desc order: security(102) > uncommitted p3(55) > uncommitted p1(53) > stale(30) > no-tests(15) > no-ci(10)
  const threats = items.filter((i) => i.source === 'threat');
  assert.deepEqual(threats.map((t) => `${t.projectId}:${t.detail}`), [
    'p1:security', 'p3:uncommitted', 'p1:uncommitted', 'p2:stale', 'p2:no-tests', 'p2:no-ci',
  ]);
  // tasks sort by tier (red before orange before yellow before unknown), stable
  const tasks = items.filter((i) => i.source === 'task');
  assert.deepEqual(tasks.map((t) => t.id), ['task:q-red', 'task:q-orange', 'task:q-ghost', 'task:q-weird']);
});

test('buildQueue: severity mapping is a closed enum', () => {
  const { items } = buildQueue(SEL);
  const by = (id) => items.find((i) => i.id === id);
  // threats via warroom kind map
  assert.equal(by('threat:p1:security').severity, 'red');
  assert.equal(by('threat:p1:uncommitted').severity, 'orange');
  assert.equal(by('threat:p2:stale').severity, 'yellow');
  assert.equal(by('threat:p2:no-tests').severity, 'dim');
  assert.equal(by('threat:p2:no-ci').severity, 'dim');
  // tasks by tier
  assert.equal(by('task:q-red').severity, 'red');
  assert.equal(by('task:q-orange').severity, 'orange');
  assert.equal(by('task:q-ghost').severity, 'yellow');
  assert.equal(by('task:q-weird').severity, 'dim', 'unknown tier must land on dim, not leak through');
  // gaps and ideas are always dim
  assert.ok(items.filter((i) => i.source === 'gap').every((i) => i.severity === 'dim'));
  assert.ok(items.filter((i) => i.source === 'idea').every((i) => i.severity === 'dim'));
  // whole enum is closed
  const SEV = new Set(['red', 'orange', 'yellow', 'dim']);
  assert.ok(items.every((i) => SEV.has(i.severity)), 'severity outside the closed enum');
});

test('buildQueue: verbs per source; dispatch DROPPED when projectPath unresolvable', () => {
  const { items } = buildQueue(SEL);
  const by = (id) => items.find((i) => i.id === id);
  // path resolvable -> full verb sets
  assert.deepEqual(by('threat:p1:security').verbs, ['dispatch', 'open']);
  assert.deepEqual(by('task:q-red').verbs, ['done', 'dispatch', 'open']);
  assert.deepEqual(by('gap:p2:tests').verbs, ['dispatch', 'note']);
  assert.deepEqual(by('idea:sq-idea-1').verbs, ['dispatch']);
  // project exists but has no path -> dispatch dropped
  assert.equal(by('threat:p3:uncommitted').projectPath, null);
  assert.deepEqual(by('threat:p3:uncommitted').verbs, ['open']);
  // project_id not in selected.projects at all -> dispatch dropped
  assert.equal(by('task:q-ghost').projectPath, null);
  assert.deepEqual(by('task:q-ghost').verbs, ['done', 'open']);
  // idea with no resolvable path loses its only verb -> [] (never an inert verb)
  assert.deepEqual(by('idea:sq-ghost').verbs, []);
  assert.deepEqual(by('idea:sq-idea-nopath').verbs, []);
  // no item ever carries 'dispatch' without a path
  assert.ok(items.every((i) => i.projectPath || !i.verbs.includes('dispatch')),
    'inert dispatch verb found');
});

test('buildQueue: item fields — titles, details, project resolution, seedPrompt', () => {
  const { items } = buildQueue(SEL);
  const by = (id) => items.find((i) => i.id === id);
  // threat: title is triage's human detail, detail is the kind
  assert.equal(by('threat:p1:security').title, '2 exposed secrets');
  assert.equal(by('threat:p1:security').projectName, 'Alpha');
  assert.equal(by('threat:p1:security').projectPath, '/proj/alpha');
  // task: quest title + insight, project resolved by project_id
  assert.equal(by('task:q-red').title, 'Red quest');
  assert.equal(by('task:q-red').detail, 'red why');
  assert.equal(by('task:q-red').projectName, 'Alpha');
  assert.equal(by('task:q-red').projectPath, '/proj/alpha');
  assert.equal(by('task:q-ghost').projectName, null);
  // done quests never appear; open + in_progress both do
  assert.equal(by('task:q-done'), undefined);
  assert.ok(by('task:q-orange'), 'open quest present');
  assert.ok(by('task:q-red'), 'in_progress quest present');
  // gap: from agencyProposals, carries seedPrompt; p2 has tests+ci gaps only
  const gaps = items.filter((i) => i.source === 'gap');
  assert.deepEqual(gaps.map((g) => g.id), ['gap:p2:tests', 'gap:p2:ci']);
  assert.equal(gaps[0].title, 'No tests');
  assert.equal(gaps[0].projectPath, '/proj/beta');
  assert.match(gaps[0].seedPrompt, /test/i);
  // idea: only kind==='idea' side_quests; title becomes the task (seedPrompt === title)
  const ideas = items.filter((i) => i.source === 'idea');
  assert.deepEqual(ideas.map((i) => i.id), ['idea:sq-idea-1', 'idea:sq-ghost', 'idea:sq-idea-nopath']);
  assert.equal(by('idea:sq-idea-1').title, 'Build the thing');
  assert.equal(by('idea:sq-idea-1').seedPrompt, 'Build the thing');
  assert.equal(by('idea:sq-idea-1').detail, 'because reasons');
  assert.equal(by('idea:sq-risk'), undefined, 'non-idea side_quests excluded');
  // threats and tasks carry no seedPrompt
  assert.equal(by('threat:p1:security').seedPrompt, undefined);
  assert.equal(by('task:q-red').seedPrompt, undefined);
  // ids unique
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test('buildQueue: counts are per-source totals computed from items', () => {
  const { items, counts } = buildQueue(SEL);
  assert.deepEqual(counts, { threat: 6, task: 4, gap: 2, idea: 3 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), items.length);
  // a source with zero items contributes NO key (consistent with {} -> counts:{})
  const onlyThreats = buildQueue({ projects: [SEL.projects[0]] });
  assert.deepEqual(onlyThreats.counts, { threat: 2 });
});

test('buildQueue: real fixture smoke — no throw, counts sum to items', () => {
  const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/sample.json', import.meta.url), 'utf8'));
  const { items, counts } = buildQueue(fixture);
  assert.ok(Array.isArray(items) && items.length > 0, 'fixture produces items');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), items.length);
  const openQuests = (fixture.quests || []).filter((q) => q.status === 'open' || q.status === 'in_progress').length;
  assert.equal(counts.task ?? 0, openQuests, 'task count matches open+in_progress quests');
  const ideaSQs = (fixture.side_quests || []).filter((q) => q.kind === 'idea').length;
  assert.equal(counts.idea ?? 0, ideaSQs, 'idea count matches idea side_quests');
});
