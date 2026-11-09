// Cosmos live slice (live/cosmos-slice.mjs) against a fake window.hq.cosmos. Plain Node; placeholder data only.
//
//   node --test dashboard-v5/src/live/cosmos-slice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCosmosSlice, emptyCosmos, OFFLINE } from './cosmos-slice.mjs';

const work = (id, extra) => ({ id, rel: id + '.png', title: id, type: 'misc', width: 4, height: 3, ...(extra || {}) });
const curation = (extra) => ({ version: 1, clusters: [], favorites: {}, hidden: {}, overrides: {}, ...(extra || {}) });
const cleanup = () => ({ version: 1, dismissed: { clusters: {}, candidates: {} } });
const readAnswer = (works, extra) => ({ state: 'ready', config: { root: 'alpha-site', indexedAt: '2026-11-01T00:00:00.000Z' }, works, dupes: { exact: [], near: [], junk: [] }, curation: curation(), cleanup: cleanup(), rootOk: true, indexing: null, ...(extra || {}) });

function rig(cosmos, opts = {}) {
  const live = { cosmos: emptyCosmos() };
  const emits = [];
  const emit = () => emits.push(1);
  const hq = cosmos === null ? null : { cosmos };
  const slice = createCosmosSlice({ hq, live, emit, pull: opts.noPull ? undefined : (p, fn) => Promise.resolve(typeof p === 'function' ? p() : p).then(fn).finally(emit) });
  return { slice, live, emits, C: () => live.cosmos };
}

test('emptyCosmos is the contract shape: works null means not loaded', () => {
  const c = emptyCosmos();
  assert.deepEqual(Object.keys(c).sort(), ['_memo', 'cleanup', 'config', 'curation', 'dupes', 'error', 'indexing', 'loaded', 'report', 'revision', 'rootOk', 'state', 'summary', 'works'].sort());
  assert.equal(c.works, null);
  assert.equal(c.loaded, false);
  assert.equal(c.rootOk, true);
  assert.deepEqual(c.curation, { clusters: [], favorites: {}, hidden: {}, overrides: {} });
  assert.deepEqual(c.cleanup, { dismissed: { clusters: {}, candidates: {} } });
});

test('with hq.cosmos absent every function resolves {error} and nothing throws', async () => {
  for (const hq of [null, {}, { other: {} }]) {
    const slice = createCosmosSlice({ hq, live: { cosmos: emptyCosmos() }, emit() {} });
    const names = Object.keys(slice);
    assert.equal(names.length, 12);
    for (const n of names) {
      const r = await slice[n]();
      assert.deepEqual(r, { error: OFFLINE }, n);
    }
    assert.deepEqual(await slice.refreshCosmos(true), { error: OFFLINE });
    assert.deepEqual(await slice.applyCosmos({ type: 'favorite', id: 'a', on: true }), { error: OFFLINE });
    assert.deepEqual(await slice.trashCosmos(['a']), { error: OFFLINE });
    assert.deepEqual(await slice.importCosmosFiles(['x']), { error: OFFLINE });
  }
});

test('a missing method on an old preload group is the same honest error', async () => {
  const { slice } = rig({ read: async () => readAnswer([]) });
  assert.deepEqual(await slice.applyCosmos({ type: 'favorite' }), { error: OFFLINE });
  assert.deepEqual(await slice.revealCosmos('a'), { error: OFFLINE });
});

test('refresh stores the library: [] is loaded-and-empty, revision bumps', async () => {
  const { slice, C, emits } = rig({ read: async () => readAnswer([]) });
  assert.equal(C().works, null);
  await slice.refreshCosmos(false);
  assert.deepEqual(C().works, []);
  assert.equal(C().loaded, true);
  assert.equal(C().state, 'ready');
  assert.equal(C().config.root, 'alpha-site');
  assert.equal(C().revision, 1);
  assert.ok(emits.length >= 1);
});

