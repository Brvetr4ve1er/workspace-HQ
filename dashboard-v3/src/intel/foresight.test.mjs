import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastLine, anomalyGroups, nudgeRows } from './foresight.mjs';

test('forecastLine: rising slope yields a day ETA; flat/negative yields no ETA', () => {
  const r = forecastLine({ xpSlope: 10, etaDays: 3.2, etaNextLevel: '2026-08-05T00:00:00.000Z' });
  assert.equal(r.trend, 'rising');
  assert.equal(r.slopePerDay, 10);
  assert.equal(r.etaLabel, '~4 days');
  assert.equal(r.etaISO, '2026-08-05T00:00:00.000Z');

  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).trend, 'flat');
  assert.equal(forecastLine({ xpSlope: -3, etaDays: null, etaNextLevel: null }).trend, 'falling');
  assert.equal(forecastLine({ xpSlope: 0, etaDays: null, etaNextLevel: null }).etaLabel, '—');
  assert.equal(forecastLine({ xpSlope: 5, etaDays: 0.4, etaNextLevel: 'x' }).etaLabel, '~1 day');
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
});
