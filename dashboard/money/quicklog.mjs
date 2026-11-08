// money space — the one-line spend parser ("150 cafe", "taxi 400", "$12.49 netflix card", "hier taxi 400").
// PURE: no fs, no network, no wall clock — the caller passes today's day key, the live accounts and the rate.
// It never writes anything and never guesses: a line it cannot fully read comes back as a SLIP (the caller turns it
// into a pending Inbox slip through the existing inbox-paste path) or as NONE with the reason in the owner's words.
//
//   parseLine(text, { accounts:[{id,name,currency}], fxDaPerUsd:number|null, today:'YYYY-MM-DD' })
//     → { kind:'log',  amount, currency, category, accountId, account, date, note, label, reason:'' }
//     | { kind:'slip', …same fields…, slipText, reason }      (slipText feeds parseMany: "150 DA at cafe 2026-11-05")
//     | { kind:'none', reason, amount:null, … }               (refused: nothing to write)
//   previewOf(result)  → the dry-run shape the renderer gets: { kind, amount, currency, category, account, date, label, reason }
//   amountLine(text)   → null | { amount, currency:'DA'|'USD'|'', tagged }   — "is this a spend line?" for Ctrl K / Ctrl+Alt+X.
//                        The renderer (dashboard-v5/src/logic/money-line.js) and dashboard/cast.js carry a copy of this
//                        function and WORD list; dashboard/money-line-parity.test.mjs keeps the three identical.
//
// parse.mjs is read-only here: its merchant rules (parseMessage) give the category when the small word map below has no hit.
import { parseAmount, parseMessage, INBOX_CATEGORIES } from './parse.mjs';
import { fmtMoney } from './engine.mjs';
import { addDaysISO } from './dates.mjs';

export const MAX_LINE = 200;
export const MAX_NOTE = 120;
const MAX_AMOUNT = 1e9;

/* ---- the small word map: runs BEFORE parse.mjs (which maps 'course' to Transport, parse.mjs:116) ---- */
export const WORD_MAP = {
  Food: ['cafe', 'coffee', 'kahwa', 'courses', 'pain', 'food', 'resto', 'snack'],
  Transport: ['taxi', 'bus', 'yassir', 'essence', 'tram', 'metro'],
  Bills: ['loyer', 'idoom', 'sonelgaz', 'facture'],
  Health: ['pharmacie', 'pharmacy'],
};
const WORD_CATEGORY = new Map();
for (const [cat, words] of Object.entries(WORD_MAP)) for (const w of words) WORD_CATEGORY.set(w, cat);