test('refresh passes {force:true} only when forced, and coalesces concurrent unforced reads', async () => {
  const seen = [];
  const { slice } = rig({ read: async (o) => { seen.push(o); return readAnswer([work('a')]); } });
  const a = slice.refreshCosmos(false), b = slice.refreshCosmos(false);
  assert.equal(a, b);
  await a;
  await slice.refreshCosmos(true);
  assert.deepEqual(seen, [undefined, { force: true }]);
});

test('a read that comes back {error} keeps the previous works, curation and config', async () => {
  let answer = readAnswer([work('a'), work('b')], { curation: curation({ favorites: { a: true } }) });
  const { slice, C } = rig({ read: async () => answer });
  await slice.refreshCosmos(false);
  const rev = C().revision;
  answer = { error: 'could not read library.json' };
  const r = await slice.refreshCosmos(true);
  assert.equal(r.error, 'could not read library.json');
  assert.equal(C().error, 'could not read library.json');
  assert.deepEqual(C().works.map((w) => w.id), ['a', 'b']);
  assert.deepEqual(C().curation.favorites, { a: true });
  assert.equal(C().config.root, 'alpha-site');
  assert.equal(C().revision, rev);
  // the next good read clears the message
  answer = readAnswer([work('a')]);
  await slice.refreshCosmos(true);
  assert.equal(C().error, '');
  assert.deepEqual(C().works.map((w) => w.id), ['a']);
});

test('a first read that fails leaves works null (the error state, not an empty library)', async () => {
  const { slice, C } = rig({ read: async () => ({ error: 'disk unreadable' }) });
  await slice.refreshCosmos(false);
  assert.equal(C().works, null);
  assert.equal(C().error, 'disk unreadable');
  assert.equal(C().loaded, true);
});

test('a read that throws becomes the same recorded error, without a rejection', async () => {
  const { slice, C } = rig({ read: async () => { throw new Error('bridge died'); } });
  const r = await slice.refreshCosmos(false);
  assert.equal(r.error, 'bridge died');
  assert.equal(C().error, 'bridge died');
});

test('works without the store pull helper too', async () => {
  const { slice, C, emits } = rig({ read: async () => readAnswer([work('a')]) }, { noPull: true });
  await slice.refreshCosmos(false);
  assert.equal(C().works.length, 1);
  assert.ok(emits.length >= 1);
});

test('a half-written curation never reaches a render as undefined parts', async () => {
  const { slice, C } = rig({ read: async () => readAnswer([work('a')], { curation: { clusters: 'nope', favorites: null }, cleanup: {} }) });
  await slice.refreshCosmos(false);
  assert.deepEqual(C().curation.clusters, []);
  assert.deepEqual(C().curation.favorites, {});
  assert.deepEqual(C().curation.hidden, {});
  assert.deepEqual(C().curation.overrides, {});
  assert.deepEqual(C().cleanup.dismissed, { clusters: {}, candidates: {} });
});

test('apply swaps in answer.view and bumps the revision; the answer is returned as-is', async () => {
  const view = { curation: curation({ favorites: { a: true } }), cleanup: cleanup() };
  const answer = { view, note: 'Added to favourites.' };
  const { slice, C } = rig({ read: async () => readAnswer([work('a')]), apply: async () => answer });
  await slice.refreshCosmos(false);
  const rev = C().revision;
  const r = await slice.applyCosmos({ type: 'favorite', id: 'a', on: true });
  assert.equal(r, answer);
  assert.deepEqual(C().curation.favorites, { a: true });
  assert.equal(C().revision, rev + 1);
});

test('an {error} answer leaves state and revision untouched', async () => {
  const { slice, C } = rig({ read: async () => readAnswer([work('a')]), apply: async () => ({ error: 'That element is not in the library.' }) });
  await slice.refreshCosmos(false);
  const before = JSON.stringify(C().curation), rev = C().revision;
  const r = await slice.applyCosmos({ type: 'favorite', id: 'zz', on: true });
  assert.equal(r.error, 'That element is not in the library.');
  assert.equal(JSON.stringify(C().curation), before);
  assert.equal(C().revision, rev);
});

