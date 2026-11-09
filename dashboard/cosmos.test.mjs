// Cosmos space — main side (dashboard/cosmos.js) with injected fake deps, a fake index engine, a fake clock
// and temp folders. Placeholder names only; nothing here touches a real library or the network.
//   node --test dashboard/cosmos.test.mjs
// The real indexer is exercised by cosmos.e2e.test.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assignIds, seedFromManifest, parseIdMap } from './cosmos/ids.mjs';

const require = createRequire(import.meta.url);
const cosmos = require('./cosmos.js');
const here = path.dirname(fileURLToPath(import.meta.url));

const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const tick = () => new Promise((r) => setImmediate(r));

function makeClock() {
  const clock = { t: T0, timers: [], seq: 0 };
  clock.now = () => new Date(clock.t);
  clock.timers = { set: (fn, ms) => { const h = { fn, at: clock.t + ms, id: ++clock.seq }; clock.list.push(h); return h; }, clear: (h) => { clock.list = clock.list.filter((x) => x !== h); } };
  clock.list = [];
  clock.advance = (ms) => {
    const end = clock.t + ms;
    for (;;) {
      const due = clock.list.filter((h) => h.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.list = clock.list.filter((h) => h !== due);
      clock.t = Math.max(clock.t, due.at);
      due.fn();
    }
    clock.t = end;
  };
  return clock;
}

function scan(dir, prefix, out) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) scan(path.join(dir, d.name), prefix + d.name + '/', out);
    else out.push({ rel: prefix + d.name, abs: path.join(dir, d.name) });
  }
  return out;
}

/** A stand-in for the index engine: scans the real folders, mints ids with the real sticky map, writes thumbs. */
function fakeEngine(hooks = {}) {
  const calls = [];
  return {
    calls,
    async runIndex(opts) {
      calls.push(opts);
      if (hooks.before) await hooks.before(opts);
      const files = [];
      for (const r of opts.roots) {
        for (const f of scan(r.dir, '', [])) {
          const st = fs.statSync(f.abs);
          files.push({ rel: r.prefix + f.rel, abs: f.abs, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
      let idMap = parseIdMap(opts.oldLibrary && opts.oldLibrary.idMap).map;
      let seeded = 0;
      if (!opts.oldLibrary && opts.manifest) { const s = seedFromManifest(opts.manifest, idMap); idMap = s.map; seeded = s.seeded; }
      const a = assignIds(idMap, files);
      opts.onProgress({ phase: 'walk', done: files.length, total: files.length });
      const works = [];
      for (const e of a.entries) {
        const f = files.find((x) => x.rel === e.rel);
        opts.io.writeThumb(e.id, Buffer.from('jpeg'));
        opts.onProgress({ phase: 'thumbs', done: works.length + 1, total: a.entries.length });
        works.push({
          id: e.id, rel: e.rel, title: e.rel, type: 'misc', width: 10, height: 10, orientation: 'square', thumb: `${e.id}.jpg`,
          tags: e.rel.includes('/') ? [e.rel.split('/')[0]] : [], createdAt: '2026-01-01T00:00:00.000Z', size: f.size, mtimeMs: f.mtimeMs,
        });
      }
      if (hooks.afterThumbs) await hooks.afterThumbs(opts);
      if (opts.isCancelled()) return { cancelled: true };
      if (hooks.crash) throw new Error(hooks.crash);
      return {
        library: { version: 1, generatedAt: new Date(opts.now()).toISOString(), root: opts.rootLabel, idMap: a.map, works, dupes: { exact: [], near: [], junk: [] } },
        stats: { files: works.length, indexed: works.length, unchanged: 0, thumbsOk: works.length, thumbsFailed: 0, minted: a.minted, seeded },
      };
    },
  };
}

function setup({ files = ['alpha/a.png', 'alpha/b.png', 'c.png'], imports = [], env = {}, hooks = {}, engine } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-main-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'library');
  const importsDir = path.join(dataDir, 'cosmos', 'imports');
  fs.mkdirSync(root, { recursive: true });
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), 'picture'); }
  for (const f of imports) { fs.mkdirSync(importsDir, { recursive: true }); fs.writeFileSync(path.join(importsDir, f), 'picture'); }
  const clock = makeClock();
  const sent = [];
  const trashCalls = [];
  const revealCalls = [];
  const dialogs = { folder: root, files: [] };
  const deps = {
    pickFolder: async () => dialogs.folder,
    pickFile: async () => (dialogs.files.length ? dialogs.files.shift() : null),
    trash: async (abs) => { trashCalls.push(abs); if (deps.failTrash && deps.failTrash(abs)) throw new Error('the Recycle Bin said no'); },
    reveal: (abs) => { revealCalls.push(abs); },
    thumbnail: async () => null,
    dispose: () => { deps.disposed = (deps.disposed || 0) + 1; },
  };
  const eng = engine || fakeEngine(hooks);
  const c = cosmos.create({
    dataDir, deps, now: clock.now, newId: (() => { let n = 0; return () => 'a1b2c3' + String(++n).padStart(2, '0'); })(),
    castSend: (ch, p) => sent.push({ ch, p, t: clock.t }), env, engine: eng, timers: clock.timers,
  });
  const cosmosDir = path.join(dataDir, 'cosmos');
  const settle = async () => {
    let done = false;
    c.whenIdle().then(() => { done = true; });
    for (let i = 0; i < 400 && !done; i++) { clock.advance(100); await tick(); }
    assert.ok(done, 'the index never settled');
  };
  const indexNow = async () => {
    await c.pickFolder();
    const r = await c.index();
    assert.equal(r, true, JSON.stringify(r));
    await settle();
  };
  return {
    base, dataDir, root, importsDir, cosmosDir, clock, sent, deps, dialogs, trashCalls, revealCalls, engine: eng, c, settle, indexNow,
    done: () => fs.rmSync(base, { recursive: true, force: true }),
    exists: (...p) => fs.existsSync(path.join(cosmosDir, ...p)),
    json: (...p) => JSON.parse(fs.readFileSync(path.join(cosmosDir, ...p), 'utf8')),
  };
}

