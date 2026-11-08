// Cosmos space — the shared taxonomy (dashboard/cosmos/infer.mjs) and the type table (types.mjs).
// slug() is pinned byte for byte: it makes element ids, and every cluster/favourite/override points at one.
// The clipTags / inferTypeFromClip cases are the source app's own (clipInfer.test.ts), run through the
// vitest shim with their assertions unchanged. Placeholder paths and names only.
//   node --test dashboard/cosmos/infer.test.mjs
import { describe, it, expect } from '../money/vitest-shim.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slug, inferType, titleFrom, normalizeTag, inferTypeFromClip, clipTags, IMAGE_EXT, VIDEO_EXT, TYPE_RULES,
} from './infer.mjs';
import { WORK_TYPES, TYPE_META } from './types.mjs';

describe('slug — byte parity with the source app (these strings are ids)', () => {
  const long = 'long-folder-name-'.repeat(6);
  const CASES = [
    // [input, expected id]
    ['alpha-site/Hero Shot.png', 'alpha-site-hero-shot-png'],
    ['alpha-site/hero_shot.PNG', 'alpha-site-hero-shot-png'],           // different files, same id: ids.mjs adds -x
    ['alpha-site\\Hero Shot.png', 'alpha-site-hero-shot-png'],           // either separator
    ['Études/Café Noir (final).JPG', 'tudes-caf-noir-final-jpg'],        // accents are DROPPED, not transliterated
    ['日本語/図.png', 'png'],                                              // non-Latin names collapse to the extension
    ['UPPER/CASE.PNG', 'upper-case-png'],
    ['--x--/y.png', 'x-y-png'],
    ['a.b.c/d..e.gif', 'a-b-c-d-e-gif'],
    ['  ', ''],
    ['///', ''],
    ['', ''],
    ['already-a-slug', 'already-a-slug'],
    ['2024/20240315_101500.jpg', '2024-20240315-101500-jpg'],
    [`a/${long}x.png`, 'a-long-folder-name-long-folder-name-long-folder-name-long-folder-name-long-folde'],
  ];
  for (const [input, expected] of CASES) {
    it(`slug(${JSON.stringify(input.length > 40 ? input.slice(0, 40) + '…' : input)})`, () => {
      expect(slug(input)).toBe(expected);
    });
  }
  it('the 80-character cut happens after trimming dashes, and two long paths can share an id', () => {
    const long = 'long-folder-name-'.repeat(6);
    expect(slug(`a/${long}x.png`).length).toBe(80);
    expect(slug(`a/${long}x.png`)).toBe(slug(`a/${long}y.png`));
    expect(slug('a'.repeat(79) + '/b')).toBe('a'.repeat(79) + '-');       // the cut can leave a trailing dash: that is the source's behaviour
  });
  it('the empty slug is the caller\'s problem (ids.mjs turns it into "work")', () => {
    expect(slug('///')).toBe('');
  });
});

describe('inferType', () => {
  const TABLE = [
    ['Renders/a.png', '3d'],
    ['work/screenshot-ui.png', 'ui'],
    ['brands/Logo Final.png', 'logo'],
    ['Motion/loop.gif', 'motion'],
    ['fonts/specimen.png', 'type'],
    ['holiday/camera-roll.jpg', 'photo'],
    ['Posters/one.png', 'illustration'],
    ['misc/thing.png', 'misc'],
    ['x/plain.png', 'misc'],
  ];
  for (const [p, t] of TABLE) it(`${p} → ${t}`, () => expect(inferType(p)).toBe(t));

  it('every video extension is motion, whatever the folder says', () => {
    for (const ext of ['.mp4', '.webm', '.m4v', '.ogv', '.mov', '.MP4']) expect(inferType(`renders/hero${ext}`)).toBe('motion');
  });
  it('camera file names are photos when no folder rule matched', () => {
    for (const n of ['IMG_4410.jpg', 'img-4410.jpg', 'DSC0192.jpg', 'PXL_20240101.jpg', '20240315_101500.jpg']) {
      expect(inferType(`inbox/${n}`)).toBe('photo');
    }
    expect(inferType('inbox/photo1.jpg')).toBe('photo');                   // 'photo' is itself a folder keyword
    expect(inferType('inbox/IMAGE_1.jpg')).toBe('misc');
  });
  it('rule order decides: the first matching type wins, not the first matching word', () => {
    expect(inferType('poster-render/a.png')).toBe('3d');                   // poster (illustration) comes after render (3d)
    expect(inferType('app-logo/a.png')).toBe('ui');                        // ui comes before logo
    expect(inferType('UI/DSC1234.jpg')).toBe('ui');                        // a folder rule beats the camera name
  });
  it('a keyword matches as a substring anywhere in the path (known quirk of the source)', () => {
    expect(inferType('alpha-site/Hero Shot.png')).toBe('photo');           // "shot"
    expect(inferType('x/apple.png')).toBe('ui');                           // "app"
  });
  it('only returns known work types', () => {
    for (const [p] of TABLE) expect(WORK_TYPES.includes(inferType(p))).toBe(true);
  });
});