test('apply that throws resolves {error}, never rejects', async () => {
  const { slice } = rig({ apply: async () => { throw new Error('ipc closed'); } });
  assert.deepEqual(await slice.applyCosmos({ type: 'hide' }), { error: 'ipc closed' });
  const { slice: s2 } = rig({ apply: async () => undefined });
  assert.equal((await s2.applyCosmos({ type: 'hide' })).error, 'Cosmos gave no answer');
});

test('a read that began before a write answered cannot roll the curation back', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const { slice, C } = rig({
    read: async () => { n += 1; if (n === 2) await gate; return readAnswer([work('a')], { curation: curation() }); },
    apply: async () => ({ view: { curation: curation({ favorites: { a: true } }), cleanup: cleanup() }, note: 'x' }),
  });
  await slice.refreshCosmos(false);
  const slow = slice.refreshCosmos(true);           // started before the write
  await slice.applyCosmos({ type: 'favorite', id: 'a', on: true });
  release();
  await slow;
  assert.deepEqual(C().curation.favorites, { a: true });
});

test('a replace answer spends the report token', async () => {
  const { slice, C } = rig({ apply: async () => ({ view: { curation: curation(), cleanup: cleanup() }, note: 'Replaced.' }) });
  C().report = { clusters: 1, conflicts: 2, token: 'abcdef012345' };
  await slice.applyCosmos({ type: 'import-replace', token: 'abcdef012345' });
  assert.equal(C().report.token, null);
  assert.equal(C().report.replaced, true);
  assert.equal(C().report.clusters, 1);
});

test('progress pushes update indexing; done_all stores the summary, clears indexing and re-reads', async () => {
  let reads = 0;
  const { slice, C } = rig({ read: async (o) => { reads += 1; assert.deepEqual(o, { force: true }); return readAnswer([work('a'), work('b')]); } });
  slice.cosmosProgress({ phase: 'thumbs', done: 412, total: 1000 });
  assert.deepEqual(C().indexing, { phase: 'thumbs', done: 412, total: 1000 });
  assert.equal(reads, 0);
  const summary = { elements: 2, thumbs: 2, thumbsFailed: 0, unchanged: 0, minted: 2, seeded: 0, cancelled: false };
  await slice.cosmosProgress({ phase: 'done', done: 2, total: 2, done_all: true, summary });
  assert.deepEqual(C().summary, summary);
  assert.equal(C().indexing, null);
  assert.equal(reads, 1);
  assert.equal(C().works.length, 2);
});

test('a failed index keeps its message in the summary', async () => {
  const { slice, C } = rig({ read: async () => readAnswer([]) });
  await slice.cosmosProgress({ phase: 'error', done: 3, total: 9, done_all: true, error: 'not saved: disk full', summary: { elements: 0 } });
  assert.equal(C().summary.error, 'not saved: disk full');
  assert.equal(C().indexing, null);
});

test('garbage progress is ignored', () => {
  const { slice, C } = rig({ read: async () => readAnswer([]) });
  slice.cosmosProgress(null);
  slice.cosmosProgress('x');
  assert.equal(C().indexing, null);
});

test('watch subscribes once, forwards pushes, and stop calls the unsubscribe exactly once', async () => {
  let subs = 0, unsubs = 0, handler = null;
  const { slice, C } = rig({ read: async () => readAnswer([]), onProgress: (cb) => { subs += 1; handler = cb; return () => { unsubs += 1; }; } });
  assert.equal(slice.watchCosmos(), true);
  assert.equal(slice.watchCosmos(), true);
  assert.equal(subs, 1);
  handler({ phase: 'walk', done: 5, total: 50 });
  assert.deepEqual(C().indexing, { phase: 'walk', done: 5, total: 50 });
  slice.stopCosmos();
  slice.stopCosmos();
  assert.equal(unsubs, 1);
  // after a stop it can subscribe again
  slice.watchCosmos();
  assert.equal(subs, 2);
});

test('an onProgress that returns no function still stops cleanly', () => {
  const { slice } = rig({ onProgress: () => undefined });
  assert.equal(slice.watchCosmos(), true);
  assert.doesNotThrow(() => slice.stopCosmos());
});

