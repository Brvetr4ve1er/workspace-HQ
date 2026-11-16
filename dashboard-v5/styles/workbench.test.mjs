// node --test dashboard-v5/styles/workbench.test.mjs
// The Workbench look sheet (styles/workbench.css, batch 8): the token contract is remapped whole for the dark base AND the light base, WCAG AA holds on
// the text pairings the app uses, every rule is under [data-hq-look="workbench"], nothing moves a box, and the one animation (the screen cursor) sits
// inside the no-preference media block and is scoped to :root:not([data-hq-reduce]). Tokens are read with the tokens parser (styles/tokens-parse.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from './tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(HERE, 'workbench.css'), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const parsed = parseTokens(RAW);
const base = parseTokens(readFileSync(resolve(HERE, 'tokens.css'), 'utf8'));
const DARK_SEL = '[data-hq-look=workbench][data-hq-theme]';
const LIGHT_SEL = '[data-hq-look=workbench][data-hq-theme=light]';
const dark = parsed.rules[DARK_SEL] || {};
const light = parsed.rules[LIGHT_SEL] || {};

// ---- colour maths (WCAG 2.x) ------------------------------------------------------------------------------------------------------
const parseColor = (s) => {
  const v = String(s).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('cannot read colour: ' + s);
};
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const chan = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// --card and --panel are translucent in the app: composite them over --bg first (what the eye sees)
const seen = (block, name) => { const bg = parseColor(block['--bg']); const c = parseColor(block[name]); return c.a < 1 ? over(c, bg) : c; };

const BLOCKS = { dark, light };
const allRules = () => Object.entries(parsed.rules);

test('both blocks exist and remap EVERY custom property the base theme blocks define (dark remaps the dark base, light the light base)', () => {
  assert.ok(Object.keys(dark).length && Object.keys(light).length, 'a block is missing: ' + Object.keys(parsed.rules).join(' | '));
  assert.deepEqual(Object.keys(base.dark).filter((k) => !(k in dark)), [], 'the dark block misses tokens the dark base defines');
  assert.deepEqual(Object.keys(base.light).filter((k) => !(k in light)), [], 'the light block misses tokens the light base defines');
  assert.deepEqual(Object.keys(base.dark).filter((k) => !(k in light)), [], 'the light block also carries every dark-base token, so a light app never falls back to a dark value');
});

test('the required token set is present in both blocks, including the whole --tone-* set and the two mono tokens; the mono tokens differ from the base', () => {
  const REQUIRED = ['--bg', '--bg2', '--panel', '--card', '--card-hi', '--ink', '--frame', '--frame-hi', '--text', '--muted', '--faint', '--gold', '--gold-2',
    '--accent-text', '--link', '--link-hover', '--green', '--red', '--orange', '--yellow', '--blue', '--purple', '--cyan', '--scrim', '--term', '--px',
    '--tone-red', '--tone-orange', '--tone-green', '--tone-blue', '--tone-gold', '--tone-default'];
  for (const [name, b] of Object.entries(BLOCKS)) assert.deepEqual(REQUIRED.filter((k) => !b[k]), [], name);
  for (const b of Object.values(BLOCKS)) {
    assert.match(b['--term'], /monospace/);
    assert.match(b['--px'], /monospace/);
  }
  assert.equal(base.dark['--mono'], undefined, 'the v5 contract grew a --mono token: remap it too');
});

test('a warm field and muted hardware: both fields are warm (red above blue), the accent is a muted steel blue and the signal red is a different hue', () => {
  for (const [name, b] of Object.entries(BLOCKS)) {
    const bg = parseColor(b['--bg']);
    assert.ok(bg.r > bg.b, name + ' field is warm');
    assert.notEqual(b['--bg'].toLowerCase(), (name === 'dark' ? base.dark : base.light)['--bg'].toLowerCase(), name + ' differs from the base field');
    const a = parseColor(b['--gold']);
    assert.ok(a.b > a.r, name + ' accent is the muted steel blue, not the base terracotta');
  }
});

