// Ported verbatim from Ember src/state/slices/inbox.test.ts (types stripped; vitest -> vitest-shim.mjs on node:test).
import { describe, it, expect } from './vitest-shim.mjs';
import { defaultInbox, inboxReducer, mergeInbox, planAdd, sanitizeInbox } from './inbox.mjs';
const T1 = '2026-10-01T08:00:00.000Z';
const T2 = '2026-10-02T08:00:00.000Z';
const T3 = '2026-10-03T08:00:00.000Z';
const cand = (over = {}) => ({
    id: 'c1',
    merchant: 'Steam',
    amount: 12.49,
    currency: 'USD',
    date: '2026-10-08',
    sources: [{ from: 'no-reply@redotpay.com', text: 'Card transaction: USD 12.49 at STEAMGAMES.COM', receivedAt: T1 }],
    confidence: 0.9,
    flags: [],
    suggestedCategory: 'Fun',
    status: 'pending',
    txId: null,
    cleared: false,
    updatedAt: T1,
    ...over,
});
const state = (...cs) => ({ candidates: cs });
describe('sanitizeInbox', () => {
    it('returns the default for junk', () => {
        expect(sanitizeInbox(null)).toEqual(defaultInbox());
        expect(sanitizeInbox({ candidates: 'x' })).toEqual(defaultInbox());
    });
    it('keeps valid rows field by field and drops malformed ones', () => {
        const out = sanitizeInbox({
            candidates: [
                cand(),
                cand({ id: 'bad-amt', amount: NaN }),
                cand({ id: 'bad-cur', currency: 'EUR' }),
                cand({ id: 'bad-date', date: '2026-02-30' }),
                cand({ id: 'no-src', sources: [] }),
                cand({ id: 'bad-status', status: 'maybe' }),
                { ...cand({ id: 'extra' }), evil: 1, flags: ['promo', 'nope', 'promo'], confidence: 7 },
            ],
        });
        expect(out.candidates.map((c) => c.id)).toEqual(['c1', 'extra']);
        const extra = out.candidates[1];
        expect('evil' in extra).toBe(false);
        expect(extra.flags).toEqual(['promo']);
        expect(extra.confidence).toBe(1);
    });
    it('never keeps a txId on a non-confirmed row and rejects a cleared pending row', () => {
        const out = sanitizeInbox({ candidates: [cand({ txId: 'tx' }), cand({ id: 'c2', status: 'pending', cleared: true, sources: [] })] });
        expect(out.candidates).toHaveLength(1);
        expect(out.candidates[0].txId).toBeNull();
    });
    it('is a merge fixpoint (duplicates collapse)', () => {
        const s = sanitizeInbox({ candidates: [cand(), cand({ updatedAt: T2, merchant: 'Steam 2' })] });
        expect(s.candidates).toHaveLength(1);
        expect(JSON.stringify(mergeInbox(s, s))).toBe(JSON.stringify(s));
        expect(JSON.stringify(sanitizeInbox(JSON.parse(JSON.stringify(s))))).toBe(JSON.stringify(s));
    });
});
describe('mergeInbox', () => {
    it('newer updatedAt wins, compared as instants', () => {
        const a = state(cand({ merchant: 'A', updatedAt: '2026-10-02T08:00:00Z' }));
        const b = state(cand({ merchant: 'B', updatedAt: '2026-10-01T08:00:00.500Z' }));
        expect(mergeInbox(a, b).candidates[0].merchant).toBe('A');
        expect(mergeInbox(b, a).candidates[0].merchant).toBe('A');
    });
    it('status never regresses from confirmed/rejected to pending', () => {
        const resolved = state(cand({ status: 'confirmed', txId: 'tx1', updatedAt: T1 }));
        const pendingNewer = state(cand({ updatedAt: T3 }));
        expect(mergeInbox(resolved, pendingNewer).candidates[0].status).toBe('confirmed');
        expect(mergeInbox(pendingNewer, resolved).candidates[0].status).toBe('confirmed');
    });
    it('a cleared tombstone is never resurrected', () => {
        const cleared = state(cand({ status: 'rejected', cleared: true, sources: [], updatedAt: T1 }));
        const stale = state(cand({ status: 'rejected', updatedAt: T3 }));
        expect(mergeInbox(stale, cleared).candidates[0].cleared).toBe(true);
    });
    it('is symmetric and unions ids', () => {
        const a = state(cand(), cand({ id: 'c3', merchant: 'Jumia', amount: 5600, currency: 'DA' }));
        const b = state(cand({ id: 'c2', merchant: 'Yassir', amount: 650, currency: 'DA' }));
        expect(JSON.stringify(mergeInbox(a, b))).toBe(JSON.stringify(mergeInbox(b, a)));
        expect(mergeInbox(a, b).candidates.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });
});
describe('inboxReducer', () => {
    it('inbox/add appends pending slips and dedupes against pending ones', () => {
        let s = inboxReducer(defaultInbox(), { type: 'inbox/add', candidates: [cand()], nowISO: T1 });
        expect(s.candidates).toHaveLength(1);
        s = inboxReducer(s, {
            type: 'inbox/add',
            candidates: [cand({ id: 'c2', merchant: 'Steam', sources: [{ from: 'noreply@steampowered.com', text: 'Steam receipt Total $12.49', receivedAt: T2 }] })],
            nowISO: T2,
        });
        expect(s.candidates).toHaveLength(1);
        expect(s.candidates[0].sources).toHaveLength(2);
        expect(s.candidates[0].flags).toContain('duplicate');
        expect(s.candidates[0].updatedAt).toBe(T2);
    });
    it('inbox/add does not merge into a resolved slip, and forces pending status', () => {
        const s = state(cand({ status: 'rejected' }));
        const out = inboxReducer(s, { type: 'inbox/add', candidates: [cand({ id: 'c2', status: 'confirmed' })], nowISO: T2 });
        expect(out.candidates).toHaveLength(2);
        expect(out.candidates[1].status).toBe('pending');
    });
    it('planAdd reports added and merged counts; bad stamps are no-ops', () => {
        const p = planAdd(defaultInbox(), [cand(), cand({ id: 'c2', sources: [{ from: 'x', text: 'other', receivedAt: '' }] })], T1);
        expect([p.added, p.merged]).toEqual([1, 1]);
        const s = defaultInbox();
        expect(inboxReducer(s, { type: 'inbox/add', candidates: [cand()], nowISO: 'nope' })).toBe(s);
    });
    it('inbox/resolve confirms with a txId or rejects, only from pending', () => {
        const s = state(cand());
        const ok = inboxReducer(s, { type: 'inbox/resolve', id: 'c1', status: 'confirmed', txId: 'tx1', nowISO: T2 });
        expect(ok.candidates[0]).toMatchObject({ status: 'confirmed', txId: 'tx1', updatedAt: T2 });
        expect(inboxReducer(ok, { type: 'inbox/resolve', id: 'c1', status: 'rejected', txId: null, nowISO: T3 })).toBe(ok);
        const rej = inboxReducer(s, { type: 'inbox/resolve', id: 'c1', status: 'rejected', txId: 'ignored', nowISO: T2 });
        expect(rej.candidates[0]).toMatchObject({ status: 'rejected', txId: null });
    });
    it('inbox/clear-resolved tombstones handled slips and drops their text', () => {
        const s = state(cand({ status: 'confirmed', txId: 'tx1' }), cand({ id: 'c2' }));
        const out = inboxReducer(s, { type: 'inbox/clear-resolved', nowISO: T2 });
        expect(out.candidates[0]).toMatchObject({ cleared: true, sources: [] });
        expect(out.candidates[1].cleared).toBe(false);
        expect(sanitizeInbox(JSON.parse(JSON.stringify(out)))).toEqual(out);
        expect(inboxReducer(out, { type: 'inbox/clear-resolved', nowISO: T3 })).toBe(out);
    });
});
