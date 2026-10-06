// The DOM-free half of dc-lite: expression resolution, attribute
// interpolation and React's inline-style rules. The template walker and the
// patcher need a DOM and are exercised by the CDP harness instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, compileAttr, styleMap, renderErrorPanel, failures, unresolved } from './runtime.js';

const vals = { a: { b: [{ c: 'deep' }] }, n: 0, t: true, s: 'x', list: ['p', 'q'], k: 1 };

test('resolve: dotted paths, indexes and holes', () => {
  assert.equal(resolve(vals, 'a.b.0.c'), 'deep');
  assert.equal(resolve(vals, 'list[k]'), 'q');
  assert.equal(resolve(vals, 'a.missing.deeper'), undefined);
  assert.equal(resolve(vals, 'nope'), undefined);
});

test('resolve: literals, negation, equality, parentheses', () => {
  assert.equal(resolve(vals, 'true'), true);
  assert.equal(resolve(vals, '42'), 42);
  assert.equal(resolve(vals, "'hi'"), 'hi');
  assert.equal(resolve(vals, '!n'), true);
  assert.equal(resolve(vals, "s === 'x'"), true);
  assert.equal(resolve(vals, '(n) !== 0'), false);
});

test('compileAttr: a whole binding keeps its type; mixed text interpolates', () => {
  const fn = () => 1;
  assert.equal(compileAttr('{{ f }}')({ f: fn }), fn);
  assert.equal(compileAttr('width:{{ w }}%;color:{{ c }}')({ w: 40 }), 'width:40%;color:');
  assert.equal(compileAttr('static')({}), 'static');
});

// runtime-2: an attribute binding (onClick, src, style, disabled…) whose bare path resolves to
// undefined is a hole, so the selftest's unresolved === 0 gate sees a dead handler. null is an
// intentional absence (the attribute is removed) and is not a hole; neither is an expression.
test('compileAttr: an undefined bare path in an attribute is a hole; null and expressions are not', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    unresolved.clear();
    assert.equal(compileAttr('{{ snipp }}')({ snip: () => 1 }), undefined);
    assert.equal(compileAttr('{{ a.missing }}')(vals), undefined);
    assert.equal(compileAttr('width:{{ w }}%;color:{{ c.x }}')({ w: 40 }), 'width:40%;color:');
    assert.deepEqual([...unresolved].sort(), ['a.missing', 'c.x', 'snipp']);
    unresolved.clear();
    assert.equal(compileAttr('{{ current }}')({ current: null }), null);
    assert.equal(compileAttr('{{ n }}')(vals), 0);
    assert.equal(compileAttr('{{ !nope }}')({}), true);
    assert.equal(compileAttr("{{ s === 'y' }}")(vals), false);
    assert.equal(compileAttr('x {{ a ? b : c }}')({}), 'x ');
    assert.deepEqual([...unresolved], []);
  } finally { unresolved.clear(); console.warn = warn; }
});

test('styleMap: strings keep declarations; objects follow React (px, unitless, custom props)', () => {
  assert.deepEqual(styleMap('Color:red; --x: 1 ;bad;margin:'), { color: 'red', '--x': '1' });
  assert.deepEqual(styleMap({ height: 30, opacity: 0.5, zIndex: 3, flex: 1, marginLeft: 0, WebkitLineClamp: '2', '--gap': 4, gap: null }),
    { height: '30px', opacity: '0.5', 'z-index': '3', flex: '1', 'margin-left': '0', '-webkit-line-clamp': '2', '--gap': '4' });
});

// The first-render error panel, against a stub DOM whose innerHTML throws:
// the message must arrive as text, never as markup.
test('renderErrorPanel: message as text, Reload button, replaces the root', () => {
  assert.deepEqual(failures, { count: 0, last: '' });
  class Node {
    constructor(tag) { this.tag = tag; this.style = {}; this.attrs = {}; this.kids = []; this.text = ''; this.on = {}; }
    set innerHTML(_) { throw new Error('innerHTML used'); }
    set textContent(v) { this.text = String(v); this.kids = []; }
    get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(t, f) { this.on[t] = f; }
    append(...n) { this.kids.push(...n); }
    replaceChildren(...n) { this.kids = n; }
  }
  const root = new Node('div'); root.ownerDocument = { createElement: (t) => new Node(t) };
  root.append(new Node('stale'));
  const box = renderErrorPanel(root, new Error('<img src=x onerror=alert(1)> bad bundle'));
  assert.deepEqual(root.kids, [box]);
  assert.equal(box.attrs['data-dc'], 'error');
  assert.ok(box.textContent.includes('<img src=x onerror=alert(1)> bad bundle'));
  const btn = box.kids.find((k) => k.tag === 'button');
  assert.equal(btn.textContent, 'Reload');
  let reloaded = 0; globalThis.location = { reload: () => reloaded++ };
  try { btn.on.click(); } finally { delete globalThis.location; }
  assert.equal(reloaded, 1);
});

// Regression (review): fail()/the panel turned the thrown value into text with String(), which itself throws
// for a null-prototype object or a throwing toString — the panel then never showed (a blank window again).
test('errorText never throws, and the error panel survives any thrown value', async () => {
  const { errorText } = await import('./runtime.js');
  assert.equal(errorText(new Error('bad bundle')), 'bad bundle');
  assert.equal(errorText('plain string'), 'plain string');
  assert.equal(errorText(null), 'null');
  assert.equal(errorText(Object.create(null)), '[object Object]');
  assert.equal(errorText({ toString() { throw new Error('nope'); } }), '[object Object]');
  assert.equal(errorText({ get message() { throw new Error('nope'); } }), '[object Object]');
  const doc = { createElement: (tag) => ({ tag, style: {}, kids: [], set textContent(v) { this.text = String(v); }, setAttribute() {}, addEventListener() {}, append(...n) { this.kids.push(...n); } }) };
  const root = { ownerDocument: doc, replaceChildren(...n) { this.kids = n; } };
  const box = renderErrorPanel(root, Object.create(null));
  assert.deepEqual(root.kids, [box]);
  assert.ok(box.kids.some((k) => k.text === '[object Object]'));
});
