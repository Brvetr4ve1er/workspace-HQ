// node --test dashboard-v5/src/logic/workbench-art.test.mjs
// The Workbench look's five small illustrations (batch 8): pure art from a fixed primitive table, token colours only, the five readouts and nothing
// else, readouts equal to their inputs, the render values (ONE key, wbnv; off is one frozen constant), the template (binds only wbnv and the shape
// loop variable, wraps itself so the look-off page has no node) and where the five hosts carry it. No DOM, no storage, no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  WBN_KINDS, WBN_PRIMS, WBN_TOKENS, WBN_VIEW, WBN_MAX, READOUTS, readoutCount, workbenchArt, bindArt, WBN_EMPTY_ART,
} from './workbench-art.mjs';
import { workbenchVals, workbenchNumbers, WBN_OFF } from '../vals/workbench.js';
import { wbnArt } from '../tpl/workbench.tpl.js';
import { stripLines } from './brief-history.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V5 = resolve(HERE, '../..');
const read = (rel) => readFileSync(resolve(V5, rel), 'utf8');

const EXPECT = { cleared: 'CLEARED', skills: 'SKILLS', notes: 'NOTES', needyou: 'NEED YOU', projects: 'PROJECTS' };
const ONE = { cleared: 'CLEARED', skills: 'SKILL', notes: 'NOTE', needyou: 'NEED YOU', projects: 'PROJECT' };   // one of a thing reads singular
const ON = { on: true, look: 'workbench' };
const valsOn = (S = {}, ctx = {}) => workbenchVals.call({ state: {} }, { S: { consoleLayer: ON, ...S }, rows: [], ...ctx }).wbnv;

// ---- the readouts ----------------------------------------------------------------------------------------------------------------------
test('exactly five readouts exist, and each label is "<number> <word>" with the documented word', () => {
  assert.deepEqual([...WBN_KINDS], ['cleared', 'skills', 'notes', 'needyou', 'projects']);
  assert.deepEqual(Object.keys(READOUTS).sort(), [...WBN_KINDS].sort());
  for (const k of WBN_KINDS) for (const n of [0, 1, 7, 42, 99999]) assert.equal(workbenchArt(k, n).label, n + ' ' + (n === 1 ? ONE[k] : EXPECT[k]), k + ' ' + n);
  assert.equal(workbenchArt('skills', 1).aria, '1 skill', 'the spoken name is singular too');
  assert.equal(workbenchArt('notes', 1).aria, '1 note');
  assert.equal(workbenchArt('projects', 1).aria, '1 project');
  assert.equal(workbenchArt('needyou', 0).label, '0 NEED YOU');
  assert.equal(workbenchArt('cleared', 3).label, '3 CLEARED');
});

test('the label is the number the host passed in: floored, clamped to 0..99999, and anything that is not a finite number reads 0', () => {
  assert.equal(readoutCount(12), 12);
  assert.equal(readoutCount(3.9), 3);
  assert.equal(readoutCount(-4), 0);
  assert.equal(readoutCount(100000), WBN_MAX);
  assert.equal(readoutCount(1e12), WBN_MAX);
  for (const bad of [NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true]) assert.equal(readoutCount(bad), 0, String(bad));
  for (const n of [0, 1, 12, 345, 99999]) assert.equal(workbenchArt('skills', n).n, n);
  assert.equal(workbenchArt('notes', 5).aria, '5 notes', 'the accessible name is the readout in lower case');
  assert.equal(workbenchArt('nope', 3), null, 'an unknown kind draws nothing');
});

// ---- the shapes ------------------------------------------------------------------------------------------------------------------------
test('every shape comes from the fixed primitive set and its path uses only the commands the table writes', () => {
  assert.deepEqual([...WBN_PRIMS], ['rect', 'line', 'circle', 'polyline']);
  for (const k of WBN_KINDS) {
    const a = workbenchArt(k, 3);
    assert.ok(a.shapes.length >= 6 && a.shapes.length <= 16, k + ' has ' + a.shapes.length + ' shapes');
    const keys = new Set();
    for (const s of a.shapes) {
      assert.ok(WBN_PRIMS.includes(s.prim), k + ': primitive ' + s.prim);
      assert.match(s.d, /^M[-0-9. ]+[MLhvaz0-9 .\-]*$/, k + ': path ' + s.d);
      assert.doesNotMatch(s.d, /[CcSsQqTt]/, k + ': no curve commands, only the four primitives');
      assert.equal(s.sw, 1.5, k + ': the thin outline');
      assert.ok(!keys.has(s.key), 'unique key ' + s.key);
      keys.add(s.key);
    }
    assert.equal(a.shapes.filter((s) => s.prim === 'rect').length >= 2, true, k + ' has a body and a screen');
  }
});

