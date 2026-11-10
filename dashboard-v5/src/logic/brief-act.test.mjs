// Brief row verbs, renderer side: vals/brief-act.js + logic/brief-act.js on a rigged component (never mounted).
//   node --test dashboard-v5/src/logic/brief-act.test.mjs
// Pins: bat-prefixed keys, the verb per rule (and none for others), confirm text per verb, the inline balance field only for
// money-stale, the busy guard (one call per click), the acted line wording, errors shown as toasts, Commit handing over to the
// existing overlay, parity of the local table and balance pre-check with main's core. Placeholder data only: the repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefActLogic, verbFor, needsConfirm, balanceOk, actedText, RULE_VERB, VERB_LABEL, CONFIRM_TEXT, ACTED_TAIL } from './brief-act.js';
import { briefActRow, briefActVals } from '../vals/brief-act.js';
import tpl, { batButton } from '../tpl/brief-act.tpl.js';
import { VERBS, RULE_VERBS, checkBalance } from '../../../dashboard/brief-act-core.mjs';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const item = (rule, key, extra = {}) => ({ key, rule, severity: 'med', text: 'Placeholder ' + rule, why: 'why', source: 'scan', age: 'scan 1 h ago', action: { kind: 'scan' }, ...extra });
const QUEST = item('quest-red', 'quest-red:wq:abc');
const MONEY = item('money-stale', 'money-stale:acc1:2026-10-01T08:00:00.000Z');
const DIRTY = item('dirty', 'dirty:p1:12', { action: { kind: 'go', tab: 'projects', projectId: 'p1' } });
const WAIT = item('session-waiting', 'session-waiting:s1:2026-11-10T11:00:00.000Z');

