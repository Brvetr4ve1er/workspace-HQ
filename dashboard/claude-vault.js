// dashboard/claude-vault.js — "Save to vault" (Claude Hub H5; spec 2026-10-13 §7 claudeVault.preview/save, §9 Vault).
// Main process (Electron 32 / Node 20, CommonJS). It never touches hub.sqlite: chats come from the Hub process
// through claude-hub-host's request(). It writes ONE note, ONLY after the owner pressed Save (or Replace) in v5,
// ONLY under <vault>/30_Areas/Claude/<Project>/, atomically, and never over a note without replace:true.
// Env HQ_VAULT_DIR overrides the vault folder (second-instance gates); tests pass vaultDir directly.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const CLAUDE_DIR = ['30_Areas', 'Claude'];
const NAME_MAX = 60;          // a note path stays well under Windows' 260 even in a deep vault
const NOTE_MAX = 200000;      // characters a note may have
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

// one file or folder name: no Windows-illegal characters, nothing that breaks an Obsidian [[link]] (# ^ [ ] |),
// no control characters, no leading dot, no trailing dot or space, not a DOS device name, ≤ NAME_MAX code points
function safeSegment(name, fallback = 'untitled') {
  let s = String(name == null ? '' : name).normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[[\]#^]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[.\s]+/, '');
  const cps = [...s];
  if (cps.length > NAME_MAX) s = cps.slice(0, NAME_MAX).join('');
  s = s.replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = '_' + s;
  return s;
}
// main.js safeFile (the WorkspaceHQ project note's name), copied so the wikilink matches the note main writes
const projectNoteName = (name) => String(name || 'project').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'project';

function noteDay(c, now = new Date()) {
  for (const v of [c && c.started_at, c && c.last_at]) {
    const t = Date.parse(v || '');
    if (Number.isFinite(t)) return new Date(t).toLocaleDateString('en-CA');
  }
  return now.toLocaleDateString('en-CA');
}
function planNote({ conversation: c, projectName, hqProjectName = null, now = new Date() }) {
  const folder = safeSegment(projectName, 'No project');
  const title = safeSegment(c && c.title, 'Untitled chat');
  const day = noteDay(c, now);
  const link = hqProjectName ? projectNoteName(hqProjectName) : folder;
  return { folder, title, day, link, rel: [...CLAUDE_DIR, folder, day + ' ' + title + '.md'].join('/') };
}

function frontConversation(text) {
  const fm = (String(text || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/) || [])[1];
  if (fm == null) return null;
  const m = fm.match(/^conversation:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return null;
  if (!m[1].startsWith('"')) return m[1];
  try { return JSON.parse(m[1]); } catch { return null; }
}
async function noteConversation(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return frontConversation(buf.toString('utf8', 0, bytesRead));
  } catch (e) {
    if (e && e.code === 'ENOENT') return undefined;
    throw e;
  } finally { if (fh) await fh.close().catch(() => {}); }
}
// this chat's own earlier note → offered for Replace; a name another chat (or the owner) uses → the next " (n)"
async function choosePath(vaultDir, rel, conversationId) {
  const base = rel.replace(/\.md$/i, '');
  for (let i = 1; i <= 9; i++) {
    const r = i === 1 ? rel : base + ' (' + i + ').md';
    const owner = await noteConversation(path.join(vaultDir, ...r.split('/')));
    if (owner === undefined) return { rel: r, exists: false };
    if (owner === conversationId) return { rel: r, exists: true };
  }
  throw new Error('nine notes with this name already exist for other chats — rename one in Obsidian first');
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
async function resolveSavePath(vaultDir, p) {
  if (typeof p !== 'string' || !p || p.length > 1024) throw new Error('no note path');
  let realVault;
  try { realVault = await fsp.realpath(vaultDir); } catch { throw new Error('the vault folder was not found: ' + vaultDir); }
  const root = path.join(path.resolve(vaultDir), ...CLAUDE_DIR);
  const rel = path.relative(root, path.resolve(vaultDir, p));
  const parts = rel.split(path.sep);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || parts.length !== 2) throw new Error('notes are saved only as 30_Areas/Claude/<Project>/<note>.md');
  const [folder, file] = parts;
  const stem = file.replace(/\.md$/i, '');
  if (!/\.md$/i.test(file) || safeSegment(folder) !== folder || safeSegment(stem) !== stem) throw new Error('that note name is not one Save to vault makes');
  await fsp.mkdir(root, { recursive: true });
  const realRoot = await fsp.realpath(root);
  if (!same(realRoot, path.join(realVault, ...CLAUDE_DIR))) throw new Error('30_Areas/Claude leads outside the vault — refusing to write');
  await fsp.mkdir(path.join(realRoot, folder), { recursive: true });
  const realDir = await fsp.realpath(path.join(realRoot, folder));
  if (!same(realDir, path.join(realRoot, folder))) throw new Error('the project folder leads outside the vault — refusing to write');
  return path.join(realDir, file);
}

// temp file in the same folder (fsynced) → hard link (new note: EEXIST if one appeared, so never an overwrite)
// or rename over (Replace: atomic; EBUSY/EPERM/EACCES retried). The temp file never survives.
async function writeNoteAtomic(file, text, { replace = false, ops = { link: fsp.link, rename: fsp.rename }, waits = [100, 300, 900] } = {}) {
  const tmp = file + '.' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.tmp';
  const fh = await fsp.open(tmp, 'wx');
  try { await fh.writeFile(text, 'utf8'); await fh.sync(); } finally { await fh.close(); }
  try {
    if (!replace) {
      try { await ops.link(tmp, file); }
      catch (e) {
        if (e && e.code === 'EEXIST') { const err = new Error('a note with this name is already there'); err.exists = true; throw err; }
        throw e;
      }
      return;
    }
    for (let i = 0; ; i++) {
      try { await ops.rename(tmp, file); return; }
      catch (e) {
        const busy = e && ['EBUSY', 'EPERM', 'EACCES'].includes(e.code);
        if (busy && i < waits.length) { await new Promise((r) => setTimeout(r, waits[i])); continue; }
        if (!busy) throw e;
        const err = new Error('the note is open or locked by another program (' + e.code + ') — close it and press Replace again');
        err.busy = true; throw err;
      }
    }
  } finally { await fsp.unlink(tmp).catch(() => {}); }
}

const DRAFT_SYSTEM = 'You turn one past chat between the owner and Claude into an Obsidian note. Write Markdown with exactly these four sections, in this order: "## Summary" (3 to 6 sentences), "## Decisions" (bullets; "- none recorded" if there are none), "## To-dos" (bullets as "- [ ] …"; "- [ ] none recorded" if there are none), "## Links" (bullets of URLs or file paths that appear in the chat; "- none" if there are none). Use only what the chat says: never invent decisions, dates, names or numbers. No front matter, no title line, no preamble.';
const oneLine = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function draftPrompt(c, messages, { maxChars = 12000 } = {}) {
  const lines = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && !m.is_sidechain && String(m.text || '').trim())
    .map((m) => (m.role === 'user' ? 'Owner' : 'Claude') + ': ' + oneLine(m.text, 1200));
  const head = lines.slice(0, 2), tail = [];
  let used = head.join('\n').length;
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (used + 1 + lines[i].length > maxChars) break;
    tail.unshift(lines[i]); used += 1 + lines[i].length;
  }
  const left = lines.length - head.length - tail.length;
  const kept = head.concat(left > 0 ? ['[… ' + left + ' messages left out …]'] : [], tail);
  return { system: DRAFT_SYSTEM, prompt: 'Chat title: ' + oneLine((c && c.title) || 'Untitled chat', 200) + '\n\n' + kept.join('\n'), basis: head.length + tail.length };
}

