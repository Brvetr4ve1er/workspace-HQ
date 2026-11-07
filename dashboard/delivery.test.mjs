// Client delivery, main side (dashboard/delivery.js): intents, atomic writes, quarantine, read-only file sources.
// Temp dirs and a fake resolver only; placeholder data — the repo is public.
//   node --test dashboard/delivery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const delivery = require('./delivery.js');
const NOW = new Date('2026-11-07T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dlv-'));

// one scanned project (alpha-site) whose folder is a temp dir, one without a folder
function make(o = {}) {
  const dataDir = tmp(), root = tmp();
  fs.writeFileSync(path.join(root, 'SCOPE.md'), o.scope === undefined ? '## Design\n- [x] home page\n- [ ] gallery\n## Launch\n- [ ] go live\n' : o.scope);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'plan.md'), '## M\n- [x] a\n- [ ] b\n- [ ] c\n');
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify({ projects: [
    { id: 'alpha-site', name: 'Alpha Site', path: 'C:/work/alpha-site', metrics: { git_safety: { remote: 'github.com/alpha/site' } } },
    { id: 'ghost', name: 'Ghost', path: 'C:/work/ghost', metrics: { git_safety: {} } },
  ] }));
  if (o.accounts !== null) fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify(o.accounts || { vercel: { projects: [{ name: 'alpha-site', repo: 'alpha/site' }],
    deploys: [{ project: 'alpha-site', target: 'preview', state: 'ready', at: '2026-11-07T08:00:00Z', url: 'https://alpha-site-abc.vercel.app', branch: 'feat' }] } }));
  const resolve = (p) => (p === 'C:/work/alpha-site' ? root : null);
  let n = 0;
  const d = delivery.create({ dataDir, resolveProjectPath: resolve, now: () => NOW, newId: () => 'n' + ++n });
  return { d, dataDir, root };
}
const snap = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);

test('an unmarked project: mode none, the repo\'s checklist files are listed, nothing is picked for the owner', async () => {
  const { d } = make();
  const v = await d.read('alpha-site');
  assert.deepEqual([v.client, v.mode, v.source, v.total], [false, 'none', 'none', 0]);
  assert.deepEqual(v.candidates.map((c) => c.rel), ['SCOPE.md', 'docs/plan.md']);
  assert.equal(v.link.kind, 'preview');
  assert.equal(v.update, '');
});

test('plan mode: picking a listed file on an unmarked project shows its counts, no update text', async () => {
  const { d } = make();
  const v = await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: 'docs/plan.md' });
  assert.deepEqual([v.mode, v.client, v.done, v.total, v.summary, v.sourceLabel, v.sourceNote, v.update], ['plan', false, 1, 3, '1 of 3 done', 'docs/plan.md', 'a plan checklist, not the quote', '']);
  const cleared = await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: null });
  assert.equal(cleared.mode, 'none');
});

test('client mode defaults to SCOPE.md at the root, builds the update, and copied records what was done', async () => {
  const { d, dataDir } = make();
  const v = await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  assert.deepEqual([v.mode, v.source, v.scopeFile, v.done, v.total, v.sourceNote], ['client', 'file', 'SCOPE.md', 1, 3, '']);
  assert.match(v.update, /^Alpha Site — update 7 Nov · Done so far: home page · Still to do \(2 of 3\): gallery; go live · Preview: https:\/\/alpha-site-abc\.vercel\.app \(ready, 2 h ago\)$/);
  const after = await d.apply({ type: 'copied', projectId: 'alpha-site' });
  assert.equal(after.lastCopyAt, NOW.toISOString());
  assert.deepEqual(after.doneSince, []);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'delivery.json'), 'utf8'));
  assert.equal(saved.projects['alpha-site'].lastCopy.doneHashes.length, 1);
});

test('the renderer cannot smuggle its own doneHashes into copied', async () => {
  const { d, dataDir } = make();
  await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  await d.apply({ type: 'copied', projectId: 'alpha-site', doneHashes: ['deadbeef', 'cafef00d'] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'delivery.json'), 'utf8')).projects['alpha-site'].lastCopy.doneHashes.length, 1);
});

test('a checklist kept in the app: add, toggle, remove; ids are minted in main', async () => {
  const t = make();
  fs.rmSync(path.join(t.root, 'SCOPE.md'));
  let v = await t.d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  assert.deepEqual([v.source, v.total], ['none', 0]);
  assert.equal(v.candidates.length, 1);   // docs/plan.md is offered, not adopted
  v = await t.d.apply({ type: 'item-add', projectId: 'alpha-site', text: 'home page', milestone: 'Design', id: 'evil', done: true });
  assert.deepEqual([v.source, v.total, v.done], ['app', 1, 0]);
  assert.equal(v.milestones[0].items[0].id, 'i-n1');
  v = await t.d.apply({ type: 'item-toggle', projectId: 'alpha-site', id: 'i-n1' });
  assert.deepEqual([v.done, v.total], [1, 1]);
  assert.match(v.update, /Everything in the agreed scope is done/);
  v = await t.d.apply({ type: 'item-remove', projectId: 'alpha-site', id: 'i-n1' });
  assert.deepEqual([v.total, v.source], [0, 'none']);
});

