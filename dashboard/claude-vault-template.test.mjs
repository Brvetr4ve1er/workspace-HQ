// node --test dashboard/claude-vault-template.test.mjs
// Save to vault with no local model (batch 3). Every test writes into a fresh mkdtemp "vault" through HQ_VAULT_DIR; the owner's
// vault is never touched. A fake Hub and a fake llm with a call spy stand in for both; placeholder chat text only.
//
// Two layers:
//   1. chooseDraft (dashboard/vault-draft.mjs), the preview() decision: model first, template when none runs, template when forced,
//      a model that ran and failed keeps its error. Runs always.
//   2. claude-vault.js end to end through its IPC handlers (init). These need the shared edit that wires chooseDraft into preview();
//      until it lands they are SKIPPED, loudly, with the reason. The Save-side cases (one note, only on Save, exists, Replace only
//      for the same chat) run either way: before the edit on a note built by hand the way noteText will build it, after it on the
//      note preview() really returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chooseDraft, templateDraft, draftedBy, NO_MESSAGES } from './vault-draft.mjs';

process.env.TZ = 'UTC';
const require = createRequire(import.meta.url);
const V = require('./claude-vault.js');

const tmpVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vault-tpl-'));
const conv = (extra = {}) => ({ id: 'code:s-1', source: 'code', title: 'Release planning', started_at: '2026-10-01T10:00:00.000Z', last_at: '2026-10-02T09:00:00.000Z', project_id: 'code:p-a', ...extra });
const CHAT = [
  { role: 'user', text: 'Plan the placeholder release.' },
  { role: 'assistant', text: 'Here is a plan.' },
  { role: 'user', text: 'Add a rollback step.' },
  { role: 'assistant', text: 'Added: tag first, then ship.\nRollback is one command.' },
];
const spyLlm = (answer) => { const calls = []; return { calls, run: async (a) => { calls.push(a); return typeof answer === 'function' ? answer(a) : answer; } }; };
const MODEL_OFF = { status: 'unavailable', reason: 'no runtime', output: '' };
const prompt = (basis = 4) => ({ system: 'sys', prompt: 'p', basis });
const walk = (dir) => fs.readdirSync(dir, { recursive: true });
const notes = (vault) => walk(vault).filter((f) => String(f).endsWith('.md')).map(String);

// ---- layer 1: the decision ----------------------------------------------------------------------------------------------

test('a model that answers is used: drafted model, no template', async () => {
  const llm = spyLlm({ status: 'done', output: '## Summary\nok', model: 'fake-model' });
  const r = await chooseDraft({ llm, modelPrompt: prompt(), conversation: conv(), messages: CHAT });
  assert.deepEqual(r, { drafted: 'model', output: '## Summary\nok', model: 'fake-model', basis: 4 });
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].timeoutMs, 120000);
});

test('no model running (unavailable): the template answers instead of an error, and says why', async () => {
  const llm = spyLlm(MODEL_OFF);
  const r = await chooseDraft({ llm, modelPrompt: prompt(), conversation: conv(), messages: CHAT });
  assert.equal(r.error, undefined);
  assert.equal(r.drafted, 'template');
  assert.equal(r.model, null);
  assert.equal(r.basis, 4);
  assert.equal(r.modelUnavailable, true);
  assert.equal(r.modelReason, 'no runtime');
  assert.equal(r.output, templateDraft(conv(), CHAT).body);
  assert.equal(llm.calls.length, 1, 'the model was asked once first');
});

test('a model that RAN and failed keeps its error: no silent template', async () => {
  for (const answer of [{ status: 'error', reason: 'HTTP 500' }, { status: 'error', reason: 'empty response from model' }, { status: 'error', reason: 'cancelled' }, { status: 'cancelled' }, undefined, null, {}]) {
    const r = await chooseDraft({ llm: spyLlm(answer), modelPrompt: prompt(), conversation: conv(), messages: CHAT });
    assert.equal(r.drafted, undefined, JSON.stringify(answer));
    assert.match(r.error, /^the local model failed: /, JSON.stringify(answer));
  }
  assert.equal((await chooseDraft({ llm: spyLlm({ status: 'error', reason: 'HTTP 500' }), modelPrompt: prompt(), conversation: conv(), messages: CHAT })).error, 'the local model failed: HTTP 500');
  assert.equal((await chooseDraft({ llm: spyLlm(null), modelPrompt: prompt(), conversation: conv(), messages: CHAT })).error, 'the local model failed: no answer');
});

