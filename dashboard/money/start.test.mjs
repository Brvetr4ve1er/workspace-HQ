// money space — the start card's plan (dashboard/money/start.mjs). Pure.
//   node --test dashboard/money/start.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStart, START_ACCOUNTS, EMPTY_ERROR, ALREADY_ERROR } from './start.mjs';

const NOW = '2026-11-05T09:00:00.000Z';
const run = (input, accounts = []) => { let n = 0; return planStart({ accounts, input, nowISO: NOW, newId: () => 'id' + (++n) }); };

test('blank fields are skipped: only typed balances become accounts', () => {
  const r = run({ cashDA: '12 000', bankDA: '', cardUSD: '   ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.accounts.map((a) => [a.id, a.name, a.currency, a.anchorBalance]), [['id1', 'Cash', 'DA', 12000]]);
  assert.equal(r.note, 'Money started · 1 account added');
  assert.deepEqual(r.settings, { fxDaPerUsd: null, paydayDay: null });
});

test('all three, in order, each anchored at now and live; the USD balance is kept as typed', () => {
  const r = run({ cashDA: '5000', bankDA: 80000.5, cardUSD: '12.49', fxDaPerUsd: '135,5', paydayDay: '25' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.accounts.map((a) => [a.name, a.currency, a.anchorBalance]), [['Cash', 'DA', 5000], ['CCP / bank', 'DA', 80000.5], ['RedotPay card', 'USD', 12.49]]);
  for (const a of r.accounts) assert.deepEqual([a.anchorAt, a.updatedAt, a.archived], [NOW, NOW, false]);
  assert.deepEqual(r.settings, { fxDaPerUsd: 135.5, paydayDay: 25 });
  assert.equal(r.note, 'Money started · 3 accounts added');
  assert.deepEqual(START_ACCOUNTS.map((s) => s.key), ['cashDA', 'bankDA', 'cardUSD']);
});

test('localized numbers read like account-save reads them; zero is a fine balance', () => {
  assert.equal(run({ cashDA: '1.200,00' }).accounts[0].anchorBalance, 1200);
  assert.equal(run({ cashDA: '2 500' }).accounts[0].anchorBalance, 2500);
  for (const zero of ['0', '0,00', '00', 0]) assert.equal(run({ cardUSD: zero }).accounts[0].anchorBalance, 0, String(zero));
});

test('junk, negative and a billion or more are refused by name; nothing is half-made', () => {
  for (const bad of ['abc', '-5', -5, '1e9', 1e9, '12abc', NaN, {}]) {
    const r = run({ cashDA: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.error, /^Cash needs a number/);
    assert.equal(r.accounts, undefined);
  }
  assert.match(run({ cashDA: '10', cardUSD: 'x' }).error, /^RedotPay card needs a number/);
});

test('payday is a whole day 1–28; the rate is above 0', () => {
  for (const ok of ['1', 28, '15']) assert.equal(run({ cashDA: '1', paydayDay: ok }).settings.paydayDay, Number(ok));
  for (const bad of ['0', '29', '1.5', 'x', -3]) assert.equal(run({ cashDA: '1', paydayDay: bad }).error, 'payday is a day from 1 to 28.', String(bad));
  assert.equal(run({ cashDA: '1', fxDaPerUsd: '0' }).error, 'rate needs a number above 0.');
  assert.equal(run({ cashDA: '1', fxDaPerUsd: 'abc' }).error, 'rate needs a number above 0.');
  assert.equal(run({ cashDA: '1', fxDaPerUsd: 1e9 }).ok, false);
});

test('all blank is refused with the spec copy, even when a rate or payday is typed', () => {
  assert.deepEqual(run({}), { ok: false, error: EMPTY_ERROR });
  assert.equal(EMPTY_ERROR, 'add at least one balance, or import an Ember export.');
  assert.equal(run({ cashDA: '', bankDA: null, fxDaPerUsd: '135', paydayDay: '5' }).error, EMPTY_ERROR);
  assert.equal(run(null).error, EMPTY_ERROR);
  assert.equal(run('cash').error, EMPTY_ERROR);
  assert.equal(run([1, 2]).error, EMPTY_ERROR);
});

test('refused once any live account exists; archived ones do not count', () => {
  const live = [{ id: 'x', name: 'Cash', currency: 'DA', archived: false }];
  assert.deepEqual(run({ cashDA: '100' }, live), { ok: false, error: ALREADY_ERROR });
  assert.equal(ALREADY_ERROR, 'Money is already set up — edit accounts on Today.');
  // already-set-up wins over a blank form: the owner is told the real reason
  assert.equal(run({}, live).error, ALREADY_ERROR);
  assert.equal(run({ cashDA: '100' }, [{ id: 'x', name: 'Old', currency: 'DA', archived: true }]).ok, true);
});

test('ids come from the injected minter, one per account, nothing else is random', () => {
  const ids = [];
  planStart({ accounts: [], input: { cashDA: '1', bankDA: '2' }, nowISO: NOW, newId: () => { ids.push('k' + ids.length); return ids[ids.length - 1]; } });
  assert.deepEqual(ids, ['k0', 'k1']);
  // a refused start mints nothing
  let minted = 0;
  planStart({ accounts: [], input: { cashDA: 'oops' }, nowISO: NOW, newId: () => { minted++; return 'z'; } });
  assert.equal(minted, 0);
});
