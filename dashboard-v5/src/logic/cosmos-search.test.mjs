// Cosmos search grammar, curation layering and sorting. Behaviour ported from Cosmos Local's rank.test.ts / tags.test.ts.
// Invented works only: the repo is public.
//   node --test dashboard-v5/src/logic/cosmos-search.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  WORK_TYPES, TYPE_LABELS, normalizeTag, parseTags, tagIndex, topTags, filterByTags, isFlagged, effectiveWorks, runSearch,
  describeQuery, sortWorks, SORT_MODES, seededShuffle, hashSeed, COLOR_RESULT_CAP,
} from './cosmos-search.mjs';
import { hexToRgb, toColorSig } from './cosmos-color.mjs';

const work = (id, o = {}) => ({ id, title: id, type: 'misc', rel: `alpha-site/${id}.png`, ...o });
const colored = (id, hex, o = {}) => { const { r, g, b } = hexToRgb(hex); return work(id, { color: toColorSig(r, g, b), ...o }); };
const ids = (r) => (Array.isArray(r) ? r : r.works).map((w) => w.id);

const library = [
  colored('teal-1', '#1a6b52', { createdAt: '2026-03-02T10:00:00Z' }),
  colored('red-1', '#e03020', { createdAt: '2026-05-01T10:00:00Z' }),
  colored('gray-1', '#8a8a8a', { createdAt: '2025-12-24T10:00:00Z', type: 'photo' }),
  work('unscanned', { title: 'Sunset Poster', type: 'photo', tags: ['beach', 'wip'] }),
];

test('an empty query is kind none and returns the input array itself', () => {
  for (const q of ['', '   ', null, undefined]) {
    const r = runSearch(library, q);
    assert.equal(r.kind, 'none');
    assert.equal(r.works, library);
  }
  assert.equal(describeQuery(runSearch(library, '')), '');
});

test("#1a6b52, 1a6b52 and #f0c are colour queries, nearest first; works without a colour are skipped", () => {
  for (const q of ['#1a6b52', '1a6b52', '#1A6B52', '  #1a6b52  ']) {
    const r = runSearch(library, q);
    assert.equal(r.kind, 'color', q);
    assert.equal(r.hex, '#1a6b52');
    assert.equal(r.works[0].id, 'teal-1');
    assert.ok(!ids(r).includes('unscanned'));
  }
  const f0c = runSearch(library, '#f0c');
  assert.equal(f0c.kind, 'color');
  assert.equal(f0c.hex, '#f0c');
  assert.equal(runSearch(library, 'e03020').works[0].id, 'red-1');
  assert.equal(describeQuery(runSearch(library, '#1a6b52')), 'colour #1a6b52');
});

test('add, decade and facade stay words; a bare hex needs a digit, and only 3 or 6 digits count', () => {
  for (const w of ['add', 'decade', 'facade', 'bad', 'cafe']) assert.equal(runSearch(library, w).kind === 'color', false, w);
  assert.equal(runSearch(library, 'add').kind, 'text');
  assert.equal(runSearch(library, 'decade').kind, 'text');
  assert.equal(runSearch(library, 'facade').kind, 'text');
  assert.equal(runSearch(library, '#abc').kind, 'color', 'a # always means hex');
  assert.equal(runSearch(library, '#add').kind, 'color');
  assert.equal(runSearch(library, 'bad100').kind, 'color', 'six hex digits with a digit are a colour');
  assert.equal(runSearch(library, 'bad1').kind, 'text', 'four digits is neither #rgb nor #rrggbb');
  assert.equal(runSearch(library, '#12345').kind, 'text');
});

test('tag: is exact and normalised: TAG:WIP works, "tag: Wip" and "tag:" do not', () => {
  const wip = runSearch(library, 'tag:wip');
  assert.equal(wip.kind, 'tag');
  assert.equal(wip.tag, 'wip');
  assert.deepEqual(ids(wip), ['unscanned']);
  assert.deepEqual(ids(runSearch(library, 'TAG:WIP')), ['unscanned']);
  assert.deepEqual(ids(runSearch(library, 'tag:Beach')), ['unscanned']);
  assert.equal(runSearch(library, 'tag:wi').works.length, 0, 'no partial tag matches');
  assert.notEqual(runSearch(library, 'tag: Wip').kind, 'tag', 'a space after the colon is not the grammar');
  assert.equal(runSearch(library, 'tag:').kind, 'text');
  assert.equal(describeQuery(wip), 'tag wip');
  const multi = [work('m', { tags: ['red wine'] })];
  assert.deepEqual(ids(runSearch(multi, 'tag:Red   Wine')), ['m'], 'inner whitespace collapses like a stored tag');
});

