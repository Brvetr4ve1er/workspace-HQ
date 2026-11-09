// Cosmos space — validated intents (dashboard/cosmos/curation.mjs). Invented ids only.
// The rules under test: the renderer sends intents, never documents; every id must be in the id map and not a
// retired reservation; ids and timestamps come from the injected newId/now only; a refusal is {error} with
// nothing changed; the inputs are never mutated.
//   node --test dashboard/cosmos/curation.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyIntent, checkIntent, emptyCuration, emptyCleanup, normalizeCuration, normalizeCleanup, referencedIds, INTENT_TYPES, LIMITS } from './curation.mjs';

const idMap = {
  version: 1,
  entries: [
    { rel: 'alpha/one.png', id: 'alpha-one-png' }, { rel: 'alpha/two.png', id: 'alpha-two-png' },
    { rel: 'beta/three.png', id: 'beta-three-png' }, { rel: 'imports:drop.png', id: 'imports-drop-png' },
    { rel: 'retired:old-id', id: 'old-id' },
  ],
};
const A = 'alpha-one-png';
const B = 'alpha-two-png';
const C = 'beta-three-png';
const NOW = new Date('2026-03-04T05:06:07.000Z');
const base = (over = {}) => ({ idMap, now: () => NOW, newId: () => 'abcd1234', baseTags: () => [], ...over });
const run = (intent, cur = emptyCuration(), cln = emptyCleanup(), o = {}) => applyIntent(cur, cln, intent, base(o));

describe('before any IO', () => {
  it('refuses a non-object, an array, an unknown type and a missing type', () => {
    for (const bad of [null, undefined, 5, 'favorite', [], {}, { type: 'nope' }, { type: 7 }, { type: '__proto__' }]) {
      assert.ok(run(bad).error, JSON.stringify(bad));
    }
  });
  it('refuses a payload over 64 KB', () => {
    const r = run({ type: 'tags', id: A, add: ['x'], pad: 'x'.repeat(65 * 1024) });
    assert.match(r.error, /too large/);
    assert.ok(checkIntent({ type: 'favorite', id: A, on: true }) === null);
  });
  it('refuses a payload that cannot be serialised', () => {
    const o = { type: 'favorite', id: A, on: true };
    o.self = o;
    assert.ok(run(o).error);
  });
  it('lists exactly the intents the plan names', () => {
    assert.deepEqual([...INTENT_TYPES].sort(), ['cleanup-dismiss', 'cluster-add', 'cluster-delete', 'cluster-remove', 'cluster-save', 'favorite', 'hide', 'import-replace', 'tags', 'title']);
  });
  it('never mutates its inputs', () => {
    const cur = emptyCuration();
    const cln = emptyCleanup();
    const before = JSON.stringify([cur, cln]);
    const r = applyIntent(cur, cln, { type: 'favorite', id: A, on: true }, base());
    assert.equal(JSON.stringify([cur, cln]), before);
    assert.deepEqual(r.curation.favorites, { [A]: true });
  });
});

describe('element ids', () => {
  it('refuses an id that is not in the id map, a __proto__ id, and a retired reservation id', () => {
    assert.match(run({ type: 'favorite', id: 'ghost', on: true }).error, /not in the library/);
    for (const id of ['__proto__', 'constructor', 'prototype']) assert.match(run({ type: 'favorite', id, on: true }).error, /not a valid/);
    assert.match(run({ type: 'favorite', id: 'old-id', on: true }).error, /retired/);
    assert.ok(run({ type: 'hide', ids: [A, 'old-id'], on: true }).error);
    assert.ok(run({ type: 'favorite', id: 42, on: true }).error);
  });
  it('accepts an id that is only in the id map (a curated file that went missing still works)', () => {
    assert.ok(!run({ type: 'favorite', id: C, on: true }).error);
  });
});

