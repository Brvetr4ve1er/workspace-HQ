// Cosmos templates (tpl/cosmos.tpl.js, tpl/cosmos-overlays.tpl.js) against the Cosmos vals (vals/cosmos.js).
// A typo in a template binding renders as a dead control and only the Electron selftest would notice; this reads both fragments
// as text, resolves every {{ binding }} the way dc/runtime.js does against a fully-populated vals object, and checks the
// markup rules the spec fixes (hooks, dialog labels, stacking, button types, no window./fetch, theme tokens only).
//
//   node --test dashboard-v5/src/logic/cosmos-bindings.test.mjs
//
// Plain Node: no DOM. The fragments are parsed with small regexes, not rendered; the render itself belongs to the cdp scenarios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import feedTpl from '../tpl/cosmos.tpl.js';
import overlaysTpl from '../tpl/cosmos-overlays.tpl.js';
import { resolve } from '../dc/runtime.js';
import { cosmosVals, COS_OFF } from '../vals/cosmos.js';
import { cosmosLogic, cosInitState } from './cosmos.js';
import { SORT_MODES } from './cosmos-search.mjs';
import { GROUP_MODES } from './cosmos-group.mjs';
import { emptyCosmos } from '../live/cosmos-slice.mjs';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAGMENTS = { 'tpl/cosmos.tpl.js': feedTpl, 'tpl/cosmos-overlays.tpl.js': overlaysTpl };
const SOURCES = Object.fromEntries(Object.keys(FRAGMENTS).map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

// ---- the fully-populated vals: Feed with groups, lightbox on an imported file (title edit, trash question armed), index overlay
// running with a summary, import report with conflicts and the replace question armed ----------------------------------------------
const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const W = (n, extra) => ({
  id: 'w' + n, rel: 'sub/w' + n + '.png', title: 'work ' + n, type: n % 2 ? 'photo' : 'video', video: n % 2 === 0, width: 400, height: 300, tags: ['alpha', 'beta'],
  createdAt: '2026-0' + (n % 9 + 1) + '-01T00:00:00.000Z', url: 'file:///alpha-site/w' + n + '.png', thumbUrl: 'file:///data/thumbs/w' + n + '.jpg', color: { hex: '#336699' }, ...(extra || {}),
});
const WORKS = [W(1), W(2), W(3), W(4, { rel: 'imports:drop-4.png' }), W(5)];

function onVals() {
  const live = { cosmos: Object.assign(emptyCosmos(), {
    loaded: true, state: 'ready', config: { root: 'alpha-site', indexedAt: new Date(NOW - 30 * 86400000).toISOString() }, works: WORKS,
    curation: { version: 1, clusters: [], favorites: { w1: 1 }, hidden: { w2: 1 }, overrides: {}, }, revision: 1,
    indexing: { phase: 'thumbs', done: 3, total: 5 }, summary: { elements: 5, thumbsFailed: 1, minted: 2 },
    report: { clusters: 1, favorites: 2, hidden: 1, overrides: 1, found: 3, missingIds: ['x1', 'x2'], missingCount: 2, conflicts: 2, token: 'tok', note: 'Imported from the backup' },
  }) };
  const self = Object.assign(Object.create(cosmosLogic), { state: {}, hq: { cosmos: {} }, store: { refreshCosmos() {} }, LIVE: live });
  const stub = Object.getOwnPropertyNames(cosmosLogic).filter((k) => /^cos/.test(k) && typeof cosmosLogic[k] === 'function' && k !== 'cosGridRef');
  const calls = [];
  for (const m of stub) self[m] = (...a) => { calls.push([m, ...a]); };
  const S = { tab: 'cosmos', route: null, ...cosInitState(), cosGroup: 'type', cosFav: false, cosShowHidden: true, cosLb: { id: 'w4', edit: 'title', draft: 'x', trashAsk: true }, cosIdx: true, cosReportOpen: true, cosReplaceAsk: true };
  const ctx = { S, LIVE: live, live: true, tabStyle: (a) => ({ on: a }), today: '2026-11-08', nowMs: NOW };
  return { vals: cosmosVals.call(self, ctx), calls };
}
const ON = onVals().vals;

// ---- the template reader --------------------------------------------------------------------------------------------------------------
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const bindings = (t) => [...t.matchAll(/\{\{([\s\S]+?)\}\}/g)].map((m) => m[1].trim());
const loops = (t) => [...t.matchAll(/<sc-for\b[^>]*?\blist="\{\{\s*([^}]+?)\s*\}\}"[^>]*?\bas="([^"]+)"/g)].map((m) => ({ list: m[1], as: m[2] }));
// expression -> the identifier paths it reads (literals, ! and ===/!== sides handled; the dialect has nothing else)
function paths(expr) {
  return expr.split(/===|!==|==|!=/).map((s) => s.trim().replace(/^!+/, '').replace(/^\(|\)$/g, '').trim())
    .filter((s) => s && !/^(true|false|null|undefined)$/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) && !/^(['"]).*\1$/.test(s));
}

const scopeFor = (t) => {
  const scope = { ...ON, v: { cosmos: true } };
  for (const l of loops(t)) {
    const list = resolve(ON, l.list);
    assert.ok(Array.isArray(list) && list.length > 0, 'the fully-populated vals must give ' + l.list + ' an item to check ' + l.as + '.* against');
    scope[l.as] = list[0];
  }
  return scope;
};

test('the fragments are non-empty default-exported strings', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    assert.equal(typeof t, 'string', f);
    assert.ok(t.length > 2000, f + ' is suspiciously small');
  }
});

test('the fully-populated vals really has the lists and flags the check needs', () => {
  assert.ok(ON.cosOn && ON.cosHasCards && ON.cosCards.length === 5 && ON.cosHeaders.length > 0);
  assert.ok(ON.cosLbOpen && ON.cosLbEditing && ON.cosLbCanTrash && ON.cosLbTrashAsk && ON.cosLbTags.length === 2);
  assert.ok(ON.cosIdxOpen && ON.cosIdxRunning && ON.cosIdxHasSummary);
  assert.ok(ON.cosRepOpen && ON.cosRepLines.length > 0 && ON.cosRepMissing.length === 2 && ON.cosRepAsk);
});

test('every binding root is a key of the ON vals and of the frozen OFF object (or a loop variable, or v.cosmos)', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const vars = new Set(loops(t).map((l) => l.as));
    for (const b of bindings(t)) {
      for (const p of paths(b)) {
        const root = p.match(/^[A-Za-z_$][\w$]*/);
        assert.ok(root, f + ': cannot read a root from {{ ' + b + ' }}');
        const name = root[0];
        if (vars.has(name)) continue;
        if (name === 'v') { assert.equal(p, 'v.cosmos', f + ': the only shared root a Cosmos fragment may read is v.cosmos, got {{ ' + b + ' }}'); continue; }
        assert.ok(Object.prototype.hasOwnProperty.call(ON, name), f + ': {{ ' + b + ' }} is not a key of the ON vals');
        assert.ok(Object.prototype.hasOwnProperty.call(COS_OFF, name), f + ': {{ ' + b + ' }} is not a key of the frozen OFF vals');
      }
    }
  }
});