describe('titleFrom', () => {
  const TABLE = [
    ['alpha-site/Hero Shot.png', 'HERO SHOT'],
    ['x/Some__File--name  here.png', 'SOME FILE NAME HERE'],
    ['x/IMG_0001.jpg', 'IMG 0001'],
    ['x/clip.MP4', 'CLIP'],
    ['x/.png', '.PNG'],                                                    // a dotfile has no extension to strip
    ['x/a.b.c.png', 'A.B.C'],
    ['plain', 'PLAIN'],
  ];
  for (const [p, t] of TABLE) it(`${p} → ${t}`, () => expect(titleFrom(p)).toBe(t));
  it('is cut at 60 characters', () => {
    expect(titleFrom(`x/${'w'.repeat(80)}.png`)).toBe('W'.repeat(60));
  });
  it('uses the file name only, never the folders', () => {
    expect(titleFrom('secret-folder/other/name.png')).toBe('NAME');
  });
});

describe('normalizeTag', () => {
  const TABLE = [
    ['  Hello   WORLD\t x ', 'hello world x'],
    ['Behance', 'behance'],
    ['', ''],
    ['   ', ''],
    ['A\n\nB', 'a b'],
    [42, '42'],
    [null, 'null'],                                                        // String(raw): callers filter first (clipTags does)
  ];
  for (const [raw, out] of TABLE) it(`${JSON.stringify(raw)} → ${JSON.stringify(out)}`, () => expect(normalizeTag(raw)).toBe(out));
  it('is idempotent', () => {
    for (const [raw] of TABLE) expect(normalizeTag(normalizeTag(raw))).toBe(normalizeTag(raw));
  });
});

