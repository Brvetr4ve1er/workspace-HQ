// Client delivery card, renderer side: vals/delivery.js + logic/delivery.js + tpl/delivery.tpl.js on a rigged component
// (no DOM, no main). LANDS AT dashboard-v5/src/logic/delivery.test.mjs — the imports are written for that location.
// Pins: honest load states, keys all dlv-prefixed, every template binding has a value, a double toggle sends one
// intent, Copy update calls copy() and then sends one 'copied', a failed clipboard records nothing, a held card is
// never blanked by a later error, and a file source offers no edit controls.
//   node --test dashboard-v5/src/logic/delivery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryLogic } from './delivery.js';
import { deliveryVals } from '../vals/delivery.js';
import tpl from '../tpl/delivery.tpl.js';

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const VIEW = (o = {}) => ({
  projectId: 'alpha-site', client: true, mode: 'client', source: 'app', scopeFile: null, sourceLabel: 'a checklist kept in WorkspaceHQ', sourceNote: '',
  fileState: null, fileDetail: null, candidates: [{ rel: 'docs/plan.md', items: 4, done: 1 }], walkTruncated: false, walkError: null,
  milestones: [{ name: 'Design', done: 1, total: 2, items: [{ id: 'i-1', text: 'home page', done: true }, { id: 'i-2', text: 'gallery', done: false }] }],
  done: 1, total: 2, summary: '1 of 2 done', doneSince: ['home page'],
  link: { kind: 'preview', url: 'https://alpha-site-abc.vercel.app', state: 'ready', at: iso(2 * 3600e3), branch: 'feat' }, linkWhy: null,
  update: 'Alpha Site — update 7 Nov · Done so far: home page · Still to do (1 of 2): gallery', lastCopyAt: null, ...o,
});

function rig(o = {}) {
  const calls = [], toasts = [], copies = [];
  const self = Object.assign(Object.create(deliveryLogic), {
    state: { route: { id: 'alpha-site' }, dlv: {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]), denied(why) { toasts.push(['denied', why]); }, ps: () => 'live',
    async call(fn, fail) { const r = await fn(); if (r && r.error) { toasts.push(['error', fail + ' · ' + r.error]); return null; } return r; },
    copy(text, msg) { copies.push([text, msg]); return o.copyResult; },
    useMark: (surface, action) => calls.push(['mark', surface, action]),   // the real signature: an allowlisted surface and an action
    LIVE: { delivery: o.delivery === undefined ? { byProject: { 'alpha-site': VIEW() }, error: '', loaded: true } : o.delivery },
    hq: o.noBridge ? null : { delivery: { read() {}, apply() {} }, accountsOpen: async (u) => { calls.push(['open', u]); return true; } },
    store: {
      refreshDelivery: (id) => calls.push(['refresh', id]),
      applyDelivery: async (intent) => { calls.push(['apply', intent]); await new Promise((r) => setTimeout(r, 5)); return o.apply ? o.apply(intent) : VIEW(); },
    },
  });
  const vals = () => deliveryVals.call(self, { S: self.state, LIVE: self.LIVE, live: true });
  return { self, calls, toasts, copies, vals };
}
const applies = (calls) => calls.filter((c) => c[0] === 'apply').map((c) => c[1]);

test('every key is dlv-prefixed (one shared namespace with the other surfaces)', () => {
  for (const o of [{}, { noBridge: true }, { delivery: { byProject: {}, error: '', loaded: false } }]) {
    for (const k of Object.keys(rig(o).vals())) assert.match(k, /^(dlv|onDlv)[A-Z]/, k);
  }
});

test('every {{ binding }} in the template has a value in the vals (loop variables excepted)', () => {
  const states = [{}, { delivery: { byProject: { 'alpha-site': VIEW({ client: false, mode: 'none', source: 'none', milestones: [], total: 0, done: 0, update: '' }) } } },
    { delivery: { byProject: { 'alpha-site': VIEW({ client: false, mode: 'plan', source: 'file', scopeFile: 'docs/plan.md', sourceLabel: 'docs/plan.md', sourceNote: 'a plan checklist, not the quote', fileState: 'ok' }) } } }];
  const keys = new Set(); for (const o of states) for (const k of Object.keys(rig(o).vals())) keys.add(k);
  const bound = new Set([...tpl.matchAll(/\{\{\s*!?\s*([A-Za-z0-9_.]+)\s*\}\}/g)].map((m) => m[1]).filter((b) => !/^(m|it|c)\./.test(b) && b !== 'true' && b !== 'false'));
  for (const b of bound) assert.ok(keys.has(b), 'template binds ' + b + ' but the vals do not provide it');
  assert.ok(!tpl.includes('`'), 'the template must not hold a backtick');
});

