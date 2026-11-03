/**
 * Money engine — every derived number the money screens show, computed from
 * the money slice + the ledger. Pure (explicit `today`, no wall clock) so
 * each rule is unit-testable and two tabs always derive the same figures.
 *
 * Honesty rules: breathing room is a forecast, never a verdict; a USD amount
 * with no FX rate set is reported as missing, never silently treated as 0;
 * account balances are labelled estimates until the user re-confirms them.
 */
import { addDaysISO, addMonthsISO, daysBetween, localDayISO } from './dates.mjs';
/** Days before a due date at which an obligation counts as "due soon". */
export const DUE_SOON_DAYS = 3;
/* ------------------------------ currency ------------------------------ */
/** Amount in DA, or null when it is USD and no rate is set. */
export function toDA(amount, currency, fx) {
    if (currency === 'DA')
        return amount;
    return fx === null ? null : Math.round(amount * fx);
}
export function fmtDA(n) {
    return `${Math.round(n).toLocaleString('en-US')} DA`;
}
export function fmtMoney(amount, currency) {
    return currency === 'DA' ? fmtDA(amount) : `$${amount.toFixed(2)}`;
}
/* ------------------------------ accounts ------------------------------ */
/** Local day of an ISO datetime (the anchor's calendar day). */
export function localDayOf(iso) {
    return localDayISO(new Date(iso));
}
/** Was this ledger row recorded after the account's anchor? */
function afterAnchor(t, anchorAt) {
    // Instants, not strings: '…00.500Z' sorts before '…00Z' lexically.
    if (t.at)
        return Date.parse(t.at) > Date.parse(anchorAt);
    // Older rows carry only a day: count them when strictly after the anchor
    // day — same-day rows are ambiguous, and the anchor the user typed that
    // day most likely already reflected them.
    return t.date > localDayOf(anchorAt);
}
/** A ledger row's amount in the account's currency (null = unconvertible). */
function txInCurrency(t, currency, fx) {
    if (currency === 'DA')
        return t.amountDA;
    if (t.original?.currency === 'USD')
        return t.original.amount;
    return fx === null ? null : t.amountDA / fx;
}
export function accountBalance(account, transactions, money, today) {
    const fx = money.settings.fxDaPerUsd;
    let balance = account.anchorBalance;
    let moved = false;
    for (const t of transactions) {
        if (t.accountId !== account.id || t.resistedImpulse || !afterAnchor(t, account.anchorAt))
            continue;
        const amt = txInCurrency(t, account.currency, fx);
        if (amt === null)
            continue;
        balance -= amt;
        moved = true;
    }
    for (const inc of money.incomes) {
        if (inc.accountId !== account.id || Date.parse(inc.at) <= Date.parse(account.anchorAt))
            continue;
        balance += inc.amount;
        moved = true;
    }
    return {
        account,
        balance,
        balanceDA: toDA(balance, account.currency, fx),
        isEstimate: moved,
        daysSinceConfirmed: Math.max(0, daysBetween(localDayOf(account.anchorAt), today)),
    };
}
export function liveAccounts(money) {
    return money.accounts.filter((a) => !a.archived);
}
export function advanceDue(day, cadence, n) {
    if (n === 0)
        return day;
    switch (cadence) {
        case 'weekly':
            return addDaysISO(day, 7 * n);
        case 'yearly':
            return addMonthsISO(day, 12 * n);
        default:
            return addMonthsISO(day, n);
    }
}
export function livePayments(money, obligationId) {
    return money.payments
        .filter((p) => p.obligationId === obligationId && !p.void)
        .sort((a, b) => (a.due !== b.due ? (a.due < b.due ? -1 : 1) : a.id < b.id ? -1 : 1));
}
export function obligationView(ob, money, today) {
    const payments = livePayments(money, ob.id);
    const n = payments.length;
    let done = false;
    let installmentPaid = null;
    if (ob.cadence === 'once')
        done = n >= 1;
    if (ob.installment) {
        installmentPaid = Math.min(ob.installment.total, ob.installment.paidBefore + n);
        done = installmentPaid >= ob.installment.total;
    }
    const nextDue = done ? null : advanceDue(ob.firstDue, ob.cadence, n);
    const history = payments.slice(-3).map((p) => p.amount);
    const estimate = ob.kind === 'variable' && history.length > 0
        ? Math.round(history.reduce((s, x) => s + x, 0) / history.length)
        : ob.amount;
    const daysUntil = nextDue === null ? null : daysBetween(today, nextDue);
    const status = daysUntil === null ? 'done' : daysUntil < 0 ? 'late' : daysUntil <= DUE_SOON_DAYS ? 'due_soon' : 'upcoming';
    return { obligation: ob, nextDue, status, payments, installmentPaid, estimate, history, daysUntil };
}
export function obligationViews(money, today) {
    return money.obligations
        .filter((o) => !o.archived)
        .map((o) => obligationView(o, money, today))
        .sort((a, b) => {
        if (a.nextDue === null)
            return b.nextDue === null ? 0 : 1;
        if (b.nextDue === null)
            return -1;
        return a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0;
    });
}
/** Unpaid cycles of `view` due on or before `until` (weekly bills can hit twice). */
export function cyclesDueBy(view, until) {
    if (view.nextDue === null)
        return [];
    const out = [];
    const ob = view.obligation;
    const paid = view.payments.length;
    const remaining = ob.installment ? ob.installment.total - (view.installmentPaid ?? 0) : ob.cadence === 'once' ? 1 : Infinity;
    for (let i = 0; i < remaining && out.length < 60; i++) {
        const due = advanceDue(ob.firstDue, ob.cadence, paid + i);
        if (due > until)
            break;
        out.push(due);
    }
    return out;
}
/* ------------------------------- payday -------------------------------- */
/**
 * The next day income lands, strictly after today: on payday itself the
 * money has arrived, so the window to protect runs to the following one.
 * No payday set → end of the month (the honest default for irregular pay).
 */
