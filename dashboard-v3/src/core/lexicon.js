// Lexicon mechanism — LX(key) resolves against the active theme's register
// with fallback to default, same contract as v2's LX. Tables live in
// src/lexicon/lexicons.js; voice packs (M1) will stack on the same lookup.
import { LEXICONS } from '../lexicon/lexicons.js';

let LEX = { ...LEXICONS.default };

export function setLexTheme(id) {
  // NEXUS (the default) speaks PLAIN, professional English — no RPG flavor.
  const key = id === 'nexus' ? 'plain' : id;
  LEX = { ...LEXICONS.default, ...(LEXICONS[key] || {}) };
}

export const LX = (k) => (LEX[k] !== undefined ? LEX[k] : LEXICONS.default[k] ?? k);