test('colours are the app tokens only: a shape carries var(--...) or none, never a literal colour; the source holds none either', () => {
  for (const k of WBN_KINDS) for (const s of workbenchArt(k, 1).shapes) {
    assert.ok(WBN_TOKENS.includes(s.fill), k + ' fill ' + s.fill);
    assert.ok(WBN_TOKENS.includes(s.stroke), k + ' stroke ' + s.stroke);
  }
  for (const t of WBN_TOKENS) assert.ok(t === 'none' || /^var\(--[a-z0-9-]+\)$/.test(t), t);
  const src = read('src/logic/workbench-art.mjs');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour');
  assert.doesNotMatch(src, /\b(rgb|rgba|hsl|hsla)\(/, 'no functional colour');
  const tpl = read('src/tpl/workbench.tpl.js');
  assert.doesNotMatch(tpl.replace(/<!--[\s\S]*?-->/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'the template holds no hex colour either');
});

test('the screen and its cursor sit inside the picture, the cursor inside the screen, and a picture is the same shape for the same number (pure)', () => {
  for (const k of WBN_KINDS) {
    const a = workbenchArt(k, 8);
    assert.ok(a.screen.x >= 0 && a.screen.y >= 0 && a.screen.x + a.screen.w <= WBN_VIEW.w && a.screen.y + a.screen.h <= WBN_VIEW.h, k + ' screen in the viewBox');
    assert.ok(a.cursor.x >= a.screen.x && a.cursor.y >= a.screen.y && a.cursor.x + a.cursor.w <= a.screen.x + a.screen.w && a.cursor.y + a.cursor.h <= a.screen.y + a.screen.h, k + ' cursor in the screen');
    assert.deepEqual(workbenchArt(k, 8), a, 'same input, same picture');
    assert.equal(a.viewBox, '0 0 ' + WBN_VIEW.w + ' ' + WBN_VIEW.h);
  }
  // the number changes the readout, never the drawing
  assert.deepEqual(workbenchArt('skills', 1).shapes, workbenchArt('skills', 500).shapes);
  // the five pictures are different from each other
  const ds = WBN_KINDS.map((k) => workbenchArt(k, 1).shapes.map((s) => s.d).join('|'));
  assert.equal(new Set(ds).size, 5);
});

test('the art module is pure and original: no import, no file or network read, no listener, timer or frame; hand-written coordinates only', () => {
  const src = read('src/logic/workbench-art.mjs');
  const code = src.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\b(readFile|readFileSync|fetch|XMLHttpRequest|require|addEventListener|setTimeout|setInterval|requestAnimationFrame|document|window|localStorage|Date\.now|Math\.random)\b/);
  assert.match(src, /traced/, 'the header says the pictures are not traced');
});

// ---- the render values -----------------------------------------------------------------------------------------------------------------
test('wbnv: ONE top-level key, the same key set off and on, off is one frozen constant that reads nothing', () => {
  assert.deepEqual(Object.keys(WBN_OFF), ['wbnv']);
  const on = valsOn();
  assert.deepEqual(Object.keys(on).sort(), Object.keys(WBN_OFF.wbnv).sort());
  for (const k of WBN_KINDS) assert.deepEqual(Object.keys(on[k]).sort(), Object.keys(WBN_OFF.wbnv[k]).sort(), k + ' has the same keys off and on');
  assert.equal(workbenchVals.call({ state: {} }, { S: { consoleLayer: { on: true } } }), WBN_OFF);
  assert.equal(workbenchVals.call({ state: {} }, { S: {} }), WBN_OFF);
  assert.equal(WBN_OFF.wbnv.wbnOn, false);
  assert.equal(WBN_OFF.wbnv.cleared, WBN_EMPTY_ART);
  assert.equal(on.wbnOn, true);
  assert.equal(on.wbnLook, 'workbench');
  // a throwing getter on the state is never touched while the look is off
  const trap = { get bhsData() { throw new Error('read while off'); }, consoleLayer: { on: true } };
  assert.doesNotThrow(() => workbenchVals.call({ state: trap }, { S: trap }));
});

test('wbnv: each readout shows a real number the app already holds (and 0 for the empty Brief)', () => {
  const S = {
    bhsData: { clearedThisWeek: 7 },
    crw: { rows: [{}, {}, {}, {}, {}] },
    vdk: { data: { recent: ['a', 'b', 'c'] } },
  };
  const on = valsOn(S, { rows: [{}, {}] });
  assert.equal(on.cleared.label, '7 CLEARED');
  assert.equal(on.skills.label, '5 SKILLS');
  assert.equal(on.notes.label, '3 NOTES');
  assert.equal(on.needyou.label, '0 NEED YOU');
  assert.equal(on.projects.label, '2 PROJECTS');
  assert.deepEqual(workbenchNumbers(S, { rows: [{}, {}] }), { cleared: 7, skills: 5, notes: 3, needyou: 0, projects: 2 });
  // nothing read yet: the number is unknown (null), so no picture is drawn and no false 0 is shown
  assert.deepEqual(workbenchNumbers({}, {}), { cleared: null, skills: null, notes: null, needyou: 0, projects: null });
  assert.deepEqual(workbenchNumbers({ bhsData: { clearedThisWeek: -3 }, crw: { rows: 'x' }, vdk: { data: { state: 'no-note', recent: null } } }, { rows: 5 }), { cleared: 0, skills: null, notes: null, needyou: 0, projects: null });
  const none = valsOn({}, { rows: undefined });
  for (const k of ['cleared', 'skills', 'notes', 'projects']) assert.equal(none[k].show, false, k + ' is not drawn before its number is read');
  assert.equal(none.needyou.show, true, 'the empty Brief line is always a real 0');
  assert.equal(valsOn({ bhsData: { clearedThisWeek: 0 } }).cleared.label, '0 CLEARED', 'a real 0 is shown');
  assert.equal(valsOn({ crw: { rows: [] } }).skills.show, true, 'a roster that was read and is empty is a real 0');
});

test('a good read then a failed read keeps the old answer in state but draws no cleared picture', () => {
  const good = { bhsData: { clearedThisWeek: 7 }, bhsErr: '' };
  assert.equal(workbenchNumbers(good, {}).cleared, 7);
  assert.equal(valsOn(good).cleared.show, true);
  const failed = { bhsData: { clearedThisWeek: 7 }, bhsErr: 'read failed' };   // a failed read sets bhsErr and leaves the old bhsData
  assert.equal(workbenchNumbers(failed, {}).cleared, null);
  assert.equal(valsOn(failed).cleared.show, false);
});

test('the cleared number is the one the Brief strip says: both read clearedThisWeek of the same answer', () => {
  const D = { clearedThisWeek: 7, dismissedThisWeek: 0, entries: [], strip: { held: 3, pending: 0, cameBack: 0, clears: { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 0 }, open: 0, oldestOpen: null, outside: { count: 0 }, setAside: { count: 0, items: [], oldest: null } } };
  const line = stripLines(D)[0];
  assert.match(line, /^7 cleared this week/);
  const art = valsOn({ bhsData: D }).cleared;
  assert.equal(art.label, '7 CLEARED');
  assert.equal(Number(/^(\d+)/.exec(line)[1]), art.n, 'the strip line and the picture show the same count');
});

test('wbnv: the pictures are rebuilt only when a number changes (same numbers, same object)', () => {
  const a = valsOn({ bhsData: { clearedThisWeek: 2 } });
  assert.equal(valsOn({ bhsData: { clearedThisWeek: 2 } }), a);
  const b = valsOn({ bhsData: { clearedThisWeek: 3 } });
  assert.notEqual(b, a);
  assert.equal(b.cleared.label, '3 CLEARED');
});

test('bindArt: the readout box is a percentage of the picture, so it stays on the screen at any size; an unknown kind is the empty art', () => {
  const a = bindArt('skills', 4);
  assert.match(a.screenStyle, /position:absolute;left:[\d.]+%;top:[\d.]+%;width:[\d.]+%;height:[\d.]+%/);
  assert.match(a.screenStyle, /overflow:hidden/);
  assert.equal(a.cursorW, a.cursor.w);
  assert.equal(bindArt('nope', 1), WBN_EMPTY_ART);
  assert.equal(WBN_EMPTY_ART.label, '');
  assert.equal(Object.isFrozen(WBN_EMPTY_ART), true);
});

// ---- the template ----------------------------------------------------------------------------------------------------------------------
const bindings = (text) => [...text.matchAll(/\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]);
const dig = (obj, path) => path.split('.').reduce((o, k) => (o !== null && o !== undefined && typeof o === 'object' && k in o ? o[k] : undefined), obj);

test('template: each fragment wraps itself in wbnv.<kind>.show (no node while the look is off), balances its tags and names the picture for a screen reader', () => {
  for (const k of WBN_KINDS) {
    const t = wbnArt(k);
    assert.ok(t.startsWith(String.raw`<sc-if value="{{ wbnv.` + k + String.raw`.show }}"`), "wrapped in the picture's own show flag");
    assert.match(t, /<\/sc-if>$/);
    assert.equal((t.match(/<sc-if/g) || []).length, 1);
    for (const tag of ['span', 'svg', 'sc-for']) assert.equal((t.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length, (t.match(new RegExp('</' + tag + '>', 'g')) || []).length, k + ' ' + tag + ' balanced');
    assert.match(t, new RegExp('role="img" aria-label="\\{\\{ wbnv\\.' + k + '\\.aria \\}\\}"'));
    assert.match(t, /<svg [^>]*aria-hidden="true"/, 'the drawing is hidden from a screen reader, the wrapper speaks once');
    assert.match(t, /data-wbn="readout" aria-hidden="true"/);
    assert.match(t, new RegExp('data-wbn="art-' + k + '"'));
    assert.doesNotMatch(t, /<style/, 'no style text, so no {{ }} can ever be turned into a node inside one');
    assert.doesNotMatch(t, /<(button|a|input)\b/, 'a picture takes no clicks and no focus');
  }
});

test('template: every binding is a dotted path that resolves against the real vals (so the unresolved-path counter stays 0), on and off', () => {
  const on = valsOn({ bhsData: { clearedThisWeek: 2 }, crw: { rows: [{}] }, vdk: { data: { state: 'ready', recent: [{}] } } });
  for (const k of WBN_KINDS) {
    const seen = [];
    for (const raw of bindings(wbnArt(k))) {
      if (raw === 'true' || raw === 'false') continue;   // the designer hints
      assert.match(raw, /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/, 'dc-lite dotted path only: ' + raw);
      seen.push(raw);
      for (const [name, scope] of [['on', { wbnv: on, p: on[k].shapes[0] }], ['off', { wbnv: WBN_OFF.wbnv, p: { d: '', fill: '', stroke: '', sw: 0 } }]]) {
        assert.notEqual(dig(scope, raw), undefined, name + ' unresolved: ' + raw);
      }
    }
    assert.ok(seen.every((e) => /^(wbnv|p)\./.test(e)), k + ' binds only wbnv and the shape variable');
    assert.ok(seen.some((e) => e === 'wbnv.' + k + '.shapes'));
  }
  // the shape paint is bound inside style, as a token, never as a presentation attribute (those cannot hold var())
  const t = wbnArt('cleared');
  assert.match(t, /style="fill:\{\{ p\.fill \}\};stroke:\{\{ p\.stroke \}\};stroke-width:\{\{ p\.sw \}\}"/);
  assert.doesNotMatch(t, /\sfill="\{\{/);
});

test('hosts: each of the five fragments sits in exactly one host, and nowhere else', () => {
  const host = { cleared: 'src/tpl/brief-history.tpl.js', skills: 'src/tpl/crew.tpl.js', notes: 'src/tpl/vault-desk.tpl.js', needyou: 'src/tpl/brief.tpl.js', projects: 'src/tpl/shelf.tpl.js' };
  for (const [k, f] of Object.entries(host)) {
    const text = read(f);
    assert.match(text, /import \{ wbnArt \} from '\.\/workbench\.tpl\.js'/, f);
    assert.equal((text.match(new RegExp("\\$\\{wbnArt\\('" + k + "'\\)\\}", 'g')) || []).length, 1, f + ' carries ' + k);
    for (const other of WBN_KINDS.filter((x) => x !== k)) assert.equal(text.includes("wbnArt('" + other + "')"), false, f + ' must not carry ' + other);
  }
  // the readout meaning matches the host: the clean-board card, the Crew header, the Vault desk header, the empty Brief line, the empty Projects shelf line
  assert.match(read('src/tpl/brief-history.tpl.js'), /bhsCleanTitle \}\}<\/div>\s*\$\{wbnArt\('cleared'\)\}/);
  assert.match(read('src/tpl/crew.tpl.js'), /Crew<\/span>[\s\S]*?\$\{wbnArt\('skills'\)\}/);
  assert.match(read('src/tpl/vault-desk.tpl.js'), /Vault desk<\/span>[\s\S]*?\$\{wbnArt\('notes'\)\}/);
  assert.match(read('src/tpl/brief.tpl.js'), /brfEmptyText \}\}\$\{dlxAttract\}\$\{wbnArt\('needyou'\)\}/);
  assert.match(read('src/tpl/shelf.tpl.js'), /shfv\.emptyLine \}\}\$\{wbnArt\('projects'\)\}/);
});

