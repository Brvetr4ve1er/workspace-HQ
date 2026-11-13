// Security space: render values (vals/security.js), the actions (logic/security.js), the template's bindings (tpl/security.tpl.js) and the
// selftest rows (selftest-security.mjs). Plain Node, a rigged `this`, a fake window.hq.security, invented data only
// (example.test, acme.test, alpha-site.test, owner@example.test, the passphrase "correct horse example").
//
//   node --test dashboard-v5/src/vals/security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tplDefault, { space as tplSpace, overlays as tplOverlays } from '../tpl/security.tpl.js';
import { resolve } from '../dc/runtime.js';
import { securityVals, SEC_OFF, SEC_TEXT } from './security.js';
import { securityLogic, secInit, secSteps, STEPS, HIDE_WORDING, COPY_NOTE, CONFLICT_WORDING, EXPORT_WORDING, FLAG_WORDS } from '../logic/security.js';
import { createSecuritySlice, emptySecurity } from '../live/security-slice.mjs';
import { securityFixture, securityStates, passphraseLeaks, FIXTURE_EXPORTS, FAKE_PASSPHRASE, WRONG_PASSPHRASE_ERROR, SECURITY_OFFLINE_ROWS } from '../selftest-security.mjs';
import { LOCKED_LABEL } from '../logic/security-graph.mjs';
import { WORDS } from '../logic/security-words.mjs';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASS = FAKE_PASSPHRASE;

// the words the honesty rule bans, assembled so this file never contains them itself (the rule scans security* files)
const BANNED = new RegExp('\\b(' + ['sa' + 'fe', 'sec' + 'ure', 'sec' + 'ured', 'pro' + 'tected'].join('|') + ')\\b', 'i');
const BANNED_WORD = 'sa' + 'fe';

// ---- the rig -----------------------------------------------------------------------------------------------------------------
function fakeHq(log, opts = {}) {
  const sec = {
    read: async () => { log.push(['read']); return opts.readAnswer || securityFixture(); },
    refresh: async (p, b) => { log.push(['refresh', b]); return p === PASS ? { ok: true, accounts: 7, breachChecked: b !== false, notes: [] } : { error: WRONG_PASSPHRASE_ERROR }; },
    scanExports: async () => { log.push(['scan']); return { files: FIXTURE_EXPORTS.slice() }; },
    edit: async (id, patch) => { log.push(['edit', id, patch]); return opts.editAnswer || { ok: true }; },
    addManual: async (o) => { log.push(['addManual', o]); return opts.addAnswer || { ok: true, id: 'm-aaaaaaaaaaaa' }; },
    addIdentity: async (o) => { log.push(['addIdentity', o]); return opts.addIdAnswer || { ok: true, ref: 'i-cccccccccccc' }; },
    settings: async (p) => { log.push(['settings', p]); return opts.settingsAnswer || { ok: true }; },
    walkthrough: async (s, d) => { log.push(['walkthrough', s, d]); return { ok: true }; },
    trashExport: async (n, d) => { log.push(['trash', n, d]); return { ok: true }; },
    copy: async (t) => { log.push(['copy', t]); return { ok: true }; },
  };
  return { security: sec };
}

function rig(o = {}) {
  const log = [], marks = [], toasts = [];
  const live = { security: emptySecurity() };
  const hq = o.noHq ? null : fakeHq(log, o);
  const store = createSecuritySlice({ hq, live, emit() {} });
  const self = Object.assign(Object.create(securityLogic), {
    state: { tab: 'security', sub: { security: 'map' }, sec: secInit(), ...(o.state || {}) }, hq, store, LIVE: live,
    setState(p) { const patch = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...patch }; },
    toast(k, t) { toasts.push([k, t]); }, useMark(s, a) { marks.push([s, a]); }, setSub(id) { this.setState({ sub: { security: id } }); },
  });
  const ctx = (extra) => ({ S: self.state, v: { security: true }, sub: self.state.sub.security, LIVE: live, tabStyle: (a) => ({ on: a }), ...(extra || {}) });
  const vals = (extra) => securityVals.call(self, ctx(extra)).secv;
  return { self, log, marks, toasts, live, hq, store, vals, ctx };
}
const arrived = async (o) => { const r = rig(o); await r.self.secArrive(); return r; };
function useRow(r, name) {
  const row = securityStates().find((x) => x[0] === name);
  assert.ok(row, 'no selftest row ' + name);
  r.live.security = row[2];
  r.self.state = { ...r.self.state, sub: { security: row[1] }, sec: { ...secInit(), ...row[3] } };
  return row;
}
const field = (r, name, value) => { const el = { value: value || '' }; r.self.secRef(name)(el); return el; };
function undefinedPaths(v, path = 'v', seen = new Set()) {
  if (v === undefined) return [path];
  if (v === null || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, path + '.' + k, seen));
}

// ---- off the tab, one top-level key, the same key set everywhere -------------------------------------------------------
test('off the tab: ONE frozen object, the same reference every call, no layout, no memo', () => {
  const r = rig({ state: { tab: 'home' } });
  const a = securityVals.call(r.self, r.ctx({ v: { security: false } })), b = securityVals.call(r.self, r.ctx({ v: {} }));
  assert.equal(a, b, 'the very same object');
  assert.equal(a.secv, SEC_OFF);
  assert.ok(Object.isFrozen(SEC_OFF) && Object.isFrozen(a));
  assert.equal(r.self._secMemo, undefined);
  assert.equal(securityVals.call(r.self, { S: { tab: 'home' }, v: {} }).secv, SEC_OFF);
  assert.equal(securityVals.call(r.self, { S: { tab: 'security' }, v: { security: false } }).secv, SEC_OFF, 'the shell says the screen is not ready');
});

test('securityVals adds exactly ONE top-level renderVals key (secv), on and off; the total stays at or under the 1015 ceiling', async () => {
  const r = await arrived();
  assert.deepEqual(Object.keys(securityVals.call(r.self, r.ctx())), ['secv']);
  assert.deepEqual(Object.keys(securityVals.call(r.self, { S: { tab: 'home' }, v: {} })), ['secv']);
  const KEYS_AFTER_BATCH_3 = 1010, CEILING = 1015;
  assert.ok(KEYS_AFTER_BATCH_3 + Object.keys(securityVals.call(r.self, r.ctx())).length <= CEILING);
  assert.ok(Object.keys(SEC_OFF).every((k) => k.startsWith('sec')), 'every nested key is sec-prefixed');
});

