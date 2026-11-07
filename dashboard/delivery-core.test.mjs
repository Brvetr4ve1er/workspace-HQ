// Client delivery engine (dashboard/delivery-core.mjs). Placeholder data only — the repo is public.
//   node --test dashboard/delivery-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './delivery-core.mjs';

const NOW = new Date('2026-11-07T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dlv-core-'));

test('checklist parser: items, milestones, items outside any milestone, CRLF', () => {
  const p = C.parseChecklist('- [x] kickoff call\n* [ ] logo files\n## Design\n- [ ] home page\r\n- [X] contact page\r\nnot an item\n### Not a milestone\n- [ ] footer\n## Empty\n## Launch\n  - [ ] go live\n');
  assert.deepEqual(p.milestones.map((m) => [m.name, m.done, m.total]), [['', 1, 2], ['Design', 1, 3], ['Launch', 0, 1]]);
  assert.equal(p.total, 6); assert.equal(p.done, 2);
  assert.equal(p.milestones[1].items[1].text, 'contact page');   // CRLF did not leak into the text
  assert.equal(p.tooBig, false);
});
test('checklist parser: code fences are skipped, duplicate texts keep distinct hashes', () => {
  const p = C.parseChecklist('```\n- [ ] in a fence\n```\n- [ ] same\n- [ ] same\n- [ ]   \n');
  assert.equal(p.total, 2);
  const [a, b] = p.milestones[0].items;
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.hash, C.parseChecklist('- [ ] SAME\n').milestones[0].items[0].hash);   // case and spacing do not change identity
});
test('checklist parser: the 64 KB cap and the item text cap', () => {
  const big = C.parseChecklist('- [ ] x\n' + 'a'.repeat(C.MAX_FILE_BYTES));
  assert.equal(big.tooBig, true); assert.equal(big.total, 0);
  const long = C.parseChecklist('- [ ] ' + 'z'.repeat(500));
  assert.equal([...long.milestones[0].items[0].text].length, C.MAX_TEXT);
  assert.equal(C.parseChecklist(null).total, 0);
});

test('remote and repo matching: forms, case, .git, null, no match', () => {
  for (const r of ['github.com/Alpha/Site', 'https://github.com/alpha/site.git', 'git@github.com:ALPHA/site.git', 'alpha/site', 'https://github.com/alpha/site/'])
    assert.equal(C.repoKey(r), 'alpha/site', r);
  for (const r of [null, undefined, '', 'gitlab.com/a/b', 'github.com/only-owner', 42]) assert.equal(C.repoKey(r), null, String(r));
  const vercel = { projects: [{ name: 'alpha-site', repo: 'Alpha/Site' }, { name: 'beta', repo: 'alpha/other' }, { name: 'norepo' }] };
  assert.deepEqual(C.matchVercelProjects('github.com/alpha/site.git', vercel).map((p) => p.name), ['alpha-site']);
  assert.deepEqual(C.matchVercelProjects('github.com/alpha/none', vercel), []);
  assert.deepEqual(C.matchVercelProjects(null, vercel), []);
  assert.deepEqual(C.matchVercelProjects('alpha/site', null), []);
});

const dep = (project, target, at, state = 'ready') => ({ project, target, state, at, url: `https://${project}-${at.slice(5, 10)}-${target}.vercel.app`, branch: 'main' });
const accounts = (deploys, projects) => ({ vercel: { state: 'ok', projects: projects || [{ name: 'alpha-site', repo: 'alpha/site' }, { name: 'beta-app', repo: 'alpha/beta' }], deploys } });

