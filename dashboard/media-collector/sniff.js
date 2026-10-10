'use strict';
// Media type detection from response BYTES (magic numbers) with the declared
// Content-Type as a secondary signal. A URL extension alone never decides.
const MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg',  kind: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  ext: 'png',  kind: 'image', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif',  ext: 'gif',  kind: 'image', test: (b) => ascii(b, 0, 3) === 'GIF' },
  { mime: 'image/webp', ext: 'webp', kind: 'image', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' },
  { mime: 'image/bmp',  ext: 'bmp',  kind: 'image', test: (b) => ascii(b, 0, 2) === 'BM' },
  { mime: 'image/tiff', ext: 'tif',  kind: 'image', test: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a) },
  { mime: 'image/avif', ext: 'avif', kind: 'image', test: (b) => ascii(b, 4, 4) === 'ftyp' && /^(avif|avis)/.test(ascii(b, 8, 4)) },
  { mime: 'image/heic', ext: 'heic', kind: 'image', test: (b) => ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(b, 8, 4)) },
  { mime: 'video/quicktime', ext: 'mov', kind: 'video', test: (b) => ascii(b, 4, 4) === 'ftyp' && ascii(b, 8, 4) === 'qt  ' },
  { mime: 'audio/mp4',  ext: 'm4a',  kind: 'audio', test: (b) => ascii(b, 4, 4) === 'ftyp' && /^M4A/.test(ascii(b, 8, 4)) },
  { mime: 'video/mp4',  ext: 'mp4',  kind: 'video', test: (b) => ascii(b, 4, 4) === 'ftyp' },
  { mime: 'video/webm', ext: 'webm', kind: 'video', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 && ebmlDocType(b) === 'webm' },
  { mime: 'video/x-matroska', ext: 'mkv', kind: 'video', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'audio/ogg',  ext: 'ogg',  kind: 'audio', test: (b) => ascii(b, 0, 4) === 'OggS' },
  { mime: 'audio/flac', ext: 'flac', kind: 'audio', test: (b) => ascii(b, 0, 4) === 'fLaC' },
  { mime: 'audio/wav',  ext: 'wav',  kind: 'audio', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE' },
  { mime: 'audio/mpeg', ext: 'mp3',  kind: 'audio', test: (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2) },
  { mime: 'audio/aac',  ext: 'aac',  kind: 'audio', test: (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
  { mime: 'application/pdf', ext: 'pdf', kind: 'document', test: (b) => ascii(b, 0, 5) === '%PDF-' },
  { mime: 'application/zip', ext: 'zip', kind: 'archive', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) },
  { mime: 'application/gzip', ext: 'gz', kind: 'archive', test: (b) => b[0] === 0x1f && b[1] === 0x8b },
];

function ascii(b, off, len) {
  let s = '';
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
function ebmlDocType(b) {
  const s = ascii(b, 0, Math.min(b.length, 64));
  if (s.includes('webm')) return 'webm';
  if (s.includes('matroska')) return 'matroska';
  return '';
}

// Text-ish media: SVG is XML. Only call this once the bytes are known NOT to
// match a binary magic (an SVG never starts with a binary signature).
function sniffText(b) {
  const head = ascii(b, 0, Math.min(b.length, 512)).replace(/^﻿/, '').trimStart();
  if (/^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head) || /^<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg', kind: 'image' };
  if (/^(<!DOCTYPE html|<html|<head|<body|<!--|<meta|<script|<div)/i.test(head)) return { mime: 'text/html', ext: 'html', kind: 'html' };
  if (/^#EXTM3U/.test(head)) return { mime: 'application/vnd.apple.mpegurl', ext: 'm3u8', kind: 'manifest' };
  if (/^<\?xml[\s\S]{0,200}<MPD/i.test(head)) return { mime: 'application/dash+xml', ext: 'mpd', kind: 'manifest' };
  return null;
}

const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heic', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv', 'video/mpeg': 'mpg',
  'video/x-msvideo': 'avi', 'video/3gpp': '3gp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'weba',
};
const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg',
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'mpg', 'mpeg', 'avi', '3gp',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav', 'weba']);

function kindOfMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'text/html' || m === 'application/xhtml+xml') return 'html';
  if (m === 'application/vnd.apple.mpegurl' || m === 'application/x-mpegurl' || m === 'application/dash+xml') return 'manifest';
  return 'other';
}

function normalizeMime(ct) { return String(ct || '').toLowerCase().split(';')[0].trim(); }

// Decide the saved file's type: bytes win; a declared media Content-Type is
// accepted only when the bytes are not recognizably something else; the URL
// extension is a last resort for an unknown-but-declared media type.
// Returns { mime, ext, kind, trusted: 'bytes'|'header'|'extension'|'none' }.
function decideType(bytes, contentType, extHint) {
  const b = bytes && bytes.length ? bytes : new Uint8Array(0);
  for (const m of MAGIC) if (b.length >= 4 && m.test(b)) return { mime: m.mime, ext: m.ext, kind: m.kind, trusted: 'bytes' };
  const t = b.length ? sniffText(b) : null;
  if (t) return { ...t, trusted: 'bytes' };
  const ct = normalizeMime(contentType);
  const k = kindOfMime(ct);
  if (k === 'image' || k === 'video' || k === 'audio') return { mime: ct, ext: MIME_TO_EXT[ct] || (extHint && MEDIA_EXTENSIONS.has(extHint) ? extHint : 'bin'), kind: k, trusted: 'header' };
  if (k === 'html' || k === 'manifest') return { mime: ct, ext: k === 'html' ? 'html' : 'm3u8', kind: k, trusted: 'header' };
  if (extHint && MEDIA_EXTENSIONS.has(extHint) && (ct === '' || ct === 'application/octet-stream' || ct === 'binary/octet-stream')) {
    const kind = /^(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|heif|svg)$/.test(extHint) ? 'image' : /^(mp3|m4a|aac|ogg|oga|opus|flac|wav|weba)$/.test(extHint) ? 'audio' : 'video';
    return { mime: ct || 'application/octet-stream', ext: extHint === 'jpeg' ? 'jpg' : extHint, kind, trusted: 'extension' };
  }
  return { mime: ct || 'application/octet-stream', ext: 'bin', kind: 'other', trusted: 'none' };
}

// Pixel dimensions from a file header, when the format states them up front.
// Honest: returns null rather than guessing (JPEG SOF may sit past the sample).
function imageDims(bytes) {
  const b = bytes;
  if (!b || b.length < 24) return null;
  const be32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const le16 = (o) => b[o] | (b[o + 1] << 8);
  const le24 = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  if (b[0] === 0x89 && b[1] === 0x50 && ascii(b, 12, 4) === 'IHDR') return { width: be32(16), height: be32(20) };
  if (ascii(b, 0, 3) === 'GIF') return { width: le16(6), height: le16(8) };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + le24(24), height: 1 + le24(27) };
    if (chunk === 'VP8L' && b.length >= 25) { const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
    if (chunk === 'VP8 ' && b.length >= 30) return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    return null;
  }
  if (ascii(b, 0, 2) === 'BM' && b.length >= 26) return { width: le16(18) | (le16(20) << 16), height: Math.abs((le16(22) | (le16(24) << 16)) | 0) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = (b[o + 2] << 8) | b[o + 3];
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] };
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  return null;
}

module.exports = { decideType, kindOfMime, normalizeMime, imageDims, MIME_TO_EXT, MEDIA_EXTENSIONS };
