// node --test dashboard/delivery-check-core.test.mjs
// The pure engine of the client delivery check: the address gate, the port guess (pinned to the card's own devPort), the
// hostile-snapshot sanitizer, every check firing and staying silent on fixture snapshots, and the report wording.
// Placeholder names only (acme, example.test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, loopbackOrigin, loopbackTwin, candidateUrls, devPort, blockDecision, topHosts, blockedLine, sanitizeSnapshot, discoverLocales, localeOfPath,
  checkRoute, compareLocales, buildReport, summaryLine, validateReport,
} from './delivery-check-core.mjs';
import { devPort as adapterDevPort } from '../dashboard-v5/src/live/adapter.mjs';

// a clean snapshot a probe would return for a healthy page; tests break one thing at a time
const RAW = (o = {}) => ({
  title: 'Acme Studio', viewport: { innerWidth: 390, scrollWidth: 390 }, meta: { hasViewport: true, content: 'width=device-width, initial-scale=1' },
  html: { lang: 'en', dir: '' }, overflow: [], smallText: { count: 0, total: 12 }, taps: { total: 6, under44: 0, under24: 0, samples: [] },
  bidi: { rtlRuns: 0, unisolated: 0, samples: [] }, strings: ['Welcome to Acme', 'Our work'],
  links: { alternates: [], anchors: [], options: [] }, ...o,
});
const clean = (o) => sanitizeSnapshot(RAW(o));
const ids = (fs) => fs.map((f) => f.id);

test('loopbackOrigin accepts the three loopback hosts and rewrites localhost', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(loopbackOrigin('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173');
  assert.equal(loopbackOrigin('http://localhost:3000'), 'http://127.0.0.1:3000');
  assert.equal(loopbackOrigin('HTTP://LocalHost:3000/'), 'http://127.0.0.1:3000');
  assert.equal(loopbackOrigin('http://[::1]:8080'), 'http://[::1]:8080');
  assert.equal(loopbackOrigin('  http://127.0.0.1:4321  '), 'http://127.0.0.1:4321');
  assert.equal(loopbackOrigin('http://127.0.0.1'), 'http://127.0.0.1');
});

test('loopbackOrigin refuses everything that is not a dev server on this PC', () => {
  for (const bad of [
    'https://127.0.0.1:5173', 'http://192.168.1.20:3000', 'http://10.0.0.2', 'http://example.test', 'http://acme-client.example.test:3000',
    'http://user:pass@127.0.0.1:3000', 'http://user@localhost:3000', 'file:///C:/site/index.html', 'javascript:alert(1)', 'data:text/html,hi',
    'http://127.0.0.1.evil.test:3000', 'http://localhost.evil.test', 'http://evil.test/@127.0.0.1', 'http://127.0.0.1:3000/admin', 'http://127.0.0.1:3000/?x=1',
    'http://127.0.0.1:3000/#top', 'http://127.0.0.1\\@evil.test', 'http://0.0.0.0:3000', 'ftp://127.0.0.1', 'ws://127.0.0.1:3000', '', '   ', 'not a url', 'http://',
    'http://127.0.0.1:99999', 'x'.repeat(400),
  ]) assert.equal(loopbackOrigin(bad), null, String(bad).slice(0, 60));
  for (const bad of [null, undefined, 5, {}, [], ['http://127.0.0.1']]) assert.equal(loopbackOrigin(bad), null);
});

test('loopbackTwin gives the same port on the other loopback family, and nothing for a non-loopback address', () => {
  assert.equal(loopbackTwin('http://127.0.0.1:5173'), 'http://[::1]:5173');
  assert.equal(loopbackTwin('http://[::1]:5173'), 'http://127.0.0.1:5173');
  assert.equal(loopbackTwin('http://localhost:3000'), 'http://[::1]:3000');
  assert.equal(loopbackTwin('http://127.0.0.1'), 'http://[::1]');
  for (const bad of ['http://example.test:5173', 'https://127.0.0.1:5173', 'http://127.0.0.1:5173/x', null, 5]) assert.equal(loopbackTwin(bad), null);
});