const idOf = (works, rel) => works.find((w) => w.rel === rel).id;

describe('init', () => {
  it('registers exactly the nine invoke channels once each (the tenth row is the progress push)', async () => {
    const t = setup();
    try {
      const seen = [];
      const handlers = new Map();
      const ipcMain = { handle: (ch, fn) => { seen.push(ch); handlers.set(ch, fn); } };
      const c = cosmos.init({ ipcMain, dataDir: t.dataDir, getWin: () => null, castSend: () => {}, deps: t.deps });
      assert.deepEqual(seen.sort(), [
        'hq:cosmos:apply', 'hq:cosmos:cancel-index', 'hq:cosmos:import-files', 'hq:cosmos:import-local', 'hq:cosmos:index',
        'hq:cosmos:pick-folder', 'hq:cosmos:read', 'hq:cosmos:reveal', 'hq:cosmos:trash',
      ].sort());
      assert.equal(new Set(seen).size, seen.length);
      assert.equal(typeof c.dispose, 'function');
      const r = await handlers.get('hq:cosmos:read')({}, undefined);
      assert.equal(r.state, 'empty');
    } finally { t.done(); }
  });

  it('survives file helpers that cannot start: read still works and pick-folder answers null', async () => {
    const t = setup();
    try {
      const handlers = new Map();
      cosmos.init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, dataDir: t.dataDir, getWin: () => null, castSend: () => {} });
      assert.equal((await handlers.get('hq:cosmos:read')({})).state, 'empty');
      assert.equal(await handlers.get('hq:cosmos:pick-folder')({}), null);
    } finally { t.done(); }
  });
});

describe('read', () => {
  it('is empty before any index, with the fields the renderer needs', async () => {
    const t = setup();
    try {
      const r = await t.c.read();
      assert.equal(r.state, 'empty');
      assert.deepEqual(r.works, []);
      assert.equal(r.config.root, null);
      assert.equal(r.rootOk, true);
      assert.equal(r.indexing, null);
      assert.deepEqual(r.curation.favorites, {});
      assert.deepEqual(r.cleanup.dismissed, { clusters: {}, candidates: {} });
      assert.deepEqual(r.dupes, { exact: [], near: [], junk: [] });
    } finally { t.done(); }
  });

  it('is ready after an index, with url and thumbUrl computed in main and nothing decorated written back', async () => {
    const t = setup({ imports: ['drop.png'] });
    try {
      await t.indexNow();
      const r = await t.c.read();
      assert.equal(r.state, 'ready');
      assert.equal(r.works.length, 4);
      const a = r.works.find((w) => w.rel === 'alpha/a.png');
      assert.ok(a.url.startsWith('file:///') && a.url.endsWith('/alpha/a.png'), a.url);
      assert.ok(a.thumbUrl.startsWith('file:///') && a.thumbUrl.endsWith(`/thumbs/${a.id}.jpg`), a.thumbUrl);
      const imp = r.works.find((w) => w.rel === 'imports:drop.png');
      assert.ok(imp.url.includes('/imports/drop.png'));
      const onDisk = t.json('library.json');
      assert.ok(onDisk.works.every((w) => w.url === undefined && w.thumbUrl === undefined));
      assert.equal(r.config.root, t.root);
      assert.ok(r.config.indexedAt);
      assert.equal(r.stale, undefined);
    } finally { t.done(); }
  });

  it('flags a stale index (older than 14 days) and a root that cannot be reached, while serving the last library', async () => {
    const t = setup();
    try {
      await t.indexNow();
      t.clock.t += 15 * 86400000;
      fs.rmSync(t.root, { recursive: true, force: true });
      const r = await t.c.read();
      assert.equal(r.state, 'ready');
      assert.equal(r.rootOk, false);
      assert.equal(r.works.length, 3);
      assert.equal(r.stale.days, 15);
    } finally { t.done(); }
  });

  it('a library that cannot be parsed is state error with the real message; the ids are kept for the next index', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const before = (await t.c.read()).works.map((w) => [w.rel, w.id]);
      const text = fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8');
      fs.writeFileSync(path.join(t.cosmosDir, 'library.json'), text.slice(0, text.indexOf('"works"')) + '"works":[{"id":');
      const r = await t.c.read({ force: true });
      assert.equal(r.state, 'error');
      assert.match(r.error, /library\.json\.corrupt/);
      assert.deepEqual(r.works, []);
      assert.ok(t.exists('library.json.corrupt'));
      await t.indexNow();
      const after = (await t.c.read()).works.map((w) => [w.rel, w.id]);
      assert.deepEqual(after.sort(), before.sort(), 'every file keeps its id');
    } finally { t.done(); }
  });

  it('a read during a running index returns the previous library and the indexing state', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let armed = false;
    const t = setup({ hooks: { before: async () => { if (armed) await gate; } } });
    try {
      await t.indexNow();
      fs.writeFileSync(path.join(t.root, 'new.png'), 'picture');
      armed = true;
      assert.equal(await t.c.index(), true);
      await tick();
      const mid = await t.c.read();
      assert.equal(mid.works.length, 3);
      assert.equal(mid.indexing.phase, 'walk');
      assert.ok(mid.indexing.startedAt);
      release();
      await t.settle();
      const end = await t.c.read();
      assert.equal(end.works.length, 4);
      assert.equal(end.indexing, null);
    } finally { t.done(); }
  });

  it('garbage options never throw', async () => {
    const t = setup();
    try {
      for (const o of [null, 5, 'x', [], { force: 'yes' }]) assert.ok((await t.c.read(o)).state);
    } finally { t.done(); }
  });
});

