'use strict';
// Prompt library P3 (spec 2026-10-15 §6.3 Packs, §6.4 importPack/exportPack): the Prompts folder only; new notes only;
// ZIPs streamed one entry at a time. Electron 32's Node 20 has no zlib.crc32, so the CRC is a table here.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { slugify } = require('./claude-prompt-note');
const { resolvePromptsDir, writePromptNote, titleOf } = require('./claude-prompts');

const PACK_ZIP_MAX = 50 * 1024 * 1024;
const PACK_NOTE_MAX = 200000;
const PACK_NOTES_MAX = 200;
const PLAN_TTL_MS = 10 * 60 * 1000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

async function writeZip(file, entries) {
  const partial = file + '.partial-' + crypto.randomBytes(4).toString('hex');
  const fh = await fsp.open(partial, 'wx');
  let ok = false;
  try {
    const cen = [];
    let off = 0;
    for (const e of entries) {   // one entry in memory at a time
      const name = Buffer.from(e.name, 'utf8'), raw = await fsp.readFile(e.file), body = zlib.deflateRawSync(raw), crc = crc32(raw);
      const loc = Buffer.alloc(30);
      loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(8, 8);
      loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
      await fh.write(Buffer.concat([loc, name, body]));
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
      cen.push(c, name);
      off += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(cen), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    await fh.write(Buffer.concat([cd, end]));
    await fh.close();
    await fsp.link(partial, file);   // EEXIST when a file of that name appeared — never replaced
    ok = true;
  } finally {
    if (!ok) { try { await fh.close(); } catch { /* closed */ } }
    await fsp.rm(partial, { force: true });
  }
}

async function readEntry(zipFile, e, max) {
  if (e.encrypted) throw new Error('encrypted entry');
  if (e.method !== 0 && e.method !== 8) throw new Error('unsupported compression');
  if (e.usize > max || e.csize > max + 1024) throw new Error('entry too big');
  const fh = await fsp.open(zipFile, 'r');
  try {
    const loc = Buffer.alloc(30);
    await fh.read(loc, 0, 30, e.offset);
    if (loc.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
    const start = e.offset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
    const body = Buffer.alloc(e.csize);
    if (e.csize) await fh.read(body, 0, e.csize, start);
    const raw = e.method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: max }) : body;
    if (raw.length !== e.usize || crc32(raw) !== e.crc) throw new Error('checksum mismatch');
    return raw;
  } finally { await fh.close(); }
}

const hub = (f) => import(pathToFileURL(path.join(__dirname, 'claude-hub', f)).href);

// P1 writePromptNote takes only a §6.1 note (text starting with '---\n'). A plain .md from a pack gets a minimal
// frontmatter (deviation 10); CRLF → LF and a BOM dropped so a '---\r\n' note is recognised too. The body is unchanged.
function asNote(text, title) {
  const s = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.test(s)) return s;
  return '---\ntitle: ' + JSON.stringify(String(title)) + '\ntags: [imported]\n---\n' + s;
}

