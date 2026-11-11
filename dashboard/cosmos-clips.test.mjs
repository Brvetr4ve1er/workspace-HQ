// Cosmos clips, the service half (dashboard/cosmos/clips.mjs makeClipService) over the REAL cosmos.js create(), the REAL indexer and
// the real store / curation / path rules, in temp folders, with fake thumbnail / Recycle Bin deps. Placeholder hosts and generated
// tiny images only (cosmos/testimages.mjs).
//   node --test dashboard/cosmos-clips.test.mjs
// cosmos.js is wired (batch 3): every finished index run calls its own clip service's afterIndex(). The service built here is a
// second one over the same folders (so the tests can inject a failing apply or a spy fs); where the run already applied a note the test
// asserts that, and where a failure path is under test the note is put back to waiting first.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeClipService, MANIFEST_FILE, TMP_DIR, readManifest, writeManifest } from './cosmos/clips.mjs';
import { solidPng } from './cosmos/testimages.mjs';

const require = createRequire(import.meta.url);
const cosmos = require('./cosmos.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const HAVE_INDEXER = fs.existsSync(path.join(here, 'cosmos', 'indexer.mjs'));
const SKIP = HAVE_INDEXER ? false : 'SKIPPED LOUDLY: dashboard/cosmos/indexer.mjs does not exist';

const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const png = (r, g, b) => Buffer.from(solidPng(r, g, b, 8, 8));
const jpegBytes = (n = 40) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(n, 7)]);
const mp4Bytes = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(40, 1)]);

/** node:fs with every write recorded: the paths a clip touched must all be under data/cosmos. */
function spyFs(real, writes, opens = []) {
  const out = { ...real };
  for (const n of ['writeFileSync', 'mkdirSync', 'unlinkSync', 'copyFileSync', 'rmSync', 'appendFileSync', 'truncateSync']) out[n] = (p, ...a) => { writes.push(String(p)); return real[n](p, ...a); };
  for (const n of ['renameSync', 'linkSync', 'symlinkSync']) out[n] = (a, b, ...r) => { writes.push(String(a), String(b)); return real[n](a, b, ...r); };
  const P = real.promises;
  out.promises = {
    ...P,
    open: async (p, flags = 'r', ...r) => { if (/[wa+]/.test(String(flags))) { writes.push(String(p)); opens.push({ p: String(p), flags: String(flags) }); } return P.open(p, flags, ...r); },
    link: async (a, b) => { writes.push(String(a), String(b)); return P.link(a, b); },
    rename: async (a, b) => { writes.push(String(a), String(b)); return P.rename(a, b); },
    unlink: async (p) => { writes.push(String(p)); return P.unlink(p); },
    copyFile: async (a, b, ...r) => { writes.push(String(a), String(b)); return P.copyFile(a, b, ...r); },
    writeFile: async (p, ...r) => { writes.push(String(p)); return P.writeFile(p, ...r); },
    mkdir: async (p, ...r) => { writes.push(String(p)); return P.mkdir(p, ...r); },
  };
  return out;
}

