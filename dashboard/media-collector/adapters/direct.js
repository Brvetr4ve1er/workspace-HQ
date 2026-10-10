'use strict';
// Direct media resolver — one ranged GET, type decided from the bytes.
// Returns a single candidate, or hands the URL to the page resolver when the
// "file" turns out to be an HTML page.
const { sample } = require('../net');
const { decideType, imageDims } = require('../sniff');
const { hintFromUrl } = require('../filenames');
const { UmcError, isUmc } = require('../errors');

async function probe(url, ctx) {
  const r = await sample(url, { allowPrivate: ctx.allowPrivate, signal: ctx.signal, timeoutMs: ctx.timeoutMs, sampleBytes: 16384 });
  const ct = r.headers['content-type'];
  const ext = (hintFromUrl(r.finalUrl).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
  const type = decideType(r.bytes, ct, ext.toLowerCase());
  const dims = type.kind === 'image' ? imageDims(r.bytes) : null;
  return { finalUrl: r.finalUrl, hops: r.hops, size: r.size, acceptRanges: r.acceptRanges, type, dims, etag: r.headers.etag || null, lastModified: r.headers['last-modified'] || null, declaredType: ct || null };
}

async function resolve(detected, ctx) {
  const p = await probe(detected.url, ctx);
  if (p.type.kind === 'html') return { kind: 'html', probe: p };
  if (p.type.kind === 'manifest') throw new UmcError('UNSUPPORTED_MEDIA', 'stream manifest (m3u8/mpd) — not a media file');
  if (p.type.kind === 'other') throw new UmcError('UNSUPPORTED_MEDIA', p.type.mime);
  const name = hintFromUrl(p.finalUrl);
  const candidate = {
    sourceUrl: p.finalUrl, pageUrl: null, host: new URL(p.finalUrl).hostname,
    kind: p.type.kind, mime: p.type.mime, mimeTrusted: p.type.trusted, filenameHint: name, extHint: p.type.ext,
    width: p.dims ? p.dims.width : null, height: p.dims ? p.dims.height : null, duration: null,
    bytes: p.size, quality: 'direct', accessLevel: 'public', attribution: { title: name.replace(/\.[a-z0-9]{2,5}$/i, ''), pageTitle: '' },
    via: ['direct'], probed: true, acceptRanges: p.acceptRanges, validators: { etag: p.etag, lastModified: p.lastModified },
  };
  return { kind: 'media', candidate, warnings: p.hops.length ? [{ code: 'REDIRECTED', message: `Followed ${p.hops.length} redirect(s).` }] : [] };
}

module.exports = { resolve, probe, isUmc };
