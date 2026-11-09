// node --test dashboard-v5/tools/cosmos-fixture-paste.test.mjs
// The block pasted into tools/fake-preload.js must equal what the generator prints now (drift fails, like a golden), the
// pasted function must run in a bare context and agree with the module, and the rows must behave like main for the intents
// the UI round-trips. While fake-preload.js has no markers yet (the integrator adds them) the drift cases SKIP LOUDLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fakeCosmos } from './cosmos-fixture.mjs';
import { MARK, COSMOS_METHODS, buildBlocks, fixtureBlock, rowsBlock, extractBlock, replaceBlock } from './cosmos-fixture-paste.mjs';

const PRELOAD = new URL('./fake-preload.js', import.meta.url);
const preloadSrc = () => fs.readFileSync(PRELOAD, 'utf8');
const loud = (t, why) => {
  const msg = 'SKIPPED LOUDLY (cosmos-fixture-paste): ' + why;
  process.stderr.write('\n' + msg + '\n');
  t.skip(msg);
};

// a Web Storage stand-in
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// the rows block run the way createFake runs it: `storage` and `fakeCosmos` in scope
function rowsOf(storage) {
  const run = new Function('storage', 'fakeCosmos', rowsBlock() + '\nreturn COSMOS;');
  const C = run(storage, fakeCosmos);
  const row = (name) => { const r = C.rows.find((x) => x[0] === name); assert.ok(r, name); return r[1]; };
  return { C, row };
}

test('the two blocks are well formed and carry their markers', () => {
  const b = buildBlocks();
  assert.equal(b.fixture, fixtureBlock());
  assert.equal(b.rows, rowsBlock());
  assert.ok(b.fixture.startsWith(MARK.fixture.begin) && b.fixture.endsWith(MARK.fixture.end));
  assert.ok(b.rows.startsWith(MARK.rows.begin) && b.rows.endsWith(MARK.rows.end));
  assert.match(b.fixture, /\nconst fakeCosmos = function fakeCosmos\(opts\) \{/);
  assert.ok(!/\r/.test(b.fixture + b.rows));
  assert.deepEqual(buildBlocks(), b, 'regenerating gives the same text');
});

test('the block in fake-preload.js equals the generator (drift fails)', (t) => {
  const src = preloadSrc();
  const have = { fixture: extractBlock(src, MARK.fixture), rows: extractBlock(src, MARK.rows) };
  if (have.fixture === null && have.rows === null) return loud(t, 'tools/fake-preload.js has no BEGIN/END cosmos markers yet - the integrator adds them, then runs: node tools/cosmos-fixture-paste.mjs --write');
  assert.ok(have.fixture !== null, 'fake-preload.js lacks the cosmos-fixture marker pair');
  assert.ok(have.rows !== null, 'fake-preload.js lacks the cosmos-rows marker pair');
  const want = buildBlocks();
  assert.equal(have.fixture, want.fixture, 'the pasted fakeCosmos drifted: run node tools/cosmos-fixture-paste.mjs --write');
  assert.equal(have.rows, want.rows, 'the pasted cosmos rows drifted: run node tools/cosmos-fixture-paste.mjs --write');
  // the markers sit where the shared edit says: the function above createFake, the rows inside it before SPEC
  const text = src.replace(/\r\n/g, '\n');
  assert.ok(text.indexOf(MARK.fixture.end) < text.indexOf('function createFake('), 'the fixture block is above createFake');
  assert.ok(text.indexOf(MARK.rows.begin) > text.indexOf('function createFake(') && text.indexOf(MARK.rows.end) < text.indexOf('const SPEC = ['), 'the rows block is inside createFake, before SPEC');
  assert.match(text, /\.\.\.COSMOS\.rows/, 'SPEC spreads COSMOS.rows');
  assert.match(text, /COSMOS\.reset\(\)/, 'control.reset calls COSMOS.reset()');
});

test('the fake preload exposes hq.cosmos with the same method paths once pasted', (t) => {
  const src = preloadSrc();
  if (extractBlock(src, MARK.rows) === null) return loud(t, 'fake-preload.js has no cosmos rows yet');
  const { createFake } = createRequire(import.meta.url)('./fake-preload.js');
  const { hq, control, methods } = createFake({ storage: mem() });
  for (const m of COSMOS_METHODS) assert.ok(methods.includes(m), m + ' is a SPEC row');
  assert.deepEqual(methods.filter((m) => m.startsWith('cosmos.')).sort(), COSMOS_METHODS.slice().sort());
  assert.equal(hq.cosmos.pathForFile(), '', 'pathForFile is synchronous and answers \'\' bare');
  assert.equal(hq.cosmos.pathForFile({ fakePath: 'C:/placeholder-drop/a.png' }), 'C:/placeholder-drop/a.png');
  assert.equal(control.calls('cosmos.pathForFile').length, 2, 'and it is recorded');
});

test('the pasted function runs in a bare context (no require, no globals of ours) and agrees with the module', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fixtureBlock() + '\nthis.out = fakeCosmos;', ctx);
  for (const opts of [undefined, { count: 40 }, { count: 7, rootOk: false }, { state: 'empty' }]) {
    assert.equal(JSON.stringify(ctx.out(opts)), JSON.stringify(fakeCosmos(opts)));
  }
  assert.equal(ctx.out({ count: 1000 }).works.length, 1000);
});