test('devPort here is the card\'s own devPort, byte for byte, and candidateUrls leads with it', () => {
  const cmds = ['vite --port 5173', 'python -m http.server 5500', 'npm run dev', 'next dev -p 3001', 'PORT=4000 node server.js', 'node a.js 3000 4000', '', 'ng serve --port 4200', 'astro dev', 'webpack serve --port 8085'];
  for (const c of cmds) {
    assert.equal(devPort(c), adapterDevPort(c), c);
    const first = candidateUrls({ devCmd: c })[0];
    const p = adapterDevPort(c);
    if (p != null) assert.equal(first, 'http://127.0.0.1:' + p, 'the first candidate is the card\'s port for: ' + c);
  }
});

test('candidateUrls: explicit ports, then framework defaults, de-duplicated, at most 6', () => {
  assert.deepEqual(candidateUrls({ devCmd: 'vite --port 5199' }), ['http://127.0.0.1:5199', 'http://127.0.0.1:5173']);
  assert.deepEqual(candidateUrls({ devCmd: 'vite' }), ['http://127.0.0.1:5173']);
  assert.deepEqual(candidateUrls({ devCmd: 'next dev' }), ['http://127.0.0.1:3000']);
  assert.deepEqual(candidateUrls({ devCmd: 'astro dev' }), ['http://127.0.0.1:4321']);
  assert.deepEqual(candidateUrls({ devCmd: 'ng serve' }), ['http://127.0.0.1:4200']);
  assert.deepEqual(candidateUrls({ devCmd: 'webpack serve' }), ['http://127.0.0.1:8080']);
  assert.deepEqual(candidateUrls({ devCmd: 'gatsby develop' }), ['http://127.0.0.1:8000']);
  assert.deepEqual(candidateUrls({ devCmd: 'next dev -p 3001' }), ['http://127.0.0.1:3001', 'http://127.0.0.1:3000']);
  assert.deepEqual(candidateUrls({ devCmd: 'PORT=4000 node server.js' }), ['http://127.0.0.1:4000']);
  assert.deepEqual(candidateUrls({ devCmd: 'node server.js --host 0.0.0.0:7000' }), ['http://127.0.0.1:7000']);
  // no command, or one that names neither a port nor a framework: the usual local ports in their usual order
  const usual = ['5173', '3000', '4321', '8080', '4200', '8000'].map((p) => 'http://127.0.0.1:' + p);
  assert.deepEqual(candidateUrls({ devCmd: '' }), usual);
  assert.deepEqual(candidateUrls({}), usual);
  assert.deepEqual(candidateUrls({ devCmd: 'npm run dev' }), usual);
  assert.deepEqual(candidateUrls({ devCmd: null }), usual);
  for (const c of ['vite --port 5173 -p 5173 PORT=5173 :5173', 'a 1111 --port 2222 -p 3333 PORT=4444 :5555 :6666 vite next astro']) {
    const got = candidateUrls({ devCmd: c });
    assert.ok(got.length <= LIMITS.MAX_CANDIDATES);
    assert.equal(new Set(got).size, got.length, 'no duplicates');
  }
  // an out-of-range number is never a candidate
  assert.deepEqual(candidateUrls({ devCmd: 'serve 99999' }), ['http://127.0.0.1:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:4321', 'http://127.0.0.1:8080', 'http://127.0.0.1:4200', 'http://127.0.0.1:8000']);
});