describe('apply', () => {
  it('refuses before any IO: unknown type and a payload over 64 KB create nothing', async () => {
    const t = setup();
    try {
      assert.ok((await t.c.apply({ type: 'nope' })).error);
      assert.ok((await t.c.apply({ type: 'tags', id: 'x', add: ['a'], pad: 'x'.repeat(65 * 1024) })).error);
      assert.ok((await t.c.apply(null)).error);
      assert.ok(!t.exists('curation.json'));
      assert.ok(!t.exists('cleanup.json'));
    } finally { t.done(); }
  });

  it('writes atomically and answers with the new view; an unknown id is refused with nothing written', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const id = idOf((await t.c.read()).works, 'alpha/a.png');
      const r = await t.c.apply({ type: 'favorite', id, on: true });
      assert.deepEqual(r.view.curation.favorites, { [id]: true });
      assert.equal(r.note, 'Added to favourites.');
      assert.deepEqual(t.json('curation.json').favorites, { [id]: true });
      assert.ok(!fs.readdirSync(t.cosmosDir).some((n) => n.endsWith('.tmp')));
      await t.c.apply({ type: 'favorite', id, on: false });
      assert.deepEqual(t.json('curation.json.prev').favorites, { [id]: true }, '.prev holds the save before');
      const before = fs.readFileSync(path.join(t.cosmosDir, 'curation.json'), 'utf8');
      assert.match((await t.c.apply({ type: 'favorite', id: 'ghost', on: true })).error, /not in the library/);
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, 'curation.json'), 'utf8'), before);
    } finally { t.done(); }
  });

  it('a no-op intent writes nothing; tags start from the element’s folder tags', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const id = idOf((await t.c.read()).works, 'alpha/a.png');
      const noop = await t.c.apply({ type: 'favorite', id, on: false });
      assert.equal(noop.note, 'Nothing to change.');
      assert.ok(!t.exists('curation.json'));
      const tg = await t.c.apply({ type: 'tags', id, add: ['Brand'] });
      assert.deepEqual(tg.view.curation.overrides[id].tags, ['alpha', 'brand']);
    } finally { t.done(); }
  });

  it('clusters get a minted id and timestamps from main', async () => {
    const t = setup();
    try {
      const r = await t.c.apply({ type: 'cluster-save', name: 'Box', id: 'cl-evil', createdAt: '1999' });
      const c = r.view.curation.clusters[0];
      assert.match(c.id, /^cl-a1b2c3/);
      assert.equal(c.createdAt, new Date(T0).toISOString());
    } finally { t.done(); }
  });

  it('a damaged curation is refused with the message once, restored from .prev, then works', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const works = (await t.c.read()).works;
      await t.c.apply({ type: 'favorite', id: works[0].id, on: true });
      await t.c.apply({ type: 'favorite', id: works[1].id, on: true });
      fs.writeFileSync(path.join(t.cosmosDir, 'curation.json'), '{ broken');
      const first = await t.c.apply({ type: 'favorite', id: works[2].id, on: true });
      assert.match(first.error, /previous save/);
      const again = await t.c.apply({ type: 'favorite', id: works[2].id, on: true });
      assert.deepEqual(Object.keys(again.view.curation.favorites).sort(), [works[0].id, works[2].id].sort());
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, 'curation.json.corrupt'), 'utf8'), '{ broken');
    } finally { t.done(); }
  });
});

