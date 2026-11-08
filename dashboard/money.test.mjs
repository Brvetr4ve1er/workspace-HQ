// money space, main side. Pins: the four IPC channels, intent validation before IO,
// atomic + corrupt-tolerant persistence, restart survival, import as a union (never a replace),
// and that every failure comes back as { error } — the renderer is never thrown at.
// Temp dirs only; the dialog is injected (no real file pickers, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const money = require('./money.js');

// a clock that moves a minute per call (real use never logs in the same ms as an anchor) + counted ids
function boot({ dir, picks = [] } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-'));
  let t = Date.parse('2026-11-03T09:00:00Z'), n = 0;
  const m = money.create({ dataDir: dir, now: () => new Date(t += 60000), newId: () => 'id' + (++n), pick: async (mode) => { const p = picks.shift(); assert.ok(p, `unexpected ${mode} dialog`); return p.file; } });
  return { m, dir };
}

test('init registers exactly the four documented channels', () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => { assert.ok(!handlers.has(ch), `${ch} registered twice`); handlers.set(ch, fn); } };
  money.init({ ipcMain, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-')), getWin: () => null });
  assert.deepEqual([...handlers.keys()].sort(), ['hq:money:apply', 'hq:money:export', 'hq:money:import', 'hq:money:read']);
});

test('first read: no file is a correct empty state, nothing written', async () => {
  const { m } = boot();
  const r = await m.read();
  assert.equal(r.view.hasAccounts, false);
  assert.equal(r.view.room.has, false);
  assert.equal(fs.existsSync(m.file), false);
});

test('account → bill → spend moves breathing room exactly; survives a restart', async () => {
  const { m, dir } = boot();
  assert.equal((await m.apply({ type: 'account-save', name: 'Cash', currency: 'DA', balance: '50 000' })).note, 'Cash added');
  await m.apply({ type: 'obligation-save', name: 'Rent', amount: '18000', firstDue: '2026-11-20', accountId: 'id1' });
  const r = await m.apply({ type: 'log', amount: '1 200', category: 'Food', accountId: 'id1' });
  assert.equal(r.view.room.amount, '30,800 DA');
  assert.equal(r.view.recent[0].category, 'Food');
  const again = boot({ dir });   // same dataDir = an app restart
  assert.equal((await again.m.read()).view.room.amount, '30,800 DA');
});

test('pay a bill writes a Bills row on the bill account; undo removes both', async () => {
  const { m } = boot();
  await m.apply({ type: 'account-save', name: 'Cash', currency: 'DA', balance: '50000' });
  await m.apply({ type: 'obligation-save', name: 'Rent', amount: '18000', firstDue: '2026-11-20', accountId: 'id1' });
  const paid = await m.apply({ type: 'obligation-pay', id: 'id2' });
  assert.equal(paid.note, 'Rent paid');
  assert.equal(paid.view.accounts[0].balance, '32,000 DA');
  assert.equal(paid.view.recent[0].isBill, true);
  const undoId = paid.view.obligations[0].undoId;
  assert.ok(undoId);
  const undone = await m.apply({ type: 'obligation-unpay', paymentId: undoId });
  assert.equal(undone.view.accounts[0].balance, '50,000 DA');
  assert.equal(undone.view.ledgerCount, 0);
});

test('refused intents come back as { error } and change nothing on disk', async () => {
  const { m } = boot();
  await m.apply({ type: 'account-save', name: 'Cash', currency: 'DA', balance: '100' });
  const before = fs.readFileSync(m.file, 'utf8');
  for (const bad of [null, [], 'log', { type: 'drop-table' }, { type: 'log', amount: '-5' }, { type: 'log', amount: 'abc' }, { type: 'log', amount: '10', currency: 'EUR' },
    { type: 'log', amount: '10', currency: 'USD' }, { type: 'obligation-pay', id: '../../etc' }, { type: 'account-save', name: '', balance: '1' }, { type: 'inbox-paste', text: 'x'.repeat(70000) }]) {
    const r = await m.apply(bad);
    assert.equal(typeof r.error, 'string', JSON.stringify(bad));
    assert.equal(r.view, undefined);
  }
  assert.equal(fs.readFileSync(m.file, 'utf8'), before);
});

