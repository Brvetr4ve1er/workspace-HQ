// Money start card + quick line, renderer side: vals/money-start.js + logic/money-start.js on a rigged component.
//   node --test dashboard-v5/src/logic/money-start.test.mjs
// Pins: mst-prefixed keys, a double Save sends ONE intent, a refusal keeps the typed values and shows main's words,
// the dry preview is debounced (150 ms) and stale answers are dropped, a refused line keeps the view, no XP call,
// honest read-only state. Placeholder data only — the repo is public.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { moneyStartLogic, PREVIEW_DELAY_MS } from './money-start.js';
import { moneyStartVals } from '../vals/money-start.js';
import startCardDefault, { startCard, quickLine } from '../tpl/money-start.tpl.js';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

function rig(o = {}) {
  const calls = [], toasts = [], marks = [];
  const self = Object.assign(Object.create(moneyStartLogic), {
    state: { mst: {}, mny: {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    mnySet(patch) { this.setState((s) => ({ mny: Object.assign({}, s.mny, patch) })); },
    toast: (k, t) => toasts.push([k, t]), denied(why) { toasts.push(['denied', why]); },
    useMark: o.noMark ? undefined : (id, action) => marks.push([id, action]),
    LIVE: { money: { view: { hasAccounts: !!o.hasAccounts, accounts: [] }, error: '', loaded: true } },
    hq: o.noBridge ? null : { money: { apply() {}, read() {} }, actedOn: (x) => calls.push(['xp', x]) },
    store: {
      applyMoney: async (intent) => { calls.push(['apply', intent]); return o.apply ? o.apply(intent) : { view: {}, note: 'ok' }; },
      previewMoneyLine: o.noPreview ? undefined : async (text) => { calls.push(['preview', text]); return o.preview ? o.preview(text) : { preview: { kind: 'log', label: '150 DA · Food · Cash', reason: '' } }; },
    },
  });
  const vals = () => moneyStartVals.call(self, { S: self.state, LIVE: self.LIVE });
  const applied = () => calls.filter((c) => c[0] === 'apply').map((c) => c[1]);
  return { self, calls, toasts, marks, vals, applied };
}
const type = (r, key, value) => r.vals()[key]({ target: { value } });
const settle = () => new Promise((res) => setImmediate(res));

test('every key is mst-prefixed (one shared namespace with the other surfaces)', () => {
  const r = rig();
  for (const k of Object.keys(r.vals())) assert.match(k, /^(mst|onMst)[A-Z]/, k);
});

test('Start sends exactly the typed fields as ONE start intent; blanks are left out', async () => {
  const r = rig();
  type(r, 'onMstCashDA', '12 000'); type(r, 'onMstCardUSD', ' 20 '); type(r, 'onMstFx', '135'); type(r, 'onMstBankDA', '   ');
  assert.equal(await r.self.mstStart(), true);
  assert.deepEqual(r.applied(), [{ type: 'start', cashDA: '12 000', cardUSD: '20', fxDaPerUsd: '135' }]);
  // typed values are cleared once main saved; the toast is main's own note
  assert.equal(r.vals().mstCashDA, '');
  assert.deepEqual(r.toasts, [['success', 'ok']]);
  assert.deepEqual(r.marks, [['money-start', undefined]]);
});

test('a double click sends one intent; the second is told, not dropped silently', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ apply: async () => { await gate; return { view: {}, note: 'Money started · 1 account added' }; } });
  type(r, 'onMstCashDA', '500');
  const first = r.self.mstStart(), second = r.self.mstStart();
  assert.equal(await second, false);
  assert.equal(r.vals().mstStartBusy, true);
  assert.equal(r.vals().mstStartLabel, 'Starting…');
  release();
  assert.equal(await first, true);
  assert.equal(r.applied().length, 1);
  assert.deepEqual(r.toasts.map((t) => t[0]), ['info', 'success']);
  assert.equal(r.vals().mstStartBusy, false);
  assert.equal(r.self.state.mny.busy, false);   // the shared money guard is released too
});

test('a refusal shows main’s words, keeps the typed values, and a retry can go out', async () => {
  let n = 0;
  const r = rig({ apply: async () => (++n === 1 ? { error: 'Cash needs a number, 0 or more.' } : { view: {}, note: 'done' }) });
  type(r, 'onMstCashDA', 'abc'); type(r, 'onMstPayday', '15');
  assert.equal(await r.self.mstStart(), false);
  const v = r.vals();
  assert.equal(v.mstHasRefused, true);
  assert.equal(v.mstRefusedText, 'Cash needs a number, 0 or more.');
  assert.deepEqual([v.mstCashDA, v.mstPayday], ['abc', '15']);
  assert.deepEqual(r.toasts[0], ['error', 'Cash needs a number, 0 or more.']);
  // editing a field clears the old refusal; the corrected retry succeeds
  type(r, 'onMstCashDA', '300');
  assert.equal(r.vals().mstHasRefused, false);
  assert.equal(await r.self.mstStart(), true);
  assert.equal(r.applied().length, 2);
});

