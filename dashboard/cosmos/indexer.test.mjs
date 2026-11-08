// Cosmos space — the indexer (dashboard/cosmos/indexer.mjs) over a FAKE file system. Placeholder names only
// (alpha-site/, beta/), synthetic header bytes, fake thumbnails. No real file is read or written.
//   node --test dashboard/cosmos/indexer.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runIndex, MAX_HASH_BYTES, THUMB_EDGE } from './indexer.mjs';
import { slug } from './infer.mjs';

const ROOT = '/pics';
const IMPORTS = '/imports';

// ---- synthetic file headers (same builders as imagesize.test.mjs, trimmed) ----
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const png = (w, h) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0], be32(0));
const seg = (marker, body) => bytes([0xff, marker], be16(body.length + 2), body);
const exif = (orientation) => seg(0xe1, bytes('Exif\0\0', bytes('II', le16(42), le32(8), le16(1), le16(0x0112), le16(3), le32(1), le16(orientation), le16(0), le32(0))));
const jpeg = (w, h, orientation) => bytes([0xff, 0xd8], orientation ? exif(orientation) : [], seg(0xc0, bytes([8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])), [0xff, 0xda, 0, 2], [0xff, 0xd9]);
const garbage = () => bytes('not a picture header at all');

const solid = (r, g, b) => ({ width: 8, height: 8, data: Uint8Array.from({ length: 256 }, (_, i) => [r, g, b, 255][i % 4]) });
/** a pseudo-random 9x8 grid per name, so unrelated files never look like near duplicates */
function grayFor(name) {
  let s = 2166136261;
  for (const ch of name) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Uint8Array.from({ length: 72 }, () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 255; });
}

/**
 * A fake world. specs: [{ rel, size?, mtimeMs?, head?, thumb?, delay? }]
 *   head   Uint8Array header (default: png 400 x 300); ignored for videos
 *   thumb  undefined = a normal result | null = no thumbnail | 'throw' | an object merged over the default
 */
function makeWorld(specs, { rootDir = ROOT } = {}) {
  const w = {
    files: new Map(), thumbs: new Map(), clock: 5_000_000,
    calls: { thumbnail: [], hash: [], head: [], write: [], readdir: [] }, inFlight: 0, maxInFlight: 0,
  };
  const set = (spec) => w.files.set(`${spec.dir || rootDir}/${spec.rel}`, { size: 100, mtimeMs: 1000, ...spec });
  specs.forEach(set);
  w.set = set;
  w.remove = (rel) => w.files.delete(`${rootDir}/${rel}`);
  w.get = (rel) => w.files.get(`${rootDir}/${rel}`);
  w.io = {
    async readdir(dir) {
      w.calls.readdir.push(dir);
      const seen = new Map();
      for (const abs of w.files.keys()) {
        if (!abs.startsWith(`${dir}/`)) continue;
        const rest = abs.slice(dir.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) seen.set(rest, { name: rest, isDir: false, isFile: true, isSymlink: false });
        else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), isDir: true, isFile: false, isSymlink: false });
      }
      if (seen.size === 0 && dir !== rootDir && dir !== IMPORTS) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return [...seen.values()];
    },
    async stat(abs) {
      const f = w.files.get(abs);
      if (!f) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { size: f.size, mtimeMs: f.mtimeMs, birthtimeMs: f.birthtimeMs ?? f.mtimeMs - 10 };
    },
    async readHead(abs, n) {
      w.calls.head.push({ abs, n });
      const f = w.files.get(abs);
      if (!f || f.vanishAfterWalk) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return f.head || png(400, 300);
    },
    async hashFile(abs) {
      w.calls.hash.push(abs);
      const f = w.files.get(abs);
      if (!f) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return f.hash || `sha-of-${abs}`;
    },
    async thumbnail(abs, opts) {
      w.calls.thumbnail.push({ abs, ...opts });
      w.inFlight += 1;
      w.maxInFlight = Math.max(w.maxInFlight, w.inFlight);
      try {
        const f = w.files.get(abs);
        if (f && f.delay) await new Promise((r) => setTimeout(r, f.delay));
        else await Promise.resolve();
        if (!f || f.vanishAfterWalk) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        if (f.thumb === null) return null;
        if (f.thumb === 'throw') throw new Error('decoder blew up');
        return {
          jpeg: Buffer.from(`jpeg:${abs}`), width: 560, height: 315, sourceWidth: null, sourceHeight: null,
          rgba32: solid(200, 30, 30), gray9x8: grayFor(abs), ...(f.thumb || {}),
        };
      } finally {
        w.inFlight -= 1;
      }
    },
    async thumbInfo(id) {
      return w.thumbs.has(id) ? { mtimeMs: w.thumbs.get(id) } : null;
    },
    async writeThumb(id, buf) {
      w.calls.write.push({ id, size: buf.length });
      w.thumbs.set(id, w.clock);
    },
  };
  return w;
}