test('blockDecision: only http / ws to a loopback host passes; the rest is cancelled and named by host only', () => {
  for (const ok of ['http://127.0.0.1:5173/app.js', 'http://localhost:3000/x', 'http://[::1]:8080/', 'ws://127.0.0.1:5173/hmr', 'http://127.0.0.1:4000/api?q=1']) assert.equal(blockDecision(ok).allow, true, ok);
  for (const ok of ['data:image/png;base64,AAAA', 'blob:http://127.0.0.1:5173/uuid', 'about:blank']) { const d = blockDecision(ok); assert.equal(d.allow, true); assert.equal(d.host, ''); }
  const font = blockDecision('https://fonts.example.test/css?family=Acme+Sans&secret=1');
  assert.deepEqual(font, { allow: false, host: 'fonts.example.test' });
  assert.equal(blockDecision('http://cdn.example.test/x.png').allow, false);
  assert.equal(blockDecision('wss://127.0.0.1:5173/').allow, false, 'tls to loopback is not a dev server here');
  assert.equal(blockDecision('https://127.0.0.1:5173/').allow, false);
  assert.equal(blockDecision('http://127.0.0.1.evil.test/').allow, false);
  assert.equal(blockDecision('http://192.168.0.9/').allow, false);
  assert.equal(blockDecision('ftp://127.0.0.1/').allow, false);
  assert.equal(blockDecision('not a url').allow, false);
  assert.equal(blockDecision(undefined).allow, false);
});

test('topHosts is capped and busiest first; blockedLine is blocked-and-counted, never absolute', () => {
  const m = new Map(); for (let i = 0; i < 12; i++) m.set('h' + i + '.example.test', i + 1);
  const top = topHosts(m);
  assert.equal(top.length, LIMITS.MAX_HOSTS);
  assert.equal(top[0].host, 'h11.example.test');
  assert.equal(blockedLine({ count: 2, hosts: [{ host: 'fonts.example.test', count: 1 }, { host: 'cdn.example.test', count: 1 }] }), '2 outside requests blocked (fonts.example.test, cdn.example.test)');
  assert.equal(blockedLine({ count: 1, hosts: [{ host: 'fonts.example.test', count: 1 }] }), '1 outside request blocked (fonts.example.test)');
  const zero = blockedLine({ count: 0, hosts: [] });
  assert.match(zero, /^0 outside requests seen by the app/);
  for (const t of [zero, blockedLine({ count: 3, hosts: [] })]) assert.doesNotMatch(t, /nothing left|no data left|never left/i);
});

test('sanitizeSnapshot clamps hostile snapshots and never copies an unknown key', () => {
  const big = 'x'.repeat(10 * 1024 * 1024);
  const hostile = JSON.parse(('{"__proto__":{"polluted":true},"title":' + JSON.stringify(big) + ',"viewport":{"innerWidth":"390","scrollWidth":1e308},"meta":{"hasViewport":"yes","content":' + JSON.stringify(big) + '},"html":{"lang":' + JSON.stringify(big) + ',"dir":null},"overflow":[{"tag":"<script>alert(1)</script>","cls":"a b\\u0000c;drop"}],"smallText":{"count":-5,"total":null},"taps":{"total":NaN_PLACEHOLDER},"strings":[1,null,' + JSON.stringify(big) + ',"ok"],"links":{"alternates":[{"hreflang":"fr","path":"//evil.test/x"},{"hreflang":"ar","path":"/ar"}],"options":"nope"},"extra":{"__proto__":1}}').replace('NaN_PLACEHOLDER', '0'));
  hostile.viewport.innerWidth = NaN;
  const s = sanitizeSnapshot(hostile);
  assert.equal(s.title.length, LIMITS.MAX_STR);
  assert.equal(s.innerWidth, 0);
  assert.equal(s.scrollWidth, 100000);
  assert.equal(s.hasViewportMeta, false, 'only a real boolean true counts');
  assert.equal(s.viewportContent.length, LIMITS.MAX_STR);
  assert.equal(s.lang.length, 20);
  assert.equal(s.dir, '');
  assert.equal(s.overflowers[0].tag, 'scriptalert1sc');
  assert.doesNotMatch(s.overflowers[0].cls, /[;\u0000]/);
  assert.equal(s.smallTextCount, 0);
  assert.deepEqual(s.strings.map((x) => x.length), [LIMITS.MAX_STR, 2]);
  assert.deepEqual(s.links.alternates.map((a) => a.path), ['', '/ar'], 'a protocol-relative path is dropped');
  assert.deepEqual(s.links.options, []);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.keys(s).includes('extra'), false);
  assert.equal(JSON.stringify(s).length < 5000, true, 'no hostile payload survives in size');
  for (const bad of [null, undefined, 3, 'x', [], [1]]) assert.equal(sanitizeSnapshot(bad), null);
  // arrays are capped
  const many = sanitizeSnapshot({ strings: Array.from({ length: 1000 }, (_, i) => 's' + i), overflow: Array.from({ length: 50 }, () => ({ tag: 'div', cls: 'c' })) });
  assert.equal(many.strings.length, LIMITS.MAX_ARR);
  assert.equal(many.overflowers.length, LIMITS.MAX_OFFENDERS);
});

