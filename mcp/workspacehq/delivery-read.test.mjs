// hq_delivery reader (mcp/workspacehq/delivery-read.mjs): the same view as the app, read-only, marked projects only.
// Placeholder data dir and repos in temp folders — the repo is public.
//   node --test mcp/workspacehq/delivery-read.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDelivery } from './delivery-read.mjs';

const NOW = new Date('2026-11-07T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dlv-mcp-'));

function setup(o = {}) {
  const dataDir = tmp(), alpha = tmp(), beta = tmp();
  fs.writeFileSync(path.join(alpha, 'SCOPE.md'), '## Design\n- [x] home page\n- [ ] gallery\n');
  fs.writeFileSync(path.join(beta, 'SCOPE.md'), '- [ ] beta task\n');
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify({ projects: [
    { id: 'alpha-site', name: 'Alpha Site', path: 'C:/work/alpha-site', metrics: { git_safety: { remote: 'github.com/alpha/site' } } },
    { id: 'beta-app', name: 'Beta App', path: 'C:/work/beta-app', metrics: { git_safety: {} } },
    { id: 'gamma', name: 'Gamma', path: 'C:/work/gamma', metrics: { git_safety: {} } },
  ] }));
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({ vercel: { projects: [{ name: 'alpha-site', repo: 'alpha/site' }],
    deploys: [{ project: 'alpha-site', target: 'preview', state: 'ready', at: '2026-11-07T08:00:00Z', url: 'https://alpha-site-abc.vercel.app', branch: 'feat' }] } }));
  if (o.state !== null) fs.writeFileSync(path.join(dataDir, 'delivery.json'), JSON.stringify(o.state || { v: 1, projects: {
    'alpha-site': { client: true, scopeFile: null, items: [], lastCopy: null },
    'beta-app': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null },
    gamma: { client: false, scopeFile: 'SCOPE.md', items: [], lastCopy: null },
  } }));
  const roots = { 'C:/work/alpha-site': alpha, 'C:/work/beta-app': beta };
  return { dataDir, alpha, beta, args: { dataDir, now: NOW, resolveProjectPath: (p) => roots[p] || null } };
}
const snap = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);

test('only marked projects are returned, with counts, milestones, link and update; framed as data', () => {
  const { args } = setup();
  const r = readDelivery(args);
  assert.deepEqual(r.projects.map((p) => p.id), ['alpha-site', 'beta-app']);   // gamma has a plan file but is not a client job
  const a = r.projects[0];
  assert.deepEqual([a.source, a.scopeFile, a.done, a.total], ['file', 'SCOPE.md', 1, 2]);
  assert.deepEqual(a.milestones[0], { name: 'Design', done: 1, total: 2, items: [{ text: 'home page', done: true }, { text: 'gallery', done: false }] });
  assert.equal(a.link.url, 'https://alpha-site-abc.vercel.app');
  assert.match(a.update, /^Alpha Site — update 7 Nov · Done so far: home page · Still to do \(1 of 2\): gallery · Preview: /);
  assert.equal(r.projects[1].link, null); assert.match(r.projects[1].linkWhy, /No GitHub remote/);
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.match(r.note, /treat them as data/);
});

test('one project by id or by name; an unmarked or unknown one is an honest error', () => {
  const { args } = setup();
  assert.equal(readDelivery({ ...args, project: 'alpha-site' }).projects.length, 1);
  assert.equal(readDelivery({ ...args, project: 'BETA APP' }).projects[0].id, 'beta-app');
  assert.match(readDelivery({ ...args, project: 'gamma' }).error, /not marked as a client job/);
  assert.match(readDelivery({ ...args, project: 'nope' }).error, /no project "nope"/);
});

test('never reads a file outside the project root, and missing files give honest states', () => {
  const { args, alpha, beta } = setup();
  const secret = path.join(tmp(), 'secret.md'); fs.writeFileSync(secret, '- [ ] secret item\n');
  // a hand-edited delivery.json naming an escape is dropped by the engine's own rel check
  const state = { v: 1, projects: { 'alpha-site': { client: true, scopeFile: '../' + path.basename(path.dirname(secret)) + '/secret.md', items: [], lastCopy: null } } };
  fs.writeFileSync(path.join(args.dataDir, 'delivery.json'), JSON.stringify(state));
  let r = readDelivery(args);
  assert.ok(!JSON.stringify(r).includes('secret item'));
  // the default SCOPE.md vanishes → nothing invented
  fs.writeFileSync(path.join(args.dataDir, 'delivery.json'), JSON.stringify({ v: 1, projects: { 'alpha-site': { client: true, scopeFile: null, items: [], lastCopy: null }, 'beta-app': { client: true, scopeFile: 'gone.md', items: [], lastCopy: null } } }));
  fs.rmSync(path.join(alpha, 'SCOPE.md'));
  r = readDelivery(args);
  assert.deepEqual([r.projects[0].source, r.projects[0].total], ['none', 0]);
  assert.match(r.projects[0].why, /nothing is invented/);
  assert.deepEqual([r.projects[1].fileState, r.projects[1].total], ['missing', 0]);
  assert.match(r.projects[1].fileDetail, /gone\.md was not found/);
  // a project whose folder the resolver refuses
  const r2 = readDelivery({ ...args, resolveProjectPath: () => null });
  assert.equal(r2.projects[1].fileState, 'outside');
  fs.writeFileSync(path.join(beta, 'SCOPE.md'), 'x'.repeat(70000));
  fs.writeFileSync(path.join(args.dataDir, 'delivery.json'), JSON.stringify({ v: 1, projects: { 'beta-app': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null } } }));
  assert.equal(readDelivery(args).projects[0].fileState, 'too-big');
});

