// Parity: the renderer's copies in dashboard-v5/src/logic/cosmos-search.mjs (WORK_TYPES, TYPE_LABELS, normalizeTag) must
// equal the main-side originals (dashboard/cosmos/types.mjs, infer.mjs). The renderer cannot import main-side code, so the
// copies exist; this test is what keeps them from drifting (the Money amountLine precedent, money-line-parity.test.mjs).
// Everything else in the search grammar exists once, in the renderer tree, and the MCP server imports it from there.
//   node --test dashboard/cosmos/search-parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORK_TYPES as MAIN_TYPES, TYPE_META } from './types.mjs';
import { normalizeTag as mainNormalize } from './infer.mjs';
import { WORK_TYPES, TYPE_LABELS, normalizeTag } from '../../dashboard-v5/src/logic/cosmos-search.mjs';

test('WORK_TYPES: same eight types in the same order', () => {
  assert.deepEqual([...WORK_TYPES], [...MAIN_TYPES]);
  assert.equal(WORK_TYPES.length, 8);
});

test('TYPE_LABELS equals the label of every TYPE_META entry, with no extras', () => {
  assert.deepEqual(Object.keys(TYPE_LABELS), Object.keys(TYPE_META));
  for (const t of MAIN_TYPES) assert.equal(TYPE_LABELS[t], TYPE_META[t].label, t);
});

const TABLE = [
  '', ' ', '   ', '\t', '\n', '\t \n', 'a', 'A', 'wip', 'WIP', 'Wip', '  wip  ', 'wip ', ' wip',
  'red wine', 'Red   Wine', 'red\twine', 'red\nwine', 'red \t\n wine', '  Red   WINE\t', 'a  b   c    d',
  'Poster', 'POSTER', 'poster-2', 'poster_2', 'poster.2', 'a/b', 'a\\b', 'c++', '#tag', 'tag:wip', 'tag: wip',
  'Café', 'CAFÉ', 'café  noir', 'İstanbul', 'ÉCOLE', 'straße', 'STRASSE', 'ǅ', 'Ω omega', 'ΑΒΓ', 'ЖЖ', '日本語', '日本　語', '😀', 'x😀y',
  'a b', 'a b', 'a​b', ' pad ', 'a　b', '3D', '3d render', '  3D   &   Render ', 'UI & Product',
  '0', '007', '1e9', 'a-b - c', "it's", '"quoted"', 'x'.repeat(200),
];

test(`normalizeTag equals infer.mjs normalizeTag over ${TABLE.length} strings`, () => {
  assert.ok(TABLE.length >= 60, 'the table keeps at least 60 strings');
  for (const s of TABLE) assert.equal(normalizeTag(s), mainNormalize(s), JSON.stringify(s));
});

test('normalizeTag copes with non-strings the same way as the original', () => {
  for (const v of [0, 12, true, null, undefined, ['a ', ' B'], { toString: () => '  OBJ  ' }]) {
    assert.equal(normalizeTag(v), mainNormalize(v), String(v));
  }
});
