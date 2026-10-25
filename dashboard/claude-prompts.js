'use strict';
// Prompt library, main side (spec 2026-10-15-archive-and-prompt-library-design.md §6.4). Phase P1: writePromptNote
// (consumed by P2's Promote) and the Library's status/open channels (Task 5). The vault's other notes are read-only:
// this module writes only NEW files directly inside <vault>/40_Resources/Prompts, never an overwrite.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PROMPTS_REL, slugify, noteName, variablesOf, promptNoteText, promptDocId } = require('./claude-prompt-note');
const { writeNoteAtomic } = require('./claude-vault');

const NOTE_TEXT_MAX = 200000;
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

async function resolvePromptsDir(vaultDir, { create = false } = {}) {
  if (!vaultDir || typeof vaultDir !== 'string') throw new Error('no vault folder is configured');
  let realVault;
  try { realVault = await fsp.realpath(vaultDir); } catch { throw new Error('the vault folder was not found'); }
  const dir = path.join(path.resolve(vaultDir), ...PROMPTS_REL);
  if (create) await fsp.mkdir(dir, { recursive: true });
  let realDir;
  try { realDir = await fsp.realpath(dir); } catch { return null; }
  if (!same(realDir, path.join(realVault, ...PROMPTS_REL))) throw new Error('40_Resources/Prompts leads outside the vault — refusing');
  return realDir;
}

// a name this module would make: <slug>.md or <slug>-<2..9>.md, slug = slugify(slug)
function validName(name) {
  if (typeof name !== 'string' || !/\.md$/.test(name)) return false;
  const stem = name.slice(0, -3);
  // the -N clash suffix is added after the slug's own 60-char cut, so check the slug without it
  const base = stem.replace(/-[2-9]$/, '');
  if (!base || slugify(base) !== base) return false;
  return true;
}

const exists = (f) => { try { fs.lstatSync(f); return true; } catch { return false; } };

function clash(dir, name) {
  const base = name.slice(0, -3).replace(/-[2-9]$/, '');
  let next = null;
  for (let n = 2; n <= 9 && !next; n++) if (!exists(path.join(dir, noteName(base, n)))) next = noteName(base, n);
  return { error: next ? 'a prompt note with this name is already there' : 'a prompt note with this name is already there (and -2 … -9 too)', exists: true, next };
}