describe('extension sets and the rule table', () => {
  it('image and video extensions', () => {
    expect([...IMAGE_EXT]).toEqual(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.bmp']);
    expect([...VIDEO_EXT]).toEqual(['.mp4', '.webm', '.m4v', '.ogv', '.mov']);
  });
  it('the rule order is 3d, ui, logo, motion, type, photo, illustration', () => {
    expect(TYPE_RULES.map(([t]) => t)).toEqual(['3d', 'ui', 'logo', 'motion', 'type', 'photo', 'illustration']);
  });
  it('every rule type is a work type, and every keyword is lower-case', () => {
    for (const [type, words] of TYPE_RULES) {
      expect(WORK_TYPES.includes(type)).toBe(true);
      for (const w of words) expect(w).toBe(w.toLowerCase());
    }
  });
});

describe('WORK_TYPES and TYPE_META — shape', () => {
  it('eight types in the source order, misc last', () => {
    expect([...WORK_TYPES]).toEqual(['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc']);
  });
  it('every type has a label and a glyph, and nothing extra', () => {
    expect(Object.keys(TYPE_META).sort()).toEqual([...WORK_TYPES].sort());
    for (const t of WORK_TYPES) {
      expect(typeof TYPE_META[t].label).toBe('string');
      expect(TYPE_META[t].label.length).toBeGreaterThan(0);
      expect(typeof TYPE_META[t].glyph).toBe('string');
      expect(TYPE_META[t].glyph.length).toBeGreaterThan(0);
    }
    expect(new Set(WORK_TYPES.map((t) => TYPE_META[t].glyph)).size).toBe(WORK_TYPES.length);
    expect(new Set(WORK_TYPES.map((t) => TYPE_META[t].label)).size).toBe(WORK_TYPES.length);
  });
  it('the source labels', () => {
    expect(TYPE_META['3d'].label).toBe('3D & Render');
    expect(TYPE_META.ui.label).toBe('UI & Product');
    expect(TYPE_META.photo.label).toBe('Photography');
    expect(TYPE_META.misc.label).toBe('Misc');
  });
  it('both are frozen, so a stray push cannot retype the library', () => {
    expect(Object.isFrozen(WORK_TYPES)).toBe(true);
    expect(Object.isFrozen(TYPE_META)).toBe(true);
    for (const t of WORK_TYPES) expect(Object.isFrozen(TYPE_META[t])).toBe(true);
    assert.throws(() => { 'use strict'; WORK_TYPES.push('x'); });
  });
});

/* ---- the source app's own clip cases, unchanged (clipInfer.test.ts) ---- */

describe('clipTags — provenance vocabulary', () => {
  it('always marks a clipped element, even with nothing to go on', () => {
    expect(clipTags()).toEqual(['clipped']);
    expect(clipTags({})).toEqual(['clipped']);
  });

  it('tags the bare hostname with www stripped', () => {
    expect(clipTags({ pageUrl: 'https://www.behance.net/gallery/1' })).toEqual([
      'clipped',
      'behance.net',
    ]);
    expect(clipTags({ pageUrl: 'https://WWW.Example.COM/a' })).toEqual(['clipped', 'example.com']);
  });

  it('drops the hostname when the page URL does not parse', () => {
    expect(clipTags({ pageUrl: 'not a url' })).toEqual(['clipped']);
  });

  it('refuses hostnames that are not real labels, so junk never enters the tag system', () => {
    expect(clipTags({ pageUrl: 'https://../../etc/x' })).toEqual(['clipped']);
    expect(clipTags({ pageUrl: 'https://./a' })).toEqual(['clipped']);
    expect(clipTags({ pageUrl: 'http://[::1]/a' })).toEqual(['clipped']);
    expect(clipTags({ pageUrl: 'http://localhost:5173/a' })).toEqual(['clipped', 'localhost']);
    expect(clipTags({ pageUrl: 'https://sub.domain.co.uk/a' })).toEqual([
      'clipped',
      'sub.domain.co.uk',
    ]);
  });

  it('adds the site name only when it says something the hostname did not', () => {
    expect(clipTags({ pageUrl: 'https://www.behance.net/x', siteName: 'Behance' })).toEqual([
      'clipped',
      'behance.net',
      'behance',
    ]);
    expect(clipTags({ pageUrl: 'https://behance.net/x', siteName: 'behance.net' })).toEqual([
      'clipped',
      'behance.net',
    ]);
  });

  it('takes up to three meaningful words from the page title', () => {
    expect(
      clipTags({
        pageUrl: 'https://dribbble.com/shots/1',
        pageTitle: 'The Very Best Of Brutalist Poster Series Grid Study',
      }),
    ).toEqual(['clipped', 'dribbble.com', 'best', 'brutalist', 'poster']);
  });

  it('drops stopwords and tokens under three characters', () => {
    expect(
      clipTags({ pageUrl: 'https://pinterest.com/pin/9', pageTitle: 'A & the it of' }),
    ).toEqual(['clipped', 'pinterest.com']);
  });

  it('splits titles on unicode word boundaries so accented words survive', () => {
    expect(clipTags({ pageUrl: 'not a url', pageTitle: '  Café   Noir — Étude 2  ' })).toEqual([
      'clipped',
      'café',
      'noir',
      'étude',
    ]);
  });

  it('never emits the same tag twice, whatever the source casing', () => {
    const tags = clipTags({
      pageUrl: 'https://www.behance.net/x',
      siteName: 'BEHANCE',
      pageTitle: 'Behance behance BEHANCE grid study',
    });
    expect(tags).toEqual(['clipped', 'behance.net', 'behance', 'grid', 'study']);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('emits only canonical tags, so clipped and hand-typed tags are one vocabulary', () => {
    const tags = clipTags({
      pageUrl: 'https://www.behance.net/gallery/123/Brutalist-Poster-Series',
      pageTitle: 'Brutalist Poster Series on Behance',
      siteName: 'Behance',
    });
    expect(tags).toEqual(['clipped', 'behance.net', 'behance', 'brutalist', 'poster', 'series']);
    for (const t of tags) expect(t).toBe(t.toLowerCase().trim().replace(/\s+/g, ' '));
    expect(tags.length).toBeLessThanOrEqual(6);
  });
});

describe('inferTypeFromClip — element type', () => {
  it('calls anything with a video MIME motion, whatever the URL suggests', () => {
    expect(inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/renders/hero.png' })).toBe('3d');
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/renders/hero.png',
        mime: 'video/mp4',
      }),
    ).toBe('motion');
    expect(
      inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/f/a.bin', mime: 'VIDEO/WEBM' }),
    ).toBe('motion');
  });

  it('falls back to the media extension when the MIME lies', () => {
    expect(
      inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/f/clip.mp4', mime: 'image/png' }),
    ).toBe('motion');
    expect(inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/f/reel.MP4' })).toBe('motion');
  });

  it('applies the folder keyword rules to the media URL path', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://mir-s3.behance.net/renders/hero-shot.jpg',
        pageUrl: 'https://www.behance.net/gallery/1/x',
      }),
    ).toBe('3d');
  });

  it('reads the page URL path too', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/f/9912.jpg',
        pageUrl: 'https://example.com/logo-design/case',
      }),
    ).toBe('logo');
  });

  it('reads the page title', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://i.pinimg.com/564x/aa/bb/cc.jpg',
        pageUrl: 'https://www.pinterest.com/pin/9912',
        pageTitle: 'Vintage poster illustration',
      }),
    ).toBe('illustration');
  });

  it('reads the alt text', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/f/9912.jpg',
        alt: 'a bold lettering specimen',
      }),
    ).toBe('type');
  });

  it('lets rule order decide, not where the keyword sits in the text', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/f/9912.jpg',
        pageTitle: 'Poster art from a render test',
      }),
    ).toBe('3d');
  });

  it('recognizes camera filenames as photos', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/uploads/IMG_4410.jpg',
        pageTitle: 'Untitled',
      }),
    ).toBe('photo');
    expect(inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/f/DSC0192.jpg' })).toBe('photo');
    expect(inferTypeFromClip({ mediaUrl: 'https://cdn.example.com/f/20221128_172958.jpg' })).toBe(
      'photo',
    );
  });

  it('ignores the hostname, so a domain name cannot force a type', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/f/9912.jpg',
        pageUrl: 'https://www.artstation.com/p/9912',
      }),
    ).toBe('misc');
  });

  it('ignores query strings and fragments', () => {
    expect(
      inferTypeFromClip({
        mediaUrl: 'https://cdn.example.com/f/9912.jpg?ref=poster-render#x',
        pageUrl: 'https://example.com/p/1',
      }),
    ).toBe('misc');
  });

  it('falls back to misc when nothing matches, including with no input at all', () => {
    expect(inferTypeFromClip()).toBe('misc');
    expect(inferTypeFromClip({ mediaUrl: 'not a url', mime: 'image/png' })).toBe('misc');
  });
});

test('clip ids stay in their own namespace: no slug of a media path looks like clip-<hash12>', () => {
  const CLIP_ID = /^clip-[0-9a-f]{12}$/;
  assert.equal(CLIP_ID.test('clip-a1b2c3d4e5f6'), true);
  assert.equal(CLIP_ID.test('clip-A1B2C3D4E5F6'), false);
  assert.equal(CLIP_ID.test('clip-a1b2c3'), false);
  const paths = [
    'clips/a1b2c3d4e5f6.png', '_clips/clip-a1b2c3d4e5f6.png', 'clip/abcdefabcdef.png',
    'clip/a1b2c3d4e5f6.mp4', 'Renders/hero.png', `${'a'.repeat(120)}/x.png`,
  ];
  for (const p of paths) assert.equal(CLIP_ID.test(slug(p)), false, p);
});
