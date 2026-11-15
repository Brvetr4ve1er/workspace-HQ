// node --test dashboard-v5/src/logic/cheats.test.mjs
// Cheat codes (batch 7): the registry, the strict matcher, the pinned legacy matcher, what each code does, the found list, the host mixin on a
// rigged component, the timing wrapper, the vals (ONE key, names only), the templates' bindings and the source rules.
// Invented fixtures only (public repo). A test that waits for a shared edit (hq-fx.js losing its listener) is a todo until the edit lands,
// then it is strict by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHEATS, STRICT_TAIL_KEYS, STRICT_GAP_MS, LEGACY_TAIL_CHARS, LEGACY_SHIPPED_TAIL_CHARS,
  createMatcher, createLegacyMatcher, isTypingTarget, validateRegistry, armedIds, tokensOf, legacyNeedles, runCheat, normaliseFound, foundSummary,
} from './cheats.mjs';
import { cheatsVals, CHT_OFF } from '../vals/cheats.js';
import overlayTpl, { foundFragment } from '../tpl/cheats-overlay.tpl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const byId = (id) => CHEATS.find((c) => c.id === id);
const NEW_CODES = CHEATS.filter((c) => !c.legacy);

// a clock the test moves
function clock(t0 = 1000) { let t = t0; const now = () => t; now.advance = (ms) => { t += ms; }; return now; }
const body = { tagName: 'BODY' };
function typeInto(m, text, target = body, armed) { let hit = null; for (const ch of text) hit = m.feed({ key: ch }, target, armed); return hit; }

// ---- the registry -----------------------------------------------------------------------------------------------------

test('CHEATS is frozen, every entry has the documented shape, and the codes are the ones the owner was promised', () => {
  assert.ok(Object.isFrozen(CHEATS));
  for (const c of CHEATS) {
    assert.ok(Object.isFrozen(c), c.id);
    assert.deepEqual(Object.keys(c).sort(), ['alt', 'effect', 'id', 'kind', 'legacy', 'name', 'seq', 'worksWhenOff'], c.id);
    assert.ok(['typed', 'chord'].includes(c.kind));
    assert.equal(typeof c.legacy, 'boolean');
    assert.equal(typeof c.worksWhenOff, 'boolean');
    assert.equal(typeof c.effect, 'string');
  }
  assert.deepEqual(CHEATS.map((c) => c.id), ['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance', 'backroom']);
  assert.deepEqual(CHEATS.filter((c) => c.legacy).map((c) => c.id), ['bit', 'dance']);
  assert.deepEqual(CHEATS.filter((c) => c.worksWhenOff && !c.legacy).map((c) => c.id), ['cartridge']);
  assert.deepEqual(CHEATS.map((c) => c.effect), ['console-layer-on', 'console-skin', 'palette-ember', 'palette-tide', 'debug-overlay', 'egg-bit', 'egg-dance', 'room-open']);
  assert.ok(Object.isFrozen(byId('dance').alt) && Object.isFrozen(byId('dance').alt[0]));
});

test('the registry is sound: unique ids and sequences, nothing shadows anything, strict codes fit the window, names hide the sequence', () => {
  assert.deepEqual(validateRegistry(CHEATS), []);
  for (const c of NEW_CODES) assert.ok(tokensOf(c).length <= STRICT_TAIL_KEYS, c.id);
  for (const c of CHEATS) assert.ok(!c.name.toLowerCase().includes(String(c.seq).toLowerCase()), c.id + ' name leaks its sequence');
  assert.equal(STRICT_TAIL_KEYS, 12);
  assert.equal(STRICT_GAP_MS, 3000);
});

test('validateRegistry catches a broken list', () => {
  const ok = { id: 'zed', name: 'Zed thing', kind: 'typed', seq: 'zedzed', legacy: false, worksWhenOff: false, effect: 'x', alt: [] };
  assert.deepEqual(validateRegistry([ok]), []);
  assert.ok(validateRegistry([ok, { ...ok }]).some((p) => /duplicate id/.test(p)));
  assert.ok(validateRegistry([ok, { ...ok, id: 'zed2' }]).some((p) => /same sequence/.test(p)));
  assert.ok(validateRegistry([ok, { ...ok, id: 'long', seq: 'xxzedzed' }]).some((p) => /would shadow/.test(p)));
  assert.ok(validateRegistry([ok, { ...ok, id: 'long', seq: 'zedzedxx' }]).some((p) => /would fire while it is typed/.test(p)));
  assert.ok(validateRegistry([{ ...ok, seq: 'a'.repeat(13) }]).some((p) => /12-key tail/.test(p)));
  assert.ok(validateRegistry([{ ...ok, seq: 'Zed Zed' }]).some((p) => /lower-case/.test(p)));
  assert.ok(validateRegistry([{ ...ok, legacy: true, worksWhenOff: false }]).some((p) => /works when the layer is off/.test(p)));
  assert.ok(validateRegistry([{ ...ok, name: 'a zedzed day' }]).some((p) => /name contains the sequence/.test(p)));
  assert.ok(validateRegistry([{ ...ok, kind: 'chord', seq: ['ArrowUp'] }]).some((p) => /chord/.test(p)));
  assert.ok(validateRegistry([null]).length);
  assert.ok(validateRegistry([{ ...ok, effect: '' }]).some((p) => /effect missing/.test(p)));
});

test('no code is a famous borrowed sequence (an inline deny-list of placeholders; originals only)', () => {
  const BORROWED = ['uuddlrlrba', 'konami', 'iddqd', 'idkfa', 'xyzzy', 'plugh', 'rosebud', 'motherlode', 'greedisgood', 'whosyourdaddy', 'hesoyam', 'impulse101', 'thereisnospoon', 'abracadabra',
    'arrowuparrowuparrowdownarrowdownarrowleftarrowrightarrowleftarrowright'];
  for (const c of CHEATS) {
    // the legacy double ArrowUp is the first half of a famous sequence, not the sequence: what matters is that no needle IS one or CONTAINS one
    for (const n of legacyNeedles(c)) for (const b of BORROWED) { assert.notEqual(n, b, c.id); assert.ok(!n.includes(b), c.id + ' contains ' + b); }
  }
});

test('tokensOf and legacyNeedles: a word is one token per character, a chord one per key, the legacy needle is the old joined string', () => {
  assert.deepEqual(tokensOf(byId('tide')), ['t', 'i', 'd', 'e']);
  assert.deepEqual(tokensOf({ kind: 'chord', seq: ['ArrowUp', 'Enter'] }), ['arrowup', 'enter']);
  assert.deepEqual(legacyNeedles(byId('bit')), ['bit']);
  assert.deepEqual(legacyNeedles(byId('dance')), ['dance', 'arrowuparrowup']);
  assert.deepEqual(tokensOf(null), []);
  assert.deepEqual(legacyNeedles(null), []);
});

