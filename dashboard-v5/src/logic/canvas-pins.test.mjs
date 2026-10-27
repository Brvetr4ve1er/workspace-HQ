// Canvas Pin to Home + stat card drawing (IPC-CONTRACT 2026-10-27): the pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinKey, togglePin, pinnedWidgets, CANVAS_PIN_MAX } from './canvas-pins.mjs';
import { drawStatCard, CARD_W, CARD_H } from './stat-card-draw.mjs';

const W = (board, id, title) => ({ board, id, title: title || id, type: 'note' });

test('pinKey: board/id, or empty when either is missing', () => {
  assert.equal(pinKey(W('Ideas', 'n-1')), 'Ideas/n-1');
  assert.equal(pinKey(W('Ideas', '')), '');
  assert.equal(pinKey(W('', 'n-1')), '');
  assert.equal(pinKey(null), '');
});

test('togglePin pins, unpins, and refuses past the cap without changing anything', () => {
  let r = togglePin([], 'A/1');
  assert.deepEqual(r, { pins: ['A/1'], full: false });
  r = togglePin(r.pins, 'A/1');
  assert.deepEqual(r, { pins: [], full: false });
  const full = Array.from({ length: CANVAS_PIN_MAX }, (_, i) => 'A/' + i);
  assert.deepEqual(togglePin(full, 'B/x'), { pins: full, full: true });
  assert.deepEqual(togglePin(full, 'A/0').pins.length, CANVAS_PIN_MAX - 1);
  assert.deepEqual(togglePin(['A/1', 7], ''), { pins: ['A/1'], full: false });
});

test('pinnedWidgets keeps pin order and drops pins whose node is gone', () => {
  const ws = [W('A', '1'), W('A', '2'), W('B', '1')];
  assert.deepEqual(pinnedWidgets(['B/1', 'A/9', 'A/1'], ws).map(pinKey), ['B/1', 'A/1']);
  assert.deepEqual(pinnedWidgets(undefined, ws), []);
});

test('drawStatCard writes the level, every stat and the date onto the canvas', () => {
  const texts = [], rects = [];
  const g = { fillRect: (...a) => rects.push(a), strokeRect: () => {}, fillText: (t) => texts.push(t), measureText: (t) => ({ width: t.length * 10 }) };
  drawStatCard(g, { level: 7, title: 'Builder', date: '27 Oct 2026', stats: [{ k: 'Tasks done (all time)', v: '42' }, { k: 'Scan streak', v: '4 days' }] });
  assert.ok(texts.includes('Level 7 · Builder'));
  for (const t of ['Tasks done (all time)', '42', 'Scan streak', '4 days', '27 Oct 2026']) assert.ok(texts.includes(t), t);
  assert.deepEqual(rects[0], [0, 0, CARD_W, CARD_H]);
});

test('drawStatCard shortens text that would overflow', () => {
  const texts = [];
  const g = { fillRect() {}, strokeRect() {}, fillText: (t) => texts.push(t), measureText: (t) => ({ width: t.length * 40 }) };
  drawStatCard(g, { level: 3, title: 'x'.repeat(80), stats: [], date: '' });
  const title = texts.find((t) => t.startsWith('Level 3'));
  assert.ok(title.endsWith('…') && title.length * 40 <= CARD_W - 128 + 40, title);
});