describe('favorite and hide', () => {
  it('turn on, are idempotent, and turn off', () => {
    const on = run({ type: 'favorite', id: A, on: true });
    assert.deepEqual(on.curation.favorites, { [A]: true });
    assert.equal(on.touched.curation, true);
    const again = run({ type: 'favorite', id: A, on: true }, on.curation);
    assert.equal(again.touched.curation, false);
    assert.equal(again.note, 'Nothing to change.');
    const off = run({ type: 'favorite', id: A, on: false }, again.curation);
    assert.deepEqual(off.curation.favorites, {});
    assert.equal(off.touched.curation, true);
  });
  it('hide accepts up to 500 ids and refuses 501', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => `x${i}`);
    const map = { version: 1, entries: many(501).map((id) => ({ rel: `alpha/${id}.png`, id })) };
    const ok = applyIntent(emptyCuration(), emptyCleanup(), { type: 'hide', ids: many(500), on: true }, base({ idMap: map }));
    assert.equal(Object.keys(ok.curation.hidden).length, 500);
    assert.match(applyIntent(emptyCuration(), emptyCleanup(), { type: 'hide', ids: many(501), on: true }, base({ idMap: map })).error, /Too many/);
  });
  it('favorite also takes ids, collapses duplicates and needs a boolean on', () => {
    const r = run({ type: 'favorite', ids: [A, A, B], on: true });
    assert.deepEqual(Object.keys(r.curation.favorites), [A, B]);
    assert.ok(run({ type: 'favorite', id: A, on: 'yes' }).error);
    assert.ok(run({ type: 'favorite', id: A }).error);
    assert.ok(run({ type: 'favorite', ids: [], on: true }).error);
    assert.ok(run({ type: 'favorite', ids: 'abc', on: true }).error);
    assert.ok(run({ type: 'favorite', on: true }).error);
  });
});

describe('tags', () => {
  it('writes the full effective list: base tags plus add minus remove, normalised', () => {
    const r = run({ type: 'tags', id: A, add: ['  New  Tag ', 'Alpha'], remove: ['BETA'] }, emptyCuration(), emptyCleanup(), { baseTags: () => ['alpha', 'beta'] });
    assert.deepEqual(r.curation.overrides[A], { tags: ['alpha', 'new tag'] });
  });
  it('an existing override list is the starting point, not the folder tags', () => {
    const cur = { ...emptyCuration(), overrides: { [A]: { title: 'Kept', tags: ['mine'] } } };
    const r = run({ type: 'tags', id: A, add: ['more'] }, cur, emptyCleanup(), { baseTags: () => ['folder'] });
    assert.deepEqual(r.curation.overrides[A], { title: 'Kept', tags: ['mine', 'more'] });
  });
  it('removing every tag stores an explicit empty list', () => {
    const r = run({ type: 'tags', id: A, remove: ['folder'] }, emptyCuration(), emptyCleanup(), { baseTags: () => ['folder'] });
    assert.deepEqual(r.curation.overrides[A], { tags: [] });
  });
  it('a change that equals what is shown writes nothing', () => {
    const r = run({ type: 'tags', id: A, add: ['folder'] }, emptyCuration(), emptyCleanup(), { baseTags: () => ['folder'] });
    assert.equal(r.touched.curation, false);
    assert.deepEqual(r.curation.overrides, {});
  });
  it('refuses a tag over 40 characters, an empty tag, 31 tags, no change at all, and non-arrays', () => {
    assert.match(run({ type: 'tags', id: A, add: ['x'.repeat(41)] }).error, /40/);
    assert.equal(run({ type: 'tags', id: A, add: ['x'.repeat(40)] }).error, undefined);
    assert.match(run({ type: 'tags', id: A, add: ['   '] }).error, /empty/);
    const thirtyOne = Array.from({ length: 31 }, (_, i) => `t${i}`);
    assert.match(run({ type: 'tags', id: A, add: thirtyOne }).error, /30 tags/);
    assert.equal(run({ type: 'tags', id: A, add: thirtyOne.slice(0, 30) }).error, undefined);
    assert.ok(run({ type: 'tags', id: A }).error);
    assert.ok(run({ type: 'tags', id: A, add: 'x' }).error);
    assert.ok(run({ type: 'tags', id: A, add: [5] }).error);
  });
  it('applies to several ids and refuses the whole intent when one would exceed the cap', () => {
    const r = run({ type: 'tags', ids: [A, B], add: ['shared'] });
    assert.deepEqual([r.curation.overrides[A].tags, r.curation.overrides[B].tags], [['shared'], ['shared']]);
    const full = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const cur = { ...emptyCuration(), overrides: { [B]: { tags: full } } };
    const bad = run({ type: 'tags', ids: [A, B], add: ['one-too-many'] }, cur);
    assert.ok(bad.error);
  });
});

