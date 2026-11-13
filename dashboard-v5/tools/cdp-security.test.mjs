// node --test dashboard-v5/tools/cdp-security.test.mjs
// The Security cdp scenarios cannot run here (they need the Electron harness), so this pins what can be pinned in plain Node: the factory's
// shape, that importing it does nothing, that every in-page snippet is valid JavaScript, the expectations computed from the fixture, that
// they agree with the words and step order in logic/security.js, that the pasted fake main process behaves, and that each scenario starts,
// fails cleanly when the page is not there, and cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as mod from './cdp-security.mjs';
import { securityFixture, FIXTURE_EXPORTS, FAKE_PASSPHRASE } from '../src/selftest-security.mjs';
import { STEPS, HIDE_WORDING, COPY_NOTE, CONFLICT_WORDING, EXPORT_WORDING, lookedLine } from '../src/logic/security.js';
import { SEC_TEXT } from '../src/vals/security.js';

const { makeSecurityScenarios, SECURITY_SCENARIOS, SECURITY_WRITE_METHODS, PAGE, createFakeSecurity, fakeSecuritySource, expectedBubbles, STEP_IDS, SENTENCES, COUNT_STEPS } = mod;
const SRC = fs.readFileSync(new URL('./cdp-security.mjs', import.meta.url), 'utf8');

const SNAP = (keys) => `(() => { const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = localStorage.getItem(k); return o; })()`;
const RESTORE = (saved) => `for (const [k, v] of Object.entries(${JSON.stringify(saved || {})})) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }`;
const NAMES = ['security-map-render', 'security-node-edit', 'security-unlock-clears', 'security-health', 'security-setup', 'security-generate'];

test('the factory returns exactly the six scenarios, each an async function of one argument', () => {
  const S = makeSecurityScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  assert.deepEqual([...SECURITY_SCENARIOS].sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) {
    assert.equal(typeof fn, 'function', name);
    assert.equal(fn.constructor.name, 'AsyncFunction', name + ' is async');
    assert.equal(fn.length, 1, name + ' takes (t)');
  }
  assert.deepEqual(Object.keys(makeSecurityScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE })).sort(), NAMES.slice().sort(), 'sleep is optional');
});

