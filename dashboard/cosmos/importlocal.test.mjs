// Cosmos space — importing the old gallery (dashboard/cosmos/importlocal.mjs). Invented ids and paths only.
// The rules under test: the backup is validated and sanitised; the merge is a UNION where the existing entry
// wins and whatever it held back is counted (and kept, for "replace"); reconcileIds is the only code that may
// change an id, only when nothing refers to the minted one, and it reserves the old id forever.
//   node --test dashboard/cosmos/importlocal.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readBackup, mergeCuration, applyConflicts, seedManifest, reconcileIds, importReport, MAX_BACKUP_BYTES, MAX_MISSING_LISTED,
} from './importlocal.mjs';
import { emptyCuration } from './curation.mjs';
import { emptyIdMap, parseIdMap, assignIds, relFor, idFor } from './ids.mjs';

const envelope = (over = {}) => ({
  app: 'cosmos-local', version: 1, exportedAt: '2026-02-01T00:00:00.000Z',
  clusters: [{ id: 'cl-1', name: 'Moodboard', description: 'x', elementIds: ['a-1', 'a-2', 'a-1'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }],
  favorites: { 'a-1': true, 'a-2': false },
  hidden: { 'a-3': true },
  overrides: { 'a-1': { title: ' Hero ', tags: ['Brand', ' brand ', ''] } },
  ...over,
});
const read = (o) => readBackup(JSON.stringify(o));

describe('readBackup', () => {
  it('accepts the old envelope, sanitises it and ignores extra keys', () => {
    const r = read({ ...envelope(), extra: { whatever: 1 } });
    assert.deepEqual(r.backup.clusters, [{
      id: 'cl-1', name: 'Moodboard', description: 'x', elementIds: ['a-1', 'a-2'],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    }]);
    assert.deepEqual(r.backup.favorites, { 'a-1': true });
    assert.deepEqual(r.backup.hidden, { 'a-3': true });
    assert.deepEqual(r.backup.overrides, { 'a-1': { title: 'Hero', tags: ['brand'] } });
  });
  it('refuses the wrong app, the wrong version, clusters that are not an array, bad JSON and non-strings', () => {
    assert.match(read(envelope({ app: 'other' })).error, /not a Cosmos Local backup/);
    assert.match(read(envelope({ version: 2 })).error, /version/);
    assert.match(read(envelope({ clusters: {} })).error, /clusters/);
    assert.match(readBackup('{ nope').error, /not valid JSON/);
    assert.match(readBackup('[]').error, /not a Cosmos Local backup/);
    assert.ok(readBackup(undefined).error);
  });
  it('refuses 21 MB and accepts a text under the cap', () => {
    assert.equal(MAX_BACKUP_BYTES, 20 * 1024 * 1024);
    const big = JSON.stringify(envelope({ pad: 'x'.repeat(21 * 1024 * 1024) }));
    assert.match(readBackup(big).error, /too large/);
    assert.ok(read(envelope()).backup);
  });
  it('drops dangerous ids, unnamed and repeated clusters, and counts what it dropped', () => {
    const r = read(envelope({
      clusters: [
        { id: '__proto__', name: 'x', elementIds: [] }, { id: 'cl-2', name: '   ' }, { id: 'cl-3', name: 'ok', elementIds: ['__proto__', 'a-9'] },
        { id: 'cl-3', name: 'repeat' }, 'junk', null,
      ],
      favorites: { __proto__x: true, constructor: true },
      overrides: { prototype: { title: 'x' }, 'a-4': { title: 5, tags: 'no' } },
    }));
    assert.deepEqual(r.backup.clusters.map((c) => [c.id, c.elementIds]), [['cl-3', ['a-9']]]);
    assert.deepEqual(r.backup.favorites, { __proto__x: true });
    assert.deepEqual(r.backup.overrides, {});
    assert.ok(r.backup.dropped >= 5, String(r.backup.dropped));
  });
  it('fills missing cluster timestamps from exportedAt, then from the given now, never from a clock', () => {
    const noStamps = { clusters: [{ id: 'cl-1', name: 'n', elementIds: [] }] };
    assert.equal(read(envelope(noStamps)).backup.clusters[0].createdAt, '2026-02-01T00:00:00.000Z');
    const noExport = JSON.stringify(envelope({ ...noStamps, exportedAt: undefined }));
    assert.equal(readBackup(noExport, { nowIso: '2026-05-05T00:00:00.000Z' }).backup.clusters[0].createdAt, '2026-05-05T00:00:00.000Z');
    assert.equal(readBackup(noExport).backup.clusters[0].createdAt, '1970-01-01T00:00:00.000Z');
  });
  it('a smart cluster keeps its rule and has no members', () => {
    const r = read(envelope({ clusters: [{ id: 'cl-s', name: 'Smart', elementIds: ['a-1'], rule: { query: ' logo ', tags: ['Brand'] } }] }));
    assert.deepEqual(r.backup.clusters[0].rule, { query: 'logo', tags: ['brand'] });
    assert.deepEqual(r.backup.clusters[0].elementIds, []);
  });
});

describe('mergeCuration', () => {
  const backup = () => read(envelope()).backup;
  const ctx = (ids = ['a-1', 'a-2']) => ({ libraryIds: new Set(ids), idMap: emptyIdMap() });

  it('adds everything to an empty curation and reports the counters', () => {
    const { merged, report } = mergeCuration(emptyCuration(), backup(), ctx());
    assert.equal(merged.clusters.length, 1);
    assert.deepEqual(merged.favorites, { 'a-1': true });
    assert.deepEqual(merged.hidden, { 'a-3': true });
    assert.deepEqual(merged.overrides, { 'a-1': { title: 'Hero', tags: ['brand'] } });
    assert.deepEqual([report.clusters, report.favorites, report.hidden, report.overrides, report.conflicts], [1, 1, 1, 1, 0]);
    assert.deepEqual(report.missingIds, ['a-3']);
    assert.equal(report.missingCount, 1);
  });

  it('is a union: favourites and hidden add to what exists, and a re-import changes nothing', () => {
    const cur = { ...emptyCuration(), favorites: { 'z-9': true }, hidden: { 'z-8': true } };
    const first = mergeCuration(cur, backup(), ctx());
    assert.deepEqual(first.merged.favorites, { 'z-9': true, 'a-1': true });
    assert.deepEqual(first.merged.hidden, { 'z-8': true, 'a-3': true });
    const second = mergeCuration(first.merged, backup(), ctx());
    assert.deepEqual(second.merged, first.merged);
    assert.deepEqual([second.report.clusters, second.report.favorites, second.report.hidden, second.report.overrides, second.report.conflicts], [0, 0, 0, 0, 0]);
  });

  it('an existing override keeps its title and tags; what the backup would have changed is a conflict, not applied', () => {
    const cur = { ...emptyCuration(), overrides: { 'a-1': { title: 'Mine' } } };
    const { merged, report, conflictItems } = mergeCuration(cur, backup(), ctx());
    assert.equal(merged.overrides['a-1'].title, 'Mine');
    assert.deepEqual(merged.overrides['a-1'].tags, ['brand'], 'the field the owner had not set is taken');
    assert.equal(report.overrides, 1);
    assert.equal(report.conflicts, 1);
    assert.deepEqual(conflictItems.overrides, { 'a-1': { title: 'Hero' } });
  });

  it('an existing cluster id wins and counts as a conflict when the backup differs; an identical one is silent', () => {
    const mine = { id: 'cl-1', name: 'Renamed', elementIds: ['a-1'], createdAt: '', updatedAt: '' };
    const diff = mergeCuration({ ...emptyCuration(), clusters: [mine] }, backup(), ctx());
    assert.equal(diff.merged.clusters[0].name, 'Renamed');
    assert.equal(diff.report.conflicts, 1);
    assert.equal(diff.report.clusters, 0);
    assert.equal(diff.conflictItems.clusters[0].name, 'Moodboard');
    const same = { id: 'cl-1', name: 'Moodboard', description: 'x', elementIds: ['a-2', 'a-1'], createdAt: '', updatedAt: '' };
    assert.equal(mergeCuration({ ...emptyCuration(), clusters: [same] }, backup(), ctx()).report.conflicts, 0);
  });

  it('two clusters with the same name but different ids are both kept', () => {
    const cur = { ...emptyCuration(), clusters: [{ id: 'cl-other', name: 'Moodboard', elementIds: [], createdAt: '', updatedAt: '' }] };
    assert.equal(mergeCuration(cur, backup(), ctx()).merged.clusters.length, 2);
  });

  it('lists at most 200 missing ids and gives the true count', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `gone-${i}`);
    const b = read(envelope({ clusters: [], favorites: Object.fromEntries(ids.map((i) => [i, true])), hidden: {}, overrides: {} })).backup;
    const { report } = mergeCuration(emptyCuration(), b, ctx([]));
    assert.equal(MAX_MISSING_LISTED, 200);
    assert.equal(report.missingIds.length, 200);
    assert.equal(report.missingCount, 450);
  });

  it('ids that are retired reservations are dropped and counted, never imported', () => {
    const idMap = { version: 1, entries: [{ rel: 'retired:a-3', id: 'a-3' }] };
    const { merged, report } = mergeCuration(emptyCuration(), backup(), { libraryIds: new Set(['a-1', 'a-2']), idMap });
    assert.deepEqual(merged.hidden, {});
    assert.ok(report.dropped >= 1);
    assert.equal(report.missingCount, 0);
  });

  it('never mutates its inputs', () => {
    const cur = { ...emptyCuration(), favorites: { 'z-9': true } };
    const b = backup();
    const before = JSON.stringify([cur, b]);
    mergeCuration(cur, b, ctx());
    assert.equal(JSON.stringify([cur, b]), before);
  });

  it('applyConflicts replaces only what was held back', () => {
    const mine = { id: 'cl-1', name: 'Renamed', elementIds: ['a-1'], createdAt: '', updatedAt: '' };
    const cur = { ...emptyCuration(), clusters: [mine], overrides: { 'a-1': { title: 'Mine', tags: ['keep'] } } };
    const m = mergeCuration(cur, backup(), ctx());
    const r = applyConflicts(m.merged, m.conflictItems);
    assert.equal(r.curation.clusters[0].name, 'Moodboard');
    assert.equal(r.curation.overrides['a-1'].title, 'Hero');
    assert.deepEqual(r.curation.overrides['a-1'].tags, ['brand'], 'both held-back fields take the backup’s value');
    assert.equal(r.curation.favorites['z-none'], undefined, 'nothing else is touched');
    assert.deepEqual([r.clusters, r.overrides], [1, 1]);
    assert.equal(m.merged.clusters[0].name, 'Renamed', 'the input is untouched');
  });
});