test('every selftest row gives the same secv key set as the frozen OFF object, with nothing undefined', () => {
  const offKeys = Object.keys(SEC_OFF).sort(), cardKeys = Object.keys(SEC_OFF.secCard).sort();
  const rows = securityStates();
  assert.ok(rows.length >= 20);
  for (const [name, sub, live, st] of rows) {
    const r = rig();
    r.live.security = live;
    r.self.state = { ...r.self.state, sub: { security: sub }, sec: { ...secInit(), ...st } };
    const v = r.vals();
    assert.deepEqual(Object.keys(v).sort(), offKeys, name);
    assert.deepEqual(Object.keys(v.secCard).sort(), cardKeys, name + ' card');
    assert.deepEqual(undefinedPaths(v), [], name);
    assert.equal(v.secShow, true, name);
  }
});

test('the selftest rows cover the states the plan names, with unique names', () => {
  const names = securityStates().map((x) => x[0]);
  assert.equal(new Set(names).size, names.length);
  for (const n of ['security-empty', 'security-no-cli', 'security-map-flags', 'security-breach-not-checked', 'security-locked-labels', 'security-unlock-dialog', 'security-unlock-error', 'security-setup-half', 'security-generator']) assert.ok(names.includes(n), n);
  for (const n of SECURITY_OFFLINE_ROWS) assert.ok(names.includes(n));
});

// ---- honest words --------------------------------------------------------------------------------------------------------
test('breached null renders "not checked" in the health row and on the card, never a clean word', () => {
  const r = rig();
  useRow(r, 'security-breach-not-checked');
  const v = r.vals();
  const row = v.secFlagRows.find((x) => x.key === 'breached');
  assert.equal(row.countText, 'not checked');
  assert.match(v.secBreachLine, /not checked/);
  assert.doesNotMatch(row.countText + row.todo, /\b(none|0)\b/i);
  const all = JSON.stringify(v);
  assert.doesNotMatch(all, BANNED);
  // the card of an account whose status is null says so
  const first = securityFixture({ noBreach: true }).map.accounts[0].id;
  r.self.state = { ...r.self.state, sub: { security: 'map' }, sec: { ...secInit(), sel: first } };
  assert.match(r.vals().secCard.breachText, /not checked/);
});

test('breached true and false are worded as what the check said, a partial check keeps the unchecked count', () => {
  const r = rig();
  useRow(r, 'security-health');
  const v = r.vals();
  assert.equal(v.secFlagRows.find((x) => x.key === 'breached').countText, '1 found');
  const ans = securityFixture();
  ans.map.accounts[1].breached = null;
  r.live.security = { ...r.live.security, map: ans.map, revision: 9 };
  assert.equal(r.vals().secFlagRows.find((x) => x.key === 'breached').countText, '1 found · 1 not checked');
  r.self.state = { ...r.self.state, sub: { security: 'map' }, sec: { ...secInit(), sel: ans.map.accounts[2].id } };
  assert.match(r.vals().secCard.breachText, /found in a breach list/);
  r.self.state = { ...r.self.state, sec: { ...secInit(), sel: ans.map.accounts[0].id } };
  assert.match(r.vals().secCard.breachText, /not found in the breach list at the last check/);
});

test('a locked identity renders "locked - refresh to restore" and ciphertext is never shown', () => {
  const r = rig();
  useRow(r, 'security-locked-labels');
  const v = r.vals();
  assert.equal(v.secHasLocked, true);
  assert.ok(v.secLockedNote.includes(LOCKED_LABEL));
  assert.equal(LOCKED_LABEL, 'locked - refresh to restore');
  assert.ok(v.secNodes.some((n) => n.title.includes(LOCKED_LABEL)));
  assert.ok(v.secCard.hasLocked && v.secCard.lockedText.includes(LOCKED_LABEL));
  // a label that is still ciphertext is treated as locked too
  const ans = securityFixture();
  ans.map.identities[0].label = 'enc:AAAA';
  r.live.security = { ...r.live.security, map: ans.map, revision: 10 };
  const text = JSON.stringify(r.vals());
  assert.ok(!text.includes('enc:AAAA'));
});

test('the hide-from-Claude switch carries the honest sentence; the generator copy note carries the clipboard-history sentence', () => {
  const r = rig();
  useRow(r, 'security-map-card');
  const v = r.vals();
  assert.equal(v.secCard.hideWording, HIDE_WORDING);
  assert.match(v.secCard.hideWording, /hides this account from the hq_footprint tool only; the map file stays readable on this PC by anything that can read this app.s data folder, a Claude session included/);
  assert.match(v.secCard.hideLabel, /Hide from Claude/);
  useRow(r, 'security-generator');
  const g = r.vals();
  assert.equal(g.secGenCopyNote, COPY_NOTE);
  assert.match(g.secGenCopyNote, /cleared from the clipboard after 30 s; that clear cannot reach Windows clipboard history \(Win\+V\) or a cloud clipboard, which may keep a copy, so for a real password prefer KeePassXC.s own generator/);
});

test('flag words: every flag has a label and a what-to-do line, and the health rows list them in the fixed order', () => {
  for (const [k, w] of Object.entries(FLAG_WORDS)) assert.ok(w.label && w.todo, k);
  const r = rig();
  useRow(r, 'security-health');
  const rows = r.vals().secFlagRows;
  assert.deepEqual(rows.map((x) => x.key), ['breached', 'reused', 'weak', 'no2fa', 'old', 'not-in-vault']);
  for (const x of rows) assert.ok(x.todo.length > 10);
});

test('no space file makes a guarantee: the banned words appear in none of the security copy (the rule, run here)', () => {
  const files = [];
  for (const d of ['tpl', 'vals', 'logic']) for (const f of readdirSync(join(SRC, d))) if (/^security/.test(f)) files.push(join(SRC, d, f));
  assert.ok(files.length >= 9, 'files ' + files.length);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), BANNED, f);
  assert.match('this line says ' + BANNED_WORD, BANNED, 'the rule is not vacuous: a planted line is caught');
  assert.doesNotMatch(readFileSync(join(SRC, 'selftest-security.mjs'), 'utf8'), BANNED);
});

