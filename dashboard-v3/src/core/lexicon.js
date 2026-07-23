// Lexicon mechanism — LX(key) resolves against the active theme's register
// with fallback to default, same contract as v2's LX. Tables live in
// src/lexicon/lexicons.js; voice packs (M1) will stack on the same lookup.
import { LEXICONS } from '../lexicon/lexicons.js';

let LEX = { ...LEXICONS.default };

export function setLexTheme(id) {
  // the cinematic NEXUS theme speaks the NIGHTFALL canon (its dark-fantasy soul)
  const key = id === 'nexus' ? 'nightfall' : id;
  LEX = { ...LEXICONS.default, ...(LEXICONS[key] || {}) };
}

export const LX = (k) => (LEX[k] !== undefined ? LEX[k] : LEXICONS.default[k] ?? k);
