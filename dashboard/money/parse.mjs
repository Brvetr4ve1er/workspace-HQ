/**
 * Inbox parser — turns pasted receipt / email / SMS text into a *candidate*
 * purchase. Pure (no wall clock when `receivedAt` is given, no network), and
 * deliberately humble: every field it fills is a guess shown next to its
 * evidence in the review tray, and nothing it returns is ever logged without
 * the user confirming it.
 *
 * Order of trust, highest first:
 *   1. Sender-specific rules (RedotPay card alerts, Algerian bank debit SMS,
 *      BaridiMob / CCP notices, Jumia, Yassir, Netflix, Spotify, Steam,
 *      Google Play) — they know where the amount and merchant sit.
 *   2. Generic cues: "total"/"montant" lines, "at X" / "chez X" / "from X".
 *   3. Fallbacks: the first supported amount, a known brand anywhere in the
 *      text, the sender's domain, the day the message was received.
 *
 * A message whose only amount is in an unsupported currency (EUR, GBP …)
 * returns null — Ember tracks DA and USD and will not guess a conversion.
 */
import { isValidDayKey, localDayISO } from './dates.mjs';
export const INBOX_FLAGS = ['duplicate', 'not_a_charge', 'promo', 'refund'];
/** The categories the quick-log card offers. */
export const INBOX_CATEGORIES = ['Food', 'Transport', 'Fun', 'Bills', 'Health', 'Other'];
/* ------------------------------ numbers ------------------------------- */
const SP = '[ \\u00A0\\u202F\\u2009]';
/** 1 200,00 · 1.200,00 · 1,200.00 · 2500 · 12.49 · 12,49 */
const NUM = `\\d{1,3}(?:(?:${SP}|[.,])\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
/** Parse a localised number. Separators followed by exactly three digits are
 *  thousands groups; the last , or . followed by one or two digits is the
 *  decimal point. Returns null for anything that is not a finite number. */
export function parseAmount(raw) {
    const s = raw.replace(/[    ]/g, '');
    if (!/^\d+(?:[.,]\d+)*$/.test(s))
        return null;
    const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
    const intPart = m ? m[1] : s;
    const frac = m ? m[2] : '';
    // Every remaining separator must sit before a three-digit group.
    if (!/^\d+(?:[.,]\d{3})*$/.test(intPart))
        return null;
    const n = Number(`${intPart.replace(/[.,]/g, '')}${frac ? `.${frac}` : ''}`);
    return Number.isFinite(n) ? n : null;
}
function curOf(tok) {
    const t = tok.toLowerCase().replace(/\s/g, '');
    if (t === 'da' || t === 'dzd' || t.startsWith('dinar') || t === 'د.ج')
        return 'DA';
    if (t === 'usd' || t === 'us$' || t === '$')
        return 'USD';
    return 'other';
}
const PRE_CUR = '(USD|US\\$|\\$|DZD|EUR|GBP|€|£)';
const POST_CUR = '(DA|DZD|dinars?|د\\.ج|USD|\\$|EUR|€|£|GBP)';
/** Every currency-tagged amount in the text, in reading order. */
export function findAmounts(text) {
    const hits = [];
    const pre = new RegExp(`${PRE_CUR}${SP}?(${NUM})(?![\\d])`, 'gi');
    const post = new RegExp(`(?<![\\d.,])(${NUM})${SP}?${POST_CUR}(?![A-Za-z])`, 'gi');
    for (const m of text.matchAll(pre)) {
        const amount = parseAmount(m[2]);
        if (amount !== null)
            hits.push({ amount, currency: curOf(m[1]), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
    for (const m of text.matchAll(post)) {
        const amount = parseAmount(m[1]);
        const index = m.index ?? 0;
        if (amount === null || hits.some((h) => index < h.end && h.index < index + m[0].length))
            continue;
        hits.push({ amount, currency: curOf(m[2]), index, end: index + m[0].length });
    }
    return hits.sort((a, b) => a.index - b.index);
}
/** Amounts that are balances, not the charge ("Solde: 45 000 DA"). */
function isBalance(text, h) {
    const before = text.slice(Math.max(0, h.index - 28), h.index);
    return /(solde|balance|disponible|available|nouveau)[^\n\d]{0,14}$/i.test(before);
}
const TOTAL_CUE = /(total|montant|amount|charged|paid|payé|débité|debited|prélev|de|of)\W{0,3}$/i;
/** Pick the charge: a supported amount on a cue ("Total", "débité de") wins,
 *  else the first supported amount that is not a balance. */
function pickAmount(text, hits) {
    const ok = hits.filter((h) => h.currency !== 'other' && !isBalance(text, h));
    if (ok.length === 0)
        return null;
    const totals = ok.filter((h) => /total/i.test(lineAround(text, h.index)));
    if (totals.length > 0)
        return totals[totals.length - 1];
    const cued = ok.find((h) => TOTAL_CUE.test(text.slice(Math.max(0, h.index - 16), h.index).trimEnd()));
    return cued ?? ok[0];
}
function lineAround(text, i) {
    const s = text.lastIndexOf('\n', i - 1) + 1;
    const e = text.indexOf('\n', i);
    return text.slice(s, e === -1 ? text.length : e);
}
/** Known merchants: canonical name, what identifies them, a category guess. */
const BRANDS = [
    { name: 'Steam', match: /steam(?:games|powered|\b)/i, category: 'Fun' },
    { name: 'Netflix', match: /netflix/i, category: 'Fun' },
    { name: 'Spotify', match: /spotify/i, category: 'Fun' },
    { name: 'Google Play', match: /google\s?play|play\.google/i, category: 'Fun' },
    { name: 'Jumia', match: /jumia/i, category: 'Other' },
    { name: 'Yassir', match: /yassir/i, category: 'Transport' },
    { name: 'Amazon', match: /amazon/i, category: 'Other' },
    { name: 'AliExpress', match: /aliexpress/i, category: 'Other' },
    { name: 'Temu', match: /\btemu\b/i, category: 'Other' },
    { name: 'Apple', match: /apple\.com|\bitunes\b|app store/i, category: 'Fun' },
    { name: 'Sonelgaz', match: /sonelgaz/i, category: 'Bills' },
    { name: 'Idoom', match: /idoom|alg[ée]rie\s?t[ée]l[ée]com/i, category: 'Bills' },
    { name: 'Djezzy', match: /djezzy/i, category: 'Bills' },
    { name: 'Mobilis', match: /mobilis/i, category: 'Bills' },
    { name: 'Ooredoo', match: /ooredoo/i, category: 'Bills' },
];
const CATEGORY_HINTS = [
    [/pharmac|clinique|m[ée]decin|doctor|hospital/i, 'Health'],
    [/restaurant|caf[ée]|pizza|food|boulangerie|bakery|glovo|burger|snack|sup[ée]rette|[ée]picerie|grocer/i, 'Food'],
    [/taxi|uber|trip|course|transport|bus|train|sntf|carburant|fuel|naftal/i, 'Transport'],
    [/facture|bill|internet|[ée]lectricit[ée]|recharge|abonnement|subscription/i, 'Bills'],
    [/game|jeu|cinema|cin[ée]ma|movie/i, 'Fun'],
];
function brandIn(s) {
    return BRANDS.find((b) => b.match.test(s)) ?? null;
}
/** "STEAMGAMES.COM" → "Steam"; "CAFE EL BAHDJA" → "Cafe El Bahdja". */
export function canonicalMerchant(raw) {
    const s = raw.replace(/\s+/g, ' ').trim();
    const brand = brandIn(s);
    if (brand)
        return brand.name;
    const bare = s.replace(/^www\./i, '').replace(/\.(com|dz|net|org|io|co)\b.*$/i, '').replace(/[*_]+/g, ' ').trim();
    if (bare === bare.toUpperCase() || bare === bare.toLowerCase()) {
        return bare.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
    }
    return bare;
}
const STOP = '(?=\\s+(?:on|for|le|du|pour|the|via|using|with|par|ref|réf|at|à|le)\\b|\\s+\\d|[\\n,;:!?()]|\\.(?:\\s|$)|$)';
/** "at STEAMGAMES.COM", "chez Café El Bahdja", "receipt from Yassir". */
function merchantFromCue(text) {
    const re = new RegExp(`\\b(?:at|chez|au profit de|auprès de|aupres de|receipt from|purchase from|order from)\\s+([^\\n,;:!?()]{2,40}?)${STOP}`, 'giu');
    for (const m of text.matchAll(re)) {
        const cand = m[1].trim().replace(/[.\s]+$/, '');
        if (cand.length < 2 || /^\d/.test(cand) || curOf(cand) !== 'other' || /^(the|your|a|an|votre|la)$/i.test(cand))
            continue;
        return canonicalMerchant(cand);
    }
    return null;
}
/** Sender's domain as a merchant ("noreply@steampowered.com" → "Steam"). */
function merchantFromSender(from) {
    if (!from)
        return null;
    const brand = brandIn(from);
    if (brand)
        return brand.name;
    const at = /@([a-z0-9.-]+)/i.exec(from);
    if (at) {
        const labels = at[1].split('.').filter((l) => !/^(mail|email|e|info|no-?reply|account|accounts|notifications?|receipts?|orders?)$/i.test(l));
        const main = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
        if (main && !/^(gmail|yahoo|hotmail|outlook)$/i.test(main))
            return canonicalMerchant(main);
        return null;
    }
    return from.length <= 30 ? from.trim() : null;
}
/* -------------------------------- dates ------------------------------- */
const MONTHS = {
    jan: 1, janv: 1, january: 1, janvier: 1,
    feb: 2, fev: 2, fév: 2, févr: 2, fevr: 2, february: 2, février: 2, fevrier: 2,
    mar: 3, march: 3, mars: 3,
    apr: 4, avr: 4, april: 4, avril: 4,
    may: 5, mai: 5,
    jun: 6, june: 6, juin: 6,
    jul: 7, july: 7, juil: 7, juillet: 7,
    aug: 8, august: 8, aou: 8, aoû: 8, août: 8, aout: 8,
    sep: 9, sept: 9, september: 9, septembre: 9,
    oct: 10, october: 10, octobre: 10,
    nov: 11, november: 11, novembre: 11,
    dec: 12, déc: 12, december: 12, décembre: 12, decembre: 12,
};
const MONTH_RE = '([A-Za-zéûÉ]{3,9})\\.?';
const pad = (n) => String(n).padStart(2, '0');
function dayKey(y, m, d) {
    const k = `${y}-${pad(m)}-${pad(d)}`;
    return isValidDayKey(k) ? k : null;
}
/** First date written in the text; a yearless "20 October" takes `year`. */
export function findDate(text, year) {
    const found = [];
    const push = (i, key) => {
        if (key)
            found.push({ i: i ?? 0, key });
    };
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
        push(m.index, dayKey(+m[1], +m[2], +m[3]));
    for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
        const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        push(m.index, dayKey(y, +m[2], +m[1]));
    }
    for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|er)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, 'gi'))) {
        const mo = MONTHS[m[2].toLowerCase()];
        if (mo)
            push(m.index, dayKey(m[3] ? +m[3] : year, mo, +m[1]));
    }
    for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) {
        const mo = MONTHS[m[1].toLowerCase()];
        if (mo)
            push(m.index, dayKey(+m[3], mo, +m[2]));
    }
    if (found.length === 0)
        return null;
    return found.sort((a, b) => a.i - b.i)[0].key;
}
function dayOfReceived(receivedAt) {
    if (!receivedAt)
        return null;
    if (isValidDayKey(receivedAt))
        return receivedAt;
    const t = Date.parse(receivedAt);
    return Number.isFinite(t) ? localDayISO(new Date(t)) : null;
}
/* -------------------------------- flags ------------------------------- */
const NOT_A_CHARGE = /\brenews?\s+on\b|\bwill\s+renew\b|\bupcoming\b|\breminder\b|\brappel\b|\bwill\s+be\s+(?:charged|billed)\b|\bsera\s+(?:prélevé|débité|preleve|debite)|\btrial\s+ends\b|\bdue\s+on\b|\béchéance\b/i;
const PROMO = /\boffers?\b|\boffre\b|%\s*off\b|-\s?\d{1,2}\s?%|\bfree\b|\bgratuit|\bpromo(?:tion)?\s?code\b|\bcode\s+promo\b|\bdiscount\b|\bréduction\b|(?:\$|USD\s?)0(?:[.,]00)?(?![\d.,]*[1-9])/i;
const REFUND = /\brefund(?:ed)?\b|\bremboursement\b|\brembours[ée]e?\b/i;
function hitAt(text, re, numGroup, curGroup, fixed) {
    const m = re.exec(text);
    if (!m)
        return null;
    const amount = parseAmount(m[numGroup]);
    if (amount === null)
        return null;
    const currency = fixed ?? curOf(m[curGroup ?? 0]);
    const index = (m.index ?? 0) + m[0].indexOf(m[numGroup]);
    return { amount, currency, index, end: index + m[numGroup].length };
}
const redotpay = (text, from) => {
    if (!/redot\s?pay/i.test(`${from} ${text}`))
        return null;
    const re = new RegExp(`card\\s+transaction:?\\s*(USD|US\\$|\\$)${SP}?(${NUM})\\s+at\\s+([^\\n,;]+?)(?=\\s+on\\b|[\\n,;]|\\.(?:\\s|$)|$)`, 'i');
    const m = re.exec(text);
    if (!m)
        return { sender: 'RedotPay' };
    const amount = hitAt(text, re, 2, 1);
    const brand = brandIn(m[3]);
    return { sender: 'RedotPay', amount: amount ?? undefined, merchant: canonicalMerchant(m[3]), category: brand?.category };
};
/** "Votre compte N° … a été débité de 2 500,00 DA le … chez …" */
const bankDebit = (text) => {
    const re = new RegExp(`(?:compte|carte)[^\\n]*?d[ée]bit[ée]e?\\s+(?:d'un\\s+montant\\s+)?de\\s+(${NUM})${SP}?(DA|DZD)`, 'i');
    const amount = hitAt(text, re, 1, 2);
    if (!amount)
        return null;
    const bank = /\b(BNA|CPA|BEA|BADR|BDL|CNEP|AGB|BNP|Société Générale|Societe Generale|Al Salam|Gulf Bank|Natixis|Trust Bank)\b/i.exec(text);
    return { sender: bank ? bank[1].toUpperCase() : 'Bank SMS', amount };
};
/** BaridiMob / Algérie Poste CCP notices. */
const baridi = (text, from) => {
    if (!/baridi\s?mob|alg[ée]rie\s?poste|\bccp\b|edahabia/i.test(`${from} ${text}`))
        return null;
    const re = new RegExp(`(?:paiement|payment|transfert|transfer|virement|retrait|withdrawal|achat|facture)[^\\n\\d]{0,40}?(${NUM})${SP}?(DA|DZD)`, 'i');
    const amount = hitAt(text, re, 1, 2) ?? undefined;
    let merchant;
    const to = /(?:vers|au profit de|à|chez|to)\s+(?:la\s+|le\s+|l')?(?:facture\s+)?([A-Za-zÀ-ÿ][\w À-ÿ'&.-]{1,30}?)(?=\s+(?:le|on|du|réf|ref|par)\b|[\n,;.]|$)/i.exec(text);
    if (/retrait|withdrawal/i.test(text))
        merchant = 'Cash withdrawal';
    else if (to)
        merchant = canonicalMerchant(to[1]);
    return { sender: 'BaridiMob', amount, merchant, category: merchant === 'Cash withdrawal' ? 'Other' : undefined };
};
/** Brand receipts whose total sits on a "Total" / "Amount" line. */
function brandRule(name, test, category) {
    return (text, from) => {
        if (!test.test(`${from} ${text}`))
            return null;
        const hits = findAmounts(text);
        const chosen = pickAmount(text, hits);
        return { sender: name, merchant: name, category, amount: chosen ?? undefined };
    };
}
const RULES = [
    redotpay,
    bankDebit,
    baridi,
    brandRule('Jumia', /jumia/i, 'Other'),
    brandRule('Yassir', /yassir/i, 'Transport'),
    brandRule('Netflix', /netflix/i, 'Fun'),
    brandRule('Spotify', /spotify/i, 'Fun'),
    brandRule('Steam', /steam(?:powered|games|\b)/i, 'Fun'),
    brandRule('Google Play', /google\s?play|play\.google/i, 'Fun'),
];
/* -------------------------------- parse ------------------------------- */
/** A "From: …" header line in a pasted email, if any. */
function headerFrom(text) {
    const m = /^(?:from|de|expéditeur)\s*:\s*(.+)$/im.exec(text);
    if (!m)
        return null;
    const addr = /<([^>]+)>/.exec(m[1]);
    return (addr ? addr[1] : m[1]).trim();
}
function guessCategory(merchant, text) {
    const brand = brandIn(merchant) ?? brandIn(text);
    if (brand)
        return brand.category;
    for (const [re, cat] of CATEGORY_HINTS)
        if (re.test(merchant) || re.test(text))
            return cat;
    return 'Other';
}
const MAX_SOURCE_CHARS = 4000;
/**
 * Parse one message. Returns null when no DA/USD amount can be found (or the
 * only amount is in another currency). The returned candidate is a claim,
 * never a transaction: it carries its source text as evidence.
 */
