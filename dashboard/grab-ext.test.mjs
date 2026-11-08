// "Find the best version" (stage 2 of Bridge 0.7.0): the page scanner, the upgrade rules, the popup section and the
// service-worker half — a viewer. Classic extension scripts run in node vms with a fake DOM and a fake chrome
// (the popup-approval.test.mjs pattern: no jsdom, no browser). Placeholder pages only.
// Stage 3 (download on click: the queue, pacing, fallback, the HEAD check) is in dashboard/grab-download.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '..', 'browser-bridge');
const read = (f) => readFileSync(resolve(EXT, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));   // vm results cross a realm boundary

// ---- fake DOM ----------------------------------------------------------------------------------------------------
function el(tag, attrs = {}, props = {}) {
  return {
    tagName: tag.toUpperCase(), _attrs: attrs, children: [], parentElement: null, previousElementSibling: null, textContent: '',
    currentSrc: '', naturalWidth: 0, naturalHeight: 0, videoWidth: 0, videoHeight: 0, clientWidth: 0, clientHeight: 0, bg: 'none', rect: { width: 0, height: 0 },
    ...props,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
    getBoundingClientRect() { return this.rect; },
    closest(sel) { let n = this; while (n) { if (n.tagName === sel.toUpperCase()) return n; n = n.parentElement; } return null; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (sel === '*' || c.tagName === sel.toUpperCase()) out.push(c); walk(c); } }; walk(this); return out; },
  };
}
function put(parent, ...kids) { for (const k of kids) { k.parentElement = parent; k.previousElementSibling = parent.children[parent.children.length - 1] || null; parent.children.push(k); } return parent; }
const SIZE = (w, h) => ({ naturalWidth: w, naturalHeight: h });
const SHOWN = (w, h) => ({ rect: { width: w, height: h } });

function pageCtx({ body, base = 'https://alpha-site.test/blog/post', mq = [], title = 'Placeholder page' } = {}) {
  const calls = { fetch: 0, xhr: 0, image: 0 };
  const document = { baseURI: base, title, querySelectorAll: (s) => body.querySelectorAll(s) };
  const ctx = vm.createContext({
    URL, console, document, location: { href: base },
    getComputedStyle: (e) => ({ backgroundImage: e.bg }),
    matchMedia: (q) => ({ matches: mq.includes(q) }),
    fetch: () => { calls.fetch++; throw new Error('fetch must not be called'); },
    XMLHttpRequest: function () { calls.xhr++; throw new Error('XHR must not be used'); },
    Image: function () { calls.image++; throw new Error('Image must not be created'); },
  });
  vm.runInContext(read('grab-scan.js'), ctx);
  return { ctx, calls, scan: (o) => plain(ctx.hqGrabScan(o)) };
}
const find = (r, url) => r.items.find((i) => i.url === url);

test('<img src> resolves to an absolute URL with its natural size and the size it is shown at', () => {
  const body = el('body');
  put(body, el('img', { src: '/media/p1.jpg', alt: 'A placeholder photo' }, { currentSrc: 'https://alpha-site.test/media/p1.jpg', ...SIZE(1600, 900), ...SHOWN(800, 450) }));
  const r = pageCtx({ body }).scan();
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.url, 'https://alpha-site.test/media/p1.jpg');
  assert.deepEqual([it.kind, it.via, it.w, it.h, it.shownW, it.shownH, it.label], ['image', 'img', 1600, 900, 800, 450, 'A placeholder photo']);
});

test('a relative src with no currentSrc resolves against the page and its size stays unknown (never guessed)', () => {
  const body = el('body');
  put(body, el('img', { src: 'pics/p2.png' }, SHOWN(500, 300)));
  const it = pageCtx({ body }).scan().items[0];
  assert.equal(it.url, 'https://alpha-site.test/blog/pics/p2.png');
  assert.deepEqual([it.w, it.h], [0, 0]);
});

test('srcset by w, minified commas included, and by x', () => {
  const body = el('body');
  put(body,
    el('img', { src: 'a-480.jpg', srcset: 'a-480.jpg 480w,a-800.jpg 800w, a-1600.jpg 1600w' }, { currentSrc: 'https://alpha-site.test/blog/a-800.jpg', ...SIZE(800, 600), ...SHOWN(400, 300) }),
    el('img', { src: 'b-1x.jpg', srcset: 'b-1x.jpg 1x,b-2x.jpg 2x,b-3x.jpg 3x' }, { currentSrc: 'https://alpha-site.test/blog/b-1x.jpg', ...SIZE(640, 480), ...SHOWN(640, 480) }));
  const r = pageCtx({ body }).scan();
  const a = find(r, 'https://alpha-site.test/blog/a-800.jpg');
  assert.deepEqual(a.variants.map((v) => [v.url.split('/').pop(), v.w]), [['a-480.jpg', 480], ['a-1600.jpg', 1600]]);
  const b = find(r, 'https://alpha-site.test/blog/b-1x.jpg');
  assert.deepEqual(b.variants.map((v) => [v.url.split('/').pop(), v.x]), [['b-2x.jpg', 2], ['b-3x.jpg', 3]]);
});

test('srcset URLs that contain commas survive (a CDN transform path), and trailing commas are tolerated', () => {
  const body = el('body');
  const cdn = 'https://res.alpha-cdn.test/image/upload/w_300,h_200,c_fill/v1/x.jpg';
  put(body, el('img', { srcset: `${cdn} 300w, https://res.alpha-cdn.test/image/upload/w_900,h_600/v1/x.jpg 900w,` }, { currentSrc: cdn, ...SIZE(300, 200), ...SHOWN(300, 200) }));
  const it = pageCtx({ body }).scan().items[0];
  assert.equal(it.url, cdn);
  assert.deepEqual(it.variants.map((v) => v.w), [900]);
  assert.equal(it.variants[0].url, 'https://res.alpha-cdn.test/image/upload/w_900,h_600/v1/x.jpg');
});

