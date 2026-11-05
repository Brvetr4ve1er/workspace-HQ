// Money space, renderer side: vals/money.js + logic/money.js on a rigged component (no DOM, no main).
// LANDS AT dashboard-v5/src/logic/money.test.mjs — the imports below are written for that location.
// Pins: honest load states (offline / error / loading / ready), keys all mny-prefixed, the double-submit
// guard, real errors toasted + guard released, success toast only after main answered, intents carry
// only form fields (no ids/timestamps minted here), and the second deliberate tap on flagged slips.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { moneyLogic } from './money.js';
import { moneyVals } from '../vals/money.js';

// FX() (logic/shared.js) reads window.HQFx; node has no window — give it a silent one
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

// the fake preload's fixture: the real ported engine's output on placeholder data
const MONEY = JSON.parse(fs.readFileSync(new URL('../../tools/money.fake-views.json', import.meta.url), 'utf8'));

function rig(o = {}) {
  const calls = [], toasts = [];
  const self = Object.assign(Object.create(moneyLogic), {
    state: { mny: {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]), denied(why) { toasts.push(['denied', why]); },
    async call(fn, fail) { const r = await fn(); if (r && r.error) { toasts.push(['error', fail + ' · ' + r.error]); return null; } return r; },
    LIVE: { money: o.money === undefined ? { view: MONEY.full, error: '', loaded: true } : o.money },
    hq: o.noBridge ? null : { money: { read() {}, apply() {}, importFile() {}, exportFile: async () => ({ canceled: true }) }, actedOn: (x) => calls.push(['xp', x]) },
    store: {
      refreshMoney: () => calls.push(['refresh']),
      applyMoney: async (intent) => { calls.push(['apply', intent]); return o.apply ? o.apply(intent) : { view: MONEY.full, note: 'saved' }; },
      importMoney: async () => ({ canceled: true }),
    },
  });
  const ctx = (sub = 'today', live = true) => ({ S: self.state, LIVE: self.LIVE, sub, live, tabStyle: (a) => ({ on: a }) });
  const vals = (sub, live) => moneyVals.call(self, ctx(sub, live));
  return { self, calls, toasts, vals };
}

test('every key is mny-prefixed (one shared namespace with the other surfaces)', () => {
  const { vals } = rig();
  for (const sub of ['today', 'runway', 'jars', 'inbox']) for (const k of Object.keys(vals(sub))) assert.match(k, /^(mny|onMny)[A-Z]/, k);
});

test('load states are honest and exclusive: offline · error · loading · ready', () => {
  const pick = (v) => ['mnyOffline', 'mnyError', 'mnyLoading', 'mnyReady'].filter((k) => v[k]);
  assert.deepEqual(pick(rig({ noBridge: true }).vals()), ['mnyOffline']);
  assert.deepEqual(pick(rig({ money: { view: null, error: 'disk full', loaded: true } }).vals()), ['mnyError']);
  assert.deepEqual(pick(rig({ money: { view: null, error: '', loaded: false } }).vals()), ['mnyLoading']);
  assert.deepEqual(pick(rig().vals()), ['mnyReady']);
  assert.equal(rig({ money: { view: MONEY.empty, error: '', loaded: true } }).vals().mnyNoAccounts, true);
});

test('time machine: money says it stays live when scrubbed', () => {
  assert.equal(rig().vals('today', false).mnyScrubbed, true);
  assert.equal(rig().vals('today', true).mnyScrubbed, false);
});

test('log sends only the form fields; keeps currency/category/account, clears amount + note; xp after success', async () => {
  const { self, calls, toasts } = rig();
  self.mnyField('log', 'amount', '350'); self.mnyField('log', 'category', 'Food'); self.mnyField('log', 'note', 'bread');
  await self.mnyLog();
  const [, intent] = calls.find((c) => c[0] === 'apply');
  assert.deepEqual(Object.keys(intent).sort(), ['accountId', 'amount', 'category', 'currency', 'note', 'type']);
  assert.equal(intent.accountId, MONEY.full.accounts[0].id);
  assert.deepEqual([self.state.mny.log.amount, self.state.mny.log.note, self.state.mny.log.category], ['', '', 'Food']);
  assert.deepEqual(toasts, [['success', 'saved']]);
  assert.ok(calls.some((c) => c[0] === 'xp'));
  assert.equal(self.state.mny.busy, false);
});

test('a refused write toasts main’s real error, releases the guard, keeps the draft, no xp', async () => {
  const { self, calls, toasts } = rig({ apply: () => ({ error: 'amount needs a number above 0.' }) });
  self.mnyField('log', 'amount', 'abc');
  assert.equal(await self.mnyApply({ type: 'log', amount: 'abc' }), false);
  assert.deepEqual(toasts, [['error', 'amount needs a number above 0.']]);
  assert.equal(self.state.mny.busy, false);
  assert.equal(self.state.mny.log.amount, 'abc');
  assert.ok(!calls.some((c) => c[0] === 'xp'));
});

test('double submit: a second write while one is in flight sends nothing', async () => {
  let release; const { self, calls } = rig({ apply: () => new Promise((r) => { release = () => r({ view: MONEY.full, note: 'ok' }); }) });
  const first = self.mnyApply({ type: 'inbox-clear' });
  assert.equal(await self.mnyApply({ type: 'inbox-clear' }), false);
  release(); await first;
  assert.equal(calls.filter((c) => c[0] === 'apply').length, 1);
});

test('no bridge: writes are denied with the reason, nothing sent', async () => {
  const { self, toasts } = rig({ noBridge: true });
  assert.equal(await self.mnyApply({ type: 'inbox-clear' }), false);
  assert.match(toasts[0][1], /desktop bridge/);
});