function noteText({ conversation: c, plan, draft, model, basis, created }) {
  const body = String(draft || '').replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();
  return [
    '---',
    'source: ' + (c.source === 'web' ? 'claude.ai' : c.source === 'chatgpt' ? 'chatgpt' : 'claude-code'),
    'conversation: ' + JSON.stringify(String(c.id)),
    'project: ' + JSON.stringify('[[' + plan.link + ']]'),
    'created: ' + created,
    'chat_date: ' + plan.day,
    'title: ' + JSON.stringify(String(c.title || 'Untitled chat')),
    'drafted_by: ' + JSON.stringify('local model ' + (model || 'unknown') + ', from ' + basis + ' chat messages'),
    'tags: [claude]',
    '---', '',
    '# ' + plan.title, '',
    'Project: [[' + plan.link + ']] · chat of ' + plan.day, '',
    body, '',
  ].join('\n');
}

// the WorkspaceHQ project's name from the latest scan (read-only), for the project note's wikilink
function hqProjectName(dataDir, hqProjectId) {
  if (!hqProjectId) return null;
  try {
    const S = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8'));
    const p = (S.projects || []).find((x) => x && x.id === hqProjectId);
    return p && p.name ? String(p.name) : null;
  } catch { return null; }
}
const HUB_DOWN = { 'hub not running': 'Claude Hub is not running', 'hub stopped': 'Claude Hub stopped while answering', timeout: 'Claude Hub did not answer in time' };
const hubError = (r) => (r && typeof r.error === 'string' ? 'Claude Hub: ' + (HUB_DOWN[r.error] || r.error) : null);

