import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessForScanId } from './scrubber-core.mjs';

const at = (day) => new Date(2026, 7, day, 12, 0, 0);

test('freshnessForScanId reports calendar age with calm wording for recent scans', () => {
  assert.deepEqual(freshnessForScanId('2026-08-27', at(27)), { days: 0, state: 'fresh', label: 'scanned today' });
  assert.deepEqual(freshnessForScanId('2026-08-26', at(27)), { days: 1, state: 'fresh', label: 'scanned yesterday' });
  assert.deepEqual(freshnessForScanId('2026-08-25', at(27)), { days: 2, state: 'aging', label: 'scanned 2d ago' });
});

test('freshnessForScanId escalates only genuinely stale data and survives bad input', () => {
  assert.deepEqual(freshnessForScanId('2026-08-20', at(27)), { days: 7, state: 'stale', label: 'scanned 7d ago' });
  assert.deepEqual(freshnessForScanId('not-a-date', at(27)), { days: null, state: 'unknown', label: 'scan date unavailable' });
  assert.deepEqual(freshnessForScanId(undefined, new Date('invalid')), { days: null, state: 'unknown', label: 'scan date unavailable' });
});
