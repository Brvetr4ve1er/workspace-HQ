import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { discoveryXp, levelFor } from './xp';
import { revealAround } from './fog';

export type Discovery = { placeId: string; category: string; at: number };

type GameState = {
  interests: string[];
  xp: number;
  discoveries: Record<string, Discovery>;
  player: [number, number];
  /** Fog-of-war: cleared cell keys (see fog.ts). */
  revealed: string[];
  toggleInterest: (slug: string) => void;
  movePlayer: (lngLat: [number, number]) => void;
  discover: (placeId: string, category: string) => number;
  level: () => number;
};

/** Local-first game state. Persisted to localStorage; synced to Supabase `user_progress` once auth lands. */
export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      interests: [],
      xp: 0,
      discoveries: {},
      player: [3.0588, 36.7538],
      revealed: [],
      toggleInterest: (slug) =>
        set((s) => ({ interests: s.interests.includes(slug) ? s.interests.filter((x) => x !== slug) : [...s.interests, slug] })),
      movePlayer: (lngLat) =>
        set((s) => {
          const add = revealAround(lngLat[0], lngLat[1]).filter((k) => !s.revealed.includes(k));
          return { player: lngLat, revealed: add.length ? [...s.revealed, ...add].slice(-20000) : s.revealed };
        }),
      discover: (placeId, category) => {
        const s = get();
        if (s.discoveries[placeId]) return 0;
        const firstInCategory = !Object.values(s.discoveries).some((d) => d.category === category);
        const gained = discoveryXp({ matchesInterest: s.interests.includes(category), firstInCategory });
        set({ xp: s.xp + gained, discoveries: { ...s.discoveries, [placeId]: { placeId, category, at: Date.now() } } });
        return gained;
      },
      level: () => levelFor(get().xp),
    }),
    { name: 'maps-hq-game', version: 1 },
  ),
);
