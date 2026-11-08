// browser-bridge/assist.js (+ endpoint-guard.js): pairing driven by the service worker, and the Brief on the toolbar.
// Both are classic extension scripts, run here in a node vm with a fake chrome, a fake app behind a fake fetch and a
// fake DOM (the popup-approval.test.mjs pattern — no jsdom, no browser, no port).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webcrypto, createHmac } from 'node:crypto';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '..', 'browser-bridge');
const read = (f) => readFileSync(resolve(EXT, f), 'utf8');
const ctx = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto, console, Uint8Array, Uint32Array, Date });
ctx.globalThis = ctx;
vm.runInContext(read('endpoint-guard.js'), ctx);
vm.runInContext(read('assist.js'), ctx);
const { HQAssist, HQGuard } = ctx;

const OLD = 'ee'.repeat(32);
const ENDPOINT = 'http://127.0.0.1:47821';
const R = (n) => n.toString(16).padStart(12, '0');   // a ref

// ---- the world: chrome storage + badge, the app behind fetch --------------------------------------------------
function world({ cfg = { endpoint: ENDPOINT, token: '' }, brief = null, now = { t: 10_000_000 } } = {}) {
  const local = new Map(cfg ? [['hq_cfg', cfg]] : []);
  const session = new Map();
  const area = (m) => ({
    get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (m.has(x)) o[x] = structuredClone(m.get(x)); return o; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    remove: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); },
  });
  const badge = { text: '', color: '', history: [] };
  const chrome = {
    storage: { local: area(local), session: area(session) },
    action: { setBadgeText: async ({ text }) => { badge.text = text; badge.history.push(text); }, setBadgeBackgroundColor: async ({ color }) => { badge.color = color; } },
  };
  const app = {
    token: null,           // the token the app holds (null: unpaired)
    brief, up: true,
    pairMode: 'allow',     // 'allow' | 'deny' | 'hold' | 'busy'
    lostAnswer: false,     // the app saved the token but the answer never arrives
    release: null, pairBodies: [], opened: [],
  };
  const urls = [];
  const fetch = async (url, opts = {}) => {
    urls.push(url);
    if (!app.up) throw new TypeError('Failed to fetch');
    const u = new URL(url), method = opts.method || 'GET', h = opts.headers || {};
    const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (u.pathname === '/health') {
      const nonce = u.searchParams.get('nonce');
      return res(200, { ok: true, app: 'workspacehq', needsToken: !!app.token, ...(app.token && nonce ? { proof: createHmac('sha256', app.token).update(nonce).digest('hex') } : {}) });
    }
    if (u.pathname === '/pair' && method === 'POST') {
      const body = JSON.parse(opts.body); app.pairBodies.push(body);
      if (h['X-HQ-Token']) throw new Error('/pair must not carry a token');
      if (app.pairMode === 'hold') await new Promise((r) => { app.release = r; });
      if (app.pairMode === 'deny') return res(403, { ok: false, error: 'denied' });
      if (app.pairMode === 'busy') return res(429, { ok: false });
      app.token = body.token;
      if (app.lostAnswer) throw new TypeError('connection reset');
      return res(200, { ok: true });
    }
    if (u.pathname === '/assist/brief') {
      if (!app.token) return res(401, { ok: false, error: 'pair first' });
      if (h['X-HQ-Token'] !== app.token) return res(401, { ok: false, error: 'bad token' });
      return res(200, { ok: true, brief: app.brief });
    }
    if (u.pathname === '/assist/open' && method === 'POST') {
      if (h['X-HQ-Token'] !== app.token) return res(401, { ok: false });
      const { ref } = JSON.parse(opts.body);
      if (!(app.brief && [...app.brief.items, ...app.brief.overflow].some((i) => i.ref === ref))) return res(404, { ok: false, error: 'unknown ref' });
      app.opened.push(ref);
      return res(200, { ok: true });
    }
    return res(404, { ok: false });
  };
  const assist = HQAssist.create({ chrome, fetch, now: () => now.t, crypto: webcrypto, guard: HQGuard });
  return { assist, chrome, local, session, badge, app, urls, now, fetch };
}
const plain = (x) => JSON.parse(JSON.stringify(x));   // results cross the vm realm boundary
const flushAll = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

