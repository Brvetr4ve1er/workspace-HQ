/** Pure progression rules. No IO: tested in xp.test.ts. */

/** Total XP needed to reach `level` (level 1 = 0). Gentle quadratic curve. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const n = level - 1;
  return 100 * n + 25 * n * n;
}

export function levelFor(xp: number): number {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

/** 0..1 progress inside the current level. */
export function levelProgress(xp: number): number {
  const lvl = levelFor(xp);
  const lo = xpForLevel(lvl);
  const hi = xpForLevel(lvl + 1);
  return (xp - lo) / (hi - lo);
}

/** XP for discovering a place: more when it matches the player's interests, bonus for a first-ever find. */
export function discoveryXp(opts: { matchesInterest: boolean; firstInCategory: boolean }): number {
  return 10 + (opts.matchesInterest ? 15 : 0) + (opts.firstInCategory ? 25 : 0);
}

/** Great-circle distance in metres. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const DISCOVER_RADIUS_M = 60;