test('a healthy page raises nothing', () => {
  assert.deepEqual(checkRoute(clean(), { route: '/' }), []);
  assert.deepEqual(checkRoute(clean({ html: { lang: 'fr', dir: '' } }), { locale: 'fr', route: '/fr' }), []);
  assert.deepEqual(checkRoute(clean({ html: { lang: 'ar', dir: 'rtl' } }), { locale: 'ar', route: '/ar' }), []);
});

test('overflow at 390 names at most five offenders by tag and class, never text', () => {
  const f = checkRoute(clean({ viewport: { innerWidth: 390, scrollWidth: 900 }, overflow: Array.from({ length: 8 }, (_, i) => ({ tag: 'table', cls: 'wide plan-' + i + ' extra' })) }), { route: '/' });
  const o = f.find((x) => x.id === 'overflow');
  assert.equal(o.level, 'problem');
  assert.match(o.text, /Sideways scroll at 390 px: the page is 900 px wide/);
  assert.equal(o.offenders.length, LIMITS.MAX_OFFENDERS);
  assert.equal(o.offenders[0], 'table.wide.plan-0');
  // one pixel of rounding is not an overflow
  // a mobile browser widens its layout viewport to overflowing content: innerWidth follows scrollWidth, the phone does not
  const widened = checkRoute(clean({ viewport: { innerWidth: 1200, scrollWidth: 1200 }, overflow: [{ tag: 'table', cls: 'wide' }] }));
  assert.ok(ids(widened).includes('overflow'), 'compared with 390, not with the widened innerWidth');
  assert.match(widened.find((f) => f.id === 'overflow').text, /the page is 1200 px wide/);
  const noMeta = ids(checkRoute(clean({ viewport: { innerWidth: 980, scrollWidth: 980 }, meta: { hasViewport: false, content: '' } })));
  assert.ok(noMeta.includes('viewport') && !noMeta.includes('overflow'), 'no viewport meta is the viewport finding, not also an overflow');
  assert.equal(ids(checkRoute(clean({ viewport: { innerWidth: 390, scrollWidth: 391 } }))).includes('overflow'), false);
  assert.equal(ids(checkRoute(clean({ viewport: { innerWidth: 390, scrollWidth: 392 } }))).includes('overflow'), true);
});

test('viewport meta: missing, wrong, right', () => {
  assert.equal(checkRoute(clean({ meta: { hasViewport: false, content: '' } })).find((f) => f.id === 'viewport').level, 'problem');
  assert.match(checkRoute(clean({ meta: { hasViewport: true, content: 'width=1024' } })).find((f) => f.id === 'viewport').text, /width=device-width/);
  assert.equal(ids(checkRoute(clean({ meta: { hasViewport: true, content: 'width = device-width' } }))).includes('viewport'), false);
});

