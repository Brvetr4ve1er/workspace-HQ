import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastLine, anomalyGroups, nudgeRows } from './foresight.mjs';

// UNIT NOTE: derive.momentum()'s slope is per TREND SAMPLE (= per scan), and its
// `etaDays` field inherits that unit despite the name. forecastLine is where the
// honest unit is applied, so these assertions are the guard on it: the exported
// field is `slopePerScan` and the ETA reads "scans", never "days". If a future
// change wants calendar days it must first divide by an observed scans-per-day
// rate — nothing computes one today.
test('forecastLine: rising slope yields a scan-count ETA; flat/negative yields no ETA', () => {
  const r = forecastLine({ xpSlope: 10, etaDays: 3.2, etaNextLevel: '2026-08-05T00:00:00.000Z' });
  assert.equal(r.trend, 'rising');
  assert.equal(r.slopePerScan, 10);
  assert.equal(r.etaLabel, '~4 scans');
  assert.equal(r.etaISO, '2026-08-05T00:00:00.000Z');
  assert.equal(r.slopePerDay, undefined, 'the days-named field must not come back');

  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).trend, 'flat');
  assert.equal(forecastLine({ xpSlope: -3, etaDays: null, etaNextLevel: null }).trend, 'falling');
  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).etaLabel, '—');
  assert.equal(forecastLine({ xpSlope: 5, etaDays: 0.4, etaNextLevel: 'x' }).etaLabel, '~1 scan');
  assert.doesNotThrow(() => forecastLine(null));
  assert.doesNotThrow(() => forecastLine({}));
});

test('anomalyGroups: only non-empty groups, in order, with human bytes', () => {
  const a = {
    clones: 2, duplicates: 1, empty: 0, reclaimableBytes: 1960209832,
    items: [
      { label: 'playwright', kind: 'clone' },
      { label: 'vite', kind: 'clone' },
      { label: 'x mirrors y', kind: 'duplicate' },
    ],
  };
  const g = anomalyGroups(a);
  assert.equal(g.total, 3);
  assert.equal(g.reclaimableLabel, '1.8 GB');
  assert.deepEqual(g.groups.map((x) => x.kind), ['clone', 'duplicate']);   // empty omitted
  assert.equal(g.groups[0].count, 2);
  assert.equal(g.groups[0].items.length, 2);
  assert.equal(anomalyGroups({ items: [], reclaimableBytes: 0 }).reclaimableLabel, '0 B');
  assert.doesNotThrow(() => anomalyGroups(null));
});

test('anomalyGroups: the empty kind groups last; humanBytes steps through KB/MB/GB', () => {
  const g = anomalyGroups({
    reclaimableBytes: 5 * 1024 ** 2,
    items: [
      { label: 'stale-dir', kind: 'empty' },
      { label: 'playwright', kind: 'clone' },
      { label: 'other-stale-dir', kind: 'empty' },
    ],
  });
  assert.equal(g.total, 3);
  assert.deepEqual(g.groups.map((x) => x.kind), ['clone', 'empty']);   // KIND_ORDER, not insertion order
  assert.equal(g.groups[1].count, 2);
  assert.deepEqual(g.groups[1].items.map((i) => i.label), ['stale-dir', 'other-stale-dir']);

  // humanBytes is exercised only through reclaimableLabel (it is not exported).
  assert.equal(g.reclaimableLabel, '5 MB');
  assert.equal(anomalyGroups({ items: [], reclaimableBytes: 4096 }).reclaimableLabel, '4 KB');
  assert.equal(anomalyGroups({ items: [], reclaimableBytes: 1536 }).reclaimableLabel, '1.5 KB');
  assert.equal(anomalyGroups({ items: [], reclaimableBytes: 900 }).reclaimableLabel, '900 B');
});

// DOCUMENTED CURRENT BEHAVIOUR, not an endorsement: `total` counts every item in
// the list, but `groups` is built by filtering against the closed KIND_ORDER set,
// so an item with an unrecognised kind is counted and then rendered nowhere. That
// is why the Med-Bay heading may only claim the row count and nothing about what
// the rows are worth. Left as-is deliberately — widening KIND_ORDER is a data
// contract question (which kinds exist is derive.anomalies()'s call, struct lane),
// and silently dropping unknowns from `total` would hide a contract drift instead
// of surfacing it as a visible count mismatch.
test('anomalyGroups: an unknown kind is counted in total but lands in no group', () => {
  const g = anomalyGroups({
    reclaimableBytes: 0,
    items: [
      { label: 'playwright', kind: 'clone' },
      { label: 'mystery', kind: 'symlink-loop' },
      { label: 'no kind at all' },
    ],
  });
  assert.equal(g.total, 3);
  assert.deepEqual(g.groups.map((x) => x.kind), ['clone']);
  const grouped = g.groups.reduce((n, x) => n + x.count, 0);
  assert.equal(grouped, 1);
  assert.notEqual(grouped, g.total, 'total intentionally exceeds the grouped count here');
});

test('nudgeRows: injected labels, pct, sorted desc; unknown id falls back to the id', () => {
  const ACHX = { version_control: { name: 'Under Control', icon: 'L' } };
  const rows = nudgeRows(
    [{ id: 'secret_free', have: 5, need: 8 }, { id: 'version_control', have: 7, need: 8 }],
    (id) => ACHX[id],
  );
  assert.equal(rows[0].id, 'version_control');        // 88% sorts above 63%
  assert.equal(rows[0].label, 'Under Control');
  assert.equal(rows[0].icon, 'L');
  assert.equal(rows[0].pct, 88);
  assert.equal(rows[1].label, 'secret_free');          // no entry -> raw id
  assert.equal(rows[1].icon, '');
  assert.doesNotThrow(() => nudgeRows(null, () => undefined));
  assert.deepEqual(nudgeRows({}, () => undefined), []);
  assert.deepEqual(nudgeRows(undefined, () => undefined), []);
});

// derive.achievementNudges() should never emit have > need, but the nudge bar
// writes pct straight into a CSS width — an over-100 value would paint the fill
// outside its track. clamp() is the guard; this pins it.
test('nudgeRows: pct is clamped to 0..100 when have overshoots need', () => {
  const rows = nudgeRows([{ id: 'over', have: 10, need: 8 }], () => undefined);
  assert.equal(rows[0].pct, 100);
  assert.equal(rows[0].have, 10);        // the raw counts are reported honestly
  assert.equal(rows[0].need, 8);
  assert.equal(nudgeRows([{ id: 'neg', have: -4, need: 8 }], () => undefined)[0].pct, 0);
  assert.equal(nudgeRows([{ id: 'zero', have: 3, need: 0 }], () => undefined)[0].pct, 0);
});