test('a USD log is refused until the rate is set, then converts', async () => {
  const { m } = boot();
  assert.match((await m.apply({ type: 'log', amount: '12.49', currency: 'USD' })).error, /DA rate/);
  await m.apply({ type: 'settings', fxDaPerUsd: '245', paydayDay: '25' });
  const r = await m.apply({ type: 'log', amount: '12.49', currency: 'USD', category: 'Fun' });
  assert.equal(r.view.recent[0].amount, '$12.49 · 3,060 DA');
});

test('corrupt state.json is quarantined, never overwritten', async () => {
  const { m } = boot();
  fs.mkdirSync(path.dirname(m.file), { recursive: true });
  fs.writeFileSync(m.file, '{ not json');
  const r = await m.read();
  assert.equal(r.view.hasAccounts, false);
  assert.equal(fs.readFileSync(m.file + '.corrupt', 'utf8'), '{ not json');
});

test('inbox: paste → one slip; promo needs a second deliberate tap; refund lands as income', async () => {
  const { m } = boot();
  await m.apply({ type: 'account-save', name: 'Card', currency: 'USD', balance: '100' });
  await m.apply({ type: 'settings', fxDaPerUsd: '245', paydayDay: '' });
  const p = await m.apply({ type: 'inbox-paste', text: 'Spotify: Get 3 months of Premium for $0. Offer ends 20 October.\n---\nYour refund has been processed. USD 12.49 will be returned to your card ending 0000.', from: 'noreply@steampowered.com' });
  assert.match(p.note, /read 2 messages/);
  const promo = p.view.slips.find((s) => s.warn), refund = p.view.slips.find((s) => s.refund);
  assert.ok(promo && refund);
  assert.match((await m.apply({ type: 'inbox-confirm', id: promo.id, category: 'Fun' })).error, /confirm anyway/);
  assert.equal((await m.apply({ type: 'inbox-confirm', id: promo.id, category: 'Fun', anyway: true })).view.ledgerCount, 1);
  const back = await m.apply({ type: 'inbox-confirm', id: refund.id, accountId: 'id1' });
  assert.equal(back.view.accounts[0].balance, '$112.49');
  assert.equal(back.view.ledgerCount, 1);   // a refund never becomes spending
  assert.equal(back.view.handled, 2);
  assert.equal((await m.apply({ type: 'inbox-clear' })).view.handled, 0);
});

test('import merges an Ember export as a union and reports it; export writes the state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-io-'));
  const ember = path.join(dir, 'ember-export.json');
  const at = '2026-10-01T09:00:00.000Z';
  fs.writeFileSync(ember, JSON.stringify({ profile: { ignored: true }, money: { accounts: [{ id: 'cash', name: 'Cash', currency: 'DA', anchorBalance: 20000, anchorAt: at, archived: false, updatedAt: at }] },
    transactions: [{ id: 't1', amountDA: 500, category: 'Food', date: '2026-10-02', accountId: 'cash' }, { id: 'bad', amountDA: -1, category: 'x', date: '2026-10-02' }] }));
  const out = path.join(dir, 'out.json');
  const { m } = boot({ picks: [{ file: ember }, { file: ember }, { file: out }, { file: null }] });
  const r = await m.importFile();
  assert.match(r.note, /1 new entry/);
  assert.equal(r.view.accounts[0].balance, '19,500 DA');
  const twice = await m.importFile();   // same file again: union, nothing doubles
  assert.match(twice.note, /0 new entries/);
  assert.equal((await m.exportFile()).note, 'exported to out.json');
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).transactions.length, 1);
  assert.deepEqual(await m.exportFile(), { canceled: true });
});

