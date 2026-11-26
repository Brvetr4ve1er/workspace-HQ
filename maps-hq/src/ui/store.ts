import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JobKind } from '../world/model';

/** View state only: what the legend hides, the search, what is selected. No game state lives here. */
type Selection = { kind: 'job'; id: string } | { kind: 'building'; id: string } | null;

type UiState = {
  hidden: JobKind[];
  query: string;
  selected: Selection;
  legendOpen: boolean;
  toggleKind: (k: JobKind) => void;
  showAll: () => void;
  hideAll: (all: JobKind[]) => void;
  setQuery: (q: string) => void;
  select: (s: Selection) => void;
  setLegendOpen: (v: boolean) => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      hidden: [],
      query: '',
      selected: null,
      legendOpen: true,
      toggleKind: (k) => set((s) => ({ hidden: s.hidden.includes(k) ? s.hidden.filter((x) => x !== k) : [...s.hidden, k] })),
      showAll: () => set({ hidden: [] }),
      hideAll: (all) => set({ hidden: [...all] }),
      setQuery: (query) => set({ query }),
      select: (selected) => set({ selected }),
      setLegendOpen: (legendOpen) => set({ legendOpen }),
    }),
    { name: 'maps-hq-view', version: 2, partialize: (s) => ({ hidden: s.hidden, legendOpen: s.legendOpen }) },
  ),
);

/** #job=<id> or #b=<projectId>: a permalink to one thing on the map (never carries the key). */
export function selectionFromHash(hash: string): Selection {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const job = p.get('job');
  if (job) return { kind: 'job', id: job };
  const b = p.get('b');
  if (b) return { kind: 'building', id: b };
  return null;
}

export function permalink(sel: NonNullable<Selection>, loc: Location = window.location): string {
  const p = new URLSearchParams(sel.kind === 'job' ? { job: sel.id } : { b: sel.id });
  return `${loc.origin}${loc.pathname}#${p.toString()}`;
}
