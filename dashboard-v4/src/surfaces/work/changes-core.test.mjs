// Tests for the pure CHANGES attribution logic (changes-core.mjs).
// The defect these lock down: without a dispatch-time baseline the panel bills
// the whole working tree to the session that just settled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitChanges, summarize, BASELINE_KNOWN, BASELINE_UNKNOWN } from './changes-core.mjs';

const f = (path, status = 'M') => ({ path, status });

// ------------------------------------------------------------- the split

test('with a captured baseline, pre-existing dirt is separated from the session window', () => {
  const files = [f('data/quest-overrides.json'), f('src/new.js', '??'), f('README.md')];
  const split = splitChanges(files, { state: 'captured', paths: ['data/quest-overrides.json'] });
  assert.equal(split.mode, BASELINE_KNOWN);
  assert.deepEqual(split.since.map((x) => x.path), ['src/new.js', 'README.md']);
  assert.deepEqual(split.preexisting.map((x) => x.path), ['data/quest-overrides.json']);
  assert.equal(split.all.length, 3);
});

test('a file dirty at dispatch stays pre-existing even when its status code changed', () => {
  // ' M' -> 'MM' is not evidence of authorship; we must not promote it.
  const split = splitChanges([f('a.txt', 'MM')], { state: 'captured', paths: ['a.txt'] });
  assert.deepEqual(split.since, []);
  assert.deepEqual(split.preexisting.map((x) => x.path), ['a.txt']);
});

test('a clean-at-dispatch tree attributes everything to the session window', () => {
  const split = splitChanges([f('x.js'), f('y.js')], { state: 'captured', paths: [] });
  assert.equal(split.mode, BASELINE_KNOWN);
  assert.equal(split.since.length, 2);
  assert.equal(split.preexisting.length, 0);
});

test('the pre-existing set is not required to appear in the current status', () => {
  // The session (or the user) reverted/committed the file that was dirty.
  const split = splitChanges([f('new.js', '??')], { state: 'captured', paths: ['gone.js'] });
  assert.deepEqual(split.since.map((x) => x.path), ['new.js']);
  assert.deepEqual(split.preexisting, []);
});

// ------------------------------------------------- degraded baseline states

for (const [name, baseline] of [
  ['state:none', { state: 'none' }],
  ['an unavailable probe', { state: 'unavailable', error: 'not a git repository' }],
  ['an omitted field (older main process)', undefined],
  ['a malformed value', 'nope'],
  ['captured-but-pathless (malformed)', { state: 'captured' }],
]) {
  test(`${name} refuses to claim a split`, () => {
    const split = splitChanges([f('a.js'), f('b.js')], baseline);
    assert.equal(split.mode, BASELINE_UNKNOWN);
    assert.equal(split.since.length, 0);
    assert.equal(split.preexisting.length, 0);
    assert.equal(split.all.length, 2);
    assert.ok(split.reason.length > 0, 'a degraded split must carry a stated reason');
  });
}

test('the unavailable state surfaces the probe error as the reason', () => {
  const split = splitChanges([], { state: 'unavailable', error: 'not a git repository' });
  assert.match(split.reason, /not a git repository/);
});

// ------------------------------------------------------------- null safety

test('never throws on junk input', () => {
  for (const bad of [null, undefined, 'x', 42, {}, [null, 3, 'str']]) {
    const split = splitChanges(bad, null);
    assert.equal(split.mode, BASELINE_UNKNOWN);
    assert.ok(Array.isArray(split.all));
  }
});

// --------------------------------------------------------------- wording

test('the unknown-baseline summary states the real scope, never authorship', () => {
  const line = summarize(splitChanges([f('a'), f('b')], { state: 'none' }), 'C:/repo');
  assert.match(line, /2 files dirty in the working tree in C:\/repo/);
  assert.match(line, /includes changes not made by this session/);
  assert.doesNotMatch(line, /touched/);
});

test('the known-baseline summary scopes to the dispatch window and names the leftovers', () => {
  const line = summarize(
    splitChanges([f('a'), f('b')], { state: 'captured', paths: ['b'] }),
    'C:/repo',
  );
  assert.match(line, /1 file changed in C:\/repo since this session was dispatched/);
  assert.match(line, /1 file was already dirty at dispatch/);
});

test('plural agreement holds for the pre-existing clause', () => {
  const line = summarize(
    splitChanges([f('a'), f('b'), f('c')], { state: 'captured', paths: ['b', 'c'] }),
    '',
  );
  assert.match(line, /2 files were already dirty at dispatch/);
});

test('a clean dispatch window says so instead of listing pre-existing dirt as work', () => {
  const line = summarize(splitChanges([f('b')], { state: 'captured', paths: ['b'] }), 'C:/repo');
  assert.match(line, /Nothing changed in C:\/repo since this session was dispatched/);
  assert.match(line, /1 file was already dirty at dispatch/);
  assert.doesNotMatch(line, /touched/);
});

test('a clean-at-dispatch tree says the tree was clean', () => {
  const line = summarize(splitChanges([f('a')], { state: 'captured', paths: [] }), '');
  assert.match(line, /1 file changed since this session was dispatched/);
  assert.match(line, /tree was clean at dispatch/);
});