export function nextPayday(settings, today) {
    const [y, m] = today.split('-').map(Number);
    if (settings.paydayDay === null) {
        const eom = localDayISO(new Date(y, m, 0));
        return eom > today ? eom : localDayISO(new Date(y, m + 1, 0));
    }
    const thisMonth = localDayISO(new Date(y, m - 1, settings.paydayDay));
    return thisMonth > today ? thisMonth : addMonthsISO(thisMonth, 1);
}
/* -------------------------------- jars --------------------------------- */
export function jarBalance(money, jarId) {
    return money.jarMoves.filter((m) => m.jarId === jarId).reduce((s, m) => s + m.amount, 0);
}
export function liveJars(money) {
    return money.jars.filter((j) => !j.archived);
}
export function jarView(jar, money, today) {
    const balance = jarBalance(money, jar.id);
    const progress = jar.target === null ? null : Math.max(0, Math.min(1, balance / jar.target));
    const reached = jar.target !== null && balance >= jar.target;
    let perMonth = null;
    let monthsLeft = null;
    let onTrack = null;
    if (jar.target !== null && !reached && jar.targetDate !== null) {
        monthsLeft = Math.max(1, Math.ceil(daysBetween(today, jar.targetDate) / 30.4));
        perMonth = Math.ceil((jar.target - Math.max(0, balance)) / monthsLeft);
        const split = money.settings.split.find((r) => r.jarId === jar.id)?.amount ?? 0;
        onTrack = split >= perMonth;
    }
    return { jar, balance, progress, reached, perMonth, monthsLeft, onTrack, overspent: balance < 0 };
}
export function breathingRoom(money, transactions, today, 
/** Other committed outflows before payday in DA (tontine rounds, debts
 *  you owe that fall due) — expected INFLOWS are never counted. */
extraDueDA = 0) {
    const payday = nextPayday(money.settings, today);
    const fx = money.settings.fxDaPerUsd;
    let missingFx = false;
    let holdingsDA = 0;
    const accounts = liveAccounts(money);
    for (const a of accounts) {
        const b = accountBalance(a, transactions, money, today);
        if (b.balanceDA === null)
            missingFx = true;
        else
            holdingsDA += b.balanceDA;
    }
    const jarsDA = liveJars(money).reduce((s, j) => s + Math.max(0, jarBalance(money, j.id)), 0);
    let dueDA = 0;
    for (const v of obligationViews(money, today)) {
        const cycles = cyclesDueBy(v, payday).length;
        if (cycles === 0)
            continue;
        const da = toDA(v.estimate, v.obligation.currency, fx);
        if (da === null)
            missingFx = true;
        else
            dueDA += da * cycles;
    }
    dueDA += Math.max(0, extraDueDA);
    const room = holdingsDA - jarsDA - dueDA;
    const days = Math.max(1, daysBetween(today, payday));
    return {
        hasAccounts: accounts.length > 0,
        holdingsDA,
        jarsDA,
        dueDA,
        room,
        perDay: Math.floor(room / days),
        days,
        payday,
        missingFx,
    };
}
export function charmSuggestionId(charmId, txId) {
    return `charm:${charmId}:${txId}`;
}
/**
 * Suggested jar top-ups from the user's own rules, derived (never stored)
 * from the ledger: confirm = a jar move with the suggestion's id, dismiss =
 * the id joins `dismissed`. Bill payments and resists never fire charms.
 */
export function charmSuggestions(money, transactions) {
    const done = new Set([...money.dismissed, ...money.jarMoves.map((m) => m.id)]);
    const jars = new Set(liveJars(money).map((j) => j.id));
    const out = [];
    for (const c of money.charms) {
        if (c.archived || !c.active || !jars.has(c.jarId))
            continue;
        for (const t of transactions) {
            if (t.resistedImpulse || t.obligationId || t.amountDA <= 0 || t.date < c.since)
                continue;
            const id = charmSuggestionId(c.id, t.id);
            if (done.has(id))
                continue;
            let amount = 0;
            let label = '';
            if (c.kind === 'roundup') {
                amount = Math.ceil(t.amountDA / c.value) * c.value - t.amountDA;
                label = `Round-up on ${fmtDA(t.amountDA)} ${t.category}`;
            }
            else if (t.category === c.category) {
                amount = c.kind === 'category' ? c.value : Math.round((t.amountDA * c.value) / 100);
                label =
                    c.kind === 'category'
                        ? `Every ${c.category} log sends ${fmtDA(c.value)}`
                        : `${c.value}% treat tax on ${fmtDA(t.amountDA)} ${c.category}`;
            }
            if (amount > 0)
                out.push({ id, charm: c, jarId: c.jarId, txId: t.id, amount, label });
        }
    }
    return out;
}
const CYCLES_PER_YEAR = { weekly: 52, monthly: 12, yearly: 1, once: 0 };
export function recurringAudit(money, today) {
    const fx = money.settings.fxDaPerUsd;
    return obligationViews(money, today)
        .filter((v) => v.obligation.cadence !== 'once' && v.status !== 'done')
        .map((v) => {
        const da = toDA(v.estimate, v.obligation.currency, fx);
        return { view: v, yearlyDA: da === null ? null : da * CYCLES_PER_YEAR[v.obligation.cadence] };
    });
}