function rig(o = {}) {
  const calls = [], toasts = [], opened = [];
  const act = async (...a) => { calls.push(a); return o.act ? o.act(...a) : { ok: true, acted: { verb: a[1], at: new Date(NOW).toISOString() } }; };
  const self = Object.assign(Object.create(briefActLogic), {
    state: { ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    openCommit: async (pid) => { opened.push(pid); },
    hq: o.noBridge ? null : { brief: o.noAct ? {} : { act } },
  });
  const row = (it, extra = {}) => briefActRow.call(self, it, { S: self.state, nowMs: NOW, ...extra });
  return { self, calls, toasts, opened, row };
}

test('every key is bat-prefixed (one shared namespace with the other surfaces)', () => {
  const r = rig({ state: { batOpen: MONEY.key } });
  for (const it of [QUEST, MONEY, DIRTY, WAIT]) for (const k of Object.keys(r.row(it))) assert.match(k, /^bat[A-Z]/, k);
  for (const k of Object.keys(briefActVals.call(r.self, { S: r.self.state }))) assert.match(k, /^bat[A-Z]/, k);
});

test('the verb per rule: exactly the rules main lists, with main’s own labels; none for any other rule', () => {
  assert.deepEqual(Object.keys(RULE_VERB).sort(), Object.keys(RULE_VERBS).sort());
  for (const [rule, verb] of Object.entries(RULE_VERB)) {
    assert.ok(RULE_VERBS[rule].includes(verb), rule + ' -> ' + verb + ' is in main’s table');
    assert.equal(VERB_LABEL[verb], VERBS[verb].label, 'label parity for ' + verb);
  }
  const r = rig();
  assert.equal(r.row(QUEST).batVerbLabel, 'Mark done');
  assert.equal(r.row(MONEY).batVerbLabel, 'Confirm balance');
  assert.equal(r.row(DIRTY).batVerbLabel, 'Commit…');
  assert.equal(r.row(item('session-left-dirty', 'session-left-dirty:p1:x')).batVerbLabel, 'Commit…');
  assert.equal(r.row(WAIT).batVerbLabel, 'Open its folder');
  for (const rule of ['secrets', 'scan-stale', 'ci-red', 'claude-sync', 'unknown-future', undefined]) {
    const v = r.row(item(rule, 'k:' + rule));
    assert.equal(v.batHasVerb, false, String(rule));
    assert.equal(verbFor({ rule }), null);
  }
  assert.equal(verbFor(null), null);
  assert.ok(!Object.values(RULE_VERB).some((v) => /push|send|post/i.test(v)), 'no outbound verb');
});

test('no bridge or no act method: no verb button at all (never a dead one)', () => {
  assert.equal(rig({ noBridge: true }).row(QUEST).batHasVerb, false);
  assert.equal(rig({ noAct: true }).row(QUEST).batHasVerb, false);
});

test('confirm text per verb; only money-stale gets the inline balance field; commit and open-folder ask nothing inline', async () => {
  assert.equal(needsConfirm('quest-done'), true);
  assert.equal(needsConfirm('confirm-balance'), true);
  assert.equal(needsConfirm('commit'), false);
  assert.equal(needsConfirm('open-folder'), false);
  const r = rig();
  assert.equal(r.row(QUEST).batConfirming, false);
  r.self.batStart(QUEST);
  const q = r.row(QUEST);
  assert.equal(q.batConfirming, true);
  assert.equal(q.batConfirmText, CONFIRM_TEXT['quest-done']);
  assert.equal(q.batNeedsBalance, false);
  assert.equal(q.batHasVerb, false, 'the verb button gives way to its confirm');
  assert.equal(r.calls.length, 0, 'opening the confirm sends nothing');
  r.self.batStart(MONEY);
  assert.equal(r.row(QUEST).batConfirming, false, 'one confirm at a time');
  const m = r.row(MONEY);
  assert.equal(m.batConfirming, true);
  assert.equal(m.batNeedsBalance, true);
  assert.equal(m.batConfirmText, CONFIRM_TEXT['confirm-balance']);
  assert.match(m.batConfirmText, /never invents/);
  assert.equal(r.calls.length, 0);
});

test('Mark done: one click opens the confirm, Yes sends ONE act, the row reads the done line; Cancel sends nothing', async () => {
  const r = rig();
  r.self.batStart(QUEST);
  r.self.batCancel();
  assert.equal(r.row(QUEST).batConfirming, false);
  assert.equal(r.calls.length, 0);
  r.self.batStart(QUEST);
  await r.self.batYes(QUEST);
  assert.deepEqual(r.calls, [[QUEST.key, 'quest-done']]);
  const v = r.row(QUEST);
  assert.equal(v.batActed, true);
  assert.equal(v.batHasVerb, false);
  assert.equal(v.batConfirming, false);
  assert.equal(v.batActedText, 'Done just now · ' + ACTED_TAIL);
});

test('Confirm balance: the typed value goes to main as typed; a bad one is told and never sent', async () => {
  const r = rig();
  r.self.batStart(MONEY);
  await r.self.batYes(MONEY);   // empty
  assert.equal(r.calls.length, 0);
  assert.match(r.toasts.at(-1)[1], /^Not saved · Type the balance/);
  for (const bad of ['-5', 'abc', '1e9', '12 EUR']) {
    r.self.batType(bad);
    await r.self.batYes(MONEY);
    assert.equal(r.calls.length, 0, bad);
  }
  r.self.batType(' 2 500,00 ');
  await r.self.batYes(MONEY);
  assert.deepEqual(r.calls, [[MONEY.key, 'confirm-balance', '2 500,00']]);
  assert.equal(r.row(MONEY).batActed, true);
  assert.equal(r.row(MONEY).batBalance, '', 'the field is gone and the draft cleared');
});

test('the local balance pre-check agrees with main’s checkBalance on the same inputs', () => {
  for (const s of ['', '  ', '0', '12.5', '2 500', '1.200,00', '-1', '+1', 'abc', '1e9', '12 EUR', '9'.repeat(13), '9'.repeat(12), '.', ',']) {
    assert.equal(!!balanceOk(s).ok, !!checkBalance(s).ok, JSON.stringify(s));
  }
  assert.equal(balanceOk(42).ok, undefined, 'a non-string is refused locally (the field only ever holds text)');
});

test('the typed balance is bound to the field and kept while the row confirms', () => {
  const r = rig();
  r.self.batStart(MONEY);
  r.self.batType('123');
  assert.equal(r.row(MONEY).batBalance, '123');
  const v = r.row(MONEY);
  v.batOnBalance({ target: { value: '456' } });
  assert.equal(r.row(MONEY).batBalance, '456');
  v.batOnKey({ key: 'Escape' });
  assert.equal(r.row(MONEY).batConfirming, false);
});

test('Enter in the field confirms (once); other keys do nothing', async () => {
  const r = rig();
  r.self.batStart(MONEY);
  r.self.batType('10');
  const v = r.row(MONEY);
  v.batOnKey({ key: 'a' });
  v.batOnKey(null);
  assert.equal(r.calls.length, 0);
  v.batOnKey({ key: 'Enter', preventDefault() {} });
  await Promise.resolve();
  assert.equal(r.calls.length, 1);
});

test('busy guard: a second click while main is working sends nothing; the mirror greys the buttons', async () => {
  let release;
  const r = rig({ act: () => new Promise((res) => { release = () => res({ ok: true, acted: { verb: 'quest-done', at: new Date(NOW).toISOString() } }); }) });
  r.self.batStart(QUEST);
  const p1 = r.self.batYes(QUEST);
  const p2 = r.self.batYes(QUEST);
  assert.equal(await p2, false);
  assert.equal(r.row(QUEST).batBusy, true);
  assert.equal(briefActVals.call(r.self, { S: r.self.state }).batBusy, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.self.batStart(WAIT), false, 'starting another verb while one is in flight is refused');
  release();
  assert.equal(await p1, true);
  assert.equal(r.row(QUEST).batBusy, false);
  assert.equal(r.calls.length, 1);
});

test('errors are shown as toasts and the row stays offering its verb (nothing is marked done)', async () => {
  const r = rig({ act: () => ({ error: 'that item is not on the brief any more.' }) });
  r.self.batStart(QUEST);
  await r.self.batYes(QUEST);
  assert.deepEqual(r.toasts.at(-1), ['error', 'Not done · that item is not on the brief any more.']);
  assert.equal(r.row(QUEST).batActed, false);
  const t = rig({ act: () => { throw new Error('boom'); } });
  t.self.batStart(QUEST);
  await t.self.batYes(QUEST);
  assert.deepEqual(t.toasts.at(-1), ['error', 'Not done · boom']);
  assert.equal(t.self._batBusy, false, 'the guard is released after a failure');
  const n = rig({ act: () => null });
  n.self.batStart(QUEST);
  await n.self.batYes(QUEST);
  assert.match(n.toasts.at(-1)[1], /no answer/);
  const b = rig({ noBridge: true });
  assert.equal(await b.self.batRun(QUEST, 'quest-done'), false);
  assert.match(b.toasts.at(-1)[1], /^Not done · this needs the desktop app/);
});

test('Commit hands over to the EXISTING overlay with main’s project id; nothing is marked done; no inline confirm', async () => {
  const r = rig({ act: (key, verb) => ({ ok: true, open: 'commit', projectId: 'p1' }) });
  await r.self.batStart(DIRTY);
  assert.deepEqual(r.calls, [[DIRTY.key, 'commit']]);
  assert.deepEqual(r.opened, ['p1']);
  assert.equal(r.row(DIRTY).batActed, false);
  assert.equal(r.row(DIRTY).batConfirming, false);
  const none = rig({ act: () => ({ ok: true, open: 'commit' }) });
  await none.self.batStart(DIRTY);
  assert.deepEqual(none.opened, [], 'no project id from main: nothing is opened');
});

test('Open its folder goes straight to main, says so, and does not read as done', async () => {
  const r = rig({ act: () => ({ ok: true }) });
  await r.self.batStart(WAIT);
  assert.deepEqual(r.calls, [[WAIT.key, 'open-folder']]);
  assert.deepEqual(r.toasts.at(-1), ['info', 'Opened its folder']);
  assert.equal(r.row(WAIT).batActed, false);
  assert.equal(r.row(WAIT).batHasVerb, true, 'it changes nothing, so it stays offered');
});

test('the acted line: minutes, hours, just now; the tail is always there; gone after 24 h; main’s marker wins over the local mirror', () => {
  const at = (ms) => ({ verb: 'quest-done', at: new Date(NOW - ms).toISOString() });
  assert.equal(actedText(at(0), NOW), 'Done just now · clears when the next scan confirms');
  assert.equal(actedText(at(30e3), NOW), 'Done just now · clears when the next scan confirms');
  assert.equal(actedText(at(2 * 60e3), NOW), 'Done 2 min ago · clears when the next scan confirms');
  assert.equal(actedText(at(3 * 3600e3 + 5 * 60e3), NOW), 'Done 3 h ago · clears when the next scan confirms');
  assert.equal(actedText(at(24 * 3600e3), NOW), '');
  assert.equal(actedText({ verb: 'x', at: 'nope' }, NOW), '');
  assert.equal(actedText(null, NOW), '');
  assert.equal(actedText({ at: new Date(NOW + 60e3).toISOString() }, NOW), 'Done just now · ' + ACTED_TAIL, 'a clock in the future is just now');
  const r = rig({ state: { batDone: { [QUEST.key]: at(60e3) } } });
  assert.equal(r.row(QUEST).batActedText, 'Done 1 min ago · ' + ACTED_TAIL);
  const fromMain = { ...QUEST, acted: at(5 * 60e3) };
  assert.equal(r.row(fromMain).batActedText, 'Done 5 min ago · ' + ACTED_TAIL);
  const old = rig({ state: { batDone: { [QUEST.key]: at(25 * 3600e3) } } });
  assert.equal(old.row(QUEST).batActed, false);
  assert.equal(old.row(QUEST).batHasVerb, true, 'an expired marker offers the verb again');
});

test('the templates bind only keys the vals provide, and say nothing outbound', () => {
  const r = rig({ state: { batOpen: MONEY.key } });
  const keys = new Set(Object.keys(r.row(MONEY)));
  for (const m of (tpl + batButton).matchAll(/\{\{\s*i\.(\w+)\s*\}\}/g)) assert.ok(keys.has(m[1]), 'template binds i.' + m[1]);
  for (const k of ['batActedText', 'batConfirmText', 'batBalance', 'batVerbLabel', 'batYesLabel']) assert.ok((tpl + batButton).includes('{{ i.' + k + ' }}'), k);
  assert.ok(!/\b(push|send|post)\b/i.test(tpl + batButton));
  // dc-lite dialect only: no expressions beyond dotted paths
  for (const m of (tpl + batButton).matchAll(/\{\{([^}]*)\}\}/g)) assert.match(m[1].trim(), /^(i\.)?\w+$|^(true|false)$/, m[0]);
});

test('the module is plain ES with no network or storage access (public repo, local-only verbs)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const f of ['brief-act.js', '../vals/brief-act.js', '../tpl/brief-act.tpl.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|require\(/.test(src), f);
  }
});
