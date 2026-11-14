// node --test dashboard-v5/styles/console.test.mjs
// The Console skin sheet (styles/console.css): the token contract is remapped whole, WCAG AA holds on every pairing the app uses, nothing
// animates or moves, every rule is under the skin selector, and the files carry no company or product names. Tokens are read with the
// tokens parser (styles/tokens-parse.mjs, unchanged); the existing tokens tests are not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens, normalizeSelector } from './tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // dashboard-v5/styles, never cwd
const V5 = resolve(HERE, '..');
const read = (p) => readFileSync(resolve(HERE, p), 'utf8');
const CSS = read('console.css');
const parsed = parseTokens(CSS);
const base = parseTokens(read('tokens.css'));
const SKIN = normalizeSelector('[data-hq-skin="console"]');
const block = parsed.rules[SKIN] || {};

// ---- colour maths (WCAG 2.x) ------------------------------------------------------------------------------------------------------
const parseColor = (s) => {
  const v = String(s).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('cannot read colour: ' + s);
};
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const chan = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tok = (name) => parseColor(block[name]);
const R = (fg, bg) => ratio(typeof fg === 'string' ? tok(fg) : fg, typeof bg === 'string' ? tok(bg) : bg);
const BLACK = (a) => ({ r: 0, g: 0, b: 0, a });
const WHITE = (a) => ({ r: 255, g: 255, b: 255, a });

// the dark label the app puts on a gold-filled control (vals/shell.js sw(): color '#3a2a00')
const GOLD_LABEL = parseColor('#3a2a00');

// every rule in the file with its selector list split (the parser keys by selector, so a list is several keys)
const allRules = () => Object.entries(parsed.rules);
const ruleOf = (needle) => allRules().filter(([sel]) => sel.includes(needle));

test('the skin block exists and remaps EVERY custom property the dark token block defines', () => {
  assert.ok(Object.keys(block).length, 'no [data-hq-skin="console"] block');
  const missing = Object.keys(base.dark).filter((k) => !(k in block));
  assert.deepEqual(missing, [], 'tokens.css defines these but the skin does not remap them');
});

test('the required token set is present, including the whole --tone-* set and the two mono tokens', () => {
  const REQUIRED = ['--bg', '--bg2', '--panel', '--card', '--card-hi', '--ink', '--frame', '--frame-hi', '--text', '--muted', '--faint', '--gold', '--gold-2',
    '--accent-text', '--link', '--link-hover', '--green', '--red', '--orange', '--yellow', '--blue', '--purple', '--cyan', '--scrim', '--term', '--px',
    '--tone-red', '--tone-orange', '--tone-green', '--tone-blue', '--tone-gold', '--tone-default'];
  assert.deepEqual(REQUIRED.filter((k) => !block[k]), []);
});

test('the mono font tokens are remapped (--term and --px: v5 has no --mono token, so there is nothing else to remap)', () => {
  assert.equal(base.dark['--mono'], undefined, 'the v5 contract grew a --mono token: remap it too');
  assert.equal(block['--mono'], undefined);
  assert.notEqual(block['--term'], base.dark['--term']);
  assert.notEqual(block['--px'], base.dark['--px']);
  assert.match(block['--term'], /monospace/);
  assert.match(block['--px'], /monospace/);
});

test('the charcoal plastic and the four accents are the chosen ones (original set, not a logo arrangement)', () => {
  assert.equal(block['--bg'].toLowerCase(), '#1f2023');
  assert.equal(block['--card'].toLowerCase(), '#2c2e33');
  assert.equal(block['--gold'].toLowerCase(), '#8fb8ff');          // primary: sky (gold / accent-text / link)
  assert.equal(block['--accent-text'], block['--gold']);
  assert.equal(block['--link'], block['--gold']);
  assert.equal(block['--purple'].toLowerCase(), '#c9a2ff');        // secondary
  assert.equal(block['--orange'].toLowerCase(), '#ffbf5e');        // warn (orange and yellow family)
  assert.equal(block['--green'].toLowerCase(), '#7fdc9c');         // ok
  assert.notEqual(block['--red'].toLowerCase(), '#ff0000');
  assert.ok(tok('--red').r > 200 && tok('--red').g < 160, '--red stays an error red');
  const accents = ['--gold', '--purple', '--orange', '--green'].map((k) => block[k].toLowerCase());
  assert.equal(new Set(accents).size, 4);
});

