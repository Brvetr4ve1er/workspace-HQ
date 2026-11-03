// Ported verbatim from Ember src/engine/money.test.ts (types stripped; vitest -> vitest-shim.mjs on node:test).
import { describe, it, expect } from './vitest-shim.mjs';
import { DUE_SOON_DAYS, accountBalance, advanceDue, breathingRoom, charmSuggestionId, charmSuggestions, cyclesDueBy, jarBalance, jarView, nextPayday, obligationView, obligationViews, recurringAudit, toDA, } from './engine.mjs';
import { addDaysISO } from './dates.mjs';
import { defaultMoney, } from './state.mjs';
const TODAY = '2026-10-09';
const UPDATED = '2026-10-01T00:00:00.000Z';
/** ISO datetime of a LOCAL wall-clock time, so local-day logic is TZ-proof. */
const at = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
const account = (over = {}) => ({
    id: 'acc-1',
    name: 'CCP',
    currency: 'DA',
    anchorBalance: 50_000,
    anchorAt: at(2026, 10, 5, 12),
    archived: false,
    updatedAt: UPDATED,
    ...over,
});
const tx = (over = {}) => ({
    id: 'tx-1',
    amountDA: 1_000,
    category: 'Food',
    date: '2026-10-06',
    accountId: 'acc-1',
    ...over,
});
const obligation = (over = {}) => ({
    id: 'ob-1',
    name: 'Internet',
    amount: 2_000,
    currency: 'DA',
    kind: 'bill',
    cadence: 'monthly',
    firstDue: '2026-10-15',
    accountId: null,
    installment: null,
    nextStep: '',
    archived: false,
    updatedAt: UPDATED,
    ...over,
});
let payN = 0;
const payment = (over = {}) => {
    payN += 1;
    return {
        id: `pay-${String(payN).padStart(3, '0')}`,
        obligationId: 'ob-1',
        due: '2026-10-15',
        paidOn: '2026-10-14',
        amount: 2_000,
        currency: 'DA',
        txId: `ptx-${payN}`,
        void: false,
        updatedAt: UPDATED,
        ...over,
    };
};
const jar = (over = {}) => ({
    id: 'jar-1',
    name: 'Laptop',
    emoji: '💻',
    target: 100_000,
    targetDate: '2027-03-01',
    locked: false,
    archived: false,
    updatedAt: UPDATED,
    ...over,
});
const move = (over = {}) => ({
    id: 'mv-1',
    jarId: 'jar-1',
    amount: 10_000,
    date: '2026-10-02',
    kind: 'topup',
    ...over,
});
const charm = (over = {}) => ({
    id: 'ch-1',
    kind: 'category',
    jarId: 'jar-1',
    category: 'Food',
    value: 200,
    since: '2026-10-01',
    active: true,
    archived: false,
    updatedAt: UPDATED,
    ...over,
});
const income = (over = {}) => ({
    id: 'inc-1',
    accountId: 'acc-1',
    amount: 5_000,
    date: '2026-10-06',
    at: at(2026, 10, 6, 9),
    note: '',
    ...over,
});
const settings = (over = {}) => ({
    ...defaultMoney().settings,
    ...over,
});
const money = (over = {}) => ({ ...defaultMoney(), ...over });
/* ------------------------------ currency ------------------------------ */
describe('toDA', () => {
    it('passes DA through untouched, even without a rate', () => {
        expect(toDA(1234.5, 'DA', null)).toBe(1234.5);
        expect(toDA(1234, 'DA', 240)).toBe(1234);
    });
    it('converts USD with a rate, rounding to whole DA', () => {
        expect(toDA(10, 'USD', 240)).toBe(2400);
        expect(toDA(3, 'USD', 240.5)).toBe(722);
    });
    it('returns null for USD without a rate', () => {
        expect(toDA(10, 'USD', null)).toBeNull();
    });
});
/* ------------------------------ accounts ------------------------------ */
describe('accountBalance', () => {
    it('is the anchor and not an estimate when nothing moved', () => {
        const b = accountBalance(account(), [], money(), TODAY);
        expect(b.balance).toBe(50_000);
        expect(b.balanceDA).toBe(50_000);
        expect(b.isEstimate).toBe(false);
    });
    it('subtracts spend logged after the anchor via `at`, ignores spend before it', () => {
        const txs = [
            tx({ id: 'a', amountDA: 1_000, date: '2026-10-05', at: at(2026, 10, 5, 14) }),
            tx({ id: 'b', amountDA: 700, date: '2026-10-05', at: at(2026, 10, 5, 10) }),
        ];
        const b = accountBalance(account(), txs, money(), TODAY);
        expect(b.balance).toBe(49_000);
        expect(b.isEstimate).toBe(true);
    });
    it('`at` decides even when the date field disagrees', () => {
        // Recorded before the anchor, though its day key is later — `at` wins.
        const txs = [tx({ amountDA: 500, date: '2026-10-08', at: at(2026, 10, 5, 11) })];
        expect(accountBalance(account(), txs, money(), TODAY).balance).toBe(50_000);
    });
    it('rows without `at` count only when their date is strictly after the anchor local day', () => {
        const txs = [
            tx({ id: 'same', amountDA: 100, date: '2026-10-05' }),
            tx({ id: 'before', amountDA: 200, date: '2026-10-04' }),
            tx({ id: 'after', amountDA: 400, date: '2026-10-06' }),
        ];
        expect(accountBalance(account(), txs, money(), TODAY).balance).toBe(49_600);
    });
    it('uses the anchor LOCAL day (late-night anchor stays on its own day)', () => {
        const late = account({ anchorAt: at(2026, 10, 5, 23) });
        const early = account({ anchorAt: at(2026, 10, 5, 0) });
        const txs = [tx({ amountDA: 100, date: '2026-10-06' }), tx({ id: 't2', amountDA: 50, date: '2026-10-05' })];
        expect(accountBalance(late, txs, money(), TODAY).balance).toBe(49_900);
        expect(accountBalance(early, txs, money(), TODAY).balance).toBe(49_900);
    });
    it('ignores resisted rows, other accounts, and unassigned rows', () => {
        const txs = [
            tx({ id: 'r', amountDA: 100, resistedImpulse: true }),
            tx({ id: 'o', amountDA: 200, accountId: 'acc-2' }),
            tx({ id: 'u', amountDA: 300, accountId: undefined }),
        ];
        const b = accountBalance(account(), txs, money(), TODAY);
        expect(b.balance).toBe(50_000);
        expect(b.isEstimate).toBe(false);
    });
    it('USD account uses original.amount, falling back to amountDA / fx', () => {
        const usd = account({ currency: 'USD', anchorBalance: 100 });
        const txs = [
            tx({ id: 'orig', amountDA: 2_400, original: { amount: 10, currency: 'USD' } }),
            tx({ id: 'conv', amountDA: 480 }),
        ];
        const b = accountBalance(usd, txs, money({ settings: settings({ fxDaPerUsd: 240 }) }), TODAY);
        expect(b.balance).toBe(88);
        expect(b.balanceDA).toBe(88 * 240);
        expect(b.isEstimate).toBe(true);
    });
    it('USD account uses original.amount even without a rate', () => {
        const usd = account({ currency: 'USD', anchorBalance: 100 });
        const txs = [tx({ amountDA: 2_400, original: { amount: 10, currency: 'USD' } })];
        const b = accountBalance(usd, txs, money(), TODAY);
        expect(b.balance).toBe(90);
        expect(b.balanceDA).toBeNull();
    });
    it('USD account skips DA-only rows when there is no rate (and stays a non-estimate)', () => {
        const usd = account({ currency: 'USD', anchorBalance: 100 });
        const b = accountBalance(usd, [tx({ amountDA: 480 })], money(), TODAY);
        expect(b.balance).toBe(100);
        expect(b.isEstimate).toBe(false);
        expect(b.balanceDA).toBeNull();
    });
    it('DA account uses amountDA even when the row has a USD original', () => {
        const txs = [tx({ amountDA: 2_400, original: { amount: 10, currency: 'USD' } })];
        expect(accountBalance(account(), txs, money(), TODAY).balance).toBe(47_600);
    });
    it('adds incomes recorded after anchorAt only, for this account only', () => {
        const anchorAt = at(2026, 10, 5, 12);
        const m = money({
            incomes: [
                income({ id: 'after', amount: 5_000 }),
                income({ id: 'equal', amount: 1_000, at: anchorAt }),
                income({ id: 'before', amount: 2_000, at: at(2026, 10, 5, 8) }),
                income({ id: 'other', amount: 3_000, accountId: 'acc-2' }),
            ],
        });
        const b = accountBalance(account({ anchorAt }), [], m, TODAY);
        expect(b.balance).toBe(55_000);
        expect(b.isEstimate).toBe(true);
    });
    it('reports whole days since the anchor local day, never negative', () => {
        expect(accountBalance(account(), [], money(), TODAY).daysSinceConfirmed).toBe(4);
        expect(accountBalance(account({ anchorAt: at(2026, 10, 9, 1) }), [], money(), TODAY).daysSinceConfirmed).toBe(0);
        expect(accountBalance(account({ anchorAt: at(2026, 10, 12, 1) }), [], money(), TODAY).daysSinceConfirmed).toBe(0);
    });
    // BUG: `at` / anchorAt are compared as strings. The sanitizer accepts ISO
    // datetimes both with and without milliseconds, and '…T10:00:00.500Z' sorts
    // BEFORE '…T10:00:00Z' ('.' < 'Z'), so spend 0.5s after a seconds-precision
    // anchor is treated as before it.
    it('compares `at` against anchorAt chronologically across ISO precisions', () => {
        const acc = account({ anchorAt: '2026-10-05T10:00:00Z' });
        const txs = [tx({ amountDA: 1_000, at: '2026-10-05T10:00:00.500Z' })];
        expect(accountBalance(acc, txs, money(), TODAY).balance).toBe(49_000);
    });
});
/* ----------------------------- obligations ----------------------------- */
describe('advanceDue', () => {
    it('returns the day unchanged for n = 0', () => {
        expect(advanceDue('2026-01-31', 'monthly', 0)).toBe('2026-01-31');
    });
    it('weekly adds 7 days per cycle, crossing months', () => {
        expect(advanceDue('2026-10-09', 'weekly', 1)).toBe('2026-10-16');
        expect(advanceDue('2026-10-30', 'weekly', 2)).toBe('2026-11-13');
    });
    it('monthly clamps month ends instead of drifting', () => {
        expect(advanceDue('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
        expect(advanceDue('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
        expect(advanceDue('2026-01-31', 'monthly', 3)).toBe('2026-04-30');
        expect(advanceDue('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
        expect(advanceDue('2026-11-15', 'monthly', 2)).toBe('2027-01-15');
    });
    it('yearly adds 12 months, clamping Feb 29', () => {
        expect(advanceDue('2026-10-09', 'yearly', 1)).toBe('2027-10-09');
        expect(advanceDue('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
        expect(advanceDue('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
    });
    it('once behaves as monthly when advanced (only reached before it is done)', () => {
        expect(advanceDue('2026-10-09', 'once', 1)).toBe('2026-11-09');
    });
});
describe('obligationView', () => {
    const status = (firstDue) => obligationView(obligation({ firstDue }), money(), TODAY);
    it('is late when the next due is before today', () => {
        const v = status('2026-10-08');
        expect(v.status).toBe('late');
        expect(v.daysUntil).toBe(-1);
    });
    it('is due_soon from today through DUE_SOON_DAYS ahead, upcoming after', () => {
        expect(DUE_SOON_DAYS).toBe(3);
        expect(status(TODAY).status).toBe('due_soon');
        expect(status(TODAY).daysUntil).toBe(0);
        expect(status(addDaysISO(TODAY, DUE_SOON_DAYS)).status).toBe('due_soon');
        expect(status(addDaysISO(TODAY, DUE_SOON_DAYS + 1)).status).toBe('upcoming');
        expect(status(addDaysISO(TODAY, DUE_SOON_DAYS + 1)).daysUntil).toBe(4);
    });
    it('advances nextDue once per live payment', () => {
        const ob = obligation({ firstDue: '2026-09-20' });
        const v = obligationView(ob, money({ payments: [payment({ due: '2026-09-20' })] }), TODAY);
        expect(v.nextDue).toBe('2026-10-20');
        expect(v.status).toBe('upcoming');
        expect(v.payments).toHaveLength(1);
    });
    it('ignores voided payments and other obligations’ payments', () => {
        const ob = obligation({ firstDue: '2026-09-20' });
        const m = money({
            payments: [payment({ void: true }), payment({ obligationId: 'ob-other' })],
        });
        const v = obligationView(ob, m, TODAY);
        expect(v.payments).toEqual([]);
        expect(v.nextDue).toBe('2026-09-20');
        expect(v.status).toBe('late');
    });
    it('a once obligation is done after one payment', () => {
        const ob = obligation({ cadence: 'once', firstDue: '2026-10-01' });
        expect(obligationView(ob, money(), TODAY).status).toBe('late');
        const v = obligationView(ob, money({ payments: [payment()] }), TODAY);
        expect(v.status).toBe('done');
        expect(v.nextDue).toBeNull();
        expect(v.daysUntil).toBeNull();
    });
    it('a once obligation whose only payment was voided is not done', () => {
        const ob = obligation({ cadence: 'once', firstDue: '2026-10-20' });
        const v = obligationView(ob, money({ payments: [payment({ void: true })] }), TODAY);
        expect(v.status).toBe('upcoming');
    });
    it('installments count paidBefore plus payments, done at total', () => {
        const ob = obligation({ kind: 'installment', firstDue: '2026-10-15', installment: { total: 6, paidBefore: 4 } });
        const none = obligationView(ob, money(), TODAY);
        expect(none.installmentPaid).toBe(4);
        expect(none.nextDue).toBe('2026-10-15');
        const one = obligationView(ob, money({ payments: [payment({ due: '2026-10-15' })] }), TODAY);
        expect(one.installmentPaid).toBe(5);
        expect(one.nextDue).toBe('2026-11-15');
        const two = obligationView(ob, money({ payments: [payment({ due: '2026-10-15' }), payment({ due: '2026-11-15' })] }), TODAY);
        expect(two.installmentPaid).toBe(6);
        expect(two.status).toBe('done');
        expect(two.nextDue).toBeNull();
    });
    it('installmentPaid is clamped to total and null for non-installments', () => {
        const ob = obligation({ installment: { total: 2, paidBefore: 2 } });
        expect(obligationView(ob, money({ payments: [payment()] }), TODAY).installmentPaid).toBe(2);
        expect(obligationView(obligation(), money(), TODAY).installmentPaid).toBeNull();
    });
    it('variable bills estimate the rounded mean of the last 3 payments', () => {
        const ob = obligation({ kind: 'variable', amount: 1_500, firstDue: '2026-06-10' });
        const m = money({
            payments: [
                payment({ due: '2026-09-10', amount: 4_500 }),
                payment({ due: '2026-06-10', amount: 1_000 }),
                payment({ due: '2026-08-10', amount: 3_000 }),
                payment({ due: '2026-07-10', amount: 2_000 }),
            ],
        });
        const v = obligationView(ob, m, TODAY);
        expect(v.history).toEqual([2_000, 3_000, 4_500]);
        expect(v.estimate).toBe(3_167);
        expect(v.payments.map((p) => p.due)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']);
    });
    it('variable bills without payments fall back to the typed amount', () => {
        const v = obligationView(obligation({ kind: 'variable', amount: 1_500 }), money(), TODAY);
        expect(v.estimate).toBe(1_500);
        expect(v.history).toEqual([]);
    });
    it('non-variable bills always estimate the typed amount (history still reported)', () => {
        const v = obligationView(obligation({ amount: 2_000 }), money({ payments: [payment({ amount: 9_999 })] }), TODAY);
        expect(v.estimate).toBe(2_000);
        expect(v.history).toEqual([9_999]);
    });
});
describe('obligationViews', () => {
    it('excludes archived, sorts by nextDue, and puts done last', () => {
        const m = money({
            obligations: [
                obligation({ id: 'done', cadence: 'once', firstDue: '2026-10-01' }),
                obligation({ id: 'late', firstDue: '2026-10-02' }),
                obligation({ id: 'soon', firstDue: '2026-10-10' }),
                obligation({ id: 'arch', firstDue: '2026-10-03', archived: true }),
                obligation({ id: 'far', firstDue: '2026-12-01' }),
            ],
            payments: [payment({ obligationId: 'done' })],
        });
        expect(obligationViews(m, TODAY).map((v) => v.obligation.id)).toEqual(['late', 'soon', 'far', 'done']);
    });
});
describe('cyclesDueBy', () => {
    it('a weekly bill hits several times before payday', () => {
        const v = obligationView(obligation({ cadence: 'weekly', firstDue: '2026-10-10' }), money(), TODAY);
        expect(cyclesDueBy(v, '2026-10-31')).toEqual(['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']);
    });
    it('starts after the paid cycles', () => {
        const ob = obligation({ cadence: 'weekly', firstDue: '2026-10-10' });
        const v = obligationView(ob, money({ payments: [payment({ due: '2026-10-10' })] }), TODAY);
        expect(cyclesDueBy(v, '2026-10-31')).toEqual(['2026-10-17', '2026-10-24', '2026-10-31']);
    });
    it('includes overdue cycles', () => {
        const v = obligationView(obligation({ firstDue: '2026-09-01' }), money(), TODAY);
        expect(cyclesDueBy(v, '2026-10-31')).toEqual(['2026-09-01', '2026-10-01']);
    });
    it('monthly cycles from a month end do not drift', () => {
        const v = obligationView(obligation({ firstDue: '2026-01-31' }), money(), '2026-01-01');
        expect(cyclesDueBy(v, '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });
    it('an installment stops at its total', () => {
        const ob = obligation({ cadence: 'weekly', firstDue: '2026-10-10', installment: { total: 3, paidBefore: 1 } });
        const v = obligationView(ob, money(), TODAY);
        expect(cyclesDueBy(v, '2026-12-31')).toEqual(['2026-10-10', '2026-10-17']);
    });
    it('a once obligation yields at most one cycle', () => {
        const v = obligationView(obligation({ cadence: 'once', firstDue: '2026-10-10' }), money(), TODAY);
        expect(cyclesDueBy(v, '2027-12-31')).toEqual(['2026-10-10']);
    });
    it('is empty when done or when nothing is due by the date', () => {
        const once = obligation({ cadence: 'once', firstDue: '2026-10-10' });
        expect(cyclesDueBy(obligationView(once, money({ payments: [payment()] }), TODAY), '2026-12-31')).toEqual([]);
        expect(cyclesDueBy(obligationView(obligation({ firstDue: '2026-11-05' }), money(), TODAY), '2026-10-31')).toEqual([]);
    });
    it('caps runaway loops at 60 cycles', () => {
        const v = obligationView(obligation({ cadence: 'weekly', firstDue: '2020-01-01' }), money(), TODAY);
        expect(cyclesDueBy(v, '2030-01-01')).toHaveLength(60);
    });
});
/* ------------------------------- payday -------------------------------- */
describe('nextPayday', () => {
    it('returns this month’s payday when it is still ahead', () => {
        expect(nextPayday(settings({ paydayDay: 15 }), TODAY)).toBe('2026-10-15');
        expect(nextPayday(settings({ paydayDay: 10 }), TODAY)).toBe('2026-10-10');
    });
    it('on payday itself or after it, returns next month’s', () => {
        expect(nextPayday(settings({ paydayDay: 9 }), TODAY)).toBe('2026-11-09');
        expect(nextPayday(settings({ paydayDay: 5 }), TODAY)).toBe('2026-11-05');
    });
    it('rolls over the year', () => {
        expect(nextPayday(settings({ paydayDay: 20 }), '2026-12-25')).toBe('2027-01-20');
    });
    it('null paydayDay means end of month', () => {
        expect(nextPayday(settings(), TODAY)).toBe('2026-10-31');
        expect(nextPayday(settings(), '2026-02-01')).toBe('2026-02-28');
        expect(nextPayday(settings(), '2028-02-01')).toBe('2028-02-29');
    });
    it('on the last day, null paydayDay moves to next month’s end', () => {
        expect(nextPayday(settings(), '2026-10-31')).toBe('2026-11-30');
        expect(nextPayday(settings(), '2026-02-28')).toBe('2026-03-31');
        expect(nextPayday(settings(), '2026-12-31')).toBe('2027-01-31');
    });
});
/* -------------------------------- jars --------------------------------- */
describe('jarBalance', () => {
    it('sums signed moves for that jar only', () => {
        const m = money({
            jarMoves: [
                move({ id: 'a', amount: 10_000 }),
                move({ id: 'b', amount: -2_500, kind: 'withdraw' }),
                move({ id: 'c', amount: 99_999, jarId: 'jar-2' }),
            ],
        });
        expect(jarBalance(m, 'jar-1')).toBe(7_500);
        expect(jarBalance(m, 'missing')).toBe(0);
    });
});
describe('jarView', () => {
    // 2026-10-09 → 2027-03-01 is 143 days → ceil(143 / 30.4) = 5 months.
    const withBalance = (amount, over = {}) => money({ jarMoves: amount === 0 ? [] : [move({ amount })], ...over });
    it('computes progress, perMonth and monthsLeft toward a dated target', () => {
        const v = jarView(jar(), withBalance(10_000), TODAY);
        expect(v.balance).toBe(10_000);
        expect(v.progress).toBeCloseTo(0.1);
        expect(v.reached).toBe(false);
        expect(v.monthsLeft).toBe(5);
        expect(v.perMonth).toBe(18_000);
        expect(v.overspent).toBe(false);
    });
    it('rounds perMonth up', () => {
        expect(jarView(jar({ target: 100_001 }), withBalance(10_000), TODAY).perMonth).toBe(18_001);
    });
    it('onTrack compares settings.split for this jar against perMonth', () => {
        const split = (amount) => settings({ split: [{ jarId: 'jar-1', amount }] });
        expect(jarView(jar(), withBalance(10_000, { settings: split(18_000) }), TODAY).onTrack).toBe(true);
        expect(jarView(jar(), withBalance(10_000, { settings: split(17_999) }), TODAY).onTrack).toBe(false);
        expect(jarView(jar(), withBalance(10_000), TODAY).onTrack).toBe(false);
        const other = settings({ split: [{ jarId: 'jar-2', amount: 50_000 }] });
        expect(jarView(jar(), withBalance(10_000, { settings: other }), TODAY).onTrack).toBe(false);
    });
    it('clamps progress to 1 and marks reached (no plan needed)', () => {
        const v = jarView(jar(), withBalance(150_000), TODAY);
        expect(v.progress).toBe(1);
        expect(v.reached).toBe(true);
        expect(v.perMonth).toBeNull();
        expect(v.monthsLeft).toBeNull();
        expect(v.onTrack).toBeNull();
    });
    it('reached is inclusive of the exact target', () => {
        expect(jarView(jar(), withBalance(100_000), TODAY).reached).toBe(true);
    });
    it('clamps progress to 0 and flags overspent for a negative balance; plan ignores the deficit', () => {
        const v = jarView(jar(), withBalance(-3_000), TODAY);
        expect(v.progress).toBe(0);
        expect(v.overspent).toBe(true);
        expect(v.perMonth).toBe(20_000);
    });
    it('a past target date still leaves at least one month', () => {
        const v = jarView(jar({ targetDate: '2026-09-01' }), withBalance(10_000), TODAY);
        expect(v.monthsLeft).toBe(1);
        expect(v.perMonth).toBe(90_000);
    });
    it('an open-ended jar has no progress or plan', () => {
        const v = jarView(jar({ target: null, targetDate: null }), withBalance(5_000), TODAY);
        expect(v.progress).toBeNull();
        expect(v.reached).toBe(false);
        expect(v.perMonth).toBeNull();
        expect(v.onTrack).toBeNull();
    });
    it('a target without a date has progress but no plan', () => {
        const v = jarView(jar({ targetDate: null }), withBalance(25_000), TODAY);
        expect(v.progress).toBeCloseTo(0.25);
        expect(v.perMonth).toBeNull();
        expect(v.monthsLeft).toBeNull();
    });
});
/* ---------------------------- breathing room --------------------------- */
describe('breathingRoom', () => {
    const anchorAt = at(2026, 10, 1, 9);
    it('reports hasAccounts false with no live accounts', () => {
        const r = breathingRoom(money({ accounts: [account({ archived: true })] }), [], TODAY);
        expect(r.hasAccounts).toBe(false);
        expect(r.holdingsDA).toBe(0);
    });
    it('is holdings − jars − due before payday', () => {
        const m = money({
            accounts: [account({ anchorAt }), account({ id: 'acc-arch', anchorAt, archived: true })],
            jars: [jar(), jar({ id: 'jar-neg' }), jar({ id: 'jar-arch', archived: true })],
            jarMoves: [
                move({ id: 'm1', amount: 10_000 }),
                move({ id: 'm2', jarId: 'jar-neg', amount: -3_000, kind: 'withdraw' }),
                move({ id: 'm3', jarId: 'jar-arch', amount: 5_000 }),
            ],
            obligations: [
                obligation({ id: 'monthly', amount: 2_000, firstDue: '2026-10-15' }),
                obligation({ id: 'weekly', amount: 500, cadence: 'weekly', firstDue: '2026-10-10' }),
                obligation({ id: 'once-done', amount: 9_000, cadence: 'once', firstDue: '2026-10-01' }),
                obligation({ id: 'after-payday', amount: 7_000, firstDue: '2026-11-05' }),
                obligation({ id: 'archived', amount: 8_000, firstDue: '2026-10-12', archived: true }),
            ],
            payments: [payment({ obligationId: 'once-done' })],
        });
        const txs = [tx({ amountDA: 1_000, date: '2026-10-03' })];
        const r = breathingRoom(m, txs, TODAY);
        expect(r.hasAccounts).toBe(true);
        expect(r.payday).toBe('2026-10-31');
        expect(r.holdingsDA).toBe(49_000);
        expect(r.jarsDA).toBe(10_000); // negative jar contributes 0, archived jar excluded
        expect(r.dueDA).toBe(2_000 + 4 * 500);
        expect(r.room).toBe(49_000 - 10_000 - 4_000);
        expect(r.days).toBe(22);
        expect(r.perDay).toBe(Math.floor(35_000 / 22));
        expect(r.missingFx).toBe(false);
    });
    it('uses the variable-bill estimate for due amounts', () => {
        const m = money({
            accounts: [account({ anchorAt })],
            obligations: [obligation({ kind: 'variable', amount: 1_000, firstDue: '2026-09-20' })],
            payments: [payment({ due: '2026-09-20', amount: 3_000 })],
        });
        expect(breathingRoom(m, [], TODAY).dueDA).toBe(3_000);
    });
    it('a USD obligation without a rate sets missingFx and is excluded', () => {
        const m = money({
            accounts: [account({ anchorAt })],
            obligations: [
                obligation({ id: 'usd', currency: 'USD', amount: 10, firstDue: '2026-10-15' }),
                obligation({ id: 'da', amount: 1_000, firstDue: '2026-10-15' }),
            ],
        });
        const r = breathingRoom(m, [], TODAY);
        expect(r.missingFx).toBe(true);
        expect(r.dueDA).toBe(1_000);
    });
    it('a USD obligation outside the window does not set missingFx', () => {
        const m = money({
            accounts: [account({ anchorAt })],
            obligations: [obligation({ currency: 'USD', amount: 10, firstDue: '2026-11-15' })],
        });
        expect(breathingRoom(m, [], TODAY).missingFx).toBe(false);
    });
    it('converts USD obligations and accounts when a rate is set', () => {
        const m = money({
            accounts: [account({ anchorAt }), account({ id: 'usd', currency: 'USD', anchorBalance: 100, anchorAt })],
            obligations: [obligation({ currency: 'USD', amount: 10, firstDue: '2026-10-15' })],
            settings: settings({ fxDaPerUsd: 240 }),
        });
        const r = breathingRoom(m, [], TODAY);
        expect(r.holdingsDA).toBe(50_000 + 24_000);
        expect(r.dueDA).toBe(2_400);
        expect(r.missingFx).toBe(false);
    });
    it('a USD account without a rate sets missingFx and is excluded from holdings', () => {
        const m = money({
            accounts: [account({ anchorAt }), account({ id: 'usd', currency: 'USD', anchorBalance: 100, anchorAt })],
        });
        const r = breathingRoom(m, [], TODAY);
        expect(r.missingFx).toBe(true);
        expect(r.holdingsDA).toBe(50_000);
    });
    it('floors perDay, including a negative room', () => {
        const m = money({
            accounts: [account({ anchorAt, anchorBalance: 1_000 })],
            obligations: [obligation({ amount: 1_100, firstDue: '2026-10-15' })],
        });
        const r = breathingRoom(m, [], TODAY);
        expect(r.room).toBe(-100);
        expect(r.perDay).toBe(-5); // floor(-100 / 22)
    });
    it('days is at least 1 (payday tomorrow)', () => {
        const m = money({ accounts: [account({ anchorAt })], settings: settings({ paydayDay: 10 }) });
        const r = breathingRoom(m, [], TODAY);
        expect(r.payday).toBe('2026-10-10');
        expect(r.days).toBe(1);
        expect(r.perDay).toBe(50_000);
    });
    it('respects paydayDay when choosing the due window', () => {
        const m = money({
            accounts: [account({ anchorAt })],
            obligations: [obligation({ amount: 2_000, firstDue: '2026-10-15' })],
            settings: settings({ paydayDay: 12 }),
        });
        const r = breathingRoom(m, [], TODAY);
        expect(r.payday).toBe('2026-10-12');
        expect(r.dueDA).toBe(0);
        expect(r.days).toBe(3);
    });
});
/* ------------------------------- charms -------------------------------- */
describe('charmSuggestions', () => {
    const base = (over = {}) => money({ jars: [jar()], ...over });
    it('builds deterministic ids', () => {
        expect(charmSuggestionId('ch-1', 'tx-9')).toBe('charm:ch-1:tx-9');
    });
    it('roundup suggests the gap to the next multiple and skips exact multiples', () => {
        const m = base({ charms: [charm({ kind: 'roundup', category: null, value: 100 })] });
        const out = charmSuggestions(m, [
            tx({ id: 't1', amountDA: 1_250 }),
            tx({ id: 't2', amountDA: 1_300 }),
            tx({ id: 't3', amountDA: 1, category: 'Transport' }),
        ]);
        expect(out.map((s) => [s.id, s.amount])).toEqual([
            ['charm:ch-1:t1', 50],
            ['charm:ch-1:t3', 99],
        ]);
        expect(out[0]).toMatchObject({ jarId: 'jar-1', txId: 't1' });
        expect(out[0].charm.id).toBe('ch-1');
        expect(out[0].label).toContain('Round-up');
    });
    it('category charm sends a fixed amount per matching log', () => {
        const m = base({ charms: [charm({ kind: 'category', category: 'Food', value: 200 })] });
        const out = charmSuggestions(m, [
            tx({ id: 't1', amountDA: 50, category: 'Food' }),
            tx({ id: 't2', amountDA: 5_000, category: 'Transport' }),
        ]);
        expect(out.map((s) => [s.txId, s.amount])).toEqual([['t1', 200]]);
        expect(out[0].label).toContain('Food');
    });
    it('treat-tax charm takes a rounded percent of matching logs', () => {
        const m = base({ charms: [charm({ kind: 'treat-tax', category: 'Fun', value: 15 })] });
        const out = charmSuggestions(m, [
            tx({ id: 't1', amountDA: 1_234, category: 'Fun' }),
            tx({ id: 't2', amountDA: 1_010, category: 'Fun' }),
            tx({ id: 't3', amountDA: 1_000, category: 'Food' }),
            tx({ id: 't4', amountDA: 3, category: 'Fun' }),
        ]);
        // 185.1 → 185, 151.5 → 152, 0.45 → 0 (skipped)
        expect(out.map((s) => [s.txId, s.amount])).toEqual([
            ['t1', 185],
            ['t2', 152],
        ]);
        expect(out[0].label).toContain('15%');
    });
    it('only fires for logs on or after `since`', () => {
        const m = base({ charms: [charm({ since: '2026-10-05' })] });
        const out = charmSuggestions(m, [
            tx({ id: 'before', date: '2026-10-04' }),
            tx({ id: 'on', date: '2026-10-05' }),
            tx({ id: 'after', date: '2026-10-06' }),
        ]);
        expect(out.map((s) => s.txId)).toEqual(['on', 'after']);
    });
    it('ignores inactive or archived charms, and charms on archived or missing jars', () => {
        const txs = [tx()];
        expect(charmSuggestions(base({ charms: [charm({ active: false })] }), txs)).toEqual([]);
        expect(charmSuggestions(base({ charms: [charm({ archived: true })] }), txs)).toEqual([]);
        expect(charmSuggestions(money({ jars: [jar({ archived: true })], charms: [charm()] }), txs)).toEqual([]);
        expect(charmSuggestions(base({ charms: [charm({ jarId: 'nope' })] }), txs)).toEqual([]);
    });
    it('ignores resisted rows, obligation payments, and non-positive amounts', () => {
        const m = base({ charms: [charm()] });
        const out = charmSuggestions(m, [
            tx({ id: 'r', resistedImpulse: true }),
            tx({ id: 'o', obligationId: 'ob-1' }),
            tx({ id: 'z', amountDA: 0 }),
            tx({ id: 'n', amountDA: -50 }),
            tx({ id: 'ok' }),
        ]);
        expect(out.map((s) => s.txId)).toEqual(['ok']);
    });
    it('excludes dismissed ids and already-confirmed jar moves', () => {
        const m = base({
            charms: [charm()],
            dismissed: ['charm:ch-1:t1'],
            jarMoves: [move({ id: 'charm:ch-1:t2', amount: 200, kind: 'charm' })],
        });
        const out = charmSuggestions(m, [tx({ id: 't1' }), tx({ id: 't2' }), tx({ id: 't3' })]);
        expect(out.map((s) => s.id)).toEqual(['charm:ch-1:t3']);
    });
    it('one log can fire several charms, each with its own id', () => {
        const m = base({
            charms: [
                charm({ id: 'a', kind: 'roundup', category: null, value: 100 }),
                charm({ id: 'b', kind: 'category', category: 'Food', value: 300 }),
            ],
        });
        const out = charmSuggestions(m, [tx({ id: 't1', amountDA: 1_250, category: 'Food' })]);
        expect(out.map((s) => [s.id, s.amount])).toEqual([
            ['charm:a:t1', 50],
            ['charm:b:t1', 300],
        ]);
    });
});
/* --------------------------- recurring audit ---------------------------- */
describe('recurringAudit', () => {
    it('excludes once and done obligations and prices the rest per year', () => {
        const m = money({
            obligations: [
                obligation({ id: 'monthly', amount: 2_000 }),
                obligation({ id: 'weekly', amount: 500, cadence: 'weekly' }),
                obligation({ id: 'yearly', amount: 12_000, cadence: 'yearly' }),
                obligation({ id: 'once', amount: 9_000, cadence: 'once' }),
                obligation({ id: 'inst-done', cadence: 'monthly', installment: { total: 3, paidBefore: 3 } }),
                obligation({ id: 'inst-live', amount: 1_000, installment: { total: 3, paidBefore: 1 } }),
                obligation({ id: 'arch', archived: true }),
            ],
        });
        const rows = recurringAudit(m, TODAY);
        const byId = Object.fromEntries(rows.map((r) => [r.view.obligation.id, r.yearlyDA]));
        expect(byId).toEqual({ monthly: 24_000, weekly: 26_000, yearly: 12_000, 'inst-live': 12_000 });
    });
    it('USD without a rate prices as null; with a rate it converts', () => {
        const m = money({ obligations: [obligation({ currency: 'USD', amount: 10 })] });
        expect(recurringAudit(m, TODAY)[0].yearlyDA).toBeNull();
        const withFx = money({ ...m, settings: settings({ fxDaPerUsd: 240 }) });
        expect(recurringAudit(withFx, TODAY)[0].yearlyDA).toBe(2_400 * 12);
    });
    it('variable bills use the estimate', () => {
        const m = money({
            obligations: [obligation({ kind: 'variable', amount: 1_000, firstDue: '2026-09-01' })],
            payments: [payment({ due: '2026-09-01', amount: 3_000 })],
        });
        expect(recurringAudit(m, TODAY)[0].yearlyDA).toBe(36_000);
    });
});
