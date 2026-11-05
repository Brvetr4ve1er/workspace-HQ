// money space — renderer intents → Ember reducer actions.
// The renderer is untrusted input: it sends INTENTS ("log 1200 DA to cash"), never entities.
// Ids and timestamps are minted here, every field is re-validated, and the result still goes
// through the ported slice reducers + sanitizeState — so a forged intent can at worst be refused.
// apply() throws MoneyError with owner-facing copy; anything else is a bug.
import { moneyReducer, withPayment } from './state.mjs';
import { inboxReducer, planAdd } from './inbox.mjs';
import { obligationViews, toDA } from './engine.mjs';
import { parseAmount, parseMany, INBOX_CATEGORIES } from './parse.mjs';
import { localDayISO, isValidDayKey } from './dates.mjs';
import { alreadyLogged } from './dedupe.mjs';
import { sanitizeState } from './store.mjs';

export class MoneyError extends Error {}
const fail = (msg) => { throw new MoneyError(msg); };
// 'YYYY-MM-DD' → that day's local noon as ISO (an instant safely inside the owner's day, whatever the zone)
const localNoonISO = (day) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, 12).toISOString(); };

export const INTENTS = ['account-save', 'account-archive', 'settings', 'log', 'tx-undo', 'obligation-save', 'obligation-archive', 'obligation-pay', 'obligation-unpay', 'jar-save', 'jar-archive', 'jar-move', 'jar-cover', 'split-save', 'payday-run', 'inbox-paste', 'inbox-confirm', 'inbox-reject', 'inbox-clear'];
export const CATEGORIES = [...INBOX_CATEGORIES];
const KINDS = ['bill', 'variable', 'subscription', 'installment'], CADENCES = ['monthly', 'weekly', 'yearly', 'once'];
const MAX_PASTE = 20000;

// ---- field readers: strings from inputs, numbers from anywhere, all bounded --------------------
const text = (v, max, what) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) fail(`${what} is empty.`); return s.slice(0, max); };
const optText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// "2 500", "1.200,00", "12.49" all read like the parser reads receipts; > 0 and under a billion
function amount(v, what = 'amount') {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseAmount(v.trim()) : null;
  if (n === null || !Number.isFinite(n) || n <= 0 || n >= 1e9) fail(`${what} needs a number above 0.`);
  return Math.round(n * 100) / 100;
}
const optAmount = (v, what) => (v === undefined || v === null || v === '' ? null : amount(v, what));
// a balance may be zero (an empty card), however it is typed — "0", "0.00", "0,00", "00" all parse to exactly 0;
// junk and negatives still parse to null and get amount()'s refusal
const balanceAmount = (v) => ((typeof v === 'number' ? v : typeof v === 'string' ? parseAmount(v.trim()) : null) === 0 ? 0 : amount(v, 'balance'));
const currency = (v) => (v === 'USD' ? 'USD' : v === 'DA' || v === undefined ? 'DA' : fail('currency is DA or USD.'));
const day = (v, what) => (isValidDayKey(v) ? v : fail(`${what} needs a date (yyyy-mm-dd).`));
const id = (v) => (typeof v === 'string' && /^[\w:.-]{1,80}$/.test(v) ? v : fail('that item is gone — reload and try again.'));

function liveAccount(state, accountId) {
  if (!accountId) return null;
  const a = state.money.accounts.find((x) => x.id === accountId && !x.archived);
  return a || fail('that account is gone — pick another.');
}
// a reducer that hands back the same object refused the input (its own sanitizer said no)
function must(next, prev, msg) { if (next === prev) fail(msg); return next; }

/**
 * @param state  sanitized state (store.mjs)
 * @param intent { type, ...fields } straight from the renderer
 * @param env    { now: Date, newId: () => string } — injected so tests are deterministic
 * @returns { state, note } note = owner-facing summary for the toast
 */
