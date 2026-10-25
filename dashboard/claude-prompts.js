'use strict';
// Prompt library, main side (spec 2026-10-15-archive-and-prompt-library-design.md §6.4). Phase P1: writePromptNote
// (consumed by P2's Promote) and the Library's status/open channels (Task 5). The vault's other notes are read-only:
// this module writes only NEW files directly inside <vault>/40_Resources/Prompts, never an overwrite.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { PROMPTS_REL, slugify, noteName, promptDocId } = require('./claude-prompt-note');
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

function createPrompts({ vaultDir, openExternal, openPath, protocolName, env = {}, log = () => {} }) {
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
  };
}

function init({ ipcMain, app, shell, vaultDir, env = process.env, log = console.log }) {
  const p = createPrompts({ vaultDir: env.HQ_VAULT_DIR || vaultDir, env, log,
    openExternal: (u) => shell.openExternal(u), openPath: (f) => shell.openPath(f),
    protocolName: (u) => (app && app.getApplicationNameForProtocol ? app.getApplicationNameForProtocol(u) : '') });
  ipcMain.handle('hq:claude-prompts:status', () => p.status());
  ipcMain.handle('hq:claude-prompts:open', (_e, id, how) => p.open(typeof id === 'string' && id.length <= 300 ? id : '', how));
  return p;
}

module.exports = { NOTE_TEXT_MAX, resolvePromptsDir, writePromptNote, obsidianUrl, findPromptFile, createPrompts, init };