test('import refuses a file that is not an export, writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-io-'));
  const junk = path.join(dir, 'junk.json'); fs.writeFileSync(junk, '{"hello":1}');
  const txt = path.join(dir, 'notes.json'); fs.writeFileSync(txt, 'plain text');
  const { m } = boot({ picks: [{ file: junk }, { file: txt }] });
  assert.match((await m.importFile()).error, /nothing to import/);
  assert.match((await m.importFile()).error, /not an Ember export/);
  assert.equal(fs.existsSync(m.file), false);
});

// ---- loop iteration 2 (2026-11-05): four reproduced main-side bugs ----------------------------------------------------
// a clock the test can jump (two different days), a minute per call otherwise
function bootAt({ dir, picks = [], start = '2026-11-03T09:00:00Z' } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-'));
  let t = Date.parse(start), n = 0;
  const m = money.create({ dataDir: dir, now: () => new Date(t += 60000), newId: () => 'id' + (++n), pick: async () => picks.shift() });
  return { m, dir, at: (iso) => { t = Date.parse(iso); } };
}
const st = (m) => JSON.parse(fs.readFileSync(m.file, 'utf8'));

test('importing a backup taken before an undo does not resurrect the undone bill payment (payments are the authority)', async () => {
  const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-io-')), 'backup.json');
  const { m } = bootAt({ picks: [backup, backup] });
  await m.apply({ type: 'account-save', name: 'CCP', currency: 'DA', balance: '50000' });
  await m.apply({ type: 'obligation-save', name: 'Rent', amount: '18000', firstDue: '2026-11-20', accountId: 'id1' });
  const paid = await m.apply({ type: 'obligation-pay', id: 'id2' });
  await m.exportFile();   // the owner's backup, taken after the pay
  await m.apply({ type: 'obligation-unpay', paymentId: paid.view.obligations[0].undoId });
  const imp = await m.importFile();
  assert.equal(imp.view.accounts[0].balance, '50,000 DA', 'was 32,000 DA: an 18,000 DA phantom debit nothing could remove');
  assert.equal(imp.view.ledgerCount, 0);
  const s = st(m);
  assert.ok(s.money.payments.every((p) => p.void), 'the payment stays undone');
  assert.deepEqual(s.transactions, [], 'its Bills row is gone from disk too');
});

test('a back-dated slip confirmed after a re-confirmed balance is not counted twice (spend and refund)', async () => {
  const { m, at } = bootAt();
  await m.apply({ type: 'account-save', name: 'CCP', currency: 'DA', balance: '50000' });
  at('2026-11-05T09:00:00Z');
  await m.apply({ type: 'account-save', id: 'id1', name: 'CCP', currency: 'DA', balance: '48000' });   // already includes the 02 Nov debit
  const p = await m.apply({ type: 'inbox-paste', text: 'Votre compte a été débité de 2 000 DA le 02/11/2026. Jumia', from: 'CCP' });
  const c = await m.apply({ type: 'inbox-confirm', id: p.view.slips[0].id, accountId: 'id1', category: 'Other', anyway: true });
  assert.equal(c.error, undefined);
  assert.equal(c.view.accounts[0].balance, '48,000 DA', 'was 46,000 DA');
  assert.equal(st(m).transactions[0].at, undefined, 'a back-dated row carries no instant: the date rule decides');
  // a same-day slip still lands after the anchor and counts
  const today = await m.apply({ type: 'inbox-paste', text: 'Votre compte a été débité de 500 DA le 05/11/2026. Yassir', from: 'CCP' });
  const t2 = await m.apply({ type: 'inbox-confirm', id: today.view.slips.find((x) => x.amount && /500/.test(x.amount)).id, accountId: 'id1', category: 'Transport', anyway: true });
  assert.equal(t2.view.accounts[0].balance, '47,500 DA', 'same-day behaviour unchanged');
});

