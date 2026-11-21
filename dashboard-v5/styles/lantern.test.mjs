// node --test dashboard-v5/styles/lantern.test.mjs
// The Lantern look sheet (styles/lantern.css, batch 11): the token contract is remapped whole for the dark base AND the light base, WCAG AA holds on the text
// pairings the app uses and on the card colours, every rule is under [data-hq-look="lantern"], nothing moves a box, and the one animation (a card turning
// face up) sits inside the no-preference media block and is scoped to :root:not([data-hq-reduce]). Tokens are read with the tokens parser (styles/tokens-parse.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from './tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(HERE, 'lantern.css'), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const parsed = parseTokens(RAW);
const base = parseTokens(readFileSync(resolve(HERE, 'tokens.css'), 'utf8'));
const DARK_SEL = '[data-hq-look=lantern][data-hq-theme]';
const LIGHT_SEL = '[data-hq-look=lantern][data-hq-theme=light]';
const dark = parsed.rules[DARK_SEL] || {};
const light = parsed.rules[LIGHT_SEL] || {};
function read(rel) { return readFileSync(resolve(HERE, rel), 'utf8'); }

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

test('the required token set is present in both blocks: the whole --tone-* set, the two mono tokens (different from the base) and the look\'s own --lnt-* tokens', () => {
  const REQUIRED = ['--bg', '--bg2', '--panel', '--card', '--card-hi', '--ink', '--frame', '--frame-hi', '--text', '--muted', '--faint', '--gold', '--gold-2',
    '--accent-text', '--link', '--link-hover', '--green', '--red', '--orange', '--yellow', '--blue', '--purple', '--cyan', '--scrim', '--term', '--px',
    '--tone-red', '--tone-orange', '--tone-green', '--tone-blue', '--tone-gold', '--tone-default',
    '--lnt-blood', '--lnt-card', '--lnt-glyph', '--lnt-back', '--lnt-brass', '--lnt-brass-dim', '--lnt-serif'];
  for (const [name, b] of Object.entries(BLOCKS)) assert.deepEqual(REQUIRED.filter((k) => !b[k]), [], name);
  for (const b of Object.values(BLOCKS)) {
    assert.match(b['--term'], /monospace/);
    assert.match(b['--px'], /monospace/);
    assert.match(b['--term'], /IBM Plex Mono/, 'the bundled mono');
    assert.match(b['--lnt-serif'], /^'Cinzel',Georgia,'Times New Roman',serif$/, 'the engraved serif stack: the bundled Cinzel, Georgia while it loads and after it');
  }
  assert.equal(base.dark['--mono'], undefined, 'the v5 contract grew a --mono token: remap it too');
  // the cards are bone with ink on every base, the back is ink on every base
  for (const k of ['--lnt-card', '--lnt-glyph', '--lnt-back', '--lnt-brass', '--lnt-brass-dim']) assert.equal(dark[k].toLowerCase(), light[k].toLowerCase(), k + ' is the same on both bases');
});

