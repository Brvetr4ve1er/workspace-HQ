import { describe, it, expect } from 'vitest';
import { xpForLevel, levelFor, levelProgress, discoveryXp, haversineM } from './xp';

describe('progression', () => {
  it('level curve is monotonic and starts at 0', () => {
    expect(xpForLevel(1)).toBe(0);
    for (let l = 1; l < 50; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  });
  it('levelFor inverts xpForLevel', () => {
    for (let l = 1; l < 30; l++) {
      expect(levelFor(xpForLevel(l))).toBe(l);
      expect(levelFor(xpForLevel(l + 1) - 1)).toBe(l);
    }
  });
  it('progress stays in [0,1)', () => {
    for (const xp of [0, 1, 99, 124, 125, 1000, 98765]) {
      const p = levelProgress(xp);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
  it('interest match pays more', () => {
    expect(discoveryXp({ matchesInterest: true, firstInCategory: false }))
      .toBeGreaterThan(discoveryXp({ matchesInterest: false, firstInCategory: false }));
  });
  it('haversine is sane (Algiers -> Paris ~1345 km)', () => {
    const d = haversineM([3.0588, 36.7538], [2.3522, 48.8566]);
    expect(d / 1000).toBeGreaterThan(1300);
    expect(d / 1000).toBeLessThan(1400);
  });
});