test('a second corrupt file never overwrites the first quarantine; valid JSON of the wrong shape is quarantined too', async () => {
  const { m, dir } = bootAt();
  const file = path.join(dir, 'money', 'state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"v":1,"money":');            // truncated
  await m.read();
  fs.writeFileSync(file, 'garbage #2');
  await m.read();
  fs.writeFileSync(file, '[{"id":"x"}]');               // valid JSON, wrong shape
  const r = await m.read();
  assert.ok(r.view, 'still an empty working state');
  assert.equal(fs.readFileSync(file + '.corrupt', 'utf8'), '{"v":1,"money":', 'the first quarantine is kept');
  assert.equal(fs.readFileSync(file + '.corrupt-2', 'utf8'), 'garbage #2');
  assert.equal(fs.readFileSync(file + '.corrupt-3', 'utf8'), '[{"id":"x"}]', 'was: read as empty and overwritten by the next save');
});

test('paying a USD variable bill with the amount left blank keeps the cents (2-decimal mean, not whole dollars)', async () => {
  const { m } = bootAt();
  await m.apply({ type: 'account-save', name: 'Card', currency: 'USD', balance: '100' });
  await m.apply({ type: 'settings', fxDaPerUsd: '245', paydayDay: '25' });
  await m.apply({ type: 'obligation-save', name: 'Claude', kind: 'variable', amount: '21.49', currency: 'USD', cadence: 'weekly', firstDue: '2026-11-03', accountId: 'id1' });
  await m.apply({ type: 'obligation-pay', id: 'id2', amount: '21.49' });
  await m.apply({ type: 'obligation-pay', id: 'id2' });   // blank = the estimate
  assert.deepEqual(st(m).money.payments.map((p) => p.amount), [21.49, 21.49], 'was [21.49, 21]');
});

test('an account balance of zero saves however it is typed ("0.00" was refused with "needs a number above 0" while "0" saved)', async () => {
  const { m } = bootAt();
  for (const b of ['0', '0.00', '0,00', '0.0', '00']) {
    const r = await m.apply({ type: 'account-save', name: 'Card ' + b, currency: 'USD', balance: b });
    assert.equal(r.error, undefined, JSON.stringify(b) + ': ' + r.error);
    assert.equal(r.view.accounts.at(-1).balance, '$0.00');
  }
  for (const bad of ['-5', 'abc', '0 DA']) assert.match((await m.apply({ type: 'account-save', name: 'X', currency: 'DA', balance: bad })).error, /balance needs a number/, JSON.stringify(bad) + ' still refused');
});

// Operator Brief inputs (plan Task 3): export records lastExportAt; the view carries each account's anchorAt
test('a successful export writes money/meta.json lastExportAt; a cancelled one does not', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-ex-')), 'x.json');
  const { m, dir } = bootAt({ picks: [null, out] });
  const meta = path.join(dir, 'money', 'meta.json');
  await m.apply({ type: 'account-save', name: 'Cash', currency: 'DA', balance: '100' });
  assert.equal((await m.exportFile()).canceled, true);
  assert.equal(fs.existsSync(meta), false, 'cancelled: no backup claimed');
  await m.exportFile();
  const t = JSON.parse(fs.readFileSync(meta, 'utf8')).lastExportAt;
  assert.ok(Number.isFinite(Date.parse(t)), 'an ISO instant');
});

test('the view carries each account’s anchorAt (stable across days; changes on re-confirm)', async () => {
  const { m } = bootAt();
  const a = await m.apply({ type: 'account-save', name: 'Cash', currency: 'DA', balance: '100' });
  const first = a.view.accounts[0].anchorAt;
  assert.ok(Number.isFinite(Date.parse(first)));
  const b = await m.apply({ type: 'account-save', id: a.view.accounts[0].id, name: 'Cash', currency: 'DA', balance: '90' });
  assert.notEqual(b.view.accounts[0].anchorAt, first, 're-confirming moves the anchor');
});

