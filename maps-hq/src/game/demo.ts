import type { NearbyPlace } from '../lib/supabase';
import { haversineM } from './xp';

/** Invented points scattered around the player so the loop is playable before Supabase is wired. Not real places. */
export function demoPlaces(center: [number, number], categories: string[]): NearbyPlace[] {
  const cats = categories.length ? categories : ['coffee', 'food', 'history', 'nature', 'tech'];
  let seed = Math.round(center[0] * 1000) ^ Math.round(center[1] * 1000);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: 24 }, (_, i) => {
    const lng = center[0] + (rnd() - 0.5) * 0.02;
    const lat = center[1] + (rnd() - 0.5) * 0.016;
    const category = cats[i % cats.length];
    return {
      id: `demo-${i}-${category}`,
      name: `Signal #${String(i + 1).padStart(2, '0')}`,
      category, lng, lat,
      distance_m: haversineM(center, [lng, lat]),
      interest_slugs: [category],
    };
  });
}
