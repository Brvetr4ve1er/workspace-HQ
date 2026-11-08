// Cosmos space — the sticky id map (dashboard/cosmos/ids.mjs). Placeholder paths only.
// The rule under test: a known path keeps its id forever, only never-seen paths get new ones, and no id
// is ever handed to a different file — because every cluster/favourite/override points at an id.
//   node --test dashboard/cosmos/ids.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyIdMap, pathKey, relFromSrc, parseIdMap, idFor, relFor, seedFromManifest, assignIds,
} from './ids.mjs';
import { slug } from './infer.mjs';

const LONG = 'long-folder-name-'.repeat(6);                 // 102 chars: slug() cuts the id at 80
const LONG_ID = 'a-long-folder-name-long-folder-name-long-folder-name-long-folder-name-long-folde';

// a placeholder manifest in the shape the source app wrote: src is '/media/' + each segment URI-encoded once
const manifest = () => ({
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  works: [
    { id: 'alpha-site-hero-shot-png', title: 'HERO SHOT', type: 'photo', src: '/media/alpha-site/Hero%20Shot.png' },
    { id: 'alpha-site-hero-shot-png-x', title: 'HERO SHOT', type: 'photo', src: '/media/alpha-site/hero_shot.png' },
    { id: LONG_ID, title: 'X', type: 'misc', src: `/media/a/${LONG}x.png` },
    { id: `${LONG_ID}-x`, title: 'Y', type: 'misc', src: `/media/a/${LONG}y.png` },
    { id: 'literal-percent-png', title: 'P', type: 'misc', src: '/media/alpha-site/100%2541.png' },
  ],
});

describe('relFromSrc — decode each segment exactly once', () => {
  it('decodes spaces, unicode and reserved characters one time', () => {
    assert.equal(relFromSrc('/media/alpha-site/Hero%20Shot.png'), 'alpha-site/Hero Shot.png');
    assert.equal(relFromSrc('/media/%E5%9B%B3/a%23b.png'), '図/a#b.png');
  });
  it('a %25-style segment is decoded once, not twice', () => {
    assert.equal(relFromSrc('/media/alpha-site/100%2541.png'), 'alpha-site/100%41.png');
    assert.notEqual(relFromSrc('/media/alpha-site/100%2541.png'), 'alpha-site/100A.png');
  });
  it('refuses anything that is not a plain /media/ path', () => {
    for (const bad of [
      null, undefined, 42, '', '/gallery/a.png', 'media/a.png', '/media/', '/media//a.png', '/media/a/',
      '/media/%ZZ/a.png',          // malformed escape
      '/media/a%2Fb.png',          // an encoded separator can never be a real file name
      '/media/a%5Cb.png',
      '/media/../a.png', '/media/%2E%2E/a.png', '/media/./a.png',
    ]) assert.equal(relFromSrc(bad), null, String(bad));
  });
});

describe('pathKey', () => {
  it('compares ignoring case, separators and a leading ./', () => {
    assert.equal(pathKey('Alpha-Site\\Hero.PNG'), 'alpha-site/hero.png');
    assert.equal(pathKey('./alpha-site/hero.png'), 'alpha-site/hero.png');
  });
});