test('<picture>: only sources whose media query matches contribute', () => {
  const body = el('body'), pic = el('picture');
  put(pic,
    el('source', { media: '(min-width: 800px)', srcset: 'wide-1600.jpg 1600w, wide-2400.jpg 2400w' }),
    el('source', { media: '(max-width: 400px)', srcset: 'narrow-400.jpg 400w' }),
    el('source', { srcset: 'any-1200.webp 1200w' }),
    el('img', { src: 'fallback-800.jpg' }, { currentSrc: 'https://alpha-site.test/blog/wide-1600.jpg', ...SIZE(1600, 900), ...SHOWN(800, 450) }));
  put(body, pic);
  const it = pageCtx({ body, mq: ['(min-width: 800px)'] }).scan().items[0];
  const names = it.variants.map((v) => v.url.split('/').pop());
  assert.ok(names.includes('wide-2400.jpg'));
  assert.ok(names.includes('any-1200.webp'));
  assert.ok(!names.includes('narrow-400.jpg'));
  assert.equal(it.via, 'picture');
});

test('lazy images: data-src and data-srcset behind a data: placeholder', () => {
  const body = el('body');
  put(body, el('img', { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data-src': '/lazy/l1.jpg', 'data-srcset': '/lazy/l1-800.jpg 800w, /lazy/l1-1600.jpg 1600w' }, SHOWN(400, 300)));
  const r = pageCtx({ body }).scan();
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.url, 'https://alpha-site.test/lazy/l1.jpg');
  assert.equal(it.via, 'lazy');
  assert.equal(it.w, 0);
  assert.deepEqual(it.variants.map((v) => v.w), [800, 1600]);
  assert.ok(r.skipped.data >= 1);
});

test('a srcset-only image with no src picks its widest variant as the primary', () => {
  const body = el('body');
  put(body, el('img', { srcset: 's-300.jpg 300w, s-1200.jpg 1200w' }, SHOWN(300, 200)));
  const it = pageCtx({ body }).scan().items[0];
  assert.equal(it.url, 'https://alpha-site.test/blog/s-1200.jpg');
});

test('CSS background images: url() values read, gradients ignored, small icons dropped', () => {
  const body = el('body');
  put(body,
    el('div', {}, { bg: 'url("https://alpha-site.test/bg/hero.jpg"), linear-gradient(red, blue)', ...SHOWN(1200, 400) }),
    el('div', {}, { bg: "url('/bg/icon.png')", ...SHOWN(32, 32) }),
    el('div', {}, { bg: 'linear-gradient(red, blue)', ...SHOWN(900, 900) }),
    el('div', {}, { bg: 'url(/bg/card.jpg)', ...SHOWN(300, 300) }));
  const r = pageCtx({ body }).scan();
  assert.deepEqual(r.items.map((i) => i.url.split('/').pop()).sort(), ['card.jpg', 'hero.jpg']);
  for (const i of r.items) { assert.equal(i.via, 'bg'); assert.equal(i.w, 0); }
  assert.equal(r.skipped.small, 1);
});

test('<video>: src with natural size, <source> alternatives, and the poster', () => {
  const body = el('body'), v = el('video', { src: 'clips/c1.mp4', poster: 'clips/c1.jpg' }, { currentSrc: 'https://alpha-site.test/blog/clips/c1.mp4', videoWidth: 1280, videoHeight: 720, ...SHOWN(640, 360) });
  put(v, el('source', { src: 'clips/c1.webm', type: 'video/webm' }));
  const v2 = el('video', {}, { ...SHOWN(400, 300) });
  put(v2, el('source', { src: 'clips/c2.mp4' }), el('source', { src: 'clips/c2.webm' }));
  put(body, v, v2);
  const r = pageCtx({ body }).scan();
  const c1 = find(r, 'https://alpha-site.test/blog/clips/c1.mp4');
  assert.deepEqual([c1.kind, c1.w, c1.h], ['video', 1280, 720]);
  assert.equal(c1.variants[0].url, 'https://alpha-site.test/blog/clips/c1.webm');
  assert.equal(find(r, 'https://alpha-site.test/blog/clips/c1.jpg').via, 'poster');
  const c2 = find(r, 'https://alpha-site.test/blog/clips/c2.mp4');
  assert.equal(c2.kind, 'video'); assert.equal(c2.variants[0].url, 'https://alpha-site.test/blog/clips/c2.webm');
});

test('blob: and data: are skipped; a blob: video is reported as streamed, with nothing to copy', () => {
  const body = el('body');
  put(body,
    el('img', { src: 'blob:https://alpha-site.test/1111-2222' }, { currentSrc: 'blob:https://alpha-site.test/1111-2222', ...SIZE(900, 900) }),
    el('img', { src: 'data:image/png;base64,AAAA' }, { currentSrc: 'data:image/png;base64,AAAA', ...SIZE(900, 900) }),
    el('video', { src: 'blob:https://alpha-site.test/3333-4444' }, { currentSrc: 'blob:https://alpha-site.test/3333-4444', videoWidth: 1920, videoHeight: 1080 }));
  const r = pageCtx({ body }).scan();
  assert.equal(r.streamed, 1);
  assert.deepEqual(r.items.map((i) => [i.streamed === true, i.url]), [[true, '']]);
  assert.ok(r.skipped.blob >= 1 && r.skipped.data >= 1);
});

test('duplicates are removed (an <img> and a background of the same file become one entry)', () => {
  const body = el('body');
  put(body,
    el('img', { src: '/m/same.jpg' }, { currentSrc: 'https://alpha-site.test/m/same.jpg', ...SIZE(1000, 700), ...SHOWN(500, 350) }),
    el('img', { src: '/m/same.jpg#top', alt: 'Seen twice' }, { currentSrc: 'https://alpha-site.test/m/same.jpg', ...SIZE(1000, 700), ...SHOWN(250, 175) }),
    el('div', {}, { bg: 'url(/m/same.jpg)', ...SHOWN(600, 400) }));
  const r = pageCtx({ body }).scan();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].label, 'Seen twice');
});