const run = (w, extra = {}) => runIndex({ roots: [{ prefix: '', dir: ROOT }], rootLabel: 'test-root', io: w.io, now: () => Date.UTC(2026, 10, 8), ...extra });
const idOf = (lib, rel) => lib.works.find((x) => x.rel === rel)?.id;

describe('ids and the sticky rule', () => {
  it('a first run assigns ids newest first, and writes the contract fields', async () => {
    // both slug to "x-png": the newer file takes the bare id
    const w = makeWorld([{ rel: 'a-x.png', mtimeMs: 1000 }, { rel: 'a/x.png', mtimeMs: 2000 }]);
    const { library, stats } = await run(w);
    assert.equal(idOf(library, 'a/x.png'), 'a-x-png');
    assert.equal(idOf(library, 'a-x.png'), 'a-x-png-x');
    assert.equal(stats.minted, 2);
    assert.deepEqual(library.works.map((x) => x.rel), ['a/x.png', 'a-x.png']);      // newest first
    assert.equal(library.version, 1);
    assert.equal(library.root, 'test-root');
    assert.equal(library.generatedAt, '2026-11-08T00:00:00.000Z');
    assert.deepEqual(library.idMap.entries.map((e) => e.id).sort(), ['a-x-png', 'a-x-png-x']);

    const row = library.works[0];
    assert.deepEqual(Object.keys(row), [
      'id', 'rel', 'title', 'type', 'width', 'height', 'orientation', 'color', 'palette', 'thumb', 'video',
      'contentHash', 'perceptualHash', 'tags', 'createdAt', 'size', 'mtimeMs',
    ]);
    assert.equal(row.title, 'X');
    assert.equal(row.thumb, 'thumbs/a-x-png.jpg');
    assert.equal(row.color.hex, '#c81e1e');
    assert.deepEqual(row.palette, ['#c81e1e']);
    assert.match(row.perceptualHash, /^[0-9a-f]{16}$/);
    assert.deepEqual(row.tags, ['a']);
    assert.equal(row.createdAt, new Date(2000 - 10).toISOString());
    assert.equal(row.size, 100);
    assert.equal(row.mtimeMs, 2000);
    assert.equal('approx' in row, false);
    assert.deepEqual(JSON.parse(JSON.stringify(library)), library);                 // plain JSON all the way
  });

  it('THE STICKY RULE: a newer file with an older curated file\'s slug cannot take its id', async () => {
    const w = makeWorld([{ rel: 'alpha-site/hero.png', mtimeMs: 1000 }]);
    const first = await run(w);
    assert.equal(idOf(first.library, 'alpha-site/hero.png'), 'alpha-site-hero-png');
    // a NEWER file whose slug is identical to the curated one's
    w.set({ rel: 'alpha-site-hero.png', mtimeMs: 9000 });
    const second = await run(w, { oldLibrary: first.library });
    assert.equal(idOf(second.library, 'alpha-site/hero.png'), 'alpha-site-hero-png');       // the older keeps the bare id
    assert.equal(idOf(second.library, 'alpha-site-hero.png'), 'alpha-site-hero-png-x');     // the newer gets -x
    assert.equal(second.stats.minted, 1);
    // and again: still stable
    const third = await run(w, { oldLibrary: second.library });
    assert.deepEqual(third.library.idMap, second.library.idMap);
  });

  it('a deleted file leaves works[] but its idMap entry stays, and its id is never handed to another file', async () => {
    const w = makeWorld([{ rel: 'beta/gone.png', mtimeMs: 1000 }, { rel: 'beta/stay.png', mtimeMs: 2000 }]);
    const first = await run(w);
    w.remove('beta/gone.png');
    const second = await run(w, { oldLibrary: first.library });
    assert.deepEqual(second.library.works.map((x) => x.rel), ['beta/stay.png']);
    assert.ok(second.library.idMap.entries.some((e) => e.rel === 'beta/gone.png' && e.id === 'beta-gone-png'));
    // a brand new file with the same path-slug gets -x, not the dead file's id
    w.set({ rel: 'beta-gone.png', mtimeMs: 3000 });
    const third = await run(w, { oldLibrary: second.library });
    assert.equal(idOf(third.library, 'beta-gone.png'), 'beta-gone-png-x');
  });

  it('a manifest on a first run seeds ids (they win over slugs) and reports seeded / skipped', async () => {
    const w = makeWorld([{ rel: 'alpha-site/Hero Shot.png', mtimeMs: 1000 }, { rel: 'beta/new.png', mtimeMs: 2000 }]);
    const manifest = { version: 1, works: [
      { id: 'legacy-hero', src: '/media/alpha-site/Hero%20Shot.png' },
      { id: 'legacy-clip', src: 'blob:something' },
    ] };
    const { library, stats } = await run(w, { manifest });
    assert.equal(idOf(library, 'alpha-site/Hero Shot.png'), 'legacy-hero');
    assert.equal(idOf(library, 'beta/new.png'), 'beta-new-png');
    assert.equal(stats.seeded, 1);
    assert.equal(stats.seedSkipped, 1);
    assert.equal(stats.minted, 1);
  });

  it('a manifest is ignored when an old idMap exists', async () => {
    const w = makeWorld([{ rel: 'alpha-site/hero.png', mtimeMs: 1000 }]);
    const first = await run(w);
    const manifest = { works: [{ id: 'legacy-hero', src: '/media/alpha-site/hero.png' }] };
    const second = await run(w, { oldLibrary: first.library, manifest });
    assert.equal(idOf(second.library, 'alpha-site/hero.png'), 'alpha-site-hero-png');
    assert.equal(second.stats.seeded, 0);
    // an old library WITHOUT an idMap counts as a first run
    const third = await run(w, { oldLibrary: { version: 1, works: [] }, manifest });
    assert.equal(idOf(third.library, 'alpha-site/hero.png'), 'legacy-hero');
    assert.equal(third.stats.seeded, 1);
  });

  it('the imports root gets imports:<name> paths, a clean title and no folder tags', async () => {
    const w = makeWorld([{ rel: 'alpha-site/a.png', mtimeMs: 1000 }, { dir: IMPORTS, rel: 'Copied_Item.png', mtimeMs: 2000 }]);
    const { library } = await runIndex({
      roots: [{ prefix: '', dir: ROOT }, { prefix: 'imports:', dir: IMPORTS }], rootLabel: 'r', io: w.io, now: () => 0,
    });
    const imp = library.works.find((x) => x.rel === 'imports:Copied_Item.png');
    assert.equal(imp.id, 'imports-copied-item-png');
    assert.equal(imp.title, 'COPIED ITEM');
    assert.deepEqual(imp.tags, []);
  });
});