test('every binding resolves (not undefined) against the populated vals, loop items included - the selftest hole check, run here', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const scope = scopeFor(t);
    const holes = bindings(t).filter((b) => resolve(scope, b) === undefined);
    assert.deepEqual(holes, [], f + ': bindings that never resolve');
  }
});

test('loop variable names are unique within a fragment (so the item check above is unambiguous)', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const names = loops(t).map((l) => l.as);
    assert.equal(new Set(names).size, names.length, f + ' reuses a sc-for variable name: ' + names.join(','));
  }
});

test('every event attribute and every ref is bound to a function in the vals', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const scope = scopeFor(t);
    const attrs = [...stripComments(t).matchAll(/\s(on[A-Z]\w*|ref)="\{\{\s*([^}]+?)\s*\}\}"/g)];
    assert.ok(attrs.length > 5, f + ' binds no handlers?');
    for (const m of attrs) assert.equal(typeof resolve(scope, m[2]), 'function', f + ': ' + m[1] + '="{{ ' + m[2] + ' }}" is not a function in the vals');
  }
});

test('the vals handlers the Feed host relies on do what the template expects (dragover and drop both preventDefault)', () => {
  const calls = [];
  const ev = { preventDefault() { calls.push('prevent'); }, dataTransfer: { files: [] } };
  ON.cosOnDragOver(ev);
  assert.deepEqual(calls, ['prevent']);
  ON.cosOnDrop(ev);   // cosDrop is stubbed on the rigged `this`
  assert.deepEqual(calls, ['prevent', 'prevent']);
});

