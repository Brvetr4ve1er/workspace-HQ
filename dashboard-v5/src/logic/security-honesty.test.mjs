// Security honesty pass: the clipboard and hide-from-Claude sentences, pinned once. Placeholder text only; no IPC, no DOM, no network.
//   node --test dashboard-v5/src/logic/security-honesty.test.mjs
//
// Two parts:
//  1. WANTED: the sentences as the spec words them (docs/audits/2026-11-13-batch5-plan.json, dish security-honesty), checked for the
//     properties that make them honest. Self-contained.
//  2. LIVE: the constants the renderer really shows (logic/security.js COPY_NOTE / HIDE_WORDING, vals/security.js SEC_TEXT.unlockHelp,
//     the copy toast). These stay red until the shared edits of this dish land; that is their job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_NOTE, HIDE_WORDING, securityLogic, lookedLine } from './security.js';
import { SEC_TEXT } from '../vals/security.js';

const WANT_COPY = 'cleared from the clipboard after 30 s; that clear cannot reach Windows clipboard history (Win+V) or a cloud clipboard, which may keep a copy, so for a real password prefer KeePassXC’s own generator';
const WANT_UNLOCK = 'Type it, never copy it: the app’s 30 s clipboard clear cannot reach Windows clipboard history (Win+V) or a cloud clipboard.';
const WANT_HIDE = 'hides this account from the hq_footprint tool only; the map file stays readable on this PC by anything that can read this app’s data folder, a Claude session included';

// a sentence must never say the clear removes anything from history or the cloud
const REMOVAL_VERB = /\b(clears|removes|erases|wipes|deletes|removed|erased|wiped|deleted|cleared from)\b[^.;]{0,40}(clipboard history|win\+v|cloud clipboard)/i;
const claimsRemoval = (t) => REMOVAL_VERB.test(t) && !/\b(cannot|can't|never|does not|may keep)\b/i.test(t);
const apos = (s) => s.replace(/’/g, "'");

function copyProps(text, label) {
  assert.ok(text.includes('Win+V'), label + ': Win+V');
  assert.ok(text.includes('cloud clipboard'), label + ': cloud clipboard');
  assert.ok(text.includes('30 s'), label + ': the 30 s');
  assert.ok(!claimsRemoval(text), label + ': claims removal from history');
}

test('the removal-claim check catches a dishonest sentence and passes an honest one', () => {
  assert.ok(claimsRemoval('the copy is removed from Windows clipboard history after 30 s'));
  assert.ok(claimsRemoval('Clears it from the cloud clipboard too'));
  assert.ok(!claimsRemoval(WANT_COPY));
});

test('WANTED: the three clipboard sentences carry Win+V and cloud clipboard and never claim removal', () => {
  copyProps(WANT_COPY, 'copy note');
  copyProps(WANT_UNLOCK, 'unlock help');
  copyProps('Copied; ' + WANT_COPY + '.', 'toast');
  assert.match(WANT_COPY, /prefer KeePassXC.s own generator/);
  assert.match(WANT_UNLOCK, /never copy it/);
});

test('WANTED: the hide wording says the tool only and that the map file stays readable', () => {
  assert.ok(WANT_HIDE.includes('hq_footprint tool only'));
  assert.ok(WANT_HIDE.includes('stays readable on this PC'));
  assert.ok(WANT_HIDE.includes('a Claude session included'));
});

test('LIVE: COPY_NOTE carries Win+V and cloud clipboard and never claims the clear reaches history', () => {
  copyProps(COPY_NOTE, 'COPY_NOTE');
  assert.equal(apos(COPY_NOTE), apos(WANT_COPY));
});

test('LIVE: the unlock dialog help carries the clipboard sentence and keeps the passphrase words', () => {
  const t = SEC_TEXT.unlockHelp;
  assert.ok(t.includes('Win+V') && t.includes('cloud clipboard'), 'unlockHelp: Win+V and cloud clipboard');
  assert.ok(apos(t).includes(apos(WANT_UNLOCK)), 'unlockHelp: the spec sentence');
  assert.ok(!claimsRemoval(t));
  assert.match(t, /standard input/);
  assert.match(t, /emptied as soon as it is sent/);
});

test('LIVE: the copy toast is "Copied; " + COPY_NOTE and carries Win+V and cloud clipboard', async () => {
  const state = { gen: { out: { text: 'example-text', bits: 1, kind: 'words' }, note: '', err: '' } };
  const self = {
    secState: () => state,
    _secPatch(p) { Object.assign(state, p); },
    store: { copySecurity: async () => ({ ok: true }) },
  };
  const r = await securityLogic.secGenCopy.call(self);
  assert.deepEqual(r, { ok: true });
  const note = state.gen.note;
  assert.ok(note.startsWith('Copied; ' + COPY_NOTE), note);
  copyProps(note, 'toast');
});

test('LIVE: HIDE_WORDING says "hq_footprint tool only" and "stays readable on this PC"', () => {
  assert.ok(HIDE_WORDING.includes('hq_footprint tool only'), HIDE_WORDING);
  assert.ok(HIDE_WORDING.includes('stays readable on this PC'), HIDE_WORDING);
  assert.equal(apos(HIDE_WORDING), apos(WANT_HIDE));
});

test('LIVE: no shared sentence claims the 30 s clear removes anything from history or the cloud', () => {
  for (const [k, v] of Object.entries({ COPY_NOTE, HIDE_WORDING, unlockHelp: SEC_TEXT.unlockHelp, genIntro: SEC_TEXT.genIntro })) {
    assert.ok(!claimsRemoval(v), k);
  }
});

test('the looked-in line is three labels and a count, never a path', () => {
  assert.equal(lookedLine(['Downloads', 'Desktop', 'Documents'], 2), 'Looked in Downloads, Desktop, Documents (2 moved folders followed)');
  assert.equal(lookedLine(['Downloads', 'Desktop', 'Documents'], 1), 'Looked in Downloads, Desktop, Documents (1 moved folder followed)');
  assert.equal(lookedLine(['Downloads', 'Desktop', 'Documents'], 0), 'Looked in Downloads, Desktop, Documents (0 moved folders followed)');
  assert.equal(lookedLine(null, 3), '');
  assert.equal(lookedLine([], 3), '');
  assert.equal(lookedLine(['Downloads', 7, ''], NaN), 'Looked in Downloads (0 moved folders followed)');
});