test('link pick: another project\'s deploy is never taken, preview beats production, newest wins', () => {
  const a = accounts([
    dep('beta-app', 'preview', '2026-11-07T09:00:00Z'),   // newer, but another project's
    dep('alpha-site', 'production', '2026-11-06T09:00:00Z'),
    dep('alpha-site', 'preview', '2026-11-03T09:00:00Z'),
    dep('alpha-site', 'preview', '2026-11-05T09:00:00Z'),
    dep('alpha-site', 'production', '2026-11-07T08:00:00Z'),
  ]);
  const { link, linkWhy } = C.linkFor('github.com/alpha/site', a);
  assert.equal(linkWhy, null);
  assert.equal(link.kind, 'preview'); assert.equal(link.at, '2026-11-05T09:00:00Z'); assert.match(link.url, /^https:\/\/alpha-site-11-05-preview/);
});
test('link pick: production fallback, projects[].latest preview, none, and the honest reasons', () => {
  const only = accounts([dep('alpha-site', 'production', '2026-11-01T09:00:00Z'), dep('alpha-site', 'production', '2026-11-04T09:00:00Z')]);
  assert.equal(C.linkFor('alpha/site', only).link.kind, 'production');
  assert.equal(C.linkFor('alpha/site', only).link.at, '2026-11-04T09:00:00Z');
  const viaLatest = accounts([], [{ name: 'alpha-site', repo: 'alpha/site', latest: dep('alpha-site', 'preview', '2026-11-02T09:00:00Z'), prod: dep('alpha-site', 'production', '2026-11-06T09:00:00Z') }]);
  assert.equal(C.linkFor('alpha/site', viaLatest).link.kind, 'preview');
  const viaProd = accounts([], [{ name: 'alpha-site', repo: 'alpha/site', prod: dep('alpha-site', 'production', '2026-11-06T09:00:00Z') }]);
  assert.equal(C.linkFor('alpha/site', viaProd).link.kind, 'production');
  assert.match(C.linkFor('alpha/site', accounts([])).linkWhy, /no deploys/);
  assert.equal(C.linkFor('alpha/unknown', only).linkWhy, 'No Vercel project linked to this repo');
  assert.match(C.linkFor(null, only).linkWhy, /No GitHub remote/);
  assert.match(C.linkFor('alpha/site', null).linkWhy, /No Vercel snapshot/);
  // a link that is not https never reaches the owner's clipboard
  assert.equal(C.linkFor('alpha/site', accounts([{ ...dep('alpha-site', 'preview', '2026-11-05T09:00:00Z'), url: 'javascript:alert(1)' }])).link, null);
  // older snapshots kept deploys at the top level
  assert.equal(C.linkFor('alpha/site', { vercel: { projects: [{ name: 'alpha-site', repo: 'alpha/site' }] }, deploys: [dep('alpha-site', 'preview', '2026-11-05T09:00:00Z')] }).link.kind, 'preview');
});

test('update text is deterministic for a fixed now, and doneSince goes by hash', () => {
  const parsed = C.parseChecklist('## Design\n- [x] home page\n- [x] contact page\n- [ ] gallery\n## Launch\n- [ ] domain\n- [ ] go live\n');
  const scope = { source: 'file', scopeFile: 'SCOPE.md', fileState: 'ok', parsed, candidates: [] };
  const args = { projectId: 'alpha-site', name: 'Alpha Site', entry: { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null }, scope,
    accounts: accounts([dep('alpha-site', 'preview', '2026-11-07T08:00:00Z')]), remote: 'github.com/alpha/site', now: NOW };
  const a = C.buildView(args), b = C.buildView(args);
  assert.deepEqual(a, b);
  assert.equal(a.view.update, 'Alpha Site — update 7 Nov · Done so far: home page; contact page · Still to do (3 of 5): gallery; domain; go live · Preview: https://alpha-site-11-07-preview.vercel.app (ready, 2 h ago)');
  assert.equal(a.view.sourceNote, '');   // SCOPE.md is the quote
  assert.equal(C.buildView({ ...args, scope: { ...scope, scopeFile: 'docs/plan.md' } }).view.sourceNote, 'a plan checklist, not the quote');
  assert.deepEqual([a.view.done, a.view.total], [2, 5]);
  assert.equal(a.doneHashes.length, 2);
  // after a copy, only what was finished since is listed
  const parsed2 = C.parseChecklist('## Design\n- [x] home page\n- [x] contact page\n- [x] gallery\n## Launch\n- [ ] domain\n- [ ] go live\n');
  const c = C.buildView({ ...args, scope: { ...scope, parsed: parsed2 }, entry: { ...args.entry, lastCopy: { at: '2026-11-02T10:00:00Z', doneHashes: a.doneHashes } } });
  assert.deepEqual(c.view.doneSince, ['gallery']);
  assert.match(c.view.update, /Done since 2 Nov: gallery · Still to do \(2 of 5\)/);
  assert.equal(c.view.lastCopyAt, '2026-11-02T10:00:00Z');
});
test('update text: everything done, no link, long lists are cut, no scope gives no update', () => {
  const many = C.parseChecklist(Array.from({ length: 12 }, (_, i) => `- [ ] task ${i + 1}`).join('\n'));
  const mk = (parsed, extra = {}) => C.buildView({ projectId: 'p', name: 'P', entry: { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null }, scope: { source: 'file', scopeFile: 'SCOPE.md', fileState: 'ok', parsed, candidates: [] }, accounts: null, remote: null, now: NOW, ...extra }).view;
  assert.match(mk(many).update, /Still to do \(12 of 12\): task 1; .*task 8 and 4 more$/);
  assert.match(mk(C.parseChecklist('- [x] only\n')).update, /Everything in the agreed scope is done$/);
  assert.equal(mk(many).link, null); assert.match(mk(many).linkWhy, /No Vercel snapshot/);
  const none = C.buildView({ projectId: 'p', name: 'P', entry: { client: true, scopeFile: null, items: [], lastCopy: null }, scope: { source: 'none', scopeFile: null, candidates: [{ rel: 'docs/plan.md', items: 4, done: 1 }] }, accounts: null, remote: null, now: NOW }).view;
  assert.deepEqual([none.mode, none.source, none.update, none.total, none.candidates.length], ['client', 'none', '', 0, 1]);
});
test('unmarked project with a picked file is plan mode: counts, no update text', () => {
  const parsed = C.parseChecklist('## One\n- [x] a\n- [ ] b\n');
  const { view } = C.buildView({ projectId: 'p', name: 'P', entry: { client: false, scopeFile: 'docs/plan.md', items: [], lastCopy: null }, scope: { source: 'file', scopeFile: 'docs/plan.md', fileState: 'ok', parsed, candidates: [] }, accounts: null, remote: null, now: NOW });
  assert.deepEqual([view.mode, view.summary, view.update], ['plan', '1 of 2 done', '']);
});

