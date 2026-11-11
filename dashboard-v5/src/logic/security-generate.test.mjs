// Security space - the generator (logic/security-generate.mjs) and its word list (logic/security-words.mjs). Plain Node, no DOM.
//
//   node --test dashboard-v5/src/logic/security-generate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, makeRandomInt, cryptoRandomInt, estimateBits, SETS, DEFAULTS, LIMITS } from './security-generate.mjs';
import { WORDS } from './security-words.mjs';

// a deterministic randomInt for the tests (a tiny LCG); it records every bound it was asked for
function seeded(seed = 7) {
  let s = seed >>> 0;
  const bounds = [];
  const fn = (bound) => { bounds.push(bound); s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * bound); };
  fn.bounds = bounds;
  return fn;
}

test('the word list holds at least 1024 unique lower-case words of 3 to 8 letters', () => {
  assert.ok(WORDS.length >= 1024, 'size ' + WORDS.length);
  assert.equal(new Set(WORDS).size, WORDS.length, 'duplicates in the list');
  for (const w of WORDS) assert.match(w, /^[a-z]{3,8}$/, w);
  assert.ok(Object.isFrozen(WORDS));
});

test('generate words: 7 words from the list joined by "-", bits = 7 * log2(list size)', () => {
  const r = generate({ kind: 'words', length: 7 }, seeded());
  assert.equal(r.ok, true);
  const parts = r.text.split('-');
  assert.equal(parts.length, 7);
  for (const p of parts) assert.ok(WORDS.includes(p), p);
  assert.equal(r.bits, Math.round(7 * Math.log2(WORDS.length) * 10) / 10);
  assert.equal(r.kind, 'words');
});

test('the defaults are 7 words and 20 characters with every set', () => {
  assert.equal(DEFAULTS.wordCount, 7);
  assert.equal(DEFAULTS.charLength, 20);
  assert.deepEqual({ ...DEFAULTS.sets }, { lower: true, upper: true, digits: true, symbols: true });
  assert.equal(generate({ kind: 'words' }, seeded()).text.split('-').length, 7);
  assert.equal(generate({ kind: 'chars' }, seeded()).text.length, 20);
  assert.equal(generate({}, seeded()).kind, 'words');
});

test('generate chars: length 20 holds at least one of each enabled set, over many draws', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = generate({ kind: 'chars', length: 20, sets: { lower: true, upper: true, digits: true, symbols: true } }, seeded(seed));
    assert.equal(r.text.length, 20);
    for (const name of ['lower', 'upper', 'digits', 'symbols']) assert.ok([...r.text].some((c) => SETS[name].includes(c)), 'seed ' + seed + ' lacks ' + name + ': ' + r.text);
  }
});

test('generate chars with only some sets never uses the others', () => {
  const r = generate({ kind: 'chars', length: 30, sets: { lower: true, digits: true } }, seeded(3));
  assert.ok([...r.text].every((c) => SETS.lower.includes(c) || SETS.digits.includes(c)), r.text);
  assert.ok([...r.text].some((c) => SETS.digits.includes(c)) && [...r.text].some((c) => SETS.lower.includes(c)));
  assert.equal(r.bits, Math.round(30 * Math.log2(36) * 10) / 10);
});

test('no set enabled is an honest refusal, not an empty password', () => {
  const r = generate({ kind: 'chars', length: 20, sets: { lower: false, upper: false, digits: false, symbols: false } }, seeded());
  assert.deepEqual(r, { ok: false, error: 'pick at least one kind of character' });
  assert.deepEqual(generate({ kind: 'words' }, null), { ok: false, error: 'no random source' });
});

test('lengths are clamped to the limits and a junk length falls back to the default', () => {
  assert.equal(generate({ kind: 'words', length: 1 }, seeded()).length, LIMITS.words[0]);
  assert.equal(generate({ kind: 'words', length: 500 }, seeded()).length, LIMITS.words[1]);
  assert.equal(generate({ kind: 'chars', length: 2 }, seeded()).text.length, LIMITS.chars[0]);
  assert.equal(generate({ kind: 'chars', length: 9999 }, seeded()).text.length, LIMITS.chars[1]);
  assert.equal(generate({ kind: 'chars', length: 'abc' }, seeded()).text.length, DEFAULTS.charLength);
});

