// Security space - the generator. PURE: no DOM, no storage, no clock; the only source of chance is the randomInt the caller
// hands in (makeRandomInt wraps crypto.getRandomValues, which the renderer owns). Nothing generated here is kept anywhere: the
// caller shows it, may copy it through hq:security:copy, and drops it.
//
//   generate({ kind: 'chars'|'words', length, sets: { lower, upper, digits, symbols } }, randomInt)
//     -> { ok: true, kind, text, bits, length } | { ok: false, error }
//
//   words:  `length` words (default 7, 3..16) drawn uniformly from WORDS and joined by '-'. bits = length * log2(WORDS.length).
//   chars:  `length` characters (default 20, 8..128) from the enabled sets, at least one of each enabled set, then shuffled.
//           bits = length * log2(pool size): an estimate (the one-of-each rule costs a little), worded 'about' by the vals.
//
// randomInt(bound) must return an integer in [0, bound). makeRandomInt builds one with REJECTION SAMPLING: a 32-bit draw at or
// above the largest multiple of `bound` is thrown away and drawn again, and the kept draw is mapped with a division (never the
// remainder operator), so no value is likelier than another. A test spies the draws and pins that.
import { WORDS } from './security-words.mjs';

export const SETS = Object.freeze({
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
});
export const SET_NAMES = Object.freeze(['lower', 'upper', 'digits', 'symbols']);

export const DEFAULTS = Object.freeze({ kind: 'words', wordCount: 7, charLength: 20, sets: Object.freeze({ lower: true, upper: true, digits: true, symbols: true }), separator: '-' });
export const LIMITS = Object.freeze({ words: Object.freeze([3, 16]), chars: Object.freeze([8, 128]) });

const TWO32 = 4294967296;

/** @param {(a: Uint32Array) => Uint32Array} getRandomValues crypto.getRandomValues bound to its crypto object */
export function makeRandomInt(getRandomValues) {
  if (typeof getRandomValues !== 'function') throw new Error('no random source');
  const buf = new Uint32Array(1);
  return function randomInt(bound) {
    if (!Number.isInteger(bound) || bound < 1 || bound > TWO32) throw new RangeError('randomInt needs an integer bound from 1 to 2^32');
    if (bound === 1) return 0;
    const step = Math.floor(TWO32 / bound);     // how many raw values map to each result
    const limit = step * bound;                  // raw values at or above this would favour the low results: draw again
    for (;;) {
      getRandomValues(buf);
      const x = buf[0];
      if (x < limit) return Math.floor(x / step);
    }
  };
}

/** The runtime's randomInt (browser or Node 19+); throws when there is no crypto at all, never falls back to Math.random. */
export function cryptoRandomInt() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('this window has no random source');
  return makeRandomInt((a) => c.getRandomValues(a));
}

const log2 = (n) => Math.log(n) / Math.LN2;
const roundBits = (b) => Math.round(b * 10) / 10;

function pickInt(value, dflt, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** Estimated bits for the same options without drawing anything (the UI shows it as the options change). */
export function estimateBits(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.kind === 'chars') {
    const groups = poolOf(o.sets);
    if (!groups.length) return 0;
    return roundBits(pickInt(o.length, DEFAULTS.charLength, Math.max(LIMITS.chars[0], groups.length), LIMITS.chars[1]) * log2(groups.join('').length));
  }
  const list = Array.isArray(o.words) && o.words.length ? o.words : WORDS;
  return roundBits(pickInt(o.length, DEFAULTS.wordCount, LIMITS.words[0], LIMITS.words[1]) * log2(list.length));
}

function poolOf(sets) {
  const s = sets && typeof sets === 'object' ? sets : DEFAULTS.sets;
  return SET_NAMES.filter((n) => s[n]).map((n) => SETS[n]);
}

function shuffle(arr, randomInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export function generate(opts, randomInt) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (typeof randomInt !== 'function') return { ok: false, error: 'no random source' };
  const kind = o.kind === 'chars' ? 'chars' : 'words';
  if (kind === 'words') {
    const list = Array.isArray(o.words) && o.words.length ? o.words : WORDS;
    const n = pickInt(o.length, DEFAULTS.wordCount, LIMITS.words[0], LIMITS.words[1]);
    const out = [];
    for (let i = 0; i < n; i++) out.push(list[randomInt(list.length)]);
    return { ok: true, kind, text: out.join(DEFAULTS.separator), bits: roundBits(n * log2(list.length)), length: n };
  }
  const groups = poolOf(o.sets);
  if (!groups.length) return { ok: false, error: 'pick at least one kind of character' };
  const n = pickInt(o.length, DEFAULTS.charLength, Math.max(LIMITS.chars[0], groups.length), LIMITS.chars[1]);
  const all = groups.join('');
  const chars = groups.map((g) => g[randomInt(g.length)]);      // one of each enabled set first
  while (chars.length < n) chars.push(all[randomInt(all.length)]);
  shuffle(chars, randomInt);                                     // so the guaranteed ones are not always first
  return { ok: true, kind, text: chars.join(''), bits: roundBits(n * log2(all.length)), length: n };
}