test('rows: the method set is exactly the real hq.cosmos group', () => {
  const { C } = rowsOf(mem());
  assert.deepEqual(C.rows.map((r) => r[0]).sort(), COSMOS_METHODS.slice().sort());
  assert.equal(C.rows.find((r) => r[0] === 'cosmos.onProgress')[1], 'on:hq:cosmos:index-progress');
  const sync = C.rows.find((r) => r[0] === 'cosmos.pathForFile')[1];
  assert.equal(typeof sync.sync, 'function', 'pathForFile is the { sync } kind');
});

test('rows: cosmos.read answers 40 works by default and the storage count when set', () => {
  const st = mem();
  const { row } = rowsOf(st);
  const read = row('cosmos.read');
  const a = read();
  assert.equal(a.works.length, 40);
  assert.equal(a.state, 'ready');
  assert.equal(JSON.stringify(a.works), JSON.stringify(fakeCosmos({ count: 40 }).works));
  st.setItem('hqFake:cosmosCount', '1000');
  assert.equal(read().works.length, 1000, 'read per call: no reload needed to change the size');
  assert.equal(JSON.stringify(read().works), JSON.stringify(fakeCosmos({ count: 1000 }).works));
  st.setItem('hqFake:cosmosCount', 'banana');
  assert.equal(read().works.length, 40, 'junk falls back to 40');
  st.setItem('hqFake:cosmosCount', '0');
  assert.deepEqual(read().works, [], '0 is an indexed, empty library');
  st.removeItem('hqFake:cosmosCount');
  assert.equal(read().works.length, 40);
  assert.equal(rowsOf(null).row('cosmos.read')().works.length, 40, 'no storage at all: 40');
});

test('rows: cosmos.apply round-trips favorite, hide, tags and title; the next read carries them; reset puts them back', () => {
  const { C, row } = rowsOf(mem());
  const read = row('cosmos.read'), apply = row('cosmos.apply');
  const w = read().works.find((x) => x.tags.length > 0 && x.rel.startsWith('alpha-site/'));
  let r = apply({ type: 'favorite', id: w.id, on: true });
  assert.equal(r.note, 'saved');
  assert.equal(r.view.curation.favorites[w.id], true);
  assert.equal(read().curation.favorites[w.id], true);
  r = apply({ type: 'favorite', id: w.id, on: false });
  assert.ok(!(w.id in r.view.curation.favorites));
  r = apply({ type: 'hide', id: w.id, on: true });
  assert.equal(r.view.curation.hidden[w.id], true);
  const gone = w.tags[0];
  r = apply({ type: 'tags', id: w.id, add: ['  New  Tag ', gone], remove: [gone] });
  assert.deepEqual(r.view.curation.overrides[w.id].tags, w.tags.filter((t) => t !== gone).concat(['new tag']));
  r = apply({ type: 'title', id: w.id, title: 'A new name' });
  assert.equal(r.view.curation.overrides[w.id].title, 'A new name');
  r = apply({ type: 'title', id: w.id, title: null });
  assert.ok(!('title' in r.view.curation.overrides[w.id]));
  // the answer is a copy: editing it does not edit the fake's state
  r.view.curation.favorites.zzz = true;
  assert.ok(!('zzz' in read().curation.favorites));
  C.reset();
  assert.ok(!(w.id in read().curation.hidden) || fakeCosmos({ count: 40 }).curation.hidden[w.id], 'reset restores the generated curation');
  assert.deepEqual(read().curation, fakeCosmos({ count: 40 }).curation);
});

