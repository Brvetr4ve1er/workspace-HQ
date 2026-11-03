/**
 * Money slice — accounts, obligations (bills/subscriptions/installments),
 * jars (envelopes), save charms, payday split, and FX. Local-first and
 * merge-safe like every other slice:
 *
 * - Entities (accounts, obligations, jars, charms) carry `updatedAt`; the
 *   newer copy wins a cross-tab merge, ties break on the greater JSON
 *   string (symmetric). Deletion is a tombstone (`archived`), never removal,
 *   so a peer that still holds the row can't resurrect it.
 * - Logs (payments, jar moves, incomes) are append-mostly and union by id.
 *   A payment can be voided (an entity edit), never deleted.
 * - Derived state is never stored: an obligation's next due date is its
 *   firstDue advanced once per live payment, a jar's balance is the sum of
 *   its moves, an account balance is its anchor minus spend since the anchor
 *   (see engine/money.ts). That is what makes the unions converge.
 */
import { isIsoDatetime, isValidDayKey } from './dates.mjs';
export function defaultMoney() {
    return {
        accounts: [],
        obligations: [],
        payments: [],
        jars: [],
        jarMoves: [],
        charms: [],
        incomes: [],
        dismissed: [],
        settings: { fxDaPerUsd: null, paydayDay: null, split: [], savedAt: '' },
    };
}
/* ------------------------------ sanitize ------------------------------ */
function isRecord(v) {
    return typeof v === 'object' && v !== null;
}
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isMoney = (v) => isNum(v) && v >= 0;
const isCurrency = (v) => v === 'DA' || v === 'USD';
const CADENCES = ['monthly', 'weekly', 'yearly', 'once'];
const OB_KINDS = ['bill', 'variable', 'subscription', 'installment'];
const MOVE_KINDS = ['topup', 'withdraw', 'cover', 'payday', 'charm'];
const CHARM_KINDS = ['roundup', 'category', 'treat-tax'];
function sanitizeAccount(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.name) || !isCurrency(v.currency))
        return null;
    if (!isNum(v.anchorBalance) || !isIsoDatetime(v.anchorAt) || !isIsoDatetime(v.updatedAt))
        return null;
    return {
        id: v.id,
        name: v.name,
        currency: v.currency,
        anchorBalance: v.anchorBalance,
        anchorAt: v.anchorAt,
        archived: v.archived === true,
        updatedAt: v.updatedAt,
    };
}
function sanitizeObligation(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.name) || !isMoney(v.amount) || !isCurrency(v.currency))
        return null;
    if (!OB_KINDS.includes(v.kind) || !CADENCES.includes(v.cadence))
        return null;
    if (!isValidDayKey(v.firstDue) || !isIsoDatetime(v.updatedAt))
        return null;
    let installment = null;
    if (isRecord(v.installment)) {
        const { total, paidBefore } = v.installment;
        if (!isNum(total) || total < 1 || !isNum(paidBefore) || paidBefore < 0 || paidBefore > total)
            return null;
        installment = { total: Math.floor(total), paidBefore: Math.floor(paidBefore) };
    }
    return {
        id: v.id,
        name: v.name,
        amount: v.amount,
        currency: v.currency,
        kind: v.kind,
        cadence: v.cadence,
        firstDue: v.firstDue,
        accountId: isStr(v.accountId) ? v.accountId : null,
        installment,
        nextStep: isStr(v.nextStep) ? v.nextStep : '',
        archived: v.archived === true,
        updatedAt: v.updatedAt,
    };
}
function sanitizePayment(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.obligationId) || !isStr(v.txId))
        return null;
    if (!isValidDayKey(v.due) || !isValidDayKey(v.paidOn) || !isMoney(v.amount) || !isCurrency(v.currency))
        return null;
    if (!isIsoDatetime(v.updatedAt))
        return null;
    return {
        id: v.id,
        obligationId: v.obligationId,
        due: v.due,
        paidOn: v.paidOn,
        amount: v.amount,
        currency: v.currency,
        txId: v.txId,
        void: v.void === true,
        updatedAt: v.updatedAt,
    };
}
function sanitizeJar(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.name) || !isIsoDatetime(v.updatedAt))
        return null;
    const target = v.target ?? null;
    if (target !== null && !(isNum(target) && target > 0))
        return null;
    const targetDate = v.targetDate ?? null;
    if (targetDate !== null && !isValidDayKey(targetDate))
        return null;
    return {
        id: v.id,
        name: v.name,
        emoji: isStr(v.emoji) ? v.emoji : '🫙',
        target,
        targetDate,
        locked: v.locked === true,
        archived: v.archived === true,
        updatedAt: v.updatedAt,
    };
}
function sanitizeMove(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.jarId) || !isNum(v.amount) || v.amount === 0)
        return null;
    if (!isValidDayKey(v.date) || !MOVE_KINDS.includes(v.kind))
        return null;
    return { id: v.id, jarId: v.jarId, amount: v.amount, date: v.date, kind: v.kind };
}
function sanitizeCharm(v) {
    if (!isRecord(v) || !isStr(v.id) || !CHARM_KINDS.includes(v.kind) || !isStr(v.jarId))
        return null;
    if (!isNum(v.value) || v.value <= 0 || !isValidDayKey(v.since) || !isIsoDatetime(v.updatedAt))
        return null;
    const kind = v.kind;
    const category = isStr(v.category) && v.category.trim() !== '' ? v.category : null;
    if (kind !== 'roundup' && category === null)
        return null;
    if (kind === 'treat-tax' && v.value > 100)
        return null;
    return {
        id: v.id,
        kind,
        jarId: v.jarId,
        category: kind === 'roundup' ? null : category,
        value: v.value,
        since: v.since,
        active: v.active !== false,
        archived: v.archived === true,
        updatedAt: v.updatedAt,
    };
}
function sanitizeIncome(v) {
    if (!isRecord(v) || !isStr(v.id) || !isStr(v.accountId) || !isMoney(v.amount) || v.amount === 0)
        return null;
    if (!isValidDayKey(v.date) || !isIsoDatetime(v.at))
        return null;
    return { id: v.id, accountId: v.accountId, amount: v.amount, date: v.date, at: v.at, note: isStr(v.note) ? v.note : '' };
}
function sanitizeSettings(v) {
    const out = defaultMoney().settings;
    if (!isRecord(v))
        return out;
    if (isNum(v.fxDaPerUsd) && v.fxDaPerUsd > 0)
        out.fxDaPerUsd = v.fxDaPerUsd;
    if (isNum(v.paydayDay) && v.paydayDay >= 1 && v.paydayDay <= 28)
        out.paydayDay = Math.floor(v.paydayDay);
    if (Array.isArray(v.split)) {
        const seen = new Set();
        for (const r of v.split) {
            if (isRecord(r) && isStr(r.jarId) && isNum(r.amount) && r.amount > 0 && !seen.has(r.jarId)) {
                seen.add(r.jarId);
                out.split.push({ jarId: r.jarId, amount: r.amount });
            }
        }
    }
    if (isIsoDatetime(v.savedAt))
        out.savedAt = v.savedAt;
    return out;
}
function byId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** Newer updatedAt wins (compared as instants — ISO strings with and without
 *  milliseconds do not sort chronologically); ties keep the greater JSON. */