test('index: accepted shows the banner at once; a refusal is main\'s answer as-is', async () => {
  const { slice, C } = rig({ index: async () => true });
  assert.equal(await slice.indexCosmos(), true);
  assert.deepEqual(C().indexing, { phase: 'walk', done: 0, total: 0 });
  const refusal = { ok: false, reason: 'no-root', message: 'Choose a folder to index first.' };
  const { slice: s2, C: C2 } = rig({ index: async () => refusal });
  assert.equal(await s2.indexCosmos(), refusal);
  assert.equal(C2().indexing, null);
});

test('pick folder and cancel index resolve main\'s answers untouched', async () => {
  const { slice } = rig({ pickFolder: async () => 'D:/alpha-site', cancelIndex: async () => true });
  assert.equal(await slice.pickCosmosFolder(), 'D:/alpha-site');
  assert.equal(await slice.cancelCosmosIndex(), true);
  const { slice: s2 } = rig({ pickFolder: async () => null });
  assert.equal(await s2.pickCosmosFolder(), null);
});

test('trash sends the ids exactly as given and drops an element only for ids main lists in trashed[]', async () => {
  const sent = [];
  const answer = { trashed: ['a'], failed: [{ id: 'b', message: 'locked' }] };
  const { slice, C } = rig({ read: async () => readAnswer([work('a'), work('b'), work('c')]), trash: async (ids) => { sent.push(ids); return answer; } });
  await slice.refreshCosmos(false);
  const ids = ['a', 'b'];
  const r = await slice.trashCosmos(ids);
  assert.equal(sent[0], ids);
  assert.equal(r, answer);
  assert.deepEqual(C().works.map((w) => w.id), ['b', 'c']);
});

test('a trash that fails everywhere keeps every element and the revision', async () => {
  const { slice, C } = rig({ read: async () => readAnswer([work('a')]), trash: async () => ({ trashed: [], failed: [{ id: 'a', message: 'Only files you dropped into Cosmos can be moved to the Recycle Bin from here yet' }] }) });
  await slice.refreshCosmos(false);
  const rev = C().revision;
  await slice.trashCosmos(['a']);
  assert.equal(C().works.length, 1);
  assert.equal(C().revision, rev);
});

test('reveal and import-files pass ids and paths through exactly, never inventing one', async () => {
  const calls = [];
  const { slice, C } = rig({
    reveal: async (id) => { calls.push(['reveal', id]); return true; },
    importFiles: async (paths) => { calls.push(['import', paths]); return { imported: 2, skipped: [] }; },
  });
  assert.equal(await slice.revealCosmos('alpha-1'), true);
  const paths = ['C:/drop/one.png', 'C:/drop/two.png'];
  const r = await slice.importCosmosFiles(paths);
  assert.deepEqual(r, { imported: 2, skipped: [] });
  assert.equal(calls[0][1], 'alpha-1');
  assert.equal(calls[1][1], paths);
  // main starts an index after a copy: the banner shows before the first push
  assert.deepEqual(C().indexing, { phase: 'walk', done: 0, total: 0 });
});

test('import from the old gallery keeps the report and re-reads; a refusal stores nothing', async () => {
  let reads = 0;
  const report = { clusters: 2, favorites: 3, hidden: 0, overrides: 1, found: 4, missingIds: ['gone-1'], missingCount: 1, conflicts: 0, token: null, note: 'Imported 2 clusters.' };
  const { slice, C } = rig({ read: async () => { reads += 1; return readAnswer([work('a')]); }, importFromLocal: async () => report });
  const r = await slice.importCosmosLocal();
  assert.equal(r, report);
  assert.equal(C().report, report);
  assert.equal(reads, 1);
  const refusal = { ok: false, reason: 'canceled', message: 'Import canceled.' };
  const { slice: s2, C: C2 } = rig({ importFromLocal: async () => refusal });
  assert.equal(await s2.importCosmosLocal(), refusal);
  assert.equal(C2().report, null);
});
