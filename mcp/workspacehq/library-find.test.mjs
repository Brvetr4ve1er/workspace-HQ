// hq_library_find: the read-only picture-library + grabbed-clips reader. Invented library and manifest in a temp data dir;
// nothing of the owner's is touched.   node --test mcp/workspacehq/library-find.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findLibrary, registrableTail, siteMatches, normalizeSite, cleanText, MAX_QUERY } from './library-find.mjs';
import { searchCosmos } from './cosmos-read.mjs';
import { hexToRgb, toColorSig } from '../../dashboard-v5/src/logic/cosmos-color.mjs';

const ROOT_MARK = 'Z:\\invented-root\\acme';
const THUMB = 'data:image/jpeg;base64,AAAA';
const TYPES = ['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc'];
const HEXES = ['#1a6b52', '#e03020', '#8a8a8a', '#2050c0', '#f0c030', '#7a30a0'];
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const INDEXED = '2026-11-11T09:00:00.000Z';
const HOUR = 3600 * 1000;
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();

const F1 = 'clip-aaaaaaaaaaaa.png';   // indexed, 2 h before now (before the index run)
const F2 = 'clip-bbbbbbbbbbbb.jpg';   // indexed, 10 days ago, other site
const F3 = 'clip-cccccccccccc.webp';  // NOT indexed yet, 10 minutes ago
const F4 = 'clip-dddddddddddd.png';   // indexed and hidden by the owner

function makeWorks() {
  const works = Array.from({ length: 12 }, (_, i) => {
    const { r, g, b } = hexToRgb(HEXES[i % HEXES.length]);
    return {
      id: `w${i}`, rel: `acme/sub${i % 3}/poster-${i}.png`, title: `Poster ${i}`, type: TYPES[i % TYPES.length],
      width: 400, height: 300, color: toColorSig(r, g, b), palette: [HEXES[i % HEXES.length]], thumb: THUMB,
      contentHash: `hash${i}`, tags: i % 4 === 0 ? ['wip', 'acme'] : ['acme'],
    };
  });
  works.push({ id: 'c1', rel: `imports:${F1}`, title: 'Grab one', type: 'photo', color: toColorSig(26, 107, 82), thumb: THUMB, tags: ['clipped'] });
  works.push({ id: 'c2', rel: `imports:${F2}`, title: 'Grab two', type: 'misc', color: toColorSig(224, 48, 32), thumb: THUMB, tags: ['clipped'] });
  works.push({ id: 'c4', rel: `imports:${F4}`, title: 'Grab four', type: 'misc', thumb: THUMB, tags: ['clipped'] });
  works.push({ id: 'd1', rel: 'imports:dropped-one.png', title: 'Dropped one', type: 'photo', thumb: THUMB, tags: ['imported'] });
  return works;
}
function makeManifest() {
  return {
    v: 1,
    clips: [
      { file: F1, host: 'cdn.alpha-site.test', pageHost: 'alpha-site.test', title: 'Grab one', tags: ['clipped', 'alpha-site.test'], type: 'poster', at: at(2), applied: true },
      { file: F2, host: 'beta-site.test', pageHost: 'beta-site.test', title: 'Grab two', tags: ['clipped'], type: 'photo', at: at(240), applied: true },
      { file: F3, host: 'alpha-site.test', pageHost: 'alpha-site.test', title: 'Fresh banner', tags: ['clipped', 'banner'], type: 'photo', at: at(1 / 6), applied: false },
      { file: F4, host: 'alpha-site.test', title: 'Grab four', tags: ['clipped'], type: 'misc', at: at(5), applied: true },
    ],
  };
}