// ---- the map -----------------------------------------------------------------------------------------------------------
test('map: nodes, edges, flag dots and archived fading come out of the model', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  const v = r.vals();
  assert.equal(v.secMapReady, true);
  assert.equal(v.secNodes.length, 7 + 2 + 1);   // 7 vault accounts + 2 identities + 1 manual account
  assert.ok(v.secEdges.length >= 8);
  const weak = v.secNodes.find((n) => n.title.includes('example.test') && n.title.startsWith('example.test'));
  assert.ok(weak.hasDots);
  const ident = v.secNodes.filter((n) => n.kindText === 'identity');
  assert.equal(ident.length, 2);
  assert.ok(Number(ident[0].r) > Number(v.secNodes.find((n) => n.kindText === 'account').r) - 1);
  assert.match(v.secStatusLine, /Last refreshed 2026-11-10 · 8 accounts · 2 identities/);
  assert.equal(v.secLegend.length, 3);
});

test('map: clicking a bubble opens its card; clicking it again closes it; Close closes it', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  const first = r.vals().secNodes.find((n) => n.kindText === 'account');
  first.go();
  assert.equal(r.self.state.sec.sel, first.id);
  const card = r.vals().secCard;
  assert.equal(card.show, true);
  assert.equal(card.isAccount, true);
  assert.ok(card.twofa.length === 5 && card.twofa.some((c) => c.pressed === 'true'));
  r.vals().secNodes.find((n) => n.id === first.id).go();
  assert.equal(r.self.state.sec.sel, null);
  first.go();
  card.close();
  assert.equal(r.self.state.sec.sel, null);
});

test('card edits go through hq.security.edit: 2FA chip, sign-in-with chip, recovery chip, hide switch, archive', async () => {
  const r = await arrived();
  const id = securityFixture().map.accounts[0].id;
  r.self.state = { ...r.self.state, sec: { ...secInit(), sel: id } };
  let c = r.vals().secCard;
  await c.twofa.find((x) => x.label === 'Ente Auth').go();
  const parent = securityFixture().map.accounts[2];   // alpha-site.test is provider-like? (no) so only 'its own sign-in' plus none
  assert.ok(c.signIn.length >= 1 && c.signIn[0].label === 'its own sign-in');
  await c.signIn[0].go();
  await c.recovery.find((x) => x.label === 'owner@example.test').go();
  await c.onHide();
  await c.onArchive();
  const edits = r.log.filter((x) => x[0] === 'edit').map((x) => x.slice(1));
  assert.deepEqual(edits, [[id, { twofa: 'ente' }], [id, { signInWith: null }], [id, { recoveryRef: 'i-aaaaaaaaaaaa' }], [id, { hiddenFromClaude: true }], [id, { archived: true }]]);
  void parent;
});

test('card: a provider-like account is offered as a parent, an owner link is shown pressed, a refused edit toasts main\'s words', async () => {
  const ans = securityFixture();
  ans.map.accounts.push({ id: 'k-00000000ffff', title: 'github.test', host: 'github.test', group: 'Root', created: '2025-01-01T00:00:00.000Z', totp: true, passkey: false, strength: 'strong', reuseGroup: null, old: false, identityRef: 'i-aaaaaaaaaaaa', breached: false });
  const r = await arrived({ readAnswer: ans, editAnswer: { error: 'not available here' } });
  const id = ans.map.accounts[0].id;
  r.self.state = { ...r.self.state, sec: { ...secInit(), sel: id } };
  const c = r.vals().secCard;
  assert.ok(c.signIn.some((x) => x.label === 'github.test'));
  assert.equal(c.hasSignInNote, false);
  await c.signIn.find((x) => x.label === 'github.test').go();
  assert.deepEqual(r.toasts.at(-1), ['error', 'not available here']);
  // the fixture's own owner link (beta-shop.test signs in with alpha-site.test) shows as pressed, and a missing provider says so
  const beta = ans.map.accounts[3].id;
  r.self.state = { ...r.self.state, sec: { ...secInit(), sel: beta } };
  const b = r.vals().secCard;
  assert.ok(b.twofa.find((x) => x.label === 'SMS').pressed === 'true');
  assert.ok(b.recovery.find((x) => x.label === 'owner@example.test').pressed === 'true');
});

test('an identity card says how many accounts use it and how many recover through it', () => {
  const r = rig();
  useRow(r, 'security-map-card-identity');
  const c = r.vals().secCard;
  assert.equal(c.isIdentity, true);
  assert.match(c.usesText, /\d+ accounts? use(s)? it/);
  assert.match(c.usesText, /1 account recovers through it/);
  assert.equal(c.isAccount, false);
});

test('the layout is memoised on the revision and the slider: the same memo object across renders, a new one after a change', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  r.vals();
  const m1 = r.self._secMemo;
  r.vals();
  assert.equal(r.self._secMemo, m1);
  r.self.state = { ...r.self.state, sec: { ...r.self.state.sec, sel: 'k-000000000001' } };
  r.vals();
  assert.equal(r.self._secMemo, m1, 'selecting a bubble does not lay the graph out again');
  r.live.security = { ...r.live.security, revision: 2 };
  r.vals();
  assert.notEqual(r.self._secMemo, m1);
});

test('the time slider: stops from the creation days, a day shows fewer bubbles, "Show everything" restores them', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  const all = r.vals();
  assert.equal(all.secSliderShow, true);
  assert.ok(all.secSliderMax >= 5);
  assert.match(all.secSliderLabel, /^Showing everything \(2025-02-10 to 2026-08-25\)$/);
  r.self.secSlide({ target: { value: '1' } });
  const early = r.vals();
  assert.ok(early.secNodes.length < all.secNodes.length);
  assert.match(early.secSliderLabel, /^Showing accounts created on or before 2025-04-02$/);
  assert.equal(early.secShowAllShow, true);
  early.secShowAll();
  assert.equal(r.vals().secNodes.length, all.secNodes.length);
  assert.equal(r.self.state.sec.slider, null);
});

test('growth line: numbers only, with a path once two refreshes are kept', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  const v = r.vals();
  assert.equal(v.secGrowthShow, true);
  assert.match(v.secGrowthText, /7 accounts on 2 identities, \d+ flags · first kept 2026-10-20: 5 accounts, \d+ flags · 3 refreshes kept/);
  assert.equal(v.secGrowthHasPath, true);
  assert.match(v.secGrowthAcc, /^M/);
});

