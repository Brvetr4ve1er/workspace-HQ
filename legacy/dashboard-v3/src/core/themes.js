// Theme system — persist, swap live, no reload. Same THEMES table and the
// SAME localStorage key as v2 ('hq-theme'): the user's choice survives the
// swap, and parity screenshots compare like-for-like automatically.
import { bus } from './bus.js';
import { setLexTheme } from './lexicon.js';

export const THEMES = {
  nexus:     { label: 'NEXUS' },      // clean dark — the default
  daylight:  { label: 'DAYLIGHT' },   // clean light
  arcade:    { label: 'ARCADE' },
  okami:     { label: 'OKAMI' },
  numidea:   { label: 'NUMIDEA' },
  ops:       { label: 'OPS DESK' },
  nightfall: { label: 'NIGHTFALL' },
};

const KEY = 'hq-theme';
const DEFAULT = 'nexus';

export function currentTheme() {
  try {
    // One-time migration: earlier boots auto-persisted 'arcade', so a returning
    // app would never see the new cinematic default. Flip everyone to NEXUS once;
    // after that their pick sticks (they can still choose any theme, arcade too).
    if (!localStorage.getItem('hq-theme-migrated')) {
      localStorage.setItem('hq-theme-migrated', '1');
      localStorage.setItem(KEY, DEFAULT);
      return DEFAULT;
    }
    return localStorage.getItem(KEY) || DEFAULT;
  } catch { return DEFAULT; }
}

export function applyTheme(id) {
  if (!THEMES[id]) id = DEFAULT;
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(KEY, id); } catch {}
  setLexTheme(id);
  bus.emit('theme:changed', { id });
}