function setup({ maxBytes } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-clips-svc-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'library');
  const grabRoot = path.join(base, 'Downloads', 'WorkspaceHQ', 'grabs');
  fs.mkdirSync(path.join(root, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(grabRoot, 'alpha-site.test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'alpha', 'seed.png'), png(1, 2, 3));
  const trashCalls = [];
  const deps = {
    pickFolder: async () => root,
    pickFile: async () => null,
    trash: async (abs) => { trashCalls.push(abs); fs.rmSync(abs); },
    reveal: () => {},
    thumbnail: async (abs) => ({
      jpeg: Buffer.from('jpeg:' + path.basename(abs)), width: 8, height: 6, sourceWidth: null, sourceHeight: null,
      rgba32: { width: 2, height: 2, data: Uint8Array.from([9, 9, 9, 255, 9, 9, 9, 255, 9, 9, 9, 255, 9, 9, 9, 255]) },
      gray9x8: Uint8Array.from({ length: 72 }, (_, i) => (i * 37 + abs.length) & 255),
    }),
    dispose() {},
  };
  const c = cosmos.create({ dataDir, deps, env: {} });
  const cosmosDir = c.dir;
  const importsDir = path.join(cosmosDir, 'imports');
  const writes = [];
  const opens = [];
  let n = 0;
  let reindexCalls = 0;
  const svc = makeClipService({
    fs: spyFs(fs, writes, opens), cosmosDir, importsDir, maxBytes,
    now: () => new Date(), newId: () => 't' + (++n),
    hasFolder: async () => !!(await c.read()).config.root,
    readWorks: async () => (await c.read({ force: true })).works,
    apply: (intent) => c.apply(intent),
    reindex: async () => { reindexCalls += 1; },
  });
  const put = (host, name, bytes) => { const d = path.join(grabRoot, host); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, name); fs.writeFileSync(f, bytes); return f; };
  const add = (abs, extra = {}) => svc.addClip({ abs, grabRoot, pageUrl: 'https://alpha-site.test/blog/acme-poster-launch?utm=1#x', pageTitle: 'Acme poster launch day', ...extra });
  const index = async () => { await c.pickFolder(); const r = await c.index(); assert.equal(r, true, JSON.stringify(r)); await c.whenIdle(); };
  const manifest = () => readManifest(fs, path.join(cosmosDir, MANIFEST_FILE)).clips;
  const tree = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, d.name); if (d.isDirectory()) tree(p, out); else out.push(p); }
    return out;
  };
  return {
    base, dataDir, root, grabRoot, cosmosDir, importsDir, c, svc, put, add, index, manifest, tree, writes, opens, trashCalls,
    reindexCalls: () => reindexCalls,
    done: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

describe('clips, the service half', { skip: SKIP }, () => {
  it('addClip copies a grabbed file into imports as clip-<hash12>.<ext>; the original stays; the temp never sits in a walked folder', async () => {
    const t = setup();
    try {
      await t.index();
      const bytes = png(200, 30, 30);
      const abs = t.put('alpha-site.test', 'poster-300.png', bytes);
      const r = await t.add(abs);
      assert.equal(r.ok, true);
      assert.equal(r.duplicate, false);
      assert.equal(r.indexed, false);
      const name = `clip-${sha12(bytes)}.png`;
      assert.equal(r.file, name);
      const landed = path.join(t.importsDir, name);
      assert.ok(fs.readFileSync(landed).equals(bytes), 'the copy is byte for byte the original');
      assert.ok(fs.readFileSync(abs).equals(bytes), 'the Downloads original stays');
      assert.deepEqual(fs.readdirSync(t.importsDir), [name], 'only the final file is ever in imports');
      assert.deepEqual(fs.readdirSync(path.join(t.cosmosDir, TMP_DIR)), [], 'the temp is gone');
      assert.equal(t.reindexCalls(), 1);
      // every temp file was made in .grab-tmp, which is neither the walked library nor the walked imports folder
      const wx = t.opens.filter((o) => o.flags === 'wx');
      assert.equal(wx.length, 1);
      assert.equal(path.dirname(wx[0].p), path.join(t.cosmosDir, TMP_DIR));
      for (const walked of [t.root, t.importsDir]) assert.ok(path.relative(walked, wx[0].p).startsWith('..'), walked);
      const m = t.manifest();
      assert.equal(m.length, 1);
      assert.deepEqual([m[0].file, m[0].host, m[0].applied, m[0].title], [name, 'alpha-site.test', false, 'Acme poster launch day']);
      assert.deepEqual(m[0].tags, ['clipped', 'alpha-site.test', 'acme', 'poster', 'launch']);
      assert.ok(!JSON.stringify(m).includes('utm'), 'the query is never stored');
    } finally { t.done(); }
  });

  it('an index run picks the clip up; its tags and title are applied after the run; the entry is then applied', async () => {
    const t = setup();
    try {
      await t.index();
      const abs = t.put('alpha-site.test', 'poster-300.png', png(10, 200, 10));
      const r = await t.add(abs);
      await t.index();
      const read = await t.c.read();
      const w = read.works.find((x) => x.rel === 'imports:' + r.file);
      assert.ok(w, 'the indexer walked the imports folder and found it');
      assert.ok(w.url && w.url.startsWith('file:'), 'a file URL, like any import');
      assert.equal(t.manifest()[0].applied, true, 'the wired run applied the note when it finished');
      const after = await t.c.read({ force: true });
      const o = after.curation.overrides[w.id];
      assert.equal(o.title, 'Acme poster launch day');
      assert.deepEqual(o.tags.slice(0, 2), ['clipped', 'alpha-site.test']);
      assert.equal(t.manifest()[0].applied, true);
      assert.deepEqual(await t.svc.afterIndex(), { applied: 0, waiting: 0 }, 'nothing to do twice');
      // a repeat grab: duplicate, no second work, no new index run, and it now says the clip is indexed
      const calls = t.reindexCalls();
      const again = await t.add(abs);
      assert.deepEqual([again.ok, again.duplicate, again.indexed], [true, true, true]);
      assert.equal(t.reindexCalls(), calls);
      assert.equal((await t.c.read({ force: true })).works.filter((x) => x.rel === 'imports:' + r.file).length, 1);
      assert.equal(t.manifest().length, 1);
    } finally { t.done(); }
  });

  it('a not-yet-indexed entry stays waiting and is retried at the next run', async () => {
    const t = setup();
    try {
      await t.index();
      await t.add(t.put('alpha-site.test', 'a.png', png(1, 1, 1)));
      assert.deepEqual(await t.svc.afterIndex(), { applied: 0, waiting: 1 }, 'the work is not in the library yet');
      assert.equal(t.manifest()[0].applied, false);
      await t.index();
      assert.equal(t.manifest()[0].applied, true, 'the next run, wired, applied it');
      assert.deepEqual(await t.svc.afterIndex(), { applied: 0, waiting: 0 });
    } finally { t.done(); }
  });

  it('a failing or throwing apply leaves the entry waiting; an unreadable library does too', async () => {
    const t = setup();
    try {
      await t.index();
      const writes = [];
      let mode = 'error';
      const svc = makeClipService({
        fs: spyFs(fs, writes), cosmosDir: t.cosmosDir, importsDir: t.importsDir, newId: () => 'x1',
        hasFolder: async () => true,
        readWorks: async () => { if (mode === 'unreadable') throw new Error('nope'); return (await t.c.read({ force: true })).works; },
        apply: async (i) => { if (mode === 'throw') throw new Error('boom'); return mode === 'error' ? { error: 'That did not work' } : t.c.apply(i); },
      });
      await svc.addClip({ abs: t.put('alpha-site.test', 'b.png', png(2, 2, 2)), grabRoot: t.grabRoot });
      await t.index();
      const doc = readManifest(fs, path.join(t.cosmosDir, MANIFEST_FILE));
      for (const e of doc.clips) e.applied = false;   // the wired run applied it; put it back to waiting
      writeManifest(fs, path.join(t.cosmosDir, MANIFEST_FILE), doc.clips);
      assert.deepEqual(await svc.afterIndex(), { applied: 0, waiting: 1 });
      mode = 'throw';
      assert.deepEqual(await svc.afterIndex(), { applied: 0, waiting: 1 });
      mode = 'unreadable';
      assert.deepEqual(await svc.afterIndex(), { applied: 0, waiting: 1 });
      assert.equal(t.manifest()[0].applied, false);
      mode = 'ok';
      assert.deepEqual(await svc.afterIndex(), { applied: 1, waiting: 0 });
    } finally { t.done(); }
  });

  it('a repeat adds no second work: the same bytes under another name and extension are a duplicate too', async () => {
    const t = setup();
    try {
      await t.index();
      const bytes = jpegBytes();
      const a = await t.add(t.put('alpha-site.test', 'one.jpg', bytes));
      const b = await t.add(t.put('alpha-site.test', 'two.JPEG', bytes));
      assert.equal(a.duplicate, false);
      assert.deepEqual([b.ok, b.duplicate, b.file], [true, true, a.file]);
      assert.equal(a.file, `clip-${sha12(bytes)}.jpg`, 'the extension is the sniffed family\'s, so .jpg and .JPEG collapse');
      assert.deepEqual(fs.readdirSync(t.importsDir), [a.file]);
      assert.equal(t.manifest().length, 1);
      assert.equal(t.reindexCalls(), 2, 'a duplicate whose note is still waiting asks for a run again (harmless: runs are single-flight)');
    } finally { t.done(); }
  });

  it('a video lands as .mp4 and is typed motion in the manifest', async () => {
    const t = setup();
    try {
      await t.index();
      const r = await t.add(t.put('alpha-site.test', 'clip.mp4', mp4Bytes()), { pageUrl: '', pageTitle: '' });
      assert.equal(r.ok, true);
      assert.ok(r.file.endsWith('.mp4'));
      assert.deepEqual([t.manifest()[0].type, t.manifest()[0].title, t.manifest()[0].tags], ['motion', 'Grab from alpha-site.test', ['clipped', 'alpha-site.test']]);
    } finally { t.done(); }
  });

  it('nothing is written outside data/cosmos, the grab folder and the library are untouched, and no file appears anywhere else', async () => {
    const t = setup();
    try {
      await t.index();
      const before = t.tree(t.base).filter((p) => !p.startsWith(t.dataDir)).sort();
      const stats = new Map(before.map((p) => [p, fs.statSync(p).mtimeMs + ':' + fs.statSync(p).size]));
      t.writes.length = 0;
      await t.add(t.put('alpha-site.test', 'p.png', png(5, 6, 7)));
      await t.add(t.put('alpha-site.test', 'p2.png', png(7, 6, 5)));
      await t.add(path.join(t.base, 'Downloads', 'not-in-grabs.png'));     // refused
      assert.ok(t.writes.length > 0);
      for (const p of t.writes) assert.ok(!path.relative(t.cosmosDir, p).startsWith('..'), `a write outside data/cosmos: ${p}`);
      const after = t.tree(t.base).filter((p) => !p.startsWith(t.dataDir)).sort();
      const added = after.filter((p) => !before.includes(p));
      assert.deepEqual(added.map((p) => path.basename(p)).sort(), ['p.png', 'p2.png'], 'only the two fixtures this test put in the grab folder');
      for (const [p, s] of stats) assert.equal(fs.statSync(p).mtimeMs + ':' + fs.statSync(p).size, s, 'untouched: ' + p);
    } finally { t.done(); }
  });

  it('no Cosmos folder yet: 409, and nothing is created', async () => {
    const t = setup();
    try {
      const abs = t.put('alpha-site.test', 'p.png', png(5, 6, 7));
      const r = await t.add(abs);
      assert.deepEqual(r, { ok: false, status: 409, error: 'Cosmos has no folder yet' });
      assert.equal(fs.existsSync(t.importsDir), false);
      assert.equal(fs.existsSync(path.join(t.cosmosDir, TMP_DIR)), false);
      assert.equal(t.reindexCalls(), 0);
    } finally { t.done(); }
  });

  it('a clip can be moved to the Recycle Bin like any import; grabbing it again lands it again, as a fresh note', async () => {
    const t = setup();
    try {
      await t.index();
      const abs = t.put('alpha-site.test', 'p.png', png(50, 60, 70));
      const r = await t.add(abs);
      await t.index();
      const w = (await t.c.read({ force: true })).works.find((x) => x.rel === 'imports:' + r.file);
      const out = await t.c.trash([w.id]);
      assert.deepEqual(out.failed, []);
      assert.deepEqual(out.trashed, [w.id]);
      assert.equal(t.trashCalls.length, 1);
      assert.equal(path.basename(t.trashCalls[0]), r.file);
      assert.equal(path.dirname(t.trashCalls[0]).toLowerCase(), t.importsDir.toLowerCase());
      assert.equal(fs.existsSync(path.join(t.importsDir, r.file)), false);
      const again = await t.add(abs);
      assert.deepEqual([again.ok, again.duplicate, again.indexed], [true, false, false]);
      assert.equal(t.manifest().length, 1);
      assert.equal(t.manifest()[0].applied, false);
      assert.ok(fs.existsSync(path.join(t.importsDir, r.file)));
    } finally { t.done(); }
  });

  it('a duplicate whose note was lost (a crash between landing and noting) is repaired once', async () => {
    const t = setup();
    try {
      await t.index();
      const abs = t.put('alpha-site.test', 'p.png', png(11, 22, 33));
      const r = await t.add(abs);
      fs.rmSync(path.join(t.cosmosDir, MANIFEST_FILE));
      const again = await t.add(abs);
      assert.deepEqual([again.ok, again.duplicate], [true, true]);
      assert.deepEqual(t.manifest().map((m) => m.file), [r.file]);
    } finally { t.done(); }
  });

  it('a corrupt clips.json is moved aside and the clip is noted in a fresh one; one that cannot be moved aside stops the line before any copy', async () => {
    const t = setup();
    try {
      await t.index();
      fs.mkdirSync(t.cosmosDir, { recursive: true });
      fs.writeFileSync(path.join(t.cosmosDir, MANIFEST_FILE), '{ nope');
      const r = await t.add(t.put('alpha-site.test', 'p.png', png(1, 9, 9)));
      assert.equal(r.ok, true);
      assert.equal(fs.readFileSync(path.join(t.cosmosDir, MANIFEST_FILE + '.corrupt'), 'utf8'), '{ nope');
      assert.equal(t.manifest().length, 1);
    } finally { t.done(); }
    const u = setup();
    try {
      await u.index();
      fs.writeFileSync(path.join(u.cosmosDir, MANIFEST_FILE), '{ nope');
      const stuck = { ...fs, renameSync: () => { throw new Error('locked'); }, promises: fs.promises };
      const svc = makeClipService({ fs: stuck, cosmosDir: u.cosmosDir, importsDir: u.importsDir, newId: () => 'q', hasFolder: async () => true, readWorks: async () => [], apply: async () => ({}) });
      const r = await svc.addClip({ abs: u.put('alpha-site.test', 'p.png', png(2, 9, 9)), grabRoot: u.grabRoot });
      assert.equal(r.ok, false);
      assert.equal(r.status, 503);
      assert.deepEqual(fs.existsSync(u.importsDir) ? fs.readdirSync(u.importsDir) : [], []);
      assert.equal(fs.readFileSync(path.join(u.cosmosDir, MANIFEST_FILE), 'utf8'), '{ nope', 'never overwritten');
    } finally { u.done(); }
  });

  it('simultaneous grabs are taken one at a time: every note survives', async () => {
    const t = setup();
    try {
      await t.index();
      const files = [1, 2, 3, 4, 5, 6].map((i) => t.put('alpha-site.test', `f${i}.png`, png(i * 10, 5, 5)));
      const results = await Promise.all(files.map((f) => t.add(f)));
      assert.ok(results.every((r) => r.ok && !r.duplicate));
      assert.equal(t.manifest().length, 6);
      assert.equal(fs.readdirSync(t.importsDir).length, 6);
      assert.deepEqual(fs.readdirSync(path.join(t.cosmosDir, TMP_DIR)), []);
    } finally { t.done(); }
  });

  it('a failed copy (a file that is not a clip) leaves no temp file, no import and no note', async () => {
    const t = setup();
    try {
      await t.index();
      const r = await t.add(t.put('alpha-site.test', 'fake.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
      assert.deepEqual([r.ok, r.status], [false, 415]);
      assert.equal(fs.existsSync(t.importsDir) ? fs.readdirSync(t.importsDir).length : 0, 0);
      assert.equal(t.manifest().length, 0);
      assert.deepEqual(fs.existsSync(path.join(t.cosmosDir, TMP_DIR)) ? fs.readdirSync(path.join(t.cosmosDir, TMP_DIR)) : [], []);
    } finally { t.done(); }
  });

  it('sweepTmp removes only orphans older than an hour that look like our temp files', async () => {
    const t = setup();
    try {
      const dir = path.join(t.cosmosDir, TMP_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const old = path.join(dir, 'grab-old1.tmp');
      const fresh = path.join(dir, 'grab-new1.tmp');
      const other = path.join(dir, 'keep-me.txt');
      for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
      const longAgo = (Date.now() - 2 * 3600e3) / 1000;
      fs.utimesSync(old, longAgo, longAgo);
      fs.utimesSync(other, longAgo, longAgo);
      assert.equal(await t.svc.sweepTmp(), 1);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['grab-new1.tmp', 'keep-me.txt']);
      assert.equal(await t.svc.sweepTmp(), 0);
      const none = makeClipService({ fs, cosmosDir: path.join(t.base, 'no-such'), importsDir: 'x', newId: () => 'z', hasFolder: async () => true, readWorks: async () => [], apply: async () => ({}) });
      assert.equal(await none.sweepTmp(), 0, 'a missing folder is not an error');
    } finally { t.done(); }
  });

  it('cosmos.js stays the only writer of data/cosmos: the route and the clip module never import fs themselves', () => {
    const routes = fs.readFileSync(path.join(here, 'grab-routes.js'), 'utf8');
    const clips = fs.readFileSync(path.join(here, 'cosmos', 'clips.mjs'), 'utf8');
    assert.ok(!/require\(['"](node:)?fs['"]\)/.test(routes), 'grab-routes.js has no fs');
    assert.ok(!/from ['"](node:)?fs(\/promises)?['"]/.test(clips), 'clips.mjs gets its fs injected');
    assert.ok(!/\b(fetch|https?\.request|net\.connect)\b/.test(clips.replace(/\/\*[\s\S]*?\*\//g, '')), 'the app never fetches a URL for a clip');
  });
});