// ---- no company or product names; the layer rule ---------------------------------------------------------------------------------------
test('art IP list: no console maker, game title, mascot or audio-gear brand appears in any file of this dish (a committed word list, whole words)', () => {
  const DENY = [
    // console and handheld makers
    'nintendo', 'famicom', 'sega', 'sony', 'playstation', 'dreamcast', 'xbox', 'atari', 'neo geo', 'gameboy', 'game boy', 'microsoft', 'bandai', 'namco', 'capcom', 'konami', 'tamagotchi',
    // game titles and characters
    'zelda', 'mario', 'metroid', 'sonic', 'tetris', 'pacman', 'pac-man', 'pokemon', 'pikachu', 'kirby', 'donkey kong', 'halo', 'minecraft',
    // audio gear and synth makers
    'roland', 'korg', 'moog', 'yamaha', 'akai', 'casio', 'technics', 'behringer', 'elektron', 'teenage engineering', 'pocket operator', 'op-1', 'mpc', 'tr-808', 'sp-404', 'walkman',
  ];
  const FILES = [
    'styles/workbench.css', 'src/logic/workbench-art.mjs', 'src/vals/workbench.js', 'src/tpl/workbench.tpl.js', 'src/logic/console-skin.js', 'src/vals/console-skin.js',
    'tools/cdp-workbench.mjs', 'tools/cdp-workbench.test.mjs', 'src/selftest-workbench.mjs',
  ];
  for (const f of FILES) {
    const text = read(f).toLowerCase();
    for (const w of DENY) assert.ok(!new RegExp('(^|[^a-z0-9])' + w.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(text), f + ' names an outside brand or title: ' + w);
  }
});

test('layer rule: no new Workbench renderer file registers a listener, timer or frame (the layer is the only place that may)', () => {
  for (const f of ['src/logic/workbench-art.mjs', 'src/vals/workbench.js', 'src/tpl/workbench.tpl.js']) {
    const code = read(f).replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /addEventListener|setTimeout|setInterval|requestAnimationFrame|<link\b|createElement/, f);
  }
});

test('public repo: the Workbench files hold no owner path, vault, account or project name', () => {
  for (const f of ['styles/workbench.css', 'src/logic/workbench-art.mjs', 'src/vals/workbench.js', 'src/tpl/workbench.tpl.js']) {
    const text = read(f);
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\\Users\\|@[a-z0-9-]+\.(com|net|org)\b/i, f);
  }
});