test('contrast AA: --text on --bg, --card and --panel is at least 4.5', () => {
  for (const bg of ['--bg', '--card', '--panel']) assert.ok(R('--text', bg) >= 4.5, '--text on ' + bg + ' = ' + R('--text', bg).toFixed(2));
});

test('contrast AA: --muted on --card (and on --bg, --panel) is at least 4.5', () => {
  for (const bg of ['--card', '--bg', '--panel']) assert.ok(R('--muted', bg) >= 4.5, '--muted on ' + bg + ' = ' + R('--muted', bg).toFixed(2));
});

test('contrast AA: --faint (small captions) stays readable on --bg and --card', () => {
  for (const bg of ['--bg', '--card']) assert.ok(R('--faint', bg) >= 4.5, '--faint on ' + bg + ' = ' + R('--faint', bg).toFixed(2));
});

test('contrast AA: --accent-text and --link on --card are at least 4.5, --link-hover too', () => {
  for (const k of ['--accent-text', '--link', '--link-hover']) assert.ok(R(k, '--card') >= 4.5, k + ' = ' + R(k, '--card').toFixed(2));
});

test('contrast: each of the four accents on --card is at least 3 as a mark and at least 4.5 as text; the error red too', () => {
  for (const k of ['--gold', '--purple', '--orange', '--green', '--red', '--yellow', '--blue', '--cyan']) {
    const r = R(k, '--card');
    assert.ok(r >= 3, k + ' as a mark on --card = ' + r.toFixed(2));
    assert.ok(r >= 4.5, k + ' as text on --card = ' + r.toFixed(2));
  }
});

test('the scanline overlay is at most 6% black, and the worst-case composite still leaves --text on --bg at 4.5 or better', () => {
  const rule = ruleOf('::after').find(([, d]) => (d['background-image'] || '').includes('repeating-linear-gradient'));
  assert.ok(rule, 'no scanline overlay rule');
  const alphas = [...rule[1]['background-image'].matchAll(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g)].map((m) => +m[1]);
  assert.ok(alphas.length >= 1);
  const worst = Math.max(...alphas);
  assert.ok(worst > 0 && worst <= 0.06, 'scanline alpha ' + worst);
  const bgSeen = over(BLACK(worst), tok('--bg')), textSeen = over(BLACK(worst), tok('--text'));
  assert.ok(ratio(textSeen, bgSeen) >= 4.5, 'text under the scanlines = ' + ratio(textSeen, bgSeen).toFixed(2));
  const cardSeen = over(BLACK(worst), tok('--card')), mutedSeen = over(BLACK(worst), tok('--muted'));
  assert.ok(ratio(mutedSeen, cardSeen) >= 4.5, 'muted under the scanlines = ' + ratio(mutedSeen, cardSeen).toFixed(2));
});

test('gold-filled buttons keep a dark label of at least 4.5 even under the sheen (the darkest end of the gradient)', () => {
  const rule = ruleOf('button').find(([, d]) => (d['background-image'] || '').includes('linear-gradient'));
  assert.ok(rule, 'no button sheen rule');
  const blacks = [...rule[1]['background-image'].matchAll(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g)].map((m) => +m[1]);
  const whites = [...rule[1]['background-image'].matchAll(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/g)].map((m) => +m[1]);
  const darkest = Math.max(0, ...blacks), lightest = Math.max(0, ...whites);
  for (const fill of ['--gold', '--gold-2']) {
    assert.ok(ratio(GOLD_LABEL, tok(fill)) >= 4.5, 'label on ' + fill + ' = ' + ratio(GOLD_LABEL, tok(fill)).toFixed(2));
    const shaded = over(BLACK(darkest), tok(fill));
    assert.ok(ratio(GOLD_LABEL, shaded) >= 4.5, 'label on ' + fill + ' under the sheen = ' + ratio(GOLD_LABEL, shaded).toFixed(2));
  }
  // and light text on a card-coloured button under the lightest end of the sheen
  const lit = over(WHITE(lightest), tok('--card'));
  assert.ok(ratio(tok('--muted'), lit) >= 4.5, '--muted on a lit button = ' + ratio(tok('--muted'), lit).toFixed(2));
  assert.ok(ratio(tok('--text'), lit) >= 4.5);
});