test('load states are honest and exclusive: offline · error · loading · ready', () => {
  const pick = (v) => ['dlvOffline', 'dlvError', 'dlvLoading', 'dlvReady'].filter((k) => v[k]);
  assert.deepEqual(pick(rig({ noBridge: true }).vals()), ['dlvOffline']);
  assert.deepEqual(pick(rig({ delivery: { byProject: {}, error: 'disk on fire', loaded: true } }).vals()), ['dlvError']);
  assert.equal(rig({ delivery: { byProject: {}, error: 'disk on fire', loaded: true } }).vals().dlvErrorText, 'disk on fire');
  assert.deepEqual(pick(rig({ delivery: { byProject: {}, error: '', loaded: false } }).vals()), ['dlvLoading']);
  assert.deepEqual(pick(rig().vals()), ['dlvReady']);
  // a held card is never blanked by a later read error
  assert.deepEqual(pick(rig({ delivery: { byProject: { 'alpha-site': VIEW() }, error: 'later failure', loaded: true } }).vals()), ['dlvReady']);
});

test('client card: counts, milestones, link with its state, the update, and the found-files list', () => {
  const v = rig().vals();
  assert.deepEqual([v.dlvIsClient, v.dlvNotClient, v.dlvHasCounts, v.dlvCountText], [true, false, true, '1 of 2 done · 50%']);
  assert.deepEqual(v.dlvMilestones[0].items.map((i) => [i.text, i.mark, i.canToggle]), [['home page', '[x]', true], ['gallery', '[ ]', true]]);
  assert.equal(v.dlvMilestones[0].countText, '1 of 2');
  assert.deepEqual([v.dlvHasLink, v.dlvLinkKind, v.dlvLinkNote, v.dlvLinkWarn, v.dlvLinkMeta], [true, 'Preview link', 'May need a Vercel login', '', 'ready · 2 h ago · feat']);
  assert.equal(v.dlvHasUpdate, true); assert.match(v.dlvLastCopy, /Not copied yet/);
  assert.deepEqual([v.dlvHasCands, v.dlvCandsText, v.dlvShowAdd], [true, '1 checklist file found in this repo', true]);
  const bad = rig({ delivery: { byProject: { 'alpha-site': VIEW({ link: { kind: 'production', url: 'https://x.vercel.app', state: 'error', at: iso(60e3), branch: null } }) } } }).vals();
  assert.match(bad.dlvLinkWarn, /error/); assert.equal(bad.dlvLinkNote, '');
});

test('no scope: the honest line carries the found-files count; no link is first-class; nothing is invented', () => {
  const none = VIEW({ source: 'none', milestones: [], total: 0, done: 0, update: '', link: null, linkWhy: 'No Vercel project linked to this repo', sourceLabel: '', candidates: [{ rel: 'a.md', items: 2, done: 0 }, { rel: 'b.md', items: 2, done: 0 }] });
  const v = rig({ delivery: { byProject: { 'alpha-site': none } } }).vals();
  assert.equal(v.dlvNoScope, true); assert.equal(v.dlvHasCounts, false); assert.equal(v.dlvHasUpdate, false);
  assert.match(v.dlvNoScopeText, /^No scope written for this client yet — add the agreed scope from the quote \(SCOPE\.md in the repo, one of the 2 checklist files found, or a checklist here\)\. Nothing is invented\.$/);
  assert.deepEqual([v.dlvNoLink, v.dlvNoLinkText, v.dlvShowAdd], [true, 'No Vercel project linked to this repo', true]);
});

test('unmarked: the Mark button and the file list; plan mode: one line, no link, no update', () => {
  const un = rig({ delivery: { byProject: { 'alpha-site': VIEW({ client: false, mode: 'none', source: 'none', milestones: [], total: 0, done: 0, update: '', sourceLabel: '' }) } } }).vals();
  assert.deepEqual([un.dlvNotClient, un.dlvIsClient, un.dlvHasCands, un.dlvHasLink, un.dlvHasUpdate], [true, false, true, false, false]);
  assert.equal(un.dlvCands[0].pickLabel, 'Track as plan');
  const plan = rig({ delivery: { byProject: { 'alpha-site': VIEW({ client: false, mode: 'plan', source: 'file', scopeFile: 'docs/plan.md', sourceLabel: 'docs/plan.md', sourceNote: 'a plan checklist, not the quote', fileState: 'ok', done: 12, total: 40, summary: '12 of 40 done',
    milestones: [{ name: '', done: 12, total: 40, items: [{ text: 'x', done: false }] }] }) } } }).vals();
  assert.deepEqual([plan.dlvIsPlan, plan.dlvPlanLine, plan.dlvHasLink, plan.dlvHasUpdate, plan.dlvCanClear], [true, 'Plan: 12 of 40 done', false, false, true]);
  assert.match(plan.dlvSourceLine, /docs\/plan\.md — a plan checklist, not the quote/);
  assert.equal(plan.dlvMilestones[0].name, 'General');
  assert.equal(plan.dlvMilestones[0].items[0].canToggle, false);   // a file source has no edit controls
  assert.equal(plan.dlvMilestones[0].items[0].canRemove, false);
  assert.equal(plan.dlvShowAdd, false);
  assert.equal(plan.dlvCands[0].pickOff, true);   // the file in use cannot be picked again
});