test('no fragment names window. or fetch (a fragment binds to vals; the host and the actions are handlers)', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const code = stripComments(t);
    assert.ok(!/window\./.test(code), f + ' mentions window.');
    assert.ok(!/\bfetch\b/.test(code), f + ' mentions fetch');
    assert.ok(!/<script\b/i.test(code), f + ' has a script');
    assert.ok(!/\son[a-z]+="[^{]/.test(code.replace(/\son[A-Z]\w*=/g, '')), f + ' has an inline handler string');
  }
});

test('every <button> has a type attribute', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const tags = [...stripComments(t).matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.length > 10, f + ' has too few buttons to be right');
    const bad = tags.filter((x) => !/\stype="(button|submit)"/.test(x));
    assert.deepEqual(bad, [], f + ': buttons without a type');
  }
});

test('the markup is well formed: tags balance, no button inside a button, void elements left open', () => {
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const stack = [];
    for (const m of stripComments(t).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g)) {
      const [, close, tag, , selfClose] = m;
      if (close) {
        const top = stack.pop();
        assert.equal(top, tag, f + ': </' + tag + '> closes <' + top + '> (near "' + m[0] + '")');
      } else if (!VOID.has(tag) && !selfClose) {
        if (tag === 'button') assert.ok(!stack.includes('button'), f + ': a <button> inside a <button>');
        stack.push(tag);
      }
    }
    assert.deepEqual(stack, [], f + ': unclosed tags');
  }
});

test('every block carries a v5 marker comment with its reason', () => {
  assert.ok((SOURCES['tpl/cosmos.tpl.js'].match(/<!-- v5: [^>]+-->/g) || []).length >= 8);
  assert.ok((SOURCES['tpl/cosmos-overlays.tpl.js'].match(/<!-- v5: [^>]+-->/g) || []).length >= 4);
  for (const t of Object.values(FRAGMENTS)) for (const c of t.match(/<!--[\s\S]*?-->/g) || []) assert.match(c, /^<!-- v5: \S/, 'a comment without a v5 reason: ' + c);
});

test('dc-lite dialect only: no expression uses anything but dotted paths, !, ===, !== and literals', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    for (const b of bindings(t)) {
      assert.ok(/^[\w$.\s!=()'"-]+$/.test(b), f + ': {{ ' + b + ' }} uses syntax the runtime does not read');
      assert.ok(!/&&|\|\||\?|\+/.test(b), f + ': {{ ' + b + ' }}');
    }
  }
});

test('the button / input / label constants are the exact strings money.tpl.js inlines', () => {
  const money = readFileSync(join(SRC, 'tpl/money.tpl.js'), 'utf8');
  const line = (src, name) => (src.match(new RegExp('^const ' + name + ' = .*$', 'm')) || [''])[0];
  for (const [f, src] of Object.entries(SOURCES)) {
    for (const name of ['BTN', 'BTN_HOVER', 'GOLD', 'GOLD_HOVER', 'LABEL', 'INPUT', 'CARD', 'ROW']) {
      const mine = line(src, name);
      if (!mine) continue;
      // the Cosmos LABEL drops the money label's margin-bottom (rows here are inline); everything else is verbatim
      const theirs = line(money, name);
      if (name === 'LABEL') assert.ok(theirs.replace(';margin-bottom:10px', '') === mine, f + ': LABEL drifted from money.tpl.js');
      else assert.equal(mine, theirs, f + ': ' + name + ' drifted from money.tpl.js');
    }
  }
  assert.ok(line(SOURCES['tpl/cosmos.tpl.js'], 'BTN') && line(SOURCES['tpl/cosmos-overlays.tpl.js'], 'GOLD'));
});

