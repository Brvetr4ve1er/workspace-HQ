// dashboard/social-tab.js — the Social tab's main-process side (IPC-CONTRACT 2026-10-27 Social tab). Its vault is VEEMO CORTEX.
// Main process (Electron 32 / Node 20, CommonJS).
//   list()             reads only: every .md under <vault>/30_Areas/Social/ (≤ 2 folders deep) + <vault>/00_Inbox/Social *.md
//   open(rel, how)     only a note a fresh list() returned; Obsidian (obsidian://open, vault = the vault folder's basename) or the file
//   save({title,body}) ONE new note in 30_Areas/Social/, only after the owner pressed Save; never over an existing note
//   openSite(platform) one of the SITES literals below in the default browser (where the owner signs in); nothing else
// Env HQ_VAULT_DIR overrides the vault folder (second-instance gates); tests pass vaultDir directly.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { safeSegment, writeNoteAtomic } = require('./claude-vault');

const SOCIAL_REL = ['30_Areas', 'Social'];
const INBOX_REL = ['00_Inbox'];
const MAX_NOTES = 500;
const MAX_DEPTH = 2;          // folders below 30_Areas/Social
const TITLE_MAX = 60;
const BODY_MAX = 50000;
const HEAD_BYTES = 4096;      // enough of a note to find its front-matter title
// the platforms browser-bridge/social.js reads; Mastodon has no fixed server, so it has no link here
const SITES = Object.freeze({
  bluesky: 'https://bsky.app/', reddit: 'https://www.reddit.com/', x: 'https://x.com/', linkedin: 'https://www.linkedin.com/',
  instagram: 'https://www.instagram.com/', threads: 'https://www.threads.net/', facebook: 'https://www.facebook.com/', youtube: 'https://www.youtube.com/',
});

const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
const relOf = (root, p) => path.relative(root, p).split(path.sep).join('/');

// the front-matter title, else the file name
async function titleOf(file, name) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(buf.subarray(0, bytesRead).toString('utf8'));
    const t = fm && /^title:[ \t]*(.+?)[ \t]*$/m.exec(fm[1]);
    if (t) {
      let s = t[1];
      if (/^".*"$/.test(s)) { try { s = JSON.parse(s); } catch { s = s.slice(1, -1); } } else if (/^'.*'$/.test(s)) s = s.slice(1, -1);
      if (String(s).trim()) return String(s).trim().slice(0, 200);
    }
  } catch { /* unreadable: fall back to the name */ } finally { if (fh) await fh.close().catch(() => {}); }
  return name.replace(/\.md$/i, '');
}