const item = (n, severity, extra = {}) => ({ ref: R(n), rule: 'dirty', severity, sevWord: severity === 'high' ? 'urgent' : severity === 'med' ? 'soon' : 'when you can', text: 'A project has uncommitted files', count: 0, isNew: false, age: 'scan 2 h ago', nav: { kind: 'go', tab: 'projects', sub: null }, ...extra });
const ov = (n, severity) => ({ ref: R(n), rule: 'dirty', severity, text: 'x', count: 0, isNew: false });
const mkBrief = (over = {}) => ({ v: 1, generatedAt: '2026-11-07T14:05:00.000Z', ageMinutes: 10, stale: false, counts: { high: 1, med: 1, low: 1 }, items: [item(1, 'high'), item(2, 'med')], overflow: [ov(3, 'low')], overflowLine: '+1 more · a project has uncommitted files', more: 1, errorSources: [], ...over });

// ---- pairing ---------------------------------------------------------------------------------------------------
test('pairing: the code is 4 digits, the token 64 hex; /pair carries no token header; the badge shows the code while pending', async () => {
  const w = world();
  w.app.pairMode = 'hold';
  const p = w.assist.startPair();
  await flushAll();
  const pending = w.local.get('hq_pair_pending');
  assert.match(pending.code, /^\d{4}$/); assert.match(pending.token, /^[0-9a-f]{64}$/);
  assert.equal(w.session.get('hq_pair_code'), pending.code);
  assert.equal(w.badge.text, pending.code);
  assert.deepEqual(w.app.pairBodies, [{ code: pending.code, token: pending.token }]);
  assert.equal((await w.assist.pairState()).state, 'pairing');
  w.app.release(); await p;
});

test('the popup closing mid-pair still ends paired: the worker adopts the token once the proof verifies', async () => {
  const w = world({ cfg: { endpoint: ENDPOINT, token: OLD } });
  w.app.token = OLD; w.app.pairMode = 'hold';
  const p = w.assist.startPair();          // the popup that asked has been closed; nobody awaits its reply
  await flushAll();
  const proposed = w.local.get('hq_pair_pending').token;
  // the popup reopens while the owner is still looking at the dialog: not yet
  assert.equal((await w.assist.promote()).state, 'waiting');
  assert.equal(w.local.get('hq_cfg').token, OLD, 'the old token stays active until the proof verifies');
  w.app.release();                          // the owner clicks Allow
  const out = await p;
  assert.equal(out.status, 'paired');
  assert.equal(w.local.get('hq_cfg').token, proposed);
  assert.equal(w.local.has('hq_pair_pending'), false);
  assert.equal(w.session.has('hq_pair_code'), false);
  assert.equal(w.badge.text, '');
  assert.equal(w.local.get('hq_cfg').endpoint, ENDPOINT, 'other settings are kept');
});

test('a lost /pair answer does no harm: the next popup open or alarm promotes the pending token', async () => {
  const w = world();
  w.app.lostAnswer = true;
  const out = await w.assist.startPair();
  assert.equal(out.status, 'unreachable');
  assert.ok(w.local.has('hq_pair_pending'), 'kept: the app may have allowed it');
  assert.equal(w.local.get('hq_cfg').token, '');
  w.now.t += 30_000;
  assert.equal((await w.assist.promote()).state, 'paired');
  assert.equal(w.local.get('hq_cfg').token, w.app.token);
});

test('Deny leaves the old token active and clears the pending state', async () => {
  const w = world({ cfg: { endpoint: ENDPOINT, token: OLD } });
  w.app.token = OLD; w.app.pairMode = 'deny';
  const out = await w.assist.startPair();
  assert.equal(out.status, 'denied');
  assert.match(out.message, /previous pairing is unchanged/);
  assert.equal(w.local.get('hq_cfg').token, OLD);
  assert.equal(w.local.has('hq_pair_pending'), false);
  assert.equal(w.badge.text, '');
  assert.equal((await w.assist.pairState()).state, 'paired');
  assert.equal((await w.assist.tick()).state, 'nobrief', 'and the old token still works (the app answered, with no brief yet)');
});

test('429 (a dialog is already open, or too many tries) is reported and clears the pending state', async () => {
  const w = world(); w.app.pairMode = 'busy';
  const out = await w.assist.startPair();
  assert.equal(out.status, 'busy');
  assert.equal(w.local.has('hq_pair_pending'), false);
});