test('nothing animates: no @keyframes, no timed property changes, no animation properties in the file', () => {
  assert.doesNotMatch(CSS, /@keyframes/i);
  assert.doesNotMatch(CSS, /transition/i);
  assert.doesNotMatch(CSS, /animation/i);
  assert.doesNotMatch(CSS, /@media/i, 'no conditional blocks: the sheet is one static look');
});

test('no rule sets position on #tabs or .timemachine, and position appears only on the two fixed pseudo-element overlays', () => {
  for (const [sel, d] of allRules()) {
    if (/#tabs|\.timemachine/.test(sel)) assert.equal(d.position, undefined, sel + ' sets position');
    if (d.position !== undefined) {
      assert.ok(/::(before|after)$/.test(sel), sel + ' sets position but is not a pseudo-element overlay');
      assert.equal(d.position, 'fixed');
      assert.equal(d['pointer-events'], 'none', sel + ' overlay must not take clicks');
    }
  }
});

test('no layout properties on real elements (no layout shift): size, spacing, display and offsets appear only in the overlays', () => {
  const LAYOUT = ['margin', 'padding', 'width', 'height', 'display', 'top', 'left', 'right', 'bottom', 'transform', 'border-width', 'font-size', 'line-height', 'flex', 'gap', 'overflow'];
  for (const [sel, d] of allRules()) {
    if (/::(before|after)$/.test(sel)) continue;
    const hit = LAYOUT.filter((k) => k in d);
    assert.deepEqual(hit, [], sel + ' sets layout properties');
  }
});

test('every rule is under [data-hq-skin="console"]', () => {
  const sels = allRules().map(([s]) => s);
  assert.ok(sels.length >= 7);
  for (const s of sels) assert.ok(s.includes('[data-hq-skin=console]'), 'rule outside the skin: ' + s);
});

test('focus rings stay visible: a 2px outline with a NEGATIVE offset so the chamfer cannot clip it', () => {
  const r = ruleOf(':focus-visible');
  assert.ok(r.length >= 1, 'no :focus-visible rule under the skin');
  for (const [, d] of r) {
    assert.match(d.outline, /^2px solid /);
    assert.match(d['outline-offset'], /^-\d+px/);
    assert.match(d.outline, /!important/);
  }
  const cs = ruleOf('button').concat(ruleOf('section'));
  for (const [, d] of cs) assert.match(d['clip-path'] || '', /^polygon\(/, 'cards and buttons are chamfered with clip-path polygon()');
});

test('the bevels are shadows and gradients, never images; the fog fades from --bg to transparent over 24px; both overlays are static', () => {
  assert.doesNotMatch(CSS, /url\(/i, 'no images and no remote anything');
  const sec = ruleOf('section')[0][1];
  assert.match(sec['box-shadow'], /inset 0 1px 0 rgba\(255,255,255/);
  assert.match(sec['box-shadow'], /inset 0 -2px 0 rgba\(0,0,0/);
  const fog = ruleOf('::before')[0][1];
  assert.equal(fog['pointer-events'], 'none');
  assert.match(fog.background, /var\(--bg\) 0, transparent 24px/);
  const scan = ruleOf('::after')[0];
  assert.match(scan[0], /^html\[data-hq-scan=on\] /, 'scanlines appear only when the layer sets the attribute');
});

test('no company or product names in the sheet or in any file of this dish (one inline deny-list)', () => {
  const DENY = ['nintendo', 'famicom', 'playstation', 'dreamcast', 'xbox', 'atari', 'gameboy', 'game boy', 'neo geo', 'tamagotchi', 'pokemon', 'mario', 'zelda', 'sega', 'sony', 'microsoft'];
  const FILES = ['styles/console.css', 'src/logic/console-layer.mjs', 'src/logic/console-layer.test.mjs', 'src/logic/console-skin.js', 'src/vals/console-skin.js', 'src/selftest-console.mjs', 'tools/cdp-console.mjs', 'tools/cdp-console.test.mjs'];
  for (const f of FILES) {
    const p = resolve(V5, f);
    assert.ok(existsSync(p), 'missing ' + f);
    const text = readFileSync(p, 'utf8').toLowerCase();
    for (const w of DENY) assert.ok(!new RegExp('\\b' + w + '\\b').test(text), f + ' mentions a company or product: ' + w);
  }
});