function createSocialVault({ vaultDir, openExternal, openPath, protocolName = () => '', env = {}, log = () => {}, now = () => new Date() }) {
  const root = vaultDir ? path.resolve(vaultDir) : null;
  const vaultName = root ? path.basename(root) : null;
  const dry = () => env.HQ_DRY_LAUNCH === '1';
  const hasObsidian = () => { try { return !!protocolName('obsidian://'); } catch { return false; } };
  const why = (e) => String((e && e.message) || e).slice(0, 300);

  async function realRoot() { try { return await fsp.realpath(root); } catch { return null; } }

  async function list() {
    if (!root) return { error: 'No vault is configured' };
    const real = await realRoot();
    if (!real) return { error: 'The vault folder ' + vaultName + ' is not there' };
    const notes = [];
    const add = async (abs, where) => {
      if (notes.length >= MAX_NOTES) return;
      let rp, st;
      try { rp = await fsp.realpath(abs); st = await fsp.stat(rp); } catch { return; }
      if (!st.isFile() || !inside(real, rp)) return;   // a link that leads out of the vault is not a vault note
      const name = path.basename(abs);
      notes.push({ rel: relOf(root, abs), name, title: await titleOf(rp, name), mtime: st.mtimeMs, size: st.size, where });
    };
    const socialDir = path.join(root, ...SOCIAL_REL);
    let exists = false;
    const walk = async (dir, depth) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      if (dir === socialDir) exists = true;
      for (const d of ents) {
        if (d.name.startsWith('.')) continue;
        const abs = path.join(dir, d.name);
        if (d.isFile() && /\.md$/i.test(d.name)) await add(abs, 'social');
        else if (d.isDirectory() && depth < MAX_DEPTH) await walk(abs, depth + 1);
      }
    };
    await walk(socialDir, 0);
    try {
      const inbox = path.join(root, ...INBOX_REL);
      for (const d of await fsp.readdir(inbox, { withFileTypes: true })) if (d.isFile() && /^social .*\.md$/i.test(d.name)) await add(path.join(inbox, d.name), 'inbox');
    } catch { /* no inbox folder */ }
    notes.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel));
    return { vault: vaultName, folder: SOCIAL_REL.join('/'), exists, obsidian: hasObsidian(), notes };
  }

  async function open(rel, how) {
    if (how !== 'obsidian' && how !== 'file') return { error: 'a social note opens only in Obsidian or as a file' };
    if (typeof rel !== 'string' || !rel || rel.length > 1000) return { error: 'not a note' };
    const l = await list();
    if (l.error) return l;
    const hit = l.notes.find((n) => n.rel === rel);
    if (!hit) return { error: 'that note is not in the Social notes any more (moved, renamed or deleted?)' };
    try {
      if (how === 'obsidian') {
        if (!hasObsidian()) return { error: 'Obsidian is not installed (no obsidian:// handler)' };
        const url = 'obsidian://open?vault=' + encodeURIComponent(vaultName) + '&file=' + encodeURIComponent(hit.rel.replace(/\.md$/i, ''));
        if (dry()) { log('[dry-open] obsidian ' + hit.rel); return { ok: true, how, dry: true }; }
        await openExternal(url);
        return { ok: true, how };
      }
      if (dry()) { log('[dry-open] file ' + hit.rel); return { ok: true, how, dry: true }; }
      const err = await openPath(path.join(root, ...hit.rel.split('/')));
      return err ? { error: 'Windows could not open the note: ' + String(err).slice(0, 200) } : { ok: true, how };
    } catch (e) { return { error: why(e) }; }
  }

  async function save(req) {
    const r = req && typeof req === 'object' ? req : {};
    const rawTitle = typeof r.title === 'string' ? r.title.trim() : '';
    const body = typeof r.body === 'string' ? r.body : '';
    if (!rawTitle) return { error: 'give the note a title' };
    if ([...rawTitle].length > TITLE_MAX) return { error: 'the title is longer than ' + TITLE_MAX + ' characters' };
    if (body.length > BODY_MAX) return { error: 'the note is longer than ' + BODY_MAX + ' characters' };
    if (!root || !(await realRoot())) return { error: 'The vault folder ' + (vaultName || '') + ' is not there' };
    const name = safeSegment(rawTitle, 'Social note') + '.md';
    const dir = path.join(root, ...SOCIAL_REL);
    const file = path.join(dir, name);
    const day = now().toLocaleDateString('en-CA');
    const text = ['---', 'title: ' + JSON.stringify(rawTitle), 'type: note', 'tags: [social]', 'created: ' + day, 'source: WorkspaceHQ', '---', '',
      '# ' + rawTitle, '', body.replace(/\r\n/g, '\n').trimEnd(), ''].join('\n');
    try {
      await fsp.mkdir(dir, { recursive: true });
      const realDir = await fsp.realpath(dir);
      if (!inside(await realRoot(), realDir)) return { error: 'the Social folder leads outside the vault — refusing' };
      await writeNoteAtomic(path.join(realDir, name), text, { replace: false });
    } catch (e) {
      if (e && e.exists) return { error: 'a note called "' + name.replace(/\.md$/, '') + '" is already in ' + SOCIAL_REL.join('/'), exists: true };
      return { error: why(e) };
    }
    log('[social-vault] saved ' + relOf(root, file));
    return { rel: relOf(root, file) };
  }

  async function openSite(platform) {
    if (typeof platform !== 'string' || !Object.prototype.hasOwnProperty.call(SITES, platform)) return { error: 'refused: not one of the listed platforms' };
    const url = SITES[platform];
    if (dry()) { log('[dry-open] site ' + url); return { ok: true, dry: true }; }
    try { await openExternal(url); } catch (e) { return { error: why(e) }; }
    return { ok: true };
  }

  return { list, open, save, openSite };
}

function init({ ipcMain, app, shell, vaultDir, log = () => {} }) {
  const v = createSocialVault({
    vaultDir: process.env.HQ_VAULT_DIR || vaultDir, env: process.env, log,
    openExternal: (u) => shell.openExternal(u), openPath: (p) => shell.openPath(p),
    protocolName: (u) => (app && app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : ''),
  });
  ipcMain.handle('hq:social-vault:list', () => v.list().catch((e) => ({ error: String((e && e.message) || e) })));
  ipcMain.handle('hq:social-vault:open', (_e, rel, how) => v.open(rel, how));
  ipcMain.handle('hq:social-vault:save', (_e, req) => v.save(req));
  ipcMain.handle('hq:social-open-site', (_e, platform) => v.openSite(platform));
  return v;
}

module.exports = { SOCIAL_REL, TITLE_MAX, BODY_MAX, SITES, createSocialVault, init };
