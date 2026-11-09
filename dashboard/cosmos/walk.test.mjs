// Cosmos space — the folder walk (dashboard/cosmos/walk.mjs). Temp dirs for the real-fs cases, a fake io
// for the limit cases. Placeholder names only.
//   node --test dashboard/cosmos/walk.test.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walk, entryFromDirent, SKIP_DIR_NAMES, WALK_LIMITS } from './walk.mjs';

const realIo = {
  async readdir(dir) {
    return (await fs.promises.readdir(dir, { withFileTypes: true })).map(entryFromDirent);
  },
  async stat(abs) {
    const s = await fs.promises.stat(abs);
    return { size: s.size, mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs };
  },
};

/** A fake io over a tree: { 'a.png': 1000 (mtimeMs), sub: { ... }, link: '@link' }. */
function fakeIo(rootDir, tree, { size = 10, throwIn = [] } = {}) {
  const dirs = new Map();
  const stats = new Map();
  let reads = 0;
  const build = (dir, spec) => {
    const entries = [];
    for (const [name, v] of Object.entries(spec)) {
      if (v === '@link') entries.push({ name, isDir: false, isFile: false, isSymlink: true });
      else if (typeof v === 'object') { entries.push({ name, isDir: true, isFile: false, isSymlink: false }); build(`${dir}/${name}`, v); }
      else { entries.push({ name, isDir: false, isFile: true, isSymlink: false }); stats.set(`${dir}/${name}`, { size, mtimeMs: v, birthtimeMs: v - 5 }); }
    }
    dirs.set(dir, entries);
  };
  build(rootDir, tree);
  return {
    get reads() { return reads; },
    async readdir(dir) {
      reads += 1;
      if (throwIn.includes(dir)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      if (!dirs.has(dir)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return dirs.get(dir);
    },
    async stat(abs) {
      if (!stats.has(abs)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return stats.get(abs);
    },
  };
}

describe('walk on a real temp tree', () => {
  let root;
  let outside;
  let linkNote = null;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-walk-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-walk-out-'));
    const put = (rel, mtimeSec, dir = root) => {
      const abs = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
      fs.utimesSync(abs, mtimeSec, mtimeSec);
    };
    put('alpha-site/Hero.PNG', 3000);
    put('alpha-site/deep/er/shot.jpg', 5000);
    put('beta/clip.MP4', 4000);
    put('beta/tie-b.webp', 2000);
    put('beta/Tie-A.webp', 2000);
    put('root.gif', 1000);
    put('notes.txt', 9000);
    put('page.html', 9000);
    put('.hidden-ext', 9000);
    for (const d of ['_clips', 'node_modules', '.git', '.obsidian', '.trash', '.thumbnails', '$RECYCLE.BIN', 'System Volume Information', '.TRASH']) {
      put(`${d}/skipme.png`, 8000);
    }
    put('beta/_Clips/nested-skip.png', 8000);
    put('secret.png', 7000, outside);
    try {
      fs.symlinkSync(outside, path.join(root, 'out-link'), 'junction');
      fs.symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'file-link.png'), 'file');
    } catch (e) {
      linkNote = e.code || String(e);
    }
  });
  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('lists pictures and videos newest first with "/" separators, honouring the skip list', async () => {
    const r = await walk({ roots: [{ prefix: '', dir: root }], io: realIo });
    assert.deepEqual(r.files.map((f) => f.rel), [
      'alpha-site/deep/er/shot.jpg',
      'beta/clip.MP4',
      'alpha-site/Hero.PNG',
      'beta/Tie-A.webp',    // same mtime as tie-b: the lower-cased path decides
      'beta/tie-b.webp',
      'root.gif',
    ]);
    assert.ok(r.files.every((f) => !f.rel.includes('\\')));
    assert.equal(r.truncated, false);
    assert.equal(r.unreadable, 0);
    assert.ok(r.skippedDirs >= 8, `skipped dirs: ${r.skippedDirs}`);
    const clip = r.files.find((f) => f.rel === 'beta/clip.MP4');
    assert.equal(clip.kind, 'video');
    assert.equal(clip.ext, '.mp4');
    assert.equal(clip.size, 1);
    assert.equal(r.files.find((f) => f.rel === 'root.gif').kind, 'image');
    assert.equal(path.normalize(clip.abs), path.join(root, 'beta', 'clip.MP4'));
  });

  it('never follows a symlink or junction out of the root', async () => {
    if (linkNote) {
      console.warn(`\n!! walk.test.mjs: SKIPPED the real symlink check (cannot create links here: ${linkNote}); the fake-io symlink test below still runs !!\n`);
      return;
    }
    const r = await walk({ roots: [{ prefix: '', dir: root }], io: realIo });
    assert.ok(!r.files.some((f) => f.rel.includes('secret') || f.rel.startsWith('out-link') || f.rel === 'file-link.png'));
    assert.ok(r.skippedLinks >= 1);
  });

  it('adds the imports root with its prefix', async () => {
    const imp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-walk-imp-'));
    try {
      fs.writeFileSync(path.join(imp, 'Copied Item.png'), 'x');
      const r = await walk({ roots: [{ prefix: '', dir: root }, { prefix: 'imports:', dir: imp }], io: realIo });
      const f = r.files.find((x) => x.rel.startsWith('imports:'));
      assert.equal(f.rel, 'imports:Copied Item.png');
      assert.equal(r.files.length, 7);
    } finally {
      fs.rmSync(imp, { recursive: true, force: true });
    }
  });
});