test('theme tokens only: no literal colour but the gold button text and the dialog shadow', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const code = stripComments(t);
    const hex = (code.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => h.toLowerCase() !== '#1a0f0a');
    assert.deepEqual(hex, [], f + ': literal colours');
    const rgba = (code.match(/rgba?\([^)]*\)/g) || []).filter((r) => r !== 'rgba(0,0,0,.5)');
    assert.deepEqual(rgba, [], f + ': literal colours');
    assert.ok(!/\bstyle="[^"]*\b(?:background|color):\s*(?:white|black|red|green|blue)\b/.test(code), f);
  }
});

// ---- the DOM hooks the spec and the cdp scenarios use ---------------------------------------------------------------------------------
test('the Feed hooks exist: feed host, search, count, empty (with its reason), more, the cards, the grid', () => {
  const t = stripComments(feedTpl);
  assert.match(t, /<div data-cos="feed" data-drag="\{\{ cosp\.dragAttr \}\}" ref="\{\{ cosGridRef \}\}" onDragEnter="\{\{ cosp\.onDragEnter \}\}" onDragLeave="\{\{ cosp\.onDragLeave \}\}" onDragOver="\{\{ cosOnDragOver \}\}" onDrop="\{\{ cosOnDrop \}\}"/);
  assert.match(t, /<input data-cos="search"[^>]*aria-label="Search elements"[^>]*placeholder="word, tag:name, colour, #hex"/);
  assert.match(t, /<span data-cos="count"[^>]*>\{\{ cosCount \}\}<\/span>/);
  assert.match(t, /<div data-cos="empty" data-reason="\{\{ cosReason \}\}"/);
  for (const r of ['offline', 'error', 'loading']) assert.match(t, new RegExp('data-cos="empty" data-reason="' + r + '"'));
  assert.match(t, /<button type="button" data-cos="more" onClick="\{\{ cosMore \}\}"[^>]*>\{\{ cosMoreLabel \}\}<\/button>/);
  assert.match(t, /\{\{ cosLeft \}\}/);
  assert.match(t, /<button type="button" data-cos-card data-id="\{\{ c\.id \}\}" onClick="\{\{ c\.open \}\}"/);
  assert.match(t, /<div data-cos="grid" style="\{\{ cosGridStyle \}\}">/);
});

test('the Feed text the spec fixes is there: hint line, buttons, pills, banners', () => {
  const t = stripComments(feedTpl);
  for (const s of ['Drop pictures here to add them', 'Index a folder', 'Re-index', 'Import from Cosmos Local', 'favourites only', 'show hidden', 'Retry', 'Cancel']) assert.ok(t.includes('>' + s + '<'), 'missing: ' + s);
  for (const k of ['cosBannerRoot', 'cosBannerStale', 'cosBannerIndexing', 'cosBannerFailed', 'cosScrubbed', 'cosOfflineText', 'cosLoadingText', 'cosErrorText', 'cosErrorNote']) assert.ok(t.includes('{{ ' + k + ' }}'), 'unbound: ' + k);
  assert.ok(loops(feedTpl).some((l) => l.list === 'cosDensities'), 'no chip row for cosDensities');
  // sort and group are <select>s over their option lists (batch 5), not chip rows
  for (const [k, name] of [['cosSorts', 'sort'], ['cosGroups', 'group']]) {
    // an <sc-for> inside a <select> is dropped by the HTML parser: one <option> per mode is written out, each bound to <model>.sel.<mode>
    const modes = k === 'cosSorts' ? SORT_MODES : GROUP_MODES;
    for (const m of modes) assert.ok(t.includes('<option value="' + m + '" selected="{{ ' + k + '.sel.' + m + ' }}">'), 'no <option> for ' + k + ' ' + m);
    assert.ok(t.includes('<select data-cos="' + name + '" value="{{ ' + k + '.value }}" onChange="{{ ' + k + '.onChange }}"'), 'no <select> for ' + k);
  }
});

