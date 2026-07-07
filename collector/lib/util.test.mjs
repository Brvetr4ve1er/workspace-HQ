import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, round } from './util.mjs';

test('clamp bounds a value to [lo, hi]', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('round is integer rounding', () => {
  assert.equal(round(2.4), 2);
  assert.equal(round(2.5), 3);
});