test('importing the file has no side effects: no socket, no timer, no process hook, nothing from cdp-gate', async () => {
  for (const re of [/\bWebSocket\b/, /\bfetch\(/, /process\.(exit|on|argv|stdin)/, /createServer|\.listen\(/, /cdp-gate/, /\brequire\(/, /setInterval/, /from 'node:(net|http|child_process)/]) {
    assert.ok(!re.test(SRC.replace(/^\/\/.*$/gm, '')), 'source mentions ' + re);
  }
  assert.deepEqual(Object.keys(await import('./cdp-security.mjs')).sort(), Object.keys(mod).sort());
  assert.ok(typeof PAGE.READY === 'string');
});

// samples for the snippet builders that take arguments
const SAMPLES = {
  goSecurity: [[], ['health']], text: [['[data-sec="status"]']], has: [['[data-sec="card"]']], count: [['[data-sec="step"]']], texts: [['[data-sec="step-check"]']],
  click: [['[data-sec="refresh"]']], clickNodeByTitle: [['/^example/']], clickInRoot: [['document.querySelector("main")', '/Ente/']], pressedChips: [['document.querySelector("main")']],
  setField: [['[data-sec="pass"]', 'x"y\'z']], fieldValue: [['[data-sec="pass"]']], focusField: [['[data-sec="pass"]']], checkbox: [['[data-sec="breaches"]']],
  clickCheckbox: [['[data-sec="breaches"]']], setSlider: [[1], [0]], calls: [['security.read']], callCount: [['security.read']], anyCall: [[SECURITY_WRITE_METHODS]],
  persistRead: [[{ a: 1 }]], leaks: [['correct horse example']],
};
function everySnippet() {
  const out = [];
  for (const [name, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') out.push([name, v]);
    else { const sets = SAMPLES[name]; assert.ok(sets, 'PAGE.' + name + ' takes arguments: add samples to the test'); for (const a of sets) out.push([name + '(' + a.length + ')', v(...a)]); }
  }
  return out;
}

test('every in-page snippet is valid JavaScript (they are evaluated in a page this test cannot open)', () => {
  const all = everySnippet();
  assert.ok(all.length > 40, 'snippets ' + all.length);
  for (const [name, code] of all) {
    assert.equal(typeof code, 'string', name);
    assert.doesNotThrow(() => new vm.Script('(' + code + ')'), name);
  }
});

test('the leak scan snippet actually finds a passphrase in a stand-in page (the check is not vacuous) and passes a clean one', () => {
  const run = (dirty) => {
    const pass = 'correct horse example';
    const ctx = {
      WHQ: { app: { logic: { state: { sec: dirty ? { note: pass } : { note: 'ok' }, fn() { return pass; } }, renderVals() { return { secv: { secShow: true } }; } } }, store: { live: { security: { loaded: true } } } },
      sessionStorage: { length: 1, key: () => 'k', getItem: () => 'v' }, localStorage: { length: 0, key: () => null, getItem: () => null },
      document: { documentElement: { outerHTML: '<html></html>' } },
    };
    return vm.runInNewContext(PAGE.leaks(pass), ctx);
  };
  assert.deepEqual(JSON.parse(JSON.stringify(run(false))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(run(true))), ['state']);
});

test('expectations: the invented footprint has 10 bubbles; the sentences and step order agree with logic/security.js', () => {
  assert.equal(expectedBubbles(), 10);
  assert.equal(expectedBubbles(securityFixture()), securityFixture().map.accounts.length + 2 + 1);
  assert.equal(COUNT_STEPS, STEPS.length);
  assert.deepEqual([...STEP_IDS], STEPS.map((s) => s.id));
  assert.equal(SENTENCES.hide, HIDE_WORDING);
  assert.ok(COPY_NOTE.includes(SENTENCES.clipboard));
  assert.ok(SEC_TEXT.unlockHelp.includes(SENTENCES.unlockClipboard));
  assert.equal(lookedLine(['Downloads', 'Desktop', 'Documents'], 1), SENTENCES.looked);
  assert.equal(SENTENCES.conflict, CONFLICT_WORDING);
  assert.equal(SENTENCES.exportGuess, EXPORT_WORDING);
  assert.equal(SENTENCES.breachBox, 'check breaches online (Have I Been Pwned, 5 hash characters leave the PC)');
  assert.ok(SECURITY_WRITE_METHODS.includes('security.refresh') && SECURITY_WRITE_METHODS.length === 8);
});

// ---- the fake main process ---------------------------------------------------------------------------------------------
test('the fake main process answers like the real one: read, wrong and right passphrase, edits, adds, settings, walkthrough, trash, copy', async () => {
  const fake = createFakeSecurity(securityFixture(), FIXTURE_EXPORTS);
  const r0 = await fake.read();
  assert.equal(r0.map.accounts.length, 7);
  assert.equal(r0.cliFound, true);
  assert.deepEqual(await fake.refresh('wrong horse example', true), { error: 'wrong passphrase or key file' });
  assert.equal((await fake.read()).map.refreshedAt, '2026-11-10T09:00:00.000Z', 'a wrong passphrase changes nothing');
  assert.deepEqual(await fake.refresh(FAKE_PASSPHRASE, false), { ok: true, accounts: 7, breachChecked: false, notes: [] });
  assert.equal((await fake.read()).map.refreshedAt, '2026-11-11T09:00:00.000Z');
  // edit: an allowed key applies, null clears, an unknown key is refused
  const id = r0.map.accounts[0].id;
  assert.deepEqual(await fake.edit(id, { twofa: 'ente' }), { ok: true });
  assert.equal((await fake.read()).owner.accounts[id].twofa, 'ente');
  assert.deepEqual(await fake.edit(id, { twofa: null }), { ok: true });
  assert.equal((await fake.read()).owner.accounts[id].twofa, undefined);
  assert.deepEqual(await fake.edit(id, { note: 'x' }), { error: 'that change is not allowed' });
  assert.deepEqual(await fake.addManual({ title: '  ' }), { error: 'a name is required' });
  const m = await fake.addManual({ title: 'old-hobby-2.test', host: 'old-hobby-2.test' });
  assert.ok(m.ok && /^m-[0-9a-f]{12}$/.test(m.id));
  assert.deepEqual(await fake.addIdentity({ kind: 'email', value: 'nope' }), { error: 'not an email or phone number' });
  const i = await fake.addIdentity({ kind: 'email', value: 'second@example.test' });
  assert.ok(i.ok && /^i-[0-9a-f]{12}$/.test(i.ref));
  assert.ok((await fake.addIdentity({ kind: 'phone', value: '+1 (555) 010-0100' })).ok);
  assert.match((await fake.settings({ vaultPath: 'C:/placeholder/vault.txt' })).error, /\.kdbx/);
  assert.deepEqual(await fake.settings({ vaultPath: 'C:/placeholder/vault/other.kdbx' }), { ok: true });
  assert.deepEqual(await fake.walkthrough('phone-keepassdx', true), { ok: true });
  assert.equal((await fake.read()).settings.walkthrough['phone-keepassdx'].done, true);
  assert.deepEqual((await fake.scanExports()).files.map((f) => f.name), ['Chrome Passwords.csv']);
  assert.deepEqual(await fake.trashExport('not-listed.csv', 'C:/x'), { error: 'not in the last scan' });
  assert.deepEqual(await fake.trashExport('Chrome Passwords.csv', 'C:/placeholder/Downloads'), { ok: true });
  assert.deepEqual((await fake.scanExports()).files, []);
  assert.deepEqual(await fake.copy('a-b-c'), { ok: true });
  assert.deepEqual(await fake.copy(''), { error: 'nothing to copy' });
  // the fixture's own data is never mutated by a fake (each fake clones)
  assert.equal(securityFixture().owner.manual.length, 1);
});

test('the paste source runs on its own: a fresh fake with the same behaviour and no import', async () => {
  const src = fakeSecuritySource();
  assert.ok(src.includes('FAKE_SECURITY_FIXTURE') && src.includes('function createFakeSecurity'));
  assert.ok(!/\bimport\b|\brequire\(/.test(src.replace(/'[^']*'/g, '')), 'the pasted text must be self-contained');
  const fake = new vm.Script(src + '\ncreateFakeSecurity(FAKE_SECURITY_FIXTURE, FAKE_SECURITY_EXPORTS);').runInNewContext({});
  const r = await fake.read();
  assert.equal(r.map.accounts.length, 7);
  assert.equal((await fake.refresh('correct horse example', true)).ok, true);
  assert.equal((await fake.refresh('nope', true)).error, 'wrong passphrase or key file');
  // only invented names in what gets pasted into the public repo
  for (const s of ['example.test', 'acme.test', 'alpha-site.test', 'owner@example.test']) assert.ok(src.includes(s), s);
  assert.ok(!/@(gmail|outlook|yahoo|hotmail)\./i.test(src), 'a real mail domain in the fixture');
  assert.ok(!/C:\\\\Users|C:\/Users/.test(src), 'a real home folder in the fixture');
});

// ---- each scenario starts, fails cleanly, and cleans up ---------------------------------------------------------------------
test('with no page behind them every scenario returns failures (an array of text), runs the cleanup and never throws or hangs', async () => {
  const S = makeSecurityScenarios({ fresh: async () => null, SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  for (const [name, fn] of Object.entries(S)) {
    const evaluated = [];
    const t = { evaluate: async (e) => { evaluated.push(String(e)); return undefined; }, waitFor: async () => false, send: async () => ({}), reload: async () => {}, errors: () => [], sleep: async () => {} };
    const res = await fn(t);
    assert.ok(Array.isArray(res), name + ' returns an array');
    assert.ok(res.length > 0, name + ' reports why it could not run');
    for (const m of res) assert.equal(typeof m, 'string', name);
    assert.ok(evaluated.includes(PAGE.cleanup), name + ' ran the cleanup');
  }
});

test('a scenario whose boot refuses (fresh returns failures) hands them back untouched', async () => {
  const S = makeSecurityScenarios({ fresh: async () => ['the app never came back'], SNAP_KEYS: SNAP, RESTORE_KEYS: RESTORE, sleep: async () => {} });
  for (const fn of Object.values(S)) {
    const t = { evaluate: async () => undefined, waitFor: async () => false, send: async () => ({}), reload: async () => {}, errors: () => [], sleep: async () => {} };
    assert.deepEqual(await fn(t), ['the app never came back']);
  }
});

test('the unlock scenario uses only the invented passphrases', () => {
  assert.equal(FAKE_PASSPHRASE, 'correct horse example');
  assert.ok(SRC.includes("'wrong horse example'"));
  assert.ok(!/(password|passphrase)\s*[:=]\s*'[^']{6,}'/i.test(SRC.replace(/WRONG = 'wrong horse example', RIGHT = FAKE_PASSPHRASE/, '')), 'a literal passphrase other than the invented ones');
});

// ---- the block pasted into tools/fake-preload.js is the generator's text now (drift fails, like a golden) --------------------
test('the security-fixture block in fake-preload.js equals fakeSecuritySource() (drift fails)', () => {
  const src = fs.readFileSync(new URL('./fake-preload.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const a = src.indexOf('// BEGIN security-fixture'), b = src.indexOf('// END security-fixture');
  assert.ok(a >= 0 && b > a, 'fake-preload.js lacks the security-fixture marker pair');
  const body = src.slice(src.indexOf('\n', a) + 1, b).replace(/\n$/, '');
  assert.equal(body, fakeSecuritySource().replace(/\n$/, ''), 'run the paste again (see the marker line) when cdp-security.mjs or the invented fixture changes');
});

test('the fake preload exposes hq.security from the pasted fake, and reset(true) puts its state back', async () => {
  const { createRequire } = await import('node:module');
  const { createFake } = createRequire(import.meta.url)('./fake-preload.js');
  const f = createFake({});
  const r = await f.hq.security.read();
  assert.equal(r.map.accounts.length, 7);
  assert.equal((await f.hq.security.refresh('wrong', true)).error, 'wrong passphrase or key file');
  assert.equal((await f.hq.security.addManual({ title: 'Test shop', host: 'shop.example.test' })).ok, true);
  assert.equal((await f.hq.security.read()).owner.manual.length, r.owner.manual.length + 1);
  f.control.reset(true);
  assert.equal((await f.hq.security.read()).owner.manual.length, r.owner.manual.length);
});
