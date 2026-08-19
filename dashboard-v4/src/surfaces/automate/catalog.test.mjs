// node --test dashboard-v4/src/surfaces/automate/catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usageDays, usageOf, lastCastOf, kindMatch, isRunnable, isCastable,
  filterSpells, defaultFilters, filtersDirty, fmtCd, catLabel, srcLabel,
} from './catalog.mjs';

const sp = (over) => ({
  id: 'x', name: 'x', source: 'skill', kind: 'channeled', school: 'divination',
  description: '', schedule: null, ...over,
});

const SPELLS = [
  sp({ id: 'a', name: 'alpha scan', kind: 'castable', source: 'script', school: 'divination', description: 'scans things' }),
  sp({ id: 'b', name: 'beta build', kind: 'channeled', source: 'skill', school: 'transmutation', description: 'builds things' }),
  sp({ id: 'c', name: 'gamma docs', kind: 'tome', source: 'plugin', school: 'conjuration', description: 'reference only' }),
  sp({ id: 'd', name: 'delta chain', kind: 'chain', source: 'grimoire', school: 'evocation', schedule: { next_run: null } }),
];

// build-time sidecar shape (arrays) AND live hq.getSpellTelemetry shape (counts)
const ROLLUP_ARR = { a: { distinct_days: ['2026-01-01', '2026-01-02'], last_cast: '2026-01-02T10:00:00Z' } };
const ROLLUP_NUM = { a: { distinct_days: 2, last_cast: '2026-01-02T10:00:00Z' } };

test('usageDays normalizes both telemetry shapes', () => {
  assert.equal(usageDays(ROLLUP_ARR, 'a'), 2);
  assert.equal(usageDays(ROLLUP_NUM, 'a'), 2);
  assert.equal(usageDays(ROLLUP_ARR, 'missing'), 0);
  assert.equal(usageDays(null, 'a'), 0);
  assert.equal(usageDays({ a: { distinct_days: 'garbage' } }, 'a'), 0);
});

test('usageOf tiers: 2 distinct days = Novice, 1 pip', () => {
  const m = usageOf(ROLLUP_ARR, 'a');
  assert.deepEqual(m, { days: 2, pips: 1, rank: 'Novice' });
  assert.deepEqual(usageOf(ROLLUP_ARR, 'b'), { days: 0, pips: 0, rank: null });
});

test('lastCastOf parses, and tolerates absence', () => {
  assert.ok(lastCastOf(ROLLUP_ARR, 'a') > 0);
  assert.equal(lastCastOf(ROLLUP_ARR, 'zzz'), 0);
});

test('kindMatch buckets', () => {
  assert.ok(kindMatch(SPELLS[0], 'run'));      // castable
  assert.ok(kindMatch(SPELLS[3], 'run'));      // chain
  assert.ok(kindMatch(SPELLS[1], 'interactive'));
  assert.ok(kindMatch(SPELLS[2], 'plugin'));
  assert.ok(kindMatch(SPELLS[2], 'all'));
  assert.ok(!kindMatch(SPELLS[2], 'run'));
});

test('isRunnable / isCastable', () => {
  assert.ok(isRunnable(SPELLS[0]) && isRunnable(SPELLS[3]));
  assert.ok(!isRunnable(SPELLS[1]) && !isRunnable(SPELLS[2]));
  assert.ok(isCastable(SPELLS[1]));
  assert.ok(!isCastable(SPELLS[2]));
});

test('filterSpells: search matches name/description/id, case-insensitive', () => {
  const f = { ...defaultFilters(), search: 'BUILD' };
  const hits = filterSpells(SPELLS, f, { rollup: {} });
  assert.deepEqual(hits.map((s) => s.id), ['b']);
});

test('filterSpells: source=plugin also catches tomes; scheduled-only cut', () => {
  const bySrc = filterSpells(SPELLS, { ...defaultFilters(), source: 'plugin' }, {});
  assert.deepEqual(bySrc.map((s) => s.id), ['c']);
  const sched = filterSpells(SPELLS, { ...defaultFilters(), scheduled: true }, {});
  assert.deepEqual(sched.map((s) => s.id), ['d']);
});

test('filterSpells: usage cut uses normalized telemetry (both shapes agree)', () => {
  for (const rollup of [ROLLUP_ARR, ROLLUP_NUM]) {
    const used = filterSpells(SPELLS, { ...defaultFilters(), usage: 'used' }, { rollup });
    assert.deepEqual(used.map((s) => s.id), ['a']);
    const unused = filterSpells(SPELLS, { ...defaultFilters(), usage: 'unused' }, { rollup });
    assert.deepEqual(unused.map((s) => s.id).sort(), ['b', 'c', 'd']);
  }
});

test('filterSpells: default sort = favorites first, then usage', () => {
  const hits = filterSpells(SPELLS, defaultFilters(), { rollup: ROLLUP_ARR, favorites: ['c'] });
  assert.equal(hits[0].id, 'c');           // favorite pinned first
  assert.equal(hits[1].id, 'a');           // then the only used one
});

test('filterSpells: favOnly cut, name sort', () => {
  const hits = filterSpells(SPELLS, { ...defaultFilters(), favOnly: true }, { favorites: ['d', 'b'] });
  assert.deepEqual(hits.map((s) => s.id).sort(), ['b', 'd']);
  const byName = filterSpells(SPELLS, { ...defaultFilters(), sort: 'name' }, {});
  assert.deepEqual(byName.map((s) => s.id), ['a', 'b', 'd', 'c']); // alpha beta delta gamma
});

test('filterSpells survives malformed input', () => {
  assert.deepEqual(filterSpells(null, defaultFilters(), {}), []);
  assert.deepEqual(filterSpells([null, 1, 'x'], defaultFilters(), {}), []);
});

test('filtersDirty flags any off-default field', () => {
  assert.equal(filtersDirty(defaultFilters()), false);
  assert.equal(filtersDirty({ ...defaultFilters(), search: 'q' }), true);
  assert.equal(filtersDirty({ ...defaultFilters(), scheduled: true }), true);
});

test('fmtCd', () => {
  assert.equal(fmtCd(-5), 'ready');
  assert.equal(fmtCd(NaN), 'ready');
  assert.equal(fmtCd(90000), '1m');
  assert.equal(fmtCd(3.7e6), '1h 1m');
});

test('labels degrade to plain text, never undefined', () => {
  assert.equal(catLabel('divination'), 'Analyze');
  assert.equal(catLabel('mystery'), 'Other');
  assert.equal(srcLabel('skill'), 'Skills');
  assert.equal(srcLabel('weird'), 'weird');
});
