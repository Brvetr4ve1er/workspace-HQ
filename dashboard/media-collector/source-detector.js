'use strict';
// SourceDetector — classify a URL by host + path shape. Pure: no network.
// The returned `source` id keys into the capability registry (sources.js);
// `looksDirect` is only a HINT from the path extension — the final verdict
// comes from response bytes in the direct resolver.
const { parseUrl } = require('./url-safety');
const { MEDIA_EXTENSIONS } = require('./sniff');

const HOST_RULES = [
  { source: 'tumblr',    test: (h) => h === 'tumblr.com' || h.endsWith('.tumblr.com') },
  { source: 'reddit',    test: (h) => ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'redd.it', 'i.redd.it', 'v.redd.it', 'preview.redd.it'].includes(h) || h.endsWith('.reddit.com') },
  { source: 'instagram', test: (h) => h === 'instagram.com' || h.endsWith('.instagram.com') || h.endsWith('.cdninstagram.com') },
  { source: 'facebook',  test: (h) => h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h === 'fb.watch' || h.endsWith('.fbcdn.net') },
  { source: 'youtube',   test: (h) => h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' },
  { source: 'x',         test: (h) => h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com') || h === 't.co' },
  { source: 'tiktok',    test: (h) => h === 'tiktok.com' || h.endsWith('.tiktok.com') },
];

function extOf(pathname) {
  const last = pathname.split('/').pop() || '';
  const m = last.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

// Returns { url, host, source, looksDirect, ext }.
// Throws UmcError(INVALID_URL | UNSUPPORTED_SCHEME) for bad input.
function detect(input, opts) {
  const url = parseUrl(input, opts);
  const host = url.hostname.toLowerCase();
  const ext = extOf(url.pathname);
  const looksDirect = MEDIA_EXTENSIONS.has(ext);
  let source = 'webpage';
  for (const r of HOST_RULES) if (r.test(host)) { source = r.source; break; }
  // A direct CDN file on a platform host (i.redd.it/x.jpg, 64.media.tumblr.com/x.gif)
  // is still fetched through the direct resolver: it is a plain public file.
  // Platform *pages* go through the platform's adapter boundary.
  if (looksDirect) source = 'direct';
  return { url: url.href, host, source, looksDirect, ext };
}

module.exports = { detect, extOf };