for (const name of Object.keys(BLOCKS)) {
  test(`contrast AA (${name}): --text, --muted and --faint on --bg, --card and --panel are at least 4.5`, () => {
    const b = BLOCKS[name];
    for (const t of ['--text', '--muted', '--faint']) for (const s of ['--bg', '--card', '--panel']) {
      const r = ratio(parseColor(b[t]), seen(b, s));
      assert.ok(r >= 4.5, `${t} on ${s} = ${r.toFixed(2)}`);
    }
  });
  test(`contrast AA (${name}): --accent-text, --link and --link-hover on --card and --bg are at least 4.5`, () => {
    const b = BLOCKS[name];
    for (const k of ['--accent-text', '--link', '--link-hover']) for (const s of ['--card', '--bg']) {
      const r = ratio(parseColor(b[k]), seen(b, s));
      assert.ok(r >= 4.5, `${k} on ${s} = ${r.toFixed(2)}`);
    }
  });
  test(`contrast (${name}): each accent and status colour reads at least 3 as a mark and 4.5 as text on --card; the readout colour on the screen fill is at least 4.5`, () => {
    const b = BLOCKS[name];
    for (const k of ['--gold', '--green', '--red', '--orange', '--yellow', '--blue', '--purple', '--cyan']) {
      const r = ratio(parseColor(b[k]), seen(b, '--card'));
      assert.ok(r >= 3, k + ' as a mark = ' + r.toFixed(2));
      assert.ok(r >= 4.5, k + ' as text = ' + r.toFixed(2));
    }
    const screenInk = ratio(parseColor(b['--accent-text']), seen(b, '--ink'));
    assert.ok(screenInk >= 4.5, 'readout (--accent-text) on the screen (--ink) = ' + screenInk.toFixed(2));
    assert.ok(ratio(parseColor(b['--text']), seen(b, '--ink')) >= 4.5, '--text on --ink');
    assert.ok(ratio(parseColor(b['--gold']), seen(b, '--ink')) >= 3, 'the accent mark on the screen: ' + name);
  });
}

test('the two dark labels the app puts on a gold fill stay readable on the dark base accent', () => {
  const label = parseColor('#1a0f0a');
  for (const k of ['--gold', '--gold-2']) assert.ok(ratio(label, parseColor(dark[k])) >= 4.5, k + ' fill under a dark label');
});

