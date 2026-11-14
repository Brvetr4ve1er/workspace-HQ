// node --test dashboard-v5/src/logic/decision.test.mjs
// Home as one decision: which task the card shows. Placeholder data only (the repo is public).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, projectOf, sourceOf, SOURCE_WORDS, MODES } from './decision.mjs';

const task = (id, proj) => ({ id, proj, title: 'Placeholder task ' + id });
const go = (projectId, extra) => Object.assign({ kind: 'go', tab: 'projects' }, projectId === undefined ? {} : { projectId }, extra || {});
const row = (key, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity: 'high', action }, extra || {});
const ids = (list) => list.map((t) => t.id);

// the ranker's order: a1 (project a), b1 (project b), a2 (project a), c1 (project c)
const OPEN = [task('a1', 'proj-a'), task('b1', 'proj-b'), task('a2', 'proj-a'), task('c1', 'proj-c')];

test('follows-brief: the lead row names a project, the card shows that project\'s top-ranked open task', () => {
  const d = decide({ briefItems: [row('secrets:proj-b:2', go('proj-b'))], open: OPEN });
  assert.equal(d.mode, 'follows-brief');
  assert.equal(d.next.id, 'b1');
  assert.deepEqual(ids(d.order), ['b1', 'a1', 'a2', 'c1']);
  assert.equal(d.lead.key, 'secrets:proj-b:2');
});

test('follows-brief takes the project\'s TOP task, not the first task that happens to be listed later', () => {
  const d = decide({ briefItems: [row('dirty:proj-a:12', go('proj-a'))], open: OPEN });
  assert.equal(d.next.id, 'a1');
  assert.deepEqual(ids(d.order), ['a1', 'b1', 'a2', 'c1']);
  // the ranker's own order decides which of a project's tasks is on top
  const d2 = decide({ briefItems: [row('dirty:proj-a:12', go('proj-a'))], open: [OPEN[1], OPEN[2], OPEN[0]] });
  assert.equal(d2.next.id, 'a2');
});

test('only the lead row counts: a later row naming another project does not move the card', () => {
  const d = decide({ briefItems: [row('scan-stale:x', { kind: 'scan' }), row('secrets:proj-c:1', go('proj-c'))], open: OPEN });
  assert.equal(d.mode, 'ranker');
  assert.equal(d.next.id, 'a1');
});

test('an empty Brief falls back to the ranker top (the all-clear fallback: Home is never hero-less)', () => {
  for (const briefItems of [[], undefined, null, 'not a list', {}]) {
    const d = decide({ briefItems, open: OPEN });
    assert.equal(d.mode, 'ranker');
    assert.equal(d.next.id, 'a1');
    assert.equal(d.lead, null);
    assert.deepEqual(d.briefOrder, []);
  }
});

test('a lead that is a group row (its action is group.listAction, no projectId) never follows, even when its own action names a project', () => {
  const group = row('dirty:proj-b:12', go('proj-b'), { count: 2, group: { n: 3, sinceAt: null, listAction: { kind: 'go', tab: 'projects', sub: 'grid' } } });
  assert.equal(projectOf(group), null);
  const d = decide({ briefItems: [group], open: OPEN });
  assert.equal(d.mode, 'ranker');
  assert.equal(d.next.id, 'a1');
  // a group row WITHOUT a list action keeps its own action (the ci-red kind already opens a list: no projectId there either)
  const ci = row('ci-red:o/r:d', { kind: 'go', tab: 'projects', sub: 'github' }, { count: 3, group: { n: 4, sinceAt: null, listAction: null } });
  assert.equal(decide({ briefItems: [ci], open: OPEN }).mode, 'ranker');
});

test('the Brief names a project with no open task: ranker top', () => {
  const d = decide({ briefItems: [row('secrets:proj-z:1', go('proj-z'))], open: OPEN });
  assert.equal(d.mode, 'ranker');
  assert.equal(d.next.id, 'a1');
});

test('no open task: mode rest, next null, an empty order (the All clear card)', () => {
  for (const open of [[], undefined, null]) {
    const d = decide({ briefItems: [row('secrets:proj-a:1', go('proj-a'))], open });
    assert.equal(d.mode, 'rest');
    assert.equal(d.next, null);
    assert.deepEqual(d.order, []);
  }
  assert.equal(decide().mode, 'rest');
  assert.equal(decide({}).next, null);
});

test('order: next first, the rest in ranker order, no duplicates, nothing lost or invented', () => {
  const dup = [OPEN[0], OPEN[1], OPEN[0], { ...OPEN[1] }, OPEN[2], OPEN[3]];   // the same object twice, and a copy with the same id
  const d = decide({ briefItems: [row('k:proj-c:1', go('proj-c'))], open: dup });
  assert.deepEqual(ids(d.order), ['c1', 'a1', 'b1', 'a2']);
  assert.equal(new Set(d.order).size, d.order.length);
  assert.equal(d.order[0], d.next);
  const plain = decide({ briefItems: [], open: OPEN });
  assert.deepEqual(plain.order, OPEN, 'the ranker mode is the ranker\'s own order');
});