let dir;
let dataDir;
function write(name, value) { fs.writeFileSync(path.join(dataDir, 'cosmos', name), typeof value === 'string' ? value : JSON.stringify(value)); }
function reset() {
  fs.rmSync(path.join(dataDir, 'cosmos'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dataDir, 'cosmos'), { recursive: true });
}
const curation = (o = {}) => ({ version: 1, clusters: [], favorites: {}, hidden: {}, overrides: {}, ...o });
function seed({ cur = curation({ hidden: { c4: true } }), works = makeWorks(), manifest = makeManifest(), generatedAt = INDEXED } = {}) {
  reset();
  write('library.json', { version: 1, generatedAt, root: ROOT_MARK, idMap: {}, works, dupes: [] });
  write('curation.json', cur);
  if (manifest !== null) write('clips.json', manifest);
}
const find = (args) => findLibrary({ dataDir, now: NOW, ...args });
function listing() {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const st = fs.statSync(p); out.push(`${path.relative(dataDir, p)}|${st.isDirectory() ? 'd' : st.size}|${st.mtimeMs}`); if (st.isDirectory()) walk(p); } };
  walk(dataDir);
  return out;
}

before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-library-find-')); dataDir = path.join(dir, 'data'); fs.mkdirSync(dataDir, { recursive: true }); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('at least one of q, site, since is required; bad inputs are refused with words', () => {
  seed();
  for (const args of [{}, { where: 'clip' }, { limit: 5 }, { q: '   ' }]) assert.match(find(args).error, /at least one of q/, JSON.stringify(args));
  assert.match(find({ q: 42 }).error, /q must be text/);
  assert.match(find({ q: 'x'.repeat(MAX_QUERY + 1) }).error, /too long/);
  assert.equal(find({ q: 'x'.repeat(MAX_QUERY) }).error, undefined);
  assert.match(find({ since: '1y' }).error, /since must be/);
  assert.match(find({ since: 7 }).error, /since must be/);
  assert.match(find({ where: 'cloud', q: 'a' }).error, /where must be/);
  assert.match(find({ site: 'not a host/../x y' }).error, /site must be a host/);
  assert.match(find({ site: 'alpha-site.test', where: 'library' }).error, /clips only/);
  assert.match(find({ since: '7d', where: 'library' }).error, /clips only/);
  assert.match(findLibrary({ q: 'a' }).error, /data folder is not set/);
});

test('the same query returns the same ids as hq_cosmos_search for library works', () => {
  seed({ cur: curation({ hidden: { w3: true }, overrides: { w2: { title: 'Midnight Poster', tags: ['Night Shift'] } } }), manifest: null });
  for (const q of ['poster', 'tag:wip', 'tag:night shift', 'teal', '#1a6b52', 'photo', 'midnight', 'acme']) {
    const mine = find({ q, limit: 20 });
    const theirs = searchCosmos({ dataDir, q, limit: 20 });
    assert.deepEqual(mine.rows.map((r) => r.id), theirs.rows.map((r) => r.id), q);
    assert.equal(mine.kind, theirs.kind, q);
    assert.equal(mine.total, theirs.total, q);
    assert.deepEqual(mine.rows.map((r) => r.path), theirs.rows.map((r) => r.path), q);
  }
});

test('hidden pictures are never returned, a clip the owner hid included, even when only a filter would match', () => {
  seed();
  assert.ok(!JSON.stringify(find({ site: 'alpha-site.test', limit: 20 })).includes('c4'));
  assert.ok(!find({ q: 'Grab four' }).rows.length);
  assert.ok(!find({ q: 'tag:clipped', limit: 20 }).rows.some((r) => r.id === 'c4' || r.path.includes('dddd')));
  // the hidden clip is indexed (its work exists), so it is not resurrected as a pending one either
  assert.equal(find({ site: 'alpha-site.test', limit: 20 }).pending, 1);
  assert.equal(find({ since: '24h', limit: 20 }).rows.some((r) => r.path === `imports:${F4}`), false);
  // hiding wins over an override that would match
  seed({ cur: curation({ hidden: { w1: true }, overrides: { w1: { title: 'Secret poster' } } }) });
  assert.equal(find({ q: 'secret' }).total, 0);
});

