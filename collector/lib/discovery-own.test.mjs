import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOwnRepos, remoteOwner, autoId } from './discovery.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-own-'));
const docs = path.join(tmp, 'docs'), desk = path.join(tmp, 'desk');
const repo = (rel, remote) => { const d = path.join(tmp, rel); fs.mkdirSync(path.join(d, '.git'), { recursive: true }); remotes.set(d, remote); return d; };
const remotes = new Map();
const mine = repo('docs/mine', 'https://github.com/Octo-Owner/mine.git');
const local = repo('docs/local-only', null);
const third = repo('docs/third', 'https://github.com/someone-else/third');
const deep = repo('desk/a/b/deep', 'git@github.com:octo-owner/deep.git');
repo('desk/a/b/c/too-deep', null);
const inner = repo('docs/mine/nested', null);                  // inside a repo: never searched
repo('docs/ignored/x', null);                                  // under an ignored top-level name
const tracked = repo('docs/tracked', null);                    // already a configured product
repo('docs/tracked/sub', null);                                // inside a tracked folder: not searched
repo('docs/node_modules/pkg', null);
repo('docs/.hidden/r', null);
const adopted = repo('docs/adopt-me', 'https://github.com/someone-else/adopt-me');
const wt = path.join(docs, 'worktree'); fs.mkdirSync(wt, { recursive: true }); fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere');
remotes.set(wt, null);

const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const run = () => findOwnRepos({
  roots: [{ abs: docs, ignore: new Set(['ignored']) }, { abs: desk }], maxDepth: 3,
  skip: new Set([norm(tracked)]), remoteOf: (d) => remotes.get(d) ?? null,
  ownerLogins: ['octo-owner'], adopt: [adopted],
});

test('own repos: owner remote, no remote, adopted — not third-party, nested, ignored, tracked, too deep, worktrees', () => {
  const got = run().map((r) => [path.relative(tmp, r.abs).replace(/\\/g, '/'), r.reason]);
  assert.deepEqual(got, [['desk/a/b/deep', 'owner'], ['docs/adopt-me', 'adopted'], ['docs/local-only', 'no-remote'], ['docs/mine', 'owner']]);
  assert.ok(!got.some(([p]) => p === path.relative(tmp, inner).replace(/\\/g, '/')));
  assert.ok(!got.some(([p]) => p === 'docs/third'));
  assert.equal(third.length > 0, true);
  assert.equal(local.length > 0 && deep.length > 0 && mine.length > 0, true);
});

test('remoteOwner', () => {
  assert.equal(remoteOwner('github.com/Octo-Owner/x'), 'octo-owner');
  assert.equal(remoteOwner('git@github.com:a/b.git'), 'a');
  assert.equal(remoteOwner('https://gitlab.com/a/b'), null);
  assert.equal(remoteOwner(null), null);
});

test('autoId: slug, then parent-qualified, then numbered', () => {
  const taken = new Set(['alpha']);
  assert.equal(autoId('C:/x/Alpha', taken), 'x-alpha');
  assert.equal(autoId('C:/x/Alpha', taken), 'alpha-2');
  assert.equal(autoId('C:/y/My  App.v2', taken), 'my-app-v2');
  assert.equal(autoId('C:/y/***', taken), 'project');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
