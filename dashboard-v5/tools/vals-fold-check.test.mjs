// vals-fold-check: a renderVals fold passes only when every moved value is equal and nothing else changed.
// Placeholder fixtures only (invented key names and values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkScenario, checkDirs, scanTemplates, parseArgs, run, groupKey } from './vals-fold-check.mjs';

const P = ['aaa', 'bbb'];
const before = () => ({ aaaShow: true, aaaRows: [{ id: 1 }, { id: 2 }], aaaGo: '[fn]', bbbLabel: 'hello', bbbN: 3, other: 'x', otherFn: '[fn]', zzz: { k: [1, null] } });
const folded = () => ({ aaav: { aaaShow: true, aaaRows: [{ id: 1 }, { id: 2 }], aaaGo: '[fn]' }, bbbv: { bbbLabel: 'hello', bbbN: 3 }, other: 'x', otherFn: '[fn]', zzz: { k: [1, null] } });
const kinds = (f) => f.map((x) => x.kind).sort();

test('groupKey appends v', () => { assert.equal(groupKey('tdy'), 'tdyv'); });

test('a clean fold passes', () => {
  assert.deepEqual(checkScenario(before(), folded(), P), []);
});

test('a value that differs inside the group fails', () => {
  const a = folded(); a.aaav.aaaRows = [{ id: 1 }, { id: 3 }];
  const f = checkScenario(before(), a, P);
  assert.deepEqual(kinds(f), ['value-differs']);
  assert.equal(f[0].key, 'aaav.aaaRows');
});

test('a moved key missing from the group fails', () => {
  const a = folded(); delete a.bbbv.bbbN;
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['missing-in-group']);
});

test('a moved key still at the top level fails', () => {
  const a = folded(); a.aaaShow = true;
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['count-off', 'still-flat']);
});

test('a missing group fails', () => {
  const a = folded(); delete a.bbbv;
  const k = kinds(checkScenario(before(), a, P));
  assert.ok(k.includes('group-invalid'));
});

test('an extra key inside the group fails', () => {
  const a = folded(); a.aaav.aaaNew = 1;
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['group-extra']);
});

test('a changed, removed or added key outside the prefixes fails', () => {
  let a = folded(); a.other = 'y';
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['outside-changed']);
  a = folded(); delete a.zzz;
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['count-off', 'outside-removed']);
  a = folded(); a.surprise = 1;
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['count-off', 'outside-added']);
});

test('the key count must drop by exactly moved minus groups', () => {
  const a = folded(); a.other = 'x'; delete a.otherFn; a.otherFn2 = '[fn]';   // same count, but a rename: caught as removed + added
  assert.deepEqual(kinds(checkScenario(before(), a, P)), ['outside-added', 'outside-removed']);
  // a scenario with no aaa* keys must not gain an aaav group
  const b = { bbbN: 1, other: 2 }, c = { bbbv: { bbbN: 1 }, aaav: {}, other: 2 };
  assert.deepEqual(kinds(checkScenario(b, c, P)), ['count-off', 'group-unexpected']);
  assert.deepEqual(checkScenario(b, { bbbv: { bbbN: 1 }, other: 2 }, P), []);
});

test('--max-keys fails a scenario that stays over the limit', () => {
  const b = { aaaX: 1, aaaY: 2, o: 1 };
  const f = checkScenario(b, { aaav: { aaaX: 1, aaaY: 2 }, o: 1 }, P);
  assert.deepEqual(f, []);
  assert.equal(checkScenario(b, { aaav: { aaaX: 1, aaaY: 2 }, o: 1 }, P, { maxKeys: 1 })[0].kind, 'over-max');
});

test('--keep leaves a prefixed name flat', () => {
  const b = { aaaX: 1, aaaKeep: 2 }, a = { aaav: { aaaX: 1 }, aaaKeep: 2 };
  assert.deepEqual(checkScenario(b, a, P, { keep: ['aaaKeep'] }), []);
  assert.ok(checkScenario(b, a, P).length > 0);
});

test('a before dump that already has the group key, bad roots and overlapping prefixes are refused', () => {
  assert.ok(kinds(checkScenario({ aaav: {}, aaaX: 1 }, { aaav: { aaaX: 1 } }, P)).includes('group-preexisting'));
  assert.deepEqual(kinds(checkScenario([], {}, P)), ['not-object']);
  assert.throws(() => checkScenario({}, {}, ['ab', 'abc']), /overlap/);
  assert.throws(() => checkScenario({}, {}, []), /at least one/);
  assert.throws(() => checkScenario({}, {}, ['a-b']), /bad prefix/);
});

// ---- directories ----
const memIo = (dirs) => ({ list: (d) => { if (!(d in dirs)) throw new Error('no dir ' + d); return Object.keys(dirs[d]).sort(); }, read: (d, n) => { const v = dirs[d][n]; if (v instanceof Error) throw v; return v; } });

