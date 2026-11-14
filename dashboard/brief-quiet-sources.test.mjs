// Brief quiet lane sources (dashboard/brief-quiet-sources.js): stat and read only, in a temp folder of invented files.
//   node --test dashboard/brief-quiet-sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { create, gather, SENSORS } = require('./brief-quiet-sources.js');

const D = 24 * 3600e3;
function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-quiet-'));
  const dataDir = path.join(root, 'data'), logDir = path.join(root, 'logs');
  fs.mkdirSync(dataDir); fs.mkdirSync(logDir);
  return { root, dataDir, logDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const age = (file, ms, now) => { const t = new Date(now - ms); fs.utimesSync(file, t, t); };
const PAIRING = JSON.stringify({ v: 1, origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });

test('an absent status.json is "walkthrough not started"; a started one is not; an unreadable one is skipped (null)', () => {
  const t = tmp();
  try {
    const g = () => create({ dataDir: t.dataDir, logDir: t.logDir }).gather();
    assert.equal(g().security.started, false, 'absent');
    put(path.join(t.dataDir, 'security', 'status.json'), JSON.stringify({ walkthroughStarted: false }));
    assert.equal(g().security.started, false);
    put(path.join(t.dataDir, 'security', 'status.json'), JSON.stringify({ walkthroughStarted: true, counts: {} }));
    assert.equal(g().security.started, true);
    put(path.join(t.dataDir, 'security', 'status.json'), '{ not json');
    assert.equal(g().security.started, null, 'unparseable');
    put(path.join(t.dataDir, 'security', 'status.json'), '[1,2]');
    assert.equal(g().security.started, null, 'not an object');
    fs.rmSync(path.join(t.dataDir, 'security', 'status.json'));
    fs.mkdirSync(path.join(t.dataDir, 'security', 'status.json'));   // a folder where the file should be: unreadable
    assert.equal(g().security.started, null, 'unreadable');
  } finally { t.done(); }
});

test('bridge paired follows the two-file rule: a valid pairing AND a non-empty token', () => {
  const t = tmp();
  try {
    const g = () => create({ dataDir: t.dataDir, logDir: t.logDir }).gather().bridge.paired;
    assert.equal(g(), false, 'nothing yet');
    put(path.join(t.dataDir, '.bridge-pairing.json'), PAIRING);
    assert.equal(g(), false, 'no token');
    put(path.join(t.dataDir, '.bridge-token'), '');
    assert.equal(g(), false, 'empty token');
    put(path.join(t.dataDir, '.bridge-token'), 'placeholder-token');
    assert.equal(g(), true);
    put(path.join(t.dataDir, '.bridge-pairing.json'), JSON.stringify({ v: 2, origin: 'chrome-extension://abc' }));
    assert.equal(g(), false, 'wrong version');
    put(path.join(t.dataDir, '.bridge-pairing.json'), JSON.stringify({ v: 1, origin: 'https://example.invalid' }));
    assert.equal(g(), false, 'not an extension origin');
    put(path.join(t.dataDir, '.bridge-pairing.json'), 'garbage');
    assert.equal(g(), false, 'unparseable pairing is "not paired" (reach.js says the same)');
  } finally { t.done(); }
});

test('a sensor file 4 days old is reported with its kind and time; an absent file is not reported at all', () => {
  const t = tmp(), now = Date.now();
  try {
    put(path.join(t.dataDir, 'pc-health.json'), '{}');
    age(path.join(t.dataDir, 'pc-health.json'), 4 * D, now);
    put(path.join(t.dataDir, 'github.json'), '{}');
    age(path.join(t.dataDir, 'github.json'), 60e3, now);
    const g = create({ dataDir: t.dataDir, logDir: t.logDir }).gather();
    assert.deepEqual(g.sources.map((s) => s.kind).sort(), ['github', 'pc-health']);
    const pc = g.sources.find((s) => s.kind === 'pc-health');
    assert.ok(Math.abs((now - pc.mtimeMs) - 4 * D) < 5000);
    assert.ok(!g.sources.some((s) => s.kind === 'accounts' || s.kind === 'disk-history'), 'absent files are never listed');
    assert.deepEqual(SENSORS.map((s) => s[0]), ['pc-health', 'github', 'accounts', 'disk-history']);
  } finally { t.done(); }
});

test('an unreadable source (a folder in place of a sensor file) is skipped, and one bad source never stops the rest', () => {
  const t = tmp();
  try {
    fs.mkdirSync(path.join(t.dataDir, 'github.json'));
    put(path.join(t.dataDir, 'accounts.json'), '{}');
    const g = create({ dataDir: t.dataDir, logDir: t.logDir }).gather();
    assert.deepEqual(g.sources.map((s) => s.kind), ['accounts']);
  } finally { t.done(); }
});

test('Money opened: a space-money mark in a retained day log; none in the logs is false; no logs at all is null', () => {
  const t = tmp();
  try {
    const mk = () => create({ dataDir: t.dataDir, logDir: t.logDir, cacheMs: 0 }).gather().moneyOpened;
    assert.equal(mk(), null, 'no day log to tell from');
    put(path.join(t.logDir, 'notes.txt'), 'x');
    assert.equal(mk(), null, 'a stray file is not a day log');
    put(path.join(t.logDir, 'app-2026-11-10.log'), JSON.stringify({ event: 'use', surface: 'space-home', action: 'open' }) + '\n' + JSON.stringify({ event: 'boot' }) + '\n');
    assert.equal(mk(), false, 'day logs exist and hold no Money mark');
    put(path.join(t.logDir, 'app-2026-11-11.log'), '{"event":"note","text":"space-money is a word here"}\nnot json at all\n');
    assert.equal(mk(), false, 'the word alone, in another event, is not a mark');
    put(path.join(t.logDir, 'app-2026-11-12.log'), JSON.stringify({ event: 'use', surface: 'space-money', action: 'open' }) + '\n');
    assert.equal(mk(), true);
  } finally { t.done(); }
});

test('a found Money mark is kept; a "no" is reused for the cache window, then looked at again', () => {
  const t = tmp();
  try {
    let clock = 1_000_000;
    const inst = create({ dataDir: t.dataDir, logDir: t.logDir, now: () => clock, cacheMs: 60e3 });
    put(path.join(t.logDir, 'app-2026-11-10.log'), JSON.stringify({ event: 'use', surface: 'space-home', action: 'open' }) + '\n');
    assert.equal(inst.gather().moneyOpened, false);
    put(path.join(t.logDir, 'app-2026-11-11.log'), JSON.stringify({ event: 'use', surface: 'space-money', action: 'open' }) + '\n');
    clock += 10e3;
    assert.equal(inst.gather().moneyOpened, false, 'inside the cache window the old answer stands');
    clock += 60e3;
    assert.equal(inst.gather().moneyOpened, true, 'after the window it looks again');
    fs.rmSync(path.join(t.logDir, 'app-2026-11-11.log'));
    clock += 600e3;
    assert.equal(inst.gather().moneyOpened, true, 'once found, it stays found');
  } finally { t.done(); }
});

test('no path, name or content appears in anything gather returns', () => {
  const t = tmp(), now = Date.now();
  try {
    put(path.join(t.dataDir, 'pc-health.json'), JSON.stringify({ note: 'PLACEHOLDER-SECRET-CONTENT' }));
    age(path.join(t.dataDir, 'pc-health.json'), 5 * D, now);
    put(path.join(t.dataDir, '.bridge-pairing.json'), PAIRING);
    put(path.join(t.dataDir, '.bridge-token'), 'placeholder-token-value');
    put(path.join(t.dataDir, 'security', 'status.json'), JSON.stringify({ walkthroughStarted: true, label: 'PLACEHOLDER-SECRET-CONTENT' }));
    put(path.join(t.logDir, 'app-2026-11-12.log'), JSON.stringify({ event: 'use', surface: 'space-money', action: 'open' }) + '\n');
    const blob = JSON.stringify(create({ dataDir: t.dataDir, logDir: t.logDir }).gather());
    for (const bad of [t.root, t.dataDir, 'hq-quiet-', 'PLACEHOLDER-SECRET-CONTENT', 'placeholder-token', 'chrome-extension', 'abcdefghijklmnop', '.json', 'status', '\\\\', '/']) assert.ok(!blob.includes(bad), 'leaked ' + bad + ' in ' + blob);
    const g = JSON.parse(blob);
    assert.deepEqual(Object.keys(g).sort(), ['bridge', 'moneyOpened', 'security', 'sources']);
    assert.equal(g.bridge.paired, true);
    assert.equal(g.security.started, true);
    assert.equal(g.moneyOpened, true);
  } finally { t.done(); }
});

test('never throws: no folders, junk options, a module-level call', () => {
  assert.doesNotThrow(() => create().gather());
  assert.doesNotThrow(() => create({ dataDir: path.join(os.tmpdir(), 'hq-quiet-does-not-exist-' + process.pid), logDir: path.join(os.tmpdir(), 'hq-quiet-nor-this-' + process.pid) }).gather());
  const g = create({ dataDir: path.join(os.tmpdir(), 'hq-quiet-does-not-exist-' + process.pid), logDir: path.join(os.tmpdir(), 'hq-quiet-nor-this-' + process.pid) }).gather();
  assert.equal(g.security.started, false);
  assert.equal(g.bridge.paired, false);
  assert.equal(g.moneyOpened, null);
  assert.deepEqual(g.sources, []);
  for (const bad of [undefined, null, 5, 'x', {}, { dataDir: 7 }]) assert.doesNotThrow(() => gather(bad));
  const none = gather({ dataDir: path.join(os.tmpdir(), 'hq-quiet-none-' + process.pid), logDir: path.join(os.tmpdir(), 'hq-quiet-none-logs-' + process.pid) });
  assert.deepEqual(Object.keys(none).sort(), ['bridge', 'moneyOpened', 'security', 'sources']);
  // a throwing fs: still never throws, every field falls back to "could not tell"
  const boom = () => { throw new Error('boom'); };
  const bad = create({ dataDir: 'x', logDir: 'y', fs: { readFileSync: boom, statSync: boom, readdirSync: boom, openSync: boom, fstatSync: boom, readSync: boom, closeSync: boom } }).gather();
  assert.deepEqual(bad, { security: { started: null }, bridge: { paired: null }, moneyOpened: null, sources: [] });
});