// ---- money in one minute + one line per spend (money-quicklog) ----------------------------------
test('start creates up to 3 accounts, the rate and the payday in ONE write; all-blank is refused without writing; a second start is refused', async () => {
  const { m } = bootAt();
  const blank = await m.apply({ type: 'start', cashDA: '', bankDA: ' ', cardUSD: undefined });
  assert.match(blank.error, /add at least one balance/);
  assert.equal(fs.existsSync(m.file), false, 'a refused start writes nothing');
  const r = await m.apply({ type: 'start', cashDA: '12 000', bankDA: '85000', cardUSD: '40.5', fxDaPerUsd: '245', paydayDay: '25' });
  assert.equal(r.error, undefined);
  assert.equal(r.note, 'Money started · 3 accounts added');
  assert.deepEqual(r.view.accounts.map((a) => a.balance), ['12,000 DA', '85,000 DA', '$40.50']);
  const s = st(m);
  assert.equal(s.money.accounts.length, 3);
  assert.equal(s.money.settings.fxDaPerUsd, 245);
  assert.equal(s.money.settings.paydayDay, 25);
  const before = fs.readFileSync(m.file, 'utf8');
  assert.match((await m.apply({ type: 'start', cashDA: '1' })).error, /already set up/);
  assert.equal(fs.readFileSync(m.file, 'utf8'), before, 'a repeated or forged start changes nothing');
  assert.match((await bootAt().m.apply({ type: 'start', cashDA: '-5' })).error, /Cash needs a number/);
  assert.match((await bootAt().m.apply({ type: 'start', cashDA: '5', paydayDay: '31' })).error, /payday is a day from 1 to 28/);
});

test('log-line writes the same transaction shape as log, dated yesterday for "hier"', async () => {
  const { m } = bootAt();
  await m.apply({ type: 'start', cashDA: '50000' });
  const a = await m.apply({ type: 'log', amount: '150', category: 'Food', accountId: 'id1', note: 'cafe' });
  const b = await m.apply({ type: 'log-line', text: '150 cafe', from: 'today' });
  assert.equal(b.note, 'logged 150 DA · Food · Cash — undo in Recent');
  const [lineTx, logTx] = st(m).transactions;
  assert.deepEqual(Object.keys(lineTx).sort(), Object.keys(logTx).sort(), 'same keys as the log intent');
  for (const k of ['amountDA', 'category', 'note', 'accountId', 'date']) assert.equal(lineTx[k], logTx[k], k);
  assert.ok(lineTx.at, 'a same-day row carries its instant');
  const y = await m.apply({ type: 'log-line', text: 'hier taxi 400', from: 'palette' });
  assert.equal(y.error, undefined);
  const row = st(m).transactions.find((t) => t.amountDA === 400);
  assert.equal(row.category, 'Transport');
  assert.equal(row.amountDA, 400);
  assert.ok(row.date < lineTx.date, 'dated the day before');
  assert.equal(row.at, undefined, 'a back-dated row is dated by its day alone');
  assert.equal(a.error, undefined);
});

test('log-line: USD with no rate becomes an Inbox slip; with a rate it logs the DA value and keeps the original', async () => {
  const { m } = bootAt();
  await m.apply({ type: 'start', cashDA: '1000', cardUSD: '50' });
  const slip = await m.apply({ type: 'log-line', text: '$12.49 netflix card', from: 'today' });
  assert.equal(slip.error, undefined);
  assert.equal(slip.note, 'in the Inbox to confirm: needs your DA rate');
  assert.equal(st(m).transactions.length, 0, 'nothing reached the ledger');
  assert.equal(st(m).inbox.candidates.filter((c) => c.status === 'pending').length, 1);
  await m.apply({ type: 'settings', fxDaPerUsd: '245', paydayDay: '' });
  const ok = await m.apply({ type: 'log-line', text: '$12.49 netflix card', from: 'today' });
  assert.match(ok.note, /^logged \$12\.49 · /);
  const tx = st(m).transactions[0];
  assert.deepEqual(tx.original, { amount: 12.49, currency: 'USD' });
  assert.equal(tx.amountDA, 3060, "12.49 x 245, rounded to a whole DA like every other USD row");
});