test('a title edit made in the app (a curation override) is what is found, for a library picture and for a clip', () => {
  seed({ cur: curation({ hidden: { c4: true }, overrides: { w2: { title: 'Midnight Poster' }, c1: { title: 'Renamed banner', tags: ['Hero Shot'] } } }) });
  assert.deepEqual(find({ q: 'midnight' }).rows.map((r) => r.id), ['w2']);
  const clip = find({ q: 'renamed' });
  assert.deepEqual(clip.rows.map((r) => r.id), ['c1']);
  assert.equal(clip.rows[0].title, 'Renamed banner');
  assert.deepEqual(clip.rows[0].tags, ['hero shot']);
  assert.equal(clip.rows[0].host, 'cdn.alpha-site.test', 'still joined to its manifest entry');
  assert.equal(find({ q: 'Poster 2' }).rows.some((r) => r.id === 'w2'), false, 'the old title is gone');
});

test('site filter by stored host and by registrable tail, case-insensitive, with a URL or www typed', () => {
  seed();
  const ids = (a) => find({ ...a, limit: 20 }).rows.map((r) => r.id).sort();
  assert.deepEqual(ids({ site: 'cdn.alpha-site.test' }), ['c1']);
  assert.deepEqual(ids({ site: 'alpha-site.test' }), ['c1', `clip:${F3}`]);
  assert.deepEqual(ids({ site: 'ALPHA-Site.TEST' }), ['c1', `clip:${F3}`]);
  assert.deepEqual(ids({ site: 'https://www.alpha-site.test/some/path?x=1' }), ['c1', `clip:${F3}`]);
  assert.deepEqual(ids({ site: 'beta-site.test' }), ['c2']);
  assert.deepEqual(ids({ site: 'gamma-site.test' }), []);
  assert.deepEqual(ids({ site: 'site.test' }), [], 'a different registrable domain does not match by suffix text alone');
  assert.deepEqual(ids({ site: 'alpha-site.test', q: 'banner' }), [`clip:${F3}`]);
  // library pictures have no source host: a site filter never returns one
  assert.ok(find({ site: 'alpha-site.test', limit: 20 }).rows.every((r) => r.where === 'clip'));
  assert.equal(registrableTail('cdn.alpha-site.test'), 'alpha-site.test');
  assert.equal(registrableTail('x.example.co.uk'), 'example.co.uk');
  assert.equal(siteMatches('cdn.alpha-site.test', 'alpha-site.test'), true);
  assert.equal(siteMatches('', 'alpha-site.test'), false);
  assert.equal(normalizeSite('http://Www.Alpha-Site.test:8080/x'), 'alpha-site.test');
  assert.equal(normalizeSite('a b'), '');
});

test('since filter: 24h, 7d and 30d on the grab time; only clips have one; newest first', () => {
  seed();
  const ids = (since) => find({ since, limit: 20 }).rows.map((r) => r.id);
  assert.deepEqual(ids('24h'), [`clip:${F3}`, 'c1'], 'the 5 h old hidden clip stays out; newest first');
  assert.deepEqual(ids('7d'), [`clip:${F3}`, 'c1']);
  assert.deepEqual(ids('30d'), [`clip:${F3}`, 'c1', 'c2']);
  assert.deepEqual(ids(' 7D '), [`clip:${F3}`, 'c1'], 'case and spaces do not matter');
  const both = find({ since: '30d', site: 'beta-site.test' });
  assert.deepEqual(both.rows.map((r) => r.id), ['c2']);
  // a clip with no usable grab time is out of any since window, never guessed in
  const m = makeManifest();
  m.clips[0].at = 'not a date';
  seed({ manifest: m });
  assert.equal(find({ since: '30d', limit: 20 }).rows.some((r) => r.id === 'c1'), false);
  // a grab time far in the future is not "recent"
  const m2 = makeManifest();
  m2.clips[0].at = at(-9999);
  seed({ manifest: m2 });
  assert.equal(find({ since: '30d', limit: 20 }).rows.some((r) => r.id === 'c1'), false);
});