test('rows: refusals sound like main (unknown element, unknown intent); import-replace saves', () => {
  const { row } = rowsOf(mem());
  const apply = row('cosmos.apply');
  assert.ok(apply({ type: 'favorite', id: 'no-such-element', on: true }).error);
  assert.ok(apply({ type: 'cluster-explode' }).error);
  assert.ok(apply(null).error);
  assert.equal(apply({ type: 'import-replace', token: 'x' }).note, 'saved');
});

test('rows: trash moves only a dropped-in file; index, cancel, reveal answer true; the picker is cancelled; import-local reports', () => {
  const { row } = rowsOf(mem());
  const works = row('cosmos.read')().works;
  const imp = works.find((w) => w.rel.startsWith('imports:')), plain = works.find((w) => !w.rel.startsWith('imports:'));
  const r = row('cosmos.trash')([imp.id, plain.id, 'ghost']);
  assert.deepEqual(r.trashed, [imp.id]);
  assert.deepEqual(r.failed.map((f) => f.id), [plain.id, 'ghost']);
  assert.ok(r.failed.every((f) => typeof f.message === 'string' && f.message));
  assert.equal(row('cosmos.index')(), true);
  assert.equal(row('cosmos.cancelIndex')(), true);
  assert.equal(row('cosmos.reveal')(plain.id), true);
  assert.equal(row('cosmos.pickFolder')(), null);
  assert.deepEqual(row('cosmos.importFiles')(['C:/placeholder-drop/a.png', 'C:/placeholder-drop/b.png']), { imported: 2, skipped: [] });
  const rep = row('cosmos.importFromLocal')();
  assert.ok(rep.clusters >= 0 && rep.missingIds.length === rep.missingCount && rep.conflicts === 0 && rep.token === null);
  const sync = rowsOf(mem()).C.rows.find((x) => x[0] === 'cosmos.pathForFile')[1].sync;
  assert.equal(sync(), '');
  assert.equal(sync({ name: 'a.png' }), '', 'a File-like without fakePath gives no path (File.name is never leaked)');
  assert.equal(sync({ fakePath: 'C:/placeholder-drop/x.png' }), 'C:/placeholder-drop/x.png');
  assert.equal(sync('text'), '');
});

test('extractBlock / replaceBlock: LF and CRLF, missing and swapped markers', () => {
  const b = buildBlocks();
  const stale = 'top\n' + MARK.fixture.begin + '\nold\n' + MARK.fixture.end + '\nbottom\n';
  const next = replaceBlock(stale, MARK.fixture, b.fixture);
  assert.equal(extractBlock(next, MARK.fixture), b.fixture);
  assert.ok(next.startsWith('top\n') && next.endsWith('\nbottom\n'));
  assert.equal(replaceBlock(next, MARK.fixture, b.fixture), next, 'idempotent');
  assert.equal(extractBlock(stale.replace(/\n/g, '\r\n'), MARK.fixture), MARK.fixture.begin + '\nold\n' + MARK.fixture.end);
  assert.equal(extractBlock('nothing here', MARK.fixture), null);
  assert.equal(replaceBlock('nothing here', MARK.fixture, b.fixture), null);
  assert.equal(extractBlock(MARK.fixture.end + '\n' + MARK.fixture.begin, MARK.fixture), null, 'END before BEGIN is not a block');
});
