/**
 * Invented sample messages for the inbox parser — realistic in shape, with
 * no real personal data (card numbers, accounts and names are made up).
 * Each fixture carries what the parser is expected to read from it.
 */
export const FIXTURES = [
    {
        name: 'RedotPay card transaction',
        from: 'no-reply@redotpay.com',
        receivedAt: '2026-10-08T19:42:10.000Z',
        text: 'RedotPay\nCard transaction: USD 12.49 at STEAMGAMES.COM on 08/10/2026 20:41.\nCard ending 0000. Available balance: USD 87.51',
        expect: { merchant: 'Steam', amount: 12.49, currency: 'USD', date: '2026-10-08', flags: [], category: 'Fun' },
    },
    {
        name: 'Steam receipt (same purchase as the RedotPay alert)',
        from: 'noreply@steampowered.com',
        receivedAt: '2026-10-08T19:41:55.000Z',
        text: 'Thank you for your Steam purchase!\nHollow Knight: Silksong\nTotal: $12.49\nDate issued: 8 Oct 2026',
        expect: { merchant: 'Steam', amount: 12.49, currency: 'USD', date: '2026-10-08', flags: [], category: 'Fun' },
    },
    {
        name: 'Algerian bank SMS debit',
        from: 'BNA',
        receivedAt: '2026-10-10T09:15:00.000Z',
        text: 'BNA: Votre compte N° 000123****45 a été débité de 2 500,00 DA le 10/10/2026 chez SUPERETTE EL AMEL. Solde: 45 300,00 DA',
        expect: { merchant: 'Superette El Amel', amount: 2500, currency: 'DA', date: '2026-10-10', flags: [], category: 'Food' },
    },
    {
        name: 'BaridiMob bill payment',
        from: 'BaridiMob',
        receivedAt: '2026-10-05T12:00:00.000Z',
        text: 'BaridiMob : Paiement de 1 840,00 DA effectué vers Sonelgaz le 05-10-2026. Réf 7781200.',
        expect: { merchant: 'Sonelgaz', amount: 1840, currency: 'DA', date: '2026-10-05', flags: [], category: 'Bills' },
    },
    {
        name: 'CCP withdrawal notice',
        from: 'Algérie Poste',
        receivedAt: '2026-10-03T08:30:00.000Z',
        text: 'Algérie Poste CCP: Retrait de 10.000,00 DA effectué le 03/10/2026 au GAB. Nouveau solde 22.150,00 DA',
        expect: { merchant: 'Cash withdrawal', amount: 10000, currency: 'DA', date: '2026-10-03', flags: [] },
    },
    {
        name: 'Jumia order confirmation',
        from: 'orders@jumia.dz',
        receivedAt: '2026-10-09T10:05:00.000Z',
        text: 'Your order #JM-48213 is confirmed\n\nHello,\nThanks for shopping on Jumia.\n1 x Écouteurs sans fil  4 900 DA\nLivraison  700 DA\nTotal : 5 600 DA\nPaiement à la livraison',
        expect: { merchant: 'Jumia', amount: 5600, currency: 'DA', date: '2026-10-09', flags: [] },
    },
    {
        name: 'Yassir trip receipt',
        from: 'receipts@yassir.com',
        // midday UTC (was 22:10Z): dayOfReceived uses the LOCAL day, so 22:10Z read as Oct 9 on a UTC+2 PC
        receivedAt: '2026-10-08T12:10:00.000Z',
        text: 'Your trip receipt\nThanks for riding with Yassir.\nBab Ezzouar → Hydra\nTotal 650 DA\nPaid in cash',
        expect: { merchant: 'Yassir', amount: 650, currency: 'DA', date: '2026-10-08', flags: [], category: 'Transport' },
    },
    {
        name: 'Netflix renewal notice (not a charge)',
        from: 'info@account.netflix.com',
        receivedAt: '2026-10-09T07:00:00.000Z',
        text: 'Your membership renews on 20 October. You will be charged USD 7.99 for the Basic plan.',
        expect: { merchant: 'Netflix', amount: 7.99, currency: 'USD', date: '2026-10-20', flags: ['not_a_charge'] },
    },
    {
        name: 'Spotify promotion',
        from: 'no-reply@spotify.com',
        receivedAt: '2026-10-08T15:00:00.000Z',
        text: 'Get 3 months of Premium for $0. Offer ends soon — individual plan only.',
        expect: { merchant: 'Spotify', amount: 0, currency: 'USD', date: '2026-10-08', flags: ['promo'] },
    },
    {
        name: 'Google Play receipt',
        from: 'googleplay-noreply@google.com',
        receivedAt: '2026-10-07T18:20:00.000Z',
        text: 'Your Google Play Order Receipt from Oct 7, 2026\nOrder number: GPA.0000-1111-2222-33333\nItem: 500 Gems (Some Game)\nTotal: $4.99/one-time',
        expect: { merchant: 'Google Play', amount: 4.99, currency: 'USD', date: '2026-10-07', flags: [], category: 'Fun' },
    },
    {
        name: 'Refund notice',
        from: 'noreply@steampowered.com',
        receivedAt: '2026-10-12T09:00:00.000Z',
        text: 'Your refund has been processed. USD 12.49 will be returned to your card ending 0000.',
        expect: { merchant: 'Steam', amount: -12.49, currency: 'USD', date: '2026-10-12', flags: ['refund'] },
    },
    {
        name: 'Generic card receipt with "chez"',
        from: '',
        receivedAt: '2026-10-11T13:00:00.000Z',
        text: 'Achat par carte CIB de 1 200,00 DA chez Pharmacie Ibn Sina le 11/10/2026.',
        expect: { merchant: 'Pharmacie Ibn Sina', amount: 1200, currency: 'DA', date: '2026-10-11', flags: [], category: 'Health' },
    },
    {
        name: 'Euro receipt (unsupported currency)',
        from: 'receipt@example.fr',
        receivedAt: '2026-10-06T10:00:00.000Z',
        text: 'Merci pour votre achat. Total : 24,90 € payé le 06/10/2026.',
        expect: null,
    },
    {
        name: 'Newsletter with no amount',
        from: 'news@example.com',
        receivedAt: '2026-10-06T10:00:00.000Z',
        text: 'This week: five ways to plan your month. Read more on our blog.',
        expect: null,
    },
];
