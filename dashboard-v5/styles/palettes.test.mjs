// node --test dashboard-v5/styles/palettes.test.mjs
// The two hidden accent palettes (ember, tide): only the accent family is remapped, every rule is under data-hq-accent, nothing animates,
// and each accent TEXT token reaches WCAG AA (4.5) on --card (and on --bg) for the dark base, the light base and the Console skin; the
// non-text accent fills reach 3. --card is translucent in tokens.css, so it is composited over --bg first (what the eye sees).
// The Console base is read from styles/console.css when that file exists (the console-skin dish owns it); until then the documented
// charcoal values stand in (--bg #1f2023, --card #2c2e33), so this test holds either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from './tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, p), 'utf8');
const CSS = read('palettes.css');
const pal = parseTokens(CSS);
const tokens = parseTokens(read('tokens.css'));

const FAMILY = ['--gold', '--gold-2', '--accent-text', '--link', '--link-hover', '--tone-gold'];
const TEXT = ['--accent-text', '--link', '--link-hover'];
const FILLS = ['--gold', '--gold-2'];
const PALETTES = ['ember', 'tide'];
const BASES = {
  dark: (p) => `[data-hq-theme][data-hq-accent=${p}]`,
  light: (p) => `[data-hq-theme=light][data-hq-accent=${p}]`,
  console: (p) => `[data-hq-skin=console][data-hq-accent=${p}]`,
};

// ---- colour maths ----------------------------------------------------------------------------------------------------
function parseColor(v) {
  const s = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  return null;
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function base(name) {
  let bg, card;
  if (name === 'dark') { bg = tokens.dark['--bg']; card = tokens.dark['--card']; }
  else if (name === 'light') { bg = tokens.light['--bg']; card = tokens.light['--card']; }
  else {
    bg = '#1f2023'; card = '#2c2e33';   // the documented Console charcoal
    if (existsSync(resolve(HERE, 'console.css'))) {
      const c = parseTokens(read('console.css')).rules['[data-hq-skin=console]'] || {};
      if (parseColor(c['--bg'])) bg = c['--bg'];
      if (parseColor(c['--card'])) card = c['--card'];
    }
  }
  const b = parseColor(bg);
  assert.ok(b && parseColor(card), name + ': base colours parse (' + bg + ', ' + card + ')');
  return { bg: b, card: over(parseColor(card), b) };
}

function accent(name, p) {
  const decls = pal.rules[BASES[name](p)];
  assert.ok(decls, 'a rule for ' + BASES[name](p));
  const get = (k) => {
    let v = decls[k];
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(String(v || '').trim());
    if (ref) v = decls[ref[1]];
    return parseColor(v);
  };
  return get;
}

// ---- the rules -------------------------------------------------------------------------------------------------------
test('every palette has exactly one rule per base (dark, light, Console), under the data-hq-accent attribute', () => {
  const sels = Object.keys(pal.rules).sort();
  assert.deepEqual(sels, PALETTES.flatMap((p) => Object.keys(BASES).map((b) => BASES[b](p))).sort());
  for (const s of sels) assert.match(s, /\[data-hq-accent=(ember|tide)\]$/, s + ' is scoped to a palette');
});

test('only the accent family is remapped: six custom properties per rule, nothing else', () => {
  for (const [sel, decls] of Object.entries(pal.rules)) {
    assert.deepEqual(Object.keys(decls).sort(), FAMILY.slice().sort(), sel);
  }
  const tone = pal.rules[BASES.dark('ember')]['--tone-gold'];
  assert.equal(tone, 'var(--gold)', '--tone-gold follows --gold like it does in tokens.css');
  assert.equal(tokens.dark['--tone-gold'], 'var(--gold)');
});

test('the two palettes differ from each other and from the base accent in every base', () => {
  for (const b of Object.keys(BASES)) {
    const e = pal.rules[BASES[b]('ember')], t = pal.rules[BASES[b]('tide')];
    assert.notEqual(e['--accent-text'], t['--accent-text'], b);
    assert.notEqual(e['--accent-text'], (b === 'light' ? tokens.light : tokens.dark)['--accent-text'], b + ': ember changes something');
    assert.notEqual(t['--accent-text'], (b === 'light' ? tokens.light : tokens.dark)['--accent-text'], b + ': tide changes something');
  }
});

test('nothing animates and nothing moves: no @keyframes, transition, animation, position or !important in the file', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /@keyframes|@media|@import/);
  assert.doesNotMatch(body, /\btransition\b|\banimation\b|\bposition\s*:|!important/);
  assert.ok(body.trim().length > 200);
});

// ---- contrast --------------------------------------------------------------------------------------------------------
for (const b of Object.keys(BASES)) {
  for (const p of PALETTES) {
    test(`AA contrast: ${p} on the ${b} base — text tokens >= 4.5 on --card and --bg, fills >= 3 on --card`, () => {
      const { bg, card } = base(b);
      const get = accent(b, p);
      for (const k of TEXT) {
        const c = get(k);
        assert.ok(c, k + ' parses');
        assert.ok(ratio(c, card) >= 4.5, `${p}/${b} ${k} on --card is ${ratio(c, card).toFixed(2)}`);
        assert.ok(ratio(c, bg) >= 4.5, `${p}/${b} ${k} on --bg is ${ratio(c, bg).toFixed(2)}`);
      }
      for (const k of FILLS) {
        const c = get(k);
        assert.ok(c, k + ' parses');
        assert.ok(ratio(c, card) >= 3, `${p}/${b} ${k} on --card is ${ratio(c, card).toFixed(2)}`);
      }
      assert.ok(get('--tone-gold'), '--tone-gold resolves through --gold');
    });
  }
}

test('the colour maths agrees with a known pair (white on black is 21, a colour on itself is 1)', () => {
  assert.equal(Math.round(ratio(parseColor('#fff'), parseColor('#000'))), 21);
  assert.equal(ratio(parseColor('#8f4a00'), parseColor('#8f4a00')), 1);
});