test('a thrown bridge error is a refusal too, and releases the guard', async () => {
  const r = rig({ apply: async () => { throw new Error('bridge down'); } });
  type(r, 'onMstCashDA', '1');
  assert.equal(await r.self.mstStart(), false);
  assert.equal(r.vals().mstRefusedText, 'bridge down');
  assert.equal(r.self._mstBusy, false);
});

test('no hq.money: read-only reason, nothing is sent', async () => {
  const r = rig({ noBridge: true });
  assert.equal(r.vals().mstReadOnly, true);
  assert.match(r.vals().mstReadOnlyText, /hq\.money/);
  type(r, 'onMstCashDA', '1');
  assert.equal(await r.self.mstStart(), false);
  assert.equal(await r.self.mstLogLine(), false);
  assert.deepEqual(r.applied(), []);
  assert.equal(r.toasts[0][0], 'denied');
  assert.equal(rig().vals().mstReadOnly, false);
});

test('the other money writes in flight block a start (one write at a time)', async () => {
  const r = rig({ state: { mny: { busy: true } } });
  type(r, 'onMstCashDA', '1');
  assert.equal(await r.self.mstStart(), false);
  assert.deepEqual(r.applied(), []);
  assert.equal(r.toasts[0][0], 'info');
  assert.equal(r.self.state.mny.busy, true);   // not ours to release
});

test('the dry preview is debounced: one call, 150 ms after the last keystroke', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const r = rig();
    for (const t of ['1', '15', '150', '150 c', '150 cafe']) r.self.mstLineChange(t);
    mock.timers.tick(PREVIEW_DELAY_MS - 1);
    await settle();
    assert.equal(r.calls.filter((c) => c[0] === 'preview').length, 0);
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(r.calls.filter((c) => c[0] === 'preview'), [['preview', '150 cafe']]);
    const v = r.vals();
    assert.deepEqual([v.mstHasPreview, v.mstPreviewText, v.mstPreviewColor], [true, '150 DA · Food · Cash', 'var(--green)']);
    assert.deepEqual(r.applied(), []);   // a preview writes nothing
    assert.equal(PREVIEW_DELAY_MS, 150);
  } finally { mock.timers.reset(); }
});

test('preview kinds: a slip says why it goes to the Inbox, none says why it is not a spend, a late answer is dropped', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const answers = { '$9 spotify': { preview: { kind: 'slip', label: '$9.00 · Fun · RedotPay card', reason: 'needs your DA rate' } }, hello: { preview: { kind: 'none', reason: 'type it like 150 cafe' } } };
    const r = rig({ preview: (t) => answers[t] });
    r.self.mstLineChange('$9 spotify'); mock.timers.tick(150); await settle();
    assert.equal(r.vals().mstPreviewText, '$9.00 · Fun · RedotPay card → Inbox to confirm: needs your DA rate');
    assert.equal(r.vals().mstPreviewColor, 'var(--orange)');
    r.self.mstLineChange('hello'); mock.timers.tick(150); await settle();
    assert.equal(r.vals().mstPreviewText, 'type it like 150 cafe');
    assert.equal(r.vals().mstPreviewColor, 'var(--muted)');
    // an answer for an older line never repaints over a newer one
    let late; const r2 = rig({ preview: () => new Promise((res) => { late = res; }) });
    r2.self.mstLineChange('150 cafe'); mock.timers.tick(150); await settle();
    r2.self.mstLineChange('');   // cleared while the first is in flight
    late({ preview: { kind: 'log', label: 'stale', reason: '' } }); await settle();
    assert.equal(r2.vals().mstHasPreview, false);
    // an error from the dry run is shown honestly, not as "not a spend"
    const r3 = rig({ preview: () => ({ error: 'money needs the desktop bridge' }) });
    r3.self.mstLineChange('150 cafe'); mock.timers.tick(150); await settle();
    assert.equal(r3.vals().mstHasPreviewErr, true);
    assert.match(r3.vals().mstPreviewErrText, /money needs the desktop bridge/);
  } finally { mock.timers.reset(); }
});

