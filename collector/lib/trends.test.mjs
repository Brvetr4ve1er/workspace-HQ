import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendTrend } from './trends.mjs';

test('appendTrend replaces an existing same-day point (idempotent)', () => {
  const start = [{ d: '2026-07-05', v: 1 }, { d: '2026-07-06', v: 2 }];
  const out = appendTrend(start, { d: '2026-07-06', v: 9 }, '2026-07-06');
  assert.equal(out.filter((x) => x.d === '2026-07-06').length, 1);
  assert.equal(out.find((x) => x.d === '2026-07-06').v, 9);
});

test('appendTrend appends a new day', () => {
  const out = appendTrend([{ d: '2026-07-05', v: 1 }], { d: '2026-07-06', v: 2 }, '2026-07-06');
  assert.equal(out.length, 2);
});
