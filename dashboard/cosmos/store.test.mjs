// Cosmos space — the store (dashboard/cosmos/store.mjs). Temp folders, invented ids only.
// The rules under test: every write is atomic; curation.json.prev is the last GOOD copy; a file that will
// not parse (or has the wrong shape) is quarantined and never overwritten; a missing file is a valid empty
// document; a library that will not parse gives its idMap back.
//   node --test dashboard/cosmos/store.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeStore, salvageIdMap, thumbName, normalizeLibrary, emptyLibrary, defaultConfig } from './store.mjs';
import { emptyCuration, emptyCleanup } from './curation.mjs';
import { assignIds, emptyIdMap } from './ids.mjs';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-store-'));
  const store = makeStore({ fs, dir, pid: 4242 });
  return { dir, store, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const curationWith = (id) => ({ ...emptyCuration(), favorites: { [id]: true } });

describe('atomic writes', () => {
  it('writes through <file>.<pid>.tmp and leaves no tmp behind', () => {
    const { dir, store, done } = setup();
    try {
      store.writeConfig({ root: 'C:/placeholder', indexedAt: '2026-01-01T00:00:00.000Z' });
      assert.deepEqual(fs.readdirSync(dir), ['config.json']);
      assert.deepEqual(store.readConfig(), { config: { version: 1, root: 'C:/placeholder', indexedAt: '2026-01-01T00:00:00.000Z' } });
    } finally { done(); }
  });

  it('when the rename throws the old file is untouched and the tmp is cleaned up', () => {
    const { dir, store, done } = setup();
    try {
      store.writeCuration(curationWith('alpha-1'));
      const before = fs.readFileSync(path.join(dir, 'curation.json'), 'utf8');
      const failing = {
        ...fs,
        renameSync: (a, b) => { if (String(b).endsWith('curation.json')) throw new Error('disk says no'); return fs.renameSync(a, b); },
      };
      const bad = makeStore({ fs: failing, dir, pid: 4242 });
      assert.throws(() => bad.writeCuration(curationWith('alpha-2')), /disk says no/);
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json'), 'utf8'), before);
      assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')), fs.readdirSync(dir).join(','));
    } finally { done(); }
  });
});

describe('curation.json and curation.json.prev', () => {
  it('a missing file is a valid empty document', () => {
    const { store, done } = setup();
    try {
      assert.deepEqual(store.readCuration(), { curation: emptyCuration() });
      assert.deepEqual(store.readCleanup(), { cleanup: emptyCleanup() });
      assert.deepEqual(store.readConfig(), { config: defaultConfig() });
      const lib = store.readLibrary();
      assert.equal(lib.exists, false);
      assert.deepEqual(lib.library, emptyLibrary());
    } finally { done(); }
  });

  it('.prev holds the previous good copy after each write', () => {
    const { dir, store, done } = setup();
    try {
      store.writeCuration(curationWith('alpha-1'));
      assert.ok(!fs.existsSync(path.join(dir, 'curation.json.prev')), 'nothing to copy on the first write');
      store.writeCuration(curationWith('alpha-2'));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'curation.json.prev'), 'utf8')).favorites, { 'alpha-1': true });
      store.writeCuration(curationWith('alpha-3'));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'curation.json.prev'), 'utf8')).favorites, { 'alpha-2': true });
      assert.deepEqual(store.readCuration().curation.favorites, { 'alpha-3': true });
    } finally { done(); }
  });

  it('a corrupt current copy is never copied over a good .prev', () => {
    const { dir, store, done } = setup();
    try {
      store.writeCuration(curationWith('alpha-1'));
      store.writeCuration(curationWith('alpha-2'));
      const prev = fs.readFileSync(path.join(dir, 'curation.json.prev'), 'utf8');
      fs.writeFileSync(path.join(dir, 'curation.json'), '{ not json');
      store.writeCuration(curationWith('alpha-3'));
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.prev'), 'utf8'), prev);
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt'), 'utf8'), '{ not json');
      assert.deepEqual(store.readCuration().curation.favorites, { 'alpha-3': true });
    } finally { done(); }
  });

  it('an unparseable curation is quarantined and the previous save restored; a second corruption becomes .corrupt-2', () => {
    const { dir, store, done } = setup();
    try {
      store.writeCuration(curationWith('alpha-1'));
      store.writeCuration(curationWith('alpha-2'));
      fs.writeFileSync(path.join(dir, 'curation.json'), '{ broken');
      const r = store.readCuration();
      assert.match(r.error, /curation\.json\.corrupt/);
      assert.equal(r.restored, true);
      assert.deepEqual(r.curation.favorites, { 'alpha-1': true });
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt'), 'utf8'), '{ broken');
      // restored on disk: the next read is clean
      assert.deepEqual(store.readCuration(), { curation: curationWith('alpha-1') });
      fs.writeFileSync(path.join(dir, 'curation.json'), 'also broken');
      const r2 = store.readCuration();
      assert.match(r2.error, /curation\.json\.corrupt-2/);
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt'), 'utf8'), '{ broken', 'the first quarantine is never replaced');
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt-2'), 'utf8'), 'also broken');
    } finally { done(); }
  });

  it('without a usable .prev the read still quarantines, offers an empty document and says so', () => {
    const { dir, store, done } = setup();
    try {
      fs.writeFileSync(path.join(dir, 'curation.json'), '###');
      const r = store.readCuration();
      assert.match(r.error, /kept as curation\.json\.corrupt/);
      assert.equal(r.restored, false);
      assert.deepEqual(r.curation, emptyCuration());
      assert.ok(!fs.existsSync(path.join(dir, 'curation.json')), 'no empty document is written over it');
    } finally { done(); }
  });

  it('after a quarantine with no usable .prev the next write is refused, not started from an empty document', () => {
    const { dir, store, done } = setup();
    try {
      fs.writeFileSync(path.join(dir, 'curation.json'), '###');
      const first = store.readCuration();
      assert.match(first.error, /curation.json.corrupt/);
      const again = store.readCuration();
      assert.match(again.error, /Nothing will be saved/, 'the warning persists');
      assert.throws(() => store.writeCuration(curationWith('alpha-1')), /Nothing will be saved/);
      assert.ok(!fs.existsSync(path.join(dir, 'curation.json')), 'no empty document was written');
      assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt'), 'utf8'), '###');
      // restoring the file by hand lifts the hold
      fs.writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curationWith('alpha-2')));
      assert.deepEqual(store.readCuration().curation.favorites, { 'alpha-2': true });
      store.writeCuration(curationWith('alpha-3'));
      assert.deepEqual(store.readCuration().curation.favorites, { 'alpha-3': true });
    } finally { done(); }
  });

  it('wrong-shape JSON ([] / a number / a cluster without a name) is quarantined too', () => {
    for (const text of ['[]', '42', '{"clusters":[{"id":"cl-1"}]}', '{"clusters":"nope"}', '{"favorites":[1]}']) {
      const { dir, store, done } = setup();
      try {
        fs.writeFileSync(path.join(dir, 'curation.json'), text);
        const r = store.readCuration();
        assert.match(r.error, /corrupt/, text);
        assert.equal(fs.readFileSync(path.join(dir, 'curation.json.corrupt'), 'utf8'), text);
      } finally { done(); }
    }
  });

  it('refuses to write a document of the wrong shape', () => {
    const { store, done } = setup();
    try {
      assert.throws(() => store.writeCuration({ clusters: 'x' }), /wrong shape/);
      assert.throws(() => store.writeCuration(null), /wrong shape/);
      assert.throws(() => store.writeCleanup([]), /wrong shape/);
    } finally { done(); }
  });

  it('a read error that is not "missing" is reported and nothing is quarantined or overwritten', () => {
    const { dir, store, done } = setup();
    try {
      fs.mkdirSync(path.join(dir, 'curation.json'));   // a directory where the file should be: EISDIR
      const r = store.readCuration();
      assert.ok(r.error && !r.curation);
      assert.ok(fs.statSync(path.join(dir, 'curation.json')).isDirectory());
      assert.throws(() => store.writeCuration(emptyCuration()));
    } finally { done(); }
  });

  it('dangerous keys are dropped on read', () => {
    const { dir, store, done } = setup();
    try {
      fs.writeFileSync(path.join(dir, 'curation.json'), '{"favorites":{"__proto__":true,"constructor":true,"alpha-1":true},"hidden":{}}');
      const r = store.readCuration();
      assert.deepEqual(Object.keys(r.curation.favorites), ['alpha-1']);
      assert.equal(Object.getPrototypeOf(r.curation.favorites), Object.prototype);
    } finally { done(); }
  });
});

