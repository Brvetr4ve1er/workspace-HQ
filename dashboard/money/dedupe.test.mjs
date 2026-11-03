// Ported verbatim from Ember src/engine/inbox/dedupe.test.ts (types stripped; vitest -> vitest-shim.mjs on node:test).
import { describe, it, expect } from './vitest-shim.mjs';
import { alreadyLogged, dedupeCandidates, isSamePurchase, normMerchant, similarMerchant } from './dedupe.mjs';
import { FIXTURES } from './fixtures.mjs';
import { parseMessage } from './parse.mjs';
const cand = (over = {}) => ({
    merchant: 'Steam',
    amount: 12.49,
    currency: 'USD',
    date: '2026-10-08',
    sources: [{ from: 'a', text: 'one', receivedAt: '' }],
    confidence: 0.8,
    flags: [],
    suggestedCategory: 'Fun',
    ...over,
});
describe('merchant similarity', () => {
    it('normalises case, punctuation, www and .com', () => {
        expect(normMerchant('www.SteamGames.com')).toBe('steamgames');
        expect(normMerchant('Café El-Bahdja')).toBe('cafeelbahdja');
        expect(similarMerchant('STEAMGAMES.COM', 'Steam')).toBe(true);
        expect(similarMerchant('Jumia', 'Yassir')).toBe(false);
    });
});
describe('isSamePurchase', () => {
    it('needs same amount + currency, ±1 day and a similar merchant', () => {
        expect(isSamePurchase(cand(), cand({ date: '2026-10-09' }))).toBe(true);
        expect(isSamePurchase(cand(), cand({ date: '2026-10-10' }))).toBe(false);
        expect(isSamePurchase(cand(), cand({ amount: 12.5 }))).toBe(false);
        expect(isSamePurchase(cand(), cand({ currency: 'DA' }))).toBe(false);
        expect(isSamePurchase(cand(), cand({ merchant: 'Netflix' }))).toBe(false);
    });
    it('never merges a renewal notice with a real charge', () => {
        expect(isSamePurchase(cand(), cand({ flags: ['not_a_charge'] }))).toBe(false);
    });
});
describe('dedupeCandidates', () => {
    it('folds the Steam receipt and the RedotPay alert into one candidate with two sources', () => {
        const [redot, steam] = FIXTURES.slice(0, 2).map((f) => parseMessage(f.text, { from: f.from, receivedAt: f.receivedAt }));
        const out = dedupeCandidates([redot, steam]);
        expect(out).toHaveLength(1);
        expect(out[0].sources).toHaveLength(2);
        expect(out[0].flags).toContain('duplicate');
        expect(out[0].merchant).toBe('Steam');
    });
    it('the same text twice is one source and not a duplicate', () => {
        const out = dedupeCandidates([cand(), cand()]);
        expect(out).toHaveLength(1);
        expect(out[0].sources).toHaveLength(1);
        expect(out[0].flags).toEqual([]);
    });
    it('keeps different purchases apart', () => {
        expect(dedupeCandidates([cand(), cand({ merchant: 'Jumia', amount: 5600, currency: 'DA' })])).toHaveLength(2);
    });
});
describe('alreadyLogged', () => {
    const tx = (over) => ({ id: 't', amountDA: 0, category: 'Fun', date: '2026-10-08', ...over });
    it('matches the DA amount within a day', () => {
        const c = cand({ amount: 650, currency: 'DA' });
        expect(alreadyLogged(c, [tx({ amountDA: 650, date: '2026-10-09' })], null)).toBe(true);
        expect(alreadyLogged(c, [tx({ amountDA: 650, date: '2026-10-11' })], null)).toBe(false);
        expect(alreadyLogged(c, [tx({ amountDA: 651 })], null)).toBe(false);
    });
    it('matches the original USD amount, or its conversion at the rate', () => {
        expect(alreadyLogged(cand(), [tx({ amountDA: 3000, original: { amount: 12.49, currency: 'USD' } })], null)).toBe(true);
        expect(alreadyLogged(cand(), [tx({ amountDA: 3123 })], 250)).toBe(true);
        expect(alreadyLogged(cand(), [tx({ amountDA: 3123 })], null)).toBe(false);
    });
    it('ignores resisted impulses (no money spent)', () => {
        expect(alreadyLogged(cand({ amount: 650, currency: 'DA' }), [tx({ amountDA: 650, resistedImpulse: true })], null)).toBe(false);
    });
});