test('a flagged slip (promo) needs a second deliberate tap, then sends anyway:true', async () => {
  const { self, calls, vals } = rig();
  const promo = vals('inbox').mnySlips.find((c) => c.warn);
  assert.ok(promo, 'fixture has a promo slip');
  promo.confirm();
  assert.equal(calls.filter((c) => c[0] === 'apply').length, 0);
  const armed = vals('inbox').mnySlips.find((c) => c.id === promo.id);
  assert.equal(armed.confirmLabel, 'Confirm anyway');
  assert.match(armed.warnLine, /promotion/);
  await armed.confirm();
  const [, intent] = calls.find((c) => c[0] === 'apply');
  assert.deepEqual([intent.type, intent.id, intent.anyway], ['inbox-confirm', promo.id, true]);
});

test('archive asks inline first; Keep it sends nothing, Archive sends the intent', async () => {
  const { self, calls, vals } = rig();
  vals('runway').mnyObligations[0].archive();
  assert.match(vals('runway').mnyAskText, /^Archive /);
  self.mnyAskNo();
  assert.equal(vals('runway').mnyHasAsk, false);
  vals('runway').mnyObligations[0].archive();
  self.mnyAskYes();
  await new Promise((r) => setTimeout(r, 0));
  const [, intent] = calls.find((c) => c[0] === 'apply');
  assert.equal(intent.type, 'obligation-archive');
});

// ---- fleet review 2026-11-05 (autonomous loop iteration 2): four reproduced bugs ----------------------------------
const pressed = (chips) => chips.filter((c) => c.pressed === 'true').map((c) => c.label);

test('clearing the DA rate shows an empty field (not the saved one) — what Save sends is what is shown', async () => {
  const { self, calls, vals } = rig();
  assert.equal(vals().mnyFx, MONEY.full.settings.fx, 'untouched: the saved rate');
  self.mnyField('set', 'fx', '');
  assert.equal(vals().mnyFx, '', 'cleared: the field is empty, it does not snap back to the saved rate');
  self.mnyField('set', 'fx', '252');
  assert.equal(vals().mnyFx, '252');
  self.mnyField('set', 'payday', '');
  assert.equal(vals().mnyPd, '', 'payday follows the same rule');
  await self.mnySaveSettings();
  assert.deepEqual(calls.find((c) => c[0] === 'apply')[1], { type: 'settings', fxDaPerUsd: '252', paydayDay: '' });
});

test('log: an explicit "no account" pick stays shown as picked, and that is what is sent', async () => {
  const { self, calls, vals } = rig();
  assert.deepEqual(pressed(vals().mnyLogAccts), [MONEY.full.accounts[0].name], 'untouched: the first account');
  self.mnyField('log', 'accountId', '');
  assert.deepEqual(pressed(vals().mnyLogAccts), ['no account'], 'was: Cash still shown pressed');
  self.mnyField('log', 'amount', '350');
  await self.mnyLog();
  assert.equal(calls.find((c) => c[0] === 'apply')[1].accountId, '');
});

test('pay: the empty chip says "bill’s account" when the bill has one (main pays from it), "no account" when not', () => {
  const withAcct = MONEY.full.obligations.find((o) => o.accountId), without = MONEY.full.obligations.find((o) => !o.accountId);
  const { self, vals } = rig();
  self.mnyOpen('pay', { id: withAcct.id, amount: '', accountId: '' });
  assert.deepEqual(pressed(vals('runway').mnyPayAccts), ['bill’s account'], 'was: "no account" pressed while main used the bill’s account');
  if (without) {
    self.mnyOpen('pay', { id: without.id, amount: '', accountId: '' });
    assert.deepEqual(pressed(vals('runway').mnyPayAccts), ['no account']);
  }
});

test('a spend typed while the previous one saves survives; a submit while busy is toasted, never silently dropped', async () => {
  let release; const { self, calls, toasts } = rig({ apply: () => new Promise((r) => { release = () => r({ view: MONEY.full, note: 'saved' }); }) });
  self.mnyField('log', 'amount', '350'); self.mnyField('log', 'note', 'coffee');
  const first = self.mnyLog();
  self.mnyField('log', 'amount', '1200'); self.mnyField('log', 'note', 'taxi'); self.mnyField('log', 'category', 'Transport');
  await self.mnyLog();   // Enter while the first is in flight
  assert.equal(calls.filter((c) => c[0] === 'apply').length, 1, 'still one write');
  assert.ok(toasts.some(([k, t]) => k === 'info' && /still saving/i.test(t)), 'the dropped submit says so');
  release(); await first;
  const d = self.state.mny.log;
  assert.deepEqual([d.amount, d.note, d.category], ['1200', 'taxi', 'Transport'], 'was: wiped back to the first spend’s leftovers');
});

test('Archive tapped while busy keeps the bar (the tap is not lost); it closes once the archive saved', async () => {
  let release; const { self, calls } = rig({ apply: () => new Promise((r) => { release = () => r({ view: MONEY.full, note: 'ok' }); }) });
  const busy = self.mnyApply({ type: 'inbox-clear' });
  self.mnyAsk('jar-archive', { id: 'j1' }, 'Archive Food?');
  await self.mnyAskYes();
  assert.ok(self.state.mny.ask, 'was: the bar vanished and the archive was dropped');
  release(); await busy;
  const done = self.mnyAskYes();
  release(); await done;
  assert.equal(self.state.mny.ask, null, 'closed after the archive saved');
  assert.deepEqual(calls.filter((c) => c[0] === 'apply').map((c) => c[1].type), ['inbox-clear', 'jar-archive']);
});
