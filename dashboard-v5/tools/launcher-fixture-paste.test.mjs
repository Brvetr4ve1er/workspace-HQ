// node --test dashboard-v5/tools/launcher-fixture-paste.test.mjs
// The block pasted into tools/fake-preload.js must equal what the generator prints now (drift fails, like a golden); the pasted function must
// run in a bare context and agree with the module; the fake must say what main says (the sentences, the fixed words, the Open workspace mark);
// and the real preload and the fake must carry exactly the same six launcher methods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeLauncherFake } from './launcher-fixture.mjs';
import { MARK, LAUNCHER_METHODS, buildBlocks, fixtureBlock, rowsBlock, extractBlock, replaceBlock } from './launcher-fixture-paste.mjs';
import * as core from '../../dashboard/launcher-core.mjs';

const PRELOAD = new URL('./fake-preload.js', import.meta.url);
const preloadSrc = () => fs.readFileSync(PRELOAD, 'utf8');
function rig(mode = '') {
  const calls = [];
  const devAllowed = new Set();
  const F = makeLauncherFake({ mode: () => mode, record: (m, a) => calls.push([m, a]), devAllowed });
  const row = (name) => F.rows.find((x) => x[0] === name)[1];
  return { F, row, calls, devAllowed };
}

test('the two blocks are well formed and carry their markers', () => {
  const b = buildBlocks();
  assert.ok(b.fixture.startsWith(MARK.fixture.begin) && b.fixture.endsWith(MARK.fixture.end));
  assert.ok(b.rows.startsWith(MARK.rows.begin) && b.rows.endsWith(MARK.rows.end));
  assert.match(b.fixture, /\nconst makeLauncherFake = function makeLauncherFake\(/);
  assert.ok(!/\r/.test(b.fixture + b.rows));
  assert.equal(b.fixture, fixtureBlock());
  assert.equal(b.rows, rowsBlock());
});

test('the block in fake-preload.js equals the generator (drift fails: run node tools/launcher-fixture-paste.mjs --write)', () => {
  const src = preloadSrc();
  const want = buildBlocks();
  assert.equal(extractBlock(src, MARK.fixture), want.fixture, 'the pasted makeLauncherFake drifted');
  assert.equal(extractBlock(src, MARK.rows), want.rows, 'the pasted launcher rows drifted');
  const s = src.replace(/\r\n/g, '\n');
  assert.ok(s.includes('...LNCH.rows'), 'SPEC spreads the launcher rows');
  assert.ok(/LNCH\.reset\(\)/.test(s), 'control.reset puts the launcher back');
  assert.ok(s.indexOf('const devAllowed = new Set()') < s.indexOf('const LNCH = makeLauncherFake'), 'devAllowed is declared before the rows use it');
});

test('replaceBlock only touches the text between its markers', () => {
  const src = 'a\n' + MARK.fixture.begin + '\nold\n' + MARK.fixture.end + '\nz\n';
  assert.equal(replaceBlock(src, MARK.fixture, 'NEW'), 'a\nNEW\nz\n');
  assert.equal(replaceBlock('no markers', MARK.fixture, 'x'), null);
});

test('the pasted function runs in a bare context and agrees with the module', () => {
  const run = new Function(fixtureBlock() + '\nreturn makeLauncherFake;')();
  const mk = (f) => { const F = f({ mode: () => '', record: () => {}, devAllowed: new Set() }); return JSON.stringify(F.rows.map(([n, fn]) => [n, n === 'launcher.read' ? fn() : null])); };
  assert.equal(mk(run), mk(makeLauncherFake));
});

test('the fake says what main says: the Open workspace sentences, the folder-missing line and the step words', () => {
  const { row, devAllowed } = rig();
  let r = row('launcher.openWorkspace')('a');
  assert.deepEqual(r.steps.map((s) => s.state), ['unconfirmed', 'opened', 'opened']);
  assert.equal(r.line, core.buildLine(r.steps));
  devAllowed.add('a');
  r = row('launcher.openWorkspace')('a');
  assert.deepEqual(r.steps.map((s) => s.state), ['started', 'opened', 'opened']);
  assert.equal(r.line, core.buildLine(r.steps));
  assert.equal(row('launcher.openWorkspace')('a').steps[0].state, 'running');
  r = row('launcher.openWorkspace')('b');
  assert.equal(r.steps[0].state, 'none');
  assert.equal(r.line, core.buildLine(r.steps));
  r = row('launcher.openWorkspace')('nope');
  assert.equal(r.line, core.FOLDER_MISSING);
  assert.equal(r.steps.every((s) => s.state === 'skipped'), true);
  // a no-editor answer says the pick-one sentence main says
  row('launcher.remove')('aaaa0002');
  r = row('launcher.openWorkspace')('b');
  assert.equal(r.steps[1].state, 'none');
  assert.equal(r.line, core.buildLine(r.steps));
  // every state the fake can say is one main knows
  for (const [step, states] of Object.entries(core.STATES)) for (const s of states) assert.ok(s in core.SENTENCES[step], step + ':' + s);
});

test('the fake writes the launcher-workspace act mark the way main does: only when the dev server started or the editor opened', () => {
  const { row, calls, devAllowed } = rig();
  row('launcher.openWorkspace')('b');   // editor chosen: opened
  assert.deepEqual(calls.filter((c) => c[1][0] === 'launcher-workspace'), [['use', ['launcher-workspace', 'act']]]);
  row('launcher.remove')('aaaa0002');   // no editor now
  calls.length = 0;
  row('launcher.openWorkspace')('b');
  assert.equal(calls.length, 0, 'a terminal-only launch is no act');
  devAllowed.add('a');
  row('launcher.openWorkspace')('a');
  assert.equal(calls.length, 1, 'the dev server started');
});

test('read, add, remove, set-editor and open answer like main, and the modes work', () => {
  const { row } = rig();
  const r = row('launcher.read')();
  assert.equal(r.entries.length, 3);
  assert.equal(r.editor, 'aaaa0002');
  assert.deepEqual(r.projects.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(row('launcher.add')('folder').state, 'added');
  assert.equal(row('launcher.add')('junk').state, 'refused');
  assert.equal(row('launcher.setEditor')('aaaa0001').state, 'refused');
  assert.equal(row('launcher.setEditor')('aaaa0002').state, 'set');
  assert.equal(row('launcher.open')('aaaa0001').state, 'opened');
  assert.equal(row('launcher.open')('zzzzzzzz').state, 'unknown');
  assert.equal(row('launcher.remove')('aaaa0001').state, 'removed');
  assert.equal(row('launcher.remove')('aaaa0001').state, 'unknown');
  assert.ok(rig('error').row('launcher.read')().error);
  const locked = rig('locked');
  assert.equal(locked.row('launcher.read')().locked, true);
  assert.equal(locked.row('launcher.add')('folder').state, 'locked');
  assert.equal(rig('refuse').row('launcher.add')('folder').state, 'refused');
});

test('the fake allowed-state follows devAllowed (the same Set the fake devAllow fills)', () => {
  const { row, devAllowed } = rig();
  assert.equal(row('launcher.read')().projects.find((p) => p.id === 'a').dev, 'unconfirmed');
  devAllowed.add('a');
  assert.equal(row('launcher.read')().projects.find((p) => p.id === 'a').dev, 'allowed');
  assert.equal(row('launcher.read')().projects.find((p) => p.id === 'b').dev, 'none');
});

test('the real preload and the fake both carry exactly the six launcher methods', () => {
  const real = fs.readFileSync(new URL('../../dashboard/preload.js', import.meta.url), 'utf8');
  const m = /launcher: \{([\s\S]*?)\n  \},/.exec(real);
  assert.ok(m, 'dashboard/preload.js has a launcher group');
  assert.deepEqual([...m[1].matchAll(/^\s+(\w+):/gm)].map((x) => 'launcher.' + x[1]), LAUNCHER_METHODS.slice());
  const { F } = rig();
  assert.deepEqual(F.rows.map((r) => r[0]), LAUNCHER_METHODS.slice());
});