describe('pickFolder and index', () => {
  it('index refuses with the four reasons and writes no config', async () => {
    const t = setup();
    try {
      let r = await t.c.index();
      assert.deepEqual([r.ok, r.reason], [false, 'no-root']);
      assert.ok(r.message);
      t.dialogs.folder = path.join(t.base, 'nowhere');
      await t.c.pickFolder();
      r = await t.c.index();
      assert.equal(r.reason, 'root-missing');
      t.dialogs.folder = path.join(t.root, 'c.png');
      await t.c.pickFolder();
      r = await t.c.index();
      assert.equal(r.reason, 'not-a-folder');
      t.dialogs.folder = t.cosmosDir;
      fs.mkdirSync(t.cosmosDir, { recursive: true });
      await t.c.pickFolder();
      assert.equal((await t.c.index()).reason, 'not-a-folder', 'the app’s own data folder is not a library');
      t.dialogs.folder = t.dataDir;
      await t.c.pickFolder();
      assert.equal((await t.c.index()).reason, 'not-a-folder', 'nor is a folder that contains it');
      assert.ok(!t.exists('config.json'));
      assert.equal(t.engine.calls.length, 0);
    } finally { t.done(); }
  });

  it('a second index while one runs is refused as running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const t = setup({ hooks: { before: async () => { await gate; } } });
    try {
      await t.c.pickFolder();
      assert.equal(await t.c.index(), true);
      const r = await t.c.index();
      assert.deepEqual([r.ok, r.reason], [false, 'running']);
      release();
      await t.settle();
    } finally { t.done(); }
  });

  it('writes config.json only once the walk has started, and library.json then config on success', async () => {
    let seenBefore;
    let seenAfter;
    const t = setup({
      hooks: {
        before: async () => { seenBefore = t.exists('config.json'); },
        afterThumbs: async () => { seenAfter = t.exists('config.json') ? t.json('config.json') : null; },
      },
    });
    try {
      await t.c.pickFolder();
      assert.ok(!t.exists('config.json'), 'picking a folder alone writes nothing');
      await t.c.index();
      await t.settle();
      assert.equal(seenBefore, false);
      assert.equal(seenAfter.root, t.root);
      assert.equal(seenAfter.indexedAt, null);
      assert.ok(t.json('config.json').indexedAt);
      assert.equal(t.json('library.json').root, t.root);
    } finally { t.done(); }
  });

  it('an index that crashes writes nothing, leaves the old library, and still ends the run with a done_all push', async () => {
    const hooks = {};
    const t = setup({ hooks });
    try {
      await t.indexNow();
      const before = fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8');
      hooks.crash = 'the disk fell over';
      t.sent.length = 0;
      await t.indexNow();
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8'), before);
      const last = t.sent[t.sent.length - 1].p;
      assert.equal(last.done_all, true);
      assert.equal(last.phase, 'error');
      assert.match(last.error, /disk fell over/);
      assert.equal((await t.c.read()).indexing, null);
    } finally { t.done(); }
  });

  it('progress goes out at most 4 times in any second and ends with one done_all push carrying the summary', async () => {
    const hooks = {};
    hooks.before = async (opts) => {
      for (let i = 0; i < 60; i++) { t.clock.advance(40); opts.onProgress({ phase: 'thumbs', done: i, total: 60 }); await tick(); }
    };
    const t = setup({ hooks });
    try {
      await t.indexNow();
      const pushes = t.sent.filter((s) => s.ch === 'hq:cosmos:index-progress');
      assert.ok(pushes.length >= 8, `only ${pushes.length} pushes`);
      for (const s of pushes) {
        const inWindow = pushes.filter((o) => o.t >= s.t && o.t <= s.t + 1000).length;
        assert.ok(inWindow <= 4, `${inWindow} pushes in one second`);
      }
      const finals = pushes.filter((s) => s.p.done_all);
      assert.equal(finals.length, 1);
      assert.equal(pushes[pushes.length - 1], finals[0]);
      assert.deepEqual(Object.keys(finals[0].p.summary).sort(), ['cancelled', 'elements', 'minted', 'seeded', 'thumbs', 'thumbsFailed', 'unchanged']);
      assert.equal(finals[0].p.summary.elements, 3);
      assert.equal(finals[0].p.phase, 'done');
      assert.ok(pushes.every((s) => ['walk', 'thumbs', 'done'].includes(s.p.phase)));
    } finally { t.done(); }
  });

  it('cancel leaves library.json untouched, keeps the thumbnails written so far and says cancelled', async () => {
    const hooks = {};
    const t = setup({ hooks });
    try {
      await t.indexNow();
      const before = fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8');
      fs.writeFileSync(path.join(t.root, 'fresh.png'), 'picture');
      hooks.afterThumbs = async () => { assert.equal(t.c.cancelIndex(), true); };
      t.sent.length = 0;
      await t.indexNow();
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, 'library.json'), 'utf8'), before);
      assert.ok(fs.readdirSync(path.join(t.cosmosDir, 'thumbs')).includes('fresh-png.jpg'));
      const last = t.sent[t.sent.length - 1].p;
      assert.equal(last.done_all, true);
      assert.equal(last.summary.cancelled, true);
      assert.equal(last.phase, 'cancelled');
      assert.equal((await t.c.read()).works.length, 3);
      assert.equal(t.c.cancelIndex(), true, 'cancel with nothing running is harmless');
    } finally { t.done(); }
  });

  it('HQ_COSMOS_ROOT replaces the folder dialog (gates only) and the dialog is not opened', async () => {
    const t = setup();
    try {
      const other = cosmos.create({ dataDir: t.dataDir, deps: { pickFolder: async () => { throw new Error('dialog opened'); } }, env: { HQ_COSMOS_ROOT: t.root }, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      assert.equal(await other.pickFolder(), t.root);
    } finally { t.done(); }
  });

  it('the first run takes the manifest from HQ_COSMOS_MANIFEST only when there is no library yet', async () => {
    const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-manifest-'));
    const manifestFile = path.join(manifestDir, 'manifest.json');
    fs.writeFileSync(manifestFile, JSON.stringify({ works: [{ id: 'old-a', src: '/media/alpha/a.png' }] }));
    const t = setup({ env: { HQ_COSMOS_MANIFEST: manifestFile } });
    try {
      await t.indexNow();
      const works = (await t.c.read()).works;
      assert.equal(idOf(works, 'alpha/a.png'), 'old-a');
      assert.equal(t.engine.calls[0].manifest.works.length, 1);
      await t.indexNow();
      assert.equal(t.engine.calls[1].manifest, null, 'a second run never re-seeds');
    } finally { t.done(); fs.rmSync(manifestDir, { recursive: true, force: true }); }
  });
});