// ---- containment (real temp dirs) ----
const io = C.nodeIo(fs);
function repo() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SCOPE.md'), '- [ ] a\n- [x] b\n');
  fs.writeFileSync(path.join(root, 'docs', 'plan.md'), '## M\n- [ ] c\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), '- [ ] not markdown\n');
  return root;
}
test('containment: good files read; "..", absolute paths and non-.md files are refused', () => {
  const root = repo();
  assert.equal(C.containScope(root, 'SCOPE.md', io).ok, true);
  assert.equal(C.containScope(root, 'docs\\plan.md', io).ok, true);
  assert.equal(C.readScope(root, 'docs/plan.md', io).text.includes('- [ ] c'), true);
  const outside = path.join(tmp(), 'secret.md');
  fs.writeFileSync(outside, '- [ ] secret\n');
  for (const rel of ['../secret.md', 'docs/../../secret.md', outside, '/etc/passwd.md', 'C:\\x.md', 'notes.txt', '', null, 'a\0.md'])
    assert.equal(C.containScope(root, rel, io).ok, false, String(rel));
  assert.equal(C.containScope(root, 'notes.txt', io).state, 'outside');
  assert.equal(C.containScope(root, 'nope.md', io).state, 'missing');
  assert.equal(C.containScope(null, 'SCOPE.md', io).state, 'outside');
  assert.equal(C.containScope(path.join(root, 'gone'), 'SCOPE.md', io).state, 'missing');
});
test('containment: a symlink or junction pointing out of the root is refused; too-big files say so', (t) => {
  const root = repo(), other = tmp();
  fs.writeFileSync(path.join(other, 'leak.md'), '- [ ] leak\n');
  let linked = false;
  try { fs.symlinkSync(other, path.join(root, 'out'), 'junction'); linked = true; } catch { /* no link rights */ }
  try { fs.symlinkSync(path.join(other, 'leak.md'), path.join(root, 'leak.md'), 'file'); linked = true; } catch { /* no link rights */ }
  if (!linked) t.diagnostic('could not create a link on this machine — escape cases skipped');
  if (fs.existsSync(path.join(root, 'out'))) assert.equal(C.containScope(root, 'out/leak.md', io).state, 'outside');
  if (fs.existsSync(path.join(root, 'leak.md'))) assert.equal(C.containScope(root, 'leak.md', io).state, 'outside');
  fs.writeFileSync(path.join(root, 'huge.md'), '- [ ] x\n' + 'y'.repeat(C.MAX_FILE_BYTES));
  assert.equal(C.containScope(root, 'huge.md', io).state, 'too-big');
  fs.mkdirSync(path.join(root, 'dir.md'));
  assert.equal(C.containScope(root, 'dir.md', io).state, 'unreadable');
});