test('a card: lazy decoded <img> with the title as alt, a play badge for video, real star and eye buttons beside (not inside) the open button', () => {
  const t = stripComments(feedTpl);
  assert.match(t, /<img src="\{\{ c\.src \}\}" alt="\{\{ c\.alt \}\}" loading="lazy" decoding="async"/);
  assert.match(t, /<sc-if value="\{\{ c\.video \}\}"[^>]*><span[^>]*>▶<\/span>/);
  assert.match(t, /onClick="\{\{ c\.favGo \}\}"/);
  assert.match(t, /onClick="\{\{ c\.hideGo \}\}"/);
  assert.match(t, /style="\{\{ c\.box \}\}"/);
  assert.match(t, /style="\{\{ h\.box \}\}"/);
  // the card hovers and focuses as one unit
  assert.match(t, /style-hover="--cos-act:1" style-focus-within="--cos-act:1"/);
});

test('the three dialogs carry their aria labels and role', () => {
  for (const label of ['Cosmos element', 'Index a folder', 'Import report']) {
    assert.match(overlaysTpl, new RegExp('role="dialog"[^>]*aria-label="' + label + '"'), label);
  }
});

// the first z-index in the block that opens with `opener` up to the next top-level overlay block
function zOf(opener) {
  const at = overlaysTpl.indexOf(opener);
  assert.ok(at >= 0, 'no block ' + opener);
  const rest = overlaysTpl.slice(at + opener.length);
  const next = rest.search(/\n {2}<sc-if value="\{\{ cos(?:Lb|Idx|Rep)Open \}\}"/);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  return [...body.matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1]));
}

test('stacking: lightbox 990 (under the palette at 1000), index overlay and import report 1060 (over settings 1050, under What\'s new 1070)', () => {
  assert.deepEqual([...new Set(zOf('<sc-if value="{{ cosLbOpen }}"'))], [990]);
  assert.deepEqual([...new Set(zOf('<sc-if value="{{ cosIdxOpen }}"'))], [1060]);
  assert.deepEqual([...new Set(zOf('<sc-if value="{{ cosRepOpen }}"'))], [1060]);
  // the numbers the spec measures against really are what the other fragments use
  const read = (f) => readFileSync(join(SRC, 'tpl', f), 'utf8');
  assert.match(read('ov-palette.tpl.js'), /z-index:1000/);
  assert.match(read('ov-settings.tpl.js'), /z-index:1050/);
  assert.match(read('extras.tpl.js'), /z-index:1070/);
  assert.match(read('ov-ask.tpl.js'), /z-index:905/);
  assert.match(read('ov-focus.tpl.js'), /z-index:950/);
});

