/**
 * Inbox slice — the review tray. Parsed candidates land here as `pending`
 * and stay claims until the user confirms (a ledger row is created by the
 * root LOG_TX, and its id recorded here) or rejects them. Nothing in this
 * slice ever writes to the ledger on its own.
 *
 * Merge rules (local-first, symmetric):
 * - Candidates are entities keyed by id; the newer `updatedAt` wins.
 * - Status never regresses: a resolved copy (confirmed/rejected) beats a
 *   pending one whatever the timestamps, and a cleared copy beats both, so a
 *   stale tab can never put a handled slip back in the tray.
 * - "Clear handled" is a tombstone (`cleared`, sources dropped), never a
 *   removal — a peer still holding the row can't resurrect it.
 * - `alreadyLogged` is derived from the ledger at render time, never stored.
 */
import { isIsoDatetime, isValidDayKey } from './dates.mjs';
import { isSamePurchase, mergeCandidate } from './dedupe.mjs';
import { INBOX_FLAGS } from './parse.mjs';
export function defaultInbox() {
    return { candidates: [] };
}
/* ------------------------------ sanitize ------------------------------ */
function isRecord(v) {
    return typeof v === 'object' && v !== null;
}
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const STATUSES = ['pending', 'confirmed', 'rejected'];
function sanitizeSource(v) {
    if (!isRecord(v) || !isStr(v.from) || !isStr(v.text))
        return null;
    return { from: v.from, text: v.text, receivedAt: isIsoDatetime(v.receivedAt) ? v.receivedAt : '' };
}
function sanitizeCandidate(v) {
    if (!isRecord(v) || !isStr(v.id) || v.id === '' || !isStr(v.merchant) || !isNum(v.amount))
        return null;
    if (v.currency !== 'DA' && v.currency !== 'USD')
        return null;
    if (!isValidDayKey(v.date) || !isNum(v.confidence) || !isIsoDatetime(v.updatedAt))
        return null;
    if (!STATUSES.includes(v.status))
        return null;
    const cleared = v.cleared === true;
    const status = v.status;
    // Only a handled slip can be cleared; a pending one must keep its evidence.
    if (cleared && status === 'pending')
        return null;
    const sources = [];
    if (!cleared && Array.isArray(v.sources)) {
        for (const s of v.sources) {
            const ok = sanitizeSource(s);
            if (ok && !sources.some((x) => x.text === ok.text))
                sources.push(ok);
        }
    }
    if (!cleared && sources.length === 0)
        return null;
    const flags = Array.isArray(v.flags) ? INBOX_FLAGS.filter((f) => v.flags.includes(f)) : [];
    return {
        id: v.id,
        merchant: v.merchant,
        amount: v.amount,
        currency: v.currency,
        date: v.date,
        sources,
        confidence: Math.min(1, Math.max(0, v.confidence)),
        flags,
        suggestedCategory: isStr(v.suggestedCategory) ? v.suggestedCategory : 'Other',
        status,
        txId: status === 'confirmed' && isStr(v.txId) ? v.txId : null,
        cleared,
        updatedAt: v.updatedAt,
    };
}
const rank = (c) => (c.cleared ? 2 : c.status === 'pending' ? 0 : 1);
/** Status rank first (never regress), then newer instant, then greater JSON. */
function winner(a, b) {
    if (rank(a) !== rank(b))
        return rank(a) > rank(b) ? a : b;
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
        m.set(x.id, prev ? winner(prev, x) : x);
    }
    return [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function sanitizeInbox(v) {
    const out = defaultInbox();
    if (!isRecord(v) || !Array.isArray(v.candidates))
        return out;
    const rows = [];
    for (const x of v.candidates) {
        const c = sanitizeCandidate(x);
        if (c)
            rows.push(c);
    }
    out.candidates = mergeEntities(rows);
    return out;
}
/** Symmetric cross-tab merge; output in defaultInbox() key order. */
export function mergeInbox(a, b) {
    return { candidates: mergeEntities([...a.candidates, ...b.candidates]) };
}
/**
 * Fold incoming candidates into the tray: each one that is the same purchase
 * as a pending slip (see isSamePurchase) joins that slip as another source;
 * the rest become new pending slips. Exposed so the paste card can report
 * exactly what `inbox/add` will do.
 */
export function planAdd(s, incoming, nowISO) {
    if (!isIsoDatetime(nowISO))
        return { state: s, added: 0, merged: 0 };
    const rows = [...s.candidates];
    const ids = new Set(rows.map((r) => r.id));
    let added = 0;
    let merged = 0;
    for (const raw of incoming) {
        const c = sanitizeCandidate({ ...raw, status: 'pending', txId: null, cleared: false, updatedAt: nowISO });
        if (!c || ids.has(c.id))
            continue;
        const i = rows.findIndex((r) => r.status === 'pending' && !r.cleared && isSamePurchase(r, c));
        if (i === -1) {
            rows.push(c);
            ids.add(c.id);
            added++;
        }
        else {
            rows[i] = { ...mergeCandidate(rows[i], c), updatedAt: nowISO };
            merged++;
        }
    }
    if (added === 0 && merged === 0)
        return { state: s, added, merged };
    return { state: { candidates: mergeEntities(rows) }, added, merged };
}
export function inboxReducer(s, a) {
    switch (a.type) {
        case 'inbox/add':
            return planAdd(s, a.candidates, a.nowISO).state;
        case 'inbox/resolve': {
            const c = s.candidates.find((x) => x.id === a.id);
            if (!c || c.status !== 'pending' || !isIsoDatetime(a.nowISO))
                return s;
            const next = {
                ...c,
                status: a.status,
                txId: a.status === 'confirmed' ? a.txId : null,
                updatedAt: a.nowISO,
            };
            return { candidates: mergeEntities([...s.candidates.filter((x) => x.id !== a.id), next]) };
        }
        case 'inbox/clear-resolved': {
            if (!isIsoDatetime(a.nowISO) || !s.candidates.some((c) => c.status !== 'pending' && !c.cleared))
                return s;
            return {
                candidates: s.candidates.map((c) => c.status !== 'pending' && !c.cleared ? { ...c, sources: [], cleared: true, updatedAt: a.nowISO } : c),
            };
        }
    }
}
