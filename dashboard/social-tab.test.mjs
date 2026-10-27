// dashboard/social-tab.test.mjs
// Social tab › Vault (IPC-CONTRACT 2026-10-27). Every test works in a fresh mkdtemp "vault"; the owner's VEEMO CORTEX
// is never touched. Placeholder titles only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSocialVault } = require('./social-tab.js');

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-social-vault-'));
  const w = (rel, text, mtime) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); if (mtime) fs.utimesSync(f, mtime, mtime); };
  return { root, w };
}
const make = (root, o = {}) => {
  const calls = [];
  const v = createSocialVault({ vaultDir: root, openExternal: async (u) => calls.push(['ext', u]), openPath: async (p) => { calls.push(['path', p]); return ''; }, protocolName: () => 'Obsidian', now: () => new Date('2026-10-27T10:00:00Z'), ...o });
  return { v, calls };
};

test('list: notes under 30_Areas/Social (2 deep) + 00_Inbox/Social *.md, newest first, titles from front matter', async () => {
  const { root, w } = vault();
  w('30_Areas/Social/Plan.md', '---\ntitle: "Posting plan"\n---\n# x', new Date('2026-10-20'));
  w('30_Areas/Social/Instagram/Ideas.md', '# no front matter', new Date('2026-10-25'));
  w('30_Areas/Social/a/b/c/Too deep.md', 'x');
  w('30_Areas/Social/readme.txt', 'not a note');
  w('00_Inbox/Social Profile — Example.md', '---\ntitle: Social Profile — Example\n---', new Date('2026-10-26'));
  w('00_Inbox/Other note.md', 'not social');
  w('30_Areas/Projects/Unrelated.md', 'x');
  const l = await make(root).v.list();
  assert.equal(l.vault, path.basename(root));
  assert.equal(l.folder, '30_Areas/Social');
  assert.equal(l.exists, true);
  assert.equal(l.obsidian, true);
  assert.deepEqual(l.notes.map((n) => [n.rel, n.title, n.where]), [
    ['00_Inbox/Social Profile — Example.md', 'Social Profile — Example', 'inbox'],
    ['30_Areas/Social/Instagram/Ideas.md', 'Ideas', 'social'],
    ['30_Areas/Social/Plan.md', 'Posting plan', 'social'],
  ]);
});

test('list: no Social folder yet is not an error; a missing vault is', async () => {
  const { root } = vault();
  const l = await make(root).v.list();
  assert.equal(l.exists, false);
  assert.deepEqual(l.notes, []);
  const gone = await make(path.join(root, 'nope')).v.list();
  assert.match(gone.error, /not there/);
});

test('open: only a listed note; Obsidian link uses the vault basename and the rel without .md; dry launch logs', async () => {
  const { root, w } = vault();
  w('30_Areas/Social/Plan.md', 'x');
  const { v, calls } = make(root);
  assert.deepEqual(await v.open('30_Areas/Social/Plan.md', 'obsidian'), { ok: true, how: 'obsidian' });
  assert.equal(calls[0][1], 'obsidian://open?vault=' + encodeURIComponent(path.basename(root)) + '&file=' + encodeURIComponent('30_Areas/Social/Plan'));
  assert.deepEqual(await v.open('30_Areas/Social/Plan.md', 'file'), { ok: true, how: 'file' });
  assert.equal(calls[1][1], path.join(root, '30_Areas', 'Social', 'Plan.md'));
  assert.match((await v.open('30_Areas/Projects/Other.md', 'file')).error, /not in the Social notes/);
  assert.match((await v.open('../../etc/hosts', 'file')).error, /not in the Social notes/);
  assert.match((await v.open('30_Areas/Social/Plan.md', 'browser')).error, /only in Obsidian or as a file/);
  const logs = [];
  const d = make(root, { env: { HQ_DRY_LAUNCH: '1' }, log: (s) => logs.push(s) });
  assert.equal((await d.v.open('30_Areas/Social/Plan.md', 'obsidian')).dry, true);
  assert.equal(d.calls.length, 0);
  assert.match(logs[0], /\[dry-open\] obsidian 30_Areas\/Social\/Plan\.md/);
  const noObs = make(root, { protocolName: () => '' });
  assert.match((await noObs.v.open('30_Areas/Social/Plan.md', 'obsidian')).error, /Obsidian is not installed/);
});