describe('thumbs and carry-over', () => {
  it('a second run with nothing changed calls thumbnail 0 times and returns equal works', async () => {
    const w = makeWorld([{ rel: 'alpha-site/a.png', mtimeMs: 1000 }, { rel: 'beta/b.png', mtimeMs: 2000 }, { rel: 'beta/c.png', mtimeMs: 3000, size: 100 }]);
    const first = await run(w);
    assert.equal(w.calls.thumbnail.length, 3);
    w.calls.thumbnail.length = 0;
    w.calls.write.length = 0;
    w.calls.head.length = 0;
    w.calls.hash.length = 0;
    const second = await run(w, { oldLibrary: first.library });
    assert.equal(w.calls.thumbnail.length, 0);
    assert.equal(w.calls.write.length, 0);
    assert.equal(w.calls.head.length, 0);
    assert.equal(w.calls.hash.length, 0);                            // carried hashes are reused too
    assert.deepEqual(second.library.works, first.library.works);
    assert.deepEqual(second.library.dupes, first.library.dupes);
    assert.equal(second.stats.unchanged, 3);
    assert.equal(second.stats.indexed, 0);
    assert.equal(second.stats.thumbsOk, 0);
  });

  it('a changed mtime rethumbs that file only and keeps its id', async () => {
    const w = makeWorld([{ rel: 'beta/a.png', mtimeMs: 1000 }, { rel: 'beta/b.png', mtimeMs: 2000 }]);
    const first = await run(w);
    w.get('beta/a.png').mtimeMs = 5000;
    w.calls.thumbnail.length = 0;
    const second = await run(w, { oldLibrary: first.library });
    assert.deepEqual(w.calls.thumbnail.map((c) => c.abs), [`${ROOT}/beta/a.png`]);
    assert.equal(idOf(second.library, 'beta/a.png'), idOf(first.library, 'beta/a.png'));
    assert.equal(second.library.works[0].rel, 'beta/a.png');                 // now the newest
    assert.equal(second.library.works[0].mtimeMs, 5000);
    assert.equal(second.stats.unchanged, 1);
    assert.equal(second.stats.indexed, 1);
  });

  it('a changed size rethumbs; a missing or older thumbnail file rethumbs too', async () => {
    const w = makeWorld([{ rel: 'beta/a.png' }, { rel: 'beta/b.png', mtimeMs: 2000 }, { rel: 'beta/c.png', mtimeMs: 3000 }]);
    const first = await run(w);
    w.get('beta/a.png').size = 222;
    w.thumbs.delete(idOf(first.library, 'beta/b.png'));                        // thumbnail file gone
    w.thumbs.set(idOf(first.library, 'beta/c.png'), 100);                      // older than the source
    w.calls.thumbnail.length = 0;
    await run(w, { oldLibrary: first.library });
    assert.deepEqual(w.calls.thumbnail.map((c) => c.abs).sort(), ['beta/a.png', 'beta/b.png', 'beta/c.png'].map((r) => `${ROOT}/${r}`));
  });

  it('asks the thumbnailer for a 560 px edge and passes ext, kind and size', async () => {
    const w = makeWorld([{ rel: 'a/Photo.JPG', size: 4321 }]);
    await run(w);
    assert.equal(THUMB_EDGE, 560);
    assert.deepEqual(w.calls.thumbnail[0], { abs: `${ROOT}/a/Photo.JPG`, ext: '.jpg', kind: 'image', edge: 560, size: 4321 });
    assert.equal(w.calls.head[0].n, 262144);
  });

  it('thumbnail null gives thumb:null, 1:1 and approx:true when there is no header either', async () => {
    const w = makeWorld([{ rel: 'a/none.webp', head: garbage(), thumb: null }]);
    const { library, stats } = await run(w);
    const row = library.works[0];
    assert.equal(row.thumb, null);
    assert.equal(row.width, 1);
    assert.equal(row.height, 1);
    assert.equal(row.orientation, 'square');
    assert.equal(row.approx, true);
    assert.equal(row.color, null);
    assert.deepEqual(row.palette, []);
    assert.equal(row.perceptualHash, null);
    assert.equal(stats.thumbsFailed, 1);
    assert.deepEqual(stats.byExt, { '.webp': { ok: 0, failed: 1 } });
    assert.equal(w.calls.write.length, 0);
  });

  it('size sources: header beats sourceWidth/Height beats the thumbnail\'s own ratio (approx)', async () => {
    const w = makeWorld([
      { rel: 'a/header.png', head: png(400, 300), thumb: { sourceWidth: 800, sourceHeight: 600 }, mtimeMs: 4 },
      { rel: 'a/source.webp', head: garbage(), thumb: { sourceWidth: 800, sourceHeight: 600 }, mtimeMs: 3 },
      { rel: 'a/guess.webp', head: garbage(), thumb: { width: 560, height: 280 }, mtimeMs: 2 },
      { rel: 'a/header-nothumb.png', head: png(300, 400), thumb: null, mtimeMs: 1 },
    ]);
    const { library } = await run(w);
    const by = (rel) => library.works.find((x) => x.rel === rel);
    assert.deepEqual([by('a/header.png').width, by('a/header.png').height, by('a/header.png').approx], [400, 300, undefined]);
    assert.deepEqual([by('a/source.webp').width, by('a/source.webp').height, by('a/source.webp').approx], [800, 600, undefined]);
    const g = by('a/guess.webp');
    assert.deepEqual([g.width, g.height, g.approx, g.orientation], [560, 280, true, 'landscape']);
    const n = by('a/header-nothumb.png');
    assert.deepEqual([n.width, n.height, n.approx, n.thumb, n.orientation], [300, 400, undefined, null, 'portrait']);
  });

  it('EXIF orientation 6 swaps the stored size to portrait', async () => {
    const w = makeWorld([{ rel: 'a/phone.jpg', head: jpeg(4000, 3000, 6) }, { rel: 'a/plain.jpg', head: jpeg(4000, 3000), mtimeMs: 5 }]);
    const { library } = await run(w);
    const phone = library.works.find((x) => x.rel === 'a/phone.jpg');
    assert.deepEqual([phone.width, phone.height, phone.orientation], [3000, 4000, 'portrait']);
    const plain = library.works.find((x) => x.rel === 'a/plain.jpg');
    assert.deepEqual([plain.width, plain.height, plain.orientation], [4000, 3000, 'landscape']);
  });

  it('a video is flagged, typed motion, and its header is never read', async () => {
    const w = makeWorld([{ rel: 'beta/clip.mp4', thumb: { sourceWidth: 1920, sourceHeight: 1080 } }, { rel: 'beta/still.png', mtimeMs: 5 }]);
    const { library } = await run(w);
    const v = library.works.find((x) => x.rel === 'beta/clip.mp4');
    assert.equal(v.video, true);
    assert.equal(v.type, 'motion');
    assert.deepEqual([v.width, v.height], [1920, 1080]);
    assert.deepEqual(w.calls.head.map((c) => c.abs), [`${ROOT}/beta/still.png`]);
    assert.equal(library.works.find((x) => x.rel === 'beta/still.png').video, false);
    assert.equal(w.calls.thumbnail.find((c) => c.abs.endsWith('clip.mp4')).kind, 'video');
  });

  it('title, type and tags come from the path (folder names normalised, empty dropped, deduped)', async () => {
    const w = makeWorld([{ rel: 'alpha-site/UI  Kit/screen_one-final.png' }]);
    const { library } = await run(w);
    const row = library.works[0];
    assert.equal(row.title, 'SCREEN ONE FINAL');
    assert.equal(row.type, 'ui');
    assert.deepEqual(row.tags, ['alpha-site', 'ui kit']);
  });

  it('a throwing thumbnail does not abort the run and counts in byExt; a write failure is a failed thumb', async () => {
    const w = makeWorld([
      { rel: 'a/ok.png', mtimeMs: 3 }, { rel: 'a/bad.png', thumb: 'throw', mtimeMs: 2 }, { rel: 'a/also-ok.webp', mtimeMs: 1 },
    ]);
    const { library, stats } = await run(w);
    assert.equal(library.works.length, 3);
    assert.equal(library.works.find((x) => x.rel === 'a/bad.png').thumb, null);
    assert.deepEqual(stats.byExt, { '.png': { ok: 1, failed: 1 }, '.webp': { ok: 1, failed: 0 } });
    assert.equal(stats.thumbsOk, 2);
    assert.equal(stats.thumbsFailed, 1);

    const w2 = makeWorld([{ rel: 'a/x.png' }]);
    w2.io.writeThumb = async () => { throw new Error('disk full'); };
    const r2 = await run(w2);
    assert.equal(r2.library.works[0].thumb, null);
    assert.equal(r2.library.works[0].color.hex, '#c81e1e');           // the pixels were still read
    assert.equal(r2.stats.thumbsFailed, 1);
  });

  it('a file that vanished after the walk is dropped silently', async () => {
    const w = makeWorld([{ rel: 'a/here.png', mtimeMs: 2 }, { rel: 'a/vanished.png', mtimeMs: 1, vanishAfterWalk: true }]);
    const { library, stats } = await run(w);
    assert.deepEqual(library.works.map((x) => x.rel), ['a/here.png']);
    assert.equal(stats.vanished, 1);
    assert.equal(stats.files, 2);
  });

  it('never writes under the pictures root: the only write is writeThumb(id, bytes)', async () => {
    const w = makeWorld([{ rel: 'alpha-site/a.png' }, { rel: 'beta/b.png', size: 100 }]);
    const writes = [];
    const spy = new Proxy(w.io, {
      get(target, key) {
        const v = target[key];
        if (typeof v !== 'function') return v;
        return (...args) => { if (!['readdir', 'stat', 'readHead', 'hashFile', 'thumbnail', 'thumbInfo'].includes(key)) writes.push({ key, args }); return v(...args); };
      },
    });
    await run({ ...w, io: spy });
    assert.ok(writes.length > 0);
    assert.ok(writes.every((c) => c.key === 'writeThumb'));
    assert.ok(writes.every(({ args }) => args.every((a) => typeof a !== 'string' || (!a.startsWith(ROOT) && !a.includes('/')))));
    assert.deepEqual(Object.keys(w.io).sort(), ['hashFile', 'readHead', 'readdir', 'stat', 'thumbInfo', 'thumbnail', 'writeThumb']);
  });
});