test('checkDirs: clean across scenarios, with the census of moved keys', () => {
  const io = memIo({ B: { s1: before(), s2: { aaaShow: false, other: 'x' } }, A: { s1: folded(), s2: { aaav: { aaaShow: false }, other: 'x' } } });
  const r = checkDirs('B', 'A', P, {}, io);
  assert.equal(r.ok, true);
  assert.equal(r.scenarios, 2);
  assert.deepEqual(r.moved.aaa, ['aaaGo', 'aaaRows', 'aaaShow']);
  assert.deepEqual(r.moved.bbb, ['bbbLabel', 'bbbN']);
  assert.equal(r.maxKeysAfter, 5);
});

test('checkDirs: a differing value in one scenario names that scenario', () => {
  const bad = folded(); bad.bbbv.bbbLabel = 'changed';
  const r = checkDirs('B', 'A', P, {}, memIo({ B: { s1: before(), s2: before() }, A: { s1: folded(), s2: bad } }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.map((f) => [f.scenario, f.kind]), [['s2', 'value-differs']]);
});

test('checkDirs: a scenario missing or added, an unreadable file, an unreadable dir', () => {
  const r = checkDirs('B', 'A', P, {}, memIo({ B: { s1: before(), gone: before(), broken: before() }, A: { s1: folded(), fresh: folded(), broken: new Error('bad json') } }));
  assert.deepEqual(r.failures.map((f) => f.scenario + ':' + f.kind).sort(), ['broken:unreadable', 'fresh:scenario-added', 'gone:scenario-missing']);
  const d = checkDirs('nope', 'A', P, {}, memIo({ A: {} }));
  assert.equal(d.ok, false);
  assert.equal(d.failures[0].kind, 'unreadable');
});

// ---- templates ----
test('scanTemplates: flat bindings fail; nested, alias, string and comment mentions do not', () => {
  const tpl = [
    '<!-- v5: aaaRows only in a comment -->',
    '<sc-if value="{{ aaav.aaaShow }}">',
    '<sc-for list="{{ aaav.aaaRows }}" as="aaaRow">',
    '<b onClick="{{ aaaRow.go }}">{{ aaaRow.label }} {{ x === \'aaaShow\' }}</b>',
    '</sc-for>',
    '<i>{{ aaaShow }}</i>',
    '<sc-for list="{{ !aaaRows }}" as="r"><u onClick="{{ aaaGo }}"></u></sc-for>',
    '</sc-if>',
  ].join('\n');
  const hits = scanTemplates([{ path: 't.tpl.js', text: tpl }], ['aaaShow', 'aaaRows', 'aaaGo', 'aaaRow']);
  assert.deepEqual(hits.map((h) => h.line + ':' + h.name), ['6:aaaShow', '7:aaaRows', '7:aaaGo']);
  assert.deepEqual(scanTemplates([{ path: 'x', text: '{{ aaav.aaaShow }}' }], ['aaaShow']), []);
});

// ---- CLI ----
test('parseArgs and run: usage errors exit 2', () => {
  assert.throws(() => parseArgs(['only-one']), /need/);
  assert.throws(() => parseArgs(['a', 'b', '--prefix']), /needs a value/);
  assert.throws(() => parseArgs(['a', 'b', '--prefix', 'x', '--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['a', 'b', '--prefix', 'x', '--max-keys', '0']), /positive/);
  assert.throws(() => parseArgs(['a', 'b']), /at least one prefix/);
  assert.equal(run(['a']).code, 2);
});

test('run on real files: exit 0 for a clean fold with a clean template dir, 1 for a flat template binding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-fold-'));
  try {
    const mk = (n) => { const d = path.join(root, n); fs.mkdirSync(d); return d; };
    const b = mk('b'), a = mk('a'), t = mk('t');
    const w = (d, n, v) => fs.writeFileSync(path.join(d, n + '.json'), JSON.stringify(v));
    w(b, 's1', { aaaShow: true, aaaRows: [1], other: 'x' }); w(a, 's1', { aaav: { aaaShow: true, aaaRows: [1] }, other: 'x' });
    fs.writeFileSync(path.join(t, 'a.tpl.js'), '<i>{{ aaav.aaaShow }}</i>');
    const ok = run([b, a, '--prefix', 'aaa', '--tpl', t, '--max-keys', '2']);
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    assert.match(ok.lines.at(-1), /1 scenario\(s\) clean/);
    fs.writeFileSync(path.join(t, 'b.tpl.js'), '\n<i>{{ aaaShow }}</i>');
    const bad = run([b, a, '--prefix', 'aaa', '--tpl', t]);
    assert.equal(bad.code, 1);
    assert.ok(bad.lines.some((l) => /b\.tpl\.js:2 still binds aaaShow flat/.test(l)));
    const over = run([b, a, '--prefix', 'aaa', '--max-keys', '1']);
    assert.equal(over.code, 1);
    assert.ok(over.lines.some((l) => /over-max/.test(l)));
    const noTpl = run([b, a, '--prefix', 'aaa', '--tpl', path.join(root, 'missing')]);
    assert.equal(noTpl.code, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