test('anything under 200 px is dropped; one big side or an unknown size is kept', () => {
  const body = el('body');
  put(body,
    el('img', { src: '/s/tiny.jpg' }, { currentSrc: 'https://alpha-site.test/s/tiny.jpg', ...SIZE(100, 100) }),
    el('img', { src: '/s/edge.jpg' }, { currentSrc: 'https://alpha-site.test/s/edge.jpg', ...SIZE(199, 199) }),
    el('img', { src: '/s/strip.jpg' }, { currentSrc: 'https://alpha-site.test/s/strip.jpg', ...SIZE(1200, 150) }),
    el('img', { src: '/s/exact.jpg' }, { currentSrc: 'https://alpha-site.test/s/exact.jpg', ...SIZE(200, 200) }),
    el('img', { src: '/s/unknown.jpg' }, SHOWN(120, 90)));
  const r = pageCtx({ body }).scan();
  assert.deepEqual(r.items.map((i) => i.url.split('/').pop()).sort(), ['exact.jpg', 'strip.jpg', 'unknown.jpg']);
  assert.equal(r.skipped.small, 2);
});

test('labels: alt, else figcaption, else the nearest heading; cut to 120 characters without splitting an emoji', () => {
  const body = el('body'), fig = el('figure'), sec = el('section');
  put(fig, el('img', { src: '/l/f.jpg' }, { currentSrc: 'https://alpha-site.test/l/f.jpg', ...SIZE(800, 600) }), el('figcaption', {}, { textContent: '  A figure   caption \n here ' }));
  const h = el('h2', {}, { textContent: 'Gallery heading' });
  put(sec, h, el('div'));
  put(sec.children[1], el('img', { src: '/l/h.jpg' }, { currentSrc: 'https://alpha-site.test/l/h.jpg', ...SIZE(800, 600) }));
  const longAlt = '🙂'.repeat(130);
  put(body, fig, sec, el('img', { src: '/l/long.jpg', alt: longAlt }, { currentSrc: 'https://alpha-site.test/l/long.jpg', ...SIZE(800, 600) }));
  const r = pageCtx({ body }).scan();
  assert.equal(find(r, 'https://alpha-site.test/l/f.jpg').label, 'A figure caption here');
  assert.equal(find(r, 'https://alpha-site.test/l/h.jpg').label, 'Gallery heading');
  const long = find(r, 'https://alpha-site.test/l/long.jpg').label;
  assert.equal(Array.from(long).length, 120);
  assert.ok(!/\uFFFD/.test(long));
});

test('scanPage.toString() run through new Function in a fresh context still works and touches nothing outside itself', () => {
  const body = el('body');
  put(body, el('img', { src: '/m/x.jpg', srcset: '/m/x-2.jpg 2x' }, { currentSrc: 'https://alpha-site.test/m/x.jpg', ...SIZE(1000, 700), ...SHOWN(500, 350) }));
  const first = pageCtx({ body });
  const src = first.ctx.hqGrabScan.toString();
  assert.match(src, /^function hqGrabScan/);
  // a fresh context that has only the page globals — no helper from grab-scan.js is defined there
  const fresh = pageCtx({ body });
  fresh.ctx.SRC = src;
  const fn = vm.runInContext("new Function('return ' + SRC)()", vm.createContext(Object.assign(fresh.ctx, {})));
  const out = plain(fn({ min: 200 }));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].variants[0].x, 2);
  // and in a context with NO grab-scan.js at all, only the DOM globals
  const bare = vm.createContext({ URL, document: { baseURI: 'https://alpha-site.test/', title: 't', querySelectorAll: (s) => body.querySelectorAll(s) }, location: { href: 'https://alpha-site.test/' }, getComputedStyle: () => ({ backgroundImage: 'none' }) });
  bare.SRC = src;
  const out2 = plain(vm.runInContext("new Function('return ' + SRC)()({})", bare));
  assert.equal(out2.items[0].url, 'https://alpha-site.test/m/x.jpg');
});

test('the scanner makes no request: fetch, XMLHttpRequest and Image all throw, and none is called', () => {
  const body = el('body');
  put(body, el('img', { src: '/m/a.jpg', srcset: '/m/a2.jpg 2x' }, { currentSrc: 'https://alpha-site.test/m/a.jpg', ...SIZE(900, 600) }), el('div', {}, { bg: 'url(/m/b.jpg)', ...SHOWN(400, 400) }), el('video', { src: '/m/c.mp4', poster: '/m/c.jpg' }));
  const p = pageCtx({ body });
  p.scan();
  assert.deepEqual(p.calls, { fetch: 0, xhr: 0, image: 0 });
});

// ---- the upgrade rules ---------------------------------------------------------------------------------------------
const rulesCtx = vm.createContext({ URL, console });
vm.runInContext(read('grab-rules.js'), rulesCtx);
const Rules = rulesCtx.HQGrabRules;
const up = (u) => plain(Rules.upgradeCandidates(u));

