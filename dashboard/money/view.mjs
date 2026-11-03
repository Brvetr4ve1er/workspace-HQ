// money space — state + today → the finished numbers and strings the renderer shows.
// dc-lite templates can't compute, and vals stay thin: every derived value (balances, breathing
// room, next due, jar pace, inbox flags) is worked out here, main-side, with the ported Ember
// engine. Nothing derived is ever stored — the view is rebuilt on every read, so "today" moves on its own.
import { accountBalance, breathingRoom, cyclesDueBy, fmtDA, fmtMoney, jarView, liveAccounts, liveJars, nextPayday, obligationViews, toDA } from './engine.mjs';
import { alreadyLogged } from './dedupe.mjs';
import { daysBetween, localDayISO, shortDay } from './dates.mjs';
import { CATEGORIES } from './commands.mjs';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const ago = (d) => (d === 0 ? 'confirmed today' : d === 1 ? 'confirmed yesterday' : `confirmed ${d} days ago`);
const until = (d) => (d === null ? 'paid off' : d < 0 ? `${plural(-d, 'day')} late` : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`);

export function flagNotes(c, logged) {
  const out = [];
  if (c.flags.includes('duplicate')) out.push(c.sources.length > 2 ? `${c.sources.length} messages, one purchase — stored once` : 'two messages, one purchase — stored once');
  if (c.flags.includes('not_a_charge')) out.push('a renewal notice, not a charge');
  if (c.flags.includes('promo')) out.push('a promotion, nothing was charged');
  if (c.flags.includes('refund')) out.push('a refund — goes back to a balance, never into spending');
  if (logged) out.push('already in your ledger');
  return out;
}
// the reason a confirm needs a second, deliberate tap (null = log on first tap)
export function warnReason(c, logged) {
  if (c.flags.includes('not_a_charge')) return 'a renewal notice rather than a charge';
  if (c.flags.includes('promo')) return 'a promotion rather than a charge';
  if (logged) return 'something already in your ledger';
  return null;
}

/** @param state sanitized state · @param now Date */
export function buildView(state, now) {
  const today = localDayISO(now), m = state.money, tx = state.transactions, fx = m.settings.fxDaPerUsd;
  const accById = new Map(m.accounts.map((a) => [a.id, a]));
  const payday = nextPayday(m.settings, today);

  const accounts = liveAccounts(m).map((a) => {
    const b = accountBalance(a, tx, m, today);
    return { id: a.id, name: a.name, currency: a.currency, isUsd: a.currency === 'USD', balance: fmtMoney(b.balance, a.currency), balanceRaw: b.balance,
      balanceDA: a.currency === 'USD' ? (b.balanceDA === null ? 'set a DA rate to convert' : '≈ ' + fmtDA(b.balanceDA)) : '',
      estimate: b.isEstimate, tag: b.isEstimate ? 'estimated' : 'as typed', confirmed: ago(b.daysSinceConfirmed), stale: b.isEstimate && b.daysSinceConfirmed >= 7 };
  });

  const br = breathingRoom(m, tx, today);
  const room = { has: br.hasAccounts, amount: fmtDA(br.room), raw: br.room, tight: br.room <= 0, perDay: fmtDA(br.perDay) + ' a day', days: plural(br.days, 'day'), payday: shortDay(br.payday),
    holdings: fmtDA(br.holdingsDA), jars: fmtDA(br.jarsDA), due: fmtDA(br.dueDA), missingFx: br.missingFx };

  let dueTotal = 0, dueMissing = 0;
  const obligations = obligationViews(m, today).map((v) => {
    const ob = v.obligation, cycles = v.nextDue === null ? 0 : cyclesDueBy(v, payday).length, da = toDA(v.estimate, ob.currency, fx);
    if (cycles) { if (da === null) dueMissing++; else dueTotal += da * cycles; }
    const last = v.payments[v.payments.length - 1];
    return { id: ob.id, name: ob.name, kind: ob.kind, cadence: ob.cadence, status: v.status, isLate: v.status === 'late', isSoon: v.status === 'due_soon', isDone: v.status === 'done',
      due: v.nextDue ? shortDay(v.nextDue) : '—', dueLabel: until(v.daysUntil), amount: fmtMoney(v.estimate, ob.currency) + (ob.kind === 'variable' && v.history.length ? ' (avg)' : ''), estimate: v.estimate, currency: ob.currency,
      installment: ob.installment ? `${v.installmentPaid} of ${ob.installment.total}` : '', beforePayday: cycles, nextStep: ob.nextStep, accountId: ob.accountId || '',
      firstDue: ob.firstDue, rawAmount: ob.amount, total: ob.installment ? ob.installment.total : '', paidBefore: ob.installment ? ob.installment.paidBefore : '',
      // undo is offered for a payment made today only — older ones are history, not mis-taps
      undoId: last && last.paidOn === today ? last.id : '' };
  });

  const split = new Map(m.settings.split.map((r) => [r.jarId, r.amount]));
  const jars = liveJars(m).map((j) => {
    const v = jarView(j, m, today);
    return { id: j.id, name: j.name, balance: fmtDA(v.balance), raw: v.balance, hasTarget: j.target !== null, target: j.target === null ? '' : fmtDA(j.target), targetRaw: j.target ?? '', targetDate: j.targetDate || '',
      pct: v.progress === null ? 0 : Math.round(v.progress * 100), reached: v.reached, overspent: v.overspent,
      pace: v.perMonth === null ? '' : `${fmtDA(v.perMonth)} a month for ${plural(v.monthsLeft, 'month')}`, onTrack: v.onTrack === true, offTrack: v.onTrack === false,
      split: split.get(j.id) || 0 };
  });

  const recent = tx.slice(0, 15).map((t) => ({ id: t.id, amount: t.original ? `$${t.original.amount.toFixed(2)} · ${fmtDA(t.amountDA)}` : fmtDA(t.amountDA), category: t.category, note: t.note || '',
    day: shortDay(t.date), account: t.accountId && accById.has(t.accountId) ? accById.get(t.accountId).name : '', isBill: !!t.obligationId, kept: !!t.resistedImpulse }));

  const live = state.inbox.candidates.filter((c) => !c.cleared);
  const slips = live.filter((c) => c.status === 'pending').map((c) => {
    const logged = alreadyLogged(c, tx, fx), refund = c.flags.includes('refund');
    const da = c.currency === 'USD' ? toDA(Math.abs(c.amount), 'USD', fx) : null;
    return { id: c.id, merchant: c.merchant, amount: fmtMoney(Math.abs(c.amount), c.currency) + (refund ? ' back' : ''), approx: c.currency === 'USD' ? (da === null ? 'needs your DA rate' : '≈ ' + fmtDA(da)) : '',
      day: shortDay(c.date), sure: Math.round(c.confidence * 100), notes: flagNotes(c, logged), warn: warnReason(c, logged) || '', refund, currency: c.currency,
      category: c.suggestedCategory, sources: c.sources.map((s) => ({ from: s.from || 'pasted', text: s.text })), merged: c.sources.length > 1 };
  });

  return {
    today, hasAccounts: accounts.length > 0, accounts, room, obligations, dueBefore: fmtDA(dueTotal), dueMissing, daysToPayday: daysBetween(today, payday), payday: shortDay(payday),
    jars, splitTotal: fmtDA(m.settings.split.filter((r) => jars.some((j) => j.id === r.jarId)).reduce((s, r) => s + r.amount, 0)),
    recent, ledgerCount: tx.length, slips, handled: live.length - slips.length, categories: CATEGORIES,
    settings: { fx: fx === null ? '' : String(fx), payday: m.settings.paydayDay === null ? '' : String(m.settings.paydayDay), hasFx: fx !== null },
  };
}
