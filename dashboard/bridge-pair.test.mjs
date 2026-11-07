// Pairing, main side: the owner's Allow is the only thing that writes data/.bridge-token. Fake dialog, fake timers,
// a temp data folder — never the repo's data/ and never port 47821.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create, createTokenStore, allowCors } = require('./bridge-pair.js');

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'a1'.repeat(32);          // 64 hex, a placeholder
const CODE = '4821';

function rig({ now: startNow = 1_000_000 } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'hq-pair-test-'));
  const clock = { t: startNow };
  const timers = new Map(); let seq = 0;
  const logs = [];
  const dialogs = [];
  const dialog = {
    showMessageBox(opts) {
      return new Promise((resolve, reject) => dialogs.push({ opts, resolve, reject }));
    },
  };
  const pair = create({
    dataDir, dialog, now: () => clock.t, log: (m) => logs.push(String(m)),
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, due: clock.t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    store: createTokenStore({ dataDir, now: () => clock.t }),
    pid: 4242,
  });
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  const flush = () => new Promise((r) => setImmediate(r));
  return { dataDir, clock, pair, dialogs, logs, fire, flush, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
const ask = (r, over = {}) => r.pair.handlePair({ origin: EXT, body: { code: CODE, token: TOKEN }, ...over });
const files = (dir) => readdirSync(dir).sort();

test('a non-extension origin and a malformed request are refused before any dialog', async () => {
  const r = rig();
  try {
    for (const origin of ['', 'https://example.com', 'http://127.0.0.1:47821', 'chrome-extension://UPPER space', undefined]) {
      assert.equal((await ask(r, { origin })).status, 403, String(origin));
    }
    for (const body of [null, {}, { code: '12', token: TOKEN }, { code: CODE, token: 'zz' }, { code: CODE, token: TOKEN.slice(1) }, { code: 4821, token: TOKEN }, { code: CODE, token: TOKEN.toUpperCase() }]) {
      assert.equal((await ask(r, { body })).status, 403, JSON.stringify(body));
    }
    assert.equal(r.dialogs.length, 0);
    assert.deepEqual(files(r.dataDir), []);
  } finally { r.cleanup(); }
});

test('the dialog is parentless, Deny is default and cancel, and it shows the code', async () => {
  const r = rig();
  try {
    const p = ask(r);
    await r.flush();
    const o = r.dialogs[0].opts;
    assert.equal(o.parent, undefined);
    assert.deepEqual(o.buttons, ['Deny', 'Allow']);
    assert.equal(o.defaultId, 0); assert.equal(o.cancelId, 0);
    assert.match(o.message, /Code 4821/);
    assert.match(o.message, /abcdefghijklmnopabcdefghijklmnop/);
    assert.match(o.detail, /Allow only if you just clicked Pair/);
    assert.doesNotMatch(o.message + o.detail, /replaces/);
    assert.ok(!(o.message + o.detail).includes(TOKEN));
    r.dialogs[0].resolve({ response: 0 });
    assert.equal((await p).status, 403);
  } finally { r.cleanup(); }
});

test('Deny writes nothing', async () => {
  const r = rig();
  try {
    const p = ask(r); await r.flush();
    r.dialogs[0].resolve({ response: 0 });
    const out = await p;
    assert.equal(out.status, 403); assert.equal(out.body.ok, false);
    assert.deepEqual(files(r.dataDir), []);
  } finally { r.cleanup(); }
});

test('a dialog error counts as Deny', async () => {
  const r = rig();
  try {
    const p = ask(r); await r.flush();
    r.dialogs[0].reject(new Error('window gone'));
    assert.equal((await p).status, 403);
    assert.deepEqual(files(r.dataDir), []);
  } finally { r.cleanup(); }
});

test('60 s without an answer is a 403 and writes nothing, even if Allow is clicked afterwards', async () => {
  const r = rig();
  try {
    const p = ask(r); await r.flush();
    r.clock.t += 60_000; r.fire();
    const out = await p;
    assert.equal(out.status, 403); assert.equal(out.body.error, 'timed out');
    r.dialogs[0].resolve({ response: 1 });   // a late click on the stale dialog
    await r.flush();
    assert.deepEqual(files(r.dataDir), []);
    // and the slot is free again
    const p2 = ask(r); await r.flush();
    assert.equal(r.dialogs.length, 2);
    r.dialogs[1].resolve({ response: 0 }); await p2;
  } finally { r.cleanup(); }
});

test('Allow writes exactly the proposed token and the pairing file, sends no token back, leaves no temp file', async () => {
  const r = rig();
  try {
    const p = ask(r); await r.flush();
    r.dialogs[0].resolve({ response: 1 });
    const out = await p;
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { ok: true });
    assert.ok(!JSON.stringify(out).includes(TOKEN));
    assert.equal(readFileSync(join(r.dataDir, '.bridge-token'), 'utf8').trim(), TOKEN);
    const doc = JSON.parse(readFileSync(join(r.dataDir, '.bridge-pairing.json'), 'utf8'));
    assert.deepEqual(Object.keys(doc).sort(), ['origin', 'pairedAt', 'v']);
    assert.equal(doc.v, 1); assert.equal(doc.origin, EXT);
    assert.equal(doc.pairedAt, new Date(r.clock.t).toISOString());
    assert.deepEqual(files(r.dataDir), ['.bridge-pairing.json', '.bridge-token']);
    // the shared store sees it at once (no 1 s wait)
    assert.equal(r.pair._state().open, false);
  } finally { r.cleanup(); }
});