describe('title', () => {
  it('sets, trims, resets with null or empty, and drops an override that became empty', () => {
    const set = run({ type: 'title', id: A, title: '  New   name ' });
    assert.equal(set.curation.overrides[A].title, 'New   name');
    const same = run({ type: 'title', id: A, title: 'New   name' }, set.curation);
    assert.equal(same.touched.curation, false);
    const cleared = run({ type: 'title', id: A, title: null }, set.curation);
    assert.deepEqual(cleared.curation.overrides, {});
    assert.equal(run({ type: 'title', id: A, title: '   ' }, set.curation).curation.overrides[A], undefined);
    const keepsTags = run({ type: 'title', id: A, title: null }, { ...emptyCuration(), overrides: { [A]: { title: 'x', tags: ['t'] } } });
    assert.deepEqual(keepsTags.curation.overrides[A], { tags: ['t'] });
  });
  it('refuses a title over 200 characters, a non-string and an unknown id; control characters become spaces', () => {
    assert.match(run({ type: 'title', id: A, title: 'x'.repeat(201) }).error, /200/);
    assert.equal(run({ type: 'title', id: A, title: 'x'.repeat(200) }).error, undefined);
    assert.ok(run({ type: 'title', id: A, title: 5 }).error);
    assert.ok(run({ type: 'title', id: 'ghost', title: 'x' }).error);
    assert.equal(run({ type: 'title', id: A, title: 'a\nb\u0000c' }).curation.overrides[A].title, 'a b c');
  });
});

