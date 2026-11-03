// Ported verbatim from Ember src/engine/inbox/parse.test.ts (types stripped; vitest -> vitest-shim.mjs on node:test).
import { describe, it, expect } from './vitest-shim.mjs';
import { FIXTURES } from './fixtures.mjs';
import { canonicalMerchant, findAmounts, findDate, parseAmount, parseMany, parseMessage, splitMessages } from './parse.mjs';
describe('parseMessage — sender fixtures', () => {
    for (const f of FIXTURES) {
        it(f.name, () => {
            const c = parseMessage(f.text, { from: f.from, receivedAt: f.receivedAt });
            if (f.expect === null) {
                expect(c).toBeNull();
                return;
            }
            expect(c).not.toBeNull();
            expect(c.merchant).toBe(f.expect.merchant);
            expect(c.amount).toBeCloseTo(f.expect.amount, 2);
            expect(c.currency).toBe(f.expect.currency);
            expect(c.date).toBe(f.expect.date);
            expect(c.flags).toEqual(f.expect.flags);
            if (f.expect.category)
                expect(c.suggestedCategory).toBe(f.expect.category);
            expect(c.sources).toHaveLength(1);
            expect(c.sources[0].text).toBe(f.text.trim());
            expect(c.confidence).toBeGreaterThan(0);
            expect(c.confidence).toBeLessThanOrEqual(1);
        });
    }
});
describe('number formats', () => {
    it.each([
        ['2500', 2500],
        ['2 500', 2500],
        ['1 200,00', 1200],
        ['1 200,00', 1200],
        ['1 200,50', 1200.5],
        ['1 200', 1200],
        ['1.200,00', 1200],
        ['1,200.00', 1200],
        ['12.49', 12.49],
        ['12,49', 12.49],
        ['1.234.567,89', 1234567.89],
    ])('%s → %d', (raw, n) => {
        expect(parseAmount(raw)).toBeCloseTo(n, 2);
    });
    it('rejects malformed groups', () => {
        expect(parseAmount('1,2,3')).toBeNull();
        expect(parseAmount('abc')).toBeNull();
    });
    it('reads currency before and after the number', () => {
        expect(findAmounts('USD 12.49').map((h) => [h.amount, h.currency])).toEqual([[12.49, 'USD']]);
        expect(findAmounts('$12.49').map((h) => [h.amount, h.currency])).toEqual([[12.49, 'USD']]);
        expect(findAmounts('1 200,00 DA').map((h) => [h.amount, h.currency])).toEqual([[1200, 'DA']]);
        expect(findAmounts('3500 DZD').map((h) => [h.amount, h.currency])).toEqual([[3500, 'DA']]);
        expect(findAmounts('DZD 3,500.00').map((h) => [h.amount, h.currency])).toEqual([[3500, 'DA']]);
        expect(findAmounts('950 dinars').map((h) => [h.amount, h.currency])).toEqual([[950, 'DA']]);
        expect(findAmounts('24,90 €')[0].currency).toBe('other');
        expect(findAmounts('€24.90')[0].currency).toBe('other');
    });
    it('does not read DA out of a word like DATE', () => {
        expect(findAmounts('Ref 12 DATE 2026')).toEqual([]);
    });
});
describe('dates', () => {
    it('reads ISO, dd/mm/yyyy, "8 Oct 2026", "Oct 8, 2026" and French months', () => {
        expect(findDate('on 2026-10-08', 2026)).toBe('2026-10-08');
        expect(findDate('le 08/10/2026', 2026)).toBe('2026-10-08');
        expect(findDate('le 8.10.26', 2026)).toBe('2026-10-08');
        expect(findDate('issued 8 Oct 2026', 2026)).toBe('2026-10-08');
        expect(findDate('Oct 8, 2026', 2026)).toBe('2026-10-08');
        expect(findDate('le 8 octobre 2026', 2026)).toBe('2026-10-08');
        expect(findDate('renews on 20 October', 2026)).toBe('2026-10-20');
    });
    it('rejects impossible dates and falls back to the received day', () => {
        expect(findDate('31/02/2026', 2026)).toBeNull();
        const c = parseMessage('Paid 300 DA at Café Nour', { receivedAt: '2026-10-14T10:00:00.000Z' });
        expect(c?.date).toBe('2026-10-14');
    });
});
describe('merchant, flags, confidence', () => {
    it('canonicalises merchants', () => {
        expect(canonicalMerchant('STEAMGAMES.COM')).toBe('Steam');
        expect(canonicalMerchant('www.example.com')).toBe('Example');
        expect(canonicalMerchant('CAFE EL BAHDJA')).toBe('Cafe El Bahdja');
    });
    it('reads "at MERCHANT" and the sender domain as fallbacks', () => {
        expect(parseMessage('You paid USD 3.00 at Bookshop Nour.', {})?.merchant).toBe('Bookshop Nour');
        expect(parseMessage('Amount charged: $9.99', { from: 'billing@coolapp.io' })?.merchant).toBe('Coolapp');
    });
    it('reads a From: header line from a pasted email', () => {
        const c = parseMessage('From: Billing <billing@coolapp.io>\nSubject: Receipt\n\nAmount charged: $9.99', {});
        expect(c?.sources[0].from).toBe('billing@coolapp.io');
        expect(c?.merchant).toBe('Coolapp');
    });
    it('flags promos, reminders and refunds', () => {
        expect(parseMessage('20% off everything — use promo code EMBER. Plans from $4.99', {})?.flags).toContain('promo');
        expect(parseMessage('Reminder: your plan will be charged USD 5.00 tomorrow', {})?.flags).toEqual(['not_a_charge']);
        expect(parseMessage('Remboursement de 1 500,00 DA chez Jumia', {})?.amount).toBe(-1500);
    });
    it('scores matched fields higher than guesses', () => {
        const strong = parseMessage(FIXTURES[0].text, { from: FIXTURES[0].from, receivedAt: FIXTURES[0].receivedAt });
        const weak = parseMessage('500 DA', { receivedAt: '2026-10-14T10:00:00.000Z' });
        expect(weak.merchant).toBe('Unknown merchant');
        expect(strong.confidence).toBeGreaterThan(0.9);
        expect(weak.confidence).toBeLessThan(0.5);
        const promo = parseMessage('Get 3 months for $0', { from: 'no-reply@spotify.com' });
        expect(promo.confidence).toBeLessThan(0.3);
    });
    it('returns null without an amount or for an empty paste', () => {
        expect(parseMessage('', {})).toBeNull();
        expect(parseMessage('Hello, see you tomorrow', {})).toBeNull();
        expect(parseMessage('Total 30 €', {})).toBeNull();
    });
    it('ignores the balance in a bank SMS', () => {
        const c = parseMessage('Solde: 45 000,00 DA. Votre compte a été débité de 700,00 DA', {});
        expect(c?.amount).toBe(700);
    });
});
describe('splitting a paste', () => {
    it('splits on --- and on blank lines between messages with amounts', () => {
        expect(splitMessages('Paid 300 DA at A\n---\nPaid 400 DA at B')).toHaveLength(2);
        expect(splitMessages('Paid 300 DA at A\n\nPaid 400 DA at B')).toHaveLength(2);
    });
    it('keeps an email with paragraphs as one message', () => {
        const email = 'Hello,\n\nThanks for your order.\n\nTotal: 5 600 DA\n\nThe Jumia team';
        expect(splitMessages(email)).toHaveLength(1);
        expect(parseMany(email).candidates[0].merchant).toBe('Jumia');
    });
    it('counts messages it could not read', () => {
        const r = parseMany('Paid 300 DA at Café Nour\n---\nNo money here');
        expect(r.messages).toBe(2);
        expect(r.candidates).toHaveLength(1);
    });
});