test('a big vault folds: the fold sentence is said and the bubble count stays within the limit', () => {
  const r = rig();
  useRow(r, 'security-map-folded');
  const v = r.vals();
  assert.ok(v.secNodes.length <= 600, 'nodes ' + v.secNodes.length);
  assert.equal(v.secHasFold, true);
  assert.match(v.secFoldText, /folded into/);
  assert.ok(v.secNodes.filter((n) => n.kindText === 'folded').length >= 1);
  const more = v.secNodes.find((n) => n.kindText === 'folded');
  more.go();   // a folded bubble opens nothing
  assert.equal(r.self.state.sec.sel, null);
  assert.equal(v.secNodes.filter((n) => n.showLabel).length >= 2, true);
});

test('honest empty and error states: offline, loading, error with the last map kept, no vault chosen, no cli', async () => {
  const off = rig({ noHq: true });
  assert.equal(off.vals().secOffline, true);
  assert.match(off.vals().secOfflineText, /needs the desktop app/);
  const load = rig();
  assert.equal(load.vals().secLoading, true);
  const e = rig();
  useRow(e, 'security-error-with-map');
  assert.match(e.vals().secErrText, /The last copy stays on screen/);
  assert.equal(e.vals().secMapReady, true);
  const noVault = rig();
  useRow(noVault, 'security-empty');
  const nv = noVault.vals();
  assert.equal(nv.secMapEmpty, true);
  assert.equal(nv.secMapEmptyText, SEC_TEXT.needVault);
  assert.equal(nv.secRefreshOff, true);
  assert.equal(nv.secRefreshWhy, SEC_TEXT.noVaultPath);
  const noCli = rig();
  useRow(noCli, 'security-no-cli');
  assert.equal(noCli.vals().secRefreshWhy, SEC_TEXT.noCli);
  assert.equal(noCli.vals().secRefreshOff, true);
  const ready = rig();
  useRow(ready, 'security-map-flags');
  assert.equal(ready.vals().secRefreshOff, false);
});

// ---- add forms -----------------------------------------------------------------------------------------------------------
test('Add account: the fields are read from the DOM at submit, sent as names only, then emptied', async () => {
  const r = await arrived();
  r.self.secOpenForm('account');
  assert.equal(r.vals().secFormAccount, true);
  const t = field(r, 'title', '  alpha-site  '), h = field(r, 'host', 'alpha-site.test');
  const res = await r.self.secSubmitForm();
  assert.equal(res.ok, true);
  assert.deepEqual(r.log.filter((x) => x[0] === 'addManual')[0][1], { title: 'alpha-site', host: 'alpha-site.test' });
  assert.equal(t.value, ''); assert.equal(h.value, '');
  assert.equal(r.self.state.sec.form, null);
  assert.equal(r.self.state.sec.note, 'Account added.');
});

test('Add identity: kind and value from the DOM; main\'s refusal is shown in words and the form stays open', async () => {
  const r = await arrived({ addIdAnswer: { error: 'not an email or phone number' } });
  r.self.secOpenForm('identity');
  field(r, 'idkind', 'phone'); field(r, 'idvalue', 'nonsense');
  const res = await r.self.secSubmitForm();
  assert.equal(res.error, 'not an email or phone number');
  assert.deepEqual(r.log.filter((x) => x[0] === 'addIdentity')[0][1], { kind: 'phone', value: 'nonsense' });
  const v = r.vals();
  assert.equal(v.secHasFormErr, true);
  assert.equal(v.secFormErr, 'not an email or phone number');
  assert.equal(v.secFormIdentity, true);
  assert.equal(r.self.state.sec.busy, false);
});

// ---- health ----------------------------------------------------------------------------------------------------------
test('health: the flagged list, the export files worded as a guess, per-file Recycle Bin, the conflict sentence', async () => {
  const r = await arrived();
  r.self.setSub('health');
  const v = r.vals();
  assert.equal(v.secSubHealth, true);
  assert.ok(v.secHasFlagged && v.secFlagged.length >= 4);
  assert.ok(v.secFlagged[0].flagsText.length > 0);
  assert.equal(v.secHasExports, true);
  assert.equal(v.secExports.length, 1);
  assert.equal(v.secExports[0].wording, EXPORT_WORDING);
  assert.equal(EXPORT_WORDING, 'may be a plain password export');
  assert.match(v.secExportsNote, /A name match is a guess: the file is never opened/);
  await v.secExports[0].trash();
  assert.deepEqual(r.log.find((x) => x[0] === 'trash').slice(1), ['Chrome Passwords.csv', 'C:/placeholder/Downloads']);
  assert.equal(r.toasts.at(-1)[0], 'success');
  assert.equal(v.secConflictShow, true);
  assert.equal(CONFLICT_WORDING, 'Syncthing made a conflict copy: open both in KeePassXC and merge (Database > Merge)');
  assert.equal(v.secConflictText, CONFLICT_WORDING);
  assert.equal(v.secConflictCount, '1 conflict copy');
});

test('health: a flagged account jumps to the map with its card open', () => {
  const r = rig();
  useRow(r, 'security-health');
  const v = r.vals();
  v.secFlagged[0].go();
  assert.equal(r.self.state.sub.security, 'map');
  assert.equal(r.self.state.sec.sel, v.secFlagged[0].id);
});

test('health: clean states are said in words (no exports, no conflict copy, no flags)', () => {
  const r = rig();
  useRow(r, 'security-health-clean');
  const v = r.vals();
  assert.equal(v.secConflictShow, false);
  assert.equal(v.secHasExports, false);
  assert.equal(v.secExportsNote, SEC_TEXT.exportsNone);
  const never = rig();
  useRow(never, 'security-empty');
  never.self.setSub('health');
  assert.equal(never.vals().secExportsNote, SEC_TEXT.exportsNever);
  assert.equal(never.vals().secHasNoFlags, true);
  assert.match(never.vals().secNoFlagsText, /Nothing to check yet/);
});