export function apply(state, intent, env) {
  if (!intent || typeof intent !== 'object' || !INTENTS.includes(intent.type)) fail('unknown action.');
  const now = env.now, nowISO = now.toISOString(), today = localDayISO(now), newId = env.newId;
  const s = state, m = s.money, x = intent;
  const withMoney = (money) => ({ ...s, money });
  let next, note = '';
  switch (x.type) {
    case 'account-save': {
      // new account, rename, or "confirm balance" — all re-anchor at now: the typed balance is the truth from here on
      const prev = x.id ? m.accounts.find((a) => a.id === id(x.id)) : null;
      if (x.id && !prev) fail('that account is gone — reload and try again.');
      const balance = balanceAmount(x.balance);
      const account = { id: prev ? prev.id : newId(), name: text(x.name ?? prev?.name, 40, 'name'), currency: prev ? prev.currency : currency(x.currency), anchorBalance: balance, anchorAt: nowISO, archived: false, updatedAt: nowISO };
      next = withMoney(must(moneyReducer(m, { type: 'money/account-upsert', account }), m, 'that account could not be saved.'));
      note = prev ? `${account.name} confirmed` : `${account.name} added`;
      break;
    }
    case 'account-archive': {
      const a = liveAccount(s, id(x.id));
      next = withMoney(moneyReducer(m, { type: 'money/account-upsert', account: { ...a, archived: true, updatedAt: nowISO } }));
      note = `${a.name} archived`;
      break;
    }
    case 'settings': {
      const fx = optAmount(x.fxDaPerUsd, 'rate');
      const pd = x.paydayDay === '' || x.paydayDay == null ? null : Number(x.paydayDay);
      if (pd !== null && !(Number.isInteger(pd) && pd >= 1 && pd <= 28)) fail('payday is a day from 1 to 28.');
      next = withMoney(moneyReducer(m, { type: 'money/settings', settings: { fxDaPerUsd: fx, paydayDay: pd, split: m.settings.split }, nowISO }));
      note = 'settings saved';
      break;
    }
    case 'log': {
      const cur = currency(x.currency), amt = amount(x.amount), acc = liveAccount(s, x.accountId);
      const amountDA = toDA(amt, cur, m.settings.fxDaPerUsd);
      if (amountDA === null) fail('set your DA rate first — this one is in USD.');
      const category = CATEGORIES.includes(x.category) ? x.category : 'Other';
      const tx = { id: newId(), amountDA, category, date: today, at: nowISO };
      const n = optText(x.note, 200); if (n) tx.note = n;
      if (acc) tx.accountId = acc.id;
      if (cur === 'USD') tx.original = { amount: amt, currency: 'USD' };
      next = { ...s, transactions: [tx, ...s.transactions] };
      note = `logged · ${category}`;
      break;
    }
    case 'tx-undo': {
      const t = s.transactions.find((r) => r.id === id(x.id)) || fail('that entry is already gone.');
      // a bill payment is undone from the runway, so its payment record goes with it
      if (t.obligationId) fail('undo this one from the runway — it is a bill payment.');
      next = { ...s, transactions: s.transactions.filter((r) => r.id !== t.id) };
      note = 'entry removed';
      break;
    }
    case 'obligation-save': {
      const prev = x.id ? m.obligations.find((o) => o.id === id(x.id)) : null;
      if (x.id && !prev) fail('that bill is gone — reload and try again.');
      const kind = KINDS.includes(x.kind) ? x.kind : 'bill', cadence = CADENCES.includes(x.cadence) ? x.cadence : 'monthly';
      let installment = null;
      if (kind === 'installment') {
        const total = Number(x.installmentTotal), paidBefore = Number(x.paidBefore || 0);
        if (!(Number.isInteger(total) && total >= 2 && total <= 360)) fail('installments: how many payments in all (2–360)?');
        if (!(Number.isInteger(paidBefore) && paidBefore >= 0 && paidBefore < total)) fail('already paid must be less than the total.');
        installment = { total, paidBefore };
      }
      const acc = liveAccount(s, x.accountId);
      const obligation = { id: prev ? prev.id : newId(), name: text(x.name, 40, 'name'), amount: amount(x.amount), currency: currency(x.currency), kind, cadence: kind === 'installment' ? 'monthly' : cadence, firstDue: day(x.firstDue, 'first due'), accountId: acc ? acc.id : null, installment, nextStep: optText(x.nextStep, 80), archived: false, updatedAt: nowISO };
      next = withMoney(must(moneyReducer(m, { type: 'money/obligation-upsert', obligation }), m, 'that bill could not be saved.'));
      note = prev ? `saved ${obligation.name}` : `${obligation.name} is on the runway`;
      break;
    }
    case 'obligation-archive': {
      const o = m.obligations.find((r) => r.id === id(x.id) && !r.archived) || fail('that bill is gone.');
      next = withMoney(moneyReducer(m, { type: 'money/obligation-upsert', obligation: { ...o, archived: true, updatedAt: nowISO } }));
      note = `${o.name} archived`;
      break;
    }
    case 'obligation-pay': {
      // pays the next unpaid cycle: a Bills ledger row + a payment record linked to it (Ember's OBLIGATION_PAY)
      const v = obligationViews(m, today).find((r) => r.obligation.id === id(x.id)) || fail('that bill is gone.');
      if (v.nextDue === null) fail(`${v.obligation.name} is already fully paid.`);
      // a blank amount pays the estimate. The engine rounds a variable bill's average to a whole unit (right for DA, pinned by
      // its tests); in USD that drops the cents ($21.49 paid as $21), so USD takes a 2-decimal mean of the same history
      const blank = x.amount === undefined || x.amount === '', ob = v.obligation;
      const est = ob.currency === 'USD' && ob.kind === 'variable' && v.history.length ? Math.round(v.history.reduce((t, a) => t + a, 0) / v.history.length * 100) / 100 : v.estimate;
      const amt = blank ? est : amount(x.amount);
      const amountDA = toDA(amt, ob.currency, m.settings.fxDaPerUsd);
      if (amountDA === null) fail('set your DA rate first — this bill is in USD.');
      const acc = liveAccount(s, x.accountId || ob.accountId), txId = newId();   // '' (no pick) falls back to the bill's own account
      const tx = { id: txId, amountDA, category: 'Bills', note: ob.name, date: today, at: nowISO, obligationId: ob.id };
      if (acc) tx.accountId = acc.id;
      if (ob.currency === 'USD') tx.original = { amount: amt, currency: 'USD' };
      const payment = { id: newId(), obligationId: ob.id, due: v.nextDue, paidOn: today, amount: amt, currency: ob.currency, txId, void: false, updatedAt: nowISO };
      const money = must(withPayment(m, payment), m, 'that payment could not be recorded.');
      next = { ...s, money, transactions: [tx, ...s.transactions] };
      note = `${ob.name} paid`;
      break;
    }
    case 'obligation-unpay': {
      const p = m.payments.find((r) => r.id === id(x.paymentId) && !r.void) || fail('that payment is already undone.');
      const money = moneyReducer(m, { type: 'money/payment-void', id: p.id, nowISO });
      next = { ...s, money, transactions: s.transactions.filter((t) => t.id !== p.txId) };
      note = 'payment undone';
      break;
    }
    case 'jar-save': {
      const prev = x.id ? m.jars.find((j) => j.id === id(x.id)) : null;
      if (x.id && !prev) fail('that jar is gone — reload and try again.');
      const target = optAmount(x.target, 'target');
      const targetDate = x.targetDate ? day(x.targetDate, 'target date') : null;
      if (targetDate && target === null) fail('a target date needs a target amount.');
      const jar = { id: prev ? prev.id : newId(), name: text(x.name, 40, 'name'), emoji: prev ? prev.emoji : '', target, targetDate, locked: prev ? prev.locked : false, archived: false, updatedAt: nowISO };
      next = withMoney(must(moneyReducer(m, { type: 'money/jar-upsert', jar }), m, 'that jar could not be saved.'));
      note = prev ? `saved ${jar.name}` : `${jar.name} jar added`;
      break;
    }
    case 'jar-archive': {
      const j = m.jars.find((r) => r.id === id(x.id) && !r.archived) || fail('that jar is gone.');
      next = withMoney(moneyReducer(m, { type: 'money/jar-upsert', jar: { ...j, archived: true, updatedAt: nowISO } }));
      note = `${j.name} archived`;
      break;
    }
    case 'jar-move': {
      const j = m.jars.find((r) => r.id === id(x.jarId) && !r.archived) || fail('that jar is gone.');
      const amt = amount(x.amount), out = x.kind === 'withdraw';
      next = withMoney(must(moneyReducer(m, { type: 'money/jar-move', move: { id: newId(), jarId: j.id, amount: out ? -amt : amt, date: today, kind: out ? 'withdraw' : 'topup' } }), m, 'that move could not be saved.'));
      note = out ? `took from ${j.name}` : `added to ${j.name}`;
      break;
    }
    case 'jar-cover': {
      // overspent jar → cover it from another: two moves sharing one id pair (Ember's coverMoves)
      const from = m.jars.find((r) => r.id === id(x.fromJarId) && !r.archived) || fail('pick a jar to cover from.');
      const to = m.jars.find((r) => r.id === id(x.toJarId) && !r.archived) || fail('that jar is gone.');
      if (from.id === to.id) fail('pick a different jar to cover from.');
      const amt = amount(x.amount), pair = newId();
      next = withMoney(moneyReducer(m, { type: 'money/jar-moves', moves: [{ id: `cover:${pair}:out`, jarId: from.id, amount: -amt, date: today, kind: 'cover' }, { id: `cover:${pair}:in`, jarId: to.id, amount: amt, date: today, kind: 'cover' }] }));
      note = `${to.name} covered from ${from.name}`;
      break;
    }
    case 'split-save': {
      const live = new Set(m.jars.filter((j) => !j.archived).map((j) => j.id));
      const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 50).map((r) => ({ jarId: id(r && r.jarId), amount: r && r.amount !== '' && r.amount != null ? amount(r.amount) : 0 })).filter((r) => r.amount > 0 && live.has(r.jarId));
      next = withMoney(moneyReducer(m, { type: 'money/settings', settings: { fxDaPerUsd: m.settings.fxDaPerUsd, paydayDay: m.settings.paydayDay, split: rows }, nowISO }));
      note = 'payday split saved';
      break;
    }
    case 'payday-run': {
      // income lands on one account, then the saved split replays into jars (Ember's PaydayCard)
      const acc = liveAccount(s, x.accountId) || fail('pick the account the pay landed in.');
      const amt = amount(x.amount), incomeId = newId();
      const live = new Set(m.jars.filter((j) => !j.archived).map((j) => j.id));
      const split = m.settings.split.filter((r) => live.has(r.jarId) && r.amount > 0);
      let money = must(moneyReducer(m, { type: 'money/income-add', income: { id: incomeId, accountId: acc.id, amount: amt, date: today, at: nowISO, note: 'payday' } }), m, 'that income could not be saved.');
      if (split.length) money = moneyReducer(money, { type: 'money/jar-moves', moves: split.map((r) => ({ id: `payday:${incomeId}:${r.jarId}`, jarId: r.jarId, amount: r.amount, date: today, kind: 'payday' })) });
      next = withMoney(money);
      note = split.length ? `payday in · split into ${split.length} jar${split.length === 1 ? '' : 's'}` : 'payday in';
      break;
    }
    case 'inbox-paste': {
      const raw = typeof x.text === 'string' ? x.text : '';
      if (!raw.trim()) fail('paste something first — a receipt, an email or an sms.');
      if (raw.length > MAX_PASTE) fail('that is too long to read at once — paste a few messages at a time.');
      const { candidates, messages } = parseMany(raw, { from: optText(x.from, 80), receivedAt: nowISO });
      if (!candidates.length) fail('no DA or USD amount found in that. nothing was saved.');
      const rows = candidates.map((c) => ({ ...c, id: newId(), status: 'pending', txId: null, cleared: false, updatedAt: nowISO }));
      const plan = planAdd(s.inbox, rows, nowISO);
      next = { ...s, inbox: plan.state };
      const parts = [`read ${messages} message${messages === 1 ? '' : 's'}`];
      if (plan.added) parts.push(`${plan.added} slip${plan.added === 1 ? '' : 's'} to review`);
      if (plan.merged) parts.push(`${plan.merged} matched a slip already here`);
      if (messages > candidates.length) parts.push(`${messages - candidates.length} had no amount`);
      note = parts.join(' · ');
      break;
    }
    case 'inbox-confirm': {
      const c = s.inbox.candidates.find((r) => r.id === id(x.id) && r.status === 'pending' && !r.cleared) || fail('that slip is already handled.');
      if (c.flags.includes('refund')) {
        // a refund is money coming back: income on a same-currency account, never spending
        const acc = x.accountId ? liveAccount(s, x.accountId) : null;
        if (acc && acc.currency !== c.currency) fail(`a ${c.currency} refund goes back to a ${c.currency} account.`);
        let money = m;
        // income needs an instant: a back-dated refund gets one on its OWN day (local noon), not now — counted by now, a
        // refund already inside a balance confirmed since would be counted twice
        if (acc) money = moneyReducer(m, { type: 'money/income-add', income: { id: newId(), accountId: acc.id, amount: Math.abs(c.amount), date: c.date, at: c.date === today ? nowISO : localNoonISO(c.date), note: `refund · ${c.merchant}`.slice(0, 120) } });
        next = { ...s, money, inbox: inboxReducer(s.inbox, { type: 'inbox/resolve', id: c.id, status: 'confirmed', txId: null, nowISO }) };
        note = acc ? `refund back on ${acc.name}` : 'refund noted';
        break;
      }
      // promos, renewal notices and already-logged purchases need a deliberate second tap — enforced here, not only in the UI
      const logged = alreadyLogged(c, s.transactions, m.settings.fxDaPerUsd);
      if ((c.flags.includes('promo') || c.flags.includes('not_a_charge') || logged) && x.anyway !== true) fail('this one looks like it should not be logged — tap confirm anyway if it should.');
      const amountDA = c.amount === 0 ? 0 : toDA(c.amount, c.currency, m.settings.fxDaPerUsd);
      if (amountDA === null) fail('set your DA rate first — this one is in USD.');
      const acc = liveAccount(s, x.accountId);
      const tx = { id: newId(), amountDA, category: CATEGORIES.includes(x.category) ? x.category : c.suggestedCategory, note: 'from inbox', date: c.date };
      // only a same-day slip gets an instant: the engine counts a row by `at` when it has one, which would count a
      // back-dated slip that a balance confirmed since already includes; without `at` its date rule decides
      if (c.date === today) tx.at = nowISO;
      if (acc) tx.accountId = acc.id;
      if (c.currency === 'USD') tx.original = { amount: c.amount, currency: 'USD' };
      next = { ...s, transactions: [tx, ...s.transactions], inbox: inboxReducer(s.inbox, { type: 'inbox/resolve', id: c.id, status: 'confirmed', txId: tx.id, nowISO }) };
      note = `${c.merchant} logged`;
      break;
    }
    case 'inbox-reject': {
      const c = s.inbox.candidates.find((r) => r.id === id(x.id) && r.status === 'pending') || fail('that slip is already handled.');
      next = { ...s, inbox: inboxReducer(s.inbox, { type: 'inbox/resolve', id: c.id, status: 'rejected', txId: null, nowISO }) };
      note = 'slip set aside';
      break;
    }
    case 'inbox-clear': {
      next = { ...s, inbox: must(inboxReducer(s.inbox, { type: 'inbox/clear-resolved', nowISO }), s.inbox, 'nothing handled to clear.') };
      note = 'handled slips cleared';
      break;
    }
  }
  return { state: sanitizeState(next), note };
}
