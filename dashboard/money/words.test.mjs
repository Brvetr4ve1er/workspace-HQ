// What a Claude session may know about Money: words and counts only (dashboard/money/words.mjs).
//   node --test dashboard/money/words.test.mjs
// Invented placeholder data only: the repo is public. The planted names and amounts below must never appear in an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { words, ROOM_WHY } from './words.mjs';
import { sanitizeState } from './store.mjs';
import { buildView } from './view.mjs';

const NOW = new Date(2026, 10, 10, 12, 0, 0);   // 10 Nov 2026, local noon
const stamp = new Date(2026, 10, 1, 12).toISOString();
const PLANT = { account: 'ZZ-Planted-Account', bill: 'ZZ-Planted-Bill', note: 'ZZ-Planted-Note', jar: 'ZZ-Planted-Jar', merchant: 'ZZ-Planted-Merchant' };

const ob = (id, firstDue, over = {}) => ({ id, name: PLANT.bill + '-' + id, amount: 4321987, currency: 'DA', kind: 'bill', cadence: 'monthly', firstDue, accountId: null, installment: null, nextStep: '', archived: false, updatedAt: stamp, ...over });
function stateOf({ accounts = 1, fx = 137.25, payday = 25, obligations = [], slips = 0 } = {}) {
  return sanitizeState({
    money: {
      accounts: Array.from({ length: accounts }, (_, i) => ({ id: 'a' + i, name: PLANT.account + i, currency: 'DA', anchorBalance: 9876543, anchorAt: stamp, archived: false, updatedAt: stamp })),
      obligations,
      jars: [{ id: 'j1', name: PLANT.jar, target: 7654321, updatedAt: stamp }],
      settings: { fxDaPerUsd: fx, paydayDay: payday },
    },
    transactions: [{ id: 't1', amountDA: 1234567, category: 'Food', date: '2026-11-08', note: PLANT.note, accountId: 'a0' }],
    inbox: { candidates: Array.from({ length: slips }, (_, i) => ({ id: 'c' + i, merchant: PLANT.merchant, amount: 2468135, currency: 'DA', date: '2026-11-09', confidence: 0.9, updatedAt: stamp, status: 'pending', flags: [], suggestedCategory: 'Food', sources: [{ from: 'x', text: 'slip text ' + i }] })) },
  });
}
const viewOf = (o) => buildView(stateOf(o), NOW);

test('no account yet: setUp false and no other claim', () => {
  const a = words(viewOf({ accounts: 0, obligations: [ob('b1', '2026-11-01')], slips: 2 }));
  assert.deepEqual(a, { enabled: true, setUp: false, room: 'unknown', roomWhy: null, daysToPayday: null, billsLate: null, billsDueSoon: null, slipsWaiting: null });
});

test('room: ok, tight, and unknown (rate first, then payday) as a table', () => {
  const rows = [
    // [options, room, why]
    [{}, 'ok', null],
    [{ fx: null }, 'unknown', ROOM_WHY.fx],
    [{ payday: null }, 'unknown', ROOM_WHY.payday],
    [{ fx: null, payday: null }, 'unknown', ROOM_WHY.fx],
  ];
  for (const [o, room, why] of rows) {
    const a = words(viewOf(o));
    assert.equal(a.setUp, true);
    assert.equal(a.room, room, JSON.stringify(o));
    assert.equal(a.roomWhy, why, JSON.stringify(o));
  }
  assert.equal(ROOM_WHY.fx, 'needs a DA rate');
  assert.equal(ROOM_WHY.payday, 'needs a payday day');
  // tight: the due bills before payday eat everything held
  const tight = words(viewOf({ obligations: [ob('b1', '2026-11-12', { amount: 99999999 })] }));
  assert.equal(tight.room, 'tight');
  assert.equal(tight.roomWhy, null);
  // unknown wins over tight when a rate is missing
  assert.equal(words(viewOf({ fx: null, obligations: [ob('b1', '2026-11-12', { amount: 99999999 })] })).room, 'unknown');
});