// ---- setup -----------------------------------------------------------------------------------------------------------
test('setup: the ten steps in the fixed order; app-checked steps say what they checked, owner-ticked ones say who ticked', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['email-2fa', 'install-keepassxc', 'create-vault', 'emergency-sheet', 'import-browser', 'phone-keepassdx', 'syncthing', 'ente-auth', 'import-authenticator', 'first-refresh']);
  const r = rig();
  useRow(r, 'security-setup-half');
  const v = r.vals();
  assert.deepEqual(v.secSteps.map((s) => s.id), STEPS.map((s) => s.id));
  const by = Object.fromEntries(v.secSteps.map((s) => [s.id, s]));
  assert.equal(by['email-2fa'].check, 'you ticked this');
  assert.equal(by['email-2fa'].done, true);
  assert.equal(by['phone-keepassdx'].check, 'not ticked yet');
  assert.equal(by['phone-keepassdx'].done, false);
  assert.equal(by['install-keepassxc'].check, 'checked by the app: keepassxc-cli was found');
  assert.equal(by['create-vault'].check, 'checked by the app: the chosen vault file exists');
  assert.match(by['first-refresh'].check, /^checked by the app: refreshed on 2026-11-10$/);
  assert.equal(by['install-keepassxc'].canTick, false);
  assert.equal(by['email-2fa'].canTick, true);
  assert.match(by['import-browser'].extra, /1 file is still there and may be a plain password export: see Health/);
  assert.match(by.syncthing.extra, /1 conflict copy next to the vault file/);
  assert.equal(v.secStepsDone, '5 of 10 steps done'.replace('5', String(v.secSteps.filter((s) => s.done).length)));
  const fresh = secSteps({ settings: {}, status: null, cliFound: false, vaultExists: false, map: null, exports: [] });
  const f = Object.fromEntries(fresh.map((s) => [s.id, s]));
  assert.equal(f['install-keepassxc'].check, 'checked by the app: keepassxc-cli was not found');
  assert.equal(f['create-vault'].check, 'checked by the app: no vault file chosen yet');
  assert.equal(f['first-refresh'].check, 'checked by the app: not refreshed yet');
  assert.match(f['import-browser'].extra, /^No plain export left/);
  assert.match(f.syncthing.extra, /not been looked for yet/);
});

test('setup: ticking an owner step flips it through hq.security.walkthrough; an app-checked step cannot be ticked', async () => {
  const r = await arrived();
  r.self.setSub('setup');
  const step = (id) => r.vals().secSteps.find((s) => s.id === id);
  await step('phone-keepassdx').tick();
  assert.deepEqual(r.log.find((x) => x[0] === 'walkthrough').slice(1), ['phone-keepassdx', true]);
  await step('email-2fa').tick();   // already ticked in the fixture: unticks
  assert.deepEqual(r.log.filter((x) => x[0] === 'walkthrough')[1].slice(1), ['email-2fa', false]);
  const refused = await r.self.secTick('install-keepassxc');
  assert.deepEqual(refused, { error: 'only you can tick that step' });
  assert.equal(r.log.filter((x) => x[0] === 'walkthrough').length, 2);
});

test('setup: the vault path is read from the field at click time; a refused path is shown in words', async () => {
  const r = await arrived({ settingsAnswer: { error: 'the vault path must end in .kdbx' } });
  r.self.setSub('setup');
  assert.equal(r.vals().secVaultValue, 'C:/placeholder/vault/example.kdbx');
  field(r, 'vaultpath', 'C:/placeholder/other.txt');
  const res = await r.self.secSavePath();
  assert.deepEqual(r.log.find((x) => x[0] === 'settings')[1], { vaultPath: 'C:/placeholder/other.txt' });
  assert.equal(res.error, 'the vault path must end in .kdbx');
  assert.equal(r.vals().secVaultErr, 'the vault path must end in .kdbx');
  assert.equal(r.vals().secHasVaultErr, true);
});

test('setup: the emergency sheet is blank lines only and never carries a bit of the app\'s data', () => {
  const r = rig();
  useRow(r, 'security-setup-sheet');
  const v = r.vals();
  assert.equal(v.secSheetOpen, true);
  assert.ok(v.secSheetLines.length >= 6);
  for (const l of v.secSheetLines) assert.equal(l.line, '');
  const text = JSON.stringify([v.secSheetLines, v.secSheetTitle, v.secSheetHelp]);
  for (const s of ['example.test', 'acme.test', 'alpha-site', 'owner@example.test', 'placeholder', '.kdbx', PASS]) assert.ok(!text.includes(s), s);
  v.secSheetClose();
  assert.equal(r.self.state.sec.sheet, false);
});

// ---- unlock: the uncontrolled passphrase input ---------------------------------------------------------------------------
test('Refresh opens the dialog; the dialog values carry the breach checkbox default ON and its exact wording', () => {
  const r = rig();
  useRow(r, 'security-map-flags');
  r.vals().secRefreshOpen();
  const v = r.vals();
  assert.equal(v.secDlgOpen, true);
  assert.equal(v.secDlgBreaches, true);
  assert.equal(v.secDlgBreachText, 'check breaches online (Have I Been Pwned, 5 hash characters leave the PC)');
  assert.equal(r.vals().secRefreshOff, true, 'Refresh is not offered twice');
  v.secDlgToggle({ target: { checked: false } });
  const off = r.vals();
  assert.equal(off.secDlgBreaches, false);
  assert.equal(off.secDlgOffShow, true);
});

test('unlock-clears: the typed passphrase is never in the state, the vals, or storage, and the field is empty after send, error and cancel', async () => {
  const r = await arrived();
  const storage = { 'whq3-place': JSON.stringify({ tab: 'security' }) };
  const leaks = (step) => assert.deepEqual(passphraseLeaks(PASS, { state: r.self.state, vals: r.vals(), storage, live: r.live.security }), [], 'leak at ' + step);
  // opened, nothing typed
  r.self.secOpenUnlock(); leaks('open');
  // typed (only the DOM element holds it)
  const el = field(r, 'pass', 'wrong horse example'); leaks('typed');
  const wrong = 'wrong horse example';
  const p = r.self.secSubmitUnlock();
  assert.equal(el.value, '', 'emptied in the same tick the call was made');
  leaks('in flight');
  assert.equal(r.vals().secDlgBusy, true);
  const res = await p;
  assert.deepEqual(res, { error: WRONG_PASSPHRASE_ERROR });
  assert.equal(el.value, '', 'empty after an error');
  assert.equal(r.vals().secDlgErr, WRONG_PASSPHRASE_ERROR);
  assert.equal(r.vals().secDlgOpen, true, 'the dialog stays open after an error');
  assert.deepEqual(passphraseLeaks(wrong, { state: r.self.state, vals: r.vals(), storage }), []);
  // the right one
  el.value = PASS; leaks('typed again');
  const ok = await r.self.secSubmitUnlock();
  assert.equal(ok.ok, true);
  assert.equal(el.value, '', 'empty after success');
  assert.equal(r.vals().secDlgOpen, false);
  leaks('done');
  assert.match(r.self.state.sec.note, /^Refreshed, breach check done/);
  // cancel path
  r.self.secOpenUnlock(); el.value = PASS; r.self.secCancelUnlock();
  assert.equal(el.value, '', 'empty after cancel');
  assert.equal(r.vals().secDlgOpen, false);
  leaks('cancelled');
  // nothing about the passphrase reached a toast, a mark or the log of mark calls
  assert.deepEqual(passphraseLeaks(PASS, { toasts: r.toasts, marks: r.marks }), []);
});