async function writePromptNote(vaultDir, { name, text } = {}, { ops } = {}) {
  try {
    if (!validName(name)) return { error: 'that file name is not one the prompt library makes' };
    if (typeof text !== 'string' || !text.startsWith('---\n') || text.length > NOTE_TEXT_MAX) return { error: 'that is not a prompt note' };
    const dir = await resolvePromptsDir(vaultDir, { create: true });   // §8: Promote creates the folder
    const file = path.join(dir, name);
    if (exists(file)) return clash(dir, name);
    try { await writeNoteAtomic(file, text, { replace: false, ...(ops ? { ops } : {}) }); }
    catch (e) { if (e && e.exists) return clash(dir, name); throw e; }
    return { path: file, name };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

// spec §2: the only obsidian:// link ever opened — vault = basename of the configured vault root, file = a note directly
// inside 40_Resources/Prompts that findPromptFile just found on disk. Never a URL or path from the renderer, index or note text.
function obsidianUrl(vaultName, fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || /[\\/]/.test(fileName) || !/\.md$/i.test(fileName)) throw new Error('not a prompt note name');
  return 'obsidian://open?vault=' + encodeURIComponent(String(vaultName)) + '&file=' + encodeURIComponent([...PROMPTS_REL, fileName.replace(/\.md$/i, '')].join('/'));
}

function findPromptFile(vaultDir, realDir, id) {
  if (typeof id !== 'string' || !/^prompt:[0-9a-f]{40}$/.test(id)) return null;
  let names = [];
  try { names = fs.readdirSync(realDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name); } catch { return null; }
  const base = path.join(path.resolve(vaultDir), ...PROMPTS_REL);   // the Hub ids the file by this path (H6 docId)
  for (const name of names) if (promptDocId(path.join(base, name)) === id) return { name, file: path.join(realDir, name) };
  return null;
}

// ---- P2 Promote (spec 2026-10-15 §6.1, §6.4). The Hub's masker is ESM: reached through import() (Electron 32 cannot require ESM).
const PROMOTE_TEXT_MAX = 100000;
const SOURCE_KINDS = ['code', 'web', 'chatgpt', 'history'];
let redactMod = null;
async function maskText(s) {
  if (!redactMod) redactMod = await import(pathToFileURL(path.join(__dirname, 'claude-hub', 'redact.mjs')).href);
  return redactMod.maskSecrets(String(s));
}
// A harvested note's provenance: only these kinds, an id-shaped conversation and an ISO time survive; anything else is blanked.
function sourceOf(s) {
  if (!s || typeof s !== 'object' || !SOURCE_KINDS.includes(s.kind)) return null;
  const conversation = typeof s.conversation === 'string' && /^(code|web|chatgpt|history):[A-Za-z0-9:._-]{1,280}$/.test(s.conversation) ? s.conversation : '';
  const at = typeof s.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z?$/.test(s.at) ? s.at : '';
  return { kind: s.kind, conversation, at };
}

function createPrompts({ vaultDir, openExternal, openPath, protocolName, env = {}, log = () => {}, now = () => new Date() }) {
  const vaultName = vaultDir ? path.basename(path.resolve(vaultDir)) : null;
  const dry = () => env.HQ_DRY_LAUNCH === '1';
  const hasObsidian = () => { try { return !!protocolName('obsidian://'); } catch { return false; } };
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  return {
    async status() {
      const folder = { exists: false };
      try { folder.exists = !!(await resolvePromptsDir(vaultDir)); } catch (e) { folder.error = why(e); }
      return { vault: vaultName, rel: PROMPTS_REL.join('/'), folder, obsidian: hasObsidian() };
    },
    async open(id, how) {
      try {
        if (how !== 'obsidian' && how !== 'file') return { error: 'a prompt note opens only in Obsidian or as a file' };
        const realDir = await resolvePromptsDir(vaultDir);
        if (!realDir) return { error: `No prompts folder yet — create ${vaultName}/${PROMPTS_REL.join('/')}` };
        const hit = findPromptFile(vaultDir, realDir, id);
        if (!hit) return { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' };
        const real = await fsp.realpath(hit.file);
        if (!same(path.dirname(real), realDir)) return { error: 'that note leads outside the Prompts folder — refusing' };
        if (how === 'obsidian') {
          if (!hasObsidian()) return { error: 'Obsidian is not installed — use Open file', fallback: 'file' };
          const url = obsidianUrl(vaultName, hit.name);
          if (dry()) { log('[dry-open] obsidian ' + hit.name); return { ok: true, how, dry: true }; }
          await openExternal(url);
          return { ok: true, how };
        }
        if (dry()) { log('[dry-open] file ' + hit.name); return { ok: true, how, dry: true }; }
        const err = await openPath(real);
        return err ? { error: 'Windows could not open the note: ' + String(err).slice(0, 200) } : { ok: true, how };
      } catch (e) { return { error: why(e) }; }
    },
    // Writes ONE new note the owner confirmed. Masks body + title first; the file name is the title's slug, or the
    // slug-2…-9 name a clash answer offered (and the owner confirmed) — never a name of the renderer's choosing.
    async promote(p) {
      try {
        const o = p && typeof p === 'object' ? p : {};
        if (typeof o.text !== 'string' || !o.text.trim()) return { error: 'nothing to promote — the prompt text is empty' };
        if (o.text.length > PROMOTE_TEXT_MAX) return { error: 'that prompt is over 100 000 characters' };
        if (!vaultDir) return { error: 'no vault folder is configured' };
        const body = await maskText(o.text.replace(/\r\n/g, '\n').trim());
        const first = o.text.split('\n').find((l) => l.trim()) || '';
        const title = await maskText((typeof o.title === 'string' && o.title.trim() ? o.title : first).slice(0, 400));
        const t = title.text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled prompt';
        const slug = slugify(t);
        let name = noteName(slug);
        if (o.name !== undefined) {
          const offered = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => noteName(slug, n));
          if (!offered.includes(o.name)) return { error: 'that file name is not one this title can take — promote again to get the offered name' };
          name = o.name;
        }
        const tags = Array.isArray(o.tags) && o.tags.length ? o.tags.slice(0, 10) : ['harvested'];
        const id = promptDocId(path.join(path.resolve(vaultDir), ...PROMPTS_REL, name));
        const text = promptNoteText({ title: t, tags, variables: variablesOf({}, body.text), created: now().toISOString(),
          source: sourceOf(o.source), id, body: body.text });
        const r = await writePromptNote(vaultDir, { name, text });
        if (r.error) return r;
        log('[prompts] promoted ' + r.name);
        return { path: PROMPTS_REL.join('/') + '/' + r.name, name: r.name, id, masked: body.hits + title.hits };
      } catch (e) { return { error: why(e) }; }
    },
  };
}

function init({ ipcMain, app, shell, vaultDir, env = process.env, log = console.log }) {
  const p = createPrompts({ vaultDir: env.HQ_VAULT_DIR || vaultDir, env, log,
    openExternal: (u) => shell.openExternal(u), openPath: (f) => shell.openPath(f),
    protocolName: (u) => (app && app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : '') });
  ipcMain.handle('hq:claude-prompts:status', () => p.status());
  ipcMain.handle('hq:claude-prompts:open', (_e, id, how) => p.open(typeof id === 'string' && id.length <= 300 ? id : '', how));
  ipcMain.handle('hq:claude-prompts:promote', (_e, req) => p.promote(req && typeof req === 'object' && !Array.isArray(req) ? req : {}));
  return p;
}

module.exports = { NOTE_TEXT_MAX, PROMOTE_TEXT_MAX, SOURCE_KINDS, sourceOf, resolvePromptsDir, writePromptNote, obsidianUrl, findPromptFile, createPrompts, init };