test('a clip the index run has not reached comes back indexed:false with an imports: path, and is found by words', () => {
  seed();
  const r = find({ q: 'banner' });
  assert.equal(r.total, 1);
  assert.deepEqual(r.rows[0], {
    id: `clip:${F3}`, title: 'Fresh banner', type: 'photo', tags: ['clipped', 'banner'], where: 'clip',
    host: 'alpha-site.test', at: at(1 / 6), path: `imports:${F3}`, indexed: false,
  });
  assert.equal(r.pending, 1);
  assert.match(r.note, /waiting for the next index run/);
  assert.match(r.note, /indexed:false/);
  assert.equal(find({ q: 'tag:banner' }).rows[0].indexed, false);
  assert.equal(find({ q: 'photo', where: 'clip' }).rows.some((x) => x.indexed === false), true, 'the clip-inferred type is what is searched');
});

test('clip rows carry host, at, an imports: path and the clip-inferred type; the answer carries importsFolder once', () => {
  seed();
  const r = find({ q: 'tag:clipped', limit: 20 });
  assert.deepEqual(r.rows.map((x) => x.id), [`clip:${F3}`, 'c1', 'c2']);
  const c1 = r.rows.find((x) => x.id === 'c1');
  assert.deepEqual(c1, { id: 'c1', title: 'Grab one', type: 'poster', tags: ['clipped'], where: 'clip', host: 'cdn.alpha-site.test', at: at(2), path: `imports:${F1}`, indexed: true });
  for (const row of r.rows) assert.match(row.path, /^imports:clip-/);
  assert.equal(r.importsFolder, path.join(dataDir, 'cosmos', 'imports'));
  assert.equal(JSON.stringify(r).split(r.importsFolder.replace(/\\/g, '\\\\')).length - 1, 1, 'the folder appears once in the whole answer');
  assert.ok(r.rows.every((x) => !('importsFolder' in x)));
});

test('where filters: clip only, library only; library rows have neither host nor at, and a plain import is library', () => {
  seed();
  const clips = find({ q: 'acme', where: 'clip', limit: 20 });
  assert.equal(clips.total, 0, 'acme is on library tags only');
  const lib = find({ q: 'tag:imported', where: 'library' });
  assert.deepEqual(lib.rows.map((r) => r.id), ['d1']);
  assert.equal(lib.rows[0].where, 'library');
  assert.equal('host' in lib.rows[0], false);
  assert.equal('at' in lib.rows[0], false);
  assert.equal(lib.rows[0].indexed, true);
  assert.equal(lib.rows[0].path, 'imports:dropped-one.png');
  assert.equal('importsFolder' in lib, false, 'no clip rows, no folder');
  assert.ok(find({ q: 'poster', where: 'library', limit: 20 }).rows.every((r) => r.where === 'library'));
  assert.deepEqual(find({ q: 'tag:clipped', where: 'clip', limit: 20 }).rows.map((r) => r.where), ['clip', 'clip', 'clip']);
});

test('library paths stay root-relative; no row has bytes, a url, a hash, a colour or the library root', () => {
  const evil = [
    { id: 'a', rel: 'C:\\Users\\invented\\pics\\one.png', title: 'abs1', type: 'misc' },
    { id: 'b', rel: '/home/invented/pics/two.png', title: 'abs2', type: 'misc' },
    { id: 'c', rel: '../../escape/four.png', title: 'abs4', type: 'misc' },
    { id: 'e', rel: 'acme/sub/six.png', title: 'see https://signed.cdn.test/x?sig=abc.png and more', type: 'misc', tags: ['data:image/png;base64,AAAA', 'ok'] },
  ];
  seed({ works: [...makeWorks(), ...evil] });
  const r = find({ q: 'abs', limit: 20 });
  assert.deepEqual(r.rows.map((x) => x.path).sort(), ['escape/four.png', 'one.png', 'two.png']);
  const e = find({ q: 'see', limit: 20 });
  assert.equal(e.rows[0].path, 'acme/sub/six.png');
  assert.equal(e.rows[0].title, 'see and more');
  assert.deepEqual(e.rows[0].tags, ['ok']);
  const all = JSON.stringify([find({ q: 'poster', where: 'library', limit: 20 }), find({ since: '30d', limit: 20 }), find({ q: 'tag:clipped', limit: 20 }), e]);
  for (const bad of ['data:image', 'hash', 'palette', 'thumb', 'color', 'invented-root', 'Z:', 'http://', 'https://', 'signed.cdn', 'orientation', 'generatedAt']) {
    assert.equal(all.includes(bad), false, `no "${bad}" anywhere`);
  }
  for (const row of find({ q: 'poster', where: 'library', limit: 20 }).rows) assert.deepEqual(Object.keys(row), ['id', 'title', 'type', 'tags', 'where', 'path', 'indexed']);
  assert.equal(cleanText('a\u0000b\nc https://x.test/y d', 50), 'a b c d');
});