test('template:true never reaches the llm: the spy sees zero calls, even with a model that would answer', async () => {
  const llm = spyLlm({ status: 'done', output: 'MODEL', model: 'm' });
  const r = await chooseDraft({ llm, modelPrompt: prompt(), conversation: conv(), messages: CHAT, template: true });
  assert.equal(llm.calls.length, 0);
  assert.equal(r.drafted, 'template');
  assert.equal(r.modelUnavailable, undefined, 'forced is not "unavailable"');
  assert.ok(!r.output.includes('MODEL'));
  const throwing = { run: () => { throw new Error('the llm module must not be touched'); } };
  assert.equal((await chooseDraft({ llm: throwing, modelPrompt: prompt(), conversation: conv(), messages: CHAT, template: true })).drafted, 'template');
  assert.equal((await chooseDraft({ llm: throwing, modelPrompt: prompt(), conversation: conv(), messages: CHAT, template: true, day: '2026-10-01' })).output.endsWith('4 messages · chat of 2026-10-01\n'), true);
});

test('only a strict true forces the template', async () => {
  for (const v of ['true', 1, {}, 'yes']) {
    const llm = spyLlm({ status: 'done', output: 'M', model: 'm' });
    const r = await chooseDraft({ llm, modelPrompt: prompt(), conversation: conv(), messages: CHAT, template: v });
    assert.equal(r.drafted, 'model', String(v));
    assert.equal(llm.calls.length, 1);
  }
});

test('a chat with nothing to summarise errors on every path and never calls the model', async () => {
  for (const template of [false, true]) {
    const llm = spyLlm(MODEL_OFF);
    assert.deepEqual(await chooseDraft({ llm, modelPrompt: { system: 's', prompt: 'p', basis: 0 }, conversation: conv(), messages: [], template }), { error: NO_MESSAGES });
    assert.equal(llm.calls.length, 0);
  }
});

// ---- layer 2: claude-vault.js through its IPC handlers -----------------------------------------------------------------

function harness({ vault, chat = CHAT, c = conv(), llm = spyLlm(MODEL_OFF), projects = [{ id: 'code:p-a', name: 'project-a' }] } = {}) {
  const handlers = {};
  const hub = { request: async (op) => (op === 'getConversation' ? { conversation: c, messages: chat } : op === 'listProjects' ? projects : null) };
  const prev = process.env.HQ_VAULT_DIR;
  process.env.HQ_VAULT_DIR = vault;                       // init() reads it once, at call time
  try { V.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, hub, dataDir: path.join(vault, '.no-data'), vaultDir: path.join(vault, '.not-used'), llm }); }
  finally { if (prev === undefined) delete process.env.HQ_VAULT_DIR; else process.env.HQ_VAULT_DIR = prev; }
  return { llm, preview: (arg) => handlers['hq:claude-vault:preview']({}, arg), save: (req) => handlers['hq:claude-vault:save']({}, req) };
}

// has the shared edit (preview() falling back to the template, honouring { id, template:true }) landed in claude-vault.js?
const LANDED = await (async () => {
  const vault = tmpVault();
  try { const r = await harness({ vault }).preview({ id: 'code:s-1', template: true }); return !!(r && r.drafted === 'template'); }
  catch { return false; } finally { fs.rmSync(vault, { recursive: true, force: true }); }
})();
const needsEdit = LANDED ? false : 'skipped: the shared edit to dashboard/claude-vault.js (preview falls back to templateDraft) has not landed';
if (!LANDED) console.log('# ' + needsEdit);