test('small text and tap targets: the 44 px comfort guide and the 24 px WCAG floor are separate findings', () => {
  const small = checkRoute(clean({ smallText: { count: 3, total: 20 } })).find((f) => f.id === 'small-text');
  assert.equal(small.level, 'heads-up'); assert.match(small.text, /3 pieces of visible text under 12 px/);
  const guide = checkRoute(clean({ taps: { total: 10, under44: 4, under24: 0, samples: [{ tag: 'a', cls: 'nav', w: 30, h: 30 }] } }));
  assert.deepEqual(ids(guide), ['tap-comfort']);
  assert.match(guide[0].text, /4 of 10 tap targets are under 44x44 px \(a comfort guide, not a rule\)/);
  const floor = checkRoute(clean({ taps: { total: 10, under44: 4, under24: 1, samples: [{ tag: 'button', cls: 'tiny', w: 20, h: 20 }] } }));
  assert.deepEqual(ids(floor), ['tap-floor', 'tap-comfort']);
  assert.equal(floor[0].level, 'problem'); assert.match(floor[0].text, /24 px WCAG floor/); assert.deepEqual(floor[0].samples, ['button.tiny 20x20']);
});

test('lang and dir per locale route', () => {
  const wrongLang = checkRoute(clean({ html: { lang: 'en', dir: '' } }), { locale: 'fr', route: '/fr' });
  assert.match(wrongLang.find((f) => f.id === 'lang').text, /lang="en"> but this route is fr/);
  assert.deepEqual(ids(checkRoute(clean({ html: { lang: '', dir: '' } }), { route: '/' })), ['lang']);
  assert.deepEqual(ids(checkRoute(clean({ html: { lang: 'ar-MA', dir: 'rtl' } }), { locale: 'ar', route: '/ar' })), []);
  const noDir = checkRoute(clean({ html: { lang: 'ar', dir: '' } }), { locale: 'ar', route: '/ar' });
  assert.deepEqual(ids(noDir), ['dir']); assert.match(noDir[0].text, /dir missing/);
  assert.match(checkRoute(clean({ html: { lang: 'ar', dir: 'ltr' } }), { locale: 'ar' })[0].text, /dir="ltr"/);
  assert.deepEqual(ids(checkRoute(clean({ html: { lang: 'fr', dir: 'rtl' } }), { locale: 'fr' })), ['dir']);
  // the entry page has no expected locale: its own lang decides whether it is right-to-left
  assert.deepEqual(ids(checkRoute(clean({ html: { lang: 'ar', dir: '' } }), { route: '/' })), ['dir']);
});

test('the digits-in-right-to-left-text finding is a heuristic, says so, and only fires on rtl routes', () => {
  const b = clean({ html: { lang: 'ar', dir: 'rtl' }, bidi: { rtlRuns: 3, unisolated: 2, samples: ['اتصل بنا على 555 0100 اليوم للحصول على عرض سعر طويل جدا'] } });
  const f = checkRoute(b, { locale: 'ar', route: '/ar' }).find((x) => x.id === 'bidi');
  assert.equal(f.level, 'heuristic'); assert.match(f.text, /^Heuristic: 2 number or Latin runs inside right-to-left text/); assert.match(f.text, /may display in the wrong order/);
  assert.ok(f.samples[0].length <= LIMITS.SAMPLE_LEN);
  assert.equal(ids(checkRoute(b, { locale: 'fr', route: '/fr' })).includes('bidi'), false, 'an ltr route never reports it');
  assert.equal(ids(checkRoute(clean({ html: { lang: 'ar', dir: 'rtl' }, bidi: { rtlRuns: 3, unisolated: 0, samples: [] } }), { locale: 'ar' })).includes('bidi'), false);
});