describe('cleanup.json and config.json', () => {
  it('round-trips cleanup and quarantines a bad one without a .prev', () => {
    const { dir, store, done } = setup();
    try {
      const doc = { ...emptyCleanup(), dismissed: { clusters: { 'a-1 b-2': '2026-01-01T00:00:00.000Z' }, candidates: { 'c-3': '2026-01-02T00:00:00.000Z' } } };
      store.writeCleanup(doc);
      assert.deepEqual(store.readCleanup(), { cleanup: doc });
      fs.writeFileSync(path.join(dir, 'cleanup.json'), '[1]');
      const r = store.readCleanup();
      assert.match(r.error, /cleanup\.json\.corrupt/);
      assert.deepEqual(r.cleanup, emptyCleanup());
    } finally { done(); }
  });

  it('a bad config is moved aside with a warning and the defaults are served', () => {
    const { dir, store, done } = setup();
    try {
      fs.writeFileSync(path.join(dir, 'config.json'), '{"root": 5}');
      const r = store.readConfig();
      assert.deepEqual(r.config, defaultConfig());
      assert.match(r.warning, /config\.json\.corrupt/);
    } finally { done(); }
  });
});

describe('library.json', () => {
  const sampleLibrary = () => {
    const files = [
      { rel: 'alpha-site/hero.png', mtimeMs: 300 }, { rel: 'alpha-site/hero_.png', mtimeMs: 200 }, { rel: 'beta/mark.svg', mtimeMs: 100 },
    ];
    const { map } = assignIds(emptyIdMap(), files);
    return {
      version: 1, generatedAt: '2026-01-01T00:00:00.000Z', root: 'C:/placeholder-library', idMap: map,
      works: map.entries.map((e) => ({ id: e.id, rel: e.rel, width: 10, height: 10, thumb: `${e.id}.jpg` })),
      dupes: { exact: [], near: [], junk: [] },
    };
  };

  it('round-trips and drops malformed work rows without failing', () => {
    const { dir, store, done } = setup();
    try {
      const lib = sampleLibrary();
      store.writeLibrary(lib);
      assert.deepEqual(store.readLibrary().library, lib);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
      raw.works.push({ nope: true }, null, 5);
      fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(raw));
      assert.equal(store.readLibrary().library.works.length, lib.works.length);
    } finally { done(); }
  });

  it('a library that will not parse is moved aside, its idMap salvaged, and a stub keeps the ids', () => {
    const { dir, store, done } = setup();
    try {
      const lib = sampleLibrary();
      const text = JSON.stringify(lib);
      const cut = text.slice(0, text.indexOf('"dupes"') - 3);   // truncated after the works: invalid JSON
      fs.writeFileSync(path.join(dir, 'library.json'), cut);
      const r = store.readLibrary();
      assert.match(r.error, /library\.json\.corrupt/);
      assert.deepEqual(r.idMap, lib.idMap);
      assert.equal(r.recovered, lib.idMap.entries.length);
      assert.equal(fs.readFileSync(path.join(dir, 'library.json.corrupt'), 'utf8'), cut, 'the damaged file is kept untouched');
      const again = store.readLibrary();
      assert.equal(again.exists, true);
      assert.deepEqual(again.library.idMap, lib.idMap);
      assert.deepEqual(again.library.works, []);
    } finally { done(); }
  });

  it('an unreadable library with nothing to salvage leaves no stub and says to index again', () => {
    const { dir, store, done } = setup();
    try {
      fs.writeFileSync(path.join(dir, 'library.json'), 'garbage');
      const r = store.readLibrary();
      assert.match(r.error, /Index again/);
      assert.equal(r.idMap.entries.length, 0);
      assert.ok(!fs.existsSync(path.join(dir, 'library.json')));
      assert.ok(fs.existsSync(path.join(dir, 'library.json.corrupt')));
    } finally { done(); }
  });

  it('normalizeLibrary rejects non-objects and a works list that is not a list', () => {
    assert.equal(normalizeLibrary([]), null);
    assert.equal(normalizeLibrary(null), null);
    assert.equal(normalizeLibrary({ works: 'x' }), null);
    assert.deepEqual(normalizeLibrary({}).works, []);
  });
});