test('candidate walk: depth, skip list, caps, only files with checklist lines', () => {
  const root = repo();
  const w = (rel, body = '- [ ] x\n') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  w('a/b/c/deep3.md'); w('a/b/c/d/deep4.md'); w('node_modules/pkg/readme.md'); w('.hidden/x.md'); w('dist/o.md'); w('build/o.md'); w('plain.md', '# no checklist\n');
  const r = C.walkCandidates({ root, io });
  assert.deepEqual(r.candidates.map((c) => c.rel), ['SCOPE.md', 'a/b/c/deep3.md', 'docs/plan.md']);
  assert.deepEqual(r.candidates[0], { rel: 'SCOPE.md', items: 2, done: 1 });
  assert.equal(r.truncated, false);
  // the file cap
  const capped = C.walkCandidates({ root, io, limits: { ...C.WALK, files: 2 } });
  assert.equal(capped.truncated, true);
  assert.ok(capped.candidates.length <= 2);
  assert.match(C.walkCandidates({ root: path.join(root, 'gone'), io }).error, /not found/);
});

test('gatherScope: pick > app items > SCOPE.md default; missing and broken files are named', () => {
  const root = repo();
  const g = (entry) => C.gatherScope({ root, entry, io });
  const base = { client: true, scopeFile: null, items: [], lastCopy: null };
  assert.deepEqual([g(base).source, g(base).scopeFile, g(base).fileState, g(base).parsed.total], ['file', 'SCOPE.md', 'ok', 2]);
  assert.equal(g({ ...base, items: [{ id: 'i-1', text: 'x', milestone: '', done: false, doneAt: null }] }).source, 'app');
  assert.equal(g({ ...base, scopeFile: 'docs/plan.md' }).scopeFile, 'docs/plan.md');
  assert.equal(g({ ...base, scopeFile: 'gone.md' }).fileState, 'missing');
  assert.equal(g({ ...base, scopeFile: 'gone.md' }).parsed, null);
  assert.equal(g({ client: false, scopeFile: null, items: [], lastCopy: null }).source, 'none');   // plan mode never defaults
  assert.equal(g(null).source, 'none');
  fs.rmSync(path.join(root, 'SCOPE.md'));
  assert.equal(g(base).source, 'none');   // no SCOPE.md, no items: nothing is invented
  fs.writeFileSync(path.join(root, 'SCOPE.md'), '- [ ] x\n' + 'y'.repeat(C.MAX_FILE_BYTES));
  assert.equal(g(base).fileState, 'too-big');
});

