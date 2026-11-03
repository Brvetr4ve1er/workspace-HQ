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