describe('seedFromManifest', () => {
  it('seeds the exact ids, including -x collisions and 80-character cuts', () => {
    const { map, seeded, skipped } = seedFromManifest(manifest());
    assert.equal(seeded, 5);
    assert.deepEqual(skipped, []);
    assert.equal(idFor(map, 'alpha-site/Hero Shot.png'), 'alpha-site-hero-shot-png');
    assert.equal(idFor(map, 'alpha-site/hero_shot.png'), 'alpha-site-hero-shot-png-x');
    assert.equal(idFor(map, `a/${LONG}x.png`), LONG_ID);
    assert.equal(idFor(map, `a/${LONG}y.png`), `${LONG_ID}-x`);
    assert.equal(LONG_ID.length, 80);
    assert.equal(slug(`a/${LONG}x.png`), LONG_ID);           // the cut really is slug()'s
    assert.equal(relFor(map, 'alpha-site-hero-shot-png-x'), 'alpha-site/hero_shot.png');
  });

  it('keeps a literal percent sign in the path (single decode)', () => {
    const { map } = seedFromManifest(manifest());
    assert.equal(idFor(map, 'alpha-site/100%41.png'), 'literal-percent-png');
    assert.equal(idFor(map, 'alpha-site/100A.png'), null);
  });

  it('matches relative paths ignoring case', () => {
    const { map } = seedFromManifest(manifest());
    assert.equal(idFor(map, 'ALPHA-SITE/hero shot.PNG'), 'alpha-site-hero-shot-png');
    assert.equal(idFor(map, 'alpha-site\\Hero Shot.png'), 'alpha-site-hero-shot-png');
  });

  it('reports what it could not seed instead of guessing', () => {
    const m = {
      works: [
        { id: 'clip-a1b2c3d4e5f6', src: 'https://cdn.example.com/x.png' },     // a clip: another namespace
        { id: 'up-1', src: '/media/%ZZ.png' },
        { src: '/media/alpha-site/a.png' },                                       // no id
        { id: 'one', src: '/media/alpha-site/a.png' },
        { id: 'two', src: '/media/ALPHA-SITE/A.png' },                            // same path, other case, other id
        { id: 'one', src: '/media/alpha-site/b.png' },                            // id already taken
        { id: 'one', src: '/media/alpha-site/a.png' },                            // exact repeat: not a conflict
      ],
    };
    const { map, seeded, skipped } = seedFromManifest(m);
    assert.equal(seeded, 1);
    assert.deepEqual(skipped.map((s) => s.reason), ['no-path', 'no-path', 'no-id', 'path-known', 'id-known']);
    assert.deepEqual(map.entries, [{ rel: 'alpha-site/a.png', id: 'one' }]);
  });

  it('survives junk manifests', () => {
    for (const junk of [null, undefined, 5, {}, { works: 'x' }, { works: [null, 3, 'a'] }]) {
      const r = seedFromManifest(junk);
      assert.equal(r.map.entries.length, 0);
    }
  });

  it('a re-seed never changes an id already in the map', () => {
    const first = seedFromManifest(manifest()).map;
    const changed = manifest();
    changed.works[0].id = 'something-else';
    const again = seedFromManifest(changed, first);
    assert.equal(idFor(again.map, 'alpha-site/Hero Shot.png'), 'alpha-site-hero-shot-png');
    assert.ok(again.skipped.some((s) => s.reason === 'path-known'));
  });

  it('does not mutate the map it was given', () => {
    const base = emptyIdMap();
    seedFromManifest(manifest(), base);
    assert.deepEqual(base, { version: 1, entries: [] });
  });
});

