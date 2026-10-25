'use strict';
// Prompt library, main side (spec 2026-10-15-archive-and-prompt-library-design.md §6.4). Phase P1: writePromptNote
// (consumed by P2's Promote) and the Library's status/open channels (Task 5). The vault's other notes are read-only:
// this module writes only NEW files directly inside <vault>/40_Resources/Prompts, never an overwrite.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { PROMPTS_REL, slugify, noteName } = require('./claude-prompt-note');
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
  if (!stem || slugify(stem) !== stem) return false;
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

module.exports = { NOTE_TEXT_MAX, resolvePromptsDir, writePromptNote };