test('intents: validation and transitions', () => {
  const ctx = { now: NOW, newId: (() => { let n = 0; return () => 'id' + ++n; })(), known: (id) => id === 'alpha-site' };
  let s = C.emptyState();
  const go = (i) => (s = C.applyIntent(s, i, ctx));
  assert.throws(() => go({ type: 'mark-client', projectId: 'nope', on: true }), C.DeliveryError);
  assert.throws(() => go({ type: 'wipe', projectId: 'alpha-site' }), /unknown action/);
  assert.throws(() => go({ type: 'mark-client', projectId: 'alpha-site', on: 'yes' }), C.DeliveryError);
  assert.throws(() => go({ type: 'item-add', projectId: 'alpha-site', text: 'x' }), /client job first/);
  go({ type: 'mark-client', projectId: 'alpha-site', on: true });
  go({ type: 'item-add', projectId: 'alpha-site', text: '  home   page ', milestone: 'Design' });
  assert.deepEqual(s.projects['alpha-site'].items[0], { id: 'i-id1', text: 'home page', milestone: 'Design', done: false, doneAt: null });
  assert.throws(() => go({ type: 'item-add', projectId: 'alpha-site', text: 'x'.repeat(201) }), /200 characters/);
  assert.throws(() => go({ type: 'item-add', projectId: 'alpha-site', text: '   ' }), C.DeliveryError);
  assert.throws(() => go({ type: 'item-add', projectId: 'alpha-site', text: 'x', milestone: 'm'.repeat(81) }), C.DeliveryError);
  assert.throws(() => go({ type: 'item-add', projectId: 'alpha-site', text: 'x'.repeat(20000) }), /unknown action/);   // oversize intent
  go({ type: 'item-toggle', projectId: 'alpha-site', id: 'i-id1' });
  assert.equal(s.projects['alpha-site'].items[0].done, true); assert.equal(s.projects['alpha-site'].items[0].doneAt, NOW.toISOString());
  go({ type: 'item-toggle', projectId: 'alpha-site', id: 'i-id1' });
  assert.equal(s.projects['alpha-site'].items[0].doneAt, null);
  assert.throws(() => go({ type: 'item-toggle', projectId: 'alpha-site', id: 'i-zzz' }), /gone/);
  go({ type: 'set-scope-file', projectId: 'alpha-site', rel: 'docs\\plan.md' });
  assert.equal(s.projects['alpha-site'].scopeFile, 'docs/plan.md');
  assert.throws(() => go({ type: 'set-scope-file', projectId: 'alpha-site', rel: '../x.md' }), C.DeliveryError);
  go({ type: 'set-scope-file', projectId: 'alpha-site', rel: null });
  assert.equal(s.projects['alpha-site'].scopeFile, null);
  go({ type: 'copied', projectId: 'alpha-site', doneHashes: ['abcd1234'] });
  assert.deepEqual(s.projects['alpha-site'].lastCopy, { at: NOW.toISOString(), doneHashes: ['abcd1234'] });
  go({ type: 'item-remove', projectId: 'alpha-site', id: 'i-id1' });
  assert.equal(s.projects['alpha-site'].items.length, 0);
  go({ type: 'mark-client', projectId: 'alpha-site', on: false });
  assert.equal(s.projects['alpha-site'].client, false);
  // the input state is never mutated
  const before = JSON.stringify(s);
  C.applyIntent(s, { type: 'mark-client', projectId: 'alpha-site', on: true }, ctx);
  assert.equal(JSON.stringify(s), before);
});
test('intents: at most 200 items per project', () => {
  const ctx = { now: NOW, newId: (() => { let n = 0; return () => String(++n); })(), known: () => true };
  let s = C.applyIntent(C.emptyState(), { type: 'mark-client', projectId: 'p', on: true }, ctx);
  for (let i = 0; i < C.MAX_ITEMS; i++) s = C.applyIntent(s, { type: 'item-add', projectId: 'p', text: 'item ' + i }, ctx);
  assert.throws(() => C.applyIntent(s, { type: 'item-add', projectId: 'p', text: 'one more' }, ctx), /at most 200/);
});
test('sanitizeState drops malformed rows and keeps good ones', () => {
  const s = C.sanitizeState({ v: 1, projects: { a: { client: true, scopeFile: '../x.md', items: [{ id: 'i-1', text: 'ok', done: true, doneAt: '2026-11-01T00:00:00Z' }, { id: 5 }, null, { id: 'i-1', text: 'dup' }], lastCopy: { at: 'garbage' } }, '': {}, b: 7 } });
  assert.deepEqual(Object.keys(s.projects), ['a']);
  assert.deepEqual([s.projects.a.client, s.projects.a.scopeFile, s.projects.a.items.length, s.projects.a.lastCopy], [true, null, 1, null]);
  assert.deepEqual(C.sanitizeState([1, 2]), C.emptyState());
});
test('listProjects reads id, name, path and remote from latest.json', () => {
  const l = C.listProjects({ projects: [{ id: 'alpha-site', name: 'Alpha Site', path: 'C:/work/alpha-site', metrics: { git_safety: { remote: 'github.com/alpha/site' } } }, { id: 'bare' }, { name: 'no id' }, null] });
  assert.deepEqual(l, [{ id: 'alpha-site', name: 'Alpha Site', path: 'C:/work/alpha-site', remote: 'github.com/alpha/site' }, { id: 'bare', name: 'bare', path: '', remote: null }]);
  assert.deepEqual(C.listProjects(null), []);
});