describe('hashes', () => {
  it('hashes only files whose byte size equals another file\'s size', async () => {
    const w = makeWorld([
      { rel: 'a/one.png', size: 100, mtimeMs: 4 }, { rel: 'b/two.png', size: 100, mtimeMs: 3, hash: 'same' },
      { rel: 'a/solo.png', size: 777, mtimeMs: 2 }, { rel: 'a/solo2.png', size: 778, mtimeMs: 1 },
    ]);
    w.get('a/one.png').hash = 'same';
    const { library, stats } = await run(w);
    assert.deepEqual(w.calls.hash.sort(), [`${ROOT}/a/one.png`, `${ROOT}/b/two.png`]);
    assert.equal(stats.hashed, 2);
    const by = (rel) => library.works.find((x) => x.rel === rel);
    assert.equal(by('a/one.png').contentHash, 'same');
    assert.equal(by('a/solo.png').contentHash, null);
    // the equal hash makes an exact cluster
    assert.equal(library.dupes.exact.length, 1);
    assert.deepEqual(library.dupes.exact[0].ids.slice().sort(), ['a-one-png', 'b-two-png']);
  });

  it('does not hash above 512 MB, and counts what it left out', async () => {
    assert.equal(MAX_HASH_BYTES, 512 * 1024 * 1024);
    const big = MAX_HASH_BYTES + 1;
    const w = makeWorld([
      { rel: 'a/big1.png', size: big, mtimeMs: 4 }, { rel: 'a/big2.png', size: big, mtimeMs: 3 },
      { rel: 'a/edge1.png', size: MAX_HASH_BYTES, mtimeMs: 2 }, { rel: 'a/edge2.png', size: MAX_HASH_BYTES, mtimeMs: 1 },
    ]);
    const { library, stats } = await run(w);
    assert.deepEqual(w.calls.hash.sort(), [`${ROOT}/a/edge1.png`, `${ROOT}/a/edge2.png`]);
    assert.equal(stats.tooLarge, 2);
    assert.equal(library.works.find((x) => x.rel === 'a/big1.png').contentHash, null);
  });

  it('a hash failure is counted, not thrown', async () => {
    const w = makeWorld([{ rel: 'a/one.png', mtimeMs: 2 }, { rel: 'a/two.png', mtimeMs: 1 }]);
    w.io.hashFile = async () => { throw new Error('locked'); };
    const { library, stats } = await run(w);
    assert.equal(stats.hashFailed, 2);
    assert.equal(library.works.length, 2);
    assert.ok(library.works.every((x) => x.contentHash === null));
  });
});