test("teal and MONO are colour families, case-insensitively", () => {
  const teal = runSearch(library, 'teal');
  assert.equal(teal.kind, 'family');
  assert.equal(teal.family, 'TEAL');
  assert.deepEqual(ids(teal), ['teal-1']);
  assert.deepEqual(ids(runSearch(library, 'MONO')), ['gray-1']);
  assert.deepEqual(ids(runSearch(library, 'mono')), ['gray-1']);
  assert.deepEqual(ids(runSearch(library, 'Red')), ['red-1']);
  assert.equal(describeQuery(teal), 'teal');
});

test("photo, Photography, ui and a label word like render pick the type", () => {
  const photo = runSearch(library, 'photo');
  assert.equal(photo.kind, 'type');
  assert.deepEqual(ids(photo), ['gray-1', 'unscanned']);
  assert.equal(runSearch(library, 'Photography').kind, 'type');
  assert.equal(runSearch(library, 'PHOTOGRAPHY').type, 'photo');
  assert.equal(runSearch(library, 'ui').type, 'ui');
  assert.equal(runSearch(library, 'render').type, '3d');
  assert.equal(runSearch(library, '3d').type, '3d');
  assert.equal(runSearch(library, 'identity').type, 'logo');
  assert.equal(runSearch(library, 'product').type, 'ui');
  assert.equal(runSearch(library, 'typography').type, 'type');
  assert.equal(runSearch(library, 'd').kind, 'text', 'a stray letter of "3D" is not a type word');
  assert.equal(describeQuery(photo), 'photo');
});

test('priority: hex before tag before family before type before text', () => {
  const ws = [work('a', { type: 'photo', tags: ['teal'] })];
  assert.equal(runSearch(ws, 'teal').kind, 'family', 'a family word beats a tag word without the tag: prefix');
  assert.equal(runSearch(ws, 'photo').kind, 'type');
  assert.equal(runSearch(ws, 'tag:teal').kind, 'tag');
  assert.equal(runSearch(ws, 'tag:123').kind, 'tag', 'tag: beats a bare hex that follows it');
  assert.equal(runSearch(ws, 'summer').kind, 'text');
});

test('free text is a case-insensitive substring over title, type and tags, and NOT over rel', () => {
  assert.deepEqual(ids(runSearch(library, 'sunset')), ['unscanned']);
  assert.deepEqual(ids(runSearch(library, 'SUNSET poster')), ['unscanned']);
  assert.deepEqual(ids(runSearch(library, 'beach')), ['unscanned']);
  assert.deepEqual(ids(runSearch(library, 'hoto')), ['gray-1', 'unscanned'], 'type text counts');
  assert.equal(runSearch(library, 'alpha-site').works.length, 0, 'rel is not searched');
  assert.equal(runSearch(library, 'zzz-nothing').works.length, 0);
  const noisy = [work('n1', { title: undefined, tags: [3, 'x'] })];
  assert.doesNotThrow(() => runSearch(noisy, 'x'));
  assert.equal(describeQuery(runSearch(library, 'sunset')), 'sunset');
});

test('a colour query returns at most 80, nearest first, and ties keep library order', () => {
  const many = [];
  for (let i = 0; i < 120; i += 1) many.push(colored(`c${i}`, `#${(i * 2).toString(16).padStart(2, '0')}6b52`));
  many.push(work('none-colour'));
  const r = runSearch(many, '#006b52');
  assert.equal(COLOR_RESULT_CAP, 80);
  assert.equal(r.works.length, 80);
  assert.equal(r.works[0].id, 'c0');
  const dup = [colored('first', '#112233'), colored('second', '#112233'), colored('third', '#112233')];
  assert.deepEqual(ids(runSearch(dup, '#112233')), ['first', 'second', 'third']);
  const half = [colored('ok', '#112233'), work('bad', { color: { h: 'x' } })];
  assert.deepEqual(ids(runSearch(half, '#112233')), ['ok'], 'a half-written colour record is just unscanned');
});