describe('salvageIdMap', () => {
  it('extracts a balanced idMap even when strings contain braces and escaped quotes', () => {
    const map = { version: 1, entries: [{ rel: 'alpha/{odd}"name".png', id: 'alpha-odd' }, { rel: 'beta/x.png', id: 'beta-x' }] };
    const text = `{"version":1,"idMap":${JSON.stringify(map)},"works":[{"id":"t`;
    assert.deepEqual(salvageIdMap(text), map);
  });
  it('falls back to scanning pairs when the object itself is cut off', () => {
    const text = '{"idMap":{"version":1,"entries":[{"rel":"alpha/a.png","id":"alpha-a"},{"rel":"alpha/b.png","id":"alpha-b"},{"rel":"alp';
    const m = salvageIdMap(text);
    assert.deepEqual(m.entries.map((e) => e.id), ['alpha-a', 'alpha-b']);
  });
  it('returns an empty map for text without one, and for non-strings', () => {
    assert.deepEqual(salvageIdMap('{"works":[]}'), emptyIdMap());
    assert.deepEqual(salvageIdMap(undefined), emptyIdMap());
  });
  it('a work whose title mentions idMap does not fool it', () => {
    const lib = { works: [{ id: 'w', title: 'the "idMap": {x} story' }], idMap: { version: 1, entries: [{ rel: 'alpha/w.png', id: 'w' }] } };
    assert.deepEqual(salvageIdMap(JSON.stringify(lib)).entries, [{ rel: 'alpha/w.png', id: 'w' }]);
  });
});