describe('walk with a fake io', () => {
  it('Windows-style roots and names come out with "/" and keep the backslash join', async () => {
    const BS = String.fromCharCode(92);
    const ROOT = 'C:' + BS + 'pics';
    const SUB = BS + 'sub';
    const f = (name) => ({ name, isDir: false, isFile: true, isSymlink: false });
    const io = {
      async readdir(dir) {
        if (dir === ROOT) return [f('a.png'), { name: 'sub', isDir: true, isFile: false, isSymlink: false }];
        if (dir === ROOT + SUB) return [f('b.jpg')];
        throw new Error('unexpected dir ' + dir);
      },
      async stat(abs) { return { size: 1, mtimeMs: abs.endsWith('a.png') ? 5 : 4, birthtimeMs: 0 }; },
    };
    const r = await walk({ roots: [{ prefix: '', dir: ROOT }], io });
    assert.deepEqual(r.files.map((x) => x.rel), ['a.png', 'sub/b.jpg']);
    assert.equal(r.files[1].abs, ROOT + SUB + BS + 'b.jpg');
  });

  it('extension filter is case-insensitive and rejects other types', async () => {
    const io = fakeIo('/r', { 'a.PNG': 9, 'b.JpEg': 8, 'c.txt': 7, 'd.html': 6, 'e.svg': 5, 'f.MOV': 4, 'g.exe': 3, '.png': 2, noext: 1 });
    const r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.deepEqual(r.files.map((f) => f.rel), ['a.PNG', 'b.JpEg', 'e.svg', 'f.MOV']);
  });

  it('symlink and junction entries are skipped (fake flag; the cannot-leave-the-root guarantee)', async () => {
    const io = fakeIo('/r', { 'a.png': 9, 'shortcut.png': '@link', 'dirlink': '@link', real: { 'b.png': 8 } });
    const r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.deepEqual(r.files.map((f) => f.rel), ['a.png', 'real/b.png']);
    assert.equal(r.skippedLinks, 2);
  });

  it('the skip list is exact and case-insensitive', async () => {
    assert.ok(SKIP_DIR_NAMES.includes('_clips') && SKIP_DIR_NAMES.includes('System Volume Information'));
    const io = fakeIo('/r', { _CLIPS: { 'a.png': 1 }, 'clips': { 'b.png': 2 }, '$recycle.bin': { 'c.png': 3 }, node_modules: { 'd.png': 4 } });
    const r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.deepEqual(r.files.map((f) => f.rel), ['clips/b.png']);
    assert.equal(r.skippedDirs, 3);
  });

  it('createdMs prefers the birth time, else the mtime', async () => {
    const io = fakeIo('/r', { 'a.png': 100 });
    let r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.equal(r.files[0].createdMs, 95);
    io.stat = async () => ({ size: 1, mtimeMs: 100, birthtimeMs: 0 });
    r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.equal(r.files[0].createdMs, 100);
  });

  it('an unreadable directory is counted, not thrown', async () => {
    const io = fakeIo('/r', { 'a.png': 9, bad: { 'x.png': 8 }, ok: { 'y.png': 7 } }, { throwIn: ['/r/bad'] });
    const r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.deepEqual(r.files.map((f) => f.rel), ['a.png', 'ok/y.png']);
    assert.equal(r.unreadable, 1);
    assert.equal(r.truncated, false);
    // a file whose stat fails is counted too
    io.stat = async (abs) => { if (abs.endsWith('a.png')) throw new Error('locked'); return { size: 1, mtimeMs: 1, birthtimeMs: 1 }; };
    const r2 = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.equal(r2.unreadable, 2);
    assert.deepEqual(r2.files.map((f) => f.rel), ['ok/y.png']);
  });

  it('a missing root is one unreadable directory, not a crash', async () => {
    const io = fakeIo('/r', {});
    const r = await walk({ roots: [{ prefix: '', dir: '/nope' }], io });
    assert.deepEqual(r, { files: [], skippedDirs: 0, skippedLinks: 0, unreadable: 1, truncated: false });
  });

  it('depth 32: a file 32 directories down is kept, the 33rd level sets truncated', async () => {
    assert.equal(WALK_LIMITS.maxDepth, 32);
    const chain = (n) => { let t = { [`f${n}.png`]: 1 }; for (let i = n - 1; i >= 1; i -= 1) t = { [`f${i}.png`]: 1, d: t }; return t; };
    // chain(33): f1.png at depth 0 ... f33.png at depth 32 (inside 32 nested "d" dirs) -> all kept
    let r = await walk({ roots: [{ prefix: '', dir: '/r' }], io: fakeIo('/r', chain(33)) });
    assert.equal(r.files.length, 33);
    assert.equal(r.truncated, false);
    // chain(35): levels 33.. would need directories deeper than 32
    r = await walk({ roots: [{ prefix: '', dir: '/r' }], io: fakeIo('/r', chain(35)) });
    assert.equal(r.files.length, 33);
    assert.equal(r.truncated, true);
  });

  it('the file cap stops the walk and sets truncated (small cap, and the real 200000 default)', async () => {
    const tree = {};
    for (let i = 0; i < 50; i += 1) tree[`p${i}.png`] = i;
    let r = await walk({ roots: [{ prefix: '', dir: '/r' }], io: fakeIo('/r', tree), limits: { maxFiles: 10 } });
    assert.equal(r.files.length, 10);
    assert.equal(r.truncated, true);
    r = await walk({ roots: [{ prefix: '', dir: '/r' }], io: fakeIo('/r', tree), limits: { maxFiles: 50 } });
    assert.equal(r.files.length, 50);
    assert.equal(r.truncated, false);

    assert.equal(WALK_LIMITS.maxFiles, 200000);
    const big = Array.from({ length: 200001 }, (_, i) => ({ name: `f${i}.png`, isDir: false, isFile: true, isSymlink: false }));
    const io = { readdir: async () => big, stat: async () => ({ size: 1, mtimeMs: 1, birthtimeMs: 1 }) };
    r = await walk({ roots: [{ prefix: '', dir: '/r' }], io });
    assert.equal(r.files.length, 200000);
    assert.equal(r.truncated, true);
  });

  it('a full pictures root still lets the imports root be walked (the cap is per root)', async () => {
    const dirs = {
      '/p': [{ name: 'a.png', isDir: false, isFile: true, isSymlink: false }, { name: 'b.png', isDir: false, isFile: true, isSymlink: false }, { name: 'c.png', isDir: false, isFile: true, isSymlink: false }],
      '/imp': [{ name: 'dropped.png', isDir: false, isFile: true, isSymlink: false }],
    };
    const io = { readdir: async (d) => dirs[d], stat: async () => ({ size: 1, mtimeMs: 1, birthtimeMs: 1 }) };
    const r = await walk({ roots: [{ prefix: '', dir: '/p' }, { prefix: 'imports:', dir: '/imp' }], io, limits: { maxFiles: 2 } });
    assert.equal(r.truncated, true);
    assert.ok(r.files.some((f) => f.rel === 'imports:dropped.png'), 'the dropped-in work is still in the library');
    assert.equal(r.files.filter((f) => !f.rel.startsWith('imports:')).length, 2);
  });

  it('yields every 200 directory entries', async () => {
    const tree = {};
    for (let i = 0; i < 450; i += 1) tree[`n${i}.txt`] = 1;
    let yields = 0;
    await walk({ roots: [{ prefix: '', dir: '/r' }], io: fakeIo('/r', tree), yieldNow: async () => { yields += 1; } });
    assert.equal(yields, 2);
  });

  it('cancel stops the walk with { cancelled: true }', async () => {
    const io = fakeIo('/r', { a: { 'x.png': 1 }, b: { 'y.png': 2 }, c: { 'z.png': 3 } });
    let polls = 0;
    const r = await walk({ roots: [{ prefix: '', dir: '/r' }], io, isCancelled: () => { polls += 1; return polls > 2; } });
    assert.deepEqual(r, { cancelled: true });
    assert.ok(io.reads < 4);
  });
});