test('the lightbox: media from the original with the thumbnail beneath, title edit in place, tags, three actions, a guarded Recycle Bin, ends not wrapping', () => {
  const t = stripComments(overlaysTpl);
  assert.match(t, /<video controls preload="metadata"[^>]*src="\{\{ cosLbSrc \}\}"/);
  assert.match(t, /poster="\{\{ cosLbPoster \}\}"/);
  assert.match(t, /src="\{\{ cosLbFallbackSrc \}\}"/);
  assert.match(t, /<img data-cos="lb-image" data-size="\{\{ cosp\.lbSize\.mode \}\}" src="\{\{ cosLbSrc \}\}" alt="\{\{ cosLbAlt \}\}"/);
  assert.match(t, /<button type="button" data-cos="lb-size" onClick="\{\{ cosp\.lbSize\.toggle \}\}"/);
  assert.match(t, /<div data-cos="lb-failed"[^>]*>\{\{ cosp\.lbFailedText \}\}<\/div>/);
  assert.match(t, /onKeyDown="\{\{ cosLbTitleKey \}\}"/);
  assert.match(t, /onKeyDown="\{\{ cosLbTagKey \}\}"/);
  assert.match(t, /placeholder="add tags, comma separated"/);
  for (const s of ['Open in Explorer', 'Move to Recycle Bin', 'Yes', 'No', 'Save', 'Cancel']) assert.ok(t.includes('>' + s + '<'), 'missing: ' + s);
  assert.ok(t.includes('Move this file to the Recycle Bin?'));
  assert.match(t, /disabled="\{\{ !cosLbHasPrev \}\}"/);
  assert.match(t, /disabled="\{\{ !cosLbHasNext \}\}"/);
  // Yes is only reachable once armed; the arming button is only there for a trashable element, and only while not asked
  assert.match(t, /<sc-if value="\{\{ cosLbCanTrash \}\}"/);
  assert.match(t, /<sc-if value="\{\{ !cosLbTrashAsk \}\}"[^>]*><div><button type="button" data-cos="lb-trash" onClick="\{\{ cosLbTrashStart \}\}"/);
  assert.match(t, /<sc-if value="\{\{ cosLbTrashAsk \}\}"[\s\S]*?onClick="\{\{ cosLbTrashYes \}\}"/);
  // the facts the vals can give: type, dimensions (hidden when absent), date, path
  for (const k of ['cosLbType', 'cosLbDims', 'cosLbDate', 'cosLbFile', 'cosLbPos']) assert.ok(t.includes('{{ ' + k + ' }}'), 'unbound: ' + k);
});

test('the index overlay: folder, pick, start / re-index (disabled by the vals), cancel while running, progress, summary', () => {
  const t = stripComments(overlaysTpl);
  assert.match(t, /Choose folder\.\.\./);
  assert.match(t, /data-cos="idx-start" onClick="\{\{ cosIdxStart \}\}" disabled="\{\{ cosIdxStartOff \}\}"/);
  assert.match(t, /<sc-if value="\{\{ cosIdxRunning \}\}"[^>]*><button type="button" data-cos="idx-cancel" onClick="\{\{ cosIdxCancel \}\}"/);
  for (const k of ['cosIdxFolder', 'cosIdxProgress', 'cosIdxSummary']) assert.ok(t.includes('{{ ' + k + ' }}'), 'unbound: ' + k);
  assert.ok(t.includes('>Start<') && t.includes('>Re-index<'));
});

test('the import report: counts, missing ids, the fixed cleanup line, conflicts with a two-click replace that only Yes sends', () => {
  const t = stripComments(overlaysTpl);
  assert.ok(t.includes('Cleanup dismissals are not in the old backup, so dismissed duplicates will show again once.'));
  assert.ok(t.includes('{{ cosRepConflicts }} entries already here differ; yours were kept'));
  assert.ok(t.includes('Replace {{ cosRepConflicts }} entries with the backup’s?'));
  assert.match(t, /onClick="\{\{ cosRepReplaceStart \}\}"/);
  assert.match(t, /onClick="\{\{ cosRepReplaceYes \}\}"/);
  assert.match(t, /onClick="\{\{ cosRepReplaceNo \}\}"/);
  // the first button arms; Yes lives only inside the cosRepAsk block
  const ask = t.indexOf('<sc-if value="{{ cosRepAsk }}"');
  assert.ok(ask > 0 && t.indexOf('cosRepReplaceYes') > ask, 'Yes must sit inside the armed question');
  assert.ok(t.indexOf('cosRepReplaceStart') < ask);
  for (const k of ['cosRepNote', 'cosRepMissingText']) assert.ok(t.includes('{{ ' + k + ' }}'), 'unbound: ' + k);
  assert.ok(loops(overlaysTpl).some((l) => l.list === 'cosRepLines') && loops(overlaysTpl).some((l) => l.list === 'cosRepMissing'));
});

test('copy: no placeholder text left in the fragments', () => {
  for (const [f, t] of Object.entries(FRAGMENTS)) {
    const text = stripComments(t);
    for (const bad of ['Lorem', 'TODO', 'FIXME']) assert.ok(!text.includes(bad), f + ' contains ' + bad);
  }
});