describe('trash and reveal', () => {
  async function indexed(extra = {}) {
    const t = setup({ imports: ['drop.png', 'keep.png'], ...extra });
    await t.indexNow();
    const works = (await t.c.read()).works;
    return { t, works, drop: idOf(works, 'imports:drop.png'), keep: idOf(works, 'imports:keep.png'), pic: idOf(works, 'alpha/a.png') };
  }

  it('moves an imports element to the Recycle Bin by id and removes only it from library.json (idMap, curation and others stay)', async () => {
    const { t, drop, keep } = await indexed();
    try {
      await t.c.apply({ type: 'favorite', id: drop, on: true });
      const r = await t.c.trash([drop]);
      assert.deepEqual(r, { trashed: [drop], failed: [] });
      assert.equal(t.trashCalls.length, 1);
      assert.equal(path.basename(t.trashCalls[0]), 'drop.png');
      assert.ok(t.trashCalls[0].toLowerCase().startsWith(fs.realpathSync(t.importsDir).toLowerCase()));
      const lib = t.json('library.json');
      assert.ok(!lib.works.some((w) => w.id === drop));
      assert.ok(lib.works.some((w) => w.id === keep));
      assert.ok(lib.idMap.entries.some((e) => e.id === drop), 'the id is kept forever');
      assert.deepEqual(t.json('curation.json').favorites, { [drop]: true });
      assert.ok(!fs.readdirSync(path.join(t.cosmosDir, 'thumbs')).includes(`${drop}.jpg`));
      assert.equal((await t.c.read()).works.some((w) => w.id === drop), false);
    } finally { t.done(); }
  });

  it('REFUSES an element from the pictures folder with a failed row and never calls deps.trash', async () => {
    const { t, pic } = await indexed();
    try {
      const r = await t.c.trash([pic]);
      assert.deepEqual(r.trashed, []);
      assert.deepEqual(r.failed, [{ id: pic, message: 'Only files you dropped into Cosmos can be moved to the Recycle Bin from here yet' }]);
      assert.equal(t.trashCalls.length, 0);
      assert.ok(fs.existsSync(path.join(t.root, 'alpha', 'a.png')));
    } finally { t.done(); }
  });

  it('refuses more than 20 ids, unknown ids and non-arrays without calling deps.trash', async () => {
    const { t, drop } = await indexed();
    try {
      const many = Array.from({ length: 21 }, () => drop);
      const r = await t.c.trash(many);
      assert.deepEqual(r.trashed, []);
      assert.match(r.failed[0].message, /at most 20/);
      assert.deepEqual((await t.c.trash(['ghost'])).failed.map((f) => f.id), ['ghost']);
      for (const bad of [null, undefined, 'abc', 5, {}, [1], [null], [{}], ['']]) {
        const x = await t.c.trash(bad);
        assert.deepEqual(x.trashed, []);
      }
      assert.equal(t.trashCalls.length, 0);
    } finally { t.done(); }
  });

  it('a partial failure is reported honestly: the others still move, the failed one stays in the library', async () => {
    const { t, drop, keep } = await indexed();
    try {
      t.deps.failTrash = (abs) => path.basename(abs) === 'keep.png';
      const r = await t.c.trash([drop, keep, drop]);
      assert.deepEqual(r.trashed, [drop]);
      assert.deepEqual(r.failed, [{ id: keep, message: 'the Recycle Bin said no' }]);
      assert.equal(t.trashCalls.length, 2, 'a repeated id is tried once');
      const ids = t.json('library.json').works.map((w) => w.id);
      assert.ok(!ids.includes(drop) && ids.includes(keep));
    } finally { t.done(); }
  });

  it('never calls deps.trash for an escaping path (a tampered library) and says why', async () => {
    const { t, drop } = await indexed();
    try {
      const lib = t.json('library.json');
      lib.idMap.entries.find((e) => e.id === drop).rel = 'imports:..\\..\\escape.png';
      fs.writeFileSync(path.join(t.cosmosDir, 'library.json'), JSON.stringify(lib));
      const r = await t.c.trash([drop]);
      assert.deepEqual(r.trashed, []);
      assert.ok(r.failed[0].message);
      assert.equal(t.trashCalls.length, 0);
    } finally { t.done(); }
  });

  it('a file that has vanished is a failed row, not a call', async () => {
    const { t, drop } = await indexed();
    try {
      fs.rmSync(path.join(t.importsDir, 'drop.png'));
      const r = await t.c.trash([drop]);
      assert.match(r.failed[0].message, /no longer there/);
      assert.equal(t.trashCalls.length, 0);
    } finally { t.done(); }
  });

  it('trash is refused while an index is running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const hooks = {};
    const { t, drop } = await indexed({ hooks });
    try {
      hooks.before = async () => { await gate; };
      await t.c.index();
      await tick();
      const r = await t.c.trash([drop]);
      assert.match(r.failed[0].message, /index is running/);
      assert.equal(t.trashCalls.length, 0);
      release();
      await t.settle();
    } finally { t.done(); }
  });

  it('reveal works for any indexed element, by id only, and fails honestly otherwise', async () => {
    const { t, pic, drop } = await indexed();
    try {
      assert.equal(await t.c.reveal(pic), true);
      assert.equal(await t.c.reveal(drop), true);
      assert.equal(t.revealCalls.length, 2);
      assert.equal(path.basename(t.revealCalls[0]), 'a.png');
      for (const bad of ['ghost', '', null, 5, {}, '../x', 'x'.repeat(400)]) {
        const r = await t.c.reveal(bad);
        assert.equal(r.ok, false, String(bad));
        assert.ok(r.message);
      }
      assert.equal(t.revealCalls.length, 2);
      fs.rmSync(path.join(t.root, 'c.png'));
      assert.equal((await t.c.reveal(idOf((await t.c.read()).works, 'c.png'))).ok, false);
    } finally { t.done(); }
  });

  it('reveal refuses a link that points out of the library (junction)', async (ctx) => {
    const { t, works } = await indexed();
    try {
      const outside = path.join(t.base, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.png'), 'x');
      try { fs.symlinkSync(outside, path.join(t.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) {
        ctx.skip('SKIPPED LOUDLY: could not create a junction (' + e.code + '); paths.test.mjs covers the rule with a fake realpath');
        return;
      }
      // the engine does not follow links; a tampered library that lists a file behind one must still be refused
      const lib = t.json('library.json');
      lib.idMap.entries.push({ rel: 'link/secret.png', id: 'link-secret-png' });
      lib.works.push({ id: 'link-secret-png', rel: 'link/secret.png', width: 1, height: 1 });
      fs.writeFileSync(path.join(t.cosmosDir, 'library.json'), JSON.stringify(lib));
      const r = await t.c.reveal('link-secret-png');
      assert.equal(r.ok, false);
      assert.equal(t.revealCalls.length, 0);
      assert.ok(works.length > 0);
    } finally { t.done(); }
  });
});

describe('importFiles', () => {
  it('does nothing without a configured root', async () => {
    const t = setup();
    try {
      const src = path.join(t.base, 'incoming.png');
      fs.writeFileSync(src, 'x');
      const r = await t.c.importFiles([src]);
      assert.deepEqual(r, { imported: 0, skipped: [{ path: src, reason: 'Index a folder first.' }] });
      assert.ok(!t.exists('imports'));
      assert.equal(t.engine.calls.length, 0);
    } finally { t.done(); }
  });

  it('skips relative paths, folders, unsupported types and missing files; copies the rest with collision names; then indexes in the background', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const inc = path.join(t.base, 'incoming');
      fs.mkdirSync(inc);
      fs.writeFileSync(path.join(inc, 'shot.png'), 'one');
      fs.writeFileSync(path.join(inc, 'notes.txt'), 'x');
      fs.writeFileSync(path.join(inc, 'clip.mp4'), 'v');
      fs.mkdirSync(path.join(inc, 'folder.png'));
      const second = path.join(t.base, 'incoming2');
      fs.mkdirSync(second);
      fs.writeFileSync(path.join(second, 'shot.png'), 'two');
      const before = t.engine.calls.length;
      const r = await t.c.importFiles([
        path.join(inc, 'shot.png'), 'relative/shot.png', path.join(inc, 'notes.txt'), path.join(inc, 'folder.png'),
        path.join(inc, 'missing.png'), path.join(second, 'shot.png'), path.join(inc, 'clip.mp4'), 42, null,
      ]);
      assert.equal(r.imported, 3);
      assert.equal(r.skipped.length, 6);
      assert.deepEqual(fs.readdirSync(t.importsDir).sort(), ['clip.mp4', 'shot (2).png', 'shot.png']);
      assert.equal(fs.readFileSync(path.join(t.importsDir, 'shot (2).png'), 'utf8'), 'two');
      assert.equal(fs.readFileSync(path.join(inc, 'shot.png'), 'utf8'), 'one', 'the source is only read');
      assert.equal(t.engine.calls.length, before + 1, 'one background index ran');
      await t.settle();
      const works = (await t.c.read()).works;
      assert.ok(works.some((w) => w.rel === 'imports:shot (2).png'));
    } finally { t.done(); }
  });

  it('returns skipped reasons as sentences and never throws on garbage', async () => {
    const t = setup();
    try {
      await t.indexNow();
      for (const bad of [null, undefined, 'x', 5, {}, [], [[]], [{}]]) {
        const r = await t.c.importFiles(bad);
        assert.equal(r.imported, 0);
      }
      const r = await t.c.importFiles(Array.from({ length: 1001 }, () => 'x'));
      assert.match(r.skipped[0].reason, /at most 1000/);
    } finally { t.done(); }
  });

  it('files dropped while an index runs trigger exactly one more index afterwards', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const hooks = {};
    const t = setup({ hooks });
    try {
      await t.indexNow();
      hooks.before = async () => { await gate; hooks.before = null; };
      await t.c.index();
      await tick();
      const src = path.join(t.base, 'late.png');
      fs.writeFileSync(src, 'x');
      const calls = t.engine.calls.length;
      assert.equal((await t.c.importFiles([src])).imported, 1);
      release();
      await t.settle();
      assert.equal(t.engine.calls.length, calls + 1);
      assert.ok((await t.c.read()).works.some((w) => w.rel === 'imports:late.png'));
    } finally { t.done(); }
  });
});

