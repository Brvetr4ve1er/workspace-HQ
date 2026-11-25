import { describe, it, expect } from 'vitest';
import { revealAround, fogCells, CELL } from './fog';

describe('fog of war', () => {
  it('reveals a 3x3 block', () => {
    expect(new Set(revealAround(3.05, 36.75)).size).toBe(9);
  });
  it('revealed cells drop out of the fog', () => {
    const b = { west: 3.04, south: 36.74, east: 3.06, north: 36.76 };
    const before = fogCells(b, new Set()).features.length;
    const after = fogCells(b, new Set(revealAround(3.05, 36.75))).features.length;
    expect(before - after).toBe(9);
  });
  it('gives up when zoomed out', () => {
    expect(fogCells({ west: -10, south: 30, east: 10, north: 50 }, new Set()).features.length).toBe(0);
    expect(CELL).toBeGreaterThan(0);
  });
});
