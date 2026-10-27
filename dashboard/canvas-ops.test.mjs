// dashboard/canvas-ops.test.mjs — Claude › Canvas Remove (IPC-CONTRACT 2026-10-27). Temp dirs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanvasRemove, createCanvasCreate, createCanvasClear } = require('./canvas-ops.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-canvas-ops-'));
  const board = { nodes: [{ id: 'a', type: 'text', text: 'Alpha', x: 0, y: 0 }, { id: 'b', type: 'text', text: 'Beta', x: 0, y: 0 }, { id: 'c', type: 'text', text: 'Gamma', x: 0, y: 0 }],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'c', toNode: 'a' }, { id: 'e3', fromNode: 'b', toNode: 'c' }], extra: 'kept' };
  fs.writeFileSync(path.join(dir, 'Ideas.canvas'), JSON.stringify(board, null, 1));
  return { dir, remove: createCanvasRemove(dir, () => new Date('2026-01-02T03:04:05.000Z')) };
}
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('removes one node and the edges that touch it, keeps the rest of the board, logs the removal first', () => {
  const { dir, remove } = setup();
  assert.deepEqual(remove('Ideas', 'a'), { ok: true, board: 'Ideas', id: 'a', edges: 2 });
  const b = read(dir, 'Ideas.canvas');
  assert.deepEqual(b.nodes.map((n) => n.id), ['b', 'c']);
  assert.deepEqual(b.edges.map((e) => e.id), ['e3']);
  assert.equal(b.extra, 'kept');
  assert.equal(fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8'), JSON.stringify(b, null, 1));   // the hq:canvas-add serialization
  const log = fs.readFileSync(path.join(dir, 'removed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], { at: '2026-01-02T03:04:05.000Z', board: 'Ideas', node: { id: 'a', type: 'text', text: 'Alpha', x: 0, y: 0 }, edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'c', toNode: 'a' }] });
  assert.equal(fs.existsSync(path.join(dir, 'Ideas.canvas.tmp')), false);
});

test('refuses bad names, missing ids, unknown boards and nodes without touching anything', () => {
  const { dir, remove } = setup();
  const before = fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8');
  assert.deepEqual(remove('../Ideas', 'a'), { error: 'bad board name' });
  assert.deepEqual(remove('Ideas.canvas', 'a'), { error: 'bad board name' });
  assert.deepEqual(remove('NUL', 'a'), { error: 'bad board name' });
  assert.deepEqual(remove('Ideas', ''), { error: 'node id required' });
  assert.deepEqual(remove('Ideas', 7), { error: 'node id required' });
  assert.deepEqual(remove('Ideas', 'x'.repeat(121)), { error: 'node id required' });
  assert.deepEqual(remove('Nope', 'a'), { error: 'no board named Nope' });
  assert.deepEqual(remove('Ideas', 'zz'), { error: 'unknown node' });
  assert.equal(fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'removed.jsonl')), false);
});

test('a board without edges still works', () => {
  const { dir, remove } = setup();
  fs.writeFileSync(path.join(dir, 'Bare.canvas'), JSON.stringify({ nodes: [{ id: 'n1', type: 'text', text: 'x' }] }));
  assert.deepEqual(remove('Bare', 'n1'), { ok: true, board: 'Bare', id: 'n1', edges: 0 });
  assert.deepEqual(read(dir, 'Bare.canvas'), { nodes: [], edges: [] });
});

test('create writes an empty board, never over an existing one (case-insensitive)', () => {
  const { dir } = setup();
  const create = createCanvasCreate(dir);
  assert.deepEqual(create('Plans'), { ok: true, board: 'Plans' });
  assert.equal(fs.readFileSync(path.join(dir, 'Plans.canvas'), 'utf8'), JSON.stringify({ nodes: [], edges: [] }, null, 1));
  assert.deepEqual(create('plans'), { error: 'a board named plans already exists' });
  const before = fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8');
  assert.deepEqual(create('Ideas'), { error: 'a board named Ideas already exists' });
  assert.equal(fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8'), before);
  for (const bad of ['', '../x', 'a.b', 'NUL', 'x'.repeat(65)]) assert.deepEqual(create(bad), { error: 'bad board name' }, bad);
  const fresh = path.join(dir, 'new-dir');
  assert.deepEqual(createCanvasCreate(fresh)('First'), { ok: true, board: 'First' });
});

test('clear logs every node and edge, then empties the board and keeps its other keys', () => {
  const { dir } = setup();
  const clear = createCanvasClear(dir, () => new Date('2026-01-02T03:04:05.000Z'));
  const before = read(dir, 'Ideas.canvas');
  assert.deepEqual(clear('Ideas'), { ok: true, board: 'Ideas', nodes: 3, edges: 3 });
  assert.deepEqual(read(dir, 'Ideas.canvas'), { nodes: [], edges: [], extra: 'kept' });
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'removed.jsonl'), 'utf8').trim());
  assert.deepEqual(log, { at: '2026-01-02T03:04:05.000Z', board: 'Ideas', cleared: true, nodes: before.nodes, edges: before.edges });
  assert.deepEqual(clear('Nope'), { error: 'no board named Nope' });
  assert.deepEqual(clear('../Ideas'), { error: 'bad board name' });
});