describe('dupes and junk in the library', () => {
  it('near duplicates and tiny pictures end up in library.dupes', async () => {
    const w = makeWorld([
      { rel: 'a/orig.png', mtimeMs: 5, thumb: { gray9x8: grayFor('same') } },
      { rel: 'a/copy.png', mtimeMs: 4, thumb: { gray9x8: grayFor('same') } },
      { rel: 'a/tiny.png', mtimeMs: 3, head: png(32, 32) },
      { rel: 'a/guess.webp', mtimeMs: 2, head: garbage(), thumb: { width: 20, height: 20 } },
    ]);
    const { library } = await run(w);
    assert.equal(library.dupes.near.length, 1);
    assert.deepEqual(library.dupes.near[0].ids.slice().sort(), ['a-copy-png', 'a-orig-png']);
    assert.deepEqual(library.dupes.junk, [{ id: 'a-tiny-png', reason: 'tiny' }]);      // the approx 20 x 20 is NOT flagged tiny
  });
});

describe('cancel, concurrency, progress, determinism', () => {
  it('cancel returns { cancelled: true } (before the walk, during thumbs, during dupes)', async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ rel: `a/f${i}.png`, mtimeMs: i + 1 }));
    let w = makeWorld(files);
    assert.deepEqual(await run(w, { isCancelled: () => true }), { cancelled: true });
    assert.equal(w.calls.thumbnail.length, 0);

    w = makeWorld(files);
    const out = await run(w, { isCancelled: () => w.calls.thumbnail.length >= 3 });
    assert.deepEqual(out, { cancelled: true });
    assert.ok(w.calls.thumbnail.length < 10);
    // thumbnails already written stay (and are reused next time)
    assert.ok(w.thumbs.size >= 3);
    const again = await run(w);
    assert.equal(again.library.works.length, 10);

    w = makeWorld(files);
    let phase = '';
    const out2 = await run(w, { onProgress: (p) => { phase = p.phase; }, isCancelled: () => phase === 'dupes' });
    assert.deepEqual(out2, { cancelled: true });
  });

  it('never has more than 3 thumbnails in flight (default), and honours another limit', async () => {
    const files = Array.from({ length: 14 }, (_, i) => ({ rel: `a/f${i}.png`, mtimeMs: i + 1, delay: 2 }));
    let w = makeWorld(files);
    await run(w);
    assert.equal(w.maxInFlight, 3);
    w = makeWorld(files);
    await run(w, { concurrency: 1 });
    assert.equal(w.maxInFlight, 1);
    w = makeWorld(files);
    await run(w, { concurrency: 5 });
    assert.equal(w.maxInFlight, 5);
  });

  it('progress arrives in phase order walk, thumbs, hashes, dupes with done <= total', async () => {
    const w = makeWorld([
      { rel: 'a/a.png', mtimeMs: 3 }, { rel: 'a/b.png', mtimeMs: 2 }, { rel: 'a/c.png', mtimeMs: 1 },
    ]);
    const events = [];
    await run(w, { onProgress: (p) => events.push(p) });
    const order = [];
    for (const e of events) if (order.at(-1) !== e.phase) order.push(e.phase);
    assert.deepEqual(order, ['walk', 'thumbs', 'hashes', 'dupes']);
    assert.ok(events.every((e) => Number.isFinite(e.done) && Number.isFinite(e.total) && e.done <= e.total), JSON.stringify(events));
    for (const phase of order) {
      const ofPhase = events.filter((e) => e.phase === phase);
      assert.ok(ofPhase.length >= 1);
      assert.ok(ofPhase.every((e, i) => i === 0 || e.done >= ofPhase[i - 1].done), `${phase} goes backwards`);
    }
    const thumbs = events.filter((e) => e.phase === 'thumbs');
    assert.deepEqual(thumbs.at(-1), { phase: 'thumbs', done: 3, total: 3 });
  });

  it('the output is stable when thumbnail promises resolve in reverse order', async () => {
    const specs = (delays) => Array.from({ length: 9 }, (_, i) => ({ rel: `a/f${i}.png`, mtimeMs: 100 - i, delay: delays[i] }));
    const forward = await run(makeWorld(specs([1, 2, 3, 4, 5, 6, 7, 8, 9])));
    const reverse = await run(makeWorld(specs([9, 8, 7, 6, 5, 4, 3, 2, 1])));
    const none = await run(makeWorld(specs(Array(9).fill(0))));
    assert.deepEqual(reverse.library.works, forward.library.works);
    assert.deepEqual(none.library.works, forward.library.works);
    assert.deepEqual(reverse.library.idMap, forward.library.idMap);
    assert.deepEqual(forward.library.works.map((x) => x.rel), Array.from({ length: 9 }, (_, i) => `a/f${i}.png`));
  });

  it('an empty folder gives an empty library, and a truncated or unreadable walk is reported', async () => {
    const empty = await run(makeWorld([]));
    assert.deepEqual(empty.library.works, []);
    assert.deepEqual(empty.library.dupes, { exact: [], near: [], junk: [] });
    assert.equal(empty.stats.files, 0);
    const w = makeWorld([{ rel: 'a/x.png' }]);
    const orig = w.io.readdir;
    w.io.readdir = async (d) => { if (d === `${ROOT}/a`) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return orig(d); };
    w.set({ rel: 'a/x.png' });
    const r = await run(w);
    assert.equal(r.stats.unreadable, 1);
    assert.equal(r.stats.truncated, false);
  });

  it('programmer errors throw: missing roots or io functions', async () => {
    await assert.rejects(() => runIndex({ roots: [], io: {} }), TypeError);
    await assert.rejects(() => runIndex({ roots: [{ prefix: '', dir: ROOT }], io: { readdir() {} } }), TypeError);
  });

  it('uses slug() ids and ignores a Date from now()', async () => {
    const w = makeWorld([{ rel: 'Alpha Site/Hero.png' }]);
    const { library } = await runIndex({ roots: [{ prefix: '', dir: ROOT }], rootLabel: 'r', io: w.io, now: () => new Date(Date.UTC(2026, 0, 2)) });
    assert.equal(library.works[0].id, slug('Alpha Site/Hero.png'));
    assert.equal(library.generatedAt, '2026-01-02T00:00:00.000Z');
  });
});
