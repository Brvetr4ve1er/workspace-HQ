// node --test dashboard-v5/tools/console-fixture.test.mjs
// The invented project list of the Console layer's Shelf (tools/console-fixture.mjs) and its paste into tools/fake-preload.js
// (tools/console-fixture-paste.mjs): the data's shape and determinism, that the generator is self-contained (it is pasted as source),
// that every name is invented, that the paste blocks evaluate, round-trip and do not drift from the fake preload once their markers are in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fakeShelfProjects } from './console-fixture.mjs';
import { toProject } from '../src/live/adapter.mjs';
import { MARK, ANCHOR, STORAGE_KEY, DEFAULT_COUNT, fixtureBlock, controlBlock, buildBlocks, extractBlock, replaceBlock, insertMarkers, writeInto } from './console-fixture-paste.mjs';

const SRC = fs.readFileSync(new URL('./console-fixture.mjs', import.meta.url), 'utf8');
const PASTE_SRC = fs.readFileSync(new URL('./console-fixture-paste.mjs', import.meta.url), 'utf8');
const FAKE = new URL('./fake-preload.js', import.meta.url);
const FAKE_SRC = fs.readFileSync(FAKE, 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const norm = (s) => s.replace(/\r\n/g, '\n');
const D = fakeShelfProjects({ describe: true });

// ---- the data -----------------------------------------------------------------------------------------------------------------------
test('83 invented projects by default, unique ids, names from the invented pattern only', () => {
  const ps = fakeShelfProjects();
  assert.equal(ps.length, 83); assert.equal(DEFAULT_COUNT, 83); assert.equal(D.defaultCount, 83);
  assert.equal(new Set(ps.map((p) => p.id)).size, 83, 'unique ids');
  assert.equal(new Set(ps.map((p) => p.name)).size, 83, 'unique names');
  const re = new RegExp(D.namePattern);
  for (const p of ps) { assert.match(p.name, re, p.name); assert.match(p.id, /^ph-\d{3}$/); }
  assert.ok(ps.some((p) => /^Placeholder \d\d$/.test(p.name)), 'the plain placeholder names are in');
  assert.ok(new Set(ps.map((p) => p.name[0])).size >= 6, 'the syllable tables spread the initials');
  assert.deepEqual(ps.map((p) => p.id.slice(3)), Array.from({ length: 83 }, (_, i) => String(i + 1).padStart(3, '0')), 'ids count up from 001');
});

test('counts: 0, 1, 3, 48, 49, 83, 200 and the cap; junk reads as the default, negatives as 0', () => {
  for (const n of [0, 1, 3, 48, 49, 83, 200]) assert.equal(fakeShelfProjects({ count: n }).length, n, 'count ' + n);
  assert.equal(fakeShelfProjects({ count: 100000 }).length, 2000, 'a cap, so a typo cannot hang a page');
  assert.equal(fakeShelfProjects({ count: -5 }).length, 0);
  assert.equal(fakeShelfProjects({ count: 3.9 }).length, 3);
  for (const junk of ['abc', NaN, {}, undefined, null]) assert.equal(fakeShelfProjects({ count: junk }).length, 83, JSON.stringify(junk));
  for (const o of [undefined, null, 5, 'x', []]) assert.equal(fakeShelfProjects(o).length, 83);
  assert.equal(fakeShelfProjects({ count: '7' }).length, 7, 'a numeric string is a number (the knob is a string in sessionStorage)');
  const p100 = fakeShelfProjects({ count: 120 });
  assert.match(p100[99].name, /^Placeholder 100$/, 'three-digit numbers past 99');
});

test('deterministic: two calls agree byte for byte, a bigger library starts with the smaller one', () => {
  assert.equal(JSON.stringify(fakeShelfProjects({ count: 83 })), JSON.stringify(fakeShelfProjects({ count: 83 })));
  assert.equal(JSON.stringify(fakeShelfProjects({ count: 20 })), JSON.stringify(fakeShelfProjects({ count: 83 }).slice(0, 20)));
  const a = fakeShelfProjects({ count: 5 }); a[0].name = 'mutated';
  assert.notEqual(fakeShelfProjects({ count: 5 })[0].name, 'mutated', 'every call makes fresh objects');
});

test('scan-shaped: the app\'s own adapter reads them, and the four statuses cycle', () => {
  const ps = fakeShelfProjects({ count: 83 });
  for (const raw of ps) {
    assert.deepEqual(Object.keys(raw).sort(), ['activity', 'canonical_branch', 'completion', 'dev_cmd', 'disk', 'id', 'level', 'metrics', 'name', 'path', 'stack', 'xp']);
    const p = toProject(raw);
    assert.equal(p.id, raw.id); assert.equal(p.name, raw.name); assert.equal(p.hasGit, true); assert.equal(p.branch, 'main'); assert.ok(p.pct >= 0 && p.pct < 100);
    assert.match(raw.path, /^C:\/placeholder\/ph-\d{3}$/);
    assert.match(raw.metrics.git_safety.remote, /^example\.test\/placeholder\/ph-\d{3}$/);
  }
  // the app's statusOf (app.js), the rule the Shelf's tone and colour come from
  const st = (p) => (p.secrets > 0 || !p.hasGit || (p.commits === 0 && p.dirty > 0) ? 'risk' : p.activity === 'stale' || p.dirty > 20 || (p.hasGit && p.branch !== p.canonical) ? 'care' : p.activity === 'dormant' ? 'idle' : p.dirty > 0 ? 'care' : 'ok');
  assert.deepEqual(ps.slice(0, 8).map((r) => st(toProject(r))), ['ok', 'care', 'risk', 'idle', 'ok', 'care', 'risk', 'idle']);
  const c = { ok: 0, care: 0, risk: 0, idle: 0 };
  for (const r of ps) c[st(toProject(r))]++;
  assert.deepEqual(c, D.statusCounts(83)); assert.deepEqual(c, { ok: 21, care: 21, risk: 21, idle: 20 });
  assert.deepEqual(D.cycle, ['ok', 'care', 'risk', 'idle']);
  assert.equal(D.statusCounts(0).ok + D.statusCounts(0).care + D.statusCounts(0).risk + D.statusCounts(0).idle, 0);
  assert.ok(new Set(ps.map((r) => r.stack[0])).size === 4, 'four stacks, so a search by stack narrows');
  assert.deepEqual(D.stacks.map((s) => s[0]).sort(), ['Node', 'Python', 'Rust', 'Static']);
});

test('no owner data: every path, host and name is a placeholder', () => {
  const text = JSON.stringify(fakeShelfProjects({ count: 200 })) + noComments(SRC);
  assert.ok(!/https?:\/\//.test(text), 'no URLs');
  const profile = new RegExp(['[A-Za-z]:[\\\\/]+', 'Us' + 'ers', '|', 'Docu' + 'ments[\\\\/]'].join(''));
  assert.ok(!profile.test(text), 'no user-profile path');
  for (const p of fakeShelfProjects({ count: 200 })) assert.ok(p.path.startsWith('C:/placeholder/'), p.path);
});

// ---- self-contained, because it is pasted ---------------------------------------------------------------------------------------------
test('the generator is one self-contained function: no imports, no clock, no random, nothing outside Math/String/Number/Array', () => {
  const body = noComments(fakeShelfProjects.toString());
  for (const re of [/\brequire\b/, /\bimport\b/, /Math\.random/, /\bDate\b/, /performance/, /\bprocess\b/, /\bwindow\b/, /\bdocument\b/, /\bfetch\b/, /\bsetTimeout\b/, /\bglobalThis\b/, /\bcrypto\b/, /\bBuffer\b/]) assert.ok(!re.test(body), 'the function mentions ' + re);
  // and it runs in a context that has nothing of this module around it
  const out = vm.runInNewContext('(' + fakeShelfProjects.toString() + ')({ count: 83 })', Object.create(null));
  assert.equal(JSON.stringify(out), JSON.stringify(fakeShelfProjects({ count: 83 })));
  assert.equal(JSON.stringify(vm.runInNewContext('(' + fakeShelfProjects.toString() + ')({ describe: true }).namePattern', {})), JSON.stringify(D.namePattern));
  assert.ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(noComments(SRC)), 'the module has no clock or random either');
  assert.ok(/^export function fakeShelfProjects\(/m.test(SRC));
  assert.equal((SRC.match(/^import /gm) || []).length, 0, 'no imports');
});

// ---- the paste blocks ---------------------------------------------------------------------------------------------------------------------
test('markers and anchors are what the header says, and the blocks carry their markers and the generator', () => {
  assert.ok(MARK.fixture.begin.includes('console-fixture') && MARK.fixture.end === '// END console-fixture');
  assert.ok(MARK.control.begin.includes('console-control') && MARK.control.end === '    // END console-control');
  assert.equal(STORAGE_KEY, 'hqFake:projectCount');
  const b = buildBlocks();
  assert.ok(b.fixture.startsWith(MARK.fixture.begin) && b.fixture.endsWith(MARK.fixture.end));
  assert.ok(b.control.startsWith(MARK.control.begin) && b.control.endsWith(MARK.control.end));
  assert.ok(b.fixture.includes('const fakeShelfProjects = ' + fakeShelfProjects.toString() + ';'));
  assert.ok(b.control.includes("'hqFake:projectCount'") && b.control.includes('shelfProjects: (n) =>'));
  assert.equal(fixtureBlock(), b.fixture); assert.equal(controlBlock(), b.control);
  assert.ok(!/Math\.random|Date\.now/.test(b.fixture + b.control));
  assert.ok(!(b.fixture + b.control).includes('\r'), 'the blocks are LF; writeInto converts to the file\'s line ending');
});

// the blocks, evaluated the way fake-preload.js will: the fixture as a top-level const, the control block inside an object literal with `storage` in scope
function control(storage) {
  const b = buildBlocks();
  const code = b.fixture + '\n' + 'const control = {\n    calls: () => [],\n' + b.control + '\n    reset: () => true,\n};\ncontrol;';
  return vm.runInNewContext('(function (storage) {' + code.replace(/;\ncontrol;$/, ';\nreturn control;') + '})', { JSON, Math, Number, String, Array, Object })(storage);
}
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('control block: hqFake.shelfProjects(n) answers n, else the knob, else 83', () => {
  const c = control(mem());
  assert.equal(c.shelfProjects().length, 83);
  assert.equal(c.shelfProjects(5).length, 5);
  assert.equal(c.shelfProjects(0).length, 0, '0 is a count, not a missing argument');
  assert.equal(JSON.stringify(c.shelfProjects(12)), JSON.stringify(fakeShelfProjects({ count: 12 })));
  const st = mem({ [STORAGE_KEY]: '48' }), k = control(st);
  assert.equal(k.shelfProjects().length, 48);
  st.setItem(STORAGE_KEY, '3'); assert.equal(k.shelfProjects().length, 3, 'read per call: no reload is needed to change the size');
  assert.equal(k.shelfProjects(7).length, 7, 'the argument wins over the knob');
  st.setItem(STORAGE_KEY, '0'); assert.equal(k.shelfProjects().length, 0);
  for (const junk of ['banana', '', '-4', 'NaN', 'Infinity']) { st.setItem(STORAGE_KEY, junk); assert.equal(k.shelfProjects().length, 83, 'junk knob ' + JSON.stringify(junk)); }
  assert.equal(control(null).shelfProjects().length, 83, 'no storage at all');
  assert.equal(control({ getItem() { throw new Error('blocked'); } }).shelfProjects().length, 83, 'a throwing storage');
  assert.equal(c.reset(), true, 'the property after it still parses: the block ends with a comma');
});

test('extractBlock / replaceBlock: markers in, between and CRLF; null when a marker is missing or out of order', () => {
  const src = 'a\n' + MARK.fixture.begin + '\nold\n' + MARK.fixture.end + '\nz\n';
  assert.equal(extractBlock(src, MARK.fixture), MARK.fixture.begin + '\nold\n' + MARK.fixture.end);
  assert.equal(replaceBlock(src, MARK.fixture, 'NEW'), 'a\nNEW\nz\n');
  assert.equal(extractBlock(src.replace(/\n/g, '\r\n'), MARK.fixture), MARK.fixture.begin + '\nold\n' + MARK.fixture.end, 'CRLF source reads as LF');
  assert.equal(extractBlock('no markers', MARK.fixture), null);
  assert.equal(replaceBlock('no markers', MARK.fixture, 'x'), null);
  assert.equal(replaceBlock(MARK.fixture.end + '\n' + MARK.fixture.begin, MARK.fixture, 'x'), null, 'end before begin');
  assert.equal(replaceBlock(MARK.fixture.begin, MARK.fixture, 'x'), null, 'begin only');
});

const SYNTH = ['// head', 'const MONEY = 1;', ANCHOR.fixtureBefore + ' (pasted from somewhere)', 'const SEC = 2;', '// END security-fixture', 'function createFake() {', '  const a = 1;', ANCHOR.controlAfter, '    calls: () => [],', '  };', '  return { control };', '}', ''].join('\n');

test('insertMarkers: two empty marker pairs at the documented anchors, once; refuses otherwise', () => {
  const r = insertMarkers(SYNTH);
  assert.ok(r.text && !r.error);
  const lines = r.text.split('\n');
  const at = (needle) => lines.findIndex((l) => l.startsWith(needle));
  assert.ok(at(MARK.fixture.begin) > 0 && at(MARK.fixture.end) === at(MARK.fixture.begin) + 1, 'an empty fixture pair');
  assert.ok(at(MARK.fixture.end) < at(ANCHOR.fixtureBefore), 'in front of the security fixture');
  assert.equal(lines[at(ANCHOR.controlAfter) + 1], MARK.control.begin, 'right after `const control = {`');
  assert.equal(lines[at(ANCHOR.controlAfter) + 2], MARK.control.end);
  assert.equal(lines[at(ANCHOR.controlAfter) + 3], '    calls: () => [],', 'nothing else moved');
  assert.deepEqual(norm(r.text).replace(MARK.fixture.begin + '\n' + MARK.fixture.end + '\n\n', '').replace(MARK.control.begin + '\n' + MARK.control.end + '\n', ''), SYNTH, 'removing the pairs gives the original back');
  // once: a second run refuses, and so does a source with a missing or doubled anchor
  assert.match(insertMarkers(r.text).error, /already in the file/);
  assert.match(insertMarkers(SYNTH.replace(ANCHOR.fixtureBefore, '// nothing')).error, /anchor not found exactly once/);
  assert.match(insertMarkers(SYNTH.replace(ANCHOR.controlAfter, '  const other = {')).error, /anchor not found exactly once/);
  assert.match(insertMarkers(SYNTH + SYNTH).error, /anchor not found exactly once/);
  assert.ok(insertMarkers(SYNTH.replace(/\n/g, '\r\n')).text, 'CRLF source is accepted');
});

test('writeInto: rewrites between the markers keeping the file\'s line ending, idempotent, and writes nothing when a marker is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-shelf-paste-'));
  try {
    const file = path.join(dir, 'fake.js');
    const withMarkers = insertMarkers(SYNTH).text;
    fs.writeFileSync(file, withMarkers.replace(/\n/g, '\r\n'));
    const r = writeInto(file);
    assert.deepEqual(r, { written: true, missing: [] });
    const out = fs.readFileSync(file, 'utf8');
    assert.ok(out.includes('\r\n') && !/[^\r]\n/.test(out), 'still CRLF everywhere');
    assert.equal(extractBlock(out, MARK.fixture), buildBlocks().fixture);
    assert.equal(extractBlock(out, MARK.control), buildBlocks().control);
    assert.doesNotThrow(() => new vm.Script(out), 'the result is still a valid script');
    writeInto(file);
    assert.equal(fs.readFileSync(file, 'utf8'), out, 'idempotent');
    const lf = path.join(dir, 'lf.js');
    fs.writeFileSync(lf, withMarkers);
    writeInto(lf);
    assert.ok(!fs.readFileSync(lf, 'utf8').includes('\r'), 'an LF file stays LF');
    const bare = path.join(dir, 'bare.js');
    fs.writeFileSync(bare, SYNTH);
    assert.deepEqual(writeInto(bare), { written: false, missing: ['fixture', 'control'] });
    assert.equal(fs.readFileSync(bare, 'utf8'), SYNTH, 'nothing written');
    const half = path.join(dir, 'half.js');
    fs.writeFileSync(half, SYNTH.replace(ANCHOR.fixtureBefore, MARK.fixture.begin + '\n' + MARK.fixture.end + '\n' + ANCHOR.fixtureBefore));
    assert.deepEqual(writeInto(half), { written: false, missing: ['control'] });
    assert.ok(!fs.readFileSync(half, 'utf8').includes('fakeShelfProjects'), 'a half-marked file is left alone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- against the real fake preload ---------------------------------------------------------------------------------------------------------------
const MARKED = FAKE_SRC.includes(MARK.fixture.begin) || FAKE_SRC.includes(MARK.control.begin);
const skipUnless = (cond, why) => (cond ? {} : { skip: why });

test('the real fake-preload.js: the anchors are there exactly once, and the paste yields a valid script whose hook answers',
  skipUnless(!MARKED, 'the console markers are already in fake-preload.js: the drift test below covers it'), () => {
    const r = insertMarkers(FAKE_SRC);
    assert.ok(r.text, r.error);
    let out = replaceBlock(r.text, MARK.fixture, buildBlocks().fixture);
    out = replaceBlock(out, MARK.control, buildBlocks().control);
    assert.ok(out, 'both pairs replaced');
    assert.doesNotThrow(() => new vm.Script(out), 'the pasted file parses');
    const m = { exports: {} };
    new Function('module', 'require', 'window', out)(m, () => { throw new Error('no electron'); }, undefined);
    const fake = m.exports.createFake({ storage: mem({ [STORAGE_KEY]: '9' }) });
    assert.equal(typeof fake.control.shelfProjects, 'function');
    assert.equal(fake.control.shelfProjects().length, 9, 'the knob');
    assert.equal(fake.control.shelfProjects(4).length, 4);
    assert.equal(JSON.stringify(fake.control.shelfProjects(6)), JSON.stringify(fakeShelfProjects({ count: 6 })), 'the pasted copy is the generator');
    // window.hq keeps exactly the real preload's method set: the hook is on hqFake only
    assert.ok(!('shelfProjects' in fake.hq), 'not on hq');
    assert.ok(!fake.methods.some((x) => /shelf/i.test(x)));
    // and the rest of the file is untouched: removing the pasted blocks gives the original back
    assert.equal(norm(out).replace(buildBlocks().fixture + '\n\n', '').replace(buildBlocks().control + '\n', ''), norm(FAKE_SRC));
  });

test('the real fake-preload.js: the pasted blocks have not drifted from the generator',
  skipUnless(MARKED, 'the console markers are not in fake-preload.js yet (run tools/console-fixture-paste.mjs --init, then --write; see the pass notes)'), () => {
    assert.equal(extractBlock(FAKE_SRC, MARK.fixture), buildBlocks().fixture, 'fixture block drifted: run node tools/console-fixture-paste.mjs --write');
    assert.equal(extractBlock(FAKE_SRC, MARK.control), buildBlocks().control, 'control block drifted: run node tools/console-fixture-paste.mjs --write');
    assert.equal((FAKE_SRC.match(/BEGIN console-fixture/g) || []).length, 1);
    assert.equal((FAKE_SRC.match(/BEGIN console-control/g) || []).length, 1);
  });

test('the paste tool does nothing on import (no write, no process hook)', () => {
  const code = noComments(PASTE_SRC);
  assert.ok(/if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\)/.test(code), 'the CLI is guarded');
  for (const re of [/setInterval|setTimeout/, /\bfetch\(/, /from 'node:(net|http|child_process)/]) assert.ok(!re.test(code), String(re));
});