test('compareLocales: identical strings across two locales, a heuristic with at most five 40-char samples', () => {
  const en = { locale: 'en', path: '/', strings: ['Welcome to Acme Studio', 'Our work is built for small teams.', 'Contact us today for a quote.', 'OK', '2024'] };
  const fr = { locale: 'fr', path: '/fr', strings: ['Welcome to Acme Studio', 'Our work is built for small teams.', 'Contact us today for a quote.', 'OK', '2024', 'Bonjour'] };
  const f = compareLocales([en, fr]);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].id, f[0].level, f[0].route, f[0].count], ['identical', 'heuristic', '/fr', 3]);
  assert.match(f[0].text, /^Heuristic: 3 strings on \/fr are word for word the same as on \/ \(possibly untranslated\)/);
  assert.ok(f[0].samples.every((s) => s.length <= LIMITS.SAMPLE_LEN));
  // short, numeric and single repeats are not enough
  assert.deepEqual(compareLocales([en, { locale: 'fr', path: '/fr', strings: ['OK', '2024', 'Welcome to Acme Studio'] }]), []);
  // the same language twice is not a pair
  assert.deepEqual(compareLocales([en, { ...fr, locale: 'en-GB' }]), []);
  // many identical strings: still five samples
  const lots = Array.from({ length: 30 }, (_, i) => 'Shared sentence number ' + i);
  assert.equal(compareLocales([{ locale: 'en', path: '/', strings: lots }, { locale: 'ar', path: '/ar', strings: lots }])[0].samples.length, LIMITS.MAX_SAMPLES);
  assert.deepEqual(compareLocales(null), []);
});

test('discoverLocales: hreflang, locale links, ?lang= links, option values; same shortest route per locale; none is honest', () => {
  const snap = clean({ links: {
    alternates: [{ hreflang: 'fr', path: '/fr/' }, { hreflang: 'x-default', path: '/' }, { hreflang: 'ar-MA', path: '/ar' }],
    anchors: [{ hreflang: '', path: '/fr/about' }, { hreflang: '', path: '/?lang=en' }], options: [],
  } });
  const d = discoverLocales(snap);
  assert.equal(d.switch, 'found');
  assert.deepEqual(Object.fromEntries(d.routes.map((r) => [r.locale, r.path])), { fr: '/fr/', ar: '/ar', en: '/?lang=en' });
  assert.deepEqual(discoverLocales(clean({ links: { alternates: [], anchors: [{ hreflang: '', path: '/ar/about' }, { hreflang: '', path: '/ar' }], options: [] } })).routes, [{ locale: 'ar', path: '/ar' }]);
  assert.deepEqual(discoverLocales(clean({ links: { alternates: [], anchors: [], options: [{ value: '/fr', text: 'FR' }, { value: 'ar', text: 'AR' }] } })).routes, [{ locale: 'fr', path: '/fr' }]);
  const none = discoverLocales(clean());
  assert.deepEqual(none, { routes: [], switch: 'none' });
  assert.equal(discoverLocales(clean({ links: { alternates: [], anchors: [], options: [{ value: 'ar', text: 'AR' }] } })).switch, 'unreadable');
  // never more than six
  const many = clean({ links: { alternates: 'abcdefghij'.split('').map((c) => ({ hreflang: c + c, path: '/' + c + c })), anchors: [], options: [] } });
  assert.equal(discoverLocales(many).routes.length, LIMITS.MAX_ROUTES);
  assert.equal(localeOfPath('/ar/x'), 'ar'); assert.equal(localeOfPath('/arabic'), null); assert.equal(localeOfPath('/?lang=fr'), 'fr'); assert.equal(localeOfPath('/de'), null);
});