describe('clusters', () => {
  it('cluster-save mints the id and timestamps from newId/now and ignores renderer-supplied ones', () => {
    const r = run({ type: 'cluster-save', id: 'cl-hacked', name: 'Moodboard', description: 'for later', elementIds: [A, B], createdAt: '1999-01-01T00:00:00.000Z' });
    const c = r.curation.clusters[0];
    assert.equal(c.id, 'cl-abcd1234');
    assert.deepEqual(c.elementIds, []);
    assert.equal(c.createdAt, NOW.toISOString());
    assert.equal(c.updatedAt, NOW.toISOString());
    assert.equal(c.description, 'for later');
    assert.equal(r.note, 'Cluster created.');
  });
  it('saving with an existing id updates name and description and keeps members and createdAt', () => {
    const made = run({ type: 'cluster-save', name: 'Moodboard' }).curation;
    const withMembers = run({ type: 'cluster-add', id: 'cl-abcd1234', ids: [A] }, made).curation;
    const later = new Date('2026-04-01T00:00:00.000Z');
    const r = run({ type: 'cluster-save', id: 'cl-abcd1234', name: 'Renamed', createdAt: 'nope', elementIds: ['x'] }, withMembers, emptyCleanup(), { now: () => later });
    const c = r.curation.clusters[0];
    assert.equal(c.name, 'Renamed');
    assert.deepEqual(c.elementIds, [A]);
    assert.equal(c.createdAt, NOW.toISOString());
    assert.equal(c.updatedAt, later.toISOString());
    assert.equal(r.curation.clusters.length, 1);
    const again = run({ type: 'cluster-save', id: 'cl-abcd1234', name: 'Renamed' }, r.curation);
    assert.equal(again.touched.curation, false);
  });
  it('a rule needs a non-empty query or tags; a smart cluster has no members', () => {
    assert.match(run({ type: 'cluster-save', name: 'Smart', rule: {} }).error, /smart cluster needs/);
    assert.match(run({ type: 'cluster-save', name: 'Smart', rule: { query: '   ', tags: [] } }).error, /smart cluster needs/);
    assert.ok(run({ type: 'cluster-save', name: 'Smart', rule: 'x' }).error);
    const q = run({ type: 'cluster-save', name: 'Smart', rule: { query: ' logo ' } }).curation.clusters[0];
    assert.deepEqual(q.rule, { query: 'logo' });
    const t = run({ type: 'cluster-save', name: 'Smart', rule: { tags: ['Brand', 'brand'] } }).curation.clusters[0];
    assert.deepEqual(t.rule, { tags: ['brand'] });
    assert.deepEqual(t.elementIds, []);
  });
  it('refuses an empty or over-long name and over-long description; duplicate names are fine', () => {
    assert.match(run({ type: 'cluster-save', name: '   ' }).error, /name/);
    assert.match(run({ type: 'cluster-save' }).error, /name/);
    assert.ok(run({ type: 'cluster-save', name: 'x'.repeat(81) }).error);
    assert.ok(!run({ type: 'cluster-save', name: 'x'.repeat(80) }).error);
    assert.ok(run({ type: 'cluster-save', name: 'ok', description: 'x'.repeat(501) }).error);
    const first = run({ type: 'cluster-save', name: 'Same' }).curation;
    const second = run({ type: 'cluster-save', name: 'Same' }, first, emptyCleanup(), { newId: () => 'ffff0000' });
    assert.equal(second.curation.clusters.length, 2);
  });
  it('a newId that keeps colliding is a refusal, not a loop', () => {
    const first = run({ type: 'cluster-save', name: 'One' }).curation;
    assert.match(run({ type: 'cluster-save', name: 'Two' }, first).error, /new cluster/);
  });
  it('caps the number of clusters', () => {
    const cur = emptyCuration();
    for (let i = 0; i < LIMITS.clusters; i++) cur.clusters.push({ id: `cl-${i}`, name: 'n', elementIds: [], createdAt: '', updatedAt: '' });
    assert.match(run({ type: 'cluster-save', name: 'One more' }, cur).error, /500/);
  });
  it('cluster-add collapses duplicates, cluster-remove removes, both are idempotent', () => {
    const made = run({ type: 'cluster-save', name: 'Box' }).curation;
    const added = run({ type: 'cluster-add', id: 'cl-abcd1234', ids: [A, B, A] }, made);
    assert.deepEqual(added.curation.clusters[0].elementIds, [A, B]);
    assert.equal(added.note, 'Added 2 to the cluster.');
    const dup = run({ type: 'cluster-add', id: 'cl-abcd1234', ids: [A] }, added.curation);
    assert.equal(dup.touched.curation, false);
    const removed = run({ type: 'cluster-remove', id: 'cl-abcd1234', ids: [A, C] }, added.curation);
    assert.deepEqual(removed.curation.clusters[0].elementIds, [B]);
    assert.equal(run({ type: 'cluster-remove', id: 'cl-abcd1234', ids: [C] }, removed.curation).touched.curation, false);
  });
  it('cluster-add and cluster-remove are refused on a smart cluster, an unknown cluster and bad ids', () => {
    const smart = run({ type: 'cluster-save', name: 'Smart', rule: { query: 'x' } }).curation;
    assert.match(run({ type: 'cluster-add', id: 'cl-abcd1234', ids: [A] }, smart).error, /smart cluster/);
    assert.match(run({ type: 'cluster-remove', id: 'cl-abcd1234', ids: [A] }, smart).error, /smart cluster/);
    assert.match(run({ type: 'cluster-add', id: 'cl-none', ids: [A] }).error, /no longer exists/);
    const made = run({ type: 'cluster-save', name: 'Box' }).curation;
    assert.ok(run({ type: 'cluster-add', id: 'cl-abcd1234', ids: ['ghost'] }, made).error);
    assert.ok(run({ type: 'cluster-add', id: 'cl-abcd1234', ids: ['old-id'] }, made).error);
    assert.ok(run({ type: 'cluster-add', id: 'cl-abcd1234' }, made).error);
    assert.ok(run({ type: 'cluster-add', id: 'cl-abcd1234', ids: 'x' }, made).error);
  });
  it('cluster-add accepts 2000 ids and refuses 2001', () => {
    const ids = Array.from({ length: 2001 }, (_, i) => `x${i}`);
    const map = { version: 1, entries: ids.map((id) => ({ rel: `a/${id}.png`, id })) };
    const made = applyIntent(emptyCuration(), emptyCleanup(), { type: 'cluster-save', name: 'Big' }, base({ idMap: map })).curation;
    assert.equal(applyIntent(made, emptyCleanup(), { type: 'cluster-add', id: 'cl-abcd1234', ids: ids.slice(0, 2000) }, base({ idMap: map })).curation.clusters[0].elementIds.length, 2000);
    assert.match(applyIntent(made, emptyCleanup(), { type: 'cluster-add', id: 'cl-abcd1234', ids }, base({ idMap: map })).error, /Too many/);
  });
  it('cluster-delete removes the cluster only: favourites, hidden and overrides stay', () => {
    let cur = run({ type: 'cluster-save', name: 'Box' }).curation;
    cur = run({ type: 'cluster-add', id: 'cl-abcd1234', ids: [A] }, cur).curation;
    cur = run({ type: 'favorite', id: A, on: true }, cur).curation;
    cur = run({ type: 'hide', id: B, on: true }, cur).curation;
    cur = run({ type: 'title', id: A, title: 'Named' }, cur).curation;
    const r = run({ type: 'cluster-delete', id: 'cl-abcd1234' }, cur);
    assert.deepEqual(r.curation.clusters, []);
    assert.deepEqual(r.curation.favorites, { [A]: true });
    assert.deepEqual(r.curation.hidden, { [B]: true });
    assert.equal(r.curation.overrides[A].title, 'Named');
    assert.match(run({ type: 'cluster-delete', id: 'cl-abcd1234' }, r.curation).error, /no longer exists/);
  });
});