// the note Save is given: the real preview's when the edit has landed, else built by hand the way noteText will build it
async function templateNote(h, vault, c = conv()) {
  if (LANDED) { const r = await h.preview({ id: c.id, template: true }); assert.equal(r.error, undefined); return { rel: r.rel, markdown: r.markdown, path: r.path }; }
  const plan = V.planNote({ conversation: c, projectName: 'project-a', now: new Date('2026-10-16T10:00:00Z') });
  const t = templateDraft(c, CHAT, { day: plan.day });
  const markdown = V.noteText({ conversation: c, plan, draft: t.body, model: 'x', basis: t.basis, created: '2026-10-16' })
    .replace(/^drafted_by: .*$/m, 'drafted_by: ' + JSON.stringify(draftedBy(t.basis)));
  return { rel: plan.rel, markdown, path: path.join(vault, ...plan.rel.split('/')) };
}

test('model unavailable: preview answers a template draft, not an error, and writes nothing', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const h = harness({ vault });
    const r = await h.preview('code:s-1');
    assert.equal(r.error, undefined);
    assert.equal(r.drafted, 'template');
    assert.equal(r.model, null);
    assert.equal(r.basis, 4);
    assert.equal(r.rel, '30_Areas/Claude/project-a/2026-10-01 Release planning.md');
    assert.equal(r.exists, false);
    assert.equal(V.frontConversation(r.markdown), 'code:s-1');
    assert.match(r.markdown, /^drafted_by: "a template, no model, from 4 chat messages"$/m);
    assert.ok(!/local model/.test(r.markdown), 'the note never claims a model');
    assert.match(r.markdown, /## Opening request\n\n> Plan the placeholder release\./);
    assert.match(r.markdown, /## Where it ended\n\n> Added: tag first, then ship\.\n> Rollback is one command\./);
    assert.deepEqual(notes(vault), [], 'preview wrote nothing');
    assert.deepEqual(walk(vault), [], 'not even a folder');
    assert.equal(h.llm.calls.length, 1);
    assert.equal(r.modelUnavailable, true);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('a model that answers keeps the unchanged output (drafted model); one that ran and failed keeps its error', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const ok = harness({ vault, llm: spyLlm({ status: 'done', output: '## Summary\nA model summary.', model: 'fake-model' }) });
    const r = await ok.preview('code:s-1');
    assert.equal(r.drafted, 'model');
    assert.equal(r.model, 'fake-model');
    assert.match(r.markdown, /^drafted_by: "local model fake-model, from 4 chat messages"$/m);
    assert.ok(r.markdown.includes('A model summary.'));
    const bad = harness({ vault, llm: spyLlm({ status: 'error', reason: 'HTTP 500' }) });
    assert.equal((await bad.preview('code:s-1')).error, 'the local model failed: HTTP 500');
    assert.deepEqual(walk(vault), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('{ id, template:true } never calls llm.run; the plain id string is still accepted', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const llm = spyLlm({ status: 'done', output: 'MODEL', model: 'm' });
    const h = harness({ vault, llm });
    const r = await h.preview({ id: 'code:s-1', template: true });
    assert.equal(llm.calls.length, 0);
    assert.equal(r.drafted, 'template');
    assert.ok(!r.markdown.includes('MODEL'));
    assert.equal((await h.preview('code:s-1')).drafted, 'model', 'a model that answers is still preferred for the plain call');
    assert.equal(llm.calls.length, 1);
    for (const bad of [{ template: true }, { id: 7, template: true }, null, 42, '']) assert.ok((await h.preview(bad)).error, JSON.stringify(bad));
    assert.equal(llm.calls.length, 1, 'a refused argument never reaches the model either');
    assert.deepEqual(walk(vault), []);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('an empty chat answers the existing "no messages" error through preview, on both paths', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const h = harness({ vault, chat: [{ role: 'tool', text: 'only a tool row' }] });
    assert.equal((await h.preview('code:s-1')).error, NO_MESSAGES);
    assert.equal((await h.preview({ id: 'code:s-1', template: true })).error, NO_MESSAGES);
    assert.equal(h.llm.calls.length, 0);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('Save writes exactly one note under 30_Areas/Claude/<Project>/, only when called; a second Save without replace answers exists', async () => {
  const vault = tmpVault();
  try {
    const h = harness({ vault });
    const n = await templateNote(h, vault);
    assert.deepEqual(walk(vault), [], 'nothing on disk before Save');
    assert.equal(await h.save({ path: n.rel, markdown: n.markdown }), true);
    assert.deepEqual(notes(vault), ['30_Areas\\Claude\\project-a\\2026-10-01 Release planning.md'].map((p) => p.split('\\').join(path.sep)));
    const file = path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Release planning.md');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, n.markdown, 'the note is exactly what Save was given');
    assert.equal(V.frontConversation(text), 'code:s-1', 'the frontmatter keeps conversation:');
    assert.match(text, /^drafted_by: "a template, no model, from 4 chat messages"$/m);
    assert.equal(walk(vault).filter((f) => String(f).endsWith('.tmp')).length, 0, 'no temp litter');

    const again = await h.save({ path: n.rel, markdown: n.markdown });
    assert.equal(again.exists, true);
    assert.match(again.error, /already there/);
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'byte-identical after the refusal');
    assert.equal(notes(vault).length, 1);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('Replace works only for the same chat’s own note', async () => {
  const vault = tmpVault();
  try {
    const h = harness({ vault });
    const n = await templateNote(h, vault);
    assert.equal(await h.save({ path: n.rel, markdown: n.markdown }), true);
    const file = path.join(vault, ...n.rel.split('/'));
    // the same chat replaces its own note (an edited template draft)
    const edited = n.markdown + '\nMy own line.\n';
    assert.equal(await h.save({ path: n.rel, markdown: edited, replace: true }), true);
    assert.equal(fs.readFileSync(file, 'utf8'), edited);
    // another chat's markdown cannot replace it
    const other = n.markdown.replace('conversation: "code:s-1"', 'conversation: "code:s-2"');
    const refused = await h.save({ path: n.rel, markdown: other, replace: true });
    assert.match(refused.error, /belongs to another chat/);
    assert.equal(fs.readFileSync(file, 'utf8'), edited, 'untouched');
    // a note the owner wrote (no frontmatter) is never replaced either
    const hand = path.join(vault, '30_Areas', 'Claude', 'project-a', '2026-10-01 Hand.md');
    fs.writeFileSync(hand, '# my own note\n');
    const handRel = '30_Areas/Claude/project-a/2026-10-01 Hand.md';
    assert.match((await h.save({ path: handRel, markdown: n.markdown, replace: true })).error, /belongs to another chat/);
    assert.equal(fs.readFileSync(hand, 'utf8'), '# my own note\n');
    // a template note that lost its conversation: line is refused before anything is written
    const lost = n.markdown.replace(/^conversation: .*\n/m, '');
    assert.match((await h.save({ path: n.rel, markdown: lost, replace: true })).error, /conversation:/);
    assert.equal(fs.readFileSync(file, 'utf8'), edited);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('after a template note is saved, a new preview offers Replace for the same chat (exists) instead of a second note', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const h = harness({ vault });
    const n = await templateNote(h, vault);
    assert.equal(await h.save({ path: n.rel, markdown: n.markdown }), true);
    const r = await h.preview('code:s-1');
    assert.equal(r.exists, true);
    assert.equal(r.rel, n.rel);
    assert.equal(notes(vault).length, 1);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('a secret in the chat never reaches the saved template note', { skip: needsEdit }, async () => {
  const vault = tmpVault();
  try {
    const key = 'sk-ant-' + 'q7'.repeat(15);
    const h = harness({ vault, chat: [{ role: 'user', text: 'my key is ' + key }, { role: 'assistant', text: 'do not paste ' + key + ' again' }] });
    const n = await templateNote(h, vault);
    assert.ok(!n.markdown.includes(key));
    assert.equal(await h.save({ path: n.rel, markdown: n.markdown }), true);
    assert.ok(!fs.readFileSync(path.join(vault, ...n.rel.split('/')), 'utf8').includes(key));
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