test('late and due-soon counts come from the obligation flags (and archived or paid-off bills do not count)', () => {
  const obligations = [
    ob('b1', '2026-11-01'),                       // 9 days late
    ob('b2', '2026-11-09'),                       // late
    ob('b3', '2026-11-10'),                       // due today: soon
    ob('b4', '2026-11-13'),                       // 3 days: soon
    ob('b5', '2026-11-14'),                       // 4 days: upcoming
    ob('b6', '2026-11-02', { archived: true }),   // archived: not a bill any more
    ob('b7', '2026-11-01', { cadence: 'once', installment: { total: 2, paidBefore: 2 } }),   // paid off
  ];
  const a = words(viewOf({ obligations }));
  assert.equal(a.billsLate, 2);
  assert.equal(a.billsDueSoon, 2);
  assert.equal(words(viewOf({ obligations: [] })).billsLate, 0);
  // the counts follow the flags, nothing else: a hand-made view proves it
  const fake = { hasAccounts: true, settings: { hasFx: true, payday: '25' }, room: { tight: false }, daysToPayday: 5, obligations: [{ isLate: true }, { isLate: true, name: 'x' }, { isSoon: true }, { isLate: 'yes' }, null, {}], slips: [{}, {}, {}] };
  const b = words(fake);
  assert.deepEqual([b.billsLate, b.billsDueSoon, b.slipsWaiting], [2, 1, 3]);
});

test('slipsWaiting counts the pending inbox slips', () => {
  assert.equal(words(viewOf({ slips: 3 })).slipsWaiting, 3);
  assert.equal(words(viewOf({ slips: 0 })).slipsWaiting, 0);
});

test('daysToPayday: the day count with a payday day, null without one', () => {
  assert.equal(words(viewOf({ payday: 25 })).daysToPayday, 15);   // 10 Nov to 25 Nov
  assert.equal(words(viewOf({ payday: 10 })).daysToPayday, 30);   // payday today: the next one is a month on
  assert.equal(words(viewOf({ payday: null })).daysToPayday, null);
  for (const bad of [-1, 1.5, NaN, '15', null, undefined]) assert.equal(words({ hasAccounts: true, settings: { hasFx: true, payday: '25' }, room: {}, daysToPayday: bad }).daysToPayday, null, String(bad));
});

test('the answer holds no amount, no name, no note, no digit run past 3 and no dueBefore/billsBeforePayday', () => {
  const a = words(viewOf({ obligations: [ob('b1', '2026-11-01'), ob('b2', '2026-11-12')], slips: 2 }), { generatedAt: '2026-11-10T12:00:00.000Z' });
  const { generatedAt, ...rest } = a;
  assert.equal(generatedAt, '2026-11-10T12:00:00.000Z');
  const text = JSON.stringify(rest);
  assert.doesNotMatch(text, /\d{4,}/);
  assert.doesNotMatch(text, /ZZ-Planted/);
  for (const n of ['9876543', '4321987', '1234567', '7654321', '2468135', '137.25']) assert.ok(!text.includes(n), n);
  assert.equal('dueBefore' in a, false);
  assert.equal('billsBeforePayday' in a, false);
  assert.doesNotMatch(text, /dueBefore|billsBeforePayday|amount|balance|DA\b/);
  // exactly this key set, nothing more
  assert.deepEqual(Object.keys(rest).sort(), ['billsDueSoon', 'billsLate', 'daysToPayday', 'enabled', 'room', 'roomWhy', 'setUp', 'slipsWaiting']);
});

test('extra, hostile fields on the view never pass through', () => {
  const v = { ...viewOf({}), dueBefore: '4 321 987 DA', accounts: [{ name: PLANT.account }], jars: [{ name: PLANT.jar }], recent: [{ note: PLANT.note }], billsBeforePayday: 7 };
  const text = JSON.stringify(words(v));
  assert.doesNotMatch(text, /ZZ-Planted|4 321|billsBeforePayday|dueBefore/);
});

test('junk in, a calm answer out (never throws)', () => {
  for (const junk of [null, undefined, 5, 'x', [], {}]) {
    const a = words(junk);
    assert.equal(a.enabled, true);
    assert.equal(a.setUp, false);
    assert.equal(a.room, 'unknown');
  }
  assert.equal('generatedAt' in words({}), false);
});