describe('importFromLocal', () => {
  const backupOf = (id, extra = {}) => ({
    app: 'cosmos-local', version: 1, exportedAt: '2026-02-01T00:00:00.000Z',
    clusters: [{ id: 'cl-old', name: 'Moodboard', elementIds: [id], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    favorites: { [id]: true }, hidden: {}, overrides: { [id]: { title: 'Hero' } }, ...extra,
  });
  const manifestOf = () => ({ version: 1, generatedAt: 'x', works: [{ id: 'old-a', src: '/media/alpha/a.png' }, { id: 'old-gone', src: '/media/gone/g.png' }, { id: 'clip-1', src: '/clips/c.png' }] });
  function files(t, backup, manifest) {
    const b = path.join(t.base, 'backup.json');
    fs.writeFileSync(b, JSON.stringify(backup));
    const out = { backup: b };
    if (manifest) { out.manifest = path.join(t.base, 'manifest.json'); fs.writeFileSync(out.manifest, JSON.stringify(manifest)); }
    return out;
  }

  it('order 1 (index first): re-keys the unreferenced minted id to the manifest id, reserves the old one, renames the thumbnail, merges', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const minted = idOf((await t.c.read()).works, 'alpha/a.png');
      const f = files(t, backupOf('old-a'), manifestOf());
      t.dialogs.files.push(f.backup, f.manifest);
      const r = await t.c.importFromLocal();
      assert.equal(r.rekeyed, 1);
      assert.equal(r.seeded, 1, 'the file that is not indexed is seeded so its curation still works');
      assert.equal(r.skippedCount, 1);
      assert.equal(r.skipped[0].reason, 'no-path');
      assert.deepEqual([r.clusters, r.favorites, r.overrides, r.missingCount], [1, 1, 1, 0]);
      assert.equal(r.manifest, 'used');
      assert.equal(r.token, null);
      assert.match(r.note, /Imported 1 cluster, 1 favourite/);
      const lib = t.json('library.json');
      assert.equal(lib.works.find((w) => w.rel === 'alpha/a.png').id, 'old-a');
      assert.ok(lib.idMap.entries.some((e) => e.rel === `retired:${minted}` && e.id === minted));
      assert.ok(lib.idMap.entries.some((e) => e.id === 'old-gone'));
      assert.ok(fs.existsSync(path.join(t.cosmosDir, 'thumbs', 'old-a.jpg')));
      assert.ok(!fs.existsSync(path.join(t.cosmosDir, 'thumbs', `${minted}.jpg`)));
      const read = await t.c.read();
      assert.deepEqual(read.curation.favorites, { 'old-a': true });
      assert.equal(read.works.find((w) => w.id === 'old-a').thumbUrl.endsWith('/thumbs/old-a.jpg'), true);
      // the minted id can no longer be used
      assert.match((await t.c.apply({ type: 'favorite', id: minted, on: true })).error, /retired/);
    } finally { t.done(); }
  });

  it('order 1 with a favourited minted id: that element is NOT re-keyed and the report says so', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const minted = idOf((await t.c.read()).works, 'alpha/a.png');
      await t.c.apply({ type: 'favorite', id: minted, on: true });
      const f = files(t, backupOf('old-a'), manifestOf());
      t.dialogs.files.push(f.backup, f.manifest);
      const r = await t.c.importFromLocal();
      assert.equal(r.rekeyed, 0);
      assert.equal(r.notMatchedCount, 1);
      assert.equal(r.notMatched[0].reason, 'referenced');
      assert.equal(t.json('library.json').works.find((w) => w.rel === 'alpha/a.png').id, minted);
    } finally { t.done(); }
  });

  it('order 2 (import first): the seeded ids wait in library.json (state stays empty) and the first index starts from them', async () => {
    const t = setup();
    try {
      const f = files(t, backupOf('old-a'), manifestOf());
      t.dialogs.files.push(f.backup, f.manifest);
      const r = await t.c.importFromLocal();
      assert.equal(r.seeded, 2);
      assert.equal(r.rekeyed, 0);
      assert.equal(r.missingCount, 1, 'old-a is not indexed yet');
      const stub = t.json('library.json');
      assert.deepEqual(stub.works, []);
      assert.equal(stub.root, null);
      assert.equal(stub.idMap.entries.length, 2);
      const mid = await t.c.read();
      assert.equal(mid.state, 'empty');
      assert.deepEqual(mid.curation.favorites, { 'old-a': true });
      await t.indexNow();
      const works = (await t.c.read()).works;
      assert.equal(idOf(works, 'alpha/a.png'), 'old-a');
      assert.equal(t.engine.calls[0].oldLibrary.idMap.entries.length, 2);
      assert.equal((await t.c.read()).state, 'ready');
    } finally { t.done(); }
  });

  it('canceling the backup dialog is {ok:false, reason:canceled}; canceling the manifest dialog imports without ids and says so', async () => {
    const t = setup();
    try {
      let r = await t.c.importFromLocal();
      assert.deepEqual([r.ok, r.reason], [false, 'canceled']);
      const f = files(t, backupOf('old-a'));
      t.dialogs.files.push(f.backup);
      r = await t.c.importFromLocal();
      assert.equal(r.manifest, 'skipped');
      assert.equal(r.seeded, 0);
      assert.match(r.note, /No manifest was chosen/);
      assert.deepEqual(t.json('curation.json').favorites, { 'old-a': true });
      assert.ok(!t.exists('library.json'), 'nothing to seed, nothing written');
    } finally { t.done(); }
  });

  it('refuses a backup that is not one, an unreadable file, and an import during an index; HQ_COSMOS_IMPORT_* replace the dialogs', async () => {
    const t = setup();
    try {
      const bad = path.join(t.base, 'bad.json');
      fs.writeFileSync(bad, '{"app":"other"}');
      const c2 = cosmos.create({ dataDir: t.dataDir, deps: { pickFile: async () => { throw new Error('dialog opened'); } }, env: { HQ_COSMOS_IMPORT_BACKUP: bad }, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      let r = await c2.importFromLocal();
      assert.deepEqual([r.ok, r.reason], [false, 'bad-backup']);
      const c3 = cosmos.create({ dataDir: t.dataDir, deps: null, env: { HQ_COSMOS_IMPORT_BACKUP: path.join(t.base, 'none.json') }, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      r = await c3.importFromLocal();
      assert.equal(r.reason, 'unreadable');
      const good = files(t, backupOf('old-a'), manifestOf());
      const c4 = cosmos.create({ dataDir: t.dataDir, deps: { pickFile: async () => { throw new Error('dialog opened'); } }, env: { HQ_COSMOS_IMPORT_BACKUP: good.backup, HQ_COSMOS_IMPORT_MANIFEST: good.manifest }, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      r = await c4.importFromLocal();
      assert.equal(r.manifest, 'used');
      assert.equal(r.favorites, 1);
      const junkManifest = path.join(t.base, 'junk-manifest.json');
      fs.writeFileSync(junkManifest, '{ nope');
      const c5 = cosmos.create({ dataDir: t.dataDir, deps: null, env: { HQ_COSMOS_IMPORT_BACKUP: good.backup, HQ_COSMOS_IMPORT_MANIFEST: junkManifest }, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      assert.equal((await c5.importFromLocal()).manifest, 'unreadable');
    } finally { t.done(); }
  });

  it('refuses while an index is running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const t = setup({ hooks: { before: async () => { await gate; } } });
    try {
      await t.c.pickFolder();
      await t.c.index();
      await tick();
      assert.equal((await t.c.importFromLocal()).reason, 'running');
      release();
      await t.settle();
    } finally { t.done(); }
  });

  it('holds back conflicting entries under a token for 10 minutes; import-replace uses it once, and an expired or unknown token is refused', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const id = idOf((await t.c.read()).works, 'alpha/a.png');
      await t.c.apply({ type: 'title', id, title: 'Mine' });
      const f = files(t, backupOf(id));
      t.dialogs.files.push(f.backup, null);
      const r = await t.c.importFromLocal();
      assert.equal(r.conflicts, 1);
      assert.match(r.token, /^[0-9a-f]{32}$/);
      assert.equal(t.json('curation.json').overrides[id].title, 'Mine', 'yours is kept');
      const done = await t.c.apply({ type: 'import-replace', token: r.token });
      assert.equal(done.view.curation.overrides[id].title, 'Hero');
      assert.match((await t.c.apply({ type: 'import-replace', token: r.token })).error, /can no longer be replaced/);

      await t.c.apply({ type: 'title', id, title: 'Mine again' });
      t.dialogs.files.push(f.backup, null);
      const r2 = await t.c.importFromLocal();
      t.clock.advance(10 * 60 * 1000 + 1);
      assert.match((await t.c.apply({ type: 'import-replace', token: r2.token })).error, /can no longer be replaced/);
      assert.equal(t.json('curation.json').overrides[id].title, 'Mine again');
      assert.match((await t.c.apply({ type: 'import-replace', token: 'deadbeefdeadbeef' })).error, /can no longer be replaced/);
    } finally { t.done(); }
  });

  it('a re-import changes nothing and holds nothing', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const id = idOf((await t.c.read()).works, 'alpha/a.png');
      const f = files(t, backupOf(id));
      t.dialogs.files.push(f.backup, null);
      await t.c.importFromLocal();
      const snap = fs.readFileSync(path.join(t.cosmosDir, 'curation.json'), 'utf8');
      t.dialogs.files.push(f.backup, null);
      const r = await t.c.importFromLocal();
      assert.deepEqual([r.clusters, r.favorites, r.overrides, r.conflicts, r.token], [0, 0, 0, 0, null]);
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, 'curation.json'), 'utf8'), snap);
    } finally { t.done(); }
  });
});

