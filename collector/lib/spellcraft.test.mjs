import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { settle } from './spellcraft.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '__fixtures__', f), 'utf8'));
const catalog = load('spellbook.sample.json');
const telemetry = load('spell-telemetry.sample.json');
const config = {
  cast_xp: 5, cast_xp_daily_cap_total: 25, first_cast_bonus: 15,
  spell_of_day_bonus: 10, mastery_rank_up_xp: 20,
  mastery_tiers: [
    { rank: 'novice', days: 1 }, { rank: 'adept', days: 5 },
    { rank: 'expert', days: 15 }, { rank: 'master', days: 40 },
    { rank: 'grandmaster', days: 100 },
  ],
  rarity_order: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
};

test('settle returns the four-key shape and non-negative XP', () => {
  const r = settle({ catalog, telemetry, config, prev: null, today: '2026-07-06' });
  assert.deepEqual(Object.keys(r).sort(), ['events', 'spellOfDay', 'spellXp', 'spellcraft'].sort());
  assert.ok(r.spellXp >= 0);
  assert.ok(r.spellcraft === null || typeof r.spellcraft === 'object');
});

test('settle degrades to null spellcraft when no catalog', () => {
  const r = settle({ catalog: null, telemetry: null, config, prev: null, today: '2026-07-06' });
  assert.equal(r.spellcraft, null);
  assert.equal(r.spellXp, 0);
  assert.deepEqual(r.events, []);
});

test('spellcraft rollup exposes the settlement watermark', () => {
  const r = settle({ catalog, telemetry, config, prev: null, today: '2026-07-06' });
  if (r.spellcraft) assert.ok('last_processed_at' in r.spellcraft);
});
