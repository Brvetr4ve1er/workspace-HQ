// money space — the one persisted shape (data/money/state.json) and its sanitizer.
// Ported from Ember (Brvetr4ve1er/money-manager-): the money + inbox slices keep their own
// field-by-field sanitizers (state.mjs, inbox.mjs); this file adds the ledger rows and the
// envelope around them. Everything that enters — a disk read, an Ember export, a reducer result —
// goes through sanitizeState, so a hand-edited or half-written file can never poison a render.
import { isIsoDatetime, isValidDayKey } from './dates.mjs';
import { defaultMoney, sanitizeMoney, mergeMoney } from './state.mjs';
import { defaultInbox, sanitizeInbox, mergeInbox } from './inbox.mjs';

export const STATE_VERSION = 1;
// a ledger past this is a bug or a hostile file, not a year of coffee
export const MAX_TRANSACTIONS = 50000;

export function defaultState() {
  return { v: STATE_VERSION, money: defaultMoney(), transactions: [], inbox: defaultInbox() };
}

const isRec = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const optStr = (v) => v === undefined || typeof v === 'string';

// same rule as Ember's isTransaction: strict on what feeds balances, rebuilt in one key order.
// Ember-only flags (resistedImpulse) survive so an import never silently turns a "kept" row into spend.
export function sanitizeTx(v) {
  if (!isRec(v) || typeof v.id !== 'string' || !v.id || !isNum(v.amountDA) || v.amountDA < 0) return null;
  if (typeof v.category !== 'string' || !isValidDayKey(v.date) || !optStr(v.note) || !optStr(v.accountId) || !optStr(v.obligationId)) return null;
  if (v.at !== undefined && !isIsoDatetime(v.at)) return null;
  if (v.resistedImpulse !== undefined && typeof v.resistedImpulse !== 'boolean') return null;
  let original;
  if (v.original !== undefined) {
    if (!isRec(v.original) || v.original.currency !== 'USD' || !isNum(v.original.amount) || v.original.amount < 0) return null;
    original = { amount: v.original.amount, currency: 'USD' };
  }
  const t = { id: v.id, amountDA: v.amountDA, category: v.category.slice(0, 40), date: v.date };
  if (v.note) t.note = v.note.slice(0, 200);
  if (v.resistedImpulse) t.resistedImpulse = true;
  if (v.accountId) t.accountId = v.accountId;
  if (original) t.original = original;
  if (v.at) t.at = v.at;
  if (v.obligationId) t.obligationId = v.obligationId;
  return t;
}

// newest first, ties by id — one canonical order so a re-save never reshuffles the file
function sortTx(xs) {
  return xs.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? 1 : -1));
}

export function sanitizeTransactions(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set(), out = [];
  for (const raw of v.slice(0, MAX_TRANSACTIONS)) {
    const t = sanitizeTx(raw);
    if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
  }
  return sortTx(out);
}

// accepts this file's own shape AND a raw Ember export (ember-state-v1 carries the same three keys at top level)
export function sanitizeState(v) {
  if (!isRec(v)) return defaultState();
  return { v: STATE_VERSION, money: sanitizeMoney(v.money), transactions: sanitizeTransactions(v.transactions), inbox: sanitizeInbox(v.inbox) };
}

// import = union, never replace: Ember's symmetric merges for the slices, id-union for the ledger
// (the existing row wins a tie — an import can't rewrite what the owner already has here)
export function mergeState(a, b) {
  const have = new Set(a.transactions.map((t) => t.id));
  return sanitizeState({ money: mergeMoney(a.money, b.money), transactions: [...a.transactions, ...b.transactions.filter((t) => !have.has(t.id))], inbox: mergeInbox(a.inbox, b.inbox) });
}