test('a pending token that never verifies is dropped after 2 minutes, and the old token stays', async () => {
  const w = world({ cfg: { endpoint: ENDPOINT, token: OLD } });
  w.app.token = OLD; w.app.lostAnswer = false; w.app.pairMode = 'deny';   // the app will never hold the proposal
  // seed a pending proposal as if the answer were lost
  await w.chrome.storage.local.set({ hq_pair_pending: { token: 'dd'.repeat(32), code: '1234', startedAt: w.now.t } });
  await w.chrome.storage.session.set({ hq_pair_code: '1234' });
  assert.equal((await w.assist.promote()).state, 'waiting');
  w.now.t += 119_000;
  assert.equal((await w.assist.promote()).state, 'waiting');
  w.now.t += 2_000;
  assert.equal((await w.assist.promote()).state, 'expired');
  assert.equal(w.local.has('hq_pair_pending'), false);
  assert.equal(w.session.has('hq_pair_code'), false);
  assert.equal(w.local.get('hq_cfg').token, OLD);
});

test('Pair clicked again while a proposal is pending does not send a second proposal', async () => {
  const w = world(); w.app.pairMode = 'hold';
  const first = w.assist.startPair(); await flushAll();
  const second = await w.assist.startPair();
  assert.equal(second.status, 'pairing');
  assert.equal(w.app.pairBodies.length, 1);
  w.app.release(); await first;
});

test('pairing refuses a non-loopback endpoint without sending anything', async () => {
  const w = world({ cfg: { endpoint: 'https://example.com', token: '' } });
  const out = await w.assist.startPair();
  assert.equal(out.status, 'not-on-pc');
  assert.equal(out.message, 'endpoint is not on this PC — not sent');
  assert.equal(w.urls.length, 0);
  assert.equal(w.local.has('hq_pair_pending'), false);
});

test('pairing codes are zero-padded 4 digits', async () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const w = world(); w.app.pairMode = 'deny'; w.app.token = null;
    await w.assist.startPair();
    seen.add(w.app.pairBodies[0].code);
  }
  for (const c of seen) assert.match(c, /^\d{4}$/);
  assert.ok(seen.size > 10);
});

// ---- the toolbar badge -----------------------------------------------------------------------------------------
async function paired(brief, extra = {}) {
  const w = world({ cfg: { endpoint: ENDPOINT, token: OLD }, brief, ...extra });
  w.app.token = OLD;
  return w;
}

test('badge: counts unseen refs across items AND overflow; red when an unseen item is high', async () => {
  const w = await paired(mkBrief());
  const r = await w.assist.tick();
  assert.equal(r.state, 'ok');
  assert.equal(w.badge.text, '3');
  assert.equal(w.badge.color, HQAssist.constants.RED);
  assert.deepEqual(plain(r.unseen), [R(1), R(2), R(3)]);
});

test('badge: amber when nothing unseen is high; seen refs are not counted again', async () => {
  const w = await paired(mkBrief());
  await w.assist.tick();
  await w.assist.markSeen([R(1)]);
  await w.assist.tick();
  assert.equal(w.badge.text, '2');
  assert.equal(w.badge.color, HQAssist.constants.AMBER);
});

test('badge: opening the popup (markSeen after render) clears it, and it stays clear on the next alarm', async () => {
  const w = await paired(mkBrief());
  const r = await w.assist.tick({ popup: true });
  assert.equal(r.unseen.length, 3);
  await w.assist.markSeen([R(1), R(2), R(3)]);
  assert.equal(w.badge.text, '');
  await w.assist.tick();
  assert.equal(w.badge.text, '');
  w.app.brief = mkBrief({ items: [item(1, 'high'), item(2, 'med'), item(9, 'med')] });   // one new item appears
  await w.assist.tick();
  assert.equal(w.badge.text, '1');
  assert.equal(w.badge.color, HQAssist.constants.AMBER);
});

test('badge: nothing when the brief is stale (over 60 min), the app is down, unpaired, or there is no brief', async () => {
  let w = await paired(mkBrief({ ageMinutes: 61, stale: true }));
  assert.equal((await w.assist.tick()).state, 'ok'); assert.equal(w.badge.text, '');
  w = await paired(mkBrief({ ageMinutes: 45, stale: true }));   // the projection says stale at 30; the toolbar waits for 60
  await w.assist.tick(); assert.equal(w.badge.text, '3');
  w = await paired(mkBrief({ ageMinutes: null }));
  await w.assist.tick(); assert.equal(w.badge.text, '');
  w = await paired(mkBrief());
  await w.assist.tick(); assert.equal(w.badge.text, '3');
  w.app.up = false;
  const down = await w.assist.tick();
  assert.equal(down.state, 'offline'); assert.equal(w.badge.text, '');
  w = world(); assert.equal((await w.assist.tick()).state, 'unpaired'); assert.equal(w.badge.text, '');
  w = await paired(null);
  assert.equal((await w.assist.tick()).state, 'nobrief'); assert.equal(w.badge.text, '');
});