test('Enter logs the line once: intent carries text + from, note shown, line cleared, mark written, never XP', async () => {
  const r = rig({ apply: async () => ({ view: {}, note: 'logged 150 DA · Food · Cash — undo in Recent' }) });
  r.self.mstLineChange('150 cafe');
  const e = { key: 'Enter', preventDefault() {} };
  const a = r.vals().mstLineKey(e), b = r.vals().mstLineKey(e);
  await Promise.all([a, b, settle()]);
  assert.deepEqual(r.applied(), [{ type: 'log-line', text: '150 cafe', from: 'today' }]);
  const v = r.vals();
  assert.deepEqual([v.mstLine, v.mstHasNote, v.mstNoteText, v.mstHasPreview], ['', true, 'logged 150 DA · Food · Cash — undo in Recent', false]);
  assert.deepEqual(r.marks, [['money-quick', 'log']]);
  assert.equal(r.calls.some((c) => c[0] === 'xp'), false);
  assert.doesNotMatch(JSON.stringify(Object.values(v).filter((x) => typeof x === 'string')), /\bXP\b/i);
});

test('a refused line shows the error, keeps the line and the view; Escape clears', async () => {
  const r = rig({ apply: async () => ({ error: '2026 reads as a year, not an amount — add da or usd if it is one.' }) });
  r.self.mstLineChange('2026 plan');
  assert.equal(await r.self.mstLogLine(), false);
  const v = r.vals();
  assert.deepEqual([v.mstLine, v.mstHasLineError], ['2026 plan', true]);
  assert.match(v.mstLineErrorText, /year/);
  assert.equal(r.self.state.mny.busy, false);
  v.mstLineKey({ key: 'Escape', preventDefault() {} });
  assert.deepEqual([r.vals().mstLine, r.vals().mstHasLineError], ['', false]);
  assert.deepEqual(r.marks, []);   // nothing logged, nothing marked
});

test('a blank line sends nothing; the Log button is off until there is text', async () => {
  const r = rig();
  assert.equal(await r.self.mstLogLine(), false);
  assert.equal(r.vals().mstLineCanSend, false);
  r.self.mstLineChange('150');
  assert.equal(r.vals().mstLineCanSend, true);
  assert.deepEqual(r.applied(), []);
});

test('Ctrl K helper sends from:palette once and toasts main’s note; a missing useMark is fine', async () => {
  const r = rig({ noMark: true, apply: async () => ({ view: {}, note: 'logged 150 DA · Food · Cash — undo in Recent' }) });
  assert.equal(await r.self.mstLogFromPalette('150 cafe'), true);
  assert.deepEqual(r.applied(), [{ type: 'log-line', text: '150 cafe', from: 'palette' }]);
  assert.deepEqual(r.toasts, [['success', 'logged 150 DA · Food · Cash — undo in Recent']]);
  const bad = rig({ apply: async () => ({ error: 'nope' }) });
  assert.equal(await bad.self.mstLogFromPalette('150 cafe'), false);
  assert.deepEqual(bad.marks, []);
  assert.equal(await bad.self.mstLogFromPalette('  '), false);
});

test('the templates bind only keys the vals provide, in dc-lite dialect', () => {
  const keys = new Set(Object.keys(rig().vals()).concat(['mnyImport']));
  for (const [name, tpl] of [['startCard', startCard], ['quickLine', quickLine]]) {
    const used = [...tpl.matchAll(/\{\{\s*!?\s*([A-Za-z0-9_.]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => k !== 'true' && k !== 'false');
    assert.ok(used.length > 5, name);
    for (const k of used) assert.ok(keys.has(k), `${name} binds ${k}`);
    assert.doesNotMatch(tpl, /\$\{/, `${name}: no unresolved interpolation`);
    assert.doesNotMatch(tpl, /\{\{[^}]*(\(|=>|\?|&&|\|\|)/, `${name}: dotted paths and ! only`);
  }
  assert.equal(startCardDefault, startCard);
  // every mst key the vals offer is used by a template (no dead keys), except the read-only pair the card shows and the busy mirrors
  const all = startCard + quickLine;
  for (const k of keys) if (k !== 'mnyImport') assert.ok(all.includes(`{{ ${k} }}`) || all.includes(`{{ !${k} }}`), `${k} is unused by the templates`);
});

test('the sources never call actedOn or promise XP', () => {
  for (const f of ['../logic/money-start.js', '../vals/money-start.js', '../tpl/money-start.tpl.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(src, /actedOn|\bXP\b/, f);
  }
});