test('effectiveWorks layers title and tag overrides; the originals are never mutated', () => {
  const lib = [work('a', { title: 'Old title', tags: ['old'] }), work('b', { title: 'Plain', tags: ['keep'] })];
  const frozen = JSON.stringify(lib);
  const cur = { overrides: { a: { title: 'Fresh poster', tags: ['New Tag', 'new tag', '  '] }, ghost: { title: 'nobody' } } };
  const eff = effectiveWorks(lib, cur);
  assert.equal(eff[0].title, 'Fresh poster');
  assert.deepEqual(eff[0].tags, ['new tag'], 'override tags are normalised and de-duplicated');
  assert.equal(eff[1], lib[1], 'a work without an override keeps its identity');
  assert.equal(JSON.stringify(lib), frozen);
  assert.notEqual(eff[0], lib[0]);
  assert.deepEqual(ids(runSearch(eff, 'tag:new tag')), ['a'], 'a search for an override tag finds the work');
  assert.deepEqual(ids(runSearch(eff, 'fresh')), ['a'], 'and so does its override title');
  assert.deepEqual(ids(runSearch(eff, 'tag:old')), [], 'the library tag is gone from the searchable record');
  assert.deepEqual(ids(runSearch(eff, 'old title')), []);
  // partial overrides
  const onlyTitle = effectiveWorks(lib, { overrides: { b: { title: 'T' } } });
  assert.deepEqual(onlyTitle[1].tags, ['keep']);
  const onlyTags = effectiveWorks(lib, { overrides: { b: { tags: [] } } });
  assert.deepEqual(onlyTags[1].tags, [], 'an empty tag override clears the tags');
  assert.equal(onlyTags[1].title, 'Plain');
  // nothing to layer -> the same array back
  assert.equal(effectiveWorks(lib, { overrides: {} }), lib);
  assert.equal(effectiveWorks(lib, null), lib);
  assert.equal(effectiveWorks(lib, { overrides: { a: { title: '   ' } } }), lib, 'a blank title override is no override');
  assert.deepEqual(effectiveWorks(null, null), []);
  // ids that look like object internals
  const odd = [work('__proto__'), work('toString')];
  assert.equal(effectiveWorks(odd, { overrides: {} })[1].title, 'toString');
});

test('isFlagged looks at own properties only', () => {
  const m = { a: true, b: false };
  assert.equal(isFlagged(m, 'a'), true);
  assert.equal(isFlagged(m, 'b'), false);
  assert.equal(isFlagged(m, 'toString'), false);
  assert.equal(isFlagged(m, '__proto__'), false);
  assert.equal(isFlagged(null, 'a'), false);
});

test('tag helpers: normalize, parse, index, topTags, filterByTags', () => {
  assert.equal(normalizeTag('  Red   WINE\t'), 'red wine');
  assert.deepEqual(parseTags('Red, red , wine,, '), ['red', 'wine']);
  assert.deepEqual(parseTags(null), []);
  const ws = [work('a', { tags: ['x', 'y'] }), work('b', { tags: ['x'] }), work('c')];
  const idx = tagIndex(ws);
  assert.equal(idx.get('x'), 2);
  assert.deepEqual(topTags(idx), [['x', 2], ['y', 1]]);
  assert.deepEqual(topTags(idx, 1), [['x', 2]]);
  assert.deepEqual(ids(filterByTags(ws, ['x', 'y'])), ['a']);
  assert.equal(filterByTags(ws, []), ws);
});

