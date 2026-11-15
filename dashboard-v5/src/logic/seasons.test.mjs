// node --test dashboard-v5/src/logic/seasons.test.mjs
// The seasonal ornament table: 12 entries, every month maps, the year boundary and a leap day, art that is only known primitives with colour
// tokens (no hex), and no holiday, company or character words. Placeholder-free: the data is the table itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEASONS, TOKENS, PRIMITIVES, ART_BOX, seasonFor, seasonLabel, monthName, artLists } from './seasons.mjs';

test('twelve entries, one per month in order, unique ids, names and a frozen table', () => {
  assert.equal(SEASONS.length, 12);
  assert.deepEqual(SEASONS.map((s) => s.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(new Set(SEASONS.map((s) => s.id)).size, 12);
  assert.equal(new Set(SEASONS.map((s) => s.name)).size, 12);
  assert.ok(Object.isFrozen(SEASONS));
  for (const s of SEASONS) { assert.ok(Object.isFrozen(s), s.id); assert.match(s.id, /^[a-z]+(-[a-z]+)*$/); assert.ok(s.name.length >= 3 && s.name.length <= 20, s.name); }
});

test('every local month maps to its own entry', () => {
  for (let m = 0; m < 12; m++) {
    const e = seasonFor(new Date(2026, m, 15, 12, 0, 0));
    assert.equal(e.month, m + 1);
    assert.equal(e, SEASONS[m]);
  }
});

test('the year boundary: Dec 31 is December, Jan 1 is January, whatever the year', () => {
  assert.equal(seasonFor(new Date(2026, 11, 31, 23, 59, 59)).month, 12);
  assert.equal(seasonFor(new Date(2027, 0, 1, 0, 0, 0)).month, 1);
  assert.equal(seasonFor(new Date(2027, 0, 1, 0, 0, 0)).id, SEASONS[0].id);
  assert.equal(seasonFor(new Date(2026, 0, 31, 23, 59, 59)).month, 1);
  assert.equal(seasonFor(new Date(2026, 1, 1, 0, 0, 0)).month, 2);
});

test('a leap day is February, and the day after it is March', () => {
  assert.equal(seasonFor(new Date(2028, 1, 29, 12)).month, 2);
  assert.equal(seasonFor(new Date(2028, 2, 1, 0)).month, 3);
  assert.equal(seasonFor(new Date(2024, 1, 29, 0, 0, 0)).id, SEASONS[1].id);
});

test('a millisecond number works like its Date; anything that is not a real date answers null (the ornament hides)', () => {
  const d = new Date(2026, 5, 10, 8);
  assert.equal(seasonFor(d.getTime()), seasonFor(d));
  for (const bad of [undefined, null, '', 'June', {}, [], NaN, Infinity, new Date('nope')]) assert.equal(seasonFor(bad), null, String(bad));
});

test('the same instant always answers the same entry (no hidden clock)', () => {
  const d = new Date(2026, 7, 3, 9);
  assert.equal(seasonFor(d), seasonFor(new Date(d.getTime())));
});

test('every entry has 3 to 8 primitives, all from the closed set, inside the 32 x 32 box', () => {
  for (const s of SEASONS) {
    assert.equal(s.art.box, ART_BOX);
    assert.ok(s.art.shapes.length >= 3 && s.art.shapes.length <= 8, s.id + ' has ' + s.art.shapes.length);
    for (const sh of s.art.shapes) {
      assert.ok(PRIMITIVES.includes(sh.t), s.id + ' uses ' + sh.t);
      const nums = [];
      if (sh.t === 'circle') { nums.push(sh.cx, sh.cy, sh.r); assert.ok(sh.r > 0); }
      if (sh.t === 'rect') nums.push(sh.x, sh.y, sh.w, sh.h, sh.rx);
      if (sh.t === 'line') nums.push(sh.x1, sh.y1, sh.x2, sh.y2);
      if (sh.t === 'poly') { assert.ok(sh.pts.length >= 3, s.id); for (const p of sh.pts) { assert.equal(p.length, 2); nums.push(...p); } }
      if (sh.t === 'path') assert.match(sh.d, /^[MLCQZ0-9 .,-]+$/, s.id + ' path uses only M L C Q Z and numbers');
      for (const n of nums) assert.ok(Number.isFinite(n) && n >= 0 && n <= ART_BOX, s.id + ' coordinate ' + n);
    }
  }
});

test('colours are tokens (so every theme and the Console skin recolour them): no hex, no rgb, no named colour outside the token list', () => {
  const raw = JSON.stringify(SEASONS);
  assert.ok(!/#[0-9a-f]{3,8}/i.test(raw), 'no hex colour in the art');
  assert.ok(!/rgb|hsl|url\(/i.test(raw));
  for (const s of SEASONS) for (const sh of s.art.shapes) for (const k of ['fill', 'stroke']) {
    if (sh[k] === undefined) continue;
    assert.ok(sh[k] === 'none' || TOKENS.includes(sh[k]), s.id + ' ' + k + ' ' + sh[k]);
  }
  // the tokens themselves are real v5 tokens
  const css = new URL('../../styles/tokens.css', import.meta.url);
  return import('node:fs').then(({ readFileSync }) => {
    const t = readFileSync(css, 'utf8');
    for (const tok of TOKENS) assert.ok(t.includes('--' + tok + ':'), '--' + tok + ' is defined in tokens.css');
  });
});

test('nature and craft only: no holiday, company or character words in names or ids (inline placeholder deny-list)', () => {
  const DENY = ['christmas', 'xmas', 'halloween', 'easter', 'santa', 'valentine', 'thanksgiving', 'diwali', 'ramadan', 'hanukkah', 'new year', 'independence',
    'disney', 'nintendo', 'sega', 'sony', 'mario', 'pokemon', 'lego', 'atari', 'google', 'apple', 'microsoft', 'marvel', 'batman', 'mickey', 'snoopy',
    'pumpkin', 'reindeer', 'flag', 'cross', 'crescent', 'star of'];
  const words = SEASONS.map((s) => (s.id + ' ' + s.name).toLowerCase()).join(' | ');
  for (const w of DENY) assert.ok(!words.includes(w), 'forbidden word: ' + w);
});

test('labels: the words say the motif and the month, empty for no entry', () => {
  assert.equal(seasonLabel(SEASONS[1]), 'Season ornament: Paper kite (February)');
  assert.equal(seasonLabel(SEASONS[11]), 'Season ornament: Thread spool (December)');
  assert.equal(seasonLabel(null), '');
  assert.equal(monthName(13), '');
});

test('artLists: every shape lands in its own list, every colour is a var(--token) style, nothing is invented', () => {
  for (const s of SEASONS) {
    const a = artLists(s.art);
    const total = a.circles.length + a.rects.length + a.lines.length + a.polys.length + a.paths.length;
    assert.equal(total, s.art.shapes.length, s.id);
    const styles = [...a.circles, ...a.rects, ...a.lines, ...a.polys, ...a.paths].map((x) => x.style).join(';');
    assert.ok(!/#[0-9a-f]{3,8}/i.test(styles));
    assert.ok(/var\(--/.test(styles), s.id + ' uses tokens');
    assert.equal(new Set([...a.circles, ...a.rects, ...a.lines, ...a.polys, ...a.paths].map((x) => x.key)).size, total, 'keys are unique');
  }
  const kite = artLists(SEASONS[1].art);
  assert.equal(kite.polys.length, 1); assert.match(kite.polys[0].points, /^16,3 24,12 16,22 8,12$/);
  assert.equal(kite.paths.length, 1); assert.equal(kite.lines.length, 2);
});

test('artLists drops unknown primitives and unknown tokens instead of guessing', () => {
  const a = artLists({ box: 32, shapes: [{ t: 'image', href: 'x' }, { t: 'circle', cx: 1, cy: 1, r: 1, fill: '#ff0000' }, null, { t: 'poly', pts: 'no' }, { t: 'path', d: 5 }] });
  assert.equal(a.circles.length, 1);
  assert.ok(!/#ff0000/.test(a.circles[0].style));
  assert.equal(a.rects.length + a.lines.length + a.polys.length + a.paths.length, 0);
  assert.deepEqual(artLists(null).circles, []);
  assert.deepEqual(artLists({}).paths, []);
});