test('intents are validated: unknown project, unknown type, oversize, text over 200, more than 200 items', async () => {
  const { d } = make();
  assert.match((await d.apply({ type: 'mark-client', projectId: 'nope', on: true })).error, /not in the current scan/);
  assert.match((await d.read('nope')).error, /not in the current scan/);
  assert.equal((await d.apply({ type: 'format-disk', projectId: 'alpha-site' })).error, 'unknown action.');
  assert.equal((await d.apply(null)).error, 'unknown action.');
  assert.equal((await d.apply([1])).error, 'unknown action.');
  await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  assert.equal((await d.apply({ type: 'item-add', projectId: 'alpha-site', text: 'x', pad: 'p'.repeat(17000) })).error, 'unknown action.');
  assert.match((await d.apply({ type: 'item-add', projectId: 'alpha-site', text: 'x'.repeat(201) })).error, /200 characters/);
  for (let i = 0; i < 200; i++) assert.equal((await d.apply({ type: 'item-add', projectId: 'alpha-site', text: 'item ' + i })).error, undefined);
  assert.match((await d.apply({ type: 'item-add', projectId: 'alpha-site', text: 'one more' })).error, /at most 200/);
  assert.match((await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: '../escape.md' })).error, /not picked/);
  assert.match((await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: 'docs/missing.md' })).error, /not found/);
  assert.match((await d.apply({ type: 'set-scope-file', projectId: 'ghost', rel: 'SCOPE.md' })).error, /not picked/);   // a project whose folder the app may not read
});

test('a file source is read-only: the repo\'s bytes are unchanged after reads and writes', async () => {
  const { d, root } = make();
  const before = snap(root);
  await d.read('alpha-site');
  await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: 'docs/plan.md' });
  await d.apply({ type: 'copied', projectId: 'alpha-site' });
  assert.deepEqual(snap(root), before);
});

test('file problems are named, never hidden: missing and too big', async () => {
  const { d, root } = make();
  await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  await d.apply({ type: 'set-scope-file', projectId: 'alpha-site', rel: 'docs/plan.md' });
  fs.rmSync(path.join(root, 'docs', 'plan.md'));
  let v = await d.read('alpha-site');
  assert.deepEqual([v.source, v.fileState, v.total], ['file', 'missing', 0]);
  assert.match(v.fileDetail, /docs\/plan\.md was not found/);
  fs.writeFileSync(path.join(root, 'docs', 'plan.md'), '- [ ] x\n' + 'y'.repeat(70000));
  v = await d.read('alpha-site');
  assert.equal(v.fileState, 'too-big');
  assert.equal(v.update, '');
  // a project whose folder the app may not read says so
  await d.apply({ type: 'mark-client', projectId: 'ghost', on: true });
  v = await d.read('ghost');
  assert.deepEqual([v.client, v.source], [true, 'none']);
});

test('no accounts snapshot and no link are first-class states', async () => {
  const noSnap = make({ accounts: null });
  assert.match((await noSnap.d.read('alpha-site')).linkWhy, /No Vercel snapshot/);
  const noMatch = make({ accounts: { vercel: { projects: [{ name: 'other', repo: 'someone/else' }], deploys: [] } } });
  const v = await noMatch.d.read('alpha-site');
  assert.deepEqual([v.link, v.linkWhy], [null, 'No Vercel project linked to this repo']);
});

test('writes are atomic: no temp file is left behind, and a corrupt file is quarantined (then -2)', async () => {
  const { d, dataDir } = make();
  await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.endsWith('.tmp')), []);
  const errs = []; const orig = console.error; console.error = (m) => errs.push(m);
  try {
    fs.writeFileSync(path.join(dataDir, 'delivery.json'), '{ not json');
    const v = await d.apply({ type: 'mark-client', projectId: 'alpha-site', on: true });
    assert.equal(v.client, true);   // started fresh instead of failing
    assert.equal(fs.readFileSync(path.join(dataDir, 'delivery.json.corrupt'), 'utf8'), '{ not json');
    fs.writeFileSync(path.join(dataDir, 'delivery.json'), '[1,2,3]');   // valid JSON, wrong shape
    await d.read('alpha-site');
    assert.equal(fs.readFileSync(path.join(dataDir, 'delivery.json.corrupt-2'), 'utf8'), '[1,2,3]');
  } finally { console.error = orig; }
  assert.equal(errs.length, 2);
});

test('init registers exactly the two channels and forwards to the module', async () => {
  const { dataDir } = make();
  const handlers = {};
  delivery.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dataDir, resolveProjectPath: () => null });
  assert.deepEqual(Object.keys(handlers).sort(), ['hq:delivery:apply', 'hq:delivery:read']);
  assert.match((await handlers['hq:delivery:read']({}, 'nope')).error, /not in the current scan/);
  assert.equal((await handlers['hq:delivery:apply']({}, 'garbage')).error, 'unknown action.');
});