describe('no handler throws', () => {
  it('feeds garbage to every handler', async () => {
    const t = setup();
    try {
      const junk = [undefined, null, 0, -1, NaN, '', 'x', '\0', {}, [], [[]], { type: {} }, () => {}, Symbol.iterator.toString()];
      for (const j of junk) {
        for (const name of ['read', 'apply', 'trash', 'reveal', 'importFiles']) await assert.doesNotReject(async () => t.c[name](j), `${name}(${String(j)})`);
      }
      await assert.doesNotReject(async () => t.c.cancelIndex());
      await assert.doesNotReject(async () => t.c.pickFolder());
      const ipcMain = { handle: (ch, fn) => ipcMain[ch] = fn };
      cosmos.init({ ipcMain, dataDir: t.dataDir, getWin: () => null, castSend: () => {}, deps: null });
      for (const ch of Object.keys(ipcMain).filter((k) => k.startsWith('hq:'))) {
        for (const j of junk) await assert.doesNotReject(async () => ipcMain[ch]({}, j), `${ch}(${String(j)})`);
      }
    } finally { t.done(); }
  });

  it('missing helpers answer honestly instead of throwing', async () => {
    const t = setup();
    try {
      await t.indexNow();
      const c = cosmos.create({ dataDir: t.dataDir, deps: null, engine: t.engine, timers: t.clock.timers, now: t.clock.now });
      const works = (await c.read()).works;
      assert.equal((await c.reveal(works[0].id)).ok, false);
      assert.equal(await c.pickFolder(), null);
      assert.equal((await c.importFromLocal()).reason, 'canceled');
      assert.equal((await c.trash([works[0].id])).trashed.length, 0);
    } finally { t.done(); }
  });
});