test('the unlock call hands the passphrase to hq.security.refresh exactly once, with the checkbox value, and marks security-refresh', async () => {
  const r = await arrived();
  const seen = [];
  r.hq.security.refresh = async (...a) => { seen.push(a); return { ok: true, accounts: 1, breachChecked: false, notes: [] }; };
  r.self.secOpenUnlock();
  r.self.secToggleBreaches({ target: { checked: false } });
  field(r, 'pass', PASS);
  await r.self.secSubmitUnlock();
  assert.deepEqual(seen, [[PASS, false]]);
  assert.deepEqual(r.marks.filter((m) => m[0] === 'security-refresh'), [['security-refresh', 'act']]);
  assert.match(r.self.state.sec.note, /breach check off or not finished/);
});

test('an empty field, a missing store function and a double press never reach main', async () => {
  const r = await arrived();
  r.self.secOpenUnlock();
  field(r, 'pass', '');
  const empty = await r.self.secSubmitUnlock();
  assert.deepEqual(empty, { error: 'empty' });
  assert.equal(r.vals().secDlgErr, 'Type the master passphrase first.');
  assert.equal(r.log.filter((x) => x[0] === 'refresh').length, 0);
  const el = field(r, 'pass', PASS);
  const a = r.self.secSubmitUnlock(), b = r.self.secSubmitUnlock();
  assert.equal(await b, null, 'the second press while busy is ignored');
  await a;
  assert.equal(r.log.filter((x) => x[0] === 'refresh').length, 1);
  assert.equal(el.value, '');
  const bare = rig();
  bare.self.store = {};
  bare.self.secOpenUnlock();
  assert.deepEqual(await bare.self.secSubmitUnlock(), { error: 'Security needs the desktop app' });
});

test('cancel while a refresh is running keeps the dialog (the answer decides), but the field is still emptied', async () => {
  const r = await arrived();
  let release;
  r.hq.security.refresh = () => new Promise((res) => { release = res; });
  r.self.secOpenUnlock();
  const el = field(r, 'pass', PASS);
  const p = r.self.secSubmitUnlock();
  await new Promise((res) => setTimeout(res, 0));
  el.value = 'typed after sending';
  r.self.secCancelUnlock();
  assert.equal(el.value, '');
  assert.equal(r.vals().secDlgOpen, true);
  release({ error: 'a refresh is already running' });
  await p;
  assert.equal(r.vals().secDlgErr, 'a refresh is already running');
});

test('the dialog key handler: Enter submits, Escape cancels and stops the key before the app-wide Escape sees it', async () => {
  const r = await arrived();
  r.self.secOpenUnlock();
  const el = field(r, 'pass', PASS);
  const ev = (key) => { const e = { key, stopped: false, prevented: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } }; return e; };
  const esc = ev('Escape');
  r.vals().secDlgKey(esc);
  assert.ok(esc.stopped && esc.prevented);
  assert.equal(r.vals().secDlgOpen, false);
  assert.equal(el.value, '');
  r.self.secOpenUnlock(); el.value = PASS;
  r.vals().secDlgKey(ev('Enter'));
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(r.log.filter((x) => x[0] === 'refresh').length, 1);
  r.vals().secDlgKey(ev('a'));
  r.vals().secDlgKey(null);
});