test('ink and bone: the dark field is near-black and warm-neutral, the light field is parchment; the accent is brass on both (red above blue)', () => {
  const d = parseColor(dark['--bg']);
  assert.ok(d.r < 24 && d.g < 24 && d.b < 24, 'dark field near-black');
  const l = parseColor(light['--bg']);
  assert.ok(l.r > 220 && l.r > l.b, 'light field is parchment (warm, light)');
  for (const [name, b] of Object.entries(BLOCKS)) {
    assert.notEqual(b['--bg'].toLowerCase(), (name === 'dark' ? base.dark : base.light)['--bg'].toLowerCase(), name + ' differs from the base field');
    const a = parseColor(b['--gold']);
    assert.ok(a.r > a.b && a.g > a.b, name + ' accent is brass (red and green above blue)');
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
  test(`contrast (${name}): each accent and status colour reads at least 3 as a mark and 4.5 as text on --card; the accent text on the screen fill is at least 4.5`, () => {
    const b = BLOCKS[name];
    for (const k of ['--gold', '--green', '--red', '--orange', '--yellow', '--blue', '--purple', '--cyan']) {
      const r = ratio(parseColor(b[k]), seen(b, '--card'));
      assert.ok(r >= 3, k + ' as a mark = ' + r.toFixed(2));
      assert.ok(r >= 4.5, k + ' as text = ' + r.toFixed(2));
    }
    assert.ok(ratio(parseColor(b['--accent-text']), seen(b, '--ink')) >= 4.5, 'accent text on --ink');
    assert.ok(ratio(parseColor(b['--text']), seen(b, '--ink')) >= 4.5, '--text on --ink');
    assert.ok(ratio(parseColor(b['--gold']), seen(b, '--ink')) >= 3, 'the accent mark on --ink');
  });
  test(`contrast (${name}): the card text (ink on bone) and the sealed word (dim brass on the ink back) are at least 4.5; the card marks read at least 3`, () => {
    const b = BLOCKS[name];
    const bone = parseColor(b['--lnt-card']), ink = parseColor(b['--lnt-glyph']), back = parseColor(b['--lnt-back']);
    assert.ok(ratio(ink, bone) >= 4.5, 'ink on bone = ' + ratio(ink, bone).toFixed(2));
    assert.ok(ratio(parseColor(b['--lnt-brass-dim']), back) >= 4.5, 'dim brass on the back = ' + ratio(parseColor(b['--lnt-brass-dim']), back).toFixed(2));
    assert.ok(ratio(parseColor(b['--lnt-brass']), back) >= 3, 'brass on the back');
    assert.ok(ratio(parseColor(b['--lnt-brass']), ink) >= 3, 'the lantern flame (brass) on the ink glyph body');
    assert.ok(ratio(parseColor(b['--lnt-blood']), bone) >= 3, 'blood red on bone (the Hierophant drop, the Tower fire, the Temperance stream)');
  });
}

test('blood red is for fills and rules only: it is the only use of --lnt-blood in the sheet and no rule sets a text colour to it', () => {
  assert.doesNotMatch(CSS, /(^|[;{\s])color\s*:\s*var\(--lnt-blood\)/, 'never a text colour');
  const uses = [...CSS.matchAll(/var\(--lnt-blood\)/g)].length;
  assert.ok(uses >= 1, 'the urgent-row rule uses it');
  for (const [sel, d] of allRules()) for (const [k, v] of Object.entries(d)) if (/var\(--lnt-blood\)/.test(v)) assert.match(k, /^box-shadow$/, sel + ' uses blood red in ' + k);
});

test('the two dark labels the app puts on a gold fill stay readable on the dark base accent; the light base takes the one general white-label rule in app.css, so this sheet carries none', () => {
  const label = parseColor('#1a0f0a');
  for (const k of ['--gold', '--gold-2']) assert.ok(ratio(label, parseColor(dark[k])) >= 4.5, k + ' fill under a dark label');
  assert.equal(allRules().filter(([sel]) => sel.includes('[style*=') && /background/.test(sel)).length, 0, 'no gold-fill label rule in this sheet (app.css holds the general one)');
  assert.ok(ratio({ r: 255, g: 255, b: 255, a: 1 }, parseColor(light['--gold'])) >= 4.5, 'light: white on --gold');
  assert.ok(read('app.css').includes('[data-hq-theme="light"]:not([data-hq-skin="console"]) [style*="background: var(--gold);"]{color:#ffffff !important}'));
});

test('flat and engraved: 4 px corners on cards, buttons and inputs, no gradient, no blur, no glow, no offset shadow (only inset rules); the focus ring is a plain 2 px ring', () => {
  const rule = (needle) => allRules().filter(([sel]) => sel.includes(needle));
  for (const [sel, d] of [...rule('section'), ...rule('button'), ...rule('input'), ...rule('textarea')]) assert.match(d['border-radius'], /^4px !important$/, sel);
  assert.match(rule('section')[0][1]['box-shadow'], /^inset 0 0 0 \.5px var\(--frame-hi\) !important$/);
  assert.equal(rule('button')[0][1]['background-image'], 'none !important');
  assert.doesNotMatch(CSS, /gradient|clip-path|blur\(|drop-shadow|text-shadow/i);
  for (const [sel, d] of allRules()) if ('box-shadow' in d) assert.match(d['box-shadow'], /^inset /, sel + ': only inset rules, no outer shadow');
  const f = rule(':focus-visible');
  assert.ok(f.length >= 1);
  for (const [, d] of f) { assert.match(d.outline, /^2px solid /); assert.match(d.outline, /!important/); }
});

test('type: headings take the serif stack in upper case with tracking; the mono readout and the roman number are set for the cards; nothing is downloaded', () => {
  const h = allRules().filter(([sel]) => /\bh1\b|\bh2\b|\bh3\b/.test(sel));
  assert.ok(h.length >= 3, 'h1, h2 and h3 are all covered');
  for (const [sel, d] of h) {
    assert.match(d['font-family'], /^var\(--lnt-serif\)/, sel);
    assert.equal(d['text-transform'], 'uppercase', sel);
    assert.match(d['letter-spacing'], /^\.\d+em/, sel);
  }
  const ro = allRules().find(([sel]) => sel.includes('[data-lnt=readout]') && !sel.includes('face'))[1];
  assert.equal(ro['text-transform'], 'uppercase');
  assert.match(ro['font-family'], /var\(--term\)/);
  assert.match(allRules().find(([sel]) => sel.includes('[data-lnt=roman]'))[1]['font-family'], /var\(--lnt-serif\)/);
  assert.doesNotMatch(CSS, /@import/i, 'nothing imported');
  // the ONLY url() in the sheet are the two bundled Cinzel files: no image, nothing remote
  const urls = [...CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]);
  assert.deepEqual(urls.sort(), ['../fonts/Cinzel-Bold-latin-ext.woff2', '../fonts/Cinzel-Bold-latin.woff2']);
});

test('every rule that is not inside the media block is under [data-hq-look="lantern"]; none is global', () => {
  const sels = allRules().map(([s]) => s);
  assert.ok(sels.length >= 10, 'rules: ' + sels.length);
  for (const s of sels) assert.ok(s.includes('[data-hq-look=lantern]'), 'rule outside the look: ' + s);
});

test('no layout change: no size, spacing, display, position or offset property on any real element, and nothing sets position on #tabs or .timemachine', () => {
  const LAYOUT = ['margin', 'padding', 'width', 'height', 'display', 'top', 'left', 'right', 'bottom', 'transform', 'border-width', 'font-size', 'line-height', 'flex', 'gap', 'overflow', 'position', 'z-index', 'float'];
  for (const [sel, d] of allRules()) {
    assert.deepEqual(LAYOUT.filter((k) => k in d), [], sel + ' sets layout properties');
    if (/#tabs|\.timemachine/.test(sel)) assert.equal(d.position, undefined, sel);
  }
  assert.doesNotMatch(CSS, /::before|::after/, 'no overlay pseudo-elements: nothing is laid over the app');
});

test('motion: the only @keyframes and animation sit inside ONE @media (prefers-reduced-motion: no-preference) block, scoped to :root:not([data-hq-reduce]), keyframes named lnt-*', () => {
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
  assert.doesNotMatch(outside, /@keyframes|animation|transition|(^|[^-])transforms*:/i, 'nothing animates, transitions or transforms outside the media block');
  assert.doesNotMatch(CSS, /transition/i);
  assert.match(media[0].body, /@keyframes lnt-/);
  const names = [...media[0].body.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 1 && names.every((n) => n.startsWith('lnt-')), 'keyframes are lnt- names: ' + names);
  const rules = media[0].body.replace(/@keyframes[\s\S]*?\}\s*\}/g, '').split('}').map((r) => r.trim()).filter(Boolean);
  assert.ok(rules.length >= 1);
  for (const r of rules) assert.match(r, /^:root:not\(\[data-hq-reduce\]\) \[data-hq-look="lantern"\] /, r);
  // what it animates is an attribute the template draws, and only a card that is face up
  assert.match(read('../src/tpl/lantern.tpl.js'), /data-lnt-face="\{\{ lntv\.\$\{kind\}\.face \}\}"/);
  assert.match(media[0].body, /\[data-lnt-face="up"\]/);
});

test('the sheet is attached only by the layer: no page links it, no file in the app names it but the layer, its test, the cdp scenarios and the notes', () => {
  assert.match(read('../src/logic/console-layer.mjs'), /LANTERN_HREF = '\.\/styles\/lantern\.css'/);
  assert.equal(/lantern\.css/.test(read('../index.html')), false, 'index.html does not link it');
  assert.equal(/lantern\.css/.test(read('app.css')), false, 'app.css does not import it');
});

test('Cinzel is the app\'s own copy: two 700 faces from fonts/, both files on disk, real woff2, and the open font licence beside them', () => {
  const faces = parsed.fontFaces.filter((f) => /cinzel/i.test(f.family));
  assert.equal(faces.length, 2, 'two Cinzel faces (latin and latin-ext)');
  assert.equal(parsed.fontFaces.length, 2, 'no other font face in this sheet');
  for (const f of faces) {
    assert.equal(String(f.weight), '700');
    assert.equal(f.display, 'swap', 'Georgia shows while the file loads');
    assert.ok(f.urls.length === 1, 'one file per face');
    for (const u of f.urls) {
      assert.match(u, /^\.\.\/fonts\/Cinzel-Bold-latin(-ext)?\.woff2$/);
      assert.equal(readFileSync(resolve(HERE, u)).subarray(0, 4).toString('latin1'), 'wOF2', u + ' is a woff2 file');
    }
  }
  const lic = read('../fonts/OFL-Cinzel.txt');
  assert.match(lic, /Cinzel Project Authors/);
  assert.match(lic, /SIL Open Font License, Version 1\.1/);
});
