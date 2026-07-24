// Lexicon mechanism — LX(key) resolves against the active theme's register
// with fallback to default, same contract as v2's LX. Tables live in
// src/lexicon/lexicons.js; voice packs (M1) will stack on the same lookup.
import { LEXICONS } from '../lexicon/lexicons.js';

let LEX = { ...LEXICONS.default };

export function setLexTheme(id) {
  // The clean themes (NEXUS dark, DAYLIGHT light) speak PLAIN, professional
  // English — no RPG flavor. Other themes keep their own register.
  const key = (id === 'nexus' || id === 'daylight') ? 'plain' : id;
  LEX = { ...LEXICONS.default, ...(LEXICONS[key] || {}) };
}

export const LX = (k) => (LEX[k] !== undefined ? LEX[k] : LEXICONS.default[k] ?? k);