// ---- typing targets -----------------------------------------------------------------------------------------------------

test('isTypingTarget: input, textarea, select, any contenteditable and role=textbox; nothing else', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) assert.equal(isTypingTarget({ tagName }), true, tagName);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'contenteditable' ? '' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'contenteditable' ? 'true' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'contenteditable' ? 'plaintext-only' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'textbox' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'SPAN', getAttribute: () => null, closest: (sel) => (/contenteditable/.test(sel) ? {} : null) }), true, 'inside an editable region');
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'contenteditable' ? 'false' : null) }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON', getAttribute: (n) => (n === 'role' ? 'tab' : null), closest: () => null }), false);
  assert.equal(isTypingTarget({ tagName: 'BODY' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
  assert.equal(isTypingTarget('input'), false);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute() { throw new Error('boom'); }, closest() { throw new Error('boom'); } }), false, 'a throwing element is not a typing target');
});

// ---- the strict matcher ---------------------------------------------------------------------------------------------------

test('every strict code fires exactly at its last key, once; its shorter prefixes and reorderings do not', () => {
  for (const c of NEW_CODES) {
    const seq = c.seq;
    const m = createMatcher({ now: clock() });
    for (let i = 0; i < seq.length - 1; i++) assert.equal(m.feed({ key: seq[i] }, body), null, c.id + ' fired early at ' + i);
    assert.deepEqual(m.feed({ key: seq[seq.length - 1] }, body), { id: c.id });
    assert.equal(m.feed({ key: seq[seq.length - 1] }, body), null, 'the tail was cleared: one more key is not a second fire');
    const part = createMatcher({ now: clock() });
    assert.equal(typeInto(part, seq.slice(0, -1)), null, c.id + ' partial');
    const reordered = createMatcher({ now: clock() });
    assert.equal(typeInto(reordered, [...seq].reverse().join('')), null, c.id + ' reordered');
  }
});

test('a code needs the whole sequence again after it fires, and a different code right after still works', () => {
  const m = createMatcher({ now: clock() });
  assert.deepEqual(typeInto(m, 'ember'), { id: 'ember' });
  assert.equal(typeInto(m, 'mber'), null);
  assert.deepEqual(typeInto(m, 'ember'), { id: 'ember' });
  assert.deepEqual(typeInto(m, 'tide'), { id: 'tide' });
});

test('the window is 12 keys: junk before a code is fine, a junk key inside it is not', () => {
  const m = createMatcher({ now: clock() });
  assert.deepEqual(typeInto(m, 'qwertyuiopasdfghjkl' + 'cartridge'), { id: 'cartridge' });
  const bad = createMatcher({ now: clock() });
  assert.equal(typeInto(bad, 'cartr' + 'x' + 'idge'), null);
  const tail = createMatcher({ now: clock() });
  typeInto(tail, 'abcdefghijklmnop');
  assert.equal(tail.tailKeys().length, STRICT_TAIL_KEYS);
  assert.equal(tail.tailKeys().join(''), 'efghijklmnop');
});

test('capitals count (Shift itself is neither a key of the code nor a break in it), the case of a letter does not matter', () => {
  const m = createMatcher({ now: clock() });
  assert.equal(m.feed({ key: 'Shift' }, body), null);
  m.feed({ key: 'E' }, body); m.feed({ key: 'M' }, body); m.feed({ key: 'B' }, body); m.feed({ key: 'e' }, body);
  assert.deepEqual(m.feed({ key: 'R' }, body), { id: 'ember' });
  const caps = createMatcher({ now: clock() });
  assert.equal(caps.feed({ key: 'CapsLock' }, body), null);
  assert.deepEqual(typeInto(caps, 'TIDE'), { id: 'tide' });
});

test('a gap longer than 3 s clears the tail; exactly 3 s does not', () => {
  const now = clock();
  const m = createMatcher({ now });
  typeInto(m, 'cartri');
  now.advance(STRICT_GAP_MS + 1);
  assert.equal(typeInto(m, 'dge'), null, 'the first half was forgotten');
  const m2 = createMatcher({ now });
  typeInto(m2, 'cartri');
  now.advance(STRICT_GAP_MS);
  assert.deepEqual(typeInto(m2, 'dge'), { id: 'cartridge' }, 'exactly 3 s is still the same thought');
  const m3 = createMatcher({ now });
  typeInto(m3, 'carts');
  now.advance(STRICT_GAP_MS + 1);
  assert.deepEqual(typeInto(m3, 'cartridge'), { id: 'cartridge' }, 'after a gap a whole code still works');
});

test('ctrl, meta or alt held clears the tail and the held key is not part of any code', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    const m = createMatcher({ now: clock() });
    typeInto(m, 'em');
    assert.equal(m.feed({ key: 'b', [mod]: true }, body), null, mod);
    assert.equal(typeInto(m, 'er'), null, mod + ': the tail was reset, so "ember" did not complete');
    assert.deepEqual(m.tailKeys(), ['e', 'r'], mod);
    assert.deepEqual(typeInto(m, 'ember'), { id: 'ember' }, mod + ': typing it again works');
  }
});

test('a typing target clears the tail and never fires, for every kind of typing target', () => {
  const targets = [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'textbox' : null) }];
  for (const t of targets) {
    const m = createMatcher({ now: clock() });
    typeInto(m, 'cartri');
    assert.equal(typeInto(m, 'dge', t), null, 'typed inside a field');
    assert.deepEqual(m.tailKeys(), [], 'the tail is empty after a field');
    assert.equal(typeInto(m, 'dge'), null, 'the first half was lost when the field was touched');
    assert.deepEqual(typeInto(m, 'cartridge'), { id: 'cartridge' }, 'and then the whole code works on the page');
  }
});

test('feed accepts a plain key name and takes the target from the event when it is not passed', () => {
  const m = createMatcher({ now: clock() });
  let hit = null;
  for (const ch of 'tide') hit = m.feed(ch);
  assert.deepEqual(hit, { id: 'tide' });
  const e = createMatcher({ now: clock() });
  for (const ch of 'tide') hit = e.feed({ key: ch, target: { tagName: 'TEXTAREA' } });
  assert.equal(hit, null, 'the event target counts when no target argument is given');
});

test('armed ids decide what may fire: an unarmed code stays quiet, an armed one still fires', () => {
  const m = createMatcher({ now: clock() });
  assert.equal(typeInto(m, 'plastic', body, ['cartridge']), null);
  assert.deepEqual(typeInto(m, 'cartridge', body, new Set(['cartridge'])), { id: 'cartridge' });
  assert.equal(typeInto(m, 'timing', body, []), null);
});

