// node --test dashboard/json-store.test.mjs — quarantine-on-corrupt reads for
// every write-back store, plus the spell-telemetry shape validator (the one
// store that used to bypass the rule: a corrupt file was silently destroyed on
// the next cast, and wrong-shape-but-valid JSON crashed recordCast).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJsonStore, isPlainObj, emptyTelemetry, telemetryOk } = require('./json-store.js');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-json-store-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
  return d;
}

test('missing file → a FRESH empty each time (never a shared reference)', (t) => {
  const f = path.join(tmp(t), 'nope.json');
  const a = readJsonStore(f, () => ({ entries: [] }), isPlainObj);
  const b = readJsonStore(f, () => ({ entries: [] }), isPlainObj);
  assert.deepEqual(a, { entries: [] });
  assert.notEqual(a, b);
});

test('unparseable file → quarantined to .corrupt, content preserved, empty returned', (t) => {
  const f = path.join(tmp(t), 'store.json');
  fs.writeFileSync(f, 'not json {{{');
  const v = readJsonStore(f, () => ({}), isPlainObj);
  assert.deepEqual(v, {});
  assert.ok(!fs.existsSync(f), 'bad file moved away so a write-back cannot destroy it');
  assert.equal(fs.readFileSync(f + '.corrupt', 'utf8'), 'not json {{{');
});

test('valid JSON of the WRONG shape → treated as corrupt, not crashed on (the recordCast failure scenario)', (t) => {
  const f = path.join(tmp(t), 'spell-telemetry.json');
  fs.writeFileSync(f, '[]');   // parses fine; t.casts.push would throw downstream
  const v = readJsonStore(f, emptyTelemetry, telemetryOk);
  assert.deepEqual(v, { version: 1, confirmed_hashes: {}, favorites: [], casts: [], rollup: {} });
  assert.ok(Array.isArray(v.casts) && Array.isArray(v.favorites), 'every writer\'s assumption holds');
  assert.equal(fs.readFileSync(f + '.corrupt', 'utf8'), '[]', 'nothing silently erased');
});

test('telemetryOk pins exactly the shape the writers assume', () => {
  assert.equal(telemetryOk(emptyTelemetry()), true);
  assert.equal(telemetryOk({ version: 1, confirmed_hashes: {}, favorites: [], casts: [], rollup: {}, extra: 1 }), true, 'additive fields pass');
  for (const bad of [[], null, 42, { casts: {} }, { casts: [], favorites: {} }, { casts: [], favorites: [], rollup: [] }, { casts: [], favorites: [], rollup: {}, confirmed_hashes: [] }]) {
    assert.equal(telemetryOk(bad), false, JSON.stringify(bad));
  }
});

test('a valid store passes through untouched', (t) => {
  const f = path.join(tmp(t), 'spell-telemetry.json');
  const full = { version: 1, confirmed_hashes: { 'sp-x': 'h1' }, favorites: ['sp-x'], casts: [{ cast_id: 'c-1' }], rollup: { 'sp-x': { lifetime_casts: 2 } } };
  fs.writeFileSync(f, JSON.stringify(full));
  assert.deepEqual(readJsonStore(f, emptyTelemetry, telemetryOk), full);
  assert.ok(!fs.existsSync(f + '.corrupt'));
});

test('a real IO error is rethrown, never masked by a reset', (t) => {
  const dir = tmp(t);   // reading a directory is EISDIR, not ENOENT
  assert.throws(() => readJsonStore(dir, () => ({}), isPlainObj), (e) => e.code !== 'ENOENT');
});
