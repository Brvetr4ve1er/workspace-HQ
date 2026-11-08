// Cosmos Feed grouping. Behaviour ported from Cosmos Local's grouping.test.ts; invented works only.
//   node --test dashboard-v5/src/logic/cosmos-group.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWorks, monthLabel, TAG_GROUP_CAP, GROUP_MODES, UNTAGGED_KEY, OTHER_TAGS_KEY } from './cosmos-group.mjs';
import { hexToRgb, toColorSig } from './cosmos-color.mjs';

const work = (id, o = {}) => ({ id, title: id, type: 'misc', ...o });
const colored = (id, hex, o = {}) => { const { r, g, b } = hexToRgb(hex); return work(id, { color: toColorSig(r, g, b), ...o }); };
const shape = (groups) => groups.map((g) => [g.key, g.works.map((w) => w.id)]);

test('empty input is no groups, for every mode', () => {
  for (const mode of GROUP_MODES) assert.deepEqual(groupWorks([], mode, { today: '2026-11-08' }), [], mode);
  assert.deepEqual(groupWorks(null, 'type'), []);
});

test("mode none is one unlabelled group holding every work in order", () => {
  const ws = [work('b'), work('a')];
  const g = groupWorks(ws, 'none', { today: '2026-11-08' });
  assert.equal(g.length, 1);
  assert.equal(g[0].key, 'all');
  assert.equal(g[0].label, '');
  assert.deepEqual(g[0].works.map((w) => w.id), ['b', 'a']);
});

test('type: taxonomy order, empty types skipped, labels from the type table', () => {
  const ws = [work('p', { type: 'photo' }), work('u', { type: 'ui' }), work('p2', { type: 'photo' }), work('d', { type: '3d' })];
  const g = groupWorks(ws, 'type');
  assert.deepEqual(shape(g), [['3d', ['d']], ['ui', ['u']], ['photo', ['p', 'p2']]]);
  assert.deepEqual(g.map((x) => x.label), ['3D & Render', 'UI & Product', 'Photography']);
  const strange = groupWorks([work('s', { type: 'mystery' }), work('p', { type: 'photo' })], 'type');
  assert.deepEqual(shape(strange), [['photo', ['p']], ['mystery', ['s']]], 'an unknown type still shows, last');
});

test("family: hue families around the wheel, MONO, then 'Unscanned' for works with no colour", () => {
  const ws = [work('none'), colored('grey', '#8a8a8a'), colored('teal', '#1a6b52'), colored('red', '#e03020'), colored('red2', '#d02010')];
  const g = groupWorks(ws, 'family');
  assert.deepEqual(shape(g), [['RED', ['red', 'red2']], ['TEAL', ['teal']], ['MONO', ['grey']], ['unscanned', ['none']]]);
  assert.deepEqual(g.map((x) => x.label), ['red', 'teal', 'mono', 'Unscanned']);
});

test("month: newest first, 'Undated' last, English labels", () => {
  const ws = [
    work('old', { createdAt: '2025-12-24T10:00:00Z' }),
    work('none'),
    work('new', { createdAt: '2026-11-02T10:00:00Z' }),
    work('new2', { createdAt: '2026-11-30T10:00:00Z' }),
    work('mid', { createdAt: '2026-03-02T10:00:00Z' }),
    work('junk', { createdAt: 'not a date' }),
  ];
  const g = groupWorks(ws, 'month', { today: '2026-11-08' });
  assert.deepEqual(shape(g), [['2026-11', ['new', 'new2']], ['2026-03', ['mid']], ['2025-12', ['old']], ['undated', ['none', 'junk']]]);
  assert.deepEqual(g.map((x) => x.label), ['November 2026', 'March 2026', 'December 2025', 'Undated']);
  assert.equal(monthLabel('2026-01'), 'January 2026');
  assert.equal(monthLabel('garbage'), 'Undated');
});

test("tag: each work files under its most-used tag, largest group first, 'Untagged' last", () => {
  const ws = [
    work('a', { tags: ['poster', 'wip'] }),
    work('b', { tags: ['poster'] }),
    work('c', { tags: ['wip'] }),
    work('d', { tags: ['poster', 'rare'] }),
    work('e'),
    work('f', { tags: [] }),
    work('g', { tags: ['solo'] }),
  ];
  const g = groupWorks(ws, 'tag');
  assert.deepEqual(shape(g), [['poster', ['a', 'b', 'd']], ['wip', ['c']], ['solo', ['g']], [UNTAGGED_KEY, ['e', 'f']]]);
  assert.equal(g[g.length - 1].label, 'Untagged');
  // a tie is won by the work's first tag
  const tie = groupWorks([work('x', { tags: ['b', 'a'] }), work('y', { tags: ['a', 'b'] })], 'tag');
  assert.deepEqual(shape(tie), [['b', ['x']], ['a', ['y']]]);
  // a real tag called 'untagged' does not collide with the Untagged group
  const clash = groupWorks([work('p', { tags: ['untagged'] }), work('q')], 'tag');
  assert.deepEqual(clash.map((x) => x.key), ['untagged', UNTAGGED_KEY]);
});

test('tag: the long tail collapses into one "Other tags (n)" group, still in incoming order', () => {
  const ws = [];
  for (let i = 0; i < TAG_GROUP_CAP + 5; i += 1) ws.push(work(`w${i}`, { tags: [`tag-${String(i).padStart(2, '0')}`] }));
  ws.push(work('plain'));
  const g = groupWorks(ws, 'tag');
  assert.equal(g.length, TAG_GROUP_CAP + 2);
  const other = g[TAG_GROUP_CAP];
  assert.equal(other.key, OTHER_TAGS_KEY);
  assert.equal(other.label, 'Other tags (5)');
  assert.deepEqual(other.works.map((w) => w.id), ['w30', 'w31', 'w32', 'w33', 'w34']);
  assert.equal(g[TAG_GROUP_CAP + 1].key, UNTAGGED_KEY);
});

test('order inside each group is the incoming order, and nothing is lost or duplicated', () => {
  const ws = [work('1', { type: 'ui' }), work('2', { type: 'photo' }), work('3', { type: 'ui' }), work('4', { type: 'ui' })];
  for (const mode of GROUP_MODES) {
    const g = groupWorks(ws, mode, { today: '2026-11-08' });
    const flat = g.flatMap((x) => x.works.map((w) => w.id)).sort();
    assert.deepEqual(flat, ['1', '2', '3', '4'], mode);
  }
  assert.deepEqual(groupWorks(ws, 'type')[0].works.map((w) => w.id), ['1', '3', '4']);
});