test('stable on ties: tasks of one project keep the ranker\'s order, and the input list is never mutated', () => {
  const same = [task('t1', 'p'), task('t2', 'p'), task('t3', 'p'), task('t4', 'q')];
  const snapshot = same.slice();
  const d = decide({ briefItems: [row('k:q:1', go('q'))], open: same });
  assert.deepEqual(ids(d.order), ['t4', 't1', 't2', 't3']);
  assert.deepEqual(same, snapshot);
  assert.deepEqual(ids(decide({ briefItems: [], open: same }).order), ['t1', 't2', 't3', 't4']);
});

test('doneIds are respected (an array or a Set), also for the project the Brief follows', () => {
  const d = decide({ briefItems: [row('k:proj-a:1', go('proj-a'))], open: OPEN, doneIds: ['a1'] });
  assert.equal(d.next.id, 'a2');
  assert.deepEqual(ids(d.order), ['a2', 'b1', 'c1']);
  const s = decide({ briefItems: [], open: OPEN, doneIds: new Set(['a1', 'b1']) });
  assert.deepEqual(ids(s.order), ['a2', 'c1']);
  // everything done: rest; a followed project whose only tasks are done falls back to the ranker
  assert.equal(decide({ briefItems: [], open: OPEN, doneIds: ['a1', 'b1', 'a2', 'c1'] }).mode, 'rest');
  const fb = decide({ briefItems: [row('k:proj-c:1', go('proj-c'))], open: OPEN, doneIds: ['c1'] });
  assert.equal(fb.mode, 'ranker');
  assert.equal(fb.next.id, 'a1');
});

test('the match is String(task.proj) === String(action.projectId): numbers match their text, null and missing never match', () => {
  const open = [task('n1', 7), task('n2', null), task('n3', undefined), task('n4', 'proj-a')];
  assert.equal(decide({ briefItems: [row('k:7:1', go('7'))], open }).next.id, 'n1');
  assert.equal(decide({ briefItems: [row('k:7:1', go(7))], open: [task('s1', 'x'), task('s2', '7')] }).next.id, 's2');
  for (const projectId of [null, undefined, '', 'null', 'undefined', {}, []]) {
    const d = decide({ briefItems: [row('k:x:1', { kind: 'go', tab: 'projects', projectId })], open: [task('only', null), task('late', undefined)] });
    assert.equal(d.mode, 'ranker', 'projectId ' + JSON.stringify(projectId) + ' must not follow');
  }
});

test('a malformed row never throws: no action, no key, wrong types, holes', () => {
  const junk = [undefined, null, 0, 'text', [], {}, { key: 5 }, { key: 'k', action: 'go' }, { key: 'k', action: null }, { key: 'k', action: { projectId: 'proj-a' }, group: 'bad' }];
  for (const lead of junk) {
    assert.doesNotThrow(() => decide({ briefItems: [lead], open: OPEN }));
    assert.doesNotThrow(() => decide({ briefItems: [row('ok:proj-a:1', go('proj-a')), lead], open: OPEN }));
  }
  assert.equal(decide({ briefItems: [{}], open: OPEN }).mode, 'ranker');
  assert.equal(decide({ briefItems: [{ key: 'k', action: { projectId: 'proj-b' }, group: 'bad' }], open: OPEN }).next.id, 'b1', 'an action without a kind still names its project (the Brief builds the kind)');
  assert.doesNotThrow(() => decide({ briefItems: [row('k:a:1', go('proj-a'))], open: [null, undefined, 3, 'x', {}, task('ok', 'proj-a')] }));
  assert.equal(decide({ briefItems: [row('k:a:1', go('proj-a'))], open: [null, undefined, 3, 'x', {}, task('ok', 'proj-a')] }).next.id, 'ok');
});

test('briefOrder is the item keys in Brief order; rows without a string key are left out', () => {
  const items = [row('a:1', go('p')), { no: 'key' }, null, row('b:2', { kind: 'scan' }), row('c:3', go('p'))];
  assert.deepEqual(decide({ briefItems: items, open: [] }).briefOrder, ['a:1', 'b:2', 'c:3']);
  assert.deepEqual(decide({ briefItems: items, open: OPEN }).briefOrder, ['a:1', 'b:2', 'c:3']);
});

test('the source words: the card says whether it follows the Brief or the fixed rules, in both modes', () => {
  assert.equal(sourceOf('follows-brief'), 'Follows the top Brief row');
  assert.equal(sourceOf('ranker'), 'picked by fixed rules · not AI');
  assert.equal(sourceOf('rest'), '');
  assert.equal(sourceOf('nonsense'), SOURCE_WORDS.ranker, 'an unknown mode reads as the plain ranker words, never undefined');
  assert.equal(sourceOf(undefined), SOURCE_WORDS.ranker);
  assert.deepEqual(Object.values(MODES).sort(), ['follows-brief', 'ranker', 'rest']);
  assert.equal(decide({ briefItems: [row('k:proj-a:1', go('proj-a'))], open: OPEN }).mode, MODES.FOLLOWS);
});

test('pure: the same inputs give the same answer, and nothing in the input is changed', () => {
  const input = { briefItems: [row('k:proj-b:1', go('proj-b'))], open: OPEN, doneIds: ['a2'] };
  const before = JSON.stringify(input);
  const a = decide(input), b = decide(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(ids(a.order), ids(b.order));
  assert.equal(a.mode, b.mode);
});
