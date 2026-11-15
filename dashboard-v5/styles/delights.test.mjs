// node --test dashboard-v5/styles/delights.test.mjs
// The small delights' stylesheet: every keyframe and every animation sits inside @media (prefers-reduced-motion: no-preference) AND is scoped to
// :root:not([data-hq-reduce]) (the attribute app.js setReduceFlag writes while the Reduce motion pref is on), so with the OS setting or the app pref
// nothing moves. Nothing animates or transitions outside that block, and the classes the stylesheet moves are the ones the template draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATTRACT_LOOP_MS, ATTRACT_MAX_LOOPS } from '../src/logic/delights.mjs';

const RAW = readFileSync(new URL('./delights.css', import.meta.url), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

// top-level blocks: [{ head, body }]; body is the text between the braces
function blocks(text) {
  const out = [];
  let depth = 0, start = -1, headStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0) { out.push({ head: text.slice(headStart, start).trim(), body: text.slice(start + 1, i) }); headStart = i + 1; } }
  }
  assert.equal(depth, 0, 'balanced braces');
  return out;
}
const TOP = blocks(CSS);
const MEDIA = TOP.filter((b) => /^@media/.test(b.head));

test('the whole stylesheet is one @media (prefers-reduced-motion: no-preference) block', () => {
  assert.equal(TOP.length, 1, 'nothing at the top level outside the media query');
  assert.equal(MEDIA.length, 1);
  assert.equal(MEDIA[0].head.replace(/\s+/g, ' '), '@media (prefers-reduced-motion: no-preference)');
});

test('no @keyframes, animation or transition anywhere outside the media block', () => {
  const outside = TOP.filter((b) => !/^@media/.test(b.head)).map((b) => b.head + '{' + b.body + '}').join('\n');
  assert.ok(!/@keyframes|animation|transition/.test(outside));
  assert.ok(/@keyframes/.test(MEDIA[0].body), 'the keyframes are inside the media block');
});

test('every style rule in the media block is scoped to :root:not([data-hq-reduce]); only @keyframes are exempt', () => {
  const inner = blocks(MEDIA[0].body);
  const rules = inner.filter((b) => !/^@keyframes/.test(b.head));
  assert.ok(rules.length >= 3, 'the attract cartridge, the cursor and the lamp');
  for (const r of rules) {
    for (const sel of r.head.split(',')) assert.match(sel.trim(), /^:root:not\(\[data-hq-reduce\]\) /, 'unscoped selector: ' + sel.trim());
    assert.match(r.body, /animation:/, r.head);
  }
  // no declaration outside a rule that carries the root scope: the keyframes bodies hold only percent blocks
  for (const k of inner.filter((b) => /^@keyframes/.test(b.head))) assert.ok(!/:root|animation/.test(k.body), k.head);
});

test('every animation names a keyframes rule that exists, and every keyframes name belongs to this dish (dlx- prefix)', () => {
  const names = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^dlx-/);
  const used = [...CSS.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 3);
  for (const u of used) assert.ok(names.includes(u), u + ' is declared');
  for (const n of names) assert.ok(used.includes(n), n + ' is used');
});

test('the attract scene loops at most the cap and one loop is the controller’s loop length', () => {
  assert.equal(ATTRACT_MAX_LOOPS, 3);
  assert.equal(ATTRACT_LOOP_MS, 6000);
  assert.match(CSS, new RegExp('var\\(--dlx-loop, ' + ATTRACT_LOOP_MS / 1000 + 's\\)'));
  assert.match(CSS, new RegExp('var\\(--dlx-loops, ' + ATTRACT_MAX_LOOPS + '\\)'));
  const attract = CSS.split('.dlx-lamp-glow')[0];
  assert.ok(!/infinite/.test(attract), 'the attract scene never loops forever');
  assert.match(CSS, /\.dlx-lamp-glow\s*\{[^}]*infinite/, 'only the back room lamp is endless, and it is slow');
  assert.match(CSS, /dlx-lamp-flicker 7s/);
});

test('colours and layout: no hex, no position rule on #tabs or .timemachine, no layout properties animated', () => {
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(CSS));
  assert.ok(!/#tabs|\.timemachine/.test(CSS));
  for (const k of CSS.matchAll(/@keyframes[^{]+\{([\s\S]*?)\}\s*\}/g)) assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding)\s*:/.test(k[1]), 'only transform and opacity move');
});

test('the classes this stylesheet moves are the ones the template draws', async () => {
  const tpl = (await import('../src/tpl/delights.tpl.js'));
  const all = tpl.dlxAttract + tpl.default;
  for (const cls of ['dlx-attract', 'dlx-cart', 'dlx-cursor', 'dlx-lamp-glow']) {
    assert.ok(CSS.includes('.' + cls), cls + ' is in the stylesheet');
    assert.ok(all.includes(cls), cls + ' is in the template');
  }
});

test('no company, brand or character words in the stylesheet (inline placeholder deny-list)', () => {
  const DENY = ['disney', 'nintendo', 'sega', 'sony', 'mario', 'pokemon', 'lego', 'atari', 'playstation', 'xbox', 'google', 'apple', 'microsoft'];
  const low = RAW.toLowerCase();
  for (const w of DENY) assert.ok(!low.includes(w), w);
});
