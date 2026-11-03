// Ported verbatim from Ember src/state/slices/money.test.ts (types stripped; vitest -> vitest-shim.mjs on node:test).
import { describe, it, expect } from './vitest-shim.mjs';
import { defaultMoney, mergeMoney, moneyReducer, sanitizeMoney, withPayment, } from './state.mjs';
const T1 = '2026-10-01T08:00:00.000Z';
const T2 = '2026-10-02T08:00:00.000Z';
const T3 = '2026-10-03T08:00:00.000Z';
const account = (over = {}) => ({
    id: 'acc-1',
    name: 'CCP',
    currency: 'DA',
    anchorBalance: 50_000,
    anchorAt: T1,
    archived: false,
    updatedAt: T1,
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
    accountId: 'acc-1',
    installment: null,
    nextStep: 'open BaridiMob',
    archived: false,
    updatedAt: T1,
    ...over,
});
const payment = (over = {}) => ({
    id: 'pay-1',
    obligationId: 'ob-1',
    due: '2026-10-15',
    paidOn: '2026-10-14',
    amount: 2_000,
    currency: 'DA',
    txId: 'tx-1',
    void: false,
    updatedAt: T1,
    ...over,
});
const jar = (over = {}) => ({
    id: 'jar-1',
    name: 'Laptop',
    emoji: '💻',
    target: 100_000,
    targetDate: '2027-03-01',
    locked: false,
    archived: false,
    updatedAt: T1,
    ...over,
});
const move = (over = {}) => ({
    id: 'mv-1',
    jarId: 'jar-1',
    amount: 1_000,
    date: '2026-10-05',
    kind: 'topup',
    ...over,
});
const charm = (over = {}) => ({
    id: 'ch-1',
    kind: 'category',
    jarId: 'jar-1',
    category: 'Food',
    value: 100,
    since: '2026-10-01',
    active: true,
    archived: false,
    updatedAt: T1,
    ...over,
});
const income = (over = {}) => ({
    id: 'inc-1',
    accountId: 'acc-1',
    amount: 60_000,
    date: '2026-10-05',
    at: T2,
    note: 'salary',
    ...over,
});
const state = (over = {}) => ({ ...defaultMoney(), ...over });
/** Run a payload through JSON (as storage would) and then the sanitizer. */
const roundTrip = (v) => sanitizeMoney(JSON.parse(JSON.stringify(v)));
describe('defaultMoney', () => {
    it('returns fresh, empty state each call', () => {
        const a = defaultMoney();
        const b = defaultMoney();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        a.settings.split.push({ jarId: 'x', amount: 1 });
        expect(b.settings.split).toEqual([]);
    });
});
describe('sanitizeMoney: garbage', () => {
    it('returns defaults for non-objects', () => {
        for (const v of [null, undefined, 0, 42, 'money', true]) {
            expect(sanitizeMoney(v)).toEqual(defaultMoney());
        }
    });
    it('returns defaults when every field is the wrong type', () => {
        const out = sanitizeMoney({
            accounts: 'x',
            obligations: 5,
            payments: {},
            jars: null,
            jarMoves: 'nope',
            charms: true,
            incomes: { 0: income() },
            dismissed: 'a',
            settings: 'x',
        });
        expect(out).toEqual(defaultMoney());
    });
    it('drops non-object rows inside arrays', () => {
        const out = sanitizeMoney({ accounts: [null, 1, 'a', [], account()] });
        expect(out.accounts).toEqual([account()]);
    });
    it('keeps a valid full state unchanged', () => {
        const s = state({
            accounts: [account()],
            obligations: [obligation()],
            payments: [payment()],
            jars: [jar()],
            jarMoves: [move()],
            charms: [charm()],
            incomes: [income()],
            dismissed: ['charm:a:b'],
            settings: { fxDaPerUsd: 240, paydayDay: 20, split: [{ jarId: 'jar-1', amount: 5_000 }], savedAt: T1 },
        });
        expect(roundTrip(s)).toEqual(s);
    });
});
describe('sanitizeMoney: accounts', () => {
    it('drops a bad currency', () => {
        expect(sanitizeMoney({ accounts: [account({ currency: 'EUR' })] }).accounts).toEqual([]);
    });
    it('drops a non-finite anchor balance but keeps a negative one (overdraft)', () => {
        expect(sanitizeMoney({ accounts: [account({ anchorBalance: NaN })] }).accounts).toEqual([]);
        expect(sanitizeMoney({ accounts: [account({ anchorBalance: Infinity })] }).accounts).toEqual([]);
        expect(sanitizeMoney({ accounts: [account({ anchorBalance: -500 })] }).accounts[0].anchorBalance).toBe(-500);
    });
    it('drops bad ISO datetimes', () => {
        for (const bad of ['2026-10-01', '2026-10-01T08:00:00', 'yesterday', '2026-13-01T08:00:00Z', '']) {
            expect(sanitizeMoney({ accounts: [account({ anchorAt: bad })] }).accounts).toEqual([]);
            expect(sanitizeMoney({ accounts: [account({ updatedAt: bad })] }).accounts).toEqual([]);
        }
    });
    it('accepts ISO datetimes without milliseconds', () => {
        expect(sanitizeMoney({ accounts: [account({ anchorAt: '2026-10-01T08:00:00Z' })] }).accounts).toHaveLength(1);
    });
    it('drops missing id or name', () => {
        const { id: _id, ...noId } = account();
        const { name: _name, ...noName } = account();
        void _id;
        void _name;
        expect(sanitizeMoney({ accounts: [noId, noName] }).accounts).toEqual([]);
    });
    it('coerces archived to a strict boolean', () => {
        const out = sanitizeMoney({ accounts: [{ ...account(), archived: 'yes' }] });
        expect(out.accounts[0].archived).toBe(false);
    });
    it('strips unknown fields', () => {
        const out = sanitizeMoney({ accounts: [{ ...account(), extra: 1 }] });
        expect(out.accounts[0]).toEqual(account());
        expect('extra' in out.accounts[0]).toBe(false);
    });
});
describe('sanitizeMoney: obligations', () => {
    const ok = (o) => sanitizeMoney({ obligations: [o] }).obligations;
    it('drops negative or non-finite amounts, keeps zero', () => {
        expect(ok(obligation({ amount: -1 }))).toEqual([]);
        expect(ok(obligation({ amount: NaN }))).toEqual([]);
        expect(ok(obligation({ amount: 0 }))).toHaveLength(1);
    });
    it('drops a bad currency, kind or cadence', () => {
        expect(ok(obligation({ currency: 'eur' }))).toEqual([]);
        expect(ok(obligation({ kind: 'loan' }))).toEqual([]);
        expect(ok(obligation({ cadence: 'daily' }))).toEqual([]);
    });
    it('drops invalid day keys', () => {
        for (const bad of ['2026-02-30', '2026-13-01', '2026-1-01', '2026-10-15T00:00:00Z', '']) {
            expect(ok(obligation({ firstDue: bad }))).toEqual([]);
        }
    });
    it('drops a bad updatedAt', () => {
        expect(ok(obligation({ updatedAt: 'now' }))).toEqual([]);
    });
    it('validates installments: paidBefore > total, total < 1, negatives', () => {
        expect(ok(obligation({ kind: 'installment', installment: { total: 6, paidBefore: 7 } }))).toEqual([]);
        expect(ok(obligation({ kind: 'installment', installment: { total: 0, paidBefore: 0 } }))).toEqual([]);
        expect(ok(obligation({ kind: 'installment', installment: { total: 6, paidBefore: -1 } }))).toEqual([]);
        expect(ok(obligation({ kind: 'installment', installment: { total: NaN, paidBefore: 0 } }))).toEqual([]);
        expect(ok(obligation({ kind: 'installment', installment: { total: 6, paidBefore: 6 } }))[0].installment).toEqual({
            total: 6,
            paidBefore: 6,
        });
    });
    it('floors fractional installment counts', () => {
        const out = ok(obligation({ kind: 'installment', installment: { total: 6.9, paidBefore: 2.5 } }));
        expect(out[0].installment).toEqual({ total: 6, paidBefore: 2 });
    });
    it('treats a non-object installment as null', () => {
        expect(ok({ ...obligation(), installment: 'six' })[0].installment).toBeNull();
    });
    it('defaults accountId to null and nextStep to empty', () => {
        const out = ok({ ...obligation(), accountId: 5, nextStep: undefined });
        expect(out[0].accountId).toBeNull();
        expect(out[0].nextStep).toBe('');
    });
});
describe('sanitizeMoney: payments', () => {
    const ok = (p) => sanitizeMoney({ payments: [p] }).payments;
    it('drops negative amounts and bad currencies', () => {
        expect(ok(payment({ amount: -5 }))).toEqual([]);
        expect(ok(payment({ currency: 'X' }))).toEqual([]);
    });
    it('drops invalid due / paidOn day keys', () => {
        expect(ok(payment({ due: '2026-02-30' }))).toEqual([]);
        expect(ok(payment({ paidOn: '2026-04-31' }))).toEqual([]);
    });
    it('drops missing txId or obligationId', () => {
        expect(ok({ ...payment(), txId: undefined })).toEqual([]);
        expect(ok({ ...payment(), obligationId: 3 })).toEqual([]);
    });
    it('drops bad updatedAt', () => {
        expect(ok(payment({ updatedAt: '2026-10-01 08:00' }))).toEqual([]);
    });
    it('coerces void to a strict boolean', () => {
        expect(ok({ ...payment(), void: 1 })[0].void).toBe(false);
        expect(ok(payment({ void: true }))[0].void).toBe(true);
    });
});
describe('sanitizeMoney: jars', () => {
    const ok = (j) => sanitizeMoney({ jars: [j] }).jars;
    it('drops a target ≤ 0 or non-finite', () => {
        expect(ok(jar({ target: 0 }))).toEqual([]);
        expect(ok(jar({ target: -100 }))).toEqual([]);
        expect(ok(jar({ target: NaN }))).toEqual([]);
        expect(ok({ ...jar(), target: '100' })).toEqual([]);
    });
    it('keeps a null or missing target as null (open-ended)', () => {
        expect(ok(jar({ target: null }))[0].target).toBeNull();
        const { target: _t, ...rest } = jar();
        void _t;
        expect(ok(rest)[0].target).toBeNull();
    });
    it('drops an invalid targetDate and keeps null', () => {
        expect(ok(jar({ targetDate: '2027-02-29' }))).toEqual([]);
        expect(ok(jar({ targetDate: null }))[0].targetDate).toBeNull();
    });
    it('defaults emoji and booleans', () => {
        const out = ok({ ...jar(), emoji: 7, locked: 'y', archived: 1 })[0];
        expect(out.emoji).toBe('🫙');
        expect(out.locked).toBe(false);
        expect(out.archived).toBe(false);
    });
});
describe('sanitizeMoney: jar moves', () => {
    const ok = (m) => sanitizeMoney({ jarMoves: [m] }).jarMoves;
    it('drops amount 0 and non-finite amounts, keeps negatives (withdrawals)', () => {
        expect(ok(move({ amount: 0 }))).toEqual([]);
        expect(ok(move({ amount: NaN }))).toEqual([]);
        expect(ok(move({ amount: -300, kind: 'withdraw' }))[0].amount).toBe(-300);
    });
    it('drops bad kinds and dates', () => {
        expect(ok(move({ kind: 'gift' }))).toEqual([]);
        expect(ok(move({ date: '2026-02-30' }))).toEqual([]);
    });
    it('collapses duplicate ids deterministically (greater JSON wins)', () => {
        const a = move({ amount: 100 });
        const b = move({ amount: 200 });
        expect(sanitizeMoney({ jarMoves: [a, b] }).jarMoves).toEqual(sanitizeMoney({ jarMoves: [b, a] }).jarMoves);
        expect(sanitizeMoney({ jarMoves: [a, b] }).jarMoves).toHaveLength(1);
    });
});
describe('sanitizeMoney: charms', () => {
    const ok = (c) => sanitizeMoney({ charms: [c] }).charms;
    it('drops a treat-tax percent over 100, keeps exactly 100', () => {
        expect(ok(charm({ kind: 'treat-tax', value: 101 }))).toEqual([]);
        expect(ok(charm({ kind: 'treat-tax', value: 100 }))).toHaveLength(1);
    });
    it('allows category charm values over 100 (DA, not percent)', () => {
        expect(ok(charm({ kind: 'category', value: 500 }))).toHaveLength(1);
    });
    it('drops value ≤ 0', () => {
        expect(ok(charm({ value: 0 }))).toEqual([]);
        expect(ok(charm({ value: -10 }))).toEqual([]);
    });
    it('forces roundup category to null', () => {
        expect(ok(charm({ kind: 'roundup', category: 'Food', value: 50 }))[0].category).toBeNull();
    });
    it('drops category / treat-tax charms without a category', () => {
        expect(ok(charm({ kind: 'category', category: null }))).toEqual([]);
        expect(ok(charm({ kind: 'treat-tax', category: null, value: 10 }))).toEqual([]);
    });
    it('drops a bad kind or since day', () => {
        expect(ok(charm({ kind: 'magic' }))).toEqual([]);
        expect(ok(charm({ since: '2026-11-31' }))).toEqual([]);
    });
    it('defaults active to true unless explicitly false', () => {
        const { active: _a, ...rest } = charm();
        void _a;
        expect(ok(rest)[0].active).toBe(true);
        expect(ok(charm({ active: false }))[0].active).toBe(false);
    });
});
describe('sanitizeMoney: incomes', () => {
    const ok = (i) => sanitizeMoney({ incomes: [i] }).incomes;
    it('drops zero and negative amounts', () => {
        expect(ok(income({ amount: 0 }))).toEqual([]);
        expect(ok(income({ amount: -10 }))).toEqual([]);
    });
    it('drops bad date or at', () => {
        expect(ok(income({ date: '2026-02-30' }))).toEqual([]);
        expect(ok(income({ at: '2026-10-05' }))).toEqual([]);
    });
    it('defaults note to empty', () => {
        expect(ok({ ...income(), note: null })[0].note).toBe('');
    });
});
describe('sanitizeMoney: duplicates and ordering', () => {
    it('collapses duplicate entities by newer updatedAt regardless of order', () => {
        const older = account({ name: 'Old', updatedAt: T1 });
        const newer = account({ name: 'New', updatedAt: T2 });
        expect(sanitizeMoney({ accounts: [older, newer] }).accounts).toEqual([newer]);
        expect(sanitizeMoney({ accounts: [newer, older] }).accounts).toEqual([newer]);
    });
    it('collapses duplicate obligations, payments, jars, charms by updatedAt', () => {
        const out = sanitizeMoney({
            obligations: [obligation({ updatedAt: T3, name: 'B' }), obligation({ updatedAt: T2, name: 'A' })],
            payments: [payment({ updatedAt: T1 }), payment({ updatedAt: T2, void: true })],
            jars: [jar({ updatedAt: T2, name: 'new' }), jar({ updatedAt: T1, name: 'old' })],
            charms: [charm({ updatedAt: T1, value: 1 }), charm({ updatedAt: T3, value: 3 })],
        });
        expect(out.obligations.map((o) => o.name)).toEqual(['B']);
        expect(out.payments.map((p) => p.void)).toEqual([true]);
        expect(out.jars.map((j) => j.name)).toEqual(['new']);
        expect(out.charms.map((c) => c.value)).toEqual([3]);
    });
    it('sorts entities and logs by id', () => {
        const out = sanitizeMoney({
            accounts: [account({ id: 'c' }), account({ id: 'a' }), account({ id: 'b' })],
            incomes: [income({ id: 'z' }), income({ id: 'm' })],
        });
        expect(out.accounts.map((a) => a.id)).toEqual(['a', 'b', 'c']);
        expect(out.incomes.map((i) => i.id)).toEqual(['m', 'z']);
    });
    it('dedupes and sorts dismissed, dropping non-strings', () => {
        expect(sanitizeMoney({ dismissed: ['b', 'a', 3, 'b', null] }).dismissed).toEqual(['a', 'b']);
    });
});
describe('sanitizeMoney: settings', () => {
    const settings = (v) => sanitizeMoney({ settings: v }).settings;
    it('drops fx ≤ 0 or non-finite', () => {
        expect(settings({ fxDaPerUsd: 0 }).fxDaPerUsd).toBeNull();
        expect(settings({ fxDaPerUsd: -5 }).fxDaPerUsd).toBeNull();
        expect(settings({ fxDaPerUsd: Infinity }).fxDaPerUsd).toBeNull();
        expect(settings({ fxDaPerUsd: '240' }).fxDaPerUsd).toBeNull();
        expect(settings({ fxDaPerUsd: 240.5 }).fxDaPerUsd).toBe(240.5);
    });
    it('drops paydayDay outside 1–28 and floors fractions', () => {
        expect(settings({ paydayDay: 0 }).paydayDay).toBeNull();
        expect(settings({ paydayDay: 29 }).paydayDay).toBeNull();
        expect(settings({ paydayDay: 31 }).paydayDay).toBeNull();
        expect(settings({ paydayDay: 1 }).paydayDay).toBe(1);
        expect(settings({ paydayDay: 28 }).paydayDay).toBe(28);
        expect(settings({ paydayDay: 12.7 }).paydayDay).toBe(12);
    });
    it('dedupes split by jarId (first wins) and drops non-positive rows', () => {
        const out = settings({
            split: [
                { jarId: 'a', amount: 100 },
                { jarId: 'b', amount: 0 },
                { jarId: 'a', amount: 999 },
                { jarId: 'c', amount: -5 },
                { jarId: 'd', amount: 50 },
                { amount: 10 },
                'junk',
            ],
        });
        expect(out.split).toEqual([
            { jarId: 'a', amount: 100 },
            { jarId: 'd', amount: 50 },
        ]);
    });
    it('a dropped non-positive row does not reserve its jarId', () => {
        const out = settings({ split: [{ jarId: 'a', amount: 0 }, { jarId: 'a', amount: 10 }] });
        expect(out.split).toEqual([{ jarId: 'a', amount: 10 }]);
    });
    it('keeps savedAt only when it is an ISO datetime', () => {
        expect(settings({ savedAt: T1 }).savedAt).toBe(T1);
        expect(settings({ savedAt: 'today' }).savedAt).toBe('');
    });
});
describe('mergeMoney', () => {
    const full = (over = {}) => sanitizeMoney({
        accounts: [account()],
        obligations: [obligation()],
        payments: [payment()],
        jars: [jar()],
        jarMoves: [move()],
        charms: [charm()],
        incomes: [income()],
        dismissed: ['d1'],
        settings: { fxDaPerUsd: 240, paydayDay: 20, split: [], savedAt: T1 },
        ...over,
    });
    it('is symmetric for entities with differing updatedAt', () => {
        const a = full({ accounts: [account({ name: 'A', updatedAt: T2 })], jars: [jar({ name: 'old', updatedAt: T1 })] });
        const b = full({ accounts: [account({ name: 'B', updatedAt: T1 })], jars: [jar({ name: 'new', updatedAt: T3 })] });
        const ab = mergeMoney(a, b);
        expect(ab).toEqual(mergeMoney(b, a));
        expect(ab.accounts[0].name).toBe('A');
        expect(ab.jars[0].name).toBe('new');
    });
    it('is symmetric for equal-updatedAt ties', () => {
        const a = full({
            obligations: [obligation({ name: 'Alpha' })],
            charms: [charm({ value: 10 })],
            payments: [payment({ amount: 1 })],
        });
        const b = full({
            obligations: [obligation({ name: 'Beta' })],
            charms: [charm({ value: 20 })],
            payments: [payment({ amount: 2 })],
        });
        expect(mergeMoney(a, b)).toEqual(mergeMoney(b, a));
        expect(JSON.stringify(mergeMoney(a, b))).toBe(JSON.stringify(mergeMoney(b, a)));
    });
    it('lets the newer tombstone win', () => {
        const live = full({ accounts: [account({ updatedAt: T1 })] });
        const dead = full({ accounts: [account({ archived: true, updatedAt: T2 })] });
        expect(mergeMoney(live, dead).accounts[0].archived).toBe(true);
        expect(mergeMoney(dead, live).accounts[0].archived).toBe(true);
    });
    it('does not let an older tombstone delete a newer edit', () => {
        const dead = full({ jars: [jar({ archived: true, updatedAt: T1 })] });
        const edited = full({ jars: [jar({ name: 'renamed', updatedAt: T2 })] });
        expect(mergeMoney(dead, edited).jars[0]).toMatchObject({ archived: false, name: 'renamed' });
    });
    it('a voided payment from the newer copy wins', () => {
        const a = full({ payments: [payment({ updatedAt: T1 })] });
        const b = full({ payments: [payment({ void: true, updatedAt: T2 })] });
        expect(mergeMoney(a, b).payments[0].void).toBe(true);
        expect(mergeMoney(b, a).payments[0].void).toBe(true);
    });
    it('unions logs by id', () => {
        const a = full({ jarMoves: [move({ id: 'm1' }), move({ id: 'm2' })], incomes: [income({ id: 'i1' })] });
        const b = full({ jarMoves: [move({ id: 'm2' }), move({ id: 'm3' })], incomes: [income({ id: 'i2' })] });
        const out = mergeMoney(a, b);
        expect(out.jarMoves.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
        expect(out.incomes.map((i) => i.id)).toEqual(['i1', 'i2']);
        expect(out).toEqual(mergeMoney(b, a));
    });
    it('unions entities that exist on only one side', () => {
        const a = full({ accounts: [account({ id: 'x' })] });
        const b = full({ accounts: [account({ id: 'y' })] });
        expect(mergeMoney(a, b).accounts.map((x) => x.id)).toEqual(['x', 'y']);
    });
    it('unions dismissed ids sorted', () => {
        const a = full({ dismissed: ['c', 'a'] });
        const b = full({ dismissed: ['b', 'a'] });
        expect(mergeMoney(a, b).dismissed).toEqual(['a', 'b', 'c']);
        expect(mergeMoney(b, a).dismissed).toEqual(['a', 'b', 'c']);
    });
    it('takes settings with the newer savedAt', () => {
        const a = full({ settings: { fxDaPerUsd: 200, paydayDay: 5, split: [], savedAt: T1 } });
        const b = full({ settings: { fxDaPerUsd: 250, paydayDay: 10, split: [], savedAt: T2 } });
        expect(mergeMoney(a, b).settings.fxDaPerUsd).toBe(250);
        expect(mergeMoney(b, a).settings.fxDaPerUsd).toBe(250);
    });
    it('breaks a settings savedAt tie symmetrically', () => {
        const a = full({ settings: { fxDaPerUsd: 200, paydayDay: 5, split: [], savedAt: T1 } });
        const b = full({ settings: { fxDaPerUsd: 250, paydayDay: 5, split: [], savedAt: T1 } });
        expect(mergeMoney(a, b).settings).toEqual(mergeMoney(b, a).settings);
    });
    it('a sanitized state is a merge fixpoint with defaultMoney() key order', () => {
        const s = full({
            accounts: [account({ id: 'b' }), account({ id: 'a', currency: 'USD' })],
            jarMoves: [move({ id: 'm2' }), move({ id: 'm1', amount: -5, kind: 'withdraw' })],
            dismissed: ['z', 'y'],
            settings: { fxDaPerUsd: 240, paydayDay: 20, split: [{ jarId: 'jar-1', amount: 5 }], savedAt: T1 },
        });
        const merged = mergeMoney(s, s);
        expect(merged).toEqual(s);
        expect(JSON.stringify(merged)).toBe(JSON.stringify(s));
        expect(Object.keys(merged)).toEqual(Object.keys(defaultMoney()));
        expect(Object.keys(s)).toEqual(Object.keys(defaultMoney()));
        expect(Object.keys(merged.settings)).toEqual(Object.keys(defaultMoney().settings));
    });
    it('sanitize is idempotent', () => {
        const s = full();
        expect(JSON.stringify(sanitizeMoney(JSON.parse(JSON.stringify(s))))).toBe(JSON.stringify(s));
    });
    // BUG: `newer()` compares updatedAt as strings. Both '…T08:00:00Z' and
    // '…T08:00:00.500Z' pass isIsoDatetime, but the later one sorts first
    // ('.' < 'Z'), so the older edit wins the merge.
    it('picks the chronologically newer updatedAt across ISO precisions', () => {
        const older = full({ accounts: [account({ name: 'old', updatedAt: '2026-10-02T08:00:00Z' })] });
        const newer = full({ accounts: [account({ name: 'new', updatedAt: '2026-10-02T08:00:00.500Z' })] });
        expect(mergeMoney(older, newer).accounts[0].name).toBe('new');
    });
    it('merging with an empty state returns the same content', () => {
        const s = full();
        expect(mergeMoney(s, defaultMoney())).toEqual(s);
        expect(mergeMoney(defaultMoney(), s)).toEqual(s);
    });
});
describe('moneyReducer', () => {
    it('account-upsert inserts, replaces by id, and keeps id order', () => {
        let s = moneyReducer(defaultMoney(), { type: 'money/account-upsert', account: account({ id: 'b' }) });
        s = moneyReducer(s, { type: 'money/account-upsert', account: account({ id: 'a' }) });
        s = moneyReducer(s, { type: 'money/account-upsert', account: account({ id: 'b', name: 'Edited' }) });
        expect(s.accounts.map((a) => [a.id, a.name])).toEqual([
            ['a', 'CCP'],
            ['b', 'Edited'],
        ]);
    });
    it('account-upsert rejects invalid payloads and returns the same object', () => {
        const s = state({ accounts: [account()] });
        expect(moneyReducer(s, { type: 'money/account-upsert', account: account({ anchorBalance: NaN }) })).toBe(s);
        expect(moneyReducer(s, { type: 'money/account-upsert', account: account({ currency: 'EUR' }) })).toBe(s);
    });
    it('account-upsert sanitizes the stored row (strips extra fields)', () => {
        const s = moneyReducer(defaultMoney(), {
            type: 'money/account-upsert',
            account: { ...account(), junk: true },
        });
        expect(s.accounts[0]).toEqual(account());
    });
    it('obligation-upsert stores valid rows and rejects invalid ones', () => {
        const s = moneyReducer(defaultMoney(), { type: 'money/obligation-upsert', obligation: obligation() });
        expect(s.obligations).toEqual([obligation()]);
        expect(moneyReducer(s, { type: 'money/obligation-upsert', obligation: obligation({ amount: -1 }) })).toBe(s);
        expect(moneyReducer(s, { type: 'money/obligation-upsert', obligation: obligation({ firstDue: '2026-02-30' }) })).toBe(s);
        expect(moneyReducer(s, {
            type: 'money/obligation-upsert',
            obligation: obligation({ installment: { total: 2, paidBefore: 3 } }),
        })).toBe(s);
    });
    it('payment-void marks the payment void and stamps updatedAt', () => {
        const s = state({ payments: [payment()] });
        const out = moneyReducer(s, { type: 'money/payment-void', id: 'pay-1', nowISO: T3 });
        expect(out.payments).toEqual([payment({ void: true, updatedAt: T3 })]);
        expect(s.payments[0].void).toBe(false);
    });
    it('payment-void is a no-op when already void or unknown', () => {
        const s = state({ payments: [payment({ void: true })] });
        expect(moneyReducer(s, { type: 'money/payment-void', id: 'pay-1', nowISO: T3 })).toBe(s);
        expect(moneyReducer(s, { type: 'money/payment-void', id: 'missing', nowISO: T3 })).toBe(s);
    });
    // BUG: payment-void stamps nowISO without validating it. A bad stamp is
    // stored, then the sanitizer drops the whole payment on reload — the void
    // payment vanishes (and with it the record that the cycle was settled).
    it('payment-void with an invalid nowISO survives a reload', () => {
        const s = state({ payments: [payment()] });
        const out = moneyReducer(s, { type: 'money/payment-void', id: 'pay-1', nowISO: 'not-a-date' });
        expect(roundTrip(out).payments).toHaveLength(1);
    });
    it('jar-upsert stores valid jars and rejects target ≤ 0', () => {
        const s = moneyReducer(defaultMoney(), { type: 'money/jar-upsert', jar: jar() });
        expect(s.jars).toEqual([jar()]);
        expect(moneyReducer(s, { type: 'money/jar-upsert', jar: jar({ target: 0 }) })).toBe(s);
    });
    it('jar-move appends a single move', () => {
        const s = moneyReducer(defaultMoney(), { type: 'money/jar-move', move: move() });
        expect(s.jarMoves).toEqual([move()]);
    });
    it('jar-move rejects invalid moves and returns the same object', () => {
        const s = defaultMoney();
        expect(moneyReducer(s, { type: 'money/jar-move', move: move({ amount: 0 }) })).toBe(s);
    });
    it('jar-moves dedupes against existing ids and keeps the stored copy', () => {
        const s = state({ jarMoves: [move({ id: 'm1', amount: 100 })] });
        const out = moneyReducer(s, {
            type: 'money/jar-moves',
            moves: [move({ id: 'm1', amount: 999 }), move({ id: 'm2', amount: 50 }), move({ id: 'm3', amount: 0 })],
        });
        expect(out.jarMoves).toEqual([move({ id: 'm1', amount: 100 }), move({ id: 'm2', amount: 50 })]);
    });
    it('jar-moves with nothing new returns the same object', () => {
        const s = state({ jarMoves: [move({ id: 'm1' })] });
        expect(moneyReducer(s, { type: 'money/jar-moves', moves: [move({ id: 'm1' })] })).toBe(s);
        expect(moneyReducer(s, { type: 'money/jar-moves', moves: [] })).toBe(s);
    });
    it('jar-moves collapses duplicate ids within one batch', () => {
        const out = moneyReducer(defaultMoney(), {
            type: 'money/jar-moves',
            moves: [move({ id: 'm1', amount: 1 }), move({ id: 'm1', amount: 2 })],
        });
        expect(out.jarMoves).toHaveLength(1);
    });
    it('charm-upsert stores valid charms and rejects invalid ones', () => {
        const s = moneyReducer(defaultMoney(), { type: 'money/charm-upsert', charm: charm() });
        expect(s.charms).toEqual([charm()]);
        expect(moneyReducer(s, { type: 'money/charm-upsert', charm: charm({ kind: 'treat-tax', value: 150 }) })).toBe(s);
    });
    it('charm-upsert forces roundup category to null', () => {
        const s = moneyReducer(defaultMoney(), {
            type: 'money/charm-upsert',
            charm: charm({ kind: 'roundup', category: 'Food', value: 50 }),
        });
        expect(s.charms[0].category).toBeNull();
    });
    it('charm-dismiss adds sorted and is idempotent', () => {
        let s = moneyReducer(defaultMoney(), { type: 'money/charm-dismiss', id: 'b' });
        s = moneyReducer(s, { type: 'money/charm-dismiss', id: 'a' });
        expect(s.dismissed).toEqual(['a', 'b']);
        expect(moneyReducer(s, { type: 'money/charm-dismiss', id: 'a' })).toBe(s);
    });
    it('income-add appends, dedupes by id, rejects invalid', () => {
        const s = moneyReducer(defaultMoney(), { type: 'money/income-add', income: income() });
        expect(s.incomes).toEqual([income()]);
        expect(moneyReducer(s, { type: 'money/income-add', income: income({ amount: 1 }) })).toBe(s);
        expect(moneyReducer(s, { type: 'money/income-add', income: income({ id: 'i2', amount: 0 }) })).toBe(s);
    });
    it('settings are sanitized and stamped with nowISO', () => {
        const s = moneyReducer(defaultMoney(), {
            type: 'money/settings',
            settings: {
                fxDaPerUsd: -1,
                paydayDay: 30,
                split: [
                    { jarId: 'a', amount: 10 },
                    { jarId: 'a', amount: 20 },
                    { jarId: 'b', amount: 0 },
                ],
            },
            nowISO: T2,
        });
        expect(s.settings).toEqual({ fxDaPerUsd: null, paydayDay: null, split: [{ jarId: 'a', amount: 10 }], savedAt: T2 });
    });
    it('settings keep valid values', () => {
        const s = moneyReducer(defaultMoney(), {
            type: 'money/settings',
            settings: { fxDaPerUsd: 245, paydayDay: 25, split: [] },
            nowISO: T2,
        });
        expect(s.settings).toEqual({ fxDaPerUsd: 245, paydayDay: 25, split: [], savedAt: T2 });
    });
    it('never mutates the input state', () => {
        const s = state({ accounts: [account()], dismissed: ['x'] });
        const snapshot = JSON.stringify(s);
        moneyReducer(s, { type: 'money/account-upsert', account: account({ id: 'z' }) });
        moneyReducer(s, { type: 'money/charm-dismiss', id: 'a' });
        moneyReducer(s, { type: 'money/jar-move', move: move() });
        expect(JSON.stringify(s)).toBe(snapshot);
    });
});
describe('withPayment', () => {
    it('records a valid payment', () => {
        const out = withPayment(defaultMoney(), payment());
        expect(out.payments).toEqual([payment()]);
    });
    it('keeps payments sorted by id', () => {
        let s = withPayment(defaultMoney(), payment({ id: 'p2' }));
        s = withPayment(s, payment({ id: 'p1' }));
        expect(s.payments.map((p) => p.id)).toEqual(['p1', 'p2']);
    });
    it('returns the same object for an invalid payment', () => {
        const s = defaultMoney();
        expect(withPayment(s, payment({ amount: -1 }))).toBe(s);
        expect(withPayment(s, payment({ due: '2026-02-30' }))).toBe(s);
    });
    it('returns the same object when the id already exists', () => {
        const s = state({ payments: [payment()] });
        expect(withPayment(s, payment({ amount: 5 }))).toBe(s);
    });
});
