// node --test dashboard-v5/tools/crew-fixture-paste.test.mjs
// The block pasted into tools/fake-preload.js must equal what the generator prints now (drift fails, like a golden), the pasted
// function must run in a bare context and agree with the module, the rows must answer like main (a roster, then fixed words for an
// unknown id), and the fake must expose exactly the two crew methods dashboard/preload.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fakeCrew } from './crew-fixture.mjs';
import { MARK, CREW_METHODS, buildBlocks, fixtureBlock, rowsBlock, extractBlock, replaceBlock } from './crew-fixture-paste.mjs';

const PRELOAD = new URL('./fake-preload.js', import.meta.url);
const preloadSrc = () => fs.readFileSync(PRELOAD, 'utf8');
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null) }; };
function rowsOf(storage) {
  const C = new Function('storage', 'fakeCrew', rowsBlock() + '\nreturn CREW;')(storage, fakeCrew);
  return { C, row: (name) => C.rows.find((x) => x[0] === name)[1] };
}

test('the two blocks are well formed and carry their markers', () => {
  const b = buildBlocks();
  assert.ok(b.fixture.startsWith(MARK.fixture.begin) && b.fixture.endsWith(MARK.fixture.end));
  assert.ok(b.rows.startsWith(MARK.rows.begin) && b.rows.endsWith(MARK.rows.end));
  assert.match(b.fixture, /\nconst fakeCrew = function fakeCrew\(/);
  assert.ok(!/\r/.test(b.fixture + b.rows));
  assert.deepEqual(buildBlocks(), b);
  assert.equal(b.fixture, fixtureBlock());
});

test('the block in fake-preload.js equals the generator (drift fails: run node tools/crew-fixture-paste.mjs --write)', () => {
  const src = preloadSrc();
  const want = buildBlocks();
  assert.equal(extractBlock(src, MARK.fixture), want.fixture, 'the pasted fakeCrew drifted');
  assert.equal(extractBlock(src, MARK.rows), want.rows, 'the pasted crew rows drifted');
  assert.ok(src.replace(/\r\n/g, '\n').includes('...CREW.rows,'), 'SPEC spreads the crew rows');
  assert.ok(/CREW\.reset\(\)/.test(src), 'control.reset puts the crew back');
});

test('replaceBlock only touches the text between its markers', () => {
  const src = 'a\n' + MARK.fixture.begin + '\nold\n' + MARK.fixture.end + '\nz\n';
  assert.equal(replaceBlock(src, MARK.fixture, 'NEW'), 'a\nNEW\nz\n');
  assert.equal(replaceBlock('no markers', MARK.fixture, 'x'), null);
});

test('the pasted function runs in a bare context and agrees with the module', () => {
  const run = new Function(fixtureBlock() + '\nreturn fakeCrew;')();
  assert.deepEqual(run({ count: 30 }), fakeCrew({ count: 30 }));
});

test('the fixture: invented names, every row startable, plugin ids in <plugin>:<folder> form, the count honoured', () => {
  const a = fakeCrew();
  assert.equal(a.total, 24);
  assert.deepEqual(a.roles.map((r) => r.id).slice(-1), ['other']);
  for (const s of a.skills) {
    assert.match(s.id, /^[A-Za-z0-9._:-]+$/);
    assert.equal(s.canStart, true);
    assert.deepEqual(Object.keys(s).sort(), ['canStart', 'description', 'id', 'name', 'plugin', 'role']);
    if (s.plugin) assert.equal(s.id, s.plugin + ':' + s.name);
    assert.ok(a.roles.some((r) => r.id === s.role));
  }
  assert.equal(fakeCrew({ count: 700 }).skills.length, 700);
  assert.equal(fakeCrew({ count: 0 }).skills.length, 0);
  assert.equal(fakeCrew({ count: -5 }).skills.length, 0);
});

test('the rows: crew.read answers the roster (count from storage), crew.start answers like main', () => {
  const { C, row } = rowsOf(mem());
  assert.deepEqual(C.rows.map((r) => r[0]), CREW_METHODS.slice());
  assert.equal(row('crew.read')().total, 24);
  assert.equal(rowsOf(mem({ 'hqFake:crewCount': '700' })).row('crew.read')().total, 700);
  assert.equal(rowsOf(mem({ 'hqFake:crewCount': 'junk' })).row('crew.read')().total, 24);
  assert.deepEqual(row('crew.start')('alpha-lint'), { ok: true });
  assert.deepEqual(row('crew.start')('nope'), { error: 'that skill is not in the crew' });
  assert.deepEqual(row('crew.start')(undefined), { error: 'that skill is not in the crew' });
  const a = row('crew.read')(); a.skills.length = 0;
  assert.equal(row('crew.read')().skills.length, 24, 'a caller cannot change the roster the fake holds');
});

test('the real preload and the fake both carry exactly crew.read and crew.start', () => {
  const real = fs.readFileSync(new URL('../../dashboard/preload.js', import.meta.url), 'utf8');
  const m = /crew: \{([\s\S]*?)\n  \},/.exec(real);
  assert.ok(m, 'dashboard/preload.js has a crew group');
  assert.deepEqual([...m[1].matchAll(/^\s+(\w+):/gm)].map((x) => 'crew.' + x[1]), CREW_METHODS.slice());
  void createRequire;
});