describe('thumbnails', () => {
  it('an ordinary id is its own name; anything odd is hashed so it cannot name a path', () => {
    assert.equal(thumbName('alpha-site-hero-png'), 'alpha-site-hero-png.jpg');
    for (const id of ['../../x', 'a/b', 'CON:', 'Upper', '', 'a'.repeat(200), '__proto__']) {
      const n = thumbName(id);
      assert.match(n, /^[a-z0-9_-]+\.jpg$/, id);
      assert.ok(!n.includes('..'));
    }
    assert.notEqual(thumbName('../../x'), thumbName('../../y'));
    assert.equal(thumbName('../../x'), thumbName('../../x'));
  });

  it('write, info, rename, remove and list', () => {
    const { store, done } = setup();
    try {
      assert.equal(store.thumbInfo('alpha-1'), null);
      store.writeThumb('alpha-1', Buffer.from([1, 2, 3]));
      assert.ok(store.thumbInfo('alpha-1').mtimeMs > 0);
      assert.deepEqual([...store.listThumbNames()], ['alpha-1.jpg']);
      assert.equal(store.renameThumb('alpha-1', 'alpha-2'), true);
      assert.equal(store.thumbInfo('alpha-1'), null);
      assert.ok(store.thumbInfo('alpha-2'));
      assert.equal(store.removeThumb('alpha-2'), true);
      assert.equal(store.removeThumb('alpha-2'), false);
      assert.equal(store.renameThumb('nope', 'nope-2'), false);
    } finally { done(); }
  });
});