test('re-pairing goes through the dialog, says it replaces, and replaces both files', async () => {
  const r = rig();
  try {
    let p = ask(r); await r.flush(); r.dialogs[0].resolve({ response: 1 }); await p;
    const other = 'chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk';
    const token2 = 'b2'.repeat(32);
    r.clock.t += 5000;
    p = r.pair.handlePair({ origin: other, body: { code: '1234', token: token2 } }); await r.flush();
    assert.match(r.dialogs[1].opts.detail, /replaces the existing pairing/);
    r.dialogs[1].resolve({ response: 1 });
    assert.equal((await p).status, 200);
    assert.equal(readFileSync(join(r.dataDir, '.bridge-token'), 'utf8').trim(), token2);
    assert.equal(JSON.parse(readFileSync(join(r.dataDir, '.bridge-pairing.json'), 'utf8')).origin, other);
  } finally { r.cleanup(); }
});

test('a denied re-pair leaves the existing pairing untouched', async () => {
  const r = rig();
  try {
    let p = ask(r); await r.flush(); r.dialogs[0].resolve({ response: 1 }); await p;
    const before = readFileSync(join(r.dataDir, '.bridge-token'), 'utf8');
    r.clock.t += 5000;
    p = r.pair.handlePair({ origin: EXT, body: { code: '9999', token: 'c3'.repeat(32) } }); await r.flush();
    r.dialogs[1].resolve({ response: 0 });
    assert.equal((await p).status, 403);
    assert.equal(readFileSync(join(r.dataDir, '.bridge-token'), 'utf8'), before);
  } finally { r.cleanup(); }
});

test('a second /pair while a dialog is open is 429, and does not use up a try', async () => {
  const r = rig();
  try {
    const first = ask(r); await r.flush();
    const second = await ask(r);
    assert.equal(second.status, 429);
    assert.equal(r.dialogs.length, 1);
    assert.equal(r.pair._state().tries, 1);
    r.dialogs[0].resolve({ response: 0 }); await first;
  } finally { r.cleanup(); }
});

test('at most 3 tries per 10 minutes; the window slides', async () => {
  const r = rig();
  try {
    for (let i = 0; i < 3; i++) {
      const p = ask(r); await r.flush();
      r.dialogs[i].resolve({ response: 0 });
      assert.equal((await p).status, 403);
      r.clock.t += 60_000;
    }
    const capped = await ask(r);
    assert.equal(capped.status, 429); assert.match(capped.body.error, /too many/);
    assert.equal(r.dialogs.length, 3);
    r.clock.t += 8 * 60_000;           // the first try is now older than 10 min
    const p = ask(r); await r.flush();
    assert.equal(r.dialogs.length, 4);
    r.dialogs[3].resolve({ response: 0 }); await p;
  } finally { r.cleanup(); }
});

test('the token and code never reach the log', async () => {
  const r = rig();
  try {
    let p = ask(r); await r.flush(); r.dialogs[0].resolve({ response: 1 }); await p;
    r.clock.t += 1000;
    p = ask(r); await r.flush(); r.dialogs[1].resolve({ response: 0 }); await p;
    assert.ok(r.logs.length >= 2);
    for (const line of r.logs) { assert.ok(!line.includes(TOKEN), line); assert.ok(!line.includes(CODE), line); }
  } finally { r.cleanup(); }
});

test('the token store: re-reads on an mtime change, checks the disk at most once a second, proof is the HMAC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-store-test-'));
  try {
    const clock = { t: 5_000_000 };
    const store = createTokenStore({ dataDir: dir, now: () => clock.t });
    assert.equal(store.get(), '');
    writeFileSync(join(dir, '.bridge-token'), TOKEN + '\n');
    assert.equal(store.get(), '', 'inside the 1 s window the disk is not looked at');
    clock.t += 1001;
    assert.equal(store.get(), TOKEN);
    const nonce = 'f0'.repeat(16);
    assert.equal(store.proof(nonce), require('node:crypto').createHmac('sha256', TOKEN).update(nonce).digest('hex'));
    assert.equal(store.proof('not-a-nonce'), null);
    writeFileSync(join(dir, '.bridge-token'), 'c3'.repeat(32) + '\n');
    utimesSync(join(dir, '.bridge-token'), new Date(clock.t + 5000), new Date(clock.t + 5000));
    clock.t += 1001;
    assert.equal(store.get(), 'c3'.repeat(32));
    writeFileSync(join(dir, '.bridge-pairing.json'), JSON.stringify({ v: 1, origin: EXT, pairedAt: 'x' }));
    clock.t += 1001;
    assert.equal(store.isPairedOrigin(EXT), true);
    assert.equal(store.isPairedOrigin('chrome-extension://other'), false);
    writeFileSync(join(dir, '.bridge-pairing.json'), '{not json');
    utimesSync(join(dir, '.bridge-pairing.json'), new Date(clock.t + 9000), new Date(clock.t + 9000));
    clock.t += 1001;
    assert.equal(store.pairing(), null);
    assert.equal(existsSync(join(dir, '.bridge-token')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allowCors: any extension before pairing; only the paired one after (plus /pair for re-pairing); never a web page', () => {
  const pairing = { v: 1, origin: EXT, pairedAt: 'x' };
  assert.equal(allowCors(EXT, null, '/ingest'), true);
  assert.equal(allowCors('https://example.com', null, '/pair'), false);
  assert.equal(allowCors('', null, '/pair'), false);
  assert.equal(allowCors(EXT, pairing, '/assist/brief'), true);
  assert.equal(allowCors('chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk', pairing, '/assist/brief'), false);
  assert.equal(allowCors('chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk', pairing, '/social/outbox'), false);
  assert.equal(allowCors('chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk', pairing, '/pair'), true);
  assert.equal(allowCors('https://example.com', pairing, '/pair'), false);
});