test('security.js source: the passphrase is read in one place, never put in state, storage or the console', () => {
  const src = readFileSync(join(SRC, 'logic/security.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/console\./.test(src), 'a console call in logic/security.js');
  assert.ok(!/sessionStorage|localStorage/.test(src), 'storage in logic/security.js');
  assert.equal((src.match(/\.value\b/g) || []).filter(Boolean).length > 0, true);
  const sends = src.match(/_secEl\('pass'\)/g) || [];
  assert.equal(sends.length, 2, 'the pass field is touched only by _secClearPass and _secSend');
  const vals = readFileSync(join(SRC, 'vals/security.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/passphrase\s*:/.test(vals) && !/\.value\b/.test(vals), 'vals must not read or hold a typed value');
});

// ---- arrival, generator -------------------------------------------------------------------------------------------------
test('arrival reads once (and scans exports once), marks "security" once, and drops a generated password, a dialog and the sheet', async () => {
  const r = rig();
  assert.deepEqual(r.log, [], 'building the component read nothing');
  r.self.state = { ...r.self.state, sec: { ...secInit(), dlg: { busy: false, error: '', breaches: true }, sheet: true, gen: { ...secInit().gen, out: { text: 'amber-pier-quiet', bits: 1, kind: 'words' } } } };
  const el = field(r, 'pass', 'leftover');
  await r.self.secArrive();
  assert.equal(r.log.filter((x) => x[0] === 'read').length, 1);
  assert.equal(r.log.filter((x) => x[0] === 'scan').length, 1);
  assert.deepEqual(r.marks, [['security', 'open']]);
  assert.equal(r.self.state.sec.dlg, null);
  assert.equal(r.self.state.sec.sheet, false);
  assert.equal(r.self.state.sec.gen.out, null);
  assert.equal(el.value, '');
  const bare = rig({ noHq: true });
  bare.self.store = {};
  assert.deepEqual(await bare.self.secArrive(), { error: 'Security needs the desktop app' });
});

test('generator: Generate makes a passphrase of 7 words by default; chars follow the toggles; Copy sends it to main and says the clipboard sentence', async () => {
  const r = await arrived();
  r.self.setSub('generate');
  let v = r.vals();
  assert.equal(v.secSubGen, true);
  assert.equal(v.secGenHasOut, false);
  assert.match(v.secGenBits, /^about \d+(\.\d)? bits of entropy$/);
  v.secGenDo();
  v = r.vals();
  assert.equal(v.secGenHasOut, true);
  const parts = v.secGenOut.split('-');
  assert.equal(parts.length, 7);
  for (const w of parts) assert.ok(WORDS.includes(w), w);
  assert.match(v.secGenOutBits, /^about \d/);
  assert.equal(v.secGenDoLabel, 'Generate another');
  await v.secGenCopy();
  assert.deepEqual(r.log.find((x) => x[0] === 'copy').slice(1), [v.secGenOut]);
  assert.ok(r.vals().secGenNote.includes('Windows clipboard history (Win+V) or a cloud clipboard'));
  // chars
  r.vals().secGenKinds[1].go();
  assert.equal(r.vals().secGenHasOut, false, 'changing the kind drops the old output');
  r.vals().secGenSets.find((s) => s.name === 'symbols').toggle();
  r.vals().secGenDo();
  v = r.vals();
  assert.equal(v.secGenOut.length, 20);
  assert.ok(/^[A-Za-z0-9]+$/.test(v.secGenOut), 'symbols are off: ' + v.secGenOut);
  v.secGenOnLen({ target: { value: '32' } });
  assert.equal(r.vals().secGenLen, 32);
  assert.equal(r.vals().secGenHasOut, false);
  r.vals().secGenDo();
  assert.equal(r.vals().secGenOut.length, 32);
  r.vals().secGenClear();
  assert.equal(r.vals().secGenHasOut, false);
  assert.equal(r.self.state.sec.gen.out, null);
});

test('generator: every kind switched off says so in words and copies nothing; a copy refused by main shows its words', async () => {
  const r = await arrived();
  r.self.setSub('generate');
  r.vals().secGenKinds[1].go();
  for (const n of ['lower', 'upper', 'digits', 'symbols']) r.vals().secGenSets.find((s) => s.name === n).toggle();
  r.vals().secGenDo();
  const v = r.vals();
  assert.equal(v.secGenHasErr, true);
  assert.equal(v.secGenErr, 'pick at least one kind of character');
  assert.equal(v.secGenHasOut, false);
  assert.equal(v.secGenBits, 'no character kind is on');
  assert.deepEqual(await r.self.secGenCopy(), { error: 'nothing generated yet' });
  r.self.state = { ...r.self.state, sec: { ...secInit(), gen: { ...secInit().gen, out: { text: 'x-y-z', bits: 1, kind: 'words' } } } };
  r.hq.security.copy = async () => ({ error: 'not available here' });
  await r.self.secGenCopy();
  assert.equal(r.vals().secGenErr, 'not available here');
});

// ---- the template against the vals ------------------------------------------------------------------------------------
const FRAGMENTS = { 'tpl/security.tpl.js': tplDefault };
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const bindings = (t) => [...t.matchAll(/\{\{([\s\S]+?)\}\}/g)].map((m) => m[1].trim());
const loops = (t) => [...t.matchAll(/<sc-for\b[^>]*?\blist="\{\{\s*([^}]+?)\s*\}\}"[^>]*?\bas="([^"]+)"/g)].map((m) => ({ list: m[1], as: m[2] }));
function paths(expr) {
  return expr.split(/===|!==|==|!=/).map((s) => s.trim().replace(/^!+/, '').replace(/^\(|\)$/g, '').trim())
    .filter((s) => s && !/^(true|false|null|undefined)$/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) && !/^(['"]).*\1$/.test(s));
}
const isEmpty = (x) => x === undefined || x === null || x === '' || x === false || (Array.isArray(x) && x.length === 0);

// every sub-view, with the card, the dialog and the sheet open, merged so each list has an item to check the loop variables against
function populated() {
  const r = rig();
  const ON = {};
  const take = (v) => { for (const [k, x] of Object.entries(v)) if (!(k in ON) || isEmpty(ON[k])) ON[k] = x; };
  const first = securityFixture().map.accounts[0].id;   // weak, reused and no 2FA recorded: its card lists flags
  const set = (name, extra) => { useRow(r, name); r.self.state = { ...r.self.state, sec: { ...r.self.state.sec, ...(extra || {}) } }; take(r.vals()); };
  set('security-map-card', { sel: first, dlg: { busy: false, error: 'x', breaches: true }, form: 'identity', formErr: 'e', sheet: true });
  set('security-health', { sheet: true });
  set('security-setup-sheet', { dlg: { busy: false, error: 'x', breaches: false } });
  set('security-generator-chars', {});
  r.self.state = { ...r.self.state, sub: { security: 'map' }, sec: { ...secInit(), sel: first, form: 'account' } };
  useRow(r, 'security-map-flags');
  r.self.state = { ...r.self.state, sec: { ...secInit(), sel: first, form: 'account' } };
  take(r.vals());
  return { secv: ON };
}

test('the template reads only secv.* keys (and its loop variables), all present in the frozen OFF object too', () => {
  const ON = populated();
  const t = tplDefault, vars = new Set(loops(t).map((l) => l.as));
  for (const b of bindings(t)) {
    for (const p of paths(b)) {
      const root = p.match(/^[A-Za-z_$][\w$]*/);
      assert.ok(root, 'cannot read a root from {{ ' + b + ' }}');
      if (vars.has(root[0])) continue;
      assert.equal(root[0], 'secv', '{{ ' + b + ' }} reads outside secv');
      const m = /^secv\.(sec\w+)(?:\.(\w+))?$/.exec(p);
      assert.ok(m, '{{ ' + b + ' }} is not secv.<key>[.<key>]');
      assert.ok(Object.prototype.hasOwnProperty.call(ON.secv, m[1]), '{{ ' + b + ' }} is not a key of the vals');
      assert.ok(Object.prototype.hasOwnProperty.call(SEC_OFF, m[1]), '{{ ' + b + ' }} is not a key of the frozen OFF vals');
      if (m[2]) assert.ok(Object.prototype.hasOwnProperty.call(SEC_OFF[m[1]], m[2]), '{{ ' + b + ' }} is not a key of the OFF card');
    }
  }
});

test('every binding resolves (not undefined) against the populated vals, loop items included - the selftest hole check, run here', () => {
  const ON = populated();
  const scope = { ...ON };
  for (const l of loops(tplDefault)) {
    let list = resolve(scope, l.list);
    if (l.as === 'n') { list = ON.secv.secNodes.filter((n) => n.dots.length > 0); assert.ok(list.length > 0, 'a node with a flag dot'); }
    assert.ok(Array.isArray(list) && list.length > 0, 'the populated vals must give ' + l.list + ' an item to check ' + l.as + '.* against');
    scope[l.as] = list[0];
  }
  const holes = bindings(tplDefault).filter((b) => resolve(scope, b) === undefined);
  assert.deepEqual(holes, []);
});

test('every event attribute and every ref is bound to a function in the vals', () => {
  const ON = populated();
  const scope = { ...ON };
  for (const l of loops(tplDefault)) scope[l.as] = (l.as === 'n' ? ON.secv.secNodes.filter((n) => n.dots.length > 0) : resolve(scope, l.list))[0];
  const attrs = [...stripComments(tplDefault).matchAll(/\s(on[A-Z]\w*|ref)="\{\{\s*([^}]+?)\s*\}\}"/g)];
  assert.ok(attrs.length > 30, 'handlers ' + attrs.length);
  for (const m of attrs) assert.equal(typeof resolve(scope, m[2]), 'function', m[1] + '="{{ ' + m[2] + ' }}" is not a function in the vals');
});

test('loop variable names are unique; the fragment halves join into the default; no window. or fetch', () => {
  const names = loops(tplDefault).map((l) => l.as);
  assert.equal(new Set(names).size, names.length, names.join(','));
  assert.equal(tplDefault, tplSpace + tplOverlays);
  assert.ok(!/window\.|fetch\(/.test(stripComments(tplDefault)));
  assert.ok(tplDefault.length > 8000);
});

test('the passphrase input is uncontrolled: type password, no value binding, no change or input handler, autocomplete and spellcheck off', () => {
  const m = /<input\b[^>]*data-sec="pass"[^>]*>/.exec(tplOverlays);
  assert.ok(m, 'the passphrase input');
  const tag = m[0];
  assert.match(tag, /type="password"/);
  assert.match(tag, /autocomplete="off"/);
  assert.match(tag, /spellcheck="false"/);
  assert.doesNotMatch(tag, /\bvalue=/);
  assert.doesNotMatch(tag, /\bon[A-Z]\w*=/);
  assert.match(tag, /ref="\{\{ secv\.secPassRef \}\}"/);
  // it is the only password input in the whole fragment
  assert.equal((tplDefault.match(/type="password"/g) || []).length, 1);
});

test('no select holds a loop (the HTML parser drops an unknown tag inside select); buttons are typed; dialogs are labelled and stacked above the app', () => {
  for (const sel of tplDefault.match(/<select\b[\s\S]*?<\/select>/g) || []) assert.ok(!/<sc-for/.test(sel), 'a loop inside a select');
  for (const b of stripComments(tplDefault).match(/<button\b[^>]*>/g) || []) assert.match(b, /type="button"/, b.slice(0, 80));
  assert.match(tplOverlays, /role="dialog"[^>]*aria-label="Unlock the vault"/);
  assert.match(tplOverlays, /role="dialog"[^>]*aria-label="Emergency sheet"/);
  assert.match(tplOverlays, /z-index:1150/);
  assert.match(tplOverlays, /z-index:1140/);
  assert.ok(!/<img\b|<script|<iframe|src=|href=|http:|https:/.test(tplDefault), 'no external reference in the fragment');
});

test('the dialog is rendered by the main window state only: the frozen OFF object has no open dialog, and its handlers do nothing', () => {
  assert.equal(SEC_OFF.secDlgOpen, false);
  assert.equal(SEC_OFF.secSheetOpen, false);
  assert.equal(SEC_OFF.secShow, false);
  assert.doesNotThrow(() => { SEC_OFF.secDlgSubmit(); SEC_OFF.secDlgCancel(); SEC_OFF.secRefreshOpen(); SEC_OFF.secDlgStop({ stopPropagation() {} }); SEC_OFF.secDlgStop(); });
});

test('passphraseLeaks finds a leak (the check is not vacuous) and refuses a too-short probe', () => {
  assert.deepEqual(passphraseLeaks('correct horse example', { state: { a: 'xx correct horse example xx' }, vals: { b: 1 } }), ['state']);
  assert.deepEqual(passphraseLeaks('correct horse example', { vals: { f: () => 'correct horse example' } }), []);
  assert.equal(passphraseLeaks('ab', {}).length, 1);
});

// ---- Escape closes the unlock dialog and the emergency sheet, even when focus is outside them (batch 4 taster fix) ----------------
test('secEscape: closes the unlock dialog (clearing the typed passphrase), not while a refresh runs; then the sheet; else false', async () => {
  const r = await arrived();
  assert.equal(r.self.secEscape(), false, 'nothing open');
  const el = { value: '' }; r.self._secEl = (k) => (k === 'pass' ? el : null);
  r.self.secOpenUnlock(); el.value = PASS;
  assert.equal(r.self.secEscape(), true);
  assert.equal(r.self.secState().dlg, null);
  assert.equal(el.value, '', 'the typed passphrase is cleared');
  r.self.secOpenUnlock(); r.self._secPatch({ dlg: { ...r.self.secState().dlg, busy: true } });
  assert.equal(r.self.secEscape(), true, 'eaten while busy');
  assert.ok(r.self.secState().dlg, 'the dialog stays while a refresh runs');
  r.self._secPatch({ dlg: null });
  r.self.secOpenSheet();
  assert.equal(r.self.secEscape(), true);
  assert.equal(r.self.secState().sheet, false);
  assert.equal(r.self.secEscape(), false);
});

test('app.js closeTop asks secEscape first, before every other overlay', () => {
  const src = readFileSync(join(SRC, 'app.js'), 'utf8');
  const i = src.indexOf('closeTop() {');
  assert.ok(i > 0);
  const body = src.slice(i, src.indexOf('onKey(e) {', i));
  assert.ok(body.indexOf('this.secEscape()') > 0 && body.indexOf('this.secEscape()') < body.indexOf("const order = ["), 'secEscape runs before the overlay list');
});
