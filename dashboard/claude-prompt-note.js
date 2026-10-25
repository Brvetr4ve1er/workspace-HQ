'use strict';
// Prompt note format (spec 2026-10-15-archive-and-prompt-library-design.md §6.1, phase P1) — pure, no I/O.
// Shared by the Electron main (require) and the Claude Hub (ESM default import of this CommonJS module).
const crypto = require('node:crypto');
const path = require('node:path');

const PROMPTS_REL = ['40_Resources', 'Prompts'];
const SLUG_MAX = 60;
const VARS_MAX = 20;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]{0,39})\s*\}\}/g;
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function slugify(title) {
  // strip combining marks — written as \u escapes so no raw combining character sits in the source file
  const s = String(title == null ? '' : title).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');
  if (!s) return 'prompt';
  return DEVICE_RE.test(s) ? 'prompt-' + s : s;
}

const noteName = (slug, n = 1) => (n > 1 ? `${slug}-${n}.md` : `${slug}.md`);

function variablesOf(meta, body) {
  const out = [];
  const add = (v) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (NAME_RE.test(t) && !out.includes(t) && out.length < VARS_MAX) out.push(t);
  };
  const fm = meta && typeof meta === 'object' ? meta.variables : null;
  if (Array.isArray(fm)) fm.forEach(add);
  else if (typeof fm === 'string') fm.split(',').forEach(add);
  for (const m of String(body == null ? '' : body).matchAll(VAR_RE)) add(m[1]);
  return out;
}

// control characters (C0 + DEL) become spaces; the regex is built from code points so no raw control char sits in this file
const CTRL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']+', 'g');
const oneLine = (s, max) => String(s == null ? '' : s).replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const tagOf = (t) => String(t == null ? '' : t).replace(/[^A-Za-z0-9_/-]/g, '').slice(0, 40);
const list = (xs) => '[' + xs.join(', ') + ']';

function promptNoteText({ title, tags = [], variables = [], created, source = null, id = null, body = '' }) {
  const lines = ['---', 'title: ' + JSON.stringify(oneLine(title, 200) || 'Untitled prompt'),
    'tags: ' + list((Array.isArray(tags) ? tags : []).map(tagOf).filter(Boolean)),
    'variables: ' + list(variablesOf({ variables }, '')),
    'version: 1',
    'created: ' + oneLine(created, 40)];
  if (source && typeof source === 'object') {
    const kind = /^[a-z.]{1,20}$/.test(String(source.kind)) ? source.kind : 'unknown';
    lines.push(`source: { kind: ${kind}, conversation: ${JSON.stringify(oneLine(source.conversation, 300))}, at: ${JSON.stringify(oneLine(source.at, 40))} }`);
  }
  if (id) lines.push(`hq: { id: ${JSON.stringify(oneLine(id, 60))} }`);
  lines.push('---');
  const b = String(body == null ? '' : body).replace(/\r\n/g, '\n');
  return lines.join('\n') + '\n' + (b.endsWith('\n') ? b : b + '\n');
}

const promptDocId = (file) => 'prompt:' + crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex');

module.exports = { PROMPTS_REL, SLUG_MAX, VARS_MAX, VAR_RE, slugify, noteName, variablesOf, promptNoteText, promptDocId };