function checkShape(url, list) {
  const host = new URL(url).hostname;
  assert.equal(list.at(-1), Rules.normalizeUrl(url), 'the original is last');
  assert.equal(new Set(list).size, list.length, 'no duplicates');
  for (const c of list) { assert.match(c, /^https?:/); assert.equal(new URL(c).hostname, host, 'same host'); }
}

test('upgrade rules: X name=orig, and the :small suffix form', () => {
  const u = 'https://pbs.twimg.com/media/AbCd123?format=jpg&name=small';
  const l = up(u);
  assert.equal(l[0], 'https://pbs.twimg.com/media/AbCd123?format=jpg&name=orig');
  checkShape(u, l);
  assert.equal(up('https://pbs.twimg.com/media/AbCd123.jpg:small')[0], 'https://pbs.twimg.com/media/AbCd123.jpg:orig');
  assert.deepEqual(up('https://pbs.twimg.com/media/AbCd123?format=jpg&name=orig'), ['https://pbs.twimg.com/media/AbCd123?format=jpg&name=orig']);
  assert.deepEqual(up('https://alpha-site.test/media/AbCd123?name=small').length, 1, 'name= only means orig on X');
});

test('upgrade rules: WordPress -WxH and -scaled', () => {
  let u = 'https://alpha-site.test/wp-content/uploads/2026/01/photo-300x200.jpg';
  assert.deepEqual(up(u), ['https://alpha-site.test/wp-content/uploads/2026/01/photo.jpg', u]);
  u = 'https://alpha-site.test/wp-content/uploads/2026/01/photo-scaled.jpg';
  assert.deepEqual(up(u), ['https://alpha-site.test/wp-content/uploads/2026/01/photo.jpg', u]);
  u = 'https://alpha-site.test/wp-content/uploads/2026/01/photo-scaled-300x200.jpg';
  const l = up(u);
  assert.equal(l[0], 'https://alpha-site.test/wp-content/uploads/2026/01/photo-scaled.jpg');
  assert.equal(l[1], 'https://alpha-site.test/wp-content/uploads/2026/01/photo.jpg');
  checkShape(u, l);
  assert.deepEqual(up('https://alpha-site.test/img/photo-scaled.jpg').length, 1, '-scaled only under wp-content');
});

test('upgrade rules: Cloudinary transforms, stacked ones too', () => {
  let u = 'https://res.cloudinary.com/demo/image/upload/c_fill,w_300,h_200/v1/sample.jpg';
  assert.deepEqual(up(u), ['https://res.cloudinary.com/demo/image/upload/v1/sample.jpg', u]);
  u = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/w_300/v1/folder/sample.jpg';
  assert.deepEqual(up(u), ['https://res.cloudinary.com/demo/image/upload/v1/folder/sample.jpg', u]);
  assert.deepEqual(up('https://res.cloudinary.com/demo/image/upload/v1/sample.jpg').length, 1);
});

test('upgrade rules: generic w, h, width, height, resize parameters (other parameters stay)', () => {
  const u = 'https://cdn.alpha-site.test/p.jpg?w=300&h=200&q=80&width=3&height=4&resize=2';
  const l = up(u);
  assert.equal(l[0], 'https://cdn.alpha-site.test/p.jpg?q=80');
  checkShape(u, l);
  assert.equal(up('https://cdn.alpha-site.test/p.jpg?w=300')[0], 'https://cdn.alpha-site.test/p.jpg');
  assert.equal(up('https://cdn.alpha-site.test/p.jpg?q=80').length, 1);
});

test('upgrade rules: /thumb/ and /small/ segments, and an _NxN suffix', () => {
  let u = 'https://alpha-site.test/img/thumb/cat.jpg';
  assert.deepEqual(up(u), ['https://alpha-site.test/img/large/cat.jpg', 'https://alpha-site.test/img/original/cat.jpg', u]);
  assert.equal(up('https://alpha-site.test/small/cat.jpg')[0], 'https://alpha-site.test/large/cat.jpg');
  u = 'https://alpha-site.test/img/cat_300x200.jpg';
  assert.deepEqual(up(u), ['https://alpha-site.test/img/cat.jpg', u]);
  assert.equal(up('https://alpha-site.test/img/thumbnail/cat.jpg').length, 1, 'only whole /thumb/ /small/ segments');
});

test('upgrade rules: no duplicates, the original last, a hash dropped; other hosts and non-http(s) refused', () => {
  const l = up('https://alpha-site.test/img/thumb/cat_300x200.jpg?w=100#frag');
  checkShape('https://alpha-site.test/img/thumb/cat_300x200.jpg?w=100', l);
  assert.ok(l.length >= 3);
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'blob:https://alpha-site.test/1', 'ftp://alpha-site.test/a.jpg', 'file:///C:/a.jpg', '', 'not a url', null, undefined]) {
    assert.deepEqual(up(bad), [], String(bad));
  }
});

test('candidatesFor: guesses first and marked, the page\'s own variants by size next, the original last', () => {
  const entry = { url: 'https://alpha-site.test/wp-content/uploads/p-300x200.jpg', w: 300, h: 200, variants: [{ url: 'https://alpha-site.test/wp-content/uploads/p-600x400.jpg', w: 600 }, { url: 'https://alpha-site.test/wp-content/uploads/p-1200x800.jpg', w: 1200 }] };
  const c = plain(Rules.candidatesFor(entry));
  assert.equal(c.at(-1).url, entry.url); assert.equal(c.at(-1).guess, false);
  assert.equal(c[0].guess, true);
  assert.equal(new Set(c.map((x) => x.url)).size, c.length);
  const real = c.filter((x) => !x.guess).map((x) => x.url);
  assert.deepEqual(real, [entry.variants[1].url, entry.variants[0].url, entry.url]);
  assert.deepEqual(plain(Rules.candidatesFor({ url: 'javascript:1' })), []);
  assert.deepEqual(plain(Rules.candidatesFor({ url: 'https://alpha-site.test/a.jpg' })), [{ url: 'https://alpha-site.test/a.jpg', guess: false }]);
});

