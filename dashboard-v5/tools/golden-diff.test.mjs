// golden-diff: a golden re-record is allowed only when every changed value path is attributed (Claude Hub H5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffPaths, compareDirs } from './golden-diff.mjs';

test('diffPaths: names every changed leaf, added and removed keys and array slots', () => {
  assert.deepEqual(diffPaths({ a: 1, b: [1, 2], c: { d: 'x' } }, { a: 1, b: [1, 2, 3], c: { d: 'y' }, e: true }), ['b[2]', 'c.d', 'e']);
  assert.deepEqual(diffPaths([1], { 0: 1 }), ['(root)']);
  assert.deepEqual(diffPaths({ a: null }, { a: {} }), ['a']);
  assert.deepEqual(diffPaths({ x: [{ y: 1 }] }, { x: [{ y: 1 }] }), []);
});

test('compareDirs: unexplained paths, added and removed scenarios', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-gdiff-'));
  try {
    const b = path.join(root, 'b'), a = path.join(root, 'a');
    fs.mkdirSync(b); fs.mkdirSync(a);
    const w = (d, n, v) => fs.writeFileSync(path.join(d, n + '.json'), JSON.stringify(v));
    w(b, 's1', { askSources: [1] }); w(a, 's1', { askSources: [1, 2] });
    w(b, 's2', { x: 1 }); w(a, 's2', { x: 2 });
    w(b, 'gone', {}); w(a, 'new', {});
    const r = compareDirs(b, a, [/^askSources\[\d+\]$/]);
    assert.deepEqual(r.changed, { s1: ['askSources[1]'], s2: ['x'] });
    assert.deepEqual(r.unexplained, { s2: ['x'] });
    assert.deepEqual(r.added, ['new']);
    assert.deepEqual(r.removed, ['gone']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