export function parseMessage(text, opts = {}) {
    const body = text.trim();
    if (body === '')
        return null;
    const from = (opts.from ?? '').trim() || headerFrom(body) || '';
    let rule = null;
    for (const r of RULES) {
        rule = r(body, from);
        if (rule)
            break;
    }
    const hits = findAmounts(body);
    const money = rule?.amount ?? pickAmount(body, hits);
    if (!money || money.currency === 'other')
        return null;
    let merchantStrength = 1;
    let merchant = rule?.merchant ?? merchantFromCue(body);
    if (!merchant) {
        const brand = brandIn(body);
        merchant = brand ? brand.name : null;
        merchantStrength = 0.8;
    }
    if (!merchant) {
        merchant = merchantFromSender(from);
        merchantStrength = 0.5;
    }
    if (!merchant && rule) {
        merchant = rule.sender;
        merchantStrength = 0.4;
    }
    if (!merchant) {
        merchant = 'Unknown merchant';
        merchantStrength = 0;
    }
    const recvDay = dayOfReceived(opts.receivedAt);
    const year = recvDay ? Number(recvDay.slice(0, 4)) : new Date().getFullYear();
    const written = findDate(body, year);
    const date = written ?? recvDay ?? localDayISO(new Date());
    const flags = [];
    if (NOT_A_CHARGE.test(body))
        flags.push('not_a_charge');
    if (PROMO.test(body) || money.amount === 0)
        flags.push('promo');
    const refund = REFUND.test(body);
    if (refund)
        flags.push('refund');
    let confidence = 0.4 + 0.3 * merchantStrength + (written ? 0.15 : 0) + (rule?.amount ? 0.15 : 0);
    if (flags.includes('not_a_charge'))
        confidence *= 0.5;
    if (flags.includes('promo'))
        confidence *= 0.3;
    confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
    return {
        merchant,
        amount: refund ? -Math.abs(money.amount) : money.amount,
        currency: money.currency,
        date,
        sources: [{ from: from || rule?.sender || 'pasted', text: body.slice(0, MAX_SOURCE_CHARS), receivedAt: isIsoReceived(opts.receivedAt) }],
        confidence,
        flags: INBOX_FLAGS.filter((f) => flags.includes(f)),
        suggestedCategory: rule?.category ?? guessCategory(merchant, body),
    };
}
function isIsoReceived(v) {
    return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : '';
}
/**
 * Split a paste holding several messages. "---" lines always separate;
 * blank lines separate only when both sides carry an amount, so an email's
 * own paragraphs (header / body / footer) stay one message.
 */
export function splitMessages(text) {
    const out = [];
    for (const part of text.split(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/)) {
        let group = [];
        let groupHasAmount = false;
        for (const chunk of part.split(/\n[ \t]*\n+/)) {
            const c = chunk.trim();
            if (c === '')
                continue;
            const has = findAmounts(c).length > 0;
            if (has && groupHasAmount) {
                out.push(group.join('\n\n'));
                group = [];
                groupHasAmount = false;
            }
            group.push(c);
            groupHasAmount ||= has;
        }
        if (group.length > 0)
            out.push(group.join('\n\n'));
    }
    return out;
}
/** Parse every message in a paste; unparseable ones are counted, not guessed. */
export function parseMany(text, opts = {}) {
    const msgs = splitMessages(text);
    const candidates = [];
    for (const m of msgs) {
        const c = parseMessage(m, opts);
        if (c)
            candidates.push(c);
    }
    return { candidates, messages: msgs.length };
}
