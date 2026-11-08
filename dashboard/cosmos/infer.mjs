/* Cosmos space — the shared taxonomy that turns a file (or a clipped URL) into an element: the type
   rules, the title and slug helpers, the tag normalizer and the clip provenance tags.

   PORTED, CODE BYTE-IDENTICAL, from Cosmos Local's scripts/lib/infer.mjs (the retrogallery repo,
   read-only). Only comments differ: this one, and one comment example below that named a real file.
   Why it must not drift: element ids are slug(relative path), and every cluster, favourite, hidden
   flag and override the owner made points at one. If slug() changes by one character, a re-index
   mints different ids and that curation silently lands on nothing (or on the wrong image) — see
   dashboard/cosmos/ids.mjs and docs/superpowers/specs/2026-11-07-cosmos-space-design.md.
   infer.test.mjs pins slug() byte for byte, and runs the source app's own test cases.

   Main-side only: it imports node:path (basename/extname use the platform's path rules, the same
   as the source app on this PC), so the renderer never imports it. Pure: no IO, no clock. */

import { basename, extname } from 'node:path';

export const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.svg',
  '.bmp',
]);

export const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.ogv', '.mov']);

/* folder-keyword → work type. First match along the path wins. */
export const TYPE_RULES = [
  ['3d', ['3d', 'render', 'blender', 'cgi']],
  ['ui', ['ui', 'screenshot', 'interface', 'app', 'web', 'dashboard']],
  ['logo', ['logo', 'brand', 'mark', 'identity']],
  ['motion', ['motion', 'film', 'video', 'anim', 'reel']],
  ['type', ['type', 'font', 'lettering', 'typography']],
  ['photo', ['photo', 'camera', 'shot']],
  [
    'illustration',
    [
      'vector',
      'illustration',
      'art',
      'poster',
      'concept',
      'sketch',
      'draw',
      'paint',
      'character',
      'anime',
      'moodboard',
    ],
  ],
];

/** camera-style filenames (IMG_..., DSC..., PXL_..., 20240315_101500.jpg) */
const CAMERA_NAME_RE = /^(img[_-]|dsc|pxl[_-]|20\d{6}[_-])/i;

/** First taxonomy rule whose keyword appears anywhere in `haystack`. */
function matchTypeRules(haystack) {
  for (const [type, words] of TYPE_RULES) {
    if (words.some((w) => haystack.includes(w))) return type;
  }
  return null;
}

/** Work type for a manifest-relative file path. Videos are always motion. */
export function inferType(relPath) {
  if (VIDEO_EXT.has(extname(relPath).toLowerCase())) return 'motion';
  const p = relPath.toLowerCase();
  const rule = matchTypeRules(p);
  if (rule) return rule;
  if (CAMERA_NAME_RE.test(basename(relPath))) return 'photo';
  return 'misc';
}

/** Display title from a file path: separators to spaces, upper, 60 chars. */
export function titleFrom(file) {
  return basename(file, extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 60);
}

/** URL/id-safe slug: lowercase, non-alphanumerics to dashes, 80 chars. */
export function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Canonical tag form: lowercase, trimmed, inner whitespace collapsed.
    Mirrors normalizeTag() in src/lib/tags.ts exactly. */
export function normalizeTag(raw) {
  return String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Pathname of a URL, or '' when it does not parse. Query/hash dropped. */
function pathOf(url) {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/* A hostname worth tagging: dotted (example.com) or a bare local name, made of
   the characters DNS actually allows. The WHATWG parser happily returns `..`
   for `https://../x` and `[::1]`-style literals for IPs — neither is a label a
   human would ever want in the tag rail, and once a junk tag is in the library
   it spreads to overrides and smart-cluster rules. Rejecting it here is the
   only place it can be stopped before it becomes user data. */
const TAGGABLE_HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Hostname of a URL with a leading `www.` stripped, or '' when unparseable
    or not a hostname worth tagging. */
function hostOf(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return TAGGABLE_HOST.test(host) ? host : '';
  } catch {
    return '';
  }
}

/** Last path segment of a URL pathname, percent-decoded when possible. */
function fileOf(pathname) {
  const raw = pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Work type for a clipped element. Video MIME always wins; otherwise the
    same folder taxonomy runs over the media path, the page path, the page
    title and the alt text, then the camera-filename rule on the file name. */
export function inferTypeFromClip({ mediaUrl, pageUrl, pageTitle, alt, mime } = {}) {
  if (typeof mime === 'string' && mime.toLowerCase().startsWith('video/')) return 'motion';

  const mediaPath = pathOf(mediaUrl);
  const file = fileOf(mediaPath);
  if (VIDEO_EXT.has(extname(file).toLowerCase())) return 'motion';

  const haystack = [mediaPath, pathOf(pageUrl), pageTitle ?? '', alt ?? ''].join(' ').toLowerCase();
  const rule = matchTypeRules(haystack);
  if (rule) return rule;

  if (CAMERA_NAME_RE.test(file)) return 'photo';
  return 'misc';
}

/** Function words and web noise dropped before picking title keywords. */
const TITLE_STOPWORDS = new Set([
  'about',
  'after',
  'all',
  'also',
  'and',
  'any',
  'are',
  'because',
  'been',
  'before',
  'being',
  'but',
  'can',
  'com',
  'could',
  'did',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'her',
  'here',
  'his',
  'how',
  'html',
  'http',
  'https',
  'into',
  'its',
  'just',
  'like',
  'more',
  'most',
  'net',
  'not',
  'now',
  'off',
  'one',
  'only',
  'org',
  'other',
  'our',
  'out',
  'over',
  'own',
  'see',
  'she',
  'should',
  'since',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'too',
  'under',
  'until',
  'use',
  'very',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'www',
  'you',
  'your',
]);

/** How many keywords a page title may contribute. */
const TITLE_TAG_LIMIT = 3;

/** Provenance tags for a clipped element: the marker, the source host, the
    site name when it adds anything, and up to three title keywords. Every
    tag goes through normalizeTag() so clipped tags are interchangeable with
    manual ones across the tag rail, search, grouping and smart clusters. */
export function clipTags({ pageUrl, pageTitle, siteName } = {}) {
  const out = [];
  const push = (raw) => {
    const t = normalizeTag(raw ?? '');
    if (t && !out.includes(t)) out.push(t);
  };

  push('clipped');

  const host = hostOf(pageUrl);
  if (host) push(host);

  if (siteName) {
    const site = normalizeTag(siteName);
    if (site && site !== host) push(site);
  }

  let taken = 0;
  for (const word of String(pageTitle ?? '').split(/[^\p{L}\p{N}]+/u)) {
    if (taken >= TITLE_TAG_LIMIT) break;
    const w = normalizeTag(word);
    if (w.length < 3 || TITLE_STOPWORDS.has(w)) continue;
    const before = out.length;
    push(w);
    if (out.length > before) taken += 1;
  }

  return out;
}