describe('cleanup-dismiss', () => {
  it('dismisses a duplicate cluster by key and a junk candidate by id, once', () => {
    const d = run({ type: 'cleanup-dismiss', kind: 'dupe', key: `${A} ${B}` });
    assert.deepEqual(d.cleanup.dismissed.clusters, { [`${A} ${B}`]: NOW.toISOString() });
    assert.equal(d.touched.cleanup, true);
    assert.equal(d.touched.curation, false);
    const later = new Date('2027-01-01T00:00:00.000Z');
    const again = run({ type: 'cleanup-dismiss', kind: 'dupe', key: `${A} ${B}` }, emptyCuration(), d.cleanup, { now: () => later });
    assert.equal(again.touched.cleanup, false);
    assert.equal(again.cleanup.dismissed.clusters[`${A} ${B}`], NOW.toISOString());
    const j = run({ type: 'cleanup-dismiss', kind: 'junk', key: C });
    assert.deepEqual(j.cleanup.dismissed.candidates, { [C]: NOW.toISOString() });
  });
  it('refuses unknown kinds, single-id dupe keys, unknown or retired ids and oversize keys', () => {
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'other', key: A }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'dupe', key: A }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'dupe', key: `${A} ghost` }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'dupe', key: `${A} old-id` }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'junk', key: '__proto__' }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'junk', key: 'x'.repeat(20001) }).error);
    assert.ok(run({ type: 'cleanup-dismiss', kind: 'junk' }).error);
  });
});

describe('import-replace', () => {
  it('delegates to the injected replace with the token and the current curation, and writes its answer', () => {
    const seen = [];
    const replace = (token, cur) => { seen.push(token); return { curation: { ...cur, favorites: { [A]: true } }, note: 'Replaced.' }; };
    const r = run({ type: 'import-replace', token: 'abcdef0123456789' }, emptyCuration(), emptyCleanup(), { replace });
    assert.deepEqual(seen, ['abcdef0123456789']);
    assert.deepEqual(r.curation.favorites, { [A]: true });
    assert.equal(r.touched.curation, true);
  });
  it('is refused without a replace function, with a short token, and when replace refuses', () => {
    assert.ok(run({ type: 'import-replace', token: 'abcdef0123456789' }).error);
    assert.ok(run({ type: 'import-replace', token: 'x' }, emptyCuration(), emptyCleanup(), { replace: () => ({ curation: emptyCuration() }) }).error);
    assert.match(run({ type: 'import-replace', token: 'abcdef0123456789' }, emptyCuration(), emptyCleanup(), { replace: () => ({ error: 'expired' }) }).error, /expired/);
  });
});

describe('normalizers and referencedIds', () => {
  it('normalizeCuration fills defaults and rejects wrong shapes', () => {
    assert.deepEqual(normalizeCuration({}), emptyCuration());
    assert.equal(normalizeCuration({ version: 'x' }), null);
    assert.equal(normalizeCuration({ overrides: { a: 5 } }), null);
    assert.equal(normalizeCuration({ overrides: { a: { tags: [1] } } }), null);
    assert.equal(normalizeCuration({ clusters: [{ id: 'cl-1', name: 'n', elementIds: [1] }] }), null);
    assert.deepEqual(normalizeCuration({ favorites: { a: true, b: false, c: 1 } }).favorites, { a: true });
  });
  it('normalizeCleanup rejects wrong shapes and drops dangerous keys', () => {
    assert.equal(normalizeCleanup(5), null);
    assert.equal(normalizeCleanup({ dismissed: [] }), null);
    assert.deepEqual(normalizeCleanup({ dismissed: { candidates: { __proto__: 'x', good: '2026' } } }).dismissed.candidates, { good: '2026' });
  });
  it('referencedIds collects every id the documents point at', () => {
    const cur = { ...emptyCuration(), clusters: [{ id: 'cl-1', name: 'n', elementIds: [A], createdAt: '', updatedAt: '' }], favorites: { [B]: true }, hidden: { [C]: true }, overrides: { 'imports-drop-png': { title: 't' } } };
    const cln = { ...emptyCleanup(), dismissed: { clusters: { 'x-1 x-2': 'iso' }, candidates: { 'x-3': 'iso' } } };
    assert.deepEqual([...referencedIds(cur, cln)].sort(), [A, B, C, 'imports-drop-png', 'x-1', 'x-2', 'x-3'].sort());
  });
});
