'use strict';
// FileService naming half: safe components, the filename template, and
// deterministic collision resolution. Pure, no fs.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_COMPONENT = 80;    // per template token, in UTF-16 units
const MAX_NAME = 180;        // whole name without extension

// One filename component: no separators, no control/reserved chars, no
// leading/trailing dots or spaces, never a Windows device name, bounded.
function sanitizeComponent(s, fallback = 'item') {
  let out = String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[<>:"\/\\|?*\u2028\u2029]/g, '-')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.{2,}/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-_ ]+|[. ]+$/g, '');
  if (out.length > MAX_COMPONENT) out = out.slice(0, MAX_COMPONENT).replace(/[. ]+$/g, '');
  if (!out || RESERVED.test(out)) out = fallback;
  return out;
}

function sanitizeExt(ext) {
  const e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return e || 'bin';
}

// Tokens: {source} {host} {date} {time} {title} {id} {title-or-id} {index} {ext}
// Unknown tokens are dropped. Repeated separators collapse.
function buildName(template, t) {
  const tokens = {
    source: sanitizeComponent(t.source, 'web'),
    host: sanitizeComponent(t.host, 'host'),
    date: sanitizeComponent(t.date, 'undated'),
    time: sanitizeComponent(t.time, ''),
    title: sanitizeComponent(t.title, ''),
    id: sanitizeComponent(t.id, ''),
    'title-or-id': sanitizeComponent(t.title || t.id, 'media'),
    index: t.index == null ? '' : String(t.index).padStart(2, '0'),
  };
  const ext = sanitizeExt(t.ext);
  // The extension is never template-controlled: {ext} may only sit at the end,
  // and whatever the template says, the saved type decides the suffix.
  const stemTpl = String(template || DEFAULT_TEMPLATE).replace(/\.?\{ext\}\s*$/, '').replace(/\{ext\}/g, '');
  let stem = stemTpl.replace(/\{([a-z-]+)\}/g, (_, k) => (k in tokens ? tokens[k] : ''));
  stem = stem.replace(/_{2,}/g, '_').replace(/[._\- ]+$/g, '');
  stem = sanitizeComponent(stem, 'media').slice(0, MAX_NAME).replace(/[. _-]+$/g, '') || 'media';
  return `${stem}.${ext}`;
}
const DEFAULT_TEMPLATE = '{source}_{date}_{title-or-id}_{index}.{ext}';

// Deterministic collision suffix: name.ext \u2192 name (2).ext \u2192 name (3).ext \u2026
// `exists(candidate)` is sync and answers for both final and partial names.
function resolveCollision(name, exists, max = 999) {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i <= max; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!exists(c)) return c;
  }
  return `${stem} (${Date.now()})${ext}`;
}

// Filename hint from a URL path: the last segment, decoded, without query.
function hintFromUrl(href) {
  try {
    const u = new URL(href);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last.slice(0, 120);
  } catch { return ''; }
}

module.exports = { sanitizeComponent, sanitizeExt, buildName, resolveCollision, hintFromUrl, DEFAULT_TEMPLATE };
