// Theme system — persist, swap live, no reload. Same THEMES table and the
// SAME localStorage key as v2 ('hq-theme'): the user's choice survives the
// swap, and parity screenshots compare like-for-like automatically.
import { bus } from './bus.js';
import { setLexTheme } from './lexicon.js';

export const THEMES = {
  arcade:    { label: 'ARCADE' },
  okami:     { label: 'OKAMI' },
  numidea:   { label: 'NUMIDEA' },
  ops:       { label: 'OPS DESK' },
  nightfall: { label: 'NIGHTFALL' },
};

const KEY = 'hq-theme';

export function currentTheme() {
  try { return localStorage.getItem(KEY) || 'arcade'; } catch { return 'arcade'; }
}

export function applyTheme(id) {
  if (!THEMES[id]) id = 'arcade';
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(KEY, id); } catch {}
  setLexTheme(id);
  bus.emit('theme:changed', { id });
}