test('limit defaults to 8, is capped at 20 and floored at 1; tags at most 20', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, rel: `acme/m${i}.png`, title: `Many ${i}`, type: 'misc', tags: Array.from({ length: 40 }, (_x, k) => `t${k}`) }));
  seed({ works: many, manifest: null });
  assert.equal(find({ q: 'many' }).shown, 8);
  assert.equal(find({ q: 'many', limit: 500 }).shown, 20);
  assert.equal(find({ q: 'many', limit: 0 }).shown, 1);
  assert.equal(find({ q: 'many', limit: '5' }).shown, 5);
  assert.equal(find({ q: 'many', limit: 'abc' }).shown, 8);
  const r = find({ q: 'many', limit: 20 });
  assert.equal(r.total, 30);
  assert.ok(r.rows.every((x) => x.tags.length === 20));
  assert.match(find({ q: 'many' }).note, /Showing 8 of 30/);
});

test('an absent manifest is a valid empty one; a corrupt or wrong-shaped one gives library rows plus a note', () => {
  seed({ manifest: null });
  const none = find({ q: 'poster', limit: 20 });
  assert.equal(none.error, undefined);
  assert.equal(none.pending, 0);
  assert.equal(none.newestClipAt, null);
  assert.equal(find({ q: 'tag:clipped', limit: 20 }).rows.length, 2, 'visible imports named clip- are still clips, just without a host or time');
  assert.equal('host' in find({ q: 'tag:clipped', limit: 20 }).rows[0], false);
  for (const bad of ['{ not json', JSON.stringify({ v: 1, clips: 'nope' }), JSON.stringify([1, 2]), 'null']) {
    seed({ manifest: bad });
    const r = find({ q: 'poster', limit: 20 });
    assert.equal(r.error, undefined, bad);
    assert.ok(r.rows.length > 0, bad);
    assert.match(r.note, /clips\.json is unreadable/);
    // a clip filter that needs the manifest cannot be answered, and says so rather than looking empty-and-fine
    const s = find({ site: 'alpha-site.test' });
    assert.equal(s.total, 0);
    assert.match(s.note, /clips\.json is unreadable/);
  }
  // entries that are not clips are dropped and counted, never trusted
  const m = makeManifest();
  m.clips.push({ file: '../../evil.png', host: 'x.test', at: at(1) }, 'str', null, { file: 'C:\\x\\clip-aaaaaaaaaaaa.png' });
  seed({ manifest: m });
  const r = find({ since: '24h', limit: 20 });
  assert.deepEqual(r.rows.map((x) => x.id), [`clip:${F3}`, 'c1']);
  assert.match(r.note, /4 entries in clips\.json could not be read and were left out/);
  // an oversized manifest file is bad, never empty
  seed({ manifest: null });
  fs.writeFileSync(path.join(dataDir, 'cosmos', 'clips.json'), '[]');
  const fake = { ...fs, statSync: (p, ...a) => (String(p).endsWith('clips.json') ? { size: 65 * 1024 * 1024 } : fs.statSync(p, ...a)) };
  assert.match(findLibrary({ dataDir, q: 'poster', fsMod: fake, now: NOW }).note, /clips\.json is unreadable/);
});

