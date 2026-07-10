import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor } from './gamification.mjs';

const tiers = [
  { level: 1, title: 'Novice', min_xp: 0 },
  { level: 2, title: 'Apprentice', min_xp: 100 },
  { level: 3, title: 'Adept', min_xp: 300 },
];

test('levelFor picks the highest tier at or below xp', () => {
  const r = levelFor(150, tiers);
  assert.equal(r.level, 2);
  assert.equal(r.xp_into_level, 50);
  assert.equal(r.xp_to_next, 150);
});

test('levelFor at top tier reports zero to next', () => {
  const r = levelFor(500, tiers);
  assert.equal(r.level, 3);
  assert.equal(r.xp_to_next, 0);
});
