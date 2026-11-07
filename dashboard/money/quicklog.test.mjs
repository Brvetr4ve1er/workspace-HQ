// money space — the one-line spend parser (dashboard/money/quicklog.mjs). Pure: an input → expected table.
//   node --test dashboard/money/quicklog.test.mjs
// Placeholder accounts and amounts only — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, previewOf, amountLine, WORD_MAP, MAX_LINE, MAX_NOTE } from './quicklog.mjs';

const ACCOUNTS = [
  { id: 'a-cash', name: 'Cash', currency: 'DA' },
  { id: 'a-bank', name: 'CCP / bank', currency: 'DA' },
  { id: 'a-card', name: 'RedotPay card', currency: 'USD' },
];
const CTX = { accounts: ACCOUNTS, fxDaPerUsd: 135, today: '2026-11-05' };
const NO_FX = { ...CTX, fxDaPerUsd: null };
const P = (t, c = CTX) => parseLine(t, c);

test('amount first or last, bare number is DA, first account of that currency', () => {
  for (const line of ['150 cafe', 'cafe 150']) {
    const r = P(line);
    assert.equal(r.kind, 'log', line);
    assert.deepEqual([r.amount, r.currency, r.category, r.accountId, r.account, r.date, r.note], [150, 'DA', 'Food', 'a-cash', 'Cash', '2026-11-05', 'cafe'], line);
  }
  assert.equal(P('150 cafe').label, '150 DA · Food · Cash');
});

test('the input → expected table from the spec', () => {
  const rows = [
    // line, kind, amount, currency, category, accountId, date
    ['1200 food cash', 'log', 1200, 'DA', 'Food', 'a-cash', '2026-11-05'],
    ['$12.49 netflix card', 'log', 12.49, 'USD', 'Fun', 'a-card', '2026-11-05'],
    ['courses 3000', 'log', 3000, 'DA', 'Food', 'a-cash', '2026-11-05'],
    ['taxi 400da', 'log', 400, 'DA', 'Transport', 'a-cash', '2026-11-05'],
    ['2 500 loyer', 'log', 2500, 'DA', 'Bills', 'a-cash', '2026-11-05'],
    ['150', 'log', 150, 'DA', 'Other', 'a-cash', '2026-11-05'],
    ['12,5 usd', 'log', 12.5, 'USD', 'Other', 'a-card', '2026-11-05'],
    ['hier taxi 400', 'log', 400, 'DA', 'Transport', 'a-cash', '2026-11-04'],
    ['taxi 400 yesterday', 'log', 400, 'DA', 'Transport', 'a-cash', '2026-11-04'],
    ['2026 da', 'log', 2026, 'DA', 'Other', 'a-cash', '2026-11-05'],
    ['2026 cafe', 'log', 2026, 'DA', 'Food', 'a-cash', '2026-11-05'],
    ['1.200,00 pharmacie', 'log', 1200, 'DA', 'Health', 'a-cash', '2026-11-05'],
    ['taxi 400 ccp', 'log', 400, 'DA', 'Transport', 'a-bank', '2026-11-05'],
  ];
  for (const [line, kind, amount, currency, category, accountId, date] of rows) {
    const r = P(line);
    assert.deepEqual([r.kind, r.amount, r.currency, r.category, r.accountId, r.date], [kind, amount, currency, category, accountId, date], line);
  }
});

test('USD with no rate is a slip that says what is missing; with a rate it logs', () => {
  const slip = P('$12.49 netflix card', NO_FX);
  assert.equal(slip.kind, 'slip');
  assert.match(slip.reason, /needs your DA rate/);
  assert.equal(slip.amount, 12.49);
  assert.equal(slip.currency, 'USD');
  assert.match(slip.slipText, /^12\.49 USD at netflix/);
  assert.equal(P('$12.49 netflix card', CTX).kind, 'log');
});

test('two bare numbers (or two tags) are a slip, never a guess', () => {
  const a = P('150 cafe 300');
  assert.equal(a.kind, 'slip');
  assert.match(a.reason, /more than one number/);
  assert.equal(a.amount, 150);
  assert.equal(P('10 da 20 da').kind, 'slip');
  // one tagged number among bare ones: the tag wins and the others stay in the note
  const t = P('2 cafe 150da');
  assert.equal(t.kind, 'log');
  assert.equal(t.amount, 150);
  assert.equal(t.note, '2 cafe');
});

test('year rule: a lone 1900–2099 with no tag and no category word is not a spend', () => {
  assert.equal(P('2026 plan').kind, 'none');
  assert.match(P('2026 plan').reason, /year/);
  assert.equal(P('2026').kind, 'none');
  assert.equal(P('plan 1999').kind, 'none');
  assert.equal(P('2026 da').amount, 2026);
  assert.equal(P('2026 cafe').amount, 2026);
  assert.equal(P('$2026').amount, 2026);
  // not a year: out of range, or a decimal, or grouped
  assert.equal(P('2100 plan').amount, 2100);   // outside 1900–2099: an amount
  assert.equal(P('1899').amount, 1899);
  assert.equal(P('2026,50').amount, 2026.5);
});

