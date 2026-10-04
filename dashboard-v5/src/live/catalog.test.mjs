// The renderer mirrors two tables from schema/gamification.config.json because
// that file isn't baked into window.DATA. These fail the moment either drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEVELS, MILESTONES, levelOf } from './catalog.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../../../schema/gamification.config.json', import.meta.url), 'utf8'));

test('LEVELS match the schema level curve (level, min xp, title)', () => {
  assert.deepEqual(LEVELS, cfg.level_curve.tiers.map((t) => [t.level, t.min_xp, t.title]));
});

test('MILESTONES match the schema achievements (id, name, icon, order)', () => {
  assert.deepEqual(MILESTONES.map((m) => [m.id, m.name, m.icon]), cfg.achievements.map((a) => [a.id, a.name, a.icon]));
});

test('levelOf: thresholds, progress and the top level', () => {
  assert.deepEqual(levelOf(0), { l: 1, t: 'Drifter', min: 0, next: 150, pct: 0, toNext: 150 });
  assert.equal(levelOf(2686).l, 8);
  assert.equal(levelOf(2686).toNext, 414);
  assert.deepEqual(levelOf(5000), { l: 9, t: 'Grandmaster', min: 3100, next: null, pct: 100, toNext: 0 });
});