test('buildReport: shape, counts, notes, wording, names only', () => {
  const entry = { path: '/', locale: null, isEntry: true, snap: clean({ meta: { hasViewport: false, content: '' }, html: { lang: 'en', dir: '' }, strings: ['Welcome to Acme', 'Our work is here', 'Hello world again', 'Second line', 'Third line', 'Sixth line not sampled'] }) };
  const fr = { path: '/fr', locale: 'fr', snap: clean({ html: { lang: 'fr', dir: '' }, strings: ['Welcome to Acme', 'Our work is here', 'Hello world again', 'Second line', 'Third line', 'Sixth line not sampled'] }), shot: 'aaaaaaaaaaaaaaaa-1.png' };
  const ar = { path: '/ar', locale: 'ar', snap: clean({ html: { lang: 'ar', dir: '' }, bidi: { rtlRuns: 1, unisolated: 1, samples: ['x 555'] } }) };
  const r = buildReport({ origin: '127.0.0.1:5173', at: new Date('2026-11-10T10:00:00Z'), routes: [entry, fr, ar], switch: 'found',
    blocked: { count: 4, hosts: [{ host: 'fonts.example.test', count: 3 }, { host: 'cdn.example.test', count: 1 }] }, requestsSeen: 21 });
  assert.equal(r.v, 1); assert.equal(r.at, '2026-11-10T10:00:00.000Z'); assert.equal(r.origin, '127.0.0.1:5173');
  assert.deepEqual(r.phone, { width: 390, height: 844, scale: 3 });
  assert.deepEqual(r.routes.map((x) => x.path), ['/', '/fr', '/ar']);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ['bidi', 'dir', 'identical', 'viewport']);
  assert.deepEqual(r.counts, { problem: 2, headsUp: 0, heuristic: 2 });
  assert.equal(r.blockedLine, '4 outside requests blocked (fonts.example.test, cdn.example.test)');
  assert.equal(r.summary, '2 to fix · 2 heuristics (may be wrong) · 3 pages at 390 px');
  assert.deepEqual(r.notes, []);
  assert.ok(validateReport(JSON.parse(JSON.stringify(r))));
  const txt = JSON.stringify(r);
  assert.doesNotMatch(txt, /"strings"|"snap"|Sixth line not sampled/, 'only the capped samples carry page text; the raw strings never enter a report');
});

test('buildReport honest notes: no language switch, an unreadable select, truncation, a failed route', () => {
  const entry = { path: '/', locale: null, isEntry: true, snap: clean() };
  const none = buildReport({ origin: 'a', at: 0, routes: [entry], switch: 'none' });
  assert.ok(none.notes.includes('No language switch found, so nothing was checked per language'));
  assert.equal(none.summary, 'Nothing found · 1 page at 390 px');
  assert.match(buildReport({ origin: 'a', at: 0, routes: [entry], switch: 'unreadable' }).notes[0], /language select was found/);
  const t = buildReport({ origin: 'a', at: 0, routes: [entry], switch: 'found', truncated: { routes: true, requests: true, time: true } });
  assert.equal(t.notes.length, 3); assert.match(t.notes.join(' '), /only the first 6/); assert.match(t.notes.join(' '), /45 s limit/);
  const failed = buildReport({ origin: 'a', at: 0, routes: [entry, { path: '/fr', locale: 'fr', loadError: 'ERR_CONNECTION_REFUSED' }], switch: 'found' });
  assert.deepEqual(failed.findings.map((f) => f.id), ['route-failed']);
  assert.equal(failed.routes[1].loaded, false);
  assert.equal(summaryLine({ problem: 1, headsUp: 1, heuristic: 0 }, 1), '1 to fix · 1 to look at · 1 page at 390 px');
});

test('validateReport accepts only what buildReport writes', () => {
  const ok = buildReport({ origin: 'a', at: 0, routes: [{ path: '/', isEntry: true, snap: clean() }], switch: 'none' });
  assert.ok(validateReport(ok));
  for (const bad of [null, [], {}, { ...ok, v: 2 }, { ...ok, findings: 'x' }, { ...ok, at: 5 }, { ...ok, findings: new Array(501).fill({}) }]) assert.equal(validateReport(bad), null);
});
