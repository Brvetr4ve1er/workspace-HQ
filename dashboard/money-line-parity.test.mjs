// The spend-line gate exists in several copies that must never drift:
//   dashboard/money/quicklog.mjs (main) · dashboard-v5/src/logic/money-line.js (renderer, Ctrl K) · dashboard/cast.js (Ctrl+Alt+X).
// One table of lines goes through every copy that exists and each must give the same answer.
// cast.js gains amountLine at the Pass; until it does its rows are skipped (loudly), never silently green.
//   node --test dashboard/money-line-parity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { amountLine as mainCopy, WORD_MAP } from './money/quicklog.mjs';
import { amountLine as rendererCopy, CATEGORY_WORDS } from '../dashboard-v5/src/logic/money-line.js';

const require = createRequire(import.meta.url);
let cast = null, castWhy = '';
try { cast = require('./cast.js'); } catch (e) { castWhy = 'dashboard/cast.js could not be loaded here: ' + e.message; }
const castCopy = cast && typeof cast.amountLine === 'function' ? cast.amountLine : null;
if (cast && !castCopy) castWhy = 'dashboard/cast.js does not export amountLine yet (the integrator adds it from the money-line.js block)';

// every row: a line a person might type in Ctrl K / the quick-run box
const LINES = [
  '150 cafe', 'cafe 150', '150', '  150   cafe  ', '1 200 food', '2 500 loyer', '1.200,00 pharmacie', '12,5 usd', '12.49',
  '$12.49 netflix', 'netflix $12.49', 'netflix 12.49$', 'usd 12.49 netflix', '12 USD', '12 us$', '12 dollars', '400 dinars taxi',
  'taxi 400da', 'taxi 400 da', 'taxi 400 DA', 'dzd 400 taxi', '400 dzd',
  'hier taxi 400', 'yesterday 400 taxi', 'taxi 400 hier', 'Hier 150', 'hier',
  '2026 da', '2026 cafe', 'cafe 2026', '2026 plan', 'plan 2026', '2026', '1999 notes', '2100 plan', '1899', '$2026', '2026,50', '2026 taxi hier',
  'deploy v2', 'v2', 'node 22', 'python 3', '5kg rice', 'rice 5kg', '3d model', 'a1 b2',
  'hello', '', '   ', 'cafe', 'buy 400 things', 'taxi 400 cash', '150 cafe 300', '300 150',
  '0', '0 cafe', '0,00 cafe', '0.00 usd', '999999999 cafe', '1000000000 cafe', '1000000000',
  '12 eur cafe', '€12 cafe', '12€', '$5 da', '5 usd da',
  '150 dashboard', '150 dalle', 'da 150', 'dashboard 150',
  'x'.repeat(200) + ' 5', 'x'.repeat(190) + ' 5', '5 ' + 'x'.repeat(198), '5 ' + 'x'.repeat(199),
  '१५० cafe', '150 cafe', '1 200 pain', '1 200 pain',
];
const NOT_TEXT = [undefined, null, 42, {}, []];

test('the three copies answer every row the same way', () => {
  for (const line of LINES) {
    const want = mainCopy(line);
    assert.deepEqual(rendererCopy(line), want, `renderer copy differs on ${JSON.stringify(line)}`);
    if (castCopy) assert.deepEqual(castCopy(line), want, `cast.js differs on ${JSON.stringify(line)}`);
  }
  for (const v of NOT_TEXT) {
    assert.equal(mainCopy(v), null);
    assert.equal(rendererCopy(v), null);
    if (castCopy) assert.equal(castCopy(v), null);
  }
});

test('the table actually exercises both outcomes', () => {
  const hits = LINES.filter((l) => mainCopy(l)), misses = LINES.filter((l) => !mainCopy(l));
  assert.ok(hits.length >= 25 && misses.length >= 20, `${hits.length} hits, ${misses.length} misses`);
  // the spec's year rule, spelled out
  for (const l of ['150 cafe', '2026 da', '2026 cafe']) assert.ok(mainCopy(l), l);
  for (const l of ['2026 plan', 'deploy v2']) assert.equal(mainCopy(l), null, l);
});

test('the category word list is the same in main and the renderer', () => {
  assert.deepEqual([...CATEGORY_WORDS].sort(), Object.values(WORD_MAP).flat().sort());
});

test('the paste-able block in money-line.js works as a classic script (what cast.js will carry)', () => {
  const src = fs.readFileSync(new URL('../dashboard-v5/src/logic/money-line.js', import.meta.url), 'utf8');
  const block = /\/\/ ---- BEGIN amountLine block \(copy me\) ----\r?\n([\s\S]*?)\/\/ ---- END amountLine block ----/.exec(src);
  assert.ok(block, 'BEGIN/END markers are in money-line.js');
  const classic = new Function(block[1].replace(/^export /gm, '') + '\nreturn amountLine;')();
  for (const line of LINES) assert.deepEqual(classic(line), mainCopy(line), `classic block differs on ${JSON.stringify(line)}`);
});

test('cast.js carries amountLine', { skip: castCopy ? false : castWhy }, () => {
  assert.equal(typeof cast.amountLine, 'function');
});
