// Cosmos space — end to end: the REAL indexer (dashboard/cosmos/indexer.mjs), the real store, curation and
// path rules, over a temp tree, with fake thumbnail / Recycle Bin / dialog deps. Invented names only.
//   node --test dashboard/cosmos.e2e.test.mjs
// This test SKIPS LOUDLY (a visible message, not a silent pass) while ./cosmos/indexer.mjs does not exist.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cosmos = require('./cosmos.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const HAVE_INDEXER = fs.existsSync(path.join(here, 'cosmos', 'indexer.mjs'));
const SKIP = HAVE_INDEXER ? false : 'SKIPPED LOUDLY: dashboard/cosmos/indexer.mjs does not exist yet; this end-to-end test must run for real at the Pass';
if (!HAVE_INDEXER) console.error('\n*** ' + SKIP + ' ***\n');

/** A PNG that only the header is real in: signature plus IHDR with the given size. */
function pngHeader(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 2;
  return b;
}

function grayFor(abs) {
  let s = 7;
  for (const ch of abs) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const g = new Uint8Array(72);
  for (let i = 0; i < 72; i++) { s = (s * 1103515245 + 12345) >>> 0; g[i] = (s >>> 16) & 255; }
  return g;
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-e2e-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'library');
  const incoming = path.join(base, 'incoming');
  for (const d of [root, incoming, path.join(root, 'alpha-site'), path.join(root, 'beta')]) fs.mkdirSync(d, { recursive: true });
  const put = (rel, w, h, mtimeSec) => {
    const abs = path.join(root, rel);
    fs.writeFileSync(abs, Buffer.concat([pngHeader(w, h), Buffer.from(rel)]));
    fs.utimesSync(abs, mtimeSec, mtimeSec);
    return abs;
  };
  const trashCalls = [];
  const dialogs = { files: [] };
  const deps = {
    pickFolder: async () => root,
    pickFile: async () => (dialogs.files.length ? dialogs.files.shift() : null),
    trash: async (abs) => { trashCalls.push(abs); },
    reveal: () => {},
    thumbnail: async (abs) => ({
      jpeg: Buffer.from('jpeg:' + path.basename(abs)), width: 8, height: 6, sourceWidth: null, sourceHeight: null,
      rgba32: { width: 2, height: 2, data: Uint8Array.from([200, 30, 30, 255, 200, 30, 30, 255, 200, 30, 30, 255, 200, 30, 30, 255]) },
      gray9x8: grayFor(abs),
    }),
    dispose() {},
  };
  const c = cosmos.create({ dataDir, deps, env: {} });
  const cosmosDir = path.join(dataDir, 'cosmos');
  return {
    base, root, incoming, dataDir, cosmosDir, c, deps, dialogs, trashCalls, put,
    index: async () => { await c.pickFolder(); const r = await c.index(); assert.equal(r, true, JSON.stringify(r)); await c.whenIdle(); },
    json: (...p) => JSON.parse(fs.readFileSync(path.join(cosmosDir, ...p), 'utf8')),
    done: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

const byRel = (works, rel) => works.find((w) => w.rel === rel);

describe('cosmos end to end (real indexer)', { skip: SKIP }, () => {
  it('indexes a tree, keeps a favourite on the same image when a newer file with a colliding name arrives, and survives a re-index', async () => {
    const t = setup();
    try {
      t.put('alpha-site/hero.png', 40, 30, 1_700_000_000);
      t.put('beta/mark.png', 20, 20, 1_700_000_100);
      await t.index();
      let r = await t.c.read();
      assert.equal(r.state, 'ready');
      assert.equal(r.works.length, 2);
      const hero = byRel(r.works, 'alpha-site/hero.png');
      assert.deepEqual([hero.width, hero.height], [40, 30]);
      assert.ok(hero.thumbUrl && hero.url);
      assert.ok(fs.existsSync(path.join(t.cosmosDir, 'thumbs', `${hero.id}.jpg`)));
      assert.equal(r.config.root, t.root);

      const fav = await t.c.apply({ type: 'favorite', id: hero.id, on: true });
      assert.deepEqual(fav.view.curation.favorites, { [hero.id]: true });

      // a NEWER file whose slug collides with the favourite: the old walk would have handed it the bare id
      t.put('alpha-site/hero_.png', 50, 50, 1_800_000_000);
      await t.index();
      r = await t.c.read();
      assert.equal(r.works.length, 3);
      assert.equal(byRel(r.works, 'alpha-site/hero.png').id, hero.id, 'the favourite still points at the same image');
      assert.notEqual(byRel(r.works, 'alpha-site/hero_.png').id, hero.id);
      assert.deepEqual(r.curation.favorites, { [hero.id]: true });

      // and once more with nothing changed: ids are stable, the library is still whole
      await t.index();
      r = await t.c.read();
      assert.deepEqual(r.works.map((w) => [w.rel, w.id]).sort(), (await t.c.read({ force: true })).works.map((w) => [w.rel, w.id]).sort());
      assert.equal(byRel(r.works, 'alpha-site/hero.png').id, hero.id);
    } finally { t.done(); }
  });

  it('deleting a file keeps its id reserved: a new file with the same name never takes it over', async () => {
    const t = setup();
    try {
      const abs = t.put('beta/mark.png', 20, 20, 1_700_000_000);
      await t.index();
      const id = byRel((await t.c.read()).works, 'beta/mark.png').id;
      fs.rmSync(abs);
      await t.index();
      assert.equal((await t.c.read()).works.length, 0);
      t.put('beta/mark_.png', 20, 20, 1_800_000_000);
      await t.index();
      const next = byRel((await t.c.read()).works, 'beta/mark_.png');
      assert.notEqual(next.id, id);
      assert.ok(t.json('library.json').idMap.entries.some((e) => e.id === id));
    } finally { t.done(); }
  });

  it('import-local in both owner orders ends with the same ids, curation and a clear report', async () => {
    const manifest = { version: 1, generatedAt: 'x', works: [{ id: 'old-hero', src: '/media/alpha-site/hero.png' }, { id: 'old-mark', src: '/media/beta/mark.png' }, { id: 'old-lost', src: '/media/lost/x.png' }] };
    const backup = {
      app: 'cosmos-local', version: 1, exportedAt: '2026-02-01T00:00:00.000Z',
      clusters: [{ id: 'cl-old', name: 'Moodboard', elementIds: ['old-hero', 'old-mark', 'old-lost'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      favorites: { 'old-hero': true }, hidden: { 'old-mark': true }, overrides: { 'old-hero': { title: 'The hero', tags: ['Brand'] } },
    };
    const run = async (indexFirst) => {
      const t = setup();
      try {
        t.put('alpha-site/hero.png', 40, 30, 1_700_000_000);
        t.put('beta/mark.png', 20, 20, 1_700_000_100);
        const bf = path.join(t.base, 'backup.json');
        const mf = path.join(t.base, 'manifest.json');
        fs.writeFileSync(bf, JSON.stringify(backup));
        fs.writeFileSync(mf, JSON.stringify(manifest));
        let report;
        if (indexFirst) {
          await t.index();
          t.dialogs.files.push(bf, mf);
          report = await t.c.importFromLocal();
        } else {
          t.dialogs.files.push(bf, mf);
          report = await t.c.importFromLocal();
          assert.equal((await t.c.read()).state, 'empty');
          await t.index();
        }
        const r = await t.c.read();
        return { report, works: r.works.map((w) => [w.rel, w.id]).sort(), curation: r.curation, retired: t.json('library.json').idMap.entries.filter((e) => e.rel.startsWith('retired:')).length };
      } finally { t.done(); }
    };
    const a = await run(true);
    const b = await run(false);
    assert.deepEqual(a.works, [['alpha-site/hero.png', 'old-hero'], ['beta/mark.png', 'old-mark']]);
    assert.deepEqual(b.works, a.works);
    assert.deepEqual(a.curation, b.curation);
    assert.deepEqual(a.curation.favorites, { 'old-hero': true });
    assert.deepEqual(a.curation.hidden, { 'old-mark': true });
    assert.equal(a.curation.clusters[0].elementIds.length, 3);
    assert.equal(a.report.rekeyed, 2, 'index first: both minted ids were re-matched');
    assert.equal(a.retired, 2);
    assert.equal(b.report.rekeyed, 0, 'import first: nothing to re-key');
    assert.equal(b.retired, 0);
    assert.equal(a.report.missingCount, 1);
    assert.equal(a.report.missingIds[0], 'old-lost');
    assert.equal(b.report.missingCount, 3, 'before the index, every referenced file is still missing');
    assert.equal(a.report.skippedCount, 0);
  });

  it('trash: a dropped-in file goes to the Recycle Bin by id; a file in the pictures folder is refused', async () => {
    const t = setup();
    try {
      t.put('alpha-site/hero.png', 40, 30, 1_700_000_000);
      await t.index();
      const src = path.join(t.incoming, 'dropped.png');
      fs.writeFileSync(src, Buffer.concat([pngHeader(12, 12), Buffer.from('dropped')]));
      const imp = await t.c.importFiles([src]);
      assert.equal(imp.imported, 1);
      await t.c.whenIdle();
      const works = (await t.c.read()).works;
      assert.equal(works.length, 2);
      const dropped = byRel(works, 'imports:dropped.png');
      const hero = byRel(works, 'alpha-site/hero.png');
      assert.deepEqual([dropped.width, dropped.height], [12, 12]);

      const refused = await t.c.trash([hero.id]);
      assert.deepEqual(refused.trashed, []);
      assert.match(refused.failed[0].message, /Only files you dropped into Cosmos/);
      assert.equal(t.trashCalls.length, 0);

      const ok = await t.c.trash([dropped.id]);
      assert.deepEqual(ok, { trashed: [dropped.id], failed: [] });
      assert.equal(t.trashCalls.length, 1);
      assert.equal(path.basename(t.trashCalls[0]), 'dropped.png');
      assert.deepEqual((await t.c.read()).works.map((w) => w.id), [hero.id]);
      assert.ok(t.json('library.json').idMap.entries.some((e) => e.id === dropped.id));
    } finally { t.done(); }
  });

  it('cancel keeps the old library whole and the next run reuses the thumbnails', async () => {
    const t = setup();
    try {
      t.put('alpha-site/hero.png', 40, 30, 1_700_000_000);
      await t.index();
      const before = fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8');
      for (let i = 0; i < 6; i++) t.put(`beta/more-${i}.png`, 10 + i, 10, 1_700_000_200 + i);
      await t.c.pickFolder();
      assert.equal(await t.c.index(), true);
      t.c.cancelIndex();
      await t.c.whenIdle();
      const after = fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8');
      const stillOld = after === before;
      if (stillOld) assert.equal((await t.c.read()).works.length, 1);
      await t.index();
      assert.equal((await t.c.read()).works.length, 7);
    } finally { t.done(); }
  });
});