test('badge: a wrong token (401) reads as not paired; the pairing code outranks the count', async () => {
  const w = await paired(mkBrief());
  w.app.token = 'cc'.repeat(32);       // the app was re-paired elsewhere: the proof no longer verifies
  const r = await w.assist.tick();
  assert.equal(r.state, 'offline');
  assert.match(r.detail, /something else is answering on port 47821/);
  assert.equal(w.badge.text, '');
  const w2 = await paired(mkBrief());
  await w2.chrome.storage.session.set({ hq_pair_code: '4821' });
  await w2.chrome.storage.local.set({ hq_pair_pending: { token: 'dd'.repeat(32), code: '4821', startedAt: w2.now.t } });
  await w2.assist.tick();
  assert.equal(w2.badge.text, '4821');
});

test('a booking of the grab hold (…) shows until viewed, but never over a pairing code', async () => {
  const w = await paired(mkBrief());
  await w.chrome.storage.session.set({ hq_badge_hold: '…' });
  await w.assist.tick();
  assert.equal(w.badge.text, '…');
  await w.chrome.storage.session.remove('hq_badge_hold');
  await w.assist.tick();
  assert.equal(w.badge.text, '3');
});

test('open: POSTs the ref; an unknown ref says the Brief changed; the app down says so', async () => {
  const w = await paired(mkBrief());
  assert.deepEqual(plain(await w.assist.openRef(R(1))), { ok: true, note: '' });
  assert.deepEqual(w.app.opened, [R(1)]);
  const gone = await w.assist.openRef(R(77));
  assert.equal(gone.ok, false); assert.match(gone.error, /Brief changed/);
  w.app.up = false;
  assert.equal((await w.assist.openRef(R(1))).ok, false);
});

test('nothing is ever fetched from a non-loopback URL, whatever the endpoint says', async () => {
  const all = [];
  for (const endpoint of ['https://example.com', 'http://127.0.0.1.evil.com:47821', 'http://localhost@evil.com', 'http://[::1]:47821', 'javascript:alert(1)']) {
    const w = world({ cfg: { endpoint, token: OLD }, brief: mkBrief() });
    w.app.token = OLD;
    const t = await w.assist.tick();
    assert.equal(t.state, 'offline', endpoint);
    assert.equal((await w.assist.openRef(R(1))).ok, false);
    assert.equal((await w.assist.startPair()).status, 'not-on-pc');
    assert.equal((await w.assist.promote()).state, 'none');
    all.push(...w.urls);
  }
  assert.deepEqual(all, []);
  const w = await paired(mkBrief());
  await w.assist.tick(); await w.assist.openRef(R(1));
  for (const u of w.urls) assert.match(u, /^http:\/\/127\.0\.0\.1:47821\//);
});

test('a wrong proof from whatever answers the port stops the token and the request', async () => {
  const w = await paired(mkBrief());
  w.app.token = 'cc'.repeat(32);
  await w.assist.openRef(R(1));
  await w.assist.tick();
  assert.deepEqual(w.app.opened, []);
  assert.ok(w.urls.every((u) => u.includes('/health?nonce=')), 'only unauthenticated probes went out');
});

// ---- the Needs-you view ----------------------------------------------------------------------------------------
test('needsModel: the honest states, word for word', () => {
  const m = (res, o) => HQAssist.needsModel(res, { tz: 'utc', ...o });
  assert.equal(m({ state: 'offline', detail: 'x' }).title, 'Open WorkspaceHQ on this PC');
  assert.equal(m({ state: 'unpaired' }).title, 'Not paired — pair to see the Brief here');
  assert.equal(m({ state: 'pairing', code: '1234' }).title, 'Pairing — check the code in the WorkspaceHQ window');
  assert.equal(m({ state: 'ok', brief: mkBrief({ items: [], overflow: [], overflowLine: '', more: 0 }), unseen: [] }).title, 'Nothing needs you · from the 14:05 brief');
  // items that stepped aside after 3 days are still there: never "Nothing needs you" while one stands
  assert.equal(m({ state: 'ok', brief: mkBrief({ items: [], overflow: [], overflowLine: '', more: 0, standing: { count: 2, since: '2026-11-05', line: '2 standing since 5 Nov' } }), unseen: [] }).title, 'Nothing new · 2 standing since 5 Nov · from the 14:05 brief');
  const inc = m({ state: 'ok', brief: mkBrief({ errorSources: ['github', 'money'] }), unseen: [] });
  assert.equal(inc.incomplete, 'Brief incomplete · github · money');
  const guard = m({ state: 'offline', code: 'impostor', detail: 'something else is answering on port 47821 — not sent' });
  assert.equal(guard.title, 'something else is answering on port 47821 — not sent');
});

test('needsModel: up to 3 rows with severity word, wording, age and a new tag; the overflow line; a scan item says where scans start', () => {
  const b = mkBrief({ items: [item(1, 'high'), item(2, 'med', { rule: 'scan-stale', nav: { kind: 'scan', tab: null, sub: null } }), item(3, 'low'), item(4, 'low')] });
  const m = HQAssist.needsModel({ state: 'ok', brief: b, unseen: [R(1)], newRefs: [R(1)] });
  assert.equal(m.rows.length, 3);
  assert.equal(m.rows[0].sevWord, 'urgent'); assert.equal(m.rows[0].age, 'scan 2 h ago'); assert.equal(m.rows[0].isNew, true);
  assert.equal(m.rows[1].isNew, false); assert.equal(m.rows[1].scan, true); assert.equal(m.rows[0].scan, false);
  assert.equal(m.overflowLine, '+1 more · a project has uncommitted files');
  const stale = HQAssist.needsModel({ state: 'ok', brief: mkBrief({ ageMinutes: 90 }), unseen: [] });
  assert.match(stale.note, /90 min old/);
});

function fakeDoc() {
  const mk = (tag) => {
    const listeners = {};
    return {
      tag, className: '', textContent: '', dataset: {}, children: [], type: '',
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren() { this.children = []; },
      addEventListener(t, f) { listeners[t] = f; }, click() { listeners.click && listeners.click(); },
      set innerHTML(v) { throw new Error('innerHTML was used: ' + v); },
    };
  };
  return { createElement: mk, mk };
}
const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); };