describe('progress gate', () => {
  it('coalesces to the latest value, spaces deliveries by 260 ms and delivers the last one', () => {
    const clock = makeClock();
    const out = [];
    const g = cosmos.makeProgressGate({ now: () => clock.t, emit: (p) => out.push([clock.t - T0, p.n]), timers: clock.timers });
    g.push({ n: 1 });
    g.push({ n: 2 });
    g.push({ n: 3 });
    assert.deepEqual(out, [[0, 1]]);
    clock.advance(260);
    assert.deepEqual(out, [[0, 1], [260, 3]]);
    g.push({ n: 4 });
    clock.advance(100);
    g.push({ n: 5 });
    let finished = false;
    g.finish().then(() => { finished = true; });
    clock.advance(1000);
    assert.deepEqual(out.map((o) => o[1]), [1, 3, 5]);
    return tick().then(() => assert.equal(finished, true));
  });
  it('a throwing emit does not stop later deliveries', () => {
    const clock = makeClock();
    let n = 0;
    const g = cosmos.makeProgressGate({ now: () => clock.t, emit: () => { n += 1; throw new Error('window closed'); }, timers: clock.timers });
    g.push({});
    clock.advance(300);
    g.push({});
    assert.equal(n, 2);
  });
});

describe('sources', () => {
  it('cosmos.js and the non-test modules under cosmos/ import no network or process module and call no fetch', () => {
    const files = [path.join(here, 'cosmos.js')];
    const dir = path.join(here, 'cosmos');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) files.push(path.join(dir, f));
    assert.ok(files.length >= 8);
    const banned = /(?:require\s*\(|import\s*\(|from\s+|import\s+)\s*['"](?:node:)?(?:https?|http2|net|dns|tls|dgram|child_process|worker_threads|cluster)['"]/;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(!banned.test(src), path.basename(f));
      assert.ok(!/\bfetch\s*\(/.test(src), path.basename(f));
      assert.ok(!/\b(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(src), path.basename(f));
    }
  });
  it('electron is not required at module load', () => {
    const src = fs.readFileSync(path.join(here, 'cosmos.js'), 'utf8');
    assert.ok(!/^\s*(?:const|let|var)\s+[^=\n]*=\s*require\(\s*['"]electron['"]\s*\)/m.test(src));
  });
});