describe('assignIds', () => {
  const seeded = () => seedFromManifest(manifest()).map;

  it('known files keep their ids and are not "new"', () => {
    const { entries, minted, map } = assignIds(seeded(), [
      { rel: 'alpha-site/hero_shot.png', mtimeMs: 5 },
      { rel: 'alpha-site/Hero Shot.png', mtimeMs: 9 },
    ]);
    assert.equal(minted, 0);
    assert.deepEqual(entries, [
      { rel: 'alpha-site/hero_shot.png', id: 'alpha-site-hero-shot-png-x', isNew: false },
      { rel: 'alpha-site/Hero Shot.png', id: 'alpha-site-hero-shot-png', isNew: false },
    ]);
    assert.equal(map.entries.length, 5);
  });

  it('a newer colliding file never steals a known id', () => {
    // the source app's walk would hand this NEWER file the bare id and push the curated one to -x
    const known = seeded();
    const { entries } = assignIds(known, [
      { rel: 'alpha-site/hero-shot.png', mtimeMs: 9_000 },        // slug => alpha-site-hero-shot-png (taken)
      { rel: 'alpha-site/Hero Shot.png', mtimeMs: 1_000 },
    ]);
    assert.equal(entries[1].id, 'alpha-site-hero-shot-png');      // the curated one is unchanged
    assert.equal(entries[0].isNew, true);
    assert.equal(entries[0].id, 'alpha-site-hero-shot-png-x-x');  // taken id + the taken -x id: another -x
    const all = assignIds(known, [{ rel: 'alpha-site/hero-shot.png', mtimeMs: 1 }]).map.entries.map((e) => e.id);
    assert.equal(new Set(all).size, all.length);
  });

  it('never re-uses the id of a file that is gone', () => {
    const known = seeded();                                        // knows Hero Shot.png; it is not in the list now
    const { entries } = assignIds(known, [{ rel: 'alpha-site/hero-shot.PNG', mtimeMs: 1 }]);
    assert.equal(entries[0].id, 'alpha-site-hero-shot-png-x-x');   // not the bare id of the deleted file
  });

  it('mints never-seen files newest first, with -x on a clash', () => {
    const files = [
      { rel: 'beta/Old Pic.png', mtimeMs: 100 },
      { rel: 'beta/old-pic.png', mtimeMs: 300 },                   // newest: takes the bare id
      { rel: 'beta/old_pic.png', mtimeMs: 200 },
    ];
    const { entries, minted } = assignIds(emptyIdMap(), files);
    assert.equal(minted, 3);
    const byRel = Object.fromEntries(entries.map((e) => [e.rel, e.id]));
    assert.equal(byRel['beta/old-pic.png'], 'beta-old-pic-png');
    assert.equal(byRel['beta/old_pic.png'], 'beta-old-pic-png-x');
    assert.equal(byRel['beta/Old Pic.png'], 'beta-old-pic-png-x-x');
    assert.ok(entries.every((e) => e.isNew));
  });

  it('reproduces the source app for a fresh walk (same ids as slug + -x, newest first)', () => {
    const files = [
      { rel: '日本語/図.png', mtimeMs: 3 },                         // slug => 'png'
      { rel: 'readme/other.png', mtimeMs: 2 },
      { rel: 'x/ /png', mtimeMs: 1 },                              // slug => 'x-png'
      { rel: '///', mtimeMs: 0 },                                  // empty slug => 'work'
    ];
    const { entries } = assignIds(emptyIdMap(), files);
    assert.deepEqual(entries.map((e) => e.id), ['png', 'readme-other-png', 'x-png', 'work']);
    const again = assignIds(emptyIdMap(), [{ rel: '図/日本.png', mtimeMs: 2 }, { rel: '日本/図.png', mtimeMs: 1 }]);
    assert.deepEqual(again.entries.map((e) => e.id), ['png', 'png-x']);
    const works = assignIds(emptyIdMap(), [{ rel: '///', mtimeMs: 2 }, { rel: '\\\\', mtimeMs: 1 }]);
    assert.deepEqual(works.entries.map((e) => e.id), ['work', 'work-x']);
  });

  it('is deterministic for equal times (ties by path) whatever the input order', () => {
    const a = assignIds(emptyIdMap(), [{ rel: 'b/x.png', mtimeMs: 1 }, { rel: 'a/x.png', mtimeMs: 1 }]);
    const b = assignIds(emptyIdMap(), [{ rel: 'a/x.png', mtimeMs: 1 }, { rel: 'b/x.png', mtimeMs: 1 }]);
    const id = (r, rel) => r.entries.find((e) => e.rel === rel).id;
    assert.equal(id(a, 'a/x.png'), id(b, 'a/x.png'));
    assert.equal(id(a, 'b/x.png'), id(b, 'b/x.png'));
  });

  it('treats the same path listed twice (any case) as one file, and ignores junk entries', () => {
    const { entries, minted, map } = assignIds(emptyIdMap(), [
      { rel: 'alpha-site/A.png', mtimeMs: 1 },
      { rel: 'ALPHA-SITE/a.png', mtimeMs: 2 },
      null, { rel: '' }, { rel: 7 }, 'x',
      { rel: 'alpha-site/b.png' },                                 // no mtime: sorted last, still gets an id
    ]);
    assert.equal(minted, 2);
    assert.equal(entries.length, 2);
    assert.equal(map.entries.length, 2);
  });

  it('does not mutate the map it was given', () => {
    const base = seeded();
    const copy = JSON.parse(JSON.stringify(base));
    assignIds(base, [{ rel: 'zeta/new.png', mtimeMs: 1 }]);
    assert.deepEqual(base, copy);
  });

  it('only appends: every earlier entry survives in place', () => {
    const base = seeded();
    const { map } = assignIds(base, [{ rel: 'zeta/new.png', mtimeMs: 1 }, { rel: 'alpha-site/Hero Shot.png', mtimeMs: 2 }]);
    assert.deepEqual(map.entries.slice(0, base.entries.length), base.entries);
    assert.equal(map.entries.length, base.entries.length + 1);
  });

  it('a minted id can never look like a clip id', () => {
    // clip-<hex12>: slug ids end in a media extension ('-png', '-mp4'…), which a 12-char hex tail cannot spell
    const { entries } = assignIds(emptyIdMap(), [
      { rel: 'clips/a1b2c3d4e5f6.png', mtimeMs: 3 },
      { rel: 'clip/abcdefabcdef.mp4', mtimeMs: 2 },
    ]);
    for (const e of entries) {
      assert.equal(/^clip-[0-9a-f]{12}$/.test(e.id), false);
    }
  });
});

