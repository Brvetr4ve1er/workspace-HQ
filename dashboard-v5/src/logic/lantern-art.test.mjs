// node --test dashboard-v5/src/logic/lantern-art.test.mjs
// The Lantern look's cards (batch 11): the 22 glyphs as plain path strings (a fixed table, token colours only), the stable card for a project id, the five
// readout cards whose bottom line equals the Workbench readout for the same number, the face-down card for a number not read yet, the render values (ONE
// key, lntv; off is one frozen constant), the template (binds only lntv and the shape loop variable, wraps itself so the look-off page has no node), where
// the hosts carry it, and the committed never-appears word list. No DOM, no storage, no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import {
  ARCANA, KIND_CARD, LNT_EMPTY_ART, LNT_SEALED, LNT_TOKENS, LNT_VIEWBOX, bindCard, bindProject, bindSealed, cardFor,
} from './lantern-art.mjs';
import { WBN_KINDS, READOUTS } from './workbench-art.mjs';
import { lanternVals, LNT_OFF } from '../vals/lantern.js';
import { workbenchVals, workbenchNumbers, WBN_OFF, WBN_LANTERN } from '../vals/workbench.js';
import { lntArt } from '../tpl/lantern.tpl.js';
import { WBN_EMPTY_ART } from './workbench-art.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V5 = resolve(HERE, '../..');
const read = (rel) => readFileSync(resolve(V5, rel), 'utf8');
const ON = { on: true, look: 'lantern' };
const valsOn = (S = {}, ctx = {}, self = {}) => lanternVals.call({ state: {}, ...self }, { S: { consoleLayer: ON, ...S }, rows: [], ...ctx }).lntv;

const GLYPH_ORDER = ['door', 'infinity', 'eye', 'cradle', 'crown', 'chalice', 'rings', 'chariot', 'claws', 'lantern', 'wheel', 'scales', 'hanged', 'hourglass', 'temperance', 'devil', 'tower', 'star', 'moon', 'sun', 'bell', 'world'];
const NAME_ORDER = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune',
  'Justice', 'The Hanged Man', 'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World'];
const ROMAN_ORDER = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

// ---- the table ----------------------------------------------------------------------------------------------------------------------------
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
/** parses a path string into [command, numbers[]] groups; null when anything outside the path grammar appears or an argument count is wrong */
function parsePath(d) {
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(d)) return null;
  const groups = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m, last = 0;
  while ((m = re.exec(d))) {
    if (d.slice(last, m.index).replace(/[\s,]/g, '')) return null;
    last = re.lastIndex;
    if (m[1]) groups.push([m[1], []]);
    else if (!groups.length) return null;
    else groups[groups.length - 1][1].push(Number(m[2]));
  }
  if (d.slice(last).replace(/[\s,]/g, '')) return null;
  if (!groups.length || groups[0][0].toLowerCase() !== 'm') return null;
  for (const [c, nums] of groups) {
    const need = ARGS[c.toUpperCase()];
    if (need === 0 ? nums.length !== 0 : nums.length === 0 || nums.length % need !== 0) return null;
  }
  return groups;
}

test('exactly 22 cards, in tarot order from The Fool to The World, each with its own glyph, a roman number and a traditional name', () => {
  assert.equal(ARCANA.length, 22);
  assert.deepEqual(ARCANA.map((a) => a.glyph), GLYPH_ORDER);
  assert.deepEqual(ARCANA.map((a) => a.name), NAME_ORDER);
  assert.deepEqual(ARCANA.map((a) => a.roman), ROMAN_ORDER);
  assert.deepEqual(ARCANA.map((a) => a.n), Array.from({ length: 22 }, (_, i) => i));
  assert.equal(Object.isFrozen(ARCANA), true);
  for (const a of ARCANA) { assert.equal(Object.isFrozen(a), true); assert.equal(Object.isFrozen(a.shapes), true); }
});