function createVault({ hub, llm, vaultDir, dataDir, now = () => new Date() }) {
  async function preview(conversationId) {
    if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 300) return { error: 'no chat to save' };
    if (!hub || typeof hub.request !== 'function') return { error: 'Claude Hub is not running — Save to vault reads the chat from it' };
    if (!fs.existsSync(vaultDir)) return { error: 'the vault folder was not found: ' + vaultDir };
    const got = await hub.request('getConversation', { id: conversationId, limit: 500 }, { timeout: 10000 });
    if (hubError(got)) return { error: hubError(got) };
    if (!got || !got.conversation) return { error: 'that chat is not in the Claude Hub index (forgotten, or not indexed yet)' };
    const projects = await hub.request('listProjects', {}, { timeout: 10000 });
    if (hubError(projects)) return { error: hubError(projects) };
    const c = got.conversation;
    const proj = (Array.isArray(projects) ? projects : []).find((p) => p && p.id === c.project_id);
    const d = draftPrompt(c, got.messages);
    if (!d.basis) return { error: 'that chat has no messages from you or Claude to summarise' };
    const r = await llm.run({ system: d.system, prompt: d.prompt, timeoutMs: 120000 });
    if (!r || r.status !== 'done') {
      return { error: r && r.status === 'unavailable'
        ? 'the local model isn’t running — start Ollama or LM Studio and try again (' + (r.reason || 'no runtime') + ')'
        : 'the local model failed: ' + ((r && r.reason) || 'no answer') };
    }
    const at = now();
    // getConversation's row is `SELECT * FROM conversation` (no hq_project_id column); the link lives on the project row
    // (listProjects p.*). c.hq_project_id is read too, in case a later phase adds it to the conversation row.
    const hqId = c.hq_project_id || (proj && proj.hq_project_id) || null;
    const plan = planNote({ conversation: c, projectName: proj ? proj.name : null, hqProjectName: hqProjectName(dataDir, hqId), now: at });
    let chosen;
    try { chosen = await choosePath(vaultDir, plan.rel, c.id); } catch (e) { return { error: String(e.message || e) }; }
    const markdown = noteText({ conversation: c, plan, draft: r.output, model: r.model, basis: d.basis, created: at.toLocaleDateString('en-CA') });
    return { path: path.join(vaultDir, ...chosen.rel.split('/')), rel: chosen.rel, markdown, exists: chosen.exists, model: r.model || null, basis: d.basis };
  }

  async function save(req) {
    if (!req || typeof req !== 'object') return { error: 'no note to save' };
    const { path: p, markdown, replace } = req;
    if (typeof markdown !== 'string' || !markdown.trim()) return { error: 'no note text to save' };
    if (markdown.length > NOTE_MAX) return { error: 'the note is too long (over ' + NOTE_MAX + ' characters)' };
    const id = frontConversation(markdown);
    if (!id) return { error: 'the note lost its "conversation:" frontmatter line — keep the frontmatter block' };
    let file;
    try { file = await resolveSavePath(vaultDir, p); } catch (e) { return { error: String(e.message || e) }; }
    let overwrite = false;
    if (replace === true) {
      const owner = await noteConversation(file).catch((e) => e);
      if (owner instanceof Error) return { error: String(owner.message || owner) };
      if (owner !== undefined && owner !== id) return { error: 'that note belongs to another chat — it is never replaced' };
      overwrite = owner !== undefined;
    }
    try { await writeNoteAtomic(file, markdown, { replace: overwrite }); }
    catch (e) { return e && e.exists ? { error: e.message, exists: true } : { error: String((e && e.message) || e) }; }
    return true;
  }
  return { preview, save };
}

// main.js: one line after the Hub host is created. Two invoke channels; neither ever throws.
function init({ ipcMain, hub, dataDir, vaultDir, llm = require('./llm-local') }) {
  const vault = createVault({ hub, llm, dataDir, vaultDir: process.env.HQ_VAULT_DIR || vaultDir });
  const safe = (fn) => async (_e, arg) => { try { return await fn(arg); } catch (e) { return { error: String((e && e.message) || e).slice(0, 300) }; } };
  ipcMain.handle('hq:claude-vault:preview', safe((id) => vault.preview(id)));
  ipcMain.handle('hq:claude-vault:save', safe((req) => vault.save(req)));
  return vault;
}

module.exports = {
  CLAUDE_DIR, NAME_MAX, NOTE_MAX, DRAFT_SYSTEM,
  safeSegment, projectNoteName, noteDay, planNote, frontConversation, noteConversation, choosePath,
  resolveSavePath, writeNoteAtomic, draftPrompt, noteText,
  hqProjectName, createVault, init,
};