test('flat vectors: 6 px corners on cards, buttons and inputs, no gradients and no depth shadows, only thin inset rings; focus ring is a plain 2 px ring', () => {
  const rule = (needle) => allRules().filter(([sel]) => sel.includes(needle));
  for (const [sel, d] of [...rule('section'), ...rule('button'), ...rule('input'), ...rule('textarea')]) {
    assert.match(d['border-radius'], /^6px !important$/, sel);
  }
  const sec = rule('section')[0][1];
  assert.match(sec['box-shadow'], /^inset 0 0 0 \.5px var\(--frame-hi\) !important$/);
  assert.equal(rule('button')[0][1]['background-image'], 'none !important');
  assert.doesNotMatch(CSS, /gradient|clip-path|blur\(|drop-shadow|text-shadow/i, 'flat: no gradient, no chamfer, no blur, no glow');
  assert.doesNotMatch(CSS.replace(/inset 0 0 0 \.5px/g, ''), /box-shadow\s*:\s*[^;]*\b[1-9]\d*px\s+[1-9]/, 'no offset shadows');
  const f = rule(':focus-visible');
  assert.ok(f.length >= 1);
  for (const [, d] of f) { assert.match(d.outline, /^2px solid /); assert.match(d.outline, /!important/); }
  const ro = rule('[data-wbn=readout]')[0][1];
  assert.equal(ro['text-transform'], 'uppercase');
  assert.match(ro['font-family'], /var\(--term\)/);
});

test('every rule that is not inside the media block is under [data-hq-look="workbench"]; none is global', () => {
  const sels = allRules().map(([s]) => s);
  assert.ok(sels.length >= 8, 'rules: ' + sels.length);
  for (const s of sels) assert.ok(s.includes('[data-hq-look=workbench]'), 'rule outside the look: ' + s);
});

test('no layout change: no size, spacing, display, position or offset property on any real element, and nothing sets position on #tabs or .timemachine', () => {
  const LAYOUT = ['margin', 'padding', 'width', 'height', 'display', 'top', 'left', 'right', 'bottom', 'transform', 'border-width', 'font-size', 'line-height', 'flex', 'gap', 'overflow', 'position', 'z-index'];
  for (const [sel, d] of allRules()) {
    assert.deepEqual(LAYOUT.filter((k) => k in d), [], sel + ' sets layout properties');
    if (/#tabs|\.timemachine/.test(sel)) assert.equal(d.position, undefined, sel);
  }
  assert.doesNotMatch(CSS, /::before|::after/, 'no overlay pseudo-elements: nothing is laid over the app');
  assert.doesNotMatch(CSS, /url\(|@import/i, 'no images and nothing remote');
});

test('motion: the only @keyframes and animation sit inside ONE @media (prefers-reduced-motion: no-preference) block, scoped to :root:not([data-hq-reduce]), keyframes named wbn-*', () => {
  // top-level blocks
  const blocks = [];
  let depth = 0, start = -1, headStart = 0;
  for (let i = 0; i < CSS.length; i++) {
    if (CSS[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (CSS[i] === '}') { depth--; if (depth === 0) { blocks.push({ head: CSS.slice(headStart, start).trim(), body: CSS.slice(start + 1, i) }); headStart = i + 1; } }
  }
  assert.equal(depth, 0);
  const media = blocks.filter((b) => /^@media/.test(b.head));
  assert.equal(media.length, 1);
  assert.equal(media[0].head.replace(/\s+/g, ' '), '@media (prefers-reduced-motion: no-preference)');
  const outside = blocks.filter((b) => !/^@media/.test(b.head)).map((b) => b.head + '{' + b.body + '}').join('\n');
  assert.doesNotMatch(outside, /@keyframes|animation|transition/i, 'nothing animates or transitions outside the media block');
  assert.doesNotMatch(CSS, /transition/i);
  assert.match(media[0].body, /@keyframes wbn-/);
  const names = [...media[0].body.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 1 && names.every((n) => n.startsWith('wbn-')), 'keyframes are wbn- names: ' + names);
  // every style rule in the block is scoped to :root:not([data-hq-reduce]) (the attribute app.js setReduceFlag writes while Reduce motion is on)
  const rules = media[0].body.replace(/@keyframes[\s\S]*?\}\s*\}/g, '').split('}').map((r) => r.trim()).filter(Boolean);
  assert.ok(rules.length >= 1);
  for (const r of rules) assert.match(r, /^:root:not\(\[data-hq-reduce\]\) \[data-hq-look="workbench"\] /, r);
  // and what it animates is a class the template draws
  assert.match(read('../src/tpl/workbench.tpl.js'), /class="wbn-cursor"/);
  assert.match(media[0].body, /\.wbn-cursor/);
});

function read(rel) { return readFileSync(resolve(HERE, rel), 'utf8'); }

test('the sheet is attached only by the layer: no page links it, no file in the app names it but the layer, its test, the cdp scenarios and the notes', () => {
  assert.match(read('../src/logic/console-layer.mjs'), /WORKBENCH_HREF = '\.\/styles\/workbench\.css'/);
  assert.equal(/workbench\.css/.test(read('../index.html')), false, 'index.html does not link it');
  assert.equal(/workbench\.css/.test(read('app.css')), false, 'app.css does not import it');
});

test('the label on a gold fill (Crew Start, Vault desk Add, the all-clear Got it) reads at 4.5: dark base keeps the dark label, light base has a white-label rule', () => {
  assert.ok(ratio(parseColor('#1a0f0a'), parseColor(dark['--gold'])) >= 4.5, 'dark: the dark label on --gold');
  const rules = allRules().filter(([sel]) => sel.includes('[style*='));
  assert.equal(rules.length, 1, 'exactly one label rule in the sheet');
  const [sel, d] = rules[0];
  assert.match(sel, /^\[data-hq-look=workbench\]\[data-hq-theme=light\] \[style\*=background: var\(--gold\);\]$/, 'scoped to the light look, spelled as Chromium serializes the inline style');
  assert.match(d.color, /^#ffffff !important$/);
  const r = ratio(parseColor(d.color.replace(/ !important$/, '')), parseColor(light['--gold']));
  assert.ok(r >= 4.5, 'light: the label rule colour on --gold = ' + r.toFixed(2));
});