test('armedFor: layer off arms exactly the two legacy eggs plus cartridge, on arms everything', () => {
  const m = createMatcher({ now: clock() });
  assert.deepEqual(m.armedFor(false).slice().sort(), ['bit', 'cartridge', 'dance']);
  assert.deepEqual(m.armedFor(true), CHEATS.map((c) => c.id));
  assert.deepEqual(armedIds(false).slice().sort(), ['bit', 'cartridge', 'dance']);
  assert.deepEqual(m.armedFor(undefined).slice().sort(), ['bit', 'cartridge', 'dance']);
  assert.deepEqual(armedIds(false, []), []);
});

test('a chord code (an injected one) matches on key names, not characters', () => {
  const codes = [{ id: 'zz', name: 'Chord test', kind: 'chord', seq: ['ArrowUp', 'ArrowDown', 'Enter'], legacy: false, worksWhenOff: true, effect: 'x', alt: [] }];
  const m = createMatcher({ codes, now: clock() });
  assert.equal(m.feed({ key: 'ArrowUp' }, body), null);
  assert.equal(m.feed({ key: 'ArrowDown' }, body), null);
  assert.deepEqual(m.feed({ key: 'Enter' }, body), { id: 'zz' });
  const wrong = createMatcher({ codes, now: clock() });
  wrong.feed({ key: 'ArrowDown' }, body); wrong.feed({ key: 'ArrowUp' }, body);
  assert.equal(wrong.feed({ key: 'Enter' }, body), null);
});

test('a clock that returns garbage never throws and never blocks a code', () => {
  const m = createMatcher({ now: () => NaN });
  assert.deepEqual(typeInto(m, 'ember'), { id: 'ember' });
  const d = createMatcher();   // the real clock
  assert.deepEqual(typeInto(d, 'tide'), { id: 'tide' });
});

test('the strict matcher never fires a legacy code, and a legacy key stream never reaches the strict tail', () => {
  const m = createMatcher({ now: clock() });
  assert.equal(typeInto(m, 'bit'), null);
  assert.equal(typeInto(m, 'dance'), null);
  const legacy = createLegacyMatcher();
  assert.equal(legacy.feed('c'), null);
  assert.deepEqual(m.tailKeys().join(''), 'bitdance');
});

// ---- the legacy matcher (pinned to what hq-fx.js did) -------------------------------------------------------------------

test('legacy: bit and dance by their words, as before', () => {
  const m = createLegacyMatcher();
  assert.equal(m.feed('b'), null); assert.equal(m.feed('i'), null);
  assert.deepEqual(m.feed('t'), { id: 'bit' });
  for (const ch of 'danc') assert.equal(m.feed(ch), null);
  assert.deepEqual(m.feed('e'), { id: 'dance' });
  assert.deepEqual(m.feed({ key: 'B' }), null, 'upper case is lower-cased like e.key.toLowerCase()');
  m.feed({ key: 'I' });
  assert.deepEqual(m.feed({ key: 'T' }), { id: 'bit' });
});

test('legacy: the tail is a string of characters (12 shipped, 14 now), cut from the left, no timeout, no modifier check', () => {
  assert.equal(LEGACY_SHIPPED_TAIL_CHARS, 12);
  assert.equal(LEGACY_TAIL_CHARS, 14);
  const m = createLegacyMatcher({ tail: LEGACY_SHIPPED_TAIL_CHARS });
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') m.feed(ch);
  assert.equal(m.tailText(), 'opqrstuvwxyz');
  assert.equal(m.tailText().length, 12);
  // no gap reset: there is no clock in this matcher at all, so "b ... a long wait ... i ... t" is still bit
  const slow = createLegacyMatcher();
  slow.feed('b'); slow.feed('i');
  assert.deepEqual(slow.feed('t'), { id: 'bit' });
  // modifiers do not matter: ctrl+alt letters still build the tail
  const mod = createLegacyMatcher();
  mod.feed({ key: 'b', ctrlKey: true }); mod.feed({ key: 'i', metaKey: true });
  assert.deepEqual(mod.feed({ key: 't', altKey: true }), { id: 'bit' });
});

test("legacy: 'Shift' adds five characters to the tail, like any other e.key", () => {
  const m = createLegacyMatcher({ tail: 12 });
  m.feed('Shift');
  assert.equal(m.tailText(), 'shift');
  m.feed('Shift'); m.feed('Shift');
  assert.equal(m.tailText().length, 12, 'three Shifts are 15 characters cut to 12');
  const typed = createLegacyMatcher();
  typed.feed('Shift');
  typed.feed('B'); typed.feed('I');
  assert.deepEqual(typed.feed('T'), { id: 'bit' }, 'a capital typed with Shift is still bit');
});

