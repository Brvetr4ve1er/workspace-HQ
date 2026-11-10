// node --test dashboard/delivery-check-probe.test.mjs
// The in-page probe: PROBE_SOURCE compiles on its own, holds no network API, and measure() over a small fake page returns
// the shape the core sanitizes. Placeholder names only (acme).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sanitizeSnapshot, checkRoute } from './delivery-check-core.mjs';

const require = createRequire(import.meta.url);
const { measure, PROBE_SOURCE } = require('./delivery-check-probe.js');

test('PROBE_SOURCE is the function text, compiles, and is callable from a bare string', () => {
  assert.equal(typeof PROBE_SOURCE, 'string');
  assert.match(PROBE_SOURCE, /^function measure\(/);
  const fn = new Function('return (' + PROBE_SOURCE + ')')();     // no outer names: it must stand alone
  assert.equal(typeof fn, 'function');
  assert.equal(fn.length, 1);
});

test('PROBE_SOURCE contains no network API and no dynamic code', () => {
  for (const bad of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'eval(', 'new Function', 'importScripts', 'RTCPeerConnection', 'navigator.', 'localStorage', 'document.cookie', 'postMessage', 'Worker(']) {
    assert.ok(!PROBE_SOURCE.includes(bad), 'the probe must not use ' + bad);
  }
  assert.doesNotMatch(PROBE_SOURCE, /\bwindow\.open\b|\bopen\(/);
  assert.ok(!PROBE_SOURCE.includes('`'), 'no backtick: the source is spliced into a string');
});

// a tiny fake page: every element has tagName, attributes, a box, a computed style and text nodes
const el = (tagName, o = {}) => ({
  tagName: tagName.toUpperCase(), className: o.cls || '', textContent: o.text || '',
  getAttribute: (n) => (o.attrs && n in o.attrs ? o.attrs[n] : null),
  getBoundingClientRect: () => ({ width: o.w == null ? 100 : o.w, height: o.h == null ? 20 : o.h, right: o.right == null ? 100 : o.right }),
  childNodes: o.text ? [{ nodeType: 3, textContent: o.text }] : [],
  _style: Object.assign({ display: 'block', visibility: 'visible', fontSize: '16px', direction: 'ltr', unicodeBidi: 'normal' }, o.style || {}),
});
function page(els, { lang = 'en', dir = '', width = 390, scrollWidth = 390, title = 'Acme Studio' } = {}) {
  const root = { getAttribute: (n) => (n === 'lang' ? lang : n === 'dir' ? dir : null), scrollWidth };
  const doc = { title, documentElement: root, body: { scrollWidth }, querySelectorAll: () => els };
  const win = {
    innerWidth: width, document: doc, location: { origin: 'http://127.0.0.1:5173', href: 'http://127.0.0.1:5173/' }, URL,
    getComputedStyle: (e) => e._style,
  };
  return { window: win, document: doc };
}

test('measure() reads overflow, viewport, small text, taps, bidi, strings and language links', () => {
  const els = [
    el('meta', { attrs: { name: 'viewport', content: 'width=device-width' } }),
    el('link', { attrs: { rel: 'alternate', hreflang: 'fr', href: '/fr' } }),
    el('link', { attrs: { rel: 'alternate', hreflang: 'de', href: 'https://elsewhere.example.test/de' } }),
    el('option', { attrs: { value: '/ar' }, text: 'Arabic' }),
    el('a', { attrs: { href: '/ar', hreflang: 'ar' }, text: 'Arabic', w: 80, h: 48, style: { display: 'inline-block' } }),
    el('table', { cls: 'wide', right: 900, w: 900 }),
    el('p', { text: 'Prices exclude tax', style: { fontSize: '10px' } }),
    el('button', { cls: 'tiny', w: 20, h: 20, attrs: {} }),
    el('p', { text: 'اتصل على 555 0100 اليوم', style: { direction: 'rtl' } }),
    el('p', { text: 'اتصل على 555 0100 اليوم', attrs: { dir: 'auto' }, style: { direction: 'rtl' } }),
    el('p', { text: 'Hidden', style: { display: 'none' } }),
  ];
  const { window, document } = page(els, { scrollWidth: 900 });
  const out = measure({ window, document });
  assert.equal(out.title, 'Acme Studio');
  assert.deepEqual(out.viewport, { innerWidth: 390, scrollWidth: 900 });
  assert.deepEqual(out.meta, { hasViewport: true, content: 'width=device-width' });
  assert.deepEqual(out.links.alternates, [{ hreflang: 'fr', path: '/fr' }], 'a link to another origin is dropped, same origin only');
  assert.deepEqual(out.links.options, [{ value: '/ar', text: 'Arabic' }]);
  assert.deepEqual(out.links.anchors, [{ hreflang: 'ar', path: '/ar' }]);
  assert.equal(out.overflow[0].tag, 'table'); assert.equal(out.overflow[0].cls, 'wide');
  assert.equal(out.smallText.count, 1);
  assert.equal(out.taps.under24, 1); assert.equal(out.taps.under44, 1);
  assert.deepEqual(out.taps.samples[0], { tag: 'button', cls: 'tiny', w: 20, h: 20 });
  assert.equal(out.bidi.rtlRuns, 2); assert.equal(out.bidi.unisolated, 1, 'dir=auto isolates; the bare run does not');
  assert.ok(out.strings.includes('Prices exclude tax')); assert.ok(!out.strings.includes('Hidden'), 'a hidden element is not visible text');
  assert.ok(!out.strings.includes('Arabic'), 'a language switch link is not untranslated text');
  // and the core accepts it and finds what is there
  const snap = sanitizeSnapshot(out);
  const ids = checkRoute(snap, { route: '/' }).map((f) => f.id);
  assert.ok(['overflow', 'small-text', 'tap-floor', 'tap-comfort'].every((i) => ids.includes(i)), ids.join());
});

test('bidi: a dir attribute makes its element an isolate in the browser stylesheet, which must not hide a bare number run inside it', () => {
  const AR = 'اتصل بنا على 555 0100';
  const els = [
    el('p', { text: AR, attrs: { dir: 'rtl' }, style: { direction: 'rtl', unicodeBidi: 'isolate' } }),   // UA isolate from [dir]: still a bare run
    el('p', { text: AR, style: { direction: 'rtl', unicodeBidi: 'isolate' } }),                         // author CSS isolate (no dir attribute): isolated
    el('p', { text: AR, attrs: { dir: 'auto' }, style: { direction: 'rtl', unicodeBidi: 'isolate' } }),   // dir=auto: isolated
    el('bdi', { text: AR, style: { direction: 'rtl', unicodeBidi: 'isolate' } }),
  ];
  const { window, document } = page(els, { lang: 'ar' });
  const out = measure({ window, document });
  assert.equal(out.bidi.rtlRuns, 4); assert.equal(out.bidi.unisolated, 1);
});

test('measure() on an empty page returns a complete shape without throwing', () => {
  const { window, document } = page([], { lang: '' });
  const out = measure({ window, document });
  assert.deepEqual(Object.keys(out).sort(), ['bidi', 'html', 'links', 'meta', 'overflow', 'smallText', 'strings', 'taps', 'title', 'viewport']);
  assert.equal(out.meta.hasViewport, false);
  assert.ok(sanitizeSnapshot(out));
});