test('refusals: no number, zero, 1e9 or more, too long, other currency', () => {
  assert.deepEqual([P('hello').kind, P('hello').reason], ['none', 'type it like 150 cafe']);
  assert.equal(P('').kind, 'none');
  assert.equal(P('   ').kind, 'none');
  assert.equal(P(undefined).kind, 'none');
  assert.equal(P('0 cafe').kind, 'none');
  assert.match(P('0 cafe').reason, /zero/);
  assert.equal(P('1000000000 cafe').kind, 'none');
  assert.equal(P('999999999 cafe').kind, 'log');
  assert.match(P('1000000000').reason, /too big/);
  assert.equal(P('x'.repeat(MAX_LINE) + ' 5').kind, 'none');
  assert.match(P('12 eur cafe').reason, /DA and USD/);
  assert.match(P('$5 da').reason, /two currencies/);
});

test('a bare number in the middle of words is not an amount; a tagged one is', () => {
  assert.equal(P('buy 400 things').kind, 'none');
  assert.equal(P('buy 400da things').kind, 'log');
  assert.equal(P('5kg rice').kind, 'none');   // glued to letters: not a number token
  assert.equal(P('150 dashboard').amount, 150);   // 'da' inside a word is not a tag
});

test('word map runs before parse.mjs: course/courses → Food, not Transport', () => {
  assert.equal(P('courses 3000').category, 'Food');
  assert.equal(P('kahwa 100').category, 'Food');
  assert.equal(P('café 100').category, 'Food');
  assert.equal(P('yassir 300').category, 'Transport');
  assert.equal(P('essence 2000').category, 'Transport');
  assert.equal(P('sonelgaz 4000').category, 'Bills');
  assert.equal(P('idoom 2500').category, 'Bills');
  // parse.mjs's merchant rules decide when the word map has no hit
  assert.equal(P('netflix 800').category, 'Fun');
  assert.equal(P('pizza 900').category, 'Food');
  assert.equal(P('mystery 90').category, 'Other');
  for (const words of Object.values(WORD_MAP)) for (const w of words) assert.match(w, /^[a-z]+$/);
});

test('account words: named account wins, dropped from the note; USD defaults to a USD account', () => {
  assert.equal(P('400 taxi ccp').accountId, 'a-bank');
  assert.equal(P('400 taxi bank').accountId, 'a-bank');
  assert.equal(P('50 netflix redotpay usd').accountId, 'a-card');
  assert.equal(P('$9 spotify').accountId, 'a-card');   // no word, USD → the USD account
  assert.equal(P('1200 food cash').note, 'food');
  // no USD account: the first account
  assert.equal(P('$9 spotify', { ...CTX, accounts: [ACCOUNTS[0]] }).accountId, 'a-cash');
  // no accounts at all: still parses, account empty
  const r = P('150 cafe', { ...CTX, accounts: [] });
  assert.deepEqual([r.kind, r.accountId, r.account, r.label], ['log', '', '', '150 DA · Food']);
});

test('yesterday words date it the day before and stay out of the note; the label says so', () => {
  const r = P('hier taxi 400');
  assert.equal(r.date, '2026-11-04');
  assert.equal(r.note, 'taxi');
  assert.match(r.label, /yesterday$/);
  assert.equal(P('Yesterday 400 taxi').date, '2026-11-04');
  // across a month edge
  assert.equal(P('hier taxi 400', { ...CTX, today: '2026-12-01' }).date, '2026-11-30');
  // slip text carries the day so the Inbox slip lands on it
  assert.match(P('hier 12 usd netflix', NO_FX).slipText, /2026-11-04$/);
});

test('the note is capped at 120 characters', () => {
  const r = P('150 ' + 'a'.repeat(190));
  assert.equal(r.kind, 'log');
  assert.equal(r.note.length, MAX_NOTE);
});

test('previewOf keeps only the renderer shape', () => {
  const p = previewOf(P('150 cafe'));
  assert.deepEqual(Object.keys(p).sort(), ['account', 'amount', 'category', 'currency', 'date', 'kind', 'label', 'reason']);
  assert.equal(p.label, '150 DA · Food · Cash');
  assert.equal(previewOf(P('hello')).kind, 'none');
});

test('amountLine: a standalone number at the start or end, same year rule', () => {
  const yes = ['150 cafe', 'cafe 150', 'taxi 400da', '$12.49 netflix', '2026 da', '2026 cafe', '1 200 food', 'hier taxi 400', '150', '12,5 usd', 'netflix 800 usd'];
  const no = ['2026 plan', 'deploy v2', 'hello', '', '0 cafe', 'buy 400 things', '12 eur cafe', 'plan 1999', 'x'.repeat(MAX_LINE + 1) + ' 5'];
  for (const t of yes) assert.ok(amountLine(t), t);
  for (const t of no) assert.equal(amountLine(t), null, t);
  assert.deepEqual(amountLine('$12.49 netflix'), { amount: 12.49, currency: 'USD', tagged: true });
  assert.deepEqual(amountLine('150 cafe'), { amount: 150, currency: 'DA', tagged: false });
  assert.equal(amountLine(42), null);
});

test('amountLine and parseLine agree on year handling and on refusals for lines with no account words', () => {
  for (const t of ['2026 plan', '2026 cafe', '2026 da', '0 cafe', 'hello', '150 cafe', 'taxi 400', '12 eur']) {
    const a = amountLine(t), p = P(t);
    assert.equal(!!a, p.kind !== 'none', t);
  }
});
