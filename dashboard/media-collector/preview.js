'use strict';
// Preview — fetch a bounded image through the safe net layer, verify the
// bytes are an image, and hand the renderer a data: URL. The renderer never
// loads remote URLs itself (CSP img-src 'self' data:), so previews cannot
// become an unguarded network path.
const { request, readBounded } = require('./net');
const { decideType } = require('./sniff');
const { UmcError, fromStatus } = require('./errors');

const MAX_PREVIEW = 3 * 1024 * 1024;

async function previewImage(url, ctx = {}) {
  const r = await request(url, { allowPrivate: ctx.allowPrivate, signal: ctx.signal, timeoutMs: ctx.timeoutMs || 12000, headers: { accept: 'image/*' } });
  if (r.status >= 400) { r.res.resume(); throw fromStatus(r.status, r.headers); }
  const cl = Number(r.headers['content-length'] || 0);
  if (cl > MAX_PREVIEW) { r.res.destroy(); throw new UmcError('FILE_TOO_LARGE', 'preview limit'); }
  const { buf } = await readBounded(r.res, MAX_PREVIEW);
  const t = decideType(buf, r.headers['content-type'], '');
  if (t.kind !== 'image' || t.trusted !== 'bytes' || t.mime === 'image/svg+xml') throw new UmcError('UNSUPPORTED_MEDIA', 'not a raster image');
  return { dataUrl: `data:${t.mime};base64,${buf.toString('base64')}`, mime: t.mime, bytes: buf.length };
}

module.exports = { previewImage, MAX_PREVIEW };