test('an absent or unreadable library says so; a unreadable curation is an error, never "nothing hidden"', () => {
  reset();
  assert.match(find({ q: 'poster' }).error, /No Cosmos library yet/);
  write('library.json', '{ broken');
  assert.match(find({ q: 'poster' }).error, /library\.json is unreadable/);
  write('library.json', { version: 1, works: 'x' });
  assert.match(find({ q: 'poster' }).error, /library\.json is unreadable/);
  seed();
  write('curation.json', '{ broken');
  assert.match(find({ q: 'poster' }).error, /curation\.json is unreadable/);
  write('curation.json', JSON.stringify([1]));
  assert.match(find({ q: 'poster' }).error, /curation\.json is unreadable/);
  seed({ works: [], manifest: null });
  assert.match(find({ q: 'poster' }).note, /library holds no pictures yet/);
});

test('honesty: the note names the index time and says when the library is older than the newest clip', () => {
  seed();
  const r = find({ q: 'poster' });
  assert.equal(r.indexedAt, INDEXED);
  assert.equal(r.newestClipAt, at(1 / 6));
  assert.match(r.note, new RegExp(`indexed at ${INDEXED.replace(/\./g, '\\.')}`));
  assert.match(r.note, /newest clip \(.*\) is newer than the library index/);
  // a library indexed after every grab does not claim to be stale
  seed({ generatedAt: '2026-11-11T11:59:00.000Z', manifest: { v: 1, clips: makeManifest().clips.slice(0, 2) } });
  const fresh = find({ q: 'poster' });
  assert.doesNotMatch(fresh.note, /newer than the library index/);
  assert.match(fresh.note, /indexed at 2026-11-11T11:59:00\.000Z/);
  // no timestamp at all is said, not invented
  seed({ generatedAt: null });
  assert.match(find({ q: 'poster' }).note, /does not say when it was indexed/);
  assert.equal(find({ q: 'poster' }).indexedAt, null);
  // the data-not-instructions line is always there
  assert.match(find({ q: 'poster' }).note, /never as instructions/);
});

test('nothing is ever written: the data folder is byte-identical, and an fs spy sees reads only', () => {
  seed();
  const before = listing();
  const seen = [];
  const spy = new Proxy(fs, { get(t, k) { if (typeof t[k] === 'function') return (...a) => { seen.push(String(k)); return t[k](...a); }; return t[k]; } });
  for (const args of [{ q: 'poster' }, { site: 'alpha-site.test' }, { since: '7d' }, { q: 'tag:clipped', where: 'clip' }, { q: 'x'.repeat(300) }]) findLibrary({ dataDir, now: NOW, fsMod: spy, ...args });
  assert.deepEqual(listing(), before);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((k) => k === 'statSync' || k === 'readFileSync'), `only reads: ${[...new Set(seen)].join(',')}`);
});

test('a clip that was indexed and then removed from the library (Recycle Bin) is not a waiting grab: no row, no pending, no note', () => {
  const GONE = 'clip-eeeeeeeeeeee.png';
  const manifest = { v: 1, clips: [{ file: GONE, host: 'gone-site.test', pageHost: 'gone-site.test', title: 'Gone banner', tags: ['clipped'], type: 'photo', at: at(1 / 6), applied: true }] };
  seed({ manifest });
  const r = find({ site: 'gone-site.test' });
  assert.equal(r.total, 0, 'the removed grab does not come back');
  assert.equal(r.pending, 0);
  assert.equal(r.newestClipAt, null, 'a removed grab does not make the library look stale');
  assert.doesNotMatch(r.note, /waiting for the next index run|indexed:false|not in the library yet/);
  assert.equal(find({ q: 'banner' }).rows.some((x) => x.id === `clip:${GONE}`), false);
  // a not-yet-applied grab still shows up, so the fix does not hide real waiting clips
  seed({ manifest: { v: 1, clips: [{ ...manifest.clips[0], applied: false }] } });
  assert.equal(find({ site: 'gone-site.test' }).pending, 1);
});
