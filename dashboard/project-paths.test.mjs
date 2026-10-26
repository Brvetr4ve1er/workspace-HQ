import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createResolver, trackedOutside } = createRequire(import.meta.url)('./project-paths.js');

const DOCS = 'C:\\Users\\tester\\Documents';
const latest = { projects: [{ path: 'alpha' }, { path: 'C:/Users/tester/Desktop/own repo' }, { path: 'C:/Users/tester/Documents/beta' }, null, { path: 7 }],
  archived_projects: [{ path: 'C:/Users/tester/Desktop/old' }] };
const resolve = createResolver({ docsRoot: DOCS, readLatest: () => latest });

test('inside Documents: absolute and legacy relative paths, as before', () => {
  assert.equal(resolve('alpha'), path.resolve(DOCS, 'alpha'));
  assert.equal(resolve('C:/Users/tester/Documents/anything'), path.resolve('C:/Users/tester/Documents/anything'));
  assert.equal(resolve(DOCS), path.resolve(DOCS));
});

test('outside Documents: only a tracked project path, exactly (case-insensitive)', () => {
  assert.equal(resolve('C:/Users/tester/Desktop/own repo'), path.resolve('C:/Users/tester/Desktop/own repo'));
  assert.equal(resolve('c:\\users\\tester\\desktop\\OWN REPO'), path.resolve('c:\\users\\tester\\desktop\\OWN REPO'));
  assert.equal(resolve('C:/Users/tester/Desktop/old'), path.resolve('C:/Users/tester/Desktop/old'));
  for (const bad of ['C:/Users/tester/Desktop', 'C:/Users/tester/Desktop/own repo/sub', 'C:/Users/tester/Desktop/own repo/..', 'C:/Windows', '../Desktop', 'C:/Users/tester/Documents2']) assert.equal(resolve(bad), null, bad);
  // a relative path that resolves to exactly the tracked folder is that folder
  assert.equal(resolve('../Desktop/own repo'), path.resolve('C:/Users/tester/Desktop/own repo'));
  assert.equal(resolve(''), null);
});

test('no latest.json: outside paths are refused', () => {
  const r = createResolver({ docsRoot: DOCS, readLatest: () => null });
  assert.equal(r('C:/Users/tester/Desktop/own repo'), null);
  assert.equal(trackedOutside(undefined, DOCS).size, 0);
});
