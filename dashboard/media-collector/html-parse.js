'use strict';
// WebPageResolver parsing half — bounded, script-free candidate discovery
// from standard HTML: <img>/<picture>/<video>/<audio>/<source>, srcset,
// <a href> to media files, <link rel=image_src>, Open Graph / Twitter card
// metadata, and JSON-LD ImageObject/VideoObject/AudioObject. Pure: takes a
// string, returns normalized candidates. Never executes anything.
const { Parser } = require('htmlparser2');
const { MEDIA_EXTENSIONS } = require('./sniff');
const { extOf } = require('./source-detector');

const MAX_SRCSET_ENTRIES = 24;
const MAX_JSONLD_BYTES = 200_000;

function extractCandidates(html, pageUrl, opts) {
  const maxCandidates = (opts && opts.maxCandidates) || 200;
  const out = [];
  const seen = new Map();   // href -> index in out
  let title = '', baseHref = null, truncated = false;
  const stack = [];         // tag stack for <picture>/<video>/<audio> context
  let inTitle = false, inJsonLd = false, jsonLdBuf = '', jsonLdBytes = 0;
  let pending = 0;          // candidates dropped by the cap

  const abs = (href) => {
    if (!href) return null;
    const h = String(href).trim();
    if (!h || /^(data|javascript|blob|file|about|mailto|tel|ftp):/i.test(h)) return null;
    try {
      const u = new URL(h, baseHref || pageUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      u.hash = '';
      return u.href;
    } catch { return null; }
  };

  const add = (href, c) => {
    const u = abs(href);
    if (!u) return;
    const existing = seen.get(u);
    if (existing != null) {
      // merge: keep the most informative width/height, prefer a non-thumbnail label
      const e = out[existing];
      if (!e.width && toInt(c.width)) e.width = toInt(c.width);
      if (!e.height && toInt(c.height)) e.height = toInt(c.height);
      if (!e.duration && c.duration) e.duration = c.duration;
      if (e.quality === 'thumbnail' && c.quality && c.quality !== 'thumbnail') e.quality = c.quality;
      if (!e.title && c.title) e.title = c.title;
      if (c.via && !e.via.includes(c.via)) e.via.push(c.via);
      return e;
    }
    if (out.length >= maxCandidates) { truncated = true; pending++; return null; }
    const ext = extOf(new URL(u).pathname);
    out.push({
      sourceUrl: u, kind: c.kind || guessKind(ext) || 'unknown', via: [c.via || 'html'],
      width: toInt(c.width), height: toInt(c.height), duration: c.duration || null,
      mime: c.mime || null, title: c.title || '', quality: c.quality || 'unknown', extHint: ext || '',
    });
    seen.set(u, out.length - 1);
    return out[out.length - 1];
  };
  const metaCtx = { lastOg: null };

  const parser = new Parser({
    onopentag(name, attrs) {
      const a = lower(attrs);
      stack.push(name);
      const parent = stack[stack.length - 2] || '';
      if (name === 'base' && a.href && !baseHref) { try { baseHref = new URL(a.href, pageUrl).href; } catch {} }
      else if (name === 'title') inTitle = true;
      else if (name === 'script' && /ld\+json/i.test(a.type || '')) { inJsonLd = true; jsonLdBuf = ''; jsonLdBytes = 0; }
      else if (name === 'meta') onMeta(a, add, metaCtx);
      else if (name === 'link' && /(^|\s)(image_src|preload)(\s|$)/i.test(a.rel || '')) {
        if (a.rel && /image_src/i.test(a.rel)) add(a.href, { kind: 'image', via: 'link:image_src' });
        else if (a.as === 'image' || a.as === 'video' || a.as === 'audio') add(a.href, { kind: a.as, via: 'link:preload' });
      }
      else if (name === 'img') {
        if (isTrackingPixel(a)) return;
        const best = bestFromSrcset(a.srcset);
        if (best) add(best.url, { kind: 'image', via: 'img:srcset', width: best.w || a.width, title: a.alt, quality: best.multi ? 'page-largest-variant' : 'unknown' });
        add(a.src, { kind: 'image', via: 'img', width: a.width, height: a.height, title: a.alt, quality: best ? 'page-variant' : 'unknown' });
        if (a['data-src']) add(a['data-src'], { kind: 'image', via: 'img:data-src', title: a.alt });
      }
      else if (name === 'source') {
        const kind = parent === 'picture' ? 'image' : parent === 'video' ? 'video' : parent === 'audio' ? 'audio' : null;
        if (!kind) return;
        if (kind === 'image') { const best = bestFromSrcset(a.srcset); if (best) add(best.url, { kind, via: 'picture:source', width: best.w, quality: best.multi ? 'page-largest-variant' : 'unknown', mime: a.type }); }
        else add(a.src, { kind, via: `${parent}:source`, mime: a.type });
      }
      else if (name === 'video') {
        add(a.src, { kind: 'video', via: 'video', width: a.width, height: a.height });
        add(a.poster, { kind: 'image', via: 'video:poster', quality: 'thumbnail' });
      }
      else if (name === 'audio') add(a.src, { kind: 'audio', via: 'audio' });
      else if (name === 'a' && a.href) {
        const u = abs(a.href);
        if (u && MEDIA_EXTENSIONS.has(extOf(new URL(u).pathname))) add(u, { via: 'a:href' });
      }
    },
    ontext(text) {
      if (inTitle && title.length < 300) title += text;
      if (inJsonLd) { jsonLdBytes += text.length; if (jsonLdBytes <= MAX_JSONLD_BYTES) jsonLdBuf += text; }
    },
    onclosetag(name) {
      stack.pop();
      if (name === 'title') inTitle = false;
      if (name === 'script' && inJsonLd) { inJsonLd = false; if (jsonLdBytes <= MAX_JSONLD_BYTES) onJsonLd(jsonLdBuf, add); jsonLdBuf = ''; }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(String(html || ''));
  parser.end();

  return { title: title.replace(/\s+/g, ' ').trim(), baseHref, candidates: out, truncated, dropped: pending };
}

function lower(attrs) { const o = {}; for (const k of Object.keys(attrs)) o[k.toLowerCase()] = attrs[k]; return o; }
function toInt(v) { const n = parseInt(String(v == null ? '' : v), 10); return Number.isFinite(n) && n > 0 ? n : null; }
function guessKind(ext) {
  if (!ext) return null;
  if (/^(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|heif|svg)$/.test(ext)) return 'image';
  if (/^(mp3|m4a|aac|ogg|oga|opus|flac|wav|weba)$/.test(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.has(ext)) return 'video';
  return null;
}
function isTrackingPixel(a) {
  const w = toInt(a.width), h = toInt(a.height);
  return (w === 1 && h === 1) || /\b(pixel|beacon|tracking)\b/i.test(a.src || '') && (w === 1 || h === 1);
}

// srcset: "a.jpg 320w, b.jpg 640w" or "a.jpg 1x, b.jpg 2x". Returns the
// entry with the largest width (w) or density (x); null if empty.
function bestFromSrcset(srcset) {
  if (!srcset) return null;
  const entries = String(srcset).split(',').slice(0, MAX_SRCSET_ENTRIES).map((s) => s.trim()).filter(Boolean);
  let best = null;
  for (const e of entries) {
    const parts = e.split(/\s+/);
    const url = parts[0];
    const d = parts[1] || '';
    const w = /w$/.test(d) ? parseInt(d, 10) : null;
    const x = /x$/.test(d) ? parseFloat(d) : null;
    const score = w != null ? w : x != null ? x * 1000 : 0;
    if (!best || score > best.score) best = { url, w: Number.isFinite(w) ? w : null, score };
  }
  if (best) best.multi = entries.length > 1;
  return best;
}

function onMeta(a, add, ctx) {
  const key = (a.property || a.name || '').toLowerCase();
  const v = a.content;
  if (!key || !v) return;
  if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') ctx.lastOg = add(v, { kind: 'image', via: 'og:image', quality: 'metadata' });
  else if (key === 'og:video' || key === 'og:video:url' || key === 'og:video:secure_url') add(v, { kind: 'video', via: 'og:video', quality: 'metadata' });
  else if (key === 'og:audio' || key === 'og:audio:url' || key === 'og:audio:secure_url') add(v, { kind: 'audio', via: 'og:audio', quality: 'metadata' });
  else if (key === 'twitter:image' || key === 'twitter:image:src') add(v, { kind: 'image', via: 'twitter:image', quality: 'metadata' });
  else if (key === 'twitter:player:stream') add(v, { kind: 'video', via: 'twitter:player:stream', quality: 'metadata' });
  else if ((key === 'og:image:width' || key === 'og:image:height') && ctx.lastOg) {
    const n = toInt(v);
    if (n) { if (key.endsWith('width')) ctx.lastOg.width = ctx.lastOg.width || n; else ctx.lastOg.height = ctx.lastOg.height || n; }
  }
}

function onJsonLd(text, add) {
  let data;
  try { data = JSON.parse(text); } catch { return; }
  const visit = (node, depth) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
    if (typeof node === 'string') return;
    if (typeof node !== 'object') return;
    const t = String(node['@type'] || '').toLowerCase();
    const name = typeof node.name === 'string' ? node.name : (typeof node.caption === 'string' ? node.caption : '');
    const dims = { width: numOrUnit(node.width), height: numOrUnit(node.height) };
    if (t.includes('imageobject')) {
      add(node.contentUrl || node.url, { kind: 'image', via: 'json-ld:ImageObject', quality: 'metadata', title: name, ...dims });
      if (node.thumbnailUrl) add(str(node.thumbnailUrl), { kind: 'image', via: 'json-ld:thumbnail', quality: 'thumbnail' });
    } else if (t.includes('videoobject')) {
      add(node.contentUrl, { kind: 'video', via: 'json-ld:VideoObject', quality: 'metadata', title: name, duration: typeof node.duration === 'string' ? node.duration : null, ...dims });
      if (node.thumbnailUrl) add(str(node.thumbnailUrl), { kind: 'image', via: 'json-ld:thumbnail', quality: 'thumbnail' });
    } else if (t.includes('audioobject')) {
      add(node.contentUrl, { kind: 'audio', via: 'json-ld:AudioObject', quality: 'metadata', title: name });
    }
    if (node.image) {
      const imgs = Array.isArray(node.image) ? node.image : [node.image];
      for (const im of imgs) { if (typeof im === 'string') add(im, { kind: 'image', via: 'json-ld:image', quality: 'metadata' }); else visit(im, depth + 1); }
    }
    for (const k of ['@graph', 'mainEntity', 'associatedMedia', 'video', 'audio', 'hasPart', 'itemListElement', 'item']) if (node[k]) visit(node[k], depth + 1);
  };
  visit(data, 0);
}
const str = (v) => (Array.isArray(v) ? v[0] : v);
const numOrUnit = (v) => { if (v == null) return null; if (typeof v === 'number') return v; if (typeof v === 'string') return toInt(v); if (typeof v === 'object' && v.value != null) return toInt(v.value); return null; };

module.exports = { extractCandidates, bestFromSrcset };