test('save: one new note in 30_Areas/Social with front matter; never over an existing note; checks title/body', async () => {
  const { root } = vault();
  const { v } = make(root);
  const r = await v.save({ title: 'Launch: week 1?', body: 'Line one\r\nLine two' });
  assert.deepEqual(r, { rel: '30_Areas/Social/Launch- week 1-.md' });
  const text = fs.readFileSync(path.join(root, '30_Areas', 'Social', 'Launch- week 1-.md'), 'utf8');
  assert.equal(text, '---\ntitle: "Launch: week 1?"\ntype: note\ntags: [social]\ncreated: 2026-10-27\nsource: WorkspaceHQ\n---\n\n# Launch: week 1?\n\nLine one\nLine two\n');
  const again = await v.save({ title: 'Launch: week 1?', body: 'other' });
  assert.equal(again.exists, true);
  assert.match(fs.readFileSync(path.join(root, '30_Areas', 'Social', 'Launch- week 1-.md'), 'utf8'), /Line one/);
  assert.match((await v.save({ title: '  ', body: 'x' })).error, /title/);
  assert.match((await v.save({ title: 'x'.repeat(61), body: '' })).error, /longer than 60/);
  assert.match((await v.save({ title: 'Big', body: 'x'.repeat(50001) })).error, /longer than 50000/);
  assert.deepEqual(fs.readdirSync(path.join(root, '30_Areas', 'Social')).filter((f) => f.endsWith('.tmp')), []);
  const listed = await v.list();
  assert.deepEqual(listed.notes.map((n) => n.title), ['Launch: week 1?']);
});

test('openSite: only the listed platform literals; Mastodon and junk are refused; dry launch logs', async () => {
  const { root } = vault();
  const { v, calls } = make(root);
  assert.deepEqual(await v.openSite('bluesky'), { ok: true });
  assert.deepEqual(calls, [['ext', 'https://bsky.app/']]);
  for (const bad of ['mastodon', 'https://evil.example/', '__proto__', 'constructor', null, 7]) assert.match((await v.openSite(bad)).error, /refused/);
  assert.equal(calls.length, 1);
  const logs = [];
  const d = make(root, { env: { HQ_DRY_LAUNCH: '1' }, log: (s) => logs.push(s) });
  assert.equal((await d.v.openSite('youtube')).dry, true);
  assert.equal(d.calls.length, 0);
  assert.deepEqual(logs, ['[dry-open] site https://www.youtube.com/']);
});

test('cancel (Inbox Discard): staged → canceled only; sending / sent / unknown refused and the file left byte-identical', () => {
  const { createCancel } = require('./social-tab.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-social-discard-'));
  fs.mkdirSync(path.join(dir, 'social'));
  const file = path.join(dir, 'social', 'outbox.json');
  const seed = { updated: '2026-01-01T00:00:00.000Z', actions: [
    { id: 'a-staged', platform: 'bluesky', op: 'post', text: 'placeholder', status: 'staged' },
    { id: 'a-sending', platform: 'bluesky', op: 'post', text: 'placeholder', status: 'sending' },
    { id: 'a-sent', platform: 'bluesky', op: 'post', text: 'placeholder', status: 'sent' }] };
  fs.writeFileSync(file, JSON.stringify(seed, null, 2));
  const cancel = createCancel(dir);
  const before = fs.readFileSync(file, 'utf8');
  assert.deepEqual(cancel('a-sending'), { error: 'already publishing', status: 'sending' });
  assert.deepEqual(cancel('a-sent'), { error: 'not staged', status: 'sent' });
  assert.deepEqual(cancel('nope'), { error: 'unknown action id', status: undefined });
  assert.deepEqual(cancel(''), { error: 'id required', status: undefined });
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'refusals leave the file untouched');
  assert.deepEqual(cancel('a-staged'), { ok: true, id: 'a-staged', status: 'canceled' });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.actions.map((a) => a.status), ['canceled', 'sending', 'sent']);
  assert.ok(after.actions[0].canceled_at && !after.actions[0].sent_at && !after.actions[0].result);
  assert.deepEqual(cancel('a-staged'), { error: 'not staged', status: 'canceled' }, 'a second click finds it already canceled');
});