test('legacy: skipped ONLY for an input or a textarea (the tail is left as it was), still fed by a select, a contenteditable and role=textbox', () => {
  const m = createLegacyMatcher();
  m.feed('b'); m.feed('i');
  assert.equal(m.feed({ key: 't', target: { tagName: 'INPUT' } }), null);
  assert.equal(m.tailText(), 'bi', 'an input does not touch the tail');
  assert.equal(m.feed('x', { tagName: 'TEXTAREA' }), null);
  assert.equal(m.tailText(), 'bi');
  assert.deepEqual(m.feed('t', { tagName: 'BODY' }), { id: 'bit' }, 'the tail from before the field completes after it');
  for (const t of [{ tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', getAttribute: () => 'textbox' }]) {
    const s = createLegacyMatcher();
    s.feed('b'); s.feed('i');
    assert.deepEqual(s.feed('t', t), { id: 'bit' }, 'parity: the old code only checked input and textarea');
  }
});

test('legacy FINDING: the double ArrowUp can never match a 12-character tail, and matches the 14-character one', () => {
  assert.equal('arrowuparrowup'.length, 14);
  const shipped = createLegacyMatcher({ tail: LEGACY_SHIPPED_TAIL_CHARS });
  assert.equal(shipped.feed('ArrowUp'), null);
  assert.equal(shipped.feed('ArrowUp'), null, 'today: it never fired');
  const now = createLegacyMatcher();
  assert.equal(now.feed('ArrowUp'), null);
  assert.deepEqual(now.feed('ArrowUp'), { id: 'dance' }, 'now: it does');
  const off = createLegacyMatcher();
  off.feed('ArrowUp'); off.feed('ArrowDown');
  assert.equal(off.feed('ArrowUp'), null, 'up, down, up is not it');
  // bit and dance behave the same at both lengths
  for (const tail of [12, 14]) {
    const m = createLegacyMatcher({ tail });
    for (const ch of 'xxxxxxxxxxxxxxxxbi') m.feed(ch);
    assert.deepEqual(m.feed('t'), { id: 'bit' });   // (a hit then clears the tail)
    const d = createLegacyMatcher({ tail });
    for (const ch of 'dance') d.feed(ch);
    assert.deepEqual(d.feed('x'), null);
  }
});

test('legacy: its codes and effect ids are exactly the two eggs, armed with the layer off', () => {
  const legacy = CHEATS.filter((c) => c.legacy);
  assert.deepEqual(legacy.map((c) => [c.id, c.effect, c.worksWhenOff]), [['bit', 'egg-bit', true], ['dance', 'egg-dance', true]]);
  const only = createLegacyMatcher({ codes: [byId('cartridge'), byId('ember')] });
  for (const ch of 'cartridge') assert.equal(only.feed(ch), null, 'the legacy matcher never fires a strict code');
});

// ---- what a fired code does -----------------------------------------------------------------------------------------------

const ST = (o = {}) => ({ layerOn: false, skin: false, palette: '', debug: false, found: [], ...o });

test('cartridge turns the layer on (even when off) and says so; a second time says it is already on', () => {
  const r = runCheat('cartridge', ST());
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { on: true });
  assert.deepEqual(r.toast, { kind: 'info', text: 'Console layer on' });
  assert.deepEqual(r.found, ['cartridge']);
  assert.equal(r.newlyFound, true);
  const again = runCheat('cartridge', ST({ layerOn: true, found: ['cartridge'] }));
  assert.deepEqual(again.patch, {});
  assert.equal(again.toast.text, 'Console layer is already on');
  assert.equal(again.newlyFound, false);
  assert.deepEqual(again.found, ['cartridge'], 'no duplicate');
});

test('plastic sets the skin only with the layer on; with it off it says how to turn the layer on and is not recorded', () => {
  const on = runCheat('plastic', ST({ layerOn: true }));
  assert.deepEqual(on.patch, { skin: true });
  assert.equal(on.toast.text, 'Console skin on');
  assert.equal(runCheat('plastic', ST({ layerOn: true, skin: true })).toast.text, 'Console skin is already on');
  const off = runCheat('plastic', ST());
  assert.equal(off.ok, false);
  assert.deepEqual(off.patch, {});
  assert.deepEqual(off.found, []);
  assert.match(off.toast.text, /turn it on in Settings/);
});

test('ember and tide set the palette; the same code again clears it; the other one switches', () => {
  assert.deepEqual(runCheat('ember', ST({ layerOn: true })).patch, { palette: 'ember' });
  assert.equal(runCheat('ember', ST({ layerOn: true })).toast.text, 'Ember accent on');
  const clear = runCheat('ember', ST({ layerOn: true, palette: 'ember' }));
  assert.deepEqual(clear.patch, { palette: '' });
  assert.equal(clear.toast.text, 'Ember accent off');
  assert.deepEqual(runCheat('tide', ST({ layerOn: true, palette: 'ember' })).patch, { palette: 'tide' });
  assert.deepEqual(runCheat('tide', ST({ layerOn: true, palette: 'tide' })).patch, { palette: '' });
  assert.equal(runCheat('tide', ST()).ok, false, 'needs the layer');
});

test('timing toggles the overlay flag with an honest line each way', () => {
  assert.deepEqual(runCheat('timing', ST({ layerOn: true })).patch, { debug: true });
  assert.equal(runCheat('timing', ST({ layerOn: true })).toast.text, 'Timing overlay on');
  assert.deepEqual(runCheat('timing', ST({ layerOn: true, debug: true })).patch, { debug: false });
  assert.equal(runCheat('timing', ST({ layerOn: true, debug: true })).toast.text, 'Timing overlay off');
});

test('the legacy eggs ask for their effect, change no setting and add no toast (Bit speaks for them); they count as found', () => {
  for (const [id, egg] of [['bit', 'bit'], ['dance', 'dance']]) {
    for (const layerOn of [false, true]) {
      const r = runCheat(id, ST({ layerOn }));
      assert.equal(r.ok, true);
      assert.equal(r.egg, egg);
      assert.equal(r.toast, null);
      assert.deepEqual(r.patch, {});
      assert.deepEqual(r.found, [id]);
    }
  }
});

test('every new code that applies carries a toast, and every toast is one plain line', () => {
  for (const c of NEW_CODES) {
    const r = runCheat(c.id, ST({ layerOn: true }));
    assert.equal(r.ok, true, c.id);
    assert.ok(r.toast && typeof r.toast.text === 'string' && r.toast.text.length > 4 && !/\n/.test(r.toast.text), c.id);
    assert.doesNotMatch(r.toast.text, /undefined|NaN|\[object/);
  }
});

test('an unknown code or an unknown effect changes nothing', () => {
  const a = runCheat('nope', ST({ layerOn: true, found: ['ember', 'junk'] }));
  assert.equal(a.ok, false);
  assert.deepEqual(a.patch, {});
  assert.equal(a.toast, null);
  assert.deepEqual(a.found, ['ember'], 'junk ids are dropped from the list');
  const odd = [{ id: 'odd', name: 'Odd', kind: 'typed', seq: 'oddity', legacy: false, worksWhenOff: false, effect: 'no-such-effect', alt: [] }];
  const b = runCheat('odd', ST({ layerOn: true }), odd);
  assert.equal(b.ok, false);
  assert.deepEqual(b.patch, {});
});

test('normaliseFound keeps known ids once each, in order, and never throws on garbage', () => {
  assert.deepEqual(normaliseFound(['tide', 'tide', 'ember', 'x', 3, null, 'bit']), ['tide', 'ember', 'bit']);
  for (const bad of [undefined, null, 'tide', 5, {}, [[]]]) assert.deepEqual(normaliseFound(bad), []);
});

test('foundSummary: a count and the NAME of each found code, a dash for the rest, never an id or a sequence', () => {
  const none = foundSummary([]);
  assert.equal(none.title, 'Codes found: 0 of 8');
  assert.equal(none.sr, 'None found yet.');
  assert.ok(none.rows.every((r) => r.label === '–' && r.found === false));
  const two = foundSummary(['cartridge', 'bit', 'bogus']);
  assert.equal(two.title, 'Codes found: 2 of 8');
  assert.equal(two.count, 2);
  assert.deepEqual(two.rows.filter((r) => r.found).map((r) => r.label), ['Power on', 'Hide and seek']);
  assert.equal(two.rows.length, 8);
  assert.equal(two.sr, 'Found so far: Power on, Hide and seek. 6 not found yet.');
  const dump = JSON.stringify(two).toLowerCase();
  for (const c of CHEATS) {
    assert.ok(!dump.includes(String(c.seq).toLowerCase()), 'the summary leaked the sequence of ' + c.id);
    for (const a of c.alt) assert.ok(!dump.includes(a.join('').toLowerCase()));
  }
});

// ---- the vals (ONE key, names only) ---------------------------------------------------------------------------------------

const valsOf = (state, extra = {}) => cheatsVals.call({ state, ...extra });

test('chtv is the only key, cht-prefixed inside, and with the layer off (or no layer pref at all) it is the one frozen constant', () => {
  for (const state of [{}, { consoleLayer: undefined }, { consoleLayer: null }, { consoleLayer: { on: false, debug: true, palette: 'ember' }, cheatsFound: ['bit'] }, { consoleLayer: 'on' }]) {
    const top = valsOf(state);
    assert.deepEqual(Object.keys(top), ['chtv']);
    assert.equal(top.chtv, CHT_OFF, 'the same object every time: nothing is built while off');
  }
  assert.ok(Object.isFrozen(CHT_OFF));
  for (const k of Object.keys(CHT_OFF)) assert.match(k, /^cht[A-Z]/, k);
  assert.equal(CHT_OFF.chtAccent, '');
  assert.equal(CHT_OFF.chtDebug, false);
  assert.equal(CHT_OFF.chtShowFound, false);
  assert.equal(CHT_OFF.chtClose(), false);
});

test('layer on: the accent is the palette (only ember or tide), the found list shows names and a count, the overlay stays off until asked', () => {
  const v = valsOf({ consoleLayer: { on: true, palette: 'tide' }, cheatsFound: ['cartridge', 'bit', 'nonsense'] }).chtv;
  assert.equal(v.chtAccent, 'tide');
  assert.equal(v.chtShowFound, true);
  assert.equal(v.chtFoundTitle, 'Codes found: 2 of 8');
  assert.deepEqual(v.chtFound.map((r) => r.label), ['Power on', '–', '–', '–', '–', 'Hide and seek', '–', '–']);
  assert.ok(v.chtFound.every((r) => typeof r.color === 'string' && r.color.startsWith('var(--')));
  assert.equal(v.chtDebug, false);
  assert.equal(valsOf({ consoleLayer: { on: true, palette: 'ember' } }).chtv.chtAccent, 'ember');
  for (const bad of ['', 'plum', 5, null, '<script>']) assert.equal(valsOf({ consoleLayer: { on: true, palette: bad } }).chtv.chtAccent, '', String(bad));
  assert.ok(Object.isFrozen(v));
  const same = { consoleLayer: { on: true, palette: 'tide' }, cheatsFound: ['cartridge', 'bit'] };
  assert.equal(valsOf(same).chtv, valsOf(same).chtv, 'same inputs, the same frozen answer (nothing is rebuilt per render)');
});

test('the found list never carries a sequence or an id, whatever is found', () => {
  const v = valsOf({ consoleLayer: { on: true }, cheatsFound: CHEATS.map((c) => c.id) }).chtv;
  assert.equal(v.chtFoundTitle, 'Codes found: 8 of 8');
  const dump = JSON.stringify(v).toLowerCase();
  for (const c of CHEATS) {
    assert.ok(!dump.includes(String(c.seq).toLowerCase()), c.id + ' sequence in the vals');
    for (const a of c.alt) assert.ok(!dump.includes(a.join('').toLowerCase()));
  }
  assert.ok(!/"id"/.test(dump));
});

test('debug on: the numbers are words, an empty ring shows dashes, never zero or NaN; the close button closes', () => {
  const closes = [];
  const self = { state: { consoleLayer: { on: true, debug: true } }, cheatsDebugStats: () => null, cheatsCloseOverlay() { closes.push(1); } };
  const empty = cheatsVals.call(self).chtv;
  assert.equal(empty.chtDebug, true);
  assert.deepEqual([empty.chtLast, empty.chtP50, empty.chtP95, empty.chtPerMin, empty.chtKeys, empty.chtEmit], ['–', '–', '–', '–', '–', 'none yet']);
  assert.equal(empty.chtSamples, 'no renders measured yet');
  empty.chtClose();
  assert.deepEqual(closes, [1]);
  const full = cheatsVals.call({ ...self, cheatsDebugStats: () => ({ count: 12, last: 3.456, p50: 2.2, p95: 14.8, perMin: 31, keys: 981, emitAt: 7000, now: 10000 }) }).chtv;
  assert.deepEqual([full.chtLast, full.chtP50, full.chtP95, full.chtPerMin, full.chtKeys, full.chtEmit, full.chtSamples], ['3.5 ms', '2.2 ms', '15 ms', '31', '981 of 1015', '3 s ago', 'over the last 12 renders']);
  assert.equal(cheatsVals.call({ ...self, cheatsDebugStats: () => ({ count: 1, last: 1, p50: 1, p95: 1, perMin: 1, keys: 1, emitAt: null, now: 5 }) }).chtv.chtSamples, 'over the last 1 render');
  for (const v of [empty, full]) assert.doesNotMatch(JSON.stringify(v), /NaN|undefined|Infinity|\[object/);
});

test('every template binding exists in the vals, including the fields of each loop item; nothing is flat', () => {
  const v = cheatsVals.call({ state: { consoleLayer: { on: true, debug: true } }, cheatsDebugStats: () => null, cheatsCloseOverlay() {} }).chtv;
  for (const [name, tpl] of [['overlay', overlayTpl], ['found fragment', foundFragment]]) {
    const bound = tpl.replace(/hint-placeholder-val="[^"]*"/g, '');
    const loops = new Map([...bound.matchAll(/<sc-for list="\{\{\s*([A-Za-z0-9_.]+)\s*\}\}" as="(\w+)"/g)].map((m) => [m[2], m[1].replace(/^chtv\./, '')]));
    const all = [...bound.matchAll(/\{\{\s*([A-Za-z0-9_.!]+)\s*\}\}/g)].map((m) => m[1].replace(/^!/, '').replace(/^chtv\./, ''));
    assert.ok(all.length >= 3, name + ' binds something');
    for (const b of all) {
      const [head, ...rest] = b.split('.');
      if (loops.has(head)) assert.ok(rest[0] in v[loops.get(head)][0], name + ': item of ' + loops.get(head) + ' lacks ' + rest[0]);
      else assert.ok(head in v, name + ' binds ' + head + ' but the vals have none');
    }
    assert.doesNotMatch(bound, /{{\s*!?cht[A-Z]/, name + ': every binding goes through chtv');
    assert.doesNotMatch(bound, /list="{{\s*cht[A-Z]/);
  }
});

test('the overlay template: no DOM unless on, pointer-events none except its own close button, no motion, no sound, no live region, tokens only', () => {
  assert.match(overlayTpl, /<sc-if value="{{ chtv.chtDebug }}"/);
  assert.match(overlayTpl, /<aside data-hq-console="timing" aria-label="Frame timing"/);
  assert.equal((overlayTpl.match(/pointer-events:none/g) || []).length, 1, 'the panel');
  assert.equal((overlayTpl.match(/pointer-events:auto/g) || []).length, 1, 'only the close button takes pointer events');
  assert.match(overlayTpl, /<button type="button" onClick="{{ chtv.chtClose }}" aria-label="Close frame timing"/);
  assert.doesNotMatch(overlayTpl, /transition|animation|@keyframes|aria-live|role="status"|<audio|<video/);
  assert.doesNotMatch(overlayTpl, /#[0-9a-fA-F]{3,8}\b/, 'colours are tokens only');
  assert.match(foundFragment, /<sc-if value="{{ chtv.chtShowFound }}"/);
  assert.doesNotMatch(foundFragment, /<button|onClick|transition|animation/, 'the found list has no control');
});

// ---- the host mixin on a rigged component -------------------------------------------------------------------------------

const adds = [], removes = [], eggs = [];
globalThis.window = {
  addEventListener: (t, fn) => adds.push([t, fn]),
  removeEventListener: (t, fn) => removes.push([t, fn]),
  HQFx: { egg: (id) => eggs.push(id) },
};
const { cheatsLogic } = await import('./cheats-host.js');

function rig(state = {}) {
  const calls = { toasts: [], storeOff: 0, storeFns: [], forced: 0 };
  const proto = Object.create(cheatsLogic);
  proto.renderVals = function () { return { a: 1, b: 2, c: 3 }; };
  const self = Object.assign(Object.create(proto), {
    state: { consoleLayer: undefined, cheatsFound: [], ...state },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast(kind, text) { calls.toasts.push([kind, text]); },
    forceUpdate() { calls.forced++; },
    store: { on(fn) { calls.storeFns.push(fn); return () => { calls.storeOff++; }; } },
  });
  return { self, calls };
}
const keys = (self, text, target = body) => { for (const ch of text) self.cheatKey({ key: ch, target }); };

test('host: ONE permanent keydown listener, registered once, removed on unmount; a second mount adds nothing', () => {
  adds.length = 0; removes.length = 0;
  const { self } = rig();
  self.cheatsMount(); self.cheatsMount();
  assert.equal(adds.filter(([t]) => t === 'keydown').length, 1);
  assert.equal(adds.length, 1, 'no other listener of any kind');
  // switching the layer on and off later never adds or removes a listener
  self.setState({ consoleLayer: { on: true } }); self.cheatsDebugSync();
  self.setState({ consoleLayer: { on: false } }); self.cheatsDebugSync();
  assert.equal(adds.length, 1);
  assert.equal(removes.length, 0);
  self.cheatsUnmount();
  assert.equal(removes.length, 1);
  assert.equal(removes[0][1], adds[0][1], 'the same function it added');
  self.cheatsUnmount();
  assert.equal(removes.length, 1, 'a second unmount is a no-op');
});

test('host, layer OFF: typing bit makes Bit cheer and counts as found; dance and ArrowUp twice too; nothing else changes', () => {
  eggs.length = 0;
  const { self, calls } = rig();
  keys(self, 'bit');
  assert.deepEqual(eggs, ['bit']);
  assert.deepEqual(self.state.cheatsFound, ['bit']);
  keys(self, 'dance');
  assert.deepEqual(eggs, ['bit', 'dance']);
  self.cheatKey({ key: 'ArrowUp', target: body }); self.cheatKey({ key: 'ArrowUp', target: body });
  assert.deepEqual(eggs, ['bit', 'dance', 'dance']);
  assert.deepEqual(self.state.cheatsFound, ['bit', 'dance']);
  assert.deepEqual(calls.toasts, [], 'the eggs speak through Bit, not through a toast');
  assert.equal(self.state.consoleLayer, undefined, 'the layer setting was never touched');
});

test('host, layer OFF: only cartridge opens the door; the other new codes do nothing at all', () => {
  const { self, calls } = rig();
  keys(self, 'plastic'); keys(self, 'ember'); keys(self, 'tide'); keys(self, 'timing');
  assert.deepEqual(calls.toasts, []);
  assert.equal(self.state.consoleLayer, undefined);
  assert.deepEqual(self.state.cheatsFound, []);
  keys(self, 'cartridge');
  assert.deepEqual(calls.toasts, [['info', 'Console layer on']]);
  assert.equal(self.state.consoleLayer.on, true);
  assert.deepEqual(self.state.cheatsFound, ['cartridge']);
});

test('host: the whole unlock chain (cartridge, plastic, ember, tide, ember again, timing) with a toast each and the names in the found list', () => {
  const { self, calls } = rig();
  keys(self, 'cartridge'); keys(self, 'plastic');
  assert.equal(self.state.consoleLayer.skin, true);
  keys(self, 'ember');
  assert.equal(self.state.consoleLayer.palette, 'ember');
  keys(self, 'tide');
  assert.equal(self.state.consoleLayer.palette, 'tide');
  keys(self, 'ember'); keys(self, 'ember');
  assert.equal(self.state.consoleLayer.palette, '', 'a second ember clears it');
  keys(self, 'timing');
  assert.equal(self.state.consoleLayer.debug, true);
  assert.deepEqual(calls.toasts.map((t) => t[1]), ['Console layer on', 'Console skin on', 'Ember accent on', 'Tide accent on', 'Ember accent on', 'Ember accent off', 'Timing overlay on']);
  assert.deepEqual(self.state.cheatsFound, ['cartridge', 'plastic', 'ember', 'tide', 'timing']);
  const v = cheatsVals.call(self).chtv;
  assert.equal(v.chtFoundTitle, 'Codes found: 5 of 8');
  assert.deepEqual(v.chtFound.filter((r) => r.found).map((r) => r.label), ['Power on', 'Chunky skin', 'Warm accent', 'Cool accent', 'Stopwatch']);
  assert.equal(self.state.consoleLayer.on, true, 'earlier settings are kept when a code patches one field');
});

test('host: nothing fires while a typing target is focused, the tail is reset, and the same keys on the page then fire', () => {
  eggs.length = 0;
  const input = { tagName: 'INPUT' };
  const { self, calls } = rig({ consoleLayer: { on: true } });
  for (const word of ['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance', 'backroom']) keys(self, word, input);
  self.cheatKey({ key: 'ArrowUp', target: input }); self.cheatKey({ key: 'ArrowUp', target: input });
  assert.deepEqual(calls.toasts, []);
  assert.deepEqual(eggs, []);
  assert.deepEqual(self.state.cheatsFound, []);
  keys(self, 'tid'); keys(self, 'e', input); keys(self, 'tid');
  assert.deepEqual(calls.toasts, [], 'a field in the middle breaks the code');
  keys(self, 'tide');
  assert.deepEqual(calls.toasts.map((t) => t[1]), ['Tide accent on']);
  // a contenteditable and a textbox role stop the new codes (the legacy path only skips input and textarea)
  const ce = { tagName: 'DIV', isContentEditable: true };
  keys(self, 'timing', ce);
  assert.equal(self.state.consoleLayer.debug, undefined);
});

test('host: a held ctrl, meta or alt breaks a new code; a legacy egg ignores modifiers like it always did', () => {
  eggs.length = 0;
  const { self, calls } = rig({ consoleLayer: { on: true } });
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    keys(self, 'ti'); self.cheatKey({ key: 'd', target: body, [mod]: true }); keys(self, 'e');
  }
  assert.deepEqual(calls.toasts, []);
  self.cheatKey({ key: 'b', target: body, ctrlKey: true }); self.cheatKey({ key: 'i', target: body }); self.cheatKey({ key: 't', target: body, altKey: true });
  assert.deepEqual(eggs, ['bit']);
});

test('host: an event without a key or a target never throws', () => {
  const { self } = rig();
  assert.doesNotThrow(() => { self.cheatKey(null); self.cheatKey({}); self.cheatKey({ key: undefined }); self.cheatKey({ key: 'x', target: null }); });
});

test('host: cheatsApply on a stale or unknown id changes nothing; a repeat of a found egg writes no state', () => {
  eggs.length = 0;
  const { self } = rig();
  const before = self.state;
  assert.equal(self.cheatsApply('nope').ok, false);
  assert.equal(self.state, before);
  self.cheatsApply('bit');
  const afterFirst = self.state;
  self.cheatsApply('bit');
  assert.equal(self.state, afterFirst, 'already found, no setting changed: no write');
  assert.deepEqual(eggs, ['bit', 'bit'], 'Bit still cheers every time');
  assert.deepEqual(self.cheatsFoundIds(), ['bit']);
});

test('host: with no Bit (no egg function on the fx object) a legacy code still counts and does not throw', () => {
  const keep = globalThis.window.HQFx;
  globalThis.window.HQFx = {};
  try { const { self } = rig(); assert.doesNotThrow(() => keys(self, 'bit')); assert.deepEqual(self.state.cheatsFound, ['bit']); }
  finally { globalThis.window.HQFx = keep; }
});

test('host: the timing wrapper exists only while the layer is on AND the debug flag is on, and goes away completely when it closes', () => {
  const { self, calls } = rig({ consoleLayer: { on: true, debug: false } });
  const own = (o) => Object.prototype.hasOwnProperty.call(o, 'renderVals');
  self.cheatsAfterRender(); self.cheatsDebugSync();
  assert.equal(own(self), false);
  assert.equal(self.cheatsDebugStats(), null);
  assert.equal(calls.storeFns.length, 0, 'no store subscription while off');
  // the flag on but the layer off: still nothing
  const off = rig({ consoleLayer: { on: false, debug: true } });
  off.self.cheatsDebugSync();
  assert.equal(own(off.self), false);
  // on
  self.setState({ consoleLayer: { on: true, debug: true } });
  self.cheatsAfterRender();
  assert.equal(own(self), true, 'wrapper installed');
  assert.equal(calls.storeFns.length, 1);
  assert.equal(calls.forced, 1, 'one extra render so the first numbers appear');
  const vals = self.renderVals();
  assert.deepEqual(vals, { a: 1, b: 2, c: 3 }, 'the wrapper hands the vals through untouched');
  assert.equal(self.cheatsDebugStats().keys, 3, 'it counts the top-level keys');
  self.cheatsAfterRender();
  const s = self.cheatsDebugStats();
  assert.equal(s.count, 1);
  assert.ok(s.last >= 0 && Number.isFinite(s.last));
  assert.equal(s.perMin, 1);
  calls.storeFns[0]();
  assert.ok(self.cheatsDebugStats().emitAt > 0, 'a store emit stamps the last update');
  self.cheatsAfterRender();
  assert.equal(self.cheatsDebugStats().count, 1, 'an end with no start (no render in between) adds no sample');
  // close: the overlay's own button
  self.cheatsCloseOverlay();
  assert.equal(self.state.consoleLayer.debug, false);
  assert.equal(self.state.consoleLayer.on, true);
  self.cheatsAfterRender();
  assert.equal(own(self), false, 'wrapper removed');
  assert.equal(self.cheatsDebugStats(), null, 'ring gone');
  assert.equal(calls.storeOff, 1, 'subscription dropped');
  assert.deepEqual(self.renderVals(), { a: 1, b: 2, c: 3 });
});

test('host: an own renderVals (a test or a tool already wrapped it) is put back exactly, not deleted', () => {
  const { self } = rig({ consoleLayer: { on: true, debug: true } });
  const mine = () => ({ z: 9 });
  self.renderVals = mine;
  self.cheatsDebugSync();
  assert.notEqual(self.renderVals, mine);
  assert.deepEqual(self.renderVals(), { z: 9 });
  self.setState({ consoleLayer: { on: true, debug: false } });
  self.cheatsDebugSync();
  assert.equal(self.renderVals, mine);
});

test('host: unmount drops the overlay bookkeeping too; seeding the ring for a selftest works only while the flag is on', () => {
  const { self } = rig({ consoleLayer: { on: true, debug: true } });
  assert.equal(self.cheatsSeedRing([2, 4, 6, 8, -1, NaN], Date.now()), true);
  const s = self.cheatsDebugStats();
  assert.equal(s.count, 4);
  assert.equal(s.p50, 4);
  self.cheatsUnmount();
  assert.equal(self.cheatsDebugStats(), null);
  assert.equal(Object.prototype.hasOwnProperty.call(self, 'renderVals'), false);
  const none = rig({ consoleLayer: { on: true, debug: false } });
  assert.equal(none.self.cheatsSeedRing([1, 2]), false);
});

// ---- source rules -------------------------------------------------------------------------------------------------------------

test('source: no raw listener, timer or frame in the cheat files except the ONE permanent keydown listener in cheats-host.js', () => {
  const files = ['logic/cheats.mjs', 'logic/cheats-host.js', 'logic/debug-ring.mjs', 'vals/cheats.js', 'tpl/cheats-overlay.tpl.js', 'selftest-cheats.mjs'];
  for (const f of files) {
    const p = path.join(SRC, f);
    assert.ok(fs.existsSync(p), f + ' exists');
    const src = strip(fs.readFileSync(p, 'utf8'));
    assert.doesNotMatch(src, /setTimeout|setInterval|requestAnimationFrame|queueMicrotask|\.animate\(/, f);
    const n = (src.match(/addEventListener\(/g) || []).length;
    assert.equal(n, f === 'logic/cheats-host.js' ? 1 : 0, f + ' addEventListener count');
    if (f === 'logic/cheats-host.js') assert.match(src, /window\.addEventListener\('keydown', this\._chtKeyFn\)/);
    assert.doesNotMatch(src, /document\.(createElement|body|querySelector)|innerHTML|localStorage|sessionStorage/, f + ' touches no DOM or storage');
  }
});

test('source: the registry and the debug ring never touch the page (no window, document, performance or storage)', () => {
  for (const f of ['logic/cheats.mjs', 'logic/debug-ring.mjs']) {
    const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
    assert.doesNotMatch(src, /\bwindow\b|\bdocument\b|performance\.|localStorage|navigator/, f);
    assert.doesNotMatch(src, /^import /m, f + ' imports nothing');
  }
});

test('source: hq-fx.js keeps the old Bit strings (they live in HQFx.egg after the move)', () => {
  const src = fs.readFileSync(path.join(SRC, 'elements/hq-fx.js'), 'utf8');
  assert.ok(src.includes('you found me ✻'));
  assert.ok(src.includes("say('♪ ♫ ♪', 3000)"));
  assert.ok(src.includes('pet.t0 + 2400') && src.includes('pet.t0 + 4000'));
  assert.ok(src.includes("sfx('level')"));
  assert.ok(src.includes("asciiBurst(r.left + 18, r.top, '♥')"));
});

const FX_SRC = fs.readFileSync(path.join(SRC, 'elements/hq-fx.js'), 'utf8');
const FX_PENDING = /addEventListener\('keydown'/.test(FX_SRC) ? 'waits for the shared hq-fx.js edit (the keydown block moves out, HQFx.egg(id) goes in)' : false;
test('source: no keydown listener is left in hq-fx.js and HQFx.egg exists and is exported', { todo: FX_PENDING }, () => {
  assert.doesNotMatch(FX_SRC, /addEventListener\(\s*['"]keydown['"]/);
  assert.match(FX_SRC, /function egg\(id\)/);
  assert.match(FX_SRC, /return \{[^}]*\begg\b[^}]*\}/);
  assert.ok(FX_SRC.includes("id === 'bit'") && FX_SRC.includes("id === 'dance'"));
});

// ---- the selftest states --------------------------------------------------------------------------------------------------------

test('selftest states: every row is [name, tab, patch, extra], names are unique, rows are drawn by the real vals without a broken value', async () => {
  const { cheatsStates, cheatsInitState, CHEATS_RING_SAMPLES } = await import('../selftest-cheats.mjs');
  const rows = cheatsStates();
  assert.ok(rows.length >= 10);
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length);
  const init = cheatsInitState();
  assert.deepEqual(init.consoleLayer, { on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
  assert.deepEqual(init.cheatsFound, []);
  assert.notEqual(cheatsInitState().consoleLayer, init.consoleLayer, 'a fresh object every time: a row never inherits the last one');
  assert.ok(CHEATS_RING_SAMPLES.every((n) => Number.isFinite(n) && n > 0));
  for (const [name, tab, patch, extra] of rows) {
    assert.match(name, /^cheats-/);
    assert.equal(typeof tab, 'string');
    assert.equal(typeof patch, 'object');
    assert.equal(typeof extra, 'object');
    const state = { ...init, ...patch };
    const rig2 = { state, cheatsDebugStats: () => (extra.ring ? { count: extra.ring.length, last: extra.ring[extra.ring.length - 1], p50: 2.4, p95: 14.8, perMin: 12, keys: 979, emitAt: 1000, now: 4000 } : null), cheatsCloseOverlay() {} };
    const v = cheatsVals.call(rig2).chtv;
    assert.doesNotMatch(JSON.stringify(v), /NaN|undefined|Infinity|\[object/, name);
    assert.equal(v.chtDebug, !!(state.consoleLayer.on && state.consoleLayer.debug), name);
    assert.equal(v.chtAccent, state.consoleLayer.on ? state.consoleLayer.palette : '', name);
    for (const id of state.cheatsFound) assert.ok(CHEATS.some((c) => c.id === id), name + ': ' + id);
  }
  assert.ok(rows.some((r) => r[2].consoleLayer && r[2].consoleLayer.debug && !r[2].consoleLayer.on), 'a row with the flag on and the layer off');
  assert.ok(rows.some((r) => r[3].reduce === true));
});

// ---- repeat re-fire (taster finding): a hit clears the legacy tail, and a held key never counts -------------------------------------------

test('legacy: a hit clears the tail, so ArrowUp x4 fires dance twice (every second press), not on every press after the second', () => {
  const m = createLegacyMatcher();
  const out = [1, 2, 3, 4].map(() => m.feed('ArrowUp'));
  assert.deepEqual(out, [null, { id: 'dance' }, null, { id: 'dance' }]);
  assert.equal(m.tailText(), '', 'the tail is empty right after a hit');
  // a word typed after a hit still works from scratch
  for (const ch of 'bi') m.feed(ch);
  assert.deepEqual(m.feed('t'), { id: 'bit' });
  assert.equal(m.tailText(), '');
});

test('host: an auto-repeated ArrowUp (e.repeat) never fires dance, and a held key adds nothing to either tail', () => {
  eggs.length = 0;
  const { self } = rig();
  self.cheatKey({ key: 'ArrowUp', target: body });
  for (let i = 0; i < 8; i++) self.cheatKey({ key: 'ArrowUp', target: body, repeat: true });
  assert.deepEqual(eggs, [], 'one real press plus eight repeats is not a double press');
  self.cheatKey({ key: 'ArrowUp', target: body });
  assert.deepEqual(eggs, ['dance'], 'a second real press still fires it');
  // repeats do not build a typed code either
  eggs.length = 0;
  self.cheatKey({ key: 'b', target: body }); self.cheatKey({ key: 'i', target: body });
  self.cheatKey({ key: 'i', target: body, repeat: true });
  self.cheatKey({ key: 't', target: body });
  assert.deepEqual(eggs, ['bit'], 'a repeated i is ignored, bit still completes');
});
