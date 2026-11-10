// A placeholder client site for the delivery check (dashboard/delivery-check.native.check.js and the tests).
// A node:http server on 127.0.0.1:<port> serving three pages — / (English), /fr, /ar — with DELIBERATE faults, so a check
// that finds none of them is itself broken. Invented names only (acme, example.test); example.test never resolves.
//
//   import { startCheckSite } from './make-check-site.mjs';
//   const site = await startCheckSite();            // { origin, port, hits, refs, close() }
//
// refs.faults          what the check must report, as { id, route } (ids are delivery-check-core finding ids)
// refs.visibleOutside  non-loopback references the browser asks the network stack about (webRequest sees them): the check's
//                      "N outside requests blocked" count must equal this list's length
// refs.invisibleOutside references the webRequest hook cannot see (a WebRTC STUN attempt, DNS prefetch, a preconnect hint):
//                      the native check counts what reaches its canary listener instead of assuming zero
import http from 'node:http';

const FONT = 'https://fonts.example.test/css?family=Acme+Sans';
const CDN_IMG = 'https://cdn.example.test/acme-hero.png';

const head = (lang, { viewport = true, extra = '' } = {}) => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
${viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
<title>Acme Studio${lang === 'en' ? '' : ' (' + lang + ')'}</title>
<link rel="stylesheet" href="${FONT}">
<link rel="alternate" hreflang="en" href="/">
<link rel="alternate" hreflang="fr" href="/fr">
<link rel="alternate" hreflang="ar" href="/ar">
${extra}
<style>
  body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }
  nav a { display: inline-block; padding: 12px 14px; }
  .btn { display: inline-block; width: 160px; height: 48px; }
  .fine { font-size: 10px; }
  .tiny { width: 20px; height: 20px; padding: 0; }
  .wide { min-width: 1200px; border-collapse: collapse; }
  .wide td { border: 1px solid #999; padding: 4px; }
</style>
</head>
<body>
<nav><a href="/">English</a> <a href="/fr">Fran&ccedil;ais</a> <a href="/ar">العربية</a></nav>
`;

// the English page: overflow (a viewport meta is present: without one a phone lays the page out at its own width and nothing overflows), 10 px text, a 20 px button, the outside references
const EN = head('en', { extra: '<link rel="dns-prefetch" href="//cdn.example.test">\n<link rel="preconnect" href="https://img.example.test">' }) + `
<h1>Welcome to Acme Studio</h1>
<p>Our work is built for small teams.</p>
<p>Contact us today for a quote.</p>
<p class="fine">Prices exclude tax unless stated.</p>
<button class="tiny" type="button" aria-label="close">x</button>
<table class="wide"><tr><td>Service</td><td>Plan one</td><td>Plan two</td><td>Plan three</td><td>Plan four</td><td>Plan five</td></tr></table>
<img src="${CDN_IMG}" alt="" width="10" height="10">
<script>
  try {
    var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.example.test:3478' }] });
    pc.createDataChannel('probe');
    pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {});
  } catch (e) { /* no WebRTC: nothing to count */ }
</script>
</body></html>
`;

// the French page: a straight copy of the English words (never translated), a correct lang, and NO viewport meta
const FR = head('fr', { viewport: false }) + `
<h1>Welcome to Acme Studio</h1>
<p>Our work is built for small teams.</p>
<p>Contact us today for a quote.</p>
<a class="btn" href="/fr/contact">Contact</a>
</body></html>
`;

// the Arabic page: no dir on <html>, a number run inside right-to-left text with no isolate
const AR = head('ar') + `
<h1>مرحبا بكم في أكمي ستوديو</h1>
<p dir="rtl">اتصل بنا على 555 0100 اليوم للحصول على عرض سعر</p>
<a class="btn" href="/ar/contact">تواصل</a>
</body></html>
`;

export const PAGES = Object.freeze({ '/': EN, '/fr': FR, '/ar': AR });

export const REFS = Object.freeze({
  faults: Object.freeze([
    { id: 'overflow', route: '/' }, { id: 'viewport', route: '/fr' }, { id: 'small-text', route: '/' }, { id: 'tap-floor', route: '/' },
    { id: 'identical', route: '/fr' }, { id: 'dir', route: '/ar' }, { id: 'bidi', route: '/ar' },
  ]),
  // one font stylesheet per page load (3 pages) plus the English page's image
  visibleOutside: Object.freeze([
    { page: '/', url: FONT }, { page: '/fr', url: FONT }, { page: '/ar', url: FONT }, { page: '/', url: CDN_IMG },
  ]),
  invisibleOutside: Object.freeze([
    { page: '/', kind: 'webrtc-stun', url: 'stun:stun.example.test:3478' },
    { page: '/', kind: 'dns-prefetch', url: '//cdn.example.test' },
    { page: '/', kind: 'preconnect', url: 'https://img.example.test' },
  ]),
});

export function startCheckSite({ host = '127.0.0.1', port = 0 } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const p = String(req.url || '/').split('?')[0];
    hits.push(p);
    const html = Object.prototype.hasOwnProperty.call(PAGES, p) ? PAGES[p] : null;
    if (!html) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        origin: 'http://' + host + ':' + addr.port, port: addr.port, hits, refs: REFS, server,
        close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }),
      });
    });
  });
}