describe('the map round-trips through JSON', () => {
  it('stringify → parse gives the same map, and parseIdMap accepts it as-is', () => {
    const { map } = assignIds(seedFromManifest(manifest()).map, [
      { rel: 'zeta/new.png', mtimeMs: 1 }, { rel: '日本語/図.png', mtimeMs: 2 },
    ]);
    const back = JSON.parse(JSON.stringify(map));
    assert.deepEqual(back, map);
    const parsed = parseIdMap(back);
    assert.equal(parsed.dropped, 0);
    assert.deepEqual(parsed.map, map);
    // and minting after a reload continues without touching what was written
    const again = assignIds(parsed.map, [{ rel: 'zeta/new2.png', mtimeMs: 5 }]);
    assert.deepEqual(again.map.entries.slice(0, map.entries.length), map.entries);
  });

  it('odd names are just data (no prototype tricks)', () => {
    const { map } = assignIds(emptyIdMap(), [{ rel: '__proto__/constructor.png', mtimeMs: 1 }]);
    const back = parseIdMap(JSON.parse(JSON.stringify(map))).map;
    assert.equal(idFor(back, '__proto__/constructor.png'), 'proto-constructor-png');
    assert.equal(Object.keys({}).length, 0);
  });
});

describe('parseIdMap — a damaged file never throws and never invents', () => {
  it('drops malformed and duplicate entries, counting them', () => {
    const raw = {
      version: 1,
      entries: [
        { rel: 'a/one.png', id: 'a-one-png' },
        { rel: 'A/ONE.png', id: 'other' },            // same path: first wins
        { rel: 'a/two.png', id: 'a-one-png' },        // same id: first wins
        { rel: 'a/three.png' },
        { id: 'x' },
        null, 7, 'str',
        { rel: '', id: 'y' },
        { rel: 'a/four.png', id: 'a-four-png' },
      ],
    };
    const { map, dropped } = parseIdMap(raw);
    assert.deepEqual(map.entries, [{ rel: 'a/one.png', id: 'a-one-png' }, { rel: 'a/four.png', id: 'a-four-png' }]);
    assert.equal(dropped, 8);
  });
  it('junk in → an empty map out', () => {
    for (const junk of [null, undefined, 3, 'x', [], {}, { entries: 'x' }, { entries: {} }]) {
      assert.deepEqual(parseIdMap(junk), { map: { version: 1, entries: [] }, dropped: 0 });
    }
  });
});