test('renderNeeds: page-supplied or app-supplied text goes in through textContent only; Open in app calls back with the ref', () => {
  const doc = fakeDoc(), host = doc.mk('div');
  const evil = '<img src=x onerror=alert(1)>';
  const b = mkBrief({ items: [item(1, 'high', { text: evil })], overflowLine: evil, errorSources: ['github'] });
  const model = HQAssist.needsModel({ state: 'ok', brief: b, unseen: [R(1)], newRefs: [R(1)] });
  const opened = [];
  HQAssist.renderNeeds(doc, host, model, { open: (ref) => opened.push(ref) });
  const texts = [], buttons = [];
  walk(host, (n) => { if (n.textContent) texts.push(n.textContent); if (n.tag === 'button') buttons.push(n); });
  assert.ok(texts.includes(evil), 'shown as text');
  assert.ok(texts.includes('new'));
  assert.equal(buttons.length, 1); assert.equal(buttons[0].textContent, 'Open in app');
  buttons[0].click();
  assert.deepEqual(opened, [R(1)]);
  HQAssist.renderNeeds(doc, host, HQAssist.needsModel({ state: 'unpaired' }), {});
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].textContent, 'Not paired — pair to see the Brief here');
});

test('renderNeeds: a scan row says to start scans in the app', () => {
  const doc = fakeDoc(), host = doc.mk('div');
  const b = mkBrief({ items: [item(2, 'med', { rule: 'scan-stale', nav: { kind: 'scan', tab: null, sub: null } })] });
  HQAssist.renderNeeds(doc, host, HQAssist.needsModel({ state: 'ok', brief: b, unseen: [] }), {});
  const texts = []; walk(host, (n) => { if (n.textContent) texts.push(n.textContent); });
  assert.ok(texts.includes('start scans in the app (uses Claude)'));
});

// ---- the existing senders must go through the guard (the shared edits land at the Pass) -----------------------
for (const [file, label] of [['background.js', 'flush'], ['social.js', 'social'], ['claude-sync.js', 'claude-sync'], ['popup.js', 'the popup\'s fetchJson']]) {
  const src = existsSync(resolve(EXT, file)) ? read(file) : '';
  test(`${label} (${file}) sends nothing to a non-loopback endpoint or an unproven app`, { skip: !/HQGuard\.guardedFetch/.test(src) && 'waits for the shared edit that routes this sender through endpoint-guard.js' }, () => {
    assert.match(src, /HQGuard\.guardedFetch/);
    // fetches to the app name the configured endpoint; the page-world fetches in social.js go to bsky/mastodon/reddit/X, not here
    const bare = src.match(/\bfetch\(\s*(?:cfg\.endpoint|[\w.]*endpoint|baseUrl\([^)]*\))/g) || [];
    assert.deepEqual(bare, [], 'an unguarded fetch to the app is left in ' + file);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /X-HQ-Token/, file + ' builds the token header itself instead of leaving it to the guard');
  });
}