function newer(a, b) {
    const ta = Date.parse(a.updatedAt);
    const tb = Date.parse(b.updatedAt);
    if (ta !== tb)
        return ta > tb ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function mergeEntities(xs) {
    const m = new Map();
    for (const x of xs) {
        const prev = m.get(x.id);
        m.set(x.id, prev ? newer(prev, x) : x);
    }
    return [...m.values()].sort(byId);
}
function unionById(xs) {
    const m = new Map();
    for (const x of xs) {
        const prev = m.get(x.id);
        if (!prev || JSON.stringify(x) > JSON.stringify(prev))
            m.set(x.id, x);
    }
    return [...m.values()].sort(byId);
}
function clean(xs, fn) {
    if (!Array.isArray(xs))
        return [];
    const out = [];
    for (const x of xs) {
        const s = fn(x);
        if (s !== null)
            out.push(s);
    }
    return out;
}
/**
 * Field-by-field validation of an untrusted money payload. Malformed rows
 * are dropped (never repaired into something the user didn't enter), and
 * duplicates collapse through the same rules the merge uses, so a sanitized
 * slice is already a merge fixpoint.
 */
export function sanitizeMoney(v) {
    const out = defaultMoney();
    if (!isRecord(v))
        return out;
    out.accounts = mergeEntities(clean(v.accounts, sanitizeAccount));
    out.obligations = mergeEntities(clean(v.obligations, sanitizeObligation));
    out.payments = mergeEntities(clean(v.payments, sanitizePayment));
    out.jars = mergeEntities(clean(v.jars, sanitizeJar));
    out.jarMoves = unionById(clean(v.jarMoves, sanitizeMove));
    out.charms = mergeEntities(clean(v.charms, sanitizeCharm));
    out.incomes = unionById(clean(v.incomes, sanitizeIncome));
    out.dismissed = Array.isArray(v.dismissed) ? [...new Set(v.dismissed.filter(isStr))].sort() : [];
    out.settings = sanitizeSettings(v.settings);
    return out;
}
/** Symmetric cross-tab merge; output is in defaultMoney() key order. */
export function mergeMoney(a, b) {
    let settings = a.settings;
    if (a.settings.savedAt !== b.settings.savedAt) {
        if (b.settings.savedAt > a.settings.savedAt)
            settings = b.settings;
    }
    else if (JSON.stringify(b.settings) > JSON.stringify(a.settings)) {
        settings = b.settings;
    }
    return {
        accounts: mergeEntities([...a.accounts, ...b.accounts]),
        obligations: mergeEntities([...a.obligations, ...b.obligations]),
        payments: mergeEntities([...a.payments, ...b.payments]),
        jars: mergeEntities([...a.jars, ...b.jars]),
        jarMoves: unionById([...a.jarMoves, ...b.jarMoves]),
        charms: mergeEntities([...a.charms, ...b.charms]),
        incomes: unionById([...a.incomes, ...b.incomes]),
        dismissed: [...new Set([...a.dismissed, ...b.dismissed])].sort(),
        settings,
    };
}
function upsert(xs, x) {
    return [...xs.filter((y) => y.id !== x.id), x].sort(byId);
}
/**
 * Pure slice transitions. Every upsert re-runs the sanitizer on the incoming
 * entity (UI payloads come from free-text fields), and is a no-op when it
 * fails — a smuggled NaN must never persist and then vanish on reload.
 */
export function moneyReducer(s, a) {
    switch (a.type) {
        case 'money/account-upsert': {
            const acc = sanitizeAccount(a.account);
            return acc ? { ...s, accounts: upsert(s.accounts, acc) } : s;
        }
        case 'money/obligation-upsert': {
            const ob = sanitizeObligation(a.obligation);
            return ob ? { ...s, obligations: upsert(s.obligations, ob) } : s;
        }
        case 'money/payment-void': {
            const p = s.payments.find((x) => x.id === a.id);
            // A bad stamp would make the voided row fail the sanitizer at reload,
            // erasing the payment entirely — reject it instead.
            if (!p || p.void || !isIsoDatetime(a.nowISO))
                return s;
            return { ...s, payments: upsert(s.payments, { ...p, void: true, updatedAt: a.nowISO }) };
        }
        case 'money/jar-upsert': {
            const jar = sanitizeJar(a.jar);
            return jar ? { ...s, jars: upsert(s.jars, jar) } : s;
        }
        case 'money/jar-move':
            return moneyReducer(s, { type: 'money/jar-moves', moves: [a.move] });
        case 'money/jar-moves': {
            const fresh = a.moves
                .map(sanitizeMove)
                .filter((m) => m !== null && !s.jarMoves.some((x) => x.id === m.id));
            return fresh.length === 0 ? s : { ...s, jarMoves: unionById([...s.jarMoves, ...fresh]) };
        }
        case 'money/charm-upsert': {
            const c = sanitizeCharm(a.charm);
            return c ? { ...s, charms: upsert(s.charms, c) } : s;
        }
        case 'money/charm-dismiss':
            return s.dismissed.includes(a.id) ? s : { ...s, dismissed: [...s.dismissed, a.id].sort() };
        case 'money/income-add': {
            const inc = sanitizeIncome(a.income);
            if (!inc || s.incomes.some((x) => x.id === inc.id))
                return s;
            return { ...s, incomes: unionById([...s.incomes, inc]) };
        }
        case 'money/settings':
            return { ...s, settings: sanitizeSettings({ ...a.settings, savedAt: a.nowISO }) };
    }
}
/** Internal: record a payment (the root reducer pairs it with a ledger row). */
export function withPayment(s, p) {
    const ok = sanitizePayment(p);
    if (!ok || s.payments.some((x) => x.id === ok.id))
        return s;
    return { ...s, payments: upsert(s.payments, ok) };
}
