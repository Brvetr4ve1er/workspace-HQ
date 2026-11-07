// money space — "Money in one minute": the start card's plan. PURE (ids and the clock are injected).
// One start = up to 3 accounts + the rate + the payday, decided here and written by the caller in ONE write.
// Every field is checked the way account-save and settings check theirs (commands.mjs): balances are localized numbers
// that may be zero, the rate is above 0 and under a billion, payday is a whole day from 1 to 28.
//
//   planStart({ accounts, input, nowISO, newId })
//     accounts  the money slice's accounts (state.money.accounts) — start is refused while any LIVE (unarchived) one exists,
//               the same rule that shows the start card, so a repeated or forged start can't add duplicates
//     input     { cashDA?, bankDA?, cardUSD?, fxDaPerUsd?, paydayDay? } straight from the renderer (strings or numbers)
//   → { ok:true,  accounts:[account…], settings:{ fxDaPerUsd:number|null, paydayDay:number|null }, note }
//     (a null setting means "not given": the caller keeps what is stored)
//   → { ok:false, error }   owner-facing copy; the card keeps the typed values
import { parseAmount } from './parse.mjs';

export const START_ACCOUNTS = [
  { key: 'cashDA', name: 'Cash', currency: 'DA', label: 'Cash' },
  { key: 'bankDA', name: 'CCP / bank', currency: 'DA', label: 'CCP / bank' },
  { key: 'cardUSD', name: 'RedotPay card', currency: 'USD', label: 'RedotPay card' },
];
export const EMPTY_ERROR = 'add at least one balance, or import an Ember export.';
export const ALREADY_ERROR = 'Money is already set up — edit accounts on Today.';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const numberOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? parseAmount(v.trim()) : null);
const round2 = (n) => Math.round(n * 100) / 100;
const fail = (error) => ({ ok: false, error });

export function planStart({ accounts, input, nowISO, newId }) {
  if (Array.isArray(accounts) && accounts.some((a) => a && !a.archived)) return fail(ALREADY_ERROR);
  const x = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const made = [];
  for (const spec of START_ACCOUNTS) {
    const v = x[spec.key];
    if (blank(v)) continue;
    const n = numberOf(v);
    // a balance may be zero (an empty card); junk, negatives and a billion or more are refused
    if (n === null || !Number.isFinite(n) || n < 0 || n >= 1e9) return fail(`${spec.label} needs a number, 0 or more.`);
    made.push({ id: newId(), name: spec.name, currency: spec.currency, anchorBalance: round2(n), anchorAt: nowISO, archived: false, updatedAt: nowISO });
  }

  let fx = null;
  if (!blank(x.fxDaPerUsd)) {
    const n = numberOf(x.fxDaPerUsd);
    if (n === null || !Number.isFinite(n) || n <= 0 || n >= 1e9) return fail('rate needs a number above 0.');
    fx = round2(n);
  }
  let payday = null;
  if (!blank(x.paydayDay)) {
    const n = Number(x.paydayDay);
    if (!(Number.isInteger(n) && n >= 1 && n <= 28)) return fail('payday is a day from 1 to 28.');
    payday = n;
  }

  if (!made.length) return fail(EMPTY_ERROR);
  return {
    ok: true, accounts: made, settings: { fxDaPerUsd: fx, paydayDay: payday },
    note: `Money started · ${made.length} account${made.length === 1 ? '' : 's'} added`,
  };
}