test('generate only asks randomInt for a bound (a positive integer), never for a float', () => {
  const r = seeded(11);
  generate({ kind: 'chars', length: 20 }, r);
  generate({ kind: 'words', length: 7 }, r);
  assert.ok(r.bounds.length >= 27);
  for (const b of r.bounds) assert.ok(Number.isInteger(b) && b >= 1, 'bound ' + b);
  assert.ok(r.bounds.includes(WORDS.length));
});

test('estimateBits agrees with generate for both kinds and is 0 for an empty pool', () => {
  assert.equal(estimateBits({ kind: 'words', length: 7 }), generate({ kind: 'words', length: 7 }, seeded()).bits);
  assert.equal(estimateBits({ kind: 'chars', length: 20 }), generate({ kind: 'chars', length: 20 }, seeded()).bits);
  assert.equal(estimateBits({ kind: 'chars', length: 20, sets: {} }), 0);
});

// ---- rejection sampling ------------------------------------------------------------------------------------------------
function fakeCrypto(values) {
  const draws = [];
  const getRandomValues = (a) => { const v = values[draws.length]; assert.ok(v !== undefined, 'the sampler asked for more draws than the test supplied'); draws.push(v); a[0] = v; return a; };
  return { getRandomValues, draws };
}

test('makeRandomInt rejects a raw draw in the biased tail and draws again', () => {
  // bound 10: 2^32 = 429496729 * 10 + 6, so raw values 4294967290..4294967295 are the biased tail
  const c = fakeCrypto([4294967295, 4294967290, 12345]);
  const ri = makeRandomInt(c.getRandomValues);
  const out = ri(10);
  assert.equal(c.draws.length, 3, 'two tail draws are thrown away');
  assert.equal(out, Math.floor(12345 / 429496729));
  assert.ok(out >= 0 && out < 10);
});

test('makeRandomInt keeps a draw just below the limit and maps it into [0, bound)', () => {
  const c = fakeCrypto([4294967289]);
  assert.equal(makeRandomInt(c.getRandomValues)(10), 9);
  assert.equal(c.draws.length, 1);
  const z = fakeCrypto([0]);
  assert.equal(makeRandomInt(z.getRandomValues)(10), 0);
});

test('makeRandomInt: bound 1 draws nothing, a bad bound throws, a power of two never rejects', () => {
  const c = fakeCrypto([]);
  const ri = makeRandomInt(c.getRandomValues);
  assert.equal(ri(1), 0);
  assert.equal(c.draws.length, 0);
  for (const bad of [0, -3, 1.5, NaN, 4294967297, '5']) assert.throws(() => ri(bad), RangeError, String(bad));
  const p = fakeCrypto([4294967295]);
  assert.equal(makeRandomInt(p.getRandomValues)(256), 255);
  assert.equal(p.draws.length, 1);
  assert.throws(() => makeRandomInt(null));
});

test('makeRandomInt is uniform over a small bound (every result appears, none far from its share)', () => {
  let s = 99;
  const gen = (a) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[0] = s; return a; };
  const ri = makeRandomInt(gen);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 7000; i++) counts[ri(7)]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, 'counts ' + counts.join(','));
});

test('the source never uses the remainder operator (the sampler maps with a division)', () => {
  const src = readFileSync(fileURLToPath(new URL('./security-generate.mjs', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
  assert.ok(!code.includes('%'), 'a % operator is in security-generate.mjs');
  assert.ok(!/Math\.random/.test(code), 'Math.random is not a source of chance');
});

test('cryptoRandomInt uses the runtime crypto and returns in-range integers', () => {
  const ri = cryptoRandomInt();
  for (let i = 0; i < 200; i++) { const x = ri(WORDS.length); assert.ok(Number.isInteger(x) && x >= 0 && x < WORDS.length); }
});

test('generated words do not repeat the same text twice in a row from the real source (sanity, not a proof)', () => {
  const ri = cryptoRandomInt();
  assert.notEqual(generate({ kind: 'words' }, ri).text, generate({ kind: 'words' }, ri).text);
});