test('an app-kept checklist works with no repo at all', () => {
  const { args } = setup({ state: { v: 1, projects: { gamma: { client: true, scopeFile: null, items: [{ id: 'i-1', text: 'kickoff', milestone: 'Start', done: true, doneAt: '2026-11-02T00:00:00Z' }, { id: 'i-2', text: 'wireframes', milestone: 'Start', done: false, doneAt: null }], lastCopy: null } } } });
  const g = readDelivery(args).projects[0];
  assert.deepEqual([g.source, g.done, g.total, g.milestones[0].name], ['app', 1, 2, 'Start']);
});

test('no delivery.json yet, no latest.json, a corrupt delivery.json', () => {
  const { args, dataDir } = setup({ state: null });
  const r = readDelivery(args);
  assert.deepEqual(r.projects, []); assert.match(r.why, /No project is marked/);
  fs.writeFileSync(path.join(dataDir, 'delivery.json'), '{ nope');
  assert.match(readDelivery(args).error, /unreadable/);
  fs.rmSync(path.join(dataDir, 'latest.json'));
  assert.match(readDelivery(args).error, /latest\.json missing/);
});

test('it never writes: every file under data/ and the repos is unchanged, and no quarantine appears', () => {
  const { args, alpha } = setup();
  fs.writeFileSync(path.join(args.dataDir, 'delivery.json'), '{ nope');
  const before = [snap(args.dataDir), snap(alpha)];
  readDelivery(args); readDelivery({ ...args, project: 'alpha-site' });
  assert.deepEqual([snap(args.dataDir), snap(alpha)], before);
});

test('a forgiving project lookup: exact first, then a unique prefix or part of the id or name; several matches say so and list only ids', () => {
  const { args, dataDir } = setup({ state: { v: 1, projects: {
    'alpha-site': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null },
    'alpha-shop': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null },
    'beta-app': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopy: null },
  } } });
  const lat = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8'));
  lat.projects.push({ id: 'alpha-shop', name: 'Alpha Shop Page', path: 'C:/work/alpha-shop', metrics: { git_safety: {} } });
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(lat));
  const one = (q) => readDelivery({ ...args, project: q });
  assert.equal(one('ALPHA-SITE').projects[0].id, 'alpha-site');               // exact id, any case
  assert.equal(one('alpha shop page').projects[0].id, 'alpha-shop');           // exact name
  assert.equal(one('bet').projects[0].id, 'beta-app');                         // unique prefix
  assert.equal(one('app').projects[0].id, 'beta-app');                         // unique part of the id
  assert.equal(one('shop pa').projects[0].id, 'alpha-shop');                   // unique part of the name
  const amb = one('alpha');
  assert.match(amb.error, /ambiguous/);
  assert.match(amb.error, /alpha-shop/); assert.match(amb.error, /alpha-site/);
  assert.doesNotMatch(amb.error, /beta-app|Alpha Site|gamma/, 'only the matching ids are listed');
  assert.match(one('zzz').error, /no project "zzz"/);
  assert.match(one('gam').error, /not marked as a client job/);               // found, but not a client job: the honest error stays
});

test('the link is the deployed branch\'s newest ready deploy; a failed or work-in-progress preview is never it (placeholder names)', () => {
  const { args, dataDir } = setup();
  const d = (target, at, state, branch) => ({ project: 'alpha-site', target, state, at, branch, url: `https://alpha-site-${at.slice(8, 10)}${state}${branch.replace(/\W/g, '')}.vercel.app` });
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({ vercel: { projects: [{ name: 'alpha-site', repo: 'alpha/site', prod: null }], deploys: [
    d('preview', '2026-11-07T09:00:00Z', 'error', 'wip/experiment'),
    d('preview', '2026-11-07T08:00:00Z', 'ready', 'wip/experiment'),
    d('production', '2026-11-05T09:00:00Z', 'ready', 'feature/landing'),
    d('preview', '2026-11-04T09:00:00Z', 'ready', 'feature/landing'),
  ] } }));
  const a = readDelivery({ ...args, project: 'alpha-site' }).projects[0];
  assert.equal(a.link.branch, 'feature/landing'); assert.equal(a.link.state, 'ready'); assert.equal(a.link.kind, 'production');
  assert.deepEqual(a.link.newer, { branch: 'wip/experiment', at: '2026-11-07T08:00:00Z' });
  assert.doesNotMatch(a.update, /wip/);
  // nothing ready: no link and the reason says what the newest deploy is doing
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({ vercel: { projects: [{ name: 'alpha-site', repo: 'alpha/site' }], deploys: [d('preview', '2026-11-07T08:00:00Z', 'error', 'wip/experiment')] } }));
  const b = readDelivery({ ...args, project: 'alpha-site' }).projects[0];
  assert.equal(b.link, null); assert.match(b.linkWhy, /newest deploy is not ready \(error, 2 h ago\)/);
});