describe('seedManifest', () => {
  const manifest = (works) => ({ version: 1, works });
  it('seeds like seedFromManifest and refuses a decoded path that carries a colon', () => {
    const r = seedManifest(manifest([
      { id: 'alpha-a-png', src: '/media/alpha/a.png' },
      { id: 'forged', src: '/media/imports%3Adrop.png' },
      { id: 'forged-2', src: '/media/retired%3Aabc' },
      { id: 'clip-x', src: '/clips/x.png' },
    ]));
    assert.deepEqual(r.map.entries, [{ rel: 'alpha/a.png', id: 'alpha-a-png' }]);
    assert.equal(r.seeded, 1);
    assert.deepEqual(r.skipped.map((s) => [s.id, s.reason]).sort(), [['clip-x', 'no-path'], ['forged', 'bad-path'], ['forged-2', 'bad-path']].sort());
  });
});

describe('reconcileIds', () => {
  const mapOf = (pairs) => ({ version: 1, entries: pairs.map(([rel, id]) => ({ rel, id })) });
  const worksOf = (map) => map.entries.map((e) => ({ id: e.id, rel: e.rel, thumb: `${e.id}.jpg` }));

  it('re-keys an unreferenced minted id to the manifest id and reserves the old one as retired:<id>', () => {
    const idMap = mapOf([['alpha/a.png', 'alpha-a-png'], ['alpha/b.png', 'alpha-b-png']]);
    const manifestMap = mapOf([['alpha/a.png', 'old-a'], ['alpha/b.png', 'alpha-b-png']]);
    const r = reconcileIds({ idMap, works: worksOf(idMap), manifestMap, referenced: new Set() });
    assert.equal(r.rekeyed, 1);
    assert.deepEqual(r.renames, [{ from: 'alpha-a-png', to: 'old-a' }]);
    assert.equal(idFor(r.idMap, 'alpha/a.png'), 'old-a');
    assert.equal(relFor(r.idMap, 'alpha-a-png'), 'retired:alpha-a-png');
    assert.deepEqual(r.works.map((w) => w.id), ['old-a', 'alpha-b-png']);
    assert.deepEqual(r.works.map((w) => w.thumb), ['old-a.jpg', 'alpha-b-png.jpg'], 'the thumb path follows the new id');
    assert.deepEqual(r.notMatched, []);
  });

  it('never touches a referenced minted id; it is listed in notMatched', () => {
    const idMap = mapOf([['alpha/a.png', 'alpha-a-png']]);
    const manifestMap = mapOf([['alpha/a.png', 'old-a']]);
    const r = reconcileIds({ idMap, works: worksOf(idMap), manifestMap, referenced: ['alpha-a-png'] });
    assert.equal(r.rekeyed, 0);
    assert.equal(idFor(r.idMap, 'alpha/a.png'), 'alpha-a-png');
    assert.deepEqual(r.notMatched, [{ rel: 'alpha/a.png', id: 'alpha-a-png', manifestId: 'old-a', reason: 'referenced' }]);
  });

  it('a manifest id already used by another path is a clash, listed and untouched (a swap is not guessed)', () => {
    const idMap = mapOf([['alpha/a.png', 'x'], ['alpha/b.png', 'y']]);
    const manifestMap = mapOf([['alpha/a.png', 'y'], ['alpha/b.png', 'x']]);
    const r = reconcileIds({ idMap, works: worksOf(idMap), manifestMap, referenced: new Set() });
    assert.equal(r.rekeyed, 0);
    assert.deepEqual(r.notMatched.map((n) => n.reason), ['id-in-use', 'id-in-use']);
    assert.deepEqual(r.idMap.entries, idMap.entries);
  });

  it('matches paths case-insensitively and ignores manifest paths that are not indexed', () => {
    const idMap = mapOf([['Alpha/A.png', 'alpha-a-png']]);
    const manifestMap = mapOf([['alpha/a.png', 'old-a'], ['alpha/zzz.png', 'old-z']]);
    const r = reconcileIds({ idMap, works: worksOf(idMap), manifestMap, referenced: new Set() });
    assert.equal(r.rekeyed, 1);
    assert.equal(r.idMap.entries.length, 2);
    assert.ok(!r.idMap.entries.some((e) => e.id === 'old-z'));
  });

  it('a retired:<id> entry round-trips parseIdMap unchanged and can never be minted again', () => {
    const idMap = mapOf([['alpha/a.png', 'alpha-a-png']]);
    const r = reconcileIds({ idMap, works: [], manifestMap: mapOf([['alpha/a.png', 'old-a']]), referenced: new Set() });
    const parsed = parseIdMap(JSON.parse(JSON.stringify(r.idMap)));
    assert.deepEqual(parsed.map.entries, r.idMap.entries);
    assert.equal(parsed.dropped, 0);
    const next = assignIds(r.idMap, [{ rel: 'alpha/a-png.png', mtimeMs: 5 }, { rel: 'alpha/A.PNG', mtimeMs: 4 }]);
    const ids = next.map.entries.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'no id is handed out twice');
    assert.equal(ids.filter((i) => i === 'alpha-a-png').length, 1, 'the retired id stays with its reservation');
    assert.equal(relFor(next.map, 'alpha-a-png'), 'retired:alpha-a-png');
  });

  it('never mutates its inputs and does nothing when the ids already agree', () => {
    const idMap = mapOf([['alpha/a.png', 'same']]);
    const works = worksOf(idMap);
    const before = JSON.stringify([idMap, works]);
    const r = reconcileIds({ idMap, works, manifestMap: mapOf([['alpha/a.png', 'same']]), referenced: new Set() });
    assert.equal(JSON.stringify([idMap, works]), before);
    assert.equal(r.rekeyed, 0);
    assert.deepEqual(r.idMap.entries, idMap.entries);
  });
});

describe('importReport', () => {
  const base = { clusters: 2, favorites: 1, hidden: 0, overrides: 3, missingCount: 0, seeded: 0, rekeyed: 0, notMatchedCount: 0, skippedCount: 0, conflicts: 0, manifest: 'used' };
  it('states the counters and the fixed cleanup line', () => {
    const t = importReport(base);
    assert.match(t, /Imported 2 clusters, 1 favourite, 0 hidden, 3 edits\./);
    assert.match(t, /Duplicate-cleanup dismissals are not in the old backup\./);
  });
  it('surfaces missing, seeded, re-keyed, skipped, conflicts and a missing manifest', () => {
    const t = importReport({ ...base, missingCount: 3, seeded: 5, rekeyed: 1, notMatchedCount: 2, skippedCount: 4, conflicts: 2, manifest: 'skipped' });
    for (const re of [/3 referenced files are not in the library/, /5 ids were taken over/, /1 indexed file was re-matched/, /2 could not be re-matched/, /4 manifest entries were skipped/, /2 entries differ/, /No manifest was chosen/]) assert.match(t, re);
    assert.match(importReport({ ...base, manifest: 'unreadable' }), /could not be read/);
  });
});