test('every glyph shape is a path made only of path commands with the right argument counts, drawn from the owner table (no primitive, no script)', () => {
  for (const a of ARCANA) {
    assert.ok(a.shapes.length >= 1 && a.shapes.length <= 6, a.glyph + ' has ' + a.shapes.length + ' shapes');
    for (const s of a.shapes) {
      assert.notEqual(parsePath(s.d), null, a.glyph + ': ' + s.d);
      assert.doesNotMatch(s.d, /[<>"'=;]/, 'nothing but path data');
      assert.ok(['butt', 'round'].includes(s.cap), a.glyph + ' cap ' + s.cap);
      if (s.stroke === 'none') assert.equal(s.sw, 0, a.glyph + ': an unstroked shape has no width');
      else assert.ok(s.sw >= 2 && s.sw <= 6, a.glyph + ': the owner stroke width ' + s.sw);
      assert.ok(s.fill !== 'none' || s.stroke !== 'none', a.glyph + ': a shape paints something');
    }
  }
  // the owner's widths and caps are carried, not replaced by a house style: only the claws are round, and the door lintel is 3 wide
  assert.deepEqual(ARCANA.filter((a) => a.shapes.some((s) => s.cap === 'round')).map((a) => a.glyph), ['claws']);
  assert.equal(ARCANA[0].shapes[2].sw, 3);
  assert.equal(ARCANA[8].shapes[0].sw, 6);
  assert.deepEqual(ARCANA.filter((a) => a.shapes.some((s) => s.sw === 4)).map((a) => a.glyph).slice(0, 3), ['infinity', 'eye', 'crown']);
});

test('the parser the table is tested with refuses what is not a path (a sanity check of the test itself)', () => {
  assert.equal(parsePath('M0 0h10v10z') !== null, true);
  assert.equal(parsePath('M0 0 L'), null);
  assert.equal(parsePath('h10'), null, 'must start with a move');
  assert.equal(parsePath('M0 0 a1 1 0 0 1 2'), null, 'an arc needs seven numbers');
  assert.equal(parsePath('M0 0 <script>'), null);
});

test('colours are the app tokens only: a shape carries var(--...) or none, never a literal colour; the source holds none either', () => {
  const shapes = [...ARCANA.flatMap((a) => a.shapes), ...bindCard('cleared', 1).shapes, ...LNT_SEALED.shapes];
  for (const s of shapes) {
    assert.ok(LNT_TOKENS.includes(s.fill), 'fill ' + s.fill);
    assert.ok(LNT_TOKENS.includes(s.stroke), 'stroke ' + s.stroke);
  }
  for (const t of LNT_TOKENS) assert.ok(t === 'none' || /^var\(--[a-z0-9-]+\)$/.test(t), t);
  const src = read('src/logic/lantern-art.mjs');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour');
  assert.doesNotMatch(src, /\b(rgb|rgba|hsl|hsla)\(/, 'no functional colour');
  assert.doesNotMatch(read('src/tpl/lantern.tpl.js').replace(/<!--[\s\S]*?-->/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'the template holds no hex colour either');
  // the glyphs use ink, bone, blood and brass only; the blood drops are on the chalice, the stream, the tower fire
  const used = new Set(ARCANA.flatMap((a) => a.shapes.flatMap((s) => [s.fill, s.stroke])));
  assert.deepEqual([...used].sort(), ['none', 'var(--lnt-blood)', 'var(--lnt-brass)', 'var(--lnt-card)', 'var(--lnt-glyph)']);
});

test('the module is pure: one import (the readout words), no file or network read, no listener, timer or frame, no random and no clock', () => {
  const src = read('src/logic/lantern-art.mjs');
  const code = src.replace(/\/\/[^\n]*/g, '');
  assert.deepEqual([...code.matchAll(/^\s*import\s[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]), ['./workbench-art.mjs']);
  assert.doesNotMatch(code, /\b(readFile|readFileSync|fetch|XMLHttpRequest|require|addEventListener|setTimeout|setInterval|requestAnimationFrame|document|window|localStorage|Date\.now|Math\.random)\b/);
});

// ---- the stable card for a project -------------------------------------------------------------------------------------------------------
function fnv1a(s) {   // an independent reading of the same hash (BigInt, no Math.imul)
  let h = 0x811c9dc5n;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x01000193n) & 0xffffffffn; }
  return h;
}

test('cardFor: FNV-1a (32 bit) of the id, modulo 22; stable, in range, the same for the same id', () => {
  for (const id of ['', 'a', 'proj-alpha', 'x'.repeat(300), 'é-ü-项目']) assert.equal(cardFor(id), Number(fnv1a(id) % 22n), JSON.stringify(id.slice(0, 12)));
  assert.equal(fnv1a('a'), 0xe40c292cn, 'the published FNV-1a vector for "a"');
  assert.equal(cardFor('a'), Number(0xe40c292cn % 22n));
  const a = cardFor('invented-project');
  for (let i = 0; i < 5; i++) assert.equal(cardFor('invented-project'), a);
  for (const bad of [null, undefined, 7, {}]) assert.ok(cardFor(bad) >= 0 && cardFor(bad) < 22, String(bad));
});

test('cardFor spreads over the deck: 100 invented ids reach at least 15 of the 22 cards', () => {
  const hit = new Set(Array.from({ length: 100 }, (_, i) => cardFor('invented-project-' + String(i).padStart(3, '0'))));
  assert.ok(hit.size >= 15, 'only ' + hit.size + ' different cards');
  for (const n of hit) assert.ok(Number.isInteger(n) && n >= 0 && n <= 21);
});

test('bindProject: the same id is the same picture; the spoken name is "Arcana <roman>, <name>"; the bottom line is the card name; no id, no card', () => {
  const tower = Array.from({ length: 400 }, (_, i) => 'p-' + i).find((id) => cardFor(id) === 16);
  const p = bindProject(tower);
  assert.equal(p.aria, 'Arcana XVI, The Tower');
  assert.equal(p.title, 'The Tower');
  assert.equal(p.label, 'THE TOWER');
  assert.equal(p.roman, 'XVI');
  assert.deepEqual(bindProject(tower), p, 'stable');
  assert.deepEqual([p.show, p.sealed, p.face], [true, false, 'up']);
  const fool = Array.from({ length: 400 }, (_, i) => 'q-' + i).find((id) => cardFor(id) === 0);
  assert.equal(bindProject(fool).aria, 'Arcana 0, The Fool');
  for (const none of ['', null, undefined, 3, {}]) assert.equal(bindProject(none), LNT_EMPTY_ART);
});

test('every picture has the same shape: the frame first, then the glyph, unique keys, the same card box', () => {
  const FRAME_N = 2;
  for (const a of ARCANA) {
    const id = Array.from({ length: 600 }, (_, i) => 'k' + i).find((x) => cardFor(x) === a.n);
    const p = bindProject(id);
    assert.equal(p.viewBox, '0 0 120 200');
    assert.equal(LNT_VIEWBOX, '0 0 120 200');
    assert.equal(p.shapes.length, FRAME_N + a.shapes.length, a.glyph);
    assert.deepEqual(p.shapes.slice(0, FRAME_N).map((s) => s.d), bindProject('another-id-' + a.n).shapes.slice(0, FRAME_N).map((s) => s.d), 'the same frame on every card');
    assert.deepEqual(p.shapes.slice(FRAME_N).map((s) => s.d), a.shapes.map((s) => s.d), a.glyph + ' draws its own glyph');
    assert.equal(new Set(p.shapes.map((s) => s.key)).size, p.shapes.length, 'unique keys');
    assert.deepEqual(Object.keys(p).sort(), ['aria', 'face', 'label', 'roman', 'sealed', 'shapes', 'show', 'title', 'viewBox']);
  }
  assert.deepEqual(Object.keys(LNT_EMPTY_ART).sort(), Object.keys(bindProject('x')).sort(), 'the empty picture has every key a real one has');
});

// ---- the five readout cards ---------------------------------------------------------------------------------------------------------------
test('the five hosts get their cards: The Hermit, The Lovers, The High Priestess, The Sun, The World', () => {
  assert.deepEqual({ ...KIND_CARD }, { cleared: 9, skills: 6, notes: 2, needyou: 19, projects: 21 });
  assert.deepEqual(WBN_KINDS.map((k) => ARCANA[KIND_CARD[k]].name), ['The Hermit', 'The Lovers', 'The High Priestess', 'The Sun', 'The World']);
  assert.deepEqual(WBN_KINDS.map((k) => ARCANA[KIND_CARD[k]].glyph), ['lantern', 'rings', 'eye', 'sun', 'world']);
});

test('each readout card says the Workbench readout for the same number, floored and clamped; the spoken name starts with it, then names the card', () => {
  for (const k of WBN_KINDS) for (const n of [0, 1, 7, 42, 99999, 100000, 3.9, -4, NaN]) {
    const c = bindCard(k, n);
    const want = READOUTS[k](Math.max(0, Math.min(99999, Number.isFinite(n) ? Math.floor(n) : 0)), false);
    assert.equal(c.label, want, k + ' ' + n);
    assert.equal(c.aria, want.toLowerCase() + ', card: ' + ARCANA[KIND_CARD[k]].name);
    assert.deepEqual([c.show, c.sealed, c.face], [true, false, 'up']);
  }
  assert.equal(bindCard('cleared', 3).aria, '3 cleared, card: The Hermit');
  assert.equal(bindCard('needyou', 0).label, '0 NEED YOU');
  assert.equal(bindCard('notes', 4000, true).label, '4000+ NOTES');
  assert.equal(bindCard('notes', 4000, true).aria, '4000+ notes, card: The High Priestess');
  assert.equal(bindCard('skills', 3, true).label, '3 SKILLS', 'only the notes readout has a plus');
  assert.equal(bindCard('nope', 3), LNT_EMPTY_ART, 'an unknown kind draws nothing');
});

test('a sealed card carries no number at all: the word SEALED, no roman, a spoken name that says it is face down; it is one frozen constant', () => {
  const s = bindSealed();
  assert.equal(s, LNT_SEALED);
  assert.deepEqual([s.show, s.sealed, s.face], [true, true, 'sealed']);
  assert.equal(s.aria, 'Not read yet, card face down');
  assert.equal(s.label, 'SEALED');
  assert.equal(s.roman, '');
  for (const k of ['aria', 'label', 'roman', 'title']) assert.doesNotMatch(s[k], /\d/, k + ' holds no number');
  assert.equal(Object.isFrozen(s), true);
  assert.ok(s.shapes.length >= 8);
});

// ---- the render values ----------------------------------------------------------------------------------------------------------------------
test('lntv: ONE top-level key, the same key set off and on, off is one frozen constant that reads nothing', () => {
  assert.deepEqual(Object.keys(LNT_OFF), ['lntv']);
  const on = valsOn();
  assert.deepEqual(Object.keys(on).sort(), Object.keys(LNT_OFF.lntv).sort());
  for (const k of [...WBN_KINDS, 'project']) assert.deepEqual(Object.keys(on[k]).sort(), Object.keys(LNT_OFF.lntv[k]).sort(), k + ' has the same keys off and on');
  assert.equal(lanternVals.call({ state: {} }, { S: {} }), LNT_OFF);
  assert.equal(lanternVals.call({ state: {} }, { S: { consoleLayer: { on: true } } }), LNT_OFF);
  assert.equal(lanternVals.call({ state: {} }, { S: { consoleLayer: { on: false, look: 'lantern' } } }), LNT_OFF, 'the layer off: no look, whatever is stored');
  assert.equal(lanternVals.call({ state: {} }, { S: { consoleLayer: { on: true, look: 'workbench' } } }), LNT_OFF, 'the Workbench look is not Lantern');
  assert.equal(lanternVals.call({ state: {} }, { S: { consoleLayer: { on: true, skin: true, look: 'lantern' } } }), LNT_OFF, 'a stored pair is the skin, not the look');
  assert.equal(Object.isFrozen(LNT_OFF.lntv), true);
  assert.equal(LNT_OFF.lntv.lntOn, false);
  assert.equal(on.lntOn, true);
  for (const k of [...WBN_KINDS, 'project']) assert.equal(LNT_OFF.lntv[k], LNT_EMPTY_ART);
  const trap = { get bhsData() { throw new Error('read while off'); }, get route() { throw new Error('read while off'); }, consoleLayer: { on: true } };
  assert.doesNotThrow(() => lanternVals.call({ state: trap }, { S: trap }));
});

test('lntv: the five numbers are the ones the Workbench look reads (imported, not copied); every readout equals its input', () => {
  const S = { bhsData: { clearedThisWeek: 7 }, crw: { rows: [{}, {}, {}, {}, {}] }, vdk: { data: { recent: ['a'], noteCount: 87, noteCountCapped: false } } };
  const ctx = { rows: [{}, {}] };
  const on = valsOn(S, ctx);
  const n = workbenchNumbers({ ...S, consoleLayer: ON }, ctx);
  assert.deepEqual(n, { cleared: 7, skills: 5, notes: 87, needyou: 0, projects: 2 });
  assert.equal(on.cleared.label, '7 CLEARED');
  assert.equal(on.skills.label, '5 SKILLS');
  assert.equal(on.notes.label, '87 NOTES');
  assert.equal(on.needyou.label, '0 NEED YOU');
  assert.equal(on.projects.label, '2 PROJECTS');
  for (const k of WBN_KINDS) assert.equal(on[k].label, READOUTS[k](n[k], false), k + ' is the same words as the Workbench look');
  assert.match(read('src/vals/lantern.js'), /import \{ workbenchNumbers \} from '\.\/workbench\.js'/);
  assert.doesNotMatch(read('src/vals/lantern.js'), /clearedThisWeek|bhsData|\.crw\b|noteCount\b/, 'no second copy of the number reading');
  assert.equal(valsOn({ vdk: { data: { recent: [{}], noteCount: 4000, noteCountCapped: true } } }).notes.label, '4000+ NOTES');
});

test('lntv: a number not read yet is the face-down back, never a false 0; once it is read the card is face up; the empty Brief line is always a real 0', () => {
  const none = valsOn({}, { rows: undefined });
  for (const k of ['cleared', 'skills', 'notes', 'projects']) {
    assert.equal(none[k], LNT_SEALED, k + ' is sealed before its number is read');
    assert.equal(none[k].sealed, true);
    assert.doesNotMatch(none[k].label + none[k].aria, /\d/);
  }
  assert.equal(none.needyou.sealed, false);
  assert.equal(none.needyou.label, '0 NEED YOU');
  const read1 = valsOn({ bhsData: { clearedThisWeek: 0 }, crw: { rows: [] }, vdk: { data: { recent: [], noteCount: 0 } } }, { rows: [] });
  for (const k of ['cleared', 'skills', 'notes', 'projects']) { assert.equal(read1[k].sealed, false, k); assert.equal(read1[k].face, 'up'); assert.match(read1[k].label, /^0 /, 'a real 0 is shown face up'); }
  // a failed read keeps the old answer in state but the card goes back to its sealed back
  const failed = valsOn({ bhsData: { clearedThisWeek: 7 }, bhsErr: 'read failed' });
  assert.equal(failed.cleared, LNT_SEALED);
});

test('lntv: the project card is the page project\'s own card (the same rule the project page uses), empty with no page open', () => {
  const projects = [{ id: 'first-id' }, { id: 'second-id' }];
  const self = { projectsAt: () => [{ id: 'second-id' }, { id: 'third-id' }, { id: 'first-id' }] };
  assert.equal(valsOn({}, { onPage: false, projects }, self).project, LNT_EMPTY_ART, 'no page, no card');
  assert.equal(valsOn({ route: null }, { onPage: true, projects }, self).project, LNT_EMPTY_ART);
  const p = valsOn({ route: { id: 'second-id' } }, { onPage: true, off: 0, projects }, self).project;
  assert.deepEqual(p, bindProject('second-id'));
  assert.equal(valsOn({ route: { id: 'third-id' } }, { onPage: true, off: 0, projects }, self).project.aria, bindProject('third-id').aria, 'a project in the page list but not the live list');
  // the route names nothing the page knows: the page shows the first project, so the card is the first project's
  assert.deepEqual(valsOn({ route: { id: 'gone-id' } }, { onPage: true, off: 0, projects }, self).project, bindProject('first-id'), 'the page falls back to the first project, and so does the card');
  assert.equal(valsOn({ route: { id: 'gone-id' } }, { onPage: true, off: 0, projects: [] }, self).project, LNT_EMPTY_ART);
  // an id that is not text has no card
  assert.equal(valsOn({ route: { id: 5 } }, { onPage: true, off: 0, projects: [{ id: 7 }] }, { projectsAt: () => [] }).project, LNT_EMPTY_ART);
  // the same project, the same card, on every render
  const a = valsOn({ route: { id: 'second-id' } }, { onPage: true, off: 0, projects }, self);
  assert.equal(valsOn({ route: { id: 'second-id' } }, { onPage: true, off: 0, projects }, self), a);
});

test('lntv: the cards are rebuilt only when an input changes (same numbers and project, same object)', () => {
  const a = valsOn({ bhsData: { clearedThisWeek: 2 } });
  assert.equal(valsOn({ bhsData: { clearedThisWeek: 2 } }), a);
  const b = valsOn({ bhsData: { clearedThisWeek: 3 } });
  assert.notEqual(b, a);
  assert.equal(b.cleared.label, '3 CLEARED');
});

test('wbnv under Lantern: the attribute owner answers "lantern" with no Workbench picture; Workbench and off answers are unchanged', () => {
  const v = (cl) => workbenchVals.call({ state: {} }, { S: { consoleLayer: cl }, rows: [] });
  assert.equal(v({ on: true, look: 'lantern' }), WBN_LANTERN);
  assert.equal(WBN_LANTERN.wbnv.wbnLook, 'lantern');
  assert.equal(WBN_LANTERN.wbnv.wbnOn, false);
  for (const k of WBN_KINDS) assert.equal(WBN_LANTERN.wbnv[k], WBN_EMPTY_ART, k);
  assert.deepEqual(Object.keys(WBN_LANTERN.wbnv).sort(), Object.keys(WBN_OFF.wbnv).sort());
  assert.equal(Object.isFrozen(WBN_LANTERN) && Object.isFrozen(WBN_LANTERN.wbnv), true);
  assert.equal(v({ on: true, look: 'workbench' }).wbnv.wbnLook, 'workbench');
  assert.equal(v({ on: false, look: 'lantern' }), WBN_OFF, 'the layer off: the attribute is empty');
  assert.equal(v(null), WBN_OFF);
  assert.match(read('src/tpl/shell.tpl.js'), /data-hq-look="\{\{ wbnv\.wbnLook \}\}"/, 'the shell template is unchanged: the attribute is still bound from wbnv');
});

// ---- the template ----------------------------------------------------------------------------------------------------------------------
const bindings = (text) => [...text.matchAll(/\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]);
const dig = (obj, path) => path.split('.').reduce((o, k) => (o !== null && o !== undefined && typeof o === 'object' && k in o ? o[k] : undefined), obj);
const KINDS6 = [...WBN_KINDS, 'project'];

test('template: each fragment wraps itself in lntv.<kind>.show (no node while the look is off), balances its tags and names the card for a screen reader', () => {
  for (const k of KINDS6) {
    const t = lntArt(k);
    assert.ok(t.startsWith(String.raw`<sc-if value="{{ lntv.` + k + String.raw`.show }}"`), "wrapped in the picture's own show flag");
    assert.match(t, /<\/sc-if>$/);
    assert.equal((t.match(/<sc-if/g) || []).length, 1);
    for (const tag of ['span', 'svg', 'sc-for']) assert.equal((t.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length, (t.match(new RegExp('</' + tag + '>', 'g')) || []).length, k + ' ' + tag + ' balanced');
    assert.match(t, new RegExp('role="img" aria-label="\\{\\{ lntv\\.' + k + '\\.aria \\}\\}"'));
    assert.match(t, /<svg [^>]*aria-hidden="true"/, 'the drawing is hidden from a screen reader, the wrapper speaks once');
    assert.match(t, /data-lnt="roman" aria-hidden="true"/);
    assert.match(t, /data-lnt="readout" aria-hidden="true"/);
    assert.match(t, new RegExp('data-lnt="art-' + k + '"'));
    assert.match(t, new RegExp('data-lnt-face="\\{\\{ lntv\\.' + k + '\\.face \\}\\}"'));
    assert.doesNotMatch(t, /<style/, 'no style text, so no {{ }} can ever be turned into a node inside one');
    assert.doesNotMatch(t, /<(button|a|input)\b/, 'a card takes no clicks and no focus');
    assert.equal((t.match(/<path /g) || []).length, 1, 'paths only: one path element, looped');
    assert.doesNotMatch(t, /<(rect|circle|ellipse|line|polyline|polygon|text)\b/, 'the template draws paths only');
  }
});

test('template: every binding is a dotted path that resolves against the real vals, on and off, for all six cards', () => {
  const on = valsOn({ bhsData: { clearedThisWeek: 2 }, crw: { rows: [{}] }, vdk: { data: { state: 'ready', recent: [{}] } }, route: { id: 'p-1' } }, { onPage: true, off: 0, projects: [{ id: 'p-1' }], rows: [{}] }, { projectsAt: () => [{ id: 'p-1' }] });
  for (const k of KINDS6) {
    const seen = [];
    for (const raw of bindings(lntArt(k))) {
      if (raw === 'true' || raw === 'false') continue;   // the designer hints
      assert.match(raw, /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/, 'dc-lite dotted path only: ' + raw);
      seen.push(raw);
      for (const [name, scope] of [['on', { lntv: on, p: on[k].shapes[0] }], ['off', { lntv: LNT_OFF.lntv, p: { d: '', fill: '', stroke: '', sw: 0, cap: '' } }]]) {
        assert.notEqual(dig(scope, raw), undefined, name + ' unresolved: ' + raw);
      }
    }
    assert.ok(seen.every((e) => /^(lntv|p)\./.test(e)), k + ' binds only lntv and the shape variable');
    assert.ok(seen.some((e) => e === 'lntv.' + k + '.shapes'));
  }
  const t = lntArt('cleared');
  assert.match(t, /style="fill:\{\{ p\.fill \}\};stroke:\{\{ p\.stroke \}\};stroke-width:\{\{ p\.sw \}\};stroke-linecap:\{\{ p\.cap \}\}"/, 'the paint is a token bound inside style, the cap too');
  assert.doesNotMatch(t, /\sfill="\{\{/);
});

test('hosts: each of the five fragments sits right after the Workbench picture in its host and nowhere else, and the project card heads the project page', () => {
  const host = { cleared: 'src/tpl/brief-history.tpl.js', skills: 'src/tpl/crew.tpl.js', notes: 'src/tpl/vault-desk.tpl.js', needyou: 'src/tpl/brief.tpl.js', projects: 'src/tpl/shelf.tpl.js' };
  for (const [k, f] of Object.entries(host)) {
    const text = read(f);
    assert.match(text, /import \{ lntArt \} from '\.\/lantern\.tpl\.js'/, f);
    assert.equal((text.match(new RegExp("\\$\\{wbnArt\\('" + k + "'\\)\\}\\$\\{lntArt\\('" + k + "'\\)\\}", 'g')) || []).length, 1, f + ' carries ' + k + ' right after its Workbench picture');
    assert.equal((text.match(/lntArt\(/g) || []).length, 1, f + ' carries exactly one card');
  }
  const pp = read('src/tpl/project-page.tpl.js');
  assert.match(pp, /import \{ lntArt \} from '\.\/lantern\.tpl\.js'/);
  assert.equal((pp.match(/\$\{lntArt\('project'\)\}/g) || []).length, 1);
  assert.ok(pp.indexOf("lntArt('project')") < pp.indexOf('pg.back'), 'the card heads the page, before the back button');
  assert.ok(pp.indexOf("lntArt('project')") > pp.indexOf('v.project'), 'inside the project page branch');
});

// ---- the never-appears word list; the layer rule; the public repo ---------------------------------------------------------------------------
test('word list: no title, place, currency, studio or stat term of the game behind the owner\'s own art wiki appears anywhere in the app source, the styles or the cdp files (phrases, whole words). This file holds the list; it is the one place allowed to.', () => {
  const DENY = [
    // the game, its add-on, its studio
    'bloodborne', 'the old hunters', 'fromsoftware', 'from software',
    // its city, its hub dream, its currency, its dungeon term, its stat when written as a game term
    'yharnam', 'hunters dream', 'hunter\'s dream', 'blood echoes', 'blood echo', 'chalice dungeon', 'insight stat', 'insight points', 'insight level', 'insight meter',
  ];
  const SELF = resolve(HERE, 'lantern-art.test.mjs');
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.git') walk(p, out); }
      else if (/\.(m?js|css|html|json|md)$/.test(name)) out.push(p);
    }
    return out;
  };
  const files = [...walk(resolve(V5, 'src')), ...walk(resolve(V5, 'styles')), resolve(V5, 'tools/cdp-lantern.mjs'), resolve(V5, 'tools/cdp-lantern.test.mjs')].filter((f) => resolve(f) !== SELF);
  assert.ok(files.length > 200, 'the walk found ' + files.length + ' files');
  const rx = DENY.map((w) => [w, new RegExp('(^|[^a-z0-9])' + w.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + '([^a-z0-9]|$)')]);
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8').toLowerCase(); } catch { continue; }   // a file that is not there yet (a later dish) has nothing to find
    for (const [w, re] of rx) assert.ok(!re.test(text), relative(V5, f) + ' names an outside title or term: ' + w);
  }
});

test('word list: the consoles and brands the Workbench look refuses are refused in the Lantern files too', () => {
  const DENY = ['nintendo', 'famicom', 'sega', 'sony', 'playstation', 'dreamcast', 'xbox', 'atari', 'microsoft', 'zelda', 'mario', 'pokemon', 'minecraft'];
  for (const f of ['styles/lantern.css', 'src/logic/lantern-art.mjs', 'src/vals/lantern.js', 'src/tpl/lantern.tpl.js']) {
    const text = read(f).toLowerCase();
    for (const w of DENY) assert.ok(!new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)').test(text), f + ' names an outside brand or title: ' + w);
  }
});

test('layer rule: no Lantern renderer file registers a listener, timer or frame (the layer is the only place that may)', () => {
  for (const f of ['src/logic/lantern-art.mjs', 'src/vals/lantern.js', 'src/tpl/lantern.tpl.js']) {
    const code = read(f).replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /addEventListener|setTimeout|setInterval|requestAnimationFrame|<link\b|createElement/, f);
  }
});

test('public repo: the Lantern files hold no owner path, vault, account, studio or project name, and no web address', () => {
  for (const f of ['styles/lantern.css', 'src/logic/lantern-art.mjs', 'src/vals/lantern.js', 'src/tpl/lantern.tpl.js']) {
    const text = read(f);
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\\Users\\|@[a-z0-9-]+\.(com|net|org)\b|https?:\/\//i, f);
  }
});
