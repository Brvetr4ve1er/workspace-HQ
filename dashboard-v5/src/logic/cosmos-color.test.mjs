// Cosmos colour maths + family taxonomy. Ported from Cosmos Local's color.test.ts; placeholder values only.
//   node --test dashboard-v5/src/logic/cosmos-color.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, hexToRgb, rgbToHex, rgbToHsl, toColorSig, colorDistance, familyOf, hueFamilyIndex, isNeutral, isColorSig,
  HUE_FAMILIES, MONO_FAMILY,
} from './cosmos-color.mjs';

const sig = (hex) => { const { r, g, b } = hexToRgb(hex); return toColorSig(r, g, b); };

test('hex round trips, including the 3-digit form', () => {
  for (const [r, g, b] of [[18, 107, 82], [0, 0, 0], [255, 255, 255], [255, 0, 204], [1, 2, 3]]) {
    assert.deepEqual(hexToRgb(rgbToHex(r, g, b)), { r, g, b });
  }
  assert.deepEqual(hexToRgb('#f0c'), { r: 255, g: 0, b: 204 });
  assert.deepEqual(hexToRgb('f0c'), { r: 255, g: 0, b: 204 });
  assert.equal(rgbToHex(...Object.values(hexToRgb('#abc'))), '#aabbcc');
  assert.equal(rgbToHex(300, -5, 12.4), '#ff000c', 'channels clamp and round');
});

test('rgb to hsl on known colours', () => {
  const red = rgbToHsl(255, 0, 0);
  assert.equal(red.h, 0); assert.equal(red.s, 1); assert.equal(red.l, 0.5);
  const green = rgbToHsl(0, 255, 0);
  assert.equal(green.h, 120);
  const blue = rgbToHsl(0, 0, 255);
  assert.equal(blue.h, 240);
  const white = rgbToHsl(255, 255, 255);
  assert.deepEqual(white, { h: 0, s: 0, l: 1 });
  const grey = rgbToHsl(128, 128, 128);
  assert.equal(grey.s, 0);
  const pink = rgbToHsl(255, 0, 128); // hue wraps below 360, never negative
  assert.ok(pink.h > 300 && pink.h < 360);
  assert.ok(rgbToHsl(255, 0, 1).h > 350);
});

test('toColorSig carries hex, rgb and hsl', () => {
  const c = toColorSig(26, 107, 82);
  assert.equal(c.hex, '#1a6b52');
  assert.deepEqual([c.r, c.g, c.b], [26, 107, 82]);
  assert.ok(c.h > 150 && c.h < 170 && c.s > 0.5 && c.l > 0.2 && c.l < 0.3);
  assert.ok(isColorSig(c));
  assert.ok(!isColorSig(null) && !isColorSig({}) && !isColorSig({ h: 1, s: NaN, l: 0 }));
});

test('colorDistance is zero for equal colours, symmetric, wrap-aware and de-weights hue near grey', () => {
  const a = sig('#1a6b52'); const b = sig('#e03020');
  assert.equal(colorDistance(a, a), 0);
  assert.equal(colorDistance(a, b), colorDistance(b, a));
  assert.ok(colorDistance(a, b) > 0);
  const nearRed1 = sig('#ff0015'); const nearRed2 = sig('#ff1500'); const green = sig('#00ff2a');
  assert.ok(colorDistance(nearRed1, nearRed2) < colorDistance(nearRed1, green), 'hue 355 is close to hue 5');
  assert.ok(colorDistance(toColorSig(130, 120, 120), toColorSig(120, 120, 130)) < 0.15);
});

test('familyOf: pure red, teal, grey (MONO) and near-black', () => {
  assert.equal(familyOf(sig('#ff0000')), 'RED');
  assert.equal(familyOf(sig('#1a6b52')), 'TEAL');
  assert.equal(familyOf(sig('#00b39a')), 'TEAL');
  assert.equal(familyOf(sig('#8a8a8a')), 'MONO');
  assert.equal(familyOf(sig('#050505')), 'MONO');
  assert.equal(familyOf(sig('#000000')), 'MONO');
  assert.equal(familyOf(toColorSig(0, 128, 255)), 'BLUE');
  assert.equal(familyOf(toColorSig(120, 125, 122)), MONO_FAMILY.name);
  assert.ok(isNeutral(toColorSig(120, 125, 122)));
});

test('the wheel is twelve families, wrapping back to RED past 345', () => {
  assert.equal(HUE_FAMILIES.length, 12);
  assert.equal(hueFamilyIndex(0), 0);
  assert.equal(hueFamilyIndex(350), 0);
  assert.equal(hueFamilyIndex(359.9), 0);
  assert.equal(HUE_FAMILIES[hueFamilyIndex(170)].name, 'TEAL');
  assert.equal(HUE_FAMILIES[hueFamilyIndex(220)].name, 'BLUE');
  let last = -1;
  for (let h = 0; h < 345; h += 1) { const i = hueFamilyIndex(h); assert.ok(i >= last, 'indexes never go backwards'); last = i; }
});

test('every family name is upper-case and unique, MONO included', () => {
  const names = [...HUE_FAMILIES.map((f) => f.name), MONO_FAMILY.name];
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.equal(n, n.toUpperCase());
  const shorts = [...HUE_FAMILIES.map((f) => f.short), MONO_FAMILY.short];
  assert.equal(new Set(shorts).size, shorts.length);
  assert.ok(Object.isFrozen(HUE_FAMILIES) && Object.isFrozen(MONO_FAMILY));
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});
