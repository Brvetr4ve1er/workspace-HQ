/**
 * Inbox dedupe — one purchase often arrives twice (the shop's receipt and the
 * card's alert). Two candidates are the same purchase when they share amount
 * and currency, sit within a day of each other, and name a similar merchant.
 * Pure; the slice applies it on `inbox/add`, the tray uses `alreadyLogged`
 * to warn about candidates the ledger already holds (derived, never stored).
 */
import { daysBetween } from './dates.mjs';
import { toDA } from './engine.mjs';
import { INBOX_FLAGS } from './parse.mjs';
/** "www.SteamGames.com" → "steamgames"; "Café El-Bahdja" → "cafeelbahdja". */
export function normMerchant(s) {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/^www\./, '')
        .replace(/\.(com|dz|net|org|io|co)\b/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}
export function similarMerchant(a, b) {
    const x = normMerchant(a);
    const y = normMerchant(b);
    if (x.length < 3 || y.length < 3)
        return x === y && x !== '';
    return x.includes(y) || y.includes(x);
}
const near = (a, b) => Math.abs(daysBetween(a, b)) <= 1;
const sameMoney = (a, b) => Math.abs(a - b) < 0.005;
/** Same purchase? A renewal notice or promo never merges with a real charge. */
export function isSamePurchase(a, b) {
    if (a.currency !== b.currency || !sameMoney(a.amount, b.amount) || !near(a.date, b.date))
        return false;
    for (const f of ['not_a_charge', 'promo', 'refund']) {
        if (a.flags.includes(f) !== b.flags.includes(f))
            return false;
    }
    return similarMerchant(a.merchant, b.merchant);
}
function unionSources(a, b) {
    const out = [...a];
    for (const s of b)
        if (!out.some((x) => x.text === s.text))
            out.push(s);
    return out;
}
/**
 * Fold `b` into `a` (same purchase). The more confident read keeps its
 * merchant and category; sources are unioned by text. A second *distinct*
 * message adds the 'duplicate' flag — the same text pasted twice does not.
 */
export function mergeCandidate(a, b) {
    const sources = unionSources(a.sources, b.sources);
    const lead = b.confidence > a.confidence ? b : a;
    const flags = new Set([...a.flags, ...b.flags]);
    if (sources.length > 1)
        flags.add('duplicate');
    return {
        ...a,
        merchant: lead.merchant,
        suggestedCategory: lead.suggestedCategory,
        date: a.date <= b.date ? a.date : b.date,
        sources,
        // Two independent messages agreeing is itself evidence.
        confidence: Math.min(1, Math.round((Math.max(a.confidence, b.confidence) + (sources.length > a.sources.length ? 0.05 : 0)) * 100) / 100),
        flags: INBOX_FLAGS.filter((f) => flags.has(f)),
    };
}
/** Collapse a list of fresh candidates into one per purchase. */
export function dedupeCandidates(list) {
    const out = [];
    for (const c of list) {
        const i = out.findIndex((x) => isSamePurchase(x, c));
        if (i === -1)
            out.push(c);
        else
            out[i] = mergeCandidate(out[i], c);
    }
    return out;
}
/**
 * Does the ledger already hold this purchase? Same DA amount (or the same
 * original USD amount, or its DA conversion at the user's rate) within a day.
 */
export function alreadyLogged(c, transactions, fx) {
    const da = toDA(Math.abs(c.amount), c.currency, fx);
    return transactions.some((t) => {
        if (t.resistedImpulse || !near(t.date, c.date))
            return false;
        if (c.currency === 'USD' && t.original?.currency === 'USD' && sameMoney(t.original.amount, Math.abs(c.amount)))
            return true;
        return da !== null && Math.round(t.amountDA) === Math.round(da);
    });
}