test('sorts: every mode is stable, and missing createdAt / colour are handled', () => {
  const ws = [
    colored('a', '#ff0000', { createdAt: '2026-01-01T00:00:00Z', title: 'Beta' }),
    work('nodate', { title: 'alpha' }),
    colored('c', '#ff0000', { createdAt: '2026-01-01T00:00:00Z', title: 'beta' }),
    colored('d', '#808080', { createdAt: '2025-01-01T00:00:00Z', title: 'Delta' }),
    colored('e', '#00ff00', { createdAt: '2027-01-01T00:00:00Z', title: 'Echo' }),
  ];
  const frozen = JSON.stringify(ws);
  const run = (mode) => ids(sortWorks(ws, mode, '2026-11-08'));
  assert.deepEqual(run('newest'), ['e', 'a', 'c', 'd', 'nodate'], 'undated last; equal dates keep order');
  assert.deepEqual(run('oldest'), ['d', 'a', 'c', 'e', 'nodate']);
  assert.deepEqual(run('title'), ['nodate', 'a', 'c', 'd', 'e'], 'case-insensitive, equal titles keep order');
  const hue = run('hue');
  assert.deepEqual(hue.slice(0, 3), ['a', 'c', 'e'], 'chromatic first (red at hue 0, then green)');
  assert.deepEqual(hue.slice(3), ['d', 'nodate'], 'then neutrals, then unscanned');
  const bright = run('brightness');
  assert.equal(bright[bright.length - 1], 'nodate');
  const sat = run('saturation');
  assert.equal(sat[sat.length - 1], 'nodate');
  assert.deepEqual(sat.slice(0, 3), ['a', 'c', 'e'].sort((x, y) => sat.indexOf(x) - sat.indexOf(y)));
  assert.equal(JSON.stringify(ws), frozen, 'the input is not mutated');
  for (const mode of SORT_MODES) {
    const out = sortWorks(ws, mode, '2026-11-08');
    assert.notEqual(out, ws, `${mode} returns a new array`);
    assert.deepEqual(out.map((w) => w.id).sort(), ws.map((w) => w.id).sort(), `${mode} keeps every work`);
    assert.deepEqual(ids(sortWorks(ws, mode, '2026-11-08')), ids(out), `${mode} is deterministic`);
  }
  assert.deepEqual(ids(sortWorks(ws, 'nonsense')), ws.map((w) => w.id), 'an unknown mode keeps the incoming order');
  assert.deepEqual(sortWorks([], 'newest'), []);
  assert.deepEqual(sortWorks(null, 'title'), []);
});

test('random is seeded by the day string the caller passes: same day same order, another day another', () => {
  const ws = Array.from({ length: 40 }, (_, i) => work(`w${i}`));
  const a = ids(sortWorks(ws, 'random', '2026-11-08'));
  const b = ids(sortWorks(ws, 'random', '2026-11-08'));
  const c = ids(sortWorks(ws, 'random', '2026-11-09'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort(), ws.map((w) => w.id).sort());
  assert.equal(hashSeed('x'), hashSeed('x'));
  assert.notEqual(hashSeed('x'), hashSeed('y'));
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], 7), seededShuffle([1, 2, 3, 4, 5], 7));
});

test('WORK_TYPES are the eight types in the source order and TYPE_LABELS cover each', () => {
  assert.deepEqual([...WORK_TYPES], ['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc']);
  for (const t of WORK_TYPES) assert.equal(typeof TYPE_LABELS[t], 'string');
  assert.ok(Object.isFrozen(WORK_TYPES) && Object.isFrozen(TYPE_LABELS));
});

test('the source has no import but ./cosmos-color.mjs and touches no DOM, storage or network global', () => {
  const src = fs.readFileSync(new URL('./cosmos-search.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const imports = [...code.matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./cosmos-color.mjs']);
  assert.equal(/\bimport\s*\(/.test(code), false, 'no dynamic import');
  assert.equal(/\brequire\s*\(/.test(code), false);
  for (const word of ['document', 'window', 'localStorage', 'fetch', 'process', 'Date.now', 'new Date', 'Math.random']) {
    assert.equal(new RegExp(`\\b${word.replace('.', '\\.')}\\b`).test(code), false, `no reference to ${word}`);
  }
  const colorSrc = fs.readFileSync(new URL('./cosmos-color.mjs', import.meta.url), 'utf8');
  assert.equal(/^\s*import\b/m.test(colorSrc), false, 'cosmos-color.mjs imports nothing');
});
