// dashboard/claude-vault.test.mjs
// Save to vault (Claude Hub H5, spec 2026-10-13 §7 claudeVault, §9 Vault). Every test writes into a fresh mkdtemp
// "vault"; the owner's VEEMO CORTEX is never touched. Placeholder titles and projects only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.TZ = 'UTC';
const require = createRequire(import.meta.url);
const V = require('./claude-vault.js');
const tmpVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vault-'));
const tmps = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
const conv = (extra = {}) => ({ id: 'code:s-1', source: 'code', title: 'Release planning', started_at: '2026-10-01T23:30:00.000Z', last_at: '2026-10-02T09:00:00.000Z', project_id: 'code:p-a', ...extra });
const put = (vault, rel, text) => { const f = path.join(vault, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const noteFor = (id) => '---\nsource: claude-code\nconversation: ' + JSON.stringify(id) + '\n---\n# x\n';

test('safeSegment: names hostile to Windows or Obsidian become safe, short and stable (Review Focus 4)', () => {
  const cases = [
    ['Plan: v2 / v3?', 'Plan- v2 - v3-'],
    ['a\\b*c"d<e>f|g', 'a-b-c-d-e-f-g'],
    ['[[link]] #tag ^block', '--link-- -tag -block'],
    ['CON', '_CON'], ['nul.txt', '_nul.txt'], ['com1', '_com1'],
    ['trailing dots...', 'trailing dots'], ['.hidden', 'hidden'], ['  spaced\tout\n', 'spaced out'],
    ['', 'untitled'], [null, 'untitled'], ['...', 'untitled'],
    ['Café ☕ menu 🚀', 'Café ☕ menu 🚀'],
  ];
  for (const [inp, want] of cases) assert.equal(V.safeSegment(inp), want, JSON.stringify(inp));
  const long = V.safeSegment('x'.repeat(300));
  assert.equal([...long].length, V.NAME_MAX);
  const emoji = V.safeSegment('🚀'.repeat(100));
  assert.equal([...emoji].length, V.NAME_MAX); assert.ok(emoji.endsWith('🚀'), 'cut on a code point: no broken surrogate');
  for (const [inp] of cases) assert.equal(V.safeSegment(V.safeSegment(inp)), V.safeSegment(inp), 'idempotent: ' + JSON.stringify(inp));
  assert.equal(V.safeSegment('', 'No project'), 'No project');
});

test('projectNoteName matches main.js safeFile', () => {
  assert.equal(V.projectNoteName('Kitchen: B'), 'Kitchen- B');
  assert.equal(V.projectNoteName(''), 'project');
});

test('planNote: 30_Areas/Claude/<Project>/<YYYY-MM-DD> <title>.md, the chat’s start day, the project link', () => {
  const p = V.planNote({ conversation: conv(), projectName: 'project-a', now: new Date('2026-10-16T10:00:00Z') });
  assert.deepEqual(p, { folder: 'project-a', title: 'Release planning', day: '2026-10-01', link: 'project-a', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md' });
  assert.equal(V.planNote({ conversation: conv({ started_at: null }), projectName: 'project-a' }).day, '2026-10-02');
  assert.equal(V.planNote({ conversation: conv({ started_at: 'x', last_at: null }), projectName: null, now: new Date('2026-10-16T10:00:00Z') }).day, '2026-10-16');
  const hostile = V.planNote({ conversation: conv({ title: 'What: next? [[x]]' }), projectName: 'Kitchen: B', hqProjectName: 'Kitchen: B' });
  assert.equal(hostile.rel, '30_Areas/Claude/Kitchen- B/2026-10-01 What- next- --x--.md');
  assert.equal(hostile.link, 'Kitchen- B');
  assert.equal(V.planNote({ conversation: conv({ title: null }), projectName: null }).rel, '30_Areas/Claude/No project/2026-10-01 Untitled chat.md');
});

test('choosePath: this chat’s own note is offered for Replace; another chat’s note is never — it gets " (2)" (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const rel = '30_Areas/Claude/project-a/2026-10-01 Release planning.md';
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-1'), { rel, exists: false });
    put(vault, rel, noteFor('code:s-1'));
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-1'), { rel, exists: true });
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-2'), { rel: rel.replace('.md', ' (2).md'), exists: false });
    put(vault, rel.replace('.md', ' (2).md'), noteFor('code:s-2'));
    assert.deepEqual(await V.choosePath(vault, rel, 'code:s-2'), { rel: rel.replace('.md', ' (2).md'), exists: true });
    put(vault, '30_Areas/Claude/project-a/2026-10-01 Hand.md', '# a note the owner wrote, no frontmatter\n');
    assert.deepEqual(await V.choosePath(vault, '30_Areas/Claude/project-a/2026-10-01 Hand.md', 'code:s-1'), { rel: '30_Areas/Claude/project-a/2026-10-01 Hand (2).md', exists: false });
    for (let i = 3; i <= 9; i++) put(vault, rel.replace('.md', ' (' + i + ').md'), noteFor('code:other-' + i));
    await assert.rejects(V.choosePath(vault, rel, 'code:s-9'), /nine notes with this name/);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('frontConversation: reads the quoted or bare value; nothing else', () => {
  assert.equal(V.frontConversation(noteFor('code:a "b"')), 'code:a "b"');
  assert.equal(V.frontConversation('---\nconversation: web:x\n---\n'), 'web:x');
  assert.equal(V.frontConversation('# no frontmatter\nconversation: code:x\n'), null);
});

test('resolveSavePath: only <vault>/30_Areas/Claude/<Project>/<note>.md; crafted paths are refused (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const want = path.join(fs.realpathSync.native(vault), '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md');
    // .native: fsp.realpath (what resolveSavePath uses) expands 8.3 short names (TEMP here is C:\Users\ROGSTR~1\…); the JS fs.realpathSync does not
    assert.equal(await V.resolveSavePath(vault, '30_Areas/Claude/project-a/2026-10-01 Release planning.md'), want);
    assert.equal(await V.resolveSavePath(vault, path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md')), want);
    assert.ok(fs.statSync(path.dirname(want)).isDirectory(), 'the project folder is created');
    const refused = [
      '30_Areas/Claude/../Projects/x.md', '30_Areas/Projects/x.md', '30_Areas/Claude/x.md', '30_Areas/Claude/a/b/x.md',
      '30_Areas/Claude/project-a/x.txt', '30_Areas/Claude/project-a/CON.md', '30_Areas/Claude/pro:ject/x.md',
      '30_Areas/Claude/project-a/..', path.join(os.tmpdir(), 'x.md'), 'C:\\Windows\\x.md', '', null, 42,
    ];
    for (const p of refused) await assert.rejects(V.resolveSavePath(vault, p), Error, String(p));
    await assert.rejects(V.resolveSavePath(path.join(vault, 'missing'), '30_Areas/Claude/p/x.md'), /vault folder was not found/);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('resolveSavePath: a junction that leads out of the vault is refused (Review Focus 4)', { skip: process.platform !== 'win32' && 'junctions are Windows-only' }, async () => {
  const vault = tmpVault(), outside = tmpVault();
  try {
    fs.mkdirSync(path.join(vault, '30_Areas', 'Claude'), { recursive: true });
    fs.symlinkSync(outside, path.join(vault, '30_Areas', 'Claude', 'escape'), 'junction');
    await assert.rejects(V.resolveSavePath(vault, '30_Areas/Claude/escape/x.md'), /outside/);
    const v2 = tmpVault();
    try {
      fs.mkdirSync(path.join(v2, '30_Areas'), { recursive: true });
      fs.symlinkSync(outside, path.join(v2, '30_Areas', 'Claude'), 'junction');
      await assert.rejects(V.resolveSavePath(v2, '30_Areas/Claude/p/x.md'), /outside/);
    } finally { fs.rmSync(v2, { recursive: true, force: true }); }
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was created outside the vault');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('writeNoteAtomic: creates; never overwrites without replace; replace swaps whole; no .tmp litter (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    await V.writeNoteAtomic(f, 'one');
    assert.equal(fs.readFileSync(f, 'utf8'), 'one');
    await assert.rejects(V.writeNoteAtomic(f, 'two'), (e) => e.exists === true && /already there/.test(e.message));
    assert.equal(fs.readFileSync(f, 'utf8'), 'one', 'byte-identical after a refusal');
    await V.writeNoteAtomic(f, 'three', { replace: true });
    assert.equal(fs.readFileSync(f, 'utf8'), 'three');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeNoteAtomic: a note that appears between preview and save is not overwritten (the link refuses) (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    const ops = { link: async (a, b) => { fs.writeFileSync(f, 'written by someone else'); return fs.promises.link(a, b); }, rename: fs.promises.rename };
    await assert.rejects(V.writeNoteAtomic(f, 'mine', { ops }), (e) => e.exists === true);
    assert.equal(fs.readFileSync(f, 'utf8'), 'written by someone else');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeNoteAtomic: a locked note (EBUSY) is retried, then refused with the note untouched (Review Focus 5)', async () => {
  const dir = tmpVault();
  try {
    const f = path.join(dir, 'n.md');
    fs.writeFileSync(f, 'original');
    let tries = 0;
    const busy = async () => { tries++; const e = new Error('EBUSY: resource busy or locked'); e.code = 'EBUSY'; throw e; };
    await assert.rejects(V.writeNoteAtomic(f, 'new', { replace: true, ops: { link: fs.promises.link, rename: busy }, waits: [1, 1] }), (e) => e.busy === true && /open or locked by another program/.test(e.message));
    assert.equal(tries, 3);
    assert.equal(fs.readFileSync(f, 'utf8'), 'original');
    assert.deepEqual(tmps(dir), []);
    let n = 0;
    const flaky = async (a, b) => { if (++n < 2) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return fs.promises.rename(a, b); };
    await V.writeNoteAtomic(f, 'new', { replace: true, ops: { link: fs.promises.link, rename: flaky }, waits: [1, 1] });
    assert.equal(fs.readFileSync(f, 'utf8'), 'new');
    assert.deepEqual(tmps(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('draftPrompt: only your and Claude’s words; the opening and the end are kept; basis counts what went in', () => {
  const msgs = [
    { role: 'user', text: 'Plan the placeholder release', is_sidechain: 0 },
    { role: 'assistant', text: 'Plan: freeze, test, tag', is_sidechain: 0 },
    { role: 'tool', text: '[tool: Read notes.md]', is_sidechain: 0 },
    { role: 'assistant', text: 'subagent chatter', is_sidechain: 1 },
    ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'middle message ' + i + ' ' + 'x'.repeat(300), is_sidechain: 0 })),
    { role: 'user', text: 'Decision: ship Friday', is_sidechain: 0 },
  ];
  const d = V.draftPrompt(conv(), msgs, { maxChars: 3000 });
  assert.equal(d.system, V.DRAFT_SYSTEM);
  assert.match(d.system, /## Summary[\s\S]*## Decisions[\s\S]*## To-dos[\s\S]*## Links/);
  assert.ok(d.prompt.startsWith('Chat title: Release planning\n\nOwner: Plan the placeholder release\nClaude: Plan: freeze, test, tag\n[… '));
  assert.ok(d.prompt.endsWith('Owner: Decision: ship Friday'));
  assert.doesNotMatch(d.prompt, /tool: Read|subagent chatter/);
  assert.ok(d.prompt.length <= 3000 + 200);
  assert.equal(d.basis, d.prompt.split('\n').filter((l) => /^(Owner|Claude): /.test(l)).length);
  const left = Number(d.prompt.match(/\[… (\d+) messages left out …\]/)[1]);
  assert.equal(left + d.basis, 43);
  const all = V.draftPrompt(conv(), msgs.slice(0, 2));
  assert.equal(all.basis, 2); assert.doesNotMatch(all.prompt, /left out/);
});

test('noteText: frontmatter (source, conversation, project wikilink, created) + title + project link + the draft; the model’s own frontmatter is dropped', () => {
  const plan = V.planNote({ conversation: conv({ title: 'Say "hi": now' }), projectName: 'project-a' });
  const md = V.noteText({ conversation: conv({ title: 'Say "hi": now' }), plan, draft: '---\nfoo: bar\n---\n## Summary\nShipped.\n', model: 'placeholder-model', basis: 12, created: '2026-10-16' });
  assert.equal(md, [
    '---', 'source: claude-code', 'conversation: "code:s-1"', 'project: "[[project-a]]"', 'created: 2026-10-16', 'chat_date: 2026-10-01',
    'title: "Say \\"hi\\": now"', 'drafted_by: "local model placeholder-model, from 12 chat messages"', 'tags: [claude]', '---', '',
    '# Say -hi-- now', '', 'Project: [[project-a]] · chat of 2026-10-01', '', '## Summary\nShipped.', '',
  ].join('\n'));
  assert.equal(V.frontConversation(md), 'code:s-1');
  assert.match(V.noteText({ conversation: conv({ source: 'web', id: 'web:w-1' }), plan, draft: 'x', model: null, basis: 1, created: '2026-10-16' }), /^---\nsource: claude\.ai\nconversation: "web:w-1"\n/);
  assert.match(V.noteText({ conversation: conv({ source: 'chatgpt', id: 'chatgpt:c-1' }), plan, draft: 'x', model: null, basis: 1, created: '2026-10-16' }), /^---\nsource: chatgpt\nconversation: "chatgpt:c-1"\n/);
});

const MSGS = [
  { role: 'user', text: 'Plan the placeholder release for project-a', is_sidechain: 0, at: '2026-10-01T23:30:00.000Z' },
  { role: 'assistant', text: 'Plan: freeze, test, tag. See https://example.org/release', is_sidechain: 0, at: '2026-10-01T23:31:00.000Z' },
  { role: 'user', text: 'Decision: ship Friday', is_sidechain: 0, at: '2026-10-01T23:32:00.000Z' },
];
function hubFor(convs, { projects = [{ id: 'code:p-a', name: 'project-a' }], fail = {} } = {}) {
  const calls = [];
  return { calls, request: async (op, args, opts) => {
    calls.push({ op, args, opts });
    if (fail[op]) return { error: fail[op] };
    if (op === 'getConversation') { const c = convs[args.id]; return c ? { conversation: c, messages: MSGS, hasMore: false } : null; }
    if (op === 'listProjects') return projects;
    return { error: 'unknown op' };
  } };
}
const DRAFT = '## Summary\nThe placeholder release ships Friday.\n\n## Decisions\n- ship Friday\n\n## To-dos\n- [ ] tag\n\n## Links\n- https://example.org/release\n';
function llmFake(answer = { status: 'done', output: DRAFT, model: 'placeholder-model' }) {
  const calls = [];
  return { calls, run: async (a) => { calls.push(a); return answer; } };
}
const NOW = () => new Date('2026-10-16T10:00:00.000Z');
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

test('preview: the local model drafts a note from the Hub’s copy of the chat; nothing is written', async () => {
  const vault = tmpVault();
  try {
    const llm = llmFake();
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm, vaultDir: vault, dataDir: vault, now: NOW });
    const before = tree(vault);
    const p = await v.preview('code:s-1');
    assert.equal(p.error, undefined, p.error);
    assert.equal(p.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning.md');
    assert.equal(p.path, path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md'));
    assert.equal(p.exists, false);
    assert.equal(p.model, 'placeholder-model');
    assert.equal(p.basis, 3);
    assert.ok(p.markdown.startsWith('---\nsource: claude-code\nconversation: "code:s-1"\nproject: "[[project-a]]"\ncreated: 2026-10-16\n'));
    assert.ok(p.markdown.includes('## Decisions\n- ship Friday'));
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].system, V.DRAFT_SYSTEM);
    assert.match(llm.calls[0].prompt, /Owner: Decision: ship Friday$/);
    assert.deepEqual(tree(vault), before, 'preview writes nothing');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('preview → save → preview says exists → save without Replace is refused, the note untouched → Replace overwrites (Review Focus 5)', async () => {
  const vault = tmpVault();
  try {
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const p = await v.preview('code:s-1');
    assert.equal(await v.save({ path: p.path, markdown: p.markdown + '\nmy edit\n' }), true);
    const file = path.join(vault, ...p.rel.split('/'));
    assert.ok(fs.readFileSync(file, 'utf8').endsWith('my edit\n'), 'the owner’s edit is what lands');
    const again = await v.preview('code:s-1');
    assert.equal(again.rel, p.rel); assert.equal(again.exists, true);
    const first = fs.readFileSync(file);
    assert.deepEqual(await v.save({ path: again.path, markdown: again.markdown }), { error: 'a note with this name is already there', exists: true });
    assert.deepEqual(fs.readFileSync(file), first, 'byte-identical after the refusal');
    assert.equal(await v.save({ path: again.path, markdown: again.markdown, replace: true }), true);
    assert.equal(fs.readFileSync(file, 'utf8'), again.markdown);
    assert.deepEqual(tmps(path.dirname(file)), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('another chat’s note of the same name: preview takes " (2)"; Replace aimed at it is refused (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const hub = hubFor({ 'code:s-1': conv(), 'code:s-2': conv({ id: 'code:s-2' }) });
    const v = V.createVault({ hub, llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const a = await v.preview('code:s-1');
    assert.equal(await v.save({ path: a.path, markdown: a.markdown }), true);
    const b = await v.preview('code:s-2');
    assert.equal(b.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning (2).md');
    assert.equal(b.exists, false);
    const aBytes = fs.readFileSync(a.path);
    const r = await v.save({ path: a.path, markdown: b.markdown, replace: true });
    assert.match(r.error, /belongs to another chat/);
    assert.deepEqual(fs.readFileSync(a.path), aBytes);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('save refuses: paths outside 30_Areas/Claude, a note without its conversation line, too big, not text (Review Focus 4)', async () => {
  const vault = tmpVault();
  try {
    const v = V.createVault({ hub: hubFor({}), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const md = noteFor('code:s-1');
    for (const p of ['30_Areas/Projects/x.md', '30_Areas/Claude/../../x.md', path.join(os.tmpdir(), 'x.md'), '30_Areas/Claude/a/b/x.md']) {
      const r = await v.save({ path: p, markdown: md });
      assert.ok(r && typeof r.error === 'string', p);
    }
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: '# no frontmatter' })).error, /conversation/);
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: md + 'x'.repeat(V.NOTE_MAX) })).error, /too long/);
    assert.match((await v.save({ path: '30_Areas/Claude/p/x.md', markdown: 42 })).error, /no note text/);
    assert.match((await v.save(null)).error, /no note/);
    assert.deepEqual(tree(vault).filter((f) => f.endsWith('.md')), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('preview errors say why and write nothing: Hub down, chat gone, Hub error, model offline, model failed', async () => {
  const vault = tmpVault();
  try {
    const mk = (hub, llm = llmFake()) => V.createVault({ hub, llm, vaultDir: vault, dataDir: vault, now: NOW });
    assert.match((await mk(null).preview('code:s-1')).error, /Claude Hub is not running/);
    assert.match((await mk(hubFor({}, { fail: { getConversation: 'hub not running' } })).preview('code:s-1')).error, /Claude Hub is not running/);
    assert.match((await mk(hubFor({})).preview('code:s-1')).error, /not in the Claude Hub index/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }, { fail: { listProjects: 'no such table: project' } })).preview('code:s-1')).error, /no such table: project/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }), llmFake({ status: 'unavailable', reason: 'no local LLM runtime up on :11434 or :1234' })).preview('code:s-1')).error, /local model isn’t running.*11434/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() }), llmFake({ status: 'error', reason: 'empty response from model' })).preview('code:s-1')).error, /local model failed: empty response/);
    assert.match((await mk(hubFor({ 'code:s-1': conv() })).preview('')).error, /no chat/);
    const gone = V.createVault({ hub: hubFor({ 'code:s-1': conv() }), llm: llmFake(), vaultDir: path.join(vault, 'missing'), dataDir: vault, now: NOW });
    assert.match((await gone.preview('code:s-1')).error, /vault folder was not found/);
    assert.deepEqual(tree(vault), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('a chat linked to a WorkspaceHQ project links that project’s note', async () => {
  const vault = tmpVault();
  try {
    fs.writeFileSync(path.join(vault, 'latest.json'), JSON.stringify({ projects: [{ id: 'hq-1', name: 'Kitchen: B' }] }));
    assert.equal(V.hqProjectName(vault, 'hq-1'), 'Kitchen: B');
    assert.equal(V.hqProjectName(vault, 'nope'), null);
    assert.equal(V.hqProjectName(path.join(vault, 'missing'), 'hq-1'), null);
    // the link is on the PROJECT row (listProjects p.hq_project_id); H1's getConversation row has no hq_project_id column
    const v = V.createVault({ hub: hubFor({ 'code:s-1': conv() }, { projects: [{ id: 'code:p-a', name: 'project-a', hq_project_id: 'hq-1' }] }), llm: llmFake(), vaultDir: vault, dataDir: vault, now: NOW });
    const p = await v.preview('code:s-1');
    assert.match(p.markdown, /\nproject: "\[\[Kitchen- B\]\]"\n/);
    assert.equal(p.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning.md', 'the folder stays the Claude project');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('init: exactly two channels; HQ_VAULT_DIR wins; handlers never throw', async () => {
  const vault = tmpVault();
  const saved = process.env.HQ_VAULT_DIR;
  try {
    process.env.HQ_VAULT_DIR = vault;
    const handlers = {};
    V.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, hub: hubFor({ 'code:s-1': conv() }), dataDir: vault, vaultDir: path.join(vault, 'NOT-THIS-ONE'), llm: llmFake() });
    assert.deepEqual(Object.keys(handlers).sort(), ['hq:claude-vault:preview', 'hq:claude-vault:save']);
    const p = await handlers['hq:claude-vault:preview']({}, 'code:s-1');
    assert.ok(p.path.startsWith(vault), p.path);
    assert.equal(await handlers['hq:claude-vault:save']({}, { path: p.path, markdown: p.markdown }), true);
    assert.ok(fs.existsSync(path.join(vault, ...p.rel.split('/'))));
    assert.ok(typeof (await handlers['hq:claude-vault:save']({}, undefined)).error === 'string');
    assert.ok(typeof (await handlers['hq:claude-vault:preview']({}, { not: 'a string' })).error === 'string');
  } finally {
    if (saved === undefined) delete process.env.HQ_VAULT_DIR; else process.env.HQ_VAULT_DIR = saved;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