function createPacks({ vaultDir, pick, save, env = {}, log = () => {}, now = () => Date.now() }) {
  const plans = new Map();
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  const day = () => new Date(now()).toISOString().slice(0, 10);

  async function scan(from, src) {
    const skipped = { notMd: 0, tooBig: 0, tooMany: 0, duplicate: 0, unreadable: 0 };
    const items = [], seen = new Set();
    const add = (base, text) => {
      if (items.length >= PACK_NOTES_MAX) { skipped.tooMany++; return; }
      const name = slugify(base.replace(/\.md$/i, '')) + '.md';
      if (seen.has(name)) { skipped.duplicate++; return; }
      seen.add(name);
      items.push({ name, title: titleOf(text, name), text });
    };
    if (from === 'folder') {
      const ds = fs.readdirSync(src, { withFileTypes: true }).filter((d) => d.isFile()).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const d of ds) {
        if (!/\.md$/i.test(d.name)) { skipped.notMd++; continue; }
        const f = path.join(src, d.name);
        if (fs.statSync(f).size > PACK_NOTE_MAX) { skipped.tooBig++; continue; }
        try { add(d.name, fs.readFileSync(f, 'utf8')); } catch { skipped.unreadable++; }
      }
    } else {
      if (fs.statSync(src).size > PACK_ZIP_MAX) throw new Error('that ZIP is over 50 MB');
      const { readZipIndex } = await hub('unzip.mjs');
      let entries;
      try { ({ entries } = await readZipIndex(src)); } catch (e) { throw new Error('not a readable ZIP (' + why(e) + ')'); }
      for (const e of entries) {
        if (e.name.endsWith('/')) continue;
        const base = e.name.split(/[\\/]/).pop();   // the entry's path is never used — only its base name, slugified
        if (!/\.md$/i.test(base)) { skipped.notMd++; continue; }
        if (e.usize > PACK_NOTE_MAX) { skipped.tooBig++; continue; }
        if (items.length >= PACK_NOTES_MAX) { skipped.tooMany++; continue; }
        try { add(base, (await readEntry(src, e, PACK_NOTE_MAX)).toString('utf8')); } catch { skipped.unreadable++; }
      }
    }
    return { items, skipped };
  }

  async function commit(planId) {
    const plan = typeof planId === 'string' ? plans.get(planId) : null;
    if (plan) plans.delete(planId);   // a plan is used once
    if (!plan || now() - plan.at > PLAN_TTL_MS) return { error: 'that import plan has expired — pick the pack again' };
    const { maskSecrets } = await hub('redact.mjs');
    let imported = 0, masked = 0;
    const skipped = { exists: 0, failed: 0 };
    for (const it of plan.items) {
      const m = maskSecrets(it.text);
      const w = await writePromptNote(vaultDir, { name: it.name, text: asNote(m.text, it.title) });
      if (w && w.exists) skipped.exists++;
      else if (!w || w.error) { skipped.failed++; log('[prompts] pack note not written: ' + it.name + ' — ' + String((w && w.error) || '').slice(0, 120)); }
      else { imported++; masked += Array.isArray(m.hits) ? m.hits.length : Number(m.hits) || 0; }
    }
    log(`[prompts] pack import: ${imported} imported, ${skipped.exists} already there, ${skipped.failed} failed`);
    return { imported, masked, skipped };
  }

  return {
    async importPack(req) {
      try {
        const r = req && typeof req === 'object' && !Array.isArray(req) ? req : {};
        if (r.planId !== undefined) return await commit(r.planId);
        const from = r.from === 'folder' ? 'folder' : 'zip';
        const src = await pick(from);
        if (!src) return { canceled: true };
        if (!path.isAbsolute(src)) return { error: 'pick a folder or a .zip file' };
        if (from === 'zip' && !/\.zip$/i.test(src)) return { error: 'pick a .zip file' };
        const { items, skipped } = await scan(from, src);
        let realDir = null;
        try { realDir = await resolvePromptsDir(vaultDir); } catch (e) { return { error: why(e) }; }
        const notes = items.map((it) => ({ name: it.name, title: it.title, exists: !!realDir && fs.existsSync(path.join(realDir, it.name)) }));
        for (const k of [...plans.keys()]) if (now() - plans.get(k).at > PLAN_TTL_MS) plans.delete(k);
        const planId = 'pack-' + crypto.randomBytes(8).toString('hex');
        plans.set(planId, { at: now(), items });
        log(`[prompts] pack plan: ${items.length} notes from a ${from}`);
        return { planId, source: path.basename(src), notes, total: items.length, skipped };
      } catch (e) { return { error: why(e) }; }
    },
    async exportPack() {
      try {
        const realDir = await resolvePromptsDir(vaultDir);
        if (!realDir) return { error: 'No prompts folder yet — nothing to export' };
        const names = fs.readdirSync(realDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name).sort();
        if (!names.length) return { error: 'The Prompts folder has no notes — nothing to export' };
        const to = await save('prompts-pack-' + day() + '.zip');
        if (!to) return { canceled: true };
        if (!path.isAbsolute(to) || !/\.zip$/i.test(to)) return { error: 'pick a .zip file name' };
        if (fs.existsSync(to)) return { error: 'a file of that name is already there — pick a new name (nothing is ever replaced)' };
        await writeZip(to, names.map((n) => ({ name: n, file: path.join(realDir, n) })));
        log(`[prompts] pack export: ${names.length} notes`);
        return { file: path.basename(to), notes: names.length };
      } catch (e) {
        if (e && e.code === 'EEXIST') return { error: 'a file of that name is already there — pick a new name (nothing is ever replaced)' };
        return { error: why(e) };
      }
    },
  };
}

module.exports = { PACK_ZIP_MAX, PACK_NOTE_MAX, PACK_NOTES_MAX, PLAN_TTL_MS, crc32, writeZip, readEntry, createPacks };