test('log-line: a refused line says why and writes nothing; only today/palette are accepted', async () => {
  const { m } = bootAt();
  await m.apply({ type: 'start', cashDA: '1000' });
  const before = fs.readFileSync(m.file, 'utf8');
  assert.match((await m.apply({ type: 'log-line', text: 'hello', from: 'today' })).error, /type it like 150 cafe/);
  assert.match((await m.apply({ type: 'log-line', text: '2026 plan', from: 'today' })).error, /year/);
  assert.match((await m.apply({ type: 'log-line', text: '150 cafe', from: 'tray' })).error, /unknown action/);
  assert.match((await m.apply({ type: 'log-line', text: 'x'.repeat(201) + ' 5', from: 'today' })).error, /too long/);
  assert.equal(fs.readFileSync(m.file, 'utf8'), before);
});

test('a dry log-line previews and never writes (not even a first state file); the four-channel pin is unchanged', async () => {
  const { m } = bootAt();
  const empty = await m.apply({ type: 'log-line', text: '150 cafe', from: 'today', dry: true });
  assert.equal(empty.preview.kind, 'log');
  assert.equal(fs.existsSync(m.file), false, 'a dry preview creates no file');
  await m.apply({ type: 'start', cashDA: '1000' });
  const before = fs.readFileSync(m.file, 'utf8');
  const p = await m.apply({ type: 'log-line', text: '150 cafe', from: 'today', dry: true });
  assert.deepEqual(p.preview, { kind: 'log', amount: 150, currency: 'DA', category: 'Food', account: 'Cash', date: p.preview.date, label: '150 DA · Food · Cash', reason: '' });
  assert.equal(p.view, undefined, 'a dry reply carries no view');
  const slip = await m.apply({ type: 'log-line', text: '$5 netflix', from: 'palette', dry: true });
  assert.equal(slip.preview.kind, 'slip');
  assert.equal((await m.apply({ type: 'log-line', text: 'hello', from: 'today', dry: true })).preview.kind, 'none');
  assert.equal(fs.readFileSync(m.file, 'utf8'), before, 'dry runs wrote nothing');
  const handlers = new Map();
  money.init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hq-money-')), getWin: () => null });
  assert.deepEqual([...handlers.keys()].sort(), ['hq:money:apply', 'hq:money:export', 'hq:money:import', 'hq:money:read']);
});

// ---- money-quicklog tasting fixes -------------------------------------------------------------------------
test('log-line slips: a yesterday slip never swallows today’s line; an exact repeat the same day says it is already there', async () => {
  const { m } = bootAt();
  await m.apply({ type: 'start', cashDA: '1000', cardUSD: '50' });   // no rate set: a USD line goes to the Inbox
  const pending = () => st(m).inbox.candidates.filter((c) => c.status === 'pending');
  const y = await m.apply({ type: 'log-line', text: 'hier $12.49 netflix card', from: 'today' });
  assert.equal(y.note, 'in the Inbox to confirm: needs your DA rate');
  const t = await m.apply({ type: 'log-line', text: '$12.49 netflix card', from: 'today' });
  assert.equal(t.note, 'in the Inbox to confirm: needs your DA rate', 'today’s line is its own slip');
  assert.equal(pending().length, 2, 'yesterday and today stay two slips');
  assert.notEqual(pending()[0].date, pending()[1].date);
  const again = await m.apply({ type: 'log-line', text: '$12.49 netflix card', from: 'today' });
  assert.match(again.note, /^already in the Inbox/, 'the repeat says it was not added');
  assert.equal(pending().length, 2, 'nothing new was added');
});

test('dry is honoured only by log-line: a forged dry start or log is refused, not written', async () => {
  const { m } = bootAt();
  assert.match((await m.apply({ type: 'start', dry: true, cashDA: '1' })).error, /unknown action/);
  assert.equal(fs.existsSync(m.file), false);
  await m.apply({ type: 'start', cashDA: '1000' });
  const before = fs.readFileSync(m.file, 'utf8');
  assert.match((await m.apply({ type: 'log', dry: true, amount: '5', category: 'Food' })).error, /unknown action/);
  assert.equal(fs.readFileSync(m.file, 'utf8'), before);
  assert.equal((await m.apply({ type: 'log-line', text: '150 cafe', from: 'today', dry: true })).preview.kind, 'log');
});