/* ---- numbers and currency tags (same grammar as parse.mjs's NUM) ---- */
const SP = '[ \\u00A0\\u202F\\u2009]';
const NUM = `\\d{1,3}(?:(?:${SP}|[.,])\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
const PRE = 'us\\$|usd|\\$|dzd|da|eur|€';
const POST = 'dzd|dinars?|da|usd|\\$|dollars?|eur|€';
const AMOUNT_RE = new RegExp(`(?<![\\p{L}\\d.,$€])(?:(${PRE})${SP}?)?(${NUM})(?:${SP}?(${POST})(?![\\p{L}\\d]))?(?![\\p{L}\\d])`, 'giu');
const DATE_WORD = /\b(?:hier|yesterday)\b/giu;
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9$]+/).filter(Boolean);
// 'DA' | 'USD' | 'EUR' | '' for a tag as typed
function tagOf(t) {
  if (!t) return '';
  const x = t.toLowerCase();
  if (x === 'da' || x === 'dzd' || x.startsWith('dinar')) return 'DA';
  if (x === 'usd' || x === 'us$' || x === '$' || x.startsWith('dollar')) return 'USD';
  return 'EUR';
}
const round2 = (n) => Math.round(n * 100) / 100;
const isYear = (numText, n) => /^\d{4}$/.test(numText) && n >= 1900 && n <= 2099;
// a bare whole number 1–10 followed by a word is a quantity ("3 cafe"), not a price
const isCount = (i, s) => !i.tag && Number.isInteger(i.n) && i.n >= 1 && i.n <= 10 && /^ \p{L}/u.test(s.slice(i.end, i.end + 2));
const hasCategoryWord = (ws) => ws.some((w) => WORD_CATEGORY.has(w));

/* ---- amountLine: a standalone number at the start or the end of the line ---------------------------
   KEEP IN SYNC with dashboard-v5/src/logic/money-line.js and dashboard/cast.js (parity test). */
const AL_PRE = new RegExp(`(?:(${PRE})${SP}?)?`);
const AL_NUM = `(${NUM})`;
const AL_POST = `(?:${SP}?(${POST})(?![\\p{L}\\d]))?`;
const AL_START = new RegExp(`^${AL_PRE.source}${AL_NUM}${AL_POST}(?=\\s|$)`, 'iu');
const AL_END = new RegExp(`(?<=^|\\s)${AL_PRE.source}${AL_NUM}${AL_POST}$`, 'iu');
export function amountLine(text) {
  if (typeof text !== 'string') return null;
  const s0 = text.trim().replace(/\s+/g, ' ');
  if (!s0 || s0.length > MAX_LINE) return null;
  const s = s0.replace(/^(?:hier|yesterday) /i, '').replace(/ (?:hier|yesterday)$/i, '');
  const m = AL_START.exec(s) || AL_END.exec(s);
  if (!m) return null;
  const n = parseAmount(m[2]);
  if (n === null || n <= 0 || n >= MAX_AMOUNT) return null;
  const pre = tagOf(m[1]), post = tagOf(m[3]);
  if (pre === 'EUR' || post === 'EUR' || (pre && post && pre !== post)) return null;
  const currency = pre || post, tagged = currency !== '';
  if (!tagged && isYear(m[2], n) && !hasCategoryWord(words(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)))) return null;
  return { amount: round2(n), currency: currency || 'DA', tagged };
}

/* ---- parseLine ------------------------------------------------------------------------------------- */
const none = (reason) => ({ kind: 'none', reason, amount: null, currency: '', category: '', accountId: '', account: '', date: '', note: '', label: '' });

function nameTokens(name) { return fold(String(name || '')).split(/[^a-z0-9]+/).filter((t) => t.length >= 3); }

/** The account a line names ("cash", "card", "ccp"): its token, the account, and which word to drop from the note. */
function namedAccount(ws, accounts) {
  for (const w of ws) {
    const a = accounts.find((acc) => nameTokens(acc.name).includes(w));
    if (a) return { account: a, word: w };
  }
  return null;
}

function dropWord(s, word) {
  const re = new RegExp(`(^|[^\\p{L}\\d])${word.replace(/[$]/g, '\\$&')}(?![\\p{L}\\d])`, 'iu');
  return s.replace(re, (_m, pre) => pre);
}

function categoryFor(note, ws, amount) {
  for (const w of ws) if (WORD_CATEGORY.has(w)) return WORD_CATEGORY.get(w);
  if (!note) return 'Other';
  try {
    const c = parseMessage(`${amount.toFixed(2)} DA ${note}`);
    if (c && INBOX_CATEGORIES.includes(c.suggestedCategory)) return c.suggestedCategory;
  } catch { /* the word map and 'Other' are the floor */ }
  return 'Other';
}

export function parseLine(text, ctx = {}) {
  const accounts = Array.isArray(ctx.accounts) ? ctx.accounts : [];
  const fx = typeof ctx.fxDaPerUsd === 'number' && ctx.fxDaPerUsd > 0 ? ctx.fxDaPerUsd : null;
  const today = ctx.today;
  const raw = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  if (!raw) return none('type it like 150 cafe');
  if (raw.length > MAX_LINE) return none(`that line is too long (${MAX_LINE} characters at most).`);

  const dated = DATE_WORD.test(raw); DATE_WORD.lastIndex = 0;
  const date = dated ? addDaysISO(today, -1) : today;
  const s = raw.replace(DATE_WORD, ' ').replace(/\s+/g, ' ').trim();
  // a written-out date would be dropped from the note and the row would land on today: say so instead of guessing
  if (ISO_DATE.test(s)) return none('dates are only hier / yesterday here — leave the date out.');

  const items = [];
  for (const m of s.matchAll(AMOUNT_RE)) {
    const n = parseAmount(m[2]);
    if (n === null) continue;
    const pre = tagOf(m[1]), post = tagOf(m[3]);
    items.push({ index: m.index, end: m.index + m[0].length, n, numText: m[2], pre, post, tag: pre || post });
  }
  if (!items.length) return none('type it like 150 cafe');
  // a number glued to a leading minus is a refund or a range: money coming back is the Inbox's job, never a +spend
  if (items.some((i) => s[i.index - 1] === '-' && (i.index === 1 || /\s/.test(s[i.index - 2])))) return none('a minus sign reads as a refund — refunds go through the Inbox.');
  if (items.some((i) => i.pre === 'EUR' || i.post === 'EUR')) return none('only DA and USD are tracked here.');
  if (items.some((i) => i.pre && i.post && i.pre !== i.post)) return none('that amount names two currencies — use one.');

  const tagged = items.filter((i) => i.tag);
  let chosen = null, ambiguous = false;
  // one tagged amount wins only when every other number is clearly a count ("3 cafe 150da"); "50 pain 20 da" asks
  if (tagged.length === 1) {
    chosen = tagged[0];
    if (!items.every((i) => i === chosen || isCount(i, s))) ambiguous = true;
  } else if (tagged.length === 0 && items.length === 1) chosen = items[0];
  else { ambiguous = true; chosen = tagged[0] || items[0]; }

  const amount = round2(chosen.n);
  if (amount <= 0) return none('zero is not a spend.');
  if (amount >= MAX_AMOUNT) return none('that is too big to be a spend.');

  const before = s.slice(0, chosen.index), after = s.slice(chosen.end);
  const restRaw = (before + ' ' + after).replace(/\s+/g, ' ').trim();
  const restWords = words(restRaw);
  const currency = chosen.tag || 'DA';

  if (!ambiguous && !chosen.tag) {
    if (isYear(chosen.numText, chosen.n) && !hasCategoryWord(restWords)) return none(`${chosen.numText} reads as a year, not an amount — add da or usd if it is one.`);
  }

  // account: a word that names one, else the first account in the line's own currency, else the first account
  const named = namedAccount(restWords, accounts);
  if (!ambiguous && !chosen.tag && named) {
    // a bare number must sit at an edge once the account word is ignored: "taxi 400 cash" reads, "buy 400 things" does not
    const out = (str) => words(str).filter((w) => w !== named.word);
    if (out(before).length && out(after).length) return none('put the amount first or last — like 150 cafe.');
  } else if (!ambiguous && !chosen.tag && words(before).length && words(after).length) {
    return none('put the amount first or last — like 150 cafe.');
  }
  const acc = named ? named.account : (accounts.find((a) => a.currency === currency) || accounts[0] || null);
  const note = (named ? dropWord(restRaw, named.word) : restRaw).replace(/\s+/g, ' ').replace(/^[\s,;:·–-]+|[\s,;:·–-]+$/g, '').slice(0, MAX_NOTE);
  const noteWords = words(note);
  const category = categoryFor(note, noteWords, amount);

  const base = {
    amount, currency, category, accountId: acc ? acc.id : '', account: acc ? acc.name : '', date, note,
    label: [fmtMoney(amount, currency), category, acc ? acc.name : '', dated ? 'yesterday' : ''].filter(Boolean).join(' · '),
  };
  // one slip line for the Inbox: parseMany reads "<amount> <CUR> at <what> <date>"
  const slipText = `${amount.toFixed(2)} ${currency}${note ? ' at ' + note : ''}${date !== today ? ' ' + date : ''}`;
  if (ambiguous) return { kind: 'slip', ...base, slipText, reason: 'more than one number — confirm the amount in the Inbox.' };
  if (currency === 'USD' && fx === null) return { kind: 'slip', ...base, slipText, reason: 'needs your DA rate' };
  return { kind: 'log', ...base, reason: '' };
}

/** What a dry run hands the renderer: no ids, no slip text. */
export function previewOf(r) {
  return { kind: r.kind, amount: r.amount, currency: r.currency, category: r.category, account: r.account, date: r.date, label: r.label, reason: r.reason };
}
