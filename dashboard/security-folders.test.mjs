// security-folders.js: which folders the plain-export name scan looks in. Placeholder roots only (an "Example Cloud" folder under an
// invented home); the real getPath is never called (an injected resolver). No Electron, no network, no file is read.
//   node --test dashboard/security-folders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveScanDirs, LOOKED } = require('./security-folders.js');

const WIN_HOME = 'C:\\Users\\Example';
const WIN_CLOUD = 'C:\\Users\\Example\\Example Cloud';
const win = (o) => resolveScanDirs({ env: {}, home: WIN_HOME, platform: 'win32', ...o });

test('no redirect: the three home folders, redirected 0, the looked labels are the three names', () => {
  const answers = { downloads: WIN_HOME + '\\Downloads', desktop: WIN_HOME + '\\Desktop', documents: WIN_HOME + '\\Documents' };
  const r = win({ getPath: (n) => answers[n] });
  assert.deepEqual(r.dirs, [WIN_HOME + '\\Downloads', WIN_HOME + '\\Desktop', WIN_HOME + '\\Documents']);
  assert.deepEqual(r.looked, ['Downloads', 'Desktop', 'Documents']);
  assert.equal(r.redirected, 0);
});

test('a redirected Desktop and Documents adds those AND the home ones; redirected counts the two moved folders', () => {
  const answers = { downloads: WIN_HOME + '\\Downloads', desktop: WIN_CLOUD + '\\Desktop', documents: WIN_CLOUD + '\\Documents' };
  const r = win({ getPath: (n) => answers[n] });
  assert.deepEqual(r.dirs, [
    WIN_HOME + '\\Downloads',
    WIN_CLOUD + '\\Desktop', WIN_HOME + '\\Desktop',
    WIN_CLOUD + '\\Documents', WIN_HOME + '\\Documents',
  ]);
  assert.equal(r.redirected, 2);
  assert.deepEqual(r.looked, ['Downloads', 'Desktop', 'Documents']);
});

test('identical answers dedupe; on win32 the comparison ignores case and a trailing separator', () => {
  const answers = { downloads: 'c:\\users\\EXAMPLE\\downloads\\', desktop: 'C:\\USERS\\Example\\Desktop', documents: WIN_HOME + '\\Documents' };
  const r = win({ getPath: (n) => answers[n] });
  assert.equal(r.dirs.length, 3);
  assert.equal(r.redirected, 0);
});

test('on a case-sensitive platform a different spelling is a different folder', () => {
  const r = resolveScanDirs({ env: {}, home: '/home/example', platform: 'linux', getPath: (n) => ({ downloads: '/home/example/downloads' }[n]) });
  assert.deepEqual(r.dirs, ['/home/example/downloads', '/home/example/Downloads', '/home/example/Desktop', '/home/example/Documents']);
  assert.equal(r.redirected, 1);
});

test('an empty, relative, non-string or throwing getPath is ignored and the three home folders are still scanned', () => {
  const home3 = [WIN_HOME + '\\Downloads', WIN_HOME + '\\Desktop', WIN_HOME + '\\Documents'];
  for (const bad of ['', '   ', 'Desktop', '.\\Desktop', null, undefined, 42, {}, ['C:\\x']]) {
    const r = win({ getPath: () => bad });
    assert.deepEqual(r.dirs, home3, 'answer ' + JSON.stringify(bad));
    assert.equal(r.redirected, 0);
  }
  const t = win({ getPath: () => { throw new Error('no app'); } });
  assert.deepEqual(t.dirs, home3);
  assert.equal(t.redirected, 0);
  // one throwing name does not stop the others
  const mixed = win({ getPath: (n) => { if (n === 'desktop') throw new Error('x'); return n === 'documents' ? WIN_CLOUD + '\\Documents' : WIN_HOME + '\\Downloads'; } });
  assert.deepEqual(mixed.dirs, [WIN_HOME + '\\Downloads', WIN_HOME + '\\Desktop', WIN_CLOUD + '\\Documents', WIN_HOME + '\\Documents']);
  assert.equal(mixed.redirected, 1);
});

test('outside Electron the default getPath throws and is ignored (no getPath injected)', () => {
  const r = resolveScanDirs({ env: {}, home: WIN_HOME, platform: 'win32' });
  assert.deepEqual(r.dirs, [WIN_HOME + '\\Downloads', WIN_HOME + '\\Desktop', WIN_HOME + '\\Documents']);
  assert.equal(r.redirected, 0);
});

test('HQ_SECURITY_SCAN_DIRS still wins, getPath is not even asked', () => {
  const a = path.resolve('example-a'), b = path.resolve('example-b');
  let asked = 0;
  const r = resolveScanDirs({ env: { HQ_SECURITY_SCAN_DIRS: [a, '', b].join(path.delimiter) }, getPath: () => { asked += 1; return WIN_CLOUD; }, home: WIN_HOME });
  assert.deepEqual(r.dirs, [a, b]);
  assert.equal(asked, 0);
  assert.equal(r.redirected, 0);
  assert.deepEqual(r.looked, [...LOOKED]);
});

test('names are never guessed: only the three known-folder names are asked and nothing but the home spelling is added', () => {
  const asked = [];
  const r = win({ getPath: (n) => { asked.push(n); return undefined; } });
  assert.deepEqual(asked, ['downloads', 'desktop', 'documents']);
  for (const d of r.dirs) assert.ok(!/onedrive/i.test(d), d);
  assert.equal(r.dirs.length, 3);
});

test('looked holds labels, never a path, and a fresh copy each call', () => {
  const r = win({ getPath: () => WIN_CLOUD + '\\Desktop' });
  for (const l of r.looked) assert.ok(!/[\\/:]/.test(l), l);
  r.looked.push('x');
  assert.equal(win({}).looked.length, 3);
});

test('a missing or non-absolute home is tolerated: known-folder answers still scan, nothing throws', () => {
  const r = resolveScanDirs({ env: {}, home: '', platform: 'win32', getPath: (n) => WIN_CLOUD + '\\' + n });
  assert.equal(r.dirs.length, 3);
  assert.equal(r.redirected, 0);
  const none = resolveScanDirs({ env: {}, home: 'relative', platform: 'win32', getPath: () => null });
  assert.deepEqual(none.dirs, []);
});

test('real temp tree: the resolved dirs point at an invented redirected Desktop (placeholder "Example Cloud" root)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-secfold-'));
  try {
    const cloudDesktop = path.join(home, 'Example Cloud', 'Desktop');
    fs.mkdirSync(cloudDesktop, { recursive: true });
    const r = resolveScanDirs({ env: {}, home, platform: process.platform, getPath: (n) => (n === 'desktop' ? cloudDesktop : path.join(home, n[0].toUpperCase() + n.slice(1))) });
    assert.ok(r.dirs.includes(path.resolve(cloudDesktop)));
    assert.ok(r.dirs.includes(path.resolve(path.join(home, 'Desktop'))));
    assert.equal(r.redirected, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
