/**
 * Marker language (spec section 11): shape = kind, fill = urgency, ring = state.
 * Diamond Contract, circle Errand, square Commission, flame Fire, bolt Quick win, shield Client (fixer), arch HQ.
 * Drawn as inline SVG strings from fixed templates: no user text ever goes into the markup.
 */
import type { JobKind, Urgency } from '../world/model';

const FILL: Record<Urgency, string> = { red: 'var(--red)', brass: 'var(--brass)', dim: 'var(--brass-dim)' };

const SHAPES: Record<JobKind | 'fixer' | 'hq', string> = {
  contract: '<path d="M12 2 L22 12 L12 22 L2 12 Z"/>',
  errand: '<circle cx="12" cy="12" r="8.5"/>',
  commission: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  fire: '<path d="M12 2 C14 7 19 9 19 15 A7 7 0 0 1 5 15 C5 11 8 10 9 6 C10 9 11 10 12 10 C12 7 11 5 12 2 Z"/>',
  quickwin: '<path d="M13 2 L5 13 H11 L10 22 L19 10 H13 Z"/>',
  fixer: '<path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z"/>',
  hq: '<path d="M4 21 V11 A8 8 0 0 1 20 11 V21 H15 V13 A3 3 0 0 0 9 13 V21 Z"/>',
};

export function markerSvg(kind: JobKind | 'fixer' | 'hq', urgency: Urgency | 'cyan'): string {
  const fill = urgency === 'cyan' ? 'var(--cyan)' : FILL[urgency];
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><g fill="${fill}" stroke="var(--void)" stroke-width="1.6" stroke-linejoin="round">${SHAPES[kind]}</g></svg>`;
}

export function legendSvg(kind: JobKind): string {
  return markerSvg(kind, kind === 'fire' ? 'red' : 'brass');
}
