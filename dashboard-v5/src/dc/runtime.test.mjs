// The DOM-free half of dc-lite: expression resolution, attribute
// interpolation and React's inline-style rules. The template walker and the
// patcher need a DOM and are exercised by the CDP harness instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, compileAttr, styleMap } from './runtime.js';

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

test('styleMap: strings keep declarations; objects follow React (px, unitless, custom props)', () => {
  assert.deepEqual(styleMap('Color:red; --x: 1 ;bad;margin:'), { color: 'red', '--x': '1' });
  assert.deepEqual(styleMap({ height: 30, opacity: 0.5, zIndex: 3, flex: 1, marginLeft: 0, WebkitLineClamp: '2', '--gap': 4, gap: null }),
    { height: '30px', opacity: '0.5', 'z-index': '3', flex: '1', 'margin-left': '0', '-webkit-line-clamp': '2', '--gap': '4' });
});