test('a file problem is named and nothing from the file is shown', () => {
  const v = rig({ delivery: { byProject: { 'alpha-site': VIEW({ source: 'file', scopeFile: 'SCOPE.md', sourceLabel: 'SCOPE.md', fileState: 'missing', fileDetail: 'SCOPE.md was not found', milestones: [], total: 0, done: 0, update: '' }) } } }).vals();
  assert.equal(v.dlvFileProblem, true); assert.equal(v.dlvHasCounts, false); assert.equal(v.dlvNoScope, false);
  assert.match(v.dlvFileProblemText, /SCOPE\.md was not found/);
});

test('a double toggle sends one intent', async () => {
  const { self, calls } = rig();
  const a = self.dlvToggle('i-2'), b = self.dlvToggle('i-2');
  await Promise.all([a, b]);
  assert.deepEqual(applies(calls), [{ projectId: 'alpha-site', type: 'item-toggle', id: 'i-2' }]);
  await self.dlvToggle('i-2');   // the guard released: the next deliberate toggle goes through
  assert.equal(applies(calls).length, 2);
});

test('Copy update calls copy() and then sends one copied intent (and counts the use)', async () => {
  const { self, calls, copies } = rig();
  await Promise.all([self.dlvCopyUpdate(), self.dlvCopyUpdate()]);
  assert.equal(copies.length, 1); assert.match(copies[0][0], /^Alpha Site — update/);
  assert.deepEqual(applies(calls), [{ projectId: 'alpha-site', type: 'copied' }]);
  assert.ok(calls.findIndex((c) => c[0] === 'mark') < calls.findIndex((c) => c[0] === 'apply'));
  assert.ok(calls.some((c) => c[0] === 'mark' && c[1] === 'delivery-card' && c[2] === 'copy'));
});
test('a clipboard that reports failure records nothing; no update text means nothing to copy', async () => {
  const bad = rig({ copyResult: Promise.resolve(false) });
  await bad.self.dlvCopyUpdate();
  assert.equal(bad.copies.length, 1); assert.deepEqual(applies(bad.calls), []);
  const empty = rig({ delivery: { byProject: { 'alpha-site': VIEW({ update: '' }) } } });
  await empty.self.dlvCopyUpdate();
  assert.deepEqual([empty.copies.length, applies(empty.calls).length], [0, 0]);
});

test('intents carry only the owner\'s form fields and the project id', async () => {
  const { self, calls } = rig({ state: { dlv: { draft: '  home page ', ms: ' Design ' } } });
  await self.dlvAdd();
  await self.dlvMark(true); await self.dlvPick('docs/plan.md'); await self.dlvPick(null); await self.dlvRemove('i-1');
  assert.deepEqual(applies(calls), [
    { projectId: 'alpha-site', type: 'item-add', text: 'home page', milestone: 'Design' },
    { projectId: 'alpha-site', type: 'mark-client', on: true },
    { projectId: 'alpha-site', type: 'set-scope-file', rel: 'docs/plan.md' },
    { projectId: 'alpha-site', type: 'set-scope-file', rel: null },
    { projectId: 'alpha-site', type: 'item-remove', id: 'i-1' },
  ]);
  assert.equal(self.state.dlv.draft, ''); assert.equal(self.state.dlv.ms, ' Design ');   // the draft clears, the milestone stays
});
test('an empty add sends nothing; Enter passes the value it saw; real errors are toasted and the guard released', async () => {
  const { self, calls, toasts } = rig({ apply: () => ({ error: 'at most 200 items per project.' }) });
  await self.dlvAdd();
  assert.deepEqual(applies(calls), []); assert.equal(toasts[0][0], 'error');
  await self.dlvAdd({ draft: 'typed just now' });
  assert.equal(applies(calls)[0].text, 'typed just now');
  assert.deepEqual(toasts[1], ['error', 'Not added · at most 200 items per project.']);
  assert.equal(self._dlvBusy, false); assert.equal(self.state.dlvBusy, false);
});
test('without the bridge nothing is sent, and the owner is told why', async () => {
  const { self, calls, toasts } = rig({ noBridge: true });
  await self.dlvMark(true);
  assert.deepEqual(applies(calls), []); assert.equal(toasts[0][0], 'denied');
});
test('arriving reads the card and counts the open; Open goes through the accounts opener only', async () => {
  const { self, calls } = rig();
  self.dlvArrive('alpha-site');
  assert.deepEqual(calls.slice(0, 2), [['refresh', 'alpha-site'], ['mark', 'delivery-card', 'open']]);
  await self.dlvOpenLink('https://alpha-site-abc.vercel.app');
  assert.deepEqual(calls.at(-1), ['open', 'https://alpha-site-abc.vercel.app']);
  const noMark = rig(); noMark.self.useMark = undefined;
  assert.doesNotThrow(() => noMark.self.dlvArrive('alpha-site'));   // the rulebook's mark may not exist yet
});