test('rankEntries: the clicked one on top (also by one of its variants), then biggest first, stable for unknowns', () => {
  const a = { url: 'https://alpha-site.test/a.jpg', w: 800, h: 600, variants: [] };
  const b = { url: 'https://alpha-site.test/b.jpg', w: 3000, h: 2000, variants: [] };
  const c = { url: 'https://alpha-site.test/c.jpg', w: 0, h: 0, variants: [{ url: 'https://alpha-site.test/c-big.jpg', w: 2000 }] };
  const d = { url: 'https://alpha-site.test/d.jpg', w: 0, h: 0, variants: [] };
  assert.deepEqual(plain(Rules.rankEntries([a, d, c, b], '')).map((e) => e.url.split('/').pop()), ['b.jpg', 'c.jpg', 'a.jpg', 'd.jpg']);
  assert.deepEqual(plain(Rules.rankEntries([a, d, c, b], 'https://alpha-site.test/a.jpg#x')).map((e) => e.url.split('/').pop()), ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  assert.equal(plain(Rules.rankEntries([a, b, c], 'https://alpha-site.test/c-big.jpg'))[0].url.split('/').pop(), 'c.jpg');
});

test('describe: type · size · host · file name, and "×N bigger than shown"', () => {
  const d = plain(Rules.describe({ url: 'https://img.alpha-site.test/g/photo%201.JPG', kind: 'image', w: 1600, h: 900, shownW: 400, shownH: 225, variants: [], label: 'x' }));
  assert.deepEqual([d.typeWord, d.size, d.host, d.name, d.bigger], ['jpg', '1600×900', 'img.alpha-site.test', 'photo 1.JPG', '×4 bigger than shown']);
  assert.equal(plain(Rules.describe({ url: 'https://a.test/x.png', w: 500, h: 500, shownW: 450, variants: [] })).bigger, '');
  assert.equal(plain(Rules.describe({ url: 'https://a.test/x', w: 0, h: 0, shownW: 100, variants: [{ url: 'https://a.test/x2', w: 250 }] })).bigger, '×2.5 bigger than shown');
  assert.equal(plain(Rules.describe({ url: 'https://a.test/x', w: 0, h: 0, variants: [] })).size, 'size unknown');
  assert.equal(plain(Rules.describe({ url: '', streamed: true })).streamed, true);
});

test('isRestricted: browser pages, the Web Store and extension pages; plain web pages are fine', () => {
  for (const u of ['chrome://extensions', 'chrome-extension://abc/page.html', 'about:blank', 'view-source:https://a.test', 'edge://settings', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x', '', undefined, 'data:text/html,hi']) {
    assert.equal(Rules.isRestricted(u), true, String(u));
  }
  for (const u of ['https://alpha-site.test/', 'http://localhost:3000/', 'file:///C:/page.html']) assert.equal(Rules.isRestricted(u), false, u);
});

// ---- the popup section ---------------------------------------------------------------------------------------------
function fakeDoc() {
  const mk = (tag) => {
    const listeners = {};
    if (tag === 'img') throw new Error('an <img> would be a request: no remote thumbnails');
    return {
      tag, className: '', textContent: '', dataset: {}, children: [], type: '',
      appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; },
      addEventListener(t, f) { listeners[t] = f; }, click() { listeners.click && listeners.click(); },
      set innerHTML(v) { throw new Error('innerHTML was used: ' + String(v).slice(0, 40)); },
    };
  };
  return { createElement: mk, mk };
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };
const textsOf = (host) => { const t = []; walk(host, (n) => { if (n.textContent) t.push(n.textContent); }); return t; };

function popupWorld({ tab = { id: 7, url: 'https://alpha-site.test/blog/post' }, target = null, scanResult = null, scanThrows = null, now = { t: 1_000_000 } } = {}) {
  const session = new Map(target ? [['hq_grab_target', target]] : []);
  const badge = { text: 'x' };
  const calls = { fetch: 0, xhr: 0, executed: [] };
  const chrome = {
    storage: { session: { get: async (k) => (session.has(k) ? { [k]: session.get(k) } : {}), set: async (o) => { for (const [k, v] of Object.entries(o)) session.set(k, v); }, remove: async (k) => { session.delete(k); } } },
    tabs: { get: async () => tab, query: async () => (tab ? [tab] : []) },
    action: { setBadgeText: async ({ text }) => { badge.text = text; } },
    scripting: { executeScript: async (o) => { calls.executed.push(o); if (scanThrows) throw new Error(scanThrows); return [{ result: scanResult }]; } },
  };
  const ctx = vm.createContext({ URL, console, fetch: () => { calls.fetch++; throw new Error('no requests'); }, XMLHttpRequest: function () { calls.xhr++; throw new Error('no requests'); } });
  vm.runInContext(read('grab-rules.js'), ctx);
  vm.runInContext(read('grab-popup.js'), ctx);
  const scanStub = function hqGrabScan() {};
  const pop = ctx.HQGrabPopup.create({ chrome, scan: scanStub, now: () => now.t });
  return { pop, chrome, session, badge, calls, ctx, scanStub };
}
const item = (url, w, h, extra = {}) => ({ url, kind: 'image', via: 'img', w, h, shownW: Math.round(w / 2), shownH: Math.round(h / 2), label: '', variants: [], ...extra });

test('popup: the scan runs on the right-clicked tab with activeTab, and the clicked image leads the list', async () => {
  const p = popupWorld({
    target: { tabId: 7, srcUrl: 'https://alpha-site.test/m/small-one.jpg', mediaType: 'image', at: 1_000_000 - 1000 },
    scanResult: { ok: true, items: [item('https://alpha-site.test/m/big.jpg', 3000, 2000), item('https://alpha-site.test/m/small-one.jpg', 800, 600), item('https://alpha-site.test/m/mid.jpg', 1600, 900)], streamed: 0, skipped: {} },
  });
  const m = plain(await p.pop.load());
  assert.equal(m.state, 'ok');
  assert.deepEqual(m.rows.map((r) => r.entry.url.split('/').pop()), ['small-one.jpg', 'big.jpg', 'mid.jpg']);
  assert.equal(m.rows[0].clicked, true); assert.equal(m.rows[1].clicked, false);
  assert.equal(p.calls.executed.length, 1);
  assert.equal(p.calls.executed[0].target.tabId, 7);
  assert.equal(p.calls.executed[0].func, p.scanStub, 'the injected function is the scanner, not a string');
  assert.equal(p.badge.text, '', 'the … hold is cleared when the popup shows the target');
});

test('popup: with no right-click the active tab is scanned and nothing is marked clicked', async () => {
  const p = popupWorld({ scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  const m = plain(await p.pop.load());
  assert.equal(m.state, 'ok'); assert.equal(m.rows[0].clicked, false);
});

test('popup: a right-clicked image the scanner filtered out is still shown, on top', async () => {
  const p = popupWorld({ target: { tabId: 7, srcUrl: 'https://alpha-site.test/m/tiny.jpg', mediaType: 'image', at: 1_000_000 }, scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  const m = plain(await p.pop.load());
  assert.equal(m.rows[0].entry.url, 'https://alpha-site.test/m/tiny.jpg');
  assert.equal(m.rows[0].info.size, 'size unknown');
});

test('popup: a stale right-click (over 10 minutes) is ignored', async () => {
  const p = popupWorld({ target: { tabId: 7, srcUrl: 'https://alpha-site.test/m/old.jpg', mediaType: 'image', at: 1_000_000 - 11 * 60_000 }, scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  const m = plain(await p.pop.load());
  assert.deepEqual(m.rows.map((r) => r.entry.url.split('/').pop()), ['a.jpg']);
});

test('popup states: restricted pages, a refused injection, nothing found, streamed video — in the spec\'s words', async () => {
  let p = popupWorld({ tab: { id: 1, url: 'chrome://extensions' } });
  let m = plain(await p.pop.load());
  assert.equal(m.state, 'restricted'); assert.equal(m.message, "Chrome doesn't let extensions read this page");
  assert.equal(p.calls.executed.length, 0, 'no script is even tried on a restricted page');
  p = popupWorld({ scanThrows: 'Cannot access contents of the page. Extension manifest must request permission' });
  m = plain(await p.pop.load());
  assert.equal(m.state, 'restricted');
  p = popupWorld({ scanThrows: 'The tab was closed.' });
  m = plain(await p.pop.load());
  assert.equal(m.state, 'error'); assert.match(m.message, /Couldn't read this page/);
  p = popupWorld({ scanResult: { ok: true, items: [], streamed: 0, skipped: { small: 4 } } });
  m = plain(await p.pop.load());
  assert.equal(m.state, 'empty'); assert.equal(m.message, 'No images or videos here bigger than 200 px');
  p = popupWorld({ scanResult: { ok: true, items: [{ url: '', kind: 'video', streamed: true, variants: [] }], streamed: 1 } });
  m = plain(await p.pop.load());
  assert.equal(m.state, 'streamed'); assert.equal(m.message, 'streamed video — needs the video helper (not installed)');
  p = popupWorld({ target: { tabId: 7, srcUrl: 'blob:https://alpha-site.test/1234', mediaType: 'video', at: 1_000_000 }, scanResult: { ok: true, items: [], streamed: 0 } });
  m = plain(await p.pop.load());
  assert.equal(m.state, 'streamed');
  p = popupWorld({ tab: null });
  assert.equal(plain(await p.pop.load()).state, 'none');
});

test('popup render: every string goes in through textContent; Copy best link hands over the first candidate; the Save note is there', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = popupWorld({ scanResult: { ok: true, items: [item('https://alpha-site.test/wp-content/uploads/p-300x200.jpg', 300, 200, { label: evil, shownW: 100, variants: [{ url: 'https://alpha-site.test/wp-content/uploads/p-900x600.jpg', w: 900 }] })], streamed: 0 } });
  const m = await p.pop.load();
  const doc = fakeDoc(), host = doc.mk('div'), copied = [];
  p.pop.render(doc, host, m, { copy: (u) => copied.push(u) });
  const texts = textsOf(host);
  assert.ok(texts.includes(evil), 'shown as plain text');
  assert.ok(texts.includes(Rules.SAVE_NOTE) && /Downloads\/WorkspaceHQ\/grabs\//.test(Rules.SAVE_NOTE), 'says where a click saves, and that nothing is requested before it');
  assert.ok(texts.some((t) => /^jpg · 300×200 · alpha-site\.test · p-300x200\.jpg$/.test(t)));
  assert.ok(texts.includes('×9 bigger than shown'));
  assert.ok(texts.some((t) => t.startsWith('guess · ')));
  assert.ok(texts.includes(Rules.GUESS_NOTE));
  const buttons = []; walk(host, (n) => { if (n.tag === 'button') buttons.push(n); });
  assert.deepEqual(buttons.map((b) => b.textContent), ['Copy guessed link', 'Save guessed size'], 'one copy and one save for the one row; the first link is a guess, and both say so');
  buttons[0].click();
  assert.deepEqual(copied, ['https://alpha-site.test/wp-content/uploads/p.jpg']);
  assert.ok(!buttons.some((b) => /all/i.test(b.textContent)), 'no save-all control');
});

test('popup render: the button says "best" only when the first link is a variant the page itself offers', async () => {
  const p = popupWorld({ scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 300, 200, { variants: [{ url: 'https://alpha-site.test/m/a-big.jpg', w: 1600 }] })], streamed: 0 } });
  const m = await p.pop.load();
  assert.equal(m.rows[0].candidates[0].guess, false);
  const doc = fakeDoc(), host = doc.mk('div');
  p.pop.render(doc, host, m, {});
  const buttons = []; walk(host, (n) => { if (n.tag === 'button') buttons.push(n); });
  assert.deepEqual(buttons.map((b) => b.textContent), ['Copy best link', 'Save best size']);
});

test('popup: a right-click is spent by the first read — a later open scans the page the owner is on, with nothing marked clicked', async () => {
  const p = popupWorld({ target: { tabId: 7, srcUrl: 'https://alpha-site.test/m/small-one.jpg', mediaType: 'image', at: 1_000_000 }, scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  const first = plain(await p.pop.load());
  assert.equal(first.rows[0].clicked, true);
  assert.equal(p.session.has('hq_grab_target'), false, 'the target is consumed');
  const again = plain(await p.pop.load());
  assert.equal(again.rows[0].clicked, false);
  assert.equal(again.clicked, '');
});

test('popup: a right-click on a tab the owner has left is dropped — the active page is scanned, not the old one, and a closed tab is no "No page to read"', async () => {
  const other = { id: 9, url: 'https://b.example/page' };
  const scan = { ok: true, items: [item('https://b.example/m/b.jpg', 900, 600)], streamed: 0 };
  const target = { tabId: 7, srcUrl: 'https://alpha-site.test/m/small-one.jpg', mediaType: 'image', at: 1_000_000 };
  // the clicked tab was closed (tabs.get throws) and the owner is on b.example
  let p = popupWorld({ target, scanResult: scan });
  p.chrome.tabs = { get: async () => { throw new Error('No tab with id: 7'); }, query: async () => [other] };
  let m = plain(await p.pop.load());
  assert.equal(m.state, 'ok');
  assert.equal(p.calls.executed[0].target.tabId, 9);
  assert.deepEqual(m.rows.map((r) => r.entry.url.split('/').pop()), ['b.jpg'], 'the old right-click is not injected');
  // the clicked tab is still open in the background: still not scanned
  p = popupWorld({ target, scanResult: scan });
  p.chrome.tabs = { get: async () => ({ id: 7, url: 'https://alpha-site.test/blog/post' }), query: async () => [other] };
  m = plain(await p.pop.load());
  assert.equal(p.calls.executed[0].target.tabId, 9);
  assert.equal(m.rows[0].clicked, false);
});

test('popup: an active tab that cannot be read at all lets the clicked tab stand in', async () => {
  const p = popupWorld({ target: { tabId: 7, srcUrl: 'https://alpha-site.test/m/x.jpg', mediaType: 'image', at: 1_000_000 }, scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  p.chrome.tabs = { get: async () => ({ id: 7, url: 'https://alpha-site.test/blog/post' }), query: async () => { throw new Error('no window'); } };
  const m = plain(await p.pop.load());
  assert.equal(p.calls.executed[0].target.tabId, 7);
  assert.equal(m.rows[0].clicked, true);
});

test('popup render: an empty state shows its message and no rows', async () => {
  const p = popupWorld({ scanResult: { ok: true, items: [], streamed: 0 } });
  const doc = fakeDoc(), host = doc.mk('div');
  p.pop.render(doc, host, await p.pop.load(), {});
  assert.ok(textsOf(host).includes('No images or videos here bigger than 200 px'));
  let buttons = 0; walk(host, (n) => { if (n.tag === 'button') buttons++; });
  assert.equal(buttons, 0);
});

test('the popup makes no request while loading and rendering: fetch and XMLHttpRequest throw, and no <img> is created', async () => {
  const p = popupWorld({ scanResult: { ok: true, items: [item('https://alpha-site.test/m/a.jpg', 900, 600)], streamed: 0 } });
  const doc = fakeDoc(), host = doc.mk('div');
  p.pop.render(doc, host, await p.pop.load(), { copy() {} });   // fakeDoc throws on createElement('img')
  assert.equal(p.calls.fetch, 0); assert.equal(p.calls.xhr, 0);
});

test('copyText uses the clipboard API, falls back to a textarea, and reports failure honestly', async () => {
  const p = popupWorld();
  const got = [];
  p.ctx.navigator = { clipboard: { writeText: async (t) => { got.push(t); } } };
  assert.equal(await p.pop.copyText('https://alpha-site.test/a.jpg'), true);
  assert.deepEqual(got, ['https://alpha-site.test/a.jpg']);
  p.ctx.navigator = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
  const body = { children: [], appendChild(c) { this.children.push(c); }, removeChild() {} };
  const pop2 = p.ctx.HQGrabPopup.create({ chrome: p.chrome, doc: { createElement: () => ({ select() {} }), body, execCommand: () => true } });
  assert.equal(await pop2.copyText('x'), true);
  const pop3 = p.ctx.HQGrabPopup.create({ chrome: p.chrome, doc: { createElement: () => ({ select() {} }), body, execCommand: () => false } });
  assert.equal(await pop3.copyText('x'), false);
});

// ---- the service-worker half ---------------------------------------------------------------------------------------
function swWorld({ openPopupThrows = false, now = { t: 5_000_000 } } = {}) {
  const session = new Map(), menu = [], badge = { text: '', log: [] }, listeners = [];
  const chrome = {
    storage: { session: { get: async (k) => (session.has(k) ? { [k]: structuredClone(session.get(k)) } : {}), set: async (o) => { for (const [k, v] of Object.entries(o)) session.set(k, structuredClone(v)); }, remove: async (k) => { session.delete(k); } } },
    contextMenus: { removeAll: (cb) => cb(), create: (o, cb) => { menu.push(o); cb(); }, onClicked: { addListener: (f) => listeners.push(f) } },
    action: { setBadgeText: async ({ text }) => { badge.text = text; badge.log.push(text); }, openPopup: async () => { if (openPopupThrows) throw new Error('openPopup() is not allowed here'); badge.log.push('popup'); } },
  };
  const ctx = vm.createContext({ console });
  vm.runInContext(read('grab.js'), ctx);
  return { grab: ctx.HQGrab.create({ chrome, now: () => now.t }), chrome, session, menu, badge, listeners, now };
}

test('grab.js: the menu item is "Find the best version" on images and videos', async () => {
  const w = swWorld();
  await w.grab.registerMenu();
  assert.equal(w.menu.length, 1);
  assert.equal(w.menu[0].title, 'Find the best version');
  assert.deepEqual(plain(w.menu[0].contexts), ['image', 'video']);
});

test('grab.js: a click stores the target in storage.session and opens the popup where allowed', async () => {
  const w = swWorld();
  const handled = await w.grab.onMenuClick({ menuItemId: 'hq-grab', srcUrl: 'https://alpha-site.test/m/a.jpg', pageUrl: 'https://alpha-site.test/blog/post', mediaType: 'image' }, { id: 7, url: 'https://alpha-site.test/blog/post' });
  assert.equal(handled, true);
  const t = w.session.get('hq_grab_target');
  assert.deepEqual([t.tabId, t.srcUrl, t.mediaType, t.at], [7, 'https://alpha-site.test/m/a.jpg', 'image', 5_000_000]);
  assert.ok(w.badge.log.includes('popup'));
});

test('grab.js: where openPopup is not allowed the badge shows … and the next popup open still finds the target', async () => {
  const w = swWorld({ openPopupThrows: true });
  await w.grab.onMenuClick({ menuItemId: 'hq-grab', srcUrl: 'https://alpha-site.test/m/a.jpg', mediaType: 'video' }, { id: 3 });
  assert.equal(w.badge.text, '…');
  assert.equal(w.session.get('hq_badge_hold'), '…');
  const t = await w.grab.takeTarget();
  assert.equal(t.srcUrl, 'https://alpha-site.test/m/a.jpg'); assert.equal(t.mediaType, 'video');
  assert.equal(w.session.has('hq_badge_hold'), false);
});

test('grab.js: another menu item is ignored, and a stale target expires', async () => {
  const w = swWorld();
  assert.equal(await w.grab.onMenuClick({ menuItemId: 'something-else', srcUrl: 'x' }, { id: 1 }), false);
  assert.equal(w.session.has('hq_grab_target'), false);
  await w.grab.onMenuClick({ menuItemId: 'hq-grab', srcUrl: 'https://alpha-site.test/m/a.jpg' }, { id: 1 });
  w.now.t += 11 * 60_000;
  assert.equal(await w.grab.takeTarget(), null);
  assert.equal(w.session.has('hq_grab_target'), false);
});

test('grab.js: install() wires the click listener once at the top level', async () => {
  const w = swWorld();
  w.grab.install();
  assert.equal(w.listeners.length, 1);
  await w.listeners[0]({ menuItemId: 'hq-grab', srcUrl: 'https://alpha-site.test/m/a.jpg' }, { id: 2 });
  assert.equal(w.session.get('hq_grab_target').tabId, 2);
});

// ---- the pure and page-facing files stay request-free ----------------------------------------------------------------
test('the scanner, the rules and the popup half make no request and use no downloads API, remote image or innerHTML', () => {
  for (const f of ['grab-rules.js', 'grab-scan.js', 'grab-popup.js']) {
    const src = read(f).replace(/^\s*\/\/.*$/gm, '');   // header comment lines only; strings and regexes stay
    assert.doesNotMatch(src, /chrome\.downloads|['"]downloads['"]/, f + ': no downloads API or permission');
    assert.doesNotMatch(src, /\bfetch\s*\(/, f + ': no fetch');
    assert.doesNotMatch(src, /XMLHttpRequest|new Image\b|createElement\(\s*['"]img['"]/, f + ': no request-making element');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f + ': text only');
  }
});

test('the manifest asks for downloads (Chrome: "Manage your downloads") and nothing else new for it', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.version, '0.7.0', 'not bumped again: 0.7.0 has not reached the owner yet');
  assert.ok(m.permissions.includes('downloads'));
  assert.ok(!(m.optional_permissions || []).includes('downloads'));
  assert.deepEqual(m.permissions.slice().sort(), ['activeTab', 'alarms', 'contextMenus', 'downloads', 'idle', 'scripting', 'storage', 'tabs']);
});
